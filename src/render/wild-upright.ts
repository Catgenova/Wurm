import {
  add, beat, bend, bipedBones, blush, coatPalette, cross, curve, cyc, darker, disc, dot, drift, eyes, lighter, merge, mirrored, mix, moved, onEgg, orb, orbAlong, paint,
  pastel, scale, smile, sub, taper, TAU, tube, unit, type BipedPose, type BipedSpec, type Disc, type Kind, type Piece,
} from './beasts';
import { joint, mesh, ROOT, type Mat, type Mesh, type V3 } from './figure';
import { blade, cut } from './beastkit';

/**
 * The ones that stand up: the tinka, and the three bad things of the high
 * ground -- the goblin, the orc and the ogre -- each a chunky soft-edged
 * body like every other wildermon, and each with what it carries in its hand.
 */

/** Arms and legs on the upright bones: an upper and a lower tube down each, a hand and a foot as the kind makes them. */
function limbs(o: { n: number; arm: [number, number]; armW: [number, number]; hand: Mesh; leg: [number, number]; legW: [number, number]; foot: Mesh; armMat?: Mat; legMat?: Mat }): Piece[] {
  const out: Piece[] = [];
  for (const [k, sd] of [[0, -1], [1, 1]] as Array<[number, number]>) {
    const front: V3 = [sd, 0.35, 0];
    out.push(
      { key: `arm${k}`, mesh: tube([[0, 0, 0.12], [0, 0, -o.arm[0]]], [o.armW[0], o.armW[0] * 0.9], [o.armW[0], o.armW[0] * 0.9], o.n, o.armMat ?? 'coat', { seam: 'both' }), bone: `arm${k}`, bias: 0.03, after: 'body', front, convex: true },
      { key: `fore${k}`, mesh: tube([[0, 0, 0.05], [0, 0, -o.arm[1]]], [o.armW[1], o.armW[1] * 0.92], [o.armW[1], o.armW[1] * 0.92], o.n, o.armMat ?? 'coat', { seam: 'both' }), bone: `elbow${k}`, bias: 0.035, after: 'body', front, convex: true },
      { key: `hand${k}`, mesh: sd < 0 ? mirrored(o.hand) : o.hand, bone: `hand${k}`, bias: 0.04, after: 'body', front },
    );
  }
  for (const [key, sd] of [['ll', -1], ['lr', 1]] as Array<[string, number]>) {
    const front: V3 = [sd * 0.8, 0.5, 0];
    out.push(
      // After the hips as well as the body: the near thigh comes out over the seat of the hips however far it swings back.
      { key: `${key}0`, mesh: tube([[0, 0, 0.12], [0, 0, -o.leg[0]]], [o.legW[0], o.legW[0] * 0.9], [o.legW[0], o.legW[0] * 0.9], o.n, o.legMat ?? 'coat', { seam: 'both' }), bone: `${key}0`, bias: 0.01, after: ['body', 'hips'], front, convex: true },
      { key: `${key}1`, mesh: tube([[0, 0, 0.05], [0, 0, -o.leg[1]]], [o.legW[1], o.legW[1] * 0.92], [o.legW[1], o.legW[1] * 0.92], o.n, o.legMat ?? 'coat', { seam: 'both' }), bone: `${key}1`, bias: 0.015, after: 'body', front, convex: true },
      { key: `${key}2`, mesh: sd < 0 ? mirrored(o.foot) : o.foot, bone: `${key}2`, bias: 0.02, after: 'body', front },
    );
  }
  return out;
}

/**
 * A hand: a palm and `fingers` fingers `len` long fanned forward and down
 * from it, the thumb in; each finger `thick` of the palm across at its root,
 * in a colour of its own if it has one, and its last joint in another if
 * its tips are dark.
 */
function hand(r: number, fingers: number, len: number, n: number, mat: Mat = 'coat', o: { thick?: number; fingerMat?: Mat; tipMat?: Mat } = {}): Mesh {
  const spread = 0.5, w = o.thick ?? 0.24;
  const fingerMat = o.fingerMat ?? mat, tipMat = o.tipMat;
  return merge(
    orbAlong([0, r * 0.3, -r * 0.4], [0, 0.4, -1], [r * 0.9, r * 0.8, r], n, 4, mat),
    ...Array.from({ length: fingers }, (_, q) => {
      const a = fingers > 1 ? (q / (fingers - 1) - 0.5) * spread * 2 : 0;
      const root: V3 = [Math.sin(a) * r * 0.6, r * 0.55, -r * 0.9];
      const mid = add(root, [Math.sin(a) * len * 0.35, len * 0.35, -len * 0.4]), tip = add(root, [Math.sin(a) * len * 0.6, len * 0.45, -len * 0.95]);
      // A dark tip is the last fifth of the finger.
      return tipMat
        ? taper([0, 0.45, 0.8, 1].map((t) => bend(root, mid, tip, t)), r * w, r * w * 0.66, 5, (ring) => (ring >= 2 ? tipMat : fingerMat))
        : taper(curve(root, mid, tip, 2), r * w, r * w * 0.66, 5, fingerMat);
    }),
  );
}

/** A bare foot: a soft lump forward of the ankle, toes rounded. */
const pawFoot = (r: number, len: number, n: number, mat: Mat = 'coat'): Mesh => orbAlong([0, len * 0.35, -r * 0.55], [0, 1, 0], [r, len * 0.62, r * 0.6], n, 4, mat);

/* ---- a monster's face -------------------------------------------------------------- */

/** The corners of a flat shape, in the order that makes it face out along `n` (the way `render` tells which way a facet faces). */
function outward(v: V3[], n: V3): V3[] {
  let nx = 0, ny = 0, nz = 0;
  for (let q = 0; q < v.length; q++) {
    const a = v[q], b = v[(q + 1) % v.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return nx * n[0] + ny * n[1] + nz * n[2] < 0 ? [...v].reverse() : v;
}

/**
 * The glower the bad things of the high ground have instead of the round
 * eyes every other wildermon looks back with: over eyes made by `eyes` with
 * the same `dir`, `size` and `tall`, a lid on the top of each whose lower edge
 * is a straight line sloping down toward the nose -- `drop` of the eye's
 * height down at its middle, lower by `slope` of it at the inner corner --
 * and above it a heavy brow along the skin, sloping the same way and
 * thickest over the nose. The lids are painted on the head, after its eyes;
 * the brows are a piece of their own, drawn over the head.
 */
export function glower(c: V3, r: V3, dir: V3, size: number, o: { tall?: number; drop?: number; slope?: number; brow?: number } = {}): { lids: Mesh; brows: Mesh } {
  const tall = o.tall ?? 1.15, drop = o.drop ?? 0.4, slope = o.slope ?? 0.3, br = o.brow ?? size * 0.3;
  const A = size * 1.12, B = size * tall * 1.12;
  const lids: Disc[] = [];
  const brows: Mesh[] = [];
  for (const s of [1, -1]) {
    const { p, n } = onEgg(c, r, [dir[0] * s, dir[1], dir[2]]);
    // Across the eye toward the nose, and up it.
    let u = unit(cross([0, 0, 1], n));
    if (u[0] * s > 0) u = scale(u, -1);
    let w = cross(n, u);
    if (w[2] < 0) w = scale(w, -1);
    const at = (a: number, b: number, lift: number): V3 => add(add(p, scale(n, lift)), add(scale(u, a), scale(w, b)));
    // The lid: the top of an ellipse a little bigger than the eye, cut off along the sloping line.
    const edge = (a: number): number => B * (1 - 2 * drop) - (slope * B * a) / A;
    const round: Array<[number, number]> = Array.from({ length: 16 }, (_, q) => [Math.cos((q / 16) * TAU) * A, Math.sin((q / 16) * TAU) * B]);
    const lid: Array<[number, number]> = [];
    round.forEach(([a0, b0], q) => {
      const [a1, b1] = round[(q + 1) % round.length];
      const f0 = b0 - edge(a0), f1 = b1 - edge(a1);
      if (f0 >= 0) lid.push([a0, b0]);
      if (f0 >= 0 !== f1 >= 0) lid.push([a0 + ((a1 - a0) * f0) / (f0 - f1), b0 + ((b1 - b0) * f0) / (f0 - f1)]);
    });
    lids.push({ v: outward(lid.map(([a, b]) => at(a, b, 0.06)), n), m: 'lid' });
    // The brow, a little above the lid, laid on the skin.
    const pts = [-1.15, 0, 1.15].map((f) => {
      const on = onEgg(c, r, sub(at(f * A, B * (1.2 - slope * f * 0.9), 0), c));
      return add(on.p, scale(on.n, br * 0.45));
    });
    brows.push(tube(pts, [br * 0.7, br, br * 1.1], [br * 0.6, br * 0.85, br * 0.95], 5, 'coatDark'));
  }
  return { lids: paint(lids), brows: merge(...brows) };
}

/**
 * A mouth laid along the skin of a head through `dirs` (ways out of the
 * middle of it), `w` thick, with teeth hanging from the top of it: each tooth
 * where along the mouth it is (nought to one) and how long.
 */
function grin(c: V3, r: V3, dirs: V3[], w: number, teeth: Array<[number, number]>): Mesh {
  const on = dirs.map((d) => onEgg(c, r, d));
  const pts = on.map(({ p, n }) => add(p, scale(n, w * 0.8)));
  const fangs = teeth.map(([f, len]): Disc => {
    const x = f * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(x)), k = x - i;
    const n = unit(add(scale(on[i].n, 1 - k), scale(on[i + 1].n, k)));
    const along = unit(sub(pts[i + 1], pts[i]));
    let down = unit(cross(along, n));
    if (down[2] > 0) down = scale(down, -1);
    const base = add(add(pts[i], scale(sub(pts[i + 1], pts[i]), k)), scale(n, w * 1.3));
    return { v: outward([add(base, scale(along, -len * 0.42)), add(base, scale(along, len * 0.42)), add(base, scale(down, len))], n), m: 'tooth' };
  });
  return merge(tube(pts, w, w, 4, 'nose'), paint(fangs));
}

/* ---- the tinka --------------------------------------------------------------------- */

/**
 * A tinka: a small, fussy, masked thing on its hind legs, forever taking
 * something apart. Six long fingers on each hand, always busy; brass rings
 * round its great eyes like a jeweller's glasses; a screw tucked behind one
 * ear; and a ringed tail held up behind it.
 */
const TINKA_SPEC: BipedSpec = {
  high: 0.86,
  leg: { at: [0.48, 0, -0.1], len: [0.4, 0.38, 0.1], rest: [12, -24] },
  chest: { at: [0, 0, 0.2], lean: 16 },
  neck: { at: [0, 0.1, 1.08], len: 0.22, lean: 0 },
  head: { pitch: -4 },
  arm: { at: [0.94, 0.12, 0.82], len: [0.55, 0.55], rest: [28, 14, 62] },
  tail: { at: [0, -0.68, 0.1], lift: 60, len: 0.55, links: 3 },
  swing: [30, 44],
  waddle: 4,
  armSwing: 10,
};

const TINKA_HEAD = { c: [0, 0.12, 0.72] as V3, r: [1.08, 1.0, 0.92] as V3 };

/**
 * How much bigger the head is drawn than it is built, about the skull's middle, rings, ears and all. A tinka is the smallest
 * thing on its feet, and at the size it is played at its face is what says what it is: half the rabba's area with its head as
 * built, and the goggles a smudge.
 */
const TINKA_HEAD_GROW = 1.15;
const grown = (m: Mesh, c: V3, k: number): Mesh => ({ ...m, v: m.v.map((q): V3 => [c[0] + (q[0] - c[0]) * k, c[1] + (q[1] - c[1]) * k, c[2] + (q[2] - c[2]) * k]) });

/** The tail's girth where each of its three links starts, and at its tip. */
const TINKA_TAIL = [0.38, 0.35, 0.28, 0.16];

function tinkaBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 10), k = cut(lod, 5, 6);
  // A plump little body on short legs, so that at the size it is played at it is a body and not a stick under its eyes.
  const torso = tube([[0, 0, -0.25], [0, 0.03, 0.15], [0, 0.04, 0.6], [0, 0.02, 1.0], [0, 0, 1.18]], [0.86, 1.04, 0.98, 0.74, 0.38], [0.72, 0.86, 0.82, 0.64, 0.34], n,
    (ring, j) => (ring > 0 && Math.abs(((j + 1) / n) * TAU - Math.PI * 0.5) < 1.0 ? 'mark' : 'coat'), { up: [0, 1, 0] });
  const H = TINKA_HEAD;
  const skull = orb(H.c, H.r, n + 1, k + 1, 'coat');
  // The eyes far enough round the head that one is whole inside the outline seen side on, with the muzzle out in front of it.
  const eyeDir: V3 = [0.8, 0.5, 0.26];
  // The mask across the eyes, a pale muzzle and a small dark nose at the end of it.
  const face = merge(
    orbAlong(add(H.c, [0, 0.62, 0.1]), [0, 1, 0.1], [0.92, 0.36, 0.34], n, k, 'coatDark'),
    orbAlong(add(H.c, [0, 0.98, -0.1]), [0, 1, -0.25], [0.34, 0.34, 0.42], n, k, 'mark'),
    orbAlong(add(H.c, [0, 1.42, -0.16]), [0, 1, 0.2], [0.13, 0.09, 0.1], 5, 3, 'nose'),
    smile(add(H.c, [0, 1.3, -0.42]), [0, 1, -0.4], 0.34),
    blush(H.c, H.r, [0.78, 0.5, -0.3], 0.18),
  );
  const look = (shut: boolean): Mesh => eyes(H.c, H.r, eyeDir, 0.31, { tall: 1.05, shut, rim: 0.1 });
  // Brass rings round the eyes, like a jeweller's glasses grown on: each a hoop round the way its eye looks, wide enough that the
  // whole eye shows inside it, and lying on the curve of the head a little off the skin rather than flat across it, so that the
  // far one does not stand up over the top of the head seen side on.
  const rings = merge(...[1, -1].map((s) => {
    const { p, n: out } = onEgg(H.c, H.r, [eyeDir[0] * s, eyeDir[1], eyeDir[2]]);
    const u = unit(cross([0, 0, 1], out)), v = cross(out, u);
    const pts = Array.from({ length: 17 }, (_, q) => {
      const on = onEgg(H.c, H.r, sub(add(p, add(scale(u, Math.cos((q / 16) * TAU) * 0.41), scale(v, Math.sin((q / 16) * TAU) * 0.43))), H.c));
      return add(on.p, scale(on.n, 0.05));
    });
    return tube(pts, 0.045, 0.045, 5, 'crystal', { start: false, end: false });
  }));
  // Big round ears, pale inside.
  const ear = (s: number): Mesh => merge(
    orbAlong(add(H.c, [s * 0.78, -0.12, 0.72]), [s * 0.6, 0.35, 0.72], [0.38, 0.14, 0.42], n, k, 'coat'),
    orbAlong(add(H.c, [s * 0.8, -0.02, 0.72]), [s * 0.6, 0.35, 0.72], [0.26, 0.06, 0.3], n, k, 'inner'),
  );
  // A screw tucked behind the right ear like a pencil: its slotted head up by the ear, its threaded shank poking out behind.
  const tip: V3 = add(H.c, [0.75, -1.1, 0.25]), head: V3 = add(tip, scale(unit([-0.1, 0.8, 0.55]), 0.65)), along = unit(sub(head, tip));
  const screw = merge(
    taper([tip, add(tip, scale(along, 0.2)), add(tip, scale(along, 0.4)), head], 0.03, 0.07, 5, (ring) => (ring % 2 ? 'hornDark' : 'horn')),
    orbAlong(head, along, [0.13, 0.13, 0.05], 6, 3, 'horn'),
    paint([disc(add(head, scale(along, 0.055)), along, 0.12, 0.025, 4, 'nose', { up: [0, 0, 1] })]),
  );
  // A tail in rings, carried up high behind, its end curled.
  const tail = [0, 1, 2].map((q) => tube([[0, 0.08, 0], [0, -0.28, 0], [0, -0.58, 0]], [TINKA_TAIL[q], (TINKA_TAIL[q] + TINKA_TAIL[q + 1]) / 2, TINKA_TAIL[q + 1]],
    [TINKA_TAIL[q], (TINKA_TAIL[q] + TINKA_TAIL[q + 1]) / 2, TINKA_TAIL[q + 1]], 6, (ring) => (ring % 2 ? 'coatDark' : 'coat'), { start: false, end: q === 2 }));
  const hide = [{ c: H.c, r: H.r }];
  const pieces: Piece[] = [
    { key: 'hips', mesh: orb([0, 0, 0], [0.9, 0.76, 0.6], n, k, 'coat'), bone: 'body', bias: 0 },
    { key: 'body', mesh: torso, bone: 'chest', bias: 0.005, breathes: { c: [0, 0, 0.4], k: 0.04 } },
    ...tail.map((m, q): Piece => ({ key: `tail${q}`, mesh: m, bone: `tail${q}`, bias: -0.1 + q * 0.01, chain: 'tail' })),
    { key: 'head', mesh: merge(skull, face, look(false)), shut: merge(skull, face, look(true)), bone: 'head', bias: 0.2 },
    { key: 'rings', mesh: rings, bone: 'head', bias: 0.205, after: 'head', hide },
    { key: 'ear0', mesh: ear(-1), bone: 'head', bias: 0.21, after: 'head', hide },
    { key: 'ear1', mesh: ear(1), bone: 'head', bias: 0.21, after: 'head', hide },
    { key: 'screw', mesh: screw, bone: 'head', bias: 0.195, hide },
    // Pale hands with dark tips to the fingers, and no lines between the fingers, only round the hand: six fingers each inked, or
    // dark all over, are a black mitten at the size it is played at.
    ...limbs({ n, arm: [0.55, 0.55], armW: [0.22, 0.19], hand: hand(0.22, 6, 0.5, n, 'mark', { thick: 0.3, tipMat: 'coatDark' }), leg: [0.4, 0.38], legW: [0.3, 0.25], foot: pawFoot(0.24, 0.52, n, 'mark') })
      .map((pc): Piece => (pc.key.startsWith('hand') ? { ...pc, lines: false } : pc)),
  ];
  const g = TINKA_HEAD_GROW;
  return pieces.map((pc): Piece => (pc.bone !== 'head' ? pc : {
    ...pc,
    mesh: grown(pc.mesh, H.c, g),
    ...(pc.shut ? { shut: grown(pc.shut, H.c, g) } : {}),
    ...(pc.hide ? { hide: pc.hide.map((h) => ({ c: h.c, r: [h.r[0] * g, h.r[1] * g, h.r[2] * g] as V3 })) } : {}),
  }));
}

export const TINKA: Kind = {
  bones: (a) => {
    const b = bipedBones(TINKA_SPEC, a, (p: BipedPose) => {
      if (a.go > 0) {
        // A quick scurry, hunched, the tail up and swinging.
        p.chest[0] += 8 * a.go;
        p.tail[0] -= 10 * a.go;
        return;
      }
      const t = a.t, gz = a.graze;
      // Busy: the hands working at something held between them, the head tipped down at it; now and then the thing held up to one
      // eye to be looked at close.
      const peer = beat(t, [8.4, 19.6], 2.2) * (1 - gz);
      const fid = Math.sin(t * TAU * 1.5), fid2 = Math.sin(t * TAU * 2.1 + 1);
      p.head[0] -= (8 * (1 - peer) - 6 * peer) * (1 - gz);
      p.head[1] *= 0.4;
      p.arms[0] = [p.arms[0][0] + 15 * fid * (1 - gz) + 40 * peer, p.arms[0][1] - 4, p.arms[0][2] + 15 * fid2 * (1 - gz) + 30 * peer];
      p.arms[1] = [p.arms[1][0] - 15 * fid2 * (1 - gz) + 10 * peer, p.arms[1][1] - 4, p.arms[1][2] - 15 * fid * (1 - gz)];
      p.tail[1] += 10 * cyc(t, 6);
      // Foraging it squats right down and digs at the ground between its feet: the chest bowed further than the general bend,
      // the knees folded deep and the thighs forward, the arms straight down to the ground, and the face up off it enough to be
      // seen, a little down from level.
      p.chest[0] += 10 * gz;
      p.head[0] += 12 * gz;
      p.legs = p.legs.map((l) => [l[0] + 20 * gz, l[1] + 0.5 * gz, l[2]] as [number, number, number]);
      p.arms = p.arms.map((ar) => [ar[0] - 10 * gz, ar[1], ar[2] - 30 * gz] as [number, number, number]) as BipedPose['arms'];
    });
    // The tail's last link curled up at the end.
    b.tail2 = joint(b.tail2, [0, 0, 0], -20);
    return b;
  },
  build: tinkaBuild,
  palette: (coat, mark) => coatPalette(coat, mark, { crystal: [236, 190, 96], horn: [196, 204, 214], hornDark: [150, 158, 172], nose: [80, 60, 70], coatDark: darker(pastel(coat), 0.5) }),
  shadow: [1.2, 1.0],
  stride: 1.6,
  size: 1.9,
};

/* ---- the goblin -------------------------------------------------------------------- */

/**
 * A goblin: knee-high, green-grey and entirely malice, all ears and grin,
 * in a jerkin somebody else made -- patched, belted, too big -- and holding
 * a notched blade it did not make either.
 */
const GOBLIN_SPEC: BipedSpec = {
  high: 1.0,
  leg: { at: [0.34, 0, -0.1], len: [0.46, 0.46, 0.1], rest: [16, -32] },
  chest: { at: [0, 0, 0.18], lean: 20 },
  neck: { at: [0, 0.12, 1.02], len: 0.2, lean: 0 },
  head: { pitch: -8 },
  arm: { at: [0.68, 0.1, 0.8], len: [0.5, 0.5], rest: [10, 16, 30] },
  swing: [32, 46],
  waddle: 6,
  armSwing: 24,
};

const GOBLIN_HEAD = { c: [0, 0.14, 0.58] as V3, r: [0.95, 0.9, 0.84] as V3 };

/** Where the cutting edge of the goblin's blade is, along it: its line, with two notches bitten out of it. */
const GOBLIN_EDGE: Array<[number, number]> = [[0.05, 0.2], [0.3, 0.26], [0.52, 0.27], [0.62, 0.06], [0.72, 0.26], [0.9, 0.25], [1.0, 0.07], [1.1, 0.22], [1.3, 0.14], [1.48, 0.02]];

function goblinBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 10), k = cut(lod, 5, 6);
  // The jerkin: leather, too big for it, belted, with a patch sewn on in another leather.
  const jerkin = merge(
    tube([[0, 0, -0.35], [0, 0.03, 0.05], [0, 0.04, 0.55], [0, 0.02, 0.95], [0, 0, 1.12]], [0.66, 0.72, 0.68, 0.56, 0.32], [0.6, 0.64, 0.6, 0.5, 0.3], n, 'leather', { up: [0, 1, 0] }),
    tube([[0, 0.02, 0.12], [0, 0.02, 0.24]], 0.76, 0.68, n, 'leatherDark', { up: [0, 1, 0] }),
    paint([disc([0.28, 0.64, 0.6], [0.3, 1, 0], 0.18, 0.2, 4, 'mark', { spin: 0.3 }), disc([0, 0.72, 0.18], [0, 1, 0], 0.1, 0.08, 4, 'crystal')]),
  );
  const H = GOBLIN_HEAD;
  const skull = orb(H.c, H.r, n + 1, k + 1, 'coat');
  // Malice: the eyes big and yellow under lids that slope down to a long nose, and a grin laid right round the face with three
  // teeth in it. The eyes far enough round that one is whole inside the outline seen side on.
  const eyeDir: V3 = [0.66, 0.74, 0.12];
  const { lids, brows } = glower(H.c, H.r, eyeDir, 0.3, { tall: 0.95, drop: 0.42, slope: 0.32, brow: 0.08 });
  const face = merge(
    orbAlong(add(H.c, [0, 1.0, -0.1]), [0, 1, -0.35], [0.17, 0.3, 0.3], n, k, 'coat'),
    grin(H.c, H.r, [[-0.55, 0.8, -0.28], [-0.3, 0.9, -0.5], [0, 0.9, -0.58], [0.3, 0.9, -0.5], [0.55, 0.8, -0.28]], 0.045, [[0.3, 0.15], [0.55, 0.17], [0.74, 0.14]]),
  );
  const look = (shut: boolean): Mesh => merge(eyes(H.c, H.r, eyeDir, 0.3, { tall: 0.95, shut, iris: 'bloom', pupil: 0.32, rim: 0 }), lids);
  // Ears: long and pointed, swept out and back from the sides of the head and a little up, pink inside, so that they show their
  // length seen side on and make a V seen from in front. Each is thick at the root and its flat rolled toward the sky, so the far
  // one, seen past the head from in front and to the side, is a pointed ear and not a leaf seen edge on as a stick.
  const earThick = [0.16, 0.15, 0.12, 0.07, 0.01];
  const ear = (s: number): Mesh => {
    const root = add(H.c, [s * 0.72, -0.05, 0.25]), mid = add(H.c, [s * 1.12, -0.5, 0.42]), tip = add(H.c, [s * 1.58, -1.22, 0.62]);
    const along = unit(sub(tip, root)), up: V3 = [s * 0.45, 0.35, 0.82];
    const face = unit(sub(up, scale(along, along[0] * up[0] + along[1] * up[1] + along[2] * up[2])));
    // The pink laid on the flat two fifths of the way out, where the ear is between its second ring and its third.
    const lift = earThick[1] + (earThick[2] - earThick[1]) * 0.6 + 0.01;
    return merge(
      tube(curve(root, mid, tip, 4), [0.34, 0.33, 0.25, 0.12, 0.01], earThick, n, 'coat', { up }),
      paint([disc(add(bend(root, mid, tip, 0.4), scale(face, lift)), face, 0.34, 0.15, 6, 'inner', { up: cross(face, along) })]),
    );
  };
  // The blade: short, broad and notched, in dark iron with its edge ground bright; a bar for a guard, a grip bound in rag. Its
  // back is straight, and the notches are bitten out of its edge.
  const back = -0.2;
  const sword = merge(
    blade(GOBLIN_EDGE.map(([y, e]) => [0, y, (e + back) / 2] as V3), GOBLIN_EDGE.map(([, e]) => (e - back) / 2), [1, 0, 0], { mat: 'stone', rib: 'stoneDark', fold: 0.04, thick: 0.06 }),
    blade(GOBLIN_EDGE.slice(0, -1).map(([y, e]) => [0, y, e - 0.035] as V3), GOBLIN_EDGE.slice(0, -1).map(() => 0.035), [1, 0, 0], { mat: 'spot', fold: 0, thick: 0.075 }),
    tube([[0, 0.03, -0.26], [0, 0.03, 0.3]], 0.055, 0.055, 5, 'bark'),
    tube([[0, 0.02, 0], [0, -0.28, 0]], 0.06, 0.06, 5, 'leatherDark'),
  );
  // Held tipped out, away from its own face.
  const grip = moved(sword, [0, 0.1, -0.12], -28, -30, 0);
  const hide = [{ c: H.c, r: H.r }];
  return [
    { key: 'hips', mesh: orb([0, 0, 0], [0.6, 0.52, 0.48], n, k, 'leatherDark'), bone: 'body', bias: 0 },
    { key: 'body', mesh: jerkin, bone: 'chest', bias: 0.005, breathes: { c: [0, 0, 0.4], k: 0.04 } },
    { key: 'head', mesh: merge(skull, face, look(false)), shut: merge(skull, face, look(true)), bone: 'head', bias: 0.2 },
    { key: 'brows', mesh: brows, bone: 'head', bias: 0.21, after: 'head', hide },
    // Each ear a piece of its own, over the head and hidden where it goes round behind it: laid back along the head as they are,
    // the head would otherwise cover the near one from one side and the far one would show through it from the other.
    { key: 'ear0', mesh: ear(-1), bone: 'head', bias: 0.21, after: 'head', hide },
    { key: 'ear1', mesh: ear(1), bone: 'head', bias: 0.21, after: 'head', hide },
    { key: 'sword', mesh: grip, bone: 'hand1', bias: 0.05, after: ['hand1', 'body'], front: [1, 0.4, 0] },
    ...limbs({ n, arm: [0.5, 0.5], armW: [0.16, 0.14], hand: hand(0.18, 4, 0.22, n), leg: [0.46, 0.46], legW: [0.2, 0.17], foot: pawFoot(0.19, 0.5, n) }),
  ];
}

export const GOBLIN: Kind = {
  bones: (a) => bipedBones(GOBLIN_SPEC, a, (p: BipedPose) => {
    // The blade held out ahead of it at the belly, point forward and out, going or standing: low enough that seen side on it is
    // under the face rather than across it however far the head turns, and seen from in front and to the side, out past the grin.
    p.arms[1] = [p.arms[1][0] * 0.4 + 14, p.arms[1][1] + 33, p.arms[1][2] + 10];
    if (a.go > 0) return;
    const t = a.t;
    // Shifty: a quick look to one side, held a moment and snapped back, then one to the other -- never so far round that its face
    // is gone, and between them facing ahead, so that seen side on its face is there most of the time -- a crouch, and the flat
    // of the blade slapped into the other palm.
    const glance = (at: number[]): number => Math.min(1, 2 * beat(t, at, 2.4));
    const shift = glance([0.6, 9.4, 16.8]) - glance([5.4, 13.6, 21.2]) + 0.15 * drift(t, 1.3);
    p.head[1] = 14 * shift;
    p.neck[1] = 4 * shift;
    const slap = beat(t, [4.4, 12.8, 20.1], 0.7);
    p.arms[0] = [p.arms[0][0] + 40 * slap, p.arms[0][1] - 10 * slap, p.arms[0][2] + 50 * slap];
    p.arms[1] = [p.arms[1][0] + 10 * slap, p.arms[1][1] - 12 * slap, p.arms[1][2] + 10 * slap];
    p.legs = p.legs.map((l) => [l[0] + 6 * (0.5 + 0.5 * cyc(t, 3)), l[1] + 0.12 * (0.5 + 0.5 * cyc(t, 3)), l[2]] as [number, number, number]);
  }),
  build: goblinBuild,
  palette: (coat, mark) => {
    // The green-grey skin taken halfway to a pale lime: the variants' own green-grey is nearly the colour of the grass it stands on,
    // and this stands off it by being lighter and yellower.
    const skin = mix(pastel(coat, 90), [214, 226, 160], 0.5);
    return coatPalette(coat, mark, {
      coat: skin, coatLight: lighter(skin, 0.2),
      leather: [176, 128, 96], leatherDark: [140, 98, 76], mark: mix(pastel(mark), [196, 150, 110], 0.5), bloom: [250, 220, 90], lid: darker(pastel(coat), 0.3),
      coatDark: darker(pastel(coat), 0.45), stone: [150, 158, 172], stoneDark: [122, 130, 146], spot: [236, 242, 250], bark: [150, 110, 84], crystal: [226, 200, 120],
      nose: [70, 50, 60], tooth: [250, 246, 226],
    }, 90);
  },
  shadow: [1.1, 1.0],
  stride: 1.7,
  size: 2.0,
  blinks: 3,
};

/* ---- the orc ----------------------------------------------------------------------- */

/**
 * An orc: a head taller than you, grey, broad as a door at the shoulder and
 * narrow at the hip, tusked, with a knot of black hair, an iron plate on one
 * shoulder and an iron axe it has taken the trouble to sharpen.
 */
const ORC_SPEC: BipedSpec = {
  high: 1.5,
  leg: { at: [0.46, 0, -0.1], len: [0.7, 0.7, 0.12], rest: [8, -16] },
  chest: { at: [0, 0, 0.25], lean: 14 },
  neck: { at: [0, 0.25, 1.75], len: 0.25, lean: 10 },
  head: { pitch: -6 },
  arm: { at: [1.25, 0.1, 1.45], len: [0.85, 0.8], rest: [8, 18, 22] },
  swing: [26, 40],
  waddle: 5,
  armSwing: 18,
};

const ORC_HEAD = { c: [0, 0.18, 0.5] as V3, r: [0.78, 0.76, 0.74] as V3 };

function orcBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 11), k = cut(lod, 5, 6);
  // A chest wider than it is anything else, going up into the shoulders, and deep enough to be a barrel seen side on.
  const chest = tube([[0, 0, -0.3], [0, 0.05, 0.3], [0, 0.14, 0.95], [0, 0.12, 1.5], [0, 0, 1.82]], [0.72, 0.95, 1.3, 1.45, 0.6], [0.7, 0.85, 0.98, 0.95, 0.5], n,
    (ring, j) => (ring > 0 && ring < 4 && Math.abs(((j + 1) / n) * TAU - Math.PI * 0.5) < 0.9 ? 'mark' : 'coat'), { up: [0, 1, 0] });
  const belt = merge(tube([[0, 0.02, -0.1], [0, 0.02, 0.08]], 0.8, 0.76, n, 'leatherDark', { up: [0, 1, 0] }), paint([disc([0, 0.78, 0], [0, 1, 0], 0.16, 0.13, 6, 'stone')]));
  const kilt = tube([[0, 0, 0.0], [0, 0.04, -0.55]], [0.82, 0.92], [0.7, 0.8], n, 'leather', { up: [0, 1, 0] });
  // The shoulder plate: a curved iron shell over the left shoulder.
  const plate = merge(
    orbAlong([-1.25, 0.1, 1.6], [-0.6, 0, 1], [0.55, 0.58, 0.28], n, 4, 'stone'),
    orbAlong([-1.25, 0.1, 1.56], [-0.6, 0, 1], [0.42, 0.46, 0.26], n, 3, 'stoneDark'),
  );
  const H = ORC_HEAD;
  const skull = orb(H.c, H.r, n + 1, k + 1, 'coat');
  // Small eyes glowering under their lids and heavy brows, a flat broad nose, and a jaw jutting out in front in a darker skin with
  // the tusks up out of its corners.
  const eyeDir: V3 = [0.66, 0.8, 0.2];
  const { lids, brows } = glower(H.c, H.r, eyeDir, 0.2, { tall: 0.9, drop: 0.45, slope: 0.35, brow: 0.09 });
  const face = merge(
    orbAlong(add(H.c, [0, 0.58, -0.42]), [0, 1, -0.25], [0.62, 0.44, 0.3], n, k, 'coatDark'),
    ...[1, -1].map((s) => taper(curve(add(H.c, [s * 0.3, 0.92, -0.5]), add(H.c, [s * 0.4, 1.02, -0.34]), add(H.c, [s * 0.44, 0.98, -0.16]), 2), 0.09, 0.03, 5, 'tooth')),
    orbAlong(add(H.c, [0, 0.8, 0.02]), [0, 1, 0.2], [0.2, 0.12, 0.13], 5, 3, 'coatDark'),
  );
  const look = (shut: boolean): Mesh => merge(eyes(H.c, H.r, eyeDir, 0.2, { tall: 0.9, shut, iris: 'bloom', pupil: 0.36, rim: 0 }), lids);
  // Ears pointed and laid back, turned out so that they show their length seen side on.
  const ear = (s: number): Mesh => tube(curve(add(H.c, [s * 0.66, 0, 0.1]), add(H.c, [s * 0.95, -0.35, 0.3]), add(H.c, [s * 1.08, -0.72, 0.52]), 3), [0.2, 0.18, 0.11, 0.01], 0.06, n, 'coat', { up: [s * 0.7, 0.7, 0.3] });
  // A knot of black hair on the crown, tied with a ring.
  const knot = merge(orb(add(H.c, [0, -0.25, 0.78]), [0.26, 0.26, 0.3], n, 4, 'hair'), tube([add(H.c, [0, -0.3, 0.98]), add(H.c, [0, -0.36, 1.08])], 0.14, 0.14, 6, 'crystal'), orbAlong(add(H.c, [0, -0.48, 1.22]), [0, -0.5, 1], [0.16, 0.16, 0.28], 5, 3, 'hair'));
  // The axe: a long haft, a crescent of dark iron with its edge ground bright.
  const axe = merge(
    tube([[0, 0, -0.5], [0, 0, 1.75]], 0.07, 0.07, 5, 'bark'),
    blade(curve([0, 0, 1.3], [0, 0.5, 1.45], [0, 0.82, 1.2], 3), [0.14, 0.46, 0.58, 0.5], [1, 0, 0], { mat: 'stone', rib: 'stoneDark', fold: 0.04, thick: 0.09 }),
    blade(curve([0, 0.74, 0.7], [0, 1.0, 1.22], [0, 0.76, 1.74], 3), [0.05, 0.07, 0.07, 0.04], [1, 0, 0], { mat: 'spot', thick: 0.1 }),
  );
  const held = moved(axe, [0, 0.1, -0.1], 0, -75, 0);
  const hide = [{ c: H.c, r: H.r }];
  return [
    { key: 'hips', mesh: orb([0, 0, 0], [0.8, 0.62, 0.55], n, k, 'leather'), bone: 'body', bias: 0 },
    // The kilt a piece of its own, over the tops of both thighs from every side, so that the near one never comes out over it.
    { key: 'kilt', mesh: kilt, bone: 'body', bias: 0.02, after: ['ll0', 'lr0', 'hips'] },
    { key: 'body', mesh: merge(chest, belt), bone: 'chest', bias: 0.005, breathes: { c: [0, 0, 0.8], k: 0.05 } },
    { key: 'plate', mesh: plate, bone: 'chest', bias: 0.06, after: ['body', 'arm0'] },
    { key: 'head', mesh: merge(skull, face, look(false)), shut: merge(skull, face, look(true)), bone: 'head', bias: 0.2 },
    { key: 'brows', mesh: brows, bone: 'head', bias: 0.21, after: 'head', hide },
    { key: 'ear0', mesh: ear(-1), bone: 'head', bias: 0.21, after: 'head', hide },
    { key: 'ear1', mesh: ear(1), bone: 'head', bias: 0.21, after: 'head', hide },
    { key: 'knot', mesh: knot, bone: 'head', bias: 0.19, hide },
    { key: 'axe', mesh: held, bone: 'hand1', bias: 0.05, after: ['hand1'], front: [1, 0.4, 0] },
    ...limbs({ n, arm: [0.85, 0.8], armW: [0.34, 0.3], hand: hand(0.3, 4, 0.3, n), leg: [0.7, 0.7], legW: [0.36, 0.3], foot: pawFoot(0.3, 0.7, n, 'leatherDark'), legMat: 'coat' }),
  ];
}

export const ORC: Kind = {
  bones: (a) => bipedBones(ORC_SPEC, a, (p: BipedPose) => {
    // The axe carried low in the right fist; at a run, up and ready.
    p.arms[1] = [p.arms[1][0] * 0.5 + 12 + 50 * a.gait * a.go, p.arms[1][1] + 6, p.arms[1][2] + 20 + 40 * a.gait * a.go];
    if (a.go > 0) return;
    const t = a.t;
    // Heavy breaths, the shoulders rolling; a slow look round to one side and then the other; and every ten seconds or so the axe
    // hefted up in the fist and let down again.
    const heave = cyc(t, 5);
    p.chest[0] += 3 * heave;
    p.arms[0][1] += 3 * heave;
    // Its eyes are small and near the front of its head, so it looks about less far than most, and the look round takes over from
    // the wandering look while it lasts rather than adding to it: turned away seen side on, its face is still there.
    const round = beat(t, [2.5, 14.2], 3.4) - beat(t, [8.4, 19.8], 3.0);
    const held = Math.abs(round);
    p.head[1] = 0.6 * p.head[1] * (1 - held) + 14 * round;
    p.neck[1] = 0.6 * p.neck[1] * (1 - held) + 4 * round;
    const heft = beat(t, [5.2, 16.4], 1.5);
    p.arms[1] = [p.arms[1][0] + 25 * heft, p.arms[1][1], p.arms[1][2] + 20 * heft];
  }),
  build: orcBuild,
  palette: (coat, mark) => {
    // Grey gone to slate: the variants' greys tinted blue rather than green, and lighter, since the green-grey they were is the
    // colour of the grass it stands on.
    const hide = mix(lighter(pastel(coat, 214), 0.15), [160, 178, 214], 0.2);
    return coatPalette(coat, mark, {
      coat: hide, coatLight: lighter(hide, 0.2), coatDark: darker(hide, 0.3), lid: darker(hide, 0.36),
      leather: [150, 112, 92], leatherDark: [110, 82, 70], hair: [62, 56, 64], stone: [150, 158, 172], stoneDark: [112, 120, 138], spot: [236, 242, 250],
      bark: [132, 98, 76], crystal: [214, 180, 110], tooth: [246, 238, 214], bloom: [240, 160, 70],
    }, 214);
  },
  shadow: [1.6, 1.3],
  stride: 1.5,
  size: 4.1,
  blinks: 5,
};

/* ---- the ogre ---------------------------------------------------------------------- */

/**
 * An ogre: a hill of shoulder on short legs, a small head sunk in it with
 * small eyes and a great underbite, and a whole young tree in one fist --
 * roots at the grip end and still in leaf at the other -- carried on the
 * shoulder.
 */
const OGRE_SPEC: BipedSpec = {
  high: 1.4,
  leg: { at: [0.62, 0, -0.1], len: [0.62, 0.62, 0.14], rest: [8, -14] },
  chest: { at: [0, 0, 0.3], lean: 18 },
  neck: { at: [0, 0.55, 1.95], len: 0.2, lean: 30 },
  head: { pitch: -4 },
  arm: { at: [1.62, 0.2, 1.75], len: [1.0, 0.95], rest: [6, 20, 18] },
  swing: [22, 32],
  waddle: 8,
  armSwing: 14,
};

const OGRE_HEAD = { c: [0, 0.2, 0.3] as V3, r: [0.62, 0.6, 0.58] as V3 };

/** The right arm as it holds the tree on the shoulder, standing or going alike: forward, out and the elbow (degrees). */
const OGRE_HOLD: [number, number, number] = [73, -5, 78];

/** The tree in the chest's frame: the point on its trunk the fist is round, and how far it leans back over the shoulder. */
const OGRE_TREE = { at: [1.44, 1.03, 2.35] as V3, pitch: 58 };

/**
 * The right fist, closed round the trunk of the tree, in the hand's own
 * frame: a knuckled lump where the hand is, and four fingers curled round
 * the far side of the trunk, so that seen from anywhere it is a fist on the
 * trunk and not a hand beside it. With the balls down the trunk that hide
 * what of it is behind the trunk.
 */
function ogreFist(n: number, k: number): { mesh: Mesh; hide: Array<{ c: V3; r: V3 }>; front: V3 } {
  const S = OGRE_SPEC.arm;
  const arm = joint(ROOT, S.at, S.rest[0] + OGRE_HOLD[0], -(S.rest[1] + OGRE_HOLD[1]));
  const wrist = joint(joint(arm, [0, 0, -S.len[0]], S.rest[2] + OGRE_HOLD[2]), [0, 0, -S.len[1]]);
  // A point or a way in the chest's frame, in the hand's.
  const m = wrist.m;
  const turn = (d: V3): V3 => [m[0] * d[0] + m[3] * d[1] + m[6] * d[2], m[1] * d[0] + m[4] * d[1] + m[7] * d[2], m[2] * d[0] + m[5] * d[1] + m[8] * d[2]];
  const local = (p: V3): V3 => turn(sub(p, wrist.t));
  // The trunk's line, from the roots toward the crown, and where along it the hand is.
  const P = OGRE_TREE.pitch * (Math.PI / 180);
  const up: V3 = [0, -Math.sin(P), Math.cos(P)];
  const on = add(OGRE_TREE.at, scale(up, dot(sub(wrist.t, OGRE_TREE.at), up)));
  const out = unit(sub(wrist.t, on)), round = cross(up, out);
  const R = 0.21, fr = 0.12;
  const ring = (along: number, deg: number, r: number): V3 => {
    const a = deg * (Math.PI / 180);
    return add(add(on, scale(up, along)), add(scale(out, Math.cos(a) * r), scale(round, Math.sin(a) * r)));
  };
  const fist = merge(
    orbAlong(ring(0, 0, R + 0.16), up, [0.36, 0.3, 0.44], n, k, 'coat'),
    ...[-0.25, -0.08, 0.09, 0.26].map((along) => tube([0, 60, 125, 190, 250].map((deg) => ring(along, deg, R + fr * 0.75)), [fr, fr, fr * 0.95, fr * 0.9, fr * 0.8], [fr, fr, fr * 0.95, fr * 0.9, fr * 0.8], 5, 'coat')),
  );
  return {
    mesh: mesh(fist.v.map(local), fist.f),
    hide: [-0.5, -0.33, -0.17, 0, 0.17, 0.33, 0.5].map((along) => ({ c: local(add(on, scale(up, along))), r: [R, R, R] as V3 })),
    // Over the body while the fist's side of it is toward the viewer: from in front and to the right.
    front: turn(unit([0.6, 1, 0])),
  };
}

function ogreBuild(lod: number): Piece[] {
  const n = cut(lod, 9, 12), k = cut(lod, 5, 7);
  // The hill: a belly swelling up into a hump of shoulder, as one mass rather than two balls, so that it shades in one sweep from
  // lit shoulder to shadowed belly and not in bands.
  const hill: Array<[number, number, number, number]> = [
    // Height, half its width, half its depth, and how far forward its middle is.
    [-0.5, 0.7, 0.6, 0.12], [-0.25, 1.12, 0.98, 0.14], [0.1, 1.38, 1.2, 0.16], [0.5, 1.46, 1.25, 0.16], [0.9, 1.5, 1.2, 0.12],
    [1.25, 1.62, 1.12, 0.02], [1.55, 1.7, 1.1, -0.08], [1.85, 1.6, 1.0, -0.12], [2.1, 1.3, 0.8, -0.12], [2.26, 0.8, 0.5, -0.12], [2.33, 0.12, 0.08, -0.12],
  ];
  const bulk = merge(
    tube(hill.map(([z, , , y]) => [0, y, z] as V3), hill.map(([, w]) => w), hill.map(([, , h]) => h), n + 6, 'coat', { up: [0, 1, 0] }),
    orbAlong([0, 0.72, 0.55], [0, 1, -0.2], [1.0, 0.6, 0.9], n, k, 'mark'),
  );
  const cloth = tube([[0, 0, 0.1], [0, 0.05, -0.55]], [1.05, 1.15], [0.95, 1.0], n, 'leather', { up: [0, 1, 0] });
  const H = OGRE_HEAD;
  const skull = orb(H.c, H.r, n, k, 'coat');
  // Small dim eyes glowering under a heavy brow, a lump of a nose, and a great underbite in a darker skin jutting out past it, with
  // two tusks up out of it past the upper lip.
  const eyeDir: V3 = [0.45, 0.84, 0.26];
  const { lids, brows } = glower(H.c, H.r, eyeDir, 0.14, { tall: 1.0, drop: 0.4, slope: 0.35, brow: 0.09 });
  const face = merge(
    orbAlong(add(H.c, [0, 0.5, -0.38]), [0, 1, -0.25], [0.6, 0.44, 0.36], n, k, 'coatDark'),
    ...[1, -1].map((s) => taper([add(H.c, [s * 0.3, 0.8, -0.32]), add(H.c, [s * 0.34, 0.88, -0.1]), add(H.c, [s * 0.36, 0.9, 0.12])], 0.12, 0.04, 5, 'tooth')),
    orbAlong(add(H.c, [0, 0.62, 0.08]), [0, 1, 0], [0.16, 0.12, 0.14], 5, 3, 'coatDark'),
  );
  const look = (shut: boolean): Mesh => merge(eyes(H.c, H.r, eyeDir, 0.14, { tall: 1.0, shut, pupil: 0, rim: 0 }), lids);
  // The tree: a trunk, a short spread of roots just below the fist, a leafy crown at the other end.
  const tree = merge(
    taper([[0, 0, -0.62], [0, 0, 3.2]], 0.22, 0.14, 7, 'bark'),
    ...[0, 1, 2, 3].map((q) => taper(curve([0, 0, -0.5], [Math.cos(q * 1.6) * 0.24, Math.sin(q * 1.6) * 0.24, -0.72], [Math.cos(q * 1.6) * 0.38, Math.sin(q * 1.6) * 0.38, -0.96], 2), 0.1, 0.03, 4, 'bark')),
    ...[[0, 0, 3.5, 0.8], [0.62, 0.12, 3.1, 0.62], [-0.6, -0.12, 3.15, 0.6], [0.12, 0.66, 3.2, 0.58], [-0.14, -0.66, 3.2, 0.58], [0.34, -0.3, 3.85, 0.55], [-0.3, 0.34, 3.8, 0.55]]
      .map(([x, y, z, r]) => orb([x, y, z], [r, r, r * 0.86], n - 2, k - 1, (z as number) > 3.3 ? 'leaf' : 'leafDark')),
    ...[[0.2, 0, 2.2], [-0.2, 0.1, 2.5]].map(([x, y, z]) => taper([[0, 0, z - 0.3], [x * 3, y * 3, z + 0.25]], 0.06, 0.02, 4, 'bark')),
  );
  // Carried on the right shoulder: gripped in the fist just above the roots, the crown out behind over the shoulder.
  const carried = moved(tree, OGRE_TREE.at, 0, OGRE_TREE.pitch, 0);
  const fist = ogreFist(n, k);
  return [
    { key: 'hips', mesh: orb([0, 0, 0], [1.05, 0.85, 0.7], n, k, 'leather'), bone: 'body', bias: 0 },
    // The loincloth a piece of its own, over the tops of both thighs from every side, so that the near one never comes out over it.
    { key: 'cloth', mesh: cloth, bone: 'body', bias: 0.02, after: ['ll0', 'lr0', 'hips'] },
    { key: 'body', mesh: bulk, bone: 'chest', bias: 0.005, breathes: { c: [0, 0, 0.9], k: 0.06 } },
    { key: 'head', mesh: merge(skull, face, look(false)), shut: merge(skull, face, look(true)), bone: 'head', bias: 0.2 },
    { key: 'brows', mesh: brows, bone: 'head', bias: 0.21, after: 'head', hide: [{ c: H.c, r: H.r }] },
    { key: 'tree', mesh: carried, bone: 'chest', bias: 0.05, after: ['body', 'arm1'], front: [1, 0, 0] },
    // The right hand is the fist round the trunk, drawn over the tree (and over the body from in front), with what of it is round
    // the far side of the trunk hidden by it.
    ...limbs({ n, arm: [1.0, 0.95], armW: [0.52, 0.46], hand: hand(0.46, 4, 0.36, n), leg: [0.62, 0.62], legW: [0.5, 0.44], foot: pawFoot(0.44, 0.9, n) })
      .map((pc): Piece => (pc.key === 'hand1' ? { ...pc, mesh: fist.mesh, bias: 0.06, after: ['body', 'tree'], front: fist.front, hide: fist.hide } : pc)),
  ];
}

export const OGRE: Kind = {
  bones: (a) => bipedBones(OGRE_SPEC, a, (p: BipedPose) => {
    // The tree on the shoulder: the right arm up and bent back so the trunk lies over it, held there going or standing, so the fist
    // stays closed round the trunk.
    p.arms[1] = [...OGRE_HOLD];
    if (a.go > 0) return;
    const t = a.t;
    // Slow and heavy: a great breath, the weight rolled from foot to foot, a scratch at the head now and then.
    p.chest[0] += 6 * cyc(t, 4);
    p.roll += 4 * cyc(t, 4, 1);
    const scratch = beat(t, [9.2], 2.0);
    p.arms[0] = [p.arms[0][0] + 130 * scratch, p.arms[0][1] + 10 * scratch, p.arms[0][2] + 100 * scratch + 15 * scratch * Math.sin(t * TAU * 3)];
    p.head[2] += 10 * scratch;
  }),
  build: ogreBuild,
  palette: (coat, mark) => {
    // A hide of lilac stone, three quarters of the way from the variant's beige: in the beige itself it was a big bald man.
    const c = mix(pastel(coat, 30), [196, 176, 206], 0.75);
    return coatPalette(coat, mark, {
      coat: c, coatDark: darker(c, 0.28), coatLight: lighter(c, 0.2), lid: darker(c, 0.45), belly: mix(c, pastel(mark, 30), 0.72),
      leather: [150, 120, 96], bark: [120, 88, 66], leaf: [150, 200, 110], leafDark: [110, 164, 92], tooth: [246, 238, 214],
    }, 30);
  },
  shadow: [2.1, 1.7],
  stride: 1.3,
  size: 6.0,
  blinks: 6,
};
