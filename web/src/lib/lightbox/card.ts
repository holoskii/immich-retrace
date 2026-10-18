// The image of a card that follows the time cursor (the phone dock's photo card, the desktop map's pop-out card):
// one thumbnail at a time through the media queue, latest wins, paced so a scrub doesn't spend the demo's request
// budget on photos the finger only passed over.
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

/** The demo's pacing for a card's loads during a scrub (DEMO_MEDIA_WINDOW is 50 starts / 20 s for everything). */
export const CARD_REST_MS = 120, CARD_GAP_MS = 500;

/**
 * `want(url)` names the photo at the cursor; `src` is what to show: that photo's loaded thumbnail, or null (the card
 * shows the photo's thumbhash), never a photo for another moment. A load starts when the cursor rested `rest` ms on a
 * photo or `gap` ms passed since the last start, one at a time; one superseded while still waiting in the queue is
 * dropped, one already in flight finishes into the cache. `changed` fires when `src` may have changed.
 */
export class CardImage {
  private queue: Pick<MediaQueue, 'load'>;
  private changed: () => void;
  private o: Required<CardImageOptions>;
  /** Loaded: url → shown src. Insertion order is recency. `own`: an object URL this class revokes. */
  private held = new Map<string, {src: string; own: boolean}>();
  private wanted: string | null = null;
  private since = 0;
  private lastStart = -Infinity;
  private flight: {url: string; ctrl: AbortController; started: boolean} | null = null;
  private broken = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dead = false;

  constructor(queue: Pick<MediaQueue, 'load'>, changed: () => void, opts: CardImageOptions = {}) {
    this.queue = queue; this.changed = changed;
    this.o = {
      rest: CARD_REST_MS, gap: () => (config.demo ? CARD_GAP_MS : 0), keep: 24, onFail: () => {}, onLoad: () => {}, now: () => performance.now(),
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
    // Superseded before its request started: drop it (a started one finishes into the cache).
    const f = this.flight;
    if (f && f.url !== url && !f.started) { f.ctrl.abort(); this.flight = null; }
    this.changed();
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
    this.flight?.ctrl.abort();
    this.flight = null;
    for (const h of this.held.values()) if (h.own) this.o.revoke(h.src);
    this.held.clear();
  }

  private schedule() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const w = this.wanted;
    if (this.dead || !w || this.flight || this.held.has(w) || w === this.broken) return;
    const t = this.o.now(), at = Math.min(this.since + this.o.rest, this.lastStart + this.o.gap());
    if (t < at) { this.timer = setTimeout(() => this.schedule(), at - t); return; }
    this.start(w);
  }

  private start(url: string) {
    const f = {url, ctrl: new AbortController(), started: false};
    this.flight = f;
    this.queue.load(url, {signal: f.ctrl.signal, high: true, onStart: () => { f.started = true; this.lastStart = this.o.now(); }})
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
        if (this.flight === f) { this.flight = null; this.schedule(); }
      });
  }

  /** Least recently wanted first, never the wanted one. */
  private trim() {
    for (const [u, h] of this.held) {
      if (this.held.size <= this.o.keep) break;
      if (u === this.wanted) continue;
      this.held.delete(u);
      if (h.own) this.o.revoke(h.src);
    }
  }
}
