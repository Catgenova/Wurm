import type { Slot } from './gear';

/**
 * Wounds.
 *
 * A blow used to be a number off a bar. It now leaves something behind: a
 * wound, of a kind, in a place, which bleeds until it is dressed and goes
 * bad if it never is. A bar that is going down on its own is the island
 * telling you to sit down and see to yourself.
 *
 * Five kinds, and what closes each one is not the same. A **cover** — herbs
 * worked into cotton — is what a wound actually wants; a bandage is cloth,
 * and cloth only holds a dressing on. The herb has to suit the wound: thyme
 * on a cut, sage on a burn. The wrong herb is better than nothing and not
 * much better.
 */

export type WoundKind = 'cut' | 'pierce' | 'crush' | 'burn' | 'bite';

export interface WoundKindDef {
  id: WoundKind;
  name: string;
  /** How fast it bleeds out, as a share of a life per second. */
  bleed: number;
  /** The chance per minute that an untreated one goes bad. */
  fester: number;
  /** The herb that suits it. */
  herb: string;
  note: string;
}

export const WOUND_KINDS: Record<WoundKind, WoundKindDef> = {
  cut: { id: 'cut', name: 'cut', bleed: 0.0015, fester: 0.1, herb: 'thyme', note: 'Open and bleeding. Thyme in the dressing keeps it clean.' },
  pierce: { id: 'pierce', name: 'puncture', bleed: 0.0010, fester: 0.18, herb: 'basil', note: 'Deep and narrow. It bleeds less than it festers.' },
  crush: { id: 'crush', name: 'bruise', bleed: 0.0002, fester: 0.05, herb: 'mint', note: 'Nothing open, and everything underneath it hurts. Mint takes the swelling down.' },
  burn: { id: 'burn', name: 'burn', bleed: 0.0004, fester: 0.14, herb: 'sage', note: 'It weeps rather than bleeds. Sage and a cover, and keep it off the air.' },
  bite: { id: 'bite', name: 'bite', bleed: 0.0012, fester: 0.26, herb: 'rosemary', note: 'Whatever was in its mouth is in you now. Rosemary, and quickly.' },
};

/** Which herb goes on which wound, for the crafting window and the menus. */
export const HERBS: string[] = [...new Set(Object.values(WOUND_KINDS).map((k) => k.herb))];
export const KIND_FOR_HERB = new Map(Object.values(WOUND_KINDS).map((k) => [k.herb, k.id]));

export interface Wound {
  id: number;
  kind: WoundKind;
  /** Where it landed. */
  part: Slot;
  /** How much of a life it took, and how much is left to close. */
  severity: number;
  /** Still open and losing blood. */
  bleeding: boolean;
  /** Gone bad: it drains rather than closes, and no dressing will hold until it is cleaned. */
  infected: boolean;
  /** What is on it: the herb of the cover, or '' for plain cloth, or null for nothing. */
  dressing: string | null;
  /** Game time it was taken, for the log and for how long it has had to fester. */
  at: number;
}

export const PART_NAMES: Record<string, string> = {
  head: 'head',
  chest: 'chest',
  arms: 'arm',
  legs: 'leg',
  feet: 'foot',
  offhand: 'hand',
  weapon: 'hand',
};

/** "a deep cut to the left arm" */
export function woundText(w: Wound): string {
  const k = WOUND_KINDS[w.kind];
  const deep = w.severity > 0.16 ? 'deep ' : w.severity > 0.07 ? '' : 'light ';
  const state = w.infected ? ', gone bad' : w.bleeding ? ', bleeding' : w.dressing !== null ? ', dressed' : '';
  return `a ${deep}${k.name} to the ${PART_NAMES[w.part] ?? w.part}${state}`;
}

/** What a wound is doing to you each second: blood out, or worse. */
export function woundDrain(w: Wound): number {
  const k = WOUND_KINDS[w.kind];
  let rate = 0;
  if (w.bleeding) rate += k.bleed * (0.4 + w.severity * 3);
  // Something gone bad does not stop on its own, and dressing it will not do.
  if (w.infected) rate += k.bleed * 1.4;
  return rate;
}

/**
 * How fast a wound closes by what is on it: nothing closes slowly, cloth is
 * better, the wrong herb better again and the herb that suits it best. A
 * cover's text says what it is worth over cloth off these two.
 */
export const CLOSE_BARE = 0.25;
export const CLOSE_CLOTH = 0.7;
export const CLOSE_WRONG = 0.9;
export const CLOSE_RIGHT = 1.6;
/** How fast any wound closes at no chirurgy, and what each point of it adds. */
export const CLOSE_PACE = 0.0006;
export const CLOSE_PER_SKILL = 0.00002;
/** How much of an open wound's chance of going bad is left under cloth, and under the wrong herb. */
export const FESTER_CLOTH = 0.12;
export const FESTER_WRONG = 0.05;

/** How fast a wound closes, given what is on it. */
export function woundClose(w: Wound, chirurgy: number): number {
  if (w.infected) return 0;
  const k = WOUND_KINDS[w.kind];
  const dressed = w.dressing === null ? CLOSE_BARE : w.dressing === '' ? CLOSE_CLOTH : w.dressing === k.herb ? CLOSE_RIGHT : CLOSE_WRONG;
  return w.severity * dressed * (CLOSE_PACE + chirurgy * CLOSE_PER_SKILL);
}

/**
 * The chance this wound goes bad, per second. An open wound left alone will
 * turn inside ten or twenty minutes; cloth over it is a holding measure that
 * usually holds; the wrong herb is better again; the right herb never turns.
 */
export function festerChance(w: Wound): number {
  if (w.infected || w.dressing === WOUND_KINDS[w.kind].herb) return 0;
  const k = WOUND_KINDS[w.kind];
  const guard = w.dressing === null ? 1 : w.dressing === '' ? FESTER_CLOTH : FESTER_WRONG;
  return k.fester * guard * (0.3 + w.severity * 2) / 60;
}

/** The worst wound on you, which is the one worth seeing to. */
export function worstWound(wounds: Wound[]): Wound | null {
  let worst: Wound | null = null;
  for (const w of wounds) {
    const score = w.severity + (w.infected ? 1 : 0) + (w.bleeding ? 0.5 : 0);
    const best = worst ? worst.severity + (worst.infected ? 1 : 0) + (worst.bleeding ? 0.5 : 0) : -1;
    if (score > best) worst = w;
  }
  return worst;
}

/** What kind of wound a weapon of this sort leaves. */
export const WOUND_BY_WEAPON: Record<string, WoundKind> = {
  swords: 'cut',
  axes: 'cut',
  knives: 'cut',
  polearms: 'pierce',
  archery: 'pierce',
  mauls: 'crush',
};
