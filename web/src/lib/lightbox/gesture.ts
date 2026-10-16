// Touch lightbox gestures without the DOM: zoom and pan math, how a one-finger drag is read (page, close or
// nothing), where a release lands, and double-tap detection. Positions are CSS px; a View's x/y and focal
// points are measured from the stage's centre.

export interface Size { w: number; h: number }
export interface Point { x: number; y: number }
/** Zoom `s` (1 = fitted) and the image centre's offset from the stage centre. */
export interface View { s: number; x: number; y: number }

export const FIT: View = {s: 1, x: 0, y: 0};
/** Pinch stops here: the preview (1440 px, 1280 on the demo) gets soft beyond ~3×, and originals are never loaded. */
export const MAX_ZOOM = 3;
/** A double tap zooms to this. */
export const TAP_ZOOM = 2.5;
/** Movement before a drag is read as one (below it, a tap). */
export const SLOP = 10;
/** A horizontal drag starting this close to a screen side is the OS's back/forward swipe, not paging. */
export const EDGE = 24;
/** A second tap this soon and this close to the first is a double tap. */
export const DOUBLE_MS = 300, DOUBLE_PX = 30;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The asset's box fitted (contain) into the stage, rounded to whole px. `ratio` = width / height. */
export function fit(stage: Size, ratio: number): Size {
  if (!(ratio > 0)) ratio = 1.5;
  let w = stage.w, h = w / ratio;
  if (h > stage.h) { h = stage.h; w = h * ratio; }
  return {w: Math.round(w), h: Math.round(h)};
}

/**
 * Zoom within 1..MAX_ZOOM, and an offset that keeps a zoomed image covering the stage along every axis it overflows
 * (centred along one it doesn't fill). `img` is the fitted box at zoom 1.
 */
export function clampView(v: View, img: Size, stage: Size): View {
  const s = clamp(v.s, 1, MAX_ZOOM);
  const mx = Math.max(0, (img.w * s - stage.w) / 2), my = Math.max(0, (img.h * s - stage.h) / 2);
  // `|| 0`: no -0 (a centred axis reads as 0).
  return {s, x: clamp(v.x, -mx, mx) || 0, y: clamp(v.y, -my, my) || 0};
}

/** Zoom `v` to `s` about focal point `f`: the image point under `f` stays there. */
export function zoomAbout(v: View, s: number, f: Point): View {
  const k = s / v.s;
  return {s, x: f.x - (f.x - v.x) * k, y: f.y - (f.y - v.y) * k};
}

/**
 * Two fingers: `v0` was the view when they landed, `m0`/`d0` their midpoint and distance then, `m`/`d` now. The image
 * point under the starting midpoint follows the midpoint (pinch and two-finger pan in one).
 */
export function pinchView(v0: View, m0: Point, d0: number, m: Point, d: number): View {
  const s = clamp(v0.s * (d0 > 0 ? d / d0 : 1), 1, MAX_ZOOM), k = s / v0.s;
  return {s, x: m.x - (m0.x - v0.x) * k, y: m.y - (m0.y - v0.y) * k};
}

/** A double tap at `p`: back to fitted when zoomed, else TAP_ZOOM about `p` (clamped, so no empty edge shows). */
export function doubleTapView(v: View, p: Point, img: Size, stage: Size): View {
  if (v.s > 1.01) return FIT;
  return clampView(zoomAbout(v, TAP_ZOOM, p), img, stage);
}

/** Midpoint and distance of two pointers. */
export function span(a: Point, b: Point): {m: Point; d: number} {
  return {m: {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}, d: Math.hypot(a.x - b.x, a.y - b.y)};
}

/**
 * What a one-finger drag at zoom 1 is, once it has moved past SLOP: mostly sideways = paging, mostly down = closing,
 * up = nothing. null while still inside SLOP (could be a tap).
 */
export function classify(dx: number, dy: number, slop = SLOP): 'page' | 'dismiss' | 'none' | null {
  if (Math.hypot(dx, dy) < slop) return null;
  if (Math.abs(dx) > Math.abs(dy)) return 'page';
  return dy > 0 ? 'dismiss' : 'none';
}

/** True when a touch at x would start inside an OS edge-swipe zone of a screen `w` wide. */
export const nearEdge = (x: number, w: number, edge = EDGE) => x < edge || x > w - edge;

/** Drag offset shown while paging: 1:1, with resistance past an end of the range. */
export function rubber(dx: number, canPrev: boolean, canNext: boolean) {
  return (dx > 0 && !canPrev) || (dx < 0 && !canNext) ? dx * 0.3 : dx;
}

/**
 * Where a page drag lands: +1 next (dragged left), -1 previous, 0 back to where it was. A quarter of the width or a
 * flick (≥ 0.35 px/ms in the drag's direction) turns the page; never past an end.
 */
export function pageRelease(dx: number, vx: number, w: number, canPrev: boolean, canNext: boolean): -1 | 0 | 1 {
  const flick = Math.abs(vx) >= 0.35 && Math.sign(vx) === Math.sign(dx);
  if (!flick && Math.abs(dx) < w * 0.25) return 0;
  if (dx < 0) return canNext ? 1 : 0;
  if (dx > 0) return canPrev ? -1 : 0;
  return 0;
}

/** A swipe down closes after 15% of the height, or a downward flick (≥ 0.5 px/ms) past SLOP. */
export const dismissRelease = (dy: number, vy: number, h: number) => dy > h * 0.15 || (vy >= 0.5 && dy > SLOP);

/**
 * After stepping by `d` (+1 next) at drag offset dx, the offset that keeps the new photo where it was on screen:
 * it was one slot (`slot` px) to the side, it is now the centre one. Animate this to 0.
 */
export const afterStep = (dx: number, d: number, slot: number) => dx + d * slot;

export interface Sample { t: number; x: number; y: number }

/** Velocity (px/ms) over the samples of the last `ms`; 0 with fewer than two. */
export function velocity(samples: Sample[], ms = 100): Point {
  const last = samples.at(-1);
  if (!last) return {x: 0, y: 0};
  let first = last;
  for (let i = samples.length - 1; i >= 0 && last.t - samples[i].t <= ms; i--) first = samples[i];
  const dt = last.t - first.t;
  return dt > 0 ? {x: (last.x - first.x) / dt, y: (last.y - first.y) / dt} : {x: 0, y: 0};
}

/**
 * Velocity at a release at time `now`: that of the last `ms` of movement, or 0 when the finger has rested longer
 * than `ms` since it last moved (a drag held still and then lifted is no flick).
 */
export function releaseVelocity(samples: Sample[], now: number, ms = 100): Point {
  const last = samples.at(-1);
  return !last || now - last.t > ms ? {x: 0, y: 0} : velocity(samples, ms);
}

/** Whether tap `cur` completes a double tap with `prev`. */
export const isDoubleTap = (prev: Sample | null, cur: Sample) =>
  !!prev && cur.t - prev.t <= DOUBLE_MS && Math.hypot(cur.x - prev.x, cur.y - prev.y) <= DOUBLE_PX;
