import type { ActionDef } from './actions';
import type { Game } from './game';
import { bowRange, WEAPON_BY_ID, type WeaponDef } from './gear';
import { itemDef, type Item } from './items';
import type { SpeciesDef } from './creatures';
import { percent } from './words';

/**
 * The fight itself: how long a swing takes and what it costs, which way you
 * stand in one, and how long a creature you have struck stays on you.
 *
 * Every number here is on the island under the same name (`npm run defs`), so
 * the two sides swing at the same pace and get hit on the same clock.
 */

/** Bare hands: what you fight with when there is nothing in them. The island's `swung_with` says the same. */
export const FIST: WeaponDef = { id: 'fist', kind: 'knives', damage: 3, swing: 1.8 };

/** What is in your hand to swing: the weapon, or your fists when it is a bow or nothing. */
export function swungWith(g: Game): { def: WeaponDef; item: Item | null } {
  const held = g.worn('weapon');
  const def = held && WEAPON_BY_ID.get(held.id);
  return def && !def.ammo ? { def, item: held } : { def: FIST, item: null };
}

/** Below this much stamina your arms tire, and every swing takes longer for it, */
export const TIRED_AT = 0.3;
/** up to this much longer with none left at all. */
export const TIRED_SLOW = 0.6;
/** How much longer a swing takes on this much stamina. */
export const tiredPace = (stamina: number): number =>
  stamina >= TIRED_AT ? 1 : 1 + (TIRED_SLOW * (TIRED_AT - Math.max(0, stamina))) / TIRED_AT;

/** What a swing or a draw costs in stamina: this much for the arm, */
export const SWING_WIND = 0.03;
/** and this much more for every kilogram in the hand. */
export const SWING_WIND_KG = 0.02;
export const swingWind = (kg: number): number => SWING_WIND + SWING_WIND_KG * kg;

/** The weight of what you swing or draw, in kilograms: nothing for a fist. */
function heftOf(g: Game, def: Pick<ActionDef, 'id'>): number {
  const held = g.worn('weapon');
  if (!held) return 0;
  const w = WEAPON_BY_ID.get(held.id);
  if (!w || (def.id === 'attack_creature') === !!w.ammo) return 0;
  return itemDef(held.id)?.weight ?? 0;
}

/**
 * The seconds a go of a fight takes before skill and tools: the weapon's own
 * swing, or the bow's draw, and longer for tired arms. Null for every job that
 * is not a fight, which keeps its own base time.
 */
export function fightBase(g: Game, def: Pick<ActionDef, 'id' | 'baseTime'>): number | null {
  if (def.id === 'attack_creature') return swungWith(g).def.swing * tiredPace(g.player.stats.stamina);
  if (def.id === 'shoot_creature') {
    const held = g.worn('weapon');
    const bow = held && WEAPON_BY_ID.get(held.id);
    return (bow?.ammo ? bow.swing : def.baseTime) * tiredPace(g.player.stats.stamina);
  }
  return null;
}

/** What a go of a fight costs in stamina, before the body's own share; null for every other job. */
export function fightWind(g: Game, def: Pick<ActionDef, 'id'>): number | null {
  if (def.id !== 'attack_creature' && def.id !== 'shoot_creature') return null;
  return swingWind(heftOf(g, def));
}

/**
 * Which way you stand in a fight.
 *
 * Aggressive hits harder and is hit harder; defensive the other way about.
 * The numbers are the whole of it, and the island reads the same ones off the
 * stance it keeps on your body (`fight_stance`).
 */
export type FightStance = 'aggressive' | 'balanced' | 'defensive';
export const FIGHT_STANCES: FightStance[] = ['aggressive', 'balanced', 'defensive'];
export const FIGHT_STANCE_NAMES: Record<FightStance, string> = { aggressive: 'Aggressive', balanced: 'Balanced', defensive: 'Defensive' };
/** What a stance makes of the damage you deal, */
export const STANCE_DEALT: Record<FightStance, number> = { aggressive: 1.2, balanced: 1, defensive: 0.8 };
/** and of the damage you take. */
export const STANCE_TAKEN: Record<FightStance, number> = { aggressive: 1.2, balanced: 1, defensive: 0.8 };
export const isFightStance = (s: unknown): s is FightStance => FIGHT_STANCES.includes(s as FightStance);

/** A stance in the game's own terms, derived from the numbers rather than written out beside them. */
export function stanceSays(s: FightStance): string {
  const dealt = STANCE_DEALT[s] - 1;
  const taken = STANCE_TAKEN[s] - 1;
  if (dealt === 0 && taken === 0) return 'Damage dealt and taken as they are.';
  const word = (d: number): string => `${percent(Math.abs(d))} ${d > 0 ? 'more' : 'less'}`;
  return `${word(dealt)} damage dealt, ${word(taken)} damage taken.`;
}

/** The next stance round from this one, for the key that cycles them. */
export const nextStance = (s: FightStance): FightStance => FIGHT_STANCES[(FIGHT_STANCES.indexOf(s) + 1) % FIGHT_STANCES.length];

/**
 * A creature you strike that does not hunt stands and fights: it comes at you
 * from no further than this from where it was struck,
 */
export const FIGHT_LEASH = 8;
/** and lets you go once you are this far from it. */
export const FIGHT_GIVE_UP = 6;

/**
 * Seconds between a creature's blows in a fight, on its own clock rather than
 * yours: a hunter's or a monster's, one that stands up for itself, and
 * anything else, which would mostly rather be elsewhere.
 */
export const BLOW_HUNTER = 1.4;
export const BLOW_DEFENSIVE = 2.5;
export const BLOW_PREY = 3.5;
export const blowEvery = (def: Pick<SpeciesDef, 'hunter' | 'monster' | 'defensive'>): number =>
  def.hunter || def.monster ? BLOW_HUNTER : def.defensive ? BLOW_DEFENSIVE : BLOW_PREY;

/** How far you can reach with what is in your hand: a pace and a bit, or a spear's length. */
export const meleeReach = (g: Game): number => {
  const held = g.worn('weapon');
  const w = held && WEAPON_BY_ID.get(held.id);
  return w && !w.ammo ? Math.max(2.2, (w.range ?? 1) + 1.2) : 2.2;
};

/** Nearer than this, a bow cannot be drawn on it. */
export const DRAW_CLOSEST = 1.2;

/**
 * Whether a fight with it can be had from where you stand: inside a swing's
 * reach, or inside a bow's range and not on top of you.
 */
export function inFightReach(g: Game, job: string, c: { x: number; y: number }): boolean {
  const d = Math.hypot(c.x - g.player.x, c.y - g.player.y);
  if (job === 'attack_creature') return d <= meleeReach(g);
  const held = g.worn('weapon');
  const bow = held && WEAPON_BY_ID.get(held.id);
  return !!held && !!bow?.ammo && d <= bowRange(bow, held) && d >= DRAW_CLOSEST;
}

/** What stops a fight wherever it stands: a shot with no bow in hand, or no arrows for it. */
export function armsRefusal(g: Game, job: string): string | null {
  if (job !== 'shoot_creature') return null;
  const held = g.worn('weapon');
  const bow = held && WEAPON_BY_ID.get(held.id);
  if (!held || !bow?.ammo) return 'You have no bow in your hands.';
  if (!g.inventory.has(bow.ammo)) return 'You are out of arrows.';
  return null;
}

/** The two jobs that are a fight rather than work: neither waits behind work, and walking off leaves both. */
export const FIGHT_JOBS: ReadonlySet<string> = new Set(['attack_creature', 'shoot_creature']);
export const isFightJob = (id: string | null | undefined): boolean => !!id && FIGHT_JOBS.has(id);

/** How far you go after a creature you are fighting when it steps out of your reach. */
export const FOLLOW_RANGE = 8;
/** Asks in a row that come to nothing before a fight that keeps after its target gives it up. */
export const FIGHT_TRIES = 4;
/** How far round you look for something to fight when you ask for the nearest. */
export const TARGET_RANGE = 12;
/**
 * Seconds since your feet last moved before a bite turns you on what bit you.
 * Walking is how you leave a fight, so nothing turns you round while you do it.
 */
export const FIGHT_BACK_STILL = 1.5;
