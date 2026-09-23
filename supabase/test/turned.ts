/**
 * Eight ways round, not two.
 *
 * Reported: "when changing camera angles models just twist in place." They
 * did. Every animal on this island is drawn in profile — nose at +x, tail at
 * -x — and the only thing the view could ever do with that drawing was mirror
 * it. So a rabba heading north and one heading east were the same picture, and
 * walking the camera round one did not walk you round the animal: it stood
 * there showing you the same flank, and flipped, once, when the heading
 * happened to cross the middle of the screen.
 *
 * There is no second drawing now and there does not need to be one. A body is
 * long one way and narrow the other, so what the angle decides is how much of
 * the length you are looking along: all of it from the side, and only the
 * animal's own thickness end on, with the far end riding up the screen because
 * it is further away. Eight angles out of the one drawing, and every species
 * gets them at once.
 *
 * Measured rather than eyeballed, because the failure is silent: get a sign
 * backwards and every beast on the island walks backwards, and nothing else
 * here would say so. What is checked is that the eight are eight — that no two
 * of them come out the same — that the two the drawings were made at are
 * untouched, and that turning the camera turns the animal instead of turning
 * the picture.
 *
 * Needs no database.
 */
import { Camera } from '../../src/engine/camera';
import { TURNS } from '../../src/render/view';
import { HALF_H, HALF_W, UNITS_PER_TILE } from '../../src/render/iso';
import { beastTurn, facingOf, FACINGS } from '../../src/render/sprites';
import { headingView, pieceView } from '../../src/render/furniture';
import type { Side } from '../../src/game/building';

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

/* ---- the two the drawings were made at are left alone -------------------- */
const right = beastTurn(2);
const left = beastTurn(6);
check('a body facing screen right is the drawing as it was drawn',
  right.mirror === 1 && Math.abs(right.squash - 1) < 1e-9 && Math.abs(right.lean) < 1e-9,
  `mirror ${right.mirror}, squash ${right.squash.toFixed(3)}, lean ${right.lean.toFixed(3)}`);
check('and facing screen left is that drawing in the mirror, as it always was',
  left.mirror === -1 && Math.abs(left.squash - 1) < 1e-9 && Math.abs(left.lean) < 1e-9,
  `mirror ${left.mirror}, squash ${left.squash.toFixed(3)}, lean ${left.lean.toFixed(3)}`);

/* ---- and the six between them are six ------------------------------------ */
const shapes = new Set<string>();
for (let f = 0; f < FACINGS; f++) {
  const t = beastTurn(f);
  shapes.add(`${t.mirror}|${t.squash.toFixed(4)}|${t.lean.toFixed(4)}`);
}
check('all eight ways round come out different from one another', shapes.size === FACINGS,
  `${shapes.size} of ${FACINGS}: ${[...shapes].slice(0, 3).join('  ')}`);

/* ---- coming at you and going away are the two that used to be one -------- */
const at = beastTurn(0);
const away = beastTurn(4);
check('a body coming at you leans its nose down the screen', at.lean > 0.1, at.lean.toFixed(3));
check('and one going away leans it up', away.lean < -0.1, away.lean.toFixed(3));
check('and the two are not the same picture', Math.abs(at.lean - away.lean) > 0.2,
  `${at.lean.toFixed(3)} against ${away.lean.toFixed(3)}, which used to be the same drawing twice`);
check('while neither of them is narrower than the animal is thick',
  at.squash > 0.3 && Math.abs(at.squash - away.squash) < 1e-9,
  `${at.squash.toFixed(3)} of its length, which is its own width`);

/* ---- the length and the width swap over as it turns ---------------------- */
/*
 * Side on, a step along the body runs across the screen and a step across it
 * runs up the screen. End on they change places. Everything hung on a body —
 * an ear, an eye, a horn — is placed along those two, so if they do not swap
 * the face never comes round.
 */
const sideOn = beastTurn(2);
const endOn = beastTurn(0);
check('side on, the length runs across the screen and the width up it',
  Math.abs(sideOn.along[0]) > 0.9 && Math.abs(sideOn.along[1]) < 1e-9 && Math.abs(sideOn.across[0]) < 1e-9,
  `along ${sideOn.along.map((n) => n.toFixed(2)).join(',')}, across ${sideOn.across.map((n) => n.toFixed(2)).join(',')}`);
check('and end on the two have changed places',
  Math.abs(endOn.along[0]) < 1e-9 && Math.abs(endOn.across[0]) > 0.9,
  `along ${endOn.along.map((n) => n.toFixed(2)).join(',')}, across ${endOn.across.map((n) => n.toFixed(2)).join(',')}`);
/*
 * And what one of them loses the other gains, at every angle in between.
 *
 * They are not the same length as each other and should not be: side on you
 * are looking straight along the width, so the width is foreshortened to
 * almost nothing while the length has all of itself on show. What has to hold
 * is that the pair of them comes to the same total wherever the body is
 * pointed — that is what keeps a head the same size all the way round instead
 * of swelling and shrinking as the animal turns.
 */
const total = (f: number): number => {
  const t = beastTurn(f);
  return t.along[0] ** 2 + t.along[1] ** 2 + t.across[0] ** 2 + t.across[1] ** 2;
};
const drift: number[] = [];
for (let f = 0; f < FACINGS; f++) if (Math.abs(total(f) - total(0)) > 1e-9) drift.push(f);
check('and what the one loses the other gains, at every angle between', drift.length === 0,
  drift.length ? `off at ${drift.join(', ')}` : `the pair comes to ${total(0).toFixed(4)} whichever way it is pointed`);

/* ---- an upright body barely narrows at all ------------------------------- */
const onFours = beastTurn(0);
const onTwo = beastTurn(0, 0.92);
check('a thing on two legs is as wide from the front as from the side, and a thing on four is not',
  onTwo.squash > 0.9 && onFours.squash < 0.6,
  `upright ${onTwo.squash.toFixed(2)} of its length, on all fours ${onFours.squash.toFixed(2)}`);

/* ---- and the camera turns the animal, not the picture -------------------- */
/*
 * The half that was actually reported. A beast has a heading in the world; the
 * angle it is drawn at is that heading put through the projection, so the same
 * beast walking the same way is drawn differently from each of the eight
 * viewpoints — which is what walking round something means.
 */
const cam = new Camera();
const facingFrom = (dx: number, dy: number): number => {
  const du = cam.rotateX(dx, dy);
  const dv = cam.rotateY(dx, dy);
  return facingOf((du - dv) * HALF_W, (du + dv) * HALF_H);
};
const seen = new Set<number>();
for (let r = 0; r < TURNS; r++) {
  cam.rotation = r;
  seen.add(facingFrom(0, -1));
}
cam.rotation = 0;
check('one beast heading north is drawn eight different ways from the eight viewpoints',
  seen.size === FACINGS, `${seen.size} of ${FACINGS}: ${[...seen].join(', ')}`);

/* And two beasts heading different ways are drawn differently from one spot. */
const ways = new Set<number>();
for (const [dx, dy] of [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]] as Array<[number, number]>) {
  ways.add(facingFrom(dx, dy));
}
check('and eight beasts heading eight different ways are eight different pictures',
  ways.size === FACINGS, `${ways.size} of ${FACINGS}`);

/* ---- and the same again for a thing that does not walk -------------------- */
/*
 * Furniture had the identical fault in a different shape. A piece was an iso
 * box -- a top and the two faces nearest you -- with its front painted over
 * those two faces, so it showed you its front from all eight viewpoints and
 * there was no back to walk round to. A piece is a model now, built in its
 * own frame and put on the screen through `pieceView`: a unit across it and
 * a unit toward its front, in screen pixels.
 *
 * What is checked is that the turn it is put through is the camera's own --
 * so a piece stands on its floor however the view is turned -- and the shape
 * of the answer as you walk round one: the front comes into view, crosses
 * and goes out again, once, and the other side of the walk is its back.
 */
const SIDES: Side[] = ['n', 'e', 's', 'w'];
const ACROSS: Record<Side, [number, number]> = { s: [1, 0], e: [0, -1], n: [-1, 0], w: [0, 1] };
const OUT: Record<Side, [number, number]> = { s: [0, 1], e: [1, 0], n: [0, -1], w: [-1, 0] };
/** A world step of one height unit, as the camera puts it on the screen. */
const stepOnScreen = (dx: number, dy: number): [number, number] => {
  const du = cam.rotateX(dx, dy) / UNITS_PER_TILE, dv = cam.rotateY(dx, dy) / UNITS_PER_TILE;
  return [(du - dv) * HALF_W, (du + dv) * HALF_H];
};
const off: string[] = [];
for (const f of SIDES) {
  for (let r = 0; r < TURNS; r++) {
    cam.rotation = r;
    const v = pieceView(f, r);
    const [ax, ay] = stepOnScreen(...ACROSS[f]);
    const [fx, fy] = stepOnScreen(...OUT[f]);
    if (Math.hypot(v.ux - ax, v.uy - ay, v.vx - fx, v.vy - fy) > 1e-9) off.push(`${f}@${r}`);
  }
}
cam.rotation = 0;
check('a piece is turned on the screen exactly as the ground under it is', off.length === 0,
  off.length ? `off at ${off.join(', ')}` : 'all thirty-two the camera\'s own turn');

/* A face is in view when a step out through it goes down the screen, which is toward you. */
const EPS = 1e-9;
const walk = (facing: Side): Array<{ front: boolean; back: boolean; square: boolean }> =>
  Array.from({ length: TURNS }, (_, r) => {
    const v = pieceView(facing, r);
    return { front: v.vy > EPS, back: v.vy < -EPS, square: v.vy > EPS && Math.abs(v.uy) < EPS };
  });
const run = walk('s');
const fronts = run.filter((t) => t.front).length;
check('a piece shows its front from three viewpoints in eight', fronts === 3,
  run.map((t) => (t.front ? 'F' : t.back ? 'B' : '-')).join(' '));

const squareAt = run.findIndex((t) => t.square);
check('square on to it once, and the front in view either side of that, so it does not flicker in and out',
  run.filter((t) => t.square).length === 1 && run[(squareAt + TURNS - 1) % TURNS].front && run[(squareAt + 1) % TURNS].front,
  `square on from viewpoint ${squareAt}`);

const backs = run.filter((t) => t.back).length;
check('you are behind it from three of the eight, and never behind it and in front of it at once',
  backs === 3 && run.every((t) => !(t.front && t.back)), `${backs} viewpoints behind it`);

/* The bug itself: four pieces set four ways are four different pictures. */
const key = (f: Side, r: number): string => {
  const v = pieceView(f, r);
  return [v.ux, v.uy, v.vx, v.vy].map((n) => n.toFixed(6)).join(',');
};
const apart = new Set(SIDES.map((f) => key(f, 0)));
check('four pieces set four ways are drawn four different ways from one spot', apart.size === 4, `${apart.size} of 4`);

/* And one piece is a different picture from every viewpoint, as a real thing is. */
const round = new Set(Array.from({ length: TURNS }, (_, r) => key('s', r)));
check('and one piece is eight different pictures as the camera goes round it', round.size === TURNS, `${round.size} of ${TURNS}`);

/*
 * A thing that is driven points the way it is going: set down facing south a
 * cart points east, its shafts along its width, and driven east it is the
 * same picture.
 */
const same = Array.from({ length: TURNS }, (_, r) => r).filter((r) => {
  const a = headingView(0, r), b = pieceView('s', r);
  return Math.hypot(a.ux - b.ux, a.uy - b.uy, a.vx - b.vx, a.vy - b.vy) < 1e-9;
});
check('a cart driven east is the cart set down facing south, from every viewpoint', same.length === TURNS,
  `${same.length} of ${TURNS}`);

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`a body and a piece are both drawn the way round they are actually turned — ${ok.length} of ${ok.length}`);
