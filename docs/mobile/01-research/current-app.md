# Current app, mapped for mobile design

Retrace today is a single desktop screen (Layout L-A): demo banner → overview (bar + all-years
strip + zoomed wave + album rail + hint row) → map (fills the rest) with a time strip under it.
The lightbox is a full-screen overlay. There are no width breakpoints anywhere. Source: `web/src`,
decisions in `AGENTS.md`. Screenshots (public demo only) in `../screens/`.

## Views and interactions

### 1. Bar (top of the overview, `Overview.svelte`)
- Album picker button ("Albums"; demo: "Try another trip"), ‹ › previous/next album on the rail.
- Readout: album name · `6 Sept 2024 → 10 Sept 2024 · 5d` · `■ 190 with location · ■ 4 without`.
  On desktop one line; it's the main "what am I looking at" text.
- ✕ clear, segmented `album photos | all photos in these dates` (album mode), All years, item count,
  `?` (shortcuts overlay, `Help.svelte`), ⋯ menu (cache rebuild; hidden in demo).
- ← Back to <parent> after a cluster/pin zoom (zoom stack `selection.stack`).

### 2. All-years context strip (canvas, 50 px tall)
- Density of the whole library (outlier dates trimmed), with a bright window = the zoomed wave's range.
- Drag window (move), drag its edges (resize, min 7 days), click outside (recentre, animated),
  double-click (clear selection), wheel (zoom). Hover tooltip explains what a click does.
- Hit tolerance for edges: 7 px (`hitGrip`). Cursor shapes (`ew-resize`, `grab`) carry meaning.

### 3. Zoomed wave + brush + album rail (canvas, 176 px tall)
- √(count/day) area chart, GPS (green) vs no-GPS (grey) by lightness, day bins.
- Brush: drag to create, drag middle to move, drag edges to resize; snaps to local days. The map
  follows only after 220 ms of rest or on release (re-clustering per frame stutters).
- Album rail: 2 lanes × 20 px of coloured bars under the axis; click opens the album; hover shows
  name, dates, count.
- Hover draws a time cursor line + date label on the wave (never moves the map).
- Keyboard: ←/→ move a day, Shift a week, Alt resize, Esc clear. Wheel zooms the view.
- The visible period (debounced 200 ms) is published as `selection.timeline`; with no selection the
  map shows pins for it.

### 4. Album picker (`AlbumPicker.svelte`)
- Popup: search field (name or year), tab trips/all, newest first, ↑/↓/Enter/Esc. Hover on a row
  explains the trip verdict (`trips.ts`). Closes on outside pointerdown.

### 5. Map (`MapView.svelte`, MapLibre GL, lazy chunk ~230 kB br + worker ~120 kB br)
- Route line coloured by time (amber ramp), dashed gap connectors (>4 h), clustered pins
  (`clusterRadius 44`, radius 11–23 px), single pins 3.5–5 px radius (photo amber, video blue).
- Position marker (DOM) + **photo card** (172 px wide, thumbnail + time + place + "Open photo"),
  placed left/right of the marker by available space. Tap/click opens the lightbox.
- Cluster click: narrow the selection to those photos' days (zoom; Back returns). Several visits →
  a chooser menu (240 px) with "Just zoom the map in". Pin click: move cursor there (no selection:
  select that day).
- **Hover** on pin/cluster: tooltip with thumbhash, time(s), place, what a click does. Only path to
  preview a pin before committing.
- Overlays: legend top-left (≥200 px wide: date ramp, dash key, counts), Follow | Fit top-right,
  zoom +/− (NavigationControl), whole-trip inset canvas bottom-left (176×124), notices (zoomed,
  no GPS, errors) and attribution.
- Follow camera (`camera.ts`, `follow.ts`): target path every 10 min, precomputed in a worker
  (`camera.worker.ts`, 50–150 ms for a year of GPS); per-frame `jumpTo` with damped springs. A user
  pan/zoom (any `originalEvent`) pauses Follow ("Follow ⏸"); pointer-down holds the camera.
  Rotation is disabled (touch rotate too). Touch pan/pinch work natively via MapLibre.

### 6. Time strip (`TimeStrip.svelte`, under the map, 64 px canvas)
- Density of the selection, cursor line + label, day/month ticks scaled by px/day.
- Drag to scrub (counts as scrub: Follow flies along). ←/→ step photo, Home/End, Enter opens.
- Play button (demo: large) / Space: steps photo by photo (350 ms bursts, 900 ms, 1.8 s before
  jumps ≥3 h; 2.5 s reduced-motion). Stopped by drag, keys, new selection, lightbox.
- A permanent hint line lists keyboard keys.

### 7. Lightbox (`Lightbox.svelte` controller eager, `LightboxView.svelte` lazy)
- Grid `7fr | minmax(280px, 3fr)`, 20 px padding: photo/video stage + side panel.
- Stage: thumbhash placeholder sized to the aspect ratio, `size=preview` fades in; video plays with
  controls, muted autoplay. Prev/next buttons 48×96 at the edges. Click backdrop closes.
- Panel: `15 / 194`, ✕, 40 px clock, long date + UTC offset, kind, place, coords, **second MapLibre
  instance** (mini-map, non-interactive), "position in range" density strip, demo credits
  (`hooks.lightboxPanel`), "Open in Immich" (not in demo), key hint.
- ←/→ step through the active range in time order; Esc closes; focus trap; rest of app `inert`.
  Preloads ±2 neighbours' previews. Opening pushes history (Back closes), stepping replaces.
- No swipe, no pinch-zoom on the photo, no fullscreen.

### 8. Demo layer (`lib/demo/`, lazy chunk, `DEMO=1`)
- Banner: "DEMO · SAMPLE DATA" tag, pitch, credit line + About & credits, "Get it for your Immich →".
- Landing (`landing.ts`): no query string → opens `DEMO_TRIP` album ("San Sebastián to Huesca,
  6–10 Sep 2024"), cursor on a GPS landscape photo mid-trip, Follow on, not playing.
- Coach mark (`Coach.svelte`, `tour.ts`): 3 steps once per visitor (localStorage) — timeline
  (`canvas.main`), time strip (`.strip .track`), photo card (`.marker .card`). Ring + bubble.
- About dialog; per-photo credits in the lightbox panel.

### 9. URL state (`selection.svelte.ts`)
`?from=YYYY-MM-DD&to=YYYY-MM-DD` (local days) or `…T14:00Z` (after a cluster zoom),
`?album=<uuid>[&mode=range]`, `&at=<ms>` cursor, `&lb=<asset id>` open photo. Brush/album/clear
commit history entries; scrubbing, Play and lightbox stepping replace (≤1/s, 250 ms debounce).
Back closes the lightbox and walks selections. **Mobile can and should keep this contract**: deep
links from a phone open the same state on desktop and vice versa.

### 10. Keyboard shortcuts (`shortcuts.ts`, shown by `?`)
| Where | Keys / gestures |
|---|---|
| Timeline (wave) | drag, drag edge, drag middle, click album bar, scroll zoom, ←/→ day, Shift week, Alt resize, double-click/Esc clear |
| All-years strip | drag window, click recentre, double-click clear, scroll zoom |
| Map | drag/scroll pan-zoom (pauses Follow), click cluster (narrow), click pin (cursor/day), click card (open), arrows/+/− when focused, Esc closes visits menu |
| Time strip | drag scrub, ←/→ photo, Home/End, Enter open, Space play/pause |
| Photo viewer | ←/→, Esc |
| Albums list | type to search, ↑/↓, Enter, Esc |
| Anywhere | Backspace back out of zoom, `?` this list |

Every shortcut has a pointer equivalent except: day/week nudging of the brush (keyboard only),
Home/End, Backspace (there is a Back button only after a zoom).

## Input dependencies

| Feature | Hover | Wheel | Keyboard | Wide screen | Precise pointer |
|---|---|---|---|---|---|
| Strip window drag / edges | tooltip only | zoom | – | yes (years in px) | **7 px edge grip** |
| Wave brush | cursor + date label | zoom | nudge/resize | yes (day bins) | **7 px edge grip, 3 px drag threshold** |
| Double-click to clear | – | – | Esc alt. | – | double-tap = browser zoom risk |
| Album rail | **name/dates only on hover** | – | – | labels truncate | 20 px lanes |
| Album picker | trip-verdict reason | – | full nav | 1 popup | – |
| Map pins/clusters | **preview tooltip** | zoom | arrows | legend+inset+card all overlaid | 3.5–5 px pins |
| Photo card | – | – | – | needs ~200 px beside the marker | – |
| Visits menu | – | – | Esc | 240 px | – |
| Time strip | – | – | step/Home/End/Enter/Space | ticks scale with width | ok (whole strip is target) |
| Lightbox | – | – | ←/→/Esc | **side panel min 280 px** | 48×96 nav ok |
| Coach mark | – | – | – | targets must be on screen | – |

Canvas elements set `touch-action: none`, so pointer events do fire on touch; the gestures exist but
are tuned for a mouse (no pinch-to-zoom the timeline, which today only zooms by wheel).

## Data / API and performance constraints

- **Index**: `GET /api/index` (month manifest: `[{month, count}]`) → `GET /api/index/:month`
  (parallel columns: id, t, off, video, dur, lat, lon, thumbhash, ratio, city, country), 5 months in
  flight. `buildIndex` sorts by instant on the main thread (~15 ms / 30k rows). Cached in IndexedDB,
  renders from cache instantly, full background refresh every visit under a Web Lock. Demo: 1 688
  items. Mobile cost: full refresh per visit on cellular is the main data concern (manifest + every
  month's columns; thumbhashes dominate). An interval/manual refresh (roadmap "Later") matters more
  on a phone.
- **Albums**: `GET /api/albums` (summary: id, name, start/end local days, count, shared, version);
  `GET /api/albums/:id/assets` member columns, cached per version. Trip scoring is client-side from
  the index only.
- **Media** via the relay: `/api/assets/:id/thumbnail?size=thumbnail|preview&c=<thumbhash>`
  (versioned → immutable cache), `/api/assets/:id/video` (Range). Immich defaults: thumbnail ~250 px
  (webp), preview ~1440 px (jpeg); demo has 250 px and 1280 px copies. Map card uses `thumbnail`;
  lightbox uses `preview` + preloads ±2. At DPR 3 a 172 px card wants ~516 px, so the 250 px
  thumbnail looks soft on a phone; a filmstrip of 100 px tiles is fine with `thumbnail`.
- **Thumbhash** placeholders everywhere (decoded to data URLs, `thumbhash.ts`): cheap instant
  previews, good for fast scrolling lists on mobile.
- **MapLibre**: lazy chunk ~230 kB br + worker ~120 kB br (1 MB + 0.5 MB raw). Two map instances
  when the lightbox is open (main + mini-map) — two WebGL contexts, costly on low-end phones; iOS
  Safari limits live contexts. Map style: OpenFreeMap / tiles.immich.cloud dark vector tiles.
- **Follow camera**: requestAnimationFrame loop + `jumpTo` per frame; track built in a worker;
  frame time on a real GPU is unmeasured (roadmap), on mobile GPUs unknown. `visibilitychange` snaps.
- **Canvases** redraw once per frame on input change; sized by DPR (cheap).
- Eager bundle ~37 kB gzip (overview + lightbox controller); first paint does not wait for the map.
- Color scheme is dark only (`color-scheme: dark`, canvas colours hard-coded in `draw.ts` `C`).

## Reusable on mobile vs desktop-only

Reusable as is (logic, no UI): index + IndexedDB cache + refresh, `selection.svelte.ts` (selection,
cursor, zoom stack, lightbox row, URL contract), `trips.ts` scoring, `route.ts` (segments, clusters
→ visits, `positionAt`, `cursorRow`, `densityBins`), `camera.ts` + worker + `follow.ts` (the follow
camera is the product's differentiator and is input-agnostic), `play.ts` timings, `landing.ts`,
`thumbhash.ts`, `media.ts`, `failure.ts`, `format.ts`, `data.ts` helpers (`snapDay`, `fDay`,
`countRows`, `viewAround`, `zoomAt` — reusable for pinch).

Reusable with new UI: MapLibre map layers (route/gaps/clusters/pins — bigger hit targets), the
density drawing (`draw.ts`, TimeStrip) for a thinner or vertical strip, lightbox model
(`model.ts`: `step`, `neighbours`, `fPosition`), demo banner content, coach mark positioning
(`placeBubble` is generic).

Desktop-only (replace): hover tooltips (map pins, album rail, strip), wheel zoom, double-click
clear, keyboard shortcuts + `?` overlay + all key hints, 7 px edge grips, the side-panel lightbox
grid, the one-line readout, the ⋯ popup, the 240 px visits menu positioned at the click point,
the inset canvas overlaid on the map.

## What breaks at phone width (390×844, DPR 3, touch)

Screens: `phone-landing-tour.jpg`, `phone-landing.jpg`, `phone-lightbox.jpg` (desktop:
`desktop-landing*.jpg`, `desktop-lightbox.jpg`). No horizontal overflow in this build
(`scrollWidth` 390; the roadmap's "renders 543 px" note looks stale), but the vertical budget fails:

1. **Chrome eats 69% of the height.** Banner 136 px (pitch wraps to 2 lines, credit 2 lines, CTA
   on its own row) + overview ~446 px → the map gets **262 px** of 844 (y 582–844), and the time
   strip takes 113 px of that, leaving ~150 px of actual map.
2. **Bar wraps into 4 rows**: picker + ‹ ›; readout over 3 lines; ✕ clear + mode segment; All years
   + count + `?`. The mode segment "all photos in these dates" barely fits.
3. **Map overlays collide**: legend (215×75), inset (176×124), Follow|Fit, zoom +/−, attribution
   and the photo card (172×171) all stack in the same ~150 px. The card is pushed off the left edge
   (x −2) and its top clipped by the time strip / overview; the legend covers the inset; the
   attribution text runs over the card. Clusters ("84", "92") hide behind the inset.
4. **Overview canvases are too dense**: the wave shows ~4 months in 340 px (~3 px/day bins), the
   brush for a 5-day trip is ~10 px wide with two grips almost touching — not draggable by finger.
   Album rail labels truncate ("San Sebastián to Huesca, 6–10 S…"), lanes are 20 px.
5. **Hints are keyboard text**: "scroll to zoom", "`?` all shortcuts", "← → step photo by photo ·
   Enter · Space" — meaningless on touch and take two lines each.
6. **Time strip**: Play is 85 px wide of 390, track ~250 px for 5 days; tick labels collide
   ("6 Sept" then the cursor label); otherwise usable by drag.
7. **Coach mark** works mechanically but step 1's bubble covers the map and the hint row; step 3's
   target (card) is partly off-screen.
8. **Lightbox is unusable**: grid keeps the 280 px panel min, so the stage is **70 px wide** and
   the photo renders **70×52 px**; the nav arrows (48 px each) overlap the photo; the panel is a
   tall scroll of clock, mini-map (280×260), strip and credits; key hint "←/→ previous / next · Esc
   close". No swipe to step, no swipe-down to close, no pinch zoom.
9. **Hover-only info is unreachable**: pin/cluster tooltip (photo preview before tapping), album
   rail details, strip window explanation, trip-verdict reasons in the picker.
10. **Gesture conflicts**: double-tap to clear the selection collides with expectations of
    double-tap zoom; `touch-action: none` canvases occupy ~45% of the screen, so a vertical swipe
    starting on the overview never scrolls anything (page doesn't scroll anyway: fixed 100% grid).
11. **Two WebGL maps** while the lightbox is open, on top of a phone GPU running the follow loop.
12. Dark theme only; no `prefers-color-scheme` support (mockups must add a light variant).

## Implications for the mobile concepts

- The selection → cursor → map/card → lightbox chain and the URL contract are the core to keep;
  the desktop overview layout is not.
- Pick-a-period must become coarse and finger-sized: trip list / year → month chips / pinch on a
  taller timeline, not a 7 px brush. Trips ("Try another trip") are the natural mobile entry point.
- The time strip + Play + Follow camera already work by drag and are the best part on a phone;
  give them the screen (map + strip), and move legend/inset/counts into a collapsible sheet.
- The photo card must stop floating beside the marker on a narrow map: dock it (bottom sheet or
  filmstrip synced to the cursor; roadmap "Later" already proposes a filmstrip).
- Lightbox: full-bleed photo, swipe ←/→ to step, swipe down to close, info as a pull-up sheet;
  drop or defer the mini-map (or reuse the main map behind).
- Replace every hover with tap-to-preview (first tap previews, second commits) or long-press.
