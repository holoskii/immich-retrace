# Concept C: map-first with a bottom deck (rev. 2)

Mockup: [`../mockups/concept-c.html`](../mockups/concept-c.html) (root class `.mk-concept-c`).
Rev. 2 follows the UX and engineering critiques; see "Response to critique" and the changelog at
the end. The original three-snap draggable sheet is gone.

## Core idea

The map is the app: one full-screen MapLibre instance lives for the whole session. Time controls
sit in a **fixed bottom deck** (not draggable): trip title, the cursor photo docked as a card with
stop-step buttons, and a fixed-playhead density strip with Play. Everything else is a separate
state with one clear way in and one way out: the **Photos** screen (pushed, grid with day
chapters, a static map lip on top), the **Library** (map of trips + year rows + search), and a
transient **place sheet** when a cluster is tapped.

Opinion: this concept answers "where was I, and what did I shoot there". Place is a way to
*navigate* (cluster → visits → zoom to a visit; search "Pamplona" → trips and visits there), not a
filter over the selection. Time stays a contiguous selection, exactly as on desktop.

## States and layout (390 × 844)

| State | Map visible | Bottom UI | Way in / out |
|---|---|---|---|
| **Trip** (default) | ~620 px, camera padded by the deck | Deck, ~222 px incl. 34 px home inset: title row (44), cursor card (64), scrub row (50) | Landing; pick a trip |
| **Place sheet** | ~400 px, fitted to the cluster | Fixed-height sheet (half screen), covers the deck | Tap a cluster / ✕, Back, tap map |
| **Photos** | 96 px lip, static (rAF paused) | Full-height scroll container | "194 ▦" in the title row or swipe up on the title row / "‹ Map", Back, swipe down on the header |
| **Library** | ~375 px, all trips | Panel with search, years, trips; scrolls inside | Tap the trip title / pick a trip, Back |

There are no snap physics. The deck has one height. The place sheet has one height. Photos and
Library are pushed states (history entries) with their own scroll containers, so no scroller is
ever nested inside a draggable surface. The only drag gesture on the deck is "swipe up on the
title row" = open Photos (a threshold, not a tracked sheet), with a tap fallback.

Map chrome floats above the deck: readout chip top-left (`Day 4 · Mon 9 Sep · 13:04`, also the
text equivalent of the map for screen readers), Follow and Fit in the right thumb arc, attribution
`ⓘ` on the deck edge. No legend, inset or zoom buttons.

Camera: `Follower.insets = {t: 56, r: 16, b: deckHeight + 16, l: 16}` (shared groundwork, see
eng critique fact 3). Insets change only on state changes, never per frame.

## Flows

1. **Open the app (demo).** Lands on "San Sebastián to Huesca, 6–10 Sep 2024" in Trip state,
   cursor mid-trip, Follow on. Play pulses once and a one-line hint sits over the strip: "Press
   ▶ to replay the trip, or drag the strip". It disappears on the first touch of the deck and
   never returns (localStorage flag, defaults to shown).
2. **Open the app (owner, no URL).** Library. It paints names and dates from `/api/albums` first,
   then the year rows and trip markers once the index arrives.
3. **Pick a trip.** Tap a trip marker or card → map flies to the trip bounds, Trip state, cursor at
   the start. History push.
4. **Move through time.** Drag the strip sideways under the fixed centre playhead; momentum; slow
   drags snap to photos; a fling settles on the nearest **stop boundary** (amber ticks on the
   strip, from B). During a fast fling the cursor is written only at settle (eng B fix), so the
   camera doesn't chase every frame. `‹ ›` on the card step by **stop**; tap a spot on the strip to
   seek there. Play steps photo by photo (`play.ts`). URL `at` is written with `replace`, never
   pushed.
5. **See a place.** Tap a cluster → map fits it, place sheet: `Pamplona / Iruña · 2 visits ·
   41 photos` and one card per visit (from `clusterVisits`: time span, sub-place, count, 4 thumbs).
   - "Zoom to visit" → `selection.zoomInto` (desktop's cluster behaviour, `from/to` to the minute,
     history push, Back returns).
   - Tap a thumb → lightbox within the current trip.
   - "Also here" row: other trips with photos whose index `city` matches (`Pamplona & Basque
     Country · Aug 2024 · 3 visits ›`). Opening one is an ordinary trip pick.
   - Tap a single pin → cursor seek; the card shows that photo (touch replacement for hover).
6. **Browse photos.** Title row "194 ▦" (or swipe up) → Photos: day chapters (`Mon 9 Sep · Day 4`),
   stop sub-headers (`Yesa · 12:40–13:30 · 18`), transit rows between stops (`2 h 05 · about 62 km
   → Jaca`, from A), 4-column grid, fast-scroll thumb with day labels. **Scrolling never moves the
   cursor** (D's rule). The cursor tile has an amber ring; a "Cursor photo" pill scrolls back to it.
   No-GPS photos are here like any other, with a crossed-pin badge.
7. **Open a photo.** Card, visit thumb or grid tile → lightbox (shared design across concepts: swipe
   ←/→ steps in time order within the selection, swipe down closes to the cursor, pinch zooms and
   disables paging, info sheet with static SVG route). Opening a tile sets the cursor (replace).
8. **Share.** Share button in the title row and lightbox: `navigator.share` with the current URL,
   copy as fallback. URL contract unchanged.
9. **Switch trip or period.** Tap the title → Library. Prev/next trip are `‹ ›` at the end of the
   Photos screen and on the selected trip card in the Library, not gestures on the title.

## Library (replaces the overview, albums and picker)

- **Search** over trip names, years, and **places** (`city`/`country` from the index). A place
  result opens a list: trips and visits there, newest first ("Pamplona: 3 trips, 112 photos").
  Each row is a contiguous selection (a trip, or a visit via `zoomInto`).
- **Years**: one row per year, 12 month cells (density sparkline, GPS solid, no-GPS hatched), trip
  bars under it. Whole column is the hit area (44 px tall, ≥ 25 px wide). Tap a year or a month;
  long-press and drag across months for a range.
- **Trips**: cards newest first (`trips.ts`); "All albums" tab for the rest. A chip `In view · 5 of
  6 ✕` shows when panning the map has filtered the list (a list filter only, never the selection).
- **Map of trips**: one GeoJSON source with `cluster: true` (the same mechanism as pins today), so
  overlapping trips become a count bubble (`2 trips`) and labels never collide. Thumbnail markers
  only for unclustered trips on screen (≤ ~12 `addImage`s, re-added on `style.load`).
- No day brush. Desktop `from/to` links still open exactly; the title then says `6 Sep → 10 Sep 2024`.

## Gestures

| Region | Vertical | Horizontal | Tap | Other |
|---|---|---|---|---|
| Map | pan | pan | cluster → place sheet; pin → seek; empty map closes the place sheet | pinch zoom (pauses Follow), rotate off |
| Deck title row (44 px) | swipe up → Photos | – | title → Library; ▦ → Photos; share | – |
| Cursor card | – | – | → lightbox; `‹ ›` step by stop | – |
| Scrub row | **nothing** (`touch-action: none`) | scrub | Play; tap strip → seek | pinch → time zoom |
| Place sheet | scroll its list | – | visit / thumb / "Also here" | – |
| Photos header | swipe down → back to map | – | ‹ Map | – |
| Photos grid | scroll (no cursor change) | – | lightbox | fast-scroll thumb (right edge, 16 px inset) |

- Each band has one owner. The scrubber cannot move the deck, because the deck doesn't move.
- Strip drags start ≥ 16 px from the screen edges so the OS back gesture wins at the edge.
- Pan/pinch pauses Follow ("Follow ⏸", tap to resume). Picking a trip, stepping a stop or Play
  resumes it.

## Accessibility and motion

- Strip: `role="slider"`, `aria-valuetext="Mon 9 Sep, 13:04, Yesa, photo 112 of 194"`, arrows =
  photo, Page Up/Down = stop. Polite live region, debounced 500 ms, on cursor change.
- Map `aria-hidden`; the readout chip and the card carry the same information as text. Place sheet
  and Library are plain DOM lists with headings. Tiles get alt text from time + place.
- `prefers-reduced-motion`: cluster fit and trip picks jump instead of flying, Follow jumps per
  stop, no strip momentum, state changes crossfade, Play keeps its 2.5 s step.
- Type ≥ 11 px for any information; no-GPS state is hatched, not only greyed.

## Landscape and small phones

- Landscape: map left 60%, the deck becomes a right column (title, card, strip stacked) and the
  place sheet / Photos / Library open in that column. Same components, `flex-direction` and
  insets change (`insets.r = column width`), not a second layout.
- 360 × 640: deck stays 222 px (35% of height), map keeps ~370 px. The card truncates the place
  line, not the `‹ ›` buttons. Strip is ~250 px wide at 360.

## URL state

Unchanged contract: `from/to`, `album[&mode=range]`, `at`, `lb`. No `near`. Place sheet, Photos
and Library are UI state; Photos and Library are history entries without URL params (Back works,
links open in Trip state).

## Reused vs new

Groundwork shared with every concept (eng fact list): album actions out of `Overview.svelte`
(`pickAlbum` → `actions.ts`), `MapCore` split from `MapView`, Follower insets, `pixelRatio ≤ 2` and
context loss, static-SVG mini-map, scrub writes `replace`, album-first boot.

Reused: index + cache, `selection.svelte.ts` (no new fields), `route.ts` (`clusterVisits`,
`stepRow`, `cursorRow`, `densityBins`, …), camera + `follow.ts`, `play.ts`, `trips.ts`,
`landing.ts`, `thumbhash.ts`, `media.ts`, lightbox `model.ts`.

New: fixed `Deck`, fixed-playhead `Scrubber` (same component as B's strip, one level), `stops.ts`
(shared with A/B), `PlaceSheet` (visits + "Also here" by `city`), `PhotosScreen` (virtualised
grid with chapter/stop/transit rows), `Library` (year rows, trip cards, clustered trip source),
mobile lightbox.

**Effort: M** (deck S, scrubber M, Photos M, Library S–M, place sheet S), plus the shared
groundwork. Rev. 1 was L+.

## Performance and data

- One WebGL context. rAF paused when settled, in Photos (lip is static, cursor can't move there),
  under the lightbox and in a hidden tab. `pixelRatio ≤ 2`, smaller tile cache.
- Fill cost is still the highest of the concepts (map ~75% of the screen in Trip state). Before
  committing: one real mid-range Android, demo trip, 60 s of Play plus a fling, frame time and
  battery delta. Fallback if it fails: Follow jumps per stop instead of a continuous camera.
- Grid and card media: thumbhash during movement, `thumbnail` once settled, ≤ 6 in flight,
  `preview` for the card only after ~300 ms at rest.
- Library before the index: names and dates only; year rows, markers and place search arrive with
  it.

## Risks

1. GPU/battery on mid Android (above). It is measurable in a day and has a fallback.
2. Demo visitors who only pan the map. Mitigated by the Play pulse + strip hint on landing and the
   card that changes as they tap pins.
3. Reliving is still weaker than A. Chapters and transits in Photos help; Play is the replay.
4. Trips with little GPS look sparse on the map. The deck strip and Photos show every photo; the
   card says "no location · near Yesa" for no-GPS cursor photos.
5. The cross-visit "everything from Pamplona" view is gone as a single Play-able set. It becomes a
   list of visits/trips you open one at a time.

## Best and worst at

Best: place questions ("where in Pamplona did I go, which trips"), keeping the route in view while
browsing photos, one-handed use (all controls in the bottom third), owner home screen (map of
trips + year rows + place search).

Worst: reading a trip as a story (A wins), precise date ranges (no brush), GPU cost.

## Response to critique

UX = `03-critiques/ux.md`, Eng = `03-critiques/eng.md`.

| # | Criticism | Verdict | What changed / why not |
|---|---|---|---|
| 1 | Scrubber inside the drag-to-snap header; diagonal thumb arcs snap the sheet (UX, Eng) | **Accept** | The deck no longer moves. Scrub row is `touch-action: none`; the only vertical gesture is a swipe-up threshold on the title row. |
| 2 | Place filter is a non-contiguous predicate; breaks `lo..hi` everywhere (Eng, "fatal") | **Accept** | Verified: `Active`, `stepRow`, `densityBins`, lightbox `step` all assume a slice. Cluster → place sheet → "Zoom to visit" via `zoomInto`. Cross-trip value kept as "Also here" rows and place search results, each opening a contiguous selection. `near` dropped. |
| 3 | Web sheet with three snaps and a nested virtual grid is the riskiest UI (UX, Eng) | **Accept** | No snap physics. Fixed deck, fixed-height place sheet, Photos and Library are pushed states with their own scroll. No nested scroll handoff anywhere. |
| 4 | Mode soup; three gestures on the trip chip (UX) | **Accept** | Title: tap only. Prev/next trip moved to Library card and end of Photos. States reduced to Trip / Place sheet / Photos / Library, each with one entry and Back as exit. Place filter mode gone (row 2). |
| 5 | Reliving is weak (UX) | **Partly accept** | Stole A's day chapters + transit rows for Photos, B's stop ticks/detents and stop stepping. Rebut the rest: C answers "where"; a narrative reader is A's job and can share `stops.ts`. |
| 6 | Grid scroll silently moves the cursor (UX) | **Accept** | D's rule: scroll never moves the cursor; tap sets it. Map lip in Photos is static. |
| 7 | Demo visitor never touches the strip (UX) | **Accept** | Landing: Play pulses once + one-line hint over the strip. |
| 8 | Screen readers (UX cross-cutting) | **Accept** | Slider semantics, live region, readout chip as the map's text equivalent. Section added. |
| 9 | Reduced motion (UX) | **Accept** | Jumps instead of flights, no momentum, crossfades. |
| 10 | Landscape needs a second layout (UX) | **Rebut, partly** | With a fixed deck it is a right column of the same components, not a second layout. Spec added; real cost is the insets change, which is groundwork anyway. |
| 11 | Type below 11 px; dimmed bars carry state by opacity (UX) | **Accept** | Mockup labels ≥ 11 px. Dim-for-filter is gone; no-GPS bars are hatched. |
| 12 | Trip markers collide on the library map (UX); map of trips needs a second clustering system at 150 trips (Eng) | **Accept collision, rebut cost** | Trip markers use a GeoJSON source with `cluster: true`, the mechanism `MapView` already uses for pins (`clusterRadius 44`), so it's a second source, not a second system. Mockup shows a `2 trips` bubble. Thumbnails only for unclustered on-screen trips. |
| 13 | Pan-to-filter trip cards is a space→time direction the model doesn't express (Eng) | **Rebut** | It is a list filter over trip bboxes, never written to `selection`. Made explicit with an `In view · 5 of 6 ✕` chip. |
| 14 | No-GPS photos invisible until full (Eng) | **Accept** | Strip shows them (hatched), card says "no location · near <last place>", Photos shows them with a badge, title row shows "4 without location". |
| 15 | Highest GPU/battery (Eng) | **Accept, not fixable by design** | It's the price of map-first. rAF paused in Photos/lightbox, `pixelRatio ≤ 2`, device measurement before commit, Follow-per-stop fallback. |
| 16 | "Library is index-only, no extra requests" is false on a cold visit (Eng fact 6) | **Accept** | Library paints from `/api/albums` first; markers/years/search arrive with the index. Album-first boot listed as groundwork. |
| 17 | Scrub pushes history per drag (Eng fact 8) | **Accept** | `at` written with `replace` only. |
| 18 | Demo lands on nothing without Overview (Eng fact 1) | **Accept** | `actions.ts` extraction listed as groundwork step 1. |
| 19 | 360 px untested (UX) | **Accept** | Budget added; card truncates the place line, never the `‹ ›` targets. |
| 20 | Long-press "photos near here" | **Dropped** (own call) | It needs a radius query across the whole index and the dropped filter. v2 if desktop gets places. |
| 21 | Overall ranking: Eng last, UX second | **Noted** | Rev. 2 converges with D's Map tab + B's strip for the Trip state (which both critiques' "ship one" picks already describe) and adds what only C has: map-of-trips Library, place sheet with "Also here", place search. It can be read as the Library + place layer on top of that consensus core. |

## Changelog

- **rev. 2 (2026-10-14)**: three-snap draggable sheet → fixed deck + pushed Photos/Library + fixed
  place sheet. Place filter (`near`, non-contiguous active) → place navigator (`zoomInto`, "Also
  here", place search results). Added ⏮⏭-style stop stepping (`‹ ›` on the card) and stop ticks
  on the strip (B), day chapters + transit rows in Photos (A), grid scroll never moves the cursor
  (D). Title row tap-only; prev/next trip moved. Demo Play pulse + strip hint. Trip markers
  clustered. No-GPS hatching and copy. Accessibility, reduced motion, landscape, 360 px sections.
  Long-press "near here" dropped. Effort L+ → M. Mockup redrawn: Library, Trip (landing), Place
  sheet, Photos.
- **rev. 1**: initial concept.
