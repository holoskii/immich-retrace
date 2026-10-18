import type {AssetColumns} from '../../../../shared/api.ts';

/** The whole library as parallel columns, one row per asset, sorted by UTC instant ascending. */
export interface IndexColumns {
  n: number;
  id: string[];
  /** UTC instant, epoch ms. */
  t: Float64Array;
  /** Local offset, hours. */
  off: Float32Array;
  video: Uint8Array;
  /** ms, 0 for photos. */
  dur: Float64Array;
  /** NaN when gps[i] is 0; always test gps, never the value. */
  lat: Float64Array;
  lon: Float64Array;
  gps: Uint8Array;
  thumbhash: (string | null)[];
  ratio: Float32Array;
  city: (string | null)[];
  country: (string | null)[];
}

export interface LibraryIndex extends IndexColumns {
  idToRow: Map<string, number>;
}

export function withLookup(cols: IndexColumns): LibraryIndex {
  const idToRow = new Map<string, number>();
  for (let i = 0; i < cols.n; i++) idToRow.set(cols.id[i], i);
  return {...cols, idToRow};
}

export function columnsOf({idToRow: _, ...cols}: LibraryIndex): IndexColumns {
  return cols;
}

/**
 * Merges column sets (months, or an album's members) into one index; an id listed twice keeps its last occurrence.
 * Runs on the main thread: ~15 ms for 30k rows (bench in tests/web-index.test.ts), below the
 * 50 ms that would justify a worker.
 */
export function buildIndex(months: AssetColumns[]): LibraryIndex {
  const at = new Map<string, [AssetColumns, number]>();
  for (const m of months) for (let i = 0; i < m.id.length; i++) at.set(m.id[i], [m, i]);
  // Ties on t broken by id so the order is stable across refreshes.
  const rows = [...at.values()].sort(([a, i], [b, j]) => a.t[i] - b.t[j] || (a.id[i] < b.id[j] ? -1 : a.id[i] > b.id[j] ? 1 : 0));
  const n = rows.length;
  const c: IndexColumns = {
    n, id: new Array(n), t: new Float64Array(n), off: new Float32Array(n), video: new Uint8Array(n),
    dur: new Float64Array(n), lat: new Float64Array(n), lon: new Float64Array(n), gps: new Uint8Array(n),
    thumbhash: new Array(n), ratio: new Float32Array(n), city: new Array(n), country: new Array(n),
  };
  for (let r = 0; r < n; r++) {
    const [m, i] = rows[r], lat = m.lat[i], lon = m.lon[i];
    const has = lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon);
    c.id[r] = m.id[i]; c.t[r] = m.t[i]; c.off[r] = m.off[i]; c.video[r] = m.video[i]; c.dur[r] = m.dur[i];
    c.gps[r] = has ? 1 : 0; c.lat[r] = has ? lat : NaN; c.lon[r] = has ? lon : NaN;
    c.thumbhash[r] = m.thumbhash[i]; c.ratio[r] = m.ratio[i]; c.city[r] = m.city[i]; c.country[r] = m.country[i];
  }
  return withLookup(c);
}

/**
 * The rows `rows` of `ix` (ascending, so the result stays sorted by t) as an index of their own: a selection that is
 * a subset of the library (a place) keeps `{ix, lo, hi}` contiguous this way, as album members do.
 */
export function sliceIndex(ix: IndexColumns, rows: ArrayLike<number>): LibraryIndex {
  const n = rows.length;
  const c: IndexColumns = {
    n, id: new Array(n), t: new Float64Array(n), off: new Float32Array(n), video: new Uint8Array(n),
    dur: new Float64Array(n), lat: new Float64Array(n), lon: new Float64Array(n), gps: new Uint8Array(n),
    thumbhash: new Array(n), ratio: new Float32Array(n), city: new Array(n), country: new Array(n),
  };
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    c.id[i] = ix.id[r]; c.t[i] = ix.t[r]; c.off[i] = ix.off[r]; c.video[i] = ix.video[r]; c.dur[i] = ix.dur[r];
    c.lat[i] = ix.lat[r]; c.lon[i] = ix.lon[r]; c.gps[i] = ix.gps[r];
    c.thumbhash[i] = ix.thumbhash[r]; c.ratio[i] = ix.ratio[r]; c.city[i] = ix.city[r]; c.country[i] = ix.country[r];
  }
  return withLookup(c);
}

/** Local wall-clock time of a row as epoch ms (read it with getUTC*); for calendar days, not ordering. */
export const localTime = (ix: IndexColumns, r: number) => ix.t[r] + ix.off[r] * 3600e3;

export function summarize(ix: IndexColumns) {
  let gps = 0, videos = 0;
  const years = new Map<number, number>();
  for (let r = 0; r < ix.n; r++) {
    gps += ix.gps[r]; videos += ix.video[r];
    const y = new Date(localTime(ix, r)).getUTCFullYear();
    years.set(y, (years.get(y) ?? 0) + 1);
  }
  return {total: ix.n, gps, videos, years};
}
