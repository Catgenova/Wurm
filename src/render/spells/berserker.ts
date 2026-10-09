/**
 * The Berserker's spells: how each is cast and what it looks like.
 *
 * A Berserker fights with an axe or a maul in both hands and pays for it in
 * blood, so everything here is heavy, ragged and hot: cuts are torn rather
 * than sliced (a crescent with a sawtooth trailing edge, `rent`), blows land
 * as a jagged star (`starburst`) and split the ground (`cracks`), and a rage
 * burns on the body as tongues of fire (`warFire`). What a rage costs is
 * shown too -- blood (`DROP`) off the body, a pool under a bleeding wound.
 * Whatever lasts counts itself down where it can be read: a Battle Rage's
 * ring of teeth under the feet loses one a second, a Last Rage's crown one a
 * second, an Adrenaline's ticks one a second, a hold's arc closes.
 *
 * The blows are struck with the weapon itself: a battle axe or a maul is held
 * in the fist square across it (`carry 'shoulder'`), so pitching the wrist
 * aims the haft and the swing of the arm swings the head; a one-handed axe
 * (`carry 'fist'`) is taken by the forearm with `wield`, which lies a little
 * nearer the arm, so its wrist is cocked by `FIST_COCK` more to point the same
 * way. The left hand comes onto the haft for the two-handed blows.
 */
import { castWeight, type SpellVisual } from './index';
import { spellInfo } from './info';
import { clamp, easeIn, easeOut, flashOf, glowPicture, hashOf, lerp, seg, smooth, TAU, type Body, type FxScene, type GroundLayer, type P3, type SpellPalette } from './kit';
import { euler, one } from './poses';
import type { PoseCue } from './index';
import { figureProportions, type Rig } from '../figure';
import { KNIFE_BLEED_SECS } from '../../game/fight';

/** Blood red going to ember orange: rage, and what it costs. */
export const PALETTE: SpellPalette = {
  core: '#ffd9b0',
  main: '#d8452c',
  deep: '#7e1c16',
  accent: '#ff9a3c',
  ink: '#3a0f0c',
  light: '#ff6a3a',
};

/* ---- colours of what is spilt ------------------------------------------------------------ */

/** Blood as it flies and as it lies. */
const DROP = '#a3161a';
const DROP_DARK = '#5a0c0e';
/** Blood pooled on the ground: darker than a drop, still red over grass. */
const POOL = '#6e0d10';
/** The ground broken open: earth, chips of stone, the dust they throw up. */
const EARTH = '#2a1712';
const STONE = ['#7a6f63', '#5e554b', '#91877a'] as const;
const DUST = '#8a7a62';
/** A Battle Rage burns hot and bright: orange over the blood red. */
const RAGE_FIRE = { main: '#e8562e', deep: '#a3241a', core: '#ffc070' };
/** A Last Rage burns darker than a Battle Rage: the blood colours with a black heart. */
const DARK_FIRE = { main: '#a11a14', deep: '#3a0a0a', core: '#ff7a3a' };
/** Adrenaline is quick rather than hot: the palette's amber and its near-white. */
const QUICK = { main: '#ff9a3c', deep: '#b35a1c', core: '#fff1d6' };

/** A spell's own number, read once from the game's table. */
const num = (id: string, key: string, or: number): number => spellInfo(id)?.fx[key] ?? or;

/* ---- the shapes this trade draws with --------------------------------------------------------------------------- */

type Ground = { x: number; y: number };

/**
 * A band through points in the world, sorted where it is told rather than at
 * its nearer end, so a cut that wraps a body can be put half behind it and
 * half in front. Widest at the head (the last point); the side away from
 * `pivot` is its edge, lit in the core, and with `teeth` the other side is
 * torn into a saw.
 */
function band(k: FxScene, pts: readonly P3[], o: {
  width: number; alpha?: number; taper?: 'start' | 'both' | 'none'; teeth?: boolean; pivot?: P3; sortAt?: P3; bias?: number;
  main?: string; core?: string; ink?: string; glow?: number;
}): void {
  const n = pts.length;
  const a = o.alpha ?? 1;
  if (n < 2 || a <= 0.01) return;
  const xs: number[] = [], ys: number[] = [];
  let near = 0;
  for (let i = 0; i < n; i++) {
    xs.push(k.sx(pts[i]));
    ys.push(k.sy(pts[i]));
    if (ys[i] > ys[near]) near = i;
  }
  const px = o.pivot ? k.sx(o.pivot) : NaN, py = o.pivot ? k.sy(o.pivot) : NaN;
  const W = o.width * k.zoom;
  const outer: number[] = [], inner: number[] = [], edge: number[] = [];
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    let dx = xs[i1] - xs[i0], dy = ys[i1] - ys[i0];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    let nx = -dy, ny = dx;
    if (o.pivot && (xs[i] - px) * nx + (ys[i] - py) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const u = i / (n - 1);
    const w = W * (o.taper === 'none' ? 1 : o.taper === 'both' ? Math.sin(Math.PI * Math.min(0.92, u) + 0.12) : 0.12 + 0.88 * u);
    // A tooth bitten out of every other point -- no deeper than the points are apart, so a short cut is not a comb.
    const gap = Math.hypot(xs[i1] - xs[i0], ys[i1] - ys[i0]) / Math.max(1, i1 - i0);
    const bite = o.teeth && i % 2 === 1 && i < n - 1 ? 1 - Math.min(0.75, (gap * 0.9) / Math.max(1e-3, w * 0.62)) : 1;
    outer.push(xs[i] + nx * w * 0.38, ys[i] + ny * w * 0.38);
    inner.push(xs[i] - nx * w * 0.62 * bite, ys[i] - ny * w * 0.62 * bite);
    edge.push(xs[i] + nx * w * 0.16, ys[i] + ny * w * 0.16);
  }
  const main = o.main ?? k.pal.main, core = o.core ?? k.pal.core, ink = o.ink ?? k.pal.ink;
  const inkW = Math.max(0.8, 0.7 * k.zoom);
  const outline = (g: CanvasRenderingContext2D, side: number[]): void => {
    g.beginPath();
    g.moveTo(outer[0], outer[1]);
    for (let i = 1; i < n; i++) g.lineTo(outer[2 * i], outer[2 * i + 1]);
    for (let i = n - 1; i >= 0; i--) g.lineTo(side[2 * i], side[2 * i + 1]);
    g.closePath();
  };
  k.worldDraw(o.sortAt ?? pts[near], (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    outline(g, inner);
    g.fillStyle = main;
    g.fill();
    g.lineWidth = inkW;
    g.strokeStyle = ink;
    g.stroke();
    outline(g, edge);
    g.fillStyle = core;
    g.fill();
    g.lineJoin = 'round';
  }, o.bias ?? 0);
  const gl = o.glow ?? 1;
  const pic = gl > 0 ? glowPicture(k.pal.light) : null;
  if (pic) {
    const R = Math.max(5, W * 1.3);
    glowsAlong(k, pic, xs, ys, R, a * gl * 0.4, Math.max(1, Math.floor(n / 5)));
  }
}

/** Soft glows at every `step`th of some screen points. */
function glowsAlong(k: FxScene, pic: HTMLCanvasElement, xs: number[], ys: number[], R: number, alpha: number, step: number): void {
  if (alpha <= 0.01) return;
  k.glowDraw((g) => {
    g.globalAlpha = clamp(alpha);
    for (let i = xs.length - 1; i >= 0; i -= step) g.drawImage(pic, xs[i] - R, ys[i] - R, 2 * R, 2 * R);
  });
}

/** Points round a cut in the plane `kit.slash` uses: `tilt` from upright toward the body's right, `from`/`to` round it, `reach` out from `up`. */
function arcPoints(k: FxScene, b: Body, o: { from: number; to: number; tilt: number; reach: number; up: number; u: number; length: number; wobble?: number; rise?: number }): P3[] {
  const u = clamp(o.u);
  const head = lerp(o.from, o.to, u);
  const tail = o.from < o.to ? Math.max(o.from, head - o.length) : Math.min(o.from, head + o.length);
  const n = k.fast ? 7 : 13;
  const pts: P3[] = [];
  const ct = Math.cos(o.tilt), st = Math.sin(o.tilt);
  for (let i = 0; i <= n; i++) {
    const ang = lerp(tail, head, i / n);
    // A wild cut wanders in and out as it goes, the same way every frame of the cast.
    const r = o.reach * (1 + (o.wobble ?? 0) * Math.sin(ang * 3.1 + (k.seed % 7)));
    const c = Math.cos(ang) * r, s = Math.sin(ang) * r;
    // Out toward what was struck it reaches as far as it must; up and down, no further than arms and a haft (`rise`).
    const sv = s * (o.rise ?? 1);
    pts.push(k.local(b, sv * st, c, Math.max(1, o.up + sv * ct)));
  }
  return pts;
}

/**
 * A torn cut: the crescent a heavy blade leaves, its leading edge hot and its
 * trailing edge ragged. Laid out as `kit.slash` is (`from`, `to`, `tilt`,
 * `reach` from a shoulder `up` over the feet), drawn with `band`.
 */
function rent(k: FxScene, o: {
  u: number; from: number; to: number; tilt: number; reach: number; up?: number; length?: number; width?: number; alpha?: number;
  wobble?: number; main?: string; core?: string; ink?: string; glow?: number; bias?: number;
}): void {
  if ((o.alpha ?? 1) <= 0.01) return;
  // However far a cut reaches toward its mark, it rises and falls no more than the arm and the haft swing it.
  const rise = Math.min(1, REACH_UP / o.reach);
  const b = k.caster;
  const up = o.up ?? b.tall * 0.7;
  const pts = arcPoints(k, b, { from: o.from, to: o.to, tilt: o.tilt, reach: o.reach, up, u: o.u, length: o.length ?? 1.6, wobble: o.wobble, rise });
  band(k, pts, { width: o.width ?? 10, alpha: o.alpha, teeth: true, pivot: k.local(b, 0, 0, up), main: o.main, core: o.core, ink: o.ink, glow: o.glow, bias: o.bias });
}

/** How far a cut rises over the shoulder or falls below it at most, in height units: an arm and a haft. */
const REACH_UP = 11;

/** How far out a blow's cut reaches, in the body's units: out toward what it struck, as far as a lunge and a long haft carry it. */
const cutReach = (k: FxScene, least = 14, most = 30): number => clamp(k.dist * 40 * 0.62, least, most);

/**
 * Where a blow lands: a jagged star, `r` pixels at zoom one, its points
 * uneven (the same each frame of a cast), in front of what it struck.
 */
function starburst(k: FxScene, p: P3, r: number, o: { points?: number; turn?: number; alpha?: number; main?: string; core?: string; ink?: string; bias?: number; glow?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || r <= 0.3) return;
  const x = k.sx(p), y = k.sy(p), R = r * k.zoom;
  const points = o.points ?? 7;
  const turn = o.turn ?? hashOf(k.seed, 3) * TAU;
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < points * 2; i++) {
    const an = turn + (i / (points * 2)) * TAU;
    const rr = i % 2 ? R * (0.3 + 0.12 * hashOf(k.seed + i, 5)) : R * (0.62 + 0.38 * hashOf(k.seed + i, 11));
    xs.push(x + Math.cos(an) * rr);
    ys.push(y + Math.sin(an) * rr * 0.8);
  }
  const main = o.main ?? k.pal.main, core = o.core ?? k.pal.core, ink = o.ink ?? k.pal.ink;
  k.worldDraw(p, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    g.beginPath();
    for (let i = 0; i < xs.length; i++) (i ? g.lineTo(xs[i], ys[i]) : g.moveTo(xs[i], ys[i]));
    g.closePath();
    g.fillStyle = main;
    g.fill();
    g.lineWidth = Math.max(0.8, 0.75 * k.zoom);
    g.strokeStyle = ink;
    g.stroke();
    // The heart of it, the same star at half the size, a little up and left where the light is.
    g.beginPath();
    for (let i = 0; i < xs.length; i++) {
      const cx = x - R * 0.06 + (xs[i] - x) * 0.5, cy = y - R * 0.06 + (ys[i] - y) * 0.5;
      if (i) g.lineTo(cx, cy);
      else g.moveTo(cx, cy);
    }
    g.closePath();
    g.fillStyle = core;
    g.fill();
    g.lineJoin = 'round';
  }, o.bias ?? 8);
  if ((o.glow ?? 1) > 0) k.glow(p, r * 1.7, a * (o.glow ?? 1) * 0.6);
}

/**
 * The ground split open round a point: `n` fissures running out `len` tiles,
 * each a jagged tapering crack with a fork, as far out as `grow` has them
 * (nought to one), and a line of heat down each that `heat` lights. `dir`
 * and `spread` fan them ahead rather than all round.
 */
function cracks(k: FxScene, c: Ground, len: number, o: { n?: number; grow?: number; heat?: number; alpha?: number; dir?: Ground; spread?: number; width?: number; salt?: number } = {}): void {
  const a = o.alpha ?? 1;
  const grow = clamp(o.grow ?? 1);
  if (a <= 0.01 || grow <= 0.01 || len <= 0.02) return;
  const n = o.n ?? 7;
  const salt = (k.seed % 9973) * 7 + (o.salt ?? 0) * 131;
  const h = (i: number, j: number): number => hashOf(salt + i * 17, j * 29 + 3);
  const base = o.dir ? Math.atan2(o.dir.y, o.dir.x) : h(0, 0) * TAU;
  const spread = o.spread ?? TAU;
  // Widths in tiles: `width` is pixels at zoom one, and a tile is about sixty of them along its side.
  const W = (o.width ?? 2.2) / 60;
  const steps = k.fast ? 4 : 6;
  // Each crack as places on the ground down its middle with its width at each: x, y, w.
  const lines: number[][] = [];
  const walk = (x: number, y: number, ang: number, full: number, w0: number, id: number, fork: boolean): void => {
    const line: number[] = [x, y, w0];
    const step = (full * grow) / steps;
    for (let s = 1; s <= steps; s++) {
      // The way it runs drifts a little; each corner kicks out to one side and the next to the other: a split, not a worm.
      ang += (h(id, s) - 0.5) * 0.5;
      x += Math.cos(ang) * step;
      y += Math.sin(ang) * step;
      const kick = (s % 2 ? 1 : -1) * (0.2 + 0.4 * h(id, s + 20)) * step * (s < steps ? 1 : 0.3);
      line.push(x - Math.sin(ang) * kick, y + Math.cos(ang) * kick, w0 * (1 - s / steps));
      if (fork && s === 2 && grow > 0.35) walk(x, y, ang + (h(id, 9) < 0.5 ? -0.9 : 0.9), full * 0.4, w0 * 0.55, id + 50, false);
    }
    lines.push(line);
  };
  for (let i = 0; i < n; i++) {
    const ang = o.dir ? base + ((i + 0.5) / n - 0.5) * spread + (h(i, 1) - 0.5) * 0.3 : base + ((i + h(i, 1) * 0.6) / n) * TAU;
    walk(c.x, c.y, ang, len * (0.55 + 0.45 * h(i, 2)), W * (0.75 + 0.5 * grow), i, h(i, 3) > 0.35);
  }
  // One crack as a closed tapering outline on the ground: down one side of its middle line and back up the other.
  const outline = (L: number[], wide: number): number[] => {
    const m = L.length / 3, out: number[] = [];
    for (let pass = 0; pass < 2; pass++) {
      for (let q = 0; q < m; q++) {
        const s = pass ? m - 1 - q : q;
        const s0 = Math.max(0, s - 1), s1 = Math.min(m - 1, s + 1);
        let dx = L[3 * s1] - L[3 * s0], dy = L[3 * s1 + 1] - L[3 * s0 + 1];
        const l = Math.hypot(dx, dy) || 1;
        dx /= l;
        dy /= l;
        const w = ((L[3 * s + 2] * wide) / 2) * (pass ? -1 : 1);
        out.push(L[3 * s] - dy * w, L[3 * s + 1] + dx * w);
      }
    }
    return out;
  };
  const heat = clamp(o.heat ?? 0);
  const layers: GroundLayer[] = [{ kind: 'fill', colour: EARTH, alpha: clamp(a * 0.95), paths: lines.map((L) => outline(L, 1)), lift: 0.12 }];
  if (heat > 0.02) layers.push({ kind: 'fill', colour: k.pal.accent, alpha: clamp(a * heat), paths: lines.map((L) => outline(L, 0.3)), lift: 0.14 });
  k.groundShape(c.x, c.y, len + 0.3, layers);
  if (heat > 0.05) {
    // The heat in them, over the night: a soft line down each, in screen pixels.
    const light = k.pal.light, w = (o.width ?? 2.2) * k.zoom;
    const scr = lines.map((L) => {
      const s: number[] = [];
      for (let i = 0; i < L.length - 3; i += 3) {
        const p = k.on(L[i], L[i + 1], 0.12);
        s.push(k.sx(p), k.sy(p));
      }
      return s;
    });
    k.glowDraw((g) => {
      g.globalAlpha = clamp(a * heat * 0.14);
      g.strokeStyle = light;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.lineWidth = w;
      g.beginPath();
      for (const s of scr) {
        g.moveTo(s[0], s[1]);
        for (let i = 2; i < s.length; i += 2) g.lineTo(s[i], s[i + 1]);
      }
      g.stroke();
      g.lineCap = 'butt';
    });
  }
}

/**
 * A ring of teeth on the ground round a point, `r` tiles out, the teeth
 * pointing out: a shockwave of this trade, the reach of a whirl, a rage's
 * seconds. `left` (nought to one) of the teeth are drawn, the last one
 * shrinking, so a ring that loses a tooth a second counts the seconds down.
 */
function sawRing(k: FxScene, c: Ground, r: number, o: { teeth?: number; left?: number; alpha?: number; turn?: number; tooth?: number; wide?: number; main?: string; deep?: string; glow?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || r <= 0.03) return;
  const teeth = o.teeth ?? 12;
  const show = clamp(o.left ?? 1) * teeth;
  const tl = o.tooth ?? Math.max(0.08, r * 0.28);
  const turn = o.turn ?? 0;
  const cy = k.sy(k.on(c.x, c.y, 0));
  const lit: number[][] = [], shade: number[][] = [];
  const pt = (ang: number, rr: number, out: number[]): void => {
    out.push(c.x + Math.cos(ang) * rr, c.y + Math.sin(ang) * rr);
  };
  // However many teeth, none wider along the ring than `wide` tiles: a big ring is a saw, not a crown of flags.
  const sector = TAU / teeth;
  const span = Math.min(sector, (o.wide ?? 0.2) / r);
  const band = Math.min(tl * 0.3, 0.05);
  for (let i = 0; i < Math.ceil(show); i++) {
    const part = Math.min(1, show - i);
    const a0 = turn + i * sector, a1 = a0 + sector, am = a0 + (sector - span) / 2 + span * 0.62;
    const q: number[] = [];
    // A short length of band under each tooth and the tooth itself, leaning the way the ring turns, as one facet.
    pt(a0, r - band, q);
    pt(a0, r, q);
    pt(a0 + (sector - span) / 2, r, q);
    pt(am, r + tl * part, q);
    pt(lerp(am, a0 + (sector + span) / 2, part), r, q);
    pt(lerp(am, a1, part), r, q);
    pt(lerp(am, a1, part), r - band, q);
    // The near half of the ring lit, the far half in shade, as the kit's own rings are.
    (k.sy(k.on(q[6], q[7], 0)) > cy ? lit : shade).push(q);
  }
  const ink = k.pal.ink, w = Math.max(0.8, 0.7 * k.zoom);
  const layers: GroundLayer[] = [];
  if (shade.length) layers.push({ kind: 'fill', colour: o.deep ?? k.pal.deep, alpha: clamp(a), paths: shade, lift: 0.15 });
  if (lit.length) layers.push({ kind: 'fill', colour: o.main ?? k.pal.main, alpha: clamp(a), paths: lit, lift: 0.15 });
  if (shade.length + lit.length) layers.push({ kind: 'stroke', colour: ink, alpha: clamp(a), width: w, paths: [...shade, ...lit], closed: true, join: 'miter', lift: 0.16 });
  if (layers.length) k.groundShape(c.x, c.y, r + tl + 0.2, layers);
  const gl = o.glow ?? 0.6;
  if (gl > 0) k.glow(k.on(c.x, c.y, 1), (r + tl) * 40 * 0.9, a * gl * 0.3);
}

/** Arcs of a band on the ground round a point, each [from, to] in radians: a hold's closing arc, a reticle, a clock's ticks. */
function arcs(k: FxScene, c: Ground, r: number, wide: number, spans: ReadonlyArray<readonly [number, number]>, o: { alpha?: number; main?: string; deep?: string; glow?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || r <= 0.03 || !spans.length) return;
  const near: number[][] = [], far: number[][] = [];
  const cy = k.sy(k.on(c.x, c.y, 0));
  for (const [a0, a1] of spans) {
    const m = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 0.2));
    const q: number[] = [];
    for (let i = 0; i <= m; i++) {
      const an = lerp(a0, a1, i / m);
      q.push(c.x + Math.cos(an) * r, c.y + Math.sin(an) * r);
    }
    for (let i = m; i >= 0; i--) {
      const an = lerp(a0, a1, i / m);
      q.push(c.x + Math.cos(an) * (r - wide), c.y + Math.sin(an) * (r - wide));
    }
    const mid = (a0 + a1) / 2;
    (k.sy(k.on(c.x + Math.cos(mid) * r, c.y + Math.sin(mid) * r, 0)) > cy ? near : far).push(q);
  }
  const layers: GroundLayer[] = [];
  if (far.length) layers.push({ kind: 'fill', colour: o.deep ?? k.pal.deep, alpha: clamp(a), paths: far, lift: 0.15 });
  if (near.length) layers.push({ kind: 'fill', colour: o.main ?? k.pal.main, alpha: clamp(a), paths: near, lift: 0.15 });
  layers.push({ kind: 'stroke', colour: k.pal.ink, alpha: clamp(a), width: Math.max(0.8, 0.7 * k.zoom), paths: [...far, ...near], closed: true, join: 'round', lift: 0.16 });
  k.groundShape(c.x, c.y, r + 0.2, layers);
  const gl = o.glow ?? 0.5;
  if (gl > 0) k.glow(k.on(c.x, c.y, 1), r * 40 * 0.8, a * gl * 0.25);
}

/** Where on a person war-fire rises from: the shoulders twice over, the elbows, the fists, and for a fiercer fire the hips. */
const FIRE_AT: ReadonlyArray<readonly [string, number]> = [['arm0', 0.9], ['arm1', 0.9], ['wrist0', 0.6], ['hip1', 1], ['arm0', 0.6], ['arm1', 0.6], ['hip0', 1], ['wrist1', 0.5], ['elbow0', 0.55], ['elbow1', 0.55]];
/** Which of those burn behind the body whichever way it faces, so the fire frames it rather than hiding it: all but the fists and elbows. */
const FIRE_BEHIND = (bone: string): boolean => bone.startsWith('arm') || bone.startsWith('hip');

/**
 * War-fire: tongues of flame licking up off a body -- off its shoulders and
 * fists first, then elbows and hips as `n` grows -- each leaning out away from
 * the middle of the body so the face stays clear, those on the far side of it
 * drawn behind it, flickering on the drawing clock. `h` height units tall.
 */
function warFire(k: FxScene, b: Body, o: { n?: number; h?: number; alpha?: number; main?: string; deep?: string; core?: string; salt?: number }): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const n = Math.min(FIRE_AT.length, k.fast ? Math.min(4, o.n ?? 6) : o.n ?? 6);
  const H = o.h ?? 7;
  const salt = k.seed + (o.salt ?? 0);
  const mid = k.chest(b);
  const midX = k.sx(mid);
  const depth = (p: P3): number => k.eye.worldToScreenY(p.x, p.y, 0);
  const midD = depth(mid);
  const back: number[][] = [], front: number[][] = [];
  for (let i = 0; i < n; i++) {
    const [bone, size] = FIRE_AT[i];
    // A little way down the bone from its joint, and the second tongue off a shoulder a little further out.
    const foot = k.joint(b, bone, [0, 0, i >= 4 && i < 6 ? -1.4 : -0.3], 0.7);
    const bx = k.sx(foot), by = k.sy(foot);
    const out = Math.sign(bx - midX) || (i % 2 ? 1 : -1);
    const fl = 0.68 + 0.32 * Math.sin(k.now * (8.5 + i * 1.3) + i * 2.1) * Math.sin(k.now * 4.7 + i * 0.7);
    const tall = k.hpx(H * size * (0.75 + 0.35 * hashOf(salt, i)) * fl);
    const w = (2.3 + 1.3 * hashOf(salt + 3, i)) * size * k.zoom;
    const behind = FIRE_BEHIND(bone);
    // Licking: the tip whips side to side faster than the body of the flame sways, which is what makes it read as fire.
    const sway = Math.sin(k.now * 6.3 + i * 1.7) * tall * 0.14 + out * tall * (behind ? 0.4 : 0.14);
    const whip = Math.sin(k.now * 11.7 + i * 2.9) * tall * 0.1;
    // Up the left side to the tip, a notch, a second smaller tip on the right, and down: a flame, not a spike.
    const q = [
      bx - w, by,
      bx - w * 1.15 + sway * 0.15, by - tall * 0.25,
      bx - w * 0.7 + sway * 0.45, by - tall * 0.55,
      bx - w * 0.15 + sway * 0.8 + whip * 0.5, by - tall * 0.82,
      bx + sway + whip, by - tall,
      bx + w * 0.22 + sway * 0.6, by - tall * 0.6,
      bx + w * 0.8 + sway * 0.6 - whip * 0.6, by - tall * 0.72,
      bx + w * 0.92 + sway * 0.25, by - tall * 0.36,
      bx + w, by,
    ];
    (behind || depth(foot) < midD - 0.5 ? back : front).push(q);
  }
  const main = o.main ?? k.pal.main, deep = o.deep ?? k.pal.deep, core = o.core ?? k.pal.accent;
  const draw = (list: number[][], alpha: number) => (g: CanvasRenderingContext2D): void => {
    g.globalAlpha = clamp(alpha);
    g.lineJoin = 'round';
    g.lineWidth = Math.max(0.7, 0.5 * k.zoom);
    // Edged in its own dark rather than the ink: inked, a flame reads as a crystal.
    g.strokeStyle = deep;
    for (const q of list) {
      g.beginPath();
      g.moveTo(q[0], q[1]);
      for (let j = 2; j < q.length; j += 2) g.lineTo(q[j], q[j + 1]);
      g.closePath();
      g.fillStyle = main;
      g.fill();
      g.stroke();
      // The shaded right side, from the tip down to the middle of the base.
      const cx = (q[0] + q[16]) / 2, cy = q[1];
      g.beginPath();
      g.moveTo(q[8], q[9]);
      for (let j = 10; j < 18; j += 2) g.lineTo(q[j], q[j + 1]);
      g.lineTo(cx, cy);
      g.closePath();
      g.fillStyle = deep;
      g.fill();
      // The bright heart, low in it.
      g.beginPath();
      g.moveTo(lerp(cx, q[0], 0.6), cy);
      g.lineTo(lerp(cx, q[2], 0.55), lerp(cy, q[3], 0.55));
      g.lineTo(lerp(cx, q[4], 0.6), lerp(cy, q[5], 0.6));
      g.lineTo(lerp(cx, q[6], 0.5), lerp(cy, q[7], 0.5));
      g.lineTo(lerp(cx, q[10], 0.45), lerp(cy, q[11], 0.45));
      g.lineTo(lerp(cx, q[14], 0.4), lerp(cy, q[15], 0.4));
      g.lineTo(lerp(cx, q[16], 0.5), cy);
      g.closePath();
      g.fillStyle = core;
      g.fill();
    }
  };
  const foot = { x: b.x, y: b.y, z: b.z };
  if (back.length) k.worldDraw(foot, draw(back, a), -0.4);
  if (front.length) k.worldDraw(foot, draw(front, a * 0.9), 0.8);
  k.glow(k.at(b, 0.7), 10 + H, a * 0.3);
}

/**
 * Torn gashes across a body at `at`: three side by side along the line the
 * axe went, `size` pixels at zoom one long, `open` nought to one how far
 * torn. Each a thin dark split with a wet red lip, ragged along its lower side.
 */
function gashes(k: FxScene, at: P3, size: number, o: { open?: number; alpha?: number; slant?: number; bias?: number; wet?: number }): void {
  const a = o.alpha ?? 1;
  const open = clamp(o.open ?? 1);
  if (a <= 0.01 || open <= 0.01) return;
  const x = k.sx(at), y = k.sy(at), L = size * k.zoom;
  const sl = o.slant ?? 0.9;
  const dx = Math.cos(sl), dy = Math.sin(sl);
  const nx = -dy, ny = dx;
  const cuts: number[][] = [];
  for (let i = 0; i < 3; i++) {
    const off = (i - 1) * L * 0.26;
    const len = L * (i === 1 ? 1 : 0.72) * open;
    const w = L * 0.075 * (0.6 + 0.4 * open);
    // Each starts a little further along than the last, as three edges of one blow drawn across at a slant.
    const cx = x + nx * off - dx * len * 0.5 + dx * (i - 1) * L * 0.12, cy = y + ny * off - dy * len * 0.5 + dy * (i - 1) * L * 0.12;
    const q: number[] = [];
    for (let s = 0; s <= 4; s++) {
      const bulge = Math.sin((Math.PI * s) / 4);
      q.push(cx + dx * len * (s / 4) - nx * w * bulge * (s % 2 ? 1.3 : 0.7), cy + dy * len * (s / 4) - ny * w * bulge * (s % 2 ? 1.3 : 0.7));
    }
    for (let s = 3; s >= 1; s--) {
      const bulge = Math.sin((Math.PI * s) / 4);
      q.push(cx + dx * len * (s / 4) + nx * w * 0.6 * bulge, cy + dy * len * (s / 4) + ny * w * 0.6 * bulge);
    }
    cuts.push(q);
  }
  const wet = clamp(o.wet ?? 0.5);
  const lip = mixHex(DROP, '#ff5a3a', wet * 0.6), ink = k.pal.ink;
  k.worldDraw(at, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'miter';
    for (const q of cuts) {
      g.beginPath();
      g.moveTo(q[0], q[1]);
      for (let j = 2; j < q.length; j += 2) g.lineTo(q[j], q[j + 1]);
      g.closePath();
      g.fillStyle = lip;
      g.fill();
      g.lineWidth = Math.max(0.7, 0.55 * k.zoom);
      g.strokeStyle = ink;
      g.stroke();
      // The depth of it: the upper half dark.
      g.beginPath();
      g.moveTo(q[0], q[1]);
      for (let j = 10; j < q.length; j += 2) g.lineTo(q[j], q[j + 1]);
      g.lineTo(q[8], q[9]);
      g.lineTo((q[4] + q[12]) / 2, (q[5] + q[13]) / 2);
      g.closePath();
      g.fillStyle = DROP_DARK;
      g.fill();
    }
    g.lineJoin = 'round';
  }, o.bias ?? 9);
}

/** Two '#rrggbb' colours mixed, as '#rrggbb' again, for a shape's fill (the kit's `mixColour` gives `rgb()`, which a palette may not hold but a fill may). */
function mixHex(a: string, b: string, u: number): string {
  const pa = parseInt(a.slice(1, 7), 16), pb = parseInt(b.slice(1, 7), 16);
  const ch = (sh: number): number => Math.round(lerp((pa >> sh) & 255, (pb >> sh) & 255, clamp(u)));
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

/** The enemies a blow round the caster reaches: every creature and other person within `r` tiles, the caster left out, at most six. */
const struckBy = (k: FxScene, r: number): Body[] => k.bodiesWithin(r, k.caster, ['creature', 'peer']).slice(0, 6);

/** The head of the weapon in the caster's hands, wherever the pose has put it: the edge of an axe, the face of a maul. */
const axeHead = (k: FxScene): P3 => k.joint(k.caster, 'tip');

/** Blood off a point: `n` drops flung along `dir` (all round without one), falling. */
function blood(k: FxScene, at: P3, n: number, o: { dir?: Ground; cone?: number; speed?: [number, number]; up?: [number, number]; size?: number } = {}): void {
  k.burst(at, n, {
    kind: 'drop', colour: [DROP, DROP, DROP_DARK], size: o.size ?? 2.2, sizeEnd: (o.size ?? 2.2) * 0.6, life: [0.45, 0.8],
    speed: o.speed ?? [0.4, 1.3], up: o.up ?? [6, 22], heading: o.dir, cone: o.cone ?? (o.dir ? 1.6 : undefined), gravity: 70, drag: 0.5, bias: 6,
  });
}

/** A pool of blood on the ground, ragged, `r` tiles. */
const pool = (k: FxScene, c: Ground, r: number, alpha: number): void => k.scorch(c, r, { colour: POOL, alpha });

/** Stone chips and dust thrown up off the ground at a point. */
function rubble(k: FxScene, c: P3, n: number, wide: number): void {
  k.burst(c, n, { kind: 'shard', colour: STONE, size: 2.2, sizeEnd: 1.6, life: [0.45, 0.85], speed: [0.3 * wide, 1.2 * wide], up: [14, 34], gravity: 90, drag: 0.6, spin: 3, bias: 4 });
  k.burst(c, Math.round(n * 0.8), { kind: 'dust', colour: DUST, size: 4, life: [0.6, 1.1], speed: [0.2 * wide, 0.7 * wide], up: [2, 8], gravity: 2, drag: 0.15, jitter: 0.12 });
}

/** A level ring standing in the air round a point, `r` pixels at zoom one across: a ringing blow round a skull. Back half behind what it is round. */
function haloRing(k: FxScene, at: P3, foot: P3, r: number, o: { alpha?: number; width?: number; main?: string } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const x = k.sx(at), y = k.sy(at), R = r * k.zoom, W = (o.width ?? 2.4) * k.zoom;
  const main = o.main ?? k.pal.accent, ink = k.pal.ink;
  const half = (from: number) => (g: CanvasRenderingContext2D): void => {
    g.globalAlpha = clamp(a);
    g.lineCap = 'butt';
    g.beginPath();
    g.ellipse(x, y, R, R * 0.38, 0, from, from + Math.PI);
    g.lineWidth = W + Math.max(1.2, k.zoom);
    g.strokeStyle = ink;
    g.stroke();
    g.lineWidth = W;
    g.strokeStyle = main;
    g.stroke();
  };
  k.worldDraw(foot, half(Math.PI), -0.4);
  k.worldDraw(foot, half(0), 9);
  k.glow(at, r * 1.2, a * 0.35);
}

/* ---- poses ------------------------------------------------------------------------------------------------------ */

/** A key in a pose: at `t`, these numbers. */
type K3 = readonly [number, readonly [number, number, number]];
const e3 = (t: number, keys: readonly K3[]): [number, number, number] => euler(t, keys) as unknown as [number, number, number];
/** A small shake about a pose while something strains or roars, in degrees. */
const shake = (t: number, from: number, to: number, deg: number, hz = 38): number => (t > from && t < to ? Math.sin(t * hz) * deg * Math.sin((Math.PI * (t - from)) / (to - from)) : 0);

/*
 * A blow is written as where the weapon fist goes and which way the weapon's
 * head points from it, and the figure's own reach puts the arm there (`Rig.reach`)
 * and, for a weapon in both hands, the other fist on the haft (`Rig.both`): the
 * head goes exactly where the swing says, whatever the weapon and however the
 * trunk is bent.
 *
 * A key is [t, pitch, yaw, out, lagPitch, lagYaw]: the fist out from the
 * swinging shoulder along `pitch` degrees up from straight down (90 ahead, 180
 * straight up, past it behind the head) and `yaw` degrees round to the right,
 * `out` of an arm's length; the head points along the same line turned by the
 * two lags -- a head hanging back behind the fist in a wind-up lags, at the
 * blow it is in line, and it leads through the follow-through.
 */
type Swing = readonly [t: number, pitch: number, yaw: number, out: number, lagPitch: number, lagYaw: number];
const BUILD = figureProportions();
/** Hips to the swinging shoulder, up the trunk; an arm's length to the middle of the fist. */
const TRUNK = BUILD.spine + BUILD.chest + BUILD.shoulder[2];
const ARM = BUILD.upper + BUILD.lower + BUILD.fist;
const RAD = Math.PI / 180;
const dirOf = (pitch: number, yaw: number): [number, number, number] => {
  const p = pitch * RAD, y = yaw * RAD;
  return [Math.sin(p) * Math.sin(y), Math.sin(p) * Math.cos(y), -Math.cos(p)];
};
/** The cue's weapon is held in both hands: a battle axe or a maul (shouldered), not a hatchet. */
const twoHands = (c: PoseCue): boolean => c.carry === 'shoulder';

function swing(r: Rig, t: number, c: PoseCue, keys: readonly Swing[], o: { both?: number; bothAt?: number } = {}): void {
  const ch = (j: number): number => one(t, keys.map((k) => [k[0], k[j]] as const));
  const pitch = ch(1), yaw = ch(2), out = ch(3);
  // The swinging shoulder, from the hips as the trunk is leant and the knees let the hips down.
  const lean = (r.spine[0] + r.chest[0]) * RAD;
  const knee = ((r.knee[0] + r.knee[1]) / 2) * RAD;
  const hips = BUILD.hips - (BUILD.thigh + BUILD.shin) * (1 - Math.cos(knee / 2)) * (1 - (r.kneel ?? 0)) + (r.lift ?? 0) * 0.5;
  const sh: [number, number, number] = [BUILD.shoulder[0] * 0.55, -Math.sin(lean) * TRUNK, hips + Math.cos(lean) * TRUNK];
  const d = dirOf(pitch, yaw);
  const at: [number, number, number] = [sh[0] + d[0] * ARM * out, sh[1] + d[1] * ARM * out, sh[2] + d[2] * ARM * out];
  r.reach = [r.reach?.[0], { at, haft: dirOf(pitch + ch(4), yaw + ch(5)) }];
  r.carried = 1;
  r.wield = 1;
  if (twoHands(c)) {
    r.both = o.both ?? 1;
    if (o.bothAt !== undefined) r.bothAt = o.bothAt;
  }
}

/* ---- the spells ------------------------------------------------------------------------------------------------- */

/** Overhead Smash's own numbers: how much later the caster's own next swing comes. */
const SMASH_WIND = num('berserker_overhead_smash', 'wind', 1.5);
/** Earthshaker's reach, which its cracks run out to and its edge holds at. */
const QUAKE_R = spellInfo('berserker_earthshaker')?.radius || 3;

/*
 * Whirlwind turns once for each of its blows, from `WHIRL_GO` to `WHIRL_END`
 * of the cast. The axe is held out to the right, so a blow lands a quarter of
 * each turn in, as the blade comes round across the front; the first is the
 * cast's release, and the impact lasts until the last one's ring is out.
 */
const WHIRL_BLOWS = num('berserker_whirlwind', 'blows', 2);
const WHIRL_GO = 0.14;
const WHIRL_END = 0.76;
const WHIRL_SECS = 1.25;
/** Whole turns made by `t` through the cast. */
function whirlTurned(t: number): number {
  return WHIRL_BLOWS * easeInOutSpin(seg(t, WHIRL_GO, WHIRL_END));
}
/** When through the cast blow `i` (from nought) lands. */
function whirlBlow(i: number): number {
  let lo = WHIRL_GO, hi = WHIRL_END;
  for (let j = 0; j < 24; j++) {
    const mid = (lo + hi) / 2;
    if (whirlTurned(mid) < i + 0.25) lo = mid;
    else hi = mid;
  }
  return hi;
}
const WHIRL_FIRST = whirlBlow(0);
const WHIRL_IMPACT = (whirlBlow(WHIRL_BLOWS - 1) - WHIRL_FIRST) * WHIRL_SECS + 0.45;

export const BERSERKER: Record<string, SpellVisual> = {
  // Wild Swing (strike, on enemy): A blow at 140% that misses twice as often as a swing does.
  //
  // A haymaker swung flat from far round the right, so hard the body follows it round and the back foot has to
  // stumble across to catch it. The cut wanders as it goes, and a second, fainter one wanders beside it: a blow
  // that could land anywhere.
  berserker_wild_swing: {
    palette: PALETTE,
    cast: {
      timing: { secs: 0.85, release: 0.4 },
      pose: (r, t, c) => {
        r.pelvis = e3(t, [[0, [0, 0, 0]], [0.3, [0, 0, -24]], [0.4, [0, 0, 6]], [0.6, [0, 0, 34]], [0.8, [0, 0, 18]], [1, [0, 0, 0]]]);
        r.spine = e3(t, [[0, [0, 0, 0]], [0.3, [4, -4, -18]], [0.4, [-10, 4, 6]], [0.6, [-14, 8, 24]], [0.8, [-4, 2, 8]], [1, [0, 0, 0]]]);
        r.chest = e3(t, [[0, [0, 0, 0]], [0.3, [4, -6, -30]], [0.4, [-6, 4, 8]], [0.6, [-6, 6, 34]], [1, [0, 0, 0]]]);
        r.head = e3(t, [[0, [0, 0, 0]], [0.3, [-4, 4, 40]], [0.4, [-4, 0, -10]], [0.6, [6, -8, -30]], [0.8, [0, 0, -8]], [1, [0, 0, 0]]]);
        // Weight back on the right foot for the wind, thrown onto the left, then the right stumbling across to catch it.
        r.leg[0] = e3(t, [[0, [2, 2, 0]], [0.3, [10, 6, 0]], [0.4, [22, 4, 10]], [0.6, [26, 2, 20]], [1, [4, 2, 0]]]);
        r.knee[0] = one(t, [[0, 4], [0.3, 10], [0.4, 30], [0.6, 34], [1, 6]]);
        r.leg[1] = e3(t, [[0, [0, 2, 0]], [0.3, [-12, 6, 0]], [0.45, [-18, 2, 0]], [0.58, [30, -14, 20]], [0.7, [16, -10, 14]], [1, [-2, 2, 0]]]);
        r.knee[1] = one(t, [[0, 4], [0.3, 22], [0.45, 16], [0.58, 46], [0.7, 18], [1, 5]]);
        r.at = e3(t, [[0, [0, 0, 0]], [0.3, [0, -1, 0]], [0.4, [0, 3, 0]], [0.62, [-2, 6, 0]], [1, [0, 0, 0]]]);
        r.mouth = one(t, [[0, 0], [0.32, 0.2], [0.4, 0.75], [0.6, 0.5], [0.85, 0]]);
        // Flat round from far behind the right shoulder, the head dragging, through level, and on across to the left.
        swing(r, t, c, [[0, 35, 20, 0.6, 115, 0], [0.3, 100, 118, 0.85, 0, 45], [0.35, 102, 122, 0.85, 0, 50], [0.4, 92, 6, 1, 0, -4], [0.5, 88, -55, 0.95, 0, -20], [0.62, 76, -95, 0.85, 0, -30], [0.8, 50, -40, 0.7, 50, 0], [1, 35, 20, 0.6, 115, 0]]);
        if (!twoHands(c)) {
          // A hatchet in one hand: the other flung out to balance the throw of the body.
          r.arm[0] = e3(t, [[0, [20, 12, 0]], [0.3, [70, 4, 30]], [0.4, [30, 40, 0]], [0.6, [10, 60, -10]], [1, [8, 12, 0]]]);
          r.elbow[0] = one(t, [[0, 30], [0.3, 70], [0.4, 30], [0.6, 20], [1, 24]]);
          r.open[0] = t > 0.38 && t < 0.75;
        }
      },
    },
    fx: {
      charge: (k, t) => {
        k.glow(axeHead(k), 5, 0.5 * seg(t, 0.12, 0.32));
        const reach = cutReach(k, 16, 30);
        const u = seg(t, 0.32, 0.46);
        const fade = 1 - seg(t, 0.46, 0.62);
        if (u > 0) {
          rent(k, { u, from: 1.9, to: -2.1, tilt: 1.32, reach, up: k.caster.tall * 0.6, width: 11, length: 2.2, wobble: 0.14, alpha: fade });
          // The wild second edge, wide of the first and late.
          rent(k, { u: seg(t, 0.35, 0.5), from: 1.7, to: -2.3, tilt: 1.18, reach: reach * 0.84, up: k.caster.tall * 0.8, width: 6, length: 1.6, wobble: 0.24, alpha: 0.5 * fade, glow: 0.3 });
        }
      },
      hit: (k) => {
        const at = k.heart(k.target);
        const along = k.toward(k.caster, k.target);
        // The cut runs right to left across the target: the sparks go off to the caster's left.
        const left = { x: along.y, y: -along.x };
        k.burst(at, 26, { kind: 'spark', size: 2.2, life: [0.25, 0.5], speed: [1.2, 2.6], up: [2, 24], heading: { x: left.x * 0.8 + along.x * 0.6, y: left.y * 0.8 + along.y * 0.6 }, cone: 1.3, gravity: 60, drag: 0.1 });
        blood(k, at, 8, { dir: left, cone: 1.2 });
        k.burst(k.at(k.caster, 0.05), 8, { kind: 'dust', colour: DUST, size: 3.4, life: [0.5, 0.9], speed: [0.2, 0.5], up: [2, 6], gravity: 2 });
      },
      impact: { secs: 0.55, draw: (k, u) => {
        const at = k.heart(k.target);
        starburst(k, at, 11 * (1.15 - 0.5 * u), { alpha: flashOf(u, 0.1), points: 6 });
        k.light(k.target, 2.6, 0.7 * (1 - u));
      } },
    },
  },

  // Shrug It Off (buff, on self): Your worst wound is 50% less severe, and it stops bleeding.
  //
  // Hunched over the hurt, dripping; then a roll of one shoulder and the other that flings the blood off, and the
  // chest thrown out. The wound is seared shut: a zigzag of heat across the chest that cools from white through
  // ember to a dark seam, hissing, and a small ring of teeth knocked out round the feet.
  berserker_shrug_it_off: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.0, release: 0.5 },
      pose: (r, t) => {
        r.shrug = [one(t, [[0, 0], [0.25, 0.2], [0.36, 1.4], [0.44, 0.3], [0.5, 1.1], [0.58, 0], [1, 0]]), one(t, [[0, 0], [0.25, 0.2], [0.32, 0.4], [0.4, 1.4], [0.48, 0.3], [0.54, 1.0], [0.62, 0], [1, 0]])];
        r.chest = e3(t, [[0, [0, 0, 0]], [0.25, [-14, 0, 0]], [0.36, [-6, 8, 6]], [0.44, [-4, -8, -6]], [0.5, [12, 0, 0]], [0.62, [10, 0, 0]], [1, [0, 0, 0]]]);
        r.spine = e3(t, [[0, [0, 0, 0]], [0.25, [-8, 0, 0]], [0.5, [6, 0, 0]], [1, [0, 0, 0]]]);
        r.neck = e3(t, [[0, [0, 0, 0]], [0.25, [-12, 0, 0]], [0.36, [-4, 14, 0]], [0.44, [-4, -14, 0]], [0.5, [6, 0, 0]], [1, [0, 0, 0]]]);
        r.head = e3(t, [[0, [0, 0, 0]], [0.25, [-14, 0, 0]], [0.36, [0, 10, 0]], [0.44, [0, -10, 0]], [0.5, [10, 0, 0]], [0.65, [6, 0, 0]], [1, [0, 0, 0]]]);
        // Hunched with the left hand clamped over the wound; then both fists clenched as the chest goes out.
        r.arm[0] = e3(t, [[0, [10, 10, 0]], [0.25, [34, -14, 34]], [0.42, [30, -8, 28]], [0.5, [-14, 26, 0]], [0.62, [-12, 24, 0]], [1, [8, 10, 0]]]);
        r.elbow[0] = one(t, [[0, 30], [0.25, 112], [0.42, 100], [0.5, 34], [1, 24]]);
        r.arm[1] = e3(t, [[0, [10, 10, 0]], [0.25, [20, 4, 10]], [0.45, [24, 22, 10]], [0.5, [-14, 26, 0]], [0.62, [-12, 24, 0]], [1, [8, 10, 0]]]);
        r.elbow[1] = one(t, [[0, 30], [0.25, 70], [0.45, 60], [0.5, 34], [1, 24]]);
        r.shape = [{ cup: one(t, [[0, 0], [0.2, 1], [0.44, 1], [0.5, 0]]), claw: one(t, [[0.44, 0], [0.5, 0.5], [0.7, 0.5], [0.9, 0]]) }, { claw: one(t, [[0.44, 0], [0.5, 0.5], [0.7, 0.5], [0.9, 0]]) }];
        r.mouth = one(t, [[0, 0], [0.25, 0.25], [0.45, 0.15], [0.52, 0.55], [0.7, 0.3], [1, 0]]);
        r.knee = [one(t, [[0, 4], [0.25, 22], [0.5, 2], [1, 4]]), one(t, [[0, 4], [0.25, 22], [0.5, 2], [1, 4]])];
        r.leg = [e3(t, [[0, [2, 2, 0]], [0.25, [10, 6, 0]], [0.5, [0, 8, 0]], [1, [2, 2, 0]]]), e3(t, [[0, [2, 2, 0]], [0.25, [10, 6, 0]], [0.5, [0, 8, 0]], [1, [2, 2, 0]]])];
        r.carried = 1;
      },
    },
    fx: {
      charge: (k, t) => {
        // The wound dripping while hunched over it, then flung off by each roll of the shoulders.
        if (t < 0.32) k.emit(k.chest(), 10 * seg(t, 0.05, 0.25), { kind: 'drop', colour: DROP, size: 1.8, life: [0.4, 0.6], speed: [0, 0.08], up: [-2, 2], gravity: 60, bias: 6 });
        for (const [at, side] of [[0.36, 1], [0.44, -1]] as const) {
          if ((k.state[`f${side}`] ?? 0) === 0 && t >= at) {
            k.state[`f${side}`] = 1;
            const f = k.facingDir(k.caster);
            blood(k, k.chest(), 9, { dir: { x: -f.y * side, y: f.x * side }, cone: 1.6, speed: [0.5, 1.3], up: [10, 22], size: 1.9 });
          }
        }
      },
      release: (k) => {
        k.burst(k.at(k.caster, 0.05), 10, { kind: 'dust', colour: DUST, size: 3.2, life: [0.5, 0.8], speed: [0.4, 0.7], up: [1, 4], gravity: 2, drag: 0.1 });
        k.burst(k.chest(), 14, { kind: 'ember', colour: [k.pal.core, k.pal.accent], size: 1.8, life: [0.3, 0.6], speed: [0.2, 0.6], up: [4, 16], gravity: 10 });
      },
      impact: { secs: 1.3, draw: (k, u) => {
        // The seal: a zigzag seared across the chest, white-hot, cooling through the ember to a dark seam.
        const heat = 1 - smooth(seg(u, 0.08, 0.8));
        const a = smooth(u / 0.05) * (1 - smooth(seg(u, 0.75, 1)));
        const b = k.caster;
        const c = k.chest();
        const f = k.facingDir(b);
        const pts: P3[] = [];
        for (let i = 0; i < 7; i++) {
          const s = (i / 6 - 0.5) * 4.4;
          pts.push({ x: c.x - (f.y * s) / 40, y: c.y + (f.x * s) / 40, z: c.z + (i % 2 ? 0.8 : -0.8) * (1 - 0.4 * Math.abs(i / 6 - 0.5)) + 0.3 });
        }
        band(k, pts, { width: 1.9, alpha: a, taper: 'both', main: mixHex(DROP_DARK, k.pal.accent, heat), core: mixHex(DROP, k.pal.core, heat), glow: heat, bias: 10 });
        if (!k.fast && u < 0.7) k.emit(c, 9 * heat, { kind: 'smoke', colour: '#d9cfc6', size: 1.4, sizeEnd: 3.6, life: [0.4, 0.7], speed: [0.03, 0.1], up: [8, 14], gravity: -4, jitter: 0.04, bias: 10 });
        sawRing(k, b, 0.24 + 0.4 * easeOut(u * 1.8), { teeth: 18, alpha: 0.8 * (1 - smooth(seg(u, 0.1, 0.5))), tooth: 0.07, wide: 0.08, turn: 0.3 + u });
        k.light(b, 2.0, 0.55 * heat);
      } },
    },
  },

  // Rending Chop (strike, on enemy): With an axe in hand: a blow at 110% that bleeds it as a knife does, 15% of the blow a second for 6 s.
  //
  // A one-armed chop down across from high on the right, the axe let bite and then wrenched back out toward the hip:
  // the wrench is what tears the wound. Three ragged gashes stay open on the creature for the bleed's seconds, wet
  // again and dripping at every second's tick, a pool spreading under it.
  berserker_rending_chop: {
    palette: PALETTE,
    cast: {
      timing: { secs: 0.9, release: 0.38 },
      pose: (r, t, c) => {
        r.chest = e3(t, [[0, [0, 0, 0]], [0.3, [6, -6, -26]], [0.38, [-10, 6, 18]], [0.46, [-10, 6, 18]], [0.58, [4, 0, -16]], [1, [0, 0, 0]]]);
        r.spine = e3(t, [[0, [0, 0, 0]], [0.3, [6, 0, -8]], [0.38, [-16, 0, 8]], [0.46, [-16, 0, 8]], [0.58, [4, 0, -8]], [1, [0, 0, 0]]]);
        r.head = e3(t, [[0, [0, 0, 0]], [0.3, [-4, 0, 18]], [0.38, [8, 0, -10]], [0.58, [-4, 0, 6]], [1, [0, 0, 0]]]);
        r.leg[0] = e3(t, [[0, [2, 2, 0]], [0.3, [8, 3, 0]], [0.38, [28, 4, 0]], [0.58, [20, 4, 0]], [1, [4, 2, 0]]]);
        r.knee[0] = one(t, [[0, 4], [0.38, 30], [0.58, 18], [1, 6]]);
        r.leg[1] = e3(t, [[0, [0, 2, 0]], [0.38, [-16, 2, 0]], [0.58, [-10, 2, 0]], [1, [-2, 2, 0]]]);
        r.knee[1] = one(t, [[0, 4], [0.38, 16], [0.58, 22], [1, 5]]);
        r.at = e3(t, [[0, [0, 0, 0]], [0.38, [0, 3, 0]], [0.46, [0, 3, 0]], [0.6, [0, -1, 0]], [1, [0, 0, 0]]]);
        r.mouth = one(t, [[0, 0], [0.36, 0.3], [0.46, 0.4], [0.56, 0.8], [0.72, 0.2], [1, 0]]);
        // Down across from high on the right, let bite, then wrenched back out toward the hip with the head still forward.
        swing(r, t, c, [[0, 35, 20, 0.6, 115, 0], [0.3, 165, 38, 0.85, 65, 0], [0.38, 80, -10, 1, -5, 0], [0.46, 76, -12, 1, -5, 0], [0.58, 32, 28, 0.55, 55, -20], [0.72, 40, 28, 0.6, 70, -10], [1, 35, 20, 0.6, 115, 0]]);
        if (!twoHands(c)) {
          r.arm[0] = e3(t, [[0, [20, 12, 0]], [0.3, [56, 4, 24]], [0.38, [18, 30, 0]], [0.58, [40, 20, 10]], [1, [8, 12, 0]]]);
          r.elbow[0] = one(t, [[0, 30], [0.3, 96], [0.38, 30], [0.58, 70], [1, 24]]);
        }
      },
    },
    fx: {
      charge: (k, t) => {
        k.glow(axeHead(k), 4.5, 0.55 * seg(t, 0.1, 0.3));
        const u = seg(t, 0.3, 0.4);
        if (u > 0) rent(k, { u, from: 2.3, to: -0.9, tilt: 0.75, reach: cutReach(k, 15, 26), width: 9, length: 1.8, alpha: 1 - seg(t, 0.42, 0.6) });
      },
      hit: (k) => {
        const at = k.heart(k.target);
        k.burst(at, 14, { kind: 'spark', size: 2, life: [0.2, 0.45], speed: [0.8, 2], up: [0, 18], heading: k.toward(k.caster, k.target), cone: 1.8, gravity: 60 });
        blood(k, at, 10, { dir: k.toward(k.caster, k.target), cone: 1.4 });
      },
      impact: { secs: 0.5, draw: (k, u) => {
        const at = k.heart(k.target);
        starburst(k, at, 9 * (1 - 0.4 * u), { points: 5, alpha: flashOf(u, 0.05) * 0.9 });
        // The wrench out, a fifth of a second on: the wound torn wider and the blood pulled after the axe.
        if ((k.state.wrench ?? 0) === 0 && u > 0.36) {
          k.state.wrench = 1;
          blood(k, at, 16, { dir: k.toward(k.target, k.caster), cone: 1.1, speed: [0.6, 1.6], up: [8, 20], size: 2.4 });
        }
        k.light(k.target, 2.2, 0.6 * (1 - u));
      } },
      linger: {
        secs: KNIFE_BLEED_SECS,
        draw: (k, age, left) => {
          const b = k.target;
          const at = k.heart(b);
          const size = Math.max(6, b.tall * 0.36);
          // Each second's bleed: the gashes wet again and a drop or two falling from them.
          const pulse = 1 - smooth((age % 1) / 0.4);
          const fade = smooth(left / 0.8);
          gashes(k, at, size, { open: easeOut(age / 0.2) * (0.75 + 0.25 * easeOut(seg(age, 0.2, 0.5))), alpha: fade, wet: pulse });
          const n = Math.floor(age);
          if ((k.state.tick ?? -1) < n) {
            k.state.tick = n;
            blood(k, at, 4, { speed: [0.02, 0.15], up: [-4, 4], size: 2 });
          }
          pool(k, b, 0.1 + 0.2 * smooth(age / KNIFE_BLEED_SECS), 0.7 * smooth(left / 1));
          k.glow(at, 5, 0.45 * pulse * fade, DROP);
        },
      },
    },
  },

  // Skull Crack (strike, on enemy, lasts 2 s): With a maul in hand: a blow at 120% that holds it where it stands, neither moving nor striking, for 2 s;
  //
  // Short and brutal: the maul cocked behind the head on both hands, up on the toes, and brought straight down on
  // the skull, stopping dead at head height with a bounce. The blow rings round the head twice; then, for the
  // hold, three sparks circle it dazed while a band round its feet closes, all the way shut as the hold lets go.
  berserker_skull_crack: {
    palette: PALETTE,
    cast: {
      timing: { secs: 0.65, release: 0.45 },
      pose: (r, t, c) => {
        r.spine = e3(t, [[0, [0, 0, 0]], [0.32, [12, 0, 0]], [0.45, [-14, 0, 0]], [0.52, [-14, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = e3(t, [[0, [0, 0, 0]], [0.32, [8, 0, -6]], [0.45, [-10, 0, 4]], [1, [0, 0, 0]]]);
        r.head = e3(t, [[0, [0, 0, 0]], [0.32, [-14, 0, 0]], [0.45, [6, 0, 0]], [1, [0, 0, 0]]]);
        r.lift = one(t, [[0, 0], [0.3, 0.8], [0.4, 0.4], [0.45, 0], [1, 0]]);
        r.leg[0] = e3(t, [[0, [2, 2, 0]], [0.32, [6, 3, 0]], [0.45, [22, 4, 0]], [1, [4, 2, 0]]]);
        r.knee[0] = one(t, [[0, 4], [0.32, 6], [0.45, 30], [0.55, 26], [1, 6]]);
        r.leg[1] = e3(t, [[0, [0, 2, 0]], [0.45, [-12, 2, 0]], [1, [-2, 2, 0]]]);
        r.knee[1] = one(t, [[0, 4], [0.45, 18], [1, 5]]);
        r.at = e3(t, [[0, [0, 0, 0]], [0.45, [0, 2.5, 0]], [1, [0, 0, 0]]]);
        r.mouth = one(t, [[0, 0], [0.3, 0.1], [0.45, 0.7], [0.6, 0.3], [1, 0]]);
        // Cocked behind the head, the head of it hanging down the back; brought straight over to stop dead level, and a bounce.
        swing(r, t, c, [[0, 35, 20, 0.6, 115, 0], [0.32, 200, 4, 0.8, 85, 0], [0.45, 90, 0, 1, 2, 0], [0.52, 88, 0, 1, 3, 0], [0.6, 100, 0, 0.95, -6, 0], [1, 35, 20, 0.6, 115, 0]]);
      },
    },
    fx: {
      charge: (k, t) => {
        k.glow(axeHead(k), 5, 0.6 * seg(t, 0.1, 0.32) * (1 - seg(t, 0.46, 0.6)));
        const u = seg(t, 0.36, 0.46);
        if (u > 0) rent(k, { u, from: 2.7, to: 0.25, tilt: 0.12, reach: cutReach(k, 14, 22), up: k.caster.tall * 0.7, width: 8, length: 1.3, alpha: 1 - seg(t, 0.48, 0.62) });
      },
      hit: (k) => {
        const skull = k.at(k.target, 0.86);
        k.burst(skull, 22, { kind: 'spark', colour: [k.pal.core, k.pal.accent], size: 2, life: [0.2, 0.45], speed: [1, 2.2], up: [6, 26], gravity: 50 });
        k.burst(k.at(k.target, 0.04), 8, { kind: 'dust', colour: DUST, size: 3.4, life: [0.5, 0.9], speed: [0.3, 0.6], up: [1, 5], gravity: 2 });
      },
      impact: { secs: 0.6, draw: (k, u) => {
        const b = k.target;
        const skull = k.at(b, 0.86);
        starburst(k, skull, 10 * (1 - 0.35 * u), { points: 8, alpha: flashOf(u, 0.06) });
        // The blow ringing round the head, twice, as a bell does.
        for (let i = 0; i < 2; i++) {
          const v = seg(u, i * 0.22, 0.6 + i * 0.22);
          if (v > 0 && v < 1) haloRing(k, skull, { x: b.x, y: b.y, z: b.z }, 5 + 13 * easeOut(v), { alpha: 1 - v, width: 2.6 * (1 - v) + 0.6 });
        }
        cracks(k, b, 0.32, { n: 5, grow: easeOut(u * 3), heat: 0.6 * (1 - u), alpha: 1 - smooth(seg(u, 0.6, 1)), salt: 3, width: 1.6 });
        k.light(b, 2.4, 0.7 * (1 - u));
      } },
      linger: {
        draw: (k, age, left) => {
          const b = k.target;
          const hold = age + left;
          const a = smooth(age / 0.2) * smooth(left / 0.25);
          // Three dazed sparks circling the skull.
          const skull = k.at(b, 1.0);
          for (let i = 0; i < 3; i++) {
            const an = age * 5.5 + (i * TAU) / 3;
            const p = k.local(b, Math.cos(an) * b.wide * 1.3, Math.sin(an) * b.wide * 1.3, skull.z - b.z + Math.sin(an * 2) * 0.6);
            k.mark(p, { r: 2.6, points: 4, turn: age * 7 + i, alpha: a, bias: Math.sin(an) < 0 ? 4 : -4, glow: 0.7 });
          }
          // The hold: a band round the feet, closing as it runs out.
          const R = Math.max(0.24, (b.wide / 40) * 2.6);
          const gone = (age / hold) * TAU;
          arcs(k, b, R, 0.045, [[-Math.PI / 2 + gone, Math.PI * 1.5]], { alpha: 0.9 * a, main: k.pal.accent, deep: k.pal.main });
        },
      },
    },
  },

  // Battle Rage (buff, on self, lasts 15 s): For 15 s you deal 30% more damage and take 20% more.
  //
  // Crouched and gathering, fists in, then up into a war cry: the weapon thrust at the sky, the other fist down and
  // out, chest out and head back, the cry going out ahead as torn rings. Fire licks up off the shoulders and the
  // fists for as long as it lasts, and a ring of small teeth round the feet, one for each second, loses one a second.
  berserker_battle_rage: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.3, release: 0.5 },
      pose: (r, t, c) => {
        const q = shake(t, 0.5, 0.8, 3);
        r.arm[0] = e3(t, [[0, [12, 10, 0]], [0.32, [36, -10, 34]], [0.5, [-8, 34, 0]], [0.8, [-10, 36, 0]], [1, [10, 10, 0]]]);
        r.elbow[0] = one(t, [[0, 24], [0.32, 124], [0.5, 22], [0.8, 24], [1, 24]]);
        r.chest = e3(t, [[0, [0, 0, 0]], [0.32, [-16, 0, 0]], [0.5, [12 + q, -4, 6]], [0.8, [10, -4, 6]], [1, [0, 0, 0]]]);
        r.spine = e3(t, [[0, [0, 0, 0]], [0.32, [-12, 0, 0]], [0.5, [6, 0, 0]], [1, [0, 0, 0]]]);
        r.neck = e3(t, [[0, [0, 0, 0]], [0.32, [-10, 0, 0]], [0.5, [6, 0, 0]], [1, [0, 0, 0]]]);
        r.head = e3(t, [[0, [0, 0, 0]], [0.32, [-14, 0, 0]], [0.5, [24 + q, 0, 0]], [0.8, [22, 0, 0]], [1, [0, 0, 0]]]);
        r.shrug = [one(t, [[0, 0], [0.32, 0.8], [0.5, 0.2], [1, 0]]), one(t, [[0, 0], [0.5, 1.4], [0.8, 1.2], [1, 0]])];
        for (let s = 0; s < 2; s++) {
          r.leg[s] = e3(t, [[0, [2, 2, 0]], [0.32, [24, 10, 0]], [0.5, [4, 13, 0]], [0.8, [4, 13, 0]], [1, [2, 2, 0]]]);
          r.knee[s] = one(t, [[0, 4], [0.32, 48], [0.5, 8], [0.8, 10], [1, 4]]);
        }
        r.shape = [{ claw: one(t, [[0.4, 0], [0.5, 0.7], [0.8, 0.7], [0.95, 0]]) }, undefined];
        r.mouth = one(t, [[0, 0], [0.32, 0.1], [0.46, 1], [0.8, 1], [0.95, 0]]);
        // Gathered in front of the chest, then thrust straight at the sky in one fist, the head of it up.
        swing(r, t, c, [[0, 35, 20, 0.6, 115, 0], [0.32, 40, 25, 0.5, 95, 0], [0.44, 150, 10, 0.9, 20, 0], [0.5, 174, 8, 1, 4, 0], [0.8, 172 + q, 8, 1, 4, 0], [1, 35, 20, 0.6, 115, 0]], { both: 0 });
      },
    },
    fx: {
      charge: (k, t) => {
        const g = seg(t, 0.05, 0.45);
        // Heat drawn in toward the body from round it while it gathers.
        if (t < 0.48) {
          for (let i = 0; i < 2; i++) {
            const an = k.rand() * TAU, rr = 0.7 + 0.4 * k.rand();
            const p = k.on(k.caster.x + Math.cos(an) * rr, k.caster.y + Math.sin(an) * rr, 2 + 10 * k.rand());
            if (k.rand() < 0.6 * g) k.burst(p, 1, { kind: 'ember', size: 1.8, life: [0.25, 0.4], speed: [1.6, 2.4], up: [2, 10], heading: { x: -Math.cos(an), y: -Math.sin(an) }, cone: 0.2, gravity: 0, drag: 0.3 });
          }
        }
        k.scorch(k.caster, 0.3 * (0.5 + 0.5 * g), { colour: EARTH, alpha: 0.3 * g * (1 - seg(t, 0.6, 0.95)) });
        k.glow(k.chest(), 7, 0.5 * g);
      },
      release: (k) => {
        k.burst(axeHead(k), 30, { kind: 'ember', colour: [k.pal.core, k.pal.accent, k.pal.main], size: 2, life: [0.4, 0.8], speed: [0.4, 1.1], up: [6, 26], gravity: 8, drag: 0.2 });
        k.burst(k.at(k.caster, 0.05), 12, { kind: 'dust', colour: DUST, size: 4, life: [0.5, 1], speed: [0.6, 1.1], up: [1, 4], gravity: 2, drag: 0.1 });
      },
      impact: { secs: 0.85, draw: (k, u) => {
        const b = k.caster;
        // The cry: three torn rings going out ahead of the face, one after the other.
        for (let i = 0; i < 3; i++) {
          const v = seg(u, i * 0.13, 0.5 + i * 0.13);
          if (v > 0 && v < 1) shout(k, b, v, 0.95 * (1 - v * v));
        }
        sawRing(k, b, 0.3 + 1.0 * easeOut(u), { teeth: 30, alpha: 0.85 * (1 - smooth(seg(u, 0.25, 0.9))), tooth: 0.12, wide: 0.1, turn: u * 0.4 });
        k.flare(axeHead(k), 9, flashOf(u, 0.08), k.pal.core);
        k.light(b, 3.5, 0.8 * (1 - u));
      } },
      linger: {
        draw: (k, age, left) => {
          const b = k.caster;
          const all = age + left;
          const a = smooth(age / 0.4) * smooth(left / 0.6);
          warFire(k, b, { n: 8, h: 6, alpha: 0.95 * a, main: RAGE_FIRE.main, deep: RAGE_FIRE.deep, core: RAGE_FIRE.core });
          // A tooth for every second of it, one burning away each second.
          const secs = Math.round(k.fx.secs ?? all);
          sawRing(k, b, 0.34, { teeth: secs, left: left / all, alpha: 0.7 * a, turn: -Math.PI / 2, tooth: 0.09, wide: 0.09, glow: 0.3 });
          if (!k.fast) k.emit(k.at(b, 0.75), 8 * a, { kind: 'ember', colour: [k.pal.accent, k.pal.core], size: 1.6, life: [0.4, 0.8], speed: [0.05, 0.2], up: [12, 22], gravity: 0, jitter: 0.12 });
          k.light(b, 2.4, (0.32 + 0.08 * Math.sin(age * 11)) * a);
        },
      },
    },
  },

  // Adrenaline (buff, on self, lasts 10 s): Costs no stamina. For 10 s a swing or a draw costs no stamina and takes 15% less time.
  //
  // A sharp breath in and two thumps of the left fist on the chest, up on the toes: the heart kicking. For as long
  // as it lasts the heart beats fast and bright (a double pulse off the chest and round the feet), quick amber
  // streaks run up the body, and a ring of ticks round the feet, one a second, goes out a tick at a time.
  berserker_adrenaline: {
    palette: PALETTE,
    cast: {
      timing: { secs: 0.75, release: 0.3 },
      pose: (r, t) => {
        r.arm[0] = e3(t, [[0, [10, 10, 0]], [0.18, [56, -16, 44]], [0.24, [40, -10, 30]], [0.3, [58, -18, 46]], [0.36, [40, -10, 30]], [0.42, [58, -18, 46]], [0.6, [40, -6, 30]], [1, [8, 10, 0]]]);
        r.elbow[0] = one(t, [[0, 20], [0.18, 118], [0.24, 90], [0.3, 124], [0.36, 90], [0.42, 124], [0.6, 100], [1, 20]]);
        r.arm[1] = e3(t, [[0, [20, 14, 0]], [0.2, [36, 30, -10]], [0.5, [40, 34, -10]], [1, [20, 14, 0]]]);
        r.elbow[1] = one(t, [[0, 50], [0.2, 80], [1, 50]]);
        r.chest = e3(t, [[0, [0, 0, 0]], [0.18, [12, 0, 0]], [0.3, [4, 0, 0]], [0.36, [8, 0, 0]], [0.42, [3, 0, 0]], [0.6, [8, 0, 0]], [1, [0, 0, 0]]]);
        r.head = e3(t, [[0, [0, 0, 0]], [0.18, [14, 0, 0]], [0.3, [-4, 0, 10]], [0.42, [-4, 0, -10]], [0.6, [-6, 0, 0]], [1, [0, 0, 0]]]);
        r.shrug = [one(t, [[0, 0], [0.18, 1.2], [0.3, 0.3], [1, 0]]), one(t, [[0, 0], [0.18, 1.2], [0.3, 0.3], [1, 0]])];
        // The sharp breath in through an open mouth, the teeth set for the thumps, and the breath out.
        r.mouth = one(t, [[0, 0], [0.16, 0.55], [0.24, 0.1], [0.42, 0.1], [0.56, 0.4], [0.8, 0]]);
        // Up on the toes and bouncing with the beats.
        r.lift = one(t, [[0, 0], [0.18, 0.6], [0.3, 0.1], [0.36, 0.6], [0.42, 0.1], [0.5, 0.5], [0.6, 0.1], [1, 0]]);
        for (let s = 0; s < 2; s++) {
          r.foot[s] = one(t, [[0, 0], [0.18, -22], [0.6, -18], [1, 0]]);
          r.knee[s] = one(t, [[0, 4], [0.3, 14], [0.42, 14], [0.6, 10], [1, 4]]);
        }
        r.carried = 1;
      },
    },
    fx: {
      charge: (k, t) => {
        k.glow(k.chest(), 6, 0.6 * seg(t, 0.05, 0.28), QUICK.main);
      },
      release: (k) => heartbeat(k, 1),
      impact: { secs: 0.5, draw: (k, u) => {
        // The second thump, a twentieth of the cast on.
        if ((k.state.dub ?? 0) === 0 && u > 0.2) {
          k.state.dub = 1;
          heartbeat(k, 0.8);
        }
        k.ring(k.caster, 0.2 + 0.55 * easeOut(u), { band: 0.05, alpha: 0.9 * (1 - u), main: QUICK.main, deep: QUICK.deep, glow: 0.6 });
      } },
      linger: {
        draw: (k, age, left) => {
          const b = k.caster;
          const all = age + left;
          const a = smooth(age / 0.3) * smooth(left / 0.6);
          // The heart: a double beat every half second, off the chest and round the feet.
          const beat = (age % 0.55) / 0.55;
          const p1 = 1 - smooth(beat / 0.18), p2 = 1 - smooth(seg(beat, 0.2, 0.4));
          const pulse = Math.max(p1, 0.7 * p2);
          const heart = k.chest();
          k.glow(heart, 4 + 4 * pulse, (0.3 + 0.6 * pulse) * a, QUICK.main);
          k.flare(heart, 3 + 4 * pulse, pulse * a, QUICK.core);
          k.ring(b, 0.26 + 0.2 * (1 - p1), { band: 0.03, alpha: 0.5 * p1 * a, main: QUICK.main, deep: QUICK.deep, glow: 0.3 });
          // A tick for every second of it.
          const secs = Math.round(k.fx.secs ?? all);
          const lit = Math.ceil((left / all) * secs - 1e-6);
          const spans: Array<[number, number]> = [];
          for (let i = 0; i < lit; i++) {
            const an = -Math.PI / 2 + (i / secs) * TAU;
            spans.push([an + 0.12, an + TAU / secs - 0.12]);
          }
          arcs(k, b, 0.4, 0.035, spans, { alpha: 0.65 * a, main: QUICK.main, deep: QUICK.deep, glow: 0.2 });
          // Quick streaks running up the body.
          k.emit(k.at(b, 0.15), 14 * a, { kind: 'spark', colour: [QUICK.core, QUICK.main], size: 1.4, life: [0.16, 0.28], speed: [0, 0.03], up: [70, 110], gravity: 0, drag: 1, jitter: 0.11, jitterZ: 4 });
        },
      },
    },
  },

  // Blood Price (strike, on enemy): Costs no stamina but 10% of your health: a blow at 250%.
  //
  // The price paid first: the axe held up before the face and the left palm drawn down its edge, the blood
  // flying off the hand; the blade runs red and drips. Then a huge two-handed downstroke in blood, splashing the
  // creature and the ground, and blood off the caster as it lands -- the tenth of their health it took.
  berserker_blood_price: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.35, release: 0.58 },
      pose: (r, t, c) => {
        const q = shake(t, 0.14, 0.3, 1.5, 70);
        r.chest = e3(t, [[0, [0, 0, 0]], [0.14, [4, 0, 0]], [0.31, [-6, 0, -10]], [0.5, [12, 0, -10]], [0.58, [-14, 0, 10]], [0.64, [-14, 0, 10]], [0.8, [6, 0, 0]], [1, [0, 0, 0]]]);
        r.spine = e3(t, [[0, [0, 0, 0]], [0.31, [-4, 0, 0]], [0.5, [12, 0, -4]], [0.58, [-24, 0, 6]], [0.64, [-24, 0, 6]], [0.8, [2, 0, 0]], [1, [0, 0, 0]]]);
        r.head = e3(t, [[0, [0, 0, 0]], [0.14, [6, 0, 0]], [0.26, [6, 0, 0]], [0.31, [-16, 0, 10]], [0.5, [-12, 0, 0]], [0.58, [16, 0, 0]], [0.8, [4, 0, 0]], [1, [0, 0, 0]]]);
        r.shrug = [one(t, [[0, 0], [0.64, 0], [0.74, 0.9], [0.84, 0.1], [0.92, 0.7], [1, 0]]), one(t, [[0, 0], [0.64, 0], [0.74, 0.9], [0.84, 0.1], [0.92, 0.7], [1, 0]])];
        r.leg[0] = e3(t, [[0, [2, 2, 0]], [0.5, [8, 4, 0]], [0.58, [32, 4, 0]], [0.8, [20, 4, 0]], [1, [4, 2, 0]]]);
        r.knee[0] = one(t, [[0, 4], [0.5, 8], [0.58, 40], [0.8, 20], [1, 6]]);
        r.leg[1] = e3(t, [[0, [0, 2, 0]], [0.5, [-6, 2, 0]], [0.58, [-20, 2, 0]], [1, [-2, 2, 0]]]);
        r.knee[1] = one(t, [[0, 4], [0.58, 22], [1, 5]]);
        r.at = e3(t, [[0, [0, 0, 0]], [0.5, [0, -1, 0]], [0.58, [0, 4, 0]], [0.7, [0, 4, 0]], [1, [0, 0, 0]]]);
        r.mouth = one(t, [[0, 0], [0.22, 0.1], [0.28, 0.45], [0.36, 0.2], [0.58, 0.85], [0.7, 0.4], [1, 0]]);
        // The axe held up across the face, its head before the eyes; the left palm laid flat on the blade by the head and
        // drawn down its edge (the left hand on the haft, closing nearer the fist); then both hands to it for the blow.
        const head = twoHands(c) ? 1 : 0.42;
        swing(r, t, c, [[0, 35, 20, 0.6, 115, 0], [0.14, 32, 18, 0.53, 93 + q, -80], [0.3, 32, 18, 0.53, 93, -80], [0.38, 60, 12, 0.6, 80, -50], [0.5, 200, 10, 0.85, 70, 0], [0.58, 80, -5, 1, -5, 0], [0.64, 76, -5, 1, -5, 0], [0.8, 50, 10, 0.75, 30, 0], [1, 35, 20, 0.6, 115, 0]],
          { both: 1, bothAt: one(t, [[0, 2.5], [0.12, 8.2 * head], [0.2, 8.2 * head], [0.3, 5.6 * head], [0.36, 5.6 * head], [0.46, 2.5], [1, 2.5]]) });
        if (!twoHands(c)) r.both = one(t, [[0.05, 0], [0.14, 1], [0.34, 1], [0.42, 0]]);
        r.shape = [{ flat: one(t, [[0.08, 0], [0.14, 1], [0.32, 1], [0.38, 0]]) }, undefined];
      },
    },
    fx: {
      charge: (k, t) => {
        // The palm drawn down the edge: blood off the hand as it comes away.
        if ((k.state.cut ?? 0) === 0 && t >= 0.28) {
          k.state.cut = 1;
          blood(k, k.hand(0), 16, { speed: [0.3, 0.9], up: [4, 16], size: 2.2 });
          k.flare(k.hand(0), 6, 0.9, '#ff6a52');
        }
        // The blade run red, dripping, and the cut hand dripping too, until the blow.
        const red = seg(t, 0.27, 0.34) * (1 - seg(t, 0.62, 0.8));
        if (red > 0) {
          const head = axeHead(k);
          k.glow(head, 5, 0.75 * red, DROP);
          k.emit(head, 9 * red, { kind: 'drop', colour: DROP, size: 1.8, life: [0.3, 0.5], speed: [0, 0.1], up: [-4, 0], gravity: 70, bias: 6 });
          if (t < 0.5) k.emit(k.hand(0), 6 * red, { kind: 'drop', colour: DROP, size: 1.6, life: [0.3, 0.5], speed: [0, 0.05], up: [-2, 0], gravity: 70, bias: 6 });
        }
        const u = seg(t, 0.5, 0.6);
        if (u > 0) rent(k, { u, from: 2.6, to: -0.7, tilt: 0.42, reach: cutReach(k, 18, 32), width: 15, length: 2.1, main: DROP, core: '#ff7a5a', ink: DROP_DARK, alpha: 1 - seg(t, 0.62, 0.78) });
        // Drops flung off the blade along its arc.
        if (u > 0 && u < 1) k.emit(axeHead(k), 50, { kind: 'drop', colour: [DROP, DROP_DARK], size: 2, life: [0.3, 0.6], speed: [0.2, 0.6], up: [0, 10], gravity: 70, bias: 6 });
      },
      hit: (k) => {
        const at = k.heart(k.target);
        const along = k.toward(k.caster, k.target);
        blood(k, at, 36, { dir: along, cone: 2.2, speed: [0.6, 2], up: [8, 30], size: 2.6 });
        k.burst(at, 24, { kind: 'spark', colour: [k.pal.core, k.pal.accent], size: 2.2, life: [0.25, 0.5], speed: [1, 2.4], up: [4, 24], heading: along, cone: 2, gravity: 60 });
        // The price: blood off the caster as the blow takes it.
        blood(k, k.chest(), 10, { speed: [0.1, 0.5], up: [2, 10] });
      },
      impact: { secs: 0.9, draw: (k, u) => {
        const at = k.heart(k.target);
        starburst(k, at, 16 * (1.1 - 0.4 * u), { points: 9, alpha: flashOf(u, 0.06), main: DROP, core: k.pal.core, ink: DROP_DARK });
        const fade = 1 - smooth(seg(u, 0.55, 1));
        pool(k, k.target, 0.14 + 0.16 * easeOut(u * 2), 0.75 * fade);
        pool(k, k.caster, 0.08 + 0.07 * easeOut(u * 2), 0.65 * fade);
        k.light(k.target, 3, 0.9 * (1 - u), DROP);
      } },
    },
  },

  // Execute (strike, on enemy): A blow at 300% on a creature below 25% of its health, and at 100% on one above it.
  //
  // An executioner's stroke: feet set wide, the axe raised straight overhead on both arms and held there while a
  // thin red line marks the creature from above and two arcs close on it; then the drop, straight down the line,
  // and a level cut clean through it at the neck, the two halves of the cut parting.
  berserker_execute: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.45, release: 0.62 },
      pose: (r, t, c) => {
        const q = shake(t, 0.42, 0.56, 1.6, 60);
        r.spine = e3(t, [[0, [0, 0, 0]], [0.42, [4, 0, 0]], [0.56, [5, 0, 0]], [0.62, [-20, 0, 0]], [0.7, [-20, 0, 0]], [0.9, [-6, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = e3(t, [[0, [0, 0, 0]], [0.42, [4, 0, 0]], [0.62, [-8, 0, 0]], [1, [0, 0, 0]]]);
        // Eyes on the creature the whole way, and bowed over it after.
        r.head = e3(t, [[0, [0, 0, 0]], [0.42, [-12, 0, 0]], [0.56, [-12, 0, 0]], [0.62, [-6, 0, 0]], [0.75, [-24, 0, 0]], [0.9, [-16, 0, 0]], [1, [0, 0, 0]]]);
        for (let s = 0; s < 2; s++) {
          r.leg[s] = e3(t, [[0, [2, 2, 0]], [0.14, [4, 14, 0]], [0.62, [4, 15, 0]], [0.85, [3, 12, 0]], [1, [2, 2, 0]]]);
          r.knee[s] = one(t, [[0, 4], [0.14, 14], [0.56, 12], [0.62, 32], [0.75, 30], [1, 4]]);
        }
        r.mouth = one(t, [[0.5, 0], [0.6, 0.5], [0.7, 0.2], [0.9, 0]]);
        // Raised straight up on both arms and held there, the head of it to the sky; then straight down, the head ending at the neck.
        swing(r, t, c, [[0, 35, 20, 0.6, 115, 0], [0.14, 70, 0, 0.7, 60, 0], [0.42, 178 + q, 0, 0.95, 0, 0], [0.56, 176, 0, 0.95, 2, 0], [0.62, 76, 0, 1, -8, 0], [0.7, 72, 0, 1, -8, 0], [0.85, 45, 0, 0.75, 40, 0], [1, 35, 20, 0.6, 115, 0]]);
      },
    },
    fx: {
      charge: (k, t) => {
        const b = k.target;
        const top = k.at(b, 3.2), neck = k.at(b, 0.62);
        // The line it falls down, and the arcs closing on it, while the axe is up.
        const mark = smooth(seg(t, 0.2, 0.44)) * (1 - seg(t, 0.6, 0.64));
        if (mark > 0) {
          const pulse = 0.75 + 0.25 * Math.sin(k.now * 14);
          band(k, [top, k.at(b, 1.9), k.at(b, 1.1)], { width: 1.3, alpha: mark * pulse * 0.9, taper: 'both', main: k.pal.main, core: k.pal.core, glow: 0.6 });
          const close = smooth(seg(t, 0.2, 0.56));
          const R = Math.max(0.28, (b.wide / 40) * 3.2) * (1.8 - 0.8 * close);
          const turn = close * 1.6;
          arcs(k, b, R, 0.04, [[turn, turn + 1.9], [turn + Math.PI, turn + Math.PI + 1.9]], { alpha: mark, glow: 0.4 });
          k.flare(axeHead(k), 6, bump01(seg(t, 0.4, 0.58)) * 0.9, k.pal.core, k.now);
        }
        // The drop: a falling edge down the line, the last tenth of a second before the blow.
        const d = seg(t, 0.565, 0.62);
        if (d > 0 && d < 1) {
          const tip = { x: top.x, y: top.y, z: lerp(top.z, neck.z, easeIn(d)) };
          band(k, [{ x: top.x, y: top.y, z: Math.max(tip.z + 2, lerp(top.z, tip.z, 0.2)) }, { x: tip.x, y: tip.y, z: tip.z + (top.z - tip.z) * 0.2 }, tip], { width: 7, alpha: 1, main: k.pal.main, core: k.pal.core, glow: 1, bias: 10 });
        }
      },
      hit: (k) => {
        const neck = k.at(k.target, 0.62);
        blood(k, neck, 24, { speed: [0.5, 1.5], up: [10, 30], size: 2.4 });
        k.burst(neck, 16, { kind: 'spark', colour: [k.pal.core], size: 2, life: [0.2, 0.4], speed: [1.4, 2.6], up: [-2, 6], gravity: 20 });
      },
      impact: { secs: 0.9, draw: (k, u) => {
        const b = k.target;
        const neck = k.at(b, 0.62);
        // The level cut through it, flung out to both sides, its halves parting.
        const f = k.toward(k.caster, b);
        const side = { x: -f.y, y: f.x };
        const len = ((b.wide * 1.6 + 6) * (0.45 + 0.55 * easeOut(u * 3))) / 40;
        const part = 0.7 * easeOut(seg(u, 0.12, 0.6));
        const a = flashOf(u, 0.04);
        for (const s of [1, -1]) {
          const z = neck.z + s * part;
          const p0 = { x: neck.x - side.x * len * s, y: neck.y - side.y * len * s, z };
          const p1 = { x: neck.x + side.x * len * s, y: neck.y + side.y * len * s, z };
          band(k, [p0, { x: lerp(p0.x, p1.x, 0.5), y: lerp(p0.y, p1.y, 0.5), z }, p1], { width: 4.5 * (1 - 0.6 * u), alpha: a, taper: 'both', bias: 10 });
        }
        starburst(k, neck, 7 * (1 - u), { points: 4, alpha: a, turn: 0 });
        pool(k, b, 0.12 + 0.14 * easeOut(u * 2), 0.7 * (1 - smooth(seg(u, 0.6, 1))));
        k.light(b, 2.6, 0.8 * (1 - u));
      } },
    },
  },

  // Overhead Smash (strike, on enemy): A crushing blow at 250% that cannot miss; your own next swing comes 1.5 s later.
  //
  // The biggest wind-up the trade has: back arched, the axe hanging down behind it, then over and down two-handed
  // through the creature into the ground, where it sticks. The ground splits and throws up stone; the caster is
  // left bent over the stuck axe and heaves it out, and the cracks smoulder for the 1.5 s the next swing waits,
  // the axe's head glinting when it is ready again.
  berserker_overhead_smash: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.5, release: 0.42 },
      pose: (r, t, c) => {
        r.spine = e3(t, [[0, [0, 0, 0]], [0.32, [20, 0, 0]], [0.36, [22, 0, 0]], [0.42, [-28, 0, 0]], [0.48, [-30, 0, 0]], [0.72, [-32, 0, 0]], [0.84, [-8, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = e3(t, [[0, [0, 0, 0]], [0.32, [12, 0, -6]], [0.42, [-14, 0, 4]], [0.6, [-10 + 2 * Math.sin(t * 40), 0, 0]], [0.72, [-12, 0, 0]], [0.84, [4, 0, -6]], [1, [0, 0, 0]]]);
        r.head = e3(t, [[0, [0, 0, 0]], [0.32, [-22, 0, 0]], [0.42, [20, 0, 0]], [0.72, [16, 0, 0]], [0.84, [0, 0, 0]], [1, [0, 0, 0]]]);
        // Heaving for breath over the stuck axe.
        r.shrug = [one(t, [[0, 0], [0.32, 0.8], [0.42, 0], [0.55, 0.5], [0.62, 0], [0.69, 0.5], [0.76, 0], [1, 0]]), one(t, [[0, 0], [0.32, 0.8], [0.42, 0], [0.55, 0.5], [0.62, 0], [0.69, 0.5], [0.76, 0], [1, 0]])];
        r.lift = one(t, [[0, 0], [0.32, 0.6], [0.38, 0.4], [0.42, 0], [1, 0]]);
        r.leg[0] = e3(t, [[0, [2, 2, 0]], [0.32, [14, 3, 0]], [0.42, [34, 4, 0]], [0.72, [34, 4, 0]], [0.84, [16, 3, 0]], [1, [4, 2, 0]]]);
        r.knee[0] = one(t, [[0, 4], [0.32, 18], [0.42, 44], [0.72, 44], [0.84, 20], [1, 6]]);
        r.leg[1] = e3(t, [[0, [0, 2, 0]], [0.32, [-4, 2, 0]], [0.42, [-22, 2, 0]], [0.72, [-22, 2, 0]], [1, [-2, 2, 0]]]);
        r.knee[1] = one(t, [[0, 4], [0.42, 24], [0.72, 24], [1, 5]]);
        r.at = e3(t, [[0, [0, 0, 0]], [0.32, [0, -1, 0]], [0.42, [0, 5, 0]], [0.72, [0, 5, 0]], [0.9, [0, 1, 0]], [1, [0, 0, 0]]]);
        r.mouth = one(t, [[0, 0], [0.3, 0.3], [0.42, 1], [0.5, 0.6], [0.55, 0.35], [0.62, 0.6], [0.69, 0.35], [0.76, 0.6], [0.86, 0.9], [1, 0]]);
        // Back arched and the head of it hanging down behind; over the top and down into the ground ahead, where it sticks;
        // then heaved out, the head coming up first.
        swing(r, t, c, [[0, 35, 20, 0.6, 115, 0], [0.1, 60, 5, 0.7, 60, 0], [0.32, 205, 5, 0.85, 95, 0], [0.36, 208, 5, 0.85, 100, 0], [0.42, 55, 0, 1, 5, 0], [0.48, 54, 0, 1, 6, 0], [0.72, 52, 0, 1, 8, 0], [0.84, 75, 5, 0.75, 70, 0], [1, 35, 20, 0.6, 115, 0]]);
      },
    },
    fx: {
      charge: (k, t) => {
        k.glow(axeHead(k), 6, 0.6 * seg(t, 0.1, 0.34) * (1 - seg(t, 0.42, 0.5)));
        const u = seg(t, 0.355, 0.425);
        if (u > 0) rent(k, { u, from: 3.0, to: -0.55, tilt: 0.16, reach: cutReach(k, 18, 32), up: k.caster.tall * 0.78, width: 15, length: 2.3, alpha: 1 - seg(t, 0.45, 0.62) });
      },
      hit: (k) => {
        const b = k.target;
        rubble(k, k.at(b, 0.05), 22, 1.2);
        k.burst(k.heart(b), 30, { kind: 'spark', colour: [k.pal.core, k.pal.accent], size: 2.2, life: [0.25, 0.55], speed: [1, 2.6], up: [8, 34], gravity: 70 });
        blood(k, k.heart(b), 10);
      },
      impact: { secs: 0.9, draw: (k, u) => {
        const b = k.target;
        const ahead = k.toward(k.caster, b);
        starburst(k, k.heart(b), 15 * (1.15 - 0.45 * u), { points: 8, alpha: flashOf(u, 0.05) });
        k.scorch(b, 0.3, { colour: EARTH, alpha: 0.6 * (1 - smooth(seg(u, 0.7, 1))) });
        cracks(k, b, 0.8, { n: 7, grow: easeOut(u * 3), heat: 1 - 0.4 * u, dir: ahead, spread: 4.6, salt: 1, width: 2.6 });
        k.ring(b, 0.15 + 0.75 * easeOut(u), { band: 0.1 * (1 - u) + 0.02, alpha: 0.9 * (1 - u), glow: 0.6 });
        k.light(b, 3.2, 0.9 * (1 - u));
      } },
      linger: {
        on: 'spot',
        secs: SMASH_WIND,
        draw: (k, age, left) => {
          const b = k.target;
          // Cracks smouldering for as long as the caster's next swing waits, then the axe's head glinting: ready.
          const heat = 0.6 * (left / SMASH_WIND);
          cracks(k, b, 0.8, { n: 7, grow: 1, heat, dir: k.toward(k.caster, b), spread: 4.6, salt: 1, width: 2.6, alpha: smooth(left / 0.4) });
          if (!k.fast) k.emit(k.at(b, 0.05), 8 * heat, { kind: 'smoke', colour: '#4a3a33', size: 2.4, sizeEnd: 6, life: [0.7, 1.2], speed: [0.02, 0.08], up: [6, 12], gravity: -3, jitter: 0.3 });
          if (left < 0.3) k.flare(axeHead(k), 7, Math.sin((Math.PI * (0.3 - left)) / 0.3), k.pal.core, age * 3);
        },
      },
    },
  },

  // Whirlwind (nova, on self, 2 tiles round): Two blows at 90% on every enemy within 2 tiles of you.
  //
  // Crouched and wound round to the right, then two full turns with the axe out at arm's length, the blade's path
  // a torn ring round the body. Each turn's blow goes out over the ground as a ring of teeth to the 2 tiles it
  // reaches, the second following the first.
  berserker_whirlwind: {
    palette: PALETTE,
    cast: {
      timing: { secs: WHIRL_SECS, release: WHIRL_FIRST, blendOut: 0.22 },
      pose: (r, t, c) => {
        // The turns, read back into a half turn either way so the blend at each end never unwinds them.
        const spin = whirlTurned(t) * 360 - one(t, [[0, 0], [WHIRL_GO, 50], [0.3, 0]]);
        r.pelvis = [0, 0, ((((spin + 180) % 360) + 360) % 360) - 180];
        // Both arms out level, the axe straight out past the right fist along the arm.
        r.arm[1] = e3(t, [[0, [24, 14, 0]], [WHIRL_GO, [40, 50, -30]], [0.24, [88, 0, -88]], [WHIRL_END - 0.04, [88, 0, -88]], [0.84, [50, 10, -20]], [1, [24, 14, 0]]]);
        r.elbow[1] = one(t, [[0, 60], [WHIRL_GO, 70], [0.24, 6], [WHIRL_END - 0.04, 6], [0.84, 40], [1, 60]]);
        r.haft = one(t, [[0, 0], [WHIRL_GO, 30], [0.24, 82], [WHIRL_END - 0.04, 82], [0.9, 20]]);
        r.arm[0] = e3(t, [[0, [16, 10, 0]], [WHIRL_GO, [60, 0, 30]], [0.24, [80, 0, -80]], [WHIRL_END - 0.04, [80, 0, -80]], [0.84, [30, 20, 0]], [1, [10, 10, 0]]]);
        r.elbow[0] = one(t, [[0, 24], [WHIRL_GO, 90], [0.24, 20], [WHIRL_END - 0.04, 20], [1, 24]]);
        r.open[0] = t > 0.2 && t < 0.8;
        r.shape = [{ flat: one(t, [[0.18, 0], [0.26, 1], [0.72, 1], [0.8, 0]]) }, undefined];
        r.spine = e3(t, [[0, [0, 0, 0]], [WHIRL_GO, [-10, 0, -20]], [0.24, [-4, 6, 0]], [WHIRL_END - 0.04, [-4, 6, 0]], [0.84, [-8, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = e3(t, [[0, [0, 0, 0]], [WHIRL_GO, [-6, 0, -26]], [0.24, [0, 4, 6]], [WHIRL_END - 0.04, [0, 4, 6]], [1, [0, 0, 0]]]);
        r.head = e3(t, [[0, [0, 0, 0]], [WHIRL_GO, [-8, 0, 20]], [0.24, [-4, 0, 10]], [WHIRL_END - 0.04, [-4, 0, 10]], [1, [0, 0, 0]]]);
        r.mouth = one(t, [[0, 0], [WHIRL_GO, 0.2], [0.3, 0.6], [WHIRL_END, 0.5], [0.9, 0]]);
        for (let s = 0; s < 2; s++) {
          r.leg[s] = e3(t, [[0, [2, 2, 0]], [WHIRL_GO, [16, 12, 0]], [0.24, [10, 12, 0]], [WHIRL_END - 0.04, [10, 12, 0]], [0.84, [14, 10, 0]], [1, [2, 2, 0]]]);
          r.knee[s] = one(t, [[0, 4], [WHIRL_GO, 34], [0.24, 20], [WHIRL_END - 0.04, 20], [0.84, 30], [1, 4]]);
        }
        r.carried = 1;
        r.wield = 1;
      },
    },
    fx: {
      charge: (k, t) => {
        const b = k.caster;
        const R = k.fx.reach ?? 2;
        const go = seg(t, WHIRL_GO, WHIRL_END);
        // Where the blade is round the body, in the same turns the pose makes.
        if (go > 0 && go < 1) {
          const ang = -Math.PI / 2 + TAU * whirlTurned(t);
          swirl(k, b, ang, 2.6 * Math.min(1, go * 5, (1 - go) * 5), 15);
          k.ring(b, R, { band: 0.03, alpha: 0.3 * smooth(go * 4) * (1 - smooth(seg(go, 0.85, 1))), dash: 3, turn: -ang * 0.3, glow: 0.2 });
          if (!k.fast) {
            const f = k.facingDir(b);
            const ca = Math.atan2(f.y, f.x) - ang;
            k.emit(k.at(b, 0.03), 36, { kind: 'dust', colour: DUST, size: 3, life: [0.4, 0.7], speed: [0.8, 1.3], up: [2, 6], heading: { x: Math.cos(ca + Math.PI / 2), y: Math.sin(ca + Math.PI / 2) }, cone: 0.8, gravity: 2, drag: 0.2, jitter: 0.4 });
          }
        }
        // Each blow after the first, on the turn it lands.
        for (let i = 1; i < WHIRL_BLOWS; i++) {
          if ((k.state[`b${i}`] ?? 0) === 0 && t >= whirlBlow(i)) {
            k.state[`b${i}`] = 1;
            k.burst(k.at(b, 0.5), 20, { kind: 'spark', size: 2, life: [0.25, 0.5], speed: [1.6, 3], up: [2, 12], gravity: 30, drag: 0.1 });
          }
        }
      },
      hit: (k) => {
        k.burst(k.at(k.caster, 0.5), 20, { kind: 'spark', size: 2, life: [0.25, 0.5], speed: [1.6, 3], up: [2, 12], gravity: 30, drag: 0.1 });
      },
      impact: { secs: WHIRL_IMPACT, draw: (k, u) => {
        const b = k.caster;
        const R = k.fx.reach ?? 2;
        const secs = WHIRL_SECS;
        // Each blow's ring, from the moment its turn brings the blade round, out to the reach it strikes at.
        const since = u * WHIRL_IMPACT;
        for (let i = 0; i < WHIRL_BLOWS; i++) {
          const v = seg(since, (whirlBlow(i) - WHIRL_FIRST) * secs, (whirlBlow(i) - WHIRL_FIRST) * secs + 0.42);
          if (v <= 0 || v >= 1) continue;
          const rr = 0.3 + (R - 0.3) * easeOut(v);
          sawRing(k, b, rr, { teeth: Math.round((TAU * R) / 0.3), alpha: 0.95 * (1 - smooth(seg(v, 0.55, 1))), tooth: 0.14, wide: 0.12, turn: i * 0.17 + v * 0.8 });
          // Every enemy within the reach struck as the ring of this blow goes through where it stands.
          for (const e of struckBy(k, R)) {
            const d = Math.hypot(e.x - b.x, e.y - b.y);
            const w = seg(rr, d - 0.15, d + 0.7);
            if (w <= 0 || w >= 1) continue;
            const key = `w${i}_${e.who && 'id' in e.who ? e.who.id : 0}`;
            if (!k.state[key]) {
              k.state[key] = 1;
              blood(k, k.heart(e), 6, { dir: k.toward(b, e), cone: 1.2 });
            }
            starburst(k, k.heart(e), 8 * (1.1 - 0.4 * w), { points: 6, alpha: flashOf(w, 0.12), turn: i * 0.5 });
          }
        }
        k.light(b, R + 1, 0.7 * (1 - u));
      } },
    },
  },

  // Earthshaker (nova, on self, 3 tiles round, lasts 1 s): With a maul in hand: a blow at 100% on every enemy within 3 tiles of you, and each one held where it stands for 1 s.
  //
  // Down into a crouch, up off the ground with the maul overhead, and down with it into the earth between the feet.
  // The ground cracks out all round to the 3 tiles it reaches, a wave of stone standing up as it runs out, and the
  // edge of it holds, shaking, for the second everything in it is held.
  berserker_earthshaker: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.3, release: 0.5 },
      pose: (r, t, c) => {
        r.lift = one(t, [[0, 0], [0.2, 0], [0.32, 4.5], [0.4, 4], [0.48, 0.6], [0.5, 0], [1, 0]]);
        r.spine = e3(t, [[0, [0, 0, 0]], [0.2, [-20, 0, 0]], [0.36, [12, 0, 0]], [0.5, [-34, 0, 0]], [0.62, [-34, 0, 0]], [0.8, [-12, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = e3(t, [[0, [0, 0, 0]], [0.2, [-8, 0, 0]], [0.36, [8, 0, 0]], [0.5, [-12, 0, 0]], [1, [0, 0, 0]]]);
        r.head = e3(t, [[0, [0, 0, 0]], [0.2, [18, 0, 0]], [0.36, [-16, 0, 0]], [0.5, [26, 0, 0]], [0.62, [24, 0, 0]], [1, [0, 0, 0]]]);
        for (let s = 0; s < 2; s++) {
          r.leg[s] = e3(t, [[0, [2, 2, 0]], [0.2, [40, 12, 0]], [0.32, [30, 8, 0]], [0.4, [44, 10, 0]], [0.5, [56, 16, 0]], [0.62, [56, 16, 0]], [0.8, [24, 8, 0]], [1, [2, 2, 0]]]);
          r.knee[s] = one(t, [[0, 4], [0.2, 80], [0.3, 30], [0.4, 70], [0.5, 96], [0.62, 96], [0.8, 40], [1, 4]]);
        }
        r.mouth = one(t, [[0, 0], [0.32, 0.3], [0.48, 1], [0.62, 0.8], [0.85, 0]]);
        // Up off the ground with it overhead, the head hanging back; down into the earth just ahead of the feet.
        swing(r, t, c, [[0, 35, 20, 0.6, 115, 0], [0.2, 30, 0, 0.6, 140, 0], [0.38, 190, 0, 0.9, 60, 0], [0.5, 60, 0, 0.45, -20, 0], [0.62, 60, 0, 0.45, -20, 0], [0.8, 50, 0, 0.6, 60, 0], [1, 35, 20, 0.6, 115, 0]]);
      },
    },
    fx: {
      charge: (k, t) => {
        if ((k.state.jump ?? 0) === 0 && t >= 0.22) {
          k.state.jump = 1;
          k.burst(k.at(k.caster, 0.03), 14, { kind: 'dust', colour: DUST, size: 3.6, life: [0.5, 0.9], speed: [0.4, 0.8], up: [1, 4], gravity: 2, drag: 0.1 });
        }
        k.glow(axeHead(k), 6, 0.7 * seg(t, 0.25, 0.42) * (1 - seg(t, 0.5, 0.56)));
        const u = seg(t, 0.42, 0.5);
        if (u > 0) rent(k, { u, from: 2.9, to: -0.2, tilt: 0.1, reach: 14, up: k.caster.tall * 0.95, width: 11, length: 1.8, alpha: 1 - seg(t, 0.52, 0.64) });
      },
      hit: (k) => {
        const b = k.caster;
        k.flash(0.12);
        rubble(k, k.at(b, 0.05), 30, 1.8);
        k.burst(k.at(b, 0.1), 40, { kind: 'spark', colour: [k.pal.core, k.pal.accent], size: 2, life: [0.3, 0.6], speed: [1.5, 3.2], up: [4, 22], gravity: 40, drag: 0.1 });
      },
      impact: { secs: 1.0, draw: (k, u) => {
        const b = k.caster;
        const R = QUAKE_R;
        const wave = easeOut(seg(u, 0, 0.35));
        cracks(k, b, R, { n: 10, grow: easeOut(seg(u, 0, 0.3)), heat: 1 - 0.3 * u, salt: 5, width: 3.2 });
        k.ring(b, 0.2 + (R - 0.2) * wave, { band: 0.2 * (1 - wave) + 0.05, alpha: 1 - smooth(seg(u, 0.55, 1)), glow: 0.8 });
        // Stone standing up behind the wave as it runs out, and settling.
        const stand = Math.sin(Math.PI * seg(u, 0.03, 0.6));
        if (stand > 0) k.shards(b, { n: k.fast ? 8 : 16, r: Math.max(0.3, (R - 0.2) * wave - 0.15), h: 7, grow: stand, main: STONE[0], deep: STONE[1], core: STONE[2], glow: 0 });
        if (u < 0.55 && !k.fast) {
          const an = k.rand() * TAU;
          const rr = 0.2 + (R - 0.2) * wave;
          k.burst(k.on(b.x + Math.cos(an) * rr, b.y + Math.sin(an) * rr, 1), 2, { kind: 'dust', colour: DUST, size: 3.6, life: [0.5, 0.9], speed: [0.1, 0.3], up: [2, 8], gravity: 2 });
        }
        k.light(b, R + 1, 0.9 * (1 - u));
      } },
      linger: {
        draw: (k, age, left) => {
          const b = k.caster;
          const R = QUAKE_R;
          const a = smooth(seg(age, 0.25, 0.4)) * smooth(left / 0.35);
          // The edge holding, shaking: everything inside it is held until it lets go.
          const shakeR = R + Math.sin(age * 70) * 0.03;
          sawRing(k, b, shakeR - 0.14, { teeth: Math.round((TAU * R) / 0.3), alpha: 0.85 * a, tooth: 0.16, wide: 0.13, turn: Math.sin(age * 50) * 0.02, glow: 0.5 });
          cracks(k, b, R, { n: 10, grow: 1, heat: 0.7 * a, salt: 5, width: 3.2, alpha: Math.max(0.3, a) });
          // Each enemy inside it held fast: stone closed round its feet, shaking with the edge, for the second it is held.
          for (const e of struckBy(k, R)) {
            k.shards({ x: e.x + Math.sin(age * 60) * 0.01, y: e.y }, { n: 6, r: Math.max(0.12, (e.wide / 40) * 1.5), h: 4, grow: a, main: STONE[0], deep: STONE[1], core: STONE[2], glow: 0 });
          }
        },
      },
    },
  },

  // Last Rage (buff, on self, lasts 10 s): Costs no stamina. Only below 25% of your health: for 10 s every blow you land is critical.
  //
  // Beaten down onto one knee, shaking, the ground cracking under it; then up with arms flung wide and the head
  // thrown back in a scream, a column of dark fire going up off the body. For the 10 s it lasts the fire burns dark
  // and high on the whole body, the eyes burn, the weapon's head is white-hot, and a crown of ten spikes over the
  // head -- every blow critical -- loses a spike a second.
  berserker_last_rage: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.8, release: 0.55 },
      pose: (r, t) => {
        const q = shake(t, 0.2, 0.46, 2.4, 70);
        const roar = shake(t, 0.56, 0.84, 2, 50);
        for (let s = 0; s < 2; s++) {
          r.arm[s] = e3(t, [[0, [12, 12, 0]], [0.2, [s ? 30 : 46, 6, 10]], [0.46, [s ? 30 : 46, 6, 10]], [0.55, [140, 60, -10]], [0.84, [142 + roar, 62, -10]], [1, [12, 12, 0]]]);
          r.elbow[s] = one(t, [[0, 24], [0.2, s ? 60 : 30], [0.46, s ? 60 : 30], [0.55, 20], [0.84, 22], [1, 24]]);
        }
        r.spine = e3(t, [[0, [0, 0, 0]], [0.2, [-24 + q, 0, 0]], [0.46, [-26, 0, 0]], [0.55, [10, 0, 0]], [0.84, [10 + roar, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = e3(t, [[0, [0, 0, 0]], [0.2, [-10, 0, 0]], [0.55, [14, 0, 0]], [0.84, [12, 0, 0]], [1, [0, 0, 0]]]);
        r.head = e3(t, [[0, [0, 0, 0]], [0.2, [-20, 0, 0]], [0.46, [-24 + q, 0, 0]], [0.55, [32, 0, 0]], [0.84, [30 + roar, 0, 0]], [1, [0, 0, 0]]]);
        r.shrug = [one(t, [[0, 0], [0.3, 0.6], [0.36, 0], [0.42, 0.6], [0.55, 1.4], [0.84, 1.2], [1, 0]]), one(t, [[0, 0], [0.3, 0.6], [0.36, 0], [0.42, 0.6], [0.55, 1.4], [0.84, 1.2], [1, 0]])];
        // Beaten down onto the right knee, the left fist on the ground; then stood, feet wide, arms flung out, screaming.
        r.kneel = one(t, [[0, 0], [0.16, 1], [0.46, 1], [0.54, 0]]);
        r.reach = [{ at: [-2.6, 1.8, 1.4], w: one(t, [[0.1, 0], [0.2, 1], [0.44, 1], [0.5, 0]]), stoop: true }, undefined];
        r.shape = [{ claw: one(t, [[0.5, 0], [0.56, 1], [0.84, 1], [0.95, 0]]) }, { claw: one(t, [[0.5, 0], [0.56, 0.6], [0.84, 0.6], [0.95, 0]]) }];
        r.mouth = one(t, [[0, 0], [0.2, 0.3], [0.46, 0.3], [0.55, 1], [0.84, 1], [0.95, 0]]);
        for (let s = 0; s < 2; s++) {
          r.leg[s] = e3(t, [[0, [2, 2, 0]], [0.46, [2, 2, 0]], [0.55, [s ? -4 : 6, 14, 0]], [0.84, [s ? -4 : 6, 14, 0]], [1, [2, 2, 0]]]);
          r.knee[s] = one(t, [[0, 4], [0.46, 4], [0.55, 10], [1, 4]]);
        }
        r.carried = 1;
      },
    },
    fx: {
      charge: (k, t) => {
        const b = k.caster;
        const g = smooth(seg(t, 0.12, 0.5));
        if (!k.fast) k.emit(k.at(b, 0.4), 16 * g * (1 - seg(t, 0.55, 0.7)), { kind: 'smoke', colour: DARK_FIRE.deep, size: 2.4, sizeEnd: 6, life: [0.6, 1], speed: [0.02, 0.1], up: [10, 18], gravity: -4, jitter: 0.12 });
        cracks(k, b, 0.75, { n: 6, grow: g, heat: g * 0.8, salt: 7, width: 2.2 });
        eyes(k, g);
      },
      release: (k) => {
        const b = k.caster;
        k.flash(0.22, DARK_FIRE.main);
        k.burst(k.at(b, 0.5), 56, { kind: 'ember', colour: [DARK_FIRE.core, k.pal.main, k.pal.accent], size: 2, life: [0.5, 1], speed: [1.2, 2.6], up: [10, 40], gravity: 10, drag: 0.3, jitter: 0.12 });
        rubble(k, k.at(b, 0.04), 16, 1.4);
      },
      impact: { secs: 1.1, draw: (k, u) => {
        const b = k.caster;
        k.pillar(b, { r: 9, h: 55, alpha: 0.75 * flashOf(u, 0.06), main: DARK_FIRE.main, deep: DARK_FIRE.deep, core: DARK_FIRE.core });
        sawRing(k, b, 0.35 + 1.5 * easeOut(u), { teeth: 44, alpha: 1 - smooth(seg(u, 0.3, 1)), tooth: 0.2, wide: 0.15, main: DARK_FIRE.main, deep: DARK_FIRE.deep, turn: -u * 0.5 });
        cracks(k, b, 0.75, { n: 6, grow: 1, heat: 0.8 * (1 - u), salt: 7, width: 2.2 });
        eyes(k, 1);
        k.light(b, 5, 1 - 0.6 * u, DARK_FIRE.main);
      } },
      linger: {
        draw: (k, age, left) => {
          const b = k.caster;
          const all = age + left;
          const a = smooth(age / 0.4) * smooth(left / 0.8);
          warFire(k, b, { n: 10, h: 7.5, alpha: a, main: DARK_FIRE.main, deep: DARK_FIRE.deep, core: DARK_FIRE.core, salt: 3 });
          // A spike of the crown for every second of it, one going out each second.
          const secs = Math.round(k.fx.secs ?? all);
          crown(k, k.at(b, 1.22), secs, left / all, age, a);
          eyes(k, a);
          k.glow(axeHead(k), 4, 0.8 * a, k.pal.core);
          if (!k.fast) k.emit(k.at(b, 0.6), 10 * a, { kind: 'ember', colour: [DARK_FIRE.core, k.pal.main], size: 1.8, life: [0.4, 0.8], speed: [0.05, 0.2], up: [14, 26], gravity: 0, jitter: 0.15 });
          k.light(b, 3, (0.45 + 0.1 * Math.sin(age * 13)) * a, DARK_FIRE.main);
        },
      },
    },
  },
};

/* ---- helpers the spells above share, past the record so it reads first ---------------------------------------------- */

/** Up and back down over nought to one. */
function bump01(u: number): number {
  return Math.sin(Math.PI * clamp(u));
}

/** A spin that winds up and runs down at its ends, steady in its middle, over nought to one. */
function easeInOutSpin(u: number): number {
  const v = clamp(u);
  // A quarter of the time to come up to speed, a quarter to come down: the middle half at a steady rate.
  const a = 0.2;
  const top = 1 / (1 - a);
  if (v < a) return (top * v * v) / (2 * a);
  if (v > 1 - a) return 1 - (top * (1 - v) * (1 - v)) / (2 * a);
  return (top * a) / 2 + top * (v - a);
}

/** A heartbeat: a flare off the chest and a ring off the feet. */
function heartbeat(k: FxScene, s: number): void {
  k.flare(k.chest(), 9 * s, s, QUICK.core);
  k.burst(k.chest(), Math.round(10 * s), { kind: 'spark', colour: [QUICK.core, QUICK.main], size: 1.6, life: [0.15, 0.3], speed: [0.6, 1.2], up: [-6, 10], gravity: 0, drag: 0.1 });
}

/**
 * The path of a blade round a body in a whirlwind: a torn band at arm's length round it, its head at `ang`
 * (radians round from where the body faces, turning the way the pose turns), `len` radians of it trailing.
 * The half behind the body is drawn behind it.
 */
function swirl(k: FxScene, b: Body, ang: number, len: number, reach: number): void {
  if (len <= 0.05) return;
  const up = b.tall * 0.6;
  const n = k.fast ? 8 : 14;
  const front: P3[] = [], back: P3[] = [];
  const mid = k.sy(k.at(b, 0.6));
  let prev: 'f' | 'b' | null = null;
  const flush = (list: P3[], side: 'f' | 'b'): void => {
    if (list.length >= 2) band(k, list, { width: 9, taper: 'both', teeth: true, pivot: k.at(b, 0.6), sortAt: { x: b.x, y: b.y, z: b.z }, bias: side === 'f' ? 1.5 : -0.6 });
  };
  for (let i = 0; i <= n; i++) {
    // Turning to the body's left (counter-clockwise from above), as the pelvis yaws.
    const a = ang - len + (len * i) / n;
    const p = k.local(b, -Math.sin(a) * reach, Math.cos(a) * reach, up + Math.sin(a * 2) * 0.8);
    const side = k.sy(p) >= mid ? 'f' : 'b';
    if (prev && side !== prev) {
      // Carry the point over so the two halves meet.
      (prev === 'f' ? front : back).push(p);
      flush(prev === 'f' ? front : back, prev);
      (prev === 'f' ? front : back).length = 0;
    }
    (side === 'f' ? front : back).push(p);
    prev = side;
  }
  flush(front, 'f');
  flush(back, 'b');
}

/** A cry going out ahead of the face: an upright torn ring square to the way the body faces, `v` nought to one of the way out. */
function shout(k: FxScene, b: Body, v: number, alpha: number): void {
  const up = b.tall * 0.88;
  const d = 3 + 30 * easeOut(v), r = 2.2 + 7.5 * easeOut(v);
  const m = k.fast ? 10 : 16;
  const pts: P3[] = [];
  for (let i = 0; i <= m; i++) {
    const th = (i / m) * TAU + v;
    pts.push(k.local(b, Math.cos(th) * r, d, up + Math.sin(th) * r * 0.85));
  }
  band(k, pts, { width: 3.4 * (1 - v) + 1.2, alpha, taper: 'none', teeth: true, pivot: k.local(b, 0, d, up), sortAt: k.local(b, 0, d, 0), bias: 2, glow: 0.5 });
}

/** Eyes burning in the head, `a` how much. */
function eyes(k: FxScene, a: number): void {
  if (a <= 0.02) return;
  const b = k.caster;
  const head = k.joint(b, 'head', [0, 1.1, 1.0], 0.92);
  // Only seen with the face toward the viewer: from behind, the back of the head hides them.
  const nape = k.joint(b, 'head', [0, -1.1, 1.0], 0.92);
  if (k.eye.worldToScreenY(head.x, head.y, 0) < k.eye.worldToScreenY(nape.x, nape.y, 0) - 0.3) return;
  k.glow(head, 3.2, 0.9 * a, '#ff3a1a');
  k.flare(head, 2.4, 0.8 * a, '#ffe0c0', 0.3);
}

/**
 * A crown of `n` spikes in the air over the head, turning: `left` of them lit (nought to one), the last going
 * out as its second runs down. Drawn as a ring of upright teeth with its back half behind the head.
 */
function crown(k: FxScene, at: P3, n: number, left: number, age: number, a: number): void {
  if (a <= 0.01) return;
  const x = k.sx(at), y = k.sy(at);
  const R = 5.4 * k.zoom, H = 4.2 * k.zoom;
  const show = left * n;
  const spikes: Array<{ q: number[]; front: boolean; dim: boolean }> = [];
  for (let i = 0; i < n; i++) {
    const an = age * 0.9 + (i / n) * TAU;
    const an1 = an + TAU / n;
    const lit = i < Math.ceil(show - 1e-6);
    const part = i === Math.ceil(show - 1e-6) - 1 ? show - i : 1;
    const h = lit ? H * (0.4 + 0.6 * part) : H * 0.25;
    const am = (an + an1) / 2;
    spikes.push({
      q: [x + Math.cos(an) * R, y + Math.sin(an) * R * 0.34, x + Math.cos(am) * R, y + Math.sin(am) * R * 0.34 - h, x + Math.cos(an1) * R, y + Math.sin(an1) * R * 0.34],
      front: Math.sin(am) > 0,
      dim: !lit,
    });
  }
  const main = k.pal.accent, deep = k.pal.deep, ink = k.pal.ink, core = k.pal.core;
  const draw = (front: boolean) => (g: CanvasRenderingContext2D): void => {
    g.lineJoin = 'miter';
    g.lineWidth = Math.max(0.7, 0.6 * k.zoom);
    g.strokeStyle = ink;
    for (const s of spikes) {
      if (s.front !== front) continue;
      g.globalAlpha = clamp(a * (s.dim ? 0.35 : 1));
      g.beginPath();
      g.moveTo(s.q[0], s.q[1]);
      g.lineTo(s.q[2], s.q[3]);
      g.lineTo(s.q[4], s.q[5]);
      g.closePath();
      g.fillStyle = s.dim ? deep : front ? main : deep;
      g.fill();
      g.stroke();
      if (!s.dim && front) {
        g.beginPath();
        g.moveTo(lerp(s.q[0], s.q[2], 0.3), lerp(s.q[1], s.q[3], 0.3));
        g.lineTo(s.q[2], s.q[3]);
        g.lineTo(lerp(s.q[0], s.q[4], 0.5), lerp(s.q[1], s.q[5], 0.5));
        g.closePath();
        g.fillStyle = core;
        g.fill();
      }
    }
    g.lineJoin = 'round';
  };
  const foot = { x: k.caster.x, y: k.caster.y, z: k.caster.z };
  k.worldDraw(foot, draw(false), -0.5);
  k.worldDraw(foot, draw(true), 9);
  k.glow(at, 9, 0.5 * a * (0.4 + 0.6 * left));
}

/*
 * Each cast is blended in and out here rather than by the framework's own blend
 * (`blend: false`), for two things that blend must not do to these poses: the
 * hand goals of `reach` come in by their share where they are, rather than
 * slid out from the feet, and the weapon stays in the right fist (`carried`
 * is a hand, nought or one; halfway between is no hand at all). Every other
 * number is mixed as the framework mixes it.
 */
type Mixed = number | boolean | string | Mixed[] | { [k: string]: Mixed } | undefined;
const copyOf = (v: Mixed): Mixed => (Array.isArray(v) ? v.map(copyOf) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copyOf(x)])) : v);
function mixOf(from: Mixed, to: Mixed, w: number): Mixed {
  if (typeof to === 'number') return (typeof from === 'number' ? from : 0) + (to - (typeof from === 'number' ? from : 0)) * w;
  if (Array.isArray(to)) return to.map((x, i) => mixOf(Array.isArray(from) ? from[i] : undefined, x, w));
  if (to && typeof to === 'object') {
    const f = from && typeof from === 'object' && !Array.isArray(from) ? from : {};
    const out: { [k: string]: Mixed } = {};
    for (const k of Object.keys(to)) out[k] = mixOf(f[k], to[k], w);
    return out;
  }
  return w >= 0.5 ? to : from ?? to;
}
for (const v of Object.values(BERSERKER)) {
  const pose = v.cast.pose, timing = v.cast.timing;
  v.cast.blend = false;
  v.cast.pose = (r, t, c) => {
    const base = copyOf(r as unknown as Mixed);
    pose(r, t, c);
    const reach = r.reach;
    r.reach = undefined;
    const w = castWeight(t, timing);
    Object.assign(r, mixOf(base, r as unknown as Mixed, w) as unknown as Rig);
    if (reach) r.reach = [reach[0] && { ...reach[0], w: (reach[0].w ?? 1) * w }, reach[1] && { ...reach[1], w: (reach[1].w ?? 1) * w }];
    if (c.carry) r.carried = 1;
  };
}
