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

interface Buffers {
  size: number;
  g: Float64Array;
  parent: Int32Array;
  stamp: Int32Array;
  heapIdx: Int32Array;
  heapF: Float64Array;
}

let buffers: Buffers | null = null;
let generation = 0;

function getBuffers(size: number): Buffers {
  if (!buffers || buffers.size !== size) {
    buffers = {
      size,
      g: new Float64Array(size),
      parent: new Int32Array(size),
      stamp: new Int32Array(size),
      heapIdx: new Int32Array(size * 2),
      heapF: new Float64Array(size * 2),
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
  const size = layer * levels;
  const b = getBuffers(size);
  const gen = ++generation;
  const maxNodes = opts.maxNodes ?? 30000;
  const OPEN = 1;
  const CLOSED = 2;

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

  const state = b.stamp;
  const mark = (idx: number, s: number): void => {
    state[idx] = gen * 4 + s;
  };
  const getState = (idx: number): number => (state[idx] - gen * 4 >= 0 && state[idx] - gen * 4 < 4 ? state[idx] - gen * 4 : 0);

  const start = Math.min(levels - 1, sl) * layer + sy * w + sx;
  const goalTile = ty * w + tx;
  let goal = -1;
  b.g[start] = 0;
  b.parent[start] = -1;
  mark(start, OPEN);
  push(start, heuristic(sx, sy));
  let expanded = 0;

  while (heapSize > 0) {
    const cur = pop();
    if (getState(cur) === CLOSED) continue;
    if (cur % layer === goalTile) {
      goal = cur;
      break;
    }
    mark(cur, CLOSED);
    if (++expanded > maxNodes) return null;
    const cl = Math.floor(cur / layer);
    const tileIdx = cur - cl * layer;
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
      const nidx = nl * layer + ny * w + nx;
      if (getState(nidx) === CLOSED) continue;
      const stepCost = (k >= 4 ? Math.SQRT2 : 1) * opts.cost(nx, ny);
      const ng = b.g[cur] + stepCost;
      if (getState(nidx) === OPEN && ng >= b.g[nidx]) continue;
      b.g[nidx] = ng;
      b.parent[nidx] = cur;
      mark(nidx, OPEN);
      push(nidx, ng + heuristic(nx, ny));
    }
  }

  if (goal < 0) return null;
  const path: PathPoint[] = [];
  let idx = goal;
  while (idx !== -1 && idx !== start) {
    const level = Math.floor(idx / layer);
    const t = idx - level * layer;
    const x = t % w;
    path.push({ x, y: (t - x) / w, level });
    idx = b.parent[idx];
  }
  path.reverse();
  return path;
}
