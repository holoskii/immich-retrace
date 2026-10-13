// Media URLs for the viewer's own relay (server/app.ts) and the deployment config.
import type {ViewerConfig} from '../../../../shared/api.ts';

/**
 * Thumbnail/preview URL. With a thumbhash the URL is versioned (`c`, like Immich's own web UI) and the
 * relay lets the browser cache it for good; a changed image gets a new thumbhash, so a new URL.
 */
export function thumbUrl(id: string, thumbhash: string | null | undefined, size: 'thumbnail' | 'preview' = 'thumbnail') {
  const q = new URLSearchParams({size});
  if (thumbhash) q.set('c', thumbhash);
  return `/api/assets/${id}/thumbnail?${q}`;
}

/** Playback URL (Range supported). Immich serves the transcode, or the original when there is none. */
export const videoUrl = (id: string) => `/api/assets/${id}/video`;

/** The asset in Immich's web UI; null without a configured public URL. */
export function immichLink(base: string | null | undefined, id: string) {
  return base ? `${base.replace(/\/+$/, '')}/photos/${id}` : null;
}

export const DEFAULT_STYLE = 'https://tiles.immich.cloud/v1/style/dark.json';
let config: Promise<ViewerConfig> | undefined;

/** GET /api/config, once per page; falls back to the default style and no Immich link. */
export function getConfig(): Promise<ViewerConfig> {
  config ??= fetch('/api/config')
    .then(r => (r.ok ? (r.json() as Promise<ViewerConfig>) : Promise.reject(new Error(`config ${r.status}`))))
    .catch(e => { console.warn('config:', e); config = undefined; return {mapStyleUrl: DEFAULT_STYLE, immichPublicUrl: null}; });
  return config;
}
