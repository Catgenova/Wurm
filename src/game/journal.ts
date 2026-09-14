import { FISH } from './fishing';
import type { Game } from './game';
import { isBoat } from './furniture';
import { isDone } from './building';
import { canImprove } from './improve';
import { traitTier } from './traits';

/**
 * A journal of goals. There is a great deal to do on this island and nothing
 * anywhere that says so; the journal is that list. Nothing is required and
 * nothing is rewarded — a goal is only a thing somebody thought worth doing,
 * ticked off the moment you have done it and ticked off for good thereafter.
 */
export interface Goal {
  id: string;
  text: string;
  /** How it is done, for the ones that are not obvious. */
  hint?: string;
  met: (g: Game) => boolean;
}

export interface Chapter {
  name: string;
  goals: Goal[];
}

const skill = (id: string, at: number) => (g: Game): boolean => g.skills.get(id) >= at;
const has = (item: string, n = 1) => (g: Game): boolean => g.inventory.count(item) >= n;
const did = (key: string, n = 1) => (g: Game): boolean => (g.tally[key] ?? 0) >= n;

/** Distinct species you have tamed and still keep. */
const kept = (g: Game): number => new Set([...g.creatures.list.values()].filter((c) => c.mode !== 'wild').map((c) => c.species)).size;

export const JOURNAL: Chapter[] = [
  {
    name: 'Ashore',
    goals: [
      { id: 'tree', text: 'Fell your first tree', met: did('tree') },
      { id: 'plank', text: 'Saw a log into planks', met: skill('carpentry', 1.2) },
      { id: 'fire', text: 'Light a campfire', hint: 'Two shafts, laid on a spot and lit', met: did('fire') },
      { id: 'cook', text: 'Cook something over it', met: (g) => Object.keys(g.tally).some((k) => k.startsWith('made:cooked') || k === 'made:baked_potato' || k === 'made:roast_onion' || k === 'made:roast_nuts') },
      { id: 'crate', text: 'Build a crate and set it down', met: did('crate') },
      { id: 'deed', text: 'Plant a stake and found a settlement', met: (g) => !!g.deed },
    ],
  },
  {
    name: 'The trades',
    goals: [
      { id: 'ore', text: 'Bring up your first ore', met: did('ore') },
      { id: 'smelt', text: 'Smelt it into a lump', met: skill('smelting', 2) },
      { id: 'anvil', text: 'Cast an anvil and set it down', met: (g) => g.anvils.size > 0 },
      { id: 'smith', text: 'Beat something out on it', met: did('smithed') },
      { id: 'bronze', text: 'Mix a crucible of bronze', met: did('made:bronze_lump') },
      { id: 'moon', text: 'Work one of the four deep metals', hint: 'Adamantine, glimmersteel, mithril or seryll', met: did('moonmetal') },
      { id: 'improve', text: 'Better something past quality 50', met: (g) => g.inventory.items.some((it) => !it.issued && canImprove(it.id) && it.ql >= 50) },
      { id: 'improve90', text: 'Better something past quality 90', met: (g) => g.inventory.items.some((it) => !it.issued && canImprove(it.id) && it.ql >= 90) },
      { id: 'rare', text: 'Make something rare', met: did('rare') },
      { id: 'supreme', text: 'Make something supreme', met: did('supreme') },
    ],
  },
  {
    name: 'The land',
    goals: [
      { id: 'field', text: 'Till a field and sow it', met: skill('farming', 3) },
      { id: 'bread', text: 'Bake a loaf of bread', met: did('made:bread') },
      { id: 'orchard', text: 'Plant a fruit tree', met: did('orchard') },
      { id: 'pie', text: 'Bake an apple pie', met: did('made:apple_pie') },
      { id: 'oil', text: 'Press a measure of olive oil', met: did('made:olive_oil') },
      { id: 'brew', text: 'Set a brew going', met: did('brew') },
      { id: 'fourbrews', text: 'Brew all four: ale, cider, mead and wine', met: (g) => ['ale', 'cider', 'mead', 'wine'].every((b) => (g.tally[`brew:${b}`] ?? 0) > 0) },
    ],
  },
  {
    name: 'The water',
    goals: [
      { id: 'rod', text: 'Splice a fishing rod', met: has('fishing_rod') },
      { id: 'perch', text: 'Land a perch', met: did('fish:perch') },
      { id: 'boat', text: 'Launch a boat', met: (g) => [...g.furniture.values()].some((f) => isBoat(f)) },
      { id: 'allfish', text: 'Land one of every fish', hint: FISH.map((f) => f.name.toLowerCase()).join(', '), met: (g) => FISH.every((f) => (g.tally[`fish:${f.id}`] ?? 0) > 0) },
      { id: 'sail', text: 'Build a sailing boat', met: (g) => [...g.furniture.values()].some((f) => f.kind === 'sailing_boat') },
    ],
  },
  {
    name: 'The wildermon',
    goals: [
      { id: 'tame', text: 'Tame your first wildermon', met: did('tamed') },
      { id: 'work', text: 'Set one to work on your deed', met: (g) => g.creatures.working().length > 0 },
      { id: 'five', text: 'Keep five different sorts at once', met: (g) => kept(g) >= 5 },
      { id: 'ride', text: 'Saddle something and ride it', met: did('mounted') },
      { id: 'cart', text: 'Hitch a team to a large cart', met: did('hitched') },
      { id: 'wagon', text: 'Fill all four yokes of a wagon', met: (g) => [...g.furniture.values()].some((f) => f.kind === 'wagon' && (f.team?.length ?? 0) >= 4) },
      { id: 'hive', text: 'Keep a hive and take honey from it', met: (g) => [...g.furniture.values()].some((f) => f.kind === 'hive' && f.items.length > 0) },
      { id: 'post', text: 'Set a wildermon to a work post', met: did('posted') },
      { id: 'worms', text: 'Turn up a spadeful of worms', met: did('worms') },
      { id: 'sat', text: 'Sit and think about nothing', hint: 'A rug, and somewhere quiet', met: did('sat') },
      { id: 'path', text: 'Take a path', hint: 'Chosen once, at five meditation, and never again', met: (g) => !!g.player.way },
      { id: 'walked', text: 'Walk a path to its end', hint: 'Meditation 70', met: (g) => !!g.player.way && g.skills.get('meditation') >= 70 },
      { id: 'altar', text: 'Raise an altar', hint: 'Brick, mortar, slab and a lump of gold', met: (g) => [...g.furniture.values()].some((f) => f.kind === 'altar') },
      { id: 'prayed', text: 'Kneel at it', met: did('prayed') },
      { id: 'cunning', text: 'Work a circle of cunning into a tool', met: (g) => g.inventory.items.some((it) => (it.bless ?? 0) > 0) },
      { id: 'thrice', text: 'Take one tool to three circles', met: (g) => g.inventory.items.some((it) => (it.bless ?? 0) >= 3) },
      { id: 'goblin', text: 'Kill a goblin', hint: 'The commonest of the bad things', met: did('slew:goblin') },
      { id: 'orc', text: 'Kill an orc', met: did('slew:orc') },
      { id: 'ogre', text: 'Kill an ogre', met: did('slew:ogre') },
      { id: 'dragon', text: 'Kill the dragon', hint: 'There is one. Somewhere.', met: did('slew:dragon') },
      { id: 'hoard', text: 'Cut open a hoard', hint: 'A dragon has been sleeping on something', met: did('hoard') },
      { id: 'scaled', text: 'Wear a full suit of dragon scale', met: (g) => ['head', 'chest', 'arms', 'legs', 'feet'].every((sl) => g.worn(sl as never)?.id.startsWith('scale_')) },
      { id: 'composite', text: 'Lay up a composite bow', hint: 'Tusk and sinew, off things that meant you harm', met: has('composite_bow') },
      { id: 'bridged', text: 'Finish a bridge', hint: 'Stand on one bank and throw it to the other', met: did('bridged') },
      { id: 'reach', text: 'Sail a beam reach in a fresh wind', hint: 'Across the wind is the fastest a hull goes', met: did('reach') },
      { id: 'laden', text: 'Sail a hull loaded past half her hold', met: did('laden') },
      { id: 'baited', text: 'Land a fish on bait', met: did('baited') },
      { id: 'netted', text: 'Haul a net in', met: did('netted') },
      { id: 'creeled', text: 'Empty a creel', hint: 'Woven from reed, sunk in water, baited and left', met: did('creeled') },
      { id: 'caught', text: 'Catch something in a trap', hint: 'A snare, baited, out in the country', met: did('caught') },
      { id: 'trapped', text: 'Take a live one out of a trap', met: did('trapped') },
      { id: 'groom', text: 'Brush a wildermon down', hint: 'A brush: a plank and two wool', met: did('groom') },
      { id: 'groomfull', text: 'Brush one to a shine', hint: 'Care full to the top, which takes a few passes', met: did('groomfull') },
      { id: 'bred', text: 'Breed a wildermon of your own', hint: 'A male and a female of one sort, grown, fed and side by side', met: did('bred') },
      { id: 'goodblood', text: 'Breed one carrying supreme blood', met: did('goodblood') },
      { id: 'fantastic_blood', text: 'Breed one carrying a fantastic trait', met: (g) => [...g.creatures.list.values()].some((c) => c.mode !== 'wild' && c.traits.some((t) => traitTier(t) === 'fantastic')) },
      { id: 'husbandry', text: 'Take animal husbandry to 50', met: skill('animal_husbandry', 50) },
    ],
  },
  {
    name: 'Standing',
    goals: [
      { id: 'house', text: 'Finish a walled building', met: (g) => [...g.buildings.walls.values()].filter((w) => isDone(w)).length >= 4 },
      { id: 'storey', text: 'Build a second storey', met: (g) => [...g.buildings.list.values()].some((b) => b.levels > 1) },
      { id: 'deed3', text: 'Raise your settlement to level 3', met: (g) => g.deedLevel >= 3 },
      { id: 'deed5', text: 'Raise your settlement to level 5', met: (g) => g.deedLevel >= 5 },
      { id: 'relic', text: 'Restore an ancient thing', met: (g) => g.skills.get('restoration') >= 5 },
      { id: 'rest', text: 'Sleep in a bed of your own making', met: did('slept') },
    ],
  },
  {
    name: 'A lifetime',
    goals: [
      { id: 'fifty', text: 'Take any trade to 50', met: (g) => g.skills.values.size > 0 && [...g.skills.values.values()].some((v) => v >= 50) },
      { id: 'ninety', text: 'Take any trade to 90', met: (g) => [...g.skills.values.values()].some((v) => v >= 90) },
      { id: 'fivetrades', text: 'Take five trades past 30', met: (g) => [...g.skills.values.values()].filter((v) => v >= 30).length >= 5 },
      { id: 'fantastic', text: 'Make something fantastic', hint: 'One thing in ten thousand', met: did('fantastic') },
      { id: 'hundred', text: 'Take a trade to 99', hint: 'Nobody has ever needed to', met: (g) => [...g.skills.values.values()].some((v) => v >= 99) },
      { id: 'dressed', text: 'Dress a wound', met: did('dressed') },
      { id: 'covered', text: 'Lay the right herb on the right wound', hint: 'Thyme on a cut, sage on a burn', met: did('covered') },
      { id: 'cleaned', text: 'Scour a wound that has gone bad', hint: 'A bucket of lye', met: did('cleaned') },
      { id: 'dye', text: 'Boil a pot of dye', hint: 'Something that grows, and a bucket of lye', met: did('dyed') },
      { id: 'colours', text: 'Fly your colour over the deed', hint: 'A dyed banner, planted', met: (g) => [...g.furniture.values()].some((f) => f.kind === 'banner' && !!f.dye) },
      { id: 'title', text: 'Earn a title', hint: 'Any trade at 50', met: (g) => g.player.titles.length > 0 },
      { id: 'master', text: 'Earn a master title', hint: 'Any trade at 90', met: (g) => g.player.titles.some((t) => t.endsWith(':90') || t.endsWith(':99')) },
      { id: 'knack', text: 'Find a knack for something', hint: 'Every ten points of a trade leaves one', met: did('knack') },
      { id: 'knack5', text: 'Fill a trade with knacks', hint: 'Five of them in one skill', met: (g) => Object.values(g.player.affinities).some((n) => n >= 5) },
    ],
  },
];

export const ALL_GOALS: Goal[] = JOURNAL.flatMap((c) => c.goals);
export const goalCount = ALL_GOALS.length;
