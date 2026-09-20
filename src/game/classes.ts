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

/*
 * ---------------------------------------------------------------------------
 * The trees.
 * ---------------------------------------------------------------------------
 *
 * Nine nodes to a trade, in three columns of three. A column is one thing the
 * trade gets better at: the first two are minor and cost a point each, and the
 * third is major, costs three, and wants the two under it first.
 *
 * Taking a whole column is five points. You get twelve at the top of the
 * trade, so two columns and a little, never all three -- which is the whole
 * point of a tree. Nothing here is an ability: every node is a number that is
 * quietly true while you work.
 *
 * A node only tells on the skills its own trade covers. A Miner's quick hands
 * are quick at mining, prospecting and archaeology and nowhere else, so two
 * people with the same node in different trades are not the same person.
 */

/** The four things a node can move, each wired at exactly one place. */
export type Channel = 'hands' | 'learn' | 'wind' | 'fine';

/** What each channel means, and which way its numbers run. */
export const CHANNELS: Record<Channel, { name: string; note: string; lower: boolean }> = {
  hands: { name: 'Hands', note: 'How long a go takes.', lower: true },
  learn: { name: 'Learning', note: 'What a go teaches you.', lower: false },
  wind: { name: 'Wind', note: 'What a go takes out of you.', lower: true },
  fine: { name: 'Fineness', note: 'The quality of what comes off the bench.', lower: false },
};

/** A column of three: two minor, then the major that wants them both. */
export interface Column {
  /** The two minor nodes take this name, with I and II after it. */
  name: string;
  /** The major at the top of the column, which has a name of its own. */
  major: string;
  channel: Channel;
  note: string;
}

export interface NodeDef {
  id: string;
  class: string;
  /** Which of the trade's three columns it stands in, one-based. */
  col: number;
  name: string;
  note: string;
  channel: Channel;
  /** 1 and 2 are minor and cost a point; 3 is major and costs three. */
  rank: 1 | 2 | 3;
  cost: number;
  /** The node under this one, which has to be taken first. */
  needs: string | null;
  /** What it multiplies its channel by. */
  mul: number;
}

/** What each rank costs, and what it is worth. `lower` channels run the other way. */
const RANK = [
  { cost: 1, up: 1.03, down: 0.97 },
  { cost: 1, up: 1.04, down: 0.96 },
  { cost: 3, up: 1.10, down: 0.90 },
] as const;

/** Fineness is the strongest thing on this island, so it moves least. */
const FINE = [1.02, 1.03, 1.06] as const;

/** Nothing at all below this, so the first point is earned rather than given. */
export const CLASS_POINT_FLOOR = 40;
/** And one more point for every this much above it. */
export const CLASS_POINT_STEP = 5;

/**
 * What a trade is worth in points: two at fifty, twelve at a hundred.
 *
 * Off the *best* skill the trade covers rather than the sum of them, so Smith
 * with six skills and Fisher with one reach the same twelve. A wide trade is
 * easier to open and has more ways to get there; it does not get more tree.
 */
export const classPoints = (best: number): number =>
  Math.max(0, Math.floor((Math.min(100, best) - CLASS_POINT_FLOOR) / CLASS_POINT_STEP));

/** The most anybody can have, which is what a full trade is worth. */
export const CLASS_POINTS_MAX = classPoints(100);

/** What a whole column costs: two minors and the major over them. */
export const COLUMN_COST = 5;

const ROMAN = ['I', 'II'];

/** The three columns of every trade, in the order they are drawn. */
export const CLASS_COLUMNS: Record<string, [Column, Column, Column]> = {
  terraformer: [
    { name: 'Spadework', major: 'Ditcher', channel: 'hands', note: 'The spade goes in and comes up without thinking about it.' },
    { name: 'Back', major: 'Tireless', channel: 'wind', note: 'A day of moving ground costs you less of one.' },
    { name: 'Eye for a Level', major: 'Surveyor', channel: 'learn', note: 'You read what the ground is doing while you change it.' },
  ],
  miner: [
    { name: 'Swing', major: 'Facewright', channel: 'hands', note: 'The pick finds the seam rather than the rock beside it.' },
    { name: 'Lungs', major: 'Deep Breath', channel: 'wind', note: 'Bad air and long shifts trouble you less.' },
    { name: 'Ear for Rock', major: 'Dowser', channel: 'learn', note: 'You hear what is behind a face before you open it.' },
  ],
  mason: [
    { name: 'Chisel', major: 'Straight Cut', channel: 'hands', note: 'Stone parts where you meant it to.' },
    { name: 'Dressing', major: 'True Face', channel: 'fine', note: 'A block comes off the bench square.' },
    { name: 'Grain', major: 'Quarryman', channel: 'learn', note: 'You learn a stone by the way it breaks.' },
  ],
  carpenter: [
    { name: 'Plane', major: 'Sure Hand', channel: 'hands', note: 'Less measuring, fewer passes.' },
    { name: 'Joinery', major: 'Dovetail', channel: 'fine', note: 'What you fit together stays fitted.' },
    { name: 'Grain', major: 'Woodwise', channel: 'learn', note: 'Every board teaches you the next one.' },
  ],
  smith: [
    { name: 'Hammer', major: 'Quick Heat', channel: 'hands', note: 'The metal is worked before it cools.' },
    { name: 'Temper', major: 'Watered Steel', channel: 'fine', note: 'The edge holds because you knew when to stop.' },
    { name: 'Forge Sense', major: 'Mastersmith', channel: 'learn', note: 'Colour, sound and smell, all telling you the same thing.' },
  ],
  forester: [
    { name: 'Felling', major: 'Clean Drop', channel: 'hands', note: 'The tree comes down where you said it would.' },
    { name: 'Stride', major: 'Long Day', channel: 'wind', note: 'A day in the woods is a walk, not a march.' },
    { name: 'Woodcraft', major: 'Silvanist', channel: 'learn', note: 'You read a stand the way other people read a page.' },
  ],
  farmer: [
    { name: 'Rhythm', major: 'Broad Sweep', channel: 'hands', note: 'Sowing and reaping fall into a pace that does not break.' },
    { name: 'Stoop', major: 'Strong Back', channel: 'wind', note: 'Bent double all day and still standing at the end of it.' },
    { name: 'Weather Eye', major: 'Husbandman', channel: 'learn', note: 'The field tells you what it wants and you hear it.' },
  ],
  cook: [
    { name: 'Knife', major: 'Quick Prep', channel: 'hands', note: 'Everything is ready before the pot is hot.' },
    { name: 'Palate', major: 'Feast', channel: 'fine', note: 'You taste what is missing and put it in.' },
    { name: 'Recipe Sense', major: 'Kitchenwise', channel: 'learn', note: 'One good dish teaches you three more.' },
  ],
  tailor: [
    { name: 'Needle', major: 'Running Stitch', channel: 'hands', note: 'The seam goes down in one pass.' },
    { name: 'Cut', major: 'Fitted', channel: 'fine', note: 'Cloth falls the way it was meant to.' },
    { name: 'Cloth Sense', major: 'Draper', channel: 'learn', note: 'You know a weave by feel and what it will take.' },
  ],
  herdsman: [
    { name: 'Handling', major: 'Quiet Voice', channel: 'hands', note: 'Beasts do what you ask the first time.' },
    { name: 'Stockman’s Eye', major: 'Bloodline', channel: 'learn', note: 'You see what a beast will become while it is still small.' },
    { name: 'Patience', major: 'All Day', channel: 'wind', note: 'Waiting on an animal costs you nothing.' },
  ],
  naturalist: [
    { name: 'Gathering', major: 'Full Basket', channel: 'hands', note: 'Your hands are on it before your eyes have finished.' },
    { name: 'Herb Lore', major: 'Apothecary', channel: 'learn', note: 'Every leaf you pick tells you about the next.' },
    { name: 'Wandering', major: 'Far Walk', channel: 'wind', note: 'A day off the path takes nothing out of you.' },
  ],
  fisher: [
    { name: 'Cast', major: 'Set the Hook', channel: 'hands', note: 'The line goes where you looked.' },
    { name: 'Standing', major: 'Sea Legs', channel: 'wind', note: 'Hours in the water and on a deck, and no weight in your legs.' },
    { name: 'Watercraft', major: 'Reads the Water', channel: 'learn', note: 'You know where they are before you have caught one.' },
  ],
  mender: [
    { name: 'Repair', major: 'Good as New', channel: 'hands', note: 'You find the fault at once instead of looking for it.' },
    { name: 'Restoration', major: 'Better Than Found', channel: 'fine', note: 'What you mend comes back better than it went.' },
    { name: 'Wear Sense', major: 'Keeper', channel: 'learn', note: 'You learn a thing by what broke it.' },
  ],
  artisan: [
    { name: 'Setting', major: 'Sure Claw', channel: 'hands', note: 'The stone seats first time.' },
    { name: 'Finish', major: 'Jeweller’s Eye', channel: 'fine', note: 'The last tenth of the work, which is most of the worth.' },
    { name: 'Craft Sense', major: 'Maker', channel: 'learn', note: 'Fine work teaches fast, when you are paying attention.' },
  ],
};

/** Every node there is, built from the columns rather than written out twice. */
export const CLASS_NODES: NodeDef[] = CRAFT_CLASSES.flatMap((c) =>
  CLASS_COLUMNS[c.id].flatMap((col, ci) => ([1, 2, 3] as const).map((rank) => {
    const r = RANK[rank - 1];
    const lower = CHANNELS[col.channel].lower;
    const mul = col.channel === 'fine' ? FINE[rank - 1] : (lower ? r.down : r.up);
    return {
      id: `${c.id}_${ci + 1}_${rank}`,
      class: c.id,
      col: ci + 1,
      name: rank === 3 ? col.major : `${col.name} ${ROMAN[rank - 1]}`,
      note: col.note,
      channel: col.channel,
      rank,
      cost: r.cost,
      needs: rank === 1 ? null : `${c.id}_${ci + 1}_${rank - 1}`,
      mul,
    } as NodeDef;
  })));

export const nodeDef = (id: string): NodeDef | undefined => CLASS_NODES.find((n) => n.id === id);

/** What a set of taken nodes comes to, channel by channel. */
export function foldNodes(taken: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of taken) {
    const n = nodeDef(id);
    if (!n) continue;
    out[n.channel] = (out[n.channel] ?? 1) * n.mul;
  }
  return out;
}

/** What a set of taken nodes has cost, which is what comes off the twelve. */
export const classSpent = (taken: readonly string[]): number =>
  taken.reduce((n, id) => n + (nodeDef(id)?.cost ?? 0), 0);

/**
 * Why a node cannot be taken, or nothing.
 *
 * Four refusals and no fifth: it is not your trade's, you have it, the one
 * under it is not taken, or you cannot afford it. There is deliberately no
 * "put it down" -- a node taken is taken, and the only way to clear a tree is
 * to put the whole trade down, which costs `CLASS_CHANGE_COST`. That is the
 * expensive undo, and it is the same one the trade already had.
 *
 * Spending a point badly is survivable and is meant to be: twelve points buys
 * two whole columns and two over, so one wasted still leaves two columns and
 * one. It is only at the top that the tree is tight, and by then nobody is
 * short of five hundred silver.
 */
export function nodeRefusal(
  n: NodeDef, mine: string | null, taken: readonly string[], points: number,
): string | null {
  if (n.class !== mine) {
    return `That is the ${(classDef(n.class)?.name ?? n.class).toLowerCase()}’s, and you are not one.`;
  }
  if (taken.includes(n.id)) return 'You have that already.';
  if (n.needs && !taken.includes(n.needs)) return `${nodeDef(n.needs)?.name ?? n.needs} comes first.`;
  const left = points - classSpent(taken);
  if (left < n.cost) {
    return `${n.name} wants ${n.cost} point${n.cost === 1 ? '' : 's'} and you have ${left}.`
      + ` Every ${CLASS_POINT_STEP} in the trade is another one.`;
  }
  return null;
}
