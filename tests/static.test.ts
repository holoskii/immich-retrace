import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {mkdir, mkdtemp, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {brotliDecompressSync, gunzipSync} from 'node:zlib';
import {Hono} from 'hono';
import {precompressDir} from '../server/precompress.ts';
import {IMMUTABLE_PUBLIC, staticFiles} from '../server/static.ts';

const JS = 'export const x = 1;\n'.repeat(200);
let dir: string;
let app: Hono;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'viewer-static-'));
  await mkdir(join(dir, 'assets'));
  await writeFile(join(dir, 'index.html'), `<!doctype html><title>x</title>${'<p>hello</p>'.repeat(200)}`);
  await writeFile(join(dir, 'assets', 'index-AbC123.js'), JS);
  await writeFile(join(dir, 'assets', 'tiny-Zz9.css'), 'a{}');
  await writeFile(join(dir, 'assets', 'photo-Q1.webp'), new Uint8Array(4096));
  app = new Hono();
  app.use('/*', staticFiles(dir));
});
afterAll(() => rm(dir, {recursive: true}));

const get = (path: string, encoding?: string) => app.request(path, {headers: encoding ? {'accept-encoding': encoding} : {}});

describe('precompressDir', () => {
  it('writes .br and .gz next to compressible files over 1 kB only', async () => {
    expect((await precompressDir(dir)).sort()).toEqual(['assets/index-AbC123.js', 'index.html']);
    expect((await readdir(join(dir, 'assets'))).sort())
      .toEqual(['index-AbC123.js', 'index-AbC123.js.br', 'index-AbC123.js.gz', 'photo-Q1.webp', 'tiny-Zz9.css']);
  });
});

describe('static files', () => {
  it('prefers brotli, then gzip, then the plain file', async () => {
    const br = await get('/assets/index-AbC123.js', 'gzip, deflate, br');
    expect(br.headers.get('content-encoding')).toBe('br');
    expect(br.headers.get('content-type')).toMatch(/javascript/);
    expect(brotliDecompressSync(Buffer.from(await br.arrayBuffer())).toString()).toBe(JS);

    const gz = await get('/assets/index-AbC123.js', 'gzip');
    expect(gz.headers.get('content-encoding')).toBe('gzip');
    expect(gunzipSync(Buffer.from(await gz.arrayBuffer())).toString()).toBe(JS);

    const plain = await get('/assets/index-AbC123.js');
    expect(plain.headers.get('content-encoding')).toBeNull();
    expect(await plain.text()).toBe(JS);
    for (const res of [br, gz, plain]) expect(res.headers.get('vary')).toBe('Accept-Encoding');
  });

  it('caches hashed assets for good and revalidates index.html', async () => {
    expect((await get('/assets/index-AbC123.js', 'br')).headers.get('cache-control')).toBe(IMMUTABLE_PUBLIC);
    expect((await get('/assets/photo-Q1.webp', 'br')).headers.get('cache-control')).toBe(IMMUTABLE_PUBLIC);
    for (const path of ['/', '/index.html']) {
      const res = await get(path, 'br');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-encoding')).toBe('br');
      expect(res.headers.get('cache-control')).toBe('no-cache');
    }
  });

  it('never serves a compressed copy as the wrong type, and leaves misses alone', async () => {
    const webp = await get('/assets/photo-Q1.webp', 'br');
    expect(webp.headers.get('content-encoding')).toBeNull();
    expect(webp.headers.get('content-type')).toBe('image/webp');
    const miss = await get('/assets/gone-123.js', 'br');
    expect(miss.status).toBe(404);
    expect(miss.headers.get('cache-control')).toBeNull();
  });
});
