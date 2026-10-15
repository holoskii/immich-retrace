# 05 · Timeline: time navigation on the phone

Brief: [`05-briefs/timeline.md`](../05-briefs/timeline.md). Decision: [`04-decision.md`](../04-decision.md)
(§0 core, §2 rows "Time strip" and "Library", §6 F2/F3/F7, §6.3). Mockup:
[`mockups/timeline.html`](../mockups/timeline.html) (root `.mk-timeline`, sections
`.mk-timeline-v1/-v2/-v3/-shared`; strip bars drawn from the real demo distribution).
Screenshot: `screens/timeline.jpg` (1400 px, dark). Revised after [`06-review.md`](../06-review.md);
where this doc and the review's §1 disagree, the review wins. Changelog at the end.

Scope: the trip deck's strip band and transport (⏮ ▶ ⏭), the time cursor and its label, Play,
period selection inside a trip, and the **gesture rules** of the Library year rows (their visuals
are the albums brief's).

## 0. Measured facts (demo album, `GET /api/albums/:id/assets`, one request)

"San Sebastián to Huesca, 6–10 Sep 2024": 194 items, 4 without GPS, 8 videos. First → last
photo: 100.7 h. By local day: Fri 6 · 4, Sat 7 · 10, **Sun 8 · 0**, Mon 9 · 88, Tue 10 · 92.
Median gap between neighbours 49 s; 120 of 193 gaps < 90 s (bursts). Largest gaps: 46.5 h
(Sat 14:28 San Sebastián → Mon 13:00 Yesa), 16.8 h, 15.9 h (nights), then 4.5, 3.3, 3.1 h.
Stops with B's rule (> 3 h or > 15 km, merge < 4): **6**: San Sebastián Fri 4 · San Sebastián
Sat 10 · Yesa 41 · Santa Cruz de la Serós 47 · Huesca 44 · Huesca (evening) 48. A's finer rule
gives 13 raw stops before merging. The mockups use the 6.

Track: 390 − 2 × 16 = **358 px** (portrait), **295 px** in the landscape column (354 − 12 − 47 px safe area).

| Axis | px per hour | Yesa (41 photos, 54 min) | Median neighbour spacing | Share of track with photos |
|---|---|---|---|---|
| Linear time (today's `TimeStrip`) | 3.6 | 3 px | 0.05 px | ≈ 11% (89% is nights + Sunday) |
| **Folded** (gaps > 3 h → 14 px break) | 21 | 26 px | 0.3 px | ≈ 77% |
| Rank (one slot per photo) | – | 76 px | 1.85 px | 100% (no density left to see) |
| Rank, 2 000-photo month | – | – | 0.18 px | – |

A thumb dragging with live feedback settles to about ±3 px; a deliberate single-photo landing
needs ≈ 8–10 px per photo. **No absolute mapping of a 358 px strip lands on one photo, for any
axis, even for 194 photos.** So every variant needs a separate fine-step carrier, and the coarse
strip should spend its pixels on photos, not on nights. Two conclusions apply to every variant:

1. **Fold the axis.** New pure `axis.ts` (time ↔ x, piecewise linear): gaps > 3 h become a 14 px
   break; > 40 folds (a busy month) → fold only gaps > 12 h and shrink breaks to 6 px. The strip,
   ticks, value text and hit testing all use it. 7× more pixels per hour on the demo trip.
2. **Fine steps are relative, not positional**: photo steps (V3), pinch zoom (V1), frames (V2),
   and always the card → lightbox swipe and ⏮ ⏭ by stop.

## 1. Shared rules (all variants)

### 1.1 Deck (portrait 390 × 844)

| Band | Height | Content |
|---|---|---|
| Card slot (preview brief) | 76 | thumb, `13:20` large + `Mon 9 Sep` / `Yesa, Navarra` / `32 / 194 · stop 3 of 6`; at the end of Play, the end card (§1.5) |
| Strip band (this brief) | 64 (V1, V3) / 132 (V2) | `touch-action: none`, hit area full band (≥ 44 px), track inset 16 px |
| Transport row | 56 | view switch `Replay \| Photos` (left) · ⏮ ▶ ⏭ centred · stop label (right, ≤ 96 px) |
| Safe area | 34 | |

**230 px**, constant (V2: 298). The map container is 0 → 614 with `insets.b = 0`; Follow / Fit / ⓘ
sit bottom-right of the map, above the status slot. The deck height changes only on a resize
(rotation, text size), never at runtime: a collapse would recentre the camera mid-flight.
Photos (phase 1) hides the card and strip and has no ⏮ ▶ ⏭ (review §1.6); this doc covers Replay.

### 1.2 Cursor, seek vs scrub, URL

| Input | Cursor | Camera | `at` |
|---|---|---|---|
| Touch-down on the strip ≥ 22 px from the cursor | jumps to the finger (V1/V3) | **seek** (no `markScrub`; ≥ 3 h snaps per `FOLLOW.seekMs`, < 3 h flies) | replace on lift |
| Touch-down within 22 px of the cursor | does not move (grab) | – | – |
| Drag (after 6 px slop) | follows, rAF-throttled | **scrub**: `markScrub()` every frame, the camera flies | replace ≤ 1/s + on lift |
| Fling (V2 only) | written **only on settle** (detent) | one flight | replace on settle |
| ⏮ ⏭ | first photo of prev/next stop | scrub (flies the transit; reduced motion jumps) | replace |
| Play step | `play.ts` unchanged | scrub, as today | replace ≤ 1/s |
| Pin tap / lightbox close / Story tile tap | set | seek | replace |

Never `pushState` from the strip (eng fact 8). Dragging across a fold: the cursor crosses it in
one frame (folds have no inner time), the camera gets one transit flight.

### 1.3 Folds, no GPS, empty days

- **Fold** = 14 px break with a zig-zag mark on the axis. Label in the free space above the bars,
  only when ≥ 24 h: `+1 d 22 h`. Whole local days inside a fold get a struck day label (`Sun 8 · none`)
  when there is room, otherwise the fold label carries it in value text: "gap of 1 day 22 hours,
  no photos on Sunday 8 September".
- **No-GPS** photos: the base of the bar is grey **and hatched** (state not by colour alone); value
  text and card say "no location". V2 frames get a crossed-pin corner badge. A trip with no GPS at
  all keeps a working strip and Play; the camera holds (map brief).
- **Videos**: no strip mark (too small); V2/V3 frames carry a duration badge.

### 1.4 Cursor time label

The **card is the primary readout** (large time, place, `32 / 194 · stop 3 of 6`); it sits above the
strip, so the thumb never covers it. On the strip itself:
- At rest: `Mon 9 · 13:20` in the axis row under the bars, centred on the cursor and clamped;
  day labels it would overlap are hidden (as `TimeStrip` does today).
- While dragging: the label lifts into a bubble 30 px **above** the strip top at the cursor x
  (V1), or is part of the loupe (V3), or sits on the fixed playhead (V2). Never below the track.

### 1.5 Play

- **Placement**: centre of the transport bar, 56 px amber disc between 44 px ⏮ ⏭. Same bar in
  Replay and Story (phase 2); Photos (phase 1) has no Play and shows `Day ▾` instead. Pulses once
  on the demo landing (not with reduced motion).
- **Paused**: ▶, label "Play" (accessible name), stop label `Yesa` / `stop 3 of 6`.
- **Playing**: ❚❚ on a lighter disc, `aria-pressed=true`; strip cursor turns amber; stop label
  reads `Playing` / `stop 4 of 6` (the card names the place). Title line 2 never changes. The
  deck **does not collapse** (constant camera insets; the card is what you watch; the stop target
  stays where it was).
- **Stops**: any touch on the strip band, ⏮ ⏭ (they step and keep paused), opening the lightbox,
  a new selection. Map pan pauses Follow, not Play.
- **End of trip** (review §1.6): Play stops on the last photo. ▶ becomes ↺ ("Play from the
  start"), the stop label reads `End of trip` / `6 of 6`, and the card slot becomes the shared
  **end card**: `5 days · 194 photos · 6 stops` + `Next trip ›` (sub-label `Sète, Lyon & Dole`,
  accessible name "Next trip: Sète, Lyon & Dole, 3–9 May 2025"; chronological order from
  `trips.ts`) + `Get it for your Immich →` in the demo. A touch on the strip or ⏮ restores the
  normal card. No auto-advance: a new trip is a selection change (history push, new camera fit),
  and a personal archive shouldn't run on by itself (decision §4, "memories" video rejected).
- **Huge selections** (review §2): above **2 000 rows** Play steps by stop, not by photo (dwell
  1.2 s per stop, the camera flies each transit). 350 ms × 41 802 rows would be four hours. The
  stop label reads `Playing by stop` / `stop 12 of 340`, and ⏮ ⏭ behave as usual.
- **Reduced motion**: 2.5 s per photo (`PLAY.reducedMs`), camera jumps, no pulse, no ring.

### 1.6 A period inside a trip ("just Monday")

| Option | Cost | Verdict |
|---|---|---|
| Day chips row in the deck | +40 px on every trip for a rare act | No |
| D's Narrow (handles, Apply/Cancel, zoomed strip) | a second deck mode + range editor ≈ a brush | **No.** Beyond day/stop/cluster its only gain is sub-day ranges ("Mon 10:00–14:00"), which are rare and ill-suited to thumbs |
| Cluster tap → visits → Zoom to these days | exists (map brief) | Yes, the place-led path |
| **"Only this day" / "Only this stop"** | two rows in a sheet, `zoomInto` | **Yes**: from ⋯ (navigation) and a 500 ms long-press on the strip, which opens the **shared bottom action sheet** (same component as ⋯; no grabber, closes by ✕, scrim or Back). Labels: `Only Mon 9 Sep · 88` / `Only Yesa · 41`. One history push. The title becomes `‹ Mon 9 Sep · 88 photos ⌄` with line 2 `in San Sebastián to Huesca`; the title's `‹` (accessible name "Back to San Sebastián to Huesca") or Back returns |
| Custom dates (Library) | exists (albums) | Yes, the day-granular arbitrary range and the accessible path |

The long-press first seeks (touch-down), then opens the sheet; an 8 px move cancels it (review
§1.3). V1 adds a third path through its zoom (§2).

### 1.7 Story view (phase 2)

Same transport bar (⏮ ▶ ⏭ + view switch). The strip band is replaced by a 6 px day-segmented
progress line with stop ticks on the bar's top edge (display only, `aria-hidden`; the page is the
control). Scroll moves the cursor per row (`markScrub`, row-granular); ⏮ ⏭ scroll to stop
headers; Play scrolls the page (jumps under reduced motion). Switching back to Replay keeps the
cursor.

### 1.8 Library year rows: gesture rules (visuals: albums)

- **Tap** a month cell → that month (push history) → Trip view. Empty month: `aria-disabled`,
  no-op, no dimming alone (count `0` printed).
- **Long-press (350 ms, < 8 px move)** arms a range on that cell; Android vibrates 10 ms. The page
  scrolls normally until armed (cells are not `touch-action: none`); once armed, a non-passive
  `touchmove` listener prevents scroll.
- **Drag** across cells and year rows extends the range (both directions); auto-scroll when the
  finger is within 56 px of the list's top/bottom. Live count in the range bar.
- **Release does not navigate.** The range bar stays, in the albums form: `Jul – Sep 2024` /
  `3 months · 534 photos · 3 trips inside` / `Cancel` · `Open range`. Open range commits (push).
  Dragging back to the origin cell = single month. `Cancel`, or a tap anywhere else in the list,
  cancels.
- No drag can start within 20 px of a screen edge (cells sit inside the 16 px gutter + 4 px).
- **Non-gesture paths**: Custom dates (two native date inputs; from > to swaps); hardware keyboard:
  cells are a `grid`, arrows move, Shift + arrows extend, Enter shows. Screen readers get
  Custom dates and per-cell buttons ("June 2024, 128 photos").

### 1.9 Slider semantics (all variants)

`role="slider"` on the strip band (V2: on the film), `aria-valuemin/max` = 0 / N−1 (row), so
VoiceOver/TalkBack swipe up/down = one photo. `aria-valuetext`: `Mon 9 Sep, 13:20, Yesa, photo
32 of 194, stop 3 of 6` (+ `, no location`, `, video 0:06`). Arrows = photo, Page Up/Down = stop,
Home/End, Enter = lightbox. Polite live region, debounced 500 ms, silent during Play unless the
stop changes. ⏮ ⏭ are buttons named for their target (`Next stop: Santa Cruz de la Serós`).
Loupe, frames, fold marks, ticks: `aria-hidden`.

### 1.10 Robustness (review §2 gaps)

- **Index refresh under the cursor.** The cursor is a photo id, not a row index or a time. When
  the album/index refresh changes the open selection, counts, strip, folds and stops recompute and
  the cursor keeps its id; the camera does not move. If that photo is gone, the cursor goes to its
  nearest neighbour in time and the status slot shows `That photo is no longer here`. A live drag
  keeps its old axis until lift, then swaps.
- **Rotation mid-drag** (or any resize). The strip gesture is cancelled (`pointercancel`
  semantics): the cursor stays where it was, `at` is written once, the loupe and photo-step mode
  go away, Play keeps running. The deck and axis re-measure for the new width (portrait 358 px,
  landscape 295 px).
- **Play above 2 000 rows**: by stop (§1.5).

## 2. Variant 1: thumb-under-finger density strip + pinch

**Idea.** Today's `TimeStrip` on a folded axis: bars, stop ticks, day labels, the cursor under the
finger. Precision comes from **pinching the strip** (`zoomAt` around the cursor).

**Screens** (mockup V1): ① at rest on the demo landing; ② zoomed into Yesa while dragging;
③ playing.

| Gesture | Result |
|---|---|
| Tap | seek to that x |
| Drag | scrub; bubble label above the strip |
| Pinch (two fingers on the band) | zoom the strip's *view* (not the selection) around the midpoint; `zoomAt(view, t, f, k, lo, hi, min = 15 min of folded time)` in axis units |
| Double-tap | first tap seeks, second (≤ 300 ms) zooms ×4 there: the one-hand path |
| Drag to a zoomed edge | auto-pan, 0.5 view/s |
| Long-press | Only this day / stop sheet |

**Zoomed state**: a 4 px context bar on the band's top edge shows the whole trip and the window;
the day-label row reads `Mon 9 · 12:50–14:04 · 41 photos · ×14`; the transport's stop-label slot
becomes a 44 px `Unzoom strip` button (no chips inside the `touch-action: none` band). It resets the
strip view only; the selection and history are untouched, so it is not a drill-up. The
long-press sheet gains "Only this span" = `zoomInto(view)`: the cheap Narrow (one push, Back
returns). At max zoom
24 px/min, median neighbour ≈ 20 px: one photo is landable. Play auto-pans a zoomed view.

**Precision**: rest ≈ 0.3 px/photo (folded); zoom ×30 to land a photo in a burst; ×8 suffices for
a stop. 2 000-photo month: folds + two or three pinches.

**Edge cases.** No GPS: hatched bars. Single photo: one bar centred, ⏮ ⏭ and Play disabled,
pinch off. Huge trip: folds switch to > 12 h. Slow network: everything on the band comes from the
member columns (album-first boot); no media. Landscape: same band in the right column (322 px).

**Accessibility.** Pinch has double-tap and `Unzoom strip` as alternatives; a11y users rarely
need either (slider steps are per photo). Reduced motion: zoom changes are instant, no auto-pan
easing.

**Cost.** S for the strip (reuse `TimeStrip` draw + `axis.ts` + touch rules); **M for pinch**
(two-pointer tracking on a 64 px band, view state, context bar, chips). **Weak spot**: pinch is
two-handed in practice; one-handed users fall back to double-tap or the lightbox.

## 3. Variant 2: fixed-playhead film (B v2)

**Idea.** The playhead is fixed at the centre; you drag the film under it. Two levels: **Stops**
(one clip per stop, width ∝ √photos, contact sheet, `Yesa · 41 · 13:00–13:54`) and **Photos**
(56 × 72 frames). Cuts between stops: `+1 d 22 h · 100 km`. 8 px density band on the top edge
(whole trip, window marker, display only). Sticky day label at the left edge.

**Screens** (mockup V2): ① Photos level at Yesa; ② Stops level.

| Gesture | Result |
|---|---|
| Drag film | scrub (row under the playhead), detent at cuts |
| Fling | glide; cursor written on settle at the next cut |
| Tap a frame | lightbox at that photo (cursor moves first) |
| Tap a clip | Photos level at its first photo |
| Pinch / ⋯ row `Film: Stops \| Photos` | switch levels; the photo under the playhead stays (no room for a second segmented control beside `Replay \| Photos`) |
| Long-press | Only this day / stop sheet |

**Precision**: 1 photo = 60 px: exact. Cost: 194 photos = 11 600 px ≈ 32 film-widths; 2 000 =
120 000 px, so Stops must be the default level for anything over ~300 photos, and the month case
is 40-60 clips.

**Discoverability**: worst of the three. First touch on a frame opens the lightbox (people expect
"go there"); dragging left moves *forward*. Needs B's nudge animation + one coach bubble (uses up
F8's one hint).

**Edge cases.** No GPS: frame badge, frames still in order. Single photo: one centred frame, no
levels. Slow network: frames thumbhash → `thumbnail` only for visible frames after settle; ≤ 7
requests per settle (within the 60 / 6 s budget). Landscape: film 132 px fits the 390 px column
height only with the card shrunk to one 44 px line.

**Accessibility.** Same slider; the level is a radio pair in the ⋯ sheet. Reduced motion: no
glide (release stops), detents snap without spring, level switch is a cut.

**Cost.** L: momentum, detents, two levels, virtualised frames, per-frame thumbnails, its own
canvas/DOM hybrid. Deck +68 px vs V1/V3 → map ≈ 340 px instead of ≈ 410.

## 4. Variant 3: hybrid strip with loupe and photo steps (recommended)

**Idea.** V1's folded strip at rest (no pinch). While the finger is down, a **loupe** rides 24 px
above the thumb: the photo at the cursor (thumbhash → `thumbnail` after 120 ms still), time,
place. **Slide the thumb up** off the strip (≥ 40 px above the band's top; exit below 24 px,
hysteresis) and the drag becomes **photo steps**: 10 px of finger travel = 1 photo, anchored where
the mode began (no jump), the loupe widens into 5 frames with the current one ringed. Slide back
down: absolute again (the cursor returns under the thumb). iOS Music's scrub-speed idiom, no
timing, no level switch.

**Screens** (mockup V3): ① coarse drag with loupe; ② photo steps; ③ end of Play.

| Gesture | Result |
|---|---|
| Tap / drag on the band | as V1 (seek / scrub), loupe shown |
| Drag, thumb slid ≥ 40 px up | photo steps: 358 px of travel ≈ 35 photos, so ±17 around where the mode began |
| Release | loupe fades (cuts with reduced motion), card takes over |
| Long-press | Only this day / stop sheet |

**Precision**: coarse = V1 at rest; fine = 10 px/photo anywhere, any trip size (a 2 000-photo
month reaches its stop by coarse drag or ⏮ ⏭, then photo-steps). Bursts become reachable one
handed.

**Discoverability**: the first touch moves the cursor, the card, the map, and shows a loupe at
the thumb: the strip explains itself, no coach needed (F8's one hint stays for Play). Photo steps
are an accelerator: the loupe's footer always says `↑ slide up for photo by photo` while coarse
and `↓ slide down for fast` while fine. If nobody finds them, the lightbox swipe still covers fine
steps.

**Edge cases.** No GPS: loupe shows `no location` under the time; hatched bars. Single photo:
loupe without steps. Huge trip: as above. Slow network: loupe shows thumbhash only (from columns,
no request) until 120 ms still → ≤ 1 request per pause; the card freezes on thumbhash during the
drag so it doesn't double the requests. Landscape (mockup V3·④): the loupe sits left of the thumb,
arrow pointing right, because above the band it would cover the whole card; near the strip's left
end it flips to the right. Portrait, finger at x < 80 or > 310: loupe clamps inside the 16 px
gutter.

**Landscape layout (844 × 390, review §1.8).** Map 0 → 490 px, full height, no title over it,
Follow / Fit / ⓘ bottom-right of the map column. Right column 354 px: title (name ⌄ / line 2, ⋯),
then a larger card (96 px thumb, place line wraps), strip, transport row. The transport row holds
`Replay | Photos` + ⏮ ▶ ⏭ only; the stop label is dropped (card line 3 has `stop 5 of 6`).
**Track = 295 px, not 322**: iOS reports a 47 px safe-area inset on both sides in landscape, so
the column's content is 354 − 12 − 47. Folds keep the same rule (≈ 17 px per hour on the demo).

**Accessibility.** Loupe is `aria-hidden` (the slider value text carries the same). Photo steps
are a pointer-only accelerator for what arrows/VO swipes already do one photo at a time. Reduced
motion: loupe appears and swaps without scale/fade; mode change is a cut.

**Cost.** S–M: V1 minus pinch, plus one absolutely-positioned element and a pure
`gain(dy, mode)` function (unit-testable). No new physics.

## 5. Answers to the brief's questions

| Question | V1 density + pinch | V2 film | V3 loupe + steps |
|---|---|---|---|
| Land on one photo (194) | only after ~×30 pinch | yes, 60 px/frame | yes, photo steps |
| 2 000-photo month | folds + pinches | Stops level required | coarse + steps |
| Fine steps carried by | pinch, double-tap, lightbox | the film | photo steps, lightbox, ⏮ ⏭ |
| First try works without coach | yes | no (nudge + coach) | yes |
| No GPS / empty days / gaps | hatched base / fold labels | badge / cuts with km | as V1 + loupe text |
| Cursor label | card + bubble above strip | on the playhead | card + loupe |
| Period inside trip | Only this day/stop + **Only this span** | Only this day/stop | Only this day/stop |
| One-handed | coarse yes, fine no | yes | yes |
| Deck height | 230 | 298 | 230 |
| Cost | S + M (pinch) | L | S–M |

Play, end of trip, Story and Library rules are shared (§1.5, §1.7, §1.8).

## 6. Recommendation: Variant 3

1. **It is the only variant where one thumb does both coarse and fine.** V1's fine step needs two
   fingers; V2's coarse step needs many flings or a level switch.
2. **It needs no coach.** Touch-down = visible result at the thumb. The decision's default bias
   (thumb-under-finger) holds, and the loupe answers the "people want to see frames while
   scrubbing" trigger that would otherwise bring in V2 (decision §3).
3. **It's cheap and swappable**: `TimeStrip` drawing + `axis.ts` + a loupe; same band height as
   V1, so the camera insets and the deck layout match the rest of the study.
4. **Folds are the bigger win than any variant choice**: 7× pixels per hour on the demo trip.
   Ship them regardless.

Keep from V1: double-tap zoom and "Only this span" as a later add-on if the hallway test shows
sub-day ranges matter. Keep V2 as the documented runner-up (decision §3) for the band slot.

**Hallway test** (5 people, phone, demo, no help): (a) "Show me Yesa", (b) "Find the photo of the
monastery door" (one specific photo in a burst), (c) "Go to the photo just before it", (d) "Play the
trip and stop it at Huesca". Pass for V3: (b) under 30 s for ≥ 4/5; photo steps found unprompted
by ≥ 2/5 (otherwise the footer copy changes, not the design). Fail on (b) for most → test V2.

## 7. Interfaces to the other categories

- **Map**: seek vs scrub per §1.2 (no new camera API); deck height constant → fixed Follower
  insets; pin tap = seek; cluster sheet's "Jump here" = seek; "Zoom to these days" = `zoomInto`.
- **Preview**: the card is the time readout (time large, `photo n of N · stop k of K`); during a
  drag the card shows thumbhash only; lightbox ←/→ moves the cursor (replace), ↓ close = seek.
- **Albums**: month-cell gestures §1.8; Custom dates; "Next trip" at end of Play uses the trip
  order from `trips.ts`.
- **Navigation**: transport bar hosts the view switch; ⋯ hosts "Only this day / stop"; Back
  unwinds `zoomInto`; the strip never pushes history.
- **New code**: `axis.ts` (folds), touch handlers for the band (seek/scrub/grab/long-press),
  `gain.ts` (photo steps), `Loupe.svelte`, stop ticks from `stops.ts`; `TimeStrip` drawing reused.

## Revised after review (06-review.md)

- End of Play → the shared end card in the card slot (`5 days · 194 photos · 6 stops`, `Next trip ›`,
  `Get it for your Immich →` in the demo); stop label `End of trip`. Was: `End of trip · Next trip ›`
  in the stop label.
- "Only this day / stop": the pill's `← Whole trip` → the title's `‹` + line 2 `in San Sebastián to
  Huesca`. The 500 ms long-press opens the shared bottom action sheet (no grabber; 8 px cancels).
- Library range bar → the albums form (`Cancel` · `Open range`); tap-elsewhere cancel and "back to
  origin = single month" kept.
- Added §1.10 (index refresh keeps the cursor's photo id, rotation mid-drag cancels) and Play by
  stop above 2 000 rows (§1.5).
- V1's `⤢ Whole trip` → `Unzoom strip` (strip view only, not a drill-up). V2 level toggle → pinch
  or ⋯ (no room beside the view switch).
- Deck 230 px constant, card format `32 / 194 · stop 3 of 6`, title line 2 static.
- Landscape specified and drawn (V3·④). Pushback: the review's 322 px track ignores the 47 px
  landscape safe-area inset; the track is 295 px.
- Mockup: the map is dark in both themes, with map V3 stop badges (6 stops) instead of count
  bubbles; title `name ⌄` + `⋯` (no `≡`, no `6 stops` in line 2); view switch `Replay | Photos`;
  Follow / Fit / ⓘ as the map's vertical pair; no grabber on the sheet; `Bay of Biscay` moved
  clear of the status bar; callouts pink, on the frame margin with leader lines; ids
  `mk-timeline-*`.
