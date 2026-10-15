# Brief: navigation (app shell)

Read first: `../04-decision.md` (§2 shape, §6 requirements). Output: `../05-categories/navigation.md`
and `../mockups/navigation.html` (root classes `.mk-navigation-<variant>`).

## Constraints from the decision
- Stack, no tab bar: Library (home) → Trip (Replay view; Story view in phase 2) → Lightbox.
  Sheets (visits, day list, info, ⋯, legend) are overlays, not screens.
- Shell chosen at boot by `(pointer: coarse)` + short screen side ≤ 500 px; rotation never swaps
  shell or remounts the map.
- URL contract unchanged (`from/to`, `album[&mode=range]`, `at`, `lb`); optional phone-only `view`.
  Selection changes and screen pushes push history; `at` replaces (≤ 1/s).
- Back order: sheet → lightbox → pushed screen → previous selection (zoom stack). Never trap.
- Demo `/` lands in the trip (Replay), ▶ pulses once; owner `/` lands in Library.
- Nothing draggable within 20 px of screen edges; targets ≥ 44 px; dark v1.

## Variants to explore
1. **Title-as-switcher**: the floating two-line pill (D r2) is the only top chrome; tap the trip
   name → Library; ⋯ holds Share, album/range mode, About, Settings. View switch (Replay / Story)
   lives in the bottom transport bar.
2. **Bottom app bar**: a slim bottom bar under the deck with Library · trip name · ⋯; the top of
   the map is chrome-free except a readout chip. View switch as a segmented control in that bar.
3. **Edge-less sheet nav**: Library is a full-height sheet that slides up over the trip (still a
   history entry, fixed, not draggable), so the map stays alive underneath and "pick another trip"
   never feels like leaving.

## Questions the variants must answer
- How does a first-time demo visitor learn this is a demo and find About / "Get it for your
  Immich" without a 136 px banner? Where do credits live?
- Where is Settings (index refresh interval / Refresh now / last checked, units, theme later)
  and how many taps away?
- Does Library as a history entry without URL params behave well on reload and on a shared link?
  Should `view` and "Library open" be in the URL?
- How does "← Back to trip" after a cluster zoom read, and can the user tell system Back from
  "previous selection"?
- What happens when a deep link targets missing data (album deleted, `lb` id gone, empty range)?
- Landscape: where does each piece of chrome go (map left ~58%, right column)?
- 360×640: what collapses first?
