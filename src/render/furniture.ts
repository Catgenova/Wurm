import { furnitureDef } from '../game/furniture';

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
  barrel: 17,
  lectern: 24,
  coat_rack: 30,
  planter: 10,
  firewood_rack: 17,
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

type Draw = (ctx: CanvasRenderingContext2D, W: number, D: number, h: number) => void;

const DRAW: Record<string, Draw> = {
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
  barrel: (ctx, W, D, h) => {
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
};

/** Draw one piece with its floor contact at (sx, sy). */
export function drawFurniture(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, kind: string): void {
  const [W, D] = furnitureSpan(kind);
  const h = FURNITURE_HEIGHT[kind] ?? 14;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.beginPath();
  ctx.ellipse(0, 0, W * 0.95, D * 0.95, 0, 0, TAU);
  ctx.fill();
  (DRAW[kind] ?? DRAW.chest)(ctx, W, D, h);
  ctx.restore();
}
