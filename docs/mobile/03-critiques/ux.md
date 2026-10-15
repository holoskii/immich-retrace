# UX critique: four mobile concepts

Lens: one-handed reach, discoverability, gesture conflicts, cognitive load, relive-a-trip vs
find-one-photo, accessibility, landscape / 360 px, first-time demo visitor vs owner.
Sources: `02-concepts/{a,b,c,d}-concept.md`, `mockups/concept-*.html`, rendered in
`screens/concept-*-{light,dark}.jpg`. "A2.4" = concept A, screen 2, callout 4.

## Cross-cutting gaps (all four)

None of the four concepts covers these. They apply to whichever one ships.

1. **Screen readers are not addressed anywhere.** Every time control is a canvas (B's filmstrip
   and ruler, C's scrubber, D's wave and strip, A's day scrubber). Each needs `role="slider"`
   with `aria-valuetext` ("Mon 9 Sep, 13:04, Yesa, photo 112 of 194"), arrow keys stepping by
   photo and Page Up/Down by stop/day, plus a debounced polite live region when the cursor
   moves. The map gets `aria-hidden` and a text equivalent (the time/place chip that every
   concept already has). Photo tiles need alt text built from time + place.
2. **Reduced motion is missing.** The product's core is a moving camera. Under
   `prefers-reduced-motion`: camera *jumps* (or crossfades) per stop instead of flying, there is
   no momentum fling on strips, Play uses the 2.5 s step it already has and does not auto-scroll
   pages (A), and sheets snap without spring overshoot. A scroll-linked map (A) is user-driven
   motion, which is acceptable, but the long transit flights in it are not.
3. **Landscape is hand-waved.** Only B gives numbers. Rule for all: in landscape the map takes
   the left 55-60% and the time UI becomes a right column. Never stack bands vertically when the
   viewport is 390 px tall.
4. **360 px and short phones** (360×640 Android, 375×667 SE) are untested in every mockup. The
   failures are listed per concept below.
5. **Mockup type is too small.** B, C and D use 9.5-10.5 px labels for real information: B's
   cut labels "+1 d 22 h · 98 km", ruler days; D's demo strip and axis; C's month letters. Meaning
   should not sit below 11 px, and nothing below 12 px should be grey-on-grey. In dark mode C's
   dimmed (filtered-out) scrubber bars carry state through opacity alone (C3.2), so pair the dim
   with a pattern or an outline.
6. **Touch targets under 44 px** that appear in the mockups: A's month bars on Home (A1.2,
   ~26 px wide, and short bars nearly 0 px tall, so the hit area must be the full column); A's
   28 px day scrubber; B's 34 px ruler and the ‹ › in the header pill; D's 32 px trip-rail lanes
   and ⓘ; C's trip markers overlapping each other on the library map (C1.3: San Sebastián and Sète
   labels collide).

## A. Vertical story scroll

**Strongest point.** Zero learning: the only gesture is page scroll, and the map follows it.
It has the best gesture hygiene of the four, because the docked map takes no touch (A2.1) and
Explore is a separate mode (A3), so pan and scroll never share the screen. It is also the best
at *reliving* a trip. Day chapters, stop headers and transit breaks ("3 h 03 · about 38 km",
A2.3) turn a camera roll into a narrative, and the map supplies the "where" without being asked.
Of all four it has the best screen-reader story (a plain DOM list with h2 day / h3 stop) and the
best low-end fallback (static `RouteSketch`).

**Serious problems.**
- **Play is effectively hidden**: it sits in ⋯ or behind a long-press on the map chip (A2.1).
  Long-press on a surface whose tap means "open Explore" is invisible and collides with that tap.
  First-time demo visitors will never see the route animate, which is the product's wow moment.
- **The reading line is an invisible concept.** "Photo under a line 30% down is current" is
  not something users infer. The ring on one tile among many reads as a selection bug. Users
  will scroll, see the map wobble, and not connect the two.
- **Map jitter when browsing.** Scrolling back and forth to compare two photos makes the camera
  fly back and forth. A photo grid that moves a map is great when reading and annoying when
  looking.
- **Reach in Explore is the worst of all screens**: "‹ Story" top-left and "Follow" top-right
  (A3.4, A3.5) are both in the hard corners. Swipe-down on the peek rescues closing, but nothing
  rescues Follow.
- **Day scrubber at the right edge, inset 6 px** collides with Safari's forward swipe, and a
  left thumb can't reach it. 28 px wide is below target.
- **Finding one photo across the library** works only through trip/year search and month
  stories. There is no place search in v1 and no arbitrary range (the concept admits this).
- **Landscape breaks.** A sticky 240 px map on a 390 px tall viewport leaves ~100 px of story.
- **360×640**: map 240 + header 48 + sticky day header ~50 + status bar leaves ~260 px of story.

**Fixes.**
- Make Play a visible floating button, bottom-right in the thumb zone, and drop long-press on
  the map. Play scrolls the story *and* draws the route. In the demo, pulse it once.
- Make the cursor explicit: a full-width hairline with a time chip riding on it ("16:57", which
  A2.4 half does), and dim the tiles above it slightly. Alternatively, define "current" as the
  first row under the sticky day header, which needs no new concept.
- Damp the camera by stop, not by row: while scrolling inside one stop, keep the camera framed
  on that stop. Fly only when the reading line crosses a transit break. This removes jitter and
  makes transits the only motion, which is also the reduced-motion story.
- Map height `clamp(140px, 28svh, 260px)`, frozen at load and rotation. In landscape, a
  side-by-side split (sticky map on the left, story on the right) is better than portrait.
- Explore: move "Story" and "Follow" to a bottom bar above the peek.
- Scrubber: inset ≥16 px, 44 px hit width (the visible track can stay thin), and mirror it to the
  left when the user drags from there.
- Month bars: full-column hit areas. Long-press for the day sheet is fine as a secondary path,
  but also show a "days" chevron on tap.

**Steal from others.** C's place search and place filter (Explore cluster tap → "Pamplona · 2
visits · 41 photos" instead of only "Jump in story"). D's Map-tab layout (docked card + strip +
Play) as the bottom of Explore, so Explore becomes the "watch it replay" mode. B's long-press
peek on tiles (A already has long-press preview, so keep it) and B's stop-segmented filmstrip
in the lightbox.

## B. Horizontal filmstrip

**Strongest point.** Everything you touch is in the bottom 41% (deck), and the fixed playhead
answers "what am I looking at" without ambiguity (B3.1, B3.2). It is the most faithful to
Retrace's identity: drag the film and the route draws, with cuts ("+1 d 22 h · 98 km", B2.3)
that make pace and gaps tangible. Its gesture ownership is clean (map band vs deck band, the
footer note). Landscape is the only one actually designed.

**Serious problems.**
- **Cognitive load is the highest.** In one deck there are two horizontal time controls (ruler
  and filmstrip, B1.6 and B1.1), a three-way level switch, pinch-between-levels, momentum
  detents, tap-to-centre-then-tap-to-open, long-press peek, and In/Out marks behind a long-press
  on the level switch (B1.7). The lightbox adds a third strip (B4.5). Only "drag the film" is
  learnable. The rest is an editor's vocabulary.
- **"Drag the film, not the playhead" is inverted for non-editors.** First-time visitors will try
  to drag the playhead or tap a frame to open it. Tap on an off-centre frame *centres* it
  (B3.2), so the first tap appears to do nothing useful. That is a discoverability tax on the
  single most common action.
- **Find-one-photo is the worst of the four.** There are 6 frames visible, and a 600-photo trip is
  100 screens of film with no grid anywhere. The Trip-level contact sheets (B2.2) are 3-6 tiny
  thumbs per stop at roughly 40 px each.
- **Years level is crowded.** Truncated clip labels ("Pamplona & Basq…", "Sète,") sit on 22 px
  lanes under a waveform. It is the desktop album-rail problem again, just horizontal.
- **The canvas strip is a black box for screen readers**, and the In/Out range picker is
  undiscoverable by design.
- **360 px**: the transport row (3-way segment + ⏮ ▶ ⏭) already fills 390 px in B2/B3. At
  328 px of usable width it overflows or shrinks targets below 44 px.

**Fixes.**
- Drop the ruler as a separate band. Fold the density into the filmstrip's top edge as a
  minimap.
- Drop the 3-way segment. Pinch and a single level button that cycles levels (or a "Trip ▾"
  chip) replace it. This frees the transport row for 360 px.
- Tap any frame opens it; the second-tap rule is a cure worse than the stray-tap disease. Seek by
  dragging only.
- Add a "grid" escape: swipe up on the deck expands it into a day grid (C's full snap). Without
  it, B can't find photos.
- Move In/Out marks to the Trips sheet as an explicit "Custom dates" row.

**Steal from others.** A's day chapters as labels on the strip (sticky day name at the left
edge of the film). C's grid-at-full. D's docked photo card with time + place in text (B relies
on a 15 px time label above the playhead, B3.5).

## C. Map-first with a bottom sheet

**Strongest point.** It is the most phone-native idiom (Google/Apple Maps), so the visitor
already knows the sheet. Two capabilities nobody else has: the **place filter** ("Pamplona ·
2 visits · 41 photos", C3.1), which answers "everything I shot here, across visits", and the
**library as a map of trips** with a viewport-filtered trip list (C1.3, C1.4), which is the best
owner home screen of the four. The full-snap grid (C4) is the best find-one-photo surface.
Camera padding = sheet height (C2.6) is a detail the others miss.

**Serious problems.**
- **The worst gesture conflict of the four: scrubber inside the drag-to-snap header** (C2.3).
  Primary time scrubbing shares a 44 px band with vertical sheet drag, separated only by a 10 px
  direction lock. A slightly diagonal thumb arc, which is what thumbs do, snaps the sheet to half
  mid-scrub. This is the core interaction, and it is the one most likely to misfire.
- **Mode soup.** Peek/half/full × trip/library × time selection × place filter × Follow on/off.
  The trip chip opens the library (C2 chip), *and* a swipe on the chip goes to the previous/next
  trip, *and* the chip is inside the dragged header. Three gestures sit on one 36 px pill.
- **Reliving is weak.** The narrative is a stop list at half (C3.4). Play exists, but the story
  is "Maps with photos", not a trip.
- **Web bottom sheets are fragile.** iOS rubber-banding, `dvh` changes mid-drag, nested scroll
  hand-off at `scrollTop 0`. The concept admits this and cites Immich's own crash. It costs the
  most engineering and device testing.
- **The map canvas is the primary surface**, which makes it the worst for screen readers unless
  the sheet's lists carry all meaning (they mostly can).
- **Landscape: the sheet eats the short axis.** It needs a side panel, which is effectively a
  second layout.
- **Demo visitor risk**: they pan the map (familiar), never touch the 44 px strip, and leave
  thinking it is a photo map. The pulsing Play hint fires only after picking a trip, not on
  landing.
- Scrolling the full grid "moves the cursor silently" (C4.3). The map is a 96 px lip at that
  point, so the camera work is invisible and wasteful. D's rule (scroll never moves the cursor)
  is better here.

**Fixes.**
- Make the scrubber band never drag the sheet (`touch-action: none`). The sheet drags only from
  the handle + title row, and the handle grows to a 44 px band.
- Take the gestures off the chip: the trip chip only opens the library, and prev/next trip
  become explicit ‹ › in the library or at the end of the stop list.
- Collapse to two snaps (peek and full) for v1, with half only for the place filter result. That
  fixes most of the fragility and half of the mode soup.
- On landing, pulse Play once in the demo, and give a one-line coach hint pointing at the strip,
  not the map.
- Reduced motion: no camera flights on cluster tap; fit instantly.

**Steal from others.** A's transit breaks and day chapters in the half-snap list, so the stop
list reads like a story. B's stop detents on the scrubber (a fling lands on the next stop). D's
"grid scroll never moves the cursor".

## D. Faithful port (tabs)

**Strongest point.** Predictable and cheap. Tabs are the most discoverable navigation on a
phone, each tab owns its gestures (the conflict table really is clean), and the URL contract is
untouched. The **Map tab on its own is the best single screen across all four mockups**
(D2): map up top, Follow/Fit/ⓘ in the right-hand thumb arc (D2.3), a docked card with time +
place + "Open photo", and a strip with a 44 px Play, all in the thumb zone. The Photos tab gives
no-GPS photos first-class status (D3.5) and doesn't move the cursor on scroll (D3.2), which is
the right rule for find-one-photo. It is the most accessible base, because standard tabs and a
DOM grid stay usable even if the canvases aren't.

**Serious problems.**
- **Split attention kills the product idea.** Overview and Map never share a screen, so brushing
  the wave and watching the map react, the thing Retrace is, becomes "pick, then switch tab". The
  concept says so itself.
- **The Overview tab is still a desktop control.** Long-press-drag brush (D1.3) is undiscoverable,
  the wave in 328 px is ~5 px/day, and the trip rail truncates *in the mockup itself*
  ("San Sebastián to H…", D1.5). That is the exact bug it claims to fix.
- **Chrome budget.** 47 status + 28 demo strip + 52 context header + 83 tab bar is about 210 px
  (25%) before any content, which repeats the current app's "chrome eats the screen" failure in
  a milder form. In landscape (390 tall) it leaves ~180 px for content.
- **Overlap.** Overview and Albums both answer "pick a period". Four tabs is one too many for a
  read-only viewer.
- **The context header truncates the trip name** on Map and Photos (D2.6, D3), because the cursor
  chip and ✕ steal width. The name is the most important identity text.
- **Two horizontal gestures stacked in the Map tab**: swiping the card steps one photo (D2.4),
  and dragging the strip below it scrubs. Same direction, different gain, 8 px apart.
- **Reliving is mediocre**: no stop unit, no narrative, and the grid is a camera roll with day
  headers.

**Fixes.**
- Merge Overview into Albums: Albums with "Trips | Years" where Years = A's/C's vertical year rows
  (one row per year, 12 month cells). Keep the wave only for hardware-keyboard/tablet widths.
  That leaves 3 tabs (Map, Photos, Trips).
- Hide the tab bar and header in landscape and on scroll in Photos.
- Two-line context header: name on line 1, dates · count · cursor on line 2, ✕ moved into a ⋯
  menu.
- Make the card a tap target only (no swipe) and put ‹ › step buttons beside Play.

**Steal from others.** A's stop/day chapters for Photos-tab headers (D3.1 nearly does this
already: "Mon 9 Sept · Leyre, Yesa, Javier · 41"). C's place filter on cluster tap instead of
"Zoom to these days" as the only option.

## Comparative matrix

| | A story | B filmstrip | C map sheet | D tabs |
|---|---|---|---|---|
| One-handed reach | good, but Explore corners bad | **best** | good | good on Map, header/✕ top |
| Discoverability | **best** (it's a scroll); Play hidden | worst (editor idioms) | good (Maps idiom) | good (tabs); brush hidden |
| Gesture conflicts | **none by construction** | clean bands | **worst** (scrub in sheet header) | clean per tab; card vs strip |
| Cognitive load | **lowest** | highest | high (modes + filters) | medium, split attention |
| Relive a trip | **best** | very good (replay) | weak | weak |
| Find one photo | ok in a trip, weak across library | worst | **best** (grid + place) | good (Photos tab) |
| Screen reader | **best** (DOM story) | worst (canvas) | medium | good |
| Reduced motion | needs stop-damped camera | heavy motion by design | medium | medium |
| Landscape | breaks; easy split fix | **designed** | breaks; needs side panel | chrome eats it |
| 360 px | ok | transport overflows | ok | header truncates |
| Demo first visit | instant payoff, no animation unless Play is visible | strong if coach mark + Play | risk: "just a photo map" | ok, busy |
| Owner | weak library home | Years level crowded | **best** library (map of trips, place search) | parity, power tools |
| Build risk | scroll-linked WebGL perf (spike first) | custom canvas physics | web sheet (highest) | **lowest** |

## Ranking

1. **A, Vertical story.** It is the only concept a stranger understands in one second, it is the
   best at the job a phone is used for (showing and reliving a trip, one-handed, often to
   someone else), and its structural rule (passive map, Explore as a mode) removes the hardest
   problem on the web instead of engineering around it. Its flaws (hidden Play, invisible
   reading line, jittery camera, weak library search) are all fixable without changing the
   concept.
2. **C, Map-first sheet.** It is the best for owners and for find-one-photo, and the place filter
   is the most original idea in the study. It ranks below A because its core interaction (scrub
   in a draggable header) is its most fragile one, and it is the costliest to make reliable on iOS
   Safari.
3. **B, Filmstrip.** It has the best ergonomics and the purest Retrace replay, but the most to
   learn and no way to see many photos at once. It works as a mode, not as an app.
4. **D, Tabs.** It is the safest and the most accessible base, and its Map tab is excellent, but
   as a whole it is a reflowed desktop that separates time from place, which is the one thing
   Retrace exists to join.

## If I had to ship one

**Ship A, with D's Map tab as its Explore mode and C's place filter.**

- **Home** = A1 (years with month rows + trip cards) plus place search from the index's
  `city`/`country` (from C1.1). Month bars get full-column hit areas.
- **Story** = A2 with the fixes above: a visible bottom-right Play button, an explicit cursor
  hairline + time chip, a camera that flies only on transit breaks, a map height clamp, and a
  side-by-side layout in landscape.
- **Explore** (tap the docked map) = D2 nearly verbatim: map, Follow/Fit in the right thumb arc,
  docked card, time strip + Play, all bottom-anchored, with "Story" as a bottom pill. Cluster tap
  → C3's place-filter card ("Pamplona · 2 visits · 41 photos" → Jump in story / Just this stop).
  This is where B's replay lives, without B's vocabulary.
- **Lightbox** = shared by all four, take D4's rules (zoom disables paging, ±1 preload, info
  sheet with static SVG route) + A4's day-segmented progress bar + B4's stop-segmented mini
  filmstrip.
- **No** brush, In/Out marks, wave or level switch on the phone. Arbitrary ranges come from deep
  links and A's day sheet.

**Build order** (risk first): (1) the touch lightbox, which is the most broken thing today and is
needed by every concept; (2) Explore = D's Map tab, which fixes the current phone layout with the
least new code and is shippable alone; (3) a spike measuring scroll-linked Follow on a real
iPhone and a mid-range Android, with `RouteSketch` as the fallback; (4) Story + Home. Every step
ships something usable, and if step 3 fails, A falls back to a static route sketch with
stop-level jumps. A is still good in that form, and the others would not survive a similar
downgrade.
