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

/** Playback URL (Range supported). Immich serves the transcode, or the original when there is none. */
export const videoUrl = (id: string) => `/api/assets/${id}/video`;

/** The asset in Immich's web UI; null without a configured public URL. */
export function immichLink(base: string | null | undefined, id: string) {
  return base ? `${base.replace(/\/+$/, '')}/photos/${id}` : null;
}

/** A media request answered with an error status (after the queue's own 429 retries). */
export class MediaStatusError extends Error {
  status: number;
  constructor(status: number) { super(`media ${status}`); this.name = 'MediaStatusError'; this.status = status; }
}

/** At most `events` request starts in any `ms` (a sliding window, like Caddy's rate_limit zones). */
export interface RateWindow { events: number; ms: number }

export interface QueueOptions {
  /** Requests in flight at once. */
  concurrency: number;
  /** The start rate to stay under, read before every start; null: none. */
  window: () => RateWindow | null;
  /** 429 answers retried per request before it fails. */
  retries?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

interface Job {
  url: string; high: boolean; tries: number; signal?: AbortSignal;
  resolve: (b: Blob) => void; reject: (e: unknown) => void;
}

/** Wait after a 429: Retry-After (seconds or an HTTP date), else 1, 2, 4… s; within 0.5–60 s. */
export function retryDelay(header: string | null, now: number, tries: number) {
  let ms = NaN;
  if (header != null && header.trim() !== '') ms = /^\d+$/.test(header.trim()) ? Number(header) * 1000 : Date.parse(header) - now;
  if (!Number.isFinite(ms)) ms = 1000 * 2 ** (tries - 1);
  return Math.min(60_000, Math.max(500, ms));
}

/**
 * Thumbnail and preview loads: at most `concurrency` in flight, request starts kept under `window`, a 429 pauses
 * the whole queue (Retry-After) and retries the request first. `load` resolves with the body; an `AbortSignal`
 * drops a request still waiting, or cancels it in flight (a photo scrolled past, a lightbox stepped on).
 */
export class MediaQueue {
  private opts: Required<QueueOptions>;
  private queue: Job[] = [];
  private active = 0;
  /** Start times inside the current window, oldest first. */
  private starts: number[] = [];
  private pausedUntil = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(opts: QueueOptions) {
    this.opts = {retries: 3, fetch: (...a) => fetch(...a), now: () => Date.now(), ...opts};
  }

  /** Requests waiting / in flight (for tests and diagnostics). */
  get pending() { return {queued: this.queue.length, active: this.active}; }

  /** `high`: ahead of everything waiting (the photo on show, before its neighbours). */
  load(url: string, {signal, high = false}: {signal?: AbortSignal; high?: boolean} = {}): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(signal.reason); return; }
      const onAbort = () => {
        const i = this.queue.indexOf(job);
        if (i >= 0) { this.queue.splice(i, 1); reject(signal!.reason); }
      };
      const done = () => signal?.removeEventListener('abort', onAbort);
      const job: Job = {
        url, high, tries: 0, signal,
        resolve: b => { done(); resolve(b); },
        reject: e => { done(); reject(e); },
      };
      signal?.addEventListener('abort', onAbort);
      const i = high ? this.queue.findIndex(j => !j.high) : -1;
      this.queue.splice(i < 0 ? this.queue.length : i, 0, job);
      this.pump();
    });
  }

  private wake(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; this.pump(); }, Math.max(0, ms));
  }

  private pump() {
    const {concurrency, window, now} = this.opts;
    while (this.active < concurrency && this.queue.length) {
      const t = now();
      if (t < this.pausedUntil) { this.wake(this.pausedUntil - t); return; }
      const w = window();
      if (w) {
        while (this.starts.length && this.starts[0] <= t - w.ms) this.starts.shift();
        if (this.starts.length >= w.events) { this.wake(this.starts[0] + w.ms - t); return; }
        this.starts.push(t);
      }
      void this.run(this.queue.shift()!);
    }
  }

  private async run(job: Job) {
    this.active++;
    try {
      const res = await this.opts.fetch(job.url, {signal: job.signal});
      if (res.status === 429) {
        // Every 429 pauses the whole queue, the last try's too: the next request would only be refused as well.
        const t = this.opts.now();
        this.pausedUntil = Math.max(this.pausedUntil, t + retryDelay(res.headers.get('retry-after'), t, job.tries + 1));
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
 * The demo's media rate limit is 60 requests per 20 s per visitor (Caddy `(public_site)`, docs/demo-hardening.md);
 * 50 leaves room for video and the failure probes, which don't queue.
 */
export const DEMO_MEDIA_WINDOW: RateWindow = {events: 50, ms: 20_000};

/** The app's queue: 6 in flight (a browser's HTTP/1.1 limit per host), the demo's rate on the demo only. */
export const mediaQueue = new MediaQueue({concurrency: 6, window: () => (config.demo ? DEMO_MEDIA_WINDOW : null)});
