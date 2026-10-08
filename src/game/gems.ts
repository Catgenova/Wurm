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
import type { Item } from './items';
import { SKILL_DEFS } from './skills';
import { article, listed } from './words';

export interface GemDef {
  id: string;
  name: string;
  /** The trade a stone of it favours in whoever wears it. */
  skill: string;
  /** Its share of what the rock gives up: the rarest is one part in the total. */
  weight: number;
  /** A line for the examine window, before what it favours. */
  flavour: string;
  /** The perk a miner has to hold to turn one up, where the rock gives it up only to some (an Artisan's More Stones). */
  perk?: string;
}

/** In the order the island draws them, rarest first. */
export const GEMS: GemDef[] = [
  { id: 'diamond', name: 'Diamond', skill: 'mining', weight: 1, flavour: 'Clear as water and harder than anything else out of the ground.' },
  { id: 'ruby', name: 'Ruby', skill: 'fighting', weight: 2, flavour: 'Red as a coal, and as warm in the hand.' },
  { id: 'sapphire', name: 'Sapphire', skill: 'fishing', weight: 2, flavour: 'Blue as deep water.' },
  { id: 'emerald', name: 'Emerald', skill: 'forestry', weight: 3, flavour: 'Green as a leaf with the sun behind it.' },
  { id: 'garnet', name: 'Garnet', skill: 'blacksmithing', weight: 4, flavour: 'Dark red, the colour of iron in the fire.' },
  { id: 'topaz', name: 'Topaz', skill: 'carpentry', weight: 4, flavour: 'Yellow as new-cut pine.' },
  // An Artisan's More Stones: six more, which the rock gives up only to a miner who has it.
  { id: 'opal', name: 'Opal', skill: 'taming', weight: 2, flavour: 'Every colour in it, moving as it turns.', perk: 'more_stones' },
  { id: 'peridot', name: 'Peridot', skill: 'farming', weight: 3, flavour: 'Green as wheat before it turns.', perk: 'more_stones' },
  { id: 'amethyst', name: 'Amethyst', skill: 'tailoring', weight: 3, flavour: 'The purple of a dyed robe.', perk: 'more_stones' },
  { id: 'jasper', name: 'Jasper', skill: 'pottery', weight: 3, flavour: 'Red-brown as a fired pot.', perk: 'more_stones' },
  { id: 'onyx', name: 'Onyx', skill: 'masonry', weight: 4, flavour: 'Black, banded with white like a course of stone.', perk: 'more_stones' },
  { id: 'amber', name: 'Amber', skill: 'cooking', weight: 4, flavour: 'Honey gone hard, warm in the hand.', perk: 'more_stones' },
];
export const GEM_BY_NAME = new Map(GEMS.map((g) => [g.name.toLowerCase(), g]));

/** One swing in four hundred brings a stone out with the rock. */
export const GEM_ODDS = 1 / 400;
/** What a worn stone is worth on the trade it favours: a knack's worth, while it is worn. */
export const JEWEL_BONUS = 0.1;
/** The pieces a stone is set in, which are the things worn in the jewel slot. */
export const JEWEL_PIECES = ['jewelled_ring', 'jewelled_pendant'];
/**
 * An Artisan's Circlet: a gold band worn on the head, which takes up to
 * `CIRCLET_STONES` stones one at a time, each giving `CIRCLET_SHARE` of what
 * it would set alone. Its stones are its label, by name, one after another.
 */
export const CIRCLET = 'circlet';
export const CIRCLET_STONES = 3;
export const CIRCLET_SHARE = 0.5;
/** How hard a stone is to seat in a circlet, on jewellery; a stone that will not seat is taken out again whole. */
export const CIRCLET_SET = 16;

/** The stone in a thing, read off its label: a gem, or a piece with one set in it. */
export const gemOf = (item: { extra?: string } | undefined): GemDef | undefined =>
  item?.extra ? GEM_BY_NAME.get(item.extra.toLowerCase()) : undefined;

/** The stones set in a thing: a ring's or a pendant's one, or what a circlet has so far. */
export function stonesOf(item: { id: string; extra?: string } | undefined): GemDef[] {
  if (!item) return [];
  if (item.id !== CIRCLET) {
    const one = gemOf(item);
    return one ? [one] : [];
  }
  return (item.extra ?? '').split(',').map((n) => GEM_BY_NAME.get(n.trim().toLowerCase())).filter((g): g is GemDef => !!g);
}

/**
 * What a worn jewel gives on a trade: for each of its stones that favours it,
 * `JEWEL_BONUS` times its setter's mark (an Artisan's Bright Stone), and up to
 * the mark's more by the jewel's quality (Cut True), a circlet's each at
 * `CIRCLET_SHARE` of that. The island's `jewel_gain`.
 */
export function jewelGain(item: Pick<Item, 'id' | 'extra' | 'ql' | 'mark'> | undefined, skill: string): number {
  const stones = stonesOf(item).filter((g) => g.skill === skill).length;
  if (!item || !stones) return 0;
  const each = JEWEL_BONUS * (item.mark?.bright ?? 1) + (item.mark?.cut ?? 0) * (Math.min(100, item.ql) / 100);
  return stones * each * (item.id === CIRCLET ? CIRCLET_SHARE : 1);
}

/** How a trade is called, for the examine line. */
export const tradeName = (id: string): string => (SKILL_DEFS.find((d) => d.id === id)?.name ?? id).toLowerCase();

/** What a circlet has in it, for its examine line: each stone and its trade, and how many of the settings are filled. */
export function circletSays(item: { id: string; extra?: string }): string {
  const s = stonesOf(item);
  if (!s.length) return ` Its ${CIRCLET_STONES} settings are empty.`;
  return ` Set with ${listed(s.map((g) => `${article(g.name)} ${g.name.toLowerCase()} for ${tradeName(g.skill)}`))}: `
    + `${s.length} of its ${CIRCLET_STONES} settings.`;
}

/** The first circlet in a pack with a setting still empty, by the order they were made, as the island takes it. */
export const circletWithRoom = (items: ReadonlyArray<{ uid: number; id: string; extra?: string }>): { uid: number; id: string; extra?: string } | undefined =>
  items.filter((it) => it.id === CIRCLET && stonesOf(it).length < CIRCLET_STONES).sort((a, b) => a.uid - b.uid)[0];

/**
 * Which stone the rock gives up: by weight, the rarest one part in the total,
 * out of the stones there are for this miner -- every one for somebody with
 * the perk a stone asks for (`more`, an Artisan's More Stones), and the rest
 * for everybody. The island's `roll_gem`.
 */
export function rollGem(rand: () => number, more = false): GemDef {
  const pool = GEMS.filter((g) => !g.perk || more);
  const total = pool.reduce((n, g) => n + g.weight, 0);
  let x = rand() * total;
  for (const g of pool) {
    x -= g.weight;
    if (x < 0) return g;
  }
  return pool[pool.length - 1];
}

/**
 * One swing in a few hundred brings out something nobody was mining for, and
 * more for a perk on the job (a Miner's Gem Eye or an Artisan's Gem Finder, `gem:` and
 * the job), which the island had read and the browser had not.
 */
export function maybeGem(g: Game, skill: string, tool: string, job = 'mine'): void {
  if (g.rand() >= g.perk(`gem:${job}`, GEM_ODDS)) return;
  const gem = rollGem(g.rand, g.perk('more_stones', 0) > 0);
  const item = g.gather('gem', { ql: g.productQl(skill, g.toolQl(tool)), extra: gem.name });
  g.logMsg(`Something glints in the rubble: a ${gem.name.toLowerCase()}. (QL ${item.ql.toFixed(1)})`, 'event');
}
