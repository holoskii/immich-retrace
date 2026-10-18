// Names for selections in navigation UI (Back button, breadcrumb).
import {library} from './index/store.svelte.ts';
import {albumLabel, fDay, railAlbums} from './albums.ts';
import {tripsOf} from './trips.ts';
import {fromLocal, toLocal, type Selection} from './selection.svelte.ts';

export const DAY = 86400e3;
const HOUR = 3600e3, MIN = 60e3;

/** "12 May 2023" or "12 May 2023 → 14 May 2023" for instants [t0, t1): local days, like the overview and the range URL. */
export const fDays = (t0: number, t1: number) => {
  const a = fDay(toLocal(t0)), b = fDay(toLocal(t1 - 1));
  return a === b ? a : `${a} → ${b}`;
};

/** A selection's display name: the zoom label if it has one, else the album name, else its days. */
export function selName(sel: Selection | null, label?: string | null) {
  if (label) return label;
  if (!sel) return 'all photos';
  if (sel.kind === 'album') {
    const a = library.albums.find(x => x.id === sel.albumId);
    if (a) return albumLabel(a.name);
  }
  return fDays(sel.t0, sel.t1);
}

/**
 * Name for a zoom into instants [t0, t1] from `sel`: "Album › place". The album is the selected one, or else the
 * shortest trip album whose days cover the span; without one, just the place.
 */
export function zoomName(sel: Selection | null, t0: number, t1: number, place: string) {
  let a = sel?.kind === 'album' ? library.albums.find(x => x.id === sel.albumId) : undefined;
  if (!a) {
    // Album dates are local calendar days (midnight read as UTC): compare in local time, through the end of the last day.
    const l0 = toLocal(t0), l1 = toLocal(t1);
    let best = Infinity;
    for (const b of railAlbums(library.albums, tripsOf(library.albums, library.index).isTrip)) if (b.start <= l0 && b.end + DAY > l1 && b.end - b.start < best) { a = b; best = b.end - b.start; }
  }
  const name = a ? albumLabel(a.name) : '';
  return name && place ? `${name} › ${place}` : name || place;
}

/**
 * The local calendar day around instant t, for a photo with offset `off` hours, as instants (what a pin click selects
 * without a selection; the brush and URL use local days too).
 */
export const dayAround = (t: number, off = 0): [number, number] => {
  const d = Math.floor((t + off * HOUR) / DAY) * DAY;
  // The nearest photo's offset may differ on a day the offset changes: the photo itself always stays inside, with
  // whole minutes so the span survives the URL's minute format.
  return [Math.min(Math.floor(t / MIN) * MIN, fromLocal(d)), Math.max(Math.floor(t / MIN) * MIN + MIN, fromLocal(d + DAY))];
};

/** Whole UTC hours around [t0, t1] (inclusive instants): a cluster zoom's span. Days would pull in travel days. */
export const hourCover = (t0: number, t1: number): [number, number] => [Math.floor(t0 / HOUR) * HOUR, (Math.floor(t1 / HOUR) + 1) * HOUR];

/**
 * A cluster zoom's span: hourCover clamped to the parent span `within` (widened to whole minutes, so the
 * result still round-trips through the URL's minute format). The rounding never reaches outside the parent.
 */
export function zoomSpan(t0: number, t1: number, within: [number, number] | null): [number, number] {
  const [a, b] = hourCover(t0, t1);
  return within ? [Math.max(a, Math.floor(within[0] / MIN) * MIN), Math.min(b, Math.ceil(within[1] / MIN) * MIN)] : [a, b];
}
