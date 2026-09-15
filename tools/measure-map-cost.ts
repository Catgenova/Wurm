/**
 * Measures what a world of a given size costs to ship and store.
 *
 * Generates the real terrain with the game's own generator and reports raw,
 * gzipped, brotli'd and chunk-streamed sizes, so map-size decisions can be made
 * against measured bytes rather than estimates.
 *
 *   npx tsx tools/measure-map-cost.ts 256 4096
 */
import { gzipSync, brotliCompressSync, deflateSync, constants } from 'node:zlib';
import { generateWorld } from '../src/world/generate';
import { TILE_DEFS, type TileType } from '../src/world/tiles';
import type { World } from '../src/world/world';

const CHUNK = 64;

const gz = (b: Uint8Array): number => gzipSync(b, { level: 6 }).length;
const br = (b: Uint8Array, quality = 9): number =>
  brotliCompressSync(b, {
    params: { [constants.BROTLI_PARAM_QUALITY]: quality, [constants.BROTLI_PARAM_SIZE_HINT]: b.length },
  }).length;

const bytesOf = (a: Int16Array | Uint8Array): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

const kib = (n: number): string => `${(n / 1024).toFixed(1)} KiB`;
const mib = (n: number): string => `${(n / 1048576).toFixed(2)} MiB`;

function writeVarint(out: Uint8Array, at: number, value: number): number {
  let v = value >>> 0;
  while (v >= 0x80) {
    out[at++] = (v & 0x7f) | 0x80;
    v >>>= 7;
  }
  out[at++] = v;
  return at;
}

/**
 * The wire format a streaming client would use: one chunk of corner heights as
 * per-row zigzag varint deltas, then the raw tile and data planes. Heights are
 * smooth, so the deltas are nearly all one byte and compress far better than
 * the Int16 array does.
 */
function encodeChunk(world: World, cx: number, cy: number, out: Uint8Array): Uint8Array {
  const { w, cw, heights, tiles, data } = world;
  let p = 0;
  for (let y = 0; y <= CHUNK; y++) {
    let prev = 0;
    for (let x = 0; x <= CHUNK; x++) {
      const v = heights[(cy * CHUNK + y) * cw + (cx * CHUNK + x)];
      const d = v - prev;
      prev = v;
      p = writeVarint(out, p, (d << 1) ^ (d >> 31));
    }
  }
  for (let y = 0; y < CHUNK; y++) {
    for (let x = 0; x < CHUNK; x++) out[p++] = tiles[(cy * CHUNK + y) * w + (cx * CHUNK + x)];
  }
  for (let y = 0; y < CHUNK; y++) {
    for (let x = 0; x < CHUNK; x++) out[p++] = data[(cy * CHUNK + y) * w + (cx * CHUNK + x)];
  }
  return out.subarray(0, p);
}

/** True when nothing in the chunk is above water and every tile is the same type. */
function isOpenSea(world: World, cx: number, cy: number): boolean {
  const t0 = world.getTile(cx * CHUNK, cy * CHUNK);
  for (let y = 0; y < CHUNK; y++) {
    for (let x = 0; x < CHUNK; x++) {
      const tx = cx * CHUNK + x;
      const ty = cy * CHUNK + y;
      if (!world.isSubmerged(tx, ty) || world.getTile(tx, ty) !== t0) return false;
    }
  }
  return true;
}

/** Minimal PNG encoder (RGB, Sub filter) used to size the pre-baked overview map. */
function encodePng(rgb: Uint8Array, dim: number): number {
  const stride = dim * 3;
  const raw = Buffer.alloc((stride + 1) * dim);
  for (let y = 0; y < dim; y++) {
    raw[y * (stride + 1)] = 1;
    for (let x = 0; x < stride; x++) {
      const left = x >= 3 ? rgb[y * stride + x - 3] : 0;
      raw[y * (stride + 1) + 1 + x] = (rgb[y * stride + x] - left) & 0xff;
    }
  }
  return 8 + 25 + (12 + deflateSync(raw, { level: 9 }).length) + 12;
}

/** Downsamples the world to a minimap image and returns its PNG size. */
function overviewPng(world: World, dim: number): number {
  const step = world.w / dim;
  const rgb = new Uint8Array(dim * dim * 3);
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const sx = Math.floor(x * step);
      const sy = Math.floor(y * step);
      const def = TILE_DEFS[world.getTile(sx, sy) as TileType];
      const h = world.centerHeight(sx, sy);
      let [r, g, b] = def.color;
      if (world.hasWater(sx, sy)) {
        const k = Math.max(0.35, 1 - Math.max(0, -h) / 60);
        r = 30 * k + 20;
        g = 80 * k + 30;
        b = 140 * k + 50;
      } else {
        const shade = 0.8 + Math.min(0.4, h / 400);
        r *= shade;
        g *= shade;
        b *= shade;
      }
      const i = (y * dim + x) * 3;
      rgb[i] = r;
      rgb[i + 1] = g;
      rgb[i + 2] = b;
    }
  }
  return encodePng(rgb, dim);
}

function measure(size: number, seed: number): void {
  const started = Date.now();
  const { world } = generateWorld(seed, size);
  const genMs = Date.now() - started;

  const heights = bytesOf(world.heights);
  const raw = heights.length + world.tiles.length + world.data.length;
  const whole = new Uint8Array(raw);
  whole.set(heights, 0);
  whole.set(world.tiles, heights.length);
  whole.set(world.data, heights.length + world.tiles.length);

  const buf = new Uint8Array((CHUNK + 1) * (CHUNK + 1) * 3 + CHUNK * CHUNK * 2);
  const perChunk: number[] = [];
  let chunkTotal = 0;
  let seaChunks = 0;
  let seaBytes = 0;
  const n = size / CHUNK;
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const encoded = br(encodeChunk(world, cx, cy, buf));
      perChunk.push(encoded);
      chunkTotal += encoded;
      if (isOpenSea(world, cx, cy)) {
        seaChunks++;
        seaBytes += encoded;
      }
    }
  }
  perChunk.sort((a, b) => a - b);

  let land = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!world.isSubmerged(x, y)) land++;

  console.log(`\n=== ${size} x ${size} (seed ${seed}) ===`);
  console.log(`tiles                 ${(size * size).toLocaleString()}   land ${((land / (size * size)) * 100).toFixed(1)}%`);
  console.log(`world edge            ${((size * 4) / 1000).toFixed(2)} km   area ${(((size * 4) / 1000) ** 2).toFixed(1)} km2`);
  console.log(`generation            ${(genMs / 1000).toFixed(2)} s  (${(genMs / (n * n)).toFixed(1)} ms per ${CHUNK}x${CHUNK} chunk)`);
  console.log(`raw typed arrays      ${raw.toLocaleString()} B  ${mib(raw)}`);
  console.log(`current save (base64) ${(Math.ceil(raw / 3) * 4).toLocaleString()} B  ${mib(Math.ceil(raw / 3) * 4)}`);
  console.log(`whole map gzip        ${gz(whole).toLocaleString()} B  ${mib(gz(whole))}`);
  console.log(`whole map brotli      ${br(whole).toLocaleString()} B  ${mib(br(whole))}`);
  console.log(`chunked (${CHUNK}, delta+br) ${chunkTotal.toLocaleString()} B  ${mib(chunkTotal)}   over ${n * n} chunks`);
  console.log(`  per chunk           mean ${Math.round(chunkTotal / perChunk.length)} B  median ${perChunk[perChunk.length >> 1]} B  p95 ${perChunk[Math.floor(perChunk.length * 0.95)]} B  max ${perChunk[perChunk.length - 1]} B`);
  console.log(`  open sea chunks     ${seaChunks} of ${n * n} (${seaBytes.toLocaleString()} B, omittable)`);
  console.log(`  first paint (3x3)   ${kib(Math.round((chunkTotal / perChunk.length) * 9))}`);
  console.log(`overview png 512      ${overviewPng(world, 512).toLocaleString()} B`);
  if (size >= 1024) console.log(`overview png 1024     ${overviewPng(world, 1024).toLocaleString()} B`);
}

const seed = Number(process.env.SEED ?? 12345);
const sizes = process.argv.slice(2).map(Number).filter((n) => n > 0 && n % CHUNK === 0);
for (const size of sizes.length ? sizes : [256, 4096]) measure(size, seed);
