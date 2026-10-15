# Brief: map

Read first: `../04-decision.md`. Output: `../05-categories/map.md` and `../mockups/map.html`
(root classes `.mk-map-<variant>`).

## Constraints from the decision
- Exactly one MapLibre instance for the app's life; `pixelRatio ≤ 2`; context-loss and
  tile-reload-on-show handled; rAF stops when settled, hidden, under Library or lightbox.
- Follow camera (`camera.ts`, `follow.ts`) is kept; it needs `Follower.insets` for the pill and
  the deck (insets change on state changes only, never per frame).
- Replay view: map fills the screen above a fixed deck; Follow / Fit (44 px) in the right thumb
  arc; ⓘ legend sheet replaces the legend overlay and the inset canvas; no zoom buttons, no
  rotation. Pan/pinch pauses Follow; a "Follow" pill resumes.
- Cluster tap → fixed-height visits sheet → Zoom to these days (`zoomInto`) / Jump here (seek)
  / "Also here" trips. Pin tap = seek. No hover; no non-contiguous place filter.
- Story view (phase 2): docked passive map (`pointer-events: none`), frames the current stop,
  flies only across transits; tapping it switches to Replay.
- Dark basemap in v1. No-GPS cursor photos: marker holds at the last known position, hollow.

## Variants to explore
1. **Route-first**: route line coloured by time, photo pins as dots, clusters as count bubbles
   (desktop symbology made finger-sized).
2. **Thumbnail clusters**: clusters and stops drawn as photo-thumbnail bubbles (Apple Places),
   numbered stop markers (B v2), pins only at street zoom.
3. **Stop-centric**: the map shows stops (numbered, sized by count) and the route between them;
   individual photos appear only within the current stop's frame.

## Questions the variants must answer
- What does the map look like at 3 sizes: Replay (≈ 600 px tall), Replay while playing (deck
  collapsed?), Story docked (160–280 px), and landscape left column?
- How big are hit targets for pins and clusters, and how do overlapping ones resolve on tap?
- What replaces the desktop hover preview (thumbhash + time) before committing to a tap?
- When the user pans away, how is "you left Follow" shown, and what brings it back (pill, ⏮ ⏭,
  Play, new selection)?
- How does Fit vs Follow read at a glance; what does Fit frame (trip, stop, visible range)?
- How do gaps (> 4 h, dashed) and long flights look at phone zoom without clutter?
- Visits sheet layout: one visit vs five; what is "Also here" and when is it hidden?
- Cost: which variant needs `addImage` per marker or extra sources, and what does it do to frame
  time during Play?
