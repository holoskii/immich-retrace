// Play and the demo landing, as the map's camera sees them (tiny: the phone's eager path imports it).
import type {Selection} from '../selection.svelte.ts';

/** Whether Play is running, from either shell's control (TimeStrip, the phone's Dock): the map hands the landing's
 *  Fit over to Follow on the first ▶, and the phone demo's pitch line goes. */
export const playState = $state({on: false});

/**
 * The selection the demo landing opened (land.svelte.ts): the map frames it whole (Fit, camNext `land`) until the
 * first ▶ or scrub turns Follow on. Not reactive: the map reads it when it takes a new selection, and clears it then
 * (once: the same selection applied again, or the landing's entry come back to, is not a landing).
 */
export const landing: {sel: Selection | null} = {sel: null};

/**
 * The desktop map has shown a selection fully once: idle, its tiles loaded (MapView). The demo's coach mark waits for
 * it, so it never explains a blank map. Set once per page.
 */
export const mapShown = $state({on: false});
