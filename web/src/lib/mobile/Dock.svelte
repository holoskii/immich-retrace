<script lang="ts">
  // The Map tab's dock: the photo at the cursor (tap → lightbox), the time strip, and ⏮ ▶ ⏭ (by stop; ▶ steps photo
  // by photo, player.ts). Play stops when the page is hidden, the map covered (another tab, the lightbox), the
  // selection changes or the strip is touched. The card's first image is the page's LCP element: loaded by the
  // <img> itself at high priority; later ones come through the media queue (rate-limited in the demo) via CardImage:
  // the photo's thumbhash until its own thumbnail is in, never another photo's. Under another tab or the lightbox it
  // loads nothing (the lightbox pages the cursor along); while playing it prefetches the next photos.
  import {onMount, untrack} from 'svelte';
  import {selection, writeUrl, type Active} from '../selection.svelte.ts';
  import {cursorRow, stepRow, typicalOffset} from '../map/route.ts';
  import {findStops, stepStop} from '../map/stops.ts';
  import {planFor, playAhead, playDwell, playStart} from '../map/play.ts';
  import {playState} from '../map/playing.svelte.ts';
  import {markScrub} from '../map/scrub.ts';
  import {fDuration, fWhen} from '../map/format.ts';
  import {thumbHashDataUrl} from '../thumbhash.ts';
  import {mediaQueue, thumbUrl} from '../lightbox/media.ts';
  import {CardImage} from '../lightbox/card.ts';
  import {fNum} from '../albums.ts';
  import {explainAlbums} from '../failure.ts';
  import {Player} from './player.ts';
  import {stopLabel} from './strip.ts';
  import Strip from './Strip.svelte';

  /** `pulse`: ▶ pulses once (the demo landing). `covered`: the map is out of sight. `pick`: show Trips. */
  let {active, covered, pulse = false, pick}: {active: Active | null; covered: boolean; pulse?: boolean; pick: () => void} = $props();

  /** The selected album's photos couldn't be loaded (the Photos tab says the same). */
  const membersError = $derived(selection.sel?.kind === 'album' && selection.membersLoad?.albumId === selection.sel.albumId ? selection.membersLoad.error : null);

  const offset = $derived(active ? typicalOffset(active.ix, active.lo, active.hi) : 0);
  const stops = $derived(active ? findStops(active.ix, active.lo, active.hi) : []);
  const cursorIn = $derived(active && selection.cursor != null && selection.cursor >= active.t0 && selection.cursor < active.t1 ? selection.cursor : null);
  const rowAt = (a: Active, c: number) => cursorRow(a.ix, a.lo, a.hi, c, selection.pickIn(a));
  const nearest = $derived(active && cursorIn != null ? rowAt(active, cursorIn) : -1);

  // ---- the card's image ----
  const wantUrl = $derived(active && nearest >= 0 ? thumbUrl(active.ix.id[nearest], active.ix.thumbhash[nearest]) : null);
  /** The first thumbnail, loaded by the <img> (fetchpriority high) rather than the queue; then handed to `card`. */
  let lcp = $state<string | null>(null), lcpPending = $state(false);
  let cardV = $state(0);
  const card = new CardImage(mediaQueue, () => cardV++);
  $effect(() => () => card.dispose());
  $effect(() => {
    const w = wantUrl;
    if (w && lcp == null && !covered) { lcp = w; lcpPending = true; return; }
    // Covered (another tab, the lightbox paging the cursor along): nothing to show, so nothing loaded.
    if (!untrack(() => lcpPending)) card.want(covered ? null : w);
  });
  /** Play's prefetch (play.ts playAhead): the photos it lingers on next, in the background share of the demo's budget. */
  $effect(() => {
    const a = active, r = nearest, p = plan;
    if (!playing || !a || !p || r < 0) { card.ahead([]); return; }
    card.ahead(playAhead(p, r, !!reducedMq?.matches).map(k => thumbUrl(a.ix.id[k], a.ix.thumbhash[k])));
  });
  function lcpDone(ok: boolean) {
    if (!lcpPending || !lcp) return;
    lcpPending = false;
    if (ok) card.adopt(lcp, lcp);
    card.want(covered ? null : wantUrl);
  }
  /** Only ever the photo at the cursor: else no <img>, and the card shows that photo's thumbhash. */
  const imgSrc = $derived.by(() => {
    void cardV;
    if (lcpPending) return lcp;
    return wantUrl ? card.src : null;
  });
  const imgHidden = $derived(lcpPending && lcp !== wantUrl);

  function open() { if (nearest >= 0) selection.lightbox = nearest; }

  // ---- Play ----
  let playing = $state(false);
  const reducedMq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let lastUrl = 0;
  /** Play moves the cursor within the current history entry; throttled (Safari limits history calls). */
  function playUrl(force = false) {
    const now = Date.now();
    if (!force && now - lastUrl < 1000) return;
    lastUrl = now;
    writeUrl('replace', selection.cursor);
  }
  function nextRow(): number {
    const a = active, c = selection.cursor;
    return a && c != null ? stepRow(a.ix, a.lo, a.hi, c, rowAt(a, c), 1) : -1;
  }
  /** Play's timing for the selection (play.ts), with the stops ⏮ ⏭ use. */
  const plan = $derived(active ? planFor(active.ix, active.lo, active.hi) : null);
  const player = new Player({
    dwell: () => {
      const a = active, c = selection.cursor;
      return a && plan && c != null ? playDwell(plan, a.ix, c, rowAt(a, c), !!reducedMq?.matches) : null;
    },
    advance: () => {
      const a = active, r = nextRow();
      if (!a || r < 0) return;
      markScrub(); // the follow camera flies along
      selection.cursorTo(a.ix, r);
      played = selection.cursor;
      playUrl();
    },
    changed: p => { playing = playState.on = p; if (!p) playUrl(true); },
  });
  function play() {
    const a = active;
    if (!a) return;
    const start = playStart(a.ix, a.lo, a.hi, cursorIn, cursorIn == null ? -1 : rowAt(a, cursorIn));
    if (start == null) return;
    // Starting over from the first photo is a seek (the camera snaps there).
    if (start >= 0) { selection.cursorTo(a.ix, start); playUrl(true); }
    played = selection.cursor;
    player.start();
  }
  const togglePlay = () => (player.playing ? player.stop() : play());

  $effect(() => { if (covered) untrack(() => player.stop()); });
  // Any cursor move Play didn't make (⏮ ⏭, a pin, the strip, the lightbox) takes the cursor over, as on the desktop.
  let played: number | null = null;
  $effect(() => { const c = selection.cursor; untrack(() => { if (player.playing && c !== played) player.stop(); }); });
  $effect(() => { void selection.sel; untrack(() => player.stop()); });
  onMount(() => {
    const vis = () => { if (document.hidden) player.stop(); };
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); player.stop(); };
  });

  // ---- ⏮ ⏭ by stop ----
  const from = $derived(cursorIn ?? (active ? active.t0 - 1 : 0));
  const prevStop = $derived(stepStop(stops, from, -1));
  const nextStop = $derived(stepStop(stops, from, 1));
  function toStop(i: number) {
    const a = active;
    if (!a || i < 0) return;
    selection.cursorTo(a.ix, stops[i].lo);
    writeUrl('replace', selection.cursor);
  }
  const where = $derived(stopLabel(stops, cursorIn));

  // Once, when the landing asked for it and the button can be pressed (the trip's photos are in).
  let pulsing = $state(false), pulsed = $state(false);
  $effect(() => {
    if (!pulse || !active || active.hi <= active.lo) return;
    untrack(() => { if (!pulsed) { pulsed = true; pulsing = true; } });
  });
</script>

<div class="dock" class:empty={!active}>
  {#if active && nearest >= 0}
    {@const ix = active.ix}
    {@const r = nearest}
    {@const hash = thumbHashDataUrl(ix.thumbhash[r])}
    <div class="card" role="button" tabindex="0" onclick={open} onkeydown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
      aria-label="Open the photo from {fWhen(ix.t[r], ix.off[r])}">
      <div class="ph" style:background-image={hash ? `url(${hash})` : undefined} data-want={wantUrl}>
        {#if imgSrc}<img src={imgSrc} alt="" fetchpriority="high" decoding="async" style:visibility={imgHidden ? 'hidden' : null}
          onload={() => lcpDone(true)} onerror={() => lcpDone(false)} />{/if}
        {#if ix.video[r]}<span class="vid">{fDuration(ix.dur[r])}</span>{/if}
      </div>
      <div class="txt">
        <strong>{fWhen(ix.t[r], ix.off[r])}</strong>
        <span class="place">{ix.city[r] || ix.country[r] || (ix.gps[r] ? 'GPS, no place name' : 'no location')}</span>
        <span class="open">{ix.video[r] ? 'Play video' : 'Open photo'} ›</span>
      </div>
      <span class="n">{fNum(r - active.lo + 1)} / {fNum(active.hi - active.lo)}</span>
    </div>
  {:else if !active && membersError}
    <div class="card msg" role="alert">
      <p>{explainAlbums(membersError, 'The trip’s photos')}</p>
      <button onclick={() => selection.retryMembers()}>Try again</button>
    </div>
  {:else if active && active.hi <= active.lo}
    <div class="card msg">
      <p>No photos in this selection.</p>
      <button onclick={pick}>Choose a trip</button>
    </div>
  {:else}
    <!-- Loading (the photos, or the cursor's first placement). -->
    <div class="card skeleton" aria-hidden="true"><div class="ph"></div><div class="txt"><span></span><span></span></div></div>
  {/if}

  <div class="strip">
    {#if active && active.hi > active.lo}
      <Strip {active} {offset} {stops} onscrub={() => player.stop()} />
    {:else}
      <div class="strip-ph"></div>
    {/if}
  </div>

  <div class="transport">
    <button class="tb" aria-label="Previous stop" disabled={!active || prevStop < 0} onclick={() => toStop(prevStop)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14M19 5 9 12l10 7z" /></svg>
    </button>
    <button class="tb play" class:on={playing} class:pulse={pulsing} data-pulsed={pulsed || undefined} aria-pressed={playing} aria-label={playing ? 'Pause' : 'Play: step through the photos, the map following'}
      disabled={!active || active.hi <= active.lo} onclick={togglePlay} onanimationend={() => (pulsing = false)}>
      {#if playing}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
      {:else}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
      {/if}
    </button>
    <button class="tb" aria-label="Next stop" disabled={!active || nextStop < 0} onclick={() => toStop(nextStop)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14M5 5l10 7-10 7z" /></svg>
    </button>
    <span class="where" aria-live="polite">{where}</span>
  </div>
</div>

<style>
  .dock {
    display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; gap: 8px; padding: 10px max(24px, env(safe-area-inset-right)) 8px max(24px, env(safe-area-inset-left));
    background: var(--surface); border-top: 1px solid var(--line);
  }
  .card {
    display: grid; grid-template-columns: 96px minmax(0, 1fr) auto; gap: 10px; align-items: center; min-height: 72px;
    padding: 6px; margin: 0 -12px; border: 1px solid var(--line); border-radius: 12px; background: #0B0C0E;
    cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation;
  }
  .card:active { border-color: var(--muted); }
  .card:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }
  .ph { position: relative; height: 60px; border-radius: 8px; overflow: hidden; background: var(--raised) center / cover no-repeat; }
  .ph img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .vid {
    position: absolute; left: 0; right: 0; bottom: 0; padding: 0 5px; font: 400 10px/16px var(--f-mono); color: #fff; text-align: right;
    background: linear-gradient(transparent, rgba(0, 0, 0, .6)); border-bottom: 3px solid var(--video);
  }
  .txt { display: grid; min-width: 0; font-size: 13px; line-height: 1.3; }
  .txt strong { color: var(--ink); font-weight: 500; font-size: 14px; }
  .place { color: var(--ink2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .open { color: var(--photo-hi); font-size: 13px; margin-top: 2px; }
  .n { align-self: start; padding: 2px 4px 0 0; font: 400 11px var(--f-mono); color: var(--muted); white-space: nowrap; }
  .skeleton { cursor: default; }
  .card.msg { display: flex; flex-wrap: wrap; gap: 8px 12px; padding: 10px 12px; cursor: default; font-size: 13px; color: var(--ink2); }
  .card.msg p { flex: 1 1 160px; margin: 0; }
  .card.msg button {
    flex: none; min-height: 44px; padding: 0 18px; border: 1px solid var(--photo); border-radius: 999px; background: var(--raised);
    color: var(--ink); font: 500 14px var(--f-body); cursor: pointer;
  }
  .card.msg button:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }
  .skeleton .txt span { height: 10px; margin: 4px 0; border-radius: 4px; background: var(--raised); width: 70%; }
  .strip-ph { height: 50px; }

  .transport { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .tb {
    flex: none; width: 48px; height: 48px; display: grid; place-items: center; padding: 0; border-radius: 50%;
    background: var(--raised); border: 1px solid var(--line); color: var(--ink); cursor: pointer;
    -webkit-tap-highlight-color: transparent; touch-action: manipulation;
  }
  .tb svg { width: 22px; height: 22px; fill: currentColor; stroke: currentColor; stroke-width: 2; stroke-linejoin: round; }
  .tb:disabled { color: var(--muted); opacity: .45; cursor: default; }
  .tb:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }
  .tb.play { width: 56px; height: 56px; background: var(--photo-hi); border-color: var(--photo-hi); color: #17130C; }
  .tb.play svg { stroke: none; }
  .tb.play.on { background: var(--raised); color: var(--ink); }
  /* Once, on the demo landing: the first thing to press. */
  .tb.play.pulse { animation: pulse 1.2s ease-out 1; }
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(232, 166, 78, .7); }
    100% { box-shadow: 0 0 0 16px rgba(232, 166, 78, 0); }
  }
  @media (prefers-reduced-motion: reduce) { .tb.play.pulse { animation: none; } }
  .where { flex: 1; min-width: 0; text-align: right; font-size: 13px; color: var(--ink2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* Landscape: the dock is a narrow column beside the map; the stop's name gets its own line under the buttons. */
  @media (orientation: landscape) and (max-height: 500px) {
    .dock { padding-left: 16px; }
    .transport { flex-wrap: wrap; row-gap: 4px; }
    .where { flex-basis: 100%; text-align: left; }
    /* The counter under the text, not beside it: the text keeps the card's width. */
    .card:not(.msg, .skeleton) { grid-template-columns: 80px minmax(0, 1fr); row-gap: 2px; }
    .card:not(.msg, .skeleton) .ph { grid-row: span 2; }
    .card:not(.msg, .skeleton) .n { grid-column: 2; padding: 0; }
  }
</style>
