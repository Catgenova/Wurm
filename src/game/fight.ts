import type { ActionDef } from './actions';
import type { Game } from './game';
import { bowRange, WEAPON_BY_ID, type ArmourClass, type WeaponDef } from './gear';
import { describeWith, itemDef, type Item } from './items';
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
  if (!nockedArrow(g)) return 'You are out of arrows.';
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

/* ---- Packs, throwers and nerve -------------------------------------------- */

/**
 * A kind that runs in a pack (`SpeciesDef.pack`) takes the home of another of
 * its kind within `HERD_REACH` when it comes into the world, as a herd does,
 * up to this many to one home;
 */
export const PACK_MOST = 4;
/** and keeps within this many tiles of that home rather than `WILD_RANGE`, so a pack is met together. */
export const PACK_RANGE = 6;
/** When one of a pack takes your scent, each other of its kind within this many tiles takes it too, and the first leads them. */
export const PACK_CALL = 8;
/**
 * A pack on you spreads round you. Each makes for its own side of you, an even
 * share of the circle round from the one that leads, circling this many tiles
 * out until it is within `CIRCLE_ARC` of its side, and then comes in.
 */
export const CIRCLE_R = 2.5;
export const CIRCLE_ARC = Math.PI / 4;
/** The way round you the `k`th of a pack of `n` makes for, from the bearing of the one that leads it. */
export const slotAngle = (lead: number, k: number, n: number): number => lead + (2 * Math.PI * k) / n;
/** The turn from one bearing to another the short way round, -π to π. */
export const turnTo = (from: number, to: number): number => {
  const t = (to - from) % (2 * Math.PI);
  return t > Math.PI ? t - 2 * Math.PI : t < -Math.PI ? t + 2 * Math.PI : t;
};
/** Where a pack's one on its way round to its side makes for next: `CIRCLE_R` out, at most `CIRCLE_ARC` further round. */
export function circlePoint(px: number, py: number, own: number, slot: number): { x: number; y: number } {
  const b = own + Math.sign(turnTo(own, slot)) * Math.min(Math.abs(turnTo(own, slot)), CIRCLE_ARC);
  return { x: px + Math.cos(b) * CIRCLE_R, y: py + Math.sin(b) * CIRCLE_R };
}

/** A thrower (`SpeciesDef.throws`) stands off this many tiles from you, */
export const KEEP_OFF = 3.5;
/** throws from no further than this many, */
export const THROW_REACH = 6;
/** and each throw lands this share of what its blow would. */
export const THROW_HIT = 0.6;
/**
 * Nearer than `KEEP_OFF - BACK_SLACK` it backs away from you at `BACK_PACE`
 * of its walk, and fights hand to hand only when it has nowhere to back to.
 */
export const BACK_SLACK = 1;
export const BACK_PACE = 0.6;

/** A hunter turns tail below this share of its health, a monster below `MONSTER_TURN`, a coward below `COWARD_AT`; */
export const HUNTER_TURN = 0.3;
export const MONSTER_TURN = 0.08;
export const COWARD_AT = 0.5;
/** and a coward below this share as soon as another of its kind within `PACK_CALL` has turned tail. */
export const COWARD_DRAG = 0.8;
/** The share of its health a kind turns tail below. */
export const turnsAt = (def: Pick<SpeciesDef, 'coward' | 'monster'>): number =>
  def.coward ? COWARD_AT : def.monster ? MONSTER_TURN : HUNTER_TURN;
/**
 * One that turns tail runs for home at this times its walk for `FLEE_SECS`,
 * and takes no interest in you for `HUNT_REST`. A pack whose leader turns tail
 * or dies turns tail with it.
 */
export const FLEE_PACE = 1.6;
export const FLEE_SECS = 6;

/* ---- Your companion's orders ------------------------------------------------ */

/** A guarding companion gives up a fight that has got this many tiles from you. */
export const GUARD_RANGE = 4;
/** Fall back: it leaves its fight, comes to your side, and starts no fight for this many seconds. */
export const FALL_BACK = 8;

/* ---- A bow on the move ------------------------------------------------------ */

/** Drawing a bow you can walk, at this share of your pace, and the draw goes on and looses when it is full. */
export const DRAW_WALK = 0.6;

/* ---- Dodging ----------------------------------------------------------------- */

/**
 * Every blow a creature lands on you is first rolled against your dodge: this
 * share for every point of body control, less this share for every kilogram of
 * armour you wear, and never more than `DODGE_MOST`. A dodge teaches body
 * control `DODGE_GAIN`.
 */
export const DODGE_PER_CONTROL = 0.0025;
export const DODGE_PER_KG = 0.0025;
export const DODGE_MOST = 0.3;
export const DODGE_GAIN = 0.3;
/** Your chance of dodging a blow, for your body control and the kilograms of armour on you. */
export const dodgeChance = (control: number, kg: number): number =>
  Math.max(0, Math.min(DODGE_MOST, control * DODGE_PER_CONTROL - kg * DODGE_PER_KG));

/* ---- Critical hits ------------------------------------------------------------ */

/**
 * A blow or a shot that lands is critical one time in `CRIT_BASE`, and that
 * share more for every point of the skill of what you swing or draw; with a
 * knife twice as often. A critical one lands `CRIT_HIT` times as hard.
 */
export const CRIT_BASE = 0.02;
export const CRIT_PER_SKILL = 0.0004;
export const CRIT_KNIFE = 2;
export const CRIT_HIT = 1.75;
/** The chance a landed blow of this weapon is critical, at this skill with it. */
export const critChance = (skill: number, w: WeaponDef): number =>
  (CRIT_BASE + skill * CRIT_PER_SKILL) * (w.kind === 'knives' && w.id !== FIST.id ? CRIT_KNIFE : 1);

/* ---- Arrow heads -------------------------------------------------------------- */

/** What is on the end of an arrow, by the arrow: a plain head, a broadhead, a bodkin point or a blunt knob. */
export type ArrowHead = 'plain' | 'broadhead' | 'bodkin' | 'blunt';
export const ARROWS: Record<string, ArrowHead> = { arrow: 'plain', broadhead_arrow: 'broadhead', bodkin_arrow: 'bodkin', blunt_arrow: 'blunt' };
export const ARROW_IDS = Object.keys(ARROWS);
export const isArrow = (id: string): boolean => id in ARROWS;
/** A bodkin lands this many times as hard on anything with a hide (`HIDES`). */
export const BODKIN_HIDE = 1.25;
/** The kind of blow a shot with this head lands: a blunt crushes, the rest go in as the bow's do. */
export const headBlow = (head: ArrowHead, bow: WeaponDef): BlowKind => (head === 'blunt' ? 'crush' : blowOf(bow));
/** What a landed shot with this head does besides, as the weapon that does the same (`sideBlow`): a broadhead bleeds as a knife, a blunt staggers as a maul. */
export const headSide = (head: ArrowHead): string | null => (head === 'broadhead' ? 'knives' : head === 'blunt' ? 'mauls' : null);
/** And what a hide makes of it besides what it makes of the blow. */
export const headHide = (head: ArrowHead, hide: Hide | undefined): number => (head === 'bodkin' && hide ? BODKIN_HIDE : 1);
/** The arrows a shot takes: the kind asked for while there are any, else plain ones, else any at all. */
export function nockedArrow(g: Game, want?: string | null): Item | undefined {
  const of = (id: string): Item | undefined => g.inventory.items.filter((it) => it.id === id).sort((a, b) => b.ql - a.ql)[0];
  return (want && isArrow(want) ? of(want) : undefined) ?? of('arrow') ?? ARROW_IDS.map(of).find((it) => it !== undefined);
}
describeWith({ arrowHead: { bleed: KNIFE_BLEED, bleedSecs: KNIFE_BLEED_SECS, hide: BODKIN_HIDE - 1, stagger: STAGGER_MAUL } });

/* ---- Venom and burns ---------------------------------------------------------- */

/**
 * A venomous bite (`SpeciesDef.venom`) leaves venom in the wound it opens: it
 * takes this share of your health a second for `VENOM_SECS`, unless the wound
 * is dressed. A burn wears the armour it lands on `BURN_WEAR` times as fast.
 */
export const VENOM_DRAIN = 0.01;
export const VENOM_SECS = 8;
export const BURN_WEAR = 2;

/* ---- Threat ------------------------------------------------------------------- */

/**
 * A creature in a fight turns on whatever hurt it last, once whatever it was
 * on has not hurt it for this many seconds; a guarding companion pulls it at
 * once.
 */
export const THREAT_HOLD = 3;

/* ---- Consider ----------------------------------------------------------------- */

/**
 * Easy when it would take it at least this many times as long to down you as
 * it would take you to down it, hard when less than `CONSIDER_HARD` times, and
 * even between.
 */
export const CONSIDER_EASY = 2;
export const CONSIDER_HARD = 0.75;

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
