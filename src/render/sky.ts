/**
 * The sky, and the distance.
 *
 * Past the edge of the island the world used to be a flat dark rectangle —
 * not sea, not sky, just the absence of anything, which is exactly what it
 * looked like. And everything on the map, near or far, was drawn at the same
 * strength, so a headland eight hundred tiles away read as hard and present
 * as the ground under your feet.
 *
 * Both are the same fix: give the far distance a colour, and let whatever is
 * far away fade into it. The colour is the hour's, so the horizon at dusk is
 * the dusk's, and the haze over the distance goes with it.
 */
export type RGB3 = [number, number, number];

export interface Sky {
  /** The top of the sky. */
  top: RGB3;
  /** What it fades to at the bottom of the view, where the distance is. */
  far: RGB3;
  /** How much of that lies over the far ground, 0..1. */
  haze: number;
}

const DAY: { top: RGB3; far: RGB3 } = { top: [104, 162, 214], far: [176, 206, 226] };
const DUSK: { top: RGB3; far: RGB3 } = { top: [86, 96, 152], far: [238, 152, 96] };
const NIGHT: { top: RGB3; far: RGB3 } = { top: [8, 13, 30], far: [20, 30, 58] };

const mix = (a: RGB3, b: RGB3, t: number): RGB3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** How strong the haze is at its thickest, before the zoom is counted. */
export const HAZE_MAX = 0.62;

/** How far down the view the haze reaches, as a share of its height. */
export const HAZE_REACH = 0.62;

/**
 * The sky at this hour. `dark` is the same night strength the rest of the
 * renderer works from, and `twilight` is how close it is to one of the two
 * ends of the day — which is where all the colour in a sky comes from.
 */
export function skyAt(dark: number, twilight: number): Sky {
  const warm = Math.max(0, Math.min(1, twilight));
  const day = { top: mix(DAY.top, DUSK.top, warm), far: mix(DAY.far, DUSK.far, warm) };
  return {
    top: mix(day.top, NIGHT.top, dark),
    far: mix(day.far, NIGHT.far, dark),
    // A clear night has the least haze of anything; noon has a fair amount,
    // and the thickest is the low sun at either end of the day.
    haze: HAZE_MAX * (0.55 + 0.45 * warm) * (1 - dark * 0.72),
  };
}

/**
 * What ground nobody has been to is drawn in. It used to be one flat navy
 * slab whatever the hour, which read as a hole cut in the map; taking half
 * its colour from the far sky makes the edge of what you know look like
 * distance instead — mist at noon, near black at midnight.
 */
/**
 * Ground nobody has ever laid eyes on: black.
 *
 * It used to take half its colour from the sky, which made the unknown a deep
 * blue that read as *water at dusk* — so an island you had not walked looked
 * like an island with a sea in the middle of it, and the edge of what you knew
 * was a soft gradient rather than an edge. Black is not a colour the island
 * has anywhere else, and that is the whole point of it: nothing is drawn there
 * because there is nothing there to draw.
 *
 * It takes a `Sky` it no longer reads, because the horizon and the void used
 * to be the same idea and every caller still passes one; the argument is what
 * keeps the two apart rather than letting the void quietly become sky again.
 */
export function unknownInk(_sky: Sky): RGB3 {
  return [0, 0, 0];
}

export const css = (c: RGB3): string => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
export const rgba = (c: RGB3, a: number): string => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a.toFixed(3)})`;
