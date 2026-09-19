/**
 * A wall is a box, and the face you see is the one you are standing on.
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
import { FENCE_THICK, WALL_THICK, WALL_TYPE_BY_ID, WALL_TYPES } from '../../src/game/building';

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

if (bad) {
  console.error(`${bad} of them are not what they should be`);
  process.exit(1);
}
console.log('a wall has two faces, and the one drawn is the one the camera is on, whichever way it is turned');
