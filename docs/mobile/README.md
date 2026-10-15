# Retrace on a phone

Design study, October 2026. Demo data only (public sample library). All mockups are in
[gallery.html](gallery.html) (one page, light and dark), also published as a private artifact:
https://claude.ai/code/artifact/f5663ff8-7f18-4a33-adaa-9fe6324bb728

## The question

Retrace is a desktop viewer: an all-years density strip, a zoomed wave with a brush, a map that
follows a time cursor, albums, and a lightbox. At 390 px the page renders 543 px wide, the brush
grips are 7 px, information is hover-only, and the lightbox photo is ~55 px tall
([screens/phone-landing.jpg](screens/phone-landing.jpg)). What should Retrace be on a phone: a
port, a different product, or something in between?

## Recommendation

**"Replay + Photos": one stack, no tab bar.** A trip opens on **Replay**: a full-height map with
the route, and a fixed 230 px deck in the thumb zone holding a docked photo card, a folded time
strip and ⏮ ▶ ⏭ by stop. **Library** (years, months, trips, search) is a pushed screen, opened
from the trip title. **Photos** is a second view of the same trip, laid out as a story (day
chapters, stops, transit breaks). In phase 2 it becomes **Story**, with a docked map that follows
the stop you are reading, but only if a real-device spike passes.

Why: all four concepts converged on map + deck for a trip. That puts the route replay, the
product's hook, one tap from the landing. It reuses the stores, the URL contract, `play.ts` and
`TimeStrip` drawing. Brushes, waves and draggable sheets are dropped. Ranges come from trips,
months, cluster visits and deep links instead. One web app with a lazy mobile shell. No native app.

Effort: **groundwork M–L, then the shippable phone app (phase 1) L, then Story L**. For one
engineer who knows the code, that is roughly 3–4 months to phase 1 and 1.5–2 more for Story. Each
step ships on its own; the touch lightbox fixes desktop-on-phone first.

## Requirements (summary)

Full text: [04-decision.md §6](04-decision.md#6-requirements-for-the-mobile-version).

- **Shell**: chosen at boot when `(pointer: coarse)` and the short screen side is ≤ 500 px.
  Rotation never swaps shells or remounts the map. Tablets keep the desktop shell.
- **Functional**: Library (search by name, year and place; trip cards with the verdict; year rows
  with month cells; month-range drag; Custom dates). Trip Replay (map, Follow/Fit, card, strip,
  ⏮ ▶ ⏭, ⋯, ⓘ). Visits sheet with Zoom to these days / Jump here / Also here. Photos/Story view.
  Lightbox pager. Share. The demo landing. Every loading, offline, no-GPS and WebGL-lost state.
- **URL**: the desktop contract is unchanged (`from/to`, `album[&mode=range]`, `at`, `lb`). The
  phone adds `view=photos|story` (replace). Selections and screens push history. `at` from
  scrub/Play/steps is written with replace only (≤ 1/s). Links round-trip between phone and desktop.
- **Budgets**: ≤ 60 kB gzip eager JS (MapLibre lazy). Cold album link ≤ 2.5 s to title + card +
  strip, ≤ 4 s to route. Exactly one WebGL context. `pixelRatio` ≤ 2. ≤ 3 decoded previews.
  ≤ 60 media requests per 6 s. Play p95 frame ≤ 33 ms. < 300 MB after 10 min.
- **Accessibility**: WCAG 2.2 AA. 44 px targets, text ≥ 11 px. Every gesture has a tap
  alternative. The strip is a `role="slider"` with spoken values. Reduced motion means jumps, not
  flights. 200 % text works in Library, sheets and Story.
- **Devices**: iOS Safari 17+, Chrome Android 120+, Samsung Internet. 360×640 to 430×932,
  portrait first. Landscape uses the same shell (map left 58 %, deck as a right column).
- **Out of scope (v1)**: writes to Immich, multi-select, place filters, brush/wave, light
  basemap, a trips map, native apps, memory videos.

## Design per category

Cross-cutting rules (terms, gestures, Back, status slot, deck, sheets, landscape) are in
[06-review.md §1](06-review.md#1-cross-cutting-decisions). Where a category doc disagrees, the
review wins.

| Category | Chosen | Alternatives (kept / rejected) |
|---|---|---|
| [Navigation](05-categories/navigation.md) | **V1 Title as switcher**: a floating two-line title (name ⌄ opens Library, line 2 is static `DEMO · 6–10 Sep 2024 · 194 photos`). `‹` on the title drills up after a zoom. ⋯ sheet with Library as its first row. One linear history, with Library and sheets in `history.state` | V2 bottom app bar (costs 52 px of map, one-line name; only "Library in ⋯" kept). V3 Library as a sheet with a trip peek (rejected: nothing under it at the owner root, reads as draggable) |
| [Timeline](05-categories/timeline.md) | **V3 hybrid strip**: folded axis (gaps > 3 h become 14 px breaks, 7× more px per hour on the demo). A loupe above the thumb while dragging. Slide the thumb up for photo-by-photo steps (10 px per photo). ⏮ ▶ ⏭ by stop. End card with `Next trip ›` | V1 strip + pinch zoom (two-handed; double-tap zoom kept as a later add-on). V2 fixed-playhead film from concept B (runner-up for the band slot if the hallway test fails) |
| [Map](05-categories/map.md) | **V3 Stop-centric**: numbered stop badges from `stops.ts`, route travelled/ahead split per stop, pins only inside the current stop. Follow / Fit / ⓘ bottom-right. Tapping another stop's badge seeks there. Tapping the current stop opens the visits sheet (amends decision §0). Undo chip, no long-press | V1 route-first bubbles (cheapest, and the fallback if stops misbehave). V2 thumbnail clusters (image cost, hides the route) |
| [Preview](05-categories/preview.md) | **V1 Story density** as the one Photos/Story component (day chapters, stop heroes, justified rows, transit breaks, `Day ▾` sheet) + V2's fast-scroll rail. **Lightbox 3a**: pager with a stop-segmented mini filmstrip. One `media.ts` queue (≤ 6 in flight, 60 per 6 s, 429 back-off) | V2 compact grid as a second density after phase 1 if the test asks for it. Lightbox 3b no filmstrip (fallback if drag fights paging). 3c vertical stop pager (rejected: breaks swipe ↓) |
| [Albums](05-categories/albums.md) | **V2 Years-first Library**: search at the top, `All photos` / `Custom dates`, one row per year with 2×6 month cells (tap = month, long-press-drag = range) and the year's trips. The demo opens all years with trips first | V1 list-first (best for 6 trips, poor at 150). V3 map of trips on top (needs the full index and a borrowed WebGL context; not v1) |

The concept stage that led here: A vertical story, B filmstrip, C map-first deck, D tabs. Scores
and the hybrid are in [04-decision.md](04-decision.md). B v2 is the documented runner-up.

## How the codebase must change

Sizes are for one engineer who knows the code: **S** ≤ 1 week, **M** 2–4 weeks, **L** 5–8+ weeks.
Code facts are from [03-critiques/eng.md §0](03-critiques/eng.md#0-facts-from-the-code-every-concept-runs-into).

### Components

- `App.svelte` picks `DesktopShell` (today's tree) or a lazily loaded `MobileShell` at boot.
  Desktop-only code (hover tips, wheel, `Help`, `shortcuts.ts`, `inset.ts`, the visits menu, the
  `Overview` canvases) stays out of the mobile chunk.
- New mobile components: `TripScreen` (title, map host, deck, status slot), `Deck` (card, strip,
  transport row), `Library` (search, year rows, trip cards, range bar), `VisitsSheet`, `ActionSheet`
  (shared by ⋯ and long-press), `StoryLayout` (Photos now, Story later), `RouteSketch` (static
  SVG, shared by the lightbox info, WebGL-lost and cold states), and a touch `LightboxPager`.
- `Overview.svelte` loses its album logic to `actions.ts` (below). `TimeStrip` drawing and
  `axis.ts` are reused under a new touch controller (loupe, photo steps, folds).
- `MiniMap.svelte` (a second MapLibre) is replaced by `RouteSketch` on both shells.

### State

- `selection.svelte.ts` keeps its model (contiguous `lo..hi`, cursor, zoom stack). There is no
  place filter.
- New `actions.ts`: `pickAlbum`, `setMode`, clear/back URL writes and `albumRequest`, moved out of
  `Overview.svelte`. Without this the demo lands on nothing in a shell without Overview.
- Phone history: `at`/`lb` and `view` are written with replace. Selection changes, Library,
  sheets and lightbox push, with `history.state.{screen,sheet,parent}` for phone-only facts.
- New pure, tested `stops.ts` (place + time units). It drives ⏮ ⏭, strip ticks, map badges, Story
  headers and visits. The thresholds are an open question.

### Map

- Split `MapView.svelte` (849 lines) into `MapCore` (map, sources, layers, Follower, marker, hit
  queries, events) and per-shell chrome. **M**, and most of the claimed reuse.
- `Follower` reads camera padding (`insets {t,r,b,l}` via `map.setPadding`) instead of a fixed 70 px
  pad. The deck, title and sheets set insets once per state change.
- `pixelRatio` ≤ 2, a tile cache cap, and a `webglcontextlost` handler that falls back to
  `RouteSketch`. rAF stops under Library and the lightbox. One instance for the app's life.
- V3 layers: a stops source (badges, a clustered range badge for dense selections), a route filter
  split at the stop boundary, and current-stop pins re-set once per stop crossing.

### Data and API

- **Album-first boot**: an album link resolves from `/api/albums` + its members (cached per
  version) without waiting for the full library index (`urlReady` waits for it today). This is
  the biggest perceived-speed win.
- **Index refresh**: interval or manual, not a full `refreshIndex` per visit on cellular.
- **`media.ts` queue**: priorities, cancellation, a token bucket under the demo relay limit, and
  429 back-off. Thumbhash, then `thumbnail`, then `preview` after 300 ms of rest.
- **Server**: add `cover` (`albumThumbnailAssetId`) to `AlbumSummary` (S). Regenerate demo
  thumbnails at 480 px.
- **Offline**: a small service worker for the shell and recent thumbnails (later, S–M).

### Build and responsive strategy

No breakpoint-driven responsive layout. Two shells share stores, URL and map core. The mobile
chunk is lazy and MapLibre stays its own lazy chunk. Inside the mobile shell, layout uses `svh/dvh`
fixed bands, safe-area insets, and one portrait/landscape switch (orientation, not width).
Dark-only in v1, like desktop; light chrome is an open question.

### Phased plan

| Phase | Content | Size | Ships |
|---|---|---|---|
| 0 Groundwork | `actions.ts` (S), `MapCore` split (M), Follower insets (S–M), `pixelRatio` + context loss (S), `RouteSketch` (S), replace-only `at` (S), album-first boot (M), interval refresh (S–M), `stops.ts` + folded axis (S), `media.ts` queue (S–M) | **M–L** | Nothing visible; desktop gets faster cold links |
| 1a Touch lightbox | Pager, pinch/double-tap zoom, swipe ↓ to close, info sheet, day progress, stop filmstrip | **M** | Fixes the most broken phone path, on both shells |
| 1b Mobile shell | Trip Replay (title, deck, V3 strip, V3 map, status slot, ⋯, ⓘ), visits sheet, Library V2, cold/offline/empty states, demo landing | **M–L** | A usable phone app |
| 1c Photos view | `StoryLayout` without the map link, `Day ▾` sheet, fast-scroll rail | **M** | Finding one photo |
| 2 Spike | Real iPhone + mid-range Android: Play 60 s, strip fling, Story scroll with a docked map. Frame time, memory, battery | **S** | Go/no-go for Story |
| 3 Story | Docked passive map, stop-damped camera, scroll → cursor, Play scrolls the page | **L** | Reliving a trip. If the spike fails, Story docks a static `RouteSketch` instead (S) |
| Later | Compact grid density (S), service worker (S–M), light chrome (M), trips map (M+) | | On evidence |

Hallway tests (timeline §6, map §6) run after 1b. If the strip fails, swap in the V2 film band.

## Open questions for the owner

1. **Default trip view after Story ships**: Replay, Story, or remember per device?
2. **Strip**: accept V3 after the hallway test, or decide now between V3 and B's film?
3. **Stop thresholds**: A's finer rule (> 45 min, > 2 km, city change) or B's (> 3 h, > 15 km).
   This needs tuning on the private library, which only the owner can see.
4. **Thumbnail size**: raise Immich's thumbnail size on the owner instance (250 px is soft at DPR 3),
   or accept soft tiles?
5. **Share in owner mode**: keep it, relabel it "Copy link", or show it only in the demo?
6. **Light theme**: light chrome over a dark map in v1, or dark-only until a light map style exists?
7. **Spike devices**: which real phones are available (minimum: one iPhone, one mid-range Android)?
8. **Index refresh on cellular**: hourly + manual, or Wi-Fi only?
9. **Demo pitch**: navigation proposes a DEMO chip + About sheet + end card, with no banner. Confirm.
10. **Place search on a cold visit**: is it acceptable that place results arrive seconds after names?
11. **Map tap model** (amends decision §0): tapping another stop's badge seeks, and only the current
    stop opens visits. Accept, pending the "find all photos at Yesa" test?
12. **Album names on cards**: strip a trailing date range ("Pyrenees, 14–27 Jul 2024" → "Pyrenees"),
    display only?

## Index

| File | What it is |
|---|---|
| [01-research/current-app.md](01-research/current-app.md) | Today's desktop app, mapped: views, inputs, data limits, what breaks at 390 px |
| [01-research/patterns.md](01-research/patterns.md) | Mobile patterns from Google/Apple Photos, Immich, Polarsteps, Strava, stories, scrollytelling, map sheets, editors |
| [02-concepts/a-concept.md](02-concepts/a-concept.md) | Concept A: vertical story scroll with a docked map (v2) |
| [02-concepts/b-concept.md](02-concepts/b-concept.md) | Concept B: horizontal filmstrip deck, fixed playhead (v2, runner-up) |
| [02-concepts/c-concept.md](02-concepts/c-concept.md) | Concept C: map-first with a fixed bottom deck (rev. 2) |
| [02-concepts/d-concept.md](02-concepts/d-concept.md) | Concept D: faithful port in tabs Map / Photos / Trips (r2) |
| [03-critiques/ux.md](03-critiques/ux.md) | UX critique of A–D: reach, gestures, a11y, landscape, demo vs owner |
| [03-critiques/eng.md](03-critiques/eng.md) | Engineering critique: code facts every concept hits, effort, device cost |
| [04-decision.md](04-decision.md) | Scoring, the Replay + Story hybrid, rejections, requirements, briefs |
| [05-briefs/](05-briefs/) | One brief per category designer (navigation, timeline, map, preview, albums) |
| [05-categories/navigation.md](05-categories/navigation.md) | App shell: history model, Back, cold/expired states; V1 title as switcher |
| [05-categories/timeline.md](05-categories/timeline.md) | Strip, Play, ranges, measured demo facts; V3 hybrid strip with loupe |
| [05-categories/map.md](05-categories/map.md) | One map instance, insets, visits sheet, offline tiles; V3 stop-centric |
| [05-categories/preview.md](05-categories/preview.md) | Photos/Story layout, lightbox rules, media queue; V1 + rail + lightbox 3a |
| [05-categories/albums.md](05-categories/albums.md) | Library, search, trip cards, month ranges; V2 years-first |
| [06-review.md](06-review.md) | Consistency review: canonical data, terms, gestures, status slot, gaps, fixes |
| [gallery.html](gallery.html) | Every mockup on one page (concepts A–D, then the five categories) |
| [mockups/](mockups/) | The individual mockups (`concept-a..d.html`, `<category>.html`) |
| [screens/](screens/) | Renders of the mockups and of the public demo on desktop and phone |
