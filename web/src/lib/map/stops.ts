// Stops: the places a selection's traveller stayed at, from its time-sorted GPS. They drive ⏮ ⏭ (step by
// stop) and the time strip's ticks. Pure, unit-tested; thresholds tuned on the demo trips (tests/stops.test.ts).
import type {IndexColumns} from '../index/model.ts';
import {haversineKm, placeOf} from './route.ts';

const MIN = 60e3;

export interface StopParams { radiusKm: number; minFixes: number; minMs: number }

export const STOPS: Readonly<StopParams> = {
  /**
   * A fix within this of a stay's centre (the mean of its fixes so far) belongs to it: a town with its sights
   * around it. 1.5–3 km splits one town's sights (or a sanctuary and the hike above it) into several stops.
   */
  radiusKm: 5,
  /** A stay needs this many GPS fixes, or to last minMs; anything smaller is passing through (roadside shots). */
  minFixes: 6,
  minMs: 45 * MIN,
};

/**
 * One stay. Rows lo..hi-1 of the index run from its first fix to its last (photos without GPS in between
 * included); t0/t1 are those fixes' instants. lat/lon: the mean of its fixes. `n`: its GPS fixes.
 */
export interface Stop { lo: number; hi: number; t0: number; t1: number; lat: number; lon: number; n: number; place: string }

/** Longitude into [-180, 180). */
const wrap = (lon: number) => ((lon + 180) % 360 + 360) % 360 - 180;
/** The shorter way from longitude a to b, in degrees (across the antimeridian when that is shorter). */
const lonDelta = (a: number, b: number) => wrap(b - a);

interface Run { first: number; last: number; n: number; lat: number; lon: number }

/**
 * The stops among rows lo..hi-1 of a t-sorted index, oldest first. Consecutive fixes stay in one run while
 * within radiusKm of its running centre; runs too small to be a stay (minFixes, minMs) are dropped as
 * transit; neighbouring stays at the same place (a detour or a stray fix between them) become one.
 */
export function findStops(ix: IndexColumns, lo: number, hi: number, opts: Partial<StopParams> = {}): Stop[] {
  const C = {...STOPS, ...opts};
  const runs: Run[] = [];
  let cur: Run | null = null;
  for (let r = lo; r < hi; r++) {
    if (!ix.gps[r]) continue;
    const la = ix.lat[r], ln = ix.lon[r];
    if (cur && haversineKm(cur.lat, cur.lon, la, ln) <= C.radiusKm) {
      cur.n++; cur.last = r;
      cur.lat += (la - cur.lat) / cur.n; cur.lon = wrap(cur.lon + lonDelta(cur.lon, ln) / cur.n);
    } else {
      cur = {first: r, last: r, n: 1, lat: la, lon: ln};
      runs.push(cur);
    }
  }
  const stays = runs.filter(s => s.n >= C.minFixes || ix.t[s.last] - ix.t[s.first] >= C.minMs);
  const merged: Run[] = [];
  for (const s of stays) {
    const p = merged.at(-1);
    if (p && haversineKm(p.lat, p.lon, s.lat, s.lon) <= C.radiusKm) {
      const n = p.n + s.n;
      p.lat = (p.lat * p.n + s.lat * s.n) / n; p.lon = wrap(p.lon + lonDelta(p.lon, s.lon) * s.n / n);
      p.n = n; p.last = s.last;
    } else merged.push({...s});
  }
  return merged.map(s => {
    const rows: number[] = [];
    for (let r = s.first; r <= s.last; r++) rows.push(r);
    return {lo: s.first, hi: s.last + 1, t0: ix.t[s.first], t1: ix.t[s.last], lat: s.lat, lon: s.lon, n: s.n, place: placeOf(ix, rows)};
  });
}

/**
 * The stop ⏮ (dir -1) / ⏭ (+1) goes to from cursor time c: ⏭ the first stop starting after c; ⏮ the start of
 * the stop c is inside (when past its start), else the last stop starting before c. -1 when there is none.
 */
export function stepStop(stops: readonly Stop[], c: number, dir: -1 | 1): number {
  if (dir > 0) return stops.findIndex(s => s.t0 > c);
  for (let i = stops.length - 1; i >= 0; i--) if (stops[i].t0 < c) return i;
  return -1;
}
