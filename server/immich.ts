// Talks to Immich (directly, or through an on-demand wake gate). Every upstream request is built
// here from validated inputs; nothing from the browser request is forwarded except an explicit Range.

import {createHash} from 'node:crypto';
import type {ApiError} from '../shared/api.ts';

export type ImmichState = 'unknown' | 'waking' | 'up' | 'down';
export type ErrorCode = NonNullable<ApiError['code']>;

/** An error with the status and message the viewer should answer with. */
export class HttpError extends Error {
  readonly status: 404 | 502 | 503;
  readonly code?: ErrorCode;
  readonly missingPermission?: string;
  constructor(status: 404 | 502 | 503, message: string, code?: ErrorCode, missingPermission?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.missingPermission = missingPermission;
  }
}

export const PERMISSIONS = 'asset.read, asset.view, album.read';
const unavailable = () => new HttpError(503, 'Immich is not reachable right now. It may still be starting; retry in a few seconds.', 'unavailable');

/** 401/403 → `auth`, naming the permission when Immich does ("Missing required permission: album.read"). */
export async function keyRejected(res: Response): Promise<HttpError> {
  let reason = '';
  try {
    const m = ((await res.json()) as {message?: unknown}).message;
    if (typeof m === 'string' && m.length < 200) reason = m;
  } catch {
    // not JSON; the status alone has to do
  }
  const missing = /^Missing required permission: ([a-z.]+)$/.exec(reason)?.[1];
  if (missing) return new HttpError(502, `The viewer's API key lacks the ${missing} permission. It needs ${PERMISSIONS}.`, 'auth', missing);
  return new HttpError(502, `Immich rejected the viewer's API key${reason ? ` (${reason})` : ''}. Check IMMICH_API_KEY and its permissions: ${PERMISSIONS}.`, 'auth');
}

/** A short reason for a failed connection: Node's fetch hides it in `cause` (and sometimes `cause.errors`). */
export function connectFailure(err: unknown): string {
  const cause = (err as {cause?: {code?: string; message?: string; errors?: {code?: string}[]}})?.cause;
  const code = cause?.code ?? cause?.errors?.[0]?.code;
  switch (code) {
    case 'ENOTFOUND': case 'EAI_AGAIN': case 'EAI_NONAME': return 'host name not found (DNS)';
    case 'ECONNREFUSED': return 'connection refused';
    case 'EHOSTUNREACH': case 'ENETUNREACH': return 'host unreachable';
    case 'ECONNRESET': return 'connection reset';
    case 'ETIMEDOUT': case 'UND_ERR_CONNECT_TIMEOUT': return 'connection timed out';
  }
  if (code?.startsWith('ERR_TLS') || code?.includes('CERT')) return `TLS error (${code})`;
  return code ?? cause?.message ?? (err instanceof Error ? err.message : String(err));
}

export interface ImmichOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  /** How long to wait for a waking Immich (behind the gate) before giving up. */
  wakeTimeoutMs?: number;
  pollMs?: number;
  /**
   * Per upstream request, until its headers arrive (a video body may then stream for as long as it
   * takes); JSON requests are bounded until the body is parsed.
   */
  requestTimeoutMs?: number;
  /** Names the upstream in client-facing errors instead of `IMMICH_URL=<url>` (the public demo). */
  publicName?: string;
}

// While Immich starts, the gate answers every request with its loading page: 200 text/html.
// Immich itself never returns HTML under /api, so that combination means "not up yet".
export const isGatePage = (res: Response) =>
  res.status === 200 && (res.headers.get('content-type') ?? '').startsWith('text/html');

/**
 * For a ping that got HTML: the gate's loading page, or Immich's own web app? The latter means
 * IMMICH_URL has an extra path (Immich serves its SPA for any unknown non-/api path). Immich is
 * Express and its SvelteKit page loads /_app/immutable/; a loading page has neither. Reads the body.
 */
export async function wrongPathToWebApp(res: Response) {
  if (res.headers.has('x-powered-by')) { await res.body?.cancel(); return true; }
  return (await res.text().catch(() => '')).includes('/_app/immutable/');
}

const isJson = (res: Response) => (res.headers.get('content-type') ?? '').startsWith('application/json');
const isTimeout = (reason: unknown) => (reason as {name?: string} | undefined)?.name === 'TimeoutError';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class ImmichClient {
  state: ImmichState = 'unknown';
  /** Stable, opaque id of (Immich URL, API key); namespaces the browser cache. */
  readonly library: string;
  readonly baseUrl: string;
  private waking: Promise<void> | null = null;
  private readonly fetch: typeof fetch;
  private readonly opts: ImmichOptions;
  private readonly requestTimeoutMs: number;

  constructor(opts: ImmichOptions) {
    this.opts = opts;
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 30_000;
    this.library = createHash('sha256').update(`${opts.baseUrl}\n${opts.apiKey}`).digest('hex').slice(0, 16);
  }

  private get where() {
    return this.opts.publicName ?? `IMMICH_URL=${this.baseUrl}`;
  }

  private url(path: string, query?: Record<string, string>) {
    const u = new URL(this.baseUrl + '/api' + path);
    for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v);
    return u;
  }

  private unreachable(err: unknown) {
    return new HttpError(502, `Cannot reach Immich at ${this.where}: ${connectFailure(err)}.`, 'unreachable');
  }

  webAppNotApi() {
    return new HttpError(502, `${this.where} answers with Immich's web page instead of its API: drop the extra path, IMMICH_URL is the address Immich's web UI opens at (e.g. http://immich-server:2283).`, 'upstream');
  }

  /** 503 like a sleeping Immich: the client retries it. */
  private timedOut(ms: number) {
    return new HttpError(503, `Immich didn't answer within ${ms / 1000} s.`, 'unavailable');
  }

  /**
   * One upstream fetch. The timeout covers getting the response headers only, so a long video
   * stream isn't cut; the caller's signal (browser disconnect) aborts it at any point. A caller
   * abort rethrows as is; a timeout or network failure becomes an HttpError.
   */
  private async send(url: URL, init: RequestInit, timeoutMs: number): Promise<Response> {
    const caller = init.signal ?? undefined;
    caller?.throwIfAborted();
    const ctl = new AbortController();
    const onAbort = () => ctl.abort(caller!.reason);
    caller?.addEventListener('abort', onAbort, {once: true});
    const timer = setTimeout(() => ctl.abort(new DOMException('upstream timeout', 'TimeoutError')), timeoutMs);
    try {
      return await this.fetch(url, {...init, signal: ctl.signal});
    } catch (err) {
      caller?.removeEventListener('abort', onAbort);
      // The caller's own signal may be a timeout too (json() bounds the body with one).
      if (isTimeout(ctl.signal.reason)) throw this.timedOut(timeoutMs);
      if (caller?.aborted) throw err;
      throw this.unreachable(err);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Single-flight: concurrent callers share one wake-up instead of storming a cold server. */
  wake(): Promise<void> {
    if (this.state === 'up') return Promise.resolve();
    this.waking ??= this.doWake().finally(() => { this.waking = null; });
    return this.waking;
  }

  /**
   * Pings until Immich answers. Waits (up to wakeTimeoutMs) only while a wake gate's loading page
   * says Immich is starting; a refused connection, DNS failure or a non-Immich answer fails at once.
   */
  private async doWake() {
    this.state = 'waking';
    const wakeMs = this.opts.wakeTimeoutMs ?? 60_000;
    const deadline = Date.now() + wakeMs;
    let gate = false;
    while (Date.now() < deadline) {
      let res: Response;
      try {
        // A stopped gate holds the first request while it starts Immich, so allow the whole wake
        // budget; the signal also bounds reading the body, so a hung gate can't hold the wake forever.
        const remaining = Math.max(1, deadline - Date.now());
        res = await this.send(this.url('/server/ping'), {redirect: 'manual', signal: AbortSignal.timeout(remaining)}, remaining);
      } catch (err) {
        // Immich restarting behind the gate can drop a connection: keep polling. Before the gate
        // was seen, a failure is the answer.
        if (!gate) { this.state = 'down'; throw err; }
        await sleep(this.opts.pollMs ?? 500);
        continue;
      }
      // The gate returns 503 when it refuses to start Immich (photo mount missing).
      if (res.status === 503) { await res.body?.cancel(); break; }
      if (isGatePage(res)) {
        if (await wrongPathToWebApp(res)) { this.state = 'down'; throw this.webAppNotApi(); }
        gate = true;
        await sleep(this.opts.pollMs ?? 500);
        continue;
      }
      const pong = res.ok && isJson(res) && ((await res.json().catch(() => null)) as {res?: string} | null)?.res === 'pong';
      if (pong) { this.state = 'up'; return; }
      if (!res.bodyUsed) await res.body?.cancel();
      this.state = 'down';
      throw new HttpError(502, `${this.where} does not look like Immich: /api/server/ping answered HTTP ${res.status}${res.ok ? ' without a pong' : ''}. It should be Immich's base URL, without /api.`, 'upstream');
    }
    this.state = 'down';
    throw unavailable();
  }

  /**
   * Issues one upstream request, waking Immich first and retrying once if the gate page or a
   * gate 503 comes back instead (it was stopped since we last saw it). Redirects are not
   * followed: they would carry the API key to wherever they point.
   */
  private async fetchUp(path: string, opts: {method?: 'GET' | 'HEAD'; query?: Record<string, string>; headers: Record<string, string>; signal?: AbortSignal}): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.wake();
      opts.signal?.throwIfAborted();
      let res: Response;
      try {
        res = await this.send(this.url(path, opts.query), {method: opts.method ?? 'GET', headers: opts.headers, redirect: 'manual', signal: opts.signal}, this.requestTimeoutMs);
      } catch (err) {
        if (err instanceof HttpError) this.state = 'unknown';
        throw err;
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
   * other non-ok or non-JSON responses → 502. The timeout covers reading the body too.
   */
  async json<T = unknown>(path: string, query?: Record<string, string>, signal?: AbortSignal): Promise<T> {
    await this.wake(); // has its own budget; the request timeout starts once Immich is up
    const timeout = AbortSignal.timeout(this.requestTimeoutMs);
    try {
      const res = await this.fetchUp(path, {headers: {'x-api-key': this.opts.apiKey, accept: 'application/json'}, query, signal: signal ? AbortSignal.any([signal, timeout]) : timeout});
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) throw await keyRejected(res);
        void res.body?.cancel();
        if (res.status === 400 || res.status === 404) throw new HttpError(404, 'Not found in Immich.', 'not-found');
        throw new HttpError(502, `Immich returned ${res.status}.`, 'upstream');
      }
      if (!isJson(res)) {
        void res.body?.cancel();
        throw new HttpError(502, 'Immich returned a non-JSON response.', 'upstream');
      }
      return (await res.json()) as T;
    } catch (err) {
      if (!(err instanceof HttpError) && timeout.aborted && !signal?.aborted) throw this.timedOut(this.requestTimeoutMs);
      throw err;
    }
  }

  /**
   * One request without waking or retrying, for the boot self-check. `auth` adds the API key.
   * Network failures and timeouts throw HttpError (`unreachable` / `timeout`).
   */
  probe(path: string, opts: {auth?: boolean; method?: 'GET' | 'HEAD'; timeoutMs?: number} = {}): Promise<Response> {
    const headers: Record<string, string> = opts.auth ? {'x-api-key': this.opts.apiKey} : {};
    const ms = opts.timeoutMs ?? this.requestTimeoutMs;
    return this.send(this.url(path), {method: opts.method ?? 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(ms)}, ms);
  }
}
