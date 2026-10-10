/**
 * Where the Runestones stand (`src/game/runestones.ts`), worked out once and
 * written into `RUNESTONES` by hand; run again to check them.
 *
 * Each stone was circled on the owner's screenshot of the generated map, a
 * little inland, and stands on the shore nearest that circle: the nearest
 * three by three to the circled tile, searching outward from it, whose sixteen
 * corners are all at least `MARGIN` over the water line and no more than
 * `LEVEL` apart (dry and level), and at least one tile of whose border ring --
 * the sixteen tiles just outside its nine -- is the sea on the generated ground
 * (`World.hasSea`: a corner below nothing, and joined side to side to the
 * deepest water in reach, the bay's floor, so that a pond the noise leaves
 * inland is not a shore). Ties go to the north, then the west.
 *
 * The chart is every island's, but the coast warp and the detail noise are the
 * seed's, so the shore moves a little from seed to seed. There is one island,
 * founded at 4096 with seed `LIVE_SEED` (the README's "The island the keeper
 * serves"), and the stones are settled on its ground. The tool says, for each,
 * on how many of `SEEDS` the same spot is also dry, level and on the water,
 * for whoever founds another.
 *
 * With `--ground` it prints instead the generated ground under each stone on
 * the live seed -- each of its nine tiles' tile, data and rock bytes and each
 * of its sixteen corners' height and soil -- as the rows of `runestone_ground`
 * the clearing migration puts the island's ground back to
 * (`..._runestones_clear_their_ground.sql`); `supabase/test/telestone.ts`
 * holds the rows to the generator.
 *
 *   npx esbuild tools/runestone-spots.ts --bundle --platform=node --format=esm \
 *     --outfile=node_modules/.cache/runestone-spots.mjs && node node_modules/.cache/runestone-spots.mjs [--ground]
 */
import { readAtlas } from './atlas-node';
import { generateAtlasWindow } from '../src/world/atlas-world';
import { RUNESTONES, STONE_CHART, STONE_HALF, STONE_SEED } from '../src/game/runestones';

/** The tiles circled on the screenshot, fitted at 98%: where each stone was first put, inland. */
const CIRCLED: Record<string, [number, number]> = {
  crownstone: [2108, 2859],
  mossmere: [1591, 2976],
  harrowmark: [2551, 2973],
  wardenfall: [1441, 3159],
  sunreach: [2748, 3157],
};
/** The live island's seed. */
const LIVE_SEED = STONE_SEED;
/** Furthest from the circled tile a spot is looked for, in tiles. */
const REACH = 160;
const SEEDS = Array.from({ length: 32 }, (_, i) => i + 1);
const LEVEL = 24;
const MARGIN = 1;
const H = STONE_HALF;

interface Ground { x0: number; y0: number; W: number; h: (x: number, y: number) => number; sea: Uint8Array }

/** Water on a tile of the generated ground: a corner below nothing (`World.hasSea`). */
const wetAt = (h: (x: number, y: number) => number, x: number, y: number): boolean =>
  h(x, y) < 0 || h(x + 1, y) < 0 || h(x + 1, y + 1) < 0 || h(x, y + 1) < 0;

function ground(seed: number, cx: number, cy: number): Ground {
  const pad = REACH + H + 2;
  const x0 = cx - pad, y0 = cy - pad, W = 2 * pad + 1;
  const win = generateAtlasWindow(seed, readAtlasOnce(), x0, y0, W, W, STONE_CHART);
  const h = (x: number, y: number): number => win.heights[(y - y0) * (W + 1) + (x - x0)];
  // The sea: the water joined, side to side, to the deepest tile of the window, which is the bay's floor.
  // A pond or a lake left inland by the noise is water but not a shore.
  const sea = new Uint8Array(W * W);
  let deep = 0;
  for (let i = 1; i < W * W; i++) if (h(x0 + (i % W), y0 + Math.floor(i / W)) < h(x0 + (deep % W), y0 + Math.floor(deep / W))) deep = i;
  const todo = [deep];
  sea[deep] = 1;
  while (todo.length) {
    const i = todo.pop()!;
    const x = i % W, y = Math.floor(i / W);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, j = ny * W + nx;
      if (nx < 0 || ny < 0 || nx >= W || ny >= W || sea[j] || !wetAt(h, x0 + nx, y0 + ny)) continue;
      sea[j] = 1;
      todo.push(j);
    }
  }
  return { x0, y0, W, h, sea };
}

let atlas: ReturnType<typeof readAtlas> | null = null;
const readAtlasOnce = () => (atlas ??= readAtlas());

/** Dry and level: the sixteen corners of the nine tiles round (`bx`, `by`). */
function dryLevel(g: Ground, bx: number, by: number): boolean {
  let lo = Infinity, hi = -Infinity;
  for (let j = -H; j <= H + 1; j++) {
    for (let i = -H; i <= H + 1; i++) {
      const v = g.h(bx + i, by + j);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  return lo >= MARGIN && hi - lo <= LEVEL;
}

/** The sea on a tile of the generated ground. */
const wet = (g: Ground, x: number, y: number): boolean => g.sea[(y - g.y0) * g.W + (x - g.x0)] === 1;

/** On the water: a tile of the ring just outside the nine is the sea's. */
function onWater(g: Ground, bx: number, by: number): boolean {
  const r = H + 1;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && wet(g, bx + dx, by + dy)) return true;
  }
  return false;
}

const shore = (g: Ground, bx: number, by: number): boolean => dryLevel(g, bx, by) && onWater(g, bx, by);

if (process.argv.includes('--ground')) {
  const rows: string[] = [];
  for (const s of RUNESTONES) {
    const x0 = s.x - H, y0 = s.y - H, n = 2 * H + 1;
    const win = generateAtlasWindow(LIVE_SEED, readAtlasOnce(), x0, y0, n, n, STONE_CHART);
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const c = j * (n + 1) + i;
        const t = j < n && i < n ? j * n + i : -1;
        const tile = t < 0 ? 'null, null, null' : `${win.tiles[t]}, ${win.data[t]}, ${win.rock[t]}`;
        rows.push(`(${LIVE_SEED}, ${STONE_CHART}, ${x0 + i}, ${y0 + j}, ${tile}, ${win.heights[c]}, ${win.dirt[c]})`);
      }
    }
  }
  console.log(`insert into runestone_ground (seed, size, x, y, tile, data, rock, height, dirt) values\n  ${rows.join(',\n  ')}\non conflict do nothing;`);
  process.exit(0);
}

let agree = true;
for (const s of RUNESTONES) {
  const [cx, cy] = CIRCLED[s.id];
  const live = ground(LIVE_SEED, cx, cy);
  const spots: Array<{ x: number; y: number; d: number }> = [];
  for (let by = cy - REACH; by <= cy + REACH; by++) {
    for (let bx = cx - REACH; bx <= cx + REACH; bx++) {
      const d = Math.hypot(bx - cx, by - cy);
      if (d <= REACH) spots.push({ x: bx, y: by, d });
    }
  }
  spots.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  const best = spots.find((p) => shore(live, p.x, p.y));
  if (!best) {
    console.log(`${s.name}: circled ${cx},${cy}; no shore within ${REACH} tiles on seed ${LIVE_SEED}`);
    agree = false;
    continue;
  }
  const held = SEEDS.filter((seed) => shore(seed === LIVE_SEED ? live : ground(seed, cx, cy), best.x, best.y)).length;
  const same = best.x === s.x && best.y === s.y;
  agree &&= same;
  console.log(`${s.name}: circled ${cx},${cy}; stands on ${best.x},${best.y}, ${best.d.toFixed(1)} tiles off, on the shore of seed ${LIVE_SEED}`
    + ` (and of ${held} of seeds ${SEEDS[0]}-${SEEDS[SEEDS.length - 1]})${same ? '' : `, but RUNESTONES has ${s.x},${s.y}`}`);
}
if (!agree) process.exit(1);
