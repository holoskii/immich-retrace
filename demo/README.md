# Demo dataset and Immich stub

Everything for the public demo lives here, apart from the viewer itself. The dataset is about 1,700
photos and 14 short clips by Kent Wang from Wikimedia Commons. A small stub server answers the
Immich endpoints the viewer uses, so the real viewer runs against it unchanged. The owner's own
library is never involved.

| File | What |
|---|---|
| `manifest.json` | The frozen dataset: one entry per asset (Commons file, author, licence, capture time, offset, GPS, size, thumbhash, modifications) plus the albums. In git. |
| `CREDITS.md` | Per-file credits, generated from the manifest. In git. |
| `config.ts` | Curation: licence filter, GPS removal, clip sources, albums, offline place table. |
| `fetch.ts`, `commons.ts` | Builds the dataset from the Commons API and downloads the media. |
| `stub.ts` | The Immich stub. |
| `Dockerfile` | The stub's image (`docker-compose.demo.yml` in the project root runs it with the viewer). |
| `data/` | API cache and media (`data/media/<asset id>/thumbnail.jpg`, `preview.jpg`, `video.mp4`). Gitignored, rebuilt by `fetch.ts`. |

## Rebuild the media

The manifest is in git; the images are not. To recreate them:

```bash
node demo/fetch.ts
```

This downloads two resized copies of every photo from the Commons image scaler, about 250 px and
1280 px wide (about 3,400 requests, one at a time: about 50 minutes and 950 MB on disk). It then renders the clips
with ffmpeg (needs `ffmpeg` with libx264). Files that already exist are skipped. It makes no API
calls and leaves the manifest as it is. If a file has been deleted from Commons since the freeze,
the run fails with its title.

`node demo/fetch.ts --refresh` re-lists the uploads (35 API calls of 50 files each, 1 per second,
cached under `data/cache/api`, so delete that directory to really re-query). It also rewrites
`manifest.json` and `CREDITS.md` before fetching the media. Use it only to change the dataset, and
check the licences again when you do. Both modes send a descriptive User-Agent; set the contact
URL in `commons.ts` (`USER_AGENT`) before running it from a public repo.

What the builder does:
- It keeps uploads since 2023 that have an EXIF `DateTimeOriginal` and a CC BY 4.0 or CC BY-SA 4.0 licence (checked per file). Captures before 2023 are dropped.
- Offset = EXIF local time − GPS UTC time (`GPSDateStamp` + `GPSTimeStamp`), rounded to 15 minutes. If a file has no usable GPS stamp, the offset comes from the nearest photo in time (within 36 h), else from the CET/CEST rule. Each file records which source was used (`offsetSource`).
- City and country come from the nearest entry in a small place table in `config.ts`. Nothing is sent to a geocoder.
- The thumbhash is computed locally from the 250 px copy (ffmpeg decode + the `thumbhash` package).
- Demo modifications are deterministic and recorded in each asset's `modifications`:
  - The Núria photos are presented as another user's, shared through an album (see below).
  - GPS is removed from two whole trips (Madrid, Mar 2025; Esslingen & Ulm, Jun 2025), from the Lyon leg of the May 2025 album, and from about 3% of single shots (picked by a hash of the title).
  - 14 clips, 6 s each: ffmpeg pan/zoom over the 1280 px copy of a photo, H.264 at 1280×720 or 720×1280, no audio. Each clip is placed 5 s after its photo at the same location and licensed like the photo.

## Run the demo locally

```bash
npm run build                                       # the web app, once
node demo/stub.ts                                   # Immich stub on :2283 (STUB_PORT=…, DEMO_MEDIA=…)
DEMO=1 IMMICH_URL=http://localhost:2283 IMMICH_API_KEY=demo PORT=8091 node server/main.ts
```

Without `DEMO=1` the same pair is a plain viewer on sample data (no banner, no landing), which is
how the stub is used in development.

## Run the demo with Docker

`docker-compose.demo.yml` (project root) runs two containers: the stub (`demo/Dockerfile`, the
manifest baked in, `demo/data/media` mounted read-only) and the normal viewer image with `DEMO=1`
(`demo/manifest.json` mounted read-only, for the credits). The media has to exist first.

```bash
node demo/fetch.ts                                  # once: ~950 MB into demo/data/media
docker compose -f docker-compose.demo.yml up -d --build   # → http://127.0.0.1:8081
docker compose -f docker-compose.demo.yml down
```

`DEMO_PORT` changes the host port, `DEMO_MEDIA_DIR` points at media elsewhere. The images are tagged
`immich-viewer-demo` and `immich-viewer-demo-stub`, so building the demo never retags a real
deployment's `immich-viewer:latest`. The app image's build context leaves `demo/` out
(`.dockerignore`); the stub's has its own ignore file (`demo/Dockerfile.dockerignore`). For a public
host, put a reverse proxy with TLS in front (the demo needs no login: sample data only).

## Demo mode (`DEMO=1`)

Settings, read by `server/demo.ts` (a normal deployment never reads them):

| Variable | Default | What |
|---|---|---|
| `DEMO` | off | `1` turns demo mode on. Anything but 1/0/true/false/yes/no/on/off stops the server. |
| `DEMO_TRIP` | `San Sebastián to Huesca` | The trip a visit without a link opens: an album id, or part of its name (case and accents ignored). No match: the album with the most items. |
| `REPO_URL` | `REPO_URL` in `shared/demo.ts` (a placeholder, `https://github.com/OWNER/immich-viewer`) | Where "Get it for your Immich" and the About panel link to. Set the constant once the repository is public. |
| `DEMO_MANIFEST` | `demo/manifest.json` | The dataset manifest, for the credits. Read at startup; a missing file stops the server. |

What changes (everything else is the normal app):
- Landing: a visit without a query opens `DEMO_TRIP` like a click on its album bar, with the
  cursor on a landscape photo with GPS near the middle of the trip, Follow on, route, strip and photo
  card visible (`web/src/lib/demo/landing.ts`). Nothing plays until Play is pressed. A link with a
  query opens what it says.
- Banner: "Demo · sample data", the pitch line, the dataset credit with "About & credits", and
  "Get it for your Immich →".
- Coach mark: three steps (timeline → time strip → photo card), once per visitor
  (`localStorage` key `immich-viewer.demo.tour-seen`; blocked storage just shows it again). Esc,
  "Skip tour" or "Done" end it; the `?` overlay has "Show the 3-step tour again" and "About this demo".
- About & credits panel: what the app is, MIT licence, the dataset credit and licences, what the
  demo changed, no endorsement, as-is; links to `/credits`, a page generated from the manifest with
  every file, its licence, Commons page and modifications.
- Lightbox: per-photo credit (author, licence link, Commons file page, the asset's
  `modifications`) from `GET /api/demo/credits/:id`.
- Hidden: the ⋯ menu (clear cache, refresh state), month counters while loading, "Open in
  Immich" (`immichPublicUrl` is forced to null).
- The album picker reads "Try another trip ▾". Play is a normal feature of the time strip (also
  `Space`); the demo only makes its button prominent.

Code layout (kept separate so the demo can move out): demo-only UI is in `web/src/lib/demo/` and loads as its
own chunk only when `/api/config` says `demo` (`App.svelte`); it plugs into the app through
`web/src/lib/hooks.svelte.ts` (the `?` overlay's extra buttons, a lightbox panel slot, the album
picker's label) and `selection.albumRequest` (open an album as a bar click would). The server side is
`server/demo.ts`, wired by one call in `server/main.ts`; its types are in `shared/demo.ts`.

First load against the stub (headless Chromium, cold profile, 1440×900): the overview paints in
0.24 s unthrottled and 1.09 s at 5 Mbit/s (40 ms latency); the landing's photo card is up in 1.35 s
and 4.5 s (MapLibre's chunk and worker plus OpenFreeMap's style and tiles). The index is 33 month
requests, about 250 kB of JSON.

The stub accepts any non-empty API key. It implements only what `server/immich.ts` and
`server/adapter.ts` call, with Immich v3.1.0 shapes:

| Endpoint | Notes |
|---|---|
| `GET /api/server/ping`, `GET /api/server/version` | No key needed (as in Immich). Version reports 3.1.0. |
| `GET /api/timeline/buckets[?albumId=]` | Months by local calendar date, descending. |
| `GET /api/timeline/bucket?timeBucket=YYYY-MM-01[&albumId=][&withCoordinates=true]` | Columnar rows. `latitude`/`longitude` are present only with `withCoordinates=true`. |
| `GET /api/albums[?shared=true\|false]` | As in Immich: no parameter → owned albums; `shared=true` → albums shared with or by the user; `shared=false` → owned, not shared. |
| `GET /api/albums/:id` | The album without assets (v3). |
| `GET/HEAD /api/assets/:id/thumbnail?size=thumbnail\|preview\|fullsize` | JPEG. `fullsize` serves the preview, because originals are not part of the demo. |
| `GET/HEAD /api/assets/:id/video/playback` | MP4 with single byte ranges. |

Errors behave like Immich: no key gives 401, an unknown id gives 400, video of a photo gives 404,
and an unsatisfiable range gives 404. `tests/demo-stub.test.ts` runs every response through
`server/adapter.ts` and `server/app.ts`.

Albums (curated trips): Pamplona & Basque Country (Aug 2024); San Sebastián to Huesca (Sep 2024,
with clips); Sète, Lyon & Dole (May 2025, the Lyon days have no GPS); Alsace & Freiburg (May 2025);
Lisbon & Queluz (Jan 2026).

### Shared album

The stub has two users: the key's user (`Demo`) and `Alex (demo friend)`. The 39
Núria & Queralbs photos (26–27 Jul 2024, `owner: "friend"` in the manifest) belong to Alex. They are
left out of the key user's `timeline/buckets`/`bucket`, and they appear only in Alex's album
"Pyrenees, 14–27 Jul 2024". That album is listed under `shared=true` (`shared: true`,
`ownerId`/`owner` = Alex, `albumUsers` = the demo user as editor) and also holds the demo user's
own photos from those dates. Its album timeline returns both users' assets, each with its
`ownerId`. Thumbnails, previews and video are served for any asset id, including Alex's. The
ownership is a demo fiction: every file is by the same Commons author.

## Licence

**The demo data is not under the viewer's code licence.** It is licensed per file, by
Kent Wang via Wikimedia Commons, under either
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) or
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). `manifest.json` and `CREDITS.md`
give the licence of each file. Every item in the dataset is modified: photos are resized copies,
some photos have their GPS removed, some are presented as a second (fictional) user's photos, and the videos are pan/zoom clips made from photos. The
`modifications` field of each asset and `CREDITS.md` say which. Resized copies of CC BY-SA files,
and clips made from them, remain under CC BY-SA 4.0. The material comes as-is, without warranties,
as stated in the licences.

The manifest's own metadata (capture times, coordinates, titles) is taken from the same Commons
files and is offered under the same per-file terms.

### Attribution requirements for the hosted demo

These follow CC BY 4.0 / CC BY-SA 4.0 §3. Demo mode (above) covers all of them.

- Per asset, wherever it is shown large (lightbox info panel): "Photo: Kent Wang, CC BY 4.0
  (or CC BY-SA 4.0, linked to the licence), via Wikimedia Commons" with a link to the file page
  (`commonsUrl`), plus the asset's modification note (for example "GPS removed" or "Video derived
  from photo").
- A credits or about page linking `CREDITS.md`, or a rendering of it, with the author, both
  licences, the Commons links, and the no-warranty disclaimer.
- A demo banner saying the data is public CC content and that some metadata was changed for
  the demo.
- No implied endorsement by Kent Wang or the Wikimedia Foundation.
- Share-alike: if derivatives of CC BY-SA files are redistributed (for example in a
  downloadable demo bundle), they must stay under CC BY-SA 4.0.
