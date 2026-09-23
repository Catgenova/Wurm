/**
 * What a roof is covered with, painted.
 *
 * A covering is a picture of a patch of roof two tiles by two, laid up the
 * slope from the eaves the way a roofer lays it: a course along the eave,
 * the next lapping over it, each course's lower edge throwing a line of shade
 * on the one below. It repeats both ways, and the renderer lays it on every
 * face of a roof as a pattern fixed to the world with its courses counted up
 * from the eave, so the course along every eave is a whole one, courses on
 * two faces of one plane run on into each other, and a hip or a valley cuts
 * across them the way it does on a roof.
 *
 * Each material roofs in what a house of it would be roofed in: timbercraft
 * in thatch, logs in split shakes, planks in sawn shingles, cobblestone in
 * stone flags, slate in slates, stone brick in dressed stone tiles, brick in
 * plain clay tiles, adobe in barrel tiles, sandstone in pantiles, marble in
 * marble pans and covers, and the two metals in scales. Cobblestone's and
 * brick's are the ones that carry moss, as their walls are the ones that
 * carry anything growing.
 */

import { EAVE_DEEP } from '../game/building';

/** Picture pixels to a tile, along the eave and up the slope, at the finest of the three. */
export const COVER_PPT = 256;
/** How many tiles the picture covers each way before it repeats. */
export const COVER_TILES = 2;
const S = COVER_PPT * COVER_TILES;

export interface Covering {
  /** The picture at `COVER_PPT` pixels to the tile, then at a half and a quarter of that, for the zoom to choose from. */
  mips: HTMLCanvasElement[];
  /** And a flat roof of it: a deck laid heavy enough to walk on, in the same three sizes. */
  deck: HTMLCanvasElement[];
  /** What the hour's shade darkens a face toward, and how much of it a face at a light takes. */
  shade: readonly [number, number, number];
  shadow: (lit: number) => number;
  /** The capping along a ridge or a hip: how it is made, its colours, how wide at zoom one, and how far apart its joints are in tiles. */
  cap: { kind: 'roll' | 'board' | 'straw' | 'crest'; body: string; dark: string; hi: string; w: number; joint: number };
  /** The line down a valley. */
  valley: string;
  /** The edge along an eave and up a verge: how it is made, its colour and its underside, and how deep in height units. */
  fascia: { kind: 'board' | 'straw' | 'gutter' | 'cornice'; body: readonly [number, number, number]; edge: readonly [number, number, number]; deep: number };
}

type Ctx = CanvasRenderingContext2D;
type Rand = () => number;
type Pt = [number, number];

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
/** Draw something once where it is and again a picture's width either side, where it runs over an edge. */
const wrapX = (x0: number, x1: number, draw: (dx: number) => void): void => {
  draw(0);
  if (x0 < 0) draw(S);
  if (x1 > S) draw(-S);
};

/* ---- units laid in courses ------------------------------------------------ */

interface Lap {
  /** Courses to the picture, and the widths a unit is cut to. */
  rows: number;
  unit: [number, number];
  /** How the courses are broken: every joint half a unit on from the one under it, or anywhere. */
  bond: 'half' | 'random';
  /** The gap between two units, and the course under them that shows in it. */
  gap: number;
  ground: string;
  tones: Array<[string, number]>;
  line: string;
  lineW: number;
  hi: string;
  /** The shade a course throws on the one below it: how far, and how dark. */
  drip: number;
  dripInk: string;
  /** The shape of a unit's foot. */
  shape: 'rect' | 'camber' | 'scale' | 'flag';
  /** How far a unit's foot and sides wander, and how far a unit is knocked off square, in px. */
  ragged: number;
  skew: number;
  /** A unit's own marks, over it. */
  detail?: (g: Ctx, u: Unit, R: Rand) => void;
  /** And anything over the whole course once it is laid. */
  after?: (g: Ctx, y0: number, y1: number, units: Unit[], R: Rand) => void;
}

interface Unit { x: number; y0: number; y1: number; w: number; tone: string; pts: Pt[] }

/** The outline of one unit, its head `top` px up under the course over it. */
function outline(L: Lap, x: number, w: number, y0: number, y1: number, R: Rand): Pt[] {
  const top = y0 - (y1 - y0) * 0.6;
  const j = (): number => (R() - 0.5) * 2 * L.ragged;
  const sk = (R() - 0.5) * 2 * L.skew;
  if (L.shape === 'scale') {
    const r = w / 2, cx = x + r, cy = y1 - r, out: Pt[] = [[x, top], [x + w, top], [x + w, cy]];
    for (let i = 1; i < 12; i++) {
      const a = (Math.PI * i) / 12;
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    out.push([x, cy]);
    return out;
  }
  if (L.shape === 'camber') {
    const out: Pt[] = [[x, top], [x + w, top], [x + w + sk, y1 - 2]];
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      out.push([x + w + sk - t * w, y1 - 2 + Math.sin(Math.PI * t) * L.ragged]);
    }
    out.push([x + sk, y1 - 2]);
    return out;
  }
  if (L.shape === 'flag') {
    // A flag is split, not sawn: its foot is three or four edges, its corners taken off.
    const n = 3 + Math.floor(R() * 2), foot: Pt[] = [];
    for (let i = 0; i <= n; i++) foot.push([x + w + sk - (i / n) * w + (i && i < n ? j() : 0), y1 + j() - (i === 0 || i === n ? L.ragged : 0)]);
    const c = Math.min(6, w * 0.12);
    return [[x + j() * 0.5, top], [x + w + j() * 0.5, top], [x + w + sk * 0.6 + j() * 0.5, y1 - c - L.ragged], ...foot, [x + sk * 0.6 + j() * 0.5, y1 - c - L.ragged]];
  }
  return [[x, top], [x + w, top], [x + w + sk + j() * 0.5, y1 + j()], [x + sk + j() * 0.5, y1 + j()]];
}

/**
 * A covering of units laid in courses, from the eave up: each course drawn
 * over the head of the one under it, with its shade on that one, so every
 * course shows only its own tail. Laid from the course that wraps round the
 * foot of the picture to the one that wraps round its head, so it repeats.
 */
function lapped(L: Lap, seed: number): HTMLCanvasElement {
  const [c, g] = canvas(S, S);
  g.fillStyle = L.ground;
  g.fillRect(0, 0, S, S);
  const ch = S / L.rows;
  for (let r = L.rows - 1; r >= -1; r--) {
    const row = (r + L.rows) % L.rows;
    const R = rand(seed * 977 + row * 131);
    const y0 = r * ch, y1 = y0 + ch;
    // The joints: every one half a unit on from the course under it, or anywhere.
    const units: Unit[] = [];
    const mid = (L.unit[0] + L.unit[1]) / 2;
    let x = L.bond === 'half' ? (row % 2) * (mid / 2) : R() * mid;
    const end = x + S;
    while (x < end - 1) {
      let w = L.unit[0] + R() * (L.unit[1] - L.unit[0]);
      if (end - (x + w) < L.unit[0] * 0.7) w = end - x;
      const tone = pick(L.tones, R);
      units.push({ x, y0, y1, w, tone, pts: outline(L, x + L.gap / 2, w - L.gap, y0, y1, R) });
      x += w;
    }
    for (const u of units) {
      const UR = rand(seed * 31 + row * 7919 + Math.round(u.x));
      wrapX(u.x, u.x + u.w, (dx) => {
        // The shade it throws down the course under it, then the unit.
        path(g, u.pts, dx, L.drip);
        g.fillStyle = L.dripInk;
        g.fill();
        path(g, u.pts, dx);
        g.fillStyle = u.tone;
        g.fill();
        g.save();
        g.clip();
        // The head in the shade of the course over it, the tail catching the light.
        const grad = g.createLinearGradient(0, y0, 0, y1);
        grad.addColorStop(0, hexA(step(u.tone, -0.3), 0.55));
        grad.addColorStop(0.4, hexA(u.tone, 0));
        grad.addColorStop(0.82, hexA(L.hi, 0));
        grad.addColorStop(1, hexA(L.hi, 0.5));
        g.fillStyle = grad;
        g.fillRect(u.x + dx - 20, y0 - ch, u.w + 40, ch * 2.2);
        // And the light down its left edge.
        g.fillStyle = hexA(L.hi, 0.35);
        g.fillRect(u.x + dx + L.gap / 2, y0, 3, ch);
        if (L.detail) {
          g.translate(dx, 0);
          L.detail(g, u, rand(UR() * 1e9));
          g.translate(-dx, 0);
        }
        g.restore();
        path(g, u.pts, dx);
        g.strokeStyle = L.line;
        g.lineWidth = L.lineW;
        g.lineJoin = 'round';
        g.stroke();
      });
    }
    L.after?.(g, y0, y1, units, R);
  }
  return c;
}

/* ---- tiles laid in channels ---------------------------------------------- */

interface Channel {
  /** Pans and covers across the picture, and tile lengths down it. */
  cols: number;
  rows: number;
  kind: 'mission' | 'pantile' | 'roman';
  tones: Array<[string, number]>;
  line: string;
  hi: string;
  deep: string;
  drip: string;
  /** Anything over a pan once it is laid. */
  pan?: (g: Ctx, x: number, y0: number, w: number, h: number, R: Rand) => void;
}

/**
 * Tiles laid in channels down the slope: in each, a pan to carry the water
 * and a cover over the joint between two pans, every course of them the
 * same length, so the tails of a course make one line across the roof and
 * the covers stand up out of it in a row of rounds. Barrel tiles are pans
 * and covers of one curve, a pantile is the two in one piece, and the Roman
 * way is a flat pan with its edges turned up under a narrow half-round cover.
 */
function channelled(C: Channel, seed: number): HTMLCanvasElement {
  const [c, g] = canvas(S, S);
  const P = S / C.cols, ch = S / C.rows;
  g.fillStyle = C.deep;
  g.fillRect(0, 0, S, S);
  const panW = C.kind === 'roman' ? P * 0.8 : C.kind === 'pantile' ? P * 0.78 : P * 0.62;
  const capW = C.kind === 'roman' ? P * 0.34 : C.kind === 'pantile' ? P * 0.42 : P * 0.56;
  for (let r = C.rows - 1; r >= -1; r--) {
    const row = (r + C.rows) % C.rows;
    const y0 = r * ch, y1 = y0 + ch, top = y0 - ch * 0.5;
    const R = rand(seed * 613 + row * 197);
    const tones = Array.from({ length: C.cols }, () => [pick(C.tones, R), pick(C.tones, R)] as [string, string]);
    // The pans, each laid over the head of the one below it.
    for (let i = 0; i < C.cols; i++) {
      const x = i * P + (P - panW) / 2 + (C.kind === 'pantile' ? -P * 0.12 : 0);
      const tone = tones[i][0];
      const lean = (R() - 0.5) * 2;
      wrapX(x, x + panW, (dx) => {
        const pts: Pt[] = [[x + dx, top], [x + panW + dx, top], [x + panW + dx + lean, y1], [x + dx + lean, y1]];
        path(g, pts, 0, 5);
        g.fillStyle = C.drip;
        g.fill();
        path(g, pts);
        const grad = g.createLinearGradient(x + dx, 0, x + panW + dx, 0);
        if (C.kind === 'roman') {
          // Flat, its turned-up edges catching the light on the left and in shade on the right.
          grad.addColorStop(0, step(tone, 0.2)); grad.addColorStop(0.1, tone); grad.addColorStop(0.9, tone); grad.addColorStop(1, step(tone, -0.18));
        } else {
          // A trough: its left wall in its own shade, its right wall in the light.
          grad.addColorStop(0, step(tone, -0.24)); grad.addColorStop(0.45, tone); grad.addColorStop(0.8, step(tone, 0.14)); grad.addColorStop(1, step(tone, 0.02));
        }
        g.fillStyle = grad;
        g.fill();
        g.save();
        g.clip();
        const tail = g.createLinearGradient(0, y0, 0, y1);
        tail.addColorStop(0, hexA(C.deep, 0.35)); tail.addColorStop(0.35, hexA(C.deep, 0)); tail.addColorStop(1, hexA(C.hi, 0.18));
        g.fillStyle = tail;
        g.fillRect(x + dx - 4, y0 - 4, panW + 8, ch + 8);
        C.pan?.(g, x + dx, y0, panW, ch, R);
        g.restore();
        path(g, pts);
        g.strokeStyle = hexA(C.line, 0.7);
        g.lineWidth = 2;
        g.stroke();
      });
    }
    // Then the covers over the joints, their tails rounded.
    for (let i = 0; i < C.cols; i++) {
      const cx = (i + 1) * P - (C.kind === 'pantile' ? P * 0.12 : 0);
      const x = cx - capW / 2, tone = tones[i][1], lean = (R() - 0.5) * 2;
      const round = capW * (C.kind === 'roman' ? 0.34 : 0.28);
      wrapX(x, x + capW, (dx) => {
        const pts: Pt[] = [[x + dx, top], [x + capW + dx, top], [x + capW + dx + lean, y1 - round]];
        for (let k = 1; k < 10; k++) {
          const a = (Math.PI * k) / 10;
          pts.push([cx + dx + lean + Math.cos(a) * capW / 2, y1 - round + Math.sin(a) * round]);
        }
        pts.push([x + dx + lean, y1 - round]);
        path(g, pts, 3, 6);
        g.fillStyle = C.drip;
        g.fill();
        path(g, pts);
        const grad = g.createLinearGradient(x + dx, 0, x + capW + dx, 0);
        grad.addColorStop(0, step(tone, -0.06)); grad.addColorStop(0.28, step(tone, 0.2)); grad.addColorStop(0.55, tone); grad.addColorStop(1, step(tone, -0.26));
        g.fillStyle = grad;
        g.fill();
        g.save();
        g.clip();
        const tail = g.createLinearGradient(0, y0, 0, y1);
        tail.addColorStop(0, hexA(C.deep, 0.3)); tail.addColorStop(0.3, hexA(C.deep, 0)); tail.addColorStop(1, hexA(C.hi, 0.12));
        g.fillStyle = tail;
        g.fillRect(x + dx - 4, y0 - 4, capW + 8, ch + 8);
        // The light along the round of it.
        g.fillStyle = hexA(C.hi, 0.55);
        g.fillRect(x + dx + capW * 0.22, top, capW * 0.1, ch * 1.5);
        g.restore();
        path(g, pts);
        g.strokeStyle = C.line;
        g.lineWidth = 2.2;
        g.stroke();
      });
    }
  }
  return c;
}

/* ---- thatch --------------------------------------------------------------- */

/**
 * Thatch: straw laid in coats from the eave up, each coat's butts cut to a
 * line and the next coat lapping over it, the straw running down the slope.
 * What reads is the run of the straw and the soft shadow under each coat;
 * there are no units in it to count.
 */
function thatched(seed: number): HTMLCanvasElement {
  const [c, g] = canvas(S, S);
  const base = '#d4b47b', tones: Array<[string, number]> = [['#d4b47b', 4], ['#ccaa70', 3], ['#dcc08a', 3], ['#c6a36a', 2], ['#e2c998', 1]];
  const weather = '#b3a386', shadow = '#8c6c45', light = '#efdcad';
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  const R = rand(seed);
  // Weather: the grey the straw goes where the rain sits on it, in drifts down the slope.
  for (let i = 0; i < 14; i++) {
    const x = R() * S, y = R() * S, w = 40 + R() * 90, h = 70 + R() * 140;
    for (const [dx, dy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      const grad = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, Math.max(w, h) / 2);
      grad.addColorStop(0, hexA(weather, 0.28));
      grad.addColorStop(1, hexA(weather, 0));
      g.fillStyle = grad;
      g.save();
      g.translate(x + dx, y + dy);
      g.scale(w / Math.max(w, h), h / Math.max(w, h));
      g.translate(-(x + dx), -(y + dy));
      g.fillRect(x + dx - Math.max(w, h), y + dy - Math.max(w, h), Math.max(w, h) * 2, Math.max(w, h) * 2);
      g.restore();
    }
  }
  // The straw, down the slope.
  g.lineCap = 'round';
  for (let i = 0; i < 2600; i++) {
    const x = R() * S, y = R() * S, len = 14 + R() * 26, a = (R() - 0.5) * 0.22;
    const tone = pick(tones, R), dark = R() < 0.3;
    g.strokeStyle = hexA(dark ? step(tone, -0.18) : step(tone, 0.12), 0.55 + R() * 0.3);
    g.lineWidth = 1.6 + R() * 1.4;
    for (const [dx, dy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      g.beginPath();
      g.moveTo(x + dx, y + dy);
      g.lineTo(x + dx + Math.sin(a) * len, y + dy + Math.cos(a) * len);
      g.stroke();
    }
  }
  // The coats: each one's butts in a wavering line, the light on them, and the shade under them.
  const coats = 4, ch = S / coats;
  for (let k = 0; k < coats; k++) {
    const y = (k + 1) * ch, RR = rand(seed * 17 + k), n = 16, amp = 5 + RR() * 3;
    const ys = Array.from({ length: n + 1 }, (_, i) => y + Math.sin((i / n) * Math.PI * 2 * 3 + k) * amp * 0.5 + (RR() - 0.5) * amp);
    ys[n] = ys[0];
    const edge = (dy: number): void => {
      g.beginPath();
      for (let i = 0; i <= n; i++) g.lineTo((i / n) * S, ys[i] + dy);
    };
    for (const wrapY of [0, -S]) {
      // Shade under the butts, fading down the coat below.
      g.save();
      g.translate(0, wrapY);
      edge(0);
      g.lineTo(S, y + 26); g.lineTo(0, y + 26); g.closePath();
      const sh = g.createLinearGradient(0, y - 4, 0, y + 26);
      sh.addColorStop(0, hexA(shadow, 0.5)); sh.addColorStop(1, hexA(shadow, 0));
      g.fillStyle = sh;
      g.fill();
      // The butts themselves: a band lit along its foot.
      edge(0);
      for (let i = n; i >= 0; i--) g.lineTo((i / n) * S, ys[i] - 12);
      g.closePath();
      const bt = g.createLinearGradient(0, y - 12, 0, y);
      bt.addColorStop(0, hexA(light, 0)); bt.addColorStop(1, hexA(light, 0.55));
      g.fillStyle = bt;
      g.fill();
      edge(0);
      g.strokeStyle = hexA(shadow, 0.55);
      g.lineWidth = 2.4;
      g.stroke();
      g.restore();
    }
  }
  return c;
}

/* ---- moss and lichen, for the two that carry them ------------------------ */

const LEAF = '#6bac7e', LEAF_PALE = '#7cc38e', LEAF_DEEP = '#5c8273', LEAF_LINE = '#507b5f', LICHEN = '#d4d19c', LICHEN_LINE = '#b5b27d';

/** A cushion of moss in the angle under a unit's tail, or a rosette of lichen out on its face. */
function mossy(rate: number, lichen: number): (g: Ctx, u: Unit, R: Rand) => void {
  return (g, u, R) => {
    if (R() < lichen) {
      const x = u.x + u.w * (0.25 + R() * 0.5), y = u.y0 + (u.y1 - u.y0) * (0.35 + R() * 0.4), r = 4 + R() * 6;
      g.beginPath();
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2, rr = r * (0.7 + R() * 0.5);
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8);
      }
      g.closePath();
      g.fillStyle = hexA(LICHEN, 0.85);
      g.fill();
      g.strokeStyle = hexA(LICHEN_LINE, 0.8);
      g.lineWidth = 1.4;
      g.stroke();
    }
    if (R() < rate) {
      // Where the water sits: at the tail, against the unit beside it.
      const x = u.x + (R() < 0.5 ? 4 : u.w - 4) + (R() - 0.5) * 8, y = u.y1 - 3, w = 10 + R() * 14;
      for (let i = 0; i < 5; i++) {
        const cx = x + (R() - 0.5) * w, cy = y - R() * 7, r = 3 + R() * 4;
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fillStyle = i < 2 ? LEAF_DEEP : R() < 0.5 ? LEAF : LEAF_PALE;
        g.fill();
        g.strokeStyle = hexA(LEAF_LINE, 0.6);
        g.lineWidth = 1;
        g.stroke();
      }
    }
  };
}

/** The grain of split or sawn wood, down the length of a shake or a shingle, and the odd split. */
function grained(ink: string, splits: number): (g: Ctx, u: Unit, R: Rand) => void {
  return (g, u, R) => {
    g.strokeStyle = hexA(ink, 0.45);
    g.lineWidth = 1.4;
    for (let i = 0; i < 2 + Math.floor(R() * 3); i++) {
      const x = u.x + 5 + R() * (u.w - 10);
      g.beginPath();
      g.moveTo(x, u.y0 - 10);
      g.bezierCurveTo(x + (R() - 0.5) * 6, u.y0 + (u.y1 - u.y0) * 0.4, x + (R() - 0.5) * 6, u.y0 + (u.y1 - u.y0) * 0.7, x + (R() - 0.5) * 4, u.y1);
      g.stroke();
    }
    if (R() < splits) {
      const x = u.x + u.w * (0.3 + R() * 0.4);
      g.strokeStyle = hexA(ink, 0.9);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, u.y1);
      g.lineTo(x + (R() - 0.5) * 4, u.y1 - (u.y1 - u.y0) * (0.3 + R() * 0.4));
      g.stroke();
    }
  };
}

/** A sheen over a scale of metal: light off its shoulder, and a bright rim round its foot. */
function sheened(hi: string, rim: string): (g: Ctx, u: Unit, R: Rand) => void {
  return (g, u) => {
    const r = u.w / 2, cx = u.x + r, cy = u.y1 - r;
    const grad = g.createRadialGradient(cx - r * 0.35, cy - r * 0.5, 0, cx - r * 0.35, cy - r * 0.5, r * 1.3);
    grad.addColorStop(0, hexA(hi, 0.8));
    grad.addColorStop(0.5, hexA(hi, 0.15));
    grad.addColorStop(1, hexA(hi, 0));
    g.fillStyle = grad;
    g.fillRect(u.x - 4, u.y0 - 20, u.w + 8, u.y1 - u.y0 + 24);
    g.beginPath();
    g.arc(cx, cy, r - 3.5, Math.PI * 0.12, Math.PI * 0.88);
    g.strokeStyle = hexA(rim, 0.85);
    g.lineWidth = 2.2;
    g.stroke();
  };
}

/** Faint veins on a pan of marble. */
function veined(ink: string): (g: Ctx, x: number, y0: number, w: number, h: number, R: Rand) => void {
  return (g, x, y0, w, h, R) => {
    if (R() < 0.5) return;
    g.strokeStyle = hexA(ink, 0.7);
    g.lineWidth = 2.4;
    g.beginPath();
    let px = x + R() * w, py = y0 - 4;
    g.moveTo(px, py);
    for (let i = 0; i < 6; i++) {
      px += (R() - 0.5) * w * 0.5;
      py += h / 5;
      g.lineTo(Math.max(x, Math.min(x + w, px)), py);
    }
    g.stroke();
  };
}


/* ---- decks, for a flat roof ------------------------------------------------ */

/**
 * A deck of flags, bricks or tiles: `w` by `h` px each, in courses across the
 * picture, every course set half a unit on from the last or square over it,
 * each unit a tone of its own with the light along its top edge and its left
 * and the joint round it in the bedding's colour.
 */
function paved(o: { w: number; h: number; running: boolean; joint: number; bed: string; tones: Array<[string, number]>; hi: string; line: string; seed: number; wear?: number }): HTMLCanvasElement {
  const [c, g] = canvas(S, S);
  g.fillStyle = o.bed;
  g.fillRect(0, 0, S, S);
  const R = rand(o.seed);
  const rows = Math.round(S / o.h), cols = Math.round(S / o.w);
  const h = S / rows, w = S / cols;
  for (let r = 0; r < rows; r++) {
    const off = o.running && r % 2 ? w / 2 : 0;
    for (let i = 0; i < cols; i++) {
      const x = i * w + off, y = r * h, tone = pick(o.tones, R), j = o.joint / 2;
      wrapX(x, x + w, (dx) => {
        const x0 = x + dx + j, y0 = y + j, ww = w - o.joint, hh = h - o.joint;
        g.fillStyle = tone;
        g.fillRect(x0, y0, ww, hh);
        g.fillStyle = hexA(o.hi, 0.5);
        g.fillRect(x0, y0, ww, 2.5);
        g.fillRect(x0, y0, 2.5, hh);
        g.fillStyle = hexA(step(tone, -0.25), 0.45);
        g.fillRect(x0, y0 + hh - 2.5, ww, 2.5);
        g.fillRect(x0 + ww - 2.5, y0, 2.5, hh);
        if (o.wear && R() < o.wear) {
          g.fillStyle = hexA(step(tone, -0.12), 0.5);
          g.beginPath();
          g.ellipse(x0 + ww * (0.3 + R() * 0.4), y0 + hh * (0.3 + R() * 0.4), ww * 0.2, hh * 0.14, R() * Math.PI, 0, Math.PI * 2);
          g.fill();
        }
        g.strokeStyle = hexA(o.line, 0.55);
        g.lineWidth = 1.5;
        g.strokeRect(x0, y0, ww, hh);
      });
    }
  }
  return c;
}

/** A deck of boards, `w` px wide across the picture, each a tone of its own and butted end to end at random. */
function boarded(o: { w: number; gap: number; bed: string; tones: Array<[string, number]>; hi: string; line: string; seed: number }): HTMLCanvasElement {
  const [c, g] = canvas(S, S);
  g.fillStyle = o.bed;
  g.fillRect(0, 0, S, S);
  const R = rand(o.seed);
  const rows = Math.round(S / o.w), h = S / rows;
  for (let r = 0; r < rows; r++) {
    let x = R() * S;
    const end = x + S;
    while (x < end - 1) {
      let len = 120 + R() * 200;
      if (end - (x + len) < 80) len = end - x;
      const tone = pick(o.tones, R), y0 = r * h + o.gap / 2, hh = h - o.gap;
      wrapX(x, x + len, (dx) => {
        g.fillStyle = tone;
        g.fillRect(x + dx + 1, y0, len - 2, hh);
        g.fillStyle = hexA(o.hi, 0.45);
        g.fillRect(x + dx + 1, y0, len - 2, 2.5);
        g.fillStyle = hexA(step(tone, -0.2), 0.4);
        g.fillRect(x + dx + 1, y0 + hh - 2.5, len - 2, 2.5);
        g.strokeStyle = hexA(o.line, 0.35);
        g.lineWidth = 1.2;
        for (let k = 0; k < 2; k++) {
          const yy = y0 + hh * (0.3 + k * 0.4) + (R() - 0.5) * 3;
          g.beginPath(); g.moveTo(x + dx + 6, yy); g.lineTo(x + dx + len - 6, yy + (R() - 0.5) * 2); g.stroke();
        }
        g.strokeStyle = hexA(o.line, 0.7);
        g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(x + dx + len - 1, y0); g.lineTo(x + dx + len - 1, y0 + hh); g.stroke();
      });
      x += len;
    }
  }
  return c;
}

/* ---- the coverings --------------------------------------------------------- */

const shadowOf = (depth: number) => (k: number): number => Math.max(0, Math.min(0.62, (1 - k) * depth));

function build(material: string): Covering | null {
  switch (material) {
    case 'timbercraft':
      return {
        mips: [thatched(71)],
        deck: [boarded({ w: 40, gap: 3, bed: '#6e5a4a', tones: [['#b39a7c', 3], ['#a88f72', 2], ['#bda486', 2]], hi: '#d2bca0', line: '#5a4739', seed: 101 })],
        shade: [74, 56, 44],
        shadow: shadowOf(1.0),
        cap: { kind: 'straw', body: '#e6cf9c', dark: '#9b7a4d', hi: '#f4e6c2', w: 8, joint: 0.2 },
        valley: 'rgba(120, 90, 55, 0.55)',
        fascia: { kind: 'straw', body: [214, 183, 126], edge: [146, 113, 70], deep: EAVE_DEEP * 2 },
      };
    case 'log':
      return {
        mips: [lapped({
          rows: 9, unit: [34, 70], bond: 'random', gap: 3, ground: '#4c4039',
          tones: [['#9c8976', 4], ['#a69380', 3], ['#93806e', 3], ['#ae9c89', 2], ['#8b7968', 2]],
          line: '#4a3d37', lineW: 2, hi: '#c2b09d', drip: 7, dripInk: 'rgba(54, 42, 36, 0.55)',
          shape: 'rect', ragged: 3, skew: 3, detail: grained('#5b4b42', 0.18),
        }, 11)],
        deck: [boarded({ w: 48, gap: 3, bed: '#4c4039', tones: [['#a6937f', 3], ['#9b8874', 2], ['#b09d89', 2]], hi: '#c2b09d', line: '#4a3d37', seed: 103 })],
        shade: [52, 42, 44],
        shadow: shadowOf(0.9),
        cap: { kind: 'board', body: '#a58f79', dark: '#4a3d37', hi: '#c3ae98', w: 5, joint: 0 },
        valley: 'rgba(60, 48, 42, 0.6)',
        fascia: { kind: 'board', body: [128, 106, 92], edge: [74, 60, 54], deep: EAVE_DEEP },
      };
    case 'plank':
      return {
        mips: [lapped({
          rows: 11, unit: [28, 54], bond: 'half', gap: 3, ground: '#5a4739',
          tones: [['#b89a78', 4], ['#c2a582', 3], ['#ae906f', 3], ['#c9ad8b', 2], ['#a98b6b', 2]],
          line: '#5f4b3f', lineW: 1.8, hi: '#dcc6a8', drip: 6, dripInk: 'rgba(70, 52, 40, 0.5)',
          shape: 'rect', ragged: 0.8, skew: 0.6, detail: grained('#7a6048', 0.05),
        }, 13)],
        deck: [boarded({ w: 36, gap: 3, bed: '#6e5a48', tones: [['#c9b395', 3], ['#bea789', 2], ['#d0bb9d', 2]], hi: '#e0cfb6', line: '#6b5846', seed: 107 })],
        shade: [64, 48, 46],
        shadow: shadowOf(0.9),
        cap: { kind: 'board', body: '#b39676', dark: '#5f4b3f', hi: '#d3bb9c', w: 5, joint: 0 },
        valley: 'rgba(80, 60, 45, 0.55)',
        fascia: { kind: 'board', body: [141, 115, 97], edge: [95, 75, 63], deep: EAVE_DEEP },
      };
    case 'cobblestone':
      return {
        mips: [lapped({
          rows: 7, unit: [52, 104], bond: 'random', gap: 4, ground: '#817b6e',
          tones: [['#bdb3a3', 4], ['#b6ad9c', 3], ['#c4baa9', 3], ['#aea796', 2], ['#b8b39a', 2]],
          line: '#877c66', lineW: 2.4, hi: '#d8cfc0', drip: 8, dripInk: 'rgba(70, 64, 54, 0.5)',
          shape: 'flag', ragged: 4, skew: 4, detail: mossy(0.2, 0.22),
        }, 17)],
        deck: [paved({ w: 112, h: 96, running: true, joint: 8, bed: '#8e8a7c', tones: [['#cbc0b0', 3], ['#c6bdab', 2], ['#bdb9a9', 2], ['#c6bba8', 2]], hi: '#ddd4c6', line: '#94896c', seed: 109, wear: 0.3 })],
        shade: [30, 26, 20],
        shadow: shadowOf(0.85),
        cap: { kind: 'roll', body: '#b3aa98', dark: '#6f6858', hi: '#d2c9b9', w: 6, joint: 0.45 },
        valley: 'rgba(90, 84, 70, 0.6)',
        fascia: { kind: 'board', body: [134, 118, 96], edge: [88, 76, 62], deep: EAVE_DEEP },
      };
    case 'slate':
      return {
        mips: [lapped({
          rows: 12, unit: [36, 44], bond: 'half', gap: 3, ground: '#303244',
          tones: [['#5b607a', 4], ['#555a73', 3], ['#61667f', 3], ['#50546b', 2], ['#5f5a78', 2]],
          line: '#2c2e40', lineW: 1.8, hi: '#7d82a0', drip: 5, dripInk: 'rgba(24, 24, 36, 0.55)',
          shape: 'rect', ragged: 0.3, skew: 0.2,
        }, 19)],
        deck: [paved({ w: 128, h: 96, running: true, joint: 5, bed: '#303244', tones: [['#5b607a', 3], ['#555a73', 2], ['#61667f', 2], ['#5f5a78', 1]], hi: '#7d82a0', line: '#2c2e40', seed: 113 })],
        shade: [20, 20, 34],
        shadow: shadowOf(0.8),
        cap: { kind: 'roll', body: '#6c718c', dark: '#2c2e40', hi: '#9398b2', w: 5, joint: 0.33 },
        valley: 'rgba(30, 30, 46, 0.7)',
        fascia: { kind: 'board', body: [96, 84, 88], edge: [54, 46, 52], deep: EAVE_DEEP },
      };
    case 'stone_brick':
      return {
        mips: [lapped({
          rows: 9, unit: [44, 72], bond: 'half', gap: 3, ground: '#666878',
          tones: [['#a0a4b3', 4], ['#a8acb9', 3], ['#999dac', 3], ['#aca8a1', 2], ['#9fa3a9', 2]],
          line: '#5f6171', lineW: 2, hi: '#c2c6d2', drip: 6, dripInk: 'rgba(52, 54, 66, 0.5)',
          shape: 'rect', ragged: 1.2, skew: 1,
        }, 23)],
        deck: [paved({ w: 128, h: 128, running: false, joint: 6, bed: '#8c8e9c', tones: [['#aeb2c0', 3], ['#a6aab8', 2], ['#bbb5ad', 1]], hi: '#c2c6d2', line: '#6b6d7d', seed: 127 })],
        shade: [36, 38, 52],
        shadow: shadowOf(0.85),
        cap: { kind: 'roll', body: '#b1b4c0', dark: '#5f6171', hi: '#d0d3dd', w: 6, joint: 0.4 },
        valley: 'rgba(70, 72, 86, 0.6)',
        fascia: { kind: 'board', body: [118, 104, 96], edge: [78, 68, 64], deep: EAVE_DEEP },
      };
    case 'clay_bricks':
      return {
        mips: [lapped({
          rows: 14, unit: [28, 34], bond: 'half', gap: 3, ground: '#6e3f3a',
          tones: [['#c27466', 4], ['#b96c5f', 3], ['#c98070', 3], ['#ad6457', 2], ['#c4867a', 2]],
          line: '#7a4540', lineW: 1.8, hi: '#dd9f90', drip: 5, dripInk: 'rgba(80, 40, 36, 0.5)',
          shape: 'camber', ragged: 3, skew: 0.6, detail: mossy(0.07, 0.1),
        }, 29)],
        deck: [paved({ w: 64, h: 32, running: true, joint: 5, bed: '#8e6f67', tones: [['#c47c6e', 3], ['#bb7266', 2], ['#c98a7c', 2], ['#b06a5e', 1]], hi: '#d09080', line: '#7e4a44', seed: 131 })],
        shade: [60, 40, 56],
        shadow: shadowOf(0.9),
        cap: { kind: 'roll', body: '#c98272', dark: '#7a4540', hi: '#e2a898', w: 6, joint: 0.33 },
        valley: 'rgba(100, 50, 44, 0.6)',
        fascia: { kind: 'board', body: [120, 96, 88], edge: [78, 58, 54], deep: EAVE_DEEP },
      };
    case 'clay_adobe':
      return {
        mips: [channelled({
          cols: 12, rows: 6, kind: 'mission',
          tones: [['#d9967a', 4], ['#d08c70', 3], ['#e2a386', 3], ['#c98468', 2]],
          line: '#94604e', hi: '#f2c3a9', deep: '#8f5d4a', drip: 'rgba(110, 64, 48, 0.45)',
        }, 31)],
        deck: [paved({ w: 85.34, h: 85.34, running: false, joint: 5, bed: '#b89a82', tones: [['#d9967a', 3], ['#d08c70', 2], ['#e2a386', 2]], hi: '#f2c3a9', line: '#94604e', seed: 137 })],
        shade: [70, 44, 50],
        shadow: shadowOf(0.9),
        cap: { kind: 'roll', body: '#dfa084', dark: '#94604e', hi: '#f4c9b0', w: 7, joint: 0.33 },
        valley: 'rgba(120, 70, 52, 0.6)',
        fascia: { kind: 'board', body: [150, 120, 98], edge: [100, 78, 64], deep: EAVE_DEEP },
      };
    case 'sandstone':
      return {
        mips: [channelled({
          cols: 10, rows: 7, kind: 'pantile',
          tones: [['#d8998a', 4], ['#cf9082', 3], ['#e0a797', 3], ['#c98a7c', 2]],
          line: '#976459', hi: '#f0c4b6', deep: '#8e5f55', drip: 'rgba(110, 66, 58, 0.45)',
        }, 37)],
        deck: [paved({ w: 128, h: 102.4, running: true, joint: 6, bed: '#c3a58d', tones: [['#e0c6a4', 3], ['#e3bea6', 2], ['#d8bc98', 2], ['#ecd9be', 1]], hi: '#f2e4cf', line: '#9a7666', seed: 139 })],
        shade: [70, 44, 56],
        shadow: shadowOf(0.9),
        cap: { kind: 'roll', body: '#dea293', dark: '#976459', hi: '#f2cabd', w: 7, joint: 0.33 },
        valley: 'rgba(120, 72, 62, 0.6)',
        fascia: { kind: 'board', body: [196, 160, 140], edge: [150, 114, 100], deep: EAVE_DEEP },
      };
    case 'marble':
      return {
        mips: [channelled({
          cols: 8, rows: 5, kind: 'roman',
          tones: [['#eceef1', 4], ['#e7eaee', 3], ['#f1f3f5', 3]],
          line: '#a6acb6', hi: '#fbfcfd', deep: '#b9bec6', drip: 'rgba(130, 138, 152, 0.4)',
          pan: veined('#d0d5dd'),
        }, 41)],
        deck: [paved({ w: 128, h: 128, running: false, joint: 3, bed: '#c3c7cd', tones: [['#edeff1', 3], ['#f1f3f5', 2], ['#e2e5e9', 2]], hi: '#ffffff', line: '#9aa1ab', seed: 149 })],
        shade: [120, 128, 150],
        shadow: shadowOf(0.75),
        cap: { kind: 'roll', body: '#f2f4f6', dark: '#a6acb6', hi: '#ffffff', w: 6, joint: 0.25 },
        valley: 'rgba(150, 158, 172, 0.6)',
        fascia: { kind: 'cornice', body: [226, 229, 234], edge: [170, 176, 186], deep: EAVE_DEEP * 1.15 },
      };
    case 'ornate_silver':
      return {
        mips: [lapped({
          rows: 14, unit: [36.57, 36.57], bond: 'half', gap: 1, ground: '#626882',
          tones: [['#c6cad6', 4], ['#bfc4d2', 3], ['#ccd0db', 3], ['#b8bccb', 2]],
          line: '#626882', lineW: 2, hi: '#eef1f6', drip: 4, dripInk: 'rgba(50, 54, 76, 0.5)',
          shape: 'scale', ragged: 0, skew: 0, detail: sheened('#f4f6fa', '#ccdcf2'),
        }, 43)],
        deck: [paved({ w: 128, h: 128, running: false, joint: 4, bed: '#8e92a3', tones: [['#c6cad6', 3], ['#cbcdd6', 2], ['#b8bccb', 2]], hi: '#eef1f6', line: '#626882', seed: 151 })],
        shade: [60, 64, 90],
        shadow: shadowOf(0.7),
        cap: { kind: 'crest', body: '#dfe2ea', dark: '#626882', hi: '#ffffff', w: 5, joint: 0 },
        valley: 'rgba(80, 86, 110, 0.6)',
        fascia: { kind: 'gutter', body: [198, 204, 218], edge: [110, 116, 138], deep: EAVE_DEEP * 1.15 },
      };
    case 'ornate_gold':
      return {
        mips: [lapped({
          rows: 14, unit: [36.57, 36.57], bond: 'half', gap: 1, ground: '#7a6040',
          tones: [['#d9bf85', 4], ['#d2b67a', 3], ['#e0c792', 3], ['#c9ab6e', 2]],
          line: '#7d6440', lineW: 2, hi: '#f6e8c0', drip: 4, dripInk: 'rgba(80, 58, 36, 0.5)',
          shape: 'scale', ragged: 0, skew: 0, detail: sheened('#fbf1d6', '#f3e2b4'),
        }, 47)],
        deck: [paved({ w: 128, h: 128, running: false, joint: 4, bed: '#96784a', tones: [['#d9bf85', 3], ['#e0c792', 2], ['#c9ab6e', 2]], hi: '#f6e8c0', line: '#7d6440', seed: 157 })],
        shade: [70, 52, 60],
        shadow: shadowOf(0.7),
        cap: { kind: 'crest', body: '#ecd8a4', dark: '#7d6440', hi: '#fff6dc', w: 5, joint: 0 },
        valley: 'rgba(110, 84, 50, 0.6)',
        fascia: { kind: 'gutter', body: [222, 196, 138], edge: [140, 110, 66], deep: EAVE_DEEP * 1.15 },
      };
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

const made = new Map<string, Covering>();

/** What a roof of `material` is covered with; a material that roofs in nothing of its own is covered in the plainest, shingles. */
export function covering(material: string): Covering {
  const had = made.get(material);
  if (had) return had;
  const c = build(material) ?? build('plank');
  if (!c) throw new Error('no covering');
  c.mips = mipsOf(c.mips[0]);
  c.deck = mipsOf(c.deck[0]);
  made.set(material, c);
  return c;
}
