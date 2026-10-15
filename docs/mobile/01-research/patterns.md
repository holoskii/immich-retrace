# Mobile patterns for photos + time + place

Per pattern: what it is, why it works, what Retrace could steal, pitfalls. Baseline: one time cursor
drives map and lightbox; today at 390 px the page renders 543 px wide, the lightbox photo gets ~55 px,
info is hover-only, brush grips are too small (roadmap).

## 1. Google Photos

**Pattern.** One infinite grid, newest first. A fast-scroll thumb on the right edge appears when
you scroll and shows year/month labels while you drag it. Pinch switches grid density (day / month
/ year-ish). A Memories carousel ("1 year ago", trip highlights) sits above the grid as
story-style full-screen pages with auto-advance. The map (in Search/Places) is a heat map with a
photo grid in a bottom sheet that tracks the visible map bounds.

**Why it works.** Time is just scroll position: nothing to learn. The thumb jumps fast while labels
say where you are. Memories need no input.

**Steal.**
- Right-edge time scrubber with a floating date label as the phone stand-in for the overview
  strip's "pick a period". It is thumb-reachable for right-handed users.
- Map + bottom-sheet grid where the grid filters to the map viewport (inverse of Retrace, where
  time drives the map; worth having both directions).
- Auto-generated "trip" cards to open stories, from Retrace's existing album/trip detection.

**Pitfalls.** A linear scrubber does not scale (20 years ≈ 3 px/month, per Immich users). The heat
map shows where, never in which order.

## 2. Apple Photos (Years/Months/Days, Memories, Places)

**Pattern.** Years > Months > Days was a segmented control of zoom levels: each Year tile
shows one key photo, tap drills to Months, then Days. iOS 18 merged it into one long scroll (grid
on top, "collections" such as Trips, Memories, Places below). iOS 26 brought tabs back (Library
vs Collections) after the single scroll proved confusing. Memories are auto-edited movies with
music, Ken Burns, title cards. Places is a map with photo-thumbnail clusters; tapping a cluster
opens a grid. The viewer has a filmstrip of tiny thumbnails under the photo for scrubbing.

**Why it works.** Discrete levels give stable landmarks; thumbnail clusters self-describe; the
filmstrip shows position without leaving the photo.

**Steal.**
- Discrete time levels: All years → Year → Trip/Month → Day. Each is a tap target, not a pinch
  the user has to find. Replaces the brush entirely; a brush is the worst-fitting control on touch.
- Photo-thumbnail cluster pins (Retrace has pins + counts; thumbnails read better at phone size).
- Lightbox filmstrip bound to the time cursor (Immich PR #31641 does exactly this).

**Pitfalls.** The iOS 18 single scroll is the cautionary tale: stacking unrelated modes in one
vertical scroll makes the user lose track of what scrolling does. Memories' auto-play with music
is heavy and annoys people who want to look, not watch.

## 3. Immich mobile app

**Pattern.** Flutter app. Timeline grid with a date scrubber on the right; Map view with a heat/
cluster layer and, since 2026, a map timeline in a bottom sheet with bulk actions (PR #27515).
Memories carousel on top of the timeline. Web map opens a side panel mini-timeline per cluster
(v2.6.0).

**Why it matters.** Users have it. Retrace is read-only: skip library management, do what
Immich's map cannot (order, route, trip as story). **Steal:** "Open in Immich" links instead of actions.

**Pitfalls.** Users report the scrubber failing on large libraries and a map timeline layout
crash (PR #28878): a bottom sheet hosting a scrollable grid is a known source of nested-scroll bugs.

## 4. Polarsteps (trip timeline + map)

**Pattern.** Map-first. Home is a world map with trip pins and a draggable bottom sheet with
three snap points (collapsed / peek / full); tapping the map collapses it. Inside a trip the map
shows the route linking "steps", with a horizontal timeline of step cards at the bottom; swiping
the cards moves the map to that step, tapping opens the step. Separate auto-generated "trip reel"
video for sharing.

**Why it works.** A step (place + date + photos) is the right travel unit. Cards keep the map
visible; a discrete swipe lets the camera fly instead of chasing a finger.

**Steal.** Almost the whole trip screen. Retrace's equivalent of a step is a stop: a cluster of
photos in space and time (the camera target path already computes weighted centres). Horizontal
card rail = discrete cursor; the map flies between stops; tap a card = day/stop grid; tap a photo
= lightbox.

**Pitfalls.** Steps are user-curated in Polarsteps; Retrace must derive them, and bad clustering
(airport layovers, a 2-photo stop) shows. Cards hide the per-photo time detail the desktop
scrubber has. Horizontal card swipe competes with map pan if the rail overlaps the map
(keep it in its own band).

## 5. Strava / Komoot (route replay)

**Pattern.** Activity page: a static route map at the top, stats, then photos placed along the
route. Strava "Flyover" and Komoot's 3D tour replay animate a camera along the route with photos
popping up at their positions. Elevation chart below the map with a draggable cursor that moves a
dot on the map (scrub one, see the other).

**Why it works.** A linked 1D chart ↔ map cursor ties time to place without fighting map gestures.

**Steal.**
- The elevation-chart scrubber is Retrace's density strip: a full-width strip under the map,
  drag horizontally to move the cursor, map follows. Already exists on desktop (TimeStrip); it
  maps to touch almost 1:1 if made 48 px tall.
- Play/replay = Retrace's Play, made a primary button on mobile.

**Pitfalls.** 3D flyovers are expensive on phones. Replay must pause on tap and open the photo.

## 6. Instagram / TikTok stories (vertical and horizontal paging)

**Pattern.** Full-screen pages. Stories: tap right/left half to step, hold to pause, swipe down to
close, swipe sideways to next story (next trip). Progress bars on top show position. TikTok/Reels:
vertical swipe, one item per screen, snap paging.

**Why it works.** Zero chrome, universally learned gestures, visible length, no half-states.

**Steal.**
- Lightbox as a story: tap halves step in time order, hold to see info, swipe down to return to
  the map at that cursor. Progress bar segmented by day.
- "Trip story" mode: each page = one stop with a small map header showing the route so far.

**Pitfalls.** Paging one photo at a time through a 600-photo trip is tedious; needs stop-level
paging plus within-stop stepping (stories do this: user = trip, segment = photo). Tap zones
conflict with pinch-zoom on the photo. Auto-advance is wrong as a default for a personal archive.

## 7. Scrollytelling map stories (NYT, Mapbox storytelling template)

**Pattern.** A sticky full-screen map behind a column of text cards. Scrolling the page moves the
cards; when a card crosses a threshold (IntersectionObserver / scrollama), the map flies to that
chapter's view and highlights layers. Map interaction is disabled; scroll is the only input.
On mobile cards are full-width over the map with a translucent background.

**Why it works.** Scroll is effortless and reversible; a passive map removes the gesture conflict.

**Steal.** The strongest candidate for a "vertical story" concept: page scroll = time cursor.
Each stop is a block (date, place name, 3-6 thumbnails); the sticky top half is the map, which
follows the cursor exactly like Follow mode. Retrace's continuous camera spring already handles
"fly as the cursor moves"; it could be driven by scroll progress instead of the scrubber.

**Pitfalls.**
- Map must be non-interactive (or interactive only after an explicit "explore map" tap), else
  vertical scroll gets captured by the map.
- Scroll-linked map updates on every frame are costly; drive the cursor from scroll but let the
  spring smooth it (already the design), and throttle `jumpTo` to rAF.
- iOS dynamic toolbar changes viewport height mid-scroll; use `svh`/`dvh` carefully for the sticky
  map or it jumps.
- Long trips = long pages; add a jump control (day index).

## 8. Bottom-sheet map apps (Google Maps, Apple Maps)

**Pattern.** Map fills the screen; content lives in a sheet with 2-3 snap points (peek ~15%,
half ~50%, full ~90%). Dragging the sheet is distinct from scrolling inside it: the sheet expands
first, then its content scrolls; at the top of content, a downward drag collapses the sheet.
Map controls float above the sheet and move with it. Apple Maps puts search at the bottom.

**Why it works.** Map and list co-exist at every snap; the user picks the split.

**Steal.** The map-first concept: map full screen, sheet at peek shows the trip title + the time
strip; half shows the stop rail or day grid; full shows the photo grid. The time strip should live
on the sheet's top edge so it is visible at every snap point.

**Pitfalls.** Nested scroll (sheet drag vs inner list scroll vs map pan) is hard to get right on
the web: no native sheet, `overscroll-behavior` and `touch-action` gaps on iOS, rubber-banding of
the whole page. Use a proven implementation (e.g. a vaul-style sheet) or a fixed two-state layout.
Floating map controls must avoid the sheet and the home indicator.

## 9. Filmstrip scrubbers (video editors: iMovie, CapCut, Premiere Rush)

**Pattern.** A horizontal strip of frames with a fixed centre playhead; you drag the strip, not
the playhead. Pinch on the strip changes time scale. Momentum scroll with snapping to clips.

**Why it works.** The finger never covers the value being read; precision comes from zooming the
strip; momentum gives coarse and fine movement in one gesture.

**Steal.** The mobile time strip as a fixed-centre filmstrip: density bars (or thumbnails at
higher zoom) scroll under a centre line; the cursor is whatever is under the line. This replaces
both the brush and the scrubber thumb. Pinch on the strip = zoom levels (year/trip/day). Snap to
photos when slow.

**Pitfalls.** Thumbnail strips cost requests: density bars/thumbhashes, real thumbs only near the
playhead. Pinch on a thin strip is fiddly; add level buttons.

## 10. One-handed reach and thumb zones

**Pattern.** On 6.1-6.7" phones the easy zone is the bottom third and the centre; the top corners
need a grip change. Modern apps moved primary controls down: bottom tab bars, bottom search
(Safari, Apple Maps), sheets rising from the bottom. Apple HIG minimum target 44 pt; Material 48 dp.

**Steal.** Put the time control (strip/scrubber), Play, and step buttons in the bottom 30%.
Top area holds read-only info (trip title, date readout, place name). Follow/Fit bottom-right above
the sheet. Targets ≥ 44 px (brush grips fail).

**Pitfalls.** Safari's bottom bar + home indicator eat 80-100 px: use `env(safe-area-inset-bottom)`;
keep gestures off the bottom edge (home swipe) and left edge (back swipe).

## 11. Gesture conflicts with maps

**Pattern / problem.** A map captures one-finger drag for pan. Inside a scrolling page that traps
the scroll. Known fixes: Google Maps embed "use two fingers to move the map" (cooperative
gestures; MapLibre has `cooperativeGestures`); a static map image that becomes interactive on tap;
sticky map with interaction disabled (scrollytelling); map gets its own full-screen mode.

**Rules for Retrace.**
- Never put an interactive map inside a vertically scrolling page. Either the map is the page
  (map-first) or it is passive (story), with a tap to go full screen.
- Time strip gestures are horizontal; keep them off the map area so horizontal pan never
  ambiguates.
- Edge swipes belong to the OS: keep horizontal drags ≥ 20 px from screen edges.
- Use `touch-action: pan-y` on story lists, `none` only on the strip and map canvas.
- Manual map pan pauses Follow (current desktop rule); on touch, show a clear "Follow" pill to
  resume, since there is no hover hint.

## 12. Mobile performance limits

**WebGL maps.** iOS Safari caps total canvas memory (WebKit errors at 224-384 MB) and kills tabs
around ~1 GB. MapLibre on iOS has open reports of crashes after reloads (#7667), memory growth on
pan/zoom (#174), leaks on `map.remove()` (#4811), and workers killed in background leaving blank
tiles (#8461).
- One map instance for the whole app life; never create a second (lightbox mini-map should be a
  static SVG/canvas, not another MapLibre).
- Lower `maxTileCacheSize`, small sprites, `pixelRatio` ≤ 2; handle `webglcontextlost` and
  `visibilitychange` (reload tiles after background).
- A 60 fps follow camera via per-frame `jumpTo` is fine on modern phones but drains battery;
  stop the rAF loop when the spring settles and when the page is hidden.

**Images.** Decoded image memory = width × height × 4. A 4000×3000 photo is 48 MB decoded; ten of
those kill an iOS tab. Use Immich preview size (~1440 px) in the lightbox, thumbnails (~250 px) in
grids, never originals; keep ≤ 3 full previews alive (current, ±1); virtualise grids; use
`decoding="async"` and `loading="lazy"`. Thumbhash placeholders (already in Retrace) are the right
first paint.

**Network.** Cellular latency 50-300 ms per request and the demo's rate limit (~120 req / 6 s)
mean a thumbnail grid of 60 tiles plus map tiles can trip limits. Batch: one timeline index
request, then thumbnails only for visible items; prefetch next stop's thumbnails while dwelling.
Tiles: vector tiles are small, but first load of a style with fonts/sprites is ~1-2 MB.

## Cross-cutting takeaways

1. **Discrete beats continuous on touch.** Brush and fine scrubbing are desktop strengths. On a
   phone, choose units the thumb can hit: year, trip, stop, day, photo. Keep one continuous control
   (the filmstrip/strip) for people who want it.
2. **One gesture owner per screen region.** Map pan, page scroll, strip drag and sheet drag must
   each own a region or a mode; the scrollytelling and bottom-sheet patterns are two coherent
   answers.
3. **The stop is the missing unit.** Polarsteps steps, Apple Days, story segments: all group
   photos into a place-time unit. Retrace should derive stops from its camera target path and use
   them for paging, cards and story blocks.
4. **Three candidate shapes** for the concept phase:
   - Vertical story (scrollytelling): sticky passive map on top, stop blocks scroll below;
     scroll = cursor.
   - Map-first sheet (Google Maps / Polarsteps): full map, bottom sheet with time strip on its lip,
     stop rail at half, grid at full.
   - Filmstrip (video editor / Strava): map on top, fixed-playhead time strip at the bottom,
     Play as primary; closest to the desktop app.
   The lightbox is a story-style pager with a filmstrip in all three.
5. **Budget:** one MapLibre instance, ≤ 3 decoded previews, thumbhash first, virtualised grids.

## Sources

Polarsteps: [Pratt IxD critique 2026](https://ixd.prattsi.org/2026/09/design-critique-polarsteps-ios-app/),
[steps help](https://polarsteps.helpscoutdocs.com/article/71-what-are-steps-and-how-do-i-add-or-edit-them).
Immich: [#12022](https://github.com/immich-app/immich/discussions/12022), [#27515](https://github.com/immich-app/immich/pull/27515),
[#28878](https://github.com/immich-app/immich/pull/28878), [#31641](https://github.com/immich-app/immich/pull/31641),
[v2.6.0](https://immich.app/blog/v2.6.0-release). MapLibre: [#7667](https://github.com/maplibre/maplibre-gl-js/issues/7667),
[#8461](https://github.com/maplibre/maplibre-gl-js/issues/8461), [#174](https://github.com/maplibre/maplibre-gl-js/issues/174),
[#4811](https://github.com/maplibre/maplibre-gl-js/issues/4811); Mapbox [#4052](https://github.com/mapbox/mapbox-gl-js/issues/4052);
WebKit [195325](https://bugs.webkit.org/show_bug.cgi?id=195325). Apple/Google Photos, Strava/Komoot, stories,
scrollytelling, HIG targets: product knowledge, not re-verified here.
