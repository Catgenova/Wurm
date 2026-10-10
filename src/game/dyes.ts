import type { ActionDef, Target } from './actions';
import type { Game } from './game';
import { ARMOUR_BY_ID } from './gear';
import { describeWith, ITEM_DEFS, itemDef, type Item } from './items';
import { BUCKET_LITRES, furnitureName, holdsLiquid, isWell, litresIn, type PlacedFurniture } from './furniture';
import { drawFrom, dyeInPiece, vesselBecomes } from './placeables';
import {
  colourWord, DYE_BUCKET, DYE_LITRES, DYE_LITRES_PER_KG, DYE_QL_BLACK, DYE_QL_PURE, DYE_QL_WHITE, dyeGrams, dyeHex, dyeIn, dyeLitresFor,
  dyeRecipeId, dyeSays, DYESTUFF_OF, DYESTUFFS, dyeText, kgSaid, pureDye, type DyeLiquid, type Dyestuff,
} from './dyestuffs';

/**
 * Colour.
 *
 * Everything made on this island comes out the colour of what it was made
 * from: cloth is the grey-white of the wool, leather the brown of the hide.
 * A **dye** changes that.
 *
 * A dyestuff boiled in a bucket of lye gives one primary, pure: red, yellow
 * or blue (`DYESTUFFS`), a kilo of it by weight for every litre of lye, and as
 * many litres of dye as there was lye. Every other colour is mixed by pouring
 * one dye into another in a barrel, and the QL of a dye is how bright it is
 * (`dyestuffs.ts`). Dyeing a thing takes litres out of one bucket of dye in
 * the pack or one barrel of dye within reach, by the size of the thing
 * (`DYE_LITRES`), and gives it exactly the dye's colour.
 */

/**
 * What will take a dye: anything woven or tanned, and the things made out of
 * them. Metal will not, and neither will a tool you are going to get dirty.
 */
const DYEABLE_ARMOUR = new Set(['cloth', 'leather']);
export const DYEABLE_ITEMS = new Set(['cloth', 'sack', 'satchel', 'backpack', 'saddle', 'bridle', 'banner', 'flagpole', 'sailing_boat', 'caravel']);
export function takesDye(id: string): boolean {
  const a = ARMOUR_BY_ID.get(id);
  if (a) return DYEABLE_ARMOUR.has(a.cls);
  return DYEABLE_ITEMS.has(id);
}

/* ---- boiling ------------------------------------------------------------ */

/**
 * What a dye boil is done in, and the litres of water in it: a bucket of lye,
 * which is a bucket of water with ashes leached into it and is always full.
 * Nothing else that holds water goes over a fire: a barrel stands where it
 * was put, and a clay pot holds no liquid. The lye comes off as as many
 * litres of dye.
 */
export const BOIL_IN = 'lye_bucket';
export const BOIL_LITRES = BUCKET_LITRES;

/** One of a dyestuff, in grams: what a boil weighs it by. */
export const gramsOf = (id: string): number => Math.round(itemDef(id).weight * 1000);
/** The fewest whole items of a dyestuff that weigh `grams` or more. */
export const countForGrams = (id: string, grams: number): number => {
  const each = gramsOf(id);
  return Math.floor((grams + each - 1) / each);
};
/** The plain name of a dyestuff, for a weight of it: "raspberries", "lotus flower". */
const stuffName = (id: string): string => itemDef(id).name.toLowerCase();

/**
 * Grams of its dyestuff a boil takes from you: a kilo for every litre of lye
 * in the bucket, at the litres a kilo makes under your perks (a Naturalist's
 * Double Boil, `litres:dye`) and the share of the weight they ask (a
 * Thrifty Dyer's, `need:` and the recipe). The island's `dye_boil_grams`.
 */
export const boilGrams = (g: Game, recipe: string): number =>
  dyeGrams(BOIL_LITRES, g.perk('litres:dye', DYE_LITRES_PER_KG), g.perk(`need:${recipe}`, 1));

/** Whether this input of this recipe is a boil's dyestuff, which is counted by its weight. */
export const isBoilStuff = (recipe: string, item: string): boolean => DYESTUFF_OF.has(item) && recipe === dyeRecipeId(item);

/** The items of its dyestuff a boil takes from you, the fewest whole ones over the weight. */
export const boilCount = (g: Game, recipe: string, item: string): number => countForGrams(item, boilGrams(g, recipe));

/** The items a boil takes with no perk: what its recipe is written down as. */
export const boilCountPlain = (item: string): number => countForGrams(item, dyeGrams(BOIL_LITRES, DYE_LITRES_PER_KG));

/**
 * Why a boil will not go for want of weight, `have` being how many of the
 * dyestuff are at hand: "It takes 5 kg of raspberries for 5 litres of lye;
 * you have 3.2 kg." The island's `dye_boil_refusal`.
 */
export function boilRefusal(g: Game, recipe: string, item: string, have: number): string | null {
  const grams = boilGrams(g, recipe);
  if (have * gramsOf(item) >= grams) return null;
  return `It takes ${kgSaid(grams)} kg of ${stuffName(item)} for ${BOIL_LITRES} litres of lye; you have ${kgSaid(have * gramsOf(item))} kg.`;
}

/** What a dyestuff's card says it is for, off the boil itself. */
export const dyestuffUse = (d: Dyestuff): string =>
  `Boiled in a bucket of lye for ${d.primary} dye: ${kgSaid(dyeGrams(1, DYE_LITRES_PER_KG))} kg to every litre of lye, so ${kgSaid(dyeGrams(BOIL_LITRES, DYE_LITRES_PER_KG))} kg `
  + `(${boilCountPlain(d.from)} of them, at ${kgSaid(gramsOf(d.from))} kg each) for the ${BOIL_LITRES} litres in a bucket, which come off as ${BOIL_LITRES} litres of dye.`;

/** What a boil says it took: "You boil down 5 kg of raspberries, 50 of them, in 5 litres of lye." The island's `dye_boil_said`. */
export const boilSaid = (from: string, used: number): string =>
  `You boil down ${kgSaid(used * gramsOf(from))} kg of ${stuffName(from)}, ${used} of ${used === 1 ? 'it' : 'them'}, in ${BOIL_LITRES} litres of lye.`;

/**
 * A boil, come off the bench: the bucket of lye is a bucket of the
 * dyestuff's primary at the boil's QL, as many litres as there was lye, and
 * it says what it took. One bucket, and full: a boil is done in the one
 * bucket it had, so a bauble's go adds nothing to it (`recipeAction` asks
 * none of a boil).
 */
export function boiledDye(g: Game, made: Item, from: string, used: number): void {
  const stuff = DYESTUFF_OF.get(from);
  if (!stuff || made.id !== DYE_BUCKET) return;
  made.count = 1;
  made.dye = dyeText(pureDye(stuff.primary, made.ql), BOIL_LITRES);
  g.inventory.onChange?.();
  g.logMsg(boilSaid(from, used), 'event');
}

/* ---- what a dyeing draws from ---------------------------------------------- */

/**
 * One place a dyeing can draw from: a bucket of dye loose in the pack, or a
 * barrel of dye within reach. `key` is how a target names it in `dyeFrom`,
 * the same on the island: `item:<number>` or `furniture:<number>`.
 */
export interface DyeSource {
  key: string;
  liquid: DyeLiquid;
  litres: number;
  hex: string;
  /** Where it is, said: "Bucket, in your pack", "Barrel". */
  where: string;
  item?: Item;
  piece?: PlacedFurniture;
}

/** The dye chosen on a target, if one was. */
export const dyeChoice = (t: Target): string | undefined => {
  const v = (t as Target & { dyeFrom?: unknown }).dyeFrom;
  return typeof v === 'string' ? v : undefined;
};

/**
 * The barrels of dye a dyeing reaches: the stores a craft reaches
 * (`Game.liquidStoresWithin`, `CRAFT_REACH` tiles, yours or on a settlement
 * of yours and not locked against you) that hold a whole litre of dye. The
 * island's `dye_barrels`.
 */
export function dyeBarrels(g: Game): PlacedFurniture[] {
  return g.liquidStoresWithin().filter((f) => holdsLiquid(f) && !isWell(f) && !!dyeInPiece(f) && Math.floor(litresIn(f)) >= 1)
    .sort((a, b) => a.id - b.id);
}

/**
 * Every bucket of dye loose in the pack and not kept back, by number, then
 * every barrel of dye within reach, by number: each with what is in it. The
 * island lists them in the same order (`dye_sources`).
 */
export function dyeSources(g: Game): DyeSource[] {
  const out: DyeSource[] = [];
  for (const it of [...g.inventory.items].sort((a, b) => a.uid - b.uid)) {
    const d = dyeIn(it);
    // A bucket kept back is not spent, as nothing kept back is.
    if (!d || it.locked) continue;
    out.push({ key: `item:${it.uid}`, liquid: d.liquid, litres: d.litres, hex: dyeHex(d.liquid), where: 'Bucket, in your pack', item: it });
  }
  for (const f of dyeBarrels(g)) {
    const l = dyeInPiece(f);
    if (l) out.push({ key: `furniture:${f.id}`, liquid: l, litres: Math.floor(litresIn(f)), hex: dyeHex(l), where: furnitureName(f), piece: f });
  }
  return out;
}

/** Those of them that hold `litres` or more. */
export const dyeEnough = (g: Game, litres: number): DyeSource[] => dyeSources(g).filter((s) => s.litres >= litres);

/**
 * The dye a dyeing of `litres` will use: the one chosen, while it holds
 * enough; with none chosen, the first that holds enough. Null if there is
 * none, or the one chosen is gone or holds too little.
 */
export function pickDye(g: Game, litres: number, choice?: string): DyeSource | null {
  const all = dyeEnough(g, litres);
  return (choice !== undefined ? all.find((s) => s.key === choice) : all[0]) ?? null;
}

export const litresWord = (n: number): string => `${n} ${n === 1 ? 'litre' : 'litres'}`;
/** What is said when there is no dye to dye with at all, `reach` being how far a dyeing reaches for a barrel. */
export const noDye = (reach: number): string =>
  `You have no dye in your pack or in a barrel within ${reach} tiles. Boil a dyestuff in a bucket of lye for red, yellow or blue dye.`;
/** And when there is, but no one bucket or barrel of it holds what this takes. */
export const tooLittleDye = (litres: number, most: number): string =>
  `It takes ${litresWord(litres)} of dye, and the most any one bucket or barrel of it holds is ${litresWord(most)}. A dyeing draws from one only.`;
/** And when the one chosen is gone, or has too little left in it. */
export const dyeGone = (litres: number): string => `The dye you chose is gone or holds less than ${litresWord(litres)} now. Choose again.`;
/** A thing that is that colour already. */
export const dyedAlready = (hex: string): string => `It is ${colourWord(hex)} already, ${hex}.`;

/**
 * Why a dyeing of `litres` will not go onto a thing that is `has` now, or
 * null: no dye at all, none that holds enough, the one chosen gone, or the
 * thing that colour already. With several that hold enough and none chosen
 * yet, the one asking is asked which (`Game.requestAction`), so it is refused
 * only if every one of them is the colour the thing is. The island's
 * `dye_reason`.
 */
export function dyeReason(g: Game, litres: number, choice: string | undefined, has: string | null | undefined, reach: number): string | null {
  const all = dyeSources(g);
  const enough = all.filter((s) => s.litres >= litres);
  if (!enough.length) return all.length ? tooLittleDye(litres, Math.max(...all.map((s) => s.litres))) : noDye(reach);
  const d = choice !== undefined ? enough.find((s) => s.key === choice) : enough.length === 1 ? enough[0] : undefined;
  if (choice !== undefined && !d) return dyeGone(litres);
  if (d) return has === d.hex ? dyedAlready(d.hex) : null;
  return enough.every((s) => s.hex === has) ? dyedAlready(enough[0].hex) : null;
}

/** Take `litres` out of a bucket or a barrel of dye; a bucket left with none is an empty bucket. */
export function spendDye(g: Game, from: DyeSource, litres: number): boolean {
  if (from.piece) return drawFrom(g, from.piece, litres);
  const bucket = from.item;
  const d = dyeIn(bucket);
  if (!bucket || !d || d.litres < litres) return false;
  const left = d.litres - litres;
  if (left <= 0) return vesselBecomes(g, bucket, 'bucket');
  bucket.dye = dyeText(d.liquid, left);
  g.inventory.onChange?.();
  g.events.emit('inventory');
  return true;
}

/** What the picker lists for a source: where it is, and what Examine says of the dye in it. */
export const sourceSays = (s: DyeSource): string => `${s.where}: ${dyeSays(s.liquid, s.litres)}`;
/** What the picker asks. */
export const pickDyeAsks = (litres: number): string => `Which dye? This takes ${litresWord(litres)}, out of one bucket or barrel.`;

type ItemTarget = Extract<Target, { kind: 'item' }>;
const isItem = (t: Target): t is ItemTarget => t.kind === 'item';
const itemOf = (g: Game, t: Target): Item | undefined => (isItem(t) ? g.inventory.get(t.uid) : undefined);

export const DYE_ACTIONS: ActionDef[] = [
  {
    id: 'dye_item',
    label: 'Dye it',
    verb: 'dyeing',
    skill: 'alchemy',
    stamina: 0.02,
    baseTime: 8,
    applies: (t, g) => {
      const it = itemOf(g, t);
      return !!it && takesDye(it.id);
    },
    dyeLitres: (t, g) => {
      const it = itemOf(g, t);
      return it && takesDye(it.id) ? dyeLitresFor(it.id) : null;
    },
    labelFor: (t, g) => {
      const it = itemOf(g, t);
      const all = it ? dyeEnough(g, dyeLitresFor(it.id)) : [];
      return all.length === 1 ? `Dye it ${colourWord(all[0].hex)}` : 'Dye it';
    },
    check: (t, g) => {
      const it = itemOf(g, t);
      if (!it) return 'It is gone.';
      if (!takesDye(it.id)) return 'Nothing will take on that.';
      return dyeReason(g, dyeLitresFor(it.id), dyeChoice(t), it.dye, g.dyeReach());
    },
    perform: (t, g) => {
      const it = itemOf(g, t);
      if (!it) return;
      const need = dyeLitresFor(it.id);
      const d = pickDye(g, need, dyeChoice(t));
      if (!d || !spendDye(g, d, need)) return;
      // A stack is split so the rest stays the colour it was.
      const one = it.count > 1 ? g.inventory.take(it.uid, 1) : it;
      if (!one) return;
      one.dye = d.hex;
      if (one !== it) g.inventory.addItem(one);
      g.gainSkill('alchemy', 0.3);
      g.note('dyed');
      g.logMsg(`You work ${litresWord(need)} of ${colourWord(d.hex)} dye through it. It comes out ${colourWord(d.hex)}, ${d.hex}.`, 'event');
      g.events.emit('inventory');
    },
  },
  {
    id: 'strip_dye',
    label: 'Boil the colour out',
    verb: 'boiling the colour out',
    skill: 'alchemy',
    stamina: 0.02,
    baseTime: 6,
    applies: (t, g) => {
      const it = itemOf(g, t);
      return !!it?.dye && takesDye(it.id);
    },
    check: (t, g) => {
      const it = itemOf(g, t);
      if (!it?.dye || !takesDye(it.id)) return 'It has taken no colour.';
      if (!g.inventory.has('lye_bucket')) return 'You need a bucket of lye to strip it.';
      return null;
    },
    perform: (t, g) => {
      const it = itemOf(g, t);
      const lye = g.inventory.find('lye_bucket');
      if (!it || !lye) return;
      g.inventory.remove(lye.uid, 1);
      g.inventory.add('bucket', { ql: lye.ql });
      delete it.dye;
      g.gainSkill('alchemy', 0.2);
      g.logMsg(`You boil it out in lye. It is back to the colour of ${itemDef(it.id).name.toLowerCase()}.`, 'event');
      g.events.emit('inventory');
    },
  },
];

// What each dyestuff boils into, off the boil itself, onto its card.
for (const s of DYESTUFFS) {
  const d = ITEM_DEFS[s.from];
  if (d) d.description = [d.description, dyestuffUse(s)].filter(Boolean).join(' ');
}

// The litres a dyeing takes and a boil makes, into the text of a bucket of dye.
describeWith({ dye: DYE_LITRES, dyeBoil: BOIL_LITRES, perKg: DYE_LITRES_PER_KG, qlBlack: DYE_QL_BLACK, qlPure: DYE_QL_PURE, qlWhite: DYE_QL_WHITE });
