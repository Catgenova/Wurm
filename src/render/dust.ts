/**
 * What gets kicked up underfoot.
 *
 * A pace on dry ground leaves a puff of whatever the ground is made of. It is
 * kept as a short list of marks rather than worked out from a walk cycle,
 * because a thing that stops walking should leave its last footfall hanging
 * in the air behind it rather than having it vanish with the step.
 *
 * Nothing here is saved: it is a second of air, and a reload starts the world
 * with clean boots.
 */
export interface Puff {
  x: number;
  y: number;
  at: number;
  /** The colour of the ground it came off. */
  colour: string;
  /** How much that ground gave up, 0..1. */
  weight: number;
}

/** Seconds a footfall hangs about. */
export const DUST_LIFE = 1.1;

/** Tiles between one pace and the next. */
const STRIDE = 0.55;

/** The most that can be in the air at once, so a crowd cannot run away with it. */
const DUST_MAX = 48;

export class Dust {
  private puffs: Puff[] = [];
  private feet = new Map<string, { x: number; y: number }>();

  /** Note where something is walking. A puff is dropped once a full pace has been covered. */
  step(id: string, x: number, y: number, now: number, colour: string, weight: number): void {
    const last = this.feet.get(id);
    if (!last) {
      this.feet.set(id, { x, y });
      return;
    }
    if (Math.hypot(last.x - x, last.y - y) < STRIDE) return;
    last.x = x;
    last.y = y;
    if (weight <= 0.02) return;
    this.puffs.push({ x, y, at: now, colour, weight });
    if (this.puffs.length > DUST_MAX) this.puffs.shift();
  }

  /**
   * A handful at once, thrown up from one spot: what a swing of a pickaxe or
   * a pass of a file puts in the air. It skips the pace filter, since the
   * whole point of it is that it all comes off the same place at once.
   */
  burst(x: number, y: number, now: number, colour: string, weight: number, n = 5): void {
    if (weight <= 0.02) return;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2 + now;
      const r = 0.12 + (i % 3) * 0.07;
      this.puffs.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * 0.6, at: now, colour, weight });
    }
    while (this.puffs.length > DUST_MAX) this.puffs.shift();
  }

  /** Everything still in the air, with what has settled dropped as we go. */
  live(now: number): Puff[] {
    while (this.puffs.length && now - this.puffs[0].at > DUST_LIFE) this.puffs.shift();
    return this.puffs;
  }

  /** How far a puff has spread and risen, and how much of it is left. */
  static spread(p: Puff, now: number): { radius: number; lift: number; alpha: number } {
    const age = Math.max(0, Math.min(1, (now - p.at) / DUST_LIFE));
    return { radius: 3.5 + age * 13, lift: age * 9, alpha: 0.72 * p.weight * (1 - age) * (1 - age) };
  }

  clear(): void {
    this.puffs.length = 0;
    this.feet.clear();
  }
}
