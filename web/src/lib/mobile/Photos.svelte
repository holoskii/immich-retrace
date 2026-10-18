<script lang="ts">
  // The Photos tab (a lazy chunk): the selection's photos and videos in time order, a virtualised grid of square
  // cells under sticky local-day headers (layout maths in grid.ts). Only the rows within about a screen of the
  // viewport are in the DOM; their thumbnails come through the media queue (thumbs.ts) over the thumbhash, and
  // requests for rows scrolled away are cancelled. The cursor's photo is ringed. Entering the tab (or a new selection
  // while on it) scrolls to it once; scrolling never moves it. A tap puts the cursor on the photo and opens the
  // lightbox; the photo it pages to is kept in view under it, so closing lands there (the grid stays put otherwise).
  import {onMount, untrack} from 'svelte';
  import {library} from '../index/store.svelte.ts';
  import {sameSelection, selection, type Selection} from '../selection.svelte.ts';
  import {cursorRow, placeOf} from '../map/route.ts';
  import {fDuration, fWeekday, fWhen} from '../map/format.ts';
  import {thumbHashDataUrl} from '../thumbhash.ts';
  import {mediaQueue, thumbUrl} from '../lightbox/media.ts';
  import {fNum} from '../albums.ts';
  import {explainAlbums} from '../failure.ts';
  import {tripName} from './format.ts';
  import {centerOn, groupDays, layoutGrid, reveal, visibleRows} from './grid.ts';
  import {ThumbSet} from './thumbs.ts';

  /** `shown`: the tab is on screen. `pick`: go to Trips (nothing selected). */
  let {shown, pick}: {shown: boolean; pick: () => void} = $props();

  const active = $derived(selection.active);
  const count = $derived(active ? active.hi - active.lo : 0);
  const name = $derived.by(() => {
    const s = selection.sel, a = s?.kind === 'album' ? library.albums.find(x => x.id === s.albumId) : null, p = s?.kind === 'place' ? active : null;
    // A place (a `near=` link from the desktop): its most common city or country.
    return a ? tripName(a.name) : p ? placeOf(p.ix, Array.from({length: p.hi - p.lo}, (_, i) => p.lo + i)) || 'This place' : 'Selected dates';
  });

  const membersError = $derived(selection.sel?.kind === 'album' && selection.membersLoad?.albumId === selection.sel.albumId ? selection.membersLoad.error : null);

  let scroller = $state<HTMLDivElement>();
  /** Content box of the scroller (px) and its scroll offset. */
  let width = $state(0), viewH = $state(0), top = $state(0);

  const days = $derived(active ? groupDays(active.ix, active.lo, active.hi) : []);
  const L = $derived(width > 0 ? layoutGrid(days, width) : null);

  // Rendered: the rows within `over` px of the viewport; requested: those, the on-screen ones first.
  const over = $derived(Math.max(320, viewH * 0.75));
  const ra = $derived(L ? visibleRows(L, top - over, top + viewH + over)[0] : 0);
  const rb = $derived(L ? visibleRows(L, top - over, top + viewH + over)[1] : 0);
  const blocks = $derived.by(() => {
    if (!L || rb <= ra) return [];
    const out = [];
    for (let k = L.rowDay[ra]; k <= L.rowDay[rb - 1]; k++) {
      const d = L.days[k], rows = [];
      for (let i = Math.max(ra, d.r0); i < Math.min(rb, d.r1); i++) rows.push(i);
      out.push({k, d, rows});
    }
    return out;
  });

  const cursorIn = $derived(active && selection.cursor != null && selection.cursor >= active.t0 && selection.cursor < active.t1 ? selection.cursor : null);
  const cur = $derived(active && cursorIn != null ? cursorRow(active.ix, active.lo, active.hi, cursorIn, selection.pickIn(active)) : -1);

  // ---- thumbnails ----
  let loaded = $state(0);
  const thumbs = new ThumbSet(mediaQueue, () => loaded++);
  const urlOf = (r: number) => thumbUrl(active!.ix.id[r], active!.ix.thumbhash[r]);
  /** A rendered cell's thumbnail once loaded (re-read whenever one loads). */
  const srcOf = (r: number) => { void loaded; return thumbs.get(urlOf(r)); };
  /** The rendered rows' thumbnails, on-screen rows first, then the rest nearest first ([] while out of sight). */
  function wanted(): [string[], number] {
    const a = active;
    if (!L || !a || rb <= ra || !requesting) return [[], 0];
    const [va, vb] = visibleRows(L, top, top + viewH), list: string[] = [];
    const add = (i: number) => {
      const end = Math.min(L.rowLo[i] + L.cols, L.days[L.rowDay[i]].hi);
      for (let r = L.rowLo[i]; r < end; r++) list.push(urlOf(r));
    };
    for (let i = va; i < vb; i++) add(i);
    const urgent = list.length;
    for (let k = 1; va - k >= ra || vb - 1 + k < rb; k++) {
      if (vb - 1 + k < rb) add(vb - 1 + k);
      if (va - k >= ra) add(va - k);
    }
    return [list, urgent];
  }
  // Only while the grid is on screen: not on another tab, not under the lightbox (its previews come first).
  const requesting = $derived(shown && selection.lightbox == null);
  // Requests for rows gone are cancelled at once; new ones are asked for once the rows settle (a fling passes rows by
  // without spending the demo's request budget on them).
  let wantTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    void [L, active, ra, rb, viewH, requesting];
    untrack(() => {
      const [list, urgent] = wanted();
      thumbs.prune(list);
      clearTimeout(wantTimer);
      if (list.length) wantTimer = setTimeout(() => { const [l, u] = wanted(); thumbs.want(l, u); }, 100);
    });
  });

  onMount(() => {
    const ro = new ResizeObserver(([e]) => { width = e.contentRect.width; viewH = e.contentRect.height; });
    ro.observe(scroller!);
    return () => { ro.disconnect(); clearTimeout(wantTimer); thumbs.dispose(); };
  });

  function setTop(y: number) {
    if (!scroller) return;
    scroller.scrollTop = y;
    top = scroller.scrollTop;
  }

  // ---- scroll to the cursor: once per entry into the tab, and for a new selection ----
  let toCursor = $state(true);
  $effect(() => { if (shown) untrack(() => (toCursor = true)); });
  // A Back or Forward re-applies the URL as a new but equal selection (closing the lightbox does): not a new one.
  let lastSel: Selection | null = null;
  $effect(() => {
    const s = selection.sel;
    untrack(() => { if (!sameSelection(s, lastSel)) toCursor = true; lastSel = s; });
  });
  $effect(() => {
    if (!toCursor || !shown || !L || !viewH || !active) return;
    const r = cur;
    untrack(() => { toCursor = false; setTop(r >= 0 ? centerOn(L, r, viewH) : 0); });
  });

  // ---- under the lightbox: the photo on show (the cursor follows it) kept in view, so closing lands on it ----
  // Live while it is open rather than on close: a Back first restores the parent entry's `at` (the photo tapped),
  // and the lightbox only then puts the cursor back on the photo shown.
  // Not for the photo it opened on: a tapped cell never moves (it may sit half under the day header).
  let openedOn: number | null = null, paged = false;
  $effect(() => {
    const open = selection.lightbox != null;
    untrack(() => { if (!open) { openedOn = null; paged = false; } });
  });
  $effect(() => {
    if (selection.lightbox == null || !shown || !L || !viewH) return;
    const r = cur;
    untrack(() => {
      openedOn ??= r;
      if (r !== openedOn) paged = true;
      if (r < 0 || !paged || !scroller) return;
      const y = reveal(L, r, scroller.scrollTop, viewH);
      if (y !== scroller.scrollTop) setTop(y);
    });
  });

  function open(r: number) {
    const a = active;
    if (!a) return;
    selection.cursorTo(a.ix, r);
    selection.lightbox = r;
  }

  /** The asset rows in grid row `i` (its day ends at `hi`). */
  function cellsOf(i: number, hi: number) {
    const out: number[] = [];
    for (let r = L!.rowLo[i], end = Math.min(r + L!.cols, hi); r < end; r++) out.push(r);
    return out;
  }

  /** "Leyre, Yesa, Javier" (the day's first three places). */
  function places(lo: number, hi: number) {
    const ix = active!.ix, seen = new Set<string>();
    for (let r = lo; r < hi && seen.size < 3; r++) { const c = ix.city[r]; if (c) seen.add(c); }
    return [...seen].join(', ');
  }
</script>

<div class="photos">
  <header>
    <h1>{selection.sel ? name : 'Photos'}</h1>
    {#if active}<span class="n">{fNum(count)} {count === 1 ? 'photo' : 'photos'}</span>{/if}
  </header>
  <div class="scroller" bind:this={scroller} onscroll={() => (top = scroller!.scrollTop)}>
    {#if !selection.sel}
      <div class="msg"><p>Pick a trip to see its photos here.</p><button onclick={pick}>Trips</button></div>
    {:else if !active && membersError}
      <div class="msg" role="alert"><p>{explainAlbums(membersError, 'The trip’s photos')}</p><button onclick={() => selection.retryMembers()}>Try again</button></div>
    {:else if !active}
      <p class="msg" role="status">Loading photos…</p>
    {:else if !count}
      <p class="msg">No photos in this selection.</p>
    {:else if L}
      {@const ix = active.ix}
      <div class="space" style:height="{L.height}px" style:--cell="{L.cell}px" style:--cols={L.cols} role="list" aria-label="Photos by day">
        {#each blocks as {k, d, rows} (k)}
          <section class="day" style:top="{d.y}px" style:height="{d.h}px" role="listitem">
            <h2>
              <span class="when">{fWeekday(ix.t[d.lo], ix.off[d.lo])}</span>
              <span class="where">{places(d.lo, d.hi)}</span>
              <span class="cnt">{fNum(d.hi - d.lo)}</span>
            </h2>
            {#each rows as i (i)}
              <div class="row" style:top="{L.rowY[i] - d.y}px">
                {#each cellsOf(i, d.hi) as r (r)}
                  {@const hash = thumbHashDataUrl(ix.thumbhash[r])}
                  {@const src = srcOf(r)}
                  <button class="cell" class:cur={r === cur} aria-current={r === cur ? 'true' : undefined} data-id={ix.id[r]}
                    style:background-image={hash ? `url(${hash})` : undefined}
                    aria-label="{fWhen(ix.t[r], ix.off[r])}{ix.city[r] ? `, ${ix.city[r]}` : ''}{ix.video[r] ? ', video' : ''}"
                    onclick={() => open(r)}>
                    {#if src}<img {src} alt="" decoding="async" draggable="false" />{/if}
                    {#if ix.video[r]}<span class="vid"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1v8l7-4z" /></svg>{fDuration(ix.dur[r])}</span>{/if}
                  </button>
                {/each}
              </div>
            {/each}
          </section>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .photos { height: 100%; display: grid; grid-template-rows: auto minmax(0, 1fr); }
  header {
    display: flex; align-items: baseline; gap: 10px; min-height: 44px; box-sizing: border-box;
    padding: max(8px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 6px max(16px, env(safe-area-inset-left));
    background: var(--surface); border-bottom: 1px solid var(--line);
  }
  h1 { flex: 1; min-width: 0; margin: 0; font: 600 17px/1.3 var(--f-body); color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .n { flex: none; font: 400 12px var(--f-mono); color: var(--muted); }
  .scroller {
    position: relative; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; -webkit-overflow-scrolling: touch;
    touch-action: pan-y; padding: 0 env(safe-area-inset-right) 0 env(safe-area-inset-left);
  }
  .msg { display: grid; gap: 12px; justify-items: start; margin: 0; padding: 20px 16px; color: var(--muted); }
  .msg p { margin: 0; }
  .msg button {
    min-height: 44px; padding: 0 18px; border: 1px solid var(--photo); border-radius: 999px; background: var(--raised);
    color: var(--ink); font: 500 14px var(--f-body);
  }
  .space { position: relative; }
  .day { position: absolute; left: 0; right: 0; }
  /* Sticky inside its day's block: pinned at the top while the day scrolls by, pushed up by the next day's. */
  h2 {
    position: sticky; top: 0; z-index: 1; height: 36px; box-sizing: border-box; margin: 0; padding: 0 12px;
    display: flex; align-items: center; gap: 8px; background: rgba(16, 18, 21, .96); font: 600 14px var(--f-body); color: var(--ink);
  }
  .where { flex: 1; min-width: 0; font-weight: 400; font-size: 13px; color: var(--ink2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cnt { font: 400 12px var(--f-mono); color: var(--muted); }
  .row {
    position: absolute; left: 0; right: 0; height: var(--cell);
    display: grid; grid-template-columns: repeat(var(--cols), var(--cell)); gap: 2px;
  }
  .cell {
    position: relative; width: var(--cell); height: var(--cell); padding: 0; border: 0; border-radius: 0; overflow: hidden;
    background: var(--raised) center / cover no-repeat; cursor: pointer;
    -webkit-tap-highlight-color: transparent; touch-action: pan-y; -webkit-touch-callout: none;
  }
  .cell img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .cell:active { filter: brightness(.85); }
  .cell:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: -2px; }
  /* The cursor's photo: an amber ring inside the cell (cells touch, so not outside it). */
  .cell.cur::after {
    content: ''; position: absolute; inset: 0; border: 3px solid var(--photo-hi); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .5);
    pointer-events: none;
  }
  .vid {
    position: absolute; right: 0; bottom: 0; left: 0; display: flex; justify-content: flex-end; align-items: center; gap: 3px;
    padding: 0 5px; font: 400 10px/16px var(--f-mono); color: #fff;
    background: linear-gradient(transparent, rgba(0, 0, 0, .65)); border-bottom: 3px solid var(--video);
  }
  .vid svg { width: 8px; height: 8px; fill: #fff; }
</style>
