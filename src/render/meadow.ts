import { hash2 } from '../world/noise';

/**
 * The meadow: what grass is made of.
 *
 * Grass was a flat lozenge of one green with fourteen specks thrown at it,
 * and it is sixty per cent of what anybody looks at. Next to a painted wall
 * or a cobbled road it was the weakest surface in the game.
 *
 * It is built in three layers, because they want three different things.
 *
 * The **sward** is the ground itself: one picture, three tiles by three, laid
 * across the whole field at once as a repeating pattern rather than blitted
 * onto a tile at a time. It is black and white at a twentieth of an alpha and
 * nothing else -- the same thing the fourteen speckles it replaces always
 * were -- so the tile keeps its own green, the hour's sun, the slope it lies
 * on and the grey of land you only remember.
 *
 * It is a pattern and not nine hundred little blits because nine hundred
 * little blits, each one sheared onto a rhombus, was the whole cost of this:
 * sixteen milliseconds of a frame, against two for everything else here put
 * together. One fill a row draws the lot.
 *
 * The **strew** is what lies in it: clover, daisies, buttercups, blush, a
 * dandelion clock, a pebble, a cushion of moss. Small, and in real colour,
 * because a white daisy is white and there is no way to say that in grey.
 * The night wash at the end of the frame dims them with everything else.
 *
 * The **stand** is what stands up in it: tufts of blade grass, rooted at the
 * foot and drawn where they stand. They were bent by the same wind that fills
 * a sail and leans a tree, and they are not any more -- a tuft is twelve
 * pixels at the zoom the game opens at and what it did with them was fidget.
 *
 * Which of the ten a tile is comes out of where it is and nothing else: a
 * slow noise over the map so that flowers come in drifts, with a quarter of
 * the tiles jumping to a neighbouring look so the drifts have ragged edges.
 * Nothing is stored, nothing is sent, and two people standing on the same
 * tile see the same daisies.
 */

type Ctx = CanvasRenderingContext2D;
type Rand = () => number;

/** A little painted thing, and where it is rooted in its own picture. */
export interface Sprig {
  canvas: HTMLCanvasElement;
  /** Drawn size at zoom 1, in screen pixels. */
  w: number;
  h: number;
  /** The root, in the same units: the point that lands where the thing stands. */
  ax: number;
  ay: number;
}

/** One of the ten: what it strews about and what it stands up. */
export interface Look {
  name: string;
  /** What a turn sheet should be able to find it by. */
  tells: string;
  /** Which strewn sprigs it draws from, and how many of them. */
  strew: readonly number[];
  strewN: readonly [number, number];
  /** Which tufts it stands up, and how many. */
  stand: readonly number[];
  standN: readonly [number, number];
}

export interface Meadow {
  /** The ground, as one seamless picture to be laid down the world's own axes. */
  sward: HTMLCanvasElement;
  /** How many tiles across it runs, which is what the pattern is scaled by. */
  swardTiles: number;
  /** And how many pixels to a tile in it. */
  swardTile: number;
  strew: Sprig[];
  tufts: Sprig[];
  looks: Look[];
}

/* ---- the paints ---------------------------------------------------------- */

/**
 * Pastel, and warm. The island's greens were picked when grass was one flat
 * colour and had to carry the whole field on its own; a meadow with things
 * growing in it wants a quieter ground and brighter things standing in it.
 */
const LEAF = {
  /*
   * Light on the ground rather than dark on it. Drawn in the old greens a
   * tuft came out nearly black against a pale sward and read as a spider;
   * grass catches the sun on its edge and the eye takes the pale side of it,
   * which is also what makes the reference art look like summer.
   */
  deep: '#7ba263', mid: '#95b972', lit: '#adcb84', pale: '#c6df9c', line: '#5f7e4a',
};
const BLOOM = {
  white: '#fdf8ee', whiteShade: '#eae1d2', eye: '#f2c96a',
  blush: '#f6c3cc', blushShade: '#e4a9b5',
  butter: '#f6dd93', butterShade: '#e0c477',
  // A seed head is dry grass, not corn: it was the yellow of a buttercup and
  // a field of them read as a wheat crop.
  husk: '#ddd1a6', huskShade: '#c3b68b',
  clock: '#f4f5ec', clockShade: '#dcdfce',
  line: '#8a7c6a',
};
const STONE = { lit: '#cbc5b7', shade: '#aaa497', line: '#867f71' };
const MOSS = { lit: '#9dba80', shade: '#7f9c67', line: '#5f7a4c' };

/**
 * The sward's whole palette: black and white, thinly.
 *
 * Painted in greys for an `overlay` at first, which was right and cost a
 * compositing pass a tile. Black and white at a twentieth of an alpha says
 * the same thing about a surface this flat, goes on with no blend at all, and
 * dims and greys with the ground under it because it is barely there.
 */
const SOD = {
  dark: 'rgba(38, 44, 28, 0.13)',
  mid: 'rgba(48, 56, 34, 0.09)',
  pale: 'rgba(255, 253, 236, 0.15)',
};

/* ---- the machinery ------------------------------------------------------- */

const cnv = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
};
const ctxOf = (c: HTMLCanvasElement): Ctx => c.getContext('2d') as Ctx;

/** The same sequence every time, on every machine, from one number. */
function rand(seed: number): Rand {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How big a sprig is painted against how big it is drawn.
 *
 * A tile is ninety-six pixels across at zoom one, so a tuft two thirds of a
 * metre wide is sixteen pixels and a daisy is four. Painting at that size
 * would give a daisy nothing to be made of, so everything is painted three
 * times over and told its real size, and the browser takes it down -- which
 * also means it is still a daisy at the zoom somebody leans in at.
 */
const SCALE = 3;

/** A sprig, painted at `SCALE` and measured at one. */
function sprig(w: number, h: number, ax: number, ay: number, paint: (g: Ctx) => void): Sprig {
  const c = cnv(w * SCALE, h * SCALE);
  const g = ctxOf(c);
  g.scale(SCALE, SCALE);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  paint(g);
  return { canvas: c, w, h, ax, ay };
}

/* ---- what grows ---------------------------------------------------------- */

/**
 * A fan of blades from one root: wide at the root, bending further over the
 * further out it is thrown, and thinner every pixel until it stops.
 *
 * Drawn outermost first and in the deeper green, so a tuft has a back and a
 * front rather than being a flat comb of lines.
 */
function fan(g: Ctx, x: number, base: number, w: number, h: number, R: Rand, seeded: boolean): void {
  const n = 5 + Math.floor(R() * 5);
  const spread: Array<[number, number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const a = (t - 0.5) * 1.4 + (R() - 0.5) * 0.32;
    // Wide enough at the root to survive being drawn at a fifth of the size
    // it was painted: a blade a pixel across washes out to the ground under it.
    spread.push([a, h * (0.58 + 0.42 * Math.cos(a)) * (0.76 + R() * 0.34), x + (R() - 0.5) * w * 0.55, 0.95 + R() * 0.7]);
  }
  spread.sort((p, q) => Math.abs(q[0]) - Math.abs(p[0]));
  for (let i = 0; i < spread.length; i++) {
    const [a, len, rx, bw] = spread[i];
    const sa = Math.sin(a), ca = Math.cos(a);
    const tipX = rx + sa * len * 1.3, tipY = base - ca * len;
    const midX = rx + sa * len * 0.44, midY = base - ca * len * 0.62;
    g.beginPath();
    g.moveTo(rx - ca * bw, base - sa * bw);
    g.quadraticCurveTo(midX - ca * bw * 0.55, midY - sa * bw * 0.55, tipX, tipY);
    g.quadraticCurveTo(midX + ca * bw * 0.55, midY + sa * bw * 0.55, rx + ca * bw, base + sa * bw);
    g.closePath();
    const d = i / Math.max(1, spread.length - 1);
    g.fillStyle = d < 0.4 ? LEAF.deep : d < 0.8 ? LEAF.mid : LEAF.lit;
    g.fill();
    g.strokeStyle = LEAF.line;
    g.lineWidth = 0.38;
    g.stroke();
    // A head of seed on the one or two that got away, which is what a meadow
    // in June is and a lawn never is.
    if (seeded && i >= spread.length - 2) {
      g.beginPath();
      g.ellipse(tipX, tipY, 0.7, 1.7, a * 0.8, 0, 7);
      g.fillStyle = BLOOM.husk;
      g.fill();
      g.strokeStyle = BLOOM.huskShade;
      g.lineWidth = 0.28;
      g.stroke();
    }
  }
}

/** A flower head seen from almost above: petals round an eye. */
function head(g: Ctx, x: number, y: number, r: number, petals: number, fill: string, shade: string, eye: string, R: Rand): void {
  const turn = R() * Math.PI * 2;
  for (let i = 0; i < petals; i++) {
    const a = turn + (i / petals) * Math.PI * 2;
    g.beginPath();
    g.ellipse(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.44, r * 0.52, r * 0.34, a, 0, 7);
    g.fillStyle = i < petals / 2 ? shade : fill;
    g.fill();
    g.strokeStyle = BLOOM.line;
    g.lineWidth = 0.35;
    g.stroke();
  }
  g.beginPath();
  g.ellipse(x, y, r * 0.3, r * 0.22, 0, 0, 7);
  g.fillStyle = eye;
  g.fill();
}

/** A clover leaf: three lobes and a notch in each, on a short stalk. */
function trefoil(g: Ctx, x: number, y: number, r: number, R: Rand): void {
  const turn = R() * Math.PI * 2;
  for (let i = 0; i < 3; i++) {
    const a = turn + (i / 3) * Math.PI * 2;
    g.beginPath();
    g.ellipse(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.36, r * 0.52, r * 0.4, a, 0, 7);
    g.fillStyle = i === 0 ? LEAF.mid : i === 1 ? LEAF.lit : LEAF.deep;
    g.fill();
    g.strokeStyle = LEAF.line;
    g.lineWidth = 0.35;
    g.stroke();
  }
}

/** A dandelion clock: a pale ball of nothing much, on a bare stem. */
function clock(g: Ctx, x: number, base: number, h: number, r: number, R: Rand): void {
  g.beginPath();
  g.moveTo(x, base);
  g.quadraticCurveTo(x + (R() - 0.5) * 1.6, base - h * 0.6, x, base - h + r * 0.6);
  g.strokeStyle = LEAF.deep;
  g.lineWidth = 0.7;
  g.stroke();
  g.beginPath();
  g.arc(x, base - h, r, 0, 7);
  g.fillStyle = BLOOM.clock;
  g.fill();
  g.strokeStyle = BLOOM.clockShade;
  g.lineWidth = 0.4;
  g.stroke();
  // Half a dozen seeds still on it, which is what says clock rather than ball.
  g.strokeStyle = BLOOM.clockShade;
  g.lineWidth = 0.3;
  for (let i = 0; i < 7; i++) {
    const a = R() * Math.PI * 2;
    g.beginPath();
    g.moveTo(x, base - h);
    g.lineTo(x + Math.cos(a) * r * 1.12, base - h + Math.sin(a) * r * 1.12);
    g.stroke();
  }
}

/** A stone that worked its way up, which every field has and no lawn does. */
function pebble(g: Ctx, x: number, y: number, r: number, R: Rand): void {
  g.beginPath();
  g.ellipse(x, y, r, r * (0.6 + R() * 0.2), (R() - 0.5) * 1.2, 0, 7);
  g.fillStyle = STONE.lit;
  g.fill();
  g.strokeStyle = STONE.line;
  g.lineWidth = 0.4;
  g.stroke();
  g.beginPath();
  g.ellipse(x + r * 0.18, y + r * 0.2, r * 0.6, r * 0.3, 0, 0, 7);
  g.fillStyle = STONE.shade;
  g.globalAlpha = 0.5;
  g.fill();
  g.globalAlpha = 1;
}

/** A cushion of moss: lobes, and no blade anywhere in it. */
function cushion(g: Ctx, x: number, y: number, w: number, h: number, R: Rand): void {
  const lobes: Array<[number, number, number]> = [];
  for (let i = 0; i < 7; i++) {
    lobes.push([x + (R() - 0.5) * w * 0.8, y + (R() - 0.5) * h * 0.7, h * (0.4 + R() * 0.4)]);
  }
  for (const pass of [0, 1]) {
    g.beginPath();
    for (const [lx, ly, lr] of lobes) {
      g.moveTo(lx + lr, ly + (pass ? 0 : 0.7));
      g.arc(lx, ly + (pass ? 0 : 0.7), lr, 0, 7);
    }
    g.fillStyle = pass ? MOSS.lit : MOSS.shade;
    g.fill();
  }
}

/* ---- the sward ----------------------------------------------------------- */

/** Pixels to a four-metre tile in the sward, and how many tiles it runs. */
const SWARD_TILE = 128;
const SWARD_N = 3;
const SWARD_W = SWARD_TILE * SWARD_N;

/**
 * The ground under all of it: three tiles by three, painted as one field and
 * cut up after, so nothing repeats inside twelve metres.
 *
 * It is not a blade texture. The references are nearly flat colour with the
 * detail standing in it rather than printed on it, and a field of hatching
 * seen from above reads as carpet. What is here is the lie of the ground --
 * pools of light and shade -- and the marks of the clumps growing in it, laid
 * in drifts that turn slowly across the sheet.
 */
function swardSheet(): HTMLCanvasElement {
  const c = cnv(SWARD_W, SWARD_W);
  const g = ctxOf(c);
  g.lineCap = 'round';
  /** Draw a thing at every wrap it reaches, so the sheet butts itself. */
  const wrapped = (x: number, y: number, r: number, paint: (dx: number, dy: number) => void): void => {
    for (const dx of [-SWARD_W, 0, SWARD_W]) {
      if (x + dx + r < 0 || x + dx - r > SWARD_W) continue;
      for (const dy of [-SWARD_W, 0, SWARD_W]) {
        if (y + dy + r < 0 || y + dy - r > SWARD_W) continue;
        paint(dx, dy);
      }
    }
  };
  // The lie of it: soft pools, light and dark, which is what stops a field of
  // one green reading as paper.
  const P = rand(8101);
  for (let i = 0; i < 14; i++) {
    const cx = P() * SWARD_W, cy = P() * SWARD_W;
    const r = SWARD_W * (0.08 + P() * 0.14);
    const ink = P() < 0.5 ? '0, 0, 0' : '255, 255, 255';
    const a = 0.04 + P() * 0.045;
    wrapped(cx, cy, r, (dx, dy) => {
      const grad = g.createRadialGradient(cx + dx, cy + dy, 0, cx + dx, cy + dy, r);
      grad.addColorStop(0, `rgba(${ink}, ${a.toFixed(3)})`);
      grad.addColorStop(1, `rgba(${ink}, 0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx + dx, cy + dy, r, 0, 7);
      g.fill();
    });
  }
  /*
   * And the clumps. Three or four little strokes together, leaning the same
   * way as their neighbours because grass grows the way the last wind left
   * it, with the lean turning slowly across the sheet. Whole waves, so the
   * turning wraps with everything else.
   */
  const R = rand(4409);
  for (let i = 0; i < 1150; i++) {
    const cx = R() * SWARD_W, cy = R() * SWARD_W;
    const lean = Math.sin((cx / SWARD_W) * Math.PI * 2 + 0.7) * 0.5
      + Math.sin((cy / SWARD_W) * Math.PI * 4 + 2.1) * 0.35
      + (R() - 0.5) * 0.5;
    const len = 6 + R() * 9;
    const n = 3 + Math.floor(R() * 3);
    const pale = R() < 0.34;
    wrapped(cx, cy, len + 4, (dx, dy) => {
      g.strokeStyle = pale ? SOD.pale : R() < 0.5 ? SOD.dark : SOD.mid;
      for (let k = 0; k < n; k++) {
        const a = lean + (k - (n - 1) / 2) * 0.32;
        const l = len * (0.7 + ((k * 37) % 11) / 22);
        g.lineWidth = 0.9 + ((k * 13) % 5) / 6;
        g.beginPath();
        g.moveTo(cx + dx, cy + dy);
        g.quadraticCurveTo(cx + dx + Math.sin(a) * l * 0.4, cy + dy - Math.cos(a) * l * 0.55,
          cx + dx + Math.sin(a) * l, cy + dy - Math.cos(a) * l * 0.8);
        g.stroke();
      }
    });
  }
  // A few scrapes where it has been walked thin or a mole has been at it.
  const S = rand(1777);
  for (let i = 0; i < 26; i++) {
    const cx = S() * SWARD_W, cy = S() * SWARD_W;
    const r = 5 + S() * 11;
    wrapped(cx, cy, r + 2, (dx, dy) => {
      g.beginPath();
      g.ellipse(cx + dx, cy + dy, r, r * (0.5 + 0.3), (S() - 0.5) * 2, 0, 7);
      g.fillStyle = `rgba(255, 245, 225, ${(0.05 + 0.05 * ((i % 3) / 3)).toFixed(3)})`;
      g.fill();
    });
  }
  return c;
}

/* ---- the ten ------------------------------------------------------------- */

/**
 * What a tile is, from where it is and nothing else.
 *
 * A slow noise over the map decides the drift, so daisies come in a patch of
 * daisies rather than one tile in ten being a surprise; then three tiles in
 * ten jump to a neighbouring look, which is what gives a drift a ragged edge
 * instead of a border. Plain sward is weighted heaviest, because a meadow
 * that is all flowers is a garden.
 */
const WEIGHTS = [21, 10, 10, 9, 9, 6, 9, 8, 9, 9];
const CUTS = ((): number[] => {
  const out: number[] = [];
  let sum = 0;
  const total = WEIGHTS.reduce((a, b) => a + b, 0);
  for (const w of WEIGHTS) { sum += w; out.push(sum / total); }
  return out;
})();

/** Value noise over the map, smooth over six tiles. */
function drift(x: number, y: number): number {
  const s = 1 / 6;
  const gx = Math.floor(x * s), gy = Math.floor(y * s);
  const fx = x * s - gx, fy = y * s - gy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(gx, gy, 811), b = hash2(gx + 1, gy, 811);
  const c = hash2(gx, gy + 1, 811), d = hash2(gx + 1, gy + 1, 811);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

/** Which of the ten this tile is. */
export function grassLook(x: number, y: number): number {
  const n = drift(x, y);
  let base = CUTS.length - 1;
  for (let i = 0; i < CUTS.length; i++) if (n < CUTS[i]) { base = i; break; }
  const j = hash2(x, y, 71);
  if (j < 0.17) return (base + 1) % WEIGHTS.length;
  if (j < 0.30) return (base + WEIGHTS.length - 1) % WEIGHTS.length;
  return base;
}

/* ---- the whole of it ----------------------------------------------------- */

let painted: Meadow | null = null;

/** Painted once, the first time a field comes into view, and kept. */
export function meadow(): Meadow {
  if (painted) return painted;

  const sward = swardSheet();

  /*
   * What lies about. Sizes are metres at zoom one: a tile is ninety-six
   * pixels across and four metres, so twenty-four pixels is a metre, and a
   * daisy at a fifth of that is five pixels -- which is what a daisy is from
   * standing height, and the reason these are dots at a glance and flowers
   * when somebody leans in.
   */
  const strew: Sprig[] = [];
  const add = (w: number, h: number, ax: number, ay: number, paint: (g: Ctx) => void): number => {
    strew.push(sprig(w, h, ax, ay, paint));
    return strew.length - 1;
  };
  const CLOVER = add(7, 6, 3.5, 4, (g) => trefoil(g, 3.5, 3.2, 3.1, rand(21)));
  const CLOVER_FLOWER = add(8, 9, 4, 7, (g) => {
    const R = rand(33);
    trefoil(g, 4, 6, 2.8, R);
    g.beginPath(); g.moveTo(4, 6); g.lineTo(4.4, 3); g.strokeStyle = LEAF.deep; g.lineWidth = 0.6; g.stroke();
    g.beginPath(); g.arc(4.4, 2.4, 2, 0, 7); g.fillStyle = BLOOM.blush; g.fill();
    g.strokeStyle = BLOOM.line; g.lineWidth = 0.35; g.stroke();
  });
  const DAISY = add(7, 7, 3.5, 5, (g) => {
    g.beginPath(); g.moveTo(3.5, 6.6); g.lineTo(3.5, 3.4); g.strokeStyle = LEAF.deep; g.lineWidth = 0.6; g.stroke();
    head(g, 3.5, 3, 2.9, 7, BLOOM.white, BLOOM.whiteShade, BLOOM.eye, rand(41));
  });
  const DAISY_PAIR = add(11, 8, 5.5, 6, (g) => {
    const R = rand(53);
    for (const [x, y] of [[3, 3.4], [7.6, 2.6]] as Array<[number, number]>) {
      g.beginPath(); g.moveTo(x, 7.4); g.lineTo(x, y + 0.6); g.strokeStyle = LEAF.deep; g.lineWidth = 0.6; g.stroke();
      head(g, x, y, 2.7, 7, BLOOM.white, BLOOM.whiteShade, BLOOM.eye, R);
    }
  });
  const BUTTERCUP = add(7, 8, 3.5, 6, (g) => {
    g.beginPath(); g.moveTo(3.5, 7.6); g.quadraticCurveTo(3, 5, 3.6, 3.4); g.strokeStyle = LEAF.deep; g.lineWidth = 0.55; g.stroke();
    head(g, 3.6, 2.9, 2.6, 5, BLOOM.butter, BLOOM.butterShade, BLOOM.white, rand(61));
  });
  const BLUSH = add(7, 7, 3.5, 5.4, (g) => {
    g.beginPath(); g.moveTo(3.5, 6.8); g.lineTo(3.5, 3.6); g.strokeStyle = LEAF.deep; g.lineWidth = 0.55; g.stroke();
    head(g, 3.5, 3, 2.8, 5, BLOOM.blush, BLOOM.blushShade, BLOOM.white, rand(73));
  });
  const BLUSH_PAIR = add(11, 8, 5.5, 6.4, (g) => {
    const R = rand(83);
    for (const [x, y] of [[3.2, 3.6], [7.8, 2.8]] as Array<[number, number]>) {
      g.beginPath(); g.moveTo(x, 7.6); g.lineTo(x, y + 0.6); g.strokeStyle = LEAF.deep; g.lineWidth = 0.55; g.stroke();
      head(g, x, y, 2.5, 5, BLOOM.blush, BLOOM.blushShade, BLOOM.white, R);
    }
  });
  const CLOCK = add(8, 10, 4, 9.4, (g) => clock(g, 4, 9.6, 6.6, 2.3, rand(97)));
  const ROSETTE = add(9, 7, 4.5, 5, (g) => {
    const R = rand(101);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + R();
      g.beginPath();
      g.ellipse(4.5 + Math.cos(a) * 2, 4.4 + Math.sin(a) * 1.3, 2.1, 1.1, a, 0, 7);
      g.fillStyle = i % 2 ? LEAF.mid : LEAF.deep;
      g.fill();
      g.strokeStyle = LEAF.line; g.lineWidth = 0.3; g.stroke();
    }
  });
  const PEBBLE = add(8, 6, 4, 4.2, (g) => pebble(g, 4, 3.6, 3, rand(113)));
  const CUSHION = add(16, 9, 8, 6.5, (g) => cushion(g, 8, 5.4, 13, 5, rand(127)));
  const HUSK = add(5, 8, 2.5, 7.6, (g) => {
    const R = rand(139);
    g.beginPath();
    g.moveTo(2.5, 7.8);
    g.quadraticCurveTo(2.5 + (R() - 0.5) * 1.6, 4.4, 2.8, 1.8);
    g.strokeStyle = LEAF.deep; g.lineWidth = 0.4; g.stroke();
    g.beginPath(); g.ellipse(2.8, 1.8, 0.75, 1.7, 0.1, 0, 7);
    g.fillStyle = BLOOM.husk; g.fill();
    g.strokeStyle = BLOOM.huskShade; g.lineWidth = 0.28; g.stroke();
  });
  const PETAL = add(5, 4, 2.5, 2.4, (g) => {
    g.beginPath();
    g.ellipse(2.5, 2, 2, 1.1, 0.6, 0, 7);
    g.fillStyle = BLOOM.blush; g.fill();
    g.strokeStyle = BLOOM.line; g.lineWidth = 0.3; g.stroke();
  });

  /*
   * And what stands up. Four families: short, middling, tall, and the coarse
   * tussock nobody has been over with a scythe. Each is rooted at the middle
   * of its foot, because that is the point a lean is taken about.
   */
  const tufts: Sprig[] = [];
  const stand = (w: number, h: number, seeded: boolean, seed: number): number => {
    tufts.push(sprig(w, h, w / 2, h - 0.5, (g) => fan(g, w / 2, h - 0.5, w * 0.7, h - 1.2, rand(seed), seeded)));
    return tufts.length - 1;
  };
  const SHORT = [stand(9, 6, false, 201), stand(11, 7, false, 211), stand(8, 6, false, 223), stand(10, 7, false, 227)];
  const MID = [stand(12, 10, false, 233), stand(13, 11, false, 241), stand(11, 9, false, 251), stand(13, 10, false, 257)];
  const TALL = [stand(13, 14, false, 263), stand(15, 16, false, 271), stand(12, 13, false, 281), stand(14, 15, false, 283)];
  const SEEDED = [stand(14, 16, true, 293), stand(16, 18, true, 307), stand(13, 15, true, 309)];
  const COARSE = [stand(17, 13, false, 311), stand(19, 14, true, 317), stand(16, 12, false, 331)];

  /**
   * The ten. `tells` is what a turn sheet should be able to find each one by,
   * the way the wall variants name theirs.
   */
  const looks: Look[] = [
    { name: 'Sward', tells: 'nothing in it but grass: one short tuft and nothing else',
      strew: [HUSK], strewN: [0, 0], stand: SHORT, standN: [1, 1] },
    { name: 'Clover', tells: 'trefoils, a third of them in pink flower',
      strew: [CLOVER, CLOVER, CLOVER_FLOWER], strewN: [1, 3], stand: [...SHORT, ...MID], standN: [1, 1] },
    { name: 'Daisies', tells: 'white heads with a butter eye, singly and in pairs',
      strew: [DAISY, DAISY_PAIR, DAISY_PAIR], strewN: [1, 2], stand: MID, standN: [1, 1] },
    { name: 'Buttercups', tells: 'five yellow petals on a bent stem, held above the blades',
      strew: [BUTTERCUP, BUTTERCUP, ROSETTE], strewN: [1, 3], stand: MID, standN: [1, 1] },
    { name: 'Blush', tells: 'five pink petals round a cream eye: the sakura note',
      strew: [BLUSH, BLUSH_PAIR, BLUSH_PAIR, PETAL], strewN: [1, 2], stand: [...SHORT, ...MID], standN: [1, 1] },
    { name: 'Clocks', tells: 'a dandelion clock, the palest thing on the tile',
      strew: [CLOCK, HUSK], strewN: [1, 1], stand: TALL, standN: [1, 1] },
    { name: 'Tussock', tells: 'coarse and untidy: two or three tufts and nothing in flower',
      strew: [ROSETTE], strewN: [0, 1], stand: COARSE, standN: [2, 3] },
    { name: 'Bleached', tells: 'dry: seed husks, a stone, and one thin tuft',
      strew: [HUSK, HUSK, PEBBLE], strewN: [1, 2], stand: SHORT, standN: [1, 1] },
    { name: 'Mossy', tells: 'a cushion of moss and a stone or two, and no flower at all',
      strew: [CUSHION, PEBBLE, PEBBLE], strewN: [1, 2], stand: SHORT, standN: [0, 1] },
    { name: 'Seed heads', tells: 'the airy one: tall tufts gone to seed',
      strew: [HUSK], strewN: [1, 2], stand: SEEDED, standN: [1, 2] },
  ];

  painted = { sward, swardTiles: SWARD_N, swardTile: SWARD_TILE, strew, tufts, looks };
  return painted;
}

/**
 * Paint it while nobody is waiting on it, the way the walls are.
 *
 * It is a field's worth of drawing and it is all done the first time a blade
 * of grass comes into view, which is the first frame of the game.
 */
export function warmMeadow(): void {
  const idle = globalThis.requestIdleCallback;
  if (typeof idle === 'function') idle(() => { meadow(); });
  else setTimeout(() => { meadow(); }, 1200);
}
