<script lang="ts">
  // Album chooser: a popup with search, trips/all filter and keyboard navigation (↑/↓, Enter, Esc).
  import type {AlbumSummary} from '../../../../shared/api.ts';
  import {albumLabel, DAY, fDay, fNum, railAlbums, TRIP_DAYS, type RailAlbum} from './data.ts';

  /** `error`: why the album list couldn't be (re)loaded; `loaded`: the list is final (not still on its way). */
  let {albums, current, onpick, error = null, loaded = true}: {
    albums: AlbumSummary[]; current: string | null; onpick: (a: RailAlbum) => void; error?: string | null; loaded?: boolean;
  } = $props();

  /** The picker's own filter: the rail under the timeline always shows trips. */
  let showAll = $state(false);

  let open = $state(false);
  let q = $state('');
  let hi = $state(0);
  let root = $state<HTMLDivElement>();
  let input = $state<HTMLInputElement>();
  let list = $state<HTMLUListElement>();
  let btn = $state<HTMLButtonElement>();

  /** Newest first; the search matches the name (with or without the folder prefix) and the year. */
  const items = $derived.by(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return railAlbums(albums, showAll)
      .filter(a => words.every(w => a.name.toLowerCase().includes(w) || String(new Date(a.start).getUTCFullYear()).startsWith(w)))
      .reverse();
  });

  function toggle() {
    open = !open;
    if (!open) return;
    q = '';
    hi = Math.max(0, items.findIndex(a => a.id === current));
    queueMicrotask(() => { input?.focus(); scrollToHi(); });
  }
  /** Closes the popup; focus goes back to the button (the input it was in is gone). */
  function close() { open = false; btn?.focus(); }
  function pick(a: RailAlbum) { close(); onpick(a); }
  function scrollToHi() { list?.children[hi]?.scrollIntoView({block: 'nearest'}); }

  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      hi = Math.max(0, Math.min(items.length - 1, hi + (e.key === 'ArrowDown' ? 1 : -1)));
      queueMicrotask(scrollToHi);
    } else if (e.key === 'Enter' && items[hi]) { e.preventDefault(); pick(items[hi]); }
  }
  function setAll(v: boolean) {
    showAll = v; hi = 0;
    input?.focus();
  }

  $effect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (root && !root.contains(e.target as Node)) open = false; };
    addEventListener('pointerdown', away, true);
    return () => removeEventListener('pointerdown', away, true);
  });

  const days = (a: RailAlbum) => Math.round((a.end - a.start) / DAY) + 1;
</script>

<div class="picker" bind:this={root}>
  <button class="btn" bind:this={btn} aria-haspopup="dialog" aria-expanded={open} onclick={toggle} title="Choose an album">Albums ▾</button>
  {#if open}
    <div class="pop" role="dialog" aria-label="Albums" tabindex="-1"
      onkeydown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }}>
      <div class="top">
        <input bind:this={input} bind:value={q} oninput={() => (hi = 0)} onkeydown={key} placeholder="Search albums or a year…"
          role="combobox" aria-expanded="true" aria-autocomplete="list" aria-label="Search albums"
          aria-controls="album-list" aria-activedescendant={items[hi] ? `alb-${items[hi].id}` : undefined} />
        <div class="seg" role="group" aria-label="Which albums">
          <button aria-pressed={!showAll} onclick={() => setAll(false)} title="Albums spanning at most {TRIP_DAYS} days">trips</button>
          <button aria-pressed={showAll} onclick={() => setAll(true)}>all</button>
        </div>
      </div>
      {#if error && albums.length}<div class="err">{error} (showing the last list)</div>{/if}
      <ul id="album-list" role="listbox" aria-label="Albums" bind:this={list}>
        {#each items as a, i (a.id)}
          <li id="alb-{a.id}" role="option" aria-selected={i === hi} class:hi={i === hi} class:cur={a.id === current}
            onpointerenter={() => (hi = i)} onclick={() => pick(a)} onkeydown={() => {}}>
            <span class="name">{albumLabel(a.name)}{#if a.shared}<em> shared</em>{/if}</span>
            <span class="meta">{fDay(a.start)} · {days(a)} d · {fNum(a.count)}</span>
          </li>
        {:else}
          {#if !albums.length}
            <li class="empty">{error ?? (loaded ? 'No albums in this library' : 'Loading albums…')}</li>
          {:else}
            <li class="empty">No albums match{showAll ? '' : ' (only trips are listed: try “all”)'}</li>
          {/if}
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .picker { position: relative; }
  .btn { background: var(--raised); border: 1px solid var(--line); border-radius: 4px; color: var(--ink); font: 500 12px var(--f-body); padding: 3px 10px; cursor: pointer; }
  .btn:hover { border-color: var(--muted); }
  .btn:focus-visible, input:focus-visible, .seg button:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }
  .pop {
    position: absolute; left: 0; top: calc(100% + 6px); z-index: 20; width: 380px; max-width: calc(100vw - 32px);
    background: #0B0C0E; border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 10px 30px rgba(0, 0, 0, .6);
    display: grid; grid-template-rows: auto auto 1fr;
  }
  .top { display: flex; gap: 8px; padding: 8px; border-bottom: 1px solid var(--line); }
  input { flex: 1; min-width: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 4px; color: var(--ink); font: 13px var(--f-body); padding: 4px 8px; }
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 4px; overflow: hidden; }
  .seg button { background: none; border: 0; color: var(--muted); font: 12px var(--f-body); padding: 2px 9px; cursor: pointer; }
  .seg button + button { border-left: 1px solid var(--line); }
  .seg button[aria-pressed='true'] { background: var(--raised); color: var(--ink); }
  ul { list-style: none; margin: 0; padding: 4px; max-height: min(60vh, 440px); overflow-y: auto; }
  li { display: grid; gap: 1px; padding: 5px 8px; border-radius: 4px; cursor: pointer; }
  li.hi { background: var(--raised); }
  li.cur .name { color: var(--photo-hi); }
  .name { color: var(--ink); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name em { color: var(--video); font-style: normal; font-size: 11px; }
  .meta { color: var(--muted); font: 11px var(--f-mono); }
  .empty { color: var(--muted); cursor: default; }
  .err { padding: 6px 12px 0; color: #e07a6a; font-size: 12px; }
</style>
