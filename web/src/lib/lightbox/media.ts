// Media URLs for the viewer's own relay (server/app.ts). The deployment config lives in config.svelte.ts.
export {getConfig} from '../config.svelte.ts';

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
