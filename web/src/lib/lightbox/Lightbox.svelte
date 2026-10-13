<script lang="ts">
  // Lightbox G-B controller, always mounted: keeps `selection.lightbox` valid across index swaps and
  // range changes, moves the time cursor to the open asset, and mirrors it into the URL (`lb`).
  // Opening pushes a history entry (Back closes); stepping and closing replace it.
  import {untrack} from 'svelte';
  import type {LibraryIndex} from '../index/model.ts';
  import {lightboxPending, selection, writeUrl} from '../selection.svelte.ts';
  import {reconcile} from './model.ts';
  import LightboxView from './LightboxView.svelte';

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
  <LightboxView a={selection.active} row={selection.lightbox} />
{/if}
