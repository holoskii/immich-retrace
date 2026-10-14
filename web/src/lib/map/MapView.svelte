<script lang="ts">
  // Map (M-A: route colored by time, clustered pins) + M-B strip with the position marker and the
  // nearest photo popping out next to it. Camera (stage 6): a Follow toggle (the "Smooth" follow camera,
  // camera.ts + follow.ts) and Fit (frame the whole selection); a user pan/zoom pauses either (camNext).
  import {onMount, untrack} from 'svelte';
  import * as maplibregl from 'maplibre-gl';
  import type {GeoJSONSource, LngLatBoundsLike, Map as MlMap, MapGeoJSONFeature} from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
  import type {FeatureCollection, Point} from 'geojson';
  import {DEFAULT_MAP_STYLE_URL as DEFAULT_STYLE, type ViewerConfig} from '../../../../shared/api.ts';
  import type {LibraryIndex} from '../index/model.ts';
  import {library, phaseText} from '../index/store.svelte.ts';
  import {explainIndex, explainMedia, probeMedia, retryLibrary, type MediaFailure} from '../failure.ts';
  import {lowerBound, sameSelection, selection, writeUrl, type Selection} from '../selection.svelte.ts';
  import {thumbHashDataUrl} from '../thumbhash.ts';
  import {thumbUrl} from '../lightbox/media.ts';
  import {dayAround, fDays, selName, zoomName, zoomSpan} from '../nav.ts';
  import {countRows, DAY, fNum} from '../overview/data.ts';
  import {fDay, fDuration, fFullDay, fSpan, fWhen} from './format.ts';
  import {clusterVisits, gpsBounds, nearestRow, pinsGeoJSON, positionAt, routeGeoJSON, segmentRoute, typicalOffset, type PinProps, type Visit} from './route.ts';
  import {binFixes, boxOf, buildTrack, mercX, mercY, type Track} from './camera.ts';
  import type {TrackRequest} from './camera.worker.ts';
  import {camNext, FOLLOW, Follower, type CamEvent, type CamState} from './follow.ts';
  import {Inset} from './inset.ts';
  import {isScrub} from './scrub.ts';
  import TimeStrip from './TimeStrip.svelte';

  maplibregl.setWorkerUrl(workerUrl);

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
  let hoverSeq = 0, hoverKey = '', clickSeq = 0;
  let cardH = $state(160);
  /** Visit chooser after a click on a cluster the user was at more than once. */
  let menu = $state<{x: number; y: number; visits: Visit[]; expand: () => void; off: number} | null>(null);
  let tipW = $state(162), tipH = $state(150), wrapW = $state(0), wrapH = $state(0);

  const active = $derived(selection.active);
  const route = $derived(active ? segmentRoute(active.ix, active.lo, active.hi) : null);
  const offset = $derived(active ? typicalOffset(active.ix, active.lo, active.hi) : 0);
  const gpsCount = $derived(route?.rows.length ?? 0);
  const cursor = $derived(active && selection.cursor != null && selection.cursor >= active.t0 && selection.cursor < active.t1 ? selection.cursor : null);
  const pos = $derived(active && route && cursor != null ? positionAt(active.ix, route, cursor) : null);
  const nearest = $derived(active && cursor != null ? nearestRow(active.ix, active.lo, active.hi, cursor) : -1);

  // Camera control state (follow.ts camNext): the mode the follower runs, and what a new selection starts in.
  let cam = $state<CamState>({mode: 'follow', auto: 'follow'});
  const mode = $derived(cam.mode);
  let follower: Follower | undefined;
  let inset: Inset | undefined;
  let insetCv = $state<HTMLCanvasElement>();
  const INSET_W = 176, INSET_H = 124;
  const bins = $derived(active ? binFixes(active.ix, active.lo, active.hi) : null);
  const box = $derived(bins ? boxOf(bins) : null);
  let track = $state.raw<Track | null>(null);
  const showInset = $derived(!!box && mode !== 'whole');

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
    const onVis = () => { if (!document.hidden) follower?.snap(); };
    document.addEventListener('visibilitychange', onVis);
    const release = () => { if (follower?.held) { follower.held = false; follower.kick(); } };
    addEventListener('pointerup', release);
    addEventListener('pointercancel', release);
    return () => {
      gone = true; mq.removeEventListener('change', onMq);
      document.removeEventListener('visibilitychange', onVis);
      removeEventListener('pointerup', release); removeEventListener('pointercancel', release);
      follower?.dispose(); worker?.terminate(); marker?.remove(); map?.remove(); map = undefined;
    };
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
      follower = new Follower(m, () => { placeCard(); drawInset(); }, (lon, lat) => marker?.setLngLat([lon, lat]));
      follower.reduced = reduced;
      m.on('move', () => { placeCard(); drawInset(); });
      m.on('resize', () => { placeCard(); follower?.kick(); });
      // A user gesture (drag, wheel, keys, zoom buttons all carry originalEvent) hands the camera over.
      m.on('movestart', e => { if ((e as {originalEvent?: Event}).originalEvent) toManual(); });
      m.on('wheel', toManual);
      m.on('movestart', e => { if ((e as {originalEvent?: Event}).originalEvent) menu = null; });
      m.on('click', e => { if (!m.queryRenderedFeatures(e.point, {layers: ['clusters']}).length) menu = null; });
      // jumpTo() resets MapLibre's gesture handlers: hold the camera while a pointer is down on the map.
      m.getCanvasContainer().addEventListener('pointerdown', () => { if (follower) follower.held = true; });
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
      clusterProperties: {t0: ['min', ['get', 't']], t1: ['max', ['get', 't']], g: ['max', ['get', 'g']]},
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
    // A cluster click narrows the selection to the days of that place's photos (a zoom; Back returns).
    // Several visits (e.g. start and end of a trip) → a chooser. Nothing to narrow → zoom the map in.
    m.on('click', 'clusters', async e => {
      const f = e.features?.[0], g = gen, ix = pinsOf, a = active, seq = ++clickSeq;
      // A cluster still rendered from the previous data: its id means something else in the new data.
      if (!f || !ix || f.properties.g !== g) return;
      const src = m.getSource('pins') as GeoJSONSource, cid = f.properties.cluster_id as number;
      const center = (f.geometry as Point).coordinates as [number, number];
      const expand = async () => {
        try {
          const zoom = await src.getClusterExpansionZoom(cid);
          if (g !== gen) return; // data changed meanwhile: that cluster id means something else now
          toManual();
          if (reduced) m.jumpTo({center, zoom}); else m.easeTo({center, zoom, duration: 500});
        } catch { /* cluster gone (data replaced) */ }
      };
      try {
        const leaves = await src.getClusterLeaves(cid, Infinity, 0);
        if (g !== gen || seq !== clickSeq) return;
        const [lo, hi] = a && a.ix === ix ? [a.lo, a.hi] : libRows ?? [0, ix.n];
        const visits = clusterVisits(ix, lo, hi, leaves.map(l => (l.properties as PinProps).r)).filter(v => narrows(v.t0, v.t1));
        if (visits.length > 1) { menu = {x: e.point.x, y: e.point.y, visits, expand, off: a ? offset : 0}; return; }
        if (visits.length === 1) { zoomTo(visits[0]); return; }
      } catch { /* no leaves: just expand */ }
      void expand();
    });
    // A pin: the cursor goes there; without a selection (library pins), its day is selected first.
    m.on('click', 'pin', e => {
      const p = e.features?.[0]?.properties as PinProps | undefined;
      const a = active, ix = pinsOf;
      if (!p || p.g !== gen || !ix) return;
      if (!selection.sel) { if (ix === library.index && p.r < ix.n) pickDay(ix, p.r); return; }
      if (!a || ix !== a.ix || p.r < a.lo || p.r >= a.hi) return;
      selection.cursor = a.ix.t[p.r];
    });
  }

  /** The selection a zoom to [t0, t1] would make (whole hours within the current span, inside the current album if any). */
  function zoomSel(t0: number, t1: number): Selection {
    const s = selection.sel, [d0, d1] = zoomSpan(t0, t1, s ? [s.t0, s.t1] : null);
    return s?.kind === 'album' ? {...s, t0: d0, t1: d1, sub: true} : {kind: 'range', t0: d0, t1: d1};
  }
  /** Whether zooming to [t0, t1] would narrow the current selection at all. */
  function narrows(t0: number, t1: number) {
    const s = selection.sel, z = zoomSel(t0, t1);
    return !s || ((z.t0 > s.t0 || z.t1 < s.t1) && !sameSelection(s, z));
  }
  function zoomTo(v: {t0: number; t1: number; n: number; place: string}) {
    menu = null;
    const z = zoomSel(v.t0, v.t1), label = zoomName(selection.sel, v.t0, v.t1, v.place) || `${v.n} photos`;
    narrowed(z, label, fDays(z.t0, z.t1));
    selection.zoomInto(z, label, v.t0);
    writeUrl('commit', v.t0);
  }
  /** Library pin without a selection: select the (UTC) day it was taken, cursor on it. Back returns to no selection. */
  function pickDay(ix: LibraryIndex, r: number) {
    const t = ix.t[r], [d0, d1] = dayAround(t), place = ix.city[r] || ix.country[r] || '';
    const z: Selection = {kind: 'range', t0: d0, t1: d1}, label = zoomName(null, d0, d1 - 1, place) || fFullDay(t, ix.off[r]);
    narrowed(z, label, `the day of this photo, ${fDays(d0, d1)}`);
    selection.zoomInto(z, label, t);
    writeUrl('commit', t);
  }

  // After a cluster or pin zoom: say what was narrowed and how to get back, until the selection changes or ~12 s pass.
  let zoomed = $state.raw<{sel: Selection; label: string; what: string; parent: string} | null>(null);
  let zoomedTimer: ReturnType<typeof setTimeout> | undefined;
  function narrowed(sel: Selection, label: string, what: string) {
    clearTimeout(zoomedTimer);
    zoomed = {sel, label, what, parent: selName(selection.sel, selection.zoomLabel)};
    zoomedTimer = setTimeout(() => (zoomed = null), 12_000);
  }
  $effect(() => { if (zoomed && selection.sel !== zoomed.sel) untrack(() => { zoomed = null; clearTimeout(zoomedTimer); }); });
  $effect(() => () => clearTimeout(zoomedTimer));
  function zoomBack() {
    zoomed = null;
    if (selection.back()) writeUrl('commit', selection.cursor);
  }
  /** "29 Apr 2023" or "29 Apr 2023 → 2 May" in the selection's local time. */
  function fVisit(v: Visit, off: number) {
    const a = fFullDay(v.t0, off), b = fFullDay(v.t1, off);
    return a === b ? a : `${a} → ${fDay(v.t1, off)}`;
  }
  // The chooser belongs to the data it was made from.
  $effect(() => { void active; void pinsOf; menu = null; });

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

  /** Without a selection: the library rows inside the overview's visible period (all rows before it is known). */
  const libRows = $derived.by((): [number, number] | null => {
    const lib = library.index, v = selection.timeline;
    if (!lib) return null;
    return v ? [lowerBound(lib.t, v[0]), lowerBound(lib.t, v[1])] : [0, lib.n];
  });

  // Data: only when the selection (or, without one, the library or its visible period) changes. Never per frame.
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
      const lr = libRows, all = !selection.sel && lib && lr;
      pins.setData(all ? pinsGeoJSON(lib, lr[0], lr[1], g) : EMPTY);
      pinsOf = all ? lib : null;
      // The visible period moved somewhere the map isn't showing at all: go there.
      if (all) untrack(() => {
        const b = gpsBounds(lib, lr[0], lr[1]), v = m.getBounds();
        if (b && (b[2] < v.getWest() || b[0] > v.getEast() || b[3] < v.getSouth() || b[1] > v.getNorth())) fit(true);
      });
    }
  });

  // Without a selection: fit the library's visible period once. With one, the follower drives the camera.
  let fittedFor: unknown = null;
  $effect(() => {
    if (!ready) return;
    const sel = selection.sel, lib = library.index;
    if (sel) { fittedFor = null; return; }
    if (!lib || fittedFor === 'library') return;
    fittedFor = 'library';
    untrack(() => fit(false));
  });

  function fit(animate = true) {
    const lib = library.index, lr = libRows;
    const b = lib && lr ? gpsBounds(lib, lr[0], lr[1]) : null;
    if (!map || !b) return;
    map.fitBounds(b as LngLatBoundsLike, {padding: 56, maxZoom: 14, duration: animate && !reduced ? 700 : 0});
  }

  // Track: built in a worker (a year of GPS costs ~50–150 ms cold); the main thread only bins the fixes.
  let worker: Worker | null = null;
  let reqId = 0;
  $effect(() => {
    const b = bins, a = active;
    const id = ++reqId;
    track = null;
    if (!b || !a || !b.n) return;
    const local = () => { if (id === reqId) track = buildTrack(b, a.t0, a.t1); };
    try {
      if (!worker) {
        worker = new Worker(new URL('./camera.worker.ts', import.meta.url), {type: 'module'});
        worker.onmessage = (e: MessageEvent<{id: number; track: Track | null}>) => { if (e.data.id === reqId) track = e.data.track; };
        worker.onerror = e => { console.warn('camera worker:', e.message); worker?.terminate(); worker = null; local(); };
      }
      worker.postMessage({id, bins: b, t0: a.t0, t1: a.t1} satisfies TrackRequest);
    } catch (e) {
      console.warn('camera worker:', e);
      local();
    }
  });

  // New selection: back to the automatic mode, snap there (and again once its track arrives).
  let selKey: unknown = null, snapOnTrack = false;
  $effect(() => {
    if (!ready || !follower) return;
    const sel = selection.sel, bx = box;
    follower.box = bx;
    if (sel === selKey) { follower.kick(); return; }
    selKey = sel;
    untrack(() => camTo('select', false));
    follower.mk = null;
    follower.snap();
    snapOnTrack = true;
  });
  $effect(() => {
    if (!ready || !follower) return;
    follower.track = track;
    if (!track) return;
    if (snapOnTrack) { snapOnTrack = false; follower.snap(); } else follower.kick();
  });

  // Cursor: scrubbing flies along; any other jump further than FOLLOW.seekMs is a seek and snaps.
  let lastCursor: number | null = null;
  $effect(() => {
    if (!ready || !follower) return;
    const c = cursor, prev = lastCursor;
    lastCursor = c;
    follower.cursor = c;
    const seek = c != null && !isScrub() && (prev == null || Math.abs(c - prev) > FOLLOW.seekMs);
    if (seek) follower.snap(); else follower.kick();
  });

  $effect(() => { if (follower) { follower.reduced = reduced; follower.kick(); } });

  // Marker: shown at the cursor's route position; the follower moves it (on a spring while following).
  $effect(() => {
    if (!ready || !map || !marker || !follower) return;
    if (pos) {
      follower.pos = {x: mercX(pos.lon), y: mercY(pos.lat)};
      if (!markerOn) { marker.setLngLat([pos.lon, pos.lat]).addTo(map); markerOn = true; follower.mk = null; }
      follower.kick();
    } else {
      follower.pos = null;
      if (markerOn) { marker.remove(); markerOn = false; }
      mpt = null;
      follower.kick();
    }
  });

  function camTo(ev: CamEvent, user = true) {
    cam = camNext(untrack(() => cam), ev);
    if (!follower) return;
    follower.mode = cam.mode;
    follower.release();
    if (user) follower.kick();
  }

  function toManual() {
    if (mode !== 'manual' && active) camTo('pan');
  }
  /** Follow is off because the map was moved by hand (it comes back with the next selection, or a click). */
  const paused = $derived(cam.mode === 'manual' && cam.auto === 'follow');

  // Inset: route pre-rendered per selection; view, target and position drawn per frame.
  $effect(() => {
    const cv = insetCv, a = active, r = route, bx = box;
    if (!cv || !a || !r || !bx) { inset = undefined; return; }
    inset = new Inset(cv);
    inset.setRoute(a.ix, r, bx, INSET_W, INSET_H);
    untrack(drawInset);
  });

  function drawInset() {
    if (!inset || !map || !follower) return;
    const b = map.getBounds(), c = map.getContainer();
    const view: [number, number, number, number] = [mercX(b.getWest()), mercY(b.getNorth()), mercX(b.getEast()), mercY(b.getSouth())];
    inset.draw(view, follower.following ? follower.goal : null, c.clientWidth, c.clientHeight, follower.mk);
  }

  /** Opens the lightbox at the pop-out card's photo. Native listeners: the card lives inside MapLibre's
   *  container, so it must stop events there (Svelte's delegated handlers would run too late). */
  function cardActions(node: HTMLElement) {
    const stop = (e: Event) => e.stopPropagation();
    const open = () => { if (nearest >= 0) selection.lightbox = nearest; };
    const key = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } e.stopPropagation(); };
    const evs = ['pointerdown', 'mousedown', 'touchstart', 'dblclick', 'wheel'] as const;
    for (const ev of evs) node.addEventListener(ev, stop);
    const click = (e: Event) => { e.stopPropagation(); open(); };
    node.addEventListener('click', click);
    node.addEventListener('keydown', key);
    return () => {
      for (const ev of evs) node.removeEventListener(ev, stop);
      node.removeEventListener('click', click);
      node.removeEventListener('keydown', key);
    };
  }

  function placeCard() {
    if (!map || !marker || !pos) return;
    // The marker may sit on another world copy than pos (MapLibre wraps it to stay in view).
    const p = map.project(marker.getLngLat()), c = map.getContainer();
    mpt = {x: p.x, y: p.y, w: c.clientWidth, h: c.clientHeight};
  }

  // The pop-out photo: the thumbhash until the first thumbnail is in, then the last loaded thumbnail
  // stays up until the next one has decoded. One load in flight, latest wins: scrubbing never
  // flashes back to the blur or to an empty frame.
  let shown = $state<{id: string; url: string} | null>(null);
  let want: {id: string; url: string} | null = null, loading = false, broken = '';
  /** Why thumbnails fail (probed once, until one loads again): a missing permission shouldn't look like a blur. */
  let thumbIssue = $state<MediaFailure | null>(null), probing = false;
  $effect(() => {
    const a = active, r = nearest;
    want = a && r >= 0 ? {id: a.ix.id[r], url: thumbUrl(a.ix.id[r], a.ix.thumbhash[r])} : null;
    pump();
  });
  function pump() {
    const w = want;
    // A thumbnail that failed: its own thumbhash (the card's background), not the previous photo.
    if (w && w.url === broken) { shown = null; return; }
    if (loading || !w || w.url === untrack(() => shown?.url)) return;
    loading = true;
    const img = new Image();
    img.src = w.url;
    img.decode().then(() => { shown = w; thumbIssue = null; }, () => {
      broken = w.url;
      if (thumbIssue || probing) return;
      probing = true;
      void probeMedia(w.url).then(k => { thumbIssue = k; }).finally(() => { probing = false; });
    }).finally(() => { loading = false; pump(); });
  }
  // Card note only for causes worth knowing (a missing file or an odd format just keeps the blur).
  const thumbNote = $derived(thumbIssue === 'permission' ? 'no thumbnails: the API key needs asset.view'
    : thumbIssue === 'unavailable' || thumbIssue === 'network' || thumbIssue === 'signed-out' ? explainMedia(thumbIssue, false).text : '');

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

  // First-run states, centred over the map: nothing to show yet (loading or failed), an empty
  // library, or a library where nothing has GPS. With a library shown, a failed refresh is a notice.
  const libGps = $derived(library.index ? countRows(library.index, 0, library.index.n).gps : 0);
  const panel = $derived.by(() => {
    const ix = library.index;
    if (!ix) return library.status === 'error' ? 'error' : 'loading';
    if (!ix.n) return library.status === 'ready' ? 'empty' : null;
    return !libGps && !selection.sel ? 'nogps' : null;
  });
  const failure = $derived(library.status === 'error' ? explainIndex(library.failure) : null);

  /** The whole library as one range with the lightbox on its first item (for a library without GPS). */
  function browseAll() {
    const ix = library.index;
    if (!ix?.n) return;
    selection.resetZoom();
    void selection.select({kind: 'range', t0: Math.floor(ix.t[0] / DAY) * DAY, t1: Math.floor(ix.t[ix.n - 1] / DAY) * DAY + DAY});
    writeUrl('commit', null);
    selection.lightbox = 0;
  }
</script>

<svelte:window onkeydown={e => { if (e.key === 'Escape' && menu && !e.defaultPrevented && selection.lightbox == null) { e.preventDefault(); menu = null; } }} />
<div class="mapview">
  <div class="mapwrap" bind:clientWidth={wrapW} bind:clientHeight={wrapH}>
    <div class="map" class:dim={!!active && !gpsCount} bind:this={el}></div>

    {#if panel}
      <div class="state" role={panel === 'error' ? 'alert' : 'status'}>
        {#if panel === 'loading'}
          <h2>{phaseText(library.phase, library.attempt, library.progress) || 'Loading…'}</h2>
          <p>The first visit indexes the whole library once; later visits start from this browser's cache.</p>
        {:else if panel === 'error' && failure}
          <h2>{failure.title}</h2>
          <p>{failure.next}</p>
          {#if library.error && failure.title !== library.error}<p class="detail">{library.error}</p>{/if}
          <div class="acts"><button class="primary" onclick={retryLibrary}>{failure.retry === 'reload' ? 'Reload' : 'Retry'}</button></div>
        {:else if panel === 'empty'}
          <h2>No photos in this library</h2>
          <p>Immich returned no photos or videos for this API key. Upload some, or check that the key belongs to the user whose library you want: it sees that user's timeline and the albums shared with them.</p>
          <div class="acts"><button onclick={retryLibrary}>Retry</button></div>
        {:else if panel === 'nogps' && library.index}
          <h2>None of the {fNum(library.index.n)} items have a location</h2>
          <p>The route and map need GPS in the photos' metadata. Turn on location in the camera app, or add locations in Immich. The timeline and the lightbox work without it.</p>
          <div class="acts">
            <button class="primary" onclick={browseAll}>Browse them →</button>
            <button onclick={retryLibrary}>Retry</button>
          </div>
        {/if}
      </div>
    {:else if failed}
      <div class="notice">Map unavailable: {failed}</div>
    {:else if failure}
      <div class="notice err">
        Couldn't refresh the library: {failure.title}.
        <button onclick={retryLibrary}>{failure.retry === 'reload' ? 'Reload' : 'Retry'}</button>
      </div>
    {:else if zoomed && zoomed.sel === selection.sel}
      <div class="notice zoomed" role="status">
        <span>Narrowed to <b>{zoomed.label}</b>: {zoomed.what}.</span>
        <button onclick={zoomBack} title="Back (Backspace)">← Back to {zoomed.parent}</button>
        <button class="x" onclick={() => (zoomed = null)} aria-label="Dismiss">✕</button>
      </div>
    {:else if !selection.sel}
      <div class="notice">
        {#if selection.timeline && library.index && libRows}
          {@const c = countRows(library.index, libRows[0], libRows[1])}
          {c.gps ? `Photos from the visible timeline (${fDays(...selection.timeline)}).` : `No photos with GPS in ${fDays(...selection.timeline)}.`}
        {/if}
        Pick a range or album to follow a route.
      </div>
    {:else if active && active.hi === active.lo}
      <div class="notice">No photos or videos in this selection.</div>
    {:else if active && !gpsCount}
      <div class="notice nogps">
        None of the {active.hi - active.lo} items here have GPS.
        <button onclick={() => (selection.lightbox = active!.lo)}>Browse them →</button>
      </div>
    {/if}


    {#if menu}
      <div class="menu" role="menu" aria-label="Visits to this place" {@attach n => n.querySelector('button')?.focus()}
        style:left="{Math.max(8, Math.min(menu.x + 8, wrapW - 250))}px" style:top="{Math.max(8, Math.min(menu.y + 8, wrapH - 40 - 30 * (menu.visits.length + 2)))}px">
        <div class="mh">{menu.visits.length} visits here</div>
        {#each menu.visits as v (v.t0)}
          <button role="menuitem" onclick={() => zoomTo(v)}>
            <span>{fVisit(v, menu.off)}</span><span class="mut">{v.n}{v.place ? ` · ${v.place}` : ''}</span>
          </button>
        {/each}
        <button role="menuitem" class="sec" onclick={() => { const e = menu!.expand; menu = null; void e(); }}>Just zoom the map in</button>
      </div>
    {/if}

    {#if legend && gpsCount}
      <div class="legend">
        <div class="ramp" style:background="linear-gradient(90deg, {RAMP.map(([k, c]) => `${c} ${k * 100}%`).join(', ')})"></div>
        <div class="ends"><span>{legend.from}</span><span>{legend.to}</span></div>
        <div class="key"><span class="dash"></span>no GPS in between</div>
        <div class="key counts"><i class="sw gps"></i>{fNum(gpsCount)} with location <i class="sw nogps"></i>{fNum(active!.hi - active!.lo - gpsCount)} without</div>
      </div>
    {/if}

    {#if ready && (box || !selection.sel)}
      <div class="modes" role="group" aria-label="Camera">
        {#if box}
          <button class="follow" class:on={mode === 'follow'} class:paused aria-pressed={mode === 'follow'}
            title={mode === 'follow' ? 'Following the time cursor · click to stop' : paused ? 'Paused because the map was moved · click to follow the time cursor again' : 'Follow the time cursor'}
            onclick={() => camTo(mode === 'follow' ? 'unfollow' : 'follow')}>{paused ? 'Follow ⏸' : 'Follow'}</button>
          <button onclick={() => camTo('fit')} class:on={mode === 'whole'} title="Frame the whole selection">Fit</button>
        {:else}
          <button onclick={() => fit(true)} title="Fit the map to the photos of the visible timeline">Fit</button>
        {/if}
      </div>
    {/if}

    {#if showInset}
      <canvas class="inset" bind:this={insetCv}
        style:width="{INSET_W}px" style:height="{INSET_H}px" aria-hidden="true"></canvas>
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
          <span class="hint">click: narrow to these dates</span>
        {:else}
          <strong>{fWhen(tip.first, ix.off[tip.row])}</strong>
          <span>{ix.video[tip.row] ? `video ${fDuration(ix.dur[tip.row])} · ` : ''}{where(ix, tip.row)}</span>
          <span class="hint">{selection.sel ? 'click: move the time cursor here' : 'click: select this day'}</span>
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
      <div class="card {cardSide}" style:top="{cardTop}px" bind:offsetHeight={cardH} {@attach cardActions}
        role="button" tabindex="0" title="Open in the lightbox" aria-label="Open {fWhen(ix.t[r], ix.off[r])} in the lightbox">
        <div class="ph" style:background-image={hash ? `url(${hash})` : undefined}>
          {#if shown}<img src={shown.url} alt="" />{/if}
          {#if ix.video[r]}<span class="vid">{fDuration(ix.dur[r])}</span>{/if}
        </div>
        <strong>{fWhen(ix.t[r], ix.off[r])}</strong>
        <span class="place">{where(ix, r)}</span>
        {#if posNote}<span class="note">{posNote}</span>{/if}
        {#if thumbNote}<span class="note warn">{thumbNote}</span>{/if}
        {#if cursor != null && Math.abs(ix.t[r] - cursor) > 30 * 60e3}
          <span class="note muted">photo {fSpan(ix.t[r] - cursor)} {ix.t[r] > cursor ? 'after' : 'before'} cursor</span>
        {/if}
        <span class="open">{ix.video[r] ? 'Play video' : 'Open photo'} <span aria-hidden="true">⤢</span></span>
      </div>
    {/if}
  </div></div>
</div>

<style>
  .mapview { height: 100%; display: grid; grid-template-rows: 1fr auto; min-height: 0; }
  .mapwrap { position: relative; min-height: 0; }
  .map { position: absolute; inset: 0; background: var(--ground); }

  .map.dim { opacity: .35; }
  .notice:is(.nogps, .err) { pointer-events: auto; display: flex; gap: 12px; align-items: center; }
  .notice.err { color: var(--ink); }
  .notice button, .state button {
    background: var(--raised); color: var(--ink); border: 1px solid var(--photo); border-radius: 999px;
    font: 500 12px var(--f-body); padding: 3px 12px; cursor: pointer;
  }
  .notice button:hover, .state button:hover { background: rgba(232, 166, 78, .18); }
  .notice button:focus-visible, .state button:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }

  .state {
    position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 3;
    width: min(440px, calc(100% - 32px)); padding: 18px 20px 16px;
    background: rgba(11, 12, 14, .94); border: 1px solid var(--line); border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, .5); color: var(--ink2); font-size: 13px; line-height: 1.5;
  }
  .state h2 { margin: 0 0 6px; color: var(--ink); font: 500 16px/1.3 var(--f-body); }
  .state p { margin: 0 0 6px; }
  .state .detail { font: 400 11px/1.4 var(--f-mono); color: var(--muted); overflow-wrap: anywhere; }
  .state .acts { display: flex; gap: 8px; margin-top: 12px; }
  .state button.primary { border-color: var(--photo-hi); color: var(--ink); }
  .notice {
    position: absolute; top: 14px; left: 50%; transform: translateX(-50%); z-index: 2;
    background: rgba(16, 18, 21, .88); border: 1px solid var(--line); border-radius: 999px;
    padding: 6px 14px; font-size: 13px; color: var(--ink2); pointer-events: none; white-space: nowrap;
  }

  .legend {
    position: absolute; left: 12px; top: 12px; z-index: 2; width: max-content; min-width: 200px; padding: 8px 10px 7px;
    background: rgba(11, 12, 14, .86); border: 1px solid var(--line); border-radius: 5px;
    font: 400 10px/1.4 var(--f-mono); color: var(--ink2); pointer-events: none;
  }
  .ramp { height: 4px; border-radius: 2px; }
  .ends { display: flex; justify-content: space-between; margin: 4px 0 5px; }
  .key { display: flex; align-items: center; gap: 6px; }
  .key.counts { margin-top: 3px; gap: 0; white-space: nowrap; }
  .sw { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; }
  .sw.gps { background: var(--gps); }
  .sw.nogps { background: var(--nogps); margin-left: 10px; }
  .dash { width: 22px; height: 0; border-top: 1.5px dashed rgba(181, 185, 192, .6); }

  .modes button:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }

  .modes {
    position: absolute; right: 50px; top: 10px; z-index: 2; display: flex;
    background: rgba(11, 12, 14, .86); border: 1px solid var(--line); border-radius: 4px; overflow: hidden;
  }
  .modes button {
    background: none; color: var(--ink2); border: 0; font: 500 12px var(--f-body); padding: 5px 10px; cursor: pointer;
  }
  .modes button + button { border-left: 1px solid var(--line); }
  .modes button:hover { color: var(--ink); }
  .modes button.on { color: var(--ink); background: rgba(232, 166, 78, .16); box-shadow: inset 0 -2px 0 var(--photo); }
  /* Follow paused by a pan: the way back stays in plain sight. */
  .modes button.paused { color: var(--photo-hi); box-shadow: inset 0 -2px 0 rgba(232, 166, 78, .45); }

  .notice.zoomed { pointer-events: auto; display: flex; gap: 10px; align-items: center; color: var(--ink2); }
  .notice.zoomed b { color: var(--photo-hi); font-weight: 500; }
  .notice.zoomed .x { border: 0; background: none; padding: 0 2px; color: var(--muted); }
  .notice.zoomed .x:hover { color: var(--ink); background: none; }

  .menu button:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }
  .menu {
    position: absolute; z-index: 4; width: 240px; display: grid; padding: 4px; max-height: calc(100% - 56px); overflow-y: auto;
    background: #0B0C0E; border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 8px 24px rgba(0, 0, 0, .5);
    font: 400 12px var(--f-body);
  }
  .menu .mh { padding: 4px 8px 6px; color: var(--muted); font-size: 11px; }
  .menu button {
    display: flex; justify-content: space-between; gap: 8px; background: none; border: 0; border-radius: 4px;
    color: var(--ink); font: inherit; padding: 6px 8px; cursor: pointer; text-align: left;
  }
  .menu button:hover { background: var(--raised); }
  .menu .mut { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .menu .sec { color: var(--ink2); border-top: 1px solid var(--line); border-radius: 0 0 4px 4px; margin-top: 2px; }
  .tip .hint { color: var(--photo-hi); margin-top: 2px; }

  .inset {
    position: absolute; left: 12px; bottom: 12px; z-index: 2; pointer-events: none;
    background: rgba(11, 12, 14, .9); border: 1px solid var(--line); border-radius: 4px;
  }

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
    pointer-events: auto; cursor: pointer;
  }
  .card:hover { border-color: var(--muted); }
  .card:focus-visible { outline: 2px solid var(--photo-hi); outline-offset: 2px; }
  .card.right { left: 22px; }
  .card.left { right: 22px; }
  .card .ph { height: 100px; border-radius: 3px; margin-bottom: 5px; }
  .card img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .card strong { color: var(--ink); font-weight: 500; }
  .card .place { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card .note { color: var(--ink2); }
  .card .note.muted { color: var(--muted); }
  .card .note.warn { color: #e07a6a; }
  .card .open { margin-top: 3px; color: var(--photo-hi); font-family: var(--f-body); font-size: 11px; }
  .card:hover .open { text-decoration: underline; }
  .vid {
    position: absolute; left: 0; right: 0; bottom: 0; height: 16px; padding: 0 5px;
    background: linear-gradient(transparent, rgba(0, 0, 0, .6)); color: #fff; font-size: 10px; text-align: right;
    border-bottom: 3px solid var(--video);
  }

  :global(.maplibregl-ctrl-group) { background: rgba(11, 12, 14, .86) !important; }
  :global(.maplibregl-ctrl-group button + button) { border-top-color: var(--line) !important; }
  :global(.maplibregl-ctrl button .maplibregl-ctrl-icon) { filter: invert(.85); }
  :global(.maplibregl-ctrl-attrib) { background: rgba(11, 12, 14, .7) !important; color: var(--muted); }
  :global(.maplibregl-ctrl-attrib a) { color: var(--ink2); }
</style>
