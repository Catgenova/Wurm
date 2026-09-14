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

/** What hangs in each of the bearing trees. */
const FRUIT_COLOUR: Record<string, string> = { apple: '#d8443c', cherry: '#b41f3e', olive: '#4a5a2c' };

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
      // The three that bear are told apart across a field by what is hanging
      // in them, once they are old enough to hang anything.
      if (def.fruit && variant > 0) {
        ctx.fillStyle = FRUIT_COLOUR[def.fruit] ?? '#d05040';
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2 + species;
          const d = r * (0.42 + ((i * 7) % 5) / 9);
          ctx.beginPath();
          ctx.arc(bx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, Math.max(1, r * 0.075), 0, Math.PI * 2);
          ctx.fill();
        }
      }
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

/**
 * A crop growing on a tilled field. Each of the four stages gets its own
 * model, and each family of crop its own shape: roots keep their heads down
 * and swell late, leaves spread, grain runs up into ears, herbs stay low and
 * bushy, and fibre opens into bolls. Ripe plants carry their produce.
 */
export function cropSprite(cropId: string, stage: number, look: string, leaf: string, fruit: string): Sprite {
  const key = `crop:${cropId}:${stage}`;
  let spr = cache.get(key);
  if (spr) return spr;
  const rng = mulberry32(hashString(cropId) + stage * 7919);
  // How far out of the tile centre anything drawn on the field may reach, as a
  // share of the tile. A hair inside the half-tile, so nothing touches the edge.
  const EDGE = 0.46;
  // A tile's worth of furrows, anchored at the tile centre.
  spr = makeSprite(96, 72, 48, 54, (ctx) => {
    const cx = 48;
    const cy = 52;
    const iso = (u: number, v: number): [number, number] => [cx + (u - v) * 44, cy + (u + v) * 22];
    ctx.lineCap = 'round';
    /*
     * Furrows run across the field under the plants. The ground they have to
     * stay on is a diamond, so a furrow further from the middle is a shorter
     * furrow: at the widest the full width of the tile, and at the last one
     * before the corner barely more than a nick. Drawing them all the same
     * length ran them a third of a tile out over the grass on either side.
     */
    ctx.strokeStyle = 'rgba(70,50,32,0.45)';
    ctx.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      const f = i * 0.19;
      const half = EDGE - Math.abs(f);
      if (half <= 0.03) continue;
      const [ax, ay] = iso(f - half, f + half);
      const [bx, by] = iso(f + half, f - half);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    if (stage === 0) {
      // Sown: only the seed and the disturbed earth show.
      ctx.fillStyle = 'rgba(58,42,26,0.7)';
      for (let i = 0; i < 14; i++) {
        const [px, py] = iso((rng() - 0.5) * 0.8, (rng() - 0.5) * 0.8);
        ctx.beginPath();
        ctx.ellipse(px, py, 1.5, 1, 0, 0, TAU);
        ctx.fill();
      }
      cache.set(key, spr!);
      return;
    }
    const grown = stage / 3;
    const plants: Array<[number, number]> = [];
    for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) plants.push([u * 0.26 + (rng() - 0.5) * 0.08, v * 0.26 + (rng() - 0.5) * 0.08]);
    plants.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
    for (const [u, v] of plants) {
      const [px, py] = iso(u, v);
      const h = (look === 'grain' ? 10 : look === 'leaf' ? 6 : 5) * (0.45 + grown * 0.85);
      const w = (look === 'leaf' ? 7 : 4.5) * (0.5 + grown * 0.7);
      ctx.strokeStyle = leaf;
      ctx.fillStyle = leaf;
      if (look === 'grain') {
        // A stalk with an ear on top once it is up.
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(px + 1, py - h * 0.6, px + 1.6, py - h);
        ctx.stroke();
        if (stage >= 2) {
          ctx.fillStyle = stage === 3 ? fruit : leaf;
          ctx.beginPath();
          ctx.ellipse(px + 1.8, py - h - 1.6, 1.7, 3.4 * (stage === 3 ? 1.15 : 0.8), 0.2, 0, TAU);
          ctx.fill();
        }
      } else if (look === 'leaf') {
        // A rosette of broad leaves, closing into a head when ripe.
        const blades = 5;
        for (let i = 0; i < blades; i++) {
          const a = (i / blades) * TAU + u;
          ctx.beginPath();
          ctx.ellipse(px + Math.cos(a) * w * 0.35, py - h * 0.35 + Math.sin(a) * w * 0.18, w * 0.5, h * 0.32, a * 0.3, 0, TAU);
          ctx.fill();
        }
        if (stage === 3) {
          ctx.fillStyle = fruit;
          ctx.beginPath();
          ctx.ellipse(px, py - h * 0.55, w * 0.42, h * 0.42, 0, 0, TAU);
          ctx.fill();
        }
      } else if (look === 'fibre') {
        ctx.lineWidth = 1.2;
        for (const d of [-1, 0, 1]) {
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.quadraticCurveTo(px + d * 2, py - h * 0.6, px + d * 3.4, py - h);
          ctx.stroke();
        }
        if (stage === 3) {
          ctx.fillStyle = fruit;
          for (const d of [-1, 1]) {
            ctx.beginPath();
            ctx.arc(px + d * 3.2, py - h - 0.5, 2.2, 0, TAU);
            ctx.fill();
          }
        }
      } else {
        // Roots and herbs: a low tuft, with the crop showing at the soil when ripe.
        ctx.lineWidth = 1.4;
        for (const d of [-1.2, 0, 1.2]) {
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.quadraticCurveTo(px + d * 1.6, py - h * 0.7, px + d * 2.6, py - h);
          ctx.stroke();
        }
        if (stage === 3) {
          ctx.fillStyle = fruit;
          if (look === 'root') {
            ctx.beginPath();
            ctx.ellipse(px, py + 0.6, 3.2, 2.1, 0, 0, TAU);
            ctx.fill();
          } else {
            for (const d of [-1, 1]) {
              ctx.beginPath();
              ctx.arc(px + d * 2.2, py - h * 0.75, 1.5, 0, TAU);
              ctx.fill();
            }
          }
        }
      }
    }
  });
  cache.set(key, spr);
  return spr;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A campfire filling a two by two block of subtiles: a ring of stones, logs
 * laid across it, and flames that flicker while it burns. Drawn live rather
 * than cached so the fire moves.
 */
export function drawCampfire(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, lit: boolean, fuel: number, time: number): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  // The ring of stones, an iso diamond two subtiles across.
  const rx = 22;
  const ry = 11;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#2a2420';
  ctx.beginPath();
  ctx.ellipse(0, -1, rx - 4, ry - 2, 0, 0, TAU);
  ctx.fill();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + 0.2;
    const stx = Math.cos(a) * (rx - 2);
    const sty = Math.sin(a) * (ry - 1) - 1;
    ctx.fillStyle = i % 2 ? '#8b8781' : '#6f6b66';
    ctx.beginPath();
    ctx.ellipse(stx, sty, 3.6, 2.6, a, 0, TAU);
    ctx.fill();
  }
  // Logs laid across the pit, shrinking as the fuel goes.
  const load = Math.max(0.25, Math.min(1, fuel / 900));
  ctx.strokeStyle = lit ? '#3a2a1c' : '#6b5236';
  ctx.lineCap = 'round';
  for (const [a, len] of [
    [0.5, 15],
    [-0.6, 13],
    [2.4, 12],
  ] as Array<[number, number]>) {
    const l = len * load;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * -l, Math.sin(a) * -l * 0.5 - 2);
    ctx.lineTo(Math.cos(a) * l, Math.sin(a) * l * 0.5 - 2);
    ctx.stroke();
  }
  if (lit) {
    // Embers under the flames.
    ctx.fillStyle = 'rgba(226,106,40,0.55)';
    ctx.beginPath();
    ctx.ellipse(0, -2, rx - 8, ry - 4, 0, 0, TAU);
    ctx.fill();
    // Three tongues of flame on their own rhythms.
    const flames: Array<[number, number, number, string]> = [
      [0, 1, 0.9, '#f0c23c'],
      [-5, 1.7, 0.7, '#e8863a'],
      [5, 2.6, 0.65, '#e06a2c'],
    ];
    for (const [ox, speed, scale, color] of flames) {
      const wob = Math.sin(time * speed * 3.1 + ox) * 1.6;
      const h = (16 + Math.sin(time * speed * 4.3 + ox) * 4) * scale;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(ox - 5 * scale, -3);
      ctx.quadraticCurveTo(ox - 6 * scale + wob, -h * 0.55, ox + wob * 0.6, -h);
      ctx.quadraticCurveTo(ox + 6 * scale + wob, -h * 0.55, ox + 5 * scale, -3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,240,190,0.85)';
    const ih = 7 + Math.sin(time * 5.5) * 2;
    ctx.beginPath();
    ctx.moveTo(-2.4, -3);
    ctx.quadraticCurveTo(-2.6, -ih * 0.6, 0, -ih);
    ctx.quadraticCurveTo(2.6, -ih * 0.6, 2.4, -3);
    ctx.closePath();
    ctx.fill();
  } else if (fuel > 0) {
    ctx.fillStyle = 'rgba(120,110,96,0.5)';
    ctx.beginPath();
    ctx.ellipse(0, -2, rx - 9, ry - 5, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** A stone smelter: a squat chimney with a firebox that glows when hot. */
export function drawSmelter(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, lit: boolean, working: boolean, time: number): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 34, 17, 0, 0, TAU);
  ctx.fill();
  // The stone base, drawn as an iso block three subtiles by two.
  const w = 32;
  const d = 16;
  const h = 30;
  const base = '#7d7a74';
  const dark = '#5c5а56'.replace('а', 'a');
  const top = '#928e86';
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.moveTo(-w, -d / 2);
  ctx.lineTo(0, d / 2);
  ctx.lineTo(0, d / 2 - h);
  ctx.lineTo(-w, -d / 2 - h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(0, d / 2);
  ctx.lineTo(w, -d / 2);
  ctx.lineTo(w, -d / 2 - h);
  ctx.lineTo(0, d / 2 - h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.moveTo(-w, -d / 2 - h);
  ctx.lineTo(0, d / 2 - h);
  ctx.lineTo(w, -d / 2 - h);
  ctx.lineTo(0, -d / 2 - h - d / 2 - 4);
  ctx.closePath();
  ctx.fill();
  // Courses of stone.
  ctx.strokeStyle = 'rgba(40,38,34,0.35)';
  ctx.lineWidth = 1;
  for (const k of [0.3, 0.6]) {
    ctx.beginPath();
    ctx.moveTo(-w, -d / 2 - h * k);
    ctx.lineTo(0, d / 2 - h * k);
    ctx.lineTo(w, -d / 2 - h * k);
    ctx.stroke();
  }
  // The chimney.
  ctx.fillStyle = top;
  ctx.fillRect(-7, -h - 26, 14, 16);
  ctx.fillStyle = dark;
  ctx.fillRect(3, -h - 26, 4, 16);
  ctx.fillStyle = '#3b3833';
  ctx.beginPath();
  ctx.ellipse(0, -h - 26, 7, 3, 0, 0, TAU);
  ctx.fill();
  // The firebox mouth, and the heat coming out of it.
  const mouthY = -h * 0.42;
  ctx.fillStyle = lit ? '#f0a03c' : '#2b2723';
  ctx.beginPath();
  ctx.moveTo(-11, mouthY + 6);
  ctx.lineTo(0, mouthY + 12);
  ctx.lineTo(11, mouthY + 6);
  ctx.lineTo(11, mouthY - 7);
  ctx.lineTo(0, mouthY - 1);
  ctx.lineTo(-11, mouthY - 7);
  ctx.closePath();
  ctx.fill();
  if (lit) {
    ctx.fillStyle = 'rgba(255,238,180,0.85)';
    const f = 3 + Math.sin(time * 6) * 1.4;
    ctx.beginPath();
    ctx.ellipse(0, mouthY + 3, 6, f, 0, 0, TAU);
    ctx.fill();
    // Smoke from the chimney, thicker while there is work in it.
    ctx.fillStyle = 'rgba(220,216,210,0.35)';
    const puffs = working ? 4 : 2;
    for (let i = 0; i < puffs; i++) {
      const t = (time * 0.5 + i / puffs) % 1;
      ctx.globalAlpha = 0.4 * (1 - t);
      ctx.beginPath();
      ctx.arc(Math.sin((time + i) * 1.5) * 4, -h - 30 - t * 26, 3 + t * 6, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** A kiln: a brick beehive with a stoke hole at the foot and a vent on top. */
export function drawKiln(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, lit: boolean, working: boolean, time: number): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 24, 12, 0, 0, TAU);
  ctx.fill();
  const brick = '#8e6a52';
  const dark = '#6c4e3c';
  const pale = '#a8836a';
  // The dome, squat and round, sitting on a low plinth.
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(0, -3, 21, 9, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = brick;
  ctx.beginPath();
  ctx.moveTo(-20, -4);
  ctx.bezierCurveTo(-20, -30, -11, -38, 0, -38);
  ctx.bezierCurveTo(11, -38, 20, -30, 20, -4);
  ctx.ellipse(0, -4, 20, 8, 0, 0, Math.PI, true);
  ctx.closePath();
  ctx.fill();
  // A lit face on the left, courses of brick across it.
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.beginPath();
  ctx.moveTo(-20, -4);
  ctx.bezierCurveTo(-20, -30, -11, -38, 0, -38);
  ctx.lineTo(0, -4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(48,34,26,0.35)';
  ctx.lineWidth = 0.9;
  for (const [w, y] of [
    [19.4, -11],
    [17.2, -20],
    [12.6, -28],
  ] as Array<[number, number]>) {
    ctx.beginPath();
    ctx.ellipse(0, y, w, w * 0.36, 0, 0.15, Math.PI - 0.15);
    ctx.stroke();
  }
  // The vent at the crown.
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(0, -38, 5.4, 2.4, 0, 0, TAU);
  ctx.fill();
  if (lit) {
    ctx.fillStyle = 'rgba(255,196,108,0.7)';
    ctx.beginPath();
    ctx.ellipse(0, -38, 3.6, 1.5, 0, 0, TAU);
    ctx.fill();
  }
  // The stoke hole, arched, with the fire showing through it when it is going.
  ctx.fillStyle = lit ? '#f2a53f' : '#2a2320';
  ctx.beginPath();
  ctx.moveTo(-7, -3);
  ctx.lineTo(-7, -12);
  ctx.quadraticCurveTo(0, -19, 7, -12);
  ctx.lineTo(7, -3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = pale;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  if (lit) {
    ctx.fillStyle = 'rgba(255,240,190,0.85)';
    const f = 3.4 + Math.sin(time * 6.5) * 1.5;
    ctx.beginPath();
    ctx.ellipse(0, -6, 4.6, f, 0, 0, TAU);
    ctx.fill();
    // Heat off the crown, heavier while there is ware inside.
    ctx.fillStyle = 'rgba(224,218,208,0.4)';
    const puffs = working ? 4 : 2;
    for (let i = 0; i < puffs; i++) {
      const t = (time * 0.45 + i / puffs) % 1;
      ctx.globalAlpha = 0.35 * (1 - t);
      ctx.beginPath();
      ctx.arc(Math.sin((time + i) * 1.4) * 3.5, -42 - t * 22, 2.4 + t * 5, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** An anvil on its block, coloured by the metal it was cast from. */
/**
 * A work post: a pointed stake with a crossbar nailed near the top and a
 * strip of metal tacked to it for a marker. It leans further the more rotten
 * it is, and the marker hangs the right way up only while somebody is working
 * out of it.
 */
/**
 * A trap on the ground. A snare is a bent shaft with a loop of rope pegged
 * open at the foot of it; a deadfall is a board propped on a stick over the
 * bait. Either one is drawn sprung when there is something in it.
 */
/**
 * One tile of bridge deck, drawn at the height the deck is carried at. The
 * unfinished part is drawn as bare stringers so you can see what is left.
 */
export function drawDeck(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  zoom: number,
  kind: string,
  done: boolean,
  drop: number,
): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  // The deck fills its tile exactly, or the spans do not meet.
  const W = 48;
  const D = 24;
  const stone = kind === 'stone';
  const top = stone ? '#9a968c' : kind === 'rope' ? '#8a7550' : '#7d6243';
  const side = stone ? '#6f6b62' : '#523d28';
  // What holds it up: piers for stone and wood, two hawsers for a rope bridge.
  if (drop > 2) {
    if (kind !== 'rope') {
      // A pier down into whatever is underneath, cut off before it gets silly.
      const h = Math.min(34, drop * 0.8);
      ctx.fillStyle = side;
      ctx.beginPath();
      ctx.moveTo(-5, 2);
      ctx.lineTo(5, 2);
      ctx.lineTo(5, 2 + h);
      ctx.lineTo(-5, 2 + h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(1, 2, 4, h);
    }
  }
  if (!done) {
    // Stringers only: two beams across the gap and nothing to walk on.
    ctx.strokeStyle = side;
    ctx.lineWidth = 1.6;
    for (const o of [-0.42, 0.42]) {
      ctx.beginPath();
      ctx.moveTo(-W, o * D * 0.5);
      ctx.lineTo(0, o * D + D * 0.5 * o);
      ctx.lineTo(W, o * D * 0.5);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  // The deck itself: a flat lozenge on the tile, with a lip on the near side.
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.moveTo(-W, 0);
  ctx.lineTo(0, -D);
  ctx.lineTo(W, 0);
  ctx.lineTo(0, D);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = side;
  ctx.beginPath();
  ctx.moveTo(-W, 0);
  ctx.lineTo(0, D);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, 2);
  ctx.lineTo(0, D + 2);
  ctx.lineTo(-W, 2);
  ctx.closePath();
  ctx.fill();
  // Planking across the run, or the courses of an arch.
  ctx.strokeStyle = 'rgba(0,0,0,0.14)';
  ctx.lineWidth = 0.8;
  for (let i = -3; i <= 3; i++) {
    const t = i / 4;
    ctx.beginPath();
    ctx.moveTo(t * W, -D + Math.abs(t) * D);
    ctx.lineTo(t * W, D - Math.abs(t) * D);
    ctx.stroke();
  }
  if (kind === 'rope') {
    // Handropes along both sides, which is all that is between you and the drop.
    ctx.strokeStyle = '#cfc3a4';
    ctx.lineWidth = 1;
    for (const o of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-W, o * D * 0.5 - 5);
      ctx.lineTo(0, o * D - 6);
      ctx.lineTo(W, o * D * 0.5 - 5);
      ctx.stroke();
    }
  } else {
    // A kerb along both edges so the deck reads as something you stay on.
    ctx.strokeStyle = side;
    ctx.lineWidth = 1.4;
    for (const o of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-W, o * D * 0.5 - 1);
      ctx.lineTo(0, o * D - 1);
      ctx.lineTo(W, o * D * 0.5 - 1);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawTrap(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, kind: string, baited: boolean, sprung: boolean): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 6, 2.6, 0, 0, TAU);
  ctx.fill();
  const wood = '#6b543a';
  const dark = '#4a3a28';
  if (kind === 'creel') {
    // A woven basket sitting low, with a float and a line up to the bank.
    ctx.strokeStyle = '#cfc3a4';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(4, -5.5);
    ctx.lineTo(7, -9);
    ctx.stroke();
    ctx.fillStyle = '#c9b06a';
    ctx.beginPath();
    ctx.ellipse(-2, -2.4, 5.2, 3, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#a68f52';
    ctx.beginPath();
    ctx.ellipse(-2, -1.2, 5.2, 3, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#7d6a3c';
    ctx.lineWidth = 0.5;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.ellipse(-2, -2.4 + i * 1.1, 5.2 - Math.abs(i) * 0.8, 2.6, 0, Math.PI * 0.06, Math.PI * 0.94);
      ctx.stroke();
    }
    // The throat, turned inward.
    ctx.fillStyle = '#4a3f22';
    ctx.beginPath();
    ctx.ellipse(2.4, -2.6, 1.4, 1.1, 0, 0, TAU);
    ctx.fill();
    if (sprung) {
      ctx.fillStyle = '#8fb6c8';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(-3.4 + i * 1.6, -2.2 + (i % 2) * 0.9, 1.2, 0.5, 0, 0, TAU);
        ctx.fill();
      }
    }
    if (baited) {
      ctx.fillStyle = '#c06a4a';
      ctx.beginPath();
      ctx.ellipse(-2, -2.6, 0.9, 0.6, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  if (kind === 'deadfall') {
    // A board, propped at an angle on a stick, or lying flat once it has gone.
    ctx.strokeStyle = dark;
    ctx.lineWidth = 1;
    if (!sprung) {
      ctx.beginPath();
      ctx.moveTo(3, 0);
      ctx.lineTo(3, -6);
      ctx.stroke();
    }
    ctx.fillStyle = wood;
    ctx.beginPath();
    if (sprung) {
      ctx.moveTo(-6, -1.4);
      ctx.lineTo(6, -1.4);
      ctx.lineTo(6, 0.4);
      ctx.lineTo(-6, 0.4);
    } else {
      ctx.moveTo(-6, -1);
      ctx.lineTo(5, -7);
      ctx.lineTo(6, -5.6);
      ctx.lineTo(-5, 0.4);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = dark;
    ctx.fillRect(-6, sprung ? 0.2 : -0.4, 12, 0.7);
  } else {
    // A shaft bent over, with a noose off the head of it.
    ctx.strokeStyle = wood;
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-3, 0);
    if (sprung) ctx.quadraticCurveTo(-3.4, -8, -2, -10);
    else ctx.quadraticCurveTo(-2, -8, 3, -7);
    ctx.stroke();
    ctx.strokeStyle = '#cfc3a4';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    if (sprung) ctx.ellipse(-2, -6, 1.1, 1.8, 0, 0, TAU);
    else ctx.ellipse(3, -2.2, 3.4, 1.5, 0, 0, TAU);
    ctx.stroke();
    if (!sprung) {
      ctx.beginPath();
      ctx.moveTo(3, -7);
      ctx.lineTo(3, -3.7);
      ctx.stroke();
    }
  }
  // A crumb of bait in the middle of it, so a set trap reads as set.
  if (baited && !sprung) {
    ctx.fillStyle = '#c06a4a';
    ctx.beginPath();
    ctx.ellipse(kind === 'deadfall' ? 0 : 3, -0.6, 1.1, 0.8, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

export function drawWorkPost(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, left: number, worked: boolean): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 5.5, 2.4, 0, 0, TAU);
  ctx.fill();
  // Standing straight when new and leaning badly by the end.
  ctx.rotate((1 - Math.max(0, Math.min(1, left))) * 0.3);
  const h = 26;
  ctx.strokeStyle = '#8a6a44';
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(0, -1);
  ctx.lineTo(0, -h);
  ctx.stroke();
  ctx.strokeStyle = '#6d5234';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-6, -h + 6);
  ctx.lineTo(6, -h + 6);
  ctx.stroke();
  // The ribbon: bright while it is being worked, dull and furled when not.
  ctx.fillStyle = worked ? '#d8b03c' : '#8e8478';
  ctx.beginPath();
  if (worked) {
    ctx.moveTo(1, -h + 1);
    ctx.lineTo(9, -h + 4.5);
    ctx.lineTo(1, -h + 8);
  } else {
    ctx.moveTo(1, -h + 2);
    ctx.lineTo(5, -h + 4);
    ctx.lineTo(1, -h + 6);
  }
  ctx.closePath();
  ctx.fill();
  // A nail head apiece where the crossbar is fixed.
  ctx.fillStyle = '#4a463f';
  for (const nx of [-4.5, 4.5]) {
    ctx.beginPath();
    ctx.arc(nx, -h + 6, 0.8, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

export function drawAnvil(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, face: string, shade: string): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 20, 10, 0, 0, TAU);
  ctx.fill();
  // Oak block.
  ctx.fillStyle = '#6b5236';
  ctx.beginPath();
  ctx.moveTo(-13, -4);
  ctx.lineTo(0, 2);
  ctx.lineTo(13, -4);
  ctx.lineTo(13, -12);
  ctx.lineTo(0, -6);
  ctx.lineTo(-13, -12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#4e3c28';
  ctx.beginPath();
  ctx.moveTo(0, 2);
  ctx.lineTo(13, -4);
  ctx.lineTo(13, -12);
  ctx.lineTo(0, -6);
  ctx.closePath();
  ctx.fill();
  // The anvil: waist, body and horn.
  ctx.fillStyle = shade;
  ctx.fillRect(-4, -18, 8, 8);
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.moveTo(-11, -18);
  ctx.lineTo(11, -18);
  ctx.lineTo(14, -22);
  ctx.lineTo(-9, -22);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.moveTo(11, -18);
  ctx.lineTo(14, -22);
  ctx.lineTo(14, -25);
  ctx.lineTo(11, -21);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.moveTo(-9, -22);
  ctx.lineTo(14, -22);
  ctx.lineTo(11, -25);
  ctx.lineTo(-7, -25);
  ctx.closePath();
  ctx.fill();
  // The horn.
  ctx.beginPath();
  ctx.moveTo(-7, -25);
  ctx.quadraticCurveTo(-16, -25, -19, -22);
  ctx.quadraticCurveTo(-14, -21, -9, -22);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The same colour taken down or brought up, for a far leg or a lit back. */
function shade(hex: string, by: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number): number => Math.max(0, Math.min(255, Math.round(by < 0 ? v * (1 + by) : v + (255 - v) * by)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export interface CreaturePose {
  facing: number;
  phase: number;
  moving: boolean;
  colors: [string, string];
  /** 0..1 health fraction; a bar shows when below 1. */
  health: number;
  label?: string;
  /** Species id; decides which body is drawn. */
  species?: string;
  /** How much fleece is on it, 0..1, for the species that grow one. */
  fleece?: number;
  /** How much of its full size it is: a yearling is small and an old one heavy. */
  scale?: number;
}

/** Draws a wildermon of any species with its feet at (sx, sy), then its health bar and name. */
/**
 * The things that are not wildermon. Three of them stand on two legs and
 * carry something; the fourth does not need to carry anything.
 */
interface MonsterShape {
  /** Overall size, against a goblin at one. */
  size: number;
  /** Half-width and half-height of the torso. */
  torso: [number, number];
  head: number;
  /** Tusks out of the lower jaw. */
  tusk?: number;
  /** What is in its hand: a notched blade, an axe, or a whole tree. */
  arm: 'blade' | 'axe' | 'club';
  /** How much it stoops. */
  hunch: number;
}

const MONSTER_SHAPES: Record<string, MonsterShape> = {
  goblin: { size: 0.78, torso: [4, 5], head: 3.4, arm: 'blade', hunch: 2.4 },
  orc: { size: 1.15, torso: [6, 7], head: 4.2, tusk: 1.6, arm: 'axe', hunch: 1.2 },
  ogre: { size: 1.75, torso: [9, 9.5], head: 5.4, tusk: 2.4, arm: 'club', hunch: 2 },
};

/** A thing on two legs with something in its hand. Feet at (sx, sy). */
function drawMonsterBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose, m: MonsterShape): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom * m.size * (pose.facing < 0 ? -1 : 1), zoom * m.size);
  const swing = pose.moving ? Math.sin(pose.phase) * 3 : 0;
  const [tw, th] = m.torso;
  const hip = -(th + 6);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 0, tw * 1.3, tw * 0.55, 0, 0, TAU);
  ctx.fill();
  // Legs: short, wide and bent.
  ctx.fillStyle = pose.colors[0];
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * tw * 0.55 - 1.4, hip);
    ctx.lineTo(side * tw * 0.55 + 1.4, hip);
    ctx.lineTo(side * tw * 0.7 + 1.6 + side * swing * 0.3, -0.5);
    ctx.lineTo(side * tw * 0.7 - 1.8 + side * swing * 0.3, -0.5);
    ctx.closePath();
    ctx.fill();
  }
  // Torso, leaning forward.
  ctx.save();
  ctx.rotate((-m.hunch * Math.PI) / 180);
  ctx.fillStyle = pose.colors[0];
  ctx.beginPath();
  ctx.ellipse(0, hip - th * 0.8, tw, th, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = pose.colors[1];
  ctx.beginPath();
  ctx.ellipse(tw * 0.25, hip - th * 0.55, tw * 0.6, th * 0.65, 0, 0, TAU);
  ctx.fill();
  // The arm and what is in it.
  const shoulder = hip - th * 1.35;
  ctx.strokeStyle = pose.colors[0];
  ctx.lineWidth = tw * 0.42;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tw * 0.5, shoulder);
  ctx.lineTo(tw * 1.3, shoulder + th * 0.5 + swing);
  ctx.stroke();
  const hx = tw * 1.3;
  const hy = shoulder + th * 0.5 + swing;
  if (m.arm === 'club') {
    ctx.strokeStyle = '#6b543a';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(hx - 1, hy + 5);
    ctx.lineTo(hx + 3, hy - th * 1.5);
    ctx.stroke();
    ctx.fillStyle = '#5a4630';
    ctx.beginPath();
    ctx.ellipse(hx + 3.4, hy - th * 1.6, 3.4, 4.4, 0.3, 0, TAU);
    ctx.fill();
  } else {
    ctx.strokeStyle = '#8d8f92';
    ctx.lineWidth = m.arm === 'axe' ? 2.2 : 1.3;
    ctx.beginPath();
    ctx.moveTo(hx, hy + 2);
    ctx.lineTo(hx + 2, hy - th * 1.3);
    ctx.stroke();
    if (m.arm === 'axe') {
      ctx.fillStyle = '#9a9ca0';
      ctx.beginPath();
      ctx.moveTo(hx + 2, hy - th * 1.3);
      ctx.lineTo(hx + 7, hy - th * 1.15);
      ctx.lineTo(hx + 2.6, hy - th * 0.8);
      ctx.closePath();
      ctx.fill();
    }
  }
  // Head, jaw and eyes.
  const headY = shoulder - m.head * 0.9;
  ctx.fillStyle = pose.colors[0];
  ctx.beginPath();
  ctx.ellipse(tw * 0.25, headY, m.head, m.head * 0.9, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = pose.colors[1];
  ctx.beginPath();
  ctx.ellipse(tw * 0.25 + m.head * 0.55, headY + m.head * 0.35, m.head * 0.5, m.head * 0.4, 0, 0, TAU);
  ctx.fill();
  if (m.tusk) {
    ctx.fillStyle = '#e8e2cf';
    for (const side of [-0.15, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(tw * 0.25 + m.head * (0.35 + side), headY + m.head * 0.55);
      ctx.lineTo(tw * 0.25 + m.head * (0.5 + side), headY - m.tusk);
      ctx.lineTo(tw * 0.25 + m.head * (0.62 + side), headY + m.head * 0.55);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.fillStyle = '#e0574d';
  ctx.beginPath();
  ctx.ellipse(tw * 0.25 + m.head * 0.45, headY - m.head * 0.2, m.head * 0.16, m.head * 0.14, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

/** The one thing on the island with wings. Feet at (sx, sy). */
function drawDragonBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom * 2.1 * (pose.facing < 0 ? -1 : 1), zoom * 2.1);
  const beat = Math.sin(pose.phase * 0.9) * 3;
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 15, 6, 0, 0, TAU);
  ctx.fill();
  // Wings behind, half spread.
  ctx.fillStyle = pose.colors[1];
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-1, -14);
    ctx.quadraticCurveTo(-14 * side, -26 - beat, -20 * side, -12 - beat);
    ctx.quadraticCurveTo(-10 * side, -14, -1, -10);
    ctx.closePath();
    ctx.fill();
  }
  // Tail, out behind and down.
  ctx.strokeStyle = pose.colors[0];
  ctx.lineWidth = 3.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-6, -9);
  ctx.quadraticCurveTo(-20, -6, -26, -1);
  ctx.stroke();
  // Legs.
  ctx.lineWidth = 3;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 4, -9);
    ctx.lineTo(side * 5.5, -0.5);
    ctx.stroke();
  }
  // Barrel.
  ctx.fillStyle = pose.colors[0];
  ctx.beginPath();
  ctx.ellipse(0, -11, 11, 6.5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = pose.colors[1];
  ctx.beginPath();
  ctx.ellipse(2, -8.5, 8, 3.6, 0, 0, TAU);
  ctx.fill();
  // Neck and head, carried high.
  ctx.strokeStyle = pose.colors[0];
  ctx.lineWidth = 4.4;
  ctx.beginPath();
  ctx.moveTo(7, -13);
  ctx.quadraticCurveTo(15, -20, 17, -26);
  ctx.stroke();
  ctx.fillStyle = pose.colors[0];
  ctx.beginPath();
  ctx.ellipse(18.5, -27.5, 5, 3.4, -0.35, 0, TAU);
  ctx.fill();
  // Jaw, horns and an eye that is looking at you.
  ctx.fillStyle = pose.colors[1];
  ctx.beginPath();
  ctx.moveTo(17, -26);
  ctx.lineTo(24.5, -27.5);
  ctx.lineTo(17.5, -24.6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = pose.colors[1];
  ctx.lineWidth = 1.1;
  for (const o of [0, 1.6]) {
    ctx.beginPath();
    ctx.moveTo(16.5 - o * 0.4, -29.4);
    ctx.lineTo(13 - o, -33.4);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffd76a';
  ctx.beginPath();
  ctx.ellipse(19.6, -28.8, 1.1, 0.9, 0, 0, TAU);
  ctx.fill();
  // Plates along the spine.
  ctx.fillStyle = pose.colors[1];
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 4 - 1.6, -16.5);
    ctx.lineTo(i * 4, -20.5);
    ctx.lineTo(i * 4 + 1.6, -16.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function drawCreature(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  // Age is drawn rather than written: a yearling is two thirds the size of
  // its parents and an old one has put weight on.
  zoom *= pose.scale ?? 1;
  if (pose.species === 'vola') drawVolaBody(ctx, sx, sy, zoom, pose);
  else if (pose.species === 'bevere') drawBevereBody(ctx, sx, sy, zoom, pose);
  else if (pose.species === 'seavic') drawSeavicBody(ctx, sx, sy, zoom, pose);
  else if (pose.species === 'mola') drawMolaBody(ctx, sx, sy, zoom, pose);
  else if (pose.species === 'crawler') drawCrawlerBody(ctx, sx, sy, zoom, pose);
  else if (pose.species === 'noot') drawNootBody(ctx, sx, sy, zoom, pose);
  else if (pose.species === 'embra') drawEmbraBody(ctx, sx, sy, zoom, pose);
  else if (pose.species === 'quarra') drawQuarraBody(ctx, sx, sy, zoom, pose);
  else if (pose.species === 'woola') drawWoolaBody(ctx, sx, sy, zoom, pose);
  else if (pose.species === 'ulva') drawUlvaBody(ctx, sx, sy, zoom, pose);
  else if (pose.species === 'magga') drawMaggaBody(ctx, sx, sy, zoom, pose);
  else if (pose.species === 'roxxen') drawRoxxenBody(ctx, sx, sy, zoom, pose);
  else if (pose.species === 'orse') drawOrseBody(ctx, sx, sy, zoom, pose);
  else if (pose.species === 'rowl') drawRowlBody(ctx, sx, sy, zoom, pose);
  else if (pose.species === 'vesp') drawVespBody(ctx, sx, sy, zoom, pose);
  else if (pose.species === 'lume') drawLumeBody(ctx, sx, sy, zoom, pose);
  else if (pose.species === 'dragon') drawDragonBody(ctx, sx, sy, zoom, pose);
  else if (pose.species && MONSTER_SHAPES[pose.species]) drawMonsterBody(ctx, sx, sy, zoom, pose, MONSTER_SHAPES[pose.species]);
  else if (pose.species && BEASTS[pose.species]) drawBeastBody(ctx, sx, sy, zoom, pose, BEASTS[pose.species]);
  else if (pose.species && BIRDS[pose.species]) drawBirdBody(ctx, sx, sy, zoom, pose, BIRDS[pose.species]);
  else drawRabbaBody(ctx, sx, sy, zoom, pose);
  drawCreatureOverlay(ctx, sx, sy, zoom, pose);
}

/** A Roxxen: a wall of ox, head low, horns forward. Feet at (sx, sy). */
function drawRoxxenBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom * (pose.facing < 0 ? -1 : 1), zoom);
  const plod = pose.moving ? Math.abs(Math.sin(pose.phase * 0.8)) * 0.8 : 0;
  const [hide, pale] = pose.colors;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 14, 5.6, 0, 0, TAU);
  ctx.fill();
  // Four posts of legs, swinging slowly and barely leaving the ground.
  ctx.strokeStyle = hide;
  ctx.lineWidth = 3.4;
  ctx.lineCap = 'round';
  for (const [lx, ph] of [[-7, 0], [-5, Math.PI], [5.5, Math.PI], [7.5, 0]] as Array<[number, number]>) {
    const step = pose.moving ? Math.sin(pose.phase * 0.8 + ph) * 1.6 : 0;
    ctx.beginPath();
    ctx.moveTo(lx, -10 - plod);
    ctx.lineTo(lx + step, -0.8);
    ctx.stroke();
  }
  // A deep barrel of a body with a hump over the shoulders.
  ctx.fillStyle = hide;
  ctx.beginPath();
  ctx.ellipse(-0.5, -13 - plod, 10.5, 6.4, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(4.5, -18 - plod, 5, 3.4, -0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = pale;
  ctx.beginPath();
  ctx.ellipse(-1, -9.5 - plod, 8, 2.6, 0, 0, TAU);
  ctx.fill();
  // Tail with a tuft on the end of it.
  ctx.strokeStyle = hide;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-10, -15 - plod);
  ctx.quadraticCurveTo(-13.5, -12 - plod, -12.6, -5 - plod);
  ctx.stroke();
  ctx.fillStyle = pale;
  ctx.beginPath();
  ctx.ellipse(-12.6, -4.2 - plod, 1.2, 2, 0, 0, TAU);
  ctx.fill();
  // Head carried low, and horns that sweep forward past the muzzle.
  ctx.fillStyle = hide;
  ctx.beginPath();
  ctx.ellipse(11.5, -13 - plod, 5, 4.2, 0.15, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(15.5, -11.5 - plod, 3.4, 2.6, 0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = pale;
  ctx.beginPath();
  ctx.ellipse(17.4, -11 - plod, 1.8, 1.7, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#e8e2d0';
  ctx.lineWidth = 2;
  for (const up of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(10.5, -16.5 - plod + up * 0.8);
    ctx.quadraticCurveTo(15, -18.5 - plod + up * 1.6, 18.5, -15.5 - plod + up * 2.4);
    ctx.stroke();
  }
  ctx.fillStyle = '#2a2018';
  ctx.beginPath();
  ctx.arc(13.4, -14 - plod, 0.8, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** An Orse: long legs, deep chest, a mane over one side. Feet at (sx, sy). */
function drawOrseBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom * (pose.facing < 0 ? -1 : 1), zoom);
  const gait = pose.moving ? Math.abs(Math.sin(pose.phase)) * 1.4 : 0;
  const [coat, mane] = pose.colors;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 12, 4.8, 0, 0, TAU);
  ctx.fill();
  // Long legs, a fore and a hind pair out of phase.
  ctx.strokeStyle = coat;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  for (const [lx, ph] of [[-6.4, 0], [-4.6, Math.PI], [5, Math.PI], [7, 0]] as Array<[number, number]>) {
    const swing = pose.moving ? Math.sin(pose.phase + ph) * 3 : 0;
    ctx.beginPath();
    ctx.moveTo(lx, -13 - gait);
    ctx.quadraticCurveTo(lx + swing * 0.4, -7 - gait, lx + swing, -0.7);
    ctx.stroke();
  }
  // Barrel and quarters.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(0, -15.5 - gait, 9.4, 4.8, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-6.4, -16 - gait, 4.4, 4.4, 0, 0, TAU);
  ctx.fill();
  // Tail.
  ctx.strokeStyle = mane;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-9.6, -17 - gait);
  ctx.quadraticCurveTo(-13.4, -13 - gait, -12.4, -5.5 - gait);
  ctx.stroke();
  // Neck up to a small head, with the mane lying along it.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.moveTo(6, -13 - gait);
  ctx.quadraticCurveTo(10.6, -16 - gait, 12.4, -23 - gait);
  ctx.lineTo(15.4, -22.4 - gait);
  ctx.quadraticCurveTo(13.6, -15.4 - gait, 9.6, -12.4 - gait);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = mane;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(7.6, -17.4 - gait);
  ctx.quadraticCurveTo(11.4, -20 - gait, 13.2, -24 - gait);
  ctx.stroke();
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(15, -24 - gait, 3.6, 2.5, 0.35, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(17.6, -22.4 - gait, 2.2, 1.7, 0.35, 0, TAU);
  ctx.fill();
  // Ears pricked, and an eye.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.moveTo(13.4, -26.4 - gait);
  ctx.lineTo(14.4, -29 - gait);
  ctx.lineTo(15.4, -26 - gait);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#20191a';
  ctx.beginPath();
  ctx.arc(15.8, -24.4 - gait, 0.8, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A Rowl: leaner than an Ulva, ruffed at the shoulder, nose down. */
function drawRowlBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom * (pose.facing < 0 ? -1 : 1), zoom);
  const lope = pose.moving ? Math.abs(Math.sin(pose.phase * 1.2)) * 1.1 : 0;
  const [coat, ruff] = pose.colors;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 11, 4.4, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = coat;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  for (const [lx, ph] of [[-5.4, 0], [-3.8, Math.PI], [4.2, Math.PI], [6, 0]] as Array<[number, number]>) {
    const swing = pose.moving ? Math.sin(pose.phase * 1.2 + ph) * 2.6 : 0.2;
    ctx.beginPath();
    ctx.moveTo(lx, -9.5 - lope);
    ctx.quadraticCurveTo(lx + swing * 0.5, -5 - lope, lx + swing, -0.7);
    ctx.stroke();
  }
  // A long back that drops away to the hips.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.moveTo(-7.6, -9.4 - lope);
  ctx.quadraticCurveTo(-2, -12.6 - lope, 4.4, -13.6 - lope);
  ctx.quadraticCurveTo(9, -13.8 - lope, 9.4, -9.6 - lope);
  ctx.quadraticCurveTo(2, -7.4 - lope, -7.2, -7.6 - lope);
  ctx.closePath();
  ctx.fill();
  // The ruff, which is what tells it from an Ulva at a distance.
  ctx.fillStyle = ruff;
  ctx.beginPath();
  ctx.ellipse(6.6, -12 - lope, 3.6, 3.2, -0.3, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(1.5, -8.6 - lope, 3.6, 1.4, -0.1, 0, TAU);
  ctx.fill();
  // Brush of a tail, carried low.
  ctx.strokeStyle = coat;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-7.6, -10.2 - lope);
  ctx.quadraticCurveTo(-12.4, -9 - lope, -14.8, -5.6 - lope);
  ctx.stroke();
  // Head low and long, muzzle first, ears back.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(10.4, -11.4 - lope, 3.8, 3, -0.18, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(12.2, -12.6 - lope);
  ctx.lineTo(17.4, -10.4 - lope);
  ctx.lineTo(12.2, -9 - lope);
  ctx.closePath();
  ctx.fill();
  for (const dx of [-1.4, 0.9]) {
    ctx.beginPath();
    ctx.moveTo(9.4 + dx, -13.8 - lope);
    ctx.lineTo(9.9 + dx, -16.4 - lope);
    ctx.lineTo(11.4 + dx, -13.4 - lope);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#c9a227';
  ctx.beginPath();
  ctx.arc(12.2, -12 - lope, 0.75, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#1b1714';
  ctx.beginPath();
  ctx.arc(17.2, -10.4 - lope, 0.7, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A Rabba: round body, long ears, twitchy. Feet at (sx, sy). */
function drawRabbaBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
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
}

/**
 * A Vola: a low, velvety digger. Broad pale shovel paws in front, a pink
 * snout, tiny eyes and a stubby tail. It waddles rather than hops.
 */
function drawVolaBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom * (pose.facing < 0 ? -1 : 1), zoom);
  // A waddle: the body rocks side to side instead of leaving the ground.
  const rock = pose.moving ? Math.sin(pose.phase) * 0.9 : Math.sin(pose.phase * 0.25) * 0.15;
  const lift = pose.moving ? Math.abs(Math.sin(pose.phase)) * 0.8 : 0;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 11, 5, 0, 0, TAU);
  ctx.fill();
  const [fur, belly] = pose.colors;
  const paw = '#e9cdbd';
  // hind foot
  ctx.fillStyle = paw;
  ctx.beginPath();
  ctx.ellipse(-5, -1.6, 2.4, 1.4, 0, 0, TAU);
  ctx.fill();
  // tail: short and tapered
  ctx.strokeStyle = belly;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-7.5, -4.5 - lift);
  ctx.quadraticCurveTo(-10.5, -5.5 - lift, -11, -8 - lift);
  ctx.stroke();
  // body: a long low loaf that tapers into the snout
  ctx.save();
  ctx.rotate(rock * 0.03);
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(-0.5, -5 - lift, 8.2, 4.4, -0.06, 0, TAU);
  ctx.fill();
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(-0.5, -3.4 - lift, 5.6, 2.2, -0.06, 0, TAU);
  ctx.fill();
  // head runs straight on from the body, no neck
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(6, -5.6 - lift, 4, 3.6, 0, 0, TAU);
  ctx.fill();
  // snout
  ctx.fillStyle = '#e8a0a4';
  ctx.beginPath();
  ctx.ellipse(9.6, -4.9 - lift, 2.1, 1.5, 0.25, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#c9767c';
  ctx.beginPath();
  ctx.arc(11.1, -4.7 - lift, 0.7, 0, TAU);
  ctx.fill();
  // whiskers
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 0.5;
  for (const a of [-0.35, 0, 0.35]) {
    ctx.beginPath();
    ctx.moveTo(10.4, -4.9 - lift);
    ctx.lineTo(13.6, -4.9 - lift + a * 3.4);
    ctx.stroke();
  }
  // eye: a bead, nearly buried in fur
  ctx.fillStyle = '#221712';
  ctx.beginPath();
  ctx.arc(6.4, -6.6 - lift, 0.7, 0, TAU);
  ctx.fill();
  // ear: a small fold, no pinna
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(3.4, -7.6 - lift, 1.2, 0.9, -0.3, 0, TAU);
  ctx.fill();
  ctx.restore();
  // digging paws: broad, pale and turned outward, swinging as it walks
  const dig = pose.moving ? Math.sin(pose.phase) * 1.6 : 0;
  ctx.fillStyle = paw;
  for (const [px, py, ph] of [
    [5.6, -1.2, dig],
    [3.2, -1.6, -dig],
  ] as Array<[number, number, number]>) {
    ctx.save();
    ctx.translate(px + ph * 0.6, py - Math.max(0, ph) * 0.5);
    ctx.rotate(0.3);
    ctx.beginPath();
    ctx.ellipse(0, 0, 2.8, 1.7, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#c9a692';
    ctx.lineWidth = 0.4;
    for (const c of [-1.1, 0, 1.1]) {
      ctx.beginPath();
      ctx.moveTo(1.2, c * 0.5);
      ctx.lineTo(3.1, c * 0.75);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

/**
 * A Bevere: heavy in the haunches, low to the ground, with a broad scaled tail
 * it drags behind, small round ears and a pair of orange teeth.
 */
function drawBevereBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom * (pose.facing < 0 ? -1 : 1), zoom);
  const waddle = pose.moving ? Math.abs(Math.sin(pose.phase)) * 1.1 : 0;
  const sway = pose.moving ? Math.sin(pose.phase) * 2.2 : Math.sin(pose.phase * 0.3) * 0.6;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 11, 5, 0, 0, TAU);
  ctx.fill();
  const [fur, belly] = pose.colors;
  // The tail: a broad paddle dragged behind, swinging as it walks.
  ctx.save();
  ctx.translate(-7, -3 - waddle);
  ctx.rotate(sway * 0.05);
  ctx.fillStyle = '#4a3c34';
  ctx.beginPath();
  ctx.ellipse(-4.5, 1.5, 6.2, 2.9, -0.12, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 0.5;
  for (const d of [-2.5, 0, 2.5]) {
    ctx.beginPath();
    ctx.moveTo(-8.5, 1.5 + d * 0.35);
    ctx.lineTo(-1, 1.5 + d * 0.5);
    ctx.stroke();
  }
  ctx.restore();
  // Hind foot and body.
  ctx.fillStyle = '#3f342c';
  ctx.beginPath();
  ctx.ellipse(-3.5, -0.8, 2.8, 1.5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(-0.5, -6 - waddle, 8.6, 5.4, -0.05, 0, TAU);
  ctx.fill();
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(0, -4 - waddle, 6, 2.6, -0.05, 0, TAU);
  ctx.fill();
  // Head: blunt and set low on the shoulders.
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.arc(6.5, -8 - waddle, 4.4, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(9.8, -6.6 - waddle, 2.6, 2.1, 0.15, 0, TAU);
  ctx.fill();
  // Small round ear.
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.arc(4.2, -11 - waddle, 1.5, 0, TAU);
  ctx.fill();
  // Eye, nose and the orange teeth it is known for.
  ctx.fillStyle = '#241a12';
  ctx.beginPath();
  ctx.arc(7.6, -9 - waddle, 0.8, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(11.8, -6.8 - waddle, 0.8, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#e0a03c';
  ctx.fillRect(10.3, -5.6 - waddle, 1.5, 2.2);
  // Front paw.
  ctx.fillStyle = '#3f342c';
  ctx.beginPath();
  ctx.ellipse(5.4 + (pose.moving ? Math.sin(pose.phase) * 1.2 : 0), -0.9, 2.3, 1.4, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * A Seavic: upright on its haunches with a great plume of a tail curled up
 * behind it, tufted ears and cheeks packed with seed.
 */
function drawSeavicBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom * (pose.facing < 0 ? -1 : 1), zoom);
  const hop = pose.moving ? Math.abs(Math.sin(pose.phase)) * 3.4 : 0;
  const flick = Math.sin(pose.phase * (pose.moving ? 1 : 0.35)) * 0.12;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 11, 5, 0, 0, TAU);
  ctx.fill();
  const [fur, belly] = pose.colors;
  // The tail: a broad plume sweeping up behind and over the back.
  ctx.save();
  ctx.translate(-5, -5 - hop);
  ctx.rotate(flick);
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.moveTo(1, 3);
  ctx.quadraticCurveTo(-11, 1, -8.5, -11);
  ctx.quadraticCurveTo(-7, -18, -1.5, -16.5);
  ctx.quadraticCurveTo(-4.5, -12.5, -3.5, -7);
  ctx.quadraticCurveTo(-2.5, -1.5, 1, -1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = belly;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.moveTo(-2, -2);
  ctx.quadraticCurveTo(-6.5, -5, -5.5, -12);
  ctx.quadraticCurveTo(-4.5, -15, -2.5, -14.5);
  ctx.quadraticCurveTo(-4, -10, -2, -3);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
  // Haunches and upright body.
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(-1.5, -4 - hop, 5, 4.2, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(1, -9.5 - hop, 4.2, 5.2, -0.12, 0, TAU);
  ctx.fill();
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(2.4, -8.5 - hop, 2.4, 3.6, -0.12, 0, TAU);
  ctx.fill();
  // Head with tufted ears.
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.arc(3.2, -15.5 - hop, 3.8, 0, TAU);
  ctx.fill();
  for (const [ex, ey] of [
    [1.4, -19.2],
    [4.6, -19],
  ] as Array<[number, number]>) {
    ctx.beginPath();
    ctx.moveTo(ex - 1.5, ey + 2.4);
    ctx.quadraticCurveTo(ex - 0.3, ey - 3.4, ex + 1.5, ey + 2.2);
    ctx.closePath();
    ctx.fill();
  }
  // Cheek stuffed with seed, eye and nose.
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(5.4, -14 - hop, 2.2, 1.9, 0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#241a12';
  ctx.beginPath();
  ctx.arc(4.4, -16.6 - hop, 0.9, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(7, -14.6 - hop, 0.6, 0, TAU);
  ctx.fill();
  // Forepaws held up at the chest, the way a squirrel holds a nut.
  ctx.fillStyle = belly;
  const paw = pose.moving ? Math.sin(pose.phase) * 0.8 : 0;
  ctx.beginPath();
  ctx.ellipse(4, -9.5 - hop + paw, 1.5, 1.1, 0.3, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * A Mola: a Vola's bigger cousin, built around its claws. Heavy shoulders, a
 * blunt pink snout and two great pale digging hands it keeps out in front.
 */
function drawMolaBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom * (pose.facing < 0 ? -1 : 1), zoom);
  const dig = pose.moving ? Math.sin(pose.phase) : Math.sin(pose.phase * 0.6) * 0.35;
  const lift = pose.moving ? Math.abs(Math.sin(pose.phase)) * 0.9 : 0;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 11, 5, 0, 0, TAU);
  ctx.fill();
  const [fur, belly] = pose.colors;
  const claw = '#efe3d2';
  // Stubby tail and hind foot.
  ctx.strokeStyle = belly;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-8, -4 - lift);
  ctx.quadraticCurveTo(-10.5, -4.5 - lift, -10.8, -7);
  ctx.stroke();
  ctx.fillStyle = '#3a332e';
  ctx.beginPath();
  ctx.ellipse(-5, -1.4, 2.6, 1.5, 0, 0, TAU);
  ctx.fill();
  // A body that swells at the shoulders rather than the hips.
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(0.5, -6 - lift, 8.8, 5.2, -0.08, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(4.5, -7.5 - lift, 5.4, 4.6, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(0, -4 - lift, 5.6, 2.2, -0.08, 0, TAU);
  ctx.fill();
  // Head running straight out of the shoulders into a bare snout.
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(8.4, -7.4 - lift, 3.6, 3.2, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#e8a0a4';
  ctx.beginPath();
  ctx.ellipse(11.8, -6.6 - lift, 2.4, 1.7, 0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#c9767c';
  ctx.beginPath();
  ctx.arc(13.4, -6.4 - lift, 0.75, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#1e1611';
  ctx.beginPath();
  ctx.arc(8.6, -8.8 - lift, 0.7, 0, TAU);
  ctx.fill();
  // The claws: broad pale spades, working one forward one back.
  for (const [px, py, ph, scale] of [
    [7.6, -1.6, dig, 1],
    [4.4, -2.2, -dig, 0.88],
  ] as Array<[number, number, number, number]>) {
    ctx.save();
    ctx.translate(px + ph * 1.5, py - Math.max(0, ph) * 1.2);
    ctx.rotate(0.25 + ph * 0.18);
    ctx.scale(scale, scale);
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.ellipse(-1.6, 0, 2.4, 1.9, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = claw;
    ctx.beginPath();
    ctx.ellipse(1.2, 0, 3.2, 2.3, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#b9a894';
    ctx.lineWidth = 0.55;
    for (const d of [-1.3, -0.45, 0.45, 1.3]) {
      ctx.beginPath();
      ctx.moveTo(1.6, d * 1.1);
      ctx.lineTo(4.6, d * 1.5);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

/** An Embra: low, soot-dark and softly alight along the back. */
function drawEmbraBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom * (pose.facing < 0 ? -1 : 1), zoom);
  const lift = pose.moving ? Math.abs(Math.sin(pose.phase)) * 1 : 0;
  const glow = 0.55 + Math.sin(pose.phase * 1.6) * 0.2;
  const [coat, ember] = pose.colors;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 10, 4.6, 0, 0, TAU);
  ctx.fill();
  // The heat it carries, showing under it before the body is drawn.
  ctx.globalAlpha = glow * 0.5;
  ctx.fillStyle = ember;
  ctx.beginPath();
  ctx.ellipse(0, -1, 9, 3.4, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = coat;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  for (const [lx, ph] of [[-5, 0], [-1.5, 1.6], [2, 3.1], [5, 4.6]] as Array<[number, number]>) {
    const step = pose.moving ? Math.sin(pose.phase + ph) * 1.4 : 0;
    ctx.beginPath();
    ctx.moveTo(lx, -5 - lift);
    ctx.lineTo(lx + step, -0.8);
    ctx.stroke();
  }
  // A long, low body with a ridge of banked coals down it.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(0, -7 - lift, 9.4, 4.6, -0.03, 0, TAU);
  ctx.fill();
  ctx.fillStyle = ember;
  ctx.globalAlpha = glow;
  for (const [rx, r] of [[-5.5, 1.5], [-2, 1.9], [1.6, 1.7], [5, 1.3]] as Array<[number, number]>) {
    ctx.beginPath();
    ctx.ellipse(rx, -10.4 - lift, r, r * 0.7, 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Head, low and blunt, with one banked eye.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(8.6, -7.6 - lift, 4.2, 3.6, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = ember;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.ellipse(10.6, -7.8 - lift, 1.1, 0.8, 0.2, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#12100e';
  ctx.beginPath();
  ctx.arc(9.4, -9 - lift, 0.75, 0, TAU);
  ctx.fill();
  // A tail like a poker, trailing sparks when it moves.
  ctx.strokeStyle = coat;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(-8.6, -7 - lift);
  ctx.quadraticCurveTo(-12.5, -7.5 - lift, -13.4, -10.5 - lift);
  ctx.stroke();
  if (pose.moving) {
    ctx.fillStyle = ember;
    for (let i = 0; i < 3; i++) {
      const t = (pose.phase * 0.3 + i / 3) % 1;
      ctx.globalAlpha = 0.6 * (1 - t);
      ctx.beginPath();
      ctx.arc(-13.4 - t * 4, -11 - t * 5 - lift, 0.9 * (1 - t) + 0.3, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** A Quarra: a slab of a creature with a jaw made for stone. */
function drawQuarraBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom * (pose.facing < 0 ? -1 : 1), zoom);
  const plod = pose.moving ? Math.abs(Math.sin(pose.phase)) * 0.8 : 0;
  const [stone, pale] = pose.colors;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 12, 5.4, 0, 0, TAU);
  ctx.fill();
  // Four short, thick legs.
  ctx.fillStyle = stone;
  for (const [lx, ph] of [[-6.5, 0], [-2.5, Math.PI], [3, 0.8], [6.5, 3.6]] as Array<[number, number]>) {
    const step = pose.moving ? Math.max(0, Math.sin(pose.phase + ph)) * 1.2 : 0;
    ctx.beginPath();
    ctx.ellipse(lx, -2.4 - step, 2.2, 2.6, 0, 0, TAU);
    ctx.fill();
  }
  // Body: a boulder with a flat back.
  ctx.beginPath();
  ctx.moveTo(-9.5, -5 - plod);
  ctx.quadraticCurveTo(-10.5, -12 - plod, -3, -12.6 - plod);
  ctx.lineTo(5, -12.2 - plod);
  ctx.quadraticCurveTo(10, -11.6 - plod, 9.6, -5 - plod);
  ctx.quadraticCurveTo(0, -2.6 - plod, -9.5, -5 - plod);
  ctx.closePath();
  ctx.fill();
  // Plates of lighter stone across the back.
  ctx.fillStyle = pale;
  for (const [px, w] of [[-5.5, 3.4], [-0.5, 3.8], [4.4, 3]] as Array<[number, number]>) {
    ctx.beginPath();
    ctx.ellipse(px, -11.4 - plod, w, 1.5, -0.04, 0, TAU);
    ctx.fill();
  }
  // Head: mostly jaw, set low and forward.
  ctx.fillStyle = stone;
  ctx.beginPath();
  ctx.ellipse(11, -7.4 - plod, 4.6, 3.8, -0.1, 0, TAU);
  ctx.fill();
  ctx.fillStyle = pale;
  ctx.beginPath();
  ctx.moveTo(8.6, -5.4 - plod);
  ctx.lineTo(15.8, -6.2 - plod);
  ctx.lineTo(15.2, -4 - plod);
  ctx.lineTo(8.8, -3.8 - plod);
  ctx.closePath();
  ctx.fill();
  // Chisel teeth.
  ctx.fillStyle = '#f2efe6';
  for (const tx of [10.2, 12.2, 14.2]) {
    ctx.beginPath();
    ctx.moveTo(tx, -5.6 - plod);
    ctx.lineTo(tx + 1.1, -5.6 - plod);
    ctx.lineTo(tx + 0.55, -4.2 - plod);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#1d1c1a';
  ctx.beginPath();
  ctx.arc(11.6, -9.4 - plod, 0.85, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A Woola: a fleece with a face, and the fleece shows what is on it. */
function drawWoolaBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom * (pose.facing < 0 ? -1 : 1), zoom);
  const bob = pose.moving ? Math.abs(Math.sin(pose.phase)) * 1.2 : 0;
  const [fleece, shade] = pose.colors;
  // How much wool is on it, passed through on the health slot's sibling.
  const full = pose.fleece ?? 1;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 10, 4.6, 0, 0, TAU);
  ctx.fill();
  // Legs, thin and dark under all that wool.
  ctx.strokeStyle = '#4a423a';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  for (const [lx, ph] of [[-4.5, 0], [-2, 2.2], [2.5, 1.1], [5, 3.3]] as Array<[number, number]>) {
    const step = pose.moving ? Math.sin(pose.phase + ph) * 1.3 : 0;
    ctx.beginPath();
    ctx.moveTo(lx, -6 - bob);
    ctx.lineTo(lx + step, -0.6);
    ctx.stroke();
  }
  // The fleece itself: a cloud of overlapping curls that thins as it is shorn.
  const r = 4.4 + full * 3.2;
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.ellipse(-0.5, -9 - bob, r + 1.4, r * 0.85, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = fleece;
  for (const [cx, cy, cr] of [
    [-5, -9.5, 0.62],
    [-1.5, -11, 0.72],
    [2, -10.4, 0.66],
    [4.6, -8.6, 0.55],
    [-3.5, -7.4, 0.55],
    [0.6, -7, 0.6],
  ] as Array<[number, number, number]>) {
    ctx.beginPath();
    ctx.ellipse(cx, cy - bob, r * cr, r * cr * 0.82, 0, 0, TAU);
    ctx.fill();
  }
  // Head: bare, dark and entirely untroubled.
  ctx.fillStyle = '#574e44';
  ctx.beginPath();
  ctx.ellipse(8, -8.6 - bob, 3.4, 3, -0.1, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(10.6, -7.6 - bob, 2, 1.5, 0.15, 0, TAU);
  ctx.fill();
  // Ears out sideways.
  ctx.strokeStyle = '#574e44';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(6.6, -10.4 - bob);
  ctx.lineTo(4.6, -11.6 - bob);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(7.4, -10.2 - bob);
  ctx.lineTo(6.6, -12 - bob);
  ctx.stroke();
  ctx.fillStyle = '#14110f';
  ctx.beginPath();
  ctx.arc(9, -9.4 - bob, 0.7, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** An Ulva: long in the leg, low in the head, and coming your way. */
function drawUlvaBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom * (pose.facing < 0 ? -1 : 1), zoom);
  const run = pose.moving ? Math.sin(pose.phase) : Math.sin(pose.phase * 0.3) * 0.15;
  const lift = pose.moving ? Math.abs(Math.sin(pose.phase * 2)) * 0.9 : 0;
  const [coat, belly] = pose.colors;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 11, 4.6, 0, 0, TAU);
  ctx.fill();
  // Legs: two pairs, swinging opposite.
  ctx.strokeStyle = coat;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  for (const [lx, ph, len] of [
    [-5.6, 0, 8],
    [-4.2, Math.PI, 8],
    [4.4, Math.PI, 8.5],
    [5.8, 0, 8.5],
  ] as Array<[number, number, number]>) {
    const swing = Math.sin(pose.phase + ph) * (pose.moving ? 2.4 : 0.3);
    ctx.beginPath();
    ctx.moveTo(lx, -9 - lift);
    ctx.quadraticCurveTo(lx + swing * 0.5, -9 + len * 0.5 - lift, lx + swing, -0.8);
    ctx.stroke();
  }
  // A deep chest tapering to the hips.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.moveTo(-7.5, -9.5 - lift);
  ctx.quadraticCurveTo(-2, -13.4 - lift, 5, -13 - lift);
  ctx.quadraticCurveTo(9.4, -12.6 - lift, 9, -8.4 - lift);
  ctx.quadraticCurveTo(2, -7 - lift, -7, -7.6 - lift);
  ctx.closePath();
  ctx.fill();
  // A pale throat and chest, tucked under the ribs rather than hung below them.
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(3.4, -8.6 - lift, 3.2, 1.5, -0.18, 0, TAU);
  ctx.fill();
  // Tail, low and level when hunting.
  ctx.strokeStyle = coat;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-7.4, -10 - lift);
  ctx.quadraticCurveTo(-12, -9.6 - lift + run * 0.8, -14.6, -11.6 - lift + run * 1.4);
  ctx.stroke();
  // Head held out level, muzzle first.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(9.6, -11 - lift, 4, 3.2, -0.12, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(11.4, -12.4 - lift);
  ctx.lineTo(16.4, -10.6 - lift);
  ctx.lineTo(11.4, -8.8 - lift);
  ctx.closePath();
  ctx.fill();
  // Ears pricked forward.
  for (const [ex, ey] of [[8, -13.6], [10.4, -13.2]] as Array<[number, number]>) {
    ctx.beginPath();
    ctx.moveTo(ex - 1.1, ey + 1.4 - lift);
    ctx.lineTo(ex + 0.3, ey - 2.6 - lift);
    ctx.lineTo(ex + 1.5, ey + 1 - lift);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#e8d76a';
  ctx.beginPath();
  ctx.ellipse(10.6, -11.6 - lift, 0.9, 0.7, -0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#100e0c';
  ctx.beginPath();
  ctx.arc(16.2, -10.6 - lift, 0.7, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A Magga: black and white, long-tailed, and always about to take something. */
function drawMaggaBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom * (pose.facing < 0 ? -1 : 1), zoom);
  const hop = pose.moving ? Math.abs(Math.sin(pose.phase)) * 3.2 : 0;
  const [feather, pale] = pose.colors;
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 7.5, 3.4, 0, 0, TAU);
  ctx.fill();
  // Spindly legs, tucked when it hops.
  ctx.strokeStyle = '#d8a04c';
  ctx.lineWidth = 1.1;
  ctx.lineCap = 'round';
  for (const lx of [-1.4, 1.4]) {
    ctx.beginPath();
    ctx.moveTo(lx, -5 - hop);
    ctx.lineTo(lx + (hop > 0 ? 1 : 0), -0.6 - hop * 0.5);
    ctx.stroke();
  }
  // Long tail, angled up behind.
  ctx.fillStyle = feather;
  ctx.beginPath();
  ctx.moveTo(-2.5, -7 - hop);
  ctx.lineTo(-12.5, -11.5 - hop);
  ctx.lineTo(-11.5, -9 - hop);
  ctx.lineTo(-2.5, -5 - hop);
  ctx.closePath();
  ctx.fill();
  // Body and the white flash on the flank.
  ctx.beginPath();
  ctx.ellipse(0, -7.6 - hop, 5.4, 4.2, -0.1, 0, TAU);
  ctx.fill();
  ctx.fillStyle = pale;
  ctx.beginPath();
  ctx.ellipse(0.8, -6.8 - hop, 3.4, 2.6, -0.1, 0, TAU);
  ctx.fill();
  // Folded wing over the white.
  ctx.fillStyle = feather;
  ctx.beginPath();
  ctx.ellipse(-1.4, -8.6 - hop, 4, 2, -0.25, 0, TAU);
  ctx.fill();
  // Head and beak.
  ctx.beginPath();
  ctx.ellipse(5, -11.4 - hop, 3, 2.8, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#2b2b2e';
  ctx.beginPath();
  ctx.moveTo(7.2, -12 - hop);
  ctx.lineTo(11.4, -11 - hop);
  ctx.lineTo(7.2, -10 - hop);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f6f4ee';
  ctx.beginPath();
  ctx.arc(6, -12.2 - hop, 0.9, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#100e0c';
  ctx.beginPath();
  ctx.arc(6.2, -12.2 - hop, 0.5, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A Noot: upright, plump, bill first, with a flat tail to sit back on. */
function drawNootBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom * (pose.facing < 0 ? -1 : 1), zoom);
  // A waddle rather than a walk: it rocks from foot to foot.
  const rock = pose.moving ? Math.sin(pose.phase) * 0.16 : Math.sin(pose.phase * 0.35) * 0.04;
  const bob = pose.moving ? Math.abs(Math.sin(pose.phase)) * 1.2 : 0;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 10, 4.5, 0, 0, TAU);
  ctx.fill();
  const [coat, front] = pose.colors;
  const foot = '#e09340';
  // Feet, planted wide and turned out.
  ctx.fillStyle = foot;
  for (const [fx, ph] of [
    [-3.4, 0],
    [3.2, Math.PI],
  ] as Array<[number, number]>) {
    const lift = pose.moving ? Math.max(0, Math.sin(pose.phase + ph)) * 1.4 : 0;
    ctx.beginPath();
    ctx.ellipse(fx, -1 - lift, 3.4, 1.6, 0, 0, TAU);
    ctx.fill();
  }
  ctx.rotate(rock);
  // The flat tail it leans back on.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.moveTo(-4, -4 - bob);
  ctx.quadraticCurveTo(-11, -2.5 - bob, -12.5, -0.6);
  ctx.quadraticCurveTo(-8.5, -1.2, -4, -1.4 - bob);
  ctx.closePath();
  ctx.fill();
  // Body: a wide-bottomed pear standing on end.
  ctx.beginPath();
  ctx.ellipse(0, -10 - bob, 7.4, 9.2, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = front;
  ctx.beginPath();
  ctx.ellipse(1.2, -9.4 - bob, 5.2, 7.4, 0.04, 0, TAU);
  ctx.fill();
  // Flippers: one tucked against the near side, one swinging behind.
  const swing = pose.moving ? Math.sin(pose.phase) * 1.6 : 0;
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(-6.6, -10 - bob + swing * 0.3, 2.1, 5, 0.3 + swing * 0.06, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(6.4, -10.4 - bob - swing * 0.3, 1.9, 4.6, -0.32 - swing * 0.06, 0, TAU);
  ctx.fill();
  // Head, set straight on the shoulders.
  ctx.beginPath();
  ctx.ellipse(0.6, -20.4 - bob, 5.4, 5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = front;
  ctx.beginPath();
  ctx.ellipse(2.4, -19.4 - bob, 3.4, 3.6, 0.1, 0, TAU);
  ctx.fill();
  // The bill: broad, blunt and orange, the whole reason it is any use in a clay pit.
  ctx.fillStyle = foot;
  ctx.beginPath();
  ctx.moveTo(3.4, -21.6 - bob);
  ctx.quadraticCurveTo(10.6, -21 - bob, 11.6, -19.2 - bob);
  ctx.quadraticCurveTo(9.4, -17.4 - bob, 3.6, -17.8 - bob);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,70,20,0.5)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(4, -19.6 - bob);
  ctx.lineTo(11, -19.4 - bob);
  ctx.stroke();
  // Eye.
  ctx.fillStyle = '#1a1712';
  ctx.beginPath();
  ctx.arc(2.6, -22.4 - bob, 0.95, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.arc(2.9, -22.7 - bob, 0.32, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A Crawler: a broad crab on eight legs, one claw far bigger than the other. */
function drawCrawlerBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom * (pose.facing < 0 ? -1 : 1), zoom);
  const swing = pose.moving ? 1 : 0.18;
  const sway = Math.sin(pose.phase * (pose.moving ? 1 : 0.4)) * (pose.moving ? 0.5 : 0.2);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 12, 5, 0, 0, TAU);
  ctx.fill();
  const [shell, pale] = pose.colors;
  const hips = [-6.2, -2.4, 1.2, 4.6];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // The four legs on the far side stand up over the shell, as they do in this view.
  ctx.strokeStyle = pale;
  ctx.lineWidth = 1.1;
  hips.forEach((hx, i) => {
    const lift = Math.max(0, Math.sin(pose.phase + i * 0.9)) * swing * 1.3;
    const tip = hx - 3.2 + i * 1.7;
    ctx.beginPath();
    ctx.moveTo(hx, -8.6);
    ctx.quadraticCurveTo(hx - 1.4 + i * 0.5, -13.4 - lift, tip, -11.8 - lift * 0.6);
    ctx.stroke();
  });
  // Carapace: broad, domed, and darker where it turns under.
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.ellipse(0, -6.8 + sway * 0.3, 9.8, 5.3, -0.03, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(0.2, -4.4 + sway * 0.3, 8.6, 2.1, -0.03, 0, TAU);
  ctx.fill();
  ctx.fillStyle = pale;
  ctx.beginPath();
  ctx.ellipse(-2.4, -9.8 + sway * 0.3, 4.2, 1.2, -0.12, 0, TAU);
  ctx.fill();
  // Two seams down the shell.
  ctx.strokeStyle = 'rgba(60,40,26,0.35)';
  ctx.lineWidth = 0.55;
  for (const [ax, r] of [
    [-3.4, 3],
    [2.6, 3.4],
  ] as Array<[number, number]>) {
    ctx.beginPath();
    ctx.arc(ax, -7.4 + sway * 0.3, r, 0.5, 2.4);
    ctx.stroke();
  }
  // Eyestalks on the leading edge, and the mouthparts under them.
  ctx.strokeStyle = shell;
  ctx.lineWidth = 1;
  for (const ex of [4.6, 7.2]) {
    ctx.beginPath();
    ctx.moveTo(ex, -9.4 + sway * 0.3);
    ctx.quadraticCurveTo(ex + 1.2, -12.4, ex + 0.7, -13.6 + sway * 0.4);
    ctx.stroke();
  }
  ctx.fillStyle = '#1a1410';
  for (const ex of [5.1, 7.7]) {
    ctx.beginPath();
    ctx.arc(ex, -14, 1.05, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = pale;
  ctx.beginPath();
  ctx.ellipse(8.8, -7.2 + sway * 0.3, 1.5, 1.1, 0.25, 0, TAU);
  ctx.fill();
  // The four near legs come down in front, feet on the sand.
  ctx.strokeStyle = shell;
  ctx.lineWidth = 1.5;
  hips.forEach((hx, i) => {
    const lift = Math.max(0, Math.sin(pose.phase + 1.6 + i * 0.9)) * swing * 1.6;
    const tip = hx - 3.4 + i * 1.8;
    ctx.beginPath();
    ctx.moveTo(hx, -5.4);
    ctx.quadraticCurveTo(hx - 2.6 + i * 0.6, -4.2 - lift, tip, -0.7 - lift);
    ctx.stroke();
  });
  // Both claws held out front, the big one first: it does the digging.
  for (const [px, py, scale, tilt, ph] of [
    [6, -2.6, 0.66, 0.16, -swing * Math.sin(pose.phase + 1.1)],
    [7.4, -5.6, 1.08, -0.2, swing * Math.sin(pose.phase)],
  ] as Array<[number, number, number, number, number]>) {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(tilt + ph * 0.12);
    ctx.scale(scale, scale);
    // Upper arm out to the elbow.
    ctx.strokeStyle = shell;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-0.6, 1.2);
    ctx.lineTo(2.6, 0.4);
    ctx.stroke();
    // The hand.
    ctx.fillStyle = shell;
    ctx.beginPath();
    ctx.ellipse(5.2, -0.2, 3.6, 2.5, -0.12, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.beginPath();
    ctx.ellipse(5.4, 1, 3.2, 1.1, -0.12, 0, TAU);
    ctx.fill();
    // The pincer, held a crack open.
    ctx.fillStyle = pale;
    ctx.beginPath();
    ctx.moveTo(7.4, -1.9);
    ctx.quadraticCurveTo(11.6, -3.4 - ph, 13.4, -2.2 - ph * 1.2);
    ctx.quadraticCurveTo(10.6, -1.4, 7.8, -0.9);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(7.4, 1.1);
    ctx.quadraticCurveTo(11.2, 1.8 + ph * 0.7, 13, 0.6 + ph * 0.9);
    ctx.quadraticCurveTo(10.4, 0.2, 7.8, -0.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/**
 * The eighteen newer wildermon are not drawn one at a time. Three kits cover
 * the lot: a thing on four legs, a thing standing on two, and a thing with no
 * bones in it at all. What tells a Shaggan from a Dowse is the numbers handed
 * to the kit — how long the legs are, how deep the barrel, what is carried on
 * the head — which is enough to know one across a field, and a great deal
 * less to keep than eighteen bodies would be.
 */
interface BeastShape {
  /** Half-width and half-height of the barrel. */
  body: [number, number];
  /** How high its belly rides off the ground. */
  ride: number;
  /** Legs: how long they swing, how thick they are, how wide they stand. */
  leg: number;
  legW: number;
  span: number;
  /** Head: how big, and where its middle sits from the middle of the barrel. */
  head: number;
  neck: [number, number];
  /** Snout out past the head; nothing for a blunt face. */
  muzzle?: number;
  ear?: 'round' | 'point' | 'long' | 'flop';
  horn?: 'curl' | 'sweep' | 'nub';
  tail?: 'tuft' | 'flat' | 'brush' | 'stub';
  /** A raised shoulder, for the ones built to push. */
  hump?: number;
  /** Tufts of hair hanging off the barrel. */
  shag?: number;
  /** A throat pouch under the jaw. */
  pouch?: number;
  /** An udder that fills, for the ones that are milked. */
  udder?: boolean;
  whisker?: boolean;
  /** Moss growing along the back. */
  moss?: boolean;
  /** How quickly the legs go over. */
  gait?: number;
}

const BEASTS: Record<string, BeastShape> = {
  bogga: { body: [10, 5.5], ride: 3.5, leg: 4, legW: 2.6, span: 7, head: 4, neck: [11, 0.5], muzzle: 2.4, ear: 'round', tail: 'flat', gait: 0.9 },
  holla: { body: [11, 7], ride: 5, leg: 6, legW: 3.2, span: 8, head: 4.6, neck: [12, -1], muzzle: 2.6, ear: 'round', tail: 'stub', pouch: 4, gait: 0.8 },
  dowse: { body: [7.5, 4.4], ride: 2.6, leg: 3.2, legW: 2, span: 5, head: 3.4, neck: [8.5, 0.6], muzzle: 2.8, ear: 'round', tail: 'stub', whisker: true, gait: 1.3 },
  sappa: { body: [9, 5.4], ride: 5, leg: 6, legW: 2.4, span: 6.5, head: 4, neck: [10, -1.4], muzzle: 2, ear: 'long', tail: 'brush', moss: true, gait: 1.1 },
  cobbe: { body: [10, 6], ride: 4, leg: 5, legW: 3.6, span: 7.5, head: 4.4, neck: [11, 0], muzzle: 2.2, ear: 'point', tail: 'stub', hump: 4.5, gait: 0.85 },
  tinka: { body: [6, 4], ride: 3.4, leg: 4, legW: 1.8, span: 4.2, head: 3.6, neck: [6.8, -2.2], muzzle: 1.6, ear: 'point', tail: 'brush', whisker: true, gait: 1.5 },
  middun: { body: [9, 4.6], ride: 3, leg: 3.6, legW: 2.2, span: 6.4, head: 3.4, neck: [10, 0.4], muzzle: 3.6, ear: 'round', tail: 'brush', gait: 1.1 },
  bura: { body: [12, 7], ride: 6.5, leg: 7.5, legW: 3.4, span: 9, head: 4.6, neck: [13.5, -2], muzzle: 2.6, ear: 'long', tail: 'tuft', gait: 0.75 },
  gorral: { body: [9, 5], ride: 6.5, leg: 7.5, legW: 2.2, span: 6.5, head: 3.8, neck: [10.5, -2.6], muzzle: 2.2, ear: 'point', horn: 'curl', tail: 'stub', shag: 2, gait: 1.25 },
  wadd: { body: [11, 4.8], ride: 2.8, leg: 3.4, legW: 2.4, span: 7.5, head: 3.8, neck: [11.5, 0.4], muzzle: 2.4, ear: 'round', tail: 'flat', gait: 1.2 },
  shaggan: { body: [14, 8.5], ride: 5.5, leg: 6.5, legW: 4.4, span: 10, head: 5.4, neck: [15, 0.5], muzzle: 2.6, horn: 'sweep', tail: 'tuft', hump: 6, shag: 5, gait: 0.6 },
  cudda: { body: [11.5, 7], ride: 5.5, leg: 6.5, legW: 3, span: 8, head: 4.4, neck: [12.5, -1], muzzle: 2.6, ear: 'long', horn: 'nub', tail: 'tuft', udder: true, gait: 0.8 },
  snout: { body: [9, 5], ride: 3.4, leg: 4, legW: 2.6, span: 6.4, head: 3.6, neck: [9.8, 0.2], muzzle: 4.2, ear: 'flop', tail: 'stub', whisker: true, gait: 1.05 },
};

/** A wildermon on four legs, built to the numbers above. Feet at (sx, sy). */
function drawBeastBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose, s: BeastShape): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom * (pose.facing < 0 ? -1 : 1), zoom);
  const [hide, pale] = pose.colors;
  const gait = s.gait ?? 1;
  const bob = pose.moving ? Math.abs(Math.sin(pose.phase * gait)) * (0.5 + s.ride * 0.08) : 0;
  const [bw, bh] = s.body;
  const by = -(s.ride + bh) - bob;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 1, bw * 1.25, bw * 0.48, 0, 0, TAU);
  ctx.fill();
  // Four legs, the near pair a shade darker so the far pair reads as behind.
  ctx.lineCap = 'round';
  ctx.lineWidth = s.legW;
  const hip = by + bh * 0.5;
  for (const [lx, ph, near] of [
    [-s.span, 0, 0],
    [s.span - 1.4, Math.PI, 0],
    [-s.span + 1.6, Math.PI, 1],
    [s.span, 0, 1],
  ] as Array<[number, number, number]>) {
    const step = pose.moving ? Math.sin(pose.phase * gait + ph) * (s.leg * 0.28) : 0;
    ctx.strokeStyle = near ? hide : shade(hide, -0.22);
    ctx.beginPath();
    ctx.moveTo(lx, hip);
    ctx.lineTo(lx + step, -0.8);
    ctx.stroke();
  }
  // Tail, before the barrel so it hangs off the back of it.
  const tail = s.tail;
  if (tail) {
    const tx = -bw * 0.92;
    if (tail === 'flat') {
      ctx.fillStyle = shade(hide, -0.12);
      ctx.beginPath();
      ctx.moveTo(tx, by - bh * 0.1);
      ctx.quadraticCurveTo(tx - bw * 0.9, by + bh * 0.4, tx - bw * 1.05, by + bh * 0.95);
      ctx.quadraticCurveTo(tx - bw * 0.45, by + bh * 0.75, tx, by + bh * 0.5);
      ctx.closePath();
      ctx.fill();
    } else if (tail === 'stub') {
      ctx.fillStyle = hide;
      ctx.beginPath();
      ctx.ellipse(tx - 1, by - bh * 0.2, 2.2, 1.8, 0.5, 0, TAU);
      ctx.fill();
    } else {
      ctx.strokeStyle = hide;
      ctx.lineWidth = tail === 'brush' ? 2.2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(tx, by - bh * 0.3);
      ctx.quadraticCurveTo(tx - bw * 0.35, by + bh * 0.2, tx - bw * 0.28, by + bh * 1.1);
      ctx.stroke();
      ctx.fillStyle = pale;
      ctx.beginPath();
      ctx.ellipse(tx - bw * 0.28, by + bh * 1.3, 1.3, 2.1, 0, 0, TAU);
      ctx.fill();
    }
  }
  // The barrel, with a pale belly under it and a shoulder over it.
  ctx.fillStyle = hide;
  ctx.beginPath();
  ctx.ellipse(0, by, bw, bh, 0, 0, TAU);
  ctx.fill();
  if (s.hump) {
    ctx.beginPath();
    ctx.ellipse(bw * 0.4, by - bh * 0.6, s.hump, s.hump * 0.66, -0.18, 0, TAU);
    ctx.fill();
  }
  if (s.shag) {
    // Hanging hair: the longer it is the less of the legs you see.
    ctx.fillStyle = shade(hide, 0.08);
    for (let i = -3; i <= 3; i++) {
      const hx = (i / 3) * bw * 0.85;
      ctx.beginPath();
      ctx.ellipse(hx, by + bh * 0.6 + s.shag * 0.4, bw * 0.17, s.shag, (i / 3) * 0.2, 0, TAU);
      ctx.fill();
    }
  }
  // The pale underside, kept low and short so it reads as a belly rather
  // than a patch painted on the flank.
  ctx.fillStyle = pale;
  ctx.beginPath();
  ctx.ellipse(-bw * 0.04, by + bh * 0.52, bw * 0.68, bh * 0.32, 0, 0, TAU);
  ctx.fill();
  if (s.udder) {
    // Fills as the milk comes in, and hangs slack once it has been taken.
    const full = 0.5 + (pose.fleece ?? 0) * 0.9;
    ctx.fillStyle = '#e8bfae';
    ctx.beginPath();
    ctx.ellipse(-bw * 0.2, by + bh * 0.95, 2.6 * full, 2.2 * full, 0, 0, TAU);
    ctx.fill();
  }
  if (s.moss) {
    ctx.fillStyle = '#6f8a4a';
    for (let i = -2; i <= 2; i++) {
      const mx = (i / 2) * bw * 0.7;
      ctx.beginPath();
      ctx.ellipse(mx, by - bh * 0.8 - Math.abs(i) * 0.3, bw * 0.2, 1.6, (i / 2) * 0.3, 0, TAU);
      ctx.fill();
    }
  }
  // Head, muzzle and whatever is on it.
  const hx = s.neck[0];
  const hy = by + s.neck[1];
  ctx.fillStyle = hide;
  ctx.beginPath();
  ctx.ellipse(hx, hy, s.head, s.head * 0.86, 0.1, 0, TAU);
  ctx.fill();
  if (s.pouch) {
    ctx.fillStyle = shade(pale, -0.08);
    ctx.beginPath();
    ctx.ellipse(hx - 0.5, hy + s.head * 0.75, s.pouch, s.pouch * 0.82, 0, 0, TAU);
    ctx.fill();
  }
  if (s.ear) {
    ctx.fillStyle = shade(hide, -0.1);
    const ex = hx - s.head * 0.45;
    const ey = hy - s.head * 0.8;
    if (s.ear === 'round') {
      ctx.beginPath();
      ctx.ellipse(ex, ey, s.head * 0.38, s.head * 0.36, 0, 0, TAU);
      ctx.fill();
    } else if (s.ear === 'point') {
      ctx.beginPath();
      ctx.moveTo(ex - s.head * 0.3, ey + s.head * 0.3);
      ctx.lineTo(ex + s.head * 0.12, ey - s.head * 0.75);
      ctx.lineTo(ex + s.head * 0.42, ey + s.head * 0.24);
      ctx.closePath();
      ctx.fill();
    } else if (s.ear === 'long') {
      ctx.beginPath();
      ctx.ellipse(ex, ey - s.head * 0.3, s.head * 0.2, s.head * 0.72, 0.2, 0, TAU);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.ellipse(ex, ey + s.head * 0.5, s.head * 0.24, s.head * 0.64, -0.35, 0, TAU);
      ctx.fill();
    }
  }
  if (s.muzzle) {
    ctx.fillStyle = shade(hide, 0.1);
    ctx.beginPath();
    ctx.ellipse(hx + s.head * 0.85, hy + s.head * 0.22, s.muzzle, s.muzzle * 0.62, 0.08, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#3a2c24';
    ctx.beginPath();
    ctx.ellipse(hx + s.head * 0.85 + s.muzzle * 0.8, hy + s.head * 0.22, 0.7, 0.6, 0, 0, TAU);
    ctx.fill();
  }
  if (s.whisker) {
    ctx.strokeStyle = 'rgba(240,235,225,0.75)';
    ctx.lineWidth = 0.45;
    for (const w of [-0.8, 0, 0.8]) {
      ctx.beginPath();
      ctx.moveTo(hx + s.head * 0.8, hy + s.head * 0.2);
      ctx.lineTo(hx + s.head * 0.8 + (s.muzzle ?? 2) * 2.1, hy + s.head * 0.2 + w * 2.4);
      ctx.stroke();
    }
  }
  if (s.horn) {
    ctx.strokeStyle = '#e6ddc8';
    ctx.lineWidth = s.horn === 'sweep' ? 2.2 : 1.6;
    ctx.lineCap = 'round';
    for (const up of [-1, 1]) {
      const ox = hx - s.head * 0.2;
      const oy = hy - s.head * 0.8 + up * 0.5;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      if (s.horn === 'curl') {
        ctx.bezierCurveTo(ox - s.head * 1.2, oy - s.head * 0.9, ox - s.head * 2, oy + s.head * 0.4, ox - s.head * 0.9, oy + s.head * 0.9 + up);
      } else if (s.horn === 'sweep') {
        ctx.quadraticCurveTo(hx + s.head * 1.1, oy - s.head * 0.7 + up * 0.8, hx + s.head * 2.2, oy + s.head * 0.2 + up * 1.6);
      } else {
        ctx.lineTo(ox - s.head * 0.15, oy - s.head * 0.5);
      }
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#1c1712';
  ctx.beginPath();
  ctx.arc(hx + s.head * 0.4, hy - s.head * 0.2, Math.max(0.7, s.head * 0.17), 0, TAU);
  ctx.fill();
  ctx.restore();
}

interface BirdShape {
  body: [number, number];
  ride: number;
  leg: number;
  neck: number;
  beak: 'shear' | 'hook' | 'stub';
  /** Feathers standing up off the crown. */
  crest?: number;
  /** Long feathers trailing behind, which is what a Quill is kept for. */
  plume?: number;
  eye?: number;
  gait?: number;
}

const BIRDS: Record<string, BirdShape> = {
  sedra: { body: [5.5, 4.6], ride: 9, leg: 10, neck: 9, beak: 'shear', gait: 1 },
  warda: { body: [6, 6], ride: 7.5, leg: 8.5, neck: 7, beak: 'hook', crest: 3, eye: 1.5, gait: 0.9 },
  quill: { body: [8, 7], ride: 4.5, leg: 5, neck: 4.5, beak: 'stub', plume: 9, gait: 1.3 },
};

/** A wildermon that stands on two legs, built to the numbers above. */
function drawBirdBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose, s: BirdShape): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom * (pose.facing < 0 ? -1 : 1), zoom);
  const [coat, front] = pose.colors;
  const gait = s.gait ?? 1;
  const bob = pose.moving ? Math.abs(Math.sin(pose.phase * gait)) * 1.1 : 0;
  const [bw, bh] = s.body;
  const by = -(s.ride + bh) - bob;
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.beginPath();
  ctx.ellipse(0, 1, bw * 1.1, bw * 0.44, 0, 0, TAU);
  ctx.fill();
  // Two legs with a backward knee, and a splayed foot on each.
  ctx.strokeStyle = '#c8975a';
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  for (const [lx, ph] of [
    [-1.6, 0],
    [1.6, Math.PI],
  ] as Array<[number, number]>) {
    const step = pose.moving ? Math.sin(pose.phase * gait + ph) * 2.2 : 0;
    ctx.beginPath();
    ctx.moveTo(lx, by + bh * 0.6);
    ctx.quadraticCurveTo(lx - 1.2, by + bh * 0.6 + s.leg * 0.55, lx + step, -0.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(lx + step - 1.8, -0.6);
    ctx.lineTo(lx + step + 2.2, -0.6);
    ctx.stroke();
  }
  if (s.plume) {
    // The long wing feathers, which grow back as fast as they are taken.
    const grown = 0.35 + (pose.fleece ?? 1) * 0.65;
    ctx.fillStyle = front;
    for (const a of [-0.35, -0.1, 0.15]) {
      ctx.beginPath();
      ctx.ellipse(-bw * 0.9 - s.plume * grown * 0.4, by + a * 5, s.plume * grown * 0.5, 1.5, a + 0.25, 0, TAU);
      ctx.fill();
    }
  }
  // Body: an egg standing a little back on itself.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(0, by, bw, bh, -0.1, 0, TAU);
  ctx.fill();
  ctx.fillStyle = front;
  ctx.beginPath();
  ctx.ellipse(bw * 0.24, by + bh * 0.12, bw * 0.62, bh * 0.72, -0.05, 0, TAU);
  ctx.fill();
  // A wing folded against the near side.
  ctx.fillStyle = shade(coat, -0.12);
  ctx.beginPath();
  ctx.ellipse(-bw * 0.12, by + bh * 0.05, bw * 0.6, bh * 0.5, -0.22, 0, TAU);
  ctx.fill();
  // Neck and head.
  const hy = by - bh - s.neck;
  ctx.strokeStyle = coat;
  ctx.lineWidth = Math.max(2, bw * 0.34);
  ctx.beginPath();
  ctx.moveTo(bw * 0.1, by - bh * 0.4);
  ctx.quadraticCurveTo(bw * 0.7, by - bh - s.neck * 0.55, bw * 0.5, hy + 1);
  ctx.stroke();
  const hx = bw * 0.5;
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(hx, hy, bw * 0.46, bw * 0.42, 0.1, 0, TAU);
  ctx.fill();
  if (s.crest) {
    ctx.strokeStyle = front;
    ctx.lineWidth = 1;
    for (const a of [-0.5, -0.15, 0.2]) {
      ctx.beginPath();
      ctx.moveTo(hx - 1, hy - bw * 0.3);
      ctx.lineTo(hx - 1 - Math.sin(a) * s.crest, hy - bw * 0.3 - Math.cos(a) * s.crest);
      ctx.stroke();
    }
  }
  // The bill, which is the whole of what each of them is for.
  ctx.fillStyle = '#d8a54a';
  const bx = hx + bw * 0.4;
  if (s.beak === 'shear') {
    ctx.beginPath();
    ctx.moveTo(bx, hy - 1.2);
    ctx.lineTo(bx + 11, hy - 0.2);
    ctx.lineTo(bx, hy + 1.4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,60,20,0.5)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(bx, hy + 0.2);
    ctx.lineTo(bx + 10.4, hy - 0.1);
    ctx.stroke();
  } else if (s.beak === 'hook') {
    ctx.beginPath();
    ctx.moveTo(bx - 0.6, hy - 1.6);
    ctx.quadraticCurveTo(bx + 5.4, hy - 1.4, bx + 4.6, hy + 2.4);
    ctx.quadraticCurveTo(bx + 2.6, hy + 0.6, bx - 0.6, hy + 1.2);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(bx - 0.4, hy - 1.4);
    ctx.lineTo(bx + 4.4, hy + 0.2);
    ctx.lineTo(bx - 0.4, hy + 1.6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#181410';
  ctx.beginPath();
  ctx.arc(hx + bw * 0.16, hy - bw * 0.1, s.eye ?? 0.95, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.arc(hx + bw * 0.22, hy - bw * 0.2, (s.eye ?? 0.95) * 0.34, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A Vesp: not one creature so much as a cloud of them, all going at once. */
function drawVespBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  const [band, dark] = pose.colors;
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 8, 3.2, 0, 0, TAU);
  ctx.fill();
  const churn = pose.moving ? 1.6 : 0.7;
  for (let i = 0; i < 14; i++) {
    // Each of them keeps its own orbit, so the swarm boils rather than spins.
    const a = (i / 14) * TAU + pose.phase * churn * (0.6 + (i % 4) * 0.22);
    const r = 4 + (i % 5) * 2.1;
    const bx = Math.cos(a) * r;
    const byy = -11 + Math.sin(a * 1.4 + i) * (r * 0.6);
    ctx.fillStyle = i % 3 ? band : dark;
    ctx.beginPath();
    ctx.ellipse(bx, byy, 1.7, 1.25, a, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.ellipse(bx - 0.5, byy - 1.2, 1.5, 0.6, a * 0.4, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** A Lume: a cold light drifting a foot off the ground, and very little else. */
function drawLumeBody(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom, zoom);
  const [pale, bright] = pose.colors;
  const drift = Math.sin(pose.phase * 0.5) * 1.6;
  const cy = -11 + drift;
  const glow = ctx.createRadialGradient(0, cy, 0.5, 0, cy, 13);
  glow.addColorStop(0, bright);
  glow.addColorStop(0.35, `${pale}cc`);
  glow.addColorStop(1, 'rgba(230,240,220,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(0, cy, 13, 12, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = bright;
  ctx.beginPath();
  ctx.ellipse(0, cy, 4.4, 4.8, 0, 0, TAU);
  ctx.fill();
  // A few slow trailing motes that say which way it is drifting.
  ctx.fillStyle = `${pale}aa`;
  for (let i = 0; i < 4; i++) {
    const a = pose.phase * 0.3 + (i / 4) * TAU;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * 7, cy + Math.sin(a) * 5.5, 1.1, 1.1, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawCreatureOverlay(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: CreaturePose): void {
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
  /** Sitting on a seat with the reins in both hands rather than walking. */
  driving?: boolean;
  /** The colour of what is on the chest and the legs, when either has been dyed. */
  tunic?: string;
  trousers?: string;
}

const SKIN = '#e6c29a';
const HAIR = '#5a3a1e';
const TUNIC = '#8d6b3e';
const TROUSERS = '#4b3b2c';
const BELT = '#33241a';

/** Draws the character with its feet at (sx, sy). */
/**
 * The same figure, sat down: knees forward over the footboard, both hands out
 * on the reins, and no shadow, because what is under it is the cart.
 */
function drawDriver(ctx: CanvasRenderingContext2D, pose: PlayerPose): void {
  const tunic = pose.tunic ?? TUNIC;
  const trousers = pose.trousers ?? TROUSERS;
  const jolt = pose.moving ? Math.sin(pose.phase * 0.9) * 0.6 : 0;
  // thighs forward, shins down
  ctx.fillStyle = trousers;
  ctx.fillRect(-1, -8 + jolt, 8, 3);
  ctx.fillRect(5.5, -8 + jolt, 3, 7);
  // body
  ctx.fillStyle = tunic;
  ctx.fillRect(-4.5, -20 + jolt, 9, 13);
  ctx.fillStyle = BELT;
  ctx.fillRect(-4.5, -9.5 + jolt, 9, 1.6);
  // arms out to the reins
  ctx.fillStyle = tunic;
  ctx.fillRect(2, -18 + jolt, 6, 2.4);
  ctx.fillStyle = SKIN;
  ctx.fillRect(7.5, -18.2 + jolt, 2.4, 2.4);
  // reins, running off to the team
  ctx.strokeStyle = '#4a3524';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(9, -17 + jolt);
  ctx.lineTo(15, -12 + jolt);
  ctx.stroke();
  // head
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(0, -24.5 + jolt, 4.6, 0, TAU);
  ctx.fill();
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.arc(0, -25.5 + jolt, 4.7, Math.PI * 1.05, Math.PI * 1.95);
  ctx.lineTo(3.8, -24.5 + jolt);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2a1a10';
  ctx.fillRect(1.6, -25.5 + jolt, 1.2, 1.2);
}

export function drawPlayer(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, pose: PlayerPose): void {
  const tunic = pose.tunic ?? TUNIC;
  const trousers = pose.trousers ?? TROUSERS;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(zoom * (pose.facing < 0 ? -1 : 1), zoom);
  if (pose.swimming) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 4.5, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = tunic;
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
  if (pose.driving) {
    drawDriver(ctx, pose);
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
  ctx.fillStyle = trousers;
  ctx.fillRect(-3.5, -12 + swing * 2, 3, 12 - swing * 2);
  ctx.fillRect(0.5, -12 - swing * 2, 3, 12 + swing * 2);
  // body
  ctx.fillStyle = tunic;
  ctx.fillRect(-4.5, -26 - bob, 9, 14);
  ctx.fillStyle = BELT;
  ctx.fillRect(-4.5, -14.5 - bob, 9, 1.6);
  // arms
  const armSwing = pose.working ? Math.sin(pose.phase * 2.2) * 5 : swing * 3;
  ctx.fillStyle = tunic;
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
