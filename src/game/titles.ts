import { SKILL_DEFS } from './skills';

/**
 * Titles, and what a trade leaves in the hand.
 *
 * Two things come out of a long climb. A **title** is the name a skill earns
 * you — four of them, at 50, 70, 90 and 99 — and you wear one of them at a
 * time. A **knack** is what rubs off: one go in five thousand at any trade
 * leaves a permanent knack, usually in that trade and sometimes in one beside
 * it, and a knack makes the work go in faster for good. It is a matter of luck
 * rather than of levels, so it can come at any moment and it never dries up.
 */

/** The four rungs, and the skill each one wants. */
export const TITLE_STEPS = [50, 70, 90, 99] as const;

/**
 * Two words per trade: what you are called when you are good at it, and what
 * you are called when you are known for it. The master and legendary rungs are
 * the second word with a prefix, as everywhere else.
 */
const NAMES: Record<string, [string, string]> = {
  digging: ['Digger', 'Excavator'],
  mining: ['Miner', 'Pickman'],
  prospecting: ['Rockhound', 'Prospector'],
  woodcutting: ['Woodcutter', 'Axeman'],
  forestry: ['Planter', 'Forester'],
  foraging: ['Gleaner', 'Forager'],
  botanizing: ['Herbalist', 'Botanist'],
  fishing: ['Angler', 'Fisherman'],
  brewing: ['Brewer', 'Vintner'],
  paving: ['Paver', 'Roadwright'],
  masonry: ['Bricklayer', 'Mason'],
  stonecutting: ['Stonecutter', 'Sculptor'],
  carpentry: ['Joiner', 'Carpenter'],
  fine_carpentry: ['Cabinetmaker', 'Fine Carpenter'],
  pottery: ['Potter', 'Ceramicist'],
  tailoring: ['Seamster', 'Tailor'],
  ropemaking: ['Roper', 'Ropemaker'],
  cooking: ['Cook', 'Chef'],
  milling: ['Miller', 'Grinder'],
  smelting: ['Smelter', 'Founder'],
  blacksmithing: ['Smith', 'Blacksmith'],
  weaponsmithing: ['Bladesmith', 'Weaponsmith'],
  armorsmithing: ['Armourer', 'Armoursmith'],
  farming: ['Farmhand', 'Farmer'],
  taming: ['Handler', 'Tamer'],
  animal_husbandry: ['Herdsman', 'Breeder'],
  butchering: ['Skinner', 'Butcher'],
  alchemy: ['Mixer', 'Alchemist'],
  repair: ['Mender', 'Restorer'],
  first_aid: ['Binder', 'Physician'],
  papyrusmaking: ['Papermaker', 'Papyrusmaker'],
  archaeology: ['Digger of the Past', 'Archaeologist'],
  restoration: ['Piecer', 'Antiquarian'],
  leatherworking: ['Currier', 'Leatherworker'],
  chainsmithing: ['Linksmith', 'Chainsmith'],
  platesmithing: ['Platesmith', 'Plate Armoursmith'],
  bowyery: ['Stavemaker', 'Bowyer'],
  fletching: ['Shaftmaker', 'Fletcher'],
  climbing: ['Scrambler', 'Climber'],
  swimming: ['Swimmer', 'Waterman'],
  fighting: ['Fighter', 'Warrior'],
  swords: ['Swordsman', 'Blademaster'],
  axes: ['Axefighter', 'Axemaster'],
  mauls: ['Maulwielder', 'Maulmaster'],
  knives: ['Knifefighter', 'Knifemaster'],
  polearms: ['Spearman', 'Polearm Master'],
  archery: ['Bowman', 'Marksman'],
  shields: ['Shieldbearer', 'Shieldmaster'],
  cloth_armour: ['Robed', 'Cloth Adept'],
  leather_armour: ['Buffcoat', 'Leather Adept'],
  chain_armour: ['Mailclad', 'Chain Adept'],
  plate_armour: ['Ironclad', 'Plate Adept'],
};

export interface TitleDef {
  id: string;
  skill: string;
  at: number;
  name: string;
}

/** Every title there is: four to a trade, in the order they come. */
export const TITLES: TitleDef[] = SKILL_DEFS.filter((d) => NAMES[d.id]).flatMap((d) => {
  const [lesser, greater] = NAMES[d.id];
  const names = [lesser, greater, `Master ${greater}`, `Legendary ${greater}`];
  return TITLE_STEPS.map((at, i) => ({ id: `${d.id}:${at}`, skill: d.id, at, name: names[i] }));
});
export const TITLE_BY_ID = new Map(TITLES.map((t) => [t.id, t]));
/** The titles a given skill can earn, lowest first. */
export const titlesFor = (skill: string): TitleDef[] => TITLES.filter((t) => t.skill === skill);

/** Every title this level of this skill has earned, lowest first. */
export const earnedBy = (skill: string, level: number): TitleDef[] => titlesFor(skill).filter((t) => level >= t.at);

// ---- Knacks ----

/**
 * Trades that sit next to each other. Ten points of carpentry usually leaves
 * you better at carpentry and sometimes at bowyery, because it is the same
 * hands and the same wood.
 */
export const FAMILIES: Record<string, string[]> = {
  wood: ['woodcutting', 'forestry', 'carpentry', 'fine_carpentry', 'bowyery', 'fletching'],
  stone: ['digging', 'mining', 'prospecting', 'masonry', 'stonecutting', 'paving'],
  metal: ['smelting', 'blacksmithing', 'weaponsmithing', 'armorsmithing', 'chainsmithing', 'platesmithing', 'jewellery'],
  cloth: ['tailoring', 'leatherworking', 'ropemaking', 'papyrusmaking'],
  land: ['farming', 'foraging', 'botanizing', 'fishing', 'cooking', 'milling', 'brewing', 'alchemy'],
  beast: ['taming', 'animal_husbandry', 'butchering', 'first_aid'],
  lore: ['archaeology', 'restoration', 'repair', 'pottery'],
  war: ['fighting', 'swords', 'axes', 'mauls', 'knives', 'polearms', 'archery', 'shields'],
  mail: ['cloth_armour', 'leather_armour', 'chain_armour', 'plate_armour'],
  body: ['climbing', 'swimming'],
};
export const FAMILY_OF = new Map<string, string>();
for (const [name, members] of Object.entries(FAMILIES)) for (const id of members) FAMILY_OF.set(id, name);
/** The trades that sit beside this one, itself included. */
export const kin = (skill: string): string[] => FAMILIES[FAMILY_OF.get(skill) ?? ''] ?? [skill];

/** What one knack is worth on the rate that skill goes in at. */
export const KNACK_BONUS = 0.1;
/** The most knacks one trade will hold. */
export const KNACK_CAP = 5;
/** How often the knack lands on the trade you were working rather than a neighbour. */
export const KNACK_HOME = 0.6;

/**
 * One go in this many leaves a knack behind. It is not tied to the level you
 * reach, so a trade keeps paying knacks for as long as you keep working at it
 * rather than stopping dead once the early tens are behind you — and a knack
 * can come at any moment, which is the whole pleasure of it.
 */
export const KNACK_ODDS = 5000;

/** Where a knack earned at this trade lands. */
export function knackLands(skill: string, rand: () => number): string {
  if (rand() < KNACK_HOME) return skill;
  const near = kin(skill);
  return near[Math.floor(rand() * near.length)] ?? skill;
}

/** What the knacks in a trade are worth to it. */
export const knackBonus = (n: number | undefined): number => Math.min(KNACK_CAP, n ?? 0) * KNACK_BONUS;
