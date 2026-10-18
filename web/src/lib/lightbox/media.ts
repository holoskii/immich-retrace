// Media URLs for the viewer's own relay (server/app.ts), and the queue thumbnails and previews load through.
// The deployment config lives in config.svelte.ts.
import {config} from '../config.svelte.ts';
export {getConfig} from '../config.svelte.ts';

/**
 * Thumbnail/preview URL. With a thumbhash the URL is versioned (`c`, like Immich's own web UI) and the
 * relay lets the browser cache it for good; a changed image gets a new thumbhash, so a new URL.
 */
export function thumbUrl(id: string, thumbhash: string | null | undefined, size: 'thumbnail' | 'preview' = 'thumbnail') {
  const q = new URLSearchParams({size});
  if (thumbhash) q.set('c', thumbhash);
  return `/api/assets/${id}/thumbnail?${q}`;
}

/**
 * Which demo rate limit a media URL counts against: thumbnails (small, many: the grid) or everything else (previews,
 * video). The same rule as the Caddyfile's thumbnail matcher: the relay path with `size=thumbnail` first, as `thumbUrl`
 * writes it; anything else counts as a preview.
 */
export type MediaKind = 'thumbnail' | 'preview';
export const mediaKind = (url: string): MediaKind => (/\/api\/assets\/[^/?]+\/thumbnail\?size=thumbnail(&|$)/.test(url) ? 'thumbnail' : 'preview');

/** Playback URL (Range supported). Immich serves the transcode, or the original when there is none. */
export const videoUrl = (id: string) => `/api/assets/${id}/video`;

/** The asset in Immich's web UI; null without a configured public URL. */
export function immichLink(base: string | null | undefined, id: string) {
  return base ? `${base.replace(/\/+$/, '')}/photos/${id}` : null;
}

// ---- thumbnails already loaded on the page ----

/** Something holding loaded thumbnails (the Photos grid, a card): the URL to show for `url`, or null. */
export type LoadedLookup = (url: string) => string | null;
const loadedSources = new Set<LoadedLookup>();
/** Lists a holder for `loadedThumb`; returns its removal. */
export function registerLoaded(f: LoadedLookup) {
  loadedSources.add(f);
  return () => { loadedSources.delete(f); };
}
/**
 * The thumbnail for `url` if something on the page already holds it loaded (an object URL, or a URL the browser
 * cached), else null: never a request. The lightbox layers it between the thumbhash and the preview, so a photo
 * opened from a sharp grid cell or card doesn't open as a blur.
 */
export function loadedThumb(url: string): string | null {
  for (const f of loadedSources) { const s = f(url); if (s) return s; }
  return null;
}

/** A media request answered with an error status (after the queue's own 429 retries). */
export class MediaStatusError extends Error {
  status: number;
  constructor(status: number) { super(`media ${status}`); this.name = 'MediaStatusError'; this.status = status; }
}

/**
 * At most `events` request starts in any `ms` (a sliding window, like Caddy's rate_limit zones), of which at most
 * `background` (default: all) for loads nobody explicitly asked to see: the rest is kept for `explicit` ones.
 */
export interface RateWindow { events: number; ms: number; background?: number }

export interface QueueOptions {
  /** Requests in flight at once. */
  concurrency: number;
  /** The start rate to stay under for one kind of media (`mediaKind`), read before every start; null: none. */
  window: (kind: MediaKind) => RateWindow | null;
  /** 429 answers retried per request before it fails. */
  retries?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

interface Job {
  url: string; kind: MediaKind; high: boolean; explicit: boolean; tries: number; signal?: AbortSignal; onStart?: () => void;
  resolve: (b: Blob) => void; reject: (e: unknown) => void;
}

/** Wait after a 429: Retry-After (seconds or an HTTP date), else 1, 2, 4… s; within 0.5–60 s. */
export function retryDelay(header: string | null, now: number, tries: number) {
  let ms = NaN;
  if (header != null && header.trim() !== '') ms = /^\d+$/.test(header.trim()) ? Number(header) * 1000 : Date.parse(header) - now;
  if (!Number.isFinite(ms)) ms = 1000 * 2 ** (tries - 1);
  return Math.min(60_000, Math.max(500, ms));
}

/** Queue order: explicit loads, then high ones, then the rest; first come first served within each. */
const rank = (j: Job) => (j.explicit ? 2 : j.high ? 1 : 0);

/**
 * Thumbnail and preview loads: at most `concurrency` in flight, request starts kept under each kind's `window` (part
 * of it reserved for explicit loads: the photo the visitor opened, the card resting on a photo, so they never wait
 * behind grid or preload starts). The kinds are limited apart, as the proxy does: previews waiting for their window
 * don't hold up thumbnails, nor the other way round. A 429 pauses that kind's loads (Retry-After) and retries the
 * request first. `load` resolves with the body; an `AbortSignal`
 * drops a request still waiting, or cancels it in flight (a photo scrolled past, a lightbox stepped on).
 */
export class MediaQueue {
  private opts: Required<QueueOptions>;
  private queue: Job[] = [];
  private active = 0;
  /** Per kind: starts inside the current window, oldest first (`bg`: not an explicit load). */
  private starts: Record<MediaKind, {t: number; bg: boolean}[]> = {thumbnail: [], preview: []};
  private pausedUntil: Record<MediaKind, number> = {thumbnail: 0, preview: 0};
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(opts: QueueOptions) {
    this.opts = {retries: 3, fetch: (...a) => fetch(...a), now: () => Date.now(), ...opts};
  }

  /** Requests waiting / in flight (for tests and diagnostics). */
  get pending() { return {queued: this.queue.length, active: this.active}; }

  /**
   * `high`: ahead of everything waiting but explicit loads (on-screen cells before overscan, a card's photo).
   * `explicit`: the visitor asked to see this one now (the lightbox's photo on show, the card resting on a photo):
   * first in line, and it may use the window's reserve. `onStart`: its request was sent (counted against the window),
   * once.
   */
  load(url: string, {signal, high = false, explicit = false, onStart}: {signal?: AbortSignal; high?: boolean; explicit?: boolean; onStart?: () => void} = {}): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(signal.reason); return; }
      const onAbort = () => {
        const i = this.queue.indexOf(job);
        if (i >= 0) { this.queue.splice(i, 1); reject(signal!.reason); }
      };
      const done = () => signal?.removeEventListener('abort', onAbort);
      const job: Job = {
        url, kind: mediaKind(url), high: high || explicit, explicit, tries: 0, signal, onStart,
        resolve: b => { done(); resolve(b); },
        reject: e => { done(); reject(e); },
      };
      signal?.addEventListener('abort', onAbort);
      const i = this.queue.findIndex(j => rank(j) < rank(job));
      this.queue.splice(i < 0 ? this.queue.length : i, 0, job);
      this.pump();
    });
  }

  /**
   * Moves the waiting request `signal` belongs to first in line among the high ones (an on-screen cell asked for as
   * overscan), or with `explicit` makes it explicit and first of all (a preloaded neighbour that became the photo on
   * show, a card's photo the cursor came to rest on: the most urgent thing there is). Nothing for one already in
   * flight or done.
   */
  prioritize(signal: AbortSignal, explicit = false) {
    const i = this.queue.findIndex(j => j.signal === signal);
    if (i < 0) return;
    const [job] = this.queue.splice(i, 1);
    job.high = true;
    job.explicit ||= explicit;
    const k = this.queue.findIndex(j => rank(j) <= rank(job));
    this.queue.splice(k < 0 ? this.queue.length : k, 0, job);
    this.pump();
  }

  private wake(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; this.pump(); }, Math.max(0, ms));
  }

  /**
   * When a load of `kind` could start (`explicit`: one that may use the reserve): 0 now, else the time it may.
   * Drops the starts that left the window.
   */
  private freeAt(kind: MediaKind, explicit: boolean, t: number): number {
    if (t < this.pausedUntil[kind]) return this.pausedUntil[kind];
    const w = this.opts.window(kind);
    if (!w) return 0;
    const starts = this.starts[kind];
    while (starts.length && starts[0].t <= t - w.ms) starts.shift();
    if (starts.length >= w.events) return starts[0].t + w.ms;
    if (explicit) return 0;
    // The background share is spent: only an explicit load may start, else wait for a background start to age out.
    const bg = starts.filter(s => s.bg);
    return bg.length >= (w.background ?? w.events) ? bg[0].t + w.ms : 0;
  }

  private pump() {
    const {concurrency, now} = this.opts;
    while (this.active < concurrency && this.queue.length) {
      const t = now();
      // The first job in queue order whose kind may start one now; a blocked kind doesn't hold up the other.
      const free = new Map<string, number>();
      let i = -1, next = Infinity;
      for (let k = 0; k < this.queue.length; k++) {
        const j = this.queue[k], key = `${j.kind}:${j.explicit}`;
        let at = free.get(key);
        if (at === undefined) free.set(key, at = this.freeAt(j.kind, j.explicit, t));
        if (at === 0) { i = k; break; }
        next = Math.min(next, at);
        if (free.size === 4) break; // every kind and class blocked: nothing further can start
      }
      if (i < 0) { this.wake(next - t); return; }
      const job = this.queue.splice(i, 1)[0];
      if (this.opts.window(job.kind)) this.starts[job.kind].push({t, bg: !job.explicit});
      void this.run(job);
    }
  }

  private async run(job: Job) {
    this.active++;
    if (job.tries === 0) job.onStart?.();
    try {
      const res = await this.opts.fetch(job.url, {signal: job.signal});
      if (res.status === 429) {
        // Every 429 pauses this kind's loads, the last try's too: the next one would only be refused as well.
        const t = this.opts.now();
        this.pausedUntil[job.kind] = Math.max(this.pausedUntil[job.kind], t + retryDelay(res.headers.get('retry-after'), t, job.tries + 1));
        if (job.tries < this.opts.retries) {
          void res.body?.cancel();
          job.tries++;
          // First in line again, unless it was given up on meanwhile.
          if (job.signal?.aborted) job.reject(job.signal.reason); else this.queue.unshift(job);
          return;
        }
      }
      if (!res.ok) { void res.body?.cancel(); throw new MediaStatusError(res.status); }
      job.resolve(await res.blob());
    } catch (e) {
      job.reject(e);
    } finally {
      this.active--;
      this.pump();
    }
  }
}

/**
 * The demo's media rate limits per visitor (Caddy `(public_site)`, docs/demo-hardening.md), each kind its own:
 * - thumbnails 240 per 20 s: 200 leaves room for the `<img>` thumbnails that don't queue (trip covers, the card's
 *   first photo) and the failure probes. Grid cells and Play's card prefetches share 180; 20 are kept for explicit
 *   loads (the card at rest).
 * - previews and video 60 per 20 s: 50 leaves room for video and the failure probes, which don't queue. Preloaded
 *   neighbours share 35; the other 15 are kept for explicit loads (the lightbox's photo on show).
 */
export const DEMO_MEDIA_WINDOWS: Record<MediaKind, RateWindow> = {
  thumbnail: {events: 200, ms: 20_000, background: 180},
  preview: {events: 50, ms: 20_000, background: 35},
};

/** The app's queue: 6 in flight (a browser's HTTP/1.1 limit per host), the demo's rates on the demo only. */
export const mediaQueue = new MediaQueue({concurrency: 6, window: kind => (config.demo ? DEMO_MEDIA_WINDOWS[kind] : null)});

/** One preview held by a PreviewSet: its object URL once loaded, or why it couldn't be. */
export interface HeldPreview { src: string | null; error: unknown }

/**
 * The previews a pager keeps (the touch lightbox: the photo on show and its neighbours). They load through the queue
 * into object URLs, so the <img> showing one makes no request of its own. `keep` names the wanted URLs, the one on
 * show first (loaded ahead of everything waiting). One still wanted keeps its request, in flight or done: a neighbour
 * that becomes the photo on show is not asked for again. The rest are aborted and their URLs revoked, so at most as
 * many as `keep` was last given are ever held (decoded previews are what iOS kills a tab for).
 */
export class PreviewSet {
  private held = new Map<string, HeldPreview & {ctrl: AbortController}>();
  private wanted: string[] = [];
  private queue: Pick<MediaQueue, 'load' | 'prioritize'>;
  private changed: () => void;
  private urls: {create: (b: Blob) => string; revoke: (u: string) => void};

  /** `changed`: a preview loaded or failed (read `get` again). */
  constructor(queue: Pick<MediaQueue, 'load' | 'prioritize'>, changed: () => void,
    urls = {create: (b: Blob) => URL.createObjectURL(b), revoke: (u: string) => URL.revokeObjectURL(u)}) {
    this.queue = queue; this.changed = changed; this.urls = urls;
  }

  keep(want: string[]) {
    this.wanted = want;
    const set = new Set(want);
    for (const [u, h] of this.held) if (!set.has(u)) this.drop(u, h);
    want.forEach((u, i) => {
      const had = this.held.get(u);
      if (had) { if (i === 0 && had.src == null && had.error == null) this.queue.prioritize(had.ctrl.signal, true); return; }
      const h: HeldPreview & {ctrl: AbortController} = {src: null, error: null, ctrl: new AbortController()};
      this.held.set(u, h);
      this.queue.load(u, {signal: h.ctrl.signal, explicit: i === 0}).then(b => {
        if (this.held.get(u) !== h) return;
        h.src = this.urls.create(b);
        this.changed();
      }, e => {
        if (this.held.get(u) !== h || h.ctrl.signal.aborted) return;
        h.error = e ?? new Error('failed');
        this.changed();
      });
    });
  }

  get(url: string): HeldPreview | null {
    const h = this.held.get(url);
    return h ? {src: h.src, error: h.error} : null;
  }

  /** Loads `url` again (after a failed request, or bytes that wouldn't decode). */
  retry(url: string) {
    const h = this.held.get(url);
    if (!h) return;
    this.drop(url, h);
    this.keep(this.wanted);
  }

  /** How many are held (tests). */
  get size() { return this.held.size; }

  dispose() { this.wanted = []; for (const [u, h] of this.held) this.drop(u, h); }

  private drop(u: string, h: HeldPreview & {ctrl: AbortController}) {
    h.ctrl.abort();
    if (h.src) this.urls.revoke(h.src);
    this.held.delete(u);
  }
}
