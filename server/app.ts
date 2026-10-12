import {Hono} from 'hono';
import type {Context} from 'hono';
import {HttpError, ImmichClient} from './immich.ts';
import {fetchAlbumMembers, fetchAlbums, fetchManifestMonths, fetchMonthColumns, UUID} from './adapter.ts';
import {SCHEMA_VERSION} from '../shared/api.ts';
import type {ApiError, IndexManifest, ViewerConfig} from '../shared/api.ts';
import {configFromEnv} from './config.ts';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const SIZES = new Set(['thumbnail', 'preview']);

// Response headers worth passing back from Immich media endpoints; everything else is dropped.
const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];

/** A single byte range is forwarded; anything else is ignored (RFC 9110 allows that) → full 200. */
function singleRange(h: string | undefined) {
  const m = h?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2]) || (m[1] && m[2] && Number(m[1]) > Number(m[2]))) return undefined;
  return h;
}

function relay(res: Response) {
  if (!res.ok) {
    void res.body?.cancel();
    // Immich answers 400 for an unknown id (its access check) and 404 for e.g. video of a photo.
    if (res.status === 400 || res.status === 404) throw new HttpError(404, 'Not found in Immich.', 'not-found');
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'Immich rejected the viewer\'s API key. Check its permissions: asset.read, asset.view, album.read.', 'auth');
    throw new HttpError(502, `Immich returned ${res.status}.`);
  }
  const headers = new Headers();
  for (const h of PASS) { const v = res.headers.get(h); if (v) headers.set(h, v); }
  // Stage 1: no browser caching, so edits in Immich show up. Versioned URLs come with the index.
  headers.set('cache-control', 'no-store');
  return new Response(res.body, {status: res.status, headers});
}

const badRequest = (c: Context, error: string) => c.json({error, code: 'invalid'} satisfies ApiError, 400);

export function createApp(immich: ImmichClient, config: ViewerConfig = configFromEnv({})) {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({error: err.message, code: err.code} satisfies ApiError, err.status);
    if (c.req.raw.signal.aborted) return new Response(null, {status: 499}); // browser went away
    console.error(err);
    return c.json({error: 'Internal error.'} satisfies ApiError, 500);
  });

  app.get('/api/health', async c => {
    if (c.req.query('wake') === '1') await immich.wake().catch(() => undefined);
    return c.json({viewer: 'ok', immich: immich.state});
  });

  app.get('/api/config', c => {
    c.header('cache-control', 'no-store');
    return c.json(config);
  });

  // Hono routes HEAD through these GET handlers; it is sent upstream as HEAD, without Range.
  app.get('/api/assets/:id/thumbnail', async c => {
    const id = c.req.param('id'), size = c.req.query('size') ?? 'thumbnail';
    if (!UUID.test(id)) return badRequest(c, 'Invalid asset id.');
    if (!SIZES.has(size)) return badRequest(c, 'size must be thumbnail or preview.');
    const method = c.req.method === 'HEAD' ? 'HEAD' : 'GET';
    // edited=true prefers the edited rendition and falls back to the original one.
    return relay(await immich.media(`/assets/${id}/thumbnail`, {method, query: {size, edited: 'true'}, signal: c.req.raw.signal}));
  });

  app.get('/api/assets/:id/video', async c => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return badRequest(c, 'Invalid asset id.');
    const method = c.req.method === 'HEAD' ? 'HEAD' : 'GET';
    const range = method === 'GET' ? singleRange(c.req.header('range')) : undefined;
    return relay(await immich.media(`/assets/${id}/video/playback`, {method, range, signal: c.req.raw.signal}));
  });

  app.get('/api/index', async c => {
    const months = await fetchManifestMonths(immich, c.req.raw.signal);
    const body: IndexManifest = {schema: SCHEMA_VERSION, library: immich.library, months};
    c.header('cache-control', 'no-store');
    return c.json(body);
  });

  app.get('/api/index/:month', async c => {
    const month = c.req.param('month');
    if (!MONTH.test(month)) return badRequest(c, 'month must be YYYY-MM.');
    c.header('cache-control', 'no-store');
    return c.json(await fetchMonthColumns(immich, month, c.req.raw.signal));
  });

  app.get('/api/albums', async c => {
    c.header('cache-control', 'no-store');
    return c.json(await fetchAlbums(immich, c.req.raw.signal));
  });

  app.get('/api/albums/:id/assets', async c => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return badRequest(c, 'Invalid album id.');
    c.header('cache-control', 'no-store');
    return c.json(await fetchAlbumMembers(immich, id, c.req.raw.signal));
  });

  app.all('/api/*', c => c.json({error: 'Unknown endpoint.'} satisfies ApiError, 404));
  return app;
}
