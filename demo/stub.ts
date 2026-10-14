// Immich stub for the public demo: serves demo/manifest.json + demo/data/media with exactly the
// Immich v3 endpoints and response shapes the viewer's server/immich.ts and server/adapter.ts use.
//
//   node demo/stub.ts                       listens on :2283 (STUB_PORT to change)
//   IMMICH_URL=http://localhost:2283 IMMICH_API_KEY=demo node server/main.ts
//
// Any non-empty x-api-key is accepted. Nothing is ever written.

import {readFile, stat} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
// Two demo users: 'me' is whoever the API key belongs to; 'friend' shares an album with them.
import {USERS} from './config.ts';
import {albumMembers, type DemoAlbum, type DemoAsset, type DemoManifest, type DemoUser} from './manifest.ts';

export const STUB_VERSION = {major: 3, minor: 1, patch: 0};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json; charset=utf-8'}});
// Immich's error body shape (NestJS): {message, error, statusCode}.
const fail = (status: 400 | 401 | 404, message: string) =>
  json({message, error: {400: 'Bad Request', 401: 'Unauthorized', 404: 'Not Found'}[status], statusCode: status}, status);

/** Local wall time as epoch ms (what Immich buckets by). */
const localMs = (a: DemoAsset) => Date.parse(a.takenAt) + a.localOffsetHours * 3600e3;
const monthOf = (a: DemoAsset) => new Date(localMs(a)).toISOString().slice(0, 7);
/** Immich's fileCreatedAt column: UTC without the zone suffix. */
const noZone = (iso: string) => iso.replace(/Z$/, '');

export interface StubOptions {
  manifest: DemoManifest;
  /** Directory with <asset id>/{thumbnail.jpg,preview.jpg,video.mp4}. */
  mediaDir: string;
}

export function createStub({manifest, mediaDir}: StubOptions): (req: Request) => Promise<Response> {
  const byId = new Map(manifest.assets.map(a => [a.id, a]));
  // The key user's own timeline: assets they own. Others' assets come only through shared albums.
  const mine = manifest.assets.filter(a => a.owner === 'me');
  const albums = new Map(manifest.albums.map(al => [al.id, {album: al, members: albumMembers(manifest, al)}]));
  // Same instant for every "createdAt/updatedAt" so album versions are stable across restarts.
  const frozenAt = manifest.generatedAt;

  const userDto = (u: DemoUser) => ({...USERS[u], profileImagePath: '', avatarColor: 'primary', profileChangedAt: frozenAt});
  const albumDto = (al: DemoAlbum, members: DemoAsset[]) => {
    const times = members.map(a => a.takenAt).sort();
    // Immich: albumUsers = the members other than the owner, with their role.
    const others: DemoUser[] = al.shared ? (al.owner === 'me' ? ['friend'] : ['me']) : [];
    return {
      id: al.id,
      albumName: al.name,
      description: al.description,
      albumThumbnailAssetId: members.find(a => a.kind === 'photo' && a.lat !== null)?.id ?? members[0]?.id ?? null,
      createdAt: frozenAt,
      updatedAt: frozenAt,
      ownerId: USERS[al.owner].id,
      owner: userDto(al.owner),
      albumUsers: others.map(u => ({user: userDto(u), role: 'editor'})),
      shared: al.shared,
      hasSharedLink: false,
      isActivityEnabled: false,
      order: 'desc',
      assetCount: members.length,
      // Empty albums have no start/end in Immich (absent, not null).
      ...(times.length ? {startDate: times[0], endDate: times.at(-1), lastModifiedAssetTimestamp: frozenAt} : {}),
    };
  };

  /** Assets in scope for a timeline request: the album's members, or everything. */
  const scope = (q: URLSearchParams): DemoAsset[] | Response => {
    const albumId = q.get('albumId');
    if (albumId === null) return mine;
    if (!UUID.test(albumId)) return fail(400, 'albumId must be a UUID');
    const al = albums.get(albumId);
    return al ? al.members : fail(400, 'Not found or no album.read access');
  };

  function buckets(q: URLSearchParams) {
    const assets = scope(q);
    if (assets instanceof Response) return assets;
    const counts = new Map<string, number>();
    for (const a of assets) counts.set(monthOf(a), (counts.get(monthOf(a)) ?? 0) + 1);
    return json([...counts].sort((a, b) => b[0].localeCompare(a[0])).map(([m, count]) => ({timeBucket: `${m}-01T00:00:00.000Z`, count})));
  }

  function bucket(q: URLSearchParams) {
    const tb = q.get('timeBucket');
    const m = tb?.match(/^(\d{4}-(?:0[1-9]|1[0-2]))-01(?:T00:00:00(?:\.000)?Z?)?$/);
    if (!m) return fail(400, 'timeBucket must be a date string');
    const assets = scope(q);
    if (assets instanceof Response) return assets;
    const rows = assets.filter(a => monthOf(a) === m[1]).sort((a, b) => localMs(b) - localMs(a) || a.id.localeCompare(b.id));
    const col = <T>(f: (a: DemoAsset) => T) => rows.map(f);
    const body: Record<string, unknown[]> = {
      id: col(a => a.id),
      duration: col(a => a.kind === 'video' ? a.durationMs : null),
      visibility: col(() => 'timeline'),
      isFavorite: col(() => false),
      isImage: col(a => a.kind === 'photo'),
      isTrashed: col(() => false),
      livePhotoVideoId: col(() => null),
      fileCreatedAt: col(a => noZone(a.takenAt)),
      localOffsetHours: col(a => a.localOffsetHours),
      createdAt: col(() => frozenAt),
      ownerId: col(a => USERS[a.owner].id),
      projectionType: col(() => null),
      ratio: col(a => a.width / a.height),
      status: col(() => 'active'),
      thumbhash: col(a => a.thumbhash || null),
      city: col(a => a.city),
      country: col(a => a.country),
    };
    // Without withCoordinates=true Immich leaves the columns out entirely.
    if (q.get('withCoordinates') === 'true') {
      body.latitude = col(a => a.lat);
      body.longitude = col(a => a.lon);
    }
    return json(body);
  }

  async function file(path: string, type: string, head: boolean, range: string | null): Promise<Response> {
    let size: number;
    try { size = (await stat(path)).size; } catch { return fail(404, 'Asset media not found'); }
    const headers = {'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=86400, no-transform'};
    const m = range?.match(/^bytes=(\d*)-(\d*)$/);
    if (range && m && (m[1] || m[2])) {
      // "a-b", "a-" or the suffix form "-n" (last n bytes).
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      // Immich answers an unsatisfiable range with 404, not 416.
      if (start >= size || start > end) return fail(404, 'Range not satisfiable');
      const h = {...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1)};
      if (head) return new Response(null, {status: 206, headers: h});
      const buf = await readFile(path);
      return new Response(buf.subarray(start, end + 1), {status: 206, headers: h});
    }
    const h = {...headers, 'content-length': String(size)};
    return new Response(head ? null : await readFile(path), {status: 200, headers: h});
  }

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const method = req.method;
    const path = url.pathname.replace(/\/+$/, '');
    const q = url.searchParams;
    if (method !== 'GET' && method !== 'HEAD') return fail(404, `Cannot ${method} ${url.pathname}`);

    // Public endpoints (no key needed in Immich either).
    if (path === '/api/server/ping') return json({res: 'pong'});
    if (path === '/api/server/version') return json(STUB_VERSION);

    // The demo accepts any API key, but like Immich it requires one.
    if (!req.headers.get('x-api-key')) return fail(401, 'Authentication required');

    if (path === '/api/timeline/buckets') return buckets(q);
    if (path === '/api/timeline/bucket') return bucket(q);
    if (path === '/api/albums') {
      // Like Immich: shared=true → albums shared with the user or shared by them; shared=false →
      // owned and not shared; no parameter → owned (shared or not).
      const shared = q.get('shared');
      const list = [...albums.values()].filter(({album}) =>
        shared === 'true' ? album.shared : shared === 'false' ? album.owner === 'me' && !album.shared : album.owner === 'me');
      return json(list.map(({album, members}) => albumDto(album, members)));
    }
    let m = path.match(/^\/api\/albums\/([^/]+)$/);
    if (m) {
      if (!UUID.test(m[1])) return fail(400, 'id must be a UUID');
      const al = albums.get(m[1]);
      // v3: the album without its assets (membership comes from the timeline endpoints).
      return al ? json(albumDto(al.album, al.members)) : fail(400, 'Not found or no album.read access');
    }
    m = path.match(/^\/api\/assets\/([^/]+)\/(thumbnail|video\/playback)$/);
    if (m) {
      if (!UUID.test(m[1])) return fail(400, 'id must be a UUID');
      const asset = byId.get(m[1]);
      if (!asset) return fail(400, 'Not found or no asset.view access');
      const head = method === 'HEAD';
      if (m[2] === 'thumbnail') {
        const size = q.get('size') ?? 'thumbnail';
        if (!['thumbnail', 'preview', 'fullsize'].includes(size)) return fail(400, 'size must be one of: thumbnail, preview, fullsize');
        // The demo has no originals: fullsize is the preview copy.
        return file(join(mediaDir, asset.id, size === 'thumbnail' ? 'thumbnail.jpg' : 'preview.jpg'), 'image/jpeg', head, null);
      }
      if (asset.kind !== 'video') return fail(404, 'Asset is not a video');
      return file(join(mediaDir, asset.id, 'video.mp4'), 'video/mp4', head, req.headers.get('range'));
    }
    return fail(404, `Cannot ${method} ${url.pathname}`);
  };
}

export function loadManifest(path = new URL('./manifest.json', import.meta.url).pathname): DemoManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as DemoManifest;
}

if (import.meta.main) {
  const {serve} = await import('@hono/node-server');
  const port = Number(process.env.STUB_PORT ?? 2283);
  const mediaDir = process.env.DEMO_MEDIA ?? new URL('./data/media', import.meta.url).pathname;
  const manifest = loadManifest();
  const fetch = createStub({manifest, mediaDir});
  serve({fetch, port}, () => console.log(`immich demo stub: ${manifest.assets.length} assets, ${manifest.albums.length} albums, media ${mediaDir}, listening on :${port}`));
}
