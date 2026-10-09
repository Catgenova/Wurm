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
 * second, an Adrenaline's amber darts racing round the feet one a second, a hold's arc closes.
 * Nothing red is faded over the grass, where half gone is olive: blood dries
 * (`dry`), cuts are eaten from the tail, rings drop their teeth or thin away.
 *
 * The blows are struck with the weapon itself: a battle axe or a maul is held
 * in the fist square across it (`carry 'shoulder'`), so pitching the wrist
 * aims the haft and the swing of the arm swings the head; a one-handed axe
 * (`carry 'fist'`) is taken by the forearm with `wield`. The left hand comes onto the haft for the two-handed blows. A weapon on
 * the left shoulder is swung from the left (`cast.mirror`), never changing
 * hands; the stage carries the body in to what it strikes and a last stride
 * puts the lead foot down (`cast.close`, `stride`), so blows land; and every
 * cut is the band the weapon really swept (`rent`).
 */
import type { SpellVisual } from './index';
import { spellInfo } from './info';
import { clamp, dry, easeOut, eatTail, flashOf, glowPicture, hashOf, lateFade, lerp, seg, smooth, TAU, type Body, type FxScene, type GroundLayer, type P3, type SpellPalette } from './kit';
import { armOut, euler, one, stepIn } from './poses';
import type { PoseCue } from './index';
import { figureJoint, figureJoints, figureProportions, weaponSpan, type Rig, type V3 } from '../figure';
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

/**
 * How often a torn cut samples the weapon it follows, in seconds of the cast's own clock: a two-hundred-and-fortieth,
 * as a haymaker goes a third of a turn in a twenty-fifth of a second, and sampled a sixtieth apart that is two straight
 * planks with a kink between them rather than an arc.
 */
const RENT_STEP = 1 / 240;
/** Each cast's samples of where its weapon was, kept by the step they were taken at (see `rent`). */
const rents = new WeakMap<object, Map<string, Map<number, [V3, V3]>>>();

/**
 * A torn cut: the band the real weapon swept over the last `secs` of the cast, from `inner` to `outer` of the way
 * from the fist to the head -- sampled off the caster's posed figure every sixtieth of a second of the cast, so it
 * is exactly where the weapon went, at every facing, left-handed or right, with any weapon. Its leading edge (the
 * head's path) hot and inked, its trailing edge bitten into a saw: this trade's cut, which `kit.trail` draws smooth.
 * It dies from its tail as the weapon slows (the samples close up on the head), never by its alpha; give a shorter
 * `secs` to eat it faster. The runs of it behind the body are drawn behind it, the rest in front.
 */
function rent(k: FxScene, o: { secs?: number; inner?: number; outer?: number; key?: string; main?: string; core?: string; ink?: string; glow?: number } = {}): void {
  const b = k.caster;
  const fig = b.figure, cast = fig?.cast, timing = k.timing;
  if (!fig || !cast || !timing) return;
  const id = fig.gear?.weapon?.id, span = id ? weaponSpan(id) : null;
  const len = span ? span.to : 4;
  const zIn = len * clamp(o.inner ?? 0.55), zOut = len * (o.outer ?? 1.04);
  const back = clamp(o.secs ?? 0.12, RENT_STEP, 0.3);
  const now = cast.t * timing.secs;
  let mine = rents.get(k.state);
  if (!mine) rents.set(k.state, (mine = new Map()));
  const key = `${o.key ?? ''}|${zIn.toFixed(2)}|${zOut.toFixed(2)}`;
  let buf = mine.get(key);
  if (!buf) mine.set(key, (buf = new Map()));
  const first = Math.ceil((now - back) / RENT_STEP), last = Math.floor(now / RENT_STEP - 1e-6);
  for (const j of buf.keys()) if (j < first || j > last) buf.delete(j);
  const posed = { ...fig, facing: b.facing };
  const wants: Array<readonly [string, V3]> = [['weapon', [0, 0, zIn]], ['weapon', [0, 0, zOut]]];
  for (let j = Math.max(0, first); j <= last; j++) {
    if (buf.has(j)) continue;
    const got = figureJoints({ ...posed, cast: { ...cast, t: (j * RENT_STEP) / timing.secs } }, wants);
    buf.set(j, [got[0], got[1]]);
  }
  const ins: P3[] = [], outs: P3[] = [];
  for (const j of [...buf.keys()].sort((x, y) => x - y)) {
    const [i0, o0] = buf.get(j) as [V3, V3];
    ins.push(k.local(b, i0[0], i0[1], i0[2]));
    outs.push(k.local(b, o0[0], o0[1], o0[2]));
  }
  // The head: the weapon where it is drawn now.
  const hi = figureJoint(posed, 'weapon', [0, 0, zIn]), ho = figureJoint(posed, 'weapon', [0, 0, zOut]);
  ins.push(k.local(b, hi[0], hi[1], hi[2]));
  outs.push(k.local(b, ho[0], ho[1], ho[2]));
  const n = outs.length;
  if (n < 2) return;
  const xo = outs.map((p) => k.sx(p)), yo = outs.map((p) => k.sy(p));
  // Too short to be a cut: the weapon has all but stopped, and what it swept is eaten.
  let swept = 0;
  for (let i = 1; i < n; i++) swept += Math.hypot(xo[i] - xo[i - 1], yo[i] - yo[i - 1]);
  if (swept < 2.5 * k.zoom) return;
  // In front of the body or behind it, a point at a time, by where it stands over the ground against the body's middle.
  const by = k.eye.worldToScreenY(b.x, b.y, 0);
  const front = outs.map((p) => k.eye.worldToScreenY(p.x, p.y, 0) >= by - 0.05);
  const main = o.main ?? k.pal.main, core = o.core ?? k.pal.core, ink = o.ink ?? k.pal.ink;
  const inkW = Math.max(0.8, 0.7 * k.zoom);
  // The trailing edge narrowed onto the leading one down the cut: the whole band at the head, none of it at the tail.
  const full = (i: number): number => Math.pow(i / (n - 1), 0.6);
  const xi = ins.map((p, i) => lerp(xo[i], k.sx(p), full(i))), yi = ins.map((p, i) => lerp(yo[i], k.sy(p), full(i)));
  const draw = (i0: number, i1: number, inFront: boolean): void => {
    if (i1 - i0 < 1) return;
    // The saw: a notch bitten back toward the leading edge every tooth's length along it, however fast it went.
    const lead: number[] = [], torn: number[] = [], hot: number[] = [];
    const tooth = 3.2 * k.zoom;
    let run = 0;
    for (let i = i0; i <= i1; i++) {
      lead.push(xo[i], yo[i]);
      hot.push(lerp(xo[i], xi[i], 0.28), lerp(yo[i], yi[i], 0.28));
      torn.push(xi[i], yi[i]);
      if (i < i1) run += Math.hypot(xo[i + 1] - xo[i], yo[i + 1] - yo[i]);
      if (i < i1 && run >= tooth) {
        run = 0;
        const mx = (xi[i] + xi[i + 1]) / 2, my = (yi[i] + yi[i + 1]) / 2, ox = (xo[i] + xo[i + 1]) / 2, oy = (yo[i] + yo[i + 1]) / 2;
        torn.push(lerp(mx, ox, 0.6), lerp(my, oy, 0.6));
      }
    }
    k.worldDraw(inFront ? outs[i1] : { x: b.x, y: b.y, z: b.z }, (g) => {
      g.globalAlpha = 1;
      g.lineJoin = 'miter';
      const shape = (edge: number[]): void => {
        g.beginPath();
        g.moveTo(lead[0], lead[1]);
        for (let j = 2; j < lead.length; j += 2) g.lineTo(lead[j], lead[j + 1]);
        for (let j = edge.length - 2; j >= 0; j -= 2) g.lineTo(edge[j], edge[j + 1]);
        g.closePath();
      };
      shape(torn);
      g.fillStyle = main;
      g.fill();
      g.lineWidth = inkW * 0.8;
      g.strokeStyle = ink;
      g.stroke();
      shape(hot);
      g.fillStyle = core;
      g.fill();
      g.lineJoin = 'round';
    }, inFront ? 1.5 : -0.6);
  };
  // Cut into runs where it passes behind the body and back out, each run sharing its end point with the next.
  let s0 = 0;
  for (let i = 1; i < n; i++) {
    if (front[i] !== front[s0]) {
      draw(s0, i, front[s0] && front[i]);
      s0 = i;
    }
  }
  draw(s0, n - 1, front[s0]);
  const gl = (o.glow ?? 1) * (k.fast ? 0 : 1);
  const pic = gl > 0 ? glowPicture(k.pal.light) : null;
  if (pic) glowsAlong(k, pic, xo, yo, Math.max(5, 4.5 * k.zoom), 0.4 * gl, 2);
}

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
  // The heat down a crack in pieces -- every other stretch of it, and narrow, deep in the split -- so the dark split
  // is what reads, glowing at the bottom, and not a bright continuous line: that reads as lightning.
  const pieces: number[][] = [];
  for (const L of lines) {
    for (let s = 0; s + 1 < L.length / 3; s += 2) pieces.push(L.slice(3 * s, 3 * s + 6));
  }
  const layers: GroundLayer[] = [{ kind: 'fill', colour: EARTH, alpha: clamp(a * 0.95), paths: lines.map((L) => outline(L, 1)), lift: 0.12 }];
  if (heat > 0.02) layers.push({ kind: 'fill', colour: k.pal.accent, alpha: clamp(a * heat), paths: pieces.map((L) => outline(L, 0.18)), lift: 0.14 });
  k.groundShape(c.x, c.y, len + 0.3, layers);
  if (heat > 0.05) {
    // The heat in them, over the night: a soft line down the same pieces, in screen pixels -- stronger at night, when
    // it is all that shows of them.
    const light = k.pal.light, w = (o.width ?? 2.2) * k.zoom;
    const scr = pieces.map((L) => {
      const p0 = k.on(L[0], L[1], 0.12), p1 = k.on(L[3], L[4], 0.12);
      return [k.sx(p0), k.sy(p0), k.sx(p1), k.sy(p1)];
    });
    k.glowDraw((g) => {
      g.globalAlpha = clamp(a * heat * (0.14 + 0.3 * k.night));
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
function sawRing(k: FxScene, c: Ground, r: number, o: { teeth?: number; left?: number; alpha?: number; turn?: number; tooth?: number; wide?: number; main?: string; deep?: string; glow?: number; bare?: boolean } = {}): void {
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
    if (o.bare) {
      // A tooth alone on its own short footing, no band between: a few marks at a reach, not a ring.
      const b0 = a0 + (sector - span) / 2, b1 = lerp(am, a0 + (sector + span) / 2, part);
      pt(b0, r - band, q);
      pt(b0, r, q);
      pt(am, r + tl * part, q);
      pt(b1, r, q);
      pt(b1, r - band, q);
      (k.sy(k.on(q[4], q[5], 0)) > cy ? lit : shade).push(q);
      continue;
    }
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

/**
 * Where on a person war-fire rises from, in order as `n` grows: the shoulders, the back of the head, one off each
 * fist, a second lower down each shoulder blade, and for a fiercer fire the hips. Each is [bone, a point on it, size,
 * behind]: all but the fists burn behind the body whichever way it faces, so the fire frames the body and the face
 * rather than lying over them as red outlines.
 */
const FIRE_AT: ReadonlyArray<readonly [string, V3, number, boolean]> = [
  ['arm0', [0, -0.4, -0.2], 1, true], ['arm1', [0, -0.4, -0.2], 1, true], ['head', [0, -1.1, 0.4], 1.15, true],
  ['wrist0', [0, 0, -0.3], 0.55, false], ['wrist1', [0, 0, -0.3], 0.55, false],
  ['arm0', [0, -0.6, -2.2], 0.8, true], ['arm1', [0, -0.6, -2.2], 0.8, true], ['hip0', [0, -0.5, 0], 0.85, true], ['hip1', [0, -0.5, 0], 0.85, true],
];

/**
 * War-fire: broad tongues of flame licking up off a body -- off its shoulders, the back of its head and its fists
 * first, then down its back and off its hips as `n` grows -- each leaning out away from the middle of the body so
 * the face stays clear, flickering on the drawing clock. `h` height units tall.
 */
function warFire(k: FxScene, b: Body, o: { n?: number; h?: number; alpha?: number; main?: string; deep?: string; core?: string; salt?: number; quick?: number }): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const n = Math.min(FIRE_AT.length, k.fast ? Math.min(5, o.n ?? 6) : o.n ?? 6);
  const H = o.h ?? 7;
  const salt = k.seed + (o.salt ?? 0);
  // How fast it flickers: a column going up licks quicker than a fire settled on the body.
  const qk = o.quick ?? 1, now = k.now * qk;
  const mid = k.chest(b);
  const midX = k.sx(mid);
  const head = k.joint(b, 'head', [0, 0, 1], 0.9);
  const back: number[][] = [], front: number[][] = [];
  const gx: number[] = [], gy: number[] = [];
  for (let i = 0; i < n; i++) {
    const [bone, on, size, behind] = FIRE_AT[i];
    const foot = k.joint(b, bone, [on[0], on[1], on[2]], 0.7);
    // A fist up by the face (a weapon carried at the shoulder, or thrust at the sky) does not burn: its flame and its
    // glow would wash over the face, behind it or not.
    if (!behind && foot.z > mid.z) continue;
    const nearHead = Math.hypot((foot.x - head.x) * 40, (foot.y - head.y) * 40, foot.z - head.z) < 3;
    const bx = k.sx(foot), by = k.sy(foot);
    const out = Math.sign(bx - midX) || (i % 2 ? 1 : -1);
    const fl = 0.7 + 0.3 * Math.sin(now * (8.5 + i * 1.3) + i * 2.1) * Math.sin(now * 4.7 + i * 0.7);
    // Coming and going it grows and dies down rather than fading: red half gone over grass is olive.
    const tall = k.hpx(H * size * (0.75 + 0.35 * hashOf(salt, i)) * fl * a);
    const w = (3.4 + 2 * hashOf(salt + 3, i)) * size * k.zoom * (0.5 + 0.5 * a);
    // Licking: the tip whips side to side faster than the body of the flame sways, which is what makes it read as fire.
    const sway = Math.sin(now * 6.3 + i * 1.7) * tall * 0.14 + out * tall * (behind ? 0.4 : 0.14);
    const whip = Math.sin(now * 11.7 + i * 2.9) * tall * (0.1 + 0.06 * (qk - 1));
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
    // A fist at the chest burns behind too, or its flame is drawn over the face.
    (behind || foot.z > mid.z - 3 ? back : front).push(q);
    // No light down a tongue that rises off the head itself: it would light the face orange from behind.
    if (!nearHead) {
      gx.push(bx + sway * 0.4, bx + sway * 0.8);
      gy.push(by - tall * 0.3, by - tall * 0.7);
    }
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
  if (back.length) k.worldDraw(foot, draw(back, 1), -0.4);
  if (front.length) k.worldDraw(foot, draw(front, 1), 0.8);
  k.glow(k.at(b, 0.7), 10 + Math.min(H, 9), a * 0.3);
  // Each tongue alight in the dark: a glow down its middle, stronger at night, where a flame is what lights the body.
  const pic = k.fast ? null : glowPicture(k.pal.light);
  if (pic) glowsAlong(k, pic, gx, gy, Math.max(5, 4 * k.zoom), (0.25 + 0.5 * k.night) * a, 1);
}

/**
 * Torn gashes across a body at `at`: three side by side along the line the
 * axe went, `size` pixels at zoom one long, `open` nought to one how far
 * torn. Each an open split, dark in its upper half, with a wet red lip ragged along its lower side: wide enough to
 * read as a wound at play size rather than a stripe on a coat.
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
    const w = L * 0.11 * (0.6 + 0.4 * open);
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
  const lip = mixHex(DROP, '#ff5a3a', wet), ink = k.pal.ink;
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

/**
 * The enemies a blow round the caster reached, at most six: those the island said its blows landed on (`k.struck`), or
 * where it did not say, every creature anybody may harm within `r` tiles of the caster.
 */
const struckBy = (k: FxScene, r: number): Body[] => k.struck(r, k.caster).slice(0, 6);

/** The head of the weapon in the caster's hands, wherever the pose has put it: the edge of an axe, the face of a maul. */
const axeHead = (k: FxScene): P3 => k.joint(k.caster, 'tip');

/** Blood off a point: `n` drops flung along `dir` (all round without one), falling. */
function blood(k: FxScene, at: P3, n: number, o: { dir?: Ground; cone?: number; speed?: [number, number]; up?: [number, number]; size?: number } = {}): void {
  k.burst(at, n, {
    kind: 'drop', colour: [DROP, DROP, DROP_DARK], size: o.size ?? 2.2, sizeEnd: (o.size ?? 2.2) * 0.6, life: [0.45, 0.8],
    speed: o.speed ?? [0.4, 1.3], up: o.up ?? [6, 22], heading: o.dir, cone: o.cone ?? (o.dir ? 1.6 : undefined), gravity: 70, drag: 0.5, bias: 6,
  });
}

/**
 * A soft blot on the ground round a point, `r` tiles: a round outline swelling and pinching in lobes (two waves of
 * them, set by `salt`), not a polygon's corners. As flat x, y pairs, for `groundShape`.
 */
function blot(k: FxScene, x: number, y: number, r: number, n: number, salt: number): number[] {
  const h0 = hashOf(k.seed + salt, 3) * TAU, h1 = hashOf(k.seed + salt, 5) * TAU, sq = 0.85 + 0.3 * hashOf(k.seed + salt, 7);
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const rr = r * (0.84 + 0.1 * Math.sin(3 * a + h0) + 0.07 * Math.sin(5 * a + h1));
    pts.push(x + Math.cos(a) * rr * sq, y + Math.sin(a) * rr);
  }
  return pts;
}

/**
 * A pool of blood on the ground, `r` tiles, `dried` (nought to one) of the way from wet to dry: a lobed blot with a few
 * drops round it and a wet shine on it, darkening toward its own brown-black rather than fading (which over grass
 * goes olive) and drawing in as it soaks away, so it never sits as a slab; `alpha` only for its last moment.
 */
function pool(k: FxScene, c: Ground, r: number, dried: number, alpha = 1): void {
  const u = clamp(dried);
  // Its lobes reach a little past `r` and its drops further: drawn a fifth smaller, to cover what a ragged patch of `r` did.
  const R = 0.8 * r * (1 - 0.3 * u);
  if (R <= 0.02 || alpha <= 0.01) return;
  const n = k.fast ? 14 : 22;
  const paths = [blot(k, c.x, c.y, R, n, 0)];
  // The drops that landed round it, just off its lobes.
  for (let i = 0; i < 3; i++) {
    const an = hashOf(k.seed + i, 13) * TAU, d = R * (1.05 + 0.3 * hashOf(k.seed + i, 17));
    paths.push(blot(k, c.x + Math.cos(an) * d, c.y + Math.sin(an) * d, R * (0.1 + 0.08 * hashOf(k.seed + i, 19)), 8, i + 1));
  }
  const dark = dry(POOL, u, EARTH);
  const layers: GroundLayer[] = [{ kind: 'fill', colour: dark, alpha: clamp(alpha), paths, lift: 0.08 }];
  // The wet shine up and left on it, where the light is, going as it dries (its colour goes to the pool's, not its alpha).
  if (u < 0.95) layers.push({ kind: 'fill', colour: mixHex(DROP, dark, u), alpha: clamp(alpha), paths: [blot(k, c.x - R * 0.2, c.y - R * 0.25, R * 0.45, k.fast ? 8 : 12, 9)], lift: 0.09 });
  k.groundShape(c.x, c.y, R * 1.6 + 0.2, layers);
}

/**
 * Ground broken where a blow went into it, `r` tiles: dark earth thrown open with a lip of pale dust round it, at full
 * strength and drawing in as it goes (`shut`, one to nought) -- never a see-through dark patch over the grass.
 */
function crater(k: FxScene, c: Ground, r: number, shut = 1): void {
  const R = r * clamp(shut);
  if (R <= 0.02) return;
  const n = k.fast ? 12 : 18;
  k.groundShape(c.x, c.y, R * 1.4 + 0.2, [
    { kind: 'fill', colour: DUST, alpha: 1, paths: [blot(k, c.x, c.y, R * 1.2, n, 21)], lift: 0.07 },
    { kind: 'fill', colour: EARTH, alpha: 1, paths: [blot(k, c.x, c.y, R * 0.85, n, 23)], lift: 0.08 },
  ]);
}

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
/**
 * How low what a blow is aimed at stands, nought to one: one for a wolf's back or head at the caster's knee, nought
 * for a man's chest or head at the caster's own, from the cue's aim (`c.aim`); a man's height when there is none.
 */
function lowness(c: PoseCue, at: 'chest' | 'head'): number {
  const h = c.aim ? c.aim[at] : at === 'head' ? 16 : 11;
  const [lo, hi] = at === 'head' ? [5, 16] : [4, 11];
  return 1 - clamp((h - lo) / (hi - lo), 0, 1);
}

/** The cue's weapon is held in both hands: a battle axe or a maul (shouldered), not a hatchet. */
const twoHands = (c: PoseCue): boolean => c.carry === 'shoulder';

/*
 * The weapon never changes hands: a battle axe or a maul on the left shoulder is swung left-handed (`cast.mirror`),
 * the pose written right-handed as ever and mirrored by the framework, so `carried` is never touched here.
 */
function swing(r: Rig, t: number, c: PoseCue, keys: readonly Swing[], o: { both?: number; bothAt?: number; stepped?: boolean } = {}): void {
  const ch = (j: number): number => one(t, keys.map((k) => [k[0], k[j]] as const));
  const pitch = ch(1), yaw = ch(2), out = ch(3);
  // The swinging shoulder, from the hips as the trunk is leant and the knees let the hips down -- or, stepping in
  // (`stepIn`, which has put the feet and let the hips down itself), where the step has carried the hips.
  const lean = (r.spine[0] + r.chest[0]) * RAD;
  const knee = ((r.knee[0] + r.knee[1]) / 2) * RAD;
  // On the move the walk keeps its own hips and feet (`castOver`), so the hand goals are from where the walk has them.
  const body = c.moving ? [0, 0, 0] : r.at;
  const drop = c.moving ? 0 : o.stepped ? r.at[2] : -(BUILD.thigh + BUILD.shin) * (1 - Math.cos(knee / 2)) * (1 - (r.kneel ?? 0));
  const hips = BUILD.hips + drop + (c.moving ? 0 : (r.lift ?? 0) * 0.5);
  const sh: [number, number, number] = [body[0] + BUILD.shoulder[0] * 0.55, body[1] - Math.sin(lean) * TRUNK, hips + Math.cos(lean) * TRUNK];
  const d = dirOf(pitch, yaw);
  const at: [number, number, number] = [sh[0] + d[0] * ARM * out, sh[1] + d[1] * ARM * out, sh[2] + d[2] * ARM * out];
  r.reach = [r.reach?.[0], { at, haft: dirOf(pitch + ch(4), yaw + ch(5)) }];
  r.wield = 1;
  if (twoHands(c)) {
    r.both = o.both ?? 1;
    if (o.bothAt !== undefined) r.bothAt = o.bothAt;
  }
}

/**
 * How far short of the weapon's own reach a blow's last stride stops, in height units: the stage carries the body
 * in until the blow would reach the near side of what it strikes (`cast.close`, six and the weapon's length), and the
 * stride goes this much less than that again -- so the head lands in the creature, not on the air in front of it.
 */
const STRIDE_SHORT = 7;
/**
 * The furthest that stride carries the body, in height units. The back foot stays where it stood and a leg is about
 * six and a half long, so the hips can go no more than three or so past it and stay up: `stepIn`'s own twelve (and
 * even five) sat the body down on the ground with its legs split. The stage carries the rest of the way (`cast.close`).
 */
const STRIDE_MOST = 3;

/**
 * The last stride in to a blow, standing (`stepIn`): the lead foot put down nearer over `from`..`hit`, the back one
 * kept, and back again from `back`. Called before `swing`, which reaches from where the step has carried the body;
 * says whether the feet were put (and so the hips with them).
 *
 * The stage runs the legs in while it carries the body (`cast.close`'s steps) and hands them back to the pose over
 * the last fifth of the way in; `from` is put there (`lateStride`), so the run lands and only then does the lead foot
 * go out -- one stride after the run, never one on top of it -- and `back` is the close's own, so the foot comes
 * back as the bounds take the legs.
 */
function stride(r: Rig, t: number, c: PoseCue, o: { hit: number; from?: number; back?: number; short?: number; bend?: number }): boolean {
  if (c.moving || !c.aim) return false;
  const by = clamp(c.aim.near - c.aim.close - (o.short ?? STRIDE_SHORT), 0, STRIDE_MOST);
  if (by <= 0.01) return false;
  // The step is the going forward: the pose's own lean of the hips ahead is kept to a unit, or it and the step together
  // carry the hips further past the planted back foot than the leg reaches.
  r.at[1] = Math.min(r.at[1], 1);
  stepIn(r, t, c, { hit: o.hit, from: o.from, back: o.back, by, bend: o.bend });
  return true;
}

/**
 * Where in the cast the stage's run in hands the legs back to the pose, for a close over `from`..`to`: its steps
 * blend out over the last fifth of the way, which `smooth` puts at seven tenths of the time.
 */
const lateStride = (from: number, to: number): number => from + 0.7 * (to - from);

/* ---- the spells ------------------------------------------------------------------------------------------------- */

/**
 * The same turn of a joint written the other way about when its yaw is past a quarter turn: pitch and yaw half a
 * turn on, the roll taken from the far side. `armOut` gives an arm flung up and out as [-158, 62, 180], and keyed
 * against a pose near nought that swings the long way round (and its yaw flips between 180 and -180 from one key to
 * the next); written [22, 118, 0], it is the same arm and keys straight.
 */
function unflip(e: readonly [number, number, number]): [number, number, number] {
  if (Math.abs(e[2]) <= 90) return [e[0], e[1], e[2]];
  const wrap = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;
  return [wrap(e[0] + 180), 180 - e[1], wrap(e[2] + 180)];
}
/** Last Rage's arms flung wide: a V up and out, the same for either arm (`out` is away from the body for both). */
const LAST_V = unflip(armOut(1, 140, 55));

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
  // stumble across to catch it, carried in to what it strikes over the wind-up. The cut is the band the axe really
  // swept, torn; the blow lands where the axe is, and sparks and blood go off the way it was going.
  berserker_wild_swing: {
    palette: PALETTE,
    cast: {
      timing: { secs: 0.85, release: 0.4 },
      // The stumble across gets its beat before the bounds back take the legs.
      close: { from: 0.04, to: 0.4, back: 0.78 },
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
        r.at = e3(t, [[0, [0, 0, 0]], [0.3, [0, -1, 0]], [0.4, [0, 4, 0]], [0.62, [-2, 7, 0]], [1, [0, 0, 0]]]);
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
        k.glow(axeHead(k), 5, 0.5 * seg(t, 0.12, 0.32) * (1 - seg(t, 0.36, 0.42)));
        // The band the axe swept, eaten as the follow-through slows: no longer than a blow's, or it wraps half round behind the body.
        if (t > 0.3 && t < 0.75) rent(k, { secs: 0.055, inner: 0.5 });
      },
      hit: (k) => {
        const at = k.heart(k.target);
        const along = k.toward(k.caster, k.target);
        // The cut runs across the target from the swinging side: the sparks and the blood go off the other way.
        const across = { x: along.y * k.side, y: -along.x * k.side };
        k.burst(at, 26, { kind: 'spark', size: 2.2, life: [0.25, 0.5], speed: [1.2, 2.6], up: [2, 24], heading: { x: across.x * 0.8 + along.x * 0.6, y: across.y * 0.8 + along.y * 0.6 }, cone: 1.3, gravity: 60, drag: 0.1 });
        blood(k, at, 8, { dir: across, cone: 1.2 });
        k.burst(k.at(k.caster, 0.05), 8, { kind: 'dust', colour: DUST, size: 3.4, life: [0.5, 0.9], speed: [0.2, 0.5], up: [2, 6], gravity: 2 });
      },
      impact: { secs: 0.55, draw: (k, u) => {
        const at = k.heart(k.target);
        starburst(k, at, 11 * (1.15 - 0.5 * u), { alpha: flashOf(u, 0.1), points: 6 });
        k.light(k.target, 1.6, 0.7 * (1 - u));
      } },
    },
  },

  // Shrug It Off (buff, on self): Your worst wound is 50% less severe, and it stops bleeding.
  //
  // Hunched over the hurt, the free hand clamped on it, dripping; then a roll of one shoulder and the other that
  // flings the blood off, and the chest thrown out. The wound is seared shut where the hand held it: a stitched bar
  // of heat across the belly that cools from white through ember to a dark seam and stays, a puff of steam off it.
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
        // Hunched with the free (left) hand clamped over the wound; then both fists clenched as the chest goes out.
        r.arm[0] = e3(t, [[0, [10, 10, 0]], [0.25, [34, -14, 34]], [0.42, [30, -8, 28]], [0.5, [-14, 26, 0]], [0.62, [-12, 24, 0]], [1, [8, 10, 0]]]);
        r.elbow[0] = one(t, [[0, 30], [0.25, 112], [0.42, 100], [0.5, 34], [1, 24]]);
        r.arm[1] = e3(t, [[0, [10, 10, 0]], [0.25, [20, 4, 10]], [0.45, [24, 22, 10]], [0.5, [-14, 26, 0]], [0.62, [-12, 24, 0]], [1, [8, 10, 0]]]);
        r.elbow[1] = one(t, [[0, 30], [0.25, 70], [0.45, 60], [0.5, 34], [1, 24]]);
        r.shape = [{ cup: one(t, [[0, 0], [0.2, 1], [0.44, 1], [0.5, 0]]), claw: one(t, [[0.44, 0], [0.5, 0.5], [0.7, 0.5], [0.9, 0]]) }, { claw: one(t, [[0.44, 0], [0.5, 0.5], [0.7, 0.5], [0.9, 0]]) }];
        r.mouth = one(t, [[0, 0], [0.25, 0.25], [0.45, 0.15], [0.52, 0.55], [0.7, 0.3], [1, 0]]);
        r.knee = [one(t, [[0, 4], [0.25, 22], [0.5, 2], [1, 4]]), one(t, [[0, 4], [0.25, 22], [0.5, 2], [1, 4]])];
        r.leg = [e3(t, [[0, [2, 2, 0]], [0.25, [10, 6, 0]], [0.5, [0, 8, 0]], [1, [2, 2, 0]]]), e3(t, [[0, [2, 2, 0]], [0.25, [10, 6, 0]], [0.5, [0, 8, 0]], [1, [2, 2, 0]]])];
      },
    },
    fx: {
      charge: (k, t) => {
        // The wound dripping under the hand while hunched over it, then flung off by each roll of the shoulders.
        if (t < 0.32) k.emit(wound(k), 10 * seg(t, 0.05, 0.25), { kind: 'drop', colour: DROP, size: 1.8, life: [0.4, 0.6], speed: [0, 0.08], up: [-2, 2], gravity: 60, bias: 6 });
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
        // Seared: the one puff of steam off the wound, going out and up.
        k.burst(wound(k), 12, { kind: 'mist', colour: '#e8ded6', size: 2.2, sizeEnd: 6, life: [0.5, 0.9], speed: [0.15, 0.4], up: [6, 14], gravity: -4, drag: 0.4, heading: k.facingDir(k.caster), cone: 1.4 });
        k.burst(wound(k), 10, { kind: 'ember', colour: [k.pal.core, k.pal.accent], size: 1.6, life: [0.25, 0.5], speed: [0.2, 0.5], up: [4, 12], gravity: 10 });
      },
      impact: { secs: 2.2, draw: (k, u) => {
        // The seal: a stitched bar seared across the wound, white-hot, cooling through the ember to a dark seam that stays.
        const secs = 2.2, age = u * secs;
        const heat = 1 - smooth(seg(age, 0.1, 1.1));
        const b = k.caster;
        const c = wound(k);
        const f = k.facingDir(b);
        const across = { x: -f.y, y: f.x };
        // Only on the front of the body: from behind, the body hides it.
        const shows = k.eye.worldToScreenY(c.x + f.x * 0.05, c.y + f.y * 0.05, 0) >= k.eye.worldToScreenY(c.x, c.y, 0);
        const grow = easeOut(seg(age, 0, 0.12));
        // Short enough to stay inside the trunk's outline from any side: a seam on the belly, not a plate held to it.
        const L = 1.6 * grow;
        const bar: P3[] = [-1, -0.5, 0, 0.5, 1].map((s) => ({ x: c.x + (across.x * s * L) / 40, y: c.y + (across.y * s * L) / 40, z: c.z + s * 0.45 }));
        const main = mixHex(DROP_DARK, k.pal.accent, heat), core = mixHex('#3a0a0a', k.pal.core, heat);
        // It closes at the end rather than fading: the seam drawn shorter from both ends.
        const shut = 1 - smooth(seg(age, secs - 0.35, secs));
        if (shut > 0.02) {
          const mid = bar[2], pts = bar.map((p) => ({ x: lerp(mid.x, p.x, shut), y: lerp(mid.y, p.y, shut), z: lerp(mid.z, p.z, shut) }));
          // Cooled, a faint ember still glows along it, at night when a dark seam on a dark body is otherwise lost.
          band(k, pts, { width: 1.8, taper: 'both', main, core, ink: '#2a0806', glow: Math.max(heat, 0.3 * k.night), bias: shows ? 10 : -2 });
          // The stitches: short bars across it, in the white heat while it is hot, dark once cool.
          const st: P3[][] = [-0.6, 0, 0.6].map((s) => {
            const p = { x: lerp(mid.x, mid.x + (across.x * s * L) / 40, shut), y: lerp(mid.y, mid.y + (across.y * s * L) / 40, shut), z: mid.z + s * 0.45 * shut };
            return [{ x: p.x, y: p.y, z: p.z + 0.6 }, { x: p.x, y: p.y, z: p.z - 0.6 }];
          });
          k.shapes(c, st.map((pts) => ({ pts, fill: false, ink: mixHex('#2a0806', k.pal.core, heat), width: 0.6, closed: false })), { bias: shows ? 10.5 : -1.5 });
        }
        if (!k.fast && heat > 0.1) k.emit(c, 7 * heat, { kind: 'mist', colour: '#d9cfc6', size: 1.4, sizeEnd: 3.6, life: [0.4, 0.7], speed: [0.03, 0.1], up: [8, 14], gravity: -4, jitter: 0.04, bias: 10 });
        k.light(b, 1.4, Math.max(0.55 * heat, 0.15 * shut), '#fff1d6');
      } },
    },
  },

  // Rending Chop (strike, on enemy): With an axe in hand: a blow at 110% that bleeds it as a knife does, 15% of the blow a second for 6 s.
  //
  // A one-armed chop down across from high on the right, a step in to land it, the axe let bite, held, and then
  // wrenched back out toward the hip: the wrench is what tears the wound, and the blood comes out after it. Three
  // ragged gashes stay open on the creature for the bleed's seconds, wet again and dripping at every second's tick,
  // and a pool spreads under it and dries.
  berserker_rending_chop: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.0, release: 0.34 },
      close: { from: 0.06, to: 0.34, back: 0.72 },
      pose: (r, t, c) => {
        r.chest = e3(t, [[0, [0, 0, 0]], [0.26, [6, -6, -26]], [0.34, [-10, 6, 18]], [0.46, [-10, 6, 18]], [0.56, [6, 0, -18]], [0.68, [6, 0, -20]], [1, [0, 0, 0]]]);
        r.spine = e3(t, [[0, [0, 0, 0]], [0.26, [6, 0, -8]], [0.34, [-16, 0, 8]], [0.46, [-16, 0, 8]], [0.56, [4, 0, -10]], [0.68, [4, 0, -10]], [1, [0, 0, 0]]]);
        r.head = e3(t, [[0, [0, 0, 0]], [0.26, [-4, 0, 18]], [0.34, [8, 0, -10]], [0.56, [-6, 0, 8]], [0.68, [-6, 0, 8]], [1, [0, 0, 0]]]);
        r.leg[0] = e3(t, [[0, [2, 2, 0]], [0.26, [8, 3, 0]], [0.34, [28, 4, 0]], [0.6, [20, 4, 0]], [1, [4, 2, 0]]]);
        r.knee[0] = one(t, [[0, 4], [0.34, 30], [0.6, 18], [1, 6]]);
        r.leg[1] = e3(t, [[0, [0, 2, 0]], [0.34, [-16, 2, 0]], [0.6, [-10, 2, 0]], [1, [-2, 2, 0]]]);
        r.knee[1] = one(t, [[0, 4], [0.34, 16], [0.6, 22], [1, 5]]);
        r.at = e3(t, [[0, [0, 0, 0]], [0.34, [0, 2, 0]], [0.46, [0, 2, 0]], [0.6, [0, -2, 0]], [0.7, [0, -2, 0]], [1, [0, 0, 0]]]);
        r.mouth = one(t, [[0, 0], [0.32, 0.3], [0.46, 0.4], [0.54, 0.85], [0.7, 0.6], [0.82, 0.2], [1, 0]]);
        const stepped = stride(r, t, c, { hit: 0.34, from: lateStride(0.06, 0.34), back: 0.72, bend: 16 });
        // Down into its back however low it stands: a wolf's below the hips, a man's at the chest.
        const low = lowness(c, 'chest');
        const bite = lerp(82, 58, low), lag = lerp(-5, -22, low);
        // Down across from high on the right, let bite and held there a beat, then wrenched back out toward the hip --
        // held there too, so the tear reads -- with the head still forward.
        swing(r, t, c, [[0, 35, 20, 0.6, 115, 0], [0.26, 165, 38, 0.85, 65, 0], [0.34, bite, -10, 1, lag, 0], [0.46, bite - 4, -12, 1, lag, 0], [0.56, 34, 30, 0.55, 55, -20], [0.68, 30, 32, 0.55, 58, -20], [0.8, 40, 28, 0.6, 70, -10], [1, 35, 20, 0.6, 115, 0]], { stepped });
        if (!twoHands(c)) {
          r.arm[0] = e3(t, [[0, [20, 12, 0]], [0.26, [56, 4, 24]], [0.34, [18, 30, 0]], [0.56, [40, 20, 10]], [0.68, [40, 20, 10]], [1, [8, 12, 0]]]);
          r.elbow[0] = one(t, [[0, 30], [0.26, 96], [0.34, 30], [0.56, 70], [1, 24]]);
        }
      },
    },
    fx: {
      charge: (k, t) => {
        k.glow(axeHead(k), 4.5, 0.55 * seg(t, 0.1, 0.26) * (1 - seg(t, 0.3, 0.36)));
        // The chop, and the short tear back out of the wound in blood.
        if (t > 0.24 && t < 0.46) rent(k, { secs: 0.08 });
        if (t > 0.46 && t < 0.66) rent(k, { secs: 0.07, inner: 0.7, key: 'wrench', main: DROP, core: '#ff7a5a', ink: DROP_DARK, glow: 0.4 });
        // The wrench out: the wound torn wider and the blood pulled out after the axe.
        if ((k.state.wrench ?? 0) === 0 && t > 0.5) {
          k.state.wrench = 1;
          blood(k, k.heart(k.target), 18, { dir: k.toward(k.target, k.caster), cone: 1.1, speed: [0.6, 1.6], up: [8, 20], size: 2.4 });
        }
      },
      hit: (k) => {
        const at = k.heart(k.target);
        k.burst(at, 14, { kind: 'spark', size: 2, life: [0.2, 0.45], speed: [0.8, 2], up: [0, 18], heading: k.toward(k.caster, k.target), cone: 1.8, gravity: 60 });
        blood(k, at, 10, { dir: k.toward(k.caster, k.target), cone: 1.4 });
      },
      impact: { secs: 0.5, draw: (k, u) => {
        const at = k.heart(k.target);
        starburst(k, at, 9 * (1 - 0.4 * u), { points: 5, alpha: flashOf(u, 0.05) * 0.9 });
        k.light(k.target, 1.6, 0.6 * (1 - u));
      } },
      linger: {
        secs: KNIFE_BLEED_SECS,
        draw: (k, age, left) => {
          const b = k.target;
          // The bleed ends with the island's word, once it has said the creature bleeds and then that it does not.
          if (b.bleeding) k.state.bled = 1;
          if (k.state.bled && !b.bleeding && k.state.staunched === undefined) k.state.staunched = age;
          const end = Math.min(left, k.state.staunched === undefined ? left : 0.4 - (age - k.state.staunched));
          if (end <= 0) return;
          const at = k.heart(b);
          const size = Math.max(6, b.tall * 0.36);
          // Each second's bleed: the gashes wet again -- their lips bright for a moment on the tick -- and drops falling from them.
          const pulse = 1 - smooth((age % 1) / 0.4);
          // They close at the end rather than fade.
          const shut = smooth(end / 0.6);
          gashes(k, at, size, { open: easeOut(age / 0.2) * (0.75 + 0.25 * easeOut(seg(age, 0.2, 0.5))) * shut, wet: (age % 1 < 0.14 ? 1 : 0.6 * pulse) * shut });
          const n = Math.floor(age);
          if ((k.state.tick ?? -1) < n && end > 0.5) {
            k.state.tick = n;
            blood(k, at, 1, { speed: [0.02, 0.08], up: [-2, 2], size: 2.8 });
            blood(k, at, 3, { speed: [0.02, 0.15], up: [-4, 4], size: 2 });
          }
          // The pool spreads as long as it bleeds and dries as it goes; it lets go by its alpha only in its last fifth of a second.
          const all = age + left;
          pool(k, b, 0.1 + 0.18 * smooth(age / all), smooth(age / all) * 0.7 + 0.3 * (1 - pulse), lateFade(end));
          k.glow(at, 5, 0.45 * pulse * shut, DROP, true);
          // The tick lights the creature red: at night it is all that says it bleeds.
          k.light(b, 1.0, ((0.2 + 0.4 * k.night) * pulse + 0.12 * k.night) * shut, DROP);
        },
      },
    },
  },

  // Skull Crack (strike, on enemy, lasts 2 s): With a maul in hand: a blow at 120% that holds it where it stands, neither moving nor striking, for 2 s;
  //
  // Short and brutal: the maul cocked behind the head on both hands, up on the toes, a step in, and brought straight
  // down onto the skull wherever it is -- a wolf's at the knee, a man's at the head -- stopping dead on it with a
  // bounce. The blow rings round the head twice; then, for the hold, three sparks circle it dazed while a band round
  // its feet closes, all the way shut as the hold lets go.
  berserker_skull_crack: {
    palette: PALETTE,
    cast: {
      timing: { secs: 0.7, release: 0.45 },
      // Back from three quarters, so the bounce off the skull is seen from close.
      close: { from: 0.04, to: 0.45, back: 0.75 },
      pose: (r, t, c) => {
        r.spine = e3(t, [[0, [0, 0, 0]], [0.32, [12, 0, 0]], [0.45, [-22, 0, 0]], [0.54, [-22, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = e3(t, [[0, [0, 0, 0]], [0.32, [8, 0, -6]], [0.45, [-14, 0, 4]], [1, [0, 0, 0]]]);
        r.head = e3(t, [[0, [0, 0, 0]], [0.32, [-14, 0, 0]], [0.45, [-10, 0, 0]], [1, [0, 0, 0]]]);
        r.lift = one(t, [[0, 0], [0.3, 0.8], [0.4, 0.4], [0.45, 0], [1, 0]]);
        r.leg[0] = e3(t, [[0, [2, 2, 0]], [0.32, [6, 3, 0]], [0.45, [26, 4, 0]], [1, [4, 2, 0]]]);
        r.knee[0] = one(t, [[0, 4], [0.32, 6], [0.45, 34], [0.55, 30], [1, 6]]);
        r.leg[1] = e3(t, [[0, [0, 2, 0]], [0.45, [-14, 2, 0]], [1, [-2, 2, 0]]]);
        r.knee[1] = one(t, [[0, 4], [0.45, 22], [1, 5]]);
        r.at = e3(t, [[0, [0, 0, 0]], [0.45, [0, 2.5, 0]], [1, [0, 0, 0]]]);
        r.mouth = one(t, [[0, 0], [0.3, 0.1], [0.45, 0.7], [0.6, 0.3], [1, 0]]);
        const stepped = stride(r, t, c, { hit: 0.45, from: lateStride(0.04, 0.45), back: 0.75, bend: 20 });
        // Down onto the skull, however high it is: a knee-high head takes the blow well below level, a man's nearly at it.
        const low = lowness(c, 'head');
        const p = lerp(84, 50, low), lag = lerp(0, -16, low);
        // Cocked behind the head, the head of it hanging down the back; brought straight over and down to stop dead, and a bounce.
        swing(r, t, c, [[0, 35, 20, 0.6, 115, 0], [0.32, 200, 4, 0.8, 85, 0], [0.45, p, 0, 1, lag, 0], [0.53, p - 2, 0, 1, lag + 1, 0], [0.6, p + 10, 0, 0.95, lag - 6, 0], [1, 35, 20, 0.6, 115, 0]], { stepped });
      },
    },
    fx: {
      charge: (k, t) => {
        k.glow(axeHead(k), 5, 0.6 * seg(t, 0.1, 0.32) * (1 - seg(t, 0.38, 0.46)));
        // Only the way down: sampled no further back than the cock (0.32), or the maul going up behind the head is cut too.
        if (t > 0.36 && t < 0.56) rent(k, { secs: Math.min(0.08, (t - 0.32) * 0.7) });
      },
      hit: (k) => {
        const skull = k.muzzle(k.target);
        k.burst(skull, 22, { kind: 'spark', colour: [k.pal.core, k.pal.accent], size: 2, life: [0.2, 0.45], speed: [1, 2.2], up: [6, 26], gravity: 50, over: true });
        k.burst(k.at(k.target, 0.04), 8, { kind: 'dust', colour: DUST, size: 3.4, life: [0.5, 0.9], speed: [0.3, 0.6], up: [1, 5], gravity: 2 });
      },
      impact: { secs: 0.6, draw: (k, u) => {
        const b = k.target;
        const skull = k.muzzle(b);
        // One thing at a time on the one spot: the star, quick and gone; then the blow ringing round the head, twice, as a
        // bell does, in the pale core so it is not one more orange thing on the star. No cracks: it was a skull it hit.
        starburst(k, skull, 9 * (1 - 0.35 * u), { points: 8, alpha: flashOf(seg(u, 0, 0.5), 0.1) });
        for (let i = 0; i < 2; i++) {
          const v = seg(u, 0.08 + i * 0.22, 0.6 + i * 0.22);
          // Thinning to nothing as it spreads, rather than fading: orange half gone over grass is khaki.
          if (v > 0 && v < 0.92) haloRing(k, skull, { x: b.x, y: b.y, z: b.z }, 5 + 13 * easeOut(v), { width: 2.4 * (1 - v / 0.92) + 0.3, main: k.pal.core });
        }
        k.light(b, 1.6, 0.7 * (1 - u));
      } },
      linger: {
        draw: (k, age, left) => {
          const b = k.target;
          const hold = age + left;
          const a = smooth(age / 0.2) * smooth(left / 0.25);
          // Three dazed sparks circling the skull.
          const skull = k.muzzle(b);
          const up = skull.z - b.z + 2.5;
          for (let i = 0; i < 3; i++) {
            const an = age * 5.5 + (i * TAU) / 3;
            const p = k.local(b, Math.cos(an) * b.wide * 0.9, Math.sin(an) * b.wide * 0.9, up + Math.sin(an * 2) * 0.6);
            const q = { x: p.x + skull.x - b.x, y: p.y + skull.y - b.y, z: p.z };
            k.mark(q, { r: 2.6 * a, points: 4, turn: age * 7 + i, bias: Math.sin(an) < 0 ? 4 : -4, glow: 0.7 });
          }
          // The hold: a band round the feet in the one colour, closing as it runs out.
          const R = Math.max(0.24, (b.wide / 40) * 2.6);
          const gone = (age / hold) * TAU;
          // Thin while the blow rings round the head (the impact's 0.6 s), full width only once that has gone.
          const wide = 0.03 + 0.015 * smooth(seg(age, 0.5, 0.8));
          if (a > 0.05) arcs(k, b, R, wide * a, [[-Math.PI / 2 + gone, Math.PI * 1.5]], { alpha: 1, main: k.pal.accent, deep: k.pal.accent, glow: 0.4 + 0.6 * k.night });
        },
      },
    },
  },

  // Battle Rage (buff, on self, lasts 15 s): For 15 s you deal 30% more damage and take 20% more.
  //
  // Crouched and gathering, fists in, then up into a war cry: the weapon thrust at the sky, the other fist down and
  // out, chest out and head back, the cry going out ahead as torn rings. Broad fire licks up off the shoulders, the
  // back of the head and the fists for as long as it lasts; a ring of small teeth knocked out round the feet, one for
  // each second, loses one a second; and now and then a drop of the caster's own blood falls -- what it costs.
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
            if (k.rand() < 0.6 * g) k.burst(p, 1, { kind: 'ember', size: 1.8, life: [0.25, 0.4], speed: [1.6, 2.4], up: [2, 10], heading: { x: -Math.cos(an), y: -Math.sin(an) }, cone: 0.2, gravity: 0, drag: 0.3, over: true });
          }
        }
        k.glow(k.chest(), 7, 0.5 * g);
      },
      release: (k) => {
        k.burst(axeHead(k), 30, { kind: 'ember', colour: [k.pal.core, k.pal.accent, k.pal.main], size: 2, life: [0.4, 0.8], speed: [0.4, 1.1], up: [6, 26], gravity: 8, drag: 0.2, over: true });
        k.burst(k.at(k.caster, 0.05), 16, { kind: 'dust', colour: DUST, size: 4, life: [0.5, 1], speed: [0.6, 1.1], up: [1, 4], gravity: 2, drag: 0.1 });
      },
      impact: { secs: 0.85, draw: (k, u) => {
        const b = k.caster;
        // The cry: three torn rings going out ahead of the face, one after the other.
        for (let i = 0; i < 3; i++) {
          const v = seg(u, i * 0.13, 0.5 + i * 0.13);
          if (v > 0 && v < 1) shout(k, b, v, 1);
        }
        k.flare(axeHead(k), 9, flashOf(u, 0.08), k.pal.core);
        k.light(b, 2.2, 0.8 * (1 - u));
      } },
      linger: {
        draw: (k, age, left) => {
          const b = k.caster;
          const all = age + left;
          const a = smooth(age / 0.4) * smooth(left / 0.6);
          warFire(k, b, { n: 6, h: 7, alpha: a, main: RAGE_FIRE.main, deep: RAGE_FIRE.deep, core: RAGE_FIRE.core });
          // A tooth for every second of it, one burning away each second: knocked out from the feet by the cry, then held.
          const secs = Math.round(k.fx.secs ?? all);
          const out = easeOut(seg(age, 0, 0.35));
          sawRing(k, b, 0.12 + 0.22 * out + 0.06 * Math.sin(Math.PI * out), { teeth: secs, left: left / all, alpha: lateFade(left, 0.3), turn: -Math.PI / 2, tooth: 0.09 + 0.05 * (1 - out), wide: 0.09, glow: 0.3 + 0.5 * k.night });
          if (!k.fast) k.emit(k.at(b, 0.75), 8 * a, { kind: 'ember', colour: [k.pal.accent, k.pal.core], size: 1.6, life: [0.4, 0.8], speed: [0.05, 0.2], up: [12, 22], gravity: 0, jitter: 0.12, over: true });
          // What it costs: every second and a half a drop of the caster's own blood off an arm or the chest.
          const drip = Math.floor(age / 1.5);
          if (drip > (k.state.drip ?? 0) && left > 0.6) {
            k.state.drip = drip;
            const from = ['arm0', 'arm1', 'chest', 'elbow0'][drip % 4];
            blood(k, k.joint(b, from, [0, 0.6, -1.4], 0.6), 3, { speed: [0.05, 0.25], up: [0, 6], size: 2 });
          }
          k.light(b, 1.8, (0.32 + 0.08 * Math.sin(age * 11)) * a);
        },
      },
    },
  },

  // Adrenaline (buff, on self, lasts 10 s): Costs no stamina. For 10 s a swing or a draw costs no stamina and takes 15% less time.
  //
  // A sharp breath in and two thumps of the left fist on the chest, up on the toes: the heart kicking. For as long
  // as it lasts the heart beats fast and bright, and on every beat the weapon arm and the weapon itself flicker
  // ahead of themselves -- two quick after-images of the weapon, the swing that comes sooner. Amber darts round the
  // feet, one a second, tick round on every beat and lose one a second.
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
      },
    },
    fx: {
      charge: (k, t) => {
        k.glow(k.chest(), 6, 0.6 * seg(t, 0.05, 0.28), QUICK.main, true);
      },
      release: (k) => heartbeat(k, 1),
      impact: { secs: 0.5, draw: (k, u) => {
        // The second thump, a twentieth of the cast on.
        if ((k.state.dub ?? 0) === 0 && u > 0.2) {
          k.state.dub = 1;
          heartbeat(k, 0.8);
        }
      } },
      linger: {
        draw: (k, age, left) => {
          const b = k.caster;
          const all = age + left;
          const a = smooth(age / 0.3) * smooth(left / 0.6);
          // The heart: a double beat every half second and a little more, off the chest.
          const beat = (age % 0.55) / 0.55;
          const p1 = 1 - smooth(beat / 0.18), p2 = 1 - smooth(seg(beat, 0.2, 0.4));
          const pulse = Math.max(p1, 0.7 * p2);
          const heart = k.chest();
          k.glow(heart, 4 + 4 * pulse, (0.3 + 0.6 * pulse) * a, QUICK.main, true);
          k.flare(heart, 3 + 4 * pulse, pulse * a, QUICK.core);
          // On each beat the weapon flickers ahead of itself, held a moment and then eaten back into it: what swings sooner.
          const since = age % 0.55;
          quickening(k, b, (1 - smooth(seg(since, 0.1, 0.2))) * a);
          // A dart for every second of it, one going out each second, ticking round the feet on every beat.
          const secs = Math.round(k.fx.secs ?? all);
          const ticks = Math.floor(age / 0.55) + easeOut(clamp(since / 0.12));
          darts(k, b, 0.32, secs, Math.min(left / all, easeOut(age / 0.35)), -Math.PI / 2 + (ticks * 0.5 * TAU) / secs, { alpha: lateFade(left, 0.3), glow: 0.3 + 0.5 * k.night });
          k.light(b, 1.3, (0.2 + 0.35 * pulse) * a, '#fff1d6');
        },
      },
    },
  },

  // Blood Price (strike, on enemy): Costs no stamina but 10% of your health: a blow at 250%.
  //
  // The price paid first: the axe held up high before the face and the free palm drawn down its edge, a burst of
  // blood off the hand; the blade runs red and drips. Then a step in and a huge two-handed downstroke in blood,
  // splashing the creature and the ground, and blood off the caster as it lands -- the tenth of their health it took.
  berserker_blood_price: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.35, release: 0.58 },
      close: { from: 0.34, to: 0.58, back: 0.72 },
      pose: (r, t, c) => {
        const q = shake(t, 0.14, 0.3, 1.5, 70);
        r.chest = e3(t, [[0, [0, 0, 0]], [0.14, [6, 0, -8]], [0.31, [-6, 0, -10]], [0.5, [12, 0, -10]], [0.58, [-14, 0, 10]], [0.64, [-14, 0, 10]], [0.8, [6, 0, 0]], [1, [0, 0, 0]]]);
        r.spine = e3(t, [[0, [0, 0, 0]], [0.31, [-4, 0, 0]], [0.5, [12, 0, -4]], [0.58, [-24, 0, 6]], [0.64, [-24, 0, 6]], [0.8, [2, 0, 0]], [1, [0, 0, 0]]]);
        r.head = e3(t, [[0, [0, 0, 0]], [0.14, [10, 0, 6]], [0.26, [10, 0, 6]], [0.31, [-16, 0, 10]], [0.5, [-12, 0, 0]], [0.58, [16, 0, 0]], [0.8, [4, 0, 0]], [1, [0, 0, 0]]]);
        r.shrug = [one(t, [[0, 0], [0.64, 0], [0.74, 0.9], [0.84, 0.1], [0.92, 0.7], [1, 0]]), one(t, [[0, 0], [0.64, 0], [0.74, 0.9], [0.84, 0.1], [0.92, 0.7], [1, 0]])];
        r.leg[0] = e3(t, [[0, [2, 2, 0]], [0.5, [8, 4, 0]], [0.58, [32, 4, 0]], [0.8, [20, 4, 0]], [1, [4, 2, 0]]]);
        r.knee[0] = one(t, [[0, 4], [0.5, 8], [0.58, 40], [0.8, 20], [1, 6]]);
        r.leg[1] = e3(t, [[0, [0, 2, 0]], [0.5, [-6, 2, 0]], [0.58, [-20, 2, 0]], [1, [-2, 2, 0]]]);
        r.knee[1] = one(t, [[0, 4], [0.58, 22], [1, 5]]);
        r.at = e3(t, [[0, [0, 0, 0]], [0.5, [0, -1, 0]], [0.58, [0, 3, 0]], [0.7, [0, 3, 0]], [1, [0, 0, 0]]]);
        r.mouth = one(t, [[0, 0], [0.22, 0.1], [0.28, 0.45], [0.36, 0.2], [0.58, 0.85], [0.7, 0.4], [1, 0]]);
        const stepped = stride(r, t, c, { hit: 0.58, from: lateStride(0.34, 0.58), back: 0.72, bend: 18 });
        // The axe held up high across the face, its head before the eyes and out toward the near side of the body; the
        // free palm laid flat on the blade by the head and drawn down its edge (the hand on the haft, closing nearer the
        // fist); then both hands to it for the blow.
        const head = twoHands(c) ? 1 : 0.42;
        // Turned out toward whoever is looking, so the palm on the blade is not hidden behind the head: as far round toward
        // the viewer as the arm goes in front of the body (the viewer is round to the right by an eighth a facing).
        const cam = ((((c.facing * 45 + 180) % 360) + 360) % 360) - 180;
        // With its back to the viewer the blade is held up over the head as well, where it shows above the shoulders.
        const show = clamp(cam === -180 ? 180 : cam, -50, 50) * 0.85, high = Math.abs(cam) > 90 ? 100 : 62;
        swing(r, t, c, [[0, 35, 20, 0.6, 115, 0], [0.14, high, show, 0.66, 80 + q, -80], [0.3, high, show, 0.66, 80, -80], [0.38, 80, 8, 0.65, 70, -50], [0.5, 200, 10, 0.85, 70, 0], [0.58, 80, -5, 1, -5, 0], [0.64, 76, -5, 1, -5, 0], [0.8, 50, 10, 0.75, 30, 0], [1, 35, 20, 0.6, 115, 0]],
          { both: 1, bothAt: one(t, [[0, 2.5], [0.12, 8.2 * head], [0.2, 8.2 * head], [0.3, 5.6 * head], [0.36, 5.6 * head], [0.46, 2.5], [1, 2.5]]), stepped });
        if (!twoHands(c)) r.both = one(t, [[0.05, 0], [0.14, 1], [0.34, 1], [0.42, 0]]);
        r.shape = [{ flat: one(t, [[0.08, 0], [0.14, 1], [0.32, 1], [0.38, 0]]) }, undefined];
      },
    },
    fx: {
      charge: (k, t) => {
        // The palm drawn down the edge: a burst of blood off the hand as it comes away.
        const palm = k.hand(k.lefty ? 1 : 0);
        if ((k.state.cut ?? 0) === 0 && t >= 0.28) {
          k.state.cut = 1;
          k.state.cutAt = k.now;
          // Where the hand was off the body, so the blood flung off it is carried in with the body (`palmSpray`).
          k.state.palmX = palm.x - k.caster.x;
          k.state.palmY = palm.y - k.caster.y;
          k.state.palmZ = palm.z - k.caster.z;
        }
        if (k.state.cut) palmSpray(k, k.now - (k.state.cutAt ?? k.now));
        if (k.state.cut && k.now - (k.state.cutAt ?? 0) < 0.3) {
          const v = (k.now - (k.state.cutAt ?? 0)) / 0.3;
          starburst(k, palm, 7 * (1 - 0.5 * v), { points: 5, alpha: flashOf(v, 0.1), main: DROP, core: '#ff7a5a', ink: DROP_DARK, glow: 0.5 });
          k.flare(palm, 6, 1 - v, '#ff6a52', 0, undefined, true);
        }
        // The blade run red, dripping, and the cut hand dripping too, until the blow.
        const red = seg(t, 0.27, 0.34) * (1 - seg(t, 0.62, 0.8));
        if (red > 0) {
          const head = axeHead(k);
          k.glow(head, 5, 0.75 * red, DROP, true);
          k.emit(head, 9 * red, { kind: 'drop', colour: DROP, size: 1.8, life: [0.3, 0.5], speed: [0, 0.1], up: [-4, 0], gravity: 70, bias: 6 });
          if (t < 0.5) k.emit(palm, 6 * red, { kind: 'drop', colour: DROP, size: 1.6, life: [0.3, 0.5], speed: [0, 0.05], up: [-2, 0], gravity: 70, bias: 6 });
        }
        // The downstroke in blood, off the real blade, and drops flung off it along its arc.
        if (t > 0.5 && t < 0.7) {
          rent(k, { secs: 0.09, inner: 0.62, main: DROP, core: '#ff7a5a', ink: DROP_DARK });
          if (t < 0.6) k.emit(axeHead(k), 50, { kind: 'drop', colour: [DROP, DROP_DARK], size: 2, life: [0.3, 0.6], speed: [0.2, 0.6], up: [0, 10], gravity: 70, bias: 6 });
        }
      },
      hit: (k) => {
        const at = k.heart(k.target);
        const along = k.toward(k.caster, k.target);
        blood(k, at, 36, { dir: along, cone: 2.2, speed: [0.6, 2], up: [8, 30], size: 2.6 });
        k.burst(at, 24, { kind: 'spark', colour: [k.pal.core, k.pal.accent], size: 2.2, life: [0.25, 0.5], speed: [1, 2.4], up: [4, 24], heading: along, cone: 2, gravity: 60, over: true });
        // The price: blood off the caster as the blow takes it.
        blood(k, k.chest(), 10, { speed: [0.1, 0.5], up: [2, 10] });
      },
      impact: { secs: 1.6, draw: (k, u) => {
        const secs = 1.6, age = u * secs, left = secs - age;
        const at = k.heart(k.target);
        starburst(k, at, 16 * (1.1 - 0.4 * seg(age, 0, 0.9)), { points: 9, alpha: flashOf(seg(age, 0, 0.9), 0.06), main: DROP, core: k.pal.core, ink: DROP_DARK });
        // The pool spreads, dries to brown-black and draws in, and only then lets go. (The caster's own blood is the
        // splash off them at the blow: a pool of it would be left mid-field when the body bounds back.)
        const grow = easeOut(seg(age, 0, 0.5)), drying = smooth(seg(age, 0.3, 1.3));
        pool(k, k.target, 0.14 + 0.16 * grow, drying, lateFade(left));
        k.light(k.target, 1.8, 0.9 * (1 - seg(age, 0, 0.9)));
      } },
    },
  },

  // Execute (strike, on enemy): A blow at 300% on a creature below 25% of its health, and at 100% on one above it.
  //
  // An executioner's stroke: feet set wide, walked up to it with the axe going up straight overhead on both arms and
  // held there while a red line marks the creature from above down to its neck and two arcs close on it; then a step
  // and the drop, straight down the line, and a level cut clean through it at the neck, the two halves parting.
  // The 300% stroke, on one the island says was below its line (`told.low`), throws twice the blood and cuts broader.
  berserker_execute: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.45, release: 0.62 },
      close: { from: 0.06, to: 0.44, back: 0.8 },
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
        // The run in is over by the time the axe is up (0.44); the step is the drop's own.
        const stepped = stride(r, t, c, { hit: 0.62, from: 0.5, back: 0.8, bend: 18 });
        // Raised straight up on both arms and held there, the head of it to the sky; then straight down, the head ending at the neck.
        swing(r, t, c, [[0, 35, 20, 0.6, 115, 0], [0.14, 70, 0, 0.7, 60, 0], [0.42, 178 + q, 0, 0.95, 0, 0], [0.56, 176, 0, 0.95, 2, 0], [0.62, 72, 0, 1, -12, 0], [0.7, 68, 0, 1, -12, 0], [0.85, 45, 0, 0.75, 40, 0], [1, 35, 20, 0.6, 115, 0]], { stepped });
      },
    },
    fx: {
      charge: (k, t) => {
        const b = k.target;
        const neck = neckOf(k, b), top = { x: neck.x, y: neck.y, z: b.z + b.tall * 3 };
        // The line it falls down, from high over it to the neck, and the arcs closing on it, while the axe is up.
        const mark = smooth(seg(t, 0.2, 0.44)) * (1 - seg(t, 0.6, 0.64));
        if (mark > 0) {
          const down = smooth(seg(t, 0.2, 0.4));
          const end = { x: neck.x, y: neck.y, z: lerp(top.z, neck.z, down) };
          band(k, [top, { x: top.x, y: top.y, z: lerp(top.z, end.z, 0.5) }, end], { width: 2.1, alpha: 1, taper: 'start', main: k.pal.main, core: k.pal.core, glow: 0.6 * mark });
          if (down > 0.95) k.flare(neck, 4, 0.7 * mark * (0.75 + 0.25 * Math.sin(k.now * 14)), k.pal.core);
          const close = smooth(seg(t, 0.2, 0.56));
          const R = Math.max(0.28, (b.wide / 40) * 3.2) * (1.8 - 0.8 * close);
          const turn = close * 1.6;
          // Drawn thin and thickening rather than faded in, and thinned away again: no khaki ghost of red on the grass.
          if (mark > 0.05) arcs(k, b, R, 0.045 * mark, [[turn, turn + 1.9], [turn + Math.PI, turn + Math.PI + 1.9]], { alpha: 1, glow: 0.4 + 0.5 * k.night });
          k.flare(axeHead(k), 6, bump01(seg(t, 0.4, 0.58)) * 0.9, k.pal.core, k.now);
        }
        // The drop, off the real blade.
        if (t > 0.54 && t < 0.72) rent(k, { secs: 0.08 });
      },
      hit: (k) => {
        const neck = neckOf(k, k.target);
        // The full stroke, on one the island says was below its line (`low`): three times the blow, twice the blood.
        const full = k.told?.low ? 2 : 1;
        blood(k, neck, 24 * full, { speed: [0.5, 1.5 * full], up: [10, 30], size: 2.4 });
        k.burst(neck, 16 * full, { kind: 'spark', colour: [k.pal.core], size: 2, life: [0.2, 0.4], speed: [1.4, 2.6], up: [-2, 6], gravity: 20, over: true });
      },
      impact: { secs: 1.5, draw: (k, u) => {
        const secs = 1.5, age = u * secs, left = secs - age;
        const b = k.target;
        const neck = neckOf(k, b);
        // The level cut through it, flung out to both sides, its halves parting -- and eaten from its ends rather than faded.
        const f = k.toward(k.caster, b);
        const side = { x: -f.y, y: f.x };
        const v = seg(age, 0, 0.8);
        const len = ((b.wide * 1.6 + 6) * (0.45 + 0.55 * easeOut(v * 3)) * (1 - smooth(seg(v, 0.55, 1)))) / 40;
        const part = 0.7 * easeOut(seg(v, 0.12, 0.6));
        if (len > 0.01) {
          for (const s of [1, -1]) {
            const z = neck.z + s * part;
            const p0 = { x: neck.x - side.x * len * s, y: neck.y - side.y * len * s, z };
            const p1 = { x: neck.x + side.x * len * s, y: neck.y + side.y * len * s, z };
            band(k, [p0, { x: lerp(p0.x, p1.x, 0.5), y: lerp(p0.y, p1.y, 0.5), z }, p1], { width: (k.told?.low ? 7 : 4.5) * (1 - 0.5 * v), alpha: 1, taper: 'both', bias: 10 });
          }
        }
        starburst(k, neck, (k.told?.low ? 13 : 7) * (1 - v), { points: k.told?.low ? 8 : 4, alpha: flashOf(v, 0.04), turn: 0 });
        pool(k, b, 0.12 + 0.14 * easeOut(seg(age, 0, 0.5)), smooth(seg(age, 0.3, 1.2)), lateFade(left));
        k.light(b, 1.8, 0.8 * (1 - v));
      } },
    },
  },

  // Overhead Smash (strike, on enemy): A crushing blow at 250% that cannot miss; your own next swing comes 1.5 s later.
  //
  // The biggest wind-up the trade has: back arched, the axe hanging down behind it, a step in, then over and down
  // two-handed through the creature into the ground, where it sticks. The ground splits from where the head went
  // in and out under the creature, and throws up stone; the caster is left bent over the stuck axe and heaves it out,
  // and the cracks smoulder for the 1.5 s the next swing waits, the axe's head glinting when it is ready again.
  berserker_overhead_smash: {
    palette: PALETTE,
    cast: {
      timing: { secs: 1.5, release: 0.42 },
      close: { from: 0.06, to: 0.42, back: 0.82 },
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
        r.at = e3(t, [[0, [0, 0, 0]], [0.32, [0, -1, 0]], [0.42, [0, 3, 0]], [0.72, [0, 3, 0]], [0.9, [0, 1, 0]], [1, [0, 0, 0]]]);
        r.mouth = one(t, [[0, 0], [0.3, 0.3], [0.42, 1], [0.5, 0.6], [0.55, 0.35], [0.62, 0.6], [0.69, 0.35], [0.76, 0.6], [0.86, 0.9], [1, 0]]);
        const stepped = stride(r, t, c, { hit: 0.42, from: lateStride(0.06, 0.42), back: 0.82, bend: 26 });
        // Back arched and the head of it hanging down behind; over the top and down into the ground ahead, where it sticks;
        // then heaved out, the head coming up first.
        swing(r, t, c, [[0, 35, 20, 0.6, 115, 0], [0.1, 60, 5, 0.7, 60, 0], [0.32, 205, 5, 0.85, 95, 0], [0.36, 208, 5, 0.85, 100, 0], [0.42, 55, 0, 1, 5, 0], [0.48, 54, 0, 1, 6, 0], [0.72, 52, 0, 1, 8, 0], [0.84, 75, 5, 0.75, 70, 0], [1, 35, 20, 0.6, 115, 0]], { stepped });
      },
    },
    fx: {
      charge: (k, t) => {
        k.glow(axeHead(k), 6, 0.6 * seg(t, 0.1, 0.34) * (1 - seg(t, 0.38, 0.43)));
        if (t > 0.35 && t < 0.5) rent(k, { secs: 0.09 });
      },
      hit: (k) => {
        const bite = biteOf(k);
        rubble(k, bite, 22, 1.2);
        k.burst(bite, 30, { kind: 'spark', colour: [k.pal.core, k.pal.accent], size: 2.2, life: [0.25, 0.55], speed: [1, 2.6], up: [8, 34], gravity: 70, over: true });
        blood(k, k.heart(k.target), 10);
      },
      impact: { secs: 0.9, draw: (k, u) => {
        const b = k.target;
        const bite = biteOf(k);
        // From where the head went into the ground, out under the creature and past it.
        const ahead = k.toward(bite, b);
        const run = clamp(Math.hypot(b.x - bite.x, b.y - bite.y) + 0.45, 0.8, 2.2);
        starburst(k, { x: bite.x, y: bite.y, z: bite.z + 2 }, 15 * (1.15 - 0.45 * u), { points: 8, alpha: flashOf(u, 0.05) });
        cracks(k, bite, run, { n: 7, grow: easeOut(u * 2.5), heat: 1 - 0.4 * u, dir: ahead, spread: 2.4, salt: 1, width: 2.6 });
        // The shock going out over the ground as this trade's ring of teeth, as many as it is long, dropping them as it
        // goes rather than fading.
        if (u < 0.85) {
          const rr = 0.15 + 0.75 * easeOut(u);
          sawRing(k, bite, rr, { teeth: Math.max(6, Math.round((TAU * rr) / 0.3)), left: 1 - smooth(seg(u, 0.4, 0.85)), tooth: 0.12 * (1 - 0.5 * u), wide: 0.11, turn: u * 0.6, glow: 0.5 });
        }
        k.light(bite, 1.8, 0.9 * (1 - u));
      } },
      linger: {
        on: 'spot',
        secs: SMASH_WIND,
        draw: (k, age, left) => {
          const b = k.target;
          const bite = biteOf(k);
          // Cracks smouldering for as long as the caster's next swing waits, then the axe's head glinting: ready.
          const heat = 0.6 * (left / SMASH_WIND);
          const run = clamp(Math.hypot(b.x - bite.x, b.y - bite.y) + 0.45, 0.8, 2.2);
          // The ground broken open where it went in (the linger starts with the blow), drawn in at the end; the cracks draw
          // back into it rather than fading.
          crater(k, bite, 0.24, easeOut(seg(age, 0, 0.1)) * smooth(left / 0.45));
          cracks(k, bite, run, { n: 7, grow: smooth(left / 0.4), heat, dir: k.toward(bite, b), spread: 2.4, salt: 1, width: 2.6 });
          if (!k.fast) k.emit(bite, 8 * heat, { kind: 'smoke', colour: '#4a3a33', size: 2.4, sizeEnd: 6, life: [0.7, 1.2], speed: [0.02, 0.08], up: [6, 12], gravity: -3, jitter: 0.3 });
          if (left < 0.3) k.flare(axeHead(k), 7, Math.sin((Math.PI * (0.3 - left)) / 0.3), k.pal.core, age * 3);
          // The smoulder lights the ground round it, which is what shows of it at night.
          k.light(bite, 1.2, heat * (0.3 + 0.5 * k.night));
        },
      },
    },
  },

  // Whirlwind (nova, on self, 2 tiles round): Two blows at 90% on every enemy within 2 tiles of you.
  //
  // Crouched and wound round to the right, then two full turns with the axe out at arm's length, leaning into the
  // turn, the blade's path a torn ring round the body. Each turn's blow goes out over the ground as a ring of teeth
  // to the 2 tiles it reaches, the second following the first, and every enemy inside is struck as it passes.
  berserker_whirlwind: {
    palette: PALETTE,
    cast: {
      timing: { secs: WHIRL_SECS, release: WHIRL_FIRST, blendOut: 0.22 },
      pose: (r, t) => {
        // The turns, read back into a half turn either way so the blend at each end never unwinds them.
        const spin = whirlTurned(t) * 360 - one(t, [[0, 0], [WHIRL_GO, 50], [0.3, 0]]);
        r.pelvis = [0, 0, ((((spin + 180) % 360) + 360) % 360) - 180];
        // The weapon arm out level, the axe straight out past the fist along the arm; the other arm out for balance, fist shut.
        r.arm[1] = e3(t, [[0, [24, 14, 0]], [WHIRL_GO, [40, 50, -30]], [0.24, [88, 0, -88]], [WHIRL_END - 0.04, [88, 0, -88]], [0.84, [50, 10, -20]], [1, [24, 14, 0]]]);
        r.elbow[1] = one(t, [[0, 60], [WHIRL_GO, 70], [0.24, 6], [WHIRL_END - 0.04, 6], [0.84, 40], [1, 60]]);
        r.haft = one(t, [[0, 0], [WHIRL_GO, 30], [0.24, 82], [WHIRL_END - 0.04, 82], [0.9, 20]]);
        r.arm[0] = e3(t, [[0, [16, 10, 0]], [WHIRL_GO, [60, 0, 30]], [0.24, [70, 0, -70]], [WHIRL_END - 0.04, [70, 0, -70]], [0.84, [30, 20, 0]], [1, [10, 10, 0]]]);
        r.elbow[0] = one(t, [[0, 24], [WHIRL_GO, 90], [0.24, 50], [WHIRL_END - 0.04, 50], [1, 24]]);
        r.shape = [{ claw: one(t, [[0.18, 0], [0.26, 0.6], [0.72, 0.6], [0.8, 0]]) }, undefined];
        r.spine = e3(t, [[0, [0, 0, 0]], [WHIRL_GO, [-10, 0, -20]], [0.24, [-6, 12, 0]], [WHIRL_END - 0.04, [-6, 12, 0]], [0.84, [-8, 0, 0]], [1, [0, 0, 0]]]);
        r.chest = e3(t, [[0, [0, 0, 0]], [WHIRL_GO, [-6, 0, -26]], [0.24, [0, 6, 6]], [WHIRL_END - 0.04, [0, 6, 6]], [1, [0, 0, 0]]]);
        r.head = e3(t, [[0, [0, 0, 0]], [WHIRL_GO, [-8, 0, 20]], [0.24, [-4, -8, 14]], [WHIRL_END - 0.04, [-4, -8, 14]], [1, [0, 0, 0]]]);
        r.mouth = one(t, [[0, 0], [WHIRL_GO, 0.2], [0.3, 0.6], [WHIRL_END, 0.5], [0.9, 0]]);
        for (let s = 0; s < 2; s++) {
          r.leg[s] = e3(t, [[0, [2, 2, 0]], [WHIRL_GO, [16, 12, 0]], [0.24, [10, 12, 0]], [WHIRL_END - 0.04, [10, 12, 0]], [0.84, [14, 10, 0]], [1, [2, 2, 0]]]);
          r.knee[s] = one(t, [[0, 4], [WHIRL_GO, 34], [0.24, 22], [WHIRL_END - 0.04, 22], [0.84, 30], [1, 4]]);
        }
        r.wield = 1;
      },
    },
    fx: {
      charge: (k, t) => {
        const b = k.caster;
        const R = k.fx.reach ?? 2;
        const go = seg(t, WHIRL_GO, WHIRL_END);
        // Where the blade is round the body, in the same turns the pose makes (the other way round when swung left-handed).
        if (go > 0 && go < 1) {
          const ang = -Math.PI / 2 + TAU * whirlTurned(t);
          swirl(k, b, ang, 2.6 * Math.min(1, go * 5, (1 - go) * 5), 15);
          // The reach it strikes to, as eight small teeth standing at it, coming up as the spin starts and sinking as it ends.
          const at = Math.min(1, go * 6, (1 - go) * 6);
          if (at > 0.05) sawRing(k, b, R, { teeth: 8, bare: true, tooth: 0.11 * at, wide: 0.1, turn: -ang * 0.15 * k.side, glow: (0.2 + 0.4 * k.night) * at });
          if (!k.fast) {
            // Dust thrown off the way the blade is going.
            const p0 = k.local(b, -Math.sin(ang) * k.side, Math.cos(ang), 0), p1 = k.local(b, -Math.sin(ang + 0.2) * k.side, Math.cos(ang + 0.2), 0);
            const hx = p1.x - p0.x, hy = p1.y - p0.y, hl = Math.hypot(hx, hy) || 1;
            k.emit(k.at(b, 0.03), 36, { kind: 'dust', colour: DUST, size: 3, life: [0.4, 0.7], speed: [0.8, 1.3], up: [2, 6], heading: { x: hx / hl, y: hy / hl }, cone: 0.8, gravity: 2, drag: 0.2, jitter: 0.4 });
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
          // As many teeth as the ring is long, so it is a saw at every size; it goes by dropping them, not by fading.
          sawRing(k, b, rr, { teeth: Math.max(6, Math.round((TAU * rr) / 0.3)), left: 1 - smooth(seg(v, 0.6, 1)), tooth: 0.1 * (1 - 0.5 * v), wide: 0.1, turn: (i * 0.17 + v * 0.8) * k.side });
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
        k.light(b, 2, 0.7 * (1 - u));
      } },
    },
  },

  // Earthshaker (nova, on self, 3 tiles round, lasts 1 s): With a maul in hand: a blow at 100% on every enemy within 3 tiles of you, and each one held where it stands for 1 s.
  //
  // Down into a crouch, up off the ground with the maul overhead, and down with it into the earth between the feet.
  // The ground cracks out all round to the 3 tiles it reaches, a lip of stone standing up behind the wave as it runs
  // out; every enemy it reaches is struck as it passes, and stone closes round its feet; the edge holds, shaking,
  // for the second everything in it is held.
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
        k.glow(axeHead(k), 6, 0.7 * seg(t, 0.25, 0.42) * (1 - seg(t, 0.46, 0.51)));
        if (t > 0.4 && t < 0.58) rent(k, { secs: 0.09 });
      },
      hit: (k) => {
        const b = k.caster;
        k.flash(0.12);
        rubble(k, k.at(b, 0.05), 30, 1.8);
        k.burst(k.at(b, 0.1), 40, { kind: 'spark', colour: [k.pal.core, k.pal.accent], size: 2, life: [0.3, 0.6], speed: [1.5, 3.2], up: [4, 22], gravity: 40, drag: 0.1, over: true });
      },
      impact: { secs: 1.0, draw: (k, u) => {
        const b = k.caster;
        const R = QUAKE_R;
        const wave = easeOut(seg(u, 0, 0.35));
        const rr = 0.2 + (R - 0.2) * wave;
        // The cracks run out with the wave and smoulder for the hold, then draw back into the ground.
        cracks(k, b, R, { n: 10, grow: easeOut(seg(u, 0, 0.3)) * (1 - smooth(seg(u, 0.75, 1))), heat: 1 - 0.5 * u, salt: 5, width: 3.2 });
        // The wave's front: a thin band that thins away as the held edge of teeth comes up in its place (the linger).
        // No wider than a fifth of its own radius as it leaves the feet, or it starts as a fat donut.
        if (u < 0.55) k.ring(b, rr, { band: 0.06 * Math.min(1, rr) * (1 - smooth(seg(u, 0.32, 0.55))) + 0.005, alpha: 1, glow: 0.8 });
        // A lip of stone standing up just behind the wave as it runs out, and settling into the ground.
        const stand = Math.sin(Math.PI * seg(u, 0.03, 0.65));
        if (stand > 0.02) lip(k, b, Math.max(0.3, rr - 0.12), 4.5 * stand);
        if (u < 0.55 && !k.fast) {
          const an = k.rand() * TAU;
          k.burst(k.on(b.x + Math.cos(an) * rr, b.y + Math.sin(an) * rr, 1), 2, { kind: 'dust', colour: DUST, size: 3.6, life: [0.5, 0.9], speed: [0.1, 0.3], up: [2, 8], gravity: 2 });
        }
        // Every enemy it reaches struck as the wave goes under it: a star on it and the ground thrown up round its feet.
        for (const e of struckBy(k, R)) {
          const d = Math.hypot(e.x - b.x, e.y - b.y);
          const w = seg(rr, d - 0.1, d + 0.8);
          if (w <= 0) continue;
          const key = `q_${e.who && 'id' in e.who ? e.who.id : Math.round(e.x * 97 + e.y * 13)}`;
          if (!k.state[key]) {
            k.state[key] = 1;
            rubble(k, k.at(e, 0.05), 10, 0.8);
          }
          if (w < 1) starburst(k, k.heart(e), 9 * (1.1 - 0.4 * w), { points: 7, alpha: flashOf(w, 0.1) });
        }
        k.light(b, 2.2, 0.9 * (1 - u));
      } },
      linger: {
        draw: (k, age, left) => {
          const b = k.caster;
          const R = QUAKE_R;
          // Up once the wave is out (a third of a second in), and gone with the hold.
          const a = smooth(seg(age, 0.3, 0.42)) * smooth(left / 0.3);
          // The edge holding, shaking: everything inside it is held until it lets go. Its teeth come up and sink back into
          // the ground all round at once -- letting go everywhere, not a sweep that leaves a C.
          const shakeR = R + Math.sin(age * 70) * 0.03;
          if (a > 0.03) sawRing(k, b, shakeR - 0.14, { teeth: Math.round((TAU * R) / 0.3), tooth: 0.16 * a, wide: 0.13, turn: Math.sin(age * 50) * 0.02, glow: (0.5 + 0.5 * k.night) * a });
          // Each enemy inside it held fast: stone closed round its feet, shaking with the edge, for as long as the island
          // says it holds that one; one the blow killed is not held at all.
          for (const e of struckBy(k, R)) {
            const hold = k.secsOn(e, age + left);
            if (!k.heldOn(e, true) || age >= hold) continue;
            const ae = a * smooth((hold - age) / 0.3);
            lip(k, { x: e.x + Math.sin(age * 60) * 0.01, y: e.y }, Math.max(0.12, (e.wide / 40) * 1.5), 4 * ae, true);
          }
        },
      },
    },
  },

  // Last Rage (buff, on self, lasts 10 s): Costs no stamina. Only below 25% of your health: for 10 s every blow you land is critical.
  //
  // Beaten down onto one knee, shaking, the ground cracking under it; then up with arms flung wide and the head
  // thrown back in a scream, a column of fire going up off the body. For the 10 s it lasts the fire burns dark
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
          // Flung up and wide, away from the body: a V, never crossed over the head, the roar shaking it.
          r.arm[s] = e3(t, [[0, [12, 12, 0]], [0.2, [s ? 30 : 46, 6, 10]], [0.46, [s ? 30 : 46, 6, 10]], [0.55, LAST_V], [0.84, [LAST_V[0] - 2 + roar, LAST_V[1] + 3, LAST_V[2]]], [1, [12, 12, 0]]]);
          r.elbow[s] = one(t, [[0, 24], [0.2, s ? 60 : 30], [0.46, s ? 60 : 30], [0.55, 8], [0.84, 10], [1, 24]]);
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
        k.burst(k.at(b, 0.5), 56, { kind: 'ember', colour: [DARK_FIRE.core, k.pal.main, k.pal.accent], size: 2, life: [0.5, 1], speed: [1.2, 2.6], up: [10, 40], gravity: 10, drag: 0.3, jitter: 0.12, over: true });
        rubble(k, k.at(b, 0.04), 16, 1.4);
      },
      impact: { secs: 1.1, draw: (k, u) => {
        const b = k.caster;
        // The ground knocked out round the feet as it rises: the trade's ring in its own reds (the near-black of the dark
        // fire made a spiked wall of it), and no further out than the body's own reach.
        const rr = 0.3 + 0.5 * easeOut(u);
        sawRing(k, b, rr, { teeth: Math.max(8, Math.round((TAU * rr) / 0.25)), left: 1 - smooth(seg(u, 0.35, 1)), tooth: 0.12 * (1 - 0.4 * u), wide: 0.1, turn: -u * 0.5 });
        // The cracks it was beaten into cool and draw back into the ground as the fire takes over.
        cracks(k, b, 0.75, { n: 6, grow: 1 - smooth(seg(u, 0.6, 1)), heat: 0.8 * (1 - u), salt: 7, width: 2.2 });
        eyes(k, 1);
        k.light(b, 2.4, 1 - 0.6 * u, '#ff7a3a');
      } },
      linger: {
        draw: (k, age, left) => {
          const b = k.caster;
          const all = age + left;
          const a = smooth(age / 0.4) * smooth(left / 0.8);
          // The column of fire at the scream is this same fire gone up three times as high, settling over a second to what
          // burns for the rest: flame, inked in its own dark, not a pillar of light that fades through brown over the grass.
          // Going up it is a Battle Rage's bright fire and licks fast; it darkens into the Last Rage's own as it settles
          // (a blend of the colours, not a switch).
          const up = 1 - smooth(seg(age, 0.15, 1.2));
          warFire(k, b, {
            n: 9, h: 8.5 + 20 * up, alpha: a, salt: 3, quick: 1 + 0.9 * up,
            main: mixHex(DARK_FIRE.main, RAGE_FIRE.main, up), deep: mixHex(DARK_FIRE.deep, RAGE_FIRE.deep, up), core: mixHex(DARK_FIRE.core, RAGE_FIRE.core, up),
          });
          // A spike of the crown for every second of it, one going out each second.
          const secs = Math.round(k.fx.secs ?? all);
          crown(k, k.at(b, 1.22), secs, left / all, age, a);
          eyes(k, a);
          k.glow(axeHead(k), 4, 0.8 * a, k.pal.core);
          if (!k.fast) k.emit(k.at(b, 0.6), 10 * a, { kind: 'ember', colour: [DARK_FIRE.core, k.pal.main], size: 1.8, life: [0.4, 0.8], speed: [0.05, 0.2], up: [14, 26], gravity: 0, jitter: 0.15, over: true });
          k.light(b, 1.8, (0.45 + 0.1 * Math.sin(age * 13)) * a, '#ff7a3a');
        },
      },
    },
  },
};

/* ---- helpers the spells above share, past the record so it reads first ---------------------------------------------- */

/** Where Shrug It Off's wound is: on the belly, on the side of the free hand that clamped it (the left, or the right swung left-handed). */
function wound(k: FxScene): P3 {
  // On the front of the trunk, low on the ribs, so it moves with the hunch and the chest thrown out.
  return k.joint(k.caster, 'chest', [-0.25 * k.side, 1.45, -1.3], 0.55);
}

/** Where a creature's neck is, for a stroke that takes the head: most of the way from its middle to its head; a person's own neck. */
function neckOf(k: FxScene, b: Body): P3 {
  if (b.figure) return k.joint(b, 'neck', [0, 0, 0.6], 0.8);
  const m = k.muzzle(b), h = k.heart(b);
  return { x: lerp(h.x, m.x, 0.6), y: lerp(h.y, m.y, 0.6), z: lerp(h.z, m.z, 0.6) };
}

/** Where an Overhead Smash's head went into the ground: under the weapon's head at the blow, kept there for the rest of the cast. */
const biteOf = (k: FxScene): P3 => k.once('bite', () => {
  const h = axeHead(k);
  return k.on(h.x, h.y, 0);
});

/**
 * Adrenaline's beat in the weapon: an after-image of it a little up and ahead of where it is, going on toward it and
 * eaten from the grip as `p` dies down -- the swing that comes sooner -- and quick streaks up off the weapon arm.
 */
function quickening(k: FxScene, b: Body, p: number): void {
  if (p <= 0.04) return;
  const grip = k.joint(b, 'grip'), tip = k.joint(b, 'tip');
  if (Math.hypot((tip.x - grip.x) * 40, (tip.y - grip.y) * 40, tip.z - grip.z) < 2) return;
  const f = k.facingDir(b);
  const mid = { x: lerp(grip.x, tip.x, 0.6), y: lerp(grip.y, tip.y, 0.6), z: lerp(grip.z, tip.z, 0.6) };
  // Two of them, half a step and a whole step ahead, the further one thinner: the weapon twice over, where it will be.
  for (const [s, w] of [[0.5, 4], [1, 2]] as const) {
    const off = (q: P3, u: number): P3 => ({ x: q.x + f.x * 0.08 * p * s * u, y: q.y + f.y * 0.08 * p * s * u, z: q.z + 3.6 * p * s * u });
    band(k, eatTail([off(grip, 0.5), off(mid, 0.8), off(tip, 1)], 1 - p), { width: w, taper: 'start', main: QUICK.main, core: QUICK.core, ink: QUICK.deep, glow: 0.6, bias: 3 });
  }
  if (!k.fast) k.emit(k.hand(k.lefty ? 0 : 1), 30 * p, { kind: 'spark', colour: [QUICK.core, QUICK.main], size: 2, life: [0.12, 0.22], speed: [0, 0.03], up: [50, 80], gravity: 0, drag: 1, jitter: 0.03, jitterZ: 2, over: true });
}

/**
 * Adrenaline's count on the ground round a point, `r` tiles out: `n` amber darts, each pointing along the ring the
 * way it turns, `left` of them still there (the last shrinking), the whole set ticking round half a dart's spacing on
 * every heartbeat (`spin`, radians). Separate darts racing round, not a band of teeth standing still: a Battle Rage's
 * count is that, and the two must not share a shape.
 */
function darts(k: FxScene, c: Ground, r: number, n: number, left: number, spin: number, o: { alpha?: number; glow?: number } = {}): void {
  const a = o.alpha ?? 1;
  const show = clamp(left) * n;
  if (a <= 0.01 || show <= 0.01) return;
  const cy = k.sy(k.on(c.x, c.y, 0));
  const near: number[][] = [], far: number[][] = [];
  const L = 0.13, W = 0.065;
  for (let i = 0; i < Math.ceil(show); i++) {
    const part = Math.min(1, show - i);
    const am = spin + (i / n) * TAU;
    // Along the ring (counter-clockwise from above) and out from it.
    const tx = -Math.sin(am), ty = Math.cos(am), rx = Math.cos(am), ry = Math.sin(am);
    const mx = c.x + rx * r, my = c.y + ry * r, h = (L / 2) * part, w = W * part;
    const at = (u: number, v: number, out: number[]): void => {
      out.push(mx + tx * u + rx * v, my + ty * u + ry * v);
    };
    const q: number[] = [];
    at(h, 0, q);
    at(-h, w, q);
    at(-h * 0.15, 0, q);
    at(-h, -w, q);
    (k.sy(k.on(mx, my, 0)) > cy ? near : far).push(q);
  }
  const layers: GroundLayer[] = [];
  if (far.length) layers.push({ kind: 'fill', colour: QUICK.deep, alpha: clamp(a), paths: far, lift: 0.15 });
  if (near.length) layers.push({ kind: 'fill', colour: QUICK.main, alpha: clamp(a), paths: near, lift: 0.15 });
  layers.push({ kind: 'stroke', colour: k.pal.ink, alpha: clamp(a), width: Math.max(0.8, 0.7 * k.zoom), paths: [...far, ...near], closed: true, join: 'miter', lift: 0.16 });
  k.groundShape(c.x, c.y, r + 0.3, layers);
  const gl = o.glow ?? 0.5;
  if (gl > 0) k.glow(k.on(c.x, c.y, 1), r * 40 * 1.1, a * gl * 0.3, QUICK.main);
}

/**
 * A lip of stone standing up out of the ground round a point, `r` tiles out, `h` height units tall: a continuous
 * row of short teeth, as many as the ring is long, each lit on its left and shaded on its right, recorded in four
 * arcs each sorted where it stands, so bodies inside the ring stand behind its near side and in front of its far.
 * `collar`: a small ring of it closed round somebody's feet, its near half only, as one shape in front of them.
 */
function lip(k: FxScene, c: Ground, r: number, h: number, collar = false): void {
  if (h <= 0.15 || r <= 0.05) return;
  const n = Math.min(k.fast ? 30 : 60, Math.max(collar ? 9 : 12, Math.round((TAU * r) / 0.2)));
  const arcs = collar ? 1 : 4, per = Math.ceil(n / arcs);
  const cy = k.sy(k.on(c.x, c.y));
  for (let s = 0; s < arcs; s++) {
    const teeth: number[][] = [];
    for (let i = s * per; i < Math.min(n, (s + 1) * per); i++) {
      if (collar && k.sy(k.on(c.x + Math.cos(((i + 0.5) / n) * TAU) * r, c.y + Math.sin(((i + 0.5) / n) * TAU) * r)) < cy - 0.5) continue;
      const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU, am = (a0 + a1) / 2 + ((hashOf(k.seed, i) - 0.5) * TAU) / n * 0.6;
      const tall = 0.55 + 0.6 * hashOf(k.seed + 5, i);
      const p0 = k.on(c.x + Math.cos(a0) * r, c.y + Math.sin(a0) * r), p1 = k.on(c.x + Math.cos(a1) * r, c.y + Math.sin(a1) * r);
      const pm = k.on(c.x + Math.cos(am) * (r + 0.03), c.y + Math.sin(am) * (r + 0.03));
      const bx = (k.sx(p0) + k.sx(p1)) / 2, by = (k.sy(p0) + k.sy(p1)) / 2;
      teeth.push([k.sx(p0), k.sy(p0), k.sx(pm), k.sy(pm) - k.hpx(h * tall), k.sx(p1), k.sy(p1), bx, by]);
    }
    if (!teeth.length) continue;
    const am = ((s + 0.5) / arcs) * TAU;
    const at = collar ? k.on(c.x, c.y) : k.on(c.x + Math.cos(am) * r, c.y + Math.sin(am) * r);
    k.worldDraw(at, (g) => {
      g.globalAlpha = 1;
      g.lineJoin = 'miter';
      g.lineWidth = Math.max(0.6, 0.45 * k.zoom);
      g.strokeStyle = EARTH;
      for (const q of teeth) {
        const lx = Math.min(q[0], q[4]) === q[0] ? 0 : 4;
        // The lit facet (the left of the tooth on the screen) and the shaded one.
        g.beginPath();
        g.moveTo(q[lx], q[lx + 1]);
        g.lineTo(q[2], q[3]);
        g.lineTo(q[6], q[7]);
        g.closePath();
        g.fillStyle = STONE[2];
        g.fill();
        g.beginPath();
        g.moveTo(q[4 - lx], q[5 - lx]);
        g.lineTo(q[2], q[3]);
        g.lineTo(q[6], q[7]);
        g.closePath();
        g.fillStyle = STONE[1];
        g.fill();
        g.beginPath();
        g.moveTo(q[0], q[1]);
        g.lineTo(q[2], q[3]);
        g.lineTo(q[4], q[5]);
        g.stroke();
      }
      g.lineJoin = 'round';
    }, 0.5);
  }
}

/**
 * Blood Price's palm: the drops flung off the cut hand, `age` seconds since, drawn here rather than as particles so
 * each is where it was flung from the body as the body is now. The stage carries the caster a tile and a half in for
 * the blow while they fall; particles would be left hanging over the grass where the caster stood.
 */
function palmSpray(k: FxScene, age: number): void {
  if (age < 0 || age > 0.75) return;
  const b = k.caster;
  const base = { x: b.x + (k.state.palmX ?? 0), y: b.y + (k.state.palmY ?? 0), z: b.z + (k.state.palmZ ?? 0) };
  const n = k.fast ? 10 : 20;
  // Drag halves the speed over the ground every second, as `blood`'s particles do: gone `(1 - 0.5^t) / ln 2` of it.
  const went = (1 - Math.pow(0.5, age)) / Math.LN2;
  const drops: number[] = [];
  for (let i = 0; i < n; i++) {
    const h = (j: number): number => hashOf(k.seed + i * 7, 41 + j);
    const life = 0.45 + 0.3 * h(0);
    if (age > life) continue;
    const an = h(1) * TAU, sp = 0.35 + 0.8 * h(2), up = 6 + 16 * h(3);
    const z = base.z + up * age - 35 * age * age;
    if (z < b.z + 0.3) continue;
    const p = { x: base.x + Math.cos(an) * sp * went, y: base.y + Math.sin(an) * sp * went, z };
    const s = (2.6 - 1.1 * (age / life)) * 0.5 * k.zoom;
    drops.push(k.sx(p), k.sy(p), s, up - 70 * age);
  }
  if (!drops.length) return;
  k.worldDraw(base, (g) => {
    g.globalAlpha = 1;
    g.lineWidth = Math.max(0.6, 0.4 * k.zoom);
    g.strokeStyle = DROP_DARK;
    for (let i = 0; i < drops.length; i += 4) {
      const x = drops[i], y = drops[i + 1], s = drops[i + 2];
      // A drop drawn long the way it is going, up or down: a tail behind it.
      const tail = clamp(Math.abs(drops[i + 3]) / 40, 0.2, 1) * s * 1.6 * Math.sign(drops[i + 3] || 1);
      g.beginPath();
      g.moveTo(x - s, y);
      g.lineTo(x, y + tail + (tail > 0 ? s : -s) * 0.4);
      g.lineTo(x + s, y);
      g.arc(x, y, s, 0, Math.PI, tail > 0);
      g.closePath();
      g.fillStyle = i % 12 === 8 ? DROP_DARK : DROP;
      g.fill();
      g.stroke();
    }
  }, 6);
}

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
    // Turning to the body's left (counter-clockwise from above), as the pelvis yaws -- to its right when swung left-handed.
    const a = ang - len + (len * i) / n;
    const p = k.local(b, -Math.sin(a) * reach * k.side, Math.cos(a) * reach, up + Math.sin(a * 2) * 0.8);
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

/**
 * A cry going out ahead of the face: an upright torn ring, `v` nought to one of the way out. Its face is turned half
 * way from the way the body faces round toward the viewer, so a cry to the side of the screen is still an open ring
 * and not a plank seen edge on; facing the viewer or away, it is square to the way the body faces as before.
 */
function shout(k: FxScene, b: Body, v: number, alpha: number): void {
  const up = b.tall * 0.88;
  const d = 3 + 30 * easeOut(v), r = 2.2 + 7.5 * easeOut(v);
  const m = k.fast ? 10 : 16;
  const mid = k.local(b, 0, d, up);
  // Toward the viewer over the ground: the way a step most brings a point down the screen.
  const y0 = k.eye.worldToScreenY(mid.x, mid.y, 0);
  let vx = k.eye.worldToScreenY(mid.x + 0.01, mid.y, 0) - y0, vy = k.eye.worldToScreenY(mid.x, mid.y + 0.01, 0) - y0;
  const vl = Math.hypot(vx, vy) || 1;
  vx /= vl;
  vy /= vl;
  const f = k.facingDir(b), s = f.x * vx + f.y * vy >= 0 ? 1 : -1;
  let nx = f.x + vx * s, ny = f.y + vy * s;
  const nl = Math.hypot(nx, ny) || 1;
  nx /= nl;
  ny /= nl;
  // The ring's level axis, across its face, in tiles a height unit.
  const ax = -ny / 40, ay = nx / 40;
  const pts: P3[] = [];
  for (let i = 0; i <= m; i++) {
    const th = (i / m) * TAU + v;
    pts.push({ x: mid.x + ax * Math.cos(th) * r, y: mid.y + ay * Math.cos(th) * r, z: mid.z + Math.sin(th) * r * 0.85 });
  }
  band(k, pts, { width: 3.4 * (1 - v) + 1.2, alpha, taper: 'none', teeth: true, pivot: mid, sortAt: { x: mid.x, y: mid.y, z: b.z }, bias: 2, glow: 0.5 });
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
 * Every cast here is made with what is in the hands, and a battle axe or a maul carried on the left shoulder (seen
 * from facings 3, 6 and 7) is swung from the left: the framework mirrors these right-handed poses onto the left side
 * (`cast.mirror`) and blends them in and out itself, so the weapon stays in the fist it was carried in from the first
 * frame to the last.
 */
for (const v of Object.values(BERSERKER)) v.cast.mirror = true;
