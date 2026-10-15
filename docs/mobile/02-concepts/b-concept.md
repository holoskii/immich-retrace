# Concept B: Horizontal filmstrip ("the editor"), v2

Mockup: [../mockups/concept-b.html](../mockups/concept-b.html) (root class `.mk-concept-b`).
Screens: `../screens/concept-b-{light,dark}.jpg`. v1 is described in the changelog; the response to
the UX and engineering critiques is at the end.

## Core idea

One main screen: the map on top follows whatever sits under a fixed centre playhead, and a deck in
the thumb zone holds a docked photo card and a horizontal filmstrip. You drag the film, not the
playhead. The film has **two levels, Stops and Photos**. Everything that is not "move through this
selection" goes to a pushed screen. **Library** picks a trip, a month, a month range or custom
dates. **Grid** finds one photo. The lightbox views it. Same cursor, Play, Follow and URL as
desktop.

## Screen anatomy (portrait, 390×844)

| Band | Height | Gestures | Content |
|---|---|---|---|
| Header pill (floats over map) | 56 | taps | ≡ Library · trip name (own line, never truncated) · `6–10 Sep 2024 · 194 · 4 stops` · Share |
| Map | to y 540 (deck overlaps its edge) | MapLibre pan/pinch, pin/cluster tap | route by time, numbered stop pins, marker; Follow/Fit pill (44 px) bottom-right |
| Docked card | 64 | tap = lightbox | 56 px thumb, `15:12 Mon 9 Sep`, place, `Stop 3 / 4 · 98 / 194`, Open |
| Film | 132 | horizontal drag, fling, pinch, tap | 12 px density band (display only), sticky day label, time label on the playhead, 72×92 frames or stop clips, cuts |
| Transport | 56 | taps | `Stops · Photos` toggle, ⏮ ▶ ⏭ (stops), Grid |
| Safe area | 34 | OS | |

Deck = 326 px (39%). Visible map between pill and deck ≈ 410 px. At 360 px width the transport
needs 314 px of the 336 available, with no target under 44 px.

**Landscape:** map on the left 58%, deck as a right column (card, film, transport stacked, ≈260
px tall). Library and Grid stay full-screen.

**Short phones (375×667, 360×640):** the docked card shrinks to a one-line 44 px row (thumb, time,
place), so the deck is ≈300 px and the map ≈260 px. The map ratio below that is a known
limitation. Play collapses the deck to film + transport anyway.

## Levels (two)

- **Stops** (default after opening a selection without `at`): one clip per stop, width ∝ √photos,
  a 3-6 thumb contact sheet, name, count. **Cuts** between clips show `+1 d 22 h · 98 km`. Map:
  Fit to the whole route, the centred stop's pin and route section highlighted. Tap any clip →
  Photos at its first photo.
- **Photos** (default with `at`, and for the demo landing): one frame per photo, cuts between
  stops, video duration badge, a grey corner for no-GPS. Map: Follow camera, the desktop behaviour.

The toggle and a pinch on the film switch levels around the playhead. The photo under it stays
under it.

## Screens and flows

1. **Open.** Demo → Photos level on the desktop landing photo, Follow on, not playing. The film
   nudges one frame and back once. A coach bubble ("← Drag the film → · Tap a photo to open it")
   stays until the first drag. ▶ pulses once. `?album=`/`?from=` without `at` → Stops level, ▶
   pulses. No query → Library.
2. **Library** (pushed, opened from the header pill): search (album name, year, place from the
   index's `city`/`country`), trip cards from `trips.ts` (name, dates, count, stops, verdict as
   text, scrolled to the current trip), **month cells** (6 × 2 per year, 44 px; tap = month, hold +
   drag = month range; older years collapse to a row), **Custom dates** (two native date inputs →
   `?from=&to=`), and "All photos" (clears the selection). Cards render from `/api/albums` and
   fill in verdict and stops when the index lands.
3. **Move through time.** Drag the film. A slow drag is a live scrub that snaps per photo, and
   the camera follows. A fast fling glides the film, but the cursor is written only when it settles
   on a detent (the next cut), so the camera does one flight, not a hundred. ⏮ ⏭ jump to stop
   starts. ▶ is desktop Play. While playing, the deck collapses to film + transport (map ≈70%),
   and any touch on the film stops it.
4. **See a place.** Tap a stop pin or single pin → the film animates there (seek). Tap a cluster →
   a fixed-height (not draggable) visits sheet: visit rows with thumbhash, each "Zoom to these days"
   via the existing `zoomInto` (Back returns). Pan/pinch the map → Follow pauses, and the pill
   reads "Follow" until tapped.
5. **Open a photo.** Tap the card, Open, or **any frame** → lightbox at that photo (the cursor
   moves to it first). Dragging is the only way to seek, so a tap always opens.
6. **Grid** (pushed: Grid button or swipe up on the deck): sticky day chapters (`Mon 9 Sep · day 4
   of 5 · Yesa → Santa Cruz de la Serós · 88`), stop sub-headers numbered like the clips, cuts,
   4 columns, a fast-scroll rail 16 px from the edge with 44 px hit width, and a "Map · 15:12 ·
   Santa Cruz" pill to go back. **Scrolling never moves the cursor.** A tile tap sets the cursor and
   opens the lightbox. Closing it returns to the map at that photo.
7. **Lightbox.** Full-bleed photo, a day-segmented progress bar on top (from A), a mini film at the
   bottom with the same rules (drag = seek, tap = show). Swipe ←/→ steps, swipe down closes to the
   map at that photo, swipe up opens info (time, UTC offset, place, coords, static SVG route,
   credits). Pinch zooms, and while zoomed a swipe pans. No chevrons. ≤ 3 decoded previews.
8. **Share.** Header and lightbox: Web Share with the current URL, with a clipboard + toast
   fallback. The URL contract is unchanged.

## Gestures and conflict rules

- **One owner per band.** Map band = MapLibre (pan, pinch, no rotate). Deck = the film
  (`touch-action: none`). They never overlap.
- **Deck verticals:** up = Grid, down = collapse. The direction locks after 10 px. Nothing else is
  vertical on the deck.
- **Taps:** frame/clip/card = open (clip = go to Photos). No double-tap and no long-press anywhere
  except the Library's month-range drag.
- **Edges:** drags starting within 20 px of either screen edge go to the OS back/forward swipe.
- **History:** a scrub, fling, ⏮ ⏭ or Play writes `at` with `replaceState` only. Selection
  changes, Library/Grid and lightbox open push.
- **Reduced motion:** no glide (a fling pages to the next detent instantly), the camera jumps per
  stop instead of flying, Play uses the 2.5 s step, and nothing has spring overshoot.

## Mapping the desktop features

| Desktop | v2 |
|---|---|
| All-years strip + wave | Library month cells; 12 px density band on the film (display only) |
| Brush | month cells (tap / hold-drag) + Custom dates |
| Album rail + picker | Library trip cards + search, verdict as visible text |
| Album / range mode | row action in Library ("all photos in these dates") |
| Time strip + Play | film (Photos) + transport |
| Cluster zoom + Back | cluster → visits sheet → `zoomInto`; Back |
| Pin hover tooltip | gone; a pin tap seeks and the card shows the photo |
| Photo card beside marker | docked card |
| Legend, inset | counts in the card/header; inset dropped (Stops level is the whole route) |
| Lightbox panel + mini-map | info sheet, static SVG route |
| Keyboard, `?` | only with a hardware keyboard |
| URL | unchanged; the level is derived (`at` present → Photos), never stored |

## Reused vs new

Reused: index + IndexedDB cache, `selection.svelte.ts`, `trips.ts`, `route.ts`, camera worker +
`follow.ts` + `scrub.ts`, `play.ts`, `landing.ts`, `thumbhash.ts`, `media.ts`, `format.ts`,
`data.ts`, MapLibre layers (bigger hit radius), lightbox `model.ts`.

Groundwork (shared with any concept, from the eng critique): `actions.ts` (pickAlbum, setMode,
clear, `albumRequest` out of Overview), `MapCore` split from `MapView`, `Follower.insets`
(top = pill, bottom = deck), `pixelRatio` ≤ 2 + context-loss handling, static-SVG mini-map,
replace-only `at` writes, album-first boot.

New: `Filmstrip` (DOM frames in one `translate3d` container, virtualised; momentum + detents;
pinch between 2 levels), `stops.ts`, mobile shell (pill, card, deck collapse), Library screen,
Grid screen (virtualised, day/stop headers), visits sheet (fixed height), touch lightbox, share.
Desktop is untouched. The shell is selected by `(pointer: coarse) and (max-width: 700px)` and
lazy-loaded.

## Data and performance

- **Stops:** split where the gap is > 3 h or > 15 km from the running centre. Merge stops with
  < 4 photos into a neighbour. No-GPS rows join by time. O(n), cached per selection, unit-tested.
- **Film:** DOM, not canvas. The frames sit in one composited layer moved by a transform, so there
  is no per-frame paint on the main thread, and it is a real element tree for a11y. Only ~6 frames
  are visible plus 12 on each side. Thumbhash while moving. `thumbnail` (250 px) at velocity
  < 300 px/s, max 4 in flight, aborted on fling. Frames stay ≤ 80 css px wide, so 250 px is enough
  at DPR 3. Frames never use `preview`.
- **Card:** thumbhash → `thumbnail` while moving → `preview` after 300 ms at rest.
- **Map:** one instance, `pixelRatio` ≤ 2, Follow updates live only on slow drags and on settle
  during flings. Camera speed is capped. The map pauses under Library, Grid and lightbox (it is
  hidden, not destroyed).
- **Grid:** thumbnails for visible rows only (4 × 87 px tiles fit `thumbnail`).
- **Budget check** before committing: on a mid-range Android, Play 60 s + a fling-scrub across
  the demo trip, recording frame time and battery delta.

## Accessibility

The film is `role="slider"` with `aria-valuetext` "Mon 9 Sep, 15:12, Santa Cruz de la Serós, photo
98 of 194". Arrows step a photo, Page Up/Down a stop, and a polite live region is debounced. The
map is `aria-hidden`, and the docked card is its text equivalent. Grid is a DOM list (`h2` day,
`h3` stop, alt text from time + place) and is the full screen-reader path through a trip. Labels
are ≥ 11 px and targets ≥ 44 px.

## Risks

- **Fixed playhead for non-editors.** Mitigated by the nudge + coach and by tap = open. If tests
  still show people dragging the playhead, a drag that starts on the playhead label moves it
  with the finger (an inverted mapping inside a 44 px zone) until release.
- **Long trips at Photos level** (600 photos ≈ 100 screens). Mitigated by Stops as the default,
  detents, Play and Grid.
- **Deck takes 39%.** Collapse on Play and swipe-down to collapse.
- **Fling + Follow:** handled by settle-only cursor writes during fast flings.
- **Short phones:** the map is ~260 px (see anatomy).
- **iOS Safari toolbar:** `100dvh` + safe-area. A PWA needs the service worker (eng fact 9), which
  is not counted here.

## Best at / worst at

Best: replaying a trip with its pace (cuts, Play), one-handed, unambiguous "now", the closest to
desktop's model (most logic reused, same URL).
Worst: map-first "where have I been" across years (Library is a list, not a map of trips), and
seeing many photos *while* watching the map (Grid hides it).

## Response to critique

UX = `03-critiques/ux.md`, Eng = `03-critiques/eng.md`.

| # | Criticism | Verdict | What changed / why not |
|---|---|---|---|
| 1 | Two horizontal time controls (ruler + film) (UX, Eng) | **Accept** | Ruler removed. Density is a 12 px band on the film's top edge, display only (not a 34 px sub-44 target). |
| 2 | Three-way level segment, overflows at 360 px (UX) | **Accept** | Two levels. One 44 px toggle + pinch. The transport fits 314 / 336 px at 360 width. |
| 3 | Years level crowded, doesn't scale to 150 albums (UX, Eng) | **Accept** | Years level removed. Library screen with trip cards, search and C's month cells. 20 years scroll vertically. |
| 4 | In/Out marks undiscoverable (UX, Eng) | **Accept** | Killed. Month tap / hold-drag range + a "Custom dates" row with native date inputs. |
| 5 | Tap-to-centre-then-tap-to-open is a tax (UX) | **Accept** | Tap any frame opens. Seek is by drag, ⏮ ⏭, or a pin tap only. Clip tap = go to Photos. |
| 6 | Find-one-photo worst, no grid (UX, Eng) | **Accept** | Grid screen (swipe up / Grid button) with day chapters and stop headers. It is a pushed screen, not a sheet snap (Eng's sheet-fragility point). Scrolling doesn't move the cursor (D's rule). |
| 7 | "Drag the film, not the playhead" inverted for non-editors (UX, Eng's killer) | **Partly rebut** | The fixed playhead stays: it *is* `cursor` + `markScrub`, and fixed-playhead scrubbers are the phone norm now (iOS Photos video trim, CapCut, Reels editors), not just a desktop-editor idiom. Added: the landing nudge, a coach bubble until the first drag, tap = open (so "tap a frame" works too), and a fallback (drag on the playhead label moves it) if tests fail. |
| 8 | Cognitive load highest (UX) | **Accept** | Vocabulary cut to: drag film, tap to open, ⏮ ▶ ⏭, toggle, Grid. Peek and long-press are gone; the lightbox is one tap away. |
| 9 | Centred 72 px frame too small to be the card (Eng, UX via D) | **Accept** | D's docked card above the film: time, day, place, stop and position in text, Open. The marker's time label on the map is dropped. |
| 10 | Day context missing (UX steal from A) | **Accept** | Sticky day label at the film's left edge. Day chapters in Grid. |
| 11 | Canvas strip is a black box for screen readers (UX) | **Accept** | The film is DOM (also an eng win: one composited transform instead of a per-frame canvas redraw), `role="slider"` + valuetext + keys. Grid is the full text path. |
| 12 | Type < 11 px, targets < 44 px (UX) | **Accept** | All labels ≥ 11 px (cuts 11.5, density axis gone). Header ‹ › removed (prev/next trip lives in Library). Map pill, card button and transport are all 44 px. |
| 13 | Reduced motion (UX) | **Accept** | No glide, camera jumps per stop, Play 2.5 s step. |
| 14 | Landscape / 360 px / short phones (UX) | **Accept** | Landscape right-column deck. 360 px transport measured. Short phones get a compact card. The ~260 px map on 667-tall phones is stated as a limitation. |
| 15 | Filmstrip component is M–L by itself (Eng) | **Accept** | Two levels, no peek, no ruler, no In/Out, DOM instead of canvas. Estimate M for the film, M overall with the shared groundwork. |
| 16 | Heaviest steady-state load: map + strip per frame (Eng) | **Accept** | Fast flings write the cursor only on settle. Slow drags write live. `pixelRatio` ≤ 2, capped camera speed, and the film is compositor-only. A device measurement is a gate before building. |
| 17 | Thumbnail borderline at DPR 3 (Eng) | **Accept** | Frames ≤ 80 css px wide, never `preview` in the film. The card gets `preview` only at rest. |
| 18 | History: each flick a Back step (Eng fact 8) | **Accept** | `at` uses replaceState only on mobile. Push happens only on selection/screen changes. |
| 19 | Make Trip/Stops the default after opening (Eng) | **Accept, with an exception** | Stops is the default without `at`. The demo landing and links with `at` open at Photos because they name a moment, and the demo's job is to show the scrub. |
| 20 | Pin chips row for multi-visit places (v1) vs model (Eng on C) | **Changed** | Cluster → fixed-height visits sheet → `zoomInto`. No non-contiguous filter and no URL change. |
| 21 | Shared groundwork not counted (Eng facts 1–7, 9–10) | **Accept** | Listed under "Groundwork". The light theme is shown in the mockup but is **not free**: v1 ships dark (`draw.ts` palette + second map style later). |
| 22 | Map gets only ~half the screen (UX matrix, v1 risk) | **Rebut** | 39% deck buys one-handed reach for every control, which UX rates best of four. Play and swipe-down collapse it to ≈70% map when watching. C's 75% map comes with the scrub-in-sheet-header conflict. |
| 23 | "Works as a mode, not as an app" (UX ranking) | **Partly accept** | Library and Grid make it a complete app for the two jobs it lacked (pick, find). It stays weaker than C for map-first library exploration. A's Story could later be a "Read" mode on the same `stops.ts` and stores. |

## Changelog

- **v2 (this):** ruler, Years level, 3-way segment, In/Out marks, tap-to-centre, long-press peek
  and the header ‹ › were removed. Added the Library screen (trip cards with verdicts, search, C's
  month cells with hold-drag range, Custom dates), D's docked card, a sticky day label, the
  density band on the film, the Grid screen (A's day chapters, D's no-cursor scroll), a fixed-height
  cluster visits sheet using `zoomInto`, the coach nudge, reduced-motion rules, landscape/short-phone
  layouts, a11y, replace-only history, settle-only cursor during flings, a DOM film, and groundwork
  from the eng critique. Lightbox: A's day-segmented progress, no chevrons. Mockup: screens are now
  Library / Stops / Photos / Grid (lightbox described in the footer), all text ≥ 11 px.
- **v1:** one deck with ruler + filmstrip at three levels (Years → Trip → Photos), a 3-way segment,
  In/Out marks behind a long-press, tap-to-centre, long-press peek, a chip row for multi-visit
  places, and a lightbox with a mini filmstrip.
