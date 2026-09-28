/**
 * A flight of garden steps, drawn up the tile it is laid on.
 *
 * The flight is built on the slope, as a mason builds one: every step a block
 * set on the ground, so the foot of each riser sits on the bank and the tread
 * over it stands a riser proud of it, the first riser rising off the ground at
 * the foot and the top tread level with the ground at the head. Its treads
 * follow the tile across -- a flight on a bank that falls a little to one side
 * falls with it -- and there are as many of them as it takes to keep a riser
 * near `STEPS_RISER` high, two at the least and ten at the most.
 *
 * Down each side runs a cheek, a low wall with a coping on it a hand over the
 * line of the nosings, and at a free end -- the foot or the head of a flight
 * that does not go on into another tile of steps -- the end tread is a
 * landing, deep enough to stand a pot of flowers on at either side. A flight
 * laid beside another going the same way with as many steps is one broad
 * flight: no cheek between them, and no pots.
 *
 * It is drawn in the ground pass, straight after the tile's own colour, and it
 * is drawn in the order a camera anywhere round it would see it: the far
 * cheek, the steps from the back, the pots on the far side, then the near
 * cheek and its pots. Whatever stands on the tile or in front of it is drawn
 * after, which is the order the ground is always drawn in.
 *
 * Stone flights take the four stones slabs are cut from, dressed as a stone
 * stair of that stone is (`stairStyle`); timber ones are boards in the wood of
 * their planks, on stringers.
 */
import type { Camera } from '../engine/camera';
import type { World } from '../world/world';
import type { Season } from '../world/calendar';
import { TREE_DEFS, TileType, stepsFit, stepsKind, stepsTimber } from '../world/tiles';
import { hash2 } from '../world/noise';
import { stairStyle, type StairStyle } from './stairing';
import { woodHex } from './furniture';

type RGB = readonly [number, number, number];
type Pt = [number, number];
type Side = 'n' | 'e' | 's' | 'w';

/** How high a riser is laid, before the count of them is rounded to a whole number. */
export const STEPS_RISER = 7;
/** How many steps a flight rising this far is laid in. */
export const stepsTreads = (rise: number): number => Math.max(2, Math.min(10, Math.round(rise / STEPS_RISER)));
/** The depth of the landing tread at a free end, as a share of the tile, when the steps themselves are shallower. */
const LANDING = 0.2;
/** A cheek's width, as a share of the tile; and how far its coping stands over the line of the nosings. */
const CW = 0.08;
const CH = 3;
/** How far a tread stands out over the riser under it, as a share of the tile, and how thick its nosing is. */
const NOSE = 0.016;
const NOSE_H = 1;
/** A pot's radius, as a share of the tile, and how tall it stands, in height units. */
const POT_R = 0.085;
const POT_H = 5.2;

const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
const rgb = (c: RGB, k = 1, a = 1): string => `rgba(${clamp255(c[0] * k)}, ${clamp255(c[1] * k)}, ${clamp255(c[2] * k)}, ${a})`;
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as RGB;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** The stone stair each of the four slab stones is dressed as. */
const STONE_STYLE = ['stone_brick', 'slate', 'marble', 'sandstone'];

/** A timber flight: boards in the wood of its planks, stringers a shade darker, inked in the wood's own dark. */
function timberStyle(wood: string): StairStyle {
  const w = hex(woodHex(wood));
  const ink: RGB = mix(w, [46, 32, 28], 0.68);
  return {
    build: 'string', tread: w, nose: mix(w, [255, 250, 238], 0.28), proud: true,
    riser: mix(w, [70, 52, 44], 0.2), joint: mix(w, [46, 32, 28], 0.42), courses: 0, across: 0, slabs: 2,
    string: mix(w, [70, 52, 44], 0.34), stringHi: mix(w, [255, 250, 238], 0.12), line: ink,
    rail: 'wood', post: w, bar: w, barHi: w,
  };
}

/** The unit step up a flight (+s) and across it to its right (+t), in the world, for a flight climbing toward `up`. */
const UP: Record<Side, Pt> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
const ACROSS: Record<Side, Pt> = { n: [1, 0], e: [0, 1], s: [-1, 0], w: [0, -1] };

/**
 * The shape of one flight: which way it climbs, how far, in how many steps,
 * where each tread starts and ends up the tile, and which of its sides and
 * ends run on into another flight.
 */
export interface Flight {
  up: Side;
  rise: number;
  n: number;
  /** Where tread i starts (`b[i]`) and ends (`b[i + 1]`), from the foot (0) to the head (1). */
  b: number[];
  joins: { foot: boolean; head: boolean; left: boolean; right: boolean };
  /** A point `t` across the flight from its left and `s` up it, in the world. */
  W(t: number, s: number): Pt;
  /** The ground there. */
  G(t: number, s: number): number;
  /** The top of tread `i`, at `t` across. */
  top(i: number, t: number): number;
}

const cornerBuf = [0, 0, 0, 0];

/** Whether the tile at (x, y) is a flight going the same way in the same number of steps. */
function sameFlight(world: World, x: number, y: number, up: Side, n: number): boolean {
  if (!world.inBounds(x, y) || world.getTile(x, y) !== TileType.Steps) return false;
  const f = stepsFit(world.corners(x, y, cornerBuf));
  return f.up === up && stepsTreads(f.rise) === n;
}

/** The flight laid on the tile at (x, y), which has to be a tile of steps. */
export function flightAt(world: World, x: number, y: number): Flight {
  const c = world.corners(x, y, [0, 0, 0, 0]);
  const [nw, ne, se, sw] = c;
  const fit = stepsFit(c);
  const up = fit.up;
  const n = stepsTreads(fit.rise);
  const W = (t: number, s: number): Pt => {
    switch (up) {
      case 'n': return [x + t, y + 1 - s];
      case 'e': return [x + s, y + t];
      case 's': return [x + 1 - t, y + s];
      default: return [x + 1 - s, y + 1 - t];
    }
  };
  const G = (t: number, s: number): number => {
    const [wx, wy] = W(t, s);
    const u = wx - x, v = wy - y;
    return nw * (1 - u) * (1 - v) + ne * u * (1 - v) + se * u * v + sw * (1 - u) * v;
  };
  const [ux, uy] = UP[up], [ax, ay] = ACROSS[up];
  const joins = {
    foot: sameFlight(world, x - ux, y - uy, up, n),
    head: sameFlight(world, x + ux, y + uy, up, n),
    left: sameFlight(world, x - ax, y - ay, up, n),
    right: sameFlight(world, x + ax, y + ay, up, n),
  };
  // The treads: a landing at each free end, deep enough for a pot, and the rest shared out evenly.
  const d0 = n >= 3 && !joins.foot ? Math.max(1 / n, LANDING) : 1 / n;
  const d1 = n >= 3 && !joins.head ? Math.max(1 / n, LANDING) : 1 / n;
  const mid = n > 2 ? (1 - d0 - d1) / (n - 2) : 0;
  const b = [0];
  for (let i = 0; i < n; i++) b.push(i === 0 ? d0 : i === n - 1 ? 1 : b[i] + mid);
  if (n === 2) b[1] = 0.5;
  const top = (i: number, t: number): number => {
    const f = G(t, 0), h = G(t, 1);
    return f + ((i + 1) * (h - f)) / n;
  };
  return { up, rise: fit.rise, n, b, joins, W, G, top };
}

/** Where a point of the world lies in a flight's own frame: across it and up it. */
function localOf(f: Flight, x: number, y: number, wx: number, wy: number): Pt {
  const u = wx - x, v = wy - y;
  switch (f.up) {
    case 'n': return [u, 1 - v];
    case 'e': return [v, u];
    case 's': return [1 - u, v];
    default: return [1 - v, 1 - u];
  }
}

/**
 * The height of the tread under a point on a flight: what a foot stands on,
 * which is a riser higher at a time rather than the slope of the bank under it.
 */
export function stepsFootAt(world: World, wx: number, wy: number): number {
  const x = Math.floor(wx), y = Math.floor(wy);
  const f = flightAt(world, x, y);
  const [t, s] = localOf(f, x, y, wx, wy);
  let i = 0;
  while (i < f.n - 1 && s >= f.b[i + 1]) i++;
  return f.top(i, Math.max(0, Math.min(1, t)));
}

export interface StepsView {
  ctx: CanvasRenderingContext2D;
  cam: Camera;
  world: World;
  zoom: number;
  season: Season;
  /** How a face running along (ux, uy) in the world is lit: the renderer's own rule for walls. */
  light: (ux: number, uy: number) => number;
  /** Device pixels to a CSS pixel, which a flight is baked at. */
  dpr: number;
}

/** What a flight is painted through: the camera, or the camera moved onto a canvas of the flight's own. */
interface Eye {
  worldToScreenX(wx: number, wy: number): number;
  worldToScreenY(wx: number, wy: number, h: number): number;
  nearSide(ux: number, uy: number): number;
  rotateX(wx: number, wy: number): number;
  rotateY(wx: number, wy: number): number;
  readonly heightScale: number;
}

interface Paint {
  ctx: CanvasRenderingContext2D;
  cam: Eye;
  world: World;
  zoom: number;
  season: Season;
  light: (ux: number, uy: number) => number;
}

/**
 * A flight baked: its picture at one zoom and turn, and where the tile's
 * north-west corner, at height nought, falls on it.
 */
interface Bake {
  canvas: HTMLCanvasElement;
  x0: number;
  y0: number;
  area: number;
}

/** The canvas pixels the flights kept baked may hold between them; past it the longest unseen go. */
const BAKE_BUDGET = 12e6;
/** Past this many device pixels to a unit of the view, a flight is painted straight on rather than baked: few are on screen, and each bake would be large. */
const BAKE_MOST = 4;
const bakes = new Map<string, Bake>();
let bakedArea = 0;
const bakeCorners = [0, 0, 0, 0];

/**
 * Draw the flight laid on the tile at (x, y).
 *
 * A flight is some hundred shapes, and the ground under the camera is drawn
 * every frame, so it is baked: painted once onto a canvas of its own for the
 * zoom, the turn, the season and the shape of the tile and its neighbours, and
 * that canvas put down each frame after. Nothing on it moves.
 */
export function drawSteps(o: StepsView, x: number, y: number): void {
  const { ctx, cam, world } = o;
  const zoom = Math.round(o.zoom * 100) / 100;
  const scale = zoom * o.dpr;
  if (scale > BAKE_MOST) {
    paint(o, x, y);
    return;
  }
  const f = flightAt(world, x, y);
  const c = world.corners(x, y, bakeCorners);
  const joins = (f.joins.foot ? 1 : 0) | (f.joins.head ? 2 : 0) | (f.joins.left ? 4 : 0) | (f.joins.right ? 8 : 0);
  const key = `${x},${y}|${world.getData(x, y)}|${c[0]},${c[1]},${c[2]},${c[3]}|${joins}|${cam.rotation}|${zoom}|${o.dpr}|${o.season}`;
  const ax = cam.worldToScreenX(x, y), ay = cam.worldToScreenY(x, y, 0);
  const k = o.zoom / zoom;
  let b = bakes.get(key);
  if (b) {
    bakes.delete(key);
    bakes.set(key, b);
  } else {
    b = bake(o, x, y, zoom, c, ax, ay, k);
    bakes.set(key, b);
    bakedArea += b.area;
    for (const [old, was] of bakes) {
      if (bakedArea <= BAKE_BUDGET || was === b) break;
      bakes.delete(old);
      bakedArea -= was.area;
    }
  }
  // Put down on the device's own pixels, so a flight at the zoom it was baked at is as sharp as one painted.
  const px = Math.round((ax + b.x0 * k) * o.dpr) / o.dpr, py = Math.round((ay + b.y0 * k) * o.dpr) / o.dpr;
  ctx.drawImage(b.canvas, px, py, (b.canvas.width / o.dpr) * k, (b.canvas.height / o.dpr) * k);
}

/** Paint the flight on (x, y) onto a canvas of its own, at `zoom`, with the tile's north-west corner at height nought at its origin. */
function bake(o: StepsView, x: number, y: number, zoom: number, c: readonly number[], ax: number, ay: number, k: number): Bake {
  const cam = o.cam;
  const eye: Eye = {
    worldToScreenX: (wx, wy) => (cam.worldToScreenX(wx, wy) - ax) / k,
    worldToScreenY: (wx, wy, h) => (cam.worldToScreenY(wx, wy, h) - ay) / k,
    nearSide: (ux, uy) => cam.nearSide(ux, uy),
    rotateX: (wx, wy) => cam.rotateX(wx, wy),
    rotateY: (wx, wy) => cam.rotateY(wx, wy),
    heightScale: cam.heightScale,
  };
  // The tile's corners, from the ground under the lowest to over the highest coping, pot and flowers.
  const lo = Math.min(c[0], c[1], c[2], c[3]), hi = Math.max(c[0], c[1], c[2], c[3]) + CH + POT_H + 4;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    const sx = eye.worldToScreenX(x + u, y + v);
    x0 = Math.min(x0, sx);
    x1 = Math.max(x1, sx);
    y0 = Math.min(y0, eye.worldToScreenY(x + u, y + v, hi));
    y1 = Math.max(y1, eye.worldToScreenY(x + u, y + v, lo));
  }
  // Room for the ink and for the flowers standing over a pot.
  const pad = 3 + 12 * zoom;
  x0 = Math.floor(x0 - pad);
  y0 = Math.floor(y0 - pad);
  x1 = Math.ceil(x1 + pad);
  y1 = Math.ceil(y1 + pad);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil((x1 - x0) * o.dpr));
  canvas.height = Math.max(1, Math.ceil((y1 - y0) * o.dpr));
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.setTransform(o.dpr, 0, 0, o.dpr, -x0 * o.dpr, -y0 * o.dpr);
  paint({ ctx: g, cam: eye, world: o.world, zoom, season: o.season, light: o.light }, x, y);
  return { canvas, x0, y0, area: canvas.width * canvas.height };
}

/** Pinks, whites, yellows and a blue for the pots: which one a pot has is its place's. */
const BLOOMS: RGB[] = [hex('#f4a8bd'), hex('#f6f1e6'), hex('#f5d77b'), hex('#e98f95'), hex('#b7b0e6'), hex('#f2b98a')];
/** The leaves in a pot: lit, mid and deep, and the rust of an autumn one. */
const LEAF: RGB[] = [hex('#8cc295'), hex('#5f9f73'), hex('#3f7258')];
const RUST: RGB = hex('#c9905a');
const CLAY: RGB = hex('#cf8466');

/** Paint the flight laid on the tile at (x, y), shape by shape. */
function paint(o: Paint, x: number, y: number): void {
  const { ctx, cam, world, zoom } = o;
  const f = flightAt(world, x, y);
  const data = world.getData(x, y);
  const st = stepsTimber(data) ? timberStyle(TREE_DEFS[stepsKind(data)].name) : stairStyle(STONE_STYLE[stepsKind(data)]);
  const timber = stepsTimber(data);
  const { n, b, W, G } = f;
  const P = (t: number, s: number, h: number): Pt => {
    const [wx, wy] = W(t, s);
    return [cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, h)];
  };
  const lw = (k: number): number => Math.max(0.7, k * zoom);
  const poly = (pts: Pt[]): void => {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) (i ? ctx.lineTo(pts[i][0], pts[i][1]) : ctx.moveTo(pts[i][0], pts[i][1]));
    ctx.closePath();
  };
  const fill = (pts: Pt[], colour: string, ink?: string, width = 1): void => {
    poly(pts);
    ctx.fillStyle = colour;
    ctx.fill();
    if (ink) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = lw(width);
      ctx.stroke();
    }
  };
  const line = (a: Pt, c: Pt, ink: string, width: number): void => {
    ctx.strokeStyle = ink;
    ctx.lineWidth = lw(width);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.stroke();
  };
  // Up the flight and across it, in the world, and how each way of facing is lit and seen.
  const [sx0, sy0] = W(0, 0);
  const upX = W(0, 1)[0] - sx0, upY = W(0, 1)[1] - sy0;
  const acX = W(1, 0)[0] - sx0, acY = W(1, 0)[1] - sy0;
  const treadLit = 1.1, riserLit = o.light(acX, acY), sideLit = o.light(upX, upY);
  const risersShow = cam.nearSide(-upX, -upY) > 0;
  const headShows = cam.nearSide(upX, upY) > 0;
  const nearRight = cam.nearSide(acX, acY) > 0;
  const tL = f.joins.left ? 0 : CW, tR = f.joins.right ? 1 : 1 - CW;
  const coarse = zoom < 0.6;
  const ink = (k: number, a: number): string => rgb(st.line, k, a);
  const salt = x * 131 + y * 71;

  /* ---- a cheek, down one side --------------------------------------------- */
  /** The coping's height over the side at `t`: a hand over the line of the nosings, and level along the head. */
  const knee = f.joins.head ? 1 : b[n - 1];
  const coping = (t: number, s: number): number => {
    const foot = G(t, 0), head = G(t, 1), first = foot + (head - foot) / n;
    // Running on into the next tile of the flight, it keeps climbing to meet that tile's first nosing.
    if (f.joins.head) return first + (head - foot) * s + CH;
    return (s >= knee ? head : first + ((head - first) * s) / Math.max(1e-6, knee)) + CH;
  };
  const cheek = (right: boolean): void => {
    const t0 = right ? 1 - CW : 0, t1 = right ? 1 : CW;
    const outer = right ? t1 : t0, inner = right ? t0 : t1;
    const outerShows = right ? nearRight : !nearRight;
    const body = timber ? st.string : st.riser;
    // Its outer face, from the ground along the tile's edge up to the coping.
    if (outerShows) {
      const face: Pt[] = [P(outer, 0, G(outer, 0)), P(outer, 1, G(outer, 1)), P(outer, 1, coping(outer, 1)), P(outer, knee, coping(outer, knee)), P(outer, 0, coping(outer, 0))];
      fill(face, rgb(body, sideLit), ink(sideLit, 0.7), 1);
      if (!coarse) courses(outer, face, sideLit);
    } else {
      // Its inner face, from the treads up to the coping: only the band over the steps shows.
      const face: Pt[] = [P(inner, 0, f.top(0, inner))];
      for (let i = 0; i < n; i++) {
        face.push(P(inner, b[i], f.top(i, inner)), P(inner, b[i + 1], f.top(i, inner)));
      }
      face.push(P(inner, 1, coping(inner, 1)), P(inner, knee, coping(inner, knee)), P(inner, 0, coping(inner, 0)));
      fill(face, rgb(body, sideLit * 0.94), ink(sideLit, 0.55), 0.9);
    }
    // Its ends, where the camera is on that side of them.
    if (risersShow && !f.joins.foot) {
      const end: Pt[] = [P(t0, 0, G(t0, 0)), P(t1, 0, G(t1, 0)), P(t1, 0, coping(t1, 0)), P(t0, 0, coping(t0, 0))];
      fill(end, rgb(body, riserLit), ink(riserLit, 0.7), 1);
    }
    if (headShows && !f.joins.head) {
      const end: Pt[] = [P(t0, 1, G(t0, 1)), P(t1, 1, G(t1, 1)), P(t1, 1, coping(t1, 1)), P(t0, 1, coping(t0, 1))];
      fill(end, rgb(body, riserLit), ink(riserLit, 0.7), 1);
    }
    // And the coping along its top: dressed stone, or a capping board.
    const cap: Pt[] = [P(t0, 0, coping(t0, 0)), P(t0, knee, coping(t0, knee)), P(t0, 1, coping(t0, 1)), P(t1, 1, coping(t1, 1)), P(t1, knee, coping(t1, knee)), P(t1, 0, coping(t1, 0))];
    fill(cap, rgb(timber ? st.stringHi : st.tread, 1.06), ink(1, 0.75), 1);
    if (!coarse) {
      line(P(outer, 0, coping(outer, 0)), P(outer, knee, coping(outer, knee)), rgb(st.nose, 1.08, 0.9), 1.2);
      line(P(outer, knee, coping(outer, knee)), P(outer, 1, coping(outer, 1)), rgb(st.nose, 1.08, 0.9), 1.2);
      // Its joints: a coping stone every so often, or the ends of the boards.
      for (const s of [0.26, 0.52, 0.78]) {
        if (Math.abs(s - knee) < 0.05) continue;
        line(P(t0, s, coping(t0, s)), P(t1, s, coping(t1, s)), ink(1, 0.45), 0.8);
      }
    }
  };
  /** The courses laid up a cheek's outer face: bed joints level, and the joints between stones broken course to course. */
  const courses = (t: number, face: Pt[], lit: number): void => {
    ctx.save();
    poly(face);
    ctx.clip();
    const lo = Math.min(G(t, 0), G(t, 1)), hi = coping(t, 1);
    if (timber) {
      // A stringer: one board on edge, with the bolts through it at each tread.
      for (let i = 1; i < n; i++) {
        const [px, py] = P(t, b[i] + 0.02, f.top(i - 1, t) - 1.6);
        ctx.fillStyle = ink(1, 0.55);
        ctx.beginPath();
        ctx.arc(px, py, Math.max(0.8, 0.9 * zoom), 0, Math.PI * 2);
        ctx.fill();
      }
      line(P(t, 0, coping(t, 0) - 1.2), P(t, knee, coping(t, knee) - 1.2), rgb(st.stringHi, lit, 0.7), 0.9);
    } else {
      const course = 3.4;
      let k = 0;
      for (let h = Math.floor(lo / course) * course + course; h < hi; h += course, k++) {
        line(P(t, 0, h), P(t, 1, h), rgb(st.joint, lit, 0.75), 0.8);
        for (let j = 0; j < 5; j++) {
          const s = (j + 0.5 * (k % 2) + 0.2 * hash2(salt, k * 7 + j, 23)) / 4.6;
          if (s <= 0.02 || s >= 0.98) continue;
          line(P(t, s, h - course), P(t, s, h), rgb(st.joint, lit, 0.7), 0.8);
        }
      }
    }
    ctx.restore();
  };

  /* ---- one step: its riser, where the camera sees it, and its tread ------- */
  const step = (i: number): void => {
    const s0 = b[i], s1 = b[i + 1];
    const baseL = i === 0 ? G(tL, 0) : f.top(i - 1, tL), baseR = i === 0 ? G(tR, 0) : f.top(i - 1, tR);
    const topL = f.top(i, tL), topR = f.top(i, tR);
    if (risersShow) {
      const riser: Pt[] = [P(tL, s0, baseL), P(tR, s0, baseR), P(tR, s0, topR - NOSE_H), P(tL, s0, topL - NOSE_H)];
      fill(riser, rgb(st.riser, riserLit), ink(riserLit, 0.45), 0.9);
      if (!coarse) {
        // The joints in it: between its stones, or between the ends of its boards.
        const units = timber ? 1 : Math.max(1, st.across);
        for (let j = 1; j <= units; j++) {
          const tj = tL + ((tR - tL) * (j - 0.5 + 0.35 * (hash2(salt, i * 5 + j, 29) - 0.5) + (i % 2) * 0.5)) / (units + 0.5);
          if (tj <= tL + 0.05 || tj >= tR - 0.05) continue;
          line(P(tj, s0, baseL + ((baseR - baseL) * (tj - tL)) / (tR - tL)), P(tj, s0, topL + ((topR - topL) * (tj - tL)) / (tR - tL) - NOSE_H), rgb(st.joint, riserLit, 0.8), 0.8);
        }
        // The shade the nosing throws on it.
        const shade: Pt[] = [P(tL, s0, topL - NOSE_H), P(tR, s0, topR - NOSE_H), P(tR, s0, topR - NOSE_H - 1.3), P(tL, s0, topL - NOSE_H - 1.3)];
        fill(shade, ink(1, 0.22));
      }
      // The nosing's face, catching the light.
      const nose: Pt[] = [P(tL, s0 - NOSE, topL - NOSE_H), P(tR, s0 - NOSE, topR - NOSE_H), P(tR, s0 - NOSE, topR), P(tL, s0 - NOSE, topL)];
      fill(nose, rgb(st.nose, riserLit * 1.04));
    }
    const tread: Pt[] = [P(tL, s0 - NOSE, topL), P(tR, s0 - NOSE, topR), P(tR, s1, topR), P(tL, s1, topL)];
    fill(tread, rgb(st.tread, treadLit), ink(treadLit, 0.4), 0.9);
    if (coarse) return;
    // Where one slab ends and the next begins, or the join between two boards along it.
    if (timber) {
      const sm = (s0 + s1) / 2;
      line(P(tL, sm, topL), P(tR, sm, topR), rgb(st.joint, treadLit, 0.6), 0.8);
    } else {
      for (let j = 1; j < st.slabs + (s1 - s0 > 0.15 ? 1 : 0); j++) {
        const k = st.slabs + (s1 - s0 > 0.15 ? 1 : 0);
        const tj = tL + ((tR - tL) * (j + (hash2(salt, i * 3 + j, 31) - 0.5) * 0.5)) / k;
        const hj = topL + ((topR - topL) * (tj - tL)) / (tR - tL);
        line(P(tj, s0 - NOSE, hj), P(tj, s1, hj), rgb(st.joint, treadLit, 0.8), 0.8);
      }
    }
    // The arris along its front, where the light catches it.
    line(P(tL, s0 - NOSE, topL), P(tR, s0 - NOSE, topR), rgb(st.nose, treadLit * 1.05), 1.4);
  };

  /* ---- a pot of flowers, at an end of a landing --------------------------- */
  const pot = (t: number, s: number, i: number, key: number): void => {
    if (coarse) return;
    const h = f.top(i, t);
    const [px, py] = P(t, s, h);
    // As wide as it is on the ground, measured across the screen.
    const [ex] = P(t + POT_R, s, h), [fx] = P(t, s + POT_R, h);
    const r = Math.max(2.2, Math.hypot(ex - px, fx - px) * 0.9);
    const tall = POT_H * cam.heightScale * zoom;
    const rim = r * 0.36;
    // Its shadow on the tread, and its body: a clay pot, lit from the right.
    ctx.fillStyle = 'rgba(40, 52, 60, 0.18)';
    ctx.beginPath();
    ctx.ellipse(px + r * 0.25, py, r * 1.05, rim * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
    const body = ctx.createLinearGradient(px - r, 0, px + r, 0);
    body.addColorStop(0, rgb(CLAY, 0.78));
    body.addColorStop(0.6, rgb(CLAY, 1.02));
    body.addColorStop(1, rgb(CLAY, 1.12));
    ctx.beginPath();
    ctx.moveTo(px - r, py - tall);
    ctx.lineTo(px - r * 0.72, py);
    ctx.ellipse(px, py, r * 0.72, rim * 0.72, 0, Math.PI, 0, true);
    ctx.lineTo(px + r, py - tall);
    ctx.closePath();
    ctx.fillStyle = body;
    ctx.fill();
    ctx.strokeStyle = rgb(hex('#7b4536'), 1, 0.85);
    ctx.lineWidth = lw(0.9);
    ctx.stroke();
    // The rim, a band a little proud of the body.
    ctx.beginPath();
    ctx.ellipse(px, py - tall, r * 1.06, rim, 0, 0, Math.PI * 2);
    ctx.fillStyle = rgb(CLAY, 1.1);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(px, py - tall, r * 0.86, rim * 0.72, 0, 0, Math.PI * 2);
    ctx.fillStyle = rgb(hex('#5d4337'));
    ctx.fill();
    // What is growing in it, and the flowers on it in spring and summer; a bare stem or two in winter.
    const season = o.season;
    const top = py - tall - rim * 0.3;
    if (season === 'winter') {
      ctx.strokeStyle = rgb(hex('#6f5a4c'));
      ctx.lineWidth = lw(1);
      for (let k = 0; k < 4; k++) {
        const a = -1.1 + k * 0.7 + (hash2(salt, key, k) - 0.5) * 0.3;
        ctx.beginPath();
        ctx.moveTo(px + (k - 1.5) * r * 0.25, top + rim * 0.4);
        ctx.lineTo(px + Math.sin(a) * r * 0.9, top - Math.cos(a) * r * 1.1);
        ctx.stroke();
      }
      return;
    }
    const lobes: Array<[number, number, number]> = [[-0.62, -0.1, 0.6], [0.6, -0.12, 0.62], [-0.28, -0.62, 0.66], [0.3, -0.66, 0.64], [0, -1.02, 0.6], [0, -0.22, 0.72]];
    const leaf = season === 'autumn' ? LEAF.map((c) => mix(c, RUST, 0.32)) : LEAF;
    for (const [lx, ly, lr] of lobes) {
      ctx.beginPath();
      ctx.arc(px + lx * r, top + ly * r, lr * r, 0, Math.PI * 2);
      ctx.fillStyle = rgb(leaf[1]);
      ctx.fill();
      ctx.strokeStyle = rgb(leaf[2], 1, 0.8);
      ctx.lineWidth = lw(0.8);
      ctx.stroke();
    }
    for (const [lx, ly, lr] of lobes) {
      ctx.beginPath();
      ctx.arc(px + lx * r + lr * r * 0.22, top + ly * r - lr * r * 0.25, lr * r * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = rgb(leaf[0], 1, 0.85);
      ctx.fill();
    }
    if (season === 'autumn') return;
    // Each pot is one colour, which is its place's; summer is fuller than spring.
    const bloom = BLOOMS[Math.floor(hash2(x * 7 + key, y * 5 + i, 41) * BLOOMS.length)];
    const count = season === 'summer' ? 7 : 5;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + hash2(salt, key, 43 + k) * 0.8;
      const d = 0.35 + 0.45 * hash2(salt, key, 47 + k);
      const bx = px + Math.cos(a) * d * r * 1.05;
      const by = top - 0.52 * r + Math.sin(a) * d * r * 0.7;
      const br = Math.max(1.1, r * (season === 'summer' ? 0.24 : 0.2));
      for (let p = 0; p < 5; p++) {
        const pa = (p / 5) * Math.PI * 2 + k;
        ctx.beginPath();
        ctx.arc(bx + Math.cos(pa) * br * 0.62, by + Math.sin(pa) * br * 0.5, br * 0.58, 0, Math.PI * 2);
        ctx.fillStyle = rgb(bloom);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(bx, by, br * 0.34, 0, Math.PI * 2);
      ctx.fillStyle = rgb(hex('#f0c24e'));
      ctx.fill();
    }
  };
  /** The pots on one side of the flight: at the foot and at the head, where the flight ends there and does not go on. */
  const pots = (right: boolean): void => {
    if (right ? f.joins.right : f.joins.left) return;
    const t = right ? 1 - CW - POT_R * 1.15 : CW + POT_R * 1.15;
    // The far one of the two first, so the nearer stands in front of it.
    const ends: Array<[number, number, number]> = [];
    if (!f.joins.foot) ends.push([Math.max(POT_R * 1.2, (b[1] - NOSE) / 2), 0, right ? 1 : 0]);
    if (!f.joins.head) ends.push([Math.min(1 - POT_R * 1.2, (b[n - 1] + 1) / 2), n - 1, right ? 3 : 2]);
    ends.sort((a, c) => depth(t, a[0]) - depth(t, c[0]));
    for (const [s, i, key] of ends) pot(t, s, i, key);
  };
  const depth = (t: number, s: number): number => {
    const [wx, wy] = W(t, s);
    return cam.rotateX(wx, wy) + cam.rotateY(wx, wy);
  };

  ctx.save();
  ctx.lineJoin = 'round';
  // The far cheek, the steps from the back, the far pots, then the near cheek and its pots.
  const farRight = !nearRight;
  if (!(farRight ? f.joins.right : f.joins.left)) cheek(farRight);
  const order = Array.from({ length: n }, (_, i) => i).sort((a, c) => depth(0.5, (b[a] + b[a + 1]) / 2) - depth(0.5, (b[c] + b[c + 1]) / 2));
  for (const i of order) step(i);
  pots(farRight);
  if (!(nearRight ? f.joins.right : f.joins.left)) cheek(nearRight);
  pots(nearRight);
  ctx.restore();
}
