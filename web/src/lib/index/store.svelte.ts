import type {AlbumSummary, IndexManifest} from '../../../../shared/api.ts';
import {openKV} from './idb.ts';
import {withLookup, type LibraryIndex} from './model.ts';
import {albumMembers, ApiFailure, libraryCache, refreshIndex, type LibraryCache} from './refresh.ts';

/** cached: showing the last snapshot, manifest pending · building: no index yet · refreshing: snapshot shown, new one loading. */
export type Status = 'cached' | 'building' | 'refreshing' | 'ready' | 'error';

interface Run { ac: AbortController; refresh?: Promise<unknown> }

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
  #lib?: string;
  #cache?: Promise<LibraryCache>;
  #run?: Run;
  #open: () => Promise<LibraryCache>;

  constructor(open = () => openKV().then(libraryCache)) { this.#open = open; }

  #getCache() { return this.#cache ??= this.#open(); }

  // The one place to narrow what is shown (owner, shared library) once that is needed.
  #show(ix: LibraryIndex | null) { this.index = ix; }

  #reset() { this.#show(null); this.albums = []; this.provisional = null; }

  /** Aborts the current run and waits until its refresh can no longer write to the cache. */
  async #stop() {
    const r = this.#run;
    this.#run = undefined;
    r?.ac.abort();
    await r?.refresh?.catch(() => {});
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
          if (m.library !== this.#lib) { this.#reset(); this.#lib = m.library; }
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
    this.#lib = undefined; this.#reset();
    if (lib) await cache.purge(lib);
  }

  abort() { void this.#stop(); }

  async clearCache() {
    await this.#stop();
    await (await this.#getCache()).clear();
    this.#lib = undefined; this.#reset();
    return this.load();
  }

  /**
   * The album's members as their own index: shared albums can hold assets the library index lacks.
   * A failure (also 'auth': the key may just lack album.read) is the caller's to show; the library stays.
   */
  async membersOf(albumId: string): Promise<LibraryIndex> {
    const album = this.albums.find(a => a.id === albumId);
    if (!album || !this.#lib) throw new Error('This album isn’t in the album list.');
    return albumMembers({cache: await this.#getCache(), signal: this.#run?.ac.signal}, this.#lib, album);
  }
}

export const library = new LibraryStore();
