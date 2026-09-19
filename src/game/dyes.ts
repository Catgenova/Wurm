export { DYES, DYE_BY_ID, DYE_BY_NAME, dyeOf, dyeWord, type DyeDef } from './dyestuffs';
import type { ActionDef, Target } from './actions';
import type { Game } from './game';
import { ARMOUR_BY_ID } from './gear';
import { itemDef, type Item } from './items';
import { DYE_BY_NAME, type DyeDef } from './dyestuffs';

/**
 * Colour.
 *
 * Everything made on this island comes out the colour of what it was made
 * from: cloth is the grey-white of the wool, leather the brown of the hide.
 * A **dye** changes that, and it is the first thing in the game that is
 * yours rather than the island's.
 *
 * A dye is boiled out of something that grows — berries, acorn galls, herbs
 * — with a bucket of **lye** to bite the colour into the fibre and hold it
 * there. Without the lye it washes out, which is why the alchemy is worth
 * doing before the tailoring.
 */

/**
 * What will take a dye: anything woven or tanned, and the things made out of
 * them. Metal will not, and neither will a tool you are going to get dirty.
 */
const DYEABLE_ARMOUR = new Set(['cloth', 'leather']);
export const DYEABLE_ITEMS = new Set(['cloth', 'sack', 'satchel', 'backpack', 'saddle', 'bridle', 'banner', 'sailing_boat']);
export function takesDye(id: string): boolean {
  const a = ARMOUR_BY_ID.get(id);
  if (a) return DYEABLE_ARMOUR.has(a.cls);
  return DYEABLE_ITEMS.has(id);
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
      const d = it && pickDye(g);
      return d ? `Dye it ${d.def.word}` : 'Dye it';
    },
    check: (t, g) => {
      const it = itemOf(g, t);
      if (!it) return 'It is gone.';
      if (!takesDye(it.id)) return 'Nothing will take on that.';
      const d = pickDye(g);
      if (!d) return 'You have no dye. Boil one out of berries, acorns or herbs with a bucket of lye.';
      if (it.dye === d.def.id) return `It is ${d.def.word} already.`;
      return null;
    },
    perform: (t, g) => {
      const it = itemOf(g, t);
      const d = pickDye(g);
      if (!it || !d || !g.inventory.remove(d.item.uid, 1)) return;
      // One pot does one thing. A stack is split so the rest stays the colour it was.
      const one = it.count > 1 ? g.inventory.take(it.uid, 1) : it;
      if (!one) return;
      one.dye = d.def.id;
      if (one !== it) g.inventory.addItem(one);
      g.gainSkill('alchemy', 0.3);
      g.note('dyed');
      g.logMsg(`You work the ${d.def.name.toLowerCase()} through it. It comes out ${d.def.word}.`, 'event');
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
    applies: (t, g) => !!itemOf(g, t)?.dye,
    check: (t, g) => {
      const it = itemOf(g, t);
      if (!it?.dye) return 'It has taken no colour.';
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

/** The dye in the pack that will be used: the best pot of the first colour found. */
export function pickDye(g: Game): { item: Item; def: DyeDef } | null {
  let best: { item: Item; def: DyeDef } | null = null;
  for (const it of g.inventory.items) {
    if (it.id !== 'dye') continue;
    const def = it.extra ? DYE_BY_NAME.get(it.extra) : undefined;
    if (!def) continue;
    if (!best || it.ql > best.item.ql) best = { item: it, def };
  }
  return best;
}
