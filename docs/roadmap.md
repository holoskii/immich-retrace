# Roadmap

Everything that is still open. Decisions and architecture are in [AGENTS.md](../AGENTS.md).

## Next

1. Hand-test main on the live site and the demo, in particular:
   - same-second photos (bursts): a pin click on the second of two overlapping pins, then ←/→ and
     closing the lightbox keep that photo; Play and ←/→ visit each one
   - a cluster with a pin drawn over it: hover and click act on the pin
   - a real album whose last day has photos (especially after local midnight): bar and range
     include them
   - a trip far from UTC: brush, hover label, readout and URL agree on the day
   - double click clears on both timelines, a single click never does (Firefox, Safari too)
   - old `?from=…&to=…` links (read as local days) still land on the right photos
   - at low zoom with two world copies, pan across the date line: the card sits by the marker
   Then the final pedantic UI review.
2. Verify shared albums end to end (see below).
3. Release:
   - Set the repo URL: `REPO_URL` in `shared/demo.ts`, `USER_AGENT` in `demo/commons.ts`, the
     clone line in the README.
   - Prebuilt image on GHCR (`ghcr.io/<owner>/immich-retrace`), published by CI; the README's
     quick start pulls it instead of building from source.
   - README: a GIF or video at the top and the public demo link.
   - Launch video: a draft is in `brag-output/` (gitignored; `brag.mp4`, `share-copy.txt`,
     `brag-plan.md`). After the UI review, re-film and render with `brag-output/work/make.sh`
     (needs the demo viewer, `BASE` in `capture.py`). Fill the link slot (`outro.url` in
     `work/config.json`, `[LINK]` in `share-copy.txt`) and listen to the audio. Known weak spots:
     the trip-pick shot is dark after the click, the hook has no basemap.
   - Where to announce it, in what order: [outreach.md](outreach.md).

## Demo: proper public deployment

The demo is behind Authelia until the switch-over in
[demo-hardening.md](demo-hardening.md#going-public). Left: a visits/top-paths view (Caddy's JSON
log), and a CDN if traffic outgrows the 50 Mbit ceiling.

## Shared albums

The album list already merges owned and `shared=true` albums (`server/adapter.ts`), and
members mode loads an album's members as their own index, so other users' assets can appear. The
demo stub has one shared album. Check against a real Immich shared album with assets owned by
another user:

- thumbnails, previews and video through the key (`asset.view` on assets the key's user doesn't own)
- lightbox and mini-map, map route and pins in members mode, "Open in Immich" links
- album rail and picker: show the owner? a "shared" badge?
- cached members after the share is revoked
- range mode: the library index holds only the key user's own timeline, so others' photos vanish.
  Say so in the UI, or merge members into the range.
- partner sharing (`/timeline` with partner assets): does the index include it, and should it?

## Bugs

- Album ranges break on outlier dates: the trip filter skips albums over 45 days or under 10 items
  (`2021-07_Georgia` spans 818 days from one outlier, `2024-09_Greece` 72 days). Trim outlier
  members the way the overview does. Blocked on data: `/api/albums` carries only Immich's
  min/max day and the count, so trimming needs per-album member times (one
  `/timeline/buckets?albumId=` per long album for month counts, plus the edge months' buckets for
  exact days, cached by album version), against the "no per-album calls" trip decision. And
  `trimOutliers`' library rule (gap ≥ 1 year) would not trim Greece; albums need their own scale.
  Parked: needs design work and the owner's attention.

Smaller known gaps:

- An overview hover jump over 3 h snaps instead of flying.
- Route segmentation thresholds (`ROUTE` in `route.ts`: 4 h, 400 km/h, 1.5 h + 50 km) leave much
  of a trip dashed when zoomed out.
- Lightbox: the undecodable-video message is untested live; assets without a thumbhash aren't
  cached; the mini-map keeps the route from open time across an index refresh.
- Frame times on a real GPU are unmeasured.

## Later

- Breadcrumb derived from containment (`All › 2023 › Portugal › Porto`) replacing
  `selection.stack`/`zoomLabel`, with browser Back as the only back.
- Thumbnail filmstrip under the map, synced to the cursor (would replace the photo-wave in
  Layout L-A).
- Photo-wave D-A: tiles stacked in time bins from the baseline (bin size follows zoom); hover moves
  the shared time cursor, click opens the lightbox.
- Compact overview while a trip is selected.
- Lightbox mini-map: show the estimated route position for no-GPS photos.
- Borrow GPS for camera shots from the nearest phone photo within ±30 min, marked approximate
  (about 40% of the Kyrgyzstan trip has no GPS).
- Auto-detected events (photo clusters separated by empty time) next to albums.
- Exclude screenshots from density.
- Full keyboard access: context strip, album bars, pins and clusters.
- Index freshness: a refresh interval, manual Refresh and "last checked" instead of refetching on
  every visit.
- Mobile layout. There are no width breakpoints: at 390 px the page renders 543 px wide
  (`.readout { flex: 1 1 420px }`?), the lightbox leaves about 55 px for the photo, info is
  hover-only, brush grips are small.
- Per-user mode: each user's own API key kept server-side behind an HttpOnly session.
- Server-side tile cache (only helps across devices; the browser already caches tiles for 31 days).
- Demo: "Lisbon & Queluz, Jan 2026" scores as home (the photographer lives there from 2026). Swap
  it if the demo should show six trips.
- Demo: the dataset is Europe only. For wider coverage, a Flickr CC BY travel photostream would
  work but needs a Flickr API key.
