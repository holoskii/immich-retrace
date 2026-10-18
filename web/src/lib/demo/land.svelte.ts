// The demo landing, for either shell: once the URL (without viewer state) is applied and the albums are in, open the
// curated trip the way a click on it would, with the cursor on a representative photo mid-trip (landing.ts), Follow
// on (the map's default), nothing playing. Call during a component's init: the effect lives as long as the component.
import {untrack} from 'svelte';
import {pickAlbum} from '../actions.ts';
import {railAlbums} from '../albums.ts';
import {library} from '../index/store.svelte.ts';
import {selection} from '../selection.svelte.ts';
import {findTrip, representativeRow} from './landing.ts';

/**
 * `trip`: DEMO_TRIP (an album id or part of a name). `landing`: the page was opened without a link (no viewer state
 * in the query).
 * `landed`: runs once it is settled, `picked` whether a trip was opened (the phone shell pulses Play then).
 */
export function landOnTrip(o: {trip: () => string; landing: () => boolean; landed?: (picked: boolean) => void}) {
  let done = false;
  $effect(() => {
    if (!o.landing() || done || !selection.urlApplied || !library.albumsLoaded) return;
    done = true;
    untrack(() => {
      // Not when the visitor was quicker (even if they cleared it again).
      const a = selection.touched ? null : findTrip(railAlbums(library.albums), o.trip());
      if (a) pickAlbum(a, {history: 'replace', cursor: act => representativeRow(act.ix, act.lo, act.hi)});
      o.landed?.(!!a);
    });
  });
}
