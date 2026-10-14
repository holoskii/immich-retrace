import {describe, expect, it} from 'vitest';
import {createApp} from '../server/app.ts';
import {ImmichClient} from '../server/immich.ts';
import {configFromEnv, DEFAULT_MAP_STYLE_URL} from '../server/config.ts';
import type {ViewerConfig} from '../shared/api.ts';

/** Fake Immich that records calls: /api/config must not need Immich at all. */
function fakeImmich() {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response('{}', {status: 200, headers: {'content-type': 'application/json'}});
  }) as typeof fetch;
  return {immich: new ImmichClient({baseUrl: 'http://gate:2284/', apiKey: 'secret', fetch: fetchImpl, pollMs: 1, wakeTimeoutMs: 200}), calls};
}

describe('configFromEnv', () => {
  it('defaults to OpenFreeMap\'s dark style and no public URL', () => {
    expect(configFromEnv({})).toEqual({mapStyleUrl: DEFAULT_MAP_STYLE_URL, immichPublicUrl: null});
    expect(configFromEnv({MAP_STYLE_URL: '  ', IMMICH_PUBLIC_URL: ''})).toEqual({mapStyleUrl: DEFAULT_MAP_STYLE_URL, immichPublicUrl: null});
  });

  it('takes both from the environment, trimming a trailing slash off the Immich URL', () => {
    expect(configFromEnv({MAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/dark', IMMICH_PUBLIC_URL: 'https://photos.example.com/'}))
      .toEqual({mapStyleUrl: 'https://tiles.openfreemap.org/styles/dark', immichPublicUrl: 'https://photos.example.com'});
  });

  it('rejects values that are not http(s) URLs', () => {
    expect(() => configFromEnv({MAP_STYLE_URL: 'javascript:alert(1)'})).toThrow(/MAP_STYLE_URL/);
    expect(() => configFromEnv({IMMICH_PUBLIC_URL: 'photos.example.com'})).toThrow(/IMMICH_PUBLIC_URL/);
  });
});

describe('GET /api/config', () => {
  it('returns the configured values, uncached, without calling Immich', async () => {
    const {immich, calls} = fakeImmich();
    const config: ViewerConfig = {mapStyleUrl: 'https://example.com/style.json', immichPublicUrl: 'https://photos.example.com'};
    const res = await createApp(immich, config).request('/api/config');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual(config);
    expect(calls).toEqual([]);
  });

  it('falls back to the defaults when the app gets no config', async () => {
    const res = await createApp(fakeImmich().immich).request('/api/config');
    expect(await res.json()).toEqual({mapStyleUrl: DEFAULT_MAP_STYLE_URL, immichPublicUrl: null});
  });
});
