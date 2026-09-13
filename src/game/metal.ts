/**
 * Metal, from the seam to the finished tool. Ore is mined, smelted into lumps,
 * lumps are mixed into alloys, sand is fired into moulds, and a mould filled
 * with metal is beaten out on an anvil.
 */
export type SmithSkill = 'blacksmithing' | 'weaponsmithing' | 'armorsmithing' | 'chainsmithing' | 'platesmithing';

export interface MetalDef {
  id: string;
  name: string;
  /** Ore item mined out of the seam, or null for an alloy. */
  ore: string | null;
  lump: string;
  /** Mining skill the seam takes; alloys have none. */
  level: number;
  /** How stubborn it is in the furnace, as a multiple of the base smelting time. */
  work: number;
}

const metal = (id: string, name: string, level: number, work: number, ore: string | null = `${id}_ore`): MetalDef => ({
  id,
  name,
  ore,
  lump: `${id}_lump`,
  level,
  work,
});

export const METALS: MetalDef[] = [
  metal('copper', 'Copper', 1, 1),
  metal('tin', 'Tin', 10, 0.9),
  metal('zinc', 'Zinc', 20, 1),
  metal('lead', 'Lead', 30, 0.85),
  metal('silver', 'Silver', 40, 1.2),
  metal('gold', 'Gold', 50, 1.3),
  metal('adamantine', 'Adamantine', 60, 1.8),
  metal('glimmersteel', 'Glimmersteel', 70, 2.1),
  metal('mithril', 'Mithril', 80, 2.4),
  metal('seryll', 'Seryll', 90, 2.8),
  // Alloys are mixed in the smelter rather than dug up.
  metal('bronze', 'Bronze', 0, 1.1, null),
  metal('brass', 'Brass', 0, 1.1, null),
  metal('pewter', 'Pewter', 0, 0.9, null),
  metal('electrum', 'Electrum', 0, 1.3, null),
];

export const METAL_BY_ID = new Map(METALS.map((m) => [m.id, m]));
export const METAL_BY_ORE = new Map(METALS.filter((m) => m.ore).map((m) => [m.ore as string, m]));
export const METAL_BY_LUMP = new Map(METALS.map((m) => [m.lump, m]));
export const isLump = (id: string): boolean => METAL_BY_LUMP.has(id);
export const isOreItem = (id: string): boolean => METAL_BY_ORE.has(id);

/** Metal a single nail takes, in kilograms, and so how many come off one lump. */
export const NAIL_WEIGHT = 0.01;
export const NAILS_PER_LUMP = 100;

export interface MouldDef {
  id: string;
  name: string;
  /** Item beaten out of it on an anvil. */
  makes: string;
  skill: SmithSkill;
  /** Sand it takes to fire one. */
  sand: number;
  /** How hard the finished piece is to get right. */
  difficulty: number;
  /** Lumps of metal a single filling uses. */
  lumps: number;
  /** Pieces one filling makes; one unless the mould is a gang mould. */
  per?: number;
}

export const MOULDS: MouldDef[] = [
  { id: 'anvil_mould', name: 'Anvil mould', makes: 'anvil', skill: 'blacksmithing', sand: 4, difficulty: 10, lumps: 4 },
  { id: 'pan_mould', name: 'Pan mould', makes: 'frying_pan', skill: 'blacksmithing', sand: 2, difficulty: 8, lumps: 1 },
  { id: 'rake_head_mould', name: 'Rake head mould', makes: 'rake_head', skill: 'blacksmithing', sand: 2, difficulty: 10, lumps: 1 },
  { id: 'shovel_head_mould', name: 'Shovel head mould', makes: 'shovel_head', skill: 'blacksmithing', sand: 2, difficulty: 10, lumps: 1 },
  { id: 'hatchet_head_mould', name: 'Hatchet head mould', makes: 'hatchet_head', skill: 'blacksmithing', sand: 2, difficulty: 12, lumps: 1 },
  { id: 'pickaxe_head_mould', name: 'Pickaxe head mould', makes: 'pickaxe_head', skill: 'blacksmithing', sand: 2, difficulty: 12, lumps: 1 },
  { id: 'knife_blade_mould', name: 'Knife blade mould', makes: 'knife_blade', skill: 'blacksmithing', sand: 2, difficulty: 14, lumps: 1 },
  { id: 'sword_blade_mould', name: 'Sword blade mould', makes: 'sword_blade', skill: 'weaponsmithing', sand: 3, difficulty: 18, lumps: 2 },
  { id: 'helm_mould', name: 'Helm mould', makes: 'helm', skill: 'platesmithing', sand: 3, difficulty: 16, lumps: 2 },
  // Gang moulds: one lump of metal runs out as a great many small things.
  { id: 'nail_mould', name: 'Nail mould', makes: 'nail', skill: 'blacksmithing', sand: 2, difficulty: 6, lumps: 1, per: NAILS_PER_LUMP },
  { id: 'arrow_head_mould', name: 'Arrow head mould', makes: 'arrow_head', skill: 'weaponsmithing', sand: 2, difficulty: 8, lumps: 1, per: 25 },
  // Weapon heads, fitted to a shaft afterwards.
  { id: 'short_sword_blade_mould', name: 'Short sword blade mould', makes: 'short_sword_blade', skill: 'weaponsmithing', sand: 2, difficulty: 14, lumps: 1 },
  { id: 'long_sword_blade_mould', name: 'Long sword blade mould', makes: 'long_sword_blade', skill: 'weaponsmithing', sand: 4, difficulty: 24, lumps: 3 },
  { id: 'axe_head_mould', name: 'Axe head mould', makes: 'axe_head', skill: 'weaponsmithing', sand: 3, difficulty: 20, lumps: 2 },
  { id: 'maul_head_mould', name: 'Maul head mould', makes: 'maul_head', skill: 'weaponsmithing', sand: 4, difficulty: 18, lumps: 3 },
  { id: 'spear_head_mould', name: 'Spear head mould', makes: 'spear_head', skill: 'weaponsmithing', sand: 2, difficulty: 16, lumps: 1 },
  { id: 'shield_boss_mould', name: 'Shield boss mould', makes: 'shield_boss', skill: 'armorsmithing', sand: 3, difficulty: 14, lumps: 2 },
  // Chain: rings drawn from a mould and riveted up.
  { id: 'chain_coif_mould', name: 'Chain coif mould', makes: 'chain_coif', skill: 'chainsmithing', sand: 3, difficulty: 18, lumps: 2 },
  { id: 'chain_hauberk_mould', name: 'Chain hauberk mould', makes: 'chain_hauberk', skill: 'chainsmithing', sand: 5, difficulty: 26, lumps: 5 },
  { id: 'chain_sleeves_mould', name: 'Chain sleeves mould', makes: 'chain_sleeves', skill: 'chainsmithing', sand: 3, difficulty: 20, lumps: 3 },
  { id: 'chain_leggings_mould', name: 'Chain leggings mould', makes: 'chain_leggings', skill: 'chainsmithing', sand: 4, difficulty: 22, lumps: 4 },
  { id: 'chain_boots_mould', name: 'Chain boots mould', makes: 'chain_boots', skill: 'chainsmithing', sand: 3, difficulty: 18, lumps: 2 },
  // Plate: beaten out whole, and the helm has been here since the first anvil.
  { id: 'plate_breastplate_mould', name: 'Breastplate mould', makes: 'plate_breastplate', skill: 'platesmithing', sand: 6, difficulty: 32, lumps: 6 },
  { id: 'plate_arms_mould', name: 'Plate arms mould', makes: 'plate_arms', skill: 'platesmithing', sand: 4, difficulty: 26, lumps: 3 },
  { id: 'plate_legs_mould', name: 'Plate legs mould', makes: 'plate_legs', skill: 'platesmithing', sand: 5, difficulty: 28, lumps: 4 },
  { id: 'plate_boots_mould', name: 'Plate boots mould', makes: 'plate_boots', skill: 'platesmithing', sand: 4, difficulty: 24, lumps: 3 },
];

export const MOULD_BY_ID = new Map(MOULDS.map((m) => [m.id, m]));
export const isMould = (id: string): boolean => MOULD_BY_ID.has(id);

/**
 * How much damage a mould takes each time it is filled. A finer mould lasts
 * longer, but none of them can be mended, so every one wears out in the end.
 */
export const mouldWear = (ql: number): number => Math.max(3, 26 - ql * 0.22);
/** Casts a mould of this quality has left in it. */
export const mouldUsesLeft = (ql: number, dmg: number): number => Math.max(0, Math.ceil((100 - dmg) / mouldWear(ql)));

/** Seconds to smelt one ore, slower for stubborn metal and fine ore, faster in a good smelter. */
export function smeltSeconds(metalId: string, oreQl: number, smelterQl: number): number {
  const m = METAL_BY_ID.get(metalId);
  const work = m?.work ?? 1;
  return Math.max(4, 18 * work * (0.6 + oreQl / 90) * (1.4 - smelterQl / 160));
}

/** Seconds for a filled anvil mould to cool into an anvil. */
export const castSeconds = (metalId: string, ql: number): number => Math.max(20, 70 * (METAL_BY_ID.get(metalId)?.work ?? 1) * (0.7 + ql / 130));

/** Tool heads that become a tool once fitted to a shaft. */
export const HEAD_TO_TOOL: Record<string, string> = {
  rake_head: 'rake',
  shovel_head: 'shovel',
  hatchet_head: 'hatchet',
  pickaxe_head: 'pickaxe',
  knife_blade: 'butchering_knife',
  sword_blade: 'sword',
  short_sword_blade: 'short_sword',
  long_sword_blade: 'long_sword',
  axe_head: 'battle_axe',
  maul_head: 'maul',
  spear_head: 'spear',
};
