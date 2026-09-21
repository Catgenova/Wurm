import { hash2 } from '../world/noise';
import { STREWN, TILE_DEFS, TileType } from '../world/tiles';

/**
 * The meadow: what grass is made of.
 *
 * Grass was a flat lozenge of one green with fourteen specks thrown at it,
 * and it is sixty per cent of what anybody looks at. Next to a painted wall
 * or a cobbled road it was the weakest surface in the game.
 *
 * The ground itself is one flat colour and stays that way. It carried a
 * texture for a while -- a sward of soft light and shade laid over the whole
 * field -- and flat is better, and cheaper by a good deal: the references it
 * is drawn from are one colour with the detail sitting on it in pieces you
 * can count, and a wash over the lot puts the field into the same range of
 * light and dark as the things standing in it.
 *
 * So the **blobs** are the only thing on it. There were tufts of blade grass
 * and daisies and buttercups and dandelion clocks and pebbles, and the whole
 * of that went: a meadow drawn from standing height is not a botany plate, it
 * is lumps of green in grass. So they are lumps of green -- built out of
 * lobes with an outline round them, a lighter green shifted up into the light
 * and a pale crown on the top of it, which is the same language the ivy on
 * the walls is drawn in, at a twentieth of the size.
 *
 * Bare earth and sand are here too, and they get the other painter. What
 * sits on them is not a thing standing on the ground, it is the ground: a
 * heap of turned earth, a dune on a beach. So those are drawn with no lobes
 * and no line at all -- light gathered on the side facing the sun, shade
 * gathering in the lee, and no edge anywhere. Drawn as clumps they came out
 * as gravel scattered over a road, which is the grain all of this was to be
 * rid of.
 *
 * Either way the colours are the tile's own, worked out from it, so bringing
 * a ground into this is a matter of saying what colour it is and how big and
 * how often its lumps come. None of them needs a palette of its own.
 *
 * Which of the ten a tile is comes out of where it is and nothing else: a
 * slow noise over the map so that the bigger clumps come in drifts, with
 * about a fifth of the tiles jumping to a neighbouring look so the drifts
 * have ragged edges. Nothing is stored, nothing is sent, and two people
 * standing on the same tile see the same grass.
 */

type Ctx = CanvasRenderingContext2D;
type Rand = () => number;
/** A lobe: where it is and how big, which is all a mass of them ever needs. */
type Lobe = [number, number, number];

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

/** One of the ten: which blobs it grows, how many, and how they sit. */
export interface Look {
  name: string;
  /** What a turn sheet should be able to find it by. */
  tells: string;
  blobs: readonly number[];
  blobN: readonly [number, number];
  /**
   * How far from the first one the rest of them sit, across the tile. Above
   * a third they are simply scattered; a tenth is a pair touching. Anything
   * under `CROWD` is drawn as a crowd, which means the later ones are put
   * *below* the first as well as beside it, so a small one behind a big one
   * reads as being behind it rather than hanging over the top of it.
   */
  spread: number;
  /**
   * Optional: which blobs each slot in turn may be, when a look is a
   * particular arrangement rather than a handful of the same kind.
   */
  slots?: readonly (readonly number[])[];
}

/** Under this, a look's blobs are a crowd and stack up the screen. */
export const CROWD = 0.16;

/** What one ground carries: the pictures, the ten arrangements of them, and how thickly. */
export interface Strew {
  blobs: Sprig[];
  looks: Look[];
  /** Clumps to a tile, averaged over the ten: what the field's density is. */
  clumps: number;
  /** The tone its ruffle is painted in where it runs out onto bare earth. */
  hem: Green;
  /** Where its ten fall, as running shares: how bare this ground is. */
  cuts: readonly number[];
}

/* ---- the paints ---------------------------------------------------------- */

/**
 * The four tones a clump is painted in: the line round the outside, the body,
 * the lighter side turned into the sun, and the pale crown on the top of it.
 * The same four the ivy on a wall is built from, because a clump of grass seen
 * from here and a clump of ivy seen from here are the same kind of thing.
 */
interface Green { line: string; shade: string; lit: string; top: string; foot: string }

/**
 * Those four, in three strengths, as offsets from the ground they grow out of:
 * how much lighter or darker each is than the tile, and how much of the tile's
 * own saturation it keeps. The hue is the tile's.
 *
 * Written this way round because a clump is a thing *of* its ground. The
 * meadow's greens were settled by eye first and this is measured off them, so
 * the meadow comes out of it unchanged to within a unit or two a channel --
 * and any other ground that grows anything gets clumps its own colour would
 * have grown, instead of a second palette to keep in step by hand.
 *
 * Two of the three sit below the ground and only the crown of any goes far
 * above it. The first go at the meadow was the other way round -- three greens
 * all lighter than the field, topped with something near cream -- and at the
 * size a clump is drawn the crown is most of it, so a hillside came out as a
 * scatter of white specks. A clump of anything standing in a field is darker
 * than the field: it is more leaf in the same square foot, and it shades its
 * own feet.
 */
type Tone = readonly [lighter: number, keepsSaturation: number];
const TONES: Record<'deep' | 'mid' | 'pale', readonly [Tone, Tone, Tone, Tone]> = {
  deep: [[-0.339, 0.81], [-0.206, 0.78], [-0.155, 0.71], [-0.039, 0.77]],
  mid: [[-0.276, 0.74], [-0.086, 0.71], [-0.035, 0.78], [0.069, 0.85]],
  pale: [[-0.208, 0.60], [0.045, 0.85], [0.086, 0.94], [0.153, 0.97]],
};

/** Hue, lightness and saturation of an r,g,b, each nought to one. */
function hueOf(c: readonly number[]): [number, number, number] {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b), l = (hi + lo) / 2;
  if (hi === lo) return [0, l, 0];
  const d = hi - lo;
  const sat = l > 0.5 ? d / (2 - hi - lo) : d / (hi + lo);
  const h = hi === r ? ((g - b) / d + (g < b ? 6 : 0)) : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, l, sat];
}

/** And back again. */
function rgbOf(h: number, l: number, s: number): [number, number, number] {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const at = (t: number): number => {
    const u = (t + 1) % 1;
    const v = u < 1 / 6 ? p + (q - p) * 6 * u
      : u < 1 / 2 ? q
        : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6
          : p;
    return Math.round(Math.max(0, Math.min(1, v)) * 255);
  };
  return [at(h + 1 / 3), at(h), at(h - 1 / 3)];
}

/** And as a colour a canvas will take. */
const hexOf = (h: number, l: number, s: number): string =>
  `#${rgbOf(h, l, s).map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/**
 * The three strengths a given ground grows its clumps in.
 *
 * `stand` is how far off the ground those tones are allowed to get: one gives
 * the offsets above as measured, and less pulls all of them back towards the
 * tile's own colour.
 */
function greensOf(color: readonly number[], stand = 1): [deep: Green, mid: Green, pale: Green] {
  const [h, l, s] = hueOf(color);
  /*
   * The shade a thing throws at its own foot, in the ground's hue rather than
   * in one fixed green-black. A dune with a green smudge under it is a stain
   * on the beach; the sand's own shadow is the sand, darker.
   */
  const [fr, fg, fb] = rgbOf(h, Math.max(0.02, l - 0.42), s * 0.55);
  const foot = `rgba(${fr}, ${fg}, ${fb}, 0.13)`;
  const one = (rows: readonly [Tone, Tone, Tone, Tone]): Green => {
    const [line, shade, lit, top] = rows.map(([dl, ks]) =>
      hexOf(h, Math.max(0.02, Math.min(0.97, l + dl * stand)), s * ks));
    return { line, shade, lit, top, foot };
  };
  return [one(TONES.deep), one(TONES.mid), one(TONES.pale)];
}

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
 * How big a blob is painted against how big it is drawn.
 *
 * A tile is ninety-six pixels across at zoom one, so a clump half a metre
 * wide is twelve pixels. Painting at that size would give it nothing to be
 * made of, so everything is painted three times over and told its real size,
 * and the browser takes it down -- which also means it is still a clump of
 * lobes at the zoom somebody leans in at.
 */
const SCALE = 3;

/** A blob, painted at `SCALE` and measured at one. */
function sprig(w: number, h: number, ax: number, ay: number, paint: (g: Ctx) => void): Sprig {
  const c = cnv(w * SCALE, h * SCALE);
  const g = ctxOf(c);
  g.scale(SCALE, SCALE);
  g.lineJoin = 'round';
  paint(g);
  return { canvas: c, w, h, ax, ay };
}

/* ---- what grows ---------------------------------------------------------- */

/**
 * The lobes of one clump: circles packed into an oval, jittered.
 *
 * Rows of them, each row as wide as the oval is at that height, so the
 * silhouette is a shape rather than a rectangle of bubbles -- and each lobe
 * off its own roll for size and place, because a clump of anything growing is
 * lumpy at its edge and that edge is the whole of what you see of it.
 */
function lobesOf(cx: number, cy: number, w: number, h: number, R: Rand): Lobe[] {
  const cs: Lobe[] = [];
  /*
   * Big lobes, well overlapped. Small ones spaced apart gave a clump fifteen
   * separate circles round its edge, which is a bunch of grapes; what a mass
   * of leaves looks like is one shape with five or six bumps on it, and that
   * means each lobe has to be a good share of the whole and has to run into
   * its neighbours rather than sit beside them.
   */
  const r = Math.max(1.6, Math.min(w, h) * 0.42);
  const rows = Math.max(2, Math.round(h / (r * 0.82)));
  for (let j = 0; j < rows; j++) {
    const t = rows === 1 ? 0.5 : j / (rows - 1);
    const y = cy - h / 2 + t * h;
    // How wide the oval is at this height, never quite to nothing.
    const hw = (w / 2) * Math.sqrt(Math.max(0.12, 1 - (t * 2 - 1) ** 2 * 0.86));
    const n = Math.max(0, Math.round((hw * 2) / (r * 0.88)));
    for (let i = 0; i <= n; i++) {
      const x = n ? cx - hw + (i / n) * hw * 2 : cx;
      cs.push([x + (R() - 0.5) * r * 0.34, y + (R() - 0.5) * r * 0.3, r * (0.78 + R() * 0.46)]);
    }
  }
  return cs;
}

/** The union of a set of lobes as one path, grown or shrunk by `grow`. */
function union(g: Ctx, cs: Lobe[], dx: number, dy: number, grow: number): void {
  g.beginPath();
  for (const [x, y, r] of cs) {
    const rr = Math.max(0.25, r + grow);
    g.moveTo(x + dx + rr, y + dy);
    g.arc(x + dx, y + dy, rr, 0, 7);
  }
}

/**
 * One clump: the outline, the body, the side of it in the sun, and the crown.
 *
 * Four passes over the same lobes and nothing else, which is how everything
 * green in this game is drawn. Overlapping circles filled in one path union
 * rather than stack, so the middle of a clump is not darker than its edge.
 */
function clump(g: Ctx, cx: number, cy: number, w: number, h: number, R: Rand, pal: Green): void {
  const cs = lobesOf(cx, cy, w, h, R);
  /*
   * Where it meets the ground. The field runs on behind a clump unchanged, so
   * without this the bottom edge of one is the only thing saying where it
   * stands and a clump reads as printed on the field rather than growing out
   * of it. It goes on first, under everything, and it is away from the sun,
   * which here comes over the top left.
   */
  g.beginPath();
  g.ellipse(cx + w * 0.06, cy + h * 0.34, w * 0.46, h * 0.13, 0, 0, 7);
  g.fillStyle = pal.foot;
  g.fill();
  // The line is a share of a lobe, not a fixed weight. At a pixel and a bit
  // round a lobe two pixels across, a small clump came out as more outline
  // than clump and the hollows between its lobes filled in solid.
  const line = Math.max(0.32, Math.min(w, h) * 0.3 * 0.2);
  union(g, cs, 0, 0, line);
  g.fillStyle = pal.line;
  g.fill();
  union(g, cs, 0, 0, 0);
  g.fillStyle = pal.shade;
  g.fill();
  g.save();
  union(g, cs, 0, 0, 0);
  g.clip();
  union(g, cs, -w * 0.05, -h * 0.13, 0);
  g.fillStyle = pal.lit;
  g.fill();
  // And the crown: the lobes along the top, lifted again and paler, which is
  // the light coming over the top of a thing that has a top. It is kept to
  // the top of it -- taken any deeper, a clump four pixels high is crown all
  // the way down and stops being a green thing at all.
  const top = cs.filter((c) => c[1] < cy - h * 0.16);
  if (top.length) {
    union(g, top, -w * 0.07, -h * 0.16, -0.4);
    g.fillStyle = pal.top;
    g.fill();
  }
  g.restore();
}

/* ---- and what the ground does on its own ---------------------------------- */

/**
 * How far a swell's tones are let stand off the ground it is a swell of.
 *
 * A clump is a thing in its own right and may be any shade; a dune is the
 * same sand at another angle to the sun, and half a shade is the whole of the
 * difference between a beach with dunes on it and a beach with stains on it.
 */
const SWELL_STAND = 0.72;

/**
 * A swell of the ground itself: a dune on a beach, a heap of turned earth.
 *
 * Not lobes with a line round them, because this is not a thing *standing on*
 * the ground -- it is the ground, lying at another angle to the sun. All you
 * see of a dune from here is light gathered along the side facing the sun and
 * shade gathering in the lee of it, and no edge anywhere. An edge of any sort
 * is exactly what turns a dune into a pebble lying on the beach, which is
 * what drawing it out of lobes gave and what this is here to be rid of.
 *
 * So: two soft fills, one up into the sun and one down out of it, each flat
 * through the middle and gone by its rim, set either side of where the crest
 * runs. Between them they are the whole of the thing.
 */
function swell(g: Ctx, cx: number, cy: number, w: number, h: number, R: Rand, pal: Green): void {
  // Its own roll for size and lie, so a stretch of beach is not one oval
  // stamped out twenty times.
  const rx = (w / 2) * (0.86 + R() * 0.28);
  const ry = (h / 2) * (0.86 + R() * 0.28);
  const tilt = (R() - 0.5) * 0.5;
  const lay = (dx: number, dy: number, k: number, c: string): void => {
    g.save();
    g.translate(cx + dx, cy + dy);
    g.rotate(tilt);
    g.scale(rx * k, ry * k);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0, c);
    grad.addColorStop(0.42, c);
    grad.addColorStop(1, `${c}00`);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, 1, 0, 7);
    g.fill();
    g.restore();
  };
  /*
   * The lee, and the sunlit back of it. They sit either side of where the
   * crest runs rather than one over the other: laid concentrically they cover
   * each other over most of their width, the light and the shade cancel, and
   * all that is left of a dune is two thin crescents. The sun comes over the
   * top left here, as it does for everything else in the game.
   */
  lay(w * 0.2, h * 0.24, 0.85, pal.shade);
  lay(-w * 0.18, -h * 0.22, 0.85, pal.top);
}

/* ---- the ruffled edge ---------------------------------------------------- */

/**
 * The radius of a lobe of the ruffle, in screen pixels at zoom one. A tile is
 * ninety-six of those and four metres, so a lobe is about a third of a metre
 * across: the ragged foot of a field, not a hedge along the path.
 */
const RUFFLE = 4.2;

/**
 * Grass running out onto a path, along one edge of one tile.
 *
 * The rest of the ground meets the ground beside it on a ruled line, which is
 * right for a flagstone against a flagstone and wrong for a field against a
 * track somebody wore across it: the field does not stop, it thins out and
 * gives up in lumps. So where grass touches bare earth the earth gets a row
 * of grass lobes bulging over its edge -- the same lobes the clumps are built
 * from, which is the only shape anything growing has in this game.
 *
 * It is drawn from the *earth* tile, into the earth tile, and clipped to it:
 * everything that would fall on the grass side is grass green on grass and
 * there is nothing there to see, so it is cut off rather than left to be
 * painted over by whichever tile happens to be drawn next.
 *
 * `pal` is the sward's own middle tone: a field ruffles in its own colour, or
 * the steppe would run out onto a track in the meadow's green.
 *
 * `a` and `b` are the two ends of the shared edge on screen and `cx, cy` is
 * the middle of the earth tile, which is the way in. `flip` says the two ends
 * came out in the other order this quarter turn -- without it the ruffle
 * reads along the edge one way at one rotation and the other way at the next,
 * and the ground crawls as the camera comes round.
 */
export function ruffle(
  g: Ctx, pal: Green, ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, flip: boolean, seed: number, zoom: number,
): void {
  const ex = bx - ax, ey = by - ay;
  const len = Math.hypot(ex, ey);
  if (len < 4) return;
  // The way in: square off the edge towards the middle of the tile, not at
  // the middle of the tile, or a lobe at one end leans across to meet it.
  let ix = cx - (ax + bx) / 2, iy = cy - (ay + by) / 2;
  const il = Math.hypot(ix, iy) || 1;
  ix /= il; iy /= il;
  const r = RUFFLE * zoom;
  const n = Math.max(2, Math.round(len / (r * 1.15)));
  const R = rand(seed);
  const cs: Lobe[] = [];
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n + (R() - 0.5) * (0.7 / n);
    const t = flip ? 1 - u : u;
    const lr = r * (0.62 + R() * 0.7);
    /*
     * Barely set back from the line at all. A lobe sitting on it reaches its
     * own radius onto the earth, and that is the whole depth of the ruffle:
     * set back half a radius as well and it reaches half as far again, which
     * came out as a hedge growing along the side of the track.
     */
    const into = lr * (0.05 + R() * 0.3);
    cs.push([ax + ex * t + ix * into, ay + ey * t + iy * into, lr]);
  }
  const ink = Math.max(0.5, r * 0.11);
  union(g, cs, 0, 0, ink);
  g.fillStyle = pal.line;
  g.fill();
  union(g, cs, 0, 0, 0);
  g.fillStyle = pal.shade;
  g.fill();
  g.save();
  union(g, cs, 0, 0, 0);
  g.clip();
  union(g, cs, -r * 0.12, -r * 0.26, -ink);
  g.fillStyle = pal.lit;
  g.fill();
  g.restore();
}

/* ---- the ten ------------------------------------------------------------- */

/**
 * What a tile is, from where it is and nothing else.
 *
 * A slow noise over the map decides the drift, so the thick ground comes in
 * patches of thick ground rather than one tile in ten being a surprise; then
 * a fifth of the tiles jump to a *neighbouring* look, which is what gives a
 * drift a ragged edge instead of a border.
 *
 * Neighbouring is why `looks` is ordered from the emptiest to the thickest
 * and why the jump clamps at each end rather than wrapping. It used to wrap,
 * which made the thickest look a neighbour of the emptiest: one tile in eight
 * of the open ground grew a clump the size of a bush, the drift never read as
 * a drift, and the whole field came out as evenly spotted as a dice face.
 *
 * Nearly all of the weight is on the first look, which is the empty one, so
 * nearly all of a field has nothing growing in it at all. A field that is all
 * clumps is a bog, and grass is what this is: flat colour with an occasional
 * feature in it. The clumps are the thing you notice, and you cannot notice
 * something that is everywhere.
 */
const WEIGHTS = [560, 32, 22, 15, 12, 10, 8, 6, 4, 3];

/**
 * A weighted list as running shares of the whole, which is the shape a noise
 * between nought and one can be looked up in. Every ground works its own out,
 * because how bare a beach is and how bare a meadow is are not the same
 * question.
 */
const cutsOf = (ws: readonly number[]): number[] => {
  const total = ws.reduce((a, b) => a + b, 0);
  let sum = 0;
  return ws.map((w) => { sum += w; return sum / total; });
};

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

/**
 * Which of the ten this tile is.
 *
 * The drift is the place's and the cuts are the ground's: the same patch of
 * country comes out thick or thin wherever you are standing, and what thick
 * amounts to is the one thing a beach and a meadow differ by here.
 */
export function strewLook(cuts: readonly number[], x: number, y: number): number {
  const n = drift(x, y);
  let base = cuts.length - 1;
  for (let i = 0; i < cuts.length; i++) if (n < cuts[i]) { base = i; break; }
  const j = hash2(x, y, 71);
  const step = j < 0.12 ? 1 : j < 0.22 ? -1 : 0;
  return Math.min(cuts.length - 1, Math.max(0, base + step));
}

/* ---- the whole of it ----------------------------------------------------- */

/** What one ground calls the things lying on it, for the tells. */
interface Ground {
  /** The one word for the stuff it is made of: a lump in the lightest of it. */
  word: string;
  /** What its palest lumps mean, and what its deepest ones do. */
  palest: string;
  deepest: string;
  /** So two grounds do not grow the same lumps in two colours. */
  seed: number;
  /**
   * How big the things on it are against a meadow's clumps, how far they are
   * squashed down, and how much rarer they are.
   */
  scale: number;
  flat: number;
  rarity: number;
  /**
   * And whether what sits on it is a thing *on* the ground or a swell *of*
   * it. A clump of grass is an object: lobes of leaf, a line round it, a good
   * deal darker or lighter than the field it stands in. A dune is the beach
   * at another angle to the sun: no line, no edge worth the name, and barely
   * a shade off the sand it is made of. Nothing is both, so this is not a
   * dial -- it picks which of the two painters above does the work.
   */
  swells?: true;
}

const GROUNDS: Partial<Record<TileType, Ground>> = {
  [TileType.Grass]: {
    word: 'green',
    palest: 'where the sun has been on it',
    deepest: 'the wet corner of a field',
    seed: 0, scale: 1, flat: 1, rarity: 1,
  },
  [TileType.Steppe]: {
    word: 'straw',
    palest: 'bleached out: the crown of a rise, where the wind gets at it',
    deepest: 'a hollow that held its water longer than the rest of it did',
    seed: 1000, scale: 1, flat: 1, rarity: 1,
  },
  /*
   * Turned earth: mounds of it, broad and low and a good deal wider than a
   * clump of grass. What was here first was stones -- a dozen little
   * hard-edged things a tile -- and a road of those reads as grit, which is
   * the grain all of this was drawn to be rid of. Earth lies in heaps; it
   * does not lie in gravel.
   */
  [TileType.Dirt]: {
    word: 'earth',
    palest: 'dried out on top, the way a heap does in a day of sun',
    deepest: 'turned up wet from under the rest of it',
    seed: 2000, scale: 2.6, flat: 0.6, rarity: 1.5, swells: true,
  },
  // Earth walked flat: the same, lower and rarer, because a road is a road.
  [TileType.PackedDirt]: {
    word: 'earth',
    palest: 'a rise of it, trodden pale on top',
    deepest: 'a hollow where the wheels go',
    seed: 3000, scale: 2.8, flat: 0.5, rarity: 2.2, swells: true,
  },
  /*
   * And a beach is dunes: the widest of the lot and the rarest, so a stretch
   * of sand is clean colour with one swell in it here and there. A dune is
   * not a thing lying on the beach, it is the beach -- the sun along the top
   * of it, the lee behind it, and nothing anywhere cutting it out from what
   * it is made of.
   */
  [TileType.Sand]: {
    word: 'sand',
    palest: 'the top of one, where the sun has dried it',
    deepest: 'the lee of one, out of the wind',
    seed: 4000, scale: 4.2, flat: 0.5, rarity: 3, swells: true,
  },
};

const painted = new Map<TileType, Strew>();

/**
 * What a ground grows, painted once the first time any of it comes into view.
 *
 * Every colour in here is a share of the tile's own rather than a number of
 * its own, so bringing a ground into this is a matter of saying what colour
 * it is, what the stuff on it is called, and how big and how often its lumps
 * come. The ten arrangements are the same for all of them: a clump of dry
 * steppe grass seen from standing height sits in a field the way a clump of
 * meadow does, and the thing that makes a steppe a steppe is that it is the
 * colour of straw.
 */
export function strew(type: TileType): Strew {
  const had = painted.get(type);
  if (had) return had;
  const ground = GROUNDS[type] ?? (GROUNDS[TileType.Grass] as Ground);
  const [DEEP, MID, PALE] = greensOf(TILE_DEFS[type].color, ground.swells ? SWELL_STAND : 1);

  /*
   * The blobs. Sizes are screen pixels at zoom one, where a tile is
   * ninety-six and four metres across: a twelve-pixel clump is half a metre,
   * which is a clump of grass, and a twenty-six-pixel one is a metre, which
   * is a bush nobody has cut back.
   */
  const blobs: Sprig[] = [];
  const grow = (across: number, up: number, pal: Green, seed: number): number => {
    /*
     * The ladder below is written at a meadow's size and every other ground
     * takes it times its own, which is how a mound of turned earth comes out
     * wider than a clump of grass and a dune wider again, and both of them
     * flatter than either.
     */
    const w = across * ground.scale, h = up * ground.scale * ground.flat;
    /*
     * Room round it to reach into. A lobe sits on the edge of the oval and
     * reaches a lobe's radius past it, and the outline reaches past that
     * again: painted into a picture three pixels wider than the clump, every
     * one of them came out with its sides cut off square. A swell is worse --
     * its two fills sit out either side of the crest and fade to nothing a
     * good way past the size it is nominally drawn at, and a fade that runs
     * into the edge of its own picture is a straight line across a dune.
     */
    const pad = 3 + (ground.swells ? Math.max(w, h) * 0.22 : Math.min(w, h) * 0.6);
    const cw = w + pad * 2, ch = h + pad * 2;
    // A clump stands on the ground and is rooted at its foot; a swell lies
    // flat in it and is rooted in the middle of itself.
    const ay = ch / 2 + (ground.swells ? 0 : h * 0.34);
    blobs.push(sprig(cw, ch, cw / 2, ay, (g) => {
      const R = rand(seed + ground.seed);
      if (ground.swells) swell(g, cw / 2, ch / 2, w, h, R, pal);
      else clump(g, cw / 2, ch / 2, w, h, R, pal);
    }));
    return blobs.length - 1;
  };
  /*
   * Four sizes in each of the three strengths, and a long low one in each.
   *
   * The smallest is six pixels and not four. At four it is a speck: too small
   * to be a lobed thing with a top and a side, so all anybody sees is a dot,
   * and a field of dots is the texture this was drawn to replace.
   */
  const TINY = [grow(6.2, 4.6, MID, 101), grow(6.8, 5, DEEP, 103), grow(5.8, 4.4, PALE, 107)];
  const SMALL = [grow(8.4, 6, MID, 109), grow(9, 6.4, DEEP, 113), grow(8, 5.6, PALE, 127)];
  const MEDIUM = [grow(9.8, 6.8, MID, 131), grow(10.6, 7.2, DEEP, 137), grow(9.2, 6.4, PALE, 139)];
  const BIG = [grow(13.4, 9.2, MID, 149), grow(14.2, 9.6, DEEP, 151), grow(12.6, 8.6, PALE, 157)];
  const LONG = [grow(15, 5.8, MID, 163), grow(16.2, 6.2, DEEP, 167), grow(14.2, 5.4, PALE, 173)];

  /**
   * The ten, in order of how much is on them -- which `strewLook` leans
   * on, since the tile next to a drift takes the look one along from it and
   * one along has to mean a little more or a little less of the same thing.
   *
   * `tells` is what a turn sheet should be able to find each one by, the way
   * the wall variants name theirs.
   */
  const looks: Look[] = [
    { name: 'Thin', tells: 'nothing growing in it: the open ground most of a field is',
      blobs: TINY, blobN: [0, 0], spread: 0.4 },
    { name: 'Speckled', tells: 'one or two of the smallest, well apart',
      blobs: TINY, blobN: [1, 2], spread: 0.5 },
    { name: 'Cushions', tells: 'one or two middling round ones and nothing else',
      blobs: SMALL, blobN: [1, 2], spread: 0.28 },
    { name: 'Pale', tells: `one or two in the lightest ${ground.word}: ${ground.palest}`,
      blobs: [TINY[2], SMALL[2], MEDIUM[2]], blobN: [1, 2], spread: 0.24 },
    { name: 'Strewn', tells: 'two or three small ones spread right across it',
      blobs: [...TINY, ...SMALL], blobN: [2, 3], spread: 0.5 },
    { name: 'Deep', tells: `one or two in the darkest ${ground.word}: ${ground.deepest}`,
      blobs: [SMALL[1], MEDIUM[1], BIG[1]], blobN: [1, 2], spread: 0.24 },
    { name: 'Mound', tells: 'one big one on its own, which is what a tile of it is for',
      blobs: BIG, blobN: [1, 1], spread: 0.4 },
    { name: 'Ridge', tells: 'a long low one, lying the way the ground does',
      blobs: LONG, blobN: [1, 2], spread: 0.3 },
    { name: 'Clustered', tells: 'two middling ones crowded together',
      blobs: MEDIUM, blobN: [2, 2], spread: 0.1 },
    { name: 'Mixed', tells: 'one big one with a small one in front of it',
      blobs: [...BIG, ...SMALL], blobN: [2, 2], spread: 0.11, slots: [BIG, SMALL] },
  ];

  /*
   * How often it grows anything at all. Only the empty look's weight moves:
   * the nine that carry something keep their shares of whatever is left, so a
   * rarer ground comes out barer without also coming out differently arranged.
   */
  const weights = WEIGHTS.map((w, i) => (i ? w : w * ground.rarity));
  const total = weights.reduce((a, b) => a + b, 0);
  // The average number of clumps a tile grows, off those weights and the
  // counts and nothing written down: `looks` is in the order they are.
  const clumps = looks.reduce(
    (a, l, i) => a + weights[i] * (l.blobN[0] + l.blobN[1]) / 2, 0) / total;
  const made: Strew = { blobs, looks, clumps, hem: MID, cuts: cutsOf(weights) };
  painted.set(type, made);
  return made;
}

/**
 * Paint what every ground grows while nobody is waiting on it, as the walls are.
 *
 * It is a field's worth of drawing per ground, and all of it is done the
 * first time a blade of grass comes into view, which is the first frame.
 */
export function warmMeadow(): void {
  const paint = (): void => { for (const t of STREWN) strew(t as TileType); };
  const idle = globalThis.requestIdleCallback;
  if (typeof idle === 'function') idle(paint);
  else setTimeout(paint, 1200);
}
