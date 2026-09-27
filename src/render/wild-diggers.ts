import {
  add, beat, coatPalette, cross, curve, cyc, DEG, disc, lighter, merge, mirrored, moved, onEgg, orb, orbAlong, paint, quadBonesOf, scale, smile, sub, taper, TAU, tube, unit,
  type Anim, type Kind, type Piece, type QuadPose, type QuadSpec,
} from './beasts';
import { blade, cut, earMesh, hoofMesh, pawMesh, quadPieces } from './beastkit';
import { joint, mesh, place, type Mat, type Mesh, type RGB, type V3 } from './figure';

/** The diggers: the vola, the mola, the dowse and the snout, all long and low and nose-first. */

/**
 * A long low burrower: short legs, the body close to the ground, the head carried forward and low. `lean` is how far forward of
 * upright the neck is carried, and `graze`, `nose` and `bow` how far the neck, the head and the chest go down to the ground
 * (`QuadSpec`).
 */
const digger = (o: { high: number; len: number; legs: number; neck: number; lean?: number; graze?: number; nose?: number; bow?: number; swing?: [number, number] }): QuadSpec => ({
  high: o.high,
  fore: { at: [0.55, o.len * 0.42, -0.35], len: [o.legs * 0.55, o.legs * 0.45, 0.12], rest: [4, -8, 0], fold: [55, 85], toe: [0.35, 0.1] },
  hind: { at: [0.58, -o.len * 0.4, -0.3], len: [o.legs * 0.6, o.legs * 0.5, 0.12], rest: [22, -40, 0], fold: [45, 70], toe: [0.4, 0.12] },
  neck: { at: [0, o.len * 0.5, 0.1], len: o.neck, lean: o.lean ?? 72 },
  head: { pitch: -4 },
  tail: { at: [0, -o.len * 0.52, 0.1], links: 2, len: 0.32, lift: 8, curl: -10, sway: 14 },
  ears: { at: [0.62, -0.2, 0.42], out: 40, back: 20 },
  swing: o.swing ?? [30, 46],
  graze: o.graze ?? 20,
  nose: o.nose ?? 14,
  bow: o.bow ?? 16,
  rock: 5,
});

/** A scurry: small quick steps, the whole body wagging with them; and standing, the nose always going, and down for a sniff `sniff` degrees deep. */
function scurry(p: QuadPose, a: Anim, sniff = 14): void {
  const w = a.u - Math.floor(a.u);
  if (a.go > 0) {
    p.roll += a.go * 4 * Math.sin(w * TAU);
    p.lift += a.go * 0.08 * Math.abs(Math.sin(w * TAU * 2));
    p.neck[1] += a.go * 8 * Math.sin(w * TAU);
    p.tail[1] += a.go * 20 * Math.sin(w * TAU + 1);
    return;
  }
  // Working at the air three times a second, and down to the ground for a sniff twice a loop, the nose tipped down into it.
  const down = beat(a.t, [5.2, 17.6], 1.4);
  p.head[0] += 3 * Math.sin(a.t * Math.PI * 6) - sniff * 0.5 * down;
  p.neck[0] += sniff * down;
}

/**
 * Broad fore paws carried through their swing nearly as level as they are put down: `k` of the tip and the curl a paw is given
 * lifting off (`quadBones`) taken out of it again, since a trowel or a shovel tipped up on end is a stick.
 */
function flatFore(p: QuadPose, s: QuadSpec, k: number): void {
  const rest = s.fore.rest ?? [0, 0, 0], folds = s.fore.fold ?? [45, 75];
  for (const i of [0, 1]) {
    const [sw, fold, off] = p.legs[i];
    const knee = fold * (folds[0] + (folds[1] - folds[0]) * Math.min(1, Math.abs(sw) / 40));
    const flat = -(p.pitch + rest[0] + sw + rest[1] - knee);
    p.foot[i] += k * (0.6 * flat + 35 * fold) * Math.min(1, off * 3);
  }
}

/* ---- the vola ------------------------------------------------------------------------ */

/**
 * A vola: a velvet digger with broad pink shovel paws and a snout like a pink
 * star, which noses through the undergrowth for herbs. A little garden grows
 * on its back: two sprigs of herb, a yellow flower and a red toadstool.
 */
const VOLA_SPEC = digger({ high: 0.95, len: 3.4, legs: 0.62, neck: 0.3, nose: 10 });
const VOLA_HEAD = { c: [0, 0.4, 0.1] as V3, r: [0.92, 0.9, 0.78] as V3 };
/** The middle of the star on the end of its snout, in the head's frame. */
const STAR_AT: V3 = [0, 1.64, -0.04];

function volaBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 10), k = cut(lod, 5, 6);
  const H = VOLA_HEAD;
  // A pale muzzle standing out of the face, so side on there is a nose line in front of the eye with the star on its end.
  const muzzle = orbAlong([0, 1.17, -0.08], [0, 1, 0], [0.37, 0.31, 0.44], n, k, 'muzzle');
  // The star of a snout: a round nub with a ring of pink fingers round it.
  const nub = orbAlong(STAR_AT, [0, 1, 0], [0.24, 0.2, 0.2], 6, 4, 'nose');
  const star = merge(
    nub,
    ...Array.from({ length: 6 }, (_, q) => {
      const a = (q / 6) * TAU;
      return orbAlong(add(STAR_AT, [Math.cos(a) * 0.26, 0.06, Math.sin(a) * 0.22]), [Math.cos(a), 0.7, Math.sin(a)], [0.08, 0.08, 0.15], 5, 3, 'nose');
    }),
  );
  const fingersFrom = nub.v.length;
  // A sprig of herb: a stalk with a leaf at its tip and three up it, each turned a third of the way round from the last and to the
  // sky, and twisted along its length, so some are always side on and none is ever edge on.
  const sprig = (at: V3, lean: number, turn: number): Mesh => {
    const tip = add(at, [lean * 0.13, 0.04, 0.42]);
    const leaf = (root: V3, d: V3, rise: number): Mesh => {
      const pt = (u: number): V3 => add(root, [d[0] * u, d[1] * u, d[2] * u + rise * (u / 0.28) ** 1.3]);
      return blade([pt(0), pt(0.1), pt(0.2), pt(0.28)], [0.03, 0.13, 0.11, 0.02], [0, 0, 1], { twist: 0.8, mat: 'leaf', rib: 'stem' });
    };
    return merge(
      tube3(curve(at, add(at, [lean * 0.06, 0, 0.22]), tip, 3), 0.05),
      ...[0.1, 0.2, 0.3].map((h, q) => {
        const a = turn + (q * TAU) / 3;
        return leaf(add(at, [lean * 0.13 * (h / 0.42), 0.02, h]), [Math.cos(a), Math.sin(a), 0], 0.14);
      }),
      leaf(tip, [lean * 0.5, 0.12, 0.35], 0.06),
    );
  };
  // The garden on its back, set on the velvet rather than sunk in it: a red toadstool, two sprigs of herb and a yellow flower.
  const toadstool = merge(
    taper([[0.15, -0.3, 0.82], [0.15, -0.3, 1.1]], 0.13, 0.11, 6, 'spot'),
    orbAlong([0.15, -0.3, 1.14], [0, 0, 1], [0.4, 0.4, 0.21], n, k, 'cap'),
    paint([disc([0.15, -0.3, 1.36], [0, 0, 1], 0.09, 0.09, 5, 'spot'), disc([0.42, -0.24, 1.25], [0.7, 0, 0.7], 0.08, 0.08, 5, 'spot'), disc([-0.08, -0.1, 1.27], [-0.4, 0.4, 0.8], 0.08, 0.08, 5, 'spot')]),
  );
  const flower = merge(
    tube3([[-0.35, -0.9, 0.8], [-0.36, -0.88, 1.02]], 0.045),
    orb([-0.36, -0.88, 1.04], [0.2, 0.2, 0.09], 7, 3, 'bloom'),
    paint([disc([-0.36, -0.88, 1.135], [0, 0, 1], 0.08, 0.08, 6, 'ember')]),
  );
  // The herbs are too fine to carry the lines a body does: outlined thinly, and nothing drawn across their leaves. The sprig ahead
  // of the toadstool goes down after it only seen from ahead, and the sprig and the flower behind it only seen from behind.
  const herbs = (key: string, m: Mesh, ahead: number): Piece => ({ key, mesh: m, bone: 'trunk', bias: 0.01, after: 'garden', front: [0, ahead, 0], thin: true, lines: false });
  // Shovels: the fore paws broad and flat, laid over with the palm turned out and down, which is how they dig.
  const shovel = moved(orbAlong([0, 0.2, 0], [0, 1, 0], [0.3, 0.09, 0.34], n, k, 'pad'), [0.05, 0, 0.12], 0, -10, -40);
  return [
    ...quadPieces({
      n, k,
      body: { y: [-1.95, -1.6, -0.9, 0, 0.9, 1.5, 1.8], z: [0.1, 0.14, 0.16, 0.16, 0.16, 0.2, 0.25], w: [0.2, 0.8, 1.02, 1.08, 1.0, 0.78, 0.25], h: [0.18, 0.62, 0.75, 0.78, 0.72, 0.6, 0.22], belly: true },
      neck: { w: 0.66, h: 0.56, len: 0.3 },
      head: { c: H.c, r: H.r, face: merge(muzzle, smile([0, 1.38, -0.34], [0, 1, -0.4], 0.24)), eye: { dir: [0.72, 0.6, 0.26], size: 0.27, rim: 0.12 }, blush: [[0.78, 0.5, -0.3], 0.16] },
      ear: earMesh(0.35, 0.26, n),
      tail: [taper([[0, 0, 0], [0, -0.34, 0]], 0.12, 0.1, 5, 'coatDark'), taper([[0, 0, 0], [0, -0.3, 0]], 0.1, 0.03, 5, 'coatDark')],
      fore: { upper: [0.25, -0.35, 0.24, 0.2], lower: [0, -0.28, 0.2, 0.18], foot: shovel },
      hind: { upper: [0.25, -0.38, 0.28, 0.2], lower: [0, -0.3, 0.18, 0.16], foot: pawMesh(0.2, n, k, 'pad', 0.12) },
      extras: [
        { key: 'garden', mesh: toadstool, bone: 'trunk', bias: 0.05, after: 'body' },
        herbs('herbs0', sprig([-0.3, 0.35, 0.85], -1, 0.5), 1),
        herbs('herbs1', merge(sprig([0.35, -1.05, 0.8], 1, 2.2), flower), -1),
      ],
    }),
    // The star as a piece of its own, so its fingers can work at the air: spread and drawn in again on every other still.
    {
      key: 'star', mesh: star, bone: 'head', bias: 0.22, after: 'head', hide: [{ c: H.c, r: H.r }], hideIn: 'head', lines: false,
      bent: (v, a) => {
        const s = 1 + 0.15 * cyc(a.t, 72) * (1 - a.go);
        return v.map((p, i) => (i < fingersFrom ? p : [STAR_AT[0] + (p[0] - STAR_AT[0]) * s, p[1], STAR_AT[2] + (p[2] - STAR_AT[2]) * s]));
      },
    },
  ];
}

/** A stalk: a thin green tube. */
const tube3 = (pts: V3[], r: number): Mesh => taper(pts, r, r * 0.8, 5, 'stem');

export const VOLA: Kind = {
  bones: quadBonesOf(VOLA_SPEC, (p, a) => {
    scurry(p, a, 24);
    flatFore(p, VOLA_SPEC, 0.7);
  }),
  build: volaBuild,
  palette: (coat, mark) => coatPalette(coat, mark, {
    nose: [246, 168, 188], pad: [236, 168, 176], cap: [226, 96, 92], spot: [252, 246, 236], leaf: [156, 212, 104], stem: [110, 160, 80], bloom: [250, 214, 110], ember: [236, 146, 70],
  }),
  shadow: [2.1, 1.1],
  stride: 1.9,
  size: 1.45,
};

/* ---- the mola ------------------------------------------------------------------------ */

/**
 * A mola: a heavy-shouldered mole with trowels for claws, grit and flecks of
 * ore worked into its coat, and eyes it keeps shut and smiling. It smells
 * metal through the crystal that grows on the end of its nose.
 */
const MOLA_SPEC = digger({ high: 1.0, len: 3.2, legs: 0.6, neck: 0.4, lean: 56, nose: 11 });
const MOLA_HEAD = { c: [0, 0.4, 0.12] as V3, r: [1.08, 1.02, 0.9] as V3 };
/**
 * The crystal on its nose: where it grows from, on top of the end of the snout, and the way it points, tipped half-way and more
 * from upright toward straight ahead, so it is a star on the snout under the eyes seen from ahead and points ahead side on.
 */
const MOLA_CRYSTAL = { at: [0, 1.56, 0.1] as V3, dir: [0, Math.sin(50 * DEG), Math.cos(50 * DEG)] as V3 };
/** The middle of the crystal, in the head's frame: where its light is. */
const MOLA_GLINT: V3 = add(MOLA_CRYSTAL.at, scale(MOLA_CRYSTAL.dir, 0.22));

/**
 * A shut eye, smiling: an arch like a ∩ painted on an egg of a head, `w` across
 * and a band `th` wide, where the way out of the middle `dir` meets its shell;
 * every corner laid on the shell, so an arch as wide as this bends round the
 * head rather than standing off it at its ends.
 */
function shutEye(c: V3, r: V3, dir: V3, w: number, th: number): Mesh {
  const { p, n } = onEgg(c, r, dir);
  const u = unit(cross([0, 0, 1], n)), up = cross(n, u);
  const arc = Array.from({ length: 9 }, (_, q): [number, number] => {
    const a = Math.PI * (0.08 + (0.84 * q) / 8);
    return [Math.cos(a), Math.sin(a) * 0.9 - 0.35];
  });
  const band = [...arc.map(([x, y]) => [x * (w + th / 2), y * (w + th / 2)]), ...arc.reverse().map(([x, y]) => [x * (w - th / 2), y * (w - th / 2)])];
  return paint([{
    v: band.map(([x, y]) => {
      const e = onEgg(c, r, sub(add(p, add(scale(u, x), scale(up, y))), c));
      return add(e.p, scale(e.n, 0.04));
    }),
    m: 'eye',
  }]);
}

/**
 * A flat thing of a shape, lying on the ground: `outline` round it (across,
 * forward; anticlockwise from above), its underside at `z`, `thick` deep.
 */
function slab(outline: ReadonlyArray<[number, number]>, z: number, thick: number, mat: Mat): Mesh {
  const n = outline.length;
  const v: V3[] = [...outline.map(([x, y]): V3 => [x, y, z]), ...outline.map(([x, y]): V3 => [x, y, z + thick])];
  return mesh(v, [
    { i: Array.from({ length: n }, (_, j) => n - 1 - j), m: mat },
    { i: Array.from({ length: n }, (_, j) => n + j), m: mat },
    ...Array.from({ length: n }, (_, j) => ({ i: [j, (j + 1) % n, n + ((j + 1) % n), n + j], m: mat })),
  ]);
}

function molaBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 10), k = cut(lod, 5, 6);
  const H = MOLA_HEAD;
  const snout = merge(
    taper([[0, 0.9, -0.06], [0, 1.36, -0.09], [0, 1.6, -0.09]], 0.38, 0.23, n, 'muzzle'),
    orbAlong([0, 1.66, -0.07], [0, 1, 0], [0.2, 0.14, 0.17], 6, 3, 'nose'),
  );
  // Happy shut eyes: two arches on the skin, set far enough round the head that side on one of them shows whole, clear of the
  // head's edge, and broad and dark enough to be a face at play size rather than a blank dome.
  const face = merge(snout, shutEye(H.c, H.r, [0.72, 0.5, 0.44], 0.3, 0.22), shutEye(H.c, H.r, [-0.72, 0.5, 0.44], 0.3, 0.22), smile([0, 1.52, -0.36], [0, 1, -0.5], 0.24, 'eye'));
  // The crystal on its nose: a star of short points fanned out of the end of the snout, forward and outward, pale and bright:
  // one straight along the way it points, and four round it, each leaning 38 degrees out from it.
  const C = MOLA_CRYSTAL, across: V3 = [1, 0, 0], down = cross(C.dir, across);
  const shard = (d: V3, len: number, r: number, m: Mat): Mesh => taper([add(C.at, scale(d, 0.04)), add(C.at, scale(d, len))], r, 0, 6, m);
  const crystal = merge(
    shard(C.dir, 0.45, 0.14, 'crystal'),
    ...[45, 135, 225, 315].map((a, q) => {
      const out = add(scale(across, Math.cos(a * DEG)), scale(down, Math.sin(a * DEG)));
      return shard(unit(add(scale(C.dir, Math.cos(38 * DEG)), scale(out, Math.sin(38 * DEG)))), q % 2 ? 0.36 : 0.4, 0.11, q % 2 ? 'crystalDark' : 'crystal');
    }),
  );
  const flecks = paint(([[0.6, 0.4, 0.5], [-0.5, -0.4, 0.62], [0.3, -1.0, 0.55], [-0.2, 0.9, 0.62], [0.75, -0.6, 0.3]] as V3[]).map((c) => disc(c, [c[0], 0, 0.8], 0.16, 0.12, 6, 'gem', { lit: true })));
  // Trowels: the fore paws broad, flat and pale, ahead of the leg, and three long claws fanned out of each, which are the shape
  // of its edge rather than things of their own, so they are not lost in their own lines. Each is tipped up onto its outer edge
  // with its back turned out, so from the side and from ahead it shows its face and its three claws, not the stepped edge of a
  // block lying flat.
  const trowel = moved(moved(slab([
    [0.26, -0.06], [0.42, 0.18], [0.5, 0.46], [0.54, 0.72], [0.5, 0.92], [0.42, 1.02], [0.32, 0.8], [0.2, 0.56], [0.13, 0.9], [0, 1.15],
    [-0.13, 0.9], [-0.2, 0.56], [-0.32, 0.8], [-0.42, 1.02], [-0.5, 0.92], [-0.54, 0.72], [-0.5, 0.46], [-0.42, 0.18], [-0.26, -0.06],
  ], -0.13, 0.13, 'claw'), [-0.54, 0, 0.13]), [0.54, 0, -0.13], 0, 0, 30);
  return quadPieces({
    n, k,
    body: { y: [-1.75, -1.45, -0.8, 0, 0.7, 1.25, 1.6], z: [0.05, 0.12, 0.2, 0.25, 0.28, 0.3, 0.28], w: [0.2, 0.85, 1.1, 1.2, 1.2, 1.0, 0.3], h: [0.18, 0.66, 0.82, 0.86, 0.86, 0.74, 0.25] },
    neck: { w: 0.8, h: 0.7, len: 0.4 },
    head: { c: H.c, r: H.r, face, eye: { dir: [0.4, 0.9, 0.4], size: 0.0001 }, blush: [[0.72, 0.55, -0.25], 0.22] },
    tail: [taper([[0, 0, 0], [0, -0.3, 0]], 0.1, 0.06, 5, 'coatDark')],
    fore: { upper: [0.25, -0.33, 0.32, 0.26], lower: [0, -0.27, 0.26, 0.22], foot: pawMesh(0.2, n, k, 'coat', 0.12) },
    hind: { upper: [0.25, -0.36, 0.3, 0.22], lower: [0, -0.3, 0.2, 0.17], foot: pawMesh(0.2, n, k, 'pad', 0.12) },
    extras: [
      // Glass: outlined thinly, and no lines across it.
      { key: 'crystal', mesh: crystal, bone: 'head', bias: 0.25, after: 'head', hide: [{ c: H.c, r: H.r }], hideIn: 'head', thin: true, lines: false },
      { key: 'flecks', mesh: flecks, bone: 'trunk', bias: 0.01, after: 'body' },
      // Each trowel on its fore foot, over the paw it grows from, and with no lines drawn across it: only the outline round it.
      ...([['fl2', -1], ['fr2', 1]] as Array<[string, number]>).map(([bone, side]): Piece => ({
        key: `trowel${bone}`, mesh: side < 0 ? mirrored(trowel) : trowel, bone, bias: 0.035, after: ['body', bone], front: [side * 0.7, 0.7, 0], lines: false,
      })),
    ],
  });
}

export const MOLA: Kind = {
  bones: quadBonesOf(MOLA_SPEC, (p, a) => {
    scurry(p, a);
    flatFore(p, MOLA_SPEC, 0.85);
  }),
  build: molaBuild,
  // Its greys a cool slate, where the vola's and the dowse's are warm: the three are told apart at a glance. A pale slate, near
  // the grass in lightness, so its light and shade show on it.
  palette: (coat, mark) => coatPalette(lighter(coat, 0.25), lighter(mark, 0.25), {
    nose: [230, 140, 158], pad: [232, 170, 170], claw: [236, 220, 190], horn: [214, 200, 176], crystal: [186, 226, 250], crystalDark: [140, 184, 236], gem: [250, 190, 90],
  }, 250),
  shadow: [1.9, 1.2],
  stride: 1.8,
  size: 2.05,
  blinks: 0,
  // The crystal's light, brightening and dimming every four seconds as it smells for metal.
  glow: (b, a) => [{ p: place(b.head, MOLA_GLINT), r: 1.3, c: [170, 220, 255], a: 0.28 + 0.08 * cyc(a.t, 6) }],
};

/* ---- the dowse ----------------------------------------------------------------------- */

/**
 * A dowse: a round, whiskered burrower that reads the ground for metal with
 * the forked rod that grows from its brow, whose two tips glow; long
 * whiskers, big ears, and spots of ore colour on its back.
 */
const DOWSE_BASE = digger({ high: 1.05, len: 2.6, legs: 0.66, neck: 0.3 });
const DOWSE_SPEC: QuadSpec = { ...DOWSE_BASE, ears: { at: [0.62, -0.1, 0.55], out: 22, back: 8 }, tail: { ...DOWSE_BASE.tail!, at: [0, -1.5, 0.2] } };
const DOWSE_HEAD = { c: [0, 0.3, 0.2] as V3, r: [1.0, 0.92, 0.84] as V3 };
/**
 * The two tips of the rod, in the head's frame: parted forward and back as
 * well as side to side, so the fork is a fork seen from any side rather than
 * one stick side on.
 */
const ROD_TIPS: V3[] = [[0.45, 0.82, 2.2], [-0.45, 0.38, 2.2]];

function dowseBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 10), k = cut(lod, 5, 6);
  const H = DOWSE_HEAD;
  const rod = merge(
    taper(curve([0, 0.2, 0.85], [0, 0.3, 1.3], [0, 0.35, 1.55], 2), 0.09, 0.07, 5, 'horn'),
    ...ROD_TIPS.map((t) => taper(curve([0, 0.35, 1.55], [t[0] * 0.6, (0.35 + t[1]) / 2, 1.8], t, 3), 0.07, 0.04, 5, 'horn')),
    ...ROD_TIPS.map((c) => orb(c, 0.13, 6, 4, 'crystal')),
  );
  // Long whiskers out of the muzzle, fine and pale, and too fine for a line round them. They grow from ahead of the eyes and fan
  // forward as well as out, so side on they spread in front of the face rather than standing in a streak across the eye.
  const whiskers = merge(...[-1, 1].flatMap((s) => [0, 0.12].map((z, q) => taper(curve([s * 0.3, 1.28, z], [s * 0.82, 1.5, z + 0.12], [s * 1.22, 1.66, z + (q ? 0.14 : -0.02)], 3), 0.035, 0.012, 4, 'mark'))));
  // A muzzle standing forward of the eyes, so side on there is a nose line in front of them; the nose on the end of it a piece of
  // its own (below), which no lines are drawn across, as they would be most of it.
  const face = merge(
    orbAlong([0, 1.05, -0.08], [0, 1, -0.2], [0.42, 0.32, 0.4], n, k, 'muzzle'),
    smile([0, 1.34, -0.24], [0, 1, -0.2], 0.22),
  );
  const nose = orbAlong([0, 1.42, 0.02], [0, 1, 0.3], [0.16, 0.11, 0.11], 6, 3, 'nose');
  const spots = paint(([[0.4, -0.2, 0.62], [-0.3, 0.2, 0.66], [0.1, -0.7, 0.58], [-0.5, -0.6, 0.5]] as V3[]).map((c) => disc(c, [c[0] * 0.8, c[1] * 0.4, 0.8], 0.18, 0.14, 6, 'gem')));
  return quadPieces({
    n, k,
    // A round rump drawn in to the tail, rather than a loaf's cut end.
    body: {
      y: [-1.6, -1.4, -1.2, -0.6, 0.1, 0.8, 1.2, 1.4], z: [0.22, 0.24, 0.26, 0.3, 0.3, 0.3, 0.32, 0.35],
      w: [0.2, 0.6, 0.9, 1.15, 1.2, 1.1, 0.8, 0.2], h: [0.2, 0.5, 0.72, 0.86, 0.88, 0.8, 0.62, 0.2], belly: true,
    },
    neck: { w: 0.7, h: 0.62, len: 0.3 },
    head: { c: H.c, r: H.r, face, eye: { dir: [0.72, 0.6, 0.3], size: 0.32, rim: 0.12 }, blush: [[0.78, 0.5, -0.25], 0.18] },
    ear: earMesh(0.75, 0.42, n),
    earTurn: 40,
    tail: [taper([[0, 0, 0], [0, -0.3, 0]], 0.1, 0.08, 5, 'coat'), taper([[0, 0, 0], [0, -0.3, 0]], 0.08, 0.02, 5, 'coat')],
    fore: { upper: [0.25, -0.36, 0.24, 0.18], lower: [0, -0.3, 0.18, 0.15], foot: pawMesh(0.2, n, k, 'mark', 0.12) },
    hind: { upper: [0.25, -0.4, 0.3, 0.2], lower: [0, -0.33, 0.18, 0.15], foot: pawMesh(0.2, n, k, 'mark', 0.12) },
    extras: [
      { key: 'rod', mesh: rod, bone: 'head', bias: 0.25, after: ['head', 'ear0', 'ear1'] },
      { key: 'nose', mesh: nose, bone: 'head', bias: 0.23, after: 'head', hide: [{ c: H.c, r: H.r }], hideIn: 'head', lines: false },
      // Hidden where they are behind the head or the muzzle, which seen from behind they would otherwise be drawn across.
      { key: 'whiskers', mesh: whiskers, bone: 'head', bias: 0.24, after: ['head', 'nose'], rim: false, hide: [{ c: H.c, r: H.r }, { c: [0, 1.05, -0.08], r: [0.42, 0.4, 0.32] }], hideIn: 'head' },
      { key: 'spots', mesh: spots, bone: 'trunk', bias: 0.01, after: 'body' },
    ],
  });
}

export const DOWSE: Kind = {
  bones: quadBonesOf(DOWSE_SPEC, (p, a) => {
    scurry(p, a);
    // Standing, it reads the ground: the head down and still, the rod dipping, then up and a look round.
    if (a.go <= 0) p.neck[0] += 18 * beat(a.t, [2.5, 10.5, 18.5], 2.4);
  }),
  build: dowseBuild,
  palette: (coat, mark) => coatPalette(coat, mark, { horn: [196, 150, 110], crystal: [172, 240, 214], gem: [214, 128, 84], nose: [220, 130, 146] }, 40),
  shadow: [1.7, 1.2],
  stride: 1.8,
  size: 1.55,
  // The rod's tips glow, brighter and dimmer every second, as if it were listening.
  glow: (b, a) => ROD_TIPS.map((c) => ({ p: place(b.head, c), r: 0.9, c: [170, 255, 220] as RGB, a: 0.25 + 0.15 * Math.sin(a.t * Math.PI * 2) })),
};

/* ---- the snout ----------------------------------------------------------------------- */

/**
 * A snout: wrinkled, half blind, and the finest nose on the island, which it
 * wears like a trumpet with a flower at its end, pink petals round its
 * nostrils; sleepy lidded eyes, long soft ears, and folds down its back.
 */
const SNOUT_SPEC: QuadSpec = { ...digger({ high: 1.15, len: 3.4, legs: 0.75, neck: 0.35, graze: 6, nose: 3, bow: 7 }), ears: { at: [0.7, -0.12, 0.42], out: 140, back: 10 } };
const SNOUT_HEAD = { c: [0, 0.2, 0.15] as V3, r: [0.95, 0.9, 0.8] as V3 };
const SNOUT_EYE: V3 = [0.66, 0.6, 0.5];
/** Where the trumpet goes into the head, and where it ends, in the head's frame: the middle of the flower. */
const TRUMPET_ROOT: V3 = [0, 0.7, -0.05];
const BELL: V3 = [0, 2.3, -0.28];

/**
 * How far the trumpet is swung round its root, in degrees, standing: sniffing over the ground from side to side once every four
 * seconds. It is the trumpet that sweeps and not the head, so the face stays where somebody watching it side on can see it.
 */
const trumpetSwing = (a: Anim): number => 25 * Math.sin((a.t * TAU) / 4) * (1 - a.go);

/** A point of the trumpet swung round its root by `deg` degrees, the more the further along it is, so it bends as it swings. */
function swung(p: V3, deg: number): V3 {
  const s = Math.min(1, Math.max(0, (p[1] - TRUMPET_ROOT[1]) / (BELL[1] - TRUMPET_ROOT[1]))) ** 1.5;
  const t = deg * s * DEG, c = Math.cos(t), sn = Math.sin(t);
  const y = p[1] - TRUMPET_ROOT[1];
  return [p[0] * c - y * sn, TRUMPET_ROOT[1] + p[0] * sn + y * c, p[2]];
}

function snoutBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 10), k = cut(lod, 5, 6);
  const H = SNOUT_HEAD;
  // The trumpet: long, sagging a little along its length, wrinkled in bands, and flared at its end into a pink bell; slender, so
  // the flower on its end is the widest thing about it and it is a nose rather than a trunk.
  const line = curve(TRUMPET_ROOT, [0, 1.5, -0.44], [0, 2.18, -0.3], 6);
  const trumpet = tube([...line, BELL], [0.24, 0.21, 0.19, 0.17, 0.16, 0.16, 0.17, 0.3], [0.23, 0.2, 0.18, 0.16, 0.15, 0.15, 0.16, 0.28], n,
    (ring) => (ring >= 6 ? 'petal' : ring % 2 ? 'coatDark' : 'coatLight'));
  // The flower round its nostrils: eight petals opening forward out of the rim of the bell, flat and turned to show their faces.
  // Built from the trumpet's root, on a bone of its own there that swings with the trumpet's end.
  const petals = merge(...Array.from({ length: 8 }, (_, q) => {
    const a = ((q + 0.5) / 8) * TAU, c = Math.cos(a), sn = Math.sin(a);
    const at = (r: number, y: number): V3 => sub([c * r, BELL[1] + y, BELL[2] + sn * r], TRUMPET_ROOT);
    return blade([at(0.24, -0.06), at(0.36, 0.06), at(0.46, 0.18), at(0.52, 0.26)], [0.07, 0.13, 0.11, 0.03], [-c * 0.86, 0.5, -sn * 0.86], { fold: 0.3, thick: 0.04, mat: 'petal' });
  }));
  const bell = sub(BELL, TRUMPET_ROOT);
  const nostrils = paint([1, -1].map((s) => disc(add(bell, [s * 0.1, 0.01, 0.02]), [0, 1, 0], 0.06, 0.09, 6, 'nose')));
  // Sleepy: the top half of each eye under a heavy lid of its coat, painted after the eye so it lies over it, and the lid's edge
  // drawn across the eye in a dark line, sagging a little in the middle.
  const lids = paint([1, -1].flatMap((s) => {
    const { p, n: out } = onEgg(H.c, H.r, [SNOUT_EYE[0] * s, SNOUT_EYE[1], SNOUT_EYE[2]]);
    const u = unit(cross([0, 0, 1], out)), up = cross(out, u);
    const at = (x: number, y: number, o: number): V3 => add(add(p, scale(out, o)), add(scale(u, x), scale(up, y)));
    const edge = (x: number): number => 0.04 - 0.06 * (1 - (x / 0.36) ** 2);
    const xs = Array.from({ length: 7 }, (_, q) => -0.36 + (q / 6) * 0.72);
    return [
      { v: [...Array.from({ length: 9 }, (_, q) => at(Math.cos((q / 8) * Math.PI) * 0.36, 0.04 + Math.sin((q / 8) * Math.PI) * 0.38, 0.05)), ...xs.slice(1, -1).map((x) => at(x, edge(x), 0.05))], m: 'coatDark' as Mat },
      { v: [...xs.map((x) => at(x, edge(x) - 0.035, 0.06)), ...[...xs].reverse().map((x) => at(x, edge(x) + 0.035, 0.06))], m: 'lid' as Mat },
    ];
  }));
  const folds = paint([-1.2, -0.5, 0.2, 0.9].map((y) => disc([0, y, 0.82], [0, 0, 1], 0.9, 0.08, 8, 'coatDark')));
  const pieces = quadPieces({
    n, k,
    body: { y: [-1.9, -1.6, -0.9, 0, 0.9, 1.5, 1.8], z: [0.1, 0.16, 0.2, 0.22, 0.22, 0.25, 0.3], w: [0.2, 0.9, 1.12, 1.16, 1.08, 0.86, 0.25], h: [0.2, 0.66, 0.78, 0.82, 0.78, 0.66, 0.22], belly: true },
    neck: { w: 0.72, h: 0.62, len: 0.35 },
    head: { c: H.c, r: H.r, face: trumpet, eye: { dir: SNOUT_EYE, size: 0.3, rim: 0.08 }, blush: [[0.8, 0.45, -0.3], 0.18] },
    // Long soft ears, hanging down either side of the face and turned out to show their faces: each a flap twisted along its
    // length and cupped, so from no side is it an edge like a stick.
    ear: blade(curve([0, 0, 0], [0, 0.04, 0.5], [0, 0.18, 1.0], 4), [0.15, 0.27, 0.29, 0.22, 0.07], [0, 1, 0], { twist: 0.9, fold: 0.4, thick: 0.08, mat: 'coat', rib: 'inner' }),
    earTurn: 60,
    tail: [taper([[0, 0, 0], [0, -0.35, 0]], 0.14, 0.1, 5, 'coat'), taper([[0, 0, 0], [0, -0.35, 0]], 0.1, 0.02, 5, 'coat')],
    fore: { upper: [0.25, -0.42, 0.28, 0.22], lower: [0, -0.34, 0.22, 0.2], foot: hoofMesh(0.22, 0.12, n, 'pad') },
    hind: { upper: [0.3, -0.45, 0.34, 0.24], lower: [0, -0.38, 0.22, 0.2], foot: hoofMesh(0.22, 0.12, n, 'pad') },
    extras: [
      { key: 'folds', mesh: folds, bone: 'trunk', bias: 0.005, after: 'body' },
      { key: 'lids', mesh: lids, bone: 'head', bias: 0.2, after: 'head', hide: [{ c: H.c, r: H.r }], hideIn: 'head' },
      // The flower goes on over the end of the trumpet with no lines across it, which on petals this small would be all of them;
      // seen from behind, it goes under the head. Standing, its petals open and close a little once a second, sniffing.
      {
        key: 'flower', mesh: merge(petals, nostrils), bone: 'bell', bias: 0.22, after: 'head', front: [0, 1, 0], hide: [{ c: add(bell, [0, -0.06, 0]), r: [0.3, 0.06, 0.28] }], lines: false,
        bent: (v, a) => {
          const k = 1 + 0.14 * (0.5 + 0.5 * Math.sin(a.t * TAU)) * (1 - a.go);
          return v.map((p, i) => (i < petals.v.length ? [bell[0] + (p[0] - bell[0]) * k, p[1], bell[2] + (p[2] - bell[2]) * k] : p));
        },
      },
    ],
  });
  // The trumpet bends as it swings: its corners in the head, the more the further along it they are.
  return pieces.map((pc) => {
    if (pc.key !== 'head') return pc;
    const from = pc.mesh.v.indexOf(trumpet.v[0]), to = from + trumpet.v.length;
    return from < 0 ? pc : { ...pc, bent: (v, a) => {
      const deg = trumpetSwing(a);
      return deg ? v.map((q, i) => (i >= from && i < to ? swung(q, deg) : q)) : [...v];
    } };
  });
}

const snoutBones = quadBonesOf(SNOUT_SPEC, (p, a) => {
  scurry(p, a);
  // Standing, the head looks about only a little and follows the trumpet's sweep a little, so it never turns its face away. (On a
  // neck carried as far forward as this, it is the head's tilt that turns it, and its turn that tilts it.)
  if (a.go <= 0) {
    p.neck[1] = 0.4 * p.neck[1] + 3 * Math.sin((a.t * TAU) / 4);
    p.head[2] *= 0.5;
  }
});

export const SNOUT: Kind = {
  // The flower on the trumpet's end has a bone of its own, at the trumpet's root, swung as far as the trumpet's end is.
  bones: (a) => {
    const b = snoutBones(a);
    b.bell = joint(b.head, TRUMPET_ROOT, 0, 0, trumpetSwing(a));
    return b;
  },
  build: snoutBuild,
  // Its greys a dusty mauve.
  palette: (coat, mark) => coatPalette(coat, mark, { petal: [250, 180, 200], nose: [196, 104, 132], pad: [150, 120, 110] }, 300),
  shadow: [2.1, 1.2],
  stride: 1.7,
  size: 2.1,
};
