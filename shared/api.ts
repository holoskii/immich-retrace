// The viewer's own API between backend (server/) and browser (web/). Immich's internal timeline
// shapes never reach the browser: server/adapter.ts normalizes them into these.

/** Bump when any shape below changes; the browser drops caches with another version. */
export const SCHEMA_VERSION = 2;

/** Error body for every non-2xx /api answer. `code: 'auth'` = Immich rejected the API key. */
export interface ApiError {
  error: string;
  code?: 'auth' | 'unavailable' | 'not-found' | 'invalid';
}

/** GET /api/index — the month list; cheap, fetched first on every visit. */
export interface IndexManifest {
  schema: number;
  /** Stable, opaque id of (Immich URL, API key): namespaces the browser cache. */
  library: string;
  /** Ascending by month. Counts are Immich's (may differ slightly from rows after filtering). */
  months: {month: string /* YYYY-MM */; count: number}[];
}

/** Assets as parallel columns, one row per asset, row order unspecified. */
export interface AssetColumns {
  /** Immich asset UUIDs. */
  id: string[];
  /** UTC instant, epoch ms. */
  t: number[];
  /** Local offset in hours (can be fractional); local wall time = t + off·3600e3. */
  off: number[];
  /** 1 = video, 0 = photo. Live Photo video halves are hidden in Immich and never listed. */
  video: (0 | 1)[];
  /** Video duration in ms, 0 for photos or unknown. */
  dur: number[];
  /** null when the asset has no usable GPS (missing, exactly 0,0, or out of range). Never 0 for "missing". */
  lat: (number | null)[];
  lon: (number | null)[];
  thumbhash: (string | null)[];
  /** width / height. */
  ratio: number[];
  city: (string | null)[];
  country: (string | null)[];
}

/** GET /api/index/:month (YYYY-MM) — one month. Months are Immich's buckets, i.e. by local calendar date. */
export interface MonthColumns extends AssetColumns {
  month: string;
}

/** GET /api/albums — every album the key can read (owned and shared), any span. */
export interface AlbumSummary {
  id: string;
  name: string;
  /** Epoch ms of first/last asset; null for an empty album. */
  start: number | null;
  end: number | null;
  count: number;
  shared: boolean;
  /** Opaque; changes when membership changes (updatedAt + count + last-asset timestamp). */
  version: string;
}

/**
 * GET /api/albums/:id/assets — every member as columns, deduped by id. Shared albums can hold
 * other users' assets, which the library index doesn't have, hence full rows and not just ids.
 */
export interface AlbumMembers {
  id: string;
  version: string;
  columns: AssetColumns;
}

/** GET /api/config — deployment settings the browser needs. */
export interface ViewerConfig {
  /** MapLibre style JSON URL. */
  mapStyleUrl: string;
  /** Immich's public base URL for "Open in Immich" links; null when not configured. */
  immichPublicUrl: string | null;
}
