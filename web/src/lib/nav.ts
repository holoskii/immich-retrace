// Names for selections in navigation UI (Back button, breadcrumb).
import {library} from './index/store.svelte.ts';
import {albumLabel, fDay, railAlbums} from './overview/data.ts';
import {tripsOf} from './overview/trips.ts';
import type {Selection} from './selection.svelte.ts';

export const DAY = 86400e3;

/** "12 May 2023" or "12 May 2023 → 14 May 2023" (UTC days, like the range URL). */
export const fDays = (t0: number, t1: number) => {
  const a = fDay(t0), b = fDay(t1 - 1);
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
 * Name for a zoom into [t0, t1] from `sel`: "Album › place". The album is the selected one, or else the
 * shortest trip album covering the span; without one, just the place.
 */
export function zoomName(sel: Selection | null, t0: number, t1: number, place: string) {
  let a = sel?.kind === 'album' ? library.albums.find(x => x.id === sel.albumId) : undefined;
  if (!a) {
    let best = Infinity;
    for (const b of railAlbums(library.albums, tripsOf(library.albums, library.index).isTrip)) if (b.start <= t0 && b.end >= t1 && b.end - b.start < best) { a = b; best = b.end - b.start; }
  }
  const name = a ? albumLabel(a.name) : '';
  return name && place ? `${name} › ${place}` : name || place;
}

/** The UTC day around instant t (what a pin click selects without a selection; the brush and URL use UTC days too). */
export const dayAround = (t: number): [number, number] => { const d = Math.floor(t / DAY) * DAY; return [d, d + DAY]; };

const HOUR = 3600e3, MIN = 60e3;
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
