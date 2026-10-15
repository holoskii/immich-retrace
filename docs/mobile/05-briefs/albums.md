# Brief: albums (Library, trips, search, ranges)

Read first: `../04-decision.md`. Output: `../05-categories/albums.md` and `../mockups/albums.html`
(root classes `.mk-albums-<variant>`).

## Constraints from the decision
- Library is a pushed screen (owner home; demo: one tap from the trip title). No tab bar.
- Paints from `/api/albums` immediately (names, dates, counts); verdicts, GPS share, stop counts,
  route sketches and month densities upgrade when the index lands. Never one members request per
  card.
- Contents: search (album name, year, place from index `city`/`country`), trip cards with verdict
  as text (`trips.ts`), Trips | All albums, year rows with 12 month cells (tap = month,
  long-press-drag = month range with live count), Custom dates (two native date inputs), All
  photos (clear).
- Every result opens a contiguous selection (album, month, range, or a visit via `zoomInto`).
  No place filter.
- Share = current URL via `navigator.share`, copy fallback.
- Targets ≥ 44 px, whole month cell is the hit area, no-GPS hatched not dimmed.

## Variants to explore
1. **List-first**: search on top, trips newest first, years collapsed below (D r2 Trips).
2. **Years-first**: one row per year (sparkline), trips nested under their year, expand year →
   month cells (C rev. 2 / A v2 Home).
3. **Map of trips on top** (C·4): clustered trip markers over a short map, list below; panning
   filters the list only (chip "In view · 5 of 6 ✕").

## Questions the variants must answer
- Scale: 6 trips (demo) vs 150 albums over 20 years; what stays fast to scan?
- Search: how do place results read ("Huesca · Tue 10 Sep 2024 · 92 · in San Sebastián to
  Huesca"), what is shown before the index has loaded, empty results?
- Range selection: is long-press-drag across month cells discoverable; what does the range bar
  show; how does Custom dates look at 360 px?
- Album vs "all photos in these dates": where is that switch (card action, trip ⋯)?
- Non-trip albums (birthdays, "Best of"), very long albums, albums with no GPS at all: what does the
  card and then the trip screen say?
- Empty states: no albums, empty month, index still loading, index failed, offline with cache.
- Previous / next trip: from Library cards, end of Story, or both?
- Cost of variant 3 (full index for centroids, second clustered source, thumbnail images) vs value.
