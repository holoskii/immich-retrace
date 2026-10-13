// Whole-trip inset: the selection's route in a small canvas (pre-rendered once per selection and
// size), with the current view, where the camera is heading and the position drawn per frame.
import type {IndexColumns} from '../index/model.ts';
import {CAMERA, mercX, mercY, unitsPerKm} from './camera.ts';
import type {Route} from './route.ts';
import type {View, XY} from './follow.ts';

const PAD = 8;

export class Inset {
  private cv: HTMLCanvasElement;
  private base: HTMLCanvasElement | null = null;
  /** World units → inset px: px = (x - ox) * k + PAD … */
  private ox = 0; private oy = 0; private k = 1; private dx = 0; private dy = 0;
  private w = 0; private h = 0; private dpr = 1;

  constructor(cv: HTMLCanvasElement) { this.cv = cv; }

  /** Pre-renders the route for a canvas of w × h CSS px. */
  setRoute(ix: IndexColumns, route: Route, box: [number, number, number, number], w: number, h: number) {
    this.w = w; this.h = h; this.dpr = devicePixelRatio || 1;
    let [x0, y0, x1, y1] = box;
    const cy = (y0 + y1) / 2, floor = 2 * CAMERA.minHalfKm * unitsPerKm(cy);
    if (x1 - x0 < floor) { const c = (x0 + x1) / 2; x0 = c - floor / 2; x1 = c + floor / 2; }
    if (y1 - y0 < floor) { y0 = cy - floor / 2; y1 = cy + floor / 2; }
    this.k = Math.min((w - 2 * PAD) / (x1 - x0), (h - 2 * PAD) / (y1 - y0));
    this.ox = x0; this.oy = y0;
    this.dx = PAD + ((w - 2 * PAD) - (x1 - x0) * this.k) / 2;
    this.dy = PAD + ((h - 2 * PAD) - (y1 - y0) * this.k) / 2;

    const b = this.base ?? document.createElement('canvas');
    b.width = Math.round(w * this.dpr); b.height = Math.round(h * this.dpr);
    const g = b.getContext('2d')!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const at = (i: number) => this.px(mercX(ix.lon[route.rows[i]]), mercY(ix.lat[route.rows[i]]));
    const runs = route.runStart.length - 1;
    // Gaps first, dashed and faint; then the runs.
    g.strokeStyle = 'rgba(181, 185, 192, .45)'; g.lineWidth = 1; g.setLineDash([2, 3]);
    g.beginPath();
    for (let r = 1; r < runs; r++) {
      const a = route.runStart[r], [ax, ay] = at(a - 1), [bx, by] = at(a);
      g.moveTo(ax, ay); g.lineTo(bx, by);
    }
    g.stroke(); g.setLineDash([]);
    g.strokeStyle = '#C98128'; g.lineWidth = 1.5;
    g.beginPath();
    for (let r = 0; r < runs; r++) {
      const a = route.runStart[r], e = route.runStart[r + 1];
      let [lx, ly] = at(a);
      g.moveTo(lx, ly);
      if (e - a === 1) g.lineTo(lx + 0.01, ly);
      for (let i = a + 1; i < e; i++) {
        const [x, y] = at(i);
        if (Math.abs(x - lx) + Math.abs(y - ly) < 0.6) continue; // sub-pixel steps add nothing
        g.lineTo(x, y); lx = x; ly = y;
      }
    }
    g.stroke();
    this.base = b;
  }

  private px(x: number, y: number): [number, number] {
    return [this.dx + (x - this.ox) * this.k, this.dy + (y - this.oy) * this.k];
  }

  /** view: the map's visible world rect [x0, y0, x1, y1]; goal: where the camera heads (follow); pos: the marker. */
  draw(view: [number, number, number, number] | null, goal: View | null, mapW: number, mapH: number, pos: XY | null) {
    const cv = this.cv, w = this.w, h = this.h;
    if (!this.base || !w) return;
    if (cv.width !== this.base.width || cv.height !== this.base.height) { cv.width = this.base.width; cv.height = this.base.height; }
    const g = cv.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(this.base, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const rect = (x0: number, y0: number, x1: number, y1: number) => {
      const [a, b] = this.px(x0, y0), [c, d] = this.px(x1, y1);
      const cx = (a + c) / 2, cy = (b + d) / 2, rw = Math.max(4, c - a), rh = Math.max(4, d - b);
      g.strokeRect(cx - rw / 2, cy - rh / 2, rw, rh);
    };
    if (goal) {
      const s = 512 * 2 ** goal.z, hx = mapW / 2 / s, hy = mapH / 2 / s;
      g.setLineDash([3, 3]); g.strokeStyle = 'rgba(205, 200, 190, .7)'; g.lineWidth = 1;
      rect(goal.x - hx, goal.y - hy, goal.x + hx, goal.y + hy);
      g.setLineDash([]);
    }
    if (view) { g.strokeStyle = '#F2B66A'; g.lineWidth = 1.5; rect(view[0], view[1], view[2], view[3]); }
    if (pos) {
      const [x, y] = this.px(pos.x, pos.y);
      g.fillStyle = '#E9E6DF'; g.beginPath(); g.arc(x, y, 2.5, 0, 7); g.fill();
      g.strokeStyle = '#E8A64E'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.stroke();
    }
  }
}
