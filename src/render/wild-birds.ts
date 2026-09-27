import {
  add, beat, birdBones, blush, clamp, coatPalette, cross, curve, cyc, darker, DEG, disc, dot, eyes, frac, lerp, lighter, LOOP, merge, mirrored, moved, onEgg, orb,
  orbAlong, paint, pastel, scale, taper, TAU, tube, unit, type Anim, type BirdSpec, type Bones, type Disc, type Kind, type Piece,
} from './beasts';
import { joint, onScreen, place, type Mat, type Mesh, type RGB, type V3, type View } from './figure';
import { birdLegPieces, blade, cut, under } from './beastkit';

/** The birds that stand tall or heavy: the sedra, the warda and the quill. */

/** A folded wing: a long feather-shaped flap down the flank, `len` long. */
function foldedWing(len: number, w: number, n: number, o: { mat?: 'feather' | 'coat' } = {}): Mesh {
  const pts: V3[] = [[0, 0.1, 0.05], [0, -len * 0.2, 0.02], [0, -len * 0.5, -0.06], [0, -len * 0.8, -0.12], [0, -len, -0.14]];
  return tube(pts, [w * 0.7, w, w * 0.9, w * 0.6, 0.04], 0.08, n, (ring) => (ring === 0 ? 'coat' : o.mat ?? 'feather'), { up: [1, 0, 0] });
}

/**
 * A patch of colour painted on an egg -- a pale chest, a bib -- as one flat
 * shape whose rim lies on the shell all the way round, so that it follows the
 * curve from every side rather than standing off it as a flat disc does, and
 * never shows past the edge of the egg it is on. `dir` is the way out to its
 * middle; `across` and `up` are how far round the egg it reaches either way,
 * in radians.
 */
export function patch(c: V3, r: V3, dir: V3, across: number, up: number, m: Mat, o: { sides?: number; lift?: number } = {}): Mesh {
  const d = unit(dir);
  let u = cross([0, 0, 1], d);
  if (Math.hypot(u[0], u[1], u[2]) < 1e-4) u = [1, 0, 0];
  u = unit(u);
  const w = cross(d, u);
  const v: V3[] = [];
  const sides = o.sides ?? 14;
  for (let j = 0; j < sides; j++) {
    const t = ((j + 0.5) / sides) * TAU;
    const at = onEgg(c, r, add(d, add(scale(u, Math.tan(across) * Math.cos(t)), scale(w, Math.tan(up) * Math.sin(t)))));
    v.push(add(at.p, scale(at.n, o.lift ?? 0.02)));
  }
  return paint([{ v, m } as Disc]);
}

/* ---- the sedra --------------------------------------------------------------------- */

/**
 * A sedra: a long-necked wader that stands in the shallows all day on one
 * leg. Its bill is a pair of shears -- two long steel blades on a brass
 * rivet -- and it cuts reeds with it; reed plumes sweep back from its head,
 * and its tail is three long leaves.
 */
const SEDRA_SPEC: BirdSpec = {
  high: 3.05,
  leg: { at: [0.3, 0.05, -0.45], len: [0.3, 2.1, 0.08], rest: [18, -36] },
  neck: { at: [0, 0.75, 0.35], len: 1.45, lean: 12 },
  head: { pitch: -6 },
  wing: { at: [0.62, 0.35, 0.28] },
  tail: { at: [0, -1.05, 0.05], lift: -12 },
  swing: [22, 34],
  thrust: 14,
  // Foraging, the body tipped well over and the long neck bowed right down in front of its feet, so that the open shears reach the
  // water with the face still to be seen; its knees a little bent, and the legs swung forward by as much as the bend would slant them
  // back, so they still stand straight up under it.
  peck: 105,
  tip: 46,
  nose: 12,
  crouch: 0.8,
  stance: 1.52,
};

const SEDRA_HEAD = { c: [0, 0.12, 0.22] as V3, r: [0.6, 0.72, 0.56] as V3 };
/** Where the two blades of the shears are riveted together, in the head's frame, just in front of the face: what the lower one turns on. */
const SEDRA_RIVET: V3 = [0, 1.0, 0.07];

function sedraBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 11), k = cut(lod, 5, 7);
  const ys = [-1.1, -0.85, -0.35, 0.25, 0.7, 0.95];
  const body = tube(ys.map((y, q) => [0, y, [0.0, 0.04, 0.08, 0.14, 0.26, 0.36][q]] as V3), [0.2, 0.58, 0.72, 0.7, 0.52, 0.2], [0.2, 0.54, 0.66, 0.62, 0.46, 0.2], n,
    (ring, j) => (ring > 0 && under(n, j, 1.2) ? 'mark' : 'coat'));
  // The neck in an S, as a wader carries it, pale down the front.
  const neck = tube([[0, 0, -0.2], [0, -0.12, 0.45], [0, 0.14, 1.0], [0, 0.04, 1.45]], [0.34, 0.26, 0.24, 0.26], [0.34, 0.26, 0.24, 0.26], n,
    (ring, j) => (under(n, (j + n / 4) % n, 1.0) ? 'mark' : 'coat'), { seam: 'both' });
  const H = SEDRA_HEAD;
  const skull = orb(H.c, H.r, n + 1, k, 'coat');
  const look = (shut: boolean): Mesh => eyes(H.c, H.r, [0.85, 0.42, 0.3], 0.24, { tall: 1.12, shut, rim: 0.16 });
  // The shears: two pointed steel blades, flat side on, the upper on the head and the lower on the jaw, a little to either side of the
  // middle so they pass one another as the blades of shears do, and riveted together in front of the face with a brass rivet either side.
  const R = SEDRA_RIVET;
  const upper = merge(
    tube([[0.03, 0.6, 0.17], [0.03, 0.86, 0.16], [0.03, 1.25, 0.13], [0.03, 1.65, 0.1], [0.03, 2.02, 0.06]], [0.13, 0.12, 0.09, 0.055, 0.005], [0.05, 0.05, 0.042, 0.034, 0.01], n, 'bill', { up: [1, 0, 0] }),
    paint([1, -1].map((s) => disc([s * 0.1, R[1], R[2]], [s, 0, 0], 0.18, 0.18, 8, 'crystal', { lit: true }))),
  );
  const lower = moved(tube([[-0.03, 0.6, -0.01], [-0.03, 0.86, -0.01], [-0.03, 1.25, -0.01], [-0.03, 1.6, 0.0], [-0.03, 1.93, 0.02]], [0.1, 0.095, 0.075, 0.045, 0.005], [0.045, 0.045, 0.04, 0.03, 0.01], n, 'billDark', { up: [1, 0, 0] }),
    [-R[0], -R[1], -R[2]]);
  // Reed plumes: three reeds swept back from the back of the head and fanned one behind another, each with a brown cattail at its tip.
  const reeds = merge(...([[-0.1, 0.3, -0.8], [0.02, 0.5, -1.15], [0.12, 0.25, -1.5]] as V3[]).map(([x, up, back]) => {
    const tip: V3 = [x * 2.2, back, 0.7 + up];
    return merge(
      tube(curve([x, -0.2, 0.5], [x * 1.3, back * 0.5, 0.95 + up], tip, 3), 0.05, 0.05, 4, 'stem'),
      orbAlong(add(tip, [x * 0.2, -0.16, -0.04]), [x * 0.3, -1, -0.2], [0.1, 0.1, 0.26], 5, 3, 'bark'),
    );
  }));
  // The tail: three long leaves fanned back and down, each folded down a dark rib.
  const tail = merge(...[-0.35, 0, 0.35].map((sp) => blade(curve([0, 0, 0], [sp * 0.35, -0.55, -0.02], [sp * 0.8, -1.05, -0.18], 4), [0.05, 0.18, 0.2, 0.14, 0.02], [0, 0.2, 1], { twist: 0.2 * Math.sign(sp || 1), mat: 'leaf', rib: 'leafDark' })));
  const hide = [{ c: H.c, r: H.r }];
  return [
    { key: 'body', mesh: body, bone: 'body', bias: 0, breathes: { c: [0, 0, 0.1], k: 0.05 } },
    { key: 'tail', mesh: tail, bone: 'tail0', bias: -0.05 },
    { key: 'neck', mesh: neck, bone: 'neck', bias: 0, under: 'head' },
    { key: 'head', mesh: merge(skull, look(false)), shut: merge(skull, look(true)), bone: 'head', bias: 0.2 },
    // What of either blade is up inside the head is hidden by it, so neither lies across the face.
    { key: 'upper', mesh: upper, bone: 'head', bias: 0.21, after: 'head', hide },
    { key: 'lower', mesh: lower, bone: 'jaw', bias: 0.205, after: 'head', hide, hideIn: 'head' },
    { key: 'reeds', mesh: reeds, bone: 'head', bias: 0.19, hide },
    { key: 'wing0', mesh: mirrored(foldedWing(1.7, 0.42, n)), bone: 'wing0', bias: 0.03, after: 'body', front: [-1, 0, 0] },
    { key: 'wing1', mesh: foldedWing(1.7, 0.42, n), bone: 'wing1', bias: 0.03, after: 'body', front: [1, 0, 0] },
    ...birdLegPieces('bl', -1, 2.1, 0.09, 5),
    ...birdLegPieces('br', 1, 2.1, 0.09, 5),
  ];
}

export const SEDRA: Kind = {
  bones: (a) => {
    let jaw = 0;
    const b = birdBones(SEDRA_SPEC, a, (p) => {
      const t = a.t, gz = a.graze;
      // The shears never quite shut: the blades rest twelve degrees apart, their tips a couple of pixels apart at the island's zoom 2, so
      // that they show as the two blades of a pair of shears rather than one bill.
      const rest = 1.2;
      p.jaw = Math.max(p.jaw, rest);
      if (a.go <= 0) {
        // Its looks about are smaller than most birds', so that its face stays turned to whoever is looking at it.
        p.head[1] *= 0.6;
        p.head[2] *= 0.6;
        // On one leg for long stretches, the other drawn up under it, but not while it forages; a snip of the shears now and then, at
        // nothing: opened wide and shut to, by turns.
        const one = beat(t, [1.5, 13.5], 8.5) * (1 - gz);
        p.legs[1] = [p.legs[1][0] + 18 * one, p.legs[1][1] + 1.3 * one, p.legs[1][2] + one];
        p.roll -= 3 * one;
        const snip = Math.sin(t * TAU * 3) * beat(t, [6.2, 19.4], 0.9);
        p.jaw += snip > 0 ? (2.8 - rest) * snip : rest * snip;
        // Foraging, it cuts at what is in front of it: the blades open to eighteen degrees and close to six on every other still, and
        // that is its nibble, the long neck held steady rather than nodding the length of it.
        if (gz > 0) p.jaw = lerp(p.jaw, 1.2 + 0.6 * cyc(t, 72), gz);
      }
      jaw = p.jaw;
    });
    // The lower blade turns on the rivet, as the blade of a pair of shears does, rather than at the back of the head.
    b.jaw = joint(b.head, SEDRA_RIVET, -10 * jaw);
    return b;
  },
  build: sedraBuild,
  palette: (coat, mark) => coatPalette(coat, mark, {
    bill: [206, 212, 222], billDark: [170, 178, 192], crystal: [246, 196, 70], stem: [168, 204, 116], bark: [166, 112, 80],
    leaf: [170, 214, 120], leafDark: [120, 170, 92], claw: [236, 170, 150], feather: darker(pastel(coat), 0.08),
  }, 150),
  shadow: [1.4, 0.8],
  stride: 1.0,
  size: 2.1,
  blinks: 5,
};

/* ---- the warda --------------------------------------------------------------------- */

/**
 * A warda: a tall, still watcher on long legs that picks the highest ground
 * it can find. Its eyes are lanterns -- great amber lights in a pale face --
 * and over its head it carries a little lamp of its own on a curled plume,
 * which swings as it turns to look.
 */
const WARDA_SPEC: BirdSpec = {
  high: 2.3,
  leg: { at: [0.36, -0.05, -0.5], len: [0.7, 1.0, 0.1], rest: [14, -30] },
  neck: { at: [0, 0.4, 0.7], len: 0.55, lean: 4 },
  head: { pitch: 0 },
  wing: { at: [0.7, 0.2, 0.35] },
  tail: { at: [0, -0.8, -0.2], lift: -30 },
  swing: [24, 38],
  thrust: 4,
  // Foraging, the whole of it tipped far over and crouched right down, so that its beak meets the ground with the face still to be
  // seen; the legs swung forward by as much as the deep bend at the knee would slant them back, so they stay under it as short posts.
  peck: 110,
  tip: 65,
  nose: 18,
  crouch: 1.7,
  stance: 1.7,
};

const WARDA_HEAD = { c: [0, 0.05, 0.42] as V3, r: [0.98, 0.86, 0.86] as V3 };
/** The way out of the head to the right eye, and how big each is. */
const WARDA_EYE = { dir: [0.72, 0.62, 0.2] as V3, size: 0.33 };
/** How far each eye stands proud of the skull on its pale disc. */
const WARDA_PROUD = 0.1;
/** The tip of the crook, in the head's frame, where the lamp hangs from; and how far down the chain and the glass hang from it. */
const WARDA_TIP: V3 = [0, 0.62, 2.5];
const WARDA_CHAIN = 0.3, WARDA_GLASS = 0.28;

function wardaBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 11), k = cut(lod, 5, 7);
  // An upright egg of a body, leaning a little forward, with the pale of its chest painted down the front.
  const bodyR: V3 = [0.98, 0.92, 1.1];
  const body = moved(merge(
    orb([0, 0, 0], bodyR, n + 1, k + 1, 'coat'),
    patch([0, 0, 0], bodyR, [0, 0.87, 0.5], 0.5, 0.62, 'mark', { sides: 16 }),
  ), [0, 0, 0.2], 0, -23.5);
  const neck = tube([[0, 0, -0.3], [0, 0.04, 0.4], [0, 0.02, 0.78]], [0.32, 0.3, 0.3], [0.3, 0.28, 0.28], n, 'coat', { seam: 'both' });
  const H = WARDA_HEAD, E = WARDA_EYE;
  const skull = orb(H.c, H.r, n + 2, k + 1, 'coat');
  // The face: each eye seated on a pale disc standing proud of the skull, the two meeting over the beak, so that the eyes show side on
  // as well as from in front; and the eyes themselves great lanterns with amber in them, painted on the discs.
  const seats = [1, -1].map((s) => onEgg(H.c, H.r, [E.dir[0] * s, E.dir[1], E.dir[2]]));
  const discs = merge(...seats.map(({ p, n: nn }) => orbAlong(add(p, scale(nn, WARDA_PROUD - 0.2)), nn, [E.size * 1.5, E.size * 1.5, 0.2], n, k, 'mark')));
  const look = (shut: boolean): Mesh => {
    const out: Disc[] = [];
    for (const { p, n: nn } of seats) {
      const at = add(p, scale(nn, WARDA_PROUD + 0.02));
      if (shut) {
        out.push(disc(add(at, [0, 0, -E.size * 0.2]), nn, E.size * 1.08, E.size * 0.34, 8, 'lid'));
        continue;
      }
      out.push(disc(at, nn, E.size, E.size, 10, 'bloom'));
      out.push(disc(add(at, scale(nn, 0.01)), nn, E.size * 0.42, E.size * 0.46, 8, 'eye'));
      const side = unit(cross([0, 0, 1], nn));
      out.push(disc(add(add(add(at, [0, 0, E.size * 0.4]), scale(side, E.size * 0.32)), scale(nn, 0.02)), nn, E.size * 0.34, E.size * 0.34, 6, 'glint', { lit: true }));
    }
    return paint(out);
  };
  const beak = orbAlong([0, 0.92, 0.18], [0, 0.7, -0.7], [0.13, 0.11, 0.28], 6, 3, 'claw');
  // Two ear tufts, and between them the lamp's plume: up from the back of the crown and curled over forward like a crook, pale.
  const tufts = merge(...[1, -1].map((s) => taper(curve([s * 0.5, -0.05, 1.05], [s * 0.64, -0.08, 1.3], [s * 0.82, -0.2, 1.45], 2), 0.14, 0.02, 5, 'coatDark')));
  const crook = merge(
    tube(curve([0, -0.4, 1.12], [0, -0.52, 1.9], [0, -0.28, 2.42], 3), [0.1, 0.09, 0.08, 0.08], [0.1, 0.09, 0.08, 0.08], 5, 'mark'),
    tube(curve([0, -0.28, 2.42], [0, 0.1, 2.86], WARDA_TIP, 4), [0.08, 0.075, 0.07, 0.065, 0.06], [0.08, 0.075, 0.07, 0.065, 0.06], 5, 'mark'),
  );
  // The lamp: a little lantern of brass and glass on a short chain, hanging from the crook's tip on a bone of its own.
  const lamp = merge(
    taper([[0, 0, 0.02], [0, 0, -WARDA_CHAIN]], 0.035, 0.03, 4, 'horn'),
    tube([[0, 0, -WARDA_CHAIN], [0, 0, -WARDA_CHAIN - 0.08]], [0.1, 0.17], [0.1, 0.17], 6, 'horn'),
    orbAlong([0, 0, -WARDA_CHAIN - WARDA_GLASS], [0, 0, 1], [WARDA_GLASS, WARDA_GLASS, WARDA_GLASS * 1.1], 7, 4, 'crystal'),
    tube([[0, 0, -WARDA_CHAIN - WARDA_GLASS * 1.9], [0, 0, -WARDA_CHAIN - WARDA_GLASS * 2.15]], [0.15, 0.08], [0.15, 0.08], 6, 'horn'),
  );
  // The tail: three broad feathers fanned back and down, the outer ones turned on edge a little so the fan shows from the side too.
  const tail = merge(...[-1, 0, 1].map((q) => blade(curve([q * 0.08, 0.05, 0], [q * 0.2, -0.45, -0.08], [q * 0.38, -0.95, -0.3], 3), [0.08, 0.17, 0.18, 0.06], [q * 0.6, 0.3, 1], { twist: q * 0.35, fold: 0.3, thick: 0.05, mat: 'coatDark', rib: 'coat' })));
  const hide = [{ c: H.c, r: H.r }];
  return [
    { key: 'body', mesh: body, bone: 'body', bias: 0, breathes: { c: [0, 0, 0.1], k: 0.04 } },
    { key: 'tail', mesh: tail, bone: 'tail0', bias: -0.05 },
    { key: 'neck', mesh: neck, bone: 'neck', bias: 0, under: 'head', convex: true },
    { key: 'head', mesh: merge(skull, discs, beak, look(false)), shut: merge(skull, discs, beak, look(true)), bone: 'head', bias: 0.2 },
    { key: 'tufts', mesh: merge(tufts, crook), bone: 'head', bias: 0.21, after: 'head', hide },
    { key: 'lamp', mesh: lamp, bone: 'lamp', bias: 0.22, after: 'tufts' },
    { key: 'wing0', mesh: mirrored(foldedWing(1.3, 0.46, n, { mat: 'coat' })), bone: 'wing0', bias: 0.03, after: 'body', front: [-1, 0, 0] },
    { key: 'wing1', mesh: foldedWing(1.3, 0.46, n, { mat: 'coat' }), bone: 'wing1', bias: 0.03, after: 'body', front: [1, 0, 0] },
    // The legs a darker tan than the beak, so that at the island's furthest zooms they still stand it on the grass.
    ...birdLegPieces('bl', -1, 1.0, 0.15, 5, 'hoof'),
    ...birdLegPieces('br', 1, 1.0, 0.15, 5, 'hoof'),
  ];
}

/** A warda's bones as it stands or goes, before its lamp is hung. */
const wardaPose = (a: Anim): Bones => birdBones(WARDA_SPEC, a, (p) => {
  if (a.go > 0) return;
  const t = a.t, gz = a.graze;
  // Still as a post; the head swung round a long way to look behind it, held, and brought back -- but not while it forages.
  const behind = beat(t, [3.2, 15.6], 3.4) * (1 - gz), other = beat(t, [9.1, 21.0], 2.6) * (1 - gz);
  p.head[1] = p.head[1] * 0.3 + 95 * behind - 80 * other;
  p.head[2] *= 0.3;
});

/**
 * How the lamp hangs, as a pendulum on the crook's tip: swung by how the tip
 * has been moving over the last second and more -- the head turning, the neck
 * bowing -- so that it lags behind every turn, overshoots and swings back,
 * dying away; and going, swung to and fro by the steps. Degrees forward and
 * to the right.
 */
const LAMP_STEP = 0.2, LAMP_SAMPLES = 8, LAMP_W = TAU / 1.4, LAMP_DAMP = 0.2, LAMP_GAIN = 0.8;
function lampSwing(a: Anim): [number, number] {
  let fwd = 0, side = 0;
  if (a.go < 1) {
    const tip = (q: number): V3 => place(wardaPose({ ...a, go: 0, t: frac((a.t - q * LAMP_STEP) / LOOP) * LOOP }).head, WARDA_TIP);
    const pts = Array.from({ length: LAMP_SAMPLES + 2 }, (_, q) => tip(q));
    const wd = LAMP_W * Math.sqrt(1 - LAMP_DAMP * LAMP_DAMP);
    let dx = 0, dy = 0;
    for (let q = 0; q < LAMP_SAMPLES; q++) {
      // The tip's push at each moment back, and what is left of the swing it set going by now.
      const ax = (pts[q][0] - 2 * pts[q + 1][0] + pts[q + 2][0]) / (LAMP_STEP * LAMP_STEP);
      const ay = (pts[q][1] - 2 * pts[q + 1][1] + pts[q + 2][1]) / (LAMP_STEP * LAMP_STEP);
      const tau = (q + 1) * LAMP_STEP, h = (Math.exp(-LAMP_DAMP * LAMP_W * tau) * Math.sin(wd * tau)) / wd;
      dx -= ax * h * LAMP_STEP;
      dy -= ay * h * LAMP_STEP;
    }
    const len = WARDA_CHAIN + WARDA_GLASS;
    fwd = Math.atan2(dy * LAMP_GAIN, len) / DEG;
    side = Math.atan2(dx * LAMP_GAIN, len) / DEG;
  }
  const w = frac(a.u) * TAU;
  const lim = (x: number): number => clamp(x, -24, 24);
  return [lim(fwd * (1 - a.go) + a.go * (10 + 8 * a.gait) * Math.sin(2 * w - 1.2)), lim(side * (1 - a.go) + a.go * 6 * Math.sin(w - 1.2))];
}

/** Light drawn over a body, as a kind's glow is: bright in the middle, gone at its edge, and added to what is under it. */
function shine(g: CanvasRenderingContext2D, view: View, p: V3, r: number, c: RGB, al: number): void {
  if (al < 0.01) return;
  const [x, y] = onScreen(view, p);
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${al})`);
  grad.addColorStop(0.45, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${al * 0.35})`);
  grad.addColorStop(1, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},0)`);
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = grad;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.restore();
}

export const WARDA: Kind = {
  bones: (a) => {
    const b = wardaPose(a);
    // The lamp hangs from the tip of its crook, swinging behind every turn of the head.
    const [fwd, side] = lampSwing(a);
    b.lamp = joint({ m: b.body.m, t: place(b.head, WARDA_TIP) }, [0, 0, 0], fwd, -side);
    return b;
  },
  build: wardaBuild,
  palette: (coat, mark) => coatPalette(coat, mark, {
    crystal: [255, 240, 180], bloom: [250, 186, 70], horn: [214, 172, 96], claw: [196, 170, 140], hoof: [150, 124, 98], eye: [54, 36, 40],
  }, 230),
  shadow: [1.4, 1.0],
  stride: 1.0,
  size: 2.2,
  blinks: 7,
  glow: (b, a) => {
    const L = b.lamp;
    const pulse = 0.35 + 0.1 * Math.sin(a.t * TAU * 0.25);
    const at = place(L, [0, 0, -WARDA_CHAIN - WARDA_GLASS]);
    return [{ p: at, r: 1.1, c: [255, 220, 130], a: pulse }];
  },
  // The eyes' own light, drawn over the body only as far as each eye is turned toward the viewer, and not at all while they are shut:
  // a lantern's light does not come through the back of the head.
  extra: (g, view, b, a, beneath) => {
    if (beneath || a.blink) return;
    const h = b.head, H = WARDA_HEAD, E = WARDA_EYE;
    for (const s of [1, -1]) {
      const { p, n } = onEgg(H.c, H.r, [E.dir[0] * s, E.dir[1], E.dir[2]]);
      const out: V3 = [h.m[0] * n[0] + h.m[1] * n[1] + h.m[2] * n[2], h.m[3] * n[0] + h.m[4] * n[1] + h.m[5] * n[2], h.m[6] * n[0] + h.m[7] * n[1] + h.m[8] * n[2]];
      const toward = clamp((dot(out, view.T) - 0.05) / 0.45);
      shine(g, view, place(h, add(p, scale(n, WARDA_PROUD + 0.05))), 0.7, [255, 196, 90], 0.45 * toward);
    }
  },
};

/* ---- the quill --------------------------------------------------------------------- */

/**
 * A quill: a heavy, round ground-bird that would rather run than fly and
 * rather eat than run. Its tail is a bundle of arrows standing up out of its
 * rump like a full quiver, each fletched at the top in red or white, and the
 * long feathers of its wings are the red of the fletching too.
 */
const QUILL_SPEC: BirdSpec = {
  high: 1.35,
  leg: { at: [0.42, 0.05, -0.6], len: [0.38, 0.5, 0.08], rest: [16, -30] },
  neck: { at: [0, 0.9, 0.3], len: 0.35, lean: 20 },
  head: { pitch: 0 },
  wing: { at: [0.95, 0.35, 0.2] },
  tail: { at: [0, -0.9, 0.45], lift: -6 },
  swing: [26, 40],
  thrust: 12,
  // Foraging, tipped well over and a little crouched, so that the beak meets the ground with the face still to be seen; the legs swung
  // forward by as much as the bend would slant them back, so they stay straight under it.
  peck: 105,
  tip: 46,
  nose: 17,
  crouch: 0.5,
  stance: 1.33,
  waddle: 6,
};

const QUILL_HEAD = { c: [0, 0.18, 0.34] as V3, r: [0.72, 0.8, 0.66] as V3 };
const QUILL_BODY = { c: [0, -0.05, 0.1] as V3, r: [1.12, 1.3, 1.0] as V3 };
/** When it shows off, shaking out its quiver: seconds into the loop, and how long for. */
const QUILL_SHOW = [7.7, 18.9], QUILL_SHOW_LEN = 1.6;

function quillBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 11), k = cut(lod, 5, 7);
  const B = QUILL_BODY;
  // A round body, and a pale bib painted down the front of it.
  const body = merge(orb(B.c, B.r, n + 2, k + 1, 'coat'), patch(B.c, B.r, [0, 1, -0.28], 0.56, 0.62, 'mark', { sides: 16 }));
  const H = QUILL_HEAD;
  const skull = orb(H.c, H.r, n + 1, k, 'coat');
  const look = (shut: boolean): Mesh => eyes(H.c, H.r, [0.84, 0.44, 0.3], 0.24, { tall: 1.12, shut, rim: 0.16 });
  // A short beak, and a red wattle hung from the side of it.
  const beak = merge(orbAlong([0, 1.0, 0.17], [0, 1, -0.45], [0.15, 0.14, 0.22], 6, 3, 'bill'), orbAlong([0.2, 0.9, -0.06], [0.4, 0.2, -1], [0.07, 0.06, 0.17], 6, 3, 'petal'));
  const cheeks = blush(H.c, H.r, [0.7, 0.55, -0.1], 0.15);
  // A short tuft on the crown.
  const tuft = merge(...[-1, 1].map((s) => taper(curve([s * 0.08, -0.05, 0.92], [s * 0.1, -0.1, 1.14], [s * 0.14, -0.25, 1.22], 2), 0.07, 0.02, 4, 'coatDark')));
  // The quiver: arrows standing up out of the rump, fanned across and every other one leaning further back, so that it is a spread
  // bundle from the side as well as a fan from behind; each a pale shaft fletched over its top quarter, red and white by turns.
  const fan = [-50, -30, -10, 10, 30, 50];
  const spreads: Array<[number, number, number]> = [];
  let count = 0;
  const arrows = merge(...fan.map((deg, q) => {
    const a = deg * DEG, len = 1.7 - Math.abs(deg) * 0.006;
    const d = unit([Math.sin(a) * 0.8, -0.1 - 0.5 * (q % 2), Math.cos(a)]);
    const at = (u: number): V3 => scale(d, len * u);
    const side: V3 = [Math.cos(a), 0, -Math.sin(a)];
    const one = merge(
      taper([at(0), at(1.04)], 0.065, 0.052, 5, 'bark'),
      blade([at(0.74), at(0.87), at(1.0)], [0.05, 0.15, 0.12], [side[0] * 0.3, 0.95, side[2] * 0.3], { mat: q % 2 ? 'white' : 'fletch', rib: 'bark', fold: 0.1, thick: 0.03 }),
    );
    spreads.push([count, count + one.v.length, deg / 50]);
    count += one.v.length;
    return one;
  }));
  // The wing, its three long feathers the red of the fletching, pale-shafted and standing out past the edge of the wing to points, so
  // they read as the tips of a wing rather than a striped patch on the flank.
  const wing = merge(
    foldedWing(1.25, 0.55, n, { mat: 'feather' }),
    ...[0, 1, 2].map((q) => blade([[0.06, -0.75 - q * 0.05, 0.02 - q * 0.07], [0.08, -1.15 - q * 0.07, 0.04 - q * 0.09], [0.08, -1.5 - q * 0.08, 0.06 - q * 0.11]], [0.09, 0.12, 0.015], [1, 0, 0.25], { mat: 'fletch', rib: 'bark', thick: 0.03 })),
  );
  const hide = [{ c: H.c, r: H.r }];
  return [
    { key: 'body', mesh: body, bone: 'body', bias: 0, breathes: { c: [0, 0, 0.1], k: 0.05 } },
    {
      key: 'tail', mesh: arrows, bone: 'tail0', bias: -0.06,
      // Shown off, the arrows are spread wide, the outer ones out to seventy degrees.
      bent: (v, a) => {
        const show = beat(a.t, QUILL_SHOW, QUILL_SHOW_LEN) * (1 - a.go);
        if (show <= 0) return v as V3[];
        const out = v.slice() as V3[];
        for (const [s, e, k2] of spreads) {
          const c = Math.cos(k2 * 20 * DEG * show), sn = Math.sin(k2 * 20 * DEG * show);
          for (let i = s; i < e; i++) out[i] = [v[i][0] * c + v[i][2] * sn, v[i][1], -v[i][0] * sn + v[i][2] * c];
        }
        return out;
      },
    },
    { key: 'neck', mesh: tube([[0, 0, -0.3], [0, 0, 0.35]], 0.42, 0.4, n, 'coat', { seam: 'both' }), bone: 'neck', bias: 0, under: 'head', convex: true },
    { key: 'head', mesh: merge(skull, beak, cheeks, look(false)), shut: merge(skull, beak, cheeks, look(true)), bone: 'head', bias: 0.2 },
    { key: 'tuft', mesh: tuft, bone: 'head', bias: 0.21, after: 'head', hide },
    { key: 'wing0', mesh: mirrored(wing), bone: 'wing0', bias: 0.03, after: 'body', front: [-1, 0, 0] },
    { key: 'wing1', mesh: wing, bone: 'wing1', bias: 0.03, after: 'body', front: [1, 0, 0] },
    ...birdLegPieces('bl', -1, 0.5, 0.1, 5),
    ...birdLegPieces('br', 1, 0.5, 0.1, 5),
  ];
}

export const QUILL: Kind = {
  bones: (a) => birdBones(QUILL_SPEC, a, (p) => {
    if (a.go > 0) {
      // A run with the wings half out for balance, the quiver swaying.
      p.wings = [[0.25 + 0.35 * a.gait, 0.35 * a.gait], [0.25 + 0.35 * a.gait, 0.35 * a.gait]];
      return;
    }
    // Its looks about kept small, so that its face stays turned to whoever is looking at it.
    p.head[1] *= 0.6;
    p.head[2] *= 0.6;
    // Now and then the quiver lifted, spread and shaken out, rattling, and the wings dropped: showing off.
    const show = beat(a.t, QUILL_SHOW, QUILL_SHOW_LEN);
    p.tail[0] += 16 * show + 7 * show * Math.sin(a.t * TAU * 5);
    p.wings = [[0.15 * show, -0.2 * show], [0.15 * show, -0.2 * show]];
    p.head[0] += 8 * show;
  }),
  build: quillBuild,
  palette: (coat, mark) => coatPalette(coat, mark, {
    feather: lighter(pastel(coat), 0.12), featherDark: darker(pastel(coat), 0.18), bark: [240, 228, 204],
    fletch: [214, 92, 84], white: [244, 240, 230], bill: [236, 196, 140], petal: [232, 120, 128], claw: [224, 170, 120],
  }),
  shadow: [1.6, 1.3],
  stride: 1.2,
  size: 2.9,
};
