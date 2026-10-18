// The phone shell's pure logic: tabs, the time strip's mapping and ticks, Play's timing, labels, share fallback.
import {describe, expect, it, vi} from 'vitest';
import {mapCovered, tabForSelection} from '../web/src/lib/mobile/tabs.ts';
import {dayTicks, stopAt, stopLabel, stopTicks, timeAt, xAt} from '../web/src/lib/mobile/strip.ts';
import {nextDue, Player} from '../web/src/lib/mobile/player.ts';
import {fDayRange, tripName} from '../web/src/lib/mobile/format.ts';
import {shareLink} from '../web/src/lib/mobile/share.ts';

const H = 3600e3, D = 86400e3, T0 = Date.UTC(2024, 8, 6);

describe('tabs', () => {
  it('shows Trips without a selection, moves a pick from Trips to Map, and leaves Map and Photos alone', () => {
    expect(tabForSelection('map', false)).toBe('trips');
    expect(tabForSelection('photos', false)).toBe('trips');
    expect(tabForSelection('trips', true)).toBe('map');
    expect(tabForSelection('map', true)).toBe('map');
    expect(tabForSelection('photos', true)).toBe('photos');
  });
  it('counts the map as covered under another tab or the lightbox', () => {
    expect(mapCovered('map', false)).toBe(false);
    expect(mapCovered('map', true)).toBe(true);
    expect(mapCovered('trips', false)).toBe(true);
    expect(mapCovered('photos', false)).toBe(true);
  });
});

describe('time strip', () => {
  it('maps time to x and back, clamped inside the span (t1 exclusive)', () => {
    const t1 = T0 + 4 * D;
    expect(xAt(T0 + 2 * D, T0, t1, 400)).toBe(200);
    expect(timeAt(200, T0, t1, 400)).toBeCloseTo(T0 + 2 * D, -3);
    expect(timeAt(-50, T0, t1, 400)).toBe(T0);
    expect(timeAt(9999, T0, t1, 400)).toBe(t1 - 1);
    expect(timeAt(10, T0, t1, 0)).toBe(T0);
  });

  it('puts a tick at each stop start in range and drops one too close to the last', () => {
    const t1 = T0 + 10 * H, stops = [{t0: T0 - H}, {t0: T0 + H}, {t0: T0 + H + 60e3}, {t0: T0 + 5 * H}, {t0: t1}];
    expect(stopTicks(stops, T0, t1, 1000)).toEqual([{i: 1, x: 100}, {i: 3, x: 500}]);
    expect(stopTicks(stops, T0, t1, 1000, 1)).toEqual([{i: 1, x: 100}, {i: 2, x: 100 + 1000 / 600}, {i: 3, x: 500}]);
  });

  it('ticks local midnights in the selection offset, labelling every k-th day when days are narrow', () => {
    // Local UTC+2: the first local midnight after T0 is T0 + 22 h.
    const wide = dayTicks(T0, T0 + 5 * D, 2, 500);
    expect(wide[0].t).toBe(T0 + 22 * H);
    expect(wide.map(d => d.label)).toEqual(['Sat 7', 'Sun 8', 'Mon 9', 'Tue 10', 'Wed 11']);
    const narrow = dayTicks(T0, T0 + 28 * D, 0, 330);
    expect(narrow.length).toBe(28);
    const labelled = narrow.filter(d => d.label);
    expect(labelled[0].label).toMatch(/^6 Sep/);
    expect(labelled[1].t - labelled[0].t).toBe(4 * D); // 330 / 28 ≈ 11.8 px a day: every 4th for 44 px
    expect(dayTicks(T0, T0, 0, 300)).toEqual([]);
  });

  it('says which stop the cursor is in, or which one it is after', () => {
    const stops = [{t0: T0, t1: T0 + 2 * H, place: 'Leyre'}, {t0: T0 + 5 * H, t1: T0 + 8 * H, place: 'Yesa'}, {t0: T0 + 9 * H, t1: T0 + 9 * H, place: ''}];
    expect(stopAt(stops, T0 - 1)).toEqual({i: -1, inside: false});
    expect(stopAt(stops, T0 + H)).toEqual({i: 0, inside: true});
    expect(stopAt(stops, T0 + 3 * H)).toEqual({i: 0, inside: false});
    expect(stopAt(stops, T0 + 8 * H)).toEqual({i: 1, inside: true});
    expect(stopLabel(stops, T0 + 6 * H)).toBe('Yesa · stop 2 / 3');
    expect(stopLabel(stops, T0 + 3 * H)).toBe('after Leyre');
    expect(stopLabel(stops, T0 - H)).toBe('before Leyre');
    expect(stopLabel(stops, T0 + 9 * H)).toBe('stop 3 / 3');
    expect(stopLabel(stops, null)).toBe('3 stops');
    expect(stopLabel([], T0)).toBe('');
  });
});

describe('Play timing', () => {
  it('keeps steps on their deadlines when a timer fires late, without a catch-up burst after a stall', () => {
    expect(nextDue(1000, 900, 1000)).toBe(1900);
    // Fired 200 ms late: the next one is still 900 ms after the previous deadline.
    expect(nextDue(1900, 900, 2100)).toBe(2800);
    // A long stall (throttled tab): a full dwell from now, not a string of overdue steps.
    expect(nextDue(1900, 900, 9000)).toBe(9900);
  });

  function run(dwells: number[], lateBy = 0) {
    let now = 0, c = 0;
    const timers: {at: number; f: () => void}[] = [];
    const log: string[] = [];
    const p = new Player({
      dwell: () => (c < dwells.length ? dwells[c] : null),
      advance: () => { c++; log.push(`step ${c} @${now}`); },
      changed: (on, ended) => log.push(on ? `play @${now}` : `stop${ended ? ' (end)' : ''} @${now}`),
      now: () => now,
      setTimer: (f, ms) => { const t = {at: now + ms + lateBy, f}; timers.push(t); return t; },
      clearTimer: h => { const i = timers.indexOf(h as never); if (i >= 0) timers.splice(i, 1); },
    });
    const tick = () => { const t = timers.shift(); if (!t) return false; now = t.at; t.f(); return true; };
    return {p, log, tick, timers};
  }

  it('steps photo by photo on wall-clock time and stops at the end', () => {
    const {p, log, tick} = run([350, 900, 1800]);
    p.start();
    while (tick()) { /* run all timers */ }
    expect(log).toEqual(['play @0', 'step 1 @350', 'step 2 @1250', 'step 3 @3050', 'stop (end) @3050']);
    expect(p.playing).toBe(false);
  });

  it('absorbs late timers: 30 fps-like lateness does not stretch the trip', () => {
    const {p, log, tick} = run([900, 900, 900], 30);
    p.start();
    while (tick()) { /* */ }
    // Deadlines 900, 1800, 2700: each fires 30 ms late, but the next is scheduled from the deadline.
    expect(log.slice(1, 4)).toEqual(['step 1 @930', 'step 2 @1830', 'step 3 @2730']);
  });

  it('stops at once (hidden page, map covered) and drops its timer', () => {
    const {p, log, tick, timers} = run([900, 900]);
    p.start();
    tick();
    p.stop();
    expect(timers).toEqual([]);
    expect(log).toEqual(['play @0', 'step 1 @900', 'stop @900']);
    p.stop();
    expect(log.length).toBe(3);
  });

  it('gives each photo its dwell after a stall', () => {
    const {p, log, tick} = run([900, 900, 900], 5000);
    p.start();
    while (tick()) { /* */ }
    // Each timer fires 5 s late; the next is then scheduled a full dwell later, never at once.
    expect(log.slice(1, 4)).toEqual(['step 1 @5900', 'step 2 @11800', 'step 3 @17700']);
  });
});

describe('labels', () => {
  it('drops the dates and folder prefix from a trip album name', () => {
    expect(tripName('San Sebastián to Huesca, 6–10 Sep 2024')).toBe('San Sebastián to Huesca');
    expect(tripName('Pamplona & Basque Country, 2–12 Aug 2024')).toBe('Pamplona & Basque Country');
    expect(tripName('2024_08_Pamplona')).toBe('Pamplona');
    expect(tripName('Lyon, France')).toBe('Lyon, France');
    expect(tripName('Rome')).toBe('Rome');
  });
  it('formats a day range compactly', () => {
    const d = (y: number, m: number, day: number) => Date.UTC(y, m - 1, day);
    expect(fDayRange(d(2024, 9, 6), d(2024, 9, 10))).toMatch(/^6–10 Sept? 2024$/);
    expect(fDayRange(d(2024, 8, 30), d(2024, 9, 2))).toMatch(/^30 Aug – 2 Sept? 2024$/);
    expect(fDayRange(d(2024, 12, 30), d(2025, 1, 2))).toBe('30 Dec 2024 – 2 Jan 2025');
    expect(fDayRange(d(2024, 9, 6), d(2024, 9, 6))).toMatch(/^6 Sept? 2024$/);
  });
});

describe('shareLink', () => {
  const url = 'https://demo.example/?album=x';
  it('uses the share sheet when there is one', async () => {
    const share = vi.fn(async () => {});
    expect(await shareLink(url, 't', {share, canShare: () => true})).toBe('shared');
    expect(share).toHaveBeenCalledWith({title: 't', url});
  });
  it('does nothing more when the visitor closes the sheet', async () => {
    const writeText = vi.fn(async () => {});
    const share = async () => { throw Object.assign(new Error('x'), {name: 'AbortError'}); };
    expect(await shareLink(url, 't', {share, clipboard: {writeText}})).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });
  it('copies the link without a share sheet, or when sharing is refused', async () => {
    const writeText = vi.fn(async () => {});
    expect(await shareLink(url, 't', {clipboard: {writeText}})).toBe('copied');
    const share = async () => { throw Object.assign(new Error('x'), {name: 'NotAllowedError'}); };
    expect(await shareLink(url, 't', {share, clipboard: {writeText}})).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(url);
  });
  it('fails when neither works (some in-app browsers): the caller shows the link', async () => {
    expect(await shareLink(url, 't', {})).toBe('failed');
    expect(await shareLink(url, 't', {clipboard: {writeText: async () => { throw new Error('denied'); }}})).toBe('failed');
  });
});
