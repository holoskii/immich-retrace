// Demo landing (pure): which trip a visit without a link opens, and which photo the cursor starts on.
import type {RailAlbum} from '../albums.ts';

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

// The cursor's opening photo is shared with the phone shell (a link without `at`): it lives with the route maths.
export {representativeRow} from '../map/route.ts';
