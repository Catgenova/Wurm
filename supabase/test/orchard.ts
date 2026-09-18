/**
 * Eight more trees that bear, held to their islands.
 *
 * Asked for: "add 8 new fruit tree types and disburse their spawn regionally".
 * Two things are measured here. The tile byte first: a tree's species lived
 * in the low nibble and nine fit, so the top bit, which the age never
 * reached, is the fifth bit of the species now, and every byte from before
 * has to read exactly as it did. Then where they grow: the chart's regions
 * each hold their own kinds, the way East Isle held the cherry, and an
 * island of your own, which has no chart, gets them all.
 */
import { REGIONS, speciesFor } from '../../src/world/regions';
import { FRUIT_TREES, ISLAND_FRUIT, TileType, TREE_DEFS, packTreeData, treeSpecies, treeVariant } from '../../src/world/tiles';
import { generateWorld } from '../../src/world/generate';
import { generateAtlasWindow, ATLAS_CONFIG } from '../../src/world/atlas-world';
import { readAtlas } from '../../tools/atlas-node';

let fails = 0;
let n = 0;
function say(what: string, got: unknown, want: unknown): void {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? '  ' : '!!'} ${n}. ${what}: ${JSON.stringify(got)}${ok ? '' : ` — wanted ${JSON.stringify(want)}`}`);
}
const name = (i: number): string => TREE_DEFS[i].name;

console.log('--- the table');
say('trees', TREE_DEFS.length, 17);
say('of which bear', FRUIT_TREES.length, 11);
say('and are held to an island each', ISLAND_FRUIT.map(name), ['Pear', 'Plum', 'Peach', 'Fig', 'Lemon', 'Pomegranate', 'Apricot', 'Quince']);

console.log('\n--- the byte');
let bad: string[] = [];
for (let sp = 0; sp < TREE_DEFS.length; sp++) {
  for (let age = 0; age < 6; age++) {
    const b = packTreeData(sp, age);
    if (b < 0 || b > 255 || treeSpecies(b) !== sp || treeVariant(b) !== age) bad.push(`${sp}/${age}->${b}`);
  }
}
say('every species and age packs into a byte and reads back', bad, []);
say('an old oak from before, 2 | (2 << 4)', [treeSpecies(2 | (2 << 4)), treeVariant(2 | (2 << 4))], [2, 2]);
say('a sapling birch from before, 3 << 4', [treeSpecies(3 << 4), treeVariant(3 << 4)], [0, 3]);
say('a very old quince is 16 with the top bit', packTreeData(16, 4), 16 - 16 + 128 + (4 << 4));
say('and reads back', [treeSpecies(packTreeData(16, 4)), treeVariant(packTreeData(16, 4))], [16, 4]);
say('a byte off the table clamps to the last tree', treeSpecies(255), TREE_DEFS.length - 1);

console.log('\n--- the chart: what each region grows where the climate rolled a fruit tree');
const APPLE = TREE_DEFS.findIndex((t) => t.name === 'Apple');
const CHERRY = TREE_DEFS.findIndex((t) => t.name === 'Cherry');
const natives = new Map<number, Set<number>>();
REGIONS.forEach((R, i) => natives.set(i, new Set(R.trees.filter((s) => FRUIT_TREES.includes(s)))));
const foreign: string[] = [];
REGIONS.forEach((R, i) => {
  const seen = new Map<number, number>();
  for (let k = 0; k < 4000; k++) {
    const r = 0.978 + (k / 4000) * 0.022;
    const sp = speciesFor(i, APPLE, 50, r);
    seen.set(sp, (seen.get(sp) ?? 0) + 1);
  }
  const own = natives.get(i) as Set<number>;
  const kinds = [...seen.keys()].sort((a, b) => a - b);
  for (const sp of kinds) {
    if (!FRUIT_TREES.includes(sp)) continue;
    if (sp === APPLE) continue;
    if (sp === CHERRY && own.has(CHERRY)) continue;
    if (!own.has(sp)) foreign.push(`${R.key}:${name(sp)}`);
  }
  console.log(`   ${R.name}: ${kinds.map((sp) => `${name(sp)} ${seen.get(sp)}`).join(', ')}`);
  say(`${R.key} grows its own`, [...own].filter((sp) => sp !== CHERRY).every((sp) => (seen.get(sp) ?? 0) > 0), true);
});
say('and nothing that is held to another island', foreign, []);

console.log('\n--- the chart itself, a window at the middle of each region');
const atlas = readAtlas();
const SIZE = 4096;
const W = 96;
const SEED = 4242;
REGIONS.forEach((R, i) => {
  const ox = Math.round(R.at[0] * SIZE) - W / 2;
  const oy = Math.round(R.at[1] * SIZE) - W / 2;
  const win = generateAtlasWindow(SEED, atlas, ox, oy, W, W, SIZE, ATLAS_CONFIG);
  const seen = new Map<number, number>();
  let trees = 0;
  for (let k = 0; k < W * W; k++) {
    if (win.tiles[k] !== TileType.Tree) continue;
    trees++;
    const sp = treeSpecies(win.data[k]);
    if (FRUIT_TREES.includes(sp)) seen.set(sp, (seen.get(sp) ?? 0) + 1);
  }
  const own = natives.get(i) as Set<number>;
  const strays = [...seen.keys()].filter((sp) => sp !== APPLE && !own.has(sp) && !(sp === CHERRY && own.has(CHERRY)) && name(sp) !== 'Olive').map(name);
  console.log(`   ${R.name}: ${trees} trees, bearing ${[...seen.entries()].map(([sp, c]) => `${name(sp)} ${c}`).join(', ') || 'none'}`);
  say(`${R.key} has no stray kinds`, strays, []);
});

console.log('\n--- an island of your own, which has no chart');
const own = generateWorld(SEED, 256).world;
const seen = new Map<number, number>();
for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
  if (own.getTile(x, y) !== TileType.Tree) continue;
  const sp = treeSpecies(own.getData(x, y));
  if (FRUIT_TREES.includes(sp)) seen.set(sp, (seen.get(sp) ?? 0) + 1);
}
console.log(`   bearing: ${[...seen.entries()].sort((a, b) => a[0] - b[0]).map(([sp, c]) => `${name(sp)} ${c}`).join(', ')}`);
say('every one of the eight comes up somewhere on it', ISLAND_FRUIT.filter((sp) => !(seen.get(sp) ?? 0)).map(name), []);

console.log(fails ? `\n${fails} of ${n} wrong` : `\nall ${n} right`);
process.exit(fails ? 1 : 0);
