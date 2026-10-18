import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {loadedThumb, MediaQueue, type RateWindow} from '../web/src/lib/lightbox/media.ts';
import {CardImage} from '../web/src/lib/lightbox/card.ts';

/** A fetch whose answers the test hands out by hand. */
function fakeFetch() {
  const calls: {url: string; signal?: AbortSignal; answer: (status?: number) => void}[] = [];
  const f = ((url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init?.signal ?? undefined;
    signal?.addEventListener('abort', () => reject(signal.reason));
    calls.push({url, signal, answer: (status = 200) => resolve(new Response(status === 200 ? url : null, {status}))});
  })) as typeof fetch;
  return {f, calls};
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('CardImage', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function setup({gap = 500, rest = 120, window = null as RateWindow | null, keep = 24} = {}) {
    const {f, calls} = fakeFetch();
    const q = new MediaQueue({concurrency: 6, window: () => window, fetch: f, now: () => Date.now()});
    const revoked: string[] = [], failed: string[] = [];
    let changes = 0;
    const card = new CardImage(q, () => changes++, {
      rest, gap: () => gap, keep, now: () => Date.now(),
      prepare: async b => `blob:${await b.text()}`, revoke: u => { revoked.push(u); }, onFail: u => { failed.push(u); },
    });
    /** Answers every request in flight. */
    const answerAll = async (status = 200) => { for (const c of calls) c.answer(status); await flush(); };
    return {card, calls, q, revoked, failed, answerAll, changes: () => changes};
  }

  it('loads the wanted thumbnail at once; until then no src (the thumbhash shows)', async () => {
    const {card, calls, answerAll, changes} = setup();
    card.want('a');
    await flush();
    expect(calls.map(c => c.url)).toEqual(['a']);
    expect(card.src).toBeNull();
    await answerAll();
    expect(card.src).toBe('blob:a');
    expect(changes()).toBe(2);
  });

  it('lends what it holds to the lightbox (loadedThumb): its own loads and an adopted LCP image, until disposed', async () => {
    // URLs of its own: the other tests leave their cards (and so their registrations) undisposed.
    const {card, calls, answerAll} = setup({gap: 0});
    card.adopt('/lend-lcp?c=h', '/lend-lcp?c=h');
    card.adopt('/lend-nocache', '/lend-nocache');
    card.want('lend-a');
    await flush(); await answerAll();
    expect(loadedThumb('lend-a')).toBe('blob:lend-a');
    expect(loadedThumb('/lend-lcp?c=h')).toBe('/lend-lcp?c=h'); // the <img>'s own request, versioned: in the HTTP cache
    expect(loadedThumb('/lend-nocache')).toBeNull(); // unversioned (no-store): showing it again would be a request
    expect(loadedThumb('lend-b')).toBeNull();
    expect(calls.length).toBe(1);
    card.dispose();
    expect(loadedThumb('lend-a')).toBeNull();
  });

  it('never shows another photo: a new want drops the src until its own thumbnail is in', async () => {
    const {card, answerAll} = setup({gap: 0});
    card.want('a');
    await flush(); await answerAll();
    card.want('b');
    expect(card.src).toBeNull();
    await flush(); await answerAll();
    expect(card.src).toBe('blob:b');
  });

  it('while the cursor keeps moving, starts at most one load per gap, then the one it rests on', async () => {
    const {card, calls, answerAll} = setup();
    // A 2 s scrub: a new photo every 50 ms, each answered quickly.
    for (let i = 0; i < 40; i++) {
      card.want(`p${i}`);
      await vi.advanceTimersByTimeAsync(25);
      await answerAll();
      await vi.advanceTimersByTimeAsync(25);
    }
    expect(calls.length).toBeLessThanOrEqual(5);
    // The finger rests on p39: loaded within `rest`.
    await vi.advanceTimersByTimeAsync(120);
    await answerAll();
    expect(calls.at(-1)!.url).toBe('p39');
    expect(card.src).toBe('blob:p39');
  });

  it('a slow scrub, resting on each photo, loads each one', async () => {
    const {card, calls, answerAll} = setup();
    for (const u of ['a', 'b', 'c']) { card.want(u); await vi.advanceTimersByTimeAsync(150); await answerAll(); expect(card.src).toBe(`blob:${u}`); }
    expect(calls.map(c => c.url)).toEqual(['a', 'b', 'c']);
  });

  it('a superseded load still waiting in the queue is dropped; one in flight finishes into the cache', async () => {
    const {card, calls, answerAll} = setup({window: {events: 1, ms: 20_000}});
    card.want('a');
    await flush();
    expect(calls.map(c => c.url)).toEqual(['a']);
    card.want('b'); // 'a' in flight: kept
    await vi.advanceTimersByTimeAsync(200);
    await answerAll();
    await vi.advanceTimersByTimeAsync(200); // 'b' is waiting for the rate window
    card.want('c');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls.map(c => c.url)).toEqual(['a', 'c']);
    card.want('a'); // scrubbed back: from the cache, no request
    expect(card.src).toBe('blob:a');
  });

  it('an adopted image (the LCP <img>) is shown without a request and never revoked', async () => {
    const {card, calls, revoked} = setup();
    card.adopt('/t/a', '/t/a');
    card.want('/t/a');
    await flush();
    expect(card.src).toBe('/t/a');
    expect(calls).toHaveLength(0);
    card.dispose();
    expect(revoked).toEqual([]);
  });

  it('keeps at most `keep` thumbnails, revoking the least recently wanted, never the wanted one', async () => {
    const {card, answerAll, revoked} = setup({gap: 0, keep: 2});
    for (const u of ['a', 'b', 'c']) { card.want(u); await flush(); await answerAll(); }
    expect(revoked).toEqual(['blob:a']);
    card.want('b');
    card.want('d'); await flush(); await answerAll();
    expect(revoked).toEqual(['blob:a', 'blob:c']);
    card.dispose();
    expect(revoked.sort()).toEqual(['blob:a', 'blob:b', 'blob:c', 'blob:d']);
  });

  it('a load on a photo the cursor rests on is explicit: it uses the reserve the grid can\'t', async () => {
    const {card, calls, q} = setup({window: {events: 3, ms: 20_000, background: 1}});
    void q.load('grid1'); void q.load('grid2');
    await flush();
    card.want('a');
    await vi.advanceTimersByTimeAsync(120);
    expect(calls.map(c => c.url)).toEqual(['grid1', 'a']);
  });

  it('a paced scrub load waiting for the background share is promoted once the cursor rests on it', async () => {
    const {card, calls, q} = setup({gap: 0, rest: 1000, window: {events: 3, ms: 20_000, background: 1}});
    void q.load('grid1');
    await flush();
    card.want('a'); // gap 0: started at once as a background load, which has to wait
    await flush();
    expect(calls.map(c => c.url)).toEqual(['grid1']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.map(c => c.url)).toEqual(['grid1', 'a']);
  });

  it('while playing: prefetches the photo at the cursor and the next ones, drops the passed ones, starts nothing itself', async () => {
    const {card, calls, answerAll} = setup({window: {events: 2, ms: 20_000}});
    card.want('p0'); card.ahead(['p0', 'p1', 'p2']);
    await flush();
    expect(calls.map(c => c.url)).toEqual(['p0', 'p1']); // the window allows two; p2 waits
    await answerAll();
    expect(card.src).toBe('blob:p0');
    card.want('p3'); card.ahead(['p3', 'p4', 'p5']); // Play moved on: p2, still waiting, is dropped
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls.map(c => c.url)).toEqual(['p0', 'p1', 'p3', 'p4']);
    await answerAll();
    card.want('p4'); card.ahead(['p4', 'p5', 'p6']);
    expect(card.src).toBe('blob:p4'); // prefetched: sharp at once
    // Play stops on p5 (not loaded): the card loads it itself once the cursor rests.
    card.want('p5'); card.ahead([]);
    await vi.advanceTimersByTimeAsync(20_000 + 120);
    expect(calls.at(-1)!.url).toBe('p5');
  });

  it('while playing in the demo: prefetches start at most one per aheadGap, spread out rather than all at once', async () => {
    const {f, calls} = fakeFetch();
    const q = new MediaQueue({concurrency: 6, window: () => null, fetch: f, now: () => Date.now()});
    const card = new CardImage(q, () => {}, {aheadGap: () => 600, now: () => Date.now(), prepare: async b => `blob:${await b.text()}`});
    card.ahead(['a', 'b', 'c']); card.want('p0');
    await flush();
    expect(calls.map(c => c.url)).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(300);
    card.ahead(['b', 'c', 'd']); card.want('p1');
    await flush();
    expect(calls.map(c => c.url)).toEqual(['a']);
    // No step since (Play lingers on a photo): the cooldown's end still starts the most wanted one.
    await vi.advanceTimersByTimeAsync(300);
    expect(calls.map(c => c.url)).toEqual(['a', 'b']);
    card.ahead(['d', 'c']); card.want('p2');
    await flush();
    expect(calls.map(c => c.url)).toEqual(['a', 'b']);
    await vi.advanceTimersByTimeAsync(600);
    expect(calls.map(c => c.url)).toEqual(['a', 'b', 'd']); // the most wanted one first
    card.ahead([]); // stopped: no more prefetches
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls.map(c => c.url).filter(u => u !== 'p2')).toEqual(['a', 'b', 'd']);
    card.dispose();
  });

  it('a failed thumbnail is reported once and not retried while wanted', async () => {
    const {card, calls, failed, answerAll} = setup({gap: 0});
    card.want('a');
    await flush(); await answerAll(404);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1);
    expect(failed).toEqual(['a']);
    expect(card.src).toBeNull();
  });
});
