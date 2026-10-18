// The Photos grid's thumbnails: loaded through the media queue (rate-limited in the demo) into object URLs, so a cell's
// <img> makes no request of its own.
import type {MediaQueue} from '../lightbox/media.ts';

interface Held { src: string | null; failed: boolean; ctrl: AbortController }

/**
 * Thumbnails a virtual grid wants. `want` names the cells rendered now, the ones on screen first: those not held are
 * requested (the on-screen ones ahead of everything waiting), a waiting or in-flight request no longer wanted (a
 * cell scrolled far away) is cancelled. Loaded thumbnails stay as object URLs, least recently wanted dropped first
 * beyond `max`, so scrolling back doesn't spend the demo's request budget again; the decoded images are only those
 * of the rendered cells. A failed load is kept while wanted (no retry loop) and tried again once it scrolled away.
 */
export class ThumbSet {
  /** Insertion order is recency: a wanted entry is moved to the end. */
  private held = new Map<string, Held>();
  private wanted = new Set<string>();
  private queue: Pick<MediaQueue, 'load' | 'prioritize'>;
  private changed: () => void;
  private max: number;
  private urls: {create: (b: Blob) => string; revoke: (u: string) => void};

  /** `changed`: a thumbnail loaded or failed (read `get` again). */
  constructor(queue: Pick<MediaQueue, 'load' | 'prioritize'>, changed: () => void, max = 180,
    urls = {create: (b: Blob) => URL.createObjectURL(b), revoke: (u: string) => URL.revokeObjectURL(u)}) {
    this.queue = queue; this.changed = changed; this.max = max; this.urls = urls;
  }

  /** `list`: the URLs to hold, the first `urgent` of them on screen. */
  want(list: string[], urgent = list.length) {
    const set = this.wanted = new Set(list);
    for (const [u, h] of this.held) if (!set.has(u) && h.src == null && !h.failed) this.drop(u, h);
    list.forEach((u, i) => {
      const had = this.held.get(u);
      if (had) { this.held.delete(u); this.held.set(u, had); return; }
      const h: Held = {src: null, failed: false, ctrl: new AbortController()};
      this.held.set(u, h);
      this.queue.load(u, {signal: h.ctrl.signal, high: i < urgent}).then(b => {
        if (this.held.get(u) !== h) return;
        h.src = this.urls.create(b);
        this.changed();
        this.trim(this.wanted);
      }, () => {
        if (this.held.get(u) !== h || h.ctrl.signal.aborted) return;
        h.failed = true;
        this.changed();
      });
    });
    // On-screen cells still waiting behind the rest (they were overscan when asked for): first in line, in order.
    for (let i = Math.min(urgent, list.length) - 1; i >= 0; i--) {
      const h = this.held.get(list[i]);
      if (h && h.src == null && !h.failed) this.queue.prioritize(h.ctrl.signal);
    }
    // Failed ones out of sight are forgotten, so they are tried again when scrolled back to.
    for (const [u, h] of this.held) if (h.failed && !set.has(u)) this.drop(u, h);
    this.trim(set);
  }

  /**
   * Cancels the waiting and in-flight requests not in `list`, starting nothing (while the rows are still moving, or
   * the grid is out of sight: pass []). Loaded thumbnails stay.
   */
  prune(list: string[]) {
    const set = new Set(list);
    for (const [u, h] of this.held) if (!set.has(u) && h.src == null && !h.failed) this.drop(u, h);
  }

  /** The object URL of a loaded thumbnail, else null. */
  get(url: string) { return this.held.get(url)?.src ?? null; }

  /** How many are held, loaded or not (tests). */
  get size() { return this.held.size; }

  dispose() { this.wanted = new Set(); for (const [u, h] of this.held) this.drop(u, h); }

  /** Drops the least recently wanted loaded thumbnails beyond `max`, never one in `keep`. */
  private trim(keep: Set<string>) {
    let over = this.held.size - this.max;
    for (const [u, h] of this.held) {
      if (over <= 0) break;
      if (h.src != null && !keep.has(u)) { this.drop(u, h); over--; }
    }
  }

  private drop(u: string, h: Held) {
    h.ctrl.abort();
    if (h.src) this.urls.revoke(h.src);
    this.held.delete(u);
  }
}
