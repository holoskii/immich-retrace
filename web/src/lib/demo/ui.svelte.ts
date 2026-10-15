// Demo UI state shared by the demo's components (Demo.svelte registers the `?` overlay buttons that set it).
class DemoUi {
  /** The tour's current step (index into TOUR), or null when it isn't showing. */
  tour = $state<number | null>(null);
  /** The About & credits panel is open. */
  about = $state(false);
}

export const demoUi = new DemoUi();
