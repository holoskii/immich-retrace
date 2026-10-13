import {afterEach, describe, expect, it, vi} from 'vitest';
import {withLookup, type IndexColumns, type LibraryIndex} from '../web/src/lib/index/model.ts';
import {rowInActive, selection, writeUrl, type Active} from '../web/src/lib/selection.svelte.ts';
import {immichLink, thumbUrl, videoUrl} from '../web/src/lib/lightbox/media.ts';
import {
  bins, fClock, fCoords, fCount, fLongDate, fOffset, fPlace, fPosition, gpsExtent, neighbours, reconcile, routeLines, step,
} from '../web/src/lib/lightbox/model.ts';

const H = 3600e3, T0 = Date.UTC(2026, 7, 1);
const ID = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

/** Rows: [hours after T0, lat or null]; lon = lat + 30. */
function ix(rows: [number, number | null][], ids = rows.map((_, i) => ID(i))): LibraryIndex {
  const n = rows.length, gps = rows.map(r => (r[1] == null ? 0 : 1));
  const c: IndexColumns = {
    n, id: ids, t: Float64Array.from(rows.map(r => T0 + r[0] * H)), off: new Float32Array(n).fill(6),
    video: new Uint8Array(n), dur: new Float64Array(n), gps: Uint8Array.from(gps),
    lat: Float64Array.from(rows.map(r => r[1] ?? NaN)), lon: Float64Array.from(rows.map(r => (r[1] == null ? NaN : r[1] + 30))),
    thumbhash: new Array(n).fill(null), ratio: new Float32Array(n).fill(1.5), city: new Array(n).fill(null), country: new Array(n).fill(null),
  };
  return withLookup(c);
}
const act = (x: LibraryIndex, lo = 0, hi = x.n): Active => ({ix: x, lo, hi, t0: T0, t1: T0 + 24 * H});

describe('stepping', () => {
  it('stops at both ends of the range (no wrap)', () => {
    const a = {lo: 3, hi: 6};
    expect(step(a, 3, -1)).toBeNull();
    expect(step(a, 3, 1)).toBe(4);
    expect(step(a, 5, 1)).toBeNull();
  });

  it('preloads ±1 before ±2, clipped to the range', () => {
    expect(neighbours({lo: 0, hi: 10}, 5)).toEqual([6, 4, 7, 3]);
    expect(neighbours({lo: 0, hi: 10}, 0)).toEqual([1, 2]);
    expect(neighbours({lo: 4, hi: 6}, 5)).toEqual([4]);
  });

  it('labels the position within the range', () => {
    expect(fPosition({lo: 100, hi: 1519}, 222)).toBe('123 / 1\u202f419');
    expect(fCount(1234567)).toBe('1\u202f234\u202f567');
    expect(fCount(999)).toBe('999');
  });
});

describe('reconcile', () => {
  const x = ix([[0, 1], [1, 2], [2, 3], [3, 4]]);

  it('keeps a row inside the range and closes outside it or without a selection', () => {
    expect(reconcile(act(x, 1, 3), 2, null)).toBe(2);
    expect(reconcile(act(x, 1, 3), 3, null)).toBeNull();
    expect(reconcile(null, 2, null)).toBeNull();
    expect(reconcile(act(x), null, null)).toBeNull();
  });

  it('follows the open asset by id into a new index, or closes when it is gone', () => {
    const swapped = ix([[-1, 0], [0, 1], [1, 2], [2, 3], [3, 4]], [ID(9), ID(0), ID(1), ID(2), ID(3)]);
    expect(reconcile(act(swapped), 2, {ix: x, id: ID(2)})).toBe(3);
    expect(reconcile(act(swapped, 0, 2), 2, {ix: x, id: ID(2)})).toBeNull();
    const without = ix([[0, 1]], [ID(7)]);
    expect(reconcile(act(without), 0, {ix: x, id: ID(2)})).toBeNull();
    // Same index: the requested row wins (the map opened another asset).
    expect(reconcile(act(x), 0, {ix: x, id: ID(2)})).toBe(0);
  });

  it('finds a URL asset only inside the active range', () => {
    expect(rowInActive(act(x, 1, 3), ID(2))).toBe(2);
    expect(rowInActive(act(x, 1, 3), ID(3))).toBeNull();
    expect(rowInActive(act(x), 'nope')).toBeNull();
  });
});

describe('labels', () => {
  const t = Date.UTC(2026, 7, 12, 8, 32); // 14:32 at UTC+6
  it('shows local wall time from the row offset', () => {
    expect(fClock(t, 6)).toBe('14:32');
    expect(fLongDate(t, 6)).toBe('Wednesday, 12 August 2026');
    expect(fLongDate(Date.UTC(2026, 7, 12, 20), 6)).toBe('Thursday, 13 August 2026');
  });
  it('offsets, coordinates, places', () => {
    expect(fOffset(6)).toBe('UTC+6');
    expect(fOffset(-3.5)).toBe('UTC−3:30');
    expect(fOffset(0)).toBe('UTC');
    expect(fCoords(-33.5, -70.25)).toBe('33.5000° S  70.2500° W');
    expect(fPlace('Town', 'Land')).toBe('Town, Land');
    expect(fPlace(null, 'Land')).toBe('Land');
    expect(fPlace(null, null)).toBeNull();
  });
});

describe('mini-map data', () => {
  it('breaks the route on gaps over 4 h, skips rows without GPS, drops lone points', () => {
    const x = ix([[0, 1], [1, null], [2, 2], [7, 3], [20, 4], [21, 5]]);
    expect(routeLines(x, 0, x.n)).toEqual([[[31, 1], [32, 2]], [[34, 4], [35, 5]]]);
    expect(gpsExtent(x, 0, x.n)).toEqual([[31, 1], [35, 5]]);
    expect(gpsExtent(ix([[0, null]]), 0, 1)).toBeNull();
  });

  it('bins the range for the position strip', () => {
    const x = ix([[0, 1], [1, 1], [23.9, 1]]);
    expect([...bins(x.t, 0, x.n, T0, T0 + 24 * H, 4)]).toEqual([2, 0, 0, 1]);
  });
});

describe('media URLs', () => {
  it('versions thumbnails with the thumbhash, encoded', () => {
    expect(thumbUrl(ID(1), 'ab+/c=', 'preview')).toBe(`/api/assets/${ID(1)}/thumbnail?size=preview&c=ab%2B%2Fc%3D`);
    expect(thumbUrl(ID(1), null)).toBe(`/api/assets/${ID(1)}/thumbnail?size=thumbnail`);
    expect(videoUrl(ID(1))).toBe(`/api/assets/${ID(1)}/video`);
  });
  it('links to Immich only when configured', () => {
    expect(immichLink('https://photos.example/', ID(1))).toBe(`https://photos.example/photos/${ID(1)}`);
    expect(immichLink(null, ID(1))).toBeNull();
  });
});

describe('lb in the URL', () => {
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
    return {entries, history};
  }
  afterEach(() => { vi.unstubAllGlobals(); selection.sel = null; selection.members = null; selection.lightbox = null; });

  it('open pushes lb, stepping and closing replace it; other writes keep it', () => {
    const x = ix([[0, 1], [1, 2], [2, 3]]);
    // Album members mode needs no library index: active = the member index.
    selection.sel = {kind: 'album', albumId: 'alb', mode: 'members', t0: T0, t1: T0 + 24 * H};
    selection.members = {albumId: 'alb', version: 'v', ix: x};
    const h = fakeHistory('http://x/?album=alb');
    selection.lightbox = 1;
    expect(selection.lightboxId).toBe(ID(1));
    writeUrl('commit');
    expect(h.entries.map(e => e.href)).toEqual(['http://x/?album=alb', `http://x/?album=alb&lb=${ID(1)}`]);
    selection.lightbox = 2;
    writeUrl('replace');
    expect(h.entries.length).toBe(2);
    expect(h.entries[1].href).toBe(`http://x/?album=alb&lb=${ID(2)}`);
    selection.lightbox = 5; // outside the range: not written
    expect(selection.lightboxId).toBeNull();
    selection.lightbox = null;
    writeUrl('replace', T0 + H);
    expect(h.entries.map(e => e.href)).toEqual(['http://x/?album=alb', `http://x/?album=alb&at=${T0 + H}`]);
  });
});
