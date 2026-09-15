/**
 * The eight ways of looking at the island.
 *
 * The camera turns world (x, y) into view (u, v) and the iso projection puts a
 * point at ((u - v) * HALF_W, (u + v) * HALF_H). Write Q = u + v, which is
 * screen Y and therefore depth, and P = u - v, which is screen X. Both are
 * linear in x and y at every angle — and that one fact is what keeps the
 * ground cheap to draw however the view is turned.
 *
 * It means a tile is always a fixed quadrilateral. At the four cardinal
 * viewpoints it is the diamond it has always been; at the four diagonals it is
 * an axis-aligned rectangle, still two wide to one tall and covering the same
 * ground. Either way the shape is the same for every tile on the island, so
 * the walk over it stays what it was: integer lattice coordinates in, four
 * corner heights out, and not one trigonometric call inside the loop.
 *
 * It also means the tiles at one depth are a straight run. At a cardinal that
 * run is an anti-diagonal of the world grid, as it always was, and the lattice
 * is staggered: only every second cell along the row is a tile. At a diagonal
 * it is a plain row or column with no gaps. So the renderer keeps drawing the
 * ground a line at a time, which is what lets everything standing on it be
 * sorted by nothing more than which line it is on.
 *
 * Every number below is worked out rather than typed. Run `npm run views` to
 * print this file; `tools/views.mjs` is where the working lives.
 */

/** How many viewpoints there are: a turn is an eighth of the way round. */
export const TURNS = 8;

/** A tile border, named the way the buildings name them. */
export type Edge = 'n' | 'e' | 's' | 'w';

export interface View {
  /** The angle itself, for everything that projects a point rather than a tile. */
  cos: number;
  sin: number;
  /** The lattice step in HALF_W and HALF_H: one for a diamond, root two for a rectangle. */
  unit: number;
  /** Whether the lattice is staggered, and so whether across steps by two. */
  staggered: boolean;
  /** Depth of tile (x, y) — the line of the ground it is drawn on: `d[0] + d[1] * x + d[2] * y`. */
  d: readonly [number, number, number];
  /** And how far along that line it sits. Kept so the inverse below can be checked against it. */
  e: readonly [number, number, number];
  /** That inverse, baked, so the walk never divides: `x[0] + x[1] * d + x[2] * e`. */
  x: readonly [number, number, number];
  y: readonly [number, number, number];
  /** The tile's four screen corners, clockwise from the topmost, in lattice units. */
  shape: ReadonlyArray<readonly [number, number]>;
  /** Which world corner each of those is, as an offset from the tile. */
  corners: ReadonlyArray<readonly [number, number]>;
  /** Which tile lies across each screen edge, edge `i` running corner `i` to `i + 1`. */
  edges: ReadonlyArray<readonly [number, number]>;
  /** The two borders facing away from the viewer: the ones whose walls this tile draws. */
  back: readonly [Edge, Edge];
}

export const VIEWS: readonly View[] = [
  { // 0 — 0°, a diamond
    cos: 1, sin: 0, unit: 1, staggered: true,
    d: [0, 1, 1], e: [0, 1, -1],
    x: [0, 0.5, 0.5], y: [0, 0.5, -0.5],
    shape: [[0, 0], [1, 1], [0, 2], [-1, 1]],
    corners: [[0, 0], [1, 0], [1, 1], [0, 1]],
    edges: [[0, -1], [1, 0], [0, 1], [-1, 0]],
    back: ['n', 'w'],
  },
  { // 1 — 45°, a rectangle
    cos: Math.SQRT1_2, sin: Math.SQRT1_2, unit: Math.SQRT2, staggered: false,
    d: [0, 0, 1], e: [0, 1, 0],
    x: [0, 0, 1], y: [0, 1, 0],
    shape: [[0, 0], [1, 0], [1, 1], [0, 1]],
    corners: [[0, 0], [1, 0], [1, 1], [0, 1]],
    edges: [[0, -1], [1, 0], [0, 1], [-1, 0]],
    back: ['n', 'w'],
  },
  { // 2 — 90°, a diamond
    cos: 0, sin: 1, unit: 1, staggered: true,
    d: [-1, -1, 1], e: [1, 1, 1],
    x: [-1, -0.5, 0.5], y: [0, 0.5, 0.5],
    shape: [[0, 0], [1, 1], [0, 2], [-1, 1]],
    corners: [[1, 0], [1, 1], [0, 1], [0, 0]],
    edges: [[1, 0], [0, 1], [-1, 0], [0, -1]],
    back: ['e', 'n'],
  },
  { // 3 — 135°, a rectangle
    cos: -Math.SQRT1_2, sin: Math.SQRT1_2, unit: Math.SQRT2, staggered: false,
    d: [-1, -1, 0], e: [0, 0, 1],
    x: [-1, -1, 0], y: [0, 0, 1],
    shape: [[0, 0], [1, 0], [1, 1], [0, 1]],
    corners: [[1, 0], [1, 1], [0, 1], [0, 0]],
    edges: [[1, 0], [0, 1], [-1, 0], [0, -1]],
    back: ['e', 'n'],
  },
  { // 4 — 180°, a diamond
    cos: -1, sin: 0, unit: 1, staggered: true,
    d: [-2, -1, -1], e: [0, -1, 1],
    x: [-1, -0.5, -0.5], y: [-1, -0.5, 0.5],
    shape: [[0, 0], [1, 1], [0, 2], [-1, 1]],
    corners: [[1, 1], [0, 1], [0, 0], [1, 0]],
    edges: [[0, 1], [-1, 0], [0, -1], [1, 0]],
    back: ['s', 'e'],
  },
  { // 5 — 225°, a rectangle
    cos: -Math.SQRT1_2, sin: -Math.SQRT1_2, unit: Math.SQRT2, staggered: false,
    d: [-1, 0, -1], e: [-1, -1, 0],
    x: [-1, 0, -1], y: [-1, -1, 0],
    shape: [[0, 0], [1, 0], [1, 1], [0, 1]],
    corners: [[1, 1], [0, 1], [0, 0], [1, 0]],
    edges: [[0, 1], [-1, 0], [0, -1], [1, 0]],
    back: ['s', 'e'],
  },
  { // 6 — 270°, a diamond
    cos: 0, sin: -1, unit: 1, staggered: true,
    d: [-1, 1, -1], e: [-1, -1, -1],
    x: [0, 0.5, -0.5], y: [-1, -0.5, -0.5],
    shape: [[0, 0], [1, 1], [0, 2], [-1, 1]],
    corners: [[0, 1], [0, 0], [1, 0], [1, 1]],
    edges: [[-1, 0], [0, -1], [1, 0], [0, 1]],
    back: ['w', 's'],
  },
  { // 7 — 315°, a rectangle
    cos: Math.SQRT1_2, sin: -Math.SQRT1_2, unit: Math.SQRT2, staggered: false,
    d: [0, 1, 0], e: [-1, 0, -1],
    x: [0, 1, 0], y: [-1, 0, -1],
    shape: [[0, 0], [1, 0], [1, 1], [0, 1]],
    corners: [[0, 1], [0, 0], [1, 0], [1, 1]],
    edges: [[-1, 0], [0, -1], [1, 0], [0, 1]],
    back: ['w', 's'],
  },
];

/** Which line of the ground a tile is drawn on, under a given view. */
export const depthOf = (v: View, x: number, y: number): number => v.d[0] + v.d[1] * x + v.d[2] * y;
