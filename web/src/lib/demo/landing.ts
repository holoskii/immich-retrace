// Demo landing (pure): which trip a visit without a link opens, and which photo the cursor starts on.
import {matchTrip} from '../../../../shared/demo.ts';
import type {RailAlbum} from '../albums.ts';
import type {IndexColumns} from '../index/model.ts';
import {flightStartRow, planFor} from '../map/play.ts';
import {representativeRow} from '../map/route.ts';

/** The album `want` names (DEMO_TRIP, or the id the server resolved it to): shared/demo.ts matchTrip. */
export const findTrip = (albums: RailAlbum[], want: string): RailAlbum | null => matchTrip(albums, want);

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
