// Labels on the phone shell (pure).
import {albumLabel} from '../albums.ts';

/**
 * A trip's name without the dates its album name may end with ("San Sebastián to Huesca, 6–10 Sep 2024" →
 * "San Sebastián to Huesca"): the pill and the card show the dates on their own line. The folder prefix goes too.
 */
export function tripName(name: string) {
  const n = albumLabel(name), m = /^(.*\S)\s*,\s*[^,]*\b\d{4}\s*$/.exec(n);
  return m && /\d/.test(n.slice(m[1].length)) ? m[1] : n;
}

const F = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', {timeZone: 'UTC', ...o});
const D = F({day: 'numeric'}), DM = F({day: 'numeric', month: 'short'}), DMY = F({day: 'numeric', month: 'short', year: 'numeric'});

/**
 * Local days a..b (midnights read as UTC, b inclusive): "6–10 Sept 2024", "30 Aug – 2 Sept 2024",
 * "30 Dec 2024 – 2 Jan 2025", "6 Sept 2024".
 */
export function fDayRange(a: number, b: number) {
  const da = new Date(a), db = new Date(b);
  const sameY = da.getUTCFullYear() === db.getUTCFullYear(), sameM = sameY && da.getUTCMonth() === db.getUTCMonth();
  if (sameM && da.getUTCDate() === db.getUTCDate()) return DMY.format(a);
  if (sameM) return `${D.format(a)}–${DMY.format(b)}`;
  return `${(sameY ? DM : DMY).format(a)} – ${DMY.format(b)}`;
}
