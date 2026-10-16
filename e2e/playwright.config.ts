// Phone e2e against the local demo: the Immich stub (demo/stub.ts, sample media in demo/data/media) and the viewer
// in demo mode on the current build. Run from the project root: `npm --prefix e2e test` (setup once: e2e/setup.sh).
import {defineConfig, devices} from '@playwright/test';
import {fileURLToPath} from 'node:url';

// The browsers e2e/setup.sh installed, wherever the run starts from (workers inherit this).
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL('./.browsers', import.meta.url));

const PORT = Number(process.env.E2E_PORT ?? 8092), STUB = Number(process.env.E2E_STUB_PORT ?? 2293);
/** E2E_REUSE=1: use a stub and viewer already listening on those ports (not rebuilt). */
const REUSE = process.env.E2E_REUSE === '1';

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure'},
  projects: [
    {name: 'Pixel 7', use: {...devices['Pixel 7']}, testIgnore: /desktop/},
    {name: 'iPhone 15', use: {...devices['iPhone 15']}, testIgnore: /desktop/},
    // A mouse desktop keeps the G-B lightbox.
    {name: 'Desktop Chrome', use: {...devices['Desktop Chrome']}, testMatch: /desktop/},
  ],
  webServer: [
    {
      command: `STUB_PORT=${STUB} node demo/stub.ts`, cwd: '..', port: STUB, reuseExistingServer: REUSE,
      stdout: 'ignore', stderr: 'pipe',
    },
    {
      // Built first, so the suite always runs the working tree.
      command: `npm run build >/dev/null && DEMO=1 IMMICH_URL=http://localhost:${STUB} IMMICH_API_KEY=demo PORT=${PORT} node server/main.ts`,
      cwd: '..', port: PORT, reuseExistingServer: REUSE, timeout: 120_000, stdout: 'ignore', stderr: 'pipe',
    },
  ],
});
