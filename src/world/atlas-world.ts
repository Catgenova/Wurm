import { hash2, mulberry32, Noise2D } from './noise';
import { TileType, packTreeData } from './tiles';
import { ORE_DENSITY } from './ore';
import { World } from './world';
import { ATLAS_PNG } from './atlas-data';
import { BAY, REGIONS, SPAWN_RADIUS, SPAWN_REGION, buildRegionMap, rockKindFor, speciesFor } from './regions';

/**
 * The archipelago, generated from the survey chart rather than from a radial
 * mask.
 *
 * The chart was classified into a 512 x 512 atlas: red is elevation with 128
 * at sea level, green is ridge intensity, blue is moisture. Heights sample
 * that atlas through a warped domain, so a coastline reads as drawn instead of
 * as a staircase of atlas texels, and then take the same simplex detail
 * generate.ts uses, so the ground still feels like the rest of the game.
 *
 * `generateAtlasWindow` is the primitive and `generateAtlasWorld` is a loop
 * over it. A 4096 x 4096 world is 16.8 M tiles and 64 MB of typed arrays, far
 * too much to build on the main thread at load, but one 64 x 64 chunk costs
 * about 12 ms — so terrain can be generated as the camera moves and the whole
 * map never has to exist at once.
 */

export interface AtlasConfig {
  /** Dirt units at the highest ground the chart shows, before mountains. */
  land: number;
  /** Ridged noise added where the chart shows rock and snow. */
  ridge: number;
  /** Dirt units at the deepest water. */
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

/*
 * `land` and `depth` are the chart's own range, exactly: the highest ground it
 * draws comes out at `land` and its deepest water at `depth`, because
 * `tools/build-atlas.ts` normalises the chart against them and prints the pair
 * to set here. They are one decision with the chart and not two, and the check
 * in `supabase/test/relief.ts` reports the day they stop agreeing.
 *
 * `ridge` used to be 240 and used to be doing the mountains' work: the chart
 * reached 215 of a nominal 300, the snow line stood at 232, and so every
 * snowfield on the island was put there by noise the chart only gated. The
 * chart carries its own mountains now, and this is surface texture on rock.
 */
export const ATLAS_CONFIG: AtlasConfig = {
  land: 597,
  ridge: 85,
  depth: 205,
  sea: 0,
  coast: 11,
  detail: 2.2,
  forest: 0,
  lakes: true,
};

/**
 * Where the ground changes its mind about what it is, in dirt units above the
 * water line, each with the amount the patch noise ragged-edges it by so that
 * the line between two kinds of country is a fringe rather than a contour.
 *
 * These were three pairs of bare numbers inside the classifier. They are named
 * out here because they are the other half of a question `ATLAS_CONFIG` only
 * answers half of: `land` says how high the chart's ground gets, and these say
 * how high it has to get before it is called a mountain. Neither number means
 * anything without the other, and `supabase/test/relief.ts` reads both.
 *
 * They were 108, 160 and 232 when the chart reached 215, which is how the snow
 * line came to stand above the highest ground on the island. Redrawing the
 * chart to reach 603 without moving these would have been the same mistake
 * upside down: a tree line at 108 on a continent whose plateau stands at 344
 * turns every tableland in the archipelago to bare rock, which is exactly what
 * the first render of it showed.
 *
 * So they are set against the relief that now exists, feature by feature. The
 * tree line is under the height an ordinary island interior stands at, so that
 * interiors are wooded. The rock line is over the top of the crescent's
 * plateau, so that its tableland is walkable and only its edges are bare — the
 * slope rule takes care of the edges, being what a cliff actually is. And the
 * snow line is over the volcano and under the northeast summits, which is the
 * arrangement the reference draws: one white range in the archipelago, and a
 * volcano that is grey because it is a volcano.
 */
export const BANDS = {
  /** Above this, forest and rock rather than open ground. */
  hill: 104,
  hillVary: 26,
  /** Above this, bare rock, and tundra where the region has it. */
  alpine: 352,
  alpineVary: 34,
  /** Above this, snow. */
  snow: 410,
  snowVary: 20,
} as const;

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

/** Floods the ocean in from the border; water it never reaches is a lake. */
export function fillInlandWater(elev: Float32Array, n: number): void {
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

export function regionAt(atlas: Atlas, x: number, y: number, size: number): number {
  const n = atlas.n;
  let ax = ((x / size) * n) | 0;
  let ay = ((y / size) * n) | 0;
  ax = ax < 0 ? 0 : ax > n - 1 ? n - 1 : ax;
  ay = ay < 0 ? 0 : ay > n - 1 ? n - 1 : ay;
  return atlas.region[ay * n + ax];
}

interface Fields {
  warp: Noise2D;
  ridge: Noise2D;
  detail: Noise2D;
  moist: Noise2D;
  patch: Noise2D;
  soil: Noise2D;
}

/** The noise fields, drawn from one seeded stream in this exact order. */
function fields(seed: number): Fields {
  const rng = mulberry32(seed);
  return {
    warp: new Noise2D(rng),
    ridge: new Noise2D(rng),
    detail: new Noise2D(rng),
    moist: new Noise2D(rng),
    patch: new Noise2D(rng),
    soil: new Noise2D(mulberry32((seed + 404) >>> 0)),
  };
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
  const lerp = (f: Float32Array): number =>
    (f[a] * (1 - tx) + f[b] * tx) * (1 - ty) + (f[c] * (1 - tx) + f[d] * tx) * ty;
  out[0] = lerp(atlas.elev);
  out[1] = lerp(atlas.ridge);
  out[2] = lerp(atlas.moist);
}

function cornerHeight(
  atlas: Atlas,
  f: Fields,
  cfg: AtlasConfig,
  cx: number,
  cy: number,
  size: number,
  out: number[],
): number {
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
  /*
   * Headroom over the chart rather than a limit on it. The old pair, -140 and
   * 480, was the radial generator's range, and `generate.ts` does still reach
   * -140; this generator's chart draws 557 at the caldera rim and -205 on the
   * ocean floor, and the ridged noise and the detail sit on top of that. A
   * clamp biting here would be drawn relief flattened into a shelf, which is
   * what `relief.ts` asserts against.
   */
  return h < -320 ? -320 : h > 700 ? 700 : h;
}

/**
 * Species index by climate: pines and cedars high up, willows near water.
 *
 * On the same vertical scale as BANDS, and for the same reason — these were
 * 95, 7 and 60 against a chart that reached 215, so read as a fraction of the
 * way up rather than as heights.
 */
function pickSpecies(avgHeight: number, moisture: number, r: number): number {
  if (avgHeight > 258) return r < 0.6 ? 1 : 5;
  if (avgHeight < 12 && moisture > 0.1) return r < 0.7 ? 4 : 0;
  if (r > 0.978 && avgHeight < 162) return moisture > 0.2 ? 6 : r > 0.992 ? 8 : 7;
  if (r < 0.32) return 0;
  if (r < 0.6) return 2;
  if (r < 0.78) return 3;
  if (r < 0.9) return 1;
  return 5;
}

export interface AtlasWindow {
  /** (w + 1) x (h + 1) corner heights and soil depths. */
  heights: Int16Array;
  dirt: Uint8Array;
  /** w x h tiles. */
  tiles: Uint8Array;
  data: Uint8Array;
  rock: Uint8Array;
}

/** Heights reach three tiles past the window so nearWater and soil can see out. */
const HALO = 3;

/**
 * Generates one window of the world, complete enough to stand on: heights,
 * tiles, the rock beneath them and the soil over it.
 */
export function generateAtlasWindow(
  seed: number,
  atlas: Atlas,
  x0: number,
  y0: number,
  w: number,
  h: number,
  size = 4096,
  cfg = ATLAS_CONFIG,
): AtlasWindow {
  const f = fields(seed);
  const out = [0, 0, 0];

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

  // Tiles run one past the window on each side, because the soil depth at a
  // corner asks whether any of the four tiles around it is bare rock.
  const tw = w + 2;
  const th = h + 2;
  const halo = new Uint8Array(tw * th);
  const haloData = new Uint8Array(tw * th);
  const haloRock = new Uint8Array(tw * th);
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const wx = x0 - 1 + tx;
      const wy = y0 - 1 + ty;
      const c0 = at(wx, wy);
      const c1 = at(wx + 1, wy);
      const c2 = at(wx + 1, wy + 1);
      const c3 = at(wx, wy + 1);
      const min = Math.min(c0, c1, c2, c3);
      const max = Math.max(c0, c1, c2, c3);
      const avg = (c0 + c1 + c2 + c3) / 4;
      const slope = max - min;
      const reg = regionAt(atlas, wx, wy, size);
      const R = REGIONS[reg];
      sample(atlas, wx / size, wy / size, out);
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
      } else if (avg > BANDS.snow + p * BANDS.snowVary) {
        t = R.snow ? TileType.Snow : TileType.Rock;
      } else if (avg > BANDS.alpine + p * BANDS.alpineVary) {
        t = slope > 22 || !R.tundra ? TileType.Rock : TileType.Tundra;
        if (t === TileType.Tundra && r < 0.05) {
          t = TileType.Tree;
          d = packTreeData(speciesFor(reg, 1, avg, r2), variant);
        }
      } else if (avg > BANDS.hill + p * BANDS.hillVary) {
        if (slope > 30) t = TileType.Rock;
        else if (m > 0.05 && r < 0.45 + m * 0.4) {
          t = TileType.Tree;
          d = packTreeData(speciesFor(reg, r2 < 0.65 ? 1 : 5, avg, r2), variant);
        } else t = R.tundra && r < 0.5 ? TileType.Tundra : TileType.Grass;
      } else if (avg < 5 && m > 0.12) {
        t = TileType.Marsh;
        if (r < 0.08) t = TileType.Peat;
        else if (r > 0.975) t = TileType.Tar;
        else if (r > 0.86) t = TileType.Reed;
        else if (r > 0.76) t = TileType.Clay;
      } else if (avg < 6 && nearWater(wx, wy)) {
        t = TileType.Sand;
        if (r < 0.18) t = TileType.Clay;
      } else if (m < -0.3) {
        t = r2 < R.steppe ? TileType.Steppe : TileType.Grass;
        if (r < 0.015) {
          t = TileType.Tree;
          d = packTreeData(speciesFor(reg, 0, avg, r2), variant);
        } else if (p > 0.5 && r < 0.35) t = TileType.Dirt;
      } else if (m > 0.26) {
        const density = Math.min(0.85, (m - 0.26) * 2.4 + 0.3);
        if (r < density) {
          t = TileType.Tree;
          d = packTreeData(speciesFor(reg, pickSpecies(avg, m, r2), avg, r2), variant);
        } else if (r < density + 0.06) {
          t = TileType.Bush;
          d = Math.floor(r2 * 3);
        } else t = p > 0.25 ? TileType.Moss : TileType.Grass;
      } else {
        t = TileType.Grass;
        if (slope > 24 && r > 0.55) t = TileType.Rock;
        else if (r < 0.035) {
          t = TileType.Tree;
          d = packTreeData(speciesFor(reg, pickSpecies(avg, m, r2), avg, r2), variant);
        } else if (r < 0.05) {
          t = TileType.Bush;
          d = Math.floor(r2 * 3);
        } else if (p > 0.58 && r < 0.6) t = TileType.Dirt;
        else if (p < -0.6) t = TileType.Moss;
        else if (avg < 9 && nearWater(wx, wy) && r < 0.08) t = TileType.Clay;
      }

      halo[ty * tw + tx] = t;
      haloData[ty * tw + tx] = d;
      // Ore on the seabed is ore nobody can reach, so dry land carries the metal.
      const wet = c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0;
      haloRock[ty * tw + tx] = rockKindFor(seed, reg, wx, wy, wet ? ORE_DENSITY.water : ORE_DENSITY.land);
    }
  }

  const tiles = new Uint8Array(w * h);
  const data = new Uint8Array(w * h);
  const rock = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = (y + 1) * tw + (x + 1);
      tiles[y * w + x] = halo[src];
      data[y * w + x] = haloData[src];
      rock[y * w + x] = haloRock[src];
    }
  }

  // Soil over the bedrock: deep in the lowlands, thin on the heights, none at
  // all where rock already breaks the surface.
  const dirt = new Uint8Array((w + 1) * (h + 1));
  for (let cy = 0; cy <= h; cy++) {
    for (let cx = 0; cx <= w; cx++) {
      let bare = false;
      for (let y = cy - 1; y <= cy && !bare; y++) {
        for (let x = cx - 1; x <= cx; x++) {
          const t = halo[(y + 1) * tw + (x + 1)];
          if (t === TileType.Rock || t === TileType.Snow) {
            bare = true;
            break;
          }
        }
      }
      if (bare) continue;
      const height = at(x0 + cx, y0 + cy);
      const n = f.soil.fbm((x0 + cx) * 0.03, (y0 + cy) * 0.03, 3);
      const depth = 14 + n * 8 - Math.max(0, height) * 0.017;
      dirt[cy * (w + 1) + cx] = Math.max(2, Math.min(40, Math.round(depth)));
    }
  }

  return { heights, dirt, tiles, data, rock };
}

/**
 * Builds the whole world in one call. About 22 s and 64 MB of typed arrays at
 * 4096 — run it in a Worker, or prefer generateAtlasWindow per chunk.
 */
export function generateAtlasWorld(
  seed: number,
  atlas: Atlas,
  size = 4096,
  cfg = ATLAS_CONFIG,
): { world: World; spawn: { x: number; y: number } } {
  const r = generateAtlasWindow(seed, atlas, 0, 0, size, size, size, cfg);
  const world = new World(size, size, r.heights, r.tiles, r.data, r.dirt, r.rock);
  world.seed = seed;
  world.recomputeRange();
  return { world, spawn: findBaySpawn(atlas, seed, size) };
}

let zoneCache: { atlas: Atlas; zone: number[] } | null = null;

/**
 * How far above the water a starting tile has to be drawn, as a fraction of
 * the chart's full height, and how far out to look for the sea. The first is
 * low, because it is only there to throw out the texels the chart itself calls
 * waterline; `findBaySpawn` rolls the real ground and decides. The second is
 * in texels of chart, so it is a fixed distance on the ground however finely
 * the chart happens to be drawn.
 *
 * Both are fractions and distances rather than heights on purpose: the chart's
 * scale moves whenever its relief is redrawn, and a floor written as a number
 * of dirt units would quietly stop meaning the same thing the next time it did.
 */
const FOOT = 0.012;
const SHORE = 5;

/** Every beach texel on the inner bay: shore, beach height, inside the bay. */
function spawnZone(atlas: Atlas): number[] {
  if (zoneCache && zoneCache.atlas === atlas) return zoneCache.zone;
  const n = atlas.n;
  const e = atlas.elev;
  const zone: number[] = [];
  for (let y = 1; y < n - 1; y++) {
    for (let x = 1; x < n - 1; x++) {
      const i = y * n + x;
      /*
       * Dry land within sight of the water, rather than the very edge of it.
       *
       * This asked for a texel the chart puts above the water line with a
       * neighbour below it, and that is not the same as a tile you can stand
       * on. The coastal ramp means a texel touching the sea is a unit or two
       * above it; the domain warp then samples the chart up to three texels
       * away, and the detail noise moves the ground three either way on top of
       * that. Two seeds in five landed at a height of minus three — standing
       * in the sea, on a shore tile, with half of what was around them water.
       *
       * So the floor is high enough to survive both, and the sea is looked for
       * a few texels out instead of only next door — which is what makes it a
       * beach rather than a waterline.
       */
      if (e[i] < FOOT || e[i] > 0.09 || atlas.region[i] !== SPAWN_REGION) continue;
      let shore = false;
      for (let dy = -SHORE; dy <= SHORE && !shore; dy++) {
        for (let dx = -SHORE; dx <= SHORE; dx++) {
          const j = i + dy * n + dx;
          if (j >= 0 && j < n * n && e[j] < 0) { shore = true; break; }
        }
      }
      if (!shore) continue;
      const du = x / n - BAY[0];
      const dv = y / n - BAY[1];
      if (du * du + dv * dv > SPAWN_RADIUS * SPAWN_RADIUS) continue;
      zone.push(i);
    }
  }
  zoneCache = { atlas, zone };
  return zone;
}

/**
 * A starting tile on the inner bay beach, chosen by seed. Everyone lands on
 * the same shore, which is what makes it a place rather than a coordinate.
 */
export function findBaySpawn(atlas: Atlas, seed: number, size = 4096): { x: number; y: number } {
  const zone = spawnZone(atlas);
  if (!zone.length) return { x: size >> 1, y: size >> 1 };
  const n = atlas.n;
  const where = (i: number): { x: number; y: number } => ({
    x: Math.round((((i % n) + 0.5) / n) * size),
    y: Math.round(((((i / n) | 0) + 0.5) / n) * size),
  });

  /*
   * The chart is asked which texels are beach, and then the ground is rolled
   * to find out whether they are.
   *
   * Those are not the same question and no amount of tuning the first will
   * make it answer the second. Between the chart and the ground sit the coast
   * warp, which samples the chart up to three texels away from where it is
   * standing, and the detail noise, which moves every corner three either way.
   * Raising the floor the chart had to clear moved which seeds landed badly
   * without reducing how many did — the number it was testing was not the
   * number that decides.
   *
   * So the candidates are walked in a seeded order and each is rolled: a
   * sixteen square window, which is cheap, and the first one that is properly
   * dry with room to walk is where the body goes. The best of what was tried
   * is kept as a fallback, so this always answers even on a chart whose whole
   * bay is marginal.
   */
  const start = Math.floor(hash2(seed, 7, 13) * zone.length);
  let best: { x: number; y: number } | null = null;
  let bestScore = -Infinity;
  let bestUnder = -Infinity;
  const W = 16;
  for (let k = 0; k < 48; k++) {
    const spot = where(zone[(start + k * 37) % zone.length]);
    const win = generateAtlasWindow(seed, atlas, spot.x - W / 2, spot.y - W / 2, W, W, size);
    const cw = W + 1;
    const mid = W / 2;
    const c = [win.heights[mid * cw + mid], win.heights[mid * cw + mid + 1],
      win.heights[(mid + 1) * cw + mid + 1], win.heights[(mid + 1) * cw + mid]];
    const under = Math.min(...c);
    let dry = 0;
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const q = [win.heights[y * cw + x], win.heights[y * cw + x + 1],
          win.heights[(y + 1) * cw + x + 1], win.heights[(y + 1) * cw + x]];
        if (Math.min(...q) >= 0 && Math.max(...q) - Math.min(...q) <= 52) dry++;
      }
    }
    // Standing on dry ground, and over half of what is around you walkable.
    if (under >= 4 && dry >= W * W * 0.55) return spot;
    const score = Math.min(under, 4) * 1000 + dry;
    if (score > bestScore) { bestScore = score; best = spot; bestUnder = under; }
  }

  /*
   * And if the bay has nothing dry on it, look at the island instead.
   *
   * The loop above rolls each candidate and *measures* how far under the water
   * it is, and then the fallback handed back the best of them whatever that
   * measurement said. On a chart whose bay comes out marginal that is a spot
   * it has just read as minus a hundred and sixty-five: the body comes ashore
   * in a hundred and sixty-five feet of water, and a swimmer spends wind
   * instead of getting it back, so it is exhausted inside a minute and stays
   * exhausted until something walks it to dry land. Nothing does.
   *
   * It has never happened on a real island — 4096, 1024 and 256 all answer dry
   * on every seed tried. It happens on 27 seeds in 60 at 64 tiles a side,
   * which is the size the live smoke test rolls, with a fresh random seed
   * every run: a coin flip on whether the run means anything. Fourteen checks
   * went down to it in one run and were read, twice, as a rule that had just
   * changed.
   *
   * So the last resort is a coarse sweep of the whole island rather than a
   * shrug: the same window and the same two questions, over a grid of at most
   * 24 by 24. It is the wrong shore — nobody meant to start here — but it is
   * ground, and the alternative is the sea.
   */
  if (bestUnder < 4) {
    const step = Math.max(1, Math.floor((size - W) / 23));
    for (let gy = 0; gy + W < size; gy += step) {
      for (let gx = 0; gx + W < size; gx += step) {
        const spot = { x: gx + W / 2, y: gy + W / 2 };
        const win = generateAtlasWindow(seed, atlas, gx, gy, W, W, size);
        const cw = W + 1;
        const mid = W / 2;
        const c = [win.heights[mid * cw + mid], win.heights[mid * cw + mid + 1],
          win.heights[(mid + 1) * cw + mid + 1], win.heights[(mid + 1) * cw + mid]];
        const under = Math.min(...c);
        let dry = 0;
        for (let y = 0; y < W; y++) {
          for (let x = 0; x < W; x++) {
            const q = [win.heights[y * cw + x], win.heights[y * cw + x + 1],
              win.heights[(y + 1) * cw + x + 1], win.heights[(y + 1) * cw + x]];
            if (Math.min(...q) >= 0 && Math.max(...q) - Math.min(...q) <= 52) dry++;
          }
        }
        if (under >= 4 && dry >= W * W * 0.55) return spot;
        const score = Math.min(under, 4) * 1000 + dry;
        if (score > bestScore) { bestScore = score; best = spot; bestUnder = under; }
      }
    }
  }

  return best ?? where(zone[start % zone.length]);
}
