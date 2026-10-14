// Trip heuristic: which albums are trips (a stretch away from home), from the album list and the library index alone,
// with no per-album Immich calls. An album is a candidate when it spans at most TRIP_DAYS days and holds at least
// TRIP_MIN items; a candidate is a trip at TRIP_POINTS points or more:
//  - away: of the days in the album's dates with GPS (library photos, not just the album's), the share reaching
//    AWAY_KM from home. ≥ 75 % +2, ≥ 40 % +1 (the dates also cover days at home), less −3 (at home: never a trip).
//    0 when there is no GPS in those dates or no home.
//  - share: album items / library items in its dates. ≥ 60 % +1 (the album is most of what was shot then: a trip
//    album), < 10 % −1 (a few picks across many days: a person, a topic).
//  - name: a word matching a city or country of the photos taken in its dates +1; a lone word matching none
//    (a first name, a topic: "Polina", "Memes") −1. No language lists: places come from Immich's own geocoding.
// Home, per year: the place (a 0.25° cell) with photos in the most distinct months over that year and the years either
// side, at least HOME_MONTHS of them. Months, not photos or days, so one long holiday never becomes home and a move is
// followed within a year or two. Without a home "away" is unknown.
// Confidence: when fewer than half the candidates could be judged on "away" (little GPS, no home), points rest on the
// share and the name alone; then `confident` is false and every candidate passes (the tab says "albums", not "trips").
import type {AlbumSummary} from '../../../../shared/api.ts';
import type {IndexColumns} from '../index/model.ts';
import {DAY, HOUR} from './data.ts';

/** Longest span a trip can have, in days; the folder albums include year-spanning ones (`2026_Camera`). */
export const TRIP_DAYS = 45;
export const TRIP_MIN = 10;
export const TRIP_POINTS = 2;
export const AWAY_KM = 100;
export const HOME_MONTHS = 3;
const CELL = 0.25;

export interface TripVerdict {
  trip: boolean;
  points: number;
  /** Days with GPS in the album's dates and how many of them reach AWAY_KM from home; null without GPS or home. */
  away: {far: number; days: number} | null;
  /** Album items / library items in its dates, at most 1 (a shared album can hold more); null when the library has none then. */
  share: number | null;
  /** The city or country the name matches, as Immich spells it. */
  place: string | null;
  /** The name is one word of letters that matches no place. */
  bare: boolean;
}

export interface Trips {
  /** Most candidates had GPS and a home to judge by; false means the filter is the span alone. */
  confident: boolean;
  /** Candidates only (span ≤ TRIP_DAYS, ≥ TRIP_MIN items). */
  verdicts: Map<string, TripVerdict>;
  /** A trip (confident), or else any album spanning at most TRIP_DAYS. */
  isTrip(a: AlbumSummary): boolean;
}

/** The album's span in days is at most TRIP_DAYS (album dates are calendar days). */
export const shortAlbum = (a: AlbumSummary) =>
  a.start != null && a.end != null && a.count > 0 && a.end - a.start <= TRIP_DAYS * DAY;

/** Great-circle distance in km (haversine). */
export function km(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const localT = (ix: IndexColumns, r: number) => ix.t[r] + ix.off[r] * HOUR;

/**
 * Home per local calendar year: the centre (mean position) of the CELL with photos in the most distinct months over
 * years y−1…y+1, when that is at least HOME_MONTHS; years without one are absent.
 */
export function homes(ix: IndexColumns): Map<number, {lat: number; lon: number}> {
  const cells = new Map<string, {lat: number; lon: number; n: number; months: Set<number>}>();
  for (let r = 0; r < ix.n; r++) {
    if (!ix.gps[r]) continue;
    const key = Math.round(ix.lat[r] / CELL) + ',' + Math.round(ix.lon[r] / CELL);
    let c = cells.get(key);
    if (!c) cells.set(key, c = {lat: 0, lon: 0, n: 0, months: new Set()});
    const d = new Date(localT(ix, r));
    c.lat += ix.lat[r]; c.lon += ix.lon[r]; c.n++;
    c.months.add(d.getUTCFullYear() * 12 + d.getUTCMonth());
  }
  // Distinct months per cell and year.
  const perYear = [...cells.values()].map(c => {
    const y = new Map<number, number>();
    for (const m of c.months) y.set(Math.floor(m / 12), (y.get(Math.floor(m / 12)) ?? 0) + 1);
    return {c, y};
  });
  const years = new Set<number>();
  for (const {y} of perYear) for (const k of y.keys()) years.add(k);
  const out = new Map<number, {lat: number; lon: number}>();
  for (const year of years) {
    let best = 0, home: {lat: number; lon: number; n: number} | null = null;
    for (const {c, y} of perYear) {
      const m = (y.get(year - 1) ?? 0) + (y.get(year) ?? 0) + (y.get(year + 1) ?? 0);
      if (m > best) { best = m; home = c; }
    }
    if (home && best >= HOME_MONTHS) out.set(year, {lat: home.lat / home.n, lon: home.lon / home.n});
  }
  return out;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const words = (s: string) => fold(s).split(/[^\p{L}]+/u).filter(w => w.length >= 4);
/** Same word, or one a prefix of the other when both have 5+ letters ("Kyrgyz" / "Kyrgyzstan"). */
const sameWord = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)));

/** The first of `places` that shares a word with `name`, or null. */
export function placeIn(name: string, places: Iterable<string>): string | null {
  const ws = words(name);
  if (!ws.length) return null;
  for (const p of places) if (words(p).some(pw => ws.some(w => sameWord(w, pw)))) return p;
  return null;
}

/** Index of the first row with t ≥ x (rows are sorted by t). */
function lowerBound(t: Float64Array, x: number) {
  let lo = 0, hi = t.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < x) lo = m + 1; else hi = m; }
  return lo;
}

/** Points for one candidate; `home` is null when its year has none. */
export function judge(a: AlbumSummary & {start: number; end: number}, ix: IndexColumns, home: {lat: number; lon: number} | null): TripVerdict {
  // Immich gives album dates as local calendar days (midnight, read as UTC): rows whose local time falls on them.
  const w0 = Math.floor(a.start / DAY) * DAY, w1 = Math.floor(a.end / DAY) * DAY + DAY;
  let rows = 0;
  const far = new Map<number, boolean>(), places = new Set<string>();
  for (let r = lowerBound(ix.t, w0 - 15 * HOUR); r < ix.n && ix.t[r] < w1 + 15 * HOUR; r++) {
    const lt = localT(ix, r);
    if (lt < w0 || lt >= w1) continue;
    rows++;
    if (ix.city[r]) places.add(ix.city[r]!);
    if (ix.country[r]) places.add(ix.country[r]!);
    if (!ix.gps[r] || !home) continue;
    const day = Math.floor(lt / DAY);
    far.set(day, far.get(day) || km(home.lat, home.lon, ix.lat[r], ix.lon[r]) >= AWAY_KM);
  }
  let points = 0;
  let away: TripVerdict['away'] = null;
  if (far.size) {
    away = {far: [...far.values()].filter(Boolean).length, days: far.size};
    const f = away.far / away.days;
    points += f >= 0.75 ? 2 : f >= 0.4 ? 1 : -3;
  }
  const share = rows ? Math.min(1, a.count / rows) : null;
  if (share != null) points += share >= 0.6 ? 1 : share < 0.1 ? -1 : 0;
  const place = placeIn(a.name, places);
  const bare = !place && /^\p{L}+$/u.test(a.name.trim());
  points += place ? 1 : bare ? -1 : 0;
  return {trip: points >= TRIP_POINTS, points, away, share, place, bare};
}

/** Classifies every album; O(library) for the homes plus O(rows in the candidates' dates). */
export function classifyTrips(albums: AlbumSummary[], ix: IndexColumns | null): Trips {
  const verdicts = new Map<string, TripVerdict>();
  let judged = 0;
  if (ix) {
    const hs = homes(ix);
    for (const a of albums) {
      if (!shortAlbum(a) || a.count < TRIP_MIN) continue;
      const year = new Date(a.start!).getUTCFullYear();
      const v = judge(a as AlbumSummary & {start: number; end: number}, ix, hs.get(year) ?? null);
      verdicts.set(a.id, v);
      if (v.away) judged++;
    }
  }
  const confident = verdicts.size > 0 && judged * 2 >= verdicts.size;
  return {
    confident, verdicts,
    isTrip: a => confident ? !!verdicts.get(a.id)?.trip : shortAlbum(a),
  };
}

let memo: {albums: AlbumSummary[]; ix: IndexColumns | null; trips: Trips} | null = null;
/** `classifyTrips`, cached for the last (albums, index) pair: the rail, the picker and zoom names share one result. */
export function tripsOf(albums: AlbumSummary[], ix: IndexColumns | null): Trips {
  if (memo?.albums !== albums || memo.ix !== ix) memo = {albums, ix, trips: classifyTrips(albums, ix)};
  return memo.trips;
}

/** One line on why a candidate counts as a trip or not, for tooltips: "far from home 9 of 9 days · 97% of the photos then · Morocco". */
export function tripReason(v: TripVerdict): string {
  const parts: string[] = [];
  parts.push(v.away ? `≥ ${AWAY_KM} km from home ${v.away.far} of ${v.away.days} days` : 'no GPS to judge distance');
  if (v.share != null) parts.push(`${Math.round(v.share * 100)}% of the photos then`);
  if (v.place) parts.push(`named after ${v.place}`);
  else if (v.bare) parts.push('name is not a place');
  return parts.join(' · ');
}
