// Demo mode (plan E11): the server flag and credits endpoints, the landing's trip and photo, the tour,
// Play's timing, and the hints that depend on what is on screen.
import {describe, expect, it} from 'vitest';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AlbumSummary, AssetColumns} from '../shared/api.ts';
import {REPO_URL, type DemoCredit} from '../shared/demo.ts';
import {ConfigError, configFromEnv} from '../server/config.ts';
import {acceptsGzip, DEFAULT_DEMO_TRIP, demoCredits, demoFlag, demoFromEnv, fileTitle, loadDemoCredits, type ManifestAsset} from '../server/demo.ts';
import {createApp} from '../server/app.ts';
import {ImmichClient} from '../server/immich.ts';
import {gunzipSync} from 'node:zlib';
import {loadManifest} from '../demo/stub.ts';
import {buildIndex} from '../web/src/lib/index/model.ts';
import {headerStatus} from '../web/src/lib/index/store.svelte.ts';
import {findTrip, representativeRow} from '../web/src/lib/demo/landing.ts';
import {markTourSeen, placeBubble, TOUR, TOUR_KEY, tourSeen} from '../web/src/lib/demo/tour.ts';
import {isPlayKey, PLAY, playDelay, playStart} from '../web/src/lib/map/play.ts';
import {noSelectionHint, overviewHint, railAlbums} from '../web/src/lib/overview/data.ts';
import {SHORTCUTS} from '../web/src/lib/shortcuts.ts';

const DAY = 86400e3, M = 60e3, T0 = Date.UTC(2024, 8, 6);

/** demoFromEnv with a recorded manifest path instead of reading the file. */
function demoWith(env: Record<string, string>, assets: ManifestAsset[] = []) {
  const paths: string[] = [];
  return {demo: demoFromEnv(env, p => { paths.push(p); return demoCredits(assets); }), paths};
}

describe('demo config (server/demo.ts)', () => {
  it('is off unless DEMO says so, and refuses values it can\'t read', () => {
    for (const v of [undefined, '', ' ', '0', 'false', 'no', 'OFF']) expect(demoFlag(v)).toBe(false);
    for (const v of ['1', 'true', 'Yes', ' on ']) expect(demoFlag(v)).toBe(true);
    expect(() => demoFlag('2')).toThrow(ConfigError);
    const off = demoWith({DEMO: '0'});
    expect(off.demo).toBeNull();
    expect(off.paths).toEqual([]); // nothing read
    expect(configFromEnv({DEMO: '1'}).demo).toBeNull(); // the core config knows nothing of it
  });

  it('carries the trip and the repository, and never an Immich link', () => {
    const {demo, paths} = demoWith({DEMO: '1'});
    expect(paths).toEqual(['demo/manifest.json']);
    expect(demo!.viewer(configFromEnv({IMMICH_PUBLIC_URL: 'https://photos.example.com'})))
      .toMatchObject({immichPublicUrl: null, demo: {trip: DEFAULT_DEMO_TRIP, repoUrl: REPO_URL}});
    const custom = demoWith({DEMO: '1', DEMO_TRIP: 'Alsace', REPO_URL: 'https://example.org/iv', DEMO_MANIFEST: '/data/manifest.json'});
    expect(custom.demo!.config).toEqual({trip: 'Alsace', repoUrl: 'https://example.org/iv'});
    expect(custom.paths).toEqual(['/data/manifest.json']);
    expect(() => demoWith({DEMO: '1', REPO_URL: 'example.org'})).toThrow(/REPO_URL/);
  });
});

describe('demo credits (server)', () => {
  const asset: ManifestAsset = {
    id: '00000000-0000-5000-8000-000000000001', kind: 'photo', title: 'File:Cases <Ramos>, Barcelona 01.jpg', author: 'Kent Wang',
    license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    commonsUrl: 'https://commons.wikimedia.org/wiki/File:Cases_Ramos,_Barcelona_01.jpg', takenAt: '2024-09-06T10:00:00.000Z',
    modifications: 'Resized copies. GPS removed for the demo.',
  };
  const immich = new ImmichClient({baseUrl: 'http://stub:2283', apiKey: 'demo', fetch: (async () => new Response('{}')) as typeof fetch});

  const demoApp = (assets: ManifestAsset[]) => {
    const {demo} = demoWith({DEMO: '1'}, assets);
    return createApp(immich, demo!.viewer(configFromEnv({})), demo!.routes);
  };

  it('serves one asset\'s attribution, cacheable, and 404s unknown ids', async () => {
    const app = demoApp([asset]);
    expect(await (await app.request('/api/config')).json()).toMatchObject({demo: {trip: DEFAULT_DEMO_TRIP}});
    const res = await app.request(`/api/demo/credits/${asset.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age');
    expect(await res.json()).toEqual({
      title: 'Cases <Ramos>, Barcelona 01', author: 'Kent Wang', license: 'CC BY-SA 4.0', licenseUrl: asset.licenseUrl,
      commonsUrl: asset.commonsUrl, modifications: asset.modifications,
    } satisfies DemoCredit);
    expect((await app.request('/api/demo/credits/00000000-0000-5000-8000-000000000002')).status).toBe(404);
    expect((await app.request('/api/demo/credits/nope')).status).toBe(400);
  });

  it('renders the full credits page with everything escaped', async () => {
    const app = demoApp([asset, {...asset, id: 'x', commonsUrl: 'javascript:alert(1)'}]);
    const res = await app.request('/credits');
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Cases &lt;Ramos&gt;, Barcelona 01');
    expect(html).not.toContain('<Ramos>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('All 2 items');
    // Gzipped for clients that take it (the real page is ~700 kB).
    const gz = await app.request('/credits', {headers: {'accept-encoding': 'gzip, br'}});
    expect(gz.headers.get('content-encoding')).toBe('gzip');
    expect(gunzipSync(Buffer.from(await gz.arrayBuffer())).toString()).toBe(html);
    const refused = await app.request('/credits', {headers: {'accept-encoding': 'gzip;q=0, identity'}});
    expect(refused.headers.get('content-encoding')).toBeNull();
  });

  it('negotiates gzip by its q value', () => {
    expect(acceptsGzip('gzip, deflate, br')).toBe(true);
    expect(acceptsGzip('br;q=1.0, gzip;q=0.8')).toBe(true);
    expect(acceptsGzip('gzip;q=0')).toBe(false);
    expect(acceptsGzip('gzip; q=0.000, *')).toBe(false);
    expect(acceptsGzip('*')).toBe(true);
    expect(acceptsGzip('*;q=0')).toBe(false);
    expect(acceptsGzip('identity')).toBe(false);
    expect(acceptsGzip(undefined)).toBe(false);
  });

  it('has no demo routes on a normal deployment', async () => {
    const app = createApp(immich, configFromEnv({}));
    expect((await app.request(`/api/demo/credits/${asset.id}`)).status).toBe(404);
    expect((await app.request('/credits')).status).toBe(404);
  });

  it('credits every asset of the real dataset, with http(s) links', () => {
    const m = loadManifest(), credits = demoCredits(m.assets);
    for (const a of m.assets) {
      const c = credits.get(a.id)!;
      expect(c.author).toBe('Kent Wang');
      expect(c.license).toMatch(/^CC BY(-SA)? 4\.0$/);
      expect(c.commonsUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(c.modifications.length).toBeGreaterThan(0);
    }
    expect(fileTitle('File:Statue of King Philip IV of Spain (Bernini) 02.jpg')).toBe('Statue of King Philip IV of Spain (Bernini) 02');
  });

  it('stops at startup when the manifest is missing or broken', () => {
    expect(() => loadDemoCredits('/nonexistent/manifest.json')).toThrow(ConfigError);
    const bad = join(mkdtempSync(join(tmpdir(), 'demo-credits-')), 'manifest.json');
    writeFileSync(bad, '{"assets": 3}');
    expect(() => loadDemoCredits(bad)).toThrow(/DEMO_MANIFEST/);
  });
});

/** Rows as [minutes after T0, has GPS, video, width/height]. */
function index(rows: [number, boolean, (0 | 1)?, number?][]) {
  const c: AssetColumns = {id: [], t: [], off: [], video: [], dur: [], lat: [], lon: [], thumbhash: [], ratio: [], city: [], country: []};
  rows.forEach(([min, gps, v, ratio], i) => {
    c.id.push(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    c.t.push(T0 + min * M); c.off.push(2); c.video.push(v ?? 0); c.dur.push(0);
    c.lat.push(gps ? 43 + i / 100 : null); c.lon.push(gps ? -2 : null); c.thumbhash.push(null); c.ratio.push(ratio ?? 1.5);
    c.city.push(null); c.country.push(null);
  });
  return buildIndex([c]);
}

describe('landing', () => {
  const album = (id: string, name: string, count: number): AlbumSummary =>
    ({id, name, start: T0, end: T0 + DAY, count, shared: false, version: '1'});
  const albums = railAlbums([album('a1', 'Pamplona & Basque Country, 2–12 Aug 2024', 120), album('a2', 'San Sebastián to Huesca, 6–10 Sep 2024', 194),
    album('a3', 'Lisbon & Queluz', 300)]);

  it('finds the trip by id or by a part of its name, ignoring case and accents', () => {
    expect(findTrip(albums, 'a1')?.id).toBe('a1');
    expect(findTrip(albums, 'san sebastian')?.id).toBe('a2');
    expect(findTrip(albums, DEFAULT_DEMO_TRIP)?.id).toBe('a2');
  });

  it('falls back to the biggest album, or nothing without albums', () => {
    expect(findTrip(albums, 'Atlantis')?.id).toBe('a3');
    expect(findTrip(albums, '')?.id).toBe('a3');
    expect(findTrip([], 'x')).toBeNull();
  });

  it('opens on a landscape photo with GPS near the middle of the trip', () => {
    // GPS photos at 0, 100, 200 (portrait), 210 (video), 220, 400 min: the middle of 0..400 is 200.
    const ix = index([[0, true], [100, true], [200, true, 0, 0.75], [210, true, 1], [220, true], [300, false], [400, true]]);
    expect(representativeRow(ix, 0, ix.n)).toBe(4);
    // Only portrait photos near the middle: the nearest one.
    expect(representativeRow(ix, 0, ix.n, 1)).toBe(2);
  });

  it('falls back to the first row without GPS photos, -1 for nothing', () => {
    const ix = index([[0, false], [10, true, 1], [20, false]]);
    expect(representativeRow(ix, 0, ix.n)).toBe(0);
    expect(representativeRow(ix, 1, 1)).toBe(-1);
  });

  it('the default trip is one of the demo albums', () => {
    const m = loadManifest();
    const a = m.albums.find(x => x.name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
      .includes(DEFAULT_DEMO_TRIP.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()));
    expect(a).toBeDefined();
  });
});

describe('tour', () => {
  it('has three steps: wave, time strip, card', () => {
    expect(TOUR.map(s => s.target)).toEqual(['canvas.main', '.strip .track', '.marker .card']);
  });

  it('puts the bubble below the target, above when there is no room, inside the viewport', () => {
    const b = {w: 300, h: 120};
    const below = placeBubble({x: 0, y: 100, w: 1400, h: 150}, b, 1440, 900);
    expect(below).toMatchObject({side: 'below', y: 262, x: 550}); // centred on the target's middle, x = 700
    expect(below.arrow).toBe(150);
    const above = placeBubble({x: 1300, y: 760, w: 120, h: 64}, b, 1440, 900);
    expect(above.side).toBe('above');
    expect(above.y).toBe(760 - 12 - 120);
    expect(above.x).toBe(1440 - 12 - 300); // clamped at the right edge
    expect(above.arrow).toBe(1360 - above.x);
    expect(placeBubble({x: 0, y: 0, w: 1440, h: 900}, b, 1440, 900).side).toBe('over');
    expect(placeBubble(null, b, 1440, 900)).toEqual({x: 570, y: 390, side: 'none', arrow: null});
  });

  it('is remembered once seen, and survives storage that throws', () => {
    const data = new Map<string, string>();
    const store = {getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v)};
    expect(tourSeen(store)).toBe(false);
    markTourSeen(store);
    expect(data.get(TOUR_KEY)).toBe('1');
    expect(tourSeen(store)).toBe(true);
    const broken = {getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceeded'); }};
    expect(tourSeen(broken)).toBe(false);
    expect(() => markTourSeen(broken)).not.toThrow();
    expect(tourSeen(null)).toBe(false);
  });
});

describe('Play', () => {
  it('lingers by how far away the next photo is, and evenly with reduced motion', () => {
    expect(playDelay(5e3, false)).toBe(PLAY.burstMs);
    expect(playDelay(20 * M, false)).toBe(PLAY.photoMs);
    expect(playDelay(PLAY.jumpGap, false)).toBe(PLAY.jumpMs);
    expect(playDelay(5e3, true)).toBe(PLAY.reducedMs);
    expect(playDelay(10 * 3600e3, true)).toBe(PLAY.reducedMs);
  });

  it('starts at the cursor, or from the first photo without one or at the end', () => {
    const ix = index([[0, true], [10, true], [20, false]]);
    expect(playStart(ix, 0, 3, null, -1)).toBe(0);
    expect(playStart(ix, 0, 3, T0 + 10 * M, 1)).toBe(-1);
    expect(playStart(ix, 0, 3, T0 + 5 * M, 0)).toBe(-1);
    expect(playStart(ix, 0, 3, T0 + 20 * M, 2)).toBe(0);
    expect(playStart(ix, 1, 3, T0 + 25 * M, 2)).toBe(1);
    expect(playStart(ix, 2, 2, null, -1)).toBeNull();
    // Two photos at the same instant: on the first, the second is still to come.
    const dup = index([[0, true], [10, true], [10, false]]);
    expect(playStart(dup, 0, 3, T0 + 10 * M, 1)).toBe(-1);
    expect(playStart(dup, 0, 3, T0 + 10 * M, 2)).toBe(0);
  });

  it('Space toggles it outside fields and controls, without modifiers or key repeat', () => {
    const ev = (over: Partial<Parameters<typeof isPlayKey>[0]> = {}) =>
      ({key: ' ', ctrlKey: false, altKey: false, metaKey: false, defaultPrevented: false, repeat: false, target: null, ...over});
    const on = (sel: string) => ({closest: (s: string) => (s.split(', ').includes(sel) ? {} : null)}) as unknown as EventTarget;
    expect(isPlayKey(ev())).toBe(true);
    expect(isPlayKey(ev({target: on('canvas')}))).toBe(true);
    for (const t of ['input', 'button', 'a', 'video', '[role="button"]', 'dialog']) expect(isPlayKey(ev({target: on(t)}))).toBe(false);
    expect(isPlayKey(ev({repeat: true}))).toBe(false);
    expect(isPlayKey(ev({ctrlKey: true}))).toBe(false);
    expect(isPlayKey(ev({key: 'Enter'}))).toBe(false);
    expect(SHORTCUTS.flatMap(g => g.items).some(s => s.keys.includes('Space'))).toBe(true);
  });
});

describe('hints', () => {
  it('mention the album bars only while some are on screen', () => {
    expect(overviewHint(true)).toBe('Drag across the timeline to pick dates · click a coloured bar below it to open an album');
    expect(overviewHint(false)).toBe('Drag across the timeline to pick dates');
    expect(noSelectionHint(true, 'Albums')).toBe('No selection: drag on the timeline, click an album bar, or pick from Albums');
    expect(noSelectionHint(false, 'Albums')).toBe('No selection: drag on the timeline or pick from Albums');
  });

  it('the demo\'s header keeps month counters out', () => {
    const s = {status: 'building' as const, phase: 'loading' as const, attempt: 0, progress: {done: 3, total: 33}, items: '', error: null};
    expect(headerStatus(s).shown).toBe('Loading 3/33 months');
    expect(headerStatus({...s, quiet: true}).shown).toBe('Loading…');
    expect(headerStatus({...s, quiet: true}).detail).toBe('Loading…');
  });
});
