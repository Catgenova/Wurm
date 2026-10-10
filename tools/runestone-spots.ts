/**
 * Where the Runestones settle (`src/game/runestones.ts`), worked out once and
 * written into `RUNESTONES` by hand; run again to check them.
 *
 * Each stone was circled on the owner's screenshot of the generated map. It
 * settles on the nearest three by three within `REACH` tiles of the circled
 * tile whose sixteen corners are all at least `MARGIN` over the water line and
 * no more than `LEVEL` apart, on the generated ground of every one of `SEEDS`
 * seeds -- the chart is every island's, but the coast warp and the detail
 * noise are the seed's, so a spot has to hold for any island founded. Ties go
 * to the nearest. All five settled on the circled tile itself.
 *
 *   npx esbuild tools/runestone-spots.ts --bundle --platform=node --format=esm \
 *     --outfile=node_modules/.cache/runestone-spots.mjs && node node_modules/.cache/runestone-spots.mjs
 */
import { readAtlas } from './atlas-node';
import { generateAtlasWindow } from '../src/world/atlas-world';
import { World } from '../src/world/world';
import { RUNESTONES, STONE_HALF } from '../src/game/runestones';

/** The tiles circled on the screenshot, fitted at 98%. */
const CIRCLED: Record<string, [number, number]> = {
  crownstone: [2108, 2859],
  mossmere: [1591, 2976],
  harrowmark: [2551, 2973],
  wardenfall: [1441, 3159],
  sunreach: [2748, 3157],
};
const REACH = 12;
const SEEDS = Array.from({ length: 32 }, (_, i) => i + 1);
const LEVEL = 24;
const MARGIN = 1;
const SPAN = 2 * STONE_HALF + 1;

const atlas = readAtlas();
let agree = true;
for (const s of RUNESTONES) {
  const [cx, cy] = CIRCLED[s.id];
  const x0 = cx - REACH - SPAN, y0 = cy - REACH - SPAN, W = 2 * (REACH + SPAN) + 1;
  const held = new Map<string, number>();
  for (const seed of SEEDS) {
    const win = generateAtlasWindow(seed, atlas, x0, y0, W, W, 4096);
    const g = new World(W, W, win.heights, win.tiles, win.data, win.dirt, win.rock);
    for (let by = cy - REACH; by <= cy + REACH; by++) {
      for (let bx = cx - REACH; bx <= cx + REACH; bx++) {
        let lo = Infinity, hi = -Infinity;
        for (let j = -STONE_HALF; j <= STONE_HALF + 1; j++) {
          for (let i = -STONE_HALF; i <= STONE_HALF + 1; i++) {
            const h = g.getHeight(bx - x0 + i, by - y0 + j);
            lo = Math.min(lo, h);
            hi = Math.max(hi, h);
          }
        }
        if (lo >= MARGIN && hi - lo <= LEVEL) held.set(`${bx},${by}`, (held.get(`${bx},${by}`) ?? 0) + 1);
      }
    }
  }
  const best = [...held.entries()].map(([k, n]) => {
    const [x, y] = k.split(',').map(Number);
    return { x, y, n, d: Math.hypot(x - cx, y - cy) };
  }).sort((a, b) => b.n - a.n || a.d - b.d)[0];
  const same = !!best && best.x === s.x && best.y === s.y;
  agree &&= same;
  console.log(`${s.name}: circled ${cx},${cy}; settles on ${best?.x},${best?.y} (dry and level on ${best?.n} of ${SEEDS.length} seeds, ${best?.d.toFixed(1)} tiles off)`
    + `${same ? '' : `, but RUNESTONES has ${s.x},${s.y}`}`);
}
if (!agree) process.exit(1);
