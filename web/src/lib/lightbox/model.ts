// Lightbox logic without the DOM: stepping through the active range, keeping the open asset
// across index swaps, labels, and the mini-map's route.
import type {Active} from '../selection.svelte.ts';
import type {IndexColumns, LibraryIndex} from '../index/model.ts';

/** The row d steps from r inside active.lo..hi-1, or null past either end (no wrap). */
export function step(a: Pick<Active, 'lo' | 'hi'>, r: number, d: number): number | null {
  const n = r + d;
  return n >= a.lo && n < a.hi ? n : null;
}

/** Rows to preload around r: ±1 first, then ±2. */
export function neighbours(a: Pick<Active, 'lo' | 'hi'>, r: number, k = 2): number[] {
  const out: number[] = [];
  for (let d = 1; d <= k; d++) for (const s of [d, -d]) { const n = step(a, r, s); if (n != null) out.push(n); }
  return out;
}

/** "1 419" (narrow no-break space as the thousands separator). */
export const fCount = (n: number) => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');

/** "123 / 1 419": 1-based position of r in the range. */
export const fPosition = (a: Pick<Active, 'lo' | 'hi'>, r: number) => `${fCount(r - a.lo + 1)} / ${fCount(a.hi - a.lo)}`;

/**
 * The row to show after `active` or the requested row changed. `prev` is what was shown before.
 * A new index (refresh, album reload) reorders rows, so the shown asset is looked up again by id.
 * null = close (the asset left the range, or there is nothing selected).
 */
export function reconcile(a: Active | null, row: number | null, prev: {ix: LibraryIndex; id: string} | null): number | null {
  if (row == null || !a) return null;
  if (prev && prev.ix !== a.ix) {
    const r = a.ix.idToRow.get(prev.id);
    return r != null && r >= a.lo && r < a.hi ? r : null;
  }
  return row >= a.lo && row < a.hi ? row : null;
}

const make = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', {timeZone: 'UTC', ...o});
const fHm = make({hour: '2-digit', minute: '2-digit', hour12: false});
const fLong = make({weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});
const local = (t: number, off: number) => t + off * 3600e3;

/** Local wall-clock "14:32". */
export const fClock = (t: number, off: number) => fHm.format(local(t, off));
/** "Wednesday, 12 August 2026". */
export const fLongDate = (t: number, off: number) => fLong.format(local(t, off));
/** "UTC+6", "UTC−3:30", "UTC". */
export function fOffset(off: number) {
  if (!off) return 'UTC';
  const m = Math.round(Math.abs(off) * 60), h = Math.floor(m / 60), mm = m % 60;
  return `UTC${off < 0 ? '−' : '+'}${h}${mm ? ':' + String(mm).padStart(2, '0') : ''}`;
}
/** "42.8746° N  74.5698° E". */
export const fCoords = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'}  ${Math.abs(lon).toFixed(4)}° ${lon < 0 ? 'W' : 'E'}`;

/** "Bishkek, Kyrgyzstan" / one of them / null. */
export const fPlace = (city: string | null, country: string | null) => [city, country].filter(Boolean).join(', ') || null;

const GAP_MS = 4 * 3600e3;

/** The range's GPS points as [lon, lat] lines, broken on time gaps > 4 h (like the main route); single points dropped. */
export function routeLines(ix: IndexColumns, lo: number, hi: number): [number, number][][] {
  const lines: [number, number][][] = [];
  let cur: [number, number][] = [], last = -Infinity;
  for (let r = lo; r < hi; r++) {
    if (!ix.gps[r]) continue;
    if (ix.t[r] - last > GAP_MS && cur.length) { if (cur.length > 1) lines.push(cur); cur = []; }
    cur.push([ix.lon[r], ix.lat[r]]);
    last = ix.t[r];
  }
  if (cur.length > 1) lines.push(cur);
  return lines;
}

/** [[w, s], [e, n]] of the range's GPS points, or null without any. */
export function gpsExtent(ix: IndexColumns, lo: number, hi: number): [[number, number], [number, number]] | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (let r = lo; r < hi; r++) {
    if (!ix.gps[r]) continue;
    const x = ix.lon[r], y = ix.lat[r];
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return w <= e ? [[w, s], [e, n]] : null;
}

/** Counts per bin over [t0, t1) for the position strip. */
export function bins(t: Float64Array, lo: number, hi: number, t0: number, t1: number, nb: number) {
  const out = new Float32Array(Math.max(1, nb)), span = t1 - t0 || 1;
  for (let r = lo; r < hi; r++) out[Math.min(out.length - 1, Math.max(0, Math.floor((t[r] - t0) / span * out.length)))]++;
  return out;
}
