// Pure data for the map: the route reconstructed from photo GPS, positions along it, pins and
// the strip histogram. No MapLibre or DOM here, so it is unit-tested directly.
import type {Feature, FeatureCollection, LineString, Point} from 'geojson';
import type {IndexColumns} from '../index/model.ts';

const HOUR = 3600e3;

/** First index with a[i] >= x (same as selection.ts's; kept here so this module has no store imports). */
function lowerBound(a: Float64Array, x: number, lo = 0, hi = a.length) {
  while (lo < hi) { const m = (lo + hi) >>> 1; if (a[m] < x) lo = m + 1; else hi = m; }
  return lo;
}

/**
 * When consecutive GPS fixes are not joined by a solid line. A solid line claims "went roughly
 * along here"; anything we can't back up becomes a dashed connector instead.
 */
export const ROUTE = {
  /** No fix for this long: we don't know what happened in between. */
  maxGapMs: 4 * HOUR,
  /** Faster than any surface travel (high-speed rail tops out ~350 km/h): a flight, or a bad fix. */
  maxSpeedKmh: 400,
  /** Steps this short never count as too fast: GPS jitter inside a burst (dt ≈ 0). */
  jitterKm: 1,
  /** Floor for dt in the speed test, so near-simultaneous fixes aren't "infinitely fast". */
  minDtMs: 10e3,
  /** A long jump after a long silence: a straight line would invent the path between. */
  jumpGapMs: 1.5 * HOUR,
  jumpKm: 50,
} as const;

/** Great-circle distance in km. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type BreakReason = 'time' | 'speed' | 'jump' | null;

/** Why rows a → b (a earlier) must not be drawn as one solid segment, or null if they may. */
export function breakBetween(ix: IndexColumns, a: number, b: number): BreakReason {
  const dt = ix.t[b] - ix.t[a];
  if (dt > ROUTE.maxGapMs) return 'time';
  const km = haversineKm(ix.lat[a], ix.lon[a], ix.lat[b], ix.lon[b]);
  if (km > ROUTE.jitterKm && km / (Math.max(dt, ROUTE.minDtMs) / HOUR) > ROUTE.maxSpeedKmh) return 'speed';
  if (dt > ROUTE.jumpGapMs && km > ROUTE.jumpKm) return 'jump';
  return null;
}

/** GPS rows of a selection in time order, split into runs that may be drawn solid. */
export interface Route {
  /** Rows of the index with gps = 1, ascending t. */
  rows: Int32Array;
  /** t of each entry of `rows` (for binary search). */
  t: Float64Array;
  /** Run number of each entry of `rows`. */
  run: Int32Array;
  /** Index into `rows` where each run starts, plus a final rows.length. */
  runStart: Int32Array;
}

/** Splits the GPS rows lo..hi-1 of a t-sorted index into runs (see ROUTE for the break rules). */
export function segmentRoute(ix: IndexColumns, lo: number, hi: number): Route {
  let n = 0;
  for (let r = lo; r < hi; r++) n += ix.gps[r];
  const rows = new Int32Array(n), t = new Float64Array(n), run = new Int32Array(n), starts = [0];
  for (let r = lo, i = 0; r < hi; r++) {
    if (!ix.gps[r]) continue;
    if (i > 0 && breakBetween(ix, rows[i - 1], r)) starts.push(i);
    rows[i] = r; t[i] = ix.t[r]; run[i] = starts.length - 1; i++;
  }
  if (n === 0) starts.length = 0;
  starts.push(n);
  return {rows, t, run, runStart: Int32Array.from(starts)};
}

export type LineProps = {k: number};

/**
 * Solid route lines and dashed gap connectors as GeoJSON. Each run is cut where its time color
 * changes (`buckets` steps over t0..t1), so a line is colored by time with at most about
 * `buckets` + runs features (line-gradient would follow length, not time).
 */
export function routeGeoJSON(ix: IndexColumns, route: Route, t0: number, t1: number, buckets = 96) {
  const lines: Feature<LineString, LineProps>[] = [], gaps: Feature<LineString>[] = [];
  const pos = (i: number) => [ix.lon[route.rows[i]], ix.lat[route.rows[i]]];
  const span = Math.max(1, t1 - t0);
  const bucket = (tm: number) => Math.min(buckets - 1, Math.max(0, Math.floor((tm - t0) / span * buckets)));
  const runs = route.runStart.length - 1;
  for (let k = 0; k < runs; k++) {
    const a = route.runStart[k], b = route.runStart[k + 1];
    if (k > 0) gaps.push({type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates: [pos(a - 1), pos(a)]}});
    let coords = [pos(a)], cur = bucket(route.t[a]);
    for (let i = a + 1; i < b; i++) {
      const bk = bucket(route.t[i - 1]); // a segment takes the color of its start
      if (bk !== cur && coords.length > 1) {
        lines.push(line(coords, cur, buckets));
        coords = [pos(i - 1)];
      }
      cur = bk;
      coords.push(pos(i));
    }
    if (coords.length > 1) lines.push(line(coords, cur, buckets));
  }
  return {
    lines: {type: 'FeatureCollection', features: lines} as FeatureCollection<LineString, LineProps>,
    gaps: {type: 'FeatureCollection', features: gaps} as FeatureCollection<LineString>,
  };
}

const line = (coordinates: number[][], bucket: number, buckets: number): Feature<LineString, LineProps> =>
  ({type: 'Feature', properties: {k: (bucket + .5) / buckets}, geometry: {type: 'LineString', coordinates}});

/** `r`: row in the index the pins were made from; `g`: caller's generation, to reject events on stale data; `t` for cluster time spans. */
export type PinProps = {r: number; v: number; t: number; g: number};

/** One point per GPS row lo..hi-1. */
export function pinsGeoJSON(ix: IndexColumns, lo: number, hi: number, g = 0): FeatureCollection<Point, PinProps> {
  const features: Feature<Point, PinProps>[] = [];
  for (let r = lo; r < hi; r++) {
    if (ix.gps[r]) features.push({type: 'Feature', properties: {r, v: ix.video[r], t: ix.t[r], g}, geometry: {type: 'Point', coordinates: [ix.lon[r], ix.lat[r]]}});
  }
  return {type: 'FeatureCollection', features};
}

/** [west, south, east, north] of the GPS rows lo..hi-1, or null without any. */
export function gpsBounds(ix: IndexColumns, lo: number, hi: number): [number, number, number, number] | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (let r = lo; r < hi; r++) {
    if (!ix.gps[r]) continue;
    w = Math.min(w, ix.lon[r]); e = Math.max(e, ix.lon[r]);
    s = Math.min(s, ix.lat[r]); n = Math.max(n, ix.lat[r]);
  }
  return w <= e ? [w, s, e, n] : null;
}

/**
 * Where the cursor is on the route, for `row` (the asset on show, see cursorRow):
 * - exact: `row` is itself a fix within EXACT_MS of the cursor (a photo without GPS is never shown as recorded);
 * - interp: between two fixes of the same run, or at a fix taken at the same instant as `row` (an estimate, drawn differently);
 * - gap: between runs, on the dashed connector (in transit, position unknown);
 * - before / after: outside the GPS span, pinned to the first / last fix.
 * `i` is the entry of `route.rows` the position is at or after.
 */
export type RoutePos = {lon: number; lat: number; kind: 'exact' | 'interp' | 'gap' | 'before' | 'after'; i: number};
export const EXACT_MS = 2 * 60e3;

export function positionAt(ix: IndexColumns, route: Route, c: number, row: number): RoutePos | null {
  const n = route.rows.length;
  if (!n) return null;
  const at = (i: number, kind: RoutePos['kind']): RoutePos => ({lon: ix.lon[route.rows[i]], lat: ix.lat[route.rows[i]], kind, i});
  if (row >= 0 && ix.gps[row] && Math.abs(ix.t[row] - c) <= EXACT_MS) {
    // The entry of `row` (same-instant fixes sit next to each other in rows order).
    for (let i = lowerBound(route.t, ix.t[row]); i < n && route.t[i] === ix.t[row]; i++) if (route.rows[i] === row) return at(i, 'exact');
  }
  const b = lowerBound(route.t, c);
  if (b < n && route.t[b] === c) return at(b, 'interp');
  if (b === 0) return at(0, 'before');
  if (b === n) return at(n - 1, 'after');
  const a = b - 1, k = (c - route.t[a]) / (route.t[b] - route.t[a]);
  const ra = route.rows[a], rb = route.rows[b];
  return {
    lon: ix.lon[ra] + (ix.lon[rb] - ix.lon[ra]) * k, lat: ix.lat[ra] + (ix.lat[rb] - ix.lat[ra]) * k,
    kind: route.run[a] === route.run[b] ? 'interp' : 'gap', i: a,
  };
}

/** Row in lo..hi-1 closest in time to c (the later one on a tie), or -1 for an empty range. */
export function nearestRow(ix: IndexColumns, lo: number, hi: number, c: number) {
  if (hi <= lo) return -1;
  const b = lowerBound(ix.t, c, lo, hi);
  if (b === lo) return lo;
  if (b === hi) return hi - 1;
  return c - ix.t[b - 1] < ix.t[b] - c ? b - 1 : b;
}

/**
 * The row the cursor is on: `pick` (the row it was put on: a pin, a step, the lightbox) when that lies in lo..hi-1
 * at exactly c, so the right one of several assets taken at the same instant shows; else nearestRow.
 */
export function cursorRow(ix: IndexColumns, lo: number, hi: number, c: number, pick: number | undefined) {
  return pick != null && pick >= lo && pick < hi && ix.t[pick] === c ? pick : nearestRow(ix, lo, hi, c);
}

/**
 * The row before (dir -1) / after (+1) the cursor, or -1 at the end. On an asset (`cur`, at exactly c) it is the
 * neighbouring row, so assets taken at the same instant are each visited; between assets (c may be fractional),
 * the last one before / first one after c.
 */
export function stepRow(ix: IndexColumns, lo: number, hi: number, c: number, cur: number, dir: -1 | 1) {
  if (cur >= lo && cur < hi && ix.t[cur] === c) { const r = cur + dir; return r >= lo && r < hi ? r : -1; }
  if (dir < 0) { const b = lowerBound(ix.t, c, lo, hi); return b > lo ? b - 1 : -1; }
  let a = lo, b = hi; // first row with t > c
  while (a < b) { const m = (a + b) >>> 1; if (ix.t[m] <= c) a = m + 1; else b = m; }
  return a < hi ? a : -1;
}

/** Media with / without GPS per bin over t0..t1. */
export function densityBins(ix: IndexColumns, lo: number, hi: number, t0: number, t1: number, nb: number) {
  const gps = new Float32Array(nb), nogps = new Float32Array(nb), span = t1 - t0;
  for (let r = lo; r < hi; r++) {
    const b = Math.floor((ix.t[r] - t0) / span * nb);
    if (b < 0 || b >= nb) continue;
    (ix.gps[r] ? gps : nogps)[b]++;
  }
  return {gps, nogps};
}

/** Median local offset (hours) of rows lo..hi-1: the selection's "home" time zone for axis labels. */
export function typicalOffset(ix: IndexColumns, lo: number, hi: number) {
  if (hi <= lo) return 0;
  const step = Math.max(1, Math.floor((hi - lo) / 501)), s: number[] = [];
  for (let r = lo; r < hi; r += step) s.push(ix.off[r]);
  s.sort((a, b) => a - b);
  return s[s.length >> 1];
}

/** A name for the place of `rows`: the city if one has most of the named photos (a city break), else the country (a road trip). */
export function placeOf(ix: IndexColumns, rows: Iterable<number>) {
  const city = new Map<string, number>(), country = new Map<string, number>();
  let named = 0;
  for (const r of rows) {
    const c = ix.city[r], k = ix.country[r];
    if (c) { city.set(c, (city.get(c) ?? 0) + 1); named++; }
    if (k) country.set(k, (country.get(k) ?? 0) + 1);
  }
  const top = (m: Map<string, number>) => { let p = '', b = 0; for (const [k, c] of m) if (c > b) { p = k; b = c; } return [p, b] as const; };
  const [c, cn] = top(city), [k] = top(country);
  return c && cn * 2 > named ? c : k || c;
}

/** A stay at one map cluster's place: its photos' first/last time, count and most common place name. */
export interface Visit { t0: number; t1: number; n: number; place: string }
/** Leaves further apart than this, with a GPS fix elsewhere in between, are separate visits (a day trip out stays one). */
export const VISIT_GAP_MS = 36 * HOUR;

/**
 * Splits a cluster's leaf rows into visits, oldest first. `lo..hi` is the range the pins came from: a GPS fix
 * there that isn't a leaf counts as "was elsewhere". No-GPS rows never split (camera shots have no position).
 */
export function clusterVisits(ix: IndexColumns, lo: number, hi: number, leaves: number[]): Visit[] {
  const rows = [...new Set(leaves)].filter(r => r >= lo && r < hi).sort((a, b) => a - b);
  if (!rows.length) return [];
  const leaf = new Set(rows), out: Visit[] = [];
  let start = 0;
  const close = (end: number) => {
    out.push({t0: ix.t[rows[start]], t1: ix.t[rows[end - 1]], n: end - start, place: placeOf(ix, rows.slice(start, end))});
    start = end;
  };
  for (let i = 1; i < rows.length; i++) {
    if (ix.t[rows[i]] - ix.t[rows[i - 1]] <= VISIT_GAP_MS) continue;
    let away = false;
    for (let r = rows[i - 1] + 1; r < rows[i] && !away; r++) away = ix.gps[r] === 1 && !leaf.has(r);
    if (away) close(i);
  }
  close(rows.length);
  return out;
}
