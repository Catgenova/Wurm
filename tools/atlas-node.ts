/**
 * The survey chart, read where there is no browser.
 *
 * `loadAtlas` in `src/world/atlas-world.ts` goes through an `Image` and a
 * canvas, which is the right way to do it in a tab and no way at all in Node.
 * The chart is the same chart either side — this is the only difference, and
 * it lives out here in `tools/` rather than in `src/`, so that nothing the
 * game ships carries a second PNG decoder it never runs.
 */
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildRegionMap } from '../src/world/regions';
import type { Atlas } from '../src/world/atlas-world';

/**
 * Minimal PNG reader (8-bit truecolour, non-interlaced) so the atlas can be
 * read outside a browser, where loadAtlas's Image and canvas do not exist.
 */
function decodePng(file: Buffer): { w: number; ch: number; px: Buffer } {
  let p = 8;
  let w = 0;
  let h = 0;
  let ch = 3;
  const idat: Buffer[] = [];
  while (p < file.length) {
    const len = file.readUInt32BE(p);
    const type = file.toString('ascii', p + 4, p + 8);
    const data = file.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      ch = data[9] === 2 ? 3 : data[9] === 6 ? 4 : 1;
    } else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = Buffer.alloc(stride * h);
  let q = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[q++];
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[q++];
      const a = x >= ch ? px[row + x - ch] : 0;
      const b = y > 0 ? px[prev + x] : 0;
      const c = x >= ch && y > 0 ? px[prev + x - ch] : 0;
      let o: number;
      if (f === 0) o = v;
      else if (f === 1) o = v + a;
      else if (f === 2) o = v + b;
      else if (f === 3) o = v + ((a + b) >> 1);
      else {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        o = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      px[row + x] = o & 0xff;
    }
  }
  return { w, ch, px };
}

export function readAtlas(): Atlas {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '../src/world/atlas-data.ts'), 'utf8');
  const b64 = /base64,([A-Za-z0-9+/=]+)/.exec(src);
  if (!b64) throw new Error('no atlas in src/world/atlas-data.ts');
  const img = decodePng(Buffer.from(b64[1], 'base64'));
  const n = img.w;
  const elev = new Float32Array(n * n);
  const ridge = new Float32Array(n * n);
  const moist = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    elev[i] = (img.px[i * img.ch] - 128) / 127;
    ridge[i] = img.px[i * img.ch + 1] / 255;
    moist[i] = img.px[i * img.ch + 2] / 255;
  }
  return { n, elev, ridge, moist, region: buildRegionMap(elev, n) };
}
