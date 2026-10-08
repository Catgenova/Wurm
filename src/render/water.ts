/**
 * The surface of the sea.
 *
 * Water used to be a flat diamond of colour per tile with a faint breathing
 * alpha over it, which from a distance looked like a painted floor. It is a
 * surface now: a long swell and a short chop laid over each other, travelling
 * down the wind at a speed the wind sets, so a hard blow runs visible bands
 * across the bay and a flat calm barely moves at all.
 *
 * Nothing here is stored. The height of the water over a point is a function
 * of the point, the clock and the wind, which means every tile works it out
 * for itself in a line of arithmetic and no two frames have to agree on
 * anything.
 */

/** How many times a second the sea's swell is painted afresh (`Renderer.drawSwell`); it is copied on, moved with the view, in between. */
export const SWELL_RATE = 15;

/** Tiles a second the swell travels at, in a full blow. */
export const SWELL_SPEED = 1.25;

/** The two waves the surface is made of, in tiles from crest to crest. */
export const LONG_WAVE = 9.5;
export const SHORT_WAVE = 3.6;

/**
 * Where the surface stands over a point: -1 in the bottom of a trough, +1 on
 * a crest. The long wave runs square down the wind; the short one is set
 * across it a little, which is what stops the whole bay moving as one sheet.
 */
export function swellAt(x: number, y: number, t: number, dirX: number, dirY: number, force: number): number {
  const along = x * dirX + y * dirY;
  const across = x * dirY - y * dirX;
  const drift = t * SWELL_SPEED * (0.3 + 0.7 * force);
  const a = Math.sin(((along - drift) / LONG_WAVE) * Math.PI * 2);
  const b = Math.sin(((along - drift * 0.64) / SHORT_WAVE) * Math.PI * 2 + across * 0.55);
  return a * 0.62 + b * 0.38;
}

/** How much of the swell actually shows: a calm is glassy, a blow is not. */
export const swellShow = (force: number): number => 0.3 + 0.7 * Math.max(0, Math.min(1, force));

/** How bright a crest goes and how dark a trough, before the wind is counted. */
export const CREST_ALPHA = 0.10;
export const TROUGH_ALPHA = 0.085;

/**
 * Foam at the waterline. The line itself is where the ground crosses zero,
 * which the water polygon already has to work out to know its own shape, so
 * the foam costs one stroke along an edge that was computed anyway. It
 * surges up the beach and back with the swell rather than sitting still.
 */
export const FOAM_WIDTH = 3.2;
export const foamAlpha = (swell: number, force: number): number => 0.3 + 0.34 * Math.max(0, swell) * swellShow(force);

/* ---- And the colour of it, shallow to deep -------------------------------
 *
 * One ramp, read by the world and by the map, because a coastline that is pale
 * green on one and navy on the other is two coastlines. The map used to roll
 * its own — `1 - depth / 60` over a different pair of colours — and the two
 * had never agreed about anything except that water is blue.
 *
 * ## How far down it goes
 *
 * The ramp used to cover thirty-eight height units and the island goes down a
 * hundred and twenty, so **seventy-three per cent of the sea was one flat
 * colour** and the gradient was a fringe a few tiles wide round the shore.
 * Measured on the real island, across a band of it:
 *
 *     0–2      0.8%        20–40   16.7%
 *     2–5      1.5%        40–80   50.0%
 *     5–10     2.5%       80–160   23.0%
 *     10–20    5.6%
 *
 * So the ramp covers the whole hundred and twenty now, and the half of the sea
 * that sits between forty and eighty units down — the open water anybody
 * actually looks at — falls in the middle of it rather than off the end.
 *
 * The steps are not even. `t` is raised to a power below one, which spends
 * more of the ramp on shallow water than on deep: two feet of water and six
 * look quite different and eighty and ninety do not, and the eye reads a coast
 * by the first of those.
 */

/**
 * Pale blue at the water's edge, and a deep one at the bottom.
 *
 * The shallows were 112, 228, 198 -- a bright green-teal, picked when the
 * grass was a yellow-green and the two of them could not have been confused
 * for one another. The field went teal and they could: a beach came out as a
 * cream line between two greens of the same weight, and the shape of the
 * coast, which is the one thing the eye reads a map by, went with it. The sea
 * leans blue now and the land leans green, which is the arrangement everybody
 * already has in their head.
 */
export const WATER_SHALLOW: readonly [number, number, number] = [140, 210, 232];
export const WATER_DEEP: readonly [number, number, number] = [30, 76, 110];

/**
 * How far down the ramp reaches, how deep one step of it is, and so how many
 * colours it is cut into.
 *
 * The cutting is not for the look of it. The colour of a tile of sea is one
 * of these strings, picked out of a table by depth, because a tile works out
 * its colour every frame and building an `rgba(...)` for each of them is a
 * string made and parsed a few hundred times a frame for one of a few dozen
 * answers.
 *
 * It was forty steps of three units, and three units is several tiles of a
 * gently shelving floor, so a band of them came out one colour and the next
 * band jumped. Half a unit a step is finer than any sea floor is flat, and
 * the table is two hundred and forty strings built once, which is nothing.
 *
 * Worth saying plainly: this was *not* what made the bay look terraced. That
 * was the floor itself -- the beds of kelp on it, and its own tile shading
 * seen through water that is only three metres deep out there. The steps were
 * coarser than they needed to be and are not any more, and that is the whole
 * of what this bought.
 *
 * The count comes off the other two rather than being written down beside
 * them, so it cannot come to mean something they do not.
 */
export const WATER_FLOOR = 120;
export const WATER_STEP_UNITS = 0.5;
export const WATER_STEPS = Math.round(WATER_FLOOR / WATER_STEP_UNITS);
/**
 * How far down the sun still lights the bottom the way it lights a hillside.
 *
 * Above the water a tile is shaded by the angle it lies at, which runs from
 * about a half to about one and a tenth: a slope facing the sun against one
 * turned away is more than twice as bright. Under it that was still being
 * done, so a sea floor with any lump in it was faceted like a mountainside,
 * and the water -- which is nowhere near opaque at the depths anybody sails
 * over -- let a quarter of that through. It read as bands and blocks of
 * different blue, and looked for all the world like the depth ramp being cut
 * too coarsely, which it was not.
 *
 * Light that has been through a few feet of water has been scattered by it
 * and does not arrive from one direction any more. So the shading fades out
 * with depth, and by here it is gone and the floor is lit flatly: a bar a
 * foot under still catches the sun on its slopes, and a sea bed twenty feet
 * down does not.
 */
export const WATER_LIT = 18;

/** More of the ramp spent on the shallows, where the eye reads the shape of a coast. */
const WATER_CURVE = 0.7;

/** How far along the ramp a given depth falls, 0 at the waterline and 1 at the bottom. */
export const waterT = (depth: number): number => {
  const step = Math.min(WATER_STEPS - 1, Math.max(0, Math.floor(depth / WATER_STEP_UNITS)));
  return (step / (WATER_STEPS - 1)) ** WATER_CURVE;
};

/**
 * How much of the bottom the water keeps to itself, at a depth.
 *
 * It was a straight line off `t`, which left the open sea at about seven
 * tenths: a floor three metres down was still three parts visible, tile
 * shading and all, and the far water read as a faceted floor rather than as
 * water. The curve here bends it up early, so the shallows stay clear enough
 * to see the shelf and the weed beds on it -- which is the half of this
 * anybody needs to see -- and the deep goes over.
 */
export const waterVeil = (depth: number): number => 0.58 + 0.41 * waterT(depth) ** 0.62;

/** The colour at a depth, before any alpha. */
export function waterRgb(depth: number): [number, number, number] {
  const t = waterT(depth);
  return [
    Math.round(WATER_SHALLOW[0] + (WATER_DEEP[0] - WATER_SHALLOW[0]) * t),
    Math.round(WATER_SHALLOW[1] + (WATER_DEEP[1] - WATER_SHALLOW[1]) * t),
    Math.round(WATER_SHALLOW[2] + (WATER_DEEP[2] - WATER_SHALLOW[2]) * t),
  ];
}

/**
 * And with it, ready to paint.
 *
 * Shallow water is thin enough to see the sand through and deep water is not,
 * so the alpha climbs with the colour — which is most of what makes a shelf
 * read as a shelf rather than as a differently coloured floor.
 */
export const WATER_PALETTE: readonly string[] = Array.from({ length: WATER_STEPS }, (_, i) => {
  const depth = i * WATER_STEP_UNITS;
  const [r, g, b] = waterRgb(depth);
  return `rgba(${r},${g},${b},${waterVeil(depth).toFixed(3)})`;
});

/** The step a depth lands on, for anybody indexing the palette directly. */
export const waterLevel = (depth: number): number =>
  Math.min(WATER_STEPS - 1, Math.max(0, Math.floor(depth / WATER_STEP_UNITS)));

/* ---- The water springs bring up -------------------------------------------
 *
 * Not the sea's. A spring's water is clear and stands shallow over pale
 * ground, so it is turquoise rather than blue: a little deeper teal in the
 * middle of a pond, lighter where it shelves up to the bank, and edged with a
 * thin darker teal where it meets a bank or a wall. Its foam is white, and a
 * fall comes down in streaks of near white and of darker teal. One set of
 * colours for everything that draws it -- a pond, a stream, a fall, a pool
 * poured in a slab -- so that they are all the one water.
 */

/** Spring water where a pond shelves up to its bank, over most of it, and in its deepest middle. */
export const SPRING_SHALLOW: readonly [number, number, number] = [146, 226, 216];
export const SPRING_WATER: readonly [number, number, number] = [104, 208, 204];
export const SPRING_DEEP: readonly [number, number, number] = [66, 174, 180];
/** The thin darker line where it meets a bank or a wall. */
export const SPRING_EDGE: readonly [number, number, number] = [44, 134, 140];
/** Foam, spray and the ripples on the surface. */
export const SPRING_FOAM: readonly [number, number, number] = [248, 254, 252];
/** The two streaks a fall comes down in: the near white, and the darker teal between them. */
export const SPRING_PALE: readonly [number, number, number] = [214, 248, 242];
export const SPRING_DARK: readonly [number, number, number] = [52, 156, 162];

/** How deep spring water is, in height units, where it is its own colour through, and where it is as deep a colour as it goes. */
const SPRING_WATER_AT = 5;
const SPRING_DEEP_AT = 24;
/** How far down the palette below reaches, and how fine it is cut, as with the sea's. */
const SPRING_STEPS = Math.round(SPRING_DEEP_AT / WATER_STEP_UNITS) + 1;

/** The colour of spring water over ground this far below its surface. */
export function springRgb(depth: number): [number, number, number] {
  const d = Math.max(0, depth);
  const [a, b, t] = d < SPRING_WATER_AT
    ? [SPRING_SHALLOW, SPRING_WATER, d / SPRING_WATER_AT]
    : [SPRING_WATER, SPRING_DEEP, Math.min(1, (d - SPRING_WATER_AT) / (SPRING_DEEP_AT - SPRING_WATER_AT))];
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

/** The step of `SPRING_PALETTE` a depth lands on. */
export const springLevel = (depth: number): number =>
  Math.min(SPRING_STEPS - 1, Math.max(0, Math.floor(depth / WATER_STEP_UNITS)));

/**
 * And ready to paint, a string per step, made once: nearly solid, so a pond
 * reads as turquoise water over any ground, with only its shallow rim thin
 * enough to show the bank going down under it.
 */
export const SPRING_PALETTE: readonly string[] = Array.from({ length: SPRING_STEPS }, (_, i) => {
  const depth = i * WATER_STEP_UNITS;
  const [r, g, b] = springRgb(depth);
  return `rgba(${r},${g},${b},${(0.8 + 0.15 * Math.min(1, depth / SPRING_WATER_AT)).toFixed(3)})`;
});
