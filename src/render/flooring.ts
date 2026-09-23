/**
 * What a floor is laid in, painted, and the ground where it is paved in slabs.
 *
 * A floor was one colour a tile with its joints ruled over it: boards one way
 * for the woods and a grid of squares for every stone, so a storey of oak and
 * a storey of pine differed by hue, and brick, marble and slate were all the
 * same chequer in three colours. Each material lays its floor now as a house
 * of it would: plank in sawn pine boards nailed at their ends, timbercraft in
 * wide oak boards pegged, log in split logs laid flat face up, cobblestone in
 * crazy paving, slate in riven slabs of random sizes, stone brick in dressed
 * flags with a drafted margin, brick in herringbone, adobe in hand-made clay
 * tiles in a grout of its own coat, sandstone in random flags, marble in white
 * octagons with dark dots at their corners, and the two metals in panels with
 * a rosette or a lozenge in each.
 *
 * A floor is a picture two tiles by two that repeats both ways, laid as a
 * pattern fixed to the world, so a room is one floor rather than a tile of
 * floor nine times over and a board runs on across a join between tiles.
 *
 * The ground is paved here too -- in slabs of the four stones they are cut
 * from, and the top of a foundation left as it was poured -- but in light
 * and shade rather than in colour, for the ground's own colour to show
 * through: see `slabbing` and `concrete`.
 */

/** Picture pixels to a tile, at the finest of the three. */
export const FLOOR_PPT = 256;
/** How many tiles the picture covers each way before it repeats. */
export const FLOOR_TILES = 2;
const S = FLOOR_PPT * FLOOR_TILES;

type RGB = readonly [number, number, number];
type Ctx = CanvasRenderingContext2D;
type Rand = () => number;
type Pt = [number, number];

export interface Flooring {
  /** The picture at `FLOOR_PPT` pixels to the tile, then at a half and a quarter of that. */
  mips: HTMLCanvasElement[];
  /** Whether it runs one way, as boards do, and so turns with the building. */
  runs: boolean;
  /** Its colour taken all over, for a floor that is only planned. */
  mean: RGB;
}

const rand = (seed: number): Rand => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const rgbOf = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const hexOf = (c: readonly number[]): string => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const hexA = (hex: string, a: number): string => {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};
const mix = (a: string, b: string, t: number): string => {
  const p = rgbOf(a), q = rgbOf(b);
  return hexOf(p.map((v, i) => v + (q[i] - v) * t));
};
/** A tone moved `k` of the way toward white, or toward black when `k` is negative. */
const step = (hex: string, k: number): string => (k >= 0 ? mix(hex, '#ffffff', k) : mix(hex, '#000000', -k));
const pick = <T>(xs: Array<[T, number]>, R: Rand): T => {
  let t = R() * xs.reduce((s, x) => s + x[1], 0);
  for (const [v, w] of xs) { t -= w; if (t <= 0) return v; }
  return xs[xs.length - 1][0];
};
const canvas = (w: number, h: number): [HTMLCanvasElement, Ctx] => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d') as Ctx];
};
const path = (g: Ctx, pts: Pt[], dx = 0, dy = 0): void => {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x + dx, y + dy) : g.moveTo(x + dx, y + dy)));
  g.closePath();
};
/** A polygon with each corner taken off round, `r` along each side from it or half the side, whichever is less. */
const rounded = (g: Ctx, pts: Pt[], r: number, dx = 0, dy = 0): void => {
  const n = pts.length;
  const cut = (i: number, j: number): Pt => {
    const [ax, ay] = pts[i], [bx, by] = pts[j];
    const k = Math.min(r / (Math.hypot(bx - ax, by - ay) || 1), 0.5);
    return [ax + (bx - ax) * k + dx, ay + (by - ay) * k + dy];
  };
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = cut(i, (i + n - 1) % n), b = cut(i, (i + 1) % n);
    if (i) g.lineTo(a[0], a[1]);
    else g.moveTo(a[0], a[1]);
    g.quadraticCurveTo(pts[i][0] + dx, pts[i][1] + dy, b[0], b[1]);
  }
  g.closePath();
};
/** Draw something once where it is and again a picture's width over, each way it runs off an edge. */
const wrapped = (x0: number, y0: number, x1: number, y1: number, draw: (dx: number, dy: number) => void): void => {
  const xs = [0], ys = [0];
  if (x0 < 0) xs.push(S);
  if (x1 > S) xs.push(-S);
  if (y0 < 0) ys.push(S);
  if (y1 > S) ys.push(-S);
  for (const dx of xs) for (const dy of ys) draw(dx, dy);
};

/** The light along the upper and left edges of a unit and the shade along the others, inside the path set. */
function bevel(g: Ctx, draw: (dx: number, dy: number) => void, hi: string, lo: string, w: number, a: number): void {
  g.save();
  draw(0, 0);
  g.clip();
  g.lineJoin = 'round';
  g.lineWidth = w;
  draw(w * 0.55, w * 0.55);
  g.strokeStyle = hexA(hi, a);
  g.stroke();
  draw(-w * 0.55, -w * 0.55);
  g.strokeStyle = hexA(lo, a * 0.85);
  g.stroke();
  g.restore();
}

/** Specks of a lighter and a darker tone over the last path set, which the caller has clipped to. */
function specks(g: Ctx, x: number, y: number, w: number, h: number, n: number, light: string, dark: string, R: Rand, size = 1.2): void {
  for (let i = 0; i < n; i++) {
    g.fillStyle = hexA(R() < 0.5 ? light : dark, 0.25 + R() * 0.3);
    g.beginPath();
    g.arc(x + R() * w, y + R() * h, size * (0.5 + R()), 0, Math.PI * 2);
    g.fill();
  }
}

/* ---- boards --------------------------------------------------------------- */

interface Boarding {
  /** Boards to a tile, and how long one runs, in tiles. */
  across: number;
  len: [number, number];
  /** The gap between two boards. */
  bed: string;
  tones: Array<[string, number]>;
  hi: string;
  lo: string;
  ink: string;
  grain: string;
  /** How often a board has a knot in it, and whether one is fixed down at its ends with nails or with pegs. */
  knots: number;
  fix: 'nail' | 'peg';
  /** Light flecks across the grain, which is what oak shows when it is quartered. */
  flecks?: number;
  seed: number;
}

/**
 * Boards laid side by side and butted end to end at random, every butt a
 * dark line across the board with its fixings either side: nail heads on
 * pine, oak pegs on oak.
 */
function boards(o: Boarding): HTMLCanvasElement {
  const [c, g] = canvas(S, S);
  g.fillStyle = o.bed;
  g.fillRect(0, 0, S, S);
  const R = rand(o.seed);
  const rows = o.across * FLOOR_TILES, h = S / rows, gap = 2.4;
  for (let r = 0; r < rows; r++) {
    const y0 = r * h + gap / 2, hh = h - gap;
    let x = R() * S;
    const end = x + S;
    while (x < end - 1) {
      let len = (o.len[0] + R() * (o.len[1] - o.len[0])) * FLOOR_PPT;
      if (end - (x + len) < o.len[0] * FLOOR_PPT * 0.6) len = end - x;
      const tone = pick(o.tones, R);
      // Everything random about the board first, so every copy of it at a wrap is the same board.
      const grain = Array.from({ length: 3 + Math.floor(R() * 3) }, () => ({ v: 0.12 + R() * 0.76, amp: 0.4 + R() * 1.2, wave: 60 + R() * 140, ph: R() * 7 }));
      const knot = R() < o.knots ? { u: 0.15 + R() * 0.7, v: 0.3 + R() * 0.4, r: 3 + R() * 3 } : null;
      const flecks = o.flecks ? Array.from({ length: Math.floor(len / 18 * o.flecks) }, () => [R(), 0.15 + R() * 0.7, 3 + R() * 6] as const) : [];
      const x0 = x;
      wrapped(x0, y0, x0 + len, y0 + hh, (dx) => {
        const X = x0 + dx;
        g.save();
        g.beginPath();
        g.rect(X + 0.8, y0, len - 1.6, hh);
        g.clip();
        g.fillStyle = tone;
        g.fillRect(X, y0, len, hh);
        g.lineCap = 'round';
        for (const s of grain) {
          g.strokeStyle = hexA(o.grain, 0.22);
          g.lineWidth = 1;
          g.beginPath();
          for (let u = 0; u <= len; u += 8) {
            const yy = y0 + hh * s.v + Math.sin(u / s.wave * Math.PI * 2 + s.ph) * s.amp;
            if (u) g.lineTo(X + u, yy);
            else g.moveTo(X + u, yy);
          }
          g.stroke();
        }
        for (const [u, v, l] of flecks) {
          g.strokeStyle = hexA(o.hi, 0.35);
          g.lineWidth = 1.2;
          g.beginPath();
          g.moveTo(X + u * len, y0 + v * hh);
          g.lineTo(X + u * len + l, y0 + v * hh + (l > 6 ? 0.8 : -0.5));
          g.stroke();
        }
        if (knot) {
          const kx = X + knot.u * len, ky = y0 + knot.v * hh;
          g.strokeStyle = hexA(o.grain, 0.35);
          g.lineWidth = 1;
          g.beginPath();
          g.ellipse(kx, ky, knot.r * 2.4, knot.r * 1.25, 0, 0, Math.PI * 2);
          g.stroke();
          g.fillStyle = hexA(step(tone, -0.3), 0.9);
          g.beginPath();
          g.ellipse(kx, ky, knot.r * 1.2, knot.r * 0.8, 0, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = hexA(o.ink, 0.6);
          g.beginPath();
          g.ellipse(kx, ky, knot.r * 0.5, knot.r * 0.35, 0, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = hexA(o.hi, 0.55);
        g.fillRect(X, y0, len, 2);
        g.fillStyle = hexA(o.lo, 0.5);
        g.fillRect(X, y0 + hh - 2, len, 2);
        g.restore();
        // The butt, and what holds each end down.
        g.fillStyle = hexA(o.ink, 0.85);
        g.fillRect(X + len - 1.2, y0, 1.6, hh);
        for (const ex of [X + 7, X + len - 8]) {
          for (const v of [0.3, 0.7]) {
            const py = y0 + hh * v;
            if (o.fix === 'nail') {
              g.fillStyle = hexA(o.ink, 0.8);
              g.beginPath(); g.arc(ex, py, 1.5, 0, Math.PI * 2); g.fill();
              g.fillStyle = hexA(o.hi, 0.6);
              g.fillRect(ex - 1, py - 1.2, 1, 1);
            } else {
              g.fillStyle = step(tone, -0.28);
              g.beginPath(); g.arc(ex, py, 3, 0, Math.PI * 2); g.fill();
              g.strokeStyle = hexA(o.ink, 0.7);
              g.lineWidth = 1;
              g.stroke();
              g.fillStyle = hexA(o.hi, 0.5);
              g.beginPath(); g.arc(ex - 0.8, py - 0.8, 1, 0, Math.PI * 2); g.fill();
            }
          }
        }
      });
      x += len;
    }
  }
  return c;
}

/* ---- split logs ------------------------------------------------------------ */

/**
 * Split logs laid flat face up, which is what a floor of logs is: the adzed
 * face is walked on and the round of the log falls away either side of it
 * into a dark gap, with a sliver of bark left along the edge. Each is pegged
 * at its ends, and its ends are checked where they dried.
 */
function puncheons(o: { across: number; len: [number, number]; bed: string; tones: Array<[string, number]>; hi: string; lo: string; ink: string; bark: string; seed: number }): HTMLCanvasElement {
  const [c, g] = canvas(S, S);
  g.fillStyle = o.bed;
  g.fillRect(0, 0, S, S);
  const R = rand(o.seed);
  const rows = o.across * FLOOR_TILES, h = S / rows, gap = 3.5;
  for (let r = 0; r < rows; r++) {
    const y0 = r * h + gap / 2, hh = h - gap;
    let x = R() * S;
    const end = x + S;
    while (x < end - 1) {
      let len = (o.len[0] + R() * (o.len[1] - o.len[0])) * FLOOR_PPT;
      if (end - (x + len) < o.len[0] * FLOOR_PPT * 0.6) len = end - x;
      const tone = pick(o.tones, R);
      const adze = Array.from({ length: Math.floor(len / 13) }, () => [R(), R() - 0.5] as const);
      const checks = Array.from({ length: 2 + Math.floor(R() * 3) }, () => [R() * 0.6 + 0.2, 4 + R() * 9, R() < 0.5] as const);
      const barkL = 0.8 + R() * 1.4, barkR = 0.8 + R() * 1.4, taper = (R() - 0.5) * 3;
      const x0 = x;
      wrapped(x0, y0, x0 + len, y0 + hh, (dx) => {
        const X = x0 + dx;
        const body = (): void => {
          g.beginPath();
          g.moveTo(X + 2, y0 + 1);
          g.lineTo(X + len - 2, y0 + 1 + taper * 0.3);
          g.quadraticCurveTo(X + len + 0.5, y0 + hh / 2, X + len - 2, y0 + hh - 1);
          g.lineTo(X + 2, y0 + hh - 1 - taper * 0.3);
          g.quadraticCurveTo(X - 0.5, y0 + hh / 2, X + 2, y0 + 1);
          g.closePath();
        };
        g.save();
        body();
        g.clip();
        const grad = g.createLinearGradient(0, y0, 0, y0 + hh);
        grad.addColorStop(0, step(tone, -0.34));
        grad.addColorStop(0.2, step(tone, -0.04));
        grad.addColorStop(0.32, tone);
        grad.addColorStop(0.68, tone);
        grad.addColorStop(0.8, step(tone, -0.1));
        grad.addColorStop(1, step(tone, -0.42));
        g.fillStyle = grad;
        g.fillRect(X - 2, y0 - 1, len + 4, hh + 2);
        // The light along the flat of it, and the adze's marks across.
        g.fillStyle = hexA(o.hi, 0.22);
        g.fillRect(X, y0 + hh * 0.26, len, hh * 0.12);
        g.strokeStyle = hexA(o.lo, 0.3);
        g.lineWidth = 1.1;
        for (const [u, k] of adze) {
          const ax = X + u * len;
          g.beginPath();
          g.moveTo(ax, y0 + hh * 0.28);
          g.quadraticCurveTo(ax + 3 + k * 2, y0 + hh * 0.5, ax + k * 3, y0 + hh * 0.72);
          g.stroke();
        }
        // Bark left along either edge.
        g.fillStyle = hexA(o.bark, 0.85);
        g.fillRect(X, y0, len, barkL);
        g.fillRect(X, y0 + hh - barkR, len, barkR);
        g.restore();
        body();
        g.strokeStyle = hexA(o.ink, 0.7);
        g.lineWidth = 1.3;
        g.stroke();
        // Checks in the ends, and a peg in each.
        g.strokeStyle = hexA(o.ink, 0.55);
        g.lineWidth = 1;
        for (const [v, l, left] of checks) {
          const ex = left ? X + 2 : X + len - 2;
          g.beginPath();
          g.moveTo(ex, y0 + hh * v);
          g.lineTo(ex + (left ? l : -l), y0 + hh * v + (v - 0.5) * 4);
          g.stroke();
        }
        for (const ex of [X + 10, X + len - 11]) {
          g.fillStyle = step(tone, -0.32);
          g.beginPath(); g.arc(ex, y0 + hh / 2, 3.4, 0, Math.PI * 2); g.fill();
          g.strokeStyle = hexA(o.ink, 0.7);
          g.stroke();
        }
      });
      x += len;
    }
  }
  return c;
}

/* ---- stones cut to a pattern ----------------------------------------------- */

interface Stone {
  bed: string;
  tones: Array<[string, number]>;
  hi: string;
  lo: string;
  ink: string;
  /** Specks of a lighter and a darker tone in the face, how many to a stone of a hundred pixels square. */
  speck: [string, string, number];
}

/** One stone of a floor: its face, the light and shade round its arris, its specks and its outline. */
function stone(g: Ctx, shape: (dx: number, dy: number) => void, box: [number, number, number, number], tone: string, o: Stone, R: Rand, extra?: (x: number, y: number) => void): void {
  const [x0, y0, x1, y1] = box;
  const seed = Math.floor(R() * 1e9);
  wrapped(x0, y0, x1, y1, (dx, dy) => {
    const r = rand(seed);
    g.save();
    shape(dx, dy);
    g.fillStyle = tone;
    g.fill();
    g.clip();
    const area = (x1 - x0) * (y1 - y0);
    specks(g, x0 + dx, y0 + dy, x1 - x0, y1 - y0, Math.round((area / 10000) * o.speck[2]), o.speck[0], o.speck[1], r);
    extra?.(dx, dy);
    g.restore();
    bevel(g, (ex, ey) => shape(dx + ex, dy + ey), o.hi, o.lo, 2.6, 0.6);
    shape(dx, dy);
    g.strokeStyle = hexA(o.ink, 0.6);
    g.lineWidth = 1.3;
    g.stroke();
  });
}

/**
 * Crazy paving: stones of no shape in particular, fitted to one another with
 * a joint of mortar between, which is what a floor of rubble comes to. Each
 * is the patch of floor nearer one seed than any other, the seeds scattered
 * over a grid so that no stone is much bigger than its neighbours, cut back
 * from its neighbours by half a joint and its corners rounded.
 */
function crazy(o: Stone & { cells: number; joint: number; seed: number }): HTMLCanvasElement {
  const [c, g] = canvas(S, S);
  g.fillStyle = o.bed;
  g.fillRect(0, 0, S, S);
  const R = rand(o.seed);
  const n = o.cells, cell = S / n;
  const seeds: Pt[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) seeds.push([(i + 0.5 + (R() - 0.5) * 0.7) * cell, (j + 0.5 + (R() - 0.5) * 0.7) * cell]);
  for (const p of seeds) {
    // The square round it, cut back by every neighbour's bisector, the neighbours taken across the wrap.
    let poly: Pt[] = [[p[0] - cell * 1.6, p[1] - cell * 1.6], [p[0] + cell * 1.6, p[1] - cell * 1.6], [p[0] + cell * 1.6, p[1] + cell * 1.6], [p[0] - cell * 1.6, p[1] + cell * 1.6]];
    for (const q0 of seeds) {
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        const q: Pt = [q0[0] + ox, q0[1] + oy];
        const ddx = q[0] - p[0], ddy = q[1] - p[1], d = Math.hypot(ddx, ddy);
        if (d < 1e-6 || d > cell * 2.6) continue;
        const nx = ddx / d, ny = ddy / d, lim = d / 2 - o.joint / 2;
        // Keep what lies no further than `lim` toward q.
        const out: Pt[] = [];
        for (let k = 0; k < poly.length; k++) {
          const a = poly[k], b = poly[(k + 1) % poly.length];
          const da = (a[0] - p[0]) * nx + (a[1] - p[1]) * ny - lim, db = (b[0] - p[0]) * nx + (b[1] - p[1]) * ny - lim;
          if (da <= 0) out.push(a);
          if ((da < 0) !== (db < 0)) {
            const t = da / (da - db);
            out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
          }
        }
        poly = out;
      }
    }
    if (poly.length < 3) continue;
    const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]);
    const tone = pick(o.tones, R);
    stone(g, (dx, dy) => rounded(g, poly, 7, dx, dy), [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], tone, o, R);
  }
  return c;
}

/**
 * Stones of a few sizes fitted together at random, square-cut: every one a
 * whole number of units each way, laid into a grid a cell at a time, the
 * first size that fits taken at each cell still empty, so the joints never
 * run straight for long.
 */
function fitted(o: Stone & { unit: number; sizes: Array<[[number, number], number]>; joint: number; seed: number; face?: (g: Ctx, x: number, y: number, w: number, h: number, R: Rand) => void }): HTMLCanvasElement {
  const [c, g] = canvas(S, S);
  g.fillStyle = o.bed;
  g.fillRect(0, 0, S, S);
  const R = rand(o.seed);
  const n = Math.round(S / o.unit), u = S / n;
  const full = new Uint8Array(n * n);
  const free = (i: number, j: number, w: number, h: number): boolean => {
    for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) if (full[((j + b) % n) * n + ((i + a) % n)]) return false;
    return true;
  };
  const bySize = [...o.sizes].sort((p, q) => q[0][0] * q[0][1] - p[0][0] * p[0][1]).map((s) => s[0]);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (full[j * n + i]) continue;
      let size: [number, number] = [1, 1];
      const tried = new Set<string>();
      for (let k = 0; k < 6; k++) {
        const s = pick(o.sizes, R);
        tried.add(`${s[0]},${s[1]}`);
        if (free(i, j, s[0], s[1])) { size = s; break; }
      }
      if (size[0] === 1 && size[1] === 1) {
        for (const s of bySize) if (!tried.has(`${s[0]},${s[1]}`) && free(i, j, s[0], s[1])) { size = s; break; }
        if (size[0] === 1 && size[1] === 1 && !free(i, j, 1, 1)) continue;
      }
      for (let b = 0; b < size[1]; b++) for (let a = 0; a < size[0]; a++) full[((j + b) % n) * n + ((i + a) % n)] = 1;
      const jt = o.joint / 2;
      const x0 = i * u + jt + (R() - 0.5), y0 = j * u + jt + (R() - 0.5);
      const x1 = (i + size[0]) * u - jt + (R() - 0.5), y1 = (j + size[1]) * u - jt + (R() - 0.5);
      const pts: Pt[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      const tone = pick(o.tones, R);
      const face = o.face;
      const fseed = Math.floor(R() * 1e9);
      stone(g, (dx, dy) => roundRect(g, pts, 3, dx, dy), [x0, y0, x1, y1], tone, o, R,
        face ? (dx, dy) => face(g, x0 + dx, y0 + dy, x1 - x0, y1 - y0, rand(fseed)) : undefined);
    }
  }
  return c;
}

/** A rectangle given by its corners, its corners rounded by `r`. */
function roundRect(g: Ctx, pts: Pt[], r: number, dx = 0, dy = 0): void {
  const [[x0, y0], , [x1, y1]] = pts;
  g.beginPath();
  g.roundRect(x0 + dx, y0 + dy, x1 - x0, y1 - y0, r);
}

/**
 * Flags laid in courses, every course half a flag on from the last, each
 * dressed as ashlar is: a margin drafted round the edge with a narrow chisel
 * and the face inside it boasted, struck all over in parallel lines.
 */
function coursed(o: Stone & { w: number; h: number; joint: number; margin: number; tooling: string; seed: number }): HTMLCanvasElement {
  const [c, g] = canvas(S, S);
  g.fillStyle = o.bed;
  g.fillRect(0, 0, S, S);
  const R = rand(o.seed);
  const rows = Math.round(S / o.h), cols = Math.round(S / o.w);
  const h = S / rows, w = S / cols, jt = o.joint / 2;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * w / 2;
    for (let i = 0; i < cols; i++) {
      const x0 = i * w + off + jt + (R() - 0.5) * 0.8, y0 = r * h + jt;
      const x1 = x0 + w - o.joint + (R() - 0.5) * 0.8, y1 = y0 + h - o.joint;
      const pts: Pt[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      const tone = pick(o.tones, R);
      const angle = (R() - 0.5) * 0.5 + (R() < 0.5 ? 0.6 : -0.6);
      stone(g, (dx, dy) => roundRect(g, pts, 2, dx, dy), [x0, y0, x1, y1], tone, o, R, (dx, dy) => {
        const m = o.margin;
        // The boasting: the face struck all over one way, inside the margin.
        g.save();
        g.beginPath();
        g.rect(x0 + dx + m, y0 + dy + m, x1 - x0 - 2 * m, y1 - y0 - 2 * m);
        g.clip();
        g.strokeStyle = hexA(o.tooling, 0.2);
        g.lineWidth = 1;
        const cx = (x0 + x1) / 2 + dx, cy = (y0 + y1) / 2 + dy, span = Math.hypot(x1 - x0, y1 - y0);
        const ca = Math.cos(angle), sa = Math.sin(angle);
        for (let k = -span / 2; k < span / 2; k += 4.2) {
          g.beginPath();
          g.moveTo(cx + ca * k - sa * span, cy + sa * k + ca * span);
          g.lineTo(cx + ca * k + sa * span, cy + sa * k - ca * span);
          g.stroke();
        }
        g.restore();
        // And the margin round it: a line where the chisel stopped.
        g.strokeStyle = hexA(o.lo, 0.45);
        g.lineWidth = 1;
        g.strokeRect(x0 + dx + m, y0 + dy + m, x1 - x0 - 2 * m, y1 - y0 - 2 * m);
        g.strokeStyle = hexA(o.hi, 0.35);
        g.strokeRect(x0 + dx + m + 1, y0 + dy + m + 1, x1 - x0 - 2 * m, y1 - y0 - 2 * m);
      });
    }
  }
  return c;
}

/**
 * Bricks on edge in herringbone: every brick at right angles to the next,
 * running in zigzags across the floor, each twice as long as it is wide.
 * One brick along and one across make up the pattern, repeated a brick's
 * width along the diagonal one way and two the other; so a picture a whole
 * number of bricks across repeats as a floor does.
 */
function herringbone(o: Stone & { w: number; joint: number; seed: number }): HTMLCanvasElement {
  const [c, g] = canvas(S, S);
  g.fillStyle = o.bed;
  g.fillRect(0, 0, S, S);
  const W = o.w, jt = o.joint / 2;
  const tones = new Map<string, string>();
  const R = rand(o.seed);
  const n = Math.ceil(S / W) + 4;
  for (let a = -n; a <= n; a++) {
    for (let b = -n; b <= n; b++) {
      const ox = W * a + 2 * W * b, oy = W * a - 2 * W * b;
      for (const [bx, by, bw, bh] of [[0, 0, 2 * W, W], [0, W, W, 2 * W]]) {
        const x0 = ox + bx + jt, y0 = oy + by + jt, x1 = ox + bx + bw - jt, y1 = oy + by + bh - jt;
        if (x1 < -2 || y1 < -2 || x0 > S + 2 || y0 > S + 2) continue;
        // A brick's colour is its own wherever the picture repeats it.
        const key = `${(((x0 % S) + S) % S).toFixed(1)},${(((y0 % S) + S) % S).toFixed(1)}`;
        let tone = tones.get(key);
        if (!tone) { tone = pick(o.tones, R); tones.set(key, tone); }
        const r = rand(Math.floor(((x0 % S) + S) % S) * 7919 + Math.floor(((y0 % S) + S) % S) * 104729 + o.seed);
        const pts: Pt[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        g.save();
        roundRect(g, pts, 3.5);
        g.fillStyle = tone;
        g.fill();
        g.clip();
        specks(g, x0, y0, x1 - x0, y1 - y0, 7, o.speck[0], o.speck[1], r, 1.3);
        g.restore();
        bevel(g, (ex, ey) => roundRect(g, pts, 3.5, ex, ey), o.hi, o.lo, 2.4, 0.6);
        roundRect(g, pts, 3.5);
        g.strokeStyle = hexA(o.ink, 0.55);
        g.lineWidth = 1.2;
        g.stroke();
      }
    }
  }
  return c;
}

/**
 * Square tiles made by hand: no two edges quite straight, the corners soft,
 * each fired a little differently with a flash of darker clay where the kiln
 * was hottest, and set in a wide joint.
 */
function handmade(o: Stone & { unit: number; joint: number; seed: number }): HTMLCanvasElement {
  const [c, g] = canvas(S, S);
  g.fillStyle = o.bed;
  g.fillRect(0, 0, S, S);
  const R = rand(o.seed);
  const n = Math.round(S / o.unit), u = S / n, jt = o.joint / 2;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x0 = i * u + jt, y0 = j * u + jt, x1 = (i + 1) * u - jt, y1 = (j + 1) * u - jt;
      const wob = (): number => (R() - 0.5) * 3;
      const pts: Pt[] = [
        [x0 + wob(), y0 + wob()], [(x0 + x1) / 2 + wob(), y0 + wob()], [x1 + wob(), y0 + wob()], [x1 + wob(), (y0 + y1) / 2 + wob()],
        [x1 + wob(), y1 + wob()], [(x0 + x1) / 2 + wob(), y1 + wob()], [x0 + wob(), y1 + wob()], [x0 + wob(), (y0 + y1) / 2 + wob()],
      ];
      const tone = pick(o.tones, R);
      const flash = R() < 0.35 ? { x: R() < 0.5 ? x0 : x1, y: R() < 0.5 ? y0 : y1, r: u * (0.35 + R() * 0.3) } : null;
      const blots = Array.from({ length: 3 }, () => [x0 + R() * (x1 - x0), y0 + R() * (y1 - y0), 6 + R() * 12, R() < 0.5] as const);
      stone(g, (dx, dy) => rounded(g, pts, 7, dx, dy), [x0 - 2, y0 - 2, x1 + 2, y1 + 2], tone, o, R, (dx, dy) => {
        for (const [bx, by, br, light] of blots) {
          const grad = g.createRadialGradient(bx + dx, by + dy, 0, bx + dx, by + dy, br);
          grad.addColorStop(0, hexA(light ? o.hi : o.lo, 0.22));
          grad.addColorStop(1, hexA(light ? o.hi : o.lo, 0));
          g.fillStyle = grad;
          g.fillRect(bx + dx - br, by + dy - br, br * 2, br * 2);
        }
        if (flash) {
          const grad = g.createRadialGradient(flash.x + dx, flash.y + dy, 0, flash.x + dx, flash.y + dy, flash.r);
          grad.addColorStop(0, hexA(step(tone, -0.3), 0.55));
          grad.addColorStop(1, hexA(step(tone, -0.3), 0));
          g.fillStyle = grad;
          g.fillRect(flash.x + dx - flash.r, flash.y + dy - flash.r, flash.r * 2, flash.r * 2);
        }
      });
    }
  }
  return c;
}

/**
 * Octagon and dot: white marble cut in octagons, their corners taken off
 * square so four of them meet round a small square of dark marble set on its
 * point, each octagon veined on its own.
 */
function octagons(o: Stone & { unit: number; joint: number; dot: Stone; vein: string; seed: number }): HTMLCanvasElement {
  const [c, g] = canvas(S, S);
  g.fillStyle = o.bed;
  g.fillRect(0, 0, S, S);
  const R = rand(o.seed);
  const n = Math.round(S / o.unit), u = S / n, cut = u / (2 + Math.SQRT2), jt = o.joint / 2;
  const veins = (dx: number, dy: number, x: number, y: number, size: number, ink: string, r: Rand): void => {
    const k = 1 + Math.floor(r() * 2);
    for (let v = 0; v < k; v++) {
      const ang = r() * Math.PI;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      let px = x + dx - ca * size + (r() - 0.5) * size * 0.6, py = y + dy - sa * size + (r() - 0.5) * size * 0.6;
      g.strokeStyle = hexA(ink, 0.55 + r() * 0.3);
      g.lineWidth = 0.9 + r() * 1.4;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(px, py);
      for (let s = 0; s < 7; s++) {
        px += ca * size * 0.32 + (r() - 0.5) * size * 0.22;
        py += sa * size * 0.32 + (r() - 0.5) * size * 0.22;
        g.lineTo(px, py);
      }
      g.stroke();
    }
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x0 = i * u, y0 = j * u, x1 = x0 + u, y1 = y0 + u;
      const oct: Pt[] = [
        [x0 + cut + jt, y0 + jt], [x1 - cut - jt, y0 + jt], [x1 - jt, y0 + cut + jt], [x1 - jt, y1 - cut - jt],
        [x1 - cut - jt, y1 - jt], [x0 + cut + jt, y1 - jt], [x0 + jt, y1 - cut - jt], [x0 + jt, y0 + cut + jt],
      ];
      const tone = pick(o.tones, R);
      const vs = Math.floor(R() * 1e9);
      stone(g, (dx, dy) => path(g, oct, dx, dy), [x0, y0, x1, y1], tone, o, R, (dx, dy) => veins(dx, dy, (x0 + x1) / 2, (y0 + y1) / 2, u * 0.55, o.vein, rand(vs)));
      // The dot at its top-left corner, which the grid's wrap turns into every corner's.
      const d = cut - jt * 1.4;
      const dot: Pt[] = [[x0, y0 - d], [x0 + d, y0], [x0, y0 + d], [x0 - d, y0]];
      const dtone = pick(o.dot.tones, R);
      const ds = Math.floor(R() * 1e9);
      stone(g, (dx, dy) => path(g, dot, dx, dy), [x0 - d, y0 - d, x0 + d, y0 + d], dtone, o.dot, R, (dx, dy) => veins(dx, dy, x0, y0, d, o.dot.speck[0], rand(ds)));
    }
  }
  return c;
}

/**
 * Panels of beaten metal, each with a moulded frame round it lit from the
 * upper left, a field inside, a boss at every corner of the field and a
 * rosette in the middle of it -- or, every other panel, a lozenge.
 */
function panels(o: { unit: number; bed: string; field: string; hi: string; lo: string; ink: string; boss: string; seed: number }): HTMLCanvasElement {
  const [c, g] = canvas(S, S);
  g.fillStyle = o.bed;
  g.fillRect(0, 0, S, S);
  const n = Math.round(S / o.unit), u = S / n, jt = 1.2, fr = u * 0.085;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x0 = i * u + jt, y0 = j * u + jt, x1 = (i + 1) * u - jt, y1 = (j + 1) * u - jt;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      // The frame: four mitred bevels.
      const bev = (pts: Pt[], fill: string): void => { path(g, pts); g.fillStyle = fill; g.fill(); };
      bev([[x0, y0], [x1, y0], [x1 - fr, y0 + fr], [x0 + fr, y0 + fr]], o.hi);
      bev([[x0, y0], [x0 + fr, y0 + fr], [x0 + fr, y1 - fr], [x0, y1]], step(o.hi, -0.08));
      bev([[x1, y0], [x1, y1], [x1 - fr, y1 - fr], [x1 - fr, y0 + fr]], o.lo);
      bev([[x0, y1], [x0 + fr, y1 - fr], [x1 - fr, y1 - fr], [x1, y1]], step(o.lo, -0.1));
      const grad = g.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, step(o.field, 0.1));
      grad.addColorStop(1, step(o.field, -0.08));
      g.fillStyle = grad;
      g.fillRect(x0 + fr, y0 + fr, x1 - x0 - 2 * fr, y1 - y0 - 2 * fr);
      g.strokeStyle = hexA(o.ink, 0.7);
      g.lineWidth = 1.2;
      g.strokeRect(x0, y0, x1 - x0, y1 - y0);
      g.strokeStyle = hexA(o.ink, 0.5);
      g.strokeRect(x0 + fr, y0 + fr, x1 - x0 - 2 * fr, y1 - y0 - 2 * fr);
      // A fillet inside the field.
      const f = fr * 1.9;
      g.strokeStyle = hexA(o.lo, 0.55);
      g.strokeRect(x0 + f, y0 + f, x1 - x0 - 2 * f, y1 - y0 - 2 * f);
      g.strokeStyle = hexA(o.hi, 0.6);
      g.strokeRect(x0 + f + 1.2, y0 + f + 1.2, x1 - x0 - 2 * f, y1 - y0 - 2 * f);
      const boss = (bx: number, by: number, r: number): void => {
        const bg = g.createRadialGradient(bx - r * 0.35, by - r * 0.35, 0, bx, by, r);
        bg.addColorStop(0, step(o.boss, 0.55));
        bg.addColorStop(0.6, o.boss);
        bg.addColorStop(1, o.lo);
        g.fillStyle = bg;
        g.beginPath(); g.arc(bx, by, r, 0, Math.PI * 2); g.fill();
        g.strokeStyle = hexA(o.ink, 0.65);
        g.lineWidth = 1;
        g.stroke();
      };
      const k = f + u * 0.07;
      for (const [bx, by] of [[x0 + k, y0 + k], [x1 - k, y0 + k], [x1 - k, y1 - k], [x0 + k, y1 - k]] as Pt[]) boss(bx, by, u * 0.03);
      if ((i + j) % 2 === 0) {
        // The rosette: eight petals round a boss.
        for (let p = 0; p < 8; p++) {
          const a = (p / 8) * Math.PI * 2;
          g.save();
          g.translate(cx + Math.cos(a) * u * 0.11, cy + Math.sin(a) * u * 0.11);
          g.rotate(a);
          g.beginPath();
          g.ellipse(0, 0, u * 0.1, u * 0.045, 0, 0, Math.PI * 2);
          const pg = g.createLinearGradient(-u * 0.05, -u * 0.05, u * 0.05, u * 0.05);
          pg.addColorStop(0, step(o.field, 0.45));
          pg.addColorStop(1, step(o.field, -0.12));
          g.fillStyle = pg;
          g.fill();
          g.strokeStyle = hexA(o.ink, 0.6);
          g.lineWidth = 1;
          g.stroke();
          g.restore();
        }
        boss(cx, cy, u * 0.055);
      } else {
        // The lozenge: a diamond raised off the field with a boss in it.
        const d = u * 0.2;
        const lz: Pt[] = [[cx, cy - d], [cx + d, cy], [cx, cy + d], [cx - d, cy]];
        path(g, lz);
        g.fillStyle = step(o.field, 0.05);
        g.fill();
        bevel(g, (ex, ey) => path(g, lz, ex, ey), step(o.hi, 0.2), o.lo, 2.4, 0.8);
        path(g, lz);
        g.strokeStyle = hexA(o.ink, 0.6);
        g.lineWidth = 1.1;
        g.stroke();
        boss(cx, cy, u * 0.04);
      }
    }
  }
  return c;
}

/* ---- the floors ------------------------------------------------------------- */

/** A slate's face: riven, split along its bed so it lies in shallow steps, one edge of each catching the light. */
function riven(hi: string, lo: string): (g: Ctx, x: number, y: number, w: number, h: number, R: Rand) => void {
  return (g, x, y, w, h, R) => {
    const ang = (R() - 0.5) * 0.9;
    const k = 2 + Math.floor(R() * 3);
    for (let i = 0; i < k; i++) {
      const t = (i + 0.5 + (R() - 0.5) * 0.6) / k;
      const px = x + w * t, py = y + h * (0.5 + (R() - 0.5) * 0.4);
      const len = Math.max(w, h) * (0.5 + R() * 0.5);
      const ca = Math.cos(ang + Math.PI / 2), sa = Math.sin(ang + Math.PI / 2);
      g.strokeStyle = hexA(hi, 0.35);
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(px - ca * len / 2, py - sa * len / 2);
      g.quadraticCurveTo(px + (R() - 0.5) * 8, py + (R() - 0.5) * 8, px + ca * len / 2, py + sa * len / 2);
      g.stroke();
      g.strokeStyle = hexA(lo, 0.3);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(px - ca * len / 2 + 1.5, py - sa * len / 2 + 1.5);
      g.quadraticCurveTo(px + 1.5, py + 1.5, px + ca * len / 2 + 1.5, py + sa * len / 2 + 1.5);
      g.stroke();
    }
  };
}

/** Sandstone's face: bedding lines across it and, now and then, the ghost of a shell. */
function bedded(ink: string, a = 0.16): (g: Ctx, x: number, y: number, w: number, h: number, R: Rand) => void {
  return (g, x, y, w, h, R) => {
    g.strokeStyle = hexA(ink, a);
    g.lineWidth = 1;
    const k = 2 + Math.floor(R() * 3);
    for (let i = 0; i < k; i++) {
      const py = y + h * (0.15 + R() * 0.7);
      g.beginPath();
      g.moveTo(x, py);
      g.bezierCurveTo(x + w * 0.3, py + (R() - 0.5) * 6, x + w * 0.7, py + (R() - 0.5) * 6, x + w, py + (R() - 0.5) * 4);
      g.stroke();
    }
    if (R() < 0.18) {
      const sx = x + w * (0.25 + R() * 0.5), sy = y + h * (0.25 + R() * 0.5), r = 3 + R() * 3;
      g.strokeStyle = hexA(ink, 0.35);
      g.beginPath();
      for (let a = 0; a < Math.PI * 4; a += 0.3) {
        const rr = r * (a / (Math.PI * 4));
        const px = sx + Math.cos(a) * rr, py = sy + Math.sin(a) * rr;
        if (a) g.lineTo(px, py);
        else g.moveTo(px, py);
      }
      g.stroke();
    }
  };
}

/** What each material lays a floor in, and whether it runs one way. */
function laid(material: string): { img: HTMLCanvasElement; runs: boolean } | null {
  switch (material) {
    case 'plank':
      return {
        runs: true,
        img: boards({
          across: 7, len: [1.1, 2.6], bed: '#5f4d3f',
          tones: [['#c9b395', 3], ['#bea789', 2], ['#d0bb9d', 2], ['#c4aa8a', 2], ['#b8a083', 1]],
          hi: '#e3d2b8', lo: '#9c8468', ink: '#5a4638', grain: '#8a7058', knots: 0.28, fix: 'nail', seed: 211,
        }),
      };
    case 'timbercraft':
      return {
        runs: true,
        img: boards({
          across: 5, len: [1.4, 3.2], bed: '#4a3a32',
          tones: [['#a8896b', 3], ['#9c7e61', 2], ['#b39376', 2], ['#a3845f', 2], ['#95775c', 1]],
          hi: '#c9ab8c', lo: '#7a604a', ink: '#42322f', grain: '#6e5642', knots: 0.12, fix: 'peg', flecks: 0.6, seed: 223,
        }),
      };
    case 'log':
      return {
        runs: true,
        img: puncheons({
          across: 4, len: [1.3, 2.8], bed: '#3a2f2a',
          tones: [['#a58e78', 3], ['#9b8672', 2], ['#ae977f', 2], ['#98826c', 1]],
          hi: '#c8b198', lo: '#6c5a4c', ink: '#473935', bark: '#5b4739', seed: 227,
        }),
      };
    case 'cobblestone':
      return {
        runs: false,
        img: crazy({
          cells: 9, joint: 7, seed: 229, bed: '#aaa392',
          tones: [['#ded5c4', 3], ['#d5cbb8', 2], ['#e6ded0', 2], ['#cfc6b3', 2], ['#d4d2bf', 1], ['#dccfbf', 1]],
          hi: '#f4eee4', lo: '#a89e89', ink: '#8d846f', speck: ['#f2ece0', '#b3aa96', 9],
        }),
      };
    case 'slate':
      return {
        runs: false,
        img: fitted({
          unit: 32, joint: 4, seed: 233, bed: '#34364a',
          sizes: [[[4, 3], 3], [[3, 4], 2], [[3, 3], 3], [[4, 2], 2], [[2, 3], 2], [[3, 2], 2], [[2, 2], 1], [[2, 1], 0.5], [[1, 2], 0.5]],
          tones: [['#6b7089', 3], ['#646983', 3], ['#727792', 2], ['#5e637c', 2], ['#6a6a86', 1]],
          hi: '#8f94ad', lo: '#474b61', ink: '#2e3042', speck: ['#8a8fa8', '#4c5066', 4], face: riven('#9499b2', '#454a60'),
        }),
      };
    case 'stone_brick':
      return {
        runs: false,
        img: coursed({
          w: 128, h: 85.33, joint: 5, margin: 7, seed: 239, bed: '#8a8c98', tooling: '#6f7280',
          tones: [['#c3c5cd', 3], ['#bbbec8', 2], ['#c9c6bd', 2], ['#b5b9c4', 2], ['#cdcbc3', 1]],
          hi: '#e1e3e9', lo: '#9a9eab', ink: '#6b6d7d', speck: ['#dcdde3', '#a3a6b1', 6],
        }),
      };
    case 'clay_bricks':
      return {
        runs: false,
        img: herringbone({
          w: 32, joint: 4, seed: 241, bed: '#b3a296',
          tones: [['#c47c6e', 3], ['#bb7266', 2], ['#c98a7c', 2], ['#b06a5e', 2], ['#d09181', 1], ['#a96559', 1]],
          hi: '#dea493', lo: '#98594e', ink: '#7e4a44', speck: ['#dba08f', '#94564b', 0],
        }),
      };
    case 'clay_adobe':
      return {
        runs: false,
        img: handmade({
          unit: 64, joint: 8, seed: 251, bed: '#dccab3',
          tones: [['#e0a07e', 3], ['#d99876', 3], ['#e6aa88', 2], ['#d4916e', 2], ['#dca283', 1]],
          hi: '#f3c6aa', lo: '#b67658', ink: '#a2654c', speck: ['#f0bca0', '#b8765a', 5],
        }),
      };
    case 'sandstone':
      return {
        runs: false,
        img: fitted({
          unit: 32, joint: 5, seed: 257, bed: '#c4a98f',
          sizes: [[[3, 2], 3], [[2, 2], 3], [[2, 3], 2], [[3, 3], 2], [[4, 2], 1], [[2, 1], 1], [[1, 2], 1], [[1, 1], 0.4]],
          tones: [['#ecd9be', 3], ['#e3cfb1', 2], ['#e8d3c0', 2], ['#dcc4a5', 2], ['#efdfc9', 1], ['#e6c9b4', 1]],
          hi: '#f8eddc', lo: '#c2a483', ink: '#a5846d', speck: ['#f6ead6', '#c7aa8a', 8], face: bedded('#9a7a60'),
        }),
      };
    case 'marble':
      return {
        runs: false,
        img: octagons({
          unit: 64, joint: 2.4, seed: 263, bed: '#b8bec8', vein: '#c3c9d3',
          tones: [['#f2f4f6', 3], ['#eef0f3', 3], ['#f6f7f9', 2], ['#ebeef1', 2]],
          hi: '#ffffff', lo: '#d3d8df', ink: '#a9b0bb', speck: ['#ffffff', '#dde1e7', 2],
          dot: {
            bed: '#b8bec8', tones: [['#7a8292', 3], ['#737b8c', 2], ['#838a99', 2]],
            hi: '#a2a9b7', lo: '#5d6474', ink: '#555c6b', speck: ['#a4abb8', '#666d7c', 2],
          },
        }),
      };
    case 'ornate_silver':
      return { runs: false, img: panels({ unit: 128, bed: '#626882', field: '#c6cad6', hi: '#eef1f6', lo: '#8e92a3', ink: '#626882', boss: '#dfe2ea', seed: 269 }) };
    case 'ornate_gold':
      return { runs: false, img: panels({ unit: 128, bed: '#7d6440', field: '#d9bf85', hi: '#f6e8c0', lo: '#96784a', ink: '#7d6440', boss: '#ecd8a4', seed: 271 }) };
    default:
      return null;
  }
}

/**
 * The picture at a half and a quarter of its size, each made from the one
 * before it a half at a time, with a margin of the picture's own repeat
 * round it so its edges are averaged with what they repeat into.
 */
function mipsOf(img: HTMLCanvasElement): HTMLCanvasElement[] {
  const out = [img];
  let src = img;
  for (let k = 0; k < 2; k++) {
    const n = src.width, m = 8;
    const [pad, pg] = canvas(n + 2 * m, n + 2 * m);
    for (const dx of [-n, 0, n]) for (const dy of [-n, 0, n]) pg.drawImage(src, m + dx, m + dy);
    const [half, hg] = canvas(n / 2 + m, n / 2 + m);
    hg.imageSmoothingQuality = 'high';
    hg.drawImage(pad, 0, 0, n / 2 + m, n / 2 + m);
    const [next, ng] = canvas(n / 2, n / 2);
    ng.drawImage(half, -m / 2, -m / 2);
    out.push(next);
    src = next;
  }
  return out;
}

const lumOf = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * A floor painted: every pixel of it the paint, as much lighter or darker as
 * it was against the floor all over, so a board still reads against the gap
 * beside it and a joint against its stone.
 */
function repaint(img: HTMLCanvasElement, paint: RGB): HTMLCanvasElement {
  const [c, g] = canvas(img.width, img.height);
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, img.width, img.height);
  const px = data.data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += lumOf(px[i], px[i + 1], px[i + 2]);
  const mean = Math.max(1, sum / (px.length / 4));
  for (let i = 0; i < px.length; i += 4) {
    const k = 1 + (lumOf(px[i], px[i + 1], px[i + 2]) / mean - 1) * 0.9;
    px[i] = Math.min(255, paint[0] * k);
    px[i + 1] = Math.min(255, paint[1] * k);
    px[i + 2] = Math.min(255, paint[2] * k);
  }
  g.putImageData(data, 0, 0);
  return c;
}

/** The colour of a picture taken all over. */
function meanOf(img: HTMLCanvasElement): RGB {
  const g = img.getContext('2d') as Ctx;
  const px = g.getImageData(0, 0, img.width, img.height).data;
  let r = 0, gg = 0, b = 0;
  for (let i = 0; i < px.length; i += 4) { r += px[i]; gg += px[i + 1]; b += px[i + 2]; }
  const n = px.length / 4;
  return [r / n, gg / n, b / n];
}

const made = new Map<string, Flooring>();

/** What a floor of `material` is laid in, in `paint` if it is painted; a material with no floor of its own is laid in plank. */
export function flooring(material: string, paint?: RGB): Flooring {
  const key = paint ? `${material}:${paint.join(',')}` : material;
  const had = made.get(key);
  if (had) return had;
  let f: Flooring;
  if (paint) {
    const bare = flooring(material);
    const mips = mipsOf(repaint(bare.mips[0], paint));
    f = { mips, runs: bare.runs, mean: meanOf(mips[2]) };
  } else {
    const p = laid(material) ?? laid('plank');
    if (!p) throw new Error('no floor');
    const mips = mipsOf(p.img);
    f = { mips, runs: p.runs, mean: meanOf(mips[2]) };
  }
  made.set(key, f);
  return f;
}

/* ---- paved ground ------------------------------------------------------------ */

/**
 * A picture turned to light and shade about the grey that changes nothing
 * under `overlay`, the way the road's cobbles are painted: the ground under
 * it carries the hour's light, the slope and the wash over remembered land,
 * and a paving in its own colours would have to be told all three again.
 */
function relief(img: HTMLCanvasElement, gain: number): HTMLCanvasElement {
  const [c, g] = canvas(img.width, img.height);
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, img.width, img.height);
  const px = data.data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += lumOf(px[i], px[i + 1], px[i + 2]);
  const mean = sum / (px.length / 4);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(0, Math.min(255, 128 + (lumOf(px[i], px[i + 1], px[i + 2]) - mean) * gain));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  g.putImageData(data, 0, 0);
  return c;
}

/** A picture two tiles by two cut into its four tiles, in the order (x mod 2, y mod 2) reads them. */
function quarters(img: HTMLCanvasElement): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let j = 0; j < FLOOR_TILES; j++) {
    for (let i = 0; i < FLOOR_TILES; i++) {
      const [c, g] = canvas(FLOOR_PPT, FLOOR_PPT);
      g.drawImage(img, -i * FLOOR_PPT, -j * FLOOR_PPT);
      out.push(c);
    }
  }
  return out;
}

/**
 * Slabs, cut square and laid square in the size their stone comes off the
 * block in -- `courses` to a tile each way -- every one a stone rather than a
 * square of a chequer: its arris lit and shaded, its face textured as the
 * stone is, set a hair off true in a joint of the bedding.
 */
function slabs(o: Stone & { courses: number; joint: number; running: boolean; seed: number; face?: (g: Ctx, x: number, y: number, w: number, h: number, R: Rand) => void }): HTMLCanvasElement {
  const [c, g] = canvas(S, S);
  g.fillStyle = o.bed;
  g.fillRect(0, 0, S, S);
  const R = rand(o.seed);
  const n = o.courses * FLOOR_TILES, u = S / n, jt = o.joint / 2;
  for (let j = 0; j < n; j++) {
    const off = o.running && j % 2 ? u / 2 : 0;
    for (let i = 0; i < n; i++) {
      const x0 = i * u + off + jt + (R() - 0.5) * 1.6, y0 = j * u + jt + (R() - 0.5) * 1.6;
      const x1 = (i + 1) * u + off - jt + (R() - 0.5) * 1.6, y1 = (j + 1) * u - jt + (R() - 0.5) * 1.6;
      const pts: Pt[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      const tone = pick(o.tones, R);
      const face = o.face;
      const fseed = Math.floor(R() * 1e9);
      stone(g, (dx, dy) => roundRect(g, pts, 3, dx, dy), [x0, y0, x1, y1], tone, o, R,
        face ? (dx, dy) => face(g, x0 + dx, y0 + dy, x1 - x0, y1 - y0, rand(fseed)) : undefined);
    }
  }
  return c;
}

/** Faint veins across a slab of marble. */
function clouded(ink: string): (g: Ctx, x: number, y: number, w: number, h: number, R: Rand) => void {
  return (g, x, y, w, h, R) => {
    const k = 1 + Math.floor(R() * 2);
    for (let v = 0; v < k; v++) {
      let px = x + R() * w, py = y;
      g.strokeStyle = hexA(ink, 0.5 + R() * 0.3);
      g.lineWidth = 1 + R() * 1.6;
      g.beginPath();
      g.moveTo(px, py);
      for (let s = 0; s < 8; s++) {
        px += (R() - 0.5) * w * 0.3;
        py += h / 7;
        g.lineTo(px, py);
      }
      g.stroke();
    }
  };
}

const slabbed = new Map<number, HTMLCanvasElement[]>();

/**
 * Ground paved in slabs of the `variant`th stone -- stone, slate, marble or
 * sandstone, the order of `SLAB_VARIANTS` -- the size they come off the
 * block in being `courses` to a tile: the four tiles of a picture two by two,
 * in light and shade, for `overlay`.
 *
 * Each stone is laid as it splits. Stone is sawn square and laid in courses,
 * every one half a slab on from the last; marble comes off the block whole
 * and is laid square, a joint straight across the lot; slate and sandstone
 * split to whatever size they will, and are fitted together at random round
 * that size.
 */
export function slabbing(variant: number, courses: number): HTMLCanvasElement[] {
  const had = slabbed.get(variant);
  if (had) return had;
  const seed = 307 + variant * 13;
  /** Random flags whose commonest size is a slab of `courses` to the tile. */
  const unit = S / (courses * FLOOR_TILES * 2);
  const img = [
    () => slabs({ courses, joint: 6, running: true, seed, bed: '#8d8a82', tones: [['#b7b4ab', 3], ['#aeaba2', 2], ['#bfbcb3', 2], ['#a9a69d', 1]], hi: '#d6d3cb', lo: '#8e8b83', ink: '#6e6b64', speck: ['#d0cdc5', '#94918a', 7], face: bedded('#7a776f', 0.07) }),
    () => fitted({
      unit, joint: 5, seed, bed: '#5b606e',
      sizes: [[[2, 2], 4], [[3, 2], 2], [[2, 3], 2], [[3, 3], 1], [[2, 1], 1], [[1, 2], 1]],
      tones: [['#8a91a0', 3], ['#838a99', 2], ['#9097a6', 2], ['#7c8392', 2]], hi: '#a9b0bf', lo: '#626978', ink: '#4f5462', speck: ['#a3aab8', '#6a7180', 4], face: riven('#b0b7c6', '#5f6675'),
    }),
    () => slabs({ courses, joint: 4, running: false, seed, bed: '#b5b5b0', tones: [['#e8e7e3', 3], ['#e2e1dc', 2], ['#eeede9', 2], ['#dddcd6', 1]], hi: '#ffffff', lo: '#c4c3bd', ink: '#a6a59f', speck: ['#ffffff', '#d2d1cb', 2], face: clouded('#d3d2cc') }),
    () => fitted({
      unit, joint: 6, seed, bed: '#b09878',
      sizes: [[[2, 2], 4], [[3, 2], 2], [[2, 3], 2], [[2, 1], 1], [[1, 2], 1], [[1, 1], 0.5]],
      tones: [['#dcc49c', 3], ['#d4bb92', 2], ['#e2cca6', 2], ['#cdb48c', 2]], hi: '#f0dfc0', lo: '#b09774', ink: '#957c5e', speck: ['#eedcbc', '#b89e7a', 8], face: bedded('#9c8262', 0.08),
    }),
  ][Math.max(0, Math.min(3, variant))]();
  // Marble is pale, and `overlay` over a pale ground flattens everything toward white: it is given more to begin with.
  const out = quarters(relief(img, variant === 2 ? 2.4 : 1.25));
  slabbed.set(variant, out);
  return out;
}

let poured: HTMLCanvasElement | null = null;

/**
 * The top of a foundation left as it was poured: floated flat, the float's
 * arcs faint in it, a margin tooled round the edge a hand's width in, and
 * here and there a pit where the air came up. One tile, in light and shade,
 * for `overlay`.
 */
export function concrete(): HTMLCanvasElement {
  if (poured) return poured;
  const [c, g] = canvas(FLOOR_PPT, FLOOR_PPT);
  const T = FLOOR_PPT;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, T, T);
  const R = rand(401);
  // The float's sweeps.
  g.lineCap = 'round';
  for (let i = 0; i < 18; i++) {
    const cx = R() * T, cy = R() * T, r = 20 + R() * 50, a = R() * Math.PI * 2;
    g.strokeStyle = R() < 0.5 ? 'rgba(255, 255, 255, 0.035)' : 'rgba(0, 0, 0, 0.03)';
    g.lineWidth = 6 + R() * 10;
    g.beginPath();
    g.arc(cx, cy, r, a, a + 0.9 + R() * 0.8);
    g.stroke();
  }
  // Pits.
  for (let i = 0; i < 40; i++) {
    const x = R() * T, y = R() * T, r = 0.7 + R() * 1.4;
    g.fillStyle = 'rgba(0, 0, 0, 0.28)';
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255, 255, 255, 0.18)';
    g.beginPath(); g.arc(x - 0.6, y - 0.6, r * 0.6, 0, Math.PI * 2); g.fill();
  }
  // The margin: a groove run round with an edging tool, and the arris rounded.
  const m = 14;
  g.strokeStyle = 'rgba(0, 0, 0, 0.22)';
  g.lineWidth = 2;
  g.strokeRect(m, m, T - 2 * m, T - 2 * m);
  g.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  g.lineWidth = 1.5;
  g.strokeRect(m + 1.8, m + 1.8, T - 2 * m, T - 2 * m);
  g.fillStyle = 'rgba(255, 255, 255, 0.12)';
  g.fillRect(0, 0, T, 3);
  g.fillRect(0, 0, 3, T);
  g.fillStyle = 'rgba(0, 0, 0, 0.12)';
  g.fillRect(0, T - 3, T, 3);
  g.fillRect(T - 3, 0, 3, T);
  poured = c;
  return c;
}
