import { world } from './pace';
/**
 * Light after dark.
 *
 * The island keeps a clock and the night has always been drawn as a cold wash
 * over everything, but nothing in the world ever pushed against it. A candle
 * could be made and its own description promised a lantern that did not exist.
 *
 * This is that lantern, and the rule for everything else that burns: a lit
 * fire, a working oven, a kiln or smelter in blast, and the two creatures that
 * carry a light of their own. Each casts a circle. Inside the circle the night
 * is thinner, and what you can see reaches further.
 */
export interface LightSource {
  x: number;
  y: number;
  /** Tiles the light carries. */
  radius: number;
  /** How hard it pushes back the dark at its middle, 0..1. */
  strength: number;
  /** True for a light that does not breathe: a candle behind cloth, a glow. */
  steady?: boolean;
  /** The colour it throws, as 'r, g, b'; firelight when it does not say. */
  cast?: string;
  /** How strong that colour is at its middle at full dark; a fire's is a sixth of its strength. */
  castAlpha?: number;
  /**
   * A spell's light: at night it falls off smoothly from its middle (`lightFall`) and cuts the dark and adds its cast
   * less the wider it is (`lightHole`), where a lamp's falls off straight at its full strength.
   */
  soft?: boolean;
  /**
   * The storey it burns on: up a storey for a light carried upstairs, `CELLAR_LEVEL` for one down in a cellar;
   * absent is the ground floor, where everything set down stands.
   */
  level?: number;
}

/** Seconds of burning in one candle, at a lantern made perfectly. */
export const CANDLE_BURN = world(22 * 60);

/**
 * What candles are drawn from, and how many to a go: the recipe's numbers
 * (`make_candle` reads them), kept here beside how long one burns so that
 * a lantern can say what one is made of without the recipes, which come
 * round to the lantern's own file through the actions.
 */
export const CANDLE_DRAWN: { count: number; inputs: Array<{ item: string; count?: number }> } = {
  count: 2,
  inputs: [{ item: 'wax', count: 2 }, { item: 'yarn' }],
};

/**
 * How long a candle lasts in this lantern. A well-made lantern keeps the
 * draught off the flame, so the same candle goes half again as far in a good
 * one as in a rough one.
 */
export const candleBurn = (lanternQl: number): number => CANDLE_BURN * (0.7 + Math.max(1, Math.min(100, lanternQl)) / 160);

/** How far a lantern throws, in tiles: five at the roughest, nine at the best. */
export const lanternReach = (lanternQl: number): number => 5 + Math.round(Math.max(1, Math.min(100, lanternQl)) / 25);

/**
 * A torch: a rag on a stick, and the poor relation of the lantern in every way
 * that matters. It throws less light, it burns for minutes rather than the
 * better part of an hour, and when it is done it is done — there is nothing
 * left to put a fresh candle in.
 *
 * What it has over a lantern is that anybody can make one out of a shaft and a
 * scrap of cloth in the first hour of a new island, which is exactly when the
 * dark is worst.
 */
export const TORCH_BURN = world(5 * 60);
/** How long this torch burns: a well-wound one holds its pitch. */
export const torchBurn = (ql: number): number => TORCH_BURN * (0.7 + Math.max(1, Math.min(100, ql)) / 140);
/** How far a torch throws: three at the roughest, five at the best. */
export const torchReach = (ql: number): number => 3 + Math.round(Math.max(1, Math.min(100, ql)) / 50);

/** Things you can carry alight, and how far each of them throws. */
export const HELD_LIGHTS = ['lantern', 'torch'] as const;
export const heldReach = (id: string, ql: number): number => (id === 'torch' ? torchReach(ql) : lanternReach(ql));

/** What a lit fire throws, by what it is. */
export const FIRE_REACH = 5;
export const OVEN_REACH = 4;
export const FORGE_REACH = 6;
/**
 * And an altar's stars: a small pool of lavender round the stone, steady, and
 * only for the look of it -- what a light reaches is drawn, never asked about
 * by any rule. It is kept faint, about what a campfire casts, so the stars
 * and not the stone they light are the brightest thing there; the stars
 * themselves shine through the wash on their own (`furnitureHoles` in the
 * renderer).
 */
export const ALTAR_REACH = 0.9;
export const ALTAR_GLOW = 0.4;
export const ALTAR_CAST = '184, 160, 240';
export const ALTAR_CAST_ALPHA = 0.18;

/**
 * What the night is worth over a point, given everything burning near it: 1
 * where nothing reaches and 0 in the middle of a good fire. The falloff is
 * square rather than linear, so a light has a bright heart and a soft edge
 * instead of a hard disc.
 */
export function litness(lights: LightSource[], x: number, y: number): number {
  let lift = 0;
  for (const l of lights) {
    const d = Math.hypot(l.x - x, l.y - y);
    if (d >= l.radius) continue;
    const near = 1 - d / l.radius;
    lift = Math.max(lift, l.strength * near * near);
  }
  return 1 - Math.min(1, lift);
}
