// What is selected and where the time cursor is: the contract between the overview (stage 3,
// writes the selection, owns URL sync) and the map + scrubber (stage 4, reads it, writes the cursor).
import type {LibraryIndex} from './index/model.ts';
import {library} from './index/store.svelte.ts';

/** Times are UTC instants (epoch ms); `t1` is exclusive. */
export type Selection =
  | {kind: 'range'; t0: number; t1: number}
  /** members: the album's own assets (may include ones outside the library index); range: everything in its date span. */
  | {kind: 'album'; albumId: string; mode: 'members' | 'range'; t0: number; t1: number};

/** The selected assets: rows lo..hi-1 of `ix`, which is sorted by t. */
export interface Active { ix: LibraryIndex; lo: number; hi: number; t0: number; t1: number }

/** First row with t >= x. */
export function lowerBound(t: Float64Array, x: number, lo = 0, hi = t.length) {
  while (lo < hi) { const m = (lo + hi) >>> 1; if (t[m] < x) lo = m + 1; else hi = m; }
  return lo;
}

class SelectionStore {
  sel = $state.raw<Selection | null>(null);
  /** Shared time cursor: overview hover, map scrubber, lightbox. null = none. */
  cursor = $state<number | null>(null);
  /** Album member index, loaded when an album is selected in members mode. */
  members = $state.raw<{albumId: string; version: string; ix: LibraryIndex} | null>(null);

  active = $derived.by((): Active | null => {
    const s = this.sel, lib = library.index;
    if (!s) return null;
    if (s.kind === 'album' && s.mode === 'members') {
      const m = this.members;
      return m && m.albumId === s.albumId ? {ix: m.ix, lo: 0, hi: m.ix.n, t0: s.t0, t1: s.t1} : null;
    }
    if (!lib) return null;
    return {ix: lib, lo: lowerBound(lib.t, s.t0), hi: lowerBound(lib.t, s.t1), t0: s.t0, t1: s.t1};
  });

  async select(s: Selection | null) {
    this.sel = s;
    if (s?.kind !== 'album' || s.mode !== 'members') return;
    // Keyed by version too: an album edited in Immich must not keep its old member list.
    const version = library.albums.find(a => a.id === s.albumId)?.version ?? '';
    if (this.members?.albumId === s.albumId && this.members.version === version) return;
    const ix = await library.membersOf(s.albumId);
    if (this.sel === s) this.members = {albumId: s.albumId, version, ix};
  }
}

export const selection = new SelectionStore();

/** Local offset (hours) of the library asset nearest to t; 0 without an index. */
export function offsetNear(t: number | null) {
  const ix = library.index;
  if (t == null || !ix?.n) return 0;
  const i = lowerBound(ix.t, t), j = i > 0 && (i === ix.n || t - ix.t[i - 1] < ix.t[i] - t) ? i - 1 : i;
  return ix.off[j];
}

// URL format (stage 3 owns writing it via writeUrl(): replaceState while dragging, pushState on release):
//   ?from=2026-08-01&to=2026-08-30        range, UTC calendar days, `to` inclusive
//   ?album=<uuid>[&mode=range]            album, members by default
//   &at=<epoch ms>                        cursor (optional)
const DAY = 86400e3;
const day = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(s + 'T00:00:00Z') : NaN);

/** Reads a selection from the URL. Album t0/t1 come from the album list, so albums resolve once it is loaded. */
export function selectionFromUrl(q: URLSearchParams, albums: {id: string; start: number | null; end: number | null}[]): Selection | null {
  const album = q.get('album');
  if (album) {
    const a = albums.find(x => x.id === album);
    if (!a || a.start == null || a.end == null) return null;
    return {kind: 'album', albumId: a.id, mode: q.get('mode') === 'range' ? 'range' : 'members', t0: a.start, t1: a.end + 1};
  }
  const t0 = day(q.get('from')), t1 = day(q.get('to')) + DAY;
  return Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0 ? {kind: 'range', t0, t1} : null;
}

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const URL_KEYS = ['from', 'to', 'album', 'mode', 'at'];

/**
 * `base` with the selection keys replaced. `at` is written only when it lies inside the selection.
 * Range days are UTC: t0 → its day, exclusive t1 → the day of t1 - 1 ms.
 */
export function selectionToQuery(sel: Selection | null, at: number | null, base = new URLSearchParams()): URLSearchParams {
  const q = new URLSearchParams(base);
  for (const k of URL_KEYS) q.delete(k);
  if (!sel) return q;
  if (sel.kind === 'album') { q.set('album', sel.albumId); if (sel.mode === 'range') q.set('mode', 'range'); }
  else { q.set('from', isoDay(sel.t0)); q.set('to', isoDay(sel.t1 - 1)); }
  if (at != null && Number.isFinite(at) && at >= sel.t0 && at < sel.t1) q.set('at', String(Math.round(at)));
  return q;
}

/** Start of an uncommitted gesture (drag, held key): the history entry to restore before pushing the result. */
let gesture: {href: string; state: unknown} | null = null;
/** Live writes are throttled: Safari throws after ~100 history calls per 30 s. The commit always writes. */
let lastLive = 0;
const LIVE_MS = 250;

/**
 * Writes `selection.sel` to the URL.
 * - 'live' (while dragging/scrubbing): replaceState; the first live write of a gesture remembers the entry it started from.
 * - 'commit' (release, scrub end, click): one pushState for the whole gesture, nothing if the URL ended where it started.
 * `at`: undefined keeps the URL's current `at` (the overview never writes hover positions); a number or null sets/clears it.
 */
export function writeUrl(how: 'live' | 'commit', at?: number | null) {
  const cur = new URLSearchParams(location.search);
  const keep = cur.has('at') ? Number(cur.get('at')) : null;
  const q = selectionToQuery(selection.sel, at === undefined ? keep : at, cur).toString();
  const href = location.pathname + (q ? '?' + q : '') + location.hash;
  if (how === 'live') {
    const now = Date.now();
    if (gesture && now - lastLive < LIVE_MS) return;
    gesture ??= {href: location.href, state: history.state};
    lastLive = now;
    history.replaceState(history.state, '', href);
    return;
  }
  const start = gesture ?? {href: location.href, state: history.state};
  gesture = null;
  if (new URL(href, location.href).href === start.href) { history.replaceState(start.state, '', href); return; }
  history.replaceState(start.state, '', start.href);
  history.pushState(null, '', href);
}

/** Applies the current URL: selection, then cursor (`at`, or none). */
export function applyUrl(albums: {id: string; start: number | null; end: number | null}[]) {
  gesture = null;
  const q = new URLSearchParams(location.search), at = Number(q.get('at'));
  selection.select(selectionFromUrl(q, albums)).catch(e => console.warn('album members:', e));
  selection.cursor = q.has('at') && Number.isFinite(at) ? at : null;
}

/**
 * Applies the URL once the index (and, for an album, the album list) is loaded, then follows back/forward.
 * Call once at startup; returns a disposer.
 */
export function startUrlSync() {
  const onPop = () => applyUrl(library.albums);
  addEventListener('popstate', onPop);
  let applied = false;
  const stop = $effect.root(() => {
    $effect(() => {
      if (applied || !library.index) return;
      if (new URLSearchParams(location.search).has('album') && !library.albums.length) return;
      applied = true;
      applyUrl(library.albums);
    });
  });
  return () => { removeEventListener('popstate', onPop); stop(); };
}
