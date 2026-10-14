import {SCHEMA_VERSION} from '../../../../shared/api.ts';
import type {AlbumMembers, AlbumSummary, ApiError, IndexManifest, MonthColumns} from '../../../../shared/api.ts';
import type {KV} from './idb.ts';
import {buildIndex, columnsOf, withLookup, type IndexColumns, type LibraryIndex} from './model.ts';

/**
 * `signed-out`: the viewer's own session (Authelia) expired; nothing is wrong with the library.
 * `network`: the viewer's backend didn't answer at all. `outdated`: the backend speaks another schema.
 */
export type FailureCode = ApiError['code'] | 'signed-out' | 'network' | 'outdated';

export class ApiFailure extends Error {
  status: number;
  code?: FailureCode;
  constructor(status: number, message: string, code?: FailureCode) {
    super(message);
    this.status = status; this.code = code;
  }
}

export interface Snapshot { manifest: IndexManifest; cols: IndexColumns; savedAt: number }
/** One month of an unfinished first build; `count` is the manifest's count when it was fetched. */
export interface Staged { refreshId: string; startedAt: number; count: number; cols: MonthColumns }

/** Every cache key of a library lives under `${library}/`, so purging is one prefix delete. */
export function libraryCache(kv: KV) {
  // The cache is best effort: a failed read is a miss, a failed write is logged and ignored.
  const safe = <T>(f: () => Promise<T>) => f().catch(e => { console.warn('index cache:', e); return undefined; });
  return {
    last: () => safe(() => kv.get<string>('last')),
    snapshot: (lib: string) => safe(() => kv.get<Snapshot>(`${lib}/snapshot`)),
    staged: async (lib: string) => (await safe(() => kv.list<Staged>(`${lib}/staging/`))) ?? [],
    albums: (lib: string) => safe(() => kv.get<AlbumSummary[]>(`${lib}/albums`)),
    members: (lib: string, album: string) => safe(() => kv.get<AlbumMembers>(`${lib}/members/${album}`)),
    setLast: (lib: string) => safe(() => kv.write({last: lib})),
    stage: (lib: string, s: Staged) => safe(() => kv.write({[`${lib}/staging/${s.cols.month}`]: s})),
    /** Atomic: readers see either the old snapshot with its staging, or the new one without. */
    swap: (lib: string, snap: Snapshot) => safe(() => kv.write({[`${lib}/snapshot`]: snap, last: lib}, [`${lib}/staging/`])),
    /** Also drops cached members of albums that are gone. */
    setAlbums: (lib: string, a: AlbumSummary[]) => safe(async () => {
      const keep = new Set(a.map(x => `${lib}/members/${x.id}`));
      await kv.write({[`${lib}/albums`]: a}, (await kv.keys(`${lib}/members/`)).filter(k => !keep.has(k)));
    }),
    setMembers: (lib: string, m: AlbumMembers) => safe(() => kv.write({[`${lib}/members/${m.id}`]: m})),
    /** Drops every library but `lib` (left behind by a key rotation or a new Immich URL). */
    dropOthers: (lib: string) => safe(async () => {
      const others = new Set((await kv.keys('')).filter(k => k.includes('/')).map(k => k.slice(0, k.indexOf('/') + 1)));
      others.delete(`${lib}/`);
      if (others.size) await kv.write({}, [...others]);
    }),
    purge: (lib: string) => safe(() => kv.write({}, [`${lib}/`])),
    clear: () => safe(() => kv.write({}, [''])),
  };
}
export type LibraryCache = ReturnType<typeof libraryCache>;

export interface Ctx {
  cache: LibraryCache;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /** Defaults to navigator.locks; without it tabs don't coordinate (still correct, just double work). */
  locks?: Pick<LockManager, 'request'>;
  /** Backoff before each retry of a 503; Immich may be waking behind its gate (30–60 s). */
  delays?: number[];
  /** Called before each such retry (attempt 1, 2, …), for "waiting for Immich to start". */
  onRetry?(attempt: number, err: ApiFailure): void;
  concurrency?: number;
  now?: () => number;
}

const STAGE_TTL = 3600e3;
const DELAYS = [2e3, 4e3, 8e3, 16e3, 30e3];
const signedOut = () => new ApiFailure(0, 'Signed out — reload the page.', 'signed-out');

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((ok, fail) => {
    if (signal?.aborted) return fail(signal.reason);
    const t = setTimeout(() => { signal?.removeEventListener('abort', stop); ok(); }, ms);
    const stop = () => { clearTimeout(t); fail(signal!.reason); };
    signal?.addEventListener('abort', stop, {once: true});
  });
}

async function getJson<T>(ctx: Ctx, path: string): Promise<T> {
  const {signal} = ctx;
  const f = ctx.fetch ?? globalThis.fetch.bind(globalThis), delays = ctx.delays ?? DELAYS;
  for (let attempt = 0; ; attempt++) {
    // An expired Authelia session redirects to its login page; following it would just yield HTML.
    let res: Response;
    try { res = await f(path, {signal, redirect: 'manual'}); } catch (e) {
      if (signal?.aborted) throw e;
      throw new ApiFailure(0, 'Can\'t reach the viewer\'s server.', 'network');
    }
    if (res.type === 'opaqueredirect') throw signedOut();
    if (res.ok && !res.headers.get('content-type')?.includes('json')) throw new ApiFailure(res.status, 'Unexpected answer from the viewer backend.');
    if (res.ok) return await res.json() as T;
    const body = await res.json().catch(() => ({})) as Partial<ApiError>;
    // Our backend never answers 401/403 itself (a rejected Immich key is a 502 'auth').
    if ((res.status === 401 || res.status === 403) && typeof body.error !== 'string') throw signedOut();
    const err = new ApiFailure(res.status, body.error ?? `${path}: HTTP ${res.status}`, body.code);
    if ((res.status !== 503 && err.code !== 'unavailable') || attempt >= delays.length) throw err;
    ctx.onRetry?.(attempt + 1, err);
    await sleep(delays[attempt], signal);
  }
}

/**
 * Awaits every task. The first failure aborts `ac` at once so the others stop early, and is
 * thrown only after all have settled: no task can still be writing to the cache when the caller
 * reacts (e.g. purges).
 */
async function settle<T>(ac: AbortController, tasks: Promise<T>[]): Promise<T[]> {
  const rs = await Promise.allSettled(tasks.map(p => p.catch(e => { ac.abort(e); throw e; })));
  ac.signal.throwIfAborted();
  return rs.map(r => (r as PromiseFulfilledResult<T>).value);
}

/** Runs fn over items, at most n at a time; failure handling as in settle(). */
async function pool<T>(ac: AbortController, items: T[], n: number, fn: (x: T) => Promise<void>) {
  let next = 0;
  await settle(ac, Array.from({length: Math.min(n, items.length)}, async () => {
    while (next < items.length && !ac.signal.aborted) await fn(items[next++]);
  }));
}

/** Holds the library's Web Lock while fn runs, so two tabs never build/swap the same library at once. */
function locked<T>(ctx: Ctx, lib: string, signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  const locks = ctx.locks ?? globalThis.navigator?.locks;
  return locks ? locks.request(`immich-viewer:${lib}`, {signal}, fn) : fn();
}

export interface RefreshHooks {
  /** Called as soon as the manifest is in; its months make the provisional overview. */
  onManifest?(m: IndexManifest): void;
  onProgress?(done: number, total: number): void;
  onAlbums?(a: AlbumSummary[]): void;
  /** The album list failed; the index goes on (a key without album.read still shows the timeline). */
  onAlbumsError?(e: unknown): void;
}

/**
 * Full refresh: manifest → every month → build → atomic swap. There is no change feed for API
 * keys, so nothing is incremental. No cache write and no hook happens once the run is aborted.
 * Albums load alongside but on their own: their failure is reported (`albums: null`, onAlbumsError)
 * and neither stops the index nor fails the run; only an index failure rejects.
 */
export async function refreshIndex(ctx: Ctx, hooks: RefreshHooks = {}): Promise<{manifest: IndexManifest; index: LibraryIndex; albums: AlbumSummary[] | null}> {
  const {cache} = ctx, now = ctx.now ?? Date.now;
  // One controller for the index: any month failing stops the other requests (and the albums) too.
  const ac = new AbortController(), {signal} = ac, stop = () => ac.abort(ctx.signal!.reason);
  ctx.signal?.addEventListener('abort', stop, {once: true});
  if (ctx.signal?.aborted) stop();
  const sub = {...ctx, signal};
  try {
    const manifest = await getJson<IndexManifest>(sub, '/api/index');
    if (manifest.schema !== SCHEMA_VERSION) throw new ApiFailure(0, 'The viewer was updated; reload the page.', 'outdated');
    const lib = manifest.library, startedAt = now();
    signal.throwIfAborted();
    await cache.setLast(lib);
    signal.throwIfAborted();
    hooks.onManifest?.(manifest);

    const albums = getJson<AlbumSummary[]>(sub, '/api/albums').then(async a => {
      signal.throwIfAborted();
      await cache.setAlbums(lib, a);
      if (!signal.aborted) hooks.onAlbums?.(a);
      return a;
    }).catch(e => {
      if (!signal.aborted) hooks.onAlbumsError?.(e);
      return null;
    });
    const index = locked(ctx, lib, signal, async (): Promise<LibraryIndex> => {
      const prev = await cache.snapshot(lib);
      // Another tab swapped in a snapshot while we waited for the lock: take it instead of refetching.
      if (prev && prev.savedAt >= startedAt) return withLookup(prev.cols);
      const want = new Map(manifest.months.map(m => [m.month, m.count]));
      const got = new Map<string, MonthColumns>(), refreshId = Math.random().toString(36).slice(2);
      // Staging only resumes an interrupted *first* build, reusing months whose count is unchanged
      // and that are < 1 h old; that build can thus be up to 1 h stale (edits don't change counts),
      // accepted since the next visit refreshes fully. With a snapshot shown, every month is
      // refetched and nothing staged.
      if (!prev) for (const s of await cache.staged(lib))
        if (want.get(s.cols.month) === s.count && now() - s.startedAt < STAGE_TTL) got.set(s.cols.month, s.cols);
      if (!signal.aborted) hooks.onProgress?.(got.size, want.size);
      await pool(ac, manifest.months.filter(m => !got.has(m.month)), ctx.concurrency ?? 5, async ({month, count}) => {
        const cols = await getJson<MonthColumns>(sub, `/api/index/${encodeURIComponent(month)}`);
        signal.throwIfAborted();
        if (!prev) await cache.stage(lib, {refreshId, startedAt, count, cols});
        got.set(month, cols);
        if (!signal.aborted) hooks.onProgress?.(got.size, want.size);
      });
      const index = buildIndex(manifest.months.map(m => got.get(m.month)!));
      signal.throwIfAborted();
      await cache.swap(lib, {manifest, cols: columnsOf(index), savedAt: now()});
      return index;
    });
    // The albums settle before this returns or throws (they never reject): no album write can land
    // after the caller reacts, e.g. purges on a rejected key.
    const [ix] = await settle(ac, [index]).finally(() => albums);
    const a = await albums;
    signal.throwIfAborted();
    await cache.dropOthers(lib);
    return {manifest, index: ix, albums: a};
  } finally {
    ctx.signal?.removeEventListener('abort', stop);
  }
}

/** An album's members (incl. other users' assets in shared albums), from cache while its version is unchanged. */
export async function albumMembers(ctx: Ctx, lib: string, album: AlbumSummary): Promise<LibraryIndex> {
  let m = await ctx.cache.members(lib, album.id);
  if (m?.version !== album.version) {
    m = await getJson<AlbumMembers>(ctx, `/api/albums/${encodeURIComponent(album.id)}/assets`);
    ctx.signal?.throwIfAborted();
    await ctx.cache.setMembers(lib, m);
  }
  ctx.signal?.throwIfAborted();
  return buildIndex([m.columns]);
}
