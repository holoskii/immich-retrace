// The demo landing, for either shell: once the URL (without viewer state) is applied and the albums are in, open the
// curated trip the way a click on it would (its members prefetched at t0 when the config named its album, main.ts: no
// wait for the library index), framed whole (Fit: the route tells where the trip went), nothing playing.
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
 * `trip`: DEMO_TRIP (an album id or part of a name); `album`: the id the server resolved it to (null: resolve `trip`
 * here). `landing`: the page was opened without a link (no viewer state in the query).
 * `landed`: runs once it is settled, `picked` whether a trip was opened (the phone shell pulses Play then).
 */
export function landOnTrip(o: {trip: () => string; album: () => string | null; landing: () => boolean; landed?: (picked: boolean) => void}) {
  let done = false;
  $effect(() => {
    if (!o.landing()) return;
    // The album's days need local offsets: the prefetched members' (main.ts) or else the index's, whichever comes
    // first. Without either (the prefetch failed or wasn't made, and the index failed) it settles without a trip:
    // days converted without offsets would be wrong, and the visitor can still pick one.
    const offsets = library.offsets;
    if (done || !selection.urlApplied || !library.albumsLoaded || (!offsets && library.status !== 'error')) return;
    done = true;
    untrack(() => {
      // Not when the visitor was quicker (even if they cleared it again).
      const list = railAlbums(library.albums), id = o.album();
      const a = selection.touched || !offsets ? null : (id ? list.find(x => x.id === id) : undefined) ?? findTrip(list, o.trip());
      if (a) {
        pickAlbum(a, {history: 'replace', cursor: act => landingRow(act.ix, act.lo, act.hi)});
        camLanding.sel = selection.sel;
      }
      selection.awaitingLanding = false;
      o.landed?.(!!a);
    });
  });
}
