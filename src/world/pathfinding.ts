import type { World } from './world';

export interface PathOptions {
  passable: (x: number, y: number) => boolean;
  /**
   * The storey you arrive on when stepping from one tile to a neighbour, or
   * null when the step is not allowed (slopes, walls, missing floors).
   */
  step: (x0: number, y0: number, level: number, x1: number, y1: number) => number | null;
  /** Extra cost multiplier for entering a tile. */
  cost: (x: number, y: number) => number;
  /** How many storeys the search may use; 1 keeps everything on the ground. */
  levels?: number;
  maxNodes?: number;
}

export interface PathPoint {
  x: number;
  y: number;
  level: number;
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * The scratch the search works in, sized by how far it may look rather than by
 * how big the world is.
 *
 * It used to be five arrays indexed by tile — `w * h * levels` entries — which
 * is fine on an island of a thousand tiles and is **640 MiB at 4096 x 4096**,
 * allocated on the first click to move, before the search has looked at a
 * single node. The search itself was never the problem: it stops after
 * `maxNodes` (thirty thousand) whatever the map is.
 *
 * So tiles get slots instead. A node is given one the first time it is
 * reached, and there can never be more of them than the search is allowed to
 * open: one for the start and eight per expansion. That is about seven
 * megabytes, on any island there will ever be.
 */
interface Buffers {
  cap: number;
  /** The tile index each slot stands for, for walking the path back out. */
  node: Int32Array;
  g: Float64Array;
  /** The slot this one was reached from, or -1. */
  parent: Int32Array;
  state: Uint8Array;
  heapIdx: Int32Array;
  heapF: Float64Array;
}

let buffers: Buffers | null = null;
/** Tile index to slot, reused between searches and cleared at the start of each. */
const slots = new Map<number, number>();

function getBuffers(cap: number): Buffers {
  if (!buffers || buffers.cap < cap) {
    buffers = {
      cap,
      node: new Int32Array(cap),
      g: new Float64Array(cap),
      parent: new Int32Array(cap),
      state: new Uint8Array(cap),
      // Twice, because a slot can be pushed again when a cheaper way to it
      // turns up and the old entry is left in the heap to be skipped.
      heapIdx: new Int32Array(cap * 2),
      heapF: new Float64Array(cap * 2),
    };
  }
  return buffers;
}

/**
 * A* over the tile grid with 8-way movement, across storeys. Returns the tiles
 * after the start up to the goal, which is reached on whichever storey the
 * search arrives first.
 */
export function findPath(world: World, sx: number, sy: number, sl: number, tx: number, ty: number, opts: PathOptions): PathPoint[] | null {
  if (!world.inBounds(sx, sy) || !world.inBounds(tx, ty)) return null;
  if (!opts.passable(tx, ty)) return null;
  if (sx === tx && sy === ty) return [];

  const w = world.w;
  const layer = w * world.h;
  const levels = Math.max(1, opts.levels ?? 1);
  const maxNodes = opts.maxNodes ?? 30000;
  // One for the start and eight per expansion is every slot the search can
  // possibly want, and it is the ceiling whatever the size of the island.
  const b = getBuffers(maxNodes * 8 + 2);
  const OPEN = 1;
  const CLOSED = 2;

  /**
   * The slot a tile is using, handed out on first sight.
   *
   * -1 when they are all gone, which cannot happen while the expansion count
   * holds — it is here because "cannot happen" and "is not checked" together
   * are how a search starts reading somebody else's node.
   */
  slots.clear();
  let used = 0;
  const slotOf = (idx: number): number => {
    const had = slots.get(idx);
    if (had !== undefined) return had;
    if (used >= b.cap) return -1;
    const slot = used++;
    slots.set(idx, slot);
    b.node[slot] = idx;
    b.state[slot] = 0;
    return slot;
  };

  // Binary heap keyed by f.
  let heapSize = 0;
  const push = (idx: number, f: number): void => {
    let i = heapSize++;
    if (i >= b.heapIdx.length) return;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (b.heapF[p] <= f) break;
      b.heapF[i] = b.heapF[p];
      b.heapIdx[i] = b.heapIdx[p];
      i = p;
    }
    b.heapF[i] = f;
    b.heapIdx[i] = idx;
  };
  const pop = (): number => {
    const top = b.heapIdx[0];
    heapSize--;
    if (heapSize > 0) {
      const f = b.heapF[heapSize];
      const idx = b.heapIdx[heapSize];
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= heapSize) break;
        if (c + 1 < heapSize && b.heapF[c + 1] < b.heapF[c]) c++;
        if (b.heapF[c] >= f) break;
        b.heapF[i] = b.heapF[c];
        b.heapIdx[i] = b.heapIdx[c];
        i = c;
      }
      b.heapF[i] = f;
      b.heapIdx[i] = idx;
    }
    return top;
  };

  const heuristic = (x: number, y: number): number => {
    const dx = Math.abs(x - tx);
    const dy = Math.abs(y - ty);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };

  const start = slotOf(Math.min(levels - 1, sl) * layer + sy * w + sx);
  const goalTile = ty * w + tx;
  let goal = -1;
  b.g[start] = 0;
  b.parent[start] = -1;
  b.state[start] = OPEN;
  push(start, heuristic(sx, sy));
  let expanded = 0;

  while (heapSize > 0) {
    const cur = pop();
    if (b.state[cur] === CLOSED) continue;
    const curIdx = b.node[cur];
    if (curIdx % layer === goalTile) {
      goal = cur;
      break;
    }
    b.state[cur] = CLOSED;
    if (++expanded > maxNodes) return null;
    const cl = Math.floor(curIdx / layer);
    const tileIdx = curIdx - cl * layer;
    const cx = tileIdx % w;
    const cy = (tileIdx - cx) / w;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DIRS[k][0];
      const ny = cy + DIRS[k][1];
      if (!world.inBounds(nx, ny) || !opts.passable(nx, ny)) continue;
      if (k >= 4) {
        // Never cut a blocked corner on a diagonal move.
        if (!opts.passable(cx + DIRS[k][0], cy) || !opts.passable(cx, cy + DIRS[k][1])) continue;
      }
      const nl = opts.step(cx, cy, cl, nx, ny);
      if (nl === null || nl < 0 || nl >= levels) continue;
      const n = slotOf(nl * layer + ny * w + nx);
      if (n < 0 || b.state[n] === CLOSED) continue;
      const stepCost = (k >= 4 ? Math.SQRT2 : 1) * opts.cost(nx, ny);
      const ng = b.g[cur] + stepCost;
      if (b.state[n] === OPEN && ng >= b.g[n]) continue;
      b.g[n] = ng;
      b.parent[n] = cur;
      b.state[n] = OPEN;
      push(n, ng + heuristic(nx, ny));
    }
  }

  if (goal < 0) return null;
  // Walked back slot by slot, and turned into tiles on the way out: `parent`
  // holds the slot a node was reached from, not the tile.
  const path: PathPoint[] = [];
  let slot = goal;
  while (slot !== -1 && slot !== start) {
    const idx = b.node[slot];
    const level = Math.floor(idx / layer);
    const t = idx - level * layer;
    const x = t % w;
    path.push({ x, y: (t - x) / w, level });
    slot = b.parent[slot];
  }
  path.reverse();
  return path;
}
