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
