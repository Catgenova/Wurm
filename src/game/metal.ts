import { world } from './pace';
/**
 * Metal, from the seam to the finished tool. Ore is mined, smelted into lumps,
 * lumps are mixed into alloys, sand is fired into moulds, a mould is poured
 * at the smelter and cools into a casting, and a casting is beaten true on
 * an anvil.
 */
export type SmithSkill = 'blacksmithing' | 'weaponsmithing' | 'armorsmithing' | 'chainsmithing' | 'platesmithing' | 'jewellery';

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
  metal('iron', 'Iron', 5, 1.25),
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
  metal('steel', 'Steel', 0, 1.7, null),
];

export const METAL_BY_ID = new Map(METALS.map((m) => [m.id, m]));
export const METAL_BY_ORE = new Map(METALS.filter((m) => m.ore).map((m) => [m.ore as string, m]));
export const METAL_BY_LUMP = new Map(METALS.map((m) => [m.lump, m]));
export const isLump = (id: string): boolean => METAL_BY_LUMP.has(id);
export const isOreItem = (id: string): boolean => METAL_BY_ORE.has(id);

/** Metal a single nail takes, in kilograms, and so how many come off one lump. */
/**
 * Coins: a lump of silver or gold struck into twenty under a die, at the
 * anvil. A compact store of metal that goes in a pocket, and comes back out
 * of the fire as a lump when it is melted down. The die wears with every
 * strike. The island reads the same three.
 */
export const COINS_PER_LUMP = 20;
export const DIE_WEAR = 2;
export const COIN_DIFFICULTY = 12;
/** The metals a coin is struck from. */
export const COIN_METALS = ['silver', 'gold'];
export const NAIL_WEIGHT = 0.01;
export const NAILS_PER_LUMP = 100;

/**
 * Ore a lump takes.
 *
 * One: every piece of ore out of the seam is one lump out of the furnace.
 * What differs between the metals is the lump, not the ore — a lump of iron
 * is a kilo and a lump of gold or silver a tenth of one, which is the item
 * table's to say. It was ten for one for a while, on the argument that a
 * lump should not be a swing of a pickaxe; asked for back, with the lump's
 * size carrying the difference instead. The island reads the same number.
 */
export const ORE_PER_LUMP = 1;

/**
 * The metals that come out of the same twenty kilograms as a tenth of a lump.
 *
 * Rarity in the rock is only half of what makes a metal precious; the other
 * half is how little of it a ton of ore holds. These six give 0.10 kg where
 * iron gives 1, so the furnace takes the same charge and hands back a tenth as
 * much metal.
 */
export const RARE_METALS: ReadonlySet<string> = new Set([
  'silver', 'gold', 'adamantine', 'glimmersteel', 'mithril', 'seryll',
]);

/**
 * How many more of those lumps a mould takes, which is not a penalty but the
 * same arithmetic read from the other end: a mould wants a weight of metal,
 * and a lump of these weighs a tenth of what an iron one does.
 */
export const RARE_LUMP_FACTOR = 10;

/** Lumps of a given metal one filling of a mould takes. */
export const mouldLumps = (mould: MouldDef, metalId: string): number =>
  mould.lumps * (RARE_METALS.has(metalId) ? RARE_LUMP_FACTOR : 1);

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
  { id: 'anvil_mould', name: 'Anvil mould', makes: 'anvil', skill: 'blacksmithing', sand: 4, difficulty: 10, lumps: 20 },
  { id: 'pan_mould', name: 'Pan mould', makes: 'frying_pan', skill: 'blacksmithing', sand: 2, difficulty: 8, lumps: 1 },
  { id: 'rake_head_mould', name: 'Rake head mould', makes: 'rake_head', skill: 'blacksmithing', sand: 2, difficulty: 10, lumps: 1 },
  { id: 'shovel_head_mould', name: 'Shovel head mould', makes: 'shovel_head', skill: 'blacksmithing', sand: 2, difficulty: 10, lumps: 1 },
  { id: 'hatchet_head_mould', name: 'Hatchet head mould', makes: 'hatchet_head', skill: 'blacksmithing', sand: 2, difficulty: 12, lumps: 1 },
  { id: 'sickle_blade_mould', name: 'Sickle blade mould', makes: 'sickle_blade', skill: 'blacksmithing', sand: 2, difficulty: 12, lumps: 1 },
  { id: 'pickaxe_head_mould', name: 'Pickaxe head mould', makes: 'pickaxe_head', skill: 'blacksmithing', sand: 2, difficulty: 12, lumps: 1 },
  { id: 'knife_blade_mould', name: 'Knife blade mould', makes: 'knife_blade', skill: 'blacksmithing', sand: 2, difficulty: 14, lumps: 1 },
  { id: 'sword_blade_mould', name: 'Sword blade mould', makes: 'sword_blade', skill: 'weaponsmithing', sand: 3, difficulty: 18, lumps: 2 },
  { id: 'helm_mould', name: 'Helm mould', makes: 'helm', skill: 'platesmithing', sand: 3, difficulty: 16, lumps: 2 },
  // Gang moulds: one lump of metal runs out as a great many small things.
  { id: 'nail_mould', name: 'Nail mould', makes: 'nail', skill: 'blacksmithing', sand: 2, difficulty: 6, lumps: 1, per: NAILS_PER_LUMP },
  { id: 'ribbon_mould', name: 'Ribbon mould', makes: 'ribbon', skill: 'blacksmithing', sand: 2, difficulty: 10, lumps: 1, per: 4 },
  // The one part of a vehicle that is metal all the way through.
  { id: 'axle_mould', name: 'Axle mould', makes: 'big_axle', skill: 'blacksmithing', sand: 3, difficulty: 20, lumps: 3 },
  { id: 'arrow_head_mould', name: 'Arrow head mould', makes: 'arrow_head', skill: 'weaponsmithing', sand: 2, difficulty: 8, lumps: 1, per: 25 },
  // Weapon heads, fitted to a shaft afterwards.
  { id: 'short_sword_blade_mould', name: 'Short sword blade mould', makes: 'short_sword_blade', skill: 'weaponsmithing', sand: 2, difficulty: 14, lumps: 1 },
  { id: 'long_sword_blade_mould', name: 'Long sword blade mould', makes: 'long_sword_blade', skill: 'weaponsmithing', sand: 4, difficulty: 24, lumps: 3 },
  { id: 'axe_head_mould', name: 'Axe head mould', makes: 'axe_head', skill: 'weaponsmithing', sand: 3, difficulty: 20, lumps: 2 },
  { id: 'maul_head_mould', name: 'Maul head mould', makes: 'maul_head', skill: 'weaponsmithing', sand: 4, difficulty: 18, lumps: 3 },
  { id: 'spear_head_mould', name: 'Spear head mould', makes: 'spear_head', skill: 'weaponsmithing', sand: 2, difficulty: 16, lumps: 1 },
  { id: 'shield_boss_mould', name: 'Shield boss mould', makes: 'shield_boss', skill: 'armorsmithing', sand: 3, difficulty: 14, lumps: 2 },
  { id: 'file_mould', name: 'File mould', makes: 'file', skill: 'blacksmithing', sand: 2, difficulty: 12, lumps: 1 },
  { id: 'coin_die_mould', name: 'Coin die mould', makes: 'coin_die', skill: 'blacksmithing', sand: 2, difficulty: 16, lumps: 2 },
  { id: 'horseshoe_mould', name: 'Horseshoe mould', makes: 'horseshoe', skill: 'blacksmithing', sand: 2, difficulty: 10, lumps: 1, per: 4 },
  // Fittings for building: hinges for anything that swings, brackets to bind a gate.
  { id: 'hinge_mould', name: 'Hinge mould', makes: 'hinge', skill: 'blacksmithing', sand: 2, difficulty: 8, lumps: 1, per: 2 },
  { id: 'bracket_mould', name: 'Bracket mould', makes: 'bracket', skill: 'blacksmithing', sand: 2, difficulty: 8, lumps: 1, per: 4 },
  // A jeweller's castings, two to a lump. The stone comes after, with a file.
  { id: 'ring_mould', name: 'Ring mould', makes: 'ring', skill: 'jewellery', sand: 2, difficulty: 14, lumps: 1, per: 2 },
  { id: 'pendant_mould', name: 'Pendant mould', makes: 'pendant', skill: 'jewellery', sand: 2, difficulty: 16, lumps: 1, per: 2 },
  // The two big castings: a bell and a figure, each hung or set up afterwards.
  { id: 'bell_mould', name: 'Bell mould', makes: 'bell_casting', skill: 'blacksmithing', sand: 6, difficulty: 26, lumps: 8 },
  { id: 'statue_mould', name: 'Statue mould', makes: 'statue_casting', skill: 'blacksmithing', sand: 8, difficulty: 30, lumps: 12 },
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
/** The mould a piece comes out of, by the piece: what a casting is of, read back to its mould. */
export const MOULD_BY_MAKES = new Map(MOULDS.map((m) => [m.makes, m]));
/** A casting: what a poured mould cools into, carrying the piece it is of. */
export const isCasting = (it: { id: string; piece?: string }): boolean => it.id === 'casting' && !!it.piece;

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
  return world(Math.max(4, 18 * work * (0.6 + oreQl / 90) * (1.4 - smelterQl / 160)));
}

/** Seconds for a filled anvil mould to cool into an anvil. */
export const castSeconds = (metalId: string, ql: number): number =>
  world(Math.max(20, 70 * (METAL_BY_ID.get(metalId)?.work ?? 1) * (0.7 + ql / 130)));

/**
 * Seconds for any other filled mould to cool into a casting: the anvil's
 * cooling time scaled by the metal in it, an anvil being twenty lumps, and
 * never under eight seconds' worth. The island reads the same sum.
 */
export const pourSeconds = (mould: MouldDef, metalId: string, ql: number): number =>
  Math.max(world(8), (castSeconds(metalId, ql) * mould.lumps) / 20);

/** Tool heads that become a tool once fitted to a shaft. */
export const HEAD_TO_TOOL: Record<string, string> = {
  rake_head: 'rake',
  shovel_head: 'shovel',
  hatchet_head: 'hatchet',
  sickle_blade: 'sickle',
  pickaxe_head: 'pickaxe',
  knife_blade: 'butchering_knife',
  sword_blade: 'sword',
  short_sword_blade: 'short_sword',
  long_sword_blade: 'long_sword',
  axe_head: 'battle_axe',
  maul_head: 'maul',
  spear_head: 'spear',
};
