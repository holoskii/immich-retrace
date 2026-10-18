// Shared by every shell (the desktop overview, the map, the demo, the phone's Trips tab): time units, row counts,
// album spans and names, number and day formatting. Nothing here may import from overview/ (the phone shell's
// import graph stays free of it; tests/bundle.test.ts checks the build).
import type {AlbumSummary} from '../../../shared/api.ts';
import type {IndexColumns} from './index/model.ts';

export const DAY = 86400e3;
export const HOUR = 3600e3;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ---- exact counts over index rows (readout) ----

const prefixes = new WeakMap<IndexColumns, {v: Uint32Array; g: Uint32Array}>();

/** Photos / videos / with-GPS among rows lo..hi-1; O(1) after one O(n) prefix pass per index. */
export function countRows(ix: IndexColumns, lo: number, hi: number) {
  let p = prefixes.get(ix);
  if (!p) {
    const v = new Uint32Array(ix.n + 1), g = new Uint32Array(ix.n + 1);
    for (let r = 0; r < ix.n; r++) { v[r + 1] = v[r] + ix.video[r]; g[r + 1] = g[r] + ix.gps[r]; }
    prefixes.set(ix, p = {v, g});
  }
  lo = clamp(lo, 0, ix.n); hi = clamp(hi, lo, ix.n);
  const videos = p.v[hi] - p.v[lo];
  return {photos: hi - lo - videos, videos, gps: p.g[hi] - p.g[lo]};
}

// ---- albums with dates (the overview's rail, the demo landing, the phone's trip cards) ----

export type RailAlbum = AlbumSummary & {start: number; end: number};

/** Albums with a date span, oldest first; only those `keep` accepts when given (trips: `Trips.isTrip` in trips.ts). */
export function railAlbums(albums: AlbumSummary[], keep?: (a: AlbumSummary) => boolean): RailAlbum[] {
  return albums
    .filter((a): a is RailAlbum => a.start != null && a.end != null && a.count > 0 && (!keep || keep(a)))
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Display name: drops a leading `YYYY_` / `YYYY_MM_` (or legacy `YYYY-MM_`) folder prefix. */
export const albumLabel = (name: string) => name.replace(/^\d{4}([-_]\d\d)?_/, '') || name;

// ---- formatting (read as UTC: the axis, album dates and labels are local wall time read as UTC, see `toLocal`) ----

const F_DAY = new Intl.DateTimeFormat('en-GB', {timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric'});
/** "12 May 2023" */
export const fDay = (t: number) => F_DAY.format(t);
/** 12345 → "12 345" (a narrow no-break space). */
export const fNum = (n: number) => Math.round(n).toLocaleString('en-US').replace(/,/g, '\u202f');
