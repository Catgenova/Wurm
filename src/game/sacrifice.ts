import type { ActionDef, Target } from './actions';
import type { Game } from './game';
import { furnitureCentre, furnitureDef, type PlacedFurniture } from './furniture';
import { describeWith, itemName, RARITIES, type Item } from './items';
import { NUTRIENTS, NUTRIENT_NAMES } from './nutrition';
import { BAUBLE_TIERS, TARNISHED } from './baubles';
import { capital, listed } from './words';

/**
 * Giving a rare thing up at the altar, and the motes it now and again leaves.
 *
 * Asked for: "Allow sacrificing rare, supreme, and fantastic items at the
 * altar. Each time one is sacrificed, all nutritional values are maxed. Each
 * sacrifice has a 1% chance to give the player a Mote. A rare sacrifice would
 * be a rare mote, supreme to supreme mote, etc. A mote can be absorbed to make
 * a normal item change to that mote's rarity."
 *
 * So:
 *
 *   * `sacrifice` gives up one of a rare, supreme or fantastic thing from the
 *     pack at an altar you are kneeling at -- one of a stack, where it is a
 *     stack -- and fills all four nutrients (`NUTRIENTS`) to the top.
 *   * `MOTE_CHANCE` of sacrifices leave a mote of the same rarity in the pack.
 *   * `absorb_mote` puts a mote into an ordinary thing in the pack -- one of a
 *     stack -- and that thing takes the mote's rarity; the mote is used up.
 *
 * What cannot be given up is what cannot be lost without taking something
 * else with it, or that was put by on purpose: a locked thing, a worn one, a
 * bag with anything in it and a crate with a wildermon in it. A bauble takes
 * no mote: its rarity is rolled when it is restored, and is already in what
 * is written on it.
 *
 * The island does the same (`sacrifice_*` and `absorb_*` in the migrations),
 * off the same numbers crossed in the defs, and says the same words.
 */

/** Of sacrifices, the share that leave a mote behind. */
export const MOTE_CHANCE = 0.01;

/** What a sacrifice may leave: it takes the rarity of what was given up, and gives it to an ordinary thing. */
export const MOTE = 'mote';
// The share a mote's description quotes, from the rule itself.
describeWith({ sacrifice: { mote: MOTE_CHANCE } });

/** The rarities there are, by name, as they are listed to somebody choosing: "rare, supreme or fantastic". */
const RARE_NAMES = RARITIES.slice(1).map((r) => r.name);
const anyRare = `${RARE_NAMES.slice(0, -1).join(', ')} or ${RARE_NAMES[RARE_NAMES.length - 1]}`;

/** Why a sacrifice or an absorbing will not go ahead, in the words both sides say. */
export const SACRIFICE_SAID = {
  notAltar: 'That is not an altar.',
  reach: 'Kneel at the altar.',
  pick: `Choose a ${anyRare} thing to give up.`,
  mote: 'A mote is not given up. Absorb it into something instead.',
  notRare: `Only a ${anyRare} thing may be given up.`,
  locked: 'It is put by. Unlock it first.',
  worn: 'Take it off first.',
  full: 'Empty it first.',
  creature: 'Let the wildermon out first.',
} as const;

export const ABSORB_SAID = {
  pickMote: 'Choose a mote to absorb.',
  pickItem: 'Choose something to absorb it into.',
  intoMote: 'A mote will not go into another mote.',
  bauble: 'A bauble\'s rarity is rolled when it is restored.',
} as const;
/** Why a thing that is already rare takes no mote. */
export const alreadyRare = (item: Pick<Item, 'rare'>): string =>
  `Only an ordinary thing takes a mote, and this is ${RARITIES[item.rare ?? 0].name} already.`;

/** What a sacrifice does for the one who makes it, in so many words: every nutrient named, and full. */
export const FED_SAID = `${capital(listed(NUTRIENTS.map((k) => NUTRIENT_NAMES[k].toLowerCase())))} are all at their fullest.`;

const pieceOf = (g: Game, t: Target): PlacedFurniture | undefined => (t.kind === 'furniture' ? g.furniture.get(t.id) : undefined);
const kneeling = (g: Game, f: PlacedFurniture): boolean => {
  const [cx, cy] = furnitureCentre(f);
  return Math.hypot(cx - g.player.x, cy - g.player.y) <= 2.4;
};
const isBauble = (item: Pick<Item, 'id'>): boolean => item.id === TARNISHED || BAUBLE_TIERS.some((t) => t.item === item.id);

/** Why this thing cannot be given up at this altar, or the altar and the thing when it can. */
export function sacrificeSetting(g: Game, t: Target): { why: string } | { altar: PlacedFurniture; item: Item } {
  const f = pieceOf(g, t);
  if (!f || !furnitureDef(f.kind).altar) return { why: SACRIFICE_SAID.notAltar };
  if (!kneeling(g, f)) return { why: SACRIFICE_SAID.reach };
  const item = t.kind === 'furniture' && t.itemUid !== undefined ? g.inventory.get(t.itemUid) : undefined;
  if (!item) return { why: SACRIFICE_SAID.pick };
  if (item.id === MOTE) return { why: SACRIFICE_SAID.mote };
  if (!item.rare) return { why: SACRIFICE_SAID.notRare };
  if (item.locked) return { why: SACRIFICE_SAID.locked };
  if (g.isEquipped(item.uid)) return { why: SACRIFICE_SAID.worn };
  if (item.inside?.length) return { why: SACRIFICE_SAID.full };
  if (item.creature !== undefined) return { why: SACRIFICE_SAID.creature };
  return { altar: f, item };
}

/** Why this mote will not go into this thing, or the two of them when it will. */
export function absorbSetting(g: Game, t: Target): { why: string } | { mote: Item; item: Item } {
  const mote = t.kind === 'item' && t.mote !== undefined ? g.inventory.get(t.mote) : undefined;
  if (!mote || mote.id !== MOTE || !mote.rare) return { why: ABSORB_SAID.pickMote };
  const item = t.kind === 'item' ? g.inventory.get(t.uid) : undefined;
  if (!item) return { why: ABSORB_SAID.pickItem };
  if (item.id === MOTE) return { why: ABSORB_SAID.intoMote };
  if (isBauble(item)) return { why: ABSORB_SAID.bauble };
  if (item.rare) return { why: alreadyRare(item) };
  return { mote, item };
}

/** What a mote may go into, of what is in the pack: every ordinary thing that is not a mote or a bauble. */
export const absorbable = (g: Game): Item[] => g.inventory.items.filter((it) => it.id !== MOTE && !it.rare && !isBauble(it));

/** What may be given up, of what is in the pack: everything rare, supreme or fantastic that is not a mote. */
export const sacrificeable = (g: Game): Item[] => g.inventory.items.filter((it) => it.id !== MOTE && !!it.rare);

export const SACRIFICE_ACTIONS: ActionDef[] = [
  {
    id: 'sacrifice',
    label: 'Sacrifice',
    verb: 'making a sacrifice',
    hidden: true,
    stamina: 0.01,
    baseTime: 4,
    applies: (t) => t.kind === 'furniture',
    check: (t, g) => {
      const s = sacrificeSetting(g, t);
      return 'why' in s ? s.why : null;
    },
    perform: (t, g) => {
      const s = sacrificeSetting(g, t);
      if ('why' in s) return;
      const { item } = s;
      const rare = item.rare ?? 0;
      const name = itemName({ ...item, count: 1 }).toLowerCase();
      const ql = item.ql;
      if (!g.inventory.remove(item.uid, 1)) return;
      for (const k of NUTRIENTS) g.player.nutrition[k] = 1;
      g.logMsg(`You give up the ${name} at the altar. ${FED_SAID}`, 'event');
      if (g.rand() < MOTE_CHANCE) {
        g.inventory.addItem({ uid: g.inventory.nextUid++, id: MOTE, ql, dmg: 0, count: 1, rare });
        g.logMsg(`A ${RARITIES[rare].name} mote is left where the ${name} was.`, 'event');
      }
      g.events.emit('inventory');
    },
  },
  {
    id: 'absorb_mote',
    label: 'Absorb a mote',
    verb: 'absorbing a mote',
    hidden: true,
    stamina: 0.01,
    baseTime: 3,
    applies: (t) => t.kind === 'item' && t.mote !== undefined,
    check: (t, g) => {
      const s = absorbSetting(g, t);
      return 'why' in s ? s.why : null;
    },
    perform: (t, g) => {
      const s = absorbSetting(g, t);
      if ('why' in s) return;
      const { mote, item } = s;
      const rare = mote.rare ?? 0;
      const moteName = itemName({ ...mote, count: 1 }).toLowerCase();
      const name = itemName({ ...item, count: 1 }).toLowerCase();
      // One of a stack takes it, where it is a stack, and the rest stay as they were; a thing on its own takes it where it is.
      if (item.count > 1) {
        const one = g.inventory.take(item.uid, 1);
        if (!one) return;
        one.rare = rare;
        g.inventory.addItem(one);
      } else {
        item.rare = rare;
      }
      g.inventory.remove(mote.uid, 1);
      g.logMsg(`The ${moteName} sinks into the ${name}, and it is ${RARITIES[rare].name} now.`, 'event');
      g.events.emit('inventory');
    },
  },
];
