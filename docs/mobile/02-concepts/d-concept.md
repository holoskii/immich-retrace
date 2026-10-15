# Concept D: Faithful port (tabs), revision 2

Mockup: [`../mockups/concept-d.html`](../mockups/concept-d.html) (root class `.mk-concept-d`).
Screens: `../screens/concept-d-{light,dark}.jpg`. Revision 1 described four tabs with an Overview
wave. This revision replaces it (see "Response to critique" and the changelog at the end).

## Core idea

Keep the desktop model intact (one selection, one time cursor, one zoom stack, one URL) and show it
through **three** full-height tabs: **Map / Photos / Trips**. Each tab is a different lens on the
same `selection` store. Switching tabs never changes state, only the view. The Map tab is the
product: map, docked photo card, time strip, transport, and **Narrow**, a range editor on the same
screen as the route, so "move time, watch the map" happens without switching tabs. Trips merges the
old Overview and Albums: search, year rows with month cells, and trip cards. The lightbox is a
full-screen pager over whichever tab opened it.

This is the low-risk baseline: no model or URL changes, the highest logic reuse, and links that
round-trip with desktop. A competing concept has to beat "the same app, made for a thumb".

## Opinions (where this concept commits)

1. **Map is the home tab.** Landing, a trip pick, a month pick and "Show on map" all end on Map.
2. **Time and place share one screen.** The strip, transport and Narrow all live on Map. There is
   no tab where you pick time without seeing the route.
3. **Grid scroll never moves the cursor.** Photos is a lens, not a scrubber; only a tap writes the
   cursor. (UX recommends the same rule for C.)
4. **No brush gesture on the phone.** Ranges come from discoverable controls: day chips, two 44 px
   handles behind an explicit Narrow button, month cells, trip cards, and cluster visits. There is no
   long-press-to-brush and no pannable wave.
5. **Stops are the unit below a day.** A shared, pure `stops.ts` (A's rule: break on >45 min, >2 km
   or a city change) drives ⏮ ⏭, the strip ticks and the Photos chapters.
6. **No hover, no gesture on chrome.** Each control does one thing on tap. The photo card doesn't
   swipe, and the context pill doesn't swipe.
7. **Exactly one MapLibre instance for the app's life.** The lightbox mini-map is a static SVG.
8. **The tab is not in the URL.** It is derived from state, so links stay the desktop contract.

## Layout (390 × 844 reference)

| Band | Height | Content |
|---|---|---|
| Status / safe area | 47 | OS |
| Map: floating two-line pill | 60, over the map | line 1: trip name only (16 px, full width minus ⋯). Line 2: `DEMO` tag · `6–10 Sept 2024 · 194 · Mon 9 · 13:00`. ⋯ (44 px) = Share, Clear to all years, About demo |
| Photos: collapsing header | 44 | name · count · ⋯. Tab bar hides on scroll down |
| Trips: large title + search | 52 + 44 | scrolls away |
| Tab bar | 49 + 34 | Map · Photos (badge = selection count) · Trips. Hidden in landscape and while scrolling Photos down |

Chrome budget: on Map, the pill floats over map content, so fixed chrome is 47 + 83 = 130 px (15%).
On Photos while browsing it is 47 + 44 = 91 px. Revision 1 had about 210 px on every tab.
The separate demo strip is gone; `DEMO` is a tag in the pill and the pitch lives in ⋯ → About.

## Tabs

### Map (home)
- Full-bleed map under the pill. Native pan and pinch, rotation off. Follow / Fit / ⓘ sit at the
  right edge mid-low in the thumb arc, 44 px each. ⓘ = legend sheet (date ramp, dashed = no GPS,
  whole-trip inset).
- **Dock** (≈ 206 px above the tab bar):
  - **Photo card**, tap only → lightbox. It shows time, place, `112 / 194`, and "Open photo ›". The
    image goes thumbhash → `thumbnail` while the cursor moves → `preview` after 300 ms at rest.
  - **Time strip**, a 36 px track plus day labels (11 px). Drag scrubs, tap jumps. ▾ ticks mark
    stops. It writes `at` with `replaceState` only (eng fact 8), so a flick never becomes a Back
    step. `role="slider"` with `aria-valuetext` "Mon 9 Sept 13:00, Yesa, photo 112 of 194". Arrow
    keys step a photo, Page Up/Down step a stop.
  - **Transport row**: `Narrow` · ⏮ ▶ ⏭ · current stop ("Yesa, stop 5 / 7"). ⏮ ⏭ jump stops.
    Play pulses once on the demo landing. To step by one photo, use the lightbox.
- **Cluster tap** → a fixed-height half sheet (no drag physics) with one row per visit ("Pamplona ·
  visit 2 · 14 Jul · 23", thumbhash strip). Tapping a visit = `zoomInto` its span (`from/to …T14:00Z`).
  The pill shows `← Back to trip`, and system Back returns. A pin tap = seek. Hit areas are padded to 44 px.
- **Narrow mode** (screen 2): the dock becomes a range editor. Readout (`10:20 → 18:40 · 61 photos ·
  58 with location · 3 without`), **day chips** (tap a day; tap a second chip to span), the strip
  zoomed to the picked day (07–21 h) with two 44 × 44 handles hung below the track, pinch on the
  track for finer zoom (`zoomAt`), and Cancel · `Album only ▾` · **Apply**. While the handles move,
  the in-range route draws bright, the rest dims, and the camera fits the range. Apply pushes one
  history entry, like a desktop brush.

### Photos
- A virtualised 3-column grid of the selection in time order, with a sticky **day header** (`Mon 9
  Sept · Leyre, Yesa, Javier · 41`), **stop chapters** (`Leyre 10:12–11:40 · 14`) and a 28 px
  **transit line** between stops (`25 min · 9 km · Leyre → Yesa`), from A.
- The cursor photo has an amber ring. "Cursor" (bottom-right) scrolls back to it, and entering the
  tab scrolls to it once. Tap = cursor + lightbox, long-press = "Show on map".
- No-GPS photos get a crossed-pin badge. This is the only place they are first-class.
- A right-edge fast scroller with a day bubble (16 px inset, 44 px hit width), shown only while
  scrolling.
- Alt text: "Leyre, Mon 9 Sept 10:40" (+ ", no location").

### Trips (replaces Overview + Albums)
- **Search**: trip name, year, or place (the index's `city`/`country` → the trips and months that
  contain it). Place search narrows to *time spans*. It doesn't filter rows, so the model stays
  contiguous.
- **Year rows** (from C): one 52 px row per year with a 12-month sparkline. Tap expands the year to a
  2 × 6 grid of month cells (≈ 52 × 66 px, count + density bar). Tap a month = month selection → Map.
  **Long-press + drag across cells** = a month range, shown with a live count in a range bar above
  the tab bar → "Show on map". "Whole year ›" selects the year. Empty months are dimmed and not
  tappable.
- **Trip cards**: cover, name, `6–10 Sep 2024 · 194 · 98% GPS`, and the verdict reason as text ("4
  nights, 310 km from home"). Tap = select + Map, one history entry. A `Trips | All albums` toggle
  sits in the section header.
- "All years" (top right) = clear.

### Lightbox (full-screen pager over any tab)
- Black, edge to edge, `preview` over thumbhash. Top: ✕, `112 / 194`, Share. A **day-segmented
  progress bar** (from A·4) sits under the top bar.
- Swipe ←/→ = `model.ts step` (replace history). Swipe ↓ closes to the opening tab; the cursor has
  moved, so Map is already there. Tap toggles chrome. Pinch or double-tap zooms; while the photo is
  zoomed, paging is off.
- An info sheet peeks 96 px: time + UTC offset, place. Dragging it up shows coords, a static SVG
  route with a position dot (`routeLines` + `gpsExtent`), credits (demo) and "Open in Immich"
  (non-demo).
- Video: native controls, muted autoplay. Preload ±1, ≤ 3 decoded previews, no second WebGL
  context.

## Main flow

1. **Open.** Demo `/` → "San Sebastián to Huesca", cursor mid-trip, Map, Follow on, Play pulses
   once. Non-demo with no query → Trips (nothing selected).
2. **Pick.** Pill or Trips tab → a trip card, a month, or a month range → Map.
3. **Move through time.** Drag the strip, ⏮ ⏭ by stop, or Play. The camera follows.
4. **Narrow.** Narrow → day chip → handles → Apply. Or tap a cluster → visit. Back undoes either.
5. **Find a photo.** Photos tab → fast scroller / chapters → tap → lightbox → swipe ↓ → Map shows
   where it was.
6. **Share.** ⋯ or lightbox Share → `navigator.share({url})`, falling back to copy.

## Gestures and conflicts

| Region | Owner | Gestures | Rule |
|---|---|---|---|
| Map canvas | MapLibre | pan, pinch, tap pin/cluster | only tap-only chrome floats over it |
| Photo card | card | tap | no swipe (removed: it sat 8 px above the scrub strip) |
| Time strip | strip | drag = scrub, tap = jump; Narrow: handle drag, pinch | `touch-action: none`, 12 px side insets plus the dock padding keep it off the OS back-swipe edge |
| Transport, chips, buttons | buttons | tap | ≥ 44 px |
| Photos grid | page scroll | vertical scroll, tap, long-press | `touch-action: pan-y` |
| Month cells | page scroll + cells | tap; long-press then drag = range | the drag only starts after the long-press timer, so scrolling still works |
| Lightbox | pager | swipe ←/→, swipe ↓, pinch, tap | zoom > 1× disables paging; the sheet drags only by its handle |

Each band has one horizontal owner. The Map tab's only horizontal drag is the strip.

## Desktop features mapped

| Desktop | Phone (D r2) |
|---|---|
| All-years strip | Trips year rows (sparkline) |
| Wave + brush | Trips month cells (coarse) + Map Narrow (fine). Any desktop range link still opens |
| Album rail / picker | Trips cards + search |
| Readout bar | pill (2 lines) + Narrow readout |
| Legend + inset | ⓘ sheet |
| Floating photo card | docked card |
| Visits menu / cluster hover | cluster sheet of visits → `zoomInto` |
| ←/→, Space, Home/End | strip slider keys, ⏮ ▶ ⏭ |
| `?` overlay, hint rows | dropped. The coach mark retargets to strip → Play → card |
| Lightbox side panel + mini-map | info sheet + static SVG route |

## URL state

The contract is unchanged: `from/to`, `album[&mode=range]`, `at`, `lb`. The tab is derived (`lb` →
lightbox over Map; a selection → Map; none → Trips) and tab switches add no history entries. On
mobile, `at` from scrub, Play or ⏮ ⏭ uses replace only. Selection changes (Apply, month, trip,
visit) push. Back closes the lightbox, then walks selections.

## Reused vs new

| Reused unchanged | Reused, new UI | New |
|---|---|---|
| `selection.svelte.ts`, index + IDB cache, `trips.ts`, `route.ts`, `camera.ts` + worker, `play.ts`, `landing.ts`, `thumbhash.ts`, `media.ts`, `format.ts`, `data.ts` (`zoomAt`), `lightbox/model.ts` | `draw.ts` density (strip, sparklines, day strip), `TimeStrip` (touch, replace-only), MapView → `MapCore` + phone chrome, AlbumPicker data → Trips | `actions.ts` (album pick/clear/mode out of Overview), Follower insets, tab shell, Narrow editor, `stops.ts`, Photos grid (virtualised), Trips year/month grid, cluster sheet, lightbox pager, static SVG route, share |

Groundwork that must come first (from eng §0): `actions.ts` (fact 1: otherwise the demo lands on
nothing because Overview isn't mounted), the `MapCore` split (2), Follower insets (3: top = pill 120 px,
bottom = dock + tab bar), `pixelRatio` ≤ 2 + `webglcontextlost` (4), replace-only scrub (8).
Interval refresh (7) and album-first boot (6) should land before the phone ships on cellular.

**Effort: S–M** after groundwork. The wave gestures from revision 1 are gone. What remains is new
DOM UI over existing logic: the grid, the pager, the Narrow editor and the month grid.

## Performance and data

- One map, mounted on the first Map visit, hidden with `visibility: hidden` on other tabs (never
  `display: none`, which makes `Follower.step` bail). Follow rAF stops while hidden. On show:
  `resize()`, re-request tiles (iOS kills workers, MapLibre #8461), snap the camera.
- The card uses `thumbnail` while moving and `preview` at rest, never a preview per scrub step.
- The grid uses thumbhash first, then `thumbnail` for visible rows only, with ≤ 6 requests in flight
  (demo relay: 120 req / 6 s). The 250 px thumbnail on ~126 px tiles is softer at DPR 3; that is
  accepted.
- The Trips tab paints names and dates from `/api/albums` right away. Sparklines, verdicts and GPS
  % upgrade when the index lands, with no per-card members fetch.
- Relative map fill ≈ 0.65 of the screen, the medium case. Measure Play for 60 s on a mid Android
  before shipping.

## Accessibility, motion, sizes

- Strip and day strip: `role="slider"` with value text. Narrow handles are two sliders. The month
  grid is a grid of buttons ("Aug 2024, 268 photos"). Cursor moves go to a polite, debounced live
  region. The map is `aria-hidden`; the pill and card are its text equivalent.
- `prefers-reduced-motion`: the camera jumps per stop instead of flying, there is no momentum, sheets
  snap without overshoot, and the Play pulse is off.
- Type ≥ 11 px for anything meaningful. Targets ≥ 44 px (revision 1's 32 px trip lanes and the ⓘ
  are gone or fixed).
- **360 × 640**: the pill keeps line 1 at full width. The transport row fits: Narrow becomes an icon
  (44), ⏮ ▶ ⏭ (148) and the stop name (ellipsis). The dock is ≈ 200 px, so the map keeps ≈ 230 px.
  Day chips shrink to 5 × 58 px.
- **Landscape**: the tab bar becomes a 64 px left rail, the map takes the left ~58%, and the dock
  becomes a right column (card, strip, transport stacked). Photos goes to 5 columns.
- Theme: the mockup shows light and dark per study rules. The phone ships dark-only like desktop.
  Light needs `draw.ts` tokens and a second map style (eng fact 10), so it comes later.

## Risks

- **Still a port.** It is clearer and cheaper than A–C, but it doesn't tell a story the way A does.
  Stop chapters and ⏮ ⏭ are the partial answer. A's Story could become a later "Read" mode on the
  same stores and `stops.ts`.
- **Narrow discoverability.** It is a labelled button, better than a long-press, but it is still an
  extra mode. Most range picking will happen through months, trips and cluster visits.
- **Hidden-but-alive map on iOS** needs the reload-on-show path tested on a device.
- **Photos may become the most-used tab** and pull the product toward "another grid". The chapters
  and the cursor link to Map are what make it Retrace's grid.

## Best at / worst at

- **Best at:** lowest cost and risk, every desktop capability reachable (including arbitrary ranges
  via Narrow), identical links, standard navigation, one gesture owner per band, and the best
  find-one-photo story next to C.
- **Worst at:** reliving a trip as a narrative (A wins), and one-handed replay purity (B wins).

---

## Response to critique

Sources: `03-critiques/ux.md` (UX) and `03-critiques/eng.md` (ENG). ✔ = accepted, ✘ = rebutted, ◐ = partly.

### Concept-specific

| # | Criticism | Verdict | What changed / why not |
|---|---|---|---|
| 1 | Split attention: Overview and Map never share a screen (UX, ENG) | ✔ | The Overview tab is deleted. Range picking moved onto Map (Narrow: day chips + handles, live route highlight) and Trips (month cells, then straight to Map). No surface picks time without the map visible or one tap away |
| 2 | The Overview wave is still a desktop control: hidden long-press brush, ~5 px/day, a rail that truncates in the mockup (UX, ENG) | ✔ | The wave, brush, trip rail, year chips and pan/pinch wave gestures are all gone from the phone. Desktop range links still open, and Narrow can produce any range |
| 3 | Overview and Albums overlap; four tabs is one too many (UX, ENG) | ✔ | Merged into **Trips**: 3 tabs |
| 4 | Collapse to one screen + a pushed picker, Photos opened from the card, no tab bar (ENG) | ✘ | Tabs stay. A pushed picker hides "pick another trip" behind Back semantics that already mean "previous selection". Photos as a tab is what makes find-one-photo and no-GPS photos discoverable (UX rated D "good" here, B "worst" for lacking it). The tab bar cost is mitigated instead: it hides while scrolling Photos and in landscape, and the Map pill floats |
| 5 | Chrome budget ~210 px / 25% (UX) | ✔ | The demo strip is gone (now a tag in the pill), the header floats on Map, collapses to 44 px on Photos, and the tab bar hides on scroll. Fixed chrome is 130 px on Map and 91 px while browsing Photos |
| 6 | The context header truncates the trip name (UX) | ✔ | Two-line pill: the name alone on line 1, everything else on line 2, ✕ moved into ⋯ |
| 7 | Card swipe and strip drag: two horizontal gestures 8 px apart (UX) | ✔ | The card is tap only. Stepping is ⏮ ⏭ (by stop) on Map and swipe in the lightbox (by photo) |
| 8 | No stop unit, weak reliving (UX) | ◐ | Added `stops.ts`: ⏮ ⏭, stop ticks on the strip, stop chapters and transit lines in Photos (from A). Rebut the rest: a narrative story is A's job. D stays a viewer, and A's Story can be added later as a mode on the same stores |
| 9 | The docked card loads `preview` on every cursor move (ENG) | ✔ | thumbhash → `thumbnail` while moving → `preview` after 300 ms at rest |
| 10 | Fact 1 hits D hardest: landing on Map with Overview unmounted means `albumRequest` never resolves (ENG) | ✔ | `actions.ts` is listed as the first groundwork item. With no Overview tab, nothing else can work without it |
| 11 | Hidden-but-alive map on iOS (ENG) | ✔ (already flagged) | Use `visibility: hidden`, re-request tiles + `resize()` + snap on show. Listed as a device test |
| 12 | Photos is an Immich-grid clone with a network cost (ENG) | ◐ | The cost rules stay (thumbnail only, ≤ 6 in flight). Rebut the "clone": it is the selection, in time order, with stops, the cursor link to Map, and no-GPS photos first-class, none of which Immich's grid does |
| 13 | Use B's fixed-playhead strip (ENG) | ✘ | UX rates "drag the film, not the playhead" as inverted for non-editors and the main discoverability tax in B. D keeps the direct-manipulation strip the desktop already has (thumb under finger) and borrows B's stop stepping instead |
| 14 | Steal C's place filter on cluster tap (UX) | ✘ for the filter, ✔ for the intent | ENG shows the place filter breaks the contiguous `Active` slice. The cluster sheet lists **visits**, and each one zooms to its span with `zoomInto`: same answer to "what did I shoot here", no model change. Place search in Trips also resolves to spans, not row filters |
| 15 | Steal A's lightbox progress and B's mini filmstrip (UX, ENG) | ◐ | A's day-segmented progress bar is added. B's mini filmstrip is rejected: it is a third horizontal strip, and Photos is one tap away |
| 16 | Brush / arbitrary ranges disappear in the fixes (ENG "drop the wave") | ◐ | The wave is dropped, but arbitrary ranges are kept through Narrow (a labelled mode, not a hidden gesture). Feature parity with desktop links is D's reason to exist |

### Cross-cutting (UX §1–6, ENG §0)

| Item | Verdict | Where |
|---|---|---|
| Screen readers | ✔ | "Accessibility, motion, sizes": sliders with value text, grid buttons, live region, alt text |
| Reduced motion | ✔ | Same section: camera jumps per stop, no momentum, no pulse |
| Landscape | ✔ | Left rail + map 58% + right dock column |
| 360 px / short phones | ✔ | Sizes given; the transport collapses Narrow to an icon |
| Type < 11 px, targets < 44 px | ✔ | Mockup labels are ≥ 11 px, every control is ≥ 44 px, the 32 px lanes are gone |
| ENG facts 2–4, 8 (MapCore, Follower insets, pixelRatio, replace-only scrub) | ✔ | "Reused vs new" → groundwork |
| ENG 6–7 (album-first boot, interval refresh) | ✔ | Required before shipping on cellular. Trips paints from `/api/albums` first |
| ENG 9 (offline SW) | deferred | Not specific to D. A small shell + thumbnail SW can come later |
| ENG 10 (dark only) | ✔ | The mockup shows both themes per the study rules. The phone ships dark |

## Changelog

- **r2 (2026-10-14)**: 4 tabs → 3 (Map, Photos, Trips). The Overview tab, wave, long-press brush and
  trip rail are removed. Added Narrow on Map (day chips, day-zoomed strip, 44 px handles, live
  route highlight, Apply/Cancel). Added the Trips tab (search incl. place, year rows → month cells
  with a long-press range drag, trip cards with verdict text, range bar). The pill is two lines with
  ⋯ in place of ✕, and the demo strip folds into a tag. The card is tap only; ⏮ ⏭ step by stop
  (`stops.ts`), and Play pulses on the demo landing. Photos gets stop chapters, transit lines, a
  collapsing header and a hiding tab bar. The cluster sheet lists visits → `zoomInto`. The lightbox
  gets a day-segmented progress bar. Added scrub replace-only, the thumbnail → preview rule, a
  groundwork list (`actions.ts` first), and a11y / reduced-motion / landscape / 360 px rules.
  Mockup redrawn: Map, Narrow, Photos, Trips.
- **r1**: four tabs (Overview, Map, Photos, Albums); the mockup showed Overview, Map, Photos and
  Lightbox.
