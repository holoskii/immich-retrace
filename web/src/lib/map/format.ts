// Time labels. Times are shown in the asset's local wall time (UTC instant + offset), read with
// a UTC formatter so the browser's own time zone never leaks in.
const make = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', {timeZone: 'UTC', ...o});
const fWd = make({weekday: 'short', day: 'numeric', month: 'short'});
const fDayMonth = make({day: 'numeric', month: 'short'});
const fDayYear = make({day: 'numeric', month: 'short', year: 'numeric'});
const fMonth = make({month: 'short', year: 'numeric'});
const fHm = make({hour: '2-digit', minute: '2-digit', hour12: false});

const local = (t: number, offHours: number) => t + offHours * 3600e3;

/** "Wed 12 Aug · 14:32" */
export const fWhen = (t: number, off: number) => `${fWd.format(local(t, off))} · ${fHm.format(local(t, off))}`;
export const fWeekday = (t: number, off: number) => fWd.format(local(t, off));
export const fDay = (t: number, off: number) => fDayMonth.format(local(t, off));
export const fFullDay = (t: number, off: number) => fDayYear.format(local(t, off));
export const fMonthYear = (t: number, off: number) => fMonth.format(local(t, off));

/** "0:42" / "1:02:05" */
export function fDuration(ms: number) {
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "3 min", "2 h", "5 d" (absolute). */
export function fSpan(ms: number) {
  const a = Math.abs(ms);
  if (a < 90 * 60e3) return `${Math.max(1, Math.round(a / 60e3))} min`;
  if (a < 36 * 3600e3) return `${Math.round(a / 3600e3)} h`;
  return `${Math.round(a / 86400e3)} d`;
}
