// The map's chunk (MapView + MapLibre, ~300 kB gz, and its worker), started once at boot by main.ts and
// shared by whichever shell mounts the map. Nothing here may import maplibre-gl.

/** This browser can't run MapLibre (no WebGL 2): the map chunk isn't even downloaded. */
export class NoWebGL extends Error {
  constructor() { super('WebGL 2 is not available'); this.name = 'NoWebGL'; }
}

/** Whether a WebGL 2 context can be made; the probe's context is released at once (browsers cap live contexts). */
export function hasWebGL2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

let chunk: Promise<typeof import('./MapView.svelte')> | undefined;

/** MapView's chunk, fetched once (a failed fetch is tried again on the next call); rejects with NoWebGL without WebGL 2. */
export function loadMapView() {
  return (chunk ??= hasWebGL2()
    ? import('./MapView.svelte').catch(e => { chunk = undefined; throw e; })
    : Promise.reject(new NoWebGL()));
}
