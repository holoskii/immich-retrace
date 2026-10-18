// Play on the phone: the cursor steps photo by photo (dwell times from map/play.ts), on wall-clock deadlines, not
// frames or timer counts: iOS Low Power Mode caps rAF at 30 fps and a late timer must not slow the trip down, while a
// timer far behind (a throttled tab) must not fire a burst of catch-up steps. The shell stops it when the page is
// hidden or the map covered (another tab, the lightbox). Timing is pure (nextDue); the clock and timer are injected.

/**
 * When the next step is due: `dwell` ms after the previous one was due, so a slightly late timer doesn't shift the
 * ones after it; after a stall longer than the dwell (a throttled tab), `dwell` from now, so the photo on show still
 * gets its time (no catch-up burst of zero-delay steps).
 */
export function nextDue(prevDue: number, dwell: number, now: number) {
  const due = prevDue + dwell;
  return due > now ? due : now + dwell;
}

export interface PlayerHost {
  /** How long the photo the cursor is on stays (ms), or null when nothing comes after it (the end). */
  dwell(): number | null;
  /** Moves the cursor to the next photo. */
  advance(): void;
  /** Play started or stopped (`ended`: it ran to the end of the selection). */
  changed(playing: boolean, ended: boolean): void;
  now?: () => number;
  setTimer?: (f: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export class Player {
  playing = false;
  private h: unknown = null;
  private due = 0;
  private host: PlayerHost;
  private now: () => number;
  private setTimer: (f: () => void, ms: number) => unknown;
  private clearTimer: (h: unknown) => void;

  constructor(host: PlayerHost) {
    this.host = host;
    this.now = host.now ?? (() => performance.now());
    this.setTimer = host.setTimer ?? ((f, ms) => setTimeout(f, ms));
    this.clearTimer = host.clearTimer ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** Starts from wherever the cursor is (the caller puts it on the first photo when Play starts over). */
  start() {
    if (this.playing) return;
    this.playing = true;
    this.due = this.now();
    this.host.changed(true, false);
    this.schedule();
  }

  stop(ended = false) {
    if (this.h != null) this.clearTimer(this.h);
    this.h = null;
    if (!this.playing) return;
    this.playing = false;
    this.host.changed(false, ended);
  }

  private schedule() {
    const d = this.host.dwell();
    if (d == null) { this.stop(true); return; }
    const now = this.now();
    this.due = nextDue(this.due, d, now);
    this.h = this.setTimer(() => {
      this.h = null;
      if (!this.playing) return;
      this.host.advance();
      this.schedule();
    }, this.due - now);
  }
}
