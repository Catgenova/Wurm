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
    ],
  },
];

export const ALL_GOALS: Goal[] = JOURNAL.flatMap((c) => c.goals);
export const goalCount = ALL_GOALS.length;
