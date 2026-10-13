import {describe, expect, it} from 'vitest';
import {
  binFixes, buildTrack, CAMERA, farZoomCap, latOf, lonOf, mercX, mercY, spring, trackAt, unitsPerKm, zoomFor,
} from '../web/src/lib/map/camera.ts';

const H = 3600e3, M = 60e3, T0 = Date.UTC(2026, 7, 1);

/** Minimal columns: rows as [minutes after T0, lat, lon] (null = no GPS), sorted by the caller. */
function cols(rows: [number, number | null, number | null][]) {
  const n = rows.length, t = new Float64Array(n), lat = new Float64Array(n), lon = new Float64Array(n), gps = new Uint8Array(n);
  rows.forEach(([m, la, lo], i) => { t[i] = T0 + m * M; gps[i] = la == null ? 0 : 1; lat[i] = la ?? NaN; lon[i] = lo ?? NaN; });
  return {t, lat, lon, gps};
}

/** Distance in km between two mercator points (local scale). */
const km = (x0: number, y0: number, x1: number, y1: number) => Math.hypot(x1 - x0, y1 - y0) / unitsPerKm((y0 + y1) / 2);

describe('projection', () => {
  it('round-trips lon/lat through Web Mercator', () => {
    for (const [lat, lon] of [[0, 0], [42.87, 74.6], [-33.9, 151.2], [64.1, -21.9]]) {
      expect(latOf(mercY(lat))).toBeCloseTo(lat, 9);
      expect(lonOf(mercX(lon))).toBeCloseTo(lon, 9);
    }
    expect(mercY(0)).toBeCloseTo(0.5, 12);
    expect(mercY(60)).toBeLessThan(0.5); // y grows southward
  });

  it('scales km by 1/cos(lat)', () => {
    expect(unitsPerKm(0.5)).toBeCloseTo(1 / 40075.017, 12);
    expect(unitsPerKm(mercY(60)) / unitsPerKm(0.5)).toBeCloseTo(2, 6);
  });
});

describe('binFixes', () => {
  it('collapses a burst into one bin at its mean and skips rows without GPS', () => {
    const b = binFixes(cols([[0, 42, 75], [0.5, 42.002, 75], [1, null, null], [1.5, 42.004, 75], [3, 43, 76]]), 0, 5);
    expect(b.n).toBe(2);
    expect(b.t[0]).toBe(T0 + (0 + 0.5 + 1.5) / 3 * M);
    expect(latOf(b.y[0])).toBeCloseTo(42.002, 4);
    expect(lonOf(b.x[1])).toBeCloseTo(76, 9);
  });

  it('respects lo..hi and starts a new bin 2 min after the first fix of the previous one', () => {
    const c = cols([[0, 1, 1], [1, 1, 1], [2, 1, 1], [3, 1, 1], [10, 2, 2]]);
    expect(binFixes(c, 0, 4).n).toBe(2); // [0, 1] and [2, 3]
    expect(binFixes(c, 4, 5).n).toBe(1);
    expect(binFixes(c, 0, 0).n).toBe(0);
  });
});

describe('buildTrack', () => {
  it('returns null without GPS', () => {
    expect(buildTrack(binFixes(cols([[0, null, null]]), 0, 1), T0, T0 + H)).toBeNull();
  });

  it('holds a single place at the minimum extent', () => {
    const b = binFixes(cols([[0, 42, 75], [60, 42, 75], [120, 42, 75]]), 0, 3);
    const tr = buildTrack(b, T0 - H, T0 + 4 * H)!;
    expect(tr.n).toBe(31);
    for (let j = 0; j < tr.n; j++) {
      expect(latOf(tr.y[j])).toBeCloseTo(42, 6);
      expect(Math.exp(tr.lhx[j]) / unitsPerKm(tr.y[j])).toBeCloseTo(CAMERA.minHalfKm, 3);
    }
  });

  // A city walk on day 1 (~1 km around A), a long drive on day 2, another walk on day 3 around B.
  const A = [42.87, 74.6], B = [40.53, 72.8];
  const rows: [number, number, number][] = [];
  for (let k = 0; k < 40; k++) rows.push([9 * 60 + k * 10, A[0] + 0.005 * Math.sin(k), A[1] + 0.005 * Math.cos(k)]);
  for (let k = 0; k <= 30; k++) rows.push([24 * 60 + 8 * 60 + k * 16, A[0] + (B[0] - A[0]) * k / 30, A[1] + (B[1] - A[1]) * k / 30]);
  for (let k = 0; k < 40; k++) rows.push([48 * 60 + 9 * 60 + k * 10, B[0] + 0.005 * Math.sin(k), B[1] + 0.005 * Math.cos(k)]);
  const c = cols(rows), bins = binFixes(c, 0, rows.length);
  const tr = buildTrack(bins, T0, T0 + 3 * 24 * H)!;

  it('frames a city walk at city scale and a drive at valley scale', () => {
    const walk = trackAt(tr, T0 + 12 * H), drive = trackAt(tr, T0 + 24 * H + 12 * H);
    expect(km(walk.x, walk.y, mercX(A[1]), mercY(A[0]))).toBeLessThan(1);
    const wide = (v: {hx: number; hy: number; y: number}) => 2 * Math.max(v.hx, v.hy) / unitsPerKm(v.y);
    expect(wide(walk)).toBeLessThan(5);
    expect(wide(drive)).toBeGreaterThan(60);
    const end = trackAt(tr, T0 + 48 * H + 14 * H);
    expect(km(end.x, end.y, mercX(B[1]), mercY(B[0]))).toBeLessThan(1);
  });

  it('keeps the position at t inside the target frame', () => {
    for (const [m, la, lo] of rows) {
      const v = trackAt(tr, T0 + m * M);
      expect(Math.abs(mercX(lo) - v.x)).toBeLessThanOrEqual(v.hx);
      expect(Math.abs(mercY(la) - v.y)).toBeLessThanOrEqual(v.hy);
    }
  });

  it('is continuous: no step between samples, everything finite', () => {
    let maxStep = 0;
    for (let j = 1; j < tr.n; j++) {
      for (const a of [tr.x, tr.y, tr.lhx, tr.lhy]) expect(Number.isFinite(a[j])).toBe(true);
      maxStep = Math.max(maxStep, Math.abs(tr.lhx[j] - tr.lhx[j - 1]));
    }
    expect(maxStep).toBeLessThan(0.35); // < ~1.4× zoom change per 10 min
  });

  it('weights a burst like one fix (binned), not by its photo count', () => {
    const P = [10, 10], Q = [10.02, 10];
    const r: [number, number, number][] = [];
    for (let k = 0; k < 100; k++) r.push([60 + k * 0.01, P[0], P[1]]); // 100 shots within 1 min
    for (let k = 0; k < 5; k++) r.push([30 + k * 15, Q[0], Q[1]]);
    r.sort((a, b) => a[0] - b[0]);
    const t = buildTrack(binFixes(cols(r), 0, r.length), T0, T0 + 2 * H)!;
    const v = trackAt(t, T0 + 60 * M);
    expect(Math.abs(v.y - mercY(Q[0]))).toBeLessThan(Math.abs(v.y - mercY(P[0])));
  });

  it('falls back to wider σ and the whole selection far from any fix', () => {
    const t = buildTrack(binFixes(cols([[0, 10, 10], [10, 10.1, 10]]), 0, 2), T0, T0 + 30 * 24 * H)!;
    const far = trackAt(t, T0 + 20 * 24 * H);
    expect(latOf(far.y)).toBeCloseTo(10.05, 2);
    expect(Number.isFinite(far.hx) && Number.isFinite(far.hy)).toBe(true);
  });
});

describe('trackAt / zoom / spring', () => {
  const tr = buildTrack(binFixes(cols([[0, 0, 0], [60, 0, 1]]), 0, 2), T0, T0 + H, {smoothMs: 0})!;

  it('interpolates between samples and clamps outside the track', () => {
    expect(trackAt(tr, T0 - H).x).toBe(tr.x[0]);
    expect(trackAt(tr, T0 + 9 * H).x).toBe(tr.x[tr.n - 1]);
    expect(trackAt(tr, T0 + 5 * M).x).toBeCloseTo((tr.x[0] + tr.x[1]) / 2, 12);
  });

  it('zoomFor fits the half-extent; farZoomCap pulls back with distance', () => {
    expect(zoomFor(0.5, 0.5, 512, 512, 0)).toBeCloseTo(0, 12);
    expect(zoomFor(0.25, 0.01, 512, 512, 0)).toBeCloseTo(1, 12);
    expect(farZoomCap(0, 0, 800, 600)).toBe(Infinity);
    expect(farZoomCap(0.01, 0, 800, 600)).toBeGreaterThan(farZoomCap(0.1, 0, 800, 600));
  });

  it('spring settles without overshoot from rest', () => {
    let x = 0, v = 0, max = 0;
    for (let i = 0; i < 120; i++) { [x, v] = spring(x, v, 1, 5, 1 / 60); max = Math.max(max, x); }
    expect(x).toBeGreaterThan(0.99);
    expect(max).toBeLessThanOrEqual(1.0001);
  });
});

describe('build time', () => {
  /** A synthetic year: ~10k GPS rows on travel days, bursts and walks, some days empty. */
  function year() {
    const rows: [number, number, number][] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    let lat = 48, lon = 11;
    for (let d = 0; d < 365; d++) {
      if (rnd() < 0.35) continue;
      if (rnd() < 0.1) { lat = 30 + rnd() * 30; lon = -10 + rnd() * 50; }
      const shots = Math.floor(rnd() * 80);
      let m = d * 1440 + 8 * 60;
      for (let k = 0; k < shots; k++) {
        m += rnd() < 0.3 ? 0.1 : rnd() * 20;
        lat += (rnd() - 0.5) * 0.004; lon += (rnd() - 0.5) * 0.004;
        rows.push([m, lat, lon]);
      }
    }
    return rows;
  }

  it('builds a year in a bounded time', () => {
    const rows = year(), c = cols(rows);
    const t0 = T0, t1 = T0 + 365 * 24 * H;
    let s0 = performance.now();
    buildTrack(binFixes(c, 0, rows.length), t0, t1); // cold (what the first selection costs)
    const cold = performance.now() - s0;
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      s0 = performance.now();
      buildTrack(binFixes(c, 0, rows.length), t0, t1);
      runs.push(performance.now() - s0);
    }
    runs.sort((a, b) => a - b);
    console.log(`camera track, synthetic year: ${rows.length} GPS rows, ${binFixes(c, 0, rows.length).n} bins, cold ${cold.toFixed(1)} ms, warm median ${runs[2].toFixed(1)} ms`);
    expect(runs[2]).toBeLessThan(1000); // smoke bound; it runs in a worker (camera.worker.ts)
  });
});
