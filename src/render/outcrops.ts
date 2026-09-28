import { hash2 } from '../world/noise';
import type { Green } from './meadow';

/**
 * Mossy outcrops: what the faces of steep ground carry.
 *
 * The ground renderer draws a steep tile as a face of bare rock, wearing
 * through from whatever grows on top as the slope steepens (`bareRock` in
 * tiles.ts). A face of it was one flat grey quad with a ruled line along the
 * top, which is the one thing a bank of rock in the pictures never is. There
 * the grass on top runs to the edge and rolls over it in a lip, moss hangs
 * down the upper face in drips, ferns and tufts grow out of the cracks, and
 * where water stands against the foot or runs over the top, the rock is
 * darker and streaked with the damp.
 *
 * So a face gets those, drawn over its rock:
 *
 *   * **the lip** -- along every top edge whose ground above grows something,
 *     that ground in its own green rolling over the edge, its lower edge in
 *     round sods, now and then one hanging further, with the shade it throws
 *     on the rock under it;
 *   * **moss** -- a cushion of it along the top edges, under the lip where
 *     there is one, sagging into broad round-ended drips down the upper
 *     face; lusher on a face turned from the sun and where the top is wet;
 *   * **cracks** -- on a face that is mostly rock, a dark line or two
 *     jagging down it, with a fern or a tuft of grass in some of them;
 *   * **damp** -- a dark band with a wandering top a little above the water
 *     where the face goes into a pond or the sea, and a streak or two rising
 *     out of it; and streaks narrowing down from the top where water lies
 *     above.
 *
 * All of it is drawing: nothing here is kept or sent, and all of it is placed
 * by where the tile is, so it never moves or flickers. It is worked out in the
 * tile's own square (`u` along the world's x, `v` along its y) and laid onto
 * the face as it lies, so it follows the rock round every turn of the view,
 * and only a face turned towards the camera is dressed at all.
 */

type Ctx = CanvasRenderingContext2D;

/* ---- what a face is ---------------------------------------------------------- */

/** The four edges of a tile in its own square: N (v = 0), E (u = 1), S (v = 1), W (u = 0). */
export const EDGES: ReadonlyArray<{ a: [number, number]; b: [number, number]; into: [number, number]; dx: number; dy: number }> = [
  { a: [0, 0], b: [1, 0], into: [0, 1], dx: 0, dy: -1 },
  { a: [1, 0], b: [1, 1], into: [-1, 0], dx: 1, dy: 0 },
  { a: [1, 1], b: [0, 1], into: [0, -1], dx: 0, dy: 1 },
  { a: [0, 1], b: [0, 0], into: [1, 0], dx: -1, dy: 0 },
];

/**
 * A face, as worked out once from its corners and the tiles round it.
 *
 * `tops` holds, for each of the four edges, -1 where it is not a top edge of
 * the face, and otherwise what grows on the ground above it (a tile type) or
 * -2 where nothing does: bare rock, sand, a path, a wall of water. `wetTop`
 * says whether water lies above one of its top edges.
 */
export interface Face {
  tops: [number, number, number, number];
  wetTop: boolean;
  /** How far the face is turned from the sun, nought facing it square to one facing straight away. */
  shade: number;
}

/**
 * Which edges of a steep tile are its top, off its four corner heights: the
 * highest edge, and a second beside it that stands nearly as high, which is
 * the corner of a knoll. An edge that runs downhill itself -- the side of a
 * tile that turns a corner of a cliff, one high corner and three low -- is
 * the rock's own corner and not a top, and nothing hangs from it.
 */
export function topEdges(h00: number, h10: number, h11: number, h01: number): boolean[] {
  const c = [h00, h10, h11, h01];
  const e = [(h00 + h10) / 2, (h10 + h11) / 2, (h11 + h01) / 2, (h01 + h00) / 2];
  const hi = Math.max(...e), lo = Math.min(...e);
  const drop = Math.max(...c) - Math.min(...c);
  return e.map((v, i) => v >= hi - 0.25 * (hi - lo) && v > lo && Math.abs(c[i] - c[(i + 1) & 3]) <= 0.5 * drop);
}

/* ---- the sprites: ferns and tufts ----------------------------------------------- */

/** Painted at three times the size drawn, as the meadow's clumps are. */
const SCALE = 3;

export interface Sprig { canvas: HTMLCanvasElement; w: number; h: number; ax: number; ay: number }

const sprigs = new Map<string, Sprig>();

/**
 * A fern growing out of a crack: fronds splayed up and out from one root,
 * each a rib with leaflets down both sides, drooping at the tip. Or a tuft of
 * grass: a fan of blades. Pixels at zoom one: a fern is fourteen across.
 */
export function sprigOf(kind: 'fern' | 'tuft', variant: number): Sprig {
  const key = `${kind}:${variant}`;
  const had = sprigs.get(key);
  if (had) return had;
  const w = kind === 'fern' ? 16 : 10, h = kind === 'fern' ? 13 : 10;
  const c = document.createElement('canvas');
  c.width = w * SCALE;
  c.height = h * SCALE;
  const g = c.getContext('2d') as Ctx;
  g.scale(SCALE, SCALE);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const ax = w / 2, ay = h - 1.5;
  let s = 0x9e3779b9 ^ (variant * 7919) ^ (kind === 'fern' ? 1 : 2);
  const R = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  if (kind === 'fern') {
    /*
     * Each frond a leaf: widest a third of the way out, pointed at the tip,
     * its edge toothed where the leaflets are, arching up and out from the
     * root and drooping at the end. Filled, lined round and ribbed, because at
     * the size a fern is drawn a frond of ticks is a smudge and a leaf is a leaf.
     */
    const fronds = 4 + (variant % 2);
    const shapes: number[][] = [];
    const ribs: number[][] = [];
    for (let i = 0; i < fronds; i++) {
      const t = (i + 0.5) / fronds;
      const a = -Math.PI / 2 + (t - 0.5) * 2.7 + (R() - 0.5) * 0.3;
      const len = 7 + R() * 2.2 - Math.abs(t - 0.5) * 2.4;
      const out = Math.abs(t - 0.5) * 2;
      const tx = ax + Math.cos(a) * len, ty = ay + Math.sin(a) * len * 0.78 + out * 2.2;
      const cx = ax + Math.cos(a) * len * 0.5, cy = ay + Math.sin(a) * len * 1.05;
      const wide = 1.35 + R() * 0.35;
      const left: number[] = [], right: number[] = [], rib: number[] = [];
      const N = 9;
      for (let k = 0; k <= N; k++) {
        const s = k / N;
        const px = (1 - s) * (1 - s) * ax + 2 * (1 - s) * s * cx + s * s * tx;
        const py = (1 - s) * (1 - s) * ay + 2 * (1 - s) * s * cy + s * s * ty;
        const dx = 2 * (1 - s) * (cx - ax) + 2 * s * (tx - cx), dy = 2 * (1 - s) * (cy - ay) + 2 * s * (ty - cy);
        const dl = Math.hypot(dx, dy) || 1;
        const nx = -dy / dl, ny = dx / dl;
        const w = wide * Math.sin(Math.PI * Math.min(1, s * 1.35 + 0.08)) * (k % 2 ? 1 : 0.62) * (k === N ? 0 : 1);
        left.push(px + nx * w, py + ny * w);
        right.push(px - nx * w, py - ny * w);
        rib.push(px, py);
      }
      const shape = [...left];
      for (let k = right.length - 2; k >= 0; k -= 2) shape.push(right[k], right[k + 1]);
      shapes.push(shape);
      ribs.push(rib);
    }
    const path = (): void => {
      g.beginPath();
      for (const s of shapes) {
        g.moveTo(s[0], s[1]);
        for (let k = 2; k < s.length; k += 2) g.lineTo(s[k], s[k + 1]);
        g.closePath();
      }
    };
    path();
    g.strokeStyle = '#2f5a41';
    g.lineWidth = 1.1;
    g.stroke();
    g.fillStyle = '#5c9764';
    g.fill();
    g.strokeStyle = '#94c48c';
    g.lineWidth = 0.45;
    g.beginPath();
    for (const r of ribs) {
      g.moveTo(r[0], r[1]);
      for (let k = 2; k < r.length - 2; k += 2) g.lineTo(r[k], r[k + 1]);
    }
    g.stroke();
  } else {
    const blades = 6 + (variant % 3);
    const lines: Array<[number, number, number, number]> = [];
    for (let i = 0; i < blades; i++) {
      const t = (i + 0.5) / blades;
      const lean = (t - 0.5) * 7 + (R() - 0.5) * 1.5;
      const tall = 5 + R() * 3.5;
      lines.push([ax + lean * 0.4, ay - tall * 0.6, ax + lean, ay - tall]);
    }
    for (const [col, width] of [['#35613f', 1.5], ['#6b9e6f', 0.8]] as const) {
      g.strokeStyle = col;
      g.lineWidth = width;
      g.beginPath();
      for (const [cx, cy, tx, ty] of lines) {
        g.moveTo(ax, ay);
        g.quadraticCurveTo(cx, cy, tx, ty);
      }
      g.stroke();
    }
  }
  const made = { canvas: c, w, h, ax, ay };
  sprigs.set(key, made);
  return made;
}

/* ---- laying it on ------------------------------------------------------------------ */

/** Radius of a lobe of the lip at zoom one, in screen pixels: bigger than a path's, it is a whole sod rolling over. */
export const LIP_LOBE = 6.4;
/** The shade under the lip, and the damp. */
const LIP_SHADE = 'rgba(28, 30, 38, 0.3)';
const DAMP_BAND = 'rgba(26, 36, 46, 0.22)';
const DAMP_STREAK = 'rgba(26, 36, 46, 0.12)';
const CRACK = 'rgba(38, 34, 44, 0.55)';
const CRACK_LIT = 'rgba(255, 255, 255, 0.24)';
/** Radius of a lobe of moss at zoom one: smaller than the lip's, a cushion rather than a sod. */
const MOSS_LOBE = 5.2;
/** How bare a face has to be to show cracks: a bank still mostly turf has none. */
const CRACKED = 0.55;

/**
 * A streak of damp from `(px, py)` to `(qx, qy)`, `w` across at its root and
 * narrowing to nothing, added to the path being built.
 */
function streak(g: Ctx, px: number, py: number, qx: number, qy: number, w: number): void {
  let nx = qy - py, ny = px - qx;
  const l = Math.hypot(nx, ny) || 1;
  nx = (nx / l) * w * 0.5;
  ny = (ny / l) * w * 0.5;
  const mx = (px + qx) / 2, my = (py + qy) / 2;
  g.moveTo(px + nx, py + ny);
  g.quadraticCurveTo(mx + nx * 0.7, my + ny * 0.7, qx, qy);
  g.quadraticCurveTo(mx - nx * 0.7, my - ny * 0.7, px - nx, py - ny);
  g.closePath();
}

/**
 * Moss on rock: a fresher green than the moss that grows as ground, which is
 * the damp floor of a wood and a deep one. On grey stone in the sun it is
 * the brightest green on the face, as it is in the pictures, and its lobes
 * are lit and lined as everything green here is.
 */
export const ROCK_MOSS: Green = { line: '#4b7652', shade: '#78a86c', lit: '#97c285', top: '#b3d59b', foot: 'rgba(30, 50, 34, 0.14)' };

/** A lip's notches along its edge: where each is (a share of the edge), the sod's size there and how far down. */
const LIP_MOST = 32;
const LIP_T = new Float64Array(LIP_MOST + 1);
const LIP_R = new Float64Array(LIP_MOST + 1);
const LIP_DOWN = new Float64Array(LIP_MOST + 1);

/**
 * The moss on a face's top edges, laid out on the screen: where each edge
 * starts, the way along it and down the face, how far down the cushion's top
 * lies, the run of it along the edge (shares of the edge) and how many
 * scallops its lower edge has; the lower edge's depth at each point of the
 * run is in `MOSS_SAG`, and each drip -- where along, how long, how wide at
 * the top, how far it bends -- in `MOSS_DRIP`. Written over, a face at a time.
 */
interface MossEdge { ax: number; ay: number; ex: number; ey: number; dx: number; dy: number; along: number; top: number; s0: number; s1: number; count: number; drips: number }
const MOSS: MossEdge[] = [];
/** Scallops a cushion has at most, and drips an edge. */
const MOSS_MOST = 48;
const MOSS_DRIPS = 4;
const MOSS_SAG = new Float64Array(4 * (MOSS_MOST + 1));
const MOSS_DRIP = new Float64Array(4 * MOSS_DRIPS * 4);

/**
 * The moss laid out in `MOSS` as one path: each cushion and each drip a
 * closed shape, all turning the same way so a fill is their union. `lit`
 * draws the part the sun is on -- the cushion's lower edge raised, the drips
 * narrower and shorter, the whole moved by (ox, oy) -- where nought draws it all.
 */
function mossPath(g: Ctx, n: number, rm: number, lit: number, ox: number, oy: number): void {
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const M = MOSS[i];
    const { ax, ay, ex, ey, dx, dy, along, s0, s1, count } = M;
    // A point on the face: a share of the way along the edge, and so far down it.
    const px = (t: number, down: number): number => ax + ex * along * t + dx * down + ox;
    const py = (t: number, down: number): number => ay + ey * along * t + dy * down + oy;
    const sag = (k: number): number => MOSS_SAG[i * (MOSS_MOST + 1) + k] - rm * 0.3 * lit;
    const top = M.top + rm * 0.3 * lit;
    const cap = rm * (0.7 - 0.25 * lit);
    const bulge = rm * (0.55 - 0.15 * lit);
    // The cushion: along its top, round the far end, back along its lower edge in scallops, round the near end.
    g.moveTo(px(s0, top), py(s0, top));
    g.lineTo(px(s1, top), py(s1, top));
    const endDown = (top + sag(count)) / 2;
    g.quadraticCurveTo(px(s1, endDown) + ex * cap, py(s1, endDown) + ey * cap, px(s1, sag(count)), py(s1, sag(count)));
    for (let k = count; k > 0; k--) {
      const ta = s0 + ((s1 - s0) * (k - 0.5)) / count, tb = s0 + ((s1 - s0) * (k - 1)) / count;
      const mid = (sag(k) + sag(k - 1)) / 2 + bulge;
      g.quadraticCurveTo(px(ta, mid), py(ta, mid), px(tb, sag(k - 1)), py(tb, sag(k - 1)));
    }
    const startDown = (top + sag(0)) / 2;
    g.quadraticCurveTo(px(s0, startDown) - ex * cap, py(s0, startDown) - ey * cap, px(s0, top), py(s0, top));
    g.closePath();
    // Each drip: from inside the cushion down to a round end, narrowing, bending a little to one side.
    for (let k = 0; k < M.drips; k++) {
      const at = (i * MOSS_DRIPS + k) * 4;
      const t = MOSS_DRIP[at], long = MOSS_DRIP[at + 1] - rm * 0.35 * lit;
      const w0 = MOSS_DRIP[at + 2] * (1 - 0.3 * lit), w1 = w0 * 0.85, bend = MOSS_DRIP[at + 3];
      const from = Math.min(long, sag(Math.min(count, Math.max(0, Math.round(((t - s0) / (s1 - s0 || 1)) * count))))) - rm * 0.6;
      if (long - from < rm * 0.5) continue;
      // The middle of it at the top, halfway and the foot.
      const c0x = px(t, from), c0y = py(t, from);
      const hm = (from + long) / 2;
      const c1x = px(t, hm) + ex * bend * 0.25, c1y = py(t, hm) + ey * bend * 0.25;
      const c2x = px(t, long) + ex * bend, c2y = py(t, long) + ey * bend;
      const wm = (w0 + w1) / 2;
      // A quadratic through the middle of a side: its control is twice the middle less the mean of the ends.
      g.moveTo(c0x - ex * w0, c0y - ey * w0);
      g.lineTo(c0x + ex * w0, c0y + ey * w0);
      g.quadraticCurveTo(2 * (c1x + ex * wm) - (c0x + ex * w0 + c2x + ex * w1) / 2, 2 * (c1y + ey * wm) - (c0y + ey * w0 + c2y + ey * w1) / 2, c2x + ex * w1, c2y + ey * w1);
      g.quadraticCurveTo(c2x + ex * w1 + dx * w1 * 1.1, c2y + ey * w1 + dy * w1 * 1.1, c2x + dx * w1, c2y + dy * w1);
      g.quadraticCurveTo(c2x - ex * w1 + dx * w1 * 1.1, c2y - ey * w1 + dy * w1 * 1.1, c2x - ex * w1, c2y - ey * w1);
      g.quadraticCurveTo(2 * (c1x - ex * wm) - (c0x - ex * w0 + c2x - ex * w1) / 2, 2 * (c1y - ey * wm) - (c0y - ey * w0 + c2y - ey * w1) / 2, c0x - ex * w0, c0y - ey * w0);
      g.closePath();
    }
  }
}

/** Everything the caller hands over to lay a face's dressing on: where it is, and how to put its own square on the screen. */
export interface FaceDraw {
  x: number;
  y: number;
  face: Face;
  /** How bare the face is, nought to one: how much of it is rock. */
  bare: number;
  zoom: number;
  /** The tile's square to the screen. */
  X: (u: number, v: number) => number;
  Y: (u: number, v: number) => number;
  /** A ground's lobes, in its own green (`hemOf`). */
  hem: (ground: number) => Green;
  moss: Green;
  /** A sprite at the size it will be drawn (`atSize`). */
  sized: (c: HTMLCanvasElement, w: number, h: number) => HTMLCanvasElement;
  /** The water against the foot, as a line across the face (u, v, u, v), and the damp's reach above it; or null. */
  waterline: [number, number, number, number] | null;
  dampline: [number, number, number, number] | null;
}

/**
 * Lay the dressing on a face, in the order it lies: the damp, the cracks and
 * what grows in them, the moss, the shade of the lip and the lip. The caller
 * has cut the face off at any water against it; a dry face is not cut at
 * all, and nothing here goes over its edges but a fern's fronds and the
 * round end of a cushion of moss, onto the rock beside it.
 *
 * `detail` is how much of it. Nought, under three fifths of a tile's zoom,
 * is the shapes and colours only: a fill of moss and one of lip. One adds
 * the damp's streaks, the cracks, the moss's line and the lip's shade, and
 * from zoom one the ferns and tufts; two, from half as close again, the
 * light on the moss and the lip, the lip's line and the light in the cracks.
 * Each pass is a fill a face, and a face is a fill or two a pass.
 */
export function drawFace(g: Ctx, f: FaceDraw, detail: 0 | 1 | 2): void {
  const { x, y, face, bare, zoom, X, Y } = f;
  const r = LIP_LOBE * zoom;

  /*
   * The damp at the foot: a band over the waterline whose top wanders, and a
   * streak or two rising out of it. Where the band meets the next tile's its
   * height is set by the place on the map, so the two agree.
   */
  if (f.waterline && f.dampline) {
    const [a0, b0, a1, b1] = f.waterline;
    const [c0, d0, c1, d1] = f.dampline;
    const reachAt = (i: number, n: number): number => {
      if (i > 0 && i < n) return 0.45 + hash2(x * 5 + i, y, 7203) * 0.8;
      const u = i ? a1 : a0, v = i ? b1 : b0;
      return 0.6 + hash2(Math.round((x + u) * 32), Math.round((y + v) * 32), 7205) * 0.5;
    };
    const N = 4;
    const tx: number[] = [], ty: number[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, k = reachAt(i, N);
      const wu = a0 + (a1 - a0) * t, wv = b0 + (b1 - b0) * t;
      const du = c0 + (c1 - c0) * t, dv = d0 + (d1 - d0) * t;
      tx.push(X(wu + (du - wu) * k, wv + (dv - wv) * k));
      ty.push(Y(wu + (du - wu) * k, wv + (dv - wv) * k));
    }
    g.beginPath();
    g.moveTo(X(a0, b0), Y(a0, b0));
    g.lineTo(X(a1, b1), Y(a1, b1));
    g.lineTo(tx[N], ty[N]);
    // A soft edge along the top: through the middles of the points, curving at each.
    for (let i = N; i > 0; i--) g.quadraticCurveTo(tx[i], ty[i], (tx[i] + tx[i - 1]) / 2, (ty[i] + ty[i - 1]) / 2);
    g.lineTo(tx[0], ty[0]);
    g.closePath();
    g.fillStyle = DAMP_BAND;
    g.fill();
    if (detail > 0) {
      const streaks = Math.floor(hash2(x, y, 7209) * 2.7);
      g.beginPath();
      for (let k = 0; k < streaks; k++) {
        const t = (k + 0.2 + hash2(x, y, 7201 + k) * 0.6) / streaks;
        const px = X(a0 + (a1 - a0) * t, b0 + (b1 - b0) * t), py = Y(a0 + (a1 - a0) * t, b0 + (b1 - b0) * t);
        const qx = X(c0 + (c1 - c0) * t, d0 + (d1 - d0) * t), qy = Y(c0 + (c1 - c0) * t, d0 + (d1 - d0) * t);
        const reach = 1.4 + hash2(x, y, 7211 + k) * 1.4;
        streak(g, px, py, px + (qx - px) * reach, py + (qy - py) * reach, (2.4 + hash2(x, y, 7213 + k) * 2.2) * zoom);
      }
      g.fillStyle = DAMP_STREAK;
      g.fill();
    }
  }

  /* Streaks down from the top where water lies above it: one to three an edge, each narrowing as it runs. */
  if (face.wetTop && detail > 0) {
    g.beginPath();
    for (let e = 0; e < 4; e++) {
      if (face.tops[e] === -1) continue;
      const E = EDGES[e];
      const n = 1 + Math.floor(hash2(x * 5 + e, y, 7229) * 3);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.2 + hash2(x * 5 + e, y, 7231 + k) * 0.6) / n;
        const u0 = E.a[0] + (E.b[0] - E.a[0]) * t, v0 = E.a[1] + (E.b[1] - E.a[1]) * t;
        const len = 0.3 + hash2(x, y * 3 + e, 7241 + k) * 0.5;
        streak(g, X(u0, v0), Y(u0, v0), X(u0 + E.into[0] * len, v0 + E.into[1] * len), Y(u0 + E.into[0] * len, v0 + E.into[1] * len),
          (3 + hash2(x, y, 7251 + k * 3 + e) * 2.5) * zoom);
      }
    }
    g.fillStyle = DAMP_STREAK;
    g.fill();
  }

  /*
   * Cracks down the face, jagging as they go, and a fern or a tuft in some of
   * them. Only on a face that is mostly rock: a bank that is still mostly
   * turf has no cracks to show.
   */
  if (detail > 0 && bare >= CRACKED) {
    const cracks = Math.floor(hash2(x, y, 7301) * 2.4);
    const sprouts: Array<[number, number, number]> = [];
    const lines: number[] = [];
    for (let k = 0; k < cracks; k++) {
      let e = 0;
      for (let i = 0; i < 4; i++) if (face.tops[(i + k) % 4] !== -1) { e = (i + k) % 4; break; }
      const E = EDGES[e];
      const eu = E.b[0] - E.a[0], ev = E.b[1] - E.a[1];
      const t = 0.15 + hash2(x, y, 7313 + k) * 0.7;
      const from = 0.26 + hash2(x, y, 7311 + k) * 0.22;
      const len = 0.18 + hash2(x, y, 7317 + k) * 0.3;
      // Four points down from `from`, each a little to one side of the last: a crack, not a scratch.
      const side = hash2(x, y, 7319 + k) < 0.5 ? 1 : -1;
      for (let j = 0; j < 4; j++) {
        const s = j / 3;
        const jag = j === 0 ? 0 : (j % 2 ? side : -side) * (0.025 + hash2(x + j, y, 7323 + k) * 0.035);
        const u = E.a[0] + eu * t + E.into[0] * (from + len * s) + eu * jag;
        const v = E.a[1] + ev * t + E.into[1] * (from + len * s) + ev * jag;
        lines.push(X(u, v), Y(u, v));
        if (j === 1 && hash2(x, y, 7329 + k) < 0.55 + 0.3 * face.shade) sprouts.push([u, v, k]);
      }
    }
    // Each a dark line, with the light catching the far wall of it.
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const [ink, off, width] of [[CRACK_LIT, 0.9, 1], [CRACK, 0, 1.25]] as const) {
      if (ink === CRACK_LIT && detail < 2) continue;
      g.strokeStyle = ink;
      g.lineWidth = Math.max(0.8, width * zoom);
      g.beginPath();
      for (let i = 0; i < lines.length; i += 8) {
        g.moveTo(lines[i] + off * zoom, lines[i + 1] + off * 0.5 * zoom);
        for (let j = 2; j < 8; j += 2) g.lineTo(lines[i + j] + off * zoom, lines[i + j + 1] + off * 0.5 * zoom);
      }
      g.stroke();
    }
    if (zoom >= 1) {
      for (const [u, v, k] of sprouts) {
        const fern = hash2(x, y, 7331 + k) < 0.55;
        const sp = sprigOf(fern ? 'fern' : 'tuft', Math.floor(hash2(x, y, 7337 + k) * 3));
        const s = zoom * (0.9 + hash2(x, y, 7339 + k) * 0.3);
        const ready = f.sized(sp.canvas, sp.w * s, sp.h * s);
        g.drawImage(ready, X(u, v) - sp.ax * s, Y(u, v) - sp.ay * s, sp.w * s, sp.h * s);
      }
    }
  }

  /*
   * The moss: a cushion along each top edge, over as much of it as the face
   * is lush, with a drip or three hanging down from it and narrowing to a
   * round end. Lusher under a lip, on a face turned from the sun and under
   * water, and none on a bank that is only just steep enough to show its
   * rock. Laid out on the screen and drawn as shapes -- the cushion with a
   * scalloped lower edge, each drip a tongue -- lined round the outside,
   * filled, and lit on the side towards the sun, as everything green here is.
   */
  let n = 0;
  const rm = MOSS_LOBE * zoom;
  const wet = face.wetTop ? 0.25 : 0;
  for (let e = 0; e < 4; e++) {
    const top = face.tops[e];
    if (top === -1) continue;
    const E = EDGES[e];
    const lush = Math.min(1, bare * (0.35 + 0.4 * face.shade + (top >= 0 ? 0.25 : 0) + wet));
    if (lush < 0.2) continue;
    const ax = X(E.a[0], E.a[1]), ay = Y(E.a[0], E.a[1]), bx = X(E.b[0], E.b[1]), by = Y(E.b[0], E.b[1]);
    const along = Math.hypot(bx - ax, by - ay);
    if (along < 4) continue;
    // Down the face on the screen, and how far it is to the foot.
    const mu = (E.a[0] + E.b[0]) / 2, mv = (E.a[1] + E.b[1]) / 2;
    let dx = X(mu + E.into[0], mv + E.into[1]) - X(mu, mv);
    let dy = Y(mu + E.into[0], mv + E.into[1]) - Y(mu, mv);
    const tall = Math.hypot(dx, dy) || 1;
    dx /= tall;
    dy /= tall;
    const M = MOSS[n] ?? (MOSS[n] = { ax: 0, ay: 0, ex: 0, ey: 0, dx: 0, dy: 0, along: 0, top: 0, s0: 0, s1: 0, count: 0, drips: 0 });
    M.ax = ax;
    M.ay = ay;
    M.ex = (bx - ax) / along;
    M.ey = (by - ay) / along;
    M.dx = dx;
    M.dy = dy;
    M.along = along;
    // The run of it along the edge, hanging below the lip where there is one, so the lip does not hide it.
    const under = top >= 0 ? r * 1.1 : 0;
    M.top = under * 0.5;
    const cover = 0.4 + 0.6 * lush;
    M.s0 = hash2(x * 7 + e, y, 7401) * (1 - cover);
    M.s1 = M.s0 + cover;
    const count = Math.min(MOSS_MOST, Math.max(1, Math.ceil((along * cover) / (rm * 1.1))));
    M.count = count;
    for (let k = 0; k <= count; k++) {
      MOSS_SAG[n * (MOSS_MOST + 1) + k] = Math.min(tall * 0.5, under + rm * (1.3 + hash2(x * 3 + k, y * 5 + e, 7403) * 1.0) * (k === 0 || k === count ? 0.75 : 1));
    }
    // The drips, each from somewhere along the run: broad, and round at the end, as a cushion of moss sags.
    const drips = Math.min(MOSS_DRIPS, 1 + Math.floor(hash2(x, y * 7 + e, 7407) * (1 + 2.5 * lush)));
    M.drips = drips;
    for (let k = 0; k < drips; k++) {
      const at = (n * MOSS_DRIPS + k) * 4;
      MOSS_DRIP[at] = M.s0 + cover * ((k + 0.2 + hash2(x * 5 + k, y, 7409 + e) * 0.6) / drips);
      MOSS_DRIP[at + 1] = Math.min(tall * 0.6, under + rm * (2.2 + hash2(x + k, y * 11 + e, 7411) * 3.4) * (0.6 + lush * 0.5));
      MOSS_DRIP[at + 2] = rm * (1 + hash2(x * 3 + k, y + e, 7413) * 0.4);
      MOSS_DRIP[at + 3] = (hash2(x, y + k * 5, 7415 + e) - 0.5) * rm * 1.4;
    }
    n++;
  }
  if (n) {
    const pal = f.moss;
    if (detail === 1) {
      // Its edge from middling zooms: the same shapes a little down and away from the sun, in the line's colour, under it -- a fill, where a line round it is a stroke and dearer.
      const o = Math.max(0.8, rm * 0.2);
      mossPath(g, n, rm, 0, o * 0.6, o);
      g.fillStyle = pal.line;
      g.fill();
    }
    mossPath(g, n, rm, 0, 0, 0);
    if (detail > 1) {
      g.lineJoin = 'round';
      g.strokeStyle = pal.line;
      g.lineWidth = 2 * Math.max(0.5, rm * 0.11);
      g.stroke();
    }
    g.fillStyle = pal.shade;
    g.fill();
    if (detail > 1) {
      mossPath(g, n, rm, 1, -rm * 0.12, -rm * 0.26);
      g.fillStyle = pal.lit;
      g.fill();
    }
  }

  /*
   * And the lip: the ground above rolling over each top edge it grows on, as
   * a band from the edge down with its lower edge in a scallop a sod wide --
   * now and then a sod hanging further over, which is what makes it a lip and
   * not a hem -- and the shade it throws on the rock under it. A band rather
   * than a row of round sods, so it starts at the edge and nothing of it lies
   * on the ground above, and costs a fill where the sods cost one each.
   */
  for (let e = 0; e < 4; e++) {
    const top = face.tops[e];
    if (top < 0) continue;
    const E = EDGES[e];
    const ax = X(E.a[0], E.a[1]), ay = Y(E.a[0], E.a[1]), bx = X(E.b[0], E.b[1]), by = Y(E.b[0], E.b[1]);
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 4) continue;
    // Down the face from the middle of the edge, on the screen: where the lip hangs.
    const mu = (E.a[0] + E.b[0]) / 2, mv = (E.a[1] + E.b[1]) / 2;
    let dx = X(mu + E.into[0] * 0.1, mv + E.into[1] * 0.1) - X(mu, mv);
    let dy = Y(mu + E.into[0] * 0.1, mv + E.into[1] * 0.1) - Y(mu, mv);
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    const count = Math.min(LIP_MOST, Math.max(2, Math.round(len / (r * 1.05))));
    for (let k = 0; k <= count; k++) {
      // Where along the edge each notch between two sods is, the ends at the corners so the next tile's lip meets it.
      LIP_T[k] = k === 0 || k === count ? k / count : k / count + (hash2(x * 3 + e, y, 7501 + k) - 0.5) * (0.5 / count);
      const big = hash2(x, y * 5 + e, 7503 + k) < 0.3 ? 1.3 : 1;
      const lr = r * (0.8 + hash2(x + k, y * 3 + e, 7507) * 0.35) * big;
      LIP_R[k] = lr;
      // A notch is where two round sods side by side meet: most of a sod's depth down.
      LIP_DOWN[k] = r * (0.5 + (big - 1) * 1.6) + lr * 0.85;
    }
    const lip = (lit: number, ox: number, oy: number, closed: boolean): void => {
      const px = (t: number, down: number): number => ax + (bx - ax) * t + dx * down + ox;
      const py = (t: number, down: number): number => ay + (by - ay) * t + dy * down + oy;
      if (closed) {
        g.moveTo(px(0, 0), py(0, 0));
        g.lineTo(px(1, 0), py(1, 0));
        g.lineTo(px(1, LIP_DOWN[count] - LIP_R[count] * 0.3 * lit), py(1, LIP_DOWN[count] - LIP_R[count] * 0.3 * lit));
      } else {
        g.moveTo(px(1, LIP_DOWN[count]), py(1, LIP_DOWN[count]));
      }
      for (let k = count; k > 0; k--) {
        const tm = (LIP_T[k] + LIP_T[k - 1]) / 2;
        const lr = (LIP_R[k] + LIP_R[k - 1]) / 2;
        // Through the bottom of the sod between: a quadratic's middle is halfway from its ends' mean to its control.
        const mid = (LIP_DOWN[k] + LIP_DOWN[k - 1]) / 2 + lr * 0.3 - lr * 0.3 * lit;
        const next = LIP_DOWN[k - 1] - LIP_R[k - 1] * 0.3 * lit;
        g.quadraticCurveTo(px(tm, mid), py(tm, mid), px(LIP_T[k - 1], next), py(LIP_T[k - 1], next));
      }
      if (closed) g.closePath();
    };
    const pal = f.hem(top);
    if (detail > 0) {
      // The shade it throws, a little further down and away from the sun.
      g.beginPath();
      lip(0, dx * r * 0.45 + r * 0.15, dy * r * 0.45, true);
      g.fillStyle = LIP_SHADE;
      g.fill();
    }
    if (detail > 1) {
      // Its line along the lower edge only, under the body so half of it shows: across the top it is the same ground as above.
      g.beginPath();
      lip(0, 0, 0, false);
      g.strokeStyle = pal.line;
      g.lineWidth = 2 * Math.max(0.5, r * 0.11);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.stroke();
    }
    g.beginPath();
    lip(0, 0, 0, true);
    g.fillStyle = pal.shade;
    g.fill();
    if (detail > 1) {
      g.beginPath();
      lip(1, 0, 0, true);
      g.fillStyle = pal.lit;
      g.fill();
    }
  }
}
