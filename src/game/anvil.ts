import type { ActionDef, Target } from './actions';
import { SUBTILES } from './crates';
import type { Game } from './game';
import { itemDef, type Item } from './items';
import { METAL_BY_ID, METAL_BY_LUMP, MOULD_BY_ID, mouldUsesLeft, mouldWear, type MouldDef } from './metal';

/**
 * An anvil: cast whole in a smelter, set down on four subtiles, and the place
 * every mould is beaten out. What it is made of shows in its colour and in how
 * kindly it treats the work.
 */
export interface PlacedAnvil {
  id: number;
  x: number;
  y: number;
  /** Top-left subtile of its two by two block. */
  sx: number;
  sy: number;
  /** Metal it was cast from. */
  metal: string;
  ql: number;
}

/** An anvil covers two subtiles each way: four in all. */
export const ANVIL_SUBTILES = 2;

export const anvilCentre = (a: PlacedAnvil): [number, number] => [a.x + (a.sx + 1) / SUBTILES, a.y + (a.sy + 1) / SUBTILES];
export const anvilCovers = (a: { sx: number; sy: number }, sx: number, sy: number): boolean =>
  sx >= a.sx && sx < a.sx + ANVIL_SUBTILES && sy >= a.sy && sy < a.sy + ANVIL_SUBTILES;
export const anvilAnchor = (sx: number, sy: number): [number, number] => [
  Math.max(0, Math.min(SUBTILES - ANVIL_SUBTILES, sx)),
  Math.max(0, Math.min(SUBTILES - ANVIL_SUBTILES, sy)),
];
export const anvilName = (a: PlacedAnvil): string => `${METAL_BY_ID.get(a.metal)?.name ?? 'Iron'} anvil`;

type AnvilTarget = Extract<Target, { kind: 'anvil' }>;
const anvilOf = (g: Game, t: Target): PlacedAnvil | undefined => (t.kind === 'anvil' ? g.anvils.get((t as AnvilTarget).id) : undefined);

/** The metal a mould would be filled with: whichever lump the player chose. */
function lumpFor(g: Game, uid?: number): Item | undefined {
  if (uid !== undefined) {
    const it = g.inventory.get(uid);
    return it && METAL_BY_LUMP.has(it.id) ? it : undefined;
  }
  return g.inventory.items.find((it) => METAL_BY_LUMP.has(it.id));
}

/** How good a piece comes out: the smith, the mould, the metal and the anvil all have a say. */
export function smithQl(g: Game, def: MouldDef, mouldQl: number, lumpQl: number, anvil: PlacedAnvil): number {
  const skill = g.skills.get(def.skill);
  return Math.max(1, Math.min(100, (g.productQl(def.skill) + mouldQl + lumpQl + anvil.ql) / 4 + skill / 25));
}

export const ANVIL_ACTIONS: ActionDef[] = [
  {
    id: 'place_anvil',
    label: 'Set the anvil down',
    verb: 'setting the anvil down',
    hidden: true,
    stamina: 0.05,
    baseTime: 4,
    applies: (t) => t.kind === 'tile',
    check: (t, g) => {
      if (t.kind !== 'tile' || t.sx === undefined || t.sy === undefined) return 'Choose a spot.';
      const item = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.find('anvil');
      if (!item || item.id !== 'anvil') return 'You have no anvil to set down.';
      return g.anvilPlaceReason(t.x, t.y, t.sx, t.sy);
    },
    perform: (t, g) => {
      if (t.kind !== 'tile' || t.sx === undefined || t.sy === undefined) return;
      const item = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.find('anvil');
      if (!item || item.id !== 'anvil' || !g.inventory.remove(item.uid, 1)) return;
      const a = g.addAnvil(t.x, t.y, t.sx, t.sy, item.extra ?? 'copper', item.ql);
      g.logMsg(`You set the ${anvilName(a).toLowerCase()} down. Bring a filled mould to it.`, 'event');
      g.events.emit('world', a.x, a.y);
    },
  },
  {
    id: 'pick_up_anvil',
    label: 'Take the anvil up',
    verb: 'lifting the anvil',
    stamina: 0.08,
    baseTime: 5,
    applies: (t, g) => anvilOf(g, t) !== undefined,
    perform: (t, g) => {
      const a = anvilOf(g, t);
      if (!a) return;
      g.removeAnvil(a.id);
      g.inventory.add('anvil', { ql: a.ql, extra: a.metal });
      g.logMsg(`You heave the ${anvilName(a).toLowerCase()} up onto your shoulder.`, 'event');
      g.events.emit('world', a.x, a.y);
    },
  },
  {
    id: 'smith',
    label: 'Smith',
    verb: 'working the metal',
    hidden: true,
    stamina: 0.06,
    baseTime: 9,
    applies: (t, g) => anvilOf(g, t) !== undefined,
    check: (t, g) => {
      const a = anvilOf(g, t);
      if (!a) return 'It is gone.';
      const [cx, cy] = anvilCentre(a);
      if (Math.hypot(cx - g.player.x, cy - g.player.y) > 2.4) return 'Stand at the anvil.';
      const mould = t.kind === 'anvil' && t.mouldUid !== undefined ? g.inventory.get(t.mouldUid) : undefined;
      const def = mould && MOULD_BY_ID.get(mould.id);
      if (!mould || !def) return 'Choose a mould.';
      if (def.makes === 'anvil') return 'An anvil is cast in a smelter, not beaten out here.';
      const lump = lumpFor(g, t.kind === 'anvil' ? t.itemUid : undefined);
      if (!lump) return 'You have no metal to pour.';
      if (lump.count < def.lumps) return `That takes ${def.lumps} lumps.`;
      return null;
    },
    perform: (t, g) => {
      const a = anvilOf(g, t);
      if (!a || t.kind !== 'anvil' || t.mouldUid === undefined) return;
      const mould = g.inventory.get(t.mouldUid);
      const def = mould && MOULD_BY_ID.get(mould.id);
      const lump = lumpFor(g, t.itemUid);
      const metal = lump && METAL_BY_LUMP.get(lump.id);
      if (!mould || !def || !lump || !metal || lump.count < def.lumps) return;
      if (!g.inventory.remove(lump.uid, def.lumps)) return;
      const mouldQl = Math.max(1, mould.ql - mould.dmg / 2);
      // Every filling wears the mould, and no mould can be mended.
      mould.dmg = Math.min(100, mould.dmg + mouldWear(mould.ql));
      const broke = mould.dmg >= 100;
      if (broke) g.inventory.remove(mould.uid, 1);
      g.events.emit('inventory');
      if (!g.skillCheck(def.skill, def.difficulty, a.ql, g.mindEase())) {
        g.gainSkill(def.skill, 0.25);
        g.logMsg(`The ${itemDef(def.makes).name.toLowerCase()} comes out misshapen and you throw the metal back.${broke ? ` The ${itemDef(mould.id).name.toLowerCase()} cracks through.` : ''}`, 'event');
        return;
      }
      const ql = smithQl(g, def, mouldQl, lump.ql, a);
      g.gainSkill(def.skill, 0.5);
      const per = def.per ?? 1;
      const made = g.inventory.add(def.makes, { ql, extra: metal.name, count: per });
      g.logMsg(
        `You beat out ${per > 1 ? `${per} ` : 'a '}${metal.name.toLowerCase()} ${itemDef(def.makes).name.toLowerCase()}${per > 1 ? 's' : ''} on the ${anvilName(a).toLowerCase()}. (QL ${made.ql.toFixed(1)})${
          broke ? ` The ${itemDef(mould.id).name.toLowerCase()} cracks through and is done.` : ` The mould has ${mouldUsesLeft(mould.ql, mould.dmg)} fillings left.`
        }`,
        'event',
      );
    },
  },
];

export const ANVIL_ACTION_BY_ID = new Map(ANVIL_ACTIONS.map((a) => [a.id, a]));
