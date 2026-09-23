import { FURNITURE, furnitureDef } from '../game/furniture';
import type { Side } from '../game/building';
import { HALF_H, HALF_W, HEIGHT_SCALE, UNITS_PER_TILE } from './iso';
import { VIEWS } from './view';

/**
 * Furniture, built rather than drawn.
 *
 * Every piece was a flat iso box or two in three browns: a top rhombus and the
 * two faces nearest you, the same shape at every angle the camera stood at,
 * with the front of the thing painted over those two faces whichever way it
 * was really turned. From the four square-on viewpoints that put a diamond of
 * a table on a square of floor, and five pieces -- the stall, the mailbox,
 * the bell, the statue and the altar -- had never been drawn at all and stood
 * about as chests.
 *
 * A piece is a small model now, made in its own frame in tenths of a metre --
 * across it, toward its front, and up -- out of boxes, turned solids, rods,
 * panels, wheels, hulls and hanging cloth, and put on the screen through the
 * same turn the camera puts the world through. So it stands on its floor at every one of the eight
 * viewpoints, its doors are on the side it was set facing, and walking round
 * a wardrobe shows you its back. Its parts are laid back to front by where
 * they stand rather than in the order they are listed, so the near leg of a
 * table comes out in front of the far one from wherever it is seen.
 *
 * It is built of the wood it was built of: an oak chest is honey, a cherry
 * one red, a pine one pale. And it is drawn once for each way it is seen and
 * kept, so a room full of it costs a blit a piece.
 */
const TAU = Math.PI * 2;

type RGB = readonly [number, number, number];
type V3 = readonly [number, number, number];
type Pt = [number, number];

/* ---- which way round a piece stands on the screen -------------------------- */

/**
 * The screen, in pixels at zoom one, a unit along each of a piece's two
 * level axes carries you: across it (to its right, as you face its front)
 * and toward its front. A unit is a tenth of a metre, the world's height
 * unit, so a subtile is ten of them each way.
 */
export interface PieceView {
  ux: number;
  uy: number;
  vx: number;
  vy: number;
}

/** A world step to the screen at zoom one, through the camera's turn. */
const toScreen = (dx: number, dy: number, rotation: number): Pt => {
  const { cos, sin } = VIEWS[((rotation % 8) + 8) % 8];
  const u = dx * cos + dy * sin, v = dy * cos - dx * sin;
  return [((u - v) * HALF_W) / UNITS_PER_TILE, ((u + v) * HALF_H) / UNITS_PER_TILE];
};

/** Which way is out through a piece's front, in the world, and which way its width runs. */
const FRONT: Record<Side, [number, number]> = { s: [0, 1], e: [1, 0], n: [0, -1], w: [-1, 0] };
const ACROSS: Record<Side, [number, number]> = { s: [1, 0], e: [0, -1], n: [-1, 0], w: [0, 1] };

/** How a piece set facing `facing` stands on the screen from viewpoint `rotation`. */
export function pieceView(facing: Side, rotation: number): PieceView {
  const [ux, uy] = toScreen(ACROSS[facing][0], ACROSS[facing][1], rotation);
  const [vx, vy] = toScreen(FRONT[facing][0], FRONT[facing][1], rotation);
  return { ux, uy, vx, vy };
}

/**
 * And a piece turned to a heading instead, an angle in the world as
 * `atan2(dy, dx)` gives one: what is driven or pulled points the way it is
 * going. Its width axis -- the way a cart's shafts run -- goes along the
 * heading, which is where it points when it is set down facing south.
 */
export function headingView(angle: number, rotation: number): PieceView {
  const c = Math.cos(angle), s = Math.sin(angle);
  const [ux, uy] = toScreen(c, s, rotation);
  const [vx, vy] = toScreen(-s, c, rotation);
  return { ux, uy, vx, vy };
}

/* ---- colour --------------------------------------------------------------- */

const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as RGB;
const rgb = (c: RGB, k = 1, a = 1): string =>
  `rgba(${Math.max(0, Math.min(255, Math.round(c[0] * k)))}, ${Math.max(0, Math.min(255, Math.round(c[1] * k)))}, ${Math.max(0, Math.min(255, Math.round(c[2] * k)))}, ${a})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** What a part is made of: the colour of it, and the ink round it. */
interface Paint {
  body: RGB;
  ink: RGB;
}

const INK_WARM: RGB = [46, 32, 28];
/** A material from its colour, inked in a darker warm shade of itself. */
const paintOf = (body: RGB, ink = 0.62): Paint => ({ body, ink: mix(body, INK_WARM, ink) });

/**
 * The woods, sawn and planed: what a board of each looks like on a bench,
 * rather than the bark on the tree. Oak is honey, pine and birch are pale,
 * cedar and cherry run red, plum is darkest.
 */
const WOOD_TONE: Record<string, string> = {
  pine: '#dcc093', birch: '#e4d2ae', oak: '#bb8f5c', maple: '#d8b489', willow: '#cfbe9a', cedar: '#bf7d5e',
  apple: '#bf8f72', cherry: '#ad6a4e', olive: '#bba27a', pear: '#c69e86', plum: '#955f50', peach: '#cfa682',
  fig: '#d2bb93', lemon: '#dcc692', pomegranate: '#a26e56', apricot: '#cc9f67', quince: '#caa87d',
};
/** What a piece is built of when it does not say: oak. */
const WOOD_PLAIN = '#b88c5a';
const woodOf = (material?: string): Paint => paintOf(hex(WOOD_TONE[material ?? ''] ?? WOOD_PLAIN));

const IRON: Paint = { body: hex('#6b6873'), ink: hex('#34323b') };
const BRASS: Paint = { body: hex('#d9b460'), ink: hex('#7c5e28') };
const LINEN: Paint = { body: hex('#efe9dc'), ink: hex('#9a8f7e') };
const STONE: Paint = { body: hex('#d2cabb'), ink: hex('#857c6c') };
const SOOT: Paint = { body: hex('#3a302c'), ink: hex('#1e1816') };

/** A colour a piece has been dyed: the lit face and the shaded one. */
export interface Tint {
  colour: string;
  shade: string;
}

/* ---- the kit ------------------------------------------------------------- */

/** One thing a piece is built of, and the box in its own frame it stands in, which is what it is sorted by. */
interface Part {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
  draw: () => void;
}

/**
 * A face's own coordinates: `s` across it from its left as you look at it
 * and `t` up it -- or, on a top, `s` along the piece's width and `t` from its
 * back to its front -- in units, to the screen.
 */
type FaceAt = (s: number, t: number) => Pt;
type FaceName = 'front' | 'back' | 'left' | 'right' | 'top';
/** What is drawn on a face once it is filled: a door, a drawer, the grain. */
type Deco = Partial<Record<FaceName, (F: FaceAt, w: number, h: number) => void>>;
/** What is drawn on a panel: `F` runs 0 to 1 along its first edge and 0 to 1 toward its fourth corner, and `k` is the light it caught. */
type PanelDeco = (F: (u: number, v: number) => Pt, k: number) => void;

interface LatheOpts {
  /** What the top is closed with; `null` leaves it open. */
  cap?: Paint | null;
  /** Hoops round it: the height, what they are made of and how wide. */
  bands?: Array<[number, Paint, number]>;
  /** How many staves it is coopered from, a line down each. */
  staves?: number;
  /** For masonry: the heights of the bed joints, with the joints between the stones broken course to course. */
  courses?: number[];
  /** Whatever is drawn on the top once it is closed, given the top in its own round coordinates. */
  lid?: (F: (a: number, r: number) => Pt) => void;
}

class Scene {
  readonly parts: Part[] = [];
  /** How wide the ink is, in the scaled space the piece is drawn in. */
  readonly ink: number;
  /**
   * The way toward you, in the piece's frame: the one direction the
   * projection flattens to a point. A face is seen when it is turned toward
   * this, which settles a slant, a curve or a face turned down as surely as an
   * upright one.
   */
  readonly toward: V3;
  /** The patches of floor it shades, when it says; otherwise its footprint, drawn in a little. */
  shadows?: Array<[number, number, number, number]>;

  /** `g` is set late when the piece is baked, since how big a canvas it needs is known only once it is built. */
  constructor(public g: CanvasRenderingContext2D, readonly v: PieceView, zoom: number) {
    this.ink = Math.max(0.85 / zoom, 0.9);
    const k = v.vx * v.uy - v.ux * v.vy;
    const s = Math.sign(k) || 1;
    this.toward = [s * v.vx, -s * v.ux, (s * k) / HEIGHT_SCALE];
  }

  /** A point in the piece's frame, to the screen. */
  P(x: number, y: number, z: number): Pt {
    const v = this.v;
    return [x * v.ux + y * v.vx, x * v.uy + y * v.vy - z * HEIGHT_SCALE];
  }

  /** Whether an upright face turned along (nx, ny) looks at you: a step out through it goes down the screen. */
  sees(nx: number, ny: number): boolean {
    return nx * this.v.uy + ny * this.v.vy > 1e-6;
  }

  /** Whether a face turned along (nx, ny, nz), any way at all, looks at you. */
  faces(nx: number, ny: number, nz: number): boolean {
    const t = this.toward;
    return nx * t[0] + ny * t[1] + nz * t[2] > 1e-6;
  }

  /** How near you a point of the piece is, for laying a few things in order inside one part. */
  depth(x: number, y: number, z = 0): number {
    const t = this.toward;
    return x * t[0] + y * t[1] + z * t[2];
  }

  /**
   * How much light a face turned along (nx, ny, nz) catches. A top has all of
   * it; a side has more the further round to the left it looks, as every
   * piece was lit before -- the left of the two near faces paler than the
   * right -- which is now a matter of where the face is turned on the screen
   * rather than of which face it is.
   */
  light(nx: number, ny: number, nz: number): number {
    const sx = nx * this.v.ux + ny * this.v.vx, sy = nx * this.v.uy + ny * this.v.vy;
    const l = Math.hypot(sx, sy);
    const side = l < 1e-9 ? 0.84 : 0.84 - (0.15 * sx) / l;
    const up = Math.max(0, Math.min(1, nz));
    return up + (1 - up) * side;
  }

  part(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, draw: () => void): void {
    this.parts.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), draw });
  }

  /* -- drawing -- */

  poly(pts: Pt[]): void {
    const g = this.g;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
  }

  fillInk(pts: Pt[], fill: string, ink: RGB, inkA = 1): void {
    const g = this.g;
    this.poly(pts);
    g.fillStyle = fill;
    g.fill();
    g.strokeStyle = rgb(ink, 1, inkA);
    g.lineWidth = this.ink;
    g.lineJoin = 'round';
    g.stroke();
  }

  line(a: Pt, b: Pt, style: string, w: number): void {
    const g = this.g;
    g.strokeStyle = style;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
  }

  /**
   * A box, square to the piece: each face you can see filled in the light it
   * catches, decorated, and inked, the sides before the top.
   */
  /**
   * `under`, when it is given, is the height the box is sorted as reaching
   * rather than the height it is: a pole that runs up to the underside of an
   * awning or a roof is always behind what it holds up, from wherever it is
   * seen, and saying so is simpler than cutting the pole in two.
   */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, p: Paint, deco?: Deco, under?: number): void {
    this.part(x0, x1, y0, y1, z0, under ?? z1, () => this.drawBox(x0, x1, y0, y1, z0, z1, p, deco));
  }

  drawBox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, p: Paint, deco?: Deco): void {
    const P = (x: number, y: number, z: number): Pt => this.P(x, y, z);
    const face = (name: FaceName, pts: Pt[], n: V3, F: FaceAt, w: number, h: number): void => {
      this.fillInk(pts, rgb(p.body, this.light(n[0], n[1], n[2])), p.ink);
      const d = deco?.[name];
      if (d) {
        this.g.save();
        this.poly(pts);
        this.g.clip();
        d(F, w, h);
        this.g.restore();
        this.poly(pts);
        this.g.strokeStyle = rgb(p.ink);
        this.g.lineWidth = this.ink;
        this.g.stroke();
      }
    };
    if (this.sees(0, 1)) face('front', [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], [0, 1, 0], (s, t) => P(x0 + s, y1, z0 + t), x1 - x0, z1 - z0);
    if (this.sees(0, -1)) face('back', [P(x1, y0, z0), P(x0, y0, z0), P(x0, y0, z1), P(x1, y0, z1)], [0, -1, 0], (s, t) => P(x1 - s, y0, z0 + t), x1 - x0, z1 - z0);
    if (this.sees(1, 0)) face('right', [P(x1, y1, z0), P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1)], [1, 0, 0], (s, t) => P(x1, y1 - s, z0 + t), y1 - y0, z1 - z0);
    if (this.sees(-1, 0)) face('left', [P(x0, y0, z0), P(x0, y1, z0), P(x0, y1, z1), P(x0, y0, z1)], [-1, 0, 0], (s, t) => P(x0, y0 + s, z0 + t), y1 - y0, z1 - z0);
    face('top', [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], [0, 0, 1], (s, t) => P(x0 + s, y0 + t, z1), x1 - x0, y1 - y0);
  }

  /**
   * A turned solid standing on the floor of the piece: a barrel, a bowl, a
   * bell. `prof` runs up it as [height, radius] pairs; each band between two
   * of them is cut into `n` faces, and those that look at you are filled in
   * the light they catch, then the whole is inked round its outline.
   */
  lathe(cx: number, cy: number, prof: Array<[number, number]>, p: Paint, n = 16, opts: LatheOpts = {}): void {
    const rMax = Math.max(...prof.map((q) => q[1]));
    const zs = prof.map((q) => q[0]);
    this.part(cx - rMax, cx + rMax, cy - rMax, cy + rMax, Math.min(...zs), Math.max(...zs), () => this.drawLathe(cx, cy, prof, p, n, opts));
  }

  drawLathe(cx: number, cy: number, prof: Array<[number, number]>, p: Paint, n: number, opts: LatheOpts): void {
    const g = this.g;
    const at = (a: number, r: number, z: number): Pt => this.P(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z);
    // The bands, the far faces first: a band's faces do not overlap one another, but a flared one laps the band under it.
    for (let i = 0; i < prof.length - 1; i++) {
      const [za, ra] = prof[i], [zb, rb] = prof[i + 1];
      const slope = (ra - rb) / Math.max(1e-6, Math.hypot(zb - za, ra - rb));
      const quads: Array<{ pts: Pt[]; k: number; d: number }> = [];
      for (let j = 0; j < n; j++) {
        const a0 = (j / n) * TAU, a1 = ((j + 1) / n) * TAU, am = (a0 + a1) / 2;
        const nx = Math.cos(am), ny = Math.sin(am);
        const nz = slope;
        const horiz = Math.sqrt(Math.max(0, 1 - nz * nz));
        // A hair of slack, so the faces either side of the silhouette meet rather than leave a sliver between them.
        if (!this.faces(nx * horiz, ny * horiz, nz + 0.04)) continue;
        const pts = [at(a0, ra, za), at(a1, ra, za), at(a1, rb, zb), at(a0, rb, zb)];
        quads.push({ pts, k: this.light(nx * horiz, ny * horiz, nz), d: this.depth(nx, ny) });
      }
      quads.sort((q, r) => q.d - r.d);
      for (const q of quads) {
        this.poly(q.pts);
        g.fillStyle = rgb(p.body, q.k);
        g.fill();
        g.strokeStyle = rgb(p.body, q.k);
        g.lineWidth = 0.6;
        g.stroke();
      }
    }
    // Staves: a line down each, on the side you can see.
    if (opts.staves) {
      g.strokeStyle = rgb(p.ink, 1, 0.35);
      g.lineWidth = this.ink * 0.7;
      for (let j = 0; j < opts.staves; j++) {
        const a = (j / opts.staves) * TAU + 0.2;
        if (this.depth(Math.cos(a), Math.sin(a)) <= 0.05) continue;
        g.beginPath();
        prof.forEach(([z, r], i) => {
          const [x, y] = at(a, r, z);
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        });
        g.stroke();
      }
    }
    // Courses: a bed joint round it at each height, and the joints between the stones of a course, broken over the course below.
    if (opts.courses) {
      const cs = opts.courses;
      const an = this.nearAngle();
      g.strokeStyle = rgb(p.ink, 1, 0.4);
      g.lineWidth = this.ink * 0.6;
      for (const z of cs) {
        const r = this.radiusAt(prof, z);
        g.beginPath();
        for (let j = 0; j <= 16; j++) {
          const [x, y] = at(an - Math.PI / 2 + (j / 16) * Math.PI, r, z);
          if (j) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.stroke();
      }
      const bottom = prof[0][0], top = prof[prof.length - 1][0];
      const beds = [bottom, ...cs, top];
      for (let i = 0; i < beds.length - 1; i++) {
        const za = beds[i], zb = beds[i + 1];
        // Stones about as long as a course is tall, twice over, round the widest part of the course.
        const r = this.radiusAt(prof, (za + zb) / 2);
        const m = Math.max(6, Math.round((TAU * r) / ((zb - za) * 2.2)));
        for (let j = 0; j < m; j++) {
          const a = ((j + (i % 2) * 0.5) / m) * TAU;
          if (this.depth(Math.cos(a), Math.sin(a)) <= 0.08) continue;
          const A = at(a, this.radiusAt(prof, za), za), B = at(a, this.radiusAt(prof, zb), zb);
          g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke();
        }
      }
    }
    // Hoops and bands round it.
    for (const [z, bp, w] of opts.bands ?? []) this.bandAt(cx, cy, this.radiusAt(prof, z) + 0.12, z, w, bp);
    // The outline round the whole: its two sides and the near half of its foot.
    this.latheOutline(cx, cy, prof, p.ink);
    // And the top, if it is closed.
    const [zt, rt] = prof[prof.length - 1];
    if (opts.cap !== null && rt > 0.05) {
      const cap = opts.cap ?? p;
      const ring: Pt[] = [];
      for (let j = 0; j < 32; j++) ring.push(at((j / 32) * TAU, rt, zt));
      this.fillInk(ring, rgb(cap.body, 1.02), cap.ink);
      opts.lid?.((a, r) => at(a, r, zt));
    }
  }

  /** The radius of a turned profile at height `z`. */
  radiusAt(prof: Array<[number, number]>, z: number): number {
    for (let i = 0; i < prof.length - 1; i++) {
      const [za, ra] = prof[i], [zb, rb] = prof[i + 1];
      if ((z >= za && z <= zb) || (z <= za && z >= zb)) return ra + ((rb - ra) * (z - za)) / (zb - za || 1);
    }
    return prof[prof.length - 1][1];
  }

  /** The angle, in the piece's frame, of the point of a level ring nearest you. */
  nearAngle(): number {
    return Math.atan2(this.v.vy, this.v.uy);
  }

  /** A hoop of width `w` round a turned thing at height `z`: its near half, lit, and inked. */
  bandAt(cx: number, cy: number, r: number, z: number, w: number, p: Paint): void {
    const g = this.g;
    const an = this.nearAngle();
    const top: Pt[] = [], bot: Pt[] = [];
    for (let j = 0; j <= 20; j++) {
      const a = an - Math.PI / 2 + (j / 20) * Math.PI;
      top.push(this.P(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z + w / 2));
      bot.push(this.P(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z - w / 2));
    }
    this.poly([...top, ...bot.reverse()]);
    g.fillStyle = rgb(p.body, 0.95);
    g.fill();
    g.strokeStyle = rgb(p.ink);
    g.lineWidth = this.ink * 0.8;
    g.stroke();
  }

  /** The silhouette of a turned thing: the outermost point each side at every ring, and the near half of the foot. */
  latheOutline(cx: number, cy: number, prof: Array<[number, number]>, ink: RGB): void {
    const g = this.g;
    const left: Pt[] = [], right: Pt[] = [];
    // The directions in the piece's frame that point straight left and right on the screen.
    const sx = Math.hypot(this.v.ux, this.v.vx);
    const dirx = this.v.ux / (sx || 1), diry = this.v.vx / (sx || 1);
    for (const [z, r] of prof) {
      left.push(this.P(cx - dirx * r, cy - diry * r, z));
      right.push(this.P(cx + dirx * r, cy + diry * r, z));
    }
    g.strokeStyle = rgb(ink);
    g.lineWidth = this.ink;
    g.lineJoin = 'round';
    g.beginPath();
    left.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    g.beginPath();
    right.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    // The near half of the foot.
    const [z0, r0] = prof[0];
    if (r0 > 0.05) {
      const an = this.nearAngle();
      g.beginPath();
      for (let j = 0; j <= 20; j++) {
        const a = an - Math.PI / 2 + (j / 20) * Math.PI;
        const [x, y] = this.P(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, z0);
        if (j) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
    }
  }

  /**
   * A round rod from `a` to `b`, `r` thick: a leg, a rung, a pole, a peg. A
   * line of the rod's colour over a wider one of its ink, and a thin light
   * one down its lit side.
   */
  rod(a: V3, b: V3, r: number, p: Paint): void {
    // Upright, its ends are its ends; lying down, it is as thick as it is wide.
    const flat = Math.abs(a[2] - b[2]) < Math.hypot(a[0] - b[0], a[1] - b[1]) ? r : 0;
    this.part(Math.min(a[0], b[0]) - r, Math.max(a[0], b[0]) + r, Math.min(a[1], b[1]) - r, Math.max(a[1], b[1]) + r, Math.min(a[2], b[2]) - flat, Math.max(a[2], b[2]) + flat, () => this.drawRod(a, b, r, p));
  }

  drawRod(a: V3, b: V3, r: number, p: Paint): void {
    const g = this.g;
    const A = this.P(a[0], a[1], a[2]), B = this.P(b[0], b[1], b[2]);
    const w = Math.max(0.9, r * 2 * 1.34);
    g.lineCap = 'round';
    this.line(A, B, rgb(p.ink), w + this.ink * 2);
    this.line(A, B, rgb(p.body, 0.92), w);
    if (w > 1.6) {
      const dx = B[0] - A[0], dy = B[1] - A[1], l = Math.hypot(dx, dy) || 1;
      const ox = (-dy / l) * w * 0.22, oy = (dx / l) * w * 0.22;
      const s = ox > 0 ? -1 : 1;
      this.line([A[0] + ox * s, A[1] + oy * s], [B[0] + ox * s, B[1] + oy * s], rgb(p.body, 1.1), Math.max(0.6, w * 0.3));
    }
    g.lineCap = 'butt';
  }

  /**
   * A flat panel on any slant, lit by which way it faces and inked round.
   * `under`, as for a box, is the height it is sorted as reaching: the gable
   * end under a roof goes down before the roof whichever side it is seen from.
   */
  panel(pts: V3[], p: Paint, deco?: PanelDeco, under?: number): void {
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]), zs = pts.map((q) => q[2]);
    this.part(Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), Math.min(...zs), under ?? Math.max(...zs), () => this.drawPanel(pts, p, deco));
  }

  drawPanel(pts: V3[], p: Paint, deco?: PanelDeco): void {
    const [a, b, c] = pts;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    // Whichever side of it you are looking at is the side that is lit.
    if (nz < 0 || (Math.abs(nz) < 1e-6 && nx * this.v.uy + ny * this.v.vy < 0)) { nx = -nx; ny = -ny; nz = -nz; }
    const S = pts.map((q) => this.P(q[0], q[1], q[2]));
    const k = this.light(nx, ny, nz);
    this.fillInk(S, rgb(p.body, k), p.ink);
    if (deco) {
      this.g.save();
      this.poly(S);
      this.g.clip();
      // Bilinear across the first four corners.
      const [q0, q1, q2, q3] = [pts[0], pts[1], pts[2], pts[3] ?? pts[2]];
      deco((u, v) => {
        const x = (q0[0] * (1 - u) + q1[0] * u) * (1 - v) + (q3[0] * (1 - u) + q2[0] * u) * v;
        const y = (q0[1] * (1 - u) + q1[1] * u) * (1 - v) + (q3[1] * (1 - u) + q2[1] * u) * v;
        const z = (q0[2] * (1 - u) + q1[2] * u) * (1 - v) + (q3[2] * (1 - u) + q2[2] * u) * v;
        return this.P(x, y, z);
      }, k);
      this.g.restore();
      this.poly(S);
      this.g.strokeStyle = rgb(p.ink);
      this.g.lineWidth = this.ink;
      this.g.stroke();
    }
  }

  /** Anything drawn flat at a point of the piece -- a flame, a leaf, a bee -- sorted as a small box round it. */
  sprite(at: V3, r: number, draw: (x: number, y: number) => void, tall = r): void {
    this.part(at[0] - r, at[0] + r, at[1] - r, at[1] + r, at[2], at[2] + tall, () => {
      const [x, y] = this.P(at[0], at[1], at[2]);
      draw(x, y);
    });
  }

  /**
   * Fire standing on a bed of coals at `at`: `w` units across and `h` tall,
   * three heats of flame over one another and the light it throws round
   * itself. `k` is which of four flickers it is at.
   */
  fire(at: V3, w: number, h: number, k: number): void {
    this.sprite(at, w / 2, (x, y) => {
      const g = this.g;
      const W = w * Math.hypot(this.v.ux, this.v.vx) * 0.5, H = h * HEIGHT_SCALE;
      const glow = g.createRadialGradient(x, y - H * 0.3, 0, x, y - H * 0.3, W * 2.4);
      glow.addColorStop(0, 'rgba(255, 196, 120, 0.42)');
      glow.addColorStop(1, 'rgba(255, 196, 120, 0)');
      g.fillStyle = glow;
      g.beginPath(); g.arc(x, y - H * 0.3, W * 2.4, 0, TAU); g.fill();
      // Each tongue rises and falls on its own beat, so the four flickers are four different fires rather than one breathing.
      const lick = (i: number): number => 0.8 + 0.2 * Math.sin(k * 1.9 + i * 2.3);
      const tongue = (dx: number, hw: number, hh: number, lean: number, fill: string): void => {
        const bx = x + dx * W;
        g.fillStyle = fill;
        g.beginPath();
        g.moveTo(bx - hw * W, y);
        g.bezierCurveTo(bx - hw * W, y - hh * H * 0.55, bx + (lean - hw * 0.35) * W, y - hh * H * 0.72, bx + lean * W, y - hh * H);
        g.bezierCurveTo(bx + (lean + hw * 0.3) * W, y - hh * H * 0.62, bx + hw * W, y - hh * H * 0.45, bx + hw * W, y);
        g.closePath();
        g.fill();
      };
      tongue(-0.42, 0.42, 0.72 * lick(0), -0.22, '#ee7f3a');
      tongue(0.4, 0.42, 0.8 * lick(1), 0.16, '#ee7f3a');
      tongue(0, 0.62, lick(2), (k % 2 ? 0.08 : -0.06), '#f6a44a');
      tongue(-0.06, 0.38, 0.62 * lick(3), 0.06, '#ffd27e');
      tongue(0.02, 0.2, 0.34 * lick(4), 0, '#fff2cc');
    }, h);
  }

  /**
   * A spoked wheel standing on edge, its axle along the piece's x (`axis`
   * 'x') or its y: the iron tyre round the tread, the felloe and the spokes
   * on whichever face is toward you, and the hub, `thick` across.
   */
  wheel(c: V3, axis: 'x' | 'y', r: number, thick: number, spokes: number, p: Paint): void {
    const [cx, cy, cz] = c;
    const ax = axis === 'x' ? thick / 2 : r, ay = axis === 'y' ? thick / 2 : r;
    this.part(cx - ax, cx + ax, cy - ay, cy + ay, cz - r, cz + r, () => this.drawWheel(c, axis, r, thick, spokes, p));
  }

  drawWheel(c: V3, axis: 'x' | 'y', r: number, thick: number, spokes: number, p: Paint): void {
    const g = this.g;
    const [cx, cy, cz] = c;
    const n: [number, number] = axis === 'x' ? [1, 0] : [0, 1];
    const u: [number, number] = axis === 'x' ? [0, 1] : [1, 0];
    const side = this.faces(n[0], n[1], 0) ? 1 : -1;
    const at = (a: number, rr: number, off: number): Pt =>
      this.P(cx + u[0] * Math.cos(a) * rr + n[0] * off, cy + u[1] * Math.cos(a) * rr + n[1] * off, cz + Math.sin(a) * rr);
    const N = 28, near = (side * thick) / 2, far = -near, rin = r * 0.8;
    const ring = (rr: number, off: number): Pt[] => Array.from({ length: N }, (_, j) => at((j / N) * TAU, rr, off));
    const tread = { body: IRON.body, ink: IRON.ink };
    // The back of the rim, seen through the spokes.
    const back = ring(r, far), backIn = ring(rin, far);
    g.beginPath();
    back.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    backIn.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fillStyle = rgb(p.body, 0.62);
    g.fill('evenodd');
    // The inside of the felloe, where it faces up at you through the hole.
    for (let j = 0; j < N; j++) {
      const a0 = (j / N) * TAU, a1 = ((j + 1) / N) * TAU, am = (a0 + a1) / 2;
      const nx = -u[0] * Math.cos(am), ny = -u[1] * Math.cos(am), nz = -Math.sin(am);
      if (!this.faces(nx, ny, nz)) continue;
      this.poly([at(a0, rin, far), at(a1, rin, far), at(a1, rin, near), at(a0, rin, near)]);
      g.fillStyle = rgb(p.body, this.light(nx, ny, nz) * 0.8);
      g.fill();
    }
    // Spokes from the hub to the felloe, in the middle of the wheel's thickness.
    g.lineCap = 'round';
    for (let j = 0; j < spokes; j++) {
      const a = (j / spokes) * TAU + 0.3;
      const A = at(a, r * 0.16, 0), B = at(a, rin, 0);
      this.line(A, B, rgb(p.ink), Math.max(0.7, r * 0.11) + this.ink * 1.4);
      this.line(A, B, rgb(p.body, 0.92), Math.max(0.7, r * 0.11));
    }
    g.lineCap = 'butt';
    // The tread, where it is toward you.
    for (let j = 0; j < N; j++) {
      const a0 = (j / N) * TAU, a1 = ((j + 1) / N) * TAU, am = (a0 + a1) / 2;
      const nx = u[0] * Math.cos(am), ny = u[1] * Math.cos(am), nz = Math.sin(am);
      if (!this.faces(nx, ny, nz + 0.03)) continue;
      const q = [at(a0, r, far), at(a1, r, far), at(a1, r, near), at(a0, r, near)];
      this.poly(q);
      g.fillStyle = rgb(tread.body, this.light(nx, ny, nz));
      g.fill();
      g.strokeStyle = rgb(tread.body, this.light(nx, ny, nz));
      g.lineWidth = 0.5;
      g.stroke();
    }
    // The face of the rim, with the tyre's edge round it, and the hub.
    const front = ring(r, near), frontIn = ring(rin, near), tyre = ring(r * 0.93, near);
    const k = this.light(n[0] * side, n[1] * side, 0);
    g.beginPath();
    front.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    frontIn.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fillStyle = rgb(p.body, k);
    g.fill('evenodd');
    g.beginPath();
    front.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    tyre.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fillStyle = rgb(tread.body, k * 1.05);
    g.fill('evenodd');
    g.strokeStyle = rgb(p.ink);
    g.lineWidth = this.ink;
    g.stroke();
    this.poly(frontIn);
    g.stroke();
    const hub = ring(r * 0.2, near + side * 0.25);
    this.fillInk(hub, rgb(p.body, k * 1.02), p.ink);
    this.fillInk(ring(r * 0.08, near + side * 0.3), rgb(tread.body, 1.1), tread.ink);
  }

  /**
   * Lay the parts, back to front.
   *
   * Two parts whose boxes overlap on the screen are put in order by a plane
   * that parts them: the one on the far side of it, from where you are
   * looking, goes down first -- or, parted top and bottom, the lower one,
   * since you are always looking down. Parts with nothing between them are
   * laid by how near their middles are. It is the order a painter would lay
   * a table in -- the far legs, the near legs, then the top over the lot --
   * worked out from the viewpoint rather than written down for one of them.
   */
  flush(): void {
    const ps = this.parts;
    const n = ps.length;
    const v = this.v;
    const rects = ps.map((p) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const x of [p.x0, p.x1]) for (const y of [p.y0, p.y1]) for (const z of [p.z0, p.z1]) {
        const [sx, sy] = this.P(x, y, z);
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      return [x0, y0, x1, y1];
    });
    const depth = ps.map((p) => ((p.x0 + p.x1) / 2) * v.uy + ((p.y0 + p.y1) / 2) * v.vy + ((p.z0 + p.z1) / 2) * 0.01);
    const E = 1e-6;
    /** -1 when a goes before b, 1 when after, 0 when nothing says. */
    const before = (a: Part, b: Part): number => {
      if (v.uy > E) { if (a.x1 <= b.x0 + E) return -1; if (b.x1 <= a.x0 + E) return 1; }
      else if (v.uy < -E) { if (a.x0 >= b.x1 - E) return -1; if (b.x0 >= a.x1 - E) return 1; }
      if (v.vy > E) { if (a.y1 <= b.y0 + E) return -1; if (b.y1 <= a.y0 + E) return 1; }
      else if (v.vy < -E) { if (a.y0 >= b.y1 - E) return -1; if (b.y0 >= a.y1 - E) return 1; }
      if (a.z1 <= b.z0 + E) return -1;
      if (b.z1 <= a.z0 + E) return 1;
      return 0;
    };
    const after: number[][] = ps.map(() => []);
    const need = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = rects[i], b = rects[j];
        if (a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]) continue;
        const o = before(ps[i], ps[j]);
        if (o < 0) { after[i].push(j); need[j]++; }
        else if (o > 0) { after[j].push(i); need[i]++; }
      }
    }
    const done = new Array(n).fill(false);
    for (let k = 0; k < n; k++) {
      // The nearest-to-the-back of what is free to go; failing that, of everything left, which breaks a cycle.
      let pick = -1;
      for (let i = 0; i < n; i++) if (!done[i] && need[i] === 0 && (pick < 0 || depth[i] < depth[pick])) pick = i;
      if (pick < 0) for (let i = 0; i < n; i++) if (!done[i] && (pick < 0 || depth[i] < depth[pick])) pick = i;
      done[pick] = true;
      for (const j of after[pick]) need[j]--;
      ps[pick].draw();
    }
    this.parts.length = 0;
  }
}

/* ---- decoration on a face --------------------------------------------------- */

/** Lines of grain along a face, `n` of them, running across it (`along` true) or up it. */
const grain = (sc: Scene, p: Paint, n: number, along = true, a = 0.22) => (F: FaceAt, w: number, h: number): void => {
  const g = sc.g;
  g.strokeStyle = rgb(p.ink, 1, a);
  g.lineWidth = sc.ink * 0.6;
  for (let i = 1; i <= n; i++) {
    const k = i / (n + 1);
    g.beginPath();
    if (along) {
      const t = h * (k + Math.sin(i * 7.3) * 0.04);
      const A = F(0, t), B = F(w * 0.5, t + Math.sin(i * 3.1) * 0.15), C = F(w, t);
      g.moveTo(A[0], A[1]);
      g.quadraticCurveTo(B[0], B[1], C[0], C[1]);
    } else {
      const s = w * (k + Math.sin(i * 5.7) * 0.04);
      const A = F(s, 0), C = F(s, h);
      g.moveTo(A[0], A[1]);
      g.lineTo(C[0], C[1]);
    }
    g.stroke();
  }
};

/** Joints between boards across a face: `n` boards, the joints running up it (`vertical`) or along it. */
const boardsOn = (sc: Scene, p: Paint, n: number, vertical = true) => (F: FaceAt, w: number, h: number): void => {
  const g = sc.g;
  g.strokeStyle = rgb(p.ink, 1, 0.55);
  g.lineWidth = sc.ink * 0.7;
  for (let i = 1; i < n; i++) {
    const k = i / n;
    const [A, B] = vertical ? [F(w * k, 0), F(w * k, h)] : [F(0, h * k), F(w, h * k)];
    g.beginPath();
    g.moveTo(A[0], A[1]);
    g.lineTo(B[0], B[1]);
    g.stroke();
  }
};

/** A rectangle on a face, from (s0, t0) to (s1, t1), filled and inked: a panel, a drawer front, a plate. */
const rectOn = (sc: Scene, F: FaceAt, s0: number, t0: number, s1: number, t1: number, fill: string, ink: RGB, inkA = 1): void => {
  sc.fillInk([F(s0, t0), F(s1, t0), F(s1, t1), F(s0, t1)], fill, ink, inkA);
};

/** A round knob or nail head on a face. */
const knob = (sc: Scene, F: FaceAt, s: number, t: number, r: number, p: Paint): void => {
  const g = sc.g;
  const [x, y] = F(s, t);
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fillStyle = rgb(p.body);
  g.fill();
  g.strokeStyle = rgb(p.ink);
  g.lineWidth = sc.ink * 0.7;
  g.stroke();
  g.beginPath();
  g.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, TAU);
  g.fillStyle = rgb(p.body, 1.25);
  g.fill();
};


/**
 * Doors across a face, `n` of them side by side, each with `panels` raised
 * panels up it and a knob by the meeting stile.
 */
function doors(sc: Scene, wood: Paint, F: FaceAt, w: number, h: number, n: number, panels = 1): void {
  const dw = w / n;
  for (let i = 0; i < n; i++) {
    const s0 = i * dw;
    rectOn(sc, F, s0 + 0.4, 0.4, s0 + dw - 0.25, h - 0.4, rgb(wood.body, 0.95), wood.ink);
    const ph = (h - 1.2 - (panels - 1) * 0.8) / panels;
    for (let k = 0; k < panels; k++) {
      const t0 = 1 + k * (ph + 0.8);
      rectOn(sc, F, s0 + 1.3, t0, s0 + dw - 1.15, t0 + ph - 0.2, rgb(wood.body, 1.02), wood.ink, 0.8);
      // The bevel round the raised field: lit along its top, shaded along its bottom.
      const g = sc.g;
      g.lineWidth = sc.ink * 0.8;
      const [a, b] = [F(s0 + 1.6, t0 + ph - 0.5), F(s0 + dw - 1.45, t0 + ph - 0.5)];
      g.strokeStyle = rgb(wood.body, 1.18);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    }
    knob(sc, F, i === 0 ? s0 + dw - 1 : s0 + 0.9, h * 0.5, 0.4, BRASS);
  }
}

/**
 * A cask standing on end: staves swelling to the middle, hooped in iron near
 * each end and at the quarters, a head with the bung in it, and a spigot
 * low on the front. `k` scales the lot; `wide` swells it more for a vat.
 */
function cask(sc: Scene, wood: Paint, k: number, wide = 1): void {
  const r0 = 3 * k * wide, rm = 3.6 * k * wide, H = 9.8 * k;
  sc.lathe(0, 0, [[0, r0], [H * 0.15, r0 + (rm - r0) * 0.55], [H * 0.5, rm], [H * 0.85, r0 + (rm - r0) * 0.55], [H, r0]], wood, 20, {
    staves: Math.round(14 * Math.max(1, wide)),
    bands: [[H * 0.1, IRON, 0.5 * k], [H * 0.24, IRON, 0.5 * k], [H * 0.76, IRON, 0.5 * k], [H * 0.9, IRON, 0.5 * k]],
    cap: paintOf(mix(wood.body, [70, 50, 40], 0.18)),
    lid: (F) => {
      const g = sc.g;
      g.strokeStyle = rgb(wood.ink, 1, 0.4);
      g.lineWidth = sc.ink * 0.6;
      for (const off of [-0.34, 0.34]) {
        const [a, b] = [F(Math.PI / 2 + Math.asin(off) + Math.PI, r0 * 0.94), F(Math.PI / 2 - Math.asin(off), r0 * 0.94)];
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      }
      const [bx, by] = F(0.6, r0 * 0.45);
      g.fillStyle = rgb(wood.ink, 1, 0.8);
      g.beginPath(); g.ellipse(bx, by, 0.7 * k, 0.4 * k, 0, 0, TAU); g.fill();
    },
  });
  // The spigot, low on the front.
  sc.rod([0, rm * 0.92, H * 0.2], [0, rm + 1.4 * k, H * 0.2], 0.28 * k, paintOf(hex('#9c7a52')));
  sc.rod([0, rm + 1.2 * k, H * 0.2], [0, rm + 1.2 * k, H * 0.2 - 0.9 * k], 0.22 * k, paintOf(hex('#9c7a52')));
}

/**
 * Courses of brick or stone up a face, `course` units a course, the upright
 * joints broken over the course below.
 */
const bricks = (sc: Scene, p: Paint, course = 1.1) => (F: FaceAt, w: number, h: number): void => {
  const g = sc.g;
  g.strokeStyle = rgb(p.ink, 1, 0.42);
  g.lineWidth = sc.ink * 0.6;
  g.beginPath();
  const rows = Math.max(1, Math.round(h / course));
  const ch = h / rows;
  for (let i = 1; i < rows; i++) {
    const [a, b] = [F(0, i * ch), F(w, i * ch)];
    g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]);
  }
  const len = course * 2.2;
  for (let i = 0; i < rows; i++) {
    for (let s = (i % 2) * len * 0.5 + len; s < w - 0.2; s += len) {
      const [a, b] = [F(s, i * ch), F(s, (i + 1) * ch)];
      g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]);
    }
  }
  g.stroke();
};

/** Rows of shingles down a roof panel, from its ridge edge (`v` 1) to its eave (`v` 0), the butts staggered. */
const shingles = (sc: Scene, p: Paint, rows: number) => (F: (u: number, v: number) => Pt): void => {
  const g = sc.g;
  g.strokeStyle = rgb(p.ink, 1, 0.5);
  g.lineWidth = sc.ink * 0.6;
  g.beginPath();
  for (let i = 1; i < rows; i++) {
    const [a, b] = [F(0, i / rows), F(1, i / rows)];
    g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]);
  }
  const across = 8;
  for (let i = 0; i < rows; i++) {
    for (let j = 1; j < across; j++) {
      const u = (j + (i % 2) * 0.5) / across;
      if (u >= 1) continue;
      const [a, b] = [F(u, i / rows), F(u, (i + 1) / rows)];
      g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]);
    }
  }
  g.stroke();
};

/** Stripes of a second colour across a panel of cloth, `n` bands in all, every other one `b`, in the panel's own light. */
const stripes = (sc: Scene, b: Paint, n: number) => (F: (u: number, v: number) => Pt, k: number): void => {
  for (let i = 1; i < n; i += 2) sc.fillInk([F(i / n, 0), F((i + 1) / n, 0), F((i + 1) / n, 1), F(i / n, 1)], rgb(b.body, k), b.ink, 0.25);
};

/**
 * A pitched roof, its ridge running along x (`along` 'x') or y, from `z0`
 * at the eaves to `z1` at the ridge, over the box x0..x1, y0..y1: the two
 * slopes, and a gable end under each end of the ridge, set in by `inset`.
 * The ends go down before the slopes from wherever the roof is seen, since
 * the slopes are over them.
 */
function gable(sc: Scene, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, p: Paint, along: 'x' | 'y', ends?: Paint, inset = 0.6, rows = 4): void {
  const deco = shingles(sc, p, rows);
  if (along === 'x') {
    const ym = (y0 + y1) / 2;
    sc.panel([[x0, y0, z0], [x1, y0, z0], [x1, ym, z1], [x0, ym, z1]], p, deco);
    sc.panel([[x0, y1, z0], [x1, y1, z0], [x1, ym, z1], [x0, ym, z1]], p, deco);
    if (ends) for (const x of [x0 + inset, x1 - inset]) sc.panel([[x, y0 + inset, z0], [x, y1 - inset, z0], [x, ym, z1 - inset * 0.6]], ends, undefined, z0);
  } else {
    const xm = (x0 + x1) / 2;
    sc.panel([[x0, y0, z0], [x0, y1, z0], [xm, y1, z1], [xm, y0, z1]], p, deco);
    sc.panel([[x1, y0, z0], [x1, y1, z0], [xm, y1, z1], [xm, y0, z1]], p, deco);
    if (ends) for (const y of [y0 + inset, y1 - inset]) sc.panel([[x0 + inset, y, z0], [x1 - inset, y, z0], [xm, y, z1 - inset * 0.6]], ends, undefined, z0);
  }
}

/** A plank crate, as one stands on the ground: boarded, battened at the corners and across the lid. */
function crate(sc: Scene, P: Paint, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
  const side = (F: FaceAt, w: number, h: number): void => {
    boardsOn(sc, P, 3, false)(F, w, h);
    rectOn(sc, F, 0, 0, 0.8, h, rgb(P.body, 0.9), P.ink);
    rectOn(sc, F, w - 0.8, 0, w, h, rgb(P.body, 0.9), P.ink);
  };
  sc.box(x0, x1, y0, y1, z0, z1, P, {
    front: side, back: side, left: side, right: side,
    top: (F, w, h) => {
      boardsOn(sc, P, 4)(F, w, h);
      for (const t of [0.8, h - 1.6]) rectOn(sc, F, 0, t, w, t + 0.8, rgb(P.body, 0.94), P.ink);
    },
  });
}

/** A flower bed's worth of planting, drawn flat at a point: leaves in two greens, and what is in flower over them. */
function plant(g: CanvasRenderingContext2D, x: number, y: number, kind: number, s: number): void {
  const LEAF = ['#5f9a58', '#7cb86a', '#4f8a5a'];
  const BLOOM = ['#a98fd6', '#f0a24a', '#f2d65e', '#e98a9a', '#f4f1e6'][kind % 5];
  const spiky = kind % 5 === 0;
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + (i - 4) * 0.33;
    const r = (spiky ? 4.4 : 3.2) * s * (0.7 + ((i * 37) % 10) / 30);
    g.fillStyle = LEAF[i % 3];
    g.beginPath();
    g.ellipse(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, spiky ? 0.5 * s : 1.3 * s, r * 0.55, a + Math.PI / 2, 0, TAU);
    g.fill();
  }
  for (let i = 0; i < 5; i++) {
    const bx = x + ((i * 53) % 7 - 3) * 0.75 * s, by = y - (spiky ? 3.6 : 2.4) * s - ((i * 29) % 5) * 0.4 * s;
    g.fillStyle = BLOOM;
    g.beginPath();
    if (spiky) g.ellipse(bx, by, 0.45 * s, 1.3 * s, 0, 0, TAU);
    else g.arc(bx, by, 0.95 * s, 0, TAU);
    g.fill();
    if (!spiky) {
      g.fillStyle = 'rgba(120, 80, 40, 0.55)';
      g.beginPath(); g.arc(bx, by, 0.35 * s, 0, TAU); g.fill();
    }
  }
}

/** Where a circle of radius `r` on a face falls, as a polygon: a log end, a knot, a sun. */
const circleOn = (F: FaceAt, s: number, t: number, r: number, n = 12): Pt[] =>
  Array.from({ length: n }, (_, i) => F(s + Math.cos((i / n) * TAU) * r, t + Math.sin((i / n) * TAU) * r));

const ROPE = paintOf(hex('#c9ae7c'));
const SHINGLE = (wood: Paint): Paint => paintOf(mix(wood.body, [120, 104, 98], 0.3));

/**
 * A cloth hanging in folds: `top` and `bottom` are points along its upper
 * and lower edges, a fold between each pair. Each fold is lit by the way it
 * turns and the whole is inked round once, as the one piece of cloth it is,
 * with only a crease between the folds. `deco` is given each fold's own
 * coordinates, 0 to 1 across it and down it.
 */
function cloth(sc: Scene, top: V3[], bottom: V3[], p: Paint, deco?: PanelDeco): void {
  const all = [...top, ...bottom];
  const lo = (i: number): number => Math.min(...all.map((q) => q[i])), hi = (i: number): number => Math.max(...all.map((q) => q[i]));
  sc.part(lo(0), hi(0), lo(1), hi(1), lo(2), hi(2), () => {
    const g = sc.g;
    const S = (v: V3): Pt => sc.P(v[0], v[1], v[2]);
    const folds = top.slice(0, -1).map((_, i) => {
      const q: V3[] = [top[i], top[i + 1], bottom[i + 1], bottom[i]];
      const e1 = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]], e2 = [q[3][0] - q[0][0], q[3][1] - q[0][1], q[3][2] - q[0][2]];
      let n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (!sc.faces(n[0], n[1], n[2])) n = [-n[0], -n[1], -n[2]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      return { q, k: sc.light(n[0] / l, n[1] / l, n[2] / l), d: sc.depth((q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2) };
    });
    folds.sort((a, b) => a.d - b.d);
    for (const { q, k } of folds) {
      const P = q.map(S);
      sc.poly(P);
      g.fillStyle = rgb(p.body, k);
      g.fill();
      g.strokeStyle = rgb(p.body, k);
      g.lineWidth = 0.5;
      g.stroke();
      if (deco) {
        g.save();
        sc.poly(P);
        g.clip();
        deco((u, v) => {
          const a = [q[0][0] + (q[1][0] - q[0][0]) * u, q[0][1] + (q[1][1] - q[0][1]) * u, q[0][2] + (q[1][2] - q[0][2]) * u];
          const b = [q[3][0] + (q[2][0] - q[3][0]) * u, q[3][1] + (q[2][1] - q[3][1]) * u, q[3][2] + (q[2][2] - q[3][2]) * u];
          return sc.P(a[0] + (b[0] - a[0]) * v, a[1] + (b[1] - a[1]) * v, a[2] + (b[2] - a[2]) * v);
        }, k);
        g.restore();
      }
    }
    for (let i = 1; i < top.length - 1; i++) sc.line(S(top[i]), S(bottom[i]), rgb(p.ink, 1, 0.25), sc.ink * 0.6);
    sc.poly([...top.map(S), ...bottom.map(S).reverse()]);
    g.strokeStyle = rgb(p.ink);
    g.lineWidth = sc.ink;
    g.lineJoin = 'round';
    g.stroke();
  });
}

/** A hull's sheer, `S` high amidships: rising to both ends, and most to the bow, `t` running from stern to stem. */
const sheerOf = (S: number) => (t: number): number => S + 0.9 * (2 * t - 1) ** 2 + 1.2 * t ** 8;

/**
 * A clinker hull from the waterline up -- all of one that shows -- with the
 * stern at `xs`, a transom across it, the stem at `xb`, `B` across at her
 * widest and her sheer `S` high amidships.
 *
 * It is one part, drawn in the order a hull is seen in: the inside of her
 * far side, her floor, whatever `inside` puts in her, her near side over the
 * lot, planked and wet along the waterline, and then whatever `above` stands
 * up out of her, which says how far out and how high it reaches. From dead
 * astern the near side is the transom and both sides are the far side, which
 * the same rule settles face by face.
 */
function hull(sc: Scene, wood: Paint, xs: number, xb: number, B: number, S: number,
  inside: (seat: (x: number, z: number, w: number) => void, deck: (from: number) => void) => void,
  above?: { draw: () => void; reach: number; top: number }): void {
  const N = 14;
  const breadth = (t: number): number => (t < 0.45 ? 0.7 + 0.3 * Math.sin((t / 0.45) * (Math.PI / 2)) : Math.cos(((t - 0.45) / 0.55) * (Math.PI / 2)) ** 0.85);
  const sheer = sheerOf(S);
  const st = Array.from({ length: N + 1 }, (_, i) => {
    const t = i / N, x = xs + (xb - xs) * t;
    // The stem rakes: the waterline ends a little short of where the sheer does.
    return { t, x, xw: x - 0.9 * t ** 6, b: B * breadth(t), w: B * breadth(t) * 0.8, s: sheer(t) };
  });
  const at = (x: number): (typeof st)[number] => st[Math.max(0, Math.min(N, Math.round(((x - xs) / (xb - xs)) * N)))];
  // What stands up out of her -- a mast, a sail swung out over the side -- is hers to draw, so her box takes it in.
  const reach = Math.max(B, above?.reach ?? 0);
  sc.part(xs, xb, -reach, reach, 0, Math.max(above?.top ?? 0, ...st.map((q) => q.s)), () => {
    const g = sc.g;
    type Face = { q: V3[]; n: V3; d: number; end: boolean };
    const outer: Face[] = [], inner: Face[] = [];
    const add = (q: V3[], out: V3, end = false): void => {
      const d = sc.depth((q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2, (q[0][2] + q[2][2]) / 2);
      if (sc.faces(out[0], out[1], out[2])) outer.push({ q, n: out, d, end });
      else inner.push({ q, n: [-out[0], -out[1], -out[2]], d, end });
    };
    for (const sg of [-1, 1]) {
      for (let i = 0; i < N; i++) {
        const a = st[i], b = st[i + 1];
        const q: V3[] = [[a.xw, sg * a.w, 0], [b.xw, sg * b.w, 0], [b.x, sg * b.b, b.s], [a.x, sg * a.b, a.s]];
        const e1 = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]], e2 = [q[3][0] - q[0][0], q[3][1] - q[0][1], q[3][2] - q[0][2]];
        let n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        n = [n[0] / l, n[1] / l, n[2] / l];
        if (n[1] * sg < 0) n = [-n[0], -n[1], -n[2]];
        add(q, n);
      }
    }
    const s0 = st[0];
    add([[xs, -s0.w, 0], [xs, s0.w, 0], [xs, s0.b, s0.s], [xs, -s0.b, s0.s]], [-1, 0, 0], true);
    inner.sort((p, q) => p.d - q.d);
    outer.sort((p, q) => p.d - q.d);
    const S2 = (v: V3): Pt => sc.P(v[0], v[1], v[2]);
    const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const stem = (): void => sc.line(sc.P(st[N].xw, 0, 0), sc.P(xb, 0, st[N].s + 0.3), rgb(wood.ink), sc.ink * 1.6);
    const bowNear = sc.faces(1, 0, 0);
    if (!bowNear) stem();
    // A face filled and sealed at its seams with its own colour, so a side reads as one run of planking rather than a panel a station.
    const fill = (f: Face, k: number): Pt[] => {
      const P = f.q.map(S2);
      sc.poly(P);
      g.fillStyle = rgb(wood.body, k);
      g.fill();
      g.strokeStyle = rgb(wood.body, k);
      g.lineWidth = 0.5;
      g.stroke();
      return P;
    };
    // The far side from inside, darker, with its gunwale along the top.
    for (const f of inner) {
      const P = fill(f, sc.light(f.n[0], f.n[1], f.n[2]) * 0.8);
      sc.line(P[3], P[2], rgb(wood.ink), sc.ink * 2.2);
      sc.line(P[3], P[2], rgb(wood.body, 1.12), sc.ink * 1.1);
      if (f.end) for (const [a, b] of [[0, 3], [1, 2]]) sc.line(P[a], P[b], rgb(wood.ink, 1, 0.6), sc.ink * 0.8);
    }
    // Her floor, boarded fore and aft.
    const fl = 0.8, span = st.slice(1, N - 1);
    const floor: Pt[] = [...span.map((q) => sc.P(q.xw + 0.3, -q.w * 0.8, fl)), ...[...span].reverse().map((q) => sc.P(q.xw + 0.3, q.w * 0.8, fl))];
    sc.fillInk(floor, rgb(wood.body, 0.92), wood.ink, 0.6);
    g.save();
    sc.poly(floor);
    g.clip();
    g.strokeStyle = rgb(wood.ink, 1, 0.3);
    g.lineWidth = sc.ink * 0.6;
    for (const yy of [-0.5, 0.5]) { const a = sc.P(xs, yy * B * 0.5, fl), b = sc.P(xb, yy * B * 0.5, fl); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
    g.restore();
    inside(
      (x, z, w) => {
        const q = at(x), half = q.w + (q.b - q.w) * (z / q.s) - 0.25;
        sc.drawBox(x - w / 2, x + w / 2, -half, half, z - 0.4, z, wood, { top: grain(sc, wood, 1) });
      },
      (from) => {
        const fore = st.filter((q) => q.t >= from);
        const deck = [...fore.map((q) => sc.P(q.x, -q.b, q.s)), ...[...fore].reverse().map((q) => sc.P(q.x, q.b, q.s))];
        sc.fillInk(deck, rgb(wood.body, 1.02), wood.ink);
        g.save();
        sc.poly(deck);
        g.clip();
        g.strokeStyle = rgb(wood.ink, 1, 0.35);
        g.lineWidth = sc.ink * 0.6;
        for (const yy of [-0.6, -0.2, 0.2, 0.6]) { const a = sc.P(fore[0].x, yy * B, fore[0].s), b = sc.P(xb, yy * B * 0.2, st[N].s); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
        g.restore();
      },
    );
    // Her near side: the strakes lapped up it, dark where it is wet, and inked only along her waterline and her sheer.
    for (const f of outer) {
      const P = fill(f, sc.light(f.n[0], f.n[1], f.n[2]));
      g.strokeStyle = rgb(wood.ink, 1, 0.45);
      g.lineWidth = sc.ink * 0.6;
      g.beginPath();
      for (const k of f.end ? [0.33, 0.66] : [0.3, 0.55, 0.78]) {
        const [a, b] = f.end ? [S2(lerp(f.q[0], f.q[1], k)), S2(lerp(f.q[3], f.q[2], k))] : [S2(lerp(f.q[0], f.q[3], k)), S2(lerp(f.q[1], f.q[2], k))];
        g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]);
      }
      g.stroke();
      sc.poly([P[0], P[1], S2(lerp(f.q[1], f.q[2], 0.1)), S2(lerp(f.q[0], f.q[3], 0.1))]);
      g.fillStyle = 'rgba(40, 60, 70, 0.3)';
      g.fill();
    }
    for (const f of outer) {
      const P = f.q.map(S2);
      sc.line(P[0], P[1], rgb(wood.ink), sc.ink);
      sc.line(P[3], P[2], rgb(wood.ink), sc.ink * 2.2);
      sc.line(P[3], P[2], rgb(wood.body, 1.14), sc.ink * 1.1);
      if (f.end) for (const [a, b] of [[0, 3], [1, 2]]) sc.line(P[a], P[b], rgb(wood.ink), sc.ink);
    }
    if (bowNear) stem();
    above?.draw();
  });
}

/* ---- the pieces --------------------------------------------------------------- */

/** What a piece is drawn with, besides its frame: its wood, whether it is alight, its dye and its one number. */
interface Build {
  sc: Scene;
  wood: Paint;
  /** Half its footprint each way, in units. */
  hw: number;
  hd: number;
  lit: boolean;
  tint?: Tint;
  trim?: number;
  /** Which of four flickers a fire in it is at. */
  frame: number;
}

type Model = (b: Build) => void;

const MODELS: Record<string, Model> = {
  /*
   * Seats and tables. A stool is a round seat on three splayed legs; a chair
   * a ladder-back, its back legs running on up into the back; a bench a
   * plank on two trestle ends with a rail to lean on; a table a top on an
   * apron and four legs; a long table a board on two trestles and a
   * stretcher; and a writing desk a top over a pedestal of drawers, with the
   * ink and the paper still on it.
   */
  stool: ({ sc, wood }) => {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.5;
      sc.rod([Math.cos(a) * 2.2, Math.sin(a) * 2.2, 0], [Math.cos(a) * 1.4, Math.sin(a) * 1.4, 4.4], 0.32, wood);
    }
    sc.lathe(0, 0, [[4.4, 2.3], [4.9, 2.4]], wood, 20);
  },
  chair: ({ sc, wood }) => {
    const s = 2.1, seat = 4.3;
    for (const [x, y] of [[-s, s], [s, s]] as Pt[]) sc.box(x - 0.28, x + 0.28, y - 0.28, y + 0.28, 0, seat, wood);
    for (const x of [-s, s]) sc.box(x - 0.3, x + 0.3, -s - 0.3, -s + 0.3, 0, 9.4, wood);
    sc.box(-s + 0.3, s - 0.3, s - 0.2, s + 0.2, 1.4, 1.8, wood);
    sc.box(-s - 0.1, s + 0.1, -s - 0.1, s + 0.2, seat, seat + 0.55, wood, { top: grain(sc, wood, 3) });
    for (const z of [6.1, 7.4, 8.7]) sc.box(-s + 0.3, s - 0.3, -s - 0.18, -s + 0.18, z - 0.35, z + 0.35, wood);
  },
  bench: ({ sc, wood, hw }) => {
    const L = hw - 1.4, seat = 4.4;
    for (const x of [-L + 1.2, L - 1.2]) {
      sc.box(x - 0.35, x + 0.35, -1.9, 1.9, 0, seat, wood);
      sc.box(x - 0.35, x + 0.35, -2.4, -1.7, 0, 7.4, wood);
    }
    sc.box(-L + 1.6, L - 1.6, -0.3, 0.3, 1.1, 1.8, wood);
    sc.box(-L, L, -2.2, 2.2, seat, seat + 0.6, wood, { top: grain(sc, wood, 4), front: grain(sc, wood, 1) });
    sc.box(-L + 0.6, L - 0.6, -2.35, -1.75, 6.2, 7.3, wood, { front: grain(sc, wood, 2) });
  },
  table: ({ sc, wood, hw, hd }) => {
    const x = hw - 2.4, y = hd - 2.4, top = 6.8;
    for (const [lx, ly] of [[-x, -y], [x, -y], [x, y], [-x, y]] as Pt[]) sc.box(lx - 0.5, lx + 0.5, ly - 0.5, ly + 0.5, 0, top - 0.8, wood);
    sc.box(-x + 0.4, x - 0.4, -y, y, top - 1.9, top - 0.8, wood);
    sc.box(-x - 1.4, x + 1.4, -y - 1.4, y + 1.4, top - 0.8, top, wood, { top: boardsOn(sc, wood, 4, false) });
  },
  long_table: ({ sc, wood, hw, hd }) => {
    const L = hw - 1.2, D = hd - 2.4, top = 7.2;
    for (const x of [-L + 3.2, L - 3.2]) {
      sc.box(x - 0.6, x + 0.6, -D + 0.6, D - 0.6, 0, 0.9, wood);
      sc.box(x - 0.5, x + 0.5, -0.8, 0.8, 0.9, top - 1.5, wood);
      sc.box(x - 0.6, x + 0.6, -D + 1, D - 1, top - 1.5, top - 0.8, wood);
    }
    sc.box(-L + 3.7, L - 3.7, -0.4, 0.4, 2.2, 3.1, wood);
    sc.box(-L, L, -D, D, top - 0.8, top, wood, { top: boardsOn(sc, wood, 3, false), front: grain(sc, wood, 1) });
  },
  desk: ({ sc, wood, hw, hd }) => {
    const x = hw - 1.6, y = hd - 3.2, top = 7.4;
    // The pedestal of drawers at the left, legs at the right, and a panel across the back between them.
    sc.box(-x, -x + 6, -y, y - 0.4, 0, top - 0.7, wood, {
      front: (F, w, h) => {
        for (let i = 0; i < 3; i++) {
          const t0 = 0.5 + i * ((h - 0.8) / 3), t1 = t0 + (h - 0.8) / 3 - 0.35;
          rectOn(sc, F, 0.45, t0, w - 0.45, t1, rgb(wood.body, 0.9), wood.ink);
          knob(sc, F, w / 2, (t0 + t1) / 2, 0.55, BRASS);
        }
      },
    });
    for (const ly of [-y + 0.4, y - 0.8]) sc.box(x - 0.9, x - 0.1, ly - 0.4, ly + 0.4, 0, top - 0.7, wood);
    sc.box(-x + 6, x - 0.5, -y, -y + 0.5, top - 3.4, top - 0.7, wood);
    sc.box(-x - 0.4, x + 0.4, -y - 0.6, y + 0.4, top - 0.7, top, wood, { top: grain(sc, wood, 3) });
    // What is on it: a sheet of paper, a book, the inkwell and its quill.
    sc.panel([[-2, -1.6, top + 0.02], [1.6, -1.2, top + 0.02], [1.2, 1.4, top + 0.02], [-2.4, 1, top + 0.02]], LINEN, (F) => {
      const g = sc.g;
      g.strokeStyle = 'rgba(80, 70, 90, 0.45)';
      g.lineWidth = sc.ink * 0.5;
      for (let i = 1; i < 6; i++) {
        const [a, b] = [F(0.12, i / 6.5), F(0.8, i / 6.5)];
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      }
    });
    sc.box(x - 5.2, x - 1.6, -y + 0.2, -y + 2.8, top, top + 0.9, paintOf(hex('#7a4a3c')), { top: grain(sc, paintOf(hex('#7a4a3c')), 1) });
    sc.lathe(3.2, 1.2, [[top, 0.6], [top + 0.9, 0.6], [top + 1.1, 0.3]], paintOf(hex('#3d3f55')), 12);
    // The quill standing in it: a fine shaft, and the vane down one side of its upper two-thirds.
    sc.part(3.0, 4.8, 0, 1.4, top + 1.1, top + 3.6, () => {
      const g = sc.g;
      const A = sc.P(3.2, 1.2, top + 0.9), B = sc.P(4.5, 0.3, top + 3.5);
      const along = (t: number): Pt => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
      const dx = B[0] - A[0], dy = B[1] - A[1], l = Math.hypot(dx, dy) || 1;
      // The vane on whichever side of the shaft is up the screen.
      const up = dx / l > 0 ? -1 : 1;
      const nx = (-dy / l) * up, ny = (dx / l) * up;
      const [m, q, e] = [along(0.3), along(0.62), along(1)];
      g.beginPath();
      g.moveTo(m[0], m[1]);
      g.quadraticCurveTo(q[0] + nx * 1.1, q[1] + ny * 1.1, e[0], e[1]);
      g.closePath();
      g.fillStyle = rgb(LINEN.body, 0.97);
      g.fill();
      g.strokeStyle = rgb(LINEN.ink, 1, 0.8);
      g.lineWidth = sc.ink * 0.6;
      g.stroke();
      sc.line(A, B, rgb(hex('#a99a80')), sc.ink * 0.7);
    });
  },

  /*
   * Things that hold things. A chest is boarded, banded in iron over the lid
   * and down the front, with a lock plate and a ring at each end; a coffer is
   * a small one with a padlock. A cupboard and a wardrobe stand on a plinth
   * under a cornice, their doors panelled; a larder's doors are pierced tin
   * above, to keep the air moving through the food; shelves and a bookshelf
   * are open at the front and boarded at the back, with what is kept on them.
   */
  chest: ({ sc, wood }) => {
    const x = 7.2, y = 4.4, h = 4.4;
    const straps = (F: FaceAt, w: number, hh: number, across: boolean): void => {
      for (const k of [0.24, 0.76]) {
        const s0 = w * k - 0.45;
        if (across) rectOn(sc, F, s0, 0, s0 + 0.9, hh, rgb(IRON.body, 1.05), IRON.ink);
      }
    };
    sc.box(-x, x, -y, y, 0, h, wood, {
      front: (F, w, hh) => { boardsOn(sc, wood, 3, false)(F, w, hh); straps(F, w, hh, true); rectOn(sc, F, w / 2 - 0.9, hh - 2.2, w / 2 + 0.9, hh - 0.3, rgb(BRASS.body), BRASS.ink); knob(sc, F, w / 2, hh - 1.4, 0.28, SOOT); },
      back: (F, w, hh) => { boardsOn(sc, wood, 3, false)(F, w, hh); straps(F, w, hh, true); },
      left: (F, w, hh) => { boardsOn(sc, wood, 3, false)(F, w, hh); knob(sc, F, w / 2, hh * 0.62, 0.6, IRON); },
      right: (F, w, hh) => { boardsOn(sc, wood, 3, false)(F, w, hh); knob(sc, F, w / 2, hh * 0.62, 0.6, IRON); },
    });
    sc.box(-x - 0.3, x + 0.3, -y - 0.3, y + 0.3, h, h + 1.8, wood, {
      front: (F, w, hh) => straps(F, w, hh, true),
      back: (F, w, hh) => straps(F, w, hh, true),
      top: (F, w, hh) => { grain(sc, wood, 3)(F, w, hh); for (const k of [0.24, 0.76]) rectOn(sc, F, w * k - 0.45, 0, w * k + 0.45, hh, rgb(IRON.body, 1.1), IRON.ink); },
    });
  },
  coffer: ({ sc, wood }) => {
    const x = 3.5, y = 2.5, h = 2.6;
    const corners = (F: FaceAt, w: number, hh: number): void => {
      rectOn(sc, F, 0, 0, 0.7, hh, rgb(IRON.body), IRON.ink);
      rectOn(sc, F, w - 0.7, 0, w, hh, rgb(IRON.body), IRON.ink);
    };
    sc.box(-x, x, -y, y, 0, h, wood, { front: corners, back: corners, left: corners, right: corners });
    sc.box(-x - 0.2, x + 0.2, -y - 0.2, y + 0.2, h, h + 1.3, wood, {
      front: (F, w, hh) => { corners(F, w, hh); rectOn(sc, F, w / 2 - 0.5, -0.6, w / 2 + 0.5, hh * 0.7, rgb(IRON.body, 1.1), IRON.ink); },
      top: (F, w, hh) => { rectOn(sc, F, w / 2 - 0.4, 0, w / 2 + 0.4, hh, rgb(IRON.body, 1.1), IRON.ink); },
    });
    // The padlock, hung off the hasp.
    sc.box(-0.6, 0.6, y + 0.2, y + 0.7, h - 1.4, h - 0.2, BRASS, { front: (F, w, hh) => knob(sc, F, w / 2, hh * 0.45, 0.2, SOOT) });
  },
  cupboard: ({ sc, wood, hw, hd }) => {
    const x = hw - 1.6, y = hd - 1.6;
    sc.box(-x - 0.2, x + 0.2, -y - 0.2, y + 0.2, 0, 0.8, wood);
    sc.box(-x, x, -y, y, 0.8, 10.8, wood, { front: (F, w, h) => doors(sc, wood, F, w, h, 2) });
    sc.box(-x - 0.5, x + 0.5, -y - 0.5, y + 0.5, 10.8, 11.6, wood, { front: grain(sc, wood, 1) });
    sc.lathe(-x + 3, 0, [[11.6, 0.9], [12.6, 1.2], [13.9, 0.8], [14.3, 0.6]], paintOf(hex('#b9a77f')), 14, { cap: paintOf(hex('#8e7d5e')) });
    sc.lathe(x - 3.2, -0.5, [[11.6, 0.8], [12.2, 1.7]], paintOf(hex('#c9b8a0')), 14, { cap: paintOf(hex('#a89478')) });
  },
  wardrobe: ({ sc, wood, hw, hd }) => {
    const x = hw - 2, y = hd - 1.2;
    sc.box(-x - 0.2, x + 0.2, -y - 0.2, y + 0.2, 0, 0.8, wood);
    sc.box(-x, x, -y, y, 0.8, 14.1, wood, {
      front: (F, w, h) => {
        rectOn(sc, F, 0.5, 0.4, w - 0.5, 2.6, rgb(wood.body, 0.94), wood.ink);
        knob(sc, F, w * 0.3, 1.5, 0.4, BRASS);
        knob(sc, F, w * 0.7, 1.5, 0.4, BRASS);
        const G: FaceAt = (s2, t2) => F(s2, t2 + 3);
        doors(sc, wood, G, w, h - 3, 2, 2);
      },
    });
    sc.box(-x - 0.6, x + 0.6, -y - 0.6, y + 0.6, 14.1, 15.1, wood, { front: grain(sc, wood, 1) });
  },
  shelves: ({ sc, wood, hw, hd }) => {
    const x = hw - 1.5, y = hd - 2.5, H = 12.4;
    // Boarded at the back, open at the front.
    sc.box(-x, x, -y - 0.35, -y, 0, H, wood, { back: boardsOn(sc, wood, 9), front: boardsOn(sc, wood, 9) });
    for (const px of [-x, -x / 3, x / 3, x]) sc.box(px - 0.4, px + 0.4, -y, y, 0, H, wood);
    const levels = [0.4, 4.3, 8.2, 11.9];
    for (const z of levels) sc.box(-x, x, -y, y, z, z + 0.5, wood, { front: grain(sc, wood, 1) });
    // What is kept on them: crocks, a sack, jars and bottles.
    const JAR = [paintOf(hex('#c9a57c')), paintOf(hex('#9fb3bd')), paintOf(hex('#dcd2b4')), paintOf(hex('#b77f68'))];
    const at = (bx: number, z: number, kind: number, c: number): void => {
      const P = JAR[c % JAR.length];
      if (kind === 0) sc.lathe(bx, 0.3, [[z, 0.9], [z + 1.4, 1.2], [z + 2.2, 0.8], [z + 2.5, 0.6]], P, 12, { cap: paintOf(hex('#8e6f55')) });
      else if (kind === 1) sc.lathe(bx, 0.6, [[z, 0.55], [z + 1.8, 0.55], [z + 2.2, 0.25], [z + 2.9, 0.22]], paintOf(hex('#6f8f6a')), 10);
      else sc.box(bx - 1.3, bx + 1.3, -0.9, 1.7, z, z + 2.3, paintOf(hex('#cdb68b')), { front: (F, w, h) => { const g = sc.g; g.strokeStyle = rgb(hex('#8a7552'), 1, 0.6); g.lineWidth = sc.ink * 0.7; const [a, b] = [F(w * 0.2, h * 0.85), F(w * 0.8, h * 0.9)]; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); } });
    };
    [[-10.5, 0, 0], [-7.8, 1, 1], [-2.2, 0, 2], [1.4, 1, 3], [6.2, 2, 0], [10.4, 0, 3]].forEach(([bx, kind, c], i) => at(bx, levels[i % 3 === 0 ? 1 : i % 3 === 1 ? 2 : 3] + 0.5, kind, c));
    at(-5.5, levels[0] + 0.5, 2, 1);
    at(8.8, levels[0] + 0.5, 0, 2);
  },
  bookshelf: ({ sc, wood, hw, hd }) => {
    const x = hw - 1.8, y = hd - 2.4, H = 11;
    sc.box(-x, x, -y - 0.35, -y, 0.8, H, wood, { back: boardsOn(sc, wood, 6) });
    for (const px of [-x, x]) sc.box(px - 0.35, px + 0.35, -y, y, 0, H, wood);
    sc.box(-x, x, -y, y, 0, 0.8, wood);
    const shelves = [0.8, 4.2, 7.6];
    for (const z of shelves.slice(1)) sc.box(-x + 0.35, x - 0.35, -y, y, z - 0.4, z, wood, { front: grain(sc, wood, 1) });
    sc.box(-x - 0.5, x + 0.5, -y - 0.5, y + 0.5, H, H + 0.6, wood, { front: grain(sc, wood, 1) });
    // A row of books on each shelf, laid as one part so they go on far end first.
    const BOOK = ['#8c3f34', '#3f5c8c', '#6f7a3a', '#8c6a2f', '#5a3b6b', '#2f6b64', '#a55a3a', '#46506e'].map(hex);
    shelves.forEach((z, row) => {
      const books: Array<[number, number, number, number]> = [];
      let bx = -x + 0.6;
      let k = row * 5;
      while (bx < x - 1) {
        const w = 0.55 + ((k * 7) % 5) * 0.09, h = 2.3 + ((k * 3) % 4) * 0.25;
        if ((k * 11) % 13 === 5) { bx += 0.9; k++; continue; }
        books.push([bx, bx + w, h, k % BOOK.length]);
        bx += w + 0.04;
        k++;
      }
      sc.part(-x, x, -y, y - 0.6, z, z + 3.4, () => {
        const order = sc.v.uy >= 0 ? books : [...books].reverse();
        for (const [b0, b1, h, c] of order) {
          const P = paintOf(BOOK[c], 0.5);
          sc.drawBox(b0, b1, -y + 0.4, y - 0.6, z, z + h, P, {
            front: (F, w, hh) => { sc.g.strokeStyle = rgb(hex('#e8d9a8'), 1, 0.8); sc.g.lineWidth = sc.ink * 0.6; for (const t of [0.2, 0.8]) { const [a, bb] = [F(0, hh * t), F(w, hh * t)]; sc.g.beginPath(); sc.g.moveTo(a[0], a[1]); sc.g.lineTo(bb[0], bb[1]); sc.g.stroke(); } },
            top: (F, w, hh) => rectOn(sc, F, 0.08, 0.1, w - 0.08, hh, rgb(hex('#efe6cf')), hex('#b9ab8a'), 0.6),
          });
        }
      });
    });
  },
  larder: ({ sc, wood, hw, hd }) => {
    const x = hw - 2, y = hd - 0.6;
    sc.box(-x - 0.2, x + 0.2, -y - 0.2, y + 0.2, 0, 0.8, wood);
    sc.box(-x, x, -y, y, 0.8, 13.4, wood, {
      front: (F, w, h) => {
        const half = w / 2;
        for (const s0 of [0, half]) {
          rectOn(sc, F, s0 + 0.5, 0.5, s0 + half - 0.3, h - 0.5, rgb(wood.body, 0.93), wood.ink);
          // The tin, pierced, in the upper half of each door.
          rectOn(sc, F, s0 + 1.3, h * 0.52, s0 + half - 1.1, h - 1.3, rgb(hex('#c9cbd0')), hex('#7c7f88'));
          const g = sc.g;
          g.fillStyle = rgb(hex('#5d6068'), 1, 0.8);
          for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) {
            const [px, py] = F(s0 + 1.9 + i * ((half - 3.6) / 3), h * 0.55 + 0.4 + j * ((h * 0.45 - 2.4) / 4));
            g.beginPath(); g.arc(px, py, 0.32, 0, TAU); g.fill();
          }
          rectOn(sc, F, s0 + 1.3, 1.3, s0 + half - 1.1, h * 0.46, rgb(wood.body, 0.97), wood.ink, 0.7);
        }
        knob(sc, F, half - 1, h * 0.48, 0.4, BRASS);
        knob(sc, F, half + 0.8, h * 0.48, 0.4, BRASS);
      },
    });
    sc.box(-x - 0.6, x + 0.6, -y - 0.6, y + 0.6, 13.4, 14.2, wood);
    // A sack of flour and a cheese on top.
    sc.lathe(-x + 3.4, -1, [[14.2, 1.6], [15.4, 1.9], [16.8, 1.3], [17.4, 0.4]], paintOf(hex('#e3d8bd')), 12);
    sc.lathe(x - 3.2, 0.6, [[14.2, 1.7], [15.1, 1.7]], paintOf(hex('#e8c565')), 16, { cap: paintOf(hex('#f0d27a')) });
  },
  barrel: ({ sc, wood }) => cask(sc, wood, 1),
  small_barrel: ({ sc, wood }) => cask(sc, wood, 0.72),
  large_barrel: ({ sc, wood }) => cask(sc, wood, 1.72, 2.1),
  bulk_bin: ({ sc, wood, hw, hd }) => {
    const x = hw - 1, y = hd - 1, h = 8.6;
    const side: (F: FaceAt, w: number, hh: number) => void = (F, w, hh) => {
      boardsOn(sc, wood, 6)(F, w, hh);
      rectOn(sc, F, 0, 0, 0.8, hh, rgb(IRON.body), IRON.ink);
      rectOn(sc, F, w - 0.8, 0, w, hh, rgb(IRON.body), IRON.ink);
      rectOn(sc, F, 0, hh * 0.45, w, hh * 0.45 + 0.7, rgb(IRON.body, 1.05), IRON.ink);
    };
    sc.box(-x, x, -y, y, 0, h, wood, { front: side, back: side, left: side, right: side });
    sc.box(-x - 0.4, x + 0.4, -y - 0.4, y + 0.4, h, h + 1, wood, {
      top: (F, w, hh) => { boardsOn(sc, wood, 6)(F, w, hh); for (const k of [0.2, 0.8]) rectOn(sc, F, 0.2, hh * k - 0.6, w - 0.2, hh * k + 0.6, rgb(wood.body, 0.9), wood.ink); },
    });
    sc.box(-1, 1, y + 0.4, y + 0.8, h - 1.4, h + 0.6, IRON);
  },
  craft_bin: ({ sc, wood, hw, hd }) => {
    const x = hw - 1, y = hd - 1, h = 8.6, t = 0.7;
    const side = boardsOn(sc, wood, 6);
    // Open, with its lid off and the partitions showing, and what has been sorted into them.
    sc.box(-x, x, -y, y, 0, 0.6, SOOT);
    sc.box(-x, x, -y, -y + t, 0, h, wood, { front: side, back: side });
    sc.box(-x, x, y - t, y, 0, h, wood, { front: side, back: side });
    sc.box(-x, -x + t, -y + t, y - t, 0, h, wood, { left: side, right: side });
    sc.box(x - t, x, -y + t, y - t, 0, h, wood, { left: side, right: side });
    sc.box(-0.3, 0.3, -y + t, y - t, 0, h - 0.4, wood);
    sc.box(-x + t, -0.3, -0.3, 0.3, 0, h - 0.4, wood);
    sc.box(0.3, x - t, -0.3, 0.3, 0, h - 0.4, wood);
    const fill = h - 2.2;
    // Nails, ribbons of metal, planks, and lumps.
    sc.box(-x + t, -0.3, -y + t, -0.3, 0, fill, paintOf(hex('#8d8b93')), { top: (F, w, hh) => { const g = sc.g; g.strokeStyle = rgb(hex('#56545c'), 1, 0.8); g.lineWidth = sc.ink * 0.6; for (let i = 0; i < 18; i++) { const a = F((i * 0.37 % 1) * w, ((i * 0.61) % 1) * hh); const b = F((i * 0.37 % 1) * w + 0.6, ((i * 0.61) % 1) * hh + 0.3); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); } } });
    sc.box(0.3, x - t, -y + t, -0.3, 0, fill, paintOf(hex('#c9a064')), { top: boardsOn(sc, paintOf(hex('#c9a064')), 4) });
    sc.box(-x + t, -0.3, 0.3, y - t, 0, fill - 0.6, paintOf(hex('#b8866a')), { top: (F, w, hh) => { for (let i = 0; i < 5; i++) rectOn(sc, F, 0.4 + (i % 3) * (w / 3), 0.5 + Math.floor(i / 3) * (hh / 2), (i % 3) * (w / 3) + w / 3 - 0.4, Math.floor(i / 3) * (hh / 2) + hh / 2 - 0.4, rgb(hex('#9aa3ad'), 1.0 + (i % 2) * 0.1), hex('#5d6470')); } });
    sc.box(0.3, x - t, 0.3, y - t, 0, fill - 0.3, paintOf(hex('#b24f3e')), { top: (F, w, hh) => { const g = sc.g; for (let i = 0; i < 4; i++) { const [cx2, cy2] = F(w * (0.25 + (i % 2) * 0.5), hh * (0.25 + Math.floor(i / 2) * 0.5)); g.strokeStyle = rgb(hex(['#e0c060', '#6a8fbf', '#d86a5a', '#6fae78'][i]), 1); g.lineWidth = sc.ink * 1.4; g.beginPath(); g.ellipse(cx2, cy2, 1.6, 0.8, 0, 0, TAU); g.stroke(); } } });
  },
  seed_bin: ({ sc, wood, hw, hd }) => {
    const x = hw - 1.6, y = hd - 1.6;
    sc.box(-x, x, -y, y, 0, 4.4, wood, { front: boardsOn(sc, wood, 3, false), left: boardsOn(sc, wood, 3, false), right: boardsOn(sc, wood, 3, false), back: boardsOn(sc, wood, 3, false) });
    sc.box(-x - 0.3, x + 0.3, -y - 0.3, y + 0.3, 4.4, 5, wood, { top: grain(sc, wood, 2) });
    // The scoop, lying on the lid.
    sc.lathe(-0.8, 0.4, [[5, 0.9], [5.7, 1.3]], paintOf(hex('#d2b384')), 12, { cap: paintOf(hex('#e3cf9a')), lid: (F) => { const g = sc.g; g.fillStyle = rgb(hex('#c9a15c')); const pts = Array.from({ length: 10 }, (_, i) => F((i / 10) * TAU, 1.0)); g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath(); g.fill(); } });
    sc.rod([0.5, 0.4, 5.5], [3, 1.4, 5.3], 0.28, paintOf(hex('#d2b384')));
  },
  sprout_bin: ({ sc, wood, hw, hd }) => {
    const x = hw - 1.6, y = hd - 1.6, h = 4.4;
    sc.box(-x, x, -y, y, 0, h, wood, { front: boardsOn(sc, wood, 3, false), left: boardsOn(sc, wood, 3, false), right: boardsOn(sc, wood, 3, false), back: boardsOn(sc, wood, 3, false) });
    // The damp cloth over the top, hanging down a little at the front, and what has come up through it.
    const CLOTH = paintOf(hex('#b9c4b0'));
    sc.panel([[-x - 0.2, -y - 0.2, h + 0.15], [x + 0.2, -y - 0.2, h + 0.15], [x + 0.2, y + 0.2, h + 0.15], [-x - 0.2, y + 0.2, h + 0.15]], CLOTH, (F) => {
      const g = sc.g;
      g.strokeStyle = rgb(hex('#8e9a86'), 1, 0.7);
      g.lineWidth = sc.ink * 0.6;
      for (const v of [0.3, 0.55, 0.8]) { const [a, b] = [F(0.05, v), F(0.95, v + 0.05)]; g.beginPath(); g.moveTo(a[0], a[1]); g.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.8, b[0], b[1]); g.stroke(); }
    });
    sc.panel([[-x - 0.2, y + 0.2, h + 0.15], [x + 0.2, y + 0.2, h + 0.15], [x + 0.2, y + 0.3, h - 1.2], [-x - 0.2, y + 0.3, h - 1.5]], CLOTH);
    for (const [px, py] of [[-1.6, -1.2], [0.6, -1.8], [1.8, 0.4], [-0.8, 0.9]] as Pt[]) {
      sc.sprite([px, py, h + 0.2], 1, (sx2, sy2) => {
        const g = sc.g;
        g.strokeStyle = rgb(hex('#5f9a4e'));
        g.lineWidth = 1.1;
        g.lineCap = 'round';
        g.beginPath(); g.moveTo(sx2, sy2); g.lineTo(sx2 - 1.2, sy2 - 2.6); g.moveTo(sx2, sy2); g.lineTo(sx2 + 1.3, sy2 - 2.2); g.stroke();
        g.fillStyle = rgb(hex('#7fbf62'));
        g.beginPath(); g.ellipse(sx2 - 1.4, sy2 - 2.9, 0.9, 0.5, -0.5, 0, TAU); g.ellipse(sx2 + 1.5, sy2 - 2.5, 0.9, 0.5, 0.5, 0, TAU); g.fill();
        g.lineCap = 'butt';
      });
    }
  },
  trash_crate: ({ sc, wood, hw, hd }) => {
    const x = hw - 1, y = hd - 1, h = 5.2, t = 0.45, fill = 3.4;
    // What has been thrown in, up to a hand under the rim.
    sc.box(-x + t, x - t, -y + t, y - t, 0, fill, paintOf(hex('#4d4535')), {
      top: (F, w, hh) => {
        const g = sc.g;
        for (let i = 0; i < 14; i++) {
          const [px, py] = F(((i * 0.37) % 1) * w, ((i * 0.61) % 1) * hh);
          g.fillStyle = ['rgba(120, 110, 70, 0.7)', 'rgba(60, 50, 40, 0.6)', 'rgba(150, 120, 80, 0.6)'][i % 3];
          g.beginPath(); g.ellipse(px, py, 0.9, 0.5, i, 0, TAU); g.fill();
        }
      },
    });
    // Walls of slats with gaps between them, and the corner posts they are nailed to.
    for (const [a, b, c, d] of [[-x, x, -y, -y + t], [-x, x, y - t, y], [-x, -x + t, -y + t, y - t], [x - t, x, -y + t, y - t]]) {
      sc.part(a, b, c, d, 0, h, () => {
        for (const z of [0.3, 2.1, 3.9]) sc.drawBox(a, b, c, d, z, z + 1.2, wood);
      });
    }
    for (const [px, py] of [[-x, -y], [x, -y], [x, y], [-x, y]] as Pt[]) sc.box(px - 0.4, px + 0.4, py - 0.4, py + 0.4, 0, h, wood);
    // Heaped over the rim in the middle: a cabbage gone over, a rotten apple, peelings, a fish head.
    sc.lathe(-1.3, -1.1, [[fill, 1.4], [fill + 0.9, 1.6], [fill + 1.8, 1.3], [fill + 2.4, 0.4]], paintOf(hex('#7d8f4e')), 12, { staves: 7 });
    sc.lathe(1.4, -0.8, [[fill, 0.9], [fill + 0.7, 1.1], [fill + 1.4, 0.8], [fill + 1.7, 0.3]], paintOf(hex('#9a5a3c')), 12);
    sc.lathe(-0.4, 1.5, [[fill, 1.5], [fill + 0.8, 1.2], [fill + 1.4, 0.3]], paintOf(hex('#a39064')), 12);
    sc.lathe(1.7, 1.6, [[fill, 0.8], [fill + 0.9, 0.6], [fill + 1.2, 0.2]], paintOf(hex('#7b8088')), 10);
    // And the flies over it.
    for (const at of [[-0.8, 0.2, 7.4], [0.9, -0.6, 8.2], [0.2, 1.0, 6.8]] as V3[]) {
      sc.sprite(at, 0.3, (px, py) => {
        const g = sc.g;
        g.fillStyle = 'rgba(230, 236, 244, 0.75)';
        g.beginPath(); g.ellipse(px - 0.55, py - 0.45, 0.55, 0.28, -0.6, 0, TAU); g.ellipse(px + 0.55, py - 0.45, 0.55, 0.28, 0.6, 0, TAU); g.fill();
        g.fillStyle = 'rgba(40, 36, 44, 0.9)';
        g.beginPath(); g.arc(px, py, 0.5, 0, TAU); g.fill();
      });
    }
  },
  /*
   * The crate rack: a pallet rack two tiers high and four bays long, the
   * uprights at the ends and the middle, a runner down each side of each
   * tier and the deck slatted across between them. Its eight spots are the
   * eight subtiles it stands on, and `trim` says which have a crate: they are
   * shown filling the bottom tier first, front to back, and then the top, so
   * a rack three full looks three full from anywhere.
   */
  crate_shelf: ({ sc, wood, hw, hd, trim }) => {
    const x = hw - 4.2, y = hd - 0.8, H = 14.6;
    const tiers = [2.2, 9.0];
    const bay = (2 * y) / 4;
    // A shade paler than any frame it stands on, so a crate on a rack of the same wood still stands out from it.
    const CRATE = paintOf(hex('#c9a46c'));
    const mask = trim ?? 0;
    const spans: Array<[number, number]> = [[-y + 0.5, -0.5], [0.5, y - 0.5]];
    for (const py of [-y, 0, y]) {
      for (const px of [-x, x]) sc.box(px - 0.5, px + 0.5, py - 0.5, py + 0.5, 0, H, wood);
      sc.box(-x + 0.5, x - 0.5, py - 0.4, py + 0.4, H - 0.9, H, wood);
    }
    const slats = (F: FaceAt, w: number, h: number): void => {
      const n = Math.round(h / 1.6);
      for (let i = 1; i < n; i++) {
        const t = (i * h) / n;
        sc.poly([F(0, t - 0.2), F(w, t - 0.2), F(w, t + 0.2), F(0, t + 0.2)]);
        sc.g.fillStyle = rgb(wood.ink, 1, 0.5);
        sc.g.fill();
      }
    };
    for (const z of tiers) {
      for (const [a, b] of spans) {
        for (const px of [-x, x]) sc.box(px - 0.45, px + 0.45, a, b, z - 1.1, z - 0.1, wood, { left: grain(sc, wood, 1), right: grain(sc, wood, 1) });
        sc.box(-x + 0.45, x - 0.45, a, b, z - 0.5, z, wood, { top: slats });
      }
    }
    for (let k = 0; k < 8; k++) {
      if (!(mask & (1 << k))) continue;
      const z = tiers[k >> 2], cy = y - ((k & 3) + 0.5) * bay;
      crate(sc, CRATE, -4.3, 4.3, cy - 4.1, cy + 4.1, z, z + 5);
    }
  },

  /*
   * Beds. The bed is a double on four posts, the head posts taller, panelled
   * at both ends, with a ticking mattress, a blanket over the foot of it and
   * the sheet turned down over the blanket's edge, and two pillows. The cot
   * is a camp bed: canvas laced between two poles on four short legs, with a
   * bolster and the blanket rolled at the foot.
   */
  bed: ({ sc, wood }) => {
    const L = 13.6, W = 8.6;
    const TICK = paintOf(hex('#ece3cf')), WOOL = paintOf(hex('#8fa7c6')), SHEET = paintOf(hex('#f8f4ea'));
    for (const y of [-W, W]) {
      sc.box(-L - 0.7, -L + 0.7, y - 0.7, y + 0.7, 0, 10.4, wood);
      sc.box(L - 0.7, L + 0.7, y - 0.7, y + 0.7, 0, 6.6, wood);
      sc.lathe(-L, y, [[10.4, 0.55], [10.9, 0.85], [11.5, 0.4]], wood, 10);
      sc.lathe(L, y, [[6.6, 0.55], [7.1, 0.85], [7.7, 0.4]], wood, 10);
    }
    const panelled = (F: FaceAt, w: number, h: number): void => {
      const n = 3, pw = (w - 0.6) / n;
      for (let i = 0; i < n; i++) rectOn(sc, F, 0.6 + i * pw, 0.6, 0.3 + (i + 1) * pw - 0.3, h - 0.6, rgb(wood.body, 1.04), wood.ink, 0.6);
    };
    sc.box(-L - 0.3, -L + 0.3, -W + 0.7, W - 0.7, 2.2, 9.4, wood, { left: panelled, right: panelled });
    sc.box(-L - 0.5, -L + 0.5, -W + 0.7, W - 0.7, 9.4, 10, wood);
    sc.box(L - 0.3, L + 0.3, -W + 0.7, W - 0.7, 2.2, 5.8, wood, { left: panelled, right: panelled });
    for (const y of [-W, W]) sc.box(-L + 0.7, L - 0.7, y - 0.35, y + 0.35, 2.2, 3.6, wood, { front: grain(sc, wood, 1), back: grain(sc, wood, 1) });
    const ticking = (F: FaceAt, w: number, h: number): void => {
      sc.g.strokeStyle = 'rgba(120, 140, 170, 0.45)';
      sc.g.lineWidth = sc.ink * 0.6;
      for (let s = 0.8; s < w; s += 1.1) { const [a, b] = [F(s, 0), F(s, h)]; sc.g.beginPath(); sc.g.moveTo(a[0], a[1]); sc.g.lineTo(b[0], b[1]); sc.g.stroke(); }
    };
    sc.box(-L + 0.75, -L + 4.6, -W + 0.4, W - 0.4, 3.6, 5.6, TICK, { front: ticking, back: ticking, top: ticking });
    const check = (F: FaceAt, w: number, h: number): void => {
      for (const s of [w - 3.2, w - 2.2]) rectOn(sc, F, s, 0, s + 0.5, h, rgb(WOOL.body, 0.78), WOOL.ink, 0.3);
    };
    sc.box(-L + 4.6, L - 0.75, -W + 0.4, W - 0.4, 3.4, 5.9, WOOL, {
      top: (F, w, h) => { check(F, w, h); rectOn(sc, F, 0, 0, 1.5, h, rgb(SHEET.body), SHEET.ink, 0.6); },
      front: check, back: check,
    });
    for (const [a, b] of [[-W + 0.9, -0.3], [0.3, W - 0.9]] as Pt[]) {
      sc.box(-L + 1, -L + 4.1, a, b, 5.6, 6.9, SHEET, { top: (F, w, h) => { const [p, q] = [F(w * 0.5, 0.3), F(w * 0.5, h - 0.3)]; sc.line(p, q, rgb(SHEET.ink, 1, 0.35), sc.ink * 0.6); } });
    }
  },
  cot: ({ sc, wood }) => {
    const L = 9, W = 3.9, z = 3.4;
    const CANVAS = paintOf(hex('#d8cdb0')), WOOL = paintOf(hex('#a48b6a'));
    for (const x of [-L + 0.8, L - 0.8]) {
      for (const y of [-W, W]) sc.box(x - 0.4, x + 0.4, y - 0.4, y + 0.4, 0, z, wood);
      sc.box(x - 0.3, x + 0.3, -W + 0.4, W - 0.4, 0.9, 1.5, wood);
    }
    for (const y of [-W, W]) sc.box(-L, L, y - 0.45, y + 0.45, z, z + 0.8, wood);
    sc.box(-L + 0.4, L - 0.4, -W + 0.45, W - 0.45, z + 0.3, z + 0.55, CANVAS, {
      top: (F, w, h) => {
        sc.g.strokeStyle = rgb(CANVAS.ink, 1, 0.4);
        sc.g.lineWidth = sc.ink * 0.6;
        for (const t of [0.35, 0.65]) { const [a, m, b] = [F(0.6, h * t), F(w / 2, h * t + 0.4), F(w - 0.6, h * t)]; sc.g.beginPath(); sc.g.moveTo(a[0], a[1]); sc.g.quadraticCurveTo(m[0], m[1], b[0], b[1]); sc.g.stroke(); }
      },
    });
    sc.rod([L - 2.4, -W + 0.9, z + 1.55], [L - 2.4, W - 0.9, z + 1.55], 1, WOOL);
    sc.box(-L + 1, -L + 3.4, -W + 1, W - 1, z + 0.55, z + 1.6, LINEN);
  },

  /*
   * The two pieces that serve other people. The stall is a counter under a
   * striped awning on four poles, the back pair taller so the awning runs off
   * to the front, with what is for sale laid out along it and stock behind.
   * The mailbox is a box on a post with a slot and a brass plate at the
   * front, the door and its lock at the back, and a little pitched lid.
   */
  stall: ({ sc, wood, hw, hd }) => {
    const x = hw - 1.6, y = hd - 1;
    const RED = paintOf(hex('#cf6f5f')), CREAM = paintOf(hex('#f3e8d0'));
    sc.box(-x + 0.2, x - 0.2, 1.4, y - 1.4, 0, 7.4, wood, { front: boardsOn(sc, wood, 8), back: boardsOn(sc, wood, 8), left: boardsOn(sc, wood, 2), right: boardsOn(sc, wood, 2) });
    sc.box(-x, x, 1.1, y - 1, 7.4, 8, wood, { top: grain(sc, wood, 3), front: grain(sc, wood, 1) });
    // The poles, sorted as reaching no higher than the awning's lowest edge, since they are under it from wherever you stand.
    const zb = 18.6, zf = 15.8, y0 = -y - 0.2, y1 = y + 0.8;
    const zAt = (py: number): number => zb + ((zf - zb) * (py - y0)) / (y1 - y0);
    for (const px of [-x - 0.4, x + 0.4]) for (const py of [-y + 0.6, y - 0.6]) sc.box(px - 0.45, px + 0.45, py - 0.45, py + 0.45, 0, zAt(py), wood, undefined, zf);
    sc.panel([[-x - 1.2, y0, zb], [x + 1.2, y0, zb], [x + 1.2, y1, zf], [-x - 1.2, y1, zf]], CREAM, stripes(sc, RED, 10));
    // The valance along its front edge, scalloped, each scallop the colour of the stripe over it.
    sc.part(-x - 1.2, x + 1.2, y1 - 0.1, y1 + 0.1, zf - 1.4, zf, () => {
      const n = 10, w = (2 * x + 2.4) / n, k = sc.light(0, sc.sees(0, 1) ? 1 : -1, 0);
      for (let i = 0; i < n; i++) {
        const P = i % 2 ? RED : CREAM, a = -x - 1.2 + i * w;
        const pts: Pt[] = [sc.P(a, y1, zf), sc.P(a + w, y1, zf)];
        for (let j = 0; j <= 6; j++) pts.push(sc.P(a + w - (j / 6) * w, y1, zf - 0.8 - Math.sin((j / 6) * Math.PI) * 0.6));
        sc.fillInk(pts, rgb(P.body, k), P.ink, 0.7);
      }
    });
    // What is for sale: a basket of apples, loaves, a bolt of cloth and a row of crocks.
    const BASKET = paintOf(hex('#c9a46a'));
    sc.lathe(-x + 3.4, 4.6, [[8, 1.6], [9.2, 2.1], [9.4, 2.1]], BASKET, 14, {
      staves: 10, cap: paintOf(hex('#b8493c')),
      lid: (F) => { for (let i = 0; i < 7; i++) { const [px, py] = F(i * 0.9, 0.5 + (i % 3) * 0.55); sc.g.fillStyle = i % 2 ? '#d6574a' : '#9fbf4a'; sc.g.beginPath(); sc.g.arc(px, py, 0.95, 0, TAU); sc.g.fill(); } },
    });
    for (const [bx, by] of [[-4.6, 3.4], [-3, 5.8], [-6, 6.1]] as Pt[]) sc.lathe(bx, by, [[8, 1.1], [8.6, 1.15], [9.2, 0.85], [9.5, 0.4]], paintOf(hex('#c98d4f')), 12, { cap: paintOf(hex('#dba567')) });
    const BOLT = paintOf(hex('#7196bb'));
    sc.box(0.4, 5.4, 2.9, 6.5, 8, 9.5, BOLT, {
      top: (F, w, h) => { sc.g.strokeStyle = rgb(BOLT.ink, 1, 0.4); sc.g.lineWidth = sc.ink * 0.6; for (let s = 0.6; s < w; s += 0.9) { const [a, b] = [F(s, 0), F(s, h)]; sc.g.beginPath(); sc.g.moveTo(a[0], a[1]); sc.g.lineTo(b[0], b[1]); sc.g.stroke(); } },
    });
    for (const [bx, by, c] of [[x - 5, 3.6, '#b77f68'], [x - 3, 4.6, '#9fb3bd'], [x - 4.6, 6.4, '#dcd2b4']] as Array<[number, number, string]>) {
      sc.lathe(bx, by, [[8, 0.8], [8.9, 1], [9.6, 0.7], [9.9, 0.5]], paintOf(hex(c)), 12, { cap: paintOf(hex('#8e6f55')) });
    }
    // Stock behind the counter: a crate and a sack of grain.
    crate(sc, paintOf(hex('#b08850')), -x + 1.4, -x + 6.4, -y + 0.8, -y + 5.4, 0, 4.6);
    sc.lathe(x - 3, -y + 3.6, [[0, 2], [1.6, 2.4], [3.6, 2], [4.6, 1], [5.2, 0.5]], paintOf(hex('#d9caa4')), 12);
  },
  mailbox: ({ sc, wood }) => {
    sc.shadows = [[-2.8, 2.8, -2.8, 2.8]];
    sc.box(-2.4, 2.4, -0.55, 0.55, 0, 0.8, wood);
    sc.box(-0.55, 0.55, -2.4, -0.55, 0, 0.8, wood);
    sc.box(-0.55, 0.55, 0.55, 2.4, 0, 0.8, wood);
    sc.box(-0.6, 0.6, -0.6, 0.6, 0.8, 8.6, wood);
    const straps = (F: FaceAt, w: number, h: number): void => {
      for (const t of [0.5, h - 1]) rectOn(sc, F, 0, t, w, t + 0.5, rgb(IRON.body, 1.05), IRON.ink);
    };
    sc.box(-2.8, 2.8, -2.2, 2.2, 8.6, 12.2, wood, {
      front: (F, w, h) => {
        straps(F, w, h);
        rectOn(sc, F, w * 0.18, h * 0.42, w * 0.82, h * 0.7, rgb(BRASS.body), BRASS.ink);
        rectOn(sc, F, w * 0.26, h * 0.52, w * 0.74, h * 0.6, rgb(SOOT.body), SOOT.ink);
      },
      back: (F, w, h) => {
        rectOn(sc, F, 0.45, 0.35, w - 0.45, h - 0.35, rgb(wood.body, 0.95), wood.ink);
        for (const t of [1, h - 1.5]) rectOn(sc, F, 0.2, t, 1.4, t + 0.5, rgb(IRON.body), IRON.ink);
        knob(sc, F, w - 1.2, h / 2, 0.45, BRASS);
      },
      left: straps, right: straps,
    });
    gable(sc, -3.3, 3.3, -2.7, 2.7, 12.2, 14.2, SHINGLE(wood), 'y', wood, 0.5, 3);
  },

  /*
   * Things to stand at. A lectern is a turned column on a cross foot under a
   * desk that slants down to whoever is reading, a lip along its low edge and
   * a book open on it. A coat rack is a turned pole on four splayed feet with
   * a peg each way near the top, a cloak on one and a hat on another. A
   * planter is a boarded trough of earth on feet, in flower.
   */
  lectern: ({ sc, wood }) => {
    sc.shadows = [[-3.4, 3.4, -3.4, 3.4]];
    sc.box(-3.4, 3.4, -0.55, 0.55, 0, 0.9, wood);
    sc.box(-0.55, 0.55, -3.4, -0.55, 0, 0.9, wood);
    sc.box(-0.55, 0.55, 0.55, 3.4, 0, 0.9, wood);
    sc.lathe(0, 0, [[0.9, 1.1], [1.5, 0.75], [2.1, 0.6], [7.4, 0.5], [7.9, 0.85], [8.4, 1]], wood, 12);
    const x = 3.8, yb = -3, yf = 2.8, zb = 11.4, zf = 9.2, base = 8.4;
    const on = (s: number, t: number, lift = 0): V3 => [s, yb + (yf - yb) * t, zb + (zf - zb) * t + lift];
    const COVER = paintOf(hex('#8a3f36'));
    // One part, laid in the order you see it from: from in front the back board is behind the slope; from behind it is in front of it.
    sc.part(-x, x, yb - 0.2, yf + 0.6, base, zb + 0.4, () => {
      const inFront = sc.sees(0, 1);
      const back = (): void => sc.drawPanel([[-x + 0.3, yb, base], [x - 0.3, yb, base], [x - 0.3, yb, zb], [-x + 0.3, yb, zb]], wood, (F) => grain(sc, wood, 2)((s, t) => F(s / (2 * x - 0.6), t / (zb - base)), 2 * x - 0.6, zb - base));
      const lip = (): void => sc.drawBox(-x, x, yf, yf + 0.55, base, zf + 0.5, wood);
      if (inFront) back();
      else lip();
      for (const s of [-x + 0.3, x - 0.3]) sc.drawPanel([[s, yb, base], [s, yf, base], [s, yf, zf], [s, yb, zb]], wood);
      sc.drawPanel([on(-x, 0), on(x, 0), on(x, 1), on(-x, 1)], wood);
      // The book: its covers, and the two pages open over them, lined.
      sc.drawPanel([on(-3.2, 0.1, 0.1), on(3.2, 0.1, 0.1), on(3.2, 0.86, 0.1), on(-3.2, 0.86, 0.1)], COVER);
      for (const [a, b] of [[-3, -0.08], [0.08, 3]] as Pt[]) {
        sc.drawPanel([on(a, 0.14, 0.2), on(b, 0.14, 0.2), on(b, 0.82, 0.2), on(a, 0.82, 0.2)], LINEN, (F) => {
          sc.g.strokeStyle = 'rgba(80, 70, 90, 0.45)';
          sc.g.lineWidth = sc.ink * 0.5;
          for (let i = 1; i < 7; i++) { const [p, q] = [F(0.12, i / 7.5), F(0.88, i / 7.5)]; sc.g.beginPath(); sc.g.moveTo(p[0], p[1]); sc.g.lineTo(q[0], q[1]); sc.g.stroke(); }
        });
      }
      sc.line(sc.P(0.5, yb + (yf - yb) * 0.84, zb + (zf - zb) * 0.84 + 0.22), sc.P(0.6, yf + 0.6, zf - 1.2), '#b8413a', sc.ink * 0.9);
      if (inFront) lip();
      else back();
    });
  },
  coat_rack: ({ sc, wood }) => {
    sc.shadows = [[-3.4, 3.4, -3.4, 3.4]];
    const CLOAK = paintOf(hex('#6f958c')), FELT = paintOf(hex('#6e5a44'));
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Pt[]) sc.rod([dx * 0.5, dy * 0.5, 2.4], [dx * 3.6, dy * 3.6, 0.3], 0.4, wood);
    sc.lathe(0, 0, [[0, 0.75], [1.6, 0.65], [2.6, 0.55], [15.8, 0.45], [16.2, 0.8], [16.9, 0.75], [17.3, 0.35], [17.6, 0]], wood, 12);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Pt[]) sc.rod([dx * 0.45, dy * 0.45, 14.6], [dx * 2.4, dy * 2.4, 15.6], 0.28, wood);
    // The cloak, hung by its hood from the front peg: gathered at the top and falling open in folds.
    const folds = 6;
    const top: V3[] = [], bottom: V3[] = [];
    for (let i = 0; i <= folds; i++) {
      const u = i / folds;
      top.push([-1 + 2 * u, 3, 15.4]);
      bottom.push([-3 + 6 * u, 3.5 + 0.45 * Math.sin(u * Math.PI * 3) + 0.6 * Math.sin(u * Math.PI), 5.6 + 0.5 * Math.sin(u * Math.PI)]);
    }
    cloth(sc, top, bottom, CLOAK);
    // A hat on the left one.
    sc.lathe(-3, 0, [[15.2, 2], [15.45, 2], [15.45, 1.15], [16.9, 1], [17.2, 0.6]], FELT, 16);
  },
  planter: ({ sc, wood, hw, hd }) => {
    const x = hw - 0.8, y = hd - 1, h = 4.4, t = 0.6;
    const side = boardsOn(sc, wood, 3, false);
    for (const px of [-x + 0.6, x - 0.6]) for (const py of [-y + 0.6, y - 0.6]) sc.box(px - 0.5, px + 0.5, py - 0.5, py + 0.5, 0, 0.6, wood);
    sc.box(-x, x, -y, -y + t, 0.6, h, wood, { front: side, back: side });
    sc.box(-x, x, y - t, y, 0.6, h, wood, { front: side, back: side });
    sc.box(-x, -x + t, -y + t, y - t, 0.6, h, wood, { left: side, right: side });
    sc.box(x - t, x, -y + t, y - t, 0.6, h, wood, { left: side, right: side });
    const soil = h - 0.7;
    sc.box(-x + t, x - t, -y + t, y - t, 0.6, soil, paintOf(hex('#5b4636')), {
      top: (F, w, hh) => { for (let i = 0; i < 16; i++) { const [px, py] = F(((i * 0.41) % 1) * w, ((i * 0.67) % 1) * hh); sc.g.fillStyle = i % 2 ? 'rgba(40, 28, 20, 0.5)' : 'rgba(130, 100, 70, 0.45)'; sc.g.beginPath(); sc.g.arc(px, py, 0.35, 0, TAU); sc.g.fill(); } },
    });
    [[-6.6, 0.4], [-3.3, -0.6], [0, 0.5], [3.3, -0.5], [6.6, 0.3]].forEach(([px, py], i) => {
      sc.sprite([px, py, soil], 1.4, (sx, sy) => plant(sc.g, sx, sy, i, 0.9), 4);
    });
  },
  firewood_rack: ({ sc, wood, hw, hd }) => {
    const x = hw - 0.9, y = hd - 1.6, H = 8.6;
    const BARK = paintOf(hex('#86674a')), END = paintOf(hex('#e3c697'));
    for (const py of [-y, y]) sc.box(-x, x, py - 0.45, py + 0.45, 0, 1, wood);
    for (const px of [-x + 0.5, x - 0.5]) {
      for (const py of [-y, y]) sc.box(px - 0.45, px + 0.45, py - 0.45, py + 0.45, 1, H, wood);
      sc.box(px - 0.45, px + 0.45, -y + 0.45, y - 0.45, H - 0.8, H, wood);
    }
    // The stack: split lengths laid across, their ends a wall of rings along the front and the back, packed each row into the one under it.
    const ends = (F: FaceAt, w: number, h: number): void => {
      const r = 1.02, ds = 2.1, dt = 1.82;
      for (let row = 0, t = r; t - r * 0.4 < h; row++, t += dt) {
        for (let s = r + (row % 2) * ds * 0.5; s - r * 0.4 < w; s += ds) {
          const k = ((row * 7 + Math.round(s * 3)) % 5) * 0.025;
          sc.fillInk(circleOn(F, s, t, r, 14), rgb(END.body, 0.96 + k), BARK.body, 1);
          sc.poly(circleOn(F, s, t, r * 0.5, 10));
          sc.g.strokeStyle = rgb(END.ink, 1, 0.3);
          sc.g.lineWidth = sc.ink * 0.5;
          sc.g.stroke();
        }
      }
    };
    sc.box(-x + 1, x - 1, -y + 0.1, y - 0.1, 1, H - 1.2, BARK, {
      front: ends, back: ends,
      left: boardsOn(sc, BARK, 5, false), right: boardsOn(sc, BARK, 5, false),
      top: boardsOn(sc, BARK, 11),
    });
  },

  /*
   * The hive: shallow boxes painted pale and stacked on a stand under a
   * pitched lid, the brood box deepest at the bottom with the mouth cut
   * along the foot of its front, a landing board out from the mouth and a
   * few of the swarm about it.
   */
  hive: ({ sc, wood, hw, hd }) => {
    const x = hw - 1.8, y = hd - 1.4, bx = 6.2, by = 3.8;
    const PAINTED = [paintOf(mix(wood.body, [246, 240, 226], 0.55)), paintOf(mix(wood.body, [214, 230, 206], 0.5))];
    for (const px of [-x + 1.4, x - 1.4]) for (const py of [-y + 0.8, y - 0.8]) sc.box(px - 0.45, px + 0.45, py - 0.45, py + 0.45, 0, 2.6, wood);
    sc.box(-x, x, -y, y, 2.6, 3.2, wood, { top: grain(sc, wood, 2), front: grain(sc, wood, 1) });
    const zs = [3.2, 6.6, 8.8, 11];
    const handhold = (F: FaceAt, w: number, h: number): void => rectOn(sc, F, w / 2 - 1.2, h * 0.5, w / 2 + 1.2, h * 0.5 + 0.45, rgb(hex('#3a2e26')), hex('#2a211b'), 0.6);
    for (let i = 0; i < 3; i++) {
      sc.box(-bx, bx, -by, by, zs[i], zs[i + 1], PAINTED[i % 2], {
        front: i === 0 ? (F, w) => rectOn(sc, F, w * 0.25, 0.25, w * 0.75, 0.85, rgb(hex('#2b221c')), hex('#1e1814')) : handhold,
        back: handhold, left: handhold, right: handhold,
      });
    }
    gable(sc, -bx - 0.8, bx + 0.8, -by - 0.9, by + 0.9, 11, 13.2, SHINGLE(wood), 'x', PAINTED[1], 0.8, 3);
    sc.box(-3.2, 3.2, by, by + 1.4, 3.2, 3.55, wood);
    for (const at of [[-2.2, 6.4, 5], [0.6, 7.2, 6.4], [2.6, 5.8, 4.4], [1.2, 5.4, 3.9], [-0.8, 6.8, 7.4]] as V3[]) {
      sc.sprite(at, 0.4, (px, py) => {
        const g = sc.g;
        g.fillStyle = 'rgba(240, 246, 252, 0.8)';
        g.beginPath(); g.ellipse(px - 0.5, py - 0.7, 0.6, 0.35, -0.5, 0, TAU); g.ellipse(px + 0.5, py - 0.7, 0.6, 0.35, 0.5, 0, TAU); g.fill();
        g.fillStyle = '#e2b53e';
        g.beginPath(); g.ellipse(px, py, 0.85, 0.55, 0, 0, TAU); g.fill();
        g.fillStyle = '#3a2e26';
        g.fillRect(px - 0.15, py - 0.55, 0.3, 1.1);
      });
    }
  },

  /*
   * What a settlement sets up to be seen. The bell hangs in a timber frame
   * under a little shingled roof, braced at the feet, its clapper showing
   * under the lip and the rope hanging from it. The statue is a robed figure
   * with a staff, cast in bronze gone green, on a plinth of dressed stone.
   * The banner is a cloth hung off a crossbar on a staff, cut in a
   * swallowtail, in its dye.
   */
  bell: ({ sc, wood }) => {
    sc.shadows = [[-4.8, 4.8, -3.4, 3.4]];
    const BRONZE = paintOf(hex('#c99a52'), 0.55);
    const x = 3.9, H = 16.4;
    for (const px of [-x, x]) {
      sc.box(px - 0.6, px + 0.6, -3.4, 3.4, 0, 1, wood);
      sc.box(px - 0.5, px + 0.5, -0.5, 0.5, 1, H, wood);
      for (const s of [-1, 1]) sc.rod([px, s * 2.8, 1], [px, s * 0.6, 5.2], 0.3, wood);
    }
    sc.box(-x - 0.8, x + 0.8, -0.6, 0.6, H, H + 1.2, wood);
    gable(sc, -x - 1.6, x + 1.6, -2.6, 2.6, H + 1.2, H + 3.6, SHINGLE(wood), 'x', wood, 0.9, 3);
    sc.box(-0.4, 0.4, -0.3, 0.3, 14.6, H, IRON);
    sc.lathe(0, 0, [[8.6, 3], [8.9, 3], [9.4, 2.7], [11, 2], [13.2, 1.8], [14.2, 1.4], [14.6, 0.7]], BRONZE, 20, { bands: [[9.5, BRONZE, 0.3], [13, BRONZE, 0.25]], cap: BRONZE });
    sc.lathe(0, 0, [[7.8, 0.3], [8, 0.55], [8.4, 0.55], [8.6, 0.3]], IRON, 10);
    sc.rod([0, 0, 7.8], [0, 0.8, 3.4], 0.16, ROPE);
  },
  statue: ({ sc }) => {
    sc.shadows = [[-4.4, 4.4, -4.4, 4.4]];
    const PATINA = paintOf(hex('#88ae9f'), 0.62);
    const dressed = bricks(sc, STONE, 1.8);
    sc.box(-4.4, 4.4, -4.4, 4.4, 0, 0.8, STONE);
    sc.box(-3.6, 3.6, -3.6, 3.6, 0.8, 4.4, STONE, {
      front: (F, w, h) => { rectOn(sc, F, 0.9, 0.8, w - 0.9, h - 0.8, rgb(STONE.body, 0.95), STONE.ink, 0.6); sc.g.strokeStyle = rgb(STONE.ink, 1, 0.5); sc.g.lineWidth = sc.ink * 0.6; for (const t of [h * 0.45, h * 0.62]) { const [a, b] = [F(1.6, t), F(w - 1.6, t)]; sc.g.beginPath(); sc.g.moveTo(a[0], a[1]); sc.g.lineTo(b[0], b[1]); sc.g.stroke(); } },
      back: dressed, left: dressed, right: dressed,
    });
    sc.box(-4, 4, -4, 4, 4.4, 5.1, STONE);
    const z = 5.1;
    sc.lathe(0, 0, [[z, 2.1], [z + 0.6, 2], [z + 4.2, 1.45], [z + 6.2, 1.2], [z + 6.9, 1.55], [z + 7.5, 1.3], [z + 7.9, 0.5]], PATINA, 16, { staves: 9 });
    sc.lathe(0, 0.15, [[z + 7.9, 0.5], [z + 8.2, 0.85], [z + 9, 0.9], [z + 9.5, 0.7], [z + 9.8, 0.2]], PATINA, 12);
    sc.rod([1.35, 0.2, z + 7], [2.3, 1, z + 5.4], 0.42, PATINA);
    sc.rod([-1.35, 0.2, z + 7], [-1.1, 1.3, z + 4.9], 0.42, PATINA);
    sc.rod([2.5, 1, z], [2.5, 1, z + 11.2], 0.26, PATINA);
    sc.lathe(2.5, 1, [[z + 11.2, 0.3], [z + 11.6, 0.55], [z + 12, 0.2]], PATINA, 10);
  },
  banner: ({ sc, wood, tint }) => {
    sc.shadows = [[-2.6, 2.6, -2.6, 2.6]];
    const fabric = tint ? paintOf(hex(tint.colour), 0.55) : LINEN;
    const hem = tint ? paintOf(hex(tint.shade), 0.55) : paintOf(hex('#d9ceb6'));
    sc.box(-2.6, 2.6, -0.5, 0.5, 0, 0.8, wood);
    sc.box(-0.5, 0.5, -2.6, -0.5, 0, 0.8, wood);
    sc.box(-0.5, 0.5, 0.5, 2.6, 0, 0.8, wood);
    sc.rod([0, 0, 0.8], [0, 0, 24.2], 0.42, wood);
    sc.lathe(0, 0, [[24.2, 0.5], [24.7, 0.8], [25.4, 0.35], [25.8, 0]], BRASS, 12);
    sc.rod([-4.5, 0, 22.4], [4.5, 0, 22.4], 0.3, wood);
    // The cloth in folds, hung in front of the staff and cut in a swallowtail, a band of the darker shade at the head and the foot.
    const n = 6, head = 22.1, foot = (x: number): number => 9.6 + 2.8 * (1 - Math.abs(x) / 4.2);
    const top: V3[] = [], bottom: V3[] = [];
    for (let i = 0; i <= n; i++) {
      const x = -4.2 + (8.4 * i) / n, y = 1 + 0.35 * Math.sin(i * 2.1);
      top.push([x, y, head]);
      bottom.push([x, y, foot(x)]);
    }
    cloth(sc, top, bottom, fabric, (F, k) => {
      for (const [v0, v1] of [[0.06, 0.12], [0.82, 0.88]]) sc.fillInk([F(0, v0), F(1, v0), F(1, v1), F(0, v1)], rgb(hem.body, k), hem.ink, 0.2);
    });
  },

  /*
   * The cloth trade. The spindle is a great wheel: a bench on three legs with
   * the wheel on a post at one end and the spindle head at the other, the
   * drive band between them and yarn on the spindle, and a basket of fleece
   * on the floor. The loom is a floor loom: a frame with the warp beam at the
   * back, the heddles hanging from the castle in the middle, the reed in
   * front of them, the woven cloth coming over the breast beam onto the
   * cloth beam, the treadles under it and the weaver's bench in front.
   */
  spindle: ({ sc, wood }) => {
    sc.shadows = [[-4.6, 4.6, -2.6, 2.6]];
    for (const [x0, y0, x1, y1] of [[-4, -2, -3.4, -0.7], [-4, 2, -3.4, 0.7], [4.2, 0, 3.6, 0]]) sc.rod([x0, y0, 0], [x1, y1, 4.4], 0.35, wood);
    sc.box(-4.6, 4.6, -1.1, 1.1, 4.4, 5.2, wood, { top: grain(sc, wood, 2) });
    sc.box(-2.4, -1.6, -0.4, 0.4, 5.2, 9.8, wood);
    sc.wheel([-2, 1, 9.4], 'y', 3.8, 0.5, 8, wood);
    sc.rod([-2, 0.4, 9.4], [-2, 1.5, 9.4], 0.3, wood);
    sc.box(3, 3.8, -0.4, 0.4, 5.2, 7.8, wood);
    sc.rod([3.4, 1, 7.4], [5.4, 1, 7.4], 0.12, IRON);
    sc.rod([4, 1, 7.4], [4.9, 1, 7.4], 0.55, LINEN);
    // The drive band, from the rim round the whorl.
    sc.part(-2, 3.6, 0.9, 1.1, 5.4, 13.2, () => {
      for (const zr of [13.2, 5.6]) sc.line(sc.P(-2, 1, zr), sc.P(3.4, 1, zr > 9 ? 7.65 : 7.15), rgb(ROPE.ink, 1, 0.8), sc.ink * 0.7);
    });
    sc.lathe(2.3, -2.4, [[0, 1.3], [1.4, 1.6]], paintOf(hex('#c9a46a')), 12, { staves: 9, cap: paintOf(hex('#f2ece0')) });
  },
  loom: ({ sc, wood, hw, hd }) => {
    const x = hw - 1.4, ys = [-hd + 2.4, -1.2, hd - 4.6], tops = [12.6, 15.2, 8.4];
    const WARP = hex('#f1e8d4'), CLOTH = paintOf(hex('#c0675e'));
    for (let i = 0; i < 3; i++) for (const px of [-x, x]) sc.box(px - 0.5, px + 0.5, ys[i] - 0.5, ys[i] + 0.5, 0, tops[i], wood);
    for (const px of [-x, x]) {
      for (let i = 0; i < 2; i++) {
        sc.box(px - 0.4, px + 0.4, ys[i] + 0.5, ys[i + 1] - 0.5, 7.4, 8.2, wood);
        sc.box(px - 0.4, px + 0.4, ys[i] + 0.5, ys[i + 1] - 0.5, 1, 1.8, wood);
      }
    }
    sc.box(-x - 0.5, x + 0.5, -1.7, -0.7, 15.2, 16, wood);
    // The treadles, on the floor under the front.
    for (const tx of [-1.8, -0.6, 0.6, 1.8]) sc.box(tx - 0.3, tx + 0.3, 0.6, 6.8, 0.2, 0.7, wood);
    // The bench.
    for (const bx of [-4.2, 4.2]) for (const by of [7.2, 8.8]) sc.box(bx - 0.35, bx + 0.35, by - 0.35, by + 0.35, 0, 4, wood);
    sc.box(-5, 5, 6.8, 9.2, 4, 4.6, wood, { top: grain(sc, wood, 2) });
    // Inside the frame, one part, each piece of the works laid in the order it stands from where you are.
    const xi = x - 0.5, yb = ys[0] + 0.6, yh = ys[1], yr = 0.4, yfell = 1.8, yfront = ys[2] - 0.2;
    sc.part(-xi, xi, ys[0], ys[2] + 0.5, 1.8, 15.2, () => {
      const g = sc.g;
      const threads = 22;
      const warpAt = (i: number): number => -xi + 0.9 + (i / (threads - 1)) * (2 * xi - 1.8);
      const works: Array<[number, () => void]> = [
        [sc.depth(0, yb, 9), () => sc.drawRod([-xi, yb, 9], [xi, yb, 9], 1.1, paintOf(WARP))],
        [sc.depth(0, (yb + yfell) / 2, 9), () => {
          g.lineWidth = sc.ink * 0.45;
          g.strokeStyle = rgb(WARP, 0.95);
          for (let i = 0; i < threads; i++) {
            const px = warpAt(i);
            const [a, b, c] = [sc.P(px, yb, 10.1), sc.P(px, yh, 8.8 + (i % 2 ? 0.5 : -0.5)), sc.P(px, yfell, 8.4)];
            g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.stroke();
          }
        }],
        [sc.depth(0, yh, 9), () => {
          for (const z of [11, 6.4]) sc.drawBox(-xi + 0.4, xi - 0.4, yh - 0.25, yh + 0.25, z - 0.3, z + 0.3, wood);
          g.strokeStyle = rgb(IRON.body, 1, 0.6);
          g.lineWidth = sc.ink * 0.4;
          for (let i = 0; i < threads; i++) { const px = warpAt(i); const [a, b] = [sc.P(px, yh, 6.7), sc.P(px, yh, 10.7)]; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
          for (const px of [-4, 4]) sc.line(sc.P(px, yh, 11.3), sc.P(px, yh, 15.2), rgb(ROPE.ink), sc.ink * 0.6);
        }],
        [sc.depth(0, yr, 9), () => {
          for (const px of [-xi + 0.6, xi - 0.6]) sc.drawRod([px, yr, 7.6], [px, yr, 15.2], 0.25, wood);
          sc.drawBox(-xi + 0.3, xi - 0.3, yr - 0.3, yr + 0.3, 11.2, 11.8, wood);
          sc.drawBox(-xi + 0.3, xi - 0.3, yr - 0.35, yr + 0.35, 7.3, 8, wood);
          g.strokeStyle = rgb(wood.ink, 1, 0.4);
          g.lineWidth = sc.ink * 0.4;
          for (let s = -xi + 1; s < xi - 0.8; s += 0.55) { const [a, b] = [sc.P(s, yr, 8), sc.P(s, yr, 11.2)]; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
        }],
        [sc.depth(0, (yfell + yfront) / 2, 8.4), () => {
          sc.drawPanel([[-xi + 0.9, yfell, 8.4], [xi - 0.9, yfell, 8.4], [xi - 0.9, yfront, 8.4], [-xi + 0.9, yfront, 8.4]], CLOTH, (F, k) => {
            for (const u of [0.18, 0.2, 0.5, 0.8, 0.82]) sc.fillInk([F(u, 0), F(u + 0.012, 0), F(u + 0.012, 1), F(u, 1)], rgb(hex('#f0dcc0'), k), CLOTH.ink, 0);
          });
        }],
        [sc.depth(0, yfront - 0.8, 3.4), () => sc.drawRod([-xi, yfront - 0.8, 3.4], [xi, yfront - 0.8, 3.4], 1.2, CLOTH)],
        [sc.depth(0, yfront + 0.2, 8), () => sc.drawBox(-xi, xi, yfront - 0.2, yfront + 0.6, 7.6, 8.4, wood)],
      ];
      works.sort((a, b) => a[0] - b[0]);
      for (const [, draw] of works) draw();
    });
  },

  /*
   * Masonry. The oven is a dome of stone brick on a plinth, a chimney at the
   * back and an arched mouth at the front with a niche for the wood under
   * it; lit, the mouth is full of fire. The brazier is a shallow bowl of
   * brick on a turned foot, banded in iron, holding coals, and a fire over
   * them when it is lit. The altar is a block of coursed brick on a plinth
   * under a slab, a gold sun set into its face, a step to kneel on, a runner
   * down the slab, a gold bowl and two candles. The well is a round kerb of
   * stone with the water deep in it, a windlass on two posts with the rope
   * wound on its drum and the bucket hung over the hole, under a shingled
   * roof.
   */
  oven: ({ sc, lit, frame }) => {
    const niche = (F: FaceAt, w: number, h: number): void => {
      bricks(sc, STONE, 1.25)(F, w, h);
      const c = w / 2, r = 3.4, spring = 1.6;
      const arch: Pt[] = [F(c - r, 0.3), F(c + r, 0.3)];
      for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI; arch.push(F(c + Math.cos(a) * r, spring + Math.sin(a) * (h - spring - 0.6))); }
      sc.fillInk(arch, rgb(hex('#3a2e28')), STONE.ink);
      const END = paintOf(hex('#d8b88a'));
      for (let i = 0; i < 6; i++) sc.fillInk(circleOn(F, c - 2.1 + (i % 3) * 2.1, 1.2 + Math.floor(i / 3) * 1.5, 0.75), rgb(END.body, 0.9 + (i % 2) * 0.08), hex('#6d5236'));
    };
    sc.box(-9, 9, -8.6, 8.6, 0, 5, STONE, { front: niche, back: bricks(sc, STONE, 1.25), left: bricks(sc, STONE, 1.25), right: bricks(sc, STONE, 1.25) });
    sc.lathe(0, -0.8, [[5, 7.6], [6.8, 7.4], [8.6, 6.7], [10.2, 5.4], [11.4, 3.6], [12.1, 1.6], [12.3, 0]], STONE, 24, { cap: null, courses: [6.2, 7.4, 8.6, 9.7, 10.7, 11.5] });
    sc.box(-1.3, 1.3, -7.2, -4.6, 9.2, 15.6, STONE, {
      front: bricks(sc, STONE, 1.2), back: bricks(sc, STONE, 1.2), left: bricks(sc, STONE, 1.2), right: bricks(sc, STONE, 1.2),
      top: (F, w, h) => rectOn(sc, F, 0.45, 0.45, w - 0.45, h - 0.45, rgb(SOOT.body), SOOT.ink),
    });
    sc.box(-3.6, 3.6, 5.2, 8, 5, 11.2, STONE, {
      left: bricks(sc, STONE, 1.2), right: bricks(sc, STONE, 1.2),
      front: (F, w, h) => {
        const c = w / 2, r = 2.3, spring = 3;
        const g = sc.g;
        // Soot up the face over the mouth, from every fire it has had.
        g.fillStyle = 'rgba(40, 32, 30, 0.22)';
        sc.poly([F(c - 2.4, spring), F(c + 2.4, spring), F(c + 1.4, h), F(c - 1.4, h)]);
        g.fill();
        // The arch of wedge-shaped stones round the mouth.
        const ring: Pt[] = [];
        for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI; ring.push(F(c + Math.cos(a) * (r + 0.9), spring + Math.sin(a) * (r + 0.9))); }
        for (let i = 12; i >= 0; i--) { const a = (i / 12) * Math.PI; ring.push(F(c + Math.cos(a) * r, spring + Math.sin(a) * r)); }
        sc.fillInk(ring, rgb(STONE.body, 0.9), STONE.ink);
        g.strokeStyle = rgb(STONE.ink, 1, 0.5);
        g.lineWidth = sc.ink * 0.6;
        for (let i = 1; i < 6; i++) { const a = (i / 6) * Math.PI; const [p, q] = [F(c + Math.cos(a) * r, spring + Math.sin(a) * r), F(c + Math.cos(a) * (r + 0.9), spring + Math.sin(a) * (r + 0.9))]; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); }
        const mouth: Pt[] = [F(c - r, 0.4), F(c + r, 0.4)];
        for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI; mouth.push(F(c + Math.cos(a) * r, spring + Math.sin(a) * r)); }
        sc.fillInk(mouth, lit ? '#b8452a' : '#2b221e', STONE.ink);
        g.save();
        sc.poly(mouth);
        g.clip();
        if (lit) {
          // The fire inside: a bed of coals and the flames standing up off it, whatever the mouth's slant.
          const [bx, by] = F(c, 0.4);
          const [ex] = F(c + r, 0.4);
          const W = Math.abs(ex - bx);
          g.fillStyle = '#ffb04a';
          g.beginPath(); g.ellipse(bx, by, W * 0.9, W * 0.3, 0, 0, TAU); g.fill();
          for (const [dx, hh, col] of [[-0.45, 0.9, '#f28a3c'], [0.4, 1.05, '#f28a3c'], [0, 1.35, '#ffc464'], [-0.05, 0.7, '#fff0c4']] as Array<[number, number, string]>) {
            const f = 0.85 + 0.15 * Math.sin(frame * 1.7 + dx * 9);
            g.fillStyle = col;
            g.beginPath();
            g.moveTo(bx + (dx - 0.35) * W, by);
            g.quadraticCurveTo(bx + dx * W, by - hh * f * W * 1.9, bx + (dx + 0.35) * W, by);
            g.fill();
          }
        } else {
          const [bx, by] = F(c, 0.4);
          const [ex] = F(c + r * 0.7, 0.4);
          g.fillStyle = '#6f6660';
          g.beginPath(); g.ellipse(bx, by, Math.abs(ex - bx), Math.abs(ex - bx) * 0.35, 0, Math.PI, TAU); g.fill();
        }
        g.restore();
      },
      top: bricks(sc, STONE, 1.2),
    });
  },
  brazier: ({ sc, lit, frame }) => {
    sc.shadows = [[-3.8, 3.8, -3.8, 3.8]];
    sc.lathe(0, 0, [[0, 2.4], [0.6, 2.4], [0.9, 1.8], [4.7, 1.35], [5.2, 1.9]], STONE, 16, { courses: [1.9, 2.9, 3.9] });
    const EMBER = paintOf(hex(lit ? '#ff9a44' : '#4a403a'));
    sc.lathe(0, 0, [[5.2, 2.1], [6, 3.5], [7, 4.4], [7.7, 4.6]], STONE, 20, {
      courses: [6.3, 7.1],
      bands: [[5.9, IRON, 0.45], [7.55, IRON, 0.45]],
      cap: EMBER,
      lid: (F) => {
        for (let i = 0; i < 11; i++) {
          const [px, py] = F(i * 2.3, 0.6 + ((i * 7) % 5) * 0.62);
          sc.g.fillStyle = lit ? (i % 3 ? '#ffd27a' : '#c9452e') : i % 2 ? '#2e2724' : '#8a817a';
          sc.g.beginPath(); sc.g.ellipse(px, py, 0.8, 0.5, i, 0, TAU); sc.g.fill();
        }
      },
    });
    if (lit) sc.fire([0, 0, 7.7], 5.6, 7.6, frame);
  },
  altar: ({ sc }) => {
    const SLAB = paintOf(hex('#ece6da')), GOLD = paintOf(hex('#e9c35c'), 0.5), RUNNER = paintOf(hex('#a4473f'));
    sc.box(-8.6, 8.6, -7, 5.6, 0, 1.2, STONE);
    sc.box(-6, 6, 5.6, 8.8, 0, 1.4, STONE, { top: (F, w, h) => rectOn(sc, F, w * 0.25, h * 0.2, w * 0.75, h * 0.8, rgb(RUNNER.body, 1.05), RUNNER.ink, 0.6) });
    const coursed = bricks(sc, STONE, 1.15);
    sc.box(-7.2, 7.2, -5.8, 4.6, 1.2, 8.2, STONE, {
      front: (F, w, h) => {
        coursed(F, w, h);
        // The gold set into the face: a sun, its rays alternately long and short.
        const c = w / 2, t = h * 0.52;
        const rays: Pt[] = [];
        for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU, r = i % 2 ? 1.9 : i % 4 ? 2.5 : 3; rays.push(F(c + Math.cos(a) * r, t + Math.sin(a) * r)); }
        sc.fillInk(rays, rgb(GOLD.body, 0.96), GOLD.ink);
        sc.fillInk(circleOn(F, c, t, 1.35, 16), rgb(GOLD.body, 1.1), GOLD.ink);
      },
      back: coursed, left: coursed, right: coursed,
    });
    sc.box(-8.2, 8.2, -6.6, 5.4, 8.2, 9.4, SLAB, { front: grain(sc, SLAB, 1, true, 0.3) });
    sc.panel([[-2.6, -6.6, 9.42], [2.6, -6.6, 9.42], [2.6, 5.4, 9.42], [-2.6, 5.4, 9.42]], RUNNER, (F, k) => {
      for (const u of [0.1, 0.86]) sc.fillInk([F(u, 0), F(u + 0.04, 0), F(u + 0.04, 1), F(u, 1)], rgb(GOLD.body, k), GOLD.ink, 0);
    });
    sc.panel([[-2.6, 5.45, 9.42], [2.6, 5.45, 9.42], [2.6, 5.45, 7.3], [-2.6, 5.45, 7.3]], RUNNER, (F, k) => {
      for (const u of [0.1, 0.86]) sc.fillInk([F(u, 0), F(u + 0.04, 0), F(u + 0.04, 1), F(u, 1)], rgb(GOLD.body, k), GOLD.ink, 0);
      sc.fillInk([F(0, 0.86), F(1, 0.86), F(1, 1), F(0, 1)], rgb(GOLD.body, k), GOLD.ink, 0.4);
    });
    sc.lathe(0, -3.2, [[9.42, 0.8], [9.8, 0.9], [10.6, 1.6], [10.8, 1.7]], GOLD, 16, { cap: paintOf(hex('#7a5a2a')) });
    for (const cx of [-6.2, 6.2]) {
      sc.lathe(cx, -3.6, [[9.4, 0.8], [9.7, 0.6], [9.9, 0.35]], GOLD, 12);
      sc.lathe(cx, -3.6, [[9.9, 0.38], [12, 0.38]], paintOf(hex('#f7f0dc')), 10, { cap: paintOf(hex('#fbf6e8')) });
      sc.fire([cx, -3.6, 12], 0.8, 1.6, 0);
    }
  },
  well: ({ sc, wood }) => {
    const R = 7.4, zk = 5.4, hole = 5.2;
    sc.lathe(0, 0, [[0, R], [zk - 0.9, R], [zk - 0.9, R + 0.4], [zk, R + 0.4]], STONE, 28, {
      courses: [1.1, 2.2, 3.4],
      lid: () => {
        const g = sc.g;
        const ring = (r: number, z: number): Pt[] => Array.from({ length: 28 }, (_, i) => sc.P(Math.cos((i / 28) * TAU) * r, Math.sin((i / 28) * TAU) * r, z));
        // The coping's top joints, then the hole: the far inside wall going down into the dark, and the water a long way down.
        g.strokeStyle = rgb(STONE.ink, 1, 0.4);
        g.lineWidth = sc.ink * 0.6;
        for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; const [p, q] = [sc.P(Math.cos(a) * hole, Math.sin(a) * hole, zk), sc.P(Math.cos(a) * (R + 0.4), Math.sin(a) * (R + 0.4), zk)]; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); }
        const top = ring(hole, zk);
        sc.poly(top);
        g.fillStyle = '#18222a';
        g.fill();
        g.save();
        sc.poly(top);
        g.clip();
        for (let d = 0; d < 4; d++) {
          const band = [...ring(hole, zk - d * 1.1), ...ring(hole, zk - (d + 1) * 1.1).reverse()];
          sc.poly(band);
          g.fillStyle = rgb(STONE.body, 0.62 - d * 0.14);
          g.fill('evenodd');
        }
        const [wx, wy] = sc.P(0, 0, zk - 5.5);
        g.fillStyle = 'rgba(90, 130, 150, 0.55)';
        g.beginPath(); g.ellipse(wx, wy, hole * 0.7, hole * 0.32, 0, 0, TAU); g.fill();
        g.restore();
        sc.poly(top);
        g.strokeStyle = rgb(STONE.ink);
        g.lineWidth = sc.ink;
        g.stroke();
      },
    });
    for (const px of [-6.4, 6.4]) sc.box(px - 0.5, px + 0.5, -0.5, 0.5, zk, 14.2, wood);
    const za = 11.6;
    sc.rod([-2.8, 0, za], [2.8, 0, za], 1, ROPE);
    for (const [a, b] of [[-5.9, -2.8], [2.8, 5.9], [-7.4, -6.9], [6.9, 7.8]]) sc.rod([a, 0, za], [b, 0, za], 0.35, wood);
    sc.rod([7.9, 0, za], [7.9, 0, za - 2], 0.3, IRON);
    sc.rod([7.9, 0, za - 2], [9.1, 0, za - 2], 0.3, wood);
    sc.rod([0, 1, za], [0, 0.4, 8.7], 0.12, ROPE);
    sc.lathe(0, 0.4, [[6.8, 1.1], [8.4, 1.35]], wood, 12, { staves: 8, bands: [[7.2, IRON, 0.3], [8.1, IRON, 0.3]], cap: paintOf(hex('#6f97a8')) });
    gable(sc, -8.2, 8.2, -4.2, 4.2, 14.2, 17.2, SHINGLE(wood), 'x', wood, 0.9, 4);
  },

  /*
   * Vehicles, built along their width, which is the way they go: the shafts,
   * the pole and the yokes are at the far end of it, and a driver is drawn
   * at the middle. The small cart is a tray on two wheels with a pair of
   * shafts to take hold of. The large cart is a staked box body on two
   * wheels, a bench across it over the axle and a yoke on a pole ahead. The
   * wagon is a long bed on four wheels, smaller at the front, staked and
   * banded, a bench across the middle and two pairs of yokes on its pole.
   */
  cart: ({ sc, wood, hw, hd }) => {
    const L0 = -hw + 1.2, L1 = hw - 5.2, W = hd - 1.6, z0 = 3.6, zb = 4.2, zt = 7, t = 0.5;
    const r = 3.3, ax = -2.4, wy = W + 0.9;
    sc.shadows = [[L0, L1, -W - 1, W + 1]];
    sc.rod([ax, -W + 0.2, r], [ax, W - 0.2, r], 0.35, IRON);
    for (const s of [-1, 1]) sc.wheel([ax, s * wy, r], 'y', r, 0.6, 8, wood);
    sc.box(L0, L1, -W, W, z0, zb, wood);
    const side = (F: FaceAt, w: number, h: number): void => { boardsOn(sc, wood, 3, false)(F, w, h); for (const s of [0.6, w - 1.2]) rectOn(sc, F, s, 0, s + 0.6, h, rgb(IRON.body), IRON.ink); };
    sc.box(L0, L1, -W, -W + t, zb, zt, wood, { front: side, back: side });
    sc.box(L0, L1, W - t, W, zb, zt, wood, { front: side, back: side });
    sc.box(L0, L0 + t, -W + t, W - t, zb, zt, wood, { left: side, right: side });
    sc.box(L1 - t, L1, -W + t, W - t, zb, zt, wood, { left: side, right: side });
    for (const s of [-1, 1]) sc.rod([L1 + 0.4, s * (W - 0.6), z0], [hw - 0.4, s * (W - 1.1), 2], 0.35, wood);
    sc.rod([hw - 0.5, -W + 0.9, 2.05], [hw - 0.5, W - 0.9, 2.05], 0.3, wood);
  },
  large_cart: ({ sc, wood, hw, hd }) => {
    const L0 = -hw + 1, L1 = hw - 6, W = hd - 3, floor = 6.7, t = 0.6, top = floor + 3.4;
    const r = 4.8, ax = -2, wy = W + 1;
    sc.shadows = [[L0, L1, -W - 1.4, W + 1.4]];
    sc.rod([ax, -W + 0.4, r], [ax, W - 0.4, r], 0.45, IRON);
    for (const s of [-1, 1]) sc.wheel([ax, s * wy, r], 'y', r, 0.9, 10, wood);
    for (const s of [-1, 1]) sc.box(L0 + 1, L1 - 1, s * (W - 1.8) - 0.5, s * (W - 1.8) + 0.5, floor - 1.8, floor - 0.8, wood);
    sc.box(L0, L1, -W, W, floor - 0.8, floor, wood, { front: grain(sc, wood, 1), back: grain(sc, wood, 1) });
    const staked = (F: FaceAt, w: number, h: number): void => {
      boardsOn(sc, wood, 3, false)(F, w, h);
      for (let s = 0.4; s < w - 0.5; s += Math.max(3.2, (w - 1) / Math.round((w - 1) / 3.6))) rectOn(sc, F, s, 0, s + 0.7, h, rgb(wood.body, 0.9), wood.ink);
      rectOn(sc, F, 0, h - 0.7, w, h - 0.2, rgb(IRON.body), IRON.ink);
    };
    sc.box(L0, L1, -W, -W + t, floor, top, wood, { front: staked, back: staked });
    sc.box(L0, L1, W - t, W, floor, top, wood, { front: staked, back: staked });
    sc.box(L0, L0 + t, -W + t, W - t, floor, top, wood, { left: staked, right: staked });
    sc.box(L1 - t, L1, -W + t, W - t, floor, top, wood, { left: staked, right: staked });
    for (const s of [-1, 1]) sc.box(-0.6, 0.6, s * (W - 1.6) - 0.5, s * (W - 1.6) + 0.5, floor, 8.8, wood);
    sc.box(-1.2, 1.2, -W + t, W - t, 8.8, 9.4, wood, { top: grain(sc, wood, 2) });
    sc.rod([L1 + 0.2, 0, floor - 1.3], [hw - 0.6, 0, 4.4], 0.5, wood);
    sc.box(hw - 1.6, hw - 0.6, -6.4, 6.4, 4.1, 5, wood);
    for (const s of [-1, 1]) sc.part(hw - 1.4, hw - 0.8, s * 3.6 - 1.6, s * 3.6 + 1.6, 1.8, 4.1, () => {
      const pts: Pt[] = [];
      for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI; pts.push(sc.P(hw - 1.1, s * 3.6 + Math.cos(a) * 1.5, 4.1 - Math.sin(a) * 2.2)); }
      sc.g.lineCap = 'round';
      sc.poly(pts); sc.g.strokeStyle = rgb(wood.ink); sc.g.lineWidth = 1.2 + sc.ink * 2; sc.g.stroke();
      sc.g.strokeStyle = rgb(wood.body, 0.9); sc.g.lineWidth = 1.2; sc.g.stroke();
      sc.g.lineCap = 'butt';
    });
  },
  wagon: ({ sc, wood, hw, hd }) => {
    const L0 = -hw + 1, L1 = hw - 8, W = hd - 5, floor = 8.4, t = 0.7, top = floor + 3.8;
    const wy = W + 1.2, rear = [-12, 5.4] as const, front = [6, 4.4] as const;
    sc.shadows = [[L0, L1, -W - 1.6, W + 1.6]];
    for (const [ax, r] of [rear, front]) {
      sc.rod([ax, -W + 0.4, r], [ax, W - 0.4, r], 0.5, IRON);
      for (const s of [-1, 1]) sc.wheel([ax, s * wy, r], 'y', r, 1, 12, wood);
    }
    sc.box(L0 + 2, L1 - 2, -0.6, 0.6, 4.6, 5.8, wood);
    for (const s of [-1, 1]) sc.box(L0 + 1, L1 - 1, s * (W - 2.2) - 0.6, s * (W - 2.2) + 0.6, floor - 2, floor - 0.9, wood);
    sc.box(L0, L1, -W, W, floor - 0.9, floor, wood, { front: grain(sc, wood, 1), back: grain(sc, wood, 1) });
    const staked = (F: FaceAt, w: number, h: number): void => {
      boardsOn(sc, wood, 3, false)(F, w, h);
      const n = Math.max(2, Math.round((w - 1) / 4.2));
      for (let i = 0; i <= n; i++) { const s = 0.3 + (i * (w - 1.3)) / n; rectOn(sc, F, s, 0, s + 0.7, h, rgb(wood.body, 0.9), wood.ink); }
      for (const tt of [0.5, h - 0.9]) rectOn(sc, F, 0, tt, w, tt + 0.5, rgb(IRON.body), IRON.ink);
    };
    sc.box(L0, L1, -W, -W + t, floor, top, wood, { front: staked, back: staked });
    sc.box(L0, L1, W - t, W, floor, top, wood, { front: staked, back: staked });
    sc.box(L0, L0 + t, -W + t, W - t, floor, top, wood, { left: staked, right: staked });
    sc.box(L1 - t, L1, -W + t, W - t, floor, top, wood, { left: staked, right: staked });
    for (const s of [-1, 1]) sc.box(-0.7, 0.7, s * (W - 2) - 0.6, s * (W - 2) + 0.6, floor, 10.6, wood);
    sc.box(-1.4, 1.4, -W + t, W - t, 10.6, 11.2, wood, { top: grain(sc, wood, 2) });
    sc.rod([L1 + 0.2, 0, 5.2], [hw - 0.4, 0, 4.6], 0.55, wood);
    for (const yx of [L1 + 3.2, hw - 1.2]) {
      sc.box(yx - 0.5, yx + 0.5, -6.6, 6.6, 4.4, 5.3, wood);
      for (const s of [-1, 1]) sc.part(yx - 0.3, yx + 0.3, s * 3.6 - 1.6, s * 3.6 + 1.6, 2.2, 4.4, () => {
        const pts: Pt[] = [];
        for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI; pts.push(sc.P(yx, s * 3.6 + Math.cos(a) * 1.5, 4.4 - Math.sin(a) * 2.1)); }
        sc.g.lineCap = 'round';
        sc.poly(pts); sc.g.strokeStyle = rgb(wood.ink); sc.g.lineWidth = 1.2 + sc.ink * 2; sc.g.stroke();
        sc.g.strokeStyle = rgb(wood.body, 0.9); sc.g.lineWidth = 1.2; sc.g.stroke();
        sc.g.lineCap = 'butt';
      });
    }
  },

  /*
   * Boats, built along their width with the bow at the far end of it, and
   * drawn from the waterline up, since that is all of a hull that shows. The
   * rowing boat is clinker-built, a transom at the stern, two thwarts and the
   * oars shipped along them. The sailing boat is bigger and decked at the
   * bow, with a mast, a gaff sail bent on and a rudder hung off the stern;
   * the sail swings out to leeward and fills as far as `trim` says, which is
   * the wind's side and how hard it is drawing.
   */
  rowing_boat: ({ sc, wood, hw, hd }) => {
    sc.shadows = [];
    const OAR = paintOf(mix(wood.body, [255, 250, 240], 0.2));
    hull(sc, wood, -hw + 1.6, hw - 0.4, hd - 2.2, 3.6, (seat) => {
      for (const tx of [-5.2, 1.8]) seat(tx, 2.4, 0.6);
      // The oars, shipped: looms along the thwarts, blades aft.
      for (const s of [-1, 1]) {
        sc.drawRod([-8.6, s * 2.4, 2.95], [9.4, s * 2, 3.05], 0.26, OAR);
        sc.drawPanel([[-8.6, s * 2.05, 2.98], [-12.2, s * 1.85, 2.98], [-12.2, s * 3.05, 2.98], [-8.6, s * 2.75, 2.98]], OAR);
      }
    });
  },
  sailing_boat: ({ sc, wood, hw, hd, trim, tint }) => {
    sc.shadows = [];
    const xs = -hw + 2.2, xb = hw - 0.4, B = hd - 3.4, S = 5.2;
    const sheer = sheerOf(S);
    const xm = xs + (xb - xs) * 0.6, zb = S + 2.4, zt = 30, luff = 16, boom = 15, gaff = 10;
    const set = trim ?? 0.25;
    // The wind's side is the sign of the trim; the sail goes out on the other side, and fills as far as the size of it says.
    const side = set < 0 ? 1 : -1;
    const swing = 0.12 + Math.abs(set) * 1.05, belly = 0.3 + Math.abs(set) * 1.5;
    const aft = (len: number, z: number, turn = 1): V3 => [xm - Math.cos(swing * turn) * len, side * Math.sin(swing * turn) * len, z];
    const tack: V3 = [xm, 0, zb], clew = aft(boom, zb), throat: V3 = [xm, 0, zb + luff], peak = aft(gaff, zb + luff + gaff * 0.55, 0.9);
    const lee: V3 = [Math.sin(swing), side * Math.cos(swing), 0];
    const SAIL = tint ? paintOf(hex(tint.colour), 0.55) : paintOf(hex('#f1e8d2'));
    const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    hull(sc, wood, xs, xb, B, S, (seat, deck) => {
      for (const tx of [-9, -2.5]) seat(tx, S - 1.4, 0.7);
      deck(0.72);
      sc.drawRod([xm, 0, 0.8], [xm, 0, S + 0.6], 0.45, wood);
      sc.drawRod([xs - 0.6, 0, sheer(0) + 0.6], [xs + 4.4, 0, sheer(0) + 1.2], 0.3, wood);
    }, { reach: boom + belly + 1, top: zt + 1, draw: () => {
      // Stays from the masthead to the stem and down to either side, then the mast and the sail in the order they stand.
      for (const [x, y, z] of [[xb - 0.4, 0, sheer(1)], [xm - 2, B * 0.85, S], [xm - 2, -B * 0.85, S]] as V3[]) {
        sc.line(sc.P(xm, 0, zt - 0.6), sc.P(x, y, z), rgb(ROPE.ink, 1, 0.55), sc.ink * 0.5);
      }
      const n = 6;
      const pt = (u: number, v: number): V3 => {
        const p = lerp(lerp(tack, clew, u), lerp(throat, peak, u), v);
        const o = belly * 4 * u * (1 - u) * (1 - 0.35 * v);
        return [p[0] + lee[0] * o, p[1] + lee[1] * o, p[2]];
      };
      const strips = Array.from({ length: n }, (_, i) => {
        const q: V3[] = [pt(i / n, 0), pt((i + 1) / n, 0), pt((i + 1) / n, 1), pt(i / n, 1)];
        return { q, d: sc.depth((q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2) };
      });
      const mast = (): void => sc.drawRod([xm, 0, S + 0.6], [xm, 0, zt], 0.45, wood);
      const behind = strips.reduce((a, s) => a + s.d, 0) / n > sc.depth(xm, 0);
      if (behind) mast();
      strips.sort((a, b) => a.d - b.d);
      for (const s of strips) sc.drawPanel(s.q, SAIL);
      sc.drawRod(tack, clew, 0.32, wood);
      sc.drawRod(throat, peak, 0.28, wood);
      sc.line(sc.P(clew[0], clew[1], clew[2]), sc.P(xs + 1.2, 0, sheer(0) + 0.4), rgb(ROPE.ink, 1, 0.8), sc.ink * 0.6);
      if (!behind) mast();
    } });
    // The rudder, hung off the transom.
    sc.box(xs - 0.9, xs - 0.3, -0.35, 0.35, 0, sheer(0) + 0.8, wood);
  },

  /*
   * Boards made to be read. What is written on them the renderer puts over
   * them in the world, so all these are is the board: a sign across two
   * posts with a painted border, and a signboard wide enough for a sentence
   * under a little pitched cap to keep the rain off the paint.
   */
  sign: ({ sc, wood }) => {
    sc.shadows = [[-4.6, 4.6, -1.2, 1.4]];
    const BOARD = paintOf(mix(wood.body, [250, 244, 230], 0.28));
    for (const px of [-3.9, 3.9]) {
      sc.box(px - 0.45, px + 0.45, -0.45, 0.45, 0, 11.2, wood);
      sc.lathe(px, 0, [[11.2, 0.45], [11.6, 0.6], [12, 0.25]], wood, 10);
    }
    const face = (F: FaceAt, w: number, h: number): void => {
      boardsOn(sc, BOARD, 3, false)(F, w, h);
      sc.poly([F(0.5, 0.5), F(w - 0.5, 0.5), F(w - 0.5, h - 0.5), F(0.5, h - 0.5)]);
      sc.g.strokeStyle = rgb(hex('#6a8a7a'), 1, 0.9);
      sc.g.lineWidth = sc.ink * 0.9;
      sc.g.stroke();
      for (const s of [0.9, w - 0.9]) for (const t of [1, h - 1]) knob(sc, F, s, t, 0.22, IRON);
    };
    sc.box(-4.6, 4.6, 0.45, 1, 5.8, 10.6, BOARD, { front: face, back: boardsOn(sc, BOARD, 3, false) });
  },
  great_sign: ({ sc, wood, hw }) => {
    const x = hw - 0.8;
    sc.shadows = [[-x, x, -1.4, 1.8]];
    const BOARD = paintOf(mix(wood.body, [250, 244, 230], 0.28));
    for (const px of [-x + 0.4, x - 0.4]) sc.box(px - 0.55, px + 0.55, -0.55, 0.55, 0, 13.6, wood);
    const face = (F: FaceAt, w: number, h: number): void => {
      boardsOn(sc, BOARD, 4, false)(F, w, h);
      sc.poly([F(0.6, 0.6), F(w - 0.6, 0.6), F(w - 0.6, h - 0.6), F(0.6, h - 0.6)]);
      sc.g.strokeStyle = rgb(hex('#6a8a7a'), 1, 0.9);
      sc.g.lineWidth = sc.ink * 0.9;
      sc.g.stroke();
      for (const s of [1, w - 1]) for (const t of [1.1, h - 1.1]) knob(sc, F, s, t, 0.25, IRON);
    };
    sc.box(-x, x, 0.55, 1.15, 7, 13.2, BOARD, { front: face, back: boardsOn(sc, BOARD, 4, false) });
    gable(sc, -x - 0.6, x + 0.6, -1.3, 2.9, 13.6, 14.9, SHINGLE(wood), 'x', undefined, 0, 2);
  },
};

/* ---- sizes, for the renderer ------------------------------------------------ */

/** Half-width and half-depth on screen of a block of subtiles, at zoom one: what a piece's hit box is made from. */
export function furnitureSpan(kind: string): [number, number] {
  const def = furnitureDef(kind);
  const n = def.w + def.h;
  return [n * 6, n * 3];
}

/** Build a piece into a scene: its model, or a plain box for a piece nobody has modelled. */
function build(sc: Scene, kind: string, lit: boolean, tint: Tint | undefined, trim: number | undefined, material: string | undefined, frame: number): void {
  const def = furnitureDef(kind);
  const hw = def.w * 5, hd = def.h * 5;
  const model = MODELS[kind];
  if (model) model({ sc, wood: woodOf(material), hw, hd, lit, tint, trim, frame });
  else sc.box(-hw * 0.7, hw * 0.7, -hd * 0.7, hd * 0.7, 0, 5, woodOf(material));
  // The floor it shades: what the model said, or its footprint drawn in a little.
  sc.shadows ??= [[-hw * 0.78, hw * 0.78, -hd * 0.78, hd * 0.78]];
}

/**
 * How tall a piece stands, in pixels at zoom 1: the top of its hit box, and
 * the line a sign's writing stands over. Measured off the model rather than
 * written down, so a piece is as tall as it is drawn.
 */
export const FURNITURE_HEIGHT: Record<string, number> = Object.fromEntries(FURNITURE.map((f) => {
  const sc = new Scene(null as unknown as CanvasRenderingContext2D, pieceView('s', 0), 1);
  build(sc, f.id, false, undefined, undefined, undefined, 0);
  return [f.id, Math.ceil(Math.max(0, ...sc.parts.map((p) => p.z1)) * HEIGHT_SCALE)];
}));

/* ---- drawing, and keeping what was drawn ------------------------------------ */

/**
 * A piece drawn once onto a canvas of its own and blitted from then on.
 *
 * A piece is a few dozen parts, sorted and each drawn face by face, which is
 * half a millisecond or so; a room full of them every frame is most of a
 * frame. So each is baked the first time it is wanted -- per kind, wood,
 * turn, fire, dye, trim and scale -- and a frame after that costs one
 * `drawImage` a piece.
 */
interface Baked {
  canvas: HTMLCanvasElement;
  /** Where its floor contact is on the canvas, in canvas pixels. */
  ox: number;
  oy: number;
  scale: number;
}

/**
 * The scales a piece is baked at: the first at or above the zoom, so what is
 * on the screen is always drawn down from the canvas and never blown up.
 */
const BAKE_STEPS = [1, 1.5, 2, 3, 4, 5, 6];
/** Pixels of baked pieces kept before the ones drawn least lately are let go: sixty-odd megabytes. */
const BAKED_BUDGET = 16e6;
const baked = new Map<string, Baked>();
let bakedArea = 0;

function bake(kind: string, lit: boolean, tint: Tint | undefined, trim: number | undefined, view: PieceView, material: string | undefined, frame: number, scale: number, zoom: number): Baked {
  const sc = new Scene(null as unknown as CanvasRenderingContext2D, view, zoom);
  build(sc, kind, lit, tint, trim, material, frame);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const take = (x: number, y: number, z: number): void => {
    const [px, py] = sc.P(x, y, z);
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  };
  for (const p of sc.parts) for (const x of [p.x0, p.x1]) for (const y of [p.y0, p.y1]) for (const z of [p.z0, p.z1]) take(x, y, z);
  for (const [a, b, c, d] of sc.shadows ?? []) for (const x of [a, b]) for (const y of [c, d]) take(x, y, 0);
  // Room for the ink round the edge, and for the light a fire throws past its flames.
  const pad = 3 + sc.ink * 2 + (lit ? 16 : 0);
  x0 = Math.floor(x0 - pad); y0 = Math.floor(y0 - pad); x1 = Math.ceil(x1 + pad); y1 = Math.ceil(y1 + pad);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil((x1 - x0) * scale));
  canvas.height = Math.max(1, Math.ceil((y1 - y0) * scale));
  const g = canvas.getContext('2d');
  if (!g) throw new Error('no 2d context');
  g.scale(scale, scale);
  g.translate(-x0, -y0);
  sc.g = g;
  for (const [a, b, c, d] of sc.shadows ?? []) {
    sc.poly([sc.P(a, c, 0), sc.P(b, c, 0), sc.P(b, d, 0), sc.P(a, d, 0)]);
    g.fillStyle = 'rgba(44, 74, 78, 0.17)';
    g.fill();
  }
  sc.flush();
  return { canvas, ox: -x0 * scale, oy: -y0 * scale, scale };
}

/**
 * Draw one piece with its floor contact at (sx, sy), turned as `view` says
 * and built of `material`. A sail's trim is taken to the nearest twentieth,
 * which is finer than the eye can tell a sail by and keeps a boat being
 * sailed from baking a new one every frame.
 */
export function drawFurniture(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, kind: string, lit = false, tint?: Tint, trim?: number, view: PieceView = pieceView('s', 0), material?: string): void {
  const scale = BAKE_STEPS.find((s) => s >= zoom - 1e-3) ?? zoom;
  // The ink is a pixel wide on the screen until the zoom is under one, when it is held at a pixel and so is its own bake.
  const inkZoom = zoom < 0.95 ? Math.round(zoom * 20) / 20 : 1;
  const frame = lit ? Math.floor(performance.now() / 150) % 4 : 0;
  const set = trim === undefined || Number.isInteger(trim) ? trim : Math.round(trim * 20) / 20;
  const key = `${kind}|${material ?? ''}|${lit ? frame : '-'}|${tint?.colour ?? ''}|${set ?? ''}|${view.ux.toFixed(3)},${view.uy.toFixed(3)},${view.vx.toFixed(3)},${view.vy.toFixed(3)}|${scale}|${inkZoom}`;
  let b = baked.get(key);
  if (b) {
    baked.delete(key);
    baked.set(key, b);
  } else {
    b = bake(kind, lit, tint, set, view, material, frame, scale, inkZoom);
    baked.set(key, b);
    bakedArea += b.canvas.width * b.canvas.height;
    for (const [k, old] of baked) {
      if (bakedArea <= BAKED_BUDGET || old === b) break;
      baked.delete(k);
      bakedArea -= old.canvas.width * old.canvas.height;
    }
  }
  const k = zoom / b.scale;
  ctx.drawImage(b.canvas, sx - b.ox * k, sy - b.oy * k, b.canvas.width * k, b.canvas.height * k);
}
