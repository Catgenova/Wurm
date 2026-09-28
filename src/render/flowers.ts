import { hash2 } from '../world/noise';
import { HEIGHT_SCALE } from './iso';

/**
 * Wildflowers, drawn.
 *
 * Where they grow and how thick is `world/flowers.ts`, which the island reads
 * too; this is what a clump of them looks like and where on its tile each one
 * stands. A tile in flower carries one clump for each its drift gives it --
 * thin at a drift's edge, full in its middle -- and a clump is a tuft of
 * leaves with a handful of small flowers on stems over it: pink, white,
 * yellow, and now and then blue, each patch of meadow mostly one of them.
 *
 * The flowers are what the eye has to find in a pale field, so each head has
 * a ring round it in a darker shade of its own colour, the way everything
 * outlined in this game is, and a bright eye; at the size a clump is drawn
 * from standing height a head is three or four pixels, and without the ring
 * a white one is not there at all.
 *
 * They sway. The wind leans them all one way, harder in a stronger wind, and
 * each clump nods on its own clock round that. The sway is painted ahead as a
 * few frames of the clump leaning -- stems bending, heads carried over -- and
 * a clump is drawn from whichever frame its lean is nearest, so the wind costs
 * a choice of picture and not a transform a clump.
 */

type Ctx = CanvasRenderingContext2D;

/** The four colours a meadow flowers in: the petals, the ring round a head, and its eye. */
export const FLOWER_COLOURS: ReadonlyArray<{ name: string; petal: string; ring: string; eye: string }> = [
  { name: 'pink', petal: '#f0a3b7', ring: '#a85f75', eye: '#f6d467' },
  { name: 'white', petal: '#fbf8ef', ring: '#7f988a', eye: '#efc23f' },
  { name: 'yellow', petal: '#f4d35a', ring: '#a5852a', eye: '#dd8f2b' },
  { name: 'blue', petal: '#98b8ee', ring: '#4f6b99', eye: '#f3eed6' },
];

/**
 * Which colour a patch of meadow is mostly, as running shares: a third pink,
 * nearly as much white, a fifth yellow and the last tenth blue.
 */
const COLOUR_CUTS = [0.36, 0.66, 0.9, 1];

/** Frames of lean either side of upright, and the arrangements of heads a clump comes in. */
export const SWAYS = 2;
const VARIANTS = 4;
/** How far over the top of a clump is carried in its furthest frame, in pixels at zoom one. */
const LEAN = 2;
/** Painted at three times the size it is drawn, as the meadow's clumps are. */
const SCALE = 3;

/** A painted clump, and where it is rooted in its own picture. Sizes in pixels at zoom one. */
export interface FlowerSprite {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  ax: number;
  ay: number;
}

/** Where the heads of each arrangement stand over the root, in pixels at zoom one: (x, up). */
const HEADS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[-5.6, 7], [-1.6, 11.2], [3.2, 8.8], [6.4, 5.6], [0.8, 4.8], [-3.4, 3.4], [4.4, 12.2]],
  [[-4.8, 9], [0.2, 12.4], [5, 9.8], [-1.2, 6.2], [7, 6.4], [-7, 5], [2.6, 4]],
  [[-3.4, 10.2], [2.2, 11.8], [5.6, 7.4], [-6.4, 6.4], [1.6, 6.6], [-2.2, 3.8], [6.8, 3.8], [-0.6, 13.2]],
  [[-4.2, 7.8], [0, 10.2], [4.6, 8.2], [-1.8, 5], [3, 4.6], [7.2, 6.2], [-7.4, 4.8], [1.4, 13]],
];

/**
 * How high a clump's flowers stand over the ground, in height units: its
 * highest head. For whatever comes to them (`life.ts`: a tile in flower is a
 * home for butterflies, at this height).
 */
export const FLOWER_TOP = Math.max(...HEADS.flatMap((h) => h.map(([, up]) => up))) / HEIGHT_SCALE;

/** The leaves round the foot of a clump: (x, up, length, lean) in pixels at zoom one. */
const LEAVES: ReadonlyArray<readonly [number, number, number, number]> = [
  [-4.2, 1, 5.6, -0.9], [3.8, 1.2, 5.4, 0.8], [-1, 2, 4.8, -0.25], [1.8, 1.7, 4.4, 0.35], [-6.2, 0.4, 4, -1.25], [6.2, 0.3, 4, 1.2], [0.4, 0.8, 3.8, 0.1],
];

const W = 23;
const H = 21;
/** The root, in the picture: a pixel and a half up from its foot, in the middle. */
const AX = W / 2;
const AY = H - 1.5;

const cache = new Map<number, FlowerSprite>();

/** A clump in one colour and arrangement, leaning `frame` frames over from upright (negative is left). */
export function flowerSprite(colour: number, variant: number, frame: number): FlowerSprite {
  const key = (colour * VARIANTS + variant) * (2 * SWAYS + 1) + frame + SWAYS;
  const had = cache.get(key);
  if (had) return had;
  const c = document.createElement('canvas');
  c.width = W * SCALE;
  c.height = H * SCALE;
  const g = c.getContext('2d') as Ctx;
  g.scale(SCALE, SCALE);
  paint(g, FLOWER_COLOURS[colour], HEADS[variant % HEADS.length], (frame / SWAYS) * LEAN, variant);
  const made = { canvas: c, w: W, h: H, ax: AX, ay: AY };
  cache.set(key, made);
  return made;
}

/** Paint one clump: leaves, the stems carried over by `lean` at the top, and the heads. */
function paint(g: Ctx, col: { petal: string; ring: string; eye: string }, heads: ReadonlyArray<readonly [number, number]>, lean: number, variant: number): void {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // The shade at its foot, so it stands in the grass rather than on it.
  g.beginPath();
  g.ellipse(AX + 0.8, AY + 0.3, 7.6, 2, 0, 0, 7);
  g.fillStyle = 'rgba(40, 70, 52, 0.16)';
  g.fill();
  // The leaves: a line round them, then the body, then the light on the upper side.
  const leaf = (grow: number, fill: string, dy = 0): void => {
    g.beginPath();
    for (const [x, up, len, tilt] of LEAVES) {
      const bx = AX + x, by = AY - up;
      g.moveTo(bx, by);
      g.quadraticCurveTo(bx + tilt * len * 0.35 - grow, by - len * 0.6 + dy, bx + tilt * len * 0.8, by - len);
      g.quadraticCurveTo(bx + tilt * len * 0.35 + grow + 1.1, by - len * 0.45 + dy, bx, by);
    }
    g.fillStyle = fill;
    g.fill();
  };
  leaf(0.5, '#4f7a5f');
  leaf(0, '#6f9c7c');
  leaf(-0.35, '#8db898', 0.5);
  // The stems, each from the root to its head, bending with the lean the more the higher it goes.
  const topOf = (hx: number, up: number): [number, number] => [AX + hx + lean * (up / 12) * (up / 12), AY - up];
  g.strokeStyle = '#5b876a';
  g.lineWidth = 0.55;
  g.beginPath();
  for (const [hx, up] of heads) {
    const [tx, ty] = topOf(hx, up);
    g.moveTo(AX + hx * 0.25, AY - 0.4);
    g.quadraticCurveTo(AX + hx * 0.7, AY - up * 0.5, tx, ty);
  }
  g.stroke();
  // And the heads, the lower ones first so the higher stand in front of them.
  const order = [...heads].sort((a, b) => b[1] - a[1]);
  for (let i = 0; i < order.length; i++) {
    const [hx, up] = order[i];
    const [cx, cy] = topOf(hx, up);
    // A head a little smaller now and then, and every one turned its own way.
    const r = 2.05 * (1 - ((i + variant) % 3) * 0.08);
    const turn = (i * 1.3 + variant) % (Math.PI * 2);
    g.beginPath();
    g.arc(cx, cy, r + 0.42, 0, 7);
    g.fillStyle = col.ring;
    g.fill();
    g.beginPath();
    for (let p = 0; p < 5; p++) {
      const a = turn + (p / 5) * Math.PI * 2;
      const px = cx + Math.cos(a) * r * 0.52, py = cy + Math.sin(a) * r * 0.52;
      g.moveTo(px + r * 0.52, py);
      g.arc(px, py, r * 0.52, 0, 7);
    }
    g.fillStyle = col.petal;
    g.fill();
    g.beginPath();
    g.arc(cx, cy, r * 0.36, 0, 7);
    g.fillStyle = col.eye;
    g.fill();
  }
}

/** Value noise over the map, smooth over nine tiles: which colour a patch of meadow is. Drawing only. */
function tint(x: number, y: number): number {
  const s = 1 / 9;
  const gx = Math.floor(x * s), gy = Math.floor(y * s);
  const fx = x * s - gx, fy = y * s - gy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(gx, gy, 6211), b = hash2(gx + 1, gy, 6211);
  const c = hash2(gx, gy + 1, 6211), d = hash2(gx + 1, gy + 1, 6211);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

const pickColour = (t: number): number => {
  for (let i = 0; i < COLOUR_CUTS.length; i++) if (t < COLOUR_CUTS[i]) return i;
  return COLOUR_CUTS.length - 1;
};

/** The colour most of a tile's flowers are, off where it is. */
export const tileColour = (x: number, y: number): number => pickColour(tint(x, y));

/**
 * Where on its tile the `i`th clump of `n` stands, and what it is: (u, v) in
 * the tile's own square, its colour, its arrangement, its phase in the wind
 * and its size. Off the tile's coordinates alone, so it never moves and every page
 * puts it in the same place. The clumps are spread over the four quarters of
 * the tile rather than thrown at it, so four of them are a tile in flower and
 * not a heap in one corner.
 */
export function clumpOf(x: number, y: number, i: number, n: number, main: number): [number, number, number, number, number, number] {
  const q = (Math.floor(hash2(x, y, 6301) * 4) + i) % 4;
  const qu = n === 1 ? 0.5 : q % 2 === 0 ? 0.3 : 0.7;
  const qv = n === 1 ? 0.5 : q < 2 ? 0.3 : 0.7;
  const u = qu + (hash2(x, y, 6303 + i * 7) - 0.5) * (n === 1 ? 0.4 : 0.32);
  const v = qv + (hash2(x, y, 6305 + i * 7) - 0.5) * (n === 1 ? 0.4 : 0.32);
  // And its own size, a tenth either way and in tenths, so a full drift is not a grid of one clump.
  const size = 0.9 + Math.floor(hash2(x, y, 6315 + i * 7) * 3) * 0.1;
  // A fifth of them another colour than the patch's, which is what a meadow does.
  const other = hash2(x, y, 6307 + i * 7);
  const colour = other < 0.2 ? pickColour(hash2(x, y, 6309 + i * 7)) : main;
  const variant = Math.floor(hash2(x, y, 6311 + i * 7) * VARIANTS);
  const phase = hash2(x, y, 6313 + i * 7) * Math.PI * 2;
  return [u, v, colour, variant, phase, size];
}

/**
 * How many frames over a clump leans now: the wind's lean across the screen,
 * `lean` (-1 to 1, times its force), and the clump's own nod round it.
 */
export function swayFrame(lean: number, force: number, t: number, phase: number): number {
  const nod = Math.sin(t * (1.5 + (phase % 1) * 0.9) + phase) * (0.22 + 0.45 * force);
  const s = lean * 0.75 + nod;
  return Math.max(-SWAYS, Math.min(SWAYS, Math.round(s * SWAYS)));
}
