// What is selected and where the time cursor is: the contract between the overview (stage 3,
// writes the selection, owns URL sync) and the map + scrubber (stage 4, reads it, writes the cursor).
import type {LibraryIndex} from './index/model.ts';
import {library} from './index/store.svelte.ts';

/** Times are UTC instants (epoch ms); `t1` is exclusive. */
export type Selection =
  | {kind: 'range'; t0: number; t1: number}
  /**
   * members: the album's own assets (may include ones outside the library index); range: everything in its date span.
   * `sub`: t0/t1 were narrowed inside the album (a map cluster zoom); members are clipped to them then.
   */
  | {kind: 'album'; albumId: string; mode: 'members' | 'range'; t0: number; t1: number; sub?: true};

/** A selection to return to (zoom stack): what was selected (null: nothing, the whole library), the cursor, its name for Back. */
export interface Crumb { sel: Selection | null; cursor: number | null; label: string }

export const sameSelection = (a: Selection | null, b: Selection | null) =>
  a === b || (!!a && !!b && a.kind === b.kind && a.t0 === b.t0 && a.t1 === b.t1
    && (a.kind === 'range' || (b.kind === 'album' && a.albumId === b.albumId && a.mode === b.mode && !!a.sub === !!b.sub)));

/** The selected assets: rows lo..hi-1 of `ix`, which is sorted by t. */
export interface Active { ix: LibraryIndex; lo: number; hi: number; t0: number; t1: number }

/**
 * An album to open from outside the overview. `cursor`: the row of the album's members to put the cursor on
 * (default: the first). `history`: 'replace' keeps the opening out of the back/forward stack (a landing).
 */
export interface AlbumRequest { albumId: string; cursor?: (a: Active) => number; history?: 'commit' | 'replace' }

/** First row with t >= x. */
export function lowerBound(t: Float64Array, x: number, lo = 0, hi = t.length) {
  while (lo < hi) { const m = (lo + hi) >>> 1; if (t[m] < x) lo = m + 1; else hi = m; }
  return lo;
}

class SelectionStore {
  sel = $state.raw<Selection | null>(null);
  /** Shared time cursor: overview hover, map scrubber, lightbox. null = none. */
  cursor = $state<number | null>(null);
  /**
   * The period visible in the overview timeline, once it stops moving. Without a selection the map shows
   * only the library's photos from it. (The overview axis is local wall time; close enough here.)
   */
  timeline = $state.raw<[number, number] | null>(null);
  /** Zoom stack: selections a cluster zoom came from, innermost last. `label` names the zoomed-in level. */
  stack = $state.raw<Crumb[]>([]);
  /** Name of the current zoomed-in level (top of the stack), e.g. a city. */
  zoomLabel = $state<string | null>(null);
  /** Album member index, loaded when an album is selected in members mode. */
  members = $state.raw<{albumId: string; version: string; ix: LibraryIndex} | null>(null);
  /** The members of the selected album (members mode) being fetched, or why they couldn't be. */
  membersLoad = $state.raw<{albumId: string; error: unknown} | null>(null);

  /** startUrlSync has applied the page's URL (a landing that opens something must not race it). */
  urlApplied = $state(false);
  /** Something has been selected since the page loaded, even if cleared again (a landing must not override that). */
  touched = $state(false);
  /**
   * Asks the overview to open an album as a click on its bar would (the timeline frames it too). The overview
   * takes the request and clears it.
   */
  albumRequest = $state.raw<AlbumRequest | null>(null);

  /** Open lightbox: a row of `active.ix` (←/→ walks active.lo..hi-1). Stage 5 owns the UI; the map card opens it. */
  lightbox = $state<number | null>(null);

  /** The open lightbox's asset id; null when closed or when the row is outside the active range. */
  lightboxId = $derived.by(() => {
    const a = this.active, r = this.lightbox;
    return a && r != null && r >= a.lo && r < a.hi ? a.ix.id[r] : null;
  });

  active = $derived.by((): Active | null => {
    const s = this.sel, lib = library.index;
    if (!s) return null;
    if (s.kind === 'album' && s.mode === 'members') {
      const m = this.members;
      if (!m || m.albumId !== s.albumId) return null;
      return s.sub ? {ix: m.ix, lo: lowerBound(m.ix.t, s.t0), hi: lowerBound(m.ix.t, s.t1), t0: s.t0, t1: s.t1} : {ix: m.ix, lo: 0, hi: m.ix.n, t0: s.t0, t1: s.t1};
    }
    if (!lib) return null;
    return {ix: lib, lo: lowerBound(lib.t, s.t0), hi: lowerBound(lib.t, s.t1), t0: s.t0, t1: s.t1};
  });

  /** Rejects when an album's members can't be loaded; `membersLoad` keeps the error for the UI either way. */
  async select(s: Selection | null) {
    this.sel = s;
    if (s) this.touched = true;
    this.membersLoad = null;
    if (s?.kind !== 'album' || s.mode !== 'members') return;
    // Keyed by version too: an album edited in Immich must not keep its old member list.
    const version = library.albums.find(a => a.id === s.albumId)?.version ?? '';
    if (this.members?.albumId === s.albumId && this.members.version === version) return;
    this.membersLoad = {albumId: s.albumId, error: null};
    try {
      const ix = await library.membersOf(s.albumId);
      if (this.sel === s) { this.members = {albumId: s.albumId, version, ix}; this.membersLoad = null; }
    } catch (e) {
      if (this.sel === s) this.membersLoad = {albumId: s.albumId, error: e};
      throw e;
    }
  }

  /** Loads the selected album's members again after a failure. */
  retryMembers() {
    const s = this.sel;
    if (s) this.select(s).catch(e => console.warn('album members:', e));
  }

  /** Narrows to `sel` remembering the current selection and cursor; `label` names the new level. */
  zoomInto(sel: Selection, label: string, cursor: number | null) {
    this.stack = [...this.stack, {sel: this.sel, cursor: this.cursor, label: this.zoomLabel ?? ''}];
    this.zoomLabel = label;
    this.select(sel).catch(e => console.warn('album members:', e));
    this.cursor = cursor;
  }

  /** Back to the selection the last zoom came from (and its cursor). False when there is none. */
  back() {
    const top = this.stack.at(-1);
    if (!top) return false;
    this.stack = this.stack.slice(0, -1);
    this.zoomLabel = top.label || null;
    this.select(top.sel).catch(e => console.warn('album members:', e));
    this.cursor = top.cursor;
    return true;
  }

  /** Forgets the zoom stack (a fresh pick: album list, clear). */
  resetZoom() { this.stack = []; this.zoomLabel = null; }
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
//   from/to may also be 2026-08-01T14:00Z (UTC to the minute, `to` exclusive): a map cluster zoom
//   ?album=<uuid>&from=…&to=…             album narrowed to that span (map cluster zoom)
//   &at=<epoch ms>                        cursor (optional)
//   &lb=<asset id>                        open lightbox (optional; written from selection.lightboxId by every writeUrl)
const DAY = 86400e3;
const day = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(s + 'T00:00:00Z') : NaN);
const HOUR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/;
const hour = (s: string | null) => (s && HOUR_RE.test(s) ? Date.parse(s) : NaN);
/** from/to: whole days (`to` inclusive), or UTC instants to the minute (`to` exclusive), as a cluster zoom writes them. */
function span(q: URLSearchParams): [number, number] | null {
  const f = q.get('from'), t = q.get('to');
  const t0 = HOUR_RE.test(f ?? '') ? hour(f) : day(f), t1 = HOUR_RE.test(t ?? '') ? hour(t) : day(t) + DAY;
  return Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0 ? [t0, t1] : null;
}

/** Reads a selection from the URL. Album t0/t1 come from the album list, so albums resolve once it is loaded. */
export function selectionFromUrl(q: URLSearchParams, albums: {id: string; start: number | null; end: number | null}[]): Selection | null {
  const album = q.get('album');
  if (album) {
    const a = albums.find(x => x.id === album);
    if (!a || a.start == null || a.end == null) return null;
    const mode = q.get('mode') === 'range' ? 'range' : 'members';
    const sp = span(q);
    if (sp) return {kind: 'album', albumId: a.id, mode, t0: sp[0], t1: sp[1], sub: true};
    return {kind: 'album', albumId: a.id, mode, t0: a.start, t1: a.end + 1};
  }
  const sp = span(q);
  return sp ? {kind: 'range', t0: sp[0], t1: sp[1]} : null;
}

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const isoMin = (t: number) => new Date(t).toISOString().slice(0, 16) + 'Z';
const URL_KEYS = ['from', 'to', 'album', 'mode', 'at', 'lb'];

/**
 * `base` with the selection keys replaced. `at` is written only when it lies inside the selection.
 * Range days are UTC: t0 → its day, exclusive t1 → the day of t1 - 1 ms.
 */
export function selectionToQuery(sel: Selection | null, at: number | null, base = new URLSearchParams()): URLSearchParams {
  const q = new URLSearchParams(base);
  for (const k of URL_KEYS) q.delete(k);
  if (!sel) return q;
  if (sel.kind === 'album') { q.set('album', sel.albumId); if (sel.mode === 'range') q.set('mode', 'range'); }
  if (sel.kind === 'range' || sel.sub) {
    // Whole days stay readable; anything finer (a cluster zoom) is written to the minute.
    if (sel.t0 % DAY === 0 && sel.t1 % DAY === 0) { q.set('from', isoDay(sel.t0)); q.set('to', isoDay(sel.t1 - 1)); }
    else { q.set('from', isoMin(sel.t0)); q.set('to', isoMin(sel.t1)); }
  }
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
 * - 'replace': replaceState of the current entry, outside any gesture (lightbox stepping and closing).
 * `at`: undefined keeps the URL's current `at` (the overview never writes hover positions); a number or null sets/clears it.
 * `lb` always follows `selection.lightboxId`.
 */
export function writeUrl(how: 'live' | 'commit' | 'replace', at?: number | null) {
  const cur = new URLSearchParams(location.search);
  const keep = cur.has('at') ? Number(cur.get('at')) : null;
  const sq = selectionToQuery(selection.sel, at === undefined ? keep : at, cur);
  const lb = selection.sel ? selection.lightboxId : null;
  if (lb) sq.set('lb', lb);
  const q = sq.toString();
  const href = location.pathname + (q ? '?' + q : '') + location.hash;
  if (how === 'replace') { history.replaceState(history.state, '', href); return; }
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

/** `lb` from the URL waiting for `active` (album members load async). While set, the lightbox must not write the URL. */
let pendingLb = $state<string | null>(null);
export const lightboxPending = () => pendingLb != null;

/** The row of asset `id` if it lies in the active range, else null. */
export function rowInActive(a: Active, id: string) {
  const r = a.ix.idToRow.get(id);
  return r != null && r >= a.lo && r < a.hi ? r : null;
}

/** Applies the current URL: selection, then cursor (`at`, or none), then the lightbox (`lb`) once `active` is ready. */
export function applyUrl(albums: {id: string; start: number | null; end: number | null}[]) {
  gesture = null;
  const q = new URLSearchParams(location.search), at = Number(q.get('at')), lb = q.get('lb');
  const sel = selectionFromUrl(q, albums);
  // Back/forward onto the selection a zoom came from pops it; onto anything else unrelated forgets the stack.
  const top = selection.stack.at(-1);
  if (top && sameSelection(top.sel, sel)) { selection.stack = selection.stack.slice(0, -1); selection.zoomLabel = top.label || null; }
  else if (!sameSelection(selection.sel, sel)) selection.resetZoom();
  selection.select(sel).catch(e => console.warn('album members:', e));
  selection.cursor = q.has('at') && Number.isFinite(at) ? at : null;
  if (lb !== selection.lightboxId) selection.lightbox = null;
  // Without a selection (none in the URL, or an album that isn't there) `lb` has nothing to open in.
  pendingLb = sel ? lb : null;
}

/**
 * Whether the URL can be applied: the index is in, and an `album` in it is either in the list or
 * the list has finished loading (or failing) — with no albums at all it resolves to no selection.
 */
export function urlReady(q: URLSearchParams, hasIndex: boolean, albums: {id: string}[], albumsLoaded: boolean) {
  if (!hasIndex) return false;
  const album = q.get('album');
  return !album || albumsLoaded || albums.some(a => a.id === album);
}

/**
 * Applies the URL once the index (and, for an album, the album list) is loaded, then follows back/forward.
 * Call once at startup; returns a disposer.
 */
export function startUrlSync() {
  const onPop = () => applyUrl(library.albums);
  addEventListener('popstate', onPop);
  let applied = false;
  pendingLb = new URLSearchParams(location.search).get('lb');
  const stop = $effect.root(() => {
    $effect(() => {
      const id = pendingLb, a = selection.active;
      if (id == null || !a || !applied) return;
      selection.lightbox = rowInActive(a, id);
      pendingLb = null;
    });
    $effect(() => {
      if (applied || !urlReady(new URLSearchParams(location.search), !!library.index, library.albums, library.albumsLoaded)) return;
      applied = true;
      applyUrl(library.albums);
      selection.urlApplied = true;
    });
  });
  return () => { removeEventListener('popstate', onPop); stop(); };
}
