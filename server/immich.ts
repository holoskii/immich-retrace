// Talks to Immich (usually through the on-demand gate). Every upstream request is built here
// from validated inputs; nothing from the browser request is forwarded except an explicit Range.

import {createHash} from 'node:crypto';

export type ImmichState = 'unknown' | 'waking' | 'up' | 'down';

/** An error with the status and message the viewer should answer with. */
export class HttpError extends Error {
  readonly status: 404 | 502 | 503;
  readonly code?: 'auth' | 'unavailable' | 'not-found' | 'invalid';
  constructor(status: 404 | 502 | 503, message: string, code?: 'auth' | 'unavailable' | 'not-found' | 'invalid') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const KEY_PERMISSIONS = 'Immich rejected the viewer\'s API key. Check its permissions: asset.read, asset.view, album.read.';
const unavailable = () => new HttpError(503, 'Immich is not reachable right now. It may still be starting; retry in a few seconds.', 'unavailable');

export interface ImmichOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  wakeTimeoutMs?: number;
  pollMs?: number;
  /** Per upstream request, until its headers arrive (a video body may then stream for as long as it takes). */
  requestTimeoutMs?: number;
}

// While Immich starts, the gate answers every request with its loading page: 200 text/html.
// Immich itself never returns HTML under /api, so that combination means "not up yet".
const isGatePage = (res: Response) =>
  res.status === 200 && (res.headers.get('content-type') ?? '').startsWith('text/html');

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class ImmichClient {
  state: ImmichState = 'unknown';
  /** Stable, opaque id of (Immich URL, API key); namespaces the browser cache. */
  readonly library: string;
  private waking: Promise<void> | null = null;
  private readonly fetch: typeof fetch;
  private readonly base: string;
  private readonly opts: ImmichOptions;

  constructor(opts: ImmichOptions) {
    this.opts = opts;
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.library = createHash('sha256').update(`${opts.baseUrl}\n${opts.apiKey}`).digest('hex').slice(0, 16);
  }

  private url(path: string, query?: Record<string, string>) {
    const u = new URL(this.base + '/api' + path);
    for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v);
    return u;
  }

  /** Single-flight: concurrent callers share one wake-up instead of storming a cold server. */
  wake(): Promise<void> {
    if (this.state === 'up') return Promise.resolve();
    this.waking ??= this.doWake().finally(() => { this.waking = null; });
    return this.waking;
  }

  private async doWake() {
    this.state = 'waking';
    const deadline = Date.now() + (this.opts.wakeTimeoutMs ?? 60_000);
    while (Date.now() < deadline) {
      try {
        // The signal also bounds reading the body, so a hung gate can't hold the wake forever.
        const signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
        const res = await this.fetch(this.url('/server/ping'), {redirect: 'manual', signal});
        // The gate returns 503 when it refuses to start Immich (photo mount missing).
        if (res.status === 503) { await res.body?.cancel(); break; }
        if (res.ok && (res.headers.get('content-type') ?? '').startsWith('application/json')) {
          if (((await res.json()) as {res?: string}).res === 'pong') { this.state = 'up'; return; }
        } else {
          await res.body?.cancel();
        }
      } catch {
        // gate or Immich not reachable yet; keep polling until the deadline
      }
      await sleep(this.opts.pollMs ?? 500);
    }
    this.state = 'down';
    throw unavailable();
  }

  /**
   * Issues one upstream request, waking Immich first and retrying once if the gate page or a
   * gate 503 comes back instead (it was stopped since we last saw it). Redirects are not
   * followed: they would carry the API key to wherever they point. Network failures become a
   * 503 HttpError.
   */
  private async fetchUp(path: string, opts: {method?: 'GET' | 'HEAD'; query?: Record<string, string>; headers: Record<string, string>; signal?: AbortSignal}): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.wake();
      opts.signal?.throwIfAborted();
      let res: Response;
      const ms = this.opts.requestTimeoutMs ?? 30_000, timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), ms);
      try {
        const signal = opts.signal ? AbortSignal.any([opts.signal, timeout.signal]) : timeout.signal;
        res = await this.fetch(this.url(path, opts.query), {method: opts.method ?? 'GET', headers: opts.headers, redirect: 'manual', signal});
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        this.state = 'unknown';
        if (timeout.signal.aborted) throw new HttpError(503, `Immich didn't answer within ${ms / 1000} s.`, 'unavailable');
        throw unavailable();
      } finally {
        clearTimeout(timer);
      }
      if (isGatePage(res) || res.status === 503) {
        await res.body?.cancel();
        this.state = 'unknown';
        continue;
      }
      return res;
    }
    throw unavailable();
  }

  /** GET (or HEAD) a media path. Returns Immich's response as is (status, headers, body). */
  async media(path: string, opts: {method?: 'GET' | 'HEAD'; query?: Record<string, string>; range?: string; signal?: AbortSignal} = {}): Promise<Response> {
    const headers: Record<string, string> = {'x-api-key': this.opts.apiKey};
    if (opts.range) headers.range = opts.range;
    return this.fetchUp(path, {method: opts.method, query: opts.query, headers, signal: opts.signal});
  }

  /**
   * GET a JSON path and return its parsed body. 400/404 → not found, 401/403 → key rejected,
   * other non-ok or non-JSON responses → 502.
   */
  async json<T = unknown>(path: string, query?: Record<string, string>, signal?: AbortSignal): Promise<T> {
    const res = await this.fetchUp(path, {headers: {'x-api-key': this.opts.apiKey, accept: 'application/json'}, query, signal});
    if (!res.ok) {
      void res.body?.cancel();
      if (res.status === 400 || res.status === 404) throw new HttpError(404, 'Not found in Immich.', 'not-found');
      if (res.status === 401 || res.status === 403) throw new HttpError(502, KEY_PERMISSIONS, 'auth');
      throw new HttpError(502, `Immich returned ${res.status}.`);
    }
    if (!(res.headers.get('content-type') ?? '').startsWith('application/json')) {
      void res.body?.cancel();
      throw new HttpError(502, 'Immich returned a non-JSON response.');
    }
    return res.json() as Promise<T>;
  }
}
