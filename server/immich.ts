// Talks to Immich (usually through the on-demand gate). Every upstream request is built here
// from validated inputs; nothing from the browser request is forwarded except an explicit Range.

export type ImmichState = 'unknown' | 'waking' | 'up' | 'down';

/** An error with the status and message the viewer should answer with. */
export class HttpError extends Error {
  readonly status: 404 | 502 | 503;
  constructor(status: 404 | 502 | 503, message: string) { super(message); this.status = status; }
}

const unavailable = () => new HttpError(503, 'Immich is not reachable right now. It may still be starting; retry in a few seconds.');

export interface ImmichOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  wakeTimeoutMs?: number;
  pollMs?: number;
}

// While Immich starts, the gate answers every request with its loading page: 200 text/html.
// Immich itself never returns HTML under /api, so that combination means "not up yet".
const isGatePage = (res: Response) =>
  res.status === 200 && (res.headers.get('content-type') ?? '').startsWith('text/html');

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class ImmichClient {
  state: ImmichState = 'unknown';
  private waking: Promise<void> | null = null;
  private readonly fetch: typeof fetch;
  private readonly base: string;
  private readonly opts: ImmichOptions;

  constructor(opts: ImmichOptions) {
    this.opts = opts;
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.base = opts.baseUrl.replace(/\/+$/, '');
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
   * GET (or HEAD) a media path. Returns Immich's response as is, except that the gate page,
   * gate 503 and network failures become a 503 HttpError. Redirects are not followed: they would
   * carry the API key to wherever they point.
   */
  async media(path: string, opts: {method?: 'GET' | 'HEAD'; query?: Record<string, string>; range?: string; signal?: AbortSignal} = {}): Promise<Response> {
    const headers: Record<string, string> = {'x-api-key': this.opts.apiKey};
    if (opts.range) headers.range = opts.range;
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.wake();
      opts.signal?.throwIfAborted();
      let res: Response;
      try {
        res = await this.fetch(this.url(path, opts.query), {method: opts.method ?? 'GET', headers, redirect: 'manual', signal: opts.signal});
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        this.state = 'unknown';
        throw unavailable();
      }
      if (isGatePage(res) || res.status === 503) {
        // Immich was stopped by the gate since we last saw it; wake it again and retry once.
        await res.body?.cancel();
        this.state = 'unknown';
        continue;
      }
      return res;
    }
    throw unavailable();
  }
}
