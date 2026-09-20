/**
 * The fourteen trades, and picking one.
 *
 * Sixty-one skills is a lot of things to be good at and no way at all of
 * saying what you *are*. A class is that: fourteen trades, one of them chosen
 * and locked in, each covering a handful of skills that belong together and
 * each opening a small tree of passive nodes of its own.
 *
 * Three rules shape the whole thing, and they are the reason it is fourteen
 * rather than thirty-nine or four.
 *
 * **A card opens at fifty.** Nothing here is offered to somebody who has not
 * done the work: reach fifty in any skill a class covers and its card is on
 * the table. Fifty is half of everything, and `title_def` has handed out names
 * at skill thresholds since the beginning, so a class card is the same shape
 * as a title somebody already earns.
 *
 * **One craft and one combat.** The craft classes are here; the combat ones
 * come beside them and are drawn from the twenty-two skills these leave
 * alone -- the weapon skills, the armour lines, the body, prayer, meditation.
 * The two lists are deliberately disjoint, so no skill gates two cards and
 * nobody can take the same lever twice.
 *
 * **Locked in, but not for ever.** Changing a trade costs `CLASS_CHANGE_COST`
 * in silver, which is deliberately a great deal of it: a lump of gold strikes
 * twenty coins worth ten silver apiece, so the price is two and a half lumps
 * of gold out of the ground, through a smelter and over an anvil. It is a
 * decision you can undo and will not undo twice in an afternoon.
 *
 * Every one of the thirty-nine craft skills belongs to exactly one class. That
 * is checked, not hoped for: `craft.ts` asks both sides for the list and adds
 * it up.
 */

/** Fifty in any skill the class covers, and the card is on the table. */
export const CLASS_AT = 50;

/**
 * What it costs in silver to put a trade down and take another up.
 *
 * Five hundred, against a gold coin worth ten and twenty coins to the lump:
 * two and a half lumps of gold, mined, smelted and struck. Expensive on
 * purpose -- a class you can swap cheaply is a menu, not a trade.
 */
export const CLASS_CHANGE_COST = 500;

export type ClassKind = 'craft' | 'combat';

export interface ClassDef {
  id: string;
  kind: ClassKind;
  name: string;
  /** What the trade is, in the words somebody would use for it. */
  note: string;
  /** The skill it is named for. Its card leads with this one. */
  main: string;
  /** Every skill it covers. Fifty in any one of them opens the card. */
  skills: string[];
  /** What its nodes are about, so the card says something before a tree exists. */
  lever: string;
}

/**
 * The fourteen craft trades.
 *
 * Grouped by what a person actually spends an afternoon doing rather than by
 * the skill list, which is why Smith holds six skills and Fisher holds one.
 * A wide class is easier to open -- fifty in any of six -- and its nodes are
 * spread over six trades to pay for it.
 */
export const CRAFT_CLASSES: ClassDef[] = [
  {
    id: 'terraformer', kind: 'craft', name: 'Terraformer', main: 'digging',
    note: 'Moves the ground. Dirt out of a bank, a slope made walkable, a road laid over it.',
    skills: ['digging', 'paving'],
    lever: 'Ground comes away in bigger bites, and slopes the island would refuse are yours to shift.',
  },
  {
    id: 'miner', kind: 'craft', name: 'Miner', main: 'mining',
    note: 'Works the rock. Ore out of a seam, a tunnel through the hill, and what is buried in it.',
    skills: ['mining', 'prospecting', 'archaeology'],
    lever: 'More out of a vein, a seam found further off, and a face too deep to stand on worked anyway.',
  },
  {
    id: 'mason', kind: 'craft', name: 'Mason', main: 'masonry',
    note: 'Cuts and lays stone. Bricks, slabs, cobble and the walls that go up out of them.',
    skills: ['masonry', 'stonecutting'],
    lever: 'Stone goes further: fewer shards to the brick, fewer bricks to the wall.',
  },
  {
    id: 'carpenter', kind: 'craft', name: 'Carpenter', main: 'carpentry',
    note: 'Works wood, from a plank to a storey. The bench, the frame and the bow.',
    skills: ['carpentry', 'fine_carpentry', 'bowyery', 'fletching'],
    lever: 'Builds higher, wastes less timber, and the fine joinery comes off the bench better.',
  },
  {
    id: 'smith', kind: 'craft', name: 'Smith', main: 'blacksmithing',
    note: 'The forge and the anvil. Lumps out of the smelter, and everything beaten out of them.',
    skills: ['blacksmithing', 'smelting', 'weaponsmithing', 'armorsmithing', 'platesmithing', 'chainsmithing'],
    lever: 'Quality on the anvil, less fuel at the forge, and less ash for the same lump.',
  },
  {
    id: 'forester', kind: 'craft', name: 'Forester', main: 'woodcutting',
    note: 'Keeps the woods. Felling, planting, and an orchard that bears.',
    skills: ['woodcutting', 'forestry'],
    lever: 'Fells faster, takes more from a tree, and the orchard carries a heavier crop.',
  },
  {
    id: 'farmer', kind: 'craft', name: 'Farmer', main: 'farming',
    note: 'Works the field. Sowing, tending, harvest and the mill after it.',
    skills: ['farming', 'milling'],
    lever: 'A heavier crop and more seed back from it; a field goes longer between tends.',
  },
  {
    id: 'cook', kind: 'craft', name: 'Cook', main: 'cooking',
    note: 'Feeds the settlement. The carcass, the pot and the barrel.',
    skills: ['cooking', 'butchering', 'brewing'],
    lever: 'Food that feeds more and keeps longer, which nothing else on this island touches.',
  },
  {
    id: 'tailor', kind: 'craft', name: 'Tailor', main: 'tailoring',
    note: 'Cloth, hide and rope. What is worn, what is slept under and what holds a sail up.',
    skills: ['tailoring', 'leatherworking', 'ropemaking'],
    lever: 'Cloth and hide go further, dye takes deeper, and rigging holds longer.',
  },
  {
    id: 'herdsman', kind: 'craft', name: 'Herdsman', main: 'animal_husbandry',
    note: 'Raises and works wildermon. Taming, breeding, and a deed full of them earning their keep.',
    skills: ['animal_husbandry', 'taming'],
    lever: 'Better foals, more workers to a settlement, and workers that work faster.',
  },
  {
    id: 'naturalist', kind: 'craft', name: 'Naturalist', main: 'foraging',
    note: 'Reads the wild. What can be picked, what it is good for, and what it mends.',
    skills: ['foraging', 'botanizing', 'alchemy', 'first_aid'],
    lever: 'Finds more and finds rarer, and herbs and covers do more when they are used.',
  },
  {
    id: 'fisher', kind: 'craft', name: 'Fisher', main: 'fishing',
    note: 'Takes from the water. Rod, net, trap and bait.',
    skills: ['fishing'],
    lever: 'Nets and traps pull heavier, bait lasts, and water others cannot work is workable.',
  },
  {
    id: 'mender', kind: 'craft', name: 'Mender', main: 'repair',
    note: 'Keeps things alive. Damage off, quality on, and nothing thrown away that could be saved.',
    skills: ['repair', 'restoration'],
    lever: 'Damage comes off faster and improvement sticks -- on anybody’s things, not only your own.',
  },
  {
    id: 'artisan', kind: 'craft', name: 'Artisan', main: 'jewellery',
    note: 'The fine work. A stone set in a band, a pot off the wheel, a sheet of papyrus.',
    skills: ['jewellery', 'pottery', 'papyrusmaking'],
    lever: 'Rarity comes up oftener on fine work, and a worn stone favours its trade harder.',
  },
];

/** Every class there is. The combat trades land beside these. */
export const CLASSES: ClassDef[] = [...CRAFT_CLASSES];

export const classDef = (id: string): ClassDef | undefined => CLASSES.find((c) => c.id === id);

/** The class a skill belongs to, or nothing when it is not a craft skill. */
export const classOfSkill = (skill: string): ClassDef | undefined =>
  CLASSES.find((c) => c.skills.includes(skill));

/**
 * Whether a card is on the table, given what somebody has reached.
 *
 * `at` is asked for one skill at a time rather than handed a whole sheet,
 * because that is the shape both sides have: the browser holds a map and the
 * island holds a table, and neither wants to build the other's.
 */
export const classOpen = (c: ClassDef, at: (skill: string) => number): boolean =>
  c.skills.some((s) => at(s) >= CLASS_AT);

/** What to say when somebody asks for a trade they have not earned. */
export const classRefusal = (c: ClassDef, at: (skill: string) => number): string | null =>
  classOpen(c, at) ? null
    : `You are not a ${c.name.toLowerCase()} yet. That wants ${CLASS_AT} in one of ${
      c.skills.map((s) => s.replace(/_/g, ' ')).join(', ')}.`;
