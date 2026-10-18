# Deploying Retrace

Everything about running Retrace for Immich: setup options, configuration, map tiles, putting it
behind authentication, updating and troubleshooting. The short version is in the
[README](README.md#quick-start).

## Requirements

- Immich v3.x (developed against v3.1.0, runs on v3.3.3). The viewer uses Immich's timeline
  endpoints, which Immich marks as internal, so a new Immich major version can break it. The server
  logs a warning at startup when it finds a major version other than 3.
- An Immich API key with exactly these permissions (Immich → Account Settings → API Keys → New API Key):

  | Permission | Used for |
  |---|---|
  | `asset.read` | the timeline (`/timeline/buckets`, `/timeline/bucket`): dates, locations, thumbhashes |
  | `asset.view` | thumbnails, previews and video playback |
  | `album.read` | the album list and album members |

  The viewer shows whatever this key can see: the key owner's library plus albums shared with them.
- Docker (the image is `ghcr.io/holoskii/immich-retrace`, amd64 and arm64), or Node.js 24 to run it
  without Docker.

## Setup

The viewer's server has to reach Immich; the browser only talks to the viewer.

### Option A: next to Immich

Add the viewer to Immich's own `docker-compose.yml`. It then shares Immich's network and reaches it
as `immich-server`:

```yaml
  immich-retrace:
    container_name: immich-retrace
    image: ghcr.io/holoskii/immich-retrace:latest
    environment:
      IMMICH_URL: http://immich-server:2283
      IMMICH_API_KEY: ${IMMICH_RETRACE_API_KEY}   # put IMMICH_RETRACE_API_KEY=… in Immich's .env
    ports:
      - 127.0.0.1:8080:8080
    restart: unless-stopped
```

Then `docker compose up -d immich-retrace`.

### Option B: on its own

Use this repository's [docker-compose.yml](docker-compose.yml) and [.env.example](.env.example):

```bash
mkdir immich-retrace && cd immich-retrace
curl -fsSLO https://raw.githubusercontent.com/holoskii/immich-retrace/main/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/holoskii/immich-retrace/main/.env.example
# set IMMICH_URL and IMMICH_API_KEY in .env
docker compose up -d
```

With no shared network, `IMMICH_URL` is an address the container can reach, e.g. the host's LAN IP
(`http://192.168.1.10:2283`); or uncomment the `networks` block in the compose file to join Immich's
network and keep `http://immich-server:2283`.

Either way the viewer listens on http://127.0.0.1:8080 of the Docker host only. Before opening it
up to anything else, read [Security](#security). The first log lines tell you whether it can reach
Immich (see [Troubleshooting](#troubleshooting)).

### Without Docker

Node.js 24 runs the server's TypeScript directly:

```bash
git clone https://github.com/holoskii/immich-retrace && cd immich-retrace
npm ci && npm run build
IMMICH_URL=http://localhost:2283 IMMICH_API_KEY=… npm start
```

### Building the image yourself

`docker build -t immich-retrace .` in a clone, then use `image: immich-retrace` in place of the
GHCR image.

## Updating

```bash
docker compose pull && docker compose up -d
```

`latest` follows the main branch. To stay on a release, use a version tag instead, e.g.
`ghcr.io/holoskii/immich-retrace:0.1`.

## Configuration

Environment variables (Docker: `.env` or `environment:`). Empty values count as unset.

| Variable | Required | Default | What |
|---|---|---|---|
| `IMMICH_URL` | yes | | Immich's base URL **as the viewer's server reaches it**, with the scheme and without `/api`, e.g. `http://immich-server:2283`. A path is allowed when Immich itself is served under one. |
| `IMMICH_API_KEY` | yes | | API key with `asset.read`, `asset.view`, `album.read`. Stays on the server; the browser never sees it. |
| `IMMICH_PUBLIC_URL` | no | none | Immich's URL as the **browser** reaches it, for "Open in Immich" links. Unset: no links. |
| `MAP_STYLE_URL` | no | `https://tiles.openfreemap.org/styles/dark` | A [MapLibre style](https://maplibre.org/maplibre-style-spec/) JSON URL, loaded by the browser. |
| `PORT` | no | `8080` | Port the server listens on (inside the container). |
| `WEB_DIR` | no | `dist/web` | Built web app to serve (the Docker image sets it). |

A missing or malformed setting stops the server with a one-line message naming it. The public demo's
own settings (`DEMO`, `DEMO_TRIP`, `REPO_URL`, `DEMO_MANIFEST`) are described in [demo/README.md](demo/README.md).

### Map tiles

The default map is [OpenFreeMap](https://openfreemap.org)'s public instance: free, no API key, no
registration; its terms ask for attribution, which the map shows (the ⓘ button in the corner). For
your own tiles, serve [Protomaps](https://docs.protomaps.com/) PMTiles or an
[OpenFreeMap](https://github.com/hyperknot/openfreemap) instance yourself and point `MAP_STYLE_URL` at
its style JSON. Other OpenFreeMap styles: `…/styles/liberty`, `…/styles/positron`, `…/styles/bright`.

## Security

**The viewer has no login of its own.** Anyone who can reach it sees the whole library the API key
can read, photos and videos included, through the operator's key. So:

- Keep the port bound to `127.0.0.1` (as in the compose files) or to a private network.
- To use it from elsewhere, put it behind a reverse proxy **with authentication on every path**:
  the page, its `/assets/` bundle, the `/api/*` endpoints and the media under `/api/assets/*`.
  Don't add unauthenticated exceptions for static files or the API (for example, Nginx Proxy
  Manager's "Cache Assets" option adds a separate location for static files that skips an
  auth snippet placed in `location /`).

A minimal [Caddy](https://caddyserver.com) example with HTTP basic auth (hash the password with
`caddy hash-password`):

```caddyfile
viewer.example.com {
	basic_auth {
		alice $2a$14$…hash…
	}
	reverse_proxy 127.0.0.1:8080
}
```

Single sign-on works the same way: `forward_auth` (Caddy) or `auth_request` (nginx) to Authelia,
Authentik or oauth2-proxy, applied to the whole site. Everything the browser loads is same-origin, so
the proxy's session cookie covers the API and media requests too.

The server only forwards its own requests to Immich, built from validated parameters (asset and album
ids, months); it never passes on the browser's cookies, headers or query strings, and does not follow
redirects (which would carry the API key along).

## Troubleshooting

The server checks Immich once at startup and logs the outcome, e.g.:

```
immich-retrace listening on :8080, Immich at IMMICH_URL=http://immich-server:2283
self-check: Immich 3.3.3 at IMMICH_URL=http://immich-server:2283, API key OK (asset.read, asset.view, album.read)
```

The same messages show up in the browser when a request fails.

| Message | Fix |
|---|---|
| `IMMICH_URL is not set` / `IMMICH_API_KEY is not set` | Set it (see [Configuration](#configuration)). In Docker, check the `.env` file is next to the compose file. |
| `IMMICH_URL must start with http:// or https://` | Add the scheme: `http://immich-server:2283`, not `immich-server:2283`. |
| `IMMICH_URL must be Immich's base URL without /api` | Drop the `/api`; the viewer adds it. |
| `Cannot reach Immich …: host name not found (DNS)` | The name doesn't resolve from the viewer's container. Put both on one Docker network ([option A](#option-a-next-to-immich)) or use an IP address. `localhost` inside a container is the container itself. |
| `Cannot reach Immich …: connection refused` | Nothing listens there: wrong port (Immich's container port is `2283`, whatever you publish on the host) or Immich is down. |
| `… answers with Immich's web page instead of its API` | `IMMICH_URL` has an extra path; use the address Immich's web UI opens at. |
| `… /api/server/ping answered HTTP 404` (or another status) | That URL isn't Immich (another service, or a proxy in between). |
| `Immich rejected the viewer's API key (Invalid API key)` | Wrong or revoked key: create a new one. |
| `The viewer's API key lacks the album.read permission` (or another) | Edit the key in Immich and add the permission named. |
| `Immich didn't answer within 30 s.` | Immich took the connection but is very slow or stuck; check its logs. The browser retries a few times. |
| `Immich is not reachable right now. It may still be starting` | Immich sits behind an on-demand proxy whose loading page didn't turn into Immich within 60 s. |
| Map stays empty, photos load | The browser can't load `MAP_STYLE_URL` or its tiles (blocked domain, offline network). Try the URL in the browser. |
| Self-check warns about an untested Immich version | See [Requirements](#requirements); please [open an issue](https://github.com/holoskii/immich-retrace/issues) with what breaks. |
