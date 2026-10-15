# Concept A: Vertical story scroll (v2, after critique)

Mockup: [`../mockups/concept-a.html`](../mockups/concept-a.html) (root class `.mk-concept-a`).
Example data is from the public demo: "San Sebastián to Huesca, 6–10 Sep 2024", 194 items, 4 without
location. Days by photos: Fri 6 Sep San Sebastián 4 · Sat 7 San Sebastián 10 · Sun 8 none ·
Mon 9 Yesa 41, Santa Cruz de la Serós 47 · Tue 10 Huesca 92.

## Core idea

A trip is a page you read top to bottom: photos flow down in time order, grouped into day chapters
and stops (place + time span), with the travel between stops drawn as a "transit" break. A passive
map docked at the top shows **the stop you are reading** and moves only when you cross into the
next stop. Touching the map opens Explore, a full-screen map mode (D's Map tab, nearly verbatim)
where the route replays. Home is the all-years overview as a vertical list of years.

Opinions this concept commits to:
- **Scroll is the reading control; the transport bar is the time control.** One floating bar in
  the thumb zone (day chip · ⏮ ▶ ⏭) carries every coarse jump and Play. No edge scrubber, no brush.
- **The docked map is never interactive.** Touching it opens Explore. Pan and page scroll never
  share the screen.
- **The camera moves per stop, not per row.** Inside a stop the map holds the stop's frame and only
  the marker moves. Crossing a transit is one flight. Browsing back and forth inside a stop never
  moves the camera.
- **Bounded pages.** A story is one trip (album) or one period (month, month range, or a
  deep-linked range). Story ends link to the previous/next trip.
- **No new model concepts.** Everything is a contiguous `Selection` + `cursor`; the URL contract
  is unchanged except an optional `view=map`.

## Screens

### 1. Home (all-years overview)
- Top: one-line demo strip, "Retrace", search ("trips, places, years"), Trips | All albums.
- One section per year, newest first: 12 month columns (bar = √count from the month manifest; GPS
  share colours arrive with the index), then that year's trip cards (cover mosaic, name, dates,
  count; route sketch and trip verdict appear once the index lands; never one members call per card).
- **Tap a month column** (the whole 26×56 px column is the target, not the bar) → month story.
  **Long-press, then drag across columns** → a month-range story (`from/to`), with a bubble
  "Jul – Sep 2024 · 412". Reaches across year rows when dragged vertically.
- **Search** matches album names, years and places (`city`/`country` from the index). A place
  result lists its visits ("Huesca · Tue 10 Sep 2024 · 92 · in San Sebastián to Huesca"); tapping
  one opens that trip's story scrolled to the stop (`album` + `at`). Place results only appear once
  the index is loaded; names and years work from `/api/albums` immediately.

### 2. Story (the core screen)
Portrait at 390×844:
- Header (52 px): ‹ Home, trip name + "6–10 Sep 2024 · 194", Share, ⋯ (album / all photos in these
  dates, credits).
- **Docked map**: height `clamp(160px, 30svh, 280px)`, frozen at load and rotation (253 px here,
  192 px on 360×640). Follower uses a 16 px pad for this shell. Frames the current stop's photos;
  the marker sits on the current row's photo; route past solid, future faint. A small whole-trip
  inset top-right shows where this stop is in the trip. Bottom-left chip "Mon 9 Sep · 16:57 ·
  Santa Cruz de la Serós" (also the map's text equivalent). `pointer-events: none` on the canvas;
  one tap target → Explore.
- **Sticky chapter header**: day line ("MON 9 SEP · DAY 4 OF 5") + current stop line ("Santa Cruz
  de la Serós · 16:57–18:59 · 47") + the cursor time on the right ("16:57"). Updates as you scroll.
- **Story column**: stop header, full-width hero (first photo of a stop), justified rows (2–4
  tiles, ~108 px) from `ratio`, transit breaks ("3 h 03 · about 38 km · Yesa → Santa Cruz"),
  empty days as one thin line, prev/next trip cards at the end.
- **Timeline spine** in the left gutter: a thin line through the whole story; dashed through
  transits; an amber dot + amber segment beside the **current row**. Current row = the first row
  whose centre is below the chapter header. This replaces the v1 invisible "reading line" and the
  tile ring.
- **Transport bar** (floating, bottom, 60 px, inset 12 px + safe area): day chip "Day 4 of 5 ▾"
  (tap → day sheet: days with counts and stops, tap one to jump), ⏮ / ⏭ (previous / next stop),
  ▶ Play (52 px, amber). Hides to just ▶ while flinging downward; returns on any upward scroll or
  stop. In the demo, ▶ pulses once on landing.
- **Play** scrolls the story stop by stop with `play.ts` dwell (rows dwell, transits fly) and the
  map draws the route as it goes. Any touch stops it.

### 3. Explore (full-screen map mode; D's Map tab)
- Tap the docked map → map grows to full screen (animate a clip, `map.resize()` once at the end).
- Bottom deck, all in the thumb zone: a card slot (photo card by default: thumb, time, place,
  "Open photo"), a density strip with the cursor (drag scrubs, `replace` history only), and the same
  transport bar as Story with "‹ Story" in place of the day chip. Follow / Fit sit in the right
  thumb arc just above the deck. Nothing in the top corners.
- **Tap a cluster** → the card slot becomes the cluster card: place, visits (one row each: date,
  time span, count, 4 thumbhash thumbs). Per visit: **Jump in story** (sets cursor, closes Explore)
  or **Zoom to these days** (`selection.zoomInto`, pushes history, Back returns, desktop URL).
  ✕ returns the photo card. Tap a pin → cursor there (a seek, snaps).
- Close: "‹ Story", swipe the deck down, or Back. URL has `&view=map` while open.

### 4. Lightbox (photo pager)
- Full-bleed photo on black; top: progress segmented by day, "56 / 194 · stop 4 of 5", ✕.
- Swipe ←/→ steps (`model.ts step`, history `replace`); pinch / double-tap zoom, and while zoomed,
  paging is off (D4 rule). Swipe down closes back to the story **with this photo's row as the
  current row**; the map follows.
- Filmstrip: fixed centre, segmented by stop (gaps between stops, from B4).
- Info sheet: time + UTC offset, place, coords, static SVG mini-map (`routeLines` + `gpsExtent`),
  Share, Open in Immich (credits in the demo). Preload ±1 preview, ≤3 decoded.

### Landscape and short phones
- Landscape: side by side. Map sticky on the left 50%, story column on the right with its own
  chapter header and transport bar. Never stack map over story when the viewport is < 500 px tall.
- 360×640: map 192 + header 52 + chapter 56 + status 24 leaves ~316 px of story. The transport bar
  collapses while flinging (see above), so it doesn't eat the reading area.

## Flows

| Step | How |
|---|---|
| Open the app | Deep link → that state. No query → Home. Demo: lands in the `DEMO_TRIP` story, ▶ pulses once, Home is one Back away. |
| Pick a trip | Home: tap a card, or search by name / year / place. Month column → month story; long-press-drag → month range. |
| Move through time | Scroll (reading), ⏮ ⏭ (stop), day chip (day), Play (watch). Explore strip for free scrubbing. |
| See a place | Glance at the docked map. Tap it → Explore; tap a cluster → visits → Jump in story / Zoom to these days. |
| Open a photo | Tap a tile → lightbox; swipe; swipe down returns to the story at that photo. |
| Share | Header Share → `?album=…&at=<current row time>`; lightbox Share adds `&lb=<id>`. `navigator.share`, fallback copy. |
| Switch trip / period | ‹ Home; or prev/next trip cards at the end; ⋯ "all photos in these dates" flips album ↔ range in place. |

## Gestures and conflict rules

| Region | Vertical drag | Horizontal drag | Tap | Long-press | Pinch |
|---|---|---|---|---|---|
| Story column | page scroll (`pan-y`) | nothing | tile → lightbox; stop header → collapse/expand | tile → preview + share | none |
| Docked map | page scroll (passes through) | – | → Explore | – (v1 Play gesture removed) | – |
| Transport bar | – | – | day chip → day sheet; ⏮ ⏭ ▶ | – | – |
| Home month columns | page scroll | – | → month story | then drag → range | – |
| Explore map | pan | pan | cluster → card; pin → seek | – | zoom |
| Explore deck | swipe down → Story | strip: scrub (`touch-action: none`) | card → lightbox | – | – |
| Lightbox | down closes; up info | steps (off while zoomed) | toggle chrome | – | zoom |

- No horizontal gesture anywhere in Story or Home: OS back/forward edge swipes never compete.
- Nothing draggable at a screen edge. All targets ≥ 44 px (month columns 26 px wide × 56 px tall,
  next to each other with no gap, so a near-miss lands on a neighbour month, not on nothing).
- No double-tap outside the lightbox photo.

## Cursor and camera rules

- **Cursor = the current row's first photo time.** Discrete per row, written on rAF, with history
  `replace` at most once a second. The marker steps per row; per-photo stepping is the lightbox's job.
- **Inside a stop**: the camera holds the stop's frame (fit of the stop's GPS rows, 16 px pad),
  set once on entering the stop. Only the marker moves. Scrolling back and forth inside a stop never
  moves the camera.
- **Crossing a transit** (slow scroll): one `markScrub()` + cursor write to the next stop's first
  row → one flight, then the frame for the new stop.
- **Fling** (scroll velocity > threshold): no camera writes while flinging; on settle, one cursor
  write to wherever it landed. A seek further than `FOLLOW.seekMs` snaps; that is fine after a fling.
- **Reduced motion**: Follower already snaps when `reduced` (`follow.ts`). Play advances stop to stop
  with a scroll jump (no smooth auto-scroll); the map crossfades between stop frames.
- **Screen readers**: the story is a DOM list (h2 day, h3 stop, transit as text). Tiles get alt
  "16:57, Santa Cruz de la Serós, photo 56 of 194". A polite live region announces the stop
  (not each row) when it changes. Map canvas is `aria-hidden`; the chip is its text. Transport
  buttons are real `<button>`s with labels; the day sheet is a list.

## How existing features map over

| Desktop | Story concept |
|---|---|
| All-years strip | Home year rows (12 month columns each); long-press-drag for month ranges |
| Zoomed wave + brush | Gone. Ranges come from trips, months, month ranges, Explore "Zoom to these days", deep links |
| Album rail / picker | Trip cards on Home + search; prev/next at story ends |
| album / all photos in these dates | ⋯ toggle (`&mode=range`) |
| Time strip + scrub | Story: scroll + spine + transport. Explore: the strip itself (D) |
| Play | ▶ in the transport bar (Story and Explore) |
| Follow / Fit | Story: per-stop frame, always on. Explore: Follow / Fit buttons |
| Cluster click zoom + Back stack | Explore cluster card → Zoom to these days (`zoomInto`, unchanged) |
| Hover tooltips | Explore cluster card; long-press tile preview |
| Photo card on the map | Explore deck card; in Story the current row is the card |
| Lightbox side panel + mini-map | Info sheet with static SVG mini-map |
| Search | Album name / year (existing) + place over `city`/`country` (new, client-side) |
| URL | Unchanged contract: `album`, `mode`, `from/to`, `at`, `lb`; new optional `view=map`. Desktop and phone links round-trip |

## Reused vs new

Prerequisites shared by every concept (eng critique facts 1–8): `actions.ts` (album open, mode,
clear, `albumRequest` out of `Overview.svelte`), `MapCore` split from `MapView`, Follower insets/pad,
`pixelRatio ≤ 2` + context loss, static SVG mini-map, album-first boot, interval index refresh,
`replace`-only cursor writes on mobile.

Reused: index + IndexedDB cache, `selection.svelte.ts`, `trips.ts`, `route.ts` (`segmentRoute`,
`breakBetween`, `positionAt`, `cursorRow`, `clusterVisits`), `camera.ts` + `follow.ts`, `play.ts`,
`thumbhash.ts`, `media.ts`, lightbox `model.ts`, `format.ts`, `landing.ts`, demo credits.

New:
- `stops.ts`: stops from rows (break on >45 min or >2 km or city change; no-GPS rows join the
  nearest stop in time; merge stops < 3 photos). Pure, tested; also feeds ⏮ ⏭ and desktop later.
- `storyLayout.ts`: justified rows, chapter/stop/transit blocks, exact heights from `ratio`;
  `row ↔ y` maps (binary search) for virtualisation, deep-link scroll and the spine.
- `Story.svelte` (virtualised), `Home.svelte`, `Explore.svelte` (D's Map tab), mobile lightbox,
  `RouteSketch` (static SVG: Home cards, lightbox info, the docked map before MapLibre loads).
- `App.svelte` shell switch on `(pointer: coarse) and (max-width: 700px)`, mobile chunk lazy-loaded.

## Performance and data

- **First paint**: Home from the month manifest + `/api/albums` (names, dates, counts). A story
  link after album-first boot needs `/api/albums/:id/assets` (cached per version), not the full index.
- **Layout is computed, not measured**: exact virtualisation; a 2 000-photo trip ≈ 700 rows ≈ 90k px.
- **Images**: thumbhash for every tile instantly; `thumbnail` (~250 px) when scroll velocity is low,
  for visible rows + one screen ahead, ≤ 6 in flight; `preview` only for the hero after ~300 ms at
  rest, ≤ 3 decoded. 250 px is soft on a ~130 css px tile at DPR 3; accepted (owners can raise
  Immich's thumbnail size server-side). Reading is loading, but no more than Immich's own timeline.
- **GPU**: one MapLibre instance at ~0.3 of full-screen fill, mostly idle (camera moves only at stop
  changes). `RouteSketch` fallback means no WebGL is needed to read a trip.
- **Theme**: story chrome follows the system theme. The basemap stays the dark style in both
  themes for v1 (eng fact 10); the mockup's light map is the later target.
- **Offline**: a small SW (shell + recent thumbnails) makes "reopen the last trip" work; shared prerequisite.

## Build order

1. Shared groundwork (above) and the touch lightbox.
2. **Explore = D's Map tab**, shippable alone as the first mobile screen (open a trip from a plain
   list, map + card + strip + Play). This is also the fallback if step 3 fails.
3. Spike on a real mid-range Android and an iPhone: story scroll with the per-stop camera, Play,
   a fling across the demo trip. Measure frame time and battery.
4. Story + Home. Story becomes the default trip view; Explore stays one tap away.

If the spike fails, Story ships with `RouteSketch` as the docked map (marker + stop highlight, no
WebGL) and Explore keeps the live map. The concept survives that downgrade; Explore carries the
"watch the route draw" moment.

## Risks

- **Stop derivation quality** (layovers, 2-photo stops, a valley named after one town). Stops are now
  load-bearing twice (headers and the camera). Tune on the private library, by the owner.
- **Per-stop framing for long stops** (a 6-hour hike is one "stop" by city): the frame is wide and the
  marker crawls. Mitigation: split stops on distance as well as city (the 2 km rule).
- **Scroll-linked camera on iOS**: reduced to one flight per stop change, but still measured first.
- **Arbitrary day ranges**: month granularity on Home, day granularity only via Explore "Zoom to
  these days" or desktop links. "14 Mar to 2 Apr" can't be made on the phone.
- **No-GPS heavy trips**: no-GPS rows belong to the nearest stop; the marker holds at its last
  known position (hollow).

## Best at / worst at

Best at: reliving and showing one trip; one-handed reading with nothing to learn; sharing a moment;
low-end phones; screen readers; photos, not chrome, as most of the screen.

Worst at: cross-library spatial exploration ("where was I in 2023?"); arbitrary day ranges;
libraries with few albums (month stories read like a camera roll). Find-one-photo is now workable
(place search, month stories) but not C's full grid.

## Response to critique

Sources: `03-critiques/ux.md` (UX) and `03-critiques/eng.md` (ENG).

| # | Criticism | Verdict | What changed / why not |
|---|---|---|---|
| 1 | Play is hidden in ⋯ / long-press the map (UX, ENG) | **Accept** | ▶ is a 52 px amber button in a bottom transport bar, the same bar in Story and Explore. Long-press on the map is removed. Demo pulses ▶ once on landing. Play scrolls the story and draws the route. |
| 2 | The reading line is invisible; the ring reads as a selection bug (UX) | **Accept** | Reading line and ring removed. Current row = first row under the sticky chapter header (UX's alternative). Shown by a left-gutter timeline spine with an amber dot beside the current row, and the cursor time in the chapter header. |
| 3 | Dim tiles above the cursor (UX) | **Rebut** | Dimming what the user is reading to explain a cursor is hostile; the spine dot does the job without touching photos. |
| 4 | Map jitters when browsing back and forth (UX) | **Accept** | Camera is stop-damped: holds the stop's frame, only the marker moves; flies only across a transit. |
| 5 | Fixed 96 px transits + flings make the camera yo-yo; scroll must `markScrub()` or seeks snap (ENG) | **Accept** | Cursor is discrete per row; a transit is one seek; no camera writes during a fling, one write on settle. Slow transit crossing calls `markScrub()` so it flies. |
| 6 | Rows hide per-photo time; marker interpolates across photos it isn't showing (ENG) | **Accept** | No interpolation: cursor = row's first photo. Per-photo stepping is the lightbox's job (it already was). |
| 7 | Docked map too small for Follow with a 70 px pad; size it ≥ 300 px (ENG) vs clamp to 28svh (UX) | **Partly accept** | Own 16 px pad for this shell (ENG). Height `clamp(160px, 30svh, 280px)` (closer to UX): a map that frames one stop, not the whole trip, doesn't need 300 px, and 300 px would leave a 640 px phone ~250 px of story. |
| 8 | Day scrubber at the right edge: forward swipe, left-thumb reach, 28 px (UX, ENG) | **Accept, differently** | Scrubber removed. Coarse jumps are taps in the transport bar: day chip → day sheet, ⏮ ⏭ by stop (ENG's suggestion from B). No edge gestures left in the story. |
| 9 | Explore controls in the hard top corners (UX) | **Accept** | Explore is D's Map tab: deck at the bottom (card slot, strip, transport with "‹ Story"), Follow / Fit in the right thumb arc above it. Nothing in the top corners. |
| 10 | Steal C's place filter for clusters (UX) | **Rebut** | ENG shows it breaks the contiguous `Active` slice (lightbox, Play, stepRow, density all assume `lo..hi`). Cluster card lists visits instead, each with Jump in story / Zoom to these days. Place *search* on Home is kept: each result is a visit, so it opens as album + `at`, no model change. |
| 11 | "Just this stop" invents a sub-story; reuse `zoomInto` (ENG) | **Accept** | Renamed and rebuilt as "Zoom to these days" via `selection.zoomInto`, as on desktop. |
| 12 | Find-one-photo across the library is weak (UX) | **Partly accept** | Place search added to Home (cheap, index `city`/`country`). A full library grid is not added: it is C's job and contradicts bounded pages. Listed under "worst at". |
| 13 | No arbitrary ranges (UX, ENG); steal C's long-press drag across months (ENG) | **Partly accept** | Long-press-drag across month columns → month-range story. Day-level ranges come from Explore "Zoom to these days" and desktop links. An arbitrary day picker is still out: a date-range picker is the desktop brush in disguise. |
| 14 | Cluster zoom links (`T14:00Z`) make sub-stories nobody can create on the phone (ENG) | **Rebut** | They open as a story with derived stops, and Explore "Zoom to these days" now creates exactly those links on the phone. |
| 15 | Month bars ~26 px wide, short bars nearly 0 px tall (UX) | **Accept** | Hit area is the full 26×56 px column, columns abut with no gap. The mockup shows the column background and the long-press range. |
| 16 | Show a "days" chevron on month tap (UX) | **Rebut** | A month story is already chaptered by day, and its day chip lists the days. A second picker on Home is a duplicate. The v1 long-press day sheet is replaced by the range drag. |
| 17 | Landscape breaks (UX) | **Accept** | Side by side: map left 50%, story right. Described, not drawn (4-screen limit). |
| 18 | 360×640 leaves ~260 px of story (UX) | **Accept** | Map clamps to 192 px there; transport bar collapses while flinging; ~316 px of story. |
| 19 | Reduced motion missing (UX cross-cutting) | **Accept, mostly existing** | Follower already snaps under `reduced` (`follow.ts`). Added: Play jumps stop to stop, map crossfades between stop frames, no smooth auto-scroll. Stop damping makes motion rare to begin with. |
| 20 | Screen readers (UX cross-cutting) | **Accept** | DOM h2/h3, tile alt text, a live region per stop change, `aria-hidden` map with the chip as text, real buttons in the transport bar. |
| 21 | Type below 11 px in mockups (UX) | **Accept** | Month letters 9 → 11 px, video badge and demo badge → 11 px; scrubber labels gone. |
| 22 | Home isn't index-free: verdicts, GPS share, sketches need the index (ENG) | **Accept** | Home paints names, dates, counts and grey month bars first; GPS colours, sketches and verdicts upgrade when the index lands. Never one members call per card. |
| 23 | "A story only needs the album assets" is false today; boot waits for the full index (ENG facts 1, 6) | **Accept** | Album-first boot and `actions.ts` are listed as prerequisites, not claimed as existing. |
| 24 | Most thumbnail traffic of all concepts: reading = loading (ENG) | **Rebut** | That is the job: a story is for looking at photos. Velocity gating, ≤ 6 in flight and thumbhash during flings keep it under the demo's 120 req / 6 s; it costs what Immich's own timeline costs. |
| 25 | Light mockup implies a light map for free (ENG fact 10) | **Accept** | Doc states v1 keeps the dark basemap in both themes; the mockup notes it. |
| 26 | A is best as a second mode, not first ship (ENG ranking) | **Partly accept** | Build order now ships Explore (D's Map tab) first, which is also ENG's recommended core, then spikes the story camera on a device. Rebut the "second mode" end state: once the spike passes, Story is the default trip view, because it is the one screen a stranger understands in a second (UX ranking). |
| 27 | Stop derivation could read badly on real libraries (ENG "what would kill it") | **Accept as risk** | Unchanged mitigation (tunable thresholds, owner tunes on private data). Added the 2 km split so long hikes don't become one wide frame. |
| 28 | Steal B's stop-segmented filmstrip and D's lightbox rules (UX, ENG) | **Accept** | Lightbox filmstrip has gaps between stops; zoom disables paging; ±1 preload. |

## Changelog

- **v2 (2026-10-14)**: Play moved to a bottom transport bar (day chip, ⏮ ▶ ⏭) shared by Story and
  Explore; long-press-map Play removed. Day scrubber removed. Reading line + ring replaced by the
  current-row rule, the left-gutter timeline spine and a time in the sticky chapter header. Camera
  is stop-damped; cursor discrete per row; flings write once on settle. Docked map
  `clamp(160px, 30svh, 280px)` with a 16 px pad, framing the current stop. Explore rebuilt as D's
  Map tab (bottom deck, Follow / Fit in the thumb arc, cluster card with visits → Jump in story /
  Zoom to these days via `zoomInto`; "Just this stop" removed). Home: place search, full-column
  month targets, long-press-drag month ranges (v1 day sheet removed), progressive card upgrade.
  Lightbox: stop-segmented filmstrip, zoom disables paging. Added landscape and 360 px rules,
  reduced-motion and screen-reader rules, prerequisites, build order with a device spike and a
  `RouteSketch` fallback. Mockup updated in place.
- **v1**: initial concept.
