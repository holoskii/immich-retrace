<script lang="ts">
  // Demo mode: what this is, the code's licence, and the dataset's credits and changes (CC BY 4.0 /
  // CC BY-SA 4.0 attribution; demo/README.md lists what the hosted demo must show). `phone`: the way to the project
  // as a button at the top, and the list of data changes folded (the attribution and its link stay in view).
  import {demoUi} from './ui.svelte.ts';

  let {repoUrl, phone = false}: {repoUrl: string; phone?: boolean} = $props();
  let dlg = $state<HTMLDialogElement>();

  $effect(() => {
    if (!dlg) return;
    if (demoUi.about && !dlg.open) dlg.showModal();
    else if (!demoUi.about && dlg.open) dlg.close();
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions (Esc closes; a click on the backdrop is a convenience) -->
<dialog bind:this={dlg} aria-labelledby="about-title" onclose={() => (demoUi.about = false)}
  onclick={e => { if (e.target === dlg) dlg?.close(); }}>
  <div class="body">
    <header>
      <h2 id="about-title">About this demo</h2>
      <button class="x" onclick={() => dlg?.close()} aria-label="Close" title="Close (Esc)"><span aria-hidden="true">✕</span></button>
    </header>

    {#if phone}<a class="cta" href={repoUrl} target="_blank" rel="noopener noreferrer">Get it for your Immich →</a>{/if}
    <p><b>Retrace for Immich</b> is a companion app for <a href="https://immich.app" target="_blank" rel="noopener noreferrer">Immich</a>,
      the self-hosted photo library. It retraces where you went from the locations stored in your photos: a timeline of
      all your years, the route on a map that follows the time you scrub to, and the photos along it. Nothing but Immich
      is needed (no GPS tracker), and it only ever reads from Immich. Not affiliated with the Immich project.</p>
    <p>The code is open source under the <b>MIT licence</b>.
      {#if !phone}<a href={repoUrl} target="_blank" rel="noopener noreferrer">Get it for your Immich →</a>{/if}</p>

    <h3>The sample photos</h3>
    <p>Every photo and clip here is by <b>Kent Wang</b>, via
      <a href="https://commons.wikimedia.org/wiki/User:Kent_Wang" target="_blank" rel="noopener noreferrer">Wikimedia Commons</a>,
      under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="license noopener noreferrer">CC BY 4.0</a> or
      <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="license noopener noreferrer">CC BY-SA 4.0</a>
      (each photo's panel names its own). This doesn't imply that the author or the Wikimedia Foundation endorse this project.</p>
    {#snippet changes()}
      <ul>
        <li>photos are resized copies;</li>
        <li>GPS was removed from some trips and single shots, to show how the viewer handles photos without a location;</li>
        <li>the video clips were generated from photos (a slow pan or zoom);</li>
        <li>one shared album belongs to a fictional second user, "Alex".</li>
      </ul>
      <p>Each photo's panel says what was changed for it. The material is provided as-is, without warranties, as the licences state.</p>
    {/snippet}
    {#if phone}
      <details>
        <summary><b>The demo changed the data</b>, so don't read it as the author's real travels</summary>
        {@render changes()}
      </details>
    {:else}
      <p><b>The demo changed the data</b>, so don't read it as the author's real travels:</p>
      {@render changes()}
    {/if}
    <p class="links"><a href="/credits" target="_blank" rel="noopener">Full credits: every file, its licence and changes →</a></p>
  </div>
</dialog>

<style>
  dialog {
    width: min(620px, calc(100vw - 32px)); max-height: calc(100vh - 64px); max-height: calc(100dvh - 64px); padding: 0;
    background: #0B0C0E; color: var(--ink2); border: 1px solid var(--line); border-radius: 8px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, .6); font-size: 13px; line-height: 1.55; overflow-y: auto; overscroll-behavior: contain;
  }
  dialog::backdrop { background: rgba(6, 7, 8, .6); }
  .body { padding: 0 20px 18px; }
  /* Stays in view while the text scrolls: the way out is always reachable on a small screen. */
  header {
    position: sticky; top: 0; z-index: 1; display: flex; justify-content: space-between; align-items: center; gap: 12px;
    margin: 0 -20px 6px; padding: 8px 12px 8px 20px; background: #0B0C0E; border-bottom: 1px solid var(--line);
  }
  h2 { margin: 0; color: var(--ink); font: 500 16px var(--f-body); }
  h3 { margin: 16px 0 4px; color: var(--photo-hi); font: 500 13px var(--f-body); }
  p { margin: 0 0 8px; }
  b { color: var(--ink); font-weight: 500; }
  ul { margin: 0 0 8px; padding-left: 20px; }
  a { color: var(--photo-hi); }
  .links { margin-top: 12px; }
  .cta {
    display: flex; align-items: center; justify-content: center; min-height: 44px; margin: 10px 0 12px; border-radius: 999px;
    background: var(--photo-hi); color: #17130C; font: 500 15px var(--f-body); text-decoration: none;
  }
  details { margin: 0 0 8px; }
  summary { padding: 10px 0; cursor: pointer; color: var(--ink2); }
  details[open] summary { padding-bottom: 6px; }
  .x {
    flex: none; width: 32px; height: 32px; display: grid; place-items: center; padding: 0;
    background: var(--raised); border: 1px solid var(--line); border-radius: 6px; color: var(--ink2);
    font: 400 16px/1 var(--f-body); cursor: pointer;
  }
  .x:hover { color: var(--ink); border-color: var(--muted); }
  /* A finger's target on the phone shell. */
  :global(html.phone) .x { width: 44px; height: 44px; border-radius: 12px; font-size: 18px; }
  a:focus-visible, .x:focus-visible, summary:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }
</style>
