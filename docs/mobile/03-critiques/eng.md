# Engineering critique of concepts A–D

Lens: what it takes to build each on today's code (Svelte 5, MapLibre, `selection.svelte.ts`,
`lib/index`, `lib/map`), what it costs on a mid-range Android (Adreno 6xx / Mali-G57 class, DPR
~2.6, 4–6 GB RAM) on cellular, and what would kill it. Callouts are cited as `A·2③` = concept A,
screen 2, callout 3 (`screens/concept-*-light.jpg`).

Effort scale (one engineer who knows the code): **S** ≤ 1 week, **M** 2–4 weeks, **L** 5–8+ weeks.

## 0. Facts from the code every concept runs into

All four docs say "reused as is" for `selection.svelte.ts` and the map. That holds for the
stores, but not for the code that drives them. The gaps below apply to every concept; none of
the four docs counts them.

1. **Opening an album lives in `Overview.svelte`, not in a store.** `pickAlbum` (Overview.svelte
   ~251) is the only code that turns an album into a selection plus cursor, and it waits for the
   overview's `dom` before it runs. The demo landing (`Demo.svelte:29`) only sets
   `selection.albumRequest`, which only Overview consumes. If a mobile shell doesn't mount
   Overview (A, B, C) or doesn't mount it on landing (D, whose landing tab is Map), **the demo
   lands on nothing.** `selection.timeline` (pins with no selection) is also written only by
   Overview (`:92`). Fix: move `pickAlbum`, `setMode`, the clear/back URL writes and
   `albumRequest` handling into an `actions.ts` that both shells call. Effort S, but it comes
   first.
2. **`MapView.svelte` is 849 lines of core and desktop chrome mixed together** (card placement,
   hover tips, visits menu, inset, legend, notices). Every concept needs a `MapCore` (map, sources,
   layers, Follower, marker, cluster/pin hit queries, emitting events) with each shell supplying
   its own chrome. Effort M, and it is most of the "reuse" any concept claims.
3. **The Follower frames the whole container with a fixed 70 px pad** (`FOLLOW.pad`,
   `follow.ts:597`, `w/h = clientWidth/Height`). It has no notion of a sheet, deck or header
   covering part of the map. C needs asymmetric insets (sheet height). B and D need a floating
   header and a deck overlap. A's 240 px docked map minus 2×70 px pad leaves a 250×100 px target,
   so the camera zooms far out. Fix: `Follower.insets = {t, r, b, l}` feeding `zoomFor` plus a
   centre offset (or MapLibre `jumpTo({padding})`). Effort S–M, shared by all.
4. **The map is created with defaults** (`MapView.svelte:104`): no `pixelRatio` cap, no
   `maxTileCacheSize`, no `webglcontextlost` handler. At DPR 2.6, a full-screen map is a ~1080×2200
   framebuffer. Cap `pixelRatio` at 2 (about 40% less fill) and handle context loss. Effort S.
5. **A second WebGL context already exists:** `MiniMap.svelte` creates a full `maplibregl.Map`
   in the lightbox. All four concepts drop it in favour of a static SVG, which is right, and
   `lightbox/model.ts` already has `routeLines` + `gpsExtent` to draw it from. Effort S.
6. **Boot waits for the full library index.** `urlReady` (`selection.svelte.ts:316`) refuses to
   apply any URL until `library.index` exists. On a cold phone (no IndexedDB yet), an album link
   builds every month's columns before showing anything. A's claim that "a story needs only
   `/api/albums/:id/assets`" is false today, and so is C's "library view is index-only, no extra
   requests" on a first visit. Fix: album-first boot. A members-mode album resolves from the album
   list plus the members index (cached per version). `offsetIn` accepts any `IndexColumns`, so
   local days can use the members' offsets until the library arrives. Effort M, and it is the
   biggest perceived-speed win on a phone.
7. **Each visit refetches everything.** `LibraryStore.load` runs a full `refreshIndex` per visit,
   which costs the most on cellular. Interval/manual refresh (roadmap "Later") is a prerequisite
   for mobile. Effort S–M.
8. **Scrubbing pushes history.** `TimeStrip` writes `live`, then `commit` on pointerup
   (`TimeStrip.svelte:189`): one `pushState` per drag. On desktop that is deliberate. On a phone,
   where a "drag" is a flick and Back is an edge swipe, ten flicks become ten Back steps. Every
   concept with a scrubber (B, C, D) or scroll-as-cursor (A) must write `at` with `replace` only,
   and push only on selection changes. A gets this right ("replace ≤1/s"). B, C and D inherit the
   bug if they reuse TimeStrip's handlers.
9. **There is no offline shell.** No service worker and no manifest. The IndexedDB index survives,
   but `index.html` and the chunks don't. Thumbnail/preview URLs are versioned by thumbhash and
   served `immutable`, so a small SW (shell + a capped LRU of thumbnails, previews of the last
   trip only) gives "reopen the last trip on the plane". B and C say "best as an installed PWA"
   without counting this. Effort S–M.
10. **Dark only.** Canvas colours are hard-coded (`draw.ts` `C`), and the basemap is a dark style.
    Every mockup is light-first. A light theme needs palette tokens in `draw.ts` and a second map
    style, and `setStyle` drops custom layers (re-add them on `style.load`). Effort M. It is
    optional, but don't let a mockup promise it for free.
11. **Media sizes.** `thumbnail` is ~250 px and `preview` ~1440 px (demo: 1280 px), with nothing in
    between. Fine for ≤ ~100 css px tiles. Too soft for heroes and big cards, too heavy (200–400 KB)
    to fetch per cursor step. The rule for all concepts: during scrub, Play or a fling, show
    thumbhash, then `thumbnail`. Fetch `preview` only after ~300 ms of rest. Map tiles go to the
    third-party tile host and don't count toward the demo relay's 120 req / 6 s. Thumbnails and
    previews do.
12. **Follow loop cost is already bounded.** The rAF loop stops when settled and when
    `document.hidden` (`follow.ts:662`). The open cost is continuous `jumpTo` during Play and
    scrubs: each frame re-renders the map at full framebuffer size. Battery scales with **visible
    map area × time spent moving**. Rough relative fill: A docked ~0.3, D ~0.65, B ~0.6 (0.7 while
    playing), C ~0.75 at peek. Real numbers are unmeasured on desktop too (roadmap). Measure on one
    real Android before committing to C.

## A · Vertical story scroll

**Strongest point.** The best product for the job of *reading* a trip, and the cheapest on the
GPU. A 240 px passive map (`A·2①`) is a third of the fill of the others. It can fall back to the
static `RouteSketch` (no WebGL at all), and a scroll is the one gesture nobody has to learn. The
justified layout computed from `ratio` (`storyLayout.ts`) is sound engineering: exact
virtualisation, O(log n) `y↔t`, deep-link scroll with no image loaded.

**Serious problems.**
- **The scroll → time mapping fights the camera.** A transit break maps a gap of hours or days
  into a fixed 96 px (`A·2③`). One momentum fling crosses several transits in ~300 ms. The camera
  gets several far targets in a row, so `farZoomCap` pulls out and in repeatedly: the map
  yo-yos. Inside a justified row, 3–4 photos share one band, so the marker interpolates across
  photos it isn't showing. Scroll writes must also `markScrub()`, otherwise any jump over 3 h
  counts as a seek and **snaps** (`FOLLOW.seekMs`, `isScrub` 150 ms window), and transits never fly.
- **The docked map is too small for Follow as tuned.** 240 px minus the 70 px pad (fact 3) gives
  a city-scale view at best. The mockup's map in `A·2①` is an idealised crop.
- **Home is not index-free.** `classifyTrips` needs `ix` for homes and verdicts. The GPS share in
  month bars and the per-card route sketches (`A·1③`) need GPS rows. That means the full index or
  one members call per card (rate limit). The "paints before the index loads" promise covers
  names and dates only.
- **Arbitrary ranges are gone** (`A` risks). A desktop `?from=…&to=…` link opens as a month-like
  story with derived stops. That's acceptable, but cluster zoom links (`T14:00Z`) produce
  sub-stories nobody can make on the phone.
- **Two scroll owners at the right edge.** The day scrubber (`A·2⑤`), 28 px inset 6 px, sits
  inside Android Chrome's and iOS Safari's forward-swipe zones and over the scrollbar. Expect
  mis-grabs.
- **Play is buried** (⋯ or long-press the map chip, `A·2①`). Play is the product's demo moment
  (desktop landing, launch video). Auto-scroll with `play.ts` dwell is easy to build, but it hides
  the thing that makes Retrace different from a camera roll.

**Fixes.**
- Drive the cursor from the photo under the reading line, snapped to row centres, not from a
  continuous y. Treat a transit as one discrete seek: fly once when the line enters the transit
  block, don't interpolate inside it. Throttle `cursor` writes to rAF. Call `markScrub()` on every
  write.
- Size the docked map by aspect (~38–40% of `svh`, ≥ 300 px) and give the Follower its own pad for
  this shell (16–24 px).
- Home: render names and dates from `/api/albums`, then upgrade the cards to verdicts and sketches
  when the index lands. Never fetch members per card.
- Put Play on the docked map as a visible ▶ chip, not on a long-press.

**Steal from others.** B's ⏮ ⏭ stop stepping as the day-scrubber replacement (taps, not an edge
drag). C's vertical year rows with month cells (`C·1②`), which beat A's month bars by also
offering a long-press drag range. D's "cluster sheet → Zoom to these days" (`D·2②`) for Explore,
which reuses `zoomInto` instead of inventing "Just this stop".

**Effort: L.** `stops.ts` (S, shared), `storyLayout.ts` + virtualised Story (M), scroll↔camera
tuning (M, needs a device), Explore mode with an animated map resize (S–M; animate a clip or
transform, call `map.resize()` once at the end, never per frame), Home (S–M).

**What would kill it:** stop derivation reads badly on real libraries (layovers, a valley named
after one town), or scroll-linked camera jank on mid Android can't be tuned away. A survives the
second because it can run on the static sketch, but then it is a photo album with a picture of a
route, not Retrace.

## B · Horizontal filmstrip

**Strongest point.** The closest fit to the engine. The fixed playhead is exactly
`selection.cursor` + `markScrub()`, so a drag is a scrub (camera flies), a pin tap is a seek
(snaps). ▶ is `play.ts` unchanged, ⏮ ⏭ is `stepRow` over stops. Every gesture lives in one canvas
the app owns. Unlike a web bottom sheet, there is no browser scroll to arbitrate with, so the
engineering risk is contained in one component you control. "One owner per band" (B gesture
footer) is the cleanest conflict story of the four.

**Serious problems.**
- **The Filmstrip component is the whole product, and it is big:** momentum, detents at cuts,
  slow-drag snap per frame, pinch across three semantic levels with anchor preservation, peek on
  long-press, thumbnail scheduling by velocity, all in canvas with DPR handling. That is a custom
  physics widget, M–L by itself.
- **The Years level doesn't scale.** Album cards with a ~110 px minimum, packed into 2 lanes
  (`B·1②`, `B·1⑦`), across 20 years and 150 albums make a strip several thousand px wide with
  cards overlapping their true extents. Flinging through it to find "Greece 2019" is worse than
  a list.
- **Two horizontal time controls.** The ruler (`B·2⑥`) above the strip duplicates its job at
  another scale, and the doc admits it. On a 390 px screen that is 34 px spent on confusion.
- **The heaviest steady-state load.** A ~500 px map re-rendering every frame (Follow during a
  fling) *plus* a full canvas strip redraw every frame, both on the main thread. On a mid-range
  Android this is where 60 fps drops to 30, and a fling across days (`B·2③` cuts) asks for long
  camera flights. Cap the camera speed during momentum, or apply only the final detent.
- **In/Out marks behind a long-press on the level switch** (`B·1⑦`) is undiscoverable. Arbitrary
  ranges effectively don't exist.
- **The thumbnail claim is optimistic.** A 104 px tall frame at DPR 2.6–3 wants ~300 px. The 250 px
  `thumbnail` is borderline, so fine as long as nobody upgrades frames to `preview`.
- **History:** if the strip reuses TimeStrip's `commit` on release, every flick becomes a Back step
  (fact 8).

**Fixes.**
- Ship two levels, Trip and Photos. Replace the Years level with a list screen (C's library rows,
  A's Home). That removes the lane-packing problem and half the pinch work.
- Drop the ruler. Draw density as a 6–8 px band on the strip's top edge.
- Ranges: C's long-press drag across month cells on the picker screen. Kill In/Out.
- Momentum: animate the strip freely, but write `cursor` only on detent or settle during a fast
  fling (velocity > threshold). Slow drags write live. This halves the camera work and the
  thumbnail churn.

**Steal from others.** D's docked photo card (`D·2④`) above the strip: the centred frame at 72 px
is too small to *be* the card (`B·3②`), and people want to see the photo. A's lightbox filmstrip
and swipe-down-to-cursor (`A·4①③`). C's camera insets.

**Effort: L** (M if cut to two levels, no ruler, no In/Out).

**What would kill it:** users not grasping "drag the film, not the playhead" (the editor idiom),
or 194 photos = ~32 screens of film feeling like a chore. The Trip level with stop clips is the
mitigation, so make it the default after opening a trip, not Photos.

## C · Map-first with a bottom sheet

**Strongest point.** The follow camera gets the whole screen, which is the product's
differentiator at its most impressive. The library sheet's vertical year rows (`C·1②`) are the best
answer in the study to "all-years overview at 390 px": they scale to 20 years by scrolling, and the
month cells are finger targets. Place search over `city`/`country` (`C·1①`) is cheap and useful.

**Fatal problem: the place filter breaks the data model.** `Active` is a contiguous row slice
`lo..hi` of a time-sorted index. Everything downstream assumes that: `lightbox/model.ts step`/
`neighbours`/`fPosition` ("15 / 194"), `stepRow`, `playStart`, `cursorRow`, `densityBins`,
`segmentRoute`, the camera track. "Pamplona · 2 visits · 41 photos" (`C·3①`), with Play, ←/→ and
lightbox stepping only through matching photos (`C·3②`), is a non-contiguous predicate. Making it
work means a row-index indirection (`Int32Array` of matching rows) threaded through every one of
those functions, or a derived sub-index per filter, and a `near` URL param desktop doesn't know.
That isn't "plus a `near` field". It is a model change touching the map, lightbox and Play,
shared with desktop. **Fix:** a cluster tap does what desktop does. Show the visits in the half
sheet and let a tap narrow the selection to that visit's span with the existing `zoomInto`
(`from/to …T14:00Z`, Back returns). The URL is unchanged and nothing downstream changes.

**Serious problems.**
- **A web bottom sheet with three snaps and a nested virtual grid** is the hardest UI in the
  study: iOS rubber-banding, `dvh` changing mid-drag, scroll handoff at `scrollTop 0`,
  `overscroll-behavior` gaps, and the research already cites Immich's own sheet crash (#28878).
  The full snap (`C·4`) puts a virtualised grid inside it, the exact failure case.
- **The scrubber sits in the sheet's drag handle zone** (`C·2③`). Horizontal scrub and vertical
  sheet drag share a 44 px band, decided by direction lock. Every diagonal thumb movement is a
  coin flip between scrubbing time and collapsing the UI.
- **The highest GPU and battery cost.** A full-screen map always rendering under a translucent sheet,
  with Follow. The sheet drag must be a pure transform with padding updated on snap (the doc knows
  this), but the map still recomposites under it.
- **The library map of trips** (`C·1③`) needs trip centroids (full index) and one thumbnail per
  marker as a MapLibre image (`addImage` per trip, re-added on style changes). It is fine at 6
  trips. At 150, it needs clustering of trip markers, a second clustering system.
- **Pan the map to filter the trip cards** (`C·1④`): one more space → time direction that the
  selection model doesn't express.
- **No-GPS photos are invisible** until the full snap. The Kyrgyzstan-type trip (40% no GPS)
  looks broken at peek.

**Fixes.** Replace the place filter with a cluster → visits → `zoomInto` flow. Two fixed states
(peek, full) instead of three physics snaps, with full as a separate pushed screen rather than a
sheet state. That removes nested scroll entirely. Move the scrubber out of the handle band: a
handle row, then the scrubber row, with `touch-action: none` on the scrubber and the drag only on
the handle. Defer map-of-trips; use the year rows and cards list.

**Steal from others.** B's ⏮ ▶ ⏭ transport (C has only ▶, `C·2②`). D's docked card layout (C's
`C·2④` is already close). A's static-sketch fallback for low-end devices.

**Effort: L, realistically more** (sheet + grid + place filter + library map + insets). With the
fixes: M–L.

**What would kill it:** the sheet. If peek ↔ half ↔ full doesn't feel native on iOS Safari and
mid Android Chrome, the whole concept reads as a broken web app, and there is no cheap fallback
that is still this concept.

## D · Faithful port (tabs)

**Strongest point.** The lowest risk and highest reuse, and its Map tab (`D·2`) is the right mobile
core: full map, docked photo card (`D·2④`) in its own band, strip + Play in the thumb zone
(`D·2⑤`), and cluster → half sheet → "Zoom to these days" reusing `zoomInto` and the URL contract
(`D·2②`). No new model concepts. Links round-trip byte for byte. Gesture regions never overlap.

**Serious problems.**
- **The Overview tab is the desktop control at 390 px** (`D·1`). A pannable/pinchable wave with
  long-press brush and 44 px handles hung below the axis (`D·1③④`) is the most gesture code
  per user in the study, for a feature most phone users will never touch. They will use Albums.
  And it is the tab where time and place are never on screen together, the concept's own named
  weakness.
- **Four tabs + header = ~16% of height**, and Overview/Albums overlap in purpose (the doc says
  so). Photos (`D·3`) is an Immich-grid clone, with fact 11's network cost (3 columns × 126 px wants
  ~380 px, so either soft 250 px tiles or `preview` per tile).
- **The docked card uses `preview`** ("the 250 px thumbnail is too soft at DPR 3", `D·2④`). With
  swipe-to-step on the card and scrub on the strip, that is a 200–400 KB fetch per cursor move.
  Use `thumbnail` during movement and `preview` after rest (fact 11).
- **Hidden-but-alive map:** `visibility: hidden` is right (`display: none` makes `clientWidth` 0
  and `Follower.step` bails). On iOS, background tile workers die (MapLibre #8461). It needs a
  reload-on-show path, which the doc already flags.
- **Fact 1 hits D hardest:** it reuses Overview, but its landing tab is Map. If Overview isn't
  mounted, `albumRequest` never resolves.

**Fixes.** Collapse to one primary screen (the Map tab) plus a pushed Trips/Years picker screen
(merge Overview + Albums into C's year rows and trip cards). Drop the wave and brush on phones;
desktop links still open any range. Photos becomes an optional full-screen grid from the card
("All 194 photos"), not a tab. That removes the tab bar's 83 px.

**Steal from others.** B's fixed-playhead strip (drag the film, not a thumb under the finger) and
⏮ ⏭ over stops. A's lightbox with its filmstrip and segmented-by-day progress (`A·4③⑤`). C's year
rows for the picker.

**Effort: M** as drawn (tab shell, wave touch gestures, grid, pager, sheets). **S–M** with the fixes,
because the wave gestures and the grid go away.

**What would kill it:** nothing technical. It dies on product grounds ("a reflow, not a phone
experience"), which is why it shouldn't ship as drawn.

## Comparison

| | A story | B filmstrip | C map + sheet | D tabs |
|---|---|---|---|---|
| Effort as drawn | L | L | L+ | M |
| Effort with fixes | L | M | M–L | S–M |
| Model/URL changes | none (`view=map` optional) | none | **`near` + non-contiguous active (breaks model)** | none |
| New risky component | scroll↔camera sync | filmstrip physics | web sheet + nested grid | wave touch gestures (cuttable) |
| GPU / battery | lowest (static fallback) | high (map + per-frame canvas) | highest | medium |
| Network (cellular) | most thumbs (reading = loading) | low (6 frames visible) | high at full (grid) | medium (grid tab) |
| Arbitrary ranges | gone | hidden (In/Out) | month-granular | full (brush) |
| Code shared with desktop | high logic, all-new UI | highest logic, new UI | logic minus filter, new UI | highest incl. some UI |

A separate native app is not worth it for any of these. Every concept keeps the stores, URL
contract, index cache and camera, so a second codebase would fork exactly the parts that took the
most review rounds (local-day math, history rules, follow camera). One web app with a
`(pointer: coarse) and (max-width: 700px)` shell switch in `App.svelte` that lazy-loads a mobile
chunk is right, with desktop-only code (hover tips, wheel, shortcuts, inset, visits menu) kept out
of that chunk.

## Ranking

1. **B** (with fixes). Best match to the engine and the product's identity (cursor, scrub, Play,
   Follow), with risk confined to one component the app owns.
2. **D** (with fixes). The safest. Its Map tab is the right screen. Loses on everything around it.
3. **A**. The best reading experience and cheapest GPU, but the most new layout code and an
   unproven scroll↔camera feel. Best as a second mode, not the first ship.
4. **C**. Most impressive in a mockup, but the place filter breaks the model and the sheet is the
   riskiest web UI in the study.

## If I had to ship one

A hybrid on the D/B axis, **M effort**, built in this order:

1. **Groundwork (S–M, needed by any concept):** extract album actions from Overview (fact 1);
   split `MapView` into core + chrome (2); Follower insets (3); map `pixelRatio` ≤ 2 + context
   loss (4); static-SVG mini-map (5); scrub writes `replace` only on mobile (8); album-first boot
   (6) and interval refresh (7) if cold-start on cellular hurts in testing.
2. **One main screen:** full map with a floating context pill (trip, cursor time, ✕). The deck in
   the bottom ~35% has the docked photo card (D·2④, `thumbnail` while moving, `preview` at rest),
   then a **fixed-playhead filmstrip with two levels**, Trip (stop clips) and Photos (frames),
   from B. Transport is ⏮ ▶ ⏭ over stops. No ruler, no Years level, no In/Out.
3. **Picker screen** (pushed, not a tab): C's year rows with month cells (tap a month = month
   selection, long-press drag = month range), then trip cards from `trips.ts`, then search by
   album/year/place. Cards upgrade from names to verdicts once the index lands.
4. **Cluster tap → fixed-height half sheet** (not draggable): visits with thumbhash rows and "Zoom
   to these days" via `zoomInto` (D·2②). The pin tap stays a seek.
5. **Lightbox pager**, shared later by any mode: swipe ←/→ (`model.ts step`), swipe down back to
   the cursor, pinch zoom, info sheet with a static SVG route, segmented progress (A·4), a mini
   filmstrip (A·4③ / B·4⑤).
6. **`stops.ts`** (pure, tested) used by the strip clips and ⏮ ⏭. Later by A's story and desktop.
7. **Minimal SW** for the shell and recent thumbnails (fact 9).

Deferred, with no model changes: A's story as a "Read" mode on the same stores and `stops.ts`
(v2, once the scroll↔camera feel is prototyped on a real Android). A grid of the selection opened
from the card. Light theme. Rejected: C's `near` place filter, until desktop wants it too. D's
wave brush on phones.

Before committing to any of this, one day on a real mid-range Android: the demo trip with
`pixelRatio` 2, Play for 60 s, and a fling-scrub across the trip. Record the frame time and the
battery delta. Today those numbers don't exist even on desktop (roadmap "Frame times on a real GPU
are unmeasured").
