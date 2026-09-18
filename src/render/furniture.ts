import { furnitureDef } from '../game/furniture';
import type { Side } from '../game/building';

/**
 * Furniture is drawn out of iso boxes: a top rhombus and the two faces you can
 * see. Twenty pieces share the one kit, so a chair and a larder are built the
 * same way and sit together on a floor.
 */
const TAU = Math.PI * 2;

interface Wood {
  top: string;
  left: string;
  right: string;
}

const WOODS: Record<string, Wood> = {
  oak: { top: '#a8814f', left: '#8b6a40', right: '#6d5231' },
  dark: { top: '#7e5a39', left: '#664728', right: '#4e351c' },
  pale: { top: '#c5a577', left: '#a98c60', right: '#8a7049' },
  grey: { top: '#9a9184', left: '#7f776b', right: '#645d53' },
};

const STONE = { top: '#b3aca1', left: '#948d83', right: '#767068' };
const IRON = { top: '#6f6a63', left: '#57534d', right: '#413e39' };
const LINEN = { top: '#e8e2d2', left: '#d3ccba', right: '#b9b2a0' };
const GREEN = { top: '#6f9a4e', left: '#5c823f', right: '#476631' };
const SOIL = { top: '#5b4530', left: '#4a3726', right: '#3a2b1d' };

/** Half-width and half-depth on screen of a block of subtiles. */
export function furnitureSpan(kind: string): [number, number] {
  const def = furnitureDef(kind);
  const n = def.w + def.h;
  return [n * 6, n * 3];
}

/** How tall a piece stands, in pixels at zoom 1. */
export const FURNITURE_HEIGHT: Record<string, number> = {
  brazier: 13,
  sign: 26,
  great_sign: 30,
  stool: 11,
  chair: 20,
  bench: 15,
  table: 15,
  long_table: 16,
  desk: 17,
  bed: 11,
  cot: 10,
  chest: 14,
  coffer: 9,
  cupboard: 26,
  wardrobe: 34,
  shelves: 28,
  bookshelf: 26,
  larder: 32,
  barrel: 22,
  lectern: 24,
  coat_rack: 30,
  planter: 10,
  firewood_rack: 17,
  crate_shelf: 18,
  hive: 22,
  spindle: 18,
  loom: 26,
  oven: 24,
  well: 22,
  bulk_bin: 24,
  trash_crate: 12,
  cart: 15,
  large_cart: 26,
  wagon: 34,
  small_barrel: 16,
  large_barrel: 38,
  rowing_boat: 16,
  sailing_boat: 40,
  banner: 26,
};

/**
 * An iso box at (x, y), W and D its half-diagonals, standing from `base` up
 * through `h`. Raising the base is what puts a table top on its legs rather
 * than turning the whole thing into a crate.
 */
function box(ctx: CanvasRenderingContext2D, x: number, y: number, W: number, D: number, h: number, wood: Wood, base = 0): void {
  const b = y - base;
  const t = b - h;
  ctx.fillStyle = wood.left;
  ctx.beginPath();
  ctx.moveTo(x - W, t);
  ctx.lineTo(x, t + D);
  ctx.lineTo(x, b + D);
  ctx.lineTo(x - W, b);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = wood.right;
  ctx.beginPath();
  ctx.moveTo(x, t + D);
  ctx.lineTo(x + W, t);
  ctx.lineTo(x + W, b);
  ctx.lineTo(x, b + D);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = wood.top;
  ctx.beginPath();
  ctx.moveTo(x - W, t);
  ctx.lineTo(x, t + D);
  ctx.lineTo(x + W, t);
  ctx.lineTo(x, t - D);
  ctx.closePath();
  ctx.fill();
}

/** A leg or post: a narrow box. */
const post = (ctx: CanvasRenderingContext2D, x: number, y: number, h: number, wood: Wood, thick = 1.7, base = 0): void =>
  box(ctx, x, y, thick, thick * 0.55, h, wood, base);

/** Four legs at the corners of a footprint. */
function legs(ctx: CanvasRenderingContext2D, W: number, D: number, h: number, wood: Wood, inset = 0.78): void {
  for (const [lx, ly] of [
    [-W * inset, 0],
    [W * inset, 0],
    [0, D * inset],
    [0, -D * inset],
  ] as Array<[number, number]>) {
    post(ctx, lx, ly, h, wood);
  }
}

/** Doors drawn on the two visible faces of a carcass. */
function doors(ctx: CanvasRenderingContext2D, W: number, D: number, top: number, bottom: number): void {
  ctx.fillStyle = 'rgba(28,18,8,0.24)';
  ctx.beginPath();
  ctx.moveTo(-W * 0.88, -top);
  ctx.lineTo(-0.8, -top + D * 0.88);
  ctx.lineTo(-0.8, -bottom + D * 0.88);
  ctx.lineTo(-W * 0.88, -bottom);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0.8, -top + D * 0.88);
  ctx.lineTo(W * 0.88, -top);
  ctx.lineTo(W * 0.88, -bottom);
  ctx.lineTo(0.8, -bottom + D * 0.88);
  ctx.closePath();
  ctx.fill();
  const mid = (top + bottom) / 2;
  ctx.fillStyle = '#e0cf95';
  for (const hx of [-2.8, 2.8]) {
    ctx.beginPath();
    ctx.arc(hx, -mid + D * 0.8, 0.95, 0, TAU);
    ctx.fill();
  }
}

/** Staves, hoops and a lid: one shape for all three sizes of barrel. */
function barrelShape(ctx: CanvasRenderingContext2D, W: number, D: number, h: number): void {
  const rx = W * 0.74;
  ctx.fillStyle = WOODS.dark.left;
  ctx.beginPath();
  ctx.moveTo(-rx, -h + D);
  ctx.bezierCurveTo(-rx * 1.22, -h * 0.6, -rx * 1.22, -h * 0.4, -rx, 0);
  ctx.ellipse(0, 0, rx, D * 0.8, 0, Math.PI, 0, true);
  ctx.bezierCurveTo(rx * 1.22, -h * 0.4, rx * 1.22, -h * 0.6, rx, -h + D);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = WOODS.pale.top;
  ctx.beginPath();
  ctx.ellipse(0, -h + D, rx, D * 0.8, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#46433e';
  ctx.lineWidth = 1.4;
  for (const k of [0.28, 0.72]) {
    ctx.beginPath();
    ctx.ellipse(0, -h * k + D * 0.4, rx * 1.1, D * 0.9, 0, 0.2, Math.PI - 0.2);
    ctx.stroke();
  }
}

/** A colour a piece has been dyed: the lit face and the shaded one. */
export interface Tint {
  colour: string;
  shade: string;
}
type Draw = (ctx: CanvasRenderingContext2D, W: number, D: number, h: number, lit?: boolean, tint?: Tint, trim?: number) => void;

const DRAW: Record<string, Draw> = {
  // A board across two posts. Whatever is written on it is drawn by the
  // renderer above the board itself, so all this has to be is the board.
  sign: (ctx, W, D, h, _lit, tint) => {
    const w = WOODS.oak;
    post(ctx, -W * 0.6, 0, h, w, 1.4);
    post(ctx, W * 0.6, 0, h, w, 1.4);
    void tint;
    box(ctx, 0, 0, W * 0.95, D * 0.22, h * 0.42, WOODS.pale, h * 0.5);
  },
  great_sign: (ctx, W, D, h, _lit, tint) => {
    const w = WOODS.oak;
    post(ctx, -W * 0.72, 0, h, w, 1.7);
    post(ctx, W * 0.72, 0, h, w, 1.7);
    void tint;
    box(ctx, 0, 0, W * 1.02, D * 0.24, h * 0.46, WOODS.pale, h * 0.48);
  },
  stool: (ctx, W, D, h) => {
    const w = WOODS.oak;
    for (const [lx, ly] of [[-W * 0.62, 0], [W * 0.62, 0], [0, -D * 0.7]] as Array<[number, number]>) post(ctx, lx, ly, h - 2, w, 1.5);
    box(ctx, 0, 0, W * 0.82, D * 0.82, 2, w, h - 2);
  },
  chair: (ctx, W, D, h) => {
    const w = WOODS.oak;
    const seat = h * 0.46;
    legs(ctx, W, D, seat, w);
    box(ctx, 0, 0, W * 0.8, D * 0.8, 2, w, seat);
    // Back: a panel standing up off the far edge.
    box(ctx, 0, -D * 0.64, W * 0.74, D * 0.16, h - seat - 2, w, seat + 2);
  },
  bench: (ctx, W, D, h) => {
    const w = WOODS.dark;
    const seat = h * 0.52;
    legs(ctx, W, D, seat, w, 0.88);
    box(ctx, 0, 0, W * 0.94, D * 0.82, 2.2, w, seat);
    box(ctx, 0, -D * 0.6, W * 0.88, D * 0.14, h - seat - 2.2, w, seat + 2.2);
  },
  table: (ctx, W, D, h) => {
    const w = WOODS.oak;
    legs(ctx, W, D, h - 2.5, w, 0.82);
    box(ctx, 0, 0, W * 0.96, D * 0.96, 2.5, w, h - 2.5);
  },
  long_table: (ctx, W, D, h) => {
    const w = WOODS.dark;
    for (const lx of [-W * 0.8, 0, W * 0.8]) {
      post(ctx, lx - W * 0.06, D * 0.55, h - 2.5, w);
      post(ctx, lx + W * 0.06, -D * 0.55, h - 2.5, w);
    }
    box(ctx, 0, 0, W * 0.97, D * 0.97, 2.5, w, h - 2.5);
  },
  desk: (ctx, W, D, h) => {
    const w = WOODS.dark;
    legs(ctx, W, D, h - 2.5, w, 0.88);
    // A block of drawers hung under one end.
    box(ctx, -W * 0.42, -D * 0.08, W * 0.4, D * 0.4, h * 0.55, WOODS.oak, h * 0.3);
    box(ctx, 0, 0, W * 0.97, D * 0.97, 2.5, w, h - 2.5);
    ctx.fillStyle = '#e0cf95';
    for (const dy of [0, 4]) {
      ctx.beginPath();
      ctx.arc(-W * 0.42, -h * 0.5 + dy + D * 0.4, 0.85, 0, TAU);
      ctx.fill();
    }
  },
  bed: (ctx, W, D, h) => {
    const w = WOODS.dark;
    legs(ctx, W, D, h * 0.45, w, 0.9);
    box(ctx, 0, 0, W * 0.94, D * 0.94, h * 0.3, w, h * 0.45);
    box(ctx, W * 0.04, 0, W * 0.88, D * 0.88, h * 0.32, LINEN, h * 0.7);
    // Headboard at the far end, and a pillow under it.
    box(ctx, -W * 0.86, D * 0.42, W * 0.16, D * 0.2, h + 8, w);
    box(ctx, -W * 0.56, D * 0.26, W * 0.2, D * 0.46, 3, { top: '#f6f2e8', left: '#e0dbce', right: '#c9c4b6' }, h * 1.02);
  },
  cot: (ctx, W, D, h) => {
    const w = WOODS.pale;
    legs(ctx, W, D, h * 0.5, w, 0.86);
    box(ctx, 0, 0, W * 0.9, D * 0.9, h * 0.28, w, h * 0.5);
    box(ctx, 0, 0, W * 0.84, D * 0.84, h * 0.3, LINEN, h * 0.78);
  },
  chest: (ctx, W, D, h) => {
    box(ctx, 0, 0, W * 0.9, D * 0.9, h * 0.68, WOODS.dark);
    box(ctx, 0, 0, W * 0.95, D * 0.95, h * 0.32, WOODS.oak, h * 0.68);
    ctx.strokeStyle = '#46433e';
    ctx.lineWidth = 1.5;
    for (const k of [-0.5, 0.5]) {
      const bx = W * 0.62 * k;
      ctx.beginPath();
      ctx.moveTo(bx, -h + D * 0.9 - Math.abs(k) * D * 0.2);
      ctx.lineTo(bx, -h * 0.1 + D * 0.75 - Math.abs(k) * D * 0.2);
      ctx.stroke();
    }
    ctx.fillStyle = '#e0cf95';
    ctx.beginPath();
    ctx.arc(0, -h * 0.62 + D * 0.9, 1.2, 0, TAU);
    ctx.fill();
  },
  coffer: (ctx, W, D, h) => {
    box(ctx, 0, 0, W * 0.8, D * 0.8, h * 0.65, WOODS.grey);
    box(ctx, 0, 0, W * 0.86, D * 0.86, h * 0.35, WOODS.dark, h * 0.65);
    ctx.fillStyle = '#e0cf95';
    ctx.beginPath();
    ctx.arc(0, -h * 0.58 + D * 0.8, 1, 0, TAU);
    ctx.fill();
  },
  cupboard: (ctx, W, D, h) => {
    box(ctx, 0, 0, W * 0.9, D * 0.9, h, WOODS.oak);
    doors(ctx, W * 0.9, D * 0.9, h - 3, 3);
  },
  wardrobe: (ctx, W, D, h) => {
    box(ctx, 0, 0, W * 0.88, D * 0.88, h - 3, WOODS.dark);
    box(ctx, 0, 0, W * 0.96, D * 0.96, 3, WOODS.oak, h - 3);
    doors(ctx, W * 0.88, D * 0.88, h - 6, 3);
  },
  shelves: (ctx, W, D, h) => {
    const w = WOODS.pale;
    post(ctx, -W * 0.9, 0, h, w, 2);
    post(ctx, W * 0.9, 0, h, w, 2);
    for (const k of [0.06, 0.36, 0.66, 0.94]) box(ctx, 0, 0, W * 0.88, D * 0.88, 1.6, w, h * k);
    // Odds and ends left on two of the boards.
    ctx.fillStyle = '#8a6a44';
    ctx.fillRect(-W * 0.45, -h * 0.36 - 4, 4.5, 4);
    ctx.fillStyle = '#9a8a5e';
    ctx.fillRect(W * 0.12, -h * 0.66 - 5, 5, 5);
    ctx.fillStyle = '#6f7a3a';
    ctx.fillRect(-W * 0.1, -h * 0.96 - 4, 3.5, 4);
  },
  bookshelf: (ctx, W, D, h) => {
    const w = WOODS.dark;
    box(ctx, 0, 0, W * 0.9, D * 0.9, h - 3, w);
    box(ctx, 0, 0, W * 0.97, D * 0.97, 3, WOODS.oak, h - 3);
    // Rows of books standing on the open face, following its slant.
    const colors = ['#8c3f34', '#3f5c8c', '#6f7a3a', '#8c6a2f', '#5a3b6b'];
    for (let row = 0; row < 3; row++) {
      const y = -(h - 6) * (0.24 + row * 0.3);
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        const bx = -W * 0.78 + t * W * 0.68;
        ctx.fillStyle = colors[(row * 2 + i) % colors.length];
        ctx.fillRect(bx, y + t * D * 0.8, 2.1, 5.2);
      }
    }
  },
  larder: (ctx, W, D, h) => {
    box(ctx, 0, 0, W * 0.92, D * 0.92, h, WOODS.oak);
    doors(ctx, W * 0.92, D * 0.92, h - 9, 3);
    // Slatted vents along the top, so what is inside keeps.
    ctx.strokeStyle = 'rgba(40,26,14,0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const y = -h + 3 + i * 2.1;
      ctx.beginPath();
      ctx.moveTo(-W * 0.74, y + D * 0.18);
      ctx.lineTo(0, y + D * 0.92);
      ctx.lineTo(W * 0.74, y + D * 0.18);
      ctx.stroke();
    }
  },
  barrel: (ctx, W, D, h) => barrelShape(ctx, W, D, h),
  small_barrel: (ctx, W, D, h) => barrelShape(ctx, W, D, h),
  large_barrel: (ctx, W, D, h) => barrelShape(ctx, W, D, h),
  oven: (ctx, W, D, h, lit) => {
    // A brick box with an arched mouth, and a short chimney off the back.
    box(ctx, 0, 0, W * 0.94, D * 0.94, h * 0.78, STONE);
    box(ctx, 0, -D * 0.3, W * 0.5, D * 0.4, h * 0.22, STONE, h * 0.78);
    post(ctx, W * 0.34, -D * 0.52, h * 0.4, STONE, 2.4, h);
    // Courses, so it reads as brick rather than one lump.
    ctx.strokeStyle = 'rgba(40,34,28,0.22)';
    ctx.lineWidth = 0.8;
    for (let i = 1; i < 4; i++) {
      const y = -h * 0.78 * (i / 4);
      ctx.beginPath();
      ctx.moveTo(-W * 0.94, y);
      ctx.lineTo(0, y + D * 0.94);
      ctx.lineTo(W * 0.94, y);
      ctx.stroke();
    }
    // The mouth, facing the viewer, alight or cold.
    ctx.fillStyle = lit ? '#ffb347' : '#2a1d12';
    ctx.beginPath();
    ctx.moveTo(-W * 0.36, -h * 0.12 + D * 0.62);
    ctx.lineTo(-W * 0.36, -h * 0.42 + D * 0.62);
    ctx.quadraticCurveTo(0, -h * 0.62 + D * 0.62, W * 0.36, -h * 0.42 + D * 0.62);
    ctx.lineTo(W * 0.36, -h * 0.12 + D * 0.62);
    ctx.closePath();
    ctx.fill();
  },
  brazier: (ctx, W, D, h, lit) => {
    /*
     * A shallow bowl of brick on a short stem, banded with iron, with the fire
     * sitting proud of the rim rather than shut behind a mouth — which is the
     * whole difference between this and the oven above it. Cold it is a stone
     * dish; lit it is the brightest thing on a deed at night.
     */
    post(ctx, 0, 0, h * 0.5, STONE, W * 0.34);
    box(ctx, 0, 0, W * 0.72, D * 0.72, h * 0.22, STONE, h * 0.5);
    // The iron band round the lip.
    ctx.strokeStyle = IRON.left;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(0, -h * 0.72 + D * 0.72, W * 0.72, D * 0.55, 0, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = 1;
    // What is in the bowl: embers, or cold ash.
    const cy = -h * 0.74 + D * 0.72;
    ctx.fillStyle = lit ? '#ff9c2e' : '#3a332c';
    ctx.beginPath();
    ctx.ellipse(0, cy, W * 0.55, D * 0.4, 0, 0, TAU);
    ctx.fill();
    if (!lit) return;
    // And the flame over it, which is what anybody actually sees of one.
    // Two tongues rather than one, and neither of them centred: a single
    // symmetrical cone reads as a traffic cone, not as fire.
    ctx.fillStyle = 'rgba(255,196,96,0.92)';
    ctx.beginPath();
    ctx.moveTo(-W * 0.46, cy);
    ctx.bezierCurveTo(-W * 0.4, cy - h * 0.45, -W * 0.14, cy - h * 0.5, -W * 0.06, cy - h * 0.92);
    ctx.bezierCurveTo(W * 0.14, cy - h * 0.52, W * 0.36, cy - h * 0.4, W * 0.46, cy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,240,196,0.92)';
    ctx.beginPath();
    ctx.moveTo(-W * 0.2, cy);
    ctx.bezierCurveTo(-W * 0.18, cy - h * 0.24, W * 0.02, cy - h * 0.3, W * 0.06, cy - h * 0.58);
    ctx.bezierCurveTo(W * 0.14, cy - h * 0.28, W * 0.2, cy - h * 0.2, W * 0.22, cy);
    ctx.closePath();
    ctx.fill();
  },
  well: (ctx, W, D, h) => {
    // A stone kerb with a dark shaft in it, and a windlass over the top.
    box(ctx, 0, 0, W * 0.9, D * 0.9, h * 0.34, STONE);
    ctx.fillStyle = '#161f26';
    ctx.beginPath();
    ctx.ellipse(0, -h * 0.34, W * 0.58, D * 0.58, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(96,150,170,0.55)';
    ctx.beginPath();
    ctx.ellipse(0, -h * 0.34 + 1, W * 0.42, D * 0.42, 0, 0, TAU);
    ctx.fill();
    const w = WOODS.dark;
    post(ctx, -W * 0.74, 0, h * 0.6, w, 1.8, h * 0.34);
    post(ctx, W * 0.74, 0, h * 0.6, w, 1.8, h * 0.34);
    box(ctx, 0, 0, W * 0.86, D * 0.16, 2.2, w, h * 0.94);
    // The bucket, hung off the crossbar.
    box(ctx, 0, 0, W * 0.2, D * 0.2, 4, WOODS.pale, h * 0.62);
  },
  bulk_bin: (ctx, W, D, h) => {
    const w = WOODS.grey;
    box(ctx, 0, 0, W * 0.96, D * 0.96, h - 2, w);
    box(ctx, 0, 0, W * 0.99, D * 0.99, 2, WOODS.dark, h - 2);
    // Board lines down the faces, and a lid split across the top.
    ctx.strokeStyle = 'rgba(30,24,16,0.28)';
    ctx.lineWidth = 0.8;
    for (const t of [-0.5, 0, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(W * t * 0.96, -h + 2 + Math.abs(t) * 0 + D * 0.96 * (1 - Math.abs(t)) - D * 0.96 + D * 0.96);
      ctx.lineTo(W * t * 0.96, -2 + D * 0.96 * (1 - Math.abs(t)));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-W * 0.99, -h);
    ctx.lineTo(W * 0.99, -h);
    ctx.stroke();
  },
  trash_crate: (ctx, W, D, h) => {
    const w = WOODS.grey;
    // Four corner posts and slats: an open crate with nothing to keep the rain off.
    for (const [lx, ly] of [[-W * 0.86, 0], [W * 0.86, 0], [0, D * 0.86], [0, -D * 0.86]] as Array<[number, number]>) post(ctx, lx, ly, h, w, 1.5);
    for (const k of [0.18, 0.62]) box(ctx, 0, 0, W * 0.9, D * 0.9, 1.6, w, h * k);
    ctx.fillStyle = 'rgba(40,48,30,0.5)';
    ctx.beginPath();
    ctx.ellipse(0, -h * 0.5, W * 0.6, D * 0.5, 0, 0, TAU);
    ctx.fill();
  },
  cart: (ctx, W, D, h) => {
    const w = WOODS.oak;
    const deck = h * 0.52;
    // The shafts first, running out to where a hand would take hold.
    box(ctx, -W * 0.98, D * 0.24, W * 0.4, D * 0.06, 1.3, WOODS.pale, deck * 0.85);
    // The body, sitting on the axle.
    box(ctx, 0, 0, W * 0.78, D * 0.78, h - deck, w, deck);
    box(ctx, 0, 0, W * 0.82, D * 0.82, 1.6, WOODS.dark, h - 1.6);
    // Wheels last, so they stand out from the body rather than behind it.
    for (const wx of [-W * 0.8, W * 0.8]) {
      const wy = (wx / W) * D * 0.5;
      ctx.fillStyle = WOODS.dark.left;
      ctx.beginPath();
      ctx.ellipse(wx, -deck * 0.62 + wy, 2.4, deck * 0.72, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = IRON.top;
      ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.fillStyle = IRON.top;
      ctx.beginPath();
      ctx.ellipse(wx, -deck * 0.62 + wy, 0.9, 1.4, 0, 0, TAU);
      ctx.fill();
    }
  },
  large_cart: (ctx, W, D, h) => {
    const w = WOODS.oak;
    const deck = h * 0.44;
    // Far wheel first, then the body over it, then the near one in front.
    wheel(ctx, W * 0.66, -deck * 0.5 + D * 0.33, 3.6, deck * 0.95);
    // Shafts running forward off the near corner, where the yokes buckle on.
    box(ctx, -W * 0.72, D * 0.36, W * 0.5, D * 0.05, 1.4, WOODS.pale, deck * 0.8);
    box(ctx, -W * 0.72, D * 0.2, W * 0.5, D * 0.05, 1.4, WOODS.pale, deck * 0.8);
    // Bed, sideboards and the seat over the axle.
    box(ctx, 0, 0, W * 0.7, D * 0.7, 2.2, w, deck);
    box(ctx, 0, 0, W * 0.66, D * 0.66, h - deck - 6, WOODS.dark, deck + 2.2);
    box(ctx, 0, 0, W * 0.7, D * 0.7, 1.6, WOODS.pale, h - 6);
    box(ctx, W * 0.16, D * 0.08, W * 0.26, D * 0.26, 4, w, h - 4);
    wheel(ctx, -W * 0.66, -deck * 0.5 - D * 0.33, 3.6, deck * 0.95);
  },
  wagon: (ctx, W, D, h) => {
    const deck = h * 0.36;
    // Two wheels on the far side go under the bed; two on the near side sit
    // proud of it, which is what makes it read as four rather than two.
    wheel(ctx, W * 0.62, -deck * 0.5, 3.8, deck);
    wheel(ctx, 0, -deck * 0.5 - D * 0.62, 3.8, deck);
    // A long low bed, banded, with boards up the sides.
    box(ctx, 0, 0, W * 0.8, D * 0.8, 2.6, WOODS.oak, deck);
    box(ctx, 0, 0, W * 0.76, D * 0.76, h - deck - 8, WOODS.dark, deck + 2.6);
    box(ctx, 0, 0, W * 0.8, D * 0.8, 1.8, WOODS.pale, h - 8);
    // Driver's box at the head of it, and the pole the four yokes hang off.
    box(ctx, -W * 0.2, D * 0.3, W * 0.26, D * 0.2, 6, WOODS.oak, h - 6);
    box(ctx, -W * 0.9, D * 0.3, W * 0.5, D * 0.04, 1.6, WOODS.pale, deck * 0.75);
    wheel(ctx, -W * 0.62, -deck * 0.5, 3.8, deck);
    wheel(ctx, 0, -deck * 0.5 + D * 0.62, 3.8, deck);
  },
  spindle: (ctx, W, D, h) => {
    const w = WOODS.pale;
    legs(ctx, W, D, h * 0.5, w, 0.6);
    box(ctx, 0, 0, W * 0.7, D * 0.7, 2, w, h * 0.5);
    post(ctx, 0, 0, h * 0.42, WOODS.dark, 1.2, h * 0.52);
    ctx.fillStyle = LINEN.top;
    ctx.beginPath();
    ctx.ellipse(0, -h * 0.78, 3.2, 2.4, 0, 0, TAU);
    ctx.fill();
  },
  loom: (ctx, W, D, h) => {
    const w = WOODS.dark;
    post(ctx, -W * 0.8, 0, h, w, 2);
    post(ctx, W * 0.8, 0, h, w, 2);
    box(ctx, 0, 0, W * 0.9, D * 0.14, 2.4, w, h - 2.4);
    box(ctx, 0, 0, W * 0.9, D * 0.14, 2.4, w, h * 0.24);
    // The warp, strung between the beams.
    ctx.strokeStyle = LINEN.left;
    ctx.lineWidth = 0.7;
    for (let i = -4; i <= 4; i++) {
      const x = (i / 4) * W * 0.72;
      ctx.beginPath();
      ctx.moveTo(x, -h + 2.4);
      ctx.lineTo(x, -h * 0.28);
      ctx.stroke();
    }
  },
  lectern: (ctx, W, D, h) => {
    const w = WOODS.dark;
    box(ctx, 0, 0, W * 0.62, D * 0.62, 2, w);
    post(ctx, 0, 0, h - 7, w, 2.2, 2);
    ctx.fillStyle = WOODS.pale.top;
    ctx.beginPath();
    ctx.moveTo(-W * 0.8, -h + 4);
    ctx.lineTo(0, -h + 4 + D * 0.8);
    ctx.lineTo(W * 0.8, -h - 2);
    ctx.lineTo(0, -h - 2 - D * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(248,244,232,0.92)';
    ctx.beginPath();
    ctx.ellipse(0, -h + 1, W * 0.38, D * 0.38, 0, 0, TAU);
    ctx.fill();
  },
  coat_rack: (ctx, W, D, h) => {
    const w = WOODS.dark;
    box(ctx, 0, 0, W * 0.52, D * 0.52, 2.5, w);
    post(ctx, 0, 0, h - 3, w, 1.6, 2.5);
    ctx.strokeStyle = w.top;
    ctx.lineWidth = 1.7;
    ctx.lineCap = 'round';
    for (const [dx, dy] of [[-1, -0.5], [1, -0.5], [-1, 0.5], [1, 0.5]] as Array<[number, number]>) {
      ctx.beginPath();
      ctx.moveTo(0, -h + 5);
      ctx.lineTo(dx * W * 0.55, -h + 8 + dy * D * 0.6);
      ctx.stroke();
    }
    // Somebody's hat, left on a peg.
    ctx.fillStyle = '#6d5a3c';
    ctx.beginPath();
    ctx.ellipse(-W * 0.5, -h + 10, 4.2, 1.9, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-W * 0.5, -h + 10.5, 2.4, 2.4, 0, Math.PI, 0, true);
    ctx.fill();
  },
  planter: (ctx, W, D, h) => {
    box(ctx, 0, 0, W * 0.9, D * 0.9, h, WOODS.pale);
    box(ctx, 0, 0, W * 0.78, D * 0.78, 1, SOIL, h);
    ctx.fillStyle = GREEN.top;
    for (let i = 0; i < 7; i++) {
      const t = (i / 6 - 0.5) * 2;
      const bx = t * W * 0.62;
      ctx.beginPath();
      ctx.ellipse(bx, -h - 3 + Math.abs(t) * D * 0.4, 1.8, 3.6, t * 0.55, 0, TAU);
      ctx.fill();
    }
  },
  /*
   * The crate rack, and the eight spots on its deck.
   *
   * Two subtiles across and four deep, and the model has to say at a glance
   * how much of it is full — that is the whole point of building one, and it
   * is what was asked for: a picture for every count from nought to eight.
   *
   * The spots are not a count though, they are places. `trim` carries a mask
   * of which of the eight subtiles has a crate on it, so a rack with the far
   * pair loaded and the near six empty looks like that rather than like two
   * crates at the front. Every count from 0 to 8 still draws, which is what
   * the nine models were for; this simply also tells the truth about where.
   *
   * Drawn back to front, so a crate nearer the viewer laps the one behind it.
   */
  crate_shelf: (ctx, W, D, h, _lit, _tint, trim) => {
    const frame = WOODS.dark;
    const deck = WOODS.oak;
    legs(ctx, W, D, h - 3, frame, 0.9);
    box(ctx, 0, 0, W * 0.97, D * 0.97, 2.6, deck, h - 3);

    /*
     * The eight spots, at the middle of the eight subtiles they are.
     *
     * A block of `w` by `h` subtiles spans `(w + h)` steps of half-width
     * between its far corners, and `W` is that whole half-width — so one
     * subtile is `W / 3` across for a two-by-four, and `D / 3` down. Stepping
     * along the two-wide axis moves right and down; along the four-deep axis,
     * left and down. That is the whole of the arithmetic, and getting it half
     * right is how eight crates end up huddled in the middle of a deck built
     * for eight.
     */
    const stepX = W / 3;
    const stepY = D / 3;
    const spots: Array<[number, number, number]> = [];
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 2; i++) {
        spots.push([(i - j) * stepX + stepX, (i + j + 1) * stepY - D, j * 2 + i]);
      }
    }

    // Back to front, so a crate nearer the viewer laps the one behind it.
    const mask = trim ?? 0;
    const top = h - 0.4;
    const s = W * 0.22;
    const order = spots.sort((a, b) => a[1] - b[1]);
    /*
     * A pair of runners under every spot, filled or not.
     *
     * Without them an empty rack is a table, and a rack with two crates on it
     * is a table with two crates on it — there is nothing to say the other six
     * places exist. They are also the thing the refusal talks about when a log
     * crate is offered: it will not sit on the runners.
     */
    for (const [cx, cy] of order) {
      box(ctx, cx, cy, s * 1.06, s * 0.53, 1.1, WOODS.grey, top);
    }
    for (const [cx, cy, n] of order) {
      if (!(mask & (1 << n))) continue;
      box(ctx, cx, cy, s, s * 0.5, s * 1.25, WOODS.pale, top + 1.1);
      /*
       * A band round the middle and a line down the corner, which is what
       * makes a pale block read as a crate at the size these are drawn. The
       * ground crate has the same two marks for the same reason.
       */
      const lid = cy - top - 1.1 - s * 1.25;
      ctx.strokeStyle = 'rgba(64,44,26,0.45)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(cx - s, lid + s * 0.5 + s * 0.62);
      ctx.lineTo(cx, lid + s * 0.5 * 2 + s * 0.62);
      ctx.lineTo(cx + s, lid + s * 0.5 + s * 0.62);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, lid + s);
      ctx.lineTo(cx, lid + s + s * 1.25);
      ctx.stroke();
    }
  },
  firewood_rack: (ctx, W, D, h) => {
    const w = WOODS.grey;
    post(ctx, -W * 0.86, 0, h, w, 1.6);
    post(ctx, W * 0.86, 0, h, w, 1.6);
    box(ctx, 0, 0, W * 0.9, D * 0.9, 2.5, w);
    // Log ends stacked between the uprights.
    const ends = ['#8a6a44', '#7b5c3a', '#95784f'];
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 4 - row; i++) {
        const bx = -W * 0.52 + i * (W * 0.3) + row * (W * 0.15);
        ctx.fillStyle = ends[(row + i) % ends.length];
        ctx.beginPath();
        ctx.ellipse(bx, -5.5 - row * 4.2 + (bx / W) * D * 0.7, 2.6, 2.3, 0, 0, TAU);
        ctx.fill();
      }
    }
  },
  rowing_boat: (ctx, W, D, h) => {
    hull(ctx, W, D, h, WOODS.pale);
    // Two oars shipped along the thwarts.
    ctx.strokeStyle = WOODS.dark.top;
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-W * 0.6, -h * 0.5 + s * D * 0.3);
      ctx.lineTo(W * 0.55, -h * 0.55 + s * D * 0.3);
      ctx.stroke();
    }
  },
  sailing_boat: (ctx, W, D, h, _lit, tint, trim) => {
    hull(ctx, W, D, h * 0.45, WOODS.oak);
    // A mast with the sail bent on, leaning the way she is going.
    const mh = h * 0.95;
    ctx.strokeStyle = WOODS.dark.top;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.45);
    ctx.lineTo(0, -mh);
    ctx.stroke();
    // The sail goes out on whichever side the wind is on, and empties when
    // she is pointed into it.
    const set = trim ?? 1;
    const belly = Math.max(0.12, Math.abs(set));
    const side = set < 0 ? -1 : 1;
    ctx.fillStyle = tint?.colour ?? LINEN.top;
    ctx.beginPath();
    ctx.moveTo(0.6 * side, -mh + 1);
    ctx.quadraticCurveTo(side * W * 0.62 * belly, -mh * 0.72, side * W * 0.34 * belly, -h * 0.46);
    ctx.lineTo(0.6 * side, -h * 0.46);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = tint?.shade ?? LINEN.right;
    ctx.beginPath();
    ctx.moveTo(0.6 * side, -mh + 1);
    ctx.quadraticCurveTo(side * W * 0.3 * belly, -mh * 0.7, side * W * 0.16 * belly, -h * 0.46);
    ctx.lineTo(0.6 * side, -h * 0.46);
    ctx.closePath();
    ctx.fill();
  },
  banner: (ctx, W, D, h, _lit, tint) => {
    // A staff out of the ground with a long cloth hanging off a crosspiece.
    ctx.strokeStyle = WOODS.dark.top;
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-0.5, -h + 1.5);
    ctx.lineTo(W * 1.05, -h + 1.5);
    ctx.stroke();
    const top = tint?.colour ?? LINEN.top;
    const shade = tint?.shade ?? LINEN.right;
    // Two panels, so there is a lit side and a shaded one and it reads as cloth.
    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.moveTo(0, -h + 2);
    ctx.lineTo(W, -h + 2);
    ctx.lineTo(W, -h * 0.3);
    ctx.quadraticCurveTo(W * 0.5, -h * 0.2, 0, -h * 0.32);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.moveTo(W * 0.55, -h + 2);
    ctx.lineTo(W, -h + 2);
    ctx.lineTo(W, -h * 0.3);
    ctx.quadraticCurveTo(W * 0.77, -h * 0.24, W * 0.55, -h * 0.27);
    ctx.closePath();
    ctx.fill();
  },
  hive: (ctx, W, D, h) => {
    // Four shallow boxes stacked, a flat lid on top and a landing board at
    // the mouth, with the swarm going in and out of it.
    const boxes = 4;
    const each = (h - 3) / boxes;
    for (let i = 0; i < boxes; i++) {
      box(ctx, 0, 0, W * 0.62, D * 0.62, each - 0.6, i % 2 ? WOODS.pale : WOODS.oak, i * each);
    }
    box(ctx, 0, 0, W * 0.72, D * 0.72, 2.2, WOODS.grey, h - 2.2);
    box(ctx, W * 0.5, 0, W * 0.26, D * 0.26, 1, WOODS.pale, 1.5);
    // The mouth, cut low on the south face.
    ctx.fillStyle = '#2b2118';
    ctx.beginPath();
    ctx.ellipse(W * 0.3, -3 + D * 0.3, 2.6, 1.1, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#d8b858';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 1.1;
      ctx.beginPath();
      ctx.ellipse(W * 0.36 + Math.cos(a) * W * 0.5, -h * 0.55 + Math.sin(a) * D * 1.5, 0.9, 0.7, 0, 0, TAU);
      ctx.fill();
    }
  },
};

/**
 * A hull seen from above and a little to one side: a pointed thing sitting in
 * the water with its sheer showing.
 */
function hull(ctx: CanvasRenderingContext2D, W: number, D: number, h: number, wood: Wood): void {
  // The water it displaces.
  ctx.fillStyle = 'rgba(30,60,90,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 0, W * 1.05, D * 1.05, 0, 0, TAU);
  ctx.fill();
  // The deck, drawn as a long rhombus with the bow and stern drawn out.
  ctx.fillStyle = wood.top;
  ctx.beginPath();
  ctx.moveTo(W * 1.02, -h * 0.5 - D * 0.05);
  ctx.quadraticCurveTo(W * 0.3, -h * 0.5 + D * 0.85, -W * 0.86, -h * 0.5 + D * 0.18);
  ctx.quadraticCurveTo(-W * 0.5, -h * 0.5 - D * 0.8, W * 1.02, -h * 0.5 - D * 0.05);
  ctx.closePath();
  ctx.fill();
  // The side below the sheer.
  ctx.fillStyle = wood.right;
  ctx.beginPath();
  ctx.moveTo(W * 1.02, -h * 0.5 - D * 0.05);
  ctx.quadraticCurveTo(W * 0.3, -h * 0.5 + D * 0.85, -W * 0.86, -h * 0.5 + D * 0.18);
  ctx.lineTo(-W * 0.86, D * 0.18);
  ctx.quadraticCurveTo(W * 0.3, D * 0.85, W * 1.02, -D * 0.05);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = wood.left;
  ctx.beginPath();
  ctx.moveTo(-W * 0.86, -h * 0.5 + D * 0.18);
  ctx.quadraticCurveTo(-W * 0.5, -h * 0.5 - D * 0.8, W * 1.02, -h * 0.5 - D * 0.05);
  ctx.lineTo(W * 1.02, -D * 0.05);
  ctx.quadraticCurveTo(-W * 0.5, -D * 0.8, -W * 0.86, D * 0.18);
  ctx.closePath();
  ctx.fill();
}

/** A spoked wheel on its edge, seen from the side. */
function wheel(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.fillStyle = WOODS.dark.left;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = IRON.top;
  ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.strokeStyle = WOODS.pale.top;
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(a) * rx * 0.9, y - Math.sin(a) * ry * 0.9);
    ctx.lineTo(x + Math.cos(a) * rx * 0.9, y + Math.sin(a) * ry * 0.9);
    ctx.stroke();
  }
  ctx.fillStyle = IRON.top;
  ctx.beginPath();
  ctx.ellipse(x, y, rx * 0.35, ry * 0.22, 0, 0, TAU);
  ctx.fill();
}

/** Draw one piece with its floor contact at (sx, sy). */
/**
 * Which way round a piece is drawn.
 *
 * The drawings have one face, and it is the south face at the first
 * viewpoint. A piece turned a quarter across the tile shows that face in the
 * mirror, since the two diagonals of the tile are each other's reflection on
 * screen; turned a half it shows the face again. Eight viewpoints and four
 * facings meet here, so a quarter turn of the view or of the piece flips it,
 * which is what keeps a piece standing the way it was set while the view goes
 * round it. The eighth turns fall on the nearer of the two.
 */
const FACING_TURN: Record<Side, number> = { s: 0, w: 2, n: 4, e: 6 };
export const mirroredAt = (facing: Side, rotation: number): boolean =>
  (((((FACING_TURN[facing] - rotation) % 8) + 8) % 8) >> 1) % 2 === 1;

export function drawFurniture(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, kind: string, lit = false, tint?: Tint, trim?: number, mirror = false): void {
  const [W, D] = furnitureSpan(kind);
  const h = FURNITURE_HEIGHT[kind] ?? 14;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  if (mirror) ctx.scale(-1, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.beginPath();
  ctx.ellipse(0, 0, W * 0.95, D * 0.95, 0, 0, TAU);
  ctx.fill();
  (DRAW[kind] ?? DRAW.chest)(ctx, W, D, h, lit, tint, trim);
  ctx.restore();
}
