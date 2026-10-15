# 04 · Decision: Retrace on a phone

Inputs: `01-research/` (current app, patterns), `02-concepts/{a,b,c,d}-concept.md` (v2, with the
critique responses), `03-critiques/{ux,eng}.md`, revised mockups (`mockups/concept-*.html`,
`screens/concept-*-{light,dark}.jpg`). Demo data only.

## 0. What the revisions already settled

After one critique round the four concepts converged on a shared core. These are no longer open:

- **The trip screen is map on top + a fixed deck in the thumb zone**: docked photo card, a
  horizontal time strip, ⏮ ▶ ⏭ by stop. Drawn four times (A·3 Explore, B·2/3, C·1, D·1).
- **No brush, no wave, no draggable multi-snap sheet** on the phone. Ranges come from trips,
  months, month ranges, cluster visits, deep links.
- **Cluster tap → fixed-height visits sheet → `selection.zoomInto`**. No non-contiguous place
  filter (it breaks `Active = lo..hi`; eng §C, verified by C rev. 2).
- **`stops.ts`** (place + time unit) drives ⏮ ⏭, strip ticks, chapters, transits.
- **Lightbox = full-screen pager**: swipe ←/→ steps, swipe ↓ closes to the cursor, pinch zoom
  disables paging, info sheet with a static SVG route, no second MapLibre.
- **URL contract unchanged**; `at` written with `replaceState` only on the phone.
- **One web app**, a lazy mobile shell; no native app.

The decision below is about what sits around that core, and what the default view of a trip is.

## 1. Scoring

1–5 per criterion (5 best), concepts as revised (v2). Weights reflect what a phone is for:
showing and reliving a trip, often to someone else.

| Criterion (weight) | A Story | B Filmstrip | C Map + deck | D Tabs | **Chosen hybrid** |
|---|---|---|---|---|---|
| Reliving a trip (×3) | 5 | 4 | 3 | 3 | **5** |
| Finding a photo (×2) | 3 | 3 | 4 | 4 | **4** |
| One-handed use (×2) | 4 | 5 | 4 | 4 | **4** |
| Demo first impression (×2) | 4 | 4 | 4 | 3 | **5** |
| Feasibility / effort (×2) | 2 (L, spike-gated) | 3 (M, custom film physics) | 3 (M) | 4 (S–M) | **3** (M phase 1, L total) |
| Reuse of current code (×1) | 3 | 5 | 4 | 5 | **4** |
| **Weighted (max 60)** | 44 | **47** | 43 | 44 | **51** |

Reasons for the scores that decide it:
- A reads a trip best (chapters, stops, transits, a map that holds per stop) but lands as a photo
  page: the route animation, the product's hook, is a mode away, and its camera link is unproven.
- B has the cleanest one-handed replay and the closest fit to the engine (`cursor` +
  `markScrub`, `play.ts` unchanged), but the fixed playhead is an editor idiom and needs a coach.
- C's best ideas (place search, "Also here", year rows) are portable; its own shape is the D Map
  tab with a costlier full-screen map.
- D is cheap and complete, and its Map tab is the best single screen in the study, but the tab
  shell splits the product into lenses and its Narrow mode is a brush with extra steps.

## 2. Decision: "Replay + Story", one stack, no tab bar

Two views of the **same trip** (same selection, same cursor), a pushed Library, and the shared
lightbox. Built in two phases; phase 2 is gated by a device spike.

```
Library (home)  ──tap trip / month / range / search hit──▶  Trip
                                                           ├─ Replay view  (map + deck)      phase 1, default
                                                           └─ Story view   (A's reading page) phase 2, spike-gated
Trip ──tap card / tile──▶ Lightbox (pager over either view)
Trip ──tap cluster──▶ Visits sheet ──Zoom to these days──▶ Trip (narrowed; Back returns)
```

### What comes from where

| Part | Source | Notes / changes |
|---|---|---|
| Stack navigation, Library as a pushed screen, no tab bar | B v2, C rev. 2, eng "ship one" | D's tabs rejected (§4). Trip title tap → Library. |
| Library: search incl. places, trip cards with verdict text | A·1, B·1, C·4, D·4 | Paints from `/api/albums`, upgrades when the index lands. |
| Library: one row per year, 12 month cells, tap = month, long-press-drag = range | C (year rows), D r2 (expand to 2×6 cells, range bar) | Full-cell hit areas ≥ 44 px. |
| Library: Custom dates (two native date inputs) | B v2 | The accessible, non-gesture path to an arbitrary range. |
| Replay view layout: floating two-line pill, full map, Follow/Fit in right thumb arc, fixed deck | D r2 Map tab (layout), C rev. 2 (fixed deck, camera insets) | Deck never drags. ⓘ legend sheet from D. |
| Docked photo card, tap only | D r2 | thumbhash → `thumbnail` moving → `preview` after 300 ms rest. |
| Time strip with stop ticks, ⏮ ▶ ⏭ by stop, Play pulse on demo landing | D/C strip, B transport | Strip type (thumb-under-finger vs fixed playhead vs B's film) is a timeline-brief variant; default bias: thumb-under-finger (reuses `TimeStrip`, no coach needed). |
| Cluster → fixed visits sheet: Zoom to these days (`zoomInto`), Jump here (seek), "Also here" other trips | D/A (visits + zoomInto), A ("Jump in story"), C ("Also here" by index `city`) | No place filter, no `near`. |
| Pin tap = seek; pan/pinch pauses Follow, "Follow" pill resumes | desktop rules, all concepts | Hit radius padded to 44 px. |
| Story view: day chapters, stop headers, justified rows, transit breaks, left spine for the current row, docked passive map that frames the current stop and flies only across transits | A v2 | Phase 2. Same transport bar as Replay; view switch in the bar. |
| Phase 1 "Photos" screen = Story layout **without** the map link (scroll never moves the cursor; tap sets it) | D r2 / C rev. 2 rule, A layout | One component (`storyLayout.ts`); phase 2 adds the docked map and turns on scroll → cursor. |
| Lightbox: D's rules + A's day-segmented progress + stop-segmented filmstrip (variant) | D r2, A v2, B v2 | Filmstrip in the lightbox is a preview-brief question. |
| Groundwork: `actions.ts`, `MapCore` split, Follower insets, `pixelRatio ≤ 2` + context loss, static SVG mini-map, replace-only `at`, album-first boot, interval refresh | eng §0 | Prerequisite for anything. |

### Why this shape

1. **Replay is the default trip view in phase 1** because it is the consensus core (all four
   concepts drew it), it is the cheapest to make good (D's estimate S–M after groundwork), and it
   puts the route animation on the landing screen. A demo visitor sees the product move after
   one tap on a pulsing ▶.
2. **Story is the second view, not a hidden mode**, because reliving is the top-weighted job and
   only A does it well. The view switch is a labelled control in the transport bar, not "tap the
   map". In Story, tapping the docked map switches to Replay (A's Explore), so both directions
   are one tap.
3. **The Photos screen and Story are one component.** Phase 1 needs a way to find a photo (B v1
   failed without it); building it as A's layout means phase 2 adds a map link, not a new screen.
4. **No tabs.** The only top-level places are Library and the trip; a tab bar spends 83 px to
   switch between two things, and D's own lenses (Map/Photos) become the two trip views here.
5. **The strip stays direct-manipulation by default**, with B's film as the alternative the
   timeline designer must test. It is the one place where the critiques disagree (eng: fixed
   playhead; UX: inverted for non-editors), and it is a swappable band, not a shell decision.

### Defaults

- **Demo `/`**: Trip, Replay view, "San Sebastián to Huesca", the desktop landing photo, Follow on,
  not playing, ▶ pulses once. Library is one tap (title) away.
- **Owner, no query**: Library, scrolled to the newest year.
- **Deep link** with `album`/`from-to` (+`at`, `lb`): Trip, Replay view (phase 1). Phase 2 adds an
  optional phone-only `view=story`; desktop ignores it.

## 3. Runner-up kept: B v2, the filmstrip deck

If phase 1 testing shows the thumb-under-finger strip is too coarse (≈ 1.3 px per photo for 194
photos on a 250 px track) or that people want to see frames while scrubbing, B's two-level film
(Stops / Photos, fixed playhead, detents at cuts) replaces the strip band in the deck. Everything
else in the hybrid stays: B already uses the same pill, card, transport, Library and Grid. B is
also the fallback shape if Story fails its spike and the product needs a stronger replay instead.

## 4. Rejected

| What | From | Why |
|---|---|---|
| Place filter (`near`, non-contiguous active set) | C v1 | Breaks `lo..hi` in lightbox, Play, `stepRow`, density, camera track; desktop doesn't know it. "Also here" + visits + place search keep the value. |
| Draggable 3-snap bottom sheet with a nested grid | C v1 | Fragile on iOS Safari (rubber-banding, `dvh`, scroll handoff); Immich's own crash. Fixed deck + pushed screens instead. |
| Tab bar shell (Map / Photos / Trips) | D r2 | 83 px of chrome to switch between two trip views; Back semantics stay simpler with a stack. D's Map tab survives as the Replay view. |
| Overview wave + brush, long-press brush, 7 px grips | D r1, desktop | Desktop control at 5 px/day; undiscoverable on touch. |
| D's Narrow range editor as a v1 requirement | D r2 | A brush with extra steps; Custom dates + month ranges + cluster zoom cover ranges. Kept as a timeline-brief variant only. |
| Years level, ruler, In/Out marks, tap-to-centre, 3-way level segment | B v1 | Already dropped by B v2; listed so they don't return. |
| Reading line, tile ring, right-edge day scrubber, Play on long-press | A v1 | Already dropped by A v2. |
| Second MapLibre instance (lightbox mini-map) | current app | iOS WebGL limits; static SVG from `routeLines` + `gpsExtent`. |
| Native app / Flutter | — | Forks the stores, URL contract, local-day math and camera that took the most review. |
| Light basemap in v1 | mockups | Needs `draw.ts` tokens + a second map style + re-adding layers on `style.load` (eng fact 10). |
| Auto-advancing "memories" video with music | patterns §2, §6 | Wrong default for a personal archive; Play covers replay. |
| Library map of trips (C·4) in v1 | C rev. 2 | Needs the full index for centroids, a second clustered source and thumbnail images. Kept as an albums-brief variant, not a requirement. |

## 5. Open questions for the owner

1. **Default trip view after phase 2**: keep Replay as default, switch to Story, or remember the
   last-used view per device?
2. **Strip type**: accept the timeline designer's recommendation after a hallway test, or decide
   now between thumb-under-finger (reuse) and B's fixed-playhead film (precision, frames visible)?
3. **Stop thresholds**: A's rule (> 45 min, > 2 km or city change; merge < 3 photos) vs B's coarser
   one (> 3 h or > 15 km; merge < 4). Needs tuning on the private library, which only the owner can
   look at.
4. **Server thumbnail size**: 250 px is soft on ~130 css px tiles at DPR 3. Raise Immich's thumbnail
   size on the owner's instance, or accept soft tiles?
5. **Share in owner mode**: a link to a private Retrace only works for people with access. Keep
   Share (own devices, desktop round-trip), relabel it "Copy link", or hide it outside the demo?
6. **Light theme**: chrome only (map stays dark) in v1, or dark-only like desktop until the map
   style work is done?
7. **Spike devices**: which real phones are available (one iPhone, one mid-range Android is the
   minimum)? Phase 2 cannot be decided without them.
8. **Index refresh on cellular**: interval (e.g. hourly) + manual Refresh in a settings sheet, or
   only on Wi-Fi?
9. **Demo pitch on the phone**: a `DEMO` tag in the pill plus About in ⋯ (D r2), or a one-line
   dismissible banner on first visit (current desktop banner is 136 px at 390 wide)?
10. **Library place search scope**: places from the index (`city`/`country`) need the full index on
    a cold visit. Acceptable that place results appear a few seconds after names and years?

## 6. Requirements for the mobile version

### 6.1 Functional

- **F1 Shell**: selected **at boot** when `(pointer: coarse)` and the short screen side ≤ 500 px
  (`min(screen.width, screen.height)`), not by viewport width, so rotating a phone to landscape
  (844 px wide) never swaps to the desktop shell or remounts the map. Mobile chunk lazy-loaded;
  desktop-only code (hover tips, wheel, shortcuts overlay, inset canvas, visits menu) not in it.
- **F2 Library**: search by album name, year and place; trip cards (name, dates, count, verdict
  text, cover); All albums toggle; year rows with month cells; tap month; long-press-drag month
  range with live count; Custom dates; "All photos" (clear).
- **F3 Trip, Replay view**: map with route, gaps, clusters, pins, marker; Follow/Fit; docked card;
  time strip (scrub, tap-to-jump, stop ticks); ⏮ ▶ ⏭; ⋯ (album / all photos in these dates,
  share, About/credits in demo); ⓘ legend sheet; no-GPS count visible in text.
- **F4 Cluster/pin**: cluster tap → visits sheet (per visit: date, span, count, 4 thumbhash
  thumbs, Zoom to these days, Jump here); "Also here" row when other trips share the `city`;
  pin tap = seek.
- **F5 Photos / Story**: virtualised layout of the selection in time order with day chapters,
  stop headers, transit breaks; no-GPS photos inline with a crossed-pin badge; tap = cursor +
  lightbox. Phase 1: scroll never moves the cursor. Phase 2: docked passive map, stop-damped
  camera, scroll → cursor per row, Play scrolls the page.
- **F6 Lightbox**: swipe ←/→ by photo in time order within the selection, swipe ↓ closes to the
  cursor, pinch and double-tap zoom (paging off while zoomed), tap toggles chrome, video with
  native controls (muted autoplay), info sheet (time + UTC offset, place, coords, static SVG
  route, credits in demo, Open in Immich outside demo), Share, day-segmented progress, visible
  ✕ (no gesture-only close).
- **F7 URL / history**: desktop contract unchanged (`from/to`, `album[&mode=range]`, `at`, `lb`);
  phone-only `view` optional (phase 2). Selection changes and screen pushes (Library, Photos,
  lightbox) push history; `at` from scrub, Play, ⏮ ⏭, scroll and lightbox stepping replace (≤ 1/s).
  Back closes sheet → lightbox → screen → walks selections. Links round-trip phone ↔ desktop.
- **F8 Demo**: lands as in §2 Defaults; per-photo credits in the lightbox; About reachable in ≤ 2
  taps; coach: at most one hint (Play / strip), shown once (localStorage, fail-safe).
- **F9 Share**: `navigator.share({url})`, copy + toast fallback.
- **F10 States**: loading (thumbhash + names first), index refreshing, no GPS in the selection,
  empty month, error/offline (cached index + last trip readable), WebGL unavailable or context
  lost (static route sketch + card + strip still work).

### 6.2 Performance budgets

Reference devices: mid-range Android (Adreno 6xx / Mali-G57 class, 4–6 GB) and an iPhone 12-class;
network: throttled 4G (≈ 9 Mbps, 170 ms RTT).

| Budget | Target |
|---|---|
| Mobile eager JS (shell + Library + Trip without MapLibre) | ≤ 60 kB gzip; MapLibre stays a lazy chunk |
| Cold album deep link → title, card thumbhash, strip | ≤ 2.5 s (needs album-first boot) |
| Cold → map tiles + route visible | ≤ 4 s |
| Warm (IndexedDB) open → interactive | ≤ 1 s |
| Strip drag, Story scroll, lightbox swipe | ≥ 55 fps p50, no long task > 50 ms |
| Play 60 s with Follow on the demo trip, map at `pixelRatio` 2 | p95 frame ≤ 33 ms; if missed, Follow jumps per stop (fallback) |
| WebGL contexts | exactly 1 for the app's life; rAF stopped when settled, hidden, or under Library/lightbox |
| Decoded previews | ≤ 3 (current ± 1) |
| Media requests | ≤ 6 in flight; ≤ 60 per 6 s (half the demo relay limit); `preview` only after 300 ms rest; thumbnails only when scroll/fling velocity is low |
| Index refresh | never a full refresh on every visit on cellular (interval or manual) |
| Memory | tab stays < 300 MB after 10 min of Play + lightbox on iPhone (no Safari reload) |
| Battery | Play 60 s: measure and record per device in the spike (no number exists yet, even on desktop) |

### 6.3 Accessibility

- WCAG 2.2 AA. Targets ≥ 44 × 44 px; information text ≥ 11 px, body ≥ 14 px; contrast ≥ 4.5:1
  (3:1 for large text and graphics); state never by opacity alone (no-GPS hatched + text).
- Every gesture has a tap alternative: range drag → Custom dates; pinch zoom → double-tap;
  swipe close → ✕; swipe step → keyboard arrows and (with a screen reader) labelled buttons.
- Time strip / film: `role="slider"`, `aria-valuetext` ("Mon 9 Sep, 13:04, Yesa, photo 112 of
  194"), arrows = photo, Page Up/Down = stop; polite live region, debounced 500 ms.
- Map canvas `aria-hidden`; the pill/card are its text equivalent. Story/Photos is a DOM list
  (h2 day, h3 stop); tiles have alt text from time + place (+ "no location").
- `prefers-reduced-motion`: camera jumps or crossfades per stop, no momentum, no spring overshoot,
  no Play pulse, Play uses the 2.5 s step and jumps (no smooth auto-scroll).
- Focus order and focus trap in sheets and lightbox; the rest `inert`; hardware keyboard works.
- Respect the OS text size up to 200% in Library, sheets and Story (map chrome may truncate).

### 6.4 Supported devices and orientations

- **Browsers**: iOS Safari 17+, Chrome Android 120+, Samsung Internet (current); Firefox Android
  best-effort. Installed PWA is not required in v1.
- **Sizes**: portrait 360×640 (smallest), 375×667 (SE), 390×844 (reference), up to 430×932.
- **Portrait** is primary. **Landscape** supported on the same shell: map left ~58%, deck/Story as
  a right column; no rotation lock; rotation never remounts the map.
- Safe areas (`env(safe-area-inset-*)`), `svh`/`dvh` for fixed bands, no drag starting within
  20 px of a screen edge (OS back/forward).
- **Tablets, iPad, foldables unfolded** (short side > 500 px): desktop shell. Touch fixes there are
  out of scope.
- **Theme**: dark in v1 (matches desktop and the dark basemap); light chrome is open question 6.

### 6.5 Out of scope (v1)

Editing, deleting, favouriting, uploads or any write to Immich; multi-select and bulk actions;
non-contiguous place filters; the desktop brush/wave on phones; a light basemap; offline beyond the
cached index + shell + recent thumbnails; push notifications; native or store apps; auto-generated
memory videos; per-user mode; tablet-specific layout; library map of trips (variant only);
borrowing GPS for camera shots (roadmap, separate).

## 7. Build order

1. Groundwork (eng §0 items 1–8) and the touch lightbox (the most broken thing today).
2. Library + Trip Replay view + visits sheet. Shippable alone; fixes the current phone layout.
3. Photos screen (Story layout, no map link).
4. Spike on a real iPhone + mid Android: Play 60 s, strip fling, Story scroll with a stop-damped
   docked map. Record frame time and battery.
5. Story view (phase 2) if the spike passes; otherwise Story keeps a static `RouteSketch` docked
   map and Replay carries the animation.

## 8. Category briefs

One brief per category designer, in `05-briefs/`:
[navigation](05-briefs/navigation.md) · [timeline](05-briefs/timeline.md) ·
[map](05-briefs/map.md) · [preview](05-briefs/preview.md) · [albums](05-briefs/albums.md).

Common rules for every brief: follow the study's mockup rules (one self-contained HTML, 390×844
frames, root class `.mk-<category>-<variant>`, light + dark, numbered callouts, demo data only);
write `docs/mobile/05-categories/<category>.md` and `docs/mobile/mockups/<category>.html`; respect §6;
do not reopen §0 or §4 without new evidence.
