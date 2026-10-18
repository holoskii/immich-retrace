<script lang="ts">
  // The phone shell (demo mode on a phone-sized touch screen; main.ts picks it once at boot). Three tabs over the one
  // `selection` store: Map (home: the map, a floating pill, the dock), Photos (the grid, a lazy chunk) and Trips. The
  // tab is not in the URL; it follows the selection (tabs.ts) and tab switches add no history. One MapLibre instance
  // for the shell's life: the Map tab stays mounted, hidden under the others (visibility, never display: none). The touch
  // lightbox opens over any tab with a history entry, so Back closes it. The root is fixed and never scrolls; tabs
  // scroll inside themselves.
  import {onMount, untrack} from 'svelte';
  import {config} from '../config.svelte.ts';
  import {library} from '../index/store.svelte.ts';
  import {selection} from '../selection.svelte.ts';
  import {loadMapView, NoWebGL} from '../map/load.ts';
  import Lightbox, {preloadLightbox} from '../lightbox/Lightbox.svelte';
  import {fNum} from '../albums.ts';
  import type {ShellProps} from '../../main.ts';
  import {mapCovered, tabForSelection, TABS, type Tab} from './tabs.ts';
  import Pill from './Pill.svelte';
  import Dock from './Dock.svelte';
  import Trips from './Trips.svelte';

  let {landing}: ShellProps = $props();

  const mapView = loadMapView();
  const idle = (f: () => void) => 'requestIdleCallback' in window ? requestIdleCallback(f, {timeout: 5000}) : setTimeout(f, 1000);
  // The Photos grid is its own chunk (off the phone's eager path): fetched on first entry, or when idle after the map.
  let photosChunk: Promise<typeof import('./Photos.svelte')> | undefined;
  const loadPhotos = () => (photosChunk ??= import('./Photos.svelte').catch(e => { photosChunk = undefined; throw e; }));
  mapView.then(() => idle(() => { void preloadLightbox(true).catch(() => {}); void loadPhotos().catch(() => {}); }), () => {});

  let tab = $state<Tab>('map');
  /** Tabs mounted so far (they stay mounted: scroll positions, loaded covers). */
  let seen = $state<Record<Tab, boolean>>({map: true, photos: false, trips: false});
  function show(t: Tab) { tab = t; seen[t] = true; }

  // The tab follows the selection once the URL is applied and (on a landing) the demo has picked its trip.
  let landed = $state(untrack(() => !landing));
  let pulse = $state(false);
  let lastSel: unknown = undefined;
  $effect(() => {
    const s = selection.sel;
    if (!selection.urlApplied || !library.albumsLoaded || !landed || s === lastSel) return;
    lastSel = s;
    untrack(() => show(tabForSelection(tab, !!s)));
  });

  const covered = $derived(mapCovered(tab, selection.lightbox != null));
  const active = $derived(selection.active);

  // The camera frames the area between the pill and the bottom of the map (the dock is below it); the right edge
  // keeps the Follow / Fit buttons clear.
  let pillBottom = $state(0);
  const insets = $derived({t: Math.max(72, pillBottom + 16), r: 72, b: 24, l: 20});

  onMount(() => {
    document.documentElement.classList.add('phone');
    return () => document.documentElement.classList.remove('phone');
  });

  let demoChunk: Promise<typeof import('../demo/PhoneDemo.svelte')> | undefined;
  const loadDemo = () => (demoChunk ??= import('../demo/PhoneDemo.svelte'));
</script>

<div class="phoneshell">
  <div class="panes">
    <div class="pane maptab" class:off={tab !== 'map'} id="tab-map" role="tabpanel" aria-label="Map" inert={tab !== 'map'}>
      <div class="mapbox">
        {#await mapView}
          <div class="placeholder" role="status">Loading map…</div>
        {:then {default: MapView}}
          <MapView phone {covered} {insets} wholeInsets={insets} />
        {:catch e}
          {#if e instanceof NoWebGL}
            <div class="placeholder" role="status">This browser can't show the map: WebGL 2 is turned off or not supported.</div>
          {:else}
            <div class="placeholder" role="alert">The map couldn't load. <button onclick={() => location.reload()}>Reload</button></div>
          {/if}
        {/await}
        <Pill bind:bottom={pillBottom} />
      </div>
      <Dock {active} {covered} {pulse} />
    </div>

    <div class="pane" class:off={tab !== 'photos'} id="tab-photos" role="tabpanel" aria-label="Photos" inert={tab !== 'photos'}>
      {#if seen.photos}
        {#await loadPhotos() then {default: Photos}}
          <Photos shown={tab === 'photos'} pick={() => show('trips')} />
        {:catch}
          <div class="placeholder" role="alert">The photos couldn't load. <button onclick={() => location.reload()}>Reload</button></div>
        {/await}
      {/if}
    </div>

    <div class="pane" class:off={tab !== 'trips'} id="tab-trips" role="tabpanel" aria-label="Trips" inert={tab !== 'trips'}>
      {#if seen.trips}<Trips picked={() => show('map')} />{/if}
    </div>
  </div>

  <div class="tabbar" role="tablist" aria-label="Views">
    {#each TABS as t (t.id)}
      <button role="tab" class="tabbtn" aria-selected={tab === t.id} aria-controls="tab-{t.id}" onclick={() => show(t.id)}>
        {#if t.id === 'map'}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4 3 6.5v13L9 17l6 3 6-2.5v-13L15 7z M9 4v13 M15 7v13" /></svg>
        {:else if t.id === 'photos'}
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></svg>
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v12H4z M9 7V4.5h6V7" /></svg>
        {/if}
        <span>{t.label}</span>
        {#if t.id === 'photos' && active && active.hi > active.lo}<span class="badge" aria-label="{active.hi - active.lo} photos">{fNum(active.hi - active.lo)}</span>{/if}
      </button>
    {/each}
  </div>
</div>

<Lightbox touch />
{#if config.demo}
  {@const demo = config.demo}
  {#await loadDemo() then {default: PhoneDemo}}
    <PhoneDemo config={demo} {landing} landed={p => { landed = true; if (p) pulse = true; }} />
  {/await}
{/if}

<style>
  /* The page never scrolls or bounces under the map: no pull-to-refresh, no URL bar collapsing under it. */
  :global(html.phone), :global(html.phone body) { height: 100%; overflow: hidden; overscroll-behavior: none; }
  :global(html.phone) { touch-action: manipulation; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
  .phoneshell {
    position: fixed; inset: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto;
    overscroll-behavior: none; background: var(--ground);
  }
  .panes { position: relative; min-height: 0; }
  .pane { position: absolute; inset: 0; background: var(--ground); }
  /* Hidden, not removed: the map keeps its one WebGL context (display: none would also stall its camera). */
  .pane.off { visibility: hidden; }
  /* MapLibre's expanded attribution sets visibility: visible itself. */
  .pane.off :global(.maplibregl-ctrl) { visibility: hidden !important; }
  .maptab { display: grid; grid-template-rows: minmax(0, 1fr) auto; }
  .mapbox { position: relative; min-height: 0; overflow: hidden; }

  .placeholder {
    position: absolute; inset: 0; display: flex; gap: 12px; align-items: center; justify-content: center; padding: 24px;
    text-align: center; color: var(--muted); font-size: 14px;
  }
  .placeholder button {
    min-height: 44px; padding: 0 18px; border: 1px solid var(--photo); border-radius: 999px; background: var(--raised);
    color: var(--ink); font: 500 14px var(--f-body);
  }

  .tabbar {
    display: grid; grid-template-columns: repeat(3, 1fr);
    padding: 0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
    background: var(--surface); border-top: 1px solid var(--line);
  }
  .tabbtn {
    position: relative; height: 52px; display: grid; justify-items: center; align-content: center; gap: 2px; padding: 0;
    border: 0; background: none; color: var(--muted); font: 500 11px var(--f-body); cursor: pointer;
    -webkit-tap-highlight-color: transparent; touch-action: manipulation;
  }
  .tabbtn svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linejoin: round; }
  .tabbtn[aria-selected='true'] { color: var(--photo-hi); }
  .tabbtn:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: -4px; }
  .badge {
    position: absolute; top: 4px; left: calc(50% + 8px); min-width: 18px; padding: 0 5px; border-radius: 999px;
    background: var(--raised); border: 1px solid var(--line); color: var(--ink2); font: 500 10px/16px var(--f-mono);
  }

  /* Landscape (best effort, same shell): map on the left, the dock as a column on the right. */
  @media (orientation: landscape) and (max-height: 500px) {
    .maptab { grid-template-rows: minmax(0, 1fr); grid-template-columns: minmax(0, 1fr) min(360px, 46%); }
    .maptab :global(.dock) { border-top: 0; border-left: 1px solid var(--line); align-content: center; overflow-y: auto; }
    .tabbtn { height: 44px; }
  }
</style>
