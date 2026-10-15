// Play: the time cursor steps from photo to photo through the selection, and the map (Follow) flies
// along. Started from the button by the time strip or with Space; never on its own. The timing is
// here (pure); TimeStrip.svelte runs the timer.
import type {IndexColumns} from '../index/model.ts';
import {stepRow} from './route.ts';

export const PLAY = {
  /**
   * How long a photo stays before the next one (ms), by how much later that one was taken: a burst
   * (within `burstGap`) goes quickly, an ordinary step less so, and a jump of `jumpGap` or more (a drive,
   * a night) gets time for the camera's flight.
   */
  burstMs: 350, photoMs: 900, jumpMs: 1800,
  burstGap: 90e3, jumpGap: 3 * 3600e3,
  /** prefers-reduced-motion: the camera jumps instead of flying, and every photo stays this long. */
  reducedMs: 2500,
};

/** Dwell on the current photo when the next one comes `gapMs` later. */
export function playDelay(gapMs: number, reduced: boolean) {
  if (reduced) return PLAY.reducedMs;
  return gapMs <= PLAY.burstGap ? PLAY.burstMs : gapMs >= PLAY.jumpGap ? PLAY.jumpMs : PLAY.photoMs;
}

/**
 * Where Play starts in rows lo..hi-1: the row to put the cursor on first, the first one when there is no cursor
 * or nothing comes after it (`cur`: the row it is on, see cursorRow) and Play starts again; -1 to go on from the
 * cursor; null for an empty range.
 */
export function playStart(ix: IndexColumns, lo: number, hi: number, cursor: number | null, cur: number): number | null {
  if (hi <= lo) return null;
  return cursor == null || stepRow(ix, lo, hi, cursor, cur, 1) < 0 ? lo : -1;
}

/** Whether a Space keydown toggles Play: not typed into a field, not on a control Space activates, no modifiers. */
export function isPlayKey(e: {key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; defaultPrevented: boolean; repeat?: boolean; target: EventTarget | null}) {
  if (e.key !== ' ' || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented || e.repeat) return false;
  const t = e.target as {closest?: (s: string) => unknown} | null;
  return !t?.closest?.('input, textarea, select, button, a, video, summary, dialog, [contenteditable], [role="button"], [role="menuitem"], [role="option"]');
}
