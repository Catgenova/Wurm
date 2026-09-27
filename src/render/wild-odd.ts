import {
  add, beat, bipedBones, birdBones, clamp, coatPalette, curve, cyc, darker, DEG, disc, eyes, frac, lerp, lighter, merge, mirrored, mix, onEgg, orb,
  orbAlong, paint, scale, smile, smooth, TAU, tube, type Anim, type BipedSpec, type BirdSpec, type Bones, type Disc, type Kind, type Piece,
} from './beasts';
import { joint, mesh, ROOT, type Mesh, type V3, type Xf } from './figure';
import { birdLegPieces, cut, under } from './beastkit';
import { patch } from './wild-birds';

/** The wildermon on two legs or more than four: the magga, the noot, the crawler. */

/* ---- the magga ---------------------------------------------------------------------- */

/**
 * A magga: a round black-and-white treetop bird that cannot leave anything
 * shiny where it lies. Its long tail ends in a stone of its own, and it wears
 * a little crown of three feathers; its wings and tail have the sheen of oil
 * on water.
 */
const MAGGA_SPEC: BirdSpec = {
  high: 1.25,
  leg: { at: [0.32, 0.05, -0.42], len: [0.42, 0.55, 0.08], rest: [28, -58] },
  neck: { at: [0, 0.72, 0.28], len: 0.3, lean: 20 },
  head: { pitch: 0 },
  wing: { at: [0.6, 0.42, 0.24] },
  tail: { at: [0, -0.95, 0.1], lift: 4 },
  swing: [26, 40],
  hop: true,
  thrust: 7,
  // Foraging, tipped well over, so that the beak meets the ground with the face still to be seen.
  peck: 60,
  tip: 45,
  nose: 16,
};

const MAGGA_HEAD = { c: [0, 0.22, 0.32] as V3, r: [0.6, 0.7, 0.56] as V3 };

function maggaBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 11), k = cut(lod, 5, 7);
  // A round body, black above and white beneath.
  const ys = [-1.05, -0.8, -0.3, 0.3, 0.72, 0.95];
  const body = tube(ys.map((y, q) => [0, y, [0.05, 0.08, 0.1, 0.12, 0.2, 0.28][q]] as V3), [0.2, 0.6, 0.76, 0.74, 0.55, 0.2], [0.18, 0.5, 0.62, 0.6, 0.46, 0.2], n,
    (ring, j) => (ring > 0 && under(n, j, 1.25) ? 'mark' : 'coat'));
  // A folded wing: a long feather-shaped flap down the flank, white across the shoulder, which is what shows it pied, and the rest sheened.
  const wingPts: V3[] = [[0, 0.1, 0.05], [0, -0.35, 0.02], [0, -0.9, -0.06], [0, -1.45, -0.12], [0, -1.8, -0.14]];
  const wing = tube(wingPts, [0.3, 0.44, 0.4, 0.28, 0.04], 0.08, n, (ring) => (ring <= 1 ? 'mark' : 'feather'), { up: [1, 0, 0] });
  // The long tail, flat, and the stone at its end.
  const tailPts: V3[] = curve([0, 0, 0], [0, -0.99, 0.02], [0, -1.9, 0.16], 5);
  const tail = merge(
    tube(tailPts, [0.18, 0.26, 0.3, 0.28, 0.22, 0.06], 0.06, n, 'feather', { up: [0, 0, 1] }),
    orbAlong(add(tailPts[5], [0, -0.18, 0.04]), [0, -1, 0.1], [0.16, 0.16, 0.26], 6, 4, 'crystal'),
  );
  const H = MAGGA_HEAD;
  const skull = orb(H.c, H.r, n + 1, k, 'coat');
  const beak = tube([[0, 0.76, 0.2], [0, 1.02, 0.15], [0, 1.3, 0.08]], [0.16, 0.1, 0.0], [0.13, 0.08, 0.0], 6, 'bill');
  const look = (shut: boolean) => eyes(H.c, H.r, [0.84, 0.42, 0.3], 0.21, { tall: 1.15, shut, rim: 0.28 });
  // The crown: three short feathers standing up from the crown of the head, one behind another, each tipped with a spark.
  const crown = merge(...[-1, 0, 1].map((q) => merge(
    tube(curve([q * 0.03, 0.09 + q * 0.14, 0.78], [q * 0.05, 0.06 + q * 0.2, 1.0], [q * 0.07, -0.01 + q * 0.26, 1.14 - Math.abs(q) * 0.06], 2), [0.07, 0.06, 0.03], [0.07, 0.06, 0.03], 5, 'coat'),
    orb([q * 0.07, -0.02 + q * 0.27, 1.18 - Math.abs(q) * 0.06], 0.1, 5, 3, 'crystal'),
  )));
  const hide = [{ c: H.c, r: H.r }];
  const pieces: Piece[] = [
    { key: 'body', mesh: body, bone: 'body', bias: 0, breathes: { c: [0, 0, 0.1], k: 0.05 } },
    { key: 'tail', mesh: tail, bone: 'tail0', bias: -0.05 },
    { key: 'neck', mesh: tube([[0, 0, -0.2], [0, 0, 0.3]], 0.45, 0.42, n, 'coat'), bone: 'neck', bias: 0, under: 'head', convex: true },
    { key: 'head', mesh: merge(skull, beak, look(false)), shut: merge(skull, beak, look(true)), bone: 'head', bias: 0.2 },
    { key: 'crown', mesh: crown, bone: 'head', bias: 0.21, after: 'head', hide },
    { key: 'wing0', mesh: mirrored(wing), bone: 'wing0', bias: 0.03, after: 'body', front: [-1, 0, 0] },
    { key: 'wing1', mesh: wing, bone: 'wing1', bias: 0.03, after: 'body', front: [1, 0, 0] },
    ...birdLegPieces('bl', -1, 0.55, 0.07, 5),
    ...birdLegPieces('br', 1, 0.55, 0.07, 5),
  ];
  return pieces;
}

export const MAGGA: Kind = {
  bones: (a) => birdBones(MAGGA_SPEC, a, (p) => {
    if (a.go > 0) return;
    const t = a.t;
    // Its snapped looks about a little smaller than most birds', so its face stays turned to whoever is looking at it.
    p.head[1] *= 0.7;
    p.head[2] *= 0.7;
    // Twice a loop the tail pumped, up and down and up again, the way a magpie's is, swinging the stone at its end.
    p.tail[0] += 24 * beat(t, [4.4, 4.85, 16.4, 16.85], 0.45) * (1 - a.graze);
  }),
  build: maggaBuild,
  palette: (coat, mark) => coatPalette(coat, mark, {
    feather: mix(coat, [70, 130, 170], 0.55), featherDark: mix(coat, [60, 110, 150], 0.4),
    crystal: [150, 226, 236], bill: [112, 104, 124], claw: [66, 62, 70], eye: [30, 26, 34],
  }),
  shadow: [1.4, 0.8],
  stride: 1.2,
  size: 1.9,
};

/* ---- the noot ----------------------------------------------------------------------- */

/**
 * A noot: a plump upright waddler in a slate coat, knee-deep in a clay pit
 * all day and delighted about it. A broad flat bill it digs with, big webbed
 * feet, a flat round tail like a stool with a potter's spiral worked into
 * it, a feathered crest, and the clay it lives in daubed up its front.
 */
const NOOT_SPEC: BipedSpec = {
  high: 1.0,
  leg: { at: [0.5, 0.1, -0.3], len: [0.36, 0.34, 0.1], rest: [8, -14] },
  chest: { at: [0, 0, 0.3], lean: 4 },
  neck: { at: [0, 0.05, 0.92], len: 0.2, lean: 0 },
  head: { pitch: 0 },
  arm: { at: [1.05, 0.0, 0.72], len: [0.45, 0.45], rest: [4, 22, 0] },
  tail: { at: [0, -0.8, -0.25], lift: -5, len: 0.5, links: 1 },
  swing: [26, 40],
  waddle: 9,
  armSwing: 14,
};

const NOOT_HEAD = { c: [0, 0.1, 0.42] as V3, r: [0.9, 0.84, 0.66] as V3 };
/** When it is delighted with itself: seconds into the loop, and how long for. */
const NOOT_JOY = [5.5, 17.5], NOOT_JOY_LEN = 1.2;

/** A band of `m` along an Archimedes spiral on a flat face at `c`, facing up: `turns` times round from `r0` out to `r1`, `w` across. */
function spiral(c: V3, r0: number, r1: number, turns: number, w: number, m: Disc['m'], steps = 28): Mesh {
  const out: V3[] = [], back: V3[] = [];
  for (let q = 0; q <= steps; q++) {
    const s = q / steps, a = s * turns * TAU, r = lerp(r0, r1, s), half = (w / 2) * Math.min(1, 0.4 + s * 3);
    out.push([c[0] + Math.cos(a) * (r + half), c[1] + Math.sin(a) * (r + half), c[2]]);
    back.push([c[0] + Math.cos(a) * (r - half), c[1] + Math.sin(a) * (r - half), c[2]]);
  }
  // Out along the outside edge and back along the inside one, which is anticlockwise seen from above, so it faces up.
  return paint([{ v: [...out, ...back.reverse()], m }]);
}

function nootBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 11), k = cut(lod, 5, 7);
  // The body: a pear standing up, slate behind and white before, the white smeared with clay.
  const trunk = tube([[0, 0, -0.5], [0, 0.02, -0.32], [0, 0.05, 0.12], [0, 0.05, 0.55], [0, 0.03, 0.9], [0, 0, 1.08]], [0.42, 1.12, 1.26, 1.14, 0.9, 0.3], [0.38, 0.98, 1.1, 1.0, 0.8, 0.28], n,
    (ring, j) => (ring > 0 && Math.abs(((j + 0.5) / n) * Math.PI * 2 - Math.PI * 0.5) < 1.1 ? 'mark' : 'coat'), { up: [0, 1, 0] });
  const clay = paint([
    disc([0.4, 1.06, 0.0], [0.3, 1, 0], 0.26, 0.18, 7, 'bark'),
    disc([-0.32, 1.08, 0.42], [-0.25, 1, 0.1], 0.2, 0.13, 7, 'bark'),
    disc([0.05, 1.02, -0.28], [0, 1, -0.2], 0.32, 0.14, 7, 'bark'),
  ]);
  const H = NOOT_HEAD;
  const skull = orb(H.c, H.r, n + 1, k + 1, 'coat');
  // A white face, painted round the eyes and over the brow, clear of where the bill comes out.
  const face = patch(H.c, H.r, [0, 1, 0.32], 0.95, 0.42, 'mark', { sides: 16 });
  const look = (shut: boolean) => eyes(H.c, H.r, [0.8, 0.5, 0.36], 0.22, { tall: 1.2, shut, rim: 0.25 });
  // The bill: broad, flat, long, and turned up at its end like a spade; a piece of its own on the head, so the face does not paint over it.
  const bill = merge(
    tube([[0, 0.72, 0.18], [0, 0.88, 0.16], [0, 1.1, 0.14], [0, 1.45, 0.15], [0, 1.72, 0.26]], [0.3, 0.36, 0.44, 0.5, 0.44], [0.12, 0.12, 0.1, 0.08, 0.06], n, 'bill'),
    paint([disc([0.12, 1.1, 0.25], [0, 0.2, 1], 0.05, 0.04, 5, 'nose'), disc([-0.12, 1.1, 0.25], [0, 0.2, 1], 0.05, 0.04, 5, 'nose')]),
  );
  // A crest of three feathers swept back off the crown.
  const crest = merge(...[-1, 0, 1].map((q) => tube(curve([q * 0.18, 0.1, 1.0], [q * 0.22, -0.15, 1.3], [q * 0.3, -0.5, 1.36], 3), [0.12, 0.1, 0.06, 0.01], [0.09, 0.08, 0.05, 0.01], 5, 'mark')));
  // A flipper of an arm, flat, broad from the front and thin seen edge on; and a broad webbed foot.
  const flipper = tube(curve([0, 0, 0.1], [0.05, 0.05, -0.4], [0.02, 0.12, -0.8], 3), [0.2, 0.3, 0.28, 0.1], [0.08, 0.1, 0.08, 0.04], n, 'coatDark', { up: [1, 0, 0] });
  const foot = merge(
    tube([[0, -0.12, 0], [0, 0.25, -0.05], [0, 0.55, -0.06]], [0.22, 0.34, 0.3], [0.1, 0.08, 0.05], n, 'bill'),
    ...[-0.18, 0, 0.18].map((x) => orb([x, 0.58, -0.05], [0.09, 0.09, 0.06], 5, 3, 'bill')),
  );
  // The stool of a tail, flat and round, with a potter's spiral pressed into its top in white.
  const tail = merge(
    tube([[0, 0, 0], [0, -0.05, 0], [0, -0.55, 0], [0, -0.85, 0]], [0.22, 0.42, 0.46, 0.2], 0.1, n, 'coatDark', { up: [0, 0, 1] }),
    spiral([0, -0.5, 0.105], 0.04, 0.33, 2, 0.06, 'mark'),
  );
  const hide = [{ c: H.c, r: H.r }];
  const legs = (key: string, side: number): Piece[] => {
    const front: V3 = [side * 0.8, 0.5, 0];
    return [
      { key: `${key}1`, mesh: tube([[0, 0, 0.1], [0, 0, -0.34]], [0.16, 0.14], [0.16, 0.14], n, 'bill'), bone: `${key}1`, bias: 0.01, after: 'body', front, convex: true },
      { key: `${key}2`, mesh: foot, bone: `${key}2`, bias: 0.02, after: 'body', front },
    ];
  };
  return [
    { key: 'body', mesh: merge(trunk, clay), bone: 'chest', bias: 0, breathes: { c: [0, 0, 0.4], k: 0.04 } },
    { key: 'tail', mesh: tail, bone: 'tail0', bias: -0.1 },
    { key: 'head', mesh: merge(skull, face, look(false)), shut: merge(skull, face, look(true)), bone: 'head', bias: 0.2 },
    // Seen from behind, the bill is behind the head and goes under it; what of it is up inside the head is hidden by it.
    { key: 'bill', mesh: bill, bone: 'head', bias: 0.205, after: 'head', front: [0, 1, 0], hide },
    { key: 'crest', mesh: crest, bone: 'head', bias: 0.21, after: 'head', hide },
    { key: 'arm0', mesh: mirrored(flipper), bone: 'arm0', bias: 0.03, after: 'body', front: [-1, 0.3, 0] },
    { key: 'arm1', mesh: flipper, bone: 'arm1', bias: 0.03, after: 'body', front: [1, 0.3, 0] },
    ...legs('ll', -1), ...legs('lr', 1),
  ];
}

export const NOOT: Kind = {
  bones: (a) => bipedBones(NOOT_SPEC, a, (p) => {
    if (a.go > 0) return;
    const t = a.t, gz = a.graze;
    // Its looks about kept small, so that its face stays turned to whoever is looking at it.
    p.neck[1] *= 0.6;
    p.head[1] *= 0.6;
    // Twice a loop, delighted with itself: flippers flung out and two little hops, the head up and the tail wagging.
    const joy = beat(t, NOOT_JOY, NOOT_JOY_LEN) * (1 - gz);
    if (joy > 0) {
      p.arms = [[p.arms[0][0] + 10 * joy, p.arms[0][1] + 40 * joy, p.arms[0][2]], [p.arms[1][0] + 10 * joy, p.arms[1][1] + 40 * joy, p.arms[1][2]]];
      p.lift += 0.3 * joy * Math.abs(Math.sin(t * TAU * 1.7));
      p.head[0] += 10 * joy;
      p.tail[1] += 16 * joy * Math.sin(t * TAU * 3);
    }
    if (gz > 0) {
      // Foraging, it is bent right over at the clay with its knees bent, the bill down in it and the face still to be seen, and its
      // flippers scooping by turns.
      const dig = cyc(t, 30);
      p.pitch -= 52 * gz;
      p.chest[0] += 32 * gz;
      p.head[0] += (56 + 3 * cyc(t, 72)) * gz;
      p.legs = [[gz * 50, gz * 0.6, 0], [gz * 50, gz * 0.6, 0]];
      p.arms = [[p.arms[0][0] + 20 * dig * gz, p.arms[0][1], p.arms[0][2]], [p.arms[1][0] - 20 * dig * gz, p.arms[1][1], p.arms[1][2]]];
    }
  }),
  build: nootBuild,
  palette: (coat, mark) => coatPalette(coat, mark, { bill: [236, 150, 84], bark: [186, 124, 92], nose: [120, 70, 50], coatDark: darker(coat, 0.3) }),
  shadow: [1.2, 1.1],
  stride: 1.6,
  size: 2.75,
};

/* ---- the crawler ------------------------------------------------------------------ */

/**
 * A crawler: a broad sand-coloured crab that goes at everything sideways and
 * has never once been sorry for pinching anybody. It carries a spiral shell
 * of its own on its back like a little tower, holds its eyes up on stalks,
 * and waves a claw at whatever it is pleased with.
 *
 * It is built facing along `x`, to its right of where it is headed, so that
 * going anywhere it goes sideways, as it would: its left and right are `y`.
 */

/** Its legs, three a side, front to back: where each comes out from under the shell, and how far each is fanned round from straight out. */
const CRAWLER_LEGS = [{ x: 0.5, fan: 26 }, { x: -0.08, fan: 2 }, { x: -0.62, fan: -24 }];
/** A leg's two parts, and where its hip is on either side: out under the rim of the shell, and a little below its middle. */
const CRAWLER_UPPER = 0.8, CRAWLER_LOWER = 1.1, CRAWLER_HIP: V3 = [0, 0.95, -0.1];
/** How far out from its hip each foot is put down, standing: which with the parts above sets the upper leg at 35 degrees and the knee at a hundred. */
const CRAWLER_REACH = 1.12, CRAWLER_DROP = 0.538;
/** How high its body is carried, and so how far under each hip the ground is. */
const CRAWLER_HIGH = CRAWLER_DROP - CRAWLER_HIP[2];

/** The turn of a frame undone, and its place: a point in the world brought into the frame. */
const into = (x: Xf, p: V3): V3 => {
  const d: V3 = [p[0] - x.t[0], p[1] - x.t[1], p[2] - x.t[2]];
  const m = x.m;
  return [m[0] * d[0] + m[3] * d[1] + m[6] * d[2], m[1] * d[0] + m[4] * d[1] + m[7] * d[2], m[2] * d[0] + m[5] * d[1] + m[8] * d[2]];
};

/**
 * What puts a leg's foot at `p`, measured from its hip in the body's frame,
 * on the side `sd`: the turn about the upright (degrees), then how far the
 * upper part is lifted from level and the knee bent back down from it -- the
 * one way two parts of these lengths reach a point with the knee up.
 */
function reachFor(p: V3, sd: number): [number, number, number] {
  const U = CRAWLER_UPPER, L = CRAWLER_LOWER;
  const out = Math.hypot(p[0], p[1]);
  const yaw = Math.atan2(-p[0] * sd, p[1] * sd);
  const d = clamp(Math.hypot(out, p[2]), Math.abs(U - L) + 1e-3, U + L - 1e-3);
  const knee = -Math.acos(clamp((d * d - U * U - L * L) / (2 * U * L), -1, 1));
  const lift = Math.atan2(p[2], out) - Math.atan2(L * Math.sin(knee), U + L * Math.cos(knee));
  return [yaw / DEG, lift / DEG, knee / DEG];
}

function crawlerBones(a: Anim): Bones {
  const t = a.t, w = frac(a.u), go = a.go, run = go * a.gait, gz = a.graze * (1 - go);
  // Going, it bobs twice a stride as each three legs take it, and rocks from side to side over them; running, it goes lower, and
  // bobs harder. Foraging, it settles down over its claws.
  const bob = go * (0.03 + 0.05 * run) * Math.sin(w * TAU * 2);
  const body = joint(ROOT, [0, 0, CRAWLER_HIGH - 0.2 * gz - 0.14 * run + bob], (2.5 + 2 * run) * go * Math.sin(w * TAU), 1.5 * go * Math.sin(w * TAU * 2), 0);
  const b: Bones = { body };
  // The eyes up on their stalks, wandering on their own, and turned the way it goes while it goes; laid back as it runs.
  for (let k = 0; k < 2; k++) {
    const sd = k ? 1 : -1;
    b[`eye${k}`] = joint(body, [0.62, sd * 0.34, 0.4], 8 * cyc(t, 3 + k, k) * (1 - go), 10 * cyc(t, 5, k * 2) * (1 - go) - 28 * run, 45 * go);
  }
  // The claws: held up in front, opened and shut now and then, and the right one waved when it is pleased -- lifted and waggled, the
  // arm and all, and pinching away; tucked in tight at a run, and scooping at the sand by turns as it forages.
  const wave = beat(t, [7.5, 19.5], 1.6) * (1 - go);
  for (let k = 0; k < 2; k++) {
    const sd = k ? 1 : -1;
    const lift = k === 1 ? wave : 0;
    const scoop = gz * (0.5 + 0.5 * Math.sin(t * TAU * 0.75 + k * Math.PI));
    b[`arm${k}`] = joint(body, [0.72, sd * 0.86, 0.02], 0, -12 - 35 * lift + 25 * scoop + 10 * run, sd * (40 - 25 * run));
    b[`claw${k}`] = joint(b[`arm${k}`], [0.9, 0, 0.1], 0, -(50 + 40 * lift + 15 * run) + 80 * scoop, sd * (-24 + 14 * Math.sin(t * 12) * lift - 20 * run));
    b[`nip${k}`] = joint(b[`claw${k}`], [0.78, 0, 0.065], 0, 0, sd * (12 + 18 * Math.max(0, lift ? Math.sin(t * TAU * 3) : cyc(t, 11, k))));
  }
  // Three legs a side, each out and up from under the shell and down at a sharp knee to the ground: in two threes by turns, each foot put
  // down on the ground and left there while the body goes over it sideways, then picked up and put down again ahead, higher at a run.
  const duty = lerp(0.62, 0.42, a.gait), sweep = lerp(0.6, 0.7, a.gait), high = lerp(0.24, 0.36, a.gait);
  CRAWLER_LEGS.forEach((leg, i) => {
    for (let k = 0; k < 2; k++) {
      const sd = k ? 1 : -1;
      const hip: V3 = [leg.x, sd * CRAWLER_HIP[1], CRAWLER_HIP[2]];
      const fan = leg.fan * DEG;
      const ph = frac(a.u + ((i + k) % 2) * 0.5);
      let dy = 0, up = 0;
      if (ph < duty) dy = sweep * (0.5 - ph / duty);
      else {
        const s = (ph - duty) / (1 - duty);
        dy = sweep * (smooth(s) - 0.5);
        up = high * Math.sin(Math.PI * s);
      }
      const foot: V3 = [hip[0] + Math.sin(fan) * CRAWLER_REACH, hip[1] + sd * Math.cos(fan) * CRAWLER_REACH + go * dy, go * up];
      const [yaw, lift, knee] = reachFor(into(body, foot).map((v, q) => v - hip[q]) as V3, sd);
      const upper = joint(body, hip, sd * lift, 0, yaw);
      const lower = joint(upper, [0, sd * CRAWLER_UPPER, 0], sd * knee, 0, 0);
      b[`leg${i}${k}0`] = upper;
      b[`leg${i}${k}1`] = lower;
      // The tips of the front and back legs, under the names the island measures a stride by.
      if (i !== 1) b[`${i ? 'h' : 'f'}${k ? 'r' : 'l'}2`] = joint(lower, [0, sd * CRAWLER_LOWER, 0]);
    }
  });
  return b;
}

/** The same mesh left for right, as the crawler has it: across `y`, its faces wound back the right way out. */
const acrossY = (m: Mesh): Mesh => mesh(m.v.map((p) => [p[0], -p[1], p[2]] as V3), m.f.map((f) => ({ ...f, i: [...f.i].reverse() })));

function crawlerBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 11), k = cut(lod, 5, 7);
  // The carapace: broad from side to side and shallow from front to back, flattish and round-edged, paler underneath.
  const ys = [-1.4, -1.15, -0.6, 0, 0.6, 1.15, 1.4];
  const body = tube(ys.map((y, q) => [0, y, [0, 0.06, 0.12, 0.14, 0.12, 0.06, 0][q]] as V3), [0.18, 0.62, 0.86, 0.9, 0.86, 0.62, 0.18], [0.12, 0.34, 0.48, 0.52, 0.48, 0.34, 0.12], n,
    (ring, j) => (ring > 0 && ring < ys.length - 1 && under(n, j, 1.2) ? 'mark' : 'coat'));
  // Pale spots over the shell where the tower does not cover them, and a small smile at the front of it between the claws.
  const shellC: V3 = [0, 0, 0.14], shellR: V3 = [0.92, 1.42, 0.52];
  const spots = paint(([[0.55, 0.7, 0.35], [0.3, -0.95, 0.4], [-0.3, 1.05, 0.4], [0.6, -0.55, 0.3], [-0.45, -0.75, 0.55]] as V3[]).map((d) => {
    const at = onEgg(shellC, shellR, d);
    return disc(add(at.p, scale(at.n, 0.04)), at.n, 0.16, 0.12, 7, 'spot');
  }));
  const mouth = smile([0.86, 0, 0.12], [1, 0, 0.25], 0.28);
  // The tower of a shell it carries: a whorl narrowing to a point, in its own pale colours, with the dark mouth of it at its foot.
  const whorl: V3[] = [];
  for (let q = 0; q <= 12; q++) {
    const s = (q / 12) * Math.PI * 5, r = 0.4 * (1 - q / 13);
    whorl.push([-0.28 + Math.cos(s) * r, Math.sin(s) * r, 0.64 + q * 0.07]);
  }
  const base: V3 = [-0.28, 0, 0.64], baseR: V3 = [0.6, 0.56, 0.3];
  const opening = onEgg(base, baseR, [0.25, 1, -0.35]);
  const tower = merge(
    orb(base, baseR, n, k, 'shell'),
    tube(whorl, whorl.map((_, q) => 0.3 * (1 - q / 13.5)), whorl.map((_, q) => 0.26 * (1 - q / 13.5)), n, (ring) => (ring % 3 === 2 ? 'shellDark' : 'shell')),
    paint([disc(add(opening.p, scale(opening.n, 0.02)), opening.n, 0.24, 0.15, 9, 'eye')]),
  );
  const stalk = merge(
    tube([[0, 0, 0], [0, 0, 0.36]], 0.09, 0.09, 6, 'coat'),
    orb([0.02, 0, 0.52], 0.25, n, k, 'eyeWhite'),
    paint([disc([0.26, 0, 0.53], [1, 0, 0.1], 0.14, 0.16, 8, 'eye'), disc([0.28, 0.06, 0.6], [1, 0, 0.1], 0.05, 0.05, 5, 'glint', { lit: true })]),
  );
  // An arm, and on it the claw -- half as big again as it was -- and its movable finger, the nip; the left side the right one across `y`.
  const C = 1.3;
  const arm = tube([[0, 0, 0], [0.45, 0, 0.05], [0.9, 0, 0.1]], [0.16, 0.18, 0.2], [0.16, 0.18, 0.2], n, 'coat');
  const claw = merge(orbAlong([0.3 * C, 0, 0], [1, 0, 0], [0.34 * C, 0.4 * C, 0.3 * C], n, k, 'coat'), tube([[0.4 * C, 0.05 * C, 0], [0.9 * C, 0.12 * C, 0.02 * C]], [0.13 * C, 0.03], [0.12 * C, 0.03], 6, 'coatDark'));
  const nip = tube([[0, -0.1 * C, 0], [0.45 * C, -0.18 * C, 0.02 * C]], [0.1 * C, 0.025], [0.1 * C, 0.025], 6, 'coatDark');
  const pieces: Piece[] = [
    { key: 'body', mesh: merge(body, spots, mouth), bone: 'body', bias: 0, breathes: { c: [0, 0, 0], k: 0.03 } },
    { key: 'tower', mesh: tower, bone: 'body', bias: 0.05, after: 'body' },
  ];
  // Each leg's upper part out from under the shell, and its lower part down from the knee, dark at the tip.
  const upperOf = (sd: number): Mesh => tube([[0, 0, 0], [0, sd * CRAWLER_UPPER, 0]], [0.13, 0.11], [0.13, 0.11], 6, 'coat', { seam: 'start' });
  const lowerOf = (sd: number): Mesh => tube([[0, -sd * 0.06, 0], [0, sd * 0.6, 0], [0, sd * CRAWLER_LOWER, 0]], [0.1, 0.075, 0.02], [0.1, 0.075, 0.02], 6, (ring) => (ring === 1 ? 'coatDark' : 'coat'));
  for (let s = 0; s < 2; s++) {
    const sd = s ? 1 : -1;
    const front: V3 = [0.6, sd * 0.8, 0];
    pieces.push(
      { key: `eye${s}`, mesh: stalk, bone: `eye${s}`, bias: 0.06, after: 'body', front: [1, 0, 0] },
      { key: `arm${s}`, mesh: s ? arm : acrossY(arm), bone: `arm${s}`, bias: 0.02, after: 'body', front },
      { key: `claw${s}`, mesh: s ? claw : acrossY(claw), bone: `claw${s}`, bias: 0.03, after: 'body', front },
      { key: `nip${s}`, mesh: s ? nip : acrossY(nip), bone: `nip${s}`, bias: 0.035, after: 'body', front },
    );
    const up = upperOf(sd), low = lowerOf(sd), lf: V3 = [0, sd, 0];
    for (let i = 0; i < 3; i++) {
      pieces.push(
        { key: `leg${i}${s}0`, mesh: up, bone: `leg${i}${s}0`, bias: 0.01, after: 'body', front: lf, convex: true, thin: true },
        { key: `leg${i}${s}1`, mesh: low, bone: `leg${i}${s}1`, bias: 0.015, after: 'body', front: lf, convex: true, thin: true },
      );
    }
  }
  return pieces;
}

export const CRAWLER: Kind = {
  bones: crawlerBones,
  build: crawlerBuild,
  palette: (coat, mark) => coatPalette(coat, mark, { spot: lighter(mark, 0.35), shell: [246, 222, 214], shellDark: [224, 176, 170], nose: darker(coat, 0.45) }),
  shadow: [1.9, 1.3],
  stride: 1.8,
  size: 2.6,
};
