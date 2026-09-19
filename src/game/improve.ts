import { tryGain } from './learn';
import type { ActionDef } from './actions';
import { ARMOUR_BY_ID, isShield, WEAPON_BY_ID } from './gear';
import { FURNITURE_BY_ID } from './furniture';
import type { Game } from './game';
import { itemDef, itemName, liftRarity, rarityOf, RARITIES, RARITY_LIFT, type Item } from './items';
import { isMould } from './metal';
import { materialOfItem, matOf } from './materials';

/** What one pass with a file teaches, whichever way it comes out. */
export const IMPROVE_GAIN = 0.4;

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
  metal: { id: 'metal', name: 'metal', tools: ['file', 'whetstone'], stock: ['copper_lump', 'iron_lump', 'steel_lump', 'tin_lump', 'zinc_lump', 'lead_lump', 'silver_lump', 'gold_lump', 'bronze_lump', 'brass_lump', 'pewter_lump', 'electrum_lump', 'adamantine_lump', 'glimmersteel_lump', 'mithril_lump', 'seryll_lump'], skill: 'blacksmithing' },
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
  'sickle',
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
  // A wagon is rough carpentry, whatever else in the workshop is fine work.
  const piece = FURNITURE_BY_ID.get(id);
  if (piece) return { material: piece.skill === 'masonry' ? MATERIALS.stone : MATERIALS.wood, skill: piece.skill ?? 'fine_carpentry' };
  if (id === 'whetstone' || id === 'quern') return { material: MATERIALS.stone, skill: 'stonecutting' };
  // Everything else — food, materials, moulds, green ware — is left as it was made.
  return null;
}

export const canImprove = (id: string): boolean => !isMould(id) && improvable(id) !== null;

/**
 * A thing cannot be bettered past the hands doing the work — except that a
 * rare thing has something in it the hands did not put there, and goes a
 * little further than they could take an ordinary one.
 */
export const improveCeiling = (g: Game, skill: string, item?: Item): number =>
  Math.max(10, g.skills.get(skill)) + (item ? rarityOf(item).ceiling : 0);

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

/**
 * The stock carried for a material, preferring the poorest so the good stays.
 * A thing that is made of something can only be built up with more of the
 * same: you do not patch an oak chest with pine, and a copper blade will not
 * take bronze.
 */
function stockFor(g: Game, def: MaterialDef, made: string | undefined): Item | undefined {
  let worst: Item | undefined;
  for (const it of g.inventory.items) {
    if (!def.stock.includes(it.id)) continue;
    /*
     * Stock that says what it is made of has to say the right thing; stock
     * that says nothing — an unmarked plank, a shaft off an old save — is
     * stock of no particular sort and will go into anything. A lump always
     * says: its metal is in its name, which is what `materialOfItem` reads.
     */
    const its = materialOfItem(it)?.name;
    if (made && its && its !== made) continue;
    if (!worst || it.ql < worst.ql) worst = it;
  }
  return worst;
}

/** What a thing is made of, when that is a thing it can be made of. */
const madeOf = (item: Item): string | undefined => materialOfItem(item)?.name;

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
      return !!item && !item.issued && canImprove(item.id);
    },
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      const item = g.inventory.get(t.uid);
      if (!item) return 'It is gone.';
      const what = improvable(item.id);
      if (!what) return 'That is not something you can better.';
      if (item.issued) return 'That came ashore with you. There is nothing in it to better — make one of your own.';
      if (item.dmg > 10) return 'It is too knocked about to work on. Repair it first.';
      const missing = missingTool(g, what.material);
      if (missing) return `You need ${what.material.tools.map((id) => itemDef(id).name.toLowerCase()).join(' and ')} to work ${what.material.name}.`;
      const made = madeOf(item);
      if (!stockFor(g, what.material, made)) return `You have no ${made ? made.toLowerCase() : what.material.name} to work into it, and nothing else will do.`;
      const ceiling = improveCeiling(g, what.skill, item);
      if (item.ql >= ceiling) return `Your ${what.skill.replace(/_/g, ' ')} is not good enough to better it further.`;
      if (item.ql >= 99.9) return 'It cannot be bettered.';
      /*
       * A quality to stop at, when one was asked for.
       *
       * Improving is the deepest time sink on this island and the only way to
       * ask for it in bulk was a count of passes — five, ten, fifty — which
       * is a number nobody can work out in advance, because what a pass is
       * worth falls away as the piece gets better. Forty to forty-one is one
       * pass; ninety to ninety-one is a dozen.
       *
       * So a piece can be asked for a quality instead, and the repeat does
       * the counting. It costs nothing but this refusal: a job that repeats
       * asks its own check before every go and stops the moment it is
       * refused, so "take it to sixty" is "keep going until sixty refuses
       * you", on both sides, with no change to what a pass does.
       */
      const upto = 'upto' in t && typeof t.upto === 'number' ? t.upto : null;
      if (upto !== null && item.ql >= upto) return `The ${itemName(item).toLowerCase()} is at QL ${item.ql.toFixed(1)}, which is what you asked for.`;
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.get(t.uid);
      const what = item && improvable(item.id);
      if (!item || !what) return;
      const made = madeOf(item);
      const stock = stockFor(g, what.material, made);
      if (!stock || !g.inventory.remove(stock.uid, 1)) return;
      const toolQl = Math.max(...what.material.tools.map((id) => g.toolQl(id)));
      // A failed pass marks the piece rather than spoiling it outright. Oak
      // and the deep metals are stubborn under the file as under the saw.
      // The gain used to be written above this line, which paid a marked piece
      // exactly what a passed one is worth.
      const ok = g.skillCheck(what.skill, 12 + item.ql / 3 + matOf(item.extra).difficulty, toolQl, g.mindEase());
      g.gainSkill(what.skill, tryGain(ok, IMPROVE_GAIN));
      if (!ok) {
        g.damageItem(item, 3 + g.rand() * 5);
        g.logMsg(`You work at the ${itemName(item).toLowerCase()} and mark it. (damage ${item.dmg.toFixed(1)})`, 'event');
        return item.dmg <= 10;
      }
      const ceiling = Math.min(99.9, improveCeiling(g, what.skill, item));
      item.ql = Math.max(item.ql, Math.min(ceiling, item.ql + improveStep(g, item, what.skill)));
      /*
       * And now and again the thing itself comes on, not just its quality.
       *
       * The same odds as the bench: a hundred good passes turn a plain thing
       * rare about once, a thousand a rare thing supreme, ten thousand a
       * supreme thing fantastic. One step at a time, so the only road to the
       * top of it is through the middle of it.
       *
       * Said before the quality line, the way the bench says it, and the line
       * after calls the thing by its new name because `itemName` reads the
       * rarity. A step up also lifts the ceiling it may be bettered to, which
       * is the next pass's business rather than this one's.
       */
      const lifted = liftRarity(item, g.rand);
      if (lifted !== null) {
        item.rare = lifted;
        g.note(RARITIES[lifted].name);
        g.logMsg(RARITY_LIFT[lifted], 'skill');
      }
      g.events.emit('inventory');
      g.logMsg(`The ${itemName(item).toLowerCase()} is better than it was. (QL ${item.ql.toFixed(1)})`, 'event');
      // Keep at it while there is room and stock of the right stuff left.
      return item.ql < ceiling && !!stockFor(g, what.material, made);
    },
  },
];

export const IMPROVE_ACTION_BY_ID = new Map(IMPROVE_ACTIONS.map((a) => [a.id, a]));
