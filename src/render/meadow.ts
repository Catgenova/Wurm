import { hash2 } from '../world/noise';

/**
 * The meadow: what grass is made of.
 *
 * Grass was a flat lozenge of one green with fourteen specks thrown at it,
 * and it is sixty per cent of what anybody looks at. Next to a painted wall
 * or a cobbled road it was the weakest surface in the game.
 *
 * It is built in two layers.
 *
 * The **sward** is the ground itself: one picture, three tiles by three, laid
 * across the whole field as a repeating pattern hung off the world's own axes
 * rather than blitted onto a tile at a time. It is black and white at a tenth
 * of an alpha and nothing else -- the same thing the fourteen speckles it
 * replaces always were -- so the tile keeps its own green, the hour's sun,
 * the slope it lies on and the grey of land you only remember.
 *
 * It is a pattern and not nine hundred little blits because nine hundred
 * little blits, each one sheared onto a rhombus, was the whole cost of this:
 * sixteen milliseconds of a frame, against two for everything else here put
 * together. One fill a row draws the lot.
 *
 * The **blobs** are what grows in it, and they are the only thing that does.
 * There were tufts of blade grass and daisies and buttercups and dandelion
 * clocks and pebbles, and the whole of that went: a meadow drawn from
 * standing height is not a botany plate, it is lumps of green in grass. So
 * they are lumps of green -- built out of lobes with an outline round them,
 * a lighter green shifted up into the light and a pale crown on the top of
 * it, which is the same language the ivy on the walls is drawn in, at a
 * twentieth of the size.
 *
 * Which of the ten a tile is comes out of where it is and nothing else: a
 * slow noise over the map so that the bigger clumps come in drifts, with
 * three tiles in ten jumping to a neighbouring look so the drifts have ragged
 * edges. Nothing is stored, nothing is sent, and two people standing on the
 * same tile see the same grass.
 */

type Ctx = CanvasRenderingContext2D;
type Rand = () => number;
/** A lobe: where it is and how big, which is all a mass of them ever needs. */
type Lobe = [number, number, number];

/** A little painted thing, and where it is rooted in its own picture. */
export interface Sprig {
  canvas: HTMLCanvasElement;
  /** Drawn size at zoom 1, in screen pixels. */
  w: number;
  h: number;
  /** The root, in the same units: the point that lands where the thing stands. */
  ax: number;
  ay: number;
}

/** One of the ten: which blobs it grows and how many. */
export interface Look {
  name: string;
  /** What a turn sheet should be able to find it by. */
  tells: string;
  blobs: readonly number[];
  blobN: readonly [number, number];
}

export interface Meadow {
  /** The ground, as one seamless picture to be laid down the world's own axes. */
  sward: HTMLCanvasElement;
  /** How many tiles across it runs, which is what the pattern is scaled by. */
  swardTiles: number;
  /** And how many pixels to a tile in it. */
  swardTile: number;
  blobs: Sprig[];
  looks: Look[];
}

/* ---- the paints ---------------------------------------------------------- */

/**
 * Three greens, each of them four tones: the line round the outside, the body,
 * the lighter side turned into the sun, and the pale crown on the top of it.
 * The same four the ivy on a wall is built from, because a clump of grass seen
 * from here and a clump of ivy seen from here are the same kind of thing.
 */
interface Green { line: string; shade: string; lit: string; top: string }
const DEEP: Green = { line: '#4a6b39', shade: '#7eab62', lit: '#92be6b', top: '#b0d487' };
const MID: Green = { line: '#577c40', shade: '#97c16c', lit: '#acd17a', top: '#cbe497' };
const PALE: Green = { line: '#688a4c', shade: '#b0d081', lit: '#c0dd91', top: '#ddf0b0' };

/* ---- the machinery ------------------------------------------------------- */

const cnv = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
};
const ctxOf = (c: HTMLCanvasElement): Ctx => c.getContext('2d') as Ctx;

/** The same sequence every time, on every machine, from one number. */
function rand(seed: number): Rand {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How big a blob is painted against how big it is drawn.
 *
 * A tile is ninety-six pixels across at zoom one, so a clump half a metre
 * wide is twelve pixels. Painting at that size would give it nothing to be
 * made of, so everything is painted three times over and told its real size,
 * and the browser takes it down -- which also means it is still a clump of
 * lobes at the zoom somebody leans in at.
 */
const SCALE = 3;

/** A blob, painted at `SCALE` and measured at one. */
function sprig(w: number, h: number, ax: number, ay: number, paint: (g: Ctx) => void): Sprig {
  const c = cnv(w * SCALE, h * SCALE);
  const g = ctxOf(c);
  g.scale(SCALE, SCALE);
  g.lineJoin = 'round';
  paint(g);
  return { canvas: c, w, h, ax, ay };
}

/* ---- what grows ---------------------------------------------------------- */

/**
 * The lobes of one clump: circles packed into an oval, jittered.
 *
 * Rows of them, each row as wide as the oval is at that height, so the
 * silhouette is a shape rather than a rectangle of bubbles -- and each lobe
 * off its own roll for size and place, because a clump of anything growing is
 * lumpy at its edge and that edge is the whole of what you see of it.
 */
function lobesOf(cx: number, cy: number, w: number, h: number, R: Rand): Lobe[] {
  const cs: Lobe[] = [];
  /*
   * Big lobes, well overlapped. Small ones spaced apart gave a clump fifteen
   * separate circles round its edge, which is a bunch of grapes; what a mass
   * of leaves looks like is one shape with five or six bumps on it, and that
   * means each lobe has to be a good share of the whole and has to run into
   * its neighbours rather than sit beside them.
   */
  const r = Math.max(1.6, Math.min(w, h) * 0.42);
  const rows = Math.max(2, Math.round(h / (r * 0.82)));
  for (let j = 0; j < rows; j++) {
    const t = rows === 1 ? 0.5 : j / (rows - 1);
    const y = cy - h / 2 + t * h;
    // How wide the oval is at this height, never quite to nothing.
    const hw = (w / 2) * Math.sqrt(Math.max(0.12, 1 - (t * 2 - 1) ** 2 * 0.86));
    const n = Math.max(0, Math.round((hw * 2) / (r * 0.88)));
    for (let i = 0; i <= n; i++) {
      const x = n ? cx - hw + (i / n) * hw * 2 : cx;
      cs.push([x + (R() - 0.5) * r * 0.34, y + (R() - 0.5) * r * 0.3, r * (0.78 + R() * 0.46)]);
    }
  }
  return cs;
}

/** The union of a set of lobes as one path, grown or shrunk by `grow`. */
function union(g: Ctx, cs: Lobe[], dx: number, dy: number, grow: number): void {
  g.beginPath();
  for (const [x, y, r] of cs) {
    const rr = Math.max(0.25, r + grow);
    g.moveTo(x + dx + rr, y + dy);
    g.arc(x + dx, y + dy, rr, 0, 7);
  }
}

/**
 * One clump: the outline, the body, the side of it in the sun, and the crown.
 *
 * Four passes over the same lobes and nothing else, which is how everything
 * green in this game is drawn. Overlapping circles filled in one path union
 * rather than stack, so the middle of a clump is not darker than its edge.
 */
function clump(g: Ctx, cx: number, cy: number, w: number, h: number, R: Rand, pal: Green): void {
  const cs = lobesOf(cx, cy, w, h, R);
  // The line is a share of a lobe, not a fixed weight. At a pixel and a bit
  // round a lobe two pixels across, a small clump came out as more outline
  // than clump and the hollows between its lobes filled in solid.
  const ink = Math.max(0.32, Math.min(w, h) * 0.3 * 0.2);
  union(g, cs, 0, 0, ink);
  g.fillStyle = pal.line;
  g.fill();
  union(g, cs, 0, 0, 0);
  g.fillStyle = pal.shade;
  g.fill();
  g.save();
  union(g, cs, 0, 0, 0);
  g.clip();
  union(g, cs, -w * 0.05, -h * 0.13, 0);
  g.fillStyle = pal.lit;
  g.fill();
  // And the crown: the lobes in the top third, lifted again and paler, which
  // is the light coming over the top of a thing that has a top.
  const top = cs.filter((c) => c[1] < cy - h * 0.1);
  if (top.length) {
    union(g, top, -w * 0.07, -h * 0.2, -0.4);
    g.fillStyle = pal.top;
    g.fill();
  }
  g.restore();
}

/**
 * The sward's whole palette: black and white, thinly.
 *
 * Each is the clump and the breath of it -- the same ink again, wider and
 * fainter, which is what turns a hard-edged splodge into a soft one.
 */
const SOD: Array<readonly [string, string]> = [
  ['rgba(38, 44, 28, 0.085)', 'rgba(38, 44, 28, 0.04)'],
  ['rgba(48, 56, 34, 0.06)', 'rgba(48, 56, 34, 0.028)'],
  ['rgba(255, 253, 236, 0.095)', 'rgba(255, 253, 236, 0.042)'],
];

/* ---- the sward ----------------------------------------------------------- */

/** Pixels to a four-metre tile in the sward, and how many tiles it runs. */
const SWARD_TILE = 128;
const SWARD_N = 3;
const SWARD_W = SWARD_TILE * SWARD_N;

/**
 * The ground under all of it: three tiles by three, painted as one field and
 * cut up after, so nothing repeats inside twelve metres.
 *
 * It is not a blade texture. The references are nearly flat colour with the
 * detail standing in it rather than printed on it, and a field of hatching
 * seen from above reads as carpet. What is here is the lie of the ground --
 * pools of light and shade -- and the marks of the clumps growing in it, laid
 * in drifts that turn slowly across the sheet.
 */
function swardSheet(): HTMLCanvasElement {
  const c = cnv(SWARD_W, SWARD_W);
  const g = ctxOf(c);
  g.lineCap = 'round';
  /** Draw a thing at every wrap it reaches, so the sheet butts itself. */
  const wrapped = (x: number, y: number, r: number, paint: (dx: number, dy: number) => void): void => {
    for (const dx of [-SWARD_W, 0, SWARD_W]) {
      if (x + dx + r < 0 || x + dx - r > SWARD_W) continue;
      for (const dy of [-SWARD_W, 0, SWARD_W]) {
        if (y + dy + r < 0 || y + dy - r > SWARD_W) continue;
        paint(dx, dy);
      }
    }
  };
  // The lie of it: soft pools, light and dark, which is what stops a field of
  // one green reading as paper.
  const P = rand(8101);
  for (let i = 0; i < 14; i++) {
    const cx = P() * SWARD_W, cy = P() * SWARD_W;
    const r = SWARD_W * (0.08 + P() * 0.14);
    const ink = P() < 0.5 ? '0, 0, 0' : '255, 255, 255';
    const a = 0.04 + P() * 0.045;
    wrapped(cx, cy, r, (dx, dy) => {
      const grad = g.createRadialGradient(cx + dx, cy + dy, 0, cx + dx, cy + dy, r);
      grad.addColorStop(0, `rgba(${ink}, ${a.toFixed(3)})`);
      grad.addColorStop(1, `rgba(${ink}, 0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx + dx, cy + dy, r, 0, 7);
      g.fill();
    });
  }
  /*
   * And the clumps: lobes, the way the ivy and the hedges are built, laid
   * flat and squashed the way the ground is.
   *
   * They were a thousand little strokes of blade grass, which is honest about
   * what grass is and wrong about what it looks like from here. Nobody sees a
   * blade from standing height; what you see is where the grass is thicker
   * and where it is thinner, which is a shape and not a hatch -- and a field
   * of hatching seen from above reads as carpet, or as static.
   *
   * Each clump is a few circles run together and filled once, so an overlap
   * does not come out twice as dark and the whole of it is one soft shape.
   * They are drawn in the drifts the last wind left, which is what the slow
   * turn across the sheet is for.
   */
  const R = rand(4409);
  for (let i = 0; i < 460; i++) {
    const cx = R() * SWARD_W, cy = R() * SWARD_W;
    /*
     * Sizes from a squared roll, so most are small and a few are wide. All
     * one size was the tell: three hundred blots of one diameter at one
     * strength came out as camouflage, which is exactly what camouflage is
     * for and exactly what a field is not.
     */
    const r = 3.5 + R() * R() * 19;
    const lean = Math.sin((cx / SWARD_W) * Math.PI * 2 + 0.7) * 0.6
      + Math.sin((cy / SWARD_W) * Math.PI * 4 + 2.1) * 0.4;
    const lobes = 3 + Math.floor(R() * 4);
    const t = R();
    const [ink, soft] = SOD[t < 0.46 ? 0 : t < 0.78 ? 1 : 2];
    // The lobes of this one, settled here so every wrapped copy is the same.
    const at: Array<[number, number, number]> = [];
    for (let k = 0; k < lobes; k++) {
      const u = (k / Math.max(1, lobes - 1) - 0.5) * 2;
      at.push([
        Math.cos(lean) * u * r * 1.15 + (R() - 0.5) * r * 0.6,
        (Math.sin(lean) * u * r * 1.15 + (R() - 0.5) * r * 0.6) * 0.58,
        r * (0.5 + R() * 0.55),
      ]);
    }
    const lay = (dx: number, dy: number, grow: number, fill: string): void => {
      g.beginPath();
      for (const [lx, ly, lr] of at) {
        g.moveTo(cx + dx + lx + lr * grow, cy + dy + ly);
        g.ellipse(cx + dx + lx, cy + dy + ly, lr * grow, lr * grow * 0.66, 0, 0, 7);
      }
      g.fillStyle = fill;
      g.fill();
    };
    wrapped(cx, cy, r * 3.2, (dx, dy) => {
      lay(dx, dy, 1.5, soft);
      lay(dx, dy, 1, ink);
    });
  }
  // A few scrapes where it has been walked thin or a mole has been at it.
  const S = rand(1777);
  for (let i = 0; i < 26; i++) {
    const cx = S() * SWARD_W, cy = S() * SWARD_W;
    const r = 5 + S() * 11;
    wrapped(cx, cy, r + 2, (dx, dy) => {
      g.beginPath();
      g.ellipse(cx + dx, cy + dy, r, r * (0.5 + 0.3), (S() - 0.5) * 2, 0, 7);
      g.fillStyle = `rgba(255, 245, 225, ${(0.05 + 0.05 * ((i % 3) / 3)).toFixed(3)})`;
      g.fill();
    });
  }
  return c;
}

/* ---- the ten ------------------------------------------------------------- */

/**
 * What a tile is, from where it is and nothing else.
 *
 * A slow noise over the map decides the drift, so the thick ground comes in
 * patches of thick ground rather than one tile in ten being a surprise; then
 * three tiles in ten jump to a neighbouring look, which is what gives a drift
 * a ragged edge instead of a border. The thinnest is weighted at a third of
 * the whole, because a field that is all clumps is a bog -- and grass is what
 * this is: the clumps are the thing you notice in it, and you cannot notice
 * something that is everywhere.
 */
const WEIGHTS = [31, 9, 8, 7, 8, 7, 7, 8, 8, 7];
const CUTS = ((): number[] => {
  const out: number[] = [];
  let sum = 0;
  const total = WEIGHTS.reduce((a, b) => a + b, 0);
  for (const w of WEIGHTS) { sum += w; out.push(sum / total); }
  return out;
})();

/** Value noise over the map, smooth over six tiles. */
function drift(x: number, y: number): number {
  const s = 1 / 6;
  const gx = Math.floor(x * s), gy = Math.floor(y * s);
  const fx = x * s - gx, fy = y * s - gy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(gx, gy, 811), b = hash2(gx + 1, gy, 811);
  const c = hash2(gx, gy + 1, 811), d = hash2(gx + 1, gy + 1, 811);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

/** Which of the ten this tile is. */
export function grassLook(x: number, y: number): number {
  const n = drift(x, y);
  let base = CUTS.length - 1;
  for (let i = 0; i < CUTS.length; i++) if (n < CUTS[i]) { base = i; break; }
  const j = hash2(x, y, 71);
  if (j < 0.17) return (base + 1) % WEIGHTS.length;
  if (j < 0.30) return (base + WEIGHTS.length - 1) % WEIGHTS.length;
  return base;
}

/* ---- the whole of it ----------------------------------------------------- */

let painted: Meadow | null = null;

/** Painted once, the first time a field comes into view, and kept. */
export function meadow(): Meadow {
  const had = painted;
  if (had) return had;

  const sward = swardSheet();

  /*
   * The blobs. Sizes are screen pixels at zoom one, where a tile is
   * ninety-six and four metres across: a twelve-pixel clump is half a metre,
   * which is a clump of grass, and a twenty-six-pixel one is a metre, which
   * is a bush nobody has cut back.
   */
  const blobs: Sprig[] = [];
  const grow = (w: number, h: number, pal: Green, seed: number): number => {
    /*
     * Room round it for the lobes to stick out into. A lobe sits on the edge
     * of the oval and reaches a lobe's radius past it, and the outline reaches
     * past that again: painted into a picture three pixels wider than the
     * clump, every one of them came out with its sides cut off square.
     */
    const pad = Math.min(w, h) * 0.6 + 3;
    const cw = w + pad * 2, ch = h + pad * 2;
    blobs.push(sprig(cw, ch, cw / 2, ch / 2 + h * 0.34,
      (g) => clump(g, cw / 2, ch / 2, w, h, rand(seed), pal)));
    return blobs.length - 1;
  };
  // Four sizes in each of the three greens, and a long low one in each.
  const TINY = [grow(6, 4.5, MID, 101), grow(7, 5, DEEP, 103), grow(5.5, 4, PALE, 107)];
  const SMALL = [grow(9.5, 7, MID, 109), grow(10.5, 7.5, DEEP, 113), grow(9, 6.5, PALE, 127)];
  const MEDIUM = [grow(14, 9.5, MID, 131), grow(15, 10, DEEP, 137), grow(13, 9, PALE, 139)];
  const BIG = [grow(19, 13, MID, 149), grow(20, 13.5, DEEP, 151), grow(18, 12, PALE, 157)];
  const LONG = [grow(21, 8, MID, 163), grow(23, 8.5, DEEP, 167), grow(20, 7.5, PALE, 173)];

  /**
   * The ten. `tells` is what a turn sheet should be able to find each one by,
   * the way the wall variants name theirs.
   */
  const looks: Look[] = [
    { name: 'Thin', tells: 'nothing at all, or one the size of a thumbnail',
      blobs: TINY, blobN: [0, 1] },
    { name: 'Speckled', tells: 'two or three of the smallest, well apart',
      blobs: TINY, blobN: [2, 3] },
    { name: 'Cushions', tells: 'two middling round ones and nothing else',
      blobs: SMALL, blobN: [1, 2] },
    { name: 'Mound', tells: 'one big clump on its own, which is what a tile of it is for',
      blobs: BIG, blobN: [1, 1] },
    { name: 'Pale', tells: 'two in the lightest green: where the sun has been on it',
      blobs: [TINY[2], SMALL[2], MEDIUM[2]], blobN: [1, 2] },
    { name: 'Deep', tells: 'one or two in the darkest green: the wet corner of a field',
      blobs: [SMALL[1], MEDIUM[1], BIG[1]], blobN: [1, 2] },
    { name: 'Strewn', tells: 'three small ones spread right across it',
      blobs: [...TINY, ...SMALL], blobN: [3, 3] },
    { name: 'Ridge', tells: 'a long low one, lying the way the ground does',
      blobs: LONG, blobN: [1, 2] },
    { name: 'Clustered', tells: 'two middling ones crowded together',
      blobs: MEDIUM, blobN: [2, 2] },
    { name: 'Mixed', tells: 'one big one with a small one under it',
      blobs: [...BIG, ...SMALL], blobN: [2, 2] },
  ];

  const made: Meadow = { sward, swardTiles: SWARD_N, swardTile: SWARD_TILE, blobs, looks };
  painted = made;
  return made;
}

/**
 * Paint it while nobody is waiting on it, the way the walls are.
 *
 * It is a field's worth of drawing and it is all done the first time a blade
 * of grass comes into view, which is the first frame of the game.
 */
export function warmMeadow(): void {
  const idle = globalThis.requestIdleCallback;
  if (typeof idle === 'function') idle(() => { meadow(); });
  else setTimeout(() => { meadow(); }, 1200);
}
