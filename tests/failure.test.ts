import {describe, expect, it} from 'vitest';
import {classifyMedia, explainAlbums, explainIndex, explainMedia, probeMedia} from '../web/src/lib/failure.ts';
import {ApiFailure} from '../web/src/lib/index/refresh.ts';

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

describe('library failures', () => {
  it('a rejected key names every permission the key needs', () => {
    const e = explainIndex(new ApiFailure(502, 'Immich rejected the viewer\'s API key.', 'auth'));
    expect(e.title).toBe('Immich rejected the API key');
    for (const p of ['asset.read', 'asset.view', 'album.read']) expect(e.next).toContain(p);
    expect(e.retry).toBe('load');
  });
  it('maps each known code; signed-out and outdated retry by reloading', () => {
    expect(explainIndex(new ApiFailure(503, 'x', 'unavailable')).title).toBe('Immich isn’t reachable');
    expect(explainIndex(new ApiFailure(0, 'x', 'network')).title).toBe('Can’t reach the viewer’s server');
    expect(explainIndex(new ApiFailure(0, 'x', 'signed-out')).retry).toBe('reload');
    expect(explainIndex(new ApiFailure(0, 'x', 'outdated')).retry).toBe('reload');
  });
  it('falls back to the server\'s message for an unknown code or a plain error', () => {
    const e = explainIndex(new ApiFailure(502, 'Immich returned 500.', 'brand-new' as never));
    expect([e.title, e.next.startsWith('Immich returned 500.'), e.retry]).toEqual(['Loading the library failed', true, 'load']);
    expect(explainIndex(new Error('boom')).next).toContain('boom');
  });
  it('albums: a rejected key means album.read is missing', () => {
    expect(explainAlbums(new ApiFailure(502, 'x', 'auth'))).toBe('Albums unavailable: add album.read to the API key');
    expect(explainAlbums(new Error('boom'))).toBe('Albums unavailable: boom');
    expect(explainAlbums(new ApiFailure(502, 'x', 'auth'), 'Album photos')).toBe('Album photos unavailable: add album.read to the API key');
  });
});

describe('media failures', () => {
  it('tells permission, not found, Immich down, network, signed out and decode apart', () => {
    expect(classifyMedia(502, 'auth')).toBe('permission');
    expect(classifyMedia(404, 'not-found')).toBe('not-found');
    expect(classifyMedia(503, 'unavailable')).toBe('unavailable');
    expect(classifyMedia(0)).toBe('network');
    expect(classifyMedia(0, undefined, true)).toBe('signed-out');
    expect(classifyMedia(401)).toBe('signed-out');
    expect(classifyMedia(200)).toBe('decode');
    expect(classifyMedia(206)).toBe('decode');
    expect(classifyMedia(502)).toBe('other');
  });
  it('probes the relay with a one-byte range and reads the error code', async () => {
    const seen: RequestInit[] = [];
    const answer = (res: Response | Error) =>
      (async (_: unknown, init: RequestInit) => { seen.push(init); if (res instanceof Error) throw res; return res; }) as typeof fetch;
    expect(await probeMedia('/v', answer(json({error: 'x', code: 'auth'}, 502)))).toBe('permission');
    expect(new Headers(seen[0].headers).get('range')).toBe('bytes=0-0');
    expect(await probeMedia('/v', answer(json({error: 'x', code: 'not-found'}, 404)))).toBe('not-found');
    expect(await probeMedia('/v', answer(new Response('x', {status: 206})))).toBe('decode');
    expect(await probeMedia('/v', answer(new TypeError('Failed to fetch')))).toBe('network');
    expect(await probeMedia('/v', answer(Object.defineProperty(new Response(null), 'type', {value: 'opaqueredirect'})))).toBe('signed-out');
  });
  it('words: permission names asset.view; only transient causes offer Retry', () => {
    expect(explainMedia('permission', true).text).toContain('asset.view');
    expect(explainMedia('decode', true).text).toContain('format');
    expect(explainMedia('unavailable', false).retry).toBe(true);
    expect(explainMedia('not-found', false).retry).toBe(false);
  });
});
