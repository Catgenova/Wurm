import { mulberry32 } from '../world/noise';
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
/** World objects were designed for a 64 px tile; tiles are 96 px now. */
export const WORLD_SCALE = 1.5;
const TAU = Math.PI * 2;
const cache = new Map<string, Sprite>();

function makeSprite(w: number, h: number, ax: number, ay: number, draw: (ctx: CanvasRenderingContext2D) => void, k = WORLD_SCALE): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * k * SPRITE_SCALE);
  canvas.height = Math.ceil(h * k * SPRITE_SCALE);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.scale(SPRITE_SCALE * k, SPRITE_SCALE * k);
  draw(ctx);
  return { canvas, w: w * k, h: h * k, ax: ax * k, ay: ay * k };
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

export const GRASS_VARIANTS = 10;
const BLADE_GREENS = ['#5b9a3a', '#6aae45', '#4d8b31', '#79b64c', '#63a03d'];
const BERRY_COLORS = ['#b52d3f', '#3b5fb0', '#c8394e', '#4a2f7a'];
const FLOWER_COLORS = ['#fff6d5', '#f2d34c', '#f0a3c0', '#ffffff'];

/**
 * Grass tufts for a grass tile. `state` bit 0 = can be foraged (berries
 * show), bit 1 = can be botanized (flowers show); 0 = grazed bare. Ten
 * variations per state, seeded so the same tile always gets the same tuft.
 */
export function grassSprite(state: number, variant: number): Sprite {
  const key = `grass:${state}:${variant}`;
  let spr = cache.get(key);
  if (spr) return spr;
  const rng = mulberry32(1000 + variant * 131 + state * 17);
  spr = makeSprite(52, 34, 26, 24, (ctx) => {
    const cx = 26;
    const cy = 20;
    const forage = (state & 1) !== 0;
    const botanize = (state & 2) !== 0;
    const tufts = state === 0 ? 2 + Math.floor(rng() * 2) : 4 + Math.floor(rng() * 3);
    ctx.lineCap = 'round';
    const points: Array<[number, number]> = [];
    for (let i = 0; i < tufts; i++) {
      // Spread tufts over the diamond's inner ellipse.
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng());
      const px = cx + Math.cos(a) * r * 19;
      const py = cy + Math.sin(a) * r * 8;
      points.push([px, py]);
      const blades = 3 + Math.floor(rng() * 3);
      const tall = state === 0 ? 3 + rng() * 2.5 : 4.5 + rng() * 4;
      const lean = (rng() - 0.5) * 3;
      for (let b = 0; b < blades; b++) {
        const dx = (b - (blades - 1) / 2) * 1.4 + (rng() - 0.5);
        const h = tall * (0.7 + rng() * 0.5);
        ctx.strokeStyle = BLADE_GREENS[Math.floor(rng() * BLADE_GREENS.length)];
        ctx.lineWidth = 1 + rng() * 0.5;
        ctx.beginPath();
        ctx.moveTo(px + dx, py);
        ctx.quadraticCurveTo(px + dx + lean * 0.5, py - h * 0.6, px + dx + lean + (rng() - 0.5) * 2, py - h);
        ctx.stroke();
      }
    }
    if (forage) {
      const berries = 3 + Math.floor(rng() * 2);
      for (let i = 0; i < berries; i++) {
        const [px, py] = points[Math.floor(rng() * points.length)];
        ctx.fillStyle = BERRY_COLORS[Math.floor(rng() * BERRY_COLORS.length)];
        ctx.beginPath();
        ctx.arc(px + (rng() - 0.5) * 5, py - 1 - rng() * 3, 1.3, 0, TAU);
        ctx.fill();
      }
    }
    if (botanize) {
      const flowers = 2 + Math.floor(rng() * 2);
      for (let i = 0; i < flowers; i++) {
        const [px, py] = points[Math.floor(rng() * points.length)];
        const fx = px + (rng() - 0.5) * 6;
        const fy = py - 3 - rng() * 4;
        ctx.fillStyle = FLOWER_COLORS[Math.floor(rng() * FLOWER_COLORS.length)];
        ctx.beginPath();
        for (let k = 0; k < 4; k++) {
          const ang = (k / 4) * TAU + rng() * 0.3;
          circle(ctx, fx + Math.cos(ang) * 1.1, fy + Math.sin(ang) * 1.1, 0.9);
        }
        ctx.fill();
        ctx.fillStyle = '#e0a020';
        ctx.beginPath();
        ctx.arc(fx, fy, 0.6, 0, TAU);
        ctx.fill();
      }
    }
  });
  cache.set(key, spr);
  return spr;
}

/** A crate sized to one subtile (a quarter of a tile each way). */
export function crateSprite(kind: 'log' | 'plank' = 'plank'): Sprite {
  const key = `crate:${kind}`;
  let spr = cache.get(key);
  if (spr) return spr;
  const left = kind === 'log' ? '#7d5c38' : '#8a6a42';
  const right = kind === 'log' ? '#5c4228' : '#6a4f30';
  const top = kind === 'log' ? '#a17a4a' : '#b08850';
  spr = makeSprite(30, 32, 15, 29, (ctx) => {
    const bx = 15;
    const by = 29;
    shadow(ctx, bx, by, 11, 5);
    const w = 11;
    const h = 11;
    // left face, right face, top
    ctx.fillStyle = left;
    ctx.beginPath();
    ctx.moveTo(bx - w, by - w / 2);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx, by - h);
    ctx.lineTo(bx - w, by - w / 2 - h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = right;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + w, by - w / 2);
    ctx.lineTo(bx + w, by - w / 2 - h);
    ctx.lineTo(bx, by - h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.moveTo(bx - w, by - w / 2 - h);
    ctx.lineTo(bx, by - h);
    ctx.lineTo(bx + w, by - w / 2 - h);
    ctx.lineTo(bx, by - w - h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#4a3520';
    ctx.lineWidth = 1;
    const bands = kind === 'log' ? [0.25, 0.5, 0.75] : [0.35, 0.7];
    for (const k of bands) {
      ctx.beginPath();
      ctx.moveTo(bx - w, by - w / 2 - h * k);
      ctx.lineTo(bx, by - h * k);
      ctx.lineTo(bx + w, by - w / 2 - h * k);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx, by - h);
    ctx.stroke();
  }, 1);
  cache.set(key, spr);
  return spr;
}

export interface CreaturePose {
  facing: number;
  phase: number;
  moving: boolean;
  colors: [string, string];
  /** 0..1 health fraction; a bar shows when below 1. */
  health: number;
  label?: string;
}

/** A Rabba: round body, long ears, twitchy. Feet at (sx, sy). */
export function drawRabba(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom * (pose.facing < 0 ? -1 : 1), zoom);
  const hop = pose.moving ? Math.abs(Math.sin(pose.phase)) * 3 : 0;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 11, 5, 0, 0, TAU);
  ctx.fill();
  const [fur, belly] = pose.colors;
  // ears
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(3.5, -16 - hop, 1.7, 5, -0.15, 0, TAU);
  ctx.ellipse(6.5, -15.5 - hop, 1.7, 4.6, 0.25, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#e8a6a6';
  ctx.beginPath();
  ctx.ellipse(3.5, -16 - hop, 0.7, 3, -0.15, 0, TAU);
  ctx.fill();
  // body and belly
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(-0.5, -6 - hop, 7.5, 5.2, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(0.5, -4.5 - hop, 4.5, 2.6, 0, 0, TAU);
  ctx.fill();
  // tail, head, eye, nose
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.arc(-7.5, -6.5 - hop, 2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.arc(5, -10 - hop, 4.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#2a1a10';
  ctx.beginPath();
  ctx.arc(6.5, -11 - hop, 0.9, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#d98f8f';
  ctx.beginPath();
  ctx.arc(9, -9.5 - hop, 0.8, 0, TAU);
  ctx.fill();
  ctx.restore();
  if (pose.health < 1) {
    const w = 18 * zoom;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(sx - w / 2, sy - 24 * zoom, w, 3 * zoom);
    ctx.fillStyle = pose.health > 0.5 ? '#7ccf5a' : pose.health > 0.25 ? '#e3b657' : '#e0574d';
    ctx.fillRect(sx - w / 2, sy - 24 * zoom, w * Math.max(0, pose.health), 3 * zoom);
  }
  if (pose.label) {
    ctx.font = `${Math.max(9, 10 * zoom)}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(pose.label, sx, sy - 26 * zoom);
    ctx.fillStyle = '#e3b657';
    ctx.fillText(pose.label, sx, sy - 26 * zoom);
  }
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
  const bob = pose.moving ? Math.abs(Math.cos(pose.phase)) * 1.2 : 0;
  // The shadow marks the one subtile the character stands on.
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 11, 5, 0, 0, TAU);
  ctx.fill();
  // legs
  ctx.fillStyle = TROUSERS;
  ctx.fillRect(-3.5, -12 + swing * 2, 3, 12 - swing * 2);
  ctx.fillRect(0.5, -12 - swing * 2, 3, 12 + swing * 2);
  // body
  ctx.fillStyle = TUNIC;
  ctx.fillRect(-4.5, -26 - bob, 9, 14);
  ctx.fillStyle = BELT;
  ctx.fillRect(-4.5, -14.5 - bob, 9, 1.6);
  // arms
  const armSwing = pose.working ? Math.sin(pose.phase * 2.2) * 5 : swing * 3;
  ctx.fillStyle = TUNIC;
  ctx.fillRect(-7, -25 - bob + armSwing, 2.5, 8);
  ctx.fillRect(4.5, -25 - bob - armSwing, 2.5, 8);
  ctx.fillStyle = SKIN;
  ctx.fillRect(-7, -17 - bob + armSwing, 2.5, 2.5);
  ctx.fillRect(4.5, -17 - bob - armSwing, 2.5, 2.5);
  // head
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(0, -31 - bob, 4.6, 0, TAU);
  ctx.fill();
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.arc(0, -32 - bob, 4.7, Math.PI * 1.05, Math.PI * 1.95);
  ctx.lineTo(3.8, -31 - bob);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2a1a10';
  ctx.fillRect(1.6, -32 - bob, 1.2, 1.2);
  ctx.restore();
}
