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
export const COMBAT_CLASSES: ClassDef[] = [
  {
    id: 'blade', kind: 'combat', name: 'Sworn Blade', main: 'swords',
    note: 'The disciplined line: a sword, a shield and mail. A blow turned is a blow you may answer.',
    skills: ['swords', 'shields', 'chain_armour'],
    lever: 'Turns more of what is aimed at you, and answers it harder.',
  },
  {
    id: 'berserker', kind: 'combat', name: 'Berserker', main: 'axes',
    note: 'Two hands on something heavy, and no thought at all for what comes back.',
    skills: ['axes', 'mauls'],
    lever: 'Hits harder than anything else on this island, faster, and for longer.',
  },
  {
    id: 'pikeman', kind: 'combat', name: 'Pikeman', main: 'polearms',
    note: 'A long haft and a wall of plate. Nothing gets past you and nothing gets near.',
    skills: ['polearms', 'plate_armour'],
    lever: 'Strikes first from a rank back, and stands in what would flatten anybody else.',
  },
  {
    id: 'archer', kind: 'combat', name: 'Archer', main: 'archery',
    note: 'The first blow of any fight, from further off than the thing can answer.',
    skills: ['archery', 'awareness', 'leather_armour'],
    lever: 'Hits harder and truer at range, and holds a full draw for nothing.',
  },
  {
    id: 'skirmisher', kind: 'combat', name: 'Skirmisher', main: 'throwing',
    note: 'Comes from where nobody was looking, opens something up, and is not there afterwards.',
    skills: ['throwing', 'knives', 'climbing'],
    lever: 'Throws hard and true, and is quick over ground nobody else will cross.',
  },
  {
    id: 'chirurgeon', kind: 'combat', name: 'Chirurgeon', main: 'chirurgy',
    note: 'Closes what is open, on a field, on somebody who is still being shot at.',
    skills: ['chirurgy', 'cloth_armour'],
    lever: 'What you dress closes at a pace nothing else on the island comes near.',
  },
  {
    id: 'beastmaster', kind: 'combat', name: 'Beastmaster', main: 'soul_strength',
    note: 'Fights with what fights beside it. The hand on the animal, not the blade.',
    skills: ['soul_strength'],
    lever: 'What travels with you does more of the fighting, and bites far harder doing it.',
  },
];

/** Every class there is. The three magic trades land beside these. */
export const CLASSES: ClassDef[] = [...CRAFT_CLASSES, ...COMBAT_CLASSES];

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
  | 'edge' | 'aim' | 'guard' | 'knit' | 'hide' | 'fang' | 'tame';

/** What each channel means, and which way its numbers run. */
export const CHANNELS: Record<Channel, { name: string; note: string; lower: boolean }> = {
  hands: { name: 'Hands', note: 'How long a go takes.', lower: true },
  learn: { name: 'Learning', note: 'What a go teaches you.', lower: false },
  wind: { name: 'Wind', note: 'What a go takes out of you.', lower: true },
  fine: { name: 'Fineness', note: 'The quality of what comes off the bench.', lower: false },
  edge: { name: 'Edge', note: 'How hard a blow lands.', lower: false },
  aim: { name: 'Aim', note: 'Whether it lands at all.', lower: false },
  guard: { name: 'Guard', note: 'How much of what is aimed at you is turned.', lower: false },
  knit: { name: 'Knitting', note: 'How fast what is open closes.', lower: false },
  hide: { name: 'Hide', note: 'How much what travels with you can take.', lower: false },
  fang: { name: 'Fang', note: 'How hard what travels with you bites.', lower: false },
  tame: { name: 'Quiet', note: 'How readily a wild thing decides about you.', lower: false },
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
};

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
    { name: 'Shieldwork', major: 'Iron Door', channel: 'guard', note: 'What is aimed at you meets the shield first, and the shield is where you want it.' },
    { name: 'Edge', major: 'Riposte', channel: 'edge', note: 'The sword goes into the gap the turned blow left open.' },
    { name: 'Guard’s Eye', major: 'Unhurried', channel: 'aim', note: 'You see the opening a moment before it is one.' },
  ],
  berserker: [
    { name: 'Heft', major: 'Whole Body', channel: 'edge', note: 'Everything you swing lands with all of you behind it.' },
    { name: 'Rhythm', major: 'No Pause', channel: 'hands', note: 'The next blow is already on its way when this one lands.' },
    { name: 'Lungs', major: 'Long Red Day', channel: 'wind', note: 'A fight that goes on costs you less of one.' },
  ],
  pikeman: [
    { name: 'Point', major: 'Through the Gap', channel: 'aim', note: 'A long haft finds the seam at the end of it.' },
    { name: 'Harness', major: 'Anvil', channel: 'guard', note: 'Plate turns what it was beaten out to turn.' },
    { name: 'Footing', major: 'Set', channel: 'wind', note: 'Standing in all of it, all day, and still standing.' },
  ],
  archer: [
    { name: 'Draw', major: 'Full Weight', channel: 'edge', note: 'The whole weight of the bow goes into the shaft.' },
    { name: 'Sighting', major: 'Windage', channel: 'aim', note: 'Distance stops being a guess and becomes a number.' },
    { name: 'Stillness', major: 'Held', channel: 'wind', note: 'A full draw held is a full draw that costs nothing.' },
  ],
  skirmisher: [
    { name: 'Cast', major: 'Whole Arm', channel: 'edge', note: 'What leaves your hand arrives with everything you put into it.' },
    { name: 'Eye', major: 'Thousandth Throw', channel: 'aim', note: 'You have thrown at exactly that distance a thousand times.' },
    { name: 'Footing', major: 'Gone', channel: 'hands', note: 'You are moving again before it has landed.' },
  ],
  chirurgeon: [
    { name: 'Needle', major: 'Closed Over', channel: 'knit', note: 'What you have dressed closes at a pace nothing else matches.' },
    { name: 'Steady Hand', major: 'Under Fire', channel: 'hands', note: 'Dressing a wound in a fight takes no longer than at a bench.' },
    { name: 'Apron', major: 'Cloth Enough', channel: 'guard', note: 'What you wear is cloth, and it is enough, because you mend it.' },
  ],
  beastmaster: [
    { name: 'Hide', major: 'Hard to Put Down', channel: 'hide', note: 'What goes with you takes far more killing than its kind should.' },
    { name: 'Fang', major: 'Twice Its Size', channel: 'fang', note: 'What goes with you bites like something far bigger.' },
    { name: 'Quiet Word', major: 'Given', channel: 'tame', note: 'A wild thing decides about you sooner than it meant to.' },
  ],
};

/** Every trade's columns, craft and fighting alike. */
export const CLASS_COLUMNS: Record<string, [Column, Column, Column]> =
  { ...CRAFT_COLUMNS, ...COMBAT_COLUMNS };

/** Every node there is, built from the columns rather than written out twice. */
export const CLASS_NODES: NodeDef[] = CLASSES.flatMap((c) =>
  CLASS_COLUMNS[c.id].flatMap((col, ci) => ([1, 2, 3] as const).map((rank) => {
    const mul = STEP[col.channel][rank - 1];
    return {
      id: `${c.id}_${ci + 1}_${rank}`,
      class: c.id,
      col: ci + 1,
      name: rank === 3 ? col.major : `${col.name} ${ROMAN[rank - 1]}`,
      note: col.note,
      channel: col.channel,
      rank,
      cost: COST[rank - 1],
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

export const RITES: RiteDef[] = [
  {
    id: 'ward', class: 'blade', name: 'Ward', cost: 20, level: 10, secs: 30, rest: 900,
    muls: { guard: 1.6 },
    note: 'For half a minute the shield is everywhere you need it.',
    said: 'You set your feet and the shield stops being a thing you are holding.',
  },
  {
    id: 'redhour', class: 'berserker', name: 'Red Hour', cost: 24, level: 12, secs: 30, rest: 1200,
    muls: { edge: 1.5, guard: 0.7 },
    note: 'Half again on what you land, and three tenths off what you turn. It is not a bargain; it is a decision.',
    said: 'It goes red at the edges, and you stop minding what lands on you.',
  },
  {
    id: 'set', class: 'pikeman', name: 'Set', cost: 20, level: 10, secs: 45, rest: 900,
    muls: { guard: 1.4, aim: 1.15 },
    note: 'Braced, with the haft down, and nothing coming through.',
    said: 'You set the butt of it in the ground and the line stops where you are.',
  },
  {
    id: 'farsight', class: 'archer', name: 'Farsight', cost: 22, level: 14, secs: 45, rest: 900,
    muls: { aim: 1.3, edge: 1.2 },
    note: 'Distance stops mattering for as long as it lasts.',
    said: 'The far end of the field comes close enough to touch.',
  },
  {
    id: 'quickhand', class: 'skirmisher', name: 'Quick Hand', cost: 18, level: 8, secs: 30, rest: 720,
    muls: { hands: 0.7 },
    note: 'Everything you do happens a third quicker, which is most of a fight.',
    said: 'Your hands get ahead of you and you let them.',
  },
  {
    id: 'staunch', class: 'chirurgeon', name: 'Staunch', cost: 26, level: 16, secs: 60, rest: 1200,
    muls: { knit: 3 },
    note: 'For a minute, what you have dressed closes three times as fast.',
    said: 'You get your hands on it and it begins closing under them.',
  },
  {
    id: 'pack', class: 'beastmaster', name: 'Call the Pack', cost: 28, level: 18, secs: 60, rest: 1200,
    muls: { fang: 1.5, hide: 1.3 },
    note: 'What travels with you fights like something with nothing to lose.',
    said: 'You say the word and everything that answers to you stops being tame.',
  },
];

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
