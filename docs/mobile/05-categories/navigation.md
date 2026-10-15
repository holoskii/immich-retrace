# 05 · Navigation (app shell)

Brief: [`../05-briefs/navigation.md`](../05-briefs/navigation.md). Mockup:
[`../mockups/navigation.html`](../mockups/navigation.html) (root `.mk-navigation`, one section per
variant: `.mk-navigation-v1` / `-v2` / `-v3`). Screens: `../screens/navigation.jpg` (1400 px, dark),
older `../screens/navigation-{dark,light}.jpg`. Demo data only. Respects 04-decision §0, §2, §4, §6
and the cross-cutting decisions of [`../06-review.md`](../06-review.md) §1 (they win on conflict).

Terms follow 06 §1.2: **Title** (two-line block, name ⌄ / line 2), **Card**, **Strip**, **Transport
row** (view switch · ⏮ ▶ ⏭ · stop label), **View switch** `Replay | Photos` (phase 2 `Replay |
Story`), **Status slot**, **Stop**, **Visit**. Demo trip: San Sebastián to Huesca, 6–10 Sep 2024,
194 photos, 6 stops (San Sebastián 4 / 10, Yesa 41, Santa Cruz de la Serós 47, Huesca 44 / 48);
Sun 8 Sep has 0 photos and is a fold on the strip.

## A. Rules shared by every variant

These answer the brief's questions once; the variants only differ in where the chrome sits.

### A1. History model

One linear browser history. Each entry is a URL (the desktop contract) plus `history.state`
for phone-only facts that must never reach a shared link.

| Action | History | URL | `history.state` |
|---|---|---|---|
| Open a trip / month / range / search hit from Library | push (see A2 for "replace") | `album` / `from,to` | `{}` |
| Visit → Zoom to these days | push | `album&from&to` (`sub`) | `{parent: <key of previous entry>}` |
| **Only this day / Only this stop** (⋯ rows, strip long-press action sheet) | push | `album&from&to` (`sub`) | `{parent: …}` |
| **Also here** (visits sheet / lightbox info: another album with a visit to this city) | push | `album=<other>&at=<first photo there>` | `{}` |
| Open Library over a trip | push | **unchanged** | `{screen: 'library'}` |
| Open a sheet (visits, ⋯, Settings, About, ⓘ, info) | push | unchanged | `{sheet: 'visits'…}` |
| Open lightbox | push | `+lb` | as is |
| Lightbox step, scrub, Play, ⏮ ⏭, Story scroll | replace, ≤ 1/s | `at`, `lb` | kept |
| View switch Replay ⇄ Photos (phase 2: Story) | **replace, from phase 1** | `view=photos\|story` (absent = Replay) | kept |
| Album ⇄ "all photos in these dates" | push | `mode=range` | `{}` |

- **Back order falls out of chronology**: sheet → lightbox → Library → previous selection, because
  each was pushed after the last. No special-casing, and no synthetic entries: Back never goes
  somewhere the user has not been. A cold deep link (or the demo landing) has nothing behind it,
  so Back leaves the site; Library is the title tap. That is the "never trap" rule.
- **UI close = `history.back()`.** ✕, Done, swipe-down (lightbox only), scrim tap all pop their own
  entry, so the UI and system Back can never disagree. On boot, entries with `state.sheet` are
  dropped (`replaceState` without it): a reload never reopens a sheet.
- **No custom transition on `popstate`.** iOS Safari's edge-swipe already animates a snapshot; a
  second slide on top looks broken. Animate only taps inside the app (push and in-app close).
- **Photos is a view of the trip, not a screen** (06 §1.4, amends F7, accepted). It keeps the title
  and the transport row; there is no `‹ Map` or `‹ Library` header. The switch replaces: after
  Replay → Photos → Replay → Photos, a pushing switch would make Back flip lenses four times before
  leaving the trip. Back from Photos leaves the trip, same as Back from Replay. "Show on map" =
  switch to Replay + set the cursor. `view` is in the URL from phase 1, so a shared Photos (later
  Story) link opens that view; desktop ignores it.
- **Lightbox from the Photos view** closes back to that view (it is in the URL).

### A2. Picking from Library

- **Owner root** (`/`, no selection) *is* Library. Picking a trip pushes. Back from the trip returns
  to Library at its scroll position (kept in the Library component; it stays mounted).
- **Library opened over trip A, then trip B picked**: B **replaces** the Library entry. Result:
  `[… A, B]`. Back from B → A (with A's `at`), not Library → A → Library ping-pong. Desktop's
  album picker behaves the same (one entry per pick).
- **Closing Library without a pick** (‹ Trip, Back) pops it: no entry left.
- **"All photos"** writes an explicit `from=<first day>&to=<last day>` instead of an empty query,
  because the owner's empty `/` means Library. The link still opens "everything" on desktop.
- **No synthetic history**: a single-photo album opens the trip (card + one pin), not the lightbox.
- **Next trip** (end card) is chronological across trips (`trips.ts`), whatever tab it came from.

### A3. Library and `view` in the URL

- **Library is not in the URL.** It lives in `history.state.screen`, which survives reload in iOS
  Safari 17 and Chrome 120 (same-document state is persisted with the session entry). Reload with
  Library open → Library again over the same trip. A copied or shared URL never contains
  Library, so the recipient lands on the trip, which is what was being looked at underneath.
  Share is not offered on the Library screen at all.
- **`view` is in the URL** (A1). Missing or unknown → the default view, **chosen once**, when album
  members arrive: Replay, or Photos if 0 rows have GPS (an empty map is not a landing). Until then
  the trip shows the cold state (A12). It never switches by itself after that first paint.

### A4. Zoom stack: "Back to the trip"

- After a zoom, line 1 of the title shows the place (`Yesa · 41 photos`), line 2 the parent
  (`in San Sebastián to Huesca · Mon 9 Sep`, static), and a **‹ button** (44 px) sits at its left
  with `aria-label="Back to San Sebastián to Huesca"`. Drill-up is always this ‹, named for its
  destination (never `← Back to trip` or `← Whole trip`).
- **‹ and system Back are the same action by construction**: ‹ calls `history.back()` when
  `state.parent` matches the previous entry; otherwise (after a reload, or a cold deep link to a
  `sub` URL) it **pushes** the parent derived from the URL (`album` without `from/to`, or the
  enclosing trip via `zoomName`). Today's in-memory `selection.stack` is lost on reload; deriving
  the parent from the URL fixes that on the phone and could be ported to desktop.
- ‹ appears **only** for drill-downs (visit zoom, Only this day / stop). After a Library pick or
  Also here there is no ‹: system Back still goes to the previous trip, but that is "history", not
  "up". ‹ always names its destination; the title tap always opens Library.
- First zoom per session: `Zoomed to Yesa · ‹ or Back returns` in the **status slot** (06 §1.5,
  priority 4: below notices, the Follow chip and the undo chip), 3 s, also the polite live-region
  text. Shown under reduced motion too, without the slide-in.

### A5. Missing data in deep links

| Link | Today (desktop) | Phone |
|---|---|---|
| `album` not in the list (deleted, unshared) | `selectionFromUrl` → null → all photos, silently | Owner: Library with an inline notice at the top: *That trip isn't in this library any more (deleted, or no longer shared with you).* URL `replaceState` → `/`. Demo: the demo trip + a status-slot notice. |
| Album members fail to load (403, network) | `membersLoad.error` | Trip screen with title from the album list, card slot = error + Retry; Library still one tap. API failure → session probe first (A13). |
| `lb` id gone or outside the selection | `pendingLb` drops it silently | Trip at `at` (or representative row), status slot *That photo is no longer here*, `replaceState` without `lb`. |
| `from/to` with 0 photos | empty wave | Trip screen, map fitted to the library's last view; the one shared empty text in the card slot: `No photos 3–9 Mar 2021` + `‹ 28 Feb · 12` / `14 Mar · 40 ›` + `Library`. |
| Unparseable (`to < from`, garbage) | null → all photos | Owner: Library with *Couldn't read that link.* Demo: landing. |
| `view=story` before phase 2, or WebGL lost | n/a | Falls back (Photos / Replay with static sketch); URL left as is so it works later. |
| `at` outside the selection | ignored | ignored (representative row), no message. |

Library notices are text in the content (not modal), dismissible, `role="status"`. Trip-screen
notices go to the status slot.

### A6. Demo pitch, About, credits

- **`DEMO` chip** in title line 2 (amber outline, 44 px hit area,
  `aria-label="Demo with sample photos. About this demo"`). Tap → **About sheet** = 1 tap.
- **About sheet**: one-line pitch, **Get it for your Immich →** (primary button), credits summary
  (*Photos: Kent Wang via Wikimedia Commons, CC BY / CC BY-SA, some metadata changed*), "What the
  demo changed" list (collapsed), map attribution. Same content as `About.svelte`, sheet layout.
- **End of Play = end card** (06 §1.6; timeline owns the behaviour, this is the slot): ▶ becomes ↺,
  the stop label reads `End of trip`, and the card slot shows `5 days · 194 photos · 6 stops` +
  `Next trip ›` (owner and demo) + `Get it for your Immich →` (demo only, the earned pitch). A touch
  on the strip or ⏮ restores the normal card. Library in demo ends with the same one-line pitch.
- **Per-photo credits** in the lightbox info sheet (preview owns layout): *Kent Wang · CC BY-SA 4.0
  · GPS removed for the demo*.
- **Map attribution**: an 11 px `© OSM` text button at the map's bottom-left above the deck → the
  ⓘ sheet, scrolled to its attribution section.
- No banner, no first-visit toast about the demo; the only coach is the Play pulse (F8).

### A7. Settings

- Owner only (the demo has nothing to configure; ⋯ shows About instead).
- **2 taps from a trip** (⋯ → Settings), **1 tap from Library** (⚙ in its header).
- Sheet contents: *Refresh library*: `When opened · Hourly · Daily · Only when I tap` (default
  Hourly on the phone; F9/§6.2 forbid a full refresh every visit on cellular), **Refresh now**,
  *Last checked 12 min ago · 41 802 photos · 152 albums* (live while refreshing), *Rebuild cache*
  (replaces desktop ⋯ cache rebuild, confirm inline), *Motion follows the system setting* (info
  row), version + About Retrace. Theme row added when light chrome ships (Q6).
- A 6 px dot on ⋯ / ⚙ while a background refresh runs (desktop `busy` dot).
- ⋯ → Settings swaps the sheet content and **replaces** the ⋯ entry: one Back closes it.

### A8. Focus and screen readers

- Push → focus the new screen's `h1` (Library, trip title button); pop → restore focus to the
  control that opened it. Sheets: `role="dialog"`, `aria-modal`, focus trap, rest `inert`.
- Selection changes announce once (polite): *San Sebastián to Huesca, 6 to 10 September 2024,
  194 photos*; zoom: *Zoomed to Yesa, 41 photos; Back returns to San Sebastián to Huesca*.
- The title block is a `<header>` with one `<button>` (the title, *Open library*), the ‹ and ⋯
  buttons, and the DEMO button; line 2 is plain text inside the title button's label.
- Counters are spelled out for screen readers ("photo 32 of 194, stop 3 of 6").
- **200 % text** (mockup V1·6, 360 × 640): the deck is measured at that size, constant per resize
  (264 px there). The title wraps to 2 lines; never truncated without the full name in the
  accessible label. The card keeps 3 lines with a 60 px thumbnail; the counter line ellipsizes
  first. The A9 steps 1–5 all apply.

### A9. 360 × 640: collapse order

Budget at 360 × 640 (SE-class, 20 px status bar, no home indicator): deck 200 px (card 72, strip
64, transport 56, 8 bottom), map 0 → 440. Collapse in this order, first item first; never collapse
the title tap, ‹, ⋯, strip, ▶.

1. Title line 2 shortens: `DEMO · 6–10 Sep · 194` (the year goes).
2. Card thumbnail 64 → 60 px; the place line truncates. The card keeps 3 lines.
3. Transport stop label (`Yesa · stop 3 of 6`) hides; it stays in the strip's `aria-valuetext`.
4. View switch shows icons only (labels in `aria-label`).
5. Follow and Fit merge into one toggle (map category); ⓘ stays.
6. V2 only: the bottom app bar title shortens to the first word + `…` (its weak point).

At 100 % text, steps 1–3 apply (mockup V1·5); at 200 % all five do (V1·6).

### A10. Landscape (06 §1.8)

Map left 58 %, **no title over it**. A right column (42 %) holds the title, then card, strip and
transport row. Map insets t = 12 + safe area. Follow / Fit / ⓘ: the same vertical stack,
bottom-right of the map column; `© OSM` bottom-left; the status slot centres at the bottom of the
map column. Spare column height goes to a **larger card** (96 px thumbnail), so the column never
sits half empty. The view switch is icon-only there (column width). Sheets open **inside the right
column** (column width, full column height), so the map stays visible. Library and the lightbox
take the whole screen (Library in 2 columns of cards); the lightbox info sheet becomes a 320 px
right panel. **Photos (phase 1) goes full width.** Safe areas: the notch side gets
`env(safe-area-inset-left/right)`; the column never moves sides on rotation.

### A11. Edge cases common to all variants

- **No GPS in the trip**: lands in Photos (A3, decided once); title line 2 stays `DEMO · dates ·
  count`; Replay still reachable (the map shows the empty-state text in the card slot).
- **Single photo**: title `<name> · 1 photo`; ▶ ⏮ ⏭ hidden; card + one map pin. A single-photo
  album opens the trip, not the lightbox (overrides albums).
- **Huge selection** (all photos, 41 802): title `All photos` / `2006 → 2026 · 41 802`; zoom chains
  show only the immediate parent in ‹ (desktop shows the same).
- **Slow network / cold**: see A12.
- **Offline**: status slot `Offline · saved 2 h ago` (priority 1 notice, transient), never title
  line 2; Settings' Refresh now disabled with the reason.
- **External links** (Get it, Open in Immich) open a new tab; never navigate the app's tab away.

### A12. Cold trip screen (deep link, members loading)

Mockup V1·3. In order:

1. Title paints from `/api/albums` (name, dates, count), so the title tap (Library) and ⋯ work
   from the first frame.
2. Map: plain dark background, no tiles, no spinner. Members arrive → `RouteSketch`; tiles fade in
   last. Follow / Fit are disabled until the route exists.
3. Card: skeleton, then the thumbhash of the `at` photo (or the representative row) once members
   arrive.
4. Strip: skeleton bars on a neutral axis, replaced by the folded axis when the index for the album
   is in.
5. ▶ ⏮ ⏭ disabled; the stop label slot reads `Loading 194 photos…`. The demo pulse runs only once
   ▶ is enabled.
6. The view switch is inert until members arrive; that moment fixes the default view (A3).

### A13. Session expired behind the auth proxy (owner)

The proxy answers an expired session with a cross-origin 302, so `fetch` fails exactly like
offline. On any API failure, probe once with `fetch(url, {redirect: 'manual'})`: a response of
type `opaqueredirect` = signed out; a network error = offline. Signed out shows a persistent,
full-width notice in the status-slot row, above every other occupant: `Signed out · Reload to sign
in`. "Reload to sign in" is a plain link to the current URL, so the proxy's login runs as a
top-level navigation (it can't run inside `fetch`). Never show "offline" for this case. Cached
index, trips and thumbhashes keep rendering; media that fail stay on thumbhash. The demo has no
proxy, so this state is owner-only.

### A14. Status slot (06 §1.5, used by A4, A5, A11, A13)

One position, centred 12 px above the deck (landscape: bottom of the map column), 44 px tall,
≤ 358 px wide, `role="status"`, one occupant at a time. Priority: notices (`Link copied`, `That
photo is no longer here`, `Offline · saved 2 h ago`, `Photos are loading slowly`; Signed out
outranks them all and is persistent), then the Follow chip, then the undo chip, then the
first-zoom hint. In the Photos view it holds the `↑ / ↓ 16:57` cursor chip.

## B. Variants

### Variant 1 · Title as switcher

**Idea.** The floating two-line title (D r2) is the only top chrome. Line 1 = trip name + ⌄,
line 2 = `DEMO` chip · dates · count (static). Tap the name → Library. ⋯ (06 §1.6 order) =
Library · Only Mon 9 Sep · 88 / Only Yesa · 41 · Album photos / All photos in these dates (radio
rows with counts, only when they differ) · Share link · Open in Immich (owner) · Settings (owner)
/ About this demo & credits (demo). The view switch is the left element of the transport row,
⏮ ▶ ⏭ in the middle, the stop label right.

**Screens** (mockup V1·1–7): demo landing; after a stop zoom (‹ in the title, hint in the status
slot); cold trip screen; Settings sheet; 360 × 640; 360 × 640 at 200 % text; landscape.

**Gestures.** Taps only on chrome. Map owns pan/pinch; the strip owns horizontal drag
(nothing starts within 20 px of a screen edge). Sheets: fixed height, no grabber, close by ✕,
scrim tap, Back; no drag. Long-press 500 ms opens the shared bottom action sheet.

**Costs / risks.** The title sits at y 52–112: a stretch for a thumb on a 6.7" phone, but it is
used rarely (Library, ⋯), and the high-frequency controls (strip, ▶, card, switch) are in the
deck. Library is also the first ⋯ row. The title covers ~60 px of map; Follower insets already
account for it.

**Fit with other categories.** Map: top inset = title bottom + 8; Follow / Fit / ⓘ bottom-right.
Timeline: owns the strip/transport, shares the row with the 2-segment switch (≥ 120 px).
Albums: Library is a pushed screen with `‹ Trip`, search at the top, ⚙/DEMO. Preview: lightbox is
above everything; ‹ in the title is hidden under it.

### Variant 2 · Bottom app bar

**Idea.** A 52 px bar under the deck (plus the home-indicator inset): `Library` (icon + label) ·
trip name (1 line, tap = Library too) · view switch (two icon segments) · ⋯. The map top is
chrome-free except a readout chip top-left (`DEMO` + after a zoom, `‹ Yesa`). In Library the same
bar becomes `‹ Trip` · search field · ⚙.

**Screens** (mockup V2·1–3): demo landing; the ⋯ sheet in the demo (shared content, §1.6 order);
owner Library after a link to a deleted album (notice + V2's bottom search).

**Strengths.** Everything navigational is reachable one-handed.

**Costs.** 52 + 34 px of permanent chrome under the 230 px deck: the map ends at 562 instead of
614, the exact cost 04 §2.4 rejected the tab bar for. The trip name is one line in ~180 px
(`San Sebastián to Hu…`); line 2 has nowhere to go but the chip. ▶ sits 86 px higher. The zoom ‹
is far from the title it modifies (top chip vs bottom name). At 360 × 640 the map is ~260 px tall.
Bottom search was its best piece, and 06 §1.4 drops it too: the Library range bar and hint use the
bottom, iOS Safari's own bottom URL bar would stack under a second bottom bar, and the keyboard
moves a bottom field anyway.

### Variant 3 · Edge-less sheet nav (Library as a fixed full-height sheet)

**Idea.** Library slides up as a sheet that stops 76 px below the top, leaving a dimmed **peek** of
the trip (map + `San Sebastián to Huesca · Return`). Not draggable; it closes by Done, the peek
tap, or Back. It is still a history entry (`state.screen`), and the map underneath stays mounted
(its rAF is stopped under Library per §6.2, so "alive" is visual, not animated).

**Screens** (mockup V3·1–2): Library sheet over the demo trip; owner cold start (`/`) where a trip
must exist beneath the sheet.

**Strengths.** "Pick another trip" feels like a detour, not leaving; the peek shows what Back
returns to.

**Costs.** (1) **Owner root has nothing underneath.** `/` either boots a trip (last opened) to have
a peek, paying MapLibre + tiles on every cold start, or shows a full-height sheet without a peek,
making Library look different at root than over a trip. (2) A sheet with a top peek reads as
draggable (iOS page sheets are); refusing the drag frustrates. (3) Library scrolls inside a sheet:
the rubber-banding 04 §4 rejected. (4) The peek costs 76 px of a list that wants every row.

## C. Edge-case matrix per variant

| | V1 title | V2 bottom bar | V3 sheet |
|---|---|---|---|
| No GPS | lands in Photos; line 2 unchanged | same | same as V1 |
| Single photo | title + card + one pin | bar + card | as V1 |
| Huge selection | line 2 `2006 → 2026 · 41 802` fits | count won't fit in the 1-line bar | as V1 |
| Cold trip | title from `/api/albums`, skeleton card/strip, ▶ disabled | bar from `/api/albums`, same deck | sheet opens over a loading trip |
| Landscape | title → column top | bar → column bottom (fine) | sheet → column? Library full-screen (inconsistent) |
| 360 × 640 map height | 440 (356 visible below the title) | ~260 px | as V1 |
| One-handed reach to Library | top, or ⋯ first row | bottom (best) | top |

## D. Recommendation: Variant 1

**Variant 1 (title as switcher)**, because:
1. It spends no permanent band: the map keeps 52 px more than V2 at 390 × 844 and far more at
   360 × 640, where V2's map drops to ~260 px.
2. The two-line title holds what a viewer needs to read (name, dates, count, DEMO, zoom parent);
   V2 has one truncating line, V3 adds nothing here.
3. Zoom ‹ sits next to the name it modifies, so "Back to the trip" and "open Library" are two
   adjacent, distinct targets with distinct labels.
4. It is what the decision already drew and costed (D r2 Map tab); V3's only real benefit (no
   remount) is given to every variant by keeping the trip mounted under Library.

**Borrowed from V2**: **Library as the first ⋯ row** for one-handed users on large phones. Bottom
search is **not** borrowed: Library search stays at the top (06 §1.4).

**Rejected from V3**: the peek sheet (root inconsistency, drag expectation, nested scroll).

**Owner open questions this adds**: none new; Q9 (demo pitch) is answered by A6 (DEMO chip +
About sheet + end card, no banner).

## Revised after review (06 §3, navigation)

- A1: `Only this day / stop` and `Also here` added as push rows; the view switch replaces with
  `view=` in the URL **from phase 1** (amends F7); Photos is a view, not a screen.
- A3: default view decided once when members arrive, never switched after.
- A4: first-zoom snackbar → status slot, priority 4; zoom title `Yesa · 41 photos`, static line 2.
- A6: end card per 06 §1.6 (↺, `End of trip`, card-slot summary, `Next trip ›` for owner and demo,
  Get it in the demo).
- A11: offline moved out of title line 2 into the status slot; single photo opens the trip.
- A8/A9: 200 % text spec; collapse order rewritten (line 2 never held the clock).
- A10: landscape per 06 §1.8 (no title over the map, vertical Follow/Fit/ⓘ, larger card,
  Photos full width).
- New A12 cold trip screen, A13 session expired (opaqueredirect probe), A14 status slot.
- §D: bottom Library search dropped; Library stays the first ⋯ row. V2 now rejected outright.
- Mockup: map clusters → map V3 stop badges (1–2 · 14, 3 Yesa · 41 current, 4 · 47, 5–6 · 92);
  strip redrawn from the timeline's folded axis (Sun 8 is a fold, no bars); card `13:20 Mon 9 Sep /
  Yesa, Navarra / 32 / 194 · stop 3 of 6`; Library frames use the albums card and demo numbers
  (6 albums, 1 688 photos, 2026 288 · 2025 505 · 2024 830 · 2023 65); landscape Follow/Fit/ⓘ as a
  vertical stack with the larger card filling the column; V2·2 ⋯ uses radio rows with counts
  (194 / 201) in the §1.6 order; Follow/Fit labels and all chrome text ≥ 11 px; callouts pink and on
  the frame margin; deck a constant 230 px; added V1·3 cold trip, V1·5 360 × 640, V1·6 200 % text.
