<script lang="ts">
  // Demo mode in the phone shell (its own chunk, like Demo.svelte on the desktop): the same landing, per-photo
  // credits in the touch lightbox, a one-time pitch line under the pill (Pitch.svelte), and About & credits (from the
  // pitch or the pill's ⋯ menu, through demoUi.about). No banner (the pill's DEMO tag, the pitch and About carry it)
  // and no coach mark (its steps point at desktop controls).
  import {onMount} from 'svelte';
  import type {DemoConfig} from '../../../../shared/demo.ts';
  import {hooks} from '../hooks.svelte.ts';
  import {landOnTrip} from './land.svelte.ts';
  import About from './About.svelte';
  import DemoCredit from './DemoCredit.svelte';
  import Pitch from './Pitch.svelte';

  /** `landed`: the landing is settled; `picked`: it opened the trip (the shell pulses Play once). */
  let {config, landing, landed}: {config: DemoConfig; landing: boolean; landed?: (picked: boolean) => void} = $props();

  landOnTrip({trip: () => config.trip, album: () => config.album ?? null, landing: () => landing, landed: p => landed?.(p)});

  onMount(() => {
    hooks.lightboxPanel = DemoCredit;
    hooks.phoneMapNote = Pitch;
    return () => { hooks.lightboxPanel = null; hooks.phoneMapNote = null; };
  });
</script>

<About repoUrl={config.repoUrl} phone />
