/**
 * Piers and stilts.
 *
 * A building's footprint was flat packed dirt and nothing else, which rules
 * out every hillside and every shore. A tile that slopes, or lies under
 * shallow water, may be taken into a building now by standing its ground
 * floor on piers: the tile's ground floor is a level deck at the building's
 * floor height, carried down to the ground -- or to the bed of the sea or a
 * pond -- on posts braced across (a deck of timber) or on piers of the stone
 * with small arches between them (a deck of stone).
 *
 * **The deck's height.** A building has one floor height. On level ground it
 * is the ground, as it always was. A building planned on a tile that has to
 * stand on piers takes the tile's highest corner, raised to clear the water
 * by `PIER_CLEAR` where the water stands higher than that; one that grows
 * onto piers from level ground keeps that ground's height. Every tile taken
 * in after that has to lie wholly under the deck -- a deck is level -- so a
 * house on a hillside is planned from its highest tile and grows down the
 * slope. The height is kept on the building (`Building.deck`), and which of
 * its tiles stand on piers on the tiles themselves (`Building.piers`), because
 * the ground under a building can never change while it stands.
 *
 * **How far.** A pier spans `PIER_DROP` at most, from the deck down to the
 * lowest corner of the tile, and stands in water `PIER_WATER` deep at most,
 * down to the same corner. Only bare ground or what grows flat on it takes
 * one -- what stepping stones are laid over, `STONE_BEDS` -- so a field, a
 * tree, paving or a flight of steps has to be cleared first.
 *
 * **What it costs.** The deck is the tile's ground-floor floor, planned and
 * built like any floor, in any material, and the piers go on its bill: every
 * `PIER_WALL_DROP` of drop under the tile takes a solid wall's bill of the
 * deck's material, rounded up item by item -- a tenth of a wall for every
 * metre of the tallest post.
 *
 * **Standing on it.** A tile on piers is its deck: once the floor on it is
 * finished it is stood on at the deck's height, and until then it is not
 * stood on at all -- nothing walks under a deck. A deck is stepped onto and
 * off as a poured slab is: the step between it and the tile beside it is held
 * to the climb a body takes between two tile centres (`Game.climbStep`), and
 * higher than that its edge is a drop a body is stopped at, as at the edge of
 * an upper floor. Nothing on a deck is in the water under it. A bridge lands
 * on a finished deck as on a bank, at the deck. No creature, cart, mount or
 * hull goes onto a tile on piers or under one (`Creatures.tileOk`), and a
 * creature on a tile as it is planned on piers is moved off it (`PIER_SHOO`).
 *
 * **What it carries.** A deck carries what it is laid in (`deckCarries`): no
 * wall heavier than its material's `heft` stands on a building whose lightest
 * deck is that material, as no storey stands on a lighter one under it.
 *
 * **What is under it.** Nothing goes onto the tile while a bridge lands on it,
 * anything stands on it or anybody is on it (`Game.pierSiteRefusal`), and the
 * ground under it is not dug, raised, flattened, mined, packed, tilled, paved
 * or planted while the building stands.
 *
 * The island asks the same of the same rows (`deck_surface`, `walk_share`,
 * `in_deep_water`, `creature_tile_ok`, `deck_carries` and the rest), and
 * `supabase/test/piers.ts` holds the two to each other.
 */
import { floorBill, heftWord, MATERIAL_BY_ID, WALL_HEIGHT, type Bill, type Building, type Buildings, type MaterialDef } from './building';
import { STONE_BEDS, TileType } from '../world/tiles';
import type { World } from '../world/world';

/** The most a deck stands over the lowest corner of the ground or bed under its tile: two storeys. */
export const PIER_DROP = 2 * WALL_HEIGHT;
/** The deepest water a pier stands in, down to the lowest corner of the bed under its tile. */
export const PIER_WATER = 20;
/**
 * How far a deck stands clear of any water under it at the least: the joists
 * under its boards (`FLOOR_DEEP`) and a third of a metre of post under them,
 * so that what carries a deck over the water is always to be seen.
 */
export const PIER_CLEAR = 5;
/** The drop under a tile that costs a whole solid wall's bill of the deck's material in piers: a tenth of a wall a metre. */
export const PIER_WALL_DROP = 100;
/**
 * How far a creature standing on a tile is moved when the tile is planned on
 * piers, where nothing goes, or put down on one out of a crate: to the
 * nearest tile it may stand on, this many tiles off at most, ring by ring
 * (`Creatures.shoo`, `Creatures.offPiers`; the island's `pier_shoo()`).
 */
export const PIER_SHOO = 8;

/** A height in metres, to a tenth, as the island says one (`metres`). */
export const metres = (units: number): string => (units / 10).toFixed(1);

/** What a tile offers a pier: its highest and lowest corner, the water standing over it (null where it is dry), and what it is. */
export interface PierGround {
  high: number;
  low: number;
  water: number | null;
  tile: TileType;
}

export function pierGround(world: World, x: number, y: number): PierGround {
  const c = world.tileCorners(x, y);
  return {
    high: Math.max(...c),
    low: Math.min(...c),
    water: world.hasWater(x, y) ? world.surfaceAt(x, y) : null,
    tile: world.getTile(x, y),
  };
}

/** Whether a tile is level, dry ground at `floor` (at its own height when there is none yet): built on as it stands, with no pier. */
export const levelGround = (g: PierGround, floor: number | null): boolean =>
  g.high === g.low && g.water === null && (floor === null || g.high === floor);

/** The deck of a building planned on a tile on piers: the tile's highest corner, or `PIER_CLEAR` over the water there if that is higher. */
export const deckOver = (g: PierGround): number => (g.water === null ? g.high : Math.max(g.high, g.water + PIER_CLEAR));

/** How far a deck stands over the lowest corner of its tile: what its tallest post spans. */
export const pierDrop = (g: PierGround, deck: number): number => deck - g.low;

/**
 * Why a tile cannot stand on piers under a deck at `deck`, or null. `plant`
 * is the water plant growing on it, if one is. The island's `pier_refusal`,
 * word for word and in this order.
 */
export function pierRefusal(g: PierGround, deck: number, plant?: string): string | null {
  if (!STONE_BEDS.has(g.tile)) return 'Piers go down on bare ground or what grows flat on it. Clear what stands or is laid here first.';
  if (plant) return `A ${plant} grows here. Pull it up first.`;
  if (g.high > deck) return `The ground here rises to ${g.high}, over the deck at ${deck}. A deck is level: plan a building on piers from its highest tile.`;
  if (g.water !== null && g.water - g.low > PIER_WATER) {
    return `The water here is ${metres(g.water - g.low)} m deep. A pier stands in ${metres(PIER_WATER)} m of water at most.`;
  }
  if (g.water !== null && deck < g.water + PIER_CLEAR) {
    return `The water here stands at ${g.water} and the deck would be at ${deck}. A deck clears the water by ${metres(PIER_CLEAR)} m.`;
  }
  if (deck - g.low > PIER_DROP) return `The ground falls ${metres(deck - g.low)} m under the deck. A pier spans ${metres(PIER_DROP)} m at most.`;
  return null;
}

/**
 * What the piers under a tile take: a solid wall's bill of the deck's material
 * for every `PIER_WALL_DROP` of drop, rounded up item by item and never to
 * nothing. Worked in whole numbers, as `pier_bill` is on the island.
 */
export function pierBill(material: string, drop: number): Bill {
  const needed: Record<string, number> = {};
  for (const [id, n] of MATERIAL_BY_ID.get(material)?.bill ?? []) needed[id] = Math.max(1, Math.ceil((n * drop) / PIER_WALL_DROP));
  return { needed, total: { ...needed } };
}

/**
 * What Examine says of a tile on piers: its deck, the drop under it, whether
 * the deck is built, and the water under it where that has risen to within
 * `PIER_CLEAR` of the deck since it was planned -- a pond fills to its lip,
 * and the lip can be raised round it. The island's `pier_says`.
 */
export const pierSays = (deck: number, drop: number, built: boolean, water: number | null): string =>
  ` It stands on piers under a deck at ${deck}, ${metres(drop)} m over the lowest ground under it.`
  + (built ? '' : ' The deck is not built: nothing stands on the tile until it is.')
  + (water === null || water + PIER_CLEAR <= deck ? ''
    : ` The water under it has risen to ${water}, ${water < deck ? `${metres(deck - water)} m under the deck` : 'over the deck'}.`);

/**
 * Why a wall or a storey of a material cannot stand on a building on piers,
 * or null: a deck carries what it is laid in (`MaterialDef.heft`), and the
 * lightest deck under a building carries the whole of it, as the lightest
 * wall of a storey carries everything over it (`Buildings.bearing`). `deck`
 * is that deck's material. The island's `deck_carries`.
 */
export function deckCarries(mat: MaterialDef, deck: MaterialDef | undefined, building: string): string | null {
  if (!deck || mat.heft <= deck.heft) return null;
  return `${mat.name} is too heavy for the ${deck.name.toLowerCase()} deck under ${building}: a deck on piers carries what it is laid in, ${heftWord(deck.heft)}, no more.`;
}

/** Why a deck cannot be laid in a material under a building whose heaviest wall is `over`, or null (`deck_carries`'s other half). */
export function deckBears(mat: MaterialDef, over: number, building: string): string | null {
  if (mat.heft >= over) return null;
  return `${mat.name} will not carry the ${heftWord(over)} standing on ${building}: a deck on piers carries what it is laid in.`;
}

/** Two bills as one, item by item: a deck's floor and the piers under it. */
export function billPlus(a: Bill, b: Bill): Bill {
  const needed = { ...a.needed };
  const total = { ...a.total };
  for (const [id, n] of Object.entries(b.needed)) needed[id] = (needed[id] ?? 0) + n;
  for (const [id, n] of Object.entries(b.total)) total[id] = (total[id] ?? 0) + n;
  return { needed, total };
}

/** What a deck on piers takes in `material` over a drop: its floor, and the piers under it. */
export const deckBill = (material: string, drop: number): Bill => billPlus(floorBill(material), pierBill(material, drop));

/**
 * The floor height of a building with no deck of its own yet, at the tile of
 * it beside (x, y): the first of its tiles east, west, south and north --
 * the order `neighbourBuilding` looks in, and `building_floor_near` -- at its
 * poured slab's top or its own flat ground.
 */
export function floorNear(bld: Buildings, world: World, slabTop: (x: number, y: number) => number | null, b: Building, x: number, y: number): number | null {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (bld.buildingAt(x + dx, y + dy)?.id !== b.id) continue;
    return slabTop(x + dx, y + dy) ?? world.getHeight(x + dx, y + dy);
  }
  return null;
}
