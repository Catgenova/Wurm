import type { ActionDef, Target } from './actions';
import type { Game } from './game';
import { ARMOUR_BY_ID } from './gear';
import { describeWith, itemDef, type Item } from './items';
import { BUCKET_LITRES } from './furniture';
import { vesselBecomes } from './placeables';
import {
  colourWord, DYE_BOIL_LITRES, DYE_BUCKET, DYE_LITRES, DYE_QL_BLACK, DYE_QL_PURE, DYE_QL_WHITE, dyeHex, dyeIn, dyeLitresFor, DYESTUFF_OF, dyeText, pureDye, type DyeLiquid,
} from './dyestuffs';

/**
 * Colour.
 *
 * Everything made on this island comes out the colour of what it was made
 * from: cloth is the grey-white of the wool, leather the brown of the hide.
 * A **dye** changes that.
 *
 * A dyestuff boiled in a bucket of lye gives one primary, pure: red, yellow
 * or blue (`DYESTUFFS`). Every other colour is mixed by pouring one dye into
 * another in a barrel, and the QL of a dye is how bright it is
 * (`dyestuffs.ts`). Dyeing a thing takes litres out of a bucket of dye by
 * the size of the thing (`DYE_LITRES`) and gives it exactly the dye's colour.
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

/** What is said when there is no dye in the pack to dye with at all. */
export const NO_DYE = 'You have no dye in your pack. Boil a dyestuff in a bucket of lye for red, yellow or blue dye.';
/** And when there is, but no one bucket of it holds what this takes. */
export const tooLittleDye = (litres: number): string =>
  `It takes ${litres} ${litres === 1 ? 'litre' : 'litres'} of dye, and no bucket of dye in your pack holds that much.`;
/** A thing that is that colour already. */
export const dyedAlready = (hex: string): string => `It is ${colourWord(hex)} already, ${hex}.`;
export const litresWord = (n: number): string => `${n} ${n === 1 ? 'litre' : 'litres'}`;

/**
 * The dye a dyeing will use: of the buckets of dye loose in the pack (not in
 * a bag, and not kept back) that hold at least `litres`, the one with the
 * lowest number, which is the one longest in the pack. The island asks the
 * same (`pick_dye`).
 */
export function pickDye(g: Game, litres: number): { item: Item; liquid: DyeLiquid; litres: number; hex: string } | null {
  let best: { item: Item; liquid: DyeLiquid; litres: number; hex: string } | null = null;
  for (const it of g.inventory.items) {
    const d = dyeIn(it);
    // A bucket kept back is not spent, as nothing kept back is.
    if (!d || d.litres < litres || it.locked) continue;
    if (!best || it.uid < best.item.uid) best = { item: it, liquid: d.liquid, litres: d.litres, hex: dyeHex(d.liquid) };
  }
  return best;
}

/** Why there is nothing to dye with, for a dyeing that takes `litres`. */
export const dyeRefusal = (g: Game, litres: number): string | null =>
  (pickDye(g, litres) ? null : g.inventory.items.some((it) => dyeIn(it)) ? tooLittleDye(litres) : NO_DYE);

/** Take `litres` out of a bucket of dye, and leave it an empty bucket if that is the last of it. */
export function spendDye(g: Game, bucket: Item, litres: number): boolean {
  const d = dyeIn(bucket);
  if (!d || d.litres < litres) return false;
  const left = d.litres - litres;
  if (left <= 0) return vesselBecomes(g, bucket, 'bucket');
  bucket.dye = dyeText(d.liquid, left);
  g.inventory.onChange?.();
  g.events.emit('inventory');
  return true;
}

/**
 * A boil, come off the bench: the bucket of lye is a bucket of the
 * dyestuff's primary at the boil's QL, `DYE_BOIL_LITRES` of it (more for a
 * Naturalist's Double Boil, `litres:dye`), and as many litres more for each
 * go a bauble adds, up to what a bucket holds. One bucket however many goes:
 * a boil is done in the one bucket it had.
 */
export function boiledDye(g: Game, made: Item, from: string): void {
  const stuff = DYESTUFF_OF.get(from);
  if (!stuff || made.id !== DYE_BUCKET) return;
  const litres = Math.min(BUCKET_LITRES, g.perk('litres:dye', DYE_BOIL_LITRES) * Math.max(1, made.count));
  made.count = 1;
  made.dye = dyeText(pureDye(stuff.primary, made.ql), litres);
  g.inventory.onChange?.();
}

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
    labelFor: (t, g) => {
      const it = itemOf(g, t);
      const d = it && pickDye(g, dyeLitresFor(it.id));
      return d ? `Dye it ${colourWord(d.hex)}` : 'Dye it';
    },
    check: (t, g) => {
      const it = itemOf(g, t);
      if (!it) return 'It is gone.';
      if (!takesDye(it.id)) return 'Nothing will take on that.';
      const need = dyeLitresFor(it.id);
      const d = pickDye(g, need);
      if (!d) return dyeRefusal(g, need);
      if (it.dye === d.hex) return dyedAlready(d.hex);
      return null;
    },
    perform: (t, g) => {
      const it = itemOf(g, t);
      if (!it) return;
      const need = dyeLitresFor(it.id);
      const d = pickDye(g, need);
      if (!d || !spendDye(g, d.item, need)) return;
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

// The litres a dyeing takes and a boil makes, into the text of a bucket of dye.
describeWith({ dye: DYE_LITRES, dyeBoil: DYE_BOIL_LITRES, qlBlack: DYE_QL_BLACK, qlPure: DYE_QL_PURE, qlWhite: DYE_QL_WHITE });
