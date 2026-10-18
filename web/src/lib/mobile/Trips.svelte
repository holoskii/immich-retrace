<script lang="ts">
  // The Trips tab: one card per trip-length album (trips.ts shortAlbum: ≤ 45 days), newest first: cover,
  // name, dates, count. From the album list alone, so it paints before the library index is in (the scored heuristic
  // needs the index, and with little GPS around home it drops real trips). A tap selects it (one history entry, like a desktop pick) and the shell shows Map.
  import {library} from '../index/store.svelte.ts';
  import {selection} from '../selection.svelte.ts';
  import {pickAlbum} from '../actions.ts';
  import {fNum, railAlbums, type RailAlbum} from '../albums.ts';
  import {shortAlbum} from '../trips.ts';
  import {thumbHashDataUrl} from '../thumbhash.ts';
  import {thumbUrl} from '../lightbox/media.ts';
  import {explainAlbums} from '../failure.ts';
  import {fDayRange, tripName} from './format.ts';

  /** `picked`: a card was tapped (after the selection has been set). */
  let {picked}: {picked: () => void} = $props();

  const trips = $derived(railAlbums(library.albums, shortAlbum).reverse());
  const current = $derived(selection.sel?.kind === 'album' ? selection.sel.albumId : null);

  /** The cover's thumbhash, when the cover is in the library index (versioned URL: the relay lets browsers cache it). */
  function cover(a: RailAlbum) {
    if (!a.cover) return null;
    const r = library.index?.idToRow.get(a.cover), hash = r != null ? library.index!.thumbhash[r] : null;
    return {src: thumbUrl(a.cover, hash), hash: thumbHashDataUrl(hash)};
  }

  function pick(a: RailAlbum) {
    // The trip on show: just go back to it (its cursor stays).
    if (current !== a.id || selection.sel?.kind !== 'album' || selection.sel.sub || selection.sel.mode !== 'members') pickAlbum(a);
    picked();
  }
</script>

<div class="trips">
  <h1>Trips</h1>
  {#if library.albumsError}
    <!-- Failed, not empty: say so and offer a retry (a cached list, if any, stays below). -->
    <div class="err" role="alert">
      <p>{explainAlbums(library.albumsError, 'Trips')}</p>
      <button onclick={() => void library.retryAlbums()}>Try again</button>
    </div>
  {/if}
  {#if !library.albumsLoaded && !trips.length}
    <p class="msg" role="status">Loading trips…</p>
  {:else if library.albumsError && !trips.length}
    <!-- the error above says it all -->
  {:else if !trips.length}
    <p class="msg">No trips here.</p>
  {:else}
    <ul>
      {#each trips as a (a.id)}
        {@const c = cover(a)}
        <li>
          <button class="trip" class:current={current === a.id} aria-current={current === a.id ? 'true' : undefined} onclick={() => pick(a)}>
            <span class="cover" style:background-image={c?.hash ? `url(${c.hash})` : undefined}>
              {#if c}<img src={c.src} alt="" loading="lazy" decoding="async" />{/if}
            </span>
            <span class="txt">
              <span class="name">{tripName(a.name)}</span>
              <span class="meta">{fDayRange(a.start, a.end)} · {fNum(a.count)} {a.count === 1 ? 'photo' : 'photos'}</span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .trips {
    height: 100%; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch;
    padding: max(12px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 24px max(16px, env(safe-area-inset-left));
  }
  h1 { margin: 8px 0 14px; font: 700 28px/1.2 var(--f-body); color: var(--ink); }
  .msg { color: var(--muted); }
  .err { display: grid; justify-items: start; gap: 10px; margin-bottom: 14px; color: var(--ink2); }
  .err p { margin: 0; }
  .err button {
    min-height: 44px; padding: 0 18px; border: 1px solid var(--photo); border-radius: 999px; background: var(--raised);
    color: var(--ink); font: 500 14px var(--f-body); cursor: pointer;
  }
  .err button:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  .trip {
    width: 100%; display: grid; grid-template-columns: 88px 1fr; gap: 12px; align-items: center; padding: 8px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 14px; color: inherit; font: inherit;
    text-align: left; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation;
  }
  .trip:active { background: var(--raised); }
  .trip.current { border-color: var(--photo); }
  .trip:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }
  .cover { position: relative; height: 66px; border-radius: 9px; overflow: hidden; background: var(--raised) center / cover no-repeat; }
  .cover img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .txt { display: grid; gap: 2px; min-width: 0; }
  .name { font: 600 16px/1.3 var(--f-body); color: var(--ink); }
  .meta { font-size: 13px; color: var(--ink2); }
</style>
