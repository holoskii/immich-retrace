import {serve} from '@hono/node-server';
import {createApp} from './app.ts';
import {ImmichClient} from './immich.ts';
import {ConfigError, settingsFromEnv} from './config.ts';
import {logSelfCheck} from './selfcheck.ts';
import {staticFiles} from './static.ts';

// A bad setting is one line on stderr, not a stack trace.
const settings = (() => {
  try {
    return settingsFromEnv(process.env);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`immich-viewer: ${err.message}. Usage: IMMICH_URL=http://immich-server:2283 IMMICH_API_KEY=… node server/main.ts (see README.md, Configuration).`);
    process.exit(1);
  }
})();

const immich = new ImmichClient({baseUrl: settings.immichUrl, apiKey: settings.apiKey});
const app = createApp(immich, settings.viewer);
app.use('/*', staticFiles(settings.webDir));

serve({fetch: app.fetch, port: settings.port}, () => {
  console.log(`immich-viewer listening on :${settings.port}, Immich at IMMICH_URL=${settings.immichUrl}`);
  // Not awaited: a sleeping or unreachable Immich must not hold up serving the app.
  void logSelfCheck(immich);
});
