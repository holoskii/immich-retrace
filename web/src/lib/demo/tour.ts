// The demo's 3-step coach mark (pure): the steps, where the bubble goes, and "seen once" in localStorage (also the
// phone's pitch line).

export interface TourStep {
  /** CSS selector of what the step points at; when it isn't on screen the bubble sits in the middle. */
  target: string;
  title: string;
  text: string;
}

export const TOUR: TourStep[] = [
  {target: 'canvas.main', title: 'The timeline',
    text: 'Every bar is a day of photos. Drag across it to pick any dates; the coloured bars under it are albums.'},
  {target: '.strip .track', title: 'Travel through time',
    text: 'Drag along this strip, or press Play: the map follows the route the photos left behind.'},
  {target: '.marker .card', title: 'The photo at that moment',
    text: 'The photo nearest the time cursor, where it was taken. Click it to open the photo with its place and credits.'},
];

export interface Box { x: number; y: number; w: number; h: number }

/**
 * Where the bubble (size `b`) goes for a target box `t` in a viewport `vw` × `vh`: below the target when it
 * fits, else above, else over the target's middle; centred on it horizontally and kept `m` px inside the
 * viewport. `arrow`: x of the pointer within the bubble, or null when the bubble doesn't sit next to the target.
 * No target: the middle of the viewport.
 */
export function placeBubble(t: Box | null, b: {w: number; h: number}, vw: number, vh: number, m = 12, gap = 12) {
  const clampX = (x: number) => Math.max(m, Math.min(vw - m - b.w, x));
  if (!t) return {x: clampX((vw - b.w) / 2), y: Math.max(m, (vh - b.h) / 2), side: 'none' as const, arrow: null};
  const x = clampX(t.x + t.w / 2 - b.w / 2);
  const arrow = Math.max(14, Math.min(b.w - 14, t.x + t.w / 2 - x));
  if (t.y + t.h + gap + b.h <= vh - m) return {x, y: t.y + t.h + gap, side: 'below' as const, arrow};
  if (t.y - gap - b.h >= m) return {x, y: t.y - gap - b.h, side: 'above' as const, arrow};
  return {x, y: Math.max(m, Math.min(vh - m - b.h, t.y + t.h / 2 - b.h / 2)), side: 'over' as const, arrow: null};
}

export const TOUR_KEY = 'immich-retrace.demo.tour-seen';

type Store = Pick<Storage, 'getItem' | 'setItem'>;
/** localStorage, or null where touching it throws (blocked storage, sandboxed frames). */
function local(): Store | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** Whether this visitor has seen (finished, dismissed) what `key` names. Unreadable storage counts as not seen. */
export function seenFlag(key: string, store: Store | null = local()): boolean {
  try { return store?.getItem(key) === '1'; } catch { return false; }
}

export function markSeen(key: string, store: Store | null = local()) {
  try { store?.setItem(key, '1'); } catch { /* private mode or full: it may show again */ }
}

/** Whether this visitor has finished or skipped the tour. */
export const tourSeen = (store: Store | null = local()) => seenFlag(TOUR_KEY, store);
export const markTourSeen = (store: Store | null = local()) => markSeen(TOUR_KEY, store);

/** The phone demo's one-line pitch over the map (Pitch.svelte): gone for good after the first ▶ or its ✕. */
export const PITCH_KEY = 'immich-retrace.demo.pitch-seen';
