<script lang="ts">
  // Layout L-A: overview strip on top, map below (full width until the photo-wave lands).
  import {library} from './lib/index/store.svelte.ts';
  import Overview from './lib/overview/Overview.svelte';
  import Lightbox, {preloadLightbox} from './lib/lightbox/Lightbox.svelte';
  import {startUrlSync} from './lib/selection.svelte.ts';

  void library.load();
  // Applies ?from/to/album/at/lb once the index is there, then follows back/forward.
  startUrlSync();

  // MapLibre (~1.2 MB + its worker) comes in its own chunk, so the overview paints without waiting
  // for it; nothing in this eager graph may import maplibre-gl. The lightbox view follows when idle.
  const mapView = import('./lib/map/MapView.svelte');
  const idle = (f: () => void) => 'requestIdleCallback' in window ? requestIdleCallback(f, {timeout: 5000}) : setTimeout(f, 1000);
  mapView.then(() => idle(() => void preloadLightbox().catch(() => {})), () => {});
</script>

<div class="app">
  <header><Overview /></header>
  <main>
    {#await mapView}
      <div class="placeholder" role="status">Loading map…</div>
    {:then {default: MapView}}
      <MapView />
    {:catch}
      <!-- Offline, or a redeploy replaced the hashed files this page refers to. -->
      <div class="placeholder" role="alert">The map couldn't load. <button onclick={() => location.reload()}>Reload</button></div>
    {/await}
  </main>
</div>
<Lightbox />

<style>
  .app { height: 100%; display: grid; grid-template-rows: auto 1fr; }
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
