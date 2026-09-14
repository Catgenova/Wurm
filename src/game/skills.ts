export interface SkillDef {
  id: string;
  name: string;
  group: 'Characteristics' | 'Skills' | 'Fighting';
  start: number;
}

export const SKILL_DEFS: SkillDef[] = [
  { id: 'body_strength', name: 'Body strength', group: 'Characteristics', start: 20 },
  { id: 'body_stamina', name: 'Body stamina', group: 'Characteristics', start: 20 },
  { id: 'body_control', name: 'Body control', group: 'Characteristics', start: 20 },
  { id: 'mind_logic', name: 'Mind logic', group: 'Characteristics', start: 20 },
  { id: 'soul_strength', name: 'Soul strength', group: 'Characteristics', start: 20 },
  { id: 'digging', name: 'Digging', group: 'Skills', start: 1 },
  { id: 'mining', name: 'Mining', group: 'Skills', start: 1 },
  { id: 'prospecting', name: 'Prospecting', group: 'Skills', start: 1 },
  { id: 'woodcutting', name: 'Woodcutting', group: 'Skills', start: 1 },
  { id: 'forestry', name: 'Forestry', group: 'Skills', start: 1 },
  { id: 'foraging', name: 'Foraging', group: 'Skills', start: 1 },
  { id: 'botanizing', name: 'Botanizing', group: 'Skills', start: 1 },
  { id: 'fishing', name: 'Fishing', group: 'Skills', start: 1 },
  { id: 'paving', name: 'Paving', group: 'Skills', start: 1 },
  { id: 'masonry', name: 'Masonry', group: 'Skills', start: 1 },
  { id: 'stonecutting', name: 'Stonecutting', group: 'Skills', start: 1 },
  { id: 'carpentry', name: 'Carpentry', group: 'Skills', start: 1 },
  { id: 'fine_carpentry', name: 'Fine carpentry', group: 'Skills', start: 1 },
  { id: 'pottery', name: 'Pottery', group: 'Skills', start: 1 },
  { id: 'tailoring', name: 'Tailoring', group: 'Skills', start: 1 },
  { id: 'cooking', name: 'Cooking', group: 'Skills', start: 1 },
  { id: 'milling', name: 'Milling', group: 'Skills', start: 1 },
  { id: 'smelting', name: 'Smelting', group: 'Skills', start: 1 },
  { id: 'blacksmithing', name: 'Blacksmithing', group: 'Skills', start: 1 },
  { id: 'weaponsmithing', name: 'Weaponsmithing', group: 'Skills', start: 1 },
  { id: 'armorsmithing', name: 'Armoursmithing', group: 'Skills', start: 1 },
  { id: 'farming', name: 'Farming', group: 'Skills', start: 1 },
  { id: 'taming', name: 'Taming', group: 'Skills', start: 1 },
  { id: 'butchering', name: 'Butchering', group: 'Skills', start: 1 },
  { id: 'alchemy', name: 'Alchemy', group: 'Skills', start: 1 },
  { id: 'repair', name: 'Repair', group: 'Skills', start: 1 },
  { id: 'first_aid', name: 'First aid', group: 'Skills', start: 1 },
  { id: 'papyrusmaking', name: 'Papyrusmaking', group: 'Skills', start: 1 },
  { id: 'archaeology', name: 'Archaeology', group: 'Skills', start: 1 },
  { id: 'restoration', name: 'Restoration', group: 'Skills', start: 1 },
  { id: 'leatherworking', name: 'Leatherworking', group: 'Skills', start: 1 },
  { id: 'chainsmithing', name: 'Chain armoursmithing', group: 'Skills', start: 1 },
  { id: 'platesmithing', name: 'Plate armoursmithing', group: 'Skills', start: 1 },
  { id: 'bowyery', name: 'Bowyery', group: 'Skills', start: 1 },
  { id: 'fletching', name: 'Fletching', group: 'Skills', start: 1 },
  { id: 'fighting', name: 'Fighting', group: 'Fighting', start: 1 },
  { id: 'swords', name: 'Swords', group: 'Fighting', start: 1 },
  { id: 'axes', name: 'Axes', group: 'Fighting', start: 1 },
  { id: 'mauls', name: 'Mauls', group: 'Fighting', start: 1 },
  { id: 'knives', name: 'Knives', group: 'Fighting', start: 1 },
  { id: 'polearms', name: 'Polearms', group: 'Fighting', start: 1 },
  { id: 'archery', name: 'Archery', group: 'Fighting', start: 1 },
  { id: 'shields', name: 'Shields', group: 'Fighting', start: 1 },
  { id: 'cloth_armour', name: 'Cloth armour', group: 'Fighting', start: 1 },
  { id: 'leather_armour', name: 'Leather armour', group: 'Fighting', start: 1 },
  { id: 'chain_armour', name: 'Chain armour', group: 'Fighting', start: 1 },
  { id: 'plate_armour', name: 'Plate armour', group: 'Fighting', start: 1 },
  { id: 'climbing', name: 'Climbing', group: 'Skills', start: 1 },
  { id: 'swimming', name: 'Swimming', group: 'Skills', start: 1 },
];

/**
 * How steeply gains fall away as a skill fills up.
 *
 * The share of a gain that survives is the room left, raised to this. The
 * first point of a skill comes in two or three swings of a pick; the ninetieth
 * takes a hundred and fifty; the hundredth takes ten thousand, which is the
 * point — nobody finishes a skill by accident, and the last stretch of one is
 * a standing target rather than a thing you tick off.
 */
export const SKILL_CURVE = 1.8;

/** What is left of a gain at a given level, 1 at nothing and 0 at mastery. */
export const skillRoom = (v: number): number => Math.pow(Math.max(0, 1 - v / 100), SKILL_CURVE);

/**
 * The least an honest go at something is worth. Without it the curve never
 * quite arrives: gains would shrink towards nothing and a hundred would be a
 * number nobody could reach. With it, the last point of a skill is ten
 * thousand goes away and no further, which is punishing rather than pointless.
 */
export const MIN_GAIN = 0.0001;

/** One gain: the curve, floored, and then luck of a fifth either way. */
export const skillGain = (v: number, base: number, roll: number): number => Math.max(MIN_GAIN, base * skillRoom(v)) * roll;

export class Skills {
  values = new Map<string, number>();

  constructor(saved?: Record<string, number>) {
    for (const def of SKILL_DEFS) this.values.set(def.id, saved?.[def.id] ?? def.start);
  }

  get(id: string): number {
    return this.values.get(id) ?? 1;
  }

  /**
   * Raise a skill. What a gain is worth shrinks with the level it is being
   * added to, sharply: the early levels come in a handful of goes and the last
   * one hardly comes at all, as in Wurm.
   */
  gain(id: string, base: number, rand: () => number = Math.random): number {
    const v = this.get(id);
    const gain = skillGain(v, base, 0.6 + 0.8 * rand());
    const next = Math.min(100, v + gain);
    this.values.set(id, next);
    return next - v;
  }

  toJSON(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.values) out[k] = v;
    return out;
  }
}
