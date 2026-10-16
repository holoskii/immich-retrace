// Polite Wikimedia Commons client for the demo builder: descriptive User-Agent, serial requests
// at ~1/s for the API, every API response cached on disk so reruns don't hit Commons again.

import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

export const USER_AGENT = 'immich-retrace-demo-builder/1.0 (https://github.com/REPLACE-ME/immich-retrace; demo dataset, contact via repo issues)';
const API = 'https://commons.wikimedia.org/w/api.php';
const API_INTERVAL_MS = 1000;
const MEDIA_INTERVAL_MS = 250;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let lastApi = 0, lastMedia = 0;

async function politeFetch(url: string, kind: 'api' | 'media'): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const interval = kind === 'api' ? API_INTERVAL_MS : MEDIA_INTERVAL_MS;
    const last = kind === 'api' ? lastApi : lastMedia;
    const wait = last + interval - Date.now();
    if (wait > 0) await sleep(wait);
    if (kind === 'api') lastApi = Date.now(); else lastMedia = Date.now();
    const res = await fetch(url, {headers: {'user-agent': USER_AGENT, 'api-user-agent': USER_AGENT}});
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      const retry = Number(res.headers.get('retry-after'));
      const backoff = Number.isFinite(retry) && retry > 0 ? retry * 1000 : 5000 * 2 ** attempt;
      console.warn(`  ${res.status} from ${new URL(url).host}, waiting ${Math.round(backoff / 1000)} s`);
      await res.body?.cancel();
      await sleep(backoff);
      continue;
    }
    return res;
  }
}

export interface ImageInfo {
  timestamp: string;
  size: number;
  width: number;
  height: number;
  thumburl?: string;
  thumbwidth?: number;
  thumbheight?: number;
  url: string;
  descriptionurl: string;
  sha1: string;
  mime: string;
  extmetadata?: Record<string, {value: string}>;
  metadata?: {name: string; value: unknown}[];
}
export interface CommonsPage {pageid: number; title: string; imageinfo?: ImageInfo[]}

/** One API GET, served from `cacheDir` when it was fetched before. */
async function apiGet(params: Record<string, string>, cacheDir: string): Promise<{query?: {pages?: CommonsPage[]}; continue?: Record<string, string>}> {
  const qs = new URLSearchParams({action: 'query', format: 'json', formatversion: '2', maxlag: '5', ...params}).toString();
  const file = join(cacheDir, createHash('sha1').update(qs).digest('hex').slice(0, 20) + '.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const res = await politeFetch(`${API}?${qs}`, 'api');
  if (!res.ok) throw new Error(`Commons API ${res.status}`);
  const body = await res.json() as {error?: {code: string; info: string}};
  if (body.error) throw new Error(`Commons API error ${body.error.code}: ${body.error.info}`);
  mkdirSync(cacheDir, {recursive: true});
  writeFileSync(file, JSON.stringify(body));
  return body as never;
}

/**
 * Every upload by `user` since `start`, with imageinfo (EXIF metadata, licence, 1280 px thumb URL),
 * in batches of 50. Follows `continue` (incl. partial imageinfo batches) and merges by page id.
 */
export async function listUploads(user: string, start: string, cacheDir: string, onBatch?: (n: number) => void): Promise<CommonsPage[]> {
  const base = {
    generator: 'allimages', gaiuser: user, gaisort: 'timestamp', gaidir: 'ascending', gaistart: start, gailimit: '50',
    prop: 'imageinfo', iiprop: 'timestamp|url|size|mime|sha1|extmetadata|metadata', iiurlwidth: '1280',
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist',
  };
  const pages = new Map<number, CommonsPage>();
  let cont: Record<string, string> = {}, n = 0;
  for (;;) {
    const body = await apiGet({...base, ...cont}, cacheDir);
    onBatch?.(++n);
    for (const p of body.query?.pages ?? []) {
      const prev = pages.get(p.pageid);
      if (!prev || (!prev.imageinfo && p.imageinfo)) pages.set(p.pageid, p);
    }
    if (!body.continue) break;
    cont = body.continue;
  }
  return [...pages.values()];
}

/** Downloads `url` to `file` unless it exists (atomic rename). Returns true when it downloaded. */
export async function download(url: string, file: string): Promise<boolean> {
  if (existsSync(file)) return false;
  const res = await politeFetch(url, 'media');
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) throw new Error(`GET ${url}: unexpected ${type}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(file), {recursive: true});
  writeFileSync(file + '.part', buf);
  renameSync(file + '.part', file);
  return true;
}

/** Strips Commons' utm_* tracking parameters from a media URL. */
export function cleanUrl(u: string): string {
  const url = new URL(u);
  for (const k of [...url.searchParams.keys()]) if (k.startsWith('utm_')) url.searchParams.delete(k);
  return url.toString();
}
