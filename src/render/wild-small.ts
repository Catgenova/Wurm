import {
  add, beat, blush, coatPalette, cross, curve, cyc, darker, DEG, disc, eyes, frac, lighter, merge, mirrored, mix, moved, onEgg, orb, orbAlong, paint, pastel,
  quadBones, quadBonesOf, quadPose, smile, sub, taper, TAU, tube, unit, type Anim, type Bones, type Kind, type LegSpec, type Piece, type QuadPose, type QuadSpec,
} from './beasts';
import { mesh, place, type RGB, type V3, type Xf } from './figure';
import { blade, clamp01, cut, legPieces, pawMesh, smooth01, under } from './beastkit';

/** The small wildermon: the rabba and the seavic, which hop, and the woola. */

export const scale3 = (v: V3, k: number): V3 => [v[0] * k, v[1] * k, v[2] * k];
/** A bump from nought up to one at `c` and back, `r` either side of it. */
const bump = (x: number, c: number, r: number): number => Math.max(0, 1 - Math.abs(x - c) / r);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/* ---- legs set by where the feet go ------------------------------------------------ */

/**
 * The swing and the fold (`QuadPose.legs`) that put a leg's ankle at a point
 * in the body's own frame, `y` forward and `z` up: the knee forward of the
 * line from hip to ankle, as a hind leg bends, or with `elbow` behind it, as
 * a fore leg does. A point out of reach gets the leg straight at it.
 */
function legTo(s: LegSpec, y: number, z: number, elbow = false): [number, number] {
  const rest = s.rest ?? [0, 0, 0], folds = s.fold ?? [45, 75];
  const L0 = s.len[0], L1 = s.len[1];
  const dy = y - s.at[1], dz = z - s.at[2];
  const d = Math.min(L0 + L1 - 1e-3, Math.max(Math.abs(L0 - L1) + 1e-3, Math.hypot(dy, dz)));
  const knee = Math.acos(Math.max(-1, Math.min(1, (L0 * L0 + d * d - L1 * L1) / (2 * L0 * d))));
  const a1 = Math.atan2(dy, -dz) + (elbow ? -knee : knee);
  const ky = s.at[1] + L0 * Math.sin(a1), kz = s.at[2] - L0 * Math.cos(a1);
  let a2 = Math.atan2(y - ky, kz - z) - a1;
  while (a2 > Math.PI) a2 -= TAU;
  while (a2 < -Math.PI) a2 += TAU;
  const sw = a1 / DEG - rest[0];
  return [sw, (rest[1] - a2 / DEG) / lerp(folds[0], folds[1], Math.min(1, Math.abs(sw) / 40))];
}

/**
 * A stride of something that goes in leaps, laid out as where its body is
 * and where each foot is over the ground, a stride running from the hind
 * feet coming down: they push off at `hindOff`, all four are in the air
 * until the fore paws come down at `foreOn`, and the fore paws go up again
 * at `foreOff` of the next, once the hind feet are down under the body.
 * Every foot on the ground goes back under the body at the one speed, so
 * that a body carried over the ground in the air (`Kind.leaps`) leaves each
 * where it was put; a foot in the air only ever comes forward.
 */
interface LeapPlan {
  hindOff: number;
  foreOn: number;
  foreOff: number;
  /** Where the hind feet and the fore paws come down, ahead of the body's bone, and how far back under it the fore paws go while down. */
  hindAt: number;
  foreAt: number;
  sweep: number;
  /** The body's height: crouched as the hind feet land, at take-off, and as the fore paws land; the flight's rise over the line between, and the landing's give. */
  low: number;
  up: number;
  land: number;
  arc: number;
  dip: number;
  /** Its pitch, nose up, crouched, at take-off and as the fore paws land. */
  pitch: [number, number, number];
  /** How far a foot in the air is drawn up toward the body, fore and hind; how far its toe hangs, fore and hind (degrees). */
  tuck: [number, number];
  hang: [number, number];
  /** How far back of where they left the ground, and up, the hind feet are left as the body goes up and on off them. */
  trail: [number, number];
  /** How far the right foot of each pair comes after the left, fore and hind. */
  lag: [number, number];
}

/** A walk's plan and a run's mixed, for a gait between. */
function planAt(walk: LeapPlan, run: LeapPlan, g: number): LeapPlan {
  if (g <= 0) return walk;
  if (g >= 1) return run;
  const two = (a: [number, number], b: [number, number]): [number, number] => [lerp(a[0], b[0], g), lerp(a[1], b[1], g)];
  return {
    hindOff: lerp(walk.hindOff, run.hindOff, g), foreOn: lerp(walk.foreOn, run.foreOn, g), foreOff: lerp(walk.foreOff, run.foreOff, g),
    hindAt: lerp(walk.hindAt, run.hindAt, g), foreAt: lerp(walk.foreAt, run.foreAt, g), sweep: lerp(walk.sweep, run.sweep, g),
    low: lerp(walk.low, run.low, g), up: lerp(walk.up, run.up, g), land: lerp(walk.land, run.land, g), arc: lerp(walk.arc, run.arc, g), dip: lerp(walk.dip, run.dip, g),
    pitch: [lerp(walk.pitch[0], run.pitch[0], g), lerp(walk.pitch[1], run.pitch[1], g), lerp(walk.pitch[2], run.pitch[2], g)],
    tuck: two(walk.tuck, run.tuck), hang: two(walk.hang, run.hang), trail: two(walk.trail, run.trail), lag: two(walk.lag, run.lag),
  };
}

/** The body's height over the ground `x` of the way through a leaper's stride. */
function leapHeight(L: LeapPlan, x: number): number {
  const w = frac(x);
  if (w < L.hindOff) { const s = w / L.hindOff; return lerp(L.low, L.up, s * s); }
  if (w < L.foreOn) { const s = (w - L.hindOff) / (L.foreOn - L.hindOff); return lerp(L.up, L.land, s) + L.arc * Math.sin(s * Math.PI); }
  const s = (w - L.foreOn) / (1 - L.foreOn);
  return lerp(L.land, L.low, smooth01(s)) - L.dip * Math.sin(Math.PI * clamp01(s * 1.6));
}

/** Its pitch, nose up, in degrees. */
function leapPitch(L: LeapPlan, x: number): number {
  const w = frac(x);
  if (w < L.hindOff) return lerp(L.pitch[0], L.pitch[1], smooth01(w / L.hindOff));
  if (w < L.foreOn) return lerp(L.pitch[1], L.pitch[2], smooth01((w - L.hindOff) / (L.foreOn - L.hindOff)));
  return lerp(L.pitch[2], L.pitch[0], smooth01((w - L.foreOn) / (1 - L.foreOn)));
}

/**
 * A leaper `w` of the way through its stride, laid over the pose by `g`: the
 * body at its height and pitch, and every leg set by where its foot is to be
 * (`legTo`), the lowest sole what the body is stood on. Returns the body's
 * height.
 */
function leapPose(s: QuadSpec, L: LeapPlan, p: QuadPose, w: number, g: number): number {
  const down = 1 + L.foreOff - L.foreOn, speed = L.sweep / down;
  const H = leapHeight(L, w), P = leapPitch(L, w) * DEG;
  let low = Infinity;
  for (let i = 0; i < 4; i++) {
    const fore = i < 2, leg = fore ? s.fore : s.hind;
    const lag = i % 2 ? L.lag[fore ? 0 : 1] : 0;
    const on = (fore ? L.foreOn : 0) + lag, dur = fore ? down : L.hindOff;
    const at = fore ? L.foreAt : L.hindAt, gone = speed * dur;
    const ankle = leg.len[2], [ahead, behind] = leg.toe ?? [0.3, 0.3];
    const t = frac(w - on);
    let y: number, z: number, toe = 0;
    if (t < dur) {
      // On the ground: flat, going back under the body as fast as the body goes over it.
      y = at - speed * t;
      z = ankle;
    } else {
      const u = (t - dur) / (1 - dur);
      const from = ankle - leapHeight(L, on + dur), to = ankle - leapHeight(L, on + 1);
      let hang: number;
      if (fore) {
        // A fore paw in the air: forward all the way from where it left the ground to where it comes down, drawn up under the chest
        // between, curled.
        y = at - gone + gone * smooth01(u);
        z = H + lerp(from, to, u) + L.tuck[0] * Math.sin(u * Math.PI) ** 0.6;
        hang = L.hang[0] * Math.sin(u * Math.PI);
      } else {
        // A hind foot in the air: carried up off the ground with the body; once well clear of it, left out behind as the leg stretches
        // after the push, toe last; and then brought forward under the haunch, drawn up, to come down flat where it began.
        const a = smooth01(u / 0.16), b = smooth01((u - 0.16) / 0.26), c = smooth01((u - 0.42) / 0.58);
        const [back, rise] = L.trail;
        y = u < 0.42 ? at - gone - back * b : lerp(at - gone - back, at, c);
        z = H + (u < 0.16 ? from + 0.45 * rise * a : u < 0.42 ? from + rise * (0.45 + 0.55 * b) : lerp(from + rise, to, c) + L.tuck[1] * Math.sin(c * Math.PI));
        hang = L.hang[1] * smooth01(u / 0.3) * (1 - smooth01((u - 0.42) / 0.35));
      }
      // As far as the ground under it lets the toe hang, and past straight down once the foot is higher than it is long.
      const room = (z - ankle - 0.12) / ahead;
      toe = -Math.min(hang, room < 1 ? Math.asin(Math.max(0, room)) / DEG : 90 + 200 * (room - 1));
    }
    // Into the body's frame, which is pitched, and the leg set to reach it.
    const cp = Math.cos(P), sp = Math.sin(P);
    const [sw, fold] = legTo(leg, y * cp + (z - H) * sp, -y * sp + (z - H) * cp, fore);
    p.legs[i] = [lerp(p.legs[i][0], sw, g), lerp(p.legs[i][1], fold, g), p.legs[i][2] * (1 - g)];
    p.foot[i] = lerp(p.foot[i], toe - (leg.rest?.[2] ?? 0), g);
    const ts = Math.sin(toe * DEG), tc = Math.cos(toe * DEG);
    low = Math.min(low, z + Math.min(ahead * ts - ankle * tc, -behind * ts - ankle * tc));
  }
  p.lift = lerp(p.lift, low, g);
  p.pitch = lerp(p.pitch, P / DEG, g);
  p.roll *= 1 - g;
  return H;
}

/**
 * Every foot flat on the ground, the fore paws `fore` ahead of the body's
 * bone and the hind feet `hind`, under a body `high` over the ground at the
 * pitch it is posed at: each leg set to reach its foot (`legTo`), laid over
 * the pose by `k`.
 */
function planted(s: QuadSpec, p: QuadPose, high: number, fore: number, hind: number, k: number): void {
  const P = p.pitch * DEG, cp = Math.cos(P), sp = Math.sin(P);
  for (let i = 0; i < 4; i++) {
    const leg = i < 2 ? s.fore : s.hind, y = i < 2 ? fore : hind, z = leg.len[2] - high;
    const [sw, fold] = legTo(leg, y * cp + z * sp, -y * sp + z * cp, i < 2);
    p.legs[i] = [lerp(p.legs[i][0], sw, k), lerp(p.legs[i][1], fold, k), p.legs[i][2] * (1 - k)];
    p.foot[i] = lerp(p.foot[i], -(leg.rest?.[2] ?? 0), k);
  }
  p.lift *= 1 - k;
}

/** The shadow under a body `up` over its standing height: smaller, the further up it is. */
function shadowAt(b: Bones, up: number): Xf {
  const k = 1 / (1 + 0.28 * Math.max(0, up));
  return { m: [k, 0, 0, 0, k, 0, 0, 0, 1], t: [b.body.t[0], b.body.t[1], 0] };
}

/* ---- the rabba ---------------------------------------------------------------------- */

/**
 * A rabba: a round loaf of a grazer that goes everywhere in hops. Its long
 * ears pinch in where the fur gives out and end in a leaf each, a sprig of
 * clover grows up out of its crown, and its tail is a dandelion clock on a
 * stalk.
 */
const RABBA_SPEC: QuadSpec = {
  high: 1.25,
  fore: { at: [0.48, 0.72, -0.5], len: [0.3, 0.28, 0.12], rest: [8, -14, 0], fold: [60, 60], toe: [0.3, 0.08] },
  hind: { at: [0.9, -1.15, -0.2], len: [0.75, 0.95, 0.1], rest: [60, -115, 0], fold: [60, 60], toe: [0.95, 0.25] },
  neck: { at: [0, 0.95, 0.22], len: 0.25, lean: 60 },
  head: { pitch: -4 },
  tail: { at: [0, -1.85, 0.75], links: 1, len: 0.4, lift: 40, curl: 0, sway: 0 },
  ears: { at: [0.46, -0.05, 0.86], out: 26, back: 16 },
  swing: [30, 46],
  graze: 18,
  nose: 12,
  bow: 18,
  rock: 0,
};

/** How high its body's bone stands over the ground, standing, and how far its nose is down: a loaf low at the chest. */
const RABBA_STAND = 1.1;
const RABBA_TILT = 3;
/** Grazing: its body's height, and how far ahead the fore paws are put, to let the chest down between them. */
const RABBA_GRAZE = { high: 1.02, fore: 0.9 };

/**
 * Its hop at a walk and at a run: the hind feet down beside the haunch, the
 * fore paws well ahead; crouched, then thrown up nose-first off the hind
 * feet, and down on the fore paws nose-down, so the stride is a hop and a
 * sit rather than a glide. A run's hop is longer in the air and higher.
 */
const RABBA_HOP: [LeapPlan, LeapPlan] = [
  {
    hindOff: 0.28, foreOn: 0.72, foreOff: 0.08, hindAt: -1.1, foreAt: 0.95, sweep: 0.42,
    low: 1.12, up: 1.72, land: 1.18, arc: 1.3, dip: 0.1, pitch: [-4, 9, -12], tuck: [0.2, 0.45], hang: [30, 150], trail: [0.9, 0.75], lag: [0.03, 0],
  },
  {
    hindOff: 0.2, foreOn: 0.72, foreOff: 0.04, hindAt: -1.05, foreAt: 0.98, sweep: 0.42,
    low: 1.1, up: 1.84, land: 1.2, arc: 1.9, dip: 0.14, pitch: [-5, 12, -15], tuck: [0.25, 0.55], hang: [35, 155], trail: [1.1, 0.85], lag: [0.04, 0],
  },
];

/** How far each ear is turned out from facing forward, in degrees: a side view sees into the near one, not along its edge. */
const RABBA_EAR_TURN = -35;
/** The head's egg, in the head's frame: what the eyes, ears and clover go on. */
const RABBA_HEAD = { c: [0, 0.35, 0.3] as V3, r: [1.15, 1.08, 0.98] as V3 };
/** The pink nose, in the head's frame: what twitches. */
const RABBA_NOSE: V3 = [0, 1.38, 0.12];

/** How far its nose is up and its cheeks with it, nought to one, `t` into the loop: in bursts of twitching, a twitch every other still. */
function rabbaTwitch(t: number): number {
  return (0.5 + 0.5 * cyc(t, 72)) * (cyc(t, 5, 0.8) > -0.25 ? 1 : 0);
}

function rabbaBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 11), k = cut(lod, 5, 7);
  // The body: a teardrop lying down, high and round at the rump, sloping to a small chest; pale underneath.
  const ys = [-1.95, -1.72, -1.22, -0.5, 0.2, 0.78, 1.15];
  const body = tube(ys.map((y, q) => [0, y, [0.4, 0.46, 0.5, 0.42, 0.28, 0.16, 0.1][q]] as V3),
    [0.2, 1.12, 1.5, 1.44, 1.2, 0.9, 0.25], [0.2, 0.96, 1.2, 1.12, 0.92, 0.72, 0.25], n,
    (ring, j) => (ring > 0 && ring < ys.length - 2 && under(n, j) ? 'belly' : 'coat'));
  const H = RABBA_HEAD;
  const skull = orb(H.c, H.r, n + 2, k + 1, 'coat');
  // Two puffed cheeks under a small pink nose, and a small ω of a mouth: the nose and the cheeks twitch on their own (`bent`).
  const cheekL = orb([0.3, 1.1, -0.1], [0.42, 0.36, 0.3], n, k, 'muzzle'), cheekR = orb([-0.3, 1.1, -0.1], [0.42, 0.36, 0.3], n, k, 'muzzle');
  const nose = orbAlong(RABBA_NOSE, [0, 1, 0.25], [0.17, 0.11, 0.11], 6, 3, 'nose');
  const mouth = smile([0, 1.44, -0.12], [0, 1, 0.1], 0.3);
  const muzzle = merge(cheekL, cheekR, nose, mouth);
  const cheeks = blush(H.c, H.r, [0.8, 0.5, -0.3], 0.2);
  // Eyes half round to the side and raised, so side on the whole eye shows clear of the outline, from the front both look at you, and a
  // head bowed to the grass still turns them up to a viewer above.
  const look = (shut: boolean): ReturnType<typeof eyes> => eyes(H.c, H.r, [0.72, 0.6, 0.35], 0.44, { tall: 1.15, shut, rim: 0.1 });
  const cheekEnd = skull.v.length + cheekL.v.length + cheekR.v.length, noseEnd = cheekEnd + nose.v.length, mouthEnd = noseEnd + mouth.v.length;
  const twitched = (v: readonly V3[], a: Anim): V3[] => {
    const tw = a.go > 0 || a.graze > 0.5 ? 0 : rabbaTwitch(a.t);
    if (!tw) return v as V3[];
    const out = v.slice() as V3[];
    for (let i = skull.v.length; i < cheekEnd; i++) out[i] = [v[i][0], v[i][1] + 0.02 * tw, v[i][2] + 0.06 * tw];
    for (let i = cheekEnd; i < noseEnd; i++) {
      const d = sub(v[i], RABBA_NOSE);
      out[i] = add(add(RABBA_NOSE, [0, 0.03 * tw, 0.1 * tw]), scale3(d, 1 + 0.4 * tw));
    }
    for (let i = noseEnd; i < mouthEnd; i++) out[i] = [v[i][0], v[i][1], v[i][2] + 0.07 * tw];
    return out;
  };
  // A sprig of clover low on the crown, just over the roots of the ears: a short stalk, three heart-shaped leaves tipped to the
  // front, and a pink flower head.
  const tilt: V3 = [0, 0.5, 0.87];
  const heart = (at: V3, a: number): ReturnType<typeof merge> => merge(
    orbAlong(add(at, [Math.cos(a - 0.35) * 0.17, Math.sin(a - 0.35) * 0.17, 0]), tilt, [0.22, 0.22, 0.06], 7, 3, 'leaf'),
    orbAlong(add(at, [Math.cos(a + 0.35) * 0.17, Math.sin(a + 0.35) * 0.17, 0]), tilt, [0.22, 0.22, 0.06], 7, 3, 'leaf'),
  );
  const top: V3 = [0, 0.22, 1.66];
  const clover = merge(
    tube(curve([0, 0.3, 1.05], [0, 0.22, 1.4], top, 3), 0.07, 0.07, 5, 'stem'),
    ...[0, 1, 2].map((q) => heart(add(top, [Math.cos(q * 2.09 + 1.57) * 0.32, Math.sin(q * 2.09 + 1.57) * 0.32, 0.02]), q * 2.09 + 1.57)),
    orb(add(top, [0, 0.02, 0.16]), [0.15, 0.15, 0.17], 6, 4, 'petal'),
  );
  // An ear: soft and long, pink inside, pinched in where the fur gives out; above that a leaf, laid back from the pinch so it
  // shows its face to a viewer above it from every side, twisted along its length and folded down its rib. The leaf is a piece of
  // its own, lined at half the width and with no lines inside it, so at play size it is a leaf and not a line.
  const earPts = curve([0, 0, 0], [0, -0.1, 0.8], [0, 0.05, 1.5], 5);
  const ear = moved(merge(
    tube(earPts, [0.26, 0.42, 0.46, 0.4, 0.3, 0.2], 0.12, n, 'coat', { up: [0, 1, 0], seam: 'start' }),
    paint(earPts.slice(1, 4).map((p, q) => disc(add(p, [0, 0.13, 0]), [0, 1, 0.1], [0.24, 0.27, 0.24][q], 0.3, 6, 'inner'))),
  ), [0, 0, 0], RABBA_EAR_TURN);
  const pinch: V3 = [0, 0.05, 1.42];
  const leaf = blade(curve(pinch, [0.06, -0.3, 1.86], [0.16, -0.78, 2.12], lod ? 6 : 5), [0.08, 0.34, 0.42, 0.36, 0.2, 0.03], [0, 0.77, 0.64],
    { twist: 1.05, fold: 0.22, mat: 'leaf', rib: 'leafDark' });
  const earHide = [{ c: H.c, r: H.r }];
  // The tail is a dandelion clock at the end of a stalk that runs back from the rump and curls up: a small grey-green heart, and a
  // spoke of seed out from it every way, each thickest at the heart and ending in a white tuft, so the outline is a star, not a ball.
  // Low behind the rump, where the body hides it from in front and the clock hides its own stalk from behind.
  const heartAt: V3 = [0.18, -0.62, 0.02];
  const stalk = tube(curve([0, 0, -0.1], [0.05, -0.42, -0.2], heartAt, 3), 0.065, 0.065, 5, 'stem');
  const count = lod ? 10 : 8;
  const dirs = Array.from({ length: count }, (_, q) => {
    const a = q * 2.4, z = 0.85 - (1.7 * (q + 0.5)) / count, r = Math.sqrt(1 - z * z);
    return [Math.cos(a) * r, Math.sin(a) * r, z] as V3;
  });
  const spokes = merge(...dirs.map((d) => taper([add(heartAt, scale3(d, 0.12)), add(heartAt, scale3(d, 0.66))], 0.07, 0.03, 4, 'spot')));
  const tufts = merge(...dirs.map((d) => orbAlong(add(heartAt, scale3(d, 0.72)), d, [0.12, 0.12, 0.09], 5, 3, 'spot')));
  const pieces: Piece[] = [
    { key: 'body', mesh: body, bone: 'trunk', bias: 0, breathes: { c: [0, 0, 0.3], k: 0.06 } },
    { key: 'tail', mesh: merge(stalk, orb(heartAt, 0.17, 6, 4, 'moss')), bone: 'tail0', bias: -0.05, thin: true },
    { key: 'spokes', mesh: spokes, bone: 'tail0', bias: -0.049, rim: false },
    { key: 'tufts', mesh: tufts, bone: 'tail0', bias: -0.048, airy: true, thin: true },
    { key: 'neck', mesh: tube([[0, 0, -0.3], [0, 0, 0.2], [0, 0.1, 0.45]], [0.72, 0.7, 0.68], [0.62, 0.6, 0.58], n, 'coat', { seam: 'both' }), bone: 'neck', bias: 0, under: 'head', convex: true },
    { key: 'head', mesh: merge(skull, muzzle, cheeks, look(false)), shut: merge(skull, muzzle, cheeks, look(true)), bone: 'head', bias: 0.2, bent: twitched },
    { key: 'clover', mesh: clover, bone: 'head', bias: 0.23, after: ['head', 'ear0', 'ear1'], hide: earHide, thin: true, lines: false },
    { key: 'ear0', mesh: mirrored(ear), bone: 'ear0', bias: 0.22, after: 'head', hide: earHide, hideIn: 'head' },
    { key: 'ear1', mesh: ear, bone: 'ear1', bias: 0.22, after: 'head', hide: earHide, hideIn: 'head' },
    { key: 'leaf0', mesh: mirrored(leaf), bone: 'ear0', bias: 0.225, after: ['head', 'ear0'], front: [0, -1, 0], hide: earHide, hideIn: 'head', thin: true, lines: false },
    { key: 'leaf1', mesh: leaf, bone: 'ear1', bias: 0.225, after: ['head', 'ear1'], front: [0, -1, 0], hide: earHide, hideIn: 'head', thin: true, lines: false },
  ];
  // Mitten fore paws, and the haunch is the thigh: a round lump bulging out past the chest, under which only the slipper of a foot shows.
  const paw = pawMesh(0.22, n, k, 'mark', 0.12);
  for (const [key, side] of [['fl', -1], ['fr', 1]] as Array<[string, number]>) {
    pieces.push(...legPieces(key, true, side, [[0, 0, 0.3], [0, 0, -0.3]], [0.3, 0.24], [[0, 0, 0], [0, 0.02, -0.28]], [0.22, 0.2], paw, n));
  }
  const haunch = orbAlong([0, 0.05, -0.28], [0, -0.5, 1], [0.66, 0.78, 0.78], n, k, 'coat');
  const slipper = merge(
    tube([[0, -0.3, -0.04], [0, 0.2, -0.08], [0, 0.72, -0.07], [0, 0.95, -0.03]], [0.18, 0.28, 0.24, 0.1], [0.14, 0.16, 0.13, 0.07], n, 'coat', { seam: 'start' }),
    orbAlong([0, 0.8, -0.04], [0, 1, 0], [0.2, 0.1, 0.2], 6, 3, 'mark'),
  );
  for (const [key, side] of [['hl', -1], ['hr', 1]] as Array<[string, number]>) {
    const front: V3 = [side * 0.7, -0.7, 0];
    pieces.push(
      { key: `${key}0`, mesh: moved(haunch, [side * 0.1, 0, 0]), bone: `${key}0`, bias: 0.02, after: 'body', front },
      { key: `${key}1`, mesh: tube([[0, 0, 0.1], [0, 0, -0.95]], [0.2, 0.16], [0.2, 0.16], n, 'coat', { seam: 'both' }), bone: `${key}1`, bias: 0.005, after: 'body', front, convex: true },
      { key: `${key}2`, mesh: slipper, bone: `${key}2`, bias: 0.01, after: 'body', front },
    );
  }
  return pieces;
}

/**
 * Standing about, as a loaf: the fore legs tucked under the chest, the nose
 * twitching in bursts, each ear turning on its own, and every so often up on
 * its haunches to look over the grass, ears up. Grazing, the chest let down
 * over the fore paws and the head bowed to the grass, the rump up over hind
 * feet that stay where they are.
 */
function rabbaStill(p: QuadPose, a: Anim, k: number): void {
  const t = a.t, gz = a.graze;
  const up = smooth01(beat(t, [4.5, 16.8], 2.2) * 1.6);
  // Every foot flat where the loaf puts it and the chest let down between them, so a fore leg is tucked, elbow back and mitten
  // forward, rather than a peg under it; all of it given up to the old pose as it sits up.
  p.pitch -= RABBA_TILT * (1 - gz) * (1 - up) * k;
  p.roll *= 1 - k * (1 - up);
  planted(RABBA_SPEC, p, lerp(RABBA_STAND, RABBA_GRAZE.high, gz), lerp(0.78, RABBA_GRAZE.fore, gz), -1.25, (1 - up) * k);
  const u = up * k;
  p.pitch += 32 * u;
  p.legs[0][0] += 20 * u;
  p.legs[1][0] += 20 * u;
  p.legs[0][1] += 0.9 * u;
  p.legs[1][1] += 0.9 * u;
  p.neck[0] -= 22 * u;
  p.head[0] += 14 * u * (1 - gz);
  // Both ears stood up straight as it looks over the grass, turned back against the tip of the head.
  p.ears[0][0] -= 40 * u;
  p.ears[1][0] -= 40 * u;
  p.ears[0][1] += 14 * beat(t, [2.1, 9.4, 13.2, 21.5], 0.9) * k;
  p.ears[1][0] += 22 * beat(t, [7.2, 19.1], 1.1) * (1 - up) * k;
  // One ear always a little lower and further out than the other, so they never stand as one in profile.
  p.ears[1][1] += 10 * (1 - up) * k;
  p.ears[1][0] += 12 * (1 - up) * k;
}

/**
 * A rabba's hop, every leg set for where it is in it (`leapPose`), and the
 * body squashed as it lands and drawn out as it leaves; the ears and the
 * tail come a little after the body, as soft things do.
 */
function rabbaHop(p: QuadPose, a: Anim): number {
  const w = frac(a.u), g = smooth01(a.go);
  const L = planAt(RABBA_HOP[0], RABBA_HOP[1], a.gait);
  const H = leapPose(RABBA_SPEC, L, p, w, g);
  p.squash += a.go * (0.16 * bump(w, L.foreOn + 0.05, 0.08) + 0.08 * (bump(w, 0.02, 0.06) + bump(w, 1.02, 0.06)) - 0.1 * bump(w, L.hindOff - 0.02, 0.07));
  const later = frac(w - 0.1);
  const trail = later >= L.hindOff && later < L.foreOn ? Math.sin(((later - L.hindOff) / (L.foreOn - L.hindOff)) * Math.PI) : 0;
  const land = bump(w, L.foreOn + 0.06, 0.1);
  p.ears[0][0] += a.go * (32 * trail - 10 * land);
  p.ears[1][0] += a.go * (36 * trail - 12 * land);
  p.tail[0] -= a.go * 25 * trail;
  return H;
}

export const RABBA: Kind = {
  bones: (a) => {
    const p = quadPose(RABBA_SPEC, a);
    const g = smooth01(a.go);
    if (a.go < 1) rabbaStill(p, a, 1 - g);
    const H = a.go > 0 ? rabbaHop(p, a) : RABBA_STAND;
    const b = quadBones(RABBA_SPEC, p);
    b.shadow = shadowAt(b, (H - RABBA_STAND) * g);
    return b;
  },
  build: rabbaBuild,
  palette: (coat, mark) => coatPalette(coat, mark, {
    spot: [252, 250, 246], nose: [226, 136, 150], leaf: [192, 230, 92], leafDark: [140, 192, 70], stem: [150, 196, 92], petal: [248, 168, 204], moss: [196, 214, 170],
  }),
  shadow: [2.3, 1.5],
  stride: 1.4,
  size: 1.9,
  leaps: [true, true],
};

/* ---- the woola ---------------------------------------------------------------------- */

/**
 * A woola: a round, mild grazer under a fleece that is a cloud -- a few big
 * billows heaped over a small body, which shrink to a crop when it is shorn
 * and grow back. A soft face in a colour of its own, eyes that are mostly
 * eye, two shells curled on its head like a snail's, and legs that are
 * barely there.
 */
const WOOLA_SPEC: QuadSpec = {
  high: 1.2,
  fore: { at: [0.8, 0.98, -0.4], len: [0.3, 0.28, 0.14], rest: [0, 0, 0], fold: [70, 90], toe: [0.27, 0.15] },
  hind: { at: [0.8, -0.78, -0.4], len: [0.3, 0.28, 0.14], rest: [4, -8, 0], fold: [70, 90], toe: [0.27, 0.15] },
  neck: { at: [0, 1.35, 0.25], len: 0.3, lean: 58 },
  head: { pitch: -2 },
  ears: { at: [0.78, -0.25, 0.02], out: 95, back: 25 },
  swing: [34, 44],
  graze: 24,
  nose: 12,
  bow: 10,
  rock: 5,
};

const WOOLA_HEAD = { c: [0, 0.45, 0.15] as V3, r: [1.0, 0.92, 0.8] as V3 };
/** Where the chin is in the head's frame, and the hinge it chews on. */
const WOOLA_CHIN: V3 = [0, 1.25, -0.4];
const WOOLA_HINGE: V3 = [0, 0.75, -0.25];

/** How far through a chew it is, nought shut to one open, and to which side the jaw is ground: in bursts of about three seconds. */
function woolaChew(t: number): [number, number] {
  const burst = smooth01((cyc(t, 3, 0.6) - 0.15) * 3);
  return [burst * (0.5 + 0.5 * cyc(t, 36)), burst * cyc(t, 18)];
}

/**
 * The chin of the face, corners `from` to `to` of it, turned down on its
 * hinge and ground from side to side as it chews the cud, standing; still
 * while it walks or grazes, where the tug at the grass is the head's.
 */
const chewed = (from: number, to: number) => (v: readonly V3[], a: Anim): V3[] => {
  if (a.go > 0 || a.graze > 0) return v as V3[];
  const [open, side] = woolaChew(a.t);
  if (!open && !side) return v as V3[];
  const c = Math.cos(open * 16 * DEG), sn = Math.sin(open * 16 * DEG);
  const out = v.slice() as V3[];
  for (let i = from; i < to; i++) {
    const y = v[i][1] - WOOLA_HINGE[1], z = v[i][2] - WOOLA_HINGE[2];
    out[i] = [v[i][0] + 0.12 * side, WOOLA_HINGE[1] + y * c + z * sn, WOOLA_HINGE[2] - y * sn + z * c];
  }
  return out;
};

/** Where the body under the fleece is, and its egg, which a shorn fleece hugs. */
const WOOLA_CORE: V3 = [0, 0, 0.05];
const WOOLA_EGG: V3 = [0.95, 1.35, 0.8];

/** The fleece: big billows heaped across the top, so the outline is a cloud's scallop from every side, over a flatter skirt of smaller puffs. */
const BILLOWS: Array<[V3, number]> = [
  [[0, -0.7, 0.72], 1.08], [[0.05, 0.55, 0.8], 0.98], [[0.12, -0.05, 1.12], 0.88], [[0.82, 0.05, 0.5], 0.82], [[-0.8, -0.25, 0.5], 0.84],
  [[0, -0.1, -0.05], 1.25],
];
const SKIRT: Array<[V3, number]> = Array.from({ length: 7 }, (_, q) => {
  const a = (q / 7) * Math.PI * 2 + 0.3;
  return [[Math.cos(a) * 1.05, Math.sin(a) * 1.3, -0.25], 0.62] as [V3, number];
});

/**
 * The fleece, puff by puff, with where each puff's corners are in the whole:
 * a skirt puff is flat underneath, the colour of a cloud's underside.
 */
function fleeceOf(n: number, k: number): { mesh: ReturnType<typeof merge>; puffs: Array<{ from: number; to: number; c: V3 }> } {
  const puffs: Array<{ from: number; to: number; c: V3 }> = [];
  const meshes: Array<ReturnType<typeof orb>> = [];
  let at = 0;
  const add = (m: ReturnType<typeof orb>, c: V3): void => {
    puffs.push({ from: at, to: at + m.v.length, c });
    at += m.v.length;
    meshes.push(m);
  };
  BILLOWS.forEach(([c, r], q) => add(orb(c, [r * 1.02, r, r * 0.78], n + 1, k, q === 2 ? 'coatLight' : 'coat'), c));
  for (const [c, r] of SKIRT) {
    const m = orb(c, [r, r, r * 0.7], n, k - 1, 'coat');
    const floor = c[2] - r * 0.7 * 0.45;
    const v = m.v.map((p) => [p[0], p[1], Math.max(floor, p[2])] as V3);
    const f = m.f.map((face) => (face.i.reduce((z, i) => z + v[i][2], 0) / face.i.length < floor + 0.05 ? { ...face, m: 'coatDark' as const } : face));
    add(mesh(v, f), c);
  }
  return { mesh: merge(...meshes), puffs };
}

/** A small cloud of three puffs, for the ones that follow a woola about: a cool white of their own, lighter than any fleece. */
const cloudlet = (r: number, n: number, k: number): ReturnType<typeof merge> => merge(
  orb([0, 0, 0], [r, r * 0.9, r * 0.75], n, k, 'cap'), orb([r * 0.8, r * 0.1, -r * 0.15], r * 0.62, n, k, 'cap'), orb([-r * 0.75, -r * 0.1, -r * 0.2], r * 0.55, n, k, 'cap'),
);

function woolaBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 10), k = cut(lod, 5, 6);
  // The body under the fleece, which is all that shows of it once it is shorn: an egg.
  const body = orb(WOOLA_CORE, WOOLA_EGG, n, k, 'mark');
  const { mesh: fleece, puffs } = fleeceOf(n, k);
  // A fleece growing back: every puff smaller about its own middle and drawn in onto the body, so a crop is a close, bumpy coat
  // over the egg of it, and never gone. Shorn, each puff sits on the egg's skin where the line out to it crosses it, half out, so
  // the crop covers the belly and the sides as well as the back.
  const shorn = puffs.map((pf) => {
    const { p: at, n: out } = onEgg(WOOLA_CORE, WOOLA_EGG, sub(pf.c, WOOLA_CORE));
    return add(at, scale3(out, -0.12));
  });
  const grown = (v: readonly V3[], a: Anim): V3[] => {
    const f = Math.max(0, Math.min(1, a.fleece));
    if (f >= 1) return v as V3[];
    const size = 0.45 + 0.55 * f;
    const out = v.slice() as V3[];
    puffs.forEach((pf, q) => {
      const c: V3 = [lerp(shorn[q][0], pf.c[0], f), lerp(shorn[q][1], pf.c[1], f), lerp(shorn[q][2], pf.c[2], f)];
      for (let i = pf.from; i < pf.to; i++) out[i] = [c[0] + (v[i][0] - pf.c[0]) * size, c[1] + (v[i][1] - pf.c[1]) * size, c[2] + (v[i][2] - pf.c[2]) * size];
    });
    return out;
  };
  const H = WOOLA_HEAD;
  // A face with a profile: a soft muzzle standing well out from the skull under a dip at the brow, so side on it is a face and not an
  // egg; under it a chin, which is what chews (`chewed`).
  const skull = orb(H.c, H.r, n + 1, k + 1, 'muzzle');
  const chin = orbAlong(WOOLA_CHIN, [0, 1, -0.3], [0.34, 0.32, 0.2], n, k, 'muzzle');
  const face = merge(
    skull,
    chin,
    orbAlong([0, 1.28, -0.2], [0, 1, -0.2], [0.5, 0.46, 0.36], n, k, 'muzzle'),
    paint([disc([0, 1.73, -0.08], [0, 1, 0.2], 0.15, 0.09, 6, 'nose')]),
    smile([0, 1.74, -0.3], [0, 1, 0], 0.26, 'nose'),
    blush(H.c, H.r, [0.8, 0.45, -0.35], 0.2),
  );
  // Eyes half round to the side and a little up, so side on the whole eye and its rim show, from the front both still look at you,
  // and a band of face shows between each and the shell over it.
  const look = (shut: boolean): ReturnType<typeof eyes> => eyes(H.c, H.r, [0.68, 0.68, 0.24], 0.34, { tall: 1.15, shut, rim: 0.14 });
  // A tuft of fleece on the brow.
  const tuft = merge(orb([0, 0.25, 0.84], [0.5, 0.44, 0.3], n, k, 'coat'), orb([0.32, 0.08, 0.72], 0.3, n, k, 'coat'), orb([-0.32, 0.08, 0.72], 0.3, n, k, 'coat'));
  // A snail's shell up at each back corner of the head, framing the face: a whorl winding out along an axis turned out, forward and
  // up, so its spiral faces a viewer from the front and the three-quarters and shows as a cone side on; a groove down the join
  // of its turns, and a spark of light on it.
  const shell = (sd: number): ReturnType<typeof merge> => {
    const ax = unit([sd * 0.61, 0.61, 0.5]);
    const e1 = unit(cross(ax, [0, 0, 1])), e2 = cross(ax, e1);
    const C: V3 = [sd * 0.8, -0.2, 0.74];
    const pts: V3[] = [], rs: number[] = [], groove: V3[] = [];
    const N = 12;
    for (let q = 0; q <= N; q++) {
      const u = q / N, a = u * Math.PI * 2.3, R = 0.42 * (1 - u * 0.82), rr = 0.24 * (1 - u * 0.86);
      const p = add(add(C, scale3(e1, Math.cos(a) * R)), add(scale3(e2, Math.sin(a) * R), scale3(ax, u * 0.4 + u ** 3 * 0.15)));
      pts.push(p);
      rs.push(rr);
      groove.push(add(p, add(scale3(ax, rr * 0.75), scale3(sub(C, p), 0.35 * rr / Math.max(0.05, R)))));
    }
    return merge(
      tube(pts, rs, rs, n, 'shell'),
      tube(groove.slice(1, N), 0.06, 0.06, 4, 'shellDark'),
      paint([disc(add(pts[2], scale3(ax, rs[2] * 1.02)), ax, 0.07, 0.07, 5, 'glint', { lit: true })]),
    );
  };
  const ear = tube(curve([0, 0, 0], [0, 0.05, 0.25], [0, 0.02, 0.5], 3), [0.12, 0.22, 0.2, 0.05], 0.07, 6, 'muzzle', { up: [0, 1, 0], seam: 'start' });
  const hide = [{ c: H.c, r: H.r }];
  const pieces: Piece[] = [
    { key: 'body', mesh: body, bone: 'trunk', bias: 0 },
    // Over the tops of the legs, which go up into it; one outline round the whole cloud, no lines inside it, and a silver edge.
    { key: 'fleece', mesh: fleece, bone: 'fleece', bias: 0.04, after: ['body', 'fl0', 'fr0', 'hl0', 'hr0'], bent: grown, breathes: { c: [0, 0, 0.2], k: 0.18 }, lines: false, sheen: 'crystal' },
    { key: 'neck', mesh: tube([[0, 0, -0.2], [0, 0, 0.4]], 0.52, 0.46, n, 'muzzle', { seam: 'both' }), bone: 'neck', bias: 0, under: 'head', convex: true },
    { key: 'head', mesh: merge(face, look(false)), shut: merge(face, look(true)), bone: 'head', bias: 0.2, bent: chewed(skull.v.length, skull.v.length + chin.v.length) },
    { key: 'tuft', mesh: tuft, bone: 'head', bias: 0.21, after: 'head', hide, lines: false },
    { key: 'shells', mesh: merge(shell(1), shell(-1)), bone: 'head', bias: 0.215, after: ['head', 'tuft'] },
    { key: 'ear0', mesh: ear, bone: 'ear0', bias: 0.205, after: 'head', hide, hideIn: 'head' },
    { key: 'ear1', mesh: ear, bone: 'ear1', bias: 0.205, after: 'head', hide, hideIn: 'head' },
    // Two little clouds that keep it company, behind and above the rump.
    { key: 'cloud0', mesh: cloudlet(0.46, n, k), bone: 'cloud0', bias: -0.1, lines: false, airy: true, thin: true, sheen: 'crystal', shown: (a) => a.fleece > 0.6 },
    { key: 'cloud1', mesh: cloudlet(0.32, n, k), bone: 'cloud1', bias: -0.1, lines: false, airy: true, thin: true, sheen: 'crystal', shown: (a) => a.fleece > 0.6 },
  ];
  // Round bean feet on short legs, set wide, so two show in front from the front and three or four side on: flat on the ground,
  // longer than they are tall.
  const foot = pawMesh(0.21, n, k, 'hoof', 0.14);
  for (const leg of [['fl', -1, true], ['fr', 1, true], ['hl', -1, false], ['hr', 1, false]] as Array<[string, number, boolean]>) {
    pieces.push(...legPieces(leg[0], leg[2], leg[1], [[0, 0, 0.3], [0, 0, -0.3]], [0.24, 0.2], [[0, 0, 0], [0, 0, -0.28]], [0.19, 0.18], leg[1] < 0 ? mirrored(foot) : foot, n, 'muzzle'));
  }
  return pieces;
}

/** Its legs shorter and it lower as its fleece goes: shorn, it is not a cushion on a stool. */
const woolaSpecs = new Map<number, QuadSpec>();
function woolaSpec(fleece: number): QuadSpec {
  const key = Math.round(Math.max(0, Math.min(1, fleece)) * 6);
  let s = woolaSpecs.get(key);
  if (!s) {
    const k = 1 - 0.38 * (1 - key / 6);
    const S = WOOLA_SPEC;
    s = { ...S, fore: { ...S.fore, len: [S.fore.len[0] * k, S.fore.len[1] * k, S.fore.len[2]] }, hind: { ...S.hind, len: [S.hind.len[0] * k, S.hind.len[1] * k, S.hind.len[2]] } };
    woolaSpecs.set(key, s);
  }
  return s;
}

/** The trundle's rise and fall, over a stride: up twice, once off each pair of feet. */
const trundle = (w: number): number => 0.24 * Math.abs(Math.sin(w * TAU));

function woolaOwn(p: QuadPose, a: Anim): void {
  const w = a.u - Math.floor(a.u);
  if (a.go < 1) woolaStill(p, a, 1 - smooth01(a.go));
  if (a.go > 0) {
    // A trundle: up and down twice a stride, rocking nose to tail and rolling a little, the head nodding.
    p.lift += a.go * trundle(w);
    p.pitch += a.go * 4 * Math.sin(w * TAU * 2 + 0.8);
    p.roll += a.go * 3 * Math.sin(w * TAU);
    p.squash += a.go * 0.07 * Math.max(0, Math.cos(w * TAU * 2));
    p.neck[0] += a.go * 5 * Math.sin(w * TAU * 2 + 0.6);
  }
}

/** Standing and grazing, laid over the pose by `n`. */
function woolaStill(p: QuadPose, a: Anim, n: number): void {
  const t = a.t, gz = a.graze;
  // Every foot flat where it stands, grazing as well, the body let down as the chest bows so the hind feet stay on the grass; and
  // shorn, on its shorter legs, bowing less.
  const s = woolaSpec(a.fleece), k = s.fore.len[0] / WOOLA_SPEC.fore.len[0];
  p.pitch += gz * 11 * (1 - k) * n;
  const P = p.pitch * DEG;
  planted(s, p, 0.54 + 0.5626 * k + 0.78 * Math.sin(P) + 0.4 * (Math.cos(P) - 1), 0.98, -0.78, n);
  p.roll *= 1 - n;
  // Chewing the cud in bursts, the head going with the jaw a little; a shuffle from foot to foot; and now and then a shake of the
  // head that runs through the fleece.
  const shake = beat(t, [9.6, 20.4], 1.0) * n;
  p.head[2] += 18 * shake * Math.sin(t * Math.PI * 6);
  p.roll += 4 * shake * Math.sin(t * Math.PI * 6 + 1);
  p.head[0] += 1.5 * woolaChew(t)[0] * (1 - shake) * (1 - gz) * n;
  p.legs[0][0] += 6 * beat(t, [3.4], 0.8) * n;
  p.legs[3][0] += 6 * beat(t, [15.1], 0.8) * n;
}

export const WOOLA: Kind = {
  bones: (a) => {
    const p = quadPose(WOOLA_SPEC, a);
    woolaOwn(p, a);
    const b = quadBones(woolaSpec(a.fleece), p);
    // The fleece a moment behind the body: lagging below it as it rises and above it as it comes down, so it settles after each step.
    const w = a.u - Math.floor(a.u);
    const lag = a.go > 0 ? a.go * 0.7 * (trundle((w - 0.07 + 1) % 1) - trundle(w)) : 0;
    b.fleece = { m: b.trunk.m, t: [b.trunk.t[0], b.trunk.t[1], b.trunk.t[2] + lag] };
    // The two clouds: bobbing on their own over the rump standing, trailing further back and lower going, and puffed down at each
    // footfall.
    const t = a.t, go = a.go;
    const bob0 = 0.14 * cyc(t, 5) + go * 0.2 * Math.sin((w - 0.15) * TAU * 2);
    const bob1 = 0.12 * cyc(t, 7, 1.3) + go * 0.2 * Math.sin((w - 0.25) * TAU * 2);
    b.cloud0 = { m: b.body.m, t: place(b.body, [0.7, -2.55 - 0.5 * go, 0.95 - 0.2 * go + bob0]) };
    b.cloud1 = { m: b.body.m, t: place(b.body, [-0.62, -3.6 - 0.7 * go, 1.55 - 0.25 * go + bob1]) };
    return b;
  },
  build: woolaBuild,
  palette: (coat0, mark0) => {
    const coat = pastel(coat0);
    // The face a colour of its own, well away from the fleece: a soft cocoa under a pale fleece, cream under a dark one.
    const pale = coat[0] + coat[1] + coat[2] > 480;
    const face: RGB = pale ? mix([150, 116, 126], pastel(mark0), 0.25) : [240, 228, 212];
    return coatPalette(coat0, mark0, {
      coatLight: lighter(coat, 0.1), coatDark: mix(coat, [168, 176, 226], 0.45), muzzle: face, mark: face, horn: [236, 214, 176], hoof: darker(face, 0.45), nose: darker(face, 0.5),
      shell: [248, 196, 160], shellDark: [168, 102, 90], inner: [238, 160, 172], crystal: mix(lighter(coat, 0.4), [236, 242, 255], 0.6),
      cap: mix(lighter(coat, 0.5), [226, 230, 250], 0.5),
    });
  },
  shadow: [2.1, 1.6],
  stride: 1.1,
  size: 2.45,
  blinks: 4,
};

/* ---- the seavic --------------------------------------------------------------------- */

/**
 * A seavic: a quick red-brown treetop thing with cheeks stuffed with seed.
 * Its great tail, worn like a cloak, is a frond of oak leaves rather than
 * fur, and an acorn's cap sits on its head like a hat it will not take off.
 * It does not graze with its nose in the grass: it sits up on its haunches
 * with what it found held in its fore paws, and nibbles.
 */
const SEAVIC_SPEC: QuadSpec = {
  high: 1.55,
  fore: { at: [0.5, 0.85, -0.45], len: [0.45, 0.42, 0.14], rest: [8, -12, 0], fold: [50, 80], toe: [0.25, 0.1] },
  hind: { at: [0.72, -0.95, -0.2], len: [0.8, 0.95, 0.14], rest: [58, -112, 0], fold: [20, 35], toe: [0.85, 0.2] },
  neck: { at: [0, 0.85, 0.45], len: 0.4, lean: 22 },
  head: { pitch: 0 },
  tail: { at: [0, -1.55, 0.3], links: 3, len: 0.55, lift: 72, curl: 32, sway: 8 },
  ears: { at: [0.42, -0.05, 0.72], out: 16, back: 6 },
  swing: [30, 46],
  duty: [0.42, 0.28],
  graze: 0,
  nose: 0,
  bow: 0,
  bound: true,
  rock: 0,
};

const SEAVIC_HEAD = { c: [0, 0.3, 0.35] as V3, r: [0.86, 0.84, 0.74] as V3 };
/** Where the acorn cap's cup sits on the crown, which it is tipped forward about. */
const SEAVIC_CAP: V3 = [0, 0.18, 1.1];

function seavicBuild(lod: number): Piece[] {
  const n = cut(lod, 8, 10), k = cut(lod, 5, 6);
  const ys = [-1.7, -1.5, -1.05, -0.4, 0.3, 0.85, 1.15];
  const body = tube(ys.map((y, q) => [0, y, [0.3, 0.3, 0.28, 0.24, 0.24, 0.32, 0.4][q]] as V3), [0.15, 0.78, 1.02, 1.0, 0.88, 0.64, 0.15], [0.12, 0.64, 0.82, 0.8, 0.72, 0.56, 0.15], n,
    (ring, j) => (ring > 0 && ring < ys.length - 1 && under(n, j) ? 'mark' : 'coat'));
  const H = SEAVIC_HEAD;
  const skull = orb(H.c, H.r, n + 1, k + 1, 'coat');
  // Cheeks stuffed round with seed, bulging out to the sides rather than hanging under the jaw, and a pale muzzle between them.
  const cheeks = merge(
    orb([0.56, 0.78, 0.14], [0.34, 0.3, 0.28], n, k, 'mark'), orb([-0.56, 0.78, 0.14], [0.34, 0.3, 0.28], n, k, 'mark'),
    orbAlong([0, 1.02, 0.12], [0, 1, 0], [0.26, 0.24, 0.22], n, k, 'muzzle'),
    orbAlong([0, 1.22, 0.24], [0, 1, 0.3], [0.1, 0.07, 0.07], 5, 3, 'nose'),
  );
  // Eyes round to the side, clear of the outline side on, the muzzle in front of them.
  const look = (shut: boolean) => eyes(H.c, H.r, [0.76, 0.54, 0.3], 0.3, { tall: 1.18, shut, rim: 0.1 });
  // The acorn cap: a cup worked in two rows, dark and light, sat up on the crown and tipped forward so it shows side on, and a stalk.
  const cap = moved(moved(merge(
    tube([[0, 0, -0.08], [0, 0, 0.02], [0, 0, 0.12], [0, 0, 0.24]], [0.46, 0.52, 0.46, 0.2], [0.46, 0.52, 0.46, 0.2], n, (ring) => (ring === 1 ? 'shellDark' : 'bark')),
    taper(curve([0, 0, 0.24], [0, -0.02, 0.38], [0.06, -0.08, 0.5], 2), 0.08, 0.05, 5, 'bark'),
  ), [0, 0, 0], 0, -12), SEAVIC_CAP);
  // An ear, turned out so it shows its face side on, pink inside.
  const ear = moved(merge(
    taper(curve([0, 0, 0], [0, 0, 0.3], [0, -0.05, 0.55], 2), 0.26, 0.03, n, 'coat', 0.35, [0, 1, 0]),
    paint([disc([0, 0.1, 0.2], [0, 1, 0.1], 0.13, 0.16, 6, 'inner')]),
  ), [0, 0, 0], -35);
  // The tail: three links of oak leaf, each a broad frond overlapping the next, veined, fanning as it curls, and each rolled on its
  // length the other way from the last, so from any side some of it shows its face rather than its edge.
  const frond = (w: number, len: number, roll: number): ReturnType<typeof tube> => moved(merge(
    tube(curve([0, 0.05, 0], [0, -len * 0.5, 0.05], [0, -len * 1.05, 0], 4), [0.1, w * 0.8, w, w * 0.7, 0.02], 0.1, n, (ring) => (ring >= 3 ? 'leafDark' : 'leaf'), { up: [0, 0, 1] }),
    tube([[0, 0, 0.1], [0, -len * 0.9, 0.12]], 0.05, 0.05, 4, 'leafDark'),
    moved(tube(curve([0, 0, 0], [0.3, -len * 0.4, 0.05], [w * 0.9, -len * 0.75, 0.0], 3), [0.05, w * 0.35, w * 0.3, 0.02], 0.07, 6, 'leafDark', { up: [0, 0, 1] }), [0, -0.1, -0.05]),
    moved(tube(curve([0, 0, 0], [-0.3, -len * 0.4, 0.05], [-w * 0.9, -len * 0.75, 0.0], 3), [0.05, w * 0.35, w * 0.3, 0.02], 0.07, 6, 'leafDark', { up: [0, 0, 1] }), [0, -0.1, -0.05]),
  ), [0, 0, 0], 0, 0, roll);
  const hide = [{ c: H.c, r: H.r }];
  const pieces: Piece[] = [
    { key: 'body', mesh: body, bone: 'body', bias: 0, breathes: { c: [0, 0, 0.3], k: 0.05 } },
    { key: 'tail0', mesh: frond(0.62, 0.78, 55), bone: 'tail0', bias: -0.1, chain: 'tail' },
    { key: 'tail1', mesh: frond(0.76, 0.78, -50), bone: 'tail1', bias: -0.09, chain: 'tail' },
    { key: 'tail2', mesh: frond(0.84, 0.88, 55), bone: 'tail2', bias: -0.08, chain: 'tail' },
    { key: 'neck', mesh: tube([[0, 0, -0.25], [0, 0, 0.3], [0, 0.05, 0.55]], [0.58, 0.54, 0.5], [0.52, 0.5, 0.48], n, 'coat'), bone: 'neck', bias: 0, under: 'head', convex: true },
    { key: 'head', mesh: merge(skull, cheeks, look(false)), shut: merge(skull, cheeks, look(true)), bone: 'head', bias: 0.2 },
    { key: 'cap', mesh: cap, bone: 'head', bias: 0.21, after: 'head', hide },
    { key: 'ear0', mesh: mirrored(ear), bone: 'ear0', bias: 0.215, after: ['head', 'cap'], hide, hideIn: 'head' },
    { key: 'ear1', mesh: ear, bone: 'ear1', bias: 0.215, after: ['head', 'cap'], hide, hideIn: 'head' },
  ];
  const paw = pawMesh(0.17, n, k, 'coatDark', 0.14);
  const hindFoot = tube([[0, -0.2, -0.08], [0, 0.3, -0.12], [0, 0.8, -0.1], [0, 1.0, -0.06]], [0.16, 0.24, 0.2, 0.08], [0.13, 0.14, 0.12, 0.06], n, 'coatDark');
  const haunch = orbAlong([0, 0.05, -0.3], [0, -0.5, 1], [0.5, 0.6, 0.66], n, k, 'coat');
  for (const [key, side] of [['fl', -1], ['fr', 1]] as Array<[string, number]>) {
    pieces.push(...legPieces(key, true, side, [[0, 0, 0.3], [0, 0, -0.45]], [0.28, 0.2], [[0, 0, 0], [0, 0.02, -0.42]], [0.2, 0.16], paw, n));
  }
  for (const [key, side] of [['hl', -1], ['hr', 1]] as Array<[string, number]>) {
    const front: V3 = [side * 0.7, -0.7, 0];
    pieces.push(
      { key: `${key}0`, mesh: moved(haunch, [side * 0.05, 0, 0]), bone: `${key}0`, bias: 0.01, after: 'body', front },
      { key: `${key}1`, mesh: tube([[0, 0, 0.1], [0, 0, -0.95]], [0.18, 0.15], [0.18, 0.15], n, 'coat'), bone: `${key}1`, bias: 0.005, after: 'body', front, convex: true },
      { key: `${key}2`, mesh: hindFoot, bone: `${key}2`, bias: 0.02, after: 'body', front },
    );
  }
  return pieces;
}

/**
 * Sitting up to eat, as far as `gz` says: up on its haunches, the fore paws
 * held up at the mouth, the head bowed over them, and nibbling -- the head
 * and the paws working on every other still, in bursts.
 */
function seavicNibble(p: QuadPose, a: Anim, gz: number): void {
  const t = a.t;
  const burst = 0.4 + 0.6 * Math.max(0, cyc(t, 8));
  const nib = cyc(t, 72) * burst;
  p.pitch += gz * 46;
  p.neck[0] += gz * (26 + 3 * nib);
  p.head[0] -= gz * (60 + 4 * nib);
  for (const i of [0, 1]) {
    p.legs[i][0] += gz * (86 + 5 * nib);
    p.legs[i][1] += gz * (1.3 - 0.85);
  }
  // The tail up along the back behind it, as a squirrel sits.
  p.tail[0] += gz * 45;
}

export const SEAVIC: Kind = {
  bones: quadBonesOf(SEAVIC_SPEC, (p, a) => {
    const w = a.u - Math.floor(a.u);
    const duty = 0.42 + (0.28 - 0.42) * a.gait;
    const air = Math.max(0, Math.min(1, (w - duty) / (0.5 - duty)));
    const leap = w > duty && w < 0.5 ? Math.sin(air * Math.PI) : 0;
    p.lift += a.go * (0.5 + 0.6 * a.gait) * leap;
    p.pitch += a.go * ((8 + 6 * a.gait) * Math.cos((w - duty) * Math.PI * 2) - 2);
    // The tail rides up over the back standing, and streams out behind at a run; standing, flicked up and aside now and then, quickly.
    const flick = beat(a.t, [3.4, 11.1, 18.8], 0.5) * (1 - a.go);
    p.tail[0] -= a.go * 45 * a.gait + 25 * flick;
    p.tail[1] += 20 * flick;
    p.tail[2] -= a.go * 25 * a.gait;
    if (a.graze > 0 && a.go < 1) seavicNibble(p, a, a.graze * (1 - smooth01(a.go)));
  }),
  build: seavicBuild,
  palette: (coat, mark) => coatPalette(coat, mark, { leaf: [226, 182, 74], leafDark: [176, 124, 52], bark: [120, 84, 60], shellDark: [196, 160, 112], muzzle: lighter(mark, 0.3), nose: [96, 60, 64] }),
  shadow: [1.7, 1.0],
  stride: 1.5,
  size: 2.4,
};
