import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  countRows, DAY, daysFromIndex, daysFromMonths, defaultView, dens, dragTo, hitGrip, packLanes, railAlbums, sample,
  smooth, snapDay, sumRange, fLength, trimOutliers, viewAround, viewToShow, zoomAt, albumLabel,
} from '../web/src/lib/overview/data.ts';
import {withLookup, type IndexColumns} from '../web/src/lib/index/model.ts';
import {
  albumSpan, applyUrl, fromLocal, lightboxPending, selection, selectionFromUrl, selectionToQuery, toLocal, urlReady, writeUrl, type Selection,
} from '../web/src/lib/selection.svelte.ts';
import {library} from '../web/src/lib/index/store.svelte.ts';
import type {AlbumSummary} from '../shared/api.ts';
import {dayAround, fDays, zoomSpan} from '../web/src/lib/nav.ts';
import {shortAlbum} from '../web/src/lib/overview/trips.ts';

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

  it('starts at Jan 1 of the first year and runs to the day after the last item (today only while recent)', () => {
    expect(h.t0).toBe(D('2023-01-01'));
    expect(h.t0 + h.nd * DAY).toBe(D('2024-01-02'));
    expect(h.core).toEqual([h.t0, D('2024-01-02')]);
    const active = daysFromIndex(lib, D('2024-01-20'))!; // newest item 19 days old: the axis ends at today
    expect(active.t0 + active.nd * DAY).toBe(D('2024-01-21'));
  });

  it('buckets by local calendar day, with and without GPS apart', () => {
    const k = (D('2023-05-02') - h.t0) / DAY;
    expect([h.gps[k], h.nogps[k]]).toEqual([1, 2]);
    expect(h.gps[k - 1] + h.nogps[k - 1]).toBe(0);
    expect(h.sq).toBeCloseTo(Math.sqrt(3));
  });

  it('prefix sums answer dens / sumRange', () => {
    expect(sumRange(h, D('2023-05-01'), D('2023-05-03'))).toEqual([1, 2]);
    expect(sumRange(h, D('2020-01-01'), D('2030-01-01'))).toEqual([2, 2]);
    expect(dens(h, D('2023-05-02') + 2 * H, D('2023-05-02') + 3 * H)).toEqual([1, 2]); // sub-day: that day's counts
    expect(dens(h, D('2023-05-01'), D('2023-05-05'))).toEqual([0.25, 0.5]);            // mean over 4 days
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
    expect(h.gps[(D('2024-02-10') - h.t0) / DAY]).toBeCloseTo(1);
    expect(h.gps[(D('2024-04-30') - h.t0) / DAY]).toBeCloseTo(10);
    expect(h.t0 + h.nd * DAY).toBe(D('2024-05-01'));
    expect(sumRange(h, h.t0, D('2025-01-01'))).toEqual([expect.closeTo(329), 0]);
  });
  it('is null without counts', () => expect(daysFromMonths([])).toBeNull());
});

describe('default framing', () => {
  /** n items spread evenly over [from, to), all with GPS. */
  const spread = (from: string, to: string, n: number): [string, number, 0 | 1, 0 | 1][] =>
    Array.from({length: n}, (_, i) => [new Date(D(from) + (D(to) - D(from)) * i / n).toISOString(), 0, 0, 1]);
  const lib = (...parts: [string, number, 0 | 1, 0 | 1][][]) => ix(parts.flat().sort((a, b) => Date.parse(a[0]) - Date.parse(b[0])));
  const inView = (h: NonNullable<ReturnType<typeof daysFromIndex>>, v: [number, number]) => sumRange(h, v[0], v[1])[0];

  it('a tiny old library (2019, nothing since) opens on all of its photos, not on an empty today', () => {
    const h = daysFromIndex(lib(spread('2019-03-01', '2019-06-01', 12)), D('2026-10-13'))!;
    expect(h.t0 + h.nd * DAY).toBe(D('2019-05-25')); // last item 24 May 2019
    const v = defaultView(h);
    expect(v[1]).toBe(D('2019-05-25'));
    expect(v[0]).toBeLessThan(D('2019-03-01'));
    expect(inView(h, v)).toBe(12);
  });

  it('a 2008 outlier stays in the domain but not in the framing or the context strip', () => {
    const h = daysFromIndex(lib([['2008-07-01T10:00:00Z', 0, 0, 1]], spread('2021-01-10', '2026-10-01', 400)), D('2026-10-13'))!;
    expect(h.t0).toBe(D('2008-01-01'));
    expect(h.core).toEqual([D('2021-01-01'), D('2026-10-14')]); // active: ends today
    expect(h.first).toBe(D('2021-01-10'));
    const v = defaultView(h);
    expect(v).toEqual([D('2026-10-14') - 365 * DAY, D('2026-10-14')]);
    expect(inView(h, v)).toBeGreaterThan(50);
    expect(sumRange(h, h.t0, h.t0 + h.nd * DAY)[0]).toBe(401); // still counted, reachable via "All years"
  });

  it('a normal active library: nothing trimmed, the last 12 months up to today', () => {
    const h = daysFromIndex(lib(spread('2015-02-01', '2026-10-12', 3000)), D('2026-10-13'))!;
    expect(h.core).toEqual([h.t0, h.t0 + h.nd * DAY]);
    expect(defaultView(h)).toEqual([D('2025-10-14'), D('2026-10-14')]);
  });

  it('a fixed 2023–2026 set (the demo) lands on its photos whenever it is opened', () => {
    const rows = spread('2023-02-01', '2026-06-01', 900);
    for (const now of ['2026-06-15', '2027-01-01', '2040-01-01']) {
      const h = daysFromIndex(lib(rows), D(now))!, v = defaultView(h);
      expect(v[1]).toBeLessThanOrEqual(D('2026-07-01'));
      expect(v[1] - v[0]).toBe(365 * DAY);
      expect(inView(h, v)).toBeGreaterThan(200);
    }
  });

  it('trims a future clock at the end; keeps a modest early gap in a long library; keeps tiny libraries whole', () => {
    const future = daysFromIndex(lib(spread('2020-01-01', '2026-10-01', 300), [['2037-01-01T00:00:00Z', 0, 0, 1]]), D('2026-10-13'))!;
    expect(future.t0 + future.nd * DAY).toBe(D('2037-01-02'));
    expect(future.core[1]).toBe(D('2026-10-14'));
    expect(defaultView(future)[1]).toBe(D('2026-10-14'));
    // 20 years; 1% of photos two years before the bulk: a real era, not an outlier (gap < a quarter of the span).
    const long = daysFromIndex(lib(spread('2004-01-01', '2004-06-01', 30), spread('2006-06-01', '2026-10-01', 3000)), D('2026-10-13'))!;
    expect(long.core[0]).toBe(D('2004-01-01'));
    // 20 items with one from 1970: under 50 items nothing is trimmed.
    const tiny = daysFromIndex(lib([['1970-01-01T00:00:00Z', 0, 0, 1]], spread('2024-01-01', '2024-03-01', 19)), D('2024-03-05'))!;
    expect(tiny.core[0]).toBe(D('1970-01-01'));
  });

  it('trimOutliers: at most 2% of the weight per end, gap ≥ a year and ≥ a quarter of the rest', () => {
    const at = (ts: number[]) => (i: number) => D(String(ts[i]) + '-06-01');
    const ys = [1970, 2008, ...Array.from({length: 98}, (_, i) => 2020 + i * 6 / 98)].map(Math.floor);
    expect(trimOutliers(ys.length, at(ys), at(ys))).toEqual([2, 99]);
    const w = [1, 500, 500];
    expect(trimOutliers(3, at([2000, 2020, 2024]), at([2000, 2020, 2024]), i => w[i])).toEqual([1, 2]);
    expect(trimOutliers(3, at([2000, 2020, 2024]), at([2000, 2020, 2024]), i => [100, 500, 500][i])).toEqual([0, 2]); // 10%: not an outlier
  });

  it('provisional months trim the same way', () => {
    const months = [{month: '2008-03', count: 2}, ...Array.from({length: 36}, (_, i) => ({month: `${2023 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`, count: 40}))];
    const h = daysFromMonths(months, D('2030-01-01'))!;
    expect(h.t0).toBe(D('2008-01-01'));
    expect(h.core).toEqual([D('2023-01-01'), D('2026-01-01')]);
    expect(defaultView(h)).toEqual([D('2025-01-01'), D('2026-01-01')]);
  });
});

describe('sample / smooth', () => {
  it('smooth keeps constants and spreads a spike with 1-2-3-2-1 weights', () => {
    expect([...smooth(Float32Array.from([4, 4, 4, 4]))]).toEqual([4, 4, 4, 4]);
    const s = smooth(Float32Array.from([0, 0, 9, 0, 0]));
    expect(s[2]).toBeCloseTo(9 * 3 / 9);
    expect(s[0]).toBeCloseTo(9 * 1 / 6);
  });
  it('one sample per pixel; no smoothing when zoomed in under 8 h/px', () => {
    const h = daysFromIndex(ix([['2024-01-05T12:00:00Z', 0, 0, 1]]), D('2024-01-10'))!;
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
  it('filtered on request (here: ≤45 d), else all, oldest first, empties never', () => {
    expect(railAlbums(albums, shortAlbum).map(a => a.id)).toEqual(['a', 'trip']);
    expect(railAlbums(albums).map(a => a.id)).toEqual(['long', 'a', 'trip']);
  });
  it('labels drop folder prefixes', () => {
    expect(albumLabel('2025_09_Kyrgyzstan')).toBe('Kyrgyzstan');
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
  // Immich album dates: local calendar days, midnight read as UTC.
  const albums = [{id: 'alb', start: D('2024-05-01'), end: D('2024-05-09')}];
  it('range round-trips through from/to (days, to inclusive)', () => {
    const sel: Selection = {kind: 'range', t0: D('2026-08-01'), t1: D('2026-08-31')};
    const q = selectionToQuery(sel, null, new URLSearchParams('x=1&at=5&mode=range'));
    expect(q.toString()).toBe('x=1&from=2026-08-01&to=2026-08-30');
    expect(selectionFromUrl(q, [])).toEqual(sel);
  });
  it('album round-trips; mode only when range; at only inside the selection', () => {
    const sel = selectionFromUrl(new URLSearchParams('album=alb'), albums) as Extract<Selection, {kind: 'album'}>;
    // The span runs through the end of the album's last day.
    expect(sel).toEqual({kind: 'album', albumId: 'alb', mode: 'members', t0: D('2024-05-01'), t1: D('2024-05-10')});
    const at = D('2024-05-03');
    expect(selectionToQuery(sel, at).toString()).toBe(`album=alb&at=${at}`);
    expect(selectionToQuery(sel, D('2024-05-09') + 23 * H).toString()).toBe(`album=alb&at=${D('2024-05-09') + 23 * H}`);
    expect(selectionToQuery({...sel, mode: 'range'}, D('2024-06-01')).toString()).toBe('album=alb&mode=range');
    expect(selectionFromUrl(selectionToQuery({...sel, mode: 'range'}, null), albums)).toEqual({...sel, mode: 'range'});
  });
  it('an album narrowed by a zoom keeps its days (sub)', () => {
    const sel: Selection = {kind: 'album', albumId: 'alb', mode: 'members', t0: D('2024-05-03'), t1: D('2024-05-05'), sub: true};
    const q = selectionToQuery(sel, null);
    expect(q.toString()).toBe('album=alb&from=2024-05-03&to=2024-05-04');
    expect(selectionFromUrl(q, albums)).toEqual(sel);
  });
  it('a sub-day span (cluster zoom) round-trips to the minute, to exclusive', () => {
    const sel: Selection = {kind: 'range', t0: D('2024-05-03') + 14 * H, t1: D('2024-05-04') + 18 * H};
    const q = selectionToQuery(sel, null);
    expect(q.toString()).toBe('from=2024-05-03T14%3A00Z&to=2024-05-04T18%3A00Z');
    expect(selectionFromUrl(q, [])).toEqual(sel);
    expect(selectionFromUrl(new URLSearchParams('from=2024-05-03T14:00&to=2024-05-04'), [])).toBeNull();
  });
  it('an album URL is ready once the album is listed, or once the list has loaded, even empty', () => {
    const q = new URLSearchParams('album=alb&at=5');
    expect(urlReady(q, false, albums, true)).toBe(false);
    expect(urlReady(q, true, [], false)).toBe(false);
    expect(urlReady(q, true, albums, false)).toBe(true);
    expect(urlReady(q, true, [], true)).toBe(true);
    expect(urlReady(new URLSearchParams('from=2024-05-01&to=2024-05-02'), true, [], false)).toBe(true);
  });
  it('an album that isn\'t there resolves to no selection and drops a pending lb', () => {
    vi.stubGlobal('location', {search: '?album=gone&lb=x'});
    try {
      applyUrl([]);
      expect([selection.sel, lightboxPending()]).toEqual([null, false]);
    } finally { vi.unstubAllGlobals(); }
  });
  it('no selection clears the keys', () => {
    expect(selectionToQuery(null, 5, new URLSearchParams('from=2024-01-01&to=2024-01-02&at=5&q=1')).toString()).toBe('q=1');
  });
});

describe('zoom stack', () => {
  it('zoomInto remembers selection and cursor; back restores them', async () => {
    const a: Selection = {kind: 'range', t0: D('2024-05-01'), t1: D('2024-05-10')}, b: Selection = {kind: 'range', t0: D('2024-05-03'), t1: D('2024-05-04')};
    await selection.select(a); selection.cursor = 7; selection.resetZoom();
    selection.zoomInto(b, 'Rome', 9);
    expect([selection.sel, selection.cursor, selection.zoomLabel, selection.stack.length]).toEqual([b, 9, 'Rome', 1]);
    expect(selection.back()).toBe(true);
    expect([selection.sel, selection.cursor, selection.zoomLabel, selection.stack.length]).toEqual([a, 7, null, 0]);
    expect(selection.back()).toBe(false);
  });
  it('a zoom from nothing selected returns to nothing', async () => {
    await selection.select(null); selection.resetZoom();
    selection.zoomInto({kind: 'range', t0: D('2024-05-03'), t1: D('2024-05-04')}, 'Rome', null);
    expect(selection.back()).toBe(true);
    expect([selection.sel, selection.stack.length]).toEqual([null, 0]);
  });
  it('the zoom span is whole hours, never reaching outside the parent (to the minute)', () => {
    const t = D('2024-05-03');
    expect(zoomSpan(t + 10 * H + 20 * 60e3, t + 12.5 * H, null)).toEqual([t + 10 * H, t + 13 * H]);
    // Parent 10:15:30 → 18:45:10 (an album's exact span): clamped to 10:15 / 18:46.
    expect(zoomSpan(t + 10 * H + 20 * 60e3, t + 18.7 * H, [t + 10.25 * H + 30e3, t + 18.75 * H + 10e3])).toEqual([t + 10.25 * H, t + 18.75 * H + 60e3]);
    expect(zoomSpan(t + 10 * H, t + 11 * H, [D('2024-05-01'), D('2024-05-10')])).toEqual([t + 10 * H, t + 12 * H]);
  });
  it('popstate onto the zoom\'s parent pops it; onto an unrelated selection forgets the stack', () => {
    const a: Selection = {kind: 'range', t0: D('2024-05-01'), t1: D('2024-05-10')}, b: Selection = {kind: 'range', t0: D('2024-05-03') + 14 * H, t1: D('2024-05-03') + 18 * H};
    const go = (search: string) => { vi.stubGlobal('location', {search}); applyUrl([]); };
    try {
      selection.resetZoom(); selection.sel = a;
      selection.zoomInto({kind: 'range', t0: D('2024-05-02'), t1: D('2024-05-05')}, 'Rome', null);
      selection.zoomInto(b, 'Colosseum', null);
      go('?from=2024-05-02&to=2024-05-04');
      expect([selection.stack.length, selection.zoomLabel]).toEqual([1, 'Rome']);
      go('?from=2024-06-01&to=2024-06-02');
      expect([selection.stack.length, selection.zoomLabel]).toEqual([0, null]);
    } finally { vi.unstubAllGlobals(); selection.sel = null; }
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

describe('fLength', () => {
  it('calendar years, months, days; hours under two days', () => {
    expect(fLength(D('2013-01-07'), D('2022-04-06'))).toBe('9y 2m 30d');
    expect(fLength(D('2023-04-29'), D('2023-05-07'))).toBe('8d');
    expect(fLength(D('2024-01-31'), D('2024-03-01'))).toBe('1m 1d');
    expect(fLength(D('2023-05-02') + 14 * H, D('2023-05-03') + 18 * H)).toBe('28h');
    expect(fLength(D('2024-01-01'), D('2025-01-01'))).toBe('1y');
    expect(fLength(D('2023-04-29') + 19 * H, D('2023-05-06') + 21 * H)).toBe('8d'); // album: days touched
  });
});


describe('local days (overview axis ↔ instants)', () => {
  // A trip at UTC+3 then UTC−5: offsets come from the nearest library photo.
  const lib = ix([
    ['2024-05-01T08:00:00Z', 3, 0, 1], ['2024-05-03T20:00:00Z', 3, 0, 1],
    ['2024-05-10T15:00:00Z', -5, 0, 1], ['2024-05-12T15:00:00Z', -5, 0, 1],
  ]);
  it('converts with the nearest photo\'s offset and round-trips', () => {
    expect(toLocal(D('2024-05-02'), lib)).toBe(D('2024-05-02') + 3 * H);
    expect(fromLocal(D('2024-05-02'), lib)).toBe(D('2024-05-02') - 3 * H);
    expect(fromLocal(D('2024-05-11'), lib)).toBe(D('2024-05-11') + 5 * H);
    for (const l of [D('2024-05-02'), D('2024-05-11'), D('2024-05-13')]) expect(toLocal(fromLocal(l, lib), lib)).toBe(l);
    expect([toLocal(5, null), fromLocal(5, null)]).toEqual([5, 5]);
  });
  it('a photo at 01:00 local belongs to that local day: brush, URL and readout agree with the wave', () => {
    // Local 2024-05-04 01:00 at UTC+3 is 2024-05-03 22:00 UTC; selecting local 4 May must include it.
    const p = Date.parse('2024-05-03T22:00:00Z'), day = [fromLocal(D('2024-05-04'), lib), fromLocal(D('2024-05-05'), lib)];
    expect(p >= day[0] && p < day[1]).toBe(true);
    const sel: Selection = {kind: 'range', t0: day[0], t1: day[1]};
    const q = selectionToQuery(sel, null, undefined, lib);
    expect(q.toString()).toBe('from=2024-05-04&to=2024-05-04');
    expect(selectionFromUrl(q, [], lib)).toEqual(sel);
  });
  it('an album spans its local days through the end of the last one', () => {
    const a = {start: D('2024-05-01'), end: D('2024-05-11')};
    expect(albumSpan(a, lib)).toEqual([D('2024-05-01') - 3 * H, D('2024-05-12') + 5 * H]);
    // The last photo (local 12 May 10:00 at −5) is on a later day: outside; one on 11 May local evening is inside.
    const [, t1] = albumSpan(a, lib);
    expect(Date.parse('2024-05-12T03:00:00Z') < t1).toBe(true); // local 11 May 22:00
    expect(Date.parse('2024-05-12T15:00:00Z') < t1).toBe(false);
  });
  it('on a day the offset changes, a span that wouldn\'t read back from days is written to the minute', () => {
    const tz = ix([['2024-05-01T20:00:00Z', 3, 0, 1], ['2024-05-01T23:00:00Z', 2, 0, 1]]);
    const sel: Selection = {kind: 'range', t0: Date.parse('2024-05-01T21:00:00Z'), t1: Date.parse('2024-05-02T22:00:00Z')};
    const q = selectionToQuery(sel, null, undefined, tz);
    expect(q.get('from')).toBe('2024-05-01T21:00Z');
    expect(selectionFromUrl(q, [], tz)).toEqual(sel);
  });
  it('names and pin days follow the library\'s offsets', () => {
    library.index = withLookup(lib);
    try {
      const p = Date.parse('2024-05-03T22:00:00Z');
      const [d0, d1] = dayAround(p, 3);
      expect([d0, d1]).toEqual([D('2024-05-04') - 3 * H, D('2024-05-05') - 3 * H]);
      expect(fDays(d0, d1)).toBe('4 May 2024');
      expect(selectionToQuery({kind: 'range', t0: d0, t1: d1}, null).toString()).toBe('from=2024-05-04&to=2024-05-04');
    } finally { library.index = null; }
  });
});
