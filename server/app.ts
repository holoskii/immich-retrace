import {Hono} from 'hono';
import type {Context} from 'hono';
import {HttpError, ImmichClient, keyRejected} from './immich.ts';
import {fetchAlbumMembers, fetchAlbums, fetchManifestMonths, fetchMonthColumns, UUID} from './adapter.ts';
import {SCHEMA_VERSION} from '../shared/api.ts';
import type {ApiError, IndexManifest, ViewerConfig} from '../shared/api.ts';
import {configFromEnv} from './config.ts';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const SIZES = new Set(['thumbnail', 'preview']);
/** Cache-busting version from the browser (the asset's thumbhash, base64); never forwarded. */
const VERSION = /^[A-Za-z0-9+/_-]{1,62}={0,2}$/;
const IMMUTABLE = 'private, max-age=31536000, immutable';

// Response headers worth passing back from Immich media endpoints; everything else is dropped.
const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];

/** A single byte range is forwarded; anything else is ignored (RFC 9110 allows that) → full 200. */
function singleRange(h: string | undefined) {
  const m = h?.match(/^bytes=(\d{0,15})-(\d{0,15})$/);
  if (!m || (!m[1] && !m[2]) || (m[1] && m[2] && Number(m[1]) > Number(m[2]))) return undefined;
  return h;
}

/** `cacheControl`: no-store unless the URL is versioned (a new thumbhash = a new URL). */
async function relay(res: Response, cacheControl = 'no-store') {
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw await keyRejected(res);
    void res.body?.cancel();
    // Immich answers 400 for an unknown id (its access check) and 404 for e.g. video of a photo.
    if (res.status === 400 || res.status === 404) throw new HttpError(404, 'Not found in Immich.', 'not-found');
    throw new HttpError(502, `Immich returned ${res.status}.`, 'upstream');
  }
  const headers = new Headers();
  for (const h of PASS) { const v = res.headers.get(h); if (v) headers.set(h, v); }
  headers.set('cache-control', cacheControl);
  return new Response(res.body, {status: res.status, headers});
}

const badRequest = (c: Context, error: string) => c.json({error, code: 'invalid'} satisfies ApiError, 400);

/**
 * `config`: the settings for /api/config, or a function answering them per request (demo mode resolves its trip).
 * `extend`: registers extra routes ahead of the /api catch-all (demo mode: server/demo.ts).
 */
export function createApp(immich: ImmichClient, config: ViewerConfig | (() => Promise<ViewerConfig>) = configFromEnv({}), extend?: (app: Hono) => void) {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({error: err.message, code: err.code, missingPermission: err.missingPermission} satisfies ApiError, err.status);
    if (c.req.raw.signal.aborted) return new Response(null, {status: 499}); // browser went away
    console.error(err);
    return c.json({error: 'Internal error.'} satisfies ApiError, 500);
  });

  app.get('/api/health', async c => {
    if (c.req.query('wake') === '1') await immich.wake().catch(() => undefined);
    return c.json({viewer: 'ok', immich: immich.state});
  });

  app.get('/api/config', async c => {
    c.header('cache-control', 'no-store');
    return c.json(typeof config === 'function' ? await config() : config);
  });

  // Hono routes HEAD through these GET handlers; it is sent upstream as HEAD, without Range.
  app.get('/api/assets/:id/thumbnail', async c => {
    const id = c.req.param('id'), size = c.req.query('size') ?? 'thumbnail', version = c.req.query('c');
    if (!UUID.test(id)) return badRequest(c, 'Invalid asset id.');
    if (!SIZES.has(size)) return badRequest(c, 'size must be thumbnail or preview.');
    if (version !== undefined && !VERSION.test(version)) return badRequest(c, 'c must be the asset\'s thumbhash.');
    const method = c.req.method === 'HEAD' ? 'HEAD' : 'GET';
    // edited=true prefers the edited rendition and falls back to the original one.
    // A versioned URL (c = thumbhash, as Immich's own web UI does) changes when the image does: cache it for good.
    const res = await immich.media(`/assets/${id}/thumbnail`, {method, query: {size, edited: 'true'}, signal: c.req.raw.signal});
    return relay(res, version ? IMMUTABLE : 'no-store');
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

  extend?.(app);

  app.all('/api/*', c => c.json({error: 'Unknown endpoint.'} satisfies ApiError, 404));
  return app;
}
