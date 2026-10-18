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

  function setup({gap = 500, window = null as RateWindow | null, keep = 24} = {}) {
    const {f, calls} = fakeFetch();
    const q = new MediaQueue({concurrency: 6, window: () => window, fetch: f, now: () => Date.now()});
    const revoked: string[] = [], failed: string[] = [];
    let changes = 0;
    const card = new CardImage(q, () => changes++, {
      rest: 120, gap: () => gap, keep, now: () => Date.now(),
      prepare: async b => `blob:${await b.text()}`, revoke: u => { revoked.push(u); }, onFail: u => { failed.push(u); },
    });
    /** Answers every request in flight. */
    const answerAll = async (status = 200) => { for (const c of calls) c.answer(status); await flush(); };
    return {card, calls, revoked, failed, answerAll, changes: () => changes};
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
