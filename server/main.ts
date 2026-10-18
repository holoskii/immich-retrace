import {serve} from '@hono/node-server';
import {createApp} from './app.ts';
import {ImmichClient} from './immich.ts';
import {ConfigError, settingsFromEnv} from './config.ts';
import {demoFromEnv} from './demo.ts';
import {logSelfCheck} from './selfcheck.ts';
import {staticFiles} from './static.ts';

// A bad setting is one line on stderr, not a stack trace.
function startup<T>(f: () => T): T {
  try {
    return f();
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`immich-retrace: ${err.message}. Usage: IMMICH_URL=http://immich-server:2283 IMMICH_API_KEY=… node server/main.ts (see README.md, Configuration).`);
    process.exit(1);
  }
}
const settings = startup(() => settingsFromEnv(process.env));
// The public demo (DEMO=1) only; null otherwise. Everything it changes is in server/demo.ts.
const demo = startup(() => demoFromEnv(process.env));

// The demo's errors name no internal address (the stub's compose name).
const immich = new ImmichClient({baseUrl: settings.immichUrl, apiKey: settings.apiKey, publicName: demo ? 'the demo backend' : undefined});
const app = createApp(immich, demo ? demo.viewer(settings.viewer, immich) : settings.viewer, demo?.routes);
app.use('/*', staticFiles(settings.webDir));

serve({fetch: app.fetch, port: settings.port}, () => {
  console.log(`immich-retrace listening on :${settings.port}, Immich at IMMICH_URL=${settings.immichUrl}${demo ? ' (demo mode)' : ''}`);
  // Not awaited: a sleeping or unreachable Immich must not hold up serving the app.
  void logSelfCheck(immich);
});
