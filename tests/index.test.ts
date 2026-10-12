import {describe, expect, it} from 'vitest';
import {createApp} from '../server/app.ts';
import {ImmichClient} from '../server/immich.ts';
import {parseAlbums, parseBucketColumns, parseManifestMonths} from '../server/adapter.ts';
import {SCHEMA_VERSION, type AlbumMembers} from '../shared/api.ts';
import bucket0808 from './fixtures/bucket-2026-08.json' with {type: 'json'};
import bucket0807 from './fixtures/bucket-2026-07.json' with {type: 'json'};
import albumsOwned from './fixtures/albums-owned.json' with {type: 'json'};
import albumsShared from './fixtures/albums-shared.json' with {type: 'json'};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
const gatePage = () => new Response('<html>starting</html>', {status: 200, headers: {'content-type': 'text/html'}});
const BUCKETS = [{timeBucket: '2026-08-01', count: 7}, {timeBucket: '2026-07-01', count: 2}];
const ALBUM_ID = albumsOwned[0].id;

/** Default route table standing in for Immich's timeline/album endpoints. */
function defaultRoute(url: URL): Response {
  if (url.pathname === '/api/timeline/buckets') return json(BUCKETS);
  if (url.pathname === '/api/timeline/bucket') {
    if (url.searchParams.get('withCoordinates') !== 'true') return json({error: 'missing withCoordinates'}, 400);
    const tb = url.searchParams.get('timeBucket');
    if (tb === '2026-08-01') return json(bucket0808);
    if (tb === '2026-07-01') return json(bucket0807);
    return json([]);
  }
  if (url.pathname === '/api/albums') return json(url.searchParams.get('shared') === 'true' ? albumsShared : albumsOwned);
  const albumMatch = /^\/api\/albums\/([^/]+)$/.exec(url.pathname);
  if (albumMatch) {
    const album = [...albumsOwned, ...albumsShared].find(a => a.id === albumMatch[1]);
    return album ? json(album) : json({message: 'not found'}, 404);
  }
  return json({error: 'unhandled route'}, 404);
}

function fakeImmich({upAfter = 0, respond = defaultRoute, apiKey = 'secret'}: {upAfter?: number; respond?: (url: URL) => Response; apiKey?: string} = {}) {
  let pings = 0;
  const calls: URL[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname === '/api/server/ping') return pings++ < upAfter ? gatePage() : json({res: 'pong'});
    if (pings <= upAfter) return gatePage();
    return respond(url);
  }) as typeof fetch;
  const immich = new ImmichClient({baseUrl: 'http://gate:2284', apiKey, fetch: fetchImpl, pollMs: 1, wakeTimeoutMs: 200});
  return {app: createApp(immich), immich, calls};
}

describe('adapter: bucket columns', () => {
  const out = parseBucketColumns(bucket0808);

  it('drops trashed and non-active rows', () => {
    expect(out.id).toHaveLength(5);
    expect(out.id).not.toContain('a0000000-0000-4000-8000-000000000003'); // trashed
    expect(out.id).not.toContain('a0000000-0000-4000-8000-000000000004'); // status: locked
  });

  it('parses fileCreatedAt (no zone) as UTC', () => {
    expect(out.t[0]).toBe(Date.parse('2026-08-01T10:15:00.000Z'));
  });

  it('keeps local offsets (incl. fractional)', () => {
    expect(out.off).toEqual([3, 2, 0, 0, 5.5]);
  });

  it('marks video rows and keeps duration, 0 for photos', () => {
    expect(out.video).toEqual([0, 1, 0, 0, 0]);
    expect(out.dur).toEqual([0, 15000, 0, 0, 0]);
  });

  it('nulls coordinates that are missing or exactly 0,0, keeps real ones', () => {
    expect(out.lat).toEqual([12.34, 12.4, null, null, 56.78]);
    expect(out.lon).toEqual([23.45, 23.5, null, null, 67.89]);
  });

  it('passes through thumbhash, ratio, city, country', () => {
    expect(out.thumbhash).toEqual(['aaaa', 'bbbb', 'eeee', 'ffff', null]);
    expect(out.ratio).toEqual([1.5, 1.777, 1.5, 1.5, 1.333]);
    expect(out.city).toEqual(['Faketown', 'Fakeville', null, 'Zerotown', 'Madeuptown']);
  });

  it('rejects a response with a missing column', () => {
    const bad = {...bucket0808, thumbhash: undefined};
    expect(() => parseBucketColumns(bad)).toThrow(/Unexpected response/);
  });

  it('rejects a response with mismatched column lengths', () => {
    const bad = {...bucket0808, ratio: bucket0808.ratio.slice(1)};
    expect(() => parseBucketColumns(bad)).toThrow(/Unexpected response/);
  });

  it('rejects bad ids, timestamps and offsets', () => {
    const with_ = (key: string, i: number, v: unknown) => ({...bucket0808, [key]: (bucket0808 as Record<string, unknown[]>)[key].map((x, j) => j === i ? v : x)});
    for (const bad of [with_('id', 0, 'not-a-uuid'), with_('id', 0, 7), with_('fileCreatedAt', 0, 'yesterday'), with_('fileCreatedAt', 0, null), with_('localOffsetHours', 0, null)])
      expect(() => parseBucketColumns(bad)).toThrow(/Unexpected response/);
  });

  it('nulls out-of-range GPS instead of failing', () => {
    const odd = {...bucket0808, latitude: bucket0808.latitude.map((x, j) => j === 0 ? 999 : x), longitude: bucket0808.longitude.map((x, j) => j === 1 ? -181 : x)};
    const r = parseBucketColumns(odd);
    expect([r.lat[0], r.lon[0], r.lat[1], r.lon[1]]).toEqual([null, null, null, null]);
    expect(r.lat[4]).toBe(56.78);
  });
});

describe('adapter: manifest months', () => {
  it('sorts descending buckets into ascending YYYY-MM months', () => {
    expect(parseManifestMonths(BUCKETS)).toEqual([{month: '2026-07', count: 2}, {month: '2026-08', count: 7}]);
  });

  it('rejects malformed buckets', () => {
    for (const bad of [{timeBucket: '2026-13-01', count: 1}, {timeBucket: 202608, count: 1}, {timeBucket: '2026-08-01', count: -1}, {timeBucket: '2026-08-01', count: '7'}])
      expect(() => parseManifestMonths([bad])).toThrow(/Unexpected response/);
  });
});

describe('adapter: albums', () => {
  const out = parseAlbums(albumsOwned, albumsShared);

  it('merges owned + shared, deduping by id', () => {
    expect(out).toHaveLength(3);
    expect(new Set(out.map(a => a.id)).size).toBe(3);
  });

  it('sorts by start ascending, nulls (empty albums) last', () => {
    expect(out.map(a => a.id)).toEqual([
      'c0000000-0000-4000-8000-000000000003', // 2026-05
      'c0000000-0000-4000-8000-000000000001', // 2026-07
      'c0000000-0000-4000-8000-000000000002', // empty, start null
    ]);
  });

  it('builds version from updatedAt + assetCount + lastModifiedAssetTimestamp', () => {
    const trip = out.find(a => a.id === ALBUM_ID)!;
    expect(trip.version).toBe('2026-08-10T00:00:00.000Z|9|2026-08-06T22:45:30.250Z');
    const empty = out.find(a => a.id === 'c0000000-0000-4000-8000-000000000002')!;
    expect(empty.version).toBe('2026-01-01T00:00:00.000Z|0|');
    expect(empty.start).toBeNull();
    expect(empty.end).toBeNull();
  });
});

describe('routes', () => {
  it('GET /api/index returns an ascending manifest with a stable library id', async () => {
    const {app} = fakeImmich();
    const res = await app.request('/api/index');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.schema).toBe(SCHEMA_VERSION);
    expect(body.library).toMatch(/^[0-9a-f]{16}$/);
    expect(body.months).toEqual([{month: '2026-07', count: 2}, {month: '2026-08', count: 7}]);

    const {app: app2} = fakeImmich();
    expect((await (await app2.request('/api/index')).json()).library).toBe(body.library);
    const {app: app3} = fakeImmich({apiKey: 'other'});
    expect((await (await app3.request('/api/index')).json()).library).not.toBe(body.library);
  });

  it('GET /api/index/:month validates the month and returns MonthColumns', async () => {
    const {app} = fakeImmich();
    expect((await app.request('/api/index/2026-13')).status).toBe(400);
    expect((await app.request('/api/index/not-a-month')).status).toBe(400);
    const res = await app.request('/api/index/2026-08');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.month).toBe('2026-08');
    expect(body.id).toHaveLength(5);
  });

  it('GET /api/albums returns the merged, sorted list', async () => {
    const {app} = fakeImmich();
    const res = await app.request('/api/albums');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toHaveLength(3);
    expect(body[0].start).toBeLessThan(body[1].start);
  });

  it('GET /api/albums/:id/assets validates the id and returns members as deduped columns', async () => {
    // A third album bucket repeats a 2026-07 asset and adds another user's asset (not in the library).
    const foreign = {...bucket0807, id: [bucket0807.id[0], 'd0000000-0000-4000-8000-000000000001']};
    const {app} = fakeImmich({respond: url => {
      if (!url.searchParams.get('albumId')) return defaultRoute(url);
      if (url.pathname === '/api/timeline/buckets') return json([...BUCKETS, {timeBucket: '2026-06-01', count: 2}]);
      if (url.searchParams.get('timeBucket') === '2026-06-01') return json(foreign);
      return defaultRoute(url);
    }});
    expect((await app.request('/api/albums/not-a-uuid/assets')).status).toBe(400);
    const res = await app.request(`/api/albums/${ALBUM_ID}/assets`);
    expect(res.status).toBe(200);
    const body: AlbumMembers = await res.json();
    expect(body.id).toBe(ALBUM_ID);
    expect(body.version).toBe('2026-08-10T00:00:00.000Z|9|2026-08-06T22:45:30.250Z');
    const {columns: c} = body;
    expect(c.id).toHaveLength(8); // 5 kept in 2026-08 + 2 in 2026-07 + 1 foreign
    expect(new Set(c.id).size).toBe(8);
    expect(c.id).toContain('d0000000-0000-4000-8000-000000000001');
    for (const col of Object.values(c)) expect(col).toHaveLength(8);
    expect(Object.keys(c).sort()).toEqual(['city', 'country', 'dur', 'id', 'lat', 'lon', 'off', 'ratio', 't', 'thumbhash', 'video']);
  });

  it('answers 502 for a month with a bad timestamp', async () => {
    const bad = {...bucket0808, fileCreatedAt: bucket0808.fileCreatedAt.map((x, j) => j === 0 ? 'not a date' : x)};
    const {app} = fakeImmich({respond: url => url.pathname === '/api/timeline/bucket' ? json(bad) : defaultRoute(url)});
    const res = await app.request('/api/index/2026-08');
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Unexpected response/);
  });

  it('404s an unknown album', async () => {
    const {app} = fakeImmich();
    expect((await app.request('/api/albums/00000000-0000-4000-8000-000000000000/assets')).status).toBe(404);
  });

  it('maps a rejected key to code "auth"', async () => {
    const {app} = fakeImmich({respond: () => json({message: 'Missing required permission'}, 403)});
    const res = await app.request('/api/albums');
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('auth');
  });

  it('waits through the gate page on a JSON call, then succeeds', async () => {
    const {app, immich} = fakeImmich({upAfter: 3});
    const res = await app.request('/api/index');
    expect(res.status).toBe(200);
    expect(immich.state).toBe('up');
  });

  it('maps a non-JSON 200 to 502', async () => {
    const {app} = fakeImmich({respond: () => new Response('nope', {status: 200, headers: {'content-type': 'text/plain'}})});
    const res = await app.request('/api/albums');
    expect(res.status).toBe(502);
  });

  it('maps an invalid /api/index/:month to code "invalid"', async () => {
    const {app} = fakeImmich();
    const res = await app.request('/api/index/2026-13');
    expect((await res.json()).code).toBe('invalid');
  });
});
