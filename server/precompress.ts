// Build step (vite.config.ts): writes .br and .gz next to every compressible file of the web build,
// so the server sends them (server/static.ts) without compressing on each request.

import {readdir, readFile, writeFile} from 'node:fs/promises';
import {join, relative} from 'node:path';
import {brotliCompressSync, constants, gzipSync} from 'node:zlib';

const COMPRESSIBLE = /\.(js|mjs|css|html|svg|json|webmanifest|txt|wasm)$/;
/** Below this the headers outweigh the savings. */
const MIN_BYTES = 1024;

/** Returns the files it compressed (relative to `dir`). A copy that isn't smaller is skipped. */
export async function precompressDir(dir: string): Promise<string[]> {
  const done: string[] = [];
  for (const entry of await readdir(dir, {recursive: true, withFileTypes: true})) {
    if (!entry.isFile() || !COMPRESSIBLE.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name);
    const data = await readFile(path);
    if (data.length < MIN_BYTES) continue;
    const br = brotliCompressSync(data, {params: {[constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length}});
    const gz = gzipSync(data, {level: 9});
    if (br.length < data.length) await writeFile(path + '.br', br);
    if (gz.length < data.length) await writeFile(path + '.gz', gz);
    done.push(relative(dir, path));
  }
  return done;
}
