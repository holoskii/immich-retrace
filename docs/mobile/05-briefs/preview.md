# Brief: preview (photo viewing)

Read first: `../04-decision.md`. Output: `../05-categories/preview.md` and `../mockups/preview.html`
(root classes `.mk-preview-<variant>`).

## Constraints from the decision
- Photos screen (phase 1) and Story view (phase 2) are one component (`storyLayout.ts`): selection
  in time order, day chapters, stop headers, transit breaks, no-GPS photos inline with a badge,
  exact heights from `ratio`, virtualised. Phase 1: scroll never moves the cursor; tap = cursor +
  lightbox. Phase 2: docked map, scroll → cursor per row (current row = first row under the
  sticky chapter header, shown by A's spine).
- Docked card in Replay: thumbhash → `thumbnail` while moving → `preview` after 300 ms rest.
- Lightbox: full-bleed pager; swipe ←/→ by photo (history replace), swipe ↓ closes to the cursor,
  pinch/double-tap zoom (paging off while zoomed), tap toggles chrome, visible ✕, video with native
  controls muted autoplay, day-segmented progress, info sheet (time + UTC offset, place, coords,
  static SVG route, credits/Open in Immich, Share). No second MapLibre.
- Media: `thumbnail` ~250 px, `preview` ~1440 px (demo 1280); ≤ 3 decoded previews, ±1 preload,
  ≤ 6 requests in flight, ≤ 60 per 6 s.

## Variants to explore
1. **Story density**: A's justified rows (~108 px) with a full-width hero per stop.
2. **Compact grid**: 4-column square grid with sticky day/stop headers and a fast-scroll rail;
   pinch switches to Story density.
3. **Lightbox with filmstrip**: stop-segmented mini filmstrip under the photo (A/B) vs none
   (D: Photos is one tap away) vs a vertical "story pager" (one stop per page).

## Questions the variants must answer
- Find-one-photo in a 600-photo trip: how many gestures from the trip to the photo?
- How do tiles look while flinging (thumbhash) and when they settle; how soft is 250 px at
  DPR 3 on each tile size?
- Where does the cursor photo show in the grid, and how does the user get back to it?
- Video: badge in the grid, autoplay rules in the lightbox, how swipe and the scrubber of the
  native controls coexist.
- Info sheet: peek height, what is visible without pulling, how the static route shows position,
  how no-GPS photos read ("no location · near Yesa").
- Lightbox across stop/day boundaries: does the progress or filmstrip show the jump?
- Prefetch policy: what is preloaded in the grid ahead of scroll, around the lightbox, and on
  the card while Play runs, within the request budget?
- Long-press on a tile: preview, "Show on map", Share, or nothing?
