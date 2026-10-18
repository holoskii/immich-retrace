// A place selection's geometry: the circle around a map cluster's photos, which library rows fall inside it, and
// its URL form (`near=<lat>,<lon>,<radius m>`). Pure, no store imports, so it is unit-tested directly.
import type {IndexColumns} from './index/model.ts';
import {haversineKm} from './map/route.ts';

/** A circle on the globe: centre in degrees, radius in whole metres. */
export interface Circle { lat: number; lon: number; r: number }

const M_PER_DEG = 111_320;
/** Centre to 5 decimals (~1 m), so a selection made in memory equals the one its URL reads back to. */
const round5 = (x: number) => Math.round(x * 1e5) / 1e5;

/** Metres between two points. */
export const distM = (lat1: number, lon1: number, lat2: number, lon2: number) => haversineKm(lat1, lon1, lat2, lon2) * 1000;

/**
 * The smallest circle around `pts` ([lat, lon] pairs): Welzl's minimum enclosing circle on a local equirectangular
 * plane, its centre rounded to 5 decimals, the radius then measured on the sphere from that rounded centre to the
 * farthest point plus 1 m (rounding, float noise), in whole metres up. Every point is inside by construction; the
 * smallest circle takes in as few photos of neighbouring clusters as possible. Null without points.
 */
export function enclosingCircle(pts: [number, number][]): Circle | null {
  const n = pts.length;
  if (!n) return null;
  let lat0 = 0;
  for (const p of pts) lat0 += p[0];
  lat0 /= n;
  const kx = M_PER_DEG * Math.cos(lat0 * Math.PI / 180), ky = M_PER_DEG;
  // Longitudes unwrapped around the first point: a cluster across the antimeridian stays one small patch.
  const lon0 = pts[0][1], unwrap = (lon: number) => lon0 + wrap(lon - lon0);
  // The points in a fixed shuffled order (Welzl's expected O(n) needs a random order; sorted input is its worst case).
  const xy = pts.map(p => [unwrap(p[1]) * kx, p[0] * ky] as [number, number]);
  let seed = 1;
  for (let i = n - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [xy[i], xy[j]] = [xy[j], xy[i]];
  }
  const c = mec(xy);
  const lat = round5(c.y / ky), lon = round5(wrap(c.x / kx));
  let far = 0;
  for (const p of pts) far = Math.max(far, distM(lat, lon, p[0], p[1]));
  return {lat, lon, r: Math.ceil(far + 1)};
}

/** Longitude into [-180, 180). */
const wrap = (lon: number) => ((lon + 540) % 360) - 180;

interface C { x: number; y: number; r: number }
const EPS = 1e-7;
const inside = (c: C, p: [number, number]) => Math.hypot(p[0] - c.x, p[1] - c.y) <= c.r * (1 + EPS) + 1e-6;
const two = (a: [number, number], b: [number, number]): C => ({x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, r: Math.hypot(a[0] - b[0], a[1] - b[1]) / 2});
function three(a: [number, number], b: [number, number], c: [number, number]): C {
  const bx = b[0] - a[0], by = b[1] - a[1], cx = c[0] - a[0], cy = c[1] - a[1], d = 2 * (bx * cy - by * cx);
  // Collinear: the circle on the two points furthest apart.
  if (Math.abs(d) < 1e-12) { const s = [two(a, b), two(a, c), two(b, c)]; return s.reduce((m, x) => (x.r > m.r ? x : m)); }
  const b2 = bx * bx + by * by, c2 = cx * cx + cy * cy, x = (cy * b2 - by * c2) / d, y = (bx * c2 - cx * b2) / d;
  return {x: a[0] + x, y: a[1] + y, r: Math.hypot(x, y)};
}
/** Minimum enclosing circle (Welzl, iterative). */
function mec(p: [number, number][]): C {
  let c: C = {x: p[0][0], y: p[0][1], r: 0};
  for (let i = 1; i < p.length; i++) {
    if (inside(c, p[i])) continue;
    c = {x: p[i][0], y: p[i][1], r: 0};
    for (let j = 0; j < i; j++) {
      if (inside(c, p[j])) continue;
      c = two(p[i], p[j]);
      for (let k = 0; k < j; k++) if (!inside(c, p[k])) c = three(p[i], p[j], p[k]);
    }
  }
  return c;
}

/**
 * Rows of `ix` in [t0, t1) (exclusive t1, as selections) with GPS inside `c`, ascending. A degree box around the
 * circle skips most rows before the exact distance; rows without GPS are never in a place.
 */
export function placeRows(ix: IndexColumns, c: Circle, t0: number, t1: number): Int32Array {
  const lo = lowerBound(ix.t, t0), hi = lowerBound(ix.t, t1);
  // A loose box (a degree of latitude is ~111.2 km on the haversine sphere; longitude degrees shrink toward the
  // circle's poleward edge). Near a pole, or for a circle wider than the box can say, every longitude is checked.
  const dLat = c.r / 111_000 * 1.01, cos = Math.cos(Math.min(90, Math.abs(c.lat) + dLat) * Math.PI / 180);
  const dLon = cos > 1e-3 ? dLat / cos : 360;
  const out: number[] = [];
  for (let r = lo; r < hi; r++) {
    if (!ix.gps[r]) continue;
    const la = ix.lat[r], lo2 = ix.lon[r];
    if (Math.abs(la - c.lat) > dLat) continue;
    // Longitude difference across the antimeridian.
    const dl = Math.abs(((lo2 - c.lon + 540) % 360) - 180);
    if (dLon < 180 && dl > dLon) continue;
    if (distM(c.lat, c.lon, la, lo2) <= c.r) out.push(r);
  }
  return Int32Array.from(out);
}

function lowerBound(a: Float64Array, x: number, lo = 0, hi = a.length) {
  while (lo < hi) { const m = (lo + hi) >>> 1; if (a[m] < x) lo = m + 1; else hi = m; }
  return lo;
}

/** `near=` value: "lat,lon,radius". */
export const nearParam = (c: Circle) => `${c.lat},${c.lon},${c.r}`;

/** Reads `near=`: lat in ±90, lon in ±180 (both to 5 decimals), a whole positive radius in metres; else null. */
export function parseNear(s: string | null): Circle | null {
  const m = s?.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+)$/);
  if (!m) return null;
  const lat = round5(Number(m[1])), lon = round5(Number(m[2])), r = Number(m[3]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && r > 0 && r <= 2e7 ? {lat, lon, r} : null;
}

/** "350 m", "1.2 km", "37 km". */
export function fRadius(m: number) {
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}
