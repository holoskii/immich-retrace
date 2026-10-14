import {describe, expect, it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {createApp} from '../server/app.ts';
import {ImmichClient} from '../server/immich.ts';
import {ConfigError, parseImmichUrl, settingsFromEnv} from '../server/config.ts';
import {selfCheck} from '../server/selfcheck.ts';
import type {ApiError} from '../shared/api.ts';

const ID = '0b7b5c7e-1f2a-4c3d-9e8f-123456789abc';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
const gatePage = () => new Response('<html>starting</html>', {status: 200, headers: {'content-type': 'text/html'}});
const pong = () => json({res: 'pong'});
/** What Node's fetch throws for a failed connection. */
const netError = (code: string) => new TypeError('fetch failed', {cause: Object.assign(new Error(code), {code})});
/** Never settles until the request is aborted. */
const hang = (init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)));

type Handler = (path: string, init: RequestInit) => Response | Promise<Response>;
function client(handler: Handler, opts: {wakeTimeoutMs?: number; requestTimeoutMs?: number} = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    return handler(path, init);
  }) as typeof fetch;
  const immich = new ImmichClient({baseUrl: 'http://immich:2283', apiKey: 'k', fetch: fetchImpl, pollMs: 1, wakeTimeoutMs: opts.wakeTimeoutMs ?? 60_000, requestTimeoutMs: opts.requestTimeoutMs});
  return {immich, app: createApp(immich), calls};
}
const body = async (res: Response) => (await res.json()) as ApiError;

describe('IMMICH_URL', () => {
  it.each([
    ['http://immich-server:2283', 'http://immich-server:2283'],
    ['http://immich-server:2283/', 'http://immich-server:2283'],
    ['https://Photos.Example.com/immich//', 'https://photos.example.com/immich'],
  ])('accepts %s', (raw, url) => expect(parseImmichUrl(raw)).toBe(url));

  it.each([
    ['immich-server:2283', /must start with http:\/\/ or https:\/\//],
    ['localhost:2283', /must start with http/],
    ['ftp://immich:2283', /must start with http/],
    ['not a url', /must start with http/],
    ['http://immich:2283/api', /without \/api: use http:\/\/immich:2283 /],
    ['http://immich:2283/api/', /without \/api/],
    ['https://example.com/immich/API', /use https:\/\/example.com\/immich /],
    ['http://immich:2283/?x=1', /query or fragment/],
  ])('rejects %s', (raw, message) => {
    expect(() => parseImmichUrl(raw)).toThrow(ConfigError);
    expect(() => parseImmichUrl(raw)).toThrow(message);
  });

  it('reads the server settings, naming whatever is missing', () => {
    expect(settingsFromEnv({IMMICH_URL: 'http://immich:2283/', IMMICH_API_KEY: ' k '})).toMatchObject({immichUrl: 'http://immich:2283', apiKey: 'k', port: 8080, webDir: 'dist/web'});
    expect(() => settingsFromEnv({IMMICH_API_KEY: 'k'})).toThrow('IMMICH_URL is not set');
    expect(() => settingsFromEnv({IMMICH_URL: 'http://immich:2283', IMMICH_API_KEY: ''})).toThrow('IMMICH_API_KEY is not set');
    expect(() => settingsFromEnv({IMMICH_URL: 'http://immich:2283', IMMICH_API_KEY: 'k', PORT: '80a'})).toThrow(/PORT/);
  });

  it('prints one usage line instead of a stack trace when the environment is incomplete', () => {
    const r = spawnSync(process.execPath, ['server/main.ts'], {env: {PATH: process.env.PATH, IMMICH_URL: 'immich:2283', IMMICH_API_KEY: 'k'}, encoding: 'utf8'});
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr.trim().split('\n')).toHaveLength(1);
    expect(r.stderr).toMatch(/^immich-viewer: IMMICH_URL must start with http.*Usage: .*README/);
  });
});

describe('error classification', () => {
  it.each([
    ['ECONNREFUSED', 'connection refused'],
    ['ENOTFOUND', 'host name not found (DNS)'],
    ['EAI_AGAIN', 'host name not found (DNS)'],
  ])('fails fast on %s instead of polling for a minute', async (code, reason) => {
    const {app, immich, calls} = client(() => { throw netError(code); });
    const res = await app.request('/api/index');
    expect(res.status).toBe(502);
    expect(await body(res)).toEqual({error: `Cannot reach Immich at IMMICH_URL=http://immich:2283: ${reason}.`, code: 'unreachable'});
    expect(calls).toEqual(['/api/server/ping']);
    expect(immich.state).toBe('down');
  });

  it('keeps polling through dropped connections once the gate said Immich is starting', async () => {
    let n = 0;
    const {app, calls} = client(path => {
      if (path !== '/api/server/ping') return json([]);
      n++;
      if (n === 1) return gatePage();
      if (n === 2) throw netError('ECONNRESET');
      return pong();
    });
    expect((await app.request('/api/index')).status).toBe(200);
    expect(calls.filter(p => p === '/api/server/ping')).toHaveLength(3);
  });

  it('says 503 unavailable when the gate page outlasts the wake budget', async () => {
    const {app} = client(() => gatePage(), {wakeTimeoutMs: 30});
    const res = await app.request('/api/index');
    expect(res.status).toBe(503);
    expect((await body(res)).code).toBe('unavailable');
  });

  it('fails fast with upstream when IMMICH_URL is not Immich', async () => {
    const {app, calls} = client(() => new Response('<h1>Not Found</h1>', {status: 404, headers: {'content-type': 'text/html'}}));
    const res = await app.request('/api/index');
    expect(res.status).toBe(502);
    expect(await body(res)).toMatchObject({code: 'upstream', error: expect.stringContaining('/api/server/ping answered HTTP 404')});
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['X-Powered-By', () => new Response('<html></html>', {headers: {'content-type': 'text/html', 'x-powered-by': 'Express'}})],
    ['its SvelteKit page', () => new Response('<script src="/_app/immutable/entry/start.js">', {headers: {'content-type': 'text/html'}})],
  ])('tells Immich\'s web app (wrong IMMICH_URL path, found by %s) from the gate page', async (_, page) => {
    const {app, calls} = client(page);
    const res = await app.request('/api/index');
    expect(res.status).toBe(502);
    expect(await body(res)).toMatchObject({code: 'upstream', error: expect.stringContaining('web page instead of its API')});
    expect(calls).toHaveLength(1);
  });

  it('names the missing permission, for JSON and media alike', async () => {
    const {app} = client(path => path === '/api/server/ping' ? pong()
      : json({message: `Missing required permission: ${path.startsWith('/api/albums') ? 'album.read' : 'asset.view'}`, statusCode: 403}, 403));
    const albums = await app.request('/api/albums');
    expect(albums.status).toBe(502);
    expect(await body(albums)).toEqual({code: 'auth', missingPermission: 'album.read', error: 'The viewer\'s API key lacks the album.read permission. It needs asset.read, asset.view, album.read.'});
    expect(await body(await app.request(`/api/assets/${ID}/thumbnail`))).toMatchObject({code: 'auth', missingPermission: 'asset.view'});
  });

  it('reports an invalid key as auth without a permission', async () => {
    const {app} = client(path => path === '/api/server/ping' ? pong() : json({message: 'Invalid API key'}, 401));
    const b = await body(await app.request('/api/index'));
    expect(b).toEqual({code: 'auth', error: expect.stringContaining('(Invalid API key). Check IMMICH_API_KEY')});
    expect(b.missingPermission).toBeUndefined();
  });

  it('answers a retryable 503 when Immich takes the connection but never answers', async () => {
    const {app, immich} = client((path, init) => path === '/api/server/ping' ? pong() : hang(init), {requestTimeoutMs: 20});
    const res = await app.request('/api/index');
    expect(res.status).toBe(503);
    expect(await body(res)).toEqual({code: 'unavailable', error: 'Immich didn\'t answer within 0.02 s.'});
    expect(immich.state).toBe('unknown');
  });

  it('bounds a JSON body that stalls after the headers', async () => {
    // Like fetch: aborting the request errors a body that is still streaming.
    const {app} = client((path, init) => path === '/api/server/ping' ? pong() : new Response(new ReadableStream({start(c) {
      c.enqueue(new TextEncoder().encode('{"a":'));
      init.signal!.addEventListener('abort', () => c.error(init.signal!.reason));
    }}), {headers: {'content-type': 'application/json'}}), {requestTimeoutMs: 20});
    const res = await app.request('/api/index');
    expect(res.status).toBe(503);
    expect((await body(res)).code).toBe('unavailable');
  });

  it('does not cut a media stream that runs past the timeout once the headers are in', async () => {
    const {app} = client(path => {
      if (path === '/api/server/ping') return pong();
      const stream = new ReadableStream({async start(c) {
        c.enqueue(new Uint8Array([1]));
        await new Promise(r => setTimeout(r, 60));
        c.enqueue(new Uint8Array([2]));
        c.close();
      }});
      return new Response(stream, {headers: {'content-type': 'video/mp4'}});
    }, {requestTimeoutMs: 20});
    const res = await app.request(`/api/assets/${ID}/video`);
    expect(res.status).toBe(200);
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2]);
  });
});

describe('selfCheck', () => {
  const allowed: Handler = path => {
    if (path === '/api/server/ping') return pong();
    if (path === '/api/server/version') return json({major: 3, minor: 1, patch: 0});
    if (path.endsWith('/thumbnail')) return json({message: 'Not found or no asset.view access'}, 400);
    return json([]);
  };

  it('passes with a working key, without waking or retrying', async () => {
    const {immich, calls} = client(allowed);
    expect(await selfCheck(immich)).toEqual({ok: true, version: '3.1.0'});
    expect(calls).toEqual(['/api/server/ping', '/api/server/version', '/api/timeline/buckets', '/api/albums', '/api/assets/00000000-0000-4000-8000-000000000000/thumbnail']);
    expect(immich.state).toBe('unknown');
  });

  it.each<[string, Handler, string, RegExp]>([
    ['refused', () => { throw netError('ECONNREFUSED'); }, 'connect', /IMMICH_URL=http:\/\/immich:2283: connection refused/],
    ['not Immich', () => new Response('nope', {status: 404}), 'http', /HTTP 404 to \/api\/server\/ping/],
    ['the gate page', () => gatePage(), 'asleep', /wake gate/],
    ['Immich\'s web app', () => new Response('<script src="/_app/immutable/x.js">', {headers: {'content-type': 'text/html'}}), 'http', /web page instead of its API/],
    ['an invalid key', (p, i) => p.startsWith('/api/server') ? allowed(p, i) : json({message: 'Invalid API key'}, 401), 'key', /Invalid API key/],
    ['no album.read', (p, i) => p === '/api/albums' ? json({message: 'Missing required permission: album.read'}, 403) : allowed(p, i), 'permission', /lacks album\.read/],
    ['no asset.view', (p, i) => p.endsWith('/thumbnail') ? new Response(null, {status: 403}) : allowed(p, i), 'permission', /lacks asset\.view/],
  ])('reports %s', async (_, handler, step, message) => {
    const r = await selfCheck(client(handler).immich);
    expect(r).toMatchObject({ok: false, step});
    expect(!r.ok && r.message).toMatch(message);
  });

  it('gives up on a hung Immich after its timeout', async () => {
    const r = await selfCheck(client((_, init) => hang(init)).immich, 20);
    expect(r).toMatchObject({ok: false, step: 'connect', message: 'IMMICH_URL=http://immich:2283: Immich didn\'t answer within 0.02 s.'});
  });
});
