// Builds the demo dataset. See demo/README.md.
//
//   node demo/fetch.ts            media only: download the previews listed in demo/manifest.json, make
//                                 the thumbnails and render the clips (no Commons API calls); the
//                                 manifest is not changed
//   node demo/fetch.ts --refresh  list the uploads via the Commons API (cached in demo/data/cache),
//                                 rebuild demo/manifest.json and demo/CREDITS.md, then the media
//
// Media lands in demo/data/media/<asset id>/{thumbnail.jpg,preview.jpg,video.mp4} (gitignored).

import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {rgbaToThumbHash} from 'thumbhash';
import {cleanUrl, download, listUploads, type CommonsPage} from './commons.ts';
import * as cfg from './config.ts';
import {exifWallMs, gpsUtcMs, hashUnit, nameUuid, offsetFromGps, type DemoAlbum, type DemoAsset, type DemoManifest} from './manifest.ts';

const DEMO = new URL('.', import.meta.url).pathname;
const MANIFEST = join(DEMO, 'manifest.json');
const CREDITS = join(DEMO, 'CREDITS.md');
const CACHE = join(DEMO, 'data/cache/api');
export const MEDIA = join(DEMO, 'data/media');

export const RESIZED = `Resized copies (${cfg.THUMB_WIDTH} px and ${cfg.PREVIEW_WIDTH} px wide) of the Commons file; original not redistributed.`;

// ---------------------------------------------------------------------------------- images

/** Decodes an image (ffmpeg → PAM) scaled to fit max×max. */
function rgba(file: string, max = 100): {w: number; h: number; data: Uint8Array} {
  const out = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1',
    '-vf', `scale=w=${max}:h=${max}:force_original_aspect_ratio=decrease`, '-f', 'image2pipe', '-c:v', 'pam', '-pix_fmt', 'rgba', '-'],
  {maxBuffer: 1 << 24});
  const end = out.indexOf('ENDHDR\n');
  const header = out.subarray(0, end).toString('latin1');
  const w = Number(header.match(/WIDTH (\d+)/)?.[1]), h = Number(header.match(/HEIGHT (\d+)/)?.[1]);
  const data = out.subarray(end + 7, end + 7 + w * h * 4);
  if (!w || !h || data.length !== w * h * 4) throw new Error(`could not decode ${file}`);
  return {w, h, data: new Uint8Array(data)};
}

export function thumbhashOf(file: string): {hash: string; ratio: number} {
  const {w, h, data} = rgba(file);
  return {hash: Buffer.from(rgbaToThumbHash(w, h, data)).toString('base64'), ratio: w / h};
}

function ffmpeg(args: string[], out: string) {
  const tmp = out.replace(/(\.\w+)$/, '.part$1');
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, tmp], {stdio: ['ignore', 'inherit', 'inherit']});
  renameSync(tmp, out);
}

/**
 * The thumbnail: first frame of `src` (preview copy or clip) scaled to THUMB_WIDTH wide, never up.
 * Made locally because THUMB_WIDTH is not a standard Commons scaler width.
 */
export function makeThumbnail(src: string, out: string) {
  ffmpeg(['-i', src, '-frames:v', '1', '-vf', `scale='min(${cfg.THUMB_WIDTH},iw)':-2`, '-q:v', '4'], out);
}

// ---------------------------------------------------------------------------------- places

const km = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const r = Math.PI / 180, x = (lon2 - lon1) * r * Math.cos((lat1 + lat2) / 2 * r), y = (lat2 - lat1) * r;
  return 6371 * Math.hypot(x, y);
};

function place(lat: number | null, lon: number | null): {city: string | null; country: string | null} {
  if (lat === null || lon === null) return {city: null, country: null};
  let best: (typeof cfg.PLACES)[number] | null = null, bestKm = Infinity;
  for (const p of cfg.PLACES) { const d = km(lat, lon, p[2], p[3]); if (d < bestKm) { best = p; bestKm = d; } }
  return {city: best && bestKm <= cfg.CITY_KM ? best[0] : null, country: best && bestKm <= cfg.COUNTRY_KM ? best[1] : null};
}

// ---------------------------------------------------------------------------------- listing

interface Candidate {
  page: CommonsPage;
  license: keyof typeof cfg.LICENSES;
  localWall: number;
  gpsUtc: number | null;
  lat: number | null;
  lon: number | null;
}

/** Commons files → photo assets (without thumbhash yet), with offsets and GPS modifications applied. */
function buildPhotos(pages: CommonsPage[]): {assets: DemoAsset[]; skipped: Record<string, number>} {
  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  const cands: Candidate[] = [];
  for (const page of pages) {
    const ii = page.imageinfo?.[0];
    if (!ii) { skip('no imageinfo'); continue; }
    if (ii.mime !== 'image/jpeg') { skip(`mime ${ii.mime}`); continue; }
    const license = ii.extmetadata?.LicenseShortName?.value;
    if (license !== 'CC BY 4.0' && license !== 'CC BY-SA 4.0') { skip(`license ${license}`); continue; }
    const md = Object.fromEntries((ii.metadata ?? []).map(m => [m.name, m.value]));
    const localWall = exifWallMs(md.DateTimeOriginal);
    if (localWall === null) { skip('no EXIF capture time'); continue; }
    const lat = typeof md.GPSLatitude === 'number' ? md.GPSLatitude : null;
    const lon = typeof md.GPSLongitude === 'number' ? md.GPSLongitude : null;
    const ok = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
    cands.push({page, license, localWall, gpsUtc: gpsUtcMs(md.GPSDateStamp, md.GPSTimeStamp), lat: ok ? lat : null, lon: ok ? lon : null});
  }
  cands.sort((a, b) => a.localWall - b.localWall || a.page.title.localeCompare(b.page.title));

  // Offset from this file's GPS stamp; else the nearest file in (local) time that has one, within 36 h;
  // else the Central European rule (all his places are CET except Portugal, which has GPS stamps).
  const own = cands.map(c => c.gpsUtc === null ? null : offsetFromGps(c.localWall, c.gpsUtc));
  const offsets = cands.map((c, i): [number, DemoAsset['offsetSource']] => {
    if (own[i] !== null) return [own[i]!, 'gps'];
    let best = -1;
    for (let j = 0; j < cands.length; j++)
      if (own[j] !== null && (best < 0 || Math.abs(cands[j].localWall - c.localWall) < Math.abs(cands[best].localWall - c.localWall))) best = j;
    if (best >= 0 && Math.abs(cands[best].localWall - c.localWall) <= 36 * 3600e3) return [own[best]!, 'neighbour'];
    return [cetOffset(c.localWall), 'zone'];
  });

  const assets: DemoAsset[] = [];
  cands.forEach((c, i) => {
    const [off, offsetSource] = offsets[i];
    const takenAt = new Date(c.localWall - off * 3600e3).toISOString();
    if (takenAt < cfg.CAPTURED_FROM) { skip('captured before ' + cfg.CAPTURED_FROM.slice(0, 10)); return; }
    const ii = c.page.imageinfo![0];
    if (!ii.thumburl || !/\/\d+px-[^/]+$/.test(new URL(ii.thumburl).pathname)) { skip('no scaled thumbnail'); return; }
    const preview = cleanUrl(ii.thumburl);
    const mods = [RESIZED];
    let {lat, lon} = c;
    if (lat !== null) {
      const range = cfg.STRIP_GPS.find(r => takenAt >= r.from && takenAt < r.to);
      if (range) mods.push(`GPS removed for the demo (${range.why}).`);
      else if (hashUnit(c.page.title + cfg.STRIP_SINGLE.salt) < cfg.STRIP_SINGLE.rate) mods.push('GPS removed for the demo (random single shot).');
      if (mods.length > 1) lat = lon = null;
    }
    const owner = takenAt >= cfg.FRIEND_OWNS.from && takenAt < cfg.FRIEND_OWNS.to ? 'friend' : 'me';
    if (owner === 'friend') mods.push('Shown in the demo as owned by a second user and shared through an album.');
    if (offsetSource !== 'gps') mods.push(`UTC offset not in the file; taken from ${offsetSource === 'neighbour' ? 'the nearest photo in time' : 'the Central European time rule'}.`);
    assets.push({
      id: nameUuid(c.page.title), kind: 'photo', title: c.page.title, author: cfg.COMMONS_USER,
      license: c.license, licenseUrl: cfg.LICENSES[c.license], commonsUrl: ii.descriptionurl,
      revision: ii.timestamp, sha1: ii.sha1, takenAt, localOffsetHours: off, offsetSource,
      lat, lon, ...place(lat, lon), width: ii.width, height: ii.height, thumbhash: '', durationMs: 0,
      previewUrl: preview, sourceId: null, modifications: mods.join(' '), owner,
    });
  });
  return {assets, skipped};
}

/** CET/CEST offset (EU rule: summer time from the last Sunday of March to the last Sunday of October, 01:00 UTC). */
function cetOffset(localWall: number): number {
  const y = new Date(localWall).getUTCFullYear();
  const lastSunday = (m: number) => { const d = new Date(Date.UTC(y, m + 1, 0)); return Date.UTC(y, m, d.getUTCDate() - d.getUTCDay(), 1); };
  const utcGuess = localWall - 3600e3;
  return utcGuess >= lastSunday(2) && utcGuess < lastSunday(9) ? 2 : 1;
}

// ---------------------------------------------------------------------------------- media

/** Downloads the preview copy of every photo and makes its thumbnail; returns the ids whose preview could not be fetched. */
async function photoMedia(assets: DemoAsset[]): Promise<Set<string>> {
  let done = 0, fetched = 0;
  const failed = new Set<string>();
  for (const a of assets) {
    if (a.kind !== 'photo') continue;
    const dir = join(MEDIA, a.id);
    try {
      if (await download(a.previewUrl!, join(dir, 'preview.jpg'))) fetched++;
      if (!existsSync(join(dir, 'thumbnail.jpg'))) makeThumbnail(join(dir, 'preview.jpg'), join(dir, 'thumbnail.jpg'));
    } catch (err) {
      console.warn(`  ${a.title}: ${(err as Error).message}`);
      failed.add(a.id);
    }
    if (++done % 100 === 0) console.log(`  photos ${done}/${assets.length} (${fetched} downloaded)`);
  }
  console.log(`  photos ${done} (${fetched} files downloaded, ${failed.size} failed)`);
  return failed;
}

function setThumbhashes(assets: DemoAsset[]) {
  let swapped = 0;
  for (const a of assets) {
    if (a.kind !== 'photo') continue;
    const {hash, ratio} = thumbhashOf(join(MEDIA, a.id, 'thumbnail.jpg'));
    a.thumbhash = hash;
    // Commons reports the stored size; if the rendered copy is rotated, use its orientation.
    if ((ratio > 1) !== (a.width / a.height > 1) && Math.abs(Math.log(ratio * a.height / a.width)) > 0.2) {
      [a.width, a.height] = [a.height, a.width];
      swapped++;
    }
  }
  if (swapped) console.log(`  ${swapped} photos rotated relative to their stored size`);
}

/** Picks clip sources: `count` photos with GPS, evenly spaced in time within each range. */
function pickClipSources(photos: DemoAsset[]): DemoAsset[] {
  const out: DemoAsset[] = [];
  for (const r of cfg.CLIPS) {
    const pool = photos.filter(a => a.lat !== null && a.takenAt >= r.from && a.takenAt < r.to);
    for (let k = 0; k < r.count && pool.length; k++) out.push(pool[Math.floor((k + 0.5) * pool.length / r.count)]);
  }
  return out;
}

const MOVES = [
  {name: 'slow zoom in', z: (n: number) => `1+0.25*on/${n}`, x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)'},
  {name: 'slow zoom out', z: (n: number) => `1.25-0.25*on/${n}`, x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)'},
  {name: 'pan left to right', z: () => '1.2', x: `(iw-iw/zoom)*on/N`, y: 'ih/2-(ih/zoom/2)'},
  {name: 'pan top to bottom', z: () => '1.2', x: 'iw/2-(iw/zoom/2)', y: `(ih-ih/zoom)*on/N`},
];

function clipAssets(photos: DemoAsset[]): DemoAsset[] {
  return pickClipSources(photos).map((src, i) => {
    const move = MOVES[i % MOVES.length];
    const landscape = src.width >= src.height;
    const [w, h] = landscape ? [cfg.CLIP.long, cfg.CLIP.short] : [cfg.CLIP.short, cfg.CLIP.long];
    const id = nameUuid(src.title + '#clip');
    const dir = join(MEDIA, id), video = join(dir, 'video.mp4');
    if (!existsSync(video)) {
      mkdirSync(dir, {recursive: true});
      const n = cfg.CLIP.seconds * cfg.CLIP.fps, last = n - 1;
      // Crop the preview to the clip's aspect, upscale 2× (smoother sub-pixel motion), then zoompan.
      const vf = `crop='min(iw,ih*${w}/${h})':'min(ih,iw*${h}/${w})',scale=${w * 2}:${h * 2},setsar=1,` +
        `zoompan=z='${move.z(last)}':x='${move.x.replace('N', String(last))}':y='${move.y.replace('N', String(last))}':d=${n}:s=${w}x${h}:fps=${cfg.CLIP.fps},format=yuv420p`;
      ffmpeg(['-i', join(MEDIA, src.id, 'preview.jpg'), '-vf', vf, '-frames:v', String(n), '-c:v', 'libx264', '-preset', 'medium',
        '-crf', '23', '-profile:v', 'high', '-movflags', '+faststart', '-an', '-threads', '1'], video);
    }
    if (!existsSync(join(dir, 'preview.jpg'))) ffmpeg(['-i', video, '-frames:v', '1', '-q:v', '3'], join(dir, 'preview.jpg'));
    if (!existsSync(join(dir, 'thumbnail.jpg'))) makeThumbnail(video, join(dir, 'thumbnail.jpg'));
    const takenAt = new Date(Date.parse(src.takenAt) + cfg.CLIP.offsetSeconds * 1000).toISOString();
    return {
      ...src, id, kind: 'video' as const, takenAt, width: w, height: h,
      thumbhash: thumbhashOf(join(dir, 'thumbnail.jpg')).hash,
      durationMs: cfg.CLIP.seconds * 1000, previewUrl: null, sourceId: src.id,
      modifications: `Video derived from the photo: ${cfg.CLIP.seconds} s ${move.name} over its ${cfg.PREVIEW_WIDTH} px copy (ffmpeg, H.264 ${w}×${h}, no audio); ` +
        `time set ${cfg.CLIP.offsetSeconds} s after the photo, same location. Licensed like the photo.`,
    };
  });
}

// ---------------------------------------------------------------------------------- output

function albums(): DemoAlbum[] {
  return cfg.ALBUMS.map(({owner, shared, ...a}) => ({id: nameUuid('album:' + a.name), ...a, owner: owner ?? 'me', shared: shared ?? false}));
}

/** JSON with one asset/album per line: compact, and diffs stay readable. */
export function manifestJson(m: DemoManifest): string {
  const list = (xs: unknown[]) => '[\n' + xs.map(x => '  ' + JSON.stringify(x)).join(',\n') + '\n ]';
  const {assets, albums, ...head} = m;
  return '{\n' + Object.entries(head).map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)},\n`).join('') +
    ` "albums": ${list(albums)},\n "assets": ${list(assets)}\n}\n`;
}

export function creditsMarkdown(m: DemoManifest): string {
  const esc = (s: string) => s.replace(/\|/g, '\\|');
  const by = (l: string) => m.assets.filter(a => a.license === l).length;
  const lines = [
    '# Demo dataset credits',
    '',
    `Generated from \`manifest.json\` by \`fetch.ts\`; do not edit by hand.`,
    '',
    `All ${m.assets.length} items are by **${cfg.COMMONS_USER}** via [Wikimedia Commons](https://commons.wikimedia.org/wiki/User:Kent_Wang), ` +
    `each under its own licence: ${by('CC BY 4.0')} under [CC BY 4.0](${cfg.LICENSES['CC BY 4.0']}), ` +
    `${by('CC BY-SA 4.0')} under [CC BY-SA 4.0](${cfg.LICENSES['CC BY-SA 4.0']}). ` +
    'Every item is modified: photos are resized copies, some lost their GPS for the demo, some are presented as another (fictional) user\'s photos in a shared album, and the videos are pan/zoom clips made from photos. ' +
    'The licensors provide the material as-is, without warranties (see the licence texts).',
    '',
    '| # | Item | File page | Licence | Taken (UTC) | Modifications |',
    '|---|---|---|---|---|---|',
  ];
  m.assets.forEach((a, i) => {
    lines.push(`| ${i + 1} | ${a.kind === 'video' ? 'video' : 'photo'} | [${esc(a.title.replace(/^File:/, ''))}](${a.commonsUrl}) | ` +
      `[${a.license}](${a.licenseUrl}) | ${a.takenAt.slice(0, 16).replace('T', ' ')} | ${esc(a.modifications)} |`);
  });
  return lines.join('\n') + '\n';
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  let manifest: DemoManifest;
  if (refresh) {
    console.log(`listing uploads by ${cfg.COMMONS_USER} since ${cfg.UPLOADS_FROM} (API cache: ${CACHE})`);
    const pages = await listUploads(cfg.COMMONS_USER, cfg.UPLOADS_FROM, CACHE, n => process.stdout.write(`  batch ${n}\r`));
    const built = buildPhotos(pages);
    console.log(`\n  ${pages.length} files → ${built.assets.length} photos; skipped`, built.skipped);
    const failed = await photoMedia(built.assets);
    const assets = built.assets.filter(a => !failed.has(a.id));
    setThumbhashes(assets);
    const clips = clipAssets(assets);
    const all = [...assets, ...clips].sort((a, b) => a.takenAt.localeCompare(b.takenAt) || a.id.localeCompare(b.id));
    manifest = {
      version: 1, generatedAt: new Date().toISOString(),
      source: `Wikimedia Commons uploads by ${cfg.COMMONS_USER} (${cfg.UPLOADS_FROM.slice(0, 10)} on), CC BY 4.0 and CC BY-SA 4.0`,
      assets: all, albums: albums(),
    };
    writeFileSync(MANIFEST, manifestJson(manifest));
    writeFileSync(CREDITS, creditsMarkdown(manifest));
    console.log(`wrote ${MANIFEST} (${all.length} assets, ${clips.length} clips) and ${CREDITS}`);
  } else {
    manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as DemoManifest;
    const photos = manifest.assets.filter(a => a.kind === 'photo');
    const failed = await photoMedia(photos);
    if (failed.size) throw new Error(`${failed.size} photos could not be downloaded; their files may be gone from Commons`);
    const clips = clipAssets(photos);
    const known = new Set(manifest.assets.map(a => a.id));
    const missing = clips.filter(c => !known.has(c.id));
    if (missing.length) console.warn(`  ${missing.length} clips are not in the manifest; run with --refresh`);
  }
  console.log('done');
}

if (import.meta.main) await main();
