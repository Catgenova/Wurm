/**
 * A wall is a box, a deck has an edge, and a roof is covered in something.
 *
 * Reported: "walls are paper thin and have no character." They were one quad
 * standing on the border line — no thickness, no top, no end, and a flat
 * colour with a few lines ruled across it. A wall is a box now, centred on its
 * border, and which of its two faces gets drawn is decided per wall from the
 * camera: in this projection everything further down the screen is nearer, and
 * a step across the wall moves down the screen by `u + v`.
 *
 * That one line is the whole of it, and it is the one thing here that can go
 * wrong silently: get the sign backwards and every wall on the island is drawn
 * on the far side of its own line — half a tile out, in a game where half a
 * tile is where you put your feet. So it is measured rather than eyeballed:
 * the camera is turned all the way round and the answer is held against where
 * the projection actually puts the two faces.
 */
import { Camera } from '../../src/engine/camera';
import { isoY } from '../../src/render/iso';
import { TURNS } from '../../src/render/view';
import { EAVE_DEEP, FENCE_THICK, FLOOR_DEEP, MATERIALS, WALL_HEIGHT, WALL_THICK, WALL_TYPE_BY_ID, WALL_TYPES } from '../../src/game/building';
import { PAVED, SLAB_VARIANTS, TILE_DEFS, TileType } from '../../src/world/tiles';

let bad = 0;
const say = (ok: boolean, line: string): void => {
  if (!ok) bad++;
  console.log(`${ok ? '  ' : 'X '}${line}`);
};

const cam = new Camera();
/** Where the projection puts a point, which is the answer `nearSide` has to agree with. */
const down = (dx: number, dy: number): number => isoY(cam.rotateX(dx, dy), cam.rotateY(dx, dy), 0);

/* The two borders there are, and the way across each of them. */
const across: Array<[string, number, number]> = [
  ['a wall running east', 0, 1],
  ['a wall running south', 1, 0],
];
let turns = 0;
let agreed = 0;
for (let i = 0; i < TURNS; i++) {
  cam.rotation = i;
  for (const [, nx, ny] of across) {
    const s = cam.nearSide(nx, ny);
    // The face it picked has to be the one the projection draws lower down.
    if (down(nx * s, ny * s) >= down(-nx * s, -ny * s)) agreed++;
    turns++;
  }
}
say(agreed === turns && turns === TURNS * 2, `through all ${TURNS} ways the view turns, the face it picks is the lower one every time: ${agreed} of ${turns}`);

/* And it is a real choice rather than always the same one. */
const sides = new Set<number>();
for (let i = 0; i < TURNS; i++) {
  cam.rotation = i;
  sides.add(cam.nearSide(0, 1));
}
say(sides.size === 2, `and it is both answers as the view comes round, not one of them: ${[...sides].join(' and ')}`);

/* A wall centred on its border, standing out either side of it. */
say(WALL_THICK > 0 && WALL_THICK < 0.25,
  `a wall stands ${WALL_THICK} of a tile either side of its border, so it is ${(WALL_THICK * 2 * 4).toFixed(2)} m through`);
say(FENCE_THICK > 0 && FENCE_THICK < WALL_THICK,
  `and a fence is thinner than a wall: ${FENCE_THICK} against ${WALL_THICK}`);

/* The two that are not an ordinary thickness, and why. */
say(WALL_TYPE_BY_ID.get('bay')?.thick === 1.7, 'a bay window stands proud of the wall it is let into');
say(WALL_TYPE_BY_ID.get('half_wall')?.thick === 1.25, 'and a half wall is built heavier than the storey it caps');
say(WALL_TYPES.filter((t) => t.thick !== undefined).length === 2,
  `everything else is a wall's thickness and says nothing about it: ${WALL_TYPES.filter((t) => t.thick === undefined).length} of ${WALL_TYPES.length}`);

/*
 * And the same treatment for the other three things a building is made of.
 *
 * A floor, a pavement and a roof were each one flat lozenge of one colour, so
 * a storey of oak boards and a storey of marble differed by hue and by nothing
 * else, and a road differed from a lawn the same way. What they are laid in is
 * measured here for the same reason the wall's face is: the numbers are read
 * off a table rather than written into the drawing, and a table that has gone
 * wrong is silent about it.
 */

/* Every ground the tiles call paved is a ground the drawing knows how to lay. */
const paved = Object.entries(TILE_DEFS).filter(([, d]) => d.paved).map(([id]) => Number(id));
say(PAVED.size === paved.length && paved.every((t) => PAVED.has(t)),
  `the paved grounds are laid rather than coloured in, all ${PAVED.size} of them`);
say([TileType.Gravel, TileType.Cobblestone, TileType.Slabs].every((t) => PAVED.has(t)),
  'gravel, cobbles and slabs among them, which are the three there are today');

/*
 * A deck and an eave have a depth, and it is a board's worth rather than a
 * storey's: get it wrong the other way and an upper floor reads as a second
 * wall hanging under the first.
 */
say(FLOOR_DEEP > 0 && FLOOR_DEEP < WALL_HEIGHT / 4,
  `a deck is ${FLOOR_DEEP} deep at its edge, against a storey of ${WALL_HEIGHT}`);
say(EAVE_DEEP > FLOOR_DEEP && EAVE_DEEP < WALL_HEIGHT / 4,
  `and an eave hangs deeper than a deck, because it is the rafter ends and the courses over them: ${EAVE_DEEP}`);

/*
 * How big a piece each material comes in. One number does a roof's courses, a
 * floor's boards and a stone floor's flags, so the only thing that can go
 * wrong is a material that forgot to say — which is what this asks.
 */
const mute = MATERIALS.filter((m) => !(m.courses >= 2 && m.courses <= 6));
say(mute.length === 0,
  `all ${MATERIALS.length} materials say how big a piece they come in${mute.length ? `, bar ${mute.map((m) => m.name).join(', ')}` : ''}`);
const stone = MATERIALS.filter((m) => m.kind === 'stone');
say(new Set(stone.map((m) => m.courses)).size > 1,
  `and the stones do not all say the same: ${[...new Set(stone.map((m) => m.courses))].sort().join(', ')} courses among ${stone.length} of them`);
say((MATERIALS.find((m) => m.id === 'marble')?.courses ?? 0) < (MATERIALS.find((m) => m.id === 'slate')?.courses ?? 0),
  'marble is cut in wide courses and slate splits into narrow ones');

/* And the same for the four stones a pavement of slabs is cut from. */
const flags = SLAB_VARIANTS.map((v) => v.courses);
say(flags.every((n) => n >= 2 && n <= 6), `every slab says how big it is cut: ${flags.join(', ')} across a tile`);
say(new Set(flags).size > 1, 'and not all of them the same, or there would be no reason to ask');

if (bad) {
  console.error(`${bad} of them are not what they should be`);
  process.exit(1);
}
console.log('a wall has two faces, a deck has an edge, and everything laid says what size it is laid in');
