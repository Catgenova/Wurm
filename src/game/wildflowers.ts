/**
 * Picking wildflowers.
 *
 * Where they grow, how thick and in which seasons is `world/flowers.ts`; this
 * is the one thing a pair of hands does about them. A tile in flower gives a
 * wildflower for each clump on it, and is picked bare until the next year
 * begins, with the spring (`FLOWERS_PICKED` in its byte). The island asks the
 * same questions in the same order (`flower_refusal`) and does the same thing
 * (`perform_flowers`), so both say the same words.
 */
import type { ActionDef } from './actions';
import type { Game } from './game';
import { flowerSeason, flowersOn, FLOWER_SEASONS } from '../world/flowers';
import { SEASONS } from '../world/calendar';
import { FLOWERS_PICKED, TILE_DEFS, TileType, trailGround, WEAR_FALL, WEAR_MOST, WEAR_TRAIL, WEARS } from '../world/tiles';
import { listed, numberWord } from './words';
import { swirlSays } from './motes';

/** The clumps of wildflowers on a tile now, as it stands and under whatever stands on it. */
export function flowersHere(g: Game, x: number, y: number, now = Date.now() / 1000): number {
  const w = g.world;
  if (!w.inBounds(x, y) || g.buildings.buildingAt(x, y)) return 0;
  return flowersOn(w.seed, x, y, w.getTile(x, y), w.getData(x, y), flowerSeason(now));
}

/** Why a tile's flowers cannot be picked, or null when they can: the island's `flower_refusal`, word for word. */
export function flowerRefusal(g: Game, x: number, y: number, now = Date.now() / 1000): string | null {
  const w = g.world;
  if (!w.inBounds(x, y)) return 'There is nothing there.';
  if (w.getTile(x, y) !== TileType.Grass) return 'Wildflowers grow on grass.';
  if (g.buildings.buildingAt(x, y)) return 'Nothing flowers inside a building.';
  const season = flowerSeason(now);
  if (!FLOWER_SEASONS.includes(season)) return `Nothing is in flower in ${season}: wildflowers bloom in ${listed(FLOWER_SEASONS)}.`;
  if (w.getData(x, y) & FLOWERS_PICKED) return `The flowers here have been picked. Nothing flowers here again until ${SEASONS[0]}.`;
  if (!flowersHere(g, x, y, now)) return 'There are no flowers here.';
  return null;
}

/** What picking says: how many, and when the tile flowers again. The island's `perform_flowers` says the same. */
export const pickedSays = (n: number): string =>
  `You pick ${n === 1 ? 'a wildflower' : `${numberWord(n)} wildflowers`}. Nothing flowers here again until ${SEASONS[0]}.`;

/**
 * What Examine says about the ground itself: the wear feet have put on it and
 * what is in flower on it. The island's `ground_says` is the same sentence
 * off the same numbers.
 */
export function groundSays(g: Game, x: number, y: number, now = Date.now() / 1000): string {
  const w = g.world;
  const t = w.getTile(x, y);
  const worn = w.wearAt(x, y);
  let said = '';
  if (t === TileType.Trail) {
    const was = TILE_DEFS[trailGround(w.getData(x, y))].name.toLowerCase();
    said += ` Worn bare out of ${was}: ${worn} of ${WEAR_MOST} wear. It loses ${WEAR_FALL} at each turn of the woods and is ${was} again with none left.`;
  } else if (WEARS.has(t) && worn > 0) {
    said += ` Walked: ${worn} of ${WEAR_TRAIL} wear towards a trail.`;
  }
  if (t === TileType.Grass && FLOWER_SEASONS.includes(flowerSeason(now)) && !g.buildings.buildingAt(x, y)) {
    const n = flowersHere(g, x, y, now);
    if (n) said += ` In flower: ${n === 1 ? 'a clump' : `${numberWord(n)} clumps`} of wildflowers.`;
    else if (w.getData(x, y) & FLOWERS_PICKED) said += ` Its flowers have been picked: none until ${SEASONS[0]}.`;
  }
  // And a mote swirl turning over it (`motes.ts`).
  const swirl = g.swirlAt(x, y);
  if (swirl) said += swirlSays(swirl.element);
  return said;
}

export const FLOWER_ACTIONS: ActionDef[] = [
  {
    id: 'pick_flowers',
    label: 'Pick flowers',
    verb: 'picking flowers',
    skill: 'foraging',
    stamina: 0.02,
    baseTime: 3,
    // Offered where there are flowers to see; asked everything again when it is done.
    applies: (t, g) => t.kind === 'tile' && flowersHere(g, t.x, t.y) > 0,
    check: (t, g) => (t.kind === 'tile' ? flowerRefusal(g, t.x, t.y) : 'Choose the ground.'),
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const n = flowersHere(g, t.x, t.y);
      if (!n) return;
      const w = g.world;
      g.gather('wildflowers', { count: n, ql: g.productQl('foraging') });
      w.setTile(t.x, t.y, TileType.Grass, w.getData(t.x, t.y) | FLOWERS_PICKED);
      g.logMsg(pickedSays(n), 'event');
    },
  },
];
