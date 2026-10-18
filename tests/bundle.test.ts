// Budget and hygiene of the phone path, read from the last build (vite.config.ts writes dist/bundle-graph.json: every
// chunk with its modules, static and dynamic imports and CSS). Run after `npm run build`; without a build the suite
// is skipped with a note (a fresh checkout's `npm test` must not fail on it).
//  - The phone's eager graph (the entry and the phone shell with their static imports and CSS) stays ≤ 60 kB gz:
//    everything that blocks the first paint of the phone shell (docs/mobile/07-web-platform.md §1).
//  - Nothing the phone can load (the shell, the map, the touch lightbox, the demo) imports overview/ or the
//    desktop-only modules; the desktop shell App.svelte is the only way there.
import {existsSync, readFileSync, statSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const DIST = fileURLToPath(new URL('../dist/web/', import.meta.url));
const GRAPH = fileURLToPath(new URL('../dist/bundle-graph.json', import.meta.url));
const PHONE_SHELL = 'web/src/lib/mobile/MobileShell.svelte';
const DESKTOP_SHELL = 'web/src/App.svelte';
const BUDGET_GZ = 60 * 1024;

interface Chunk { entry: boolean; facade: string | null; imports: string[]; dynamicImports: string[]; css: string[]; modules: string[] }
const built = existsSync(GRAPH);
if (!built) console.warn('tests/bundle.test.ts: skipped, no build (dist/bundle-graph.json); run `npm run build` first');

describe.skipIf(!built)('phone bundle (from the last build)', () => {
  const chunks = built ? (JSON.parse(readFileSync(GRAPH, 'utf8')) as {chunks: Record<string, Chunk>}).chunks : {};
  const byFacade = (f: string) => Object.entries(chunks).find(([, c]) => c.facade === f)?.[0];
  const entry = Object.entries(chunks).find(([, c]) => c.entry)?.[0];

  /** Chunks reachable from `roots` through static imports (and dynamic ones with `dynamic`), never entering `stop`. */
  function closure(roots: string[], dynamic: boolean, stop = new Set<string>()) {
    const seen = new Set<string>(), todo = [...roots];
    while (todo.length) {
      const f = todo.pop()!;
      if (seen.has(f) || stop.has(f) || !chunks[f]) continue;
      seen.add(f);
      todo.push(...chunks[f].imports, ...(dynamic ? chunks[f].dynamicImports : []));
    }
    return seen;
  }
  const modulesOf = (files: Set<string>) => [...files].flatMap(f => chunks[f].modules);
  const gz = (file: string) => gzipSync(readFileSync(DIST + file)).length;

  it('has the entry and both shells as chunks', () => {
    expect(entry).toBeTruthy();
    expect(byFacade(PHONE_SHELL)).toBeTruthy();
    expect(byFacade(DESKTOP_SHELL)).toBeTruthy();
    // The graph belongs to the files on disk (not a stale graph next to a newer build).
    for (const f of Object.keys(chunks)) expect(existsSync(DIST + f), f).toBe(true);
    expect(statSync(GRAPH).mtimeMs).toBeGreaterThanOrEqual(statSync(DIST + 'index.html').mtimeMs - 60_000);
  });

  it('keeps the phone entry (entry + phone shell, static imports and CSS) within 60 kB gz', () => {
    const files = closure([entry!, byFacade(PHONE_SHELL)!], false);
    const css = new Set([...files].flatMap(f => chunks[f].css));
    const total = [...files, ...css].reduce((n, f) => n + gz(f), 0);
    console.info(`phone entry: ${(total / 1024).toFixed(1)} kB gz in ${files.size} chunks + ${css.size} CSS`);
    expect(total).toBeLessThanOrEqual(BUDGET_GZ);
  });

  it('loads no overview/ or desktop-only module on the phone path', () => {
    // The desktop's G-B lightbox (with MiniMap, a second WebGL context) is a lazy chunk the phone shell never asks for
    // (it mounts the controller with `touch`), like the desktop shell.
    const desktop = [byFacade(DESKTOP_SHELL)!, byFacade('web/src/lib/lightbox/LightboxView.svelte')!];
    // Eager: the entry and the phone shell, static imports only.
    const eager = modulesOf(closure([entry!, byFacade(PHONE_SHELL)!], false));
    expect(eager.filter(m => /\/overview\/|\/shortcuts\.ts$|\/Help\.svelte$|\/inset\.ts$|LightboxView|MiniMap/.test(m))).toEqual([]);
    // Anything the phone can load later (map, touch lightbox, demo chunks): all but those desktop chunks.
    const lazy = modulesOf(closure([entry!], true, new Set(desktop)));
    expect(lazy.some(m => m.endsWith('MobileShell.svelte'))).toBe(true);
    expect(lazy.filter(m => /\/overview\//.test(m) || m.endsWith('MiniMap.svelte'))).toEqual([]);
  });
});
