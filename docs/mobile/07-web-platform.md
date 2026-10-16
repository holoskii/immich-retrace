# Mobile web platform: what a fast phone demo needs

Research from October 2026 for [demo-scope.md](demo-scope.md). **[M]** must-have, **[N]** nice-to-have, **[S]** skip.

**Baseline today (gz / br):**
- **Eager entry:** `index-*.js` is 41.3 / 37.0 KB, plus 2.5 KB of CSS. It includes Overview and the Lightbox, which are desktop code.
- **MapLibre:** the main chunk is 280 / 230 KB (1.05 MB raw), the worker 144 / 119 KB (508 KB raw), and its CSS 10.4 KB (83 KB raw).
- **`MapView`:** 17 KB.

**Already done:** `.br`/`.gz` copies are built ahead of time, `/assets/` is served `immutable`, `index.html` is `no-cache`, fonts are system fonts, and an inline loading shell paints first.

---

## 1. Budgets and metrics

**Do**
- **[M] Use the Core Web Vitals thresholds as targets**, judged at p75: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. Safari has measured LCP and INP since 26.2 (Dec 2025). CLS is still measured only in Chromium.
- **[M] Make the photo card or the title the LCP element, not the map.** A WebGL `<canvas>` never counts as LCP. Put the card `<img>` into the DOM as soon as the album's cover or first asset ID is known, with `fetchpriority="high"`. This lines up with your "≤ 2.5 s to title + card + strip" target.
- **[M] Use Alex Russell's 2026 baseline as the reference phone.** He picks a Galaxy A24 4G for p75. For a JS-heavy page loading in 3 s he allows 0.62 MiB of JS on the wire.
  - The phone path would be about 45 KB (shell) + 349 KB br (MapLibre and its worker) ≈ 0.39 MiB. That fits, but only if MapLibre starts downloading at t0.
  - At Lighthouse's Slow 4G (1.6 Mbps ≈ 200 KB/s), MapLibre alone takes about 1.8 s to download, before parse and compile. That makes "≤ 4 s to route" achievable but tight.
- **[M] Keep the ≤ 60 KB gz eager budget, and count everything that blocks the first paint of the phone shell**: entry, stores, shell and its CSS. Realistically that comes to 35–55 KB. Desktop-only modules (Overview canvases, hover tips, `shortcuts.ts`, `Help`, `inset.ts`) must not appear in that import graph.
- **[N] Send field data from demo visits** to the server: web-vitals.js (about 2 KB) reporting LCP, INP, `deviceMemory` (Chromium only) and the UA.

**Avoid**
- Trusting a Lighthouse score from your own machine. Its 4× CPU slowdown is calibrated for a fast desktop and is relative to the host.
- Counting frames to keep time. In iOS Low Power Mode, rAF runs at 30 fps.

**Measure**
- Lighthouse mobile: Slow 4G (150 ms RTT, 1.6 / 0.75 Mbps), 4× CPU. Recalibrate `cpuSlowdownMultiplier` for your host; DebugBear measured about 14.7× for a low-tier phone.
- WebPageTest with the Moto G4/G71 real devices or emulated profiles. The real devices may now be a paid tier.
- On an Android phone: `chrome://inspect` Performance panel, memory, and the Rendering → FPS meter.
- On an iPhone: Safari Web Inspector, Timelines → Memory / JS / Layout. **This needs a Mac.** From Linux the options are `ios-webkit-debug-proxy` or a paid tool such as inspect.dev. Plan for that.
- **[N] A size check in CI**: a test that fails if the mobile entry graph exceeds 60 KB gz or imports `overview/*`.

Sources: [web.dev CWV](https://web.dev/articles/vitals) · [Safari 26.2 LCP/INP (RUMvision)](https://www.rumvision.com/blog/safari-catching-up-inp-and-lcp-support-in-the-same-beta-release/) · [Performance Inequality Gap 2026 (Nov 2025)](https://infrequently.org/2025/11/performance-inequality-gap-2026/) · [Lighthouse throttling](https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md) · [WebPageTest locations](https://docs.catchpoint.com/wpt/docs/webpagetest-legacy-api)

## 2. Loading

**Do**
- **[M] Choose the shell in `main.ts`, before any component import.**
  - Condition: `matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 500`.
  - Then `import()` either `DesktopShell` or `MobileShell`.
  - `App.svelte` currently imports `Overview` and `Lightbox` statically, so they would land in the phone's eager graph. Both shells should be dynamic imports.
  - This costs one extra round trip (entry, then shell chunk). Keep the entry under about 5 KB so the hop is about 150 ms on Slow 4G.
- **[M] Start everything in parallel at t0, from `main.ts`, without waiting for the shell to mount:**
  - `/api/config` and the album-first data (album list plus members)
  - `import('maplibre-gl')`
  - the shell chunk
  - Today MapLibre starts when `App.svelte` runs, which is fine for desktop. On the phone the map is the main screen, so it must not wait for a render.
- **[M] `<link rel="preconnect" href="https://tiles.openfreemap.org" crossorigin>`.** MapLibre fetches the style, tiles and glyphs with CORS `fetch`, so the `crossorigin` attribute is required for the preconnect to be reused.
- **[M] Paint a phone skeleton from inline CSS in `index.html`.** Use `@media (pointer: coarse) and (max-width: 500px)` to draw the title bar, the deck and an empty map area, so the shell mounting causes no layout shift. The existing desktop "Loading…" style is the starting point.
- **[N] Have a `transformIndexHtml` plugin write the hashed names of both shell chunks into an inline script**, which adds a `modulepreload` for the chosen one. That removes the extra round trip. Only do this if the waterfall is visible in WebPageTest.
- **[N] Lower MapLibre's priority so it doesn't compete with the card image:** add `fetchpriority="low"` to a modulepreload for it (Chromium honours this). The card image gets `high`.

**Avoid**
- Preloading both shells.
- `loading="lazy"` on the card or LCP image.
- Breakpoint-driven responsive CSS for this. You already chose two shells.

**Skip**
- **[S] zstd.** Safari decodes it only from 26.3, Samsung Internet not at all, and for static files compressed ahead of time it gains nothing over brotli-11.
- **[S] Speculation rules.** This is a single-page app with no navigations to prerender, and Safari still keeps them behind a flag.
- **[S] Web fonts.** Keep system fonts.

**Check:** confirm the reverse proxy serves HTTP/2 or HTTP/3. Russell's budgets assume connections are consolidated, and the 6-per-host limit of HTTP/1.1 would throttle thumbnails.

Sources: [web.dev Fetch Priority](https://web.dev/articles/fetch-priority) · [web.dev resource hints](https://web.dev/learn/performance/resource-hints) · [Vite build.modulePreload](https://vite.dev/config/build-options) · [caniuse zstd](https://caniuse.com/zstd) · [Speculation rules status](https://developer.chrome.com/docs/web-platform/prerender-pages)

## 3. Viewport and layout

**Do**
- **[M] Viewport meta:** `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`.
  - `interactive-widget` works in Chrome Android 108+ and Firefox Android 133+. It is in WebKit trunk but no Safari release has it yet (status Sep 2026). The page must work without it.
- **[M] Make the Replay screen a document that doesn't scroll**: `html, body { height: 100%; overflow: hidden; overscroll-behavior: none }`, with the app root `position: fixed; inset: 0`.
  - The URL bar then never collapses or expands under the map, `svh` and `dvh` stay effectively equal, and pull-to-refresh and the iOS rubber-band bounce are both gone.
  - Library and Photos scroll inside their own containers with `overscroll-behavior: contain`.
- **[M] Use `100dvh` or the fixed `inset: 0` root, never `100vh`.** Size the fixed bands (map, deck) in `svh` so nothing jumps.
- **[M] Safe areas:**
  - Deck: `padding-bottom: max(12px, env(safe-area-inset-bottom))`.
  - Floating title: `top: max(8px, env(safe-area-inset-top))`.
  - Landscape: left and right insets, because of the notch.
  - Pass the deck height to `map.setPadding` so the camera knows what the deck covers.
- **[M] iOS 26/27 Liquid Glass toolbar:**
  - Fixed and opaque layers misbehave near the floating bar. Put backgrounds on absolutely positioned children of fixed bars.
  - Closed overlays (sheets, lightbox) need `display: none`. With `opacity: 0` alone they still tint the toolbar.
  - `theme-color` is ignored in Safari 26.
  - `visualViewport.offsetTop` can stay non-zero after the keyboard closes, which leaves a gap under bottom bars.
  - Test both toolbar states on a real device.
- **[M] Library search:** `font-size: 16px` or more, otherwise iOS zooms in on focus. On iOS, handle the keyboard with `visualViewport` `resize` events.
- **[M]** `-webkit-text-size-adjust: 100%; text-size-adjust: 100%`. This stops iOS inflating text in landscape. Don't use `none`.
- **[M] Targets of at least 44 px** (your rule; WCAG AA itself is 24 px, see §10). Leave 8 px or more between targets in the deck.
- **[M] Landscape:** the same shell, switched by `orientation` (already decided). Don't lock orientation.

**Avoid**
- `maximum-scale` or `user-scalable=no`. iOS ignores them anyway, and they fail WCAG 1.4.4.
- Calling `preventDefault` on document-level touches.
- Swapping shells on resize. A Galaxy Fold being unfolded changes `screen.width`, so freeze the choice at boot.

**Measure:** real iPhone on iOS 26+ in both toolbar states, plus an older iOS 17/18 device; Android with gesture navigation; keyboard open and closed in Library.

Sources: [MDN viewport meta](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport) · [Bram.us on WebKit interactive-widget (11 Sep 2026)](https://www.bram.us/2026/09/11/webkit-supports-interactive-widget-and-hopefully-safari-will-too/) · [WebKit bug 297779, safe-area and Liquid Glass](https://bugs.webkit.org/show_bug.cgi?id=297779) · [Safari 26 fixed overlays](https://www.edoardolunardi.dev/blog/safari-26-and-the-strange-case-of-fixed-overlays) · [Safari 26 toolbar write-up](https://1ar.io/updates/safari-26-liquid-glass-web/) · [Safari 26.0 features](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)

## 4. Touch and gestures

**Do**
- **[M] Use Pointer Events** (iOS 13+, all Android), with `setPointerCapture` and `pointercancel` handling. Use two active pointers for pinch.
- **[M] Use `touch-action` instead of `preventDefault`:**
  - `none` on the lightbox stage, the strip thumb and the map (MapLibre sets this itself).
  - `pan-y` on the photo card if it swipes horizontally.
  - `manipulation` on `html`. That kills double-tap zoom and the tap delay but keeps pinch, so it stays accessible.
- **[M] Svelte 5 makes `ontouchstart` and `ontouchmove` passive by default** (confirmed in `svelte/src/utils.js`), so `preventDefault` inside them does nothing. Use pointer events plus `touch-action`, or an `{@attach}` that calls `addEventListener(..., {passive: false})`.
- **[M] Respect the system back gestures.** iOS Safari's edge swipe (left for back, right for forward) and Android gesture navigation (both edges) can't be cancelled.
  - Keep horizontal drags (filmstrip, strip scrubbing) at least 20–24 px from the screen edges, or accept that a drag starting at the edge means Back.
  - Because the lightbox and sheets push a history entry, an edge swipe closes them for free.
- **[M] History:**
  - `pushState({screen, sheet})` when a lightbox or sheet opens.
  - Close it on `popstate`.
  - The ✕ button calls `history.back()`, not a second push.
  - Use replace-only for `at` and `lb` stepping (eng.md fact 8).
  - On a cold deep link with `lb=…`, insert a parent entry first, so the first Back stays in the app instead of leaving it.
- **[M] Lightbox:** hand-roll it on the existing `lightbox/model.ts` (`step`, `neighbours`): swipe to page, pinch and pan with a CSS `transform` on one `<img>`, double-tap to zoom, swipe down to close.
  - The alternative is PhotoSwipe 5: about 23 KB gz (4.5 KB loader, 16.4 KB core, CSS), no dependencies, last release May 2024. But it brings its own DOM and history handling, which clashes with the `lb` URL contract.
  - Recommendation: hand-roll (about 300–400 lines). Use PhotoSwipe as the fallback if pinch feel doesn't work out on a real device.

**Avoid**
- Mixing touch and pointer listeners on the same element.
- Long-press as the only way to do something.
- Animating `top`/`left` instead of `transform`.

**Measure:** a real iPhone (pinch can't be emulated in Chromium); Android with 3-button navigation and with gesture navigation.

Sources: [MDN touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action) · [caniuse touch-action](https://caniuse.com/css-touch-action) · [MDN Pointer events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) · [PhotoSwipe v5](https://photoswipe.com/v5/docs/getting-started/)

## 5. Images

**Do**
- **[M] Keep your three-step ladder:** thumbhash, then `thumbnail` (about 250 px), then `preview` (1440 px; 1280 on the demo), and only after about 300 ms at rest.
  - Call `img.decode()` before swapping a preview in, so it never flashes blank.
  - A 3-column grid on a 390 px screen has tiles of about 128 CSS px, which wants 256–384 device px. 250 px is soft at DPR 3.
  - So regenerate demo thumbnails at 480 px, as planned. That beats `srcset`, because Immich has only two sizes anyway.
- **[M] Cap decoded pixels, since iOS kills the page without any error event when memory runs out:**
  - A 1440×1080 preview decodes to about 6 MB. Keep at most 3 previews alive (current and ±1), and clear `src` on the others.
  - A grid of about 60 live 480 px tiles is about 55 MB; at 250 px it is about 15 MB.
  - **Never load originals** on the phone. A 24 MP JPEG decodes to about 96 MB, and pinch-zoom is a known way to crash Safari tabs.
  - Pinch zoom works on the preview, up to about 2.5–3×.
- **[M] Virtualise the grid.** The rows have a fixed height (3 columns), so the maths is trivial. Write a small rune-based virtualiser (about 60 lines: scrollTop gives the first row, plus 1 screen of overscan) instead of adding a dependency. `virtua` (Svelte 5 snippets) is the fallback.
  - Remove off-screen `<img>` elements rather than hiding them.
  - Use `decoding="async"` and `loading="lazy"` for grid tiles, and an explicit `width`/`height` or `aspect-ratio` so there is no layout shift.
- **[M] Use one `media.ts` queue** (planned): at most 6 requests in flight, a token bucket under the demo relay's 120 req / 6 s, cancellation with `AbortController` when a tile scrolls out, and 429 back-off.
- **[N] `content-visibility: auto`** (Safari 18+) on Library year sections. It doesn't help inside the virtual grid.
- **[N] AVIF/WebP** are fine everywhere you target (AVIF fully from iOS 16.4). Immich decides the format of its thumbnails, so this is only relevant if you ever transcode in Hono.

**Avoid**
- `preview` per step during a scrub or Play.
- An unbounded `Map` of blob URLs.
- IntersectionObservers that are never disconnected.

**Measure:** the Safari Timelines memory track while flinging the grid and paging 50 photos in the lightbox. Memory should plateau, not climb.

Sources: [caniuse AVIF](https://caniuse.com/avif) · [Apple forum: Safari drops off-screen images near the memory limit](https://developer.apple.com/forums/thread/681328) · [Safari canvas memory limit](https://developer.apple.com/forums/thread/687866) · [web.dev content-visibility](https://web.dev/articles/content-visibility) · [virtua](https://github.com/inokawa/virtua)

## 6. MapLibre on mobile

Facts from the source:
- v6.14 is **WebGL2-only** (`contextType: 'webgl2'`).
- It defaults to `powerPreference: 'high-performance'` and `maxCanvasSize: [4096, 4096]`.
- `maxTileCacheZoomLevels` is 5, and the cache size scales with the viewport.
- `cancelPendingTileRequestsWhileZooming` is already `true`.
- `workerCount` is 1, **except in Safari, where it is half the cores, capped at 3**.
- On context loss it serialises and restores the style, including your sources and layers. Custom layers are not restored.

**Do**
- **[M] `pixelRatio: Math.min(devicePixelRatio, 2)`.** At DPR 3, a 390×844 map has 2.25× the pixels of DPR 2.
- **[M] Handle `webglcontextlost`:**
  - Show `RouteSketch` straight away.
  - On `webglcontextrestored`, call `setStyle(originalUrl)` yourself if the style had not loaded yet. Issue #8690 (open, 6 Oct 2026) leaves the map blank forever otherwise.
  - Chrome on Android reclaims GPU memory from background tabs, so context loss on return is normal, not an edge case.
- **[M] A fallback when there is no WebGL2:** test `canvas.getContext('webgl2')` before importing MapLibre, so the 349 KB isn't downloaded for nothing. Then show `RouteSketch` with a note.
- **[M] Exactly one map for the life of the app.** Hide it with `visibility: hidden`, not `display: none`. Delete `MiniMap.svelte`, which creates a second context.
- **[M] Never resize the canvas repeatedly.** In iOS Safari, repeated WebGL canvas resizes leak memory. Animate the deck with `transform`, then call `map.resize()` once when it settles. Rotation means one resize.
- **[N] Lower the tile cache:** `maxTileCacheZoomLevels: 2–3` on phones; check against memory.
- **[N] Set worker count:** `setWorkerCount(2)` on iOS before creating the map; measure. Each worker parses the 508 KB worker script and keeps its own tile memory.
- **[N] `fadeDuration: 0`** during Play. Fewer repaint frames.
- **[N] `canvasContextAttributes: {powerPreference: 'default'}`.** Lower power, and it avoids the Safari 26 bug #8195 where the context is lost right away (seen on macOS; closed with this workaround).

**Battery:** cost scales with visible map area × time spent moving. An idle MapLibre map does not repaint. Play must be time-based (Low Power Mode caps rAF at 30 fps), it stops on `visibilitychange`, and it is never left running under Library or the lightbox.

**Avoid**
- `preserveDrawingBuffer`.
- High-resolution sprites (#4153 crashes iOS).
- Terrain or hillshade on phones.
- Calling `jumpTo` when the camera hasn't changed.

**Measure:** the planned spike (Play 60 s, a fling scrub, at `pixelRatio` 2 on a Galaxy A-class phone and an iPhone SE): frame time in the DevTools Performance panel, memory in Safari Timelines, and the battery delta over 10 minutes.

Sources: [MapLibre #8690 (Oct 2026)](https://github.com/maplibre/maplibre-gl-js/issues/8690) · [#8195 (Aug 2026)](https://github.com/maplibre/maplibre-gl-js/issues/8195) · [#4153 sprites](https://github.com/maplibre/maplibre-gl-js/issues/4153) · [Mapbox #12906, Safari memory](https://github.com/mapbox/mapbox-gl-js/issues/12906) · [Apple forum: WebGL resize leak](https://developer.apple.com/forums/thread/668999) · [MapLibre Map options](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapOptions/)

## 7. Memory and CPU on low-end devices

**Do**
- **[M] One rAF owner per animation, driven by elapsed time.** Write per-frame visuals (strip thumb, loupe, card transform) straight to the DOM or canvas inside rAF. Don't route every frame through `$state` and an `$effect` chain.
- **[M] Use `$state.raw` (or non-reactive variables) for index columns, typed arrays and GeoJSON.** Deep proxies over large arrays cost CPU and memory.
- **[M] Pause work on `visibilitychange`** (Follow already does) and when Library or the lightbox covers the map. Abort the media queue when the page is hidden.
- **[M] Keep long tasks under 50 ms for INP:**
  - Move `classifyTrips`, density bins and stop derivation to a worker. The `camera.worker` pattern already exists.
  - Otherwise yield with `globalThis.scheduler?.yield?.() ?? new Promise(r => setTimeout(r))`. Safari 27 still has no `scheduler.yield`.
- **[M] Stay bfcache-friendly:** no `unload` or `beforeunload` handlers, close IndexedDB transactions promptly, and no WebSocket. `index.html` being `no-cache` (not `no-store`) is already correct.
- **[M] Read layout once per frame, then write.** Read `getBoundingClientRect` and `clientWidth` in a ResizeObserver or at the start of the frame, never inside loops that also write.
- **[N] A lighter mode on Chromium** when `navigator.deviceMemory <= 2` or `connection.saveData` is set: no preview upgrades on the card, and `pixelRatio` 1.5.

**Avoid**
- `setInterval` animations.
- Leftover `$effect`s that write state they also read.
- Keeping the full library index in memory on a demo visit. Album-first boot is the fix.

**Measure:** DevTools Performance with 6× CPU throttling (long tasks, INP for strip taps), `chrome://inspect` memory on the real A-class phone, and the bfcache tester under DevTools → Application.

Sources: [web.dev bfcache](https://web.dev/articles/bfcache) · [Chrome: bfcache for no-store](https://developer.chrome.com/docs/web-platform/bfcache-ccns) · [scheduler.yield](https://developer.chrome.com/blog/use-scheduler-yield) · [Low Power Mode rAF (WebKit 168837)](https://bugs.webkit.org/show_bug.cgi?id=168837) · [Device Memory API](https://developer.chrome.com/blog/device-memory)

## 8. PWA pieces for demo visitors

Most demo visitors come once, often in an **in-app browser** (Telegram, WhatsApp, Instagram). Those are WKWebView, SFSafariViewController or Android WebView, with no install prompt and a separate storage jar.

- **[S] Service worker in v1.** A first visit gets nothing from it, it adds a startup cost on navigation without navigation preload, and a stale shell is a real risk. Keep it on the roadmap for the owner's offline "last trip" use, as planned.
- **[S] Install prompts.**
- **[N] A minimal `manifest.webmanifest`** (name, icons, `display: standalone`, background colour) and an `apple-touch-icon`, for anyone who adds the page to the home screen. About 2 KB, harmless.
- **[N, cheap and worth doing] Open Graph tags** (`og:title`, `og:image` = a route-plus-photo card, `og:description`) on the demo `index.html`. The link preview in chat is the demo's first impression.

## 9. Test matrix

**Real devices (must-have):**
1. **Low-end Android, 4 GB** (Galaxy A1x/A2x, ideally an A24-class phone). Chrome and **Samsung Internet**.
2. **iPhone SE 2/3** (375×667, 3–4 GB, iOS 17 or 18). The oldest iOS you support, the smallest screen, the easiest to kill.
3. **Current large iPhone** (430×932) on iOS 26/27, with the Liquid Glass toolbar, ProMotion and Low Power Mode on.
4. **[N]** A 2–3 GB Android Go phone as the floor.
5. **[M] The demo link opened from Telegram and WhatsApp** on both iOS and Android, as an in-app browser.

**Emulation:**
- **Playwright** projects `Pixel 7` (Chromium) and `iPhone 15` (WebKit), with `hasTouch` and `isMobile`. Use them for shell selection, layout snapshots at 360×640 / 390×844 / 430×932 plus landscape, history and Back flows, and tap targets. Playwright's WebKit on Linux is not iOS Safari.
- **BrowserStack** and similar real-device clouds: good for checking iOS version spread visually. Too much latency to judge gesture feel or performance.

**What can't be emulated:** iOS memory limits and page kills, GPU fill rate and thermal throttling, the real URL and toolbar chrome and safe-area values, Low Power Mode, real pinch and edge-swipe, Android tab discard, and GPU context loss. For context loss, force it on a real device with `WEBGL_lose_context`.

Sources: [Playwright emulation](https://playwright.dev/docs/emulation) · [chrome://inspect remote debugging](https://developer.chrome.com/docs/devtools/remote-debugging) · [Safari Web Inspector](https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios)

## 10. Accessibility minimums (WCAG 2.2 AA)

- **[M] 2.5.8 Target Size (Minimum):** 24×24 CSS px is AA. Your 44 px rule matches Apple's guidelines and WCAG AAA 2.5.5; keep it. Map badges and pins need a hit area of at least 24 px, even when drawn smaller.
- **[M] 2.5.7 Dragging Movements:** every drag needs a single-tap alternative.
  - Strip: tap to seek, plus ⏮ ⏭.
  - Month-range long-press drag: tap the start month, then tap the end month.
  - Swipe down to close the lightbox: ✕.
  - Card swipe: the arrows or the transport row.
- **[M] 2.5.1 Pointer Gestures:** pinch needs a one-finger path. Use double-tap zoom in the lightbox, and on the map the double-tap or +/− that MapLibre provides.
- **[M] 2.4.11 Focus Not Obscured (Minimum):** the fixed deck and title must not cover the focused element. Use `scroll-padding` in Library and Photos.
- **[M] 1.4.4 Resize Text and 1.4.10 Reflow:** don't block pinch-zoom on the page, and make sure 200% text works in Library, sheets and Story.
- **[M] 1.3.4 Orientation:** no lock (already planned).
- **[M] `prefers-reduced-motion`:** camera jumps instead of flights, no Ken Burns effects, no parallax.
- **[M] The strip as `role="slider"`** with `aria-valuetext` (date and time), and every icon button with a label.
- **[N]** Check with VoiceOver and TalkBack once after phase 1b.

Sources: [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [Understanding 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) · [Understanding 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements)

---

## Top 15 for this app, in priority order

1. **Choose the shell in `main.ts` and make both shells dynamic imports**, so Overview and the Lightbox leave the phone's eager graph. Add a CI check that the phone entry stays ≤ 60 KB gz and doesn't import `overview/`.
2. **Album-first boot**, with data fetches, the shell chunk and `import('maplibre-gl')` all starting at t0 in parallel.
3. **The card `<img>` is the LCP element**, with `fetchpriority="high"`. The map canvas can't count for LCP.
4. **MapLibre settings:** `pixelRatio` ≤ 2, a `webglcontextlost` path to `RouteSketch`, the manual `setStyle` workaround for #8690, and a WebGL2 check before downloading MapLibre.
5. **One map instance:** delete `MiniMap`, never `display: none` the map, and call `resize()` only once things settle.
6. **Root that doesn't scroll** (`position: fixed; inset: 0`, `overscroll-behavior: none`), with `viewport-fit=cover`, safe-area padding and `dvh`/`svh`, tested on iOS 26+ in both toolbar states.
7. **Cap decoded images:** at most 3 previews, no originals, preview only after 300 ms of rest, and `img.decode()` before each swap.
8. **The `media.ts` queue:** at most 6 in flight, a token bucket under 120 req / 6 s, abort on scroll-out, 429 back-off.
9. **History:** push for lightbox and sheets, replace for `at` and `lb` stepping, close on `popstate`, and a synthetic parent entry for cold `lb` links.
10. **Pointer events plus `touch-action`** (`manipulation` on `html`, `none` on the stage and strip). Remember that Svelte's touch handlers are passive. Keep drags away from the screen edges.
11. **A hand-rolled lightbox** (pager, pinch on the preview, double-tap, swipe down), with PhotoSwipe 5 lazy-loaded as the fallback.
12. **Time-based Play** that pauses on `visibilitychange` and under overlays. Per-frame visuals stay outside Svelte reactivity; use `$state.raw` for large data.
13. **Preconnect to `tiles.openfreemap.org` with `crossorigin`**, plus an inline phone skeleton in `index.html`.
14. **Real-device runs:** an A-class Android (Chrome and Samsung Internet), an iPhone SE, and a large iPhone, plus the demo link opened from Telegram and WhatsApp. Get Mac access for Safari Web Inspector. Playwright mobile projects cover regressions.
15. **Accessibility items:** tap alternatives for every drag and pinch, the strip as a slider, reduced motion, focus not hidden behind the deck. Cheap to add now: Open Graph tags and a minimal manifest. Skip the service worker, install prompts, zstd and speculation rules for demo visitors.
