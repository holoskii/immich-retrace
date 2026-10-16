import {describe, expect, it} from 'vitest';
import type {AlbumSummary} from '../shared/api.ts';
import {buildIndex} from '../web/src/lib/index/model.ts';
import {classifyTrips, homes, km, placeIn, tripReason, tripsOf} from '../web/src/lib/overview/trips.ts';

const D = (s: string) => Date.parse(s + 'T00:00:00Z');
const DAY = 86400e3;

/** Rows: [UTC ISO instant, lat, lon, city?, country?]; lat null = no GPS. Offset 0 throughout. */
type Row = [string, number | null, number | null, string?, string?];
function lib(rows: Row[]) {
  return buildIndex([{
    id: rows.map((_, i) => 'r' + i), t: rows.map(r => Date.parse(r[0])), off: rows.map(() => 0),
    video: rows.map(() => 0), dur: rows.map(() => 0), lat: rows.map(r => r[1]), lon: rows.map(r => r[2]),
    thumbhash: rows.map(() => null), ratio: rows.map(() => 1),
    city: rows.map(r => r[3] ?? null), country: rows.map(r => r[4] ?? null),
  }]);
}
/** Immich album dates: the first and last item's local calendar day, at midnight. */
const album = (id: string, from: string, to: string, count: number, name = id): AlbumSummary =>
  ({id, name, start: D(from), end: D(to), count, shared: false, cover: null, version: 'v'});

const HOME: [number, number] = [59.44, 24.75];
const AWAY: [number, number] = [41.39, 2.17];   // ~2 600 km from HOME
/** A few photos at home on the 3rd of every month, 2023–2025: home in every year. */
const homeRows: Row[] = [];
for (let y = 2023; y <= 2025; y++) for (let m = 1; m <= 12; m++)
  for (let k = 0; k < 3; k++) homeRows.push([`${y}-${String(m).padStart(2, '0')}-03T1${k}:00:00Z`, ...HOME, 'Tallinn', 'Estonia']);
/** n photos a day over [from, from + days) at `at`. */
function days(from: string, n: number, perDay: number, at: [number, number] | [null, null], city?: string, country?: string): Row[] {
  const out: Row[] = [];
  for (let d = 0; d < n; d++) for (let k = 0; k < perDay; k++)
    out.push([new Date(D(from) + d * DAY + (8 + k % 12) * 3600e3).toISOString(), ...at, city, country]);
  return out;
}

describe('km', () => {
  it('measures great circles', () => {
    expect(km(0, 0, 1, 0)).toBeCloseTo(111.2, 0);
    expect(km(59.44, 24.75, 58.38, 26.72)).toBeGreaterThan(150);   // Tallinn → Tartu
    expect(km(10, 179.9, 10, -179.9)).toBeLessThan(25);             // across the antimeridian
  });
});

describe('homes', () => {
  it('is the place with photos in the most months, not the most photos', () => {
    const ix = lib([...homeRows, ...days('2024-06-01', 20, 40, AWAY)]);
    const h = homes(ix).get(2024)!;
    expect(km(h.lat, h.lon, ...HOME)).toBeLessThan(1);
  });
  it('follows a move, with the years either side deciding', () => {
    const rows: Row[] = [];
    for (let m = 1; m <= 12; m++) rows.push([`2020-${String(m).padStart(2, '0')}-05T12:00:00Z`, ...HOME], [`2021-${String(m).padStart(2, '0')}-05T12:00:00Z`, ...HOME]);
    for (let m = 1; m <= 12; m++) rows.push([`2023-${String(m).padStart(2, '0')}-05T12:00:00Z`, ...AWAY], [`2024-${String(m).padStart(2, '0')}-05T12:00:00Z`, ...AWAY]);
    const hs = homes(lib(rows));
    expect(km(hs.get(2020)!.lat, hs.get(2020)!.lon, ...HOME)).toBeLessThan(1);
    expect(km(hs.get(2024)!.lat, hs.get(2024)!.lon, ...AWAY)).toBeLessThan(1);
  });
  it('needs photos in at least three months', () => {
    expect(homes(lib(days('2024-06-01', 50, 5, HOME))).size).toBe(0);
  });
});

describe('placeIn', () => {
  const places = ['Santa Cruz de Tenerife', 'Spain', 'Kyrgyzstan', 'Sète', 'Rome'];
  it('matches a word of a place, ignoring case and accents', () => {
    expect(placeIn('2025-10_Tenerife', places)).toBe('Santa Cruz de Tenerife');
    expect(placeIn('Sete & Lyon', places)).toBe('Sète');
    expect(placeIn('kyrgyz trip', places)).toBe('Kyrgyzstan');
  });
  it('ignores short words and other scripts', () => {
    expect(placeIn('de la Cruz', ['Cruz'])).toBe('Cruz');
    expect(placeIn('de la', places)).toBeNull();
    expect(placeIn('Rom', places)).toBeNull();
    expect(placeIn('Тенерифе', places)).toBeNull();
    expect(placeIn('Polina', places)).toBeNull();
  });
});

describe('classifyTrips', () => {
  // A 10-day trip in June 2024: 30 photos a day; then 10 days at home with 10 a day.
  const ix = lib([...homeRows, ...days('2024-06-01', 10, 30, AWAY, 'Barcelona', 'Spain'), ...days('2024-06-11', 10, 10, HOME, 'Tallinn', 'Estonia')]);
  const albums = [
    album('trip', '2024-06-01', '2024-06-10', 280, '2024-06_Barcelona'),
    album('dated', '2024-06-01', '2024-06-10', 90, '2024-06 holiday'),     // 30 %, dated name: away alone carries it
    album('person', '2024-06-02', '2024-06-09', 80, 'Polina'),             // same days, a first name
    album('picks', '2024-06-01', '2024-06-20', 15, 'Polina'),              // trip + home days, few photos
    album('event', '2024-06-12', '2024-06-13', 18, '2024-06_Debate'),       // at home
    album('tiny', '2024-06-03', '2024-06-04', 5, 'Spain'),                 // under TRIP_MIN
    album('year', '2024-01-01', '2024-12-31', 500, '2024_Camera'),         // over TRIP_DAYS
  ];
  const t = classifyTrips(albums, ix);
  const v = (id: string) => t.verdicts.get(id)!;

  it('scores away days, share of the photos and the name', () => {
    expect(t.confident).toBe(true);
    expect(v('trip')).toMatchObject({trip: true, points: 4, away: {far: 10, days: 10}, place: 'Barcelona'});
    expect(v('trip').share).toBeCloseTo(280 / 303);   // + the 3 home photos of 3 June
    expect(v('dated')).toMatchObject({trip: true, points: 2, bare: false, place: null});
    expect(v('person')).toMatchObject({trip: false, points: 1, bare: true});
    expect(v('picks')).toMatchObject({trip: false, away: {far: 10, days: 20}});
    expect(v('picks').points).toBe(1 - 1 - 1);
    expect(v('event')).toMatchObject({trip: false, points: -3 + 1, away: {far: 0, days: 2}});
  });
  it('judges only short albums with enough items; isTrip follows the verdicts', () => {
    expect(t.verdicts.has('tiny')).toBe(false);
    expect(t.verdicts.has('year')).toBe(false);
    expect(albums.filter(t.isTrip).map(a => a.id)).toEqual(['trip', 'dated']);
  });
  it('falls back to the span when there is too little GPS to judge', () => {
    const noGps = lib([...homeRows.map(([t]): Row => [t, null, null]), ...days('2024-06-01', 20, 10, [null, null])]);
    const f = classifyTrips(albums, noGps);
    expect(f.confident).toBe(false);
    expect(albums.filter(f.isTrip).map(a => a.id)).toEqual(['trip', 'dated', 'person', 'picks', 'event', 'tiny']);
    expect(classifyTrips(albums, null).confident).toBe(false);
  });
  it('counts library items on the album days by local time', () => {
    // 23:30 UTC at +2 h is the next local day: inside an album of that day only.
    const l = buildIndex([{
      id: ['x', 'y'], t: [Date.parse('2024-06-01T23:30:00Z'), Date.parse('2024-06-02T12:00:00Z')], off: [2, 2], video: [0, 0],
      dur: [0, 0], lat: [null, null], lon: [null, null], thumbhash: [null, null], ratio: [1, 1], city: [null, null], country: [null, null],
    }]);
    expect(classifyTrips([album('a', '2024-06-02', '2024-06-02', 10)], l).verdicts.get('a')!.share).toBe(1);
    expect(classifyTrips([album('a', '2024-06-01', '2024-06-01', 10)], l).verdicts.get('a')!.share).toBeNull();
  });
  it('is memoized per (albums, index)', () => {
    expect(tripsOf(albums, ix)).toBe(tripsOf(albums, ix));
    expect(tripsOf(albums, null)).not.toBe(tripsOf(albums, ix));
  });
  it('explains itself', () => {
    expect(tripReason(v('trip'))).toBe('≥ 100 km from home 10 of 10 days · 92% of the photos then · named after Barcelona');
    expect(tripReason(v('person'))).toBe('≥ 100 km from home 8 of 8 days · 33% of the photos then · name is not a place');
  });
});
