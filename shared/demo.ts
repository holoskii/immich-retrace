// Demo mode's part of the API (server/demo.ts ↔ web/src/lib/demo/). A normal deployment never sends these.

/**
 * The project's home, linked from the demo ("Get it for your Immich"). Override per deployment with REPO_URL.
 */
export const REPO_URL = 'https://github.com/holoskii/immich-retrace';

/** ViewerConfig.demo (GET /api/config) when DEMO=1. */
export interface DemoConfig {
  /** The trip a visit without a link opens: an album id, or a part of its name (case and accents ignored). */
  trip: string;
  /**
   * `trip` resolved by the server (`matchTrip` over the album list): the album's id, so a landing can fetch its members
   * at once instead of waiting for the library index. Null when the list couldn't be read in time: the browser then
   * resolves `trip` itself from its own album list.
   */
  album: string | null;
  /** The project's home (REPO_URL). */
  repoUrl: string;
}

/** GET /api/demo/credits/:id: who made a demo asset, its licence, and what the demo changed. */
export interface DemoCredit {
  /** Commons file title without the "File:" prefix. */
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
  /** The file's page on Wikimedia Commons. */
  commonsUrl: string;
  modifications: string;
}

/** Lower case, accents dropped: "San Sebastián" matches "san sebastian". */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/**
 * The album `want` names (DEMO_TRIP) among `albums` (those with dates and items): its id, or else the first album
 * whose name contains it (case and accents ignored). Without a match: the album with the most items, so the demo
 * still opens on a trip. Shared by the server (DemoConfig.album) and the browser's fallback.
 */
export function matchTrip<A extends {id: string; name: string; count: number}>(albums: A[], want: string): A | null {
  const byId = albums.find(a => a.id === want);
  if (byId) return byId;
  const w = fold(want);
  const named = w ? albums.find(a => fold(a.name).includes(w)) : undefined;
  return named ?? albums.reduce<A | null>((best, a) => (!best || a.count > best.count ? a : best), null);
}
