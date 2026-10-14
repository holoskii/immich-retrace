import {DEFAULT_MAP_STYLE_URL} from '../shared/api.ts';
import type {ViewerConfig} from '../shared/api.ts';

export {DEFAULT_MAP_STYLE_URL};

/** A setting is missing or malformed; main.ts prints the message as a one-line usage hint. */
export class ConfigError extends Error {}

export interface ServerSettings {
  /** Immich's base URL, normalized (no trailing slash); the server adds `/api`. */
  immichUrl: string;
  apiKey: string;
  port: number;
  webDir: string;
  viewer: ViewerConfig;
}

/** Everything the server needs from the environment; empty values count as unset. */
export function settingsFromEnv(env: Record<string, string | undefined>): ServerSettings {
  const required = (name: string) => {
    const v = env[name]?.trim();
    if (!v) throw new ConfigError(`${name} is not set`);
    return v;
  };
  const portText = env.PORT?.trim() || '8080';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || port < 1 || port > 65535) throw new ConfigError(`PORT must be a port number, got "${portText}"`);
  return {
    immichUrl: parseImmichUrl(required('IMMICH_URL')),
    apiKey: required('IMMICH_API_KEY'),
    port,
    webDir: env.WEB_DIR?.trim() || 'dist/web',
    viewer: configFromEnv(env),
  };
}

/**
 * IMMICH_URL is Immich's base URL as the server reaches it, e.g. http://immich-server:2283 or
 * https://photos.example.com/immich. A scheme is required, and a trailing /api is refused rather
 * than stripped: the server appends /api itself, and the fix belongs in the config.
 */
export function parseImmichUrl(raw: string): string {
  let u: URL | null = null;
  try { u = new URL(raw); } catch { /* reported below */ }
  // `immich-server:2283` parses as scheme "immich-server:", so check the scheme, not just parsing.
  if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:'))
    throw new ConfigError(`IMMICH_URL must start with http:// or https://, e.g. http://immich-server:2283 (got "${raw}")`);
  if (u.search || u.hash) throw new ConfigError(`IMMICH_URL must not have a query or fragment (got "${raw}")`);
  const path = u.pathname.replace(/\/+$/, '');
  if (/\/api$/i.test(path))
    throw new ConfigError(`IMMICH_URL must be Immich's base URL without /api: use ${u.origin}${path.slice(0, -4)} (got "${raw}")`);
  return u.origin + path;
}

/** Browser-facing settings from the environment; empty values count as unset. */
export function configFromEnv(env: Record<string, string | undefined>): ViewerConfig {
  const opt = (name: string) => env[name]?.trim() || null;
  const url = (name: string, v: string | null) => {
    if (v !== null && !/^https?:\/\//.test(v)) throw new ConfigError(`${name} must be an http(s) URL (got "${v}")`);
    return v;
  };
  return {
    mapStyleUrl: url('MAP_STYLE_URL', opt('MAP_STYLE_URL')) ?? DEFAULT_MAP_STYLE_URL,
    immichPublicUrl: url('IMMICH_PUBLIC_URL', opt('IMMICH_PUBLIC_URL'))?.replace(/\/+$/, '') ?? null,
  };
}
