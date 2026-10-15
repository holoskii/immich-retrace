// Shape of demo/manifest.json (the frozen demo dataset) and the pure helpers shared by
// fetch.ts (builds it) and stub.ts (serves it). No I/O here.

import {createHash} from 'node:crypto';

export interface DemoAsset {
  /** Stable UUID derived from the Commons file title (+ "#clip" for derived videos). */
  id: string;
  kind: 'photo' | 'video';
  /** Commons file title, e.g. "File:Cases Ramos, Barcelona 01.jpg". For a clip: its source photo's. */
  title: string;
  author: string;
  license: 'CC BY 4.0' | 'CC BY-SA 4.0';
  licenseUrl: string;
  /** Commons file page. */
  commonsUrl: string;
  /** Upload timestamp of the Commons revision the media was taken from. */
  revision: string;
  /** SHA-1 of that revision's original file (as reported by Commons). */
  sha1: string;
  /** Capture instant, UTC, ISO with Z. */
  takenAt: string;
  /** EXIF local wall time minus GPS UTC time, in hours (multiple of 0.25). */
  localOffsetHours: number;
  /** How localOffsetHours was found: GPS stamp of this file, nearest file in time, or the zone rule. */
  offsetSource: 'gps' | 'neighbour' | 'zone';
  /** null when the file has no GPS or it was removed for the demo (see modifications). */
  lat: number | null;
  lon: number | null;
  city: string | null;
  country: string | null;
  /** Pixel size of the original (photos) or of the clip (videos). */
  width: number;
  height: number;
  /** Base64 thumbhash of the thumbnail, computed locally. */
  thumbhash: string;
  /** Video duration in ms; 0 for photos. */
  durationMs: number;
  /** Commons scaler URLs the photo's copies were downloaded from (null for clips). */
  thumbUrl: string | null;
  previewUrl: string | null;
  /** For clips: the id of the photo the clip was made from. */
  sourceId: string | null;
  /** What this demo changed relative to the Commons file. Always non-empty (copies are resized). */
  modifications: string;
  /**
   * Which demo user owns the asset in the stub. 'me' = the API key's user (their timeline);
   * 'friend' = another user whose assets the key's user sees only through a shared album.
   * A demo fiction: every file is by the same Commons author.
   */
  owner: DemoUser;
}

export type DemoUser = 'me' | 'friend';

export interface DemoAlbum {
  id: string;
  name: string;
  /** Members are the assets with from <= takenAt < to (UTC ISO); only shared albums include other users' assets. */
  from: string;
  to: string;
  description: string;
  owner: DemoUser;
  /** true when the album has other members (shared with or by the key's user). */
  shared: boolean;
}

export interface DemoManifest {
  /** Bump when the shape changes. */
  version: 1;
  generatedAt: string;
  source: string;
  assets: DemoAsset[];
  albums: DemoAlbum[];
}

/** RFC 4122-shaped UUID (version 5 bits) from a SHA-1 of the name, so ids survive rebuilds. */
export function nameUuid(name: string): string {
  // The pre-rename seed, kept so demo ids (and links to them) stay stable.
  const h = createHash('sha1').update('immich-viewer-demo\n' + name).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** Deterministic number in [0, 1) from a string. */
export function hashUnit(s: string): number {
  return createHash('sha1').update(s).digest().readUInt32BE(0) / 2 ** 32;
}

export const albumMembers = (m: DemoManifest, album: DemoAlbum) =>
  m.assets.filter(a => a.takenAt >= album.from && a.takenAt < album.to && (album.shared || a.owner === album.owner));

/** EXIF "YYYY:MM:DD HH:MM:SS" → epoch ms, read as if UTC (wall time). */
export function exifWallMs(s: unknown): number | null {
  const m = typeof s === 'string' && s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isFinite(t) && +m[1] > 1990 ? t : null;
}

/** MediaWiki's GPSTimeStamp, e.g. "\n*17/1\n*36/1\n*41000/1000", → seconds of day. */
export function gpsSeconds(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const parts = [...s.matchAll(/(-?\d+(?:\.\d+)?)(?:\/(\d+))?/g)].map(m => Number(m[1]) / (m[2] ? Number(m[2]) : 1));
  if (parts.length !== 3 || parts.some(p => !Number.isFinite(p))) return null;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

/** GPSDateStamp "YYYY:MM:DD" + GPSTimeStamp → UTC epoch ms. */
export function gpsUtcMs(date: unknown, time: unknown): number | null {
  const m = typeof date === 'string' && date.match(/^(\d{4}):(\d{2}):(\d{2})/);
  const sec = gpsSeconds(time);
  if (!m || sec === null) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) + Math.round(sec * 1000);
}

/**
 * Local offset = EXIF local wall time − GPS UTC time, rounded to 15 min. null when the stamps
 * don't agree to within 3 minutes of a 15-minute step (a stale GPS fix) or the result is out of range.
 */
export function offsetFromGps(localWallMs: number, utcMs: number): number | null {
  const diffMin = (localWallMs - utcMs) / 60_000;
  const q = Math.round(diffMin / 15) * 15;
  if (Math.abs(diffMin - q) > 3 || q < -12 * 60 || q > 14 * 60) return null;
  return q / 60;
}
