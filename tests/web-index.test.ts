import 'fake-indexeddb/auto';
import {IDBFactory} from 'fake-indexeddb';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {SCHEMA_VERSION, type AlbumSummary, type AssetColumns, type MonthColumns} from '../shared/api.ts';
import {DB_NAME, dropOtherSchemas, memoryKV, openKV, type KV} from '../web/src/lib/index/idb.ts';
import {buildIndex, columnsOf, summarize, withLookup} from '../web/src/lib/index/model.ts';
import {albumMembers, ApiFailure, libraryCache, refreshIndex, type Ctx} from '../web/src/lib/index/refresh.ts';
import {LibraryStore, phaseText} from '../web/src/lib/index/store.svelte.ts';

// Synthetic data only. Rows within a month are deliberately not in time order.
function month(m: string, n = 3): MonthColumns {
  const base = Date.parse(`${m}-01T00:00:00Z`), c: MonthColumns = {month: m, id: [], t: [], off: [], video: [], dur: [], lat: [], lon: [], thumbhash: [], ratio: [], city: [], country: []};
  for (let i = 0; i < n; i++) {
    const gps = i % 2 === 0;
    c.id.push(`${m}-${String(i).padStart(5, '0')}`); c.t.push(base + ((i * 7919) % n) * 60e3 + i); c.off.push(i % 4 === 0 ? 5.75 : 2);
    c.video.push(i % 3 === 0 ? 1 : 0); c.dur.push(i % 3 === 0 ? 4000 : 0);
    c.lat.push(gps ? 40 + i * 1e-4 : null); c.lon.push(gps ? 20 + i * 1e-4 : null);
    c.thumbhash.push(i % 5 ? 'AAAA' : null); c.ratio.push(i % 2 ? 0.75 : 1.5); c.city.push(gps ? 'Town' : null); c.country.push(gps ? 'Land' : null);
  }
  return c;
}

const MONTHS = ['2023-01', '2023-02', '2023-03', '2023-04', '2023-05', '2023-06', '2023-07'].map(m => month(m));
const ALBUMS: AlbumSummary[] = [{id: 'alb-1', name: 'Trip', start: MONTHS[1].t[0], end: MONTHS[2].t[0], count: 3, shared: true, cover: null, version: 'v1'}];
/** Two library assets plus one of another user's, which only the album has. */
function members(): AssetColumns {
  const {month: _, ...c} = month('2023-02', 3);
  c.id = [MONTHS[1].id[0], MONTHS[2].id[0], 'foreign-1'];
  return c;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

/** Fake viewer backend; `override` may answer any path first (return undefined to fall through). */
function fakeApi({months = MONTHS, library = 'lib-a', override, delay = () => 1}: {months?: MonthColumns[]; library?: string; override?: (path: string) => Response | undefined; delay?: (path: string) => number} = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = String(input);
    calls.push(path);
    await new Promise(r => setTimeout(r, delay(path)));
    init.signal?.throwIfAborted();
    const o = override?.(path);
    if (o) return o;
    if (path === '/api/index') return json({schema: SCHEMA_VERSION, library, months: months.map(m => ({month: m.month, count: m.id.length}))});
    const m = path.match(/^\/api\/index\/(.+)$/);
    if (m) return json(months.find(x => x.month === m[1]));
    if (path === '/api/albums') return json(ALBUMS);
    const a = path.match(/^\/api\/albums\/(.+)\/assets$/);
    if (a) return json({id: a[1], version: ALBUMS[0].version, columns: members()});
    return json({error: 'Unknown endpoint.'}, 404);
  }) as typeof fetch;
  return {fetch: fetchImpl, calls, monthCalls: () => calls.filter(p => p.startsWith('/api/index/')).map(p => p.slice(11))};
}

const auth = () => json({error: 'Immich rejected the API key.', code: 'auth'}, 502);
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

/** Wraps kv: logs every write and lets `hold` delay a write (e.g. staging) by returning a promise. */
function spyKV(kv: KV, hold: (put: Record<string, unknown>) => Promise<void> | void = () => {}) {
  const writes: {put: string[]; clear: string[]}[] = [];
  const spy: KV = {...kv, async write(put, clear = []) {
    await hold(put);
    writes.push({put: Object.keys(put), clear});
    return kv.write(put, clear);
  }};
  return {kv: spy, writes};
}

/** A store on the given kv whose fetches go to api. */
function store(kv: KV, api: ReturnType<typeof fakeApi>) {
  vi.stubGlobal('fetch', api.fetch);
  return new LibraryStore(async () => libraryCache(kv));
}

let dbs = 0;
const freshKV = () => openKV(new IDBFactory(), `test-${dbs++}`);
const ctx = (kv: KV, api: ReturnType<typeof fakeApi>, extra: Partial<Ctx> = {}): Ctx => ({cache: libraryCache(kv), fetch: api.fetch, delays: [1, 1, 1], ...extra});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('buildIndex', () => {
  it('merges months, sorts by instant, dedupes by id (last wins), keeps GPS validity explicit', () => {
    const a = month('2023-02', 4), b = month('2023-01', 4);
    const dup = month('2023-03', 1);
    dup.id[0] = a.id[1]; dup.lat[0] = 0; dup.lon[0] = 7; // 0 latitude is a real position
    const ix = buildIndex([a, b, dup]);
    expect(ix.n).toBe(8);
    for (let r = 1; r < ix.n; r++) expect(ix.t[r]).toBeGreaterThanOrEqual(ix.t[r - 1]);
    expect(ix.t[0]).toBe(Math.min(...b.t));
    const r = ix.idToRow.get(a.id[1])!;
    expect(ix.t[r]).toBe(dup.t[0]);
    expect([ix.gps[r], ix.lat[r], ix.lon[r]]).toEqual([1, 0, 7]);
    const noGps = ix.idToRow.get(a.id[3])!;
    expect(ix.gps[noGps]).toBe(0);
    expect(ix.lat[noGps]).toBeNaN();
    expect(ix.off[ix.idToRow.get(a.id[0])!]).toBe(5.75);
    expect([...ix.idToRow].every(([id, row]) => ix.id[row] === id)).toBe(true);
    const s = summarize(ix);
    expect([s.total, s.gps, s.videos]).toEqual([8, 5, 5]);
  });

  it('measures build time for ~30k rows / 134 months', async ({annotate}) => {
    const months = Array.from({length: 134}, (_, i) => month(`${2015 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`, 224));
    buildIndex(months); // warm-up
    const times: number[] = [];
    let n = 0;
    for (let k = 0; k < 5; k++) { const t0 = performance.now(); n = buildIndex(months).n; times.push(performance.now() - t0); }
    const ix = buildIndex(months), t1 = performance.now();
    withLookup(structuredClone(columnsOf(ix)));
    const load = performance.now() - t1;
    times.sort((x, y) => x - y);
    await annotate(`buildIndex ${n} rows: median ${times[2].toFixed(1)} ms (min ${times[0].toFixed(1)}, max ${times[4].toFixed(1)}); clone+lookup ${load.toFixed(1)} ms`);
    expect(n).toBe(134 * 224);
  });
});

describe('refreshIndex', () => {
  it('fetches every month, writes the snapshot and albums, leaves no staging', async () => {
    const kv = await freshKV(), api = fakeApi(), progress: number[][] = [];
    let manifestMonths = 0;
    const r = await refreshIndex(ctx(kv, api), {onManifest: m => { manifestMonths = m.months.length; }, onProgress: (d, t) => progress.push([d, t])});
    expect(manifestMonths).toBe(7);
    expect(r.index.n).toBe(21);
    expect(progress[0]).toEqual([0, 7]);
    expect(progress.at(-1)).toEqual([7, 7]);
    expect(api.monthCalls().sort()).toEqual(MONTHS.map(m => m.month));
    const cache = libraryCache(kv);
    expect(await cache.last()).toBe('lib-a');
    const snap = (await cache.snapshot('lib-a'))!;
    expect(snap.cols.t).toBeInstanceOf(Float64Array);
    expect(withLookup(snap.cols).id).toEqual(r.index.id);
    expect(await cache.staged('lib-a')).toEqual([]);
    expect(await cache.albums('lib-a')).toEqual(ALBUMS);
  });

  it('resumes an interrupted build from fresh staged months', async () => {
    const kv = await freshKV(), fail = fakeApi({override: p => p === '/api/index/2023-04' ? json({error: 'boom'}, 500) : undefined});
    await expect(refreshIndex(ctx(kv, fail, {concurrency: 1}))).rejects.toThrow('boom');
    const staged = (await libraryCache(kv).staged('lib-a')).map(s => s.cols.month);
    expect(staged).toEqual(['2023-01', '2023-02', '2023-03']);
    expect(await libraryCache(kv).snapshot('lib-a')).toBeUndefined();

    const api = fakeApi();
    const r = await refreshIndex(ctx(kv, api));
    expect(api.monthCalls().sort()).toEqual(['2023-04', '2023-05', '2023-06', '2023-07']);
    expect(r.index.n).toBe(21);
    expect(await libraryCache(kv).staged('lib-a')).toEqual([]);
  });

  it('refetches staged months that are stale or whose count changed', async () => {
    const kv = await freshKV(), fail = fakeApi({override: p => p === '/api/index/2023-04' ? json({error: 'boom'}, 500) : undefined});
    await expect(refreshIndex(ctx(kv, fail, {concurrency: 1}))).rejects.toThrow();

    const grown = MONTHS.map(m => m.month === '2023-02' ? month('2023-02', 5) : m), api = fakeApi({months: grown});
    await refreshIndex(ctx(kv, api));
    expect(api.monthCalls()).toContain('2023-02');
    expect(api.monthCalls()).not.toContain('2023-01');

    const kv2 = await freshKV();
    await expect(refreshIndex(ctx(kv2, fail, {concurrency: 1}))).rejects.toThrow();
    const later = fakeApi();
    await refreshIndex(ctx(kv2, later, {now: () => Date.now() + 2 * 3600e3}));
    expect(later.monthCalls().length).toBe(7);
  });

  it('never reuses staged months once a snapshot exists, and stages nothing then', async () => {
    const kv = await freshKV(), cache = libraryCache(kv);
    await refreshIndex(ctx(kv, fakeApi()));
    for (const m of MONTHS) await cache.stage('lib-a', {refreshId: 'x', startedAt: Date.now(), count: m.id.length, cols: m});
    const api = fakeApi();
    await refreshIndex(ctx(kv, api));
    expect(api.monthCalls().length).toBe(7);
    expect(await cache.staged('lib-a')).toEqual([]);

    const fail = fakeApi({override: p => p === '/api/index/2023-04' ? json({error: 'boom'}, 500) : undefined});
    await expect(refreshIndex(ctx(kv, fail, {concurrency: 1}))).rejects.toThrow('boom');
    expect(await cache.staged('lib-a')).toEqual([]);
    expect((await cache.snapshot('lib-a'))?.cols.n).toBe(21);
  });

  it('retries 503 unavailable with backoff, then gives up', async () => {
    let n = 0;
    const api = fakeApi({override: p => p === '/api/index/2023-02' && n++ < 2 ? json({error: 'Immich is starting.', code: 'unavailable'}, 503) : undefined});
    const r = await refreshIndex(ctx(await freshKV(), api));
    expect(r.index.n).toBe(21);
    expect(api.calls.filter(p => p === '/api/index/2023-02').length).toBe(3);

    const down = fakeApi({override: p => p === '/api/index' ? json({error: 'Immich is starting.', code: 'unavailable'}, 503) : undefined});
    const err = await refreshIndex(ctx(await freshKV(), down, {delays: [1, 1]})).catch(e => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect(err.code).toBe('unavailable');
    expect(down.calls.length).toBe(3);
  });

  it('albums fail on their own: the index completes, the run resolves with albums null', async () => {
    const kv = await freshKV(), api = fakeApi({override: p => p === '/api/albums' ? auth() : undefined});
    const errors: unknown[] = [];
    const r = await refreshIndex(ctx(kv, api), {onAlbumsError: e => errors.push(e)});
    expect([r.index.n, r.albums]).toEqual([21, null]);
    expect(api.monthCalls()).toHaveLength(7);
    expect(errors).toHaveLength(1);
    expect((errors[0] as ApiFailure).code).toBe('auth');
    expect((await libraryCache(kv).snapshot('lib-a'))?.cols.n).toBe(21);
  });

  it('reports each 503 retry (attempt 1, 2, …) before backing off', async () => {
    let n = 0;
    const attempts: number[] = [];
    const api = fakeApi({override: p => p === '/api/index' && n++ < 2 ? json({error: 'Immich is starting.', code: 'unavailable'}, 503) : undefined});
    await refreshIndex(ctx(await freshKV(), api, {onRetry: a => attempts.push(a)}));
    expect(attempts).toEqual([1, 2]);
  });

  it('a backend that doesn\'t answer at all is a network failure, not retried', async () => {
    const api = fakeApi();
    const err = await refreshIndex(ctx(await freshKV(), api, {fetch: () => Promise.reject(new TypeError('Failed to fetch'))})).catch(e => e);
    expect([err instanceof ApiFailure, err.code]).toEqual([true, 'network']);
  });

  it('writes nothing once aborted while a staging write is pending: no swap', async () => {
    const ac = new AbortController();
    let release!: () => void;
    const {kv, writes} = spyKV(await freshKV(), put => {
      if (Object.keys(put).some(k => k.includes('/staging/'))) { ac.abort(); return new Promise(r => { release = r; }); }
    });
    const p = refreshIndex(ctx(kv, fakeApi(), {signal: ac.signal, concurrency: 1}));
    await vi.waitFor(() => expect(release).toBeDefined());
    release();
    await expect(p).rejects.toThrow();
    expect(writes.flatMap(w => w.put).filter(k => k.includes('/staging/'))).toHaveLength(1);
    expect(writes.flatMap(w => w.put)).not.toContain('lib-a/snapshot');
  });

  it('holds the library lock around build and swap', async () => {
    const request = vi.fn((_name: string, _opts: LockOptions, fn: () => Promise<unknown>) => fn());
    await refreshIndex(ctx(await freshKV(), fakeApi(), {locks: {request} as unknown as LockManager}));
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toBe('immich-retrace:lib-a');
  });

  it('a second tab waiting on the lock takes the snapshot the first one wrote', async () => {
    const kv = await freshKV(), a = fakeApi(), b = fakeApi();
    const [ra, rb] = await Promise.all([refreshIndex(ctx(kv, a)), refreshIndex(ctx(kv, b))]);
    expect(a.monthCalls().length + b.monthCalls().length).toBe(7);
    expect(rb.index.id).toEqual(ra.index.id);
  });

  it('tells another tab\'s snapshot from its own previous one without the clock (frozen clock)', async () => {
    // Every swap waits until both concurrent runs below have read their baseline (onManifest comes after).
    let manifests = 0;
    const {kv} = spyKV(await freshKV(), put => vi.waitFor(() => { if ('lib-a/snapshot' in put && manifests < 2) throw new Error('hold'); }, {interval: 1})),
      frozen = {now: () => 1_000}, cache = libraryCache(kv);
    manifests = 2;
    await refreshIndex(ctx(kv, fakeApi(), frozen));
    const again = fakeApi();
    await refreshIndex(ctx(kv, again, frozen));
    expect(again.monthCalls().length).toBe(7);
    // A snapshot from before `gen` existed is never taken for another tab's.
    const {gen: _, ...legacy} = (await cache.snapshot('lib-a'))!;
    await kv.write({'lib-a/snapshot': legacy}, ['lib-a/gen']);
    const old = fakeApi();
    await refreshIndex(ctx(kv, old, frozen));
    expect(old.monthCalls().length).toBe(7);
    manifests = 0;
    const a = fakeApi(), b = fakeApi(), hooks = {onManifest: () => { manifests++; }};
    const [ra, rb] = await Promise.all([refreshIndex(ctx(kv, a, frozen), hooks), refreshIndex(ctx(kv, b, frozen), hooks)]);
    expect(a.monthCalls().length + b.monthCalls().length).toBe(7);
    expect(rb.index.id).toEqual(ra.index.id);
  });

  it('after a swap, drops other libraries and members of albums that are gone', async () => {
    const kv = await freshKV(), cache = libraryCache(kv);
    await kv.write({'old-lib/snapshot': 1, 'old-lib/albums': [], 'lib-a/members/gone': 1});
    await refreshIndex(ctx(kv, fakeApi()));
    expect(await kv.keys('old-lib/')).toEqual([]);
    expect(await cache.members('lib-a', 'gone')).toBeUndefined();
    expect(await cache.snapshot('lib-a')).toBeDefined();
  });

  it('rejects a manifest from another schema version', async () => {
    const api = fakeApi({override: p => p === '/api/index' ? json({schema: SCHEMA_VERSION + 1, library: 'lib-a', months: []}) : undefined});
    await expect(refreshIndex(ctx(await freshKV(), api))).rejects.toThrow('reload');
  });

  it('stops on abort', async () => {
    const ac = new AbortController(), api = fakeApi();
    const p = refreshIndex(ctx(await freshKV(), api, {signal: ac.signal, concurrency: 1}), {onProgress: d => { if (d === 2) ac.abort(); }});
    await expect(p).rejects.toThrow();
    expect(api.monthCalls().length).toBe(2);
  });

  it('caches album members by version; members can be outside the library', async () => {
    const kv = await freshKV(), api = fakeApi();
    const ix = await albumMembers(ctx(kv, api), 'lib-a', ALBUMS[0]);
    expect(ix.n).toBe(3);
    expect(ix.idToRow.has('foreign-1')).toBe(true);
    expect(ix.t).toBeInstanceOf(Float64Array);
    await albumMembers(ctx(kv, api), 'lib-a', ALBUMS[0]);
    expect(api.calls.length).toBe(1);
    await albumMembers(ctx(kv, api), 'lib-a', {...ALBUMS[0], version: 'v2'});
    expect(api.calls.length).toBe(2);
  });
});

describe('cache storage', () => {
  it('uses a DB per schema and deletes other schemas\' DBs', async () => {
    const idb = new IDBFactory();
    expect(DB_NAME).toBe(`immich-retrace-v${SCHEMA_VERSION}`);
    for (const name of ['immich-retrace-v1', 'immich-retrace-v99', 'immich-viewer-v4', 'someone-else']) await libraryCache(await openKV(idb, name)).setLast('x');
    await libraryCache(await openKV(idb)).setLast('lib-a');
    await dropOtherSchemas(idb);
    expect((await idb.databases()).map(d => d.name).sort()).toEqual([DB_NAME, 'someone-else']);
    expect(await libraryCache(await openKV(idb)).last()).toBe('lib-a');
  });

  it('falls back to memory when another tab deletes the open DB', async () => {
    const idb = new IDBFactory(), kv = await openKV(idb, 'doomed');
    await kv.write({a: 1});
    await new Promise<void>(r => { idb.deleteDatabase('doomed').onsuccess = () => r(); });
    await kv.write({b: 2});
    expect(await kv.get('b')).toBe(2);
  });

  it('works memory-only when IndexedDB is unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const blocked = {open() { throw new DOMException('denied', 'SecurityError'); }} as unknown as IDBFactory;
    const kv = await openKV(blocked);
    expect(warn).toHaveBeenCalled();
    const r = await refreshIndex(ctx(kv, fakeApi()));
    expect(r.index.n).toBe(21);
    expect((await libraryCache(kv).snapshot('lib-a'))?.cols.n).toBe(21);
  });

  it('memory and IndexedDB stores agree on prefix list/clear', async () => {
    for (const kv of [memoryKV(), await freshKV()]) {
      await kv.write({'a/1': 1, 'a/2': 2, 'ab/1': 3, b: 4});
      expect(await kv.list('a/')).toEqual([1, 2]);
      expect(await kv.keys('a')).toEqual(['a/1', 'a/2', 'ab/1']);
      await kv.write({'a/3': 5}, ['a/']);
      expect(await kv.list('a')).toEqual([5, 3]);
      expect(await kv.get('b')).toBe(4);
    }
  });
});

describe('store', () => {
  it('serves the snapshot on reload, then refreshes to ready', async () => {
    const kv = await freshKV(), lib = store(kv, fakeApi());
    await lib.load();
    expect([lib.status, lib.index?.n, lib.albums.length]).toEqual(['ready', 21, 1]);
    const again = store(kv, fakeApi({delay: () => 50}));
    const p = again.load();
    await vi.waitFor(() => expect(again.status).toBe('cached'), {interval: 1});
    expect(again.index?.n).toBe(21);
    await p;
    expect(again.status).toBe('ready');
  });

  it('on auth failure purges only after every in-flight staging write has landed', async () => {
    const {kv, writes} = spyKV(await freshKV(), async put => { if (Object.keys(put).some(k => k.includes('/staging/'))) await tick(30); });
    const lib = store(kv, fakeApi({override: p => p === '/api/index/2023-03' ? auth() : undefined, delay: p => p === '/api/index/2023-03' ? 5 : 1}));
    await lib.load();
    expect(lib.status).toBe('error');
    const purge = writes.findIndex(w => w.clear.includes('lib-a/'));
    expect(purge).toBeGreaterThan(0);
    expect(writes.slice(purge + 1).flatMap(w => w.put).filter(k => k.includes('/staging/'))).toEqual([]);
    expect(writes.slice(0, purge).flatMap(w => w.put).filter(k => k.includes('/staging/')).length).toBeGreaterThan(0);
    expect(await libraryCache(kv).staged('lib-a')).toEqual([]);
  });

  it('an auth failure from membersOf (no album.read) is the album\'s error: library and cache stay', async () => {
    const kv = await freshKV(), lib = store(kv, fakeApi());
    await lib.load();
    vi.stubGlobal('fetch', fakeApi({override: p => p.endsWith('/assets') ? auth() : undefined}).fetch);
    await expect(lib.membersOf('alb-1')).rejects.toThrow('rejected');
    expect([lib.status, lib.index?.n, lib.albums.length]).toEqual(['ready', 21, 1]);
    expect((await libraryCache(kv).snapshot('lib-a'))?.cols.n).toBe(21);
  });

  it('a key without album.read: albums unavailable, the cached library is never purged', async () => {
    const kv = await freshKV();
    await store(kv, fakeApi()).load();
    const {kv: spy, writes} = spyKV(kv);
    const lib = store(spy, fakeApi({override: p => p === '/api/albums' ? auth() : undefined}));
    await lib.load();
    expect([lib.status, lib.index?.n, lib.albums, lib.albumsLoaded]).toEqual(['ready', 21, [], true]);
    expect((lib.albumsError as ApiFailure).code).toBe('auth');
    expect(writes.flatMap(w => w.clear)).not.toContain('lib-a/');
    expect((await libraryCache(kv).snapshot('lib-a'))?.cols.n).toBe(21);
    expect(await libraryCache(kv).albums('lib-a')).toEqual(ALBUMS);
  });

  it('retryAlbums: after the list failed, fetches only the list and fills it', async () => {
    const kv = await freshKV();
    let fail = true;
    const api = fakeApi({override: p => (p === '/api/albums' && fail ? auth() : undefined)});
    const lib = store(kv, api);
    await lib.load();
    expect([lib.albums, lib.albumsLoaded]).toEqual([[], true]);
    expect(lib.albumsError).toBeTruthy();
    fail = false;
    const asked: string[] = [];
    vi.stubGlobal('fetch', (u: string, i?: RequestInit) => { asked.push(u); return api.fetch(u, i); });
    await lib.retryAlbums();
    expect(asked).toEqual(['/api/albums']);
    expect([lib.albums, lib.albumsError, lib.albumsLoaded, lib.status]).toEqual([ALBUMS, null, true, 'ready']);
    expect(await libraryCache(kv).albums('lib-a')).toEqual(ALBUMS);
  });

  it('a purge waits for an album retry still writing: nothing of it lands after the purge', async () => {
    const base = await freshKV();
    let fail = true;
    let entered = () => {};
    const writing = new Promise<void>(r => { entered = r; });
    const {kv, writes} = spyKV(base, async put => {
      if (Object.keys(put).some(k => k.endsWith('/albums')) && !fail) { entered(); await tick(30); }
    });
    const lib = store(kv, fakeApi({override: p => (p === '/api/albums' && fail ? auth() : undefined)}));
    await lib.load();
    fail = false;
    // Two taps: one retry; the purge waits for its write, which has begun.
    const retry = lib.retryAlbums(), again = lib.retryAlbums();
    await writing;
    await lib.invalidate();
    await Promise.all([retry, again]);
    const purge = writes.findIndex(w => w.clear.includes('lib-a/'));
    expect(purge).toBeGreaterThan(0);
    expect(writes.slice(purge + 1).flatMap(w => w.put)).toEqual([]);
    expect(await libraryCache(base).albums('lib-a')).toBeUndefined();
  });

  it('only an index failure means a bad key: an index 403 still purges', async () => {
    const kv = await freshKV();
    await store(kv, fakeApi()).load();
    const lib = store(kv, fakeApi({override: p => p === '/api/index' ? auth() : undefined}));
    await lib.load();
    expect([lib.status, lib.index, (lib.failure as ApiFailure).code, lib.albumsLoaded]).toEqual(['error', null, 'auth', true]);
    expect(await libraryCache(kv).snapshot('lib-a')).toBeUndefined();
  });

  it('shows the load phases: connecting, waiting for Immich (attempt n), loading months', async () => {
    let n = 0;
    const seen = new Set<string>();
    const lib = store(await freshKV(), fakeApi({override: p => p === '/api/index' && n++ < 1 ? json({error: 'starting', code: 'unavailable'}, 503) : undefined}));
    const p = lib.load();
    const watch = setInterval(() => seen.add(phaseText(lib.phase, lib.attempt, lib.progress).replace(/\d+\/\d+/, 'x/y')), 0);
    // The real backoff is 2 s; let it run.
    await p.finally(() => clearInterval(watch));
    expect([...seen]).toEqual(expect.arrayContaining(['Connecting to Immich…', 'Waiting for Immich to start (attempt 2)…', 'Loading x/y months']));
    expect(lib.phase).toBeNull();
  }, 10_000);

  it('membersOf returns the album as its own index', async () => {
    const lib = store(await freshKV(), fakeApi());
    await lib.load();
    const ix = await lib.membersOf('alb-1');
    expect(ix.idToRow.has('foreign-1')).toBe(true);
    expect(lib.index!.idToRow.has('foreign-1')).toBe(false);
  });

  it('prefetched members (a landing) stand in for the index\'s offsets and serve membersOf without a second fetch', async () => {
    const kv = await freshKV(), api = fakeApi(), lib = store(kv, api);
    lib.prefetchMembers('alb-1');
    expect(lib.earlyPending).toBe(true);
    lib.prefetchMembers('alb-1'); // one at a time
    await vi.waitFor(() => expect(lib.earlyPending).toBe(false));
    expect(lib.early?.ix?.n).toBe(3);
    expect(lib.index).toBeNull();
    expect(lib.offsets).toBe(lib.early!.ix); // local days before the index is in
    await lib.load();
    expect(lib.offsets).toBe(lib.index);
    const ix = await lib.membersOf('alb-1');
    expect(ix).toBe(lib.early!.ix);
    expect(api.calls.filter(c => c.endsWith('/assets'))).toHaveLength(1);
    // Cached as a normal fetch would be.
    await vi.waitFor(async () => expect((await libraryCache(kv).members('lib-a', 'alb-1'))?.version).toBe('v1'));
  });

  it('prefetched members of another version, or a failed prefetch, fall back to the usual fetch', async () => {
    const stale = fakeApi({override: p => (p.endsWith('/assets') ? json({id: 'alb-1', version: 'v0', columns: members()}) : undefined)});
    let lib = store(await freshKV(), stale);
    lib.prefetchMembers('alb-1');
    await vi.waitFor(() => expect(lib.early?.version).toBe('v0'));
    vi.stubGlobal('fetch', fakeApi().fetch);
    await lib.load();
    expect(await lib.membersOf('alb-1')).not.toBe(lib.early!.ix);
    const down = fakeApi({override: p => (p.endsWith('/assets') ? json({error: 'x', code: 'upstream'}, 502) : undefined)});
    lib = store(await freshKV(), down);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    lib.prefetchMembers('alb-1');
    await vi.waitFor(() => expect(lib.earlyPending).toBe(false));
    expect(lib.early).toMatchObject({albumId: 'alb-1', ix: null});
    expect(lib.offsets).toBeNull();
  });

  it('prefetched members go with the library: invalidated (key rejected) or cleared, and a late answer is dropped', async () => {
    let lib = store(await freshKV(), fakeApi());
    lib.prefetchMembers('alb-1');
    await vi.waitFor(() => expect(lib.early?.ix).toBeTruthy());
    await lib.invalidate();
    expect([lib.early, lib.offsets]).toEqual([null, null]);
    lib = store(await freshKV(), fakeApi({delay: p => (p.endsWith('/assets') ? 50 : 1)}));
    lib.prefetchMembers('alb-1');
    await lib.invalidate();
    await tick(80);
    expect([lib.early, lib.earlyPending]).toEqual([null, false]);
    // Another library on a later load (a new key): dropped; on a first visit they are kept (they are its own).
    const kv = await freshKV();
    lib = store(kv, fakeApi());
    lib.prefetchMembers('alb-1');
    await lib.load();
    expect(lib.early?.ix).toBeTruthy();
    vi.stubGlobal('fetch', fakeApi({library: 'lib-b'}).fetch);
    await lib.load();
    expect(lib.early).toBeNull();
  });

  it('a redirect (viewer session expired) is signed-out: error shown, nothing purged', async () => {
    const kv = await freshKV(), lib = store(kv, fakeApi());
    await lib.load();
    const redirect = () => Object.defineProperty(new Response(null), 'type', {value: 'opaqueredirect'});
    for (const respond of [redirect, () => new Response('', {status: 401})]) {
      vi.stubGlobal('fetch', fakeApi({override: respond}).fetch);
      await lib.load();
      expect([lib.status, lib.error]).toEqual(['error', 'Signed out — reload the page.']);
      expect(lib.index?.n).toBe(21);
      expect((await libraryCache(kv).snapshot('lib-a'))?.cols.n).toBe(21);
    }
  });

  it('clearCache waits for the running refresh before wiping', async () => {
    const {kv, writes} = spyKV(await freshKV(), async put => { if (Object.keys(put).some(k => k.includes('/staging/'))) await tick(20); });
    const lib = store(kv, fakeApi({delay: () => 5}));
    const first = lib.load();
    await vi.waitFor(() => expect(writes.some(w => w.put.some(k => k.includes('/staging/')))).toBe(true));
    const cleared = lib.clearCache();
    await first;
    await cleared;
    const wipe = writes.findIndex(w => w.clear.includes(''));
    expect(writes.slice(0, wipe).flatMap(w => w.put)).not.toContain('lib-a/snapshot');
    expect(lib.status).toBe('ready');
  });
});
