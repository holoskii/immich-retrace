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

/**
 * A trip's name without the dates its album name may end with ("San Sebastián to Huesca, 6–10 Sep 2024" →
 * "San Sebastián to Huesca"): the pill and the card show the dates on their own line. The folder prefix goes too.
 * Unchanged when the name carries no dates (the desktop readout then adds them).
 */
export function tripName(name: string) {
  const n = albumLabel(name), m = /^(.*\S)\s*,\s*[^,]*\b\d{4}\s*$/.exec(n);
  return m && /\d/.test(n.slice(m[1].length)) ? m[1] : n;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Whether an album's name ends with its own dates ("…, 6–10 Sep 2024" for 6–10 Sep 2024: its first and last day, its
 * month(s) and year, and no other month or year), so a readout needn't repeat them. "Paris, Summer 2024" or another
 * trip's dates don't count. `start`/`end`: the album's days (midnight read as UTC).
 */
export function nameHasDates(name: string, start: number, end: number) {
  const full = albumLabel(name), short = tripName(name);
  if (short === full) return false;
  const tail = full.slice(short.length).toLowerCase(), s = new Date(start), e = new Date(end);
  const nums = (tail.match(/\d+/g) ?? []).map(Number);
  const years = nums.filter(n => n >= 1000), days = nums.filter(n => n < 1000);
  const months = (tail.match(/\p{L}+/gu) ?? []).map(w => (w.length >= 3 ? MONTHS.indexOf(w.slice(0, 3)) : -1));
  const wantM = new Set([s.getUTCMonth(), e.getUTCMonth()]), wantY = new Set([s.getUTCFullYear(), e.getUTCFullYear()]);
  return years.includes(e.getUTCFullYear()) && years.every(y => wantY.has(y))
    && days.includes(s.getUTCDate()) && days.includes(e.getUTCDate()) && days.every(d => d === s.getUTCDate() || d === e.getUTCDate())
    && months.includes(e.getUTCMonth()) && months.every(m => wantM.has(m));
}

// ---- formatting (read as UTC: the axis, album dates and labels are local wall time read as UTC, see `toLocal`) ----

const F_DAY = new Intl.DateTimeFormat('en-GB', {timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric'});
/** "12 May 2023" */
export const fDay = (t: number) => F_DAY.format(t);
/** 12345 → "12 345" (a narrow no-break space). */
export const fNum = (n: number) => Math.round(n).toLocaleString('en-US').replace(/,/g, '\u202f');
