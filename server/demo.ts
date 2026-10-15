// Demo mode (DEMO=1): everything the server does differently for the public demo, in one place.
// main.ts wires it with one call (demoFromEnv); with DEMO unset nothing here runs or is routed.
// - ViewerConfig.demo for the browser (the trip to land on, the project link), no "Open in Immich".
// - Attribution for the demo dataset in demo/manifest.json (Kent Wang via Wikimedia Commons, CC BY 4.0
//   or CC BY-SA 4.0 per file): GET /api/demo/credits/:id for the lightbox, GET /credits for all of it.
// The stub (demo/stub.ts) stays a plain Immich stand-in; the credits come from the manifest here.

import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import type {Hono} from 'hono';
import type {ApiError, ViewerConfig} from '../shared/api.ts';
import {REPO_URL, type DemoConfig, type DemoCredit} from '../shared/demo.ts';
import {ConfigError, urlSetting} from './config.ts';

/** The default trip (DEMO_TRIP): a road trip with four stops, GPS on nearly every photo, and video clips. */
export const DEFAULT_DEMO_TRIP = 'San Sebastián to Huesca';

/** DEMO: on for 1/true/yes, off when unset or 0/false/no; anything else is a mistake worth stopping for. */
export function demoFlag(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase() ?? '';
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['', '0', 'false', 'no', 'off'].includes(v)) return false;
  throw new ConfigError(`DEMO must be 1 or 0 (got "${raw}")`);
}

export interface DemoMode {
  config: DemoConfig;
  credits: DemoCredits;
  /** The viewer config with the demo's part: demo settings on, no Immich link (the assets are in a stub). */
  viewer(base: ViewerConfig): ViewerConfig;
  /** Registers the demo's routes (createApp's `extend`). */
  routes(app: Hono): void;
}

/**
 * Demo mode from the environment: null unless DEMO is on. DEMO_TRIP (album id or part of a name),
 * REPO_URL, DEMO_MANIFEST (default demo/manifest.json, read now: a missing file stops the server).
 */
export function demoFromEnv(env: Record<string, string | undefined>, load = loadDemoCredits): DemoMode | null {
  if (!demoFlag(env.DEMO)) return null;
  const config: DemoConfig = {trip: env.DEMO_TRIP?.trim() || DEFAULT_DEMO_TRIP, repoUrl: urlSetting(env, 'REPO_URL') ?? REPO_URL};
  const credits = load(env.DEMO_MANIFEST?.trim() || 'demo/manifest.json');
  return {
    config, credits,
    viewer: base => ({...base, immichPublicUrl: null, demo: config}),
    routes: app => demoRoutes(app, credits),
  };
}

/** The fields of a manifest asset read here (the full shape is DemoAsset in demo/manifest.ts). */
export interface ManifestAsset {
  id: string;
  kind: 'photo' | 'video';
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
  commonsUrl: string;
  takenAt: string;
  modifications: string;
}

export interface DemoCredits {
  get(id: string): DemoCredit | undefined;
  /** The full credits as an HTML page (GET /credits), and gzipped (it is ~700 kB). */
  html: string;
  htmlGz: Uint8Array;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COMMONS_USER = 'https://commons.wikimedia.org/wiki/User:Kent_Wang';

/** "File:Cases Ramos, Barcelona 01.jpg" → "Cases Ramos, Barcelona 01". */
export const fileTitle = (t: string) => t.replace(/^File:/, '').replace(/\.(jpe?g|png|tiff?|webp)$/i, '');

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]!);
/** Only http(s) links make it into the page. */
const href = (u: string) => (/^https?:\/\//.test(u) ? esc(u) : '#');

export function demoCredits(assets: ManifestAsset[]): DemoCredits {
  const byId = new Map<string, DemoCredit>();
  for (const a of assets) {
    byId.set(a.id, {title: fileTitle(a.title), author: a.author, license: a.license, licenseUrl: a.licenseUrl, commonsUrl: a.commonsUrl, modifications: a.modifications});
  }
  const count = (l: string) => assets.filter(a => a.license === l).length;
  const sorted = [...assets].sort((a, b) => a.takenAt.localeCompare(b.takenAt) || a.id.localeCompare(b.id));
  const rows = sorted.map((a, i) => `<tr><td>${i + 1}</td><td>${a.kind}</td><td><a href="${href(a.commonsUrl)}">${esc(fileTitle(a.title))}</a></td>`
    + `<td>${esc(a.author)}</td><td><a href="${href(a.licenseUrl)}">${esc(a.license)}</a></td><td>${esc(a.takenAt.slice(0, 16).replace('T', ' '))}</td><td>${esc(a.modifications)}</td></tr>`).join('\n');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark">
<title>Demo credits · Immich Viewer</title>
<style>
body { margin: 0; padding: 24px 28px 40px; background: #101215; color: #B5B9C0; font: 14px/1.55 system-ui, sans-serif; }
h1 { color: #E9E6DF; font: 500 22px system-ui, sans-serif; margin: 0 0 12px; }
p { max-width: 860px; margin: 0 0 10px; }
a { color: #E8A64E; }
table { border-collapse: collapse; margin-top: 18px; font-size: 12px; }
th, td { text-align: left; vertical-align: top; padding: 4px 10px 4px 0; border-bottom: 1px solid #2A2F37; }
th { color: #E9E6DF; font-weight: 500; position: sticky; top: 0; background: #101215; }
td:first-child, td:nth-child(6) { font-family: ui-monospace, Menlo, Consolas, monospace; white-space: nowrap; color: #8A9099; }
</style></head><body>
<h1>Demo dataset credits</h1>
<p>All ${assets.length} items in this demo are by <b>Kent Wang</b> via <a href="${COMMONS_USER}">Wikimedia Commons</a>, each under its own licence:
${count('CC BY 4.0')} under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>, ${count('CC BY-SA 4.0')} under <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>.
The author and the Wikimedia Foundation do not endorse this project.</p>
<p>Every item is modified: photos are resized copies; for the demo, some lost their GPS and some are shown as a second, fictional user's photos in a shared album;
the videos are pan/zoom clips made from photos. The last column says what was changed for each file.
The licensors provide the material as-is, without warranties (see the licence texts).</p>
<p><a href="/">← Back to the demo</a></p>
<table><thead><tr><th>#</th><th>Item</th><th>File page</th><th>Author</th><th>Licence</th><th>Taken (UTC)</th><th>Modifications</th></tr></thead>
<tbody>
${rows}
</tbody></table>
</body></html>
`;
  return {get: id => byId.get(id), html, htmlGz: gzipSync(html)};
}

/** Reads the manifest at startup; a missing or broken file stops the server with one line (main.ts). */
export function loadDemoCredits(path: string): DemoCredits {
  let assets: ManifestAsset[];
  try {
    assets = (JSON.parse(readFileSync(path, 'utf8')) as {assets: ManifestAsset[]}).assets;
    if (!Array.isArray(assets)) throw new Error('no assets');
  } catch (e) {
    throw new ConfigError(`DEMO is on but the demo manifest at ${path} can't be read (${(e as Error).message}); set DEMO_MANIFEST`);
  }
  return demoCredits(assets);
}

/** Whether an Accept-Encoding header takes gzip: listed (or `*`) with a non-zero q (RFC 9110 §12.5.3). */
export function acceptsGzip(header: string | undefined): boolean {
  let star = false;
  for (const part of (header ?? '').split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';').map(s => s.trim());
    const q = params.find(p => p.startsWith('q='));
    const ok = !q || Number(q.slice(2)) > 0;
    if (name === 'gzip' || name === 'x-gzip') return ok;
    if (name === '*') star = ok;
  }
  return star;
}

/** GET /api/demo/credits/:id (one asset's attribution, JSON) and GET /credits (all of them, a page). */
export function demoRoutes(app: Hono, credits: DemoCredits) {
  app.get('/api/demo/credits/:id', c => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({error: 'Invalid asset id.', code: 'invalid'} satisfies ApiError, 400);
    const credit = credits.get(id);
    if (!credit) return c.json({error: 'No credits for this asset.', code: 'not-found'} satisfies ApiError, 404);
    c.header('cache-control', 'public, max-age=86400');
    return c.json(credit);
  });
  app.get('/credits', c => {
    c.header('cache-control', 'no-cache');
    c.header('vary', 'Accept-Encoding');
    if (!acceptsGzip(c.req.header('accept-encoding'))) return c.html(credits.html);
    c.header('content-encoding', 'gzip');
    c.header('content-type', 'text/html; charset=UTF-8');
    return c.body(credits.htmlGz as Uint8Array<ArrayBuffer>);
  });
}
