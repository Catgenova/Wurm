/**
 * Isometric projection constants and helpers.
 *
 * World space: tiles are addressed by (x, y). Corners of the height map sit on
 * integer coordinates; tile (x, y) is bounded by corners (x,y) (x+1,y) (x+1,y+1) (x,y+1).
 * Heights are integers in "dirt" units, like Wurm: one dig = one unit = 10 cm,
 * a tile is 4 m across.
 *
 * Iso space: a 2:1 diamond projection. Height lifts a point straight up on screen.
 */
export const TILE_W = 64;
export const TILE_H = 32;
export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;

/** Screen pixels (at zoom 1) per height unit. */
export const HEIGHT_SCALE = 1.5;
/** Height units per tile width: a 4 m tile, 0.1 m per unit. */
export const UNITS_PER_TILE = 40;

export function isoX(wx: number, wy: number): number {
  return (wx - wy) * HALF_W;
}

export function isoY(wx: number, wy: number, h: number): number {
  return (wx + wy) * HALF_H - h * HEIGHT_SCALE;
}

/** Inverse projection for a point known to sit at height `h`. */
export function isoToWorld(ix: number, iy: number, h = 0): { x: number; y: number } {
  const a = ix / HALF_W;
  const b = (iy + h * HEIGHT_SCALE) / HALF_H;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}
