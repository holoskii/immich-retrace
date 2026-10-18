<script lang="ts">
  // Demo mode (DEMO=1 on the server), loaded as its own chunk only then: the banner with the pitch and
  // the way to the project (one line; the photo credits live in About), the landing (a curated trip framed whole,
  // nothing playing), the coach mark once per visitor, and the About & credits panel.
  import {onMount} from 'svelte';
  import type {DemoConfig} from '../../../../shared/demo.ts';
  import {hooks} from '../hooks.svelte.ts';
  import {selection} from '../selection.svelte.ts';
  import {mapShown, playState} from '../map/playing.svelte.ts';
  import {landOnTrip} from './land.svelte.ts';
  import {TOUR, tourSeen} from './tour.ts';
  import {demoUi} from './ui.svelte.ts';
  import About from './About.svelte';
  import Coach from './Coach.svelte';
  import DemoCredit from './DemoCredit.svelte';

  /** `landing`: the page was opened without a link (no viewer state in the query), so the demo picks what to show. */
  let {config, landing}: {config: DemoConfig; landing: boolean} = $props();

  // Landing: once the URL (empty) is applied and the albums are in, open the trip the way a click on its bar would.
  landOnTrip({trip: () => config.trip, album: () => config.album ?? null, landing: () => landing});

  // The core app's extension points (hooks.svelte.ts): the `?` overlay's buttons, per-photo credits in the
  // lightbox, the album picker as "Try another trip".
  onMount(() => {
    hooks.helpActions = [
      {label: 'Show the 3-step tour again', run: () => (demoUi.tour = 0)},
      {label: 'About this demo & credits', run: () => (demoUi.about = true)},
    ];
    hooks.lightboxPanel = DemoCredit;
    hooks.albumPickerLabel = 'Try another trip';
    hooks.allTrips = true;
    return () => { hooks.helpActions = []; hooks.lightboxPanel = null; hooks.albumPickerLabel = null; hooks.allTrips = false; };
  });

  // The tour, once per visitor: once the map has shown the trip (idle, tiles in) and the photo card and Play are up
  // (its first two steps point at them); not over the lightbox, nor once the visitor has found Play on their own.
  let played = false;
  $effect(() => { if (playState.on) played = true; });
  onMount(() => {
    if (tourSeen()) return;
    const h = setInterval(() => {
      if (played) { clearInterval(h); return; }
      if (!mapShown.on || playState.on || selection.lightbox != null || demoUi.about) return;
      if (!TOUR.every(s => document.querySelector(s.target))) return;
      clearInterval(h);
      if (demoUi.tour == null) demoUi.tour = 0;
    }, 250);
    return () => clearInterval(h);
  });
</script>

<div class="banner" role="region" aria-label="Demo">
  <span class="tag">Demo · sample data</span>
  <span class="pitch">Your trips, retraced from where your photos were taken. No tracker, nothing but Immich.</span>
  <button class="link" onclick={() => (demoUi.about = true)}
    title="Photos: Kent Wang via Wikimedia Commons (CC BY / CC BY-SA), some metadata changed for the demo">About &amp; photo credits</button>
  <a class="get" href={config.repoUrl} target="_blank" rel="noopener noreferrer">Get it for your Immich →</a>
</div>
<About repoUrl={config.repoUrl} />
<Coach />

<style>
  /* One line at any width (App.svelte reserves its height before this chunk is in): the pitch gives way first. */
  .banner {
    display: flex; align-items: center; gap: 14px; padding: 0 16px; height: var(--demo-banner-h, 34px); box-sizing: border-box;
    white-space: nowrap;
    background: linear-gradient(90deg, rgba(232, 166, 78, .16), rgba(232, 166, 78, .04) 60%), var(--surface);
    border-bottom: 1px solid var(--line); font-size: 13px; color: var(--ink2);
  }
  .tag {
    padding: 1px 8px; border: 1px solid var(--photo); border-radius: 999px; color: var(--photo-hi);
    font: 500 11px var(--f-mono); text-transform: uppercase; letter-spacing: .04em; white-space: nowrap;
  }
  .pitch { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--ink); font-weight: 500; }
  .link {
    flex: none; margin-left: auto; background: none; border: 0; padding: 0; color: var(--ink2); font: 12px var(--f-body);
    text-decoration: underline; cursor: pointer;
  }
  .link:hover { color: var(--ink); }
  .get {
    flex: none; padding: 4px 12px; border-radius: 999px; background: var(--photo-hi); color: #17130C; text-decoration: none;
    font: 500 12px var(--f-body); white-space: nowrap;
  }
  .get:hover { background: #F2B862; }
  .get:focus-visible, .link:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }
</style>
