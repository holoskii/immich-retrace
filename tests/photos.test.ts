// The Photos tab's pure logic: local-day grouping, the grid layout and its virtual range, scrolling to the cursor,
// and the thumbnail set (queue priority, cancelling rows scrolled away, the object URL cap).
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {AssetColumns} from '../shared/api.ts';
import {buildIndex} from '../web/src/lib/index/model.ts';
import {centerOn, gridColumns, groupDays, layoutGrid, requestRows, reveal, rowOf, visibleRows, type Layout} from '../web/src/lib/mobile/grid.ts';
import {ThumbSet} from '../web/src/lib/mobile/thumbs.ts';
import {loadedThumb, MediaQueue} from '../web/src/lib/lightbox/media.ts';

const H = 3600e3, D = 86400e3, T0 = Date.UTC(2024, 8, 6);

/** Rows as [hours after T0 (UTC), local offset h]. */
function index(rows: [number, number][]) {
  const c: AssetColumns = {id: [], t: [], off: [], video: [], dur: [], lat: [], lon: [], thumbhash: [], ratio: [], city: [], country: []};
  rows.forEach(([h, off], i) => {
    c.id.push(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    c.t.push(T0 + h * H); c.off.push(off); c.video.push(0); c.dur.push(0);
    c.lat.push(null); c.lon.push(null); c.thumbhash.push(null); c.ratio.push(1); c.city.push(null); c.country.push(null);
  });
  return buildIndex([c]);
}

describe('groupDays', () => {
  it('cuts rows by the local calendar day each was taken on (its own offset), in time order', () => {
    // 21:30 UTC at +2 is 23:30 local (day 1); 22:30 UTC at +2 is 00:30 local (day 2).
    const ix = index([[8, 2], [21.5, 2], [22.5, 2], [30, 2], [50, 2]]);
    expect(groupDays(ix, 0, ix.n)).toEqual([
      {day: T0, lo: 0, hi: 2}, {day: T0 + D, lo: 2, hi: 4}, {day: T0 + 2 * D, lo: 4, hi: 5},
    ]);
    expect(groupDays(ix, 1, 3)).toEqual([{day: T0, lo: 1, hi: 2}, {day: T0 + D, lo: 2, hi: 3}]);
    expect(groupDays(ix, 2, 2)).toEqual([]);
  });
  it('keeps time order across an offset change, even when a local day comes back', () => {
    // Flying west across midnight: 23:00 at +2, then 22:30 at −1 on the same UTC evening is the previous local day.
    const ix = index([[21, 2], [22.5, 2], [23.5, -1]]);
    expect(groupDays(ix, 0, ix.n).map(d => [d.day, d.lo, d.hi])).toEqual([[T0, 0, 1], [T0 + D, 1, 2], [T0, 2, 3]]);
  });
});

describe('grid layout', () => {
  // 7 + 3 + 1 photos on three days; 302 px wide → 3 columns of 99.33 px, 2 px gaps.
  const days = [{day: T0, lo: 0, hi: 7}, {day: T0 + D, lo: 7, hi: 10}, {day: T0 + 2 * D, lo: 10, hi: 11}];
  const L = layoutGrid(days, 302, {gap: 2, head: 36, pad: 12});
  const step = L.cell + 2;

  it('picks 3 columns on a phone upright and more in landscape', () => {
    expect(gridColumns(360)).toBe(3);
    expect(gridColumns(430)).toBe(3);
    expect(gridColumns(844)).toBe(6);
    expect(gridColumns(2000)).toBe(7);
  });

  it('stacks a header and square-cell rows per day', () => {
    expect(L.cols).toBe(3);
    expect(L.cell).toBeCloseTo(298 / 3);
    expect([...L.rowLo]).toEqual([0, 3, 6, 7, 10]);
    expect([...L.rowDay]).toEqual([0, 0, 0, 1, 2]);
    expect(L.days.map(d => [d.y, d.r0, d.r1])).toEqual([[0, 0, 3], [36 + 3 * step, 3, 4], [72 + 4 * step, 4, 5]]);
    expect(L.rowY[0]).toBe(36);
    expect(L.rowY[3]).toBeCloseTo(L.days[1].y + 36);
    expect(L.days[0].h).toBeCloseTo(36 + 3 * step);
    expect(L.height).toBe(Math.ceil(108 + 5 * step + 12));
  });

  it('finds the grid row of an asset row', () => {
    expect([0, 2, 3, 6, 7, 9, 10].map(r => rowOf(L, r))).toEqual([0, 0, 1, 2, 3, 3, 4]);
    expect(rowOf(L, 11)).toBe(-1);
    expect(rowOf(layoutGrid([], 302), 0)).toBe(-1);
  });

  it('gives the grid rows overlapping a band of the content', () => {
    expect(visibleRows(L, 0, 36)).toEqual([0, 0]); // only the first header
    expect(visibleRows(L, 0, 37)).toEqual([0, 1]);
    expect(visibleRows(L, 36 + step, 36 + step + 1)).toEqual([1, 2]);
    expect(visibleRows(L, -500, 1e6)).toEqual([0, 5]);
    expect(visibleRows(L, 1e6, 2e6)).toEqual([5, 5]);
    // A row just scrolled past the top is out.
    expect(visibleRows(L, 36 + L.cell, 36 + L.cell + 10)[0]).toBe(1);
  });

  it('stays cheap and bounded for a large selection', () => {
    const big = Array.from({length: 600}, (_, i) => ({day: T0 + i * D, lo: i * 50, hi: i * 50 + 50}));
    const t = performance.now(), B = layoutGrid(big, 390);
    expect(performance.now() - t).toBeLessThan(50);
    const [a, b] = visibleRows(B, 200_000 - 600, 200_000 + 800 + 600);
    expect((b - a) * B.cols).toBeLessThanOrEqual(60);
  });
});

describe('requestRows', () => {
  it('asks for the on-screen rows first, then the rendered ones nearest first, below before above', () => {
    expect(requestRows(4, 7, 1, 10)).toEqual([4, 5, 6, 7, 3, 8, 2, 9, 1]);
  });

  it('nothing rendered past the screen: just the on-screen rows', () => {
    expect(requestRows(4, 7, 4, 7)).toEqual([4, 5, 6]);
  });
});

describe('scrolling to the cursor', () => {
  // 30 photos on one day, 3 columns: rows 36 + i·(cell+gap).
  const L: Layout = layoutGrid([{day: T0, lo: 0, hi: 30}], 302, {gap: 2, head: 36, pad: 12});
  const step = L.cell + 2, viewH = 400;

  it('centres the cursor cell in the part the sticky header leaves visible, clamped to the content', () => {
    const y = centerOn(L, 15, viewH); // row 5
    const mid = L.rowY[5] + L.cell / 2;
    expect(Math.abs(mid - y - (36 + (viewH - 36) / 2))).toBeLessThanOrEqual(0.5);
    expect(centerOn(L, 0, viewH)).toBe(0);
    expect(centerOn(L, 29, viewH)).toBe(L.height - viewH);
    expect(centerOn(L, 99, viewH)).toBe(0);
    // Content shorter than the viewport: never scrolls.
    expect(centerOn(layoutGrid([{day: T0, lo: 0, hi: 2}], 302), 1, viewH)).toBe(0);
  });

  it('leaves the scroll alone while the cell is wholly visible, else moves it just into view', () => {
    const top = 2 * step; // rows 2.. are below the header
    expect(reveal(L, 6, top, viewH)).toBe(top); // row 2, visible
    expect(reveal(L, 0, 0, viewH)).toBe(0);
    // Above the view (under the header): its top goes just below the header.
    expect(reveal(L, 0, top, viewH)).toBe(0);
    expect(reveal(L, 3, 4 * step, viewH)).toBe(Math.round(L.rowY[1] - 36 - 2));
    // Below: its bottom to the bottom edge.
    const r = 27, y = reveal(L, r, 0, viewH);
    expect(y).toBe(Math.min(L.height - viewH, Math.round(L.rowY[9] + L.cell + 2 - viewH)));
    expect(reveal(L, 99, top, viewH)).toBe(top);
    // Half under the header, or cut off at the bottom: moved.
    expect(reveal(L, 3, L.rowY[1] - 36 + L.cell / 2, viewH)).toBe(Math.round(L.rowY[1] - 38));
    const cut = Math.round(L.rowY[3] + L.cell / 2 - viewH);
    expect(reveal(L, 9, cut, viewH)).toBe(Math.round(L.rowY[3] + L.cell + 2 - viewH));
  });
});

describe('ThumbSet', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const flush = () => vi.advanceTimersByTimeAsync(0);

  function setup(concurrency = 2, max = 180) {
    const calls: {url: string; signal?: AbortSignal; ok: () => void; fail: () => void}[] = [];
    const f = ((url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      const signal = init?.signal ?? undefined;
      signal?.addEventListener('abort', () => reject(signal.reason));
      calls.push({url, signal, ok: () => resolve(new Response('x')), fail: () => resolve(new Response(null, {status: 500}))});
    })) as typeof fetch;
    const q = new MediaQueue({concurrency, window: () => null, fetch: f});
    let n = 0, changes = 0;
    const revoked: string[] = [];
    const set = new ThumbSet(q, () => changes++, max, {create: () => `blob:${++n}`, revoke: u => { revoked.push(u); }});
    return {set, calls, revoked, changes: () => changes};
  }

  it('lends its loaded thumbnails to the lightbox (loadedThumb), with no request, until disposed', async () => {
    const {set, calls} = setup();
    set.want(['grid-a', 'grid-b']);
    await flush();
    expect(loadedThumb('grid-a')).toBeNull(); // still loading: the lightbox keeps the thumbhash
    calls[0].ok(); await flush();
    const n = calls.length;
    expect(loadedThumb('grid-a')).toBe(set.get('grid-a'));
    expect(loadedThumb('grid-a')).toMatch(/^blob:/);
    expect(loadedThumb('elsewhere')).toBeNull();
    expect(calls.length).toBe(n);
    set.dispose();
    expect(loadedThumb('grid-a')).toBeNull();
  });

  it('loads the on-screen cells first, then the overscan', async () => {
    const {set, calls} = setup(1);
    set.want(['o1'], 0); // overscan, asked for earlier
    set.want(['v1', 'v2', 'o1'], 2);
    await flush();
    calls[0].ok(); await flush(); // o1 had started already
    calls[1].ok(); await flush();
    calls[2].ok(); await flush();
    expect(calls.map(c => c.url)).toEqual(['o1', 'v1', 'v2']);
    expect(set.get('v1')).toMatch(/^blob:/);
  });

  it('moves an overscan cell that came on screen ahead of the rest', async () => {
    const {set, calls} = setup(1);
    set.want(['a', 'b', 'c', 'd'], 1);
    await flush();
    expect(calls.map(c => c.url)).toEqual(['a']);
    set.want(['d', 'a', 'b', 'c'], 1); // scrolled: d is on screen now
    calls[0].ok(); await flush();
    expect(calls.map(c => c.url)).toEqual(['a', 'd']);
  });

  it('prune cancels what is no longer wanted without starting anything', async () => {
    const {set, calls} = setup(1);
    set.want(['a', 'b']);
    await flush();
    set.prune(['b', 'c']);
    await flush();
    expect(calls[0].signal?.aborted).toBe(true);
    expect(calls.map(c => c.url)).toEqual(['a', 'b']); // b started after a was cancelled; c never asked for
    expect(set.size).toBe(1);
  });

  it('cancels requests for cells scrolled away, keeps loaded ones', async () => {
    const {set, calls, revoked} = setup(2);
    set.want(['a', 'b', 'c']);
    await flush();
    calls[0].ok(); await flush();
    expect(calls.map(c => c.url)).toEqual(['a', 'b', 'c']);
    set.want(['x']);
    await flush();
    expect(calls[1].signal?.aborted).toBe(true); // b, in flight
    expect(calls[2].signal?.aborted).toBe(true); // c
    expect(set.get('a')).toBe('blob:1'); // loaded: kept for scrolling back
    expect(revoked).toEqual([]);
    expect(set.size).toBe(2);
    set.want(['a', 'x']);
    await flush();
    expect(calls.filter(c => c.url === 'a')).toHaveLength(1);
  });

  it('holds at most `max` loaded thumbnails, dropping the least recently wanted, never a wanted one', async () => {
    const {set, calls, revoked} = setup(6, 3);
    for (const u of ['a', 'b', 'c', 'd']) { set.want([u]); await flush(); calls.at(-1)!.ok(); await flush(); }
    expect(revoked).toEqual(['blob:1']);
    expect(set.get('a')).toBeNull();
    set.want(['b']); // b is recent again
    set.want(['e']); await flush(); calls.at(-1)!.ok(); await flush();
    expect(revoked).toEqual(['blob:1', 'blob:3']); // c went, not b
    expect(set.get('b')).toBe('blob:2');
    set.dispose();
    expect(set.size).toBe(0);
  });

  it('keeps a failure while the cell is wanted and tries again after it scrolled away', async () => {
    const {set, calls, changes} = setup(2);
    set.want(['a']);
    await flush();
    calls[0].fail(); await flush();
    expect(changes()).toBe(1);
    set.want(['a']);
    await flush();
    expect(calls).toHaveLength(1);
    set.want([]);
    set.want(['a']);
    await flush();
    expect(calls).toHaveLength(2);
  });
});
