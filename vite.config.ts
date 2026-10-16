import {defineConfig} from 'vitest/config';
import {svelte} from '@sveltejs/vite-plugin-svelte';
import {fileURLToPath} from 'node:url';
import {precompressDir} from './server/precompress.ts';

const outDir = fileURLToPath(new URL('./dist/web', import.meta.url));

export default defineConfig({
  root: 'web',
  plugins: [svelte(), {
    // .br/.gz copies of the build for server/static.ts.
    name: 'precompress', apply: 'build',
    async closeBundle() { await precompressDir(outDir); },
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
