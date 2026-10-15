// The viewer's own API between backend (server/) and browser (web/). Immich's internal timeline
// shapes never reach the browser: server/adapter.ts normalizes them into these. The demo's own types: shared/demo.ts.

import type {DemoConfig} from './demo.ts';

/** Bump when any shape below changes; the browser drops caches with another version. */
export const SCHEMA_VERSION = 2;

/**
 * Error body for every non-2xx /api answer. `error` is a sentence fit to show as is. Codes:
 * - `auth` (502): Immich rejected the API key: invalid/revoked, or missing a permission
 *   (then `missingPermission` names it, e.g. `album.read`).
 * - `unavailable` (503): Immich is starting behind a wake gate and wasn't up in time, the gate
 *   refused to start it, or Immich didn't answer within the request timeout. Worth retrying.
 * - `unreachable` (502): IMMICH_URL can't be reached at all (DNS, connection refused, TLS). A
 *   configuration or network problem; retrying right away won't help.
 * - `upstream` (502): Immich answered something unexpected (error status, redirect, non-JSON, or
 *   not Immich at all, e.g. a wrong IMMICH_URL path).
 * - `not-found` (404), `invalid` (400): about the request itself.
 * A missing code means an internal error.
 */
export interface ApiError {
  error: string;
  code?: 'auth' | 'unavailable' | 'unreachable' | 'upstream' | 'not-found' | 'invalid';
  /** With `auth`: the permission Immich said the key lacks, when it said so. */
  missingPermission?: string;
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
  /**
   * Local calendar day (midnight, read as UTC) of the first/last asset, as Immich computes them
   * (`localDateTime::date`); null for an empty album. Not instants: see `albumSpan` in web/src/lib/selection.svelte.ts.
   */
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

/** Map style when MAP_STYLE_URL is unset: OpenFreeMap's free public instance (no key; attribution comes with the style). */
export const DEFAULT_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

/** GET /api/config — deployment settings the browser needs. */
export interface ViewerConfig {
  /** MapLibre style JSON URL. */
  mapStyleUrl: string;
  /** Immich's public base URL for "Open in Immich" links; null when not configured (always null in demo mode). */
  immichPublicUrl: string | null;
  /** Public demo mode (DEMO=1, server/demo.ts); null on a normal deployment, which then looks and behaves as without it. */
  demo: DemoConfig | null;
}
