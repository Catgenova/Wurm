export interface SkillDef {
  id: string;
  name: string;
  group: 'Characteristics' | 'Skills';
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
  { id: 'woodcutting', name: 'Woodcutting', group: 'Skills', start: 1 },
  { id: 'forestry', name: 'Forestry', group: 'Skills', start: 1 },
  { id: 'foraging', name: 'Foraging', group: 'Skills', start: 1 },
  { id: 'botanizing', name: 'Botanizing', group: 'Skills', start: 1 },
  { id: 'paving', name: 'Paving', group: 'Skills', start: 1 },
  { id: 'masonry', name: 'Masonry', group: 'Skills', start: 1 },
  { id: 'carpentry', name: 'Carpentry', group: 'Skills', start: 1 },
  { id: 'climbing', name: 'Climbing', group: 'Skills', start: 1 },
  { id: 'swimming', name: 'Swimming', group: 'Skills', start: 1 },
];

export class Skills {
  values = new Map<string, number>();

  constructor(saved?: Record<string, number>) {
    for (const def of SKILL_DEFS) this.values.set(def.id, saved?.[def.id] ?? def.start);
  }

  get(id: string): number {
    return this.values.get(id) ?? 1;
  }

  /**
   * Raise a skill. Gains shrink as the skill approaches 100, so the early
   * levels come quickly and the late ones slowly, as in Wurm.
   */
  gain(id: string, base: number, rand: () => number = Math.random): number {
    const v = this.get(id);
    const room = Math.max(0, 1 - v / 100);
    const gain = base * Math.pow(room, 1.4) * (0.6 + 0.8 * rand());
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
