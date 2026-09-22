import { hash2, mulberry32, Noise2D, smoothstep } from './noise';
import { ISLAND_FRUIT, SAPLING_SHARE, TileType, packTreeData } from './tiles';
import { oreKindFor, ORE_DENSITY, stoneKindAt } from './ore';
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
  // The three that bear turn up wild here and there in the warm low country,
  // one tree in fifty or so. An orchard is something you plant.
  if (r > 0.978 && avgHeight < 60) {
    // Half of them the eight kinds the chart holds to an island each: an
    // island of your own has no chart, so it has them all.
    const f = (r * 997) % 1;
    if (f < 0.5) return ISLAND_FRUIT[Math.floor(f * 2 * ISLAND_FRUIT.length)];
    return moisture > 0.2 ? 6 : r > 0.992 ? 8 : 7;
  }
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
  /*
   * Beds and stands, which come in patches rather than specks.
   *
   * Everything that sits in the ground was picked out of `hash2`: white
   * noise, a fresh roll per tile with no regard for the tile beside it. On
   * seed 7's island that left 2234 tiles of clay in 1774 separate pieces,
   * 98% of that clay in pieces of four tiles or fewer, and the peat and the
   * tar in pieces of four or fewer to the last tile. In a bog, where the
   * join rule puts a ruffle wherever two grounds grow unlike amounts, it
   * came to two of every four tile sides carrying one, and the bog read as
   * confetti.
   *
   * It is also just wrong. A peat bank is a bank you cut into, a clay pit is
   * a pit, tar seeps up in one place and reeds grow in stands. None of them
   * is one square metre of ground surrounded by marsh.
   *
   * So they come off a smooth sheet instead, read at three places far enough
   * apart to be uncorrelated. The same island after: the clay in pieces of
   * four or fewer down from 98% to 22% and the peat from 100% to 55%, and
   * 1.34 ruffled sides a tile rather than 2.00, which is also 16% off the
   * frame time looking across a bog at full zoom.
   *
   * Kelp stays on white noise on purpose. Weed does scatter, and a kelp tile
   * is painted as the sand it grows out of, so a lone one costs neither a
   * join nor a break in the colour.
   */
  const bed = new Noise2D(rng);
  /**
   * Peat, and the tar that seeps up through it.
   *
   * The scale was measured rather than guessed, because it is the whole
   * point. A bed is about the tenth of the sheet standing highest, and how
   * big a piece that tenth comes out in is set by how coarse the sheet is.
   * On the open sheet this one gives a middle piece of 12 tiles, one piece
   * in twenty a single tile, 3% of the area in pieces of four or fewer.
   * Twice the frequency with the usual half-weight second octave gives a
   * middle piece of 2 and half the area back in pieces of four or fewer,
   * which is the confetti this replaces -- hence a third of the weight on
   * the second octave rather than half, because a rougher sheet crumbles its
   * own peaks at the cut. Laying the sheet in a bog clips it, so the pieces
   * that reach the ground are smaller than those open-sheet figures.
   */
  const bedded = (x: number, y: number): number => bed.fbm(x * 0.07 + 31, y * 0.07 - 17, 2, 2, 0.3);
  /** Clay at the surface, in a bog or along a shore. */
  const clayey = (x: number, y: number): number => bed.fbm(x * 0.07 - 213, y * 0.07 + 97, 2, 2, 0.3);
  /** A stand of reeds, in a bog or standing out of the shallows. Tighter than a bed. */
  const reedy = (x: number, y: number): number => bed.fbm(x * 0.09 + 101, y * 0.09 + 57, 2, 2, 0.3);

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

  world.seed = seed;
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
      // A slice of any wood is scrub; the rest is spread over the three grown ages.
      const treeRoll = hash2(x, y, seed + 3);
      const variant = treeRoll < SAPLING_SHARE ? 3
        : Math.floor(((treeRoll - SAPLING_SHARE) / (1 - SAPLING_SHARE)) * 3);

      let t: TileType = TileType.Grass;
      let data = 0;

      if (max < 0) {
        t = avg < -28 ? TileType.Dirt : TileType.Sand;
        if (avg > -22 && avg < -4 && r < 0.09) t = TileType.Kelp;
        else if (avg >= -4 && reedy(x, y) > 0.319) t = TileType.Reed;
      } else if (min < 0) {
        t = TileType.Sand;
        if (m > 0.15 && reedy(x, y) > 0.226 && slope < 12) t = TileType.Reed;
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
        /*
         * How far into the wet this is: -0.5 out at the bog's rim, +0.5 in
         * the middle of it. What is in the ground follows it. Peat is laid
         * down where the water has stood longest, so a bank of it thickens
         * toward the middle; the mineral floor the bog sits on shows through
         * as clay round the rim, where the peat over it is thinnest; and the
         * reeds stand in the wettest of it. The island bears it out -- mean
         * wetness over three seeds runs clay 0.24, marsh 0.29, peat 0.33,
         * reed 0.34, tar 0.36.
         */
        const deep = clamp((m - 0.12) / 0.3, 0, 1) - 0.5;
        const bd = bedded(x, y);
        t = TileType.Marsh;
        if (reedy(x, y) > 0.451 - deep * 0.24) t = TileType.Reed;
        // Tar is the top of the same band peat is the rest of, so it comes up
        // through a peat bank rather than lying in the marsh as a bed of its
        // own: 40-47% of a tar tile's sides are peat and 2-5% marsh, the rest
        // being the bog's own outer edge, where a seep can reach the shore.
        else if (bd > 0.44 - deep * 0.24) t = bd > 0.62 - deep * 0.24 ? TileType.Tar : TileType.Peat;
        // Clay sits in the wet ground of a marsh as readily as it does on a shore.
        else if (clayey(x, y) < -0.44 - deep * 0.24) t = TileType.Clay;
      } else if (avg < 6 && nearWater(x, y)) {
        t = TileType.Sand;
        if (clayey(x, y) < -0.364) t = TileType.Clay;
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
        else if (avg < 9 && nearWater(x, y) && clayey(x, y) < -0.505) t = TileType.Clay;
      }

      world.setTile(x, y, t, data);
    }
  }

  /*
   * The rock under every tile, settled once and for all. Slate and marble run
   * in broad bands with sandstone through the low country, and metal is laid
   * into it — far more thickly under dry land than under the sea, since ore on
   * the seabed is ore nobody can reach.
   */
  world.fillRock((x, y) => {
    const density = world.hasWater(x, y) ? ORE_DENSITY.water : ORE_DENSITY.land;
    const ore = oreKindFor(seed, x, y, density);
    return ore >= 0 ? ore : stoneKindAt(seed, x, y);
  });

  // Soil over the bedrock: deep in the lowlands, thin on the heights, none at
  // all where rock already breaks the surface.
  const soil = new Noise2D(mulberry32((seed + 404) >>> 0));
  for (let cy = 0; cy <= size; cy++) {
    for (let cx = 0; cx <= size; cx++) {
      let bare = false;
      for (let y = cy - 1; y <= cy && !bare; y++) {
        for (let x = cx - 1; x <= cx; x++) {
          if (!world.inBounds(x, y)) continue;
          const t = world.getTile(x, y);
          if (t === TileType.Rock || t === TileType.Snow) {
            bare = true;
            break;
          }
        }
      }
      if (bare) {
        world.dirt[cy * world.cw + cx] = 0;
        continue;
      }
      const h = world.getHeight(cx, cy);
      const n = soil.fbm(cx * 0.03, cy * 0.03, 3);
      const depth = 14 + n * 8 - Math.max(0, h) * 0.045;
      world.dirt[cy * world.cw + cx] = Math.max(2, Math.min(40, Math.round(depth)));
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
