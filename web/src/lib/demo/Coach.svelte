<script lang="ts">
  // The demo's 3-step coach mark (Play → photo card → timeline): a ring around the target and a
  // bubble beside it, following the target every frame while open (the card moves with the camera).
  // Esc, "Skip" or "Done" end it and remember that (tour.ts); the `?` overlay starts it again.
  import {selection} from '../selection.svelte.ts';
  import {markTourSeen, placeBubble, TOUR, type Box} from './tour.ts';
  import {demoUi} from './ui.svelte.ts';

  const i = $derived(demoUi.tour);
  const step = $derived(i == null ? null : TOUR[i] ?? null);
  /** Hidden while the lightbox is up (it makes the app behind it inert). */
  const shown = $derived(!!step && selection.lightbox == null);

  let target = $state.raw<Box | null>(null);
  let vw = $state(0), vh = $state(0), bw = $state(300), bh = $state(130);
  let nextBtn = $state<HTMLButtonElement>();

  $effect(() => {
    if (!shown || !step) return;
    let raf = 0;
    const tick = () => {
      const r = document.querySelector(step.target)?.getBoundingClientRect();
      const t = r && r.width > 0 && r.height > 0 ? {x: r.x, y: r.y, w: r.width, h: r.height} : null;
      // Only a real move re-renders (the card keeps moving while the camera follows).
      if (!t !== !target || (t && target && (t.x !== target.x || t.y !== target.y || t.w !== target.w || t.h !== target.h))) target = t;
      vw = innerWidth; vh = innerHeight;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  });
  // Each step takes the focus, so Enter / Space go on and Esc ends it.
  $effect(() => { if (shown && i != null) nextBtn?.focus({preventScroll: true}); });

  const at = $derived(placeBubble(target, {w: bw, h: bh}, vw, vh));

  function next() {
    if (i == null) return;
    if (i + 1 < TOUR.length) demoUi.tour = i + 1; else end();
  }
  function end() { demoUi.tour = null; markTourSeen(); }

  function onKey(e: KeyboardEvent) {
    if (!shown || e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    end();
  }
</script>

<svelte:window onkeydown={onKey} />
{#if shown && step && i != null}
  {#if target}
    <div class="ring" aria-hidden="true" style:left="{target.x - 4}px" style:top="{target.y - 4}px" style:width="{target.w + 8}px" style:height="{target.h + 8}px"></div>
  {/if}
  <div class="bubble {at.side}" role="dialog" aria-labelledby="tour-title" aria-describedby="tour-text"
    bind:offsetWidth={bw} bind:offsetHeight={bh} style:left="{at.x}px" style:top="{at.y}px" style:--arrow="{at.arrow ?? 0}px">
    <div class="n">{i + 1} / {TOUR.length}</div>
    <h3 id="tour-title">{step.title}</h3>
    <p id="tour-text">{step.text}</p>
    <div class="acts">
      <button class="skip" onclick={end}>{i + 1 < TOUR.length ? 'Skip tour' : 'Close'}</button>
      <button class="next" bind:this={nextBtn} onclick={next}>{i + 1 < TOUR.length ? 'Next →' : 'Done'}</button>
    </div>
  </div>
{/if}

<style>
  .ring {
    position: fixed; z-index: 60; pointer-events: none; border-radius: 6px;
    border: 2px solid var(--photo-hi); box-shadow: 0 0 0 4px rgba(232, 166, 78, .18);
  }
  .bubble {
    position: fixed; z-index: 61; width: 300px; max-width: calc(100vw - 24px); padding: 12px 14px 10px;
    background: #0B0C0E; border: 1px solid var(--photo); border-radius: 8px; box-shadow: 0 10px 30px rgba(0, 0, 0, .6);
    color: var(--ink2); font-size: 13px; line-height: 1.45;
  }
  /* The pointer towards the target, on the side facing it. */
  .bubble.below::before, .bubble.above::before {
    content: ''; position: absolute; left: calc(var(--arrow) - 7px); width: 12px; height: 12px;
    background: #0B0C0E; border: 1px solid var(--photo); transform: rotate(45deg);
  }
  .bubble.below::before { top: -7px; border-right: 0; border-bottom: 0; }
  .bubble.above::before { bottom: -7px; border-left: 0; border-top: 0; }
  .n { font: 400 11px var(--f-mono); color: var(--muted); }
  h3 { margin: 2px 0 4px; color: var(--ink); font: 500 15px var(--f-body); }
  p { margin: 0; }
  .acts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
  button { border-radius: 999px; font: 500 12px var(--f-body); padding: 4px 12px; cursor: pointer; }
  .skip { background: none; border: 1px solid transparent; color: var(--muted); }
  .skip:hover { color: var(--ink); }
  .next { background: var(--photo-hi); border: 1px solid var(--photo-hi); color: #17130C; }
  .next:hover { background: #F2B862; }
  button:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }
</style>
