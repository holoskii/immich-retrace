# Phone demo: build scope

The current plan for Retrace on a phone. It supersedes the "Replay + Photos" recommendation in
[README.md](README.md) for now; that study stays as the long-term reference.

**Status (2026-10):** phases 0–3 are built and on main, followed by a two-reviewer UI pass (Codex and
Opus) fixed in three batches: Play paced to about 45 s per trip, landing on the whole trip, a phone
pitch line, early trip loading, a short-screen desktop layout, a product Open Graph image. Phase 4
(real devices) is open. How it works now is in [ARCHITECTURE.md](../../ARCHITECTURE.md) (phone shell, Play and
demo decisions); this page stays the original scope.

**Who it is for:** demo visitors who open a shared link on a phone. Goal: they see a trip play
back on the map, look at a few photos, and understand what Retrace is. Owner mode on a phone keeps
the desktop shell.

**Shape:** a minimal [Concept D](02-concepts/d-concept.md) (faithful port in tabs): Map / Photos /
Trips over the same `selection` store. Chosen because it is the most familiar shape and the
cheapest to build: no model or URL changes, links round-trip with desktop.

## In scope

### Shell
- `App.svelte` picks a lazily loaded `MobileShell` at boot when demo mode, `(pointer: coarse)` and
  short screen side ≤ 500 px. Rotation never swaps shells.
- Bottom tab bar: Map · Photos · Trips. The tab is not in the URL (derived from state).
- Demo `/` lands on the first trip, Map tab, cursor mid-trip, Follow on, ▶ pulses once.

### Map tab (home)
- Full-bleed map, floating two-line pill: trip name; `DEMO · dates · count`. ⋯ = Share, About demo.
- Follow / Fit buttons, 44 px, right edge in the thumb arc.
- Dock: photo card (tap → lightbox), time strip (drag scrubs, tap jumps, stop ticks), ⏮ ▶ ⏭ by stop.
- Pin tap = seek. Cluster tap = MapLibre's default zoom-in.
- `at` written with `replaceState` only.

### Photos tab
- Virtualised 3-column grid of the selection in time order, sticky day headers.
- Cursor photo ringed; entering the tab scrolls to it once. Tap = cursor + lightbox.
- Scroll never moves the cursor.

### Trips tab
- One card per demo trip: cover, name, dates, photo count. Tap = select + Map tab.

### Lightbox
- Full-screen pager: swipe ←/→, pinch / double-tap zoom (paging off while zoomed), swipe ↓ or ✕
  closes. Counter `112 / 194`. Time and place line. Opens a history entry so Back closes it.
- `preview` over thumbhash; preload ±1; ≤ 3 decoded previews.

### Groundwork (needed by the above)
- `actions.ts`: `pickAlbum`, `setMode`, clear/back URL writes moved out of `Overview.svelte`
  (without it the demo lands on nothing).
- Follower camera insets `{t,r,b,l}` instead of a fixed 70 px pad.
- MapLibre `pixelRatio` ≤ 2, one instance for the app's life, a `webglcontextlost` fallback.
- `stops.ts`: pure, tested; drives ⏮ ⏭ and strip ticks. Tune thresholds on the demo trips.
- `media.ts` queue: ≤ 6 in flight, under the demo relay limit, 429 back-off, cancellation.
- Server: `cover` on `AlbumSummary`.

## Out of scope
Narrow mode, visits sheet, search, year rows / month cells / month ranges, Custom dates, stop
chapters and transit lines in Photos, fast scroller, lightbox filmstrip and info sheet, ⓘ legend,
Story, offline / service worker, landscape-specific layout (same shell, best-effort), owner mode,
light theme.

## Web platform requirements
Full research: [07-web-platform.md](07-web-platform.md) (top-15 checklist at the end). What it
adds to the plan:

- **Boot:** pick the shell in `main.ts`; both shells are dynamic imports (today `App.svelte`
  statically pulls `Overview` and `Lightbox` into the entry). Data, shell chunk and
  `import('maplibre-gl')` start in parallel at t0. CI check: phone entry ≤ 60 kB gz, no
  `overview/` imports.
- **LCP:** the photo card `<img>` (`fetchpriority="high"`), not the map canvas.
- **Map:** check for WebGL2 before downloading MapLibre (~350 kB br); on context restore call
  `setStyle` manually (MapLibre #8690). Delete `MiniMap.svelte` (second WebGL context).
- **Layout:** fixed, non-scrolling root (`inset: 0`, `overscroll-behavior: none`),
  `viewport-fit=cover`, safe-area padding, `dvh`/`svh`, never `100vh`. Tabs scroll inside their
  own containers.
- **Touch:** pointer events + `touch-action`; Svelte's `ontouch*` handlers are passive, so
  `preventDefault` there does nothing. Keep horizontal drags off the screen edges.
- **Lightbox:** hand-rolled on `lightbox/model.ts`; pinch on the `preview`, never originals.
  PhotoSwipe 5 is the fallback. Demo thumbnails regenerated at 480 px.
- **Play:** time-based (Low Power Mode caps rAF at 30 fps), stops when hidden or covered.
- **Cheap extras:** Open Graph tags (the chat link preview is the first impression), a minimal
  manifest. No service worker, install prompt, zstd or speculation rules.
- **Check:** the reverse proxy serves HTTP/2+.
- **Testing:** Playwright `Pixel 7` + `iPhone 15` projects for regressions; real devices for
  the rest (A-class Android with Chrome and Samsung Internet, iPhone SE, a large iPhone on
  iOS 26+, the link opened from Telegram/WhatsApp). Safari Web Inspector needs a Mac.

## Phases
| Phase | Content | Ships |
|---|---|---|
| 0 | Groundwork above | Nothing visible; desktop cold links faster |
| 1 | Touch lightbox | Usable photos on phones, also in the desktop shell |
| 2 | `MobileShell`: tab bar, Map tab, Trips tab | The demo works on a phone |
| 3 | Photos tab | Browsing photos |
| 4 | Real-device pass (one iPhone, one cheap Android) against the budgets | Go live |
