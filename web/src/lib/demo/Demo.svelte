<script lang="ts">
  // Demo mode (DEMO=1 on the server), loaded as its own chunk only then: the banner with the pitch and
  // the way to the project, the landing (a curated trip, cursor on a representative photo, Follow on,
  // nothing playing), the coach mark once per visitor, and the About & credits panel.
  import {onMount} from 'svelte';
  import type {DemoConfig} from '../../../../shared/demo.ts';
  import {hooks} from '../hooks.svelte.ts';
  import {selection} from '../selection.svelte.ts';
  import {landOnTrip} from './land.svelte.ts';
  import {TOUR, tourSeen} from './tour.ts';
  import {demoUi} from './ui.svelte.ts';
  import About from './About.svelte';
  import Coach from './Coach.svelte';
  import DemoCredit from './DemoCredit.svelte';

  /** `landing`: the page was opened without a link (no viewer state in the query), so the demo picks what to show. */
  let {config, landing}: {config: DemoConfig; landing: boolean} = $props();

  // Landing: once the URL (empty) is applied and the albums are in, open the trip the way a click on its bar would.
  landOnTrip({trip: () => config.trip, landing: () => landing});

  // The core app's extension points (hooks.svelte.ts): the `?` overlay's buttons, per-photo credits in the
  // lightbox, the album picker as "Try another trip".
  onMount(() => {
    hooks.helpActions = [
      {label: 'Show the 3-step tour again', run: () => (demoUi.tour = 0)},
      {label: 'About this demo & credits', run: () => (demoUi.about = true)},
    ];
    hooks.lightboxPanel = DemoCredit;
    hooks.albumPickerLabel = 'Try another trip';
    return () => { hooks.helpActions = []; hooks.lightboxPanel = null; hooks.albumPickerLabel = null; };
  });

  // The tour, once per visitor: when the photo card is up (its third step points at it), or after a few seconds anyway.
  onMount(() => {
    if (tourSeen()) return;
    const t0 = performance.now();
    const h = setInterval(() => {
      const card = document.querySelector(TOUR[2].target), strip = document.querySelector(TOUR[1].target);
      if (!(card && strip) && performance.now() - t0 < 8000) return;
      clearInterval(h);
      if (demoUi.tour == null && selection.lightbox == null) demoUi.tour = 0;
    }, 250);
    return () => clearInterval(h);
  });
</script>

<div class="banner" role="region" aria-label="Demo">
  <span class="tag">Demo · sample data</span>
  <span class="pitch">Your trips, retraced from where your photos were taken. No tracker, nothing but Immich.</span>
  <span class="credit">Photos: Kent Wang via Wikimedia Commons (CC BY / CC BY-SA), some metadata changed for the demo ·
    <button class="link" onclick={() => (demoUi.about = true)}>About &amp; credits</button></span>
  <a class="get" href={config.repoUrl} target="_blank" rel="noopener noreferrer">Get it for your Immich →</a>
</div>
<About repoUrl={config.repoUrl} />
<Coach />

<style>
  .banner {
    display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; padding: 6px 16px;
    background: linear-gradient(90deg, rgba(232, 166, 78, .16), rgba(232, 166, 78, .04) 60%), var(--surface);
    border-bottom: 1px solid var(--line); font-size: 13px; color: var(--ink2);
  }
  .tag {
    padding: 1px 8px; border: 1px solid var(--photo); border-radius: 999px; color: var(--photo-hi);
    font: 500 11px var(--f-mono); text-transform: uppercase; letter-spacing: .04em; white-space: nowrap;
  }
  .pitch { color: var(--ink); font-weight: 500; }
  .credit { flex: 1 1 360px; min-width: 0; font-size: 11px; color: var(--muted); text-align: right; }
  .link { background: none; border: 0; padding: 0; color: var(--ink2); font: inherit; text-decoration: underline; cursor: pointer; }
  .link:hover { color: var(--ink); }
  .get {
    padding: 4px 12px; border-radius: 999px; background: var(--photo-hi); color: #17130C; text-decoration: none;
    font: 500 12px var(--f-body); white-space: nowrap;
  }
  .get:hover { background: #F2B862; }
  .get:focus-visible, .link:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }
</style>
