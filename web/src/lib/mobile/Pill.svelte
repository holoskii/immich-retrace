<script lang="ts">
  // The Map tab's floating two-line pill: the trip's name; `DEMO · dates · count`. ⋯ opens Share (the system sheet,
  // or copy the link) and About this demo.
  import {selection, toLocal} from '../selection.svelte.ts';
  import {library} from '../index/store.svelte.ts';
  import {config} from '../config.svelte.ts';
  import {demoUi} from '../demo/ui.svelte.ts';
  import {DAY, fNum} from '../albums.ts';
  import {placeOf} from '../map/route.ts';
  import {fDayRange, tripName} from './format.ts';
  import {shareLink} from './share.ts';

  /**
   * `bottom`: the pill's bottom edge in the map's box (px), for the camera's top inset. `loading`: the demo landing
   * is still opening its trip (a neutral line then, not a call to pick one).
   */
  let {bottom = $bindable(0), loading = false}: {bottom?: number; loading?: boolean} = $props();
  let el = $state<HTMLDivElement>(), height = $state(0);
  $effect(() => {
    void height;
    const m = () => { if (el) bottom = el.offsetTop + el.offsetHeight; };
    m();
    // The safe area moves the pill on rotation without resizing it.
    addEventListener('resize', m);
    return () => removeEventListener('resize', m);
  });

  const album = $derived.by(() => {
    const s = selection.sel;
    return s?.kind === 'album' ? library.albums.find(a => a.id === s.albumId) ?? null : null;
  });
  /** A place (a `near=` link from the desktop): its most common city or country. */
  const placeName = $derived.by(() => {
    const a = selection.sel?.kind === 'place' ? selection.active : null;
    return a ? placeOf(a.ix, Array.from({length: a.hi - a.lo}, (_, i) => a.lo + i)) || 'This place' : null;
  });
  const name = $derived(album ? tripName(album.name) : placeName ?? (selection.sel ? 'Selected dates' : 'Retrace'));
  const line2 = $derived.by(() => {
    const s = selection.sel, a = selection.active, parts: string[] = [];
    if (s) {
      // Album days are local calendar days already; any other span is converted (its exclusive end: the day before).
      parts.push(album?.start != null && album.end != null && !(s.kind === 'album' && s.sub)
        ? fDayRange(album.start, album.end)
        : fDayRange(Math.floor(toLocal(s.t0) / DAY) * DAY, Math.floor(toLocal(s.t1 - 1) / DAY) * DAY));
      const n = a ? a.hi - a.lo : album?.count;
      if (n != null) parts.push(`${fNum(n)} ${n === 1 ? 'photo' : 'photos'}`);
    } else parts.push(loading ? 'Loading the trip…' : 'Pick a trip');
    return parts.join(' · ');
  });

  let menu = $state(false);
  let note = $state<string | null>(null), manual = $state<string | null>(null);
  let noteTimer: ReturnType<typeof setTimeout> | undefined;
  let menuEl = $state<HTMLDivElement>(), moreBtn = $state<HTMLButtonElement>();

  async function share() {
    menu = false;
    const url = location.href, r = await shareLink(url, `${name} · Retrace for Immich`);
    clearTimeout(noteTimer);
    if (r === 'copied') { note = 'Link copied'; noteTimer = setTimeout(() => (note = null), 2500); }
    else if (r === 'failed') manual = url;
  }
  function about() { menu = false; demoUi.about = true; }

  // Closes on a touch outside, or Esc.
  $effect(() => {
    if (!menu) return;
    menuEl?.querySelector('button')?.focus();
    const out = (e: PointerEvent) => { if (!menuEl?.contains(e.target as Node) && !moreBtn?.contains(e.target as Node)) menu = false; };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { menu = false; moreBtn?.focus(); } };
    addEventListener('pointerdown', out, true);
    addEventListener('keydown', esc);
    return () => { removeEventListener('pointerdown', out, true); removeEventListener('keydown', esc); };
  });
  $effect(() => () => clearTimeout(noteTimer));
</script>

<div class="pill" bind:this={el} bind:offsetHeight={height}>
  <div class="txt">
    <h1 class="name">{name}</h1>
    <p class="l2">{#if config.demo}<span class="tag">Demo</span>{/if}<span>{line2}</span></p>
  </div>
  <button class="more" bind:this={moreBtn} aria-label="More: share, about this demo" aria-haspopup="menu" aria-expanded={menu} onclick={() => (menu = !menu)}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
  </button>
  {#if menu}
    <div class="menu" role="menu" bind:this={menuEl}>
      <button role="menuitem" onclick={share}>Share this view</button>
      {#if config.demo}<button role="menuitem" onclick={about}>About this demo &amp; credits</button>{/if}
    </div>
  {/if}
  {#if note}<div class="note" role="status">{note}</div>{/if}
  {#if manual}
    <div class="manual" role="dialog" aria-label="Copy the link">
      <p>Copy this link:</p>
      <input readonly value={manual} onfocus={e => e.currentTarget.select()} {@attach n => { n.focus(); }} />
      <button onclick={() => (manual = null)}>Done</button>
    </div>
  {/if}
</div>

<style>
  .pill {
    position: absolute; z-index: 5; top: max(8px, env(safe-area-inset-top));
    left: max(10px, env(safe-area-inset-left)); right: max(10px, env(safe-area-inset-right));
    display: flex; align-items: center; gap: 4px; min-height: 56px; padding: 6px 4px 6px 14px;
    background: rgba(16, 18, 21, .9); border: 1px solid var(--line); border-radius: 16px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, .45);
  }
  .txt { flex: 1; min-width: 0; }
  .name { margin: 0; font: 600 16px/1.25 var(--f-body); color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .l2 { margin: 1px 0 0; display: flex; align-items: center; gap: 6px; font-size: 12px; line-height: 1.3; color: var(--ink2); white-space: nowrap; overflow: hidden; }
  .l2 span:last-child { overflow: hidden; text-overflow: ellipsis; }
  .tag {
    flex: none; padding: 0 6px; border: 1px solid var(--photo); border-radius: 999px; color: var(--photo-hi);
    font: 500 10px/16px var(--f-mono); text-transform: uppercase; letter-spacing: .04em;
  }
  .more {
    flex: none; width: 44px; height: 44px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 12px;
    background: none; color: var(--ink2); cursor: pointer; -webkit-tap-highlight-color: transparent;
  }
  .more svg { width: 22px; height: 22px; fill: currentColor; }
  .more:focus-visible, .menu button:focus-visible, .manual button:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }
  .menu {
    position: absolute; top: calc(100% + 6px); right: 0; min-width: 230px; display: grid; padding: 4px;
    background: #0B0C0E; border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 10px 30px rgba(0, 0, 0, .6);
  }
  .menu button {
    min-height: 44px; padding: 0 12px; border: 0; border-radius: 8px; background: none; color: var(--ink);
    font: 400 15px var(--f-body); text-align: left; cursor: pointer;
  }
  .menu button:active { background: var(--raised); }
  .note {
    position: absolute; top: calc(100% + 6px); left: 50%; transform: translateX(-50%); padding: 6px 14px;
    background: rgba(16, 18, 21, .94); border: 1px solid var(--line); border-radius: 999px; font-size: 13px; color: var(--ink);
  }
  .manual {
    position: absolute; top: calc(100% + 6px); left: 0; right: 0; display: grid; gap: 8px; padding: 12px;
    background: #0B0C0E; border: 1px solid var(--line); border-radius: 12px; font-size: 13px; color: var(--ink2);
  }
  .manual p { margin: 0; }
  .manual input {
    width: 100%; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink);
    font: 400 16px var(--f-mono); /* ≥ 16 px: iOS zooms in on smaller fields */
  }
  .manual button {
    justify-self: end; min-height: 44px; padding: 0 18px; border: 1px solid var(--photo); border-radius: 999px;
    background: var(--raised); color: var(--ink); font: 500 14px var(--f-body);
  }
</style>
