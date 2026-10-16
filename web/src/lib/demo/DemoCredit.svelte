<script module lang="ts">
  import type {DemoCredit} from '../../../../shared/demo.ts';

  // Per page: stepping back and forth through the lightbox asks once per asset.
  const cache = new Map<string, Promise<DemoCredit | null>>();
  function creditOf(id: string) {
    let p = cache.get(id);
    if (!p) {
      p = fetch(`/api/demo/credits/${id}`)
        .then(r => (r.ok ? (r.json() as Promise<DemoCredit>) : null))
        .catch(() => { cache.delete(id); return null; });
      cache.set(id, p);
    }
    return p;
  }
</script>

<script lang="ts">
  // Demo mode, lightbox panel: who made the asset, its licence (CC BY / CC BY-SA, linked), its Commons
  // page, and what the demo changed: the attribution CC BY 4.0 §3 asks for wherever a photo is shown large.
  // `compact` (touch lightbox): one line plus the changes, still author, licence, source and modifications.
  let {id, video, compact = false}: {id: string; video: boolean; compact?: boolean} = $props();

  let got = $state<{id: string; credit: DemoCredit | null} | null>(null);
  $effect(() => {
    const at = id;
    void creditOf(at).then(credit => { if (id === at) got = {id: at, credit}; });
  });
  const c = $derived(got?.id === id ? got.credit : null);
</script>

{#if c && compact}
  <section class="credit compact" aria-label="Credits">
    <p>
      {video ? 'Clip from a photo by' : '©'} {c.author} ·
      <a href={c.licenseUrl} target="_blank" rel="license noopener noreferrer">{c.license}</a> ·
      <a href={c.commonsUrl} target="_blank" rel="noopener noreferrer" title={c.title}>Wikimedia Commons</a>
    </p>
    <details class="mod"><summary>Changed for the demo</summary>{c.modifications}</details>
  </section>
{:else if c}
  <section class="credit" aria-label="Credits">
    <div class="label">credits</div>
    <p>
      {video ? 'Clip made from a photo by' : 'Photo:'} {c.author},
      <a href={c.licenseUrl} target="_blank" rel="license noopener noreferrer">{c.license}</a>,
      via <a href={c.commonsUrl} target="_blank" rel="noopener noreferrer" title={c.title}>Wikimedia Commons</a>
    </p>
    <p class="title">{c.title}</p>
    <p class="mod">Changed for the demo: {c.modifications}</p>
  </section>
{/if}

<style>
  .credit { margin-top: 14px; display: grid; gap: 3px; font-size: 12px; color: var(--ink2); }
  .label { font: 400 11px var(--f-mono); color: var(--muted); }
  p { margin: 0; line-height: 1.45; }
  a { color: var(--photo-hi); }
  a:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }
  .title { color: var(--ink); overflow-wrap: anywhere; }
  .mod { font-size: 11px; color: var(--muted); }
  .compact { margin-top: 2px; gap: 0; font-size: 11px; }
  .compact p { overflow-wrap: anywhere; }
  .compact .mod { font-size: 10px; line-height: 1.4; }
  .compact summary { cursor: pointer; padding: 2px 0; }
</style>
