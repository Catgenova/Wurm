import { hash2 } from '../world/noise';
import { STREWN, TILE_DEFS, TileType } from '../world/tiles';

/**
 * The meadow: what grass is made of.
 *
 * Grass was a flat lozenge of one green with fourteen specks thrown at it,
 * and it is sixty per cent of what anybody looks at. Next to a painted wall
 * or a cobbled road it was the weakest surface in the game.
 *
 * It is built in two layers.
 *
 * The **sward** is the ground itself: one picture, three tiles by three, laid
 * across the whole field as a repeating pattern hung off the world's own axes
 * rather than blitted onto a tile at a time. It is black and white at a tenth
 * of an alpha and nothing else -- the same thing the fourteen speckles it
 * replaces always were -- so the tile keeps its own green, the hour's sun,
 * the slope it lies on and the grey of land you only remember.
 *
 * It is a pattern and not nine hundred little blits because nine hundred
 * little blits, each one sheared onto a rhombus, was the whole cost of this:
 * sixteen milliseconds of a frame, against two for everything else here put
 * together. One fill a row draws the lot.
 *
 * The **blobs** are what grows in it, and they are the only thing that does.
 * There were tufts of blade grass and daisies and buttercups and dandelion
 * clocks and pebbles, and the whole of that went: a meadow drawn from
 * standing height is not a botany plate, it is lumps of green in grass. So
 * they are lumps of green -- built out of lobes with an outline round them,
 * a lighter green shifted up into the light and a pale crown on the top of
 * it, which is the same language the ivy on the walls is drawn in, at a
 * twentieth of the size.
 *
 * Which of the ten a tile is comes out of where it is and nothing else: a
 * slow noise over the map so that the bigger clumps come in drifts, with
 * three tiles in ten jumping to a neighbouring look so the drifts have ragged
 * edges. Nothing is stored, nothing is sent, and two people standing on the
 * same tile see the same grass.
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
}

/* ---- the paints ---------------------------------------------------------- */

/**
 * The four tones a clump is painted in: the line round the outside, the body,
 * the lighter side turned into the sun, and the pale crown on the top of it.
 * The same four the ivy on a wall is built from, because a clump of grass seen
 * from here and a clump of ivy seen from here are the same kind of thing.
 */
interface Green { line: string; shade: string; lit: string; top: string }

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

/** And back again, as a colour a canvas will take. */
function hexOf(h: number, l: number, s: number): string {
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
  return `#${[at(h + 1 / 3), at(h), at(h - 1 / 3)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** The three strengths a given ground grows its clumps in. */
function greensOf(color: readonly number[]): [deep: Green, mid: Green, pale: Green] {
  const [h, l, s] = hueOf(color);
  const one = (rows: readonly [Tone, Tone, Tone, Tone]): Green => {
    const [line, shade, lit, top] = rows.map(([dl, ks]) =>
      hexOf(h, Math.max(0.02, Math.min(0.97, l + dl)), s * ks));
    return { line, shade, lit, top };
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
   * Where it meets the ground. The sward runs on behind a clump unchanged, so
   * without this the bottom edge of one is the only thing saying where it
   * stands and a clump reads as printed on the field rather than growing out
   * of it. It goes on first, under everything, and it is away from the sun,
   * which here comes over the top left.
   */
  g.beginPath();
  g.ellipse(cx + w * 0.06, cy + h * 0.34, w * 0.46, h * 0.13, 0, 0, 7);
  g.fillStyle = 'rgba(46, 62, 34, 0.13)';
  g.fill();
  // The line is a share of a lobe, not a fixed weight. At a pixel and a bit
  // round a lobe two pixels across, a small clump came out as more outline
  // than clump and the hollows between its lobes filled in solid.
  const ink = Math.max(0.32, Math.min(w, h) * 0.3 * 0.2);
  union(g, cs, 0, 0, ink);
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
const TOTAL = WEIGHTS.reduce((a, b) => a + b, 0);
/**
 * What share of the field is bare, and how many clumps a tile grows on
 * average -- both read off the weights rather than written down beside them,
 * so neither can drift from the thing it describes when the weights move.
 */
export const BARE_SHARE = WEIGHTS[0] / TOTAL;
const CUTS = ((): number[] => {
  const out: number[] = [];
  let sum = 0;
  for (const w of WEIGHTS) { sum += w; out.push(sum / TOTAL); }
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

/** Which of the ten this tile is. The drift is the place's, not the ground's. */
export function strewLook(x: number, y: number): number {
  const n = drift(x, y);
  let base = CUTS.length - 1;
  for (let i = 0; i < CUTS.length; i++) if (n < CUTS[i]) { base = i; break; }
  const j = hash2(x, y, 71);
  const step = j < 0.12 ? 1 : j < 0.22 ? -1 : 0;
  return Math.min(WEIGHTS.length - 1, Math.max(0, base + step));
}

/* ---- the whole of it ----------------------------------------------------- */

/** What one ground calls the things lying on it, for the tells. */
interface Ground {
  /** The one word for what grows on it: a clump in the lightest of it. */
  word: string;
  /** What its palest clumps mean, and what its deepest ones do. */
  palest: string;
  deepest: string;
  /** So two grounds do not grow the same lumps in two colours. */
  seed: number;
}

const GROUNDS: Partial<Record<TileType, Ground>> = {
  [TileType.Grass]: {
    word: 'green',
    palest: 'where the sun has been on it',
    deepest: 'the wet corner of a field',
    seed: 0,
  },
  [TileType.Steppe]: {
    word: 'straw',
    palest: 'bleached out: the crown of a rise, where the wind gets at it',
    deepest: 'a hollow that held its water longer than the rest of it did',
    seed: 1000,
  },
  // Turned earth: clods, and the stones that come up with them.
  [TileType.Dirt]: {
    word: 'earth',
    palest: 'dried out on top, the way a clod does in a day of sun',
    deepest: 'turned up wet from under the rest of it',
    seed: 2000,
  },
  // Earth somebody has walked flat: what is left is what would not go down.
  [TileType.PackedDirt]: {
    word: 'stone',
    palest: 'a pale one, trodden proud of the rest',
    deepest: 'a dark one, half of it still under',
    seed: 3000,
  },
  // A beach: shells and pebbles, and nothing else worth drawing on sand.
  [TileType.Sand]: {
    word: 'shell',
    palest: 'bleached white by the sun, the way a shell goes',
    deepest: 'a wet pebble, or one the tide has not turned for a while',
    seed: 4000,
  },
};

const painted = new Map<TileType, Strew>();

/**
 * What a ground grows, painted once the first time any of it comes into view.
 *
 * Every colour in here is a share of the tile's own rather than a number of
 * its own, so bringing a ground into this is a matter of saying what colour
 * it is and what the stuff growing on it is called. The sizes and the ten
 * arrangements are the same for all of them: a clump of dry steppe grass seen
 * from standing height is a clump the same way a clump of meadow is, and the
 * thing that makes a steppe a steppe is that it is the colour of straw.
 */
export function strew(type: TileType): Strew {
  const had = painted.get(type);
  if (had) return had;
  const ground = GROUNDS[type] ?? (GROUNDS[TileType.Grass] as Ground);
  const [DEEP, MID, PALE] = greensOf(TILE_DEFS[type].color);

  /*
   * The blobs. Sizes are screen pixels at zoom one, where a tile is
   * ninety-six and four metres across: a twelve-pixel clump is half a metre,
   * which is a clump of grass, and a twenty-six-pixel one is a metre, which
   * is a bush nobody has cut back.
   */
  const blobs: Sprig[] = [];
  const grow = (w: number, h: number, pal: Green, seed: number): number => {
    /*
     * Room round it for the lobes to stick out into. A lobe sits on the edge
     * of the oval and reaches a lobe's radius past it, and the outline reaches
     * past that again: painted into a picture three pixels wider than the
     * clump, every one of them came out with its sides cut off square.
     */
    const pad = Math.min(w, h) * 0.6 + 3;
    const cw = w + pad * 2, ch = h + pad * 2;
    blobs.push(sprig(cw, ch, cw / 2, ch / 2 + h * 0.34,
      (g) => clump(g, cw / 2, ch / 2, w, h, rand(seed + ground.seed), pal)));
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
    { name: 'Mound', tells: 'one big clump on its own, which is what a tile of it is for',
      blobs: BIG, blobN: [1, 1], spread: 0.4 },
    { name: 'Ridge', tells: 'a long low one, lying the way the ground does',
      blobs: LONG, blobN: [1, 2], spread: 0.3 },
    { name: 'Clustered', tells: 'two middling ones crowded together',
      blobs: MEDIUM, blobN: [2, 2], spread: 0.1 },
    { name: 'Mixed', tells: 'one big one with a small one in front of it',
      blobs: [...BIG, ...SMALL], blobN: [2, 2], spread: 0.11, slots: [BIG, SMALL] },
  ];

  // The average number of clumps a tile grows, off the weights and the counts
  // and nothing written down: `looks` is in the same order as `WEIGHTS`.
  const clumps = looks.reduce(
    (a, l, i) => a + WEIGHTS[i] * (l.blobN[0] + l.blobN[1]) / 2, 0) / TOTAL;
  const made: Strew = { blobs, looks, clumps, hem: MID };
  painted.set(type, made);
  return made;
}

/**
 * Paint every sward while nobody is waiting on it, the way the walls are.
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
