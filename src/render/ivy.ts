/**
 * Ivy and moss on old stone: the pictures `greening.ts` asks for.
 *
 * Painted the way `masonry.ts` paints what grows on a cobblestone wall -- lobes
 * the size of a leaf under a dark olive line, lit from above, in the same
 * greens -- so the ivy a wall grows and the ivy a wall was painted with are
 * the same plant. What is different is the shape. The castle it was asked for
 * off has its ivy in strands: a clump over the coping and a trail of leaves
 * falling from it, each leaf lit on its own, wall showing between the strands;
 * a bushy foot at the ground and a stem climbing out of it; and moss in
 * cushions on the tops of the stones. Never a green film.
 *
 * Every strand is a list of leaves, each with the share of its growth at which
 * it comes (`age`): the clump at the root first, the tip of the trail last. A
 * strand is painted at `STAGES` stages of that growth, each once, the first
 * time a wall asks for it, and blitted onto the face through the face's own
 * turn. How much of a face has greened -- how many strands, and how far down
 * each has got -- is the days since it began (`greenDays`), more on a face
 * turned from the sun and on one beside water.
 */

type Ctx = CanvasRenderingContext2D;
type Rand = () => number;

/** Picture pixels to the metre. A section of wall is four metres by three. */
export const PPM = 64;
/** How many stages of its growth a strand is painted at. */
export const STAGES = 10;

/*
 * The greens, off `masonry.ts`'s growth: a pale crown, a lit green, the shade
 * green, and the dark olive line round every mass, so that grown ivy and
 * painted ivy are one plant. `deep` is under a leaf where the light does not
 * reach; `stem` the vine.
 */
const VEG = { top: '#93d9a2', lit: '#74ba87', shade: '#65957a', pale: '#abe3b5', line: '#4b6c57', deep: '#557f68', stem: '#5d6b4c' };
/** And the moss: a cushion, its underside, and the pale of it in the light. */
export const MOSS = { fill: '#7dad7d', under: '#618f6a', lit: '#a2cd93', line: '#557c61', dark: '#4a7156' };

export function rand(seed: number): Rand {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A number off a position and a salt, the same every time: 0 to 1. */
export function hashOf(a: number, b: number, c: number, salt: number): number {
  let k = (a * 374761393 + b * 668265263 + c * 2147483647 + salt * 1442695041) | 0;
  k = Math.imul(k ^ (k >>> 13), 1274126177);
  k = Math.imul(k ^ (k >>> 16), 2654435761);
  return ((k ^ (k >>> 15)) >>> 0) / 4294967296;
}

const channels = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const hexA = (hex: string, a: number): string => `rgba(${channels(hex).join(',')},${a})`;

const canvas = (w: number, h: number): [HTMLCanvasElement, Ctx] => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return [c, c.getContext('2d') as Ctx];
};

/* ---- the kit ---------------------------------------------------------------- */

/** A leaf, in picture px: where, how big, and at what share of its strand's growth it comes. */
export interface Leaf {
  x: number;
  y: number;
  r: number;
  age: number;
  /** Which way its point hangs, in radians from straight down; ivy leaves hang off the stem whichever way the stem runs. */
  a?: number;
}

/**
 * How much wider than tall a leaf is painted. A wall is seen slantwise, so
 * along it a picture is squeezed to three fifths of its height; a leaf painted
 * round came out a pea standing on end. Painted wide, it lands about round.
 */
const WIDE = 1.35;

function unionPath(g: Ctx, cs: readonly Leaf[], ox: number, oy: number, grow: number, wide = WIDE): void {
  g.beginPath();
  for (const c of cs) {
    const rr = Math.max(0.6, c.r + grow);
    g.moveTo(c.x + ox + rr * wide, c.y + oy);
    g.ellipse(c.x + ox, c.y + oy, rr * wide, rr, 0, 0, Math.PI * 2);
  }
}

/**
 * One ivy leaf as a path: a heart hanging point down off its stalk, turned by
 * `a` and grown by `grow` px all round, painted `WIDE` wide.
 */
function heart(g: Ctx, c: Leaf, grow: number, k = 1, dx = 0, dy = 0): void {
  const r = Math.max(0.8, c.r * k + grow);
  const ca = Math.cos(c.a ?? 0), sa = Math.sin(c.a ?? 0);
  const cx = c.x + c.r * dx, cy = c.y + c.r * dy;
  // A point of the heart in its own frame (x across, y down its length) to the picture.
  const P = (x: number, y: number): [number, number] => [cx + (x * ca - y * sa) * WIDE, cy + x * sa + y * ca];
  const pts: Array<[number, number]> = [
    [0, -0.3], [-0.35, -0.95], [-1.2, -0.6], [-0.95, 0.05], [-0.75, 0.55], [-0.28, 0.8], [0, 1.08],
    [0.28, 0.8], [0.75, 0.55], [0.95, 0.05], [1.2, -0.6], [0.35, -0.95], [0, -0.3],
  ];
  const [x0, y0] = P(pts[0][0] * r, pts[0][1] * r);
  g.moveTo(x0, y0);
  for (let i = 1; i + 2 < pts.length; i += 3) {
    const [ax, ay] = P(pts[i][0] * r, pts[i][1] * r);
    const [bx, by] = P(pts[i + 1][0] * r, pts[i + 1][1] * r);
    const [ex, ey] = P(pts[i + 2][0] * r, pts[i + 2][1] * r);
    g.bezierCurveTo(ax, ay, bx, by, ex, ey);
  }
  g.closePath();
}

/**
 * A run of leaves, painted as ivy is in the pictures: the dark line round the
 * whole of it with a soft edge outside that, and then leaf by leaf, back to
 * front, each in the shade green with its own light up and to the left of it
 * and a pale fleck where the sky catches it, and a fine line down its lower
 * edge where it lies over the leaf behind -- so a strand reads as leaves
 * rather than as a green shape. `lw` is the weight of the line.
 */
function leaves(g: Ctx, cs: readonly Leaf[], lw: number, shadow = true): void {
  if (!cs.length) return;
  const all = (grow: number, fill: string, ox = 0, oy = 0): void => {
    g.beginPath();
    for (const c of cs) heart(g, { ...c, x: c.x + ox, y: c.y + oy }, grow);
    g.fillStyle = fill;
    g.fill();
  };
  // What it throws on the stone behind it: one flat darkening, down and right.
  if (shadow) all(lw * 0.6, 'rgba(96, 90, 72, 0.2)', lw * 1.6, lw * 2);
  all(lw + 1.1, hexA(VEG.line, 0.35));
  all(lw, VEG.line);
  for (const c of cs) {
    g.beginPath();
    heart(g, c, 0);
    g.fillStyle = VEG.deep;
    g.fill();
    g.beginPath();
    heart(g, c, 0, 0.8, -0.14, -0.14);
    g.fillStyle = VEG.shade;
    g.fill();
    g.beginPath();
    heart(g, c, 0, 0.56, -0.26, -0.3);
    g.fillStyle = VEG.lit;
    g.fill();
    if (c.r >= 3) {
      g.beginPath();
      heart(g, c, 0, 0.24, -0.4, -0.5);
      g.fillStyle = VEG.top;
      g.fill();
    }
    // Its lower edge, where it lies over whatever is behind it.
    g.beginPath();
    heart(g, c, 0);
    g.strokeStyle = hexA(VEG.line, 0.7);
    g.lineWidth = Math.max(0.6, lw * 0.45);
    g.stroke();
  }
}

/** The vine the leaves hang off, as far as it has grown: a dark line through `pts` (x, y, age), to `upto`. */
function stem(g: Ctx, pts: ReadonlyArray<readonly [number, number, number]>, upto: number, w: number): void {
  const on = pts.filter((p) => p[2] <= upto);
  if (on.length < 2) return;
  g.beginPath();
  g.moveTo(on[0][0], on[0][1]);
  for (let i = 1; i < on.length; i++) g.lineTo(on[i][0], on[i][1]);
  g.strokeStyle = VEG.stem;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.stroke();
}

/** A small flower on the ivy, four petals round a sand eye under a thin line, the way the hedges carry theirs. */
function flower(g: Ctx, x: number, y: number, r: number, pink: boolean): void {
  const petals: Leaf[] = [
    { x, y: y - r * 0.55, r: r * 0.55, age: 0 }, { x: x - r * 0.55, y, r: r * 0.55, age: 0 },
    { x: x + r * 0.55, y, r: r * 0.55, age: 0 }, { x, y: y + r * 0.55, r: r * 0.55, age: 0 },
  ];
  unionPath(g, petals, 0, 0, 0.9);
  g.fillStyle = VEG.line;
  g.fill();
  unionPath(g, petals, 0, 0, 0);
  g.fillStyle = pink ? '#f3c9cf' : '#f7f3e6';
  g.fill();
  g.beginPath();
  g.arc(x, y, r * 0.26, 0, Math.PI * 2);
  g.fillStyle = '#f0cf8a';
  g.fill();
}

/* ---- strands ------------------------------------------------------------------ */

/**
 * One strand, in metres from its root: `x` along the wall, `y` down it, so a
 * trail falling from the coping runs to plus and a stem climbing from the
 * ground to minus. Leaves are metres here and picture px once painted.
 */
interface Strand {
  leaves: Leaf[];
  stems: Array<Array<[number, number, number]>>;
  flowers: Array<{ x: number; y: number; r: number; pink: boolean; age: number }>;
}

export type StrandKind = 'hang' | 'climb' | 'vine';

/** The strands there are of each kind, by how far each reaches at its fullest, in metres. */
export const STRAND_REACH: Record<StrandKind, number[]> = {
  hang: [0.45, 0.7, 1.0, 1.35, 1.7, 2.05, 2.4],
  climb: [0.6, 0.9, 1.25, 1.6, 2.0, 2.4, 2.75],
  vine: [1.2, 1.8, 2.6],
};

/** A leaf's size at the root of a strand, in metres, and how much it shrinks toward the tip. */
const LEAF = 0.1;

/**
 * One trail of leaves along a wandering stem, from `(x0, y0)` for `len`
 * metres: down the wall for a trail hanging off a clump (`dir` 1), up it for
 * a stem climbing out of one (`dir` -1). The leaves come off it turn about,
 * a pair now and then, smaller and further apart toward the tip, a gap here
 * and there where the stone shows; `lean` is how far it drifts sideways over
 * its length. Each leaf comes at its share of the strand's growth, from `a0`
 * at the root of the trail to `a1` at its tip.
 */
function trail(out: Strand, R: Rand, x0: number, y0: number, dir: 1 | -1, len: number, lean: number, a0: number, a1: number): void {
  const zig = 0.02 + R() * 0.03, freq = 5 + R() * 5, ph = R() * 6.28;
  const pts: Array<[number, number, number]> = [];
  const ageAt = (d: number): number => Math.min(1, a0 + (a1 - a0) * Math.pow(d / len, 0.9));
  let side = R() < 0.5 ? -1 : 1;
  for (let d = 0; d <= len; d += 0.07 + R() * 0.035) {
    const t = d / len;
    const x = x0 + lean * t * t * 0.6 + lean * t * 0.4 + Math.sin(d * freq + ph) * zig * (0.5 + t);
    const y = y0 + dir * d;
    pts.push([x, y, ageAt(d)]);
    if (d > 0.04 && R() < 0.12 && t < 0.9) continue;
    const r = LEAF * (1 - 0.38 * t) * (0.8 + R() * 0.4);
    const w = r * (0.75 + R() * 0.35);
    out.leaves.push({ x: x + side * w, y: y + (R() - 0.5) * 0.03, r, age: ageAt(d) + R() * 0.03, a: -side * (0.35 + R() * 0.55) });
    if (t < 0.75 && R() < 0.42) out.leaves.push({ x: x - side * w * 0.75, y: y + dir * 0.035, r: r * 0.88, age: ageAt(d) + 0.02, a: side * (0.3 + R() * 0.5) });
    side = -side;
  }
  out.stems.push(pts);
}

/**
 * A clump of ivy over the coping and the trails that fall from it: a mound of
 * leaves a good deal wider than any one trail, so the clumps of two strands
 * side by side run into one along the top, and one to three trails out of the
 * bottom of it, the longest in the middle, drifting apart as they fall. The
 * clump comes first; the trails grow down out of it.
 */
function hangStrand(seed: number, reach: number): Strand {
  const R = rand(seed);
  const out: Strand = { leaves: [], stems: [], flowers: [] };
  const lean = (R() - 0.5) * 0.14;
  const crestW = 0.3 + R() * 0.18;
  for (let row = 0; row < 3; row++) {
    const y = -0.17 + row * 0.085;
    const w = crestW * (row === 0 ? 0.66 : row === 1 ? 1 : 0.82);
    const n = Math.max(2, Math.round((2 * w) / (LEAF * 1.2)));
    for (let i = 0; i <= n; i++) {
      if (row === 0 && R() < 0.3) continue;
      const u = n ? i / n : 0.5;
      const x = lean * (1 - row / 2) - w + 2 * w * u + (R() - 0.5) * LEAF * 0.6;
      const edge = Math.abs(u - 0.5) * 2;
      out.leaves.push({ x, y: y + (R() - 0.5) * LEAF * 0.6, r: LEAF * (0.85 + R() * 0.45), age: Math.min(0.3, 0.03 + edge * 0.18 + row * 0.03 + R() * 0.05), a: (u - 0.5) * -1.4 + (R() - 0.5) * 0.9 });
    }
  }
  const trails = reach < 0.7 ? 1 : reach < 1.3 ? 2 : 2 + (R() < 0.6 ? 1 : 0);
  for (let k = 0; k < trails; k++) {
    const off = trails === 1 ? 0 : (k / (trails - 1) - 0.5) * crestW * 1.1;
    const len = reach * (k === Math.floor(trails / 2) ? 1 : 0.5 + R() * 0.4);
    trail(out, R, lean + off + (R() - 0.5) * 0.06, 0.02, 1, len, off * 0.5 + (R() - 0.5) * 0.25, 0.15, 1);
  }
  if (reach > 0.9 && R() < 0.45) out.flowers.push({ x: lean + (R() - 0.5) * crestW, y: reach * (0.25 + R() * 0.4), r: 0.055, pink: R() < 0.25, age: 0.75 });
  return out;
}

/**
 * Ivy climbing from the foot: a low clump where it roots, and a fan of stems
 * out of it -- the tallest near the middle, the others leaning away -- that
 * thin out to single leaves at their tips. The clump comes first.
 */
function climbStrand(seed: number, reach: number): Strand {
  const R = rand(seed);
  const out: Strand = { leaves: [], stems: [], flowers: [] };
  const baseW = 0.2 + R() * 0.12, baseH = Math.min(reach * 0.25, 0.14 + R() * 0.1);
  for (let y = 0; y <= baseH; y += 0.07) {
    const t = y / baseH;
    const w = baseW * (1 - 0.5 * Math.pow(t, 1.3)) * (0.9 + R() * 0.2);
    const n = Math.max(1, Math.round((2 * w) / (LEAF * 1.2)));
    for (let i = 0; i <= n; i++) {
      if (t > 0.5 && R() < 0.35) continue;
      const u = n ? i / n : 0.5;
      out.leaves.push({ x: -w + 2 * w * u + (R() - 0.5) * LEAF * 0.4, y: -y + (R() - 0.5) * 0.03, r: LEAF * (0.95 + R() * 0.35), age: Math.min(0.25, 0.02 + t * 0.14 + Math.abs(u - 0.5) * 0.08 + R() * 0.04), a: (u - 0.5) * -1.6 + (R() - 0.5) * 0.8 });
    }
  }
  const stems = reach < 0.8 ? 1 : reach < 1.5 ? 2 : 2 + (R() < 0.65 ? 1 : 0);
  for (let k = 0; k < stems; k++) {
    const dirn = stems === 1 ? 0 : k / (stems - 1) - 0.5;
    const len = (reach - baseH * 0.5) * (Math.abs(dirn) < 0.2 ? 1 : 0.55 + R() * 0.35);
    trail(out, R, dirn * baseW * 0.8 + (R() - 0.5) * 0.05, -baseH * 0.5, -1, len, dirn * (0.5 + R() * 0.5) + (R() - 0.5) * 0.15, 0.18, 1);
  }
  if (reach > 1 && R() < 0.35) out.flowers.push({ x: (R() - 0.5) * baseW, y: -reach * (0.35 + R() * 0.3), r: 0.05, pink: R() < 0.25, age: 0.75 });
  return out;
}

/** Ivy carried on up a storey from the one below: stems from the bottom edge, leaves along them, no clump. */
function vineStrand(seed: number, reach: number): Strand {
  const R = rand(seed);
  const out: Strand = { leaves: [], stems: [], flowers: [] };
  const stems = 1 + (R() < 0.5 ? 1 : 0);
  for (let k = 0; k < stems; k++) trail(out, R, (k - (stems - 1) / 2) * 0.2, 0, -1, reach * (k ? 0.7 : 1), (R() - 0.5) * 0.4, 0, 1);
  return out;
}

/** A strand's picture at a stage: what it is painted on, and where its root is in it, in px. */
export interface StrandPic { img: HTMLCanvasElement; ax: number; ay: number }

const pics = new Map<string, StrandPic | null>();

/** The seed every strand of a kind and reach is grown from. */
const strandSeed = (kind: StrandKind, v: number): number => (kind === 'hang' ? 7919 : kind === 'climb' ? 104729 : 1299709) + v * 7727;

/**
 * A strand of `kind`, the `v`th of its reaches, at `stage` of `STAGES`: painted
 * once and kept. Null for nothing grown yet.
 */
export function strandPic(kind: StrandKind, v: number, stage: number, bloom: boolean): StrandPic | null {
  if (stage <= 0) return null;
  const key = `${kind}:${v}:${stage}:${bloom ? 1 : 0}`;
  const had = pics.get(key);
  if (had !== undefined) return had;
  const reach = STRAND_REACH[kind][v];
  const seed = strandSeed(kind, v);
  const s = kind === 'hang' ? hangStrand(seed, reach) : kind === 'climb' ? climbStrand(seed, reach) : vineStrand(seed, reach);
  const upto = stage / STAGES;
  const on = s.leaves.filter((l) => l.age <= upto + 1e-9);
  if (!on.length) {
    pics.set(key, null);
    return null;
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const l of on) {
    x0 = Math.min(x0, l.x - l.r); x1 = Math.max(x1, l.x + l.r);
    y0 = Math.min(y0, l.y - l.r); y1 = Math.max(y1, l.y + l.r);
  }
  const pad = 6;
  const [img, g] = canvas((x1 - x0) * PPM + 2 * pad, (y1 - y0) * PPM + 2 * pad);
  const ax = -x0 * PPM + pad, ay = -y0 * PPM + pad;
  const px = (l: Leaf): Leaf => ({ x: ax + l.x * PPM, y: ay + l.y * PPM, r: l.r * PPM, age: l.age });
  for (const st of s.stems) stem(g, st.map(([x, y, a]) => [ax + x * PPM, ay + y * PPM, a] as [number, number, number]), upto, 1.6);
  leaves(g, on.map(px), 1.5);
  if (bloom) for (const f of s.flowers) if (f.age <= upto) flower(g, ax + f.x * PPM, ay + f.y * PPM, f.r * PPM, f.pink);
  const pic = { img, ax, ay };
  pics.set(key, pic);
  return pic;
}

/* ---- where the strands go on a face -------------------------------------------- */

/** A hole in a face that ivy keeps out of, in the face's own shares: along it `t0` to `t1`, up it `k0` to `k1`. */
export interface Keep { t0: number; t1: number; k0: number; k1: number }

/** What a face is, for laying ivy on it. */
export interface IvyFace {
  /** A number off where the face is and which side of its wall, so every face grows its own. */
  seed: number;
  /** How far on it has greened, nought to one: the days, and the face's lie. */
  grown: number;
  /**
   * How strongly ivy takes on this stretch of wall, nought to one: a slow
   * swell along the run of it (`vigour`), so it comes in heavy clumps with
   * bare stone between rather than a tuft to every section.
   */
  vigour: number;
  /** How much it is turned from the sun, nought to one, and how near water it stands. */
  shade: number;
  wet: number;
  /** How tall it stands, in metres. */
  height: number;
  /** Whether ivy may hang from its head (nothing stands on it), climb from its foot (it meets the ground), or climb on up from below. */
  top: boolean;
  ground: boolean;
  below: boolean;
  /** Openings, and a gate's gap. */
  keep: Keep[];
}

/** One strand laid on a face: which, where along it, and how far grown. */
export interface IvyStrand { kind: StrandKind; v: number; t: number; stage: number }

/** Half a strand's width at its widest, as a share of a four-metre section: what an opening is kept clear of. */
const HALF_T: Record<StrandKind, number> = { hang: 0.09, climb: 0.07, vine: 0.05 };

/**
 * A slow swell over the ground, nought to one, the same for every wall at a
 * place: value noise a few tiles across. Where it is high a run of wall is
 * heavy with ivy and where it is low it is bare, and neighbouring sections
 * agree, so the clumps run over the joints between them.
 */
export function vigour(x: number, y: number): number {
  const f = 0.3;
  const X = x * f, Y = y * f;
  const ix = Math.floor(X), iy = Math.floor(Y);
  const fx = X - ix, fy = Y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hashOf(ix, iy, 0, 71), b = hashOf(ix + 1, iy, 0, 71), c = hashOf(ix, iy + 1, 0, 71), d = hashOf(ix + 1, iy + 1, 0, 71);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * The strands a face carries, grown as far as it has greened.
 *
 * How many is how strongly ivy takes on this stretch (`vigour`), more on a
 * face turned from the sun or by water; they stand together round one place
 * on the face, the middle one first and the outer ones after, so a wall
 * greens by one clump spreading rather than by a tuft appearing on every
 * section. The same slots at every age, off the face's own seed. A strand
 * that would reach into an opening takes a shorter one, or none.
 */
export function ivyLayout(f: IvyFace): IvyStrand[] {
  const R = rand(f.seed);
  const out: IvyStrand[] = [];
  const low = f.height < 2.2;
  const density = Math.max(0, Math.min(1, -0.55 + 2.1 * f.vigour + 0.3 * f.shade + 0.25 * f.wet));
  const n = Math.round(density * (low ? 4 : 5) + (R() - 0.5) * 1.2);
  if (n <= 0) return out;
  // Heavy ivy spreads along the section into the next, so a strong run is one mass rather than a tuft a section.
  const spread = ((low ? 0.15 : 0.13) + R() * 0.05) * (0.7 + 0.9 * density);
  const centre = 0.18 + R() * 0.64;
  // Stronger ivy reaches further, whatever the face.
  const reachLean = 0.45 + 0.55 * density;
  for (let i = 0; i < n; i++) {
    const rank = Math.abs(i - (n - 1) / 2) / Math.max(1, n / 2);
    const t = Math.max(0.07, Math.min(0.93, centre + (i - (n - 1) / 2) * spread + (R() - 0.5) * 0.05));
    const pick = R();
    // The middle of a clump first, the outside of it later, and a weak one later still.
    const birth = Math.min(0.85, rank * 0.45 + R() * 0.12 + (1 - density) * 0.2);
    const len = R();
    let kind: StrandKind | null = null;
    if (f.top && f.ground) kind = (i + (pick < 0.5 ? 0 : 1)) % 2 === 0 ? 'hang' : 'climb';
    else if (f.top) kind = 'hang';
    else if (f.ground) kind = 'climb';
    else if (f.below) kind = pick < 0.4 ? 'vine' : null;
    if (!kind || f.grown <= birth) continue;
    // How far it may reach: the face, less anything in its way.
    const hw = HALF_T[kind];
    let room = kind === 'hang' ? f.height * (low ? 0.75 : 0.85) : f.height * (low ? 0.8 : 0.95);
    let blocked = false;
    for (const k of f.keep) {
      if (t + hw < k.t0 || t - hw > k.t1) continue;
      if (kind === 'hang') room = Math.min(room, (1 - k.k1) * f.height - 0.05);
      else if (k.k0 <= 0.02) blocked = true;
      else room = Math.min(room, k.k0 * f.height - 0.08);
    }
    if (blocked) continue;
    const reaches = STRAND_REACH[kind];
    const fit = reaches.map((r, v) => ({ r, v })).filter((x) => x.r <= room);
    if (!fit.length) continue;
    const lean = Math.min(0.999, Math.max(0, reachLean + (len - 0.5) * 0.5 - rank * 0.25));
    const v = fit[Math.min(fit.length - 1, Math.floor(lean * fit.length))].v;
    const grown = Math.min(1, (f.grown - birth) / Math.max(0.05, 1 - birth));
    const stage = Math.max(1, Math.round(grown * STAGES));
    out.push({ kind, v, t, stage });
  }
  return out;
}

/* ---- moss in the joints of paving ------------------------------------------------- */

/** How many stages paving's moss is painted at: one every two days of a fortnight. */
export const PAVE_STAGES = 7;
/** Moss picture pixels to a tile: half what the paving is painted at, which is still more than a tile is on the screen at zoom two. */
const MOSS_PPT = 128;

/** Where a paving's joints are, in the sheet its pictures were cut from: x, y, and how dark against the stone round it, as triples. */
interface Joints { n: number; tile: number; pts: Float32Array }
const joints = new WeakMap<HTMLCanvasElement, Joints>();
const mossSets = new Map<string, HTMLCanvasElement[]>();
const setIds = new WeakMap<HTMLCanvasElement, number>();
let nextSet = 1;

/** A box mean over a grid that wraps, `r` cells each way: the stone round a point. */
function boxWrap(L: Float32Array, W: number, r: number): Float32Array {
  const tmp = new Float32Array(W * W), out = new Float32Array(W * W);
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < W; y++) {
    let s = 0;
    for (let d = -r; d <= r; d++) s += L[y * W + ((d % W) + W) % W];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = s * k;
      s += L[y * W + ((x + r + 1) % W)] - L[y * W + (((x - r) % W) + W) % W];
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let d = -r; d <= r; d++) s += tmp[(((d % W) + W) % W) * W + x];
    for (let y = 0; y < W; y++) {
      out[y * W + x] = s * k;
      s += tmp[((y + r + 1) % W) * W + x] - tmp[(((y - r) % W) + W) % W * W + x];
    }
  }
  return out;
}

/**
 * Where a paving's joints are.
 *
 * Its pictures are put back into the sheet they were cut from, `n` by `n`,
 * and every point a good deal darker than the stone round it is a joint: the
 * pictures are light and shade for `overlay`, so a joint is the dark between
 * two lit stones whatever the stone is, sett or flag. Worked out once a
 * paving, off the pictures themselves, so moss finds the joints of any
 * paving there is or ever will be without being told where they are.
 */
function jointsOf(tiles: readonly HTMLCanvasElement[], n: number): Joints {
  const had = joints.get(tiles[0]);
  if (had) return had;
  const T = tiles[0].width, S = T * n;
  const [, g] = canvas(S, S);
  tiles.forEach((t, i) => g.drawImage(t, (i % n) * T, Math.floor(i / n) * T));
  const d = g.getImageData(0, 0, S, S).data;
  const q = 2, W = S / q;
  const L = new Float32Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const i = (y * q * S + x * q) * 4;
    L[y * W + x] = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
  }
  const mean = boxWrap(L, W, 4);
  const R = rand(S * 7 + n);
  const pts: number[] = [];
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const s = (mean[y * W + x] - L[y * W + x]) / 22;
    if (s < 0.8 || R() > 0.3) continue;
    pts.push((x + R()) * q, (y + R()) * q, Math.min(1, s));
  }
  const out = { n, tile: T, pts: Float32Array.from(pts) };
  joints.set(tiles[0], out);
  return out;
}

/** Value noise over a torus `P` cells round, so what it lays over a sheet that wraps wraps with it: nought to one. */
function wrapNoise(x: number, y: number, P: number, salt: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number): number => hashOf(((a % P) + P) % P, ((b % P) + P) % P, P, salt);
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), e = h(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v;
}

/** A cushion of moss: where, and how big, in moss picture px. */
export type Cushion = [number, number, number];

/**
 * Cushions of moss, painted: its underside a step down, the body over it, and
 * a fleck of the light on the bigger ones -- no line round them, since moss
 * sits in the stone rather than on it. Every cushion is laid again a sheet
 * over wherever it comes near an edge (`wrap`), so a sheet cut into tiles
 * joins across them.
 */
export function cushions(g: Ctx, cs: readonly Cushion[], wrap = 0): void {
  const offs = wrap ? [-wrap, 0, wrap] : [0];
  const pass = (fill: string, k: number, dx: number, dy: number, min = 0): void => {
    g.beginPath();
    for (const [x, y, r] of cs) {
      if (r < min) continue;
      for (const ox of offs) for (const oy of offs) {
        if (wrap && (x + ox < -r * 2 || x + ox > wrap + r * 2 || y + oy < -r * 2 || y + oy > wrap + r * 2)) continue;
        const cx = x + ox + r * dx, cy = y + oy + r * dy, rr = r * k;
        g.moveTo(cx + rr, cy);
        g.arc(cx, cy, rr, 0, Math.PI * 2);
      }
    }
    g.fillStyle = fill;
    g.fill();
  };
  pass(MOSS.dark, 1.1, 0.1, 0.35);
  pass(MOSS.under, 1, 0, 0.12);
  pass(MOSS.fill, 0.86, -0.08, -0.1);
  pass(MOSS.lit, 0.42, -0.3, -0.36, 1.6);
}

/**
 * Moss in the joints of a paving, at `stage` of `PAVE_STAGES`: one picture a
 * tile, cut from a sheet the way the paving's own are, to be laid over the
 * same tile as the paving picture of the same index.
 *
 * It comes in patches -- noise over the sheet, the same patches at every
 * stage, so they spread rather than moving -- and a cushion swells as it
 * ages, so an old joint is full of it and a young one has specks.
 */
export function pavingMoss(tiles: readonly HTMLCanvasElement[], n: number, stage: number): HTMLCanvasElement[] | null {
  if (stage <= 0) return null;
  let id = setIds.get(tiles[0]);
  if (id === undefined) {
    id = nextSet++;
    setIds.set(tiles[0], id);
  }
  const key = `${id}:${Math.min(stage, PAVE_STAGES)}`;
  const had = mossSets.get(key);
  if (had) return had;
  const J = jointsOf(tiles, n);
  const upto = Math.min(stage, PAVE_STAGES) / PAVE_STAGES;
  const k = MOSS_PPT / J.tile, S = MOSS_PPT * n, P = Math.max(2, Math.round(n * 1.4));
  /*
   * Where it can be at all is a patch: smooth noise over the sheet, the same
   * patches at every stage, which open out as it ages until about half the
   * paving is in one -- and half of it never is, however old the road. In a
   * patch a cushion is bigger toward its middle and a speck at its edge, and
   * bigger where joints meet, which is where the dark is deepest.
   */
  const cover = 0.5 * Math.pow(upto, 0.75);
  const cs: Cushion[] = [];
  for (let i = 0; i < J.pts.length; i += 3) {
    const x = J.pts[i], y = J.pts[i + 1], s = J.pts[i + 2];
    const patch = wrapNoise((x / (J.tile * n)) * P, (y / (J.tile * n)) * P, P, 13) + 0.16 * hashOf(x | 0, y | 0, n, 29);
    if (patch >= cover) continue;
    const deep = Math.min(1, (cover - patch) / 0.14);
    if (deep < 0.35 && s < 0.7) continue;
    cs.push([x * k, y * k, (0.8 + 1.3 * deep) * (0.7 + 0.35 * s)]);
  }
  const [sheet, g] = canvas(S, S);
  cushions(g, cs, S);
  const out: HTMLCanvasElement[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const [c, cg] = canvas(MOSS_PPT, MOSS_PPT);
      cg.drawImage(sheet, -i * MOSS_PPT, -j * MOSS_PPT);
      out.push(c);
    }
  }
  mossSets.set(key, out);
  return out;
}

/* ---- moss on a poured slab ----------------------------------------------------------- */

/** The strips of moss a face of a slab carries: along its foot, and along its top edge. */
export type MossStrip = 'foot' | 'lip';
/** How tall each is painted, in metres: the foot's cushions climb, the lip's hang. */
export const STRIP_TALL: Record<MossStrip, number> = { foot: 0.9, lip: 0.45 };
const strips = new Map<string, HTMLCanvasElement | null>();

/**
 * Moss along a four-metre face, at `stage` of `PAVE_STAGES`: along its foot a
 * run of cushions in clumps that climb higher where the clump is heaviest, or
 * along its top edge a row of cushions on the arris with a few hanging over
 * it and a dark streak of damp run down from under each clump. Clumped by
 * noise along the face, the same clumps at every stage, so it spreads rather
 * than moving; `v` is which of three runs it is. Four metres to 256 px.
 */
export function mossStrip(kind: MossStrip, v: number, stage: number): HTMLCanvasElement | null {
  if (stage <= 0) return null;
  const key = `${kind}:${v}:${stage}`;
  const had = strips.get(key);
  if (had !== undefined) return had;
  const W = 4 * PPM, H = Math.ceil(STRIP_TALL[kind] * PPM);
  const upto = Math.min(stage, PAVE_STAGES) / PAVE_STAGES;
  const [c, g] = canvas(W, H);
  const cs: Cushion[] = [];
  const cover = 0.62 * Math.pow(upto, 0.8);
  for (let x = 3; x < W - 3; x += 3.2) {
    const clump = wrapNoise((x / W) * 5, v * 3.7, 5, 41 + v) + 0.12 * hashOf(x | 0, v, stage, 43);
    if (clump >= cover) continue;
    const deep = Math.min(1, (cover - clump) / 0.2);
    if (kind === 'foot') {
      // Up from the ground in a low rounded band, higher in the heart of a clump.
      const rise = (0.1 + 0.42 * deep * upto) * H;
      for (let y = H - 2.5; y > H - rise; y -= 4.2) {
        const t = (H - y) / Math.max(1, rise);
        if (hashOf(x | 0, y | 0, v, 47) > 0.85 - 0.35 * t) continue;
        cs.push([x + (hashOf(x | 0, y | 0, v, 53) - 0.5) * 5, y, (2.6 + 2.2 * deep) * (1 - 0.3 * t)]);
      }
    } else {
      cs.push([x, 3 + hashOf(x | 0, v, 1, 59) * 3, 2.2 + 2.4 * deep]);
      if (deep > 0.55 && hashOf(x | 0, v, 2, 59) < 0.4) cs.push([x, 7 + deep * 8, 1.8 + 1.4 * deep]);
    }
  }
  if (!cs.length) {
    strips.set(key, null);
    return null;
  }
  if (kind === 'lip') {
    // The damp run down from under the heaviest of it, faint and straight down.
    for (const [x, y, r] of cs) {
      if (r < 3.4) continue;
      const grad = g.createLinearGradient(0, y, 0, H);
      grad.addColorStop(0, hexA(MOSS.dark, 0.3));
      grad.addColorStop(1, hexA(MOSS.dark, 0));
      g.fillStyle = grad;
      g.fillRect(x - r * 0.6, y, r * 1.2, H - y);
    }
  }
  cushions(g, cs);
  strips.set(key, c);
  return c;
}

const slabTops = new Map<number, HTMLCanvasElement | null>();

/**
 * Moss on the top of a slab left as it was poured, at `stage` of
 * `PAVE_STAGES`: in the margin tooled round its edge and in a pit or two,
 * clumped as the paving's is. One tile at `MOSS_PPT`, to be laid over the
 * top as the paving's moss is.
 */
export function slabTopMoss(stage: number): HTMLCanvasElement | null {
  if (stage <= 0) return null;
  const had = slabTops.get(stage);
  if (had !== undefined) return had;
  const S = MOSS_PPT, m = 7;
  const upto = Math.min(stage, PAVE_STAGES) / PAVE_STAGES;
  const cover = 0.55 * Math.pow(upto, 0.8);
  const cs: Cushion[] = [];
  for (let u = 3; u < S - 3; u += 3) {
    for (const [x, y, e] of [[u, m, 0], [u, S - m, 1], [m, u, 2], [S - m, u, 3]] as Array<[number, number, number]>) {
      const clump = wrapNoise((u / S) * 4, e * 1.3, 4, 61) + 0.14 * hashOf(u, e, 0, 67);
      if (clump >= cover) continue;
      const deep = Math.min(1, (cover - clump) / 0.18);
      cs.push([x + (hashOf(u, e, 1, 67) - 0.5) * 2, y + (hashOf(u, e, 2, 67) - 0.5) * 2, 1.2 + 1.8 * deep]);
    }
  }
  const [c, g] = canvas(S, S);
  cushions(g, cs);
  const out = cs.length ? c : null;
  slabTops.set(stage, out);
  return out;
}

/* ---- moss on a coping ------------------------------------------------------------------ */

/** A coping's picture: four metres along to `CAP_W` px, front edge to back edge to `CAP_D` px, whatever the wall's thickness. */
export const CAP_W = 4 * PPM;
export const CAP_D = 32;
const caps = new Map<string, HTMLCanvasElement | null>();

/**
 * Moss along the top of a wall, at `stage` of `PAVE_STAGES`: cushions in
 * clumps along the coping, down its middle and on its front edge, the same
 * clumps at every stage so they spread rather than move. `v` is which of
 * three runs it is.
 */
export function capMoss(v: number, stage: number): HTMLCanvasElement | null {
  if (stage <= 0) return null;
  const key = `${v}:${stage}`;
  const had = caps.get(key);
  if (had !== undefined) return had;
  const upto = Math.min(stage, PAVE_STAGES) / PAVE_STAGES;
  const cover = 0.58 * Math.pow(upto, 0.8);
  const cs: Cushion[] = [];
  for (let x = 4; x < CAP_W - 4; x += 4.5) {
    const clump = wrapNoise((x / CAP_W) * 3, v * 2.9, 3, 91 + v) + 0.14 * hashOf(x | 0, v, 0, 97);
    if (clump >= cover) continue;
    const deep = Math.min(1, (cover - clump) / 0.2);
    cs.push([x + (hashOf(x | 0, v, 1, 97) - 0.5) * 3, CAP_D * (0.35 + 0.35 * hashOf(x | 0, v, 2, 97)), 3 + 3.5 * deep]);
    if (deep > 0.5 && hashOf(x | 0, v, 3, 97) < 0.5) cs.push([x, CAP_D * 0.12, 2.5 + 2 * deep]);
  }
  if (!cs.length) {
    caps.set(key, null);
    return null;
  }
  const [c, g] = canvas(CAP_W, CAP_D);
  cushions(g, cs);
  caps.set(key, c);
  return c;
}
