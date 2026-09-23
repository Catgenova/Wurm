import { WALL_HEIGHT } from '../game/building';
import { HEIGHT_SCALE, TILE_H } from './iso';

/**
 * Cobblestone, five ways, one seam.
 *
 * A cobblestone wall used to be a flat colour with a few ruled lines on it.
 * What it is now is a picture of one: the blocks a novice laid and the weather
 * has been at since, the ivy that has got over the top of it, the hedge grown
 * up its foot. The pictures are painted once, into canvases, and the renderer
 * fills the wall's faces with them; nothing here knows about the camera.
 *
 * Five of them, and they are interchangeable because they all keep one
 * contract at their edges. Sideways: on three of the four courses, and on the
 * band, a stone straddles the seam, drawn to the same shape and tone in every
 * variant, and the fourth course leaves a joint there no wider than any other,
 * so no two courses have an edge in the same place at a seam. Upwards: each
 * storey is a band course over four courses of blocks, so any variant stacks
 * on any variant and the band reads as the string course at each floor.
 *
 * What grows depends on where in the wall it is, so it is not painted into the
 * face. `spill` is the ivy, which belongs to the top storey, and is painted
 * taller than a face so the crest of it stands above the cap; `base` is the
 * hedge and `foot` the damp, which belong to the ground storey. Nothing that
 * is one variant's own comes within `MARGIN` of a seam.
 *
 * How things are drawn: every mass of growth is lobes the size of leaf
 * clusters under a dark olive line, lit from above -- a pale crown, a green
 * middle, a dark underside -- and every block is two flat tones with a bevel
 * along its top and the dark of its line only where the light leaves it. The
 * greens are sampled off the castle art the island is meant to sit beside.
 */

type Rand = () => number;
type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];
/** A lobe of a mass of growth: where it is, and how big. */
type Lobe = [number, number, number];
/** One block of a wall, and the outline it was drawn with. */
interface Block { x: number; y: number; w: number; h: number; course: number; pts: Pt[] }
/** How many more blocks of a tone are owed, so sand and brown come in pairs. */
interface Run { tone: string; left: number }
/** Ivy over the top of a section: a crest, and the curtain that falls from it. */
interface Drape { cx: number; w: number; fall: number; tongues?: number; seed: number }
/** A hedge at the foot of one. */
interface Hedge { cx: number; w: number; h: number; flowers: number; seed: number }
interface Variant {
  name: string;
  tells: string;
  seed: number;
  extras: { moss: number };
  drapes: Drape[];
  foot: { hedges: Hedge[] };
}

/**
 * Where an archway is cut, as fractions of a wall section.
 *
 * `t0` and `t1` are how far along the wall the jambs stand and `spring` how
 * far up it the curve starts. The rise is not here because it is not a free
 * number: a true semicircle rises by exactly the half span, and the renderer
 * works that out from these two in the units it already has.
 *
 * One statement, read by the texture that cuts the hole and by the renderer
 * that clips to it, because a hole in a picture and a hole in a wall that do
 * not agree is a wall with a seam of daylight round its doorway.
 *
 * Two numbers set by looking at it rather than by arithmetic.
 *
 * The head has to come down inside the wall: at half the storey the crown of
 * a 1.9 m opening stood 2.5 m up a 3 m wall, which leaves half a metre for
 * the ring that holds it and the course over that, so the ring ran off the
 * top of the section.
 *
 * And the straight part has to be longer than the curve is wide, or the
 * opening is a headstone. A semicircle on jambs its own radius long is the
 * shape of a grave marker and the eye says so before it says doorway. These
 * spans put the jamb at half again the radius: 1.7 m wide, 2.1 m to the
 * crown, and a course of field stone over the ring before the band.
 */
export const ARCH = { t0: 0.29, t1: 0.71, spring: 0.42 } as const;

/**
 * And where a window is cut, in the same fractions.
 *
 * Taller than the old one and a little narrower, for the reason a window in
 * rubble is always taller than it is wide: everything over it has to stand on
 * what is either side of it. The head comes down to 2.1 m so there is room
 * between it and the band for the lintel and the course of small wedges over
 * that, which is how a wall like this gets a metre and a third of nothing to
 * stay up.
 */
export const WINDOW = { t0: 0.33, t1: 0.67, k0: 0.3, k1: 0.7 } as const;

/**
 * And where a doorway is cut. It starts at the ground, so it has no `k0`.
 *
 * The numbers are the ones every other material's door has always used. A
 * doorway is the one opening whose size is settled by the man walking through
 * it rather than by what will stand up over it: 1.3 m by 2.2 m.
 */
export const DOOR = { t0: 0.34, t1: 0.66, k1: 0.74 } as const;

/**
 * And a cart gate, which is the same doorway twice as wide.
 *
 * Its head is a little lower than the single one's, and for a reason worth
 * saying: two and a half metres is further than the oak over it will go
 * unaided, so there is a corbel under each end of the beam and a corbel wants
 * a course to sit in. A gate is wide, not tall -- you drive a cart through it,
 * and a cart is not two and a quarter metres high.
 */
export const DOUBLE = { t0: 0.2, t1: 0.8, k1: 0.7 } as const;

/**
 * And a bay, which is a window that does not stay in the wall.
 *
 * Narrower than the old one, and for a reason the picture cares about and the
 * flat colours did not: the jambs of an opening this wide are drawn stones,
 * and at 0.18 they reached into the courses that straddle the section's seam
 * and cut them in half. At 0.24 there is a stone's width of ordinary field
 * between the jamb and the seam, so a bay butts its neighbours like anything
 * else. The head comes down for the same reason the window's did -- the
 * lintel and the wedges over it have to fit under the band.
 */
export const BAY = { t0: 0.24, t1: 0.76, k0: 0.33, k1: 0.72 } as const;

/**
 * And where a gate goes in a field wall.
 *
 * There is no wall over it to hold up, so the gap runs clear to the top and
 * the two piers either side of it carry nothing but themselves. That is what
 * a gate in a dry wall is: a hole, and a squarer bit of walling at each edge
 * of it so the hole keeps its shape when a cart clips it.
 */
export const FENCE_GAP = { t0: 0.2, t1: 0.8 } as const;

/**
 * A field wall: the low one, with a coping instead of a band and everything it
 * carries painted into the one picture, because it has no openings to clip
 * growth out of and no storey above it to belong to.
 */
export interface Low {
  face: HTMLCanvasElement[];
  /** The same with a gap for a gate, and a pier dressed against each side of it. */
  gate: HTMLCanvasElement[];
  /** The run of cope stones seen from above, one per variant, the same stones as that variant's face. */
  cap: HTMLCanvasElement[];
  /** The same with the gate's opening taken out of it, and a flat stone on each pier. */
  gateCap: HTMLCanvasElement[];
  ends: HTMLCanvasElement;
  h: number;
  /** How far the face and the cap are painted past the wall, so a cope stone can stand over the run. */
  proud: number;
  /**
   * On a masonry whose head is laid by hand, how far that head rises over
   * its line along a section, per variant, in picture px at evenly spaced
   * points from end to end: the face's, and the gate's with its piers.
   */
  crest?: number[][];
  gateCrest?: number[][];
}

/** The painted wall, in the pieces a renderer fills its faces with. */
export interface Masonry {
  /** One per variant: the stone of a storey, which butts any other left or right and stacks on any. */
  face: HTMLCanvasElement[];
  /** The same, with an archway cut through it and a ring of rough voussoirs round the hole. */
  arch: HTMLCanvasElement[];
  /** What grows into that opening: ivy dangling from the head of it, and grass in the threshold. */
  archIvy: HTMLCanvasElement[];
  archWeed: HTMLCanvasElement[];
  /** The same with a window: the hole, the ivy over it, and what has seeded behind the sill. */
  window: HTMLCanvasElement[];
  winIvy: HTMLCanvasElement[];
  winWeed: HTMLCanvasElement[];
  /** And with a doorway, whose head is a baulk of oak rather than anything cut. */
  door: HTMLCanvasElement[];
  doorIvy: HTMLCanvasElement[];
  doorWeed: HTMLCanvasElement[];
  /** And a cart gate: the same at twice the span, with a corbel under each end of the beam. */
  gate: HTMLCanvasElement[];
  gateIvy: HTMLCanvasElement[];
  gateWeed: HTMLCanvasElement[];
  /** And a bay: the hole and the shelf it stands on. What stands on it is not flat, so it is not here. */
  bay: HTMLCanvasElement[];
  /**
   * The quoins at the left and the right end of a section, over the face, for
   * where a run stops or turns a corner; absent on a masonry that has none.
   */
  quoinL?: HTMLCanvasElement;
  quoinR?: HTMLCanvasElement;
  /** The low wall at a given fraction of a storey, painted once per height that asks for it. */
  low: (k: number) => Low;
  /** The ivy of the top storey, `pad` px taller than a face, the extra above its top edge. */
  spill: HTMLCanvasElement[];
  /** The hedge at the foot of the ground storey, and the damp along its ground line. */
  base: HTMLCanvasElement[];
  foot: HTMLCanvasElement[];
  /** The cap along the top of a wall, and the end grain where a run stops. */
  cap: HTMLCanvasElement;
  ends: HTMLCanvasElement;
  /**
   * The stone the wall's own thickness shows in the reveal of an archway.
   *
   * A painted wall's face is a picture, not the material's flat colour, so
   * the colour the material carries is no guide to what the side of a hole
   * cut through it should be. This is the picture's own shaded stone.
   */
  reveal: [number, number, number];
  /** And the ink it outlines every block with, for the edge of a hole cut in it. */
  line: [number, number, number];
  /** The oak over a doorway, for the leaf hung under it and the soffit it makes. */
  beam: [number, number, number];
  beamLine: [number, number, number];
  /**
   * How much of the ground storey is plinth, in the section's own pixels, or
   * 0 where the masonry has none.
   *
   * A plinth is the one course of a wall that stands out past its face, so it
   * is the one that throws anything on the ground it stands on -- and the
   * renderer draws the ground, not this.
   */
  plinth: number;
  /**
   * What the hour darkens a face of it toward, as three channels.
   *
   * Cobblestone goes toward a warm near-black, which on grey stone reads as
   * shade. On red brick the same multiply takes the red to brown -- a face
   * turned from the light loses light, and on this island it goes cool as it
   * does, toward the colour of the stone the brick is dressed in.
   */
  shade: [number, number, number];
  /** Whether the ivy, hedge and weed pictures below have anything in them to draw. */
  growth: boolean;
  /**
   * The beam ends of the floor over a storey, for the two walls of a house
   * its joists rest on; absent on a masonry that has none.
   *
   * Per variant: the logs as they stand off a face seen from a diagonal
   * (`iso`) and from square on (`square`), each `h` px deep from the head of
   * the storey and painted leaning out to the left -- the face whose picture
   * is laid mirrored takes them mirrored -- and the shade the row throws on
   * a face in the sun, `sh` px deep, falling to the right.
   */
  vigas?: {
    iso: HTMLCanvasElement[];
    square: HTMLCanvasElement[];
    shade: HTMLCanvasElement[];
    h: number;
    sh: number;
  };
  /** Per variant, the coat rolled over the head of a wall nothing stands on; laid over the top of the face. */
  brow?: HTMLCanvasElement[];
  /**
   * Per variant, how far the head of a wall nothing stands on rises over its
   * line along the section, in picture px at evenly spaced points from end to
   * end, nothing at either end; absent where the head runs to a line.
   */
  crest?: number[][];
  /**
   * Where the coat has come away, for the renderer to lay out of doors where
   * the weather takes it: off a corner (painted with the corner on the right),
   * out of the foot (two courses more under it than show, for the foot to
   * cover), under the end of a sill, under the head. Each is laid with its
   * first course `lip` px down, on one of the wall's course lines, which are
   * `ch` apart from `from` down the storey.
   */
  losses?: {
    corner: HTMLCanvasElement[];
    foot: HTMLCanvasElement[];
    sill: HTMLCanvasElement[];
    head: HTMLCanvasElement[];
    lip: number;
    ch: number;
    from: number;
  };
  /**
   * Whether the wall is a coat laid by hand: its head rising and falling, its
   * corners and ends rolled, its insides in the shade of the room.
   */
  soft: boolean;
  /** How much of `shade` the hour lays over a face it lights `k`. */
  shadow: (k: number) => number;
  /** The top of the wall's own tones, where it is drawn flat -- lit, its crown, and the far slope of it -- on a masonry that has them. */
  top?: { lit: [number, number, number]; hi: [number, number, number]; shade: [number, number, number] };
  /**
   * Whether the coat goes round a corner: a face carried on past its end by
   * the thickness of the wall that turns there, rather than both walls
   * stopping short and leaving their two ends showing in the angle.
   */
  wrap: boolean;
  /**
   * Whether a run takes its variants by a hash of where each section is,
   * rather than in turn. In turn, five pictures repeat every twenty metres;
   * on stone the joints hide it, and on a coat of mud it is a stamp.
   */
  scatter: boolean;
  /** The coat's own lit tone, for the rounded arris where it turns a corner. */
  hi: [number, number, number];
  /** Whether its fences are posts and rails, as a fence of wood is, rather than a low wall of it. */
  railed: boolean;
  /**
   * The flat colour to lay under a section before its picture, or none.
   *
   * Two sections' pictures meet on one line, and each one's edge is drawn
   * half-covered, so a hairline of whatever is behind shows between them. On
   * stone or brick the joints swallow it; on a coat of mud, which has no
   * joints, it is a ruled line down the wall every four metres.
   */
  under?: [number, number, number];
  /** A section is `w` by `h`; the ivy reaches `pad` above it, and the cap is `capH` deep. */
  w: number;
  h: number;
  pad: number;
  capH: number;
  /**
   * The road: `paveN` squared pictures of cobbles laid on the ground, in light
   * and shade rather than in colour, to be laid over a tile with `overlay`.
   * Tile (x, y) takes the one at (x mod paveN, y mod paveN) and they butt.
   */
  pave: () => HTMLCanvasElement[];
  paveN: number;
  /** The grey that changes nothing under `overlay`, for anything drawn beside the road. */
  neutral: string;
  /** What each variant carries, for anything that wants to say. */
  tells: string[];
}

/**
 * What a masonry is, as far as the painter is concerned.
 *
 * Everything below paints one wall: the courses, the openings cut in them,
 * the coping, the cap, the end grain, and every green thing that has got into
 * any of it. What tells cobblestone from brickwork is the colour it is laid
 * in, the size of the unit and whether it was laid by eye or to a line -- and
 * that is all that is in here.
 */
interface Tone { lit: string; shade: string; hi: string }
interface Stock {
  pastel: Record<string, string>;
  /** The tones a unit can take. `flat` is the band course, `dress` the stone an opening is cut in. */
  tones: Record<string, Tone>;
  /**
   * How the field is laid.
   *
   * `rubble` is stone off the field, courses of it roughly level and no two
   * pieces alike: the size of every block is drawn, so there is no bond and
   * the seam has to be kept by hand. `bond` is a moulded unit laid to a line
   * in a half lap, which keeps the seam by itself -- every other course has a
   * unit across it, and that unit is drawn at both edges from one seed.
   * `render` is mud brick under a coat of mud: a field of plaster laid on by
   * hand, with the brick showing only where the coat has come away. `frame`
   * is timbercraft: an oak frame pegged together and stood on a footing,
   * its panels filled with daub and limewashed.
   */
  lay: 'rubble' | 'bond' | 'render' | 'frame';
  /** For a bond: courses to a storey, and units across a course. */
  rows: number;
  across: number;
  /** For a bond: a course of headers every this many, or 0 for stretchers only. */
  headers: number;
  /** The two tones the plinth's stones are cut from, the first in a little over a third of them. */
  base: [string, string];
  /** How wide the joint is, in pixels. Brick shows more mortar than rubble does. */
  mortar: number;
  /** Blocks across the band course at the head of a storey. */
  bandN: number;
  /** A plinth of dressed stone at the ground, this many pixels of the storey tall; 0 for none. */
  plinth: number;
  /** What share of a novice's wear this masonry takes: kiln-fired units chip, they do not spall. */
  wear: number;
  /** What the hour's light darkens a face toward; see `Masonry.shade`. */
  shade: [number, number, number];
  /** And how far, for a face the hour lights `k`; see `Masonry.shadow`. */
  shadow: (k: number) => number;
  /**
   * Whether anything grows on it: ivy over the top, a hedge at the foot,
   * moss in the joints, weeds in a threshold. Cobblestone and brick carry
   * the island's planting and nothing else does -- a coat of mud is bare.
   */
  growth: boolean;
  /** The share of units that take each tone, in order; whatever is left takes the field's own. */
  mix: Array<[string, number]>;
  /** The tones that come in pairs rather than singly, because a load of them came in together. */
  pairs: string[];
  /** The tones a field wall carries that a house wall does not, and how often. */
  field: Array<[string, number]>;
}

/* ---- the two masonries -------------------------------------------------- */
/**
 * Cobblestone, sampled off the castle art the island is meant to sit beside.
 */
const RUBBLE_PASTEL: Record<string, string> = {
  grass: '#90cfb1', shade: '#7fbca6', sand: '#f3d192', cream: '#f4ecd5',
  // stone, sampled off the castle: light, mid, and the joints between
  stone: '#cbc0b0', stoneShade: '#aba796', stoneDark: '#a19d8d', joint: '#aeaa9c',
  dark: '#b5b1a0',
  warm: '#ccbea3', warmShade: '#ae9f84',
  /*
   * The stone of an opening, which is stone that was picked over rather
   * than picked up, and the mortar packed in behind it.
   *
   * It is a real step lighter than the field and the mortar a real step
   * darker than the field's, because at the far zoom a ring drawn in the
   * field's own tones is nine pixels of wall doing nothing: the arch goes
   * and a grey slab with a hole in it is left. `reveal` is what the wall's
   * own thickness shows in the way through -- warm, because a face turned
   * from the light loses light and not colour.
   */
  dress: '#ded5c4', dressShade: '#bbb0a0', dressHi: '#efe8dc',
  ringJoint: '#a09a8a', reveal: '#b3ab97',
  /*
   * And the one piece of wood in the whole wall.
   *
   * A window gets a stone lintel and a course of wedges over it because a
   * window is small. A doorway is not, and a man who cannot cut a voussoir
   * is not going to find and dress a stone four feet long either: he lays a
   * baulk of oak across it and builds on top of that. It is the only thing
   * in the picture that is not stone, and that is the point of it.
   */
  beam: '#b0906a', beamShade: '#927757', beamHi: '#c3a681', beamLine: '#6d5840',
  // the lit top bevel of each block: its own lit tone, a step lighter
  stoneHi: '#ddd4c6', warmHi: '#d9cdb3', darkHi: '#bdb9aa', bandHi: '#e3dbcc',
  blush: '#f2c4c0', blushShade: '#dfa39e', blushLine: '#b9797a',
  // moss as a stain: the stone's tones pulled half way to the leaf's
  stain: '#8ca995', stainShade: '#7c9286',
  band: '#d3c9b8', bandShade: '#b5ae9e', line: '#94896c',
  /*
   * Greens. They were sampled off the castle the stone is sampled off, and
   * they have since been turned the same two turns the whole island took:
   * round into the teal, then ten degrees back towards green and darker
   * with it. Sampled off a picture is where they came from and not what
   * they are any more -- a wall stands in this field, not in that one.
   * Their line is still a deeper version of themselves.
   */
  leaf: '#6bac7e', leafShade: '#6d9981', leafDeep: '#5c8273', leafPale: '#7cc38e', leafLine: '#507b5f',
  creamShade: '#dacdb3', creamLine: '#9a8e70',
};

const RUBBLE: Stock = ((P) => ({
  pastel: P,
  tones: {
    '':    { lit: P.stone, shade: P.stoneShade, hi: P.stoneHi },
    warm:  { lit: '#c6bdab', shade: '#a89d8b', hi: '#d3cabb' },
    dress: { lit: P.dress, shade: P.dressShade, hi: P.dressHi },
    brown: { lit: '#c6bba8', shade: '#a89e8c', hi: '#d0c6b5' },
    green: { lit: '#bdc09b', shade: '#a0a37f', hi: '#cccfaa' },
    dark:  { lit: '#bdb9a9', shade: '#a5a192', hi: '#c8c4b5' },
    /*
     * The two the coping needs and the field does not.
     *
     * The wall's four tones sit inside seven steps of luminance of each
     * other, which on a body course is right -- a wall is one heap of stone
     * -- and on a coping is a flat stripe, because there are three times as
     * many stones to the metre and nowhere for the eye to land. `weather` is
     * a stone the rain has had thirty years of, a real thirty-five steps
     * down; `bleach` is one that has been face up at the sun as long.
     */
    weather: { lit: '#a89e8a', shade: '#8e8674', hi: '#bdb29e' },
    bleach:  { lit: '#dcd3c2', shade: '#bdb5a4', hi: '#ece5d7' },
    flat:  { lit: P.band, shade: P.bandShade, hi: P.bandHi },
  },
  lay: 'rubble',
  rows: 4,
  across: 6,
  headers: 0,
  base: ['plinth', 'dress'],
  mortar: 3,
  bandN: 4,
  plinth: 0,
  wear: 1,
  shade: [24, 20, 12],
  shadow: (k) => (1 - k) * 0.85,
  growth: true,
  mix: [['warm', 0.07], ['brown', 0.09], ['green', 0.04], ['dark', 0.1]],
  pairs: ['warm', 'brown'],
  field: [['weather', 0.2], ['bleach', 0.12], ['warm', 0.12], ['brown', 0.1], ['green', 0.1], ['dark', 0.1]],
}))(RUBBLE_PASTEL);

/**
 * And brickwork.
 *
 * The red is the brick itself and everything else on the wall is one cut
 * stone, cool and a step down in value from it: the band at each floor line,
 * the plinth at the ground, the coping of a garden wall, and every jamb,
 * lintel and voussoir of every opening. Two materials, one warm and one cool,
 * and the dressings read at any distance because of it -- which is what a
 * mason is doing when he dresses a brick wall in stone.
 *
 * The greens, the oak of a door head and the road are the cobblestone set's,
 * because ivy is ivy and oak is oak whatever they are growing on.
 */
/** A hex colour with its lightness moved by `dl` points, its hue and saturation kept. */
function lighten(hex: string, dl: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6;
  }
  const L = Math.max(0, Math.min(1, l + dl / 100));
  const q = L < 0.5 ? L * (1 + s) : L + s - L * s, p = 2 * L - q;
  const f = (t: number): number => {
    const u = ((t % 1) + 1) % 1;
    return u < 1 / 6 ? p + (q - p) * 6 * u : u < 1 / 2 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p;
  };
  return '#' + [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

/**
 * The field brick at seven values two points of lightness apart, for the
 * firing to choose between.
 *
 * `f` is a unit laid flush with its neighbours: the shade along its lower
 * edge is three points down and barely there, because a wall of brick with a
 * dark bevel under every one of them is a wall of sweets. `p` is the odd one
 * standing a hair proud of the face, which is the one that earns the shadow.
 */
function values(base: string): Record<string, Tone> {
  const out: Record<string, Tone> = {};
  for (let k = -3; k <= 3; k++) {
    out['f' + k] = { lit: lighten(base, 2 * k), shade: lighten(base, 2 * k - 3), hi: lighten(base, 2 * k + 5) };
    out['p' + k] = { lit: lighten(base, 2 * k), shade: lighten(base, 2 * k - 8), hi: lighten(base, 2 * k + 6) };
  }
  return out;
}

const BRICK_PASTEL: Record<string, string> = {
  ...RUBBLE_PASTEL,
  // the brick itself: the field tone, its shade, and the bevel along its top
  stone: '#c47c6e', stoneShade: '#ad5e52', stoneHi: '#d09080', stoneDark: '#8b514b',
  // a sandier one off the same kiln, and one over-fired grey and gone to mauve
  warm: '#c89e89', warmShade: '#b0816d', warmHi: '#d4b09b',
  dark: '#886364', darkHi: '#9b6f6f',
  // the mortar it is bedded in, a step under the brick, and the ink round every unit
  joint: '#8e6f67', line: '#7e4a44',
  /*
   * The cut stone: the dressings of an opening, and the band at a floor line.
   *
   * A chalky slate, half the saturation the first lavender had. At that
   * chroma the trim was a violet line ruled round every edge of a building
   * -- a brick-textured box outlined in purple -- where cut stone on a brick
   * wall is the quieter of the two materials, not the louder. The band is a
   * step warmer and lighter than the rest, nearer the brick it runs through,
   * so a three-storey face is not a stack of matching stripes.
   */
  dress: '#7f7c8d', dressShade: '#696675', dressHi: '#9491a1',
  band: '#96888f', bandShade: '#7f7178', bandHi: '#a79aa1',
  ringJoint: '#7b5d56', reveal: '#5f5c6a',
  // and brick with moss in it: the field pulled half way to the leaf
  stain: '#a99b7e', stainShade: '#928768',
};

const BRICK: Stock = ((P) => ({
  pastel: P,
  tones: {
    '':      { lit: P.stone, shade: P.stoneShade, hi: P.stoneHi },
    ...values(P.stone),
    /*
     * The units off another part of the kiln, and every one of them inside
     * eight points of the field's own lightness. A swap further off than that
     * is a hole in the wall at the zoom it is played at, and one in three of
     * them was the whole of an art director's first two complaints.
     */
    warm:    { lit: lighten(P.stone, 7), shade: lighten(P.stone, 3), hi: lighten(P.stone, 12) },
    brown:   { lit: '#ad766f', shade: lighten('#ad766f', -4), hi: lighten('#ad766f', 5) },
    burnt:   { lit: '#a77677', shade: lighten('#a77677', -4), hi: lighten('#a77677', 5) },
    weather: { lit: lighten(P.stone, -7), shade: lighten(P.stone, -11), hi: lighten(P.stone, -2) },
    bleach:  { lit: lighten(P.stone, 7), shade: lighten(P.stone, 3), hi: lighten(P.stone, 11) },
    /*
     * And the cut stone. `dark` and `green` are what the openings ask for
     * when they want a darker stone or one with the moss in it, so on a bond
     * they are the dressings' own -- a jamb here takes a brick's tone and it
     * is a brick in the wrong place.
     */
    dress:   { lit: P.dress, shade: P.dressShade, hi: P.dressHi },
    plinth:  { lit: '#6d6b7b', shade: '#5a5865', hi: '#7d7b8e' },
    dark:    { lit: '#6d6b7b', shade: '#5a5865', hi: '#7d7b8e' },
    green:   { lit: '#757f84', shade: '#626b6f', hi: '#879197' },
    flat:    { lit: P.band, shade: P.bandShade, hi: P.bandHi },
    // the top of a course of it, turned up at the sky
    top:     { lit: lighten(P.band, 9), shade: lighten(P.band, 3), hi: lighten(P.band, 14) },
  },
  lay: 'bond',
  /*
   * Ten courses of six, which is a brick of 85 by 30 px -- 66 cm by 23, or
   * about three and a half times life size.
   *
   * Real brick at 128 px to the metre is thirty-one courses of nothing
   * anybody can see, and twelve courses of seven -- the first try at it --
   * was eighty-four outlined units to a section, which at the zoom the game
   * is played at is not a wall but a texture. This is the scale the
   * cobblestone beside it is already drawn at: about three times life, and
   * long and thin enough against those near-square blocks that the two
   * masonries tell apart from across a deed.
   */
  rows: 10,
  across: 6,
  headers: 4,
  base: ['plinth', 'dress'],
  // A brick wall shows more mortar than a rubble one: the joint is most of what
  // says brick, because every unit is the same size and the joints are the drawing.
  mortar: 3,
  bandN: 6,
  /*
   * And a plinth at the ground, six courses of the body tall.
   *
   * It is the one thing the reference has that a wall of one material cannot:
   * a heavy cut-stone base the brick is stood on, which is where the weight
   * of the picture is. It is painted with the ground storey's damp, so it
   * only ever shows out of doors and stops at a doorway, which is where a
   * plinth actually stops.
   */
  plinth: 106,
  /*
   * A sixth of the wear. Rubble is what the field gave up and a frost gets
   * into it; a brick was fired to take that. What it does get is a chipped
   * arris, a crack, and the odd one gone -- not a spalled face, and not a
   * pit or a chip on every other unit, which at a third of rubble's rate was
   * still enough specks across a section to read as grit on the picture.
   */
  wear: 0.17,
  shade: [18, 12, 84],
  shadow: (k) => (1 - k) * 0.85,
  growth: true,
  /*
   * Three units in ten off the field's own tone, not four and a half.
   *
   * At the wider mix the wall came out a mosaic: a pale unit, a sandy one, an
   * olive one and a burnt one all inside two courses, which is a crazy
   * pavement stood on end. What a brick wall actually is is one hue in a
   * dozen values, and the values have to sit close enough that the field
   * reads as a field before any one unit reads as itself.
   */
  // What the end grain rolls, which is the one place a bond still draws on it.
  mix: [['warm', 0.08], ['brown', 0.08], ['burnt', 0.05]],
  pairs: ['warm', 'brown', 'burnt'],
  field: [['weather', 0.3], ['bleach', 0.25], ['warm', 0.25], ['brown', 0.2]],
}))(BRICK_PASTEL);

/**
 * And stone brick: cut stone, dressed square and laid to a line.
 *
 * The heaviest masonry on the island and the tallest it will stand, so the
 * unit is big -- a block a metre long and not quite half a metre high, seven
 * courses to a storey and four blocks to a section, half again the size of a
 * brick at the scale the island is painted at -- and the joint is thin,
 * because a block cut true needs little bedding. It is laid in stretchers
 * only: headers are what a brick wall is bonded with, and a block of stone
 * is bonded through its own depth.
 *
 * The field is a cool, chalky blue-grey, the quarry's own, a dozen values of
 * it with a bed here and there warmer or bluer and the odd block with iron
 * in it. The dressings -- the band at each floor, the quoins, every jamb,
 * lintel, sill and voussoir -- are a pale warm limestone, so a house of it
 * reads as cool stone trimmed in warm, the brick's scheme turned round; and
 * it stands on a plinth of the same blue stone a step darker, where the wet
 * off the ground keeps it.
 */
const STONE_PASTEL: Record<string, string> = {
  ...RUBBLE_PASTEL,
  // the block: its field tone, its shade, the bevel along its top, and its darkest
  stone: '#aeb2c0', stoneShade: '#999dac', stoneHi: '#c2c6d2', stoneDark: '#7c8092',
  // a buff bed out of the same quarry, and a darker blue one
  warm: '#bbb5ad', warmShade: '#a6a098', warmHi: '#cbc6bf',
  dark: '#8e92a2', darkHi: '#9ea2b2',
  // the joint, a step under the block, and the ink round every one
  joint: '#8c8e9c', line: '#6b6d7d',
  // the limestone it is dressed in, and the band of it at a floor line
  dress: '#d8cfbc', dressShade: '#c0b5a1', dressHi: '#e7e0d2',
  band: '#d3c9b5', bandShade: '#b9ae99', bandHi: '#e2dac9',
  ringJoint: '#8c8e9c', reveal: '#7b7e8e',
  // and a block the rain off a band has stained, pulled toward the lichen
  stain: '#b3b5a6', stainShade: '#9ea090',
};

const STONE: Stock = ((P) => ({
  pastel: P,
  tones: {
    '':      { lit: P.stone, shade: P.stoneShade, hi: P.stoneHi },
    ...values(P.stone),
    /*
     * The beds a quarry gives up besides its own, every one inside eight
     * points of the field. The bond asks for them by the kiln's names, and
     * on stone they are the quarry's: `warm` a buff bed, `burnt` a bluer,
     * darker one, and `brown` the odd block with iron in it.
     */
    warm:    { lit: P.warm, shade: P.warmShade, hi: P.warmHi },
    burnt:   { lit: '#9da4b7', shade: lighten('#9da4b7', -5), hi: lighten('#9da4b7', 6) },
    brown:   { lit: '#bdb0a0', shade: lighten('#bdb0a0', -5), hi: lighten('#bdb0a0', 6) },
    weather: { lit: lighten(P.stone, -7), shade: lighten(P.stone, -11), hi: lighten(P.stone, -2) },
    bleach:  { lit: lighten(P.stone, 7), shade: lighten(P.stone, 3), hi: lighten(P.stone, 11) },
    // The limestone, in the two tones its dressings turn about in.
    dress:   { lit: P.dress, shade: P.dressShade, hi: P.dressHi },
    plinth:  { lit: '#cdc2ad', shade: '#b4a894', hi: '#ddd4c3' },
    dark:    { lit: '#cdc2ad', shade: '#b4a894', hi: '#ddd4c3' },
    green:   { lit: P.stain, shade: P.stainShade, hi: lighten(P.stain, 8) },
    // And the footing: the blue stone a step darker, in two beds.
    foot:    { lit: '#8f93a3', shade: '#7b7f8f', hi: '#a1a5b4' },
    footB:   { lit: '#999aa6', shade: '#84858f', hi: '#aaabb6' },
    flat:    { lit: P.band, shade: P.bandShade, hi: P.bandHi },
    top:     { lit: lighten(P.band, 6), shade: lighten(P.band, 1), hi: lighten(P.band, 10) },
  },
  lay: 'bond',
  rows: 7,
  across: 4,
  headers: 0,
  base: ['foot', 'footB'],
  mortar: 2,
  bandN: 4,
  plinth: 96,
  // Cut stone chips at an arris and cracks along a bed; it does not crumble.
  wear: 0.3,
  shade: [30, 28, 74],
  shadow: (k) => (1 - k) * 0.85,
  growth: false,
  mix: [['warm', 0.07], ['burnt', 0.06], ['brown', 0.03]],
  pairs: ['warm', 'burnt'],
  field: [['weather', 0.3], ['bleach', 0.25], ['warm', 0.25], ['burnt', 0.2]],
}))(STONE_PASTEL);

/**
 * And timbercraft: a frame of oak, pegged together, its panels filled with
 * daub and limewashed.
 *
 * The frame is the drawing: posts at every section's ends and one between,
 * a rail across the middle of each storey, a plate along its head and a sole
 * along its foot, and in the panels the braces that keep it square -- which
 * is what makes a frame a house rather than a window. The oak is the dark of
 * an old beam weathered to a violet cast, and the limewash between is a warm
 * chalky white, so the whole reads at any distance as dark lines on a pale
 * ground. It stands on a footing of field stone, because oak at the ground
 * rots.
 */
const FRAME_PASTEL: Record<string, string> = {
  ...RUBBLE_PASTEL,
  // the limewash on the panels: its field, its shade, its light, and where it has worn
  stone: '#e3dccd', stoneShade: '#cfc7b6', stoneHi: '#eee9de', stoneDark: '#b8ad98',
  warm: '#e8dfcb', warmShade: '#d3c9b4', warmHi: '#f1ebdd',
  dark: '#d6ccb9', darkHi: '#e2dac9',
  // the oak of the frame
  dress: '#7c6559', dressShade: '#654f45', dressHi: '#95806f',
  band: '#7c6559', bandShade: '#654f45', bandHi: '#95806f',
  // the daub where the limewash is off it, and the ink every member is drawn in
  joint: '#c8bba2', line: '#4f3d36',
  ringJoint: '#8d877c', reveal: '#6c5a51',
  stain: '#cdc5ad', stainShade: '#b8b098',
  // the footing's field stone
  footing: '#aaa498', footingShade: '#928c81', footingHi: '#bdb8ad',
  // the timber of a door, the same oak
  beam: '#8a7163', beamShade: '#6f5a4e', beamHi: '#a28b7c', beamLine: '#4f3d36',
};

const FRAME: Stock = ((P) => ({
  pastel: P,
  tones: {
    '':      { lit: P.stone, shade: P.stoneShade, hi: P.stoneHi },
    ...values(P.stone),
    warm:    { lit: P.warm, shade: P.warmShade, hi: P.warmHi },
    dark:    { lit: P.dress, shade: P.dressShade, hi: P.dressHi },
    weather: { lit: lighten(P.stone, -6), shade: lighten(P.stone, -10), hi: lighten(P.stone, -1) },
    bleach:  { lit: lighten(P.stone, 4), shade: lighten(P.stone, 0), hi: lighten(P.stone, 7) },
    brown:   { lit: lighten(P.dress, 4), shade: lighten(P.dress, -2), hi: lighten(P.dress, 9) },
    burnt:   { lit: lighten(P.dress, -4), shade: lighten(P.dress, -9), hi: lighten(P.dress, 2) },
    green:   { lit: P.stain, shade: P.stainShade, hi: lighten(P.stain, 6) },
    dress:   { lit: P.dress, shade: P.dressShade, hi: P.dressHi },
    plinth:  { lit: P.footingShade, shade: lighten(P.footingShade, -6), hi: P.footing },
    flat:    { lit: P.band, shade: P.bandShade, hi: P.bandHi },
    top:     { lit: lighten(P.band, 8), shade: lighten(P.band, 3), hi: lighten(P.band, 13) },
    foot:    { lit: P.footing, shade: P.footingShade, hi: P.footingHi },
    footB:   { lit: lighten(P.footing, -5), shade: lighten(P.footingShade, -5), hi: lighten(P.footingHi, -4) },
  },
  lay: 'frame',
  rows: 2,
  across: 2,
  headers: 0,
  base: ['foot', 'footB'],
  mortar: 3,
  bandN: 4,
  // The footing of field stone at the ground, in the ground storey's own pixels.
  plinth: 44,
  // Oak checks along its grain as it dries; it does not chip like stone.
  wear: 0,
  shade: [30, 22, 52],
  shadow: (k) => (1 - k) * 0.85,
  growth: false,
  mix: [['brown', 0.2], ['burnt', 0.2]],
  pairs: [],
  field: [['weather', 0.3], ['bleach', 0.3], ['brown', 0.2], ['burnt', 0.2]],
}))(FRAME_PASTEL);

/**
 * And adobe: mud brick, laid in mud, under a coat of mud.
 *
 * There is nothing cut on it and nothing fired. What there is to look at is
 * the coat -- a warm, chalky plaster laid on by hand in a day's patches --
 * and where the weather has had it: a spall where it came away and the brick
 * shows, a streak where the rain runs off the beam ends, a foot the splash
 * has eaten back. Its timber is its dressing: the beam ends of each floor
 * standing out of the wall in a row, a lintel over every opening, a board
 * for a sill. Everything that is not the wall is weathered wood, in the warm
 * brown the window frames are: silvered to a grey, the beam ends read as a
 * row of rivets driven into the coat.
 */
const ADOBE_PASTEL: Record<string, string> = {
  ...RUBBLE_PASTEL,
  /*
   * The coat: its field tone, its shade, and the arris where it turns into
   * the light. A golden sand, the colour of the ground it was dug out of --
   * a step toward pink and a street of it is stucco, not mud.
   */
  stone: '#d0bb9f', stoneShade: '#bba286', stoneHi: '#e0d1b8', stoneDark: '#a17d5e',
  // a day's patch laid a little paler, and one a little darker
  warm: '#d5c6ae', warmShade: '#c2ae93', warmHi: '#e2d6c1',
  dark: '#c6ac90', darkHi: '#d2bca3',
  /*
   * What the coat is on: mud brick, and the mud it is laid in. The same earth
   * as the coat and barely a step under it -- dark, and outlined, it was a
   * brown thing pinned to the wall; where the coat is gone an adobe wall is
   * the same colour, only jointed, and in the shade of the coat's broken edge.
   */
  mud: '#b4967a', mudShade: '#ab8d72', mudHi: '#bd9f83', joint: '#a68a70',
  // the ink round a bare patch and down a crack, and the eaten foot and its damp
  line: '#8a6851', erode: '#b59a82', damp: '#92735d',
  // an opening has no dressings; what lines it is the same coat, rolled in
  dress: '#d0bb9f', dressShade: '#b99f83', dressHi: '#e4d6be',
  band: '#d0bb9f', bandShade: '#bba286', bandHi: '#e0d1b8',
  ringJoint: '#a0836a', reveal: '#b29576',
  // the beam ends of a floor: the log's side, lit along its top, and the paler
  // end grain the saw left, with the darker rim where the bark was
  viga: '#97785d', vigaShade: '#735a47', vigaHi: '#b39373', vigaRing: '#86684f', vigaEnd: '#bb9c78',
  // and every other piece of timber in it, a lintel or a door, the same
  beam: '#98795f', beamShade: '#7f644e', beamHi: '#b29475', beamLine: '#5e4a3b',
  stain: '#b3a589', stainShade: '#a19372',
};

const ADOBE: Stock = ((P) => ({
  pastel: P,
  tones: {
    '':      { lit: P.stone, shade: P.stoneShade, hi: P.stoneHi },
    warm:    { lit: P.warm, shade: P.warmShade, hi: P.warmHi },
    dark:    { lit: P.dark, shade: lighten(P.dark, -6), hi: P.darkHi },
    // the brick under the coat, at a few values, for where the coat is off
    mud:     { lit: P.mud, shade: P.mudShade, hi: P.mudHi },
    mudpale: { lit: lighten(P.mud, 5), shade: lighten(P.mudShade, 5), hi: lighten(P.mudHi, 4) },
    muddark: { lit: lighten(P.mud, -6), shade: lighten(P.mudShade, -6), hi: lighten(P.mudHi, -5) },
    dress:   { lit: P.dress, shade: P.dressShade, hi: P.dressHi },
    flat:    { lit: P.band, shade: P.bandShade, hi: P.bandHi },
    /*
     * The top of the wall, turned up at the sky: the brightest plane on the
     * house by a clear step, because it is. Six points over the face it was
     * a lid the same colour as the box.
     */
    top:     { lit: '#e6d5b9', shade: '#d9c6a8', hi: '#efe2cb' },
    weather: { lit: lighten(P.stone, -7), shade: lighten(P.stone, -12), hi: lighten(P.stone, -2) },
    bleach:  { lit: lighten(P.stone, 6), shade: lighten(P.stone, 1), hi: lighten(P.stone, 10) },
    brown:   { lit: lighten(P.stone, -4), shade: lighten(P.stone, -9), hi: lighten(P.stone, 1) },
    green:   { lit: P.stain, shade: P.stainShade, hi: lighten(P.stain, 6) },
    plinth:  { lit: P.erode, shade: lighten(P.erode, -8), hi: lighten(P.erode, 5) },
  },
  lay: 'render',
  /*
   * The brick the coat is on, where a spall shows it: sun-dried mud is laid
   * in bigger, thicker units than fired brick, so fewer courses of it to the
   * storey than a brick wall has.
   */
  rows: 12,
  across: 7,
  headers: 0,
  base: ['plinth', 'dress'],
  mortar: 3,
  bandN: 6,
  // The foot the splash has eaten back, in the ground storey's own pixels.
  plinth: 64,
  // A coat of mud is not a heap of blocks: nothing on it chips like a stone.
  wear: 0,
  shade: [52, 40, 74],
  /*
   * Steeper than the stone's, and by a curve rather than a line. A face in
   * full sun is untouched either way; the two faces of a house seen from
   * behind, both turned from the light, came out three points of value
   * apart on a plain coat and the corner between them went, where stone and
   * brick have their joints to hold it. This keeps them eight apart.
   */
  shadow: (k) => 2.3 * Math.max(0, 1 - k) ** 1.6,
  growth: false,
  mix: [['mudpale', 0.2], ['muddark', 0.2]],
  pairs: [],
  field: [['weather', 0.3], ['bleach', 0.3], ['brown', 0.2]],
}))(ADOBE_PASTEL);

let painted: Masonry | undefined;
let bricked: Masonry | undefined;
let dressed: Masonry | undefined;
let rendered: Masonry | undefined;
let framed: Masonry | undefined;

/**
 * Cobblestone: what a novice lays, out of what the field gave up.
 *
 * It takes a moment, and it is done once: every cobblestone wall on the
 * island shares the result, so the cost of it does not go up with the size of
 * a deed.
 */
export function cobble(): Masonry {
  return painted ??= paint(RUBBLE);
}

/**
 * And brickwork: a kiln-fired unit laid to a line, dressed in cut stone.
 *
 * The same picture in every other respect -- the same ivy over it, the same
 * hedge at its foot, the same arch cut through it -- because those do not
 * care what the wall is made of.
 */
export function brickwork(): Masonry {
  return bricked ??= paint(BRICK);
}

/**
 * And stone brick: cut stone laid to a line, dressed in a paler limestone.
 */
export function stonework(): Masonry {
  return dressed ??= paint(STONE);
}

/**
 * And adobe: the same wall again, in mud, with timber for its dressings.
 */
export function adobe(): Masonry {
  return rendered ??= paint(ADOBE);
}

/** And timbercraft: an oak frame on a stone footing, its panels limewashed. */
export function timbercraft(): Masonry {
  return framed ??= paint(FRAME);
}

function paint(S: Stock): Masonry {
  const PASTEL = S.pastel;
  const TONES = S.tones;
  const TW = 512, TH = 384, MORTAR = S.mortar;           // a section: 4 m by 3 m, at 128 px to the metre
  const EDGE = 16;                                       // nothing private nearer the seam than this
  const BAND = 48;                                       // the flat course at the top of every storey
  const COURSES = 4, CH = (TH - BAND) / COURSES;         // and four courses of blocks under it
  /** The courses whose stone straddles the seam, and how far it reaches either side of it: three of
   *  them, reaching unequally, so the joints near the seam stagger the way a running bond does. */
  const STRADDLE: Record<number, [number, number]> = { 0: [-40, 58], 1: [-52, 68], 3: [-70, 46] };
  /** And the tone each straddling stone takes, the same in every variant, so colour reaches the seams too. */
  const STRADDLE_TONE: Record<number, string> = { 0: '', 1: 'brown', 3: 'green' };
  const CAP_H = 64;                                      // the top face's texture, front edge at the bottom

  function rand(seed: number): Rand {
    let s = (seed * 2654435761) >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

  /** A closed curve through the midpoints of a polygon: nothing is straight, nothing repeats. */
  function shape(g: Ctx, pts: Pt[]): void {
    g.beginPath();
    trace(g, pts);
  }
  /** The same curve added to whatever path is open, for a hole cut in a shape. */
  function trace(g: Ctx, pts: Pt[]): void {
    const n = pts.length, m0 = mid(pts[n - 1], pts[0]);
    g.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) { const p = pts[i], m = mid(p, pts[(i + 1) % n]); g.quadraticCurveTo(p[0], p[1], m[0], m[1]); }
    g.closePath();
  }
  /** Points round a squarish oval (p near 1 is round, near 0.4 is a block with soft corners), jittered
   *  in angle and, inwards only, in radius: nothing drawn through them ever leaves the box, so a stone
   *  never reaches across its joint into the seam or the storey above. */
  function blob(cx: number, cy: number, rx: number, ry: number, n: number, R: Rand, p: number, aj: number, rj: number): Pt[] {
    const pts: Pt[] = [], step = Math.PI * 2 / n;
    for (let i = 0; i < n; i++) {
      const a = i * step + (R() - 0.5) * step * aj * 2, rr = 1 - R() * rj * 2;
      const c = Math.cos(a), s = Math.sin(a);
      pts.push([cx + Math.sign(c) * Math.pow(Math.abs(c), p) * rx * rr, cy + Math.sign(s) * Math.pow(Math.abs(s), p) * ry * rr]);
    }
    return pts;
  }
  /** Two flat tones and a line: shade underneath, lit sitting up-left of it, line on top. */
  function solid(g: Ctx, pts: Pt[], lit: string, shade: string, line: string, lw: number, dx: number, dy: number): void {
    shape(g, pts); g.fillStyle = shade; g.fill();
    g.save(); shape(g, pts); g.clip(); g.translate(dx, dy); shape(g, pts); g.fillStyle = lit; g.fill(); g.restore();
    shape(g, pts); g.strokeStyle = line; g.lineWidth = lw; g.lineJoin = 'round'; g.stroke();
  }
  /** The outline of a union of circles, shifted and grown. */
  function unionPath(g: Ctx, cs: Lobe[], ox: number, oy: number, grow: number): void {
    g.beginPath();
    for (const [x, y, r] of cs) { const rr = Math.max(1, r + grow); g.moveTo(x + ox + rr, y + oy); g.arc(x + ox, y + oy, rr, 0, 7); }
  }
  /** A hex colour with an alpha, for the soft edge under a line. */
  const hexA = (hex: string, a: number): string => 'rgba(' + channels(hex).join(',') + ',' + a + ')';
  /** A hex colour as three numbers, for anything outside that wants to light it itself. */
  const channels = (hex: string): [number, number, number] =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  /** What a mass casts on the stones behind it: one flat darkening, down and right. */
  function shadowOf(g: Ctx, cs: Lobe[], ox: number, oy: number): void {
    unionPath(g, cs, ox, oy, 2); g.fillStyle = 'rgba(110,100,80,0.22)'; g.fill();
  }

  /* ---- stone -------------------------------------------------------------- */
  /* The tones a block can take. Most are the pale stone; the rest are sand, a warm brown, a grey-green
   * and the dark grey, all at the reference's low saturation, each with its own lit, shade and bevel. */
  /** Which tone the next block takes, off the stock's own mix. The mossy greens are rare, twice as
   *  common on the two lowest courses, where the wall is damp, and again under a crest, where it
   *  drips; the tones that came in by the load come singly or in pairs, and `run` carries a pair over. */
  function pickTone(R: Rand, course: number, run: Run, underCrest: boolean, drift?: number): string {
    if (run.left > 0) { run.left--; return run.tone; }
    // Half the draw, where a drift is given, so the off tones arrive in the
    // patches a kiln load is laid in rather than one unit at a time.
    let t = drift === undefined ? R() : R() * 0.5 + drift * 0.5;
    const low = course >= COURSES - 2;
    let tone = '';
    for (const [name, share] of S.mix) {
      const p = name === 'green' ? share * (low ? 2.25 : 1) * (underCrest ? 2.5 : 1) : share;
      if (t < p) { tone = name; break; }
      t -= p;
    }
    if (S.pairs.includes(tone) && R() < 0.4) { run.tone = tone; run.left = 1; }
    return tone;
  }
  /** One block: a squarish oval with a wobbly edge, two tones, a line, and a hairline bevel; one in
   *  three has a corner pulled in where it was knocked, and `tilt` turns it a degree or two. */
  /**
   * `ink` is the weight of the outline and `bevel` whether the block gets the
   * lit band along its top -- a coping seen from above is a run of stones a
   * few pixels deep, and a lit rim on every one of them turns the top of the
   * wall into a row of keycaps.
   */
  function stone(g: Ctx, x: number, y: number, w: number, h: number, R: Rand, tone: string, cut: 'laid' | 'sawn' | 'unit' = 'laid', tilt?: number, ink = 2.4, bevel = true): Pt[] {
    const cx = x + w / 2, cy = y + h / 2;
    const laid = cut === 'laid';
    /*
     * A unit off a mould has corners, and at twenty-five pixels deep the
     * fourteen points a block is drawn with put the nearest one twenty-five
     * degrees off each corner -- so the curve through their midpoints cut a
     * quarter of the depth off it and every brick came out a sweet. Twenty
     * points at a squarer profile puts one within nine degrees of the corner,
     * which is a brick with the arris still on it and a hand's wobble along
     * the edges.
     */
    const pn = cut === 'unit' ? 20 : 14;
    const pts = cut === 'unit' ? blob(cx, cy, w / 2, h / 2, pn, R, 0.15, 0.1, 0.018)
      : blob(cx, cy, w / 2, h / 2, pn, R, laid ? 0.28 : 0.26, laid ? 0.28 : 0.16, laid ? 0.05 : 0.025);
    if (laid && R() < 0.3) { const k = Math.floor(R() * pts.length); pts[k] = [pts[k][0] * 0.85 + cx * 0.15, pts[k][1] * 0.85 + cy * 0.15]; }
    if (tilt) { const c = Math.cos(tilt), s = Math.sin(tilt); for (const p of pts) { const px = p[0] - cx, py = p[1] - cy; p[0] = cx + px * c - py * s; p[1] = cy + px * s + py * c; } }
    const T = TONES[tone] || TONES[''];
    // How far the lit face sits up and left of the shade, which is how deep
    // the crescent of shade along the lower right is. A moulded unit is
    // shallow relief: at a tenth of its width it was a dark rim on every
    // brick in the wall, heavier than the joint beside it.
    const [ox, oy] = cut === 'unit' ? [-w * 0.035, -h * 0.1] : [-w * 0.1, -h * 0.14];
    solid(g, pts, T.lit, T.shade, PASTEL.line, ink, ox, oy);
    // the bevel: the block's own outline, shifted a little down and right and clipped to the block,
    // shows as a light band along the top and the upper left, where the light lands
    if (!bevel) return pts;
    g.save(); shape(g, pts); g.clip();
    g.beginPath(); g.rect(x - 4, y - 4, w + 8, h * 0.6); g.clip();
    g.globalAlpha = 0.45;
    g.translate(1.5, 2); shape(g, pts); g.strokeStyle = T.hi; g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke();
    g.restore();
    return pts;
  }
  /* ---- what time does to a wall ------------------------------------------------ */
  /** A corner knocked off: the mortar shows through a bite at one corner, the stone's line round it. */
  function chipCorner(g: Ctx, s: Block, R: Rand): void {
    const cx = s.x + (R() < 0.5 ? 0 : s.w), cy = s.y + (R() < 0.5 ? 0 : s.h), r = Math.min(s.w, s.h) * (0.16 + 0.12 * R());
    const pts = blob(cx, cy, r, r * 0.8, 8, R, 0.85, 0.3, 0.2);
    g.save(); shape(g, s.pts); g.clip();
    shape(g, pts); g.fillStyle = PASTEL.joint; g.fill(); g.strokeStyle = PASTEL.line; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
    g.restore();
  }
  /** A crack: two to three pixels wide with a kink, from one edge part way across the stone, and one
   *  in five right across it; a pale lip along its lower side where the broken edge catches the light. */
  function crack(g: Ctx, s: Block, R: Rand): void {
    const fromLeft = R() < 0.5, through = R() < 0.22, x0 = fromLeft ? s.x + 2 : s.x + s.w - 2, y0 = s.y + s.h * (0.25 + 0.5 * R()), dir = fromLeft ? 1 : -1;
    const len = s.w * (through ? 1 : 0.3 + 0.35 * R()), n = through ? 4 : 3, pts: Pt[] = [[x0, y0]];
    // it wanders, but never doubles back: each step drifts a little from the last, the same way more often than not
    let dy = (R() - 0.5) * s.h * 0.2;
    for (let i = 1; i <= n; i++) { dy = dy * 0.4 + (R() - 0.5) * s.h * (through ? 0.16 : 0.24); pts.push([x0 + dir * len * i / n, pts[i - 1][1] + dy]); }
    g.save(); shape(g, s.pts); g.clip();
    g.strokeStyle = hexA('#ffffff', 0.3); g.lineWidth = 1.2; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1] + 2); for (let i = 1; i <= n; i++) g.lineTo(pts[i][0], pts[i][1] + 2); g.stroke();
    g.strokeStyle = PASTEL.line;
    for (let i = 0; i < n; i++) { g.beginPath(); g.moveTo(pts[i][0], pts[i][1]); g.lineTo(pts[i + 1][0], pts[i + 1][1]); g.lineWidth = through ? 2.4 : 2.8 - i * 0.6; g.stroke(); }
    g.restore();
  }
  /** A flake of the face gone along one edge: a jagged region a shade darker, lined. */
  function spall(g: Ctx, s: Block, R: Rand): void {
    const top = R() < 0.5, x = s.x + s.w * (0.2 + 0.6 * R()), y = top ? s.y : s.y + s.h, rw = s.w * (0.15 + 0.2 * R()), rh = s.h * (0.2 + 0.2 * R());
    const pts = blob(x, y, rw, rh, 9, R, 0.7, 0.45, 0.35);
    g.save(); shape(g, s.pts); g.clip();
    shape(g, pts); g.fillStyle = hexA(PASTEL.line, 0.28); g.fill(); g.strokeStyle = PASTEL.line; g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke();
    g.restore();
  }
  /** Abrasion: a patch of the face worn rough, paler and scratched. */
  function abrade(g: Ctx, s: Block, R: Rand): void {
    const x = s.x + s.w * (0.25 + 0.5 * R()), y = s.y + s.h * (0.3 + 0.4 * R()), rw = s.w * (0.18 + 0.2 * R()), rh = s.h * (0.2 + 0.25 * R());
    const pts = blob(x, y, rw, rh, 12, R, 0.85, 0.5, 0.4);
    g.save(); shape(g, s.pts); g.clip();
    shape(g, pts); g.fillStyle = hexA('#ffffff', 0.22); g.fill();
    g.strokeStyle = hexA(PASTEL.line, 0.4); g.lineWidth = 1; g.lineCap = 'round';
    for (let k = 0; k < 2 + Math.floor(R() * 3); k++) { const sx = x + (R() - 0.5) * rw * 1.6, sy = y + (R() - 0.5) * rh * 1.4, a = (R() - 0.5) * 0.6, l = 4 + 8 * R(); g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l); g.stroke(); }
    g.restore();
  }
  /** Mortar squeezed out of a joint and left there: a lump of the joint tone over the stone's edge. */
  function slop(g: Ctx, s: Block, R: Rand): void {
    const top = R() < 0.5, x = s.x + s.w * (0.15 + 0.7 * R()), y = top ? s.y + 1 : s.y + s.h - 1, rw = 5 + 7 * R(), rh = 3 + 3 * R();
    const pts = blob(x, y, rw, rh, 8, R, 0.9, 0.3, 0.2);
    shape(g, pts); g.fillStyle = PASTEL.joint; g.fill(); g.strokeStyle = hexA(PASTEL.line, 0.6); g.lineWidth = 1.2; g.lineJoin = 'round'; g.stroke();
  }
  /** A stone sunk a little deeper than its neighbours: darker, with shade along its upper and left edges. */
  function recessed(g: Ctx, s: Block, R: Rand): void {
    g.save(); shape(g, s.pts); g.clip();
    g.fillStyle = hexA(PASTEL.line, 0.16); g.fillRect(s.x - 2, s.y - 2, s.w + 4, s.h + 4);
    g.fillStyle = hexA(PASTEL.line, 0.28); g.fillRect(s.x - 2, s.y - 2, s.w + 4, s.h * 0.22); g.fillRect(s.x - 2, s.y - 2, s.w * 0.12, s.h + 4);
    g.restore();
  }
  /** A stone gone: its pocket in the darker mortar, a shadow under its upper edge, and rubble left in it. */
  function missing(g: Ctx, s: Block, R: Rand): void {
    g.save(); shape(g, s.pts); g.clip();
    g.fillStyle = '#9b9789'; g.fillRect(s.x - 2, s.y - 2, s.w + 4, s.h + 4);
    g.fillStyle = hexA(PASTEL.line, 0.28); g.fillRect(s.x - 2, s.y - 2, s.w + 4, s.h * 0.3);
    for (let k = 0; k < 2 + Math.floor(R() * 2); k++) {
      const rw = s.w * (0.18 + 0.15 * R()), rh = s.h * (0.16 + 0.12 * R()), rx = s.x + s.w * (0.15 + 0.6 * R()), ry = s.y + s.h - rh * (0.4 + 0.3 * R());
      solid(g, blob(rx, ry, rw / 2, rh / 2, 8, R, 0.6, 0.3, 0.1), PASTEL.stoneShade, PASTEL.stoneDark, PASTEL.line, 1.8, -rw * 0.1, -rh * 0.15);
    }
    g.restore();
    shape(g, s.pts); g.strokeStyle = PASTEL.line; g.lineWidth = 2.4; g.lineJoin = 'round'; g.stroke();
  }
  /** A pit or two in the face of a stone. */
  function pits(g: Ctx, s: Block, R: Rand): void {
    for (let k = 0; k < 1 + Math.floor(R() * 2); k++) {
      const x = s.x + s.w * (0.15 + 0.7 * R()), y = s.y + s.h * (0.2 + 0.6 * R()), r = 2 + 1.5 * R();
      g.beginPath(); g.ellipse(x, y, r, r * 0.75, 0, 0, 7); g.fillStyle = hexA(PASTEL.line, 0.55); g.fill();
      g.beginPath(); g.ellipse(x + 0.5, y + 1.2, r, r * 0.6, 0, 0, Math.PI); g.strokeStyle = hexA('#ffffff', 0.35); g.lineWidth = 1; g.stroke();
    }
  }
  /** A water stain running down from the joint above a stone, over it and onto the one below. */
  function stain(g: Ctx, s: Block, R: Rand): void {
    const w = 6 + 10 * R(), x = s.x + s.w * (0.2 + 0.6 * R()), y0 = s.y - MORTAR, len = s.h * (0.7 + 0.7 * R());
    g.save(); g.beginPath(); g.rect(EDGE, 0, TW - 2 * EDGE, TH - 3); g.clip();
    for (const [ww, a] of [[w, 0.07], [w * 0.5, 0.06]]) {
      g.beginPath(); g.moveTo(x - ww / 2, y0); g.lineTo(x + ww / 2, y0); g.lineTo(x + ww * 0.3, y0 + len); g.lineTo(x - ww * 0.3, y0 + len); g.closePath();
      g.fillStyle = hexA('#5f5644', a); g.fill();
    }
    g.restore();
  }
  /** Wear, on the private stones only, so the seams and the storey line keep their contract. Masonry is
   *  a novice's masonry, and it shows: a chipped corner on one block in five, a crack on one in six, a
   *  flaked edge on one in fourteen, a block sunk deeper on one in twenty and gone on one in fifty;
   *  and over those, an abraded patch on one in five, pits on one in four, mortar squeezed out of one
   *  joint in seven, a water stain under one in seven. */
  function weather(g: Ctx, own: Block[], R: Rand): void {
    const k = S.wear;
    for (const s of own) {
      const t = R();
      if (t < 0.18 * k) chipCorner(g, s, R);
      else if (t < 0.34 * k) crack(g, s, R);
      else if (t < 0.41 * k) spall(g, s, R);
      else if (t < 0.46 * k) recessed(g, s, R);
      else if (t < 0.48 * k) missing(g, s, R);
      if (R() < 0.22 * k) abrade(g, s, R);
      if (R() < 0.25 * k) pits(g, s, R);
      if (R() < 0.15 * k) slop(g, s, R);
      if (R() < 0.14 * k && s.course < COURSES - 1) stain(g, s, R);
    }
  }
  /** Four flat slabs across a row, set half a slab over so the seam falls in the middle of one; that
   *  slab is drawn twice, half either side, from its own seed, so it is the same in every variant. */
  function slabs(g: Ctx, y: number, h: number, R: Rand, tone = 'flat'): void {
    const n = S.bandN, w = TW / n;
    // A slab of a rubble wall was picked over; a band course on brickwork was
    // cut to a line, and at this size a rounded corner on it reads as a sweet.
    const cut: 'sawn' | 'unit' = S.lay === 'bond' ? 'unit' : 'sawn';
    if (S.lay === 'bond') {
      // Cut to what the quarry gave, a quarter either way, so the band is a
      // course of stones rather than one stone printed six times.
      const ws: number[] = []; let sum = 0;
      for (let k = 0; k < n - 1; k++) { const v = 0.75 + R() * 0.5; ws.push(v); sum += v; }
      let x = w / 2;
      for (const v of ws) {
        const bw = (v / sum) * (TW - w);
        // And no two the same depth either: the arris along the top is the
        // line the course was laid to, and the bottom is where each stone
        // happened to stop, three or four pixels up or down.
        const bh = h - MORTAR - R() * 5;
        const t = R();
        const pts = stone(g, x + MORTAR, y + MORTAR / 2, bw - 2 * MORTAR, bh, R, tone === 'flat' && t < 0.25 ? 'plinth' : tone, cut);
        if (R() < 0.22) chipCorner(g, { x: x + MORTAR, y: y + MORTAR / 2, w: bw - 2 * MORTAR, h: bh, course: 0, pts }, R);
        x += bw;
      }
    } else for (let k = 0; k < n - 1; k++) stone(g, k * w + w / 2 + MORTAR, y + MORTAR / 2, w - 2 * MORTAR, h - MORTAR, R, tone, cut);
    for (const x of [TW - w / 2, -w / 2]) stone(g, x + MORTAR, y + MORTAR / 2, w - 2 * MORTAR, h - MORTAR, rand(98), tone, cut);
  }

  /* ---- a coat of mud ------------------------------------------------------ */
  /** A centre for something `r` across that keeps clear of the section's seams. */
  const inField = (r: number, R: Rand): number => EDGE + 14 + r + R() * (TW - 2 * (EDGE + 14 + r));
  /** A polygon added to the path that is open, shifted by (dx, dy): a torn edge has corners, not curves. */
  function poly(g: Ctx, pts: Pt[], dx = 0, dy = 0): void {
    g.moveTo(pts[0][0] + dx, pts[0][1] + dy);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0] + dx, pts[i][1] + dy);
    g.closePath();
  }

  /**
   * The field of a render: a coat of mud laid on by hand over mud brick.
   *
   * Nothing on it is a unit, so what there is to paint is the coat and what
   * the weather has done to it. The coat goes on a trowel's sweep at a time
   * and a day's mix never dries quite the tone of the last, so the field
   * carries a pass or two a step either side of the coat's own tone: wide,
   * flat, crisp at the edge, and never so far off the coat that the eye
   * lands on one before it lands on a beam end or an opening. Then a crack
   * from the drying, on one section in two.
   *
   * All of it keeps well clear of the section's seams, so the coat is its own
   * plain tone at both edges of every section and any section butts any
   * other. Nothing that depends on where the section stands is in it: the
   * beam ends, which only the two walls a floor's joists rest on carry, and
   * the places the coat has come away, which the weather takes at corners,
   * at the foot, under a sill and under the head, and never inside a room,
   * are laid over it by the renderer.
   *
   * `open` is a section an opening will be cut in, which is left to its own
   * cracks off the corners of the opening.
   */
  function paintRender(g: Ctx, R: Rand, open: boolean): Block[] {
    g.fillStyle = PASTEL.stone;
    g.fillRect(0, 0, TW, TH);
    passes(g, R, BAND + 22, TH - S.plinth - 22);
    if (!open && R() < 0.5) fissure(g, inField(20, R), BAND + 40 + R() * 110, 40 + R() * 60, R);
    return [];
  }

  /**
   * A trowel's passes: one to three wide swathes a step either side of the
   * coat, each a shallow arc, fat in the middle and thin at its ends, the
   * edge it was pushed along ragged and the other smooth. Wider than they
   * are tall, because an arm sweeps sideways.
   */
  function passes(g: Ctx, R: Rand, top: number, bottom: number): void {
    const tones = [lighten(PASTEL.stone, 2.3), lighten(PASTEL.stone, -2.1), lighten(PASTEL.stone, 1.1)];
    const n = 1 + Math.floor(R() * 2.6);
    for (let i = 0; i < n; i++) {
      const w = 150 + R() * 170, h = Math.min(30 + R() * 34, (bottom - top) * 0.6);
      const x0 = EDGE + 20 + R() * Math.max(1, TW - 2 * (EDGE + 20) - w);
      const y0 = top + R() * Math.max(1, bottom - top - h);
      const bow = (R() - 0.5) * h * 1.1, tilt = (R() - 0.5) * h * 0.9;
      const upper: Pt[] = [], lower: Pt[] = [];
      const steps = 14;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps, x = x0 + w * t;
        const cy = y0 + h / 2 + Math.sin(Math.PI * t) * bow + (t - 0.5) * tilt;
        const th = (h / 2) * Math.pow(Math.sin(Math.PI * t), 0.55);
        upper.push([x, cy - th + (R() - 0.5) * 6]);
        lower.push([x, cy + th * (0.92 + R() * 0.08)]);
      }
      shape(g, [...upper, ...lower.reverse()]);
      g.fillStyle = tones[i % tones.length];
      g.fill();
    }
  }

  /* ---- where the coat has come away --------------------------------------- */
  /** The height of a course of the brick under the coat. */
  const MUD_CH = (TH - BAND) / S.rows;
  /** How far over a loss's top edge its picture reaches, for the lit arris of the coat that stands over it. */
  const LOSS_LIP = 6;
  /**
   * A loss: the coat come away and the brick showing, as a picture for the
   * renderer to lay where the weather would have taken it -- at a corner, out
   * of the foot, under a sill, under the head of the wall -- and never inside
   * a room. Painted into the field of the sections, two losses in five
   * sections were the same two stamps wherever those sections fell, inside
   * and out, and the sections could be counted by them.
   *
   * It is laid out course by course from the top, `runs[i]` the left and
   * right of course `i`, because a coat lets go along the bed joints of the
   * brick under it: what is left is a stair, ragged where it tore. Its
   * courses start on the picture's own line LOSS_LIP down, so laid on one of
   * the wall's course lines they run level with the wall's. It is lit as a
   * hole is lit, from above: the arris of the coat over it catches the light,
   * and its broken edge throws a band of shade down onto the brick.
   */
  function lossPicture(runs: Array<[number, number]>, R: Rand): HTMLCanvasElement {
    const w = Math.max(...runs.map(([, b]) => b)) + 4, h = runs.length * MUD_CH;
    const c = cnv(Math.ceil(w), Math.ceil(h + LOSS_LIP + 2)), g = ctxOf(c);
    g.translate(0, LOSS_LIP);
    const hole = stair(runs, R);
    g.save();
    g.beginPath(); g.rect(-4, -LOSS_LIP, w + 8, h + LOSS_LIP + 6); poly(g, hole); g.clip('evenodd');
    g.beginPath(); poly(g, hole, 0, -2.5); g.fillStyle = hexA(PASTEL.stoneHi, 0.8); g.fill();
    g.restore();
    g.save();
    g.beginPath(); poly(g, hole); g.clip();
    mudBrick(g, -4, -4, w + 4, h + 4, R, 0);
    g.beginPath(); g.rect(-4, -4, w + 8, h + 8); poly(g, hole, 0, 7); g.clip('evenodd');
    g.fillStyle = 'rgba(58, 44, 72, 0.26)'; g.fillRect(-4, -4, w + 8, h + 8);
    g.restore();
    return c;
  }
  /**
   * The outline of a stack of runs: across the top of the first, down the
   * right ends course by course, back along the bottom of the last and up
   * the left ends -- each corner a hand off true and each riser leaning,
   * and the long edges torn rather than ruled.
   */
  function stair(runs: Array<[number, number]>, R: Rand): Pt[] {
    const j = (k: number): number => (R() - 0.5) * k;
    const edge = (a: number, b: number, y: number): Pt[] => {
      const out: Pt[] = [];
      const n = Math.max(1, Math.floor(Math.abs(b - a) / 22));
      for (let i = 1; i < n; i++) out.push([a + ((b - a) * i) / n + j(6), y + j(3.5)]);
      return out;
    };
    const pts: Pt[] = [];
    const [a0, b0] = runs[0];
    pts.push([a0 + j(3), j(2)], ...edge(a0, b0, 0), [b0 + j(3), j(2)]);
    for (let i = 0; i < runs.length; i++) {
      const y1 = (i + 1) * MUD_CH, b = runs[i][1], nb = i + 1 < runs.length ? runs[i + 1][1] : null;
      pts.push([b + j(5), y1 + j(2)]);
      if (nb !== null) pts.push([nb + j(5), y1 + j(2)]);
    }
    const [al, bl] = runs[runs.length - 1], yb = runs.length * MUD_CH;
    pts.push(...edge(bl, al, yb));
    for (let i = runs.length - 1; i >= 0; i--) {
      const y0 = i * MUD_CH, a = runs[i][0], pa = i > 0 ? runs[i - 1][0] : null;
      pts.push([a + j(5), y0 + MUD_CH + j(2)]);
      if (pa !== null) pts.push([a + j(5), y0 + j(2)]);
    }
    return pts;
  }
  /**
   * The mud brick where the coat is off: courses of it on the storey's own
   * lines in a half lap, each brick a flat tone a step either side of the
   * brick's own and the joint a step under that -- and no more, because the
   * brick is the same earth as the coat and the joints are mud too.
   */
  function mudBrick(g: Ctx, x0: number, y0: number, x1: number, y1: number, R: Rand, from = BAND): void {
    const ch = MUD_CH, uw = TW / S.across;
    g.fillStyle = PASTEL.joint;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    const tones = [PASTEL.mud, PASTEL.mudHi, PASTEL.mudShade, PASTEL.mud];
    for (let i = Math.floor((y0 - from) / ch) - 1; i <= Math.ceil((y1 - from) / ch); i++) {
      const cy0 = from + i * ch;
      const lap = (((i % 2) + 2) % 2) * 0.5;
      for (let k = Math.floor(x0 / uw) - 1; k <= Math.ceil(x1 / uw); k++) {
        const x = (k + lap) * uw;
        if (x > x1 || x + uw < x0) continue;
        const pts = blob(x + uw / 2, cy0 + ch / 2 + (R() - 0.5) * 1.5, uw / 2 - MORTAR / 2 - 0.5, ch / 2 - MORTAR / 2 - 0.5, 14, R, 0.3, 0.22, 0.03);
        shape(g, pts);
        g.fillStyle = tones[Math.floor(R() * tones.length)];
        g.fill();
      }
    }
  }

  /** A crack from the drying: a thin line that wanders down, and a short fork off it. */
  function fissure(g: Ctx, x: number, y: number, len: number, R: Rand, dir = 1): void {
    g.strokeStyle = hexA(PASTEL.line, 0.6);
    g.lineWidth = 1.3;
    g.lineCap = 'round'; g.lineJoin = 'round';
    const steps = 5 + Math.floor(R() * 3);
    let cx = x, cy = y;
    g.beginPath(); g.moveTo(cx, cy);
    let fork: Pt | null = null;
    for (let i = 0; i < steps; i++) {
      cx += (R() - 0.5) * 11 + (dir < 0 ? 2.5 * Math.sign(x - TW / 2) : 0); cy += (dir * len) / steps;
      g.lineTo(cx, cy);
      if (i === 2 && R() < 0.65) fork = [cx, cy];
    }
    g.stroke();
    if (fork) {
      g.beginPath(); g.moveTo(fork[0], fork[1]);
      const d = R() < 0.5 ? -1 : 1;
      g.lineTo(fork[0] + d * (8 + R() * 8), fork[1] + dir * (8 + R() * 6));
      g.lineTo(fork[0] + d * (14 + R() * 10), fork[1] + dir * (18 + R() * 8));
      g.lineWidth = 1; g.stroke();
    }
  }

  /* ---- the beam ends ------------------------------------------------------ */
  /**
   * A beam end: where the log goes into the wall, how thick it is, how far it
   * stands out in tiles and how much it droops doing it, how long a streak
   * the rain has left under it, and whether the drip off it has taken the
   * coat at the foot of the streak.
   */
  interface Viga { x: number; y: number; r: number; d: number; droop: number; streak: number; drip: boolean; seed: number }
  /** How deep, from the head of a storey down, the beam ends and their streaks are painted; and their shade. */
  const VIGA_H = 300, VIGA_SH = 100;
  /**
   * Where a variant's beams go into the wall.
   *
   * Four to a section at one pitch, a metre apart -- the span the boards
   * laid across them will take -- and half a metre in from each seam, so a
   * floor runs along a street at that pitch through every join. Shifted
   * about or left out, a gap across a join was two metres and the sections
   * could be counted by it. The hand shows in the logs instead of in where
   * they are: each a little thicker or thinner than the next, standing out
   * further or less and drooping a little as it does, one in seven sawn off
   * nearly flush.
   */
  function vigaRow(v: Variant): Viga[] {
    const R = rand(v.seed * 613 + 29);
    const out: Viga[] = [];
    for (let k = 0; k < 4; k++) {
      const x = (k + 0.5) * (TW / 4) + (R() - 0.5) * 6;
      const r = 16 * (0.87 + R() * 0.26);
      const d = R() < 0.14 ? 0.015 + R() * 0.012 : 0.04 + R() * 0.035;
      const droop = 0.8 + R() * 0.45;
      const streak = R() < 0.5 ? 70 + R() * 160 : 0;
      out.push({ x, y: 24, r, d, droop, streak, drip: !!streak && R() < 0.3, seed: v.seed * 17 + k });
    }
    return out;
  }
  /**
   * The row's logs, and the rain off them, for a face whose outward direction
   * runs (ax, ay) picture pixels to a tile. On a face seen from a diagonal
   * that is mostly sideways: the end of a log a foot out of the wall stands
   * well to one side of where it goes in, and not far below it.
   */
  function vigaLogs(row: Viga[], ax: number, ay: number, drips: HTMLCanvasElement[]): HTMLCanvasElement {
    const c = cnv(TW, VIGA_H), g = ctxOf(c);
    // The rain down the coat under each, darker where it runs and fading as
    // it dries, with an edge that wanders because water does not run down a
    // wall in a ruled line.
    for (const s of row) {
      if (!s.streak) continue;
      const R = rand(s.seed * 7 + 1);
      const w = 8 + R() * 10, y0 = s.y + s.r * 0.5, len = s.streak;
      const gr = g.createLinearGradient(0, y0, 0, y0 + len);
      gr.addColorStop(0, hexA(PASTEL.stoneDark, 0.17 + R() * 0.07));
      gr.addColorStop(1, hexA(PASTEL.stoneDark, 0));
      g.fillStyle = gr;
      g.beginPath();
      const steps = 8;
      for (let i = 0; i <= steps; i++) { const t = i / steps; g.lineTo(s.x - w / 2 - t * 3 + (R() - 0.5) * 3, y0 + len * t); }
      for (let i = steps; i >= 0; i--) { const t = i / steps; g.lineTo(s.x + w / 2 + t * 2 + (R() - 0.5) * 3, y0 + len * t); }
      g.closePath();
      g.fill();
      // Where the drip has fallen on the same place for years, the coat has
      // gone at the foot of the streak -- laid on a course line, as every
      // loss is, so its brick runs with the wall's.
      if (s.drip) {
        const p = drips[s.seed % drips.length];
        const line = BAND + Math.round((y0 + len * 0.8 - BAND) / MUD_CH) * MUD_CH;
        g.drawImage(p, Math.round(s.x - p.width / 2), line - LOSS_LIP);
      }
    }
    for (const s of row) log(g, s, ax * s.d, ay * s.d * s.droop);
    return c;
  }
  /**
   * One log: the mud packed round it where it goes into the wall, its side
   * from there to its end -- lit along the top and dark along the underside,
   * as anything round is under a sky -- and the end itself, the end grain
   * paler than the side, with the darker rim where the bark was, a ring or
   * two, and the check every log end opens once it has dried. (ox, oy) is
   * where the end stands in the picture from where the log goes in.
   */
  function log(g: Ctx, s: Viga, ox: number, oy: number): void {
    const R = rand(s.seed);
    const ex = s.x, ey = s.y, fx = ex + ox, fy = ey + oy, r = s.r;
    g.beginPath(); g.ellipse(ex, ey, r + 3.5, r + 3, 0, 0, Math.PI * 2);
    g.fillStyle = hexA(PASTEL.stoneShade, 0.5); g.fill();
    g.lineCap = 'round';
    for (const [w, lift, col] of [[2 * r, 0, PASTEL.vigaShade], [1.48 * r, r * 0.2, PASTEL.viga], [0.6 * r, r * 0.56, PASTEL.vigaHi]] as Array<[number, number, string]>) {
      g.beginPath(); g.moveTo(ex, ey - lift); g.lineTo(fx, fy - lift);
      g.strokeStyle = col; g.lineWidth = w; g.stroke();
    }
    g.lineCap = 'butt';
    const tilt = (R() - 0.5) * 0.3, ry = r * 0.97, rim = 2.4;
    g.beginPath(); g.ellipse(fx, fy, r, ry, tilt, 0, Math.PI * 2);
    g.fillStyle = PASTEL.vigaRing; g.fill();
    g.save();
    g.beginPath(); g.ellipse(fx, fy, r - rim, ry - rim, tilt, 0, Math.PI * 2); g.clip();
    g.fillStyle = PASTEL.vigaEnd; g.fillRect(fx - r, fy - r, 2 * r, 2 * r);
    // Its lower edge, turned from the sky.
    g.beginPath(); g.rect(fx - r, fy - r, 2 * r, 2 * r); g.ellipse(fx, fy - 3.5, r - rim, ry - rim, tilt, 0, Math.PI * 2);
    g.fillStyle = 'rgba(70, 52, 62, 0.22)'; g.fill('evenodd');
    g.strokeStyle = hexA(PASTEL.vigaRing, 0.45); g.lineWidth = 1;
    for (const f of [0.55, 0.28]) { g.beginPath(); g.ellipse(fx - 0.5, fy - 0.5, r * f, ry * f, R() * 3, 0, Math.PI * 2); g.stroke(); }
    const a = R() * Math.PI * 2;
    g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx + Math.cos(a) * r * 0.8, fy + Math.sin(a) * ry * 0.8);
    g.strokeStyle = hexA(PASTEL.vigaRing, 0.75); g.lineWidth = 1.3; g.stroke();
    g.restore();
  }
  /**
   * The shade the row throws on a face that has the sun on it: from where
   * each log goes in, down and to the right, as long as the log stands out.
   * A face already in shade takes none of it, which is the renderer's to say.
   */
  function vigaShade(row: Viga[]): HTMLCanvasElement {
    const c = cnv(TW, VIGA_SH), g = ctxOf(c);
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(46, 34, 62, 0.3)';
    for (const s of row) {
      g.beginPath(); g.moveTo(s.x + 2, s.y + 3); g.lineTo(s.x + 2 + 256 * s.d, s.y + 3 + 460 * s.d);
      g.lineWidth = 1.84 * s.r; g.stroke();
    }
    g.lineCap = 'butt';
    return c;
  }

  /* ---- timbercraft --------------------------------------------------------- */
  /** How thick the frame's members are -- a post, a rail, a brace -- and the plate at a storey's head and the sole at its foot. */
  const POST = 24, RAIL = 20, BRACE = 17, PLATE = 22, SOLE = 18;
  /** Where the rail across the middle of a storey runs: the same in every section, so it meets the next. */
  const MID = Math.round(TH * 0.5);
  /**
   * One member of the frame: a squared oak baulk, a hand off true along its
   * edges, lit along its top and dark along its underside if it runs across,
   * its grain a line or two down its length, and the ink round it every
   * member is drawn in. `across` is a member that runs over a section's
   * seams, which is laid true, so its edges arrive at a seam where the next
   * section's leave it.
   */
  function member(g: Ctx, x0: number, y0: number, x1: number, y1: number, R: Rand, across = false): void {
    const j = (): number => (across ? 0 : (R() - 0.5) * 2.4);
    const pts: Pt[] = [[x0 + j(), y0 + j()], [x1 + j(), y0 + j()], [x1 + j(), y1 + j()], [x0 + j(), y1 + j()]];
    const w = x1 - x0, h = y1 - y0, flat = w > h;
    const T = TONES.dress;
    g.save();
    g.beginPath(); poly(g, pts); g.fillStyle = T.lit; g.fill(); g.clip();
    if (flat) {
      g.fillStyle = hexA(T.hi, 0.85); g.fillRect(x0 - 4, y0 - 3, w + 8, Math.min(5, h * 0.28) + 3);
      g.fillStyle = T.shade; g.fillRect(x0 - 4, y1 - Math.min(5, h * 0.28), w + 8, 8);
    }
    g.strokeStyle = hexA(T.shade, 0.75); g.lineWidth = 1;
    const GR = across ? rand(Math.round(y0 * 7 + x1)) : R;
    for (let i = 0; i < 2; i++) {
      g.beginPath();
      if (flat) {
        const y = y0 + h * (0.35 + 0.3 * i) + (GR() - 0.5) * 2, a = GR() * 6;
        for (let x = x0; x <= x1; x += 12) g.lineTo(x, y + Math.sin(x * 0.03 + a) * 1.2);
      } else {
        const x = x0 + w * (0.3 + 0.4 * i) + (GR() - 0.5) * 2, a = GR() * 6;
        for (let y = y0; y <= y1; y += 12) g.lineTo(x + Math.sin(y * 0.03 + a) * 1.2, y);
      }
      g.stroke();
    }
    g.restore();
    g.beginPath(); poly(g, pts);
    g.strokeStyle = hexA(PASTEL.line, 0.8); g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke();
  }
  /** A brace: the same oak on the slant between two points, its ends cut by the members laid over them. */
  function brace(g: Ctx, ax: number, ay: number, bx: number, by: number, R: Rand): void {
    const l = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / l * (BRACE / 2), ny = (bx - ax) / l * (BRACE / 2);
    const j = (): number => (R() - 0.5) * 2;
    const pts: Pt[] = [[ax + nx + j(), ay + ny + j()], [bx + nx + j(), by + ny + j()], [bx - nx + j(), by - ny + j()], [ax - nx + j(), ay - ny + j()]];
    const T = TONES.dress;
    g.beginPath(); poly(g, pts); g.fillStyle = T.lit; g.fill();
    g.save(); g.clip();
    // its upper edge takes the light and its lower is in its own shade
    const up = ny < 0 ? 1 : -1;
    g.beginPath(); poly(g, pts.map(([x, y]): Pt => [x + nx * up * 0.7, y + ny * up * 0.7]));
    g.fillStyle = hexA(T.shade, 0.9); g.fill();
    g.restore();
    g.beginPath(); poly(g, pts);
    g.strokeStyle = hexA(PASTEL.line, 0.8); g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke();
  }
  /** A peg through a joint: a dark round end with a pale rim on its upper side. */
  function peg(g: Ctx, x: number, y: number): void {
    g.beginPath(); g.arc(x, y, 2.3, 0, Math.PI * 2); g.fillStyle = hexA(PASTEL.line, 0.75); g.fill();
    g.beginPath(); g.arc(x, y - 0.8, 1.2, Math.PI, Math.PI * 2); g.strokeStyle = hexA(TONES.dress.hi, 0.7); g.lineWidth = 0.8; g.stroke();
  }
  /**
   * The field of a frame.
   *
   * The panels first, limewash over daub: a warm chalky white laid a day at a
   * time, so a pass or two of it a step off the rest. Then what keeps the
   * frame square, which changes from section to section as a carpenter's
   * does -- braces rising from the posts' feet to the rail, or from the rail
   * to the plate, a cross in one panel, or close studs -- and then the
   * members over their ends: the rail across the middle, the posts, the
   * plate along the head and the sole along the foot. The posts at the two
   * ends of a section are one post shared with the next section, laid from
   * one seed, and the plate, the rail and the sole run straight through
   * every seam.
   *
   * `open` is a section an opening will be cut in: it keeps its middle clear
   * for the opening's own posts and rails.
   */
  function paintFrame(g: Ctx, R: Rand, open: boolean): Block[] {
    g.fillStyle = PASTEL.stone; g.fillRect(0, 0, TW, TH);
    passes(g, R, PLATE + 8, TH - SOLE - 8);
    const e = POST / 2, xm = TW / 2 + (R() - 0.5) * 70;
    if (!open) {
      const lo = [MID + RAIL, TH - SOLE], hi = [PLATE, MID];
      const pattern = Math.floor(R() * 4);
      if (pattern === 0) {
        // braces up from the feet of the outer posts to the rail beside the middle one
        brace(g, e, lo[1], xm - e - 30, lo[0], R);
        brace(g, TW - e, lo[1], xm + e + 30, lo[0], R);
      } else if (pattern === 1) {
        // down braces from the plate at the middle post to the rail at the outer ones
        brace(g, xm - e, hi[0], e + 34, hi[1], R);
        brace(g, xm + e, hi[0], TW - e - 34, hi[1], R);
      } else if (pattern === 2) {
        // a cross in one lower panel, and a single brace in the other's upper
        const [a, b] = R() < 0.5 ? [e, xm - e] : [xm + e, TW - e];
        brace(g, a, lo[0], b, lo[1], R);
        brace(g, a, lo[1], b, lo[0], R);
        const [c, d] = a === e ? [xm + e, TW - e] : [e, xm - e];
        brace(g, c, hi[1], d, hi[0], R);
      } else {
        // close studs, two to a panel, and nothing on the slant
        for (const [a, b] of [[e, xm - e], [xm + e, TW - e]]) {
          for (const f of [1 / 3, 2 / 3]) {
            const x = a + (b - a) * f;
            member(g, x - POST * 0.35, PLATE, x + POST * 0.35, TH - SOLE, R);
          }
        }
      }
    }
    member(g, -6, MID, TW + 6, MID + RAIL, rand(1741), true);
    if (!open) member(g, xm - e, PLATE - 2, xm + e, TH - SOLE + 2, R);
    member(g, -e, 0, e, TH, rand(1753));
    member(g, TW - e, 0, TW + e, TH, rand(1753));
    member(g, -6, 0, TW + 6, PLATE, rand(1747), true);
    member(g, -6, TH - SOLE, TW + 6, TH, rand(1733), true);
    // Pegs through the joints of the rail with the posts.
    for (const x of open ? [e, TW - e] : [e, xm, TW - e]) {
      peg(g, x + (x < TW / 2 ? 5 : -5), MID + RAIL / 2);
      peg(g, x + (x < TW / 2 ? 5 : -5), PLATE / 2 + 2);
    }
    return [];
  }
  /**
   * A window in a frame: a post either side of it from the plate to the
   * sole, a rail over it and a sill rail under it, the sill standing out a
   * little to throw the rain clear -- the opening is framed, not cut.
   */
  function frameSurround(g: Ctx, R: Rand, x0: number, x1: number, head: number, sill: number, shelf: number): void {
    member(g, x0 - POST, PLATE - 2, x0, TH - SOLE + 2, R);
    member(g, x1, PLATE - 2, x1 + POST, TH - SOLE + 2, R);
    member(g, x0 - POST, head - RAIL, x1 + POST, head, R);
    member(g, x0 - POST - 8 - shelf, sill, x1 + POST + 8 + shelf, sill + RAIL - 2 + shelf * 0.6, R);
    shadeUnder(g, x0 - POST - 8 - shelf, x1 + POST + 8 + shelf, sill + RAIL - 2 + shelf * 0.6, 9);
    peg(g, x0 - POST / 2, head - RAIL / 2); peg(g, x1 + POST / 2, head - RAIL / 2);
  }
  /**
   * A doorway in it: posts either side from the plate to the ground and a
   * head over the way through; a gate's head is the deeper, and stands on a
   * knee brace at each post.
   */
  function frameDoorway(g: Ctx, R: Rand, x0: number, x1: number, head: number, deep: number, reach: number): void {
    member(g, x0 - POST, PLATE - 2, x0, TH, R);
    member(g, x1, PLATE - 2, x1 + POST, TH, R);
    if (reach) {
      brace(g, x0 + 2, head + 30, x0 + 34, head - 2, R);
      brace(g, x1 - 2, head + 30, x1 - 34, head - 2, R);
    }
    member(g, x0 - POST, head - deep + 4, x1 + POST, head, R);
    peg(g, x0 - POST / 2, head - deep / 2); peg(g, x1 + POST / 2, head - deep / 2);
  }
  /** An archway in it: the posts, and the head bent round the curve as one piece of oak. */
  function frameArch(g: Ctx, R: Rand): void {
    member(g, A_CX - A_R - POST, PLATE - 2, A_CX - A_R, TH, R);
    member(g, A_CX + A_R, PLATE - 2, A_CX + A_R + POST, TH, R);
    const T = TONES.dress, w = RAIL;
    const ring = (): void => {
      g.beginPath();
      g.arc(A_CX, A_CY, A_R + w, Math.PI, Math.PI * 2);
      g.lineTo(A_CX + A_R, A_CY);
      g.arc(A_CX, A_CY, A_R, Math.PI * 2, Math.PI, true);
      g.closePath();
    };
    ring(); g.fillStyle = T.lit; g.fill();
    g.save(); ring(); g.clip();
    g.beginPath(); g.arc(A_CX, A_CY, A_R + w, Math.PI, Math.PI * 2); g.lineWidth = 5; g.strokeStyle = hexA(T.hi, 0.85); g.stroke();
    g.restore();
    ring(); g.strokeStyle = hexA(PASTEL.line, 0.8); g.lineWidth = 1.6; g.stroke();
  }
  /**
   * The footing a frame stands on: a course of field stone, laid dry and
   * pointed, with the sole of the frame sitting on it and the damp up its
   * foot. The stones across a seam are laid from their own seed, so the
   * footing runs on into the next section's.
   */
  function footingOf(g: Ctx, R: Rand): void {
    const h = S.plinth, y0 = TH - h;
    g.fillStyle = PASTEL.ringJoint; g.fillRect(0, y0, TW, h);
    const n = 6, bw = TW / n;
    for (const [row, lap, seed] of [[0, 0, 2311], [1, 0.5, 2333]] as Array<[number, number, number]>) {
      const ry = y0 + 3 + row * (h - 4) / 2, rh = (h - 4) / 2 - 2;
      for (let k = lap ? -1 : 0; k < n; k++) {
        const x = (k + lap) * bw;
        const RR = x < 0 || x + bw > TW ? rand(seed) : R;
        stone(g, x + 2, ry, bw - 4, rh, RR, RR() < 0.4 ? S.base[0] : S.base[1], 'laid', (RR() - 0.5) * 0.02, 1.6);
      }
    }
    const wet = g.createLinearGradient(0, TH, 0, y0);
    wet.addColorStop(0, 'rgba(60, 54, 58, 0.3)'); wet.addColorStop(1, 'rgba(60, 54, 58, 0)');
    g.fillStyle = wet; g.fillRect(0, y0, TW, h);
    member(g, -6, y0 - SOLE, TW + 6, y0, rand(1733), true);
    shadeUnder(g, -6, TW + 6, y0, 6);
  }
  /** A garden wall of it: the frame at half the height, its panels limewashed, a post at each end and a brace across each half. */
  function lowFrame(g: Ctx, R: Rand, fh: number): Block[] {
    g.fillStyle = PASTEL.stone; g.fillRect(0, 0, TW, fh);
    passes(g, R, 30, fh - 24);
    const e = POST / 2, xm = TW / 2;
    const top = 24;
    if (R() < 0.5) {
      brace(g, e, fh - SOLE, xm - e, top, R);
      brace(g, TW - e, fh - SOLE, xm + e, top, R);
    } else {
      brace(g, e, top, xm - e, fh - SOLE, R);
      brace(g, TW - e, top, xm + e, fh - SOLE, R);
    }
    member(g, xm - e, top - 2, xm + e, fh - SOLE + 2, R);
    member(g, -e, 0, e, fh, rand(1759));
    member(g, TW - e, 0, TW + e, fh, rand(1759));
    member(g, -6, fh - SOLE, TW + 6, fh, rand(1763), true);
    return [];
  }
  /** Its cap: a rail along the head, standing a finger proud of the frame under it. */
  function frameCope(g: Ctx): void {
    member(g, -6, 0, TW + 6, 24, rand(1767), true);
    shadeUnder(g, -6, TW + 6, 24, 7);
  }

  /**
   * The field of a bond: units of one size, laid to a line in a half lap.
   *
   * What the rubble field keeps by hand the bond keeps by the lay. Every
   * other course is set over by half a unit, so the joints stagger by
   * themselves and on those courses a unit lies across the section's seam --
   * drawn at both edges from one seed, so any section butts any other -- while
   * the courses between leave a joint there no wider than any other joint.
   * Every fourth course is headers, which is what a wall thick enough to
   * stand three storeys is actually bonded with, and it is the thing that
   * stops twelve courses of stretchers reading as ruled paper.
   *
   * What is drawn rather than laid is the colour. A kiln fires unevenly and
   * the load comes out in batches, so a brick wall is one hue in a dozen
   * values -- and on a wall where every unit is the same size, that is the
   * whole of what there is to look at.
   */
  function paintBond(g: Ctx, R: Rand, crests: Pt[]): Block[] {
    g.fillStyle = PASTEL.joint;
    g.fillRect(0, 0, TW, TH);
    slabs(g, 0, BAND, R);
    const own: Block[] = [];
    const zone = firing(R);
    /*
     * Where each bed joint falls.
     *
     * Evenly divided courses are the tell of a wall nobody laid: ten beds at
     * exactly a tenth is graph paper whatever is drawn between them. These
     * come off a seed every variant shares, because a course has to arrive at
     * a section's seam at the height it left the last one.
     */
    const tops = bedTops();
    for (let i = 0; i < S.rows; i++) {
      const y0 = tops[i], ch = tops[i + 1] - y0;
      // Headers every fourth course, on brick, which is what a wall thick
      // enough to stand three storeys is actually bonded with, and the thing
      // that stops ten courses of stretchers reading as ruled paper. Cut stone
      // is bonded through its own depth and shows stretchers only.
      const head = S.headers > 0 && i % S.headers === S.headers - 1;
      const n = head ? S.across * 2 : S.across;
      const uw = TW / n;
      const lap = head ? 0 : (i % 2) * 0.5;
      // The course's own sag. It is a sine on a span that is zero at both
      // ends, so a bed arrives at the seam level however far its middle has
      // dropped, and the drop is what says the wall has stood a while.
      const kw = 1 + Math.floor(R() * 2), aw = ch * 0.17 * (R() < 0.5 ? -1 : 1);
      const q = Math.min(COURSES - 1, Math.floor((i / S.rows) * COURSES));
      for (let k = lap ? -1 : 0; k < n; k++) {
        const x = (k + lap) * uw;
        const mid = clamp(x + uw / 2, EDGE, TW - EDGE);
        const seam = x < 0 || x + uw > TW;
        const sag = Math.sin((Math.PI * kw * (mid - EDGE)) / (TW - 2 * EDGE)) * aw;
        // The unit across the seam is the same unit in every variant, so it is
        // laid from a seed of the course's own rather than from the variant's.
        const RR = seam ? rand(811 + i * 7) : R;
        const priv = x + MORTAR / 2 > EDGE && x + uw - MORTAR / 2 < TW - EDGE;
        const tone = zone(RR, seam ? 0 : x + uw / 2, y0, head, q, crests, i < 2);
        const jw = MORTAR + (priv ? RR() * 2.2 : 0);
        const drift = (RR() - 0.5) * 2.4 + sag;
        const shrink = RR() * 2;
        const b: Block = {
          x: x + jw / 2,
          y: y0 + MORTAR / 2 + drift + shrink / 2,
          w: uw - jw,
          h: ch - MORTAR - shrink,
          course: q,
          pts: [],
        };
        // A degree would be a brick somebody dropped in. A bond is laid to a
        // line and what it has instead is a hand's worth of it, which is a
        // fortieth of a degree and shows as an edge rather than as a slope.
        const tilt = priv && RR() < 0.3 ? (RR() - 0.5) * 0.012 : 0;
        // And a lost edge here and there: one brick in six drawn with half the
        // ink, so the outline is a hand going round them and not a stencil.
        const ink = priv && RR() < 0.17 ? 0.7 : 1.35;
        b.pts = stone(g, b.x, b.y, b.w, b.h, RR, tone, 'unit', tilt, ink);
        if (priv && b.w > 24) own.push(b);
      }
    }
    weather(g, own, R);
    /*
     * And the band course standing proud of the brick under it. A dressing
     * that is flush with the wall is a painted stripe; what says it is a
     * course of stone laid on and projecting is the line of shade it throws
     * down the brick, and the arris of it catching the light above that.
     */
    oversail(g, 0, BAND, 12);
    return own;
  }

  /**
   * Where each bed joint of a bond falls, from the band down.
   *
   * Evenly divided courses are the tell of a wall nobody laid: ten beds at
   * exactly a tenth is graph paper whatever is drawn between them. These come
   * off a seed every variant shares, because a course has to arrive at a
   * section's seam at the height it left the last one -- and because a quoin
   * is two courses of brick deep and has to know where they are.
   */
  function bedTops(): number[] {
    const HR = rand(2027);
    const hs: number[] = [];
    let tot = 0;
    for (let i = 0; i < S.rows; i++) { const w = 0.92 + 0.16 * HR(); hs.push(w); tot += w; }
    const tops: number[] = [BAND];
    for (let i = 0; i < S.rows; i++) tops.push(tops[i] + ((TH - BAND) * hs[i]) / tot);
    return tops;
  }

  /**
   * The quoins a free end of a bond is finished with, toothed into the face.
   *
   * A column of equal stones up a corner is a strip of trim; what makes it
   * masonry is that it is bonded into the brick either side -- a long stone,
   * then a short one, each two courses of brick deep, so the brick is laid
   * into the notches between them. `side` is which edge of the section the
   * stones are on, and the two edges start their long-and-short on opposite
   * courses, so at a corner where two walls meet the long face of one is
   * over the short face of the other, the way a quoin turns a corner.
   */
  function quoins(side: -1 | 1): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = TW; c.height = TH;
    const g = c.getContext('2d') as Ctx;
    if (S.lay === 'render') {
      /*
       * A mud wall has no quoins: its corner is rounded, by the trowel and
       * then by the weather, so a free end is an arris that turns towards
       * the light on the left of a section and away from it on the right --
       * a flat strip of each, with a wobbling inner edge.
       */
      const R = rand(side < 0 ? 1811 : 1831), w = 15;
      g.beginPath();
      const xe = side < 0 ? 0 : TW;
      g.moveTo(xe, -2);
      for (let y = 0; y <= TH; y += 24) g.lineTo(xe - side * (w + (R() - 0.5) * 6), y);
      g.lineTo(xe, TH + 2); g.closePath();
      g.fillStyle = side < 0 ? hexA(PASTEL.stoneHi, 0.8) : 'rgba(46, 34, 62, 0.22)';
      g.fill();
      return c;
    }
    const tops = bedTops();
    const R = rand(side < 0 ? 1709 : 1733);
    const LONG = 94, SHORT = 54;
    for (let q = 0; q * 2 < S.rows; q++) {
      const y0 = tops[q * 2], y1 = tops[Math.min(S.rows, q * 2 + 2)];
      const long = (q % 2 === 0) === (side < 0);
      const reach = (long ? LONG : SHORT) + (R() - 0.5) * 8;
      // Where the stone ends against the brick, and the mortar round it.
      const x0 = side < 0 ? -6 : TW - reach, x1 = side < 0 ? reach : TW + 6;
      g.fillStyle = PASTEL.joint;
      g.fillRect(x0 - MORTAR, y0, x1 - x0 + MORTAR * 2, y1 - y0);
      const tone = R() < 0.3 ? 'plinth' : 'dress';
      const pts = stone(g, x0 + MORTAR / 2, y0 + MORTAR / 2, x1 - x0 - MORTAR, y1 - y0 - MORTAR, R, tone, 'unit', 0, 1.8);
      const b: Block = { x: x0, y: y0, w: x1 - x0, h: y1 - y0, course: q, pts };
      if (R() < 0.35) chipCorner(g, b, R);
      // A quoin stands a hair proud of the brick and it throws that much
      // shade on the course beside it, on the side away from the light.
      if (side > 0) {
        g.fillStyle = 'rgba(46, 38, 60, 0.26)';
        g.fillRect(x0 - MORTAR - 5, y0 + 2, 5, y1 - y0 - 2);
      }
    }
    return c;
  }

  /**
   * How a load of brick came out of the kiln, over one section.
   *
   * A kiln fires unevenly and a load gets laid where it was set down, so the
   * colour of a brick wall arrives in zones a yard or two across: one that
   * stood near the fire and came out scorched, one further off that came out
   * soft. Rolling every unit on its own gives a tweed -- the eye lands on
   * bricks instead of on the wall -- and it was the first thing an art
   * director said about this.
   *
   * The zones come off a coarse field over the section whose left-hand column
   * is drawn from a seed every variant shares and which wraps in x, so the
   * field has the same value at both edges of every section and carries
   * across a seam like everything else here. The roll inside a zone is what
   * stops the zone having an edge.
   */
  function firing(R: Rand): (RR: Rand, x: number, y: number, head: boolean, course: number, crests: Pt[], drip?: boolean) => string {
    const NX = 4, NY = 3;
    const edge = rand(1601);
    const grid: number[] = [];
    for (let j = 0; j <= NY; j++) for (let i = 0; i < NX; i++) grid.push(i === 0 ? edge() : R());
    /*
     * And a wash: a run down part of the section where the rain off the band
     * above has had the colour out of the brick. Most sections have one, well
     * inside the seams, a brick or so wide.
     */
    const washed = R() < 0.65;
    const washX = EDGE + 70 + R() * (TW - 2 * EDGE - 140), washW = 26 + R() * 34;
    const ease = (t: number): number => t * t * (3 - 2 * t);
    const at = (i: number, j: number): number => grid[Math.min(NY, j) * NX + (i % NX)];
    return (RR, x, y, head, course, crests, drip) => {
      const u = (x / TW) * NX, v = (y / TH) * NY;
      const i = Math.floor(u), j = Math.floor(v);
      const fu = ease(u - i), fv = ease(v - j);
      const top = at(i, j) + (at(i + 1, j) - at(i, j)) * fu;
      const bot = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fu;
      // Stretched, because the average of four uniforms sits near a half and
      // a field that never reaches its ends has no drifts in it, only a haze.
      const d = clamp(0.5 + (top + (bot - top) * fv - 0.5) * 1.9, 0, 1);
      /*
       * Which of the seven values: the drift, a little roll so a drift has no
       * edge, and three things that darken a brick where it is. A course or
       * two under a band course is in the drip of it; the foot of a wall and
       * the brick under a crest of ivy are damp, which is what the moss was
       * saying, but said as damp and not as a khaki brick; and a header is the
       * end of the brick, which is the end that went into the fire first.
       */
      let k = Math.round((d - 0.5) * 5.2 + (RR() - 0.5) * 1.3);
      if (drip) k -= 1;
      if (course >= COURSES - 1 || crests.some(([a, b]) => x > a && x < b)) k -= 1;
      if (head) k -= 1;
      if (washed && Math.abs(x - washX) < washW) k += 2;
      k = clamp(k, -3, 3);
      const t = RR();
      /*
       * One unit in twelve off another part of the kiln, near enough in value
       * to its neighbours that it is a brick and not a hole -- and where that
       * part of the kiln put it: the over-fired ones in the scorched drift,
       * the soft ones in the pale, so they come in clusters rather than as a
       * sprinkle of singles over the whole wall.
       */
      if (d < 0.32 && t < 0.16) return head || t < 0.07 ? 'burnt' : 'brown';
      if (d > 0.68 && t < 0.12) return 'warm';
      if (t < 0.02) return 'brown';
      return (RR() < 0.15 ? 'p' : 'f') + k;
    };
  }

  /**
   * A course of dressed stone standing proud of what is under it: the shade
   * it throws down the wall, and the arris of it taking the light above.
   */
  function oversail(g: Ctx, top: number, y: number, deep: number): void {
    // The shade it throws down the wall: hard for a hand's width under the
    // arris and then gone, and cool, as every shadow on this island is.
    const sh = g.createLinearGradient(0, y, 0, y + deep);
    sh.addColorStop(0, 'rgba(40, 32, 62, 0.46)');
    sh.addColorStop(0.35, 'rgba(40, 32, 62, 0.3)');
    sh.addColorStop(1, 'rgba(40, 32, 62, 0)');
    g.fillStyle = sh;
    g.fillRect(0, y, TW, deep);
    // And its top, weathered and turned up at the sky: a step lighter than
    // its face, which is the whole of what says the course stands out.
    const lit = g.createLinearGradient(0, top, 0, top + 7);
    lit.addColorStop(0, hexA(PASTEL.dressHi, 0.62));
    lit.addColorStop(1, hexA(PASTEL.dressHi, 0));
    g.fillStyle = lit;
    g.fillRect(0, top, TW, 7);
  }

  /** The band and the courses, the same contract in every variant, then `extras` marks each on a stone
   *  of its own. Returns the stones that are this variant's to mark, with the course each is on. */
  function paintCourses(g: Ctx, R: Rand, crests: Pt[], open = false): Block[] {
    if (S.lay === 'bond') return paintBond(g, R, crests);
    if (S.lay === 'render') return paintRender(g, R, open);
    if (S.lay === 'frame') return paintFrame(g, R, open);
    g.fillStyle = PASTEL.joint; g.fillRect(0, 0, TW, TH);
    slabs(g, 0, BAND, R);
    const own: Block[] = [];   // not the seam stones, not near the seam
    for (let i = 0; i < COURSES; i++) {
      const y = BAND + i * CH + MORTAR / 2, h = CH - MORTAR;
      let lo: number, hi: number;
      const st = STRADDLE[i];
      if (st) {
        // the seam stone: same shape, same tone, same place, in every variant
        const w = st[1] - st[0] - MORTAR;
        stone(g, TW + st[0] + MORTAR / 2, y, w, h, rand(777 + i), STRADDLE_TONE[i]);
        stone(g, st[0] + MORTAR / 2, y, w, h, rand(777 + i), STRADDLE_TONE[i]);
        lo = st[1]; hi = TW + st[0];               // so the joints either side of it are as wide as any other
      } else { lo = 0; hi = TW; }                  // and the seam falls in the middle of a joint of the usual width
      const L = hi - lo, n = Math.max(2, Math.round(L / (CH * 1.5)) + (R() < 0.35 ? 1 : 0));
      const ws: number[] = []; let sum = 0;
      for (let k = 0; k < n; k++) { const w = 0.5 + 1.2 * R(); ws.push(w); sum += w; }
      let x = lo; const run = { tone: '', left: 0 };
      // a novice's courses wander: each has a slow wave of its own, dying out at the section's edges
      const kw = 1 + Math.floor(R() * 2), aw = CH * 0.06 * (R() < 0.5 ? -1 : 1);
      for (let k = 0; k < n; k++) {
        // no two blocks sit quite alike: each drifts up or down, is shorter by a little, has a joint of
        // its own width, and one in five on the lower courses reaches up into the joint above; a third
        // tilt a degree or two
        const w = (ws[k] / sum) * L, mid = x + w / 2;
        const priv = x + MORTAR / 2 > EDGE && x + w - MORTAR / 2 < TW - EDGE;
        const wave = priv ? Math.sin(Math.PI * kw * (mid - EDGE) / (TW - 2 * EDGE)) * aw : 0;
        const drift = (R() - 0.5) * CH * 0.14 + wave, shrink = h * 0.14 * R(), jw = MORTAR + (priv ? R() * 3 : 0);
        const reach = i > 0 && R() < 0.2 ? CH * 0.05 : 0;
        const under = (crests || []).some(([a, b]) => mid > a && mid < b);
        const tone = pickTone(R, i, run, under);
        let sy = y + drift + shrink / 2 - reach, sh = h - shrink + reach;
        // the top course keeps under the band and the lowest above the storey line, whatever it does
        if (i === 0) { const top = BAND + MORTAR / 2; if (sy < top) { sh -= top - sy; sy = top; } }
        if (i === COURSES - 1) { const bot = TH - MORTAR / 2; if (sy + sh > bot) sh = bot - sy; }
        const tilt = priv && R() < 0.4 ? (R() - 0.5) * 0.08 : 0;
        if (priv && sh > 30 && R() < 0.08) {
          // a slot a novice had to pack: two thin stones one over the other
          const hh = (sh - MORTAR) / 2;
          for (const [yy, tn] of [[sy, tone], [sy + hh + MORTAR, pickTone(R, i, run, under)]] as Array<[number, string]>) {
            const s: Block = { x: x + jw / 2, y: yy, w: w - jw, h: hh, course: i, pts: [] };
            s.pts = stone(g, s.x, s.y, s.w, s.h, R, tn, 'laid', 0);
            if (s.w > 40) own.push(s);
          }
        } else {
          const s: Block = { x: x + jw / 2, y: sy, w: w - jw, h: sh, course: i, pts: [] };
          s.pts = stone(g, s.x, s.y, s.w, s.h, R, tone, 'laid', tilt);
          if (s.x > EDGE && s.x + s.w < TW - EDGE && s.w > 40) own.push(s);
        }
        x += w;
      }
    }
    weather(g, own, R);
    g.fillStyle = 'rgba(110,100,80,0.16)'; g.fillRect(0, BAND, TW, 9);
    // a handful of dark flecks, the grain of the stone
    g.fillStyle = hexA(PASTEL.line, 0.5);
    for (let k = 0; k < 8; k++) { const s = own[Math.floor(R() * own.length)]; if (!s) break; g.beginPath(); g.arc(s.x + (R() < 0.5 ? 3 : s.w - 3), s.y + (R() < 0.5 ? 3 : s.h - 3), 1 + R(), 0, 7); g.fill(); }
    return own;
  }

  /* ---- growth: blob painting ------------------------------------------------- */
  /* Growth: a body, a deeper green in the shade, a pale one where the light catches an edge, and a dark
   * line with a tight halo round every mass. Begun as the castle reference's own tones, picked off it by
   * k-means, and carried into the island's teal with everything else that grows -- what a thing was
   * sampled from stops mattering the moment the field it stands in moves. */
  const VEG = { top: '#80cc94', lit: '#6bb180', shade: '#65957a', pale: '#abe3b5', line: '#4b6c57' };
  const MOSS = { fill: '#7bb98b', under: '#669d75', fleck: '#598768' };
  const MARGIN = 77;                                     // no growth over the top nearer a section edge than this
  const keepX = (x: number, r: number): number => clamp(x, EDGE + r + 5, TW - EDGE - r - 5);
  const keepD = (x: number, r: number): number => clamp(x, MARGIN + r, TW - MARGIN - r);
  /** A lobe's size: small, middling or large, so a mass is an aggregate of unequal lobes. */
  const lobeSize = (R: Rand): number => { const t = R(); return t < 0.3 ? 0.55 : t < 0.75 ? 0.9 : 1.4; };

  /** Lobes along a row in the three sizes: far enough apart to notch the edge a third deep, and where
   *  two neighbours fall short of touching, a small lobe bridges them, or the line would show in the gap.
   *  `notch` is the chance an end lobe is left out, biting the edge a lobe deep; and most rows get a
   *  crumb -- a lobe a third the size -- tucked against an end, so the edge is crumbly there. */
  function row(cs: Lobe[], x0: number, x1: number, y: number, r: number, R: Rand, spacing?: number, notch?: number, keep?: (x: number, r: number) => number): void {
    const K = keep || keepX;
    const n = Math.max(1, Math.round((x1 - x0) / (r * (spacing || 1.45)))), made: Lobe[] = [];
    for (let i = 0; i <= n; i++) {
      const rr = r * lobeSize(R);
      made.push([K(x0 + (x1 - x0) * (n ? i / n : 0.5) + (R() - 0.5) * r * 0.3, rr), y + (R() - 0.5) * r * 0.3, rr]);
    }
    if (notch && made.length >= 3 && R() < notch) made.splice(R() < 0.5 ? 0 : made.length - 1, 1);
    const m = made.length;
    for (let i = 0; i + 1 < m; i++) {
      const a = made[i], b = made[i + 1];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > a[2] + b[2] - 3) made.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.min(a[2], b[2]) * 0.8]);
    }
    for (const s of [-1, 1]) {
      const e = s < 0 ? made[0] : made[m - 1];
      if (R() < 0.7) { const rr = e[2] * 0.36; made.push([K(e[0] + s * e[2] * 0.95, rr), e[1] + (R() - 0.5) * e[2] * 0.8, rr]); }
    }
    cs.push(...made);
  }
  /** The union of a mass's lobes, rasterised: any pocket the lobes enclose that is smaller than
   *  `maxArea` gets a lobe over it, because the line drawn beneath the mass would otherwise show
   *  through the pocket as a dark speck. Bigger pockets are left: the wall shows through them. */
  function plugHoles(cs: Lobe[], maxArea: number): void {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y, r] of cs) { x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r); }
    const ox = Math.floor(x0) - 2, oy = Math.floor(y0) - 2, W = Math.ceil(x1) - ox + 3, Hh = Math.ceil(y1) - oy + 3;
    if (W <= 0 || Hh <= 0 || W * Hh > 4e6) return;
    const c = cnv(W, Hh), g = ctxOf(c);
    unionPath(g, cs, -ox, -oy, 0); g.fillStyle = '#000'; g.fill();
    const d = g.getImageData(0, 0, W, Hh).data, mark = new Uint8Array(W * Hh);
    for (let i = 0; i < W * Hh; i++) if (d[i * 4 + 3] > 127) mark[i] = 1;
    const stack: number[] = [];
    const flood = (start: number, tag: number, box?: number[]): void => {
      stack.push(start);
      while (stack.length) {
        const i = stack.pop() as number;
        if (mark[i]) continue;
        mark[i] = tag;
        const x = i % W, y = (i - x) / W;
        if (box) { box[0] = Math.min(box[0], x); box[1] = Math.max(box[1], x); box[2] = Math.min(box[2], y); box[3] = Math.max(box[3], y); box[4]++; }
        if (x > 0) stack.push(i - 1); if (x < W - 1) stack.push(i + 1); if (y > 0) stack.push(i - W); if (y < Hh - 1) stack.push(i + W);
      }
    };
    for (let x = 0; x < W; x++) { flood(x, 2); flood((Hh - 1) * W + x, 2); }
    for (let y = 0; y < Hh; y++) { flood(y * W, 2); flood(y * W + W - 1, 2); }
    for (let i = 0; i < W * Hh; i++) {
      if (mark[i]) continue;
      const box = [W, 0, Hh, 0, 0];
      flood(i, 3, box);
      if (box[4] <= maxArea) cs.push([ox + (box[0] + box[1] + 1) / 2, oy + (box[2] + box[3] + 1) / 2, Math.hypot(box[1] - box[0] + 1, box[3] - box[2] + 1) / 2 + 1.5]);
    }
  }

  /** One mass. An outline -- the halo, then the dark line -- round the union of the lobes, and a
   *  fainter line round every third lobe inside; then the light from above, the way the reference
   *  paints a bush -- the faint lines only in the middle band: the top third of the mass in the pale
   *  lime, with a cream leaf or three or four of
   *  different sizes on it if `o.lobe` is set, never two level side by side; the middle in the lit
   *  green, a third of its lobes carrying a crescent of shade at the lower right; the underside in the
   *  shade green, each lobe with a thin sliver of light at its upper left. Every mass has a light side
   *  and a dark side, and that survives being shrunk to a few pixels. */
  function mass(g: Ctx, cs: Lobe[], R: Rand, o: { r: number; lw?: number; lobe?: number }): void {
    const r = o.r, dx = -r * 0.38, dy = -r * 0.5, lw = o.lw || 3;
    const m0 = cs.length;
    for (let i = 0; i < m0; i++) for (let j = i + 1; j < m0; j++) {
      const a = cs[i], b = cs[j], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d > a[2] + b[2] - 2 && d < a[2] + b[2] + 2 * lw + 2) cs.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.min(a[2], b[2]) * 0.7]);
    }
    plugHoles(cs, 220);
    let y0 = Infinity, y1 = -Infinity;
    for (const [, y, rr] of cs) { y0 = Math.min(y0, y - rr); y1 = Math.max(y1, y + rr); }
    const Hh = Math.max(1, y1 - y0), band = (c: Lobe): number => (c[1] - y0) / Hh;
    unionPath(g, cs, 0, 0, lw + 1.8); g.fillStyle = hexA(VEG.line, 0.4); g.fill();
    unionPath(g, cs, 0, 0, lw); g.fillStyle = VEG.line; g.fill();
    unionPath(g, cs, 0, 0, 0); g.fillStyle = VEG.shade; g.fill();
    g.save(); unionPath(g, cs, 0, 0, 0); g.clip();
    unionPath(g, cs, dx, dy, 0); g.fillStyle = VEG.lit; g.fill();
    const topL = cs.filter((c) => band(c) < 0.3);
    if (topL.length) { unionPath(g, topL, 0, 0, -0.5); g.fillStyle = VEG.top; g.fill(); }
    for (const c of cs) {
      const b = band(c), low = b > 0.62;
      if (b < 0.3 || (!low && R() > 0.35)) continue;
      const k = low ? 1.05 : 0.3;
      g.save(); g.beginPath(); g.arc(c[0], c[1], c[2], 0, 7); g.clip();
      g.fillStyle = VEG.shade; g.fillRect(c[0] - c[2], c[1] - c[2], 2 * c[2], 2 * c[2]);
      g.beginPath(); g.arc(c[0] - c[2] * k, c[1] - c[2] * k * 1.15, c[2], 0, 7); g.fillStyle = VEG.lit; g.fill();
      g.restore();
    }
    // a few leaf edges inside the middle band: an open arc a third of the way round, low and right,
    // on one lobe in three or four, in the shade green -- never a closed ring
    g.strokeStyle = hexA(VEG.shade, 0.8); g.lineWidth = lw * 0.4; g.lineCap = 'round';
    for (let i = 0; i < m0; i += 3 + Math.floor(R() * 2)) { const c = cs[i], b = band(c); if (b < 0.3 || b > 0.62) continue; g.beginPath(); g.arc(c[0], c[1], Math.max(1, c[2] - lw * 0.35), Math.PI * 0.15, Math.PI * 0.8); g.stroke(); }
    if (o.lobe && topL.length) {
      const n = [1, 3, 3, 4][Math.floor(R() * 4)], pale: Lobe[] = [], cands = topL.slice().sort(() => R() - 0.5);
      for (const c of cands) {
        if (pale.length >= n) break;
        if (pale.some((p) => Math.abs(p[1] - c[1]) < r * 0.8 && Math.abs(p[0] - c[0]) < r * 5)) continue;
        pale.push([c[0] + (R() - 0.5) * c[2] * 0.6, c[1] + (R() - 0.5) * c[2] * 0.6, 5.5 + 1.5 * pale.length] as Lobe);
      }
      if (pale.length) { unionPath(g, pale, 0, 0, 0); g.fillStyle = VEG.pale; g.fill(); }
    }
    g.restore();
  }

  /** A drape and its crest, one silhouette, made of lobes the size of leaf clusters: a crest spilling
   *  over the cap, wider than it is tall, one shoulder a third wider than the other and dropping most
   *  of a course lower down the face; and under it, where `m.fall` asks for one, a curtain rooted at
   *  seven tenths of the crest's width, tapering to a third of it, that frays over its last third into
   *  two or three tongues side by side of unequal length, each narrowing to a lobe and stopping there.
   *  No neck, no club: the curtain is never more than three times as long as it is wide. */
  function drapeLayout(m: Drape, R: Rand): { cs: Lobe[]; r: number } {
    const cs: Lobe[] = [], W = m.w, half = W / 2, r0 = 11 + W * 0.012;
    const cx = clamp(m.cx, MARGIN + half, TW - MARGIN - half);
    const peak = (R() - 0.5) * 0.7, rise = 14 + W * 0.07, depth = 6 + W * 0.09, wideSide = R() < 0.5 ? -1 : 1;
    for (let y = -rise; y <= depth; y += r0) {
      const t = (y + rise) / (depth + rise);
      const wide = t < 0.4 ? 0.55 + 0.45 * Math.pow(t / 0.4, 0.6) : 1;
      const c = cx + peak * half * 0.5 * Math.max(0, 1 - t / 0.4);
      const w = half * wide * (0.94 + 0.12 * R()), spill = t > 0.25 ? w * 0.3 : 0;
      row(cs, c - w - (wideSide < 0 ? spill : 0), c + w + (wideSide > 0 ? spill : 0), y, r0 * (0.9 + 0.2 * R()), R, 1.3, t > 0.5 ? 0.25 : 0, keepD);
    }
    const drop = CH * (0.5 + 0.3 * R());
    for (let y = depth + r0; y < depth + drop; y += r0 * 1.1) {
      const t2 = (y - depth) / drop, xa = cx + wideSide * half * (0.25 + 0.3 * t2), xb = cx + wideSide * half * (1.2 - 0.55 * t2);
      row(cs, Math.min(xa, xb), Math.max(xa, xb), y, r0 * (0.95 - 0.25 * t2), R, 1.3, 0.3, keepD);
    }
    if (m.fall) {
      const top = depth + r0 * 0.8, L = TH * m.fall, span = Math.max(r0 * 2, L - top), lean = (R() - 0.5) * 0.2;
      const hwAt = (t: number): number => half * (0.72 - 0.4 * t), split = top + span * 0.62;
      for (let y = top; y < split; y += r0 * 1.15) {
        const t = (y - top) / span, hw = hwAt(t) * (0.94 + 0.12 * R()), c = cx + lean * (y - top);
        row(cs, c - hw, c + hw, y, r0 * (0.95 - 0.2 * t), R, 1.3, t > 0.2 ? 0.3 : 0, keepD);
      }
      const n = m.tongues || 2, lens = [1, 0.78, 0.6].sort(() => R() - 0.5).slice(0, n), hwS = hwAt((split - top) / span);
      for (let k = 0; k < n; k++) {
        const Lk = split + (L - split) * lens[k], u = (k - (n - 1) / 2) * (2 * hwS / n), hwT = hwS / n;
        let j = 0;
        for (let y = split; y < Lk; y += r0 * 1.15, j++) {
          const t = (y - split) / Math.max(1, Lk - split), hw = Math.max(r0 * 0.3, hwT * (1 - 0.6 * t)), c = cx + u + lean * (y - top) + (R() - 0.5) * r0 * 0.3;
          row(cs, c - hw, c + hw, y, r0 * (0.85 - 0.3 * t), R, 1.25, j > 0 ? 0.35 : 0, keepD);
        }
      }
    }
    return { cs, r: r0 };
  }
  /** A hedge at the foot: a long low mass of lobes painted on the wall itself, widest at the ground and
   *  narrowing to its top, its top notched, its rows close enough to leave no holes; its lowest rows
   *  lie below the ground line, so the canvas cuts it flat two pixels above it and the cut reads as the
   *  shadow it stands in. The mass's own tone rule darkens its underside along the scalloped foot. On
   *  half of them a few cream leaves, and a few blossoms over the upper half. */
  function hedge(g: Ctx, b: Hedge, R: Rand, base = TH): void {
    const cs: Lobe[] = [], half = b.w / 2, r = 6 + b.h * 0.08;
    for (let y = base - b.h + r; y <= base + r; y += r * 1.25) {
      const t = (base - y) / b.h;
      const w = half * (t > 0.2 ? 1 - 0.4 * Math.pow((t - 0.2) / 0.8, 1.4) : 1) * (0.94 + 0.12 * R());
      row(cs, b.cx - w, b.cx + w, y, r * (0.9 + 0.2 * R()), R, 1.3, t > 0.4 ? 0.3 : 0);
    }
    g.save(); g.beginPath(); g.rect(0, 0, TW, base - 2); g.clip();
    shadowOf(g, cs, 6, 4);
    mass(g, cs, R, { r, lobe: R() < 0.5 ? 1 : 0 });
    // three to five blossoms on the crown, white and pink as the reference has them: four petals round
    // a sand centre, under a thin dark line so they hold against the pale lime, big enough to survive 1x
    const crown = cs.filter((c) => c[1] < base - b.h * 0.55);
    for (let i = 0; i < (b.flowers || 0) && crown.length; i++) {
      const c = crown[Math.floor(R() * crown.length)], x = c[0] + (R() - 0.5) * c[2], y = c[1] + (R() - 0.5) * c[2], fr = 9 + 3 * R();
      const petals: Lobe[] = [[x, y - fr * 0.5, fr * 0.5], [x - fr * 0.5, y, fr * 0.5], [x + fr * 0.5, y, fr * 0.5], [x, y + fr * 0.5, fr * 0.5]];
      unionPath(g, petals, 0, 0, 1.3); g.fillStyle = VEG.line; g.fill();
      unionPath(g, petals, 0, 0, 0); g.fillStyle = R() < 0.6 ? '#f7f3e6' : PASTEL.blush; g.fill();
      g.beginPath(); g.arc(x, y, fr * 0.22, 0, 7); g.fillStyle = PASTEL.sand; g.fill();
    }
    g.restore();
  }
  /** Moss on a joint: a short lens, half a brick long, thick in the middle and thin at the ends, two
   *  or three shallow bumps along its top and flat along the joint, in a grey olive between the stone
   *  and the growth, with the darker olive showing only as a hairline along the underside. `y` is the
   *  joint; the lens hangs above it. */
  function mossLens(g: Ctx, s: Block, y: number, R: Rand): void {
    const len = Math.min(TW - 2 * EDGE - 10, s.w * (0.4 + 0.5 * R())), h = CH * (0.1 + 0.06 * R());
    const x0 = clamp(s.x + (s.w - len) * R(), EDGE + 5, TW - EDGE - len - 5), cx = x0 + len / 2;
    const body = blob(cx, y - h * 0.45, len / 2, h * 0.55, 14, R, 0.8, 0.25, 0.15), bumps: Lobe[] = [];
    for (let k = 0; k < 2 + (R() < 0.5 ? 1 : 0); k++) bumps.push([x0 + len * (0.2 + 0.6 * R()), y - h * 0.7, h * (0.35 + 0.2 * R())]);
    g.save(); g.beginPath(); g.rect(x0 - 12, y - CH, len + 24, CH); g.clip();
    const paint = (tone: string, oy: number): void => {
      g.fillStyle = tone;
      g.save(); g.translate(0, oy); shape(g, body); g.fill(); unionPath(g, bumps, 0, 0, 0); g.fill(); g.restore();
    };
    paint(MOSS.under, 1.5);
    paint(MOSS.fill, 0);
    g.restore();
  }
  /** A fleck of dark moss in the corner of a joint. */
  function mossFleck(g: Ctx, s: Block, R: Rand): void {
    const onTop = R() < 0.6, x = s.x + s.w * (0.05 + 0.9 * R()), y = onTop ? s.y + 2.5 : s.y + s.h - 2.5;
    g.beginPath(); g.arc(x, y, 1.5 + R(), 0, 7); g.fillStyle = hexA(MOSS.fleck, 0.8); g.fill();
  }
  /** A faint dab of moss on a brick's face. */
  function mossDab(g: Ctx, s: Block, R: Rand): void {
    const x = s.x + s.w * (0.15 + 0.7 * R()), y = s.y + s.h * (0.3 + 0.5 * R()), rr = 1.5 + 1.5 * R();
    g.beginPath(); g.arc(x, y, rr, 0, 7); g.fillStyle = hexA(MOSS.fill, 0.55); g.fill();
  }
  /**
   * The foot of a mud wall, where the rain that splashes off the ground has
   * eaten the coat back.
   *
   * A band `h` px deep at the seams, its top edge a run of shallow scoops,
   * each an arch the splash has eaten up into the coat and each overlapping
   * the next, some a good deal higher than others -- not a wave, whose humps
   * came out all alike, and not a stair of flat flakes, which read as paper
   * torn along a rule. The coat thins to a feathered lip over it, a step
   * between the two tones rather than a line drawn round. The bottom third,
   * where it never dries, is a step darker again, and in a place or two the
   * coat has gone from the band entirely and the courses of the brick show.
   * The edge comes in at `h` at both ends, so the foot runs along a street
   * without a step at the seams.
   */
  function erosionOf(g: Ctx, R: Rand, h: number, bottom: number): void {
    const scoops: Array<{ c: number; w: number; top: number }> = [];
    for (let x = -30; x < TW + 30;) {
      const w = 44 + R() * 76;
      scoops.push({ c: x + w / 2, w, top: h * (0.72 + R() * 0.55) });
      x += w * (0.5 + R() * 0.3);
    }
    const reach = (x: number): number => {
      let best = h * 0.6;
      for (const s of scoops) {
        const u = (x - s.c) / (s.w / 2);
        if (Math.abs(u) < 1) best = Math.max(best, s.top * (0.8 + 0.2 * Math.sqrt(1 - u * u)));
      }
      const e = Math.min(1, Math.min(x, TW - x) / 56);
      return h + (best - h) * e;
    };
    const pts: Pt[] = [];
    for (let x = 0; x <= TW; x += 4) pts.push([x, bottom - reach(x)]);
    const zone = (dy: number): void => {
      g.moveTo(-2, bottom + 4);
      for (const [px, py] of pts) g.lineTo(px, py + dy);
      g.lineTo(TW + 2, bottom + 4);
      g.closePath();
    };
    g.save();
    g.beginPath(); zone(0);
    g.fillStyle = PASTEL.erode; g.fill();
    g.clip();
    // Where the coat is gone from the band altogether: a course or two of brick.
    for (let i = 0; i < (R() < 0.6 ? 1 : 2); i++) {
      const w = 60 + R() * 70, x0 = EDGE + 20 + R() * (TW - 2 * EDGE - 40 - w);
      const n = h > 50 ? 2 : 1, y0 = bottom - n * MUD_CH - 4 - R() * 6;
      const runs: Array<[number, number]> = [];
      for (let k = 0; k < n; k++) runs.push([x0 + R() * 16, x0 + w - R() * 16]);
      g.save();
      g.translate(0, y0);
      g.beginPath(); poly(g, stair(runs, R)); g.clip();
      mudBrick(g, x0 - 8, -4, x0 + w + 8, n * MUD_CH + 4, R, 0);
      g.restore();
    }
    // Where it never dries: the bottom third, a step darker, its top edge as ragged as damp is.
    g.beginPath(); g.moveTo(-2, bottom + 4);
    for (let x = 0; x <= TW; x += 8) g.lineTo(x, bottom - h * 0.34 + Math.sin(x * 0.05 + R()) * 1.6);
    g.lineTo(TW + 2, bottom + 4); g.closePath();
    g.fillStyle = hexA(PASTEL.damp, 0.34); g.fill();
    // The coat's lip, feathered: a band between its tone and the foot's.
    g.beginPath(); g.rect(-4, bottom - h * 2 - 20, TW + 8, h * 2 + 30); zone(4); g.clip('evenodd');
    g.fillStyle = hexA(PASTEL.stone, 0.5); g.fillRect(-4, bottom - h * 2 - 20, TW + 8, h * 2 + 30);
    g.restore();
  }
  /**
   * The plinth: the cut stone a brick wall is stood on at the ground.
   *
   * It is the one thing a wall of one material cannot have, and it is where
   * the weight of the picture is -- twelve courses of brick sitting on
   * nothing read as wallpaper hung to the grass. Two courses of big blocks
   * and a chamfered course over them, which is the course that throws the
   * rain off the brick above and out past the face; without it a plinth is
   * just the bottom of the wall painted a different colour.
   *
   * It goes on with the damp, which means it is only ever seen out of doors
   * and stops at a doorway, and both of those are where a plinth stops.
   */
  function plinthOf(g: Ctx, R: Rand): void {
    const h = S.plinth, cap = 21, y0 = TH - h;
    g.fillStyle = PASTEL.ringJoint;
    g.fillRect(0, y0, TW, h);
    /** One course of it, `lap` of a block over so the joints stagger at the seam. */
    const course = (y: number, bh: number, bn: number, lap: number, seed: number, ink: number): void => {
      const bw = TW / bn;
      for (let k = lap ? -1 : 0; k < bn; k++) {
        const x = (k + lap) * bw;
        const seam = x < 0 || x + bw > TW;
        const RR = seam ? rand(seed) : R;
        // No two out of the same bed: a plinth is four stones to the section
        // and four of one tone is a painted skirting rather than masonry.
        const t = RR();
        stone(g, x + MORTAR / 2, y, bw - MORTAR, bh, RR, t < 0.38 ? S.base[0] : S.base[1], 'unit', 0, ink);
      }
    };
    /*
     * One course, not two. Two courses of the band's own depth read as the
     * band again, at the bottom of the wall instead of the top; a plinth is a
     * bigger stone than anything above it, and one metre by two thirds is the
     * size it has to be before the brick reads as standing on something.
     */
    course(y0 + cap + MORTAR / 2, h - cap - MORTAR, 4, 0, 331, 2.2);
    course(y0 + MORTAR / 2, cap - MORTAR, 5, 0.5, 457, 1.7);
    /*
     * And the chamfer read as a slope rather than as a stripe: it is a face
     * turned up at the sky, so it goes from near its own lit tone at the top
     * to the shade at the bottom, over the stones rather than instead of
     * them. The brick above it stands back, and the line of shade under that
     * setback is the whole of what says the plinth stands proud.
     */
    const sl = g.createLinearGradient(0, y0, 0, y0 + cap);
    sl.addColorStop(0, hexA(PASTEL.dressHi, 0.78));
    sl.addColorStop(0.55, hexA(PASTEL.dressHi, 0.24));
    sl.addColorStop(1, 'rgba(44, 36, 42, 0.3)');
    g.fillStyle = sl;
    g.fillRect(0, y0, TW, cap);
    g.fillStyle = 'rgba(42, 34, 40, 0.42)';
    g.fillRect(0, y0 - 5, TW, 5);
    /*
     * And the damp up the foot of it. A plinth is the part of a wall the rain
     * lands on twice -- once falling and once off the ground -- and it is the
     * one place on a building where that is worth drawing, because it is the
     * line where the wall stops and the grass starts.
     */
    const wet = g.createLinearGradient(0, TH, 0, TH - h * 0.55);
    wet.addColorStop(0, 'rgba(40, 34, 40, 0.34)');
    wet.addColorStop(1, 'rgba(40, 34, 40, 0)');
    g.fillStyle = wet;
    g.fillRect(0, TH - h * 0.55, TW, h * 0.55);
    /*
     * And moss on the chamfer, which is the one ledge of the wall the rain
     * sits on before it runs off: a lens or two along it, and a fleck in the
     * joints of the course under it, so the wall grows out of the grass
     * rather than being stood on it. On a masonry that carries the island's
     * planting; the rest stand bare.
     */
    if (!S.growth) return;
    const n = 1 + (R() < 0.55 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const w = 90 + R() * 110;
      mossLens(g, { x: EDGE + R() * (TW - 2 * EDGE - w), y: y0, w, h: cap, course: 0, pts: [] }, y0 + 3, R);
    }
    for (let i = 0; i < 4; i++) {
      const x = EDGE + 8 + R() * (TW - 2 * EDGE - 16);
      g.beginPath(); g.arc(x, y0 + cap + 1 + R() * 2, 1.4 + R() * 1.2, 0, 7);
      g.fillStyle = hexA(MOSS.fleck, 0.75); g.fill();
    }
  }

  /** The foot of the ground storey: a band of shade along the ground line; one to three lenses of moss
   *  on as many different courses of the lowest three, one of them now and then rising from the ground
   *  line itself; three to six flecks in the corners of joints low down; a dab or two on the bricks. */
  function footMoss(g: Ctx, stones: Block[], count: number, R: Rand): void {
    g.fillStyle = 'rgba(110,100,80,0.16)'; g.fillRect(0, TH - 10, TW, 10);
    const courses = [COURSES - 1, COURSES - 2, COURSES - 3].sort(() => R() - 0.5).slice(0, Math.min(count, 1 + Math.floor(R() * 3)));
    for (const c of courses) {
      const pool = stones.filter((s) => s.course === c);
      if (!pool.length) continue;
      const s = pool[Math.floor(R() * pool.length)];
      mossLens(g, s, c === COURSES - 1 && R() < 0.34 ? TH + 1 : s.y - MORTAR / 2, R);
    }
    const low = stones.filter((s) => s.course >= COURSES - 2);
    for (let i = 0; i < 3 + Math.floor(R() * 4) && low.length; i++) mossFleck(g, low[Math.floor(R() * low.length)], R);
    for (let i = 0; i < 1 + Math.floor(R() * 2) && low.length; i++) mossDab(g, low[Math.floor(R() * low.length)], R);
  }

  /* ---- the five: the same register, placed differently ------------------------ */
  const VARIANTS: Variant[] = [
    { name: 'Cobblestone 1', tells: 'moss on two low joints; a big crest left of centre with a long curtain in two tongues; a flowering hedge to the right at the foot', seed: 11,
      extras: { moss: 2 },
      drapes: [{ cx: 180, w: 210, fall: 0.85, tongues: 2, seed: 101 }],
      foot: { hedges: [{ cx: 385, w: 150, h: 72, flowers: 4, seed: 111 }] } },
    { name: 'Cobblestone 2', tells: 'moss on three low joints; a small crest at the left with no curtain and a middling one to the right with a short curtain in three tongues; the widest hedge to the left at the foot', seed: 23,
      extras: { moss: 3 },
      drapes: [{ cx: 110, w: 90, fall: 0, seed: 202 }, { cx: 330, w: 150, fall: 0.5, tongues: 3, seed: 201 }],
      foot: { hedges: [{ cx: 125, w: 220, h: 96, flowers: 4, seed: 211 }] } },
    { name: 'Cobblestone 3', tells: 'moss on two low joints; nothing over the top; the tallest hedge at the foot', seed: 37,
      extras: { moss: 2 },
      drapes: [],
      foot: { hedges: [{ cx: 250, w: 300, h: 112, flowers: 5, seed: 311 }] } },
    { name: 'Cobblestone 4', tells: 'moss on three low joints; one middling crest to the right with a curtain in three tongues; nothing at the foot: the bare one', seed: 53,
      extras: { moss: 3 },
      drapes: [{ cx: 355, w: 170, fall: 0.7, tongues: 3, seed: 401 }],
      foot: { hedges: [] } },
    { name: 'Cobblestone 5', tells: 'moss on two low joints; the biggest crest to the left with a short curtain, and a small crest at the right with none; a hedge one block wide between them at the foot', seed: 71,
      extras: { moss: 2 },
      drapes: [{ cx: 165, w: 230, fall: 0.35, tongues: 2, seed: 501 }, { cx: 400, w: 90, fall: 0, seed: 502 }],
      foot: { hedges: [{ cx: 320, w: 110, h: 64, flowers: 3, seed: 512 }] } },
  ];

  /* ---- the archway ------------------------------------------------------- */
  /*
   * A rough cobbled archway whose shape is not rough at all.
   *
   * That is the whole of the idea. A novice can lay a true arch without being
   * able to cut a stone: he strikes the curve off a centre, props a former
   * under it, and jams whatever he has against it until it stands. The line of
   * the opening is therefore exact and everything touching it is not -- wedges
   * of no two depths, joints that are not quite radial, and a ragged pocket of
   * mortar where the field stones were broken away to make room.
   *
   * It is drawn in that order and cut last. Every stone of the ring is laid
   * generously, overhanging into the opening, and then the hole is taken out
   * of the lot of them in one pass -- so the intrados is a circle struck by a
   * compass, and the stone either side of it was shaped by somebody with a
   * hammer and no great hurry.
   */
  const A_CX = TW * (ARCH.t0 + ARCH.t1) / 2;
  /*
   * The half span, and the rise, which are the same number.
   *
   * A section is four metres across and three high at 128 px to the metre both
   * ways, so a circle in the world is a circle in the picture and one radius
   * does for both. The renderer works the rise out from the same two spans and
   * arrives at the same place, which is what lets its clip and this hole agree.
   */
  const A_R = TW * (ARCH.t1 - ARCH.t0) / 2;
  const A_CY = TH * (1 - ARCH.spring);

  /** The opening: two jambs and a true semicircular head. */
  function openingPath(g: Ctx): void {
    g.beginPath();
    g.moveTo(A_CX - A_R, TH);
    g.lineTo(A_CX - A_R, A_CY);
    g.arc(A_CX, A_CY, A_R, Math.PI, Math.PI * 2);
    g.lineTo(A_CX + A_R, TH);
    g.closePath();
  }

  /** A polygon with more corners than it needs, each shoved about: a stone cut by eye. */
  function roughen(poly: Pt[], R: Rand, per: number, jitter: number): Pt[] {
    const out: Pt[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      for (let k = 0; k < per; k++) {
        const u = k / per;
        out.push([a[0] + (b[0] - a[0]) * u + (R() - 0.5) * jitter * 2,
                  a[1] + (b[1] - a[1]) * u + (R() - 0.5) * jitter * 2]);
      }
    }
    return out;
  }

  const bbox = (pts: Pt[]): Block => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, course: 0, pts };
  };

  /** One stone of the ring or a jamb: the same two tones, line and bevel every block has. */
  function dressed(g: Ctx, pts: Pt[], tone: string): void {
    const T = TONES[tone] || TONES[''];
    solid(g, pts, T.lit, T.shade, PASTEL.line, 2.4, -3.5, -4.5);
    g.save(); shape(g, pts); g.clip();
    g.globalAlpha = 0.45; g.translate(1.5, 2);
    shape(g, pts); g.strokeStyle = T.hi; g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke();
    g.restore();
  }

  /** What a hammer and the weather have had off one stone of an arch. Never `missing`: a ring is
   *  only standing while every wedge in it is. */
  function wearOne(g: Ctx, pts: Pt[], R: Rand): void {
    const s = bbox(pts);
    const t = R();
    if (t < 0.20) chipCorner(g, s, R);
    else if (t < 0.34) crack(g, s, R);
    else if (t < 0.40) spall(g, s, R);
    if (R() < 0.28) abrade(g, s, R);
    if (R() < 0.24) pits(g, s, R);
    if (R() < 0.18) slop(g, s, R);
  }

  /**
   * The reveal: a column of stone up each side of the opening, from the
   * springing down to the ground.
   *
   * These are the stones a novice takes trouble over, because they are the
   * ones a cart scrapes and a hand rests on, so they run squarer and a shade
   * warmer than the field they sit in. Their inner edge overhangs into the
   * opening and is taken off by the cut, which is what leaves the jamb dead
   * straight while every other edge of every one of them wanders.
   */
  function jamb(g: Ctx, R: Rand, side: number): void {
    const line = A_CX + side * A_R;
    let y = A_CY + IMPOST_H, course = side < 0 ? 0 : 1;
    while (y < TH + 20) {
      const h = 36 + R() * 22;
      // Long and short about, so the outer end of the stack is toothed into
      // the field. Even widths give a dead straight joint the length of the
      // reveal, which reads as the seam between two wall tiles.
      const w = (course++ % 2 ? 46 : 74) + R() * 16;
      const x = side < 0 ? line + OVER - w : line - OVER;
      const pts = stone(g, x, y, w, h, R, pickDressed(R), 'laid', (R() - 0.5) * 0.035);
      wearOne(g, pts, R);
      y += h + MORTAR + R() * 3;
    }
  }

  /** How far every stone of the opening is laid into it, to be cut off again. */
  const OVER = 10;
  /** How deep the impost is, which is also where the jamb starts. */
  const IMPOST_H = 20;

  /**
   * The impost: the one flat stone at the springing that the ring comes down
   * on and the jamb carries.
   *
   * Without it the lowest wedge sits straight on whatever course of the jamb
   * happened to end there, and the ring and the reveal run into each other in
   * a muddle. It is the one piece of an arch that even a bad mason gets
   * right, because it is the piece that tells him where to start the curve.
   * It reaches a little further out than the ring does, the way a ledge does.
   */
  function impost(g: Ctx, R: Rand, side: number): void {
    const line = A_CX + side * A_R;
    // Past where the deepest wedge can reach, so it is a ledge and not the
    // last course of the jamb: this is the stone that says where the curve
    // begins, and a mason who can lay nothing else lays this one square.
    const deep = A_R * 0.48;
    const x = side < 0 ? line - deep : line - OVER;
    const pts = stone(g, x, A_CY - 3, deep + OVER, IMPOST_H + 3, R, 'dress', 'laid', (R() - 0.5) * 0.015);
    wearOne(g, pts, R);
  }

  /**
   * The stone of the opening, jamb, impost and ring alike.
   *
   * All of it is stone that was picked over rather than picked up, so it runs
   * warmer than the field it is set in and the eye reads the whole doorway as
   * one piece of work instead of as a hole with a fringe.
   */
  const pickDressed = (R: Rand): string => {
    const t = R();
    // On a bond both of the odd ones are the cut stone's own, so the only
    // question a voussoir asks is which of the dressings' tones it takes.
    return S.lay === 'bond' ? (t < 0.3 ? 'plinth' : 'dress') : t < 0.18 ? 'green' : t < 0.28 ? 'dark' : 'dress';
  };

  /** The ring: wedges of no two depths, on joints that are not quite radial. */
  function voussoirs(g: Ctx, R: Rand): void {
    // Odd, so one stone caps the crown rather than a joint splitting it.
    const n = 9 + 2 * Math.floor(R() * 2);
    const cut: number[] = [];
    /*
     * A joint wanders by up to a quarter of a wedge either way, and no
     * further. Loose enough that no two wedges are the same width; tight
     * enough that none of them comes out a splinter, and that two joints
     * never cross -- a ring with a crossed joint is not a rough ring, it is a
     * ring that has fallen down.
     */
    for (let i = 0; i <= n; i++) cut.push(i / n + (i > 0 && i < n ? (R() - 0.5) * 0.36 / n : 0));
    const crown = (n - 1) / 2;
    /*
     * And the crown stone is the big one.
     *
     * It was the last wedge in, jammed against a ring that was already
     * standing, so it is the one he chose a lump for: half again the width of
     * its neighbours and reaching a good deal further out. It is also the
     * stone the eye goes to on an arch, and when the widest stone in the ring
     * was over at two o'clock the ring had no top.
     */
    cut[crown] -= 0.35 / n;
    cut[crown + 1] += 0.35 / n;
    /*
     * How far past the curve each joint reaches, and how far off true it
     * leans. The depth is held under half the radius because the crown of the
     * ring has to stay below the band: the extrados there is the springing
     * less the radius and its depth, and the band starts an eighth of the way
     * down the section.
     */
    const out = cut.map(() => 0.25 + R() * 0.11);
    const lean = cut.map(() => (R() - 0.5) * 0.10);
    /** A point on the ring: `c` along the half circle, `r` out from the curve. */
    const pt = (c: number, ln: number, r: number): Pt => {
      const a = Math.PI * (1 + c) + ln * r;
      return [A_CX + Math.cos(a) * A_R * (1 + r), A_CY + Math.sin(a) * A_R * (1 + r)];
    };
    const at = (j: number, r: number): Pt => pt(cut[j], lean[j], r);
    /*
     * The joint between one wedge and the next: shut at the face and open at
     * the back, which is what a joint cut by eye does. Taking it off the outer
     * corners only leaves the intrados solid stone the whole way round -- a
     * gap there shows as mortar on the line the compass struck, and a ring of
     * crescents round the opening is worse than no ring.
     */
    const GAP = 0.005;
    /*
     * First the pocket: the mortar behind the ring.
     *
     * The field was laid before anybody thought about a doorway, and the way
     * through was made by breaking stone out of it. What is left round the
     * ring is a ragged line of mortar and chips, a few pixels of it here and
     * a finger's width there, and it is the one thing that tells the eye at a
     * distance that there is a ring at all: without it the wedges are pale
     * stone butting pale stone, and at a hundred yards the arch is a hole.
     *
     * It is drawn out to a little past where the deepest wedge will reach and
     * in past the curve, so the wedges bury all of it but the ragged edge and
     * the cut takes the rest.
     */
    const lip = (j: number): number => out[j] + (j === crown || j === crown + 1 ? 0.09 : 0);
    const foot = A_CY - 1;
    const hem: Pt[] = [[A_CX - A_R * (1 + lip(0)), foot]];
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < 3; k++) {
        const u = k / 3;
        const a = Math.PI * (1 + cut[j] + (cut[j + 1] - cut[j]) * u);
        // Flush with the wedges two thirds of the way round and a bite of
        // mortar the rest, so what shows is a broken line and not a rim.
        const r = lip(j) + (lip(j + 1) - lip(j)) * u + (R() < 0.38 ? 0.02 + R() * 0.05 : -0.004);
        hem.push([A_CX + Math.cos(a) * A_R * (1 + r), A_CY + Math.sin(a) * A_R * (1 + r)]);
      }
    }
    hem.push([A_CX + A_R * (1 + lip(n)), foot]);
    hem.push([A_CX + A_R * 0.93, foot]);
    for (let j = n; j >= 0; j--) hem.push(at(j, -0.06));
    hem.push([A_CX - A_R * 0.93, foot]);
    g.beginPath();
    g.moveTo(hem[0][0], hem[0][1]);
    for (const q of hem) g.lineTo(q[0], q[1]);
    g.closePath();
    g.fillStyle = PASTEL.ringJoint; g.fill();
    for (let i = 0; i < n; i++) {
      const deep = (j: number): number => out[j] + (i === crown ? 0.09 : 0);
      // The inner pair sit well inside the opening, so the cut is what shapes
      // them; the outer pair come in by the joint.
      const wedge: Pt[] = [
        at(i, -0.12), at(i + 1, -0.12),
        pt(cut[i + 1] - GAP, lean[i + 1], deep(i + 1)), pt(cut[i] + GAP, lean[i], deep(i)),
      ];
      const pts = roughen(wedge, R, 3, 2.2);
      dressed(g, pts, i === crown ? 'dress' : pickDressed(R));
      // Not the crown: two or three pits at the top of an arch are two eyes
      // and a nose, and the top of an arch is where the eye lands.
      if (i !== crown) wearOne(g, pts, R);
      else if (R() < 0.5) crack(g, bbox(pts), R);
    }
    /*
     * And the chips: what was jammed into the gaps when the broken field
     * would not meet the ring. They are the evidence that the wall was opened
     * rather than built with a hole in it, and they cost nothing.
     */
    for (let j = 0; j <= n; j++) {
      // Not at the crown: anything standing over the keystone is a chimney.
      if (R() > 0.45 || j === crown || j === crown + 1) continue;
      const w = 7 + R() * 5, h = w * (0.6 + 0.3 * R());
      const [cx, cy] = at(j, lip(j) + 0.012 + R() * 0.025);
      wearOne(g, stone(g, cx - w / 2, cy - h / 2, w, h, R, R() < 0.35 ? 'dark' : 'dress', 'laid', (R() - 0.5) * 0.6), R);
    }
  }

  /* ---- the window --------------------------------------------------------- */
  /*
   * A hole with something over it.
   *
   * An archway carries itself: the ring is the thing that stands up. A window
   * does not, and a novice's answer to that is always the same one -- a lintel
   * big enough to bridge the gap, and over the lintel a course of small wedges
   * on a flat curve to take the weight of the wall off it. That relieving arch
   * is the whole character of the asset: it is the piece of the wall that
   * exists only because he knew the lintel would crack if he did not put it
   * there, and it is set with the same hammer and the same want of skill as
   * everything else.
   *
   * Drawn in the order it was built and cut last, like the arch: sill, jambs,
   * lintel, relieving arch, then the rectangle taken out of the lot of them.
   * The opening is square to a hair and nothing round it is.
   */
  const W_X0 = TW * WINDOW.t0, W_X1 = TW * WINDOW.t1;
  const W_HEAD = TH * (1 - WINDOW.k1), W_SILL = TH * (1 - WINDOW.k0);
  const Y_X0 = TW * BAY.t0, Y_X1 = TW * BAY.t1;
  const Y_HEAD = TH * (1 - BAY.k1), Y_SILL = TH * (1 - BAY.k0);
  /** How deep the lintel is. */
  const LINTEL = 22;
  /** Where the top of it sits under a given head. */
  const lintelTop = (head: number): number => head - LINTEL + 3;

  /** The mortar the field was broken out for, ragged all round and buried by what goes over it. */
  function winPocket(g: Ctx, R: Rand, x0: number, x1: number, top: number, sill: number): void {
    const box: Pt[] = [[x0 - 24, top], [x1 + 24, top], [x1 + 24, sill + 26], [x0 - 24, sill + 26]];
    shape(g, roughen(box, R, 6, 4.5));
    g.fillStyle = PASTEL.ringJoint;
    g.fill();
  }

  /**
   * A column of stone up one side of the opening, built from the sill and
   * overhanging into it. `wide` is how big a stone he could spare for it: a
   * window gets the long ones, a bay the short ones, because a bay is already
   * most of the section across and a long jamb stone would reach the courses
   * that straddle the seam.
   */
  function winJamb(g: Ctx, R: Rand, side: number, x0: number, x1: number, head: number, sill: number, wide: number): void {
    const line = side < 0 ? x0 : x1;
    let y = sill - 2, course = side < 0 ? 0 : 1;
    while (y > head - 4) {
      const h = 34 + R() * 20;
      const w = (course++ % 2 ? wide * 0.68 : wide) + R() * 14;
      const x = side < 0 ? line + OVER - w : line - OVER;
      wearOne(g, stone(g, x, y - h, w, h, R, pickDressed(R), 'laid', (R() - 0.5) * 0.03), R);
      y -= h + MORTAR + R() * 3;
    }
  }

  /**
   * The relieving arch: a flat curve of small wedges over the lintel.
   *
   * Its rise is a tenth of its span, which is what makes it look like work
   * rather than ornament -- it is there to throw the load out to the jambs,
   * and a mason who wanted it to look like an arch would have given it more.
   */
  function relieving(g: Ctx, R: Rand, x0: number, x1: number, head: number): void {
    const half = (x1 - x0) / 2 + 20, cx = (x0 + x1) / 2;
    const rise = 15 + R() * 7;
    const rad = (half * half + rise * rise) / (2 * rise);
    const cy = lintelTop(head) + rad - rise;
    const a0 = Math.asin(Math.min(1, half / rad));
    // Five or seven, so the stones are lumps rather than tally marks, and odd
    // so one of them caps the middle.
    const n = 5 + 2 * Math.floor(R() * 2);
    const cut: number[] = [];
    for (let i = 0; i <= n; i++) cut.push(-a0 + (2 * a0 * i) / n + (i > 0 && i < n ? (R() - 0.5) * 0.36 * (2 * a0) / n : 0));
    const crown = (n - 1) / 2;
    cut[crown] -= 0.35 * (2 * a0) / n;
    cut[crown + 1] += 0.35 * (2 * a0) / n;
    // In pixels rather than in radii: the flatter the curve the longer the
    // radius, and a depth taken as a fraction of it would put the crown of a
    // shallow one through the band.
    const out = cut.map(() => (17 + R() * 7) / rad);
    const pt = (a: number, r: number): Pt => [cx + Math.sin(a) * rad * (1 + r), cy - Math.cos(a) * rad * (1 + r)];
    // The joint is shut at the face and open at the back, as on the ring.
    const gap = 0.16 * (2 * a0) / n;
    for (let i = 0; i < n; i++) {
      const deep = (j: number): number => out[j] + (i === crown ? 0.02 : 0);
      const wedge: Pt[] = [
        pt(cut[i], -0.03), pt(cut[i + 1], -0.03),
        pt(cut[i + 1] - gap, deep(i + 1)), pt(cut[i] + gap, deep(i)),
      ];
      const pts = roughen(wedge, R, 3, 1.8);
      dressed(g, pts, i === crown ? 'dress' : pickDressed(R));
      if (i !== crown) wearOne(g, pts, R);
    }
  }

  /**
   * Sill, jambs, lintel and the wedges over it, in the order they went up.
   *
   * `shelf` is how far the sill stands proud and how deep it is. A window's
   * is a sill and a bay's is a shelf, because a bay is a box of glass standing
   * on it, and a stone that is only a sill under a bay is a stone that comes
   * out of the wall one winter with the bay on top of it.
   */
  /**
   * The edge of an opening in a coat of mud, which is not an edge: the coat
   * is rolled into the hole by the hand that laid it, so round every opening
   * there is an arris that turns up toward the sky along the sill and down
   * away from it along the head. The hole's own outline, pushed down, lies
   * outside it along the bottom -- the lit side -- and pushed up, along the
   * top, in the shade. Up and down only: a picture laid the other way round
   * on the far face of a corner is still lit from above.
   */
  function rollRim(g: Ctx, hole: (c: Ctx) => void): void {
    g.save();
    g.beginPath(); g.rect(-60, -60, TW + 120, TH + 120); hole(g); g.clip('evenodd');
    g.save(); g.translate(0, 6); g.beginPath(); hole(g); g.fillStyle = hexA(PASTEL.stoneHi, 0.9); g.fill(); g.restore();
    g.save(); g.translate(0, -6); g.beginPath(); hole(g); g.fillStyle = hexA(PASTEL.stoneShade, 0.8); g.fill(); g.restore();
    g.restore();
  }
  /** A rectangle with its corners rounded off, added to the path that is open. */
  function softRect(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }
  /** The shade a board throws on the coat under it, cool, as every shadow here is. */
  function shadeUnder(g: Ctx, x0: number, x1: number, y: number, deep: number): void {
    const sh = g.createLinearGradient(0, y, 0, y + deep);
    sh.addColorStop(0, 'rgba(46, 34, 62, 0.4)');
    sh.addColorStop(1, 'rgba(46, 34, 62, 0)');
    g.fillStyle = sh;
    g.fillRect(x0 + 3, y, x1 - x0 - 6, deep);
  }
  /**
   * A window in a coat of mud: the coat rolled into it, a length of timber
   * over it run well into the wall either side, and a board under it for a
   * sill. And where the wall has moved, a crack from each end of the lintel,
   * because that is where an adobe wall always cracks first.
   */
  function renderSurround(g: Ctx, R: Rand, x0: number, x1: number, head: number, sill: number, shelf: number): void {
    rollRim(g, (c) => softRect(c, x0, head, x1 - x0, sill - head, 7));
    baulk(g, R, x0 - 28, x1 + 28, head - 22, 22);
    shadeUnder(g, x0 - 28, x1 + 28, head, 7);
    baulk(g, R, x0 - 14 - shelf, x1 + 14 + shelf, sill - 3, 11 + shelf * 0.6);
    shadeUnder(g, x0 - 14 - shelf, x1 + 14 + shelf, sill + 8 + shelf * 0.6, 10);
    if (R() < 0.7) fissure(g, x1 + 24, head - 22, 26 + R() * 30, R, -1);
    if (R() < 0.45) fissure(g, x0 - 24, head - 22, 20 + R() * 26, R, -1);
    if (R() < 0.5) fissure(g, x0 - 8 + R() * 16, sill + 12 + shelf, 26 + R() * 30, R);
  }
  /**
   * A doorway in it: the same, with the lintel over the way in. A gate is the
   * doorway twice as wide, and its lintel sits on a short timber on each
   * jamb -- the corbel a stone gate has, in wood.
   */
  function renderDoorway(g: Ctx, R: Rand, x0: number, x1: number, head: number, deep: number, reach: number): void {
    rollRim(g, (c) => softRect(c, x0, head, x1 - x0, TH - head + 30, 7));
    const bTop = head - (reach ? CORBEL_H : 0) - deep + 3;
    if (reach) {
      for (const side of [-1, 1]) {
        const a = side < 0 ? x0 - 14 : x1 - reach + 2;
        baulk(g, R, a, a + reach + 12, head - CORBEL_H, CORBEL_H);
      }
    }
    baulk(g, R, x0 - 28 + reach * 0.8, x1 + 28 - reach * 0.8, bTop, deep);
    shadeUnder(g, x0 - 28 + reach * 0.8, x1 + 28 - reach * 0.8, bTop + deep, 8);
    if (R() < 0.7) fissure(g, x1 + 24 - reach * 0.8, bTop, 24 + R() * 30, R, -1);
    if (R() < 0.45) fissure(g, x0 - 24 + reach * 0.8, bTop, 20 + R() * 26, R, -1);
  }
  /** An archway in it: the coat rolled round the curve, and a crack off the crown. */
  function renderArch(g: Ctx, R: Rand): void {
    rollRim(g, (c) => {
      c.moveTo(A_CX - A_R, TH + 30);
      c.lineTo(A_CX - A_R, A_CY);
      c.arc(A_CX, A_CY, A_R, Math.PI, Math.PI * 2);
      c.lineTo(A_CX + A_R, TH + 30);
      c.closePath();
    });
    if (R() < 0.7) fissure(g, A_CX + (R() - 0.5) * A_R * 0.8, A_CY - A_R - 4, 26 + R() * 24, R, -1);
  }
  function surround(g: Ctx, R: Rand, x0: number, x1: number, head: number, sill: number, wide: number, shelf: number): void {
    if (S.lay === 'render') { renderSurround(g, R, x0, x1, head, sill, shelf); return; }
    if (S.lay === 'frame') { frameSurround(g, R, x0, x1, head, sill, shelf); return; }
    const top = lintelTop(head);
    winPocket(g, R, x0, x1, top - 46, sill);
    // The sill first, because everything either side of the hole stands on it.
    wearOne(g, stone(g, x0 - 16 - shelf, sill - 4, x1 - x0 + 32 + shelf * 2, 24 + shelf, R, 'dress', 'laid', (R() - 0.5) * 0.012), R);
    if (S.lay === 'bond') {
      // A sill on brick is cut stone standing out to throw the rain clear,
      // and it throws a shade on the brick below it as the band does.
      const sx = x0 - 16 - shelf, sw = x1 - x0 + 32 + shelf * 2, sy = sill + 20 + shelf;
      const sh = g.createLinearGradient(0, sy, 0, sy + 9);
      sh.addColorStop(0, 'rgba(40, 32, 62, 0.42)');
      sh.addColorStop(1, 'rgba(40, 32, 62, 0)');
      g.fillStyle = sh;
      g.fillRect(sx + 3, sy, sw - 6, 9);
      // Rain stands on a sill as it does on a plinth, and moss comes after it.
      if (S.growth && R() < 0.6) {
        const w = sw * (0.3 + 0.3 * R());
        mossLens(g, { x: sx + (sw - w) * R(), y: sill - 4, w, h: 20, course: 0, pts: [] }, sill - 2, R);
      }
    }
    winJamb(g, R, -1, x0, x1, head, sill, wide);
    winJamb(g, R, 1, x0, x1, head, sill, wide);
    relieving(g, R, x0, x1, head);
    // And the lintel over the jambs, under the wedges: one lump if he was
    // lucky with the quarry, two meeting over the middle if he was not.
    if (R() < 0.42 && x1 - x0 < 250) {
      wearOne(g, stone(g, x0 - 18, top, x1 - x0 + 36, LINTEL, R, 'dress', 'laid', (R() - 0.5) * 0.008), R);
    } else {
      const mid = (x0 + x1) / 2 + (R() - 0.5) * 30;
      wearOne(g, stone(g, x0 - 18, top, mid - x0 + 18, LINTEL, R, 'dress', 'laid', (R() - 0.5) * 0.01), R);
      wearOne(g, stone(g, mid, top, x1 + 18 - mid, LINTEL, R, 'dress', 'laid', (R() - 0.5) * 0.01), R);
    }
  }

  /* ---- the doorway -------------------------------------------------------- */
  /*
   * The one opening he did not solve with stone.
   *
   * A window gets a lintel and a course of wedges over it because a window is
   * small. An archway gets a ring because a ring is the thing that stands up.
   * A doorway is a metre and a third across with two and a quarter metres of
   * wall over it, and a man who cannot cut a voussoir is not going to find and
   * dress a stone four feet long either. So he lays a baulk of oak across it
   * and builds on top of that, and the only piece of the wall that is not
   * stone is the piece holding up the most of it.
   *
   * Under the ends of it, where the load comes down, the jamb goes long and
   * short about -- an upright the height of two courses, then a flat one, then
   * an upright -- which is what a rough mason does when he wants a corner to
   * stay where he put it and cannot cut a quoin.
   */
  const D_X0 = TW * DOOR.t0, D_X1 = TW * DOOR.t1;
  const D_HEAD = TH * (1 - DOOR.k1);
  const V_X0 = TW * DOUBLE.t0, V_X1 = TW * DOUBLE.t1;
  const V_HEAD = TH * (1 - DOUBLE.k1);
  /** How deep the beam over a doorway is, and how deep the one over a gate. */
  const BEAM = 25, GATE_BEAM = 30;
  /** How far a corbel reaches in under the end of a gate's beam. */
  const CORBEL = 42, CORBEL_H = 22;

  /** The jamb: long and short about, from under the beam to the ground. */
  function doorJamb(g: Ctx, R: Rand, side: number, x0: number, x1: number, head: number): void {
    const line = side < 0 ? x0 : x1;
    let y = head + 1, tall = true;
    while (y < TH + 20) {
      const h = tall ? 70 + R() * 24 : 26 + R() * 12;
      const w = (tall ? 44 : 62) + R() * 14;
      const x = side < 0 ? line + OVER - w : line - OVER;
      wearOne(g, stone(g, x, y, w, h, R, pickDressed(R), 'laid', (R() - 0.5) * 0.022), R);
      y += h + MORTAR + R() * 3;
      tall = !tall;
    }
  }

  /**
   * The beam: a squared baulk with the saw still on it, bedded a hand into the
   * wall at each end and sagging the width of a finger in the middle, because
   * it has been carrying a storey of rubble for some years.
   */
  function baulk(g: Ctx, R: Rand, x0: number, x1: number, bTop: number, deep: number): void {
    const sag = 2.5 + R() * 2.5;
    const top = (t: number): number => bTop + Math.sin(Math.PI * t) * sag;
    const pts: Pt[] = [];
    for (let i = 0; i <= 8; i++) pts.push([x0 + (x1 - x0) * (i / 8), top(i / 8) + (R() - 0.5) * 1.2]);
    for (let i = 8; i >= 0; i--) pts.push([x0 + (x1 - x0) * (i / 8), top(i / 8) + deep + (R() - 0.5) * 1.2]);
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (const q of pts) g.lineTo(q[0], q[1]);
    g.closePath();
    g.fillStyle = PASTEL.beamShade;
    g.fill();
    g.save(); g.clip();
    g.translate(-2, -3.5);
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (const q of pts) g.lineTo(q[0], q[1]);
    g.closePath();
    g.fillStyle = PASTEL.beam;
    g.fill();
    // The grain: two or three long lines that wander the way a sawn face does.
    g.strokeStyle = hexA(PASTEL.beamLine, 0.35);
    g.lineWidth = 1.2;
    for (let k = 0; k < 2 + Math.floor(R() * 2); k++) {
      const off = deep * (0.25 + 0.5 * R());
      g.beginPath();
      for (let i = 0; i <= 8; i++) {
        const t = i / 8, x = x0 + (x1 - x0) * t, y = top(t) + off + Math.sin(t * 7 + k) * 1.6;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.restore();
    // The lit edge along the top, and the line round the whole of it.
    g.strokeStyle = hexA(PASTEL.beamHi, 0.75);
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= 8; i++) { const t = i / 8, x = x0 + (x1 - x0) * t; if (i === 0) g.moveTo(x, top(t) + 1.4); else g.lineTo(x, top(t) + 1.4); }
    g.stroke();
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (const q of pts) g.lineTo(q[0], q[1]);
    g.closePath();
    g.strokeStyle = PASTEL.beamLine;
    g.lineWidth = 2.4;
    g.lineJoin = 'round';
    g.stroke();
  }

  /**
   * Pocket, jambs, corbels, beam: the order a doorway goes up in.
   *
   * `reach` is how far a corbel comes in under the end of the beam, and it is
   * nought for a doorway and a hand's breadth for a gate. That is the whole
   * difference between the two, and it is the right one: the beam over a
   * doorway spans the doorway, and the beam over a gate would not, so the
   * last course either side steps out to meet it and shortens what the timber
   * has to carry. It sits above the head of the opening, which is why the cut
   * leaves it and takes everything under it.
   */
  function doorway(g: Ctx, R: Rand, x0: number, x1: number, head: number, deep: number, reach: number): void {
    if (S.lay === 'render') { renderDoorway(g, R, x0, x1, head, deep, reach); return; }
    if (S.lay === 'frame') { frameDoorway(g, R, x0, x1, head, deep, reach); return; }
    const bTop = head - (reach ? CORBEL_H : 0) - deep + 3;
    const box: Pt[] = [[x0 - 26, bTop - 10], [x1 + 26, bTop - 10], [x1 + 26, TH + 8], [x0 - 26, TH + 8]];
    shape(g, roughen(box, R, 6, 4.5));
    g.fillStyle = PASTEL.ringJoint;
    g.fill();
    doorJamb(g, R, -1, x0, x1, head);
    doorJamb(g, R, 1, x0, x1, head);
    if (reach) {
      for (const side of [-1, 1]) {
        const line = side < 0 ? x0 : x1;
        const a = side < 0 ? line - 20 : line - reach;
        wearOne(g, stone(g, a, head - CORBEL_H, reach + 20, CORBEL_H + 3, R, 'dress', 'laid', (R() - 0.5) * 0.01), R);
      }
    }
    baulk(g, R, x0 - 22 + reach * 0.8, x1 + 22 - reach * 0.8, bTop, deep);
  }

  /* ---- what grows in a way through --------------------------------------- */
  /**
   * Growth does not stop at a doorway.
   *
   * The first arch clipped every green thing to the stone, so the ivy that had
   * got over the top of the section was sliced off along the curve and the
   * hedge at the foot stopped dead at the jamb, both on a line nothing in the
   * picture explains. But a plant does not know there is an opening. It grows
   * down the face and dangles in the gap; it grows round the jamb and into the
   * reveal; and where a wall has been broken through, the seed gets in and
   * there is grass standing in the way.
   *
   * These two layers are painted per variant off that variant's own drapes and
   * hedges, so a tongue over an opening hangs from ivy that is really there
   * and no two archways are overgrown the same. The variant with nothing over
   * its top gets no tongue; the one with the widest hedge gets it across the
   * threshold.
   */

  /** Lobes for a curtain hanging at `cx` from `y0`, `w` half-wide, fraying as it falls. */
  function tongueLobes(cs: Lobe[], cx: number, y0: number, w: number, len: number, R: Rand): void {
    const r0 = 8.5;
    for (let y = y0; y < y0 + len; y += r0 * 1.1) {
      const t = (y - y0) / len;
      const hw = Math.max(r0 * 0.5, w * (1 - 0.62 * t) * (0.9 + 0.2 * R()));
      row(cs, cx - hw + (R() - 0.5) * r0 * 0.4, cx + hw, y, r0 * (0.95 - 0.3 * t), R, 1.3, t > 0.2 ? 0.32 : 0, (x) => x);
    }
  }

  /**
   * Grass out of a joint: a fan of blades from one root.
   *
   * The turf at the foot of a wall was tussocks, and a tussock is built of the
   * same round lobes as the hedge standing next to it -- one plant language
   * used twice, which reads as two sizes of the same bush rather than as grass
   * against a shrub. The tall wall works because its hanging ivy and its foot
   * hedge do not look alike.
   *
   * Grass has no lobes. It has blades: wide at the root, bending further over
   * the further out they are fanned, and thinner every pixel until they stop.
   * The outermost are drawn first and in the deeper green, so a clump has a
   * back and a front.
   */
  function blades(g: Ctx, x: number, base: number, w: number, h: number, R: Rand, tone = 0): void {
    // Paler, the wall's own green, or deeper, so no two clumps along a run
    // are the same colour.
    const ink = tone > 0
      ? [PASTEL.leafDeep, VEG.lit, PASTEL.leafPale]
      : tone < 0
        ? [PASTEL.leafLine, PASTEL.leafDeep, VEG.shade]
        : [VEG.shade, VEG.lit, VEG.top];
    const n = 5 + Math.floor(R() * 5);
    const fan: Array<[number, number, number, number]> = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const a = (t - 0.5) * 1.35 + (R() - 0.5) * 0.3;
      // The ones leaning furthest out stand shortest, which is what stops a
      // fan from being a semicircle.
      fan.push([a, h * (0.6 + 0.4 * Math.cos(a)) * (0.78 + R() * 0.3), x + (R() - 0.5) * w * 0.6, 1.3 + R() * 1.3]);
    }
    fan.sort((p, q) => Math.abs(q[0]) - Math.abs(p[0]));
    g.save();
    g.lineJoin = 'round';
    for (let i = 0; i < fan.length; i++) {
      const [a, len, rx, bw] = fan[i];
      const sa = Math.sin(a), ca = Math.cos(a);
      // it keeps bending the way it started, so the tip is further out than the lean alone
      const tipX = rx + sa * len * 1.28, tipY = base - ca * len;
      const midX = rx + sa * len * 0.46, midY = base - ca * len * 0.62;
      g.beginPath();
      g.moveTo(rx - ca * bw, base - sa * bw);
      g.quadraticCurveTo(midX - ca * bw * 0.55, midY - sa * bw * 0.55, tipX, tipY);
      g.quadraticCurveTo(midX + ca * bw * 0.55, midY + sa * bw * 0.55, rx + ca * bw, base + sa * bw);
      g.closePath();
      const t = i / Math.max(1, fan.length - 1);
      g.fillStyle = t < 0.45 ? ink[0] : t < 0.88 ? ink[1] : ink[2];
      g.fill();
      g.strokeStyle = VEG.line; g.lineWidth = 0.9; g.stroke();
    }
    g.restore();
  }

  /** A low mound of growth standing on `base`, `w` by `h`, wherever it is rooted. */
  function tussock(g: Ctx, x: number, base: number, w: number, h: number, R: Rand): void {
    const cs: Lobe[] = [], r = 5.5 + h * 0.08;
    for (let y = base - h + r; y <= base + r; y += r * 1.2) {
      const t = (base - y) / h;
      const hw = (w / 2) * (t > 0.25 ? 1 - 0.55 * Math.pow((t - 0.25) / 0.75, 1.3) : 1) * (0.9 + 0.2 * R());
      row(cs, x - hw, x + hw, y, r * (0.9 + 0.2 * R()), R, 1.3, t > 0.35 ? 0.35 : 0, (q) => q);
    }
    g.save(); g.beginPath(); g.rect(0, 0, TW, TH - 2); g.clip();
    shadowOf(g, cs, 5, 4);
    mass(g, cs, R, { r, lobe: R() < 0.4 ? 1 : 0 });
    g.restore();
  }

  /* ---- the low wall ------------------------------------------------------- */
  /**
   * A field wall, which is not a house wall cut off at the knees.
   *
   * A fence section is 1.26 m tall against the wall's three, so blitting the
   * wall's picture into it squashed every stone by two and a half and put the
   * band course -- which is the string course at a floor line -- along the top
   * of something that has no floors. What a wall that height actually gets is
   * a coping: a run of stones set on edge along the top, laid last and laid
   * dry, which is the thing that stops the rain getting into the heart of it
   * and the thing that makes a field wall look like a field wall from a
   * hundred yards.
   *
   * It is painted at whatever height the wall type asks for -- a fence, a
   * fence gate and an iron-bound gate are three different heights -- and the
   * number of courses under the coping comes out of the room left over, so
   * the stones are the same size in all of them.
   */
  /**
   * How deep the coping is, how deep the levelling course under it is, and
   * the spread of a cope stone's width.
   *
   * The spread is the point. The first coping was twenty stones of one width
   * with one joint between each pair, and twenty of anything at one width is
   * a comb: it read as a picket fence laid on a wall, which is what got the
   * whole asset called sloppy. A dry cope is what came to hand -- a lump, a
   * lump, a packer wedged in sideways because the two lumps did not meet --
   * and the widths have to say that.
   */
  /*
   * A fifth of the wall, not a third. A coping is the course that finishes a
   * wall, not a storey of its own: at 42 of 161 it was more than a third of
   * the height and the fence read as two walls, a striped one on a plain one.
   */
  const COPE = 46, LEVEL = 12;
  /*
   * How wide a cope stone is, and how far the tops of them vary.
   *
   * A comber is not a tile. It is a stone off the same heap as the wall,
   * stood on edge, and it is comparable in bulk to the stones under it -- at
   * a mean of 22 px against a body stone's 85 it was one to four, which is
   * the ratio of a brick to a block, and the run of them read as a soldier
   * course of brick laid on rubble.
   *
   * `COPE_RISE` is the whole answer to the word sloppy. Every stone had its
   * top at exactly y = 0: four metres of hand-laid dry coping without one
   * stone standing a pixel proud of its neighbour. A machined edge on a thing
   * that is meant to have been laid by eye reads as unfinished, not as neat.
   *
   * And the stones are on edge, which is the whole idea and was the last
   * thing to arrive. At 33 deep and 30 wide every comber came out a loaf
   * lying down -- eleven of twelve wider than tall -- which is a course of
   * small brick, not a cope. A comber is a thin stone stood up, and these
   * are: `COPE` deep against a mean width of `COPE_MEAN`.
   *
   * `PROUD` is the room above the wall the picture is given so that the ones
   * standing over the run have somewhere to be drawn. Without it a stone can
   * only ever sit lower than its neighbours -- twenty-two centimetres of
   * hand-laid variation inside the band and not one pixel of it reaching the
   * sky, so the wall's outline stayed a ruled line and the proud stones read
   * as notches cut into a sawn edge.
   */
  const COPE_MIN = 8, COPE_MEAN = 19, COPE_RISE = 16, PROUD = 10;
  /*
   * And the weight of line it is drawn with. At the body's 2.4 px the coping
   * carried twice the ink per unit area of the wall under it -- a quarter of
   * the band was outline -- so from any distance it was a dark busy stripe
   * rather than stone.
   */
  const COPE_INK = 1.1;
  /** The one cope stone that straddles a seam, drawn the same in every variant. */
  const COPE_SEAM: Pt = [-14, 17];
  /*
   * And the same on a bond, where the cope is dressed stone in lengths. A
   * straddler the width of a comber between two metre-long copes is a stone
   * somebody dropped in the gap; this one is a length like the rest.
   */
  const CSEAM: Pt = S.lay === 'bond' ? [-46, 52] : COPE_SEAM;
  /** And the courses of the body that straddle it, as `STRADDLE` does in the tall wall. */
  const LOW_STRADDLE: Record<number, [number, number]> = { 0: [-52, 46], 1: [-38, 62] };
  const LOW_TONE: Record<number, string> = { 0: '', 1: 'brown' };
  /** The levelling course straddles too, on a span of its own so the joints stagger. */
  const LEVEL_SEAM: Pt = [-30, 34];

  /**
   * A tone for a stone of a field wall, which carries more colour than a house
   * wall because nobody picked it over: one in five with the weather in it,
   * one in eight bleached, and the rest off the wall's own four.
   */
  function fieldTone(R: Rand): string {
    let t = R();
    for (const [name, share] of S.field) { if (t < share) return name; t -= share; }
    return '';
  }
  /** The seed a variant's coping is laid from: its widths and its tones, face and top alike. */
  const copeSeed = (v: number): number => v * 911 + 7;

  /**
   * The widths of a coping, from a seed of their own.
   *
   * The same at every height and, within a variant, the same on the face of
   * the coping and on the top of it, because those are two pictures of the
   * same stones and they have to line up along the whole run. Across variants
   * they differ: one run of widths for all five repeated exactly every four
   * metres, which along a field boundary is the comb again at a larger scale.
   * The two seam stones stay fixed, because those are what butt.
   *
   * One in five is a packer less than half the mean, which is what breaks it.
   */
  function copeWidths(seed: number): number[] {
    const R = rand(seed), L = TW + CSEAM[0] - CSEAM[1];
    if (S.lay === 'bond') {
      // Four lengths across what the straddler leaves, cut to what the quarry
      // gave rather than to a rule: a metre, give or take a hand.
      const ws: number[] = []; let sum = 0;
      for (let k = 0; k < 4; k++) { const w = 0.82 + R() * 0.36; ws.push(w); sum += w; }
      return ws.map((w) => (w / sum) * L);
    }
    const n = Math.max(2, Math.round(L / COPE_MEAN));
    const ws: number[] = []; let sum = 0;
    for (let k = 0; k < n; k++) { const w = R() < 0.22 ? 0.42 + R() * 0.16 : 0.85 + R() * 0.8; ws.push(w); sum += w; }
    return ws.map((w) => (w / sum) * L);
  }

  /** Their tones, drawn up front so the face and the top take them in step. */
  function copeTones(seed: number, n: number): string[] {
    const R = rand(seed + 41);
    // A brick wall's coping is cut stone, like every other dressing on it. A
    // dry field wall's is whatever came off the same heap as the rest of it.
    if (S.lay === 'bond') return Array.from({ length: n }, () => (R() < 0.32 ? 'plinth' : 'dress'));
    return Array.from({ length: n }, () => fieldTone(R));
  }

  /**
   * One stone of a coping: upright, leaning with its neighbours because a
   * whole cope is laid one way up a wall, and not quite with them because
   * nothing here is laid twice the same.
   */
  function copeStone(g: Ctx, x: number, w: number, R: Rand, tone: string, tip: number): void {
    if (S.lay === 'bond') {
      /*
       * Dressed, and bedded level. A length of cut cope is laid to a line
       * like the brick under it; what it has of the hand is a pixel or two of
       * settling and the arris knocked here and there, not a stone stood on
       * end in the run.
       */
      const rise = 1 + R() * 3;
      const pts = stone(g, x + MORTAR / 2, rise, w - MORTAR, COPE - MORTAR / 2 - rise, R, tone, 'unit', (R() - 0.5) * 0.01, 1.6);
      // Its top, turned at the sky and a step lighter than its face.
      g.save(); shape(g, pts); g.clip();
      const lit = g.createLinearGradient(0, rise, 0, rise + 9);
      lit.addColorStop(0, hexA(PASTEL.dressHi, 0.6));
      lit.addColorStop(1, hexA(PASTEL.dressHi, 0));
      g.fillStyle = lit;
      g.fillRect(x, rise, w, 9);
      g.restore();
      return;
    }
    const packer = w < COPE_MIN * 1.6;
    /*
     * How proud this one stands, and it is the point of the whole function.
     * A cope is laid off the ground by eye: a stone is as tall as it is and
     * the man puts it in. So one in six is a big one left standing over the
     * run, and a packer -- a stone driven down between two that would not
     * meet -- sits low, because that is what driving it down means.
     *
     * The ones that stand proudest lean least, which is the one liberty taken
     * here: a stone tilted hard at the top of the run would be drawn off the
     * top edge of the picture, and the picture is the wall.
     */
    const rise = packer ? COPE_RISE * (0.55 + R() * 0.45) : R() < 0.19 ? -(3 + R() * 6) : COPE_RISE * (0.2 + R() * 0.8);
    const lean = tip + (R() - 0.5) * (rise > 5 ? 0.3 : 0.1);
    const gap = packer ? 0.8 : MORTAR - 1.8;
    wearOne(g, stone(g, x + gap / 2, rise, Math.max(4, w - gap), COPE - MORTAR / 2 - rise, R, tone, 'laid', lean, COPE_INK), R);
  }

  function coping(g: Ctx, seed: number): void {
    if (S.lay === 'render') { renderCope(g, seed); return; }
    if (S.lay === 'frame') { frameCope(g); return; }
    // Which way the whole run leans, settled once and kept, so a cope reads as
    // one job rather than as a row of stones that fell that way.
    const tip = (rand(431)() - 0.5) * 0.12;
    const w0 = CSEAM[1] - CSEAM[0];
    // The one across the seam is cope like the rest: on a bond that is cut
    // stone, and the field's own tone there is a brick laid on top of it.
    const t0 = S.lay === 'bond' ? 'dress' : '';
    copeStone(g, CSEAM[0], w0, rand(313), t0, tip);
    copeStone(g, TW + CSEAM[0], w0, rand(313), t0, tip);
    const ws = copeWidths(seed), tones = copeTones(seed, ws.length), R = rand(seed + 137);
    let x = CSEAM[1];
    for (let k = 0; k < ws.length; k++) { copeStone(g, x, ws[k], R, tones[k], tip); x += ws[k]; }
    /*
     * And the shadow it throws on the course under it, because a cope
     * oversails: without it the cope is a pattern printed on the wall.
     *
     * Stone by stone, not as one bar across the section. A cope oversails by
     * however much each stone happens to stick out, and a rectangle of even
     * shadow four metres long was one of four ruled lines inside the top
     * third of the wall -- which is what made the top of it read flatter than
     * the bottom at the zoom people play at.
     */
    const SH = rand(seed + 271);
    g.fillStyle = S.lay === 'bond' ? 'rgba(40, 32, 62, 0.38)' : 'rgba(96, 86, 66, 0.26)';
    let sx = CSEAM[0];
    for (const w of [CSEAM[1] - CSEAM[0], ...ws, CSEAM[1] - CSEAM[0]]) {
      g.fillRect(sx, COPE, w + 1, 1.5 + SH() * 5);
      sx += w;
    }
  }

  /**
   * The levelling course: a run of thin flat stones under the coping.
   *
   * It is the thing that makes a wall level enough to cope, and it is also
   * what stops the eye reading the cope as tiles laid on blocks -- two
   * scales with nothing between them is a join, three is a wall.
   *
   * Drawn thinner than anything else in the picture. A stone nine pixels deep
   * with the body's outline on it is nearly half outline, so a course of them
   * came out as a zipper: the course is meant to be the quietest thing on the
   * wall, a line of packing you notice only because the cope sits on it.
   */
  function levelling(g: Ctx, R: Rand): void {
    // A length of cut cope is bedded straight on the top course of brick. The
    // packing under a dry cope is how a field wall makes a level bed out of
    // what it has; brick is already level, so the bond runs up to the cope.
    if (S.lay !== 'rubble') return;
    const J = 2, ink = 0.8, room = LEVEL - J;
    /**
     * One of them. Its depth is what the stone happened to be and it sits
     * where it sits in the bed -- because nine stones all 5.5 px deep with
     * their tops on one line and their bottoms on another is a strip of
     * pills, which is what the first attempt at fixing this produced: the
     * outline came down but every stone was still the same stone.
     */
    const pack = (x: number, w: number, RR: Rand, tone: string): void => {
      const sh = room * (0.52 + 0.48 * RR());
      const sy = COPE + J / 2 + (room - sh) * RR();
      stone(g, x + J / 2, sy, w - J, sh, RR, tone, 'laid', (RR() - 0.5) * 0.12, ink);
    };
    const w0 = LEVEL_SEAM[1] - LEVEL_SEAM[0];
    for (const x of [LEVEL_SEAM[0], TW + LEVEL_SEAM[0]]) pack(x, w0, rand(229), '');
    // Twenty-five centimetres of rubble, not forty-five of lozenge.
    const lo = LEVEL_SEAM[1], hi = TW + LEVEL_SEAM[0], L = hi - lo;
    const n = Math.max(2, Math.round(L / 32));
    const ws: number[] = []; let sum = 0;
    for (let k = 0; k < n; k++) { const w = 0.5 + 1.1 * R(); ws.push(w); sum += w; }
    let x = lo;
    for (let k = 0; k < n; k++) {
      const w = (ws[k] / sum) * L;
      // Weathered and dark for the most part. A bed of packing lies in the
      // shade of the cope that oversails it, and rolling two in five of them
      // bleached turned the quietest course on the wall into a pale stripe.
      pack(x, w, R, R() < 0.2 ? 'weather' : R() < 0.34 ? 'dark' : R() < 0.54 ? 'brown' : '');
      x += w;
    }
  }

  /**
   * The body under them: stones the size the tall wall's are.
   *
   * They were half that, and eight or ten to a course, which read as
   * brickwork -- the one thing a field wall is not. Two courses of five or
   * six, at eighty pixels by fifty, is the same masonry as the house.
   */
  function lowCourses(g: Ctx, R: Rand, fh: number, rows: number): Block[] {
    if (S.lay === 'bond') return lowBond(g, R, fh, rows);
    if (S.lay === 'render') return lowRender(g, R, fh);
    if (S.lay === 'frame') return lowFrame(g, R, fh);
    const top = COPE + LEVEL;
    /*
     * Courses of unequal depth, the deepest at the bottom.
     *
     * Two bands of the same height read as two rows of bricks whatever is in
     * them. They are unequal for the reason they are unequal in any wall
     * built off the ground: the biggest stones go in first because that is
     * where they are easiest to put, and what is left goes on top of them.
     */
    const wts: number[] = [];
    for (let i = 0; i < rows; i++) wts.push(1 + i * 0.32);
    const tot = wts.reduce((a, b) => a + b, 0);
    const own: Block[] = [];
    let y0 = top;
    for (let i = 0; i < rows; i++) {
      const ch = ((fh - top) * wts[i]) / tot;
      const y = y0 + MORTAR / 2, h = ch - MORTAR;
      y0 += ch;
      let lo: number, hi: number;
      const st = LOW_STRADDLE[i];
      if (st) {
        const w = st[1] - st[0] - MORTAR;
        stone(g, TW + st[0] + MORTAR / 2, y, w, h, rand(553 + i), LOW_TONE[i]);
        stone(g, st[0] + MORTAR / 2, y, w, h, rand(553 + i), LOW_TONE[i]);
        lo = st[1]; hi = TW + st[0];
      } else { lo = 0; hi = TW; }
      const L = hi - lo, n = Math.max(2, Math.round(L / (ch * 1.5)) + (R() < 0.35 ? 1 : 0));
      /*
       * One through-stone to the bottom two courses.
       *
       * A dry wall is built as two skins with the small stuff packed between
       * them, and what stops it from being two thin walls leaning on each
       * other is a stone every yard or so long enough to reach from face to
       * face. It shows: it is half again the length of its neighbours and it
       * is darker, because it came out of the ground rather than off the top
       * of the heap. It is in the same place in every variant, because on a
       * real wall you can sight along them.
       */
      const thru = i >= rows - 2 ? Math.floor(rand(97 + i * 13)() * n) : -1;
      const ws: number[] = []; let sum = 0;
      for (let k = 0; k < n; k++) { const w = k === thru ? 2.4 : 0.5 + 1.2 * R(); ws.push(w); sum += w; }
      let x = lo; const run = { tone: '', left: 0 };
      const kw = 1 + Math.floor(R() * 2), aw = ch * 0.06 * (R() < 0.5 ? -1 : 1);
      for (let k = 0; k < n; k++) {
        const w = (ws[k] / sum) * L, mid = x + w / 2;
        const priv = x + MORTAR / 2 > EDGE && x + w - MORTAR / 2 < TW - EDGE;
        const wave = priv ? Math.sin(Math.PI * kw * (mid - EDGE) / (TW - 2 * EDGE)) * aw : 0;
        const drift = (R() - 0.5) * ch * 0.13 + wave, shrink = h * 0.14 * R(), jw = MORTAR + (priv ? R() * 3 : 0);
        // A field wall is built of whatever the field gave up, so it carries
        // more colour than a house wall the mason picked stone for.
        const tone = k === thru ? 'weather' : R() < 0.3 ? fieldTone(R) : pickTone(R, i + COURSES - rows, run, false);
        let sy = y + drift + shrink / 2, sh = h - shrink;
        if (i === 0) { const t0 = top + MORTAR / 2; if (sy < t0) { sh -= t0 - sy; sy = t0; } }
        /*
         * The bottom course runs past the picture and the canvas edge cuts
         * it, the way the hedge at its foot already does. Clipping every
         * stone flush to `fh` put 87% of the base on one ruled line, and a
         * wall a metre and a quarter high is mostly its ground line.
         */
        if (i === rows - 1) sh += 3 + R() * 5;
        // The slot he had to pack: two thin stones one over the other, which
        // is the most dry-stone thing a wall does and the tall one already did.
        if (priv && sh > 34 && R() < 0.16) {
          const hh = (sh - MORTAR) / 2;
          for (const [yy, tn] of [[sy, tone], [sy + hh + MORTAR, pickTone(R, i, run, false)]] as Array<[number, string]>) {
            const b: Block = { x: x + jw / 2, y: yy, w: w - jw, h: hh, course: i, pts: [] };
            b.pts = stone(g, b.x, b.y, b.w, b.h, R, tn, 'laid', 0);
            if (b.w > 40) own.push(b);
          }
        } else {
          const b: Block = { x: x + jw / 2, y: sy, w: w - jw, h: sh, course: i, pts: [] };
          b.pts = stone(g, b.x, b.y, b.w, b.h, R, tone, 'laid', priv && R() < 0.4 ? (R() - 0.5) * 0.08 : 0);
          if (priv && b.w > 40) own.push(b);
        }
        x += w;
      }
    }
    return own;
  }


  /**
   * And a garden wall in a bond, which is the same lay at the same unit size
   * as the house: the courses are counted off the room under the coping
   * rather than divided into it, so a brick is a brick however high the wall
   * is. There is no header course in it -- a wall you can see over is one
   * unit thick, and there is nothing for a header to bond to.
   */
  function lowBond(g: Ctx, R: Rand, fh: number, rows: number): Block[] {
    const top = COPE;
    const own: Block[] = [];
    const zone = firing(R);
    const n = S.across, uw = TW / n;
    const HR = rand(3121);
    const hs: number[] = [];
    let tot = 0;
    for (let i = 0; i < rows; i++) { const w = 0.92 + 0.16 * HR(); hs.push(w); tot += w; }
    const tops: number[] = [top];
    for (let i = 0; i < rows; i++) tops.push(tops[i] + ((fh - top) * hs[i]) / tot);
    for (let i = 0; i < rows; i++) {
      const y0 = tops[i], ch = tops[i + 1] - y0;
      const lap = (i % 2) * 0.5;
      const kw = 1 + Math.floor(R() * 2), aw = ch * 0.17 * (R() < 0.5 ? -1 : 1);
      for (let k = lap ? -1 : 0; k < n; k++) {
        const x = (k + lap) * uw;
        const mid = clamp(x + uw / 2, EDGE, TW - EDGE);
        const seam = x < 0 || x + uw > TW;
        const RR = seam ? rand(647 + i * 11) : R;
        const priv = x + MORTAR / 2 > EDGE && x + uw - MORTAR / 2 < TW - EDGE;
        const sag = Math.sin((Math.PI * kw * (mid - EDGE)) / (TW - 2 * EDGE)) * aw;
        // A garden wall was laid out of what was left over, so it carries the
        // weathered and the bleached units a house wall was picked clear of.
        const tone = !seam && RR() < 0.08 ? fieldTone(RR)
          : zone(RR, seam ? 0 : x + uw / 2, y0, false, i + COURSES - rows, [], i === 0);
        const jw = MORTAR + (priv ? RR() * 2.2 : 0);
        const drift = (RR() - 0.5) * 2.4 + sag;
        const shrink = RR() * 2;
        /*
         * The bottom course runs past the picture and the canvas edge cuts
         * it, the way the hedge at its foot already does: a wall a metre and
         * a quarter high is mostly its ground line, and a ruled one shows.
         */
        const bh = ch - MORTAR - shrink + (i === rows - 1 ? 4 + RR() * 4 : 0);
        const b: Block = { x: x + jw / 2, y: y0 + MORTAR / 2 + drift + shrink / 2, w: uw - jw, h: bh, course: i, pts: [] };
        b.pts = stone(g, b.x, b.y, b.w, b.h, RR, tone, 'unit', priv && RR() < 0.3 ? (RR() - 0.5) * 0.014 : 0, 1.35);
        if (priv && b.w > 24) own.push(b);
      }
    }
    return own;
  }

  /**
   * A garden wall of mud: the same coat, a pass or two of the trowel on it,
   * and a foot the splash has eaten -- which on a wall a metre and a quarter
   * high is a good part of it. Where its coat has come away is the
   * renderer's to lay, as it is on a house.
   */
  function lowRender(g: Ctx, R: Rand, fh: number): Block[] {
    g.fillStyle = PASTEL.stone;
    g.fillRect(0, COPE - 6, TW, fh - COPE + 12);
    passes(g, R, COPE + 12, fh - 36);
    if (R() < 0.4) fissure(g, inField(20, R), COPE + 10, 26 + R() * 30, R);
    erosionOf(g, R, Math.min(38, (fh - COPE) * 0.35), fh);
    return [];
  }

  /**
   * The pillows a mud garden wall's cap is laid in, by the variant's cope
   * seed: where each armful meets the next, and how high it stands between.
   * The lengths are what an armful of mud made, three quarters of a metre to
   * a metre and a half, each its own height; four equal ones to a section
   * were a wave you could count along a street. A section starts and ends on
   * a joint, so the cap arrives at a seam where it left.
   */
  function pillowsOf(seed: number): { joints: number[]; peaks: number[] } {
    const R = rand(seed + 19);
    const joints: number[] = [0];
    for (;;) {
      const at = joints[joints.length - 1] + 96 + R() * 96;
      if (at > TW - 80) break;
      joints.push(at);
    }
    joints.push(TW);
    return { joints, peaks: joints.slice(1).map(() => 8 + R() * 8) };
  }
  /** How far a cap of pillows rises over the head of its wall at `x`: nothing at a joint, the pillow's height at its middle. */
  function pillowRise(p: { joints: number[]; peaks: number[] }, x: number): number {
    let j = 0;
    while (j < p.joints.length - 2 && x > p.joints[j + 1]) j++;
    const t = clamp((x - p.joints[j]) / (p.joints[j + 1] - p.joints[j]), 0, 1);
    return p.peaks[j] * Math.pow(Math.sin(Math.PI * t), 0.7);
  }
  /**
   * The cap of a mud garden wall: not a coping of anything, but the coat
   * itself laid thick over the top and rounded off by hand, a pillow at a
   * time. What is painted here is its front, rolled down from the head of
   * the wall to a lip that throws a shade on the face under it: pale where
   * it turns up to the sky, a crease where one armful was pressed onto the
   * last. The humps of the pillows rise over the head itself, and the renderer
   * cuts them into the top edge of the wall, where they are its outline.
   */
  function renderCope(g: Ctx, seed: number): void {
    const p = pillowsOf(seed);
    const R = rand(seed + 23);
    const taper = (x: number): number => Math.min(1, Math.min(x, TW - x) / 40);
    const a = R() * 6, b = R() * 6;
    const lip = (x: number): number => COPE + 1 + (Math.sin(x * 0.037 + a) * 1.4 + Math.sin(x * 0.091 + b) * 0.9) * taper(x);
    const path = (): void => {
      g.beginPath(); g.moveTo(0, 0); g.lineTo(TW, 0);
      for (let x = TW; x >= 0; x -= 4) g.lineTo(x, lip(x));
      g.closePath();
    };
    const sh = g.createLinearGradient(0, COPE, 0, COPE + 12);
    sh.addColorStop(0, 'rgba(46, 34, 62, 0.4)'); sh.addColorStop(1, 'rgba(46, 34, 62, 0)');
    g.fillStyle = sh; g.fillRect(0, COPE, TW, 12);
    path(); g.fillStyle = TONES.top.lit; g.fill();
    g.save(); path(); g.clip();
    const under = g.createLinearGradient(0, COPE * 0.45, 0, COPE + 3);
    under.addColorStop(0, hexA(PASTEL.stoneShade, 0)); under.addColorStop(1, hexA(PASTEL.stoneShade, 0.75));
    g.fillStyle = under; g.fillRect(0, 0, TW, COPE + 4);
    // Where one armful was pressed onto the last: a crease down the roll.
    g.strokeStyle = hexA(PASTEL.stoneShade, 0.55); g.lineWidth = 2.2; g.lineCap = 'round';
    for (const x of p.joints.slice(1, -1)) {
      const lean = (R() - 0.5) * 6;
      g.beginPath(); g.moveTo(x, 0); g.quadraticCurveTo(x + lean, COPE * 0.5, x + lean * 0.4, lip(x) - 2); g.stroke();
    }
    g.lineCap = 'butt';
    g.restore();
    if (R() < 0.6) fissure(g, inField(10, R), 6, 10 + R() * 12, R);
  }

  /* ---- the textures ------------------------------------------------------ */
  const cnv = (w: number, h: number): HTMLCanvasElement => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  /** A picture of nothing, one per variant, for what does not grow on a bare masonry. */
  const bare = (): HTMLCanvasElement[] => VARIANTS.map(() => cnv(1, 1));
  const ctxOf = (c: HTMLCanvasElement): Ctx => c.getContext('2d') as Ctx;
  const STONES: Block[][] = [];
  const FACE = VARIANTS.map((v, i) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    STONES[i] = paintCourses(g, rand(v.seed), (S.growth ? v.drapes : []).map((d): Pt => { const h2 = d.w / 2, c = clamp(d.cx, MARGIN + h2, TW - MARGIN - h2); return [c - h2, c + h2]; }));
    return c;
  });
  /**
   * And the same section with a way through it.
   *
   * The field is painted first, off the variant's own seed, so an arch butts
   * its neighbours on the same straddling stones every other section does --
   * the opening is a long way inside the margin and never touches a seam. Then
   * the pocket, the jambs and the ring, and then the hole out of the lot in
   * one pass: the curve belongs to the compass and the stones to the hammer.
   */
  const ARCHED = VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    paintCourses(g, rand(v.seed), (S.growth ? v.drapes : []).map((d): Pt => { const h2 = d.w / 2, m = clamp(d.cx, MARGIN + h2, TW - MARGIN - h2); return [m - h2, m + h2]; }), true);
    const R = rand(v.seed * 131 + 17);
    if (S.lay === 'render') renderArch(g, R);
    else if (S.lay === 'frame') frameArch(g, R);
    else {
      jamb(g, R, -1);
      jamb(g, R, 1);
      impost(g, R, -1);
      impost(g, R, 1);
      voussoirs(g, R);
    }
    // Opaque, deliberately: `destination-out` takes away as much as the source
    // puts down, so a fill left over at 0.55 from the last pitted stone would
    // leave the field ghosting through the opening at 0.45.
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.globalCompositeOperation = 'destination-out';
    openingPath(g);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    return c;
  });
  /**
   * The ivy that hangs into the opening, one tongue per curtain that reaches
   * over it. It is rooted six pixels above the curve, so it comes out from
   * under the ring rather than out of the air.
   */
  const ARCH_IVY = !S.growth ? bare() : VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    const R = rand(v.seed * 991 + 43);
    for (const d of v.drapes) {
      if (!d.fall) continue;
      const half = d.w / 2, dcx = clamp(d.cx, MARGIN + half, TW - MARGIN - half);
      if (dcx - half > A_CX + A_R * 0.85 || dcx + half < A_CX - A_R * 0.85) continue;
      const x = clamp(dcx, A_CX - A_R * 0.76, A_CX + A_R * 0.76);
      const y0 = A_CY - Math.sqrt(Math.max(0, A_R * A_R - (x - A_CX) ** 2)) - 6;
      const cs: Lobe[] = [];
      tongueLobes(cs, x, y0, 13 + 11 * R(), CH * (0.7 + 0.9 * R()), R);
      shadowOf(g, cs, 5, 6);
      mass(g, cs, R, { r: 8.5, lobe: R() < 0.4 ? 1 : 0 });
    }
    return c;
  });
  /** And what has seeded itself in the gap: grass in the threshold, a tuft on an impost. */
  const ARCH_WEED = !S.growth ? bare() : VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    const R = rand(v.seed * 557 + 29);
    for (const side of [-1, 1]) {
      if (R() < 0.4) continue;
      tussock(g, A_CX + side * A_R * (0.42 + R() * 0.42), TH + 3, 34 + R() * 30, 26 + R() * 26, R);
    }
    // The impost is a ledge, and rain that runs off the ring stands on it.
    for (const side of [-1, 1]) {
      if (R() < 0.55) continue;
      tussock(g, A_CX + side * (A_R - 6 + R() * 14), A_CY + 1, 22 + R() * 14, 14 + R() * 10, R);
    }
    return c;
  });
  /** And the same section with a window in it, drawn and cut the same way. */
  const WINDOWED = VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    paintCourses(g, rand(v.seed), (S.growth ? v.drapes : []).map((d): Pt => { const h2 = d.w / 2, m = clamp(d.cx, MARGIN + h2, TW - MARGIN - h2); return [m - h2, m + h2]; }), true);
    surround(g, rand(v.seed * 197 + 61), W_X0, W_X1, W_HEAD, W_SILL, 66, 0);
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.rect(W_X0, W_HEAD, W_X1 - W_X0, W_SILL - W_HEAD);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    return c;
  });
  /**
   * What grows at a window: ivy over the head of it, and whatever has seeded
   * in the joint behind the sill, which is where the rain that runs off the
   * glass ends up.
   */
  const WIN_IVY = !S.growth ? bare() : VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    const R = rand(v.seed * 883 + 19);
    for (const d of v.drapes) {
      if (!d.fall) continue;
      const half = d.w / 2, dcx = clamp(d.cx, MARGIN + half, TW - MARGIN - half);
      if (dcx - half > W_X1 - 10 || dcx + half < W_X0 + 10) continue;
      const x = clamp(dcx, W_X0 + 18, W_X1 - 18);
      const cs: Lobe[] = [];
      tongueLobes(cs, x, W_HEAD - 8, 11 + 9 * R(), (W_SILL - W_HEAD) * (0.35 + 0.5 * R()), R);
      shadowOf(g, cs, 5, 6);
      mass(g, cs, R, { r: 8.5, lobe: R() < 0.4 ? 1 : 0 });
    }
    return c;
  });
  const WIN_WEED = !S.growth ? bare() : VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    const R = rand(v.seed * 419 + 83);
    for (const side of [-1, 1]) {
      if (R() < 0.45) continue;
      const x = (W_X0 + W_X1) / 2 + side * (W_X1 - W_X0) * (0.18 + R() * 0.28);
      tussock(g, x, W_SILL - 2, 22 + R() * 18, 14 + R() * 12, R);
    }
    return c;
  });
  /** And with a bay: the same hole and surround, on a shelf rather than a sill. */
  const BAYED = VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    paintCourses(g, rand(v.seed), (S.growth ? v.drapes : []).map((d): Pt => { const h2 = d.w / 2, m = clamp(d.cx, MARGIN + h2, TW - MARGIN - h2); return [m - h2, m + h2]; }), true);
    surround(g, rand(v.seed * 251 + 13), Y_X0, Y_X1, Y_HEAD, Y_SILL, 46, 10);
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.rect(Y_X0, Y_HEAD, Y_X1 - Y_X0, Y_SILL - Y_HEAD);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    return c;
  });
  /** And the same section with a doorway in it. */
  const DOORED = VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    paintCourses(g, rand(v.seed), (S.growth ? v.drapes : []).map((d): Pt => { const h2 = d.w / 2, m = clamp(d.cx, MARGIN + h2, TW - MARGIN - h2); return [m - h2, m + h2]; }), true);
    doorway(g, rand(v.seed * 311 + 29), D_X0, D_X1, D_HEAD, BEAM, 0);
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.rect(D_X0, D_HEAD, D_X1 - D_X0, TH - D_HEAD);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    return c;
  });
  /** And the gate: the same drawing at twice the span, on corbels. */
  const GATED = VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    paintCourses(g, rand(v.seed), (S.growth ? v.drapes : []).map((d): Pt => { const h2 = d.w / 2, m = clamp(d.cx, MARGIN + h2, TW - MARGIN - h2); return [m - h2, m + h2]; }), true);
    doorway(g, rand(v.seed * 373 + 41), V_X0, V_X1, V_HEAD, GATE_BEAM, CORBEL);
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.rect(V_X0, V_HEAD, V_X1 - V_X0, TH - V_HEAD);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    return c;
  });
  /**
   * What grows at a doorway, which is less than anywhere else on the wall,
   * because a doorway is the one part of it somebody walks through every day.
   * Ivy over the head where the curtain reaches that far, and a tuft in each
   * bottom corner where a boot never goes.
   */
  const DOOR_IVY = !S.growth ? bare() : VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    const R = rand(v.seed * 733 + 37);
    for (const d of v.drapes) {
      if (!d.fall) continue;
      const half = d.w / 2, dcx = clamp(d.cx, MARGIN + half, TW - MARGIN - half);
      if (dcx - half > D_X1 - 10 || dcx + half < D_X0 + 10) continue;
      const x = clamp(dcx, D_X0 + 16, D_X1 - 16);
      const cs: Lobe[] = [];
      tongueLobes(cs, x, D_HEAD - 7, 12 + 10 * R(), CH * (0.4 + 0.7 * R()), R);
      shadowOf(g, cs, 5, 6);
      mass(g, cs, R, { r: 8.5, lobe: R() < 0.4 ? 1 : 0 });
    }
    return c;
  });
  const DOOR_WEED = !S.growth ? bare() : VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    const R = rand(v.seed * 617 + 53);
    for (const side of [-1, 1]) {
      if (R() < 0.5) continue;
      tussock(g, (side < 0 ? D_X0 : D_X1) + side * (R() * 12 - 4), TH + 2, 26 + R() * 18, 18 + R() * 14, R);
    }
    return c;
  });
  /**
   * And the gate's, which is thinner again: a cart wheel goes closer to a
   * jamb than a boot does, so only the ivy over the head is sure of itself
   * and there is nothing in the corners but a wisp.
   */
  const GATE_IVY = !S.growth ? bare() : VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    const R = rand(v.seed * 541 + 71);
    for (const d of v.drapes) {
      if (!d.fall) continue;
      const half = d.w / 2, dcx = clamp(d.cx, MARGIN + half, TW - MARGIN - half);
      if (dcx - half > V_X1 - 10 || dcx + half < V_X0 + 10) continue;
      const x = clamp(dcx, V_X0 + 20, V_X1 - 20);
      const cs: Lobe[] = [];
      tongueLobes(cs, x, V_HEAD - 7, 12 + 10 * R(), CH * (0.4 + 0.7 * R()), R);
      shadowOf(g, cs, 5, 6);
      mass(g, cs, R, { r: 8.5, lobe: R() < 0.4 ? 1 : 0 });
    }
    return c;
  });
  const GATE_WEED = !S.growth ? bare() : VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    const R = rand(v.seed * 467 + 97);
    for (const side of [-1, 1]) {
      if (R() < 0.62) continue;
      tussock(g, (side < 0 ? V_X0 : V_X1) + side * (R() * 10 - 3), TH + 2, 20 + R() * 14, 14 + R() * 10, R);
    }
    return c;
  });
  /** The growth over the top is painted PAD px taller than the face, the extra above the top edge: the
   *  crest of each drape, standing above the cap, is part of the same silhouette. */
  const PAD = 64;
  const SPILL = !S.growth ? bare() : VARIANTS.map((v) => {
    const c = cnv(TW, TH + PAD), g = ctxOf(c);
    g.translate(0, PAD);
    for (const m of v.drapes) {
      const lay = drapeLayout(m, rand(m.seed)), R = rand(m.seed + 1);
      shadowOf(g, lay.cs, 6, 7);
      mass(g, lay.cs, R, { r: lay.r, lobe: R() < 0.33 ? 0 : 1 });
    }
    return c;
  });
  const BASE = !S.growth ? bare() : VARIANTS.map((v) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    for (const b of v.foot.hedges) hedge(g, b, rand(b.seed));
    return c;
  });
  const FOOT = VARIANTS.map((v, i) => {
    const c = cnv(TW, TH), g = ctxOf(c);
    if (S.lay === 'render') erosionOf(g, rand(v.seed * 23 + 11), S.plinth, TH);
    else if (S.lay === 'frame') footingOf(g, rand(v.seed * 23 + 11));
    else if (S.plinth) plinthOf(g, rand(v.seed * 23 + 11));
    // Moss grows on what is there to grow on: a unit the plinth now covers is
    // not, so it does not get a lens of it hanging in front of cut stone.
    const on = S.plinth ? STONES[i].filter((b) => b.y + b.h < TH - S.plinth) : STONES[i].slice();
    if (S.growth) footMoss(g, on, v.extras.moss, rand(v.seed * 19 + 7));
    return c;
  });
  /** How many lengths a head's rise is given in, along a section. */
  const CREST_N = 16;
  /**
   * How far the head of a wall that nothing stands on rises over the line, by
   * variant, in picture pixels at CREST_N + 1 points along the section: a
   * hump or two where the last armfuls of mud were heaped and smoothed off,
   * as much as fourteen pixels, which is two or three on screen, and nothing
   * at either end, so a head runs on into the next section's. A mud wall
   * laid to a line was a box with a lid on it.
   */
  const CREST = S.lay !== 'render' ? undefined : VARIANTS.map((v) => {
    const R = rand(v.seed * 131 + 71);
    const humps = Array.from({ length: 1 + Math.floor(R() * 2.4) }, () => ({ c: 0.18 + R() * 0.64, w: 0.16 + R() * 0.24, a: 4 + R() * 10 }));
    return Array.from({ length: CREST_N + 1 }, (_, i) => {
      const x = i / CREST_N, taper = Math.min(1, x / 0.1, (1 - x) / 0.1);
      let r = 0;
      for (const h of humps) { const u = (x - h.c) / h.w; if (Math.abs(u) < 1) r += h.a * (1 - u * u) ** 2; }
      return r * taper;
    });
  });
  /**
   * The head of a wall that nothing stands on: the coat laid over the top and
   * rounded off by the hand that laid it, a roll of it paler for turning up
   * toward the sky, its lower edge wandering as a hand's does. The face
   * turns into the top through it rather than meeting it on a ruled line. It
   * comes in at one depth at both ends, so any section's meets any other's.
   */
  const BROW_H = 24;
  const BROW = S.lay !== 'render' ? undefined : VARIANTS.map((v) => {
    const c = cnv(TW, BROW_H), g = ctxOf(c), R = rand(v.seed * 5 + 3);
    const a = R() * 6, b = R() * 6, cc = R() * 6;
    const edge = (x: number): number => {
      const e = Math.min(1, Math.min(x, TW - x) / 48);
      return 12 + (Math.sin(x * 0.029 + a) * 2.4 + Math.sin(x * 0.083 + b) * 1.5 + Math.sin(x * 0.21 + cc) * 0.8) * e;
    };
    g.beginPath(); g.moveTo(0, 0);
    for (let x = 0; x <= TW; x += 6) g.lineTo(x, edge(x));
    g.lineTo(TW, 0); g.closePath();
    const roll = g.createLinearGradient(0, 0, 0, 16);
    roll.addColorStop(0, TONES.top.lit); roll.addColorStop(1, lighten(PASTEL.stone, 3));
    g.fillStyle = roll; g.fill();
    return c;
  });
  /**
   * The beam ends of the floor over a storey, per variant, for a wall the
   * joists rest on: the logs painted for each way they can stand off a face
   * at the camera's angles, and the shade the row throws.
   *
   * Where a log's end stands in the picture, per tile it stands out of the
   * wall: the picture's rows run down the screen, so what comes off a face
   * comes down the screen by the projection's drop for a tile -- its whole
   * depth at a diagonal, that over the root of two when the view is square
   * on -- and at a diagonal it also comes a whole tile back along the face.
   * The face round the corner has its picture laid mirrored, which puts its
   * logs the right way for it without a second set.
   */
  /**
   * The places the coat has come away, for the renderer to lay where the
   * weather would have taken it, each a stack of courses from the top:
   *
   * `corner` off an arris, three to five courses deep, each course back from
   * the corner by a different length -- painted with the corner on the
   * right; `foot` a mound out of the eroded foot, widest at the bottom, with
   * two courses more under it for the foot to cover; `sill` two courses
   * under the end of a sill board, where the water off it runs; `head` a
   * long course or two just under the head, where the rain comes over it,
   * the top straight along a joint.
   */
  const LOSSES = S.lay !== 'render' ? undefined : (() => {
    const R = rand(4127);
    const uq = TW / S.across / 4;
    // A coat that lets go along the joints stops at a brick's end more often than not.
    const q = (x: number): number => Math.round(x / uq) * uq + (R() - 0.5) * 8;
    const corner = [0, 1, 2, 3].map(() => {
      const n = 3 + Math.floor(R() * 3), w = 120;
      const runs: Array<[number, number]> = [];
      let d = 34 + R() * 40;
      for (let i = 0; i < n; i++) {
        d = clamp(d + (R() - 0.45) * 56, 26, w - 10);
        runs.push([w - q(d), w + 4]);
      }
      return lossPicture(runs, R);
    });
    /*
     * Each course of a loss is let go at each end by its own amount: a stack
     * that grows the same on both sides course by course was a ziggurat, and
     * a small one a cross, stamped on the wall.
     */
    const grow = (a: number, b: number, lo: number, hi: number): [number, number] =>
      [clamp(q(a - (R() - 0.3) * 34), lo, b - 30), clamp(q(b + (R() - 0.3) * 34), a + 30, hi)];
    const foot = [0, 1, 2, 3].map(() => {
      const n = 2 + Math.floor(R() * 2), w = 150 + R() * 40;
      const runs: Array<[number, number]> = [];
      let [a, b] = [q(w * (0.15 + R() * 0.35)), 0];
      b = q(a + 30 + R() * 40);
      for (let i = 0; i < n + 2; i++) {
        runs.push([a, b]);
        [a, b] = grow(a, b, 2, w - 2);
      }
      return lossPicture(runs, R);
    });
    const sill = [0, 1, 2].map(() => {
      // Under the end of the board, the lower course carried off to one side by the water's run.
      const w = 90 + R() * 30, a = q(8 + R() * 16), b = q(a + 50 + R() * 26);
      const side = R() < 0.5;
      return lossPicture([[a, b], side ? [q(a + 18 + R() * 16), q(b + 6 + R() * 14)] : [q(a - 6 - R() * 10), q(b - 18 - R() * 16)]].map(([x, y]) => [clamp(x, 2, w - 32), clamp(y, x + 26, w - 2)] as [number, number]), R);
    });
    const head = [0, 1, 2].map(() => {
      const w = 170 + R() * 80;
      const runs: Array<[number, number]> = [[4, w - 4]];
      if (R() < 0.7) {
        const a = q(10 + R() * (w * 0.5)), b = q(a + 40 + R() * (w * 0.35));
        runs.push([a, Math.min(w - 4, b)]);
      }
      return lossPicture(runs, R);
    });
    return { corner, foot, sill, head, lip: LOSS_LIP, ch: MUD_CH, from: BAND };
  })();
  const perPx = TH / (WALL_HEIGHT * HEIGHT_SCALE);
  const VIGAS = !LOSSES ? undefined : (() => {
    const rows = VARIANTS.map(vigaRow);
    return {
      iso: rows.map((r) => vigaLogs(r, -TW, TILE_H * perPx, LOSSES.sill)),
      square: rows.map((r) => vigaLogs(r, 0, (TILE_H / Math.SQRT2) * perPx, LOSSES.sill)),
      shade: rows.map(vigaShade),
      h: VIGA_H,
      sh: VIGA_SH,
    };
  })();
  /** The cap's stone, the same for every variant, drawn under the island's light. */
  const CAP_STONE = (() => {
    const c = cnv(TW, CAP_H), g = ctxOf(c);
    if (S.lay === 'render') {
      // The top of a mud wall is the same coat turned up at the sky, a step
      // paler for it. Plain: one picture over every section, its cracks were
      // a mark repeating every four metres down the run.
      g.fillStyle = TONES.top.lit; g.fillRect(0, 0, TW, CAP_H);
      return c;
    }
    if (S.lay === 'frame') {
      // The top of a frame is its plate seen from above: the oak turned up
      // at the sky, a step paler, and its grain running along it.
      g.fillStyle = TONES.top.lit; g.fillRect(0, 0, TW, CAP_H);
      g.strokeStyle = hexA(TONES.top.shade, 0.8); g.lineWidth = 1.2;
      for (const f of [0.3, 0.55, 0.8]) {
        g.beginPath();
        for (let x = 0; x <= TW; x += 16) g.lineTo(x, CAP_H * f + Math.sin(x * 0.02 + f * 9) * 1.5);
        g.stroke();
      }
      return c;
    }
    g.fillStyle = PASTEL.joint; g.fillRect(0, 0, TW, CAP_H);
    // On a bond the top is the band course seen from above, and a face
    // turned up at the sky is a step lighter than the same stone on the side.
    slabs(g, 0, CAP_H, rand(99), S.lay === 'bond' ? 'top' : 'flat');
    return c;
  })();
  const ENDS = (() => {
    const Wc = 64, c = cnv(Wc, TH), g = ctxOf(c), R = rand(7);
    if (S.lay === 'render') {
      // The end of a mud wall is the coat come round the corner; the roll of
      // it round the arris is the renderer's, in the light of both faces.
      g.fillStyle = PASTEL.stone; g.fillRect(0, 0, Wc, TH);
      g.fillStyle = hexA(PASTEL.stoneHi, 0.5); g.fillRect(0, 0, Wc, 6);
      return c;
    }
    if (S.lay === 'frame') {
      // The end of a frame is the side of its end post, the plate over it.
      member(g, -2, 0, Wc + 2, TH, R);
      member(g, -2, 0, Wc + 2, PLATE, R);
      return c;
    }
    g.fillStyle = PASTEL.joint; g.fillRect(0, 0, Wc, TH);
    stone(g, MORTAR / 2, MORTAR / 2, Wc - MORTAR, BAND - MORTAR, R, 'flat', 'sawn');
    if (S.lay === 'bond') {
      /*
       * Quoins. Where a brick wall stops -- a corner of a house, the end of a
       * run -- it is finished in cut stone, because an arris of brick is the
       * first thing a cart takes off and the corner is what carries the two
       * walls into each other. Five stones to the storey, each two courses
       * of brick deep, in the dressings' two tones turn about.
       */
      const n = 5, ch = (TH - BAND) / n;
      for (let i = 0; i < n; i++) {
        stone(g, MORTAR / 2, BAND + i * ch + MORTAR / 2, Wc - MORTAR, ch - MORTAR, R, i % 2 ? 'plinth' : 'dress', 'unit', 0, 1.8);
      }
      return c;
    }
    for (let i = 0; i < COURSES; i++) {
      stone(g, MORTAR / 2, BAND + i * CH + MORTAR / 2, Wc - MORTAR, CH - MORTAR, R, ['', 'brown', 'green', ''][i]);
    }
    return c;
  })();
  /**
   * The low wall, at whatever height is asked for, painted once per height.
   *
   * Everything a fence carries is in the one picture, because a fence has no
   * openings to clip growth out of and no storey above it to belong to: the
   * courses, the coping, the weather, the moss in its low joints, the hedge
   * and the turf at its foot and the damp along its ground line.
   *
   * Nothing grows on the top of it. A dry coping holds whatever blows into
   * its joints and it had four metres of grass and moss and a hanging drape
   * to show for it; the wall is barer without them and it is the coping you
   * look at now, which is the point of a coping.
   */
  const LOWS = new Map<number, Low>();
  const low = (k: number): Low => {
    const had = LOWS.get(k);
    if (had) return had;
    const fh = Math.max(COPE + LEVEL + 70, Math.round(TH * k));
    // As many courses as the room under the coping and its levelling course
    // allows, at the size the tall wall's stones are, so a fence and a house
    // are the same masonry rather than the same masonry and some brickwork.
    const unitH = S.lay === 'bond' ? (TH - BAND) / S.rows : CH * 0.66;
    const rows = Math.max(S.lay === 'bond' ? 3 : 2, Math.round((fh - COPE - LEVEL) / unitH));
    const face = VARIANTS.map((v) => {
      const c = cnv(TW, fh + PROUD), g = ctxOf(c);
      g.translate(0, PROUD);
      const R = rand(v.seed * 83 + 5);
      g.fillStyle = PASTEL.joint; g.fillRect(0, 0, TW, fh);
      const own = lowCourses(g, R, fh, rows);
      levelling(g, R);
      coping(g, copeSeed(v.seed));
      // At the stock's own rate of wear, as the tall wall's is: a garden wall
      // of brick took the whole of a novice's rubble's and was specked with it.
      const k = S.wear;
      for (const s of own) {
        const t = R();
        if (t < 0.18 * k) chipCorner(g, s, R);
        else if (t < 0.34 * k) crack(g, s, R);
        else if (t < 0.41 * k) spall(g, s, R);
        else if (t < 0.46 * k) recessed(g, s, R);
        if (R() < 0.22 * k) abrade(g, s, R);
        if (R() < 0.25 * k) pits(g, s, R);
        if (R() < 0.15 * k) slop(g, s, R);
      }
      // The damp along the ground, then moss in the low joints, then the hedge.
      g.fillStyle = 'rgba(110,100,80,0.16)'; g.fillRect(0, fh - 9, TW, 9);
      if (!S.growth) return c;
      const lowest = own.filter((s) => s.course >= rows - 2);
      for (let i = 0; i < v.extras.moss && lowest.length; i++) {
        const s = lowest[Math.floor(R() * lowest.length)];
        mossLens(g, s, R() < 0.4 ? fh + 1 : s.y - MORTAR / 2, R);
      }
      for (let i = 0; i < 3 + Math.floor(R() * 4) && lowest.length; i++) mossFleck(g, lowest[Math.floor(R() * lowest.length)], R);
      /*
       * The hedge, cut to the wall it is at the foot of. The variants' hedges
       * were sized against three metres of wall; dropped whole onto one and a
       * quarter they came up over the coping and the fence was a hedge with
       * some stone showing through it.
       */
      const body = fh - COPE - LEVEL;
      for (const b of v.foot.hedges) {
        hedge(g, { ...b, w: b.w * 0.78, h: Math.min(b.h * 0.72, body * 0.62) }, rand(b.seed), fh);
      }
      /*
       * And the turf at the foot of it. A wall does not stop at a ruled line
       * either: the bottom course is bedded an inch or two into the ground
       * and the grass comes up at it, so a few tufts break the bottom edge
       * the way the proud stones break the top one.
       */
      for (let i = 0; i < 5 + Math.floor(R() * 4); i++) {
        blades(g, 6 + R() * (TW - 12), fh - 1 - R() * 3, 20 + R() * 20, 14 + R() * 16, R);
      }
      return c;
    });
    /** The coping from above: the same run of stones, laid across the thickness. */
    const cap = VARIANTS.map((v) => {
      const c = cnv(TW, CAP_H + PROUD), g = ctxOf(c);
      g.translate(0, PROUD);
      if (S.lay === 'render') {
        // A mud cap seen from above is one pale band of coat; there is
        // nothing in it to count.
        g.fillStyle = TONES.top.lit; g.fillRect(0, -2, TW, CAP_H + 2);
        return c;
      }
      if (S.lay === 'frame') {
        // The rail along the head, seen from above: oak, paler for facing the sky.
        g.fillStyle = TONES.top.lit; g.fillRect(0, -2, TW, CAP_H + 2);
        g.strokeStyle = hexA(TONES.top.shade, 0.8); g.lineWidth = 1.2;
        for (const f of [0.35, 0.7]) {
          g.beginPath();
          for (let x = 0; x <= TW; x += 16) g.lineTo(x, CAP_H * f + Math.sin(x * 0.02 + f * 7) * 1.5);
          g.stroke();
        }
        return c;
      }
      const w0 = CSEAM[1] - CSEAM[0];
      /*
       * Not `flat`: a flat stone takes the flat tone and nothing else, and a
       * coping seen from above that is all one colour is the comb again. In
       * the coping's own ink, though, and -- the thing that matters here --
       * with its own length.
       *
       * Every comber ran the full sixty-four pixels of the wall's thickness
       * with its ends on two ruled lines, and every one of them carried the
       * lit rim that makes a block read as a block, so the top of the wall
       * was a row of keycaps. A comber is a stone: it is as long as it is,
       * it is set square to the wall by eye, one in four does not reach
       * across and gets a second stone behind it, and no stone in a thing
       * two pixels deep on screen has a highlight on its own edge.
       */
      const top = (x: number, w: number, RR: Rand, tone: string): void => {
        if (S.lay === 'bond') {
          // A length of dressed cope seen from above is a slab across the
          // wall's whole thickness, set square to it. The hand shows in a
          // pixel of overhang at one end and not in a stone skewed across it.
          g.fillStyle = PASTEL.joint;
          g.fillRect(x - 1, 0, w + 2, CAP_H);
          const j0 = RR() * 3, j1 = RR() * 3;
          void stone(g, x + MORTAR / 2, j0, w - MORTAR, CAP_H - j0 - j1, RR, tone === 'plinth' ? 'dress' : 'top', 'unit', (RR() - 0.5) * 0.01, 1.2, false);
          return;
        }
        // One end jitters hard and the other a little, so the two arrises of
        // the run are ragged independently rather than both nearly straight.
        const far = RR() < 0.5;
        const j0 = -5 + RR() * (far ? 25 : 10), j1 = 1 + RR() * (far ? 5 : 20);
        /*
         * The hearting between the combers, laid stone by stone rather than
         * as one rectangle behind the lot. A cap that opens with a filled
         * rectangle has a ruled far edge whatever the stones on it do, and at
         * four of the eight rotations that edge is the wall's whole outline
         * against the sky.
         */
        g.fillStyle = PASTEL.joint;
        g.fillRect(x - 1, Math.min(j0, 0) + 2, w + 2, CAP_H - Math.min(j0, 0) - 2);
        const tilt = (RR() - 0.5) * 0.55;
        // Lighter again than the face of the coping. This strip is two or
        // three pixels deep at the zoom people play at, so an outline that
        // reads as a joint up close reads as a dashed line along the top of
        // the wall from a field away -- which is a painted kerb, not stone.
        const run = CAP_H - j0 - j1;
        if (RR() < 0.26) {
          const a = run * (0.4 + RR() * 0.2);
          void stone(g, x + MORTAR / 2, j0, w - MORTAR, a, RR, tone, 'laid', tilt, 1.05, false);
          void stone(g, x + MORTAR / 2, j0 + a + 2, w - MORTAR, run - a - 2, RR, RR() < 0.5 ? 'weather' : '', 'laid', -tilt, 1.05, false);
          return;
        }
        void stone(g, x + MORTAR / 2, j0, w - MORTAR, run, RR, tone, 'laid', tilt, 1.05, false);
      };
      top(CSEAM[0], w0, rand(313), S.lay === 'bond' ? 'dress' : '');
      top(TW + CSEAM[0], w0, rand(313), S.lay === 'bond' ? 'dress' : '');
      // The same widths and the same tones as the face of it, taken from the
      // same two lists rather than from a roll of its own, because these are
      // the tops of those stones and not a second row of them.
      const seed = copeSeed(v.seed), ws = copeWidths(seed), tones = copeTones(seed, ws.length), R = rand(seed + 577);
      let x = CSEAM[1];
      for (let k = 0; k < ws.length; k++) { top(x, ws[k], R, tones[k]); x += ws[k]; }
      return c;
    });
    /**
     * And the end of a run, where the thickness shows.
     *
     * It was four slabs the width of the wall stacked up, which is a slice
     * cut out of a cake rather than the end of anything built. The head of a
     * dry wall is the hardest part of it to lay and the part that shows the
     * mason: two stones to a course set the other way about, with the joint
     * between them on the other side each course up, so the two skins are
     * tied into each other the whole way to the top. The cope shows its
     * width as two or three stone ends, not as one.
     */
    const ends = (() => {
      const Wc = 64, c = cnv(Wc, fh), g = ctxOf(c), R = rand(11);
      if (S.lay === 'render') {
        // The coat come round the end of it, under the cap's paler band.
        g.fillStyle = PASTEL.stone; g.fillRect(0, 0, Wc, fh);
        g.fillStyle = TONES.top.lit; g.fillRect(0, 0, Wc, COPE + 1);
        g.fillStyle = 'rgba(46, 34, 62, 0.3)'; g.fillRect(0, COPE + 1, Wc, 4);
        return c;
      }
      if (S.lay === 'frame') {
        // The side of the end post, and the rail over it.
        member(g, -2, 0, Wc + 2, fh, R);
        member(g, -2, 0, Wc + 2, 24, R);
        return c;
      }
      g.fillStyle = PASTEL.joint; g.fillRect(0, 0, Wc, fh);
      let cx = 0, ex = 0;
      // A bond's cope is cut stone, so its end is too.
      const heads: Array<[number, string, number]> = S.lay === 'bond'
        ? [[0.52, 'dress', 2], [0.48, 'plinth', 3]]
        : [[0.36, '', 5], [0.34, 'weather', 1], [0.3, 'bleach', 7]];
      for (const [f, tone, up] of heads) {
        const w = f * Wc;
        stone(g, cx + 1, up, w - 2, COPE - MORTAR / 2 - up, R, tone, 'laid', (R() - 0.5) * 0.06, COPE_INK);
        cx += w;
      }
      // Not `flat`: a flat stone takes `TONES.flat` and nothing else, which is
      // the lightest tone in the table, so the quietest course in the wall
      // came out as the brightest thing on its head -- one pale pill where
      // the run shows a course of packing.
      if (S.lay === 'bond') {
        // Where a brick garden wall stops it is finished in cut stone, the
        // same quoins a house's corner is: two to the height of the wall.
        const qh = (fh - COPE) / 2;
        for (let i = 0; i < 2; i++) {
          stone(g, MORTAR / 2, COPE + i * qh + MORTAR / 2, Wc - MORTAR, qh - MORTAR, R, i ? 'plinth' : 'dress', 'unit', 0, 1.8);
        }
        return c;
      }
      for (const [f, tn] of [[0.38, 'weather'], [0.34, 'dark'], [0.28, 'brown']] as Array<[number, string]>) {
        const w = f * Wc;
        stone(g, ex + 1, COPE + 1 + R() * 2, w - 2, LEVEL - 3, R, tn, 'laid', (R() - 0.5) * 0.08, 0.9);
        ex += w;
      }
      const ch = (fh - COPE - LEVEL) / rows;
      for (let i = 0; i < rows; i++) {
        const y = COPE + LEVEL + i * ch + MORTAR / 2, h = ch - MORTAR;
        const split = Wc * (i % 2 ? 0.42 : 0.6);
        stone(g, MORTAR / 2, y, split - MORTAR, h, R, ['', 'brown', 'green', ''][i % 4]);
        stone(g, split + MORTAR / 2, y, Wc - split - MORTAR, h, R, i === rows - 1 ? 'weather' : 'dark');
      }
      return c;
    })();
    /*
     * And the same wall with a gate in it: the field, then a pier laid up each
     * side of the gap and overhanging into it, and then the gap taken out of
     * the lot in one pass -- the way every other opening in this file is made.
     * The pier gets a flat stone of its own on top instead of the coping,
     * because a cope on edge is a thing you lay along a wall, not the thing
     * you finish a pier with.
     */
    const gx0 = TW * FENCE_GAP.t0, gx1 = TW * FENCE_GAP.t1;
    const gate = VARIANTS.map((v, i) => {
      const c = cnv(TW, fh + PROUD), g = ctxOf(c);
      g.translate(0, PROUD);
      g.drawImage(face[i], 0, -PROUD);
      const R = rand(v.seed * 197 + 71);
      for (const side of [-1, 1]) {
        const line = side < 0 ? gx0 : gx1;
        if (S.lay === 'render') {
          /*
           * A pier of the same mud as the wall and in the same coat, built up
           * a hand higher than the wall it interrupts and domed over -- the
           * dome is the renderer's, cut into the head of the wall -- its coat
           * rolled round its arrises, its foot eaten as the wall's is, and a
           * shade thrown down the wall on its field side, because it stands
           * out of it. Cream and square, it was a planed post.
           */
          const x = side < 0 ? line + OVER - 52 : line - OVER, w = 52;
          g.beginPath(); softRect(g, x, 0, w, fh + 6, 6);
          g.fillStyle = PASTEL.stone; g.fill();
          g.save(); g.clip();
          g.fillStyle = hexA(PASTEL.stoneHi, 0.45); g.fillRect(x, 0, 6, fh);
          g.fillStyle = hexA(PASTEL.stoneShade, 0.5); g.fillRect(x + w - 7, 0, 7, fh);
          const head = g.createLinearGradient(0, 0, 0, 16);
          head.addColorStop(0, TONES.top.lit); head.addColorStop(1, hexA(TONES.top.lit, 0));
          g.fillStyle = head; g.fillRect(x, 0, w, 16);
          erosionOf(g, R, Math.min(34, fh * 0.3), fh);
          g.restore();
          g.fillStyle = 'rgba(46, 34, 62, 0.26)';
          g.fillRect(side < 0 ? x - 4 : x + w, 0, 4, fh);
          continue;
        }
        let y = fh - 2;
        while (y > COPE + LEVEL - 4) {
          const h = 28 + R() * 16, w = 34 + R() * 14;
          wearOne(g, stone(g, side < 0 ? line + OVER - w : line - OVER, y - h, w, h, R, pickDressed(R), 'laid', (R() - 0.5) * 0.02), R);
          y -= h + MORTAR + R() * 2;
        }
        wearOne(g, stone(g, side < 0 ? line + OVER - 52 : line - OVER, MORTAR / 2, 52, COPE + LEVEL - MORTAR, R, 'dress', 'laid', (R() - 0.5) * 0.015), R);
        // A pier stands proud of the wall it interrupts, so it throws a line
        // of shadow down the field side of itself. Without one it is a paler
        // patch of the same wall in the same plane, and the step up at the
        // gateway reads as the wall changing height for no reason.
        g.fillStyle = 'rgba(96, 86, 66, 0.3)';
        g.fillRect(side < 0 ? line + OVER - 56 : line - OVER + 52, 0, 4, fh);
      }
      g.globalAlpha = 1;
      g.fillStyle = '#000';
      g.globalCompositeOperation = 'destination-out';
      g.fillRect(gx0, -PROUD, gx1 - gx0, fh + PROUD);
      g.globalCompositeOperation = 'source-over';
      return c;
    });
    /**
     * And the top of that wall, with the gap taken out.
     *
     * The cap was laid across the whole section whether or not there was a
     * section under it, so a gate had the top of the wall painted straight
     * over its opening. It is cut to the gap here rather than clipped at the
     * draw, because a texture that is wrong is wrong once.
     *
     * What is left over the piers is not coping. A cope on edge is laid along
     * a wall; a pier is finished with one flat stone, and that stone is what
     * makes a step up at a gateway read as a gateway rather than as two
     * crews who did not measure.
     */
    const gateCap = VARIANTS.map((v, i) => {
      const c = cnv(TW, cap[i].height), g = ctxOf(c), R = rand(v.seed * 311 + 29);
      g.drawImage(cap[i], 0, 0);
      g.translate(0, PROUD);
      for (const side of [-1, 1]) {
        const x = side < 0 ? gx0 + OVER - 52 : gx1 - OVER;
        if (S.lay === 'render') {
          // The top of a mud pier, rounded over and paler for facing the sky.
          g.beginPath(); softRect(g, x, 2, 52, CAP_H - 4, 12);
          g.fillStyle = lighten(TONES.top.lit, 3); g.fill();
          g.strokeStyle = hexA(PASTEL.line, 0.4); g.lineWidth = 1; g.stroke();
          continue;
        }
        wearOne(g, stone(g, x, 2, 52, CAP_H - 4, R, 'dress', 'laid', (R() - 0.5) * 0.02, 1.2, false), R);
      }
      // Last, not first. The pier stones overhang into the gap the way every
      // other dressed stone in this file does, and cutting before drawing
      // them left ten pixels of each one projecting over the opening with
      // nothing under it -- a tongue of stone hanging in the gateway.
      g.clearRect(gx0, -PROUD, gx1 - gx0, c.height);
      return c;
    });
    /*
     * How far the head of the low wall rises over its line along a section:
     * the pillows of its cap, by variant; and at a gate, over each pier a
     * dome standing a hand clear of the wall, and nothing over the gap.
     */
    const crest = VARIANTS.map((v) => {
      const p = pillowsOf(copeSeed(v.seed));
      return Array.from({ length: 65 }, (_, i) => pillowRise(p, (i / 64) * TW));
    });
    const gateCrest = VARIANTS.map((v) => {
      const p = pillowsOf(copeSeed(v.seed));
      const piers: Pt[] = [[gx0 + OVER - 52, gx0 + OVER], [gx1 - OVER, gx1 - OVER + 52]];
      return Array.from({ length: 129 }, (_, i) => {
        const x = (i / 128) * TW;
        for (const [a, b] of piers) {
          if (x < a || x > b) continue;
          const u = (x - (a + b) / 2) / ((b - a) / 2);
          return 10 + 12 * Math.sqrt(Math.max(0, 1 - u * u));
        }
        return x > gx0 + OVER && x < gx1 - OVER ? 0 : pillowRise(p, x);
      });
    });
    const made: Low = { face, gate, cap, gateCap, ends, h: fh, proud: PROUD, crest, gateCrest };
    LOWS.set(k, made);
    return made;
  };


  /* ---- the paving --------------------------------------------------------- */
  /**
   * Cobbles laid on the ground, which is not the same job as cobbles laid in a
   * wall and does not look like one.
   *
   * A sett is smaller than a building stone and squarer, because it is bedded
   * on sand and has to be walked and carted over; it is laid in courses with
   * every course shoved along, and the courses are struck off a string by a
   * man kneeling on the last one, so they wander. What was there before was a
   * grid of six by six rectangles tinted light and dark, which is a pattern on
   * a lozenge rather than a road.
   *
   * Painted in light and shade rather than in colour, and laid over the tile
   * with `overlay`. The ground already carries the hour's sun, the slope it
   * lies on and the cold wash over land you only remember: a road painted in
   * its own colours would have to be told all three a second time and would
   * still be wrong at dusk. Mid grey changes nothing, lighter lightens the
   * ground and darker darkens it, so a sett comes out as a shape cut in the
   * tile's own colour, whatever that colour is.
   */
  const PAVE_TILE = 256;                   // px to a four-metre tile: sixty-four to the metre
  const PAVE_N = 3;                        // tiles to a side, so the run repeats every twelve metres
  const PAVE_W = PAVE_TILE * PAVE_N;
  /*
   * How big a sett is. Forty centimetres was true of a real road and wrong in
   * this picture: a tile is ninety-six pixels across on screen and squashed by
   * half again going the other way, so ten stones to a tile came out as crumbs
   * and the road read as grit. Sixty is what carries at the zoom people play
   * at, which is the size the wall's stones are drawn at too.
   */
  const SETT = 36;
  const SETT_INK = 1.8;                    // the outline, at this scale
  /** Nothing, and the earth packed between the stones. */
  const NEUTRAL = '#808080', BED = '#7a7a7a';
  /**
   * What a sett is made of. Five stones out of the same field the walls are
   * built from: the run of them, one darker, one bleached, one with moss in
   * its face and one with iron in it. The last two carry a hue, which in
   * `overlay` tints the ground under them rather than painting over it.
   */
  const SETTS: Array<{ lit: string; shade: string; hi: string }> = [
    { lit: '#9c9c9c', shade: '#868686', hi: '#b6b6b6' },
    { lit: '#8a8a8a', shade: '#767676', hi: '#a0a0a0' },
    { lit: '#adadad', shade: '#959595', hi: '#c4c4c4' },
    { lit: '#8f978b', shade: '#7b8378', hi: '#a5ac9f' },
    { lit: '#9d9690', shade: '#87817b', hi: '#b5aea7' },
  ];
  const SETT_LINE = '#5b5b5b';
  /** The green in a joint, which is darker than nothing so it darkens as it tints. */
  const WEED = { lit: '#7f9070', line: '#5f6f55' };

  /** One sett: a squarish stone, bedded, with the light on its upper edge. */
  function sett(g: Ctx, x: number, y: number, w: number, h: number, R: Rand, t: number): Pt[] {
    const cx = x + w / 2, cy = y + h / 2;
    // Squarer than a building stone and less alike from one to the next: a
    // sett is split off the block with a hammer, not picked up off a field.
    const pts = blob(cx, cy, w / 2, h / 2, 12, R, 0.21, 0.3, 0.1);
    const T = SETTS[t];
    solid(g, pts, T.lit, T.shade, SETT_LINE, SETT_INK, -w * 0.12, -h * 0.18);
    g.save(); shape(g, pts); g.clip();
    g.beginPath(); g.rect(x - 3, y - 3, w + 6, h * 0.5); g.clip();
    g.globalAlpha = 0.5;
    g.translate(1, 1.2); shape(g, pts); g.strokeStyle = T.hi; g.lineWidth = 1.2; g.lineJoin = 'round'; g.stroke();
    g.restore();
    return pts;
  }

  /** The crown of a stone a cart has been over: rubbed pale, and off centre. */
  function polish(g: Ctx, pts: Pt[], x: number, y: number, w: number, h: number, R: Rand): void {
    g.save(); shape(g, pts); g.clip();
    g.beginPath();
    g.ellipse(x + w * (0.35 + R() * 0.3), y + h * (0.3 + R() * 0.25), w * (0.2 + R() * 0.14), h * (0.16 + R() * 0.12), (R() - 0.5) * 0.7, 0, 7);
    g.fillStyle = hexA('#ffffff', 0.09 + R() * 0.07);
    g.fill();
    g.restore();
  }

  /** And one that has gone down into its bed: a shadow round the high side of it. */
  function sunk(g: Ctx, pts: Pt[], R: Rand): void {
    g.save();
    g.globalAlpha = 0.34 + R() * 0.16;
    shape(g, pts); g.strokeStyle = SETT_LINE; g.lineWidth = 2.6; g.lineJoin = 'round'; g.stroke();
    g.restore();
  }

  /** A corner off it, which is what a shod hoof does to a sett. */
  function knock(g: Ctx, pts: Pt[], R: Rand): void {
    const k = Math.floor(R() * pts.length);
    const a = pts[k], b = pts[(k + 2) % pts.length];
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.lineTo(a[0] + (b[0] - a[0]) * 0.4 + (R() - 0.5) * 3, a[1] + (b[1] - a[1]) * 0.4 + (R() - 0.5) * 3);
    g.closePath();
    g.fillStyle = hexA(BED, 0.8);
    g.fill();
    g.strokeStyle = SETT_LINE; g.lineWidth = 1; g.lineJoin = 'round'; g.stroke();
  }

  /** What has seeded in a joint: a few short blades, no mound under them. */
  function joint(g: Ctx, x: number, y: number, r: number, R: Rand): void {
    const n = 3 + Math.floor(R() * 4);
    g.save();
    g.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n - 0.5) * 2.1 + (R() - 0.5) * 0.4;
      const len = r * (0.7 + R() * 0.9);
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.sin(a) * len * 0.4, y - Math.cos(a) * len * 0.7,
        x + Math.sin(a) * len * 1.2, y - Math.cos(a) * len);
      g.strokeStyle = i < n / 2 ? WEED.line : WEED.lit;
      g.lineWidth = 1.5 - 0.4 * (i / n);
      g.stroke();
    }
    g.restore();
  }

  /**
   * The whole sheet: three tiles by three, laid as one road and cut up after,
   * so nothing repeats inside twelve metres.
   *
   * Every stone is drawn again at each wrap it reaches, off its own seed, so
   * the sheet butts itself on all four sides and a tile butts its neighbour
   * whichever way round the camera has them.
   */
  function paveSheet(): HTMLCanvasElement {
    const c = cnv(PAVE_W, PAVE_W), g = ctxOf(c);
    g.fillStyle = BED;
    g.fillRect(0, 0, PAVE_W, PAVE_W);
    const rows = Math.max(4, Math.round(PAVE_W / SETT));
    /*
     * How deep each course is. All of them at one depth was the tell: a road
     * of stones that vary in every way but one still reads as ruled, because
     * the eye finds the one thing that repeats. They are unequal and they sum
     * to the sheet, which is what lets the sheet still wrap.
     */
    const HR = rand(3313);
    const depths: number[] = []; let dsum = 0;
    for (let r = 0; r < rows; r++) { const v = 0.78 + HR() * 0.52; depths.push(v); dsum += v; }
    const junctions: Array<[number, number]> = [];
    const lay = (x: number, y: number, w: number, h: number, seed: number, t: number): void => {
      for (const dx of [-PAVE_W, 0, PAVE_W]) {
        if (x + dx + w < -4 || x + dx > PAVE_W + 4) continue;
        for (const dy of [-PAVE_W, 0, PAVE_W]) {
          if (y + dy + h < -4 || y + dy > PAVE_W + 4) continue;
          const R = rand(seed);
          const sx = x + dx, sy = y + dy;
          const pts = sett(g, sx, sy, w, h, R, t);
          const q = R();
          if (q < 0.14) knock(g, pts, R);
          if (R() < 0.17) polish(g, pts, sx, sy, w, h, R);
          if (R() < 0.15) sunk(g, pts, R);
        }
      }
    };
    let top = 0;
    for (let r = 0; r < rows; r++) {
      const rh = (depths[r] / dsum) * PAVE_W;
      const y0 = top;
      top += rh;
      const R = rand(4801 + r * 131);
      const n = Math.max(4, Math.round(PAVE_W / (rh * (0.9 + R() * 0.34))));
      const ws: number[] = []; let sum = 0;
      for (let k = 0; k < n; k++) { const w = 0.6 + R() * 1.25; ws.push(w); sum += w; }
      /*
       * Where this course was started and how far it wanders. A road is
       * struck off a string by a man kneeling on the course below it, so no
       * two courses start in the same place and none of them is straight.
       * The wander is a whole number of waves across the sheet, which is what
       * lets it wrap.
       */
      const start = R() * PAVE_W;
      const kw = 1 + Math.floor(R() * 2), amp = rh * (0.08 + R() * 0.13), ph = R() * Math.PI * 2;
      let x = start;
      for (let k = 0; k < n; k++) {
        const w = (ws[k] / sum) * PAVE_W;
        const dy = Math.sin(((x + w / 2) / PAVE_W) * Math.PI * 2 * kw + ph) * amp;
        // The joint, which is packed sand and not mortar: a sett road is laid
        // tight. At four pixels of dark between every pair the road came out
        // as pale chips in grey grout, which is a mosaic floor.
        const gap = 1.2 + R() * 1.1;
        const shrink = rh * 0.12 * R();
        const y = y0 + dy + shrink / 2;
        const tone = R() < 0.14 ? 1 : R() < 0.26 ? 2 : R() < 0.33 ? 3 : R() < 0.4 ? 4 : 0;
        lay(x + gap / 2, y + gap / 2, w - gap, rh - gap - shrink, 7001 + r * 977 + k * 31, tone);
        if (R() < 0.13) junctions.push([x, y0 + rh + dy]);
        x += w;
      }
    }
    // What has seeded where three or four of them meet, which is where the
    // sand washes out and a seed can get down to the bed.
    const JR = rand(6151);
    for (const [jx, jy] of junctions) {
      const r = 3.5 + JR() * 4;
      for (const dx of [-PAVE_W, 0, PAVE_W]) {
        for (const dy of [-PAVE_W, 0, PAVE_W]) {
          if (jx + dx < -12 || jx + dx > PAVE_W + 12 || jy + dy < -12 || jy + dy > PAVE_W + 12) continue;
          joint(g, jx + dx, jy + dy, r, rand(Math.floor(jx * 7 + jy * 13) + 3));
        }
      }
    }
    /*
     * And the lie of the whole road. Ground laid on ground settles into it:
     * there are hollows where the carts run and crowns where they do not, and
     * without them a few hundred setts of equal brightness read as a printed
     * pattern however varied each one is. Soft pools rather than waves -- a
     * sine sampled on a grid came out as banding, which is a worse pattern
     * than the one it was put there to break. Each is drawn again at every
     * wrap it reaches, like the stones.
     */
    const LR = rand(2287);
    for (let i = 0; i < 9; i++) {
      const cx = LR() * PAVE_W, cy = LR() * PAVE_W;
      const r = PAVE_W * (0.1 + LR() * 0.16);
      const ink = LR() < 0.55 ? '0, 0, 0' : '255, 255, 255';
      const a = 0.05 + LR() * 0.05;
      for (const dx of [-PAVE_W, 0, PAVE_W]) {
        for (const dy of [-PAVE_W, 0, PAVE_W]) {
          if (cx + dx + r < 0 || cx + dx - r > PAVE_W || cy + dy + r < 0 || cy + dy - r > PAVE_W) continue;
          const grad = g.createRadialGradient(cx + dx, cy + dy, 0, cx + dx, cy + dy, r);
          grad.addColorStop(0, `rgba(${ink}, ${a.toFixed(3)})`);
          grad.addColorStop(1, `rgba(${ink}, 0)`);
          g.fillStyle = grad;
          g.beginPath();
          g.arc(cx + dx, cy + dy, r, 0, 7);
          g.fill();
        }
      }
    }
    return c;
  }

  /** Painted once, the first time a road comes into view, and cut into its tiles. */
  let paveTiles: HTMLCanvasElement[] | null = null;
  const pave = (): HTMLCanvasElement[] => {
    if (paveTiles) return paveTiles;
    const sheet = paveSheet();
    const out: HTMLCanvasElement[] = [];
    for (let j = 0; j < PAVE_N; j++) {
      for (let i = 0; i < PAVE_N; i++) {
        const c = cnv(PAVE_TILE, PAVE_TILE), g = ctxOf(c);
        g.drawImage(sheet, -i * PAVE_TILE, -j * PAVE_TILE);
        out.push(c);
      }
    }
    paveTiles = out;
    return out;
  };

  return {
    face: FACE,
    arch: ARCHED,
    archIvy: ARCH_IVY,
    archWeed: ARCH_WEED,
    window: WINDOWED,
    winIvy: WIN_IVY,
    winWeed: WIN_WEED,
    door: DOORED,
    doorIvy: DOOR_IVY,
    doorWeed: DOOR_WEED,
    gate: GATED,
    gateIvy: GATE_IVY,
    gateWeed: GATE_WEED,
    bay: BAYED,
    quoinL: S.lay === 'bond' ? quoins(-1) : undefined,
    quoinR: S.lay === 'bond' ? quoins(1) : undefined,
    vigas: VIGAS,
    brow: BROW,
    crest: CREST,
    losses: LOSSES,
    soft: S.lay === 'render',
    shadow: S.shadow,
    top: TONES.top && { lit: channels(TONES.top.lit), hi: channels(TONES.top.hi), shade: channels(TONES.top.shade) },
    wrap: S.lay === 'render' || S.lay === 'frame',
    scatter: S.lay === 'render' || S.lay === 'frame',
    railed: S.lay === 'frame',
    hi: channels(PASTEL.stoneHi),
    low,
    spill: SPILL,
    base: BASE,
    foot: FOOT,
    cap: CAP_STONE,
    ends: ENDS,
    reveal: channels(PASTEL.reveal),
    line: channels(PASTEL.line),
    beam: channels(PASTEL.beam),
    beamLine: channels(PASTEL.beamLine),
    w: TW,
    h: TH,
    plinth: S.plinth,
    shade: S.shade,
    growth: S.growth,
    under: S.lay === 'render' || S.lay === 'frame' ? channels(PASTEL.stone) : undefined,
    pad: PAD,
    capH: CAP_H,
    pave,
    paveN: PAVE_N,
    neutral: NEUTRAL,
    tells: VARIANTS.map((v) => v.tells),
  };
}

/**
 * Paint it while nobody is waiting on it.
 *
 * The whole set is a tenth of a second's drawing on a desktop and several
 * times that on a phone, and it is all done the first time a wall of it comes
 * into view — which is a frame somebody is looking at. So it is asked for
 * once at boot, on the idle the browser hands out after the first screen is
 * up; whoever gets to a wall before the idle does pays for it as before, and
 * the answer is the same one either way.
 */
export function warmMasonry(): void {
  const idle = globalThis.requestIdleCallback;
  // A set to an idle: painting them back to back is that many pauses at once,
  // and the later ones are only wanted by whoever has built in them.
  const sets = [cobble, brickwork, stonework, adobe, timbercraft];
  const next = (i: number): void => {
    if (i >= sets.length) return;
    if (typeof idle === 'function') idle(() => { sets[i](); next(i + 1); });
    else setTimeout(() => { sets[i](); next(i + 1); }, i ? 800 : 1500);
  };
  next(0);
}
