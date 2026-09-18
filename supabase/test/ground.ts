/**
 * The ground a seed makes, pinned.
 *
 * The island's land travelled exactly once, at founding: `found-island.ts`
 * worked it out with the generator of that day and handed it to Postgres,
 * which has kept it ever since. Every browser since works the same ground out
 * for itself from the seed — with the generator of *today*.
 *
 * So the generator is not code. It is a wire format with one message in it,
 * sent years ago, and every change to it moves the ground under every island
 * already founded. Nothing says so: `tile_change` carries what people have
 * dug and nothing else, the island keeps quietly winning every disagreement,
 * and the browser goes on drawing ground the rules do not believe in.
 *
 * Measured, against builds this repo actually shipped, on one 256 window:
 *
 *     b886a42 and later        0 of 65536 faces differ
 *     c04881e               1367 of 65536 differ,   239 of them soft ground
 *                                the island would refuse to let you pack
 *     0aed1fc               2933 of 65536 differ,   634 of them
 *     8562112              23044 of 65536 differ,  6328 of them
 *
 * A tile the browser draws as dirt and the island holds as sand is a tile
 * where *"That ground will not pack down"* is the island being right and the
 * screen being wrong — about ground nobody has ever touched.
 *
 * This does not stop the generator changing. It stops it changing by
 * accident: the number below is what the ground comes out as, and moving it
 * is a thing done deliberately, with every founded island reconciled to the
 * new ground in the same breath. `tools/reconcile-land.ts` is what does that.
 */
import { generateAtlasWindow } from '../../src/world/atlas-world';
import { readAtlas } from '../../tools/atlas-node';

const SIZE = 256;
const SEED = 4242;

/** A plain rolling hash. Nothing cryptographic is wanted; a change is a change. */
function digest(bytes: Uint8Array): string {
  let a = 0x811c9dc5 >>> 0;
  let b = 0x01000193 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i], 0x01000193) >>> 0;
    b = (Math.imul(b + bytes[i] + i, 0x85ebca6b) ^ (b >>> 13)) >>> 0;
  }
  return (a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0'));
}

const atlas = readAtlas();
const win = generateAtlasWindow(SEED, atlas, 0, 0, SIZE, SIZE, SIZE);
const heights = new Uint8Array(win.heights.buffer, win.heights.byteOffset, win.heights.byteLength);

const marks = {
  tiles: digest(win.tiles),
  data: digest(win.data),
  rock: digest(win.rock),
  heights: digest(heights),
  dirt: digest(win.dirt),
};

/**
 * What the ground has come out as since the relief landed on 15 September.
 * Change these only alongside a reconcile of every island already founded.
 *
 * `data` moved on 18 September, when eight fruit trees were held to their
 * islands: every face stayed and the species byte of one tree in fifty
 * changed, which the reconcile compares now as well as the face.
 */
const PINNED: Record<keyof typeof marks, string> = {
  tiles: '07fcda3bbd161f34',
  data: '61700fae33936ef8',
  rock: 'bafd32f32da1ef6a',
  heights: '561c219755d4479c',
  dirt: '2c0887dc7256457a',
};

let moved = 0;
for (const k of Object.keys(marks) as Array<keyof typeof marks>) {
  const same = PINNED[k] === marks[k];
  if (!same) moved++;
  console.log(`  ${k.padEnd(8)} ${marks[k]}${same ? '' : `   MOVED (was ${PINNED[k] || 'unpinned'})`}`);
}
console.log(moved === 0
  ? `the ground a seed makes is the ground it made before`
  : `THE GROUND HAS MOVED in ${moved} of ${Object.keys(marks).length} layers`);
if (moved) {
  console.log('');
  console.log('Every island already founded holds the ground the OLD generator made.');
  console.log('A browser will now draw the new ground over it and the two will');
  console.log('disagree about tiles nobody has ever touched — which is the island');
  console.log('refusing to pack dirt, refusing to fell trees that are not there,');
  console.log('and walls of nothing you cannot walk through.');
  console.log('');
  console.log('If the change is wanted: run tools/reconcile-land.ts against every');
  console.log('live island to write the difference into tile_change, then pin the');
  console.log('new marks here in the same commit.');
}
process.exit(moved === 0 ? 0 : 1);
