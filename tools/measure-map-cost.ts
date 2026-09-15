/**
 * What a world of a given size costs to store and to send.
 *
 * Generates the real land with the game's own generator and reports it in the
 * two shapes that matter: the scanline rows the database actually uses, and
 * 64 x 64 chunks. Also reports what `rpc_land` would put on the wire, which is
 * the number the join path is really paying.
 *
 *   npx tsx tools/measure-map-cost.ts 256 4096
 *
 * The database figures in docs/tile-map-cost-analysis.md come from loading the
 * output of this into the schema in supabase/migrations/ and reading
 * pg_total_relation_size.
 */
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { generateAtlasWindow, type Atlas } from '../src/world/atlas-world';
import { readAtlas } from './atlas-node';

const CHUNK = 64;
const BAND = 64;

const gz = (b: Uint8Array): number => gzipSync(b, { level: 6 }).length;
const br = (b: Uint8Array): number =>
  brotliCompressSync(b, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: b.length },
  }).length;

const mib = (n: number): string => `${(n / 1048576).toFixed(2)} MiB`;

function measure(size: number, seed: number, atlas: Atlas): void {
  const started = Date.now();
  let scanRaw = 0;
  let scanGz = 0;
  let scanBr = 0;
  let joinBytes = 0;
  let chunkRaw = 0;
  let chunkGz = 0;
  let chunkBr = 0;
  let chunks = 0;

  for (let y0 = 0; y0 < size; y0 += BAND) {
    const rows = Math.min(BAND, size - y0);
    const w = generateAtlasWindow(seed, atlas, 0, y0, size, rows, size);
    for (let r = 0; r < rows; r++) {
      const heights = Buffer.from(w.heights.buffer, w.heights.byteOffset + r * (size + 1) * 2, (size + 1) * 2);
      const dirt = Buffer.from(w.dirt.buffer, w.dirt.byteOffset + r * (size + 1), size + 1);
      const tiles = Buffer.from(w.tiles.buffer, w.tiles.byteOffset + r * size, size);
      const data = Buffer.from(w.data.buffer, w.data.byteOffset + r * size, size);
      const rock = Buffer.from(w.rock.buffer, w.rock.byteOffset + r * size, size);
      const scanline = Buffer.concat([heights, dirt, tiles, data, rock]);
      scanRaw += scanline.length;
      scanGz += gz(scanline);
      scanBr += br(scanline);
      // What rpc_land puts on the wire: five base64 strings and their keys.
      joinBytes += [heights, dirt, tiles, data, rock].reduce((a, b) => a + Math.ceil(b.length / 3) * 4, 0) + 90;
    }
    if (rows === BAND) {
      for (let cx = 0; cx * CHUNK < size; cx++) {
        const buf = Buffer.alloc((CHUNK + 1) * (CHUNK + 1) * 3 + CHUNK * CHUNK * 3);
        let p = 0;
        for (let y = 0; y <= CHUNK; y++) {
          for (let x = 0; x <= CHUNK; x++) {
            buf.writeInt16LE(w.heights[y * (size + 1) + cx * CHUNK + x], p);
            p += 2;
          }
        }
        for (let y = 0; y <= CHUNK; y++) {
          for (let x = 0; x <= CHUNK; x++) buf[p++] = w.dirt[y * (size + 1) + cx * CHUNK + x];
        }
        for (const plane of [w.tiles, w.data, w.rock]) {
          for (let y = 0; y < CHUNK; y++) {
            for (let x = 0; x < CHUNK; x++) buf[p++] = plane[y * size + cx * CHUNK + x];
          }
        }
        const slice = buf.subarray(0, p);
        chunkRaw += p;
        chunkGz += gz(slice);
        chunkBr += br(slice);
        chunks++;
      }
    }
  }
  const seconds = (Date.now() - started) / 1000;

  console.log(`\n=== ${size} x ${size} (seed ${seed}) ===`);
  console.log(`tiles                  ${(size * size).toLocaleString()}`);
  console.log(`world edge             ${((size * 4) / 1000).toFixed(2)} km   area ${(((size * 4) / 1000) ** 2).toFixed(1)} km2`);
  console.log(`generated in           ${seconds.toFixed(1)} s  (${((seconds * 1000) / (size * size) * 4096).toFixed(1)} ms per 64x64 chunk equivalent)`);
  console.log('');
  console.log(`scanline rows          ${(size + 1 + size).toLocaleString()} rows, ${mib(scanRaw)} raw`);
  console.log(`  gzip                 ${mib(scanGz)}`);
  console.log(`  brotli               ${mib(scanBr)}`);
  console.log(`  rpc_land on the wire ${mib(joinBytes)}   <- what every join downloads`);
  console.log(`  batches of 64 rows   ${Math.ceil((size + 1) / 64)} round trips`);
  console.log('');
  console.log(`64x64 chunks           ${chunks.toLocaleString()} rows, ${mib(chunkRaw)} raw`);
  console.log(`  gzip                 ${mib(chunkGz)}`);
  console.log(`  brotli               ${mib(chunkBr)}`);
  console.log(`  mean per chunk       ${Math.round(chunkGz / Math.max(1, chunks)).toLocaleString()} B gzipped`);
}

const seed = Number(process.env.SEED ?? 12345);
const sizes = process.argv
  .slice(2)
  .map(Number)
  .filter((n) => n > 0 && n % BAND === 0);
const atlas = readAtlas();
for (const size of sizes.length ? sizes : [256, 4096]) measure(size, seed, atlas);
