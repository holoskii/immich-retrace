// Follow camera ("Smooth" in the sketch, M-D): a target path precomputed every 10 min over the
// selection, then followed per frame by critically damped springs (MapView). Pure, unit-tested.
//
// Everything is in Web Mercator world units (MapLibre's MercatorCoordinate: x, y in 0..1, y down),
// so "spread" and "extent" mean the same thing on screen at any latitude.
import type {IndexColumns} from '../index/model.ts';

const MIN = 60e3, HOUR = 60 * MIN;
/** Earth's circumference at the equator, km: one world unit at latitude 0. */
const WORLD_KM = 40075.017;

export interface CameraParams {
  binMs: number; stepMs: number; sigmas: readonly number[]; blendK: number; spreadK: number;
  minHalfKm: number; posK: number; smoothMs: number; cutoff: number;
}

export const CAMERA: Readonly<CameraParams> = {
  /** GPS fixes closer than this to the first fix of a bin collapse into one sample (bursts). */
  binMs: 2 * MIN,
  /** Track sample spacing. */
  stepMs: 10 * MIN,
  /** Local σ, blended toward the wider ones (and the whole selection) where it has little weight. */
  sigmas: [24 * HOUR, 6 * HOUR, 1.5 * HOUR],
  /** Blend factor W / (W + k): a σ level takes over once its window holds a few bins. */
  blendK: 2,
  /** Half-extent = spread × this (the sketch's 2.4 × spread per side). */
  spreadK: 2.4,
  /** Floor for the half-extent, km (frame ≥ ~1.3 km across). */
  minHalfKm: 0.65,
  /** The position at t stays inside the frame by this margin (× its offset from the center). */
  posK: 1.2,
  /** Smoothing of the sampled path. */
  smoothMs: 30 * MIN,
  /** Gaussian windows are cut at ±cutoff σ. */
  cutoff: 4,
};

/** Web Mercator x, y (0..1) of a lon/lat. */
export const mercX = (lon: number) => (lon + 180) / 360;
export function mercY(lat: number) {
  const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
export const lonOf = (x: number) => x * 360 - 180;
export const latOf = (y: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
/** World units per km at mercator y (1 / cos(lat) stretch). */
export const unitsPerKm = (y: number) => Math.cosh(Math.PI * (1 - 2 * y)) / WORLD_KM;

/** GPS fixes of a selection collapsed into time bins: t, x, y per bin (means), ascending t. */
export interface Bins { n: number; t: Float64Array; x: Float64Array; y: Float64Array }

/** Bins the GPS rows lo..hi-1 of a t-sorted index: a bin starts at a fix and takes every fix within binMs of it. */
export function binFixes(ix: Pick<IndexColumns, 't' | 'lat' | 'lon' | 'gps'>, lo: number, hi: number, binMs: number = CAMERA.binMs): Bins {
  let cap = 0;
  for (let r = lo; r < hi; r++) cap += ix.gps[r];
  const t = new Float64Array(cap), x = new Float64Array(cap), y = new Float64Array(cap);
  let n = 0, start = -Infinity, k = 0;
  for (let r = lo; r < hi; r++) {
    if (!ix.gps[r]) continue;
    const tr = ix.t[r], xr = mercX(ix.lon[r]), yr = mercY(ix.lat[r]);
    if (n > 0 && tr - start < binMs) {
      k++; // running mean
      t[n - 1] += (tr - t[n - 1]) / k; x[n - 1] += (xr - x[n - 1]) / k; y[n - 1] += (yr - y[n - 1]) / k;
    } else {
      start = tr; k = 1; t[n] = tr; x[n] = xr; y[n] = yr; n++;
    }
  }
  return {n, t: t.subarray(0, n), x: x.subarray(0, n), y: y.subarray(0, n)};
}

/**
 * The camera's target path: center (x, y) and log half-extents (lhx, lhy) every `step` ms from t0.
 * `box` is the bounding box of all bins (for "Whole selection" and the inset).
 */
export interface Track {
  t0: number; step: number; n: number;
  x: Float64Array; y: Float64Array; lhx: Float64Array; lhy: Float64Array;
  box: [number, number, number, number];
}

/** Bounding box [x0, y0, x1, y1] of the bins, or null without any. */
export function boxOf(b: Bins): [number, number, number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < b.n; i++) {
    x0 = Math.min(x0, b.x[i]); x1 = Math.max(x1, b.x[i]); y0 = Math.min(y0, b.y[i]); y1 = Math.max(y1, b.y[i]);
  }
  return b.n ? [x0, y0, x1, y1] : null;
}

/**
 * Gaussian time-weighted weight, mean and variance of the bins every `gs` track steps (gs ≈ σ/8),
 * over a window of ±cutoff σ that slides forward with t (so the cost is bounded by the window,
 * not by the selection's length).
 */
function levelStats(b: Bins, t0: number, step: number, n: number, sigma: number, cutoff: number) {
  const gs = Math.max(1, Math.floor(sigma / 8 / step)), m = Math.floor((n - 1) / gs) + 2;
  const W = new Float64Array(m), X = new Float64Array(m), Y = new Float64Array(m), VX = new Float64Array(m), VY = new Float64Array(m);
  const half = cutoff * sigma, inv = -0.5 / (sigma * sigma);
  let lo = 0, hi = 0;
  for (let g = 0; g < m; g++) {
    const t = t0 + g * gs * step;
    while (lo < b.n && b.t[lo] < t - half) lo++;
    if (hi < lo) hi = lo;
    while (hi < b.n && b.t[hi] <= t + half) hi++;
    if (hi === lo) continue;
    // Sums relative to the window's first bin: E[x²] - E[x]² on raw 0..1 units would cancel badly.
    const ox = b.x[lo], oy = b.y[lo];
    let w = 0, sx = 0, sy = 0, sxx = 0, syy = 0;
    for (let i = lo; i < hi; i++) {
      const d = b.t[i] - t, wi = Math.exp(d * d * inv), xi = b.x[i] - ox, yi = b.y[i] - oy;
      w += wi; sx += wi * xi; sy += wi * yi; sxx += wi * xi * xi; syy += wi * yi * yi;
    }
    if (w < 1e-9) continue;
    const mx = sx / w, my = sy / w;
    W[g] = w; X[g] = ox + mx; Y[g] = oy + my;
    VX[g] = Math.max(0, sxx / w - mx * mx); VY[g] = Math.max(0, syy / w - my * my);
  }
  return {gs, m, W, X, Y, VX, VY};
}

/**
 * Builds the target path over [t0, t1] from the bins. Per sample: the whole selection's weighted
 * mean/spread, then for σ 24 h → 6 h → 1.5 h a Gaussian time-weighted mean/spread over the bins
 * within ±4σ, each blended in by W / (W + 2). Half-extent = max(2.4 × spread, 0.65 km, 1.2 × the
 * offset of the position at t); then x, y, log hx, log hy are smoothed over σ 30 min.
 * Returns null without any GPS.
 */
export function buildTrack(b: Bins, t0: number, t1: number, opts: Partial<CameraParams> = {}): Track | null {
  const C = {...CAMERA, ...opts};
  if (!b.n) return null;
  const step = C.stepMs, n = Math.max(1, Math.floor((t1 - t0) / step) + 1);
  // Locals for the hot loops (C's shape varies with opts, which would make its fields slow to read).
  const blendK = C.blendK, spreadK = C.spreadK, minHalfKm = C.minHalfKm, posK = C.posK;

  // Whole selection: unweighted mean and spread of the bins.
  let wx = 0, wy = 0;
  for (let i = 0; i < b.n; i++) { wx += b.x[i]; wy += b.y[i]; }
  wx /= b.n; wy /= b.n;
  let vx = 0, vy = 0;
  for (let i = 0; i < b.n; i++) { vx += (b.x[i] - wx) ** 2; vy += (b.y[i] - wy) ** 2; }
  const whole = {x: wx, y: wy, sx: Math.sqrt(vx / b.n), sy: Math.sqrt(vy / b.n)};

  // Each σ level on its own grid (σ/8, a multiple of the track step), mixed linearly in between:
  // a Gaussian that wide hardly changes over σ/8, and the 24 h level costs 1/18 of the work.
  const levels = C.sigmas.map(s => levelStats(b, t0, step, n, s, C.cutoff));

  const rx = new Float64Array(n), ry = new Float64Array(n), rhx = new Float64Array(n), rhy = new Float64Array(n);
  let pi = 0;
  for (let j = 0; j < n; j++) {
    const t = t0 + j * step;
    let vx = whole.x, vy = whole.y, vsx = whole.sx, vsy = whole.sy;
    for (const L of levels) {
      const f = j / L.gs, a = Math.floor(f), k = f - a, c = Math.min(a + 1, L.m - 1);
      const wa = L.W[a] * (1 - k), wc = L.W[c] * k, w = wa + wc;
      if (w < 1e-6) continue;
      // Mixture of the two grid points' distributions: pooled mean and variance.
      const qx = (wa * L.X[a] + wc * L.X[c]) / w, qy = (wa * L.Y[a] + wc * L.Y[c]) / w;
      const qvx = (wa * (L.VX[a] + (L.X[a] - qx) ** 2) + wc * (L.VX[c] + (L.X[c] - qx) ** 2)) / w;
      const qvy = (wa * (L.VY[a] + (L.Y[a] - qy) ** 2) + wc * (L.VY[c] + (L.Y[c] - qy) ** 2)) / w;
      const al = w / (w + blendK);
      vx += (qx - vx) * al; vy += (qy - vy) * al;
      vsx += (Math.sqrt(qvx) - vsx) * al; vsy += (Math.sqrt(qvy) - vsy) * al;
    }
    // Position at t, linear between bins (clamped at the ends): it must stay inside the frame.
    while (pi < b.n && b.t[pi] < t) pi++;
    let px: number, py: number;
    if (pi === 0) { px = b.x[0]; py = b.y[0]; }
    else if (pi === b.n) { px = b.x[b.n - 1]; py = b.y[b.n - 1]; }
    else {
      const k = (t - b.t[pi - 1]) / Math.max(1, b.t[pi] - b.t[pi - 1]);
      px = b.x[pi - 1] + (b.x[pi] - b.x[pi - 1]) * k; py = b.y[pi - 1] + (b.y[pi] - b.y[pi - 1]) * k;
    }
    const floor = minHalfKm * unitsPerKm(vy);
    const hx = Math.max(spreadK * vsx, floor, Math.abs(px - vx) * posK);
    const hy = Math.max(spreadK * vsy, floor, Math.abs(py - vy) * posK);
    rx[j] = vx; ry[j] = vy; rhx[j] = Math.log(hx); rhy[j] = Math.log(hy);
  }

  // Smooth over σ = smoothMs (in samples), window ±cutoff σ, renormalized at the ends.
  const ss = C.smoothMs / step, R = Math.ceil(C.cutoff * ss);
  const ker = new Float64Array(2 * R + 1);
  for (let k = -R; k <= R; k++) ker[k + R] = ss > 0 ? Math.exp(-0.5 * (k / ss) ** 2) : (k === 0 ? 1 : 0);
  const sm = (a: Float64Array) => {
    const o = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      let w = 0, s = 0;
      for (let k = Math.max(-R, -j); k <= Math.min(R, n - 1 - j); k++) { const wk = ker[k + R]; w += wk; s += wk * a[j + k]; }
      o[j] = s / w;
    }
    return o;
  };
  return {t0, step, n, x: sm(rx), y: sm(ry), lhx: sm(rhx), lhy: sm(rhy), box: boxOf(b)!};
}

/** Target at time t (linear between samples, clamped to the track): center and half-extents in world units. */
export function trackAt(tr: Track, t: number) {
  const f = Math.min(Math.max((t - tr.t0) / tr.step, 0), tr.n - 1), i = Math.floor(f), k = f - i, j = Math.min(i + 1, tr.n - 1);
  const l = (a: Float64Array) => a[i] + (a[j] - a[i]) * k;
  return {x: l(tr.x), y: l(tr.y), hx: Math.exp(l(tr.lhx)), hy: Math.exp(l(tr.lhy))};
}

/** MapLibre's world size at zoom 0, px (512-px tiles). */
export const TILE = 512;

/**
 * Space kept clear on each side of a w × h viewport, px: margin, plus whatever floats over the map there (a
 * phone's dock and title pill). The camera frames its target in the rest.
 */
export interface Insets { t: number; r: number; b: number; l: number }
export const uniformInsets = (px: number): Insets => ({t: px, r: px, b: px, l: px});

/** Zoom that fits half-extents (hx, hy) into a w × h viewport less `ins`. */
export function zoomFor(hx: number, hy: number, w: number, h: number, ins: Insets) {
  const scale = Math.min(Math.max(1, (w - ins.l - ins.r) / 2) / hx, Math.max(1, (h - ins.t - ins.b) / 2) / hy);
  return Math.log2(scale / TILE);
}

/**
 * World units from the center of the area `ins` leaves to the map's center at zoom z: a frame centered at
 * (x, y) needs the map at (x + dx, y + dy). Zero for symmetric insets.
 */
export function insetShift(ins: Insets, z: number) {
  const s = TILE * 2 ** z;
  return {dx: (ins.r - ins.l) / 2 / s, dy: (ins.b - ins.t) / 2 / s};
}

/**
 * Zoom cap while the view is far from its target (flyTo-like): the target center must lie within
 * `frac` of the smaller viewport side from the current center. Infinity when they coincide.
 */
export function farZoomCap(dx: number, dy: number, w: number, h: number, frac = 0.45) {
  const d = Math.hypot(dx, dy);
  return d > 0 ? Math.log2(frac * Math.min(w, h) / d / TILE) : Infinity;
}

/** One semi-implicit Euler step of a critically damped spring toward `to`: returns [x, v]. */
export function spring(x: number, v: number, to: number, omega: number, dt: number): [number, number] {
  v += (omega * omega * (to - x) - 2 * omega * v) * dt;
  return [x + v * dt, v];
}
