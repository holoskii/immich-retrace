<script lang="ts">
  // The phone's time strip: the selection's photos per time bin (with / without GPS, as on the desktop strip), local
  // day lines and labels, ▾ ticks where stops start (stops.ts), and the cursor. A touch on it jumps the cursor there;
  // dragging scrubs (the camera flies along). `at` is only ever replaced (replaceState, throttled): a flick of the
  // strip must not become a Back step. The dock keeps it ≥ 24 px off the screen sides (the OS back swipe).
  import {selection, writeUrl, type Active} from '../selection.svelte.ts';
  import {cursorRow, densityBins, stepRow} from '../map/route.ts';
  import {markScrub} from '../map/scrub.ts';
  import {fWhen} from '../map/format.ts';
  import type {Stop} from '../map/stops.ts';
  import {stepStop} from '../map/stops.ts';
  import {dayTicks, stopTicks, timeAt, xAt} from './strip.ts';

  /** `onscrub`: the strip is taking the cursor over (the dock stops Play). */
  let {active, offset, stops, onscrub}: {active: Active; offset: number; stops: Stop[]; onscrub?: () => void} = $props();

  const H = 50, BARS = 32, BIN = 3;
  const C = {gps: '#4ADBA8', gpsDim: '#1E7A5E', nogps: '#6B7079', nogpsDim: '#464B53', line: '#2A2F37', muted: '#8A9099', ink: '#E9E6DF', stop: '#E8A64E'};
  /** Screen sides left to the OS's back / forward swipe. */
  const EDGE = 24;

  let cv = $state<HTMLCanvasElement>();
  let width = $state(0);
  let drag: number | null = null;

  const cursorIn = $derived(selection.cursor != null && selection.cursor >= active.t0 && selection.cursor < active.t1 ? selection.cursor : null);
  const nb = $derived(Math.max(1, Math.floor(width / BIN)));
  const bins = $derived(densityBins(active.ix, active.lo, active.hi, active.t0, active.t1, nb));
  const days = $derived(dayTicks(active.t0, active.t1, offset, width));
  const ticks = $derived(stopTicks(stops, active.t0, active.t1, width));

  $effect(() => {
    if (!cv || !width) return;
    const dpr = Math.min(devicePixelRatio || 1, 3), w = width;
    cv.width = Math.round(w * dpr); cv.height = Math.round(H * dpr);
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, H);
    const cx = cursorIn == null ? null : xAt(cursorIn, active.t0, active.t1, w);
    ctx.font = '400 11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'alphabetic';
    // A label that would touch the previous one (a wide font) is left out; its day line stays.
    let lastEnd = -Infinity;
    for (const d of days) {
      const x = Math.round(d.x) + .5, end = d.label ? x + 3 + ctx.measureText(d.label).width : x;
      const show = !!d.label && end < w && x + 3 >= lastEnd + 8;
      ctx.fillStyle = C.line; ctx.fillRect(x - .5, 6, 1, show ? BARS : BARS - 6);
      if (show) { ctx.fillStyle = C.muted; ctx.fillText(d.label, x + 3, BARS + 15); lastEnd = end; }
    }
    let max = 0;
    for (let i = 0; i < nb; i++) max = Math.max(max, bins.gps[i] + bins.nogps[i]);
    for (let i = 0; i < nb; i++) {
      const tot = bins.gps[i] + bins.nogps[i];
      if (!tot) continue;
      const h = Math.max(2, Math.sqrt(tot / max) * (BARS - 10)), hv = h * bins.nogps[i] / tot, bx = i * BIN;
      const past = cx == null || bx + 1 <= cx;
      ctx.fillStyle = past ? C.gps : C.gpsDim; ctx.fillRect(bx, BARS - h, BIN - 1, h - hv);
      if (hv) { ctx.fillStyle = past ? C.nogps : C.nogpsDim; ctx.fillRect(bx, BARS - hv, BIN - 1, hv); }
    }
    ctx.fillStyle = C.line; ctx.fillRect(0, BARS, w, 1);
    // ▾ where each stop starts.
    ctx.fillStyle = C.stop;
    for (const t of ticks) { ctx.beginPath(); ctx.moveTo(t.x - 4, 0); ctx.lineTo(t.x + 4, 0); ctx.lineTo(t.x, 6); ctx.fill(); }
    if (cx != null) {
      ctx.fillStyle = C.ink; ctx.fillRect(Math.round(cx) - 1, 2, 2, BARS);
      ctx.beginPath(); ctx.arc(cx, BARS + 1, 5, 0, Math.PI * 2); ctx.fill();
    }
  });

  // Throttled: Safari throws after ~100 history calls per 30 s. The last position is written when the finger lifts.
  let lastUrl = 0;
  function url(force = false) {
    const now = Date.now();
    if (!force && now - lastUrl < 400) return;
    lastUrl = now;
    writeUrl('replace', selection.cursor);
  }
  const tAt = (clientX: number) => {
    const r = cv!.getBoundingClientRect();
    return timeAt(clientX - r.left, active.t0, active.t1, r.width);
  };

  function down(e: PointerEvent) {
    if (e.button !== 0 || drag != null) return;
    if (e.clientX < EDGE || e.clientX > innerWidth - EDGE) return;
    onscrub?.();
    try { cv!.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    drag = e.pointerId;
    // A tap jumps (a seek: far jumps snap the camera); moving on from here scrubs.
    selection.cursor = tAt(e.clientX);
    url(true);
  }
  function move(e: PointerEvent) {
    if (drag !== e.pointerId) return;
    markScrub(); // the follow camera flies along
    selection.cursor = tAt(e.clientX);
    url();
  }
  function up(e: PointerEvent) {
    if (drag !== e.pointerId) return;
    drag = null;
    url(true);
  }

  const rowAt = (c: number) => cursorRow(active.ix, active.lo, active.hi, c, selection.pickIn(active));
  /** Arrow keys step a photo, Page Up / Down a stop, Home / End the ends. */
  function key(e: KeyboardEvent) {
    const {ix, lo, hi} = active, c = cursorIn;
    let r = -1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      r = c == null ? (hi > lo ? (dir < 0 ? hi - 1 : lo) : -1) : stepRow(ix, lo, hi, c, rowAt(c), dir);
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      const i = stepStop(stops, c ?? active.t0 - 1, e.key === 'PageUp' ? -1 : 1);
      r = i >= 0 ? stops[i].lo : -1;
    } else if (e.key === 'Home') r = hi > lo ? lo : -1;
    else if (e.key === 'End') r = hi > lo ? hi - 1 : -1;
    else return;
    e.preventDefault();
    onscrub?.();
    if (r < 0) return;
    selection.cursorTo(ix, r);
    url(true);
  }

  const valueText = $derived.by(() => {
    if (cursorIn == null) return 'no time selected';
    const r = rowAt(cursorIn);
    return r >= 0 ? `${fWhen(cursorIn, offset)}, photo ${r - active.lo + 1} of ${active.hi - active.lo}` : fWhen(cursorIn, offset);
  });
</script>

<div class="strip" bind:clientWidth={width}>
  <canvas bind:this={cv} style:height="{H}px" tabindex="0" role="slider"
    aria-label="Time in this trip: drag to move through it, tap to jump"
    aria-valuemin={active.t0} aria-valuemax={active.t1} aria-valuenow={cursorIn ?? active.t0} aria-valuetext={valueText}
    onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onkeydown={key}></canvas>
</div>

<style>
  .strip { min-width: 0; }
  canvas { display: block; width: 100%; touch-action: none; -webkit-tap-highlight-color: transparent; }
  canvas:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }
</style>
