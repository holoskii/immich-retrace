// Canvas drawing for overview O-A, ported from sketches/template.html (`fit`, `area`, `drawSel`, `drawOA`).
import {albumLabel, clamp, DAY, fDayMonth, fMonth, fNum, packLanes, sample, sumRange, type Days, type RailAlbum, type Span} from './data.ts';

/** Mirrors the tokens in app.css (canvas can't read CSS variables cheaply per frame). */
export const C = {
  ground: '#101215', line: '#2A2F37', ink: '#E9E6DF', ink2: '#B5B9C0', muted: '#8A9099',
  photo: '#C98128', photoHi: '#E8A64E', video: '#3A9BD6', gps: '#4ADBA8', nogps: '#6B7079', rail: '#5b4426', railHover: '#8a6534',
};
const MONO = '500 11px ui-monospace, Menlo, Consolas, monospace';
const MONO_S = '400 10px ui-monospace, Menlo, Consolas, monospace';

/** Diagonal hatch for provisional counts (GPS not known yet): reads as "pending", not as either colour. */
let hatch: CanvasPattern | null = null;
function pending(ctx: CanvasRenderingContext2D): CanvasPattern | string {
  if (!hatch) {
    const t = document.createElement('canvas');
    t.width = t.height = 6;
    const g = t.getContext('2d')!;
    g.strokeStyle = C.muted; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(-1, 7); g.lineTo(7, -1); g.moveTo(5, 7); g.lineTo(7, 5); g.moveTo(-1, 1); g.lineTo(1, -1); g.stroke();
    hatch = ctx.createPattern(t, 'repeat');
  }
  return hatch ?? C.muted;
}

/** Context strip geometry (CSS px). */
export const CTX = {h: 50, base: 36, H: 32};
/** Main canvas: wave between `top` and `base`, axis labels under it, album rail lanes below. */
export const MAIN = {top: 16, base: 112, H: 94, axis: 125, rail: 136, pitch: 20, lanes: 2, get h() { return this.rail + this.lanes * this.pitch; }};

/** Sizes the backing store for HiDPI only when it changed; returns a context in CSS px, cleared. */
export function fit(cv: HTMLCanvasElement, h: number) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth;
  const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
  if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  return {ctx, w, h};
}

/**
 * Stacked √ area: media with GPS from the baseline, without GPS on top, split proportionally (sketch `area`):
 * the dim grey stretches have nothing to show on the map. Provisional counts (GPS unknown) are hatched.
 */
function area(ctx: CanvasRenderingContext2D, I: Float32Array, V: Float32Array, base: number, H: number, sq: number, provisional = false) {
  const n = I.length;
  if (!n) return;
  const top = new Float32Array(n), mid = new Float32Array(n);
  for (let x = 0; x < n; x++) {
    const tot = I[x] + V[x], h = tot > 0 ? Math.min(1, Math.sqrt(tot) / sq) * H : 0;
    top[x] = h; mid[x] = tot > 0 ? h * I[x] / tot : 0;
  }
  const path = (f: Float32Array | null, g: Float32Array | null) => {
    ctx.beginPath(); ctx.moveTo(0, base - (g ? g[0] : 0));
    for (let x = 0; x < n; x++) ctx.lineTo(x + .5, base - (f ? f[x] : 0));
    for (let x = n - 1; x >= 0; x--) ctx.lineTo(x + .5, base - (g ? g[x] : 0));
    ctx.closePath(); ctx.fill();
  };
  if (provisional) { ctx.fillStyle = pending(ctx); path(top, null); return; }
  ctx.fillStyle = C.gps; path(mid, null);
  ctx.fillStyle = C.nogps; path(top, mid);
}

/** Dims outside [x0, x1], draws edges with grab handles (sketch `drawSel`). */
function drawSel(ctx: CanvasRenderingContext2D, x0: number, x1: number, y0: number, y1: number, w: number, focus = false) {
  ctx.fillStyle = 'rgba(16,18,21,.6)';
  ctx.fillRect(0, y0, Math.max(0, x0), y1 - y0); ctx.fillRect(x1, y0, Math.max(0, w - x1), y1 - y0);
  ctx.strokeStyle = focus ? C.photoHi : C.ink; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); ctx.stroke();
  const hm = (y0 + y1) / 2; ctx.fillStyle = focus ? C.photoHi : C.ink;
  for (const x of [x0, x1]) { ctx.beginPath(); ctx.roundRect(x - 3, hm - 10, 6, 20, 3); ctx.fill(); }
}

/**
 * The all-years strip over `ext` (the library's core, widened to the view when that reaches outlier dates).
 * Items outside `ext` are announced at its ends ("‹ 3 earlier · 2008") instead of squeezing the axis.
 */
export function drawContext(cv: HTMLCanvasElement, days: Days | null, ext: Span, view: Span, sel: Span | null) {
  const {ctx, w} = fit(cv, CTX.h);
  if (!days || w <= 0) return;
  const [T0, T1] = ext, sc = (T1 - T0) / w, end = days.t0 + days.nd * DAY;
  // Each pixel here averages several days, so scale to the strip's own peak rather than the busiest single day.
  const {I, V} = sample(days, T0, T1, w);
  let peak = 0;
  for (let x = 0; x < I.length; x++) peak = Math.max(peak, I[x] + V[x]);
  area(ctx, I, V, CTX.base, CTX.H, Math.sqrt(peak) || 1, days.provisional);
  ctx.font = MONO_S; ctx.fillStyle = C.muted;
  const count = (a: number, b: number) => { const [p, v] = sumRange(days, a, b); return Math.round(p + v); };
  const nb = T0 > days.t0 ? count(days.t0, T0) : 0, na = T1 < end ? count(T1, end) : 0;
  const yr = (t: number) => new Date(t).getUTCFullYear();
  const lb = nb ? `‹ ${fNum(nb)} earlier · ${yr(days.t0)}` : '', la = na ? `${fNum(na)} later · ${yr(end - DAY)} ›` : '';
  const xl = lb ? ctx.measureText(lb).width + 8 : 0, xr = la ? w - ctx.measureText(la).width - 8 : w;
  if (lb) ctx.fillText(lb, 0, CTX.base + 13);
  if (la) ctx.fillText(la, xr + 8, CTX.base + 13);
  const y0 = yr(T0), y1 = yr(T1), every = Math.ceil(40 / ((365 * DAY) / sc));
  for (let y = y0 + 1; y <= y1; y++) {
    const x = (Date.UTC(y, 0, 1) - T0) / sc;
    ctx.fillRect(x, CTX.base, 1, 4);
    if (y % every === 0 && x > xl && x + 24 < xr) ctx.fillText("'" + String(y).slice(2), x + 2, CTX.base + 13);
  }
  drawSel(ctx, (view[0] - T0) / sc, (view[1] - T0) / sc, 2, CTX.base + 2, w);
  if (sel) { ctx.fillStyle = C.photoHi; ctx.fillRect((sel[0] - T0) / sc - 1, CTX.base, Math.max(2, (sel[1] - sel[0]) / sc), 3); }
}

function ellipsize(ctx: CanvasRenderingContext2D, s: string, max: number) {
  if (ctx.measureText(s).width <= max) return s;
  while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}

export interface RailHit { a: RailAlbum; x0: number; x1: number; y: number }

export interface MainState {
  days: Days | null; view: Span; sel: Span | null; cursor: number | null; /** Local offset (h) for the cursor's label: days here are local days. */ cursorOff: number;
  albums: RailAlbum[]; activeAlbum: string | null; hoverAlbum: string | null; focus: boolean;
}

/** Draws the zoomed wave, axis, album rail and selection; returns the rail hit boxes. */
export function drawMain(cv: HTMLCanvasElement, s: MainState): RailHit[] {
  const {ctx, w} = fit(cv, MAIN.h);
  if (w <= 0) return [];
  const [V0, V1] = s.view, span = V1 - V0, sc = span / w, X = (t: number) => (t - V0) / sc;
  if (s.days) { const {I, V} = sample(s.days, V0, V1, w); area(ctx, I, V, MAIN.base, MAIN.H, s.days.sq, s.days.provisional); }
  ctx.fillStyle = C.line; ctx.fillRect(0, MAIN.base, w, 1);

  // ticks: months (labels thinned to quarters on wide views) or days/weeks
  ctx.font = MONO_S; ctx.fillStyle = C.muted;
  const d0 = new Date(V0);
  if (span > 60 * DAY) {
    const every = span > 900 * DAY ? (span > 2500 * DAY ? 12 : 3) : 1;
    for (let m = 0; m < 1200; m++) {
      const t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + m, 1);
      if (t > V1) break;
      const x = X(t), mon = new Date(t).getUTCMonth();
      if (x < 0) continue;
      ctx.fillStyle = mon === 0 ? C.ink2 : C.muted;
      ctx.fillRect(x, MAIN.base, 1, mon === 0 ? 6 : 4);
      if (mon % every === 0) ctx.fillText(mon === 0 ? String(new Date(t).getUTCFullYear()) : fMonth(t), x + 3, MAIN.axis);
    }
  } else {
    const step = span > 20 * DAY ? 7 : 1;
    for (let k = 0; k < 400; k += step) {
      const t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate() + k);
      if (t > V1) break;
      const x = X(t);
      if (x < 0) continue;
      ctx.fillRect(x, MAIN.base, 1, 4);
      ctx.fillText(fDayMonth(t), x + 3, MAIN.axis);
    }
  }

  // album rail: bars with labels underneath, packed into lanes so labels don't collide
  ctx.font = MONO_S;
  const vis = s.albums.filter(a => a.end + DAY > V0 && a.start < V1).map(a => {
    const bx0 = X(a.start), bx1 = Math.max(bx0 + 3, X(a.end + 1)), label = ellipsize(ctx, albumLabel(a.name), 200);
    const lw = ctx.measureText(label).width;
    // The label starts at the bar, or at the left edge while the bar starts off-screen.
    const lx = Math.max(bx0, 0);
    return {a, label, bx0, bx1, lx, x0: Math.min(bx0, lx), x1: Math.max(bx1, lx + lw)};
  });
  const hits: RailHit[] = [];
  for (const it of packLanes(vis, MAIN.lanes)) {
    const y = MAIN.rail + it.lane * MAIN.pitch, on = it.a.id === s.activeAlbum, hov = it.a.id === s.hoverAlbum;
    ctx.fillStyle = on ? C.photoHi : hov ? C.railHover : C.rail;
    ctx.beginPath(); ctx.roundRect(it.bx0, y, it.bx1 - it.bx0, 7, 2); ctx.fill();
    hits.push({a: it.a, x0: it.bx0, x1: it.squeezed ? it.bx1 : it.x1, y});
    if (!it.squeezed) {
      ctx.fillStyle = on || hov ? C.ink : C.ink2;
      ctx.fillText(it.label, it.lx, y + 17);
    }
  }

  if (s.sel) drawSel(ctx, X(s.sel[0]), X(s.sel[1]), 4, MAIN.base, w, s.focus);

  if (s.cursor != null && s.cursor >= V0 && s.cursor <= V1) {
    const x = Math.round(X(s.cursor)) + .5;
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, MAIN.top); ctx.lineTo(x, MAIN.base); ctx.stroke();
    ctx.font = MONO; const lab = fDayMonth(s.cursor + s.cursorOff * 3600e3), tw = ctx.measureText(lab).width;
    ctx.fillStyle = C.ink; ctx.fillText(lab, clamp(x - tw / 2, 0, w - tw), MAIN.top - 4);
  }
  return hits;
}
