import { FISH } from './fishing';
import type { Game } from './game';
import { isBoat } from './furniture';
import { isDone } from './building';
import { METALS } from './metal';
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
      { id: 'tree', text: 'Fell a tree', met: did('tree') },
      { id: 'plank', text: 'Saw a log into planks', met: skill('carpentry', 1.2) },
      { id: 'fire', text: 'Light a campfire', hint: 'Two shafts, placed and lit', met: did('fire') },
      { id: 'cook', text: 'Cook food on a campfire', met: (g) => Object.keys(g.tally).some((k) => k.startsWith('made:cooked') || k === 'made:baked_potato' || k === 'made:roast_onion' || k === 'made:roast_nuts') },
      { id: 'crate', text: 'Build a crate and place it', met: did('crate') },
      { id: 'deed', text: 'Plant a stake to found a settlement', met: (g) => !!g.deed },
    ],
  },
  {
    name: 'The trades',
    goals: [
      { id: 'ore', text: 'Mine some ore', met: did('ore') },
      /*
       * Reported: the note "didn't trigger on smelting copper or tin into
       * lumps, but did trigger simultaneously with the note for mixing my
       * first bronze lump". It was hung on the smelting skill passing 2,
       * which is a couple of hours of work and lands nowhere near the thing
       * it is named after. It is the lump itself now: any metal that comes
       * out of ore, which is every one but the five that are mixed.
       */
      { id: 'smelt', text: 'Smelt ore into a metal lump',
        met: (g) => METALS.some((m) => m.ore !== null && (g.tally[`made:${m.lump}`] ?? 0) > 0) },
      { id: 'anvil', text: 'Cast an anvil and place it', met: (g) => ours(g.anvils.values()).length > 0 },
      { id: 'smith', text: 'Smith a casting at an anvil', met: did('smithed') },
      { id: 'bronze', text: 'Smelt a bronze lump', hint: 'Copper and tin together in a smelter', met: did('made:bronze_lump') },
      { id: 'moon', text: 'Smith a piece of adamantine, glimmersteel, mithril or seryll', met: did('moonmetal') },
      { id: 'improve', text: 'Improve an item to quality 50', met: (g) => g.inventory.items.some((it) => !it.issued && canImprove(it.id) && it.ql >= 50) },
      { id: 'improve90', text: 'Improve an item to quality 90', met: (g) => g.inventory.items.some((it) => !it.issued && canImprove(it.id) && it.ql >= 90) },
      { id: 'rare', text: 'Make a rare item', met: did('rare') },
      { id: 'supreme', text: 'Make a supreme item', met: did('supreme') },
    ],
  },
  {
    name: 'The land',
    goals: [
      { id: 'field', text: 'Till a field and sow seed', met: skill('farming', 3) },
      { id: 'bread', text: 'Bake a loaf of bread', met: did('made:bread') },
      { id: 'orchard', text: 'Plant a fruit tree', met: did('orchard') },
      { id: 'pie', text: 'Bake an apple pie', met: did('made:apple_pie') },
      { id: 'oil', text: 'Press olive oil', met: did('made:olive_oil') },
      { id: 'brew', text: 'Start a brew in a barrel', met: did('brew') },
      { id: 'fourbrews', text: 'Brew ale, cider, mead and wine', met: (g) => ['ale', 'cider', 'mead', 'wine'].every((b) => (g.tally[`brew:${b}`] ?? 0) > 0) },
    ],
  },
  {
    name: 'The water',
    goals: [
      { id: 'rod', text: 'Make a fishing rod', met: has('fishing_rod') },
      { id: 'perch', text: 'Catch a perch', met: did('fish:perch') },
      { id: 'boat', text: 'Build a boat', met: (g) => ours(g.furniture.values()).some((f) => isBoat(f)) },
      { id: 'allfish', text: 'Catch every kind of fish', hint: FISH.map((f) => f.name.toLowerCase()).join(', '), met: (g) => FISH.every((f) => (g.tally[`fish:${f.id}`] ?? 0) > 0) },
      { id: 'sail', text: 'Build a sailing boat', met: (g) => ours(g.furniture.values()).some((f) => f.kind === 'sailing_boat') },
    ],
  },
  {
    name: 'The wildermon',
    goals: [
      { id: 'tame', text: 'Tame a wildermon', met: did('tamed') },
      { id: 'work', text: 'Set a wildermon to work on your settlement', met: (g) => g.creatures.working().filter((c) => c.mine !== false).length > 0 },
      { id: 'five', text: 'Keep five species of wildermon at once', met: (g) => kept(g) >= 5 },
      { id: 'ride', text: 'Saddle a wildermon and ride it', met: did('mounted') },
      { id: 'cart', text: 'Hitch a team to a large cart', met: did('hitched') },
      { id: 'wagon', text: 'Hitch four wildermon to a wagon', met: (g) => ours(g.furniture.values()).some((f) => f.kind === 'wagon' && (f.team?.length ?? 0) >= 4) },
      { id: 'hive', text: 'Build a hive and take honey from it', met: (g) => ours(g.furniture.values()).some((f) => f.kind === 'hive' && f.items.length > 0) },
      { id: 'post', text: 'Set a wildermon to a work post', met: did('posted') },
      { id: 'worms', text: 'Dig up worms with a shovel', met: did('worms') },
      { id: 'sat', text: 'Sit on a rug and meditate', hint: 'Weave a rug on a loom', met: did('sat') },
      { id: 'path', text: 'Choose a meditation path', hint: 'Offered at meditation 5, at the rug; the choice is for good', met: (g) => !!g.player.way },
      { id: 'walked', text: 'Reach meditation 70 on your path', met: (g) => !!g.player.way && g.skills.get('meditation') >= 70 },
      { id: 'altar', text: 'Build an altar', hint: 'Stone bricks, mortar, stone slabs and a gold lump', met: (g) => ours(g.furniture.values()).some((f) => f.kind === 'altar') },
      { id: 'prayed', text: 'Pray at an altar', met: did('prayed') },
      { id: 'cunning', text: 'Cast a circle of cunning on a tool', hint: 'A favour bought at an altar', met: (g) => g.inventory.items.some((it) => (it.bless ?? 0) > 0) },
      { id: 'thrice', text: 'Cast three circles of cunning on one tool', met: (g) => g.inventory.items.some((it) => (it.bless ?? 0) >= 3) },
      { id: 'goblin', text: 'Kill a goblin', met: did('slew:goblin') },
      { id: 'orc', text: 'Kill an orc', met: did('slew:orc') },
      { id: 'ogre', text: 'Kill an ogre', met: did('slew:ogre') },
      { id: 'dragon', text: 'Kill a dragon', hint: 'There is one on the island', met: did('slew:dragon') },
      { id: 'hoard', text: 'Open a hoard', hint: 'Dig one up with a treasure map, or butcher a dragon', met: did('hoard') },
      { id: 'scaled', text: 'Wear a full suit of dragon scale armour', met: (g) => ['head', 'chest', 'arms', 'legs', 'feet'].every((sl) => g.worn(sl as never)?.id.startsWith('scale_')) },
      { id: 'composite', text: 'Make a composite bow', hint: 'Tusk and sinew from an orc or an ogre', met: has('composite_bow') },
      { id: 'bridged', text: 'Build a bridge', hint: 'Start it on one bank and finish it on the other', met: did('bridged') },
      { id: 'reach', text: 'Sail a beam reach in a fresh wind', hint: 'Wind from the side, at half force or more', met: did('reach') },
      { id: 'laden', text: 'Sail a boat with its hold more than half full', met: did('laden') },
      { id: 'baited', text: 'Catch a fish with bait on the hook', met: did('baited') },
      { id: 'netted', text: 'Haul in a fishing net', met: did('netted') },
      { id: 'creeled', text: 'Empty a creel', hint: 'Weave one from reed, bait it and sink it in water', met: did('creeled') },
      { id: 'caught', text: 'Catch a wildermon in a trap', hint: 'A baited snare or deadfall in the wild', met: did('caught') },
      { id: 'trapped', text: 'Take a live wildermon out of a trap', met: did('trapped') },
      { id: 'groom', text: 'Brush a wildermon', hint: 'A brush is a plank and two wool', met: did('groom') },
      { id: 'groomfull', text: 'Brush a wildermon until its care is full', hint: 'Several brushings', met: did('groomfull') },
      { id: 'bred', text: 'Breed two wildermon', hint: 'A grown male and female of one species, fed, side by side', met: did('bred') },
      { id: 'goodblood', text: 'Breed a wildermon with a supreme trait', met: did('goodblood') },
      { id: 'fantastic_blood', text: 'Breed a wildermon with a fantastic trait', met: (g) => ours(g.creatures.list.values()).some((c) => c.mode !== 'wild' && c.traits.some((t) => traitTier(t) === 'fantastic')) },
      { id: 'husbandry', text: 'Reach animal husbandry 50', met: skill('animal_husbandry', 50) },
    ],
  },
  {
    name: 'Standing',
    goals: [
      { id: 'house', text: 'Finish four walls of a building', met: (g) => [...g.buildings.walls.values()].filter((w) => isDone(w)).length >= 4 },
      { id: 'storey', text: 'Build a second storey', met: (g) => [...g.buildings.list.values()].some((b) => b.levels > 1) },
      { id: 'deed3', text: 'Raise your settlement to level 3', met: (g) => g.deedLevel >= 3 },
      { id: 'deed5', text: 'Raise your settlement to level 5', met: (g) => g.deedLevel >= 5 },
      { id: 'relic', text: 'Restore an ancient relic from its pieces', hint: 'Restoration 5', met: (g) => g.skills.get('restoration') >= 5 },
      { id: 'rest', text: 'Sleep in a bed you built', met: did('slept') },
    ],
  },
  {
    name: 'A lifetime',
    goals: [
      { id: 'fifty', text: 'Reach 50 in any skill', met: (g) => g.skills.values.size > 0 && [...g.skills.values.values()].some((v) => v >= 50) },
      { id: 'ninety', text: 'Reach 90 in any skill', met: (g) => [...g.skills.values.values()].some((v) => v >= 90) },
      { id: 'fivetrades', text: 'Reach 30 in five skills', met: (g) => [...g.skills.values.values()].filter((v) => v >= 30).length >= 5 },
      { id: 'fantastic', text: 'Make a fantastic item', hint: 'One in ten thousand', met: did('fantastic') },
      { id: 'hundred', text: 'Reach 99 in any skill', met: (g) => [...g.skills.values.values()].some((v) => v >= 99) },
      { id: 'dressed', text: 'Dress a wound with cloth', met: did('dressed') },
      { id: 'covered', text: 'Dress a wound with the right herb', hint: 'Thyme on a cut, sage on a burn', met: did('covered') },
      { id: 'cleaned', text: 'Scour an infected wound with lye', met: did('cleaned') },
      { id: 'dye', text: 'Make dye', hint: 'Boil petals or leaves with lye', met: did('dyed') },
      { id: 'colours', text: 'Plant a dyed banner on your settlement', met: (g) => ours(g.furniture.values()).some((f) => f.kind === 'banner' && !!f.dye) },
      { id: 'title', text: 'Earn a title', hint: 'Reach 50 in any skill', met: (g) => g.player.titles.length > 0 },
      { id: 'master', text: 'Earn a master title', hint: 'Reach 90 in any skill', met: (g) => g.player.titles.some((t) => t.endsWith(':90') || t.endsWith(':99')) },
      { id: 'knack', text: 'Gain a knack', hint: 'One comes every ten points in a skill', met: did('knack') },
      { id: 'knack5', text: 'Gain five knacks in one skill', met: (g) => Object.values(g.player.knacks).some((n) => n >= 5) },
    ],
  },
];

/**
 * Only your own work counts.
 *
 * Reported from the island: "his actions are completing my journal". It was
 * doing exactly that. Everything the island sets down arrives in one set of
 * maps — you have to see a neighbour's boat to sail round it — so a goal
 * written as "is there a boat" was answered by anybody's boat, and a journal
 * that counts a stranger's work is not a journal.
 *
 * `mine !== false` rather than `mine === true`, because absent means the game
 * you play by yourself, where everything on the ground is yours.
 */
const ours = <T extends { mine?: boolean }>(xs: Iterable<T>): T[] =>
  [...xs].filter((x) => x.mine !== false);

export const ALL_GOALS: Goal[] = JOURNAL.flatMap((c) => c.goals);
export const goalCount = ALL_GOALS.length;
