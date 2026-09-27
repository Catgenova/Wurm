import {
  add, coatPalette, cross, curve, cyc, disc, eyes, frac, lerp, lighter, LOOP, merge, mirrored, mix, orb, orbAlong, paint, pastel, scale, smile,
  smooth, sub, taper, TAU, tube, unit, type Anim, type Bones, type Kind, type Piece,
} from './beasts';
import { joint, ROOT, type Mesh, type RGB, type V3 } from './figure';
import { blade, cut } from './beastkit';

/** The ones that do not walk: the vesp, a swarm, and the lume, which drifts. */

/** Which of two a quick flutter is on: every other picture, going or standing. */
const flutter = (a: Anim): boolean => (a.go > 0 ? Math.floor(frac(a.u) * 12) : Math.floor(a.t * 6)) % 2 === 0;

/* ---- the vesp ---------------------------------------------------------------------- */

/**
 * A vesp: not one thing but a small busy cloud of them -- round, fuzzy,
 * striped, glassy-winged -- looping about a queen a size bigger than the
 * rest, who wears a crown of petals.
 */
const VESP_BEES = 7;
/** How much bigger the queen is than each of her six. */
const VESP_QUEEN = 1.3;

function vespBuild(lod: number): Piece[] {
  const n = cut(lod, 6, 8);
  // A bee: a round body dark at the tail and in two broad bands, a ruff of pale fuzz round its neck, and a round head with big
  // eyes.
  const bee = (r: number): Mesh => merge(
    tube([[0, -r * 1.28, 0], [0, -r * 1.1, 0.01], [0, -r * 0.8, 0.02], [0, -r * 0.5, 0.03], [0, -r * 0.2, 0.04], [0, r * 0.12, 0.04], [0, r * 0.5, 0.04], [0, r * 0.95, 0.02]],
      [r * 0.12, r * 0.55, r * 0.84, r * 0.97, r, r, r * 0.92, r * 0.5], [r * 0.12, r * 0.53, r * 0.8, r * 0.93, r * 0.96, r * 0.96, r * 0.88, r * 0.5], n,
      (ring) => (ring === 0 || ring === 2 || ring === 4 ? 'mark' : 'coat'), { up: [0, 0, 1] }),
    tube([[0, r * 0.6, 0.04], [0, r * 0.8, 0.05], [0, r * 1.0, 0.06]], [r * 0.72, r * 0.86, r * 0.62], [r * 0.7, r * 0.84, r * 0.6], n + 2, 'coatLight', { up: [0, 0, 1] }),
    orb([0, r * 1.2, 0.08], r * 0.66, n, 4, 'coat'),
    eyes([0, r * 1.2, 0.08], [r * 0.66, r * 0.66, r * 0.66], [0.55, 0.72, 0.28], r * 0.34, { tall: 1.1, rim: 0.05 }),
  );
  // Two feelers up off the top of the head, each with a bead at its end: a piece of their own, so that they are drawn as fine as
  // they are rather than inked as thick as the bee.
  const feelers = (r: number): Mesh => merge(...[1, -1].map((s) => merge(
    taper(curve([s * r * 0.16, r * 1.42, r * 0.6], [s * r * 0.26, r * 1.62, r * 1.1], [s * r * 0.5, r * 1.78, r * 1.3], 2), r * 0.08, r * 0.06, 4, 'mark'),
    orb([s * r * 0.52, r * 1.8, r * 1.32], r * 0.12, 4, 3, 'mark'),
  )));
  // Wings: short and glassy, with a streak of light along each, raised in a V and then spread out level on alternate pictures,
  // which is a buzz.
  const wings = (up: boolean, r: number): Mesh => merge(...[1, -1].map((s) => {
    const root: V3 = [s * r * 0.22, r * 0.25, r * 0.82];
    const mid: V3 = up ? [s * r * 0.6, 0, r * 1.36] : [s * r * 0.76, 0, r * 1.06];
    const tip: V3 = up ? [s * r * 0.92, -r * 0.36, r * 1.72] : [s * r * 1.14, -r * 0.4, r * 1.02];
    const along = unit(sub(tip, root));
    const face = unit(sub([0, 0, 1], scale(along, along[2])));
    const at = add(scale(add(root, tip), 0.5), add(scale(face, 0.012), scale(cross(face, along), s * r * 0.1)));
    return merge(
      blade(curve(root, mid, tip, 3), [r * 0.14, r * 0.42, r * 0.44, r * 0.1], [0, 0, 1], { mat: 'crystal', fold: 0.05, thick: r * 0.06 }),
      paint([disc(at, face, r * 0.36, r * 0.07, 6, 'glint', { lit: true, up: cross(face, along) })]),
    );
  }));
  // The queen's crown: six petals round the top of her head, and a bud in the middle of them.
  const rq = 0.34 * VESP_QUEEN;
  const top: V3 = [0, rq * 1.2, 0.08 + rq * 0.62];
  const crown = merge(...Array.from({ length: 6 }, (_, q) => {
    const a = (q / 6) * TAU;
    return orbAlong(add(top, [Math.cos(a) * rq * 0.34, Math.sin(a) * rq * 0.34, 0.06]), [Math.cos(a), Math.sin(a), 1.3], [0.13, 0.08, 0.2], 5, 3, 'petal');
  }), orb(add(top, [0, 0, 0.1]), 0.09, 5, 3, 'bloom'));
  const out: Piece[] = [];
  for (let q = 0; q < VESP_BEES; q++) {
    const r = q === 0 ? rq : 0.34;
    out.push(
      { key: `bee${q}`, mesh: q === 0 ? merge(bee(r), crown) : bee(r), bone: `bee${q}`, bias: 0 },
      { key: `feel${q}`, mesh: feelers(r), bone: `bee${q}`, bias: 0.001, after: `bee${q}`, front: [0, 1, 0.5], rim: false },
      { key: `up${q}`, mesh: wings(true, r), bone: `bee${q}`, bias: 0.001, airy: true, shown: (a) => flutter(a) },
      { key: `down${q}`, mesh: wings(false, r), bone: `bee${q}`, bias: 0.001, airy: true, shown: (a) => !flutter(a) },
    );
  }
  return out;
}

/**
 * The six about the queen, all at one pace and evenly spaced round her, on
 * two rings in turn -- a near one and a far one -- each bobbing up and down
 * as it goes, so that however the swarm is seen no two of them are ever on
 * top of each other. Whole turns a loop standing and a stride going, so both
 * are loops.
 */
function vespBones(a: Anim): Bones {
  const t = a.t, go = smooth(a.go), w = frac(a.u);
  const hover = 1.7 + 0.12 * cyc(t, 6) * (1 - go);
  const body = joint(ROOT, [0, 0, hover], 0, 0, 0);
  const b: Bones = { body };
  // The queen a little above the middle of them, drifting.
  b.bee0 = joint(body, [0.15 * cyc(t, 3) * (1 - go), 0.12 * cyc(t, 4, 1) * (1 - go) + 0.5 * go, 0.4 + 0.1 * cyc(t, 5)], 0, 0, 0);
  for (let q = 1; q < VESP_BEES; q++) {
    const far = q % 2 === 0, ph = ((q - 1) / (VESP_BEES - 1)) * TAU;
    // Standing: round and round her, seven times a loop, with a small wander of each one's own.
    const u = (t * 7 * TAU) / LOOP + ph, r = far ? 2.7 : 2.1;
    const sx = r * Math.sin(u) + 0.15 * cyc(t, 12, q), sy = r * 0.8 * Math.cos(u) + 0.15 * cyc(t, 10, q * 2);
    const sz = 0.9 * Math.sin(u + q * 1.3) + 0.1 * cyc(t, 15, q);
    // Going: the same ring drawn in and trailed out behind her, once round a stride.
    const v = w * TAU + ph, rg = far ? 2.1 : 1.55;
    const gx = rg * Math.sin(v), gy = -1.4 + rg * 0.7 * Math.cos(v), gz = 0.7 * Math.sin(v + q * 1.3);
    const dx = lerp(Math.cos(u), Math.cos(v) * 0.6, go), dy = lerp(-0.8 * Math.sin(u), 1.4, go);
    b[`bee${q}`] = joint(body, [lerp(sx, gx, go), lerp(sy, gy, go), lerp(sz, gz, go)], 0, 0, (Math.atan2(-dx, dy) * 180) / Math.PI);
  }
  b.shadow = { m: [0.8, 0, 0, 0, 0.8, 0, 0, 0, 1], t: [0, 0, 0] };
  return b;
}

export const VESP: Kind = {
  bones: vespBones,
  build: vespBuild,
  palette: (coat, mark) => {
    // Honey rather than the variant's own brown, which at the size a bee is drawn is a bean: each variant only leaning it.
    const c = mix(pastel(coat), [246, 210, 110], 0.8);
    return coatPalette(coat, mark, { coat: c, coatLight: lighter(c, 0.62), mark: [80, 62, 72], crystal: [226, 240, 255], petal: [246, 150, 190], bloom: [250, 224, 120] });
  },
  shadow: [1.3, 1.1],
  stride: 1.4,
  size: 2.2,
  blinks: 0,
};

/* ---- the lume ---------------------------------------------------------------------- */

/**
 * A lume: a pale bell of light that drifts a little over the ground on soft
 * moth's wings, trailing ribbons, with a small sleepy face on it and two
 * feathered feelers; the light it gives has nothing to do with fire.
 */
const LUME_RIBBONS = 4;
/** How long each of the three links of a ribbon is: all three together end well clear of the grass, so it is seen to float. */
const LUME_LINK = 0.36;

function lumeBuild(lod: number): Piece[] {
  const n = cut(lod, 9, 12), k = cut(lod, 5, 7);
  // The bell: a dome with a scalloped rim.
  const bell = tube([[0, 0, 0.95], [0, 0, 0.85], [0, 0, 0.55], [0, 0, 0.1], [0, 0, -0.3], [0, 0, -0.42]], [0.05, 0.45, 0.85, 1.05, 1.08, 0.98], [0.05, 0.45, 0.85, 1.05, 1.08, 0.98], n + 2,
    (ring, j) => (ring === 4 && j % 2 ? 'crystalDark' : 'crystal'), { up: [0, 1, 0] });
  const inner = orb([0, 0, 0.05], [0.6, 0.6, 0.5], n, k, 'spot');
  const face = merge(
    eyes([0, 0, 0.2], [1.0, 1.0, 0.9], [0.62, 0.78, 0.05], 0.2, { tall: 1.0, rim: 0.05 }),
    smile([0, 1.06, -0.12], [0, 1, 0], 0.3),
    paint([1, -1].map((s) => disc([s * 0.58, 0.86, -0.08], [s * 0.55, 0.83, 0], 0.14, 0.1, 6, 'petal'))),
  );
  // Feathered feelers: each a little plume up and forward off the crown, pale, with a dark quill.
  const feeler = (s: number): Mesh => blade(curve([s * 0.12, 0.28, 0.86], [s * 0.26, 0.55, 1.4], [s * 0.5, 0.72, 1.62], 4), [0.03, 0.1, 0.13, 0.1, 0.03], [s * 0.3, 1, 0.2], { mat: 'petal', rib: 'crystalDark', fold: 0.2, thick: 0.03 });
  // Soft moth's wings: a forewing and a smaller hindwing each side, each with an eye-spot.
  const wing = merge(
    blade(curve([0, 0.1, 0], [0.9, 0.35, 0.25], [1.7, 0.1, 0.35], 4), [0.1, 0.45, 0.55, 0.42, 0.12], [0, 0.2, 1], { mat: 'petal', rib: 'crystalDark', fold: 0.12, thick: 0.04 }),
    blade(curve([0, -0.1, -0.05], [0.7, -0.45, 0.0], [1.15, -0.7, -0.05], 3), [0.1, 0.3, 0.32, 0.08], [0, 0.2, 1], { mat: 'petal', rib: 'crystalDark', fold: 0.1, thick: 0.04 }),
    paint([disc([1.05, 0.28, 0.38], [0, 0.1, 1], 0.16, 0.16, 7, 'bloom', { lit: true }), disc([1.05, 0.28, 0.4], [0, 0.1, 1], 0.07, 0.07, 6, 'crystalDark')]),
  );
  // A ribbon in three links, one colour its whole length and narrowing all the way down, so that it is one streamer and not a leg
  // in joints.
  const across = [0.11, 0.085, 0.06, 0.02];
  const ribbon = (r: number, k2: number): Mesh => blade([[0, 0, 0], [0.03, 0.02, -LUME_LINK / 2], [0, 0, -LUME_LINK]], [across[k2], (across[k2] + across[k2 + 1]) / 2, across[k2 + 1]], [0, 1, 0],
    { twist: 0.9 * (k2 % 2 ? 1 : -1), mat: r % 2 ? 'water' : 'crystal', fold: 0.05, thick: 0.03 });
  const out: Piece[] = [
    // Inked lightly all round: a dark line down the sides of a bell of light is a hood.
    { key: 'bell', mesh: merge(bell, face), bone: 'body', bias: 0, lines: false, airy: true },
    { key: 'inner', mesh: inner, bone: 'body', bias: -0.01, rim: false },
    { key: 'feelers', mesh: merge(feeler(1), feeler(-1)), bone: 'body', bias: 0.01, airy: true },
    { key: 'wing0', mesh: mirrored(wing), bone: 'wing0', bias: 0.02, airy: true, front: [-1, 0, 0] },
    { key: 'wing1', mesh: wing, bone: 'wing1', bias: 0.02, airy: true, front: [1, 0, 0] },
  ];
  for (let r = 0; r < LUME_RIBBONS; r++) {
    for (let k2 = 0; k2 < 3; k2++) out.push({ key: `rib${r}_${k2}`, mesh: ribbon(r, k2), bone: `rib${r}_${k2}`, bias: -0.02, airy: true, chain: `rib${r}` });
  }
  return out;
}

function lumeBones(a: Anim): Bones {
  const t = a.t, go = a.go, w = frac(a.u);
  // Drifting: a slow bob and a slow sway standing; going, leaning into it and bobbing once a stride.
  const bob = (1 - go) * 0.28 * cyc(t, 4) + go * 0.2 * Math.sin(w * TAU);
  const body = joint(ROOT, [0, 0, 2.3 + bob], -14 * go + 4 * cyc(t, 3) * (1 - go), 5 * cyc(t, 2) * (1 - go), 0);
  const b: Bones = { body };
  // The wings from the sides of the bell, spread and swept a little back as a moth's are, beating slow and soft: once every
  // couple of seconds standing, faster going.
  const beatW = (1 - go) * Math.sin(t * TAU * 12 / LOOP) + go * Math.sin(w * TAU * 2);
  for (let k = 0; k < 2; k++) {
    const sd = k ? 1 : -1;
    b[`wing${k}`] = joint(body, [sd * 0.8, -0.1, 0.3], 0, sd * (10 + 25 * beatW), sd * -20);
  }
  // Ribbons hanging from the rim, each link swinging a little behind the one above.
  for (let r = 0; r < LUME_RIBBONS; r++) {
    const ang = (r / LUME_RIBBONS) * TAU + 0.4;
    let prev = joint(body, [Math.cos(ang) * 0.72, Math.sin(ang) * 0.72, -0.4], 0, 0, 0);
    for (let k2 = 0; k2 < 3; k2++) {
      const lag = (1 - go) * 18 * Math.sin(t * TAU * 5 / LOOP - k2 * 0.8 + r) + go * (22 + 8 * Math.sin(w * TAU - k2 * 0.9 + r));
      prev = joint(prev, k2 ? [0, 0, -LUME_LINK] : [0, 0, 0], lag, 6 * Math.sin(t * TAU * 7 / LOOP + r + k2), 0);
      b[`rib${r}_${k2}`] = prev;
    }
  }
  b.shadow = { m: [0.7, 0, 0, 0, 0.7, 0, 0, 0, 1], t: [0, 0, 0] };
  return b;
}

export const LUME: Kind = {
  bones: lumeBones,
  build: lumeBuild,
  palette: (coat, mark) => {
    const c = pastel(coat), m = pastel(mark);
    return coatPalette(coat, mark, {
      crystal: m, crystalDark: [150, 144, 196], spot: [255, 252, 236], petal: [c[0] * 0.5 + 118, c[1] * 0.5 + 110, c[2] * 0.5 + 125] as RGB, water: [196, 226, 246], bloom: [255, 226, 150],
    });
  },
  shadow: [1.0, 1.0],
  stride: 0.8,
  size: 2.3,
  blinks: 6,
  // A soft light close about the bell, not so strong that its own wings and feelers are washed out to white in it.
  glow: (b, a) => {
    const B = b.body;
    const pulse = 0.25 + 0.06 * cyc(a.t, 6);
    return [
      { p: [B.t[0], B.t[1], B.t[2] + 0.1], r: 1.8, c: [220, 240, 255], a: pulse },
      { p: [B.t[0], B.t[1], B.t[2] + 0.1], r: 1.1, c: [255, 250, 230], a: 0.25 },
    ];
  },
};

