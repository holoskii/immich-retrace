// The phone shell's tabs (pure). The tab is not in the URL: it follows from the state, so links stay the desktop
// contract. A selection is shown on Map; with none there is nothing to show there or in Photos, so Trips.
export type Tab = 'map' | 'photos' | 'trips';

export const TABS: readonly {id: Tab; label: string}[] = [
  {id: 'map', label: 'Map'},
  {id: 'photos', label: 'Photos'},
  {id: 'trips', label: 'Trips'},
];

/**
 * The tab after the selection changed (a trip card, Back/Forward, a link applied): Trips when nothing is selected;
 * from Trips to Map when something is (a pick ends on the map); otherwise it stays (Photos is a lens on the same
 * selection).
 */
export function tabForSelection(tab: Tab, selected: boolean): Tab {
  if (!selected) return 'trips';
  return tab === 'trips' ? 'map' : tab;
}

/** The map is out of sight: another tab, or the lightbox over it. Play stops and the camera rests then. */
export const mapCovered = (tab: Tab, lightboxOpen: boolean) => tab !== 'map' || lightboxOpen;
