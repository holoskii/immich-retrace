<script module lang="ts">
  // The view (and its mini-map) is a separate chunk: fetched on first open, or ahead of it via preloadLightbox().
  let view: Promise<typeof import('./LightboxView.svelte')> | undefined;
  export const preloadLightbox = () =>
    (view ??= import('./LightboxView.svelte').catch(e => { view = undefined; throw e; }));
</script>

<script lang="ts">
  // Lightbox G-B controller, always mounted: keeps `selection.lightbox` valid across index swaps and
  // range changes, moves the time cursor to the open asset, and mirrors it into the URL (`lb`).
  // Opening pushes a history entry (Back closes); stepping and closing replace it.
  import {untrack} from 'svelte';
  import type {LibraryIndex} from '../index/model.ts';
  import {lightboxPending, selection, writeUrl} from '../selection.svelte.ts';
  import {reconcile} from './model.ts';

  let prev: {ix: LibraryIndex; id: string} | null = null;

  $effect(() => {
    const a = selection.active, row = selection.lightbox;
    untrack(() => {
      if (row == null) { prev = null; return; }
      if (!a) { if (!lightboxPending()) selection.lightbox = null; return; }
      const r = reconcile(a, row, prev);
      if (r !== row) { selection.lightbox = r; return; } // the effect runs again with r
      if (r == null) return;
      const id = a.ix.id[r];
      if (prev?.id !== id) selection.cursor = a.ix.t[r];
      prev = {ix: a.ix, id};
    });
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const id = selection.lightboxId;
    untrack(() => {
      if (lightboxPending()) return;
      const cur = new URLSearchParams(location.search).get('lb');
      if (cur === id) return;
      clearTimeout(timer);
      if (id && !cur) writeUrl('commit', selection.cursor);
      // Stepping: replace, debounced (held arrow keys; Safari throttles history calls).
      else if (id) timer = setTimeout(() => writeUrl('replace', selection.cursor), 250);
      else writeUrl('replace', selection.cursor);
    });
  });
</script>

{#if selection.active && selection.lightbox != null && selection.lightboxId}
  {#await preloadLightbox() then {default: LightboxView}}
    <LightboxView a={selection.active} row={selection.lightbox} />
  {:catch}
    <!-- A failed chunk: offline, or a redeploy replaced the hashed files this page refers to. -->
    <div class="failed" role="alert">
      The photo viewer couldn't load.
      <button onclick={() => location.reload()}>Reload</button>
      <button onclick={() => (selection.lightbox = null)}>Close</button>
    </div>
  {/await}
{/if}

<style>
  .failed {
    position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 50;
    display: flex; gap: 12px; align-items: center; padding: 14px 18px;
    background: rgba(11, 12, 14, .94); border: 1px solid var(--line); border-radius: 8px; color: var(--ink);
  }
  .failed button {
    background: var(--raised); color: var(--ink); border: 1px solid var(--photo); border-radius: 999px;
    font: 500 12px var(--f-body); padding: 3px 12px; cursor: pointer;
  }
</style>
