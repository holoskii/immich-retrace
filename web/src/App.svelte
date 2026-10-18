<script lang="ts">
  // The desktop shell (layout L-A): overview strip on top, map below (full width until the photo-wave lands).
  // main.ts has started the library, URL sync, config and the map's chunk; this tree is its own chunk.
  import Overview from './lib/overview/Overview.svelte';
  import Lightbox, {preloadLightbox} from './lib/lightbox/Lightbox.svelte';
  import {config} from './lib/config.svelte.ts';
  import {loadMapView, NoWebGL} from './lib/map/load.ts';
  import type {ShellProps} from './main.ts';

  let {landing}: ShellProps = $props();

  // MapLibre (~1.2 MB + its worker) comes in its own chunk, so the overview paints without waiting
  // for it; nothing in this eager graph may import maplibre-gl. The lightbox view follows when idle.
  const mapView = loadMapView();
  const idle = (f: () => void) => 'requestIdleCallback' in window ? requestIdleCallback(f, {timeout: 5000}) : setTimeout(f, 1000);
  mapView.then(() => idle(() => void preloadLightbox().catch(() => {})), () => {});

  // Demo mode (server DEMO=1) is its own chunk, fetched only then; mounted from the config store, so a
  // config that only arrives on a later try (a first fetch failed) still brings it.
  let demoChunk: Promise<typeof import('./lib/demo/Demo.svelte')> | undefined;
  const loadDemo = () => (demoChunk ??= import('./lib/demo/Demo.svelte'));
</script>

<div class="app">
  <div>
    {#if config.demo}
      {@const demo = config.demo}
      <!-- The banner's line is reserved while the chunk loads: nothing below moves when it arrives. -->
      {#await loadDemo()}<div class="demo-slot"></div>{:then {default: Demo}}<Demo config={demo} {landing} />{/await}
    {/if}
  </div>
  <header><Overview /></header>
  <main>
    {#await mapView}
      <div class="placeholder" role="status">Loading map…</div>
    {:then {default: MapView}}
      <MapView />
    {:catch e}
      {#if e instanceof NoWebGL}
        <div class="placeholder" role="status">This browser can't show the map: WebGL 2 is turned off or not supported.</div>
      {:else}
        <!-- Offline, or a redeploy replaced the hashed files this page refers to. -->
        <div class="placeholder" role="alert">The map couldn't load. <button onclick={() => location.reload()}>Reload</button></div>
      {/if}
    {/await}
  </main>
</div>
<Lightbox />

<style>
  /* First row: the demo banner (empty, so zero height, on a normal deployment). */
  /* minmax(0, 1fr): one-line rows (the banner, a short window's readout) ellipsise instead of widening the page. */
  .app { height: 100%; display: grid; grid-template-rows: auto auto 1fr; grid-template-columns: minmax(0, 1fr); --demo-banner-h: 34px; }
  .demo-slot { height: var(--demo-banner-h); }
  main { min-height: 0; }
  .placeholder {
    height: 100%; display: flex; gap: 12px; align-items: center; justify-content: center;
    background: var(--ground); color: var(--muted); font-size: 13px;
  }
  .placeholder button {
    background: var(--raised); color: var(--ink); border: 1px solid var(--photo); border-radius: 999px;
    font: 500 12px var(--f-body); padding: 3px 12px; cursor: pointer;
  }
</style>
