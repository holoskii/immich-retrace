import type {AlbumMembers, AlbumSummary, IndexManifest} from '../../../../shared/api.ts';
import {openKV} from './idb.ts';
import {albumMembers, ApiFailure, fetchAlbums, fetchMembers, libraryCache, refreshIndex, type LibraryCache} from './refresh.ts';
import {buildIndex, withLookup, type IndexColumns, type LibraryIndex} from './model.ts';

/** cached: showing the last snapshot, manifest pending · building: no index yet · refreshing: snapshot shown, new one loading. */
export type Status = 'cached' | 'building' | 'refreshing' | 'ready' | 'error';

/** `albums`: a retry of the album list (it writes to the cache too, so stopping waits for it). */
interface Run { ac: AbortController; refresh?: Promise<unknown>; albums?: Promise<unknown> }

/** Where a run is: before the manifest, backing off while Immich wakes (503), or fetching months. */
export type Phase = 'connecting' | 'waiting' | 'loading';

/** The phase in words: "Connecting…", "Waiting for Immich to start (attempt 2)…", "Loading 12/134 months". */
export function phaseText(phase: Phase | null, attempt: number, progress: {done: number; total: number}) {
  switch (phase) {
    case 'connecting': return 'Connecting to Immich…';
    case 'waiting': return `Waiting for Immich to start (attempt ${attempt + 1})…`;
    case 'loading': return progress.total ? `Loading ${progress.done}/${progress.total} months` : 'Loading…';
    default: return '';
  }
}

/**
 * The header's status, split in two. `shown` stays in the bar: the first build's load phases, waiting for
 * Immich, errors, else the item count. `detail` goes in the ⋯ menu: background refresh chatter (cached,
 * checking for changes, month counts). `busy`: a background refresh is running (a dot on the ⋯ button).
 * `items`: the formatted item count ("1 688 items"), empty before there is an index. `quiet` (the demo): no
 * month counters, just "Loading…".
 */
export function headerStatus(s: {status: Status; phase: Phase | null; attempt: number; progress: {done: number; total: number}; items: string; error: string | null; quiet?: boolean}) {
  const phase = s.quiet && s.phase === 'loading' ? 'Loading…' : phaseText(s.phase, s.attempt, s.progress), items = s.items;
  switch (s.status) {
    case 'building': return {shown: phase || 'building index', detail: phase || 'Building the index', busy: false};
    case 'refreshing':
      return {shown: s.phase === 'waiting' ? phase : items, detail: `Refreshing in the background · ${phase || 'loading'}`, busy: true};
    case 'cached':
      return {shown: s.phase === 'waiting' ? phase : items, detail: 'Showing the cached copy · checking for changes', busy: true};
    case 'ready': return {shown: items || 'ready', detail: `Up to date${items ? ` · ${items}` : ''}`, busy: false};
    case 'error': return {shown: `error: ${s.error ?? 'unknown'}`, detail: `Error: ${s.error ?? 'unknown'}`, busy: false};
  }
}

export class LibraryStore {
  status = $state<Status>('building');
  // Raw: deep proxies over 30k-element columns would cost far more than they give.
  index = $state.raw<LibraryIndex | null>(null);
  /** Manifest months while a first index builds, for a provisional overview. */
  provisional = $state.raw<IndexManifest['months'] | null>(null);
  progress = $state.raw({done: 0, total: 0});
  albums = $state.raw<AlbumSummary[]>([]);
  /** The album list of this run failed (the index is unaffected); null when fine or not known yet. */
  albumsError = $state.raw<unknown>(null);
  /** This run's album list arrived or failed: an `?album=` URL can be resolved (or given up) now. */
  albumsLoaded = $state(false);
  error = $state<string | null>(null);
  /** The error itself, for explainIndex(); `error` is its message. */
  failure = $state.raw<unknown>(null);
  /** null when idle (ready, error). `attempt` counts the 503 retries while waiting. */
  phase = $state<Phase | null>(null);
  attempt = $state(0);
  /**
   * One album's members fetched ahead of everything (`prefetchMembers`: the demo landing's trip, at t0): `ix` null when
   * that failed. Until the index is in, its offsets stand in for the library's (`offsets`).
   */
  early = $state.raw<{albumId: string; version: string; ix: LibraryIndex | null} | null>(null);
  /** A `prefetchMembers` is in flight. */
  earlyPending = $state(false);
  /** `early` as fetched, for the cache. */
  #earlyRaw?: AlbumMembers;
  /** Bumped when the library is invalidated or cleared: a prefetch still in flight is dropped. */
  #earlyGen = 0;
  #lib?: string;
  #cache?: Promise<LibraryCache>;
  #run?: Run;
  #open: () => Promise<LibraryCache>;

  constructor(open = () => openKV().then(libraryCache)) { this.#open = open; }

  #getCache() { return this.#cache ??= this.#open(); }

  /**
   * The rows whose local offsets convert instants to local days (`toLocal`, `albumSpan`): the library index, or before
   * it is in the prefetched album's members, so a landing can open its trip with the right days.
   */
  get offsets(): IndexColumns | null { return this.index ?? this.early?.ix ?? null; }

  /**
   * Fetches album `albumId`'s members now, without the album list or the index (a landing that knows its album from
   * the config). `membersOf` uses them when the list's version matches; a failure only means the usual path later.
   */
  prefetchMembers(albumId: string, fetchFn?: typeof fetch) {
    if (this.earlyPending || this.early?.albumId === albumId) return;
    this.earlyPending = true;
    const gen = this.#earlyGen;
    fetchMembers({fetch: fetchFn}, albumId).then(
      m => { if (gen === this.#earlyGen) { this.#earlyRaw = m; this.early = {albumId, version: m.version, ix: buildIndex([m.columns])}; } },
      e => { console.warn('album members:', e); if (gen === this.#earlyGen) this.early = {albumId, version: '', ix: null}; },
    ).finally(() => { if (gen === this.#earlyGen) this.earlyPending = false; });
  }

  /** Forgets the prefetched members (the key was rejected, the cache cleared): nothing of the old library stays. */
  #dropEarly() {
    this.#earlyGen++; this.early = null; this.#earlyRaw = undefined; this.earlyPending = false;
  }

  // The one place to narrow what is shown (owner, shared library) once that is needed.
  #show(ix: LibraryIndex | null) { this.index = ix; }

  #reset() { this.#show(null); this.albums = []; this.provisional = null; }

  /** Aborts the current run and waits until its refresh can no longer write to the cache. */
  async #stop() {
    const r = this.#run;
    this.#run = undefined;
    r?.ac.abort();
    await r?.refresh?.catch(() => {});
    await r?.albums?.catch(() => {});
  }

  #fail(e: unknown) {
    this.status = 'error'; this.error = e instanceof Error ? e.message : String(e); this.failure = e;
    this.phase = null; this.albumsLoaded = true;
  }

  /** Cached snapshot first, then a full refresh in the background. */
  async load() {
    await this.#stop();
    const run: Run = this.#run = {ac: new AbortController()}, {signal} = run.ac;
    const current = () => this.#run === run && !signal.aborted;
    try {
      const cache = await this.#getCache();
      const lib = await cache.last(), snap = lib ? await cache.snapshot(lib) : undefined;
      const albums = lib && snap ? await cache.albums(lib) : undefined;
      if (!current()) return;
      this.error = null; this.failure = null; this.progress = {done: 0, total: 0};
      this.albumsError = null; this.albumsLoaded = false; this.phase = 'connecting'; this.attempt = 0;
      if (snap) { this.#lib = lib; this.#show(withLookup(snap.cols)); this.albums = albums ?? []; this.status = 'cached'; }
      else { this.#reset(); this.status = 'building'; }
      const onRetry = (n: number) => { if (current()) { this.phase = 'waiting'; this.attempt = n; } };
      const refresh = run.refresh = refreshIndex({cache, signal, onRetry}, {
        onManifest: m => {
          if (!current()) return;
          this.phase = 'loading';
          if (m.library !== this.#lib) {
            // Another library than the one shown (a new key or URL): its prefetched members go too. Not on a first
            // visit (no library yet), where they are this one's.
            if (this.#lib !== undefined) this.#dropEarly();
            this.#reset(); this.#lib = m.library;
          }
          if (!this.index) this.provisional = m.months;
          this.status = this.index ? 'refreshing' : 'building';
        },
        onProgress: (done, total) => { if (current()) { this.progress = {done, total}; this.phase = 'loading'; } },
        onAlbums: a => { if (current()) { this.albums = a; this.albumsLoaded = true; } },
        onAlbumsError: e => {
          if (!current()) return;
          console.warn('albums:', e);
          // Without album.read the cached list is no longer what the key may see: hide it (the cache stays).
          if (e instanceof ApiFailure && e.code === 'auth') this.albums = [];
          this.albumsError = e; this.albumsLoaded = true;
        },
      });
      const r = await refresh;
      if (!current()) return;
      this.#show(r.index); if (r.albums) this.albums = r.albums;
      this.provisional = null; this.status = 'ready'; this.phase = null; this.albumsLoaded = true;
    } catch (e) {
      if (!current()) return;
      // Only the index (asset.read) failing with 'auth' means the key was rejected: albums never get here.
      if (e instanceof ApiFailure && e.code === 'auth') await this.invalidate();
      this.#fail(e);
    }
  }

  /**
   * Immich rejected the key (revoked or replaced): nothing cached under it may be shown or kept.
   * Not for 'signed-out': that is the viewer's own session; the library itself is fine.
   */
  async invalidate() {
    const cache = await this.#getCache(), lib = this.#lib ?? await cache.last();
    await this.#stop();
    this.#lib = undefined; this.#reset(); this.#dropEarly();
    if (lib) await cache.purge(lib);
  }

  /**
   * The album list again after it failed (Trips' "Try again"). Only the list: the index is fine. Without a library
   * yet (the index failed too, or no manifest) it is a whole new run.
   */
  async retryAlbums() {
    const run = this.#run, lib = this.#lib;
    if (this.status === 'error' || !run || !lib) return this.load();
    // One retry at a time: a second tap waits for the first (and stopping the run waits for it).
    if (run.albums) return run.albums.then(() => {}, () => {});
    this.albumsError = null; this.albumsLoaded = false;
    const current = () => this.#run === run && !run.ac.signal.aborted;
    try {
      const p = this.#getCache().then(cache => fetchAlbums({cache, signal: run.ac.signal}, lib));
      run.albums = p;
      void p.finally(() => { if (run.albums === p) run.albums = undefined; }).catch(() => {});
      const a = await p;
      if (current()) { this.albums = a; this.albumsLoaded = true; }
    } catch (e) {
      if (!current()) return;
      console.warn('albums:', e);
      if (e instanceof ApiFailure && e.code === 'auth') this.albums = [];
      this.albumsError = e; this.albumsLoaded = true;
    }
  }

  abort() { void this.#stop(); }

  async clearCache() {
    await this.#stop();
    await (await this.#getCache()).clear();
    this.#lib = undefined; this.#reset(); this.#dropEarly();
    return this.load();
  }

  /**
   * The album's members as their own index: shared albums can hold assets the library index lacks.
   * A failure (also 'auth': the key may just lack album.read) is the caller's to show; the library stays.
   */
  async membersOf(albumId: string): Promise<LibraryIndex> {
    const album = this.albums.find(a => a.id === albumId), e = this.early;
    if (album && e?.albumId === albumId && e.ix && e.version === album.version) {
      // Prefetched (a landing): cached like a fetch through the usual path, once the library is known.
      const lib = this.#lib, raw = this.#earlyRaw;
      if (lib && raw) void this.#getCache().then(c => c.setMembers(lib, raw));
      return e.ix;
    }
    if (!album || !this.#lib) throw new Error('This album isn’t in the album list.');
    return albumMembers({cache: await this.#getCache(), signal: this.#run?.ac.signal}, this.#lib, album);
  }
}

export const library = new LibraryStore();
