/**
 * Gems and jewellery.
 *
 * A stone comes out of the rock one swing in a few hundred, at the miner's
 * quality, and each kind favours one trade. A jeweller casts a ring or a
 * pendant at the anvil, two to a lump, and sets the stone in it with a file;
 * worn, the piece is worth a knack on the trade its stone favours, for as
 * long as it is worn. The island reads the same table and the same two
 * numbers, and finds, sets and counts the stone by the same rules.
 */
import type { Game } from './game';
import { SKILL_DEFS } from './skills';

export interface GemDef {
  id: string;
  name: string;
  /** The trade a stone of it favours in whoever wears it. */
  skill: string;
  /** Its share of what the rock gives up: the rarest is one part in the total. */
  weight: number;
  /** A line for the examine window, before what it favours. */
  flavour: string;
}

/** In the order the island draws them, rarest first. */
export const GEMS: GemDef[] = [
  { id: 'diamond', name: 'Diamond', skill: 'mining', weight: 1, flavour: 'Clear as water and harder than anything else out of the ground.' },
  { id: 'ruby', name: 'Ruby', skill: 'fighting', weight: 2, flavour: 'Red as a coal, and as warm in the hand.' },
  { id: 'sapphire', name: 'Sapphire', skill: 'fishing', weight: 2, flavour: 'Blue as deep water.' },
  { id: 'emerald', name: 'Emerald', skill: 'forestry', weight: 3, flavour: 'Green as a leaf with the sun behind it.' },
  { id: 'garnet', name: 'Garnet', skill: 'blacksmithing', weight: 4, flavour: 'Dark red, the colour of iron in the fire.' },
  { id: 'topaz', name: 'Topaz', skill: 'carpentry', weight: 4, flavour: 'Yellow as new-cut pine.' },
];
export const GEM_BY_NAME = new Map(GEMS.map((g) => [g.name.toLowerCase(), g]));

/** One swing in four hundred brings a stone out with the rock. */
export const GEM_ODDS = 1 / 400;
/** What a worn stone is worth on the trade it favours: a knack's worth, while it is worn. */
export const JEWEL_BONUS = 0.1;
/** The pieces a stone is set in, which are the things worn in the jewel slot. */
export const JEWEL_PIECES = ['jewelled_ring', 'jewelled_pendant'];

/** The stone in a thing, read off its label: a gem, or a piece with one set in it. */
export const gemOf = (item: { extra?: string } | undefined): GemDef | undefined =>
  item?.extra ? GEM_BY_NAME.get(item.extra.toLowerCase()) : undefined;

/** How a trade is called, for the examine line. */
export const tradeName = (id: string): string => (SKILL_DEFS.find((d) => d.id === id)?.name ?? id).toLowerCase();

/** Which stone the rock gives up: by weight, the rarest one part in the total. */
export function rollGem(rand: () => number): GemDef {
  const total = GEMS.reduce((n, g) => n + g.weight, 0);
  let x = rand() * total;
  for (const g of GEMS) {
    x -= g.weight;
    if (x < 0) return g;
  }
  return GEMS[GEMS.length - 1];
}

/** One swing in a few hundred brings out something nobody was mining for. */
export function maybeGem(g: Game, skill: string, tool: string): void {
  if (g.rand() >= GEM_ODDS) return;
  const gem = rollGem(g.rand);
  const item = g.gather('gem', { ql: g.productQl(skill, g.toolQl(tool)), extra: gem.name });
  g.logMsg(`Something glints in the rubble: a ${gem.name.toLowerCase()}. (QL ${item.ql.toFixed(1)})`, 'event');
}
