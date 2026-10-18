<script lang="ts">
  // The phone demo's pitch: one line under the pill saying what Retrace is and what to press, with a way to About.
  // Once per visitor (localStorage, tour.ts PITCH_KEY): gone for good after the first ▶ or its ✕. The phone shell
  // shows it through hooks.phoneMapNote and keeps the camera's frame clear of it (`height`).
  import {untrack} from 'svelte';
  import {playState} from '../map/playing.svelte.ts';
  import {markSeen, PITCH_KEY, seenFlag} from './tour.ts';
  import {demoUi} from './ui.svelte.ts';

  let {top, height}: {top: number; height: (h: number) => void} = $props();

  let shown = $state(!seenFlag(PITCH_KEY));
  function dismiss() { shown = false; markSeen(PITCH_KEY); }
  $effect(() => { if (playState.on) untrack(() => { if (shown) dismiss(); }); });

  let h = $state(0);
  $effect(() => { height(shown ? h : 0); });
  $effect(() => () => height(0));
</script>

{#if shown}
  <div class="pitch" role="note" style:top="{top + 8}px" bind:offsetHeight={h}>
    <p>Your trips, retraced from where your photos were taken · Tap ▶
      <button class="about" onclick={() => (demoUi.about = true)}>About</button></p>
    <button class="x" aria-label="Dismiss" onclick={dismiss}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg>
    </button>
  </div>
{/if}

<style>
  .pitch {
    position: absolute; z-index: 4; left: max(10px, env(safe-area-inset-left)); right: max(10px, env(safe-area-inset-right));
    display: flex; align-items: center; gap: 2px; padding: 2px 0 2px 14px;
    background: rgba(16, 18, 21, .84); border: 1px solid var(--line); border-radius: 12px;
    font-size: 13px; line-height: 1.35; color: var(--ink);
  }
  p { flex: 1; min-width: 0; margin: 0; padding: 6px 0; }
  .about {
    /* A finger's target without widening the line: the padding is outside the text's box. */
    padding: 10px 6px; margin: -10px -2px; border: 0; background: none; color: var(--photo-hi);
    font: 500 13px var(--f-body); text-decoration: underline; cursor: pointer;
  }
  .x {
    flex: none; width: 44px; height: 44px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 10px;
    background: none; color: var(--ink2); cursor: pointer; -webkit-tap-highlight-color: transparent;
  }
  .x svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
  .about:focus-visible, .x:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }
</style>
