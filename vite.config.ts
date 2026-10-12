import {defineConfig} from 'vitest/config';
import {svelte} from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  root: 'web',
  plugins: [svelte()],
  build: {outDir: '../dist/web', emptyOutDir: true},
  server: {proxy: {'/api': 'http://localhost:8080'}},
  test: {root: '.', include: ['tests/**/*.test.ts']},
});
