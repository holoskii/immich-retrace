import type {AlbumSummary, IndexManifest} from '../../../../shared/api.ts';
import {openKV} from './idb.ts';
import {withLookup, type LibraryIndex} from './model.ts';
import {albumMembers, ApiFailure, libraryCache, refreshIndex, type LibraryCache} from './refresh.ts';

/** cached: showing the last snapshot, manifest pending · building: no index yet · refreshing: snapshot shown, new one loading. */
export type Status = 'cached' | 'building' | 'refreshing' | 'ready' | 'error';

interface Run { ac: AbortController; refresh?: Promise<unknown> }

export class LibraryStore {
  status = $state<Status>('building');
  // Raw: deep proxies over 30k-element columns would cost far more than they give.
  index = $state.raw<LibraryIndex | null>(null);
  /** Manifest months while a first index builds, for a provisional overview. */
  provisional = $state.raw<IndexManifest['months'] | null>(null);
  progress = $state.raw({done: 0, total: 0});
  albums = $state.raw<AlbumSummary[]>([]);
  error = $state<string | null>(null);
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
    this.status = 'error'; this.error = e instanceof Error ? e.message : String(e);
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
      this.error = null; this.progress = {done: 0, total: 0};
      if (snap) { this.#lib = lib; this.#show(withLookup(snap.cols)); this.albums = albums ?? []; this.status = 'cached'; }
      else { this.#reset(); this.status = 'building'; }
      const refresh = run.refresh = refreshIndex({cache, signal}, {
        onManifest: m => {
          if (!current()) return;
          if (m.library !== this.#lib) { this.#reset(); this.#lib = m.library; }
          if (!this.index) this.provisional = m.months;
          this.status = this.index ? 'refreshing' : 'building';
        },
        onProgress: (done, total) => { if (current()) this.progress = {done, total}; },
        onAlbums: a => { if (current()) this.albums = a; },
      });
      const r = await refresh;
      if (!current()) return;
      this.#show(r.index); this.albums = r.albums; this.provisional = null; this.status = 'ready';
    } catch (e) {
      if (!current()) return;
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

  /** The album's members as their own index: shared albums can hold assets the library index lacks. */
  async membersOf(albumId: string): Promise<LibraryIndex> {
    const album = this.albums.find(a => a.id === albumId);
    if (!album || !this.#lib) throw new Error(`Unknown album ${albumId}`);
    try {
      return await albumMembers({cache: await this.#getCache(), signal: this.#run?.ac.signal}, this.#lib, album);
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'auth') { await this.invalidate(); this.#fail(e); }
      throw e;
    }
  }
}

export const library = new LibraryStore();
