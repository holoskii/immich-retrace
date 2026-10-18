// The phone's time strip (pure): time ↔ x, local day ticks, stop ticks, and which stop the cursor is at.
import {clamp, DAY, HOUR} from '../albums.ts';

/** x (px) of instant t on a strip `w` px wide showing [t0, t1). */
export const xAt = (t: number, t0: number, t1: number, w: number) => (t - t0) / (t1 - t0) * w;

/** The instant at x on a strip `w` px wide showing [t0, t1), clamped inside it (t1 is exclusive). */
export const timeAt = (x: number, t0: number, t1: number, w: number) => t0 + clamp(w > 0 ? x / w : 0, 0, 1) * (t1 - t0 - 1);

/**
 * The stops' ticks: x of each stop's start, oldest first, dropping one closer than `minGap` px to the last kept
 * (a tap target can't be finer anyway). `i`: the stop's index.
 */
export function stopTicks(stops: readonly {t0: number}[], t0: number, t1: number, w: number, minGap = 6): {i: number; x: number}[] {
  const out: {i: number; x: number}[] = [];
  stops.forEach((s, i) => {
    if (s.t0 < t0 || s.t0 >= t1) return;
    const x = xAt(s.t0, t0, t1, w), last = out.at(-1);
    if (!last || x - last.x >= minGap) out.push({i, x});
  });
  return out;
}

const F_WD = new Intl.DateTimeFormat('en-GB', {timeZone: 'UTC', weekday: 'short', day: 'numeric'});
const F_DM = new Intl.DateTimeFormat('en-GB', {timeZone: 'UTC', day: 'numeric', month: 'short'});

/**
 * Local midnights in [t0, t1) (in the selection's typical offset, hours) as ticks. Every day gets a line; labels
 * ("Sat 7" when each day has `minLabel` px, else "17 Sept", which is wider, every k-th day so that each has
 * `minWide` px) never run into each other.
 */
export function dayTicks(t0: number, t1: number, offset: number, w: number, minLabel = 50, minWide = 64): {t: number; x: number; label: string}[] {
  const off = offset * HOUR, days = (t1 - t0) / DAY;
  if (!(days > 0) || !(w > 0) || days > 400) return [];
  const pxDay = w / days, every = pxDay >= minLabel ? 1 : Math.max(2, Math.ceil(minWide / pxDay));
  const out: {t: number; x: number; label: string}[] = [];
  let t = Math.ceil((t0 + off) / DAY) * DAY - off;
  for (let k = 0; t < t1; t += DAY, k++) {
    const label = k % every ? '' : (every === 1 ? F_WD : F_DM).format(t + off);
    out.push({t, x: xAt(t, t0, t1, w), label});
  }
  return out;
}

/**
 * Where cursor c is among the stops: the index of the stop it is in (`inside`), or else of the last stop before
 * it (on the way from there; -1 before the first).
 */
export function stopAt(stops: readonly {t0: number; t1: number}[], c: number): {i: number; inside: boolean} {
  let i = -1;
  for (let k = 0; k < stops.length && stops[k].t0 <= c; k++) i = k;
  return {i, inside: i >= 0 && c <= stops[i].t1};
}

/** The transport row's text: "Yesa · stop 5 / 7", "after Yesa", "before Leyre", or "" without stops. */
export function stopLabel(stops: readonly {t0: number; t1: number; place: string}[], c: number | null): string {
  if (!stops.length) return '';
  if (c == null) return `${stops.length} stop${stops.length > 1 ? 's' : ''}`;
  const {i, inside} = stopAt(stops, c);
  const name = (k: number) => stops[k].place || `stop ${k + 1}`;
  if (inside) return `${stops[i].place ? `${stops[i].place} · ` : ''}stop ${i + 1} / ${stops.length}`;
  if (i < 0) return `before ${name(0)}`;
  return `after ${name(i)}`;
}
