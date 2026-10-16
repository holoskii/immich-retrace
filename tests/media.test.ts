import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {MediaQueue, MediaStatusError, retryDelay, type RateWindow} from '../web/src/lib/lightbox/media.ts';

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
