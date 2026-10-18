import {afterEach, describe, expect, it, vi} from 'vitest';
import {sliceIndex, withLookup, type IndexColumns, type LibraryIndex} from '../web/src/lib/index/model.ts';
import {distM, enclosingCircle, fRadius, nearParam, parseNear, placeRows} from '../web/src/lib/place.ts';
import {
  applyUrl, placeIndex, sameSelection, selection, selectionFromUrl, selectionToQuery, type Selection,
} from '../web/src/lib/selection.svelte.ts';
import {library} from '../web/src/lib/index/store.svelte.ts';

const D = (s: string) => Date.parse(s + 'T00:00:00Z');
const H = 3600e3;

/** Rows: [UTC ISO instant, lat, lon] (null lat: no GPS); sorted by t like the real index. */
function ix(rows: [string, number | null, number | null][]): LibraryIndex {
  const n = rows.length, gps = rows.map(r => (r[1] == null ? 0 : 1));
  return withLookup({
    n, id: rows.map((_, i) => 'a' + i), t: Float64Array.from(rows.map(r => Date.parse(r[0]))), off: new Float32Array(n),
    video: new Uint8Array(n), dur: new Float64Array(n), gps: Uint8Array.from(gps),
    lat: Float64Array.from(rows.map(r => r[1] ?? NaN)), lon: Float64Array.from(rows.map(r => r[2] ?? NaN)),
    thumbhash: rows.map((_, i) => 'h' + i), ratio: new Float32Array(n).fill(1.5),
    city: rows.map((_, i) => 'c' + i), country: new Array(n).fill('ES'),
  } satisfies IndexColumns);
}

// Pamplona old town and a day trip to San Sebastián (~75 km away).
const P = [42.8169, -1.6432] as const, S = [43.3183, -1.9812] as const;
const lib = ix([
  ['2024-07-06T09:00:00Z', P[0], P[1]],
  ['2024-07-06T10:00:00Z', P[0] + 0.001, P[1]],       // ~111 m north
  ['2024-07-06T11:00:00Z', null, null],                // no GPS: never in a place
  ['2024-07-07T10:00:00Z', S[0], S[1]],                // elsewhere
  ['2024-07-08T10:00:00Z', P[0], P[1] + 0.002],        // ~163 m east
  ['2024-07-09T10:00:00Z', P[0] + 0.0009, P[1] + 0.001],
]);

describe('sliceIndex', () => {
  it('copies the listed rows in order, with their own id lookup', () => {
    const s = sliceIndex(lib, [1, 3, 5]);
    expect(s.n).toBe(3);
    expect(s.id).toEqual(['a1', 'a3', 'a5']);
    expect([...s.t]).toEqual([lib.t[1], lib.t[3], lib.t[5]]);
    expect([s.lat[1], s.lon[1], s.gps[1], s.thumbhash[2], s.city[0], s.country[0], s.ratio[0]]).toEqual([S[0], S[1], 1, 'h5', 'c1', 'ES', 1.5]);
    expect(s.idToRow.get('a5')).toBe(2);
    expect(s.idToRow.has('a0')).toBe(false);
    expect(sliceIndex(lib, []).n).toBe(0);
  });
});

describe('enclosingCircle', () => {
  it('holds every point; its centre is the smallest circle\'s, rounded to 5 decimals', () => {
    const pts: [number, number][] = [[P[0], P[1]], [P[0] + 0.001, P[1]], [P[0], P[1] + 0.002], [P[0] + 0.0005, P[1] + 0.001]];
    const c = enclosingCircle(pts)!;
    for (const p of pts) expect(distM(c.lat, c.lon, p[0], p[1])).toBeLessThanOrEqual(c.r);
    expect(Number.isInteger(c.r)).toBe(true);
    expect(c.lat).toBe(Math.round(c.lat * 1e5) / 1e5);
    // The farthest pair spans ~197 m, so the smallest circle is ~99 m (+1 m and rounding); a centroid-based one is larger.
    expect(c.r).toBeGreaterThan(95);
    expect(c.r).toBeLessThanOrEqual(101);
  });
  it('one point: a 1 m circle; none: null', () => {
    expect(enclosingCircle([[P[0], P[1]]])).toEqual({lat: P[0], lon: P[1], r: 1});
    expect(enclosingCircle([])).toBeNull();
  });
  it('many points stay fast and inside', () => {
    const pts: [number, number][] = Array.from({length: 5000}, (_, i) => [P[0] + Math.sin(i) * 0.01, P[1] + Math.cos(i * 1.3) * 0.01]);
    const c = enclosingCircle(pts)!;
    for (const p of pts) expect(distM(c.lat, c.lon, p[0], p[1])).toBeLessThanOrEqual(c.r);
  });
});

describe('placeRows', () => {
  const c = {lat: P[0], lon: P[1], r: 200};
  it('GPS rows within the radius and the time bounds (t1 exclusive); no-GPS rows never', () => {
    expect([...placeRows(lib, c, D('2024-07-06'), D('2024-07-10'))]).toEqual([0, 1, 4, 5]);
    expect([...placeRows(lib, {...c, r: 140}, D('2024-07-06'), D('2024-07-10'))]).toEqual([0, 1, 5]);
    expect([...placeRows(lib, c, D('2024-07-06') + 9 * H, D('2024-07-08') + 10 * H)]).toEqual([0, 1]);
    expect([...placeRows(lib, {lat: S[0], lon: S[1], r: 10}, 0, Infinity)]).toEqual([3]);
  });
  it('across the antimeridian', () => {
    const x = ix([['2024-01-01T00:00:00Z', -17, 179.9995], ['2024-01-01T01:00:00Z', -17, -179.9995], ['2024-01-01T02:00:00Z', -17, 0]]);
    expect([...placeRows(x, {lat: -17, lon: 180, r: 200}, 0, Infinity)]).toEqual([0, 1]);
  });
});

describe('near= URL', () => {
  const place: Selection = {kind: 'place', lat: 42.8174, lon: -1.6422, r: 180, t0: D('2024-07-06') + 9 * H, t1: D('2024-07-09') + 11 * H};
  it('round-trips with minute from/to, at inside it', () => {
    const at = D('2024-07-07');
    const q = selectionToQuery(place, at, new URLSearchParams('x=1&album=zz&mode=range&near=1,2,3'), null);
    expect(q.toString()).toBe(`x=1&near=42.8174%2C-1.6422%2C180&from=2024-07-06T09%3A00Z&to=2024-07-09T11%3A00Z&at=${at}`);
    expect(selectionFromUrl(q, [], null)).toEqual(place);
  });
  it('whole days stay days', () => {
    const sel: Selection = {...place, t0: D('2024-07-06'), t1: D('2024-07-10')};
    const q = selectionToQuery(sel, null, undefined, null);
    expect(q.get('from')).toBe('2024-07-06');
    expect(q.get('to')).toBe('2024-07-09');
    expect(selectionFromUrl(q, [], null)).toEqual(sel);
  });
  it('a bad near falls back to the range; album wins over near; no span, no selection', () => {
    expect(selectionFromUrl(new URLSearchParams('near=91,0,5&from=2024-07-06&to=2024-07-06'), [], null)).toEqual({kind: 'range', t0: D('2024-07-06'), t1: D('2024-07-07')});
    expect(selectionFromUrl(new URLSearchParams('near=1,2,0&from=2024-07-06&to=2024-07-06'), [], null)?.kind).toBe('range');
    expect(selectionFromUrl(new URLSearchParams('near=1,2,5'), [], null)).toBeNull();
    const albums = [{id: 'alb', start: D('2024-07-01'), end: D('2024-07-09')}];
    expect(selectionFromUrl(new URLSearchParams('album=alb&near=1,2,5'), albums, null)?.kind).toBe('album');
  });
  it('parseNear / nearParam', () => {
    expect(parseNear('42.817401,-1.642249,180')).toEqual({lat: 42.8174, lon: -1.64225, r: 180});
    expect(nearParam({lat: 42.8174, lon: -1.64225, r: 180})).toBe('42.8174,-1.64225,180');
    for (const bad of [null, '', '1,2', '1,2,3.5', '1,2,-3', 'a,b,c', '0,181,5']) expect(parseNear(bad)).toBeNull();
    expect([fRadius(180), fRadius(1234), fRadius(37_400)]).toEqual(['180 m', '1.2 km', '37 km']);
  });
});

describe('place selections', () => {
  const a: Selection = {kind: 'place', lat: 1, lon: 2, r: 30, t0: 10, t1: 20};
  it('sameSelection compares the circle and the span', () => {
    expect(sameSelection(a, {...a})).toBe(true);
    expect(sameSelection(a, {...a, r: 31})).toBe(false);
    expect(sameSelection(a, {...a, lat: 1.00001})).toBe(false);
    expect(sameSelection(a, {...a, t1: 21})).toBe(false);
    expect(sameSelection(a, {kind: 'range', t0: 10, t1: 20})).toBe(false);
    expect(sameSelection({kind: 'range', t0: 10, t1: 20}, a)).toBe(false);
    expect(sameSelection(a, null)).toBe(false);
  });
  it('placeIndex: the matching rows as an index, cached by value per library index', () => {
    const s: Extract<Selection, {kind: 'place'}> = {kind: 'place', lat: P[0], lon: P[1], r: 200, t0: D('2024-07-06'), t1: D('2024-07-10')};
    const p = placeIndex(s, lib);
    expect(p.id).toEqual(['a0', 'a1', 'a4', 'a5']);
    expect(placeIndex({...s}, lib)).toBe(p);
    const lib2 = ix([['2024-07-06T09:00:00Z', P[0], P[1]]]);
    expect(placeIndex(s, lib2).id).toEqual(['a0']);
    expect(placeIndex({...s, r: 140}, lib).id).toEqual(['a0', 'a1', 'a5']);
  });

  afterEach(() => { vi.unstubAllGlobals(); selection.sel = null; selection.resetZoom(); library.index = null; });
  it('active is the place index, contiguous; Back/Forward onto it via the URL', () => {
    library.index = lib;
    const range: Selection = {kind: 'range', t0: D('2024-07-06'), t1: D('2024-07-10')};
    selection.sel = range;
    const s: Selection = {kind: 'place', lat: P[0], lon: P[1], r: 200, t0: D('2024-07-06'), t1: D('2024-07-10')};
    selection.zoomInto(s, 'Pamplona · 4 photos', null);
    const act = selection.active!;
    expect([act.lo, act.hi, act.ix.id]).toEqual([0, 4, ['a0', 'a1', 'a4', 'a5']]);
    const q = selectionToQuery(s, null);
    // Back onto the range pops the zoom; Forward onto the place is a new, equal selection with the same rows.
    vi.stubGlobal('location', {search: '?from=2024-07-06&to=2024-07-09'});
    applyUrl([]);
    expect([selection.sel, selection.stack.length]).toEqual([range, 0]);
    vi.stubGlobal('location', {search: '?' + q});
    applyUrl([]);
    expect(sameSelection(selection.sel, s)).toBe(true);
    expect(selection.active!.ix).toBe(act.ix);
  });
});

describe('enclosingCircle across the antimeridian', () => {
  it('stays a small circle, centre normalised', () => {
    const c = enclosingCircle([[0, 179.9995], [0, -179.9995]])!;
    expect(c.r).toBeLessThan(120);
    expect(Math.abs(c.lon)).toBeCloseTo(180, 3);
    expect(parseNear(nearParam(c))).toEqual(c);
    expect([...placeRows(ix([['2024-01-01T00:00:00Z', 0, 179.9995], ['2024-01-01T01:00:00Z', 0, -179.9995]]), c, 0, Infinity)]).toEqual([0, 1]);
  });
});
