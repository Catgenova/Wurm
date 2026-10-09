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
import { armToward, figureStance, standFeet } from '../figure';
import { armOut, euler, one } from './poses';

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
/**
 * A body's measures in its own terms, in height units: `len` from its middle to its chest (half its length, along the way
 * it faces) and `side` from its middle to its flank. A creature's are read off its own model -- how far ahead of its feet
 * its head is (`k.muzzle`) -- so a fetter, a weight or a cage is laid on a wolf's legs and a bear's alike; a person is a
 * person.
 */
function build(k: FxScene, b: Body): { len: number; side: number } {
  if (b.figure) return { len: 1.8, side: 3 };
  const m = k.muzzle(b), d = k.facingDir(b);
  const ahead = ((m.x - b.x) * d.x + (m.y - b.y) * d.y) * UNITS_PER_TILE;
  const len = ahead > 1.5 ? ahead * 0.72 : b.wide * 1.1;
  return { len, side: clamp(b.wide * 0.42, 1.2, Math.max(1.2, len * 0.42)) };
}
/** Where a creature's neck is, the root of it between the shoulders and the head: a collar's place. A person's throat. */
function neckOf(k: FxScene, b: Body): P3 {
  if (b.figure) return k.at(b, 0.8);
  const { len } = build(k, b);
  return mid3(k.local(b, 0, len * 0.55, b.tall * 0.55), k.muzzle(b), 0.35);
}
/** A light tone by night and the ink by day for an edge that must still read after dark. */
const nightInk = (k: FxScene, light: string): string => (k.night > 0.45 ? light : k.pal.ink);
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

/**
 * A crystal standing up out of the ground at `base`, `h` height units tall and leaning `lean` tiles: a root, a stake. Its
 * foot is cut flat on the ground, so no buried point shows under it.
 */
function spike(k: FxScene, base: { x: number; y: number }, h: number, w: number, lean: { x: number; y: number }, o: Tones & { alpha?: number; turn?: number } = {}): ((g: CanvasRenderingContext2D) => void) | null {
  if (h <= 0.3) return null;
  const foot = k.on(base.x, base.y, 0);
  const tip = k.on(base.x + lean.x, base.y + lean.y, h);
  return crystalPaint(k, foot, tip, w, { ...o, waist: 0 });
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
  // Brighter by night, when the shaded half of a fetter is lost under the dark.
  if (gl > 0) k.glow(mid, (rx / k.zoom) * 1.3, a * gl * (0.3 + 0.25 * k.night));
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

/**
 * A chain laid level round a body `up` height units over its feet, fitted to it -- long along the way it faces, close at
 * its flanks -- `open` times as wide as a snug fit: the far run behind the body, the near run in front, and a clasp
 * stone where it is nearest the viewer. Bind's fetter, in the links its throw paid out.
 */
function chainLoop(k: FxScene, b: Body, up: number, open: number, a: number, o: { link?: number; clasp?: number; spin?: number } = {}): void {
  if (a <= 0.01) return;
  const { len, side } = build(k, b);
  const L = (len + 1.2) * open, S = (side + 1) * open;
  const n = k.fast ? 14 : 20;
  // From the point furthest from the viewer round, so the far half is one run and the near half another.
  const ring: P3[] = [];
  let far = 0, farY = Infinity;
  for (let i = 0; i < n; i++) {
    const an = (i / n) * TAU + (o.spin ?? 0);
    const p = k.local(b, Math.cos(an) * S, Math.sin(an) * L, up);
    ring.push(p);
    const y = k.sy({ x: p.x, y: p.y, z: b.z });
    if (y < farY) { farY = y; far = i; }
  }
  const pts: P3[] = [];
  for (let i = 0; i <= n; i++) pts.push(ring[(far + i) % n]);
  const { back, front } = k.aroundBody(b, pts);
  const foot = { x: b.x, y: b.y, z: b.z };
  const link = o.link ?? 2.6;
  const glow = 0.4 + 0.5 * k.night;
  for (const run of back) chain(k, run, { link, alpha: a, at: foot, bias: -3, main: P.deep, glow: 0 });
  for (const run of front) chain(k, run, { link, alpha: a, at: foot, bias: 3, glow });
  const cl = o.clasp ?? 0;
  if (cl > 0.01) {
    let near = ring[0], nearY = -Infinity;
    for (const p of ring) {
      const y = k.sy({ x: p.x, y: p.y, z: b.z });
      if (y > nearY) { nearY = y; near = p; }
    }
    gemAt(k, near, cl, 1.5, 0.6, { alpha: a, bias: 5 });
  }
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

/**
 * Cracks laid on the ground: the inked split and the light in it, `u` of each drawn from its start. Several in one record.
 * `taper` draws the last kink of each at half the width, so a crack runs out to nothing rather than ending as a tube.
 */
function cracks(k: FxScene, lines: readonly (readonly P3[])[], u: number, o: { alpha?: number; width?: number; glow?: number; colour?: string; taper?: boolean } = {}): void {
  const a = o.alpha ?? 1;
  if (a <= 0.01 || u <= 0) return;
  // As shapes on the ground in tiles, which the stage cuts along the tiles' edges and lays a piece at a time: they cost what
  // they cover. A path on the screen as well, for the glow over them.
  const paths: number[][] = [], tips: number[][] = [];
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
    if (o.taper && run.length >= 6) {
      tips.push(run.slice(-4));
      paths.push(run.slice(0, -2));
    } else if (run.length >= 4) paths.push(run);
  }
  if (!paths.length && !tips.length) return;
  const W = (o.width ?? 1) * k.zoom;
  const inkW = Math.max(1, 0.7 * k.zoom);
  const core = o.colour ?? k.pal.core;
  const layers: GroundLayer[] = [
    { kind: 'stroke', colour: k.pal.ink, alpha: clamp(a), width: W + inkW, paths, lift: 0.2, join: 'miter' },
    { kind: 'stroke', colour: core, alpha: clamp(a), width: W * 0.6, paths, lift: 0.2, join: 'miter' },
  ];
  if (tips.length) layers.push(
    { kind: 'stroke', colour: k.pal.ink, alpha: clamp(a), width: W * 0.5 + inkW * 0.8, paths: tips, lift: 0.2, join: 'miter' },
    { kind: 'stroke', colour: core, alpha: clamp(a), width: W * 0.3, paths: tips, lift: 0.2, join: 'miter' },
  );
  k.groundShape((x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0) / 2 + 0.3, layers);
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
  // Round an area's rim, a few tiles out, the stones are drawn twice as big, to be read at the size an area is seen at.
  const big = r > 1 ? 2 : 1;
  const da = Math.min((TAU / n) * 0.3, (0.034 * big) / r), dr = Math.min(0.032 * big, r * 0.12);
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
    // The lit stones carry a night rim, so how long is left still reads after dark.
    { kind: 'fill', colour: k.pal.main, alpha: clamp(alpha), paths: on, lift, glow: 0.8 * k.night },
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
 * The creatures an area binding is drawn on -- not the caster's own companion -- nearest first and at most `most` of them:
 * those the island said it reached (`k.struck`), wherever they are, or where it did not say, those standing in it now.
 * Pass `age` to leave out each one once what the island said it gave that one is over (`k.secsOn`), as it lets go.
 */
function caught(k: FxScene, c: { x: number; y: number }, r: number, most = 5, age?: number): Body[] {
  const pet = k.companion;
  return (k.hit ? k.struck(r, c) : k.bodiesWithin(r, c, ['creature']))
    .filter((b) => age === undefined || age < k.secsOn(b, Infinity))
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

/**
 * How far down on the knee to ask for, so the body is seen to rise steadily from `from` to the end of the cast. The stage
 * scales what is asked by the blend-out, and a kneel lets the body down mostly in its last part (half a kneel is all but
 * standing), so asked plainly the rise came in a tenth of a second. This asks for a kneel that eases off slowly and divides
 * the blend back out (the figure takes no more than a whole kneel).
 */
function kneelHeld(t: number, from: number, blendOut: number, down: number): number {
  if (t < from) return down;
  const s = seg(t, from, 1);
  const want = 1 - s * s * s;
  const blend = smooth((1 - t) / blendOut);
  return blend > 0.02 ? want / blend : 0;
}

/** Bind: an open hand thrown out at it, closed into a fist at the reach, and the fist hauled back -- a grab at a distance. */
const bindPose: CastPose = (r, t) => {
  // Hauled back past the body to the hip, the elbow driven behind: the chain comes in low, never across the face.
  r.arm[1] = euler(t, [[0, REST_ARM], [0.3, [36, 34, -24]], [0.45, [92, 6, 2]], [0.58, [-10, 18, 10]], [0.76, [-12, 18, 10]], [1, REST_ARM]]);
  r.elbow[1] = one(t, [[0, 22], [0.3, 112], [0.45, 4], [0.58, 95], [0.76, 92], [1, 24]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.3, [30, 0, 0]], [0.45, [-12, 0, 0]], [0.58, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.open[1] = false;
  // Fingers spread and hooked as it goes out, shut hard into the fist at the reach: the grab.
  r.shape = [undefined, { claw: one(t, [[0, 0], [0.14, 1], [0.44, 1], [0.47, 0]]) }];
  r.arm[0] = euler(t, [[0, REST_ARM], [0.3, [34, 20, 6]], [0.45, [-12, 22, 0]], [0.76, [-8, 20, 0]], [1, REST_ARM]]);
  r.elbow[0] = one(t, [[0, 20], [0.3, 46], [0.45, 24], [1, 22]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.3, [4, 0, -22]], [0.45, [-6, 0, 14]], [0.58, [6, 0, -4]], [0.76, [6, 0, -4]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.3, [3, 0, -4]], [0.45, [-10, 0, 4]], [0.58, [11, 0, 0]], [0.76, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.3, [-6, 0, 10]], [0.45, [-6, 0, -8]], [0.76, [-4, 0, -4]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.3, [-2, 2, 0]], [0.45, [22, 3, 0]], [0.58, [18, 3, 0]], [1, [3, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.45, 20], [0.58, 8], [1, 5]]);
  r.leg[1] = euler(t, [[0, [0, 2, 0]], [0.45, [-12, 2, 0]], [0.58, [-6, 2, 0]], [1, [-2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [0.3, 10], [0.45, 8], [0.58, 22], [0.76, 20], [1, 5]]);
};

/** Shatter: the fist cocked high by the ear while the open left hand sights along the way, then hammered down at it, the knees giving. */
const shatterPose: CastPose = (r, t) => {
  // Cocked as a thrower cocks: the upper arm out to the side and up, the forearm folded up so the fist is by the right ear,
  // pointed rather than keyed past level (where a roll "out" carries the fist over the face).
  const cock = armToward(1, [0.85, -0.25, 0.45], [-0.35, -0.1, 1]), cocked = armToward(1, [0.8, -0.4, 0.45], [-0.35, -0.2, 1]);
  r.arm[1] = euler(t, [[0, REST_ARM], [0.28, cock], [0.36, cocked], [0.42, [70, 6, 12]], [0.55, [48, 8, 16]], [0.74, [46, 8, 14]], [1, REST_ARM]]);
  r.elbow[1] = one(t, [[0, 22], [0.28, 104], [0.36, 112], [0.42, 8], [0.55, 18], [0.74, 20], [1, 24]]);
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
  // Raised up and ahead beside the head (pointed: keyed past level with a roll out it crossed over the face).
  r.arm[1] = euler(t, [[0, REST_ARM], [0.3, armToward(1, [0.4, 0.35, 0.85])], [0.5, [40, 8, 0]], [0.76, [40, 8, 0]], [1, REST_ARM]]);
  r.elbow[1] = one(t, [[0, 22], [0.3, 46], [0.5, 6], [0.76, 6], [1, 24]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.3, [10, 0, 0]], [0.5, [-70, 0, 0]], [0.76, [-70, 0, 0]], [1, [0, 0, 0]]]);
  r.arm[0] = euler(t, [[0, REST_ARM], [0.3, [40, 30, 0]], [0.5, [10, 40, 0]], [0.76, [10, 40, 0]], [1, REST_ARM]]);
  r.elbow[0] = one(t, [[0, 20], [0.3, 30], [0.5, 20], [1, 22]]);
  r.open = [false, false];
  r.shape = [{ flat: one(t, [[0.15, 0], [0.3, 0.8], [0.86, 0.8], [1, 0]]) }, { flat: one(t, [[0, 0], [0.12, 1], [0.86, 1], [1, 0]]) }];
  // Down onto the right knee as the hand comes down, and the palm put flat on the ground ahead, the back bowing as far as it
  // takes to get it there.
  // Up out of the kneel slowly: the kneel is held to the end and the long blend-out (a third of the cast) lifts the body
  // off it, the palm leaving the ground first. Taken out over the blend-out as well, the rise was all in its first half.
  r.kneel = kneelHeld(t, 0.7, 0.32, one(t, [[0, 0], [0.34, 0], [0.48, 1]]));
  r.reach = [undefined, { at: [1.4, 6.5, 0.6], stoop: true, w: one(t, [[0, 0], [0.38, 0], [0.5, 1], [0.7, 1], [0.88, 0]]) }];
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
    // Hoisted nearly straight up, the elbows only a little bent, the stone between the hands over the head.
    r.arm[k] = euler(t, [[0, REST_ARM], [0.22, [14, 20, 24]], [0.42, [168, 12, 0]], [0.5, [170, 12, 0]], [0.56, [96, 10, 8]], [0.7, [44, 10, 6]], [0.84, [42, 10, 6]], [1, REST_ARM]]);
    r.elbow[k] = one(t, [[0, 20], [0.22, 96], [0.42, 30], [0.5, 26], [0.56, 12], [0.7, 14], [0.84, 16], [1, 22]]);
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
    // Hauled in to the sternum, the elbows back at the sides: fists before the breastbone, well under the chin.
    r.arm[k] = euler(t, [[0, REST_ARM], [0.28, [68, 50, 12]], [0.46, [70, 50, 12]], [0.58, [-6, 22, 20]], [0.84, [-6, 22, 20]], [1, REST_ARM]]);
    r.elbow[k] = one(t, [[0, 20], [0.28, 36], [0.46, 34], [0.58, 90], [0.84, 90], [1, 22]]);
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
const mirePose: CastPose = (r, t, c) => {
  const palms = { flat: one(t, [[0, 0], [0.14, 1], [0.86, 1], [1, 0]]) };
  r.shape = [palms, palms];
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, REST_ARM], [0.25, [14, 26, 30]], [0.55, [40, 68, -4]], [0.82, [36, 70, -4]], [1, REST_ARM]]);
    r.elbow[k] = one(t, [[0, 20], [0.25, 72], [0.55, 10], [0.82, 12], [1, 22]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.25, [-50, 0, 0]], [0.55, [-60, 0, 0]], [0.82, [-56, 0, 0]], [1, [0, 0, 0]]]);
    r.open[k] = false;
  }
  // Down into the squat for real: the feet set wide and the legs solved to them, the hips let down onto knees bent past a
  // right angle's half. Asked as leg and knee turns alone, the body was stood back up on its feet and the bend hardly showed.
  const sq = one(t, [[0, 0], [0.25, 0.7], [0.55, 1], [0.82, 1], [1, 0]]);
  const feet = figureStance(c.look);
  standFeet(r, [
    [feet[0][0] - 2.4 * sq, feet[0][1] + 0.6 * sq, feet[0][2]],
    [feet[1][0] + 2.4 * sq, feet[1][1] + 0.6 * sq, feet[1][2]],
  ], { on: 0, bend: 4 + 78 * sq, look: c.look });
  r.spine = euler(t, [[0, [0, 0, 0]], [0.25, [-20, 0, 0]], [0.55, [-28, 0, 0]], [0.82, [-26, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.4, [-4, 0, 6]], [0.55, [-4, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.25, [6, 0, 0]], [0.55, [14, 0, 0]], [0.82, [12, 0, 0]], [1, [0, 0, 0]]]);
};

/** Mass Root: both arms flung up as the body rises onto its toes, a small hop, and down onto a knee with both palms slammed flat. */
const massRootPose: CastPose = (r, t) => {
  const w = one(t, [[0, 0], [0.44, 0], [0.5, 1], [0.7, 1], [0.88, 0]]);
  for (let k = 0; k < 2; k++) {
    // Flung up and wide, opened away from the body (keyed past level with a roll out, they crossed over the head).
    r.arm[k] = euler(t, [[0, REST_ARM], [0.25, armOut(k, 140, 32)], [0.38, armOut(k, 155, 24)], [0.5, [34, 16, 0]], [0.78, [36, 16, 0]], [1, REST_ARM]]);
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
  r.kneel = kneelHeld(t, 0.72, 0.3, one(t, [[0, 0], [0.44, 0], [0.5, 1]]));
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
        if (shut > 0 && shut < 1) k.flare(k.at(k.target, 0.34 + (0.26 * i) / Math.max(1, HOOPS - 1)), 6, 0.8 * flashOf(shut, 0.3), P.core, i);
      }
      k.light(k.target, 2.5, 0.7 * (1 - u));
    } },
    linger: { draw: (k, age, left) => {
      const b = k.target;
      const a = life(age, left, 0.05, 0.35);
      const total = age + left;
      const r0 = girth(b);
      for (let i = 0; i < HOOPS; i++) {
        const up = b.tall * (0.34 + (0.26 * i) / Math.max(1, HOOPS - 1));
        // The chain that paid out, wrapped round it: closing from wide with a snap that overshoots, then held tight with the
        // least breath of strain, a clasp stone set on each loop as it shuts.
        const shut = easeBack(seg(age, i * 0.06, i * 0.06 + 0.22));
        const strain = 1 + 0.03 * Math.sin(age * 9 + i * 2);
        const loosen = 1 + 0.6 * (1 - smooth(left / 0.35));
        chainLoop(k, b, up, lerp(2.4, 1, shut) * strain * loosen, a * smooth(seg(age, i * 0.06, i * 0.06 + 0.06)), { spin: (1 - shut) * 2 + i * 0.5, clasp: smooth(seg(age, 0.2 + i * 0.06, 0.32 + i * 0.06)) });
      }
      glint(k, k.at(b, 0.5), age + k.seed % 7, 1.6, a);
      tally(k, b, r0 * 2, left, total, 0.8 * a);
      k.light(b, 1.2, (0.3 + 0.2 * k.night) * a);
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
      const h = k.hand(1), e = k.joint(k.caster, 'elbow1');
      // Up and back along the forearm, out of the back of the fist, fanned a little: clear of the face, and the way the
      // blow will come down from.
      const fx = (h.x - e.x) * UNITS_PER_TILE, fy = (h.y - e.y) * UNITS_PER_TILE, fz = h.z - e.z;
      const fl = Math.hypot(fx, fy, fz) || 1;
      const back = k.toward(k.target, k.caster);
      for (let i = 0; i < 3; i++) {
        const len = (i === 1 ? 5.5 : 4) * g;
        const sx = (i - 1) * 0.35;
        const dx = fx / fl + back.x * 0.5 - back.y * sx, dy = fy / fl + back.y * 0.5 + back.x * sx, dz = fz / fl + 0.3;
        const dl = Math.hypot(dx, dy, dz) || 1;
        const tip = { x: h.x + (dx / dl) * len / UNITS_PER_TILE, y: h.y + (dy / dl) * len / UNITS_PER_TILE, z: h.z + (dz / dl) * len };
        crystal(k, h, tip, 1.6 * g, { waist: 0.3, turn: i, glow: 0.6, bias: 4, main: P.core, core: '#ffffff', deep: P.accent });
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
      // Splits, not tubes: hairline, faintly lit, running out to nothing.
      cracks(k, lines, easeOut(seg(u, 0, 0.25)), { alpha: 1 - smooth(seg(u, 0.4, 1)), width: 0.7, glow: 0.4, taper: true });
      // On something already held, the hold breaks with it: its fetter bursts outward as the spurs fly.
      if (m > 1) hoop(k, b, b.z + b.tall * 0.45, girth(b) * (1 + 2.5 * out), { alpha: fade, h: band(b), turn: u * 2, n: 10 });
      // A pin of light where it went in, small enough that the thing struck is still seen through the break.
      k.flare(at, Math.min(8, 6 * Math.sqrt(m)) * (1 - u * 0.6), 0.6 * flashOf(u, 0.08), P.core, u);
      k.light(b, 3.5, 0.9 * (1 - u));
    } },
  },
};

/** Root's crystal is the school's blue lit pale rather than white: it is stone come up out of the ground, not light. */
const ROOT_CORE = '#b9d8ff';

/** Root's crystal, by where it comes up round the feet: the far ones before the body, the near ones after it. */
function rootSpikes(k: FxScene, b: Body, grow: number, a: number, salt: number, n = 6, glow = true): void {
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
  if (glow) k.glow(k.at(b, 0.15), 14, a * 0.35);
}

/** Root's crack, from where the palm went down to the feet: more kinks the further it runs, so it stays a crack at range. */
const rootLine = (k: FxScene): P3[] =>
  cracked(k, { x: k.state.fx ?? k.caster.x, y: k.state.fy ?? k.caster.y }, k.spot, 3, 4 + Math.ceil(k.dist * 2), 0.18);

const root: SpellVisual = {
  palette: P,
  cast: { timing: { secs: 1.1, release: 0.5, blendOut: 0.32 }, pose: rootPose },
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
      const line = rootLine(k);
      cracks(k, [line], u, { taper: true });
      const along = (v: number): P3 => {
        const s = clamp(v) * (line.length - 1), i = Math.min(line.length - 2, Math.floor(s));
        return mid3(line[i], line[i + 1], s - i);
      };
      const head = along(u);
      // A cluster of crystal bursting up at the crack's head, and the last few left standing behind it for a moment, sinking
      // as the head runs on: the crack reads as a thing travelling, from any distance.
      const back = Math.min(0.12, 0.45 / Math.max(1, k.dist));
      const paints: Array<(g: CanvasRenderingContext2D) => void> = [];
      for (let i = 0; i < 4; i++) {
        const v = u - i * back;
        if (v < 0) break;
        const p = along(v);
        const h = 7 * (1 - i * 0.2) * (i ? 1 : easeOut(clamp(u * 6)));
        const side = (hashOf(k.seed + 7, i) - 0.5) * 0.08;
        // A stout stone and a smaller one leaning off it: a cluster, not a needle.
        const big = spike(k, { x: p.x + side, y: p.y - side }, h, 2.8 - i * 0.3, { x: side * 0.5, y: 0 }, { turn: i * 1.7 + 0.3, core: ROOT_CORE });
        const small = spike(k, { x: p.x - side - 0.03, y: p.y + side + 0.02 }, h * 0.6, 2 - i * 0.2, { x: -0.05, y: 0.03 }, { turn: i * 1.7 + 1.1, core: ROOT_CORE });
        if (small) paints.push(small);
        if (big) paints.push(big);
      }
      // Back to front, as one record at the head.
      if (paints.length) k.worldDraw(head, (g) => { for (let i = paints.length - 1; i >= 0; i--) paints[i](g); }, 0);
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
      const fadeLine = 1 - smooth(age / 1.2);
      if (fadeLine > 0) cracks(k, [rootLine(k)], 1, { alpha: fadeLine, taper: true });
      k.disc(b, girth(b) * 1.7, { alpha: 0.28 * a, main: P.deep });
      rootSpikes(k, b, seg(age, 0, 0.5) * smooth(left / 0.5), a, 11);
      tally(k, b, girth(b) * 2.2, left, age + left, 0.8 * a);
      k.light(b, 1.2, 0.3 * a);
      if (left < 0.45 && once(k, 'sank')) k.burst(k.at(b, 0.05), 10, { kind: 'dust', colour: '#8f8a7a', size: 3, life: [0.4, 0.7], speed: [0.2, 0.5], up: [2, 6], gravity: 4 });
    } },
  },
};

/** Where a wound shows on a body, in its own terms, for the i-th drop: across the front, chest to thigh. */
const woundAt = (k: FxScene, b: Body, i: number): P3 => k.local(b, ((i % 3) - 1) * 1.5 + (hashOf(k.seed + 31, i) - 0.5) * 1, 1.3 + 0.4 * hashOf(k.seed + 32, i), b.tall * (0.32 + 0.5 * ((i * 0.37 + hashOf(k.seed + 33, i) * 0.3) % 1)));
const DROPS = 6;

/** A drop of blood, or what it has become: falling red, stopped and turned to sapphire. `still` nought to one. */
function drops(k: FxScene, b: Body, fall: (i: number) => number, still: number, alpha: number, rise = 0): void {
  if (alpha <= 0.01) return;
  const xs: number[] = [], ys: number[] = [];
  // Which side of the body each wound is on, by its own ground point against the body's: the wounds are on the front, so
  // from behind they are hidden by the back rather than drawn over it.
  const cy = k.sy({ x: b.x, y: b.y, z: b.z });
  const before: number[] = [], behind: number[] = [];
  for (let i = 0; i < DROPS; i++) {
    const w = woundAt(k, b, i);
    const p = { x: w.x, y: w.y, z: w.z - fall(i) + rise };
    xs.push(k.sx(p));
    ys.push(k.sy(p));
    (k.sy({ x: w.x, y: w.y, z: b.z }) >= cy ? before : behind).push(i);
  }
  const R = 2 * k.zoom;
  const inkW = Math.max(0.7, 0.6 * k.zoom);
  const red = still < 0.5;
  const paint = (list: number[]) => (g: CanvasRenderingContext2D): void => {
    g.globalAlpha = clamp(alpha);
    for (const i of list) {
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
  };
  const foot = { x: b.x, y: b.y, z: b.z };
  if (behind.length) k.worldDraw(foot, paint(behind), -2);
  if (before.length) k.worldDraw(foot, paint(before), 5);
  // Light over the stones that can be seen (glow goes over everything, so none for those behind the body).
  if (!red) for (let j = 0; j < before.length; j += 2) {
    const i = before[j], w = woundAt(k, b, i);
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
    // Stopped. The drops hang red and dead still for a beat (a tenth of a second), then each turns to a cut stone where it
    // hangs with a glint, one after another; a single quiet ring goes out, and the stones lift away as motes.
    impact: { secs: 1.5, draw: (k, u) => {
      const b = k.caster;
      const s = u * 1.5;
      const turn = smooth(seg(s, 0.1, 0.22));
      const go = smooth(seg(u, 0.55, 1));
      drops(k, b, (i) => dropFall(i, 1), turn, 1 - go, go * 4);
      for (let i = 0; i < DROPS; i += 2) {
        const at = 0.14 + i * 0.03;
        const gl = flashOf(seg(s, at, at + 0.2), 0.3);
        if (gl > 0.01) {
          const w = woundAt(k, b, i);
          k.flare({ x: w.x, y: w.y, z: w.z - dropFall(i, 1) }, 4, 0.9 * gl, P.core, i);
        }
      }
      if (u > 0.55 && once(k, 'lift')) for (let i = 0; i < DROPS; i++) k.burst(woundAt(k, b, i), 3, { kind: 'mote', colour: [P.core, P.main], size: 1.6, life: [0.4, 0.8], speed: [0.02, 0.08], up: [6, 14], gravity: 0 });
      const rr = 0.2 + 0.6 * easeOut(seg(s, 0.12, 1.1));
      k.ring(b, rr, { band: 0.025, alpha: 0.4 * seg(s, 0.1, 0.16) * (1 - seg(u, 0.3, 0.9)), glow: 0.2, main: P.core, deep: P.main });
      k.light(b, 1.6, 0.45 * (1 - u));
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
  const tall = weightTall(w);
  // Its edges inked by day and drawn in the lead's own light tone by night, when the dark stone would be lost.
  crystal(k, { ...top, z: top.z - tall }, { ...top, z: top.z + tall * 0.15 }, w, { waist: 0.72, turn, ...LEAD, ink: nightInk(k, LEAD.core), ...o });
}
/** How tall a weight `w` pixels broad is drawn, in height units. */
const weightTall = (w: number): number => (w * 2.2) / HEIGHT_SCALE;
/** The least a weight hangs under its clasp, in height units: enough chain to be seen at play size. */
const HANG = 3;

/** The limbs a weight hangs from: a person's two wrists, a creature's four legs at the knee, read off its own build. */
function limbs(k: FxScene, b: Body): P3[] {
  if (b.figure) return [k.hand(0, b), k.hand(1, b)];
  const { len, side } = build(k, b);
  // Spread a full side's width apart, so the four weights hang clear of one another.
  const w = side * 1.0, l = len * 0.7, z = b.tall * 0.3;
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
      // Held between the hands, gripped at its broad top: the stone's waist sits where the hands are.
      const w = HEAVY_W * 1.3 * g;
      if (g > 0.01) weight(k, { ...at, z: at.z + weightTall(w) * 0.3 }, w, k.now * 1.4, { bias: 4 });
      k.light(at, 1.6, 0.4 * g);
      if (g > 0.3) k.emit(at, 10 * g, { kind: 'drop', colour: [LEAD.main, LEAD.deep], size: 1.6, life: [0.3, 0.5], speed: [0.02, 0.08], up: [-6, -2], gravity: 60, jitter: 0.05 });
    },
    // Lobbed, and falling as a weight falls.
    travel: { secs: (tiles) => 0.25 + tiles * 0.07, draw: (k, u) => {
      const from = mid3(k.hand(0), k.hand(1), 0.5), to = k.at(k.target, 1.1);
      const p = arcAt(from, to, easeIn(u) * 0.55 + u * 0.45, 8 + k.dist * 2.5);
      weight(k, p, HEAVY_W * 1.3, u * 5);
      k.emit(p, 18, { kind: 'drop', colour: [LEAD.main, LEAD.deep], size: 1.6, life: [0.3, 0.5], speed: [0.02, 0.06], up: [-8, -2], gravity: 60 });
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
      const ww = HEAVY_W * (b.figure ? 0.85 : 0.55), wt = weightTall(ww);
      let i = 0;
      for (const clasp of limbs(k, b)) {
        // A slow, heavy swing that lags behind the limb and dies away: dragged, not dangling.
        const ph = age * 1.6 + i * 1.7;
        const swing = (Math.sin(ph) * 0.045 + Math.sin(ph * 0.5 + 1) * 0.015) * (1 - 0.6 * smooth(age / 3));
        // Hung on a chain HANG units long, its point always clear of the ground: a weight, not a stake. A creature's knee
        // is too low for that, so its chain is clasped higher on the flank over the leg, never above the middle of it.
        const lowest = b.z + (b.figure ? 1.5 : 0.3) + wt;
        const top = { ...clasp, z: Math.max(clasp.z, Math.min(lowest + HANG, b.z + b.tall * 0.42)) };
        const hang = Math.max(HANG, top.z - lowest) * drop;
        const bob = { x: top.x + ahead.x * swing, y: top.y + ahead.y * swing, z: Math.max(lowest, top.z - hang) };
        const foot = { x: clasp.x, y: clasp.y, z: b.z };
        chain(k, [top, mid3(top, bob, 0.5), bob], { link: 2.4, alpha: a, at: foot, glow: 0 });
        weight(k, bob, ww, age * 0.4 + i, { alpha: a, at: foot, bias: 1, glow: 0 });
        i++;
      }
      // One light over all the weights rather than one each, and more of it by night.
      k.glow(k.at(b, b.figure ? 0.4 : 0.22), b.figure ? 10 : 12, a * (0.3 + 0.3 * k.night));
      if (!k.fast) k.emit(k.at(b, 0.3), 3 * a, { kind: 'drop', colour: [LEAD.main, LEAD.deep], size: 1.4, life: [0.3, 0.5], speed: [0.01, 0.04], up: [-4, -1], gravity: 50, jitter: girth(b) });
      tally(k, b, girth(b) * 2.4, left, age + left, 0.8 * a);
      k.light(b, 1.2, 0.3 * a);
    } },
  },
};

const DULL = spellInfo('binder_dull_claws');
/** What is taken off a blow, nought to one: how blunt the claws are drawn. */
const DULLED = 1 - (DULL?.fx.dealt ?? 0.7);

/** What it strikes with: a person's two hands, a creature's two forefeet, read off its own build. */
function weapons(k: FxScene, b: Body): P3[] {
  if (b.figure) return [k.hand(0, b), k.hand(1, b)];
  const { len, side } = build(k, b);
  const w = side * 0.7, l = len * 0.72, z = 0.6;
  return [k.local(b, -w, l, z), k.local(b, w, l, z)];
}

/**
 * A paw's strike drawn before it: three claws fanned out and bowed like a raking blow, sharp hooks that round off at the
 * tips as `dull` comes up -- blunted, not capped. `side` (one or minus one) is which way they rake on the screen.
 */
function clawRune(k: FxScene, at: P3, dull: number, alpha: number, size = 1, side = 1): void {
  if (alpha <= 0.01) return;
  const x = k.sx(at), y = k.sy(at), Z = k.zoom * size;
  const inkW = Math.max(0.8, 0.6 * k.zoom);
  k.worldDraw({ x: at.x, y: at.y, z: 0 }, (g) => {
    g.globalAlpha = clamp(alpha);
    g.lineJoin = 'round';
    for (let i = -1; i <= 1; i++) {
      // Fanned by a fifth of a right angle each way from a common root below, and bowed toward the way they rake.
      const an = -Math.PI / 2 + i * 0.36 + side * 0.15;
      const ux = Math.cos(an), uy = Math.sin(an), px = -uy * side, py = ux * side;
      const len = 9 * Z * (1 - 0.2 * dull), root = 3 * Z;
      const bx = x + ux * root + i * 1.2 * Z, by = y + uy * root;
      const tx = bx + ux * len, ty = by + uy * len;
      const bow = 2.4 * Z;
      const mx = (bx + tx) / 2 + px * bow, my = (by + ty) / 2 + py * bow;
      const wide = 1.5 * Z;
      // The tip: a point, or rounded off to a stub as wide as the claw's middle.
      const r = lerp(0.05, 0.75, dull) * wide;
      g.beginPath();
      g.moveTo(bx - px * wide, by - py * wide);
      g.quadraticCurveTo(mx - px * wide * 0.6, my - py * wide * 0.6, tx - px * r, ty - py * r);
      if (r > 0.3) g.arc(tx, ty, r, Math.atan2(-py, -px), Math.atan2(py, px), side < 0);
      else g.lineTo(tx, ty);
      g.lineTo(tx + px * r, ty + py * r);
      g.quadraticCurveTo(mx + px * wide * 0.3, my + py * wide * 0.3, bx + px * wide * 0.4, by + py * wide * 0.4);
      g.closePath();
      g.fillStyle = dull > 0.5 ? P.main : P.accent;
      g.fill();
      g.lineWidth = inkW;
      g.strokeStyle = nightInk(k, P.core);
      g.stroke();
      // Its lit edge, along the outside of the bow.
      g.beginPath();
      g.moveTo(bx + px * wide * 0.2, by + py * wide * 0.2);
      g.quadraticCurveTo(mx + px * wide * 0.1, my + py * wide * 0.1, tx, ty);
      g.lineWidth = Math.max(0.6, 0.45 * k.zoom);
      g.strokeStyle = P.core;
      g.stroke();
    }
  }, 6);
  k.glow(at, 8 * size, alpha * 0.35);
}

/** Where Dull Claws' strike is drawn: before the creature at its shoulder's height, where its blows come from, not over its head. */
const clawAt = (k: FxScene, b: Body): P3 => (b.figure ? k.local(b, 0, 7, b.tall * 0.55) : k.local(b, 0, build(k, b).len * 1.6 + 3, b.tall * 0.45));

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
      k.burst(k.heart(k.target), 10, { kind: 'mote', colour: [P.core, P.accent], size: 1.8, life: [0.4, 0.7], speed: [0.1, 0.4], up: [4, 12], gravity: 0 });
    },
    // The moment it is blunted: its claws shown as a raking strike before it, the tips rounding off one after another with a
    // snap of crystal off each foot as it is cased.
    impact: { secs: 0.6, draw: (k, u) => {
      const b = k.target;
      if (u > 0.3 && once(k, 'snap')) for (const p of weapons(k, b)) shatterBurst(k, p, 6, undefined, 0.5);
      const flick = flashOf(seg(u, 0.3, 0.7), 0.25);
      if (flick > 0.01) k.flare(clawAt(k, b), 6, 0.7 * flick, P.core, u * 3);
      k.light(b, 2, 0.6 * (1 - u));
    } },
    // The rune lasts only while it is news (two seconds); what stays is the crystal cased over its feet and the tally.
    linger: { draw: (k, age, left) => {
      const b = k.target;
      const a = life(age, left, 0.05, 0.5);
      const dull = smooth(seg(age, 0.18, 0.42)) * Math.min(1, DULLED / 0.3);
      const rune = smooth(seg(age, 0, 0.1)) * (1 - smooth(seg(age, 1.2, 2)));
      if (rune > 0.01) clawRune(k, clawAt(k, b), dull, a * rune, b.figure ? 0.8 : 0.9, k.sx(k.caster) < k.sx(b) ? 1 : -1);
      const cap = easeBack(seg(age, 0.25, 0.5));
      const foot = { x: b.x, y: b.y, z: b.z };
      let i = 0;
      for (const p of weapons(k, b)) {
        // A blunt cap of dull lead round each forefoot: broadest near its top and cut off flat just above, a stub over the
        // paw rather than a point (a point would say sharper, and Root's).
        const s = (b.figure ? 2 : 1.7) * cap;
        const lo = b.figure ? p.z - s * 0.5 : b.z;
        crystal(k, { ...p, z: lo }, { ...p, z: lo + s * (b.figure ? 1 : 0.7) }, s * 1.1, { waist: 0.75, alpha: a, turn: 0.4 + i * 1.6, glow: 0, bias: 2, at: foot, ...LEAD, ink: nightInk(k, LEAD.core) });
        i++;
      }
      k.glow(k.at(b, 0.1), 9, a * (0.3 + 0.3 * k.night));
      tally(k, b, girth(b) * 2.2, left, age + left, 0.8 * a);
      k.light(b, 1.2, (0.3 + 0.2 * k.night) * a);
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
/** Where it stood when the tether took it, kept: what its leash is measured from (no more than `LEASH` tiles off). */
const leashAt = (k: FxScene): { x: number; y: number } => {
  if (k.state.ox === undefined) {
    k.state.ox = k.spot.x;
    k.state.oy = k.spot.y;
  }
  return { x: k.state.ox, y: k.state.oy };
};

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
      leashAt(k);
      const p = k.on(st.x, st.y, 0.5);
      k.burst(p, 14, { kind: 'dust', colour: '#8f8a7a', size: 3, life: [0.4, 0.8], speed: [0.3, 0.8], up: [2, 8], gravity: 4 });
      shatterBurst(k, p, 10);
    },
    // How far it may go, rung out over the ground from where it stood and left there.
    impact: { secs: 0.7, draw: (k, u) => {
      const st = stakeAt(k), o = leashAt(k);
      const rr = 0.2 + (LEASH - 0.2) * easeOut(seg(u, 0, 0.6));
      k.ring(o, Math.max(0.05, rr), { band: 0.035 * (1 - u) + 0.015, alpha: 0.8 * (1 - u * 0.6), glow: 0.5, turn: u });
      const lines: P3[][] = [];
      for (let i = 0; i < 5; i++) {
        const an = (i / 5) * TAU + hashOf(k.seed, i);
        lines.push(cracked(k, st, { x: st.x + Math.cos(an) * 0.4, y: st.y + Math.sin(an) * 0.4 }, 40 + i, 3, 0.1));
      }
      cracks(k, lines, easeOut(seg(u, 0, 0.3)), { alpha: 1 - smooth(seg(u, 0.5, 1)), width: 0.7, glow: 0.4, taper: true });
      k.light(st, 2.5, 0.7 * (1 - u));
    } },
    linger: { draw: (k, age, left) => {
      const b = k.target;
      const st = stakeAt(k);
      const a = life(age, left, 0.05, 0.6);
      const sink = smooth(left / 0.6);
      const top = k.on(st.x, st.y, STAKE * 0.75 * (0.4 + 0.6 * sink));
      const paint = spike(k, st, STAKE * 0.75 * (0.4 + 0.6 * sink), 3.4, { x: 0, y: 0 }, { alpha: a, turn: 0.4 });
      if (paint) k.worldDraw(k.on(st.x, st.y), paint, 0);
      // The collar, and the chain from the stake to it: slack while it is near the stake, taut as it reaches the end of its leash.
      // On its neck, between the shoulders and the head, not round the crown.
      const neck = neckOf(k, b);
      hoop(k, neck, neck.z, girth(b) * (b.figure ? 0.6 : 0.45), { alpha: a, h: band(b) * 0.55, n: 8, glow: 0.3, behind: 4 });
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
      k.ring(leashAt(k), LEASH, { band: 0.03, alpha: 0.4 * a, dash: 3, turn: age * 0.05, glow: 0.2 + 0.4 * k.night });
      tally(k, st, 0.4, left, age + left, 0.85 * a);
      k.light(st, 1.2, 0.3 * a);
      glint(k, top, age, 2.2, a);
    } },
  },
};

const BRITTLE = spellInfo('binder_brittle');
/** Branches the cracks run in: one for every fourth part it takes more. */
const BRANCHES = Math.max(3, Math.round(((BRITTLE?.fx.taken ?? 1.25) - 1) * 24));

/**
 * The craze of cracks over a body, in screen pixels from its middle: drawn on it as on glass, `grow` of the way out, and
 * kept inside the body as it is seen -- an ellipse as long as the creature shows from here (its length across the screen
 * side on, its breadth from the front) and a little under half as tall.
 */
function crazing(k: FxScene, b: Body, grow: number, alpha: number, sweep: number): void {
  if (alpha <= 0.01 || grow <= 0) return;
  const at = k.heart(b);
  const x0 = k.sx(at), y0 = k.sy(at);
  const { len, side } = build(k, b);
  const z = at.z - b.z;
  const across = Math.max(
    Math.abs(k.sx(k.local(b, 0, len, z)) - x0),
    Math.abs(k.sx(k.local(b, side, 0, z)) - x0),
  );
  const ry = k.hpx(b.tall * (b.figure ? 0.3 : 0.24)), rx = Math.max(across * 0.85, ry * 0.8);
  const runs: number[][] = [];
  for (let i = 0; i < BRANCHES; i++) {
    const an = (i / BRANCHES) * TAU + (hashOf(k.seed + 50, i) - 0.5) * 0.8;
    const xy = [x0, y0];
    let x = x0, y = y0;
    for (let j = 1; j <= 2; j++) {
      const v = j / 2;
      if (v > grow + 0.5) break;
      const reach = Math.min(1, grow / v) * v * (0.75 + 0.25 * hashOf(k.seed + 57, i));
      const wob = (hashOf(k.seed + 51 + j, i) - 0.5) * 0.6;
      x = x0 + Math.cos(an + wob) * rx * reach;
      y = y0 + Math.sin(an + wob) * ry * reach;
      xy.push(x, y);
    }
    runs.push(xy);
    // A short fork off the middle of each branch, the way glass forks.
    if (grow > 0.5 && xy.length >= 6) {
      const fx = xy[2], fy = xy[3];
      const fa = an + (hashOf(k.seed + 56, i) < 0.5 ? -0.7 : 0.7);
      const fl = smooth((grow - 0.5) * 2) * 0.3;
      runs.push([fx, fy, fx + Math.cos(fa) * rx * fl, fy + Math.sin(fa) * ry * fl]);
    }
  }
  // A light line with a narrower ink edge either side: cracks in glass at play size rather than dark hatching.
  const coreW = Math.max(1, 0.45 * k.zoom), inkW = Math.max(0.6, 0.3 * k.zoom);
  const trace = (g: CanvasRenderingContext2D): void => {
    g.lineJoin = 'miter';
    g.lineCap = 'butt';
    g.beginPath();
    for (const xy of runs) {
      g.moveTo(xy[0], xy[1]);
      for (let i = 2; i < xy.length; i += 2) g.lineTo(xy[i], xy[i + 1]);
    }
  };
  k.worldDraw({ x: b.x, y: b.y, z: b.z }, (g) => {
    trace(g);
    // The ink only edges the light; at full strength it would swallow a one-pixel core at play size.
    g.globalAlpha = clamp(alpha * 0.6);
    g.lineWidth = inkW + coreW;
    g.strokeStyle = P.ink;
    g.stroke();
    g.globalAlpha = clamp(alpha);
    g.lineWidth = coreW;
    g.strokeStyle = P.core;
    g.stroke();
  }, 6);
  // By night the light line also shines, so the craze is not lost to the dark.
  if (k.night > 0.05) k.glowDraw((g) => {
    trace(g);
    g.globalAlpha = clamp(alpha * 0.55 * k.night);
    g.lineWidth = coreW;
    g.strokeStyle = P.core;
    g.stroke();
  });
  // A glint running out along one branch and then the next.
  const which = Math.floor(sweep) % runs.length;
  const run = runs[which];
  if (run && run.length >= 4) {
    const v = sweep % 1;
    const n = run.length / 2 - 1;
    const s = Math.min(n - 1e-3, v * n), q = Math.floor(s) * 2, f = s - Math.floor(s);
    const gx = lerp(run[q], run[q + 2], f), gy = lerp(run[q + 1], run[q + 3], f);
    k.glowDraw((g) => {
      g.globalAlpha = clamp(Math.sin(v * Math.PI) * Math.min(1, alpha * 1.25));
      g.fillStyle = P.core;
      const R = 3 * k.zoom;
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
    // A needle of light, too quick to see anything but its streak; behind it, for the first moment, a faint line from the
    // fingertip straight to the mark, so the tap and what it taps are seen as one.
    travel: { secs: (tiles) => 0.03 + tiles * 0.02, draw: (k, u) => {
      const from = k.hand(1), to = k.heart(k.target);
      const sight = 1 - seg(u, 0, 0.5);
      if (sight > 0.01) k.polyline([k.once('tap', () => from), to], { alpha: 0.5 * sight, main: P.core, width: 0.8, glow: 0 });
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
      // The body goes pale as glass, which reads at any zoom and at night where the craze is a few pixels.
      k.tint(b, { colour: P.core, share: a * (0.25 + 0.07 * Math.sin(age * 2)) });
      crazing(k, b, easeOut(seg(age, 0, 0.4)), a, age * 0.8 + 0.3);
      if (!k.fast) k.emit(k.heart(b), 2.5 * a, { kind: 'shard', colour: [P.core, P.main], size: 1.2, life: [0.5, 0.9], speed: [0.05, 0.2], up: [0, 4], gravity: 40, jitter: girth(b) * 0.4, jitterZ: b.tall * 0.25 });
      tally(k, b, girth(b) * 2.1, left, age + left, 0.8 * a);
      k.light(b, 1.2, 0.3 * a);
    } },
  },
};

/** Lock's cage: a six-sided prism of crystal round the body, its panels sliding in from wide as it closes. */
/**
 * Where a point round Lock's cage is, at `an` round it and `z` up, `out` times its size: a six-sided prism stretched along
 * the way the body faces to hold all of it, head and tail, and as broad as it is (a person's is round).
 */
function cageAt(k: FxScene, b: Body, an: number, z: number, out = 1): P3 {
  const { len, side } = build(k, b);
  const L = b.figure ? 4.5 : len * 1.5 + 1.5, S = b.figure ? 4.5 : side * 1.35 + 1.2;
  return k.local(b, Math.cos(an) * S * out, Math.sin(an) * L * out, z);
}

function cage(k: FxScene, b: Body, age: number, a: number, breaking: number): void {
  const n = 6;
  const H = b.tall * 1.12;
  const cx = k.sx({ x: b.x, y: b.y, z: b.z }), cy = k.sy({ x: b.x, y: b.y, z: b.z });
  const quads: number[] = [], front: boolean[] = [], tone: number[] = [], alph: number[] = [];
  const cap: number[] = [];
  // Its corners at the head and the tail and two along each flank, so the long panels lie along the body.
  const A = (i: number): number => (i / n) * TAU + Math.PI / 2;
  for (let i = 0; i < n; i++) {
    const in1 = easeBack(seg(age, i * 0.04, i * 0.04 + 0.28));
    const out = 1 + 1.2 * (1 - in1) + 0.5 * breaking;
    const a0 = A(i), a1 = A(i + 1);
    const drop = breaking * breaking * H * 0.4 * (0.6 + 0.4 * hashOf(k.seed + 70, i));
    // Each panel slides in square to itself: its own two corners carried out by the same step as its middle.
    const m0 = cageAt(k, b, a0, 0), m1 = cageAt(k, b, a1, 0), mo = mid3(m0, m1, 0.5);
    const ox = (mo.x - b.x) * (out - 1), oy = (mo.y - b.y) * (out - 1);
    const corner = (an: number, z: number): void => {
      const c = cageAt(k, b, an, z - drop);
      const p = { x: c.x + ox, y: c.y + oy, z: c.z };
      quads.push(k.sx(p), k.sy(p));
    };
    corner(a0, 0);
    corner(a1, 0);
    corner(a1, H);
    corner(a0, H);
    front.push(k.sy(mo) > cy);
    tone.push(k.sx(mo) - cx);
    alph.push(smooth(seg(age, i * 0.04, i * 0.04 + 0.12)));
    const tp = cageAt(k, b, a0, H);
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

/**
 * The lock itself: a padlock of cut crystal, a shackle arched over a square body with a keyhole (a round head over a
 * wedge), turned on its shackle as it shuts (`turn`, a quarter turn shows it edge on). Hung on the cage's front panel,
 * sorted with the body at `sortAt`, so it is a thing on the cage and not a sign over the head.
 */
function seal(k: FxScene, at: P3, turn: number, alpha: number, size = 3.2, sortAt?: P3, bias = 8): void {
  if (alpha <= 0.01) return;
  const x = k.sx(at), y = k.sy(at), R = size * k.zoom;
  const sq = 0.25 + 0.75 * Math.abs(Math.cos(turn));
  const W = R * sq, top = y - R * 0.55, bot = y + R * 0.9;
  const inkW = Math.max(0.8, 0.6 * k.zoom);
  k.worldDraw(sortAt ?? { x: at.x, y: at.y, z: 0 }, (g) => {
    g.globalAlpha = clamp(alpha);
    g.lineJoin = 'round';
    // The shackle: an inked arch with a lit line along it, its feet in the body.
    g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(x - W * 0.62, top + R * 0.1);
    g.lineTo(x - W * 0.62, top - R * 0.45);
    g.arc(x, top - R * 0.45, W * 0.62, Math.PI, 0);
    g.lineTo(x + W * 0.62, top + R * 0.1);
    g.lineWidth = R * 0.42 + inkW * 2;
    g.strokeStyle = P.ink;
    g.stroke();
    g.lineWidth = R * 0.42;
    g.strokeStyle = P.main;
    g.stroke();
    g.lineWidth = Math.max(0.6, R * 0.12);
    g.strokeStyle = P.core;
    g.stroke();
    // The body: a square with its corners cut, lit down its left, shaded down its right.
    const pts = [x - W, top + R * 0.15, x - W * 0.8, top, x + W * 0.8, top, x + W, top + R * 0.15, x + W, bot - R * 0.15, x + W * 0.8, bot, x - W * 0.8, bot, x - W, bot - R * 0.15];
    g.beginPath();
    for (let i = 0; i < pts.length; i += 2) (i ? g.lineTo(pts[i], pts[i + 1]) : g.moveTo(pts[i], pts[i + 1]));
    g.closePath();
    g.fillStyle = P.accent;
    g.fill();
    g.lineWidth = inkW;
    g.strokeStyle = P.ink;
    g.stroke();
    g.fillStyle = P.core;
    g.beginPath();
    g.moveTo(x - W * 0.8, top);
    g.lineTo(x - W, top + R * 0.15);
    g.lineTo(x - W, bot - R * 0.15);
    g.lineTo(x - W * 0.55, bot - R * 0.3);
    g.lineTo(x - W * 0.55, top + R * 0.2);
    g.closePath();
    g.fill();
    // The keyhole: a round head over a wedge.
    if (sq > 0.4) {
      g.fillStyle = P.ink;
      const hy = y + R * 0.05, hr = R * 0.24 * sq;
      g.beginPath();
      g.arc(x, hy, hr, 0, TAU);
      g.moveTo(x - hr * 0.5, hy);
      g.lineTo(x + hr * 0.5, hy);
      g.lineTo(x + hr * 0.9, hy + R * 0.6);
      g.lineTo(x - hr * 0.9, hy + R * 0.6);
      g.closePath();
      g.fill();
    }
  }, bias);
  k.glow(at, size * 2.2, alpha * (0.35 + 0.25 * k.night));
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
        // The stone run together between the hands becomes the lock they turn: held at the hands, before the chest.
        const shown = smooth(seg(t, 0.3, 0.36));
        gemAt(k, c, g * (1 - shown), 2.8, turn);
        seal(k, c, Math.PI / 2 - turn, shown * (1 - seg(t, 0.56, 0.6)), 2.2, { x: k.caster.x, y: k.caster.y, z: k.caster.z }, 6);
      }
      k.light(mid3(l, r, 0.5), 1.8, 0.5 * g);
    },
    // A line of light thrown straight from the fists to it: the bolt shot home.
    travel: { secs: (tiles) => 0.05 + tiles * 0.035, draw: (k, u) => {
      const from = k.chest(), to = k.heart(k.target);
      const tip = mid3(from, to, easeOut(u));
      k.beam(from, tip, { width: 2.2, alpha: 0.9 });
      gemAt(k, tip, 1, 2, k.now * 10);
      k.light(tip, 2, 0.6);
    } },
    hit: (k) => {
      shatterBurst(k, k.heart(k.target), 16, undefined, 0.8);
    },
    impact: { secs: 0.7, draw: (k, u) => {
      const from = k.chest(), to = k.heart(k.target);
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
      // The padlock snapped shut on the cage's nearest panel, half way up it, swinging a little as it settles.
      const sealIn = easeBack(seg(age, 0.32, 0.5));
      let face = 0, faceY = -Infinity;
      for (let i = 0; i < 6; i++) {
        const an = ((i + 0.5) / 6) * TAU + Math.PI / 2, y = k.sy(cageAt(k, b, an, 0));
        if (y > faceY) { faceY = y; face = an; }
      }
      const hang = cageAt(k, b, face, b.tall * 0.5, 1.04);
      const sway = Math.sin(age * 5) * 0.6 * (1 - smooth(seg(age, 0.5, 1.6)));
      seal(k, { ...hang, z: hang.z - 0.6 * (1 - sealIn) }, (1 - sealIn) * Math.PI * 0.5 + sway * 0.4, a * smooth(seg(age, 0.32, 0.4)) * (1 - breaking), b.figure ? 2.6 : 2.8, { x: b.x, y: b.y, z: b.z });
      glint(k, k.at(b, 0.95), age, 1.9, a);
      tally(k, b, girth(b) * 2.3, left, age + left, 0.85 * a);
      k.light(b, 1.2, 0.3 * a);
      if (left < 0.3 && once(k, 'broke')) shatterBurst(k, k.at(b, 0.5), 30, undefined, 1.1);
    } },
  },
};

/**
 * Still Skin's plates: crystal laid along every limb, forearms and shins first since that is where blows are taken, as
 * bones from and to and how broad, in pixels at zoom one -- long and narrow, vambraces and greaves the length of the bone,
 * not stones on it; a breastplate goes over them.
 */
const PLATES: ReadonlyArray<readonly [string, string, number]> = [
  ['elbow0', 'wrist0', 1.4], ['elbow1', 'wrist1', 1.4], ['knee0', 'ankle0', 1.6], ['knee1', 'ankle1', 1.6],
  ['arm0', 'elbow0', 1.5], ['arm1', 'elbow1', 1.5], ['hip0', 'knee0', 1.8], ['hip1', 'knee1', 1.8],
];

/** The plates over a body, each grown on in turn by `grow`, only on the side of it toward the viewer; `sweep` runs a light over them. */
function plates(k: FxScene, b: Body, grow: number, a: number, sweep: number): void {
  if (a <= 0.01 || grow <= 0) return;
  const cy = k.sy({ x: b.x, y: b.y, z: b.z });
  // Each plate as six points round it (a long hexagon: short bevelled ends, straight sides along the bone).
  const laid: number[][] = [];
  const lit: number[] = [];
  const glints = (i: number): number => (Math.abs(((sweep - i * 0.17) % 1 + 1) % 1 - 0.5) < 0.08 ? 1 : 0);
  const lay = (p0: P3, p1: P3, w: number, i: number): void => {
    const s = easeBack(seg(grow, i * 0.06, i * 0.06 + 0.4));
    if (s <= 0.02) return;
    // Only what is on the side toward the viewer: the far arm's and leg's plates are behind the body.
    if (k.sy({ x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2, z: b.z }) < cy - 1.5 * k.zoom) return;
    const ax = k.sx(p0), ay = k.sy(p0), bx = k.sx(p1), by = k.sy(p1);
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    // Grown out from the middle to the whole bone.
    const x0 = mx + (ax - mx) * s, y0 = my + (ay - my) * s, x1 = mx + (bx - mx) * s, y1 = my + (by - my) * s;
    let dx = x1 - x0, dy = y1 - y0;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    const W = w * Math.min(1, s) * k.zoom, bev = Math.min(l * 0.2, W * 1.4);
    const px = dy * W, py = -dx * W;
    laid.push([
      x0, y0,
      x0 + dx * bev + px, y0 + dy * bev + py, x1 - dx * bev + px, y1 - dy * bev + py,
      x1, y1,
      x1 - dx * bev - px, y1 - dy * bev - py, x0 + dx * bev - px, y0 + dy * bev - py,
    ]);
    lit.push(glints(i));
  };
  PLATES.forEach(([from, to, w], i) => lay(k.joint(b, from), k.joint(b, to), w, i));
  // The breastplate: a broad shield, flat across the top under the collarbones and coming to a blunt point at the belt,
  // hidden only when the back is turned.
  const breast = k.chest(b), belt = k.local(b, 0, 1.6, b.tall * 0.47);
  let shield: number[] | null = null;
  const sb = easeBack(seg(grow, PLATES.length * 0.06, PLATES.length * 0.06 + 0.4));
  if (sb > 0.02 && k.sy({ x: breast.x, y: breast.y, z: b.z }) >= cy - 0.5 * k.zoom) {
    const tx = k.sx(breast), ty = k.sy(breast) - 1.2 * k.zoom, ex = k.sx(belt), ey = k.sy(belt);
    const W = 5.5 * k.zoom * Math.min(1, sb) * 0.5, H = (ey - ty) * Math.min(1, sb);
    shield = [tx - W, ty, tx + W, ty, tx + W * 0.95, ty + H * 0.55, tx + (ex - tx) * 0.5, ty + H, tx - W * 0.95, ty + H * 0.55];
  }
  if (!laid.length && !shield) return;
  const inkW = Math.max(0.7, 0.55 * k.zoom);
  const edge = nightInk(k, P.main);
  const shieldLit = glints(PLATES.length);
  k.worldDraw({ x: b.x, y: b.y, z: b.z }, (g) => {
    g.globalAlpha = clamp(a);
    g.lineJoin = 'round';
    const poly = (pts: number[]): void => {
      g.beginPath();
      for (let j = 0; j < pts.length; j += 2) (j ? g.lineTo(pts[j], pts[j + 1]) : g.moveTo(pts[j], pts[j + 1]));
      g.closePath();
    };
    for (let i = 0; i < laid.length; i++) {
      const q = laid[i];
      // The ridge along the bone splits it: the half toward the light lit, the other shaded (lit too while the light runs).
      const upperLit = -(q[2] - q[0]) * 0.75 - (q[3] - q[1]) * 0.65 > -(q[10] - q[0]) * 0.75 - (q[11] - q[1]) * 0.65;
      const h1 = [q[0], q[1], q[2], q[3], q[4], q[5], q[6], q[7]], h2 = [q[0], q[1], q[10], q[11], q[8], q[9], q[6], q[7]];
      poly(upperLit ? h1 : h2);
      g.fillStyle = P.core;
      g.fill();
      poly(upperLit ? h2 : h1);
      g.fillStyle = lit[i] ? P.core : P.main;
      g.fill();
      poly(q);
      g.lineWidth = inkW;
      g.strokeStyle = edge;
      g.stroke();
    }
    if (shield) {
      const s = shield, rx = (s[0] + s[2]) / 2;
      // Its left half lit, the right shaded, a ridge down the middle.
      poly([s[0], s[1], rx, s[1], s[6], s[7], s[8], s[9]]);
      g.fillStyle = P.core;
      g.fill();
      poly([rx, s[1], s[2], s[3], s[4], s[5], s[6], s[7]]);
      g.fillStyle = shieldLit ? P.core : P.main;
      g.fill();
      poly(s);
      g.lineWidth = inkW;
      g.strokeStyle = edge;
      g.stroke();
      g.beginPath();
      g.moveTo(rx, s[1]);
      g.lineTo(s[6], s[7]);
      g.strokeStyle = P.deep;
      g.lineWidth = Math.max(0.5, 0.35 * k.zoom);
      g.stroke();
    }
  }, 6);
  k.glow(k.at(b, 0.5), 14, a * (0.3 + 0.2 * k.night));
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
      k.flare(k.chest(), 3 * (1 - u * 0.5), 0.8 * flashOf(u, 0.1), P.core);
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
  const ph = hashOf(k.seed, 1) * 6;
  for (let i = 0; i < n; i++) {
    const an = (i / n) * TAU;
    // Lobed outward only: the drawn edge is never inside the reach it slows things at.
    const wob = 1 + 0.03 * (1 + Math.sin(an * 5 + t * 1.3 + ph)) + 0.012 * (1 + Math.sin(an * 9 - t));
    const x = c.x + Math.cos(an) * r * wob, y = c.y + Math.sin(an) * r * wob;
    edge.push(x, y);
    const p = { x, y, z: k.ground(x, y) + 0.1 };
    if (i) glowPath.lineTo(k.sx(p), k.sy(p));
    else glowPath.moveTo(k.sx(p), k.sy(p));
  }
  glowPath.closePath();
  // Broken into shards of dark glass, as a pane breaks: a few round a point a little off its middle, and a ring of longer
  // ones out to the edge whose seams do not line up with the inner ones; each in one of three tones, inked seams between.
  const hub = { x: c.x + (hashOf(k.seed, 3) - 0.5) * r * 0.2, y: c.y + (hashOf(k.seed, 4) - 0.5) * r * 0.2 };
  const IN = 5, OUT = 10;
  const inner: number[] = [];
  for (let s = 0; s < IN; s++) {
    const an = ((s + 0.4 * hashOf(k.seed + 5, s)) / IN) * TAU, rr = r * (0.36 + 0.2 * hashOf(k.seed + 6, s));
    inner.push(hub.x + Math.cos(an) * rr, hub.y + Math.sin(an) * rr, an);
  }
  const tones: number[][][] = [[], [], []];
  const seams: number[][] = [];
  const tone = (i: number): number => Math.floor(hashOf(k.seed + 8, i) * 2.999);
  for (let s = 0; s < IN; s++) {
    const j = (s + 1) % IN;
    tones[tone(s)].push([hub.x, hub.y, inner[3 * s], inner[3 * s + 1], inner[3 * j], inner[3 * j + 1]]);
    seams.push([hub.x, hub.y, inner[3 * s], inner[3 * s + 1]]);
  }
  // The inner ring's own edge, and from it the outer seams out to the rim at their own angles.
  const ringPts: number[] = [];
  for (let s = 0; s <= IN; s++) ringPts.push(inner[3 * (s % IN)], inner[3 * (s % IN) + 1]);
  seams.push(ringPts);
  const onRing = (an: number): [number, number] => {
    // Where a ray from the hub at `an` meets the inner ring: between the two inner points either side of it.
    let s = 0;
    const u = ((an % TAU) + TAU) % TAU;
    for (let i = 0; i < IN; i++) {
      const a0 = ((inner[3 * i + 2] % TAU) + TAU) % TAU, a1 = ((inner[3 * ((i + 1) % IN) + 2] % TAU) + TAU) % TAU;
      if (a0 <= a1 ? u >= a0 && u < a1 : u >= a0 || u < a1) { s = i; break; }
    }
    const j = (s + 1) % IN;
    const a0 = inner[3 * s + 2], a1 = inner[3 * j + 2] + (inner[3 * j + 2] < a0 ? TAU : 0);
    const f = clamp((u + (u < a0 ? TAU : 0) - a0) / Math.max(1e-3, a1 - a0));
    return [lerp(inner[3 * s], inner[3 * j], f), lerp(inner[3 * s + 1], inner[3 * j + 1], f)];
  };
  const outAt: Array<[number, number, number, number, number]> = [];
  for (let s = 0; s < OUT; s++) {
    const an = ((s + 0.5 + 0.5 * (hashOf(k.seed + 9, s) - 0.5)) / OUT) * TAU;
    const ei = Math.round((an / TAU) * n) % n;
    const [ix, iy] = onRing(an);
    outAt.push([ix, iy, edge[2 * ei], edge[2 * ei + 1], ei]);
    seams.push([ix, iy, edge[2 * ei], edge[2 * ei + 1]]);
  }
  for (let s = 0; s < OUT; s++) {
    const a = outAt[s], b = outAt[(s + 1) % OUT];
    const poly = [a[0], a[1], a[2], a[3]];
    for (let i = a[4] + 1, end = b[4] <= a[4] ? b[4] + n : b[4]; i <= end; i++) poly.push(edge[2 * (i % n)], edge[2 * (i % n) + 1]);
    poly.push(b[0], b[1]);
    tones[tone(IN + s)].push(poly);
  }
  const [toneA, toneB] = tones;
  // One ring moving outwards through it at the slick's own slow pace (none on fast graphics).
  const rings: number[][] = [];
  if (!k.fast) {
    const m = Math.max(12, Math.round(n * 0.6));
    const v = (t * 0.22) % 1;
    const rr = r * (0.12 + 0.8 * v);
    const ring: number[] = [];
    for (let i = 0; i < m; i++) ring.push(c.x + Math.cos((i / m) * TAU) * rr, c.y + Math.sin((i / m) * TAU) * rr);
    rings.push(ring);
  }
  // Bubbles that swell as little blisters lit on one side and burst as rings opening on the surface.
  const domes: number[][] = [], bursts: number[][] = [];
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
    } else if (!k.fast) bursts.push(hex(0.05 + 0.08 * ((v - 0.8) / 0.2)));
  }
  const Z = k.zoom;
  const inkW = Math.max(1, 0.9 * Z), thin = Math.max(0.6, 0.5 * Z);
  // Every layer is cut along the tiles and laid line by line over the whole slick, so it is kept to six (five on fast
  // graphics): the glass laid whole, two thirds of the shards darker over it (the rest are the glass itself), the seams, the
  // rim, the blisters, and the ring with the bursting blisters.
  const layers: GroundLayer[] = [
    { kind: 'fill', colour: LEAD.deep, alpha: clamp(a * 0.24), paths: [edge], lift: 0.1 },
    { kind: 'fill', colour: P.ink, alpha: clamp(a * 0.14), paths: [...toneA, ...toneB], lift: 0.1 },
    { kind: 'stroke', colour: k.night > 0.45 ? LEAD.core : P.ink, alpha: clamp(a * 0.55), width: thin, paths: seams, lift: 0.11 },
    { kind: 'stroke', colour: P.accent, alpha: clamp(a * 0.9), width: inkW, paths: [edge], closed: true, lift: 0.1 },
    { kind: 'fill', colour: LEAD.main, alpha: clamp(a * 0.85), paths: domes, lift: 0.12 },
  ];
  if (rings.length || bursts.length) layers.push({ kind: 'stroke', colour: P.main, alpha: clamp(a * 0.4), width: Math.max(0.6, 0.5 * Z), paths: [...rings, ...bursts], closed: true, lift: 0.12 });
  k.groundShape(c.x, c.y, r * 1.1 + 0.3, layers);
  // The rim glows faintly so the slick's edge can be found at night (not on fast graphics, where it is the dearest part).
  if (!k.fast) {
    const pic = k.pal.light;
    k.glowDraw((g) => {
      g.globalAlpha = clamp(a * (0.14 + 0.16 * k.night));
      g.strokeStyle = pic;
      g.lineWidth = 2.6 * Z;
      g.stroke(glowPath);
    });
  }
}

/**
 * Crusts of crystal grown up on the slick's rim, a few low clusters round it, each its own record so it sorts with what
 * stands near it: glass setting at the edge of the glass.
 */
function crusts(k: FxScene, c: { x: number; y: number }, r: number, grow: number, a: number): void {
  if (grow <= 0.01 || a <= 0.01) return;
  for (let i = 0; i < 4; i++) {
    const an = (i / 4) * TAU + hashOf(k.seed + 85, i) * 1.2;
    const paints: Array<(g: CanvasRenderingContext2D) => void> = [];
    for (let j = 0; j < 5; j++) {
      const aj = an + ((j - 2) * 0.06 / Math.max(0.5, r)) * 4;
      const rr = r * (1.0 + 0.025 * Math.cos(j * 2.3));
      const base = { x: c.x + Math.cos(aj) * rr, y: c.y + Math.sin(aj) * rr };
      const h = (j === 2 ? 4.2 : 2.2 + 1.4 * hashOf(k.seed + 86 + i, j)) * easeBack(seg(grow, Math.abs(j - 2) * 0.1, 0.6 + Math.abs(j - 2) * 0.1));
      const paint = spike(k, base, h, j === 2 ? 2.8 : 2, { x: Math.cos(aj) * 0.02, y: Math.sin(aj) * 0.02 }, { alpha: a, turn: i + j, core: LEAD.core, main: P.main, deep: LEAD.main });
      if (paint) paints.push(paint);
    }
    if (paints.length) k.worldDraw(k.on(c.x + Math.cos(an) * r, c.y + Math.sin(an) * r), (g) => { for (const p of paints) p(g); }, 0);
  }
}

/**
 * What is caught in the mire: a dark pool sucking at each one's feet and a ring round it closing and opening at the slick's
 * own slow pace -- all of them in one shape on the ground, however many.
 */
function mired(k: FxScene, c: { x: number; y: number }, r: number, bodies: Body[], age: number, a: number): void {
  if (!bodies.length || a <= 0.01) return;
  const pools: number[][] = [], rings: number[][] = [];
  const m = 12;
  bodies.forEach((b, i) => {
    const g = girth(b);
    const pulse = 0.5 + 0.5 * Math.sin(age * 2.2 * MIRE_PACE + i * 1.7);
    const pool: number[] = [], ring: number[] = [];
    for (let j = 0; j < m; j++) {
      const an = (j / m) * TAU;
      pool.push(b.x + Math.cos(an) * g * 2, b.y + Math.sin(an) * g * 2);
      ring.push(b.x + Math.cos(an) * g * (1.5 + 0.5 * pulse), b.y + Math.sin(an) * g * (1.5 + 0.5 * pulse));
    }
    pools.push(pool);
    rings.push(ring);
    if (!k.fast) k.emit(k.at(b, 0.05), 1.5 * a, { kind: 'drop', colour: [LEAD.main, P.main], size: 1.8, life: [0.3, 0.5], speed: [0.05, 0.15], up: [3, 6], gravity: 30 });
  });
  k.groundShape(c.x, c.y, r + 0.5, [
    { kind: 'fill', colour: LEAD.deep, alpha: clamp(0.35 * a), paths: pools, lift: 0.14 },
    { kind: 'stroke', colour: P.main, alpha: clamp(0.7 * a), width: Math.max(1, 0.8 * k.zoom), paths: rings, closed: true, lift: 0.15, glow: 0.3 * k.night },
  ]);
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
    impact: { secs: 0.4, draw: (k, u) => k.light(fieldAt(k), 2.5, 0.5 * (1 - u), '#fff1d6') },
    // It spreads out to its reach as thick things do, slowly, and lies where it was cast as broken dark glass, crusted with
    // crystal at its rim, rings crawling through it; whatever stands in it has the slick sucking at its feet. How long is
    // left is told round its rim.
    linger: { on: 'spot', draw: (k, age, left) => {
      const c = fieldAt(k);
      const a = life(age, left, 0.05, 0.8);
      const spread = easeOut(seg(age, 0, 1.4 / MIRE_PACE * 0.6));
      const r = lerp(0.85, MIRE_R, spread);
      slick(k, c, r, age, a);
      crusts(k, c, r * 1.03, seg(age, 0.6, 1.6) * smooth(left / 0.8), a);
      mired(k, c, r, caught(k, c, r, 5, age), age, a * smooth(seg(age, 0.2, 0.6)));
      tally(k, c, r * 1.1, left, age + left, 0.8 * a, 24);
      k.light(c, 1.6, (0.25 + 0.15 * k.night) * a, '#fff1d6');
      if (!k.fast) k.emit({ ...c, z: c.z + 0.5 }, 5 * a, { kind: 'mote', colour: [P.main, P.accent], size: 1.4, life: [1.0, 1.6], speed: [0.02, 0.05], up: [1, 3], gravity: 0, drag: 0.5, jitter: r * 0.7 });
    } },
  },
};

const MASS_ARMS = 8;

/**
 * The ways the cracks run out from the caster, kept from the first frame: evenly round, then the arm nearest each creature
 * caught when it was cast bent round to run straight at its feet, so every rooted thing has its own crack reaching it.
 */
function massAims(k: FxScene, c: { x: number; y: number }): number[] {
  if (k.state.massAims === undefined) {
    const an: number[] = [];
    for (let i = 0; i < MASS_ARMS; i++) an.push((i / MASS_ARMS) * TAU + (hashOf(k.seed + 90, i) - 0.5) * 0.4);
    const taken: boolean[] = [];
    for (const b of caught(k, c, MASS_R)) {
      const want = Math.atan2(b.y - c.y, b.x - c.x);
      let best = -1, off = Infinity;
      for (let i = 0; i < MASS_ARMS; i++) {
        if (taken[i]) continue;
        const d = Math.abs(Math.atan2(Math.sin(an[i] - want), Math.cos(an[i] - want)));
        if (d < off) { off = d; best = i; }
      }
      if (best < 0) break;
      taken[best] = true;
      an[best] = want;
      k.state[`massAimed${best}`] = 1;
    }
    an.forEach((a, i) => { k.state[`massAim${i}`] = a; });
    k.state.massAims = 1;
  }
  const out: number[] = [];
  for (let i = 0; i < MASS_ARMS; i++) out.push(k.state[`massAim${i}`]);
  return out;
}

/** The cracks out from the caster, one per arm of the star, the same every frame. */
function massLines(k: FxScene, c: { x: number; y: number }): P3[][] {
  const out: P3[][] = [];
  massAims(k, c).forEach((an, i) => {
    // From a little way out, so the cracks start at the palms rather than running up through the caster; one aimed at a
    // creature wanders less, so it is seen to reach it.
    const jag = k.state[`massAimed${i}`] ? 0.1 : 0.2;
    out.push(cracked(k, { x: c.x + Math.cos(an) * 0.25, y: c.y + Math.sin(an) * 0.25 }, { x: c.x + Math.cos(an) * MASS_R, y: c.y + Math.sin(an) * MASS_R }, 90 + i, 6, jag));
  });
  return out;
}

const massRoot: SpellVisual = {
  palette: P,
  cast: { timing: { secs: 1.4, release: 0.5, blendOut: 0.3 }, pose: massRootPose },
  fx: {
    charge: (k, t) => {
      const g = smooth(seg(t, 0.12, 0.36)) * (1 - seg(t, 0.46, 0.5));
      gemAt(k, k.hand(0), g, 1.6, k.now * 6);
      gemAt(k, k.hand(1), g, 1.6, -k.now * 6);
      k.light(k.at(k.caster, 1), 2, 0.5 * g);
    },
    hit: (k) => {
      const c = fieldAt(k);
      massAims(k, c);
      k.burst({ ...c, z: c.z + 1 }, 12, { kind: 'dust', colour: '#8f8a7a', size: 2, life: [0.3, 0.6], speed: [1.4, 2.6], up: [2, 5], gravity: 4, drag: 0.15 });
      shatterBurst(k, { ...c, z: c.z + 3 }, 16, undefined, 1.2);
      k.flash(0.05);
    },
    impact: { secs: 0.9, draw: (k, u) => {
      const c = fieldAt(k);
      k.ring(c, 0.2 + MASS_R * easeOut(seg(u, 0, 0.55)), { band: 0.14 * (1 - u), alpha: 0.9 * (1 - u * u), glow: 0.6 });
      k.light(c, 2.6, 0.8 * (1 - u), '#fff1d6');
    } },
    // Cracks race out as far as it reaches, one bent to each thing caught, and crystal bursts up all along them -- big
    // stones in three clusters and a crust between -- and round the feet of whatever stands there.
    linger: { on: 'spot', draw: (k, age, left) => {
      const c = fieldAt(k);
      const a = life(age, left, 0.02, 0.6);
      const run = easeOut(seg(age, 0, 0.5));
      const lines = massLines(k, c);
      cracks(k, lines, run, { alpha: a * (0.45 + 0.55 * (1 - smooth(seg(age, 0.8, 2.5)))), width: 1.1, glow: 0.6 * (1 - smooth(seg(age, 0.4, 1.1))) + 0.4 * k.night, taper: true });
      const sink = smooth(left / 0.6);
      for (let i = 0; i < MASS_ARMS; i++) {
        const line = lines[i];
        const along = (v: number): P3 => {
          const s = v * (line.length - 1), j = Math.min(line.length - 2, Math.floor(s));
          return mid3(line[j], line[j + 1], s - j);
        };
        const stones: Array<{ y: number; paint: (g: CanvasRenderingContext2D) => void }> = [];
        const put = (base: { x: number; y: number }, h: number, w: number, lean: { x: number; y: number }, turn: number): void => {
          const paint = spike(k, base, h, w, lean, { alpha: a, turn, core: ROOT_CORE });
          if (paint) stones.push({ y: k.sy({ x: base.x, y: base.y, z: c.z }), paint });
        };
        let sortAt: P3 | null = null;
        for (const at of [0.42, 0.72, 0.95]) {
          const g = easeBack(seg(run, at - 0.05, at + 0.25)) * sink;
          if (g <= 0.02) continue;
          const p = along(at);
          for (let j = 0; j < 3; j++) {
            const an = j * 2.1 + hashOf(k.seed + 95 + i, j) * 2;
            const o = 0.1 * (j ? 1 : 0);
            const h = (j ? 5 : 9) * (0.8 + 0.4 * hashOf(k.seed + 96 + i, j)) * g * (0.85 + 0.3 * at);
            put({ x: p.x + Math.cos(an) * o, y: p.y + Math.sin(an) * o }, h, j ? 1.8 : 2.6, { x: Math.cos(an) * 0.05, y: Math.sin(an) * 0.05 }, i + j);
          }
          sortAt = p;
        }
        // The crust: low stones all along the crack between the clusters, coming up as the crack passes.
        if (!k.fast) for (const at of [0.15, 0.28, 0.57, 0.85]) {
          const g = easeBack(seg(run, at - 0.03, at + 0.15)) * sink;
          if (g <= 0.02) continue;
          const p = along(at);
          const sx = (hashOf(k.seed + 97 + i, at * 100) - 0.5) * 0.06;
          put({ x: p.x + sx, y: p.y - sx }, (3 + hashOf(k.seed + 98 + i, at * 100)) * g, 1.6, { x: sx, y: -sx }, i + at * 10);
          sortAt = sortAt ?? p;
        }
        if (sortAt && stones.length) {
          stones.sort((p, q) => p.y - q.y);
          k.worldDraw(sortAt, (g) => { for (const s of stones) s.paint(g); }, 0);
        }
      }
      // Each creature caught is rooted when the crack running its way reaches it: one mark on all of them, one shape.
      k.together(() => caught(k, c, MASS_R, 5, age).forEach((b, i) => {
        const reached = seg(run, Math.hypot(b.x - c.x, b.y - c.y) / MASS_R - 0.05, 1);
        if (reached > 0) rootSpikes(k, b, seg(age, 0.5 * Math.hypot(b.x - c.x, b.y - c.y) / MASS_R, 1) * sink, a, 60 + i * 5, 5, false);
      }));
      // How long is left, round the rim of what it reaches -- not at the caster's feet, where it would say the caster is held.
      tally(k, c, MASS_R * 1.04, left, age + left, 0.8 * a, 24);
      if (left < 0.6 && once(k, 'sank')) k.burst({ ...c, z: c.z + 0.5 }, 16, { kind: 'dust', colour: '#8f8a7a', size: 3, life: [0.4, 0.8], speed: [0.6, 1.6], up: [2, 6], gravity: 4 });
    } },
  },
};

/**
 * The noose's cord wound up round a body: a thin cord run diagonally `turns` round it, fitted to it (long along the way it
 * faces), from the noose at its feet up to `top` of its height, the near half over it. Returns where the cord ends, for the
 * knot. A rope wrapped and tied, where Bind's fetter is links of chain.
 */
function windings(k: FxScene, b: Body, top: number, turns: number, a: number, spin: number): P3 | null {
  if (a <= 0.01 || top <= 0.02) return null;
  const { len, side } = build(k, b);
  const L = len + 0.8, S = side + 0.6;
  const n = Math.max(12, Math.round(turns * 12));
  const cy = k.sy({ x: b.x, y: b.y, z: b.z });
  const near: number[][] = [], far: number[][] = [];
  let cur: number[] = [], curNear = false;
  let end: P3 | null = null;
  for (let i = 0; i <= n; i++) {
    const v = i / n;
    const an = spin + v * turns * TAU;
    const p = k.local(b, Math.cos(an) * S, Math.sin(an) * L, 1 + (b.tall * top - 1) * v);
    const isNear = k.sy({ x: p.x, y: p.y, z: b.z }) > cy;
    const sx = k.sx(p), sy = k.sy(p);
    if (i === 0) curNear = isNear;
    if (isNear !== curNear) {
      cur.push(sx, sy);
      (curNear ? near : far).push(cur);
      cur = [sx, sy];
      curNear = isNear;
    } else cur.push(sx, sy);
    end = p;
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
    g.lineWidth = Math.max(1.4, 1.4 * Z);
    g.strokeStyle = nightInk(k, P.main);
    g.stroke();
    g.lineWidth = Math.max(0.7, 0.8 * Z);
    g.strokeStyle = isNear ? P.main : P.deep;
    g.stroke();
  };
  const foot = { x: b.x, y: b.y, z: b.z };
  if (far.length) k.worldDraw(foot, paint(far, false), -3);
  if (near.length) k.worldDraw(foot, paint(near, true), 3);
  return end;
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
    // The noose skims low over the ground, open, its cord trailing back to the hand and sagging as rope does.
    travel: { secs: (tiles) => 0.12 + tiles * 0.07, draw: (k, u) => {
      const from = k.hand(1);
      // Out of the hand and down, to skim the last of the way a hand's breadth off the ground.
      const c = arcAt(from, k.on(k.spot.x, k.spot.y, 3), easeOut(u), 2);
      const r = 0.08 + 0.32 * smooth(u);
      hoop(k, c, c.z, r, { h: 0.7, n: 10, turn: u * 4, alpha: 0.95, glow: 0.4 });
      const d = k.toward(k.caster, k.spot);
      const near = { x: c.x - d.x * r, y: c.y - d.y * r, z: c.z };
      k.string(from, near, { sag: 1 + k.dist * 0.8 * u, width: 1, main: P.main, glow: 0, alpha: 0.95 });
    } },
    hit: (k) => {
      k.burst(k.at(k.target, 0.05), 10, { kind: 'dust', colour: '#8f8a7a', size: 2.6, life: [0.4, 0.7], speed: [0.2, 0.5], up: [2, 6], gravity: 4 });
      k.burst(k.at(k.target, 0.1), 10, { kind: 'mote', colour: [P.core, P.main], size: 1.6, life: [0.3, 0.6], speed: [0.3, 0.6], up: [2, 8], gravity: 0 });
    },
    impact: { secs: 0.45, draw: (k, u) => {
      k.light(k.target, 2.4, 0.6 * (1 - u));
    } },
    // The noose pulled shut on the feet, then the cord running up and round it twice, on the slant, to a knot: one thing,
    // tied where it stands.
    linger: { draw: (k, age, left) => {
      const b = k.target;
      const a = life(age, left, 0.02, 0.45);
      const shut = easeBack(seg(age, 0, 0.18));
      const wind = easeOut(seg(age, 0.12, 0.6)) * (1 - 0.6 * (1 - smooth(left / 0.45)));
      hoop(k, b, b.z + 1, girth(b) * lerp(2.6, 1.1, shut), { h: 0.7, n: 10, alpha: a, glow: 0.4, turn: age * 0.2 });
      const end = windings(k, b, 0.62 * wind, 2 * wind, a, (1 - wind) * 3);
      // The knot, a small sapphire where the cord is tied off.
      if (end && wind > 0.3) gemAt(k, end, smooth((wind - 0.3) / 0.4), 1.4, age * 0.8, { alpha: a, bias: 6 });
      k.glow(k.at(b, 0.3), b.tall * 0.6, a * (0.2 + 0.25 * k.night));
      tally(k, b, girth(b) * 2.2, left, age + left, 0.8 * a);
      k.light(b, 1.2, (0.3 + 0.2 * k.night) * a);
      if (left < 0.25 && once(k, 'loose')) k.burst(k.at(b, 0.4), 14, { kind: 'mote', colour: [P.core, P.main], size: 1.6, life: [0.3, 0.6], speed: [0.2, 0.6], up: [2, 10], gravity: 0 });
    } },
  },
};

/**
 * The still field's dome, `r` tiles round and `h` height units high: a bell of cut glass, its near facets filled faintly in
 * two tones, its ribs inked, the ribs on its upper left lit; the far half behind what is in it. Only its rim and its crown
 * glow -- the glow over every rib was a third of what a busy screen cost.
 */
function dome(k: FxScene, c: { x: number; y: number; z: number }, r: number, h: number, a: number, turn: number): void {
  if (a <= 0.01 || r <= 0.05) return;
  const ribs = k.fast ? 4 : 8;
  const cx = k.sx({ x: c.x, y: c.y, z: c.z }), cy = k.sy({ x: c.x, y: c.y, z: c.z });
  const at = (an: number, v: number): P3 => {
    // v nought at the rim, one at the crown; a squashed sphere.
    const rr = r * Math.cos((v * Math.PI) / 2), z = c.z + h * Math.sin((v * Math.PI) / 2);
    return { x: c.x + Math.cos(an) * rr, y: c.y + Math.sin(an) * rr, z };
  };
  const isNear = (an: number): boolean => k.sy({ x: c.x + Math.cos(an) * r, y: c.y + Math.sin(an) * r, z: c.z }) > cy - 0.5;
  const nearLines: number[] = [], farLines: number[] = [], litLines: number[] = [];
  const line = (list: number[], p: P3, q: P3): void => { list.push(k.sx(p), k.sy(p), k.sx(q), k.sy(q)); };
  // The ribs, five pieces each from the rim to the crown.
  for (let i = 0; i < ribs; i++) {
    const an = turn + (i / ribs) * TAU;
    const near = isNear(an), lit = near && k.sx(at(an, 0)) < cx;
    for (let j = 0; j < 5; j++) line(lit ? litLines : near ? nearLines : farLines, at(an, j / 5), at(an, (j + 1) / 5));
  }
  // Two rings round it and the rim, finer than the ribs so it stays round.
  const m = ribs * 4;
  for (const v of [0, 0.42, 0.78]) {
    for (let i = 0; i < m; i++) {
      const a0 = turn + (i / m) * TAU, a1 = turn + ((i + 1) / m) * TAU;
      line(isNear((a0 + a1) / 2) ? nearLines : farLines, at(a0, v), at(a1, v));
    }
  }
  // The near facets between the ribs, in two bands, filled faintly: cut glass rather than a wire cage.
  const facets: Array<{ pts: number[]; tone: number }> = [];
  for (let i = 0; i < ribs; i++) {
    const a0 = turn + (i / ribs) * TAU, a1 = turn + ((i + 1) / ribs) * TAU;
    if (!isNear((a0 + a1) / 2)) continue;
    for (const [v0, v1, band] of [[0, 0.42, 0], [0.42, 0.78, 1]] as const) {
      const ps = [at(a0, v0), at(a1, v0), at(a1, v1), at(a0, v1)];
      const pts: number[] = [];
      for (const p of ps) pts.push(k.sx(p), k.sy(p));
      facets.push({ pts, tone: (i + band) % 2 });
    }
  }
  const Z = k.zoom;
  const stroke = (g: CanvasRenderingContext2D, segs: number[]): void => {
    g.beginPath();
    for (let i = 0; i < segs.length; i += 4) {
      g.moveTo(segs[i], segs[i + 1]);
      g.lineTo(segs[i + 2], segs[i + 3]);
    }
    g.stroke();
  };
  const far = (g: CanvasRenderingContext2D): void => {
    g.globalAlpha = clamp(a * 0.45);
    g.lineCap = 'round';
    g.lineWidth = Math.max(1, 0.8 * Z);
    g.strokeStyle = P.ink;
    stroke(g, farLines);
    g.lineWidth = Math.max(0.5, 0.4 * Z);
    g.strokeStyle = P.main;
    stroke(g, farLines);
  };
  const near = (g: CanvasRenderingContext2D): void => {
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const f of facets) {
      g.globalAlpha = clamp(a * (f.tone ? 0.08 : 0.12));
      g.fillStyle = f.tone ? P.main : P.core;
      g.beginPath();
      g.moveTo(f.pts[0], f.pts[1]);
      for (let j = 2; j < 8; j += 2) g.lineTo(f.pts[j], f.pts[j + 1]);
      g.closePath();
      g.fill();
    }
    g.globalAlpha = clamp(a * 0.85);
    g.lineWidth = Math.max(1.2, 0.95 * Z);
    g.strokeStyle = nightInk(k, P.deep);
    stroke(g, nearLines);
    stroke(g, litLines);
    g.lineWidth = Math.max(0.5, 0.4 * Z);
    g.strokeStyle = P.main;
    stroke(g, nearLines);
    g.lineWidth = Math.max(0.7, 0.6 * Z);
    g.strokeStyle = P.core;
    stroke(g, litLines);
  };
  // Sorted at its far edge and its near edge, so whatever stands inside it is between the two halves.
  const d = k.toward({ x: 0, y: 0 }, { x: 1, y: 1 });
  k.worldDraw({ x: c.x - d.x * r, y: c.y - d.y * r, z: c.z }, far, -2);
  k.worldDraw({ x: c.x + d.x * r, y: c.y + d.y * r, z: c.z }, near, 2);
  if (!k.fast) {
    // The rim's glow, and the crown's.
    const rim = new Path2D();
    for (let i = 0; i <= m; i++) {
      const p = at(turn + (i / m) * TAU, 0);
      if (i) rim.lineTo(k.sx(p), k.sy(p));
      else rim.moveTo(k.sx(p), k.sy(p));
    }
    const pic = k.pal.light;
    k.glowDraw((g) => {
      g.globalAlpha = clamp(a * (0.18 + 0.15 * k.night));
      g.strokeStyle = pic;
      g.lineWidth = 2.4 * Z;
      g.stroke(rim);
    });
    k.glow({ x: c.x, y: c.y, z: c.z + h }, 8, a * 0.4);
  }
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
      k.flare(k.at(k.caster, 1.15), 8 * (1 - u * 0.6), 0.8 * flashOf(u, 0.08), P.core);
      k.ring(c, FIELD_R * easeOut(u), { band: 0.12 * (1 - u) + 0.02, alpha: 1 - u, glow: 0.6 });
      k.light(c, FIELD_R * 0.6, 0.7 * (1 - u * 0.5), '#fff1d6');
    } },
    linger: { on: 'spot', draw: (k, age, left) => {
      const c = { ...fieldAt(k), tall: k.caster.tall };
      const a = life(age, left, 0.02, 0.5);
      const out = easeOut(seg(age, 0, 0.35));
      const r = FIELD_R * out, h = c.tall * 2.1 * out;
      dome(k, { x: c.x, y: c.y, z: c.z }, r, h, a * (0.55 + 0.45 * (1 - smooth(seg(age, 0.3, 1.2)))), 0.2);
      frozenMotes(k, { x: c.x, y: c.y, z: c.z }, FIELD_R, c.tall * 2.1, a * smooth(seg(age, 0.3, 0.6)), age);
      // Whatever is caught stops where it stands: a band of frost round it, clasped with a stone on the side toward the
      // viewer -- on the band, not hung over its head.
      const d = k.toward({ x: 0, y: 0 }, { x: 1, y: 1 });
      k.together(() => caught(k, c, r, 5, age).forEach((b, i) => {
        const s = smooth(seg(age, 0.15 + 0.05 * i, 0.4 + 0.05 * i)) * smooth((k.secsOn(b, age + left) - age) / 0.3);
        const rr = girth(b) * lerp(1.8, 1.05, easeBack(s)), z = b.z + b.tall * 0.45;
        hoop(k, b, z, rr, { alpha: a * s, h: band(b) * 0.7, n: 8, glow: 0.3, main: P.core, core: '#ffffff' });
        gemAt(k, { x: b.x + d.x * rr, y: b.y + d.y * rr, z }, s, 1.3, 0.4 + i, { alpha: a, bias: 6 });
      }));
      // How long is left, round the rim of the field -- not at the caster's feet.
      tally(k, c, FIELD_R * 1.05, left, age + left, 0.8 * a, 24);
      k.light(c, FIELD_R * 0.6, 0.3 * a, '#fff1d6');
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
