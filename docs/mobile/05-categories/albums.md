# 05 · Albums: Library, trips, search, ranges

Brief: `../05-briefs/albums.md`. Decision: `../04-decision.md` (§2, F2, F7, F9, F10, §6.3).
Review: `../06-review.md` (its §1 wins where this doc disagrees; see "Revised after review" at the end).
Mockup: `../mockups/albums.html` (root `.mk-albums`; sections `Variant 1/2/3`, Shared, States).
Screens: `../screens/albums.jpg` (light, 1400 px), `../screens/albums-{dark,light}.jpg` (pre-review). Demo data only (6 albums, 1 688 photos, 2023–2026,
from `/api/albums` and `/api/index`). Cards marked "illustrative" in the mockup show an owner
library shape, not demo data.

## 0. Common to all variants

These hold whichever variant wins. The variants differ only in how the list is organised.

**Screen.** Pushed, no tab bar. Header `‹ Trip · Library · DEMO`; owner home has no back and shows ⚙. Under it,
in this order: search (44 px), a quick row `[All photos · 1 688] [Custom dates ▾]`, and the
`Trips | All albums` segment (44 px). All photos and Custom dates sit at the top, so they are
always one tap from the top of the screen, at any library size.

**Paint order (never one members request per card).**

| Arrives | What it shows |
|---|---|
| `/api/albums` (or its IDB cache) | name, dates, count, `Shared` badge. Trips tab: span ≤ 45 days (the `shortAlbum` fallback) |
| month manifest | year rows and month counts (sparklines and cells show totals; GPS share is not known yet) |
| full index | verdict text, GPS / no-GPS split, stop count, 44 px route sketch, place search, and the confident Trips tab |

Covers: `AlbumSummary` has no cover. Proposal: add `cover` (Immich `albumThumbnailAssetId`) to the
summary, a server change of size S. Cards then load one `thumbnail` per visible card (≤ 6 in flight,
lazy), which is a media request, not a members request. Until it loads, or without the field: the
thumbhash of the album's first GPS row from the index, else a neutral tile.

**Card** (84 px, 68 px compact): cover 60 px · name (2 lines max) · `6–10 Sep 2024 · 194 · 6 stops` ·
verdict line · route sketch. Verdict text is the decisive part of `tripReason`:
`Trip · away 5 of 5 days · "Huesca"`. Non-trips say why: `Album · spans 12 months, not a trip`,
`Album · name is not a place`. When the album name ends in its own date range ("Pyrenees, 14–27
Jul 2024"), the card shows only "Pyrenees". This changes the display only. Search still matches the
full name. No-GPS photos show in text (`4 no location`, hatched chip), never by opacity.

**Card gestures.** Tap opens the album: Trip, default view, one history entry. Long-press (500 ms,
cancelled by an 8 px move) opens the shared bottom action sheet: *Open all photos in these dates*, *Share link*, *Copy link*. The same actions are in
the trip ⋯ sheet, so the long-press is a shortcut and never the only path.

**Search** (one field; results replace the list while it has text; ✕/Back restores list + scroll):
- Groups, in order: **Trips** (name, accent/case-folded, word prefix) · **Places** · **Years**
  ("2024" → that year, "sep 2024" → that month).
- **Place** rows come from index `city`/`country`. Each place gets a header row: `Huesca` /
  `Aragón, Spain · 2 visits · 106 photos`. The header expands and collapses its visits. It is not a
  filter, and it opens nothing on its own.
- A **visit row** reads `Tue 10 Sep 2024 · 92` / `in San Sebastián to Huesca`, plus 2–3 thumbhash
  thumbs. A visit is a `stops.ts` stop whose place is that city, the same unit as the map's visits
  sheet (one definition for both). Tap behaviour:
  - Inside an album: open the album, then `zoomInto` the visit span. Two entries: Back widens to the
    trip. The next Back depends on how the Library was opened (nav A2):
    - Library is the owner root (`/`): the pick was a push, so Back returns to the Library.
    - Library was opened over a trip: the pick replaced the Library entry, so Back returns to the
      previous trip.
  - Outside every album: `from…T…Z&to…` with the cursor on the visit's first photo.
- Before the index: the Places group says "Places appear when the library index loads · 12 of 33
  months". Names and years already match.
- Empty: `Nothing for "bilbao"`, a line naming what search covers, and chips for the newest year,
  the most-photographed city, and Clear.
- Search always covers all albums, whatever the segment says. Trips are listed first.
- **Keyboard open.** The field stays at the top (review §1.4), 16 px text (no iOS focus zoom). The
  results list ends at `visualViewport.height` and scrolls above the keyboard. While the field is
  focused, the range bar and the Library hint hide. The keyboard's search key only blurs the field;
  results stay. Scrolling the results also blurs it. Back closes the keyboard first, then clears.

**Year rows / month cells.** One 56 px row per year: year, `830 photos · 3 trips`, 12-bar
sparkline (√count; GPS solid, no-GPS hatched), chevron. The whole row toggles. An open year shows a
**2 × 6 grid of month cells**:
- Size: 54 × 56 px at 390 wide, 52 × 56 at 360. The whole cell is the target.
- Contents: month, count, √ bar.
- Marks: a green top tick when the month holds a trip; a ring when the current selection is in it.
- Empty month: `0`, a ruled background, `aria-disabled`, and not a target.
- Future months: `·`.

Year as a selection = the search result "2024" (not a row tap, so the row has one meaning).

**Range: long-press-drag.**
1. Hold a month for 350 ms. The cell lifts (`navigator.vibrate(10)` where it exists; iOS has no
   haptic), and page scroll stops.
2. Drag in reading order across the grid. A bubble above the finger shows `Mar – May 2025 · 322`.
3. Near the top or bottom edge the page auto-scrolls into the next open year, so cross-year ranges
   work.
4. On lift, the **range bar** stays (fixed, above the home indicator): `Mar – May 2025` /
   `3 months · 322 photos (19 without location) · 2 trips inside` / `[Cancel] [Open range]`.
   Open = `from/to`, one history entry. A move before 350 ms scrolls as usual.

**Discoverability.** The long-press is hidden. Mitigations:
- a hint line under the first open grid ("Tap a month to open it · hold, then drag for a range")
  until the first range is made (localStorage, fail-safe);
- Custom dates always visible at the top;
- the range bar teaches what happened.

The F8 coach budget ("at most one hint") is for the trip screen. The Library hint is static text,
not a coach mark, so it does not count against it.

**Custom dates** expands in place (no sheet): two native `<input type=date>` side by side, then a
live summary (`Fri 6 – Tue 10 Sep 2024 · 5 days · 201 photos · contains San Sebastián to Huesca`),
then `Open these dates`.
- Width at 360 px: 360 − 32 gutter − 24 panel padding = 304, so 2 × 147 with a 10 px gap. That fits
  "06/09/2024" at 16 px. 16 px also prevents iOS focus zoom.
- Prefilled with the current selection's days. min/max = the library's first and last day.
  To < From swaps them.
- At 200 % text the inputs stack: one per row.
- This is the a11y path for every range, and the only path to day precision and cross-year ranges
  in the Library.

**Album vs "all photos in these dates".** Lives in the **trip ⋯ sheet** as two radio rows with
counts: `Album photos · 194` and `All photos in these dates · 201 (+7 not in the album)`. This is
`mode=range`. The rows show only when the counts differ, and title line 2 then reads `194 of 201 photos`. On
the Library card it is the long-press action only, so the card stays one target.

**Share** (F9) = the trip ⋯ sheet `Share link`: `navigator.share({url: location.href})`. Without Web
Share it copies and shows `Link copied` in the status slot (review §1.5). The Library itself has no share button (no
selection to share). The card long-press shares that album's link. Owner mode: label "Copy link"
(open question 5).

**Previous / next trip: no new control.** Order is chronological across Trips (`trips.ts`), whatever
tab or route the trip was opened from. Demo: Pyrenees → Pamplona & Basque Country → San Sebastián to
Huesca → Sète, Lyon & Dole → Alsace & Freiburg → Lisbon & Queluz.
- Library: the current trip's card says *Now viewing*, is highlighted, and is scrolled into view on
  open. In the Trips list (newest first) the card above is the next trip, the card below the previous.
- End of Play (Replay): ▶ becomes ↺, the stop label reads `End of trip`, and the card slot becomes the
  end card: `5 days · 194 photos · 6 stops` + `Next trip ›` (+ `Get it for your Immich →` in the
  demo). A touch on the strip or ⏮ restores the normal card (review §1.6).
- End of the Photos view: two 56 px buttons after the last tile, `‹ Previous trip · Pamplona & Basque
  Country` / `Next trip › · Sète, Lyon & Dole`. Photos is a view of the trip, so the title block and
  transport row stay; there is no `‹ Library · Photos` header.
- Each is a push; Back returns. No ‹ › on the title and no swipe (the critiques removed both).

**Odd albums.**

| Case | Card | Trip screen |
|---|---|---|
| Non-trip (birthday, "Best of", a person) | All albums only; verdict says why | normal; stops and transits as usual |
| Very long (> 45 days, e.g. 7 years) | `3 Mar 2019 – 2 Oct 2025 · 7 years · 210` | opens normally. Title line 2: span + count. The strip/stop logic is the timeline brief's problem. The Library adds nothing special |
| No GPS at all | hatched `No location`, dashed empty sketch, "opens as Photos" | **opens on Photos**, not on an empty map. The default view is chosen once, when album members arrive (0 GPS rows → Photos), and never switches after (review §1.4). Replay stays one tap away with a centred notice "None of these 210 photos have a location" |
| Mostly no GPS | `4 no location` in meta | normal; the count stays in the sheet subtitle / ⓘ |
| Single photo | dot sketch, `1 photo`, no stops | opens the trip like any album (card + one pin). No auto-opened lightbox: that would need a synthetic history entry (review §1.4). Tap the card for the lightbox |
| Empty album (`count 0`, dates null) | not listed | — |
| Shared album holding photos the library lacks | `Shared` badge; the count can exceed its month's count (Pyrenees 97 vs Jul 2024 88) | members index (eng fact 6), as desktop |

**States** (specimens in the mockup):

| State | Library shows |
|---|---|
| Cold, index loading | names/dates/counts at once. Banner `Loading library · 12 of 33 months` + bar. Verdict lines as skeleton bars, no sketches. Year rows from the manifest |
| Warm, refreshing | one-line `Updating library · 21 of 33 months` with progress. Cached verdicts stay |
| Index failed, albums OK | `Couldn't load the library index. Trips open, but verdicts, places and months are missing. [Retry]` |
| Albums failed, index OK | year rows and Custom dates work. The Trips section says `Albums didn't load [Retry]` |
| Offline with cache | `Offline · library as of Tue 14 Oct, 09:12`. Everything cached opens; uncached thumbnails stay thumbhash |
| Nothing reachable, no cache | `Can't reach your library` + Retry now (auto-retry 30 s) |
| No albums | `No albums yet. Retrace reads albums from Immich.` + All photos / Custom dates; year rows below |
| Empty range (deep link only, since empty cells aren't targets) | navigation's single form, in the trip's card slot: `No photos 1–29 Feb 2024` + `‹ 27 Jan · 2` / `16 Mar · 4 ›` + `Library` (day counts illustrative). No "Nearest months" variant |
| First owner visit, empty IndexedDB | owner `/` opens the Library (no back, ⚙). Banner `Building your library index · first visit only · 14 of 96 months` + bar; minutes on 41 k photos. Albums paint from `/api/albums`, year rows and month cells from the manifest (counts, neutral bars). The Trips tab reads `Albums ≤ 45 days` (`shortAlbum` fallback) until the index lands; verdicts, stop counts, sketches and places fill in place, no reorder |
| Search, keyboard open | see Search above |
| Search, no results / before index | as above |

**Landscape** (844 × 390, same shell): two columns.
- Left: search, quick row, and years, with one row of 12 cells (≈ 58 px each).
- Right: trips or search results.
- The range bar spans the right column.
- No remount. Safe-area insets on both sides.

**Accessibility.**
- Library is a DOM list: `h2` per year, and the year row is a `button[aria-expanded]`.
- Month cells are buttons labelled "September 2024, 294 photos, 12 without location, includes San
  Sebastián to Huesca". Empty cells are `aria-disabled`.
- Range drag has a non-gesture equivalent: Custom dates. Screen readers get a "Select range" custom
  action on month cells (rotor/actions menu), giving a tap-start, tap-end mode with a polite live
  region ("Mar to May 2025, 322 photos").
- Results announce their count. Back restores focus to the card that opened the trip.
- At 200 % text: cards wrap, the grid becomes 3 × 4, and the date inputs stack.
- Reduced motion: no lift animation, no auto-scroll easing.

**Plugs into.**
- Navigation: Library push/replace and Back (A1, A2), `Now viewing`, the end card's `Next trip ›`,
  end-of-Photos prev/next, the no-GPS → Photos default, the empty-range form.
- Timeline: every result sets the selection; the strip takes over.
- Map: visits from `stops.ts` are shared with the visits sheet. "Also here" rows and Library place
  results use one query (`city` → stops).
- Status slot (review §1.5): `Link copied` and the offline notice live there, not over the map.
- Groundwork: `actions.ts` (`pickAlbum`, `setMode`, clear), album-first boot, interval refresh.

## Variant 1 · List-first (D r2 Trips)

**Idea.** Search, quick row, segment, then trips newest first with thin sticky year dividers
(`2024 · 3 trips`). "Browse by month" (collapsed year rows) comes after the last trip.

**Screens.** 1a Library (demo, pushed, *Now viewing* highlighted) · 1b Search "hues" (Trips /
Places with visits / Years) · 1c All albums, owner home, index refreshing (non-trip, 7-year, no-GPS,
single-photo, skeleton card).

**Scale.**
- 6 trips: the whole list fits on one screen, and it is the best first impression for the demo.
- 150 albums: the trip list is ~12 000 px. Sticky dividers keep the year visible, but the months
  section ends up at the very bottom, and month or range picking becomes "search or scroll forever".
  A "Months" jump would help, but it adds a control to fix the layout.

**Edge cases.** Slow network: cards are usable from the first response. The year dividers come from
album dates, so they need no index.

**Verdict.** Best for the demo and for small libraries. Weak once trips outnumber a few screens:
time browsing becomes second-class.

## Variant 2 · Years-first (C rev. 2 / A v2 Home)

**Idea.** One 56 px row per year (sparkline). An open year shows its 2 × 6 month cells, then its
trips (compact cards).
- Owner: the newest year and the year of the current selection start open; the others are
  collapsed.
- Demo: all four years open.
- On open, the Library scrolls to the current selection's year.

**Screens.** 2a scrolled to 2024 with Sep ringed, the empty Feb, trips under it · 2b long-press-drag
Mar–May 2025 with bubble and range bar · 2c Custom dates expanded, years collapsed.

**Scale.** 20 years = 20 × 56 = 1 120 px collapsed, about 1.4 screens. The scrollbar is the
timeline, every year is one tap away, and an open year with 7 trips is about 120 + 7 × 68 ≈ 600 px.
The cost: "my last three trips" spans two years when a year has just started. The newest year being
open by default covers most of that, and search covers the rest.

**Edge cases.**
- A trip that crosses New Year is listed under its start year, and its month tick shows in both
  years.
- Albums with null dates are not listed.
- Year rows paint from the manifest before the index, with totals only.

**Verdict.** Scales, and puts months/ranges and trips in one structure (the decision's F2 in a
single list). The demo is slightly less immediate than variant 1 (one grid above the cards). Taking
the trips-first order for the demo fixes that (below).

## Variant 3 · Map of trips on top (C·4)

**Idea.** A 347 px map (incl. status bar) with one marker per trip at its GPS centroid. Markers are
clustered (`3 trips` bubble), and unclustered markers show the cover. The list (variant 1) is below.
- Panning filters the list only: chip `In view · 3 of 6 ✕`. ✕ fits all trips and clears the filter.
- Marker tap scrolls the list to the card and rings both. The card opens it (two taps by design).
- Cluster tap zooms.

**Screens.** 3a all trips (cluster of 3 over Navarre/Aragón, Lisbon, Sète–Lyon, Alsace) · 3b panned
to the Pyrenees with the chip.

**Cost.**
- Centroids need the **full index**. On a cold visit the map stays empty for seconds, which is the
  first thing the owner sees.
- §6.2 allows **one WebGL context**. The Library map must therefore *borrow* the trip's MapLibre
  instance: re-parent the canvas, swap sources, and save/restore the camera, Follow state and
  insets on every Library open and close. That is the riskiest part, and it runs on the most
  frequent navigation.
- A second clustered GeoJSON source, plus `addImage` covers (≤ 12, re-added on `style.load`), plus
  thumbnail requests.
- Panning as a list filter is a third filter axis on top of search and the segment, and no-GPS
  albums silently vanish from a filtered list.

Effort M on top of the Library, with risk concentrated in the map hand-off.

**Value.** "Where have I been" across years. The cheap substitute: **All photos** (quick row) opens
the whole library on the trip map with its existing photo clusters. Cluster → visits sheet → "Also
here" trips answers "which trips went here" with zero new systems.

**Verdict.** Not v1. Revisit only if owners ask for a trips map after using All photos + place
search.

## Recommendation: Variant 2 (years-first), with the trips-first demo

1. **It scales without a second mechanism.** 150 albums / 20 years stays a 1.4-screen index of
   years, and every month/range target is in the same list as the trips. Variant 1 needs a jump
   control to reach months at that scale, and variant 3 is variant 1 with a costly map on top.
2. **One structure carries F2 whole.** Time browse (sparklines → cells → range drag) and trips share
   rows. "Trips of 2024" and "Sep 2024" are the same place on screen, which is how people remember
   trips (by year).
3. **Demo stays immediate.** Demo shows all four years open with trips *above* each year's grid, so
   the six cards fill the first screen as in variant 1. The owner gets grid-then-trips for the
   current year. Same component, an order flag.
4. **Cheapest to make honest.** Year rows paint from the manifest, cards from `/api/albums`.
   Nothing waits on the full index except verdicts, sketches and places, which are upgrades.

Keep from the other variants: variant 1's search result layout, card, and All albums states (all
shared). Variant 3's ideas move to existing surfaces: the "Also here" row and place search.

## Open points for other categories / the owner

- Settled by the review: no-GPS albums open on Photos (§1.4); single-photo albums open the trip, not
  the lightbox (§1.4); visit = a `stops.ts` stop matched by `city`, shared by the visits sheet,
  "Also here" and place search (§1.2).
- Server: add `cover` (`albumThumbnailAssetId`) to `AlbumSummary`.
- Owner: stripping the date suffix from album names on cards (display only).

## Revised after review

Per `../06-review.md` §3 Albums, plus the cross-cutting §1 decisions.

Doc:
- Card meta `194 · 4 stops` → `194 · 6 stops` (canonical 6 stops, §1.1).
- Single-photo album opens the trip (card + one pin), not an auto-opened lightbox: no synthetic history.
- Search visit row: Back after the zoom returns to the Library only from the owner root; when the
  Library was opened over a trip, the pick replaced it, so Back returns to the previous trip.
- "Replay has no end" was wrong: End of Play has the end card with `Next trip ›`. Previous/next order
  is chronological (`trips.ts`), not the tab order.
- Empty month → navigation's single empty-range form, in the card slot.
- `Link copied` → the status slot. "Pill" → title line 2. Card long-press = the shared 500 ms action sheet.
- Added: keyboard-open search state and the first-owner-visit state.

Mockup (`../mockups/albums.html`, same root `.mk-albums`):
- Maps are dark in both themes (the light basemap tokens are gone; Variant 3 included). The ⋯ sheet
  frame uses map V3 badges for stops 1–6 (`1–2` and `5–6` merge at fit zoom; current stop 3 Yesa with
  its name chip) instead of `84 / 31 / 92`.
- ⋯ sheet: no grabber, ✕ added; rows in §1.6 order: Library · Only Mon 9 Sep 88 / Only Yesa 41 ·
  Album photos / All photos in these dates · Share link · About this demo & credits.
- New "End of Play" screen: end card in the card slot, `↺`, `End of trip`, `Link copied` in the
  status slot, Follow/Fit/ⓘ vertical bottom-right.
- "End of Story/Photos" → "End of the Photos view": title block + transport row (`Replay | Photos`,
  `Day 5 of 5 ▾`), cursor chip in the status slot, prev/next chronological. The empty-month block
  moved to the States specimens in navigation's form.
- New screens: Library search with the keyboard open; first owner visit while the index builds.
- Search "hues" data → canonical (Huesca 2 visits · 92: stop 5 · 44, stop 6 · 48).
- Range bar (V2·2) unchanged, as the canonical form. `.al-attr` and the cluster sub-label → 11 px.
