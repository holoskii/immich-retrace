import {describe, expect, it} from 'vitest';
import {createApp} from '../server/app.ts';
import {ImmichClient} from '../server/immich.ts';

const ID = '0b7b5c7e-1f2a-4c3d-9e8f-123456789abc';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
const gatePage = () => new Response('<html>starting</html>', {status: 200, headers: {'content-type': 'text/html'}});
const image = () => new Response(new Uint8Array([1, 2, 3]), {status: 200, headers: {'content-type': 'image/webp', 'set-cookie': 'x=1'}});
const video = () => new Response('abc', {status: 206, headers: {'content-type': 'video/mp4', 'content-range': 'bytes 0-2/3'}});

type Call = {url: URL; init: RequestInit; headers: Headers};
type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

/** Fake Immich behind the gate: answers the gate page until `upAfter` pings, then `respond` for other paths. */
function fakeImmich({upAfter = 0, respond}: {upAfter?: number; respond?: Handler} = {}) {
  const calls: Call[] = [];
  let pings = 0;
  const handler: Handler = respond ?? (url => {
    if (url.pathname === `/api/assets/${ID}/thumbnail`) return image();
    if (url.pathname === `/api/assets/${ID}/video/playback`) return video();
    return json({message: 'Not found or no asset.view access'}, 400);
  });
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({url, init, headers: new Headers(init.headers)});
    if (url.pathname === '/api/server/ping') return pings++ < upAfter ? gatePage() : json({res: 'pong'});
    if (pings <= upAfter) return gatePage();
    return handler(url, init);
  }) as typeof fetch;
  const immich = new ImmichClient({baseUrl: 'http://gate:2284/', apiKey: 'secret', fetch: fetchImpl, pollMs: 1, wakeTimeoutMs: 200});
  const media = () => calls.filter(c => c.url.pathname !== '/api/server/ping');
  const pingCount = () => calls.length - media().length;
  return {app: createApp(immich), immich, calls, media, pingCount};
}

const errorOf = async (res: Response) => ((await res.json()) as {error: string}).error;

describe('upstream requests', () => {
  it('injects the API key and forwards nothing from the browser', async () => {
    const {app, media} = fakeImmich();
    const res = await app.request(`/api/assets/${ID}/thumbnail?size=preview&key=share&apiKey=other`, {
      headers: {cookie: 'immich_access_token=abc', authorization: 'Bearer abc', 'x-immich-share-key': 'k'},
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('set-cookie')).toBeNull();
    const [up] = media();
    expect(up.headers.get('x-api-key')).toBe('secret');
    expect(up.headers.get('cookie')).toBeNull();
    expect(up.headers.get('authorization')).toBeNull();
    expect(up.headers.get('x-immich-share-key')).toBeNull();
    expect(Object.fromEntries(up.url.searchParams)).toEqual({size: 'preview', edited: 'true'});
    expect(up.init.redirect).toBe('manual');
    expect(up.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('caches a versioned (c = thumbhash) URL for good and does not forward c', async () => {
    const {app, media} = fakeImmich();
    const hash = '1QcSHQRnh493V4dIh4eXh1h4kJUI';
    const res = await app.request(`/api/assets/${ID}/thumbnail?size=preview&c=${encodeURIComponent(hash + '+/=')}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(Object.fromEntries(media()[0].url.searchParams)).toEqual({size: 'preview', edited: 'true'});
    // Video is never versioned.
    expect((await app.request(`/api/assets/${ID}/video?c=${hash}`)).headers.get('cache-control')).toBe('no-store');
  });

  it('waits through the gate loading page instead of relaying it', async () => {
    const {app, immich, pingCount} = fakeImmich({upAfter: 3});
    const res = await app.request(`/api/assets/${ID}/thumbnail`);
    expect(res.status).toBe(200);
    expect(immich.state).toBe('up');
    expect(pingCount()).toBe(4);
  });

  it('shares one wake-up between concurrent requests', async () => {
    const {app, pingCount} = fakeImmich({upAfter: 2});
    await Promise.all(Array.from({length: 5}, () => app.request(`/api/assets/${ID}/thumbnail`)));
    expect(pingCount()).toBe(3);
  });

  it('wakes Immich again when the gate stopped it after a successful wake', async () => {
    let stopped = true;
    const {app, pingCount} = fakeImmich({respond: () => stopped ? (stopped = false, gatePage()) : image()});
    const res = await app.request(`/api/assets/${ID}/thumbnail`);
    expect(res.status).toBe(200);
    expect(pingCount()).toBe(2);
  });

  it('passes a single Range through and keeps 206', async () => {
    const {app, media} = fakeImmich();
    const res = await app.request(`/api/assets/${ID}/video`, {headers: {range: 'bytes=0-'}});
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-2/3');
    expect(media()[0].headers.get('range')).toBe('bytes=0-');
  });

  it.each(['bytes=0-1,5-9', 'bytes=-', 'bytes=9-1', 'items=0-1'])('ignores unsupported Range %s', async range => {
    const {app, media} = fakeImmich();
    expect((await app.request(`/api/assets/${ID}/video`, {headers: {range}})).ok).toBe(true);
    expect(media()[0].headers.get('range')).toBeNull();
  });

  it('sends HEAD upstream as HEAD, without Range, and answers without a body', async () => {
    const {app, media} = fakeImmich();
    const res = await app.request(`/api/assets/${ID}/video`, {method: 'HEAD', headers: {range: 'bytes=0-'}});
    expect(res.ok).toBe(true);
    expect(res.body).toBeNull();
    expect(media()[0].init.method).toBe('HEAD');
    expect(media()[0].headers.get('range')).toBeNull();
  });
});

describe('failures', () => {
  it('maps an unknown asset (Immich 400) to 404', async () => {
    const {app} = fakeImmich();
    expect((await app.request(`/api/assets/00000000-0000-4000-8000-000000000000/thumbnail`)).status).toBe(404);
  });

  it('maps a rejected key to a clear error', async () => {
    const {app} = fakeImmich({respond: () => json({message: 'Missing required permission'}, 403)});
    const res = await app.request(`/api/assets/${ID}/thumbnail`);
    expect(res.status).toBe(502);
    expect(await errorOf(res)).toContain('asset.view');
  });

  it('refuses to relay a redirect', async () => {
    const {app} = fakeImmich({respond: () => new Response(null, {status: 302, headers: {location: 'http://elsewhere/'}})});
    expect((await app.request(`/api/assets/${ID}/thumbnail`)).status).toBe(502);
  });

  it('answers 503 and forgets readiness when the gate drops while Immich was up', async () => {
    const {app, immich} = fakeImmich({respond: () => { throw new TypeError('fetch failed'); }});
    const res = await app.request(`/api/assets/${ID}/thumbnail`);
    expect(res.status).toBe(503);
    expect(immich.state).toBe('unknown');
  });

  it('answers 503 at once when the gate refuses to start Immich', async () => {
    const calls: string[] = [];
    const immich = new ImmichClient({baseUrl: 'http://gate:2284', apiKey: 'k', pollMs: 1, wakeTimeoutMs: 60_000,
      fetch: (async (u: string | URL) => { calls.push(String(u)); return json({message: 'photo mount missing'}, 503); }) as typeof fetch});
    const res = await createApp(immich).request(`/api/assets/${ID}/thumbnail`);
    expect(res.status).toBe(503);
    expect(calls).toHaveLength(1);
    expect(immich.state).toBe('down');
  });

  it('gives up waking at the deadline even if the gate hangs, and recovers later', async () => {
    let hang = true;
    const immich = new ImmichClient({baseUrl: 'http://gate:2284', apiKey: 'k', pollMs: 1, wakeTimeoutMs: 50,
      fetch: ((u: string | URL, init: RequestInit = {}) => {
        if (String(u).endsWith('/ping') && hang)
          return new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)));
        return Promise.resolve(String(u).endsWith('/ping') ? json({res: 'pong'}) : image());
      }) as typeof fetch});
    const app = createApp(immich);
    expect((await app.request(`/api/assets/${ID}/thumbnail`)).status).toBe(503);
    expect(immich.state).toBe('down');
    hang = false;
    expect((await app.request(`/api/assets/${ID}/thumbnail`)).status).toBe(200);
    expect(immich.state).toBe('up');
  });

  it('times out a request whose headers never come, without bounding a streaming body', async () => {
    let hang = true;
    const immich = new ImmichClient({baseUrl: 'http://gate:2284', apiKey: 'k', pollMs: 1, requestTimeoutMs: 30,
      fetch: ((u: string | URL, init: RequestInit = {}) => {
        if (String(u).endsWith('/ping')) return Promise.resolve(json({res: 'pong'}));
        if (hang) return new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)));
        // Headers at once, body only after the timeout would have fired.
        const body = new ReadableStream({start: c => { setTimeout(() => { c.enqueue(new Uint8Array([1])); c.close(); }, 60); }});
        return Promise.resolve(new Response(body, {status: 200, headers: {'content-type': 'video/mp4'}}));
      }) as typeof fetch});
    const app = createApp(immich);
    const res = await app.request(`/api/assets/${ID}/video`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({error: 'Immich didn\'t answer within 0.03 s.', code: 'unavailable'});
    hang = false;
    const ok = await app.request(`/api/assets/${ID}/video`);
    expect(ok.status).toBe(200);
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array([1]));
  });
});

describe('input validation', () => {
  it.each([
    [`/api/assets/..%2F..%2Fadmin/thumbnail`, 400],
    [`/api/assets/${ID}%2F..%2Fx/thumbnail`, 400],
    [`/api/assets/${ID.toUpperCase()}x/thumbnail`, 400],
    [`/api/assets/${ID}/thumbnail?size=fullsize`, 400],
    [`/api/assets/${ID}/thumbnail?c=`, 400],
    [`/api/assets/${ID}/thumbnail?c=a%26key%3Dx`, 400],
    [`/api/assets/${ID}/thumbnail?c=${'A'.repeat(65)}`, 400],
    [`/api/assets/${ID}/original`, 404],
    [`/api/users/me`, 404],
  ])('%s → %i', async (path, status) => {
    const {app, media} = fakeImmich();
    expect((await app.request(path)).status).toBe(status);
    expect(media()).toHaveLength(0);
  });

  it('is read-only', async () => {
    const {app, media} = fakeImmich();
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'])
      expect((await app.request(`/api/assets/${ID}/thumbnail`, {method})).status).toBe(404);
    expect(media()).toHaveLength(0);
  });
});
