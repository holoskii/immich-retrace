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
  build: {outDir, emptyOutDir: true},
  server: {proxy: {'/api': 'http://localhost:8080'}},
  test: {root: '.', include: ['tests/**/*.test.ts']},
});
