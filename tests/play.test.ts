// Play's timing (map/play.ts): step kinds, the scaled run, the floors, reduced motion, and the demo landing's photo.
import {describe, expect, it} from 'vitest';
import type {AssetColumns} from '../shared/api.ts';
import {albumMembers} from '../demo/manifest.ts';
import {loadManifest} from '../demo/stub.ts';
import {buildIndex} from '../web/src/lib/index/model.ts';
import {findStops} from '../web/src/lib/map/stops.ts';
import {flightStartRow, planFor, PLAY, playAhead, playDwell, playPlan, playScale, reducedDwell} from '../web/src/lib/map/play.ts';
import {landingRow} from '../web/src/lib/demo/landing.ts';
import {DEFAULT_DEMO_TRIP} from '../server/demo.ts';

const M = 60e3, T0 = Date.UTC(2026, 7, 1);

/** Rows as [minutes after T0, lat, lon] (null: no GPS); every photo landscape unless `ratio` says otherwise. */
function index(rows: [number, number | null, number | null, number?][]) {
  const c: AssetColumns = {id: [], t: [], off: [], video: [], dur: [], lat: [], lon: [], thumbhash: [], ratio: [], city: [], country: []};
  rows.forEach(([min, lat, lon, ratio], i) => {
    c.id.push(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    c.t.push(T0 + min * M); c.off.push(2); c.video.push(0); c.dur.push(0);
    c.lat.push(lat); c.lon.push(lon); c.thumbhash.push(null); c.ratio.push(ratio ?? 1.5); c.city.push(null); c.country.push(null);
  });
  return buildIndex([c]);
}
/** `n` photos at (lat, lon), `every` minutes apart from minute `start`, ~100 m jitter. */
const stay = (start: number, n: number, lat: number, lon: number, every = 10) =>
  Array.from({length: n}, (_, i): [number, number, number] => [start + i * every, lat + (i % 3) * 0.001, lon]);

const planOf = (ix: ReturnType<typeof index>) => playPlan(ix, 0, ix.n, findStops(ix, 0, ix.n));

describe('playPlan', () => {
  it('bursts within a stop whatever the time gap, flies between places, steps normally elsewhere', () => {
    const ix = index([
      ...stay(0, 6, 43, -2, 60), // a stop: an hour between photos is still within it
      [400, 43.3, -2], [420, 43.31, -2], // two roadside shots ~33 km on, 1 km and 20 min apart: passing through
      ...stay(1000, 6, 42, -1), // ~140 km away
    ]);
    const p = planOf(ix);
    expect(p.kind).toEqual(['burst', 'burst', 'burst', 'burst', 'burst', 'flight', 'photo', 'flight', 'burst', 'burst', 'burst', 'burst', 'burst']);
    // Short enough unscaled: the base dwells.
    expect([...p.dwell.slice(0, 13)]).toEqual([...Array(5).fill(PLAY.burstMs), PLAY.flightMs, PLAY.photoMs, PLAY.flightMs, ...Array(5).fill(PLAY.burstMs)]);
    expect(p.dwell[13]).toBe(0); // the last photo: nothing after it
  });

  it('places photos without GPS at the fix before them (no flight from a photo without one)', () => {
    const ix = index([...stay(0, 6, 43, -2), [100, null, null], [200, null, null], ...stay(300, 6, 42, -1)]);
    const p = planOf(ix);
    expect(p.kind.slice(5, 8)).toEqual(['photo', 'photo', 'flight']);
  });

  it('scales a long run to the target, never under the floors', () => {
    const ix = index([...stay(0, 120, 43, -2, 1), ...stay(400, 120, 42, -1, 1)]);
    const p = planOf(ix);
    expect(p.totalMs).toBeCloseTo(PLAY.targetMs, -2);
    expect(p.kind.filter(k => k === 'flight')).toHaveLength(1);
    const flight = p.dwell[p.kind.indexOf('flight')], burst = p.dwell[0];
    expect(burst).toBeLessThan(PLAY.burstMs);
    expect(burst).toBeGreaterThanOrEqual(PLAY.minBurstMs);
    expect(flight).toBeGreaterThanOrEqual(PLAY.minFlightMs); // the pause before a flight stays visible
    expect(flight / burst).toBeGreaterThan(3);
  });

  it('a selection too long for the target plays every photo at the floors (a year: minutes, no photo skipped)', () => {
    expect(playScale({burst: 5000, photo: 0, flight: 0})).toBe(0);
    const ix = index(stay(0, 2000, 43, -2, 1));
    const p = planOf(ix);
    expect(p.totalMs).toBe(1999 * PLAY.minBurstMs);
    expect(playScale({burst: 10, photo: 0, flight: 0})).toBe(1);
  });

  it('reduced motion: no photo faster than reducedMinMs, a jump to another place held longer', () => {
    expect(reducedDwell(150, 'burst', true)).toBe(PLAY.reducedMinMs);
    expect(reducedDwell(1200, 'photo', true)).toBe(1200);
    expect(reducedDwell(1200, 'flight', true)).toBe(PLAY.reducedMs);
    expect(reducedDwell(150, 'burst', false)).toBe(150);
  });

  it('playDwell: the planned dwell on a photo, the step into the next one between photos, null at the end', () => {
    const ix = index([...stay(0, 6, 43, -2), ...stay(300, 6, 42, -1)]);
    const p = planOf(ix);
    expect(playDwell(p, ix, ix.t[5], 5)).toBe(PLAY.flightMs);
    expect(playDwell(p, ix, ix.t[5], 5, true)).toBe(PLAY.reducedMs);
    expect(playDwell(p, ix, ix.t[5] + 1, 5)).toBe(PLAY.flightMs); // between 5 and 6: the step into 6
    expect(playDwell(p, ix, ix.t[0] + 1, 0)).toBe(PLAY.minPhotoMs);
    expect(playDwell(p, ix, ix.t[11], 11)).toBeNull();
  });
});

describe('playAhead (the card\'s prefetch while playing)', () => {
  it('picks the photos reached between lead and horizon, the longest-shown first; the current one if it stays', () => {
    // A stop of bursts (350 ms), then a flight pause (1.8 s) on row 5, then the next stop.
    const ix = index([...stay(0, 6, 43, -2), ...stay(300, 6, 42, -1)]);
    const p = planFor(ix, 0, ix.n);
    expect(planFor(ix, 0, ix.n)).toBe(p); // kept per index and range
    // From row 2: row 3 is 350 ms away (too soon), row 4 700, row 5 1050 (stays 1.8 s), row 6 2850 (past the horizon).
    expect(playAhead(p, 2)).toEqual([5, 4]);
    // On row 5 (the pause before the flight): it stays, so it comes first; then what comes after.
    expect(playAhead(p, 5)).toEqual([5, 6, 7, 8]);
    expect(playAhead(p, 11)).toEqual([]); // the end
  });

  it('times them as Play runs them with reduced motion (800 ms a photo): fewer rows within the horizon', () => {
    const ix = index([...stay(0, 6, 43, -2), ...stay(300, 6, 42, -1)]);
    const p = planFor(ix, 0, ix.n);
    // From row 1: row 2 at 800 ms, row 3 at 1600, row 4 at 2400; the flight row 5 at 3200 is past the horizon.
    expect(playAhead(p, 1, true)).toEqual([1, 2, 3, 4]);
  });
});

describe('the landing photo', () => {
  it('is where the first flight leaves from: the last landscape GPS photo before it', () => {
    const ix = index([...stay(0, 5, 43, -2), [50, 43, -2, 0.7], ...stay(300, 6, 42, -1)]);
    const p = planOf(ix);
    expect(p.kind.indexOf('flight')).toBe(5);
    expect(flightStartRow(ix, p)).toBe(4); // row 5 is portrait
    expect(flightStartRow(ix, p, 1)).toBe(5);
    expect(flightStartRow(index(stay(0, 8, 43, -2)), planOf(index(stay(0, 8, 43, -2))))).toBe(-1); // one place
  });

  it('on every demo trip the first ▶ reaches a flight within a few seconds, and a run lasts at most ~45 s', () => {
    const m = loadManifest();
    for (const al of m.albums) {
      const mem = albumMembers(m, al);
      const ix = buildIndex([{
        id: mem.map(a => a.id), t: mem.map(a => Date.parse(a.takenAt)), off: mem.map(a => a.localOffsetHours),
        video: mem.map(a => (a.kind === 'video' ? 1 : 0)), dur: mem.map(a => a.durationMs), lat: mem.map(a => a.lat),
        lon: mem.map(a => a.lon), thumbhash: mem.map(() => null), ratio: mem.map(a => a.width / a.height),
        city: mem.map(a => a.city), country: mem.map(a => a.country),
      }]);
      const p = planOf(ix), r = landingRow(ix, 0, ix.n);
      expect(p.totalMs, al.name).toBeLessThanOrEqual(PLAY.targetMs + 1);
      const f = p.kind.indexOf('flight');
      if (f < 0) continue;
      let wait = 0;
      for (let k = r; k <= f; k++) wait += p.dwell[k];
      expect(wait, al.name).toBeLessThanOrEqual(4000);
      if (al.name.includes(DEFAULT_DEMO_TRIP)) expect(ix.ratio[r]).toBeGreaterThan(1.2); // a landscape card (LCP)
    }
  });
});
