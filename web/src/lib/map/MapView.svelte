<script lang="ts">
  // Stage 4: map (M-A: route colored by time, clustered pins) + M-B strip with the position
  // marker and the nearest photo popping out next to it. The camera fits the selection when it
  // changes; manual pan/zoom is free. The follow camera is stage 6.
  import {onMount, untrack} from 'svelte';
  import * as maplibregl from 'maplibre-gl';
  import type {GeoJSONSource, LngLatBoundsLike, Map as MlMap, MapGeoJSONFeature} from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
  import type {FeatureCollection, Point} from 'geojson';
  import type {ViewerConfig} from '../../../../shared/api.ts';
  import type {LibraryIndex} from '../index/model.ts';
  import {library} from '../index/store.svelte.ts';
  import {selection} from '../selection.svelte.ts';
  import {thumbHashDataUrl} from '../thumbhash.ts';
  import {fDuration, fFullDay, fSpan, fWhen} from './format.ts';
  import {gpsBounds, nearestRow, pinsGeoJSON, positionAt, routeGeoJSON, segmentRoute, typicalOffset, type PinProps} from './route.ts';
  import TimeStrip from './TimeStrip.svelte';

  maplibregl.setWorkerUrl(workerUrl);

  const DEFAULT_STYLE = 'https://tiles.immich.cloud/v1/style/dark.json';
  /** Route color by time: dim amber at the start of the selection → pale gold at the end. */
  const RAMP: [number, string][] = [[0, '#6E4519'], [0.5, '#C98128'], [1, '#F6D49A']];
  const EMPTY: FeatureCollection = {type: 'FeatureCollection', features: []};

  let el = $state<HTMLDivElement>();
  let markerEl = $state<HTMLDivElement>();
  let map: MlMap | undefined;
  let marker: maplibregl.Marker | undefined;
  let markerOn = false;
  let ready = $state(false);
  let failed = $state<string | null>(null);
  let reduced = $state(false);
  /** Marker position on screen, for placing the pop-out on the side with room. */
  let mpt = $state<{x: number; y: number; w: number; h: number} | null>(null);
  let tip = $state<{x: number; y: number; row: number; count: number; first: number; last: number} | null>(null);
  let font: string[] = ['Noto Sans Regular'];
  /** Bumped on every pins setData: features (and async cluster answers) from older data are ignored. */
  let gen = 0;
  /** The index the current pins' rows refer to. */
  let pinsOf = $state.raw<LibraryIndex | null>(null);
  /** Hover / click requests in flight; bumped to cancel them. */
  let hoverSeq = 0, hoverKey = '';
  let cardH = $state(160);
  let tipW = $state(162), tipH = $state(150), wrapW = $state(0), wrapH = $state(0);

  const active = $derived(selection.active);
  const route = $derived(active ? segmentRoute(active.ix, active.lo, active.hi) : null);
  const offset = $derived(active ? typicalOffset(active.ix, active.lo, active.hi) : 0);
  const gpsCount = $derived(route?.rows.length ?? 0);
  const cursor = $derived(active && selection.cursor != null && selection.cursor >= active.t0 && selection.cursor < active.t1 ? selection.cursor : null);
  const pos = $derived(active && route && cursor != null ? positionAt(active.ix, route, cursor) : null);
  const nearest = $derived(active && cursor != null ? nearestRow(active.ix, active.lo, active.hi, cursor) : -1);

  onMount(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mq.matches;
    const onMq = () => (reduced = mq.matches);
    mq.addEventListener('change', onMq);
    let gone = false;
    void (async () => {
      let style = DEFAULT_STYLE;
      try {
        const res = await fetch('/api/config');
        if (res.ok) style = ((await res.json()) as ViewerConfig).mapStyleUrl || style;
      } catch { /* keep the default */ }
      if (gone || !el) return;
      create(el, style);
    })();
    return () => { gone = true; mq.removeEventListener('change', onMq); marker?.remove(); map?.remove(); map = undefined; };
  });

  function create(container: HTMLDivElement, style: string) {
    const m = new maplibregl.Map({
      container, style, center: [0, 20], zoom: 1.4, attributionControl: {compact: true},
      dragRotate: false, pitchWithRotate: false, fadeDuration: reduced ? 0 : 300,
    });
    map = m;
    m.touchZoomRotate.disableRotation();
    m.keyboard.disableRotation();
    m.addControl(new maplibregl.NavigationControl({showCompass: false}), 'top-right');
    // The default style references a sprite image it doesn't ship ("capital"): blank instead of a warning per tile.
    m.setMissingStyleImageResolver(id => { if (!m.hasImage(id)) m.addImage(id, {width: 1, height: 1, data: new Uint8Array(4)}); });
    m.on('error', e => { if (!ready) failed = e.error?.message ?? 'Map failed to load.'; console.warn('map:', e.error); });
    m.on('load', () => {
      font = pickFont(m);
      addLayers(m);
      marker = new maplibregl.Marker({element: markerEl!, anchor: 'center'}).setLngLat([0, 0]);
      m.on('move', placeCard);
      m.on('resize', placeCard);
      failed = null;
      ready = true;
    });
  }

  /** A text font the style's glyph server has: the first one a symbol layer of the style uses. */
  function pickFont(m: MlMap): string[] {
    const found: string[][] = [];
    for (const l of m.getStyle().layers) {
      if (l.type !== 'symbol') continue;
      const f = (l.layout as Record<string, unknown> | undefined)?.['text-font'];
      if (Array.isArray(f) && f.every(x => typeof x === 'string')) found.push(f as string[]);
    }
    return found.find(f => /medium|semibold|bold/i.test(f[0])) ?? found[0] ?? font;
  }

  function addLayers(m: MlMap) {
    m.addSource('gaps', {type: 'geojson', data: EMPTY});
    m.addSource('route', {type: 'geojson', data: EMPTY});
    m.addSource('pins', {
      type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 44, clusterMaxZoom: 15,
      clusterProperties: {t0: ['min', ['get', 't']], t1: ['max', ['get', 't']]},
    });
    // Gaps: thin, dashed, dim. They say "no GPS between these", not "went this way".
    m.addLayer({id: 'gaps', type: 'line', source: 'gaps', layout: {'line-cap': 'butt'},
      paint: {'line-color': '#B5B9C0', 'line-opacity': 0.5, 'line-width': 1.25, 'line-dasharray': [2, 3]}});
    m.addLayer({id: 'route-casing', type: 'line', source: 'route', layout: {'line-cap': 'round', 'line-join': 'round'},
      paint: {'line-color': '#060708', 'line-opacity': 0.6, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 4, 14, 7]}});
    m.addLayer({id: 'route', type: 'line', source: 'route', layout: {'line-cap': 'round', 'line-join': 'round'},
      paint: {
        'line-color': ['interpolate', ['linear'], ['get', 'k'], ...RAMP.flat()],
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2, 14, 3.5],
      }});
    m.addLayer({id: 'clusters', type: 'circle', source: 'pins', filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#171A1F', 'circle-opacity': 0.92, 'circle-stroke-color': '#E8A64E', 'circle-stroke-width': 1.5,
        'circle-radius': ['step', ['get', 'point_count'], 11, 10, 14, 100, 18, 1000, 23],
      }});
    m.addLayer({id: 'cluster-count', type: 'symbol', source: 'pins', filter: ['has', 'point_count'],
      layout: {'text-field': ['get', 'point_count_abbreviated'], 'text-font': font, 'text-size': 11, 'text-allow-overlap': true},
      paint: {'text-color': '#E9E6DF'}});
    m.addLayer({id: 'pin', type: 'circle', source: 'pins', filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['case', ['==', ['get', 'v'], 1], '#3A9BD6', '#E8A64E'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3.5, 14, 5],
        'circle-stroke-color': '#101215', 'circle-stroke-width': 1.5,
      }});

    for (const id of ['clusters', 'pin']) {
      m.on('mouseenter', id, () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', id, () => { m.getCanvas().style.cursor = ''; hoverSeq++; hoverKey = ''; tip = null; });
      m.on('mousemove', id, e => void hover(m, e.features?.[0], e.point));
    }
    m.on('click', 'clusters', async e => {
      const f = e.features?.[0], g = gen;
      if (!f) return;
      try {
        const zoom = await (m.getSource('pins') as GeoJSONSource).getClusterExpansionZoom(f.properties.cluster_id as number);
        if (g !== gen) return; // data changed meanwhile: that cluster id means something else now
        const center = (f.geometry as Point).coordinates as [number, number];
        if (reduced) m.jumpTo({center, zoom}); else m.easeTo({center, zoom, duration: 500});
      } catch { /* cluster gone (data replaced) */ }
    });
    m.on('click', 'pin', e => {
      const p = e.features?.[0]?.properties as PinProps | undefined;
      const a = active;
      if (!p || p.g !== gen || !a || pinsOf !== a.ix || p.r < a.lo || p.r >= a.hi) return;
      selection.cursor = a.ix.t[p.r];
    });
  }

  async function hover(m: MlMap, f: MapGeoJSONFeature | undefined, p: {x: number; y: number}) {
    const ix = pinsOf;
    if (!f || !ix) return;
    const cid = f.properties.cluster_id as number | undefined;
    if (cid == null) {
      const pp = f.properties as PinProps;
      if (pp.g !== gen || pp.r >= ix.n) return;
      hoverKey = '';
      tip = {x: p.x, y: p.y, row: pp.r, count: 1, first: ix.t[pp.r], last: ix.t[pp.r]};
      return;
    }
    const key = `${gen}:${cid}`, n = f.properties.point_count as number;
    const t0 = f.properties.t0 as number, t1 = f.properties.t1 as number;
    if (key === hoverKey && tip) { tip = {...tip, x: p.x, y: p.y}; return; }
    hoverKey = key;
    const seq = ++hoverSeq;
    // One leaf for the preview; the time span comes aggregated with the cluster.
    const leaves = await (m.getSource('pins') as GeoJSONSource).getClusterLeaves(cid, 1, 0).catch(() => []);
    const leaf = leaves[0]?.properties as PinProps | undefined;
    if (seq !== hoverSeq || !leaf || leaf.g !== gen || leaf.r >= ix.n) return;
    tip = {x: p.x, y: p.y, row: leaf.r, count: n, first: t0, last: t1};
  }

  // Data: only when the selection (or, without one, the library) changes. Never per frame.
  $effect(() => {
    if (!ready || !map) return;
    const a = active, r = route, lib = library.index, m = map;
    const pins = m.getSource('pins') as GeoJSONSource, lines = m.getSource('route') as GeoJSONSource, gaps = m.getSource('gaps') as GeoJSONSource;
    tip = null; hoverSeq++; hoverKey = '';
    const g = ++gen;
    if (a && r) {
      const geo = routeGeoJSON(a.ix, r, a.t0, a.t1);
      lines.setData(geo.lines); gaps.setData(geo.gaps);
      pins.setData(pinsGeoJSON(a.ix, a.lo, a.hi, g));
      pinsOf = a.ix;
    } else {
      lines.setData(EMPTY); gaps.setData(EMPTY);
      const all = !selection.sel && lib;
      pins.setData(all ? pinsGeoJSON(lib, 0, lib.n, g) : EMPTY);
      pinsOf = all ? lib : null;
    }
  });

  // Camera: fit once per selection (and once for the whole library without one); not on index refreshes.
  let fittedFor: unknown = null;
  $effect(() => {
    if (!ready) return;
    const sel = selection.sel, a = active, lib = library.index;
    const key = sel ?? (lib ? 'library' : null);
    if (!key || key === fittedFor || (sel && !a)) return;
    fittedFor = key;
    untrack(() => fit(false));
  });

  function fit(animate = true) {
    const a = active, lib = library.index;
    const b = a ? gpsBounds(a.ix, a.lo, a.hi) : lib ? gpsBounds(lib, 0, lib.n) : null;
    if (!map || !b) return;
    const card = a ? 190 : 0;
    map.fitBounds(b as LngLatBoundsLike, {
      padding: {top: 56, bottom: 48, left: 56 + card / 2, right: 56 + card / 2},
      maxZoom: 14, duration: animate && !reduced ? 700 : 0,
    });
  }

  // Marker: follows the shared cursor; cheap (one DOM marker), fine on every cursor change.
  $effect(() => {
    if (!ready || !map || !marker) return;
    if (pos) {
      marker.setLngLat([pos.lon, pos.lat]);
      if (!markerOn) { marker.addTo(map); markerOn = true; }
      placeCard();
    } else {
      if (markerOn) { marker.remove(); markerOn = false; }
      mpt = null;
    }
  });

  function placeCard() {
    if (!map || !marker || !pos) return;
    // The marker may sit on another world copy than pos (MapLibre wraps it to stay in view).
    const p = map.project(marker.getLngLat()), c = map.getContainer();
    mpt = {x: p.x, y: p.y, w: c.clientWidth, h: c.clientHeight};
  }

  // The pop-out photo: thumbhash at once, the thumbnail after the cursor rests for a moment.
  let thumbFor = $state<string | null>(null);
  $effect(() => {
    const id = active && nearest >= 0 ? active.ix.id[nearest] : null;
    if (id === untrack(() => thumbFor)) return;
    const h = setTimeout(() => (thumbFor = id), 90);
    return () => clearTimeout(h);
  });
  const thumbUrl = (id: string) => `/api/assets/${id}/thumbnail?size=thumbnail`;

  const CARD_W = 172, GAP = 22;
  const cardSide = $derived(mpt && mpt.x + GAP + CARD_W > mpt.w - 8 ? 'left' : 'right');
  const cardTop = $derived(mpt ? Math.min(Math.max(-mpt.y + 8, -cardH / 2), mpt.h - mpt.y - cardH - 8) : -cardH / 2);

  const where = (ix: LibraryIndex, r: number) =>
    ix.city[r] || ix.country[r] || (ix.gps[r] ? 'GPS, no place name' : 'no GPS');

  const posNote = $derived(
    !pos ? '' :
    pos.kind === 'gap' ? 'in transit · no GPS' :
    pos.kind === 'before' ? 'before first GPS fix' :
    pos.kind === 'after' ? 'after last GPS fix' :
    pos.kind === 'interp' ? 'estimated position' : '');

  const legend = $derived(active ? {from: fFullDay(active.t0, 0), to: fFullDay(active.t1 - 1, 0)} : null);
</script>

<div class="mapview">
  <div class="mapwrap" bind:clientWidth={wrapW} bind:clientHeight={wrapH}>
    <div class="map" bind:this={el}></div>

    {#if failed}
      <div class="notice">Map unavailable: {failed}</div>
    {:else if !selection.sel}
      <div class="notice">Pick a range or album above to see the route and scrub through it.</div>
    {:else if active && !gpsCount}
      <div class="notice">None of the {active.hi - active.lo} items in this selection have GPS.</div>
    {/if}

    {#if legend && gpsCount}
      <div class="legend">
        <div class="ramp" style:background="linear-gradient(90deg, {RAMP.map(([k, c]) => `${c} ${k * 100}%`).join(', ')})"></div>
        <div class="ends"><span>{legend.from}</span><span>{legend.to}</span></div>
        <div class="key"><span class="dash"></span>no GPS in between</div>
        <div class="key muted">{gpsCount} of {active!.hi - active!.lo} with GPS</div>
      </div>
    {/if}

    {#if ready}
      <button class="fit" onclick={() => fit(true)} title="Fit the map to the whole selection">
        {active ? 'Whole selection' : 'Whole library'}
      </button>
    {/if}

    {#if tip && pinsOf}
      {@const ix = pinsOf}
      {@const hash = thumbHashDataUrl(ix.thumbhash[tip.row])}
      <div class="tip" bind:offsetWidth={tipW} bind:offsetHeight={tipH}
        style:left="{tip.x + 14 + tipW > wrapW - 4 ? tip.x - 14 - tipW : tip.x + 14}px"
        style:top="{tip.y + 14 + tipH > wrapH - 4 ? Math.max(4, tip.y - 14 - tipH) : tip.y + 14}px">
        <div class="ph" style:background-image={hash ? `url(${hash})` : undefined}></div>
        {#if tip.count > 1}
          <strong>{tip.count} items</strong>
          <span>{fWhen(tip.first, ix.off[tip.row])}</span>
          {#if tip.last - tip.first > 60e3}<span>→ {fWhen(tip.last, ix.off[tip.row])}</span>{/if}
        {:else}
          <strong>{fWhen(tip.first, ix.off[tip.row])}</strong>
          <span>{ix.video[tip.row] ? `video ${fDuration(ix.dur[tip.row])} · ` : ''}{where(ix, tip.row)}</span>
        {/if}
      </div>
    {/if}
  </div>

  {#if active}
    <TimeStrip {active} {offset} />
  {/if}
</div>

<!-- Re-parented into the map by maplibregl.Marker, which owns that element's classes: style the inner div. -->
<div hidden>
  <div bind:this={markerEl}><div class="marker {pos?.kind ?? ''}">
    <div class="dot"></div>
    {#if active && nearest >= 0}
      {@const ix = active.ix}
      {@const r = nearest}
      {@const hash = thumbHashDataUrl(ix.thumbhash[r])}
      <div class="card {cardSide}" style:top="{cardTop}px" bind:offsetHeight={cardH}>
        <div class="ph" style:background-image={hash ? `url(${hash})` : undefined}>
          {#if thumbFor === ix.id[r]}
            {#key thumbFor}<img src={thumbUrl(ix.id[r])} alt="" onload={e => (e.currentTarget as HTMLImageElement).classList.add('in')} />{/key}
          {/if}
          {#if ix.video[r]}<span class="vid">{fDuration(ix.dur[r])}</span>{/if}
        </div>
        <strong>{fWhen(ix.t[r], ix.off[r])}</strong>
        <span class="place">{where(ix, r)}</span>
        {#if posNote}<span class="note">{posNote}</span>{/if}
        {#if cursor != null && Math.abs(ix.t[r] - cursor) > 30 * 60e3}
          <span class="note muted">photo {fSpan(ix.t[r] - cursor)} {ix.t[r] > cursor ? 'after' : 'before'} cursor</span>
        {/if}
      </div>
    {/if}
  </div></div>
</div>

<style>
  .mapview { height: 100%; display: grid; grid-template-rows: 1fr auto; min-height: 0; }
  .mapwrap { position: relative; min-height: 0; }
  .map { position: absolute; inset: 0; background: var(--ground); }

  .notice {
    position: absolute; top: 14px; left: 50%; transform: translateX(-50%); z-index: 2;
    background: rgba(16, 18, 21, .88); border: 1px solid var(--line); border-radius: 999px;
    padding: 6px 14px; font-size: 13px; color: var(--ink2); pointer-events: none; white-space: nowrap;
  }

  .legend {
    position: absolute; left: 12px; top: 12px; z-index: 2; width: 200px; padding: 8px 10px 7px;
    background: rgba(11, 12, 14, .86); border: 1px solid var(--line); border-radius: 5px;
    font: 400 10px/1.4 var(--f-mono); color: var(--ink2); pointer-events: none;
  }
  .ramp { height: 4px; border-radius: 2px; }
  .ends { display: flex; justify-content: space-between; margin: 4px 0 5px; }
  .key { display: flex; align-items: center; gap: 6px; }
  .key.muted { color: var(--muted); margin-top: 2px; }
  .dash { width: 22px; height: 0; border-top: 1.5px dashed rgba(181, 185, 192, .6); }

  .fit {
    position: absolute; right: 50px; top: 10px; z-index: 2;
    background: rgba(11, 12, 14, .86); color: var(--ink2); border: 1px solid var(--line); border-radius: 4px;
    font: 500 12px var(--f-body); padding: 5px 10px; cursor: pointer;
  }
  .fit:hover { color: var(--ink); border-color: var(--muted); }
  .fit:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }

  .tip {
    position: absolute; z-index: 3; pointer-events: none; display: grid; gap: 1px; width: 150px;
    background: #0B0C0E; border: 1px solid var(--line); border-radius: 5px; padding: 5px 5px 6px;
    font: 400 11px/1.35 var(--f-mono); color: var(--muted);
  }
  .tip strong { color: var(--ink); font-weight: 500; }
  .tip .ph { height: 84px; border-radius: 3px; margin-bottom: 4px; }
  .ph { background: #20242B center / cover no-repeat; position: relative; overflow: hidden; }

  .marker { position: relative; width: 0; height: 0; pointer-events: none; }
  .marker .dot {
    position: absolute; left: -9px; top: -9px; width: 18px; height: 18px; border-radius: 50%;
    border: 2.5px solid var(--photo); background: radial-gradient(circle, var(--ink) 0 4.5px, transparent 5px);
    box-shadow: 0 0 0 1.5px rgba(6, 7, 8, .7);
  }
  /* Estimated between two fixes of one run: hollow. */
  .marker.interp .dot { background: rgba(16, 18, 21, .55); border-color: var(--ink); border-width: 2px; }
  /* Between runs / outside GPS span: unknown, dashed and grey. */
  .marker:is(.gap, .before, .after) .dot { background: rgba(16, 18, 21, .55); border: 2px dashed var(--ink2); opacity: .9; }

  .card {
    position: absolute; width: 172px; display: grid; gap: 1px; padding: 6px 6px 7px;
    background: #0B0C0E; border: 1px solid var(--line); border-radius: 5px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, .45);
    font: 400 11px/1.35 var(--f-mono); color: var(--muted);
  }
  .card.right { left: 22px; }
  .card.left { right: 22px; }
  .card .ph { height: 100px; border-radius: 3px; margin-bottom: 5px; }
  .card img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; }
  .card img:global(.in) { opacity: 1; transition: opacity .15s; }
  .card strong { color: var(--ink); font-weight: 500; }
  .card .place { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card .note { color: var(--ink2); }
  .card .note.muted { color: var(--muted); }
  .vid {
    position: absolute; left: 0; right: 0; bottom: 0; height: 16px; padding: 0 5px;
    background: linear-gradient(transparent, rgba(0, 0, 0, .6)); color: #fff; font-size: 10px; text-align: right;
    border-bottom: 3px solid var(--video);
  }

  @media (prefers-reduced-motion: reduce) {
    .card img:global(.in) { transition: none; }
  }

  :global(.maplibregl-ctrl-group) { background: rgba(11, 12, 14, .86) !important; }
  :global(.maplibregl-ctrl-group button + button) { border-top-color: var(--line) !important; }
  :global(.maplibregl-ctrl button .maplibregl-ctrl-icon) { filter: invert(.85); }
  :global(.maplibregl-ctrl-attrib) { background: rgba(11, 12, 14, .7) !important; color: var(--muted); }
  :global(.maplibregl-ctrl-attrib a) { color: var(--ink2); }
</style>
