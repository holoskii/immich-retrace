import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {MediaQueue, MediaStatusError, PreviewSet, retryDelay, type RateWindow} from '../web/src/lib/lightbox/media.ts';

/** A fetch whose answers the test hands out by hand; records every request (and whether it was aborted). */
function fakeFetch() {
  const calls: {url: string; signal?: AbortSignal; answer: (status?: number, headers?: Record<string, string>) => void}[] = [];
  const f = ((url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init?.signal ?? undefined;
    signal?.addEventListener('abort', () => reject(signal.reason));
    calls.push({url, signal, answer: (status = 200, headers = {}) => resolve(new Response(status === 200 ? `body ${url}` : null, {status, headers}))});
  })) as typeof fetch;
  return {f, calls};
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('MediaQueue', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const queue = (f: typeof fetch, opts: {concurrency?: number; window?: RateWindow | null} = {}) =>
    new MediaQueue({concurrency: opts.concurrency ?? 6, window: () => opts.window ?? null, fetch: f, now: () => Date.now()});

  it('keeps at most `concurrency` requests in flight, starting the next as one finishes', async () => {
    const {f, calls} = fakeFetch(), q = queue(f, {concurrency: 2});
    const done = ['a', 'b', 'c', 'd'].map(u => q.load(u));
    await flush();
    expect(calls.map(c => c.url)).toEqual(['a', 'b']);
    calls[0].answer();
    expect(await (await done[0]).text()).toBe('body a');
    await flush();
    expect(calls.map(c => c.url)).toEqual(['a', 'b', 'c']);
    expect(q.pending).toEqual({queued: 1, active: 2});
  });

  it('puts `high` requests ahead of the waiting ones, in their own order', async () => {
    const {f, calls} = fakeFetch(), q = queue(f, {concurrency: 1});
    for (const u of ['a', 'b', 'c']) void q.load(u);
    void q.load('h1', {high: true}); void q.load('h2', {high: true});
    for (let i = 0; i < 5; i++) { await flush(); calls.at(-1)!.answer(); }
    await flush();
    expect(calls.map(c => c.url)).toEqual(['a', 'h1', 'h2', 'b', 'c']);
  });

  it('stays under the rate window: a start waits until the oldest one leaves it', async () => {
    const {f, calls} = fakeFetch(), q = queue(f, {window: {events: 2, ms: 1000}});
    for (const u of ['a', 'b', 'c']) void q.load(u);
    await flush();
    calls.forEach(c => c.answer());
    await flush();
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.map(c => c.url)).toEqual(['a', 'b', 'c']);
  });

  it('on 429 pauses the whole queue for Retry-After, then retries that request first', async () => {
    const {f, calls} = fakeFetch(), q = queue(f, {concurrency: 1});
    const a = q.load('a');
    void q.load('b');
    await flush();
    calls[0].answer(429, {'retry-after': '3'});
    await vi.advanceTimersByTimeAsync(2999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.map(c => c.url)).toEqual(['a', 'a']);
    calls[1].answer();
    expect(await (await a).text()).toBe('body a');
  });

  it('gives up after its retries with the status, and fails other errors at once', async () => {
    const {f, calls} = fakeFetch(), q = new MediaQueue({concurrency: 1, window: () => null, retries: 1, fetch: f});
    const a = q.load('a'), b = q.load('b');
    const ea = a.catch(e => e), eb = b.catch(e => e);
    await flush(); calls[0].answer(429);
    await vi.advanceTimersByTimeAsync(1000); calls[1].answer(429);
    // The final 429 still pauses the queue (Retry-After or back-off) before b goes out.
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1); calls[2].answer(404);
    expect(await ea).toBeInstanceOf(MediaStatusError);
    expect((await ea).status).toBe(429);
    expect((await eb).status).toBe(404);
  });

  it('drops an aborted request that is still waiting, and cancels one in flight', async () => {
    const {f, calls} = fakeFetch(), q = queue(f, {concurrency: 1});
    const ca = new AbortController(), cb = new AbortController();
    const a = q.load('a', {signal: ca.signal}).catch(e => e), b = q.load('b', {signal: cb.signal}).catch(e => e);
    void q.load('c');
    await flush();
    cb.abort();
    expect(await b).toBeInstanceOf(DOMException);
    ca.abort();
    expect((await a).name).toBe('AbortError');
    expect(calls[0].signal?.aborted).toBe(true);
    await flush();
    // b never went out; c took the free slot.
    expect(calls.map(c => c.url)).toEqual(['a', 'c']);
    await expect(q.load('d', {signal: AbortSignal.abort()})).rejects.toBeInstanceOf(DOMException);
  });
});

describe('retryDelay', () => {
  const now = Date.UTC(2026, 9, 15, 12);
  it('reads seconds and HTTP dates, else backs off exponentially; within 0.5–60 s', () => {
    expect(retryDelay('7', now, 1)).toBe(7000);
    expect(retryDelay(new Date(now + 4000).toUTCString(), now, 1)).toBe(4000);
    expect(retryDelay(null, now, 1)).toBe(1000);
    expect(retryDelay('soon', now, 3)).toBe(4000);
    expect(retryDelay('0', now, 1)).toBe(500);
    expect(retryDelay('3600', now, 1)).toBe(60_000);
  });
});

describe('MediaQueue reserve', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('background loads use only their share of the window; explicit ones the rest, ahead of everything', async () => {
    const {f, calls} = fakeFetch(), q = new MediaQueue({concurrency: 6, window: () => ({events: 4, ms: 1000, background: 2}), fetch: f, now: () => Date.now()});
    for (const u of ['g1', 'g2', 'g3', 'g4']) void q.load(u, {high: true});
    await flush();
    expect(calls.map(c => c.url)).toEqual(['g1', 'g2']); // the background share is spent
    void q.load('lb', {explicit: true});
    void q.load('card', {explicit: true});
    void q.load('lb2', {explicit: true});
    await flush();
    expect(calls.map(c => c.url)).toEqual(['g1', 'g2', 'lb', 'card']); // the reserve; then the window is full
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.map(c => c.url)).toEqual(['g1', 'g2', 'lb', 'card', 'lb2', 'g3']); // explicit first again
  });

  it('prioritize(…, true) lets a waiting background load (a neighbour now on show) use the reserve', async () => {
    const {f, calls} = fakeFetch(), q = new MediaQueue({concurrency: 6, window: () => ({events: 3, ms: 1000, background: 1}), fetch: f, now: () => Date.now()});
    const c = new AbortController();
    void q.load('g1'); void q.load('g2'); void q.load('next', {signal: c.signal});
    await flush();
    expect(calls.map(x => x.url)).toEqual(['g1']);
    q.prioritize(c.signal); // not explicit: still waits for the background share
    await flush();
    expect(calls.map(x => x.url)).toEqual(['g1']);
    q.prioritize(c.signal, true);
    await flush();
    expect(calls.map(x => x.url)).toEqual(['g1', 'next']);
  });

  it('without a background share every start may be anyone\'s (the old behaviour)', async () => {
    const {f, calls} = fakeFetch(), q = new MediaQueue({concurrency: 6, window: () => ({events: 2, ms: 1000}), fetch: f, now: () => Date.now()});
    for (const u of ['a', 'b', 'c']) void q.load(u);
    await flush();
    expect(calls.map(x => x.url)).toEqual(['a', 'b']);
  });
});

describe('MediaQueue.prioritize', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('moves a waiting request first in line, ahead of high ones too', async () => {
    const {f, calls} = fakeFetch(), q = new MediaQueue({concurrency: 1, window: () => null, fetch: f});
    const c = new AbortController();
    for (const u of ['a', 'b']) void q.load(u);
    void q.load('h', {high: true});
    void q.load('n', {signal: c.signal});
    q.prioritize(c.signal);
    for (let i = 0; i < 4; i++) { await flush(); calls.at(-1)!.answer(); }
    expect(calls.map(x => x.url)).toEqual(['a', 'n', 'h', 'b']);
  });

  it('does nothing for a request already in flight', async () => {
    const {f, calls} = fakeFetch(), q = new MediaQueue({concurrency: 1, window: () => null, fetch: f});
    const c = new AbortController();
    void q.load('a', {signal: c.signal}); void q.load('b');
    await flush();
    q.prioritize(c.signal);
    expect(q.pending).toEqual({queued: 1, active: 1});
    expect(calls.map(x => x.url)).toEqual(['a']);
  });
});

describe('PreviewSet', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function setup(concurrency = 6) {
    const {f, calls} = fakeFetch();
    const q = new MediaQueue({concurrency, window: () => null, fetch: f});
    const made: string[] = [], revoked: string[] = [];
    let n = 0, changes = 0;
    const set = new PreviewSet(q, () => changes++, {create: () => { const u = `blob:${++n}`; made.push(u); return u; }, revoke: u => { revoked.push(u); }});
    return {set, calls, made, revoked, q, changes: () => changes};
  }

  it('loads the wanted previews, the one on show first', async () => {
    const {set, calls} = setup(1);
    set.keep(['cur', 'next', 'prev']);
    await flush();
    expect(calls.map(c => c.url)).toEqual(['cur']);
    calls[0].answer(); await flush();
    calls[1].answer(); await flush();
    expect(calls.map(c => c.url)).toEqual(['cur', 'next', 'prev']);
  });

  it('a neighbour that becomes the one on show keeps its request: no abort, no second load', async () => {
    const {set, calls, revoked} = setup();
    set.keep(['p1', 'p2', 'p0']);
    await flush();
    calls[0].answer(); // p1 done; p2 (the next one) still in flight
    await flush();
    expect(set.get('p1')?.src).toBe('blob:1');
    set.keep(['p2', 'p3', 'p1']); // stepped forward
    await flush();
    expect(calls.map(c => c.url)).toEqual(['p1', 'p2', 'p0', 'p3']);
    expect(calls[1].signal?.aborted).toBe(false);
    expect(calls[2].signal?.aborted).toBe(true); // p0 left the window
    calls[1].answer(); await flush();
    expect(set.get('p2')?.src).toBe('blob:2');
    expect(set.get('p1')?.src).toBe('blob:1'); // kept, not reloaded
    expect(revoked).toEqual([]);
  });

  it('holds at most what was last asked for: the rest are revoked', async () => {
    const {set, calls, revoked} = setup();
    set.keep(['a', 'b', 'c']);
    await flush();
    calls.forEach(c => c.answer()); await flush();
    expect(set.size).toBe(3);
    set.keep(['b', 'c', 'd']);
    expect(set.size).toBe(3);
    expect(revoked).toEqual(['blob:1']);
    expect(set.get('a')).toBeNull();
    set.dispose();
    expect(set.size).toBe(0);
    expect(revoked.sort()).toEqual(['blob:1', 'blob:2', 'blob:3']);
  });

  it('a waiting neighbour that becomes the one on show jumps the queue', async () => {
    const {set, calls, q} = setup(1);
    void q.load('other');
    set.keep(['a', 'b']);
    await flush();
    set.keep(['b', 'a']);
    calls[0].answer(); await flush();
    expect(calls.map(c => c.url)).toEqual(['other', 'b']);
  });

  it('keeps a failure until retried, then loads again', async () => {
    const {set, calls, changes} = setup();
    set.keep(['a']);
    await flush();
    calls[0].answer(404); await flush();
    expect(set.get('a')?.error).toBeInstanceOf(MediaStatusError);
    expect(changes()).toBe(1);
    set.keep(['a']);
    await flush();
    expect(calls).toHaveLength(1);
    set.retry('a');
    await flush();
    calls[1].answer(); await flush();
    expect(set.get('a')).toEqual({src: 'blob:1', error: null});
  });

  it('retry also reloads one that loaded but would not decode, revoking the old URL', async () => {
    const {set, calls, revoked} = setup();
    set.keep(['a']);
    await flush();
    calls[0].answer(); await flush();
    set.retry('a');
    expect(revoked).toEqual(['blob:1']);
    await flush();
    calls[1].answer(); await flush();
    expect(set.get('a')?.src).toBe('blob:2');
  });
});
