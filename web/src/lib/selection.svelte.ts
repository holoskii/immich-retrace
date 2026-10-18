// What is selected and where the time cursor is: the contract between the overview (stage 3,
// writes the selection, owns URL sync) and the map + scrubber (stage 4, reads it, writes the cursor).
import {sliceIndex, type IndexColumns, type LibraryIndex} from './index/model.ts';
import {library} from './index/store.svelte.ts';
import {nearParam, parseNear, placeRows, type Circle} from './place.ts';

/**
 * Times are UTC instants (epoch ms); `t1` is exclusive. Whole-day selections (brush, URL days, albums, a pin's day)
 * span local calendar days, converted with `fromLocal`.
 */
export type Selection =
  | {kind: 'range'; t0: number; t1: number}
  /**
   * members: the album's own assets (may include ones outside the library index); range: everything in its date span.
   * `sub`: t0/t1 were narrowed inside the album (a map cluster zoom); members are clipped to them then.
   */
  | {kind: 'album'; albumId: string; mode: 'members' | 'range'; t0: number; t1: number; sub?: true}
  /**
   * The library's photos in [t0, t1) taken within `r` metres of lat/lon (a map cluster's "only photos here"): a subset,
   * not a span, so `active` is an index of just those rows (`placeIndex`), like album members.
   */
  | ({kind: 'place'; t0: number; t1: number} & Circle);

/** A selection to return to (zoom stack): what was selected (null: nothing, the whole library), the cursor, its name for Back. */
export interface Crumb { sel: Selection | null; cursor: number | null; cursorId: string | null; label: string }

export const sameSelection = (a: Selection | null, b: Selection | null) => {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind || a.t0 !== b.t0 || a.t1 !== b.t1) return false;
  if (a.kind === 'album') return b.kind === 'album' && a.albumId === b.albumId && a.mode === b.mode && !!a.sub === !!b.sub;
  if (a.kind === 'place') return b.kind === 'place' && a.lat === b.lat && a.lon === b.lon && a.r === b.r;
  return true;
};

/** Place indexes per library index (a refreshed library is a new object: its places are built again). */
const places = new WeakMap<LibraryIndex, Map<string, LibraryIndex>>();
const PLACES_KEPT = 8;
/**
 * The rows of a place selection as their own index, sorted by t. Cached by the selection's value, so Back/Forward
 * onto it (a new object from the URL) reuses the slice; `rows`: the same rows, already filtered (the map's menu).
 */
export function placeIndex(s: Extract<Selection, {kind: 'place'}>, lib: LibraryIndex, rows?: ArrayLike<number>): LibraryIndex {
  let m = places.get(lib);
  if (!m) places.set(lib, m = new Map());
  const key = `${nearParam(s)}|${s.t0}|${s.t1}`;
  let ix = m.get(key);
  if (ix) { m.delete(key); m.set(key, ix); return ix; }
  ix = sliceIndex(lib, rows ?? placeRows(lib, s, s.t0, s.t1));
  m.set(key, ix);
  if (m.size > PLACES_KEPT) m.delete(m.keys().next().value!);
  return ix;
}

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
  /**
   * The asset the cursor was put on (a pin, a step, the lightbox): which of several assets taken at the cursor's
   * exact instant is on show. Ignored at any other cursor time, so a scrub needn't clear it (route.ts cursorRow).
   */
  cursorId = $state<string | null>(null);
  /**
   * The period visible in the overview timeline, once it stops moving (UTC instants, converted from the local axis).
   * Without a selection the map shows only the library's photos from it.
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
      if (s.sub) return {ix: m.ix, lo: lowerBound(m.ix.t, s.t0), hi: lowerBound(m.ix.t, s.t1), t0: s.t0, t1: s.t1};
      // The album's days were converted with the library's offsets; a member shot in another zone can fall just outside.
      const n = m.ix.n;
      return {ix: m.ix, lo: 0, hi: n, t0: n ? Math.min(s.t0, m.ix.t[0]) : s.t0, t1: n ? Math.max(s.t1, m.ix.t[n - 1] + 1) : s.t1};
    }
    if (!lib) return null;
    if (s.kind === 'place') { const ix = placeIndex(s, lib); return {ix, lo: 0, hi: ix.n, t0: s.t0, t1: s.t1}; }
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

  /** Puts the cursor on row `r` of `ix`. */
  cursorTo(ix: LibraryIndex, r: number) {
    this.cursor = ix.t[r];
    this.cursorId = ix.id[r];
  }

  /** The row of `a.ix` the cursor id names, if any (route.ts cursorRow's `pick`). */
  pickIn(a: Active) {
    return this.cursorId == null ? undefined : a.ix.idToRow.get(this.cursorId);
  }

  /** Narrows to `sel` remembering the current selection and cursor; `label` names the new level. */
  zoomInto(sel: Selection, label: string, cursor: number | null) {
    this.stack = [...this.stack, {sel: this.sel, cursor: this.cursor, cursorId: this.cursorId, label: this.zoomLabel ?? ''}];
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
    this.cursorId = top.cursorId;
    return true;
  }

  /** Forgets the zoom stack (a fresh pick: album list, clear). */
  resetZoom() { this.stack = []; this.zoomLabel = null; }
}

export const selection = new SelectionStore();

/** Local offset (hours) of the row of `ix` nearest to instant t; 0 without rows. */
export function offsetIn(ix: IndexColumns | null, t: number | null) {
  if (t == null || !ix?.n) return 0;
  const i = lowerBound(ix.t, t), j = i > 0 && (i === ix.n || t - ix.t[i - 1] < ix.t[i] - t) ? i - 1 : i;
  return ix.off[j];
}

/** Local offset (hours) of the library asset nearest to t; 0 without an index. */
export const offsetNear = (t: number | null) => offsetIn(library.index, t);

const HOUR = 3600e3, DAY = 86400e3;
/**
 * The overview, its labels and the URL's days speak local calendar days, as the wave bins by them and the map and
 * lightbox show local times; selections hold UTC instants. `toLocal`: instant → local wall time read as UTC (the
 * overview axis), with the offset of the nearest library photo. `fromLocal` is its inverse (the offset looked up
 * at the instant it lands on). Without an index both are the identity.
 */
export const toLocal = (t: number, ix: IndexColumns | null = library.index) => t + offsetIn(ix, t) * HOUR;
export const fromLocal = (l: number, ix: IndexColumns | null = library.index) => l - offsetIn(ix, l - offsetIn(ix, l) * HOUR) * HOUR;

/**
 * An album's span as instants. Immich's album startDate/endDate are local calendar days (max/min of
 * `localDateTime::date`, midnight read as UTC; server/src/repositories/album.repository.ts `getMetadataForIds`),
 * so the span runs to the end of the last day.
 */
export const albumSpan = (a: {start: number; end: number}, ix: IndexColumns | null = library.index): [number, number] =>
  [fromLocal(a.start, ix), fromLocal(a.end + DAY, ix)];

// URL format (stage 3 owns writing it via writeUrl(): replaceState while dragging, pushState on release):
//   ?from=2026-08-01&to=2026-08-30        range, local calendar days (`fromLocal`), `to` inclusive
//   ?album=<uuid>[&mode=range]            album, members by default
//   from/to may also be 2026-08-01T14:00Z (UTC to the minute, `to` exclusive): a map cluster zoom
//   ?album=<uuid>&from=…&to=…             album narrowed to that span (map cluster zoom)
//   ?near=<lat>,<lon>,<m>&from=…&to=…     place: library photos within <m> metres in that span (a cluster's "only photos here")
//   &at=<epoch ms>                        cursor (optional)
//   &lb=<asset id>                        open lightbox (optional; written from selection.lightboxId by every writeUrl)
const day = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(s + 'T00:00:00Z') : NaN);
const HOUR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/;
const hour = (s: string | null) => (s && HOUR_RE.test(s) ? Date.parse(s) : NaN);
/** from/to: whole local days (`to` inclusive), or UTC instants to the minute (`to` exclusive), as a cluster zoom writes them. */
function span(q: URLSearchParams, ix: IndexColumns | null): [number, number] | null {
  const f = q.get('from'), t = q.get('to');
  const t0 = HOUR_RE.test(f ?? '') ? hour(f) : fromLocal(day(f), ix), t1 = HOUR_RE.test(t ?? '') ? hour(t) : fromLocal(day(t) + DAY, ix);
  return Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0 ? [t0, t1] : null;
}

/**
 * Reads a selection from the URL. Album t0/t1 come from the album list, so albums resolve once it is loaded.
 * `ix`: the library, for local days (the index is in before the URL is applied, `urlReady`).
 */
export function selectionFromUrl(q: URLSearchParams, albums: {id: string; start: number | null; end: number | null}[], ix: IndexColumns | null = library.index): Selection | null {
  const album = q.get('album');
  if (album) {
    const a = albums.find(x => x.id === album);
    if (!a || a.start == null || a.end == null) return null;
    const mode = q.get('mode') === 'range' ? 'range' : 'members';
    const sp = span(q, ix);
    if (sp) return {kind: 'album', albumId: a.id, mode, t0: sp[0], t1: sp[1], sub: true};
    const [t0, t1] = albumSpan({start: a.start, end: a.end}, ix);
    return {kind: 'album', albumId: a.id, mode, t0, t1};
  }
  const sp = span(q, ix);
  if (!sp) return null;
  const near = parseNear(q.get('near'));
  return near ? {kind: 'place', ...near, t0: sp[0], t1: sp[1]} : {kind: 'range', t0: sp[0], t1: sp[1]};
}

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const isoMin = (t: number) => new Date(t).toISOString().slice(0, 16) + 'Z';
const URL_KEYS = ['from', 'to', 'album', 'mode', 'near', 'at', 'lb'];

/**
 * `base` with the selection keys replaced. `at` is written only when it lies inside the selection.
 * Range days are local (`toLocal`): t0 → its day, exclusive t1 → the day before.
 */
export function selectionToQuery(sel: Selection | null, at: number | null, base = new URLSearchParams(), ix: IndexColumns | null = library.index): URLSearchParams {
  const q = new URLSearchParams(base);
  for (const k of URL_KEYS) q.delete(k);
  if (!sel) return q;
  if (sel.kind === 'album') { q.set('album', sel.albumId); if (sel.mode === 'range') q.set('mode', 'range'); }
  if (sel.kind === 'place') q.set('near', nearParam(sel));
  if (sel.kind !== 'album' || sel.sub) {
    // Whole local days stay readable; anything finer (a cluster zoom) is written to the minute, in UTC. Days only
    // when they read back to the same instants (not always so on a day the offset changes).
    const l0 = toLocal(sel.t0, ix), l1 = toLocal(sel.t1, ix);
    if (l0 % DAY === 0 && l1 % DAY === 0 && fromLocal(l0, ix) === sel.t0 && fromLocal(l1, ix) === sel.t1) { q.set('from', isoDay(l0)); q.set('to', isoDay(l1 - 1)); }
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
 * `lb` always follows `selection.lightboxId`. `state`: the new entry's history.state on a commit that pushes.
 */
export function writeUrl(how: 'live' | 'commit' | 'replace', at?: number | null, state: unknown = null) {
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
  history.pushState(state, '', href);
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
