// Labels on the phone shell (pure).

// The trip name without its dates is shared with the desktop readout: it lives with the album helpers.
export {tripName} from '../albums.ts';

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
