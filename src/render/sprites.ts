import { BUSH_DEFS, TREE_DEFS } from '../world/tiles';

/** A pre-rendered sprite. Sizes are in zoom-1 pixels; the canvas is drawn at SPRITE_SCALE for crispness. */
export interface Sprite {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  /** Anchor (feet) offset from the top-left corner. */
  ax: number;
  ay: number;
}

const SPRITE_SCALE = 2;
const TAU = Math.PI * 2;
const cache = new Map<string, Sprite>();

function makeSprite(w: number, h: number, ax: number, ay: number, draw: (ctx: CanvasRenderingContext2D) => void): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = w * SPRITE_SCALE;
  canvas.height = h * SPRITE_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.scale(SPRITE_SCALE, SPRITE_SCALE);
  draw(ctx);
  return { canvas, w, h, ax, ay };
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, TAU);
}

/** A cloud-like cluster of circles. */
function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  circle(ctx, x, y, r);
  circle(ctx, x - r * 0.62, y + r * 0.18, r * 0.72);
  circle(ctx, x + r * 0.62, y + r * 0.18, r * 0.72);
  circle(ctx, x - r * 0.3, y - r * 0.5, r * 0.64);
  circle(ctx, x + r * 0.36, y - r * 0.46, r * 0.64);
  ctx.fill();
}

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
}

function trunk(ctx: CanvasRenderingContext2D, x: number, baseY: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x - w / 2, baseY - h, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(x, baseY - h, w / 2, h);
}

const SPRITE_W = 88;
const SPRITE_H = 120;
const AX = SPRITE_W / 2;
const AY = SPRITE_H - 8;
const VARIANT_SIZE = [0.7, 0.92, 1.12];

export function treeSprite(species: number, variant: number): Sprite {
  const key = `tree:${species}:${variant}`;
  let spr = cache.get(key);
  if (spr) return spr;
  const def = TREE_DEFS[species];
  const size = def.size * VARIANT_SIZE[variant];
  spr = makeSprite(SPRITE_W, SPRITE_H, AX, AY, (ctx) => {
    const bx = AX;
    const by = AY;
    shadow(ctx, bx, by, 15 * size, 6 * size);
    if (def.shape === 'round') {
      const th = 30 * size;
      const tw = 7 * size;
      const r = 22 * size;
      trunk(ctx, bx, by, tw, th, def.trunk);
      const cy = by - th - r * 0.5;
      blob(ctx, bx, cy, r, def.canopy[2]);
      blob(ctx, bx - r * 0.14, cy - r * 0.16, r * 0.8, def.canopy[1]);
      blob(ctx, bx - r * 0.3, cy - r * 0.34, r * 0.46, def.canopy[0]);
    } else if (def.shape === 'conifer') {
      const th = 18 * size;
      const r = 19 * size;
      trunk(ctx, bx, by, 6 * size, th, def.trunk);
      for (let i = 0; i < 3; i++) {
        const ly = by - th * 0.7 - i * r * 0.95;
        const lw = r * (1.15 - i * 0.3);
        const lh = r * 1.35 * (1 - i * 0.1);
        ctx.fillStyle = def.canopy[1];
        ctx.beginPath();
        ctx.moveTo(bx, ly - lh);
        ctx.lineTo(bx + lw, ly);
        ctx.lineTo(bx - lw, ly);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = def.canopy[2];
        ctx.beginPath();
        ctx.moveTo(bx, ly - lh);
        ctx.lineTo(bx + lw, ly);
        ctx.lineTo(bx + lw * 0.1, ly);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = def.canopy[0];
        ctx.beginPath();
        ctx.moveTo(bx - lw * 0.1, ly - lh * 0.85);
        ctx.lineTo(bx - lw * 0.55, ly - lh * 0.2);
        ctx.lineTo(bx - lw * 0.8, ly - lh * 0.05);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      const th = 28 * size;
      const r = 20 * size;
      trunk(ctx, bx, by, 7 * size, th, def.trunk);
      const cy = by - th - r * 0.35;
      ctx.fillStyle = def.canopy[2];
      ctx.beginPath();
      ctx.ellipse(bx, cy, r * 1.35, r * 0.85, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = def.canopy[1];
      ctx.beginPath();
      ctx.ellipse(bx - r * 0.15, cy - r * 0.2, r * 1.05, r * 0.6, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = def.canopy[0];
      ctx.lineWidth = 2 * size;
      ctx.lineCap = 'round';
      for (let k = 0; k <= 9; k++) {
        const t = k / 9;
        const x = bx - r * 1.2 + t * r * 2.4;
        const sway = Math.sin(k * 1.7) * 4 * size;
        const drop = r * (0.9 + 0.5 * Math.sin(t * Math.PI));
        ctx.beginPath();
        ctx.moveTo(x, cy + r * 0.1);
        ctx.quadraticCurveTo(x + sway, cy + drop * 0.6, x + sway * 0.4, cy + drop);
        ctx.stroke();
      }
      blob(ctx, bx - r * 0.35, cy - r * 0.4, r * 0.4, def.canopy[0]);
    }
  });
  cache.set(key, spr);
  return spr;
}

export function bushSprite(species: number): Sprite {
  const key = `bush:${species}`;
  let spr = cache.get(key);
  if (spr) return spr;
  const def = BUSH_DEFS[species];
  spr = makeSprite(48, 40, 24, 36, (ctx) => {
    const bx = 24;
    const by = 36;
    shadow(ctx, bx, by, 12, 4.5);
    blob(ctx, bx, by - 9, 9, def.foliage[1]);
    blob(ctx, bx - 2, by - 12, 6.5, def.foliage[0]);
    if (def.flowers) {
      ctx.fillStyle = def.flowers;
      const spots = [
        [-8, -12],
        [3, -16],
        [8, -9],
        [-3, -6],
        [1, -11],
      ];
      for (const [dx, dy] of spots) {
        ctx.beginPath();
        ctx.arc(bx + dx, by + dy, 1.6, 0, TAU);
        ctx.fill();
      }
    }
  });
  cache.set(key, spr);
  return spr;
}

/** A small heap of dropped goods. */
export function pileSprite(): Sprite {
  const key = 'pile';
  let spr = cache.get(key);
  if (spr) return spr;
  spr = makeSprite(36, 30, 18, 27, (ctx) => {
    const bx = 18;
    const by = 27;
    shadow(ctx, bx, by, 11, 4);
    ctx.fillStyle = '#8a6a42';
    ctx.beginPath();
    ctx.moveTo(bx - 9, by);
    ctx.quadraticCurveTo(bx - 10, by - 12, bx - 3, by - 14);
    ctx.quadraticCurveTo(bx + 1, by - 18, bx + 4, by - 14);
    ctx.quadraticCurveTo(bx + 11, by - 11, bx + 9, by);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#5e4630';
    ctx.fillRect(bx - 3, by - 15, 7, 2.5);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.moveTo(bx + 2, by - 13);
    ctx.quadraticCurveTo(bx + 11, by - 10, bx + 9, by);
    ctx.lineTo(bx + 2, by);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c9a15c';
    ctx.beginPath();
    ctx.arc(bx - 4, by - 6, 2.2, 0, TAU);
    ctx.fill();
  });
  cache.set(key, spr);
  return spr;
}

/** The settlement token: a carved stone pillar with a gilded cap. */
export function tokenSprite(): Sprite {
  const key = 'token';
  let spr = cache.get(key);
  if (spr) return spr;
  spr = makeSprite(40, 76, 20, 72, (ctx) => {
    const bx = 20;
    const by = 72;
    shadow(ctx, bx, by, 13, 5);
    // plinth
    ctx.fillStyle = '#6f6a62';
    ctx.beginPath();
    ctx.moveTo(bx - 12, by - 4);
    ctx.lineTo(bx, by + 2);
    ctx.lineTo(bx + 12, by - 4);
    ctx.lineTo(bx, by - 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#5a554e';
    ctx.beginPath();
    ctx.moveTo(bx, by + 2);
    ctx.lineTo(bx + 12, by - 4);
    ctx.lineTo(bx + 12, by - 8);
    ctx.lineTo(bx, by - 2);
    ctx.closePath();
    ctx.fill();
    // column
    ctx.fillStyle = '#9a948a';
    ctx.beginPath();
    ctx.moveTo(bx - 6, by - 8);
    ctx.lineTo(bx - 4, by - 56);
    ctx.lineTo(bx + 4, by - 56);
    ctx.lineTo(bx + 6, by - 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.moveTo(bx, by - 8);
    ctx.lineTo(bx, by - 56);
    ctx.lineTo(bx + 4, by - 56);
    ctx.lineTo(bx + 6, by - 8);
    ctx.closePath();
    ctx.fill();
    // runes
    ctx.fillStyle = '#4e4942';
    for (let i = 0; i < 4; i++) ctx.fillRect(bx - 3, by - 18 - i * 9, 5, 2);
    // gilded cap
    ctx.fillStyle = '#e3b657';
    ctx.beginPath();
    ctx.moveTo(bx - 6, by - 56);
    ctx.lineTo(bx, by - 68);
    ctx.lineTo(bx + 6, by - 56);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#b48a2e';
    ctx.beginPath();
    ctx.moveTo(bx, by - 68);
    ctx.lineTo(bx + 6, by - 56);
    ctx.lineTo(bx, by - 58);
    ctx.closePath();
    ctx.fill();
  });
  cache.set(key, spr);
  return spr;
}

export interface PlayerPose {
  phase: number;
  moving: boolean;
  facing: number;
  swimming: boolean;
  working: boolean;
}

const SKIN = '#e6c29a';
const HAIR = '#5a3a1e';
const TUNIC = '#8d6b3e';
const TROUSERS = '#4b3b2c';
const BELT = '#33241a';

/** Draws the character with its feet at (sx, sy). */
export function drawPlayer(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: PlayerPose): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom * (pose.facing < 0 ? -1 : 1), zoom);
  if (pose.swimming) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 4.5, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = TUNIC;
    ctx.fillRect(-6, -8, 12, 7);
    ctx.fillStyle = SKIN;
    ctx.beginPath();
    ctx.arc(0, -12, 5.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = HAIR;
    ctx.beginPath();
    ctx.arc(0, -13, 5.5, Math.PI, TAU);
    ctx.fill();
    ctx.restore();
    return;
  }
  const swing = pose.moving ? Math.sin(pose.phase) : 0;
  const bob = pose.moving ? Math.abs(Math.cos(pose.phase)) * 1.4 : 0;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 8, 3.5, 0, 0, TAU);
  ctx.fill();
  // legs
  ctx.fillStyle = TROUSERS;
  ctx.fillRect(-4.5, -13 + swing * 2, 4, 13 - swing * 2);
  ctx.fillRect(0.5, -13 - swing * 2, 4, 13 + swing * 2);
  // body
  ctx.fillStyle = TUNIC;
  ctx.fillRect(-6, -27 - bob, 12, 15);
  ctx.fillStyle = BELT;
  ctx.fillRect(-6, -15 - bob, 12, 2);
  // arms
  const armSwing = pose.working ? Math.sin(pose.phase * 2.2) * 5 : swing * 3;
  ctx.fillStyle = TUNIC;
  ctx.fillRect(-9, -26 - bob + armSwing, 3, 8);
  ctx.fillRect(6, -26 - bob - armSwing, 3, 8);
  ctx.fillStyle = SKIN;
  ctx.fillRect(-9, -18 - bob + armSwing, 3, 3);
  ctx.fillRect(6, -18 - bob - armSwing, 3, 3);
  // head
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(0, -32 - bob, 5.5, 0, TAU);
  ctx.fill();
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.arc(0, -33 - bob, 5.6, Math.PI * 1.05, Math.PI * 1.95);
  ctx.lineTo(4.5, -32 - bob);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2a1a10';
  ctx.fillRect(2, -33 - bob, 1.4, 1.4);
  ctx.restore();
}
