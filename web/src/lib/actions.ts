// What a pick does to `selection` and the URL, for any shell: the overview's album bars, picker and buttons on
// the desktop, the demo landing, a phone's trip cards. The overview frames its timeline around an album pick
// (onAlbumPick); a shell without it gets the same selection, cursor and history entries.
import {albumSpan, selection, writeUrl, type Active, type Selection} from './selection.svelte.ts';

/** An album with its days (Immich's local calendar days, midnight read as UTC): a RailAlbum, a trip card. */
export interface AlbumDays { id: string; start: number; end: number }

/**
 * How to open an album from outside a click. `cursor`: the row of the album's members to put the cursor on
 * (default: the first). `history`: 'replace' keeps the opening out of the back/forward stack (a landing).
 */
export interface PickOptions { cursor?: (a: Active) => number; history?: 'commit' | 'replace' }

const pickListeners = new Set<(a: AlbumDays) => void>();
/** Runs `f` on every album pick, before the selection changes (the overview animates its view there). */
export function onAlbumPick(f: (a: AlbumDays) => void) {
  pickListeners.add(f);
  return () => { pickListeners.delete(f); };
}

/** Opens album `a` in members mode, the cursor on its first photo (or `opts.cursor`) once its members are in. */
export function pickAlbum(a: AlbumDays, opts?: PickOptions) {
  selection.resetZoom();
  for (const f of pickListeners) f(a);
  const [t0, t1] = albumSpan(a);
  const sel: Selection = {kind: 'album', albumId: a.id, mode: 'members', t0, t1};
  selection.cursor = null;
  // Start at the album's first photo, so the map opens with a position and a photo card.
  selection.select(sel).then(() => {
    const act = selection.active;
    if (selection.sel !== sel || !act || act.hi <= act.lo || selection.cursor != null) return;
    const r = opts?.cursor?.(act) ?? act.lo;
    selection.cursorTo(act.ix, r >= act.lo && r < act.hi ? r : act.lo);
    writeUrl('replace', selection.cursor);
  }).catch(e => console.warn('album members:', e));
  writeUrl(opts?.history ?? 'commit', null);
}

/** The selected album's members only, or everything in its dates. */
export function setMode(mode: 'members' | 'range') {
  const s = selection.sel;
  if (s?.kind !== 'album' || s.mode === mode) return;
  // The other mode of the same zoom level: the stack stays (Back returns to where the zoom came from).
  selection.select({...s, mode}).catch(e => console.warn('album members:', e));
  writeUrl('commit');
}

/** Nothing selected (Esc, ✕ clear, a double click on a timeline): a new history entry, the zoom stack forgotten. */
export function clearSelection() {
  selection.resetZoom();
  void selection.select(null);
  writeUrl('commit');
}

/** Back out of the last zoom (a cluster or pin zoom), with the cursor it came from. False when there is none. */
export function back() {
  if (!selection.back()) return false;
  writeUrl('commit', selection.cursor);
  return true;
}

