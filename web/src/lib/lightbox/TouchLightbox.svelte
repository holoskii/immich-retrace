<script lang="ts">
  // Touch lightbox: a full-screen pager over the active range, for touch screens (Lightbox.svelte picks it on a
  // coarse pointer; a phone shell mounts the controller with `touch`). Swipe ←/→ steps (no wrap), swipe ↓ or ✕ closes
  // like Back (the opening pushed a history entry), pinch or double-tap zooms the preview (never the original) and a
  // zoomed photo pans instead of paging. A tap toggles the bars. ‹ › and the arrow keys step too, Esc closes.
  //
  // Gestures: pointer events on a `touch-action: none` stage (Svelte's touch handlers are passive), the maths in
  // gesture.ts. One finger: undecided until it moves past SLOP, then paging (sideways), closing (down) or panning
  // (zoomed); two fingers pinch. A drag starting within EDGE px of a screen side is left to the OS's back swipe.
  // Images: the previews of the photo on show and its two neighbours, through the media queue (PreviewSet): at most
  // three held and decoded, and a neighbour that becomes the photo on show keeps its request.
  import {onMount, tick, untrack} from 'svelte';
  import {selection, type Active} from '../selection.svelte.ts';
  import {base64Bytes, thumbHashDataUrl, thumbHashRatio} from '../thumbhash.ts';
  import {fDuration, fFullDay} from '../map/format.ts';
  import {loadedThumb, mediaQueue, PreviewSet, thumbUrl, videoUrl} from './media.ts';
  import {explainMedia, probeMedia, type MediaFailure} from '../failure.ts';
  import {fClock, fPlace, fPosition, step} from './model.ts';
  import {
    afterStep, classify, clampView, dismissRelease, doubleTapView, FIT, fit, isDoubleTap, nearEdge, pageRelease,
    pinchView, releaseVelocity, rubber, span, SLOP, type Point, type Sample, type View,
  } from './gesture.ts';
  import {closeLightbox, keepCursorOn} from './Lightbox.svelte';
  import {hooks} from '../hooks.svelte.ts';

  let {a, row}: {a: Active; row: number} = $props();

  /** Space between pages while one slides in. */
  const GAP = 16;
  const ANIM_MS = 220;

  const ix = $derived(a.ix);
  const id = $derived(ix.id[row]);
  const prevRow = $derived(step(a, row, -1));
  const nextRow = $derived(step(a, row, 1));
  const place = $derived(fPlace(ix.city[row], ix.country[row]));

  let sw = $state(0), sh = $state(0);
  const slot = $derived(sw + GAP);
  /** The bars' heights: a video fits between them, so its native controls stay clear of the bottom bar. */
  let topH = $state(0), botH = $state(0);

  function ratioOf(r: number) {
    let ratio = ix.ratio[r];
    const hash = ix.thumbhash[r];
    if (!(ratio > 0) && hash) try { ratio = thumbHashRatio(base64Bytes(hash)); } catch { /* malformed */ }
    return ratio;
  }

  // The pages: previous, current, next (those that exist). Keyed by id, so a neighbour's element (and its decoded
  // image) becomes the current page as it is.
  const pages = $derived([prevRow, row, nextRow].filter((r): r is number => r != null).map(r => ({
    r, id: ix.id[r], video: ix.video[r] === 1,
    preview: thumbUrl(ix.id[r], ix.thumbhash[r], 'preview'),
    placeholder: thumbHashDataUrl(ix.thumbhash[r]),
    // The thumbnail the grid or card already showed sharp, if still held (no request): over the thumbhash.
    thumb: loadedThumb(thumbUrl(ix.id[r], ix.thumbhash[r])),
    box: ix.video[r] === 1 ? fit({w: sw, h: Math.max(0, sh - topH - botH)}, ratioOf(r)) : fit({w: sw, h: sh}, ratioOf(r)),
  })));
  const cur = $derived(pages.find(p => p.r === row)!);

  // Previews: the one on show first, then the next one (forward is the usual direction), then the previous.
  let loads = $state(0);
  const previews = new PreviewSet(mediaQueue, () => loads++);
  $effect(() => {
    previews.keep([row, nextRow, prevRow].filter((r): r is number => r != null).map(r => thumbUrl(ix.id[r], ix.thumbhash[r], 'preview')));
  });
  // Decoded flags only for the pages there are (a page that comes back has a new element and image).
  $effect(() => {
    const ids = new Set(pages.map(p => p.id));
    untrack(() => {
      for (const k of Object.keys(decoded)) if (!ids.has(k)) delete decoded[k];
      for (const k of Object.keys(broken)) if (!ids.has(k)) delete broken[k];
    });
  });
  onMount(() => () => previews.dispose());
  function held(url: string) { void loads; return previews.get(url); }
  /** The box's background: the loaded thumbnail (if any) over the thumbhash. */
  const layers = (thumb: string | null, hash: string | null) => [thumb, hash].filter(Boolean).map(u => `url(${u})`).join(', ') || undefined;
  /** Pages whose image has decoded (keyed by id; the fade-in runs once). */
  let decoded = $state<Record<string, true>>({});
  /** Pages whose preview arrived but won't decode (HTTP 200, corrupt bytes): shown as a failure once current. */
  let broken = $state<Record<string, true>>({});
  function onImg(e: Event, pid: string) {
    const img = e.currentTarget as HTMLImageElement;
    // Decoded before it shows, so a neighbour sliding in never flashes blank.
    img.decode().then(() => { decoded[pid] = true; }, () => { broken[pid] = true; });
  }

  // Failures (the queue's error doesn't say why: ask the relay, like the desktop view).
  let failed = $state<{id: string; kind: MediaFailure | null} | null>(null);
  const failure = $derived(failed?.id === id && failed.kind ? explainMedia(failed.kind, cur?.video ?? false) : null);
  function fail(url: string) {
    const at = id;
    if (failed?.id === at) return;
    failed = {id: at, kind: null};
    void probeMedia(url).then(kind => { if (failed?.id === at) failed = {id: at, kind}; });
  }
  $effect(() => {
    if (cur && !cur.video && (held(cur.preview)?.error != null || broken[cur.id])) fail(cur.preview);
  });
  // A preview still waiting after a moment (the demo's request budget, a slow network): a quiet "Loading…", so the
  // blur doesn't read as the photo itself.
  let slow = $state(false);
  $effect(() => { void id; slow = false; const t = setTimeout(() => (slow = true), 600); return () => clearTimeout(t); });
  const waiting = $derived(slow && !!cur && !cur.video && !failure && !decoded[cur.id]);
  let videoTries = $state(0);
  function retry() {
    failed = null;
    if (cur?.video) videoTries++;
    else if (cur) { delete broken[cur.id]; delete decoded[cur.id]; previews.retry(cur.preview); }
  }

  // ---- view state: drag offsets and zoom (applied as transforms) ----
  let dx = $state(0), dy = $state(0);
  let view = $state<View>(FIT);
  let bars = $state(true);
  let closing = $state(false);
  // A new photo starts fitted.
  $effect(() => { void id; view = FIT; failed = null; });
  // A resize or rotation refits the box: a zoomed photo's offset is clamped again, so no empty band shows.
  $effect(() => {
    const box = cur?.box, stg = {w: sw, h: sh};
    if (!box) return;
    untrack(() => {
      if (view.s <= 1) return;
      const c = clampView(view, box, stg);
      if (c.x !== view.x || c.y !== view.y) view = c;
    });
  });

  let overlay: HTMLDivElement;
  let stage: HTMLDivElement;
  let track: HTMLDivElement;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const running = new Set<Animation>();
  /** Slides `el`'s transform from `from` to its own (already set) value `to`. */
  function glide(el: Element | null | undefined, from: string, to: string) {
    if (!el || reduced()) return;
    const an = el.animate([{transform: from}, {transform: to}], {duration: ANIM_MS, easing: 'cubic-bezier(.2,.7,.3,1)'});
    running.add(an);
    an.onfinish = an.oncancel = () => running.delete(an);
  }
  const currentEl = (sel: string) => overlay.querySelector(`.page.current ${sel}`.trim());
  const boxT = (v: View) => `translate(${v.x}px, ${v.y}px) scale(${v.s})`;
  const pageT = (r: number, y = 0) => `translate3d(${(r - row) * slot}px, ${y}px, 0)`;

  /** Steps by d with the new page sliding in from `fromDx` (the drag offset, or 0 for a button or key). */
  async function go(d: -1 | 1, fromDx = 0) {
    const r = d > 0 ? nextRow : prevRow;
    if (r == null) return;
    const from = afterStep(fromDx, d, slot);
    dx = 0;
    selection.lightbox = r;
    await tick();
    glide(track, `translate3d(${from}px, 0, 0)`, 'translate3d(0, 0, 0)');
  }
  function close() {
    if (closing) return;
    closing = true;
    closeLightbox();
  }

  // ---- gestures ----
  type Mode = 'idle' | 'pending' | 'edge' | 'page' | 'dismiss' | 'pan' | 'pinch' | 'none';
  let mode: Mode = 'idle';
  const pts = new Map<number, Point>();
  let start: Sample = {t: 0, x: 0, y: 0};
  let samples: Sample[] = [];
  let v0: View = FIT;
  let pinch0: {m: Point; d: number; v: View} | null = null;
  let lastTap: Sample | null = null;
  /** The gesture can still be a tap: one finger only, never past SLOP. */
  let tapOk = false;
  let tapTimer: ReturnType<typeof setTimeout> | undefined;

  /** Client point → relative to the stage centre. */
  function rel(p: Point): Point {
    const b = stage.getBoundingClientRect();
    return {x: p.x - b.left - b.width / 2, y: p.y - b.top - b.height / 2};
  }
  function capture(e: PointerEvent) {
    // Only once a drag is recognised: capturing on pointerdown would retarget a tap's click (video controls).
    try { stage.setPointerCapture(e.pointerId); } catch { /* synthetic or ended pointer */ }
  }
  /** Lets go of a page or close drag, sliding back. */
  function settle() {
    const fx = dx, fy = dy;
    dx = 0; dy = 0;
    if (fx) glide(track, `translate3d(${fx}px, 0, 0)`, 'translate3d(0, 0, 0)');
    if (fy) glide(currentEl(''), pageT(row, fy), pageT(row));
  }
  function setView(v: View, animate = false) {
    const from = boxT(view);
    view = v;
    if (animate) void tick().then(() => glide(currentEl('.box'), from, boxT(v)));
  }
  const boxSize = () => cur?.box ?? {w: sw, h: sh};

  function down(e: PointerEvent) {
    if (closing || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const t = e.target as HTMLElement;
    // The native video controls (the bar along the bottom) keep their own drags and taps.
    if (t.tagName === 'VIDEO' && e.clientY > t.getBoundingClientRect().bottom - 56) return;
    if (pts.size >= 2) return;
    // A touch during a slide ends it where it was going.
    for (const an of running) an.finish();
    pts.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (pts.size === 2) {
      tapOk = false;
      if (cur?.video) { mode = 'none'; settle(); return; }
      if (mode === 'page' || mode === 'dismiss') settle();
      const [p, q] = [...pts.values()], sp = span(rel(p), rel(q));
      pinch0 = {m: sp.m, d: sp.d, v: view};
      mode = 'pinch';
      tapOk = false;
      capture(e);
      clearTimeout(tapTimer); lastTap = null;
      return;
    }
    start = {t: e.timeStamp, x: e.clientX, y: e.clientY};
    samples = [start];
    v0 = view;
    tapOk = true;
    mode = view.s > 1.01 ? 'pan' : nearEdge(e.clientX, innerWidth) ? 'edge' : 'pending';
    if (mode === 'pan') capture(e);
  }

  function move(e: PointerEvent) {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, {x: e.clientX, y: e.clientY});
    const ddx = e.clientX - start.x, ddy = e.clientY - start.y;
    if (pts.size > 1 || Math.hypot(ddx, ddy) >= SLOP) tapOk = false;
    if (pts.size === 1) { samples.push({t: e.timeStamp, x: e.clientX, y: e.clientY}); if (samples.length > 12) samples.shift(); }
    switch (mode) {
      case 'pinch': {
        if (pts.size < 2 || !pinch0) return;
        const [p, q] = [...pts.values()], sp = span(rel(p), rel(q));
        view = clampView(pinchView(pinch0.v, pinch0.m, pinch0.d, sp.m, sp.d), boxSize(), {w: sw, h: sh});
        return;
      }
      case 'pan':
        view = clampView({s: v0.s, x: v0.x + ddx, y: v0.y + ddy}, boxSize(), {w: sw, h: sh});
        return;
      case 'pending': {
        const c = classify(ddx, ddy);
        if (!c) return;
        mode = c;
        if (c !== 'none') { capture(e); clearTimeout(tapTimer); lastTap = null; }
        if (c === 'none') return;
        break;
      }
      case 'edge':
        if (classify(ddx, ddy)) mode = 'none';
        return;
    }
    if (mode === 'page') dx = rubber(ddx, prevRow != null, nextRow != null);
    else if (mode === 'dismiss') dy = Math.max(0, ddy);
  }

  function up(e: PointerEvent) {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    const cancelled = e.type === 'pointercancel';
    if (mode === 'pinch') {
      if (pts.size === 1) {
        // One finger left: it pans on from here (or does nothing once back at fitted).
        const [p] = [...pts.values()];
        start = {t: e.timeStamp, x: p.x, y: p.y};
        samples = [start];
        v0 = view;
        mode = view.s > 1.01 ? 'pan' : 'none';
        return;
      }
      mode = 'idle';
      setView(view.s < 1.05 ? FIT : clampView(view, boxSize(), {w: sw, h: sh}), true);
      return;
    }
    if (pts.size) return;
    const m = mode;
    mode = 'idle';
    const vel = releaseVelocity(samples, e.timeStamp);
    if (m === 'page') {
      const d = cancelled ? 0 : pageRelease(dx, vel.x, sw, prevRow != null, nextRow != null);
      if (d) void go(d, dx); else settle();
      return;
    }
    if (m === 'dismiss') {
      if (!cancelled && dismissRelease(dy, vel.y, sh)) close(); else settle();
      return;
    }
    // A tap: one finger that never moved past SLOP (not the last finger of a pinch, not a held drag).
    if (!tapOk || Math.hypot(e.clientX - start.x, e.clientY - start.y) >= SLOP) return;
    if (m !== 'pan' && m !== 'pending' && m !== 'edge') return;
    if (!cancelled && e.timeStamp - start.t < 500) tap({t: e.timeStamp, x: e.clientX, y: e.clientY}, e.target as HTMLElement);
  }

  function tap(p: Sample, target: HTMLElement) {
    if (isDoubleTap(lastTap, p)) {
      clearTimeout(tapTimer);
      lastTap = null;
      if (!cur?.video) setView(doubleTapView(view, rel(p), boxSize(), {w: sw, h: sh}), true);
      return;
    }
    lastTap = p;
    clearTimeout(tapTimer);
    // A tap on the video belongs to its controls.
    if (target.tagName !== 'VIDEO') tapTimer = setTimeout(() => { bars = !bars; }, 300);
  }

  function onKey(e: KeyboardEvent) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if ((e.target as HTMLElement | null)?.tagName === 'VIDEO') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); void go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); void go(1); }
  }

  /** The asset on show, for the cleanup (the props may be gone by then). */
  let shownId = '';
  $effect(() => { shownId = id; });

  onMount(() => {
    // Focus moves in and the app behind goes inert; both are undone on close.
    const before = document.activeElement as HTMLElement | null;
    const others = [...(overlay.parentElement?.children ?? [])].filter((el): el is HTMLElement => el !== overlay && el instanceof HTMLElement && !el.inert);
    for (const el of others) el.inert = true;
    overlay.focus();
    return () => {
      clearTimeout(tapTimer);
      for (const el of others) el.inert = false;
      if (before?.isConnected) before.focus({preventScroll: true});
      // Closed by the system Back (the phone's button, an edge swipe; ✕ and swipe down go through closeLightbox,
      // which does the same): popping the entry the opening pushed also brought back that entry's `at`. Keep the
      // cursor on the photo last shown instead. Not in a popstate listener of this component: the URL sync's
      // listener runs first and this unmounts before the next one. Not in this teardown either: Svelte gives
      // teardowns the values from before the change (an open lightbox).
      const shown = shownId;
      if (shown) queueMicrotask(() => keepCursorOn(shown));
    };
  });

  const shade = $derived(sh ? Math.max(0.2, 1 - (dy / sh) * 1.6) : 1);
</script>

<svelte:window onkeydown={onKey} />

<div class="tlb" class:closing bind:this={overlay} role="dialog" aria-modal="true" aria-label="Photo viewer" tabindex="-1"
  style:--shade={shade}>
  <!-- svelte-ignore a11y_no_static_element_interactions (gestures; ‹ ›, ✕ and the keys are the accessible path) -->
  <div class="stage" bind:this={stage} bind:clientWidth={sw} bind:clientHeight={sh}
    onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
    <div class="track" bind:this={track} style:transform="translate3d({dx}px, 0, 0)">
      {#each pages as p (p.id)}
        {@const current = p.r === row}
        {@const src = held(p.preview)?.src}
        <div class="page" class:current style:transform={pageT(p.r, current ? dy : 0)} aria-hidden={!current}
          style:padding={p.video ? `${topH}px 0 ${botH}px` : undefined}>
          <div class="box" style:width="{p.box.w}px" style:height="{p.box.h}px"
            style:background-image={layers(p.thumb, p.placeholder)}
            style:transform={current ? boxT(view) : undefined}>
            {#if p.video && current && failed?.id !== p.id}
              {#key videoTries}
                <!-- svelte-ignore a11y_media_has_caption (personal footage, no captions exist) -->
                <video src={videoUrl(p.id)} poster={src ?? undefined} controls autoplay muted playsinline preload="metadata"
                  onerror={() => fail(videoUrl(p.id))}></video>
              {/key}
            {:else if src}
              <img {src} alt="" draggable="false" class:shown={decoded[p.id]} onload={e => onImg(e, p.id)} onerror={() => { broken[p.id] = true; }} />
            {/if}
            {#if p.video && !current}<span class="play" aria-hidden="true"></span>{/if}
          </div>
        </div>
      {/each}
    </div>
  </div>

  <div class="bar top" class:hidden={!bars} bind:offsetHeight={topH}>
    <button class="icon" aria-label="Close" onclick={close}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
    </button>
    <span class="pos" aria-label="Position in range">{fPosition(a, row)}</span>
    <span class="icon" aria-hidden="true"></span>
  </div>

  <div class="bar bottom" class:hidden={!bars} bind:offsetHeight={botH}>
    <button class="icon" aria-label="Previous" disabled={prevRow == null} onclick={() => go(-1)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4 7 12l8 8" /></svg>
    </button>
    <div class="info">
      <div class="when">
        {fClock(ix.t[row], ix.off[row])} · {fFullDay(ix.t[row], ix.off[row])}{#if cur?.video}{' · '}{ix.dur[row] > 0 ? `video ${fDuration(ix.dur[row])}` : 'video'}{/if}
      </div>
      <div class="where">{place ?? (ix.gps[row] ? 'Unnamed place' : 'No location')}</div>
      {#if hooks.lightboxPanel}<hooks.lightboxPanel {id} video={cur?.video ?? false} compact />{/if}
    </div>
    <button class="icon" aria-label="Next" disabled={nextRow == null} onclick={() => go(1)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 4 8 8-8 8" /></svg>
    </button>
  </div>

  {#if waiting}<div class="loading" role="status" style:bottom="{(bars ? botH : 0) + 12}px">Loading…</div>{/if}
  {#if failure}
    <div class="msg" role="status">
      {failure.text}
      {#if failure.retry}<button class="retry" onclick={retry}>Retry</button>{/if}
    </div>
  {/if}
</div>

<style>
  /* Full screen on any phone toolbar state: fixed to the dynamic viewport (never 100vh), bars inside the safe area. */
  .tlb {
    position: fixed; left: 0; top: 0; width: 100%; height: 100%; height: 100dvh; z-index: 100;
    background: rgba(0, 0, 0, var(--shade)); outline: none; overflow: hidden;
    overscroll-behavior: none; touch-action: none; user-select: none; -webkit-user-select: none;
    -webkit-touch-callout: none; transition: opacity .18s ease-out;
  }
  .tlb.closing { opacity: 0; }
  .stage { position: absolute; inset: 0; touch-action: none; }
  .track, .page { position: absolute; inset: 0; will-change: transform; }
  .page { display: flex; align-items: center; justify-content: center; }
  .box { position: relative; flex: none; background-size: 100% 100%; transform-origin: 50% 50%; }
  .box img, .box video {
    position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; display: block;
    -webkit-user-drag: none;
  }
  .box img { opacity: 0; transition: opacity .2s ease-out; }
  .box img.shown { opacity: 1; }
  .play {
    position: absolute; left: 50%; top: 50%; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%;
    background: rgba(0, 0, 0, .5) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M9 6v12l9-6z' fill='%23E9E6DF'/%3E%3C/svg%3E") center / 28px no-repeat;
  }

  .bar {
    position: absolute; left: 0; right: 0; display: flex; align-items: center; gap: 8px;
    padding-left: max(8px, env(safe-area-inset-left)); padding-right: max(8px, env(safe-area-inset-right));
    transition: opacity .2s ease-out; pointer-events: none;
  }
  /* Only the controls take touches; a swipe starting on the bars' text still pages. */
  .bar button, .info :global(a), .info :global(summary) { pointer-events: auto; }
  .bar.hidden, .bar.hidden * { opacity: 0; pointer-events: none !important; }
  /* Backgrounds on the bars themselves, not the fixed root (Safari 26 tints its toolbar from fixed layers). */
  .top {
    top: 0; padding-top: max(4px, env(safe-area-inset-top)); justify-content: space-between;
    background: linear-gradient(rgba(0, 0, 0, .55), transparent);
  }
  .bottom {
    bottom: 0; padding-bottom: max(8px, env(safe-area-inset-bottom)); padding-top: 24px; align-items: flex-end;
    background: linear-gradient(transparent, rgba(0, 0, 0, .7) 40%);
  }
  .pos { font: 500 14px var(--f-mono); color: var(--ink); text-shadow: 0 1px 2px rgba(0, 0, 0, .6); }
  .icon {
    width: 44px; height: 44px; flex: none; display: grid; place-items: center; border: 0; border-radius: 50%;
    background: transparent; color: var(--ink); padding: 0;
  }
  button.icon:disabled { visibility: hidden; }
  button.icon:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: -2px; }
  .icon svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .info { flex: 1; min-width: 0; padding-bottom: 4px; text-align: center; color: var(--ink2); font-size: 13px; line-height: 1.35; }
  .when { color: var(--ink); font-variant-numeric: tabular-nums; }
  .where { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .loading {
    position: absolute; left: 50%; transform: translateX(-50%); padding: 4px 12px;
    border-radius: 999px; background: rgba(6, 7, 8, .7); color: var(--ink2); font-size: 12px; pointer-events: none;
    animation: fadein .3s ease-out;
  }
  @keyframes fadein { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .loading { animation: none; } }
  .msg {
    position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); max-width: 80%;
    padding: 10px 14px; border-radius: 6px; background: rgba(6, 7, 8, .85); color: var(--ink);
    font-size: 14px; text-align: center; pointer-events: none; /* swipes pass through; only Retry takes taps */
  }
  .retry {
    margin-left: 8px; min-height: 36px; background: none; border: 1px solid var(--photo-hi); border-radius: 999px;
    color: var(--ink); font: 500 13px var(--f-body); padding: 2px 14px; pointer-events: auto;
  }
  @media (prefers-reduced-motion: reduce) {
    .tlb, .bar, .box img { transition: none; }
  }
</style>
