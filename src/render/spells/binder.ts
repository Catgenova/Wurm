/**
 * The Binder's spells: how each is cast and what it looks like.
 *
 * A Binder stops things. Everything here is drawn in one language so that a
 * Binder across a field is a Binder before the spell lands: cut sapphire and
 * diamond -- faceted crystal, never a soft blob -- in ice blue going to violet,
 * with an ink edge; fetters that close (a hoop, a cord, a cage, a chain of
 * lozenge links); crystal that grows out of the ground; and a ring of small
 * lozenges laid at the feet of whatever is bound that go dark one by one as
 * the binding runs out, so how long is left can be read at a glance.
 *
 * The casts share a way of moving as well: deliberate, and stopping dead. A
 * Binder's hands go out, close, and hold still for a beat before letting go,
 * as the thing bound does.
 *
 * Every size and time that the rules decide is read from them -- a hold's
 * hoops from its share of a Snare, a tether's ring from its leash, an area's
 * reach from its radius, how fast the mire moves from the pace it leaves --
 * so the picture changes when the spell does.
 */
import { HEIGHT_SCALE, UNITS_PER_TILE } from '../iso';
import type { CastPose, SpellVisual } from './index';
import { spellInfo } from './info';
import {
  arcAt, bump, clamp, easeBack, easeIn, easeOut, flashOf, hashOf, lerp, mid3, seg, smooth, TAU,
  type Body, type FxScene, type GroundLayer, type P3, type SpellPalette,
} from './kit';
import { euler, one } from './poses';

/** Stillness: ice blue going to violet. Sapphire and diamond. */
export const PALETTE: SpellPalette = {
  core: '#eef8ff',
  main: '#7fb7ff',
  deep: '#3b5cc4',
  accent: '#c6a8ff',
  ink: '#141f4a',
  light: '#8fc4ff',
};
const P = PALETTE;
/** The weight of a Heavy Limbs and the slick of a Mire: the palette pushed darker, as lead is to glass. */
const LEAD = { main: '#4f6fc8', deep: '#26357a', core: '#9cc2ff' };
/** Blood, for Stillness: the one colour here that is not the school's, because what it stops is a wound. */
const BLOOD = { main: '#c23a44', deep: '#7a1a24', core: '#ff8a8a', ink: '#3a0c12' };

/* ---- small sums ------------------------------------------------------------------------- */

/** In over `up` seconds after it lands and out over the last `down` of it. */
const life = (age: number, left: number, up = 0.2, down = 0.5): number => smooth(age / up) * smooth(left / down);
/**
 * How far out from a body's middle a fetter goes round it, in tiles: just clear of it. Read off its height, which the island
 * sets from how big the thing is drawn, rather than its width, which is the same for every creature.
 */
const girth = (b: Body): number => Math.max(0.075, b.tall * 0.0068 + 0.008);
/** How deep a fetter's band is, in height units: a tenth of what it holds. */
const band = (b: Body): number => Math.max(0.9, b.tall * 0.1);
/** The info's own numbers, read once. */
const RADIUS = (id: string): number => spellInfo(id)?.radius ?? 0;
const STEP = (from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number } => {
  const dx = to.x - from.x, dy = to.y - from.y, l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
};

interface Tones {
  main?: string;
  deep?: string;
  core?: string;
  ink?: string;
}
const tones = (k: FxScene, o: Tones): Required<Tones> => ({
  main: o.main ?? k.pal.main, deep: o.deep ?? k.pal.deep, core: o.core ?? k.pal.core, ink: o.ink ?? k.pal.ink,
});

/* ---- the shapes the school is drawn in ---------------------------------------------------- */

/**
 * A cut crystal between two points: a four-sided bipyramid, fattest `waist` of
 * the way from `a` to `b` (nought for a spike standing on its base), `w`
 * pixels at zoom one either side of its axis, turned `turn` about it. Only
 * the facets toward the viewer are drawn, each in one of three tones by how it
 * faces the light, every edge inked: a gem, a lance, a stake, a root, a weight.
 * Returns the drawing rather than recording it, so several can be laid in one
 * record (a cluster sorted as one) -- `crystal` records one on its own.
 */
function crystalPaint(k: FxScene, a: P3, b: P3, w: number, o: Tones & { alpha?: number; turn?: number; waist?: number } = {}): ((g: CanvasRenderingContext2D) => void) | null {
  const al = o.alpha ?? 1;
  if (al <= 0.01 || w <= 0.05) return null;
  const c = tones(k, o);
  const ax = k.sx(a), ay = k.sy(a), bx = k.sx(b), by = k.sy(b);
  let dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const W = w * k.zoom;
  const waist = o.waist ?? 0.5;
  const mx = lerp(ax, bx, waist), my = lerp(ay, by, waist);
  const turn = o.turn ?? 0;
  // The four corners round the waist: across the axis by their cosine, and a little down the screen by their sine, which is
  // what makes the near ones read as nearer from the island's height.
  const ex = [0, 0, 0, 0], ey = [0, 0, 0, 0], ed = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const an = turn + (i * Math.PI) / 2;
    const cs = Math.cos(an), sn = Math.sin(an);
    ex[i] = mx - dy * W * cs;
    ey[i] = my + dx * W * cs + W * 0.32 * sn;
    ed[i] = sn;
  }
  // Thin crystals keep a thin edge: an ink line as wide as the stone would make a stroke of it.
  const inkW = Math.max(0.5, Math.min(0.6 * k.zoom, W * 0.18));
  const tris: number[] = [];
  const fills: string[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    if (ed[i] + ed[j] < -0.01) continue;
    for (const end of waist > 0.02 ? [0, 1] : [1]) {
      const px = end ? bx : ax, py = end ? by : ay;
      const cx = (px + ex[i] + ex[j]) / 3, cy = (py + ey[i] + ey[j]) / 3;
      // Lit from up and to the left of the viewer.
      const lit = (-(cx - mx) * 0.75 - (cy - my) * 0.65) / Math.max(1, W);
      fills.push(lit > 0.35 ? c.core : lit > -0.25 ? c.main : c.deep);
      tris.push(px, py, ex[i], ey[i], ex[j], ey[j]);
    }
  }
  return (g) => {
    g.globalAlpha = clamp(al);
    g.lineJoin = 'round';
    for (let f = 0; f < fills.length; f++) {
      const q = f * 6;
      g.fillStyle = fills[f];
      g.beginPath();
      g.moveTo(tris[q], tris[q + 1]);
      g.lineTo(tris[q + 2], tris[q + 3]);
      g.lineTo(tris[q + 4], tris[q + 5]);
      g.closePath();
      g.fill();
    }
    g.lineWidth = inkW;
    g.strokeStyle = c.ink;
    g.beginPath();
    for (let f = 0; f < fills.length; f++) {
      const q = f * 6;
      g.moveTo(tris[q], tris[q + 1]);
      g.lineTo(tris[q + 2], tris[q + 3]);
      g.lineTo(tris[q + 4], tris[q + 5]);
      g.closePath();
    }
    g.stroke();
  };
}
function crystal(k: FxScene, a: P3, b: P3, w: number, o: Tones & { alpha?: number; turn?: number; waist?: number; bias?: number; glow?: number; at?: P3 } = {}): void {
  const paint = crystalPaint(k, a, b, w, o);
  if (!paint) return;
  k.worldDraw(o.at ?? a, paint, o.bias ?? 0);
  const gl = o.glow ?? 1;
  if (gl > 0) k.glow(mid3(a, b, o.waist ?? 0.5), w * 2.6, (o.alpha ?? 1) * gl * 0.45);
}

/** A crystal standing up out of the ground at `base`, `h` height units tall and leaning `lean` tiles: a root, a stake. */
function spike(k: FxScene, base: { x: number; y: number }, h: number, w: number, lean: { x: number; y: number }, o: Tones & { alpha?: number; turn?: number } = {}): ((g: CanvasRenderingContext2D) => void) | null {
  if (h <= 0.3) return null;
  const foot = k.on(base.x, base.y, -0.6);
  const tip = k.on(base.x + lean.x, base.y + lean.y, h);
  return crystalPaint(k, foot, tip, w, { ...o, waist: 0.12 });
}

/**
 * A fetter round something: a faceted band lying level `z` height units up, `r`
 * tiles out from `c`, `h` units deep. The far half is drawn behind whatever
 * stands at `c` (its inside showing, in the shaded tone) and the near half in
 * front of it, lit down its left, so it reads as closed round the body rather
 * than pasted on.
 */
function hoop(k: FxScene, c: { x: number; y: number }, z: number, r: number, o: Tones & { alpha?: number; h?: number; turn?: number; n?: number; glow?: number; behind?: number } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || r <= 0.01) return;
  const n = o.n ?? (k.fast ? 8 : 10);
  const h = o.h ?? 2.2;
  const turn = o.turn ?? 0;
  const top: number[] = [], bot: number[] = [];
  for (let i = 0; i < n; i++) {
    const an = turn + (i / n) * TAU;
    const x = c.x + Math.cos(an) * r, y = c.y + Math.sin(an) * r;
    top.push(k.sx({ x, y, z: z + h / 2 }), k.sy({ x, y, z: z + h / 2 }));
    bot.push(k.sx({ x, y, z: z - h / 2 }), k.sy({ x, y, z: z - h / 2 }));
  }
  const mid = { x: c.x, y: c.y, z: z + h / 2 };
  const cx = k.sx(mid), cy = k.sy(mid);
  let rx = 1;
  for (let i = 0; i < n; i++) rx = Math.max(rx, Math.abs(top[2 * i] - cx));
  const front: number[] = [], back: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    ((top[2 * i + 1] + top[2 * j + 1]) / 2 > cy ? front : back).push(i);
  }
  const t = tones(k, o);
  const inkW = Math.max(0.8, 0.7 * k.zoom);
  const paint = (list: number[], outside: boolean) => (g: CanvasRenderingContext2D): void => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'round';
    for (const i of list) {
      const j = (i + 1) % n;
      const nx = ((top[2 * i] + top[2 * j]) / 2 - cx) / rx;
      g.fillStyle = outside ? (nx < -0.4 ? t.core : nx < 0.45 ? t.main : t.deep) : nx > 0.3 ? t.main : t.deep;
      g.beginPath();
      g.moveTo(top[2 * i], top[2 * i + 1]);
      g.lineTo(top[2 * j], top[2 * j + 1]);
      g.lineTo(bot[2 * j], bot[2 * j + 1]);
      g.lineTo(bot[2 * i], bot[2 * i + 1]);
      g.closePath();
      g.fill();
    }
    g.lineWidth = inkW;
    g.strokeStyle = t.ink;
    g.beginPath();
    for (const i of list) {
      const j = (i + 1) % n;
      g.moveTo(top[2 * i], top[2 * i + 1]);
      g.lineTo(top[2 * j], top[2 * j + 1]);
      g.moveTo(bot[2 * i], bot[2 * i + 1]);
      g.lineTo(bot[2 * j], bot[2 * j + 1]);
    }
    g.stroke();
  };
  const foot = { x: c.x, y: c.y, z: 0 };
  const behind = o.behind ?? 3;
  k.worldDraw(foot, paint(back, false), -behind);
  k.worldDraw(foot, paint(front, true), behind);
  const gl = o.glow ?? 1;
  if (gl > 0) k.glow(mid, (rx / k.zoom) * 1.3, a * gl * 0.3);
}

/**
 * A chain through points in the world, link by link: a lozenge seen flat, then
 * one seen edge on, in turn, `link` pixels at zoom one long. Three strokes
 * however many links, so a long one costs what a short one does.
 */
function chain(k: FxScene, pts: readonly P3[], o: Tones & { alpha?: number; link?: number; at?: P3; bias?: number; glow?: number } = {}): void {
  const a = o.alpha ?? 1;
  const n = pts.length;
  if (a <= 0.01 || n < 2) return;
  const xs: number[] = [], ys: number[] = [], run: number[] = [0];
  for (let i = 0; i < n; i++) {
    xs.push(k.sx(pts[i]));
    ys.push(k.sy(pts[i]));
    if (i) run.push(run[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  }
  const total = run[n - 1];
  const L = (o.link ?? 3.4) * k.zoom;
  if (total < L * 0.5) return;
  const links: number[] = [];
  let seg0 = 0;
  for (let s = L * 0.5; s < total; s += L) {
    while (seg0 < n - 2 && run[seg0 + 1] < s) seg0++;
    const span = run[seg0 + 1] - run[seg0] || 1;
    const u = (s - run[seg0]) / span;
    const dx = (xs[seg0 + 1] - xs[seg0]) / span, dy = (ys[seg0 + 1] - ys[seg0]) / span;
    links.push(lerp(xs[seg0], xs[seg0 + 1], u), lerp(ys[seg0], ys[seg0 + 1], u), dx, dy);
  }
  const t = tones(k, o);
  const near = pts[ys.indexOf(Math.max(...ys))] ?? pts[n - 1];
  const path = (g: CanvasRenderingContext2D): void => {
    g.beginPath();
    for (let i = 0; i < links.length; i += 4) {
      const x = links[i], y = links[i + 1], ux = links[i + 2], uy = links[i + 3];
      const along = L * 0.62;
      if ((i / 4) % 2 === 0) {
        const across = L * 0.3;
        g.moveTo(x - ux * along, y - uy * along);
        g.lineTo(x - uy * across, y + ux * across);
        g.lineTo(x + ux * along, y + uy * along);
        g.lineTo(x + uy * across, y - ux * across);
        g.closePath();
      } else {
        g.moveTo(x - ux * along, y - uy * along);
        g.lineTo(x + ux * along, y + uy * along);
      }
    }
  };
  k.worldDraw(o.at ?? near, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    path(g);
    g.lineWidth = Math.max(1.6, 1.25 * k.zoom);
    g.strokeStyle = t.ink;
    g.stroke();
    g.lineWidth = Math.max(0.8, 0.6 * k.zoom);
    g.strokeStyle = t.main;
    g.stroke();
  }, o.bias ?? 0);
  const gl = o.glow ?? 0.6;
  if (gl > 0) k.glow(pts[n >> 1], 6, a * gl * 0.4);
}

/** A jagged line over the ground from one place to another, the same every frame for a cast: a crack that crystal comes up through. */
function cracked(k: FxScene, from: { x: number; y: number }, to: { x: number; y: number }, salt: number, kinks = 7, jag = 0.12): P3[] {
  const d = STEP(from, to);
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const out: P3[] = [];
  for (let i = 0; i <= kinks; i++) {
    const u = i / kinks;
    const off = i === 0 || i === kinks ? 0 : (hashOf(k.seed + salt, i) * 2 - 1) * jag * Math.min(1, len);
    const x = from.x + (to.x - from.x) * u - d.y * off, y = from.y + (to.y - from.y) * u + d.x * off;
    out.push(k.on(x, y, 0.2));
  }
  return out;
}

/** Cracks laid on the ground: the inked split and the light in it, `u` of each drawn from its start. Several in one record. */
function cracks(k: FxScene, lines: readonly (readonly P3[])[], u: number, o: { alpha?: number; width?: number; glow?: number; colour?: string } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || u <= 0) return;
  // As shapes on the ground in tiles, which the stage cuts along the tiles' edges and lays a piece at a time: they cost what
  // they cover. A path on the screen as well, for the glow over them.
  const paths: number[][] = [];
  const glowPath = new Path2D();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pts of lines) {
    const n = pts.length;
    const upto = u * (n - 1);
    const run: number[] = [];
    for (let i = 0; i < n && i <= Math.ceil(upto); i++) {
      const p = i <= upto ? pts[i] : mid3(pts[i - 1], pts[i], upto - (i - 1));
      run.push(p.x, p.y);
      if (i) glowPath.lineTo(k.sx(p), k.sy(p));
      else glowPath.moveTo(k.sx(p), k.sy(p));
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
    if (run.length >= 4) paths.push(run);
  }
  if (!paths.length) return;
  const W = (o.width ?? 1) * k.zoom;
  k.groundShape((x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0) / 2 + 0.3, [
    { kind: 'stroke', colour: k.pal.ink, alpha: clamp(a), width: W + Math.max(1, 0.7 * k.zoom), paths, lift: 0.2, join: 'miter' },
    { kind: 'stroke', colour: o.colour ?? k.pal.core, alpha: clamp(a), width: W * 0.6, paths, lift: 0.2, join: 'miter' },
  ]);
  const gl = o.glow ?? 1;
  if (gl > 0) {
    const light = k.pal.light;
    k.glowDraw((g) => {
      g.globalAlpha = clamp(a * gl * 0.3);
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.strokeStyle = light;
      g.lineWidth = W * 2.4;
      g.stroke(glowPath);
      g.lineCap = 'butt';
    });
  }
}

/**
 * The tally: a ring of small lozenges on the ground round what is bound, lit
 * for the share of the binding still to run and going dark one at a time as
 * it runs out, from the top round to the right. Every lasting Binder spell
 * lays one, so how long is left reads the same for all of them.
 */
function tally(k: FxScene, c: { x: number; y: number }, r: number, left: number, total: number, alpha: number, n = 12): void {
  if (alpha <= 0.01 || r <= 0.05) return;
  const share = clamp(left / Math.max(0.01, total));
  const lit = share * n;
  const da = Math.min((TAU / n) * 0.22, 0.034 / r), dr = Math.min(0.032, r * 0.12);
  // Lozenges on the ground in tiles: the lit ones, the one going out, the spent ones.
  const on: number[][] = [], going: number[][] = [], off: number[][] = [];
  for (let i = 0; i < n; i++) {
    const an = -Math.PI * 0.75 + (i / n) * TAU;
    const pts: number[] = [];
    for (const [rr, aa] of [[r + dr, an], [r, an + da], [r - dr, an], [r, an - da]] as const) pts.push(c.x + Math.cos(aa) * rr, c.y + Math.sin(aa) * rr);
    (i < Math.floor(lit) ? on : i < lit ? going : off).push(pts);
  }
  // Two layers and no ink: every layer of a ground shape is cut along the tiles and laid line by line, and a tally is on
  // every bound thing at once, so it is kept to the least that reads -- lit stones in the school's blue, spent ones dark,
  // the one going out joining the dark once it is half gone.
  const lift = 0.15;
  if (lit - Math.floor(lit) > 0.5) on.push(...going);
  else off.push(...going);
  const layers: GroundLayer[] = [
    { kind: 'fill', colour: k.pal.ink, alpha: clamp(alpha * 0.55), paths: off, lift },
    { kind: 'fill', colour: k.pal.main, alpha: clamp(alpha), paths: on, lift },
  ];
  k.groundShape(c.x, c.y, r + 0.2, layers);
}

/** A sharp glint that runs round a fetter now and then: what catches the eye on a bound thing far off. */
function glint(k: FxScene, p: P3, age: number, every: number, alpha: number): void {
  const u = (age % every) / every;
  if (u > 0.25) return;
  k.flare(p, 5, alpha * Math.sin((u / 0.25) * Math.PI), k.pal.core, u * 2);
}

/**
 * Where an area spell was let go, kept from the first time it is asked: the mire, the cracks and the dome stay where they
 * were cast when the caster walks on (their lingers are `on: 'spot'`, which only their seconds end).
 */
function fieldAt(k: FxScene): P3 {
  if (k.state.fieldX === undefined) {
    k.state.fieldX = k.caster.x;
    k.state.fieldY = k.caster.y;
    k.state.fieldZ = k.caster.z;
  }
  return { x: k.state.fieldX, y: k.state.fieldY, z: k.state.fieldZ };
}

/**
 * The creatures standing in an area -- not the caster's own companion -- nearest first and at most `most` of them: what an
 * area binding is drawn on. The island does not say who it reached, so this is who is there now.
 */
function caught(k: FxScene, c: { x: number; y: number }, r: number, most = 5): Body[] {
  const pet = k.companion;
  return k.bodiesWithin(r, c, ['creature'])
    .filter((b) => !pet || Math.hypot(b.x - pet.x, b.y - pet.y) > 0.05)
    .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))
    .slice(0, most);
}

/** Once in a cast: true the first time it is asked, by name. */
function once(k: FxScene, key: string): boolean {
  if (k.state[key]) return false;
  k.state[key] = 1;
  return true;
}

/** A burst of cut crystal off a point: the sound a binding makes when it closes or breaks, drawn. */
function shatterBurst(k: FxScene, at: P3, n: number, away?: { x: number; y: number }, speed = 1): void {
  k.burst(at, n, {
    kind: 'shard', colour: [P.core, P.main, P.accent], size: 2, life: [0.35, 0.7], speed: [0.4 * speed, 1.6 * speed], up: [6, 22],
    gravity: 55, drag: 0.4, spin: 3, ...(away ? { heading: away, cone: 2.6 } : {}),
  });
  k.burst(at, Math.round(n * 0.6), { kind: 'spark', colour: [P.core, P.light], size: 1.6, life: [0.15, 0.35], speed: [0.6 * speed, 2 * speed], up: [0, 16], gravity: 20, drag: 0.1, ...(away ? { heading: away, cone: 2.2 } : {}) });
}

/** A gem coming into being at a point, spinning: the focus's stone answering. `g` nought to one. */
function gemAt(k: FxScene, p: P3, g: number, size: number, spin: number, o: Tones & { alpha?: number; bias?: number } = {}): void {
  if (g <= 0.01) return;
  const h = size * 1.5 * g;
  crystal(k, { x: p.x, y: p.y, z: p.z - h * 0.55 }, { x: p.x, y: p.y, z: p.z + h * 0.75 }, size * g, { ...o, turn: spin, waist: 0.45, bias: o.bias ?? 4 });
}

/* ---- the casts --------------------------------------------------------------------------- */
// Every cast below stops dead at its release and holds still for a beat before recovering: the school's one gesture.
// Keys are at fractions of the cast; the timing beside each is what they were written against.

const REST_ARM: [number, number, number] = [12, 10, 0];

/** Bind: an open hand thrown out at it, closed into a fist at the reach, and the fist hauled back -- a grab at a distance. */
const bindPose: CastPose = (r, t) => {
  r.arm[1] = euler(t, [[0, REST_ARM], [0.3, [36, 34, -24]], [0.45, [92, 6, 2]], [0.58, [60, 14, 8]], [0.76, [58, 14, 8]], [1, REST_ARM]]);
  r.elbow[1] = one(t, [[0, 22], [0.3, 112], [0.45, 4], [0.58, 82], [0.76, 84], [1, 24]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.3, [30, 0, 0]], [0.45, [-12, 0, 0]], [0.58, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.open[1] = false;
  // Fingers spread and hooked as it goes out, shut hard into the fist at the reach: the grab.
  r.shape = [undefined, { claw: one(t, [[0, 0], [0.14, 1], [0.44, 1], [0.47, 0]]) }];
  r.arm[0] = euler(t, [[0, REST_ARM], [0.3, [34, 20, 6]], [0.45, [-12, 22, 0]], [0.76, [-8, 20, 0]], [1, REST_ARM]]);
  r.elbow[0] = one(t, [[0, 20], [0.3, 46], [0.45, 24], [1, 22]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.3, [4, 0, -22]], [0.45, [-6, 0, 14]], [0.58, [6, 0, -4]], [0.76, [6, 0, -4]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.3, [3, 0, -4]], [0.45, [-10, 0, 4]], [0.58, [7, 0, 0]], [0.76, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.3, [-6, 0, 10]], [0.45, [-6, 0, -8]], [0.76, [-4, 0, -4]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.3, [-2, 2, 0]], [0.45, [22, 3, 0]], [0.58, [18, 3, 0]], [1, [3, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.45, 20], [0.58, 8], [1, 5]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [0.45, [-12, 2, 0]], [0.58, [-6, 2, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [0.3, 10], [0.45, 8], [0.58, 22], [0.76, 20], [1, 5]]);
};

/** Shatter: the fist cocked high by the ear while the open left hand sights along the way, then hammered down at it, the knees giving. */
const shatterPose: CastPose = (r, t) => {
  r.arm[1] = euler(t, [[0, REST_ARM], [0.28, [128, 42, -10]], [0.36, [136, 40, -10]], [0.42, [70, 6, 12]], [0.55, [48, 8, 16]], [0.74, [46, 8, 14]], [1, REST_ARM]]);
  r.elbow[1] = one(t, [[0, 22], [0.28, 70], [0.36, 76], [0.42, 8], [0.55, 18], [0.74, 20], [1, 24]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.36, [24, 0, 0]], [0.42, [-20, 0, 0]], [1, [0, 0, 0]]]);
  r.open[1] = false;
  r.arm[0] = euler(t, [[0, REST_ARM], [0.28, [86, 4, -6]], [0.36, [88, 4, -6]], [0.42, [22, 26, 0]], [0.74, [20, 24, 0]], [1, REST_ARM]]);
  r.elbow[0] = one(t, [[0, 20], [0.28, 8], [0.36, 8], [0.42, 52], [1, 22]]);
  r.open[0] = false;
  r.shape = [{ point: one(t, [[0, 0], [0.12, 1], [0.42, 1], [0.5, 0]]) }, undefined];
  r.mouth = one(t, [[0, 0], [0.38, 0], [0.42, 0.45], [0.6, 0]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.28, [8, -4, -22]], [0.36, [10, -4, -24]], [0.42, [-14, 4, 16]], [0.55, [-12, 2, 12]], [0.74, [-11, 2, 11]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.36, [6, 0, -6]], [0.42, [-16, 0, 6]], [0.74, [-12, 0, 4]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.36, [-4, 0, 16]], [0.42, [-10, 0, -8]], [0.74, [-8, 0, -6]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.36, [6, 3, 0]], [0.42, [22, 4, 0]], [0.74, [20, 4, 0]], [1, [3, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.36, 8], [0.42, 30], [0.55, 26], [0.74, 24], [1, 5]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [0.36, [2, 2, 0]], [0.42, [-12, 2, 0]], [0.74, [-10, 2, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [0.36, 8], [0.42, 22], [0.74, 18], [1, 5]]);
};

/** Root: the hand raised, then down onto one knee with the right palm put flat on the ground ahead and held there. */
const rootPose: CastPose = (r, t) => {
  r.arm[1] = euler(t, [[0, REST_ARM], [0.3, [128, 22, -6]], [0.5, [40, 8, 0]], [0.76, [40, 8, 0]], [1, REST_ARM]]);
  r.elbow[1] = one(t, [[0, 22], [0.3, 46], [0.5, 6], [0.76, 6], [1, 24]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.3, [10, 0, 0]], [0.5, [-70, 0, 0]], [0.76, [-70, 0, 0]], [1, [0, 0, 0]]]);
  r.arm[0] = euler(t, [[0, REST_ARM], [0.3, [40, 30, 0]], [0.5, [10, 40, 0]], [0.76, [10, 40, 0]], [1, REST_ARM]]);
  r.elbow[0] = one(t, [[0, 20], [0.3, 30], [0.5, 20], [1, 22]]);
  r.open = [false, false];
  r.shape = [{ flat: one(t, [[0.15, 0], [0.3, 0.8], [0.86, 0.8], [1, 0]]) }, { flat: one(t, [[0, 0], [0.12, 1], [0.86, 1], [1, 0]]) }];
  // Down onto the right knee as the hand comes down, and the palm put flat on the ground ahead, the back bowing as far as it
  // takes to get it there.
  r.kneel = one(t, [[0, 0], [0.34, 0], [0.48, 1], [0.8, 1], [0.95, 0]]);
  r.reach = [undefined, { at: [1.4, 6.5, 0.6], stoop: true, w: one(t, [[0, 0], [0.38, 0], [0.5, 1], [0.78, 1], [0.92, 0]]) }];
  r.chest = euler(t, [[0, [0, 0, 0]], [0.3, [4, 0, -10]], [0.5, [-6, 0, 10]], [0.78, [-6, 0, 10]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.3, [-8, 0, 0]], [0.5, [20, 0, -6]], [0.78, [18, 0, -6]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.3, [6, 0, -4]], [0.5, [0, 0, 6]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.3, [-4, 2, 0]], [0.4, [10, 3, 0]], [1, [3, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.3, 10], [0.4, 14], [1, 5]]);
};

/** Stillness: the hands brought before the chest and the head bowed, a breath, then both palms pressed slowly down to the hips. */
const stillnessPose: CastPose = (r, t) => {
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, REST_ARM], [0.28, [20, 20, 24]], [0.4, [22, 20, 24]], [0.55, [2, 14, 30]], [0.82, [2, 14, 30]], [1, REST_ARM]]);
    r.elbow[k] = one(t, [[0, 18], [0.28, 108], [0.4, 106], [0.55, 72], [0.82, 70], [1, 20]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.28, [-30, 0, 0]], [0.55, [-62, 0, 0]], [0.82, [-60, 0, 0]], [1, [0, 0, 0]]]);
    r.open[k] = false;
    r.knee[k] = one(t, [[0, 4], [0.4, 4], [0.55, 12], [0.82, 11], [1, 4]]);
  }
  r.head = euler(t, [[0, [0, 0, 0]], [0.28, [-14, 0, 0]], [0.4, [-10, 0, 0]], [0.55, [-22, 0, 0]], [0.82, [-20, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.28, [2, 0, 0]], [0.4, [6, 0, 0]], [0.55, [-5, 0, 0]], [0.82, [-4, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.55, [-4, 0, 0]], [1, [0, 0, 0]]]);
  r.shrug = [one(t, [[0, 0], [0.4, 0.3], [0.55, 0]]), one(t, [[0, 0], [0.4, 0.3], [0.55, 0]])];
  const palms = { flat: one(t, [[0, 0], [0.14, 1], [0.86, 1], [1, 0]]) };
  r.shape = [palms, palms];
};

/** Heavy Limbs: a weight taken up at the chest, hoisted overhead with the back straining, heaved forward off both hands, and the body sinking after it. */
const heavyPose: CastPose = (r, t) => {
  r.shape = [undefined, undefined];
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, REST_ARM], [0.22, [14, 20, 24]], [0.42, [150, 16, 8]], [0.5, [152, 16, 8]], [0.56, [96, 10, 8]], [0.7, [44, 10, 6]], [0.84, [42, 10, 6]], [1, REST_ARM]]);
    r.elbow[k] = one(t, [[0, 20], [0.22, 96], [0.42, 76], [0.5, 80], [0.56, 12], [0.7, 14], [0.84, 16], [1, 22]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.22, [30, 0, 0]], [0.5, [30, 0, 0]], [0.56, [-20, 0, 0]], [1, [0, 0, 0]]]);
    r.open[k] = false;
    r.shape[k] = { cup: one(t, [[0, 0], [0.12, 1], [0.52, 1], [0.58, 0]]), flat: one(t, [[0.52, 0], [0.58, 1], [0.86, 1], [1, 0]]) };
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [0.22, [8, 6, 0]], [0.5, [2, 6, 0]], [0.7, [18, 8, 0]], [0.84, [16, 8, 0]], [1, [2, 2, 0]]]);
    r.knee[k] = one(t, [[0, 4], [0.22, 22], [0.42, 6], [0.5, 8], [0.7, 38], [0.84, 34], [1, 4]]);
  }
  // Straining under it at the top, and the whole body following it down after it has gone.
  r.spine = euler(t, [[0, [0, 0, 0]], [0.22, [-6, 0, 0]], [0.42, [10, 0, 0]], [0.5, [12, 0, 0]], [0.56, [-8, 0, 0]], [0.7, [-20, 0, 0]], [0.84, [-18, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.42, [6, 0, 0]], [0.56, [-6, 0, 0]], [0.7, [-8, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.22, [-12, 0, 0]], [0.42, [6, 0, 0]], [0.56, [0, 0, 0]], [0.7, [8, 0, 0]], [1, [0, 0, 0]]]);
  r.mouth = one(t, [[0, 0], [0.4, 0], [0.5, 0.4], [0.56, 0.6], [0.7, 0]]);
};

/** Dull Claws: the left hand drawn across to the right shoulder, then a backhand swept out flat across the front and away. */
const dullPose: CastPose = (r, t) => {
  r.arm[0] = euler(t, [[0, REST_ARM], [0.3, [80, -34, 44]], [0.36, [82, -36, 46]], [0.46, [86, 58, -14]], [0.6, [76, 70, -14]], [0.76, [74, 70, -12]], [1, REST_ARM]]);
  r.elbow[0] = one(t, [[0, 20], [0.3, 98], [0.36, 102], [0.46, 8], [0.6, 12], [0.76, 14], [1, 22]]);
  r.hand[0] = euler(t, [[0, [0, 0, 0]], [0.36, [0, 0, 30]], [0.46, [0, 0, -30]], [1, [0, 0, 0]]]);
  r.open[0] = false;
  r.shape = [{ flat: one(t, [[0, 0], [0.14, 1], [0.84, 1], [1, 0]]) }, undefined];
  r.arm[1] = euler(t, [[0, REST_ARM], [0.3, [30, 14, 10]], [0.46, [22, 20, 0]], [1, REST_ARM]]);
  r.elbow[1] = one(t, [[0, 20], [0.3, 84], [0.46, 64], [1, 22]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.3, [2, 0, -22]], [0.36, [2, 0, -24]], [0.46, [-4, 0, 24]], [0.6, [-4, 0, 26]], [0.76, [-3, 0, 24]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.36, [0, 0, -8]], [0.46, [-6, 0, 8]], [0.76, [-5, 0, 7]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.36, [0, 0, 14]], [0.46, [-4, 0, -12]], [0.76, [-3, 0, -10]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.36, [-2, 2, 0]], [0.46, [16, 8, 0]], [0.76, [14, 7, 0]], [1, [3, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.46, 16], [0.76, 12], [1, 5]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [0.36, [6, 2, 0]], [0.46, [-6, 2, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [0.36, 16], [0.46, 10], [1, 5]]);
};

/** Tether: a crystal stake raised and cocked over the shoulder, thrown, and then the fist hauled back to the hip as a leash is drawn tight. */
const tetherPose: CastPose = (r, t) => {
  r.arm[1] = euler(t, [[0, REST_ARM], [0.2, [118, 26, -10]], [0.38, [166, 30, -28]], [0.48, [92, 8, 16]], [0.58, [66, 10, 18]], [0.7, [22, 18, 6]], [0.86, [22, 18, 6]], [1, REST_ARM]]);
  r.elbow[1] = one(t, [[0, 22], [0.2, 64], [0.38, 100], [0.48, 8], [0.58, 26], [0.7, 96], [0.86, 94], [1, 24]]);
  r.open[1] = false;
  r.arm[0] = euler(t, [[0, REST_ARM], [0.38, [86, 12, -8]], [0.48, [40, 22, 0]], [0.7, [30, 20, 0]], [1, REST_ARM]]);
  r.elbow[0] = one(t, [[0, 20], [0.38, 10], [0.48, 40], [0.7, 30], [1, 22]]);
  r.open[0] = false;
  r.shape = [{ point: one(t, [[0.15, 0], [0.3, 1], [0.48, 1], [0.56, 0]]) }, { flat: one(t, [[0.46, 0], [0.49, 1], [0.6, 1], [0.66, 0]]) }];
  r.chest = euler(t, [[0, [0, 0, 0]], [0.38, [8, -6, -30]], [0.48, [-8, 4, 22]], [0.58, [-6, 2, 18]], [0.7, [6, 0, -10]], [0.86, [6, 0, -10]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.38, [8, 0, -8]], [0.48, [-14, 0, 8]], [0.58, [-10, 0, 6]], [0.7, [9, 0, 0]], [0.86, [8, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.38, [0, 0, 24]], [0.48, [-4, 0, -6]], [0.7, [-6, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.38, [16, 3, 0]], [0.48, [26, 3, 0]], [0.7, [22, 3, 0]], [0.86, [21, 3, 0]], [1, [3, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.38, 10], [0.48, 24], [0.7, 10], [1, 5]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [0.38, [-8, 2, 0]], [0.48, [-18, 2, 0]], [0.7, [-12, 2, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [0.38, 18], [0.48, 12], [0.7, 28], [0.86, 26], [1, 5]]);
};

/** Brittle: a hand drawn up by the cheek, aimed, and flicked straight out to point -- a tap on glass from across the field -- and held. */
const brittlePose: CastPose = (r, t) => {
  r.arm[1] = euler(t, [[0, REST_ARM], [0.24, [116, 32, -30]], [0.34, [118, 30, -30]], [0.4, [94, 2, 0]], [0.64, [92, 4, 0]], [1, REST_ARM]]);
  r.elbow[1] = one(t, [[0, 22], [0.24, 130], [0.34, 134], [0.4, 0], [0.64, 4], [1, 24]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.34, [40, 0, 0]], [0.4, [-30, 0, 0]], [0.64, [-24, 0, 0]], [1, [0, 0, 0]]]);
  r.open[1] = false;
  r.shape = [undefined, { point: one(t, [[0, 0], [0.12, 1], [0.86, 1], [1, 0]]) }];
  r.arm[0] = euler(t, [[0, REST_ARM], [0.24, [24, 12, 0]], [0.4, [16, 16, 0]], [1, REST_ARM]]);
  r.elbow[0] = one(t, [[0, 20], [0.24, 40], [0.4, 30], [1, 22]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.24, [-6, 8, 10]], [0.34, [-6, 8, 10]], [0.4, [-4, 5, 0]], [0.64, [-4, 5, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.34, [2, 0, -12]], [0.4, [-3, 0, 8]], [0.64, [-3, 0, 8]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.34, [2, 0, 0]], [0.4, [-5, 0, 0]], [0.64, [-4, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.34, [0, 2, 0]], [0.4, [10, 2, 0]], [1, [3, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.4, 8], [1, 5]]);
};

/** Lock: both hands out together, turned as a key is turned, then shut into fists and hauled in to the chest from a wide, set stance. */
const lockPose: CastPose = (r, t) => {
  const cupped = { cup: one(t, [[0, 0], [0.14, 1], [0.54, 1], [0.58, 0]]) };
  r.shape = [cupped, cupped];
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1;
    r.arm[k] = euler(t, [[0, REST_ARM], [0.28, [68, 50, 12]], [0.46, [70, 50, 12]], [0.58, [20, 20, 24]], [0.84, [20, 20, 24]], [1, REST_ARM]]);
    r.elbow[k] = one(t, [[0, 20], [0.28, 36], [0.46, 34], [0.58, 108], [0.84, 108], [1, 22]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.28, [0, 0, 0]], [0.46, [0, 80 * s, 0]], [0.58, [0, 70 * s, 0]], [1, [0, 0, 0]]]);
    r.open[k] = false;
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [0.28, [2, 9, 0]], [0.58, [4, 12, 0]], [0.84, [4, 12, 0]], [1, [2, 2, 0]]]);
    r.knee[k] = one(t, [[0, 4], [0.28, 10], [0.46, 8], [0.58, 24], [0.84, 22], [1, 4]]);
  }
  r.chest = euler(t, [[0, [0, 0, 0]], [0.28, [-4, 0, 0]], [0.46, [-4, 4, -16]], [0.58, [6, 0, 0]], [0.84, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.28, [-8, 0, 0]], [0.46, [-6, 0, -4]], [0.58, [6, 0, 0]], [0.84, [5, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.28, [-6, 0, 0]], [0.46, [-6, 0, 8]], [0.58, [-10, 0, 0]], [0.84, [-9, 0, 0]], [1, [0, 0, 0]]]);
};

/** Still Skin: the arms crossed over the chest and the body curled round them, then the fists driven down and out at the sides, chest up. */
const stillSkinPose: CastPose = (r, t) => {
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, REST_ARM], [0.3, [2, 32, 66]], [0.42, [4, 32, 68]], [0.5, [-8, 26, -4]], [0.78, [-6, 24, -4]], [1, REST_ARM]]);
    r.elbow[k] = one(t, [[0, 20], [0.3, 108], [0.42, 112], [0.5, 4], [0.78, 6], [1, 22]]);
    r.open[k] = false;
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [0.3, [6, 4, 0]], [0.5, [2, 12, 0]], [0.78, [2, 12, 0]], [1, [2, 2, 0]]]);
    r.knee[k] = one(t, [[0, 4], [0.3, 18], [0.42, 20], [0.5, 8], [0.78, 8], [1, 4]]);
  }
  r.shrug = [one(t, [[0, 0], [0.42, 0.4], [0.5, -0.15], [0.78, -0.15], [1, 0]]), one(t, [[0, 0], [0.42, 0.4], [0.5, -0.15], [0.78, -0.15], [1, 0]])];
  r.spine = euler(t, [[0, [0, 0, 0]], [0.3, [-10, 0, 0]], [0.42, [-12, 0, 0]], [0.5, [6, 0, 0]], [0.78, [5, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.3, [-8, 0, 0]], [0.42, [-9, 0, 0]], [0.5, [9, 0, 0]], [0.78, [8, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.3, [-14, 0, 0]], [0.42, [-16, 0, 0]], [0.5, [6, 0, 0]], [0.78, [5, 0, 0]], [1, [0, 0, 0]]]);
};

/** Mire: down into a wide squat, the hands together low ahead, then swept slowly apart, palms flat, as if smoothing something thick. */
const mirePose: CastPose = (r, t) => {
  const palms = { flat: one(t, [[0, 0], [0.14, 1], [0.86, 1], [1, 0]]) };
  r.shape = [palms, palms];
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, REST_ARM], [0.25, [14, 26, 30]], [0.55, [40, 68, -4]], [0.82, [36, 70, -4]], [1, REST_ARM]]);
    r.elbow[k] = one(t, [[0, 20], [0.25, 72], [0.55, 10], [0.82, 12], [1, 22]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.25, [-50, 0, 0]], [0.55, [-60, 0, 0]], [0.82, [-56, 0, 0]], [1, [0, 0, 0]]]);
    r.open[k] = false;
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [0.25, [20, 10, 0]], [0.55, [28, 16, 0]], [0.82, [26, 16, 0]], [1, [2, 2, 0]]]);
    r.knee[k] = one(t, [[0, 4], [0.25, 40], [0.55, 58], [0.82, 54], [1, 4]]);
  }
  r.spine = euler(t, [[0, [0, 0, 0]], [0.25, [-16, 0, 0]], [0.55, [-22, 0, 0]], [0.82, [-20, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.4, [-4, 0, 6]], [0.55, [-4, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.25, [6, 0, 0]], [0.55, [14, 0, 0]], [0.82, [12, 0, 0]], [1, [0, 0, 0]]]);
};

/** Mass Root: both arms flung up as the body rises onto its toes, a small hop, and down onto a knee with both palms slammed flat. */
const massRootPose: CastPose = (r, t) => {
  const w = one(t, [[0, 0], [0.44, 0], [0.5, 1], [0.78, 1], [0.92, 0]]);
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, REST_ARM], [0.25, [140, 30, 0]], [0.38, [152, 28, 0]], [0.5, [34, 16, 0]], [0.78, [36, 16, 0]], [1, REST_ARM]]);
    r.elbow[k] = one(t, [[0, 20], [0.25, 30], [0.38, 20], [0.5, 6], [0.78, 8], [1, 22]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.38, [10, 0, 0]], [0.5, [-72, 0, 0]], [0.78, [-70, 0, 0]], [1, [0, 0, 0]]]);
    r.open[k] = false;
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [0.25, [10, 4, 0]], [0.38, [0, 4, 0]], [1, [2, 2, 0]]]);
    r.knee[k] = one(t, [[0, 4], [0.25, 24], [0.38, 2], [0.46, 12], [1, 4]]);
  }
  const palms = { flat: one(t, [[0, 0], [0.14, 1], [0.86, 1], [1, 0]]) };
  r.shape = [palms, palms];
  r.lift = one(t, [[0, 0], [0.32, 0], [0.4, 3], [0.47, 0], [1, 0]]);
  // Down on a knee as it lands, both palms put flat on the ground either side ahead, and a shout as they strike.
  r.kneel = one(t, [[0, 0], [0.44, 0], [0.5, 1], [0.8, 1], [0.95, 0]]);
  r.reach = [{ at: [-2.6, 5.5, 0.6], stoop: true, w }, { at: [2.6, 5.5, 0.6], stoop: true, w }];
  r.mouth = one(t, [[0, 0], [0.44, 0], [0.5, 0.85], [0.64, 0.3], [0.78, 0]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.25, [4, 0, 0]], [0.38, [10, 0, 0]], [0.5, [0, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.38, [6, 0, 0]], [0.5, [-6, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.38, [16, 0, 0]], [0.5, [24, 0, 0]], [0.78, [22, 0, 0]], [1, [0, 0, 0]]]);
};

/** Snare: the focus held up in the left hand while the right draws a loop in the air before it, then tosses the noose low and yanks it shut. */
const snarePose: CastPose = (r, t) => {
  r.arm[0] = euler(t, [[0, REST_ARM], [0.2, [32, 14, 12]], [0.55, [34, 14, 12]], [0.82, [30, 14, 12]], [1, REST_ARM]]);
  r.elbow[0] = one(t, [[0, 20], [0.2, 108], [0.55, 106], [0.82, 104], [1, 22]]);
  r.open[0] = false;
  r.shape = [{ cup: one(t, [[0, 0], [0.14, 1], [0.86, 1], [1, 0]]) }, { point: one(t, [[0.04, 0], [0.12, 1], [0.42, 1], [0.48, 0]]), flat: one(t, [[0.46, 0], [0.5, 1], [0.58, 1], [0.64, 0]]) }];
  // The loop: a full turn of the hand round a point before the chest, then down and back for the toss.
  const loop = seg(t, 0.1, 0.42);
  const ph = loop * TAU;
  const inLoop: [number, number, number] = [72 + 16 * Math.sin(ph), 22 + 16 * Math.cos(ph), 0];
  if (t < 0.1) r.arm[1] = euler(t, [[0, REST_ARM], [0.1, [72, 38, 0]]]);
  else if (t < 0.42) r.arm[1] = inLoop;
  else r.arm[1] = euler(t, [[0.42, [72, 38, 0]], [0.49, [-18, 12, 0]], [0.55, [72, 4, 0]], [0.68, [28, 14, 0]], [0.86, [26, 14, 0]], [1, REST_ARM]]);
  r.elbow[1] = one(t, [[0, 22], [0.1, 40], [0.42, 40], [0.49, 10], [0.55, 4], [0.68, 92], [0.86, 90], [1, 24]]);
  r.open[1] = false;
  r.chest = euler(t, [[0, [0, 0, 0]], [0.42, [0, 0, -4]], [0.49, [2, 0, -14]], [0.55, [-6, 0, 10]], [0.68, [6, 0, -6]], [0.86, [6, 0, -6]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.49, [-4, 0, 0]], [0.55, [-10, 0, 0]], [0.68, [7, 0, 0]], [0.86, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.2, [-10, 0, 0]], [0.42, [-10, 0, 0]], [0.55, [-2, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.49, [0, 2, 0]], [0.55, [18, 3, 0]], [0.86, [16, 3, 0]], [1, [3, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.55, 16], [0.68, 8], [1, 5]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [0.55, [-8, 2, 0]], [0.68, [-8, 2, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [0.49, 12], [0.55, 6], [0.68, 20], [0.86, 18], [1, 5]]);
};

/** Still field: the arms rise wide and meet overhead, the hands pressed together, then flung out level at the shoulders -- and the body freezes there. */
const stillfieldPose: CastPose = (r, t) => {
  const palms = { flat: one(t, [[0, 0], [0.12, 1], [0.9, 1], [1, 0]]) };
  r.shape = [palms, palms];
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, REST_ARM], [0.2, [70, 50, 0]], [0.38, [150, 18, 14]], [0.45, [152, 16, 16]], [0.5, [8, 86, 0]], [0.86, [8, 86, 0]], [1, REST_ARM]]);
    r.elbow[k] = one(t, [[0, 20], [0.2, 20], [0.38, 34], [0.45, 36], [0.5, 2], [0.86, 2], [1, 22]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.45, [0, 0, 0]], [0.5, [50, 0, 0]], [0.86, [50, 0, 0]], [1, [0, 0, 0]]]);
    r.open[k] = false;
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [0.38, [0, 3, 0]], [0.5, [2, 8, 0]], [0.86, [2, 8, 0]], [1, [2, 2, 0]]]);
    r.knee[k] = one(t, [[0, 4], [0.2, 10], [0.38, 2], [0.5, 10], [0.86, 10], [1, 4]]);
  }
  r.head = euler(t, [[0, [0, 0, 0]], [0.38, [16, 0, 0]], [0.45, [18, 0, 0]], [0.5, [0, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.38, [6, 0, 0]], [0.5, [-2, 0, 0]], [0.86, [-2, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.38, [6, 0, 0]], [0.5, [4, 0, 0]], [0.86, [4, 0, 0]], [1, [0, 0, 0]]]);
};

/* ---- the spells' numbers, read off the rules ------------------------------------------------ */

const BIND = spellInfo('binder_bind');
/** A hold's hoops: one for each fifth of a full hold, so a Bind at forty in the hundred has two. */
const HOOPS = Math.max(1, Math.round((BIND?.fx.hold ?? 0.4) * 5));
const MIRE_R = RADIUS('binder_mire') || 4;
const MASS_R = RADIUS('binder_mass_root') || 4;
const FIELD_R = RADIUS('stillfield') || 3;

/* ---- the spells ------------------------------------------------------------------------------- */

const bind: SpellVisual = {
  palette: P,
  cast: { timing: { secs: 0.85, release: 0.45, blendOut: 0.2 }, pose: bindPose },
  fx: {
    // A sapphire forming in the open hand as it goes out.
    charge: (k, t) => {
      const g = smooth(seg(t, 0.08, 0.42)) * (1 - seg(t, 0.45, 0.47));
      gemAt(k, k.hand(1), g, 2.2, k.now * 6);
      k.light(k.hand(1), 1.5, 0.4 * g);
    },
    release: (k) => k.burst(k.hand(1), 8, { kind: 'spark', colour: [P.core, P.main], size: 1.6, life: [0.12, 0.3], speed: [0.8, 1.6], up: [0, 8], heading: k.toward(k.caster, k.target), cone: 0.9, gravity: 10 }),
    // The stone flies, a chain paying out behind it from the fist.
    travel: { secs: (tiles) => 0.08 + tiles * 0.06, draw: (k, u) => {
      const from = k.hand(1), to = k.heart(k.target);
      const lift = 2 + k.dist * 0.8;
      const head = arcAt(from, to, u, lift);
      const pts: P3[] = [];
      for (let i = 0; i <= 8; i++) pts.push(arcAt(from, to, (u * i) / 8, lift * (1 + 0.3 * Math.sin((i / 8) * Math.PI))));
      chain(k, pts, { link: 3, alpha: 0.95 });
      gemAt(k, head, 1, 2.4, k.now * 14);
      k.light(head, 2, 0.5);
    } },
    hit: (k) => {
      shatterBurst(k, k.heart(k.target), 10, k.toward(k.caster, k.target), 0.8);
      k.burst(k.at(k.target, 0.4), 10, { kind: 'mote', colour: [P.core, P.accent], size: 1.8, life: [0.3, 0.6], speed: [0.2, 0.5], up: [2, 10], gravity: 0 });
    },
    // The chain snatched back to the fist as the hoops slam shut, one after the other.
    impact: { secs: 0.5, draw: (k, u) => {
      const from = k.hand(1), to = k.heart(k.target);
      const back = easeIn(seg(u, 0, 0.5));
      if (back < 1) chain(k, [mid3(to, from, back), mid3(to, from, lerp(back, 1, 0.5)), from], { link: 3, alpha: 1 - back });
      for (let i = 0; i < HOOPS; i++) {
        const shut = seg(u, i * 0.12, i * 0.12 + 0.12);
        if (shut > 0 && shut < 1) k.flare(k.at(k.target, 0.3 + (0.32 * i) / Math.max(1, HOOPS - 1)), 8, flashOf(shut, 0.3), P.core, i);
      }
      k.light(k.target, 2.5, 0.7 * (1 - u));
    } },
    linger: { draw: (k, age, left) => {
      const b = k.target;
      const a = life(age, left, 0.05, 0.35);
      const total = age + left;
      const r0 = girth(b);
      for (let i = 0; i < HOOPS; i++) {
        const z = b.z + b.tall * (0.3 + (0.32 * i) / Math.max(1, HOOPS - 1));
        // Closing from wide with a snap that overshoots, then held tight with the least breath of strain.
        const shut = easeBack(seg(age, i * 0.06, i * 0.06 + 0.22));
        const strain = 1 + 0.03 * Math.sin(age * 9 + i * 2);
        const loosen = 1 + 0.6 * (1 - smooth(left / 0.35));
        hoop(k, b, z, r0 * lerp(2.6, 1, shut) * strain * loosen, { alpha: a * smooth(seg(age, i * 0.06, i * 0.06 + 0.06)), turn: (1 - shut) * 2 + i * 0.3, h: band(b) });
      }
      glint(k, k.at(b, 0.62), age + k.seed % 7, 1.6, a);
      tally(k, b, r0 * 2, left, total, 0.8 * a);
      k.light(b, 1.2, 0.3 * a);
      if (left < 0.3 && once(k, 'broke')) shatterBurst(k, k.at(b, 0.45), 14);
    } },
  },
};

/**
 * How much more a Shatter breaks: its own `held` over its `shatter` on a creature the island says is held fast (twice as
 * much), and once on anything else. The island says so only of a trap's hold; a Binder's own holds are not in what it
 * sends, so on those it is drawn once.
 */
const shatterMore = (k: FxScene): number => (k.target.held ? (k.fx.held ?? 2) / (k.fx.shatter ?? 1) : 1);

const shatter: SpellVisual = {
  palette: P,
  cast: { timing: { secs: 0.7, release: 0.42, blendOut: 0.22 }, pose: shatterPose },
  fx: {
    // Crystal spurs breaking out of the cocked fist, the stone's edge showing.
    charge: (k, t) => {
      const g = smooth(seg(t, 0.12, 0.36)) * (1 - seg(t, 0.42, 0.44));
      if (g <= 0) return;
      const h = k.hand(1);
      for (let i = 0; i < 3; i++) {
        const an = -Math.PI / 2 + (i - 1) * 0.8;
        const len = (i === 1 ? 6 : 4.2) * g;
        crystal(k, h, { x: h.x + Math.cos(an) * 0.03 * g, y: h.y + Math.sin(an) * 0.03 * g, z: h.z + len }, 1.8 * g, { waist: 0.3, turn: i, glow: 0.6, bias: 4, main: P.core, core: '#ffffff', deep: P.accent });
      }
      k.light(h, 1.6, 0.5 * g);
    },
    release: (k) => k.burst(k.hand(1), 10, { kind: 'spark', colour: [P.core, P.accent], size: 1.8, life: [0.1, 0.25], speed: [1, 2.2], up: [-10, 6], heading: k.toward(k.caster, k.target), cone: 0.7, gravity: 0 }),
    // A diamond lance, straight and fast, with a streak behind it.
    travel: { secs: (tiles) => 0.04 + tiles * 0.028, draw: (k, u) => {
      const from = k.hand(1), to = k.heart(k.target);
      const len = Math.min(0.9, 0.55 / Math.max(0.5, k.dist));
      const tip = mid3(from, to, u), tail = mid3(from, to, Math.max(0, u - len));
      k.ribbon([mid3(from, to, Math.max(0, u - len * 2.2)), tail], { width: 2, taper: 'start', alpha: 0.6, main: P.accent, glow: 0.6 });
      crystal(k, tail, tip, 1.8, { waist: 0.72, turn: k.now * 20, main: P.core, core: '#ffffff', deep: P.accent });
      k.light(tip, 1.8, 0.6);
    } },
    hit: (k) => {
      const at = k.heart(k.target);
      const m = shatterMore(k);
      shatterBurst(k, at, Math.round(34 * m), k.toward(k.caster, k.target), 1.4 * Math.sqrt(m));
      if (m > 1) k.flash(0.05);
      k.burst(k.at(k.target, 0.05), 8, { kind: 'dust', colour: '#9aa6c0', size: 3, life: [0.4, 0.7], speed: [0.3, 0.7], up: [2, 6], gravity: 2 });
    },
    // The air round it breaks like a pane: spurs of crystal fly out from where the lance went in, and the ground under it splits.
    impact: { secs: 0.6, draw: (k, u) => {
      const b = k.target, at = k.heart(b);
      const m = shatterMore(k);
      const out = easeOut(seg(u, 0, 0.35)) * Math.sqrt(m);
      const fade = 1 - smooth(seg(u, 0.35, 1));
      const away = k.toward(k.caster, b);
      const spurs = Math.round(7 * Math.sqrt(m));
      for (let i = 0; i < spurs; i++) {
        const an = Math.atan2(away.y, away.x) + (i - (spurs - 1) / 2) * (3.85 / spurs) * Math.sqrt(m) + (hashOf(k.seed, i) - 0.5) * 0.4;
        const dir = { x: Math.cos(an), y: Math.sin(an) };
        const lift = (hashOf(k.seed + 1, i) - 0.3) * 14;
        const r0 = 0.08 + 0.4 * out, r1 = r0 + 0.16 + 0.1 * hashOf(k.seed + 2, i);
        const a = { x: at.x + dir.x * r0 * 0.6, y: at.y + dir.y * r0 * 0.6, z: at.z + lift * out * 0.5 };
        const c = { x: at.x + dir.x * r1, y: at.y + dir.y * r1, z: at.z + lift * out };
        crystal(k, a, c, 1.5 * fade + 0.3, { waist: 0.3, turn: i + u * 6, alpha: fade, glow: 0.4 });
      }
      const lines: P3[][] = [];
      for (let i = 0; i < 6 * m; i++) {
        const an = (i / (6 * m)) * TAU + hashOf(k.seed + 4, i);
        const len = (0.35 + 0.35 * hashOf(k.seed + 5, i)) * Math.sqrt(m);
        lines.push(cracked(k, b, { x: b.x + Math.cos(an) * len, y: b.y + Math.sin(an) * len }, 20 + i, 4, 0.12));
      }
      cracks(k, lines, easeOut(seg(u, 0, 0.25)), { alpha: 1 - smooth(seg(u, 0.4, 1)), width: 1.3 });
      // On something already held, the hold breaks with it: its fetter bursts outward as the spurs fly.
      if (m > 1) hoop(k, b, b.z + b.tall * 0.45, girth(b) * (1 + 2.5 * out), { alpha: fade, h: band(b), turn: u * 2, n: 10 });
      k.flare(at, 14 * Math.sqrt(m) * (1 - u * 0.6), flashOf(u, 0.08), P.core, u);
      k.light(b, 3.5, 0.9 * (1 - u));
    } },
  },
};

/** Root's crystal is the school's blue lit pale rather than white: it is stone come up out of the ground, not light. */
const ROOT_CORE = '#b9d8ff';

/** Root's crystal, by where it comes up round the feet: the far ones before the body, the near ones after it. */
function rootSpikes(k: FxScene, b: Body, grow: number, a: number, salt: number, n = 6): void {
  const r0 = girth(b) * 1.25;
  const cy = k.sy({ x: b.x, y: b.y, z: b.z });
  const far: Array<(g: CanvasRenderingContext2D) => void> = [], near: Array<(g: CanvasRenderingContext2D) => void> = [];
  for (let i = 0; i < n; i++) {
    const g = easeBack(seg(grow, (i % 3) * 0.12, (i % 3) * 0.12 + 0.6));
    if (g <= 0.01) continue;
    const an = (i / n) * TAU + hashOf(k.seed + salt, i) * 0.5;
    const rr = r0 * (0.85 + 0.35 * hashOf(k.seed + salt + 1, i));
    const base = { x: b.x + Math.cos(an) * rr, y: b.y + Math.sin(an) * rr };
    const tall = b.tall * (0.24 + 0.16 * hashOf(k.seed + salt + 2, i)) * g;
    const lean = { x: -Math.cos(an) * rr * 0.55, y: -Math.sin(an) * rr * 0.55 };
    const paint = spike(k, base, tall, 2.2 + 0.9 * hashOf(k.seed + salt + 3, i), lean, { alpha: a, turn: i * 1.3, core: ROOT_CORE });
    if (paint) (k.sy({ x: base.x, y: base.y, z: b.z }) > cy ? near : far).push(paint);
  }
  // Two records, the far crystals behind the body they hold and the near ones before it, each laid back to front.
  const foot = { x: b.x, y: b.y, z: b.z };
  if (far.length) k.worldDraw(foot, (g) => { for (const p of far) p(g); }, -2);
  if (near.length) k.worldDraw(foot, (g) => { for (const p of near) p(g); }, 2);
  k.glow(k.at(b, 0.15), 14, a * 0.35);
}

const root: SpellVisual = {
  palette: P,
  cast: { timing: { secs: 1.1, release: 0.5, blendOut: 0.22 }, pose: rootPose },
  fx: {
    charge: (k, t) => {
      const g = bump(t, 0.1, 0.48, 0.56);
      k.glow(k.hand(1), 6, 0.7 * g);
      k.light(k.hand(1), 1.5, 0.4 * g);
    },
    release: (k) => {
      const h = k.hand(1);
      k.burst(k.on(h.x, h.y, 0.5), 7, { kind: 'dust', colour: '#8f8a7a', size: 2.4, life: [0.3, 0.6], speed: [0.3, 0.8], up: [2, 6], gravity: 4 });
      shatterBurst(k, k.on(h.x, h.y, 1), 6);
      k.state.fx = h.x;
      k.state.fy = h.y;
    },
    // A crack runs over the ground from the palm to its feet, crystal breaking up behind its head as it goes.
    travel: { secs: (tiles) => 0.12 + tiles * 0.08, draw: (k, u) => {
      const from = { x: k.state.fx ?? k.caster.x, y: k.state.fy ?? k.caster.y };
      const line = cracked(k, from, k.spot, 3, 9, 0.18);
      cracks(k, [line], u);
      const head = mid3(line[Math.floor(u * (line.length - 1))], line[Math.min(line.length - 1, Math.floor(u * (line.length - 1)) + 1)], (u * (line.length - 1)) % 1);
      for (let i = 0; i < 2; i++) {
        const v = clamp(u - i * 0.12);
        const p = mid3(line[Math.floor(v * (line.length - 1))], line[Math.min(line.length - 1, Math.floor(v * (line.length - 1)) + 1)], (v * (line.length - 1)) % 1);
        const paint = spike(k, p, 4 * (1 - i * 0.4), 1.4, { x: 0, y: 0 }, { turn: i + u * 4 });
        if (paint) k.worldDraw(p, paint, 0);
      }
      k.emit(head, 14, { kind: 'dust', colour: '#8f8a7a', size: 2, life: [0.25, 0.5], speed: [0.1, 0.3], up: [3, 6], gravity: 4 });
      k.light(head, 1.6, 0.5);
    } },
    hit: (k) => {
      k.burst(k.at(k.target, 0.05), 8, { kind: 'dust', colour: '#8f8a7a', size: 2.6, life: [0.4, 0.7], speed: [0.3, 0.9], up: [3, 8], gravity: 4 });
      shatterBurst(k, k.at(k.target, 0.1), 10);
    },
    impact: { secs: 0.6, draw: (k, u) => {
      k.ring(k.target, girth(k.target) * (1.2 + 1.4 * easeOut(u)), { band: 0.06, alpha: 0.8 * (1 - u), glow: 0.5 });
      k.light(k.target, 2.5, 0.7 * (1 - u));
    } },
    // Crystal grown up round the feet and holding them, to the knee and no higher: it can still strike.
    linger: { draw: (k, age, left) => {
      const b = k.target;
      const a = life(age, left, 0.05, 0.5);
      const from = { x: k.state.fx ?? k.caster.x, y: k.state.fy ?? k.caster.y };
      const fadeLine = 1 - smooth(age / 1.2);
      if (fadeLine > 0) cracks(k, [cracked(k, from, k.spot, 3, 9, 0.18)], 1, { alpha: fadeLine });
      k.disc(b, girth(b) * 1.7, { alpha: 0.28 * a, main: P.deep });
      rootSpikes(k, b, seg(age, 0, 0.5) * smooth(left / 0.5), a, 11);
      tally(k, b, girth(b) * 2.2, left, age + left, 0.8 * a);
      k.light(b, 1.2, 0.3 * a);
      if (left < 0.45 && once(k, 'sank')) k.burst(k.at(b, 0.05), 10, { kind: 'dust', colour: '#8f8a7a', size: 3, life: [0.4, 0.7], speed: [0.2, 0.5], up: [2, 6], gravity: 4 });
    } },
  },
};

/** Where a wound shows on a body, in its own terms, for the i-th drop: across the front, chest to thigh. */
const woundAt = (k: FxScene, b: Body, i: number): P3 => k.local(b, ((i % 3) - 1) * 3.2 + (hashOf(k.seed + 31, i) - 0.5) * 2, 2 + hashOf(k.seed + 32, i), b.tall * (0.32 + 0.5 * ((i * 0.37 + hashOf(k.seed + 33, i) * 0.3) % 1)));
const DROPS = 6;

/** A drop of blood, or what it has become: falling red, stopped and turned to sapphire. `still` nought to one. */
function drops(k: FxScene, b: Body, fall: (i: number) => number, still: number, alpha: number, rise = 0): void {
  if (alpha <= 0.01) return;
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < DROPS; i++) {
    const w = woundAt(k, b, i);
    const p = { x: w.x, y: w.y, z: w.z - fall(i) + rise };
    xs.push(k.sx(p));
    ys.push(k.sy(p));
  }
  const R = 1.6 * k.zoom;
  const inkW = Math.max(0.7, 0.6 * k.zoom);
  const red = still < 0.5;
  k.worldDraw({ x: b.x, y: b.y, z: b.z }, (g) => {
    g.globalAlpha = clamp(alpha);
    for (let i = 0; i < DROPS; i++) {
      const x = xs[i], y = ys[i];
      if (red) {
        // A falling drop: pointed above, faceted below.
        g.beginPath();
        g.moveTo(x, y - R * 1.9);
        g.lineTo(x + R * 0.9, y - R * 0.1);
        g.lineTo(x + R * 0.55, y + R * 0.8);
        g.lineTo(x - R * 0.55, y + R * 0.8);
        g.lineTo(x - R * 0.9, y - R * 0.1);
        g.closePath();
        g.fillStyle = BLOOD.main;
        g.fill();
        g.lineWidth = inkW;
        g.strokeStyle = BLOOD.ink;
        g.stroke();
        g.fillStyle = BLOOD.core;
        g.fillRect(x - R * 0.45, y - R * 0.4, R * 0.35, R * 0.5);
      } else {
        // Stopped: a cut stone where the drop was, its long point still the way it was falling.
        const s = R * (0.8 + 0.4 * still);
        g.beginPath();
        g.moveTo(x, y - s * 1.6);
        g.lineTo(x + s, y);
        g.lineTo(x, y + s * 1.3);
        g.lineTo(x - s, y);
        g.closePath();
        g.fillStyle = P.main;
        g.fill();
        g.fillStyle = P.core;
        g.beginPath();
        g.moveTo(x, y - s * 1.6);
        g.lineTo(x - s, y);
        g.lineTo(x - s * 0.1, y - s * 0.1);
        g.closePath();
        g.fill();
        g.fillStyle = P.deep;
        g.beginPath();
        g.moveTo(x + s, y);
        g.lineTo(x, y + s * 1.3);
        g.lineTo(x + s * 0.05, y + s * 0.05);
        g.closePath();
        g.fill();
        g.beginPath();
        g.moveTo(x, y - s * 1.6);
        g.lineTo(x + s, y);
        g.lineTo(x, y + s * 1.3);
        g.lineTo(x - s, y);
        g.closePath();
        g.lineWidth = inkW;
        g.strokeStyle = P.ink;
        g.stroke();
      }
    }
  }, 5);
  if (!red) for (let i = 0; i < DROPS; i += 2) {
    const w = woundAt(k, b, i);
    k.glow({ x: w.x, y: w.y, z: w.z - fall(i) + rise }, 5, alpha * 0.5);
  }
}

const STILLNESS_REL = 0.55;
/** How far the i-th drop has fallen by `t` of the cast: starting late and slowing to nothing at the release. */
const dropFall = (i: number, t: number): number => {
  const start = 0.1 + i * 0.05;
  return 3.2 * easeOut(seg(t, start, STILLNESS_REL));
};

const stillness: SpellVisual = {
  palette: P,
  cast: { timing: { secs: 1.4, release: STILLNESS_REL, blendOut: 0.2 }, pose: stillnessPose },
  fx: {
    // The wounds bleeding as the hands come down, the drops slowing as they fall.
    charge: (k, t) => {
      const shown = (i: number): number => seg(t, 0.1 + i * 0.05, 0.14 + i * 0.05);
      const a = Math.min(1, shown(0) * 3);
      drops(k, k.caster, (i) => (shown(i) > 0 ? dropFall(i, t) : -100), 0, a);
      k.glow(k.at(k.caster, 0.45), 10, 0.5 * seg(t, 0.3, STILLNESS_REL));
    },
    hit: (k) => {
      k.burst(k.at(k.caster, 0.5), 5, { kind: 'mote', colour: [P.core, P.main], size: 1.4, life: [0.5, 0.9], speed: [0.1, 0.25], up: [2, 6], gravity: 0 });
    },
    // Stopped. Every drop hangs as a stone where it was, a still ring goes out over the ground, and they lift away as motes.
    impact: { secs: 1.5, draw: (k, u) => {
      const b = k.caster;
      const turn = smooth(seg(u, 0, 0.08));
      const go = smooth(seg(u, 0.55, 1));
      drops(k, b, (i) => dropFall(i, 1), turn, 1 - go, go * 4);
      if (u > 0.55 && once(k, 'lift')) for (let i = 0; i < DROPS; i++) k.burst(woundAt(k, b, i), 3, { kind: 'mote', colour: [P.core, P.main], size: 1.6, life: [0.4, 0.8], speed: [0.02, 0.08], up: [6, 14], gravity: 0 });
      const rr = 0.2 + 0.8 * easeOut(seg(u, 0, 0.8));
      k.ring(b, rr, { band: 0.035, alpha: 0.7 * (1 - seg(u, 0.2, 0.9)), glow: 0.4, main: P.core, deep: P.main });
      k.ring(b, rr * 0.62, { band: 0.025, alpha: 0.5 * (1 - seg(u, 0.1, 0.7)), glow: 0, main: P.core, deep: P.main });
      k.light(b, 2.5, 0.5 * (1 - u));
    } },
  },
};

const HEAVY = spellInfo('binder_heavy_limbs');
/** How heavy the weights are drawn: by how much less often it strikes. */
const HEAVY_W = 1.6 + 6 * (1 - (HEAVY?.fx.often ?? 0.7));

/**
 * A plumb weight of dark crystal hanging from `top`: squat, broadest high up and coming to a blunt point under it, so it
 * reads as heavy rather than as one more of the school's long stones. `w` pixels at zoom one either side.
 */
function weight(k: FxScene, top: P3, w: number, turn: number, o: { alpha?: number; at?: P3; bias?: number; glow?: number } = {}): void {
  const tall = (w * 2.2) / HEIGHT_SCALE;
  crystal(k, { ...top, z: top.z - tall }, { ...top, z: top.z + tall * 0.15 }, w, { waist: 0.72, turn, ...LEAD, ink: P.ink, ...o });
}

/** The limbs a weight hangs from: a person's two wrists, a creature's four legs at the knee. */
function limbs(k: FxScene, b: Body): P3[] {
  if (b.figure) return [k.hand(0, b), k.hand(1, b)];
  const w = b.wide * 0.6, l = b.wide * 1.1, z = b.tall * 0.42;
  return [k.local(b, -w, l, z), k.local(b, w, l, z), k.local(b, -w, -l, z), k.local(b, w, -l, z)];
}

const heavyLimbs: SpellVisual = {
  palette: P,
  cast: { timing: { secs: 1.2, release: 0.54, blendOut: 0.18 }, pose: heavyPose },
  fx: {
    // A leaden stone made between the forearms, turning slowly because it is heavy.
    charge: (k, t) => {
      const g = smooth(seg(t, 0.08, 0.3)) * (1 - seg(t, 0.54, 0.56));
      const at = mid3(k.hand(0), k.hand(1), 0.5);
      if (g > 0.01) weight(k, { ...at, z: at.z + 2 + HEAVY_W * g }, HEAVY_W * 1.3 * g, k.now * 1.4, { bias: 4 });
      k.light(at, 1.6, 0.4 * g);
      if (g > 0.3) k.emit(at, 14 * g, { kind: 'mote', colour: [P.main, P.deep], size: 1.4, life: [0.3, 0.6], speed: [0.02, 0.1], up: [-14, -6], gravity: 10, jitter: 0.05 });
    },
    // Lobbed, and falling as a weight falls.
    travel: { secs: (tiles) => 0.25 + tiles * 0.07, draw: (k, u) => {
      const from = mid3(k.hand(0), k.hand(1), 0.5), to = k.at(k.target, 1.1);
      const p = arcAt(from, to, easeIn(u) * 0.55 + u * 0.45, 8 + k.dist * 2.5);
      weight(k, p, HEAVY_W * 1.3, u * 5);
      k.emit(p, 24, { kind: 'mote', colour: [P.main, LEAD.deep], size: 1.4, life: [0.3, 0.6], speed: [0.02, 0.06], up: [-16, -8], gravity: 12 });
      k.light(p, 1.8, 0.5);
    } },
    hit: (k) => {
      k.burst(k.at(k.target, 0.05), 12, { kind: 'dust', colour: '#8f8a7a', size: 2.4, life: [0.35, 0.7], speed: [0.5, 1.1], up: [1, 4], gravity: 3, drag: 0.15 });
      shatterBurst(k, k.at(k.target, 1), 8);
    },
    impact: { secs: 0.5, draw: (k, u) => {
      k.ring(k.target, girth(k.target) * (1 + 2.4 * easeOut(u)), { band: 0.1 * (1 - u), alpha: 0.9 * (1 - u), glow: 0.5, main: LEAD.main, deep: LEAD.deep });
      k.light(k.target, 2.5, 0.6 * (1 - u));
    } },
    // A weight hung off every limb on a short chain, swinging slow; whatever it is lifts them less often.
    linger: { draw: (k, age, left) => {
      const b = k.target;
      const a = life(age, left, 0.05, 0.5);
      const drop = easeBack(seg(age, 0, 0.35));
      const ahead = k.facingDir(b);
      let i = 0;
      for (const clasp of limbs(k, b)) {
        const swing = Math.sin(age * 1.8 + i * 1.7) * 0.035 * (1 - 0.6 * smooth(age / 3));
        const hang = Math.max(clasp.z - b.z - 1.5, 3) * drop;
        const bob = { x: clasp.x + ahead.x * swing, y: clasp.y + ahead.y * swing, z: clasp.z - Math.min(hang, b.tall * 0.3) };
        chain(k, [clasp, mid3(clasp, bob, 0.5), bob], { link: 2.2, alpha: a, at: clasp, glow: 0 });
        weight(k, bob, HEAVY_W * 0.85, age * 0.6 + i, { alpha: a, at: clasp, bias: 1, glow: 0.4 });
        i++;
      }
      if (!k.fast) k.emit(k.at(b, 0.7), 5 * a, { kind: 'mote', colour: [P.main, LEAD.deep], size: 1.4, life: [0.6, 1.0], speed: [0.02, 0.06], up: [-8, -4], gravity: 4, jitter: girth(b) });
      tally(k, b, girth(b) * 2.4, left, age + left, 0.8 * a);
      k.light(b, 1.2, 0.3 * a);
    } },
  },
};

const DULL = spellInfo('binder_dull_claws');
/** What is taken off a blow, nought to one: how blunt the claws are drawn. */
const DULLED = 1 - (DULL?.fx.dealt ?? 0.7);

/** What it strikes with: a person's two hands, a creature's two forefeet. */
function weapons(k: FxScene, b: Body): P3[] {
  if (b.figure) return [k.hand(0, b), k.hand(1, b)];
  const w = b.wide * 0.55, l = b.wide * 1.25, z = 1.6;
  return [k.local(b, -w, l, z), k.local(b, w, l, z)];
}

/** Three claws drawn in the air over it: sharp hooks, going blunt as `dull` comes up, and capped with crystal. */
function clawRune(k: FxScene, at: P3, dull: number, alpha: number, size = 1): void {
  if (alpha <= 0.01) return;
  const x = k.sx(at), y = k.sy(at), Z = k.zoom * size;
  const inkW = Math.max(0.8, 0.7 * k.zoom);
  k.worldDraw({ x: at.x, y: at.y, z: 0 }, (g) => {
    g.globalAlpha = clamp(alpha);
    g.lineJoin = 'round';
    for (let i = -1; i <= 1; i++) {
      const cx = x + i * 3.2 * Z, top = y - 5 * Z, len = 9 * Z * (1 - 0.35 * dull);
      // The claw: a curved blade narrowing to a point; blunted, it is cut off square and a stone sits on the end.
      const tipW = lerp(0, 1.3, dull) * Z;
      g.beginPath();
      g.moveTo(cx - 1.3 * Z, top);
      g.quadraticCurveTo(cx - 1.2 * Z, top + len * 0.6, cx + 1.6 * Z * (1 - dull) - tipW, top + len);
      g.lineTo(cx + 1.6 * Z * (1 - dull) + tipW, top + len);
      g.quadraticCurveTo(cx + 1.4 * Z, top + len * 0.5, cx + 1.3 * Z, top);
      g.closePath();
      g.fillStyle = P.accent;
      g.fill();
      g.lineWidth = inkW;
      g.strokeStyle = P.ink;
      g.stroke();
      if (dull > 0.05) {
        const s = 1.7 * Z * smooth(dull);
        const ty = top + len + s * 0.4;
        g.beginPath();
        g.moveTo(cx, ty - s);
        g.lineTo(cx + s, ty);
        g.lineTo(cx, ty + s);
        g.lineTo(cx - s, ty);
        g.closePath();
        g.fillStyle = P.core;
        g.fill();
        g.stroke();
      }
    }
  }, 6);
  k.glow(at, 8 * size, alpha * 0.4);
}

const dullClaws: SpellVisual = {
  palette: P,
  cast: { timing: { secs: 0.8, release: 0.46, blendOut: 0.2 }, pose: dullPose },
  fx: {
    // Frost off the back of the hand as it sweeps, left to right across the front.
    charge: (k, t) => {
      const u = seg(t, 0.33, 0.5);
      if (u > 0 && u < 1) k.slash(k.caster, { u, from: 1.1, to: -1.3, tilt: Math.PI / 2, reach: 9, up: k.caster.tall * 0.7, width: 4.5, length: 1.6, alpha: 0.9 * (1 - seg(t, 0.46, 0.55)), main: P.main, core: P.core });
      k.glow(k.hand(0), 5, 0.6 * bump(t, 0.2, 0.36, 0.5));
    },
    // The sweep goes on out as a flat crescent of frost, skimming at its chest.
    travel: { secs: (tiles) => 0.1 + tiles * 0.05, draw: (k, u) => {
      const from = k.at(k.caster, 0.62), to = k.heart(k.target);
      const d = STEP(k.caster, k.target);
      const c = mid3(from, to, u);
      const span = 0.32 + 0.1 * u;
      const pts: P3[] = [];
      for (let i = 0; i <= 8; i++) {
        const s = (i / 8) * 2 - 1;
        pts.push({ x: c.x - d.y * s * span - d.x * s * s * 0.14, y: c.y + d.x * s * span - d.y * s * s * 0.14, z: c.z + s * 1.5 });
      }
      k.ribbon(pts, { width: 4.5, taper: 'both', alpha: 0.9, main: P.main, core: P.core });
      k.emit(c, 30, { kind: 'mote', colour: [P.core, P.main], size: 1.4, life: [0.2, 0.4], speed: [0.05, 0.2], up: [-2, 4], gravity: 0, jitter: span * 0.6 });
    } },
    hit: (k) => {
      const at = weapons(k, k.target);
      for (const p of at) shatterBurst(k, p, 5, undefined, 0.6);
      k.burst(k.heart(k.target), 10, { kind: 'mote', colour: [P.core, P.accent], size: 1.8, life: [0.4, 0.7], speed: [0.1, 0.4], up: [4, 12], gravity: 0 });
    },
    // Its claws shown over it as hooks, which blunt and are capped while the forefeet are cased in crystal.
    impact: { secs: 0.6, draw: (k, u) => {
      k.light(k.target, 2.4, 0.6 * (1 - u));
    } },
    linger: { draw: (k, age, left) => {
      const b = k.target;
      const a = life(age, left, 0.05, 0.5);
      const dull = smooth(seg(age, 0.18, 0.5)) * DULLED / 0.3;
      clawRune(k, k.at(b, 1.25), Math.min(1, dull), a * (0.55 + 0.45 * (1 - smooth(seg(age, 1.5, 2.5)))), b.figure ? 0.9 : 1);
      const cap = easeBack(seg(age, 0.25, 0.55));
      let i = 0;
      for (const p of weapons(k, b)) {
        const s = 2.2 * cap;
        crystal(k, { ...p, z: p.z - s * 0.9 }, { ...p, z: p.z + s * 0.9 }, s, { waist: 0.5, alpha: a, turn: age * 0.8 + i * 1.6, glow: 0.4, bias: 2, at: { ...p, z: 0 } });
        i++;
      }
      tally(k, b, girth(b) * 2.2, left, age + left, 0.8 * a);
      k.light(b, 1.2, 0.3 * a);
    } },
  },
};

const TETHER = spellInfo('binder_tether');
const LEASH = TETHER?.fx.leash ?? 3;
/** Where the stake goes in: just short of its feet on the caster's side. */
const stakeAt = (k: FxScene): { x: number; y: number } => {
  if (k.state.sx !== undefined) return { x: k.state.sx, y: k.state.sy };
  const d = k.toward(k.target, k.caster);
  const r = Math.max(0.3, girth(k.target) * 3);
  return { x: k.spot.x + d.x * r, y: k.spot.y + d.y * r };
};
const STAKE = 14;

const tether: SpellVisual = {
  palette: P,
  cast: { timing: { secs: 1.2, release: 0.48, blendOut: 0.18 }, pose: tetherPose },
  fx: {
    // The stake grows out of the fist along the forearm as it is raised.
    charge: (k, t) => {
      const g = smooth(seg(t, 0.1, 0.34)) * (1 - seg(t, 0.48, 0.5));
      if (g <= 0) return;
      const h = k.hand(1), e = k.joint(k.caster, 'elbow1');
      const d = { x: h.x - e.x, y: h.y - e.y, z: h.z - e.z };
      const l = Math.hypot(d.x * UNITS_PER_TILE, d.y * UNITS_PER_TILE, d.z) || 1;
      const s = (STAKE * 0.75 * g) / l, back = (3 * g) / l;
      crystal(k, { x: h.x - d.x * back, y: h.y - d.y * back, z: h.z - d.z * back }, { x: h.x + d.x * s, y: h.y + d.y * s, z: h.z + d.z * s }, 1.6, { waist: 0.2, bias: 4, turn: 0.4 });
      k.light(h, 1.4, 0.4 * g);
    },
    // Thrown point first, a chain running out behind it from the fist.
    travel: { secs: (tiles) => 0.14 + tiles * 0.06, draw: (k, u) => {
      const from = k.hand(1);
      const st = stakeAt(k);
      const to = k.on(st.x, st.y, 2);
      const lift = 4 + k.dist * 1.5;
      const back = Math.min(0.5, 0.7 / Math.max(1, k.dist));
      const tip = arcAt(from, to, u, lift), tail = arcAt(from, to, Math.max(0, u - back), lift);
      crystal(k, tail, tip, 1.7, { waist: 0.2, turn: 0.4 });
      const pts: P3[] = [];
      // The chain sags by how much of it is paid out: none at all while the stake is still at the hand.
      const sag = -Math.min(2 + k.dist, 4 * Math.hypot(tail.x - from.x, tail.y - from.y));
      for (let i = 0; i <= 6; i++) pts.push(arcAt(from, tail, i / 6, sag));
      chain(k, pts, { link: 2.8, alpha: 0.9 });
    } },
    hit: (k) => {
      const st = stakeAt(k);
      k.state.sx = st.x;
      k.state.sy = st.y;
      const p = k.on(st.x, st.y, 0.5);
      k.burst(p, 14, { kind: 'dust', colour: '#8f8a7a', size: 3, life: [0.4, 0.8], speed: [0.3, 0.8], up: [2, 8], gravity: 4 });
      shatterBurst(k, p, 10);
    },
    // How far it may go, rung out over the ground from the stake and left there.
    impact: { secs: 0.7, draw: (k, u) => {
      const st = stakeAt(k);
      const rr = 0.2 + (LEASH - 0.2) * easeOut(seg(u, 0, 0.6));
      k.ring(st, Math.max(0.05, rr), { band: 0.08 * (1 - u) + 0.03, alpha: 0.9 * (1 - u * 0.6), glow: 0.6, turn: u });
      const lines: P3[][] = [];
      for (let i = 0; i < 5; i++) {
        const an = (i / 5) * TAU + hashOf(k.seed, i);
        lines.push(cracked(k, st, { x: st.x + Math.cos(an) * 0.4, y: st.y + Math.sin(an) * 0.4 }, 40 + i, 3, 0.1));
      }
      cracks(k, lines, easeOut(seg(u, 0, 0.3)), { alpha: 1 - smooth(seg(u, 0.5, 1)), width: 1.1 });
      k.light(st, 2.5, 0.7 * (1 - u));
    } },
    linger: { draw: (k, age, left) => {
      const b = k.target;
      const st = stakeAt(k);
      const a = life(age, left, 0.05, 0.6);
      const sink = smooth(left / 0.6);
      const top = k.on(st.x, st.y, STAKE * 0.75 * (0.4 + 0.6 * sink));
      const paint = spike(k, st, STAKE * 0.75 * (0.4 + 0.6 * sink), 2.4, { x: 0, y: 0 }, { alpha: a, turn: 0.4 });
      if (paint) k.worldDraw(k.on(st.x, st.y), paint, 0);
      // The collar, and the chain from the stake to it: slack while it is near the stake, taut as it reaches the end of its leash.
      const neck = k.at(b, b.figure ? 0.8 : 0.62);
      hoop(k, b, neck.z, girth(b) * 0.6, { alpha: a, h: band(b) * 0.6, n: 8, glow: 0.3 });
      const far = Math.hypot(b.x - st.x, b.y - st.y);
      const slack = (1 - clamp(far / LEASH)) * 6 + 1;
      const pts: P3[] = [];
      const from = { ...top, z: top.z - 2 };
      for (let i = 0; i <= 8; i++) {
        const v = i / 8;
        const p = mid3(from, neck, v);
        pts.push({ ...p, z: p.z - slack * 4 * v * (1 - v) });
      }
      const pull = easeOut(seg(age, 0, 0.3));
      chain(k, pts.slice(0, Math.max(2, Math.round(9 * pull))), { link: 2.6, alpha: a });
      k.ring(st, LEASH, { band: 0.04, alpha: 0.4 * a, dash: 3, turn: age * 0.05, glow: 0.35 });
      tally(k, st, 0.4, left, age + left, 0.85 * a);
      k.light(st, 1.2, 0.3 * a);
      glint(k, top, age, 2.2, a);
    } },
  },
};

const BRITTLE = spellInfo('binder_brittle');
/** Branches the cracks run in: one for every fourth part it takes more. */
const BRANCHES = Math.max(3, Math.round(((BRITTLE?.fx.taken ?? 1.25) - 1) * 24));

/** The craze of cracks over a body, in screen pixels from its middle: drawn on it as on glass, `grow` of the way out. */
function crazing(k: FxScene, b: Body, grow: number, alpha: number, sweep: number): void {
  if (alpha <= 0.01 || grow <= 0) return;
  const at = k.heart(b);
  const x0 = k.sx(at), y0 = k.sy(at);
  const rx = k.px(Math.max(5, b.wide * 1.7)), ry = k.hpx(b.tall * 0.36);
  const runs: number[][] = [];
  for (let i = 0; i < BRANCHES; i++) {
    const an = (i / BRANCHES) * TAU + (hashOf(k.seed + 50, i) - 0.5) * 0.8;
    const xy = [x0, y0];
    let x = x0, y = y0;
    for (let j = 1; j <= 3; j++) {
      const v = j / 3;
      if (v > grow + 0.34) break;
      const reach = Math.min(1, grow / v) * v;
      const wob = (hashOf(k.seed + 51 + j, i) - 0.5) * 0.7;
      x = x0 + Math.cos(an + wob) * rx * reach;
      y = y0 + Math.sin(an + wob) * ry * reach;
      xy.push(x, y);
    }
    runs.push(xy);
    // A fork off the middle of each branch.
    if (grow > 0.5 && xy.length >= 6) {
      const fx = xy[2], fy = xy[3];
      const fa = an + (hashOf(k.seed + 56, i) < 0.5 ? -0.9 : 0.9);
      const fl = smooth((grow - 0.5) * 2) * 0.35;
      runs.push([fx, fy, fx + Math.cos(fa) * rx * fl, fy + Math.sin(fa) * ry * fl]);
    }
  }
  const inkW = Math.max(1.4, 1.1 * k.zoom), coreW = Math.max(0.7, 0.5 * k.zoom);
  k.worldDraw({ x: b.x, y: b.y, z: b.z }, (g) => {
    g.globalAlpha = clamp(alpha);
    g.lineJoin = 'miter';
    g.lineCap = 'butt';
    g.beginPath();
    for (const xy of runs) {
      g.moveTo(xy[0], xy[1]);
      for (let i = 2; i < xy.length; i += 2) g.lineTo(xy[i], xy[i + 1]);
    }
    g.lineWidth = inkW + coreW;
    g.strokeStyle = P.ink;
    g.stroke();
    g.lineWidth = coreW;
    g.strokeStyle = P.core;
    g.stroke();
  }, 6);
  // A glint running out along one branch and then the next.
  const which = Math.floor(sweep) % runs.length;
  const run = runs[which];
  if (run && run.length >= 4) {
    const v = sweep % 1;
    const n = run.length / 2 - 1;
    const s = Math.min(n - 1e-3, v * n), q = Math.floor(s) * 2, f = s - Math.floor(s);
    const gx = lerp(run[q], run[q + 2], f), gy = lerp(run[q + 1], run[q + 3], f);
    k.glowDraw((g) => {
      g.globalAlpha = clamp(alpha * Math.sin(v * Math.PI));
      g.fillStyle = P.core;
      const R = 2.4 * k.zoom;
      g.beginPath();
      g.moveTo(gx, gy - R);
      g.lineTo(gx + R * 0.3, gy);
      g.lineTo(gx, gy + R);
      g.lineTo(gx - R * 0.3, gy);
      g.closePath();
      g.fill();
    });
  }
}

const brittle: SpellVisual = {
  palette: P,
  cast: { timing: { secs: 0.75, release: 0.4, blendOut: 0.22 }, pose: brittlePose },
  fx: {
    charge: (k, t) => {
      const g = bump(t, 0.18, 0.34, 0.42);
      k.flare(k.hand(1), 5 * g, g, P.core, k.now * 2);
    },
    // A needle of light, too quick to see anything but its streak.
    travel: { secs: (tiles) => 0.03 + tiles * 0.02, draw: (k, u) => {
      const from = k.hand(1), to = k.heart(k.target);
      const len = Math.min(0.6, 0.4 / Math.max(0.5, k.dist));
      k.ribbon([mid3(from, to, Math.max(0, u - len * 2)), mid3(from, to, Math.max(0, u - len * 0.4))], { width: 1.4, taper: 'start', alpha: 0.7, glow: 0.6 });
      crystal(k, mid3(from, to, Math.max(0, u - len * 0.5)), mid3(from, to, u), 0.8, { waist: 0.8, main: P.core, core: '#ffffff', glow: 0.8 });
    } },
    // A tap, as on glass: a pin of light, and the craze starts out from it.
    hit: (k) => {
      const at = k.heart(k.target);
      k.burst(at, 6, { kind: 'shard', colour: [P.core, P.main], size: 1.4, life: [0.3, 0.6], speed: [0.2, 0.6], up: [4, 12], gravity: 50 });
      k.burst(at, 8, { kind: 'spark', colour: [P.core], size: 1.4, life: [0.1, 0.25], speed: [0.6, 1.4], up: [0, 10], gravity: 0 });
    },
    impact: { secs: 0.5, draw: (k, u) => {
      k.flare(k.heart(k.target), 9, flashOf(u, 0.1), P.core, Math.PI / 4);
      k.light(k.target, 2, 0.6 * (1 - u));
    } },
    linger: { draw: (k, age, left) => {
      const b = k.target;
      const a = life(age, left, 0.02, 0.5);
      crazing(k, b, easeOut(seg(age, 0, 0.4)), a * 0.95, age * 0.8 + 0.3);
      if (!k.fast) k.emit(k.heart(b), 2.5 * a, { kind: 'shard', colour: [P.core, P.main], size: 1.2, life: [0.5, 0.9], speed: [0.05, 0.2], up: [0, 4], gravity: 40, jitter: girth(b) * 0.4, jitterZ: b.tall * 0.25 });
      tally(k, b, girth(b) * 2.1, left, age + left, 0.8 * a);
      k.light(b, 1.2, 0.3 * a);
    } },
  },
};

/** Lock's cage: a six-sided prism of crystal round the body, its panels sliding in from wide as it closes. */
function cage(k: FxScene, b: Body, age: number, a: number, breaking: number): void {
  const n = 6;
  const r = girth(b) * 1.5, H = b.tall * 1.12;
  const cx = k.sx({ x: b.x, y: b.y, z: b.z }), cy = k.sy({ x: b.x, y: b.y, z: b.z });
  const quads: number[] = [], front: boolean[] = [], tone: number[] = [], alph: number[] = [];
  const cap: number[] = [];
  for (let i = 0; i < n; i++) {
    const in1 = easeBack(seg(age, i * 0.04, i * 0.04 + 0.28));
    const out = 1 + 1.2 * (1 - in1) + 0.5 * breaking;
    const a0 = (i / n) * TAU + 0.3, a1 = ((i + 1) / n) * TAU + 0.3;
    const mid = (a0 + a1) / 2;
    const ox = Math.cos(mid) * r * (out - 1), oy = Math.sin(mid) * r * (out - 1);
    const drop = breaking * breaking * H * 0.4 * (0.6 + 0.4 * hashOf(k.seed + 70, i));
    const corner = (an: number, z: number): void => {
      const p = { x: b.x + Math.cos(an) * r + ox, y: b.y + Math.sin(an) * r + oy, z: b.z + z - drop };
      quads.push(k.sx(p), k.sy(p));
    };
    corner(a0, 0);
    corner(a1, 0);
    corner(a1, H);
    corner(a0, H);
    const sy = k.sy({ x: b.x + Math.cos(mid) * r, y: b.y + Math.sin(mid) * r, z: b.z });
    front.push(sy > cy);
    const nx = (k.sx({ x: b.x + Math.cos(mid) * r, y: b.y + Math.sin(mid) * r, z: b.z }) - cx);
    tone.push(nx);
    alph.push(smooth(seg(age, i * 0.04, i * 0.04 + 0.12)));
    const tp = { x: b.x + Math.cos(a0) * r, y: b.y + Math.sin(a0) * r, z: b.z + H };
    cap.push(k.sx(tp), k.sy(tp));
  }
  const inkW = Math.max(0.8, 0.7 * k.zoom);
  const paint = (near: boolean) => (g: CanvasRenderingContext2D): void => {
    g.lineJoin = 'round';
    for (let i = 0; i < n; i++) {
      if (front[i] !== near) continue;
      const q = i * 8;
      g.beginPath();
      g.moveTo(quads[q], quads[q + 1]);
      for (let j = 2; j < 8; j += 2) g.lineTo(quads[q + j], quads[q + j + 1]);
      g.closePath();
      g.globalAlpha = clamp(a * alph[i] * (near ? 0.26 : 0.4));
      g.fillStyle = near ? (tone[i] < -2 ? P.core : P.main) : P.deep;
      g.fill();
      g.globalAlpha = clamp(a * alph[i]);
      g.lineWidth = inkW;
      g.strokeStyle = P.ink;
      g.stroke();
      if (near) {
        // The lit edge of each near panel, and a sheen across it.
        g.strokeStyle = P.core;
        g.lineWidth = Math.max(0.7, 0.55 * k.zoom);
        g.beginPath();
        g.moveTo(quads[q + 6], quads[q + 7]);
        g.lineTo(quads[q], quads[q + 1]);
        g.stroke();
        g.globalAlpha = clamp(a * alph[i] * 0.35);
        g.beginPath();
        g.moveTo(lerp(quads[q + 6], quads[q + 4], 0.15), lerp(quads[q + 7], quads[q + 5], 0.15));
        g.lineTo(lerp(quads[q + 6], quads[q + 4], 0.4), lerp(quads[q + 7], quads[q + 5], 0.4));
        g.lineTo(lerp(quads[q], quads[q + 2], 0.2), lerp(quads[q + 1], quads[q + 3], 0.2));
        g.lineTo(lerp(quads[q], quads[q + 2], 0.05), lerp(quads[q + 1], quads[q + 3], 0.05));
        g.closePath();
        g.fillStyle = P.core;
        g.fill();
      }
    }
    if (near && breaking <= 0) {
      // The lid, once every panel is home.
      const shut = smooth(seg(age, 0.3, 0.42));
      if (shut > 0) {
        g.globalAlpha = clamp(a * shut * 0.3);
        g.beginPath();
        g.moveTo(cap[0], cap[1]);
        for (let i = 2; i < cap.length; i += 2) g.lineTo(cap[i], cap[i + 1]);
        g.closePath();
        g.fillStyle = P.core;
        g.fill();
        g.globalAlpha = clamp(a * shut);
        g.strokeStyle = P.ink;
        g.lineWidth = inkW;
        g.stroke();
      }
    }
  };
  const foot = { x: b.x, y: b.y, z: b.z };
  k.worldDraw(foot, paint(false), -4);
  k.worldDraw(foot, paint(true), 4);
  k.glow(k.at(b, 0.5), b.tall * 1.4, a * 0.25);
}

/** The lock's seal over the cage: a lozenge with a keyhole cut in it, turned shut as it lands. */
function seal(k: FxScene, at: P3, turn: number, alpha: number, size = 4.5): void {
  if (alpha <= 0.01) return;
  const x = k.sx(at), y = k.sy(at), R = size * k.zoom;
  const sq = 0.3 + 0.7 * Math.abs(Math.cos(turn));
  k.worldDraw({ x: at.x, y: at.y, z: 0 }, (g) => {
    g.globalAlpha = clamp(alpha);
    g.beginPath();
    g.moveTo(x, y - R * 1.25);
    g.lineTo(x + R * sq, y);
    g.lineTo(x, y + R * 1.25);
    g.lineTo(x - R * sq, y);
    g.closePath();
    g.fillStyle = P.accent;
    g.fill();
    g.lineWidth = Math.max(0.8, 0.7 * k.zoom);
    g.strokeStyle = P.ink;
    g.stroke();
    g.fillStyle = P.core;
    g.beginPath();
    g.moveTo(x, y - R * 1.25);
    g.lineTo(x - R * sq, y);
    g.lineTo(x - R * sq * 0.3, y - R * 0.1);
    g.closePath();
    g.fill();
    // The keyhole: a head and a slot.
    g.fillStyle = P.ink;
    g.beginPath();
    g.moveTo(x - R * 0.22 * sq, y - R * 0.45);
    g.lineTo(x + R * 0.22 * sq, y - R * 0.45);
    g.lineTo(x + R * 0.22 * sq, y - R * 0.1);
    g.lineTo(x + R * 0.12 * sq, y + R * 0.55);
    g.lineTo(x - R * 0.12 * sq, y + R * 0.55);
    g.lineTo(x - R * 0.22 * sq, y - R * 0.1);
    g.closePath();
    g.fill();
  }, 8);
  k.glow(at, size * 2.6, alpha * 0.5);
}

const lock: SpellVisual = {
  palette: P,
  cast: { timing: { secs: 1.5, release: 0.58, blendOut: 0.16 }, pose: lockPose },
  fx: {
    // A stone in each hand, run together into one between them, which turns as the hands turn the key.
    charge: (k, t) => {
      const l = k.hand(0), r = k.hand(1);
      const meet = smooth(seg(t, 0.2, 0.3));
      const g = smooth(seg(t, 0.06, 0.22)) * (1 - seg(t, 0.58, 0.6));
      if (meet < 1) {
        gemAt(k, mid3(l, r, 0.5 * meet), g * (1 - meet * 0.5), 1.6, k.now * 5);
        gemAt(k, mid3(r, l, 0.5 * meet), g * (1 - meet * 0.5), 1.6, -k.now * 5);
      } else {
        const turn = smooth(seg(t, 0.3, 0.46)) * (Math.PI / 2);
        const c = mid3(l, r, 0.5);
        gemAt(k, c, g, 2.8, turn);
        seal(k, { ...c, z: c.z + 7 }, Math.PI / 2 - turn, smooth(seg(t, 0.3, 0.38)) * (1 - seg(t, 0.56, 0.6)), 3);
      }
      k.light(mid3(l, r, 0.5), 1.8, 0.5 * g);
    },
    // A line of light thrown straight from the fists to it: the bolt shot home.
    travel: { secs: (tiles) => 0.05 + tiles * 0.035, draw: (k, u) => {
      const from = mid3(k.hand(0), k.hand(1), 0.5), to = k.heart(k.target);
      const tip = mid3(from, to, easeOut(u));
      k.beam(from, tip, { width: 2.2, alpha: 0.9 });
      gemAt(k, tip, 1, 2, k.now * 10);
      k.light(tip, 2, 0.6);
    } },
    hit: (k) => {
      shatterBurst(k, k.heart(k.target), 16, undefined, 0.8);
    },
    impact: { secs: 0.7, draw: (k, u) => {
      const from = mid3(k.hand(0), k.hand(1), 0.5), to = k.heart(k.target);
      k.beam(from, to, { width: 2.2 * (1 - u), alpha: 1 - smooth(seg(u, 0, 0.4)) });
      k.ring(k.target, girth(k.target) * (1.5 + 1.6 * easeOut(u)), { band: 0.08 * (1 - u), alpha: 0.8 * (1 - u), glow: 0.6 });
      k.light(k.target, 3, 0.8 * (1 - u));
    } },
    // Shut in a cage of cut crystal for as long as the hold runs, sealed on top; it breaks apart at the end.
    linger: { draw: (k, age, left) => {
      const b = k.target;
      const a = life(age, left, 0.02, 0.35);
      const breaking = 1 - smooth(left / 0.35);
      cage(k, b, age, a, breaking);
      const sealIn = easeBack(seg(age, 0.32, 0.5));
      seal(k, k.at(b, 1.12 + 0.2 * (1 - sealIn)), (1 - sealIn) * Math.PI * 0.5, a * smooth(seg(age, 0.32, 0.4)) * (1 - breaking));
      glint(k, k.at(b, 0.95), age, 1.9, a);
      tally(k, b, girth(b) * 2.3, left, age + left, 0.85 * a);
      k.light(b, 1.2, 0.3 * a);
      if (left < 0.3 && once(k, 'broke')) shatterBurst(k, k.at(b, 0.5), 30, undefined, 1.1);
    } },
  },
};

/**
 * Still Skin's plates: crystal laid along every limb, forearms and shins first since that is where blows are taken, as
 * bones from and to and how broad, in pixels at zoom one; a breastplate goes over them.
 */
const PLATES: ReadonlyArray<readonly [string, string, number]> = [
  ['elbow0', 'wrist0', 2.3], ['elbow1', 'wrist1', 2.3], ['knee0', 'ankle0', 2.6], ['knee1', 'ankle1', 2.6],
  ['arm0', 'elbow0', 2.5], ['arm1', 'elbow1', 2.5], ['hip0', 'knee0', 2.9], ['hip1', 'knee1', 2.9],
];

/** The plates over a body, each grown on in turn by `grow`, only on the side of it toward the viewer; `sweep` runs a light over them. */
function plates(k: FxScene, b: Body, grow: number, a: number, sweep: number): void {
  if (a <= 0.01 || grow <= 0) return;
  const cy = k.sy({ x: b.x, y: b.y, z: b.z });
  const quads: number[] = [];
  const lit: number[] = [];
  const lay = (p0: P3, p1: P3, w: number, i: number, always: boolean): void => {
    const s = easeBack(seg(grow, i * 0.06, i * 0.06 + 0.4));
    if (s <= 0.02) return;
    // Only what is on the side toward the viewer: the far arm's and leg's plates are behind the body.
    if (!always && k.sy({ x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2, z: b.z }) < cy - 1.5 * k.zoom) return;
    const ax = k.sx(p0), ay = k.sy(p0), bx = k.sx(p1), by = k.sy(p1);
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const half = s * 0.82;
    quads.push(mx + (ax - mx) * half, my + (ay - my) * half, mx + (bx - mx) * half, my + (by - my) * half, w * s * k.zoom);
    lit.push(Math.abs(((sweep - i * 0.17) % 1 + 1) % 1 - 0.5) < 0.08 ? 1 : 0);
  };
  PLATES.forEach(([from, to, w], i) => lay(k.joint(b, from), k.joint(b, to), w, i, false));
  // The breastplate, from the breast down to the belt, hidden only when the back is turned.
  const breast = k.chest(b), belt = k.local(b, 0, 1.6, b.tall * 0.5);
  if (k.sy({ x: breast.x, y: breast.y, z: b.z }) >= cy - 0.5 * k.zoom) lay(breast, belt, 4.4, PLATES.length, true);
  if (!quads.length) return;
  const inkW = Math.max(0.7, 0.55 * k.zoom);
  k.worldDraw({ x: b.x, y: b.y, z: b.z }, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'round';
    for (let q = 0, i = 0; q < quads.length; q += 5, i++) {
      const x0 = quads[q], y0 = quads[q + 1], x1 = quads[q + 2], y1 = quads[q + 3], W = quads[q + 4];
      let dx = x1 - x0, dy = y1 - y0;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      // A long lozenge down the limb, its ridge along the bone: the half toward the light lit, the other shaded.
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const lx = mx + dy * W, ly = my - dx * W, rx = mx - dy * W, ry = my + dx * W;
      const leftLit = -(lx - mx) * 0.75 - (ly - my) * 0.65 > 0;
      const [hx, hy, sx, sy] = leftLit ? [lx, ly, rx, ry] : [rx, ry, lx, ly];
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(hx, hy);
      g.lineTo(x1, y1);
      g.closePath();
      g.fillStyle = P.core;
      g.fill();
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(sx, sy);
      g.lineTo(x1, y1);
      g.closePath();
      // The shaded half, lit too while the light runs over it.
      g.fillStyle = lit[i] ? P.core : P.main;
      g.fill();
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(lx, ly);
      g.lineTo(x1, y1);
      g.lineTo(rx, ry);
      g.closePath();
      g.lineWidth = inkW;
      g.strokeStyle = P.ink;
      g.stroke();
    }
  }, 6);
  k.glow(k.at(b, 0.5), 14, a * 0.3);
}

const stillSkin: SpellVisual = {
  palette: P,
  cast: { timing: { secs: 1.1, release: 0.5, blendOut: 0.2 }, pose: stillSkinPose },
  fx: {
    // Frost coming out on the skin while the arms are crossed: the plates begin, small.
    charge: (k, t) => {
      plates(k, k.caster, seg(t, 0.2, 0.5) * 0.35, 0.8 * seg(t, 0.15, 0.25), 0);
      k.glow(k.at(k.caster, 0.6), 9, 0.5 * seg(t, 0.2, 0.5));
    },
    hit: (k) => {
      shatterBurst(k, k.at(k.caster, 0.55), 8, undefined, 0.7);
    },
    impact: { secs: 0.5, draw: (k, u) => {
      k.ring(k.caster, 0.25 + 0.7 * easeOut(u), { band: 0.07 * (1 - u), alpha: 0.9 * (1 - u), glow: 0.5 });
      k.flare(k.chest(), 6 * (1 - u * 0.5), flashOf(u, 0.1), P.core);
      k.light(k.caster, 2.5, 0.6 * (1 - u));
    } },
    // The plates set hard, a light running over them now and then; they flake away when it is over.
    linger: { draw: (k, age, left) => {
      const b = k.caster;
      const a = life(age, left, 0.01, 0.4);
      plates(k, b, 0.35 + 0.65 * seg(age, 0, 0.3), a, age * 0.45);
      tally(k, b, 0.4, left, age + left, 0.8 * a);
      k.light(b, 1.2, 0.3 * a);
      if (left < 0.35 && once(k, 'flaked')) shatterBurst(k, k.at(b, 0.55), 16, undefined, 0.6);
    } },
  },
};

const MIRE = spellInfo('binder_mire');
/** The slick's own pace: its ripples and its edge go at the pace it leaves things at, and slowly. */
const MIRE_PACE = MIRE?.fx.pace ?? 0.6;

/**
 * The mire: a slick of dark glass over the ground `r` tiles round, lobed at its edge, with slow rings and bubbles. All of
 * it shapes on the ground in tiles (`groundShape`), which the stage lays a piece at a time along the tiles: a slick eight
 * tiles across costs what it covers.
 */
function slick(k: FxScene, c: { x: number; y: number }, r: number, age: number, a: number): void {
  if (a <= 0.01 || r <= 0.05) return;
  const n = k.facets(r, 36);
  const t = age * MIRE_PACE;
  const edge: number[] = [];
  const glowPath = new Path2D();
  for (let i = 0; i < n; i++) {
    const an = (i / n) * TAU;
    const wob = 0.95 + 0.05 * Math.sin(an * 5 + t * 1.3 + hashOf(k.seed, 1) * 6) + 0.025 * Math.sin(an * 9 - t);
    const x = c.x + Math.cos(an) * r * wob, y = c.y + Math.sin(an) * r * wob;
    edge.push(x, y);
    const p = { x, y, z: k.ground(x, y) + 0.1 };
    if (i) glowPath.lineTo(k.sx(p), k.sy(p));
    else glowPath.moveTo(k.sx(p), k.sy(p));
  }
  glowPath.closePath();
  // Rings moving outwards through it at the slick's own slow pace.
  const rings: number[][] = [];
  const m = Math.max(12, Math.round(n * 0.6));
  for (let j = 0; j < 3; j++) {
    const v = (t * 0.22 + j / 3) % 1;
    const rr = r * (0.12 + 0.8 * v);
    const ring: number[] = [];
    for (let i = 0; i < m; i++) ring.push(c.x + Math.cos((i / m) * TAU) * rr, c.y + Math.sin((i / m) * TAU) * rr);
    rings.push(ring);
  }
  // Bubbles that swell as little blisters lit on one side and burst as rings opening on the surface. Each stroked layer of a
  // ground shape is cut at every tile edge it crosses, so the slick has three and the blisters none.
  const domes: number[][] = [], lights: number[][] = [], bursts: number[][] = [];
  for (let i = 0; i < 9; i++) {
    const v = (t * 0.5 + hashOf(k.seed + 80, i)) % 1;
    const an = hashOf(k.seed + 81, i) * TAU, rr = r * (0.15 + 0.75 * hashOf(k.seed + 82, i));
    const x = c.x + Math.cos(an) * rr, y = c.y + Math.sin(an) * rr;
    const hex = (rad: number, ox = 0, oy = 0): number[] => {
      const out: number[] = [];
      for (let j = 0; j < 6; j++) out.push(x + ox + Math.cos((j / 6) * TAU) * rad, y + oy + Math.sin((j / 6) * TAU) * rad);
      return out;
    };
    if (v < 0.8) {
      const rad = 0.012 + 0.04 * v;
      domes.push(hex(rad));
      lights.push(hex(rad * 0.35, -rad * 0.3, -rad * 0.3));
    } else bursts.push(hex(0.05 + 0.08 * ((v - 0.8) / 0.2)));
  }
  const Z = k.zoom;
  const inkW = Math.max(1, 0.9 * Z), thin = Math.max(0.6, 0.5 * Z);
  const burst = bursts.length ? 1 : 0;
  k.groundShape(c.x, c.y, r + 0.3, [
    { kind: 'fill', colour: LEAD.deep, alpha: clamp(a * 0.26), paths: [edge], lift: 0.1 },
    { kind: 'stroke', colour: P.accent, alpha: clamp(a * 0.9), width: inkW, paths: [edge], closed: true, lift: 0.1 },
    { kind: 'stroke', colour: P.main, alpha: clamp(a * 0.35), width: Math.max(0.7, 0.55 * Z), paths: rings, closed: true, lift: 0.12 },
    { kind: 'fill', colour: LEAD.main, alpha: clamp(a * 0.85), paths: domes, lift: 0.12 },
    { kind: 'fill', colour: LEAD.core, alpha: clamp(a * 0.85), paths: lights, lift: 0.13 },
    { kind: 'stroke', colour: P.main, alpha: clamp(a * 0.5 * burst), width: thin, paths: bursts, closed: true, lift: 0.12 },
  ]);
  const pic = k.pal.light;
  k.glowDraw((g) => {
    // The rim glows faintly so the slick's edge can be found at night.
    g.globalAlpha = clamp(a * 0.16);
    g.strokeStyle = pic;
    g.lineWidth = 2.6 * Z;
    g.stroke(glowPath);
  });
}

/** What is caught in the mire: a dark ring sucking at its feet, closing and opening at the slick's own slow pace. */
function mired(k: FxScene, b: Body, age: number, a: number, i: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(age * 2.2 * MIRE_PACE + i * 1.7);
  k.disc(b, girth(b) * 2, { alpha: 0.35 * a, main: LEAD.deep });
  k.ring(b, girth(b) * (1.5 + 0.5 * pulse), { band: 0.03, alpha: 0.7 * a, main: P.main, deep: LEAD.main, glow: 0.3 });
  if (!k.fast) k.emit(k.at(b, 0.05), 1.5 * a, { kind: 'drop', colour: [LEAD.main, P.main], size: 1.8, life: [0.3, 0.5], speed: [0.05, 0.15], up: [3, 6], gravity: 30 });
}

const mire: SpellVisual = {
  palette: P,
  cast: { timing: { secs: 1.6, release: 0.55, blendOut: 0.2 }, pose: mirePose },
  fx: {
    // A dark pool welling up under the hands as they come together low.
    charge: (k, t) => {
      const g = smooth(seg(t, 0.15, 0.55));
      slick(k, k.caster, 0.25 + 0.6 * g, k.now, 0.9 * g * (1 - seg(t, 0.55, 0.6)));
      k.glow(mid3(k.hand(0), k.hand(1), 0.5), 6, 0.5 * bump(t, 0.1, 0.25, 0.55));
    },
    hit: (k) => {
      const c = fieldAt(k);
      k.burst({ ...c, z: c.z + 1 }, 24, { kind: 'drop', colour: [LEAD.main, LEAD.deep, P.main], size: 2.6, life: [0.4, 0.8], speed: [0.8, 1.8], up: [4, 12], gravity: 40, drag: 0.2 });
    },
    impact: { secs: 0.4, draw: (k, u) => k.light(fieldAt(k), MIRE_R, 0.5 * (1 - u)) },
    // It spreads out to its reach as thick things do, slowly, and lies where it was cast with rings crawling through it;
    // whatever stands in it has the slick sucking at its feet.
    linger: { on: 'spot', draw: (k, age, left) => {
      const c = fieldAt(k);
      const a = life(age, left, 0.05, 0.8);
      const spread = easeOut(seg(age, 0, 1.4 / MIRE_PACE * 0.6));
      const r = lerp(0.85, MIRE_R, spread);
      slick(k, c, r, age, a);
      caught(k, c, r).forEach((b, i) => mired(k, b, age, a * smooth(seg(age, 0.2, 0.6)), i));
      tally(k, c, 0.45, left, age + left, 0.8 * a);
      k.light(c, r, 0.22 * a);
      if (!k.fast) k.emit({ ...c, z: c.z + 0.5 }, 5 * a, { kind: 'mote', colour: [P.main, P.accent], size: 1.4, life: [1.0, 1.6], speed: [0.02, 0.05], up: [1, 3], gravity: 0, drag: 0.5, jitter: r * 0.7 });
    } },
  },
};

const MASS_ARMS = 8;

/** The cracks out from the caster, one per arm of the star, the same every frame. */
function massLines(k: FxScene, c: { x: number; y: number }): P3[][] {
  const out: P3[][] = [];
  for (let i = 0; i < MASS_ARMS; i++) {
    const an = (i / MASS_ARMS) * TAU + (hashOf(k.seed + 90, i) - 0.5) * 0.4;
    // From a little way out, so the cracks start at the palms rather than running up through the caster.
    out.push(cracked(k, { x: c.x + Math.cos(an) * 0.25, y: c.y + Math.sin(an) * 0.25 }, { x: c.x + Math.cos(an) * MASS_R, y: c.y + Math.sin(an) * MASS_R }, 90 + i, 6, 0.2));
  }
  return out;
}

const massRoot: SpellVisual = {
  palette: P,
  cast: { timing: { secs: 1.4, release: 0.5, blendOut: 0.2 }, pose: massRootPose },
  fx: {
    charge: (k, t) => {
      const g = smooth(seg(t, 0.12, 0.36)) * (1 - seg(t, 0.46, 0.5));
      gemAt(k, k.hand(0), g, 1.6, k.now * 6);
      gemAt(k, k.hand(1), g, 1.6, -k.now * 6);
      k.light(k.at(k.caster, 1), 2, 0.5 * g);
    },
    hit: (k) => {
      const c = fieldAt(k);
      k.burst({ ...c, z: c.z + 1 }, 12, { kind: 'dust', colour: '#8f8a7a', size: 2, life: [0.3, 0.6], speed: [1.4, 2.6], up: [2, 5], gravity: 4, drag: 0.15 });
      shatterBurst(k, { ...c, z: c.z + 3 }, 16, undefined, 1.2);
      k.flash(0.05);
    },
    impact: { secs: 0.9, draw: (k, u) => {
      const c = fieldAt(k);
      k.ring(c, 0.2 + MASS_R * easeOut(seg(u, 0, 0.55)), { band: 0.14 * (1 - u), alpha: 0.9 * (1 - u * u), glow: 0.6 });
      k.light(c, MASS_R + 1, 0.8 * (1 - u));
    } },
    // Cracks race out as far as it reaches and crystal bursts up all along them, and round the feet of whatever stands there.
    linger: { on: 'spot', draw: (k, age, left) => {
      const c = fieldAt(k);
      const a = life(age, left, 0.02, 0.6);
      const run = easeOut(seg(age, 0, 0.5));
      const lines = massLines(k, c);
      cracks(k, lines, run, { alpha: a * (0.45 + 0.55 * (1 - smooth(seg(age, 0.8, 2.5)))), width: 1.1, glow: 0.6 * (1 - smooth(seg(age, 0.4, 1.1))) });
      const sink = smooth(left / 0.6);
      for (let i = 0; i < MASS_ARMS; i++) {
        const line = lines[i];
        const paints: Array<(g: CanvasRenderingContext2D) => void> = [];
        let sortAt: P3 | null = null;
        for (const at of [0.42, 0.72, 0.95]) {
          const g = easeBack(seg(run, at - 0.05, at + 0.25)) * sink;
          if (g <= 0.02) continue;
          const s = at * (line.length - 1);
          const p = mid3(line[Math.floor(s)], line[Math.min(line.length - 1, Math.floor(s) + 1)], s % 1);
          for (let j = 0; j < 3; j++) {
            const an = j * 2.1 + hashOf(k.seed + 95 + i, j) * 2;
            const o = 0.09 * (j ? 1 : 0);
            const base = { x: p.x + Math.cos(an) * o, y: p.y + Math.sin(an) * o };
            const h = (j ? 4.5 : 7.5) * (0.8 + 0.4 * hashOf(k.seed + 96 + i, j)) * g * (0.85 + 0.3 * at);
            const paint = spike(k, base, h, j ? 1.3 : 1.8, { x: Math.cos(an) * 0.04, y: Math.sin(an) * 0.04 }, { alpha: a, turn: i + j });
            if (paint) paints.push(paint);
          }
          sortAt = p;
        }
        if (sortAt && paints.length) k.worldDraw(sortAt, (g) => { for (const p of paints) p(g); }, 0);
      }
      // Each creature caught is rooted when the crack running its way reaches it.
      caught(k, c, MASS_R).forEach((b, i) => {
        const reached = seg(run, Math.hypot(b.x - c.x, b.y - c.y) / MASS_R - 0.05, 1);
        if (reached > 0) rootSpikes(k, b, seg(age, 0.5 * Math.hypot(b.x - c.x, b.y - c.y) / MASS_R, 1) * sink, a, 60 + i * 5, 5);
      });
      tally(k, c, 0.45, left, age + left, 0.8 * a);
      if (left < 0.6 && once(k, 'sank')) k.burst({ ...c, z: c.z + 0.5 }, 16, { kind: 'dust', colour: '#8f8a7a', size: 3, life: [0.4, 0.8], speed: [0.6, 1.6], up: [2, 6], gravity: 4 });
    } },
  },
};

/** The noose's cord wound up round a body: a helix `turns` round, from its ankles to `top` of its height, the near half over it. */
function windings(k: FxScene, b: Body, top: number, turns: number, a: number, spin: number): void {
  if (a <= 0.01 || top <= 0.02) return;
  const r = girth(b) * 1.05;
  const n = Math.max(16, Math.round(turns * 12));
  const cy = k.sy({ x: b.x, y: b.y, z: b.z });
  const near: number[][] = [], far: number[][] = [];
  let cur: number[] = [], curNear = false;
  for (let i = 0; i <= n; i++) {
    const v = i / n;
    const an = spin + v * turns * TAU;
    const x = b.x + Math.cos(an) * r, y = b.y + Math.sin(an) * r;
    const isNear = k.sy({ x, y, z: b.z }) > cy;
    const p = { x, y, z: b.z + 1 + (b.tall * top - 1) * v };
    const sx = k.sx(p), sy = k.sy(p);
    if (i === 0) curNear = isNear;
    if (isNear !== curNear) {
      cur.push(sx, sy);
      (curNear ? near : far).push(cur);
      cur = [sx, sy];
      curNear = isNear;
    } else cur.push(sx, sy);
  }
  if (cur.length >= 4) (curNear ? near : far).push(cur);
  const Z = k.zoom;
  const paint = (runs: number[][], isNear: boolean) => (g: CanvasRenderingContext2D): void => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    for (const xy of runs) {
      g.moveTo(xy[0], xy[1]);
      for (let i = 2; i < xy.length; i += 2) g.lineTo(xy[i], xy[i + 1]);
    }
    g.lineWidth = Math.max(2, 2.2 * Z);
    g.strokeStyle = P.ink;
    g.stroke();
    g.lineWidth = Math.max(1, 1.2 * Z);
    g.strokeStyle = isNear ? P.main : P.deep;
    g.stroke();
    if (isNear) {
      g.lineWidth = Math.max(0.6, 0.45 * Z);
      g.strokeStyle = P.core;
      g.stroke();
    }
  };
  const foot = { x: b.x, y: b.y, z: b.z };
  k.worldDraw(foot, paint(far, false), -3);
  k.worldDraw(foot, paint(near, true), 3);
  k.glow(k.at(b, top * 0.5), b.tall * 0.8, a * 0.25);
}

const snare: SpellVisual = {
  palette: P,
  cast: { timing: { secs: 1.2, release: 0.55, blendOut: 0.16 }, pose: snarePose },
  fx: {
    // The focus answering in the left hand, and a loop of cord drawn in the air by the right.
    charge: (k, t) => {
      const g = smooth(seg(t, 0.05, 0.2)) * (1 - seg(t, 0.55, 0.6));
      gemAt(k, k.hand(0), g, 1.5, k.now * 3);
      k.light(k.hand(0), 1.5, 0.4 * g);
      const draw = seg(t, 0.1, 0.42);
      const keep = 1 - seg(t, 0.42, 0.5);
      if (draw > 0 && keep > 0) {
        // Level, so it reads as a loop from every side: a noose held open before the chest, closing up behind the hand.
        const c = k.local(k.caster, 2, 8, k.caster.tall * 0.62);
        const r = 0.11 * (1 - 0.5 * seg(t, 0.42, 0.5));
        const pts: P3[] = [];
        const m = Math.max(2, Math.round(16 * draw));
        const h = k.hand(1);
        const start = Math.atan2(h.y - c.y, h.x - c.x);
        for (let i = 0; i <= m; i++) {
          const ph = start - (i / 16) * TAU;
          pts.push({ x: c.x + Math.cos(ph) * r, y: c.y + Math.sin(ph) * r, z: c.z + Math.sin((i / 16) * Math.PI) * 1.5 });
        }
        pts.reverse();
        k.ribbon(pts, { width: 1.8, taper: 'start', alpha: 0.9 * keep, glow: 0.6 });
      }
    },
    // The noose skims low over the ground, open, its cord trailing back to the hand.
    travel: { secs: (tiles) => 0.12 + tiles * 0.07, draw: (k, u) => {
      const from = k.hand(1);
      // Out of the hand and down, to skim the last of the way a hand's breadth off the ground.
      const c = arcAt(from, k.on(k.spot.x, k.spot.y, 3), easeOut(u), 2);
      const r = 0.08 + 0.32 * smooth(u);
      hoop(k, c, c.z, r, { h: 0.9, n: 10, turn: u * 4, alpha: 0.95, glow: 0.6 });
      const d = k.toward(k.caster, k.spot);
      const near = { x: c.x - d.x * r, y: c.y - d.y * r, z: c.z };
      k.string(from, near, { sag: 1 + k.dist * 0.4 * u, width: 1.2, main: P.core, glow: 0.5, alpha: 0.95 });
    } },
    hit: (k) => {
      k.burst(k.at(k.target, 0.05), 10, { kind: 'dust', colour: '#8f8a7a', size: 2.6, life: [0.4, 0.7], speed: [0.2, 0.5], up: [2, 6], gravity: 4 });
      k.burst(k.at(k.target, 0.1), 10, { kind: 'mote', colour: [P.core, P.main], size: 1.6, life: [0.3, 0.6], speed: [0.3, 0.6], up: [2, 8], gravity: 0 });
    },
    impact: { secs: 0.45, draw: (k, u) => {
      k.light(k.target, 2.4, 0.6 * (1 - u));
    } },
    // The noose pulled shut on the feet, then the cord running up and round it to the shoulders: one thing, held where it stands.
    linger: { draw: (k, age, left) => {
      const b = k.target;
      const a = life(age, left, 0.02, 0.45);
      const shut = easeBack(seg(age, 0, 0.18));
      const wind = easeOut(seg(age, 0.12, 0.6)) * (1 - 0.6 * (1 - smooth(left / 0.45)));
      hoop(k, b, b.z + 1.2, girth(b) * lerp(2.6, 1.1, shut), { h: 1, n: 10, alpha: a, glow: 0.5, turn: age * 0.2 });
      windings(k, b, 0.78 * wind, 3.5 * wind, a, (1 - wind) * 3);
      // The knot, a small sapphire on the cord at the front.
      const kn = k.local(b, 0, b.wide * 1.3, b.tall * 0.4 * wind + 1);
      if (wind > 0.3) gemAt(k, kn, smooth((wind - 0.3) / 0.4), 1.6, age * 0.8, { alpha: a, bias: 6 });
      tally(k, b, girth(b) * 2.2, left, age + left, 0.8 * a);
      k.light(b, 1.2, 0.3 * a);
      if (left < 0.25 && once(k, 'loose')) k.burst(k.at(b, 0.4), 14, { kind: 'mote', colour: [P.core, P.main], size: 1.6, life: [0.3, 0.6], speed: [0.2, 0.6], up: [2, 10], gravity: 0 });
    } },
  },
};

/** The still field's dome, `r` tiles round and `h` height units high: ribs over it and two rings round it, the far half behind what is in it. */
function dome(k: FxScene, c: { x: number; y: number; z: number }, r: number, h: number, a: number, turn: number): void {
  if (a <= 0.01 || r <= 0.05) return;
  const ribs = k.fast ? 6 : 8;
  const cy = k.sy({ x: c.x, y: c.y, z: c.z });
  const near: number[] = [], far: number[] = [];
  const at = (an: number, v: number): [number, number, boolean] => {
    // v nought at the rim, one at the crown; a squashed sphere.
    const rr = r * Math.cos((v * Math.PI) / 2), z = c.z + h * Math.sin((v * Math.PI) / 2);
    const x = c.x + Math.cos(an) * rr, y = c.y + Math.sin(an) * rr;
    return [k.sx({ x, y, z }), k.sy({ x, y, z }), k.sy({ x, y, z: c.z }) > cy - 0.5];
  };
  const seg2 = (p: [number, number, boolean], q: [number, number, boolean]): void => {
    (p[2] && q[2] ? near : far).push(p[0], p[1], q[0], q[1]);
  };
  for (let i = 0; i < ribs; i++) {
    const an = turn + (i / ribs) * TAU;
    let prev = at(an, 0);
    for (let j = 1; j <= 5; j++) {
      const cur = at(an, j / 5);
      seg2(prev, cur);
      prev = cur;
    }
  }
  for (const v of [0, 0.42, 0.78]) {
    const m = ribs * 3;
    let prev = at(turn, v);
    for (let i = 1; i <= m; i++) {
      const cur = at(turn + (i / m) * TAU, v);
      seg2(prev, cur);
      prev = cur;
    }
  }
  const Z = k.zoom;
  const paint = (segs: number[], isNear: boolean) => (g: CanvasRenderingContext2D): void => {
    g.globalAlpha = clamp(a * (isNear ? 0.85 : 0.5));
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i < segs.length; i += 4) {
      g.moveTo(segs[i], segs[i + 1]);
      g.lineTo(segs[i + 2], segs[i + 3]);
    }
    g.lineWidth = Math.max(1.2, 0.95 * Z);
    g.strokeStyle = P.ink;
    g.stroke();
    g.lineWidth = Math.max(0.6, 0.45 * Z);
    g.strokeStyle = isNear ? P.core : P.main;
    g.stroke();
  };
  // Sorted at its far edge and its near edge, so whatever stands inside it is between the two halves.
  const d = k.toward({ x: 0, y: 0 }, { x: 1, y: 1 });
  k.worldDraw({ x: c.x - d.x * r, y: c.y - d.y * r, z: c.z }, paint(far, false), -2);
  k.worldDraw({ x: c.x + d.x * r, y: c.y + d.y * r, z: c.z }, paint(near, true), 2);
  const pic = k.pal.light;
  k.glowDraw((g) => {
    g.globalAlpha = clamp(a * 0.16);
    g.strokeStyle = pic;
    g.lineWidth = 2.2 * Z;
    g.lineCap = 'round';
    g.beginPath();
    for (const segs of [near, far]) for (let i = 0; i < segs.length; i += 4) {
      g.moveTo(segs[i], segs[i + 1]);
      g.lineTo(segs[i + 2], segs[i + 3]);
    }
    g.stroke();
    g.lineCap = 'butt';
  });
}

/** Motes hanging in the field where they were when it closed: not drifting, not falling. Seeded, so they stay put. */
function frozenMotes(k: FxScene, c: { x: number; y: number; z: number }, r: number, h: number, a: number, age: number): void {
  if (a <= 0.01) return;
  const n = k.fast ? 8 : 16;
  const xs: number[] = [], ys: number[] = [], ss: number[] = [];
  for (let i = 0; i < n; i++) {
    const an = hashOf(k.seed + 110, i) * TAU, rr = r * Math.sqrt(hashOf(k.seed + 111, i)) * 0.9;
    const z = c.z + 2 + (h * 0.7) * hashOf(k.seed + 112, i) * Math.cos((rr / r) * Math.PI / 2);
    const p = { x: c.x + Math.cos(an) * rr, y: c.y + Math.sin(an) * rr, z };
    xs.push(k.sx(p));
    ys.push(k.sy(p));
    // A very slow pulse, out of step with each other: time has nearly stopped, not quite.
    ss.push(0.55 + 0.45 * Math.sin(age * 0.7 + hashOf(k.seed + 113, i) * TAU));
  }
  const Z = k.zoom;
  k.glowDraw((g) => {
    g.fillStyle = P.core;
    for (let i = 0; i < n; i++) {
      g.globalAlpha = clamp(a * ss[i]);
      const s = (1.2 + 0.8 * ss[i]) * Z;
      g.beginPath();
      g.moveTo(xs[i], ys[i] - s * 1.8);
      g.lineTo(xs[i] + s * 0.5, ys[i]);
      g.lineTo(xs[i], ys[i] + s * 1.8);
      g.lineTo(xs[i] - s * 0.5, ys[i]);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(xs[i] - s * 1.3, ys[i]);
      g.lineTo(xs[i], ys[i] - s * 0.4);
      g.lineTo(xs[i] + s * 1.3, ys[i]);
      g.lineTo(xs[i], ys[i] + s * 0.4);
      g.closePath();
      g.fill();
    }
  });
}

const stillfield: SpellVisual = {
  palette: P,
  // The arms held out, still, for as long as the field holds: the Binder is holding it.
  cast: { timing: { secs: 1.7, release: 0.5, blendOut: 0.16 }, pose: stillfieldPose, hold: { at: 0.62 } },
  fx: {
    // A diamond forming where the hands meet overhead, brightening as they press.
    charge: (k, t) => {
      const c = mid3(k.hand(0), k.hand(1), 0.5);
      const g = smooth(seg(t, 0.22, 0.44)) * (1 - seg(t, 0.5, 0.52));
      gemAt(k, { ...c, z: c.z + 2 }, g, 2.8, k.now * 2, { main: P.core, core: '#ffffff', deep: P.main });
      k.light(c, 2, 0.6 * g);
      if (g > 0.5) k.emit(c, 30 * g, { kind: 'mote', colour: [P.core, P.accent], size: 1.4, life: [0.2, 0.4], speed: [0.2, 0.5], up: [-6, 6], gravity: 0, drag: 0.05 });
    },
    hit: (k) => {
      const head = k.at(k.caster, 1.15);
      k.burst(head, 24, { kind: 'spark', colour: [P.core, P.main, P.accent], size: 1.8, life: [0.2, 0.4], speed: [FIELD_R * 1.2, FIELD_R * 2.4], up: [-8, 10], gravity: 0, drag: 0.02 });
      k.flash(0.07);
    },
    // The field shuts down over everything near: a dome rung out fast, then still.
    impact: { secs: 0.5, draw: (k, u) => {
      const c = fieldAt(k);
      k.flare(k.at(k.caster, 1.15), 10 * (1 - u * 0.6), flashOf(u, 0.08), P.core);
      k.ring(c, FIELD_R * easeOut(u), { band: 0.12 * (1 - u) + 0.02, alpha: 1 - u, glow: 0.6 });
      k.light(c, FIELD_R + 1, 0.8 * (1 - u * 0.5));
    } },
    linger: { on: 'spot', draw: (k, age, left) => {
      const c = { ...fieldAt(k), tall: k.caster.tall };
      const a = life(age, left, 0.02, 0.5);
      const out = easeOut(seg(age, 0, 0.35));
      const r = FIELD_R * out, h = c.tall * 2.1 * out;
      dome(k, { x: c.x, y: c.y, z: c.z }, r, h, a * (0.45 + 0.55 * (1 - smooth(seg(age, 0.3, 1.2)))), 0.2);
      frozenMotes(k, { x: c.x, y: c.y, z: c.z }, FIELD_R, c.tall * 2.1, a * smooth(seg(age, 0.3, 0.6)), age);
      k.ring(c, Math.max(0.05, r), { band: 0.05, alpha: 0.6 * a, glow: 0.5 });
      // Whatever is caught stops where it stands: a band of frost round it and its own stone over it, not turning.
      caught(k, c, r).forEach((b, i) => {
        const s = smooth(seg(age, 0.15 + 0.05 * i, 0.4 + 0.05 * i));
        hoop(k, b, b.z + b.tall * 0.45, girth(b) * lerp(1.8, 1.05, easeBack(s)), { alpha: a * s, h: band(b) * 0.7, n: 8, glow: 0.3, main: P.core, core: '#ffffff' });
        gemAt(k, k.at(b, 1.2), s, 1.6, 0.4 + i, { alpha: a, bias: 6 });
      });
      tally(k, c, 0.45, left, age + left, 0.8 * a);
      k.light(c, FIELD_R + 0.5, 0.3 * a);
      if (left < 0.4 && once(k, 'thaw')) k.burst({ ...c, z: c.z + c.tall * 0.8 }, 20, { kind: 'mote', colour: [P.core, P.main], size: 1.6, life: [0.4, 0.8], speed: [0.4, FIELD_R * 0.6], up: [-4, 4], gravity: 6 });
    } },
  },
};

export const BINDER: Record<string, SpellVisual> = {
  // Bind (bolt, on enemy, lasts 3.06286 s): an enemy within 8 tiles of you is held at 40%, neither moving nor striking.
  binder_bind: bind,
  // Shatter (bolt, on enemy): shatter at 100% on an enemy within 8 tiles of you, or shatter at 200% on one that is held.
  binder_shatter: shatter,
  // Root (bolt, on enemy, lasts 8 s): an enemy within 8 tiles of you is rooted for 8 s: it cannot move, but strikes.
  binder_root: root,
  // Stillness (buff, on self): every wound on you stops bleeding.
  binder_stillness: stillness,
  // Heavy Limbs (bolt, on enemy, lasts 10 s): an enemy within 8 tiles of you strikes 30% less often.
  binder_heavy_limbs: heavyLimbs,
  // Dull Claws (bolt, on enemy, lasts 10 s): every blow an enemy within 8 tiles of you lands is 30% smaller.
  binder_dull_claws: dullClaws,
  // Tether (bolt, on enemy, lasts 15 s): an enemy within 8 tiles of you cannot go more than 3 tiles from where it stood.
  binder_tether: tether,
  // Brittle (bolt, on enemy, lasts 10 s): an enemy within 8 tiles of you takes 25% more from everything that strikes it.
  binder_brittle: brittle,
  // Lock (bolt, on enemy, lasts 7.65714 s): an enemy within 8 tiles of you is held at 100%, neither moving nor striking.
  binder_lock: lock,
  // Still Skin (buff, on self, lasts 10 s): for 10 s you take 20% less from every blow.
  binder_still_skin: stillSkin,
  // Mire (nova, on self, 4 tiles round, lasts 10 s): every enemy within 4 tiles of you goes at 60% of its pace for 10 s.
  binder_mire: mire,
  // Mass Root (nova, on self, 4 tiles round, lasts 6 s): every enemy within 4 tiles of you is rooted for 6 s.
  binder_mass_root: massRoot,

  /* ---- the arcane, out of a focus ---- */
  // Snare (bolt, on enemy, lasts 7.65714 s): One thing, standing exactly where it is.
  snare,
  // Still field (nova, on self, 3 tiles round, lasts 4.78571 s): Everything close enough, for rather less time each.
  stillfield,
};
