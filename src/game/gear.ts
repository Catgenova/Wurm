import type { ActionDef, Target } from './actions';
import type { Game } from './game';
import { itemDef, rarityOf, type Item } from './items';
import { matOf } from './materials';

/**
 * What you wear and what you swing. Armour is worn a piece to a slot and only
 * counts where the blow lands; weapons carry their own weight, reach and pace;
 * and every kind of both trains a subskill of its own, by being used or by
 * being hit.
 */
export type Slot = 'head' | 'chest' | 'arms' | 'legs' | 'feet' | 'weapon' | 'offhand';

export const SLOTS: Slot[] = ['head', 'chest', 'arms', 'legs', 'feet', 'weapon', 'offhand'];
export const SLOT_NAMES: Record<Slot, string> = {
  head: 'Head',
  chest: 'Chest',
  arms: 'Arms',
  legs: 'Legs',
  feet: 'Feet',
  weapon: 'Hand',
  offhand: 'Off hand',
};

/** Where a blow lands, and how likely each is. */
export const HIT_LOCATIONS: Array<[Slot, number]> = [
  ['head', 0.12],
  ['chest', 0.34],
  ['arms', 0.16],
  ['legs', 0.26],
  ['feet', 0.12],
];

export type ArmourClass = 'cloth' | 'leather' | 'chain' | 'plate' | 'scale';

export interface ArmourClassDef {
  id: ArmourClass;
  name: string;
  /** Subskill trained by being hit in it. */
  skill: string;
  /** Share of a blow the piece turns aside at middling quality. */
  soak: number;
  /** Walking speed and stamina it costs to wear a full set. */
  burden: number;
}

export const ARMOUR_CLASSES: Record<ArmourClass, ArmourClassDef> = {
  cloth: { id: 'cloth', name: 'Cloth', skill: 'cloth_armour', soak: 0.16, burden: 0.01 },
  leather: { id: 'leather', name: 'Leather', skill: 'leather_armour', soak: 0.3, burden: 0.05 },
  chain: { id: 'chain', name: 'Chain', skill: 'chain_armour', soak: 0.46, burden: 0.14 },
  plate: { id: 'plate', name: 'Plate', skill: 'plate_armour', soak: 0.62, burden: 0.26 },
  // Dragon scale: what a dragon was wearing, riveted onto a leather backing.
  // It turns more than plate and weighs less than chain, and there is exactly
  // one way to get any.
  scale: { id: 'scale', name: 'Scale', skill: 'plate_armour', soak: 0.74, burden: 0.11 },
};

export interface ArmourDef {
  id: string;
  slot: Slot;
  cls: ArmourClass;
}

const armour = (id: string, slot: Slot, cls: ArmourClass): ArmourDef => ({ id, slot, cls });

/** Every piece: five slots in each of the four classes. */
export const ARMOUR: ArmourDef[] = [
  armour('wool_cap', 'head', 'cloth'),
  armour('cloth_tunic', 'chest', 'cloth'),
  armour('cloth_sleeves', 'arms', 'cloth'),
  armour('cloth_trousers', 'legs', 'cloth'),
  armour('cloth_shoes', 'feet', 'cloth'),
  armour('leather_cap', 'head', 'leather'),
  armour('leather_jerkin', 'chest', 'leather'),
  armour('leather_sleeves', 'arms', 'leather'),
  armour('leather_trousers', 'legs', 'leather'),
  armour('leather_boots', 'feet', 'leather'),
  armour('chain_coif', 'head', 'chain'),
  armour('chain_hauberk', 'chest', 'chain'),
  armour('chain_sleeves', 'arms', 'chain'),
  armour('chain_leggings', 'legs', 'chain'),
  armour('chain_boots', 'feet', 'chain'),
  armour('helm', 'head', 'plate'),
  armour('plate_breastplate', 'chest', 'plate'),
  armour('plate_arms', 'arms', 'plate'),
  armour('plate_legs', 'legs', 'plate'),
  armour('plate_boots', 'feet', 'plate'),
  armour('scale_helm', 'head', 'scale'),
  armour('scale_cuirass', 'chest', 'scale'),
  armour('scale_sleeves', 'arms', 'scale'),
  armour('scale_leggings', 'legs', 'scale'),
  armour('scale_boots', 'feet', 'scale'),
];

export const ARMOUR_BY_ID = new Map(ARMOUR.map((a) => [a.id, a]));
export const isArmour = (id: string): boolean => ARMOUR_BY_ID.has(id);

export type WeaponKind = 'swords' | 'axes' | 'mauls' | 'knives' | 'polearms' | 'archery' | 'shields';

export const WEAPON_SKILL_NAMES: Record<WeaponKind, string> = {
  swords: 'Swords',
  axes: 'Axes',
  mauls: 'Mauls',
  knives: 'Knives',
  polearms: 'Polearms',
  archery: 'Archery',
  shields: 'Shields',
};

export interface WeaponDef {
  id: string;
  kind: WeaponKind;
  /** Damage before skill, quality and the body behind it. */
  damage: number;
  /** Seconds between blows. */
  swing: number;
  /** Tiles it reaches; bows reach much further. */
  range?: number;
  /** Arrows a bow spends per shot. */
  ammo?: string;
  /** Both hands, so no shield with it. */
  twoHanded?: boolean;
}

const weapon = (id: string, kind: WeaponKind, damage: number, swing: number, extra: Partial<WeaponDef> = {}): WeaponDef => ({ id, kind, damage, swing, ...extra });

export const WEAPONS: WeaponDef[] = [
  weapon('hunting_knife', 'knives', 5, 1.5),
  weapon('butchering_knife', 'knives', 4.5, 1.6),
  weapon('carving_knife', 'knives', 3, 1.4),
  weapon('short_sword', 'swords', 8, 2),
  weapon('sword', 'swords', 10, 2.4),
  weapon('long_sword', 'swords', 13, 2.9, { twoHanded: true }),
  weapon('hatchet', 'axes', 7, 2.2),
  weapon('battle_axe', 'axes', 15, 3.3, { twoHanded: true }),
  weapon('club', 'mauls', 6, 2.2),
  weapon('maul', 'mauls', 14, 3.4, { twoHanded: true }),
  weapon('spear', 'polearms', 10, 2.6, { range: 2 }),
  weapon('short_bow', 'archery', 8, 2, { range: 6, ammo: 'arrow', twoHanded: true }),
  weapon('medium_bow', 'archery', 11, 2.6, { range: 9, ammo: 'arrow', twoHanded: true }),
  weapon('long_bow', 'archery', 15, 3.4, { range: 13, ammo: 'arrow', twoHanded: true }),
  // Tusk on the belly, sinew on the back, and both taken off something that
  // was trying to kill you. There is nothing further to shoot with.
  weapon('composite_bow', 'archery', 21, 3.6, { range: 17, ammo: 'arrow', twoHanded: true }),
];

export const WEAPON_BY_ID = new Map(WEAPONS.map((w) => [w.id, w]));
export const isWeapon = (id: string): boolean => WEAPON_BY_ID.has(id);
export const isBow = (id: string): boolean => !!WEAPON_BY_ID.get(id)?.ammo;

export interface ShieldDef {
  id: string;
  /** Chance it turns a blow aside entirely, before skill. */
  block: number;
  burden: number;
}

export const SHIELDS: Record<string, ShieldDef> = {
  wooden_shield: { id: 'wooden_shield', block: 0.16, burden: 0.04 },
  metal_shield: { id: 'metal_shield', block: 0.24, burden: 0.09 },
};

export const isShield = (id: string): boolean => SHIELDS[id] !== undefined;

/** Which slot a thing is worn or held in, or null if it is neither. */
export function slotOf(id: string): Slot | null {
  const a = ARMOUR_BY_ID.get(id);
  if (a) return a.slot;
  if (isWeapon(id)) return 'weapon';
  if (isShield(id)) return 'offhand';
  return null;
}

/**
 * How much of a blow a piece of armour turns aside, given its state, what it
 * is made of and the wearer. A gold breastplate is a costly way to be killed;
 * the same plate in glimmersteel turns aside half again as much.
 */
export function pieceSoak(def: ArmourDef, item: Item, skill: number): number {
  const cls = ARMOUR_CLASSES[def.cls];
  const wear = Math.max(0.25, 1 - item.dmg / 130);
  const quality = 0.55 + item.ql / 220;
  return Math.min(0.92, cls.soak * matOf(item.extra).soak * rarityOf(item).boost * quality * wear * (1 + skill / 400));
}

/** What a full set of this stuff costs to carry: heavy metal is heavy. */
export const pieceBurden = (def: ArmourDef, item: Item): number => (ARMOUR_CLASSES[def.cls].burden / 5) * matOf(item.extra).weight;

/**
 * Damage a weapon does in these hands, before the armour on the other side.
 * The metal of the head has as much say as the quality: a lead maul is a
 * heavy way of annoying something, and an adamantine one is not.
 */
export function weaponDamage(g: Game, def: WeaponDef, item: Item | null): number {
  const skill = g.skills.get(def.kind);
  const fighting = g.skills.get('fighting');
  const ql = item?.ql ?? 20;
  const wear = item ? Math.max(0.4, 1 - item.dmg / 150) : 1;
  const body = 0.7 + g.skills.get('body_strength') / 90;
  const edge = item ? matOf(item.extra).edge * rarityOf(item).boost : 1;
  // The plain path hits a sixth harder, and a fury twice as hard again.
  const might = (g.walks('power', 3) ? 1.16 : 1) * g.furyMult();
  return def.damage * edge * (0.55 + ql / 180) * wear * body * (1 + (skill + fighting) / 260) * might;
}

/**
 * Silver's old virtue: it bites the unnatural. Anything that carries its own
 * light — a Lume, an Embra — takes half again from a silver edge.
 */
export const BANE_BONUS = 1.5;
export const banes = (item: Item | null): boolean => !!item && !!matOf(item.extra).bane;

/** Chance a swing lands at all: the weapon's own skill, then fighting behind it. */
export function hitChance(g: Game, def: WeaponDef): number {
  const skill = g.skills.get(def.kind);
  const fighting = g.skills.get('fighting');
  return Math.min(0.96, 0.45 + skill / 220 + fighting / 300 + g.skills.get('body_control') / 500);
}

type ItemTarget = Extract<Target, { kind: 'item' }>;
const itemOf = (g: Game, t: Target): Item | undefined => (t.kind === 'item' ? g.inventory.get((t as ItemTarget).uid) : undefined);

export const GEAR_ACTIONS: ActionDef[] = [
  {
    id: 'equip',
    label: 'Wear or wield',
    verb: 'putting it on',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => {
      const it = itemOf(g, t);
      return !!it && slotOf(it.id) !== null && !g.isEquipped(it.uid);
    },
    check: (t, g) => {
      const it = itemOf(g, t);
      if (!it) return 'It is gone.';
      const slot = slotOf(it.id);
      if (!slot) return 'That is not worn or wielded.';
      if (slot === 'offhand' && g.twoHandedInHand()) return 'Both your hands are on your weapon.';
      return null;
    },
    perform: (t, g) => {
      const it = itemOf(g, t);
      const slot = it && slotOf(it.id);
      if (!it || !slot) return;
      g.equip(slot, it.uid);
    },
  },
  {
    id: 'unequip',
    label: 'Take it off',
    verb: 'taking it off',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => {
      const it = itemOf(g, t);
      return !!it && g.isEquipped(it.uid);
    },
    perform: (t, g) => {
      const it = itemOf(g, t);
      if (!it) return;
      const slot = slotOf(it.id);
      if (slot) g.equip(slot, null);
    },
  },
];

export const GEAR_ACTION_BY_ID = new Map(GEAR_ACTIONS.map((a) => [a.id, a]));
export { itemDef };
