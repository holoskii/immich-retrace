# Brief: timeline (time navigation)

Read first: `../04-decision.md`. Output: `../05-categories/timeline.md` and `../mockups/timeline.html`
(root classes `.mk-timeline-<variant>`).

## Constraints from the decision
- No wave, no brush, no 7 px grips on the phone. The all-years overview is the Library's year rows
  with month cells (tap = month, long-press-drag = month range, Custom dates as the non-gesture
  path); its visuals belong to the albums brief, its gesture rules to you.
- In the trip, time lives in the fixed deck: one horizontal strip band (`touch-action: none`,
  ≥ 44 px tall hit area, inset ≥ 16 px from edges) + transport ⏮ ▶ ⏭ by stop. Stops from
  `stops.ts`; stop ticks on the strip.
- Scrub = `markScrub()` (camera flies); seek = snap. Fast flings write the cursor only on settle.
  `at` is `replaceState` only.
- Play = `play.ts` timings unchanged; any touch on the strip stops it; reduced motion = 2.5 s step,
  no momentum.
- Slider semantics (`role="slider"`, value text, arrows = photo, Page Up/Down = stop).
- Story view (phase 2) uses the same transport bar; its scroll moves the cursor per row.

## Variants to explore
1. **Thumb-under-finger density strip** (D/C, reuses `TimeStrip`): drag the cursor, tap to jump,
   pinch on the strip zooms time around the cursor (`zoomAt`), day labels, stop ticks.
2. **Fixed-playhead film** (B v2): drag the film under a centre line, two levels (Stops clips /
   Photo frames), detents at cuts, sticky day label, density band on the top edge.
3. **Hybrid strip**: density strip at rest that turns into frames under the finger while
   dragging (magnifier/loupe above the thumb showing the photo at the cursor), no level switch.

## Questions the variants must answer
- Precision: on 250–330 px for 194 photos (and for a 2 000-photo month), can a thumb land on one
  photo? What carries the fine steps (pinch, loupe, ⏮ ⏭, lightbox)?
- Discoverability for a first-time demo visitor: what do they try first, and does it work without
  a coach bubble?
- How does the strip show no-GPS photos, empty days and long gaps (multi-day transit)?
- What does the cursor time label look like and where (finger must not cover it)?
- Play: where does the ▶ live, what does it look like playing vs paused, does the deck collapse
  while playing, how does it end (end of trip → next trip?).
- Selecting a period inside a trip ("just Monday"): day chips, cluster zoom, or nothing? Is D's
  Narrow worth its cost? Evaluate against Custom dates.
- Reduced motion and screen-reader behaviour of each variant.
