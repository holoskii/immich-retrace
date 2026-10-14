import {describe, expect, it} from 'vitest';
import {rgbaToThumbHash, thumbHashToRGBA as refDecode} from 'thumbhash';
import type {AssetColumns} from '../shared/api.ts';
import {buildIndex} from '../web/src/lib/index/model.ts';
import {
  breakBetween, clusterVisits, densityBins, EXACT_MS, gpsBounds, haversineKm, nearestRow, pinsGeoJSON, positionAt,
  routeGeoJSON, segmentRoute, stepTime, typicalOffset,
} from '../web/src/lib/map/route.ts';
import {base64Bytes, thumbHashRatio, thumbHashToRGBA} from '../web/src/lib/thumbhash.ts';

const H = 3600e3, M = 60e3, T0 = Date.UTC(2026, 7, 1);

/** Rows as [minutes after T0, lat, lon] (null lat = no GPS); video flag optional. */
function index(rows: [number, number | null, number | null, (0 | 1)?][]) {
  const c: AssetColumns = {id: [], t: [], off: [], video: [], dur: [], lat: [], lon: [], thumbhash: [], ratio: [], city: [], country: []};
  rows.forEach(([min, lat, lon, v], i) => {
    c.id.push(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    c.t.push(T0 + min * M); c.off.push(6); c.video.push(v ?? 0); c.dur.push(0);
    c.lat.push(lat); c.lon.push(lon); c.thumbhash.push(null); c.ratio.push(1.5); c.city.push(null); c.country.push(null);
  });
  return buildIndex([c]);
}

// ~1.1 km per 0.01° of latitude.
describe('segmentRoute', () => {
  it('keeps a walk with small steps in one run and skips rows without GPS', () => {
    const ix = index([[0, 42, 75], [10, 42.01, 75], [15, null, null], [20, 42.02, 75], [30, 42.03, 75.01]]);
    const r = segmentRoute(ix, 0, ix.n);
    expect([...r.rows]).toEqual([0, 1, 3, 4]);
    expect([...r.runStart]).toEqual([0, 4]);
    expect([...r.run]).toEqual([0, 0, 0, 0]);
  });

  it('breaks on a time gap over 4 h even when the place is the same', () => {
    const ix = index([[0, 42, 75], [60, 42, 75], [60 + 4 * 60 + 1, 42, 75], [60 + 5 * 60, 42.001, 75]]);
    expect(breakBetween(ix, 1, 2)).toBe('time');
    expect([...segmentRoute(ix, 0, ix.n).runStart]).toEqual([0, 2, 4]);
  });

  it('does not break at exactly 4 h', () => {
    const ix = index([[0, 42, 75], [240, 42.001, 75]]);
    expect(breakBetween(ix, 0, 1)).toBeNull();
  });

  it('breaks on implausible speed (a flight inside 4 h, or a bad fix)', () => {
    // ~3400 km in 1 h, or in 4 h (≈ 850 km/h): both flights.
    const ix = index([[0, 42, 75], [60, 55, 37], [300, 42, 75]]);
    expect(breakBetween(ix, 0, 1)).toBe('speed');
    expect(breakBetween(ix, 1, 2)).toBe('speed');
    // A short flight: ~780 km in 1 h is slower than 1000 km/h but no surface travel.
    const hop = index([[0, 42, 75], [60, 42, 84.45]]);
    expect(haversineKm(42, 75, 42, 84.45)).toBeGreaterThan(700);
    expect(breakBetween(hop, 0, 1)).toBe('speed');
    // High-speed rail (300 km/h) stays solid.
    const rail = index([[0, 30, 110], [10, 30.45, 110]]);
    expect(breakBetween(rail, 0, 1)).toBeNull();
    // A 3 km fix in the same second as the previous one is not jitter.
    expect(breakBetween(index([[0, 42, 75], [0, 42.027, 75]]), 0, 1)).toBe('speed');
    // A 30 km bad fix one second after the previous one.
    const bad = index([[0, 42, 75], [1 / 60, 42.27, 75]]);
    expect(breakBetween(bad, 0, 1)).toBe('speed');
  });

  it('tolerates GPS jitter inside a burst (dt ≈ 0)', () => {
    const ix = index([[0, 42, 75], [0, 42.002, 75], [0.01, 42.001, 75.001]]);
    expect([...segmentRoute(ix, 0, ix.n).runStart]).toEqual([0, 3]);
  });

  it('keeps a plausible drive (100 km in 1.5 h) but breaks a long silent jump', () => {
    const drive = index([[0, 42, 75], [90, 42.9, 75]]);
    expect(breakBetween(drive, 0, 1)).toBeNull();
    const jump = index([[0, 42, 75], [120, 42.9, 75]]);
    expect(breakBetween(jump, 0, 1)).toBe('jump');
  });

  it('only looks at rows lo..hi-1 and handles no GPS at all', () => {
    const ix = index([[0, 42, 75], [10, 42.01, 75], [20, 42.02, 75]]);
    expect([...segmentRoute(ix, 1, 3).rows]).toEqual([1, 2]);
    const none = segmentRoute(index([[0, null, null]]), 0, 1);
    expect(none.rows.length).toBe(0);
    expect([...none.runStart]).toEqual([0]);
  });
});

describe('routeGeoJSON', () => {
  const ix = index([[0, 42, 75], [60, 42.01, 75], [120, 42.02, 75], [600, 42.5, 75], [660, 42.51, 75], [1000, 43, 75]]);
  const route = segmentRoute(ix, 0, ix.n); // runs: [0..2], [3..4], [5]

  it('draws runs as lines and the joins between runs as gaps, never a gap as a line', () => {
    expect([...route.runStart]).toEqual([0, 3, 5, 6]);
    const {lines, gaps} = routeGeoJSON(ix, route, T0, T0 + 1000 * M, 1);
    expect(lines.features.map(f => f.geometry.coordinates.length)).toEqual([3, 2]); // the 1-point run has no line
    expect(gaps.features.map(f => f.geometry.coordinates)).toEqual([[[75, 42.02], [75, 42.5]], [[75, 42.51], [75, 43]]]);
  });

  it('cuts lines where the time color changes, sharing the cut point, colored by start time', () => {
    const {lines} = routeGeoJSON(ix, route, T0, T0 + 1000 * M, 10);
    // Run 1: segments start at 0 and 60 min → buckets 0, 0; run 2: starts at 600 min → bucket 6.
    expect(lines.features.map(f => f.properties.k)).toEqual([0.05, 0.65]);
    const fine = routeGeoJSON(ix, route, T0, T0 + 1000 * M, 100).lines.features;
    expect(fine.map(f => f.properties.k)).toEqual([0.005, 0.065, 0.605]);
    expect(fine[0].geometry.coordinates.at(-1)).toEqual(fine[1].geometry.coordinates[0]);
  });

  it('keeps the feature count near the bucket count for thousands of points', () => {
    const rows: [number, number, number][] = [];
    for (let i = 0; i < 5000; i++) rows.push([i * 5, 42 + i * 1e-4, 75]);
    const big = index(rows);
    const {lines} = routeGeoJSON(big, segmentRoute(big, 0, big.n), T0, T0 + 5000 * 5 * M, 96);
    expect(lines.features.length).toBeLessThanOrEqual(96);
    expect(lines.features.reduce((s, f) => s + f.geometry.coordinates.length - 1, 0)).toBe(4999);
  });
});

describe('positionAt', () => {
  const ix = index([[0, 42, 75], [60, 42.01, 75], [600, 42.5, 75], [660, 42.51, 75]]);
  const route = segmentRoute(ix, 0, ix.n);
  const at = (min: number) => positionAt(ix, route, T0 + min * M)!;

  it('is exact at (or within 2 min of) a fix', () => {
    expect(at(60)).toMatchObject({kind: 'exact', lat: 42.01, i: 1});
    expect(positionAt(ix, route, T0 + 60 * M - EXACT_MS)).toMatchObject({kind: 'exact', i: 1});
  });

  it('interpolates only inside a run, and marks it as such', () => {
    const p = at(30);
    expect(p.kind).toBe('interp');
    expect(p.lat).toBeCloseTo(42.005, 9);
  });

  it('reports a gap between runs instead of a recorded position', () => {
    expect(at(300).kind).toBe('gap');
  });

  it('pins to the ends outside the GPS span', () => {
    expect(at(-30)).toMatchObject({kind: 'before', lat: 42});
    expect(at(700)).toMatchObject({kind: 'after', lat: 42.51});
    expect(positionAt(index([]), segmentRoute(index([]), 0, 0), T0)).toBeNull();
  });
});

describe('selection helpers', () => {
  const ix = index([[0, null, null], [10, 42, 75, 1], [20, 41, 76], [30, null, null]]);

  it('nearestRow and stepTime walk assets in time order', () => {
    expect(nearestRow(ix, 0, ix.n, T0 + 14 * M)).toBe(1);
    expect(nearestRow(ix, 0, ix.n, T0 + 16 * M)).toBe(2);
    expect(nearestRow(ix, 0, ix.n, T0 - H)).toBe(0);
    expect(nearestRow(ix, 1, 3, T0 + H)).toBe(2);
    expect(nearestRow(ix, 2, 2, T0)).toBe(-1);
    expect(stepTime(ix, 0, ix.n, T0 + 10 * M, 1)).toBe(T0 + 20 * M);
    expect(stepTime(ix, 0, ix.n, T0 + 10 * M, -1)).toBe(T0);
    expect(stepTime(ix, 0, ix.n, T0 + 30 * M, 1)).toBeNull();
    expect(stepTime(ix, 1, ix.n, T0 + 10 * M, -1)).toBeNull();
    // Scrubbing yields fractional ms: the next asset half a ms ahead is still "next".
    expect(stepTime(ix, 0, ix.n, T0 + 20 * M - 0.5, 1)).toBe(T0 + 20 * M);
    expect(stepTime(ix, 0, ix.n, T0 + 10 * M + 0.5, -1)).toBe(T0 + 10 * M);
  });

  it('pins, bounds and density use the gps flag and the range', () => {
    expect(pinsGeoJSON(ix, 0, ix.n, 7).features.map(f => f.properties)).toEqual([{r: 1, v: 1, t: T0 + 10 * M, g: 7}, {r: 2, v: 0, t: T0 + 20 * M, g: 7}]);
    expect(gpsBounds(ix, 0, ix.n)).toEqual([75, 41, 76, 42]);
    expect(gpsBounds(ix, 0, 1)).toBeNull();
    const {gps, nogps} = densityBins(ix, 0, ix.n, T0, T0 + 40 * M, 4);
    expect([...gps]).toEqual([0, 1, 1, 0]);
    expect([...nogps]).toEqual([1, 0, 0, 1]);
    expect(typicalOffset(ix, 0, ix.n)).toBe(6);
  });

  it('haversine is about 111 km per degree of latitude', () => {
    expect(haversineKm(42, 75, 43, 75)).toBeCloseTo(111.2, 0);
  });
});

const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  expect(a.length).toBe(b.length);
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

describe('thumbhash', () => {
  // A small synthetic image: horizontal gradient with a bright spot, landscape 40×24.
  const w = 40, h = 24, px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, spot = Math.hypot(x - 28, y - 8) < 6 ? 120 : 0;
    px[i] = Math.min(255, x * 6 + spot); px[i + 1] = 80 + spot / 2; px[i + 2] = 200 - x * 4; px[i + 3] = 255;
  }
  const hash = rgbaToThumbHash(w, h, px);

  it('decodes like the reference implementation', () => {
    const ours = thumbHashToRGBA(hash), ref = refDecode(hash);
    expect([ours.w, ours.h]).toEqual([ref.w, ref.h]);
    // The reference truncates into a Uint8Array; we round (Uint8ClampedArray): at most 1 apart.
    expect(maxDiff(ours.rgba, ref.rgba)).toBeLessThanOrEqual(1);
    expect(thumbHashRatio(hash)).toBeGreaterThan(1);
  });

  it('decodes a hash with alpha like the reference', () => {
    const a = px.slice();
    for (let i = 3; i < a.length; i += 4) a[i] = (i >> 2) % w < 10 ? 0 : 255;
    const ha = rgbaToThumbHash(w, h, a);
    expect(maxDiff(thumbHashToRGBA(ha).rgba, refDecode(ha).rgba)).toBeLessThanOrEqual(1);
  });

  it('reads Immich\'s base64 form', () => {
    const b64 = Buffer.from(hash).toString('base64');
    expect([...base64Bytes(b64)]).toEqual([...hash]);
  });
});

describe('clusterVisits', () => {
  // Rows: 0–2 at A, 3 elsewhere (B), 4–5 at A again two days later; 6 no GPS.
  const ix = index([[0, 41.9, 12.5], [60, 41.9, 12.5], [120, 41.9, 12.5], [24 * 60, 43.7, 11.2], [50 * 60, 41.9, 12.5], [51 * 60, 41.9, 12.5]]);
  it('splits a return visit when a fix elsewhere lies between and the gap is long', () => {
    const v = clusterVisits(ix, 0, ix.n, [5, 0, 1, 2, 4]);
    expect(v.map(x => [x.n, x.t0, x.t1])).toEqual([[3, T0, T0 + 120 * M], [2, T0 + 50 * H, T0 + 51 * H]]);
  });
  it('keeps one visit when nothing else was photographed in between (or outside the range)', () => {
    expect(clusterVisits(ix, 0, ix.n, [0, 1, 2, 3, 4, 5])).toHaveLength(1);
    expect(clusterVisits(ix, 4, ix.n, [4, 5, 0])).toEqual([{t0: T0 + 50 * H, t1: T0 + 51 * H, n: 2, place: ''}]);
  });
  it('a short excursion (< 36 h) stays one visit', () => {
    const j = index([[0, 41.9, 12.5], [5 * 60, 41.96, 12.8], [10 * 60, 41.9, 12.5]]);
    expect(clusterVisits(j, 0, j.n, [0, 2])).toHaveLength(1);
  });
});

describe('clusterVisits place', () => {
  const named = (cities: (string | null)[], country: string) => {
    const ix = index(cities.map((_, i) => [i * 10, 41.9, 12.5] as [number, number, number]));
    cities.forEach((c, i) => { ix.city[i] = c; ix.country[i] = country; });
    return clusterVisits(ix, 0, ix.n, cities.map((_, i) => i))[0].place;
  };
  it('names the city when one has most named photos, else the country', () => {
    expect(named(['Rome', 'Rome', 'Florence'], 'Italy')).toBe('Rome');
    expect(named(['Braga', 'Porto', 'Gerês', null], 'Portugal')).toBe('Portugal');
    expect(named([null, null], 'Italy')).toBe('Italy');
  });
});
