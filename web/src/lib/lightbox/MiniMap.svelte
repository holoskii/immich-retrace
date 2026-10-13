<script lang="ts">
  // Non-interactive mini-map in the lightbox panel: the range's route, faint, and a dot at the open
  // asset, centred on it at street-ish zoom (a whole trip can span continents). Created once per
  // lightbox open with the route of the range it opened in; stepping moves the dot and jumps the view.
  import {onMount, untrack} from 'svelte';
  import * as maplibregl from 'maplibre-gl';
  import type {GeoJSONSource, Map as MlMap} from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
  import type {Feature, FeatureCollection, Point} from 'geojson';
  import type {Active} from '../selection.svelte.ts';
  import {getConfig} from './media.ts';
  import {gpsExtent, routeLines} from './model.ts';

  maplibregl.setWorkerUrl(workerUrl);

  let {a, row}: {a: Active; row: number} = $props();

  let el = $state<HTMLDivElement>();
  let map: MlMap | undefined;
  let ready = $state(false);
  let failed = $state(false);
  // Fixed at open: the range the lightbox opened in.
  const {ix, lo, hi} = untrack(() => a);
  const extent = gpsExtent(ix, lo, hi);

  const ZOOM = 11;
  const at = (): [number, number] | null => (a.ix.gps[row] === 1 ? [a.ix.lon[row], a.ix.lat[row]] : null);

  const pos = (): FeatureCollection<Point> => {
    const cur = a.ix, ok = cur.gps[row] === 1;
    const f: Feature<Point>[] = ok ? [{type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: [cur.lon[row], cur.lat[row]]}}] : [];
    return {type: 'FeatureCollection', features: f};
  };

  onMount(() => {
    if (!extent) return;
    let gone = false;
    void getConfig().then(cfg => {
      if (gone || !el) return;
      const m = new maplibregl.Map({
        container: el, style: cfg.mapStyleUrl, interactive: false, attributionControl: {compact: true},
        ...(untrack(at) ? {center: untrack(at)!, zoom: ZOOM} : {bounds: extent, fitBoundsOptions: {padding: 18, maxZoom: ZOOM}}),
        fadeDuration: 0,
      });
      map = m;
      m.setMissingStyleImageResolver(id => { if (!m.hasImage(id)) m.addImage(id, {width: 1, height: 1, data: new Uint8Array(4)}); });
      m.on('error', e => { if (!ready) failed = true; console.warn('mini-map:', e.error); });
      m.on('load', () => {
        m.addSource('lb-route', {type: 'geojson', data: {type: 'Feature', properties: {}, geometry: {type: 'MultiLineString', coordinates: routeLines(ix, lo, hi)}}});
        m.addLayer({id: 'lb-route', type: 'line', source: 'lb-route', paint: {'line-color': '#E9E6DF', 'line-opacity': .35, 'line-width': 1.5}, layout: {'line-join': 'round', 'line-cap': 'round'}});
        m.addSource('lb-pos', {type: 'geojson', data: pos()});
        m.addLayer({id: 'lb-pos', type: 'circle', source: 'lb-pos', paint: {'circle-radius': 5, 'circle-color': '#E8A64E', 'circle-stroke-color': '#060708', 'circle-stroke-width': 1.5}});
        failed = false;
        ready = true;
      });
    });
    return () => { gone = true; map?.remove(); map = undefined; };
  });

  $effect(() => {
    const data = pos(), c = at();
    if (!ready || !map) return;
    (map.getSource('lb-pos') as GeoJSONSource | undefined)?.setData(data);
    // No GPS: keep the last view, the label says why there is no dot.
    if (c) map.jumpTo({center: c, zoom: ZOOM});
  });
</script>

{#if extent}
  <div class="mini" class:failed>
    <div class="map" bind:this={el} aria-hidden="true"></div>
    {#if a.ix.gps[row] !== 1}<span class="note">no GPS · route of the range</span>{/if}
    {#if failed}<span class="note">map unavailable</span>{/if}
  </div>
{:else}
  <div class="mini empty"><span class="note">no GPS in this range</span></div>
{/if}

<style>
  .mini { position: relative; height: 220px; border-radius: 4px; overflow: hidden; background: var(--ground); flex: none; }
  .mini.empty { height: 44px; }
  .map { position: absolute; inset: 0; }
  .note {
    position: absolute; left: 8px; top: 6px; padding: 1px 6px; border-radius: 3px;
    background: rgba(6, 7, 8, .7); font: 400 11px var(--f-mono); color: var(--muted);
  }
  .mini :global(.maplibregl-ctrl-attrib) { background: rgba(11, 12, 14, .7) !important; color: var(--muted); font-size: 10px; }
  .mini :global(.maplibregl-ctrl-attrib a) { color: var(--ink2); }
</style>
