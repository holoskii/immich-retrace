<script lang="ts">
  // M-B strip under the map: density over the selection (with / without GPS, as on the overview), with the shared time cursor.
  // Drag (or ←/→, Home/End when focused) to scrub; the URL gets the cursor when the gesture ends.
  // Enter opens the lightbox at the asset nearest to the cursor.
  import type {Active} from '../selection.svelte.ts';
  import {selection, writeUrl} from '../selection.svelte.ts';
  import {densityBins, nearestRow, stepTime} from './route.ts';
  import {markScrub} from './scrub.ts';
  import {fDay, fMonthYear, fWeekday, fWhen} from './format.ts';

  let {active, offset}: {active: Active; offset: number} = $props();

  const H = 64, BARS = 40, BIN = 3;
  const DAY = 86400e3;
  // Tokens from app.css; `*Dim`: the part after the cursor (not yet played), dimmed but still lighter-for-GPS.
  const C = {gps: '#4ADBA8', gpsDim: '#1E7A5E', nogps: '#6B7079', nogpsDim: '#464B53', line: '#2A2F37', muted: '#8A9099', ink: '#E9E6DF'};

  let cv = $state<HTMLCanvasElement>();
  let width = $state(0);
  let dragging = false;

  const span = $derived(active.t1 - active.t0);
  const cursorIn = $derived(selection.cursor != null && selection.cursor >= active.t0 && selection.cursor < active.t1 ? selection.cursor : null);
  const nb = $derived(Math.max(1, Math.floor(width / BIN)));
  const bins = $derived(densityBins(active.ix, active.lo, active.hi, active.t0, active.t1, nb));

  /** Local-midnight ticks (in the selection's typical offset), or month starts for long spans. */
  function ticks(): {t: number; label: string}[] {
    const offMs = offset * 3600e3, out: {t: number; label: string}[] = [];
    const days = span / DAY;
    if (days <= 70) {
      const pxDay = width / days;
      const every = pxDay > 64 ? 1 : pxDay > 30 ? 2 : 7;
      let t = Math.ceil((active.t0 + offMs) / DAY) * DAY - offMs;
      for (let k = 0; t < active.t1; t += DAY, k++) {
        const d = new Date(t + offMs);
        const show = every === 7 ? d.getUTCDay() === 1 : k % every === 0;
        out.push({t, label: show ? (pxDay > 64 ? fWeekday(t, offset) : fDay(t, offset)) : ''});
      }
    } else {
      const d = new Date(active.t0 + offMs);
      let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
      const months = span / (30 * DAY), every = Math.max(1, Math.ceil(months / (width / 70)));
      for (;; m++) {
        if (m > 11) { y++; m = 0; }
        const t = Date.UTC(y, m, 1) - offMs;
        if (t >= active.t1) break;
        out.push({t, label: (y * 12 + m) % every === 0 ? fMonthYear(t, offset) : ''});
      }
    }
    return out;
  }

  $effect(() => {
    if (!cv || !width) return;
    const dpr = devicePixelRatio || 1;
    cv.width = Math.round(width * dpr); cv.height = Math.round(H * dpr);
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, H);
    const x = (t: number) => (t - active.t0) / span * width;
    const cx = cursorIn == null ? null : x(cursorIn);
    // The cursor's time label sits in the axis row; day labels under it are skipped.
    const MONO = '400 10px ui-monospace, Menlo, Consolas, monospace', MONO_B = '500 11px ui-monospace, Menlo, Consolas, monospace';
    let cur: {s: string; x0: number; x1: number} | null = null;
    if (cx != null) {
      ctx.font = MONO_B;
      const s = fWhen(cursorIn!, offset), tw = ctx.measureText(s).width, lx = Math.min(Math.max(cx - tw / 2, 0), width - tw);
      cur = {s, x0: lx - 8, x1: lx + tw + 8};
    }
    // Day / month grid with labels below the bars.
    ctx.font = MONO;
    for (const tk of ticks()) {
      const tx = Math.round(x(tk.t)) + .5, tw = tk.label ? ctx.measureText(tk.label).width : 0;
      const hidden = cur && tx + 4 + tw > cur.x0 && tx < cur.x1;
      ctx.fillStyle = C.line; ctx.fillRect(tx - .5, 0, 1, tk.label && !hidden ? BARS + 6 : BARS);
      if (tk.label && !hidden && tx + 4 + tw < width) { ctx.fillStyle = C.muted; ctx.fillText(tk.label, tx + 4, BARS + 15); }
    }
    // √ scale: one busy day mustn't flatten the rest.
    const {gps: photo, nogps: video} = bins;
    let max = 0;
    for (let i = 0; i < nb; i++) max = Math.max(max, photo[i] + video[i]);
    for (let i = 0; i < nb; i++) {
      const tot = photo[i] + video[i];
      if (!tot) continue;
      const h = Math.max(2, Math.sqrt(tot / max) * (BARS - 6)), hv = h * video[i] / tot, bx = i * BIN;
      const past = cx == null || bx + 1 <= cx;
      ctx.fillStyle = past ? C.gps : C.gpsDim; ctx.fillRect(bx, BARS - h, BIN - 1, h - hv);
      if (hv) { ctx.fillStyle = past ? C.nogps : C.nogpsDim; ctx.fillRect(bx, BARS - hv, BIN - 1, hv); }
    }
    ctx.fillStyle = C.line; ctx.fillRect(0, BARS, width, 1);
    if (cx != null) {
      ctx.fillStyle = C.ink; ctx.fillRect(Math.round(cx) - 1, 0, 2, BARS + 2);
      ctx.beginPath(); ctx.moveTo(cx - 5, 0); ctx.lineTo(cx + 5, 0); ctx.lineTo(cx, 6); ctx.fill();
      ctx.font = MONO_B; ctx.fillStyle = C.ink; ctx.fillText(cur!.s, cur!.x0 + 8, BARS + 15);
    }
  });

  const timeAt = (clientX: number) => {
    const r = cv!.getBoundingClientRect();
    return active.t0 + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (span - 1);
  };

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    cv!.setPointerCapture(e.pointerId);
    dragging = true;
    markScrub();
    selection.cursor = timeAt(e.clientX);
    writeUrl('live', selection.cursor);
  }
  function move(e: PointerEvent) {
    if (!dragging) return;
    markScrub();
    selection.cursor = timeAt(e.clientX);
    writeUrl('live', selection.cursor);
  }
  function up() {
    if (!dragging) return;
    dragging = false;
    writeUrl('commit', selection.cursor);
  }

  function key(e: KeyboardEvent) {
    const {ix, lo, hi} = active;
    let t: number | null = null;
    const c = cursorIn;
    if (e.key === 'Enter') {
      const r = nearestRow(ix, lo, hi, c ?? active.t0);
      if (r >= 0) { e.preventDefault(); selection.lightbox = r; }
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      t = c == null ? (hi > lo ? ix.t[dir < 0 ? hi - 1 : lo] : null) : stepTime(ix, lo, hi, c, dir);
    } else if (e.key === 'Home') t = hi > lo ? ix.t[lo] : null;
    else if (e.key === 'End') t = hi > lo ? ix.t[hi - 1] : null;
    else return;
    e.preventDefault();
    if (t == null) return;
    markScrub();
    selection.cursor = t;
    writeUrl('live', t);
  }
  function keyUp(e: KeyboardEvent) {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) writeUrl('commit', selection.cursor);
  }
</script>

<div class="strip"><div bind:clientWidth={width}>
  <canvas
    bind:this={cv}
    style:height="{H}px"
    tabindex="0"
    role="slider"
    aria-label="Time in selection: drag to scrub, arrow keys step through photos, Enter opens the nearest one"
    aria-valuemin={active.t0}
    aria-valuemax={active.t1}
    aria-valuenow={cursorIn ?? active.t0}
    aria-valuetext={cursorIn == null ? 'no time selected' : fWhen(cursorIn, offset)}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onkeydown={key}
    onkeyup={keyUp}
  ></canvas>
</div></div>

<style>
  .strip { padding: 6px 12px 2px; background: var(--surface); border-top: 1px solid var(--line); }
  canvas { display: block; width: 100%; cursor: ew-resize; touch-action: none; }
  canvas:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }
</style>
