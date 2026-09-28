/**
 * A pool dug in a foundation, and the water going over its edge.
 *
 * The slab is drawn as it always is, top and all, and this cuts the hole in
 * the top. The hole is worked out as a little grid over the tile -- the rim
 * round the outside, the middle, and wherever water goes over the rim or comes
 * in over it -- with each cell of it water or concrete. A side with the same
 * pool beyond it has no rim, because the water carries on into the next tile;
 * the corner where two such sides meet with no pool across the diagonal keeps
 * a post of concrete, which is the inside corner of an L-shaped pool.
 *
 * Everything in the hole is drawn clipped to the hole as it stands at the top
 * of the slab. That is what hides the water under the near rim: the walls of
 * the hole the camera looks at drop from the top to the water, and all the
 * rest of it is water.
 *
 * Water that goes over the edge goes down the face of the slab to whatever is
 * at its foot: the ground, which the stream it becomes runs on across, or a
 * lower pool, whose rim is open where it comes in, as wide as the water
 * coming. From one tile it goes through a notch in the rim. From a row of
 * tiles of the pool along the side it goes over, whose outsides are all as low
 * -- the same pool below, or ground at least as low -- it goes over the whole
 * row as one curtain, a weir, with only the rim at the row's two ends left
 * standing; each tile draws its own stretch of that curtain, and the curtain
 * is drawn by the one painter every fall is (`./falls`), so the stretches are
 * one sheet. On a face the camera cannot see, what shows is the water going
 * over the rim.
 *
 * The look is the owner's picture of a garden basin: clear turquoise water
 * rather than the sea's blue, a glassy sheet streaked light and dark going over
 * a notch in the coping, a plume of froth where it lands, and a lily pad or two
 * on the still water.
 */
import type { Camera } from '../engine/camera';
import { POOL_LIP, type Spill } from '../world/springs';
import { drawFoot, drawLip, drawSheet, fallView, place, type FallView, type Placed, type Sheet } from './falls';
import { HALF_H, HALF_W, HEIGHT_SCALE } from './iso';
import { SPRING_EDGE, SPRING_FOAM, SPRING_WATER } from './water';

type RGB = readonly [number, number, number];

/** A lily pad, its rim, and the light along its top; and the flower some carry. */
const PAD: RGB = [118, 196, 112];
const PAD_RIM: RGB = [64, 142, 86];
const PAD_LIGHT: RGB = [172, 226, 150];
const PETAL: RGB = [246, 168, 184];
const PETAL_TIP: RGB = [255, 226, 232];
const HEART: RGB = [250, 214, 110];

/** The concrete left round a pool, as a share of the tile's side. */
const RIM = 0.12;
/** How far past its own tile the water is laid where the pool goes on into the next, so no hairline of slab shows between the two. */
const HAIR = 0.015;
/** How far into the water the shade at the foot of a wall reaches, as a share of the tile. */
const SHADE = 0.06;
/** The most tiles a curtain over a pool's edge is followed along it either way from the tile its spill is on. */
const RUN_MOST = 16;
/** How far out from the face of its slab the water going over a pool's edge lands, in tiles: into a pool below, and on the ground. */
const THROW_ONTO = 0.1;
const THROW_DOWN = 0.075;
/** How much of the width of the water going over an edge draws back toward the middle as it falls, in tiles at most. */
const DRAW_BACK = 0.08;
/** How far the curl carries water going over a pool's edge out from its face, as a share of the curl a fall over rock has. */
const HUG = 0.6;
/** How far along the side the foam, rings and broken water at a curtain's foot reach past where each comes down, in tiles. */
const FOOT_REACH = 0.9;

/** A side of a tile, by the way out through it. */
type Side = 'n' | 'e' | 's' | 'w';
const SIDES: readonly Side[] = ['n', 'e', 's', 'w'];
const OUT: Record<Side, readonly [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
/** Which axis a side of a tile runs along, 0 for x and 1 for y. */
const ALONG: Record<Side, 0 | 1> = { n: 0, s: 0, e: 1, w: 1 };
/** The side of the next tile across the edge from a side. */
const FACING: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };
const DRY: readonly Spill[] = [];

/** What the renderer knows that a pool needs to be drawn. */
export interface PoolScene {
  /** The tile, and the top of the slab over it. */
  x: number;
  y: number;
  top: number;
  /** Seconds, for what moves; null draws it still, as land remembered rather than seen is drawn. */
  time: number | null;
  /** The slab's concrete, which the walls of the hole are. */
  concrete: RGB;
  /** The top of the slab over a tile when there is a pool in it, or null. */
  poolTop: (x: number, y: number) => number | null;
  /** The top of any poured slab over a tile, a pool in it or not, or null: one with no pool is a wall to water. */
  slabTop: (x: number, y: number) => number | null;
  /** The water going over the edges of the pool dug in a tile; nothing where there is none. */
  spillsAt: (x: number, y: number) => readonly Spill[] | undefined;
  /** The ground at a corner. */
  ground: (cx: number, cy: number) => number;
  /**
   * How the water going over edges is drawn this frame: the projection it is
   * drawn with; the line of the ground a tile is on; where the foot of a
   * curtain onto the ground goes, to be laid after the line of the tile it
   * lands on; and where its mist goes. Absent, a curtain is drawn with no
   * foot and no mist.
   */
  falls?: {
    view: FallView;
    row: (x: number, y: number) => number;
    foot: (row: number, placed: Placed, u0: number, u1: number) => void;
    mist: (placed: Placed) => void;
    foam: CanvasImageSource | null;
  };
  /** Kept from one tile to the next within a frame: the curtain each side of each tile is part of, by tile and side (a tile has one top in a frame). */
  runs?: Map<number, Run | null>;
}

/**
 * A row of a pool's tiles its water goes over as one curtain: the side it
 * goes over, the first and last tile of the row along that side's axis, the
 * corner line of the face it goes down, the spill, whether it falls into a
 * pool below rather than onto the ground, where along the axis it goes over
 * -- a notch in the middle of a tile alone, or the whole row but for the rim
 * at each end -- and the top of the pool's slab.
 */
export interface Run {
  side: Side;
  lo: number;
  hi: number;
  line: number;
  spill: Spill;
  onto: boolean;
  open0: number;
  open1: number;
  top: number;
}

/** Which side of the tile at `x`, `y` an edge is, or null for an edge that is not one of its sides. */
function sideOf(edge: readonly number[], x: number, y: number): Side | null {
  const [ax, ay, bx, by] = edge;
  if (ay === by && ax === x && bx === x + 1) return ay === y ? 'n' : ay === y + 1 ? 's' : null;
  if (ax === bx && ay === y && by === y + 1) return ax === x ? 'w' : ax === x + 1 ? 'e' : null;
  return null;
}

/**
 * Where along its edge water goes over, as shares of the edge from its first
 * corner. Into a pool it goes over the middle. Onto the ground it goes over
 * toward the corner the stream it becomes sets off from: the lower of the two,
 * and the first where they are level, as the rules have it (`settleChain`).
 */
export function spillSpan(s: Spill, ontoPool: boolean, ground: (cx: number, cy: number) => number): [number, number] {
  if (ontoPool) return [0.26, 0.74];
  const ha = ground(s.edge[0], s.edge[1]);
  const hb = ground(s.edge[2], s.edge[3]);
  return hb < ha ? [0.38, 0.82] : [0.18, 0.62];
}

/** The two corners of a side of a tile, first the lower along the side's axis. */
function sideEdge(x: number, y: number, side: Side): [number, number, number, number] {
  return side === 'n' ? [x, y, x + 1, y] : side === 's' ? [x, y + 1, x + 1, y + 1] : side === 'w' ? [x, y, x, y + 1] : [x + 1, y, x + 1, y + 1];
}

/**
 * The curtain the water of the pool poured to `top` goes over side `side` of
 * tile `x`, `y` in, or null. The rules send a pool's water over one edge of
 * one tile; from that tile, along the side it goes over, every tile of the
 * same pool whose outside is as low -- the same pool below, or no slab and
 * ground at least as low as what the water falls to -- goes over with it, as
 * long as they touch.
 */
export function runOf(p: PoolScene, x: number, y: number, side: Side, top: number): Run | null {
  const memo = p.runs;
  const key = (y * 65536 + x) * 4 + SIDES.indexOf(side);
  if (memo?.has(key)) return memo.get(key) ?? null;
  const axis = ALONG[side];
  const here = axis === 0 ? x : y;
  const at = (i: number): [number, number] => (axis === 0 ? [i, y] : [x, i]);
  const pool = (i: number): boolean => {
    const [tx, ty] = at(i);
    return p.poolTop(tx, ty) === top;
  };
  const spillAt = (i: number): Spill | null => {
    const [tx, ty] = at(i);
    for (const s of p.spillsAt(tx, ty) ?? DRY) if (sideOf(s.edge, tx, ty) === side) return s;
    return null;
  };
  let found = NaN;
  for (let i = here; i >= here - RUN_MOST && pool(i) && Number.isNaN(found); i--) if (spillAt(i)) found = i;
  for (let i = here + 1; i <= here + RUN_MOST && pool(i) && Number.isNaN(found); i++) if (spillAt(i)) found = i;
  let run: Run | null = null;
  const spill = Number.isNaN(found) ? null : spillAt(found);
  if (spill) {
    const [ox, oy] = OUT[side];
    const [fx, fy] = at(found);
    const onto = p.slabTop(fx + ox, fy + oy) !== null;
    const low = (i: number): boolean => {
      if (!pool(i)) return false;
      const [tx, ty] = at(i);
      if (onto) {
        const below = p.poolTop(tx + ox, ty + oy);
        return below !== null && below - POOL_LIP === spill.to;
      }
      if (p.slabTop(tx + ox, ty + oy) !== null) return false;
      const [ax, ay, bx, by] = sideEdge(tx, ty, side);
      return Math.min(p.ground(ax, ay), p.ground(bx, by)) <= spill.to;
    };
    let lo = found;
    let hi = found;
    while (found - lo < RUN_MOST && low(lo - 1)) lo--;
    while (hi - found < RUN_MOST && low(hi + 1)) hi++;
    if (here >= lo && here <= hi) {
      const [t0, t1] = lo === hi ? spillSpan(spill, onto, p.ground) : [RIM, hi - lo + 1 - RIM];
      const line = side === 'e' ? x + 1 : side === 'w' ? x : side === 's' ? y + 1 : y;
      run = { side, lo, hi, line, spill, onto, open0: lo + t0, open1: lo + t1, top };
    }
  }
  memo?.set(key, run);
  return run;
}

/**
 * The sheet a curtain over a pool's edge is drawn as: from the face of its
 * slab at the top, over where along the side the water goes over, drawing back
 * a little from the walls of the notch as it falls, landing on the water of
 * the pool below or on the ground at the foot of the face.
 */
export function sheetOf(p: PoolScene, run: Run): Sheet {
  const axis = ALONG[run.side];
  const land = new Float64Array(run.hi - run.lo + 2);
  for (let i = 0; i < land.length; i++) {
    const c = run.lo + i;
    land[i] = run.onto ? run.spill.to : axis === 0 ? p.ground(c, run.line) : p.ground(run.line, c);
  }
  const back = Math.min(DRAW_BACK, (run.open1 - run.open0) * 0.2);
  return {
    axis, line: run.line, from: run.open0 + back, to: run.open1 - back, half: back,
    way: run.side === 'e' || run.side === 's' ? 1 : -1, reach: run.onto ? THROW_ONTO : THROW_DOWN, curl: HUG,
    top: run.top, landFrom: run.lo, land, wet: run.onto, grow: 1,
  };
}

/** Three whole numbers to one in [0, 1), the same every time. */
function hash3(a: number, b: number, c: number): number {
  let k = (a * 374761393 + b * 668265263 + c * 1442695041) | 0;
  k = Math.imul(k ^ (k >>> 13), 1274126177);
  k = Math.imul(k ^ (k >>> 16), 2654435761);
  return ((k ^ (k >>> 15)) >>> 0) / 4294967296;
}

const rgb = (c: RGB, k = 1): string =>
  `rgb(${Math.min(255, c[0] * k) | 0}, ${Math.min(255, c[1] * k) | 0}, ${Math.min(255, c[2] * k) | 0})`;
const rgba = (c: RGB, a: number): string => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a.toFixed(3)})`;

/** Water over the rim, going out or coming in: which side, how far along it, and the curtain it is part of. */
interface Notch {
  side: Side;
  t0: number;
  t1: number;
  run: Run;
  out: boolean;
}

/** A wall of the hole in a tile: its two ends across the tile, and the way it faces, into the water. */
interface Wall {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  nx: number;
  ny: number;
}

/** How the hole in a tile is laid out: the grid over it, which cells of it are water, the notches, and the walls. */
interface Layout {
  U: number[];
  V: number[];
  open: boolean[];
  notches: Notch[];
  walls: Wall[];
}

/** The hole dug in the slab over a tile, which is poured to `top`. */
function layout(p: PoolScene, x: number, y: number, top: number): Layout {
  const same = (dx: number, dy: number): boolean => p.poolTop(x + dx, y + dy) === top;
  const joined: Record<Side, boolean> = { n: same(0, -1), e: same(1, 0), s: same(0, 1), w: same(-1, 0) };

  const notches: Notch[] = [];
  for (const side of SIDES) {
    const here = ALONG[side] === 0 ? x : y;
    // Going out over this side, as part of a curtain along it.
    const out = runOf(p, x, y, side, top);
    if (out) {
      const t0 = Math.max(0, out.open0 - here);
      const t1 = Math.min(1, out.open1 - here);
      if (t1 > t0) notches.push({ side, t0, t1, run: out, out: true });
      continue;
    }
    // Or coming in over it, from a curtain off a pool above falling into this one.
    const nx = x + OUT[side][0];
    const ny = y + OUT[side][1];
    const above = p.poolTop(nx, ny);
    if (above === null || above <= top) continue;
    const into = runOf(p, nx, ny, FACING[side], above);
    if (!into || !into.onto || into.spill.to !== top - POOL_LIP) continue;
    const t0 = Math.max(0, into.open0 - here);
    const t1 = Math.min(1, into.open1 - here);
    if (t1 > t0) notches.push({ side, t0, t1, run: into, out: false });
  }

  // The grid: the rim's inner lines both ways, and the ends of every notch along its side.
  const us = [0, RIM, 1 - RIM, 1];
  const vs = [0, RIM, 1 - RIM, 1];
  for (const n of notches) (n.side === 'n' || n.side === 's' ? us : vs).push(n.t0, n.t1);
  const U = [...new Set(us)].sort((a, b) => a - b);
  const V = [...new Set(vs)].sort((a, b) => a - b);
  const nu = U.length - 1;
  const nv = V.length - 1;
  /** Which band a span of the grid is in: the rim on the low side, the middle, or the rim on the high side. */
  const band = (a: number, b: number): -1 | 0 | 1 => (b <= RIM + 1e-6 ? -1 : a >= 1 - RIM - 1e-6 ? 1 : 0);
  const notched = (side: Side, at: number): boolean => notches.some((n) => n.side === side && at > n.t0 && at < n.t1);
  const open: boolean[] = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const bu = band(U[i], U[i + 1]);
      const bv = band(V[j], V[j + 1]);
      const mu = (U[i] + U[i + 1]) / 2;
      const mv = (V[j] + V[j + 1]) / 2;
      let o: boolean;
      if (bu === 0 && bv === 0) o = true;
      else if (bu === 0) o = bv < 0 ? joined.n || notched('n', mu) : joined.s || notched('s', mu);
      else if (bv === 0) o = bu < 0 ? joined.w || notched('w', mv) : joined.e || notched('e', mv);
      else {
        // A corner is water where the pool goes on past it every way, the diagonal too, or where water going over one
        // side of it goes on past it along a curtain into the next tile of the same pool.
        const su: Side = bu < 0 ? 'w' : 'e';
        const sv: Side = bv < 0 ? 'n' : 's';
        o = (joined[su] && joined[sv] && same(bu, bv)) || (joined[sv] && notched(su, mv)) || (joined[su] && notched(sv, mu));
      }
      open.push(o);
    }
  }
  const isOpen = (i: number, j: number): boolean => open[j * nu + i];

  // The walls: every edge between water and concrete, facing into the water.
  const walls: Wall[] = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      if (!isOpen(i, j)) continue;
      if (i > 0 && !isOpen(i - 1, j)) walls.push({ u0: U[i], v0: V[j], u1: U[i], v1: V[j + 1], nx: 1, ny: 0 });
      if (i + 1 < nu && !isOpen(i + 1, j)) walls.push({ u0: U[i + 1], v0: V[j], u1: U[i + 1], v1: V[j + 1], nx: -1, ny: 0 });
      if (j > 0 && !isOpen(i, j - 1)) walls.push({ u0: U[i], v0: V[j], u1: U[i + 1], v1: V[j], nx: 0, ny: 1 });
      if (j + 1 < nv && !isOpen(i, j + 1)) walls.push({ u0: U[i], v0: V[j + 1], u1: U[i + 1], v1: V[j + 1], nx: 0, ny: -1 });
    }
  }
  return { U, V, open, notches, walls };
}

/** The hole in the top of a slab with a pool dug in it, the water in it, and any going over its edge. Drawn over the slab's top. */
export function drawPool(ctx: CanvasRenderingContext2D, cam: Camera, p: PoolScene): void {
  const { x, y, top } = p;
  const level = top - POOL_LIP;
  const z = cam.zoom;
  const t = p.time;
  const sx = (u: number, v: number): number => cam.worldToScreenX(x + u, y + v);
  const sy = (u: number, v: number, h: number): number => cam.worldToScreenY(x + u, y + v, h);
  const { U, V, open, notches, walls } = layout(p, x, y, top);
  const nu = U.length - 1;
  const nv = V.length - 1;
  const isOpen = (i: number, j: number): boolean => open[j * nu + i];

  /*
   * The walls the camera sees, this tile's and those of the tiles of the same
   * pool round it. A wall hangs down the screen from its top, and one near the
   * edge of the next tile of the pool hangs over into that tile's hole, where
   * the water laid over the hole would cover it; so every tile draws its
   * neighbours' walls too, and the clip keeps what falls in its own hole.
   */
  const seen: Wall[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      // A nearer tile's walls hang on down the screen, away from this one.
      if ((dx || dy) && (cam.rotateX(dx, dy) + cam.rotateY(dx, dy) > 0 || p.poolTop(x + dx, y + dy) !== top)) continue;
      for (const wl of dx || dy ? layout(p, x + dx, y + dy, top).walls : walls) {
        if (cam.nearSide(wl.nx, wl.ny) > 0) seen.push({ ...wl, u0: wl.u0 + dx, v0: wl.v0 + dy, u1: wl.u1 + dx, v1: wl.v1 + dy });
      }
    }
  }

  ctx.save();
  ctx.beginPath();
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      if (!isOpen(i, j)) continue;
      const u0 = U[i] === 0 ? -HAIR : U[i];
      const u1 = U[i + 1] === 1 ? 1 + HAIR : U[i + 1];
      const v0 = V[j] === 0 ? -HAIR : V[j];
      const v1 = V[j + 1] === 1 ? 1 + HAIR : V[j + 1];
      ctx.moveTo(sx(u0, v0), sy(u0, v0, top));
      ctx.lineTo(sx(u1, v0), sy(u1, v0, top));
      ctx.lineTo(sx(u1, v1), sy(u1, v1, top));
      ctx.lineTo(sx(u0, v1), sy(u0, v1, top));
      ctx.closePath();
    }
  }
  ctx.fillStyle = rgb(SPRING_WATER);
  ctx.fill();
  ctx.clip();

  // Shade on the water at the foot of each wall the camera sees.
  ctx.fillStyle = rgba(SPRING_EDGE, 0.3);
  for (const wl of seen) {
    const du = wl.nx * SHADE;
    const dv = wl.ny * SHADE;
    ctx.beginPath();
    ctx.moveTo(sx(wl.u0, wl.v0), sy(wl.u0, wl.v0, level));
    ctx.lineTo(sx(wl.u1, wl.v1), sy(wl.u1, wl.v1, level));
    ctx.lineTo(sx(wl.u1 + du, wl.v1 + dv), sy(wl.u1 + du, wl.v1 + dv, level));
    ctx.lineTo(sx(wl.u0 + du, wl.v0 + dv), sy(wl.u0 + du, wl.v0 + dv, level));
    ctx.closePath();
    ctx.fill();
  }

  if (z >= 0.5) {
    if (t !== null) {
      // Ripples, coming and going: short bowed strokes of light.
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(0.8, 1.1 * z);
      for (let k = 0; k < 3; k++) {
        const h1 = hash3(x, y, k);
        const h2 = hash3(y, x, k + 7);
        const a = Math.sin(t * (0.7 + 0.5 * h1) + h2 * Math.PI * 2);
        if (a < 0.1) continue;
        const u = 0.22 + 0.56 * h1 + 0.02 * Math.sin(t * 0.3 + k);
        const v = 0.22 + 0.56 * h2;
        const cx = sx(u, v);
        const cy = sy(u, v, level);
        const len = (2.2 + 2.6 * h2) * z;
        ctx.strokeStyle = rgba(SPRING_FOAM, 0.6 * a);
        ctx.beginPath();
        ctx.moveTo(cx - len, cy);
        ctx.quadraticCurveTo(cx, cy + 1.4 * z, cx + len, cy);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }
    // Lily pads on still water, a few tiles in every few; none where water is going through.
    if (!notches.length) {
      const count = hash3(x, y, 101) < 0.5 ? 0 : hash3(x, y, 102) < 0.65 ? 1 : 2;
      for (let k = 0; k < count; k++) {
        const h1 = hash3(x, y, 110 + k);
        const h2 = hash3(y, x, 120 + k);
        const drift = t === null ? 0 : 0.012;
        // Kept to the middle, clear of the edge the next tile's water is laid over.
        const u = 0.3 + 0.32 * h1 + drift * Math.sin((t ?? 0) * 0.5 + h2 * 6);
        const v = 0.3 + 0.32 * h2 + drift * Math.cos((t ?? 0) * 0.4 + h1 * 6);
        lilyPad(ctx, sx(u, v), sy(u, v, level), (0.09 + 0.04 * h2) * z, h1 * Math.PI * 2, hash3(x, y, 130 + k) < 0.4 ? z : 0);
      }
    }
  }

  /*
   * Where water goes over the rim, the water drawn smooth into it: this
   * tile's stretch and the hair either side of it, where the next tile of the
   * pool lays its water over this one's and then lays the same stretch again.
   */
  const fv = fallsView(cam, p);
  const placed = notches.map((n) => place(fv, sheetOf(p, n.run)));
  notches.forEach((n, i) => {
    const here = ALONG[n.side] === 0 ? x : y;
    if (n.out) drawLip(ctx, fv, placed[i], here + n.t0 - HAIR, here + n.t1 + HAIR);
  });
  /*
   * Where it comes in from a pool above, its foot: all of the foot that comes
   * onto this tile's water, the lumps, rings and broken water of the tiles
   * either side too, inside the same clip as the water. The next tile of the
   * pool lays its water over the hair of this one's, and so over this one's
   * foot there, and then lays the same foot again; so the shares meet with
   * no join and nothing is laid twice, whichever tile comes first.
   */
  if (t !== null) {
    notches.forEach((n, i) => {
      if (n.out) return;
      const here = ALONG[n.side] === 0 ? x : y;
      drawFoot(ctx, fv, placed[i], here + n.t0 - FOOT_REACH, here + n.t1 + FOOT_REACH, p.falls?.foam ?? null);
    });
  }

  // The walls last, over the water they stand in: one fill for each way they face, so the pieces of one wall join without a seam.
  for (const [nx, ny] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (cam.nearSide(nx, ny) <= 0) continue;
    ctx.beginPath();
    let any = false;
    for (const wl of seen) {
      if (wl.nx !== nx || wl.ny !== ny) continue;
      any = true;
      ctx.moveTo(sx(wl.u0, wl.v0), sy(wl.u0, wl.v0, top));
      ctx.lineTo(sx(wl.u1, wl.v1), sy(wl.u1, wl.v1, top));
      ctx.lineTo(sx(wl.u1, wl.v1), sy(wl.u1, wl.v1, level));
      ctx.lineTo(sx(wl.u0, wl.v0), sy(wl.u0, wl.v0, level));
      ctx.closePath();
    }
    if (!any) continue;
    const across = Math.abs(cam.rotateX(nx, ny)) > Math.abs(cam.rotateY(nx, ny));
    ctx.fillStyle = rgb(p.concrete, across ? 0.78 : 0.64);
    ctx.fill();
  }
  // The water's edge along them.
  ctx.beginPath();
  for (const wl of seen) {
    ctx.moveTo(sx(wl.u0, wl.v0), sy(wl.u0, wl.v0, level));
    ctx.lineTo(sx(wl.u1, wl.v1), sy(wl.u1, wl.v1, level));
  }
  ctx.strokeStyle = rgba(SPRING_FOAM, 0.55);
  ctx.lineWidth = Math.max(0.6, 0.8 * z);
  ctx.stroke();
  ctx.restore();

  // The coping: light along the edge of the rim all the way round the hole.
  ctx.beginPath();
  for (const wl of walls) {
    ctx.moveTo(sx(wl.u0, wl.v0), sy(wl.u0, wl.v0, top));
    ctx.lineTo(sx(wl.u1, wl.v1), sy(wl.u1, wl.v1, top));
  }
  ctx.strokeStyle = rgb(p.concrete, 1.22);
  ctx.lineWidth = Math.max(0.8, 1.1 * z);
  ctx.stroke();

  /*
   * The curtain, this tile's stretch of it, down the face of the slab where
   * the camera can see that face; and onto the ground, its foot, laid after
   * the line of the tile it lands on, and the mist off it, once for the curtain.
   */
  notches.forEach((n, i) => {
    if (!n.out) return;
    const here = ALONG[n.side] === 0 ? x : y;
    const sheet = placed[i].sheet;
    let high = -Infinity;
    for (let k = 0; k < sheet.land.length; k++) high = Math.max(high, sheet.land[k]);
    if (sheet.top - high < 0.5) return;
    if (cam.nearSide(OUT[n.side][0], OUT[n.side][1]) > 0) drawSheet(ctx, fv, placed[i], here + n.t0, here + n.t1);
    if (t === null || !p.falls || n.run.onto) return;
    p.falls.foot(p.falls.row(x + OUT[n.side][0], y + OUT[n.side][1]), placed[i], here + n.t0, here + n.t1);
    if (here === n.run.lo) p.falls.mist(placed[i]);
  });
  ctx.lineWidth = 1;
}

/** The projection the water going over a pool's edge is drawn with: this frame's, held still for land remembered rather than seen. */
function fallsView(cam: Camera, p: PoolScene): FallView {
  const base = p.falls?.view ?? fallView(cam, p.time ?? 0, Infinity, Infinity, HEIGHT_SCALE * cam.zoom);
  return p.time === null ? { ...base, t: 0 } : base;
}

/**
 * A lily pad at a point on the screen, `r` of a tile across at this zoom, with
 * the notch in it turned to `turn`; `flower` above nothing draws one on it.
 */
function lilyPad(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, turn: number, flower: number): void {
  // Round on the water, so as flat on the screen as the ground is.
  const rx = r * Math.SQRT2 * HALF_W;
  const ry = r * Math.SQRT2 * HALF_H;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.ellipse(cx, cy, rx, ry, 0, turn + 0.35, turn + Math.PI * 2 - 0.35);
  ctx.closePath();
  ctx.fillStyle = rgb(PAD);
  ctx.fill();
  ctx.strokeStyle = rgb(PAD_RIM);
  ctx.lineWidth = Math.max(0.6, 0.7 * (rx / 6));
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, cy - ry * 0.12, rx * 0.72, ry * 0.6, 0, Math.PI * 1.1, Math.PI * 1.9);
  ctx.strokeStyle = rgb(PAD_LIGHT);
  ctx.stroke();
  if (flower <= 0) return;
  const fy = cy - 1.6 * flower;
  const pr = 1.9 * flower;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + turn;
    const px = cx + Math.cos(a) * pr * 0.9;
    const py = fy + Math.sin(a) * pr * 0.45;
    ctx.fillStyle = rgb(k % 2 ? PETAL : PETAL_TIP);
    ctx.beginPath();
    ctx.ellipse(px, py, pr * 0.75, pr * 0.42, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = rgb(HEART);
  ctx.beginPath();
  ctx.arc(cx, fy, Math.max(0.7, 0.55 * flower), 0, Math.PI * 2);
  ctx.fill();
}
