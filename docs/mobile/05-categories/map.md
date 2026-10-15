# 05 · Map (category design)

Brief: `../05-briefs/map.md`. Decision: `../04-decision.md` (§2, §6). Review: `../06-review.md`
(§1 wins where this doc disagrees). Mockup: `../mockups/map.html` (root `.mk-map`, rows
`.mk-map-v1|v2|v3`, ids `mk-map-*`). Screenshot: `../screens/map.jpg`. Demo data only; the map is
dark in every theme (v1, decision §4); chrome follows light/dark.

Demo trip used throughout (review §1.1): "San Sebastián to Huesca", 6–10 Sep 2024, 194 photos,
6 stops: 1 San Sebastián Fri 6 · 4, 2 San Sebastián Sat 7 · 10, 3 Yesa Mon 9 · 41, 4 Santa Cruz de
la Serós Mon 9 · 47, 5 Huesca Tue 10 · 44, 6 Huesca (evening) Tue 10 · 48. Sun 8 has no photos
(a fold on the strip). Leyre, Javier, Pamplona, Olite, Jaca are basemap labels only.

## Revised after review (06-review.md)

- Container is **0 → 614** at 390 × 844, ending at the constant 230 px deck; `insets.b = 0`. Dropped
  the "smallest / expanded deck" and "strip may hide during Play" rows.
- Landscape: no title over the map; title and deck in the right column; `insets.t = 12 + safe area`;
  ⓘ stays in the Follow/Fit stack (it no longer moves to the transport row).
- Title line 2 is static. The undo chip moved to the **status slot**; the long-hop label
  (`✈ 2 h 10 · 1 040 km`) moved to the **card's place line**. The Follow pill is now the
  **Follow chip** in the status slot.
- `← Back to trip` → the title's `‹`, named for its destination.
- Long-press pin peek **cut from v1**; the map has no long-press.
- V3's tap model is written up as an amendment to decision §0 (§3.1) and the hallway test now
  includes "find all photos taken at Yesa" (§6).
- Visit definition confirmed: a `stops.ts` stop matched by `city` (§0, visits sheet).
- New state: tiles fail / offline map (§0, V3·6 in the mockup).
- Mockup: canonical 6 stops (the invented "Olite, Sun 8" stop is gone), folded strip from the
  measured axis, `Sep`, static line 2, card = time large / place / counter, view switch
  `Replay | Photos` (`Replay | Story` in the phase 2 frame), sheets clipped with a 34 px safe-area
  pad, all text ≥ 11 px, V3·5 title in the column, pink callouts.

## 0. Shared by all variants (not variant questions)

### One map, one container per orientation

The map container never changes size in portrait. Everything that covers it changes
`map.setPadding(insets)` (MapLibre camera padding) once per state change; `Follower` reads the
padded viewport (`w − l − r`, `h − t − b`) and uses `FOLLOW.pad = 24` on the phone (70 is a desktop
value; with insets it leaves a 250 × 300 target on a 390 × 600 map).

| State | Container | Insets t / r / b / l (px, 390 × 844) | Visible frame | Notes |
|---|---|---|---|---|
| **Replay** | 0 → 614 (top of the 230 px deck) | 132 / 60 / 0 / 16 | ≈ 314 × 482 | t = safe area + title + 12; r = Follow/Fit/ⓘ column. The status slot (558–602) is not an inset: it is centred and transient |
| **Replay, playing** | same | same | same | Nothing collapses during Play (review §1.6): the card is the photo, the strip stays. No `map.resize()`, no inset change |
| **Story docked** (phase 2) | `clamp(160px, 30svh, 280px)` full width under the solid title bar, frozen at load/rotation | 8 / 8 / 8 / 8, pad 16 | ≈ 358 × 237 at 253 px | `pointer-events: none`, tap → Replay. Camera = stop frame (A's rule), flies only across transits |
| **Landscape** | left 58% (490 × 390 at 844 × 390) | 12 + safe area / 60 / 12 / 12 + notch | ≈ 370 × 366 | No title over the map (review §1.8); title, card, strip, transport in the right column. Follow/Fit/ⓘ bottom-right of the map column; the status slot at the bottom of the map column |

The deck height changes only on rotation or a text-size change; both are resizes, and rotation is
the only `map.resize()` in normal use.

### Lifecycle (one instance)

- Created once on first Trip mount, `pixelRatio: Math.min(devicePixelRatio, 2)`,
  `maxTileCacheSize` ~ 200, `fadeDuration: 0` during Play.
- Library, lightbox, Photos view: map element gets `visibility: hidden` (not `display:none`, which
  zeroes `clientWidth` and makes `Follower.step` bail); Follower `dispose()` of its rAF; MapLibre's own
  render loop is idle because nothing moves. On show: `resize()` only if the size changed, re-request
  tiles (iOS kills tile workers in the background, MapLibre #8461: reload the vector source if
  `areTilesLoaded()` is still false 1 s after show), `follower.snap()`.
- `webglcontextlost` → swap in `RouteSketch` (static SVG: route, gaps, marker, stop numbers) at the
  same size; card, strip, Play keep working; `webglcontextrestored` → re-add sources/layers, remove
  the sketch. Same sketch is the pre-load placeholder and the "WebGL unavailable" state.

### Tiles fail / offline map (review §2)

Tiles are the only network part of the map; route, stops, pins and marker are client data.
- Tile errors (MapLibre `error` events with a tile source, or `navigator.onLine === false`) for
  > 3 s → the map draws on its plain dark background (the style's background layer), with route,
  badges, chips, pins and marker unchanged. No `RouteSketch` swap (WebGL is fine).
- `© OSM` becomes `© OSM · Map offline` (11 px, same corner, no toast, no modal). Tap opens the ⓘ
  sheet at the attribution, which says tiles retry automatically.
- Follow, Fit and Play keep working; the camera moves over a blank ground. Cached tiles still show.
- Retry: on `online`, on every Follow fly, and on show (the iOS reload rule above). The label
  clears on the first successful tile.
- If the API is offline too, the status slot's `Offline · saved 2 h ago` notice is navigation's;
  the map adds nothing to the title.

### Marker

Amber 14 px dot, 2 px dark ring, 28 px soft halo while playing. **No-GPS cursor photo**: holds at the
last known position (`positionAt` already does), hollow, 2 px dashed ring, plus "no location" in the
card's place line (state never by opacity alone). Between two GPS points inside a gap (> 4 h):
hollow, moving along the dashed connector, as desktop `.marker.gap`.

### Follow / Fit / ⓘ and "you left Follow"

- Bottom-right of the map, portrait and landscape: a vertical segmented pair **Follow** (◎) /
  **Fit** (⤢), 44 × 44 each, then ⓘ 44 × 44 below. Labels 11 px. Active = filled amber with dark
  glyph; inactive = dark glass.
- **Pan/pinch** (any `originalEvent`) → `manual`, auto stays `follow`. Shown three ways at once:
  1. Follow button becomes amber **outline** with a ❚❚ badge (shape change, not opacity).
  2. The **Follow chip** `◎ Follow · 13:20 Yesa` in the status slot (review §1.5, priority 2). One
     tap resumes with a fly (not a snap) so the user sees where they were taken.
  3. If the marker is off-screen, an amber **edge chevron** on the viewport border points at it;
     tapping it = the chip. It is a tap target only, never a drag start (20 px edge rule).
- **What resumes Follow**: the chip, the Follow button, ⏮ ⏭, ▶ Play, a new selection
  (`camTo('select')` as desktop), closing the lightbox on a photo > `seekMs` away, a tap on another
  stop's badge (V3). **What doesn't**: strip scrub and pin tap (the user is looking at a place on
  purpose; the marker moves inside the view, and the chevron shows when it leaves).
- **Fit** frames the selection's GPS extent (desktop `whole`) with insets. After a `zoomInto` the
  selection *is* those days, so Fit frames them. Not "visible strip range" (the phone strip always
  shows the whole selection) and not "current stop" (Follow converges to that when the cursor
  dwells). In Fit the marker still moves and the camera doesn't; no Follow chip (Fit is a choice,
  not a pause). Fit is hidden when the selection has ≤ 1 GPS point.

### Taps, hit targets, overlap

- One `click` handler, `queryRenderedFeatures` on a **44 × 44 box** around the tap (desktop: point).
- Priority: the card is off-map (docked), so: stop badge / chip / cluster > pin > route. Among pins:
  nearest centre in screen px; ties (< 6 px apart) → nearest in time to the cursor.
- Visual sizes are smaller than targets (pins 12 px, badges 28–44 px); `clusterRadius` raised
  44 → 56 so two hit boxes rarely overlap more than half.
- A drag starting on a pin is a pan (MapLibre's own threshold). **No long-press on the map in v1**
  (review §1.3). Double-tap is MapLibre's zoom.

### Hover replacement

Desktop hover = "see before you commit". On the phone a pin tap commits only a **seek**, which is
cheap and visible (the card swaps to that photo instantly from thumbhash), so the tap itself is the
preview. The safety net is the **undo chip** `↩ 13:12` in the status slot for 4 s after any map
seek (priority 3: notices and the Follow chip outrank it). Tap = seek back. No peek: it was optional
and is cut from v1 (no hover equivalent is needed for a11y because the strip and the Photos view
reach every photo). The visits sheet is its own non-destructive preview.

### Visits sheet

**Visit** (review §1.2, confirmed for the albums designer): one `stops.ts` stop, seen from a place.
A place's visits are the stops whose `city` matches it; a stop's `city` is the most common `city`
among its rows. The visits sheet, "Also here" and Library place search all use this one
definition, so the same place lists the same visits everywhere. Stops with no `city` (no index yet,
no geocode) have no visits and the sheet falls back to the stop alone.

Fixed height, no grabber, no drag physics; ✕, scrim tap and system Back close it; swipes are
ignored; focus trapped, map `inert` behind. The 34 px safe-area pad is inside the sheet and the
content clips above it.
- **1 visit**: 300 px. Header `Yesa`, meta `Mon 9 Sep · 13:00–13:54 · 41 photos · 1 visit (stop 3)`,
  4 thumbhash → thumbnail tiles (tap = Jump here at that photo), buttons **Jump here** (seek to the
  visit's first photo, primary) and **Zoom to these days** (`zoomInto`, pushes history; the title
  then shows `‹` named for the trip). Kept even for one visit because the sheet is the preview.
- **n visits**: rows × 88 px + header, max 55svh, the list scrolls inside. One row per visit (day,
  `stop k`, span, count, 4 tiles, the two actions as 44 px buttons). Sorted by time; the visit
  containing the cursor is marked NOW. Demo: San Sebastián = stops 1 + 2, Huesca = stops 5 + 6.
- **Also here**: other albums with a visit to the same city, as chips
  `Pamplona & Basque Country · Aug 2024 · 13`. Tap = open that trip at its first photo there
  (pushes history). **Hidden** when no other album matches (Yesa in the demo), the index isn't
  loaded, or the selection is "all photos" / a month range without an album (every trip would
  match). Demo facts: Pamplona & Basque Country has 13 San Sebastián photos (Aug 2024); Pyrenees
  has 1 Huesca photo (15 Jul 2024).

### Gaps and long flights

- Gap (> 4 h, any distance): 1.5 px dashed grey, 50% opacity, no label. Already desktop.
- Long hop (> 150 km and > 4 h, e.g. a flight): a geodesic arc, same dash, with a tiny ✈ glyph at
  its midpoint only when the arc is ≥ 120 px on screen. Distance/time appear only for the hop the
  marker is currently on, in the **card's place line** (`✈ 2 h 10 · 1 040 km`, review §1.2). Never
  in the title.
- Follow across a long hop: existing `farZoomCap` pulls out; at phone width it pulls to country
  scale, which is the "flight" moment. Reduced motion: snap.

### Accessibility (all variants)

Canvas `aria-hidden`; the title and card are the text equivalent. Follow/Fit/ⓘ are real buttons
(`aria-pressed`, label "Follow paused, map moved"). The status slot is `role="status"`. Every map
action has a non-map path: pins → strip / Photos view; stops → the **Places list** in the ⓘ sheet
(each row: name, visits, count; tap = Jump here, ⋯ = the visits sheet). Contrast: route over the dark
basemap ≥ 3:1 (ramp start `#6E4519` is ≈ 2:1 on the basemap → raise to `#9A6828` (≈ 3.5:1) on the
phone). Reduced motion: Follow jumps per stop, no chip fly, no halo pulse. Text ≥ 11 px; the ❚❚
badge glyph is `aria-hidden`.

### Plugs into the other categories

- **Timeline**: stop ticks on the strip and the map's stop numbers come from the same `stops.ts`;
  ⏮ ⏭ resume Follow; scrub calls `markScrub()` (camera flies). The deck is constant, so the map
  never changes insets for the strip.
- **Navigation**: the title's height sets `insets.t` (portrait only); "Zoom to these days" pushes
  history and the title shows `‹` (drill-up named for its destination); the status slot is shared
  (notices > Follow chip > undo chip > first-zoom hint); tap on the Story docked map → Replay.
- **Preview / lightbox**: pin tap seeks, the card shows it, card tap opens the lightbox; map rAF
  stops under the lightbox; info sheet uses `RouteSketch`, never a second map. "Show on map" =
  view switch to Replay + cursor.
- **Albums**: "Also here" and place search use the visit definition above; Library hides the map
  (rAF off).

## 1. Variant 1 · Route-first

**Idea**: desktop symbology, finger-sized. Time-coloured route (amber ramp), pins as 12 px dots
(photo amber, video blue), clusters as count bubbles (30 / 36 / 44 px for < 10 / < 100 / ≥ 100).

- **Replay**: route + bubbles + dots + marker. Stops are not on the map; ⏮ ⏭ and the card name
  them.
- **Playing**: same; the travelled route stays bright, nothing reveals.
- **Docked (Story)**: route + marker only; pins/clusters hidden (`setLayoutProperty` once on
  entering Story), no interaction anyway.
- **Landscape**: same layers, smaller frame.
- **Gestures**: tap bubble → visits sheet (its visits = the stops in that city); tap dot → seek;
  pan/pinch → pause.
- **Edge cases**: single photo → one dot + marker, Follow = Fit (Fit hidden), zoom capped 15. Huge
  trip (2 000 photos, 3 weeks) → bubbles everywhere at trip zoom; route mostly hidden under bubbles
  (the main weakness). No GPS in the selection → dimmed map at the last view + centred notice
  `No locations in these dates · 4 photos · Show photos`. Slow network / offline tiles → as §0.
- **Cost**: today's sources and layers (`route`, `gaps`, clustered `pins`, one count symbol
  layer). No `addImage`. Play = one `jumpTo` per frame re-rendering circles + lines + one symbol
  layer: the baseline. **Lowest effort (S)**.
- **Against it**: the map speaks "clusters", the deck speaks "stops"; a 2 000-photo trip is a field
  of bubbles that hides the route, which is the hook.

## 2. Variant 2 · Thumbnail clusters

**Idea**: Apple Photos Places. Clusters/stops are 48 px rounded photo bubbles (cover photo +
count badge), numbered stop markers from B v2 tie to ⏮ ⏭, single pins appear only at street zoom
(z ≥ 15) as 38 px thumbs.

- **Replay**: route under a few large thumbnail bubbles; the current stop's bubble gets an amber
  ring and its number.
- **Playing**: bubbles stay; the docked card and the bubble show the same photo (duplication).
- **Docked**: one bubble for the current stop, route, marker.
- **Landscape**: bubbles collide earlier (390 px tall frame): ≤ 6 visible.
- **Gestures**: tap bubble → visits sheet (thumbnails already loaded, it feels instant); tap
  street-zoom thumb → seek. The thumbnail *is* the hover preview. This is its strongest point.
- **Edge cases**: video cover → poster + ▶ badge. No-GPS → as shared. Slow network → thumbhash
  bubbles (decoded RGBA, no request) until thumbnails arrive; a blurry blob field until then.
  Huge trip → re-clustering on every zoom picks new covers → new requests.
- **Cost (highest)**: two options, both worse than V1.
  - Symbol layer with `icon-image: ['get','cover']`: `addImage` per cover (thumbhash RGBA first,
    then the 250 px thumbnail drawn into a 96 px circle at DPR 2, ~37 kB GPU each), loaded through
    the existing `styleimagemissing` resolver; covers need `clusterProperties` (min `t` → row → id).
    Every zoom change can request new covers: against the 60 req / 6 s media budget and the demo
    relay limit. Symbol placement + icon atlas re-upload when images arrive mid-Play cause
    frame spikes.
  - DOM markers (`maplibregl.Marker` pool of ≤ 24): MapLibre rewrites each marker's transform
    every frame during Follow, i.e. 24 style writes + composited layers per frame; on mid Android
    this alone eats a few ms of the 33 ms p95 budget.
- **Against it**: covers the route (the product's hook) with the same photos the card shows,
  costs network on cellular, and stutters exactly during Play. **Effort M–L.**

## 3. Variant 3 · Stop-centric

**Idea**: the map shows the trip's **stops** (from `stops.ts`): numbered badges sized by photo
count (28–44 px), connected by the time-coloured route; individual photos (pins) exist only inside
the **current stop**. The map, strip ticks, ⏮ ⏭, the card (`32 / 194 · stop 3 of 6`) and Story
headers share one vocabulary.

- **Replay**: route; travelled part full ramp, ahead at 40% (`setFilter` split at the stop boundary,
  updated **on stop change only**, never per frame); stop badges with numbers; current stop badge
  amber-filled with its name chip (`3 · Yesa · 41`); inside it, pins (12 px dots, small clusters
  `clusterRadius` 40).
- **Playing**: the same, the current stop's pins `setData` once per stop crossing (10–80 points,
  cheap worker re-cluster); route "fills in" stop by stop. This is the replay feeling for free.
- **Fit (whole trip)**: badges only (no pins outside the current stop). Consecutive stops at the
  same place draw as one badge (`1·2` San Sebastián, `5·6` Huesca). Dense selections (All photos,
  month ranges): the stops source is clustered; a stop cluster shows the **range** `4–9`
  (`clusterProperties` min/max of stop number, sum of count). Tap a range badge → zoom the map to
  it (map only, not the selection).
- **Docked (Story)**: identical symbology at 253 px: the frame is the current stop (A's camera),
  neighbours' numbers peek at the edges; flies only across transits. Pins hidden.
- **Landscape**: same symbology; the current stop chip stays on the map (there is no title over
  the map to carry it).
- **Gestures**:
  - Tap **another stop's** badge → seek to its first photo (= ⏮ ⏭ to there; Follow resumes since
    it's a stop jump).
  - Tap the **current** stop's badge or chip → visits sheet for that place (all visits to it in the
    selection, Jump here, Zoom to these days, Also here). "Tap = go there, tap again = more about
    there".
  - Tap a pin inside the current stop → seek (+ undo chip).
  - Pan/pinch → pause, Follow chip, chevron (shared rules). No long-press.
- **Edge cases**: single photo → one stop, one pin, Fit hidden. Selection without an album (month
  range, all photos) → stops still come from `stops.ts`; > 60 stops just means more clustering.
  A place visited twice → one badge (`1·2`), and its visits sheet lists both. No-GPS stop (all rows
  without location) → no badge; the card and strip still show it; the marker holds hollow at the
  previous stop. Slow network / offline tiles → §0. Stop thresholds are owner-tuned (decision Q3);
  the map tolerates either rule.
- **Cost**: two GeoJSON sources (stops, clustered; current-stop pins, clustered) + route split into
  two layers by filter. Fewer features drawn per frame than V1 at trip zoom (≤ 30 badges + ≤ 80 pins
  vs every pin of the trip). No `addImage`. Play frame time ≈ V1 or lower; one `setData` + one
  `setFilter` per stop crossing (seconds apart). **Effort S–M** on top of V1 (needs `stops.ts`,
  which the deck needs anyway).
- **Against it**: photos of other stops aren't individually tappable until you go there (one extra
  tap); "all photos at a place" is one tap further than in V1 (§3.1); the stop rule must be good, or
  the map shows weird stops.

### 3.1 Amendment to decision §0 (needs the lead's sign-off)

Decision §0 settled "**cluster tap → fixed-height visits sheet → `selection.zoomInto`**". V3 changes
the first step:

| Tap on | Decision §0 | V3 (proposed) |
|---|---|---|
| A non-current stop badge | visits sheet | **seek** to the stop's first photo, Follow resumes |
| The current stop badge or chip | visits sheet | visits sheet (unchanged) |
| A range badge (`4–9`, dense selections) | visits sheet | zoom the map only |

The sheet, its fixed height and `zoomInto` stay as decided; no non-contiguous filter is added. The
cost is one extra tap to reach a place's visits (tap = go there, tap again = visits). The ⓘ Places
list reaches the same sheet in one tap from anywhere. Review §4 accepts this; the lead records it
in `04-decision.md` §0. Validate with the hallway test task "find all photos taken at Yesa" (§6).

## 4. Answers in one place

| Question | Answer |
|---|---|
| Sizes | §0 table. One container per orientation (portrait 0–614, insets 132/60/0/16; landscape left 58%, no title over it); docked = separate frozen size (Story view). |
| Hit targets | 44 × 44 query box; visuals 12–44 px; priority badge/chip/cluster > pin; nearest, then nearest in time. |
| Hover replacement | Tap-to-seek is the preview (card swaps instantly) + undo chip in the status slot. No map long-press in v1. Visits sheet is its own preview. V2 gets it for free but pays for it. |
| Left Follow | Outline Follow button + ❚❚, Follow chip in the status slot, edge chevron to the marker. Resumed by chip/button, ⏮ ⏭, Play, new selection, another stop's badge; not by scrub or pin tap. |
| Fit vs Follow | Vertical segmented pair + ⓘ, bottom-right, filled = active. Fit = selection extent with insets. |
| Gaps / flights | Dashed, no labels; arcs with ✈ only when ≥ 120 px; one live label in the card's place line. |
| Visits sheet | Visit = `stops.ts` stop matched by city. 300 px for 1 visit, rows × 88 up to 55svh for more; 34 px safe-area pad; Also here hidden without another album, the index, or album context. |
| Offline tiles | Vector layers on the dark background, `© OSM · Map offline`, Follow/Fit/Play unchanged, retry on `online` / fly / show. |
| Cost | V1 baseline (no images); V2 `addImage` per cover or DOM markers per frame + network; V3 two small extra sources, updates per stop only. |

## 5. Recommendation: Variant 3, stop-centric, built on V1's layers

1. **One vocabulary.** The decision made `stops.ts` the spine (⏮ ⏭, strip ticks, Story chapters,
   transits). V3 is the only variant where the map says the same thing: `stop 3 of 6` on the card
   and `Yesa` on the stop label is badge 3 on the map.
2. **The route stays visible.** Badges are few and small; the travelled/ahead split makes Play look
   like a replay without per-frame work. V1 buries the route under bubbles on long trips; V2 under
   photos.
3. **Same or lower cost than V1**, no images, no network, updates only on stop changes; it fits
   the 33 ms p95 Play budget better than V2 by construction.
4. **Story docked uses the same symbology**, so switching views is seamless.
5. **Cheap to fall back.** V3's layers are V1's plus a filter: if stops misbehave on the owner's
   library (thresholds, decision Q3), set the pins filter to "all rows" and hide badges, and you
   have V1. The tap model then falls back to decision §0 as written.

Take from V2 only the idea that the visits sheet loads its thumbnails immediately (thumbhash
first). Ship the undo chip; no peek.

## 6. Hallway test (map tasks)

Run on a phone with the demo, Replay at stop 1, no hints. Pass = done without help in the stated
taps.

1. "Find all photos taken at Yesa." Expected: tap badge 3 (seek), tap it again (visits sheet),
   Jump here or Zoom to these days; or ⓘ → Places → Yesa. Pass ≤ 4 taps. Watch for: expecting the
   first tap to open a list (the §0 amendment's risk).
2. "Go back to where the map was following." (after the tester pans) Expected: the Follow chip or
   the Follow button.
3. "Show the whole trip on the map." Expected: Fit.
4. "You tapped the wrong photo on the map; undo it." Expected: the undo chip within 4 s, or the
   strip.

## 7. Open points for the lead

- Record the §0 amendment (§3.1) in `04-decision.md`.
- Route ramp contrast (`#6E4519` start) needs a phone tweak; touches `draw.ts`/MapView `RAMP`.
- Whether ⏮ ⏭ should resume Follow is a behaviour change vs desktop (desktop keeps manual until
  select); recommend aligning desktop too.
- Measure on device: Play 60 s with V3 layers at `pixelRatio` 2, and the iOS tile reload on show.
- Brief said output at `05-categories/map.md`; the task said `05-categories/map.md`. Written here.
