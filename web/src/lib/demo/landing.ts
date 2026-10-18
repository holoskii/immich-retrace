// Demo landing (pure): which trip a visit without a link opens, and which photo the cursor starts on.
import type {RailAlbum} from '../albums.ts';
import type {IndexColumns} from '../index/model.ts';
import {flightStartRow, planFor} from '../map/play.ts';
import {representativeRow} from '../map/route.ts';

/** Lower case, accents dropped: "San Sebastián" matches "san sebastian". */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/**
 * The album `want` names (DEMO_TRIP): its id, or else the first album whose name contains it (case and
 * accents ignored). Without a match: the album with the most items, so the demo still opens on a trip.
 */
export function findTrip(albums: RailAlbum[], want: string): RailAlbum | null {
  const byId = albums.find(a => a.id === want);
  if (byId) return byId;
  const w = fold(want);
  const named = w ? albums.find(a => fold(a.name).includes(w)) : undefined;
  return named ?? albums.reduce<RailAlbum | null>((best, a) => (!best || a.count > best.count ? a : best), null);
}

// A link without `at` on the phone gets representativeRow (it lives with the route maths); the landing its own:
export {representativeRow};

/**
 * The landing's photo in rows lo..hi-1: the one Play's first flight leaves from (play.ts flightStartRow), so the
 * first ▶ travels within a couple of seconds; a representative one when the trip never leaves one place.
 */
export function landingRow(ix: IndexColumns, lo: number, hi: number) {
  const r = flightStartRow(ix, planFor(ix, lo, hi));
  return r >= 0 ? r : representativeRow(ix, lo, hi);
}
