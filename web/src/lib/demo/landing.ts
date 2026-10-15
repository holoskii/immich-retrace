// Demo landing (pure): which trip a visit without a link opens, and which photo the cursor starts on.
import type {IndexColumns} from '../index/model.ts';
import type {RailAlbum} from '../overview/data.ts';

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

/**
 * A photo to open the trip on: one with GPS (so the marker sits on the route), not a video, taken nearest
 * the middle of the trip's GPS time span (route behind and ahead of it), preferring a landscape one among
 * the few nearest (the map card crops to landscape). Falls back to the first row; -1 for an empty range.
 */
export function representativeRow(ix: IndexColumns, lo: number, hi: number, near = 6): number {
  const rows: number[] = [];
  for (let r = lo; r < hi; r++) if (ix.gps[r] === 1 && ix.video[r] === 0) rows.push(r);
  if (!rows.length) return hi > lo ? lo : -1;
  const mid = (ix.t[rows[0]] + ix.t[rows[rows.length - 1]]) / 2;
  const byDistance = [...rows].sort((a, b) => Math.abs(ix.t[a] - mid) - Math.abs(ix.t[b] - mid) || a - b);
  return byDistance.slice(0, near).find(r => ix.ratio[r] > 1.2) ?? byDistance[0];
}
