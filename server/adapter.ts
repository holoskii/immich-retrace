// Versioned adapter for Immich v3's internal timeline endpoints (marked internal upstream; shapes
// verified against v3.1.0 server dist, see AGENTS.md). Converts them into shared/api.ts shapes.

import {HttpError, type ImmichClient} from './immich.ts';
import type {AlbumMembers, AlbumSummary, AssetColumns, MonthColumns} from '../shared/api.ts';

interface ImmichBucket {timeBucket: string; count: number}

interface ImmichBucketColumns {
  duration: (number | null)[];
  id: string[];
  isTrashed: boolean[];
  isImage: boolean[];
  fileCreatedAt: string[];
  localOffsetHours: number[];
  status: string[];
  thumbhash: (string | null)[];
  ratio: number[];
  city: (string | null)[];
  country: (string | null)[];
  latitude: (number | null)[];
  longitude: (number | null)[];
}

interface ImmichAlbum {
  id: string;
  albumName: string;
  shared: boolean;
  startDate?: string;
  endDate?: string;
  assetCount: number;
  updatedAt: string;
  lastModifiedAssetTimestamp?: string;
}

const badResponse = () => new HttpError(502, 'Unexpected response from Immich');

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

const REQUIRED_COLUMNS = ['id', 'duration', 'isTrashed', 'isImage', 'fileCreatedAt', 'localOffsetHours',
  'status', 'thumbhash', 'ratio', 'city', 'country', 'latitude', 'longitude'] as const;

function checkColumns(raw: unknown): asserts raw is ImmichBucketColumns {
  if (typeof raw !== 'object' || raw === null) throw badResponse();
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.id)) throw badResponse();
  const n = r.id.length;
  for (const key of REQUIRED_COLUMNS) if (!Array.isArray(r[key]) || r[key].length !== n) throw badResponse();
}

// fileCreatedAt is a UTC instant without a trailing zone, e.g. '2026-08-31T10:18:32.925'.
function parseUtc(s: unknown): number {
  if (typeof s !== 'string') return NaN;
  return Date.parse(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + 'Z');
}

// null when either coordinate is missing/non-finite/out of range, or both are exactly 0 (Immich's
// "no GPS"). Bad GPS is common in EXIF and shouldn't cost the whole month, unlike a bad id or time.
function coord(lat: number | null, lon: number | null): [number | null, number | null] {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return [null, null];
  if ((lat === 0 && lon === 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [null, null];
  return [lat, lon];
}

const emptyColumns = (): AssetColumns => ({id: [], t: [], off: [], video: [], dur: [], lat: [], lon: [], thumbhash: [], ratio: [], city: [], country: []});

/** Converts one timeline/bucket response into columns, dropping trashed/inactive rows. */
export function parseBucketColumns(raw: unknown): AssetColumns {
  checkColumns(raw);
  const out = emptyColumns();
  for (let i = 0; i < raw.id.length; i++) {
    if (raw.isTrashed[i] || raw.status[i] !== 'active') continue;
    const [lat, lon] = coord(raw.latitude[i], raw.longitude[i]);
    const t = parseUtc(raw.fileCreatedAt[i]), off = raw.localOffsetHours[i];
    if (!isUuid(raw.id[i]) || !Number.isFinite(t) || !Number.isFinite(off)) throw badResponse();
    out.id.push(raw.id[i]);
    out.t.push(t);
    out.off.push(off);
    out.video.push(raw.isImage[i] ? 0 : 1);
    out.dur.push(raw.duration[i] ?? 0);
    out.lat.push(lat);
    out.lon.push(lon);
    out.thumbhash.push(raw.thumbhash[i]);
    out.ratio.push(raw.ratio[i]);
    out.city.push(raw.city[i]);
    out.country.push(raw.country[i]);
  }
  return out;
}

function checkBuckets(raw: unknown): asserts raw is ImmichBucket[] {
  if (!Array.isArray(raw)) throw badResponse();
  for (const b of raw as Partial<ImmichBucket>[])
    if (typeof b?.timeBucket !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-01/.test(b.timeBucket) || !Number.isInteger(b.count) || b.count! < 0) throw badResponse();
}

/** Converts timeline/buckets (descending) into the manifest's ascending month list. */
export function parseManifestMonths(raw: unknown): {month: string; count: number}[] {
  checkBuckets(raw);
  return raw
    .map(b => ({month: b.timeBucket.slice(0, 7), count: b.count}))
    .sort((a, b) => a.month.localeCompare(b.month));
}

const albumVersion = (a: ImmichAlbum) => `${a.updatedAt}|${a.assetCount}|${a.lastModifiedAssetTimestamp ?? ''}`;

/** Merges owned + shared-with-me albums (deduped by id) into AlbumSummary[], sorted by start asc. */
export function parseAlbums(owned: unknown, shared: unknown): AlbumSummary[] {
  if (!Array.isArray(owned) || !Array.isArray(shared)) throw badResponse();
  const byId = new Map<string, ImmichAlbum>();
  for (const a of [...(owned as ImmichAlbum[]), ...(shared as ImmichAlbum[])]) {
    if (!isUuid(a?.id) || !Number.isInteger(a.assetCount)) throw badResponse();
    byId.set(a.id, a);
  }
  const date = (s?: string) => {
    if (!s) return null;
    const t = Date.parse(s);
    if (!Number.isFinite(t)) throw badResponse();
    return t;
  };
  const list = [...byId.values()].map((a): AlbumSummary => ({
    id: a.id,
    name: a.albumName,
    start: date(a.startDate),
    end: date(a.endDate),
    count: a.assetCount,
    shared: a.shared,
    version: albumVersion(a),
  }));
  list.sort((a, b) => (a.start === null ? 1 : 0) - (b.start === null ? 1 : 0) || (a.start ?? 0) - (b.start ?? 0));
  return list;
}

/** Runs `fn` over `items` with at most `limit` in flight at once. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => { while (next < items.length) await fn(items[next++]); };
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
}

export async function fetchManifestMonths(immich: ImmichClient, signal?: AbortSignal) {
  return parseManifestMonths(await immich.json('/timeline/buckets', {}, signal));
}

export async function fetchMonthColumns(immich: ImmichClient, month: string, signal?: AbortSignal): Promise<MonthColumns> {
  const raw = await immich.json(`/timeline/bucket`, {timeBucket: `${month}-01`, withCoordinates: 'true'}, signal);
  return {month, ...parseBucketColumns(raw)};
}

export async function fetchAlbums(immich: ImmichClient, signal?: AbortSignal): Promise<AlbumSummary[]> {
  const [owned, shared] = await Promise.all([
    immich.json('/albums', {}, signal),
    immich.json('/albums', {shared: 'true'}, signal),
  ]);
  return parseAlbums(owned, shared);
}

// /albums/:id doesn't return assets in v3: walk its timeline buckets (bounded concurrency) instead.
export async function fetchAlbumMembers(immich: ImmichClient, albumId: string, signal?: AbortSignal): Promise<AlbumMembers> {
  const meta = await immich.json<ImmichAlbum>(`/albums/${albumId}`, {}, signal);
  const buckets = await immich.json('/timeline/buckets', {albumId}, signal);
  checkBuckets(buckets);
  const parts: AssetColumns[] = [];
  await mapLimit(buckets, 4, async b => {
    parts.push(parseBucketColumns(await immich.json(`/timeline/bucket`, {timeBucket: b.timeBucket, albumId, withCoordinates: 'true'}, signal)));
  });
  const columns = emptyColumns(), seen = new Set<string>();
  for (const p of parts) for (let i = 0; i < p.id.length; i++) {
    if (seen.has(p.id[i])) continue;
    seen.add(p.id[i]);
    for (const k of Object.keys(columns) as (keyof AssetColumns)[]) (columns[k] as unknown[]).push(p[k][i]);
  }
  return {id: albumId, version: albumVersion(meta), columns};
}
