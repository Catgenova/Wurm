/**
 * Atlas-driven generation for the 4096 x 4096 archipelago.
 *
 * The survey chart was classified into a 512 x 512 atlas: red is elevation
 * (128 = sea level), green is ridge intensity, blue is moisture. Heights sample
 * that atlas through a warped domain, so coastlines read as drawn rather than as
 * atlas texels, and then take the same simplex detail generate.ts uses.
 *
 * generateAtlasRegion is the primitive: it generates any window with a 2-tile
 * halo, which is what chunk streaming needs. The whole map never has to exist.
 */
import { hash2, mulberry32, Noise2D } from './noise';
import { TileType, packTreeData } from './tiles';
import { World } from './world';
import { ATLAS_PNG } from './atlas-data';
import { REGIONS, buildRegionMap, regionAt, speciesFor, findBaySpawn } from './regions';

export interface AtlasConfig {
  /** Dirt units at the highest ground the chart shows, before mountains. */
  land: number;
  /** Ridged noise added where the chart shows rock and snow. */
  ridge: number;
  /** Dirt units at the deepest ocean. */
  depth: number;
  /** Shifts the whole world against the water line. */
  sea: number;
  /** Coastline warp, in tiles. */
  coast: number;
  /** Amplitude of the per-tile surface detail. */
  detail: number;
  /** Pushes moisture up or down; more forest above zero. */
  forest: number;
  /** Keep the lakes the chart shows inland; false fills them in. */
  lakes: boolean;
}

export const ATLAS_CONFIG: AtlasConfig = {
  land: 300,
  ridge: 240,
  depth: 250,
  sea: 0,
  coast: 18,
  detail: 2.2,
  forest: 0,
  lakes: true,
};

export interface Atlas {
  n: number;
  elev: Float32Array;
  ridge: Float32Array;
  moist: Float32Array;
  /** Region id per texel, grown out over the water. See regions.ts. */
  region: Uint8Array;
}

/** Decodes the atlas PNG. Async because it goes through an Image. */
export async function loadAtlas(png = ATLAS_PNG, cfg = ATLAS_CONFIG): Promise<Atlas> {
  const img = new Image();
  img.src = png;
  await img.decode();
  const n = img.naturalWidth;
  const canvas = document.createElement('canvas');
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, n, n).data;
  const elev = new Float32Array(n * n);
  const ridge = new Float32Array(n * n);
  const moist = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    elev[i] = (d[i * 4] - 128) / 127;
    ridge[i] = d[i * 4 + 1] / 255;
    moist[i] = d[i * 4 + 2] / 255;
  }
  if (!cfg.lakes) fillInlandWater(elev, n);
  return { n, elev, ridge, moist, region: buildRegionMap(elev, n) };
}

/** Floods ocean in from the border; water it never reaches is an inland lake. */
function fillInlandWater(elev: Float32Array, n: number): void {
  const seen = new Uint8Array(n * n);
  const stack: number[] = [];
  for (let x = 0; x < n; x++) stack.push(x, (n - 1) * n + x);
  for (let y = 0; y < n; y++) stack.push(y * n, y * n + n - 1);
  while (stack.length) {
    const k = stack.pop() as number;
    if (seen[k] || elev[k] >= 0) continue;
    seen[k] = 1;
    const x = k % n;
    const y = (k / n) | 0;
    if (x > 0) stack.push(k - 1);
    if (x < n - 1) stack.push(k + 1);
    if (y > 0) stack.push(k - n);
    if (y < n - 1) stack.push(k + n);
  }
  for (let i = 0; i < n * n; i++) if (elev[i] < 0 && !seen[i]) elev[i] = Math.max(elev[i], 0.03);
}

interface Fields {
  warp: Noise2D;
  ridge: Noise2D;
  detail: Noise2D;
  moist: Noise2D;
  patch: Noise2D;
}

/** The five noise fields, drawn from one seeded stream in this exact order. */
function fields(seed: number): Fields {
  const rng = mulberry32(seed);
  return { warp: new Noise2D(rng), ridge: new Noise2D(rng), detail: new Noise2D(rng), moist: new Noise2D(rng), patch: new Noise2D(rng) };
}

/** Bilinear atlas sample into out = [elevation, ridge, moisture]. */
function sample(atlas: Atlas, u: number, v: number, out: number[]): void {
  const n = atlas.n;
  let fx = u * (n - 1);
  let fy = v * (n - 1);
  fx = fx < 0 ? 0 : fx > n - 1 ? n - 1 : fx;
  fy = fy < 0 ? 0 : fy > n - 1 ? n - 1 : fy;
  const x0 = fx | 0;
  const y0 = fy | 0;
  const x1 = x0 + 1 < n ? x0 + 1 : x0;
  const y1 = y0 + 1 < n ? y0 + 1 : y0;
  const tx = fx - x0;
  const ty = fy - y0;
  const a = y0 * n + x0;
  const b = y0 * n + x1;
  const c = y1 * n + x0;
  const d = y1 * n + x1;
  const lerp = (f: Float32Array) => (f[a] * (1 - tx) + f[b] * tx) * (1 - ty) + (f[c] * (1 - tx) + f[d] * tx) * ty;
  out[0] = lerp(atlas.elev);
  out[1] = lerp(atlas.ridge);
  out[2] = lerp(atlas.moist);
}

function cornerHeight(atlas: Atlas, f: Fields, cfg: AtlasConfig, cx: number, cy: number, size: number, out: number[]): number {
  const w = cfg.coast / size;
  const du = f.warp.fbm(cx * 0.0045 + 3.7, cy * 0.0045 - 1.3, 3) * w;
  const dv = f.warp.fbm(cx * 0.0045 - 2.1, cy * 0.0045 + 5.7, 3) * w;
  sample(atlas, cx / size + du, cy / size + dv, out);
  const prior = out[0];
  const rid = out[1];
  let h = prior >= 0 ? prior * cfg.land : prior * cfg.depth;
  const rv = 1 - Math.abs(f.ridge.fbm(cx * 0.00898 + 11, cy * 0.00898 + 5, 4));
  const mtn = Math.pow(Math.max(0, rv - 0.5) / 0.5, 2.2);
  h += mtn * cfg.ridge * rid * rid;
  h += f.detail.noise(cx * 0.35, cy * 0.35) * cfg.detail + f.detail.noise(cx * 1.3 + 40, cy * 1.3) * cfg.detail * 0.36;
  h -= cfg.sea;
  h = Math.round(h);
  return h < -140 ? -140 : h > 480 ? 480 : h;
}

export interface Region {
  /** (w + 1) x (h + 1) corner heights. */
  heights: Int16Array;
  tiles: Uint8Array;
  data: Uint8Array;
}

/**
 * Generates one window of the world. Costs about 5 ms for a 64 x 64 chunk, so a
 * client can generate terrain as fast as it walks and never download a map.
 */
export function generateAtlasRegion(
  seed: number,
  atlas: Atlas,
  x0: number,
  y0: number,
  w: number,
  h: number,
  size = 4096,
  cfg = ATLAS_CONFIG,
): Region {
  const f = fields(seed);
  const out = [0, 0, 0];
  const HALO = 2;
  const gx = x0 - HALO;
  const gy = y0 - HALO;
  const gw = w + HALO * 2 + 1;
  const gh = h + HALO * 2 + 1;
  const grid = new Int16Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) grid[y * gw + x] = cornerHeight(atlas, f, cfg, gx + x, gy + y, size, out);
  }
  const at = (cx: number, cy: number): number => grid[(cy - gy) * gw + (cx - gx)];

  const heights = new Int16Array((w + 1) * (h + 1));
  for (let y = 0; y <= h; y++) {
    for (let x = 0; x <= w; x++) heights[y * (w + 1) + x] = at(x0 + x, y0 + y);
  }

  /** True when any tile within two of this one touches water. */
  const nearWater = (tx: number, ty: number): boolean => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        if (at(x, y) < 0 || at(x + 1, y) < 0 || at(x + 1, y + 1) < 0 || at(x, y + 1) < 0) return true;
      }
    }
    return false;
  };

  const tiles = new Uint8Array(w * h);
  const data = new Uint8Array(w * h);
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const wx = x0 + tx;
      const wy = y0 + ty;
      const c0 = at(wx, wy);
      const c1 = at(wx + 1, wy);
      const c2 = at(wx + 1, wy + 1);
      const c3 = at(wx, wy + 1);
      const min = Math.min(c0, c1, c2, c3);
      const max = Math.max(c0, c1, c2, c3);
      const avg = (c0 + c1 + c2 + c3) / 4;
      const slope = max - min;
      sample(atlas, wx / size, wy / size, out);
      const R = REGIONS[regionAt(atlas, wx, wy, size)];
      const m = f.moist.fbm(wx * 0.021 + 5, wy * 0.021 + 9, 4) * 0.55 + (out[2] - 0.5) * 1.7 + cfg.forest + R.moistBias;
      const p = f.patch.fbm(wx * 0.085, wy * 0.085, 2);
      const r = hash2(wx, wy, seed);
      const r2 = hash2(wx, wy, seed + 77);
      const variant = Math.floor(hash2(wx, wy, seed + 3) * 3);
      let t: TileType = TileType.Grass;
      let d = 0;
      if (max < 0) {
        t = avg < -28 ? TileType.Dirt : TileType.Sand;
        if (avg > -22 && avg < -4 && r < 0.09) t = TileType.Kelp;
        else if (avg >= -4 && r < 0.22) t = TileType.Reed;
      } else if (min < 0) {
        t = TileType.Sand;
        if (m > 0.15 && r < 0.3 && slope < 12) t = TileType.Reed;
      } else if (slope > 52) {
        t = TileType.Rock;
      } else if (avg > 232 + p * 12) {
        t = R.snow ? TileType.Snow : TileType.Rock;
      } else if (avg > 160 + p * 22) {
        t = slope > 22 || !R.tundra ? TileType.Rock : TileType.Tundra;
        if (t === TileType.Tundra && r < 0.05) {
          t = TileType.Tree;
          d = packTreeData(1, variant);
        }
      } else if (avg > 108 + p * 18) {
        if (slope > 30) t = TileType.Rock;
        else if (m > 0.05 && r < 0.45 + m * 0.4) {
          t = TileType.Tree;
          d = packTreeData(r2 < 0.65 ? 1 : 5, variant);
        } else t = R.tundra && r < 0.5 ? TileType.Tundra : TileType.Grass;
      } else if (avg < 5 && m > 0.12) {
        t = TileType.Marsh;
        if (r < 0.08) t = TileType.Peat;
        else if (r > 0.975) t = TileType.Tar;
        else if (r > 0.86) t = TileType.Reed;
      } else if (avg < 6 && nearWater(wx, wy)) {
        t = TileType.Sand;
        if (r < 0.09) t = TileType.Clay;
      } else if (m < -0.3) {
        t = r2 < R.steppe ? TileType.Steppe : TileType.Grass;
        if (r < 0.015) {
          t = TileType.Tree;
          d = packTreeData(0, variant);
        } else if (p > 0.5 && r < 0.35) t = TileType.Dirt;
      } else if (m > 0.26) {
        const density = Math.min(0.85, (m - 0.26) * 2.4 + 0.3);
        if (r < density) {
          t = TileType.Tree;
          d = packTreeData(speciesFor(R, avg, m, r2), variant);
        } else if (r < density + 0.06) {
          t = TileType.Bush;
          d = Math.floor(r2 * 3);
        } else t = p > 0.25 ? TileType.Moss : TileType.Grass;
      } else {
        t = TileType.Grass;
        if (slope > 24 && r > 0.55) t = TileType.Rock;
        else if (r < 0.035) {
          t = TileType.Tree;
          d = packTreeData(speciesFor(R, avg, m, r2), variant);
        } else if (r < 0.05) {
          t = TileType.Bush;
          d = Math.floor(r2 * 3);
        } else if (p > 0.58 && r < 0.6) t = TileType.Dirt;
        else if (p < -0.6) t = TileType.Moss;
        else if (avg < 9 && nearWater(wx, wy) && r < 0.08) t = TileType.Clay;
      }
      tiles[ty * w + tx] = t;
      data[ty * w + tx] = d;
    }
  }
  return { heights, tiles, data };
}

/**
 * Builds the whole world in one call. About 22 s and 64 MB of typed arrays at
 * 4096 - run it in a Worker, or prefer generateAtlasRegion per chunk.
 */
export function generateAtlasWorld(seed: number, atlas: Atlas, size = 4096, cfg = ATLAS_CONFIG) {
  const { heights, tiles, data } = generateAtlasRegion(seed, atlas, 0, 0, size, size, size, cfg);
  const world = new World(size, size, heights, tiles, data);
  return { world, spawn: findBaySpawn(atlas, seed, size) };
}