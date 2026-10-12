import {Hono} from 'hono';
import {HttpError, ImmichClient} from './immich.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
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
    if (res.status === 400 || res.status === 404) throw new HttpError(404, 'Not found in Immich.');
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'Immich rejected the viewer\'s API key. Check its permissions: asset.read, asset.view, album.read.');
    throw new HttpError(502, `Immich returned ${res.status}.`);
  }
  const headers = new Headers();
  for (const h of PASS) { const v = res.headers.get(h); if (v) headers.set(h, v); }
  // Stage 1: no browser caching, so edits in Immich show up. Versioned URLs come with the index.
  headers.set('cache-control', 'no-store');
  return new Response(res.body, {status: res.status, headers});
}

export function createApp(immich: ImmichClient) {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({error: err.message}, err.status);
    if (c.req.raw.signal.aborted) return new Response(null, {status: 499}); // browser went away
    console.error(err);
    return c.json({error: 'Internal error.'}, 500);
  });

  app.get('/api/health', async c => {
    if (c.req.query('wake') === '1') await immich.wake().catch(() => undefined);
    return c.json({viewer: 'ok', immich: immich.state});
  });

  // Hono routes HEAD through these GET handlers; it is sent upstream as HEAD, without Range.
  app.get('/api/assets/:id/thumbnail', async c => {
    const id = c.req.param('id'), size = c.req.query('size') ?? 'thumbnail';
    if (!UUID.test(id)) return c.json({error: 'Invalid asset id.'}, 400);
    if (!SIZES.has(size)) return c.json({error: 'size must be thumbnail or preview.'}, 400);
    const method = c.req.method === 'HEAD' ? 'HEAD' : 'GET';
    // edited=true prefers the edited rendition and falls back to the original one.
    return relay(await immich.media(`/assets/${id}/thumbnail`, {method, query: {size, edited: 'true'}, signal: c.req.raw.signal}));
  });

  app.get('/api/assets/:id/video', async c => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({error: 'Invalid asset id.'}, 400);
    const method = c.req.method === 'HEAD' ? 'HEAD' : 'GET';
    const range = method === 'GET' ? singleRange(c.req.header('range')) : undefined;
    return relay(await immich.media(`/assets/${id}/video/playback`, {method, range, signal: c.req.raw.signal}));
  });

  app.all('/api/*', c => c.json({error: 'Unknown endpoint.'}, 404));
  return app;
}
