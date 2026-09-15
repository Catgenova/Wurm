/**
 * Where somebody has been, small enough to keep and right when it comes back.
 *
 * "Every time the browser resets, the previously discovered fog of war resets
 * to black." It lived in `localStorage` and nowhere else. Moving it to the
 * island is two questions — does it survive the trip, and does it cost
 * anything to bring back — and both are asked here, out of a browser, because
 * neither needs one.
 */
import { generateAtlasWindow } from '../../src/world/atlas-world';
import { CHUNK, World } from '../../src/world/world';
import { packFog, unpackFog } from '../../src/net/fogpack';
import { readAtlas } from '../../tools/atlas-node';

const atlas = readAtlas();
const SIZE = 512;
const SEED = 31337;

/** A world as a browser has it at a join: a seed, and nothing worked out yet. */
function joining(): World {
  const w = new World(SIZE, SIZE);
  w.seed = SEED;
  w.streamFrom((x0, y0, ww, hh) => generateAtlasWindow(SEED, atlas, x0, y0, ww, hh, SIZE));
  return w;
}

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

/*
 * A road walked across the island, seen twenty tiles either side.
 *
 * Which is what a fog of war actually looks like: not a random spray of bits
 * but a body's own path, widened by how far it can see. The encoding is built
 * for that shape and this is the shape to measure it on.
 */
const walked = joining();
const road: Array<[number, number]> = [];
for (let x = 40; x < SIZE - 40; x++) {
  const y = 200 + Math.round(Math.sin(x / 40) * 60);
  for (let dy = -20; dy <= 20; dy++) {
    for (let dx = -1; dx <= 1; dx++) road.push([x + dx, y + dy]);
  }
}
for (const [x, y] of road) walked.markSeen(x, y);
/** Tiles, not marks: the road above walks over its own edges as a body does. */
const lit = (w: World): number => {
  let n = 0;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (w.isKnown(x, y)) n++;
  return n;
};
const seenCount = lit(walked);
check('a road across the island is ground somebody has seen', seenCount > 15000, `${seenCount} tiles`);

const packed = packFog(walked);
check('and it packs', !!packed);
const bytes = packed ? Math.round((packed.length * 3) / 4) : 0;
check('into something you would not think twice about keeping',
  bytes > 0 && bytes < 20000,
  `${(bytes / 1024).toFixed(1)} kB for ${seenCount} tiles — against ${(SIZE * SIZE / 8 / 1024).toFixed(0)} kB for the bare bitmap and ${(SIZE * SIZE * 3 / 1048576).toFixed(1)} MB for what the local save writes`);

/*
 * And back, into a world that is nothing but a seed.
 *
 * The two things that matter are that every tile comes back and that bringing
 * it back costs no ground: a join that had to work out every square anybody
 * had ever walked over would be the whole island on a well-travelled one,
 * which is the cost `streamFrom` exists to avoid.
 */
const back = joining();
const restored = unpackFog(back, packed ?? '');
check('it comes back', restored === seenCount && lit(back) === seenCount,
  `${restored} tiles restored of ${seenCount}, ${lit(back)} lit`);
check('and not one square of ground was worked out to do it', back.grown === 0, `${back.grown} squares`);

let missing = 0;
for (const [x, y] of road) if (!back.isKnown(x, y)) missing++;
check('every tile that was seen is seen again', missing === 0, `${missing} lost`);

let extra = 0;
for (let y = 0; y < SIZE; y += 3) {
  for (let x = 0; x < SIZE; x += 3) {
    if (back.isKnown(x, y) && !walked.isKnown(x, y)) extra++;
  }
}
check('and nothing else is', extra === 0, extra ? `${extra} tiles lit that never were` : 'nothing lit that was not walked');
check('and the box it all falls inside came back with it',
  back.knownBox.x0 === walked.knownBox.x0 && back.knownBox.y0 === walked.knownBox.y0
  && back.knownBox.x1 === walked.knownBox.x1 && back.knownBox.y1 === walked.knownBox.y1,
  `${back.knownBox.x0},${back.knownBox.y0} to ${back.knownBox.x1},${back.knownBox.y1}`);

/*
 * The remembered picture, taken off the ground a square at a time.
 *
 * A restored fog says where somebody has been and nothing about what they saw,
 * which is right: this browser builds the whole island from the seed and has
 * replayed every change anybody made, so the ground is known without being
 * told. But the map is drawn out of the remembered arrays, so they have to be
 * filled — and filling them at the join is the cost above, all over again. So
 * it happens on the first read, square by square.
 */
const [rx, ry] = road[Math.floor(road.length / 2)];
const grownBefore = back.grown;
const remembered = back.viewTile(rx, ry, false);
const live = back.viewTile(rx, ry, true);
check('a remembered tile reads as the ground it stands on', remembered === live,
  `remembered ${remembered}, on the ground ${live}`);
check('and reading it worked out exactly one square', back.grown === grownBefore + 1,
  `${grownBefore} squares, then ${back.grown}`);
const again = back.grown;
for (let i = -CHUNK / 2; i < CHUNK / 2; i++) back.viewTile(rx, Math.max(0, ry + 0), false);
check('and reading it again works out none', back.grown === again, `still ${back.grown}`);

/*
 * And what looking at all of it costs, which is the bill for this whole idea.
 *
 * Opening the map draws every square somebody has been over, and drawing a
 * remembered square is what fills it in — so this is the worst a restored fog
 * ever costs, paid once, the first time the map is opened after a refresh. It
 * is the same ground the map has always had to work out to draw a height; what
 * is new is that a refresh no longer arrives with it already done.
 */
{
  const all = joining();
  unpackFog(all, packed ?? '');
  const at = Date.now();
  for (let y = all.knownBox.y0; y <= all.knownBox.y1; y += CHUNK) {
    for (let x = all.knownBox.x0; x <= all.knownBox.x1; x += CHUNK) all.viewTile(x, y, false);
  }
  const took = Date.now() - at;
  check('and looking at every bit of it at once is not a freeze',
    took < 4000, `${all.grown} squares worked out in ${took}ms, for ${seenCount} tiles of fog`);
}

/* Ground nobody walked stays dark, and reading it works nothing out. */
const darkBefore = back.grown;
check('ground nobody walked is still dark', !back.isKnown(5, 5));
back.viewTile(5, 5, false);
check('and looking at the dark costs nothing', back.grown === darkBefore, `${back.grown} squares`);

/* An island nobody has set foot on has no fog to keep. */
check('an island nobody has seen packs to nothing at all', packFog(joining()) === null);

/*
 * And rubbish is refused rather than believed.
 *
 * The fog is the one thing a browser hands over that the island cannot check —
 * only the tab knows what its camera covered — so what comes back is only as
 * trustworthy as the store it came from. Anything that will not read must fail
 * as a dark map and not as a body standing in a world it cannot draw.
 */
const junk = joining();
check('a fog of rubbish is not believed', unpackFog(junk, 'not base64 at all !!') === -1);
check('nor one that ends in the middle of a number', unpackFog(junk, btoa('\xff\xff\xff')) === -1);
check('nor one whose box is off the edge of the island', unpackFog(junk, btoa('\x00\x00\xff\xff\x07\x01')) === -1);
check('and none of them lit anything', !junk.isKnown(0, 0) && junk.knownBox.x1 < 0, `box ${junk.knownBox.x1}`);

for (const l of ok) console.log(l);
for (const l of bad) console.log(l);
console.log(bad.length ? `${bad.length} of ${ok.length + bad.length} went wrong.`
                       : `the fog of war travels — ${ok.length} checks.`);
process.exit(bad.length ? 1 : 0);
