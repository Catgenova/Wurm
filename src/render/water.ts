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

/** How many colours the ramp is cut into, and how deep each step reaches. */
export const WATER_STEPS = 40;
export const WATER_STEP_UNITS = 3;
/** More of the ramp spent on the shallows, where the eye reads the shape of a coast. */
const WATER_CURVE = 0.7;

/** How far along the ramp a given depth falls, 0 at the waterline and 1 at the bottom. */
export const waterT = (depth: number): number => {
  const step = Math.min(WATER_STEPS - 1, Math.max(0, Math.floor(depth / WATER_STEP_UNITS)));
  return (step / (WATER_STEPS - 1)) ** WATER_CURVE;
};

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
  return `rgba(${r},${g},${b},${(0.58 + 0.4 * waterT(depth)).toFixed(3)})`;
});

/** The step a depth lands on, for anybody indexing the palette directly. */
export const waterLevel = (depth: number): number =>
  Math.min(WATER_STEPS - 1, Math.max(0, Math.floor(depth / WATER_STEP_UNITS)));
