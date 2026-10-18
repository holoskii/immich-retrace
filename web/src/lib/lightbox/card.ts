// The image of a card that follows the time cursor (the phone dock's photo card, the desktop map's pop-out card):
// one thumbnail at a time through the media queue, latest wins, paced so a scrub doesn't spend the demo's request
// budget on photos the finger only passed over; during Play, the next few prefetched instead.
import {config} from '../config.svelte.ts';
import {registerLoaded, type MediaQueue} from './media.ts';

export interface CardImageOptions {
  /** A wanted photo the cursor rested on this long (ms) is loaded at once. */
  rest?: number;
  /**
   * While the cursor keeps moving, a load starts at most this often (ms); read before each start. 0: no pacing.
   * Default: CARD_GAP_MS in the demo (its media rate limit), 0 elsewhere.
   */
  gap?: () => number;
  /** Loaded thumbnails kept (object URLs), so scrubbing back over them costs no request. */
  keep?: number;
  /** While playing, a prefetch starts at most this often (ms); read before each. Default: CARD_AHEAD_MS in the demo. */
  aheadGap?: () => number;
  /** A loaded thumbnail failed (its request or its decoding) / loaded. */
  onFail?: (url: string) => void;
  onLoad?: (url: string) => void;
  now?: () => number;
  /** Blob → a URL ready to show (decoded); `revoke` frees it. */
  prepare?: (b: Blob) => Promise<string>;
  revoke?: (src: string) => void;
}

/** Decodes before resolving, so the swap from thumbhash to photo never shows a half-painted image. */
async function prepareBlob(b: Blob) {
  const src = URL.createObjectURL(b);
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    return src;
  } catch (e) { URL.revokeObjectURL(src); throw e; }
}

/**
 * The demo's pacing for a card's loads during a scrub, and for Play's prefetches: spread evenly rather than spent in the
 * first seconds and then nothing. Set when thumbnails shared the preview window (35 background starts / 20 s); they now
 * have their own (DEMO_MEDIA_WINDOWS.thumbnail, 180), so these are well inside it.
 */
export const CARD_REST_MS = 120, CARD_GAP_MS = 500, CARD_AHEAD_MS = 600;

interface Flight { ctrl: AbortController; started: boolean; explicit: boolean; ahead: boolean }

/**
 * `want(url)` names the photo at the cursor; `src` is what to show: that photo's loaded thumbnail, or null (the card
 * shows the photo's thumbhash), never a photo for another moment. A load starts when the cursor rested `rest` ms on a
 * photo (an explicit load: it may use the queue's reserve, and a waiting one is promoted to it) or `gap` ms passed
 * since the last start (background), one at a time. While Play runs, `ahead(urls)` prefetches the photos Play will
 * linger on next instead (background, paced), and the card starts nothing of its own. A load superseded while still waiting in the queue is dropped, one already in flight finishes into the cache.
 * `changed` fires when `src` may have changed.
 */
export class CardImage {
  private queue: Pick<MediaQueue, 'load' | 'prioritize'>;
  private changed: () => void;
  private o: Required<CardImageOptions>;
  /** Loaded: url → shown src. Insertion order is recency. `own`: an object URL this class revokes. */
  private held = new Map<string, {src: string; own: boolean}>();
  private wanted: string | null = null;
  private aheadOf: string[] = [];
  private since = 0;
  private lastStart = -Infinity;
  private lastAhead = -Infinity;
  private aheadTimer: ReturnType<typeof setTimeout> | undefined;
  private flights = new Map<string, Flight>();
  private broken = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dead = false;

  constructor(queue: Pick<MediaQueue, 'load' | 'prioritize'>, changed: () => void, opts: CardImageOptions = {}) {
    this.queue = queue; this.changed = changed;
    this.o = {
      rest: CARD_REST_MS, gap: () => (config.demo ? CARD_GAP_MS : 0), aheadGap: () => (config.demo ? CARD_AHEAD_MS : 0), keep: 24, onFail: () => {}, onLoad: () => {}, now: () => performance.now(),
      prepare: prepareBlob, revoke: u => URL.revokeObjectURL(u), ...opts,
    };
    // Lent to the lightbox: object URLs, and an adopted <img> URL only when versioned (`c=`: the relay lets the
    // browser cache it, so showing it again is no request; an unversioned one is no-store).
    this.unregister = registerLoaded(u => { const h = this.held.get(u); return h && (h.own || /[?&]c=/.test(u)) ? h.src : null; });
  }
  private unregister: () => void;

  /** The thumbnail of the wanted photo, once loaded; null: show its thumbhash. */
  get src(): string | null {
    return this.wanted ? this.held.get(this.wanted)?.src ?? null : null;
  }

  want(url: string | null) {
    if (url === this.wanted || this.dead) return;
    this.wanted = url;
    this.since = this.o.now();
    const h = url ? this.held.get(url) : undefined;
    if (url && h) { this.held.delete(url); this.held.set(url, h); }
    this.dropStale();
    this.changed();
    this.schedule();
  }

  /**
   * While Play runs: the photos to have ready, most wanted first (play.ts playAhead); [] when it stops, so the card
   * loads the photo it rests on itself again. Those not held are loaded in the background lane, at most one per
   * `aheadGap` (Play calls this on every step; one no longer listed and still waiting is dropped).
   */
  ahead(urls: string[]) {
    if (this.dead) return;
    this.aheadOf = urls;
    this.dropStale();
    clearTimeout(this.aheadTimer);
    this.aheadTimer = undefined;
    const gap = this.o.aheadGap();
    for (const u of urls) {
      if (this.held.has(u) || this.flights.has(u) || u === this.broken) continue;
      const t = this.o.now();
      if (t - this.lastAhead < gap) {
        // Cooling down: try again when it's over (a photo Play lingers on may wait for no further step).
        this.aheadTimer = setTimeout(() => { this.aheadTimer = undefined; if (!this.dead) this.ahead(this.aheadOf); }, this.lastAhead + gap - t);
        break;
      }
      this.lastAhead = t;
      this.start(u, false, true);
    }
    this.schedule();
  }

  /** A thumbnail loaded elsewhere (the first card image, fetched by its own <img> as the page's LCP); not revoked. */
  adopt(url: string, src: string) {
    if (this.dead || this.held.has(url)) return;
    this.held.set(url, {src, own: false});
    this.trim();
    if (url === this.wanted) this.changed();
  }

  dispose() {
    this.unregister();
    this.dead = true;
    clearTimeout(this.timer);
    clearTimeout(this.aheadTimer);
    for (const f of this.flights.values()) f.ctrl.abort();
    this.flights.clear();
    for (const h of this.held.values()) if (h.own) this.o.revoke(h.src);
    this.held.clear();
  }

  /** Drops the loads still waiting in the queue that nothing wants any more (one in flight finishes). */
  private dropStale() {
    for (const [u, f] of this.flights) {
      if (f.started || u === this.wanted || this.aheadOf.includes(u)) continue;
      f.ctrl.abort();
      this.flights.delete(u);
    }
  }

  private schedule() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const w = this.wanted;
    if (this.dead || !w || this.held.has(w) || w === this.broken || this.aheadOf.length) return;
    const t = this.o.now(), restAt = this.since + this.o.rest, f = this.flights.get(w);
    if (f) {
      // Waiting in the queue (a scrub's paced load, or a prefetch): once the cursor rests on it, it is explicit.
      if (f.started || f.explicit) return;
      if (t >= restAt) { f.explicit = true; this.queue.prioritize(f.ctrl.signal, true); } else this.timer = setTimeout(() => this.schedule(), restAt - t);
      return;
    }
    // One load of its own at a time (it calls schedule again when done).
    for (const g of this.flights.values()) if (!g.ahead) return;
    const at = Math.min(restAt, this.lastStart + this.o.gap());
    if (t < at) { this.timer = setTimeout(() => this.schedule(), at - t); return; }
    this.start(w, t >= restAt, false);
    // Still waiting in the queue when the cursor comes to rest: promoted then.
    if (t < restAt) this.timer = setTimeout(() => this.schedule(), restAt - t);
  }

  private start(url: string, explicit: boolean, ahead: boolean) {
    const f: Flight = {ctrl: new AbortController(), started: false, explicit, ahead};
    this.flights.set(url, f);
    this.queue.load(url, {
      signal: f.ctrl.signal, high: !ahead, explicit,
      onStart: () => { f.started = true; if (!ahead) this.lastStart = this.o.now(); },
    })
      .then(b => this.o.prepare(b))
      .then(src => {
        if (this.dead) { this.o.revoke(src); return; }
        this.held.set(url, {src, own: true});
        this.trim();
        if (url === this.broken) this.broken = '';
        this.o.onLoad(url);
        if (url === this.wanted) this.changed();
      }, () => {
        if (f.ctrl.signal.aborted || this.dead) return;
        this.broken = url;
        this.o.onFail(url);
      })
      .finally(() => {
        if (this.flights.get(url) === f) { this.flights.delete(url); this.schedule(); }
      });
  }

  /** Least recently wanted first, never the wanted one nor one Play is about to show. */
  private trim() {
    for (const [u, h] of this.held) {
      if (this.held.size <= this.o.keep) break;
      if (u === this.wanted || this.aheadOf.includes(u)) continue;
      this.held.delete(u);
      if (h.own) this.o.revoke(h.src);
    }
  }
}
