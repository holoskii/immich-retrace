// Pure helpers behind the overview: per-day histogram, pixel sampling, counts, album rail, viewport math.
// Everything here is computed once per index (histogram, prefixes) or is O(width) per frame.
import type {AlbumSummary, IndexManifest} from '../../../../shared/api.ts';
import type {IndexColumns} from '../index/model.ts';

export const DAY = 86400e3;
export const HOUR = 3600e3;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Counts per LOCAL calendar day over [t0, t0 + nd·DAY). Times on this axis are local wall time
 * read as UTC (see `localTime` in model.ts). `gps` / `nogps`: media with / without GPS. `pP`/`pV` are their
 * prefix sums (length nd + 1). `provisional`: counts from the month manifest, GPS unknown (all in `gps`).
 */
export interface Days {
  t0: number; nd: number;
  gps: Float32Array; nogps: Float32Array; provisional?: true;
  pP: Float64Array; pV: Float64Array;
  /** Top of the √ scale: sqrt of the 99.5th-percentile busy day, so one outlier day (a 2 000-photo event) doesn't flatten the rest; taller days clip. */
  sq: number;
  /**
   * The library without outlier dates (`trimOutliers`): the context strip's extent (Jan 1 of the first year → axis end)
   * and the day of its first item. The whole domain / first item when nothing was trimmed.
   */
  core: Span; first: number;
}

export const YEAR = 365 * DAY;
/** An active library (newest item at most this old) ends at today, so the gap since the last photo shows. */
const RECENT = 30 * DAY;

/** Axis: Jan 1 of the first item's year → the day after the last item (after today while it is RECENT). */
function domain(first: number, last: number, now: number): Span {
  const t0 = Date.UTC(new Date(first).getUTCFullYear(), 0, 1);
  const end = (Math.floor((now >= last && now - last <= RECENT ? now : last) / DAY) + 1) * DAY;
  return [t0, Math.max(t0 + DAY, end)];
}

/**
 * Indices [a, b] (inclusive) of the core of n time-sorted items, item i covering [lo(i), hi(i)] with weight w(i).
 * Isolated items at either end are outliers for framing: a camera clock left at 2008 or 1970, one scan decades
 * before the rest, a future date. Rule: a run holding at most 2% of the weight at one end is cut off when a gap of
 * at least a year, and at least a quarter of the remaining span, separates it from the rest. Relative to the
 * library's own span, so a 3-year library drops a lone item a year off while a 20-year one keeps photos 2 years
 * before the bulk; libraries under 50 items keep everything. Trimmed items stay in the histogram and the domain
 * (zoom out, "All years"). O(trimmed run) per end after one O(n) weight sum.
 */
export function trimOutliers(n: number, lo: (i: number) => number, hi: (i: number) => number, w: (i: number) => number = () => 1): [number, number] {
  let total = 0;
  for (let i = 0; i < n; i++) total += w(i);
  let a = 0, b = n - 1;
  if (n < 2 || total < 50) return [a, b];
  const budget = total * 0.02, cut = (gap: number, rest: number) => gap >= YEAR && gap >= rest / 4;
  for (let i = 0, cum = 0; i < n - 1 && (cum += w(i)) <= budget; i++) if (cut(lo(i + 1) - hi(i), hi(n - 1) - lo(i + 1))) a = i + 1;
  for (let j = n - 1, cum = 0; j > a && (cum += w(j)) <= budget; j--) if (cut(lo(j) - hi(j - 1), hi(j - 1) - lo(a))) b = j - 1;
  return [a, b];
}

/** `dom`: the whole axis; `cf` / `cl`: the core's first and last item. */
function finish(dom: Span, cf: number, cl: number, now: number, photo: Float32Array, video: Float32Array, provisional = false): Days {
  const t0 = dom[0], nd = Math.round((dom[1] - t0) / DAY);
  const pP = new Float64Array(nd + 1), pV = new Float64Array(nd + 1);
  const busy: number[] = [];
  for (let k = 0; k < nd; k++) {
    pP[k + 1] = pP[k] + photo[k]; pV[k + 1] = pV[k] + video[k];
    if (photo[k] + video[k] > 0) busy.push(photo[k] + video[k]);
  }
  busy.sort((a, b) => a - b);
  const top = busy.length ? busy[Math.min(busy.length - 1, Math.floor(busy.length * 0.995))] : 1;
  return {
    t0, nd, gps: photo, nogps: video, pP, pV, sq: Math.sqrt(Math.max(1, top)),
    core: domain(cf, cl, now), first: Math.floor(cf / DAY) * DAY, ...(provisional ? {provisional: true as const} : {}),
  };
}

export function daysFromIndex(ix: IndexColumns, now = Date.now()): Days | null {
  if (!ix.n) return null;
  let first = Infinity, last = -Infinity;
  for (let r = 0; r < ix.n; r++) { const l = ix.t[r] + ix.off[r] * HOUR; if (l < first) first = l; if (l > last) last = l; }
  // Rows are sorted by UTC instant; hours of offset don't matter at the scale of the gaps trimmed here.
  const loc = (r: number) => ix.t[r] + ix.off[r] * HOUR, [a, b] = trimOutliers(ix.n, loc, loc);
  const dom = domain(first, last, now), t0 = dom[0], nd = Math.round((dom[1] - t0) / DAY), photo = new Float32Array(nd), video = new Float32Array(nd);
  for (let r = 0; r < ix.n; r++) {
    const k = Math.floor((ix.t[r] + ix.off[r] * HOUR - t0) / DAY);
    if (k >= 0 && k < nd) (ix.gps[r] ? photo : video)[k]++;
  }
  return finish(dom, a > 0 ? loc(a) : first, b < ix.n - 1 ? loc(b) : last, now, photo, video);
}

/** Provisional overview while the first index builds: each month's count spread evenly over its days (GPS unknown). */
export function daysFromMonths(months: IndexManifest['months'], now = Date.now()): Days | null {
  const ms = months.filter(m => /^\d{4}-\d{2}$/.test(m.month) && m.count > 0);
  if (!ms.length) return null;
  const start = (m: string) => Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1, 1);
  const next = (m: string) => Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1);
  ms.sort((a, b) => a.month.localeCompare(b.month));
  const lo = (i: number) => start(ms[i].month), hi = (i: number) => next(ms[i].month) - DAY;
  const [ca, cb] = trimOutliers(ms.length, lo, hi, i => ms[i].count);
  const dom = domain(lo(0), hi(ms.length - 1), now), t0 = dom[0], nd = Math.round((dom[1] - t0) / DAY);
  const photo = new Float32Array(nd), video = new Float32Array(nd);
  for (const m of ms) {
    const a = Math.round((start(m.month) - t0) / DAY), b = Math.round((next(m.month) - t0) / DAY), per = m.count / (b - a);
    for (let k = Math.max(0, a); k < Math.min(nd, b); k++) photo[k] += per;
  }
  return finish(dom, lo(ca), hi(cb), now, photo, video, true);
}

/** Mean per-day density over [ta, tb): a sub-day span reads the day containing its midpoint (sketch `dens`). */
export function dens(h: Days, ta: number, tb: number, out: [number, number] = [0, 0]): [number, number] {
  const a = (ta - h.t0) / DAY, b = (tb - h.t0) / DAY;
  if (b - a < 1) {
    const k = Math.floor((a + b) / 2);
    if (k < 0 || k >= h.nd) { out[0] = out[1] = 0; } else { out[0] = h.gps[k]; out[1] = h.nogps[k]; }
    return out;
  }
  const ka = clamp(Math.floor(a), 0, h.nd), kb = clamp(Math.ceil(b), 0, h.nd), n = Math.max(1, kb - ka);
  out[0] = (h.pP[kb] - h.pP[ka]) / n; out[1] = (h.pV[kb] - h.pV[ka]) / n;
  return out;
}

/** Totals over whole days touching [ta, tb). */
export function sumRange(h: Days, ta: number, tb: number): [number, number] {
  const ka = clamp(Math.floor((ta - h.t0) / DAY), 0, h.nd), kb = clamp(Math.ceil((tb - h.t0) / DAY), 0, h.nd);
  return [h.pP[kb] - h.pP[ka], h.pV[kb] - h.pV[ka]];
}

/** One density sample per pixel over [v0, v1), smoothed when a pixel covers more than ~8 h (as in the sketch). */
export function sample(h: Days, v0: number, v1: number, w: number) {
  const n = Math.max(0, Math.floor(w)), I = new Float32Array(n), V = new Float32Array(n), sc = (v1 - v0) / Math.max(1, w), o: [number, number] = [0, 0];
  for (let x = 0; x < n; x++) { dens(h, v0 + x * sc, v0 + (x + 1) * sc, o); I[x] = o[0]; V[x] = o[1]; }
  return sc > DAY / 3 ? {I: smooth(I), V: smooth(V)} : {I, V};
}

/** 5-tap triangle filter (weights 1 2 3 2 1), renormalized at the edges. */
export function smooth(a: Float32Array): Float32Array {
  const n = a.length, r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, w = 0;
    for (let j = -2; j <= 2; j++) { const k = i + j; if (k >= 0 && k < n) { const q = 3 - Math.abs(j); s += a[k] * q; w += q; } }
    r[i] = s / w;
  }
  return r;
}

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

// ---- album rail ----

export type RailAlbum = AlbumSummary & {start: number; end: number};

/** Albums with a date span, oldest first; only those `keep` accepts when given (trips: `Trips.isTrip` in trips.ts). */
export function railAlbums(albums: AlbumSummary[], keep?: (a: AlbumSummary) => boolean): RailAlbum[] {
  return albums
    .filter((a): a is RailAlbum => a.start != null && a.end != null && a.count > 0 && (!keep || keep(a)))
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

/** The how-to line under the timeline; the album bars are mentioned only while some are on screen. */
export const overviewHint = (bars: boolean) =>
  `Drag across the timeline to pick dates${bars ? ' · click a coloured bar below it to open an album' : ''}`;

/** The readout without a selection; `picker` names the album button. */
export const noSelectionHint = (bars: boolean, picker: string) =>
  `No selection: drag on the timeline${bars ? ', click an album bar,' : ''} or pick from ${picker}`;

/** Display name: drops a leading `YYYY_` / `YYYY-MM_` folder prefix. */
export const albumLabel = (name: string) => name.replace(/^\d{4}(-\d\d)?_/, '') || name;

/**
 * Greedy lane packing over items sorted by x0; `x1` should already include the label width.
 * An item that fits no lane goes to the lane that frees up first and is flagged `squeezed` (draw it without a label).
 */
export function packLanes<T extends {x0: number; x1: number}>(items: T[], lanes: number, gap = 6) {
  const ends = new Array<number>(lanes).fill(-Infinity);
  return items.map(it => {
    let lane = ends.findIndex(e => it.x0 >= e + gap), squeezed = false;
    if (lane < 0) { squeezed = true; lane = ends.indexOf(Math.min(...ends)); }
    ends[lane] = Math.max(ends[lane], it.x1);
    return {...it, lane, squeezed};
  });
}

// ---- viewport ----

export type Span = [number, number];

/** Sketch `pickAlbum`: ≥120 days or 8× the span, centered on it, clamped to the domain. */
export function viewAround(t0: number, t1: number, lo: number, hi: number): Span {
  const span = Math.min(hi - lo, Math.max(120 * DAY, (t1 - t0) * 8)), c = (t0 + t1) / 2;
  const v0 = clamp(c - span / 2, lo, hi - span);
  return [v0, v0 + span];
}

/** Smallest pan that brings [t0, t1) into view; recenters (viewAround) if it is wider than the view. */
export function viewToShow(view: Span, t0: number, t1: number, lo: number, hi: number): Span {
  const span = view[1] - view[0];
  if (t0 >= view[0] && t1 <= view[1]) return view;
  if (t1 - t0 > span * 0.9) return viewAround(t0, t1, lo, hi);
  const pad = Math.min(span * 0.1, (span - (t1 - t0)) / 2);
  const v0 = t0 < view[0] ? t0 - pad : t1 + pad - span;
  const c = clamp(v0, lo, hi - span);
  return [c, c + span];
}

/** Zoom by factor `k` around time `t` at fraction `f` of the width. */
export function zoomAt(view: Span, t: number, f: number, k: number, lo: number, hi: number, min = 7 * DAY): Span {
  const span = clamp((view[1] - view[0]) * k, Math.min(min, hi - lo), hi - lo);
  const v0 = clamp(t - f * span, lo, hi - span);
  return [v0, v0 + span];
}

/**
 * First view: the 12 months ending at the core's end (the last photo, or today for an active library), or the whole
 * core (plus a little room before it) when that spans under 2 years, so any library — an old one, a fixed demo
 * set — opens on its photos.
 */
export function defaultView(h: Days): Span {
  const end = h.core[1], len = end - h.first;
  if (len >= 2 * YEAR) return [Math.max(h.t0, end - YEAR), end];
  return [Math.max(h.t0, Math.min(h.first - Math.max(DAY, len * 0.04), end - 14 * DAY)), end];
}

// ---- brush (sketch `brush`), as a pure step ----

export type Grip = 'l' | 'r' | 'm' | 'n';

export function hitGrip(x: number, xa: number, xb: number, tol = 7): Grip {
  if (Math.abs(x - xa) < tol) return 'l';
  if (Math.abs(x - xb) < tol) return 'r';
  return x > xa && x < xb ? 'm' : 'n';
}

/**
 * New [s0, s1] for a pointer at time `t`. `anchor` is the grab offset from s0 for 'm', the press time for 'n'.
 * Dragging an edge past the other swaps them (the returned grip follows). `snap` rounds edges (days on the wave).
 */
export function dragTo(grip: Grip, anchor: number, t: number, cur: Span, lo: number, hi: number, min: number,
  snap: (t: number) => number = x => x): {span: Span; grip: Grip} {
  t = clamp(t, lo, hi);
  let [s0, s1] = cur;
  if (grip === 'l') s0 = snap(t);
  else if (grip === 'r') s1 = snap(t);
  else if (grip === 'm') { const w = Math.max(min, snap(s1 - s0)); s0 = clamp(snap(t - anchor), lo, hi - w); s1 = s0 + w; }
  else { s0 = snap(Math.min(anchor, t)); s1 = snap(Math.max(anchor, t)); }
  if (s1 < s0) { [s0, s1] = [s1, s0]; grip = grip === 'l' ? 'r' : 'l'; }
  if (s1 - s0 < min) { if (grip === 'l') s0 = s1 - min; else s1 = s0 + min; }
  return {span: [s0, s1], grip};
}

export const snapDay = (t: number) => Math.round(t / DAY) * DAY;

// ---- formatting (read as UTC: the axis, album dates and labels are local wall time read as UTC, see `toLocal`) ----

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', {timeZone: 'UTC', ...o});
const F_DAY = fmt({day: 'numeric', month: 'short', year: 'numeric'}), F_MON = fmt({month: 'short'}), F_DM = fmt({day: 'numeric', month: 'short'});
export const fDay = (t: number) => F_DAY.format(t);
export const fMonth = (t: number) => F_MON.format(t);
export const fDayMonth = (t: number) => F_DM.format(t);
export const fNum = (n: number) => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');

/**
 * Calendar length of [t0, t1) (axis times, read as UTC): "2y 3m 14d", "5d", or hours under two days ("30h", a cluster zoom).
 * Days are the calendar days touched, so 1 May 00:00 → 3 May 00:00 (exclusive) is "2d" and an album 29 Apr → 6 May is "8d".
 */
export function fLength(t0: number, t1: number) {
  if (t1 - t0 < 2 * DAY) return `${Math.max(1, Math.round((t1 - t0) / HOUR))}h`;
  // Inclusive calendar days: the day of t0 through the day of the last instant (t1 is exclusive).
  const a = new Date(Math.floor(t0 / DAY) * DAY), b = (Math.floor((t1 - 1) / DAY) + 1) * DAY;
  // a + k months, clamped to the month's last day (31 Jan + 1m = 28/29 Feb).
  const plus = (k: number) => {
    const y = a.getUTCFullYear(), m = a.getUTCMonth() + k;
    return Date.UTC(y, m, Math.min(a.getUTCDate(), new Date(Date.UTC(y, m + 1, 0)).getUTCDate()));
  };
  let k = (new Date(b).getUTCFullYear() - a.getUTCFullYear()) * 12 + new Date(b).getUTCMonth() - a.getUTCMonth();
  if (plus(k) > b) k--;
  const y = Math.floor(k / 12), m = k % 12, d = Math.round((b - plus(k)) / DAY);
  return [y && `${y}y`, m && `${m}m`, d && `${d}d`].filter(Boolean).join(' ') || '0d';
}
