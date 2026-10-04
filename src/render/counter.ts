import { itemDef } from '../game/items';
import type { Counter } from '../game/counters';
import { BAY } from './masonry';

/**
 * A shop counter, drawn in its wall.
 *
 * The opening is a bay's (`BAY`), so every masonry's own picture of a wall
 * with that hole in it serves, dressed as that masonry dresses one; what is
 * drawn here is what makes it a shop. From the street: the dim room behind
 * the opening with a shelf of stock along its back, the reveal of the wall's
 * thickness round it, a board on two brackets standing out into the street
 * at the sill with what is for sale on it, and a striped awning over the lot
 * on two arms. From inside the shop: the reveal, and the board, the goods and
 * the awning beyond it, seen through the opening.
 *
 * Everything is placed in the wall's own frame -- `t` along it, `k` up the
 * storey and `s` across it in half-thicknesses, positive toward the camera --
 * through the same `px`/`py` the wall is drawn with, so it turns with the
 * view and sits on the wall at every one of the eight.
 *
 * The front -- board, goods and awning, which is most of the drawing -- is
 * drawn once onto a canvas of its own for each way it can look and blitted
 * from then on (`drawCounterFrontKept`): the frame is the same shape on the
 * screen wherever the camera stands, so one picture serves until the view
 * turns, the zoom passes a step, or what is on the counter changes. Under
 * 0.6 it is shapes and colours only: the board a strip and the awning a
 * striped quad, nothing on the board and nothing hanging off it.
 */

type RGB = readonly [number, number, number];

/** The wall's own frame on the screen: `t` along it, `k` up it, `s` across it, as `drawWall` has it. */
export interface CounterGeom {
  px: (t: number, k: number, s?: number) => number;
  py: (t: number, k: number, s?: number) => number;
}

/** How a counter is to look in its wall. */
export interface CounterLook {
  zoom: number;
  /** Which way the street lies across the wall: toward the camera (1) or away from it (-1). */
  street: 1 | -1;
  /** How much of the light the face it is in catches, as the wall's face has it. */
  lit: number;
  /** The masonry's ink, the stone its thickness shows, and its timber and that timber's ink. */
  line: RGB;
  reveal: RGB;
  wood: RGB;
  woodLine: RGB;
  /** The awning's stripe, which differs counter to counter. */
  stripe: RGB;
  /** The kinds of thing set out on it, at most `WARES_SHOWN`, in the order they went out. */
  wares: string[];
  /** How full it is, nought to one: what it holds against what a counter holds. */
  full: number;
  /** How much of a light is burning in the shop behind it, 0 to 1. */
  alight: number;
  /** Whether the room behind it is open to the sky, nothing built over it: then it is daylit, not dim. */
  sky: boolean;
}

/** Where everything is, in the wall's frame. */
const C = {
  ...BAY,
  /** The board: how far past the opening it runs each way, how thick it is, and how far out it stands. */
  wing: 0.035,
  thick: 0.022,
  out: 3.4,
  /** The awning: its back edge over the head of the opening, its front edge lower and further out, and how far past the opening it runs. */
  awnBack: 0.095,
  awnFront: 0.005,
  awnOut: 5.4,
  awnWing: 0.05,
  /** The valance along its front, as a share of the storey. */
  valance: 0.035,
} as const;

/** The awning's canvas between its stripes. */
const CANVAS: RGB = [243, 232, 208];
/** How many kinds of thing a counter shows on its board. */
export const WARES_SHOWN = 5;

/** The stripes an awning may be, a counter's own by where it stands: the pastels of the island, each unlike the one before it. */
const STRIPES: RGB[] = [[207, 111, 95], [113, 150, 187], [214, 170, 82], [128, 172, 110], [176, 128, 170], [96, 168, 160]];
/** How far round the stripes a counter on each side of its tile is turned, so the counters on one tile all differ. */
const SIDE_TURN: Record<string, number> = { n: 0, e: 3, s: 1, w: 4 };
/**
 * An awning's stripe, the same for one counter every time it is drawn, and
 * never the same as its neighbour's: a step round the stripes for a tile
 * along, two for a tile across -- so the next counter along a street and the
 * one across a lane of one tile both differ -- and the four sides of one
 * tile turned apart.
 */
export const stripeOf = (x: number, y: number, side: string): RGB =>
  STRIPES[(((x + 2 * y + (SIDE_TURN[side] ?? 0)) % STRIPES.length) + STRIPES.length) % STRIPES.length];

/** The kinds of thing on a counter to draw, from what it holds where that was sent, or the few kinds sent from further off. */
export function counterWares(c: Counter): string[] {
  const kinds: string[] = [];
  for (const it of c.items) {
    if (!kinds.includes(it.id)) kinds.push(it.id);
    if (kinds.length >= WARES_SHOWN) return kinds;
  }
  if (!kinds.length) for (const id of c.wares ?? []) if (kinds.length < WARES_SHOWN) kinds.push(id);
  return kinds;
}

/* ---- what a thing looks like on a board ------------------------------------- */

type Shape = 'crock' | 'jar' | 'basket' | 'loaf' | 'bolt' | 'stack' | 'planks' | 'logs' | 'sticks' | 'candles' | 'ingots' | 'sack' | 'tools' | 'bundle' | 'trinkets' | 'crate';

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Words in a thing's id, and what each says of its shape. The last word of an id that says anything says it: a clay jar is a jar. */
const SHAPE_OF: Record<string, Shape> = Object.fromEntries(([
  ['crock', 'jar pot bowl amphora urn jug cup mug flask bucket oil honey tincture potion wine mead ale cider juice milk preserves compote stew broth'],
  ['jar', 'bottle vial lantern lamp'],
  ['candles', 'candle wax'],
  ['bundle', 'flowers wildflowers petals lavender sage basil thyme mint rosemary reed thatch sprout lily papyrus'],
  ['ingots', 'lump ingot nail ribbon ore'],
  ['stack', 'brick slab shards stone mortar adobe concrete clay'],
  ['planks', 'plank timber'],
  ['logs', 'log'],
  ['sticks', 'shaft peg arrow torch'],
  ['bolt', 'cloth wool yarn linen silk cotton leather hide fur rope thread string wemp'],
  ['loaf', 'bread loaf pie cake cheese dough'],
  ['sack', 'flour cornmeal wheat corn seed sand dirt ash coal peat salt sugar compost'],
  ['trinkets', 'gem ring pendant circlet bauble mirror comb statuette coin fragment'],
  ['basket', 'apple cherry plum peach pear fig lemon quince apricot pomegranate olive blueberry raspberry strawberry lingonberry carrot cabbage onion potato fish trout perch pike minnow sturgeon meat egg nuts acorn'],
  ['crate', 'crate chest box coffer'],
] as Array<[Shape, string]>).flatMap(([shape, words]) => words.split(' ').map((w) => [w, shape])));

/** And of its colour, looked for the same way: a clay jar is terracotta, a gold lump gold. */
const COLOUR_OF: Record<string, string> = Object.fromEntries(([
  ['#e9c25a', 'gold ring pendant circlet coin'], ['#d9dde3', 'silver'], ['#c27a4e', 'copper'], ['#c99a52', 'bronze brass electrum'],
  ['#aeb3b8', 'tin zinc pewter lead'], ['#8d8f98', 'iron steel nail ribbon'], ['#c07a52', 'clay jar pot bowl amphora urn jug'],
  ['#ece8e0', 'marble'], ['#bfe0dc', 'glass bottle'], ['#cdb9e8', 'mosaic'], ['#6c7888', 'slate'], ['#d8b884', 'sandstone'], ['#c6956a', 'adobe'], ['#a39c90', 'stone rock mortar concrete shards'],
  ['#c49461', 'plank log timber shaft peg'], ['#ece4d0', 'cloth linen cotton'], ['#e2d6c0', 'wool yarn'], ['#e9b8c8', 'silk'],
  ['#9a6a46', 'leather hide fur'], ['#c9ae7c', 'rope thread string wemp'], ['#c99a5a', 'bread pie dough loaf cake'], ['#f0d070', 'cheese'],
  ['#eee6d4', 'flour cornmeal'], ['#e0c068', 'wheat corn'], ['#b89a68', 'seed'], ['#4a4a50', 'coal ash'], ['#e0cf9a', 'sand'],
  ['#7a5c40', 'dirt compost peat'], ['#6fb8c8', 'gem'], ['#f3ead0', 'candle wax'], ['#d9b460', 'lantern lamp'], ['#9c7a52', 'torch'],
  ['#9a3a4a', 'wine'], ['#e0a040', 'mead honey cider juice ale preserves'], ['#a8a040', 'oil olive'], ['#f5f2ea', 'milk'],
  ['#d6574a', 'apple cherry raspberry strawberry pomegranate'], ['#6a4a8a', 'plum blueberry lingonberry'],
  ['#e8b040', 'pear quince fig lemon apricot peach'], ['#e88a3a', 'carrot'], ['#8fb84a', 'cabbage basil mint sage thyme rosemary'],
  ['#d8c098', 'onion potato egg nuts acorn'], ['#8fa8b8', 'fish trout perch pike minnow sturgeon'], ['#b8504a', 'meat'],
  ['#a890c8', 'lavender'], ['#e08aa0', 'rose petals'], ['#e6c75a', 'wildflowers flowers'], ['#c8b070', 'reed thatch papyrus'],
  ['#9cc8b8', 'bottle vial glass'], ['#b08850', 'crate chest box coffer'],
] as Array<[string, string]>).flatMap(([c, words]) => words.split(' ').map((w) => [w, c])));

/** The shape and colour a kind of thing is drawn as on a board: off the words of its id, or its kind of thing. */
export function wareLook(id: string): { shape: Shape; colour: RGB } {
  const words = id.split('_').reverse();
  const shape = words.map((w) => SHAPE_OF[w]).find(Boolean);
  const colour = words.map((w) => COLOUR_OF[w]).find(Boolean);
  const cat = itemDef(id)?.category;
  const pick = STRIPES[Math.abs([...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)) % STRIPES.length];
  const fallback: Shape = cat === 'tool' ? 'tools' : cat === 'food' ? 'basket' : cat === 'plant' ? 'bundle' : cat === 'material' ? 'sack' : 'crate';
  return {
    shape: shape ?? fallback,
    colour: colour ? hex(colour) : cat === 'tool' ? [150, 154, 162] : cat === 'plant' ? [143, 184, 74] : cat === 'material' ? [217, 202, 164] : pick,
  };
}

/* ---- drawing ----------------------------------------------------------------- */

const rgb = (c: RGB, k = 1, a = 1): string =>
  `rgba(${Math.max(0, Math.min(255, Math.round(c[0] * k)))}, ${Math.max(0, Math.min(255, Math.round(c[1] * k)))}, ${Math.max(0, Math.min(255, Math.round(c[2] * k)))}, ${a})`;

/** A path through points in the wall's frame. */
function path(ctx: CanvasRenderingContext2D, g: CounterGeom, pts: Array<[number, number, number]>): void {
  ctx.beginPath();
  pts.forEach(([t, k, s], i) => (i ? ctx.lineTo(g.px(t, k, s), g.py(t, k, s)) : ctx.moveTo(g.px(t, k, s), g.py(t, k, s))));
  ctx.closePath();
}

/** The four sides and the sill of the opening, through the wall's thickness, as a window's are lit. */
export function drawCounterReveal(ctx: CanvasRenderingContext2D, g: CounterGeom, look: CounterLook): void {
  const { t0, t1, k0, k1 } = C;
  const strip = (a: number, ak: number, b: number, bk: number, k: number): void => {
    path(ctx, g, [[a, ak, 1], [b, bk, 1], [b, bk, -1], [a, ak, -1]]);
    ctx.fillStyle = rgb(look.reveal, k);
    ctx.fill();
  };
  strip(t0, k0, t0, k1, 0.86);
  strip(t1, k0, t1, k1, 0.86);
  strip(t0, k1, t1, k1, 0.7);
  strip(t0, k0, t1, k0, 1.02);
}

/**
 * The shop behind the opening, from the street: the reveal, and on the back
 * plane a dim room -- warmer and lighter with a lamp burning in it -- with a
 * shelf along it and the shapes of stock on the shelf. Called clipped to the
 * opening, before the hour's light is laid over the wall.
 */
export function drawCounterInside(ctx: CanvasRenderingContext2D, g: CounterGeom, look: CounterLook): void {
  const { t0, t1, k0, k1 } = C;
  drawCounterReveal(ctx, g, look);
  // The room: dark, and toward the floor darker, or lit from within -- or, with nothing over it, in the day's light.
  const warm = Math.min(1, look.alight);
  const top = look.sky ? [206, 196, 178] : [104 + 120 * warm, 88 + 86 * warm, 76 + 30 * warm];
  const foot = look.sky ? [176, 164, 146] : [66 + 80 * warm, 56 + 50 * warm, 50 + 16 * warm];
  const gr = ctx.createLinearGradient(g.px((t0 + t1) / 2, k1, -1), g.py((t0 + t1) / 2, k1, -1), g.px((t0 + t1) / 2, k0, -1), g.py((t0 + t1) / 2, k0, -1));
  gr.addColorStop(0, `rgb(${top.map((v) => v | 0).join(',')})`);
  gr.addColorStop(1, `rgb(${foot.map((v) => v | 0).join(',')})`);
  path(ctx, g, [[t0, k0, -1], [t1, k0, -1], [t1, k1, -1], [t0, k1, -1]]);
  ctx.fillStyle = gr;
  ctx.fill();
  if (look.zoom < 0.6) return;
  // A shelf across the back of the room, and stock on it in the colours of what is for sale.
  const ks = k0 + (k1 - k0) * 0.62;
  ctx.strokeStyle = rgb(look.wood, 0.55 + 0.3 * warm);
  ctx.lineWidth = Math.max(1, 1.3 * look.zoom);
  ctx.beginPath();
  ctx.moveTo(g.px(t0, ks, -1), g.py(t0, ks, -1));
  ctx.lineTo(g.px(t1, ks, -1), g.py(t1, ks, -1));
  ctx.stroke();
  const n = 6;
  for (let i = 0; i < n; i++) {
    const t = t0 + ((t1 - t0) * (i + 0.6)) / (n + 0.2);
    const c = look.wares.length ? wareLook(look.wares[i % look.wares.length]).colour : STRIPES[i % STRIPES.length];
    const h = 0.05 + ((i * 37) % 5) * 0.008;
    path(ctx, g, [[t - 0.025, ks, -1], [t + 0.025, ks, -1], [t + 0.02, ks + h, -1], [t - 0.02, ks + h, -1]]);
    ctx.fillStyle = rgb(c, 0.62 + 0.3 * warm);
    ctx.fill();
  }
}

/** The opening from inside the shop on a wall drawn flat, where nothing shows through it: the day outside, pale. */
export function drawCounterDaylight(ctx: CanvasRenderingContext2D, g: CounterGeom, look: CounterLook): void {
  const { t0, t1, k0, k1 } = C;
  drawCounterReveal(ctx, g, look);
  path(ctx, g, [[t0, k0, -1], [t1, k0, -1], [t1, k1, -1], [t0, k1, -1]]);
  ctx.fillStyle = 'rgb(214, 226, 222)';
  ctx.fill();
}

/** The opening's far side, as a path: what the street is seen through from inside the shop. */
export function counterHole(ctx: CanvasRenderingContext2D, g: CounterGeom, s: number): void {
  const { t0, t1, k0, k1 } = C;
  path(ctx, g, [[t0, k0, s], [t1, k0, s], [t1, k1, s], [t0, k1, s]]);
}

/**
 * The board, the goods on it and the awning over it: from the street, out in
 * front of the wall and over everything on its face; from inside the shop,
 * the caller clips it to the opening and it is seen beyond the wall.
 */
export function drawCounterFront(ctx: CanvasRenderingContext2D, g: CounterGeom, look: CounterLook): void {
  const { t0, t1, k0, k1 } = C;
  const S = look.street;
  const z = look.zoom;
  const ink = rgb(look.line, 0.95, 0.75);
  const lw = Math.max(1, 1.2 * z);
  ctx.lineJoin = 'round';
  const a0 = t0 - C.wing, a1 = t1 + C.wing;
  const kb = k0 + 0.004, kt = kb + C.thick;
  if (z < 0.6) {
    drawCounterFlat(ctx, g, look);
    return;
  }
  /** A face through points in the frame, filled and inked. */
  const face = (pts: Array<[number, number, number]>, fill: string): void => {
    path(ctx, g, pts);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = lw;
    ctx.stroke();
  };
  // Whether a step along +t goes down the screen: then the board's +t end is the one in view.
  const endT = g.py(1, 0) > g.py(0, 0) ? 1 : -1;
  const sOut = S * C.out;

  // The brackets under the board, a wedge of the timber at either end of the opening.
  for (const t of [t0 + 0.05, t1 - 0.05]) face([[t, kb, S], [t, kb, S * C.out * 0.85], [t, kb - 0.17, S]], rgb(look.wood, 0.72 * look.lit));
  // The board: its end in view, its front edge, then its top.
  const endAt = endT > 0 ? a1 : a0;
  face([[endAt, kb, S], [endAt, kb, sOut], [endAt, kt, sOut], [endAt, kt, S]], rgb(look.wood, 0.78 * look.lit));
  if (S > 0) face([[a0, kb, sOut], [a1, kb, sOut], [a1, kt, sOut], [a0, kt, sOut]], rgb(look.wood, 0.9 * look.lit));
  face([[a0, kt, S * 0.4], [a1, kt, S * 0.4], [a1, kt, sOut], [a0, kt, sOut]], rgb(look.wood, 1.12));
  if (z >= 0.6) {
    // The joints between its boards, along it.
    ctx.strokeStyle = rgb(look.woodLine, 1, 0.35);
    ctx.lineWidth = Math.max(0.6, 0.8 * z);
    ctx.beginPath();
    for (const s of [0.4 + (C.out - 0.4) / 3, 0.4 + ((C.out - 0.4) * 2) / 3]) {
      ctx.moveTo(g.px(a0, kt, S * s), g.py(a0, kt, S * s));
      ctx.lineTo(g.px(a1, kt, S * s), g.py(a1, kt, S * s));
    }
    ctx.stroke();
  }

  // What is for sale on it, the far ones first: a row of what kinds there are, and a second behind it as it fills.
  if (look.wares.length) {
    const kinds = look.wares.length;
    const shown = Math.min(2 * WARES_SHOWN, Math.max(kinds, Math.ceil(2 * WARES_SHOWN * look.full)));
    const front = Math.min(shown, WARES_SHOWN), back = shown - front;
    const span = t1 - t0 - 0.12;
    const slots = [
      ...Array.from({ length: front }, (_, i) => ({ i, t: t0 + 0.06 + (span * (i + 0.5)) / front, s: S * (back ? 2.45 + ((i * 7) % 3) * 0.25 : 1.9 + ((i * 7) % 3) * 0.4) })),
      ...Array.from({ length: back }, (_, j) => ({ i: front + j, t: t0 + 0.06 + (span * (j + 0.25 + 0.5 * (j % 2))) / back, s: S * (1.25 + ((j * 5) % 2) * 0.2) })),
    ];
    slots.sort((p, q) => g.py(p.t, kt, p.s) - g.py(q.t, kt, q.s));
    // A board running right to left on the screen takes its pictures the other way round, as a wall's ivy does.
    const flip = g.px(1, 0) < g.px(0, 0) ? -1 : 1;
    for (const w of slots) ware(ctx, g, w.t, kt, w.s, wareLook(look.wares[w.i % kinds]), look, flip);
  }

  // The awning: two arms from the wall to its front corners, the striped canvas, and the valance.
  const b0 = t0 - C.awnWing, b1 = t1 + C.awnWing;
  const kBack = k1 + C.awnBack, kFront = k1 + C.awnFront, sA = S * C.awnOut;
  ctx.strokeStyle = rgb(look.woodLine, 0.9);
  ctx.lineWidth = Math.max(1, 1.4 * z);
  ctx.beginPath();
  for (const t of [b0 + 0.01, b1 - 0.01]) {
    ctx.moveTo(g.px(t, k1 - 0.05, S), g.py(t, k1 - 0.05, S));
    ctx.lineTo(g.px(t, kFront, sA), g.py(t, kFront, sA));
  }
  ctx.stroke();
  const canvas: [number, number, number][] = [[b0, kBack, S], [b1, kBack, S], [b1, kFront, sA], [b0, kFront, sA]];
  face(canvas, rgb(CANVAS, 1.02));
  // Every other band the stripe, in one path.
  const n = 9;
  const band = (u0: number, u1: number, kA: number, kB: number): void => {
    // Each band a shape of its own: begun with a move, or it is joined to the last.
    ([[u0, kA, S], [u1, kA, S], [u1, kB, sA], [u0, kB, sA]] as Array<[number, number, number]>).forEach(([t, k, s], i) =>
      (i ? ctx.lineTo(g.px(t, k, s), g.py(t, k, s)) : ctx.moveTo(g.px(t, k, s), g.py(t, k, s))));
    ctx.closePath();
  };
  ctx.beginPath();
  for (let i = 1; i < n; i += 2) band(b0 + ((b1 - b0) * i) / n, b0 + ((b1 - b0) * (i + 1)) / n, kBack, kFront);
  ctx.fillStyle = rgb(look.stripe, 1.02);
  ctx.fill();
  path(ctx, g, canvas);
  ctx.strokeStyle = ink;
  ctx.lineWidth = lw;
  ctx.stroke();
  // The valance, scalloped, hanging from the front edge: seen from the street, its outside; from within, its back.
  if (z >= 0.5) {
    const w = (b1 - b0) / n;
    const scallop = (i: number): void => {
      const u = b0 + i * w;
      ctx.moveTo(g.px(u, kFront, sA), g.py(u, kFront, sA));
      ctx.lineTo(g.px(u + w, kFront, sA), g.py(u + w, kFront, sA));
      for (let j = 0; j <= 6; j++) {
        const t = u + w - (j / 6) * w, k = kFront - C.valance * (0.62 + 0.38 * Math.sin((j / 6) * Math.PI));
        ctx.lineTo(g.px(t, k, sA), g.py(t, k, sA));
      }
      ctx.closePath();
    };
    const shade = (S > 0 ? 0.92 : 0.7) * look.lit;
    for (const odd of [0, 1]) {
      ctx.beginPath();
      for (let i = odd; i < n; i += 2) scallop(i);
      ctx.fillStyle = rgb(odd ? look.stripe : CANVAS, shade);
      ctx.fill();
    }
    ctx.beginPath();
    for (let i = 0; i < n; i++) scallop(i);
    ctx.strokeStyle = rgb(look.line, 0.95, 0.5);
    ctx.lineWidth = Math.max(0.7, 0.9 * z);
    ctx.stroke();
  }
}

/**
 * The board and the awning in shapes and colours only, for a counter too far
 * off to see more of: the board's top as a strip, and the awning as one
 * striped quad.
 */
export function drawCounterFlat(ctx: CanvasRenderingContext2D, g: CounterGeom, look: CounterLook): void {
  const { t0, t1, k0, k1 } = C;
  const S = look.street;
  const a0 = t0 - C.wing, a1 = t1 + C.wing, kt = k0 + 0.004 + C.thick;
  path(ctx, g, [[a0, kt, S * 0.4], [a1, kt, S * 0.4], [a1, kt, S * C.out], [a0, kt, S * C.out]]);
  ctx.fillStyle = rgb(look.wood, 1.05);
  ctx.fill();
  const b0 = t0 - C.awnWing, b1 = t1 + C.awnWing, kBack = k1 + C.awnBack, kFront = k1 + C.awnFront, sA = S * C.awnOut;
  path(ctx, g, [[b0, kBack, S], [b1, kBack, S], [b1, kFront, sA], [b0, kFront, sA]]);
  ctx.fillStyle = rgb(CANVAS, 1.02);
  ctx.fill();
  const n = 5;
  ctx.beginPath();
  for (let i = 1; i < n; i += 2) {
    const u0 = b0 + ((b1 - b0) * i) / n, u1 = b0 + ((b1 - b0) * (i + 1)) / n;
    ([[u0, kBack, S], [u1, kBack, S], [u1, kFront, sA], [u0, kFront, sA]] as Array<[number, number, number]>).forEach(([t, k, s], j) =>
      (j ? ctx.lineTo(g.px(t, k, s), g.py(t, k, s)) : ctx.moveTo(g.px(t, k, s), g.py(t, k, s))));
    ctx.closePath();
  }
  ctx.fillStyle = rgb(look.stripe, 1.02);
  ctx.fill();
}

/** One kind of thing on the board, standing at `t` along it and `s` out from the wall, mirrored when `flip` is -1. */
function ware(ctx: CanvasRenderingContext2D, g: CounterGeom, t: number, k: number, s: number, look: { shape: Shape; colour: RGB }, cl: CounterLook, flip = 1): void {
  const x = g.px(t, k, s), y = g.py(t, k, s);
  if (flip < 0) {
    ctx.save();
    ctx.translate(2 * x, 0);
    ctx.scale(-1, 1);
    ware(ctx, g, t, k, s, look, cl, 1);
    ctx.restore();
    return;
  }
  // A unit, in pixels: about a tenth of a metre at this zoom, a third over, as the stall's goods are drawn.
  const u = cl.zoom * 1.35;
  const c = look.colour;
  const ink = rgb(cl.line, 0.7, 0.85);
  const lw = Math.max(0.7, 0.55 * u);
  const fill = (k1: number, a = 1): string => rgb(c, k1, a);
  const outline = (): void => {
    ctx.strokeStyle = ink;
    ctx.lineWidth = lw;
    ctx.stroke();
  };
  const ellipse = (cx: number, cy: number, rx: number, ry: number, style: string): void => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(0.3, rx), Math.max(0.3, ry), 0, 0, Math.PI * 2);
    ctx.fillStyle = style;
    ctx.fill();
  };
  const box = (cx: number, by: number, w: number, h: number, d: number, k1: number): void => {
    // A small box standing on (cx, by): its front, and its top drawn back and up.
    ctx.beginPath();
    ctx.rect(cx - w / 2, by - h, w, h);
    ctx.fillStyle = fill(0.9 * k1);
    ctx.fill();
    outline();
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, by - h);
    ctx.lineTo(cx - w / 2 + d * 0.6, by - h - d * 0.5);
    ctx.lineTo(cx + w / 2 + d * 0.6, by - h - d * 0.5);
    ctx.lineTo(cx + w / 2, by - h);
    ctx.closePath();
    ctx.fillStyle = fill(1.12 * k1);
    ctx.fill();
    outline();
  };
  switch (look.shape) {
    case 'crock': {
      // A glazed pot: a swelling body, a neck and a lip.
      ctx.beginPath();
      ctx.moveTo(x - 1.6 * u, y);
      ctx.bezierCurveTo(x - 3.2 * u, y - 2.4 * u, x - 2.6 * u, y - 5.2 * u, x - 1.1 * u, y - 5.8 * u);
      ctx.lineTo(x - 1.4 * u, y - 6.8 * u);
      ctx.lineTo(x + 1.4 * u, y - 6.8 * u);
      ctx.lineTo(x + 1.1 * u, y - 5.8 * u);
      ctx.bezierCurveTo(x + 2.6 * u, y - 5.2 * u, x + 3.2 * u, y - 2.4 * u, x + 1.6 * u, y);
      ctx.closePath();
      ctx.fillStyle = fill(1);
      ctx.fill();
      outline();
      ellipse(x - 1 * u, y - 3.6 * u, 0.6 * u, 1.3 * u, 'rgba(255,255,255,0.32)');
      break;
    }
    case 'jar': {
      ctx.beginPath();
      ctx.rect(x - 1.3 * u, y - 6 * u, 2.6 * u, 6 * u);
      ctx.fillStyle = fill(1, 0.85);
      ctx.fill();
      outline();
      ctx.beginPath();
      ctx.rect(x - 0.6 * u, y - 7.6 * u, 1.2 * u, 1.6 * u);
      ctx.fillStyle = fill(0.8, 0.9);
      ctx.fill();
      outline();
      break;
    }
    case 'basket': {
      // Wicker, heaped with whatever it is.
      ctx.beginPath();
      ctx.moveTo(x - 3.2 * u, y - 3 * u);
      ctx.lineTo(x + 3.2 * u, y - 3 * u);
      ctx.lineTo(x + 2.4 * u, y);
      ctx.lineTo(x - 2.4 * u, y);
      ctx.closePath();
      ctx.fillStyle = 'rgb(201, 164, 106)';
      ctx.fill();
      outline();
      for (const [dx, dy] of [[-1.8, -3.4], [0, -3.7], [1.8, -3.4], [-0.9, -4.7], [0.9, -4.7]]) {
        ctx.beginPath();
        ctx.arc(x + dx * u, y + dy * u, 1.05 * u, 0, Math.PI * 2);
        ctx.fillStyle = fill(1);
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = lw * 0.7;
        ctx.stroke();
      }
      break;
    }
    case 'loaf': {
      for (const [dx, dy] of [[-1.4, 0], [1.4, -0.4]]) {
        ellipse(x + dx * u, y + (dy - 1.5) * u, 2.2 * u, 1.6 * u, fill(1));
        ctx.beginPath();
        ctx.ellipse(x + dx * u, y + (dy - 1.5) * u, 2.2 * u, 1.6 * u, 0, 0, Math.PI * 2);
        outline();
        ctx.beginPath();
        ctx.moveTo(x + (dx - 0.8) * u, y + (dy - 2.4) * u);
        ctx.lineTo(x + (dx + 0.6) * u, y + (dy - 1.6) * u);
        ctx.strokeStyle = rgb(c, 0.7);
        ctx.stroke();
      }
      break;
    }
    case 'bolt': {
      // A rolled bolt lying on the board, its end turned to you.
      ctx.beginPath();
      ctx.rect(x - 3.4 * u, y - 3.2 * u, 6.4 * u, 3.2 * u);
      ctx.fillStyle = fill(0.95);
      ctx.fill();
      outline();
      ellipse(x + 3 * u, y - 1.6 * u, 1.1 * u, 1.6 * u, fill(1.1));
      ctx.beginPath();
      ctx.ellipse(x + 3 * u, y - 1.6 * u, 1.1 * u, 1.6 * u, 0, 0, Math.PI * 2);
      outline();
      ctx.beginPath();
      ctx.ellipse(x + 3 * u, y - 1.6 * u, 0.4 * u, 0.6 * u, 0, 0, Math.PI * 2);
      ctx.strokeStyle = rgb(c, 0.6);
      ctx.stroke();
      break;
    }
    case 'stack': case 'planks': {
      const long = look.shape === 'planks';
      const w = (long ? 5.4 : 2.6) * u, h = (long ? 1.1 : 1.6) * u;
      const rows = long ? [[0, 0], [0, -1]] : [[-1.4, 0], [1.4, 0], [0, -1]];
      for (const [dx, row] of rows) box(x + dx * u, y + row * (h + 0.5 * u), w, h, 1.6 * u, row ? 1.05 : 1);
      break;
    }
    case 'ingots': {
      for (const [dx, row] of [[-1.3, 0], [1.3, 0], [0, -1]]) {
        const cy = y + row * 1.5 * u, cx = x + dx * u;
        ctx.beginPath();
        ctx.moveTo(cx - 1.4 * u, cy);
        ctx.lineTo(cx + 1.4 * u, cy);
        ctx.lineTo(cx + 1 * u, cy - 1.4 * u);
        ctx.lineTo(cx - 1 * u, cy - 1.4 * u);
        ctx.closePath();
        ctx.fillStyle = fill(row ? 1.1 : 0.95);
        ctx.fill();
        outline();
      }
      break;
    }
    case 'sack': {
      ctx.beginPath();
      ctx.moveTo(x - 2.6 * u, y);
      ctx.bezierCurveTo(x - 3.4 * u, y - 4 * u, x - 1.4 * u, y - 5.6 * u, x - 0.6 * u, y - 5.4 * u);
      ctx.lineTo(x - 1 * u, y - 6.6 * u);
      ctx.lineTo(x + 1 * u, y - 6.6 * u);
      ctx.lineTo(x + 0.6 * u, y - 5.4 * u);
      ctx.bezierCurveTo(x + 1.4 * u, y - 5.6 * u, x + 3.4 * u, y - 4 * u, x + 2.6 * u, y);
      ctx.closePath();
      ctx.fillStyle = fill(1);
      ctx.fill();
      outline();
      break;
    }
    case 'tools': {
      // A pail of handles, an axe head and a hammer's on two of them.
      ctx.strokeStyle = 'rgb(150, 112, 70)';
      ctx.lineWidth = Math.max(0.8, 0.7 * u);
      ctx.beginPath();
      ctx.moveTo(x - 0.8 * u, y - 2 * u); ctx.lineTo(x - 1.6 * u, y - 7.4 * u);
      ctx.moveTo(x + 0.6 * u, y - 2 * u); ctx.lineTo(x + 1.4 * u, y - 7 * u);
      ctx.moveTo(x, y - 2 * u); ctx.lineTo(x, y - 6.2 * u);
      ctx.stroke();
      ctx.fillStyle = fill(1);
      ctx.beginPath();
      ctx.moveTo(x - 1.6 * u, y - 7.4 * u); ctx.lineTo(x - 3.2 * u, y - 7.8 * u); ctx.lineTo(x - 3 * u, y - 6 * u); ctx.lineTo(x - 1.5 * u, y - 6.4 * u);
      ctx.closePath(); ctx.fill(); outline();
      ctx.beginPath();
      ctx.rect(x + 0.6 * u, y - 7.8 * u, 1.8 * u, 1 * u);
      ctx.fill(); outline();
      ctx.beginPath();
      ctx.rect(x - 1.8 * u, y - 2.4 * u, 3.6 * u, 2.4 * u);
      ctx.fillStyle = 'rgb(176, 136, 80)';
      ctx.fill(); outline();
      break;
    }
    case 'bundle': {
      ctx.strokeStyle = fill(0.8);
      ctx.lineWidth = Math.max(0.7, 0.5 * u);
      ctx.beginPath();
      for (let i = -3; i <= 3; i++) {
        ctx.moveTo(x + i * 0.2 * u, y - 0.5 * u);
        ctx.lineTo(x + i * 0.9 * u, y - 6.2 * u);
      }
      ctx.stroke();
      for (let i = -3; i <= 3; i += 2) ellipse(x + i * 0.9 * u, y - 6.3 * u, 0.9 * u, 0.7 * u, fill(1.1));
      ctx.beginPath();
      ctx.rect(x - 0.9 * u, y - 2.6 * u, 1.8 * u, 0.8 * u);
      ctx.fillStyle = 'rgb(201, 174, 124)';
      ctx.fill();
      break;
    }
    case 'logs': {
      // Three logs on the board, their sawn ends to you, rings and all.
      for (const [dx, dy] of [[-1.5, 0], [1.5, 0], [0, -2.5]]) {
        const cx = x + dx * u, cy = y + dy * u - 1.3 * u;
        ctx.beginPath();
        ctx.rect(cx - 1.4 * u, cy - 1.3 * u, 4.2 * u, 2.6 * u);
        ctx.fillStyle = fill(0.82);
        ctx.fill();
        outline();
        ellipse(cx - 1.4 * u, cy, 1.25 * u, 1.3 * u, 'rgb(222, 190, 140)');
        ctx.beginPath();
        ctx.ellipse(cx - 1.4 * u, cy, 1.25 * u, 1.3 * u, 0, 0, Math.PI * 2);
        outline();
        ctx.beginPath();
        ctx.ellipse(cx - 1.4 * u, cy, 0.55 * u, 0.6 * u, 0, 0, Math.PI * 2);
        ctx.strokeStyle = rgb(c, 0.75);
        ctx.lineWidth = Math.max(0.5, 0.35 * u);
        ctx.stroke();
      }
      break;
    }
    case 'candles': {
      // Candles stood on end, tall and short, each with its wick.
      for (const [dx, h] of [[-1.8, 5.2], [-0.6, 6.4], [0.6, 4.6], [1.8, 5.8]]) {
        const cx = x + dx * u;
        ctx.beginPath();
        ctx.rect(cx - 0.5 * u, y - h * u, 1 * u, h * u);
        ctx.fillStyle = fill(1);
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = lw * 0.8;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx, y - h * u);
        ctx.lineTo(cx, y - (h + 0.8) * u);
        ctx.strokeStyle = 'rgb(60, 48, 40)';
        ctx.lineWidth = Math.max(0.5, 0.3 * u);
        ctx.stroke();
      }
      break;
    }
    case 'sticks': {
      // A sheaf of them stood on end, tied round the middle.
      ctx.lineCap = 'round';
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(x + i * 0.45 * u, y - 0.2 * u);
        ctx.lineTo(x + i * 0.75 * u, y - 7.4 * u);
        ctx.strokeStyle = ink;
        ctx.lineWidth = Math.max(1, 0.95 * u);
        ctx.stroke();
        ctx.strokeStyle = fill(1.05);
        ctx.lineWidth = Math.max(0.6, 0.55 * u);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.rect(x - 2.2 * u, y - 3.6 * u, 4.4 * u, 0.9 * u);
      ctx.fillStyle = 'rgb(201, 174, 124)';
      ctx.fill();
      outline();
      break;
    }
    case 'trinkets': {
      // A cloth laid on the board with the pieces on it, catching the light.
      ctx.beginPath();
      ctx.moveTo(x - 3.4 * u, y);
      ctx.lineTo(x + 3 * u, y);
      ctx.lineTo(x + 3.8 * u, y - 1.6 * u);
      ctx.lineTo(x - 2.6 * u, y - 1.6 * u);
      ctx.closePath();
      ctx.fillStyle = 'rgb(116, 72, 120)';
      ctx.fill();
      outline();
      for (const [dx, dy, r] of [[-1.6, -0.9, 0.9], [0.4, -0.7, 1.1], [2.2, -1, 0.8]]) {
        ctx.beginPath();
        ctx.arc(x + dx * u, y + dy * u, r * u, 0, Math.PI * 2);
        ctx.fillStyle = fill(1.05);
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = lw * 0.6;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.fillRect(x + (dx - 0.35) * u, y + (dy - 0.45) * u, Math.max(0.6, 0.45 * u), Math.max(0.6, 0.45 * u));
      }
      break;
    }
    case 'crate':
    default:
      box(x, y, 4.2 * u, 3 * u, 2 * u, 1);
      break;
  }
}

/* ---- the front, kept ------------------------------------------------------------ */

/** A counter's front drawn onto a canvas of its own: where its corner is from the frame's origin, in its own pixels, and its scale against the screen's. */
interface Kept {
  canvas: HTMLCanvasElement;
  x0: number;
  y0: number;
  r: number;
}
const kept = new Map<string, Kept>();
let keptArea = 0;
/** Pixels of counter fronts kept before the ones drawn least lately are let go: about thirty megabytes. */
const KEPT_BUDGET = 8e6;
/** The zooms a front is drawn at, the first at or over the one it is wanted at, as a piece's bake is (`furniture.ts`); under one, at the zoom itself. */
const STEPS = [1, 1.5, 2, 3, 4, 5, 6];

/**
 * The board, the goods and the awning, drawn from a picture kept for this
 * look: drawn once at the first zoom step at or above this one, and blitted
 * down to it at the frame's origin, which is the only thing about the frame
 * that moves while the camera pans. `beyond` is from inside the shop, where
 * only what is seen through the opening is drawn. Under 0.6 there is nothing
 * worth keeping, and it is drawn as it is.
 */
export function drawCounterFrontKept(ctx: CanvasRenderingContext2D, g: CounterGeom, look: CounterLook, beyond: boolean, dpr: number): void {
  const throughHole = (c: CanvasRenderingContext2D, geom: CounterGeom, draw: () => void): void => {
    if (!beyond) { draw(); return; }
    c.save();
    counterHole(c, geom, 1); c.clip();
    counterHole(c, geom, -1); c.clip();
    draw();
    c.restore();
  };
  const zoom = look.zoom;
  if (zoom < 0.6) {
    throughHole(ctx, g, () => drawCounterFront(ctx, g, look));
    return;
  }
  const step = zoom < 1 ? Math.round(zoom * 20) / 20 : STEPS.find((v) => v >= zoom - 1e-3) ?? zoom;
  const r = step / zoom;
  const ox = g.px(0, 0, 0), oy = g.py(0, 0, 0);
  const rel = (t: number, k: number, s: number): [number, number] => [(g.px(t, k, s) - ox) * r, (g.py(t, k, s) - oy) * r];
  const axes = [rel(1, 0, 0), rel(0, 1, 0), rel(0, 0, 1)].flat().map((v) => v.toFixed(2)).join(',');
  const shown = Math.min(2 * WARES_SHOWN, Math.ceil(2 * WARES_SHOWN * look.full));
  const key = `${axes}|${step}|${dpr}|${look.street}|${beyond ? 1 : 0}|${look.lit.toFixed(3)}|${look.line}|${look.reveal}|${look.wood}|${look.woodLine}`
    + `|${look.stripe}|${look.wares.join(',')}|${shown}`;
  let k = kept.get(key);
  if (k) {
    kept.delete(key);
    kept.set(key, k);
  } else {
    // What it covers: the awning's corners out from the wall, the brackets under the board, and the tallest thing on the board over it.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of [C.t0 - C.awnWing - 0.02, C.t1 + C.awnWing + 0.02]) {
      for (const kk of [C.k0 - 0.2, C.k1 + C.awnBack + 0.02]) {
        for (const s of [0, look.street * C.awnOut]) {
          const [x, y] = rel(t, kk, s);
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
      }
    }
    const pad = 3 + 12 * step;
    x0 = Math.floor(x0 - pad); y0 = Math.floor(y0 - pad); x1 = Math.ceil(x1 + pad); y1 = Math.ceil(y1 + pad);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil((x1 - x0) * dpr));
    canvas.height = Math.max(1, Math.ceil((y1 - y0) * dpr));
    const bc = canvas.getContext('2d');
    if (!bc) return;
    bc.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg: CounterGeom = {
      px: (t, kk, s = 1) => (g.px(t, kk, s) - ox) * r - x0,
      py: (t, kk, s = 1) => (g.py(t, kk, s) - oy) * r - y0,
    };
    const bl: CounterLook = { ...look, zoom: step };
    throughHole(bc, bg, () => drawCounterFront(bc, bg, bl));
    k = { canvas, x0, y0, r };
    kept.set(key, k);
    keptArea += canvas.width * canvas.height;
    for (const [kk, old] of kept) {
      if (keptArea <= KEPT_BUDGET || old === k) break;
      kept.delete(kk);
      keptArea -= old.canvas.width * old.canvas.height;
    }
  }
  ctx.drawImage(k.canvas, ox + k.x0 / k.r, oy + k.y0 / k.r, k.canvas.width / dpr / k.r, k.canvas.height / dpr / k.r);
}
