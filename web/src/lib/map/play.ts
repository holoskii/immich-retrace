// Play: the time cursor steps from photo to photo through the selection, and the map (Follow) flies
// along. Started from the button by the time strip or with Space; never on its own. The timing is
// here (pure, planned once per selection); TimeStrip.svelte and the phone's Dock run the timer.
import type {IndexColumns} from '../index/model.ts';
import {haversineKm, stepRow} from './route.ts';
import {findStops, type Stop} from './stops.ts';

export const PLAY = {
  /**
   * Unscaled dwell on a photo before the next one (ms), by the kind of step to it: within a stop (a place the
   * traveller stayed at, stops.ts) or a burst (within `burstGap`), an ordinary step between places, and a
   * pause before a flight (the next photo is `flightKm` or more away: the camera travels).
   */
  burstMs: 350, photoMs: 900, flightMs: 1800,
  burstGap: 90e3, flightKm: 5,
  /** A whole run is scaled to last about this long... */
  targetMs: 45_000,
  /** ...but no dwell goes under these floors (a 5 000-photo year then plays every photo at the floor). */
  minBurstMs: 150, minPhotoMs: 400, minFlightMs: 1200,
  /**
   * prefers-reduced-motion: the camera jumps instead of flying; no photo flickers by faster than `reducedMinMs`,
   * and a jump to another place holds `reducedMs` (the new place takes a moment to read without the flight).
   */
  reducedMinMs: 800, reducedMs: 2500,
};

export type StepKind = 'burst' | 'photo' | 'flight';

/** The kind of step from row a to row b (b after a): see PLAY. `stopOf`: each row's stop index or -1 (from lo). */
function kindOf(ix: IndexColumns, a: number, b: number, stopOf: Int32Array, lo: number, gpsAt: Int32Array): StepKind {
  const sa = stopOf[a - lo], sb = stopOf[b - lo];
  if (sa >= 0 && sa === sb) return 'burst';
  const pa = gpsAt[a - lo], pb = gpsAt[b - lo];
  if (pa >= 0 && pb >= 0 && pa !== pb && haversineKm(ix.lat[pa], ix.lon[pa], ix.lat[pb], ix.lon[pb]) >= PLAY.flightKm) return 'flight';
  return ix.t[b] - ix.t[a] <= PLAY.burstGap ? 'burst' : 'photo';
}

const BASE: Record<StepKind, number> = {burst: PLAY.burstMs, photo: PLAY.photoMs, flight: PLAY.flightMs};
const FLOOR: Record<StepKind, number> = {burst: PLAY.minBurstMs, photo: PLAY.minPhotoMs, flight: PLAY.minFlightMs};

/**
 * The scale k (≤ 1) that makes Σ max(floor, base·k) over `counts` come to `target`, or 1 when the unscaled run is
 * already that short; when even the floors exceed it, any k that puts every step at its floor (0).
 */
export function playScale(counts: Record<StepKind, number>, target = PLAY.targetMs) {
  const total = (k: number) => (Object.keys(BASE) as StepKind[]).reduce((s, x) => s + counts[x] * Math.max(FLOOR[x], BASE[x] * k), 0);
  if (total(1) <= target) return 1;
  if (total(0) >= target) return 0;
  let a = 0, b = 1;
  for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (total(m) > target) b = m; else a = m; }
  return a;
}

/**
 * Play's timing for rows lo..hi-1 (a selection): `dwell[r - lo]` is how long row r stays before Play steps to r + 1
 * (stepRow visits every row in order), `kind[r - lo]` that step's kind; the last row has none. The run is scaled
 * (playScale) to last about PLAY.targetMs (`totalMs`), never below the floors.
 */
export interface PlayPlan { lo: number; hi: number; dwell: Float32Array; kind: StepKind[]; totalMs: number }

export function playPlan(ix: IndexColumns, lo: number, hi: number, stops: readonly Stop[]): PlayPlan {
  const n = Math.max(0, hi - lo);
  const stopOf = new Int32Array(n).fill(-1);
  stops.forEach((s, k) => { for (let r = Math.max(lo, s.lo); r < Math.min(hi, s.hi); r++) stopOf[r - lo] = k; });
  // Each row's position: its own fix, else the last one before it (the first one after, before any).
  const gpsAt = new Int32Array(n).fill(-1);
  let last = -1;
  for (let r = lo; r < hi; r++) { if (ix.gps[r]) last = r; gpsAt[r - lo] = last; }
  let next = -1;
  for (let r = hi - 1; r >= lo; r--) { if (ix.gps[r]) next = r; if (gpsAt[r - lo] < 0) gpsAt[r - lo] = next; }

  const kind: StepKind[] = [], counts: Record<StepKind, number> = {burst: 0, photo: 0, flight: 0};
  for (let r = lo; r < hi - 1; r++) { const k = kindOf(ix, r, r + 1, stopOf, lo, gpsAt); kind.push(k); counts[k]++; }
  const scale = playScale(counts);
  const dwell = new Float32Array(n);
  let totalMs = 0;
  kind.forEach((k, i) => { totalMs += dwell[i] = Math.max(FLOOR[k], BASE[k] * scale); });
  return {lo, hi, dwell, kind, totalMs};
}

/** playPlan for rows lo..hi-1 with their stops, kept per index and range (the shells and the landing share one). */
const plans = new WeakMap<IndexColumns, Map<string, PlayPlan>>();
export function planFor(ix: IndexColumns, lo: number, hi: number): PlayPlan {
  let m = plans.get(ix);
  if (!m) plans.set(ix, m = new Map());
  const k = `${lo}:${hi}`;
  let p = m.get(k);
  if (!p) {
    if (m.size >= 8) m.clear();
    m.set(k, p = playPlan(ix, lo, hi, findStops(ix, lo, hi)));
  }
  return p;
}

/**
 * The photos worth fetching ahead while Play is on row r (the card's prefetch, within the demo's background share):
 * those Play reaches between `lead` and `horizon` ms from now (sooner ones wouldn't arrive in time on a slow
 * network), the ones it lingers on longest first (the pause before a flight, an ordinary step: a burst photo is gone
 * in a moment; the last photo stays), at most `n`; the photo at the cursor first when it stays at least `lead`.
 * Timed as Play runs them (`reduced`: reducedDwell).
 */
export function playAhead(p: PlayPlan, r: number, reduced = false, {lead = 400, horizon = 2500, n = 3} = {}): number[] {
  const dwell = (k: number) => (k >= p.hi - 1 ? PLAY.flightMs : reducedDwell(p.dwell[k - p.lo], p.kind[k - p.lo], reduced));
  const out: {k: number; d: number}[] = [];
  let t = dwell(r);
  for (let k = r + 1; k < p.hi && t <= horizon; k++) {
    if (t >= lead) out.push({k, d: dwell(k)});
    t += dwell(k);
  }
  out.sort((a, b) => b.d - a.d || a.k - b.k);
  const rows = out.slice(0, n).map(x => x.k);
  return r < p.hi - 1 && dwell(r) >= lead ? [r, ...rows] : rows;
}

/** A planned dwell with prefers-reduced-motion applied (see PLAY.reducedMinMs). */
export const reducedDwell = (d: number, k: StepKind | undefined, reduced: boolean) =>
  !reduced ? d : k === 'flight' ? PLAY.reducedMs : Math.max(d, PLAY.reducedMinMs);

/**
 * How long the photo at the cursor stays before the next one, or null when nothing comes after it. Between photos
 * (a cursor that isn't on one), the wait for the next photo is the step into it, at least an ordinary one's floor.
 */
export function playDwell(p: PlayPlan, ix: IndexColumns, c: number, cur: number, reduced = false): number | null {
  const r = stepRow(ix, p.lo, p.hi, c, cur, 1);
  if (r < 0) return null;
  const on = cur >= p.lo && cur < p.hi && ix.t[cur] === c && r === cur + 1;
  const i = on ? cur - p.lo : r - 1 - p.lo, k = p.kind[i];
  return reducedDwell(on ? p.dwell[i] : Math.max(PLAY.minPhotoMs, p.dwell[i] || 0), k, reduced);
}

/**
 * Where Play starts in rows lo..hi-1: the row to put the cursor on first, the first one when there is no cursor
 * or nothing comes after it (`cur`: the row it is on, see cursorRow) and Play starts again; -1 to go on from the
 * cursor; null for an empty range.
 */
export function playStart(ix: IndexColumns, lo: number, hi: number, cursor: number | null, cur: number): number | null {
  if (hi <= lo) return null;
  return cursor == null || stepRow(ix, lo, hi, cursor, cur, 1) < 0 ? lo : -1;
}

/**
 * The demo landing's photo: the one Play's first flight leaves from, so the first ▶ shows the camera travelling
 * within a few seconds. Among the last `near` photos up to the first flight (none before an earlier one), the latest
 * landscape one with GPS (the card's photo is the page's LCP on the phone); else the photo the flight leaves from.
 * -1 when there is no flight (one place): the caller keeps its own choice.
 */
export function flightStartRow(ix: IndexColumns, p: PlayPlan, near = 6): number {
  const i = p.kind.indexOf('flight');
  if (i < 0) return -1;
  const r = p.lo + i;
  for (let k = r; k > r - near && k >= p.lo; k--) {
    if (k < r && p.kind[k - p.lo] === 'flight') break;
    if (ix.gps[k] && !ix.video[k] && ix.ratio[k] > 1.2) return k;
  }
  return r;
}

/** Whether a Space keydown toggles Play: not typed into a field, not on a control Space activates, no modifiers. */
export function isPlayKey(e: {key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; defaultPrevented: boolean; repeat?: boolean; target: EventTarget | null}) {
  if (e.key !== ' ' || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented || e.repeat) return false;
  const t = e.target as {closest?: (s: string) => unknown} | null;
  return !t?.closest?.('input, textarea, select, button, a, video, summary, dialog, [contenteditable], [role="button"], [role="menuitem"], [role="option"]');
}
