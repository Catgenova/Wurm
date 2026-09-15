/**
 * Work out the eight viewpoint tables and print `src/render/view.ts`.
 *
 *   npm run views
 *
 * Everything the renderer needs to walk the ground is derived here from a
 * cosine and a sine, because deriving eight viewpoints' worth of corner orders
 * and lattice inverses by hand is how you get a renderer that is subtly wrong
 * at three of them.
 */
const R = Math.SQRT1_2;
const near = (a, b) => Math.abs(a - b) < 1e-9;
const tidy = (v) => (near(v, Math.round(v)) ? Math.round(v) : +v.toFixed(6));
/** Exact expressions rather than six decimal places: `screenToWorld` inverts
 * these, and a rounded cosine there is a cursor that misses the tile it is on. */
const exact = (v) => (near(v, 0) ? '0' : near(v, 1) ? '1' : near(v, -1) ? '-1' : v > 0 ? 'Math.SQRT1_2' : '-Math.SQRT1_2');
const SIDE = new Map([['0,-1', 'n'], ['1,0', 'e'], ['0,1', 's'], ['-1,0', 'w']]);
const pairs = (ps) => ps.map((p) => `[${p[0]}, ${p[1]}]`).join(', ');

const rows = [];
for (let k = 0; k < 8; k++) {
  const phi = (k * Math.PI) / 4;
  const trig = (t) => (near(t, 0) ? 0 : near(Math.abs(t), 1) ? Math.sign(t) : Math.sign(t) * R);
  const c = trig(Math.cos(phi));
  const s = trig(Math.sin(phi));
  // The camera turns world (x, y) into view (u, v) = (xc + ys, yc - xs); the
  // iso projection then puts a point at ((u - v) * HALF_W, (u + v) * HALF_H).
  // So Q = u + v is screen Y and therefore depth, and P = u - v is screen X.
  const Q = (x, y) => x * (c - s) + y * (s + c);
  const P = (x, y) => x * (c + s) + y * (s - c);
  // Half a turn from the cardinals the lattice is coarser by root two: the
  // tile stops being a diamond two cells wide and becomes one cell square.
  const diamond = k % 2 === 0;
  const unit = diamond ? 1 : Math.SQRT2;

  // The four corners of tile (0, 0), and where each of them lands on screen.
  const world = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const at = world.map(([dx, dy]) => ({ dx, dy, q: Q(dx, dy) / unit, p: P(dx, dy) / unit }));
  const order = [...at].sort((a, b) => (near(a.q, b.q) ? a.p - b.p : a.q - b.q));
  // Clockwise from the topmost corner. The two shapes tie differently: a
  // rectangle has two corners level along the top, a diamond has two level
  // half way down, so the middle pair swaps between them.
  const ring = diamond
    ? [order[0], order[2], order[3], order[1]]   // top, right, bottom, left
    : [order[0], order[1], order[3], order[2]];  // top left, top right, bottom right, bottom left
  const anchor = ring[0];

  // Lattice coordinates, counted from the anchor corner so the tile the
  // renderer is standing on is the one at (0, 0).
  // The tile is indexed by where its anchor corner lands, so that d is exactly
  // the screen line the tile is drawn on and e exactly how far along it.
  const dOf = (x, y) => tidy(Q(x, y) / unit + anchor.q);
  const eOf = (x, y) => tidy(P(x, y) / unit + anchor.p);
  const d00 = dOf(0, 0), dx = dOf(1, 0) - d00, dy = dOf(0, 1) - d00;
  const e00 = eOf(0, 0), ex = eOf(1, 0) - e00, ey = eOf(0, 1) - e00;
  // And the inverse, baked, so the walk never divides.
  const det = dx * ey - dy * ex;
  const ix = [tidy((-d00 * ey + e00 * dy) / det), tidy(ey / det), tidy(-dy / det)];
  const iy = [tidy((-e00 * dx + d00 * ex) / det), tidy(-ex / det), tidy(dx / det)];

  const shape = ring.map((o) => [tidy(o.p - anchor.p), tidy(o.q - anchor.q)]);
  const corners = ring.map((o) => [o.dx, o.dy]);
  // Which tile lies across each screen edge, edge i running corner i to i + 1.
  const edges = ring.map((o, i) => {
    const n = ring[(i + 1) % 4];
    return o.dx === n.dx ? [o.dx === 0 ? -1 : 1, 0] : [0, o.dy === 0 ? -1 : 1];
  });
  // The two edges meeting at the topmost corner are the ones facing away.
  const back = [edges[0], edges[3]].map((v) => SIDE.get(`${v[0]},${v[1]}`));

  rows.push(`  { // ${k} — ${k * 45}°, a ${diamond ? 'diamond' : 'rectangle'}
    cos: ${exact(c)}, sin: ${exact(s)}, unit: ${diamond ? '1' : 'Math.SQRT2'}, staggered: ${diamond},
    d: [${d00}, ${dx}, ${dy}], e: [${e00}, ${ex}, ${ey}],
    x: [${ix.join(', ')}], y: [${iy.join(', ')}],
    shape: [${pairs(shape)}],
    corners: [${pairs(corners)}],
    edges: [${pairs(edges)}],
    back: ['${back[0]}', '${back[1]}'],
  },`);
}

process.stdout.write(`/**
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
 * Every number below is worked out rather than typed. Run \`npm run views\` to
 * print this file; \`tools/views.mjs\` is where the working lives.
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
  /** Depth of tile (x, y) — the line of the ground it is drawn on: \`d[0] + d[1] * x + d[2] * y\`. */
  d: readonly [number, number, number];
  /** And how far along that line it sits. Kept so the inverse below can be checked against it. */
  e: readonly [number, number, number];
  /** That inverse, baked, so the walk never divides: \`x[0] + x[1] * d + x[2] * e\`. */
  x: readonly [number, number, number];
  y: readonly [number, number, number];
  /** The tile's four screen corners, clockwise from the topmost, in lattice units. */
  shape: ReadonlyArray<readonly [number, number]>;
  /** Which world corner each of those is, as an offset from the tile. */
  corners: ReadonlyArray<readonly [number, number]>;
  /** Which tile lies across each screen edge, edge \`i\` running corner \`i\` to \`i + 1\`. */
  edges: ReadonlyArray<readonly [number, number]>;
  /** The two borders facing away from the viewer: the ones whose walls this tile draws. */
  back: readonly [Edge, Edge];
}

export const VIEWS: readonly View[] = [
${rows.join('\n')}
];

/** Which line of the ground a tile is drawn on, under a given view. */
export const depthOf = (v: View, x: number, y: number): number => v.d[0] + v.d[1] * x + v.d[2] * y;
`);
