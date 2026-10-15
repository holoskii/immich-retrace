# Roadmap

Everything that is still open. Decisions and architecture are in [AGENTS.md](../AGENTS.md).

## Next

1. Hand-test main on the live site (deployed 2026-10-13), then the demo (`docker-compose.demo.yml`).
2. Delete the NPM backups once the live site is fine: `/data/database.sqlite.bak-viewer-20261013`,
   `/data/39.conf.bak-20261013` (inside the NPM container).
3. Verify shared albums end to end (see below).
4. Release:
   - Set the repo URL: `REPO_URL` in `shared/demo.ts`, `USER_AGENT` in `demo/commons.ts`, the
     clone line in the README.
   - Decide where the demo lives in the repo (see below). It is hosted as `immich-viewer-demo`
     (AGENTS.md → Deployment); the NPM proxy host is the owner's to add.
5. Authelia: require one factor on the LAN. Guests on the home network get in through the global
   `*.example.com` LAN bypass. Add a `viewer.example.com` rule with `one_factor` for
   `<LAN subnet>` before the bypass (rules are first-match).

## Demo: proper public deployment

The demo is live behind NPM (host 40) with Authelia on `location /`. Drop Authelia only after the
minimum bar in `docs/demo-hardening.md` (research branch `worktree-agent-a5c19d2da25e0e518`). Items:

- Rate limiting per IP (NPM `limit_req` in the proxy host's advanced config, or in the server),
  especially on `/api/*` thumbnails, previews and video, which stream from the stub's 950 MB of media.
- Hardening: security headers (CSP, `X-Content-Type-Options`, `Referrer-Policy`), read-only root
  filesystem and dropped capabilities for both containers, memory/CPU limits, stub reachable only
  from the viewer (already true).
- Monitoring: visit counts and top paths (NPM access log or a tiny analytics endpoint), uptime
  check with an alert, disk/bandwidth watch.
- Abuse: cap concurrent video streams; fail2ban or similar on the NPM log for scrapers.
- CDN or cache in front of media if traffic grows.

## Open decision: where the demo lives

The owner proposed a separate `demo` branch. The alternative: keep the demo UI in main, isolated as
it is now (`web/src/lib/demo/`, lazy chunk, `server/demo.ts`), keep the stub and its adapter tests
in main as a dev fixture, and move only the dataset (manifest, CREDITS, Commons fetch scripts) and
`docker-compose.demo.yml` to a separate repo or branch. A long-lived branch would conflict on most
main changes, since the demo UI touches Overview, MapView and Lightbox.

## Shared albums

The album list already merges owned and `shared=true` albums (`server/adapter.ts` ~152), and
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

- Album range may drop the last day. `t1: a.end + 1` (`selection.svelte.ts` ~154,
  `Overview.svelte` ~230, `draw.ts` ~155) assumes `end` is the last instant, but Immich's `endDate`
  may be the last day at local midnight. The stub returns real times, so the demo hides it. Check
  Immich's source or a real response first.
- Album ranges break on outlier dates: the trip filter skips albums over 45 days or under 10 items
  (`2021-07_Georgia` spans 818 days from one outlier, `2024-09_Greece` 72 days). Trim outlier
  members the way the overview does.
- Brush label is in local time, the readout in UTC, so they can be a day apart. Same root cause:
  the wave bins by local day while brush and selection are UTC instants.
- The two timelines react differently to clicks. On the zoomed wave, a plain click (so also a
  double click) outside the selection clears it and resets the zoom (`Overview.svelte` ~214,
  `clearSelection`). The all-years strip above it has no such reset. Pick one behaviour for both,
  e.g. double click resets on either and a single click never clears.

From the map review (stage 4, Codex), not fixed yet:

- Antimeridian: interpolation, lines, bounds and the inset take the long way round.

Smaller known gaps:

- Map inset fits every fix, so one far outlier squeezes the route.
- An overview hover jump over 3 h snaps instead of flying.
- Route segmentation thresholds (`ROUTE` in `route.ts`: 4 h, 400 km/h, 1.5 h + 50 km) leave much
  of a trip dashed when zoomed out.
- Lightbox: the undecodable-video message is untested live; assets without a thumbhash aren't
  cached; the mini-map keeps the route from open time across an index refresh.
- Index: the follow-up Codex check of the stage-2 review fixes never ran.
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
