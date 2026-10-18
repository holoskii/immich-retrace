// The Photos tab's grid layout (pure): the selection's rows in time order, cut into local calendar days, each a
// header line and rows of square cells. Positions are in CSS px from the top of the scrolled content. The grid is
// virtualised from this: only the rows near the viewport are rendered (visibleRows), and the cursor's cell can be
// scrolled to (centerOn, reveal) without touching the DOM to measure.
import {localTime, type IndexColumns} from '../index/model.ts';

const DAY = 86400e3;

/** A run of rows (lo..hi-1) on one local calendar day (`day`: its midnight, local wall time read as UTC). */
export interface Day { day: number; lo: number; hi: number }

/**
 * Rows lo..hi-1 of `ix` grouped by the local day each was taken on (its own offset: the day its time is shown in).
 * Rows are in instant order, so a day is a contiguous run; on the rare day an offset change sends local time back
 * across midnight, a day can appear as two runs (inexact only there, like the rest of the app's local days).
 */
export function groupDays(ix: IndexColumns, lo: number, hi: number): Day[] {
  const out: Day[] = [];
  for (let r = lo; r < hi; r++) {
    const d = Math.floor(localTime(ix, r) / DAY) * DAY, last = out.at(-1);
    if (last && last.day === d) last.hi = r + 1;
    else out.push({day: d, lo: r, hi: r + 1});
  }
  return out;
}

export interface GridOpts {
  /** Gap between cells, px. */
  gap: number;
  /** Day header height, px (also what the sticky header covers at the top of the viewport). */
  head: number;
  /** Space under the last row, px. */
  pad: number;
}
export const GRID: GridOpts = {gap: 2, head: 36, pad: 12};

/** Columns for a content width: 3 on a phone held upright, more in landscape (cells stay ~120–150 px). */
export const gridColumns = (width: number) => Math.max(3, Math.min(7, Math.floor(width / 128)));

export interface DayBlock extends Day {
  /** Top of the day's block (its header), px. */
  y: number;
  /** Header + rows, px. */
  h: number;
  /** Its grid rows: r0..r1-1 (indexes into Layout.rowY / rowLo). */
  r0: number; r1: number;
}

export interface Layout {
  cols: number;
  /** Cell side, px (cells are square). */
  cell: number;
  gap: number;
  head: number;
  /** Content height, px. */
  height: number;
  days: DayBlock[];
  /** Per grid row: its top (px), its first asset row, its day (index into days). */
  rowY: Float64Array; rowLo: Int32Array; rowDay: Int32Array;
}

/** Lays `days` out in a content box `width` px wide. */
export function layoutGrid(days: Day[], width: number, o: GridOpts = GRID): Layout {
  const cols = gridColumns(width), cell = Math.max(1, (width - (cols - 1) * o.gap) / cols), step = cell + o.gap;
  let n = 0;
  for (const d of days) n += Math.ceil((d.hi - d.lo) / cols);
  const rowY = new Float64Array(n), rowLo = new Int32Array(n), rowDay = new Int32Array(n), blocks: DayBlock[] = [];
  let y = 0, i = 0;
  days.forEach((d, k) => {
    const rows = Math.ceil((d.hi - d.lo) / cols), r0 = i;
    for (let j = 0; j < rows; j++, i++) { rowY[i] = y + o.head + j * step; rowLo[i] = d.lo + j * cols; rowDay[i] = k; }
    const h = o.head + rows * step;
    blocks.push({...d, y, h, r0, r1: i});
    y += h;
  });
  return {cols, cell, gap: o.gap, head: o.head, height: Math.ceil(y + o.pad), days: blocks, rowY, rowLo, rowDay};
}

/** First grid row whose bottom is below `y`. */
function firstBelow(L: Layout, y: number) {
  let lo = 0, hi = L.rowY.length;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (L.rowY[m] + L.cell <= y) lo = m + 1; else hi = m; }
  return lo;
}

/** Grid rows [a, b) that overlap y0..y1 (px). */
export function visibleRows(L: Layout, y0: number, y1: number): [number, number] {
  const a = firstBelow(L, y0);
  let b = a;
  while (b < L.rowY.length && L.rowY[b] < y1) b++;
  return [a, b];
}

/** The grid row holding asset row `r` (assumed inside the laid-out days), or -1. */
export function rowOf(L: Layout, r: number) {
  let lo = 0, hi = L.rowLo.length;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (L.rowLo[m] <= r) lo = m + 1; else hi = m; }
  const i = lo - 1;
  if (i < 0) return -1;
  const d = L.days[L.rowDay[i]];
  return r < d.hi && r - L.rowLo[i] < L.cols ? i : -1;
}

const clampTop = (L: Layout, y: number, viewH: number) => Math.max(0, Math.min(Math.round(y), Math.max(0, L.height - viewH)));

/**
 * The scroll offset that puts asset row `r`'s cell in the middle of what the sticky day header leaves visible
 * (clamped to the content); 0 when `r` isn't laid out.
 */
export function centerOn(L: Layout, r: number, viewH: number) {
  const i = rowOf(L, r);
  if (i < 0) return 0;
  return clampTop(L, L.rowY[i] + L.cell / 2 - (L.head + (viewH - L.head) / 2), viewH);
}

/**
 * The scroll offset that brings asset row `r`'s cell wholly into view (below the sticky header) from `top`, moving as
 * little as possible: `top` itself when it already is.
 */
export function reveal(L: Layout, r: number, top: number, viewH: number) {
  const i = rowOf(L, r);
  if (i < 0) return top;
  const y = L.rowY[i];
  if (y >= top + L.head && y + L.cell <= top + viewH) return top;
  return clampTop(L, y < top + L.head ? y - L.head - L.gap : y + L.cell + L.gap - viewH, viewH);
}

/**
 * The grid rows whose thumbnails to ask for, in the order to ask: the on-screen rows va..vb-1 first, then the other
 * rendered rows ra..rb-1 nearest first (below before above).
 */
export function requestRows(va: number, vb: number, ra: number, rb: number): number[] {
  const out: number[] = [];
  for (let i = va; i < vb; i++) out.push(i);
  for (let k = 1; va - k >= ra || vb - 1 + k < rb; k++) {
    if (vb - 1 + k < rb) out.push(vb - 1 + k);
    if (va - k >= ra) out.push(va - k);
  }
  return out;
}
