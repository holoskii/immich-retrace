<script lang="ts">
  // The `?` button and the shortcut overlay it opens (also the `?` key anywhere outside a text field).
  // A native modal <dialog>: it traps focus, Esc closes it, and focus returns to where it was.
  import {selection} from './selection.svelte.ts';
  import {isHelpKey, keyParts, SHORTCUTS} from './shortcuts.ts';
  import {hooks} from './hooks.svelte.ts';

  let dlg = $state<HTMLDialogElement>();

  function toggle() {
    if (!dlg) return;
    if (dlg.open) dlg.close(); else dlg.showModal();
  }

  function onKey(e: KeyboardEvent) {
    // The lightbox has its own keys and focus trap; a dialog on top of it would fight both.
    if (!isHelpKey(e) || (selection.lightbox != null && !dlg?.open)) return;
    e.preventDefault();
    toggle();
  }
</script>

<svelte:window onkeydown={onKey} />
<button class="q" onclick={toggle} title="Keyboard and mouse shortcuts (?)" aria-label="Shortcuts" aria-haspopup="dialog">?</button>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions (Esc closes; a click on the backdrop is a convenience) -->
<dialog bind:this={dlg} aria-labelledby="help-title" onclick={e => { if (e.target === dlg) dlg?.close(); }}>
  <div class="body">
    <header>
      <h2 id="help-title">Shortcuts</h2>
      <button class="x" onclick={() => dlg?.close()} aria-label="Close">Esc</button>
    </header>
    {#if hooks.helpActions.length}
      <div class="extra">
        {#each hooks.helpActions as act (act.label)}
          <button onclick={() => { dlg?.close(); act.run(); }}>{act.label}</button>
        {/each}
      </div>
    {/if}
    <div class="groups">
      {#each SHORTCUTS as g (g.title)}
        <section>
          <h3>{g.title}{#if g.where}<span>{` · ${g.where}`}</span>{/if}</h3>
          <dl>
            {#each g.items as s (s.what)}
              <dt>
                {#each s.keys as k, i (k)}
                  {@const {mouse, parts} = keyParts(k)}
                  {#if i}<span class="or">{mouse || keyParts(s.keys[i - 1]).mouse ? 'or' : '/'}</span>{/if}
                  {#if mouse}<span class="mouse">{k}</span>
                  {:else}{#each parts as p, j (j)}{#if j}<span class="plus">+</span>{/if}<kbd>{p}</kbd>{/each}{/if}
                {/each}
              </dt>
              <dd>{s.what}</dd>
            {/each}
          </dl>
        </section>
      {/each}
    </div>
  </div>
</dialog>

<style>
  .q {
    width: 24px; height: 24px; border-radius: 50%; padding: 0; cursor: pointer;
    background: var(--raised); border: 1px solid var(--line); color: var(--ink2); font: 600 12px var(--f-body);
  }
  .q:hover { color: var(--ink); border-color: var(--muted); }
  .q:focus-visible, .x:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }

  dialog {
    width: min(860px, calc(100vw - 32px)); max-height: calc(100vh - 64px); padding: 0;
    background: #0B0C0E; color: var(--ink2); border: 1px solid var(--line); border-radius: 8px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, .6); font-size: 12px;
  }
  dialog::backdrop { background: rgba(6, 7, 8, .6); }
  .body { padding: 14px 18px 16px; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
  h2 { margin: 0; color: var(--ink); font: 500 15px var(--f-body); }
  .x {
    background: var(--raised); border: 1px solid var(--line); border-radius: 4px; color: var(--ink2);
    font: 500 11px var(--f-mono); padding: 2px 8px; cursor: pointer;
  }
  .extra { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
  .extra button {
    background: var(--raised); border: 1px solid var(--photo); border-radius: 999px; color: var(--ink);
    font: 500 12px var(--f-body); padding: 3px 12px; cursor: pointer;
  }
  .extra button:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }
  .groups { columns: 2 340px; column-gap: 28px; }
  section { break-inside: avoid; margin-bottom: 14px; }
  h3 { margin: 0 0 5px; color: var(--photo-hi); font: 500 12px var(--f-body); }
  h3 span { color: var(--muted); font-weight: 400; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 3px 12px; margin: 0; }
  dt { color: var(--ink); white-space: nowrap; }
  dd { margin: 0; }
  kbd {
    display: inline-block; min-width: 18px; text-align: center; padding: 0 5px; border-radius: 3px;
    background: var(--raised); border: 1px solid var(--line); border-bottom-width: 2px;
    font: 400 11px/1.5 var(--f-mono); color: var(--ink);
  }
  .plus { color: var(--muted); padding: 0 2px; }
  .or { color: var(--muted); padding: 0 2px; }
  .mouse { color: var(--ink); }
</style>
