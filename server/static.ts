// The built web app (dist/web). Vite's hashed files under /assets/ never change, so browsers keep
// them for good; everything else (index.html) is revalidated on every load so a deploy shows up.
// Compressible files are served from the .br/.gz copies made at build time (server/precompress.ts).

import type {MiddlewareHandler} from 'hono';
import {serveStatic} from '@hono/node-server/serve-static';

export const IMMUTABLE_PUBLIC = 'public, max-age=31536000, immutable';

export function staticFiles(root: string): MiddlewareHandler {
  // Static files only; a missing file is a 404. An SPA fallback comes when the UI has routes.
  const serve = serveStatic({root, precompressed: true});
  return async (c, next) => {
    // serveStatic returns its response rather than setting c.res.
    const res = await serve(c, next);
    if (res) c.res = res;
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return;
    if (c.res.status !== 200 && c.res.status !== 206) return;
    c.res.headers.set('cache-control', c.req.path.startsWith('/assets/') ? IMMUTABLE_PUBLIC : 'no-cache');
    // serveStatic only says Vary when it picked a compressed copy; a cache must not hand the
    // uncompressed answer it saw first to every later client either.
    if (!c.res.headers.get('vary')?.toLowerCase().includes('accept-encoding')) c.res.headers.append('vary', 'Accept-Encoding');
  };
}
