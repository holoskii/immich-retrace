// The demo landing, for either shell: once the URL (without viewer state) is applied and the albums are in, open the
// curated trip the way a click on it would, framed whole (Fit: the route tells where the trip went), nothing playing.
// The cursor goes on the photo Play's first flight leaves from (play.ts flightStartRow; a representative photo when
// the trip is one place), so the first ▶ turns Follow on, flies in and travels on within a couple of seconds.
// Call during a component's init: the effect lives as long as the component.
import {untrack} from 'svelte';
import {pickAlbum} from '../actions.ts';
import {railAlbums} from '../albums.ts';
import {library} from '../index/store.svelte.ts';
import {selection} from '../selection.svelte.ts';
import {landing as camLanding} from '../map/playing.svelte.ts';
import {findTrip, landingRow} from './landing.ts';

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
      if (a) {
        pickAlbum(a, {history: 'replace', cursor: act => landingRow(act.ix, act.lo, act.hi)});
        camLanding.sel = selection.sel;
      }
      o.landed?.(!!a);
    });
  });
}
