// ThumbHash decoder (https://evanw.github.io/thumbhash/, MIT), ported from the sketch. Immich
// stores the hash base64-encoded; a decoded preview is ≤ 32×32 px, shown while a thumbnail loads.

export interface Rgba { w: number; h: number; rgba: Uint8ClampedArray }

/** Decodes a ThumbHash into RGBA pixels (≤ 32 px on the long side). */
export function thumbHashToRGBA(hash: Uint8Array): Rgba {
  const {PI, min, max, cos, round} = Math;
  const h24 = hash[0] | (hash[1] << 8) | (hash[2] << 16), h16 = hash[3] | (hash[4] << 8);
  const lDc = (h24 & 63) / 63, pDc = ((h24 >> 6) & 63) / 31.5 - 1, qDc = ((h24 >> 12) & 63) / 31.5 - 1;
  const lScale = ((h24 >> 18) & 31) / 31, hasAlpha = h24 >> 23;
  const pScale = ((h16 >> 3) & 63) / 63, qScale = ((h16 >> 9) & 63) / 63, isLandscape = h16 >> 15;
  const lx = max(3, isLandscape ? (hasAlpha ? 5 : 7) : h16 & 7), ly = max(3, isLandscape ? h16 & 7 : hasAlpha ? 5 : 7);
  const aDc = hasAlpha ? (hash[5] & 15) / 15 : 1, aScale = (hash[5] >> 4) / 15;
  const acStart = hasAlpha ? 6 : 5;
  let acIndex = 0;
  const dec = (nx: number, ny: number, scale: number) => {
    const ac: number[] = [];
    for (let cy = 0; cy < ny; cy++)
      for (let cx = cy ? 0 : 1; cx * ny < nx * (ny - cy); cx++)
        ac.push((((hash[acStart + (acIndex >> 1)] >> ((acIndex++ & 1) << 2)) & 15) / 7.5 - 1) * scale);
    return ac;
  };
  const lAc = dec(lx, ly, lScale), pAc = dec(3, 3, pScale * 1.25), qAc = dec(3, 3, qScale * 1.25);
  const aAc = hasAlpha ? dec(5, 5, aScale) : [];
  const ratio = thumbHashRatio(hash);
  const w = round(ratio > 1 ? 32 : 32 * ratio), h = round(ratio > 1 ? 32 / ratio : 32);
  const rgba = new Uint8ClampedArray(w * h * 4), fx: number[] = [], fy: number[] = [];
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
    let l = lDc, p = pDc, q = qDc, a = aDc;
    for (let cx = 0, n = max(lx, hasAlpha ? 5 : 3); cx < n; cx++) fx[cx] = cos(PI / w * (x + .5) * cx);
    for (let cy = 0, n = max(ly, hasAlpha ? 5 : 3); cy < n; cy++) fy[cy] = cos(PI / h * (y + .5) * cy);
    for (let cy = 0, j = 0; cy < ly; cy++) for (let cx = cy ? 0 : 1, f2 = fy[cy] * 2; cx * ly < lx * (ly - cy); cx++, j++) l += lAc[j] * fx[cx] * f2;
    for (let cy = 0, j = 0; cy < 3; cy++) for (let cx = cy ? 0 : 1, f2 = fy[cy] * 2; cx < 3 - cy; cx++, j++) {
      const f = fx[cx] * f2; p += pAc[j] * f; q += qAc[j] * f;
    }
    if (hasAlpha) for (let cy = 0, j = 0; cy < 5; cy++) for (let cx = cy ? 0 : 1, f2 = fy[cy] * 2; cx < 5 - cy; cx++, j++) a += aAc[j] * fx[cx] * f2;
    const b = l - 2 / 3 * p, r = (3 * l - b + q) / 2, g = r - q;
    rgba[i] = max(0, 255 * min(1, r)); rgba[i + 1] = max(0, 255 * min(1, g));
    rgba[i + 2] = max(0, 255 * min(1, b)); rgba[i + 3] = max(0, 255 * min(1, a));
  }
  return {w, h, rgba};
}

/** Width / height of the image the hash was made from (approximate). */
export function thumbHashRatio(hash: Uint8Array) {
  const hx = hash[3], ha = hash[2] & 0x80, hl = hash[4] & 0x80;
  return (hl ? (ha ? 5 : 7) : hx & 7) / (hl ? hx & 7 : ha ? 5 : 7);
}

export function base64Bytes(b64: string) {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const urls = new Map<string, string>();
const MAX_URLS = 512;

/** A PNG data URL of the hash's preview, for CSS backgrounds / <img>; cached (LRU). Browser only. */
export function thumbHashDataUrl(b64: string | null | undefined): string | null {
  if (!b64) return null;
  const hit = urls.get(b64);
  if (hit) { urls.delete(b64); urls.set(b64, hit); return hit; }
  let url: string;
  try {
    const {w, h, rgba} = thumbHashToRGBA(base64Bytes(b64));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    // CPU-backed canvas: toDataURL on a GPU one costs ~27 ms per hash in a readback.
    c.getContext('2d', {willReadFrequently: true})!.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
    url = c.toDataURL();
  } catch {
    return null; // malformed hash
  }
  urls.set(b64, url);
  if (urls.size > MAX_URLS) urls.delete(urls.keys().next().value!);
  return url;
}
