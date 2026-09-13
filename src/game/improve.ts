import type { ActionDef } from './actions';
import { ARMOUR_BY_ID, isShield, WEAPON_BY_ID } from './gear';
import { FURNITURE_BY_ID } from './furniture';
import type { Game } from './game';
import { itemDef, itemName, type Item } from './items';
import { isMould } from './metal';

/**
 * Improving: taking a finished thing and making it better than it was made.
 * What it is made of decides what you need in your hands — a file and a
 * whetstone for metal, a knife and a file for wood, a needle for cloth, an awl
 * for leather — and how much of itself it takes to build it up.
 */
export type Material = 'metal' | 'wood' | 'cloth' | 'leather' | 'stone';

export interface MaterialDef {
  id: Material;
  name: string;
  /** Every one of these must be carried; none of them is used up. */
  tools: string[];
  /** One of these is consumed per attempt, whichever is carried. */
  stock: string[];
  /** Skill the work is judged by, unless the item names its own. */
  skill: string;
}

export const MATERIALS: Record<Material, MaterialDef> = {
  metal: { id: 'metal', name: 'metal', tools: ['file', 'whetstone'], stock: ['copper_lump', 'tin_lump', 'zinc_lump', 'lead_lump', 'silver_lump', 'gold_lump', 'bronze_lump', 'brass_lump', 'pewter_lump', 'electrum_lump', 'adamantine_lump', 'glimmersteel_lump', 'mithril_lump', 'seryll_lump'], skill: 'blacksmithing' },
  wood: { id: 'wood', name: 'wood', tools: ['carving_knife', 'file'], stock: ['plank', 'shaft'], skill: 'carpentry' },
  cloth: { id: 'cloth', name: 'cloth', tools: ['needle'], stock: ['cloth'], skill: 'tailoring' },
  leather: { id: 'leather', name: 'leather', tools: ['awl', 'needle'], stock: ['leather'], skill: 'leatherworking' },
  stone: { id: 'stone', name: 'stone', tools: ['chisel', 'whetstone'], stock: ['rock_shards', 'slate_shards', 'marble_shards', 'sandstone_shards'], skill: 'stonecutting' },
};

/** Tools whose heads are metal, whatever the handle is. */
const METAL_TOOLS = new Set([
  'shovel',
  'pickaxe',
  'hatchet',
  'carving_knife',
  'chisel',
  'trowel',
  'saw',
  'rake',
  'butchering_knife',
  'frying_pan',
  'file',
  'needle',
  'awl',
  'anvil',
]);
const WOOD_TOOLS = new Set(['mallet', 'short_bow', 'medium_bow', 'long_bow', 'club', 'wooden_shield', 'lectern']);

/** What a thing is made of, and which skill judges work on it. */
export function improvable(id: string): { material: MaterialDef; skill: string } | null {
  const armour = ARMOUR_BY_ID.get(id);
  if (armour) {
    if (armour.cls === 'cloth') return { material: MATERIALS.cloth, skill: 'tailoring' };
    if (armour.cls === 'leather') return { material: MATERIALS.leather, skill: 'leatherworking' };
    return { material: MATERIALS.metal, skill: armour.cls === 'chain' ? 'chainsmithing' : 'platesmithing' };
  }
  if (id === 'wooden_shield') return { material: MATERIALS.wood, skill: 'carpentry' };
  if (id === 'metal_shield' || isShield(id)) return { material: MATERIALS.metal, skill: 'armorsmithing' };
  // A hatchet or a carving knife is a tool that can fight, so a smith keeps it.
  if (METAL_TOOLS.has(id)) return { material: MATERIALS.metal, skill: 'blacksmithing' };
  const bow = WEAPON_BY_ID.get(id);
  if (bow?.ammo) return { material: MATERIALS.wood, skill: 'bowyery' };
  if (WOOD_TOOLS.has(id)) return { material: MATERIALS.wood, skill: 'carpentry' };
  if (WEAPON_BY_ID.has(id)) return { material: MATERIALS.metal, skill: 'weaponsmithing' };
  if (FURNITURE_BY_ID.has(id)) return { material: MATERIALS.wood, skill: 'fine_carpentry' };
  if (id === 'whetstone' || id === 'quern') return { material: MATERIALS.stone, skill: 'stonecutting' };
  // Everything else — food, materials, moulds, green ware — is left as it was made.
  return null;
}

export const canImprove = (id: string): boolean => !isMould(id) && improvable(id) !== null;

/** A thing cannot be bettered past the hands doing the work. */
export const improveCeiling = (g: Game, skill: string): number => Math.max(10, g.skills.get(skill));

/** How much a successful pass adds: a great deal at first, very little near the end. */
export function improveStep(g: Game, item: Item, skill: string): number {
  const level = g.skills.get(skill);
  const room = Math.max(0, 100 - item.ql);
  return Math.max(0.08, room * 0.05 * (0.35 + level / 130));
}

/** The first of a material's tools that is missing, or null when all are in hand. */
function missingTool(g: Game, def: MaterialDef): string | null {
  for (const id of def.tools) if (!g.inventory.has(id)) return id;
  return null;
}

/** The stock carried for a material, preferring the poorest so the good stays. */
function stockFor(g: Game, def: MaterialDef): Item | undefined {
  let worst: Item | undefined;
  for (const it of g.inventory.items) {
    if (!def.stock.includes(it.id)) continue;
    if (!worst || it.ql < worst.ql) worst = it;
  }
  return worst;
}

export const IMPROVE_ACTIONS: ActionDef[] = [
  {
    id: 'improve_item',
    label: 'Improve',
    verb: 'improving',
    repeat: true,
    stamina: 0.03,
    baseTime: 2,
    applies: (t, g) => {
      if (t.kind !== 'item') return false;
      const item = g.inventory.get(t.uid);
      return !!item && canImprove(item.id);
    },
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      const item = g.inventory.get(t.uid);
      if (!item) return 'It is gone.';
      const what = improvable(item.id);
      if (!what) return 'That is not something you can better.';
      if (item.dmg > 10) return 'It is too knocked about to work on. Repair it first.';
      const missing = missingTool(g, what.material);
      if (missing) return `You need ${what.material.tools.map((id) => itemDef(id).name.toLowerCase()).join(' and ')} to work ${what.material.name}.`;
      if (!stockFor(g, what.material)) return `You have no ${what.material.name} to work into it.`;
      const ceiling = improveCeiling(g, what.skill);
      if (item.ql >= ceiling) return `Your ${what.skill.replace(/_/g, ' ')} is not good enough to better it further.`;
      if (item.ql >= 99.9) return 'It cannot be bettered.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.get(t.uid);
      const what = item && improvable(item.id);
      if (!item || !what) return;
      const stock = stockFor(g, what.material);
      if (!stock || !g.inventory.remove(stock.uid, 1)) return;
      const toolQl = Math.max(...what.material.tools.map((id) => g.toolQl(id)));
      g.gainSkill(what.skill, 0.4);
      // A failed pass marks the piece rather than spoiling it outright.
      if (!g.skillCheck(what.skill, 12 + item.ql / 3, toolQl, g.mindEase())) {
        g.damageItem(item, 3 + g.rand() * 5);
        g.logMsg(`You work at the ${itemName(item).toLowerCase()} and mark it. (damage ${item.dmg.toFixed(1)})`, 'event');
        return item.dmg <= 10;
      }
      const ceiling = Math.min(99.9, improveCeiling(g, what.skill));
      item.ql = Math.max(item.ql, Math.min(ceiling, item.ql + improveStep(g, item, what.skill)));
      g.events.emit('inventory');
      g.logMsg(`The ${itemName(item).toLowerCase()} is better than it was. (QL ${item.ql.toFixed(1)})`, 'event');
      // Keep at it while there is room and stock left.
      return item.ql < ceiling && !!stockFor(g, what.material);
    },
  },
];

export const IMPROVE_ACTION_BY_ID = new Map(IMPROVE_ACTIONS.map((a) => [a.id, a]));
