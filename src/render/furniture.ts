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
  crate_shelf: 32,
  hive: 22,
  spindle: 18,
  loom: 26,
  oven: 24,
  well: 22,
  bulk_bin: 24,
  craft_bin: 24,
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
type Draw = (ctx: CanvasRenderingContext2D, W: number, D: number, h: number, lit?: boolean, tint?: Tint, trim?: number, turn?: PieceTurn) => void;

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
  chair: (ctx, W, D, h, _lit, _tint, _trim, turn) => {
    const w = WOODS.oak;
    const seat = h * 0.46;
    /*
     * The back panel stands off the edge the chair does not face, so which
     * edge that is on screen depends on where you are standing. Sit in front
     * of a chair and the back is behind the seat; walk round it and the back
     * is the nearer of the two, with the seat behind it.
     */
    const away = turn?.behind ? 1 : -1;
    legs(ctx, W, D, seat, w);
    if (turn?.behind) box(ctx, 0, D * 0.64 * -away, W * 0.74, D * 0.16, h - seat - 2, w, seat + 2);
    box(ctx, 0, 0, W * 0.8, D * 0.8, 2, w, seat);
    if (!turn?.behind) box(ctx, 0, D * 0.64 * away, W * 0.74, D * 0.16, h - seat - 2, w, seat + 2);
  },
  bench: (ctx, W, D, h, _lit, _tint, _trim, turn) => {
    const w = WOODS.dark;
    const seat = h * 0.52;
    const away = turn?.behind ? 1 : -1;
    legs(ctx, W, D, seat, w, 0.88);
    if (turn?.behind) box(ctx, 0, D * 0.6 * -away, W * 0.88, D * 0.14, h - seat - 2.2, w, seat + 2.2);
    box(ctx, 0, 0, W * 0.94, D * 0.82, 2.2, w, seat);
    if (!turn?.behind) box(ctx, 0, D * 0.6 * away, W * 0.88, D * 0.14, h - seat - 2.2, w, seat + 2.2);
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
  desk: (ctx, W, D, h, _lit, _tint, _trim, turn) => {
    const w = WOODS.dark;
    legs(ctx, W, D, h - 2.5, w, 0.88);
    // A block of drawers hung under one end, on the side you sit at.
    box(ctx, -W * 0.42, -D * 0.08, W * 0.4, D * 0.4, h * 0.55, WOODS.oak, h * 0.3);
    box(ctx, 0, 0, W * 0.97, D * 0.97, 2.5, w, h - 2.5);
    onFront(ctx, W, h, turn?.face ?? 'both', () => {
      ctx.fillStyle = '#e0cf95';
      for (const dy of [0, 4]) {
        ctx.beginPath();
        ctx.arc(-W * 0.42, -h * 0.5 + dy + D * 0.4, 0.85, 0, TAU);
        ctx.fill();
      }
    });
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
  chest: (ctx, W, D, h, _lit, _tint, _trim, turn) => {
    box(ctx, 0, 0, W * 0.9, D * 0.9, h * 0.68, WOODS.dark);
    box(ctx, 0, 0, W * 0.95, D * 0.95, h * 0.32, WOODS.oak, h * 0.68);
    // The bands run over the lid either way; the lock is on the front alone.
    ctx.strokeStyle = '#46433e';
    ctx.lineWidth = 1.5;
    for (const k of [-0.5, 0.5]) {
      const bx = W * 0.62 * k;
      ctx.beginPath();
      ctx.moveTo(bx, -h + D * 0.9 - Math.abs(k) * D * 0.2);
      ctx.lineTo(bx, -h * 0.1 + D * 0.75 - Math.abs(k) * D * 0.2);
      ctx.stroke();
    }
    onFront(ctx, W, h, turn?.face ?? 'both', () => {
      ctx.fillStyle = '#e0cf95';
      ctx.beginPath();
      ctx.arc(0, -h * 0.62 + D * 0.9, 1.2, 0, TAU);
      ctx.fill();
    });
  },
  coffer: (ctx, W, D, h, _lit, _tint, _trim, turn) => {
    box(ctx, 0, 0, W * 0.8, D * 0.8, h * 0.65, WOODS.grey);
    box(ctx, 0, 0, W * 0.86, D * 0.86, h * 0.35, WOODS.dark, h * 0.65);
    onFront(ctx, W, h, turn?.face ?? 'both', () => {
      ctx.fillStyle = '#e0cf95';
      ctx.beginPath();
      ctx.arc(0, -h * 0.58 + D * 0.8, 1, 0, TAU);
      ctx.fill();
    });
  },
  cupboard: (ctx, W, D, h, _lit, _tint, _trim, turn) => {
    box(ctx, 0, 0, W * 0.9, D * 0.9, h, WOODS.oak);
    onFront(ctx, W, h, turn?.face ?? 'both', () => doors(ctx, W * 0.9, D * 0.9, h - 3, 3));
  },
  wardrobe: (ctx, W, D, h, _lit, _tint, _trim, turn) => {
    box(ctx, 0, 0, W * 0.88, D * 0.88, h - 3, WOODS.dark);
    box(ctx, 0, 0, W * 0.96, D * 0.96, 3, WOODS.oak, h - 3);
    onFront(ctx, W, h, turn?.face ?? 'both', () => doors(ctx, W * 0.88, D * 0.88, h - 6, 3));
  },
  shelves: (ctx, W, D, h, _lit, _tint, _trim, turn) => {
    const w = WOODS.pale;
    // Open at the front and boarded at the back, so walking round it turns a
    // rack of oddments into a plain panel of boards.
    if (turn?.face === 'none') box(ctx, 0, 0, W * 0.9, D * 0.2, h, WOODS.dark);
    post(ctx, -W * 0.9, 0, h, w, 2);
    post(ctx, W * 0.9, 0, h, w, 2);
    for (const k of [0.06, 0.36, 0.66, 0.94]) box(ctx, 0, 0, W * 0.88, D * 0.88, 1.6, w, h * k);
    // Odds and ends left on two of the boards.
    onFront(ctx, W, h, turn?.face ?? 'both', () => {
      ctx.fillStyle = '#8a6a44';
      ctx.fillRect(-W * 0.45, -h * 0.36 - 4, 4.5, 4);
      ctx.fillStyle = '#9a8a5e';
      ctx.fillRect(W * 0.12, -h * 0.66 - 5, 5, 5);
      ctx.fillStyle = '#6f7a3a';
      ctx.fillRect(-W * 0.1, -h * 0.96 - 4, 3.5, 4);
    });
  },
  bookshelf: (ctx, W, D, h, _lit, _tint, _trim, turn) => {
    const w = WOODS.dark;
    box(ctx, 0, 0, W * 0.9, D * 0.9, h - 3, w);
    box(ctx, 0, 0, W * 0.97, D * 0.97, 3, WOODS.oak, h - 3);
    // Rows of books standing on the open face, following its slant. Round the
    // back of it there are no books, because the back of a bookshelf is a
    // board — which is the whole of what turning one shows you.
    onFront(ctx, W, h, turn?.face ?? 'both', () => {
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
    });
  },
  larder: (ctx, W, D, h, _lit, _tint, _trim, turn) => {
    box(ctx, 0, 0, W * 0.92, D * 0.92, h, WOODS.oak);
    onFront(ctx, W, h, turn?.face ?? 'both', () => {
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
    });
  },
  barrel: (ctx, W, D, h) => barrelShape(ctx, W, D, h),
  small_barrel: (ctx, W, D, h) => barrelShape(ctx, W, D, h),
  large_barrel: (ctx, W, D, h) => barrelShape(ctx, W, D, h),
  oven: (ctx, W, D, h, lit, _tint, _trim, turn) => {
    // A brick box with an arched mouth, and a short chimney off the back —
    // which comes round to the near side when you are behind it.
    const back = turn?.behind ? -1 : 1;
    box(ctx, 0, 0, W * 0.94, D * 0.94, h * 0.78, STONE);
    box(ctx, 0, -D * 0.3 * back, W * 0.5, D * 0.4, h * 0.22, STONE, h * 0.78);
    post(ctx, W * 0.34, -D * 0.52 * back, h * 0.4, STONE, 2.4, h);
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
    // The mouth, on the side it was built facing, alight or cold. Stand
    // behind an oven and there is no mouth: there is a wall of brick and a
    // chimney over it, which is the point of asking which way it is turned.
    onFront(ctx, W, h, turn?.face ?? 'both', () => {
      ctx.fillStyle = lit ? '#ffb347' : '#2a1d12';
      ctx.beginPath();
      ctx.moveTo(-W * 0.36, -h * 0.12 + D * 0.62);
      ctx.lineTo(-W * 0.36, -h * 0.42 + D * 0.62);
      ctx.quadraticCurveTo(0, -h * 0.62 + D * 0.62, W * 0.36, -h * 0.42 + D * 0.62);
      ctx.lineTo(W * 0.36, -h * 0.12 + D * 0.62);
      ctx.closePath();
      ctx.fill();
    });
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
  /*
   * The same carcass as the raw bin, in a paler wood, with the lid divided
   * across into compartments -- which is the whole visible difference between
   * a bin you tip a cartload of ore into and a bin you sort nails, hinges and
   * ribbons into.
   */
  craft_bin: (ctx, W, D, h) => {
    const w = WOODS.pale;
    box(ctx, 0, 0, W * 0.96, D * 0.96, h - 2, w);
    box(ctx, 0, 0, W * 0.99, D * 0.99, 2, WOODS.oak, h - 2);
    ctx.strokeStyle = 'rgba(30,24,16,0.28)';
    ctx.lineWidth = 0.8;
    // Board lines down the faces, as on the other bin.
    for (const t of [-0.5, 0, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(W * t * 0.96, -h + 2 + D * 0.96 * (1 - Math.abs(t)));
      ctx.lineTo(W * t * 0.96, -2 + D * 0.96 * (1 - Math.abs(t)));
      ctx.stroke();
    }
    // And the lid quartered rather than split in two.
    ctx.beginPath();
    ctx.moveTo(-W * 0.99, -h);
    ctx.lineTo(W * 0.99, -h);
    ctx.moveTo(0, -h - D * 0.9);
    ctx.lineTo(0, -h + D * 0.9);
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
  lectern: (ctx, W, D, h, _lit, _tint, _trim, turn) => {
    const w = WOODS.dark;
    box(ctx, 0, 0, W * 0.62, D * 0.62, 2, w);
    post(ctx, 0, 0, h - 7, w, 2.2, 2);
    /*
     * The top slopes down towards whoever is reading off it, so from behind
     * it slopes away and the book on it is out of sight over the lip. Which
     * is the difference between a lectern and a table with a book on it.
     */
    const tip = turn?.behind ? -1 : 1;
    ctx.fillStyle = WOODS.pale.top;
    ctx.beginPath();
    ctx.moveTo(-W * 0.8, -h + 4 * tip);
    ctx.lineTo(0, -h + 4 * tip + D * 0.8 * tip);
    ctx.lineTo(W * 0.8, -h - 2 * tip);
    ctx.lineTo(0, -h - 2 * tip - D * 0.8 * tip);
    ctx.closePath();
    ctx.fill();
    if (turn?.behind) return;
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
   * The crate rack: four bays, two decks, eight crates.
   *
   * It was one deck of eight, and it was reported as looking "more like a
   * table than a double decker shelf with box slots" — which it did, because
   * that is what a deck on four legs is. It stands as racking now: posts at
   * the corners, a board at each of two levels in each of four bays, and a
   * divider between the bays so an empty slot still says a crate goes there.
   *
   * The eight spots are still eight subtiles on the ground — two across and
   * four deep, which is what the rules place crates on and what the rack
   * stands on. Which subtile is drawn where is this model's own business: the
   * pair across each bay are the bay's two levels, so the far pair loaded and
   * the near six empty looks like that rather than like two crates at the
   * front. `trim` carries the mask of which of the eight are full.
   *
   * Drawn back to front and bottom to top, so what is nearer laps what is
   * behind and above laps below.
   */
  crate_shelf: (ctx, W, D, h, _lit, _tint, trim) => {
    const frame = WOODS.dark;
    const deck = WOODS.oak;
    const mask = trim ?? 0;
    /*
     * A block of `w` by `h` subtiles spans `(w + h)` steps of half-width
     * between its far corners, so one subtile of a two-by-four is `W / 3`
     * across and `D / 3` down. Stepping along the four-deep axis moves left
     * and down by one step, which is the run the rack is built along.
     */
    const stepX = W / 3;
    const stepY = D / 3;
    /** The middle of bay `j`: the pair of subtiles across the run. */
    const bayX = (j: number): number => (1.5 - j) * stepX;
    const bayY = (j: number): number => (j + 1.5) * stepY - D;

    const floors = [2.6, h * 0.52];
    const board = 1.2;
    const s = W * 0.17;
    const crateH = s * 1.3;

    /** One crate in a slot, with the band and corner line that make it read as one. */
    const crate = (cx: number, cy: number, base: number): void => {
      box(ctx, cx, cy, s, s * 0.5, crateH, WOODS.pale, base);
      const lid = cy - base - crateH;
      ctx.strokeStyle = 'rgba(64,44,26,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - s, lid + s * 0.5 + crateH * 0.5);
      ctx.lineTo(cx, lid + s + crateH * 0.5);
      ctx.lineTo(cx + s, lid + s * 0.5 + crateH * 0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, lid + s);
      ctx.lineTo(cx, lid + s + crateH * 0.6);
      ctx.stroke();
    };

    /*
     * Four bays, back to front, and each bay a shelf of its own rather than
     * one long deck: four boards in a row read as racking, and one board the
     * length of the run reads as the table this was reported as looking like.
     * Within a bay the top shelf goes on before the bottom one — what is lower
     * on the screen is nearer the eye and goes on last, or the shelf above
     * would be painted over the crate standing under it.
     */
    for (let j = 0; j < 4; j++) {
      const x = bayX(j);
      const y = bayY(j);
      // The far upright and the beam across the top of the bay, then what
      // stands in the bay, then the near upright, which laps it all.
      post(ctx, x - stepX * 0.72, y - stepY * 0.72, h, frame, 1.5);
      box(ctx, x, y, stepX * 0.8, stepY * 0.8, 1.1, frame, h - 1.1);
      for (let level = 1; level >= 0; level--) {
        const floor = floors[level];
        box(ctx, x, y, stepX * 0.82, stepY * 0.82, board, deck, floor - board);
        if (mask & (1 << (j * 2 + level))) crate(x, y, floor);
      }
      post(ctx, x + stepX * 0.72, y + stepY * 0.72, h, frame, 1.5);
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

/**
 * Which way round a piece is drawn, and which of its faces you are looking at.
 *
 * A piece is an iso box: a top rhombus and the two faces nearest you. Every
 * drawing in this file puts its front on those two near faces — the doors of a
 * wardrobe, the books on a shelf, the mouth of an oven — so a piece showed you
 * its front from every viewpoint there was and there was no back to walk round
 * to. The view could mirror a drawing and that was all, which kept an
 * asymmetric piece standing the way it was set and did nothing else: turned a
 * half, a piece showed you its face again.
 *
 * So the relative turn is taken properly. `rel` is the piece's front in view
 * space, an eighth of a turn at a time, and which faces you can see falls out
 * of it. A face is visible when a step along its outward normal carries down
 * the screen, since down the screen is nearer; of the four, two are visible at
 * a time, and at the eighth turns one of them is square to you while the other
 * two are edge on.
 *
 *   rel 7  the front is square to you, spanning both near faces — which is
 *          how every one of these drawings was authored.
 *   rel 0  the front is the left of the two faces you can see.
 *   rel 6  the front is the right of them.
 *   rel 2, 3, 4  you are looking at its back.
 *   rel 1, 5  you are square on to one of its sides, and neither the front
 *          nor the back shows at all.
 *
 * Three viewpoints in eight show a piece's front, which is what walking round
 * a wardrobe is actually like.
 */
const FACING_TURN: Record<Side, number> = { s: 0, w: 2, n: 4, e: 6 };

/** Which of a piece's faces the viewer has: both near ones, one of them, or none. */
export type FrontFace = 'both' | 'half' | 'none';

export interface PieceTurn {
  /** The drawing is flipped across the screen, as it always was. */
  mirror: boolean;
  /** How much of its front you can see. */
  face: FrontFace;
  /** And whether what you have instead is its back, rather than a side. */
  behind: boolean;
}

export function pieceTurn(facing: Side, rotation: number): PieceTurn {
  const rel = (((((FACING_TURN[facing] ?? 0) - rotation) % 8) + 8) % 8);
  return {
    mirror: ((rel >> 1) % 2) === 1,
    face: rel === 7 ? 'both' : rel === 0 || rel === 6 ? 'half' : 'none',
    behind: rel === 2 || rel === 3 || rel === 4,
  };
}

/**
 * Draw a piece's front, on whichever of its faces the front is.
 *
 * The drawings put their front detail across both near faces, so the one-face
 * case is that same drawing with the other half clipped away — which needs no
 * re-authoring and is exactly right, because the half that is clipped is the
 * half that is now a plain side. `rel 0` and `rel 6` both land on the left
 * half here: one of them is mirrored on the way out, so the two come out on
 * opposite sides of the screen, which is the point.
 */
export function onFront(ctx: CanvasRenderingContext2D, W: number, h: number, face: FrontFace, draw: () => void): void {
  if (face === 'none') return;
  if (face === 'both') {
    draw();
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(-W * 4, -h * 4, W * 4, h * 8);
  ctx.clip();
  draw();
  ctx.restore();
}

/** Draw one piece with its floor contact at (sx, sy). */
export function drawFurniture(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, kind: string, lit = false, tint?: Tint, trim?: number, turn: PieceTurn = SQUARE_ON): void {
  const [W, D] = furnitureSpan(kind);
  const h = FURNITURE_HEIGHT[kind] ?? 14;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  if (turn.mirror) ctx.scale(-1, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.beginPath();
  ctx.ellipse(0, 0, W * 0.95, D * 0.95, 0, 0, TAU);
  ctx.fill();
  (DRAW[kind] ?? DRAW.chest)(ctx, W, D, h, lit, tint, trim, turn);
  ctx.restore();
}

/** What a piece looks like with its front square to you: the drawing as drawn. */
export const SQUARE_ON: PieceTurn = { mirror: false, face: 'both', behind: false };
