// Extension points for optional add-ons that load at runtime (today: the demo, web/src/lib/demo/, only
// when the server runs with DEMO=1). On a normal deployment nothing sets them and the app is unchanged.
import type {Component} from 'svelte';

export interface HelpAction { label: string; run: () => void }

class Hooks {
  /** Extra buttons at the top of the `?` overlay; it closes before running one. */
  helpActions = $state.raw<HelpAction[]>([]);
  /**
   * Extra content in the lightbox panel, under the position strip (e.g. per-photo credits). `compact`: the touch
   * lightbox's bottom bar, a line or two over the photo.
   */
  lightboxPanel = $state.raw<Component<{id: string; video: boolean; compact?: boolean}> | null>(null);
  /**
   * The phone shell's note over the map, under the pill (the demo's pitch line). `top`: the pill's bottom edge (px in
   * the map's box); `height`: reports its own height (0 once gone), which the camera keeps clear.
   */
  phoneMapNote = $state.raw<Component<{top: number; height: (h: number) => void}> | null>(null);
  /** The album picker's button text in place of "Albums", shown emphasised. */
  albumPickerLabel = $state<string | null>(null);
}

export const hooks = new Hooks();
