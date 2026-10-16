<script module lang="ts">
  import {rowInActive, selection, writeUrl} from '../selection.svelte.ts';

  /** A touch screen (phone, tablet): the touch lightbox. Read once, like the shell choice; a mouse desktop keeps G-B. */
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  // Each view is a separate chunk: fetched on first open, or ahead of it via preloadLightbox().
  let view: Promise<typeof import('./LightboxView.svelte')> | undefined;
  let touchView: Promise<typeof import('./TouchLightbox.svelte')> | undefined;
  export const preloadLightbox = (touch = coarse) => touch
    ? (touchView ??= import('./TouchLightbox.svelte').catch(e => { touchView = undefined; throw e; }))
    : (view ??= import('./LightboxView.svelte').catch(e => { view = undefined; throw e; }));

  /** history.state of the entry an opening pushed. */
  const OPENED = {lightbox: true};
  /** The current entry is one an opening pushed (or a cold link's, given a parent): Back from it closes the lightbox. */
  const openedHere = () => (history.state as {lightbox?: unknown} | null)?.lightbox === true && new URLSearchParams(location.search).has('lb');

  /** The pending debounced `lb` write of a step. */
  let timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Closes the lightbox the way Back does (Esc, ✕, the touch view's swipe down): pops the entry the opening pushed, so
   * neither a second entry nor a dead Back step is left. The last step is written first, so Forward reopens the photo
   * last shown; the cursor stays on that photo, as it did when closing replaced the entry. Without such an entry (a
   * desktop cold link), closes in place (replace).
   */
  export function closeLightbox() {
    clearTimeout(timer);
    const id = selection.lightboxId;
    if (!openedHere() || !id) { selection.lightbox = null; return; }
    writeUrl('replace', selection.cursor);
    addEventListener('popstate', () => keepCursorOn(id), {once: true});
    history.back();
  }

  /** After a Back that closed the lightbox: the cursor (and the URL's `at`) back on asset `id`, if it is in range. */
  export function keepCursorOn(id: string) {
    const q = new URLSearchParams(location.search), act = selection.active;
    const r = act && !q.has('lb') ? rowInActive(act, id) : null;
    if (!act || r == null) return;
    if (selection.cursor !== act.ix.t[r] || selection.cursorId !== id) selection.cursorTo(act.ix, r);
    if (q.get('at') !== String(Math.round(act.ix.t[r]))) writeUrl('replace', selection.cursor);
  }
</script>

<script lang="ts">
  // Lightbox controller, always mounted: keeps `selection.lightbox` valid across index swaps and
  // range changes, moves the time cursor to the open asset, and mirrors it into the URL (`lb`).
  // Opening pushes a history entry (Back closes); stepping replaces it. Closing: Esc on the desktop's
  // G-B view replaces it; the touch view pops it (closeLightbox). `touch`: which view (default: a
  // coarse pointer); a phone shell mounts this with `touch` too.
  import {untrack} from 'svelte';
  import type {LibraryIndex} from '../index/model.ts';
  import {lightboxPending} from '../selection.svelte.ts';
  import {reconcile} from './model.ts';

  let {touch = coarse}: {touch?: boolean} = $props();

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
      if (prev?.id !== id) selection.cursorTo(a.ix, r);
      prev = {ix: a.ix, id};
    });
  });

  $effect(() => {
    const id = selection.lightboxId;
    untrack(() => {
      if (lightboxPending()) return;
      const q = new URLSearchParams(location.search), cur = q.get('lb');
      if (cur === id) {
        // A cold link with `lb` (or a reload of one) on a touch screen: slip the same view without `lb` in under it,
        // so Back and ✕ close the photo instead of leaving the app.
        if (touch && id && !openedHere()) {
          const href = location.href;
          q.delete('lb');
          const rest = q.toString();
          history.replaceState(history.state, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
          history.pushState(OPENED, '', href);
        }
        return;
      }
      clearTimeout(timer);
      if (id && !cur) writeUrl('commit', selection.cursor, OPENED);
      // Stepping: replace, debounced (held arrow keys; Safari throttles history calls).
      else if (id) timer = setTimeout(() => writeUrl('replace', selection.cursor), 250);
      else writeUrl('replace', selection.cursor);
    });
  });
</script>

{#if selection.active && selection.lightbox != null && selection.lightboxId}
  {#await preloadLightbox(touch) then {default: View}}
    <View a={selection.active} row={selection.lightbox} />
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
