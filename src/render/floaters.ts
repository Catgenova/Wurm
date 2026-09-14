/**
 * Numbers and words over the world.
 *
 * Everything that happens in this game has always been reported in the event
 * log, at the top left, in a sentence. That is the right place for a record of
 * it and the wrong place for the thing itself: you are watching a wildermon,
 * not the log, and there is no way to tell from the corner of your eye whether
 * a swing did four damage or forty.
 *
 * So the number goes where the thing is. They rise, fade, and merge: a run of
 * hits on the same beast adds up into one number rather than stacking eight of
 * them on top of each other, and a skill that ticks up twenty times in an
 * action shows one total rather than twenty fractions.
 */
export type FloatKind = 'dealt' | 'taken' | 'skill' | 'note';

export interface Floater {
  x: number;
  y: number;
  kind: FloatKind;
  /** What it says. Rebuilt when more is added to the same one. */
  text: string;
  /** The running total, for the kinds that add up. */
  value: number;
  at: number;
  /** What it is counting, so more of the same finds it. */
  key: string;
}

/** Seconds from appearing to gone. */
export const FLOAT_LIFE = 1.7;

/** How long a floater keeps taking more of the same before a new one starts. */
export const MERGE_WINDOW = 0.9;

/** The most that can be up at once. */
const FLOAT_MAX = 16;

/** How high one climbs, in screen pixels at 1x zoom. */
export const FLOAT_RISE = 34;

export class Floaters {
  private list: Floater[] = [];

  /**
   * Put something up, or add it to the one already up for the same thing.
   * `key` is what makes two of a thing the same thing: a wildermon's id for
   * damage, a skill's name for skill.
   */
  add(x: number, y: number, kind: FloatKind, key: string, value: number, now: number, write: (total: number) => string): void {
    const found = this.list.find((f) => f.key === key && now - f.at < MERGE_WINDOW);
    if (found) {
      found.value += value;
      found.text = write(found.value);
      found.at = now;
      found.x = x;
      found.y = y;
      return;
    }
    this.list.push({ x, y, kind, key, value, at: now, text: write(value) });
    if (this.list.length > FLOAT_MAX) this.list.shift();
  }

  /** Everything still up, oldest first, with what has faded dropped as we go. */
  live(now: number): Floater[] {
    while (this.list.length && now - this.list[0].at > FLOAT_LIFE) this.list.shift();
    return this.list;
  }

  /** How far one has climbed and how much of it is left. */
  static rise(f: Floater, now: number): { lift: number; alpha: number; scale: number } {
    const age = Math.max(0, Math.min(1, (now - f.at) / FLOAT_LIFE));
    // Quick off the mark and slowing, which is how a thing thrown upwards goes.
    const lift = FLOAT_RISE * (1 - (1 - age) * (1 - age));
    // A beat at full strength, then out.
    const alpha = age < 0.55 ? 1 : 1 - (age - 0.55) / 0.45;
    // A new one arrives slightly large, which is what makes it catch the eye.
    const scale = age < 0.12 ? 1.35 - (age / 0.12) * 0.35 : 1;
    return { lift, alpha, scale };
  }

  clear(): void {
    this.list.length = 0;
  }
}

/** The colours the four kinds are written in. */
export const FLOAT_COLOURS: Record<FloatKind, string> = {
  dealt: '255, 228, 130',
  taken: '255, 110, 96',
  skill: '150, 226, 255',
  note: '236, 236, 232',
};
