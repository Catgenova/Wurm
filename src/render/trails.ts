import { hash2, smoothstep } from '../world/noise';

/**
 * Worn paths, drawn.
 *
 * A trail is a tile of grass (or lawn, steppe, tundra, moss) that feet have
 * worn bare (`WEARS` in tiles.ts). Painted as the tile it is -- a lozenge of
 * sandy earth -- a line of them is a row of paving stones, broken at every
 * diagonal step, which is exactly what a path in the pictures is not. So the
 * tile is painted as the ground it was worn out of, and the path is drawn
 * across it: a band of bare earth running from the middle of the tile to the
 * middle of each edge it shares with another trail, curving where the path
 * turns, with the grass lying over its edges in lobes.
 *
 * ## One path out of many tiles
 *
 * Every tile works out its own part and nothing else, clipped to itself, and
 * the parts meet because everything that decides where a part meets its
 * neighbour belongs to the edge or the corner they share rather than to either
 * tile: where the band crosses an edge and how wide it is there are hashed off
 * the edge, and the band always crosses square to it. So a line of trails is
 * one band, and it wanders from side to side of the line as it goes.
 *
 * A step on the diagonal -- which is how people walk, and so how paths are
 * worn -- joins two tiles that share only a corner. The band goes through the
 * corner along the diagonal, and the two tiles either side of the corner, which
 * need not be trails at all, draw the wedge of it that crosses them. Which is
 * why every tile carries a mask (`trailMask`), not just the trails.
 *
 * Where four trails meet round a corner the quarter of each tile at that corner
 * is filled, so a yard people have trodden flat is bare all over rather than a
 * ring of path round a tuft of grass.
 *
 * ## Coordinates
 *
 * Everything here is worked out in the tile's own square, `u` along the
 * world's x and `v` along its y, nought to one, and mapped onto the screen by
 * the caller -- so the path holds still as the view comes round, and follows
 * the ground over a bank. The shapes depend only on where the tile is and on
 * its mask, so they are worked out once and kept (`trailShape`).
 */

/** The four sides a trail tile may share with another, in world terms: -y, +x, +y, -x. */
export const TRAIL_N = 1;
export const TRAIL_E = 2;
export const TRAIL_S = 4;
export const TRAIL_W = 8;
/**
 * A diagonal link at a corner, north-east, south-east, south-west, north-west.
 * On a trail: a trail across that corner with neither tile between them a
 * trail. On anything else: a link between the two tiles beside this one at
 * that corner, which passes over it.
 */
export const LINK_NE = 16;
export const LINK_SE = 32;
export const LINK_SW = 64;
export const LINK_NW = 128;
/** A corner of a trail all three other tiles round which are trails too: fill it. */
export const FILL_NE = 256;
export const FILL_SE = 512;
export const FILL_SW = 1024;
export const FILL_NW = 2048;
/** Whether this tile is a trail itself. */
export const IS_TRAIL = 4096;

/**
 * The mask for a tile, from whether it and each of the eight round it is a
 * trail: `at(dx, dy)`. Nought means nothing of any path is drawn on it.
 */
export function trailMask(at: (dx: number, dy: number) => boolean): number {
  const n = at(0, -1), e = at(1, 0), s = at(0, 1), w = at(-1, 0);
  const ne = at(1, -1), se = at(1, 1), sw = at(-1, 1), nw = at(-1, -1);
  if (at(0, 0)) {
    let m = IS_TRAIL;
    if (n) m |= TRAIL_N;
    if (e) m |= TRAIL_E;
    if (s) m |= TRAIL_S;
    if (w) m |= TRAIL_W;
    if (ne && !n && !e) m |= LINK_NE;
    if (se && !s && !e) m |= LINK_SE;
    if (sw && !s && !w) m |= LINK_SW;
    if (nw && !n && !w) m |= LINK_NW;
    if (n && e && ne) m |= FILL_NE;
    if (s && e && se) m |= FILL_SE;
    if (s && w && sw) m |= FILL_SW;
    if (n && w && nw) m |= FILL_NW;
    return m;
  }
  // Not a trail: only the links that cross one of its corners.
  let m = 0;
  if (n && e && !ne) m |= LINK_NE;
  if (s && e && !se) m |= LINK_SE;
  if (s && w && !sw) m |= LINK_SW;
  if (n && w && !nw) m |= LINK_NW;
  return m;
}

/* ---- where the band meets an edge or a corner ------------------------------ */

/** How far along an edge from its middle the band crosses it, either way, and how wide it is there (half). */
const CROSS_WANDER = 0.12;
const HALF_FROM = 0.2;
const HALF_SPREAD = 0.08;
/** The edge between (x, y - 1) and (x, y), lying along the world's x. */
const alongH = (x: number, y: number): number => (hash2(x, y, 5101) - 0.5) * 2 * CROSS_WANDER;
const halfH = (x: number, y: number): number => HALF_FROM + hash2(x, y, 5103) * HALF_SPREAD;
/** The edge between (x - 1, y) and (x, y), lying along the world's y. */
const alongV = (x: number, y: number): number => (hash2(x, y, 5107) - 0.5) * 2 * CROSS_WANDER;
const halfV = (x: number, y: number): number => HALF_FROM + hash2(x, y, 5109) * HALF_SPREAD;
/** A corner of the world grid a diagonal passes through. */
const halfK = (x: number, y: number): number => HALF_FROM + hash2(x, y, 5113) * HALF_SPREAD * 0.6;

/** Where the band leaves a tile: a point on its boundary, the way in, and its half-width there. */
interface Port { u: number; v: number; du: number; dv: number; half: number }

const R2 = Math.SQRT1_2;

/** The ports of a trail tile, off its mask, in the order N, E, S, W, NE, SE, SW, NW. */
function portsOf(x: number, y: number, m: number): Port[] {
  const out: Port[] = [];
  if (m & TRAIL_N) out.push({ u: 0.5 + alongH(x, y), v: 0, du: 0, dv: 1, half: halfH(x, y) });
  if (m & TRAIL_E) out.push({ u: 1, v: 0.5 + alongV(x + 1, y), du: -1, dv: 0, half: halfV(x + 1, y) });
  if (m & TRAIL_S) out.push({ u: 0.5 + alongH(x, y + 1), v: 1, du: 0, dv: -1, half: halfH(x, y + 1) });
  if (m & TRAIL_W) out.push({ u: 0, v: 0.5 + alongV(x, y), du: 1, dv: 0, half: halfV(x, y) });
  if (m & LINK_NE) out.push({ u: 1, v: 0, du: -R2, dv: R2, half: halfK(x + 1, y) });
  if (m & LINK_SE) out.push({ u: 1, v: 1, du: -R2, dv: -R2, half: halfK(x + 1, y + 1) });
  if (m & LINK_SW) out.push({ u: 0, v: 1, du: R2, dv: -R2, half: halfK(x, y + 1) });
  if (m & LINK_NW) out.push({ u: 0, v: 0, du: R2, dv: R2, half: halfK(x, y) });
  return out;
}

/* ---- the shapes ----------------------------------------------------------- */

/**
 * What is drawn on one tile, in its own square: the bare earth as closed
 * polygons (u, v pairs, all turning the same way so one fill is their union),
 * and the lobes of grass along its edges as (u, v, size) triples, size a share
 * of the lobe the caller draws.
 */
export interface TrailShape {
  polys: Float32Array[];
  lobes: Float32Array;
}

/** How far the band carries straight on from a port before it bends: a share of the tile. */
const REACH = 0.36;
/** And from a corner, which is further from the middle of the tile. */
const REACH_CORNER = 0.44;
/** Points a side of a band is drawn with. */
const STEPS = 10;

type Pt = [number, number];

/** A point and its tangent on the cubic p0 p1 p2 p3 at t. */
function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): [number, number, number, number] {
  const a = 1 - t;
  const x = a * a * a * p0[0] + 3 * a * a * t * p1[0] + 3 * a * t * t * p2[0] + t * t * t * p3[0];
  const y = a * a * a * p0[1] + 3 * a * a * t * p1[1] + 3 * a * t * t * p2[1] + t * t * t * p3[1];
  let dx = 3 * a * a * (p1[0] - p0[0]) + 6 * a * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]);
  let dy = 3 * a * a * (p1[1] - p0[1]) + 6 * a * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]);
  const l = Math.hypot(dx, dy) || 1;
  dx /= l;
  dy /= l;
  return [x, y, dx, dy];
}

/** Signed area of a polygon of (u, v) pairs, for turning them all one way. */
function area(p: number[]): number {
  let s = 0;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) s += (p[j] - p[i]) * (p[j + 1] + p[i + 1]);
  return s;
}

/**
 * How far a piece of path is carried past the edge of its tile: under the
 * piece the tile beside it draws, which is the same path in the same place.
 * Stopped exactly on the edge, the next tile's outline -- stroked in its own
 * ground's colour, half of it on this tile -- lay across the path at every
 * tile as a thread of grass.
 */
const BLEED = 0.03;

/** A polygon, turned the one way and carried past the tile's edge wherever it lies on it, as a typed array. */
function closed(p: number[]): Float32Array {
  for (let i = 0; i < p.length; i += 2) {
    if (p[i] <= 0.0005) p[i] -= BLEED;
    else if (p[i] >= 0.9995) p[i] += BLEED;
    if (p[i + 1] <= 0.0005) p[i + 1] -= BLEED;
    else if (p[i + 1] >= 0.9995) p[i + 1] += BLEED;
  }
  if (area(p) < 0) {
    const r: number[] = [];
    for (let i = p.length - 2; i >= 0; i -= 2) r.push(p[i], p[i + 1]);
    return new Float32Array(r);
  }
  return new Float32Array(p);
}

/**
 * A length of band along a cubic, its half-width easing from one end's to the
 * other's and wandering a little between, never at the ends -- which are
 * where it meets the next tile's, and must be exactly what that tile says.
 * `capEnd` rounds off the far end, for a path that stops.
 *
 * The edges of the band are pushed onto `edges` as runs of (u, v, side) for
 * the lobes, the side pointing out of the band.
 */
function band(p0: Pt, p1: Pt, p2: Pt, p3: Pt, h0: number, h1: number, wob: number, capEnd: boolean, edges: number[][]): Float32Array {
  const left: number[] = [];
  const right: number[] = [];
  const le: number[] = [];
  const re: number[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const [x, y, dx, dy] = cubic(p0, p1, p2, p3, t);
    const ease = t * t * (3 - 2 * t);
    const h = h0 + (h1 - h0) * ease + Math.sin(Math.PI * t) * wob * Math.sin(t * 9.4 + wob * 40);
    const nx = -dy, ny = dx;
    left.push(x + nx * h, y + ny * h);
    right.push(x - nx * h, y - ny * h);
    le.push(x + nx * h, y + ny * h, nx, ny);
    re.push(x - nx * h, y - ny * h, -nx, -ny);
  }
  const poly = [...left];
  if (capEnd) {
    // Half a circle round the end, from the left side to the right.
    const [cx, cy, dx, dy] = cubic(p0, p1, p2, p3, 1);
    const h = h1;
    const a0 = Math.atan2(dx, -dy);
    for (let k = 1; k < 6; k++) {
      const a = a0 - (Math.PI * k) / 6;
      poly.push(cx + Math.cos(a) * h, cy + Math.sin(a) * h);
      le.push(cx + Math.cos(a) * h, cy + Math.sin(a) * h, Math.cos(a), Math.sin(a));
    }
  }
  for (let i = right.length - 2; i >= 0; i -= 2) poly.push(right[i], right[i + 1]);
  edges.push(le, re);
  return closed(poly);
}

/** A round patch of bare earth: a hub where paths meet, or a spot trodden bare on its own. */
function patch(cx: number, cy: number, r: number, seed: number, edges: number[][]): Float32Array {
  const p: number[] = [];
  const e: number[] = [];
  const n = 14;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const rr = r * (1 + 0.1 * Math.sin(a * 3 + seed * 6.3) + 0.06 * Math.sin(a * 5 + seed * 11));
    p.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    e.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, Math.cos(a), Math.sin(a));
  }
  e.push(e[0], e[1], e[2], e[3]);
  edges.push(e);
  return closed(p);
}

/** Whether a point lies inside a polygon of (u, v) pairs. */
function inside(poly: Float32Array, u: number, v: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const ui = poly[i], vi = poly[i + 1], uj = poly[j], vj = poly[j + 1];
    if ((vi > v) !== (vj > v) && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) hit = !hit;
  }
  return hit;
}

/** How far apart the lobes along a band's edge are, in the tile's own units. */
const LOBE_EVERY = 0.06;
/**
 * Where along a path the grass lies over its edge and where the edge is
 * clean: under `EDGE_CLEAN` of `overgrown` no lobes, over `EDGE_THICK` bigger
 * ones further out. Set by where on the map the edge runs, so it carries on
 * from one tile into the next.
 */
const EDGE_CLEAN = 0.3;
const EDGE_THICK = 0.7;

/** Value noise over the map, smooth over a tile and a half: how overgrown a path's edge is there. */
function overgrown(x: number, y: number): number {
  const s = 1 / 1.5;
  const gx = Math.floor(x * s), gy = Math.floor(y * s);
  const fx = x * s - gx, fy = y * s - gy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(gx, gy, 5171), b = hash2(gx + 1, gy, 5171);
  const c = hash2(gx, gy + 1, 5171), d = hash2(gx + 1, gy + 1, 5171);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

/**
 * The shapes on one tile, off where it is and its mask. Pure, and kept by the
 * caller: the same tile with the same mask is always the same shapes.
 */
export function trailShape(x: number, y: number, m: number): TrailShape {
  const polys: Float32Array[] = [];
  const edges: number[][] = [];
  if (m & IS_TRAIL) {
    const ports = portsOf(x, y, m);
    const c: Pt = [0.5 + (hash2(x, y, 5117) - 0.5) * 0.16, 0.5 + (hash2(x, y, 5119) - 0.5) * 0.16];
    const hub = 0.22 + hash2(x, y, 5121) * 0.06;
    const wob = (hash2(x, y, 5123) - 0.5) * 0.06;
    const reach = (p: Port): number => (p.du !== 0 && p.dv !== 0 ? REACH_CORNER : REACH);
    const from = (p: Port): [Pt, Pt] => [[p.u, p.v], [p.u + p.du * reach(p), p.v + p.dv * reach(p)]];
    // Coming in to the middle from a port: aimed at it from a little way back
    // along the way in, so the end has a direction to be rounded off across.
    const into = (p1: Pt): Pt => [c[0] + (p1[0] - c[0]) * 0.3, c[1] + (p1[1] - c[1]) * 0.3];
    if (ports.length === 0) {
      // Trodden bare on its own: a worn spot.
      polys.push(patch(c[0], c[1], 0.22 + hash2(x, y, 5125) * 0.06, hash2(x, y, 5127), edges));
    } else if (ports.length === 1) {
      // A path that stops: in from its side, rounded off near the middle.
      const [p0, p1] = from(ports[0]);
      polys.push(band(p0, p1, into(p1), c, ports[0].half, hub * 0.9, wob, true, edges));
    } else if (ports.length === 2) {
      // Through: one curve from one side to the other, bent round the middle.
      const [a0, a1] = from(ports[0]);
      const [b0, b1] = from(ports[1]);
      polys.push(band(a0, a1, b1, b0, ports[0].half, ports[1].half, wob, false, edges));
    } else {
      // Where paths meet: each in to the middle, and the middle trodden round.
      for (const p of ports) {
        const [p0, p1] = from(p);
        polys.push(band(p0, p1, into(p1), c, p.half, hub, wob, false, edges));
      }
      polys.push(patch(c[0], c[1], hub * 1.15, hash2(x, y, 5129), edges));
    }
    // And the quarters of a yard trodden flat, from each full corner to the middle.
    const quarter = (fill: number, ku: number, kv: number, pa: Port | undefined, pb: Port | undefined): void => {
      if (!(m & fill) || !pa || !pb) return;
      polys.push(closed([ku, kv, pa.u, pa.v, c[0], c[1], pb.u, pb.v]));
    };
    const byDir = (du: number, dv: number): Port | undefined => ports.find((p) => p.du === du && p.dv === dv);
    const N = byDir(0, 1), E = byDir(-1, 0), S = byDir(0, -1), W = byDir(1, 0);
    quarter(FILL_NE, 1, 0, N, E);
    quarter(FILL_SE, 1, 1, E, S);
    quarter(FILL_SW, 0, 1, S, W);
    quarter(FILL_NW, 0, 0, W, N);
  } else {
    /*
     * The wedge of a diagonal link that crosses a corner of this tile: a
     * straight band along the diagonal through the corner, as wide as the
     * corner says, of which only the part inside this tile will show.
     */
    const wedge = (ku: number, kv: number, du: number, dv: number, half: number): void => {
      const L = 0.5;
      const nx = -dv, ny = du;
      polys.push(closed([
        ku - du * L + nx * half, kv - dv * L + ny * half,
        ku + du * L + nx * half, kv + dv * L + ny * half,
        ku + du * L - nx * half, kv + dv * L - ny * half,
        ku - du * L - nx * half, kv - dv * L - ny * half,
      ]));
      // Its one edge inside this tile, for the lobes: the side facing the tile's middle.
      const toward = (0.5 - ku) * nx + (0.5 - kv) * ny > 0 ? 1 : -1;
      const e: number[] = [];
      for (let k = -3; k <= 3; k++) {
        const t = (k / 3) * half * 1.6;
        e.push(ku + du * t + nx * half * toward, kv + dv * t + ny * half * toward, nx * toward, ny * toward);
      }
      edges.push(e);
    };
    // A link across the north-east corner joins the tiles north and east of this one: it runs along (1, 1).
    if (m & LINK_NE) wedge(1, 0, R2, R2, halfK(x + 1, y));
    if (m & LINK_SE) wedge(1, 1, R2, -R2, halfK(x + 1, y + 1));
    if (m & LINK_SW) wedge(0, 1, R2, R2, halfK(x, y + 1));
    if (m & LINK_NW) wedge(0, 0, R2, -R2, halfK(x, y));
  }
  /*
   * The lobes of grass along the edges of the band: every so often along each
   * edge, set a little out from it onto the grass, and only where that is not
   * inside another piece of the same path -- where two arms meet, the edge of
   * one runs through the middle of the other, and a tuft of grass there is a
   * tuft of grass in the middle of the path.
   */
  const lobes: number[] = [];
  let k = 0;
  for (const e of edges) {
    // Half a step in from where the edge starts, so the lobes either side of
    // a tile's edge are a step apart like all the rest, with no gap between.
    let run = LOBE_EVERY / 2;
    for (let i = 4; i < e.length; i += 4) {
      const du = e[i] - e[i - 4], dv = e[i + 1] - e[i - 3];
      const step = Math.hypot(du, dv);
      run += step;
      while (run >= LOBE_EVERY) {
        run -= LOBE_EVERY;
        const f = 1 - run / (step || 1);
        const u = e[i - 4] + du * f, v = e[i - 3] + dv * f;
        k++;
        // A clean stretch of edge, or an overgrown one, the lobes dwindling into the one and swelling into the other.
        const o = overgrown(x + u, y + v);
        const grow = smoothstep(EDGE_CLEAN, EDGE_CLEAN + 0.14, o);
        if (grow < 0.05) continue;
        const thick = (1 + 0.4 * smoothstep(EDGE_THICK - 0.08, EDGE_THICK + 0.08, o)) * (0.3 + 0.7 * grow);
        const out = (0.034 + hash2(x * 31 + k, y * 17 - k, 5131) * 0.02) * thick;
        const lu = u + e[i + 2] * out, lv = v + e[i + 3] * out;
        // Only on this tile: the next one lays its own along the same edge, and nothing cuts them to the tile.
        if (lu < 0 || lu > 1 || lv < 0 || lv > 1) continue;
        let buried = false;
        for (const p of polys) if (inside(p, lu, lv)) buried = true;
        if (buried) continue;
        lobes.push(lu, lv, (0.8 + hash2(x * 13 + k, y * 7 + k, 5137) * 0.45) * thick);
      }
    }
  }
  return { polys, lobes: new Float32Array(lobes) };
}
