<script lang="ts">
  // Lightbox G-B: the photo (or video) on ~70% of the width, a logbook panel beside it.
  // Thumbhash placeholder → `size=preview` fades in. ←/→ step through the active range, Esc closes.
  import {onMount} from 'svelte';
  import type {ViewerConfig} from '../../../../shared/api.ts';
  import {selection, type Active} from '../selection.svelte.ts';
  import {base64Bytes, thumbHashDataUrl, thumbHashRatio} from '../thumbhash.ts';
  import {fDuration} from '../map/format.ts';
  import {getConfig, immichLink, mediaQueue, thumbUrl, videoUrl} from './media.ts';
  import {explainMedia, probeMedia, type MediaFailure} from '../failure.ts';
  import {bins, fClock, fCoords, fLongDate, fOffset, fPlace, fPosition, neighbours, step} from './model.ts';
  import MiniMap from './MiniMap.svelte';
  import {closeLightbox} from './Lightbox.svelte';
  import {hooks} from '../hooks.svelte.ts';

  let {a, row}: {a: Active; row: number} = $props();

  const ix = $derived(a.ix);
  const id = $derived(ix.id[row]);
  const hash = $derived(ix.thumbhash[row]);
  const isVideo = $derived(ix.video[row] === 1);
  const gps = $derived(ix.gps[row] === 1);
  const preview = $derived(thumbUrl(id, hash, 'preview'));
  const placeholder = $derived(thumbHashDataUrl(hash));
  const place = $derived(fPlace(ix.city[row], ix.country[row]));
  const prevRow = $derived(step(a, row, -1));
  const nextRow = $derived(step(a, row, 1));

  let cfg = $state<ViewerConfig | null>(null);
  const link = $derived(immichLink(cfg?.immichPublicUrl, id));

  // The photo box: the stage fitted to the asset's aspect ratio, so placeholder and image coincide.
  let sw = $state(0), sh = $state(0);
  const box = $derived.by(() => {
    let ratio = ix.ratio[row];
    if (!(ratio > 0) && hash) try { ratio = thumbHashRatio(base64Bytes(hash)); } catch { /* malformed */ }
    if (!(ratio > 0)) ratio = 1.5;
    let w = sw, h = w / ratio;
    if (h > sh) { h = sh; w = h * ratio; }
    return {w: Math.round(w), h: Math.round(h)};
  });

  // Per-asset load state; keyed by id so a late event of the previous asset can't leak in.
  let loaded = $state<string | null>(null);
  /** `kind` null while the relay is asked why (elements don't expose the HTTP status). */
  let failed = $state<{id: string; kind: MediaFailure | null} | null>(null);
  /** Bumped by Retry: remounts the element so it requests again. */
  let tries = $state(0);
  const failure = $derived(failed?.id === id && failed.kind ? explainMedia(failed.kind, isVideo) : null);

  function fail(url: string) {
    const at = id;
    failed = {id: at, kind: null};
    void probeMedia(url).then(kind => { if (failed?.id === at) failed = {id: at, kind}; });
  }
  function retry() { failed = null; tries++; }

  const go = (r: number | null) => { if (r != null) selection.lightbox = r; };
  // Like Back: pops the entry the opening pushed (no dead Back step), cursor kept on the photo shown.
  const close = closeLightbox;

  function onKey(e: KeyboardEvent) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') { trapTab(e); return; }
    // Arrow keys on a focused <video> seek; leave them to it.
    if ((e.target as HTMLElement | null)?.tagName === 'VIDEO') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(prevRow); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(nextRow); }
  }

  let overlay: HTMLDivElement;
  let stage: HTMLDivElement;

  function focusables() {
    return [...overlay.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], video[controls], [tabindex]:not([tabindex="-1"])')]
      .filter(el => el.offsetParent !== null || el === document.activeElement);
  }
  function trapTab(e: KeyboardEvent) {
    const f = focusables();
    if (!f.length) { e.preventDefault(); overlay.focus(); return; }
    const i = f.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
  }

  onMount(() => {
    void getConfig().then(c => (cfg = c));
    // Focus moves in and the app behind goes inert; both are undone on close.
    const before = document.activeElement as HTMLElement | null;
    const others = [...(overlay.parentElement?.children ?? [])].filter((el): el is HTMLElement => el !== overlay && el instanceof HTMLElement && !el.inert);
    for (const el of others) el.inert = true;
    overlay.focus();
    return () => {
      for (const el of others) el.inert = false;
      if (before?.isConnected) before.focus({preventScroll: true});
    };
  });

  // Neighbours' previews (±2) through the media queue, into the HTTP cache (the versioned URL); a step cancels
  // the ones no longer next to the open photo and keeps those that still are. The open photo's own preload is kept
  // too (none is started for it): aborting it as it becomes the photo on show would only make the <img> start the
  // same request over.
  const preloads = new Map<string, AbortController>();
  $effect(() => {
    const urls = new Set(neighbours(a, row).map(r => thumbUrl(ix.id[r], ix.thumbhash[r], 'preview')));
    for (const [u, c] of preloads) if (!urls.has(u) && u !== preview) { c.abort(); preloads.delete(u); }
    for (const u of urls) {
      if (preloads.has(u)) continue;
      const c = new AbortController();
      preloads.set(u, c);
      mediaQueue.load(u, {signal: c.signal}).catch(() => {});
    }
  });
  $effect(() => () => { for (const c of preloads.values()) c.abort(); preloads.clear(); });

  // Position strip: density of the range (√ scale) with the open asset marked.
  let strip = $state<HTMLCanvasElement>();
  let stripW = $state(0);
  const STRIP_H = 30;
  const hist = $derived(stripW ? bins(ix.t, a.lo, a.hi, a.t0, a.t1, Math.floor(stripW / 3)) : null);
  $effect(() => {
    if (!strip || !hist) return;
    const dpr = devicePixelRatio || 1, w = stripW, ctx = strip.getContext('2d');
    if (!ctx) return;
    strip.width = Math.round(w * dpr); strip.height = Math.round(STRIP_H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, STRIP_H);
    const css = getComputedStyle(strip), max = Math.max(1, ...hist);
    ctx.fillStyle = css.getPropertyValue('--photo').trim() || '#C98128';
    hist.forEach((v, i) => { if (v) { const h = Math.max(1, Math.sqrt(v / max) * (STRIP_H - 6)); ctx.fillRect(i * 3, STRIP_H - h, 2, h); } });
    const x = Math.min(w - 1.5, Math.max(0, (ix.t[row] - a.t0) / (a.t1 - a.t0 || 1) * w));
    ctx.fillStyle = css.getPropertyValue('--ink').trim() || '#E9E6DF';
    ctx.fillRect(x, 0, 1.5, STRIP_H);
  });
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events (Esc closes; the backdrop is not a control) -->
<div class="overlay" bind:this={overlay} role="dialog" aria-modal="true" aria-label="Lightbox" tabindex="-1"
  onclick={e => { if (e.target === overlay || e.target === stage) close(); }}>
  <div class="frame">
    <div class="stage" bind:this={stage} bind:clientWidth={sw} bind:clientHeight={sh}>
      <div class="box" style:width="{box.w}px" style:height="{box.h}px"
        style:background-image={placeholder ? `url(${placeholder})` : undefined}>
        {#key `${id}:${tries}`}
          {#if isVideo && failed?.id !== id}
            <!-- svelte-ignore a11y_media_has_caption (personal footage, no captions exist) -->
            <video src={videoUrl(id)} poster={preview} controls autoplay muted playsinline preload="metadata"
              onerror={() => fail(videoUrl(id))}></video>
          {:else}
            <img src={preview} alt="" draggable="false" class:shown={loaded === id}
              onload={() => (loaded = id)} onerror={() => { if (!isVideo) fail(preview); }} />
          {/if}
        {/key}
        {#if failure}
          <div class="msg" role="status">
            {failure.text}{#if failed?.kind === 'decode' && isVideo && link} Open it in Immich.{/if}
            {#if failure.retry}<button class="retry" onclick={retry}>Retry</button>{/if}
          </div>
        {/if}
      </div>
      <button class="nav prev" aria-label="Previous" disabled={prevRow == null} onclick={() => go(prevRow)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4 7 12l8 8" /></svg>
      </button>
      <button class="nav next" aria-label="Next" disabled={nextRow == null} onclick={() => go(nextRow)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 4 8 8-8 8" /></svg>
      </button>
    </div>

    <aside class="panel">
      <div class="top">
        <span class="pos" aria-label="Position in range">{fPosition(a, row)}</span>
        <button class="close" aria-label="Close" onclick={close}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <div class="clock">{fClock(ix.t[row], ix.off[row])}</div>
      <div class="date">{fLongDate(ix.t[row], ix.off[row])} · {fOffset(ix.off[row])}</div>
      <div class="kind">{isVideo ? (ix.dur[row] > 0 ? `video · ${fDuration(ix.dur[row])}` : 'video') : 'photo'}</div>

      <div class="place">{place ?? (gps ? 'Unnamed place' : 'Unknown place')}</div>
      <div class="coords">{gps ? fCoords(ix.lat[row], ix.lon[row]) : 'no GPS'}</div>
      <MiniMap {a} {row} />

      <div class="label">position in range</div>
      <div class="strip" bind:clientWidth={stripW}><canvas bind:this={strip} style:height="{STRIP_H}px"></canvas></div>

      {#if hooks.lightboxPanel}<hooks.lightboxPanel {id} video={isVideo} />{/if}
      {#if link}
        <a class="immich" href={link} target="_blank" rel="noopener noreferrer">Open in Immich ↗</a>
      {/if}
      <div class="keys" aria-hidden="true">←/→ previous / next · Esc close</div>
    </aside>
  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 100; padding: 20px;
    background: rgba(6, 7, 8, .9); outline: none;
  }
  .frame {
    height: 100%; display: grid; grid-template-columns: minmax(0, 7fr) minmax(280px, 3fr);
    border-radius: 6px; overflow: hidden; box-shadow: 0 10px 40px rgba(0, 0, 0, .5);
  }
  .stage {
    position: relative; min-width: 0; min-height: 0; background: #060708;
    display: flex; align-items: center; justify-content: center;
  }
  .box { position: relative; background-size: 100% 100%; flex: none; }
  .box img, .box video {
    position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; display: block;
    opacity: 0; transition: opacity .2s ease-out;
  }
  .box video { opacity: 1; }
  .box img.shown { opacity: 1; }
  .msg {
    position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); max-width: 80%;
    padding: 8px 12px; border-radius: 4px; background: rgba(6, 7, 8, .85); color: var(--ink);
    font-size: 13px; text-align: center;
  }
  .retry {
    margin-left: 8px; background: none; border: 1px solid var(--photo-hi); border-radius: 999px;
    color: var(--ink); font: 500 12px var(--f-body); padding: 2px 10px; cursor: pointer;
  }
  .retry:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }
  .nav {
    position: absolute; top: 50%; transform: translateY(-50%); width: 48px; height: 96px;
    display: grid; place-items: center; border: 0; border-radius: 4px; cursor: pointer;
    background: rgba(6, 7, 8, .35); color: rgba(233, 230, 223, .75);
  }
  .nav:hover, .nav:focus-visible { background: rgba(6, 7, 8, .6); color: var(--ink); }
  .nav:disabled { visibility: hidden; }
  .nav.prev { left: 8px; }
  .nav.next { right: 8px; }
  .nav svg, .close svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .panel {
    min-height: 0; overflow-y: auto; padding: 16px 20px 20px; background: var(--raised);
    display: flex; flex-direction: column; gap: 2px;
  }
  .top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .pos { font: 500 12px var(--f-mono); color: var(--ink2); }
  .close {
    width: 32px; height: 32px; display: grid; place-items: center; border: 0; border-radius: 4px;
    background: transparent; color: var(--ink2); cursor: pointer;
  }
  .close:hover, .close:focus-visible { background: var(--line); color: var(--ink); }
  .clock { font: 700 40px/1.1 var(--f-body); letter-spacing: -.01em; }
  .date { color: var(--ink2); font-size: 13px; }
  .kind { font: 400 11px var(--f-mono); color: var(--muted); margin-bottom: 14px; }
  .place { font-size: 14px; }
  .coords { font: 400 11px var(--f-mono); color: var(--muted); margin-bottom: 10px; white-space: pre; }
  .label { font: 400 11px var(--f-mono); color: var(--muted); margin-top: 14px; }
  .strip canvas { display: block; width: 100%; }
  .immich {
    margin-top: 16px; padding: 7px 12px; border: 1px solid var(--line); border-radius: 4px;
    color: var(--ink); text-decoration: none; font-size: 13px; align-self: stretch;
  }
  .immich:hover, .immich:focus-visible { border-color: var(--muted); }
  .keys { margin-top: auto; padding-top: 16px; font: 400 11px var(--f-mono); color: var(--muted); }
  @media (prefers-reduced-motion: reduce) {
    .box img, .box video { transition: none; }
  }
</style>
