// GET /api/config, once per page, for everything in the browser that depends on the deployment
// (map style, "Open in Immich", demo mode). `config.value` is null until it has arrived.
import {DEFAULT_MAP_STYLE_URL, type ViewerConfig} from '../../../shared/api.ts';

/** What the app assumes when the config can't be fetched: the default style, no Immich link, not a demo. */
export const FALLBACK_CONFIG: ViewerConfig = {mapStyleUrl: DEFAULT_MAP_STYLE_URL, immichPublicUrl: null, demo: null};

class ConfigStore {
  value = $state.raw<ViewerConfig | null>(null);
  /** Demo mode settings; null on a normal deployment (and until the config is in). */
  get demo() { return this.value?.demo ?? null; }
}

export const config = new ConfigStore();

let pending: Promise<ViewerConfig> | undefined;

/** The config, fetched once; a failure falls back to FALLBACK_CONFIG and is tried again on the next call. */
export function getConfig(): Promise<ViewerConfig> {
  pending ??= fetch('/api/config')
    .then(r => (r.ok ? (r.json() as Promise<ViewerConfig>) : Promise.reject(new Error(`config ${r.status}`))))
    .then(c => (config.value = {...FALLBACK_CONFIG, ...c}))
    .catch(e => { console.warn('config:', e); pending = undefined; return FALLBACK_CONFIG; });
  return pending;
}
