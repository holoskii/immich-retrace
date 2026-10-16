import {describe, expect, it} from 'vitest';
import type {AssetColumns} from '../shared/api.ts';
import {albumMembers} from '../demo/manifest.ts';
import {loadManifest} from '../demo/stub.ts';
import {buildIndex} from '../web/src/lib/index/model.ts';
import {findStops, stepStop, STOPS} from '../web/src/lib/map/stops.ts';

const M = 60e3, T0 = Date.UTC(2026, 7, 1);

/** Rows as [minutes after T0, lat, lon, city] (null lat = no GPS). ~1.1 km per 0.01° of latitude. */
function index(rows: [number, number | null, number | null, string?][]) {
  const c: AssetColumns = {id: [], t: [], off: [], video: [], dur: [], lat: [], lon: [], thumbhash: [], ratio: [], city: [], country: []};
  rows.forEach(([min, lat, lon, city], i) => {
    c.id.push(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    c.t.push(T0 + min * M); c.off.push(2); c.video.push(0); c.dur.push(0);
    c.lat.push(lat); c.lon.push(lon); c.thumbhash.push(null); c.ratio.push(1.5); c.city.push(city ?? null); c.country.push('Spain');
  });
  return buildIndex([c]);
}

/** `n` fixes around (lat, lon), `every` minutes apart from minute `start`, jittered by ~100 m. */
const stay = (start: number, n: number, lat: number, lon: number, city: string, every = 10) =>
  Array.from({length: n}, (_, i): [number, number, number, string] => [start + i * every, lat + (i % 3) * 0.001, lon + (i % 2) * 0.001, city]);

describe('findStops', () => {
  it('finds each town of a road trip and drops roadside shots in between', () => {
    const ix = index([
      ...stay(0, 8, 43.32, -1.98, 'San Sebastián'),
      [200, 43.0, -1.7, 'Road'], [230, 42.8, -1.4, 'Road'], // passing through
      ...stay(300, 10, 42.62, -1.15, 'Yesa'),
      ...stay(700, 12, 42.14, -0.41, 'Huesca'),
    ]);
    const s = findStops(ix, 0, ix.n);
    expect(s.map(x => x.place)).toEqual(['San Sebastián', 'Yesa', 'Huesca']);
    expect(s.map(x => x.n)).toEqual([8, 10, 12]);
    expect(s[1]).toMatchObject({lo: 10, hi: 20, t0: T0 + 300 * M, t1: T0 + 390 * M});
    expect(s[1].lat).toBeCloseTo(42.621, 2);
  });

  it('keeps a long stay with few photos (minMs) but not a short burst of the same size', () => {
    const ix = index([[0, 42, -1, 'A'], [60, 42.001, -1, 'A'], [100, 43, -1, 'B'], [101, 43.001, -1, 'B']]);
    expect(findStops(ix, 0, ix.n).map(x => x.place)).toEqual(['A']);
  });

  it('includes photos without GPS inside a stay and ignores them for splitting', () => {
    const ix = index([...stay(0, 3, 42, -1, 'A'), [35, null, null], ...stay(40, 3, 42, -1, 'A')]);
    const s = findStops(ix, 0, ix.n);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({lo: 0, hi: 7, n: 6});
  });

  it('merges a stay interrupted by a detour back into one stop', () => {
    const ix = index([...stay(0, 6, 42, -1, 'A'), [70, 42.3, -1, 'B'], ...stay(80, 6, 42.002, -1, 'A')]);
    const s = findStops(ix, 0, ix.n);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({lo: 0, hi: 13, n: 12});
  });

  it('keeps a return to an earlier place as its own stop (A → B → A)', () => {
    const ix = index([...stay(0, 6, 42, -1, 'A'), ...stay(100, 6, 42.5, -1, 'B'), ...stay(200, 6, 42, -1, 'A')]);
    expect(findStops(ix, 0, ix.n).map(x => x.place)).toEqual(['A', 'B', 'A']);
  });

  it('averages longitudes across the antimeridian', () => {
    const ix = index(Array.from({length: 6}, (_, i): [number, number, number, string] => [i * 10, -16.8, i % 2 ? -179.99 : 179.99, 'Taveuni']));
    const s = findStops(ix, 0, ix.n);
    expect(s).toHaveLength(1);
    expect(s[0].n).toBe(6);
    expect(Math.abs(s[0].lon)).toBeCloseTo(180, 1);
  });

  it('works on a sub-range and with nothing to find', () => {
    const ix = index([...stay(0, 6, 42, -1, 'A'), ...stay(100, 6, 42.5, -1, 'B')]);
    expect(findStops(ix, 6, 12).map(x => x.place)).toEqual(['B']);
    expect(findStops(ix, 0, 0)).toEqual([]);
    expect(findStops(index([[0, null, null], [5, null, null]]), 0, 2)).toEqual([]);
  });

  // The thresholds are tuned on the demo trips: one stop per town or sight a visitor would name.
  it('finds the demo trips’ stops', () => {
    const manifest = loadManifest();
    const counts = Object.fromEntries(manifest.albums.map(al => {
      const members = albumMembers(manifest, al);
      const ix = buildIndex([{
        id: members.map(a => a.id), t: members.map(a => Date.parse(a.takenAt)), off: members.map(a => a.localOffsetHours),
        video: members.map(a => (a.kind === 'video' ? 1 : 0)), dur: members.map(a => a.durationMs), lat: members.map(a => a.lat),
        lon: members.map(a => a.lon), thumbhash: members.map(() => null), ratio: members.map(() => 1.5),
        city: members.map(a => a.city), country: members.map(a => a.country),
      }]);
      return [al.name.split(',')[0], findStops(ix, 0, ix.n).map(s => s.place)];
    }));
    expect(STOPS.radiusKm).toBe(5);
    expect(counts).toEqual({
      'Pamplona & Basque Country': ['Pamplona', 'San Sebastián', 'Oñati'],
      // The default demo trip (DEFAULT_DEMO_TRIP): the coast, Leyre, San Juan de la Peña, Huesca.
      'San Sebastián to Huesca': ['San Sebastián', 'Yesa', 'Santa Cruz de la Serós', 'Huesca'],
      'Sète': ['Sète', 'Le Grau-du-Roi', 'Dole'],
      'Alsace & Freiburg': ['Ebersmunster', 'Strasbourg'],
      'Lisbon & Queluz': ['Lisbon', 'Lisbon', 'Lisbon', 'Lisbon', 'Queluz'],
      'Pyrenees': ['Sallent de Gállego', 'Barcelona', 'Queralbs'],
    });
  });
});

describe('stepStop', () => {
  const ix = index([...stay(0, 6, 42, -1, 'A'), ...stay(100, 6, 42.5, -1, 'B'), ...stay(200, 6, 43, -1, 'C')]);
  const s = findStops(ix, 0, ix.n), at = (min: number) => T0 + min * M;

  it('⏭ goes to the next stop’s start, -1 after the last', () => {
    expect(stepStop(s, at(-5), 1)).toBe(0);
    expect(stepStop(s, at(0), 1)).toBe(1);
    expect(stepStop(s, at(120), 1)).toBe(2);
    expect(stepStop(s, at(200), 1)).toBe(-1);
  });

  it('⏮ goes to the start of the current stop, then the one before', () => {
    expect(stepStop(s, at(120), -1)).toBe(1);
    expect(stepStop(s, at(100), -1)).toBe(0);
    expect(stepStop(s, at(80), -1)).toBe(0);
    expect(stepStop(s, at(0), -1)).toBe(-1);
  });
});
