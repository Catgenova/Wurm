import { hash2, mulberry32, Noise2D, smoothstep } from './noise';
import { TileType, packTreeData } from './tiles';
import { World } from './world';

export interface GeneratedWorld {
  world: World;
  spawn: { x: number; y: number };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Species index by climate: pines and cedars high up, willows near water. */
function pickSpecies(avgHeight: number, moisture: number, r: number): number {
  if (avgHeight > 95) return r < 0.6 ? 1 : 5;
  if (avgHeight < 7 && moisture > 0.1) return r < 0.7 ? 4 : 0;
  if (r < 0.32) return 0; // birch
  if (r < 0.6) return 2; // oak
  if (r < 0.78) return 3; // maple
  if (r < 0.9) return 1; // pine
  return 5; // cedar
}

/** Builds an island: fbm terrain, a ridged mountain layer and a coastline mask. */
export function generateWorld(seed: number, size = 256): GeneratedWorld {
  const rng = mulberry32(seed);
  const elev = new Noise2D(rng);
  const ridge = new Noise2D(rng);
  const moist = new Noise2D(rng);
  const detail = new Noise2D(rng);
  const patch = new Noise2D(rng);

  const world = new World(size, size);
  const cw = size + 1;

  for (let cy = 0; cy <= size; cy++) {
    for (let cx = 0; cx <= size; cx++) {
      const nx = cx / size - 0.5;
      const ny = cy / size - 0.5;
      const dEuclid = Math.hypot(nx, ny) * 2;
      const dSquare = Math.max(Math.abs(nx), Math.abs(ny)) * 2;
      const d = dEuclid * 0.65 + dSquare * 0.35;
      const wobble = detail.fbm(nx * 4 + 3.7, ny * 4 - 1.3, 3) * 0.16;
      const mask = 1 - smoothstep(0.58 + wobble, 0.96, d);

      const base = elev.fbm(nx * 3.1, ny * 3.1, 5, 2.05, 0.5);
      const e = (base * 0.5 + 0.5) * mask;
      let land = e - 0.34;
      if (land < 0) land *= 3.2;

      const rv = 1 - Math.abs(ridge.fbm(nx * 2.3 + 11, ny * 2.3 + 5, 4));
      const mtn = Math.pow(Math.max(0, rv - 0.5) / 0.5, 2.2) * Math.max(0, mask - 0.15) * Math.max(0, e - 0.32);

      let h = land * 170 + mtn * 520;
      h += detail.noise(cx * 0.35, cy * 0.35) * 2.2 + detail.noise(cx * 1.3 + 40, cy * 1.3) * 0.8;
      world.heights[cy * cw + cx] = Math.round(clamp(h, -140, 480));
    }
  }
  world.recomputeRange();

  const nearWater = (x: number, y: number): boolean => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (world.inBounds(xx, yy) && world.hasWater(xx, yy)) return true;
      }
    }
    return false;
  };

  const c = [0, 0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      world.corners(x, y, c);
      const min = Math.min(c[0], c[1], c[2], c[3]);
      const max = Math.max(c[0], c[1], c[2], c[3]);
      const avg = (c[0] + c[1] + c[2] + c[3]) / 4;
      const slope = max - min;
      const m = moist.fbm(x * 0.021 + 5, y * 0.021 + 9, 4);
      const p = patch.fbm(x * 0.085, y * 0.085, 2);
      const r = hash2(x, y, seed);
      const r2 = hash2(x, y, seed + 77);
      const variant = Math.floor(hash2(x, y, seed + 3) * 3);

      let t: TileType = TileType.Grass;
      let data = 0;

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
        t = TileType.Snow;
      } else if (avg > 160 + p * 22) {
        t = slope > 22 ? TileType.Rock : TileType.Tundra;
        if (t === TileType.Tundra && r < 0.05) {
          t = TileType.Tree;
          data = packTreeData(1, variant);
        }
      } else if (avg > 108 + p * 18) {
        if (slope > 30) t = TileType.Rock;
        else if (m > 0.05 && r < 0.45 + m * 0.4) {
          t = TileType.Tree;
          data = packTreeData(r2 < 0.65 ? 1 : 5, variant);
        } else t = r < 0.5 ? TileType.Tundra : TileType.Grass;
      } else if (avg < 5 && m > 0.12) {
        t = TileType.Marsh;
        if (r < 0.08) t = TileType.Peat;
        else if (r > 0.975) t = TileType.Tar;
        else if (r > 0.86) t = TileType.Reed;
      } else if (avg < 6 && nearWater(x, y)) {
        t = TileType.Sand;
        if (r < 0.09) t = TileType.Clay;
      } else if (m < -0.3) {
        t = TileType.Steppe;
        if (r < 0.015) {
          t = TileType.Tree;
          data = packTreeData(0, variant);
        } else if (p > 0.5 && r < 0.35) t = TileType.Dirt;
      } else if (m > 0.26) {
        const density = Math.min(0.85, (m - 0.26) * 2.4 + 0.3);
        if (r < density) {
          t = TileType.Tree;
          data = packTreeData(pickSpecies(avg, m, r2), variant);
        } else if (r < density + 0.06) {
          t = TileType.Bush;
          data = Math.floor(r2 * 3);
        } else t = p > 0.25 ? TileType.Moss : TileType.Grass;
      } else {
        t = TileType.Grass;
        if (slope > 24 && r > 0.55) t = TileType.Rock;
        else if (r < 0.035) {
          t = TileType.Tree;
          data = packTreeData(pickSpecies(avg, m, r2), variant);
        } else if (r < 0.05) {
          t = TileType.Bush;
          data = Math.floor(r2 * 3);
        } else if (p > 0.58 && r < 0.6) t = TileType.Dirt;
        else if (p < -0.6) t = TileType.Moss;
        else if (avg < 9 && nearWater(x, y) && r < 0.08) t = TileType.Clay;
      }

      world.setTile(x, y, t, data);
    }
  }

  return { world, spawn: findSpawn(world) };
}

/** A gentle grass tile as close to the centre as possible. */
export function findSpawn(world: World): { x: number; y: number } {
  const cx = Math.floor(world.w / 2);
  const cy = Math.floor(world.h / 2);
  for (let radius = 0; radius < world.w / 2; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!world.inBounds(x, y)) continue;
        const t = world.getTile(x, y);
        if ((t === TileType.Grass || t === TileType.Steppe) && world.slope(x, y) <= 8 && world.centerHeight(x, y) >= 6) {
          return { x, y };
        }
      }
    }
  }
  return { x: cx, y: cy };
}
