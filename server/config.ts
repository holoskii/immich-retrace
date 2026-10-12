import type {ViewerConfig} from '../shared/api.ts';

export const DEFAULT_MAP_STYLE_URL = 'https://tiles.immich.cloud/v1/style/dark.json';

/** Browser-facing settings from the environment; empty values count as unset. */
export function configFromEnv(env: Record<string, string | undefined>): ViewerConfig {
  const opt = (name: string) => env[name]?.trim() || null;
  const url = (name: string, v: string | null) => {
    if (v !== null && !/^https?:\/\//.test(v)) throw new Error(`${name} must be an http(s) URL`);
    return v;
  };
  return {
    mapStyleUrl: url('MAP_STYLE_URL', opt('MAP_STYLE_URL')) ?? DEFAULT_MAP_STYLE_URL,
    immichPublicUrl: url('IMMICH_PUBLIC_URL', opt('IMMICH_PUBLIC_URL'))?.replace(/\/+$/, '') ?? null,
  };
}
