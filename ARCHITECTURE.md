# Architecture

How Retrace for Immich is put together and why: code layout, the design decisions behind the UI,
the backend's contract with Immich, and notes on Immich's API. User-facing docs are in the
[README](README.md); what's still open is in [docs/roadmap.md](docs/roadmap.md).

Retrace reads Immich (v3) and never writes to it. Immich has no UI extension points (v3 plugins are
server-side WASM workflow steps only), so this is a standalone app. Using Svelte 5 and MapLibre like
Immich does keeps an upstream PR possible.

## Code layout

| Path | What |
|---|---|
| `server/` | Hono backend, run directly by Node 24 (type stripping: no parameter properties, enums or namespaces; `erasableSyntaxOnly` enforces it). `config.ts` env + IMMICH_URL validation, `immich.ts` upstream client (wake, timeouts, error codes), `adapter.ts` versioned Immich adapter, `app.ts` routes, `selfcheck.ts` boot check, `static.ts` + `precompress.ts` serve the web build |
| `web/` | Svelte 5 + Vite frontend, built to `dist/web/`. `lib/index/` index + IndexedDB cache; `lib/selection.svelte.ts` selection, cursor, lightbox row and URL state, the contract between views; `lib/place.ts` a place selection's circle, row filter and `near=`; `lib/actions.ts` what a pick, mode switch, clear or Back does to it and the URL (any shell); `lib/albums.ts` (counts, album spans and names, formatting) and `lib/trips.ts` (trip heuristic), shared by both shells; `overview/` (desktop only), `mobile/` (phone shell: `MobileShell.svelte`, pill, dock, strip, Photos and Trips tabs; pure logic in `tabs.ts`, `strip.ts`, `player.ts`, `format.ts`, `share.ts`, `grid.ts`, `thumbs.ts`), `public/` (web manifest, icons), `map/` (route, strip, stops in `stops.ts`, follow camera in `camera.ts` + worker, `follow.ts`, `inset.ts`, chunk loader `load.ts`), `lightbox/` |
| `shared/api.ts` | The viewer's own API types (backend ↔ browser) and `SCHEMA_VERSION` |
| `demo/` | Public demo: dataset manifest + credits, builder, Immich stub + its `Dockerfile` ([demo/README.md](demo/README.md)); `docker-compose.demo.yml` runs stub + viewer |
| `server/demo.ts`, `shared/demo.ts`, `web/src/lib/demo/` | Demo mode (`DEMO=1`), isolated so it can move out: one call in `server/main.ts`, a lazy chunk from `App.svelte` (`Demo.svelte`) or the phone shell (`PhoneDemo.svelte`), the landing in `land.svelte.ts`, plugged in through `web/src/lib/hooks.svelte.ts` and `actions.ts` (`pickAlbum` for the landing) |
| `tests/` | vitest; server tests use a fake gate/Immich (`fetch` injected into `ImmichClient`) |
| `e2e/` | Playwright, self-contained (own `package.json`; `node_modules`, browsers in `.browsers/`, WebKit's missing system libs in `.deps/` all gitignored; `e2e/setup.sh` installs without root). Projects `Pixel 7` (Chromium, real touches via CDP), `iPhone 15` (WebKit, synthetic touch pointer events: Linux WebKit is not iOS Safari and plays no H.264) and `Desktop Chrome`. Builds, then starts the demo stub on :2293 and the viewer on :8092 itself (`E2E_REUSE=1` uses ones already running). Needs `demo/data/media` |
| `.env` | from `.env.example`; holds the API key (gitignored) |
| `README.md`, `DEPLOYMENT.md` | user-facing docs: the README is the pitch and the happy path; DEPLOYMENT.md has setup options, the env table, security and troubleshooting (keep it in sync with `server/config.ts` and the error texts) |
| `.github/workflows/image.yml` | CI: tests, then the amd64 + arm64 image to `ghcr.io/<owner>/immich-retrace` (`latest` from main, `X.Y.Z` from tags) |
| `sketches/template.html` | UI sketch source; the data (personal GPS) was injected at `/*__DATA__*/` and is not in the repo |

```bash
npm test && npm run check && npm run build        # unit tests, svelte-check + tsc, web build
npm run build && npx vitest run tests/bundle.test.ts   # phone budget check reads the last build (skipped without one)
e2e/setup.sh && npm --prefix e2e test              # phone e2e (setup once): builds, runs demo stub + viewer itself
IMMICH_URL=http://localhost:2283 IMMICH_API_KEY=… node server/main.ts   # local run on :8080 (serves dist/web);
                                                    # `npm run dev:web` proxies /api to it
```

URL state: `?from=YYYY-MM-DD&to=YYYY-MM-DD` (local days, `to` inclusive; or `…T14:00Z`, UTC to the
minute, `to` exclusive, after a cluster zoom) or `?album=<uuid>[&mode=range][&from=…&to=…]` or
`?near=<lat>,<lon>,<radius m>&from=…&to=…` (a place: only the photos within the circle in that span), plus `&at=<ms>`
(cursor) and `&lb=<asset id>` (open photo).

## Decisions

- No built-in login. Anyone who can reach the viewer sees the whole library the key can read; the
  docs tell operators to put auth on every path. Mobile: only the public demo gets a phone shell (below); owner mode on a phone keeps the desktop one. Code is MIT;
  demo data keeps its per-file CC licences.
- The demo lives in main: UI isolated in `web/src/lib/demo/` (lazy chunk) and `server/demo.ts`, dataset
  and `docker-compose.demo.yml` in the same repo. No long-lived demo branch.
- Layout L-A: overview strip on top; below it the photo-wave (left) and the map (right). Until
  the photo-wave exists, the map takes the full width. A window under 800 px tall (`SHORT_VIEWPORT` in
  `overview/draw.ts`, e.g. 1280×720, 1366×768) gets a lower wave (44 px, was 94) and strip, no hint line (the colour
  key moves into the readout, which stays one line with an ellipsis); the whole-trip inset needs a map ≥ 350 px tall.
  The map keeps ≥ 50 % of the height (1280×720: 379 px, 1024×768: 427 px). The desktop shell's grid column is
  `minmax(0, 1fr)`, so a one-line row never widens the page.
- Overview O-A: thin all-years context strip with a viewport window, zoomed wave below it.
  Selection: drag to create, drag the middle to move, drag an edge to resize. A double click on
  either timeline (or Esc) clears it; a single click never does (on the strip it recentres the
  window), so a stray click can't lose a selection. An album rail under
  the wave; clicking an album selects its date range. The default view is the 12 months ending at
  the last asset (all of it if the span is under 2 years), ignoring outlier dates. Timeline colours
  for GPS vs. no GPS differ in lightness, with an always-visible key.
- Map: route coloured by time with clustered photo pins (M-A), plus a density strip with scrubber
  and the nearest photo popping out next to the position marker (from M-B).
  Camera: a target path precomputed every 10 min. Center is the time-weighted mean of GPS points
  (Gaussian σ 1.5 h, blended toward 6 h / 24 h / whole-trip stats where weight is low), extent is
  2.4 × the weighted spread (min ~1.3 km), smoothed over σ 30 min. The view follows it with a
  critically damped spring (pan ω 5, zoom ω 3.5) and zooms out while far from the target; the
  marker has its own faster spring. Driven per frame via `jumpTo`, not `easeTo`. Whole-trip inset.
  Controls: a Follow toggle and Fit (frames the whole selection). A manual zoom or pan pauses
  Follow until it is clicked again or a new selection starts (`camNext` in `map/follow.ts`). The demo landing is
  framed whole (Fit) with Follow still the automatic mode: the first ▶ or scrub turns Follow on and flies in
  (`land` / `play` events; after an explicit Fit or a pan they change nothing). The same selection applied again
  (Back or Forward re-applying the URL, closing the lightbox) is not a new one: the camera keeps its state.
- Play (time strip button, or `Space` outside fields and buttons): the cursor steps photo by photo, every photo,
  never skipping one (`map/play.ts`, planned once per selection). Each step is a burst (both photos in the same stop,
  `stops.ts`, whatever the time gap; or ≤ 90 s apart), a flight (the next photo ≥ 5 km from the last fix: the
  camera travels) or an ordinary step; unscaled 350 / 1800 / 900 ms. The whole run is scaled to last ~45 s, but
  no dwell goes under its floor (150 ms burst, 1.2 s before a flight, 400 ms ordinary), so a short trip keeps the
  unscaled pace and a long selection (an owner's year of 5 000 photos: ~13 min) plays every photo at the floors:
  the rule is "≤ 45 s when the floors allow". The demo trip: 194 photos in ~45 s, first flight 1.3 s after ▶ from
  the landing. `prefers-reduced-motion`: the camera jumps, no photo faster than 800 ms, 2.5 s before a jump to
  another place (~2.7 min for the demo trip). It counts as a scrub, so Follow flies
  along. It moves the cursor within the current history entry (replaceState, at most once a
  second), like lightbox stepping. It never starts on its own; a drag, arrow key, new selection or
  the lightbox stops it, an index refresh doesn't.
- Demo mode (`DEMO=1`): a URL without viewer state (`URL_KEYS`; tracking keys like `utm_*` don't count and are kept)
  lands on a curated trip framed whole (Fit: the route is the story), the cursor on the photo Play's first flight
  leaves from (`landingRow`: the last landscape GPS photo before it; a representative one for a one-place trip), so the
  first ▶ flies in and on to the next stop within ~1–2 s; desktop: banner and
  pitch, a 3-step coach mark once per visitor; phone: a one-line pitch under the pill ("Your trips, retraced…
  · Tap ▶", About link, ✕) once per visitor (`demo/Pitch.svelte` via `hooks.phoneMapNote`, gone for good after the
  first ▶ or ✕; the camera keeps clear of it), About with the call to action first and the data changes folded;
  About & credits, per-photo credits in the lightbox. The landing doesn't wait for the library index: the server
  resolves `DEMO_TRIP` to an album id (`tripResolver`, once, ≤ 1.5 s per `/api/config`, else null and the browser
  matches the name), `main.ts` fetches its members at t0 (`library.prefetchMembers`), a URL without viewer state is
  applied at once (`urlReady`), and the landing opens once the members and album list are in; their offsets stand in
  for the index's (`library.offsets`) and a whole album compares by id and mode (`sameSelection`), so the index
  arriving changes nothing. The overview holds its default view while `selection.awaitingLanding`. Throttled 4G:
  landed 3.5 → 1.4 s on both shells. The desktop coach mark starts once the map has shown the trip (`mapShown`), Play
  first. In the demo every album up to 45 days is a trip (`hooks.allTrips`), as on the phone; the banner is one line.
  Hides the ⋯ menu, month counters and "Open in Immich". With demo mode off, no demo code is in the
  eager chunk. The server adds Open Graph tags to `/` (demo only: a normal deployment is behind auth, where
  chat apps never see the page, and sample-data tags would misdescribe a private library); the image is
  `web/public/og.jpg` (1200×630, a picture of the demo landing made by `demo/og-image.mjs`; its card's photo,
  `OG_ASSET_TITLE`, credited in the description), absolute URLs from Host + `X-Forwarded-Proto`.
- Phone shell (`web/src/lib/mobile/`, demo only: an owner's phone keeps the desktop shell; spec
  [docs/mobile/demo-scope.md](docs/mobile/demo-scope.md)): fixed non-scrolling root, tabs Map · Photos · Trips
  The tab is not in the URL: it follows the selection (`tabs.ts`), switches add
  no history. Map tab: full-bleed map (`MapView` with `phone`: no zoom buttons, legend, inset, tips, pop-out card,
  strip or visits menu; 44 px Follow / Fit; a tap within 22 px seeks to a pin or zooms a cluster), a floating
  two-line pill (⋯ = Share, About), and a dock below it: photo card (tap → touch lightbox; its first image is the
  LCP, `fetchpriority="high"`; later ones through `lightbox/card.ts` `CardImage`, shared with the desktop pop-out
  card: the photo's own thumbhash until its thumbnail is in, never another photo's; a scrub loads one at a time, back to
  back, each for the photo at the cursor when the last one finished (latest wins), made explicit once the cursor
  rests 120 ms, superseded waiting loads dropped, the last 24 kept; while playing it starts nothing itself but
  prefetches at once (background) the photos Play reaches 0.4–2.5 s ahead that it lingers on longest (`playAhead`:
  the pause before a flight first, then ordinary steps); covered by another tab or the lightbox it loads nothing), time strip
  (touch jumps, drag scrubs, ▾ stop ticks) and ⏮ ▶ ⏭ by stop. `at` is
  only ever replaced; a link without one (or with one outside the selection) gets the cursor on `representativeRow`
  (`map/route.ts`, as the landing). The dock never stays a placeholder: the trip's photos failing show the error and
  "Try again", an empty selection "Choose a trip". Map and dock are one `minmax(0, 1fr)` column (long stop names
  ellipsise, never widen it). The attribution folds to its ⓘ once the map is idle. One MapLibre instance: hidden tabs use `visibility: hidden`; under another tab or the
  lightbox the camera rests (`covered`) and Play stops (also on a hidden page). Play steps on wall-clock deadlines
  (`player.ts`). Photos (lazy chunk `Photos.svelte`, maths in `grid.ts`, thumbnails in `thumbs.ts`): the selection
  as a 3-column grid of square cells under sticky local-day headers (each photo's own offset), virtualised (rows within
  ~¾ screen of the viewport, ≤ 60 cells), thumbhash then the thumbnail through `mediaQueue` (asked for once the rows
  settle, on-screen rows first, then the rendered ones nearest first, `requestRows`; requests for rows scrolled away
  cancelled; ≤ 180 loaded kept as object URLs). The cursor's cell is ringed;
  entering the tab or a new selection scrolls to it once, scrolling never moves it; a tap = cursor + lightbox, and the
  photo the lightbox pages to is kept in view under it. Trips: trip-length albums from `/api/albums` (no index needed), newest first; a tap picks
  (one history entry) and shows Map; the list failing says so with "Try again" (`library.retryAlbums`, the list only). Budget: entry + phone shell ≤ 60 kB gz and no `overview/` module on the
  phone path, checked from the build by `tests/bundle.test.ts` (vite writes `dist/bundle-graph.json`).
- Lightbox G-B: photo at ~70% width plus a side panel (time, place, coords, mini-map, position in
  range, "Open in Immich"). ←/→ step through the selection in time order, Esc goes back.
  On a `(pointer: coarse)` device (read once) the controller (`Lightbox.svelte`, prop `touch`) shows the touch
  lightbox instead (`TouchLightbox.svelte`, maths in `gesture.ts`): full-screen pager, swipe ←/→, swipe ↓ / ✕ / Back
  close, pinch and double-tap zoom to 3× on the preview (paging off while zoomed), drags starting within 24 px of a
  screen side ignored (OS back swipe), tap toggles the bars, compact demo credits. Its close pops the entry the opening
  pushed (`history.state.lightbox`; a cold `lb` link gets a parent entry slipped in under it) and keeps the cursor on
  the photo last shown. Previews ±1 through `PreviewSet` (`media.ts`): object URLs, ≤ 3 held, a neighbour that becomes
  current keeps its request. Both lightboxes layer the photo's thumbnail between thumbhash and preview when something
  on the page already holds it loaded (`loadedThumb`: the grid's `ThumbSet`, a `CardImage`); never a request.
- Days are local calendar days everywhere they are shown or picked: the wave's bins, brush, readout,
  URL `from`/`to`, album dates, pin-click day, names, map legend, like the times on the map and in
  the lightbox. Selections still hold UTC instants (rows are sorted by instant, so a selection stays
  one contiguous row range); `toLocal`/`fromLocal` in `selection.svelte.ts` convert with the offset
  of the nearest library photo. Inexact only on a day the offset changes.
- Y scale is √(count/day), split between photos and videos proportionally. Videos are first-class
  (counted, playable). Archived assets are shown (Immich's default timeline visibility); hidden
  (Live Photo video halves), locked and trashed are not.
- Route lines break (dashed) on gaps over 4 h between GPS points, so flights don't draw straight
  "walks".
- An album selection shows only the album's members by default; a switch widens it to everything
  taken in the album's date range.
- Map cluster click (desktop): one visit zooms to its hours at once. Several visits, or one whose hours mostly show
  other places (more GPS photos outside the cluster than in it), open a menu: "Only photos here", "Everything in this
  period" (first visit → last), one row per visit, "Just zoom the map in" (≤ 320 px, two lines a row). After a zoom
  the way back is the toolbar's ← pill (Backspace); the notice over the map only says what was narrowed. "Only photos here" is a `place` selection:
  the library's GPS photos in the visits' hours within the cluster leaves' smallest enclosing circle (centre to 5
  decimals, radius to the farthest leaf + 1 m, whole metres; `place.ts`). So it holds every leaf and, when another
  cluster reaches into the circle, a few more: the label gives its own count. Like album members, `active` is an index
  of just those rows (`placeIndex`, cached by value per library index), so everything reading `{ix, lo, hi}` works
  unchanged. It is library-based: from an album in members mode it can take in non-members at the spot. The overview
  shows its span as the brush (dragging it makes a plain range); the phone opens `near=` links but can't make one.
- The album picker's first tab and the rail list trips only (`web/src/lib/trips.ts`):
  span ≤ 45 days (folder albums include year-spanning ones like `2026_Camera`) and ≥ 10 items, then
  scored from the library index alone, with no per-album calls. Points for the share of GPS days in
  the album's dates that are ≥ 100 km from home (home = the 0.25° cell with photos in the most
  months over the year ±1), for album items / library items in its dates (a people album picks
  only a few), and for a name matching a city or country Immich geocoded then; a lone non-place
  word such as a first name loses points. With too little GPS to judge, the tab says "albums" and
  lists every album up to 45 days. The demo lists every album up to 45 days anyway (`hooks.allTrips`): its sample
  photos of 2026 are all in Lisbon, which the heuristic rightly takes for home.

## Architecture

```
browser ── reverse proxy with auth ── immich-retrace container (Node/TS, Hono)
                                    ├─ /          static Svelte 5 build
                                    └─ /api/*     viewer operations (not a raw proxy)
                                                    └─ Immich (IMMICH_URL, optionally behind a wake gate)
```
- The backend holds the Immich API key and builds every upstream request itself from validated
  inputs. Client headers, cookies and query strings are never forwarded. Access is whoever passes
  the operator's auth proxy, on the operator's key.
- API key permissions: `asset.read` (timeline buckets), `asset.view` (thumbnail, preview, video
  playback), `album.read`. Nothing else.
- Index: `/api/index` (month manifest) → `/api/index/:month` (normalized columns, 5 at a time) →
  `buildIndex` (sorted by UTC instant, deduped by id, on the main thread). Cached in
  IndexedDB `immich-retrace-v<SCHEMA>`, keys prefixed by the library id (sha256(IMMICH_URL + key),
  since the key lacks `user.read`). It renders from cache at once, then refreshes fully on every
  visit under a per-library Web Lock and swaps atomically. Staged months are reused only to finish
  an interrupted first build. If Immich rejects the key for the index, the cached library is
  purged. Albums (list and members) load independently and never purge, so a key without
  `album.read` still shows the timeline. An expired auth-proxy session (opaque redirect) only shows
  "signed out". Failure texts live in `web/src/lib/failure.ts`, one row per backend error code.
- Albums: `/api/albums` (owned + shared, any span). `/api/albums/:id/assets` returns the members'
  full columns (a shared album can hold assets outside the library index), cached per album
  version.
- Map: MapLibre GL, native layers for route segments, gap connectors and clusters; DOM for the
  animated marker and photo pop-out. `MAP_STYLE_URL` is configurable; the default
  (`DEFAULT_MAP_STYLE_URL` in `shared/api.ts`) is OpenFreeMap dark (free, no key, attribution via
  the style's TileJSON).
- Wake gates (an on-demand proxy that starts Immich): while Immich starts,
  the gate answers every request (API and images too) with `200 text/html`, its loading page. The backend wakes Immich single-flight via `/api/server/ping`
  and checks `Content-Type` on every upstream response; other requests wait. The 60 s wait applies
  only once the loading page was seen; refused, DNS and non-Immich answers fail at once. Immich's
  own SPA (`X-Powered-By: Express` or `/_app/immutable/`), returned for a wrong IMMICH_URL path, is
  also `200 text/html` and is told apart from the loading page.
- Upstream errors map to `ApiError.code` (`shared/api.ts`): `unreachable` 502 (DNS, refused, TLS),
  `upstream` 502 (unexpected status, redirect, non-JSON, not Immich), `auth` 502 (+
  `missingPermission` from Immich's "Missing required permission: …"), `unavailable` 503 (gate
  didn't wake in 60 s or refused, or no answer within `requestTimeoutMs` 30 s: headers only for
  media, whole body for JSON). The client retries only 503 `unavailable`.
- Static: `vite build` writes `.br`/`.gz` next to compressible files of 1 kB or more.
  `server/static.ts` serves them with `Vary: Accept-Encoding`, `public, max-age=31536000,
  immutable` on `/assets/*` and `no-cache` elsewhere (index.html).
- First paint: `index.html` has an inline loading shell. `main.ts` is the small entry: it starts the
  library, URL sync, config and the map's chunk at t0, picks the shell once (the phone shell `mobile/MobileShell.svelte` for the
  demo on a coarse pointer with a short screen side ≤ 500 px, else the desktop one) and
  imports it dynamically. The desktop shell `App.svelte` (overview, lightbox controller) is its own
  chunk. `map/load.ts` checks WebGL 2 before fetching `MapView` (MapLibre is the lazy `maplibre-*`
  chunk plus its worker); `Lightbox.svelte` imports `LightboxView` on first open or when idle after
  the map. Nothing eager may import `maplibre-gl` (type-only imports are fine). MapLibre runs with
  `pixelRatio` ≤ 2 and shows a notice while its WebGL context is lost.
- Media: thumbnails and previews the app loads itself (map card, lightbox neighbours) go through
  `mediaQueue` (`lightbox/media.ts`): 6 in flight, explicit loads (the touch lightbox's photo on show, the card resting
  on a photo) first in line, then high ones (on-screen cells), a 429 pauses that kind (below) for Retry-After,
  abortable. In demo mode it also keeps each kind under a safety ceiling (`DEMO_MEDIA_WINDOWS`), as the demo proxy
  limits them apart (`mediaKind` = the proxy's thumbnail rule: `thumbUrl`'s exact thumbnail URL, anything
  else is a preview): 450 thumbnails and 300 previews per 20 s (proxy: 600 / 400 per IP), ~1.5× the busiest active
  session measured (docs/demo-hardening.md), so they never slow down what is on screen; nothing else in the demo is
  paced. A kind waiting for its window doesn't hold up the other. A preview still waiting after 600 ms shows
  a quiet "Loading…". The desktop lightbox's photo on show is its own `<img>` (not queued). Demo thumbnails are
  WebP within 480 px (demo/README.md).

## Immich API notes (verified against v3.1.0 server dist)

- `GET /timeline/bucket?timeBucket=…&withCoordinates=true` returns columnar arrays: id, isImage,
  thumbhash, fileCreatedAt, localOffsetHours, duration (ms), livePhotoVideoId, city, latitude,
  longitude. Both timeline endpoints are marked internal, hence the versioned adapter with
  fixtures.
- Default timeline visibility is `archive` + `timeline` (hidden and locked excluded). Pass
  `visibility=timeline` to leave archive out.
- Local calendar time = `fileCreatedAt` + `localOffsetHours`; use it for days and density only.
  Route order, gaps and camera weights use the real instant (`fileCreatedAt`, UTC).
- Credential precedence: share key/slug → session (cookie, Bearer, `sessionKey`) → `x-api-key`.
  A proxy that injects a key must strip `Cookie`, `Authorization`, `x-immich-*` headers and the
  `key`/`slug`/`sessionKey`/`apiKey` query params, or a browser cookie wins.
- Media (`/assets/:id/thumbnail`, `/video/playback`): an unknown id gets 400 (the access check),
  video of a photo 404, an unsatisfiable Range 404 (not 416). `edited` defaults to false;
  `edited=true` prefers the edited file and falls back to the original. Immich's web UI cache-busts
  with `c=<thumbhash>`. Thumbnails and previews come back uncompressed with `Content-Length`; JSON
  is brotli'd even without `Accept-Encoding`. `HEAD` works through the gate.
- Relay rules (`server/`): upstream redirects are not followed (`x-api-key` would go along). Only
  single byte ranges are forwarded. Thumbnails and previews requested with `c=<thumbhash>`
  (versioned, not forwarded) are `private, max-age=31536000, immutable`; everything else
  (unversioned, video) is `no-store`. A browser disconnect aborts the upstream fetch; node-server
  logs one harmless `Error: aborted` line per abort.
- Album `startDate`/`endDate` are local calendar days, not instants: `min`/`max` of
  `(localDateTime AT TIME ZONE 'UTC')::date` (`album.repository.ts` `getMetadataForIds`), serialized
  as midnight UTC. An album runs through the end of its `endDate` (`albumSpan`).
- `/albums/:id` returns no assets in v3. Membership comes from
  `/timeline/buckets?albumId=` plus one `/timeline/bucket?albumId=` per month. Without
  `withCoordinates=true` the lat/lon columns are absent, not null. Empty albums have no
  `startDate`/`endDate`.
- `POST /sync/stream` (the real change feed) requires a session; API keys get
  `throwSessionRequired`. Comparing bucket counts misses GPS and date edits, so the index is
  refreshed fully in the background instead.

## Similar projects (Oct 2026)

| Project | Data source | What it does | vs. us |
|---|---|---|---|
| [Dawarich](https://github.com/Freika/dawarich) | GPS tracker / Google Timeline import; Immich, PhotoPrism photos as a layer | Location history; trips with per-day colours and a replay scrubber where Immich photos pop in at their timestamp (v1.9.x) | Closest to our map + scrubber. Needs continuous location tracking; trips are defined by hand; no all-years density overview, no album selection |
| [GeoPulse](https://github.com/tess1o/geopulse) | GPS tracker; Immich integration | Stays/trips/gaps from raw points, road-snapped routes, photos on the map | Tracker-first; source-available license |
| [Reitti](https://github.com/dedicatedcode/reitti) | GPS tracker (OwnTracks, GPSLogger…); Immich | Daily timeline of visits and trips, photos on it | Tracker-first |
| [fototrip](https://github.com/lackas/fototrip) | Folder of geotagged photos | Static site: OSM map, clustered thumbnails, day-by-day axis | One-off generator for one trip; no Immich, no overview, no follow camera |
| [PhotoMap](https://github.com/tma66/PhotoMap) | Photos' EXIF GPS | Day-by-day steps, day scrubber over a map, 3D globe of trips | macOS-only (per search summary); not Immich |
| Immich map (built-in) | Immich | Global clusters; side-panel timeline since v2.6 | No routes, no time scrubbing ([route request](https://github.com/immich-app/immich/discussions/25717)) |
| [Immich Places](https://github.com/Majorfi/immich-places), [photos-cartographer](https://github.com/immich-app/immich/discussions/29268) | Immich / files + GPX | Assign missing GPS (by hand or GPX) | Complementary: fills the no-GPS camera-shot gap we otherwise approximate |
| Polarsteps (closed) | Live phone tracking | Trip map with steps, photos, reels | Commercial, tracking-first |

Our pitch is that nothing but Immich is required: the route comes from photos alone, with no
tracker. Dawarich already has a photo replay scrubber, so the animation isn't the selling point.
The all-years overview as the entry point and the smooth follow camera are what set it apart.
