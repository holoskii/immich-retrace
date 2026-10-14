// One check at boot so a misconfiguration shows up in the server log, naming the step that failed:
// connect (DNS/refused/TLS), HTTP (not Immich at that URL), key, permission. It never wakes Immich
// on purpose and never blocks startup: main.ts doesn't await it, and a sleeping Immich (wake gate's
// loading page) ends it early. Note that a stopped gate starts Immich on any request, this one too.

import {HttpError, ImmichClient, isGatePage, keyRejected, PERMISSIONS, wrongPathToWebApp} from './immich.ts';

/** Any id: Immich checks the key's permission before the asset exists (403 vs 400). */
const NO_ASSET = '00000000-0000-4000-8000-000000000000';
export const SUPPORTED_MAJOR = 3;

export type SelfCheck = {ok: true; version: string | null} | {ok: false; step: 'connect' | 'http' | 'key' | 'permission' | 'asleep'; message: string};

export async function selfCheck(immich: ImmichClient, timeoutMs = 15_000): Promise<SelfCheck> {
  const at = `IMMICH_URL=${immich.baseUrl}`;
  const get = (path: string, auth = false, method: 'GET' | 'HEAD' = 'GET') => immich.probe(path, {auth, method, timeoutMs});
  try {
    const ping = await get('/server/ping');
    if (isGatePage(ping) && await wrongPathToWebApp(ping)) return {ok: false, step: 'http', message: immich.webAppNotApi().message};
    if (isGatePage(ping) || ping.status === 503) {
      if (!ping.bodyUsed) await ping.body?.cancel();
      return {ok: false, step: 'asleep', message: `Immich at ${at} is starting or stopped behind a wake gate; skipped the key check (it is woken on the first request).`};
    }
    const pong = ping.ok && ((await ping.json().catch(() => null)) as {res?: string} | null)?.res === 'pong';
    if (!pong) {
      if (!ping.bodyUsed) await ping.body?.cancel();
      return {ok: false, step: 'http', message: `${at} answered HTTP ${ping.status} to /api/server/ping${ping.ok ? ' without a pong' : ''}: not Immich's base URL? (no /api suffix, include the port)`};
    }

    // Public endpoint; only for the log and the version warning.
    const v = await get('/server/version').then(r => r.ok ? r.json() as Promise<{major: number; minor: number; patch: number}> : null).catch(() => null);
    const version = v ? `${v.major}.${v.minor}.${v.patch}` : null;

    // One request per permission the viewer uses; 401 = bad key, 403 = permission missing.
    const checks: [string, string, 'GET' | 'HEAD'][] = [
      ['asset.read', '/timeline/buckets', 'GET'],
      ['album.read', '/albums', 'GET'],
      ['asset.view', `/assets/${NO_ASSET}/thumbnail`, 'HEAD'],
    ];
    for (const [permission, path, method] of checks) {
      const res = await get(path, true, method);
      if (res.status === 401) return {ok: false, step: 'key', message: (await keyRejected(res)).message};
      if (res.status === 403) {
        await res.body?.cancel();
        return {ok: false, step: 'permission', message: `The API key lacks ${permission} (${method} /api${path} → 403). It needs ${PERMISSIONS}.`};
      }
      await res.body?.cancel();
    }
    return {ok: true, version};
  } catch (err) {
    if (err instanceof HttpError) return {ok: false, step: 'connect', message: err.message.includes('IMMICH_URL') ? err.message : `${at}: ${err.message}`};
    return {ok: false, step: 'connect', message: `${at}: ${err instanceof Error ? err.message : String(err)}`};
  }
}

/** Logs one line with the outcome. */
export async function logSelfCheck(immich: ImmichClient, log: Pick<Console, 'log' | 'warn'> = console) {
  const r = await selfCheck(immich);
  if (!r.ok) {
    (r.step === 'asleep' ? log.log : log.warn)(`self-check (${r.step}): ${r.message}`);
    return r;
  }
  const major = r.version ? Number(r.version.split('.')[0]) : null;
  log.log(`self-check: Immich ${r.version ?? '(version unknown)'} at IMMICH_URL=${immich.baseUrl}, API key OK (${PERMISSIONS})`);
  if (major !== null && major !== SUPPORTED_MAJOR) log.warn(`self-check: Immich ${r.version} is untested; this viewer targets Immich v${SUPPORTED_MAJOR}.x (it uses internal timeline endpoints).`);
  return r;
}
