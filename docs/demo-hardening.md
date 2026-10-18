# Demo hardening

How the public demo is protected. The point is that a public, unauthenticated viewer is a different
thing from a normal deployment, which must sit behind auth on every path ([README](../README.md#security)).

- **No real library.** Demo mode (`DEMO=1`) talks to a small Immich stub serving a fixed, openly
  licensed photo set ([demo/README.md](../demo/README.md)). It refuses to start unless
  `IMMICH_API_KEY=demo`, so it can't be pointed at a real Immich by mistake, and its errors don't
  name internal URLs.
- **Isolation.** Viewer and stub run on internal Docker networks: the viewer is reachable only from
  the reverse proxy, the stub only from the viewer. Neither can reach the internet, the host or
  other services.
- **Containers.** Read-only root filesystem, no capabilities, `no-new-privileges`, pids, memory, CPU
  and file descriptor limits, log rotation. The stub streams byte ranges instead of reading whole
  files.
- **Reverse proxy.** Strips cookies, authorization and identity headers on the way in and
  `Set-Cookie` on the way out. Only GET/HEAD, small bodies, no WebSockets. CSP and the usual
  security headers. Refuses known crawlers and cross-site media requests.
- **Rate and bandwidth limits.** Per-IP and site-wide request limits, split by media kind
  (thumbnails are cheap, previews and videos are not), plus a cap on the demo's upload bandwidth.
  The limits sit well above what an active visitor makes, so nobody exploring the demo is
  throttled. The viewer backs off on the proxy's JSON 429 responses, and has its own ceiling on
  media requests (`DEMO_MEDIA_WINDOWS` in `web/src/lib/lightbox/media.ts`) below the proxy's.
- **Monitoring.** A dedicated access log, traffic and limit alerts, and bans for clients that keep
  hammering the limits.
- **Privacy.** No cookies, analytics or client telemetry. The server logs only its own upstream
  failures.

## What an active visitor makes

Measured 2026-10-16 on a fast local network (Playwright, the viewer uncapped; requests that reached
the server, not the browser cache), busiest window. The proxy's per-IP limits and the viewer's
`DEMO_MEDIA_WINDOWS` are set from this.

| Session | thumbnails / 20 s | heavy / 20 s | non-thumbnail / 6 s |
|---|---|---|---|
| Play the demo trip (~45 s) | 95 | 0 | 76 |
| Scrub the strip end to end, 12 times | 14 | 0 | – |
| Hop all trips, fling each grid end to end and back | 291 (312 / 30 s) | 0 | 154 |
| Phone lightbox, 90 fast swipes | 32 | 58 | 110 |
| Desktop lightbox, → tapped 9×/s | 1 | 129 | 107 |
| Desktop lightbox, → held (key repeat) through the trip | 1 | 190 | 289 |

Holding → is the heaviest: each step requests the photo's preview (its own `<img>`, not queued) and
its `/api/demo` credit.
