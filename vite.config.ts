import {defineConfig} from 'vitest/config';
import {svelte} from '@sveltejs/vite-plugin-svelte';
import {writeFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {precompressDir} from './server/precompress.ts';

const outDir = fileURLToPath(new URL('./dist/web', import.meta.url));
const root = fileURLToPath(new URL('.', import.meta.url));
/** The build's chunk graph with the modules in each chunk, for tests/bundle.test.ts; outside dist/web, so never served. */
export const GRAPH_FILE = fileURLToPath(new URL('./dist/bundle-graph.json', import.meta.url));

export default defineConfig({
  root: 'web',
  plugins: [svelte(), {
    // .br/.gz copies of the build for server/static.ts.
    name: 'precompress', apply: 'build',
    async closeBundle() { await precompressDir(outDir); },
  }, {
    name: 'bundle-graph', apply: 'build',
    writeBundle(_, bundle) {
      const chunks: Record<string, unknown> = {};
      for (const c of Object.values(bundle)) {
        if (c.type !== 'chunk') continue;
        chunks[c.fileName] = {
          entry: c.isEntry, facade: c.facadeModuleId ? relative(root, c.facadeModuleId) : null,
          imports: c.imports, dynamicImports: c.dynamicImports, css: [...(c.viteMetadata?.importedCss ?? [])],
          modules: c.moduleIds.map(m => relative(root, m)),
        };
      }
      writeFileSync(GRAPH_FILE, JSON.stringify({chunks}, null, 1));
    },
  }],
  build: {
    outDir, emptyOutDir: true,
    // MapLibre is one lazy chunk shared by MapView and the lightbox mini-map (main.ts starts it at
    // boot, map/load.ts); named, rather than after whichever module rolldown picks first.
    rolldownOptions: {output: {codeSplitting: {groups: [{name: 'maplibre', test: /node_modules[\\/]maplibre-gl[\\/]/}]}}},
    chunkSizeWarningLimit: 1100,
  },
  server: {proxy: {'/api': 'http://localhost:8080'}},
  test: {root: '.', include: ['tests/**/*.test.ts']},
});
