import type { ActionDef } from './actions';
import type { Game } from './game';
import { bowRange, WEAPON_BY_ID, type ArmourClass, type WeaponDef } from './gear';
import { itemDef, type Item } from './items';
import type { SpeciesDef } from './creatures';
import { listed, percent } from './words';
import { WOUND_BY_WEAPON, type Wound, type WoundKind } from './wounds';

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
  // Tired arms, and wounded ones (`armPace`).
  const pace = tiredPace(g.player.stats.stamina) * armPace(g.player.wounds);
  if (def.id === 'attack_creature') return swungWith(g).def.swing * pace;
  if (def.id === 'shoot_creature') {
    const held = g.worn('weapon');
    const bow = held && WEAPON_BY_ID.get(held.id);
    return (bow?.ammo ? bow.swing : def.baseTime) * pace;
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

/* ---- What a blow is, and what it meets ------------------------------------ */

/** What a blow does: an edge cuts, a point goes in, a weight crushes. */
export type BlowKind = 'cut' | 'pierce' | 'crush';
export const BLOW_KINDS: BlowKind[] = ['cut', 'pierce', 'crush'];
/** What a weapon's blow is, by its kind; bare hands crush. */
export const blowOf = (w: WeaponDef): BlowKind =>
  w.id === FIST.id ? 'crush' : ((WOUND_BY_WEAPON[w.kind] as BlowKind | undefined) ?? 'crush');

/**
 * What a creature's hide makes of each kind of blow, as a share of what lands:
 * under one it turns some of it, over one it gives. A hide not named here takes
 * every blow as it comes.
 */
export type Hide = 'thick' | 'shell' | 'scaled';
export const HIDES: Hide[] = ['thick', 'shell', 'scaled'];
export const HIDE_NAMES: Record<Hide, string> = { thick: 'Thick hide', shell: 'Shell', scaled: 'Scales' };
export const HIDE_TAKES: Record<Hide, Record<BlowKind, number>> = {
  thick: { cut: 0.8, pierce: 1, crush: 1.2 },
  shell: { cut: 0.6, pierce: 0.8, crush: 1.4 },
  scaled: { cut: 0.75, pierce: 1.25, crush: 0.9 },
};
export const hideTakes = (hide: Hide | undefined, blow: BlowKind): number => (hide ? HIDE_TAKES[hide][blow] : 1);

/**
 * What each class of armour makes of each kind of blow it is struck with, as a
 * multiple of what it turns aside: chain turns an edge and lets a weight
 * through, plate the other way about, scale shrugs off fire.
 */
export const ARMOUR_VS: Record<ArmourClass, Record<WoundKind, number>> = {
  cloth: { cut: 0.8, pierce: 1, crush: 1.2, bite: 1, burn: 1 },
  leather: { cut: 1, pierce: 0.85, crush: 1.1, bite: 1, burn: 1 },
  chain: { cut: 1.25, pierce: 0.75, crush: 0.7, bite: 1.1, burn: 1 },
  plate: { cut: 1.15, pierce: 1.1, crush: 0.85, bite: 1.1, burn: 1 },
  scale: { cut: 1.15, pierce: 0.9, crush: 1, bite: 1, burn: 1.25 },
};

/* ---- Heavy blows ------------------------------------------------------- */

/** Every this many blows, a kind that hits heavy draws back for one: */
export const HEAVY_EVERY = 3;
/** it stands this many seconds winding up, which is the time you have to step out of its reach, */
export const WIND_UP = 1;
/** and lands this many times as hard on whatever is still in reach. */
export const HEAVY_HIT = 2.5;
/** How near a creature's blow reaches, in tiles, its heavy one included. */
export const HUNT_REACH = 1.1;

/* ---- Wounds in a fight --------------------------------------------------- */

/** Each point of severity open on an arm or a hand makes every swing this much slower, */
export const ARM_SLOW = 2;
/** up to this much slower; */
export const ARM_SLOW_MOST = 0.5;
/** and each point open on a leg or a foot slows your walking by this much, */
export const LEG_SLOW = 2;
/** up to this much slower. */
export const LEG_SLOW_MOST = 0.5;
const ARM_PARTS = new Set(['arms', 'weapon', 'offhand']);
const LEG_PARTS = new Set(['legs', 'feet']);
const open = (wounds: Wound[], parts: Set<string>): number =>
  wounds.reduce((n, w) => n + (parts.has(w.part) ? w.severity : 0), 0);
/** How much longer a swing takes for the wounds on your arms and hands. */
export const armPace = (wounds: Wound[]): number => 1 + Math.min(ARM_SLOW_MOST, ARM_SLOW * open(wounds, ARM_PARTS));
/** What is left of your walking pace for the wounds on your legs and feet. */
export const legPace = (wounds: Wound[]): number => 1 - Math.min(LEG_SLOW_MOST, LEG_SLOW * open(wounds, LEG_PARTS));

/* ---- Who is on whom ---------------------------------------------------- */

/** A blow from something on you that is not what you are fighting lands this much harder: it is at your back. */
export const FLANK_HIT = 1.25;
/** Each other thing on you takes this share off your shield's chance of a block. */
export const CROWD_BLOCK = 0.25;
/** A blow at something whose mind is on another fight lands this much harder. */
export const BLINDSIDE = 1.25;

/* ---- What a weapon does besides the damage ------------------------------- */

/** A maul blow that lands knocks a heavy blow off its stroke and puts the next blow back this many seconds; */
export const STAGGER_MAUL = 1;
/** a spear's or a pike's puts it back this many, keeping it at the end of the shaft. */
export const STAGGER_POLE = 0.6;
/**
 * A knife that lands opens it up: it bleeds this share of the blow every
 * second, for this many seconds. Bleeding never takes the last of it.
 */
export const KNIFE_BLEED = 0.15;
export const KNIFE_BLEED_SECS = 6;
/** What a landed blow of this weapon does besides its damage, in the game's words. */
export function sideOf(w: WeaponDef): string | null {
  if (w.kind === 'mauls') return `knocks a heavy blow off its stroke and puts the next blow back ${STAGGER_MAUL} second${STAGGER_MAUL === 1 ? '' : 's'}`;
  if (w.kind === 'polearms') return `puts the next blow back ${STAGGER_POLE} seconds`;
  if (w.kind === 'knives') return `bleeds it ${percent(KNIFE_BLEED)} of the blow a second for ${KNIFE_BLEED_SECS} seconds`;
  return null;
}

/* ---- A fight, remembered ------------------------------------------------- */

/** Seconds without a blow given or taken that end a fight, and say how it went. */
export const FIGHT_QUIET = 5;
/** What a fight was, for the line that says how it went (`fightSummary`). */
export interface FightRecord {
  /** The creature it was with, when there was one in hand. */
  foe: number | null;
  foeName: string;
  /** Its health when the fight began, and your own. */
  foeAt: number;
  youAt: number;
  started: number;
  /** When the last blow was given or taken. */
  last: number;
  /** What each skill came up by while it lasted. */
  skills: Map<string, number>;
}
/** "Fighting increased by 0.1150 to 1.1150." read back into its skill and its gain, or null. */
export function skillLine(text: string): { skill: string; gain: number } | null {
  const m = /^(.+) increased by ([0-9.]+) to [0-9.]+\.$/.exec(text);
  return m ? { skill: m[1], gain: Number(m[2]) } : null;
}

/* ---- The same, in the game's words --------------------------------------- */

const BLOW_WORDS: Record<WoundKind, string> = { cut: 'cuts', pierce: 'punctures', crush: 'crushes', bite: 'bites', burn: 'burns' };
/** A kind of blow, as more than one of them: "cuts", "punctures", "crushes". */
export const blowWords = (k: WoundKind): string => BLOW_WORDS[k];
const changeOf = (f: number): string => `${percent(Math.abs(f - 1))} ${f > 1 ? 'more' : 'less'}`;
/** What a hide makes of each kind of blow: "takes 40% less from cuts and 40% more from crushes". */
export const hideSays = (h: Hide): string =>
  `takes ${listed(BLOW_KINDS.filter((b) => HIDE_TAKES[h][b] !== 1).map((b) => `${changeOf(HIDE_TAKES[h][b])} from ${BLOW_WORDS[b]}`))}`;
/** What a class of armour makes of each kind of blow it is struck with: "turns 25% more of cuts and 30% less of crushes". */
export const armourSays = (cls: ArmourClass): string => {
  const t = ARMOUR_VS[cls];
  return `turns ${listed((Object.keys(t) as WoundKind[]).filter((k) => t[k] !== 1).map((k) => `${changeOf(t[k])} of ${BLOW_WORDS[k]}`))}`;
};
/** Which weapons strike which kind of blow, by their kinds: "swords, axes and knives cut". */
export const blowSays = (b: BlowKind): string => {
  const kinds = Object.entries(WOUND_BY_WEAPON).filter(([, v]) => v === b).map(([k]) => k);
  return listed(b === 'crush' ? [...kinds, 'bare hands'] : kinds);
};
