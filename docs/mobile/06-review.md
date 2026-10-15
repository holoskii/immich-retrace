# 06 · Consistency and quality review

Inputs: `04-decision.md`, `05-categories/{navigation,timeline,map,preview,albums}.md`, and the five
category mockups. I rendered each mockup in headless Chromium at 1720 px wide, light and dark:
(those renders were not kept). Automated checks: every CSS selector is scoped under
its root class (the theme selectors `:root[data-theme] .mk-x` are allowed); no external requests;
no `<script>`; both colour schemes defined. Demo data only.

Section 1 sets the decisions that settle conflicts. Section 2 lists the gaps nobody designed.
Section 3 gives the required fixes per category (doc and mockup). When a category doc disagrees
with section 1, section 1 wins.

## 1. Cross-cutting decisions

### 1.1 Canonical demo data (every mockup and doc)

The categories drew three different trips. Use the timeline's measured data (`05-categories/timeline.md` §0):

| # | Stop | Day | Photos | Rows |
|---|---|---|---|---|
| 1 | San Sebastián | Fri 6 Sep | 4 | 1–4 |
| 2 | San Sebastián | Sat 7 Sep | 10 | 5–14 |
| 3 | Yesa | Mon 9 Sep | 41 | 15–55 |
| 4 | Santa Cruz de la Serós | Mon 9 Sep | 47 | 56–102 |
| 5 | Huesca | Tue 10 Sep | 44 | 103–146 |
| 6 | Huesca (evening) | Tue 10 Sep | 48 | 147–194 |

- **Sun 8 Sep has 0 photos.** The strip shows it as a fold, never as bars. There is no stop on
  Sunday (map V3·2's "Olite, Sun 8 Sep 11:20" is invented).
- 4 photos without GPS, 8 videos (all 6 s), UTC+2. Demo library: 6 albums, 1 688 photos,
  2023 65 · 2024 830 · 2025 505 · 2026 288. Pamplona & Basque Country 120 photos, Pyrenees 97.
- Leyre, Javier, Pamplona, Olite and Jaca may appear as basemap labels, but not as stops or
  clusters of this trip.

### 1.2 Terminology and formats

| Term | Meaning | Don't say |
|---|---|---|
| **Title** | the floating two-line block at the top (name ⌄ / line 2) | pill, header, bar |
| **Card** | the docked photo card in the deck | marker card |
| **Strip** | the time band in the deck | timeline, film (film = V2 only) |
| **Transport row** | view switch · ⏮ ▶ ⏭ · stop label | bottom bar |
| **View switch** | segmented `Replay \| Photos` (phase 2: `Replay \| Story`) | Map, Story button |
| **Status slot** | the single toast/chip position above the deck (§1.5) | snackbar, pill |
| **Follow chip** | `◎ Follow · 13:00 Yesa` in the status slot | Follow pill |
| **Stop** | a `stops.ts` unit (place + time) | cluster (that is a map rendering) |
| **Visit** | one stop, seen from a place: a place's visits are the stops whose `city` matches it. The visits sheet, "Also here" and place search all use this one definition | |
| **Transit / fold** | movement between stops / a folded gap on the strip | |

- Dates: `Mon 9 Sep`, `6–10 Sep 2024`, 24 h `13:20`. Never `Sept`.
- Counters: `32 / 194` (card, lightbox), `stop 3 of 6`. Screen-reader text spells them out
  ("photo 32 of 194").
- **Title line 2** is static: `DEMO · 6–10 Sep 2024 · 194 photos`, in range mode `194 of 201 photos`,
  or after a zoom `in San Sebastián to Huesca · Mon 9 Sep`. Never the cursor time, the Playing state,
  flight labels, the undo chip or offline status (map and nav put those there; they move to the
  card, the stop label or the status slot). Line 2 sits inside the title button, so nothing in it
  can be its own target.
- **Card**: line 1 `13:20` large + `Mon 9 Sep`; line 2 place (`Yesa, Navarra`, `no location · near
  Yesa`, or during a long hop `✈ 2 h 10 · 1 040 km`); line 3 `32 / 194 · stop 3 of 6`. Tap = lightbox.
  The `Open photo` text and the right-aligned `112/194` both go.
- Title glyphs: name + `⌄` (opens Library), `⋯` right. No `≡`.

### 1.3 Gestures: one owner each

| Gesture | Owner | Everywhere else |
|---|---|---|
| Horizontal drag | strip (deck), lightbox pager, lightbox filmstrip (its own band) | map pans (MapLibre) |
| **Swipe up** | lightbox only: info sheet peek → open | Nothing else has one. Sliding the thumb up during a strip drag is the photo-step mode, not a swipe. The deck, card and sheets never drag |
| **Swipe down** | lightbox: closes to the cursor. With the info sheet open, the first ↓ returns it to peek, and a second ↓ closes | Sheets ignore swipes. They close by ✕, scrim tap or Back |
| Long-press **500 ms**, cancelled by an 8 px move | opens an **action sheet** (fixed bottom sheet, same component as ⋯): strip → Only this day / stop; Library card → open all photos in these dates / Share / Copy; Photos tile → Show on map / Share photo / Open | no anchored popover menus (preview's anchored menu becomes this sheet) |
| Long-press **350 ms** | only to arm a drag: Library month range | |
| Map long-press | none in v1. The pin peek is cut; the undo chip covers "I didn't mean to go there" | |
| Double-tap | lightbox zoom; MapLibre's own zoom | strip: none (V1 isn't chosen) |
| Pinch | map, lightbox | Photos density pinch waits until the compact grid ships |
| Edges | no app drag starts within 20 px of the left/right edge | |

### 1.4 Navigation and Back (one table; nav A1 is authoritative)

- Push: a Library pick from the owner root, a selection change, cluster/visit → Zoom to these
  days, Only this day / stop, Also here, album ⇄ all photos in these dates, Library over a trip,
  lightbox, sheets.
- Replace: a Library pick while Library sits over a trip, the view switch (`view=photos|story` in
  the URL, from phase 1; this amends F7), and `at`/`lb` from scrub, Play, ⏮ ⏭, lightbox steps and
  Story scroll.
- **Photos is a view of the trip, not a pushed screen.** It keeps the title block and the transport
  row. There is no `‹ Map` header (preview) and no `‹ Library · Photos` header (albums). Back from
  Photos leaves the trip, the same as Back from Replay. "Show on map" = switch the view to Replay
  and set the cursor.
- Drill-up is always the `‹` in the title, labelled by its destination ("Back to San Sebastián to
  Huesca"). It is not `← Back to trip` (map) and not `← Whole trip` (timeline). Timeline V1's
  strip-view unzoom, if it ever ships, is called `Unzoom strip`.
- Library header: `‹ Trip` (accessible name "Back to <trip>"), `Library`, and the DEMO chip or ⚙.
  **Search stays at the top** (albums), which overrides nav §D's bottom search: the range bar and
  the Library hint use the bottom, iOS Safari's own bottom URL bar would stack under a second bottom
  bar, and the iOS keyboard moves a bottom field anyway. `Library` stays the first row in ⋯ for
  one-handed users.
- No synthetic entries. A **single-photo album opens the trip** (card + one pin), not the lightbox.
  This overrides albums "Odd albums".
- **Default view** is chosen once, when album members arrive: Replay, or Photos if 0 rows have GPS.
  Until then the trip shows the loading state (§2). It never switches by itself after that first
  paint.
- **Next trip** order is chronological across Trips (`trips.ts`), whatever tab or route the trip
  was opened from.

### 1.5 Status slot

One position: centred, 12 px above the deck (in landscape, at the bottom of the map column),
44 px tall, ≤ 358 px wide, `role="status"`. **One occupant at a time**, in this priority order:

1. Transient notices, 3–4 s: `Link copied`, `That photo is no longer here`, `Offline · saved 2 h ago`,
   `Photos are loading slowly`.
2. Follow chip (stays until resolved).
3. Undo chip `↩ 13:00`, 4 s after a map seek.
4. First-zoom hint `Zoomed to Yesa · ‹ or Back returns`.

In the Photos view, the same slot holds the `↑ 16:57` / `↓ 16:57` cursor chip. Albums' "Link copied"
at the top of the map moves here, and nav's offline line in title line 2 does too.

### 1.6 Deck, Photos view, sheets

- **Replay deck height is constant: 230 px** = card 76 + strip 64 + transport 56 + safe area 34.
  It changes only on rotation or a text-size change (a resize). The map container is 0 → 614 at
  390 × 844, with `insets.b = 0`. The strip never hides during Play, and the card never collapses.
- **Photos view (phase 1)**: card and strip are hidden. The transport row holds the view switch,
  `Day 4 of 5 ▾` and the density toggle (when it ships). No ▶ and no ⏮ ⏭, because Play would move
  a map nobody sees. **Story (phase 2)** brings back ⏮ ▶ ⏭ (timeline §1.7), and `Day ▾` moves to a
  tap on the sticky chapter header. In Story the title is a solid bar above the docked map, not
  floating over it, so the docked insets stay 8/8/8/8.
- **End of Play**: ▶ becomes ↺. The stop label reads `End of trip`. The card slot becomes the end
  card: `5 days · 194 photos · 6 stops` + `Next trip ›` (+ `Get it for your Immich →` in the demo).
  A touch on the strip or on ⏮ restores the normal card. This merges nav A6, timeline §1.5 and albums'
  "Replay has no end", which was wrong.
- **Sheets** have fixed heights, **no grabber**, no drag physics, and close by ✕, scrim tap or Back.
  The lightbox info sheet keeps two fixed states (peek 88 px, open ≈ 60 %). Tapping the peek or
  swiping up on the photo opens it; Back, ✕ or swipe ↓ returns it to peek. No handle drag
  (decision §0: no draggable multi-snap sheet). Only the open state is a history entry.
- **ⓘ sheet** = Places list (map), legend, map attribution. `© OSM` opens it at the attribution.
- **⋯ sheet (trip)**, in this order: Library · Only Mon 9 Sep · 88 / Only Yesa · 41 · Album photos
  / All photos in these dates (radio rows with counts, shown only when the counts differ) · Share link
  · Open in Immich (owner) · Settings (owner) / About this demo & credits (demo).

### 1.7 Visual language

- **The map is dark in every theme in v1** (decision §4: no light basemap). The timeline and
  albums mockups draw a beige map in light mode. Only the chrome follows the theme.
- Map symbology everywhere is map V3: numbered stop badges, the current stop amber with its name
  chip, pins only inside the current stop. Count bubbles (V1) appear only in "All photos" or month
  selections, where they are stop clusters with a range (`4–9`).
- Follow / Fit / ⓘ: a vertical segmented pair plus ⓘ, bottom-right of the map (map §0), in
  portrait and landscape.
- Text ≥ 11 px, including the Follow/Fit labels (now 9.5–10.5 px in nav and map), the DEMO tag
  (10 px in map) and the album attribution (10 px).
- **Mockup callouts are pink/magenta in every file.** Nav and timeline use amber dots, the same
  colour and shape as the stop badges, so a reader can't tell annotation from UI (nav V1·2: callout
  "1" sits on map badge "1"). Callouts go on the frame margin where possible, never on top of the
  text they explain.
- ids: prefix `mk-<category>-`. `mk-tl-`, `mkmap-` and `mkp-` are unique today, but they break
  the convention the gallery relies on.

### 1.8 Landscape (one layout)

The map takes the left 58 % and has **no title over it**. The right column holds the title, then
the card, strip and transport row (nav A10). Map insets become t = 12 + safe area. Follow/Fit/ⓘ sit
bottom-right of the map column. Sheets open inside the column. Library and the lightbox go full
screen. **Photos (phase 1) goes full width** (justified rows; the map isn't shown). Story (phase 2)
uses the docked map as the left column. The lightbox info sheet becomes a 320 px right panel and
the filmstrip hides. The column's spare height under the transport row goes to a larger card
(96 px thumb), so it doesn't sit empty (it does in nav V1·4 and map V3·5).

## 2. Gaps: states nobody designed (owner in brackets)

| State | Required behaviour |
|---|---|
| **Cold trip screen** (deep link, members loading) [navigation, mockup required] | Title from `/api/albums`. The map shows a plain dark background, then `RouteSketch` once members arrive, then tiles. Card: thumbhash, or a skeleton before members. Strip: skeleton bars. ▶ is disabled with the text `Loading 194 photos…`; the demo pulse runs only once ▶ is enabled. The default view is decided here (§1.4) |
| **Demo relay rate limit (429)** [preview] | The media queue pauses for `Retry-After` (or 6 s), keeps thumbhash, and drops pending P3–P6. After 10 s throttled, the status slot shows `Photos are loading slowly` once per session. No error UI before that |
| **Preview / video fails** [preview] | Lightbox keeps the upscaled `thumbnail` and adds a `Couldn't load the full photo · Retry` chip under the progress bar. Video: poster + `Video unavailable`. Tiles that fail stay on thumbhash, with no broken-image icon |
| **Tiles fail / offline map** [map] | Route, stops and marker draw on the dark background (client data). A small `Map offline` next to `© OSM`. Follow and Play keep working |
| **Session expired behind the auth proxy** (owner) [navigation] | The proxy answers with a cross-origin 302, so `fetch` fails like offline. On an API failure, probe with `redirect: 'manual'`: an `opaqueredirect` result = signed out. Full-width notice `Signed out · Reload to sign in` (a link, so the proxy's login runs top-level). Don't show "offline" |
| **Index refresh changes the open selection** [timeline] | The cursor stays on its photo id. Counts, strip and stops update with no camera move. If the cursor's photo disappears, go to its nearest neighbour in time and show a status-slot notice |
| **Play on huge selections** (All photos, 41 802) [timeline] | Above 2 000 rows, Play steps by stop (dwell 1.2 s), not by photo, and the stop label says so. 350 ms × 41 802 is four hours |
| **Text size 200 %** [navigation] | The deck is measured at that size (constant per resize). The title wraps to 2 lines. The card keeps 3 lines and drops the thumbnail to 60 px. Mockup at 360 × 640 + 200 %, one screen |
| **Library search with the keyboard open** [albums] | The results list ends at `visualViewport` height. The range bar and hint hide while focused |
| **Rotation mid-gesture** [timeline, preview] | Cancel the gesture and keep the cursor. Lightbox zoom resets to 1×. Sheets stay open (in the column) |
| **Empty `from/to`** [navigation; albums uses it] | One text, in the card slot: `No photos 3–9 Mar 2021` + `‹ 28 Feb · 12` / `14 Mar · 40 ›` + `Library`. Albums' "Nearest: Aug 2026 (34)" variant goes |
| **First owner visit, empty IndexedDB** [albums] | Covered by the cold Library state. Add the owner `/` → Library while the index builds (minutes on 41 k photos) to the albums mockup as one screen |
| **Landscape mockups** [timeline, preview] | Timeline: strip in the 322 px column with the loupe left of the thumb. Preview: lightbox with the info panel. Neither is drawn |

## 3. Required fixes per category

### Navigation (`05-categories/navigation.md`, `mockups/navigation.html`)

Doc:
- A1: Photos/Story replace stays (accepted), and the doc now says so explicitly for phase 1. Add
  `Only this day/stop` (push) and `Also here` (push) rows.
- A4: the first-zoom snackbar goes to the status slot (§1.5), priority 4.
- A6: the end card follows §1.6 (the card slot, `Next trip ›` for owner and demo, Get it in the demo).
- A11: the offline status moves out of title line 2 into the status slot. Single photo: as written
  (this overrides albums).
- §D: drop "search field at the bottom" (§1.4). Keep `Library` as the first ⋯ row.
- Add the cold trip screen and the session-expired state (§2).

Mockup:
- **Data**: map clusters `52 / 41 Pamplona / 38` → V3 stop badges 1–6 with 14/41/47/92 (§1.1). The
  strip shows bars on **Sun 8** (0 photos) and has no folds: redraw it from the timeline's folded
  strip. Card `Yesa · 112/194` is wrong (Yesa is 15–55): use `13:20 Mon 9 Sep · Yesa, Navarra ·
  32 / 194 · stop 3 of 6`.
- **Library screens** (V2·3, V3) use invented stats (`2024 1 012 · 4 trips`, `2022`, Pamplona 268,
  Pyrenees 180, `98% GPS`, `210 km from home`). Use the albums card and demo numbers.
- V1·4 landscape: Follow/Fit/ⓘ is a horizontal row cut off at the map bottom → vertical stack
  bottom-right (§1.7). Fill the empty column space (§1.8).
- V2·2 ⋯ sheet: `Show: Album photos | All in these dates` segmented → the radio rows with counts.
  Callout dots cover "Show" and the row icons.
- Follow/Fit labels 9.5 px and the bottom-bar `small` 10 px → ≥ 11 px.
- Amber callouts → pink (§1.7).
- Add: a cold trip screen and a 360 × 640 screen (A9 collapse order).

### Timeline (`05-categories/timeline.md`, `mockups/timeline.html`)

Doc:
- §1.5 end of trip → §1.6 end card (the stop label reads `End of trip`; `Next trip ›` lives in the card).
- §1.6: the pill text "← Whole trip" → the title's `‹` + line 2 `in San Sebastián to Huesca`.
  Long-press 500 ms opens the shared action sheet (§1.3).
- §1.8 range bar: albums' form (`Mar – May 2025` / `3 months · 322 photos …` / `Cancel` · `Open
  range`). Drop `Show ›` + ✕. Keep "tap elsewhere cancels" and "back to the origin cell = single month".
- Add: Play on huge selections, index refresh under the cursor, rotation mid-drag (§2).
- V1 `⤢ Whole trip` → `Unzoom strip` if it is ever kept.

Mockup:
- **Light mode draws a beige basemap.** The map must stay dark (§1.7).
- Title `≡ San Sebastián to Huesca` → name `⌄` + `⋯`. Line 2 `DEMO · 6–10 Sep 2024 · 194 photos`
  (no `6 stops`; the card and the stop label carry stops).
- Transport: the single `Photos` button → segmented `Replay | Photos` (left), stop label right.
- Follow/Fit as separate amber-outline pills → map's vertical pair + ⓘ.
- "Show only part of this trip" sheet has a grabber → remove it.
- The `Bay of Biscay` label collides with the status-bar clock; move it.
- Callout dots sit on the strip bars and the card text; move them to the margin and make them pink.
- Add a landscape screen (§2).

### Map (`05-categories/map.md`, `mockups/map.html`)

Doc:
- "One map, four sizes": the container ends at the deck top, **0 → 614**, `insets.b = 0` (constant
  230 px deck). Drop "smallest/expanded deck" and "strip band may hide during Play".
- Landscape: no title over the map (§1.8), `insets.t = 12 + safe area`. ⓘ stays with Follow/Fit
  (not in the transport row).
- Undo chip and flight labels move out of title line 2 (§1.2, §1.5). The Follow chip lives in the
  status slot.
- `← Back to trip` → the title's `‹`.
- Long-press peek: cut from v1 (§1.3). Remove it from the answers table.
- V3 changes decision §0 ("cluster tap → visits sheet"): a *non-current* stop badge tap now seeks,
  and only the current stop opens the visits sheet. Accepted, but the lead must record the §0
  amendment, and the hallway test must include "find all photos taken at Yesa".
- Confirm the "visit" definition (§1.2); the albums designer asked.
- Add the tiles-fail / offline map state (§2).

Mockup:
- **Data**: 8 stops (`stop 5 / 8`, `5 · Yesa · 15`, `6 Javier · 12`, `3 · Olite · 22` on Sun 8) → the
  6 stops of §1.1. The strip shows bars on Sun 8 and no folds → the folded strip.
- `Sept` → `Sep`. Title line 2 shows the cursor time and `▶ Playing` → static line 2 (§1.2).
- Card `112 / 194` right-aligned, `stop 5 / 8` → §1.2 card format.
- Transport `Story` button (phase 1 frames) → `Replay | Photos`.
- V1·3 and V3·3 visits sheets: the list renders below the frame bottom and over the home indicator
  (`Sat 7 Sep · 11:15–17:40` bleeds past the bezel). Clip it and pad the safe area by 34 px.
- `mk-map-btn` 10.5 px, `mk-map-tag` / `mk-map-now` 10 px, badge 9 px → ≥ 11 px (the badge glyph may
  stay 9 px if it is `aria-hidden`).
- V3·5 landscape: title over the map → move it into the column (§1.8).

### Preview (`05-categories/preview.md`, `mockups/preview.html`)

Doc:
- §1.3 and §7: Photos is a view (replace); Back from Photos leaves the trip; "Show on map" = view
  switch + cursor. Remove "Back = sheet → lightbox → Photos → Replay".
- §1.4 info sheet: no handle drag. Two fixed states, toggled as §1.6 says.
- Lightbox counter `Stop 4 of 5` → `stop 4 of 6` (Huesca is two stops). Top bar `56 / 194 · stop 4
  of 6`. Drop `ⓘ` from the top-bar sketch, since the mockup and the peek already cover it.
- §1.5 long-press tile: the anchored menu → the shared action sheet (§1.3).
- §2 V1 day sheet / bottom bar: the bar *is* the transport row (§1.6). The `‹ Map` header goes.
- Add: 429 back-off, preview/video failure, rotation mid-zoom (§2).
- Phase 1 Photos in landscape is full width (§1.8), not "the right ~42 %".

Mockup:
- Photos header `‹ Map · San Sebastián to Huesca · ⋯` → the title block (name ⌄ / line 2).
  The bottom bar `Day 4 of 5 ▾ · density · map icon` → the transport row with `Replay | Photos`.
- Grabbers on the day sheet ("Jump to") and the info sheet → remove (the info sheet gets a tappable
  chevron on the peek instead).
- `Stop 4 of 5` / `Stop 5 of 5` → `of 6`. The day sheet's Tue 10 lists `Huesca 44` and `Huesca 48`.
- Add a landscape lightbox screen (§2).

### Albums (`05-categories/albums.md`, `mockups/albums.html`)

Doc:
- Card meta `194 · 4 stops` → `194 · 6 stops` (the mockup itself shows `4 no location`, which is
  right as a separate chip).
- Single-photo album → the trip, not the lightbox (§1.4).
- Search visit row inside an album: "Back again returns to the Library" is true only from the owner
  root. When Library was opened over a trip, the pick replaces Library, so Back goes to the previous
  trip (nav A2). Say both.
- "Replay has no end, so it uses the Library path" → wrong. Replay has the end card (§1.6).
  Next/previous order is chronological (`trips.ts`), not "the tab the trip came from".
- Empty month text → nav's single form (§2).
- Card long-press → the shared action sheet (it already is a sheet; keep it).
- Add the keyboard-open search state and the first-owner-visit screen (§2).

Mockup:
- **Light mode draws a beige basemap** in the ⋯ sheet frame → dark map (§1.7). Its stop badges
  `84 / 31 / 92` → stops 1–6.
- "End of Story/Photos" frame: header `‹ Library · Photos · DEMO` → the title block + transport row
  (Photos is a view).
- The ⋯ sheet has a grabber → remove it. Sheet order per §1.6 (Library first, Only this day/stop
  rows added).
- `Link copied` toast at the top of the map → the status slot.
- Range bar (V2·2) is the canonical form; keep it.
- `.al-attr` 10 px → 11 px.

## 4. What the review did not change

- The recommendations stand: nav V1, timeline V3, map V3 (with the §0 amendment), preview V1 +
  rail + lightbox 3a, albums V2 with the trips-first demo order.
- Open questions 1–10 in `04-decision.md` stay open. This review answers none of them, except that
  §1.4 makes `view` a phase 1 URL parameter (Q1 still decides the phase 2 default).
