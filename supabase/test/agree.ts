/**
 * The island handed over and the island come back to are the same island.
 *
 * Founding uploads what was rolled; joining works the ground out from the seed
 * and never downloads it. If those two generators ever disagree, every player
 * is standing on ground the rules do not believe in — so this rolls a world
 * the founding way and a window the joining way and compares them corner by
 * corner, out here where neither an Image nor a canvas exists.
 */
import { generateAtlasWorld, generateAtlasWindow } from '../../src/world/atlas-world';
import { World } from '../../src/world/world';
import { readAtlas } from '../../tools/atlas-node';

const atlas = readAtlas();
const SIZE = 128;
const SEED = 4242;

const founded = generateAtlasWorld(SEED, atlas, SIZE).world;
const joined = new World(SIZE, SIZE);
joined.seed = SEED;
joined.streamFrom((x0, y0, w, h) => generateAtlasWindow(SEED, atlas, x0, y0, w, h, SIZE));

let corners = 0, tiles = 0, rock = 0, dirt = 0, checked = 0;
for (let y = 0; y <= SIZE; y++) {
  for (let x = 0; x <= SIZE; x++) {
    if (founded.getHeight(x, y) !== joined.getHeight(x, y)) corners++;
    if (founded.getDirt(x, y) !== joined.getDirt(x, y)) dirt++;
    checked++;
  }
}
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (founded.getTile(x, y) !== joined.getTile(x, y)) tiles++;
    if (founded.rockKind(x, y) !== joined.rockKind(x, y)) rock++;
  }
}
console.log(`${checked} corners and ${SIZE * SIZE} tiles compared`);
console.log(`  heights differing: ${corners}`);
console.log(`  soil differing:    ${dirt}`);
console.log(`  tiles differing:   ${tiles}`);
console.log(`  rock differing:    ${rock}`);
console.log(`  squares worked out on the joining side: ${joined.grown}`);
console.log(corners + dirt + tiles + rock === 0
  ? 'the island handed over is the island come back to'
  : 'THEY DISAGREE');
process.exit(corners + dirt + tiles + rock === 0 ? 0 : 1);
