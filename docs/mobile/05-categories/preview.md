# 05 · Preview: photo viewing (grid / Story, lightbox, prefetch)

Brief: `../05-briefs/preview.md`. Decision: `../04-decision.md` (§0, §2, §6 are not reopened here).
Mockup: `../mockups/preview.html` (root `.mk-preview`, variant classes `.mk-preview-v1/v2/v3`, ids
`mk-preview-*`), screen `../screens/preview.jpg`. Demo data only. `../06-review.md` §1 wins over
anything here; the changelog at the end lists what the review changed.

## 0. Facts measured on the demo (2026-10-14, 4 requests)

| Fact | Value | Consequence |
|---|---|---|
| `size=thumbnail` | **250 × 187** (long side 250), JPEG, 28 KB | Softer than the "short side 250" everyone assumed (§1.2). |
| `size=preview` | **1280 × 960**, JPEG, **517 KB** | ~0.45 s per preview on 4G at 9 Mbps. A preview is costly; never per step, never per tile. |
| Demo trip | 194 = 6 Sep 4 · 7 Sep 10 · **8 Sep 0** · 9 Sep 88 · 10 Sep 92 | One empty day, two tiny days, two big ones. Day segments need a minimum width. |
| Stops (`stops.ts`, 6) | San Sebastián 4 (#1–4) · San Sebastián 10 (#5–14) · Yesa 41 (#15–55) · Santa Cruz de la Serós 47 (#56–102) · Huesca 44 (#103–146) · Huesca 48 (#147–194) | `56 / 194` = first photo of stop 4 of 6. Huesca is two stops (gap > 3 h). Straight-line transits: San Sebastián → Yesa 101 km, Yesa → Santa Cruz 43 km (3 h 03), Santa Cruz → Huesca 46 km. |
| No GPS | 4, all on 9 Sep: 13:14 and 13:40 (inside Yesa), 17:05 and 18:50 (inside Santa Cruz) | Every no-GPS photo has a GPS neighbour within minutes: "no location · near Yesa" is always computable here. |
| Video | 8 in Sep 2024 (1 on 7 Sep, 3 on 9 Sep, 4 on 10 Sep), all 6 s | Short clips: autoplay + loop is fine; scrubbing a 6 s clip is rare. |
| UTC offset | +2 everywhere | Info sheet shows "UTC+2". |

The owner's Immich may store thumbnails differently (Immich resizes by its own rule). **Not checked**
(private library is off limits); the owner should read one thumbnail's size before tuning tiles.

## 1. Shared core (every variant)

### 1.1 One media scheduler (`media.ts` queue)

All thumbnail/preview/video requests go through one queue: **≤ 6 in flight, token bucket 60 / 6 s
(10/s)**, priority order, pending items dropped when their target leaves the "wanted" set. Images
are set on `<img>` only when the queue grants them (never `loading="lazy"` alone: it can't be
cancelled or counted). Map tiles are a different host and don't count.

| Prio | What | When | Cost |
|---|---|---|---|
| P0 | Lightbox current `preview` | on open/step, immediately | 1 |
| P1 | Lightbox ±1 `preview` | after current has loaded, and after 300 ms on the page (fast swiping fetches nothing extra) | 2 |
| P1 | Lightbox video | current page only, after 300 ms on it; neighbours get the poster (`thumbnail` → `preview`) | Range requests, 1–3 |
| P2 | Docked card `preview` | 300 ms rest; during Play only at dwells ≥ 900 ms (stop pauses) | ≤ 1 per stop |
| P2 | Play look-ahead: next 3 cursor rows' `thumbnail` | while playing (path is known) | ~3/s at 350 ms bursts |
| P3 | Visible tiles `thumbnail` | scroll velocity < 1.5 px/ms (≈ 2 screens/s); else thumbhash only | 18–28 per screen |
| P4 | One screen ahead in scroll direction, `thumbnail` | idle (no P0–P3 pending) | ≤ 1 screen |
| P5 | Story hero `preview` | ≥ 50 % visible, 300 ms at rest, ≤ 2 at once, not under Save-Data | 1 per hero |
| P6 | Filmstrip (V3a) `thumbnail` | visible frames only | ~9 |

**429 back-off.** The demo relay limits ~120 requests / 6 s per IP. On a `429` the queue pauses
for `Retry-After` (or 6 s if absent), keeps what is on screen (thumbhash stays, nothing is blanked),
and drops pending P3–P6; P0 is retried first when it resumes. If requests are still throttled after
10 s, the status slot shows `Photos are loading slowly` once per session (priority 1, 3–4 s). No
error UI before that. The bucket above (60 / 6 s) stays below the relay limit, so a 429 means a
shared IP (NAT, another tab), not our own burst.

Budget check: a full 4-column screen is 28 thumbnails = 2.8 s of the 10/s bucket, so look-ahead is
one screen, idle only. The lightbox (P0+P1 = 3 per photo) always pre-empts tiles. A swipe every
0.5 s costs 2/s (current only); the bucket never empties in normal use. Everything is
`immutable`-cached by thumbhash URL, so going back costs 0. Decoded previews: current ± 1 plus ≤ 2
heroes, and heroes are released (`src` cleared) when the lightbox opens: **≤ 3 at any time**, as
§6.2 asks.

### 1.2 How sharp a tile is (demo: thumbnail 250 × 187)

Ratio = source px / device px needed (≥ 1 crisp, 0.75–1 slightly soft, < 0.6 visibly soft).

| Surface (css px) | DPR 3 | DPR 2.6 | Image |
|---|---|---|---|
| Lightbox filmstrip frame 40 × 40 | 1.56 | 1.80 | thumbnail |
| 4-col square tile 94 × 94 (cover crop: short side 187) | **0.66** | 0.77 | thumbnail |
| Justified tile, landscape 144 × 108 | **0.58** | 0.67 | thumbnail |
| Justified tile, portrait 81 × 108 | 0.77 | 0.89 | thumbnail |
| Docked card 112 × 84 (deck) | 0.74 | 0.86 | thumbnail moving, preview at rest |
| Story hero 358 × 238 | 0.23 → preview **1.19** | 1.37 | thumbnail then preview at rest |
| Lightbox full width 390 | preview 1.09 | 1.26 | preview |

So on the demo every grid tile is soft at DPR 3. Recommendation: **regenerate the demo's
thumbnails at 480 px long side** (the demo data set is ours; ~60–70 KB each, still 3–4× cheaper
than a preview) and keep the code size-agnostic. For owners: open question 4 stands; Retrace
cannot fix it client-side without 517 KB previews per tile, which the budget forbids.

Flinging: tiles show the **thumbhash** (decoded once into a data URL, cached per id) at full tile
size, no spinner. When velocity drops, thumbnails fade in over 120 ms (0 ms under reduced motion),
in scroll order, nearest the viewport centre first.

### 1.3 Cursor in Photos/Story

- The cursor photo's tile has a 3 px **amber ring + inner white hairline** (visible on any photo;
  not colour alone: the tile also gets "current" in its label).
- Phase 1: Photos is a **view of the trip** (view switch `Replay | Photos`, `replaceState`,
  `view=photos` in the URL), not a pushed screen. Switching to it scrolls once so the cursor row
  sits under the chapter header. Scroll never moves the cursor. When the cursor row is off screen,
  the **status slot** (12 px above the transport row) holds the `↑ 16:57` / `↓ 16:57` cursor chip
  (direction + cursor time); tap scrolls back (smooth, or jump under reduced motion). Tap a tile =
  cursor there + lightbox. Back from Photos leaves the trip, the same as Back from Replay.
- Phase 2 (Story): the cursor *is* the current row, so the cursor chip is never needed; the spine dot
  marks it. Tapping a tile still sets the cursor exactly to that photo.
- Lightbox swipe ↓ closes to the cursor: Photos scrolls so the lightbox's last photo is on screen
  (only if it isn't already) and pulses its ring once.

### 1.4 Lightbox (decided rules, completed)

```
┌ safe area ───────────────────────────────┐
│ ✕     56 / 194 · stop 4 of 6        Share │  44 px top bar (scrim), 44 px targets
│ ▬▬ ▬▬▬ ▏ ▬▬▬▬▬▬▬▬▬▬▬▬ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬     │  day-segmented progress, 4 px (+ stop ticks)
│                                           │
│        full-bleed photo (contain)         │  swipe ←/→ step · ↓ close · pinch / dbl-tap zoom
│                                           │
│ [filmstrip, variant 3a only, 48 px]       │
├─ info sheet peek 88 px ─────────── ⌃ ─────┤  time + UTC offset · place · mini route
└───────────────────────────────────────────┘
```

- **Gestures**: horizontal pan > 10 px and |dx| > 1.5·|dy| = paging (follows the finger, snaps at
  25 % or 0.3 px/ms); vertical down > 10 px = close drag (photo scales to 0.85 and the backdrop
  fades, release past 120 px or 0.5 px/ms closes, else springs back); vertical up on the photo =
  open the info sheet. Pinch / double-tap zoom to 2.5× at the tap point; at > 1× paging and close
  are off and a pan moves the photo; double-tap again or pinch back to 1× re-enables them. Single
  tap (after a 250 ms double-tap wait) toggles chrome. No drag starts within 20 px of the left/right
  edges (OS back). `touch-action: none` on the stage only.
- **Chrome**: hidden chrome hides the top bar, progress, filmstrip and the sheet peek; the photo
  then fills the screen. Chrome never auto-hides (no timers that hide the ✕).
- **Day / stop boundaries**: the progress bar is segmented by day (width ∝ count, min 6 px; an
  empty day is a 2 px notch); stop starts are 1 px ticks inside a day. On a step that crosses a
  stop or a transit, a chip shows for 1.5 s under the bar: "3 h 03 later · Yesa → Santa Cruz de la
  Serós"; crossing a day adds the day: "Tue 10 Sep · Day 5". The counter `stop 4 of 6` updates. The
  swipe itself is never interrupted by an interstitial page. Haptic tick (`navigator.vibrate(8)`,
  Android only) on a stop crossing.
- **Info sheet**: two fixed states, **no handle, no drag** (decision §0: no draggable multi-snap
  sheet). **Peek 88 px** (+ safe area) and **open ~60 %** (photo shrinks above it, still pageable).
  Tap the peek (it carries a ⌃ chevron) or swipe ↑ on the photo opens it; Back, ✕ or swipe ↓
  returns it to peek (a second ↓ then closes the lightbox). Only the open state is a history
  entry. Hidden chrome hides the peek. Peek shows,
  without pulling: line 1 `Mon 9 Sep 2024 · 16:59 · UTC+2`, line 2 `Santa Cruz de la Serós, Spain`,
  and a 56 × 56 static route thumbnail at the right with the position dot. Open adds: coords
  (`42.5240° N, 0.6731° W`, tap = copy), "Photo · 4:3" / "Video · 0:06", the full-width
  `RouteSketch` (358 × 168: whole trip route, past solid amber, future faint, the day's part
  thicker, a ring at this photo, stop names), Share, demo credit line ("Photo: … · CC BY-SA 4.0 ·
  Wikimedia Commons" + About) or "Open in Immich" (owner).
- **No-GPS photo**: place line reads **"No location · near Yesa"** when a GPS photo exists within
  2 h in the same stop ("near" = that photo's `city`), else "No location". The route sketch shows a
  **hollow dashed ring** at the nearest GPS neighbour with "nearest: 2 min earlier", never a solid
  dot; coords row reads "—". The crossed-pin badge appears next to the time in the top bar too.
- **Video**: `<video playsinline muted autoplay loop controls preload="none">`, poster = thumbhash →
  `thumbnail` → `preview`. Autoplay only for the settled current page (300 ms), paused when it
  stops being current, when chrome opens the info sheet, or when the tab hides. Native controls sit
  in the bottom band of the video box; **pointerdowns inside the bottom 64 px of a video box are
  ignored by the pager** so the native scrubber wins there; paging still works from anywhere else.
  The ‹ › step buttons (screen reader / keyboard) work on videos too. Unmute is native.
  Reduced motion: no autoplay, poster + play button.
- **Single photo**: no progress segments, no filmstrip, swipes rubber-band, counter `1 / 1`.
- **Preview fails** (error or timeout after a 429 back-off): keep the upscaled `thumbnail` and show
  a `Couldn't load the full photo · Retry` chip under the progress bar; Retry re-queues at P0.
  Paging is unaffected. **Video fails**: poster stays, centred `Video unavailable` label, no
  controls; the page still pages and the info sheet still works. Tiles and film frames that fail
  stay on thumbhash, never a broken-image icon.
- **Rotation**: cancels any gesture in progress (paging springs back, a close drag is abandoned),
  resets zoom to 1×, keeps the current photo and the info state (portrait open ⇄ landscape panel).
- **Landscape**: full screen, no filmstrip. The info sheet becomes a **320 px right panel**; the
  peek becomes a one-line caption at the bottom of the photo (`16:59 · Santa Cruz de la Serós ⌃`),
  tap or swipe ↑ opens the panel, Back / ✕ / swipe ↓ collapses it. The photo is contained in the
  remaining ~524 px. Top bar and progress span the photo area only.
- **History**: open pushes (`lb`), steps `replaceState` (≤ 1/s), info open pushes. Back = info open
  → peek, then lightbox → the view it was opened from (Photos or Replay), then out of the trip.

### 1.5 Long-press on a tile

**The shared action sheet, no peek.** Long-press (500 ms, cancel on 8 px move) → haptic, the tile
gets a ring, and the shared bottom action sheet (same component as ⋯; fixed height, no grabber,
closes by ✕, scrim or Back) opens with a header `Huesca · Tue 10 Sep, 12:41 · photo 121 of 194` and
three rows: **Show on map** (switch the view to Replay, cursor on this photo, Follow on),
**Share photo** (URL with `at` + `lb`), **Open**. No anchored popover. Reasons: a peek duplicates the lightbox, which is
one tap; "Show on map" is the one thing you can't otherwise do from Photos without two screens;
iOS Safari's own image callout must be suppressed anyway (`-webkit-touch-callout: none`), so the
gesture is ours to define. Everything in the sheet is also in the lightbox (Share, swipe ↓ = map
at that photo), so the long-press is a shortcut, never the only path. Multi-select stays out (§6.5).

## 2. Variant 1: Story density

**Idea.** A's reading layout as the one Photos/Story component: chapter header per day, stop
header, a full-width hero (first non-video GPS photo of the stop, or the most central one by
`ratio`), justified rows ~108 px from `ratio`, transit breaks, an empty-day line. Phase 2 adds the
docked map and the spine without changing the layout.

**Screens / states** (mockup V1·A, V1·B).
- *Settled*: the trip's title block (`San Sebastián to Huesca ⌄` / `DEMO · 6–10 Sep 2024 · 194
  photos`, ⋯ right), solid at the top, no `‹ Map` header; sticky chapter
  `MON 9 SEP · DAY 4 OF 5 · 88` + current stop line; stop header `Santa Cruz de la Serós · 16:59–19:01 · 47`;
  hero; rows; transit `3 h 03 · 43 km · Yesa → Santa Cruz de la Serós`; no-GPS tile with a crossed
  pin badge; video tile with `▶ 0:06`; cursor ring; `↑ 16:57` cursor chip in the status slot. The
  bottom is the **transport row**: view switch `Replay | Photos` + `Day 4 of 5 ▾` (+ the density
  toggle once the compact grid ships). Phase 1 has no ▶ and no ⏮ ⏭ here: Play would move a map
  nobody sees. Phase 2 Story brings them back and `Day ▾` moves to the sticky chapter header.
- *Day sheet* (`Day 4 of 5 ▾`): fixed-height sheet, no grabber, closes by ✕, scrim or Back. One
  row per day (date, count, stops as tappable chips; Tue 10 lists `Huesca 44` and `Huesca 48`;
  empty Sun 8 dimmed, not tappable). Tap a day or a stop chip → scroll there (no cursor change in
  phase 1).
- *Flinging*: thumbhash tiles, sticky header updates live. Nothing collapses.
- *End*: previous / next trip cards (albums category).

**Gestures.** Vertical scroll; tap tile = cursor + lightbox; tap stop header = jump-to-top of stop
(no collapse: collapsing changes heights and fights virtualisation); long-press = §1.5; no pinch.

**Find one photo in a 600-photo trip** (8 days, ~18 stops): page ≈ 27 000 px ≈ 46 screens.
From Replay: view switch `Photos` (1) → `Day ▾` (1) → stop chip (1) → 0–2 scrolls → tap (1) =
**4–6 gestures**.
Without the sheet, 8–12 flings.

**Edge cases.** No GPS in the whole selection: stops fall back to time gaps (> 3 h), headers say
"No location" + times; heroes still work. Single photo: one chapter, one hero, nothing else.
Huge (year, 5 000 photos): heroes only for stops ≥ 6 photos and at most one per 3 screens, day
sheet becomes month-grouped, virtualisation (`row ↔ y` binary search) keeps DOM < 150 tiles.
Slow network: thumbhash rows are already the right size, hero stays at `thumbnail` (soft) until its
preview lands; Save-Data skips hero previews. 429: §1.1 back-off, tiles keep thumbhash. Landscape
(phase 1): Photos goes **full width** (844 px minus safe areas), justified rows at the same 108 px
height (~6–7 tiles a row), heroes capped at 240 px tall; the title and transport row stay. Phase 2
Story uses the docked map as the left column instead.

**Accessibility.** `<h2>` day, `<h3>` stop, tiles are `<button>` with labels
"Santa Cruz de la Serós, Mon 9 Sep 16:59, video 6 seconds, no location"; the day sheet is the
non-gesture "jump" path; text sizes scale (chapter header wraps to 2 lines at 200 %).

**Plugs into.** Timeline: the transport row is shared; ⏮ ⏭ by stop scroll to stop headers and
Play scrolls, in Story (phase 2) only. Map: phase 2 docked map uses the same `storyLayout` row →
cursor; "Show on map" = view switch + cursor. Navigation: Photos is a view of the trip (replace,
`view=photos`) from phase 1; Back leaves the trip. Albums: trip cards at the end (next trip is
chronological).

**Cost.** `storyLayout.ts` is needed anyway (decision). Heroes cost previews (517 KB each on the
demo): ~4 per trip view.

## 3. Variant 2: Compact grid

**Idea.** The same component in a dense mode: `storyLayout` with `ratio := 1`, 4 columns, row
height 94 + 2 px gaps, **no heroes**, stop headers as a 32 px sticky sub-row under a 40 px sticky
day header, transits as a 28 px line. A **fast-scroll rail** on the right. **Pinch out** switches
to Story density, pinch in back, anchored on the tile under the fingers; a labelled toggle
(`Story ▥` / `Compact ▤`) in the transport row is the non-gesture path. The title block stays.

**Screens / states** (mockup V2·A, V2·B, V2·C).
- *Settled*: 28 tiles per screen (vs ~18 in V1), sticky `Mon 9 Sep · 88` + `Santa Cruz de la
  Serós · 47`, cursor ring, video badge `▶ 0:06`, no-GPS crossed-pin corner badge.
- *Rail drag*: the rail (44 px hit width, 16 px inset from the edge, visible only while scrolling or
  for 1.5 s after) shows a bubble `Tue 10 Sep · Huesca` with day ticks along the rail (stops as
  small ticks); tiles are thumbhash while dragging; release settles and loads.
- *Long-press* → the shared action sheet (§1.5).

**Gestures.** Scroll, rail drag, pinch (density), tap, long-press. Pinch is safe here: there is no
browser zoom on the shell (`touch-action: pan-y pinch-zoom` replaced by our handler on the list).

**Find one photo in 600**: page ≈ 15 300 px ≈ 26 screens. Photos (1) → rail drag to the day
(1) → 0–1 scroll → tap (1) = **3–4 gestures**, with more candidates on screen to recognise.

**Edge cases.** Squares crop panoramas and portraits (a 3:1 pano becomes its middle third): the
lightbox shows the full frame; alt text says "panorama". No GPS: badge only, no grey-out. Single
photo: one tile; grid feels empty → switch to Story density automatically when the selection is
< 12 photos. Huge: the rail is the main tool; its labels become months when > 60 days. Slow
network: 28 thumbnails per screen = 2.8 s of the bucket; look-ahead is skipped on cellular when
`effectiveType` is `3g`. Landscape: Photos is full width, so 8 columns (~100 px tiles).

**Accessibility.** Same DOM semantics; the rail is `role="scrollbar"`-like slider with
`aria-valuetext="Tue 10 Sep, Huesca"`, but screen-reader users get the day sheet from V1 (same
`Day ▾` chip); pinch has the transport-row toggle.

**Plugs into.** Same as V1. Phase 2 Story should stay at Story density (scroll → cursor per row
with 4 squares a row works, but the docked map loses the "stop" rhythm without heroes).

**Cost.** Small on top of V1: a layout parameter, the rail (DOM, pointer capture), pinch anchor.

## 4. Variant 3: Lightbox navigation

Three ways to know "where am I in the trip" and move further than one photo inside the lightbox.

### 3a · Stop-segmented mini filmstrip (A / B)
48 px band above the info sheet peek: 36 px frames (current 44 px with an amber frame, centred),
stops separated by 10 px gaps with the stop name above the first frame. **Drag the film** scrubs
the photo (the photo shows the frame's thumbnail while dragging, preview after 300 ms rest); tap a
frame jumps. Hidden with chrome and while zoomed. Frames are `thumbnail` (crisp at 40 px: 1.56).
Only the current stop ± 1 are rendered (windowed), so a 5 000-photo range costs the same. On the
demo the two Huesca stops show as `Huesca · 44` | `Huesca · 48` with a gap between.
- Shows the jump: the gap and label make a stop crossing visible before you reach it.
- Cost: +48 px of chrome, one more horizontal gesture in a screen whose main gesture is horizontal
  (separated by zone: the band is below the photo, not on it), ~9 thumbnails per open (usually
  already cached from Photos).

### 3b · None (D)
Progress bar + counter + crossing chip only. Moving far = swipe ↓ (closes to the cursor in Photos /
Replay) and tap another photo. Lightest chrome; the photo gets the 48 px. Finding the next stop is
"close, scroll, tap" (3 gestures) instead of one film drag.

### 3c · Vertical story pager (one stop per page)
Swipe ↑/↓ moves by stop, ←/→ by photo within the stop; each page is a stop card (hero, name, time
span, count). **Rejected**: swipe ↓ is the decided close gesture (§0), and a second axis of paging
makes "close" a button only. It also duplicates Story view. Kept in the mockup to show why.

**Edge cases (3a/3b).** Single photo / single stop: no film (3a) or no gaps. No GPS: frames carry
the crossed-pin corner. Landscape: 3a film hides (height ~390 px), info sheet becomes a 320 px
right panel (§1.4, mockup V3·L). Slow network: film shows thumbhash frames; the photo stays thumbhash → `thumbnail`
(upscaled, soft) → preview. Video: film frame has `▶`.

**Accessibility.** Film = `role="listbox"` of the current stop's photos (`aria-label="Santa Cruz de
la Serós, 47 photos"`), arrows move, Page Up/Down change stop; screen-reader-visible ‹ › buttons;
live region (polite, 500 ms debounce): "56 of 194, Mon 9 Sep 16:59, Santa Cruz de la Serós, new
stop". Reduced motion: crossfade steps, no spring on close.

## 5. Answers to the brief's questions

| Question | Answer |
|---|---|
| Find one photo in 600 | V1: 4–6 gestures via the day sheet. V2: 3–4 via the rail. Lightbox swiping is not a finding tool (avg. 300 swipes); 3a's film helps only within a stop. |
| Tiles flinging vs settled; 250 px at DPR 3 | Thumbhash at full tile size while velocity ≥ 1.5 px/ms, thumbnail fade-in when it drops. Demo thumbnails are 250 × 187: 0.58 (justified landscape), 0.66 (square), 0.23 (hero → preview). Regenerate demo thumbnails at 480 px; owners: open question 4. |
| Cursor photo in the grid; getting back | Amber ring + hairline; switching to Photos scrolls to it; a `↑/↓ 16:57` cursor chip in the status slot when off screen (phase 1); phase 2 the cursor is the current row (spine dot). |
| Video | Grid: `▶ 0:06` badge bottom-left (11 px on a scrim). Lightbox: muted autoplay + loop when settled 300 ms, pause off-page. Pager ignores pointerdowns in the bottom 64 px of the video so the native scrubber wins; paging works elsewhere and via ‹ ›. |
| Info sheet | Two fixed states, no drag. Peek 88 px: date · time · UTC+2, place, 56 px route thumb with dot, ⌃. Open (~60 %, tap peek or swipe ↑): coords, kind, full RouteSketch (ring = here, past solid / future faint), Share, credits / Open in Immich. No GPS: "No location · near Yesa", hollow dashed ring at the nearest GPS photo. |
| Crossing stop/day in the lightbox | Yes: progress segmented by day with stop ticks; a 1.5 s chip "3 h 03 later · Yesa → Santa Cruz de la Serós" (+ day when it changes); counter `stop 4 of 6`; 3a's film shows the gap ahead. |
| Prefetch policy | §1.1: one queue, P0 lightbox current → P1 ±1 after 300 ms → P2 card at rest / Play look-ahead thumbnails → P3 visible tiles at low velocity → P4 one screen ahead when idle → P5 hero previews. ≤ 6 in flight, 10/s bucket. |
| Long-press on a tile | The shared bottom action sheet: Show on map, Share photo, Open. No peek, no anchored menu. Everything also reachable from the lightbox. |

## 6. Recommendation

**Photos/Story: Variant 1 (Story density) as the layout, plus Variant 2's fast-scroll rail; the
compact grid as a second density behind pinch + the header toggle, shipped after phase 1 if the
hallway test asks for it.** V1 is the decided component (phase 2 needs heroes and stop rhythm for
the docked map), its day sheet gives a 4–6 gesture find path and an accessible jump. The rail is
the cheapest big win for 600+ photo selections and works on either density. The compact mode is
cheap (`ratio := 1`, no heroes) and shows 55 % more photos per screen, which is what finding wants,
but it is a second visual language, so it waits for evidence.

**Lightbox: 3a, the stop-segmented mini filmstrip.** It is the only option that shows a stop
crossing *before* it happens and lets you move within a stop without leaving; it costs ~9 cached
thumbnails and 48 px that disappear with chrome. D's objection ("a third horizontal strip") applies
to the Replay deck, not the lightbox, where no other strip is visible. 3b is the fallback if the
film's drag conflicts with paging on real devices (spike item). 3c is rejected (breaks swipe ↓).

**Do first, regardless of variant**: the media queue with 429 back-off (§1.1), demo thumbnails at 480 px, the
pointer/zoom/close state machine of §1.4 with a test on iOS Safari for the native video scrubber.

## 7. Notes for other categories

- Map: "Show on map" = switch the view to Replay + set the cursor, Follow on; swipe ↓ from the
  lightbox lands on the same photo. `RouteSketch` (static SVG) is shared with the map's WebGL-lost fallback.
- Timeline: card in the deck follows §1.1 P2; Play look-ahead thumbnails are this queue's job.
- Navigation: lightbox open = push, step = replace, info open = push. View switch = replace. Back
  from Photos leaves the trip (it never returns to Replay).
- Albums: trip cover images are `thumbnail` (cards ≤ 120 px tall); next/prev trip cards end Story.
- Brief path mismatch: the brief says `05-categories/`, the task said `05-categories/`; this file is in
  `05-categories/`.

## Revised after review (`06-review.md`)

- Photos is a view of the trip (replace, `view=photos` from phase 1), not a pushed screen. It keeps
  the title block and the transport row; `‹ Map` header gone. Back from Photos leaves the trip.
  "Show on map" = view switch + cursor. The `Back = sheet → lightbox → Photos → Replay` chain is gone.
- Photos bottom bar is the transport row: `Replay | Photos` + `Day 4 of 5 ▾` (+ density toggle when
  compact ships). No Play and no ⏮ ⏭ in phase 1. The cursor chip lives in the status slot.
- Info sheet: no handle drag, two fixed states (tap peek / swipe ↑ opens; Back, ✕, swipe ↓ return to
  peek); only open is a history entry. Grabbers removed from the day sheet and info sheet.
- Six stops: `stop 4 of 6` everywhere; Huesca is 44 + 48. ⓘ dropped from the top-bar sketch.
- Tile long-press → the shared bottom action sheet, not an anchored menu.
- Phase 1 Photos in landscape is full width. Landscape lightbox drawn (V3·L): 320 px info panel.
- Added: 429 back-off (§1.1), preview / video failure and rotation (§1.4).
- Mockup: ids renamed `mkp-*` → `mk-preview-*`; RouteSketch is dark in both themes (the map is dark
  in every theme in v1).
