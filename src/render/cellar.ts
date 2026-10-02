import type { Camera } from '../engine/camera';
import { CELLAR_DEPTH, FLOOR_DEEP, MATERIAL_BY_ID, type CellarTile, type Side } from '../game/building';
import { cellarSoil } from '../game/cellar';
import type { Game } from '../game/game';
import { bedrockAt } from '../world/ore';
import { ROCK_VARIANTS, TILE_DEFS, TileType } from '../world/tiles';
import type { World } from '../world/world';
import { depthOf, type View } from './view';

/**
 * A cellar, drawn: the room dug out under a ground floor, and the hole a
 * flight or a ladder goes down through.
 *
 * Seen from down there -- the view is the cellar's whenever you are in one, or
 * whenever the storey control is put on it -- everything over the ground
 * floor is taken off, and the building over the cellar with it, and the room
 * is drawn whole over the country round it, which is laid back under a veil:
 * the floor at the bottom of the dig, the sides of the dig where it meets the
 * ground (soil over rock, banded where the one gives onto the other, the
 * marks of the shovel and the pick in them, a vein's ore where it ran through
 * the rock), the timbers the ground floor rests on along the head of every
 * side, and the near sides cut down to a kerb so the room can be seen into.
 * It is dark down there at every hour: the room is laid under a dark of its
 * own and lit only by what burns in it and by the daylight down the way in.
 *
 * Seen from up top nothing of it shows but the way in: the hole in the ground
 * floor, the far sides of it going down out of the light, and the flight or
 * the ladder going down into the dark.
 *
 * Everything here is worked out from the ground: the depth from what has
 * been dug, the soil from the corners' soil, the stone from the rock under
 * the tile across the side -- so a cellar dug through a vein shows the vein.
 */

type RGB = readonly [number, number, number];

/** The pieces of the canvas a cellar is drawn with: the renderer's own, handed over. */
export interface CellarCanvas {
  ctx: CanvasRenderingContext2D;
  cam: Camera;
  zoom: number;
  /**
   * How a vertical face running along (ux, uy) is lit: the renderer's light
   * from the south-east, as every wall has it -- by which way the face runs,
   * (1, 0) or (0, 1), and not by which of its two sides is seen.
   */
  light: (ux: number, uy: number) => number;
}

/** The country round a cellar, laid back while you are down in one: dark enough that the room is what you see. */
export const CELLAR_VEIL = 'rgba(16, 13, 19, 0.68)';
/** How dark a cellar is with nothing alight in it, at every hour: a shade over the night's own wash. */
export const CELLAR_DARK = 0.86;
/**
 * How much of that dark a light down there takes away, out across its reach:
 * pairs of the share of its reach and the share of its strength. All of it at
 * the flame, under two thirds a third of the way out, a quarter at three
 * fifths, and none at the edge.
 */
export const CELLAR_FALL: ReadonlyArray<readonly [number, number]> = [[0, 1], [0.3, 0.62], [0.6, 0.26], [1, 0]];
/** The colour of that dark: earth, not sky. */
export const CELLAR_DARK_INK = '9, 7, 12';
/** How far up off the floor the near sides of the dig are cut down to, in height units. */
export const KERB = 3;
/** And how far down under the floor the cut through the ground in front of it shows: the ground the floor is cut in. */
export const UNDER = 5;
/** Under this zoom a cellar is flat colour: no marks, no stones, no roots. */
export const CELLAR_DETAIL = 0.6;

/** Soil in the side of a hole: the dirt's own colour, a shade under, since it is damp in there. */
const SOIL: RGB = shade(TILE_DEFS[TileType.Dirt].color, 0.84);
/** The top of it, where the roots are: darker again. */
const TOPSOIL: RGB = shade(TILE_DEFS[TileType.Dirt].color, 0.66);
/** The dark lines a cellar is drawn with: its edges, its strata, its marks. */
const INK = 'rgba(44, 34, 40, 0.9)';
const MARK = 'rgba(52, 42, 54, 0.3)';
const CHIP = 'rgba(255, 248, 236, 0.22)';
/** The timbers a ground floor rests on, in the plank's palette. */
const TIMBER = MATERIAL_BY_ID.get('plank')?.color ?? [178, 138, 84];
const TIMBER_END = MATERIAL_BY_ID.get('plank')?.trim ?? [112, 82, 46];
/** How deep the timbers are, under the ground floor's boards. */
const BEARER = FLOOR_DEEP + 1.4;

function shade(c: RGB, k: number): RGB {
  return [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)];
}

/**
 * Stone as a cellar shows it, in the dark and the damp: a shade under the
 * same stone in the daylight and warmer, the colour of the light down there
 * in it -- so a cellar cut through slate, marble or sandstone still shows
 * which, and none of them is the pale grey of a face in the sun.
 */
function underground(c: RGB): RGB {
  return [Math.round(c[0] * 0.78 + 12), Math.round(c[1] * 0.7 + 8), Math.round(c[2] * 0.62 + 4)];
}
const rgb = (c: RGB, k = 1, a = 1): string =>
  `rgba(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0},${a})`;

/** Four whole numbers to one in [0, 1), the same every time: where a mark falls, by where it is. */
function hash(a: number, b: number, c: number, d: number): number {
  let k = (a * 374761393 + b * 668265263 + c * 1442695041 + d * 2246822519) | 0;
  k = Math.imul(k ^ (k >>> 13), 1274126177);
  k = Math.imul(k ^ (k >>> 16), 2654435761);
  return ((k ^ (k >>> 15)) >>> 0) / 4294967296;
}

/** Which way is out through each side of a tile, in the world. */
export const OUT: Record<Side, [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
/** The two corners a side of a tile runs between, in the world, clockwise. */
export const ENDS: Record<Side, [[number, number], [number, number]]> = {
  n: [[0, 0], [1, 0]], e: [[1, 0], [1, 1]], s: [[1, 1], [0, 1]], w: [[0, 1], [0, 0]],
};
const SIDES: Side[] = ['n', 'e', 's', 'w'];
const OPPOSITE: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };

/** The ground floor over a tile: a building stands level, so its first corner. */
const groundFloor = (w: World, x: number, y: number): number => w.getHeight(x, y);

/** How far down a tile's floor is: the ground floor over it less what has been dug out under it. */
export function cellarFloorHeight(g: Game, x: number, y: number): number {
  return groundFloor(g.world, x, y) - (g.buildings.cellar(x, y)?.dug ?? 0);
}

/** The two sides of a tile the camera looks at the inside of, the far ones, and the two it looks across. */
export function sidesOf(V: View): { back: readonly Side[]; front: Side[] } {
  const back = V.back as readonly Side[];
  return { back, front: SIDES.filter((s) => !back.includes(s)) };
}

/**
 * Every tile of every cellar, in the order they are drawn: a line of the
 * ground at a time, back to front, as the ground is. Into `out`, which is the
 * renderer's to keep from frame to frame.
 */
export function cellarOrder(g: Game, V: View, out: CellarTile[]): CellarTile[] {
  out.length = 0;
  for (const c of g.buildings.cellars.values()) out.push(c);
  out.sort((a, b) => depthOf(V, a.x, a.y) - depthOf(V, b.x, b.y) || a.x - b.x || a.y - b.y);
  return out;
}

/** A side of the dig: a face of the ground standing between two corners. */
export interface EarthFace {
  /** Its two ends along the ground, in the world. */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Its foot and its head, at each end. */
  lo0: number;
  lo1: number;
  hi0: number;
  hi1: number;
  /** The top of the rock at each end: everything over it is soil. */
  rock0: number;
  rock1: number;
  /** The way it runs, (1, 0) or (0, 1), for its light. */
  ux: number;
  uy: number;
  /** The stone it is cut through, and a vein's ore in it, if one runs there -- a metal's catching the light. */
  stone: RGB;
  ore: RGB | null;
  metal?: boolean;
  /** A number of its own, so no two faces are marked alike. */
  seed: number;
  /** How much of the light reaches it: 1 in the open, less down a hole. */
  dim: number;
  /** Whether the ground floor's timbers rest along its head. */
  bearer: boolean;
  /** Bands and timbers only, without the marks in them: for a side seen down a hole, in its dark. */
  plain?: boolean;
}

/**
 * The stone under a tile, and the ore in it if it is a vein: the colour a
 * face cut through it shows. A seam shows as its metal in the plain stone.
 */
export function stoneOf(w: World, x: number, y: number): { stone: RGB; ore: RGB | null; metal: boolean } {
  const r = bedrockAt(w, x, y);
  const colour = ROCK_VARIANTS[r.kind].color;
  return r.ore ? { stone: underground(ROCK_VARIANTS[0].color), ore: colour, metal: r.yields.endsWith('_ore') }
    : { stone: underground(colour), ore: null, metal: false };
}

/**
 * A face of earth: soil over rock, as a dig through that ground shows it.
 *
 * Two bands, the rock and the soil over it, the line where they meet drawn
 * in; the top of the soil darker, where it is full of roots. Close enough to
 * see them, the pick's marks in the rock and its bedding, a vein's ore in a
 * band along it, stones in the soil, and roots hanging from the top; and the
 * timbers the ground floor rests on along its head.
 */
export function earthFace(c: CellarCanvas, f: EarthFace): void {
  const { ctx, cam, zoom } = c;
  const P = (t: number, h0: number, h1: number): [number, number] => {
    const wx = f.ax + (f.bx - f.ax) * t;
    const wy = f.ay + (f.by - f.ay) * t;
    return [cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, h0 + (h1 - h0) * t)];
  };
  // Seen edge on it is nothing: a face stands straight up, so it is edge on when its foot runs straight up the screen.
  const a = P(0, f.lo0, f.lo1), b = P(1, f.lo0, f.lo1);
  if (Math.abs(b[0] - a[0]) < 0.5) return;
  const quad = (l0: number, l1: number, h0: number, h1: number): void => {
    const p = [P(0, l0, l1), P(1, l0, l1), P(1, h0, h1), P(0, h0, h1)];
    ctx.beginPath();
    ctx.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(p[i][0], p[i][1]);
    ctx.closePath();
  };
  const lit = c.light(f.ux, f.uy) * f.dim;
  const r0 = Math.max(f.lo0, Math.min(f.hi0, f.rock0)), r1 = Math.max(f.lo1, Math.min(f.hi1, f.rock1));
  const top0 = Math.max(r0, f.hi0 - 2.5), top1 = Math.max(r1, f.hi1 - 2.5);
  // The rock, the soil over it, and the dark top of the soil.
  // Each band stroked in its own colour as well as filled, so a face meets the next one round the room without a hairline.
  ctx.lineWidth = 1;
  if (r0 > f.lo0 || r1 > f.lo1) {
    quad(f.lo0, f.lo1, r0, r1);
    ctx.fillStyle = rgb(f.stone, lit * 0.94);
    ctx.fill();
    ctx.strokeStyle = ctx.fillStyle;
    ctx.stroke();
  }
  if (f.hi0 > r0 || f.hi1 > r1) {
    quad(r0, r1, f.hi0, f.hi1);
    ctx.fillStyle = rgb(SOIL, lit);
    ctx.fill();
    ctx.strokeStyle = ctx.fillStyle;
    ctx.stroke();
    quad(top0, top1, f.hi0, f.hi1);
    ctx.fillStyle = rgb(TOPSOIL, lit);
    ctx.fill();
  }
  const detail = zoom >= CELLAR_DETAIL && !f.plain;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) / (40 * zoom);
  if (detail) {
    ctx.save();
    quad(f.lo0, f.lo1, f.hi0, f.hi1);
    ctx.clip();
    ctx.lineCap = 'round';
    const lw = Math.max(0.7, 0.9 * zoom);
    // The rock: its bedding, a line or two along it, and the pick's bites, each with a chipped edge catching the light.
    const rockHi = Math.max(r0, r1), rockLo = Math.min(f.lo0, f.lo1);
    if (rockHi - rockLo > 2) {
      ctx.strokeStyle = MARK;
      ctx.lineWidth = lw;
      for (let k = 0; k < 2; k++) {
        const h = rockLo + (rockHi - rockLo) * (0.32 + 0.36 * k + 0.12 * (hash(f.seed, k, 1, 0) - 0.5));
        const tilt = (hash(f.seed, k, 2, 0) - 0.5) * 3;
        const s = P(0, h - tilt, h + tilt), e = P(1, h - tilt, h + tilt);
        ctx.beginPath();
        ctx.moveTo(s[0], s[1]);
        ctx.quadraticCurveTo((s[0] + e[0]) / 2, (s[1] + e[1]) / 2 + (hash(f.seed, k, 3, 0) - 0.5) * 4 * zoom, e[0], e[1]);
        ctx.stroke();
      }
      // A vein runs along its bedding: a band of the ore set into the rock.
      if (f.ore) {
        /*
         * As a seam is drawn in a face of rock up top (`seam.ts`): lobes of
         * the metal laid well inside one another's width, so they fill as one
         * ribbon with a lumpy edge and a darker rim, and not a row of stones.
         * Up in the face, half way up the rock or a little over, at one height
         * along a run of faces, so the band runs on round a corner: by the
         * ground, a few tiles at a time.
         */
        const h = rockLo + (rockHi - rockLo) * (0.46 + 0.2 * hash(Math.floor(f.ax / 3), Math.floor(f.ay / 3), 77, 0));
        const lobes: Array<[number, number, number]> = [];
        for (let t = -0.03; t < 1.03; t += 0.04) {
          const k = Math.round(t * 1000);
          const lift = 1.2 * (hash(f.seed, k, 5, 0) - 0.5);
          const [px, py] = P(t + 0.01 * (hash(f.seed, k, 4, 0) - 0.5), h + lift, h + lift);
          // It pinches out and picks up again, a lobe in sixteen.
          if (hash(f.seed, k, 3, 0) < 0.06) continue;
          lobes.push([px, py, (3.4 + 1.8 * hash(f.seed, k, 6, 0)) * zoom]);
        }
        const lay = (grow: number): void => {
          ctx.beginPath();
          for (const [px, py, r] of lobes) {
            ctx.moveTo(px + r + grow, py);
            ctx.ellipse(px, py, r + grow, (r + grow) * 0.5, 0, 0, Math.PI * 2);
          }
        };
        lay(0.9 * zoom);
        ctx.fillStyle = rgb(f.ore, lit * 0.62);
        ctx.fill();
        lay(0);
        ctx.fillStyle = rgb(f.ore, lit);
        ctx.fill();
        ctx.fillStyle = rgb(f.ore, lit * 1.25, 0.85);
        for (const [px, py, r] of lobes) {
          ctx.beginPath();
          ctx.ellipse(px - r * 0.3, py - r * 0.18, r * 0.3, r * 0.12, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // A metal catches the light where the pick broke it: a glint every few lobes along the band, as a lump of it has.
        if (f.metal && zoom >= 1) {
          ctx.strokeStyle = 'rgba(255, 252, 238, 0.95)';
          ctx.lineWidth = Math.max(0.7, 0.7 * zoom);
          ctx.lineCap = 'round';
          lobes.forEach(([px, py, r], i) => {
            if (hash(f.seed, i, 9, 0) > 0.16) return;
            const gx = px + r * (0.5 * hash(f.seed, i, 10, 0) - 0.25), gy = py - r * 0.2, k = r * (0.45 + 0.3 * hash(f.seed, i, 23, 0));
            ctx.beginPath();
            ctx.moveTo(gx - k, gy);
            ctx.lineTo(gx + k, gy);
            ctx.moveTo(gx, gy - k * 0.75);
            ctx.lineTo(gx, gy + k * 0.75);
            ctx.stroke();
            ctx.fillStyle = 'rgba(255, 255, 248, 1)';
            ctx.beginPath();
            ctx.arc(gx, gy, Math.max(0.6, 0.5 * zoom), 0, Math.PI * 2);
            ctx.fill();
          });
        }
      }
      // The flats the pick left, each a shade off the next, so the face is hewn and not poured.
      const flats = Math.round(5 * len * Math.max(0.3, (rockHi - rockLo) / CELLAR_DEPTH));
      for (let i = 0; i < flats; i++) {
        const t = hash(f.seed, i, 18, 0), w = 0.08 + 0.1 * hash(f.seed, i, 19, 0);
        const h = rockLo + 1 + (rockHi - rockLo - 4) * hash(f.seed, i, 20, 0), dh = 2.5 + 3 * hash(f.seed, i, 21, 0);
        const a = P(t, h, h), b = P(t + w, h + dh * 0.3, h + dh * 0.3), e = P(t + w * 0.6, h + dh, h + dh), q = P(t - w * 0.2, h + dh * 0.7, h + dh * 0.7);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(e[0], e[1]);
        ctx.lineTo(q[0], q[1]);
        ctx.closePath();
        ctx.fillStyle = hash(f.seed, i, 22, 0) < 0.5 ? 'rgba(40, 32, 48, 0.07)' : 'rgba(255, 250, 240, 0.08)';
        ctx.fill();
      }
      const bites = Math.round(9 * len * Math.max(0.3, (rockHi - rockLo) / CELLAR_DEPTH));
      for (let i = 0; i < bites; i++) {
        const t = hash(f.seed, i, 7, 0);
        const h = rockLo + 1.5 + (rockHi - rockLo - 3) * hash(f.seed, i, 8, 0);
        const [px, py] = P(t, h, h);
        const dx = 3.4 * zoom, dy = 2.6 * zoom;
        ctx.strokeStyle = MARK;
        ctx.lineWidth = lw * 1.3;
        ctx.beginPath();
        ctx.moveTo(px - dx / 2, py - dy / 2);
        ctx.lineTo(px + dx / 2, py + dy / 2);
        ctx.stroke();
        ctx.strokeStyle = CHIP;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(px - dx / 2 + zoom, py - dy / 2 - zoom * 0.8);
        ctx.lineTo(px + dx / 2 + zoom, py + dy / 2 - zoom * 0.8);
        ctx.stroke();
      }
    }
    // The soil: stones in it, and the shovel's cuts down it.
    const soilLo = Math.min(r0, r1), soilHi = Math.max(f.hi0, f.hi1);
    if (soilHi - soilLo > 1.5) {
      const stones = Math.round(7 * len * Math.min(1, (soilHi - soilLo) / 8));
      for (let i = 0; i < stones; i++) {
        const t = hash(f.seed, i, 11, 0);
        const h = soilLo + 0.8 + (soilHi - soilLo - 3) * hash(f.seed, i, 12, 0);
        const [px, py] = P(t, h, h);
        const rx = (1.1 + 1.2 * hash(f.seed, i, 13, 0)) * zoom;
        ctx.fillStyle = rgb(f.stone, lit * 1.08);
        ctx.beginPath();
        ctx.ellipse(px, py, rx, rx * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = MARK;
        ctx.lineWidth = lw * 0.8;
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(70, 52, 46, 0.18)';
      ctx.lineWidth = lw;
      const cuts = Math.round(5 * len);
      for (let i = 0; i < cuts; i++) {
        const t = (i + 0.5 + 0.4 * (hash(f.seed, i, 14, 0) - 0.5)) / Math.max(1, cuts);
        const [sx, sy] = P(t, f.hi0 - 2.2, f.hi1 - 2.2);
        const [ex, ey] = P(t, soilLo + 0.6, soilLo + 0.6);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
      // And the roots, hanging out of the top of it.
      if (zoom >= 1) {
        ctx.strokeStyle = rgb([92, 68, 54], lit, 0.7);
        ctx.lineWidth = Math.max(0.7, 0.75 * zoom);
        const roots = Math.round(4 * len);
        for (let i = 0; i < roots; i++) {
          const t = hash(f.seed, i, 15, 0);
          const [sx, sy] = P(t, f.hi0 - 0.6, f.hi1 - 0.6);
          const drop = (2.5 + 3.5 * hash(f.seed, i, 16, 0)) * 2.25 * zoom;
          const sway = (hash(f.seed, i, 17, 0) - 0.5) * 6 * zoom;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.quadraticCurveTo(sx + sway, sy + drop * 0.5, sx + sway * 0.4, sy + drop);
          ctx.stroke();
        }
      }
    }
    // The foot of the face in the shade of the floor's edge.
    if (Math.min(f.hi0, f.hi1) - Math.max(f.lo0, f.lo1) > 4) {
      for (let k = 0; k < 3; k++) {
        quad(f.lo0 + k * 0.9, f.lo1 + k * 0.9, f.lo0 + (k + 1) * 0.9, f.lo1 + (k + 1) * 0.9);
        ctx.fillStyle = `rgba(30, 22, 26, ${(0.16 - 0.05 * k).toFixed(2)})`;
        ctx.fill();
      }
    }
    // The line where the soil gives onto the rock.
    if (r0 < f.hi0 && r1 < f.hi1 && (r0 > f.lo0 || r1 > f.lo1)) {
      const s = P(0, r0, r1), e = P(1, r0, r1);
      ctx.strokeStyle = 'rgba(58, 44, 46, 0.42)';
      ctx.lineWidth = Math.max(0.8, 1.1 * zoom);
      ctx.beginPath();
      ctx.moveTo(s[0], s[1]);
      ctx.lineTo(e[0], e[1]);
      ctx.stroke();
    }
    ctx.restore();
  }
  // The timbers the ground floor rests on, along its head: a bearer, and the end of a joist every metre.
  if (f.bearer) {
    quad(f.hi0 - BEARER, f.hi1 - BEARER, f.hi0, f.hi1);
    ctx.fillStyle = rgb(TIMBER, lit * 0.92);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.7, 0.8 * zoom);
    ctx.stroke();
    if (zoom >= CELLAR_DETAIL) {
      const n = Math.max(1, Math.round(4 * Math.hypot(f.bx - f.ax, f.by - f.ay)));
      for (let i = 0; i < n; i++) {
        const t0 = (i + 0.3) / n, t1 = (i + 0.7) / n;
        const p = [P(t0, f.hi0 - BEARER + 0.5, f.hi1 - BEARER + 0.5), P(t1, f.hi0 - BEARER + 0.5, f.hi1 - BEARER + 0.5)];
        const q = [P(t1, f.hi0 - 0.4, f.hi1 - 0.4), P(t0, f.hi0 - 0.4, f.hi1 - 0.4)];
        ctx.beginPath();
        ctx.moveTo(p[0][0], p[0][1]);
        ctx.lineTo(p[1][0], p[1][1]);
        ctx.lineTo(q[0][0], q[0][1]);
        ctx.lineTo(q[1][0], q[1][1]);
        ctx.closePath();
        ctx.fillStyle = rgb(TIMBER_END, lit);
        ctx.fill();
      }
    }
  }
  // Its outline: the head, where it meets the ground floor, and its ends.
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(0.8, 1 * zoom);
  const h0 = P(0, f.hi0, f.hi1), h1 = P(1, f.hi0, f.hi1);
  ctx.beginPath();
  ctx.moveTo(h0[0], h0[1]);
  ctx.lineTo(h1[0], h1[1]);
  ctx.stroke();
}

/** What a tile's floor is: the rock, where the dig went through the soil into it, and the soil where it did not. */
export function floorStone(g: Game, x: number, y: number): { colour: RGB; rock: boolean } {
  const dug = g.buildings.cellar(x, y)?.dug ?? 0;
  if (dug > cellarSoil(g.world, x, y)) {
    const { stone } = stoneOf(g.world, x, y);
    return { colour: shade(stone, 0.86), rock: true };
  }
  return { colour: shade(SOIL, 0.88), rock: false };
}

/**
 * The floor of a cellar tile, at height `h`: the rock or the soil the dig
 * stopped in, worn smooth where it is walked and marked where it was cut,
 * and in the shade along every side of it that is the ground, deepest in
 * the corners.
 */
export function cellarFloor(c: CellarCanvas, g: Game, x: number, y: number, h: number, against: readonly Side[], plain = false): void {
  const { ctx, cam, zoom } = c;
  const P = (u: number, v: number): [number, number] => [cam.worldToScreenX(x + u, y + v), cam.worldToScreenY(x + u, y + v, h)];
  const quad = (pts: Array<[number, number]>): void => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  };
  const { colour, rock } = floorStone(g, x, y);
  const corners = [P(0, 0), P(1, 0), P(1, 1), P(0, 1)];
  quad(corners);
  ctx.fillStyle = rgb(colour, 1);
  ctx.fill();
  // Half a pixel of its own colour round it, so the floor of the next tile meets it without a hairline.
  ctx.strokeStyle = rgb(colour, 1);
  ctx.lineWidth = 1;
  ctx.stroke();
  if (zoom >= CELLAR_DETAIL && !plain) {
    ctx.save();
    quad(corners);
    ctx.clip();
    ctx.lineCap = 'round';
    const lw = Math.max(0.7, 0.9 * zoom);
    const n = rock ? 7 : 10;
    for (let i = 0; i < n; i++) {
      const u = hash(x, y, i, 21), v = hash(x, y, i, 22);
      const [px, py] = P(u, v);
      if (rock) {
        // The pick's last bites, taken level.
        const dx = 3.2 * zoom, dy = 1.2 * zoom * (hash(x, y, i, 23) < 0.5 ? 1 : -1);
        ctx.strokeStyle = MARK;
        ctx.lineWidth = lw * 1.2;
        ctx.beginPath();
        ctx.moveTo(px - dx / 2, py - dy / 2);
        ctx.lineTo(px + dx / 2, py + dy / 2);
        ctx.stroke();
        ctx.strokeStyle = CHIP;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(px - dx / 2, py - dy / 2 - zoom);
        ctx.lineTo(px + dx / 2, py + dy / 2 - zoom);
        ctx.stroke();
      } else {
        // Grit, and a stone or two the shovel left.
        ctx.fillStyle = i % 3 ? 'rgba(70, 52, 46, 0.22)' : 'rgba(236, 226, 214, 0.35)';
        ctx.beginPath();
        ctx.ellipse(px, py, (0.9 + hash(x, y, i, 24)) * zoom, 0.6 * zoom, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (rock) {
      // A crack or two in the bed of the rock.
      ctx.strokeStyle = 'rgba(52, 42, 54, 0.22)';
      ctx.lineWidth = lw;
      const k = hash(x, y, 0, 25);
      if (k < 0.6) {
        const a = P(hash(x, y, 1, 25), 0), b = P(hash(x, y, 2, 25) * 0.6 + 0.2, 0.5), e = P(hash(x, y, 3, 25), 1);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(e[0], e[1]);
        ctx.stroke();
      }
    }
    // The shade along every side that is the ground, laid in three steps: deepest at the foot of the face.
    for (const s of against) {
      const [[u0, v0], [u1, v1]] = ENDS[s];
      const [ox, oy] = OUT[s];
      for (let k = 0; k < 3; k++) {
        const d0 = 0.04 * k, d1 = 0.04 * (k + 1);
        quad([
          P(u0 - ox * d0, v0 - oy * d0), P(u1 - ox * d0, v1 - oy * d0),
          P(u1 - ox * d1, v1 - oy * d1), P(u0 - ox * d1, v0 - oy * d1),
        ]);
        ctx.fillStyle = `rgba(30, 22, 26, ${(0.2 - 0.06 * k).toFixed(2)})`;
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

/**
 * A side of the dig cut down so the room can be seen into: the ground on
 * that side taken off at `top`, a hand over the floor, and the cut through it
 * showing -- soil over rock, as the dig's own sides show it -- with the flat
 * of the cut across its top. On a near side (`near`), the cut is the face
 * looking at you from the far side of the kerb, and runs down to `bottom`, the
 * floor of the dig at its deepest, so a tile only half dug stands on a cut of
 * solid ground and not on nothing; on a far side, where the ground has a room
 * behind it as well as in front, it is the side of the dig itself, cut down.
 */
export function cutFace(c: CellarCanvas, g: Game, x: number, y: number, side: Side, bottom: number, top: number, near: boolean): void {
  if (top <= bottom + 0.05) return;
  const { ctx, cam, zoom } = c;
  const [[u0, v0], [u1, v1]] = ENDS[side];
  // Edge on, as a wall is, it is nothing: not even the flat of the cut.
  if (Math.abs(cam.worldToScreenX(x + u1, y + v1) - cam.worldToScreenX(x + u0, y + v0)) < 0.5) return;
  const [ox, oy] = OUT[side];
  const D = 0.08;
  const d = near ? D : 0;
  const face = faceOn(g, x, y, side, bottom, near ? 0.88 : 0.96, false);
  face.ax += ox * d;
  face.bx += ox * d;
  face.ay += oy * d;
  face.by += oy * d;
  face.hi0 = top;
  face.hi1 = top;
  earthFace(c, face);
  const P = (u: number, v: number): [number, number] => [cam.worldToScreenX(x + u, y + v), cam.worldToScreenY(x + u, y + v, top)];
  const cap = [P(u0, v0), P(u1, v1), P(u1 + ox * D, v1 + oy * D), P(u0 + ox * D, v0 + oy * D)];
  ctx.beginPath();
  ctx.moveTo(cap[0][0], cap[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(cap[i][0], cap[i][1]);
  ctx.closePath();
  ctx.fillStyle = rgb(top > Math.min(face.rock0, face.rock1) ? SOIL : face.stone, 1.06);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(0.8, 1 * zoom);
  ctx.stroke();
}

/**
 * The earth between this cellar and the next building's, seen end on.
 *
 * Square on, the side they share runs straight away from the camera and its
 * faces are edge on, which draw as nothing: the two rooms read as one long
 * one with a change of shade across it. So it is drawn as the cut edge of the
 * ground standing there -- a narrow band in the dark of the earth, on this
 * tile's side of the line, from the ground floor at the far end to the floor
 * at the near end, with the line of the cut catching the light along its top.
 * At any other turn the faces show, and this draws nothing.
 */
export function earthEnd(c: CellarCanvas, x: number, y: number, side: Side, floor: number, top: number): void {
  const { ctx, cam, zoom } = c;
  const [[u0, v0], [u1, v1]] = ENDS[side];
  const sx = cam.worldToScreenX(x + u0, y + v0);
  if (Math.abs(cam.worldToScreenX(x + u1, y + v1) - sx) >= 0.5) return;
  const Y = (u: number, v: number, h: number): number => cam.worldToScreenY(x + u, y + v, h);
  const far = Math.min(Y(u0, v0, top), Y(u1, v1, top));
  const nearTop = Math.max(Y(u0, v0, top), Y(u1, v1, top));
  const nearFoot = Math.max(Y(u0, v0, floor), Y(u1, v1, floor));
  // Into this tile, whichever way that is on the screen.
  const into = Math.sign(cam.worldToScreenX(x + 0.5, y + 0.5) - sx) || 1;
  const w = Math.max(2, 2.4 * zoom);
  ctx.fillStyle = `rgba(${CELLAR_DARK_INK}, 0.78)`;
  ctx.fillRect(into > 0 ? sx : sx - w, far, w, nearFoot - far);
  ctx.strokeStyle = rgb(SOIL, 1.06);
  ctx.lineWidth = Math.max(0.8, 0.8 * zoom);
  ctx.beginPath();
  ctx.moveTo(sx + into * w, far);
  ctx.lineTo(sx + into * w, nearTop);
  ctx.stroke();
}

/** The side of a tile across which another lies, or null. */
export function sideTo(x: number, y: number, nx: number, ny: number): Side | null {
  for (const s of SIDES) if (x + OUT[s][0] === nx && y + OUT[s][1] === ny) return s;
  return null;
}

/** The side opposite. */
export const across = (s: Side): Side => OPPOSITE[s];

/** The face of the ground on one side of a tile: what is across it, its corners' heights, soil and stone. */
export function faceOn(g: Game, x: number, y: number, side: Side, lo: number, dim: number, bearer: boolean): EarthFace {
  const w = g.world;
  const [[u0, v0], [u1, v1]] = ENDS[side];
  const [ox, oy] = OUT[side];
  const ax = x + u0, ay = y + v0, bx = x + u1, by = y + v1;
  const { stone, ore, metal } = stoneOf(w, x + ox, y + oy);
  return {
    ax, ay, bx, by,
    lo0: lo, lo1: lo,
    hi0: w.getHeight(ax, ay), hi1: w.getHeight(bx, by),
    rock0: w.getHeight(ax, ay) - w.getDirt(ax, ay), rock1: w.getHeight(bx, by) - w.getDirt(bx, by),
    ux: ox === 0 ? 1 : 0, uy: ox === 0 ? 0 : 1,
    stone, ore, metal,
    seed: (ax * 73856093) ^ (ay * 19349663) ^ (bx * 83492791) ^ (by * 2971215073),
    dim, bearer,
  };
}

/**
 * How dark a thing seen down a hole from up top is, by how far down it is:
 * pairs of the shade and the share of the hole's depth it is laid at, from
 * the ground floor's plane (0) to the floor of the cellar (1).
 */
export const SHAFT_STOPS: ReadonlyArray<readonly [number, number]> = [[0.12, 0], [0.55, 0.55], [0.86, 1]];

/** The shade at a share of a hole's depth, between `SHAFT_STOPS`. */
export function shaftAlpha(share: number): number {
  const at = Math.max(0, Math.min(1, share));
  for (let i = 1; i < SHAFT_STOPS.length; i++) {
    const [k1, s1] = SHAFT_STOPS[i];
    const [k0, s0] = SHAFT_STOPS[i - 1];
    if (at <= s1) return k0 + ((k1 - k0) * (at - s0)) / Math.max(1e-9, s1 - s0);
  }
  return SHAFT_STOPS[SHAFT_STOPS.length - 1][0];
}

/**
 * Darker the deeper, down a face seen in a hole: the shade from its head at
 * the ground floor (`a0` to `a1`, along its top) to the floor of the hole
 * (`b0`, straight under `a0`). Laid across the face's own up and down rather
 * than down the screen, so every point of it has the shade of its depth.
 */
export function shaftShade(ctx: CanvasRenderingContext2D, a0: [number, number], a1: [number, number], b0: [number, number]): CanvasGradient {
  const ex = a1[0] - a0[0], ey = a1[1] - a0[1];
  const len = Math.hypot(ex, ey) || 1;
  let nx = -ey / len, ny = ex / len;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const d = (b0[0] - a0[0]) * nx + (b0[1] - a0[1]) * ny;
  const grad = ctx.createLinearGradient(a0[0], a0[1], a0[0] + nx * d, a0[1] + ny * d);
  for (const [k, at] of SHAFT_STOPS) grad.addColorStop(at, `rgba(12, 9, 12, ${k})`);
  return grad;
}

/**
 * The shade a staircase throws on the cellar floor under it, from its foot,
 * where it meets the floor, to its head a storey up: the floor under a flight
 * is darker than the floor in the open, so a flight seen from its head end,
 * where its stringers and its treads fall across one another on the screen,
 * shows the floor under it and stands up off it.
 */
export function flightShade(c: CellarCanvas, x: number, y: number, h: number, facing: Side): void {
  const { ctx, cam } = c;
  // Across the flight (`u`) and up it from its foot (`v`), in the world, as the renderer lays a flight.
  const at = (u: number, v: number): [number, number] => {
    const [wx, wy] = facing === 'n' ? [x + u, y + v] : facing === 's' ? [x + u, y + 1 - v] : facing === 'w' ? [x + v, y + u] : [x + 1 - v, y + u];
    return [cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, h)];
  };
  const pts = [at(0.04, 0.02), at(0.96, 0.02), at(0.96, 0.98), at(0.04, 0.98)];
  const foot = at(0.5, 0), head = at(0.5, 1);
  const grad = ctx.createLinearGradient(foot[0], foot[1], head[0], head[1]);
  grad.addColorStop(0, 'rgba(24, 16, 14, 0.34)');
  grad.addColorStop(1, 'rgba(24, 16, 14, 0.12)');
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
}
