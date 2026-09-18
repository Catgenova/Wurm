/**
 * A bare face shows the rock it is made of.
 *
 * Reported: "ore and seams that spawn on bare rock spots should display as the
 * actual ore or seams, not bare rock". They did not. A tile is turned to Rock
 * two ways, and only one of them wrote down what the rock was:
 *
 *   * Dug bare. `World.reconcile` sets the tile with `rockKind` as its data
 *     byte, and the island does the same thing in the same words
 *     (`land_set_data(x, y, land_rock(x, y))`). The byte is right.
 *
 *   * Laid down by the generator. `generateAtlasWindow` puts the rock in its
 *     own array — the bedrock under every tile, bare or buried — and leaves
 *     the tile's data byte at nought. The byte says kind 0, which is plain
 *     grey stone.
 *
 * Every seam that broke the surface when an island was made is the second
 * sort, and the drawing read the byte. So a copper vein on a hillside was
 * drawn and named as Rock — while the rules underneath knew exactly what it
 * was, because `bedrockAt` and `oreAt` read the rock array: mining one of
 * those faces has always given up copper, and prospecting has always found it.
 * Only the picture lied.
 *
 * The fix is `World.rockFace`, which asks the rock array, and the three places
 * that draw or name a face now ask it: the renderer, the minimap and
 * `tileName`. The generator is not touched — `data` is a wire format sent on
 * founding day, and moving it moves the ground under every island already
 * standing (`supabase/test/ground.ts`).
 *
 * Measured here on the same ground the pin test uses.
 */
import { generateAtlasWindow } from '../../src/world/atlas-world';
import { readAtlas } from '../../tools/atlas-node';
import { World } from '../../src/world/world';
import { ROCK_VARIANTS, TILE_DEFS, TileType, isSeam, rockVariant } from '../../src/world/tiles';
import { bedrockAt, oreAt } from '../../src/world/ore';

const SIZE = 256;
const SEED = 4242;

let bad = 0;
const say = (ok: boolean, line: string): void => {
  if (!ok) bad++;
  console.log(`${ok ? '  ' : 'X '}${line}`);
};

const atlas = readAtlas();
const win = generateAtlasWindow(SEED, atlas, 0, 0, SIZE, SIZE, SIZE);
const world = new World(SIZE, SIZE, win.heights, win.tiles, win.data, win.dirt, win.rock);
world.seed = SEED;

/* Every bare rock tile the generator laid down, and what is in it. */
const faces: Array<{ x: number; y: number; kind: number }> = [];
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (win.tiles[y * SIZE + x] !== TileType.Rock) continue;
    faces.push({ x, y, kind: win.rock[y * SIZE + x] });
  }
}
const seams = faces.filter((f) => isSeam(ROCK_VARIANTS[f.kind]));
const kinds = new Map<string, number>();
for (const f of seams) kinds.set(ROCK_VARIANTS[f.kind].name, (kinds.get(ROCK_VARIANTS[f.kind].name) ?? 0) + 1);

console.log(`${SIZE} x ${SIZE} of seed ${SEED}: ${faces.length} bare rock tiles, ${seams.length} of them a seam`);
for (const [name, n] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${name}`);
say(seams.length > 0, `there is something to look at: ${seams.length} seams break the surface`);

/* The bug, kept in sight: the byte the drawing used to read says plain rock. */
const byteSaysRock = seams.filter((f) => rockVariant(win.data[f.y * SIZE + f.x]) === 0).length;
say(byteSaysRock === seams.length,
  `the generator still leaves every one of their data bytes at nought: ${byteSaysRock} of ${seams.length}`);

/* And the fix: the face, the name and the rules all say the same thing. */
let wrongFace = 0;
let wrongName = 0;
let wrongRules = 0;
for (const f of faces) {
  if (world.rockFace(f.x, f.y) !== f.kind) wrongFace++;
  if (world.tileName(f.x, f.y) !== ROCK_VARIANTS[f.kind].name) wrongName++;
  const ore = oreAt(world, f.x, f.y);
  if (!!ore !== isSeam(ROCK_VARIANTS[f.kind])) wrongRules++;
  else if (ore && ore.yields !== ROCK_VARIANTS[world.rockFace(f.x, f.y)].yields) wrongRules++;
}
say(wrongFace === 0, `every bare face draws as the rock under it: ${faces.length - wrongFace} of ${faces.length}`);
say(wrongName === 0, `and names itself the same: ${faces.length - wrongName} of ${faces.length}`);
say(wrongRules === 0, `and the picture agrees with what mining would give up: ${faces.length - wrongRules} of ${faces.length}`);

const sample = seams[0];
console.log(`one of them, at ${sample.x}, ${sample.y}: ${world.tileName(sample.x, sample.y)}, ` +
  `colour ${ROCK_VARIANTS[world.rockFace(sample.x, sample.y)].color.join(',')} ` +
  `rather than ${ROCK_VARIANTS[0].color.join(',')}`);
say(world.tileName(sample.x, sample.y) !== 'Rock', `it is not called Rock any more: ${world.tileName(sample.x, sample.y)}`);
say(ROCK_VARIANTS[world.rockFace(sample.x, sample.y)].color.join(',') !== ROCK_VARIANTS[0].color.join(','),
  'and it is not drawn in the colour of plain stone');

/* The other way a tile turns to rock: dug bare. Its byte is written, and the
 * face reads the same either way. */
let dug: { x: number; y: number; kind: number } | null = null;
const GROUND = new Set<TileType>([TileType.Grass, TileType.Dirt, TileType.Moss, TileType.Tundra, TileType.Steppe]);
for (let y = 1; y < SIZE - 1 && !dug; y++) {
  for (let x = 1; x < SIZE - 1; x++) {
    // Not a bed — `reconcile` leaves clay, sand, peat and tar exactly as they
    // are — and not already rock, so the dig has somewhere to go.
    const t = win.tiles[y * SIZE + x] as TileType;
    if (!GROUND.has(t) || TILE_DEFS[t]?.collect) continue;
    const kind = win.rock[y * SIZE + x];
    if (!isSeam(ROCK_VARIANTS[kind])) continue;
    if (world.getHeight(x, y) < 0) continue;
    dug = { x, y, kind };
    break;
  }
}
if (!dug) {
  say(false, 'no buried seam to dig down to');
} else {
  for (let cy = dug.y; cy <= dug.y + 1; cy++) for (let cx = dug.x; cx <= dug.x + 1; cx++) world.setDirt(cx, cy, 0);
  world.reconcile(dug.x, dug.y);
  const name = ROCK_VARIANTS[dug.kind].name;
  say(world.getTile(dug.x, dug.y) === TileType.Rock, `digging ${dug.x}, ${dug.y} to the bedrock leaves rock`);
  say(rockVariant(world.getData(dug.x, dug.y)) === dug.kind, `and writes the kind into its byte, as the island does: ${name}`);
  say(world.rockFace(dug.x, dug.y) === dug.kind, `and the face reads the same either way: ${name}`);
  say(bedrockAt(world, dug.x, dug.y).yields === ROCK_VARIANTS[dug.kind].yields, `and mining it would give up ${ROCK_VARIANTS[dug.kind].yields}`);
}

if (bad) {
  console.error(`${bad} of them are not what they should be`);
  process.exit(1);
}
console.log('a bare face shows the rock it is made of, whichever way it came to be bare');
