import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  countRows, DAY, daysFromIndex, daysFromMonths, defaultView, dens, dragTo, hitGrip, packLanes, railAlbums, sample,
  smooth, snapDay, sumRange, viewAround, viewToShow, zoomAt, albumLabel,
} from '../web/src/lib/overview/data.ts';
import {withLookup, type IndexColumns} from '../web/src/lib/index/model.ts';
import {selection, selectionFromUrl, selectionToQuery, writeUrl, type Selection} from '../web/src/lib/selection.svelte.ts';
import type {AlbumSummary} from '../shared/api.ts';

const D = (s: string) => Date.parse(s + 'T00:00:00Z');
const H = 3600e3;

/** Rows: [UTC ISO instant, offset hours, video, gps]; sorted by t like the real index. */
function ix(rows: [string, number, 0 | 1, 0 | 1][]): IndexColumns {
  const n = rows.length, t = rows.map(r => Date.parse(r[0]));
  return withLookup({
    n, id: rows.map((_, i) => 'a' + i), t: Float64Array.from(t), off: Float32Array.from(rows.map(r => r[1])),
    video: Uint8Array.from(rows.map(r => r[2])), dur: new Float64Array(n), gps: Uint8Array.from(rows.map(r => r[3])),
    lat: Float64Array.from(rows.map(r => (r[3] ? 1 : NaN))), lon: Float64Array.from(rows.map(r => (r[3] ? 1 : NaN))),
    thumbhash: new Array(n).fill(null), ratio: new Float32Array(n).fill(1), city: new Array(n).fill(null), country: new Array(n).fill(null),
  });
}

describe('daysFromIndex', () => {
  const NOW = D('2024-03-10');
  const lib = ix([
    ['2023-05-01T22:30:00Z', 3, 0, 1],   // local 2023-05-02 01:30 → day 2 May
    ['2023-05-02T10:00:00Z', 3, 1, 0],
    ['2023-05-02T23:00:00Z', -5, 0, 0],  // local 2023-05-02 18:00
    ['2024-01-01T00:00:00Z', 0, 0, 1],
  ]);
  const h = daysFromIndex(lib, NOW)!;

  it('starts at Jan 1 of the first year and runs to the day after max(last, now)', () => {
    expect(h.t0).toBe(D('2023-01-01'));
    expect(h.t0 + h.nd * DAY).toBe(D('2024-03-11'));
  });

  it('buckets by local calendar day, photos and videos apart', () => {
    const k = (D('2023-05-02') - h.t0) / DAY;
    expect([h.photo[k], h.video[k]]).toEqual([2, 1]);
    expect(h.photo[k - 1] + h.video[k - 1]).toBe(0);
    expect(h.sq).toBeCloseTo(Math.sqrt(3));
  });

  it('prefix sums answer dens / sumRange', () => {
    expect(sumRange(h, D('2023-05-01'), D('2023-05-03'))).toEqual([2, 1]);
    expect(sumRange(h, D('2020-01-01'), D('2030-01-01'))).toEqual([3, 1]);
    expect(dens(h, D('2023-05-02') + 2 * H, D('2023-05-02') + 3 * H)).toEqual([2, 1]); // sub-day: that day's counts
    expect(dens(h, D('2023-05-01'), D('2023-05-05'))).toEqual([0.5, 0.25]);            // mean over 4 days
    expect(dens(h, D('2000-01-01'), D('2000-01-01') + H)).toEqual([0, 0]);
  });

  it('is null for an empty index', () => expect(daysFromIndex(ix([]))).toBeNull());

  it('handles 30k rows quickly', () => {
    const n = 30000, t0 = D('2008-01-01'), span = D('2026-10-01') - t0;
    const rows: [string, number, 0 | 1, 0 | 1][] = [];
    for (let i = 0; i < n; i++) rows.push([new Date(t0 + (span * i) / n).toISOString(), 2, (i % 7 === 0 ? 1 : 0), 1]);
    const big = ix(rows), s = performance.now();
    const hh = daysFromIndex(big, D('2026-10-13'))!;
    const p = sample(hh, hh.t0, hh.t0 + hh.nd * DAY, 1600);
    expect(performance.now() - s).toBeLessThan(100);
    expect(sumRange(hh, hh.t0, hh.t0 + hh.nd * DAY).reduce((a, b) => a + b)).toBe(n);
    expect(p.I.length).toBe(1600);
  });
});

describe('daysFromMonths (provisional)', () => {
  it('spreads each month over its days as photos', () => {
    const h = daysFromMonths([{month: '2024-02', count: 29}, {month: '2024-04', count: 300}, {month: 'junk', count: 5}], D('2024-04-10'))!;
    expect(h.t0).toBe(D('2024-01-01'));
    expect(h.photo[(D('2024-02-10') - h.t0) / DAY]).toBeCloseTo(1);
    expect(h.photo[(D('2024-04-30') - h.t0) / DAY]).toBeCloseTo(10);
    expect(h.t0 + h.nd * DAY).toBe(D('2024-05-01'));
    expect(sumRange(h, h.t0, D('2025-01-01'))).toEqual([expect.closeTo(329), 0]);
  });
  it('is null without counts', () => expect(daysFromMonths([])).toBeNull());
});

describe('sample / smooth', () => {
  it('smooth keeps constants and spreads a spike with 1-2-3-2-1 weights', () => {
    expect([...smooth(Float32Array.from([4, 4, 4, 4]))]).toEqual([4, 4, 4, 4]);
    const s = smooth(Float32Array.from([0, 0, 9, 0, 0]));
    expect(s[2]).toBeCloseTo(9 * 3 / 9);
    expect(s[0]).toBeCloseTo(9 * 1 / 6);
  });
  it('one sample per pixel; no smoothing when zoomed in under 8 h/px', () => {
    const h = daysFromIndex(ix([['2024-01-05T12:00:00Z', 0, 0, 0]]), D('2024-01-10'))!;
    const {I} = sample(h, D('2024-01-01'), D('2024-01-09'), 64); // 3 h/px
    expect(I.length).toBe(64);
    expect(I.filter(v => v > 0).length).toBe(8); // exactly the 8 pixels of 5 Jan
  });
});

describe('countRows', () => {
  it('counts photos, videos and GPS over row ranges', () => {
    const l = ix([['2024-01-01T00:00:00Z', 0, 0, 1], ['2024-01-02T00:00:00Z', 0, 1, 1], ['2024-01-03T00:00:00Z', 0, 0, 0]]);
    expect(countRows(l, 0, 3)).toEqual({photos: 2, videos: 1, gps: 2});
    expect(countRows(l, 1, 3)).toEqual({photos: 1, videos: 1, gps: 1});
    expect(countRows(l, 2, 99)).toEqual({photos: 1, videos: 0, gps: 0});
  });
});

describe('album rail', () => {
  const al = (id: string, s: string, e: string, name = id): AlbumSummary => ({id, name, start: D(s), end: D(e), count: 5, shared: false, version: 'v'});
  const albums = [al('long', '2023-01-01', '2023-12-31'), al('trip', '2023-06-01', '2023-06-10'), {...al('empty', '2023-01-01', '2023-01-01'), start: null, end: null, count: 0}, al('a', '2023-02-01', '2023-03-17')];
  it('trips only (≤45 d) by default, all on request, oldest first, empties never', () => {
    expect(railAlbums(albums, false).map(a => a.id)).toEqual(['a', 'trip']);
    expect(railAlbums(albums, true).map(a => a.id)).toEqual(['long', 'a', 'trip']);
  });
  it('labels drop folder prefixes', () => {
    expect(albumLabel('2025-09_Kyrgyzstan')).toBe('Kyrgyzstan');
    expect(albumLabel('2023_Camera')).toBe('Camera');
    expect(albumLabel('Paris')).toBe('Paris');
  });
  it('packs into lanes, squeezing what does not fit', () => {
    const p = packLanes([{x0: 0, x1: 50}, {x0: 20, x1: 60}, {x0: 30, x1: 40}, {x0: 70, x1: 90}], 2);
    expect(p.map(q => [q.lane, q.squeezed])).toEqual([[0, false], [1, false], [0, true], [0, false]]);
  });
});

describe('viewport', () => {
  const lo = D('2010-01-01'), hi = D('2026-10-14');
  it('default = last 12 months', () => expect(defaultView(lo, hi)).toEqual([hi - 365 * DAY, hi]));
  it('viewAround: ≥120 days or 8× the span, centered, clamped', () => {
    const v = viewAround(D('2020-06-01'), D('2020-06-11'), lo, hi);
    expect(v[1] - v[0]).toBe(120 * DAY);
    expect((v[0] + v[1]) / 2).toBe(D('2020-06-06'));
    expect(viewAround(D('2020-01-01'), D('2020-03-01'), lo, hi)[1] - viewAround(D('2020-01-01'), D('2020-03-01'), lo, hi)[0]).toBe(60 * DAY * 8);
    expect(viewAround(hi - 5 * DAY, hi, lo, hi)[1]).toBe(hi);
  });
  it('viewToShow keeps the view when visible, pans minimally otherwise, recenters when too wide', () => {
    const v: [number, number] = [D('2024-01-01'), D('2025-01-01')];
    expect(viewToShow(v, D('2024-03-01'), D('2024-03-05'), lo, hi)).toBe(v);
    const p = viewToShow(v, D('2025-01-10'), D('2025-01-12'), lo, hi);
    expect(p[1] - p[0]).toBe(v[1] - v[0]);
    expect(p[1]).toBeGreaterThanOrEqual(D('2025-01-12'));
    expect(p[0]).toBeLessThanOrEqual(D('2025-01-10'));
    const w = viewToShow(v, D('2018-01-01'), D('2020-01-01'), lo, hi);
    expect(w[1] - w[0]).toBe(730 * DAY * 8 > hi - lo ? hi - lo : 730 * DAY * 8);
  });
  it('zoomAt keeps the time under the pointer fixed and clamps span', () => {
    const v: [number, number] = [D('2024-01-01'), D('2025-01-01')];
    const t = D('2024-07-01'), f = (t - v[0]) / (v[1] - v[0]), z = zoomAt(v, t, f, 0.5, lo, hi);
    expect(z[0] + f * (z[1] - z[0])).toBeCloseTo(t, -3);
    expect(zoomAt(v, t, f, 1e-6, lo, hi)[1] - zoomAt(v, t, f, 1e-6, lo, hi)[0]).toBe(7 * DAY);
    expect(zoomAt(v, t, f, 1e6, lo, hi)).toEqual([lo, hi]);
  });
});

describe('brush', () => {
  const lo = D('2024-01-01'), hi = D('2025-01-01');
  it('hit-tests edges, middle and outside', () => {
    expect(hitGrip(100, 100, 200)).toBe('l');
    expect(hitGrip(195, 100, 200)).toBe('r');
    expect(hitGrip(150, 100, 200)).toBe('m');
    expect(hitGrip(50, 100, 200)).toBe('n');
  });
  it('creates from the press point either way, snapped to days, at least a day', () => {
    const a = D('2024-03-10') + 3 * H;
    expect(dragTo('n', a, D('2024-03-14') + 15 * H, [a, a], lo, hi, DAY, snapDay).span).toEqual([D('2024-03-10'), D('2024-03-15')]);
    expect(dragTo('n', a, D('2024-03-07') + 1 * H, [a, a], lo, hi, DAY, snapDay).span).toEqual([D('2024-03-07'), D('2024-03-10')]);
    expect(dragTo('n', a, a + H, [a, a], lo, hi, DAY, snapDay).span).toEqual([D('2024-03-10'), D('2024-03-11')]);
  });
  it('moves keeping the width, clamped to the bounds', () => {
    const cur: [number, number] = [D('2024-03-10'), D('2024-03-15')];
    expect(dragTo('m', 2 * DAY, D('2024-04-02'), cur, lo, hi, DAY, snapDay).span).toEqual([D('2024-03-31'), D('2024-04-05')]);
    expect(dragTo('m', 2 * DAY, D('2024-12-31'), cur, lo, hi, DAY, snapDay).span).toEqual([hi - 5 * DAY, hi]);
  });
  it('resizes an edge; crossing the other edge swaps the grip', () => {
    const cur: [number, number] = [D('2024-03-10'), D('2024-03-15')];
    expect(dragTo('r', 0, D('2024-03-20'), cur, lo, hi, DAY, snapDay)).toEqual({span: [D('2024-03-10'), D('2024-03-20')], grip: 'r'});
    expect(dragTo('l', 0, D('2024-03-20'), cur, lo, hi, DAY, snapDay)).toEqual({span: [D('2024-03-15'), D('2024-03-20')], grip: 'r'});
    expect(dragTo('l', 0, D('2024-03-15'), cur, lo, hi, DAY, snapDay).span).toEqual([D('2024-03-14'), D('2024-03-15')]);
  });
});

describe('URL', () => {
  const albums = [{id: 'alb', start: D('2024-05-01') + 5 * H, end: D('2024-05-09') + 7 * H}];
  it('range round-trips through from/to (UTC days, to inclusive)', () => {
    const sel: Selection = {kind: 'range', t0: D('2026-08-01'), t1: D('2026-08-31')};
    const q = selectionToQuery(sel, null, new URLSearchParams('x=1&at=5&mode=range'));
    expect(q.toString()).toBe('x=1&from=2026-08-01&to=2026-08-30');
    expect(selectionFromUrl(q, [])).toEqual(sel);
  });
  it('album round-trips; mode only when range; at only inside the selection', () => {
    const sel = selectionFromUrl(new URLSearchParams('album=alb'), albums) as Extract<Selection, {kind: 'album'}>;
    expect(sel).toEqual({kind: 'album', albumId: 'alb', mode: 'members', t0: albums[0].start, t1: albums[0].end + 1});
    const at = D('2024-05-03');
    expect(selectionToQuery(sel, at).toString()).toBe(`album=alb&at=${at}`);
    expect(selectionToQuery({...sel, mode: 'range'}, D('2024-06-01')).toString()).toBe('album=alb&mode=range');
    expect(selectionFromUrl(selectionToQuery({...sel, mode: 'range'}, null), albums)).toEqual({...sel, mode: 'range'});
  });
  it('no selection clears the keys', () => {
    expect(selectionToQuery(null, 5, new URLSearchParams('from=2024-01-01&to=2024-01-02&at=5&q=1')).toString()).toBe('q=1');
  });
});

describe('writeUrl history', () => {
  /** Minimal location/history: entries + index, enough for replaceState/pushState. */
  function fakeHistory(start: string) {
    const entries = [{href: start, state: null as unknown}];
    let i = 0;
    const loc = () => new URL(entries[i].href);
    const history = {
      get state() { return entries[i].state; },
      replaceState: vi.fn((state: unknown, _: string, url: string) => { entries[i] = {href: new URL(url, entries[i].href).href, state}; }),
      pushState: vi.fn((state: unknown, _: string, url: string) => { entries.splice(i + 1); entries.push({href: new URL(url, entries[i].href).href, state}); i++; }),
    };
    const location = {get href() { return loc().href; }, get search() { return loc().search; }, get pathname() { return loc().pathname; }, get hash() { return loc().hash; }};
    vi.stubGlobal('history', history); vi.stubGlobal('location', location);
    return {entries, history, at: () => i};
  }
  afterEach(() => { vi.unstubAllGlobals(); selection.sel = null; vi.useRealTimers(); });

  it('a drag replaces live and commits as one push from the starting entry', () => {
    vi.useFakeTimers();
    const h = fakeHistory('http://x/?q=1&at=123');
    selection.sel = {kind: 'range', t0: D('2024-01-01'), t1: D('2024-01-03')};
    writeUrl('live');
    selection.sel = {kind: 'range', t0: D('2024-01-01'), t1: D('2024-01-04')};
    writeUrl('live'); // throttled
    vi.advanceTimersByTime(300);
    selection.sel = {kind: 'range', t0: D('2024-01-01'), t1: D('2024-01-05')};
    writeUrl('live');
    expect(h.history.replaceState).toHaveBeenCalledTimes(2);
    expect(h.history.pushState).not.toHaveBeenCalled();
    writeUrl('commit');
    expect(h.entries.map(e => e.href)).toEqual(['http://x/?q=1&at=123', 'http://x/?q=1&from=2024-01-01&to=2024-01-04']);
    expect(h.at()).toBe(1);
  });

  it('commit without change pushes nothing; keeps an at inside the selection; sets it when given', () => {
    const at = D('2024-01-02');
    const h = fakeHistory(`http://x/?from=2024-01-01&to=2024-01-04&at=${at}`);
    selection.sel = {kind: 'range', t0: D('2024-01-01'), t1: D('2024-01-05')};
    writeUrl('commit');
    expect(h.history.pushState).not.toHaveBeenCalled();
    writeUrl('commit', at + H);
    expect(h.entries.at(-1)!.href).toBe(`http://x/?from=2024-01-01&to=2024-01-04&at=${at + H}`);
    expect(h.entries.length).toBe(2);
  });
});
