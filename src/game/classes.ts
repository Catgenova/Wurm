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
  /** Which skills the trade's nodes tell on, said from `skills`: see the loop under the trees. */
  note: string;
  /** The skill it is named for. Its card leads with this one. */
  main: string;
  /** Every skill it covers. Fifty in any one of them opens the card. */
  skills: string[];
  /** What the whole tree is worth bought out, said from `STEP`: see the loop under the trees. */
  lever: string;
}

/**
 * A trade as it is written: everything but the two lines said about it, which
 * are worked out from its skills and its tree once both exist, so nothing
 * here can say something the rules do not.
 */
type ClassSeed = Omit<ClassDef, 'note' | 'lever'>;

/**
 * The fourteen craft trades.
 *
 * Grouped by what a person actually spends an afternoon doing rather than by
 * the skill list, which is why Smith holds six skills and Fisher holds one.
 * A wide class is easier to open -- fifty in any of six -- and its nodes are
 * spread over six trades to pay for it.
 */
export const CRAFT_CLASSES = ([
  {
    id: 'terraformer', kind: 'craft', name: 'Terraformer', main: 'digging',
    skills: ['digging', 'paving'],
  },
  {
    id: 'miner', kind: 'craft', name: 'Miner', main: 'mining',
    skills: ['mining', 'prospecting', 'archaeology'],
  },
  {
    id: 'mason', kind: 'craft', name: 'Mason', main: 'masonry',
    skills: ['masonry', 'stonecutting'],
  },
  {
    id: 'carpenter', kind: 'craft', name: 'Carpenter', main: 'carpentry',
    skills: ['carpentry', 'fine_carpentry', 'bowyery', 'fletching'],
  },
  {
    id: 'smith', kind: 'craft', name: 'Smith', main: 'blacksmithing',
    skills: ['blacksmithing', 'smelting', 'weaponsmithing', 'armorsmithing', 'platesmithing', 'chainsmithing'],
  },
  {
    id: 'forester', kind: 'craft', name: 'Forester', main: 'woodcutting',
    skills: ['woodcutting', 'forestry'],
  },
  {
    id: 'farmer', kind: 'craft', name: 'Farmer', main: 'farming',
    skills: ['farming', 'milling'],
  },
  {
    id: 'cook', kind: 'craft', name: 'Cook', main: 'cooking',
    skills: ['cooking', 'butchering', 'brewing'],
  },
  {
    id: 'tailor', kind: 'craft', name: 'Tailor', main: 'tailoring',
    skills: ['tailoring', 'leatherworking', 'ropemaking'],
  },
  {
    id: 'herdsman', kind: 'craft', name: 'Herdsman', main: 'animal_husbandry',
    skills: ['animal_husbandry', 'taming'],
  },
  {
    id: 'naturalist', kind: 'craft', name: 'Naturalist', main: 'foraging',
    skills: ['foraging', 'botanizing', 'alchemy', 'first_aid'],
  },
  {
    id: 'fisher', kind: 'craft', name: 'Fisher', main: 'fishing',
    skills: ['fishing'],
  },
  {
    id: 'mender', kind: 'craft', name: 'Mender', main: 'repair',
    skills: ['repair', 'restoration'],
  },
  {
    id: 'artisan', kind: 'craft', name: 'Artisan', main: 'jewellery',
    skills: ['jewellery', 'pottery', 'papyrusmaking'],
  },
] satisfies ClassSeed[]) as ClassDef[];

/**
 * The seven trades that are not magic.
 *
 * Drawn from the twenty-two skills the craft trades leave alone, plus two that
 * had to be made: `throwing`, because three utility knives at five damage
 * cannot carry a ranged trade, and `chirurgy`, because closing a wound and
 * making the thing you close it with are two different pieces of knowledge and
 * only one of them belongs to a forager.
 *
 * Eight of the twenty-two belong to nobody on purpose -- `fighting`,
 * `body_control`, `body_stamina`, `body_strength`, `swimming`, `mind_logic`,
 * `prayer` and `meditation`. They are the body and the soul, common to all ten,
 * and `fighting` could not be owned even if it should be: it is the scope key
 * every melee swing already carries, so a trade that held it would move
 * everybody's numbers.
 *
 * The three magic trades land beside these and are drawn from stones rather
 * than from skills anybody already has.
 */
export const COMBAT_CLASSES = ([
  {
    id: 'blade', kind: 'combat', name: 'Sworn Blade', main: 'swords',
    skills: ['swords', 'shields', 'chain_armour'],
  },
  {
    id: 'berserker', kind: 'combat', name: 'Berserker', main: 'axes',
    skills: ['axes', 'mauls'],
  },
  {
    id: 'pikeman', kind: 'combat', name: 'Pikeman', main: 'polearms',
    skills: ['polearms', 'plate_armour'],
  },
  {
    id: 'archer', kind: 'combat', name: 'Archer', main: 'archery',
    skills: ['archery', 'awareness', 'leather_armour'],
  },
  {
    id: 'skirmisher', kind: 'combat', name: 'Skirmisher', main: 'throwing',
    skills: ['throwing', 'knives', 'climbing'],
  },
  {
    id: 'chirurgeon', kind: 'combat', name: 'Chirurgeon', main: 'chirurgy',
    skills: ['chirurgy', 'cloth_armour'],
  },
  {
    id: 'beastmaster', kind: 'combat', name: 'Beastmaster', main: 'soul_strength',
    skills: ['soul_strength'],
  },
] satisfies ClassSeed[]) as ClassDef[];

/**
 * And the three schools of the one art.
 *
 * Each gates on its own school skill and on nothing else, so none of them
 * touches a skill any other trade wanted -- which is what let the arcane
 * arrive without moving a single boundary that was already drawn.
 *
 * They share their three channels on purpose. A kindler and a warder are not
 * two kinds of person with different hands; they are two people who learned
 * different things to say to a stone, and it is the spell list that says
 * which. `force`, `reach` and `thrift` are what *any* of them can get better
 * at, and the scope key keeps a kindler's thrift out of a warder's topaz.
 */
export const MAGIC_CLASSES = ([
  {
    id: 'kindler', kind: 'combat', name: 'Kindler', main: 'kindling',
    skills: ['kindling'],
  },
  {
    id: 'binder', kind: 'combat', name: 'Binder', main: 'binding',
    skills: ['binding'],
  },
  {
    id: 'warder', kind: 'combat', name: 'Warder', main: 'warding',
    skills: ['warding'],
  },
] satisfies ClassSeed[]) as ClassDef[];

/** Every class there is: fourteen trades, seven ways to fight, three schools. */
export const CLASSES: ClassDef[] = [...CRAFT_CLASSES, ...COMBAT_CLASSES, ...MAGIC_CLASSES];

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

/**
 * What to say when somebody asks for a trade they have not earned.
 *
 * "An" before a vowel, the way the bins have said it since they were named.
 * Twenty-two of the twenty-four read the same either way; the archer and the
 * artisan did not, and the trades window puts this sentence on the card rather
 * than in a log line nobody rereads.
 */
export const classRefusal = (c: ClassDef, at: (skill: string) => number): string | null =>
  classOpen(c, at) ? null
    : `You are not ${/^[aeiou]/i.test(c.name) ? 'an' : 'a'} ${c.name.toLowerCase()} yet. `
      + `That wants ${CLASS_AT} in one of ${c.skills.map((s) => s.replace(/_/g, ' ')).join(', ')}.`;

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

/**
 * The things a node can move, each wired at exactly one place.
 *
 * Four came with the craft trades. Five more were wanted by the fighting ones,
 * and every one of them had to pass the same test before it was allowed to
 * exist: is there already exactly one line in the rules where this number is
 * decided? There was, for all five -- `weapon_damage`, `hit_chance`,
 * `hurt_player`, `wound_close`, and `attack_of` beside `max_health` and
 * `tame_chance`.
 *
 * `hands` and `wind` are shared between the two halves and needed nothing new
 * at all, because a swing is an action like any other: it has a duration and it
 * costs wind. The only thing it wanted was a truer name for what it was done
 * *with* -- see `act_scope` on the island.
 */
export type Channel =
  | 'hands' | 'learn' | 'wind' | 'fine'
  | 'edge' | 'aim' | 'guard' | 'knit' | 'hide' | 'fang' | 'tame'
  | 'force' | 'reach' | 'thrift';

/**
 * What each channel means, and which way its numbers run.
 *
 * `note` names the one number the channel multiplies, in the terms the rest of
 * the game uses for it, and nothing else. It is read straight onto the cards
 * somebody is looking at to decide how to spend a point, and prose that sets a
 * mood instead of naming a mechanic is worse there than saying nothing. Each
 * of these is the line in the rules where the number is decided, in words.
 */
export const CHANNELS: Record<Channel, { name: string; note: string; lower: boolean }> = {
  hands: { name: 'Hands', note: 'Time per action', lower: true },
  learn: { name: 'Learning', note: 'Skill gained per action', lower: false },
  wind: { name: 'Wind', note: 'Stamina per action', lower: true },
  fine: { name: 'Fineness', note: 'Quality of what you make', lower: false },
  edge: { name: 'Edge', note: 'Damage per hit', lower: false },
  aim: { name: 'Aim', note: 'Chance to hit', lower: false },
  guard: { name: 'Guard', note: 'Damage stopped by shield and armour', lower: false },
  knit: { name: 'Knitting', note: 'Wound healing speed', lower: false },
  hide: { name: 'Hide', note: 'Maximum health of creatures you keep', lower: false },
  fang: { name: 'Fang', note: 'Damage dealt by creatures you keep', lower: false },
  tame: { name: 'Quiet', note: 'Chance to tame', lower: false },
  force: { name: 'Force', note: 'Spell damage, hold and skin', lower: false },
  reach: { name: 'Reach', note: 'Spell range', lower: false },
  thrift: { name: 'Thrift', note: 'Stone wear per cast', lower: true },
};

/** A column of three: two minor, then the major that wants them both. */
export interface Column {
  /** The two minor nodes take this name, with I and II after it. */
  name: string;
  /** The major at the top of the column, which has a name of its own. */
  major: string;
  channel: Channel;
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

/** What a rank costs: two minors at a point, then the major at three. */
const COST = [1, 1, 3] as const;

/**
 * What each rank of each channel is worth.
 *
 * One table rather than an up-and-down pair with a special case bolted on,
 * because once there were nine channels the special case was the rule. The
 * craft four are the numbers they always were, to the digit -- `hands` and
 * `wind` fall, `learning` rises, and `fineness` moves least of the four
 * because quality is the strongest thing on this island.
 *
 * The fighting five are scaled by how much room the number they move has.
 * `aim` moves least: it is a probability with a hard ceiling at 0.96, so a
 * tenth on it is mostly spent against the cap. `knit` moves most: closing a
 * wound is slow enough that a fifth is still slower than a bandage.
 */
const STEP: Record<Channel, readonly [number, number, number]> = {
  hands: [0.97, 0.96, 0.90],
  wind: [0.97, 0.96, 0.90],
  learn: [1.03, 1.04, 1.10],
  fine: [1.02, 1.03, 1.06],
  edge: [1.03, 1.04, 1.09],
  aim: [1.02, 1.02, 1.05],
  guard: [1.03, 1.04, 1.09],
  knit: [1.05, 1.06, 1.15],
  hide: [1.04, 1.05, 1.12],
  fang: [1.04, 1.05, 1.12],
  tame: [1.03, 1.04, 1.10],
  force: [1.04, 1.05, 1.12],
  reach: [1.05, 1.06, 1.15],
  thrift: [0.97, 0.96, 0.90],
};
/**
 * A multiplier said as the change it makes, which is what a card shows.
 *
 * The change to the number, and nothing about whether the change is welcome:
 * `0.97` is "−3%" and `1.04` is "+4%". Which of those is good is the
 * channel's own business -- less time per action and less stone per cast are
 * both wanted -- and a rite may push one of its channels the wrong way on
 * purpose, so the sign comes off the multiplier rather than off the channel.
 *
 * Derived from the number itself rather than written beside it, so the two can
 * never come apart.
 */
export const channelSays = (mul: number): string => {
  const pct = Math.round((mul - 1) * 100);
  return `${pct < 0 ? '\u2212' : '+'}${Math.abs(pct)}%`;
};

/** What a whole column of three comes to, which is what a trade is worth fully bought. */
export const channelFull = (channel: Channel): number =>
  STEP[channel][0] * STEP[channel][1] * STEP[channel][2];


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

/** The three columns of every craft trade, in the order they are drawn. */
const CRAFT_COLUMNS: Record<string, [Column, Column, Column]> = {
  terraformer: [
    { name: 'Spadework', major: 'Ditcher', channel: 'hands' },
    { name: 'Back', major: 'Tireless', channel: 'wind' },
    { name: 'Eye for a Level', major: 'Surveyor', channel: 'learn' },
  ],
  miner: [
    { name: 'Swing', major: 'Facewright', channel: 'hands' },
    { name: 'Lungs', major: 'Deep Breath', channel: 'wind' },
    { name: 'Ear for Rock', major: 'Dowser', channel: 'learn' },
  ],
  mason: [
    { name: 'Chisel', major: 'Straight Cut', channel: 'hands' },
    { name: 'Dressing', major: 'True Face', channel: 'fine' },
    { name: 'Grain', major: 'Quarryman', channel: 'learn' },
  ],
  carpenter: [
    { name: 'Plane', major: 'Sure Hand', channel: 'hands' },
    { name: 'Joinery', major: 'Dovetail', channel: 'fine' },
    { name: 'Grain', major: 'Woodwise', channel: 'learn' },
  ],
  smith: [
    { name: 'Hammer', major: 'Quick Heat', channel: 'hands' },
    { name: 'Temper', major: 'Watered Steel', channel: 'fine' },
    { name: 'Forge Sense', major: 'Mastersmith', channel: 'learn' },
  ],
  forester: [
    { name: 'Felling', major: 'Clean Drop', channel: 'hands' },
    { name: 'Stride', major: 'Long Day', channel: 'wind' },
    { name: 'Woodcraft', major: 'Silvanist', channel: 'learn' },
  ],
  farmer: [
    { name: 'Rhythm', major: 'Broad Sweep', channel: 'hands' },
    { name: 'Stoop', major: 'Strong Back', channel: 'wind' },
    { name: 'Weather Eye', major: 'Husbandman', channel: 'learn' },
  ],
  cook: [
    { name: 'Knife', major: 'Quick Prep', channel: 'hands' },
    { name: 'Palate', major: 'Feast', channel: 'fine' },
    { name: 'Recipe Sense', major: 'Kitchenwise', channel: 'learn' },
  ],
  tailor: [
    { name: 'Needle', major: 'Running Stitch', channel: 'hands' },
    { name: 'Cut', major: 'Fitted', channel: 'fine' },
    { name: 'Cloth Sense', major: 'Draper', channel: 'learn' },
  ],
  herdsman: [
    { name: 'Handling', major: 'Quiet Voice', channel: 'hands' },
    { name: 'Stockman’s Eye', major: 'Bloodline', channel: 'learn' },
    { name: 'Patience', major: 'All Day', channel: 'wind' },
  ],
  naturalist: [
    { name: 'Gathering', major: 'Full Basket', channel: 'hands' },
    { name: 'Herb Lore', major: 'Apothecary', channel: 'learn' },
    { name: 'Wandering', major: 'Far Walk', channel: 'wind' },
  ],
  fisher: [
    { name: 'Cast', major: 'Set the Hook', channel: 'hands' },
    { name: 'Standing', major: 'Sea Legs', channel: 'wind' },
    { name: 'Watercraft', major: 'Reads the Water', channel: 'learn' },
  ],
  mender: [
    { name: 'Repair', major: 'Good as New', channel: 'hands' },
    { name: 'Restoration', major: 'Better Than Found', channel: 'fine' },
    { name: 'Wear Sense', major: 'Keeper', channel: 'learn' },
  ],
  artisan: [
    { name: 'Setting', major: 'Sure Claw', channel: 'hands' },
    { name: 'Finish', major: 'Jeweller’s Eye', channel: 'fine' },
    { name: 'Craft Sense', major: 'Maker', channel: 'learn' },
  ],
};

/**
 * And the three columns of every fighting trade.
 *
 * Two trades sharing a channel are not the same trade, because a node only
 * tells on the skills its own class covers: a Sworn Blade's guard is mail and a
 * shield, a Pikeman's is plate, and neither does anything for the other. The
 * scope is what separates them, and it is checked in one place rather than
 * written into every node.
 */
const COMBAT_COLUMNS: Record<string, [Column, Column, Column]> = {
  blade: [
    { name: 'Shieldwork', major: 'Iron Door', channel: 'guard' },
    { name: 'Edge', major: 'Riposte', channel: 'edge' },
    { name: 'Guard’s Eye', major: 'Unhurried', channel: 'aim' },
  ],
  berserker: [
    { name: 'Heft', major: 'Whole Body', channel: 'edge' },
    { name: 'Rhythm', major: 'No Pause', channel: 'hands' },
    { name: 'Lungs', major: 'Long Red Day', channel: 'wind' },
  ],
  pikeman: [
    { name: 'Point', major: 'Through the Gap', channel: 'aim' },
    { name: 'Harness', major: 'Anvil', channel: 'guard' },
    { name: 'Footing', major: 'Set', channel: 'wind' },
  ],
  archer: [
    { name: 'Draw', major: 'Full Weight', channel: 'edge' },
    { name: 'Sighting', major: 'Windage', channel: 'aim' },
    { name: 'Stillness', major: 'Held', channel: 'wind' },
  ],
  skirmisher: [
    { name: 'Cast', major: 'Whole Arm', channel: 'edge' },
    { name: 'Eye', major: 'Thousandth Throw', channel: 'aim' },
    { name: 'Footing', major: 'Gone', channel: 'hands' },
  ],
  chirurgeon: [
    { name: 'Needle', major: 'Closed Over', channel: 'knit' },
    { name: 'Steady Hand', major: 'Under Fire', channel: 'hands' },
    { name: 'Apron', major: 'Cloth Enough', channel: 'guard' },
  ],
  beastmaster: [
    { name: 'Hide', major: 'Hard to Put Down', channel: 'hide' },
    { name: 'Fang', major: 'Twice Its Size', channel: 'fang' },
    { name: 'Quiet Word', major: 'Given', channel: 'tame' },
  ],
};

/** And the three schools', which are the same three and mean different things. */
const MAGIC_COLUMNS: Record<string, [Column, Column, Column]> = {
  kindler: [
    { name: 'Heat', major: 'White', channel: 'force' },
    { name: 'Throw', major: 'Far Coal', channel: 'reach' },
    { name: 'Sparing', major: 'Last Ember', channel: 'thrift' },
  ],
  binder: [
    { name: 'Hold', major: 'Rooted', channel: 'force' },
    { name: 'Cast', major: 'Wide Still', channel: 'reach' },
    { name: 'Sparing', major: 'Cold Water', channel: 'thrift' },
  ],
  warder: [
    { name: 'Weave', major: 'Close Skin', channel: 'force' },
    { name: 'Spread', major: 'Over All', channel: 'reach' },
    { name: 'Sparing', major: 'Deep Cut', channel: 'thrift' },
  ],
};

/** Every trade's columns: craft, fighting and arcane alike. */
export const CLASS_COLUMNS: Record<string, [Column, Column, Column]> =
  { ...CRAFT_COLUMNS, ...COMBAT_COLUMNS, ...MAGIC_COLUMNS };

/** "a, b and c", for a list somebody reads rather than parses. */
const listed = (xs: readonly string[]): string =>
  xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

const skillWords = (id: string): string => id.replace(/_/g, ' ');

/*
 * What a trade says about itself, derived rather than written.
 *
 * Both lines used to be prose -- "works wood, from a plank to a storey" and
 * "builds higher, wastes less timber, and the fine joinery comes off the bench
 * better" -- which is a mood rather than a number, on a card somebody is
 * reading to decide where five hundred silver goes.
 *
 * `note` is the scope: which skills the trade's nodes tell on, and nothing
 * else decides that. `lever` is what the whole tree is worth bought out, which
 * is three multiplied columns and so is computed from `STEP` rather than
 * restated beside it. `rpc_take_class` puts the lever in the line it tells you
 * when you take the trade up, which is exactly when the number is wanted.
 */
for (const c of CLASSES) {
  const chans = CLASS_COLUMNS[c.id].map((col) => col.channel);
  c.note = `Nodes apply to ${listed(c.skills.map(skillWords))}.`;
  c.lever = `Bought out: ${chans
    .map((ch) => `${CHANNELS[ch].note.toLowerCase()} ${channelSays(channelFull(ch))}`)
    .join(', ')}.`;
}

/** Every node there is, built from the columns rather than written out twice. */
export const CLASS_NODES: NodeDef[] = CLASSES.flatMap((c) =>
  CLASS_COLUMNS[c.id].flatMap((col, ci) => ([1, 2, 3] as const).map((rank) => {
    const mul = STEP[col.channel][rank - 1];
    return {
      id: `${c.id}_${ci + 1}_${rank}`,
      class: c.id,
      col: ci + 1,
      name: rank === 3 ? col.major : `${col.name} ${ROMAN[rank - 1]}`,
      /*
       * The exact benefit, derived: the one number this channel multiplies,
       * and what this rank does to it. Written out it was flavour -- "the
       * spade goes in and comes up without thinking about it" -- repeated on
       * all three ranks of a column, and it told somebody deciding how to
       * spend a point precisely nothing.
       */
      note: `${CHANNELS[col.channel].note} ${channelSays(mul)}`,
      channel: col.channel,
      rank,
      cost: COST[rank - 1],
      needs: rank === 1 ? null : `${c.id}_${ci + 1}_${rank - 1}`,
      mul,
    } as NodeDef;
  })));

export const nodeDef = (id: string): NodeDef | undefined => CLASS_NODES.find((n) => n.id === id);

/** How many nodes a trade's tree holds: every trade's the same, three columns of three. */
export const NODES_PER_TRADE = CLASS_NODES.filter((n) => n.class === CLASSES[0].id).length;

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

/*
 * ---------------------------------------------------------------------------
 * The rites.
 * ---------------------------------------------------------------------------
 *
 * Every trade is footed in two things: the skills it covers, and a rite.
 *
 * A rite is the one thing a class may ask the island for out loud, and it is
 * paid for out of the same favour, at the same altar, on the same prayer that
 * the six open casts are. Nothing about the faith economy is duplicated -- what
 * differs is only which card may call which line.
 *
 * And a rite is not a new kind of rule. **It is a node with an hour on it**:
 * the same channels, the same scope, folded into the same jsonb on the body.
 * `class_mul` multiplies it in alongside the permanent nodes while it holds and
 * stops the moment it lapses, so there is no second machinery to keep, no
 * second place a number can disagree with itself, and no read on the hot path
 * that was not already happening.
 *
 * That is also why a rite may push a channel *down*. Red Hour buys a half again
 * on what you land by giving away three tenths of what you turn, and it does it
 * with two numbers in the same map as everything else.
 */

export interface RiteDef {
  id: string;
  /** The class that alone may call it. */
  class: string;
  name: string;
  /** Favour it costs, against a cap of 25 + prayer × 0.95. */
  cost: number;
  /** Prayer it takes, on the same ladder the six open casts use. */
  level: number;
  /** How long it holds. */
  secs: number;
  /** How long until it may be called again. */
  rest: number;
  /** What it multiplies while it holds, on the class's own skills. */
  muls: Partial<Record<Channel, number>>;
  /** What the island says when it takes. */
  said: string;
  note: string;
}

/**
 * What a rite says it does, from what it does.
 *
 * It was a sentence of mood -- "for half a minute the shield is everywhere you
 * need it" -- sitting beside a `muls` map that says the same thing exactly.
 * This reads that map out, with the seconds it lasts and the rest before it
 * may be called again. A rite that trades one channel away for another says so
 * in the sign, because `channelSays` takes the sign off the multiplier.
 */
const riteNote = (r: Omit<RiteDef, 'note'>): string => {
  const what = Object.entries(r.muls)
    .map(([ch, mul]) => `${CHANNELS[ch as Channel].note.toLowerCase()} ${channelSays(mul)}`)
    .join(', ');
  return `${what[0].toUpperCase()}${what.slice(1)} for ${r.secs}s. `
    + `${Math.round(r.rest / 60)}m before it may be called again.`;
};

const rite = (r: Omit<RiteDef, 'note'>): RiteDef => ({ ...r, note: riteNote(r) });

export const RITES: RiteDef[] = ([
  {
    id: 'ward', class: 'blade', name: 'Ward', cost: 20, level: 10, secs: 30, rest: 900,
    muls: { guard: 1.6 },
    said: 'You set your feet and the shield stops being a thing you are holding.',
  },
  {
    id: 'redhour', class: 'berserker', name: 'Red Hour', cost: 24, level: 12, secs: 30, rest: 1200,
    muls: { edge: 1.5, guard: 0.7 },
    said: 'It goes red at the edges, and you stop minding what lands on you.',
  },
  {
    id: 'set', class: 'pikeman', name: 'Set', cost: 20, level: 10, secs: 45, rest: 900,
    muls: { guard: 1.4, aim: 1.15 },
    said: 'You set the butt of it in the ground and the line stops where you are.',
  },
  {
    id: 'farsight', class: 'archer', name: 'Farsight', cost: 22, level: 14, secs: 45, rest: 900,
    muls: { aim: 1.3, edge: 1.2 },
    said: 'The far end of the field comes close enough to touch.',
  },
  {
    id: 'quickhand', class: 'skirmisher', name: 'Quick Hand', cost: 18, level: 8, secs: 30, rest: 720,
    muls: { hands: 0.7 },
    said: 'Your hands get ahead of you and you let them.',
  },
  {
    id: 'staunch', class: 'chirurgeon', name: 'Staunch', cost: 26, level: 16, secs: 60, rest: 1200,
    muls: { knit: 3 },
    said: 'You get your hands on it and it begins closing under them.',
  },
  {
    id: 'pack', class: 'beastmaster', name: 'Call the Pack', cost: 28, level: 18, secs: 60, rest: 1200,
    muls: { fang: 1.5, hide: 1.3 },
    said: 'You say the word and everything that answers to you stops being tame.',
  },
] as Array<Omit<RiteDef, 'note'>>).map(rite);

RITES.push(...([
  {
    id: 'whiteheat', class: 'kindler', name: 'White Heat', cost: 22, level: 12, secs: 30, rest: 900,
    muls: { force: 1.6 },
    said: 'The stone goes hot enough to hurt and you hold on to it anyway.',
  },
  {
    id: 'longhold', class: 'binder', name: 'Long Hold', cost: 24, level: 14, secs: 45, rest: 900,
    muls: { force: 1.4, reach: 1.4 },
    said: 'The air goes thick and slow as far out as you can see.',
  },
  {
    id: 'deepstone', class: 'warder', name: 'Deep Stone', cost: 26, level: 16, secs: 60, rest: 1200,
    muls: { thrift: 0.35 },
    said: 'You reach further into it than you have any business reaching, and it lets you.',
  },
] as Array<Omit<RiteDef, 'note'>>).map(rite));

export const riteOf = (classId: string | null): RiteDef | undefined =>
  classId ? RITES.find((r) => r.class === classId) : undefined;

export const riteDef = (id: string): RiteDef | undefined => RITES.find((r) => r.id === id);

/**
 * Why a rite cannot be called, or nothing.
 *
 * The same four refusals the island builds, in the same order, so the two
 * sides can be asked to agree on the sentence rather than on the idea.
 */
export function riteRefusal(
  r: RiteDef, mine: string | null, prayer: number, favour: number, restLeft: number,
): string | null {
  if (r.class !== mine) {
    return `That is the ${(classDef(r.class)?.name ?? r.class).toLowerCase()}’s to call, and you are not one.`;
  }
  if (prayer < r.level) {
    return `${r.name} takes ${r.level} prayer; you have ${Math.floor(prayer)}.`;
  }
  if (favour < r.cost) {
    return `${r.name} costs ${r.cost} favour; you hold ${Math.floor(favour)}. Pray at an altar.`;
  }
  if (restLeft > 0) {
    return `${r.name} again in ${Math.ceil(restLeft / 60)} minutes.`;
  }
  return null;
}
