/**
 * The Warder's spells: how each is cast and what it looks like.
 *
 * A Warder's work is a skin -- something laid over a body that takes the
 * blows before the shield and the armour do -- and every spell here is drawn
 * out of one shape: the hexagon. A skin is a lattice of topaz plates over an
 * egg round whoever it is on, emerald on their shaded side; a stone skin is
 * basalt, which breaks into hexagons of itself; the ground a Warder marks is
 * marked with hexagons; even the crystal of an Unbreakable is a hexagonal
 * prism. So a Warder's spell is a Warder's from across a field before it is
 * any one of them, and each is told from the others by how the plates come
 * (knitted out from the heart, let down from overhead, lifted out of the
 * ground, closed from behind like a pair of doors, thrown and wrapped round
 * somebody else) and by how thick they lie, which is the size of the skin.
 *
 * A skin shows for `SKIN_SHOWN` seconds, the island not saying when one is
 * used up. Over that time it has to read as a ward on the body without
 * hiding the body: the plates facing the viewer are nearly clear and only
 * their edges show, the ones seen edge-on at the rim are the solid ones (as
 * a soap bubble is), and the back half is drawn behind the body, so the
 * person shows through the middle of it and the shape of the skin is told by
 * its outline. A slow glint goes over it now and then, and it ends by
 * flaking away rather than fading, as a skin worn through would.
 *
 * Nothing here keeps anything between frames but `k.state`, and the one
 * table of plates (`lattice`), which is made once and never changes.
 */
import { HEIGHT_SCALE } from '../iso';
import type { CastPose, SpellVisual } from './index';
import { spellInfo } from './info';
import { arcAt, bump, clamp, easeBack, easeIn, easeOut, flashOf, hashOf, lerp, mid3, seg, smooth, TAU, type Body, type FxScene, type P3, type SpellPalette } from './kit';
import { euler, one } from './poses';

/** A skin: topaz gold over emerald green. */
export const PALETTE: SpellPalette = {
  core: '#fffbe0',
  main: '#e8c95a',
  deep: '#3f9a62',
  accent: '#6fe0a0',
  ink: '#2a3a1a',
  light: '#f2e08a',
};

/** Emerald over topaz: a Bulwark, out of the rarer stone, the same skin in the other stone's colour. */
const EMERALD: SpellPalette = {
  core: '#efffe8',
  main: '#74dca0',
  deep: '#2c7a52',
  accent: '#e8c95a',
  ink: '#16341f',
  light: '#a6f0c4',
};

/** Basalt veined with topaz: a Stoneskin and a Bastion, the skin made of stone. */
const STONE: SpellPalette = {
  core: '#d6d0b6',
  main: '#a29d86',
  deep: '#6a6758',
  accent: '#f0cf5c',
  ink: '#25241c',
  light: '#f2e08a',
};
const DUST = ['#8f8a74', '#a8a189', '#6f6b5a'];

const DEG = Math.PI / 180;
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/* ---- the spells' own numbers ------------------------------------------------------------- */

const fxOf = (id: string): Readonly<Record<string, number>> => spellInfo(id)?.fx ?? {};
/** A skin's size as a share of an Aegis's: a Warder's own `skin`, or an arcane spell's power over the Aegis's. */
function skinOf(id: string): number {
  const fx = fxOf(id);
  if (fx.skin) return fx.skin;
  const aegis = fxOf('aegis').power || 1;
  return fx.power ? fx.power / aegis : 1;
}
/** How solid a skin's plates are drawn: a thin one is mostly edges, a full one has faces. */
const fillOf = (skin: number): number => 0.16 + 0.34 * Math.min(1, skin);
/** And how heavy its edges are. */
const widthOf = (skin: number): number => 0.55 + 0.45 * Math.min(1, skin);
/** Tiles round the caster a spell on oneself reaches. */
const reachOf = (id: string): number => spellInfo(id)?.radius || fxOf(id).reach || 1;

/* ---- the lattice: plates over an egg ------------------------------------------------------ */

/**
 * The plates of a skin, on a unit sphere: rows of hexagons by latitude,
 * every other row turned half a plate so they lie as scales do. X is to the
 * screen's right, Y up, D toward the viewer; a body is fitted to it by
 * squashing it to the body's egg as it is drawn. Made once for each graphics
 * setting and kept: it is a shape, not a frame's state.
 */
interface Lattice {
  n: number;
  /** Each plate's middle, three numbers a plate. */
  c: Float32Array;
  /** Its six corners, eighteen numbers a plate. */
  v: Float32Array;
  /** A number of its own, nought to one: which flakes first, which cracks. */
  h: Float32Array;
}

function latticeOf(rows: readonly number[], around: number, rho: number): Lattice {
  const cs: number[] = [], vs: number[] = [], hs: number[] = [];
  rows.forEach((lat, ri) => {
    const ph = lat * DEG;
    const n = Math.max(3, Math.round(around * Math.cos(ph)));
    for (let i = 0; i < n; i++) {
      const th = ((i + (ri % 2) * 0.5) / n) * TAU;
      const cx = Math.cos(ph) * Math.sin(th), cy = Math.sin(ph), cz = Math.cos(ph) * Math.cos(th);
      cs.push(cx, cy, cz);
      // The corners laid out in the plane touching the sphere there, then put back onto it: a hexagon that keeps its
      // shape near the top as well as round the middle.
      const ex = Math.cos(th), ez = -Math.sin(th);
      const nx = -Math.sin(ph) * Math.sin(th), ny = Math.cos(ph), nz = -Math.sin(ph) * Math.cos(th);
      for (let j = 0; j < 6; j++) {
        const a = (j / 6) * TAU;
        const ox = cx + rho * (Math.cos(a) * ex + Math.sin(a) * nx), oy = cy + rho * Math.sin(a) * ny, oz = cz + rho * (Math.cos(a) * ez + Math.sin(a) * nz);
        const l = Math.hypot(ox, oy, oz);
        vs.push(ox / l, oy / l, oz / l);
      }
      hs.push(hashOf(ri * 97 + i, 13));
    }
  });
  return { n: hs.length, c: Float32Array.from(cs), v: Float32Array.from(vs), h: Float32Array.from(hs) };
}

let fullLattice: Lattice | null = null;
let fastLattice: Lattice | null = null;
/** The plates, about sixty of them, or half that on fast graphics. The bottom row stops at the ankles: a skin is not drawn under the ground. */
const lattice = (fast: boolean): Lattice =>
  fast ? (fastLattice ??= latticeOf([-46, -12, 22, 56], 9, 0.3)) : (fullLattice ??= latticeOf([-52, -26, 0, 26, 52, 76], 13, 0.24));

/** Which way a body faces, as an angle on the lattice: nought at the viewer, a quarter turn to the screen's right. */
const frontOf = (b: Body): number => (b.facing * Math.PI) / 4;
/** Which way from one body another is, as an angle on the lattice round the first. */
function bearing(k: FxScene, from: Body, to: { x: number; y: number; z: number }): number {
  const dx = k.sx(to) - k.sx(from), dy = k.sy({ x: to.x, y: to.y, z: from.z }) - k.sy(from);
  return Math.abs(dx) + Math.abs(dy) < 0.5 ? frontOf(from) : Math.atan2(dx, dy * 2);
}

/** How a skin is laid down: out from a point on it, up from the feet, down from the head, round in a spiral, or closed from behind to a seam in front. */
type Knit =
  | { from: 'point'; th: number; ph: number }
  | { from: 'up' }
  | { from: 'down' }
  | { from: 'spiral'; th: number }
  | { from: 'close'; th: number };

/** When a plate comes, nought first to one last, by where it is on the egg. */
function keyOf(kn: Knit, X: number, Y: number, D: number): number {
  switch (kn.from) {
    case 'up':
      return (Y + 1) / 2;
    case 'down':
      return (1 - Y) / 2;
    case 'point': {
      const c = Math.cos(kn.ph);
      return Math.acos(clamp(X * c * Math.sin(kn.th) + Y * Math.sin(kn.ph) + D * c * Math.cos(kn.th), -1, 1)) / Math.PI;
    }
    case 'close':
      return 1 - Math.abs(wrap(Math.atan2(X, D) - kn.th)) / Math.PI;
    case 'spiral': {
      const a = (((Math.atan2(X, D) - kn.th) / TAU) % 1 + 1) % 1;
      return ((Y + 1) / 2) * 0.62 + a * 0.38;
    }
  }
}

interface SkinLook {
  alpha: number;
  /** Over the body's own egg. */
  size?: number;
  /** Radians the lattice is turned about the upright. */
  turn?: number;
  /** How solid the faces are (`fillOf`). */
  fill?: number;
  width?: number;
  /** How much of it is laid, nought to one, and how. */
  cover?: number;
  knit?: Knit;
  /** Freshly laid: hot edges, brighter faces. */
  heat?: number;
  /** Where a glint crossing it is, nought to one, or below nought for none. */
  glint?: number;
  /** Cracking, nought to one: the plates jostle and a line of light opens across them. */
  crack?: number;
  /** Worn away, nought to one: that share of the plates gone. */
  flake?: number;
  pal?: SpellPalette;
}

/**
 * A skin over a body: the lattice fitted to an egg round it, the back half
 * drawn behind the body and the front half over it. Faces toward the viewer
 * are nearly clear and the rim nearly solid, so it is the outline that says
 * there is a skin and the body still shows in the middle of it.
 */
function skin(k: FxScene, b: Body, o: SkinLook): void {
  const al = clamp(o.alpha);
  if (al <= 0.01) return;
  const L = lattice(k.fast);
  const size = o.size ?? 1;
  const mid = k.at(b, 0.5);
  const cx = k.sx(mid), cy = k.sy(mid);
  const ry = b.tall * HEIGHT_SCALE * k.zoom * 0.56 * size;
  const rx = Math.max(ry * 0.52, b.wide * 2.6 * k.zoom * size);
  const turn = o.turn ?? 0, ct = Math.cos(turn), st = Math.sin(turn);
  const cover = o.cover ?? 1, heat = o.heat ?? 0, glint = o.glint ?? -1, crack = o.crack ?? 0, flake = o.flake ?? 0;
  const fill = o.fill ?? 0.4;
  const pal = o.pal ?? k.pal;
  const tones = [pal.deep, pal.main, pal.core];
  const W = Math.max(0.6, (o.width ?? 0.8) * k.zoom);
  const n = L.n;
  const xy = new Float32Array(n * 12);
  const tone = new Uint8Array(n), side = new Int8Array(n), hot = new Uint8Array(n);
  const fa = new Float32Array(n), la = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (L.h[i] < flake) continue;
    const X0 = L.c[3 * i], Y = L.c[3 * i + 1], D0 = L.c[3 * i + 2];
    const X = X0 * ct + D0 * st, D = D0 * ct - X0 * st;
    let v = 1;
    if (cover < 1 && o.knit) {
      v = clamp((cover * 1.3 - keyOf(o.knit, X, Y, D)) / 0.3);
      if (v <= 0) continue;
    }
    // A new plate comes in small and snaps to its size; a cracking one is pushed out a little and shivers.
    const s = 0.3 + 0.7 * easeBack(v);
    const push = 1 + crack * (0.04 + 0.1 * L.h[i]) * (0.7 + 0.3 * Math.sin(k.now * 47 + i * 2.3));
    for (let j = 0; j < 6; j++) {
      const q = 18 * i + 3 * j;
      const vx0 = L.v[q], vy = L.v[q + 1], vd0 = L.v[q + 2];
      const vx = vx0 * ct + vd0 * st, vd = vd0 * ct - vx0 * st;
      const px = (X + (vx - X) * s) * push, py = (Y + (vy - Y) * s) * push, pd = (D + (vd - D) * s) * push;
      xy[12 * i + 2 * j] = cx + rx * px;
      xy[12 * i + 2 * j + 1] = cy - ry * py + rx * 0.5 * pd;
    }
    const depth = D * 0.87 + Y * 0.42;
    const lit = -0.5 * X + 0.62 * Y + 0.6 * D;
    const g = glint >= 0 ? clamp(1 - Math.abs((Y * 0.8 - X * 0.6 + 1.4) / 2.8 - glint) / 0.09) : 0;
    // Only a plate still settling, or one under the glint, has a hot edge: a whole skin of hot edges is a white egg.
    const h = Math.max(1 - v, g);
    hot[i] = h > 0.3 ? 1 : 0;
    if (depth >= 0) {
      // Facing the viewer: clear in the middle, solid toward the rim where it is seen edge-on.
      const e = 1 - clamp(depth);
      side[i] = 1;
      fa[i] = al * clamp(fill * (0.04 + 0.96 * e * e) + 0.25 * h * fill + 0.2 * g);
      la[i] = al * clamp(0.1 + 0.75 * e * Math.sqrt(e) + 0.35 * h + 0.25 * heat);
      tone[i] = lit > 0.78 ? 2 : lit > -0.05 ? 1 : 0;
    } else {
      side[i] = -1;
      fa[i] = al * fill * 0.6;
      la[i] = al * 0.35;
      tone[i] = lit > 0.3 ? 1 : 0;
    }
  }
  // The egg's own outline, behind the body: the shape of the skin is told by it, and it never crosses the person.
  const rim: number[] = [];
  for (let j = 0; j < 28; j++) {
    const an = (j / 28) * TAU;
    rim.push(cx + Math.cos(an) * rx, cy + Math.sin(an) * (ry * 0.97) + rx * 0.05);
  }
  /*
   * Drawn in runs rather than a plate at a time: every plate's fill, edge and
   * ink keyed by its colour and its opacity to a fifteenth, the plates sorted
   * by key, and each run of one key filled or stroked once. Sixty plates come
   * to a dozen fills and strokes instead of a hundred and fifty, which is what
   * lets a crowd of warded people stand on one screen.
   */
  const q = (v: number): number => Math.round(clamp(v) * 15);
  const fk = new Int16Array(n), sk = new Int16Array(n), ik = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    fk[i] = side[i] ? tone[i] * 16 + q(fa[i]) : 0;
    sk[i] = side[i] ? (side[i] === 1 && hot[i] ? 16 : 0) + q(la[i]) : 0;
    ik[i] = side[i] === 1 && fa[i] > al * fill * 0.3 ? q(la[i] * 0.5) : 0;
  }
  // The plates on one side with something to draw for these keys, in key order. A key's low four bits are its opacity.
  const order = (keys: Int16Array, which: number): number[] => {
    const idx: number[] = [];
    for (let i = 0; i < n; i++) if (side[i] === which && keys[i] % 16 > 0) idx.push(i);
    return idx.sort((x, y) => keys[x] - keys[y]);
  };
  const runs = (g: CanvasRenderingContext2D, idx: number[], keys: Int16Array, paint: (key: number) => void): void => {
    for (let s0 = 0; s0 < idx.length;) {
      const key = keys[idx[s0]];
      g.beginPath();
      let e = s0;
      for (; e < idx.length && keys[idx[e]] === key; e++) {
        const i = idx[e];
        g.moveTo(xy[12 * i], xy[12 * i + 1]);
        for (let j = 1; j < 6; j++) g.lineTo(xy[12 * i + 2 * j], xy[12 * i + 2 * j + 1]);
        g.closePath();
      }
      paint(key);
      s0 = e;
    }
  };
  const backFill = order(fk, -1), backEdge = order(sk, -1);
  const frontFill = order(fk, 1), frontInk = order(ik, 1), frontEdge = order(sk, 1);
  const cracked: number[] = [];
  if (crack > 0) for (let i = 0; i < n; i++) if (side[i] === 1 && L.h[i] < crack * 0.7) cracked.push(i);
  const foot = { x: b.x, y: b.y, z: b.z };
  const whole = smooth((cover - 0.85) / 0.15) * (1 - smooth(flake * 4));
  k.worldDraw(foot, (g) => {
    g.lineJoin = 'round';
    if (whole > 0) {
      g.beginPath();
      g.moveTo(rim[0], rim[1]);
      for (let j = 2; j < rim.length; j += 2) g.lineTo(rim[j], rim[j + 1]);
      g.closePath();
      g.globalAlpha = al * whole * fill * 0.35;
      g.fillStyle = pal.deep;
      g.fill();
      g.globalAlpha = al * whole * 0.7;
      g.strokeStyle = pal.ink;
      g.lineWidth = W * 1.6;
      g.stroke();
    }
    runs(g, backFill, fk, (key) => {
      g.globalAlpha = (key % 16) / 15;
      g.fillStyle = tones[key >> 4];
      g.fill();
    });
    g.lineWidth = W * 0.8;
    g.strokeStyle = pal.main;
    runs(g, backEdge, sk, (key) => {
      g.globalAlpha = (key % 16) / 15;
      g.stroke();
    });
  }, -0.3);
  k.worldDraw(foot, (g) => {
    g.lineJoin = 'round';
    runs(g, frontFill, fk, (key) => {
      g.globalAlpha = (key % 16) / 15;
      g.fillStyle = tones[key >> 4];
      g.fill();
    });
    // Ink under a gold edge toward the rim, the island's own way of drawing a thing; over the middle of the body a gold
    // seam alone, thin, so the person reads through it.
    g.strokeStyle = pal.ink;
    g.lineWidth = W * 1.8;
    runs(g, frontInk, ik, (key) => {
      g.globalAlpha = (key % 16) / 15;
      g.stroke();
    });
    g.lineWidth = W * 0.75;
    runs(g, frontEdge, sk, (key) => {
      g.globalAlpha = (key % 16) / 15;
      g.strokeStyle = key >= 16 ? pal.core : pal.main;
      g.stroke();
    });
    if (cracked.length) {
      // A line of light across each cracked plate, corner to corner through a kink.
      g.globalAlpha = clamp(al * crack * 0.9);
      g.strokeStyle = pal.core;
      g.lineWidth = W * 1.1;
      g.beginPath();
      for (const i of cracked) {
        const j = Math.floor(L.h[i] * 60) % 3;
        const mx = (xy[12 * i] + xy[12 * i + 6]) / 2 + (L.h[i] - 0.5) * W * 3, my = (xy[12 * i + 1] + xy[12 * i + 7]) / 2;
        g.moveTo(xy[12 * i + 2 * j], xy[12 * i + 2 * j + 1]);
        g.lineTo(mx, my);
        g.lineTo(xy[12 * i + 2 * (j + 3)], xy[12 * i + 2 * (j + 3) + 1]);
      }
      g.stroke();
    }
  }, 0.6);
  if (whole > 0) {
    // The rim again as light, over the night: by day it adds next to nothing, by night it is what shows the skin.
    k.glowDraw((g) => {
      g.globalAlpha = clamp(al * whole * 0.22);
      g.strokeStyle = pal.light;
      g.lineWidth = W * 2.2;
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(rim[0], rim[1]);
      for (let j = 2; j < rim.length; j += 2) g.lineTo(rim[j], rim[j + 1]);
      g.closePath();
      g.stroke();
    });
  }
  const glow = 0.1 + 0.35 * heat + 0.5 * crack;
  k.glow(mid, (ry / k.zoom) * 1.05, al * glow, pal.light);
}

/**
 * A skin as it lingers over somebody for as long as it is shown: knitted on
 * from `delay` over `knit` seconds, settling from hot to quiet, a glint
 * crossing it every few seconds, a few motes coming off it, and at the end
 * flaking away a plate at a time.
 */
function skinLinger(k: FxScene, b: Body, age: number, left: number, o: {
  knit: Knit; secs: number; delay?: number; skin: number; size?: number; spin?: number; pal?: SpellPalette; layer?: number;
  /** False for a skin on somebody else covered by the same spell: no light of its own, the cast's two lights being spent. */
  lit?: boolean;
}): void {
  const t = age - (o.delay ?? 0);
  if (t <= 0) return;
  const pal = o.pal ?? k.pal;
  const cover = easeOut(t / o.secs);
  const heat = 1 - smooth((t - o.secs * 0.6) / 0.7);
  const settle = lerp(0.95, 0.72, smooth((t - o.secs) / 1.2));
  const end = 1.1;
  const flake = left < end ? 1 - left / end : 0;
  // A glint every four seconds, crossing the skin in most of one.
  const ph = (t - o.secs - 0.6) % 4.2;
  const glint = t > o.secs + 0.6 && ph < 0.9 ? ph / 0.9 : -1;
  const layer = o.layer ?? 0;
  skin(k, b, {
    alpha: settle, size: o.size, turn: (o.spin ?? 0.12) * age, fill: fillOf(o.skin), width: widthOf(o.skin), cover, knit: o.knit,
    heat, glint, flake, pal,
  });
  if (layer) return;
  if (flake > 0) {
    // Worn through: its plates come away as flakes and drop.
    k.emit(k.at(b, 0.55), 26, { kind: 'shard', colour: [pal.main, pal.deep], size: 1.5, life: [0.4, 0.8], speed: [0.2, 0.5], up: [2, 10], gravity: 50, jitter: 0.08, jitterZ: 6, spin: 2, bias: 1 });
  } else if (!k.fast && t > o.secs) {
    k.emit(k.at(b, 0.5), 2.2, { kind: 'mote', colour: [pal.core, pal.main], size: 1.0, life: [0.7, 1.2], speed: [0.02, 0.06], up: [4, 10], gravity: 0, jitter: 0.1, jitterZ: 6 });
  }
  if (o.lit !== false) k.light(b, 1.4, (0.26 + 0.35 * heat) * smooth(t / 0.3) * (1 - flake));
}

/* ---- other shapes of a Warder's ------------------------------------------------------------ */

/**
 * A hexagon lying level in the air round a body, `z` height units over its
 * feet and `r` tiles out: a halo let down over somebody, or lifted off the
 * ground. Its far side drawn behind them and its near side in front.
 */
function halo(k: FxScene, b: Body, z: number, r: number, o: { alpha: number; band?: number; turn?: number; hot?: number; pal?: SpellPalette }): void {
  const a = clamp(o.alpha);
  if (a <= 0.01 || r <= 0.005) return;
  const pal = o.pal ?? k.pal;
  const band = Math.min(r * 0.6, o.band ?? 0.035);
  const turn = o.turn ?? 0;
  const out: number[] = [], inn: number[] = [], near: boolean[] = [], left: boolean[] = [];
  const h = b.z + z;
  const cy = k.sy({ x: b.x, y: b.y, z: h });
  const cx = k.sx(b);
  for (let i = 0; i < 6; i++) {
    const an = turn + (i / 6) * TAU;
    for (const [rr, arr] of [[r, out], [r - band, inn]] as const) {
      const p = { x: b.x + Math.cos(an) * rr, y: b.y + Math.sin(an) * rr, z: h };
      arr.push(k.sx(p), k.sy(p));
    }
  }
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    near.push((out[2 * i + 1] + out[2 * j + 1]) / 2 > cy);
    left.push((out[2 * i] + out[2 * j]) / 2 < cx);
  }
  const W = Math.max(0.8, 0.7 * k.zoom);
  const draw = (front: boolean) => (g: CanvasRenderingContext2D): void => {
    g.lineJoin = 'round';
    for (let i = 0; i < 6; i++) {
      if (near[i] !== front) continue;
      const j = (i + 1) % 6;
      g.beginPath();
      g.moveTo(out[2 * i], out[2 * i + 1]);
      g.lineTo(out[2 * j], out[2 * j + 1]);
      g.lineTo(inn[2 * j], inn[2 * j + 1]);
      g.lineTo(inn[2 * i], inn[2 * i + 1]);
      g.closePath();
      g.globalAlpha = a * (front ? 1 : 0.7);
      g.fillStyle = (o.hot ?? 0) > 0.5 ? pal.core : front ? (left[i] ? pal.core : pal.main) : pal.deep;
      g.fill();
      g.strokeStyle = pal.ink;
      g.lineWidth = W;
      g.stroke();
    }
  };
  const foot = { x: b.x, y: b.y, z: b.z };
  k.worldDraw(foot, draw(false), -0.3);
  k.worldDraw(foot, draw(true), 0.7);
  k.glow({ x: b.x, y: b.y, z: h }, 6 + r * 60, a * (0.25 + 0.4 * (o.hot ?? 0)), pal.light);
}

/**
 * Hexagons laid on the ground in a ring round a point, `R` tiles out, each
 * `cell` tiles across the corners: the edge of what a Warder's spell covers.
 * `grow` lays them one after another round the ring.
 */
function hexRow(k: FxScene, c: { x: number; y: number }, R: number, cell: number, o: { alpha: number; grow?: number; turn?: number; pal?: SpellPalette; lift?: number }): void {
  const most = k.fast ? 24 : 64;
  const n = Math.max(6, Math.min(most, Math.round((TAU * R) / (cell * 2.1))));
  const grow = o.grow ?? 1;
  const turn = o.turn ?? 0;
  const at: number[] = [];
  for (let i = 0; i < n; i++) {
    const sc = smooth((grow - (0.7 * i) / n) / 0.3);
    const an = turn + (i / n) * TAU;
    at.push(c.x + Math.cos(an) * R, c.y + Math.sin(an) * R, sc, an);
  }
  hexes(k, c, R + cell, at, cell, o);
}

/**
 * Small hexagons on the ground, each at (x, y) and scaled by its own share,
 * turned its own way -- four numbers a hexagon in `at` -- all in one mark:
 * the near ones lit and the far ones shaded, inked. Laid as shapes on the
 * ground (`groundShape`), so however many there are and however wide the
 * ring, it costs what it covers.
 */
function hexes(k: FxScene, c: { x: number; y: number }, reach: number, at: readonly number[], cell: number, o: { alpha: number; pal?: SpellPalette; lift?: number }): void {
  const a = clamp(o.alpha);
  if (a <= 0.01 || !at.length) return;
  const pal = o.pal ?? k.pal;
  const lit: number[][] = [], shade: number[][] = [];
  const cy = k.sy(k.on(c.x, c.y));
  for (let i = 0; i < at.length; i += 4) {
    const hx = at[i], hy = at[i + 1], sc = at[i + 2], an = at[i + 3];
    if (sc <= 0.02) continue;
    const pts: number[] = [];
    for (let j = 0; j < 6; j++) {
      const ca = an + (j / 6) * TAU;
      pts.push(hx + Math.cos(ca) * cell * sc, hy + Math.sin(ca) * cell * sc);
    }
    (k.sy(k.on(hx, hy)) >= cy ? lit : shade).push(pts);
  }
  if (!lit.length && !shade.length) return;
  const lift = o.lift ?? 0.15;
  k.groundShape(c.x, c.y, reach + 0.5, [
    { kind: 'fill', colour: pal.main, alpha: a, paths: lit, lift },
    { kind: 'fill', colour: pal.deep, alpha: a, paths: shade, lift },
    { kind: 'stroke', colour: pal.ink, alpha: a, width: Math.max(0.8, 0.7 * k.zoom), paths: [...lit, ...shade], closed: true, join: 'round', lift },
  ]);
}

/**
 * A hexagonal prism standing on `base`, `r` tiles across the corners and `h`
 * height units tall: a basalt column, a topaz crystal. Solid, it is its near
 * faces and its top in one picture; a cage (`cage` one), its far faces behind
 * a body and its near edges in front of it, with `level` of the near edges
 * lit from the bottom -- how much of it is left.
 */
function prism(k: FxScene, base: P3, r: number, h: number, o: {
  alpha: number; turn?: number; cage?: boolean; level?: number; faces?: number; pal?: SpellPalette; bias?: number; top?: string;
}): void {
  const a = clamp(o.alpha);
  if (a <= 0.01 || h <= 0.05) return;
  const pal = o.pal ?? k.pal;
  const turn = o.turn ?? 0;
  const bx: number[] = [], by: number[] = [], tx: number[] = [], ty: number[] = [];
  for (let i = 0; i < 6; i++) {
    const an = turn + (i / 6) * TAU;
    const p = { x: base.x + Math.cos(an) * r, y: base.y + Math.sin(an) * r, z: base.z };
    bx.push(k.sx(p));
    by.push(k.sy(p));
    p.z += h;
    tx.push(k.sx(p));
    ty.push(k.sy(p));
  }
  const ox = k.sx(base), oy = k.sy(base);
  const near: boolean[] = [], lit: boolean[] = [];
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    near.push((by[i] + by[j]) / 2 > oy + 0.01);
    lit.push((bx[i] + bx[j]) / 2 < ox);
  }
  const W = Math.max(0.8, 0.75 * k.zoom);
  const face = (g: CanvasRenderingContext2D, i: number): void => {
    const j = (i + 1) % 6;
    g.beginPath();
    g.moveTo(bx[i], by[i]);
    g.lineTo(bx[j], by[j]);
    g.lineTo(tx[j], ty[j]);
    g.lineTo(tx[i], ty[i]);
    g.closePath();
  };
  const top = (g: CanvasRenderingContext2D): void => {
    g.beginPath();
    g.moveTo(tx[0], ty[0]);
    for (let i = 1; i < 6; i++) g.lineTo(tx[i], ty[i]);
    g.closePath();
  };
  if (!o.cage) {
    k.worldDraw(base, (g) => {
      g.globalAlpha = a;
      g.lineJoin = 'round';
      g.strokeStyle = pal.ink;
      g.lineWidth = W;
      for (let i = 0; i < 6; i++) {
        if (!near[i]) continue;
        face(g, i);
        g.fillStyle = lit[i] ? pal.main : pal.deep;
        g.fill();
        g.stroke();
      }
      top(g);
      g.fillStyle = o.top ?? pal.core;
      g.fill();
      g.stroke();
    }, o.bias ?? 0);
    return;
  }
  const level = clamp(o.level ?? 1), faces = o.faces ?? 0.12;
  k.worldDraw(base, (g) => {
    g.lineJoin = 'round';
    for (let i = 0; i < 6; i++) {
      if (near[i]) continue;
      face(g, i);
      g.globalAlpha = a * faces * 0.8;
      g.fillStyle = pal.deep;
      g.fill();
      g.globalAlpha = a * 0.5;
      g.strokeStyle = pal.main;
      g.lineWidth = W;
      g.stroke();
    }
  }, -0.3);
  k.worldDraw(base, (g) => {
    g.lineJoin = 'round';
    for (let i = 0; i < 6; i++) {
      if (!near[i]) continue;
      face(g, i);
      g.globalAlpha = a * faces;
      g.fillStyle = lit[i] ? pal.core : pal.main;
      g.fill();
    }
    // The top and the foot.
    g.globalAlpha = a * 0.8;
    g.strokeStyle = pal.ink;
    g.lineWidth = W * 2.2;
    top(g);
    g.stroke();
    g.strokeStyle = level > 0.98 ? pal.core : pal.main;
    g.lineWidth = W;
    g.stroke();
    // The near uprights: lit from the foot as high as there is left of it, dim over that.
    for (let i = 0; i < 6; i++) {
      const prev = (i + 5) % 6;
      if (!near[i] && !near[prev]) continue;
      const mx = lerp(bx[i], tx[i], level), my = lerp(by[i], ty[i], level);
      g.globalAlpha = a * 0.8;
      g.strokeStyle = pal.ink;
      g.lineWidth = W * 2.4;
      g.beginPath();
      g.moveTo(bx[i], by[i]);
      g.lineTo(tx[i], ty[i]);
      g.stroke();
      g.globalAlpha = a * 0.45;
      g.strokeStyle = pal.main;
      g.lineWidth = W;
      g.stroke();
      g.globalAlpha = a;
      g.strokeStyle = pal.core;
      g.lineWidth = W * 1.5;
      g.beginPath();
      g.moveTo(bx[i], by[i]);
      g.lineTo(mx, my);
      g.stroke();
    }
  }, 0.7);
}

/**
 * A flat hexagonal plate in the air, `r` pixels at zoom one: a skin's plate
 * thrown, or broken off and flying. `spin` turns it about the upright (it
 * narrows edge-on), `tip` lays it toward flat.
 */
function plate(k: FxScene, p: P3, r: number, o: { alpha?: number; spin?: number; tip?: number; hot?: number; pal?: SpellPalette; bias?: number; glow?: number }): void {
  const a = clamp(o.alpha ?? 1);
  if (a <= 0.01 || r <= 0.1) return;
  const pal = o.pal ?? k.pal;
  const x = k.sx(p), y = k.sy(p), R = r * k.zoom;
  const cs = Math.cos(o.spin ?? 0);
  const wx = Math.max(0.16, Math.abs(cs)), wy = 1 - 0.45 * clamp(o.tip ?? 0);
  const faceUp = cs >= 0;
  const hot = clamp(o.hot ?? 0);
  k.worldDraw(p, (g) => {
    g.globalAlpha = a;
    const corner = (j: number): [number, number] => {
      const an = (j / 6) * TAU + Math.PI / 6;
      return [x + Math.cos(an) * R * wx, y + Math.sin(an) * R * wy];
    };
    g.beginPath();
    for (let j = 0; j < 6; j++) {
      const [px, py] = corner(j);
      if (j === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fillStyle = hot > 0.5 ? pal.core : faceUp ? pal.main : pal.deep;
    g.fill();
    g.lineWidth = Math.max(0.8, 0.7 * k.zoom);
    g.strokeStyle = pal.ink;
    g.stroke();
    // The facet the light catches, up and to the left.
    const [ax, ay] = corner(3), [bx2, by2] = corner(4);
    g.fillStyle = pal.core;
    g.globalAlpha = a * (faceUp ? 0.9 : 0.4);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(ax, ay);
    g.lineTo(bx2, by2);
    g.closePath();
    g.fill();
  }, o.bias ?? 1);
  if ((o.glow ?? 1) > 0) k.glow(p, r * 2.4, a * (0.25 + 0.5 * hot) * (o.glow ?? 1), pal.light);
}

/**
 * Hexagons stacked in the air, thin as plates, `layers` of them (a half one
 * on top for a half): what a Thicken holds between the hands, and the mark
 * it leaves -- a skin and half a skin again.
 */
function stack(k: FxScene, p: P3, r: number, layers: number, o: { alpha: number; turn?: number; squash?: number }): void {
  const thick = 1.1 * (o.squash ?? 1);
  let z = p.z;
  for (let i = 0; i < Math.ceil(layers - 1e-6); i++) {
    const part = Math.min(1, layers - i);
    prism(k, { x: p.x, y: p.y, z }, r * (1 - 0.08 * i), thick * part, { alpha: o.alpha, turn: o.turn, bias: 1.5 + i * 0.1, top: i ? PALETTE.core : PALETTE.main });
    z += thick * part + 0.5 * (o.squash ?? 1);
  }
}

/** Two hexagons linked through each other, turning over somebody's head: a Ward Link, which holds every skin of yours to you. */
function link(k: FxScene, p: P3, r: number, o: { alpha: number; turn: number }): void {
  const a = clamp(o.alpha);
  if (a <= 0.01) return;
  const x = k.sx(p), y = k.sy(p), R = r * k.zoom;
  const sq = 0.3 + 0.7 * Math.abs(Math.cos(o.turn));
  const off = R * 0.55 * sq;
  const pal = k.pal;
  k.worldDraw(p, (g) => {
    g.lineJoin = 'round';
    const ring = (dx: number, rot: number): void => {
      g.beginPath();
      for (let j = 0; j < 6; j++) {
        const an = (j / 6) * TAU + rot;
        const px = x + dx + Math.cos(an) * R * sq, py = y + Math.sin(an) * R * 0.8;
        if (j === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
    };
    for (const [dx, rot] of [[-off, 0], [off, Math.PI / 6]] as const) {
      g.globalAlpha = a;
      g.strokeStyle = pal.ink;
      g.lineWidth = Math.max(2, 2.6 * k.zoom);
      ring(dx, rot);
      g.stroke();
      g.strokeStyle = dx < 0 ? pal.main : pal.accent;
      g.lineWidth = Math.max(1, 1.3 * k.zoom);
      g.stroke();
    }
  }, 2);
  k.glow(p, r * 2.6, a * 0.45);
}

/**
 * Where a stone skin lies, feet first: slabs along the limbs and over the
 * trunk, as greaves, cuisses, a belly plate and a back plate, breast slabs,
 * bracers and pauldrons. Each is a bone, a point on it in its own height
 * units (x out, y ahead), from `z0` to `z1` along it, and how wide, in pixels
 * at zoom one either side of that line.
 */
const STONE_SITES: ReadonlyArray<readonly [string, number, number, number, number, number]> = [
  ['knee0', -0.2, 0.5, -0.2, -3.0, 1.5], ['knee1', 0.2, 0.5, -0.2, -3.0, 1.5],
  ['hip0', -0.3, 0.7, -0.3, -3.1, 1.8], ['hip1', 0.3, 0.7, -0.3, -3.1, 1.8],
  ['spine', 0, 1.2, 1.4, -0.7, 2.1], ['spine', 0, -1.2, 1.6, -0.5, 2.1],
  ['chest', -0.85, 1.0, 2.1, 0.1, 1.6], ['chest', 0.85, 1.0, 2.1, 0.1, 1.6],
  ['elbow0', -0.3, 0.2, -0.2, -2.7, 1.3], ['elbow1', 0.3, 0.2, -0.2, -2.7, 1.3],
  ['arm0', -0.65, 0, 0.8, -1.8, 1.6], ['arm1', 0.65, 0, 0.8, -1.8, 1.6],
];
/** How many of those a cut of the blow covers: all of them at two fifths and over. */
const sitesFor = (cut: number): number => Math.min(STONE_SITES.length, Math.ceil(STONE_SITES.length * cut * 2.5));

/**
 * Basalt over a body, slab by slab, feet first: a stone skin. The slabs come
 * on from `delay` one after another with a puff of grit each, the topaz vein
 * down each glowing with what is left of the spell (`left` over `secs`), and
 * they crack off and fall in the last of it. Each slab lies along its limb
 * as the limb is posed, so it moves with the body, and a slab on the far side
 * of the body is drawn behind it.
 */
function stoneSkin(k: FxScene, b: Body, age: number, left: number, secs: number, count: number, delay = 0, tag = ''): void {
  const pal = STONE;
  const footY = k.sy(b);
  const vein = 0.2 + 0.8 * clamp(left / secs);
  const W = Math.max(0.8, 0.7 * k.zoom);
  const veins: number[] = [];
  for (let i = 0; i < count; i++) {
    const [bone, x, y, z0, z1, wide] = STONE_SITES[i];
    const on = age - delay - i * 0.035;
    if (on <= 0) continue;
    const off = left - 0.7 + (i / count) * 0.5;
    const bit = 1 << i;
    const p0 = k.joint(b, bone, [x, y, z0]), p1 = k.joint(b, bone, [x, y, z1]);
    const mid = mid3(p0, p1, 0.5);
    const onKey = 'stoneOn' + tag, offKey = 'stoneOff' + tag;
    if (!((k.state[onKey] ?? 0) & bit)) {
      k.state[onKey] = (k.state[onKey] ?? 0) | bit;
      k.burst(mid, 3, { kind: 'dust', colour: DUST, size: 1.4, sizeEnd: 2.6, life: [0.25, 0.45], speed: [0.05, 0.2], up: [2, 6], gravity: 6, bias: 1 });
    }
    if (off <= 0) {
      if (!((k.state[offKey] ?? 0) & bit)) {
        k.state[offKey] = (k.state[offKey] ?? 0) | bit;
        k.burst(mid, 4, { kind: 'shard', colour: [pal.main, pal.deep], size: 1.6, life: [0.4, 0.7], speed: [0.1, 0.4], up: [2, 10], gravity: 60, spin: 2, bias: 1 });
        k.burst(mid, 2, { kind: 'dust', colour: DUST, size: 1.6, life: [0.3, 0.6], speed: [0.05, 0.15], up: [0, 4], gravity: 4, bias: 1 });
      }
      continue;
    }
    const s = easeBack(clamp(on / 0.16)) * (off < 0.15 ? off / 0.15 : 1);
    const ax = k.sx(p0), ay = k.sy(p0), bx = k.sx(p1), by = k.sy(p1);
    const cx = (ax + bx) / 2, cy = (ay + by) / 2;
    let dx = (bx - ax) / 2, dy = (by - ay) / 2;
    const len = Math.hypot(dx, dy);
    const w = wide * k.zoom;
    // A limb seen end-on is still a slab, not a sliver: never shorter than it is wide.
    if (len < w) {
      const f = len > 1e-3 ? w / len : 0;
      dx = len > 1e-3 ? dx * f : 0;
      dy = len > 1e-3 ? dy * f : -w;
    }
    const l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * w, ny = (dx / l) * w;
    // The six corners, pointed at both ends, shrunk round the middle while it comes on or goes.
    // Blunt at the ends, as a slab of split stone is, not pointed as a gem is.
    const xs = [-dx, -dx * 0.72 + nx, dx * 0.72 + nx, dx, dx * 0.72 - nx, -dx * 0.72 - nx].map((v) => cx + v * s);
    const ys = [-dy, -dy * 0.72 + ny, dy * 0.72 + ny, dy, dy * 0.72 - ny, -dy * 0.72 - ny].map((v) => cy + v * s);
    // Which long side is up and to the left, where the light is.
    const litSide = -0.6 * nx - 0.8 * ny > 0 ? 1 : -1;
    const behind = k.sy({ x: mid.x, y: mid.y, z: b.z }) < footY - 0.5;
    const jag = hashOf(k.seed, i) - 0.5;
    k.worldDraw(b, (g) => {
      g.lineJoin = 'round';
      g.globalAlpha = 1;
      const half = (side: number): void => {
        g.beginPath();
        g.moveTo(xs[0], ys[0]);
        if (side > 0) {
          g.lineTo(xs[1], ys[1]);
          g.lineTo(xs[2], ys[2]);
        } else {
          g.lineTo(xs[5], ys[5]);
          g.lineTo(xs[4], ys[4]);
        }
        g.lineTo(xs[3], ys[3]);
        g.closePath();
      };
      half(litSide);
      g.fillStyle = pal.main;
      g.fill();
      half(-litSide);
      g.fillStyle = pal.deep;
      g.fill();
      // The bevel the light catches along the lit edge.
      const e0 = litSide > 0 ? 1 : 5, e1 = litSide > 0 ? 2 : 4;
      g.beginPath();
      g.moveTo(xs[e0], ys[e0]);
      g.lineTo(xs[e1], ys[e1]);
      g.lineTo(lerp(xs[e1], cx, 0.35), lerp(ys[e1], cy, 0.35));
      g.lineTo(lerp(xs[e0], cx, 0.35), lerp(ys[e0], cy, 0.35));
      g.closePath();
      g.fillStyle = pal.core;
      g.fill();
      g.beginPath();
      g.moveTo(xs[0], ys[0]);
      for (let j = 1; j < 6; j++) g.lineTo(xs[j], ys[j]);
      g.closePath();
      g.strokeStyle = pal.ink;
      g.lineWidth = W * 0.8;
      g.stroke();
      // The topaz vein down it, a crack with a kink in it, dimming as the seconds go.
      g.globalAlpha = vein * 0.75;
      g.strokeStyle = pal.accent;
      g.lineWidth = W * 0.6;
      g.beginPath();
      g.moveTo(cx - dx * 0.7 * s, cy - dy * 0.7 * s);
      g.lineTo(cx + (nx * jag * 0.9 - dx * 0.1) * s, cy + (ny * jag * 0.9 - dy * 0.1) * s);
      g.lineTo(cx + dx * 0.6 * s, cy + dy * 0.6 * s);
      g.stroke();
    }, behind ? -0.4 : 0.8);
    // The same vein again as light, so it smoulders through the dark: by day it adds little.
    if (!behind) veins.push(cx - dx * 0.7 * s, cy - dy * 0.7 * s, cx + (nx * jag * 0.9 - dx * 0.1) * s, cy + (ny * jag * 0.9 - dy * 0.1) * s, cx + dx * 0.6 * s, cy + dy * 0.6 * s);
  }
  if (veins.length) {
    k.glowDraw((g) => {
      g.globalAlpha = clamp(0.45 * vein);
      g.strokeStyle = pal.accent;
      g.lineWidth = W * 0.9;
      g.lineCap = 'round';
      g.beginPath();
      for (let i = 0; i < veins.length; i += 6) {
        g.moveTo(veins[i], veins[i + 1]);
        g.lineTo(veins[i + 2], veins[i + 3]);
        g.lineTo(veins[i + 4], veins[i + 5]);
      }
      g.stroke();
    });
  }
  if (!tag) {
    const on = smooth((age - delay) / 0.3) * smooth(left / 0.6);
    k.glow(k.at(b, 0.5), 14, 0.2 * vein * on, pal.light);
    k.light(b, 1.2, 0.25 * vein * on, PALETTE.light);
  }
}

/**
 * Cracks in the ground from a point, `n` of them about `len` tiles long, run
 * out with `u` and gone by `fade`. They zig-zag along the edges of hexagons,
 * as basalt splits, with a spur off each: the ground under a Warder breaks
 * the way a Warder's stone does.
 */
function cracks(k: FxScene, c: { x: number; y: number }, n: number, len: number, u: number, fade: number, pal: SpellPalette): void {
  if (fade <= 0.01 || u <= 0) return;
  const run = easeOut(u);
  const steps = 5;
  const lines: number[][] = [];
  for (let i = 0; i < n; i++) {
    // Headed along one of the six ways a hexagon's edges run, give or take.
    const an = Math.round(((i / n) * TAU + hashOf(k.seed, 40 + i) * 0.6) / (Math.PI / 3)) * (Math.PI / 3);
    const step = (len * (0.6 + 0.4 * hashOf(k.seed, 60 + i))) / steps;
    const sway = hashOf(k.seed + i, 7) < 0.5 ? 1 : -1;
    let x = c.x, y = c.y;
    const line = [x, y];
    for (let s2 = 0; s2 < steps; s2++) {
      const want = run * steps - s2;
      if (want <= 0) break;
      const turn = (s2 % 2 ? 1 : -1) * (Math.PI / 6) * sway;
      const l = step * Math.min(1, want);
      const nx = x + Math.cos(an + turn) * l, ny = y + Math.sin(an + turn) * l;
      line.push(nx, ny);
      if (s2 === 2 && want > 1.5) {
        // A spur off the side, along the next edge round.
        lines.push([nx, ny, nx + Math.cos(an + turn + Math.PI / 3) * step * 0.7, ny + Math.sin(an + turn + Math.PI / 3) * step * 0.7]);
      }
      x = nx;
      y = ny;
    }
    if (line.length > 2) lines.push(line);
  }
  const W = Math.max(0.8, 0.8 * k.zoom);
  k.groundShape(c.x, c.y, len + 0.5, [
    { kind: 'stroke', colour: pal.ink, alpha: clamp(fade), width: W * 1.7, paths: lines, join: 'round', cap: 'round', lift: 0.1 },
    { kind: 'stroke', colour: pal.accent, alpha: clamp(fade * 0.9), width: W * 0.8, paths: lines, join: 'round', cap: 'round', lift: 0.1 },
  ]);
}

/* ---- the casts on the body ------------------------------------------------------------------- */

/**
 * Ward: the right palm drawn up to the left shoulder and then smoothed down
 * across the body and out, as a cloak is settled; the left hand flat on the
 * breastbone, where the skin starts from. Weight dips into the reach and
 * rises with the sweep.
 */
const wardPose: CastPose = (r, t) => {
  r.arm[1] = euler(t, [[0, [12, 10, 0]], [0.16, [52, -4, 26]], [0.36, [80, -26, 40]], [0.5, [62, 6, 12]], [0.66, [30, 44, -6]], [0.84, [22, 30, 0]], [1, [14, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 20], [0.16, 104], [0.36, 128], [0.5, 54], [0.66, 12], [1, 18]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.36, [10, 0, 0]], [0.55, [-20, 0, 0]], [0.7, [-30, 0, 0]], [1, [0, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [0.2, [46, -8, 32]], [0.72, [46, -8, 32]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 20], [0.2, 122], [0.72, 120], [1, 20]]);
  r.open = [t > 0.08, t > 0.08];
  r.shape = [{ flat: one(t, [[0, 0], [0.16, 1], [0.8, 1], [1, 0]]) }, { flat: one(t, [[0, 0], [0.14, 1], [0.84, 1], [1, 0]]) }];
  r.chest = euler(t, [[0, [0, 0, 0]], [0.36, [-4, 0, 14]], [0.5, [0, 0, -2]], [0.66, [3, 0, -12]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.36, [-5, 0, 0]], [0.6, [3, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.36, [-16, 0, 12]], [0.56, [-10, 0, -4]], [0.7, [-4, 0, -12]], [1, [0, 0, 0]]]);
  r.knee = [one(t, [[0, 4], [0.36, 12], [0.6, 3], [1, 4]]), one(t, [[0, 4], [0.36, 12], [0.6, 3], [1, 4]])];
  r.leg = [euler(t, [[0, [2, 2, 0]], [0.36, [7, 3, 0]], [0.6, [2, 3, 0]], [1, [2, 2, 0]]]), euler(t, [[0, [2, 2, 0]], [0.36, [7, 3, 0]], [0.6, [2, 3, 0]], [1, [2, 2, 0]]])];
};

/**
 * Greater Ward: both arms swept out and up from a dip, palms up, until the
 * hands meet overhead with the face turned up to them; then drawn down in
 * front, palms down, as a hood is pulled down over oneself, and the knees
 * take the weight as the skin comes down to the feet.
 */
const greaterWardPose: CastPose = (r, t) => {
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [10, 10, 0]], [0.14, [14, 34, 0]], [0.3, [70, 64, -6]], [0.44, [168, 14, 0]], [0.55, [128, 8, 2]], [0.7, [52, 10, 8]], [0.84, [38, 12, 4]], [1, [10, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 18], [0.14, 30], [0.44, 22], [0.55, 40], [0.7, 30], [1, 18]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.5, [0, 0, 0]], [0.62, [-30, 0, 0]], [0.84, [-20, 0, 0]], [1, [0, 0, 0]]]);
  }
  r.open = [t > 0.06, t > 0.06];
  const gw = one(t, [[0, 0], [0.12, 1], [0.86, 1], [1, 0]]);
  r.shape = [{ flat: gw }, { flat: gw }];
  r.head = euler(t, [[0, [0, 0, 0]], [0.14, [-6, 0, 0]], [0.44, [20, 0, 0]], [0.55, [8, 0, 0]], [0.72, [-12, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.14, [-4, 0, 0]], [0.44, [8, 0, 0]], [0.72, [-4, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.44, [4, 0, 0]], [0.72, [-4, 0, 0]], [1, [0, 0, 0]]]);
  for (let k = 0; k < 2; k++) {
    r.knee[k] = one(t, [[0, 4], [0.14, 16], [0.44, 0], [0.55, 4], [0.74, 20], [0.9, 8], [1, 4]]);
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [0.14, [9, 3, 0]], [0.44, [0, 3, 0]], [0.74, [11, 4, 0]], [1, [2, 2, 0]]]);
  }
};

/**
 * Deep Ward: down into a deep squat with both palms pressed toward the
 * ground and held there while it gathers; then risen slowly out of it, the
 * hands lifting palms up past the chest to overhead, drawing the skin up
 * out of the earth.
 */
const deepWardPose: CastPose = (r, t) => {
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [10, 10, 0]], [0.12, [26, 16, 0]], [0.28, [40, 14, 0]], [0.46, [38, 16, 0]], [0.58, [86, 14, 0]], [0.74, [150, 22, 0]], [0.86, [140, 24, 0]], [1, [10, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 18], [0.28, 8], [0.46, 10], [0.58, 34], [0.74, 18], [1, 18]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.28, [-60, 0, 0]], [0.46, [-60, 0, 0]], [0.58, [30, 0, 0]], [0.74, [20, 0, 0]], [1, [0, 0, 0]]]);
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [0.12, [24, 8, 0]], [0.28, [56, 14, 0]], [0.46, [54, 14, 0]], [0.6, [16, 8, 0]], [0.74, [2, 6, 0]], [1, [2, 2, 0]]]);
    r.knee[k] = one(t, [[0, 4], [0.12, 40], [0.28, 100], [0.46, 98], [0.6, 30], [0.74, 2], [1, 4]]);
  }
  r.open = [t > 0.06, t > 0.06];
  // Knelt, not squatting: the ground is where the skin comes up out of, and the hands are laid on it.
  r.kneel = one(t, [[0, 0], [0.12, 0.5], [0.24, 1], [0.48, 1], [0.66, 0], [1, 0]]);
  const press = one(t, [[0.1, 0], [0.24, 1], [0.48, 1], [0.58, 0]]);
  if (press > 0) r.reach = [{ at: [-1.8, 3.4, 0.4], stoop: true, w: press }, { at: [1.8, 3.8, 0.4], stoop: true, w: press }];
  const dw = one(t, [[0, 0], [0.12, 1], [0.86, 1], [1, 0]]);
  r.shape = [{ flat: dw }, { flat: dw }];
  r.spine = euler(t, [[0, [0, 0, 0]], [0.28, [-8, 0, 0]], [0.46, [-6, 0, 0]], [0.6, [-4, 0, 0]], [0.74, [5, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.28, [-12, 0, 0]], [0.6, [0, 0, 0]], [0.74, [8, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.28, [-8, 0, 0]], [0.46, [-6, 0, 0]], [0.6, [6, 0, 0]], [0.76, [18, 0, 0]], [1, [0, 0, 0]]]);
};

/**
 * Ward Other: the right hand drawn in to the chest by the left, then back
 * by the hip, then pushed out to whoever it is for, palm out, with a step
 * toward them; the left stays on the heart the skin is given out of.
 */
const wardOtherPose: CastPose = (r, t) => {
  r.arm[1] = euler(t, [[0, [12, 10, 0]], [0.2, [46, -4, 26]], [0.38, [22, 22, -10]], [0.48, [86, 8, -4]], [0.72, [80, 10, -4]], [1, [14, 12, 0]]]);
  r.elbow[1] = one(t, [[0, 20], [0.2, 112], [0.38, 96], [0.48, 6], [0.72, 12], [1, 20]]);
  r.hand[1] = euler(t, [[0, [0, 0, 0]], [0.38, [0, 0, 0]], [0.48, [-44, 0, 0]], [0.72, [-36, 0, 0]], [1, [0, 0, 0]]]);
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [0.16, [46, -8, 32]], [0.76, [44, -6, 30]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 20], [0.16, 120], [0.76, 116], [1, 20]]);
  r.open = [t > 0.08, t > 0.08];
  r.shape = [{ flat: one(t, [[0, 0], [0.16, 1], [0.8, 1], [1, 0]]) }, { flat: one(t, [[0, 0], [0.4, 0.3], [0.48, 1], [0.8, 1], [1, 0]]), cup: one(t, [[0, 0], [0.2, 0.8], [0.4, 0.6], [0.48, 0]]) }];
  r.chest = euler(t, [[0, [0, 0, 0]], [0.38, [2, 0, -16]], [0.48, [-4, 0, 8]], [0.72, [-2, 0, 6]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.38, [3, 0, 0]], [0.48, [-9, 0, 0]], [0.72, [-6, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.2, [-10, 0, 0]], [0.38, [-2, 0, 10]], [0.48, [-2, 0, -4]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.38, [-2, 3, 0]], [0.48, [22, 3, 0]], [0.74, [18, 3, 0]], [1, [2, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.38, 8], [0.48, 18], [0.74, 14], [1, 4]]);
  r.leg[1] = euler(t, [[0, [2, 2, 0]], [0.38, [6, 2, 0]], [0.48, [-12, 2, 0]], [0.74, [-8, 2, 0]], [1, [2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [0.38, 14], [0.48, 8], [1, 4]]);
};

/**
 * Greater Ward Other: both hands cupped one over the other at the chest,
 * the body coiled back over the rear foot; then both driven out together,
 * palms out, in a lunge, and held while the plates go.
 */
const greaterWardOtherPose: CastPose = (r, t) => {
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [0.3, [56, -16, 34]], [0.5, [84, 6, 0]], [0.74, [80, 8, 0]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 20], [0.3, 122], [0.5, 6], [0.74, 12], [1, 20]]);
  r.arm[1] = euler(t, [[0, [10, 10, 0]], [0.3, [62, -10, 28]], [0.5, [88, 4, 0]], [0.74, [84, 6, 0]], [1, [10, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 20], [0.3, 110], [0.5, 4], [0.74, 10], [1, 20]]);
  for (let k = 0; k < 2; k++) r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.3, [10, 0, 0]], [0.5, [-46, 0, 0]], [0.74, [-40, 0, 0]], [1, [0, 0, 0]]]);
  r.open = [t > 0.08, t > 0.08];
  for (let k = 0; k < 2; k++) {
    (r.shape ??= [undefined, undefined])[k] = { cup: one(t, [[0, 0], [0.14, 1], [0.42, 1], [0.48, 0]]), flat: one(t, [[0.42, 0], [0.48, 1], [0.82, 1], [1, 0]]) };
  }
  r.mouth = one(t, [[0.4, 0], [0.5, 0.45], [0.66, 0]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.3, [7, 0, 0]], [0.5, [-13, 0, 0]], [0.74, [-10, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.3, [4, 0, -10]], [0.5, [-5, 0, 4]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.3, [-12, 0, 0]], [0.5, [-2, 0, 0]], [1, [0, 0, 0]]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.3, [4, 3, 0]], [0.5, [30, 4, 0]], [0.74, [26, 4, 0]], [1, [2, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.3, 10], [0.5, 30], [0.74, 24], [1, 4]]);
  r.leg[1] = euler(t, [[0, [2, 2, 0]], [0.3, [10, 2, 0]], [0.5, [-18, 2, 0]], [0.74, [-14, 2, 0]], [1, [2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [0.3, 22], [0.5, 10], [1, 4]]);
};

/**
 * Thicken: the palms held facing each other before the chest and drawn
 * slowly apart as the stack between them grows; then pressed together hard,
 * hunched into it, and the pressed thing brought in to the chest.
 */
const thickenPose: CastPose = (r, t) => {
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [10, 10, 0]], [0.18, [60, -2, 14]], [0.46, [62, 20, 2]], [0.58, [60, -8, 20]], [0.76, [46, -10, 32]], [0.88, [44, -8, 30]], [1, [10, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 18], [0.18, 78], [0.46, 54], [0.58, 80], [0.76, 118], [1, 18]]);
    // Palms turned in to face each other across what grows between them.
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.18, [0, 70, 0]], [0.58, [0, 70, 0]], [0.76, [0, 30, 0]], [1, [0, 0, 0]]]);
  }
  r.open = [t > 0.08, t > 0.08];
  const th = one(t, [[0, 0], [0.16, 1], [0.86, 1], [1, 0]]);
  r.shape = [{ flat: th }, { flat: th }];
  r.head = euler(t, [[0, [0, 0, 0]], [0.18, [-16, 0, 0]], [0.46, [-18, 0, 0]], [0.58, [-10, 0, 0]], [0.8, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.46, [2, 0, 0]], [0.58, [-8, 0, 0]], [0.8, [2, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.46, [0, 0, 0]], [0.58, [-6, 0, 0]], [0.8, [2, 0, 0]], [1, [0, 0, 0]]]);
  for (let k = 0; k < 2; k++) {
    r.knee[k] = one(t, [[0, 4], [0.46, 10], [0.58, 18], [0.8, 6], [1, 4]]);
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [0.46, [6, 4, 0]], [0.58, [10, 5, 0]], [0.8, [3, 3, 0]], [1, [2, 2, 0]]]);
  }
};

/**
 * Ward Link: the right hand flung up high and the left down and out, the
 * chest wound round to the left; then the right arm swept round level at
 * the shoulder and out to the right, as a net is cast, the chest unwinding
 * after it and the head following the hand.
 */
const wardLinkPose: CastPose = (r, t) => {
  r.arm[1] = euler(t, [[0, [12, 10, 0]], [0.2, [158, 22, 0]], [0.36, [150, 26, 0]], [0.5, [94, 34, 0]], [0.66, [76, 84, -4]], [0.82, [60, 76, 0]], [1, [12, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 20], [0.2, 26], [0.36, 30], [0.5, 8], [0.66, 4], [1, 20]]);
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [0.2, [18, 34, 0]], [0.5, [24, 40, 0]], [0.7, [30, 48, 0]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 20], [0.2, 8], [0.7, 6], [1, 20]]);
  r.open = [t > 0.08, t > 0.08];
  r.shape = [{ flat: one(t, [[0, 0], [0.2, 1], [0.84, 1], [1, 0]]) }, { claw: one(t, [[0.36, 0], [0.5, 0.7], [0.82, 0.5], [1, 0]]), cup: one(t, [[0, 0], [0.2, 0.8], [0.4, 0.8], [0.5, 0]]) }];
  r.chest = euler(t, [[0, [0, 0, 0]], [0.2, [6, 0, 26]], [0.36, [6, 0, 30]], [0.5, [0, 0, 4]], [0.66, [-2, 0, -30]], [0.82, [0, 0, -24]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.2, [3, 0, 8]], [0.5, [-2, 0, 0]], [0.66, [-4, 0, -10]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.2, [12, 0, 10]], [0.5, [0, 0, -6]], [0.66, [-4, 0, -24]], [0.82, [-4, 0, -20]], [1, [0, 0, 0]]]);
  for (let k = 0; k < 2; k++) {
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [0.2, [4, 8, 0]], [0.66, [6, 10, 0]], [1, [2, 2, 0]]]);
    r.knee[k] = one(t, [[0, 4], [0.36, 10], [0.66, 16], [1, 4]]);
  }
};

/**
 * Stoneskin: fists drawn up to the chest and the right knee raised, then the
 * foot stamped down and the fists driven down to the sides, the body hunched
 * over a wide braced stance, chin down, as the stone comes up it.
 */
const stoneskinPose: CastPose = (r, t) => {
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [10, 10, 0]], [0.25, [52, -6, 24]], [0.45, [8, 26, 0]], [0.72, [10, 24, 0]], [1, [10, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 18], [0.25, 120], [0.45, 26], [0.72, 30], [1, 18]]);
  }
  r.open = [false, false];
  r.loose = [false, false];
  r.mouth = one(t, [[0.36, 0], [0.44, 0.5], [0.62, 0]]);
  r.leg[1] = euler(t, [[0, [2, 2, 0]], [0.25, [52, 4, 0]], [0.42, [6, 10, 0]], [0.74, [6, 10, 0]], [1, [2, 2, 0]]]);
  r.knee[1] = one(t, [[0, 4], [0.25, 74], [0.42, 16], [0.74, 22], [1, 4]]);
  r.leg[0] = euler(t, [[0, [2, 2, 0]], [0.25, [4, 4, 0]], [0.45, [8, 10, 0]], [0.74, [8, 10, 0]], [1, [2, 2, 0]]]);
  r.knee[0] = one(t, [[0, 4], [0.25, 10], [0.45, 26], [0.74, 22], [1, 4]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.25, [5, 0, 0]], [0.45, [-14, 0, 0]], [0.74, [-10, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.25, [4, 0, 0]], [0.45, [-8, 0, 0]], [0.74, [-6, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.25, [4, 0, 0]], [0.45, [-10, 0, 0]], [0.74, [-6, 0, 0]], [1, [0, 0, 0]]]);
};

/**
 * Ward Burst: crouched with the forearms crossed before the chest as the skin
 * strains, then thrown open, arms flung up and out, back arched and chin up,
 * as it breaks off and flies.
 */
const wardBurstPose: CastPose = (r, t) => {
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [10, 10, 0]], [0.32, [66, -24, 36]], [0.44, [70, -26, 38]], [0.5, [122, 70, -6]], [0.72, [112, 72, -6]], [1, [10, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 18], [0.32, 128], [0.44, 130], [0.5, 8], [0.72, 12], [1, 18]]);
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [0.32, [24, 8, 0]], [0.44, [26, 8, 0]], [0.5, [2, 10, 0]], [0.72, [2, 10, 0]], [1, [2, 2, 0]]]);
    r.knee[k] = one(t, [[0, 4], [0.32, 44], [0.44, 48], [0.5, 4], [0.72, 8], [1, 4]]);
  }
  r.open = [t > 0.46, t > 0.46];
  r.loose = [false, false];
  const fl = one(t, [[0.44, 0], [0.5, 1], [0.8, 1], [1, 0]]);
  r.shape = [{ claw: fl * 0.6, flat: fl * 0.4 }, { claw: fl * 0.6, flat: fl * 0.4 }];
  r.mouth = one(t, [[0.44, 0], [0.5, 0.9], [0.72, 0.5], [0.9, 0]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.32, [-14, 0, 0]], [0.44, [-16, 0, 0]], [0.5, [10, 0, 0]], [0.72, [7, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.32, [-8, 0, 0]], [0.5, [10, 0, 0]], [0.72, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.32, [-16, 0, 0]], [0.44, [-18, 0, 0]], [0.5, [16, 0, 0]], [0.72, [10, 0, 0]], [1, [0, 0, 0]]]);
};

/**
 * Sanctuary: the hands raised and joined high over the head, the face lifted
 * to them, and held; then parted and brought down slowly in a great arc out
 * to either side, as the dome they draw comes down over everybody, the head
 * bowing under it.
 */
const sanctuaryPose: CastPose = (r, t) => {
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [10, 10, 0]], [0.16, [100, 6, 4]], [0.3, [176, 4, 0]], [0.44, [176, 6, 0]], [0.52, [150, 40, 0]], [0.7, [70, 84, 0]], [0.84, [40, 74, 0]], [1, [10, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 18], [0.16, 40], [0.3, 8], [0.52, 4], [0.84, 8], [1, 18]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.6, [0, 0, 0]], [0.8, [-20, 0, 0]], [1, [0, 0, 0]]]);
    r.knee[k] = one(t, [[0, 4], [0.3, 0], [0.52, 4], [0.76, 18], [1, 4]]);
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [0.3, [0, 3, 0]], [0.76, [10, 5, 0]], [1, [2, 2, 0]]]);
  }
  r.open = [t > 0.06, t > 0.06];
  const sw = one(t, [[0, 0], [0.12, 1], [0.86, 1], [1, 0]]);
  r.shape = [{ flat: sw }, { flat: sw }];
  r.head = euler(t, [[0, [0, 0, 0]], [0.3, [22, 0, 0]], [0.44, [22, 0, 0]], [0.6, [4, 0, 0]], [0.78, [-14, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.3, [8, 0, 0]], [0.6, [4, 0, 0]], [0.78, [-4, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.3, [4, 0, 0]], [0.78, [-6, 0, 0]], [1, [0, 0, 0]]]);
};

/**
 * Bastion of Stone: both fists raised high, the body stretched up after them;
 * then brought down together onto the ground in front in a deep squat, the
 * back bent over them, and held there while the stone comes up.
 */
const bastionPose: CastPose = (r, t) => {
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [10, 10, 0]], [0.18, [90, 12, 0]], [0.38, [172, 10, 0]], [0.48, [120, 8, 0]], [0.55, [44, 8, 0]], [0.78, [42, 10, 0]], [1, [10, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 18], [0.38, 36], [0.48, 12], [0.55, 4], [0.78, 8], [1, 18]]);
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [0.38, [0, 6, 0]], [0.48, [20, 10, 0]], [0.55, [56, 16, 0]], [0.78, [52, 16, 0]], [1, [2, 2, 0]]]);
    r.knee[k] = one(t, [[0, 4], [0.38, 0], [0.48, 34], [0.55, 96], [0.78, 90], [1, 4]]);
  }
  r.open = [false, false];
  r.loose = [false, false];
  // On one knee for the blow, the fists put on the ground before it: the strike lands where the shock goes out from.
  r.kneel = one(t, [[0.4, 0], [0.52, 1], [0.8, 1], [0.94, 0]]);
  const strike = one(t, [[0.44, 0], [0.54, 1], [0.78, 1], [0.88, 0]]);
  if (strike > 0) r.reach = [{ at: [-1.2, 4.4, 0.8], stoop: true, w: strike }, { at: [1.2, 4.4, 0.8], stoop: true, w: strike }];
  r.mouth = one(t, [[0.46, 0], [0.55, 1], [0.7, 0.4], [0.86, 0]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.38, [8, 0, 0]], [0.48, [-10, 0, 0]], [0.55, [-36, 0, 0]], [0.78, [-32, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.38, [8, 0, 0]], [0.55, [-14, 0, 0]], [0.78, [-12, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.38, [14, 0, 0]], [0.55, [-4, 0, 0]], [0.78, [0, 0, 0]], [1, [0, 0, 0]]]);
};

/**
 * Unbreakable: forearms crossed before the face, tucked down behind them as
 * it gathers; then thrown down and out to the sides, fists shut, feet set
 * wide, chest out and the head back -- set, and held set.
 */
const unbreakablePose: CastPose = (r, t) => {
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [10, 10, 0]], [0.34, [112, -26, 30]], [0.5, [116, -28, 32]], [0.56, [22, 48, -10]], [0.86, [20, 46, -10]], [1, [10, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 18], [0.34, 104], [0.5, 108], [0.56, 16], [0.86, 18], [1, 18]]);
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [0.34, [20, 6, 0]], [0.5, [22, 6, 0]], [0.56, [4, 15, 0]], [0.86, [4, 15, 0]], [1, [2, 2, 0]]]);
    r.knee[k] = one(t, [[0, 4], [0.34, 32], [0.5, 36], [0.56, 16], [0.86, 18], [1, 4]]);
  }
  r.open = [false, false];
  r.loose = [false, false];
  r.mouth = one(t, [[0.5, 0], [0.57, 1], [0.7, 0.6], [0.86, 0]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.34, [-10, 0, 0]], [0.5, [-12, 0, 0]], [0.56, [8, 0, 0]], [0.86, [6, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.34, [-6, 0, 0]], [0.56, [12, 0, 0]], [0.86, [10, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.34, [-16, 0, 0]], [0.5, [-18, 0, 0]], [0.56, [16, 0, 0]], [0.86, [12, 0, 0]], [1, [0, 0, 0]]]);
};

/**
 * Aegis: the focus raised before the face in the left fist, the right palm
 * passed over it; then both arms opened wide and swung forward together
 * until the hands nearly meet in front, as two doors are closed -- which is
 * how the skin closes over the body, from behind to a seam in front.
 */
const aegisPose: CastPose = (r, t) => {
  r.arm[0] = euler(t, [[0, [10, 10, 0]], [0.16, [98, -6, 20]], [0.3, [100, -4, 20]], [0.42, [82, 76, 0]], [0.6, [86, -2, 6]], [0.8, [70, 2, 4]], [1, [10, 10, 0]]]);
  r.elbow[0] = one(t, [[0, 18], [0.16, 104], [0.3, 104], [0.42, 10], [0.6, 8], [0.8, 26], [1, 18]]);
  r.arm[1] = euler(t, [[0, [10, 10, 0]], [0.16, [94, -16, 30]], [0.3, [96, -14, 30]], [0.42, [82, 76, 0]], [0.6, [86, -4, 6]], [0.8, [70, 2, 4]], [1, [10, 10, 0]]]);
  r.elbow[1] = one(t, [[0, 18], [0.16, 96], [0.3, 92], [0.42, 10], [0.6, 8], [0.8, 26], [1, 18]]);
  r.open = [t > 0.62, t > 0.06];
  r.shape = [{ flat: one(t, [[0.36, 0], [0.44, 1], [0.84, 1], [1, 0]]) }, { flat: one(t, [[0, 0], [0.12, 1], [0.84, 1], [1, 0]]) }];
  r.chest = euler(t, [[0, [0, 0, 0]], [0.3, [-4, 0, 0]], [0.42, [8, 0, 0]], [0.6, [-4, 0, 0]], [1, [0, 0, 0]]]);
  r.spine = euler(t, [[0, [0, 0, 0]], [0.42, [4, 0, 0]], [0.6, [-6, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.16, [-6, 0, 0]], [0.3, [-8, 0, 0]], [0.42, [8, 0, 0]], [0.6, [-4, 0, 0]], [1, [0, 0, 0]]]);
  for (let k = 0; k < 2; k++) r.knee[k] = one(t, [[0, 4], [0.3, 10], [0.42, 4], [0.62, 14], [1, 4]]);
};

/**
 * Bulwark: the focus held in both hands at the belly, sunk down over it; then
 * the hands parted and swept out level at the waist, palms down, all the
 * way round to either side, as the wall of plates goes out over the ground.
 */
const bulwarkPose: CastPose = (r, t) => {
  for (let k = 0; k < 2; k++) {
    r.arm[k] = euler(t, [[0, [10, 10, 0]], [0.18, [40, -14, 30]], [0.38, [36, -16, 32]], [0.5, [56, 30, 0]], [0.66, [48, 86, -6]], [0.84, [36, 80, -6]], [1, [10, 10, 0]]]);
    r.elbow[k] = one(t, [[0, 18], [0.18, 100], [0.38, 104], [0.5, 30], [0.66, 6], [1, 18]]);
    r.hand[k] = euler(t, [[0, [0, 0, 0]], [0.5, [-20, 0, 0]], [0.66, [-30, 0, 0]], [1, [0, 0, 0]]]);
    r.leg[k] = euler(t, [[0, [2, 2, 0]], [0.18, [10, 6, 0]], [0.38, [22, 8, 0]], [0.5, [14, 10, 0]], [0.66, [16, 11, 0]], [1, [2, 2, 0]]]);
    r.knee[k] = one(t, [[0, 4], [0.18, 18], [0.38, 40], [0.5, 22], [0.66, 28], [0.84, 20], [1, 4]]);
  }
  r.open = [t > 0.46, t > 0.46];
  const bc = one(t, [[0, 0], [0.16, 1], [0.44, 1], [0.5, 0]]), bf = one(t, [[0.44, 0], [0.5, 1], [0.84, 1], [1, 0]]);
  r.shape = [{ cup: bc, flat: bf }, { cup: bc, flat: bf }];
  r.spine = euler(t, [[0, [0, 0, 0]], [0.38, [-12, 0, 0]], [0.5, [-4, 0, 0]], [0.66, [-6, 0, 0]], [1, [0, 0, 0]]]);
  r.chest = euler(t, [[0, [0, 0, 0]], [0.38, [-6, 0, 0]], [0.5, [4, 0, 0]], [1, [0, 0, 0]]]);
  r.head = euler(t, [[0, [0, 0, 0]], [0.38, [-16, 0, 0]], [0.5, [-2, 0, 0]], [0.66, [-6, 0, 0]], [1, [0, 0, 0]]]);
};

/* ---- the effects --------------------------------------------------------------------------- */

/** A key for somebody in `k.state`, the same every frame. */
const whoKey = (b: Body): string => (b.who ? (b.who.kind === 'player' ? 'me' : `${b.who.kind}${b.who.id}`) : `${Math.round(b.x * 4)},${Math.round(b.y * 4)}`);

/** Whether two bodies are one: the caster found again among those near it. */
const same = (a: Body, b: Body): boolean => (a.who && b.who ? whoKey(a) === whoKey(b) : Math.hypot(a.x - b.x, a.y - b.y) < 0.05);

/**
 * The people other than the caster a ward round them covered: whoever stood
 * within `R` tiles the first frame it is asked (the island covers who is
 * there as it closes, so somebody who walks in later is not drawn covered),
 * found again each frame wherever they have gone, nearest first and at most
 * `most` of them. Each comes with how far they stood, for a skin that
 * reaches them a moment after the caster's.
 */
function covered(k: FxScene, R: number, most = 8): Array<{ b: Body; d: number }> {
  const c = k.caster;
  if (!k.state.counted) {
    k.state.counted = 1;
    for (const b of k.bodiesWithin(R, c, ['player', 'peer'])) {
      if (!same(b, c)) k.state['in:' + whoKey(b)] = 1 + Math.hypot(b.x - c.x, b.y - c.y);
    }
  }
  const out: Array<{ b: Body; d: number }> = [];
  // Looked for a little further out than the reach, as they may have walked off; the skin goes with them.
  for (const b of k.bodiesWithin(R + 8, c, ['player', 'peer'])) {
    const d = k.state['in:' + whoKey(b)];
    if (d && !same(b, c)) out.push({ b, d: d - 1 });
  }
  return out.sort((x, y) => x.d - y.d).slice(0, most);
}

/** A hexagon stamped on the ground round somebody's feet, spreading and going: where a skin has closed. */
function stamp(k: FxScene, b: { x: number; y: number }, u: number, r0: number, r1: number, pal: SpellPalette = k.pal): void {
  const a = flashOf(u, 0.08);
  k.ring(b, lerp(r0, r1, easeOut(u)), { n: 6, turn: Math.PI / 6, band: 0.07 * (1 - 0.5 * u), alpha: a, glow: 0.6, main: pal.main, deep: pal.deep, ink: pal.ink });
}

/** Ward: a small hexagon on the palm as it reaches the shoulder, and the skin knitted out from the heart as the hand smooths it down. */
const ward = (): SpellVisual => {
  const id = 'warder_ward';
  const s = skinOf(id);
  return {
    palette: PALETTE,
    cast: { timing: { secs: 1.0, release: 0.5 }, pose: wardPose },
    fx: {
      charge: (k, t) => {
        const g = bump(t, 0.12, 0.42, 0.56);
        plate(k, k.hand(1), 1.4 + 1.4 * g, { alpha: g, spin: k.now * 5, hot: t > 0.44 ? 1 : 0, bias: 2 });
        k.glow(k.chest(), 5, 0.5 * seg(t, 0.15, 0.5));
        k.ring(k.caster, 0.3, { n: 6, turn: Math.PI / 6, band: 0.045, alpha: 0.7 * smooth(seg(t, 0.15, 0.5)), glow: 0.3 });
      },
      release: (k) => k.burst(k.chest(), 8, { kind: 'mote', size: 1.3, life: [0.3, 0.6], speed: [0.3, 0.7], up: [-2, 10], gravity: 0, drag: 0.1 }),
      impact: { secs: 0.75, draw: (k, u) => {
        stamp(k, k.caster, u, 0.28, 0.42);
        k.flare(k.chest(), 7 * (1 - u), flashOf(u, 0.1));
      } },
      linger: { draw: (k, age, left) => skinLinger(k, k.caster, age, left, { knit: { from: 'point', th: frontOf(k.caster), ph: 0.35 }, secs: 0.45, skin: s }) },
    },
  };
};

/** Ward Other: a topaz plate thrown underhand from the palm, and the skin spreading over them from where it struck. */
const wardOther = (): SpellVisual => {
  const id = 'warder_ward_other';
  const s = skinOf(id);
  const path = (k: FxScene, u: number): P3 => arcAt(k.hand(1), k.heart(k.target), u, 4 + k.dist * 1.6);
  return {
    palette: PALETTE,
    cast: { timing: { secs: 1.1, release: 0.48 }, pose: wardOtherPose },
    fx: {
      charge: (k, t) => {
        k.glow(k.chest(), 5, 0.6 * seg(t, 0.1, 0.4));
        const g = smooth(seg(t, 0.2, 0.46));
        if (t < 0.5) plate(k, k.hand(1), 1.2 + 1.6 * g, { alpha: g, spin: k.now * 6, bias: 2 });
      },
      travel: { secs: (tiles) => 0.14 + tiles * 0.06, draw: (k, u) => {
        const head = path(k, u);
        k.ribbon([path(k, Math.max(0, u - 0.22)), path(k, Math.max(0, u - 0.12)), path(k, Math.max(0, u - 0.05)), head], { width: 2, alpha: 0.7, glow: 0.5 });
        plate(k, head, 3.4, { spin: 0.6 + Math.sin(k.now * 9) * 0.5, tip: 0.3, bias: 2, hot: 0.3 });
        k.light(head, 2, 0.5);
      } },
      hit: (k) => k.burst(k.heart(k.target), 8, { kind: 'mote', size: 1.2, life: [0.3, 0.7], speed: [0.2, 0.6], up: [4, 14], gravity: 0 }),
      impact: { secs: 0.7, draw: (k, u) => {
        stamp(k, k.target, u, 0.28, 0.42);
        k.flare(k.heart(k.target), 8 * (1 - u), flashOf(u, 0.1));
      } },
      linger: { draw: (k, age, left) => skinLinger(k, k.target, age, left, { knit: { from: 'point', th: bearing(k, k.target, k.caster), ph: 0.3 }, secs: 0.5, skin: s }) },
    },
  };
};

/** Greater Ward: a hexagonal halo made overhead between the hands, let down over the body to the feet, the skin coming down behind it. */
const greaterWard = (): SpellVisual => {
  const id = 'warder_greater_ward';
  const s = skinOf(id);
  const fall = 0.5;
  return {
    palette: PALETTE,
    cast: { timing: { secs: 1.4, release: 0.55 }, pose: greaterWardPose },
    fx: {
      charge: (k, t) => {
        const g = smooth(seg(t, 0.3, 0.5));
        // Handed over to the falling one (`impact`) the moment it is let go.
        if (t < 0.55) halo(k, k.caster, k.caster.tall * 1.18, 0.05 + 0.08 * g, { alpha: g, hot: t > 0.48 ? 1 : 0, turn: k.now * 1.5 });
        k.emit(k.at(k.caster, 1.2), 30 * bump(t, 0.25, 0.45, 0.55), { kind: 'mote', size: 1.1, life: [0.3, 0.6], speed: [0.05, 0.2], up: [-6, 4], gravity: 0, jitter: 0.1 });
        k.light(k.caster, 2, 0.5 * g);
      },
      impact: { secs: 0.95, draw: (k, u) => {
        const b = k.caster;
        const v = clamp(u * (0.95 / fall));
        // Down the egg: as wide as it is where it is, so it slides down the outside of the skin it lays.
        const Y = 1 - 2 * easeIn(v) * 0.5 - easeIn(v) * 0.5;
        const h = b.tall * (0.5 + 0.56 * Y);
        const w = (b.wide * 2.4 * Math.sqrt(Math.max(0.05, 1 - Y * Y)) + 1.2) / 40;
        if (v < 1) halo(k, b, Math.max(0.3, h), Math.max(0.13, w), { alpha: 1, hot: 1 - v, turn: u * 2 });
        if (v >= 1) {
          if (!k.state.landed) {
            k.state.landed = 1;
            k.burst(k.at(b, 0.05), 10, { kind: 'dust', colour: DUST, size: 1.6, sizeEnd: 3, life: [0.3, 0.5], speed: [0.5, 0.9], up: [1, 3], gravity: 4, drag: 0.1 });
          }
          stamp(k, b, (u - fall / 0.95) / (1 - fall / 0.95), 0.3, 0.55);
        }
        k.light(b, 3, 0.7 * (1 - u));
      } },
      linger: { draw: (k, age, left) => skinLinger(k, k.caster, age, left, { knit: { from: 'down' }, secs: fall * 0.95, skin: s }) },
    },
  };
};

/** Deep Ward: an emerald seal pressed into the ground under the palms, and two skins lifted out of it, one over the other. */
const deepWard = (): SpellVisual => {
  const id = 'warder_deep_ward';
  const s = skinOf(id);
  const OUTER: SpellPalette = { ...PALETTE, main: '#8fd8a0', deep: '#2a6e48', core: '#e8f8d0' };
  return {
    palette: PALETTE,
    cast: { timing: { secs: 1.9, release: 0.58 }, pose: deepWardPose },
    fx: {
      charge: (k, t) => {
        const g = seg(t, 0.2, 0.56);
        k.sigil(k.caster, 0.62, { points: 6, step: 1, grow: g, turn: k.now * 0.4, alpha: 0.9, main: PALETTE.deep, deep: PALETTE.ink, core: PALETTE.main });
        const palms = mid3(k.hand(0), k.hand(1), 0.5);
        k.glow(palms, 7, 0.7 * g);
        k.emit(k.at(k.caster, 0.02), 30 * g * (1 - seg(t, 0.56, 0.6)), { kind: 'mote', colour: [PALETTE.accent, PALETTE.main], size: 1.1, life: [0.4, 0.8], speed: [0.02, 0.1], up: [8, 18], gravity: 0, jitter: 0.45 });
        k.light(k.caster, 2.5, 0.6 * g);
      },
      release: (k) => k.burst(k.at(k.caster, 0.1), 14, { kind: 'mote', colour: [PALETTE.accent, PALETTE.core], size: 1.2, life: [0.4, 0.9], speed: [0.1, 0.4], up: [16, 34], gravity: 0, jitter: 0.25 }),
      impact: { secs: 1.2, draw: (k, u) => {
        const b = k.caster;
        k.sigil(b, 0.62 + 0.15 * u, { points: 6, step: 1, turn: k.now * 0.4, alpha: 0.9 * (1 - smooth(u)), main: PALETTE.deep, deep: PALETTE.ink, core: PALETTE.main });
        // Two halos lifted off the ground in turn, each with a skin behind it.
        for (let i = 0; i < 2; i++) {
          const v = clamp((u - i * 0.25) / 0.45);
          if (v <= 0 || v >= 1) continue;
          const Y = -1 + 2 * easeOut(v);
          const size = i ? 1.16 : 1;
          const h = b.tall * (0.5 + 0.56 * Y * size);
          const w = (b.wide * 2.4 * size * Math.sqrt(Math.max(0.05, 1 - Y * Y)) + 1.2) / 40;
          halo(k, b, Math.max(0.3, h), Math.max(0.12, w), { alpha: 1 - v * v, hot: 1 - v, pal: i ? OUTER : PALETTE });
        }
        k.light(b, 3, 0.8 * (1 - u));
      } },
      linger: { draw: (k, age, left) => {
        skinLinger(k, k.caster, age, left, { knit: { from: 'up' }, secs: 0.55, skin: s / 2, spin: 0.1 });
        // The second skin, the half of it past a full one: wider, deeper green, turning the other way.
        skinLinger(k, k.caster, age, left, { knit: { from: 'up' }, secs: 0.55, delay: 0.3, skin: s / 2, size: 1.16, spin: -0.08, pal: OUTER, layer: 1 });
      } },
    },
  };
};

/** Greater Ward Other: plates gathered between the cupped hands, flung in a corkscrew, and wound round them in a spiral. */
const greaterWardOther = (): SpellVisual => {
  const id = 'warder_greater_ward_other';
  const s = skinOf(id);
  const N = 6;
  return {
    palette: PALETTE,
    cast: { timing: { secs: 1.3, release: 0.5 }, pose: greaterWardOtherPose },
    fx: {
      charge: (k, t) => {
        const g = smooth(seg(t, 0.1, 0.46));
        if (t > 0.52 || g <= 0) return;
        const c = mid3(k.hand(0), k.hand(1), 0.5);
        for (let i = 0; i < 3; i++) {
          const an = k.now * 7 + (i / 3) * TAU;
          const rr = (1 - g) * 6 + 1.5;
          plate(k, { x: c.x + (Math.cos(an) * rr) / 40, y: c.y + (Math.sin(an) * rr) / 40, z: c.z + Math.sin(an * 1.3) * 1.5 }, 1.4 + g, { alpha: g, spin: an * 2, bias: 2, glow: 0.5 });
        }
        k.glow(c, 6, 0.7 * g);
      },
      release: (k) => k.burst(mid3(k.hand(0), k.hand(1), 0.5), 10, { kind: 'mote', size: 1.1, life: [0.2, 0.4], speed: [0.3, 0.8], up: [0, 6], heading: k.toward(k.caster, k.target), cone: 1, gravity: 0 }),
      travel: { secs: (tiles) => 0.18 + tiles * 0.065, draw: (k, u) => {
        const from = mid3(k.hand(0), k.hand(1), 0.5), to = k.heart(k.target);
        const dir = k.toward(k.caster, k.target);
        for (let i = 0; i < N; i++) {
          const v = u * (1 + 0.07 * (N - 1)) - i * 0.07;
          if (v <= 0 || v >= 1) continue;
          const p = arcAt(from, to, v, 2 + k.dist);
          const ph = v * 9 + (i / N) * TAU;
          const rr = 0.07 * Math.sin(Math.PI * v);
          plate(k, { x: p.x - dir.y * Math.cos(ph) * rr, y: p.y + dir.x * Math.cos(ph) * rr, z: p.z + Math.sin(ph) * rr * 40 }, 2.2, { spin: ph * 1.5, bias: 2, glow: 0.6 });
        }
        k.light(arcAt(from, to, u, 2 + k.dist), 2, 0.5);
      } },
      hit: (k) => k.burst(k.heart(k.target), 10, { kind: 'mote', size: 1.2, life: [0.4, 0.8], speed: [0.2, 0.6], up: [4, 16], gravity: 0 }),
      impact: { secs: 0.8, draw: (k, u) => {
        const b = k.target;
        // The plates as they arrived, wound round them and spiralling down into the skin.
        for (let i = 0; i < N; i++) {
          const v = clamp(u / 0.7 - i * 0.04);
          if (v >= 1) continue;
          const an = (i / N) * TAU + v * 7;
          const h = b.tall * (0.9 - 0.75 * v);
          const rr = (b.wide * 2.6 + 2) / 40;
          plate(k, { x: b.x + Math.cos(an) * rr, y: b.y + Math.sin(an) * rr, z: b.z + h }, 2.2 * (1 - 0.5 * v), { alpha: 1 - v * v, spin: an, glow: 0.5 });
        }
        stamp(k, b, u, 0.32, 0.52);
        k.light(b, 3, 0.6 * (1 - u));
      } },
      linger: { draw: (k, age, left) => skinLinger(k, k.target, age, left, { knit: { from: 'spiral', th: bearing(k, k.target, k.caster) }, secs: 0.6, skin: s }) },
    },
  };
};

/** Thicken: a stack of plates grown between the palms, a skin and a half thick, pressed into the chest; a small stack over the shoulder until the next skin. */
const thicken = (): SpellVisual => {
  const id = 'warder_thicken';
  const more = fxOf(id).more || 1.5;
  const R = 0.06;
  return {
    palette: PALETTE,
    cast: { timing: { secs: 1.0, release: 0.58 }, pose: thickenPose },
    fx: {
      charge: (k, t) => {
        const between = mid3(k.hand(0), k.hand(1), 0.5);
        const grow = smooth(seg(t, 0.16, 0.5));
        if (t < 0.58) {
          // A plate, then another laid on it, to a skin and a half; squeezed flat as the palms meet.
          const squash = 1 - 0.6 * smooth(seg(t, 0.5, 0.58));
          stack(k, { x: between.x, y: between.y, z: between.z - 1.5 }, R * (0.5 + 0.5 * grow), 1 + (more - 1) * smooth(seg(t, 0.32, 0.5)), { alpha: smooth(seg(t, 0.14, 0.22)), turn: k.now * 1.2, squash });
          k.glow(between, 6, 0.5 * grow + 0.4 * seg(t, 0.5, 0.58));
        } else if (t < 0.78) {
          // Pressed, and carried in to the chest.
          const v = seg(t, 0.58, 0.76);
          plate(k, mid3(between, k.chest(), v), 2.4 * (1 - 0.6 * v), { alpha: 1 - v * v, spin: k.now * 8, hot: 1, bias: 2 });
        }
        k.light(between, 1.6, 0.5 * grow);
      },
      release: (k) => {
        const between = mid3(k.hand(0), k.hand(1), 0.5);
        k.burst(between, 10, { kind: 'shard', colour: [PALETTE.main, PALETTE.core], size: 1.4, life: [0.2, 0.4], speed: [0.2, 0.5], up: [-2, 8], gravity: 30, bias: 2 });
        k.burst(between, 8, { kind: 'mote', size: 1.1, life: [0.2, 0.4], speed: [0.1, 0.3], up: [0, 6], gravity: 0 });
      },
      impact: { secs: 0.6, draw: (k, u) => {
        k.flare(k.chest(), 9 * (1 - u), flashOf(u, 0.25));
        stamp(k, k.caster, u, 0.3, 0.5);
      } },
      linger: { draw: (k, age, left) => {
        const v = seg(age, 0.3, 0.8);
        if (v <= 0) return;
        const a = v * smooth(left / 1);
        // Waiting for the next skin: a little stack over the left shoulder, turning slowly.
        const p = k.local(k.caster, -6, -1, k.caster.tall * 1.02 + Math.sin(age * 1.6) * 0.5);
        stack(k, p, 0.035, more, { alpha: 0.9 * a, turn: age * 0.7 });
        k.glow(p, 6, 0.35 * a * (0.8 + 0.2 * Math.sin(age * 3)));
        if (!k.fast) k.emit(p, 1, { kind: 'mote', size: 1.2, life: [0.6, 1], speed: [0.01, 0.04], up: [-2, 4], gravity: 0 });
      } },
    },
  };
};

/** Ward Link: links wound up round the caster, then sent out along the ground in six chains to a ring at the link's reach; a linked pair over the head for as long as it holds. */
const wardLink = (): SpellVisual => {
  const id = 'warder_ward_link';
  const R = reachOf(id);
  const secs = fxOf(id).secs || 30;
  return {
    palette: PALETTE,
    cast: { timing: { secs: 1.3, release: 0.5 }, pose: wardLinkPose },
    fx: {
      charge: (k, t) => {
        const g = smooth(seg(t, 0.1, 0.5));
        const b = k.caster;
        // Links climbing round the body in a helix.
        const n = k.fast ? 4 : 7;
        for (let i = 0; i < n; i++) {
          const v = clamp(g * 1.3 - (i / n) * 0.3);
          if (v <= 0) continue;
          const an = k.now * 4 + (i / n) * TAU * 1.5;
          const rr = (b.wide * 2.2 + 2.5) / 40;
          plate(k, { x: b.x + Math.cos(an) * rr, y: b.y + Math.sin(an) * rr, z: b.z + b.tall * (0.1 + 0.85 * (i / n) * v) }, 1.3, { alpha: v * (1 - seg(t, 0.5, 0.56)), spin: an, glow: 0.4 });
        }
        k.ring(b, 0.32, { n: 6, turn: Math.PI / 6, band: 0.05, alpha: 0.8 * g, glow: 0.4 });
      },
      release: (k) => k.burst(k.at(k.caster, 0.6), 16, { kind: 'mote', size: 1.1, life: [0.3, 0.6], speed: [0.6, 1.4], up: [0, 6], gravity: 0, drag: 0.2 }),
      impact: { secs: 1.2, draw: (k, u) => {
        const b = k.caster;
        // Six chains run out to the reach, then the ring closes round.
        const run = easeOut(clamp(u / 0.45));
        const step = 0.55;
        const links: number[] = [];
        for (let s = 0; s < 6; s++) {
          const an = (s / 6) * TAU + Math.PI / 6;
          for (let d = step; d <= R * run; d += step) {
            // Each link small where the chain has just reached and full grown behind it.
            links.push(b.x + Math.cos(an) * d, b.y + Math.sin(an) * d, smooth((R * run - d) / (step * 2)), an);
          }
          const head = { x: b.x + Math.cos(an) * R * run, y: b.y + Math.sin(an) * R * run };
          if (run < 1) k.glow(k.on(head.x, head.y, 1), 8, 0.7);
        }
        // A chain run straight to everybody it links, besides the six that show its reach.
        const fade = 1 - seg(u, 0.55, 1), W = Math.max(0.8, 0.7 * k.zoom);
        const others = covered(k, R);
        const thread: number[][] = [];
        for (let s = 0; s < 6; s++) {
          const an = (s / 6) * TAU + Math.PI / 6;
          thread.push([b.x, b.y, b.x + Math.cos(an) * R * run, b.y + Math.sin(an) * R * run]);
        }
        for (const { b: o, d } of others) {
          const an = Math.atan2(o.y - b.y, o.x - b.x), got = Math.min(d, R * run * 1.15);
          thread.push([b.x, b.y, b.x + Math.cos(an) * got, b.y + Math.sin(an) * got]);
          for (let e = step; e <= got; e += step) links.push(b.x + Math.cos(an) * e, b.y + Math.sin(an) * e, smooth((got - e) / (step * 2)), an);
          if (got >= d && !k.state['tied' + whoKey(o)]) {
            k.state['tied' + whoKey(o)] = 1;
            k.burst(k.at(o, 0.6), 8, { kind: 'mote', size: 1.1, life: [0.3, 0.6], speed: [0.2, 0.5], up: [2, 8], gravity: 0 });
          }
        }
        // The thread the links are strung on, under them: chains, not beads.
        k.groundShape(b.x, b.y, R + 1, [
          { kind: 'stroke', colour: PALETTE.ink, alpha: fade, width: W * 2.4, paths: thread, cap: 'round', lift: 0.12 },
          { kind: 'stroke', colour: PALETTE.main, alpha: fade, width: W, paths: thread, cap: 'round', lift: 0.12 },
        ]);
        hexes(k, b, R, links, 0.12, { alpha: fade });
        hexRow(k, b, R, 0.16, { alpha: 0.9 * (1 - 0.6 * seg(u, 0.7, 1)), grow: seg(u, 0.4, 0.95), turn: Math.PI / 6 });
        k.light(b, 3, 0.7 * (1 - u));
      } },
      linger: { secs, draw: (k, age, left) => {
        const a = smooth((age - 0.8) / 0.6) * smooth(left / 1.2);
        if (a <= 0) return;
        const b = k.caster;
        // The reach it holds over, shown again for a moment every five seconds rather than always: a ring eight tiles out is
        // drawn again for every line of the ground it crosses, and half a minute of it is a cost and a clutter both.
        const swell = Math.pow(Math.max(0, Math.sin((age * Math.PI) / 5)), 8);
        if (swell > 0.02) hexRow(k, b, R, 0.16, { alpha: a * 0.4 * swell, turn: Math.PI / 6 });
        link(k, k.at(b, 1.24), 4.2, { alpha: 0.9 * a, turn: age * 1.1 });
        // A smaller pair over everybody it links: theirs is the skin that comes back.
        for (const { b: o } of covered(k, R)) link(k, k.at(o, 1.2), 3, { alpha: 0.7 * a, turn: age * 1.1 + 1 });
        k.ring(b, 0.32, { n: 6, turn: Math.PI / 6, band: 0.04, alpha: 0.35 * a, glow: 0.2 });
      } },
    },
  };
};

/** Stoneskin: the foot stamped, the ground cracked under it, and basalt plates coming up the body joint by joint, their topaz veins going dim as its seconds go. */
const stoneskin = (): SpellVisual => {
  const id = 'warder_stoneskin';
  const fx = fxOf(id);
  const count = sitesFor(fx.cut || 0.25);
  const secs = fx.secs || 10;
  return {
    palette: STONE,
    cast: { timing: { secs: 0.9, release: 0.45 }, pose: stoneskinPose },
    fx: {
      charge: (k, t) => {
        const g = seg(t, 0.1, 0.42);
        k.glow(k.hand(0), 4, 0.5 * g);
        k.glow(k.hand(1), 4, 0.5 * g);
        if (!k.fast) k.emit(k.at(k.caster, 0.02), 14 * g, { kind: 'dust', colour: DUST, size: 1.6, life: [0.3, 0.6], speed: [0.05, 0.15], up: [1, 4], gravity: 2, jitter: 0.35 });
      },
      release: (k) => {
        const foot = k.joint(k.caster, 'ankle1', [0, 0.4, -0.6], 0.02);
        k.burst(foot, 22, { kind: 'dust', colour: DUST, size: 3, life: [0.4, 0.8], speed: [0.4, 1], up: [1, 6], gravity: 4, drag: 0.1 });
        k.burst(foot, 10, { kind: 'shard', colour: [STONE.main, STONE.deep], size: 1.8, life: [0.4, 0.7], speed: [0.3, 0.8], up: [8, 20], gravity: 70, spin: 2 });
      },
      impact: { secs: 1.0, draw: (k, u) => {
        cracks(k, k.caster, 6, 0.5, u / 0.15, 1 - smooth(seg(u, 0.4, 1)), STONE);
        stamp(k, k.caster, u, 0.3, 0.55, STONE);
      } },
      linger: { secs, draw: (k, age, left) => stoneSkin(k, k.caster, age, left, secs, count, 0.04) },
    },
  };
};

/** Ward Burst: the skin cracking with light while it is held in, then thrown off in plates that fly out to the burst's reach and fall there. */
const wardBurst = (): SpellVisual => {
  const id = 'warder_ward_burst';
  const R = reachOf(id);
  return {
    palette: PALETTE,
    cast: { timing: { secs: 1.0, release: 0.5 }, pose: wardBurstPose },
    fx: {
      charge: (k, t) => {
        const on = smooth(seg(t, 0.06, 0.2));
        const crack = smooth(seg(t, 0.2, 0.5));
        if (t < 0.5) skin(k, k.caster, { alpha: on, fill: 0.5, width: 1, crack, heat: 0.3 * crack, turn: 0 });
        k.light(k.caster, 2 + crack, 0.3 + 0.5 * crack * (0.8 + 0.2 * k.rand()));
      },
      hit: (k) => {
        const c = k.at(k.caster, 0.45);
        // Sparks thrown as far as the burst reaches, and dust off the ground.
        k.burst(c, 28, { kind: 'spark', size: 1.6, life: [0.35, 0.5], speed: [R * 1.6, R * 2.2], up: [2, 16], gravity: 30, drag: 0.3 });
        k.burst(k.at(k.caster, 0.03), 20, { kind: 'dust', colour: DUST, size: 1.8, sizeEnd: 3.4, life: [0.4, 0.7], speed: [R * 0.5, R * 0.9], up: [1, 5], gravity: 3, drag: 0.15 });
        k.burst(c, 24, { kind: 'shard', colour: [PALETTE.main, PALETTE.deep, PALETTE.core], size: 1.6, life: [0.4, 0.7], speed: [R * 0.6, R * 1.4], up: [6, 22], gravity: 60, spin: 2.5 });
      },
      impact: { secs: 1.0, draw: (k, u) => {
        const b = k.caster;
        const n = k.fast ? 9 : 16;
        for (let i = 0; i < n; i++) {
          const an = (i / n) * TAU + hashOf(k.seed, i) * 0.4;
          const far = R * (0.82 + 0.18 * hashOf(k.seed, 30 + i));
          const v = easeOut(clamp(u / 0.45));
          const z0 = b.tall * (0.2 + 0.7 * hashOf(k.seed, 50 + i));
          const fall = clamp((u - 0.45) / 0.55);
          // Out on a low arc to the edge, then laid flat on the ground and gone.
          const z = fall > 0 ? 0.6 : z0 * (1 - v) + 10 * Math.sin(Math.PI * v) * (0.5 + 0.5 * hashOf(k.seed, 70 + i));
          // From where it lay on the skin, not from the middle of the body.
          const d = lerp((b.wide * 2.6) / 40, far, v), px = b.x + Math.cos(an) * d, py = b.y + Math.sin(an) * d;
          const p = { x: px, y: py, z: k.ground(px, py) + Math.max(0.6, z) };
          plate(k, p, 2.4, { alpha: 1 - fall * fall, spin: fall > 0 ? 1.2 : an + u * 20, tip: fall > 0 ? 1 : 0, hot: 1 - v, glow: 0.4 * (1 - fall) });
        }
        // The edge of the burst: it hits everything inside this.
        const ring = easeOut(clamp(u / 0.4));
        k.ring(b, 0.5 + (R - 0.5) * ring, { band: 0.1 * (1 - 0.5 * ring), alpha: smooth(u / 0.04) * (1 - smooth(seg(u, 0.35, 0.8))), glow: 0.5 });
        k.ring(b, R, { band: 0.06, alpha: 0.6 * bump(u, 0.3, 0.42, 0.9), dash: 2, glow: 0.4 });
        k.flare(k.at(b, 0.5), 12 * (1 - u), flashOf(u, 0.05));
        k.light(b, R + 1, 0.9 * (1 - u));
        // Every creature inside it is struck as the plates reach it: a flash and chips of topaz off it.
        for (const c of k.bodiesWithin(R, b, ['creature'])) {
          const at = (Math.hypot(c.x - b.x, c.y - b.y) / R) * 0.4, key = 'hit' + whoKey(c);
          if (u < at) continue;
          if (!k.state[key]) {
            k.state[key] = 1;
            k.burst(k.at(c, 0.5), 10, { kind: 'spark', size: 1.3, life: [0.2, 0.35], speed: [0.4, 0.9], up: [2, 10], gravity: 20, heading: k.toward(b, c), cone: 1.2 });
            k.burst(k.at(c, 0.5), 6, { kind: 'shard', colour: [PALETTE.main, PALETTE.core], size: 1.4, life: [0.3, 0.5], speed: [0.3, 0.7], up: [4, 12], gravity: 60, spin: 2, heading: k.toward(b, c), cone: 1 });
          }
          k.flare(k.at(c, 0.5), 7, 0.9 * flashOf(clamp((u - at) / 0.3), 0.1));
        }
      } },
    },
  };
};

/** Sanctuary: the hands' column of light, a dome of hexagon lines drawn up over the reach and closed, and the skin let down over the caster from it. */
const sanctuary = (): SpellVisual => {
  const id = 'warder_sanctuary';
  const R = reachOf(id);
  const s = skinOf(id);
  const dome = (k: FxScene, u: number): void => {
    const b = k.caster;
    const H = R * 40 * 0.3;
    const rise = easeOut(clamp(u / 0.4));
    const a = 0.9 * (1 - smooth(seg(u, 0.5, 1)));
    if (a <= 0.01) return;
    const merid = k.fast ? 8 : 12;
    const steps = 6;
    const cy = k.sy(b);
    const back: number[][] = [], front: number[][] = [];
    const pt = (an: number, ph: number): [number, number, boolean] => {
      const x = b.x + Math.cos(an) * R * Math.cos(ph), y = b.y + Math.sin(an) * R * Math.cos(ph);
      const p = { x, y, z: b.z + H * Math.sin(ph) };
      return [k.sx(p), k.sy(p), k.sy({ x, y, z: b.z }) >= cy];
    };
    // Meridians, up from the ground to as high as it has risen.
    for (let m = 0; m < merid; m++) {
      const an = (m / merid) * TAU + 0.2;
      const line: number[] = [];
      let near = false;
      for (let s2 = 0; s2 <= steps; s2++) {
        const [x, y, n] = pt(an, (Math.PI / 2) * rise * (s2 / steps));
        if (s2 === 0) near = n;
        line.push(x, y);
      }
      (near ? front : back).push(line);
    }
    // Two rings of latitude, each once the meridians reach it.
    for (const ph of [0.35, 0.8]) {
      if (rise * (Math.PI / 2) < ph) continue;
      let line: number[] = [];
      let side: boolean | null = null;
      for (let i = 0; i <= 36; i++) {
        const [x, y, n] = pt((i / 36) * TAU, ph);
        if (side !== null && n !== side) {
          (side ? front : back).push(line);
          line = [line[line.length - 2], line[line.length - 1]];
        }
        side = n;
        line.push(x, y);
      }
      if (line.length > 2) (side ? front : back).push(line);
    }
    // A hexagon where each meridian crosses each ring: the dome is a Warder's lattice, only very large.
    const nodesBack: number[] = [], nodesFront: number[] = [];
    for (const ph of [0.35, 0.8]) {
      const v = seg(rise * (Math.PI / 2), ph - 0.1, ph + 0.05);
      if (v <= 0) continue;
      for (let m = 0; m < merid; m++) {
        const [x, y, n] = pt((m / merid) * TAU + 0.2, ph);
        (n ? nodesFront : nodesBack).push(x, y, v);
      }
    }
    const W = Math.max(0.8, 0.9 * k.zoom);
    const draw = (lines: number[][], nodes: number[], al: number) => (g: CanvasRenderingContext2D): void => {
      g.lineJoin = 'round';
      g.lineCap = 'round';
      for (const [w, c, aa] of [[W * 2.4, k.pal.ink, 0.5], [W, k.pal.main, 1]] as const) {
        g.globalAlpha = al * aa;
        g.strokeStyle = c;
        g.lineWidth = w;
        g.beginPath();
        for (const l of lines) {
          g.moveTo(l[0], l[1]);
          for (let i = 2; i < l.length; i += 2) g.lineTo(l[i], l[i + 1]);
        }
        g.stroke();
      }
      g.strokeStyle = k.pal.ink;
      g.lineWidth = W;
      for (let i = 0; i < nodes.length; i += 3) {
        const R2 = 3.2 * k.zoom * easeBack(nodes[i + 2]);
        g.beginPath();
        for (let j = 0; j < 6; j++) {
          const an = (j / 6) * TAU;
          const px = nodes[i] + Math.cos(an) * R2, py = nodes[i + 1] + Math.sin(an) * R2 * 0.8;
          if (j === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.globalAlpha = al;
        g.fillStyle = nodes[i + 2] < 1 ? k.pal.core : k.pal.main;
        g.fill();
        g.stroke();
      }
    };
    // Sorted at the dome's nearest and furthest foot on the screen, whichever way the camera is turned.
    let lo = { x: b.x, y: b.y, z: b.z }, hi = lo, loY = Infinity, hiY = -Infinity;
    for (let i = 0; i < 8; i++) {
      const p = { x: b.x + Math.cos((i / 8) * TAU) * R, y: b.y + Math.sin((i / 8) * TAU) * R, z: b.z };
      const y = k.sy(p);
      if (y < loY) [loY, lo] = [y, p];
      if (y > hiY) [hiY, hi] = [y, p];
    }
    k.worldDraw(lo, draw(back, nodesBack, a * 0.6), -1);
    k.worldDraw(hi, draw(front, nodesFront, a), 1);
    if (rise > 0.95) k.flare(k.on(b.x, b.y, H + b.z - k.ground(b.x, b.y)), 16 * (1 - seg(u, 0.4, 0.7)), flashOf(seg(u, 0.38, 0.8), 0.1));
  };
  return {
    palette: PALETTE,
    cast: { timing: { secs: 1.8, release: 0.52 }, pose: sanctuaryPose },
    fx: {
      charge: (k, t) => {
        const g = smooth(seg(t, 0.22, 0.46)) * (1 - seg(t, 0.52, 0.6));
        const hands = mid3(k.hand(0), k.hand(1), 0.5);
        if (g > 0.01) k.beam(hands, { x: hands.x, y: hands.y, z: hands.z + 14 * g }, { width: 3, alpha: g, glow: 0.7 });
        k.glow(hands, 7, 0.7 * g);
        hexRow(k, k.caster, R, 0.2, { alpha: 0.85, grow: seg(t, 0.1, 0.52), turn: 0.1 });
        k.light(k.caster, 3, 0.5 * seg(t, 0.2, 0.52));
      },
      release: (k) => k.burst(mid3(k.hand(0), k.hand(1), 0.5), 16, { kind: 'mote', size: 1.2, life: [0.4, 0.8], speed: [0.1, 0.4], up: [10, 26], gravity: 0 }),
      impact: { secs: 1.8, draw: (k, u) => {
        dome(k, u);
        const b = k.caster;
        // What closes over everybody under it comes down as a fall of light inside the reach.
        if (u > 0.35 && u < 0.85 && !k.fast) k.emit(k.on(b.x, b.y, R * 40 * 0.25), 50, { kind: 'mote', size: 1.1, life: [0.6, 1.0], speed: [0, 0.05], up: [-20, -12], gravity: 0, jitter: R * 0.6, jitterZ: 6 });
        k.light(b, R + 1, 0.8 * flashOf(u, 0.3));
      } },
      linger: { draw: (k, age, left) => {
        hexRow(k, k.caster, R, 0.2, { alpha: 0.85 * (1 - smooth((age - 1.2) / 2)), turn: 0.1 });
        skinLinger(k, k.caster, age, left, { knit: { from: 'down' }, secs: 0.6, delay: 0.65, skin: s });
        // And over everybody else it closed over, as the fall of light reaches them.
        for (const { b, d } of covered(k, R)) skinLinger(k, b, age, left, { knit: { from: 'down' }, secs: 0.6, delay: 0.7 + d * 0.06, skin: s, lit: false });
      } },
    },
  };
};

/** Bastion of Stone: the fists brought down on the ground, a shock out to the reach, and a ring of basalt columns standing there for its seconds; a stone skin on the caster. */
const bastion = (): SpellVisual => {
  const id = 'warder_bastion_of_stone';
  const fx = fxOf(id);
  const R = reachOf(id);
  const secs = fx.secs || 10;
  const count = sitesFor(fx.cut || 0.4);
  return {
    palette: STONE,
    cast: { timing: { secs: 1.5, release: 0.55 }, pose: bastionPose },
    fx: {
      charge: (k, t) => {
        const g = seg(t, 0.15, 0.5);
        k.glow(mid3(k.hand(0), k.hand(1), 0.5), 6, 0.6 * g);
        hexRow(k, k.caster, R, 0.14, { alpha: 0.6 * g, grow: g, pal: STONE });
        if (!k.fast) k.emit(k.on(k.caster.x, k.caster.y, 0.5), 30 * g, { kind: 'dust', colour: DUST, size: 1.6, life: [0.3, 0.5], speed: [0.02, 0.1], up: [2, 6], gravity: 8, jitter: R * 0.7 });
        k.light(k.caster, 2, 0.4 * g);
      },
      release: (k) => {
        const c = mid3(k.hand(0), k.hand(1), 0.5);
        k.burst(c, 30, { kind: 'dust', colour: DUST, size: 2, sizeEnd: 4, life: [0.4, 0.7], speed: [0.6, 1.4], up: [1, 6], gravity: 3, drag: 0.15 });
        k.burst(c, 16, { kind: 'shard', colour: [STONE.main, STONE.deep], size: 2, life: [0.4, 0.8], speed: [0.3, 1], up: [10, 26], gravity: 70, spin: 2 });
      },
      impact: { secs: 1.2, draw: (k, u) => {
        const b = k.caster;
        const v = easeOut(clamp(u / 0.32));
        k.ring(b, 0.2 + (R - 0.2) * v, { band: 0.18 * (1 - 0.5 * v), alpha: 1 - smooth(seg(u, 0.3, 0.6)), glow: 0.5 });
        cracks(k, b, 8, 1.4, u / 0.3, 0.8 * (1 - smooth(seg(u, 0.4, 1))), STONE);
        k.light(b, R + 1, 0.8 * (1 - u));
      } },
      linger: { secs, draw: (k, age, left) => {
        const b = k.caster;
        const n = k.fast ? 14 : Math.round((TAU * R) / 1.05);
        const sink = smooth(left / 0.8);
        // No ring on the ground under them for the whole ten seconds: the columns are the edge, and the ground is redrawn per line.
        for (let i = 0; i < n; i++) {
          const an = (i / n) * TAU + 0.1;
          // Up as the shock reaches them, round the ring the way the shock came.
          const on = age - 0.38 - 0.12 * Math.abs(wrap(an - Math.PI / 4)) / Math.PI;
          if (on <= 0) continue;
          const c = { x: b.x + Math.cos(an) * R, y: b.y + Math.sin(an) * R };
          const bit = i < 30 ? 1 << i : 0;
          if (bit && !((k.state.up ?? 0) & bit)) {
            k.state.up = (k.state.up ?? 0) | bit;
            if (i % 2 === 0) k.burst(k.on(c.x, c.y, 1), 5, { kind: 'dust', colour: DUST, size: 2.6, life: [0.4, 0.7], speed: [0.15, 0.4], up: [2, 6], gravity: 4 });
          }
          const h = (6 + 3 * hashOf(k.seed, i)) * easeBack(clamp(on / 0.18)) * sink;
          const base = k.on(c.x, c.y, -0.5);
          prism(k, base, 0.11 + 0.03 * hashOf(k.seed, 20 + i), h, { alpha: 1, turn: hashOf(k.seed, 40 + i), pal: STONE, top: STONE.core });
        }
        if (left < 0.8 && !k.state.sunk) {
          k.state.sunk = 1;
          for (let i = 0; i < 6; i++) {
            const an = (i / 6) * TAU;
            k.burst(k.on(b.x + Math.cos(an) * R, b.y + Math.sin(an) * R, 1), 4, { kind: 'dust', colour: DUST, size: 2.6, life: [0.4, 0.8], speed: [0.1, 0.3], up: [1, 4], gravity: 3, jitter: 0.6 });
          }
        }
        stoneSkin(k, b, age, left, secs, count, 0.12);
        // On everybody it covered too, as the shock reaches where they stand.
        covered(k, R, 6).forEach(({ b: o, d }, i) => stoneSkin(k, o, age, left, secs, count, 0.12 + (d / R) * 0.3, `:${i}`));
      } },
    },
  };
};

/** Unbreakable: topaz drawn into the crossed forearms, then a hexagonal crystal snapped up round the body, clearing to a cage whose edges drain from the top as its seconds go. */
const unbreakable = (): SpellVisual => {
  const id = 'warder_unbreakable';
  const secs = fxOf(id).secs || 6;
  const cage = (b: Body): { r: number; h: number } => ({ r: (b.wide * 2 + 1) / 40, h: b.tall * 1.1 });
  return {
    palette: PALETTE,
    cast: { timing: { secs: 1.6, release: 0.56 }, pose: unbreakablePose },
    fx: {
      charge: (k, t) => {
        const g = smooth(seg(t, 0.15, 0.54));
        const arms = mid3(k.hand(0), k.hand(1), 0.5);
        if (t < 0.56) k.orb(arms, 1.2 + 2.6 * g, { alpha: g, turn: k.now * 3, sides: 6, bias: 3 });
        // Plates drawn in from all round to the arms.
        const b = k.caster;
        const n = k.fast ? 3 : 6;
        for (let i = 0; i < n; i++) {
          const v = clamp((t - 0.15 - i * 0.04) / 0.32);
          if (v <= 0 || v >= 1) continue;
          const an = (i / n) * TAU + 0.5;
          const rr = 0.9 * (1 - easeIn(v));
          const from = { x: b.x + Math.cos(an) * rr, y: b.y + Math.sin(an) * rr, z: b.z + b.tall * (0.3 + 0.4 * hashOf(i, 3)) };
          plate(k, mid3(from, arms, easeIn(v)), 2, { alpha: smooth(v * 4), spin: an + v * 9, glow: 0.4 });
        }
        k.light(arms, 2.5, 0.6 * g);
      },
      release: (k) => {
        k.flash(0.16);
        k.burst(k.at(k.caster, 0.5), 30, { kind: 'spark', size: 2, life: [0.3, 0.6], speed: [0.6, 1.6], up: [10, 40], gravity: 40 });
        k.burst(k.at(k.caster, 0.03), 16, { kind: 'dust', colour: DUST, size: 3, life: [0.4, 0.8], speed: [0.4, 0.9], up: [1, 4], gravity: 3, drag: 0.15 });
      },
      impact: { secs: 0.8, draw: (k, u) => {
        stamp(k, k.caster, u, 0.35, 0.8);
        k.flare(k.at(k.caster, 1.1), 16 * (1 - u), flashOf(u, 0.08));
      } },
      linger: { secs, draw: (k, age, left) => {
        const b = k.caster;
        const { r, h } = cage(b);
        // Snapped up from the ground, solid for a moment, then clear but for its edges.
        const up = easeBack(clamp(age / 0.14));
        const solid = 1 - smooth((age - 0.12) / 0.6);
        const end = smooth(left / 0.35);
        const level = clamp(left / secs);
        prism(k, { x: b.x, y: b.y, z: b.z }, r, h * up, { alpha: end, cage: true, level, faces: 0.08 + 0.4 * solid, turn: Math.PI / 6 });
        if (left < 0.35 && !k.state.broke) {
          k.state.broke = 1;
          k.burst(k.at(b, 0.5), 30, { kind: 'shard', colour: [PALETTE.main, PALETTE.core, PALETTE.deep], size: 1.8, life: [0.4, 0.8], speed: [0.3, 0.9], up: [4, 20], gravity: 60, jitterZ: 7, spin: 2.5 });
        }
        // A glint run down the uprights now and then.
        const ph = (age % 1.6) / 1.6;
        if (age > 0.5) k.flare(k.local(b, 0, r * 40 * 0.98, h * (1 - ph) * level), 5, 0.8 * Math.sin(Math.PI * ph) * end, PALETTE.core);
        k.ring(b, r * 1.08, { n: 6, turn: Math.PI / 6, band: 0.04, alpha: 0.6 * end, glow: 0.4 });
        k.light(b, 2, (0.3 + 0.5 * solid) * end);
      } },
    },
  };
};

/** The seam down the front of a skin closed from behind (`Knit` 'close'), `width` pixels at zoom one at its widest. */
function seam(k: FxScene, b: Body, alpha: number, width: number): void {
  if (alpha <= 0.01) return;
  // Just outside the tight skin an Aegis is, in the body's own units.
  const out = b.wide * 1.55;
  const pts: P3[] = [];
  for (let i = 0; i <= 5; i++) {
    const Y = 0.85 - 1.6 * (i / 5);
    pts.push(k.local(b, 0, out * Math.sqrt(1 - Y * Y) + 0.5, b.tall * (0.5 + 0.48 * Y)));
  }
  k.ribbon(pts, { width, taper: 'both', alpha, glow: alpha > 0.5 ? 1 : 0.4 });
}

/** Aegis: the topaz focus lit in the raised fist, then the skin closing over the body from behind as the arms swing to, sealed with a seam of light down the front. */
const aegis = (): SpellVisual => {
  const id = 'aegis';
  const s = skinOf(id);
  const close = 0.2;
  return {
    palette: PALETTE,
    cast: { timing: { secs: 1.1, release: 0.42 }, pose: aegisPose },
    fx: {
      charge: (k, t) => {
        // The topaz in the left fist, lit as the palm passes over it and gone cold once the skin is out of it.
        const lit = smooth(seg(t, 0.08, 0.3)) * (1 - smooth(seg(t, 0.5, 0.75)));
        const stone = k.hand(0);
        k.orb(stone, 1.6, { alpha: Math.max(0.35, lit) * (1 - seg(t, 0.8, 0.95)), turn: k.now * 2, sides: 6, bias: 3, glow: lit });
        k.light(stone, 1.6, 0.5 * lit);
      },
      release: (k) => k.burst(k.hand(0), 10, { kind: 'mote', size: 1.1, life: [0.3, 0.5], speed: [0.2, 0.5], up: [0, 8], gravity: 0 }),
      impact: { secs: 0.7, draw: (k, u) => {
        const b = k.caster;
        const v = seg(u, (close * 0.8) / 0.7, (close * 1.6) / 0.7);
        if (v > 0 && v < 1) seam(k, b, flashOf(v, 0.2), 2.6);
        stamp(k, b, u, 0.3, 0.5);
      } },
      linger: { draw: (k, age, left) => {
        skinLinger(k, k.caster, age, left, { knit: { from: 'close', th: frontOf(k.caster) }, secs: close, skin: s, size: 0.86, spin: 0 });
        // Where it closed stays to be seen, faintly, for as long as it is over them: an Aegis is one skin, sealed.
        seam(k, k.caster, 0.4 * smooth((age - close * 2) / 0.5) * smooth((left - 0.8) / 0.4), 1.4);
      } },
    },
  };
};

/** Bulwark: the emerald focus at the belly, then a wall of upright plates thrown out over the ground to the reach, folding in on everybody inside it; the skin on the caster. */
const bulwark = (): SpellVisual => {
  const id = 'bulwark';
  const R = reachOf(id);
  const s = skinOf(id);
  const wall = (k: FxScene, u: number): void => {
    const b = k.caster;
    const n = k.fast ? 14 : Math.round((TAU * R) / 0.55);
    const out = easeOut(clamp(u / 0.45));
    const rr = 0.3 + (R - 0.3) * out;
    const tilt = smooth(seg(u, 0.6, 0.95)) * 1.1;
    const a = 1 - smooth(seg(u, 0.75, 1));
    if (a <= 0.01) return;
    const hh = 6 * (0.4 + 0.6 * out);
    const w = Math.min(0.24, (TAU * rr) / n) * 0.48;
    const cy = k.sy(b);
    // The plates in two pictures, the half of the ring beyond the caster and the half before them, each filled by
    // colour in one go: thirty-odd plates are six fills and two strokes, not thirty records.
    const halves = [0, 1].map(() => ({ lit: new Path2D(), shade: new Path2D(), shine: new Path2D(), any: false }));
    let far = { x: b.x, y: b.y, z: b.z }, near = far, farY = Infinity, nearY = -Infinity;
    for (let i = 0; i < n; i++) {
      const an = (i / n) * TAU;
      const cx = Math.cos(an), sy = Math.sin(an);
      const base = { x: b.x + cx * rr, y: b.y + sy * rr };
      const gz = k.ground(base.x, base.y);
      const foot = { x: base.x, y: base.y, z: gz };
      const footY = k.sy(foot);
      if (footY < farY) [farY, far] = [footY, foot];
      if (footY > nearY) [nearY, near] = [footY, foot];
      const xs: number[] = [], ys: number[] = [];
      for (let j = 0; j < 6; j++) {
        const q = (j / 6) * TAU;
        const along = Math.sin(q) * w, upv = (Math.cos(q) + 1) * hh;
        // Folded in toward the middle about its foot.
        const inward = (upv * Math.sin(tilt)) / 40;
        const p = { x: base.x - sy * along - cx * inward, y: base.y + cx * along - sy * inward, z: gz + upv * Math.cos(tilt) };
        xs.push(k.sx(p));
        ys.push(k.sy(p));
      }
      const facing = k.sy({ x: base.x + cx * 0.1, y: base.y + sy * 0.1, z: gz }) > footY;
      const h = halves[footY > cy ? 1 : 0];
      h.any = true;
      const into = facing ? h.lit : h.shade;
      into.moveTo(xs[0], ys[0]);
      for (let j = 1; j < 6; j++) into.lineTo(xs[j], ys[j]);
      into.closePath();
      h.shine.moveTo(xs[0], ys[0]);
      h.shine.lineTo(xs[1], ys[1]);
      h.shine.lineTo((xs[0] + xs[3]) / 2, (ys[0] + ys[3]) / 2);
      h.shine.closePath();
    }
    const W = Math.max(0.8, 0.7 * k.zoom);
    halves.forEach((h, side) => {
      if (!h.any) return;
      k.worldDraw(side ? near : far, (g) => {
        g.globalAlpha = a * (side ? 0.75 : 0.95);
        g.fillStyle = EMERALD.main;
        g.fill(h.lit);
        g.fillStyle = EMERALD.deep;
        g.fill(h.shade);
        g.lineJoin = 'round';
        g.lineWidth = W;
        g.strokeStyle = EMERALD.ink;
        g.stroke(h.lit);
        g.stroke(h.shade);
        g.globalAlpha = a * 0.8;
        g.fillStyle = EMERALD.core;
        g.fill(h.shine);
      }, side ? 0.6 : -0.6);
    });
    k.ring(b, rr, { band: 0.06, alpha: 0.7 * a, glow: 0.5 });
  };
  return {
    palette: EMERALD,
    cast: { timing: { secs: 1.4, release: 0.5 }, pose: bulwarkPose },
    fx: {
      charge: (k, t) => {
        const g = smooth(seg(t, 0.1, 0.42));
        const gem = mid3(k.hand(0), k.hand(1), 0.5);
        if (t < 0.5) k.orb(gem, 1.6 + 1.4 * g, { alpha: Math.max(0.4, g), turn: k.now * 2.5, sides: 6, bias: 3 });
        k.light(gem, 2, 0.6 * g);
        k.ring(k.caster, 0.36, { n: 6, turn: Math.PI / 6, band: 0.05, alpha: 0.7 * g, glow: 0.4 });
      },
      release: (k) => {
        const gem = mid3(k.hand(0), k.hand(1), 0.5);
        k.burst(gem, 12, { kind: 'mote', size: 1.2, life: [0.3, 0.6], speed: [0.6, 1.4], up: [0, 6], gravity: 0, drag: 0.2 });
        k.burst(k.at(k.caster, 0.03), 18, { kind: 'dust', colour: DUST, size: 2.6, life: [0.4, 0.7], speed: [R * 0.4, R * 0.7], up: [1, 4], gravity: 3, drag: 0.2 });
      },
      impact: { secs: 1.3, draw: (k, u) => {
        wall(k, u);
        k.flare(mid3(k.hand(0), k.hand(1), 0.5), 10 * (1 - u), flashOf(u, 0.06));
        k.light(k.caster, R + 1, 0.8 * (1 - u));
      } },
      linger: { draw: (k, age, left) => {
        skinLinger(k, k.caster, age, left, { knit: { from: 'up' }, secs: 0.45, delay: 0.75, skin: s });
        // Everybody inside the wall as it folded in: theirs closes as the plates fall on them.
        for (const { b, d } of covered(k, R)) skinLinger(k, b, age, left, { knit: { from: 'close', th: bearing(k, b, k.caster) + Math.PI }, secs: 0.45, delay: 0.75 + (R - d) * 0.03, skin: s, lit: false });
      } },
    },
  };
};

export const WARDER: Record<string, SpellVisual> = {
  // Ward (buff, on self, lasts 12 s): With a topaz or emerald focus in your pack: a skin of 40% over you.
  warder_ward: ward(),
  // Ward Other (ally, on player, lasts 12 s): With a topaz or emerald focus in your pack: a skin of 40% over somebody within 6 tiles of you.
  warder_ward_other: wardOther(),
  // Greater Ward (buff, on self, lasts 12 s): With a topaz or emerald focus in your pack: a skin of 100% over you.
  warder_greater_ward: greaterWard(),
  // Thicken (buff, on self, lasts 60 s): With a topaz or emerald focus in your pack: the next skin you lay within 60 s, over anybody, is 50% larger.
  warder_thicken: thicken(),
  // Greater Ward Other (ally, on player, lasts 12 s): With a topaz or emerald focus in your pack: a skin of 100% over somebody within 6 tiles of you.
  warder_greater_ward_other: greaterWardOther(),
  // Ward Link (nova, on self, 8 tiles round, shown for its 30 s): for 30 s, when a skin of yours over somebody within 8 tiles of you is used up, a skin of 30% goes back...
  warder_ward_link: wardLink(),
  // Stoneskin (buff, on self, lasts 10 s): With a topaz or emerald focus in your pack: for 10 s you take 25% less from every blow.
  warder_stoneskin: stoneskin(),
  // Ward Burst (nova, on self, 3 tiles round): With a topaz or emerald focus in your pack: the skin over you breaks, and every enemy within 3 tiles of you takes 1 damage for every hundredth of y...
  warder_ward_burst: wardBurst(),
  // Deep Ward (buff, on self, lasts 12 s): With a topaz or emerald focus in your pack: a skin of 200% over you.
  warder_deep_ward: deepWard(),
  // Sanctuary (nova, on self, 6 tiles round, lasts 12 s): With a topaz or emerald focus in your pack: a skin of 80% over you and over everybody within 6 tiles of you.
  warder_sanctuary: sanctuary(),
  // Bastion of Stone (nova, on self, 4 tiles round, lasts 10 s): With a topaz or emerald focus in your pack: for 10 s you and everybody within 4 tiles of you take 40% less from every blow.
  warder_bastion_of_stone: bastion(),
  // Unbreakable (buff, on self, lasts 6 s): With a topaz or emerald focus in your pack: for 6 s no blow aimed at you lands.
  warder_unbreakable: unbreakable(),

  /* ---- the arcane, out of a focus ---- */
  // Aegis (buff, on self, lasts 12 s): A skin over you that takes the blows instead, until it is used up.
  aegis: aegis(),
  // Bulwark (nova, on self, 3 tiles round, lasts 12 s): The same skin, over everybody standing near you.
  bulwark: bulwark(),
};
