/**
 * A walk and a run, and a wall that knows which room you are in.
 *
 * Two things the picture was missing, and both of them were a rule applied
 * one step too coarsely.
 *
 * **A run was a walk on fast-forward.** `walkPhase` advances quicker when you
 * move quicker, so a horse at a gallop took a body's steps, more of them per
 * second, at exactly the same reach and never leaving the ground. Three
 * things separate the two: a running limb swings further, its swing leans
 * forward in time rather than being a symmetrical pendulum, and the body
 * leaves the ground twice a stride. All three come off one number, read from
 * the ground a thing actually covers, so a person, another player, a hunter
 * and a wildermon in the traces all get it with nothing added to any of them.
 *
 * The guarantee that makes it safe to change fifty-two drawings at once is
 * the first thing measured here: **at a walk, every one of them is what it
 * was, bit for bit.** Only a run is new.
 *
 * **The cutaway was per-building.** Step inside a longhouse and every near
 * wall of the whole house faded, the far bedroom's included, though nothing
 * in the bedroom stood between you and anything. Rooms exist now, so the
 * question is asked properly.
 *
 * Needs no database.
 */
import { Buildings, bordersRoom, borderOf, tileKey, type Side } from '../../src/game/building';
import { gaitLift, gaitPitch, gaitSin, type Moving } from '../../src/render/sprites';
import { Gaits } from '../../src/render/gait';
import { BASE_SPEED } from '../../src/game/player';

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

const walking = (phase: number): Moving => ({ phase, moving: true, gait: 0 });
const running = (phase: number): Moving => ({ phase, moving: true, gait: 1 });
const TAU = Math.PI * 2;
/** A whole stride, sampled finely enough to catch a sign error anywhere in it. */
const STRIDE = Array.from({ length: 360 }, (_, i) => (i / 360) * TAU);

/* ---- a walk is exactly what it was ---------------------------------------- */

/*
 * Every multiplier and offset the fifty-two drawings actually use, put
 * through both the old expression and the new one. If this ever fails, some
 * animal somewhere has quietly changed how it walks.
 */
const ARGS: Array<[number, number]> = [[1, 0], [0.8, 0], [0.9, 0], [1.2, 0], [1.6, 0], [2, 0], [0.3, 0], [0.25, 0],
  [1, Math.PI], [1, 1.1], [1, 1.6], [0.8, Math.PI], [1.2, Math.PI], [1, 0.9], [0.35, 0], [1.05, 0], [1.35, 0]];
let worst = 0;
for (const [k, at] of ARGS) {
  for (const p of STRIDE) worst = Math.max(worst, Math.abs(gaitSin(walking(p), k, at) - Math.sin(p * k + at)));
}
check('at a walk a limb swings exactly as it always did, to the last bit',
  worst === 0, `${ARGS.length} multipliers over a whole stride apiece, worst difference ${worst}`);
check('and a walking body never leaves the ground, nor leans',
  STRIDE.every((p) => gaitLift(walking(p)) === 0 && gaitPitch(walking(p)) === 0), 'lift and pitch both nought');
check('and a body standing still is not running, whatever its gait says',
  gaitLift({ phase: 1, moving: false, gait: 1 }) === 0 && gaitPitch({ phase: 1, moving: false, gait: 1 }) === 0,
  'a thing that is not moving has no gait to speak of');
check('and a pose that never heard of a gait is a walking pose',
  STRIDE.every((p) => gaitSin({ phase: p, moving: true }) === Math.sin(p)), 'no gait means a walk');

/* ---- and a run is three things a walk is not ------------------------------ */

const walkReach = Math.max(...STRIDE.map((p) => Math.abs(gaitSin(walking(p)))));
const runReach = Math.max(...STRIDE.map((p) => Math.abs(gaitSin(running(p)))));
check('a running limb reaches further than a walking one, and by a good deal',
  runReach > walkReach * 1.4, `${runReach.toFixed(3)} against ${walkReach.toFixed(3)}`);

/*
 * The asymmetry, which is what makes it read as a run rather than as a big
 * walk. A pendulum takes as long to go forward as to come back; a running leg
 * is driven back hard and recovers fast. Measured as the gap between where
 * the swing peaks and where it troughs: half a stride apart for a pendulum,
 * and not for a run.
 */
const peakAt = (pose: (p: number) => Moving): { up: number; down: number } => {
  let up = 0;
  let down = 0;
  for (const p of STRIDE) {
    if (gaitSin(pose(p)) > gaitSin(pose(STRIDE[up]))) up = STRIDE.indexOf(p);
    if (gaitSin(pose(p)) < gaitSin(pose(STRIDE[down]))) down = STRIDE.indexOf(p);
  }
  return { up: STRIDE[up], down: STRIDE[down] };
};
const wp = peakAt(walking);
const rp = peakAt(running);
const apart = (a: { up: number; down: number }): number => Math.abs(Math.abs(a.up - a.down) - Math.PI);
check('a walking swing is a pendulum: as long forward as back',
  apart(wp) < 0.02, `peak and trough ${(Math.abs(wp.up - wp.down) / Math.PI).toFixed(3)} of a half-stride apart`);
check('and a running one is not, which is the whole of why it reads as a run',
  apart(rp) > 0.1, `peak and trough ${(Math.abs(rp.up - rp.down) / Math.PI).toFixed(3)} of a half-stride apart`);

const lifts = STRIDE.map((p) => gaitLift(running(p)));
check('a running body leaves the ground, twice in a stride',
  Math.max(...lifts) > 1 && lifts.filter((v, i) => v > 0.05 && lifts[(i + 359) % 360] <= 0.05).length === 2,
  `highest ${Math.max(...lifts).toFixed(2)}, off the ground twice`);
check('and never sinks into it',
  lifts.every((v) => v >= 0), `lowest ${Math.min(...lifts).toFixed(2)}`);
/*
 * And the lean. Bodies are drawn nose at +x building upward from the feet, so
 * y is negative over the ground: leaning the head forward is a *negative*
 * shear. Get this sign wrong and everything on the island sprints backwards,
 * leaning away from where it is going, which is the kind of thing that is
 * obvious in a picture and invisible in a diff.
 */
check('and it leans at the ground ahead of it rather than away from it',
  gaitPitch(running(1)) < 0, `${gaitPitch(running(1)).toFixed(3)} of shear, nose-forward`);

/* ---- how hard a thing is going is read off the ground it covers ----------- */

{
  const g = new Gaits();
  const run = (v: number, secs: number): number => {
    let x = 0;
    let out = 0;
    for (let t = 0; t < secs * 60; t++) {
      x += v / 60;
      out = g.of('x', x, 0, 1 / 60);
    }
    return out;
  };
  check('something standing still is not running', g.of('still', 5, 5, 1 / 60) === 0, 'nothing covered, nothing read');
  check('an ordinary walk reads as a walk', run(BASE_SPEED, 3) < 0.05, run(BASE_SPEED, 0.001).toFixed(3));
  check('and something going at twice that reads as a run', run(BASE_SPEED * 2.2, 3) > 0.95, 'held for three seconds');
}
{
  /*
   * A body pathing round a corner slows down and speeds up several times a
   * second. A gait that answered every one of those would flicker between a
   * walk and a run while the thing was plainly doing neither.
   */
  const g = new Gaits();
  for (let t = 0; t < 120; t++) g.of('e', (t * BASE_SPEED * 2.2) / 60, 0, 1 / 60);
  const was = g.of('e', (120 * BASE_SPEED * 2.2) / 60, 0, 1 / 60);
  const now = g.of('e', (120 * BASE_SPEED * 2.2) / 60, 0, 1 / 60);
  check('and a gait follows slowly, so a corner does not read as stopping dead',
    was - now < 0.1, `${was.toFixed(3)} to ${now.toFixed(3)} on a frame with no ground covered`);
}
{
  // A body waking at its bed, or a peer snapping into place after a gap in
  // the wire, has not just sprinted across the island.
  const g = new Gaits();
  g.of('t', 10, 10, 1 / 60);
  check('and a body put down somewhere else has not sprinted there',
    g.of('t', 400, 400, 1 / 60) === 0, 'a jump is a move, not a speed');
}

/* ---- and a wall knows which room you are in ------------------------------- */

/*
 * A longhouse, six by two, with a wall across the middle: two rooms of three
 * tiles apiece. The cutaway used to fade the near walls of both.
 */
const bld = new Buildings();
const b = bld.create('Longhouse', 0, 0);
for (let x = 0; x < 6; x++) for (let y = 0; y < 2; y++) if (x || y) bld.addTile(b, x, y);
/** A wall that is up rather than planned: `room` only stops at finished ones. */
const wall = (x: number, y: number, side: Side): void => {
  const w = bld.setWall(b, 0, x, y, side, 'solid', 'log');
  w.needed = {};
};
for (let x = 0; x < 6; x++) {
  wall(x, 0, 'n');
  wall(x, 1, 's');
}
for (let y = 0; y < 2; y++) {
  wall(0, y, 'w');
  wall(5, y, 'e');
  wall(3, y, 'w');
}

const west = bld.room(0, 1, 0);
const east = bld.room(0, 4, 0);
check('a longhouse cut in two is two rooms, not one',
  !!west && !!east && west.tiles.length === 6 && east.tiles.length === 6 && !west.tiles.includes(tileKey(4, 0)),
  `${west?.tiles.length ?? 0} tiles one side, ${east?.tiles.length ?? 0} the other`);

const mine = new Set(west?.tiles ?? []);
check('the wall along your own room is one the cutaway takes away',
  bordersRoom(mine, borderOf(1, 0, 'n')), 'the north wall over tile 1,0');
check('and the partition you are standing against, since it is your wall too',
  bordersRoom(mine, borderOf(2, 0, 'e')), 'the dividing wall');
check('while the far room’s outer wall is left standing, because it hides nothing of yours',
  !bordersRoom(mine, borderOf(4, 0, 'n')), 'the north wall over tile 4,0');
check('and so is a wall in the next house along',
  !bordersRoom(mine, borderOf(20, 20, 'n')), 'nowhere near you');

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`a run is not a fast walk, and a wall knows whose room it is in — ${ok.length} of ${ok.length}`);
