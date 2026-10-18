// Drives the MapLibre camera along the precomputed track (camera.ts) with critically damped
// springs, one `jumpTo` per animation frame, and moves the position marker on its own faster
// spring. The loop runs only while something moves and stops once settled.
import type {Map as MlMap} from 'maplibre-gl';
import {farZoomCap, insetShift, latOf, lonOf, mercX, mercY, spring, TILE, trackAt, uniformInsets, unitsPerKm, zoomFor, CAMERA, type Insets, type Track} from './camera.ts';

/** follow: the camera follows the cursor along the track; whole: the whole selection; manual: hands off. */
export type CamMode = 'follow' | 'whole' | 'manual';
export type XY = {x: number; y: number};
export type View = {x: number; y: number; z: number};

/**
 * The camera control (a Follow toggle + Fit). `mode` drives the Follower; `auto` is what a new selection
 * starts in: the toggle's last explicit state (on → follow, off or Fit → frame the whole selection).
 * A pan or zoom on the map only pauses (manual) and keeps `auto`, so the next selection follows again.
 * The demo landing (`land`) frames its trip whole with Follow still the automatic mode: the first ▶ or scrub
 * (`play`) turns Follow on and flies in. Only from that state: after an explicit Fit, `play` changes nothing.
 */
export interface CamState { mode: CamMode; auto: 'follow' | 'whole' }
export type CamEvent = 'follow' | 'unfollow' | 'fit' | 'pan' | 'select' | 'land' | 'play';

export function camNext(s: CamState, ev: CamEvent): CamState {
  switch (ev) {
    case 'follow': return {mode: 'follow', auto: 'follow'};
    // Off leaves the map where it is; the next selection is framed whole rather than followed.
    case 'unfollow': return {mode: 'manual', auto: 'whole'};
    case 'fit': return {mode: 'whole', auto: 'whole'};
    case 'pan': return s.mode === 'manual' ? s : {mode: 'manual', auto: s.auto};
    case 'select': return {mode: s.auto, auto: s.auto};
    case 'land': return {mode: 'whole', auto: 'follow'};
    case 'play': return s.mode === 'whole' && s.auto === 'follow' ? {mode: 'follow', auto: 'follow'} : s;
  }
}

export const FOLLOW = {
  /** Spring stiffness (ω, 1/s): pan, zoom (log2 scale), marker. */
  pan: 5, zoom: 3.5, marker: 14,
  /** Viewport padding (px) around the target frame, following / whole selection (the default insets). */
  pad: 70, wholePad: 60,
  minZoom: 1, maxZoom: 17,
  /** A cursor jump larger than this that doesn't come from scrubbing the strip snaps instead of flying. */
  seekMs: 3 * 3600e3,
};

export class Follower {
  mode: CamMode = 'follow';
  track: Track | null = null;
  /** Bounding box of the selection's GPS, world units [x0, y0, x1, y1]. */
  box: [number, number, number, number] | null = null;
  cursor: number | null = null;
  /** Where the marker should be (the route position at the cursor), world units. */
  pos: XY | null = null;
  reduced = false;
  /** Pointer held on the map: no jumpTo now, it would reset the gesture that may be starting. */
  held = false;
  /** The map can't draw (its WebGL context is lost): no frames until this is cleared and the loop kicked again. */
  stopped = false;
  /** Marker position as drawn (spring state). */
  mk: XY | null = null;
  /** Where the camera is heading (the map's center and zoom there, for the inset), or null when hands off. */
  goal: View | null = null;
  /** Space kept clear around the frame while following / framing the whole selection (camera.ts Insets). */
  insets: Insets = uniformInsets(FOLLOW.pad);
  wholeInsets: Insets = uniformInsets(FOLLOW.wholePad);

  /** The frame's center and zoom (the center of the area the insets leave, not the map's), spring state. */
  private cam: View | null = null;
  /** The insets of the current target. */
  private ins: Insets = this.insets;
  private vel = {x: 0, y: 0, z: 0};
  private mkv = {x: 0, y: 0};
  private raf = 0;
  private last = 0;
  private snapNext = false;
  private map: MlMap;
  private onFrame: () => void;
  private setMarker: (lon: number, lat: number) => void;

  constructor(map: MlMap, onFrame: () => void, setMarker: (lon: number, lat: number) => void) {
    this.map = map; this.onFrame = onFrame; this.setMarker = setMarker;
  }

  /** Something changed: run the loop until settled. */
  kick() { if (!this.raf) this.raf = requestAnimationFrame(this.step); }
  /** Jump straight to the target on the next frame (seek, new selection, tab resume). */
  snap() { this.snapNext = true; this.kick(); }
  /** Forget the camera state: the next frame starts from wherever the map is now. */
  release() { this.cam = null; this.vel = {x: 0, y: 0, z: 0}; }
  dispose() { cancelAnimationFrame(this.raf); this.raf = 0; }

  /** Follow mode with something to follow: the marker gets its spring then. */
  get following() { return this.mode === 'follow' && this.cursor != null && this.track != null; }

  private target(w: number, h: number): View | null {
    if (this.mode === 'manual') return null;
    let v: View | null = null;
    if (this.following) {
      const T = trackAt(this.track!, this.cursor!);
      this.ins = this.insets;
      v = {x: T.x, y: T.y, z: zoomFor(T.hx, T.hy, w, h, this.ins)};
    } else if (this.box) {
      const [x0, y0, x1, y1] = this.box, y = (y0 + y1) / 2, floor = CAMERA.minHalfKm * unitsPerKm(y);
      this.ins = this.wholeInsets;
      v = {x: (x0 + x1) / 2, y, z: zoomFor(Math.max((x1 - x0) / 2, floor), Math.max((y1 - y0) / 2, floor), w, h, this.ins)};
    }
    if (v) v.z = Math.min(FOLLOW.maxZoom, Math.max(FOLLOW.minZoom, v.z));
    return v;
  }

  private step = (now: number) => {
    this.raf = 0;
    const m = this.map, c = m.getContainer(), w = c.clientWidth, h = c.clientHeight;
    if (!w || !h || this.stopped) return;
    const dt = this.last ? Math.min(1 / 30, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    const snap = this.snapNext || this.reduced;
    this.snapNext = false;
    let settled = true;

    const tg = this.target(w, h), ins = this.ins;
    if (tg) { const g = insetShift(ins, tg.z); this.goal = {x: tg.x + g.dx, y: tg.y + g.dy, z: tg.z}; } else this.goal = null;
    if (tg && !this.held) {
      if (!this.cam) {
        const ctr = m.getCenter(), z = m.getZoom(), g = insetShift(ins, z);
        this.cam = {x: mercX(ctr.lng) - g.dx, y: mercY(ctr.lat) - g.dy, z};
        this.vel = {x: 0, y: 0, z: 0};
      }
      const cam = this.cam, V = this.vel;
      let z = tg.z;
      if (snap) {
        cam.x = tg.x; cam.y = tg.y; cam.z = z;
        V.x = V.y = V.z = 0;
      } else {
        // Far from the target: pull back so it stays within reach (flyTo-like), then zoom in on arrival.
        z = Math.min(z, Math.max(FOLLOW.minZoom, farZoomCap(tg.x - cam.x, tg.y - cam.y, w, h)));
        [cam.x, V.x] = spring(cam.x, V.x, tg.x, FOLLOW.pan, dt);
        [cam.y, V.y] = spring(cam.y, V.y, tg.y, FOLLOW.pan, dt);
        [cam.z, V.z] = spring(cam.z, V.z, z, FOLLOW.zoom, dt);
      }
      const g = insetShift(ins, cam.z);
      m.jumpTo({center: [lonOf(cam.x + g.dx), latOf(cam.y + g.dy)], zoom: cam.z});
      const px = TILE * 2 ** cam.z;
      settled = Math.hypot(tg.x - cam.x, tg.y - cam.y) * px < 0.3 && Math.abs(cam.z - z) < 0.002
        && Math.hypot(V.x, V.y) * px < 1 && Math.abs(V.z) < 0.01;
      if (settled) this.cam = null; // the next run starts from the map again (it may be moved meanwhile)
    } else {
      this.cam = null;
    }

    if (this.pos) {
      const p = this.pos;
      if (!this.mk || snap || !this.following) {
        this.mk = {x: p.x, y: p.y}; this.mkv = {x: 0, y: 0};
      } else {
        [this.mk.x, this.mkv.x] = spring(this.mk.x, this.mkv.x, p.x, FOLLOW.marker, dt);
        [this.mk.y, this.mkv.y] = spring(this.mk.y, this.mkv.y, p.y, FOLLOW.marker, dt);
        const px = TILE * 2 ** m.getZoom();
        if (Math.hypot(this.mk.x - p.x, this.mk.y - p.y) * px >= 0.3 || Math.hypot(this.mkv.x, this.mkv.y) * px >= 1) settled = false;
        else { this.mk.x = p.x; this.mk.y = p.y; }
      }
      this.setMarker(lonOf(this.mk.x), latOf(this.mk.y));
    } else {
      this.mk = null;
    }

    this.onFrame();
    if (!settled && !document.hidden) this.raf = requestAnimationFrame(this.step);
    else this.last = 0;
  };
}
