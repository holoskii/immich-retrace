<script lang="ts">
  // Overview O-A: all-years context strip with a viewport window, zoomed √-density wave with the
  // selection brush, album rail. Writes `selection.sel` (and the URL), hover only draws a cursor here (it never moves the map).
  import {untrack} from 'svelte';
  import {library, phaseText} from '../index/store.svelte.ts';
  import {explainAlbums, retryLibrary} from '../failure.ts';
  import {lowerBound, offsetNear, selection, writeUrl, type Selection} from '../selection.svelte.ts';
  import {selName} from '../nav.ts';
  import AlbumPicker from './AlbumPicker.svelte';
  import {
    clamp, countRows, albumLabel, fLength, DAY, daysFromIndex, daysFromMonths, defaultView, dragTo, fDay, fNum, hitGrip, railAlbums,
    snapDay, viewAround, viewToShow, zoomAt, type Grip, type RailAlbum, type Span,
  } from './data.ts';
  import {CTX, drawContext, drawMain, MAIN, type RailHit} from './draw.ts';

  let ctxCv = $state<HTMLCanvasElement>(), mainCv = $state<HTMLCanvasElement>();
  let size = $state(0);
  /** Hover position on the wave: drawn as the overview's cursor, never written to `selection.cursor`. */
  let hoverT = $state<number | null>(null);
  let focus = $state(false);
  let hoverAlbum = $state<string | null>(null);
  let tip = $state<{x: number; y: number; title: string; text: string} | null>(null);
  let view = $state.raw<Span | null>(null);
  /** Final view of a running animation; null when idle. */
  let goal: Span | null = null;
  let hits: RailHit[] = [];

  // Histogram once per index (or per manifest while the first index builds).
  const days = $derived(library.index ? daysFromIndex(library.index) : library.provisional ? daysFromMonths(library.provisional) : null);
  const dom = $derived<Span | null>(days ? [days.t0, days.t0 + days.nd * DAY] : null);
  const rail = $derived(railAlbums(library.albums, false));
  /**
   * The brush while it is dragged (or moved by held keys). The selection itself — and so the whole map:
   * route, pins, camera track — follows only when the brush rests or is released, not on every move.
   */
  let draft = $state.raw<Span | null>(null);
  let draftTimer: ReturnType<typeof setTimeout> | undefined;
  const REST_MS = 220;
  const selSpan = $derived<Span | null>(draft ?? (selection.sel ? [selection.sel.t0, selection.sel.t1] : null));
  const album = $derived.by(() => {
    const s = selection.sel;
    return s?.kind === 'album' ? library.albums.find(a => a.id === s.albumId) ?? null : null;
  });

  /** The default view as last set; while `view` is still this one (untouched), a new histogram reframes it. */
  let auto: Span | null = null;
  // Default viewport (`defaultView`: the last ~12 months of photos); re-clamped when the domain changes (provisional → real).
  $effect(() => {
    if (!days || !dom) return;
    const v = untrack(() => view);
    if (!v || v === auto) { view = auto = defaultView(days); return; }
    const span = Math.min(v[1] - v[0], dom[1] - dom[0]), v0 = clamp(v[0], dom[0], dom[1] - span);
    if (v0 !== v[0] || v0 + span !== v[1]) view = [v0, v0 + span];
  });

  /** Context strip extent while its window is dragged, so the strip doesn't rescale under the pointer. */
  let frozen = $state.raw<Span | null>(null);
  /** Context strip extent: the library without outlier dates, widened to the view when that reaches them. */
  const strip = $derived.by<Span | null>(() => {
    if (frozen) return frozen;
    if (!days || !view) return dom;
    return [Math.min(days.core[0], view[0]), Math.max(days.core[1], view[1])];
  });

  // Keep the selection in view when it changes from outside the brush (URL, back/forward, keyboard).
  $effect(() => {
    const s = selSpan;
    if (!s || !dom) return;
    untrack(() => {
      const v = goal ?? view;
      if (!v || drag) return;
      const t = viewToShow(v, s[0], s[1], dom[0], dom[1]);
      if (t !== v) animateView(t);
    });
  });

  // Publish the visible period to the map once the timeline rests: re-clustering the library per frame would stutter.
  $effect(() => {
    const v = view;
    if (!v) return;
    const h = setTimeout(() => (selection.timeline = v), 200);
    return () => clearTimeout(h);
  });

  const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let anim = 0;
  function animateView(target: Span) {
    cancelAnimationFrame(anim);
    const from = view;
    if (!from || reduced?.matches) { goal = null; view = target; return; }
    goal = target;
    const t0 = performance.now(), ms = 220;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - (1 - k) ** 3;
      view = [from[0] + (target[0] - from[0]) * e, from[1] + (target[1] - from[1]) * e];
      if (k < 1) anim = requestAnimationFrame(step); else goal = null;
    };
    anim = requestAnimationFrame(step);
  }
  function setView(v: Span) { cancelAnimationFrame(anim); goal = null; view = v; }

  // Redraw on any input change, at most once per frame.
  let raf = 0;
  $effect(() => {
    const st = {days, view, sel: selSpan, cursor: hoverT ?? selection.cursor, cursorOff: offsetNear(hoverT ?? selection.cursor), albums: rail, activeAlbum: album?.id ?? null, hoverAlbum, focus};
    void size;
    const ext = strip;
    if (!ctxCv || !mainCv || !st.view || !ext) return;
    const c = ctxCv, m = mainCv, v = st.view;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      drawContext(c, st.days, ext, v, st.sel);
      hits = drawMain(m, {...st, view: v});
    });
  });

  $effect(() => {
    if (!mainCv) return;
    const ro = new ResizeObserver(() => size++);
    ro.observe(mainCv);
    return () => ro.disconnect();
  });

  // ---- pointer: main canvas (selection brush + album rail) ----

  const local = (ev: MouseEvent, el: HTMLElement) => { const r = el.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  const mainT = (x: number) => view ? view[0] + x / mainCv!.clientWidth * (view[1] - view[0]) : 0;
  const mainX = (t: number) => view ? (t - view[0]) / (view[1] - view[0]) * mainCv!.clientWidth : 0;
  const inWave = (y: number) => y <= MAIN.base + 4;
  const railHit = (x: number, y: number) => y > MAIN.base + 4 ? hits.find(h => x >= h.x0 - 2 && x <= h.x1 + 2 && y >= h.y - 4 && y <= h.y + MAIN.pitch - 2) ?? null : null;

  let drag: {grip: Grip; anchor: number; cur: Span; x: number; moved: boolean} | null = null;

  function selectRange(s: Span, how: 'live' | 'commit') {
    // A brushed range is no longer the named zoom level; Back still returns to where the zoom came from.
    selection.zoomLabel = null;
    void selection.select({kind: 'range', t0: s[0], t1: s[1]});
    writeUrl(how);
  }
  /** Moves the brush; the selection follows after REST_MS without further moves. */
  function setDraft(s: Span) {
    draft = s;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { if (draft) selectRange(draft, 'live'); }, REST_MS);
  }
  /** Ends a brush gesture: the selection takes the brush's final span. */
  function commitDraft() {
    clearTimeout(draftTimer);
    const d = draft;
    draft = null;
    if (d) selectRange(d, 'commit');
  }
  // The selection changed from elsewhere (Back, popstate, Esc, an album pick) mid-gesture: drop the draft.
  $effect(() => {
    const s = selection.sel;
    untrack(() => {
      if (draft && !(s?.kind === 'range' && s.t0 === draft[0] && s.t1 === draft[1])) { clearTimeout(draftTimer); draft = null; }
    });
  });
  $effect(() => () => clearTimeout(draftTimer));

  function onMainDown(ev: PointerEvent) {
    if (!view || ev.button !== 0) return;
    const [x, y] = local(ev, mainCv!);
    if (!inWave(y)) return;
    const s = selSpan, t = mainT(x);
    const grip = s ? hitGrip(x, mainX(s[0]), mainX(s[1])) : 'n';
    // Edges snap to UTC days (the URL format), so an album's exact span becomes whole days once touched.
    const cur: Span = s ? [snapDay(s[0]), Math.max(snapDay(s[0]) + DAY, snapDay(s[1]))] : [t, t];
    drag = {grip, anchor: grip === 'm' ? t - cur[0] : t, cur, x, moved: false};
    mainCv!.setPointerCapture(ev.pointerId);
  }

  function onMainMove(ev: PointerEvent) {
    if (!view) return;
    const [x, y] = local(ev, mainCv!), t = mainT(x);
    if (drag) {
      if (!drag.moved && Math.abs(x - drag.x) < 3) return;
      drag.moved = true;
      const r = dragTo(drag.grip, drag.anchor, t, drag.cur, view[0], view[1], DAY, snapDay);
      drag.grip = r.grip; drag.cur = r.span;
      setDraft(r.span);
      return;
    }
    const hit = railHit(x, y);
    hoverAlbum = hit?.a.id ?? null;
    tip = hit ? {x: ev.clientX, y: ev.clientY, title: albumLabel(hit.a.name), text: `${fDay(hit.a.start)} → ${fDay(hit.a.end)} · ${fNum(hit.a.count)} items`} : null;
    if (inWave(y)) {
      hoverT = t;
      const s = selSpan, g = s ? hitGrip(x, mainX(s[0]), mainX(s[1])) : 'n';
      mainCv!.style.cursor = g === 'l' || g === 'r' ? 'ew-resize' : g === 'm' ? 'grab' : 'crosshair';
    } else {
      hoverT = null;
      mainCv!.style.cursor = hit ? 'pointer' : 'default';
    }
  }

  function onMainUp(ev: PointerEvent) {
    const d = drag;
    drag = null;
    if (d) {
      if (d.moved) commitDraft();
      // A plain click outside the selection clears it; inside or on an edge does nothing.
      else if (d.grip === 'n' && selection.sel) clearSelection();
      return;
    }
    const [x, y] = local(ev, mainCv!), hit = railHit(x, y);
    if (hit) pickAlbum(hit.a);
  }

  function onMainLeave() {
    if (drag) return;
    hoverAlbum = null; tip = null; hoverT = null;
  }

  function clearSelection() {
    clearTimeout(draftTimer); draft = null;
    selection.resetZoom();
    void selection.select(null);
    writeUrl('commit');
  }

  function back() {
    if (selection.back()) writeUrl('commit', selection.cursor);
  }

  function pickAlbum(a: RailAlbum) {
    selection.resetZoom();
    if (dom) animateView(viewAround(a.start, a.end + 1, dom[0], dom[1]));
    const sel: Selection = {kind: 'album', albumId: a.id, mode: 'members', t0: a.start, t1: a.end + 1};
    selection.cursor = null;
    // Start at the album's first photo, so the map opens with a position and a photo card.
    selection.select(sel).then(() => {
      const act = selection.active;
      if (selection.sel !== sel || !act || act.hi <= act.lo || selection.cursor != null) return;
      selection.cursor = act.ix.t[act.lo];
      writeUrl('replace', selection.cursor);
    }).catch(e => console.warn('album members:', e));
    writeUrl('commit', null);
  }

  function setMode(mode: 'members' | 'range') {
    const s = selection.sel;
    if (s?.kind !== 'album' || s.mode === mode) return;
    // The other mode of the same zoom level: the stack stays (Back returns to where the zoom came from).
    selection.select({...s, mode}).catch(e => console.warn('album members:', e));
    writeUrl('commit');
  }

  function onWheel(ev: WheelEvent, cv: HTMLCanvasElement, overall: boolean) {
    if (!view || !dom) return;
    ev.preventDefault();
    const [x] = local(ev, cv), w = cv.clientWidth, f = x / w, e = strip ?? dom;
    const t = overall ? e[0] + f * (e[1] - e[0]) : view[0] + f * (view[1] - view[0]);
    const g = overall ? (t - view[0]) / (view[1] - view[0]) : f;
    setView(zoomAt(view, t, overall ? clamp(g, 0, 1) : g, Math.exp(ev.deltaY * 0.0015), dom[0], dom[1]));
  }

  // ---- pointer: context strip (viewport window) ----

  let vdrag: {grip: Grip; anchor: number; cur: Span; x: number; moved: boolean} | null = null;
  const ctxT = (x: number) => strip ? strip[0] + x / ctxCv!.clientWidth * (strip[1] - strip[0]) : 0;
  const ctxX = (t: number) => strip ? (t - strip[0]) / (strip[1] - strip[0]) * ctxCv!.clientWidth : 0;

  function onCtxDown(ev: PointerEvent) {
    if (!view || !dom || !strip || ev.button !== 0) return;
    const [x] = local(ev, ctxCv!), t = ctxT(x), grip = hitGrip(x, ctxX(view[0]), ctxX(view[1]));
    vdrag = {grip, anchor: grip === 'm' ? t - view[0] : t, cur: view, x, moved: false};
    frozen = strip;
    ctxCv!.setPointerCapture(ev.pointerId);
  }
  function onCtxMove(ev: PointerEvent) {
    if (!view || !dom) return;
    const [x] = local(ev, ctxCv!);
    if (!vdrag) {
      const g = hitGrip(x, ctxX(view[0]), ctxX(view[1]));
      ctxCv!.style.cursor = g === 'l' || g === 'r' ? 'ew-resize' : g === 'm' ? 'grab' : 'crosshair';
      return;
    }
    if (!vdrag.moved && Math.abs(x - vdrag.x) < 3) return;
    vdrag.moved = true;
    const e = strip ?? dom, r = dragTo(vdrag.grip, vdrag.anchor, ctxT(x), vdrag.cur, e[0], e[1], 7 * DAY);
    vdrag.grip = r.grip; vdrag.cur = r.span;
    setView(r.span);
  }
  function onCtxUp(ev: PointerEvent) {
    const d = vdrag;
    vdrag = null;
    frozen = null;
    if (!d || d.moved || !view || !dom) return;
    // A click recenters the window there.
    const [x] = local(ev, ctxCv!), span = view[1] - view[0], v0 = clamp(ctxT(x) - span / 2, dom[0], dom[1] - span);
    animateView([v0, v0 + span]);
  }

  // ---- keyboard on the wave ----

  function onKey(ev: KeyboardEvent) {
    if (ev.key === 'Escape') {
      if (!selection.sel && !draft) return;
      ev.preventDefault();
      clearSelection();
      return;
    }
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    if (!view || !dom) return;
    ev.preventDefault();
    const dir = ev.key === 'ArrowLeft' ? -1 : 1, step = (ev.shiftKey ? 7 : 1) * DAY * dir, s = selSpan;
    if (!s) {
      // Nothing selected yet: start with the day in the middle of the view.
      const d = Math.floor((view[0] + view[1]) / 2 / DAY) * DAY;
      setDraft([d, d + DAY]);
      return;
    }
    let t0 = snapDay(s[0]), t1 = Math.max(t0 + DAY, snapDay(s[1]));
    if (ev.altKey) t1 = Math.max(t0 + DAY, Math.min(dom[1], t1 + step));
    else { const w = t1 - t0; t0 = clamp(t0 + step, dom[0], dom[1] - w); t1 = t0 + w; }
    setDraft([t0, t1]);
  }
  function onKeyUp(ev: KeyboardEvent) {
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') commitDraft();
  }

  /** Backspace anywhere but a text field: back out of the last zoom. */
  function onWindowKey(ev: KeyboardEvent) {
    if (ev.key !== 'Backspace' || ev.defaultPrevented || selection.lightbox != null) return;
    const t = ev.target as HTMLElement | null;
    if (t?.closest('input, textarea, [contenteditable]')) return;
    if (selection.stack.length) { ev.preventDefault(); back(); }
  }

  // ---- navigation bar ----

  const isFull = $derived(!!view && !!dom && view[0] <= dom[0] && view[1] >= dom[1]);
  function resetZoom() { if (dom) animateView([dom[0], dom[1]]); }

  /** Previous / next album on the rail (same filter), by start date. */
  const neighbors = $derived.by(() => {
    const id = album?.id;
    if (!id) return {prev: null, next: null};
    const i = rail.findIndex(a => a.id === id);
    return i < 0 ? {prev: null, next: null} : {prev: rail[i - 1] ?? null, next: rail[i + 1] ?? null};
  });
  const parent = $derived(selection.stack.at(-1) ?? null);

  // ---- readout & status ----

  const readout = $derived.by(() => {
    const d = draft, s: Selection | null = d ? {kind: 'range', t0: d[0], t1: d[1]} : selection.sel;
    if (!s) return null;
    const name = selection.zoomLabel && !d ? selection.zoomLabel : s.kind === 'album' ? (album ? albumLabel(album.name) : 'Album') : null;
    const head = `${fDay(s.t0)} → ${fDay(s.t1 - 1)} · ${fLength(s.t0, s.t1)}`;
    const lib = library.index;
    const a = d ? (lib ? {ix: lib, lo: lowerBound(lib.t, d[0]), hi: lowerBound(lib.t, d[1])} : null) : selection.active;
    if (!a) return {name, head, gps: null, nogps: null};
    const c = countRows(a.ix, a.lo, a.hi);
    return {name, head, gps: fNum(c.gps), nogps: fNum(c.photos + c.videos - c.gps)};
  });

  /** Album members (members mode) that are loading or failed to load; null once they are in. */
  const membersLoad = $derived(selection.sel?.kind === 'album' && selection.membersLoad?.albumId === selection.sel.albumId ? selection.membersLoad : null);

  const status = $derived.by(() => {
    const phase = phaseText(library.phase, library.attempt, library.progress);
    switch (library.status) {
      case 'building': return phase || 'building index';
      case 'refreshing': return `refreshing · ${phase}`;
      case 'cached': return library.phase === 'waiting' ? `cached · ${phase}` : 'cached · checking for changes';
      case 'ready': return library.index ? `${fNum(library.index.n)} items` : 'ready';
      case 'error': return `error: ${library.error ?? 'unknown'}`;
    }
  });
</script>

<svelte:window onkeydown={onWindowKey} />
<section class="overview" aria-label="Overview">
  <div class="bar">
    <div class="nav">
      {#if parent}
        <button class="btn back" onclick={back} title="Back (Backspace)">← {selName(parent.sel, parent.label)}</button>
      {/if}
      <AlbumPicker albums={library.albums} current={album?.id ?? null} onpick={pickAlbum}
        error={library.albumsError ? explainAlbums(library.albumsError) : null} loaded={library.albumsLoaded} />
      {#if album}
        <button class="btn icon" disabled={!neighbors.prev} onclick={() => neighbors.prev && pickAlbum(neighbors.prev)}
          title={neighbors.prev ? `Previous album: ${neighbors.prev.name}` : 'No earlier album'} aria-label="Previous album">‹</button>
        <button class="btn icon" disabled={!neighbors.next} onclick={() => neighbors.next && pickAlbum(neighbors.next)}
          title={neighbors.next ? `Next album: ${neighbors.next.name}` : 'No later album'} aria-label="Next album">›</button>
      {/if}
    </div>
    <div class="readout mono" aria-live="polite">
      {#if readout}
        {#if readout.name}<b>{readout.name}</b>{' · '}{/if}{readout.head} ·
        {#if readout.gps == null && membersLoad?.error}
          <span class="err">{explainAlbums(membersLoad.error, 'Album photos')}</span>
          <button class="link" onclick={() => selection.retryMembers()}>Retry</button>
          <button class="link" onclick={() => setMode('range')} title="Every photo taken during the album's dates">all photos in these dates</button>
        {:else if readout.gps == null}<span class="ink2">{selection.sel?.kind === 'album' && selection.sel.mode === 'members' ? 'loading members…' : '…'}</span>
        {:else}<i class="sw gps"></i>{readout.gps} with location · <i class="sw nogps"></i>{readout.nogps} without{/if}
      {:else}
        <span class="muted">No selection: drag on the timeline, click an album bar, or pick from Albums</span>
      {/if}
    </div>
    {#if selection.sel}
      <button class="btn" onclick={clearSelection} title="Clear the selection (Esc on the timeline)">✕ clear</button>
    {/if}
    {#if selection.sel?.kind === 'album'}
      <div class="seg" role="group" aria-label="Album selection mode">
        <button aria-pressed={selection.sel.mode === 'members'} onclick={() => setMode('members')} title="Only the photos in the album">album photos</button>
        <button aria-pressed={selection.sel.mode === 'range'} onclick={() => setMode('range')} title="Every photo taken during the album's dates">all photos in these dates</button>
      </div>
    {/if}
    <button class="btn" disabled={isFull} onclick={resetZoom} title="Zoom the timeline out to all years">All years</button>
    <div class="status mono" class:err={library.status === 'error'}>
      {status}
      {#if library.status === 'error'}
        <button class="link" onclick={retryLibrary} title="Try again; the cached library stays">Retry</button>
      {/if}
      {#if library.albumsError}
        <span class="warn">{explainAlbums(library.albumsError)}</span>
      {/if}
      <button class="link" onclick={() => library.clearCache()} title="Drop the cached index and rebuild it">clear cache</button>
    </div>
  </div>

  <canvas
    bind:this={ctxCv} class="ctx" style:height="{CTX.h}px"
    aria-label="All years; drag the window to choose the zoomed period"
    onpointerdown={onCtxDown} onpointermove={onCtxMove} onpointerup={onCtxUp} onpointercancel={() => { vdrag = null; frozen = null; }}
    onwheel={ev => onWheel(ev, ctxCv!, true)}
  ></canvas>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <canvas
    bind:this={mainCv} class="main" style:height="{MAIN.h}px" tabindex="0"
    aria-label="Zoomed timeline. Drag to select a range; arrow keys move it by a day (Shift: a week), Alt+arrows resize it, Escape clears"
    onpointerdown={onMainDown} onpointermove={onMainMove} onpointerup={onMainUp}
    onpointercancel={() => { drag = null; commitDraft(); }} onpointerleave={onMainLeave}
    onwheel={ev => onWheel(ev, mainCv!, false)}
    onkeydown={onKey} onkeyup={onKeyUp}
    onfocus={() => (focus = true)} onblur={() => { focus = false; if (draft) commitDraft(); else writeUrl('commit'); }}
  ></canvas>
  <div class="hint">
    <span class="key">
      {#if days?.provisional}<i class="sw pending"></i>counting (location not known yet)
      {:else}<i class="sw gps"></i>with location <i class="sw nogps"></i>without location{/if}
    </span>
    <span>scroll = zoom · drag = select · edges = resize · bars = albums · ←/→ move · Alt+←/→ resize · Esc clear</span>
  </div>

  {#if tip}
    <div class="tip" style:left="{tip.x + 14}px" style:top="{tip.y + 14}px"><strong>{tip.title}</strong><span>{tip.text}</span></div>
  {/if}
</section>

<style>
  .overview { background: var(--surface); border-bottom: 1px solid var(--line); padding: 8px 16px 6px; display: grid; gap: 4px; }
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; font-size: 12px; color: var(--muted); min-height: 26px; }
  .readout { color: var(--ink); flex: 1 1 420px; min-width: 0; font-size: 12px; }
  .readout b { font-weight: 500; color: var(--photo-hi); }
  .mono { font-family: var(--f-mono); font-variant-numeric: tabular-nums; }
  .ink2 { color: var(--ink2); }
  /* Colour key swatches: the counts and labels stay in text colours, the swatch carries the encoding. */
  .sw { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin: 0 5px 0 0; vertical-align: -1px; }
  .sw.gps { background: var(--gps); }
  .sw.nogps { background: var(--nogps); }
  .sw.pending { background: repeating-linear-gradient(-45deg, var(--muted) 0 1.5px, transparent 1.5px 4px); }
  .muted { color: var(--muted); }
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 4px; overflow: hidden; }
  .seg button { background: none; border: 0; color: var(--muted); font: 12px var(--f-body); padding: 2px 9px; cursor: pointer; }
  .seg button + button { border-left: 1px solid var(--line); }
  .seg button[aria-pressed='true'] { background: var(--raised); color: var(--ink); }
  .nav { display: inline-flex; gap: 6px; align-items: center; }
  .btn { background: var(--raised); border: 1px solid var(--line); border-radius: 4px; color: var(--ink2); font: 500 12px var(--f-body); padding: 3px 10px; cursor: pointer; white-space: nowrap; }
  .btn:hover:not(:disabled) { color: var(--ink); border-color: var(--muted); }
  .btn:disabled { opacity: .4; cursor: default; }
  .btn.icon { padding: 3px 8px; }
  .btn.back { color: var(--ink); border-color: var(--photo); max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
  .status { font-size: 11px; color: var(--muted); display: inline-flex; gap: 10px; align-items: baseline; }
  .status.err, .err { color: #e07a6a; }
  .warn { color: var(--ink2); }
  .link { background: none; border: 0; padding: 0; color: var(--ink2); font: inherit; text-decoration: underline dotted; cursor: pointer; }
  .link:hover { color: var(--ink); }
  canvas { display: block; width: 100%; touch-action: none; }
  canvas:focus-visible, button:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }
  .hint { font-size: 11px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 2px 18px; }
  .key { color: var(--ink2); white-space: nowrap; }
  .key .sw.nogps { margin-left: 10px; }
  .tip { position: fixed; z-index: 10; pointer-events: none; background: #0B0C0E; border: 1px solid var(--line); border-radius: 5px; padding: 6px 9px; font-size: 12px; color: var(--ink2); display: grid; gap: 2px; max-width: 280px; box-shadow: 0 6px 24px rgba(0,0,0,.5); }
  .tip strong { color: var(--ink); font: 500 12px var(--f-mono); }
</style>
