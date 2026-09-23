/**
 * The shape of a pitched roof over a footprint of whole tiles.
 *
 * Every roof tile used to be drawn as a little pyramid of its own, rising
 * from its edges to its middle, so a roof of twelve tiles was twelve
 * pyramids -- an egg box with a grid of ridge caps over it -- and a gable
 * over an L was worked out over the L's bounding box, so the wing's ridge
 * ran off into the air. A roof is one surface over the whole footprint, laid
 * at one pitch, and that surface is the footprint's straight skeleton: every
 * point of it stands as high above the eaves as it is far in from them. On a
 * footprint of square tiles that distance is the chessboard distance to the
 * nearest eave, and taken so it gives the hips at the corners, the ridge
 * down the middle, and a valley running in from every inside corner, with
 * nothing to decide case by case.
 *
 * A gable is the same with the gable ends left out of the reckoning: they are
 * wall carried up rather than roof coming down, so a point is only as high
 * as it is far from an eave. Which edges are ends is the one thing a gable
 * has to decide, and it decides it wing by wing: the footprint is cut into
 * rectangles, the biggest first, each runs its ridge along its length -- a
 * wing off another runs its ridge away from it -- and the edges across a
 * wing's ridge are its ends.
 *
 * All of it is in tiles, the height as a distance (`d`), which the renderer
 * turns into height with the pitch. The distance is held at a cap, so that a
 * hall twenty tiles across is not given a roof ten storeys high: past it the
 * roof is a flat top.
 */

/** A point on the roof: across, down, and how far in from the eaves. */
export type RoofPt = [number, number, number];
/** Which way a piece of roof falls: east, south, west, north, or not at all. */
export type Fall = 0 | 1 | 2 | 3 | 4;
/** The four ways, as steps on the ground, in the order `Fall` numbers them. */
export const FALLS: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** A flat piece of roof: a triangle or a quadrilateral, the way it falls, and the roof tile it covers. */
export interface RoofFace {
  pts: RoofPt[];
  fall: Fall;
  tile: number;
}

/** A crease in the roof: where two faces meet at an angle. */
export interface RoofCrease {
  a: RoofPt;
  b: RoofPt;
  /** A level crease the faces fall away from; a sloping one; and one they fall into. */
  kind: 'ridge' | 'hip' | 'valley';
  tile: number;
}

/** A stretch of the roof's outer edge, and the way it faces. */
export interface RoofEdge {
  a: RoofPt;
  b: RoofPt;
  out: 0 | 1 | 2 | 3;
  /** Along an eave, or up the verge of a gable. */
  kind: 'eave' | 'verge';
  tile: number;
  /** Under an eave's own length, the line of the wall it hangs over, end to end. */
  wall?: [RoofPt, RoofPt];
}

/**
 * A gable end: the wall under it, a border at a time, the way it faces, and
 * the roof's line over it from one end to the other -- one line for the
 * whole end, so it is drawn as one piece of wall and not one to a tile.
 */
export interface RoofGable {
  borders: Array<{ x: number; y: number; tile: number }>;
  out: 0 | 1 | 2 | 3;
  line: RoofPt[];
}

export interface RoofModel {
  faces: RoofFace[];
  creases: RoofCrease[];
  edges: RoofEdge[];
  gables: RoofGable[];
}

const key = (x: number, y: number): string => `${x},${y}`;

/**
 * Which way each tile's wing runs, for a gable: the footprint cut into
 * rectangles, the biggest first. The first runs along its length; a later one
 * that meets the ones before it along one axis only runs away from them.
 */
function wings(tiles: Array<[number, number]>): Map<string, 'x' | 'y'> {
  const left = new Set(tiles.map(([x, y]) => key(x, y)));
  const run = new Map<string, 'x' | 'y'>();
  const placed = new Set<string>();
  while (left.size) {
    let best: { x: number; y: number; w: number; h: number } | null = null;
    for (const k of left) {
      const [x, y] = k.split(',').map(Number);
      // Every rectangle with this tile at its top left corner.
      let wMax = 0;
      while (left.has(key(x + wMax, y))) wMax++;
      for (let h = 1; ; h++) {
        let w = 0;
        while (w < wMax && left.has(key(x + w, y + h - 1))) w++;
        if (!w) break;
        wMax = w;
        const area = w * h;
        if (!best || area > best.w * best.h || (area === best.w * best.h && (y < best.y || (y === best.y && x < best.x)))) best = { x, y, w, h };
      }
    }
    if (!best) break;
    const { x, y, w, h } = best;
    let along: 'x' | 'y' = w >= h ? 'x' : 'y';
    if (placed.size) {
      // Where it meets what is already placed: across its ends, or along its sides.
      let sideX = 0, sideY = 0;
      for (let i = 0; i < w; i++) {
        if (placed.has(key(x + i, y - 1))) sideY++;
        if (placed.has(key(x + i, y + h))) sideY++;
      }
      for (let j = 0; j < h; j++) {
        if (placed.has(key(x - 1, y + j))) sideX++;
        if (placed.has(key(x + w, y + j))) sideX++;
      }
      if (sideY && !sideX) along = 'y';
      else if (sideX && !sideY) along = 'x';
    }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = key(x + i, y + j);
      left.delete(k);
      placed.add(k);
      run.set(k, along);
    }
  }
  return run;
}

/**
 * The roof over `tiles`, hipped or gabled, with its eaves hanging `over`
 * out past the walls and its verges `verge` past the gable ends, and its
 * height held at `cap` -- a whole number of half tiles -- over a footprint
 * wide enough to take it higher, where it is a flat top.
 */
export function roofModel(tiles: Array<[number, number]>, shape: 'hip' | 'gable', over: number, verge: number, cap = Infinity): RoofModel {
  const index = new Map<string, number>();
  tiles.forEach(([x, y], i) => index.set(key(x, y), i));
  const has = (x: number, y: number): boolean => index.has(key(x, y));
  const run = shape === 'gable' ? wings(tiles) : null;

  /*
   * The border round the footprint, a unit at a time: which tile it closes,
   * which way it faces out, and whether it is an eave or a gable end.
   */
  interface Side { x0: number; y0: number; x1: number; y1: number; out: 0 | 1 | 2 | 3; tile: number; eave: boolean }
  const sides: Side[] = [];
  tiles.forEach(([x, y], i) => {
    const runs = run?.get(key(x, y));
    const edge = (out: 0 | 1 | 2 | 3, x0: number, y0: number, x1: number, y1: number): void => {
      const [dx, dy] = FALLS[out];
      if (has(x + dx, y + dy)) return;
      const across: 'x' | 'y' = out === 0 || out === 2 ? 'x' : 'y';
      sides.push({ x0, y0, x1, y1, out, tile: i, eave: !runs || runs !== across });
    };
    edge(3, x, y, x + 1, y);
    edge(0, x + 1, y, x + 1, y + 1);
    edge(1, x, y + 1, x + 1, y + 1);
    edge(2, x, y, x, y + 1);
  });
  const eaves = sides.filter((s) => s.eave);

  /** How far in from the eaves a point is, on the chessboard: the height of the roof over it, before the pitch. */
  const depth = (px: number, py: number): number => {
    let best = Infinity;
    for (const s of eaves) {
      const dx = px < s.x0 ? s.x0 - px : px > s.x1 ? px - s.x1 : 0;
      const dy = py < s.y0 ? s.y0 - py : py > s.y1 ? py - s.y1 : 0;
      const d = Math.max(dx, dy);
      if (d < best) best = d;
    }
    return best === Infinity ? 0 : Math.min(best, cap);
  };
  const memo = new Map<string, number>();
  const at = (px: number, py: number): RoofPt => {
    const k = key(px, py);
    let d = memo.get(k);
    if (d === undefined) { d = depth(px, py); memo.set(k, d); }
    return [px, py, d];
  };
  /** Which way a flat piece through three points falls: down its gradient, to the nearest of the four ways. */
  const fallOf = (p: RoofPt[]): Fall => {
    const [a, b, c] = p;
    const ux = b[0] - a[0], uy = b[1] - a[1], ud = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vd = c[2] - a[2];
    const det = ux * vy - uy * vx;
    if (Math.abs(det) < 1e-12) return 4;
    // The gradient of d: what it gains a step east and a step south.
    const gx = (ud * vy - vd * uy) / det, gy = (vd * ux - ud * vx) / det;
    if (Math.abs(gx) < 1e-6 && Math.abs(gy) < 1e-6) return 4;
    if (Math.abs(gx) >= Math.abs(gy)) return gx > 0 ? 2 : 0;
    return gy > 0 ? 3 : 1;
  };

  /*
   * The surface, half a tile at a time. Every crease the distance has runs
   * along a line of half tiles or across a half tile corner to corner, so each
   * half tile is two flat triangles, split along whichever diagonal the
   * distance at its middle agrees with.
   */
  const faces: RoofFace[] = [];
  const surface: Array<{ pts: RoofPt[]; fall: Fall; tile: number }> = [];
  tiles.forEach(([x, y], i) => {
    for (const [ox, oy] of [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]]) {
      const x0 = x + ox, y0 = y + oy;
      const c = [at(x0, y0), at(x0 + 0.5, y0), at(x0 + 0.5, y0 + 0.5), at(x0, y0 + 0.5)];
      const mid = depth(x0 + 0.25, y0 + 0.25);
      const tris = Math.abs(mid - (c[0][2] + c[2][2]) / 2) < 1e-9 ? [[c[0], c[1], c[2]], [c[0], c[2], c[3]]] : [[c[0], c[1], c[3]], [c[1], c[2], c[3]]];
      for (const t of tris) surface.push({ pts: t, fall: fallOf(t), tile: i });
    }
  });
  faces.push(...surface);

  /*
   * The creases: an edge two triangles share where they fall different ways.
   * Carried on past the far triangle, the near one's plane passes over it at
   * a ridge or a hip and under it in a valley.
   */
  const creases: RoofCrease[] = [];
  const shared = new Map<string, { t: (typeof surface)[number]; k: number }>();
  const pk = (p: RoofPt): string => `${p[0]},${p[1]}`;
  const plane = (t: RoofPt[], px: number, py: number): number => {
    const [a, b, c] = t;
    const ux = b[0] - a[0], uy = b[1] - a[1], ud = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vd = c[2] - a[2];
    const det = ux * vy - uy * vx;
    const gx = (ud * vy - vd * uy) / det, gy = (vd * ux - ud * vx) / det;
    return a[2] + gx * (px - a[0]) + gy * (py - a[1]);
  };
  for (const t of surface) {
    for (let k = 0; k < 3; k++) {
      const p = t.pts[k], q = t.pts[(k + 1) % 3];
      const id = pk(p) < pk(q) ? `${pk(p)}|${pk(q)}` : `${pk(q)}|${pk(p)}`;
      const other = shared.get(id);
      if (!other) { shared.set(id, { t, k }); continue; }
      if (other.t.fall === t.fall) continue;
      const o = t.pts[(k + 2) % 3];
      const above = plane(other.t.pts, o[0], o[1]) - o[2];
      const kind = above > 1e-9 ? (Math.abs(p[2] - q[2]) < 1e-9 ? 'ridge' : 'hip') : 'valley';
      creases.push({ a: p, b: q, kind, tile: t.tile });
    }
  }

  /*
   * The overhang. Past an eave the roof carries on down at its own pitch for
   * the width of the eave; past a gable end it carries on level, the verge.
   * Where two eaves turn an outside corner the hip carries on out to the
   * corner of the overhang, and where they turn an inside corner the two
   * strips are mitred on the valley's line. Under a verge, an eave carries on
   * past the gable to the verge's edge.
   */
  const edges: RoofEdge[] = [];
  const ends: Array<{ s: Side; line: RoofPt[] }> = [];
  const widthOf = (s: Side): number => (s.eave ? over : verge);
  /** The border sides meeting at a corner of the grid, with the way along each from the corner. */
  const atCorner = new Map<string, Array<{ s: Side; along: [number, number] }>>();
  for (const s of sides) {
    const ax = s.x1 - s.x0, ay = s.y1 - s.y0;
    for (const [px, py, sx, sy] of [[s.x0, s.y0, ax, ay], [s.x1, s.y1, -ax, -ay]]) {
      const k = key(px, py);
      if (!atCorner.has(k)) atCorner.set(k, []);
      atCorner.get(k)?.push({ s, along: [sx, sy] });
    }
  }
  /** Where the outer edge of a side's strip ends at one of its corners: pushed along it at an inside corner, for the mitre. */
  const outerEnd = (s: Side, px: number, py: number, along: [number, number]): [number, number] => {
    const [nx, ny] = FALLS[s.out];
    const w = widthOf(s);
    const here = atCorner.get(key(px, py)) ?? [];
    const other = here.find((h) => h.s !== s);
    let ex = px + nx * w, ey = py + ny * w;
    if (other && here.length === 2) {
      const [mx, my] = FALLS[other.s.out];
      // An inside corner: the other side's way out points back along this one.
      if (mx === along[0] && my === along[1]) {
        const w2 = widthOf(other.s);
        ex += along[0] * w2;
        ey += along[1] * w2;
      }
    }
    return [ex, ey];
  };
  for (const s of sides) {
    const ax = s.x1 - s.x0, ay = s.y1 - s.y0;
    const [e0x, e0y] = outerEnd(s, s.x0, s.y0, [ax, ay]);
    const [e1x, e1y] = outerEnd(s, s.x1, s.y1, [-ax, -ay]);
    if (s.eave) {
      const pts: RoofPt[] = [[s.x0, s.y0, 0], [s.x1, s.y1, 0], [e1x, e1y, -over], [e0x, e0y, -over]];
      faces.push({ pts, fall: s.out, tile: s.tile });
      edges.push({ a: pts[3], b: pts[2], out: s.out, kind: 'eave', tile: s.tile, wall: [pts[0], pts[1]] });
    } else {
      // Level out past the gable, in two halves, the roof's line along the
      // border being straight only from a corner to the middle of it.
      const mx = (s.x0 + s.x1) / 2, my = (s.y0 + s.y1) / 2;
      const a = at(s.x0, s.y0), m = at(mx, my), b = at(s.x1, s.y1);
      const am: RoofPt = [e0x + (mx - s.x0), e0y + (my - s.y0), m[2]];
      const a2: RoofPt = [e0x, e0y, a[2]], b2: RoofPt = [e1x, e1y, b[2]];
      for (const [p, q, q2, p2] of [[a, m, am, a2], [m, b, b2, am]] as Array<[RoofPt, RoofPt, RoofPt, RoofPt]>) {
        const pts: RoofPt[] = [p, q, q2, p2];
        // It falls the way the roof inside it does, which is along the border.
        faces.push({ pts, fall: q[2] === p[2] ? 4 : fallOf([p, q, q2]), tile: s.tile });
        edges.push({ a: p2, b: q2, out: s.out, kind: 'verge', tile: s.tile });
      }
      ends.push({ s, line: [a, m, b] });
    }
    // At an inside corner between two eaves the valley carries on out along the mitre.
    for (const [px, py, along, ex, ey] of [[s.x0, s.y0, [ax, ay], e0x, e0y], [s.x1, s.y1, [-ax, -ay], e1x, e1y]] as Array<[number, number, [number, number], number, number]>) {
      const other = (atCorner.get(key(px, py)) ?? []).find((h) => h.s !== s);
      if (!s.eave || !other?.s.eave || FALLS[other.s.out][0] !== along[0] || FALLS[other.s.out][1] !== along[1]) continue;
      // Once, from the side whose way out comes first.
      if (s.out < other.s.out) creases.push({ a: [px, py, 0], b: [ex, ey, -over], kind: 'valley', tile: s.tile });
    }
  }
  // The outside corners.
  for (const [k, here] of atCorner) {
    if (here.length !== 2) continue;
    const [p, q] = here;
    const [n1x, n1y] = FALLS[p.s.out], [n2x, n2y] = FALLS[q.s.out];
    // Outside when neither side's way out points back along the other.
    if ((n1x === q.along[0] && n1y === q.along[1]) || (n2x === p.along[0] && n2y === p.along[1])) continue;
    if (n1x === n2x && n1y === n2y) continue;
    const [cx, cy] = k.split(',').map(Number);
    const w1 = widthOf(p.s), w2 = widthOf(q.s);
    const c1: [number, number] = [cx + n1x * w1, cy + n1y * w1];
    const c2: [number, number] = [cx + n2x * w2, cy + n2y * w2];
    const cc: [number, number] = [cx + n1x * w1 + n2x * w2, cy + n1y * w1 + n2y * w2];
    if (p.s.eave && q.s.eave) {
      // The hip carried on out to the corner of the overhang.
      faces.push({ pts: [[cx, cy, 0], [c1[0], c1[1], -w1], [cc[0], cc[1], -w1]], fall: p.s.out, tile: p.s.tile });
      faces.push({ pts: [[cx, cy, 0], [cc[0], cc[1], -w2], [c2[0], c2[1], -w2]], fall: q.s.out, tile: q.s.tile });
      creases.push({ a: [cx, cy, 0], b: [cc[0], cc[1], -w1], kind: 'hip', tile: p.s.tile });
      edges.push({ a: [c1[0], c1[1], -w1], b: [cc[0], cc[1], -w1], out: p.s.out, kind: 'eave', tile: p.s.tile });
      edges.push({ a: [cc[0], cc[1], -w2], b: [c2[0], c2[1], -w2], out: q.s.out, kind: 'eave', tile: q.s.tile });
    } else if (p.s.eave || q.s.eave) {
      // The eave carried on out under the verge.
      const e = p.s.eave ? p : q, g = p.s.eave ? q : p;
      const we = widthOf(e.s);
      const [ex, ey] = FALLS[e.s.out];
      const eg: [number, number] = [cx + FALLS[g.s.out][0] * widthOf(g.s), cy + FALLS[g.s.out][1] * widthOf(g.s)];
      faces.push({
        pts: [[cx, cy, 0], [cx + ex * we, cy + ey * we, -we], [eg[0] + ex * we, eg[1] + ey * we, -we], [eg[0], eg[1], 0]],
        fall: e.s.out, tile: e.s.tile,
      });
      edges.push({ a: [eg[0] + ex * we, eg[1] + ey * we, -we], b: [cx + ex * we, cy + ey * we, -we], out: e.s.out, kind: 'eave', tile: e.s.tile });
      edges.push({ a: [eg[0], eg[1], 0], b: [eg[0] + ex * we, eg[1] + ey * we, -we], out: g.s.out, kind: 'verge', tile: g.s.tile });
    }
  }
  /*
   * The gable ends, each run of borders facing the same way along one line
   * joined into one, low end first.
   */
  const gables: RoofGable[] = [];
  const line = (e: { s: Side }): number => (e.s.out === 0 || e.s.out === 2 ? e.s.x0 : e.s.y0);
  const from = (e: { s: Side }): number => (e.s.out === 0 || e.s.out === 2 ? Math.min(e.s.y0, e.s.y1) : Math.min(e.s.x0, e.s.x1));
  ends.sort((p, q) => p.s.out - q.s.out || line(p) - line(q) || from(p) - from(q));
  for (const e of ends) {
    const low = (p: RoofPt[]): RoofPt[] => (p[0][0] + p[0][1] <= p[p.length - 1][0] + p[p.length - 1][1] ? p : [...p].reverse());
    const pts = low(e.line);
    const last = gables[gables.length - 1];
    const tail = last?.line[last.line.length - 1];
    if (last && last.out === e.s.out && tail && tail[0] === pts[0][0] && tail[1] === pts[0][1]) {
      last.line.push(...pts.slice(1));
      last.borders.push({ x: Math.min(e.s.x0, e.s.x1), y: Math.min(e.s.y0, e.s.y1), tile: e.s.tile });
      continue;
    }
    gables.push({ borders: [{ x: Math.min(e.s.x0, e.s.x1), y: Math.min(e.s.y0, e.s.y1), tile: e.s.tile }], out: e.s.out, line: [...pts] });
  }
  return { faces, creases, edges, gables };
}
