import {serve} from '@hono/node-server';
import {serveStatic} from '@hono/node-server/serve-static';
import {createApp} from './app.ts';
import {ImmichClient} from './immich.ts';
import {configFromEnv} from './config.ts';

const env = (name: string, fallback?: string) => {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing environment variable ${name}`);
  return v;
};

const app = createApp(new ImmichClient({baseUrl: env('IMMICH_URL'), apiKey: env('IMMICH_API_KEY')}), configFromEnv(process.env));
// Static files only; a missing file is a 404. An SPA fallback comes when the UI has routes.
app.use('/*', serveStatic({root: env('WEB_DIR', 'dist/web')}));

const port = Number(env('PORT', '8080'));
serve({fetch: app.fetch, port}, () => console.log(`immich-viewer listening on :${port}`));
