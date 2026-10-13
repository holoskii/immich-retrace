<script lang="ts">
  // Layout L-A: overview strip on top, map below (full width until the photo-wave lands).
  import {library} from './lib/index/store.svelte.ts';
  import Overview from './lib/overview/Overview.svelte';
  import MapView from './lib/map/MapView.svelte';
  import Lightbox from './lib/lightbox/Lightbox.svelte';
  import {startUrlSync} from './lib/selection.svelte.ts';

  void library.load();
  // Applies ?from/to/album/at/lb once the index is there, then follows back/forward.
  startUrlSync();
</script>

<div class="app">
  <header><Overview /></header>
  <main><MapView /></main>
</div>
<Lightbox />

<style>
  .app { height: 100%; display: grid; grid-template-rows: auto 1fr; }
  main { min-height: 0; }
</style>
