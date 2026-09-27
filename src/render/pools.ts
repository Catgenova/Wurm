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
 * Water that goes over the edge goes through a notch in the rim and down the
 * face of the slab to whatever is at its foot: the ground, which the stream it
 * becomes runs on across, or a lower pool, whose rim has a notch where it
 * comes in. On a face the camera cannot see, what shows is the notch.
 *
 * The look is the owner's picture of a garden basin: clear turquoise water
 * rather than the sea's blue, a glassy sheet streaked light and dark going over
 * a notch in the coping, a plume of froth where it lands, and a lily pad or two
 * on the still water.
 */
import type { Camera } from '../engine/camera';
import { POOL_LIP, type Spill } from '../world/springs';
import { HALF_H, HALF_W } from './iso';
import { SPRING_DARK, SPRING_EDGE, SPRING_FOAM, SPRING_PALE, SPRING_WATER } from './water';

type RGB = readonly [number, number, number];

/** Two colours mixed, `k` of the way from the first to the second. */
const mixed = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
/** A falling sheet, top to foot, in the colours the falls between ponds are drawn in (`ponds.ts`). */
const SHEET_TOP = SPRING_WATER;
const SHEET_MID = mixed(SPRING_WATER, SPRING_PALE, 0.42);
const SHEET_FOOT = mixed(SPRING_PALE, SPRING_FOAM, 0.6);

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

/** A side of a tile, by the way out through it. */
type Side = 'n' | 'e' | 's' | 'w';
const SIDES: readonly Side[] = ['n', 'e', 's', 'w'];
const OUT: Record<Side, readonly [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
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
  /** The water going over the edges of the pool dug in a tile; nothing where there is none. */
  spillsAt: (x: number, y: number) => readonly Spill[] | undefined;
  /** The ground at a corner. */
  ground: (cx: number, cy: number) => number;
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

/** A point in the tile, `d` in from a side and `t` along it, as a share of the tile each way. */
const inFrom = (side: Side, t: number, d: number): [number, number] =>
  side === 'n' ? [t, d] : side === 's' ? [t, 1 - d] : side === 'w' ? [d, t] : [1 - d, t];

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

/** Water in, or over, the rim: which side, how far along it, and the spill when it is going out rather than coming in. */
interface Notch {
  side: Side;
  t0: number;
  t1: number;
  out: Spill | null;
  onto: boolean;
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
  for (const s of p.spillsAt(x, y) ?? DRY) {
    const side = sideOf(s.edge, x, y);
    // The same pool is filled by every spring upstream of it, and goes over the same edge for each.
    if (!side || notches.some((n) => n.side === side)) continue;
    const onto = p.poolTop(x + OUT[side][0], y + OUT[side][1]) !== null;
    const [t0, t1] = spillSpan(s, onto, p.ground);
    notches.push({ side, t0, t1, out: s, onto });
  }
  for (const side of SIDES) {
    if (notches.some((n) => n.side === side)) continue;
    const s = (p.spillsAt(x + OUT[side][0], y + OUT[side][1]) ?? DRY).find((o) => sideOf(o.edge, x, y) === side);
    if (!s) continue;
    const [t0, t1] = spillSpan(s, true, p.ground);
    notches.push({ side, t0, t1, out: null, onto: true });
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
      // A corner is water only where the pool goes on past it every way, the diagonal too.
      else o = joined[bu < 0 ? 'w' : 'e'] && joined[bv < 0 ? 'n' : 's'] && same(bu, bv);
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

  for (const n of notches) {
    if (n.out) {
      // Water drawn toward the notch and over it.
      if (t !== null && z >= 0.5) {
        ctx.setLineDash([3 * z, 4 * z]);
        ctx.lineDashOffset = -t * 10 * z;
        ctx.strokeStyle = rgba(SPRING_FOAM, 0.45);
        ctx.lineWidth = Math.max(0.7, 0.9 * z);
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const along = n.t0 + ((n.t1 - n.t0) * (k + 0.5)) / 3;
          const [u0, v0] = inFrom(n.side, along, RIM + 0.12);
          const [u1, v1] = inFrom(n.side, along, 0);
          ctx.moveTo(sx(u0, v0), sy(u0, v0, level));
          ctx.lineTo(sx(u1, v1), sy(u1, v1, level));
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const [a0, b0] = inFrom(n.side, n.t0, 0);
      const [a1, b1] = inFrom(n.side, n.t1, 0);
      ctx.strokeStyle = rgba(SPRING_FOAM, 0.85);
      ctx.lineWidth = Math.max(1, 1.4 * z);
      ctx.beginPath();
      ctx.moveTo(sx(a0, b0), sy(a0, b0, level));
      ctx.lineTo(sx(a1, b1), sy(a1, b1, level));
      ctx.stroke();
    } else if (t !== null) {
      // Where water comes in from a pool above: rings spreading out from it, and froth.
      const mid = (n.t0 + n.t1) / 2;
      const [cu, cv] = inFrom(n.side, mid, RIM * 0.6);
      const cx = sx(cu, cv);
      const cy = sy(cu, cv, level);
      ctx.lineWidth = Math.max(0.7, 0.9 * z);
      for (let k = 0; k < 3; k++) {
        const phase = (t * 0.55 + k / 3) % 1;
        const r = (0.1 + 0.38 * phase) * Math.SQRT2 * z;
        ctx.strokeStyle = rgba(SPRING_FOAM, 0.55 * (1 - phase));
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * HALF_W, r * HALF_H, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let k = 0; k < 5; k++) {
        const along = n.t0 + ((n.t1 - n.t0) * (k + 0.5)) / 5;
        const pulse = 0.5 + 0.5 * Math.sin(t * 6 + k * 1.9 + x * 0.7 + y * 1.3);
        const [u, v] = inFrom(n.side, along, 0.04 + 0.05 * ((k * 7) % 3));
        ctx.fillStyle = rgba(SPRING_FOAM, 0.55 + 0.35 * pulse);
        ctx.beginPath();
        ctx.ellipse(sx(u, v), sy(u, v, level), (2 + 1.4 * pulse) * z, (1.1 + 0.7 * pulse) * z, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
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

  for (const n of notches) {
    if (n.out && cam.nearSide(OUT[n.side][0], OUT[n.side][1]) > 0) fall(ctx, cam, p, n, n.out);
  }
  ctx.lineWidth = 1;
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

/**
 * The water going over the edge, down the face of the slab the camera sees.
 *
 * A glassy sheet from the lip of the notch to the foot of the face, thrown a
 * little clear of it as it goes and whitening as it falls, streaked light and
 * dark with the water in it running down; and a plume of froth where it lands
 * on the ground, with spray thrown out of it both ways. Into a lower pool the
 * froth is that pool's to draw, at the notch it comes in by, because the
 * pool's rim stands in front of where it lands.
 */
function fall(ctx: CanvasRenderingContext2D, cam: Camera, p: PoolScene, n: Notch, s: Spill): void {
  const [ax, ay, bx, by] = s.edge;
  const [ox, oy] = OUT[n.side];
  const ha = p.ground(ax, ay);
  const hb = p.ground(bx, by);
  const foot = (at: number): number => (n.onto ? s.to : ha + (hb - ha) * at);
  const top = p.top;
  const drop = top - Math.max(foot(n.t0), foot(n.t1));
  if (drop < 0.5) return;
  const z = cam.zoom;
  /** A point `at` along the edge, `off` out from the face, at height `h`, on the screen. */
  const q = (at: number, h: number, off: number): [number, number] => {
    const wx = ax + (bx - ax) * at + ox * off;
    const wy = ay + (by - ay) * at + oy * off;
    return [cam.worldToScreenX(wx, wy), cam.worldToScreenY(wx, wy, h)];
  };
  const STEPS = 6;
  const mid = (n.t0 + n.t1) / 2;
  const throwAt = (f: number): number => 0.015 + 0.08 * Math.sqrt(f);
  /** The line down the sheet from `at` along the lip, spreading a little as it falls. */
  const line = (at: number): Array<[number, number]> => {
    const pts: Array<[number, number]> = [];
    for (let k = 0; k <= STEPS; k++) {
      const f = k / STEPS;
      const tt = at + (at - mid) * 0.06 * f;
      pts.push(q(tt, top + (foot(tt) - top) * f, throwAt(f)));
    }
    return pts;
  };
  const trace = (pts: Array<[number, number]>): void => {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
  };
  const left = line(n.t0);
  const right = line(n.t1);
  const yTop = Math.min(left[0][1], right[0][1]);
  const yFoot = Math.max(left[STEPS][1], right[STEPS][1], yTop + 1);
  const sheet = ctx.createLinearGradient(0, yTop, 0, yFoot);
  sheet.addColorStop(0, rgba(SHEET_TOP, 0.92));
  sheet.addColorStop(0.55, rgba(SHEET_MID, 0.9));
  sheet.addColorStop(1, rgba(SHEET_FOOT, 0.95));
  ctx.beginPath();
  trace(left);
  for (let k = STEPS; k >= 0; k--) ctx.lineTo(right[k][0], right[k][1]);
  ctx.closePath();
  ctx.fillStyle = sheet;
  ctx.fill();
  const [e0x, e0y] = left[STEPS >> 1];
  const [e1x, e1y] = right[STEPS >> 1];
  const across = ctx.createLinearGradient(e0x, e0y, e1x, e1y);
  across.addColorStop(0, rgba(SPRING_EDGE, 0.42));
  across.addColorStop(0.22, rgba(SPRING_EDGE, 0));
  across.addColorStop(0.78, rgba(SPRING_EDGE, 0));
  across.addColorStop(1, rgba(SPRING_EDGE, 0.42));
  ctx.fillStyle = across;
  ctx.fill();
  ctx.strokeStyle = rgba(SPRING_EDGE, 0.5);
  ctx.lineWidth = Math.max(0.6, 0.7 * z);
  ctx.stroke();

  const t = p.time;
  if (t !== null && z >= 0.5) {
    // The water in it running down, in streaks of light and of shade.
    for (let k = 0; k < 7; k++) {
      const light = k % 2 === 0;
      const along = n.t0 + (n.t1 - n.t0) * (0.1 + 0.133 * k);
      ctx.setLineDash(light ? [11 * z, 6 * z] : [15 * z, 9 * z]);
      ctx.lineDashOffset = -(t * (light ? 28 : 21) + hash3(p.x, p.y, k) * 11) * z;
      ctx.strokeStyle = light ? rgba(SPRING_PALE, 0.72) : rgba(SPRING_DARK, 0.34);
      ctx.lineWidth = Math.max(0.8, (light ? 1.1 : 1.5) * z);
      ctx.beginPath();
      trace(line(along));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  // The lip, round where it turns over the edge.
  const [l0x, l0y] = q(n.t0, top, 0.015);
  const [l1x, l1y] = q(n.t1, top, 0.015);
  ctx.strokeStyle = rgba(mixed(SPRING_PALE, SPRING_FOAM, 0.5), 0.95);
  ctx.lineWidth = Math.max(1.2, 2 * z);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(l0x, l0y);
  ctx.lineTo(l1x, l1y);
  ctx.stroke();
  ctx.lineCap = 'butt';

  if (n.onto || t === null) return;
  // A plume of froth at the foot, highest in the middle, and spray thrown out of it both ways.
  const plume = Math.min(4, 0.9 + drop * 0.1);
  const [hx, hy] = q(mid, foot(mid) + 0.6, 0.04);
  ctx.fillStyle = rgba(mixed(SPRING_PALE, SPRING_EDGE, 0.22), 0.5);
  ctx.beginPath();
  ctx.ellipse(hx, hy, 7 * z, 3 * z, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let k = 0; k < 9; k++) {
    const across = (k + 0.5) / 9;
    const bell = 1 - Math.abs(2 * across - 1);
    const along = n.t0 - 0.06 + (n.t1 - n.t0 + 0.12) * across;
    const pulse = 0.5 + 0.5 * Math.sin(t * 7 + k * 1.9 + p.x * 0.7 + p.y * 1.3);
    const [fx, fy] = q(along, foot(along) + 0.6 + plume * (0.3 + 0.7 * bell) * (0.8 + 0.2 * pulse), 0.04);
    ctx.fillStyle = rgba(SPRING_FOAM, 0.75 + 0.2 * pulse);
    ctx.beginPath();
    ctx.arc(fx, fy, (1.6 + 2.6 * bell + 0.8 * pulse) * z, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let k = 0; k < 10; k++) {
    const way = k % 2 ? 1 : -1;
    const phase = (t * 1.3 + hash3(p.x, p.y, 20 + k)) % 1;
    const along = mid + way * (0.1 + 0.45 * phase) * (n.t1 - n.t0 + 0.2);
    const [dx, dy] = q(along, foot(along) + 0.8 + Math.sin(phase * Math.PI) * plume * 1.4, 0.05 + 0.25 * phase);
    ctx.fillStyle = rgba(SPRING_FOAM, 0.75 * (1 - phase));
    ctx.beginPath();
    ctx.arc(dx, dy, Math.max(0.6, (1.1 - 0.4 * phase) * z), 0, Math.PI * 2);
    ctx.fill();
  }
}
