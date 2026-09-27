/**
 * Springs, and the ponds and streams their water makes above the sea.
 *
 * The sea is wherever the ground is below nothing (`World.hasWater`). A spring
 * is water rising somewhere higher. Dug at the bottom of a hollow, it fills the
 * hollow to the height of its lowest lip, runs over that lip and on down the
 * slope to the next hollow, fills that in its turn, and so on until it reaches
 * the sea, runs further than a spring's water carries, or comes to a hollow
 * too wide for it ever to fill. Hollows dug one below the next down a hillside
 * are a stream of ponds, and a lip over a drop is a waterfall.
 *
 * Nothing here moves in time. Where the water stands is worked out from the
 * shape of the ground once, when the spring is dug and again whenever the
 * ground under or around its water changes, by the same steps on both sides
 * (`settle_spring` on the island), and kept. The water rising, the streams
 * running and the falls falling are drawn from that and the clock.
 *
 * Every step is taken in one order on both sides, so both arrive at the same
 * water. A corner's neighbours are looked at above, left, right and below.
 * Filling a hollow takes the lowest corner next to the water first and, of
 * corners the same height, the one reached first, so that water on level
 * ground spreads out from where it came in and finds the nearest way down
 * rather than the first in the row. Running downhill takes the lowest
 * neighbour lower than where the water is, and the first by row and column
 * (`y`, then `x`) among equals.
 */

/** How far from the spring its water is followed, in corners either way. */
export const SPRING_REACH = 40;
/** The most corners one pond spreads over, about 24 by 24: a hollow wider than that a spring never fills. */
export const POND_MOST = 576;
/** The most ponds one spring fills, its own included. */
export const CHAIN_MOST = 12;
/** The furthest a stream runs between two ponds, in corners. */
export const RUN_MOST = 60;
/** How deep the hollow a spring is dug in must be before it holds a pond, in height units (a tenth of a metre each). */
export const SPRING_DEPTH = 3;
/** How many springs one person may keep at once. */
export const SPRINGS_EACH = 4;
/** How fast a filling pond rises, in height units a second. */
export const FILL_RATE = 2;
/** How fast water runs down a stream from one pond to the next, in corners a second. */
export const RUN_RATE = 4;
/** A step down a stream at least this tall, in height units, is drawn falling rather than running. */
export const FALL_DROP = 15;
/** How far below a foundation's top the floor of a pool dug in it lies, in height units. */
export const POOL_DEPTH = 20;
/** How far below a foundation's top a pool's water stands: the lip of concrete left round it. */
export const POOL_LIP = 2;

/** Where a pool dug in a foundation poured to \`top\` has its water, and its floor. */
export const poolLevel = (top: number): number => top - POOL_LIP;
export const poolFloor = (top: number): number => top - POOL_DEPTH;

/** A poured foundation, as water sees it: how high its top is, and whether a pool is dug in it. */
export interface Slab {
  top: number;
  pool: boolean;
}
/** The poured foundation on a tile, or null. */
export type SlabAt = (tx: number, ty: number) => Slab | null;

/** One pond: a hollow filled to the lip it spills over. Corners are x, y pairs. */
export interface Pond {
  /** The height its surface stands at. */
  level: number;
  /** The height of the lowest ground under it. */
  floor: number;
  /** The corners under water, as x, y pairs, in order of y and then x. */
  wet: number[];
  /** The corner at the lip it spills over, and the lower corner beyond it the water goes over into. */
  lip: [number, number];
  over: [number, number];
  /**
   * A pool dug in foundations rather than a hollow in the ground: the tiles
   * of it, as x, y pairs in order of y and then x. Its water stands over the
   * whole of each at \`level\` and \`wet\` is empty.
   */
  tiles?: number[];
  /**
   * Where a pool's water goes over its edge: the two corners of the edge, and
   * how high what it falls to stands, the ground at the foot of the slab or a
   * pool below. A pool with nowhere lower beside it keeps its water, and
   * has none.
   */
  spill?: { edge: [number, number, number, number]; to: number };
}

/** Water running from one pond to where it goes next. */
export interface Stream {
  /** The pond it runs out of, by its place in `Chain.ponds`. */
  from: number;
  /** The corners it runs over, from the lip down, as x, y pairs. */
  path: number[];
  /** Where it ends: the pond it runs into, the sea, or nowhere (it soaks away into the ground). */
  to: number | 'sea' | 'lost';
}

/** Everything one spring's water does. */
export interface Chain {
  ponds: Pond[];
  streams: Stream[];
  /** The corners the settling looked at, as the lowest and highest x and y: a change to the ground outside them changes nothing. */
  box: [number, number, number, number];
}

/**
 * Why a spring cannot be dug somewhere, or goes: the hollow holds less than
 * `SPRING_DEPTH`, or is wider than `POND_MOST` corners and would never fill,
 * or a foundation with no pool in it has been poured over it.
 */
export type SpringRefusal = 'flat' | 'wide' | 'buried';

/** The corner a spring dug in a tile rises at: its lowest, the first by row and column among equals. */
export function springCorner(height: (x: number, y: number) => number, tx: number, ty: number): [number, number] {
  let bx = tx, by = ty, bh = height(tx, ty);
  for (const [x, y] of [[tx + 1, ty], [tx, ty + 1], [tx + 1, ty + 1]] as const) {
    const v = height(x, y);
    if (v < bh || (v === bh && (y < by || (y === by && x < bx)))) {
      bx = x;
      by = y;
      bh = v;
    }
  }
  return [bx, by];
}

/**
 * The corners a spring's water covers and runs over, from the ground.
 *
 * `height` answers for a corner on the map and null for one off it. The
 * water is followed within `SPRING_REACH` corners of the spring either way;
 * past that, and past the edge of the map, is treated as ground it cannot get
 * over.
 *
 * A pond is found by filling from its lowest corner: of the corners next to
 * the water, the lowest is taken next (the one reached first among equals),
 * and taking one higher than the water raises the water to it. The first corner found lower than the water is
 * where it spills, and the pond's level is where the water stood then. From
 * there the stream runs to the lowest neighbour lower than where it is,
 * again and again, to the sea or to a hollow, which is filled the same way.
 * Running into water this spring has already made ends it: the stream runs
 * into that pond and nothing is filled twice.
 *
 * A spring dug in a pool (\`slabs\` says which tiles are poured foundations,
 * and \`tile\` is the tile it was dug in) begins with the pool rather than a
 * hollow: every pool beside it poured to the same top is one pool, full to
 * \`POOL_LIP\` under its top. Its water goes over the edge with the lowest
 * thing beyond it -- the ground at the foot of the slab, or a pool below --
 * the first by row and column and then above, left, right and below among
 * equals, and on from there: into the pool below and over its edge in turn,
 * or down the ground as any stream runs. A foundation with no pool in it is a
 * wall. A pool with nothing lower beside it keeps its water.
 */
export function settleChain(
  height: (x: number, y: number) => number | null, sx: number, sy: number, slabs?: SlabAt, tile?: [number, number],
): Chain | SpringRefusal {
  const R = SPRING_REACH;
  const W = 2 * R + 1;
  const x0 = sx - R;
  const y0 = sy - R;
  const n = W * W;
  const h = new Int32Array(n);
  const on = new Uint8Array(n);
  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      const v = height(x0 + i, y0 + j);
      if (v !== null) {
        h[j * W + i] = v;
        on[j * W + i] = 1;
      }
    }
  }
  let lo = [R, R];
  let hi = [R, R];
  const look = (k: number): void => {
    const i = k % W;
    const j = (k - i) / W;
    if (i < lo[0]) lo = [i, lo[1]];
    if (j < lo[1]) lo = [lo[0], j];
    if (i > hi[0]) hi = [i, hi[1]];
    if (j > hi[1]) hi = [hi[0], j];
  };
  const around: number[] = [];
  /** The neighbours of a corner the water may reach, above, left, right and below. */
  const next = (k: number): number[] => {
    around.length = 0;
    const i = k % W;
    if (k >= W && on[k - W]) around.push(k - W);
    if (i > 0 && on[k - 1]) around.push(k - 1);
    if (i < W - 1 && on[k + 1]) around.push(k + 1);
    if (k < n - W && on[k + W]) around.push(k + W);
    return around;
  };
  const pushed = new Int32Array(n);
  const parent = new Int32Array(n);
  let round = 0;
  const heap = new CornerHeap(h, n);

  /** A pond filled from one corner: its level, the corners under it, and where it spills. */
  const fill = (seed: number): { level: number; cells: number[]; over: number; lip: number } | 'wide' => {
    round++;
    heap.clear();
    let level = h[seed];
    const cells = [seed];
    pushed[seed] = round;
    look(seed);
    for (const m of next(seed)) {
      pushed[m] = round;
      parent[m] = seed;
      heap.push(m);
      look(m);
    }
    while (heap.size) {
      const c = heap.pop();
      if (h[c] < level) return { level, cells, over: c, lip: parent[c] };
      if (h[c] > level) level = h[c];
      cells.push(c);
      if (cells.length > POND_MOST) return 'wide';
      for (const m of next(c)) {
        if (pushed[m] === round) continue;
        pushed[m] = round;
        parent[m] = c;
        heap.push(m);
        look(m);
      }
    }
    // Walled in on every side by what is not followed: it would never fill.
    return 'wide';
  };
  /** The lowest neighbour lower than a corner, the first by row and column among equals, or -1 at the bottom of a hollow. */
  const downhill = (k: number): number => {
    let best = -1;
    for (const m of next(k)) {
      look(m);
      if (h[m] >= h[k]) continue;
      if (best < 0 || h[m] < h[best] || (h[m] === h[best] && m < best)) best = m;
    }
    return best;
  };
  const xy = (k: number): [number, number] => {
    const i = k % W;
    return [x0 + i, y0 + (k - i) / W];
  };
  const pairs = (ks: number[]): number[] => ks.flatMap(xy);

  /** Which pond of this spring's a corner is under (one more than its place), or which stream runs over it (minus one more than its place). */
  const own = new Int32Array(n);
  const ponds: Pond[] = [];
  const streams: Stream[] = [];
  const at = (p: [number, number]): number => (p[1] - y0) * W + (p[0] - x0);
  /** A hollow filled from its lowest corner: a pond, level ground the water only crosses, or one too wide to fill. */
  type Hollow = { kind: 'pond'; pond: Pond; wet: number[] } | { kind: 'level'; lip: number; over: number } | { kind: 'wide' };
  const pond = (seed: number): Hollow => {
    const r = fill(seed);
    if (r === 'wide') return { kind: 'wide' };
    const wet = r.cells.filter((c) => h[c] < r.level).sort((a, b) => a - b);
    if (!wet.length) return { kind: 'level', lip: r.lip, over: r.over };
    let floor = r.level;
    for (const c of wet) if (h[c] < floor) floor = h[c];
    return { kind: 'pond', pond: { level: r.level, floor, wet: pairs(wet), lip: xy(r.lip), over: xy(r.over) }, wet };
  };
  /** Whether a tile's four corners are all inside the window. */
  const inWindow = (tx: number, ty: number): boolean => tx >= x0 && ty >= y0 && tx + 1 < x0 + W && ty + 1 < y0 + W;
  /**
   * A pool and every pool joined to it poured to the same top, as x, y pairs
   * in order of y and then x: a pool is one body of water however many
   * foundations it was dug in.
   */
  const basin = (tx: number, ty: number, top: number): Array<[number, number]> => {
    const seen = new Set<number>([ty * 100000 + tx]);
    const queue: Array<[number, number]> = [[tx, ty]];
    for (let i = 0; i < queue.length && queue.length <= POND_MOST; i++) {
      const [qx, qy] = queue[i];
      look(at([qx, qy]));
      look(at([qx + 1, qy + 1]));
      for (const [nx, ny] of [[qx, qy - 1], [qx - 1, qy], [qx + 1, qy], [qx, qy + 1]] as const) {
        if (!inWindow(nx, ny) || seen.has(ny * 100000 + nx)) continue;
        seen.add(ny * 100000 + nx);
        const s = slabs!(nx, ny);
        if (s?.pool && s.top === top) queue.push([nx, ny]);
      }
    }
    return queue.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  };
  /**
   * Where a pool's water goes over: the edge with the lowest thing beyond
   * it, and whether that is a pool (the tile of it) or the ground (the lower
   * corner of the edge, which it falls to). Null for a pool with nothing
   * lower than its water on any side.
   */
  type Outlet = { edge: [number, number, number, number]; to: number; pool?: [number, number]; foot?: [number, number] };
  const outlet = (tiles: Array<[number, number]>, level: number): Outlet | null => {
    const mine = new Set(tiles.map(([x, y]) => y * 100000 + x));
    let best: Outlet | null = null;
    for (const [tx, ty] of tiles) {
      const sides: Array<[number, number, number, number, number, number]> = [
        [tx, ty - 1, tx, ty, tx + 1, ty],
        [tx - 1, ty, tx, ty, tx, ty + 1],
        [tx + 1, ty, tx + 1, ty, tx + 1, ty + 1],
        [tx, ty + 1, tx, ty + 1, tx + 1, ty + 1],
      ];
      for (const [nx, ny, ax, ay, bx, by] of sides) {
        if (mine.has(ny * 100000 + nx) || !inWindow(nx, ny)) continue;
        const s = slabs!(nx, ny);
        let got: Outlet | null = null;
        if (s) {
          // A foundation is a wall, unless there is a pool in it lower than this one.
          if (s.pool && poolLevel(s.top) < level) got = { edge: [ax, ay, bx, by], to: poolLevel(s.top), pool: [nx, ny] };
        } else {
          const ka = at([ax, ay]);
          const kb = at([bx, by]);
          look(ka);
          look(kb);
          if (!on[ka] || !on[kb]) continue;
          const foot: [number, number] = h[kb] < h[ka] ? [bx, by] : [ax, ay];
          const drop = Math.min(h[ka], h[kb]);
          if (drop < level) got = { edge: [ax, ay, bx, by], to: drop, foot };
        }
        if (got && (!best || got.to < best.to)) best = got;
      }
    }
    return best;
  };
  const stream = (from: number, path: number[], to: Stream['to']): void => {
    streams.push({ from, path: pairs(path), to });
    for (const k of path) if (own[k] === 0) own[k] = -streams.length;
  };

  const box = (): [number, number, number, number] => [x0 + lo[0], y0 + lo[1], x0 + hi[0], y0 + hi[1]];
  let from: number;
  let path: number[];
  let c: number;
  const pool = slabs && tile ? slabs(tile[0], tile[1]) : null;
  if (pool && !pool.pool) return 'buried';
  if (pool?.pool) {
    // Pool to pool, down to the one whose water goes over onto the ground, or keeps it.
    let tx = tile![0], ty = tile![1], top = pool.top;
    for (;;) {
      const tiles = basin(tx, ty, top);
      const out = outlet(tiles, poolLevel(top));
      const k = ponds.length;
      const [ex, ey] = out ? [out.edge[0], out.edge[1]] : [tx, ty];
      ponds.push({
        level: poolLevel(top), floor: poolFloor(top), wet: [], lip: [ex, ey], over: out?.foot ?? [ex, ey], tiles: tiles.flat(),
        ...(out ? { spill: { edge: out.edge, to: out.to } } : {}),
      });
      if (!out) return { ponds, streams, box: box() };
      if (out.pool) {
        if (ponds.length >= CHAIN_MOST) {
          streams.push({ from: k, path: [ex, ey], to: 'lost' });
          return { ponds, streams, box: box() };
        }
        streams.push({ from: k, path: [ex, ey], to: k + 1 });
        [tx, ty] = out.pool;
        top = out.to + POOL_LIP;
        continue;
      }
      from = k;
      path = [at(out.foot!)];
      c = path[0];
      break;
    }
  } else {
    const first = pond((sy - y0) * W + (sx - x0));
    if (first.kind === 'wide') return 'wide';
    if (first.kind !== 'pond' || first.pond.level - first.pond.floor < SPRING_DEPTH) return 'flat';
    ponds.push(first.pond);
    for (const k of first.wet) own[k] = 1;
    from = 0;
    path = [at(first.pond.lip), at(first.pond.over)];
    c = path[1];
  }
  for (;;) {
    let to: Stream['to'] | null = null;
    // Down the slope, to the sea, into water already made, or to the bottom of a hollow.
    for (;;) {
      if (h[c] < 0) to = 'sea';
      else if (own[c] > 0) to = own[c] - 1;
      else if (own[c] < 0) to = streams[-own[c] - 1].to;
      if (to !== null) break;
      const d = downhill(c);
      if (d < 0) break;
      path.push(d);
      c = d;
      if (path.length > RUN_MOST) {
        to = 'lost';
        break;
      }
    }
    if (to === null) {
      const got: Hollow = ponds.length >= CHAIN_MOST ? { kind: 'wide' } : pond(c);
      if (got.kind === 'wide') to = 'lost';
      else if (got.kind === 'level') {
        // Level ground: the water crosses it to where it goes over the edge, and runs on down from there.
        const across: number[] = [];
        for (let k = got.lip; k !== c; k = parent[k]) across.push(k);
        path.push(...across.reverse(), got.over);
        c = got.over;
        if (path.length > RUN_MOST) to = 'lost';
        else continue;
      } else {
        const k = ponds.length;
        stream(from, path, k);
        ponds.push(got.pond);
        for (const w of got.wet) own[w] = k + 1;
        from = k;
        path = [at(got.pond.lip), at(got.pond.over)];
        c = path[1];
        continue;
      }
    }
    stream(from, path, to as Stream['to']);
    break;
  }
  return { ponds, streams, box: box() };
}

/** A heap of corners, the lowest first and, among equals, the one put in first. */
class CornerHeap {
  private a: number[] = [];
  private readonly order: Int32Array;
  private count = 0;
  constructor(private readonly h: Int32Array, n: number) {
    this.order = new Int32Array(n);
  }
  get size(): number {
    return this.a.length;
  }
  clear(): void {
    this.a.length = 0;
    this.count = 0;
  }
  private less(p: number, q: number): boolean {
    const hp = this.h[p];
    const hq = this.h[q];
    return hp < hq || (hp === hq && this.order[p] < this.order[q]);
  }
  push(k: number): void {
    const a = this.a;
    this.order[k] = this.count++;
    a.push(k);
    let i = a.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (!this.less(a[i], a[up])) break;
      [a[i], a[up]] = [a[up], a[i]];
      i = up;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0];
    const last = a.pop() as number;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

/** The tiles a pond covers: every tile with one of its corners under water, as x, y pairs, in order of y and then x. */
export function pondTiles(wet: number[], w: number, h: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (let i = 0; i < wet.length; i += 2) {
    for (const [x, y] of [[wet[i] - 1, wet[i + 1] - 1], [wet[i], wet[i + 1] - 1], [wet[i] - 1, wet[i + 1]], [wet[i], wet[i + 1]]]) {
      if (x < 0 || y < 0 || x >= w || y >= h || seen.has(y * w + x)) continue;
      seen.add(y * w + x);
      out.push(x, y);
    }
  }
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < out.length; i += 2) pairs.push([out[i], out[i + 1]]);
  pairs.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return pairs.flat();
}

/** One pond as it is drawn and asked about: where it is, and how it rises to where it stands. */
export interface PondWater {
  /** The spring it is of, and its place in that spring's chain. */
  spring: number;
  index: number;
  level: number;
  floor: number;
  /** Its corners under water, by `y * (map width + 1) + x`. */
  wet: Set<number>;
  lip: [number, number];
  over: [number, number];
  /**
   * The level it was at when it started to rise (or fall) to `level`, and
   * when, in milliseconds of the wall clock: a new pond rises from its floor,
   * one the ground has been changed under goes from where it stood to where
   * it stands now. Only drawn: to every rule it is at `level`.
   */
  from: number;
  since: number;
}

/** A stream as it is drawn: from the lip of one pond down to where it goes, running from when that pond is full. */
export interface StreamWater {
  spring: number;
  from: number;
  path: number[];
  to: Stream['to'];
  since: number;
}

/** When a pond that rises from `from` at `since` stands at its level. */
export const pondFull = (p: Pick<PondWater, 'from' | 'level' | 'since'>): number =>
  p.since + (Math.abs(p.level - p.from) / FILL_RATE) * 1000;

/** Where a pond's surface stands at a moment of the wall clock, for drawing it rising. */
export function pondLevelAt(p: Pick<PondWater, 'from' | 'level' | 'since'>, now: number): number {
  const gone = Math.max(0, now - p.since) / 1000;
  const by = Math.min(Math.abs(p.level - p.from), gone * FILL_RATE);
  return p.level >= p.from ? p.from + by : p.from - by;
}

/**
 * The ponds and streams on the map, and which tiles each pond covers.
 *
 * Kept by the tile rather than asked of every pond, because the questions are
 * asked of one tile at a time and very often (`World.hasWater` is asked by
 * every rule that cares what is underfoot). Only tiles with a pond on them
 * are kept.
 */
export class WaterField {
  ponds: PondWater[] = [];
  streams: StreamWater[] = [];
  private byTile = new Map<number, PondWater[]>();
  /** The pools dug in foundations, by tile: water whether or not a spring rises in them. */
  private pools = new Map<number, { level: number; floor: number }>();
  /** Where a spring's water goes over the edge of a pool, by the tile of the pool the edge is on (\`spillsAt\`). */
  private spills = new Map<number, Spill[]>();

  constructor(private readonly w: number, private readonly h: number) {}

  get size(): number {
    return this.ponds.length + this.pools.size;
  }

  /** Lay the pools down afresh: every foundation with a pool dug in it, by its tile and its top. */
  setPools(pools: Iterable<{ x: number; y: number; top: number }>): void {
    this.pools.clear();
    for (const p of pools) this.pools.set(p.y * this.w + p.x, { level: poolLevel(p.top), floor: poolFloor(p.top) });
  }

  /**
   * Where water goes over the edges of pools: every pool a spring's water
   * fills, with the edge it spills over, filed under the tile of the pool that
   * edge is on so the slab drawing that tile finds its own.
   */
  setSpills(pools: Iterable<Pond>): void {
    this.spills.clear();
    for (const p of pools) {
      if (!p.tiles || !p.spill) continue;
      const [ax, ay, bx, by] = p.spill.edge;
      // Across the top or bottom of a tile, or down its side: the edge's tile is whichever of the two beside it is the pool's.
      const sides: Array<[number, number]> = ay === by ? [[ax, ay - 1], [ax, ay]] : [[ax - 1, ay], [ax, ay]];
      for (const [tx, ty] of sides) {
        let mine = false;
        for (let k = 0; k < p.tiles.length && !mine; k += 2) mine = p.tiles[k] === tx && p.tiles[k + 1] === ty;
        if (!mine) continue;
        const key = ty * this.w + tx;
        const here = this.spills.get(key);
        const spill: Spill = { edge: [ax, ay, bx, by], from: p.level, to: p.spill.to };
        if (here) here.push(spill);
        else this.spills.set(key, [spill]);
        break;
      }
    }
  }

  /** Every tile with a pool dug in it, as `y * width + x`. */
  poolTiles(): Iterable<number> {
    return this.pools.keys();
  }

  /** The water going over the edges of the pool dug in a tile, none on most. */
  spillsAt(x: number, y: number): readonly Spill[] {
    return this.spills.get(y * this.w + x) ?? NO_SPILLS;
  }

  /** Lay the water down afresh. */
  set(ponds: PondWater[], streams: StreamWater[]): void {
    this.ponds = ponds;
    this.streams = streams;
    this.byTile.clear();
    const cw = this.w + 1;
    for (const p of ponds) {
      const wet: number[] = [];
      for (const k of p.wet) wet.push(k % cw, Math.floor(k / cw));
      const tiles = pondTiles(wet, this.w, this.h);
      for (let i = 0; i < tiles.length; i += 2) {
        const key = tiles[i + 1] * this.w + tiles[i];
        const here = this.byTile.get(key);
        if (here) here.push(p);
        else this.byTile.set(key, [p]);
      }
    }
  }

  /** Whether a pond lies on a tile, or a pool is dug in it. */
  wet(x: number, y: number): boolean {
    return this.byTile.has(y * this.w + x) || this.pools.has(y * this.w + x);
  }

  /** The floor of the pool dug in a tile, which is the bottom of the water there rather than the ground under the foundation; null where there is no pool. */
  bedAt(x: number, y: number): number | null {
    return this.pools.get(y * this.w + x)?.floor ?? null;
  }

  /** The ponds on a tile, none on most. */
  pondsAt(x: number, y: number): PondWater[] {
    return this.byTile.get(y * this.w + x) ?? NONE;
  }

  /** How high the water over a tile stands, the highest of the ponds and the pool on it, or null where there are none. */
  levelAt(x: number, y: number): number | null {
    const here = this.byTile.get(y * this.w + x);
    const pool = this.pools.get(y * this.w + x);
    if (!here && !pool) return null;
    let top = pool ? pool.level : -Infinity;
    for (const p of here ?? NONE) if (p.level > top) top = p.level;
    return top;
  }
}
const NONE: PondWater[] = [];

/** Water going over the edge of a pool: the edge's two corners, the level of the pool it leaves, and the height it falls to. */
export interface Spill {
  edge: [number, number, number, number];
  from: number;
  to: number;
}
const NO_SPILLS: Spill[] = [];
