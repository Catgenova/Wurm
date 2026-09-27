import {
  beat, clamp, coatPalette, curve, cyc, darker, disc, frac, lerp, lighter, merge, moved, onEgg, orb, orbAlong, paint, pastel, quadBones, quadPose, smile, smooth, taper, TAU, tube,
  type Anim, type Bones, type Disc, type Kind, type Piece, type QuadPose, type QuadSpec,
} from './beasts';
import { blade, cut, earMesh, hoofMesh, pawMesh, quadPieces, type QuadLook } from './beastkit';
import { mesh, place, type Mat, type Mesh, type RGB, type V3 } from './figure';
import { pawed, trot } from './wild-paws';

/**
 * The wild ones and the workers: the rowl, the grubba, the cobbe and the
 * quarra.
 */

/* ---- what they share ----------------------------------------------------------------- */

/**
 * A muzzle, a nose and a mouth for a round face, carried at `z` rather
 * than under the eyes: up at their height, so that side on there
 * is face in front of the eye and not just the curve of the head. `r` is
 * across, up and forward, as `orbAlong` takes it.
 */
function muzzleAt(o: { at: number; z: number; r: V3; nose?: number; mouth?: number; mat?: Mat }, n: number, k: number): Mesh {
  const nose = o.nose ?? 0.14;
  return merge(
    orbAlong([0, o.at, o.z], [0, 1, -0.2], o.r, n, k, o.mat ?? 'muzzle'),
    orbAlong([0, o.at + o.r[2] * 0.9, o.z + o.r[1] * 0.35], [0, 1, 0.3], [nose, nose * 0.7, nose * 0.75], 6, 3, 'nose'),
    smile([0, o.at + o.r[2] * 0.72, o.z - o.r[1] * 0.45], [0, 1, -0.5], o.mouth ?? 0.24),
  );
}

/**
 * `quadPieces`, with each eye left out once the head is turned so far from
 * it that it would be a sliver on the head's far edge: with the eyes set as
 * far round the head as they must be for a clear profile, the far one is
 * nearly edge on three-quarters on, and is painted past the outline there as
 * a line of its colour. It goes while the near side of the head is turned
 * more than about half toward the viewer (`Face.unless`).
 */
function quadWithEyes(o: QuadLook): Piece[] {
  const pieces = quadPieces(o);
  const mats = new Set<Mat>(['eyeWhite', 'eye', 'glint', 'lid', o.head.eye.iris ?? 'eye']);
  const sided = (m: Mesh): Mesh => mesh(m.v, m.f.map((f) => {
    if (!f.decal || !mats.has(f.m)) return f;
    const x = f.i.reduce((s, i) => s + m.v[i][0], 0);
    return { ...f, unless: [x < 0 ? 0.1 : -0.1, 0, 0] as V3 };
  }));
  for (const pc of pieces) {
    if (pc.key !== 'head') continue;
    pc.mesh = sided(pc.mesh);
    if (pc.shut) pc.shut = sided(pc.shut);
  }
  return pieces;
}

/** How far over the ground a leg's sole is, at its toe or its heel, whichever is lower, as `quadBones` stands a body on them. */
const soleOf = (b: Bones, key: string, leg: QuadSpec['fore']): number =>
  Math.min(...[leg.toe?.[0] ?? 0.3, -(leg.toe?.[1] ?? 0.3)].map((y) => place(b[`${key}2`], [0, y, -leg.len[2]])[2]));

/**
 * A kind on four legs, its bones posed from its spec and its own pose laid
 * over that, as `quadBonesOf` has it -- but grazing with all four feet on
 * the ground. The chest bowed to the grass over folded fore legs tips the
 * body up behind, and it would be stood on its fore feet alone with its hind
 * ones in the air; so the fore legs are folded deeper still, as far as it
 * takes for the hind feet to come down to the ground as well. And it nibbles
 * rather than lunges: most of the tug at the grass on every other still is
 * taken back out of the chest and the neck, which on legs this short would
 * otherwise swing the muzzle through the ground and out of it.
 */
function grazing(s: QuadSpec, own: (p: QuadPose, a: Anim) => void): (a: Anim) => Bones {
  return (a) => {
    const p = quadPose(s, a);
    own(p, a);
    if (a.graze <= 0 || a.go >= 1) return quadBones(s, p);
    const tug = a.graze * cyc(a.t, 72) * (0.45 + 0.55 * Math.max(0, cyc(a.t, 8)));
    p.pitch += 1.8 * tug;
    p.head[0] -= 1.8 * tug;
    p.neck[0] -= 5 * tug;
    const folded = (e: number): QuadPose => ({ ...p, legs: p.legs.map((l, i) => (i < 2 ? [l[0], l[1] + e * a.graze, l[2]] : l) as [number, number, number]) });
    const up = (e: number): number => { const b = quadBones(s, folded(e)); return Math.min(soleOf(b, 'hl', s.hind), soleOf(b, 'hr', s.hind)); };
    let lo = 0, hi = 1.4;
    if (up(lo) < 0.02) return quadBones(s, p);
    for (let q = 0; q < 7; q++) {
      const mid = (lo + hi) / 2;
      if (up(mid) > 0.01) lo = mid;
      else hi = mid;
    }
    return quadBones(s, folded(hi));
  };
}

/** A point on a trunk's tube (`QuadLook.body`) cut `n` round, at `y` along it and `t` radians round from its left side over its back, on its facets. */
function onTrunk(B: QuadLook['body'], n: number, y: number, t: number): V3 {
  let q = 0;
  while (q < B.y.length - 2 && y > B.y[q + 1]) q++;
  const f = clamp((y - B.y[q]) / (B.y[q + 1] - B.y[q]));
  const w = lerp(B.w[q], B.w[q + 1], f), h = lerp(B.h[q], B.h[q + 1], f), z = lerp(B.z[q], B.z[q + 1], f);
  const s = (t / TAU) * n - 0.5, j = Math.floor(s), e = s - j;
  const at = (i: number): V3 => { const u = ((i + 0.5) / n) * TAU; return [-Math.cos(u) * w, y, z + Math.sin(u) * h]; };
  const p = at(j), p2 = at(j + 1);
  return [lerp(p[0], p2[0], e), y, lerp(p[2], p2[2], e)];
}

/** A quad's corners wound so it faces along `out`, as a painted shape must be to be seen from that side. */
function facing(q: V3[], out: V3): V3[] {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return nx * out[0] + ny * out[1] + nz * out[2] < 0 ? [...q].reverse() : q;
}

/**
 * A band painted round a trunk at `y`, from `t0` to `t1` radians round it
 * (a quarter turn is the top of the back), laid flat on each facet it
 * crosses, so it never stands off the body's curve as a flat disc does: its
 * half-width `half[0]` over the back going to `half[1]` at its ends, and each
 * side slanting back by `slant` along the body for each radian down from the
 * top.
 */
function band(B: QuadLook['body'], n: number, y: number, t0: number, t1: number, half: [number, number], mat: Mat, slant = 0): Disc[] {
  const cuts = [t0];
  for (let j = Math.ceil((t0 / TAU) * n - 0.5); ((j + 0.5) / n) * TAU < t1; j++) if (((j + 0.5) / n) * TAU > t0) cuts.push(((j + 0.5) / n) * TAU);
  cuts.push(t1);
  const reach = Math.max(Math.abs(t0 - Math.PI / 2), Math.abs(t1 - Math.PI / 2)) || 1;
  const wide = (t: number): number => lerp(half[0], half[1], Math.abs(t - Math.PI / 2) / reach);
  const along = (t: number): number => y - slant * Math.abs(t - Math.PI / 2);
  const out: Disc[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const ta = cuts[i], tb = cuts[i + 1];
    const q = [onTrunk(B, n, along(ta) - wide(ta), ta), onTrunk(B, n, along(tb) - wide(tb), tb), onTrunk(B, n, along(tb) + wide(tb), tb), onTrunk(B, n, along(ta) + wide(ta), ta)];
    const mid = (ta + tb) / 2;
    out.push({ v: facing(q, [-Math.cos(mid), 0, Math.sin(mid)]), m: mat });
  }
  return out;
}

/* ---- the rowl ------------------------------------------------------------------------ */

/**
 * A rowl: a deep-chested hunter that runs the treeline in the half-light.
 * Dusk-violet, striped, with two glowing marks over its eyes, leaves for ear
 * tufts, and a tail that ends in a small light like a firefly's.
 */
const ROWL_SPEC = { ...pawed({ high: 2.1, len: 3.4, legs: 1.5, neck: 0.55, lean: 40, swing: [26, 46], ears: [16, 4], tail: [0.55, -30, 28] }), graze: 55, nose: 8, bow: 20 };
const ROWL_HEAD = { c: [0, 0.3, 0.2] as V3, r: [1.05, 0.95, 0.88] as V3 };
/** Its trunk: a rump rounded off behind, a waist a little tucked up, and a deep chest. */
const ROWL_BODY: QuadLook['body'] = {
  y: [-2.12, -1.98, -1.7, -1.0, 0, 0.9, 1.55, 1.85, 2.0], z: [0.16, 0.14, 0.13, 0.16, 0.12, 0.12, 0.24, 0.3, 0.34],
  w: [0.3, 0.64, 0.86, 0.9, 0.94, 1.05, 1.0, 0.8, 0.36], h: [0.3, 0.58, 0.76, 0.72, 0.8, 0.92, 0.86, 0.7, 0.34], belly: true,
};
/** Where the glowing marks over its eyes are, on the head's egg: brow dashes above the inner corner of each eye. */
const ROWL_BROW = onEgg(ROWL_HEAD.c, ROWL_HEAD.r, [0.42, 0.55, 0.75]);

function rowlBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 10), k = cut(lod, 5, 6);
  const H = ROWL_HEAD;
  const face = merge(
    muzzleAt({ at: 1.0, z: 0.04, r: [0.5, 0.4, 0.46], nose: 0.13 }, n, k),
    // The marks over its eyes, which glow in the half-light: a dash on each brow, slanting up and out.
    paint([1, -1].map((s) => disc([s * ROWL_BROW.p[0], ROWL_BROW.p[1], ROWL_BROW.p[2]], [s * ROWL_BROW.n[0], ROWL_BROW.n[1], ROWL_BROW.n[2]], 0.2, 0.07, 6, 'flame', { lit: true, spin: -0.35 * s }))),
  );
  // Tabby stripes over the back and down each flank, flat on the body.
  const stripes = paint([-1.5, -0.9, -0.3, 0.3].flatMap((y) => band(ROWL_BODY, n, y, -0.35, Math.PI + 0.35, [0.12, 0.03], 'coatDark', 0.12)));
  // A leaf for a tuft at the tip of each ear, and a smaller one behind it.
  const ear = merge(
    earMesh(0.62, 0.42, n, { point: true }),
    blade(curve([0, -0.02, 0.44], [0.04, 0.0, 0.72], [0.1, -0.12, 0.98], 3), [0.04, 0.16, 0.13, 0.02], [0.5, 1, 0.1], { twist: 0.6, fold: 0.26, mat: 'leaf', rib: 'leafDark' }),
    blade(curve([0.02, -0.06, 0.4], [0.1, -0.2, 0.6], [0.12, -0.42, 0.72], 3), [0.03, 0.12, 0.1, 0.02], [1, 0.1, 0.3], { twist: -0.4, fold: 0.26, mat: 'leaf', rib: 'leafDark' }),
  );
  const tail = [
    taper([[0, 0, 0], [0, -0.55, 0]], 0.2, 0.17, 6, 'coat'),
    taper([[0, 0, 0], [0, -0.55, 0]], 0.17, 0.15, 6, 'coatDark'),
    merge(taper([[0, 0, 0], [0, -0.4, 0]], 0.15, 0.12, 6, 'coat'), orb([0, -0.52, 0], 0.18, 6, 4, 'crystal')),
  ];
  const pieces = quadWithEyes({
    n, k,
    body: ROWL_BODY,
    neck: { w: 0.72, h: 0.7, len: 0.55 },
    head: { c: H.c, r: H.r, face, eye: { dir: [0.76, 0.52, 0.3], size: 0.3, iris: 'bloom', pupil: 0.55, rim: 0.08 }, blush: [[0.78, 0.5, -0.25], 0.18] },
    ear,
    earTurn: 50,
    tail,
    fore: { upper: [0.3, -0.8, 0.34, 0.26], lower: [0, -0.7, 0.24, 0.22], foot: pawMesh(0.26, n, k, 'mark') },
    hind: { upper: [0.35, -0.85, 0.42, 0.28], lower: [0, -0.85, 0.24, 0.22], foot: pawMesh(0.26, n, k, 'mark') },
    extras: [{ key: 'stripes', mesh: stripes, bone: 'trunk', bias: 0.005, after: 'body', breathes: { c: [0, 0, 0], k: 0.05 } }],
  });
  // The back arched and let out through the bound (`rowlFlex`), stripes and all.
  for (const pc of pieces) if (pc.key === 'body' || pc.key === 'stripes') pc.bent = rowlFlex;
  return pieces;
}

/**
 * A rowl's spine through its bound: arched as its hind legs come up under
 * it, and let out long as it stretches through the air, the middle of its
 * back rising and falling between its shoulders and its hips.
 */
function rowlFlex(v: readonly V3[], a: Anim): V3[] {
  const g = a.go * smooth(a.gait);
  if (g <= 0) return v as V3[];
  const arch = g * (0.1 + 0.28 * Math.cos(TAU * (frac(a.u) - 0.87)));
  return v.map((p) => [p[0], p[1], p[2] + arch * Math.max(0, 1 - (p[1] / 2.05) ** 2)] as V3);
}

/**
 * A rowl's run: a bound, as a cat runs, not the trot the others break
 * into. The hind feet come down together and drive, the body goes out long
 * through the air with the fore legs reaching, the fore feet come down one
 * after the other and it rocks over them, and the hind legs swing up under
 * its chest to come down again ahead of where they left. The head is held
 * level through it all, on whatever it is running down.
 */
function rowlBound(p: QuadPose, a: Anim): void {
  const g = a.go * smooth(a.gait);
  if (g <= 0) return;
  const w = frac(a.u);
  const bump = (x: number, x0: number, x1: number): number => (x > x0 && x < x1 ? Math.sin((Math.PI * (x - x0)) / (x1 - x0)) : 0);
  // A leg through a bound, as `step` has a leg through a trot but for its time off the ground: it trails out behind first, then
  // swings through folded (between `fold`'s two moments of its time up), and reaches out ahead before it comes down. Down for three
  // tenths of the stride, sweeping `amp` either way, `u` into it counted from when it comes down.
  const leg = (u: number, amp: number, trail: number, reach: number, fold: [number, number]): [number, number, number] => {
    const q = frac(u), duty = 0.3;
    if (q < duty) return [amp * (1 - (2 * q) / duty), 0, 0];
    const t = (q - duty) / (1 - duty);
    return [-amp + 2 * amp * smooth(t) - trail * bump(t, 0, 0.35) + reach * bump(t, 0.6, 1), 1.3 * bump(t, fold[0], fold[1]) ** 2, t];
  };
  // When each foot comes down -- fore left, fore right, hind left, hind right -- and how far it sweeps while it is down, the shorter
  // fore legs a little further, so that fore and hind carry it along the ground at the same pace. The fore legs reach far ahead
  // while it is stretched out in the air; the hind legs trail out behind then, and come up under its chest while it is gathered.
  const fore: [number, number] = [0.05, 0.72], hind: [number, number] = [0.2, 1.05];
  const legs = [leg(a.u - 0.44, 32, 4, 24, fore), leg(a.u - 0.47, 32, 4, 24, fore), leg(a.u, 28, 20, 16, hind), leg(a.u - 0.03, 28, 20, 16, hind)];
  p.legs = p.legs.map((l, i) => [lerp(l[0], legs[i][0], g), lerp(l[1], legs[i][1], g), lerp(l[2], legs[i][2], g)] as [number, number, number]);
  // Nose up while the hind legs drive, down while the fore feet take it, and turning from one to the other in the air, so that
  // a foot on the ground is only carried back by its own leg.
  const turn = (w0: number, w1: number): number => smooth((w - w0) / (w1 - w0));
  const rock = 7 * (w < 0.5 ? 1 - 2 * turn(0.33, 0.44) : -1 + 2 * turn(0.77, 1));
  p.pitch = lerp(p.pitch, rock, g);
  p.head[0] = lerp(p.head[0], -rock - 2, g);
  // In the air twice a stride: stretched out after the drive, and gathered after the fore feet push off.
  p.lift = lerp(p.lift, 0.3 * bump(w, 0.33, 0.44) + 0.5 * bump(w, 0.77, 1), g);
  p.squash = lerp(p.squash, -0.04 * Math.max(0, Math.sin(TAU * (w - 0.25))), g);
  p.roll *= 1 - g;
  // The tail streams out behind, and rises and falls a beat behind the back.
  p.tail[0] = lerp(p.tail[0], 32 - 10 * Math.cos(TAU * (w - 0.1)), g);
  p.tail[1] = lerp(p.tail[1], 8 * Math.sin(TAU * w), g);
  p.tail[2] = lerp(p.tail[2], -18, g);
}

export const ROWL: Kind = {
  bones: grazing(ROWL_SPEC, (p, a) => {
    trot(p, a);
    // The tail hung low, its tip curled up, and swung out to one side, so seen head on the light at its tip is beside the body and not
    // stood up over the head.
    p.tail[1] += 50;
    // Low and level at a run, a stretch now and then standing.
    p.neck[0] += 14 * a.gait * a.go;
    const stretch = a.go > 0 ? 0 : beat(a.t, [11.5], 1.8);
    p.pitch -= 10 * stretch;
    p.head[0] += 10 * stretch;
    p.legs[0][0] += 25 * stretch;
    p.legs[1][0] += 25 * stretch;
    rowlBound(p, a);
  }),
  build: rowlBuild,
  // Its coat lifted a little toward the pale, so even its darkest stands off the grass it hunts through.
  palette: (coat, mark) => coatPalette(lighter(coat, 0.22), mark, { crystal: [252, 230, 130], flame: [246, 204, 100], bloom: [248, 196, 90], leaf: [150, 204, 104], leafDark: [104, 160, 86] }, 250),
  shadow: [2.4, 1.1],
  stride: 0.9,
  size: 1.56,
  leaps: [false, true],
  glow: (b) => {
    const t = b.tail2, h = b.head;
    const out: Array<{ p: V3; r: number; c: RGB; a: number }> = [];
    if (t) out.push({ p: place(t, [0, -0.52, 0]), r: 1.5, c: [255, 240, 150], a: 0.35 });
    if (h) for (const s of [1, -1]) out.push({ p: place(h, [s * ROWL_BROW.p[0], ROWL_BROW.p[1], ROWL_BROW.p[2] + 0.03]), r: 0.6, c: [255, 214, 120], a: 0.3 });
    return out;
  },
};

/* ---- the grubba ---------------------------------------------------------------------- */

/**
 * A grubba: a squat, hump-shouldered rooter. Its hump is an old stump it has
 * grown into, bark and all, with a toadstool on it; two small tusks like
 * mattock heads curl up beside its snout.
 */
const GRUBBA_SPEC = { ...pawed({ high: 1.55, len: 3.0, legs: 1.0, neck: 0.4, lean: 70, swing: [20, 36], ears: [40, 20], tail: [0.3, -30, -10] }), graze: 22, nose: 8, bow: 14 };
const GRUBBA_HEAD = { c: [0, 0.35, 0.05] as V3, r: [1.0, 0.95, 0.85] as V3 };
/** Where the stump stands on its back, how tall it is over the back, and how far its cut top is tipped back. */
const STUMP = { at: [0, 0.45, 1.05] as V3, high: 0.62, tip: 8 };

function grubbaBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 10), k = cut(lod, 5, 6);
  const H = GRUBBA_HEAD;
  const snout = merge(
    // A long pig's snout carried at the eyes' height, so side on there is snout in front of the eye; a pink disc on its end.
    taper([[0, 0.8, -0.04], [0, 1.36, -0.08]], 0.44, 0.4, n, 'muzzle'),
    orbAlong([0, 1.38, -0.08], [0, 1, 0], [0.38, 0.34, 0.1], n, 3, 'inner'),
    paint([1, -1].map((s) => disc([s * 0.14, 1.49, -0.06], [0, 1, 0], 0.07, 0.1, 6, 'nose'))),
    smile([0, 1.3, -0.44], [0, 1, -0.5], 0.26),
    // Tusks: stout, curling up the snout's sides, each ending in a flat blade across it like a mattock's head.
    ...[1, -1].map((s) => merge(
      taper(curve([s * 0.3, 1.02, -0.36], [s * 0.62, 1.12, -0.3], [s * 0.66, 1.2, 0.14], 3), 0.13, 0.08, 5, 'tooth'),
      orbAlong([s * 0.66, 1.21, 0.2], [s * 0.3, 0.3, 1], [0.16, 0.06, 0.1], 6, 3, 'tooth'),
    )),
  );
  // The stump: bark in ridges down its sides, rooted onto the back, its top cut and tipped back, with the rings of its years on it.
  const S = STUMP, top = S.high;
  const stump = moved(merge(
    tube([[0, 0, -0.25], [0, 0, 0.05], [0, 0, top * 0.6], [0, 0, top]], [0.78, 0.66, 0.6, 0.56], [0.7, 0.6, 0.54, 0.5], n,
      (ring, j) => (ring === 3 ? 'mark' : j % 2 ? 'bark' : 'stoneDark')),
    paint([[0.46, 'stoneDark'], [0.41, 'mark'], [0.26, 'stoneDark'], [0.21, 'mark'], [0.06, 'stoneDark']].map(([r, m], q) =>
      disc([0, 0, top + 0.005 + q * 0.004], [0, 0, 1], r as number, (r as number) * 0.9, 10, m as Mat))),
    ...[0.5, 2.2, 3.6, 5.1].map((t) => taper(curve([Math.cos(t) * 0.5, Math.sin(t) * 0.46, 0.08], [Math.cos(t) * 0.82, Math.sin(t) * 0.74, -0.02], [Math.cos(t) * 1.02, Math.sin(t) * 0.92, -0.26], 2), 0.18, 0.04, 5, 'bark')),
  ), S.at, 0, -S.tip);
  // The toadstool on it: a piece of its own, so the stump's cut top is never painted over it.
  const toadstool = moved(merge(
    taper([[0.24, 0.1, top - 0.05], [0.26, 0.12, top + 0.26]], 0.07, 0.06, 5, 'spot'),
    orbAlong([0.26, 0.12, top + 0.3], [0.1, 0, 1], [0.26, 0.26, 0.14], n, 3, 'cap'),
    paint([[0.3, 0.02], [0.16, 0.22], [0.36, 0.24]].map(([x, y]) => disc([x + 0.02, y + 0.06, top + 0.43], [0.05, 0.05, 1], 0.05, 0.05, 5, 'spot'))),
  ), S.at, 0, -S.tip);
  return quadWithEyes({
    n, k,
    body: { y: [-1.75, -1.5, -0.8, 0, 0.8, 1.4, 1.7], z: [0.1, 0.18, 0.25, 0.3, 0.4, 0.45, 0.4], w: [0.25, 0.95, 1.15, 1.2, 1.25, 1.1, 0.3], h: [0.25, 0.78, 0.9, 0.95, 1.02, 0.92, 0.3], belly: true },
    neck: { w: 0.85, h: 0.8, len: 0.4 },
    head: { c: H.c, r: H.r, face: snout, eye: { dir: [0.78, 0.5, 0.26], size: 0.32, rim: 0.12 }, blush: [[0.8, 0.46, -0.28], 0.2] },
    ear: earMesh(0.45, 0.34, n, { tilt: 0.25 }),
    tail: [merge(taper(curve([0, 0, 0], [0, -0.2, 0.1], [0, -0.3, 0.3], 2), 0.07, 0.05, 5, 'coat'))],
    fore: { upper: [0.3, -0.52, 0.36, 0.3], lower: [0, -0.46, 0.3, 0.28], foot: pawMesh(0.28, n, k, 'coatDark') },
    hind: { upper: [0.3, -0.56, 0.4, 0.3], lower: [0, -0.56, 0.28, 0.26], foot: pawMesh(0.26, n, k, 'coatDark') },
    extras: [
      { key: 'hump', mesh: stump, bone: 'trunk', bias: 0.04, after: 'body' },
      { key: 'toadstool', mesh: toadstool, bone: 'trunk', bias: 0.05, after: 'hump' },
    ],
  });
}

export const GRUBBA: Kind = {
  bones: grazing(GRUBBA_SPEC, (p, a) => {
    trot(p, a);
    // Rooting: the snout down and shoving, the rump up.
    if (a.go <= 0) {
      const root = beat(a.t, [6.4, 18.8], 1.6);
      p.neck[0] += 25 * root * (0.8 + 0.2 * Math.sin(a.t * Math.PI * 6));
      p.head[0] -= 15 * root;
      p.pitch -= 6 * root;
    }
  }),
  build: grubbaBuild,
  // Its coat lifted a little toward the pale, so it stands off the grass and the brown stump stands off it.
  palette: (coat, mark) => coatPalette(lighter(coat, 0.18), mark, { bark: [150, 112, 86], stoneDark: [112, 84, 66], tooth: [250, 244, 228], inner: [238, 168, 176], nose: [150, 80, 96], cap: [224, 92, 84], spot: [252, 246, 234] }, 26),
  shadow: [2.1, 1.4],
  stride: 1.1,
  size: 1.85,
};

/* ---- the cobbe ----------------------------------------------------------------------- */

/**
 * A cobbe: a squat, hard-headed hauler with shoulders like a wall. Its back
 * is a shell laid like a wall too -- courses of brick with pale mortar between
 * -- and its brow is a keystone.
 */
const COBBE_PAWS = pawed({ high: 1.5, len: 2.6, legs: 0.9, neck: 0.4, lean: 65, swing: [18, 30], ears: [60, 20], tail: [0.25, -20, -10] });
const COBBE_SPEC = { ...COBBE_PAWS, hind: { ...COBBE_PAWS.hind, rest: [10, -20, 0] as V3 }, graze: 40, nose: 8, bow: 14 };
const COBBE_HEAD = { c: [0, 0.35, 0.1] as V3, r: [0.95, 0.9, 0.82] as V3 };
/** The shell's courses, bottom to top: where each band starts up the dome, brick or mortar; the dome's height, and how wide and long it is at the bottom. */
const SHELL = { z: [0, 0.24, 0.29, 0.51, 0.56, 0.76, 0.81, 1.0], high: 1.0, w: 1.55, d: 1.85 };

function cobbeBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 10), k = cut(lod, 5, 6);
  const H = COBBE_HEAD;
  // The shell: a dome in courses of brick, a thin course of pale mortar between each two.
  const round = lod ? 12 : 10;
  const across = (z: number): number => Math.cos((z / SHELL.high) * 1.25);
  const dome = tube(SHELL.z.map((z) => [0, 0, 0.1 + z] as V3), SHELL.z.map((z) => SHELL.w * across(z)), SHELL.z.map((z) => SHELL.d * across(z)), round,
    (ring) => (ring % 2 ? 'stone' : 'shell'), { up: [0, 1, 0] });
  // Where on the dome's facets a point is, `z` up it and `t` radians round.
  const onDome = (z: number, t: number): V3 => {
    const f = across(z), s = (t / TAU) * round - 0.5, j = Math.floor(s), e = s - j;
    const at = (i: number): V3 => { const u = ((i + 0.5) / round) * TAU; return [Math.cos(u) * SHELL.w * f, Math.sin(u) * SHELL.d * f, 0.1 + z]; };
    const a = at(j), b = at(j + 1);
    return [lerp(a[0], b[0], e), lerp(a[1], b[1], e), 0.1 + z];
  };
  // The upright joints between the bricks: seven to a course, each course half a brick round from the one under it.
  const joints = paint([0, 2, 4].flatMap((c) => Array.from({ length: 7 }, (_, q) => {
    const t = ((q + (c % 4 ? 0.5 : 0)) / 7) * TAU, z0 = SHELL.z[c] + 0.02, z1 = SHELL.z[c + 1] - 0.02;
    const half = 0.035 / (SHELL.w * across((z0 + z1) / 2));
    return { v: facing([onDome(z0, t - half), onDome(z0, t + half), onDome(z1, t + half), onDome(z1, t - half)], [Math.cos(t), Math.sin(t), 0.3]), m: 'stone' as Mat };
  })));
  const shell = merge(dome, joints, tube([[0, 0, 0.05], [0, 0, 0.14]], [1.6], [1.9], round, 'spot', { up: [0, 1, 0] }));
  // The keystone: a wedge of darker brick on the brow, wider at the top, standing up out of the head's outline.
  const keystone = tube([[0, 0.5, 0.62], [0, 0.52, 1.12]], [0.19, 0.3], [0.17, 0.17], 4, 'shellDark');
  return quadWithEyes({
    n, k,
    body: { y: [-1.5, -1.2, -0.6, 0, 0.6, 1.2, 1.5], z: [0.1, 0.1, 0.1, 0.1, 0.1, 0.12, 0.15], w: [0.3, 1.2, 1.4, 1.45, 1.4, 1.2, 0.35], h: [0.3, 0.6, 0.66, 0.7, 0.66, 0.6, 0.3], belly: true },
    neck: { w: 0.7, h: 0.65, len: 0.4 },
    head: { c: H.c, r: H.r, face: merge(muzzleAt({ at: 0.98, z: 0.02, r: [0.48, 0.38, 0.42] }, n, k), keystone), eye: { dir: [0.78, 0.5, 0.22], size: 0.3, rim: 0.12 }, blush: [[0.78, 0.5, -0.28], 0.2] },
    ear: earMesh(0.35, 0.3, n),
    tail: [taper([[0, 0, 0], [0, -0.28, 0]], 0.12, 0.03, 5, 'coat')],
    fore: { upper: [0.3, -0.48, 0.4, 0.36], lower: [0, -0.42, 0.36, 0.34], foot: hoofMesh(0.38, 0.14, n, 'coatDark') },
    hind: { upper: [0.3, -0.5, 0.42, 0.36], lower: [0, -0.5, 0.36, 0.34], foot: hoofMesh(0.38, 0.14, n, 'coatDark') },
    extras: [{ key: 'shell', mesh: moved(shell, [0, 0, 0.2]), bone: 'trunk', bias: 0.04, after: ['body', 'fl0', 'fr0', 'hl0', 'hr0'] }],
    breath: 0.03,
  });
}

export const COBBE: Kind = {
  bones: grazing(COBBE_SPEC, (p, a) => {
    trot(p, a);
    p.roll += a.go * 4 * Math.sin((a.u % 1) * TAU);
    if (a.go > 0) return;
    // A nod of that keystone of a head, as if agreeing with something; and now and then a shuffle of the shell, settling it.
    p.head[0] -= 20 * beat(a.t, [5.5, 13.2, 19.8], 1.0);
    p.roll += 5 * beat(a.t, [9.1, 16.4], 1.2) * Math.sin(a.t * TAU * 2.5);
  }),
  build: cobbeBuild,
  palette: (coat, mark) => coatPalette(lighter(coat, 0.12), mark, { shell: [198, 110, 86], shellDark: [170, 86, 68], stone: [240, 228, 210], spot: [246, 236, 222] }, 30),
  shadow: [1.9, 1.7],
  stride: 1.05,
  size: 2.3,
};

/* ---- the quarra ---------------------------------------------------------------------- */

/**
 * A quarra: a low, broad creature with a jaw like a chisel and a hide the
 * colour of the rock it sits on, laid in plates; a cluster of crystal has
 * grown out of the stone on its back.
 */
const QUARRA_SPEC = { ...pawed({ high: 1.25, len: 3.2, legs: 0.8, neck: 0.35, lean: 75, swing: [20, 34], ears: [50, 20], tail: [0.4, -18, -4] }), graze: 15, nose: 6, bow: 10 };
const QUARRA_HEAD = { c: [0, 0.4, 0.05] as V3, r: [1.0, 0.95, 0.8] as V3 };
/** When in its loop, standing, the crystal on its back brightens, and how long for. */
const QUARRA_PULSE = { at: [2.5, 10.5, 18.5], len: 1.1 };

function quarraBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 10), k = cut(lod, 5, 6);
  const H = QUARRA_HEAD;
  // Plates of stone down the back and out over the flanks, each a flattened ball tipped forward, overlapping the next like tiles,
  // dark and pale by turns.
  const plates = merge(...[-1.4, -0.8, -0.2, 0.4, 1.0].map((y, q) =>
    orbAlong([0, y, 0.72 - Math.abs(y) * 0.08], [0, 0.8, 1], [1.15 - Math.abs(y) * 0.12, 0.52, 0.22], n, 3, q % 2 ? 'stone' : 'stoneDark')));
  const crystals = merge(
    taper([[0, -0.4, 0.8], [0.05, -0.35, 1.55]], 0.22, 0.0, 6, 'crystal'),
    taper([[0.25, -0.2, 0.78], [0.5, -0.1, 1.25]], 0.16, 0.0, 6, 'crystalDark'),
    taper([[-0.25, -0.6, 0.76], [-0.5, -0.75, 1.2]], 0.15, 0.0, 6, 'crystal'),
  );
  // The chisel of a jaw: broad and flat, carried up at the eyes' height, with two big square front teeth hanging under its lip.
  const jaw = merge(
    tube([[0, 0.9, -0.14], [0, 1.42, -0.18]], [0.56, 0.5], [0.32, 0.28], n, 'muzzle'),
    ...[1, -1].map((s) => tube([[s * 0.11, 1.38, -0.36], [s * 0.11, 1.4, -0.58]], 0.1, 0.06, 4, 'tooth')),
    orbAlong([0, 1.43, 0.02], [0, 1, 0.3], [0.14, 0.09, 0.1], 5, 3, 'nose'),
    smile([0, 1.44, -0.28], [0, 1, -0.2], 0.3),
  );
  // The tail plated as the back is, each link a flattened plate over the next, and blunt at the end: it drags.
  const plate = (w0: number, w1: number, len: number, m: Mat): Mesh => taper([[0, 0.05, 0.02], [0, -len, 0]], w0, w1, 6, m, 0.5);
  const tail = [plate(0.36, 0.3, 0.42, 'stoneDark'), plate(0.3, 0.22, 0.42, 'stone'), merge(plate(0.22, 0.16, 0.34, 'stoneDark'), orb([0, -0.36, 0], [0.16, 0.14, 0.09], 6, 3, 'stoneDark'))];
  return quadWithEyes({
    n, k,
    body: { y: [-1.75, -1.5, -0.8, 0, 0.8, 1.4, 1.7], z: [0.1, 0.12, 0.15, 0.15, 0.15, 0.15, 0.15], w: [0.25, 1.05, 1.25, 1.3, 1.25, 1.1, 0.3], h: [0.25, 0.62, 0.7, 0.72, 0.7, 0.64, 0.25], belly: true },
    neck: { w: 0.85, h: 0.7, len: 0.35 },
    head: { c: H.c, r: H.r, face: jaw, eye: { dir: [0.8, 0.5, 0.3], size: 0.32, rim: 0.12 }, blush: [[0.8, 0.48, -0.26], 0.2] },
    ear: earMesh(0.32, 0.3, n),
    tail,
    fore: { upper: [0.3, -0.42, 0.36, 0.3], lower: [0, -0.37, 0.3, 0.28], foot: pawMesh(0.3, n, k, 'stoneDark') },
    hind: { upper: [0.3, -0.45, 0.38, 0.3], lower: [0, -0.45, 0.3, 0.28], foot: pawMesh(0.3, n, k, 'stoneDark') },
    extras: [
      { key: 'plates', mesh: plates, bone: 'trunk', bias: 0.03, after: 'body' },
      { key: 'crystals', mesh: crystals, bone: 'trunk', bias: 0.05, after: ['body', 'plates'] },
    ],
  });
}

export const QUARRA: Kind = {
  bones: grazing(QUARRA_SPEC, (p, a) => {
    trot(p, a);
    if (a.go > 0) return;
    // Chewing stone: the jaw working, and now and then a satisfied settle, sinking down onto its legs and tipping its nose up.
    const settle = beat(a.t, [6.2, 14.8], 1.6);
    p.head[0] += 3 * Math.sin(a.t * Math.PI * 4) + 5 * settle;
    p.squash += 0.06 * settle;
    p.pitch += 5 * settle * (1 - a.graze);
  }),
  build: quarraBuild,
  palette: (coat, mark) => {
    const stone = pastel(coat, 200);
    return coatPalette(coat, mark, { stone: lighter(stone, 0.35), stoneDark: darker(stone, 0.25), crystal: [210, 186, 246], crystalDark: [170, 150, 226], tooth: [250, 246, 236], nose: [150, 110, 120] }, 200);
  },
  shadow: [2.1, 1.5],
  stride: 1.2,
  size: 1.9,
  // The crystal's light, brightening three times a loop while it stands.
  glow: (b, a) => [{ p: place(b.trunk ?? b.body, [0, -0.4, 1.3]), r: 1.3, c: [200, 170, 255], a: 0.22 + 0.28 * (a.go > 0 ? 0 : beat(a.t, QUARRA_PULSE.at, QUARRA_PULSE.len)) }],
};
