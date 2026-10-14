// What went wrong, in words a stranger with their own Immich can act on: one table per scope
// (library index, albums, media), keyed by the backend's ApiError code. A new server code needs
// one row here; anything unknown falls back to the generic text plus the server's own message.
import {ApiFailure} from './index/refresh.ts';
import {library} from './index/store.svelte.ts';

export const PERMISSIONS = 'asset.read, asset.view and album.read';

/** `retry`: what the Retry button does (a reload for an expired viewer session or an updated viewer). */
export interface Explained { title: string; next: string; retry: 'load' | 'reload' }

const INDEX: Record<string, Omit<Explained, 'retry'> & {retry?: Explained['retry']}> = {
  auth: {title: 'Immich rejected the API key', next: `Check IMMICH_API_KEY: it must be valid and have the permissions ${PERMISSIONS}. Reading the timeline needs asset.read.`},
  unavailable: {title: 'Immich isn’t reachable', next: 'It may still be starting: retry in a few seconds. If this persists, check IMMICH_URL and that Immich is running.'},
  'not-found': {title: 'Immich doesn’t know this endpoint', next: 'Check that IMMICH_URL points at Immich (without /api) and that its version is supported.'},
  invalid: {title: 'The viewer sent a request its backend refused', next: 'Reload the page; if this persists, the viewer and its backend may be out of sync.'},
  'signed-out': {title: 'Signed out', next: 'Your session with the viewer expired. Reload the page to sign in again.', retry: 'reload'},
  outdated: {title: 'The viewer was updated', next: 'Reload the page to get the new version.', retry: 'reload'},
  network: {title: 'Can’t reach the viewer’s server', next: 'Check your connection and that the viewer is running, then retry.'},
};

/** A failure of the library index (the only failure that says anything about the key itself). */
export function explainIndex(e: unknown): Explained {
  const code = e instanceof ApiFailure ? e.code : undefined;
  const row = code ? INDEX[code] : undefined;
  if (row) return {retry: 'load', ...row};
  return {title: 'Loading the library failed', next: `${e instanceof Error ? e.message : String(e)} Retry, or check the viewer’s logs.`, retry: 'load'};
}

/** The Retry button for the library: reloads the page when only that helps, else a new run (the cache stays). */
export function retryLibrary() {
  if (explainIndex(library.failure).retry === 'reload') location.reload();
  else void library.load();
}

/** Albums (the list, or one album's photos) failing never means a bad key: only the albums are affected. */
export function explainAlbums(e: unknown, what = 'Albums'): string {
  const code = e instanceof ApiFailure ? e.code : undefined;
  if (code === 'auth') return `${what} unavailable: add album.read to the API key`;
  if (code === 'unavailable') return `${what} unavailable: Immich isn’t reachable right now`;
  if (code === 'not-found') return 'This album is no longer in Immich';
  if (code === 'signed-out') return 'Signed out: reload the page';
  if (code === 'network') return `${what} unavailable: can’t reach the viewer’s server`;
  return `${what} unavailable: ${e instanceof Error ? e.message : String(e)}`;
}

// ---- media (thumbnails, previews, video) ----

/** Why an image or video didn't show. `decode`: the bytes arrived but the browser can't render them. */
export type MediaFailure = 'permission' | 'not-found' | 'unavailable' | 'network' | 'signed-out' | 'decode' | 'other';

/**
 * Classifies a media answer. `status` 0 = the request itself failed; `opaque` = a redirect (the
 * viewer's own session expired). A 2xx means the request was fine, so the element failed to decode.
 */
export function classifyMedia(status: number, code?: string, opaque = false): MediaFailure {
  if (opaque) return 'signed-out';
  if (status === 0) return 'network';
  if (status >= 200 && status < 300) return 'decode';
  if (code === 'auth') return 'permission';
  if (status === 404 || code === 'not-found') return 'not-found';
  if (status === 503 || code === 'unavailable') return 'unavailable';
  // The backend never answers 401/403 itself; those come from an auth proxy in front of it.
  if (status === 401 || status === 403) return 'signed-out';
  return 'other';
}

/**
 * Asks the relay again for a media URL that failed in an <img>/<video> (elements don't expose the
 * HTTP status). Only the first byte is requested and the body is dropped: for a video this is cheap.
 */
export async function probeMedia(url: string, f: typeof fetch = fetch): Promise<MediaFailure> {
  let res: Response;
  try { res = await f(url, {headers: {range: 'bytes=0-0'}, redirect: 'manual'}); } catch { return 'network'; }
  if (res.type === 'opaqueredirect') return classifyMedia(0, undefined, true);
  let code: string | undefined;
  if (!res.ok && res.headers.get('content-type')?.includes('json')) code = ((await res.json().catch(() => ({}))) as {code?: string}).code;
  else void res.body?.cancel();
  return classifyMedia(res.status, code);
}

/** One line for a failed photo/video; `retry`: worth a Retry button (transient). */
export function explainMedia(kind: MediaFailure, video: boolean): {text: string; retry: boolean} {
  const what = video ? 'video' : 'photo';
  switch (kind) {
    case 'permission': return {text: `No permission to show this ${what}: the API key needs asset.view.`, retry: false};
    case 'not-found': return {text: `This ${what} is no longer in Immich (deleted, or its file is missing).`, retry: false};
    case 'unavailable': return {text: 'Immich isn’t reachable right now.', retry: true};
    case 'network': return {text: 'The viewer’s server didn’t answer. Check your connection.', retry: true};
    case 'signed-out': return {text: 'Signed out: reload the page.', retry: false};
    case 'decode': return {text: video ? 'This video can’t be played here: the browser doesn’t support its format.' : 'The preview arrived but couldn’t be decoded.', retry: false};
    default: return {text: `The ${what} couldn’t be loaded.`, retry: true};
  }
}
