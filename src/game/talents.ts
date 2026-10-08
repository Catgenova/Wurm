// The reach of a spell on a creature is `SPELL_REACH`, which `patrons.ts` takes from `TARGET_RANGE`; read here from where it is
// set, since `patrons.ts` reads this file.
import { spellDef, spellForce, spellSecs } from './arcane';
import { COMPANION_REACH, DRAW_CLOSEST, HUNT_REACH, KNIFE_BLEED, KNIFE_BLEED_SECS, STAGGER_MAUL, TARGET_RANGE as SPELL_REACH, THROW_REACH } from './fight';
import type { SpellOn } from './patrons';
import { capital, numberWord, percent, share, times } from './words';

/**
 * What a fighting trade gives: two spells and a passive at each of six tiers.
 *
 * Asked for: "Let's build out the 10 combat classes class by class. Once
 * selected, the class begins to gain experience in combat. There will be a
 * pick from 2 spells and a passive at each tier. New tiers unlock at class
 * levels 1 20 40 60 80 99." Fifty spells and thirty passives were offered for
 * each trade, twelve and six were picked, and they sit in the tiers in order
 * of what they are worth.
 *
 * ## A trade has a level of its own
 *
 * `class_level` on the island, from `CLASS_LEVEL_START` when the trade is
 * taken up and back to nothing when it is put down. It rises on the same
 * curve every skill does (`skillGain`), `CLASS_LEARN_BLOW` for every blow or
 * shot that lands on a creature while you hold the trade and
 * `CLASS_LEARN_KILL` more for one that kills it, so the last tier is as far
 * off as the top of a skill is.
 *
 * ## The pick is a perk
 *
 * All eighteen are perks in the trade's six tiers (`perks.ts`), one taken at
 * each tier, through the same door and the same refusals as a craft trade's.
 * A passive does what it does through its `fx`, folded with the rest. A spell
 * has no `fx` of its own as a perk: taking it puts it among the spells you
 * know, and its numbers are here, in `CLASS_SPELLS`, which the island casts
 * from. Like a faith spell, a class spell is called from the bar -- three of
 * its six slots are for your trade's -- and only on the island.
 *
 * A class spell costs stamina rather than favour: `cost` is the share of a
 * full bar it takes, and it is refused when you have less.
 */

/** The class level a fighting trade starts at, the moment it is taken up. Its first tier opens at it. */
export const CLASS_LEVEL_START = 1;
/** What a blow or a shot that lands on a creature teaches the trade you fight in, as the base of a gain. */
export const CLASS_LEARN_BLOW = 1;
/** And what one that kills it teaches besides. */
export const CLASS_LEARN_KILL = 5;

/** How far a Sworn Blade's Guardian reaches from where you stand, in tiles. */
export const GUARDIAN_REACH = 2;

/**
 * What a spell wants in your hands before it can be called: a shield in the off hand, or a weapon of a kind in the other --
 * and for a Skirmisher's Hit and Run, a thrown weapon or a knife; for a Beastmaster's, a companion at heel rather than
 * anything in the hand; and for a Kindler's, a Binder's or a Warder's, a focus of the school's stones to cast it out of.
 */
export type SpellNeeds = 'shield' | 'axes' | 'mauls' | 'archery' | 'throwing' | 'skirmish' | 'knives' | 'companion' | 'kindling'
  | 'binding' | 'warding';
/** As the spell's note says it first, and as its refusal says it is missing. */
export const NEEDS_SAID: Record<SpellNeeds, { has: string; wants: string }> = {
  shield: { has: 'With a shield in your off hand', wants: 'a shield in your off hand' },
  axes: { has: 'With an axe in hand', wants: 'an axe in your hand' },
  mauls: { has: 'With a maul in hand', wants: 'a maul in your hand' },
  // A shot also wants an arrow to loose, which its refusal says when there is none.
  archery: { has: 'With a bow in hand', wants: 'a bow in your hands' },
  throwing: { has: 'With a javelin or a throwing axe in hand', wants: 'a javelin or a throwing axe in your hand' },
  skirmish: { has: 'With a javelin, a throwing axe or a knife in hand', wants: 'a javelin, a throwing axe or a knife in your hand' },
  knives: { has: 'With a knife in hand', wants: 'a knife in your hand' },
  // A creature you keep that is following you: not in a crate, not working a deed, not in the traces or under a rider.
  companion: { has: 'With a companion following you', wants: 'a companion following you' },
  // Any focus of a stone kindling works that is not worn through (`focus_for`), and casting a trade's spell does not wear it.
  kindling: { has: 'With a garnet or ruby focus in your pack', wants: 'a garnet or ruby focus in your pack' },
  binding: { has: 'With a sapphire or diamond focus in your pack', wants: 'a sapphire or diamond focus in your pack' },
  warding: { has: 'With a topaz or emerald focus in your pack', wants: 'a topaz or emerald focus in your pack' },
};

export interface ClassSpellDef {
  /** The id of the perk it is taken under, `<class>_<name>`, which is what the island keeps. */
  id: string;
  class: string;
  /** The number it was offered under, which is the number it was picked by. */
  num: number;
  name: string;
  /** Share of a full stamina bar it costs. */
  cost: number;
  /** Seconds before it can be called again. */
  rest: number;
  /** Every kind of thing it can be cast on, the one it goes at by default first. */
  on: readonly SpellOn[];
  /** The numbers behind what it does, which the island reads off its row and the note is written from. */
  fx: Readonly<Record<string, number>>;
  /** What it does, in the game's numbers, beginning with what it wants in your hands when it wants something. */
  note: string;
  /** What it wants in your hands; nothing when it can be called with anything or nothing. */
  needs?: SpellNeeds;
}

/** A stretch of time as a spell note says it. */
const span = (secs: number): string => (secs < 120 ? `${secs} s` : `${secs / 60} minutes`);
/** "130%" from 1.3: what share of a blow a spell lands. */
const ofBlow = (m: number): string => `${Math.round(m * 100)}%`;

const slug = (name: string): string => name.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const spellOf = (cls: string) => (
  num: number, name: string, cost: number, rest: number, on: readonly SpellOn[],
  fx: Record<string, number>, note: (fx: Record<string, number>) => string, needs?: SpellNeeds,
): ClassSpellDef => ({
  id: `${cls}_${slug(name)}`, class: cls, num, name, cost, rest, on, fx, needs,
  note: needs ? `${NEEDS_SAID[needs].has}: ${note(fx)}` : capital(note(fx)),
});

const blade = spellOf('blade');
const berserker = spellOf('berserker');
const pikeman = spellOf('pikeman');
const archer = spellOf('archer');
const skirmisher = spellOf('skirmisher');
const chirurgeon = spellOf('chirurgeon');
const beastmaster = spellOf('beastmaster');
const kindler = spellOf('kindler');
const binder = spellOf('binder');
const warder = spellOf('warder');

/** "fire at 80%": what share of a Kindler's fire a spell lands. */
const fire = (m: number): string => `fire at ${ofBlow(m)}`;
/** "shatter at 80%": what share of a Binder's shatter a spell lands. */
const shatter = (m: number): string => `shatter at ${ofBlow(m)}`;
/** The least and the most a skill and a focus's quality can be, which the notes give a spell's numbers at. */
export const FIRE_LOW = 1;
export const FIRE_TOP = 100;
/**
 * What a school's damage at 100% does: an Ember's, out of the best focus of the school's stones you carry, at the school's
 * skill (`spellForce`), from the bottom of both to the top.
 */
const EMBER = spellDef('ember')!;
const emberIs = (at100: string, skill: string): string =>
  `${capital(at100)} does ${Math.round(spellForce(EMBER, FIRE_LOW, FIRE_LOW, 1))} damage at ${FIRE_LOW} ${skill} with a QL `
  + `${FIRE_LOW} focus, up to ${Math.round(spellForce(EMBER, FIRE_TOP, FIRE_TOP, 1))} at ${FIRE_TOP} ${skill} with a QL ${FIRE_TOP} `
  + 'focus, rising evenly with each.';
const FIRE_IS = emberIs(fire(1), 'kindling');
const SHATTER_IS = emberIs(shatter(1), 'binding');
/**
 * What a hold at 100% is: a Snare's, out of your focus at your binding (`spellSecs`), from the bottom of binding to the top.
 * Held is neither moving nor striking; rooted, not moving but striking anything within its reach.
 */
const SNARE = spellDef('snare')!;
const held = (m: number): string => `held at ${ofBlow(m)}, neither moving nor striking`;
const HOLD_IS = `A hold at ${ofBlow(1)} lasts ${Number(spellSecs(SNARE, FIRE_LOW, 1).toFixed(1))} s at ${FIRE_LOW} binding, up to `
  + `${Number(spellSecs(SNARE, FIRE_TOP, 1).toFixed(1))} s at ${FIRE_TOP} binding, rising evenly with it.`;
const ROOTED = 'it cannot move, but strikes and throws at anything within its reach';
/**
 * "a skin of 40%": that share of an Aegis out of your focus at your warding (`spellForce`), which is a skin of a
 * hundredth of full health for every point of its force (`skinOf`, `warder_skin_at`), from the bottom of both to the top.
 */
const AEGIS = spellDef('aegis')!;
export const skinOf = (force: number): number => force / 100;
const skin = (m: number): string => `skin of ${ofBlow(m)}`;
const SKIN_IS = `A ${skin(1)} is ${percent(skinOf(spellForce(AEGIS, FIRE_LOW, FIRE_LOW, 1)))} of full health at ${FIRE_LOW} warding `
  + `with a QL ${FIRE_LOW} focus, up to ${percent(skinOf(spellForce(AEGIS, FIRE_TOP, FIRE_TOP, 1)))} at ${FIRE_TOP} warding with a QL `
  + `${FIRE_TOP} focus, rising evenly with each. Every blow takes what it can out of a skin before the shield and the armour, and a `
  + 'new skin goes over an old one only where it is the larger.';
/** "burns 1% of its full health a second for 8 s": a burn, which is a bleed that a Kindler started (`class_burn`). */
const burns = (each: number, secs: number): string => `burns ${percent(each)} of its full health a second for ${span(secs)}`;
const BURN_LAST = 'a burn never takes the last of its health';

/**
 * Every class spell there is, trade by trade, by the number each was picked
 * under. Which tier each sits in is the trade's row in `perks.ts`'s `TIERS`.
 *
 * "A blow" is a blow with what is in your hand, as a swing of it lands: its
 * damage, your stance, the creature's hide and a critical one now and then,
 * all as they are, and then the share the spell names. "A shot" is the same
 * of a draw of the bow in your hand: an arrow loosed, the one a draw would
 * nock, at an enemy within the bow's range and no nearer than a draw can be
 * made, landing less often at the far end of the range as a draw does. "A
 * throw" is a blow with the javelin or the throwing axe in your hand, which
 * fights from where you stand at an enemy within its reach. A Beastmaster's
 * spells are your companion's: "its own blow" is the blow it strikes when it
 * fights -- its attack, half again at the top of its fighting, a third either
 * way as each one lands, and whatever is making its blows larger at the time
 * -- and "its reach" is how near it has to be to strike (`COMPANION_REACH`).
 * A Kindler's are cast out of a focus: "fire" is an Ember out of the best
 * garnet or ruby focus you carry, at your kindling, larger in a White Heat,
 * and "a burn" is a bleed of a share of a creature's full health a second,
 * which the stronger of two wins and which never takes the last of it. A
 * Binder's too, out of a sapphire or diamond: "held at N%" is that share of a
 * Snare's hold out of it at your binding, longer in a Long Hold, and
 * "shatter" is an Ember's force out of it at your binding. Every reach and
 * width of a Binder's is a Long Hold's further. A Warder's, out of a topaz or
 * emerald: "a skin of N%" is that share of an Aegis out of it at your warding,
 * in hundredths of the health of whoever it is over, which takes what it can
 * out of every blow before the shield and the armour do.
 */
export const CLASS_SPELLS: ClassSpellDef[] = [
  /* ---- The Sworn Blade ---- */
  blade(1, 'Measured Cut', 0.08, 6, ['enemy'], { more: 1.3 },
    (fx) => `A blow at ${ofBlow(fx.more)} that cannot miss, on an enemy within your reach.`),
  blade(32, 'Challenge', 0.08, 15, ['enemy'], { secs: 10 },
    (fx) => `The creature turns on you at once and hunts only you for ${span(fx.secs)}.`),
  blade(2, 'Lunge', 0.1, 10, ['enemy'], { reach: 4, more: 1.5 },
    (fx) => `You stride to an enemy up to ${fx.reach} tiles off, over ground you could walk, and strike it at ${ofBlow(fx.more)}.`),
  blade(11, 'Hamstring', 0.1, 20, ['enemy'], { more: 0.8, pace: 0.5, secs: 10 },
    (fx) => `A blow at ${ofBlow(fx.more)}; for ${span(fx.secs)} it walks, hunts and flees at ${percent(fx.pace)} of its pace.`),
  blade(15, 'Shield Bash', 0.1, 12, ['enemy'], { more: 0.7, back: 2 },
    (fx) => `a crushing blow at ${ofBlow(fx.more)} that knocks a heavy blow off its stroke and puts its next blow back ${span(fx.back)}.`, 'shield'),
  blade(29, 'Second Breath', 0, 180, ['self'], { stamina: 0.4 },
    (fx) => `Costs no stamina. ${percent(fx.stamina)} of a full bar of stamina back at once.`),
  blade(19, 'Deflect', 0.1, 25, ['self'], { share: 0.5, secs: 6 },
    (fx) => `For ${span(fx.secs)}, every blow you block lands back on what struck at ${percent(fx.share)} of the blow.`),
  blade(26, 'Hold the Line', 0.15, 90, ['self'], { bleed: 0.5, secs: 15 },
    (fx) => `For ${span(fx.secs)} your wounds bleed ${percent(1 - fx.bleed)} less, and those on your arms do not slow your swing.`),
  blade(12, 'Disarming Cut', 0.12, 30, ['enemy'], { more: 0.7, cut: 0.4, blows: 3, secs: 30 },
    (fx) => `A blow at ${ofBlow(fx.more)}; its next ${fx.blows} blows within ${span(fx.secs)} do ${percent(fx.cut)} less damage.`),
  blade(31, 'Measured Breathing', 0.1, 60, ['self'], { secs: 20 },
    (fx) => `For ${span(fx.secs)} a swing or a draw costs no stamina.`),
  blade(33, 'Guardian’s Call', 0.18, 45, ['self'], { reach: 5, secs: 8 },
    (fx) => `Every creature within ${fx.reach} tiles of you that is hunting somebody turns on you and hunts only you for ${span(fx.secs)}.`),
  blade(28, 'Last Stand', 0, 600, ['self'], { below: 0.25, cut: 0.6, secs: 10 },
    (fx) => `Costs no stamina. Only below ${percent(fx.below)} of your health: for ${span(fx.secs)} you take ${percent(fx.cut)} less damage.`),

  /* ---- The Berserker ---- */
  berserker(18, 'Wild Swing', 0.05, 5, ['enemy'], { more: 1.4, miss: 2 },
    (fx) => `A blow at ${ofBlow(fx.more)} that misses ${times(fx.miss)} as often as a swing does.`),
  berserker(30, 'Shrug It Off', 0.1, 60, ['self'], { severity: 0.5 },
    (fx) => `Your worst wound is ${percent(1 - fx.severity)} less severe, and it stops bleeding.`),
  berserker(2, 'Rending Chop', 0.1, 12, ['enemy'], { more: 1.1 },
    (fx) => `a blow at ${ofBlow(fx.more)} that bleeds it as a knife does, ${percent(KNIFE_BLEED)} of the blow a second for ${span(KNIFE_BLEED_SECS)}.`, 'axes'),
  berserker(3, 'Skull Crack', 0.12, 15, ['enemy'], { more: 1.2, hold: 2, monster: 0.5 },
    (fx) => `a blow at ${ofBlow(fx.more)} that holds it where it stands, neither moving nor striking, for ${span(fx.hold)}; a monster for ${span(fx.hold * fx.monster)}.`, 'mauls'),
  berserker(21, 'Battle Rage', 0.15, 90, ['self'], { dealt: 1.3, taken: 1.2, secs: 15 },
    (fx) => `For ${span(fx.secs)} you deal ${percent(fx.dealt - 1)} more damage and take ${percent(fx.taken - 1)} more.`),
  berserker(29, 'Adrenaline', 0, 120, ['self'], { time: 0.85, secs: 10 },
    (fx) => `Costs no stamina. For ${span(fx.secs)} a swing or a draw costs no stamina and takes ${percent(1 - fx.time)} less time.`),
  berserker(20, 'Blood Price', 0, 30, ['enemy'], { health: 0.1, more: 2.5 },
    (fx) => `Costs no stamina but ${percent(fx.health)} of your health: a blow at ${ofBlow(fx.more)}.`),
  berserker(6, 'Execute', 0.15, 30, ['enemy'], { low: 0.25, more: 3, whole: 1 },
    (fx) => `A blow at ${ofBlow(fx.more)} on a creature below ${percent(fx.low)} of its health, and at ${ofBlow(fx.whole)} on one above it.`),
  berserker(8, 'Overhead Smash', 0.15, 20, ['enemy'], { more: 2.5, wind: 1.5 },
    (fx) => `A crushing blow at ${ofBlow(fx.more)} that cannot miss; your own next swing comes ${span(fx.wind)} later.`),
  berserker(14, 'Whirlwind', 0.25, 45, ['self'], { more: 0.9, blows: 2, reach: 2 },
    (fx) => `${numberWord(fx.blows)} blows at ${ofBlow(fx.more)} on every enemy within ${fx.reach} tiles of you.`),
  berserker(45, 'Earthshaker', 0.25, 60, ['self'], { more: 1, reach: 3, hold: 1 },
    (fx) => `a blow at ${ofBlow(fx.more)} on every enemy within ${fx.reach} tiles of you, and each one held where it stands for ${span(fx.hold)}.`, 'mauls'),
  berserker(50, 'Last Rage', 0, 600, ['self'], { below: 0.25, secs: 10 },
    (fx) => `Costs no stamina. Only below ${percent(fx.below)} of your health: for ${span(fx.secs)} every blow you land is critical.`),

  /* ---- The Pikeman ---- */
  pikeman(38, 'Warning Thrust', 0.06, 10, ['enemy'], { secs: 30 },
    (fx) => `A creature within your reach that is not fighting you will not come for you for ${span(fx.secs)}, alone or with its pack, `
      + 'unless you strike it first.'),
  pikeman(13, 'Overreach', 0.08, 8, ['enemy'], { more: 1.1, past: 2, wind: 1 },
    (fx) => `A blow at ${ofBlow(fx.more)} on an enemy up to ${fx.past} tiles past your reach; your own next swing comes ${span(fx.wind)} later.`),
  pikeman(6, 'Sweep the Legs', 0.1, 15, ['enemy'], { more: 0.8, pace: 0.5, secs: 8 },
    (fx) => `A blow at ${ofBlow(fx.more)}; for ${span(fx.secs)} it walks, hunts and flees at ${percent(fx.pace)} of its pace.`),
  pikeman(5, 'Vital Thrust', 0.12, 20, ['enemy'], { more: 1.2, crit: 2 },
    (fx) => `A blow at ${ofBlow(fx.more)} that is critical ${times(fx.crit)} as often as a swing is.`),
  pikeman(33, 'Hook', 0.1, 15, ['enemy'], { reach: 4, pull: 2, least: 1 },
    (fx) => `An enemy up to ${fx.reach} tiles off is dragged ${fx.pull} tiles towards you, no nearer than ${fx.least} tile${fx.least === 1 ? '' : 's'}, `
      + 'over ground it could walk, and turns on you as if struck.'),
  pikeman(32, 'Rally the Line', 0.15, 90, ['self'], { reach: 5, stamina: 0.2 },
    (fx) => `You and everybody within ${fx.reach} tiles of you get ${percent(fx.stamina)} of a full bar of stamina back.`),
  pikeman(14, 'Twin Thrust', 0.14, 20, ['enemy'], { more: 0.7, blows: 2 },
    (fx) => `${numberWord(fx.blows)} blows at ${ofBlow(fx.more)} each, one after the other.`),
  pikeman(19, 'Reach Advantage', 0.08, 15, ['enemy'], { more: 1.5, whole: 1 },
    (fx) => `A blow at ${ofBlow(fx.more)} on a creature not yet within its own reach of you (${HUNT_REACH} tiles, or ${THROW_REACH} for one `
      + `that throws), and at ${ofBlow(fx.whole)} on one that is.`),
  pikeman(2, 'Skewer', 0.12, 15, ['enemy'], { more: 1.5, behind: 2, width: 0.5, through: 0.6 },
    (fx) => `A blow at ${ofBlow(fx.more)}, and one at ${ofBlow(fx.through)} on every enemy up to ${fx.behind} tiles behind it and within `
      + `${fx.width} tiles of the line of the thrust.`),
  pikeman(17, 'Keep Away', 0.1, 20, ['self'], { secs: 10, push: 1 },
    (fx) => `For ${span(fx.secs)} every blow you land pushes what it lands on ${fx.push} tile${fx.push === 1 ? '' : 's'} further from you, `
      + 'over ground it could walk.'),
  pikeman(35, 'Fend Off', 0.1, 20, ['self'], { secs: 8, push: 2 },
    (fx) => `For ${span(fx.secs)} anything that comes within ${HUNT_REACH} tiles of you to strike is pushed ${fx.push} tiles back instead, `
      + 'over ground it could walk.'),
  pikeman(3, 'Brace for the Charge', 0.1, 20, ['self'], { secs: 6, more: 2, back: 2 },
    (fx) => `For ${span(fx.secs)} the first creature that comes at you from outside your reach is stopped at the edge of it by a blow at `
      + `${ofBlow(fx.more)}, and its next blow is put back ${span(fx.back)}.`),

  /* ---- The Archer ---- */
  archer(2, 'Quick Shot', 0.06, 6, ['enemy'], { more: 0.8, sooner: 1 },
    (fx) => `a shot at ${ofBlow(fx.more)}; your own next draw comes ${span(fx.sooner)} sooner.`, 'archery'),
  archer(1, 'Aimed Shot', 0.08, 8, ['enemy'], { more: 1.4 },
    (fx) => `a shot at ${ofBlow(fx.more)} that cannot miss.`, 'archery'),
  archer(29, 'Read the Wind', 0.06, 30, ['self'], { secs: 30, crit: 2 },
    (fx) => `Your next shot within ${span(fx.secs)}, a draw's or a spell's, cannot miss and is critical ${times(fx.crit)} as often.`),
  archer(9, 'Long Shot', 0.1, 15, ['enemy'], { more: 1.1, range: 1.5 },
    (fx) => `a shot at ${ofBlow(fx.more)} on an enemy up to ${times(fx.range)} your bow's range off, landing as often as one at the near end does.`,
    'archery'),
  archer(6, 'Crippling Shot', 0.1, 15, ['enemy'], { more: 0.8, pace: 0.5, secs: 8 },
    (fx) => `a shot at ${ofBlow(fx.more)}; for ${span(fx.secs)} it walks, hunts and flees at ${percent(fx.pace)} of its pace.`, 'archery'),
  archer(10, 'Point Blank', 0.08, 10, ['enemy'], { more: 1.6, reach: 2 },
    (fx) => `a shot at ${ofBlow(fx.more)} on an enemy within ${fx.reach} tiles of you, nearer than a draw can be made (${DRAW_CLOSEST} tiles) as well.`,
    'archery'),
  archer(3, 'Twin Arrows', 0.14, 20, ['enemy'], { more: 0.75, arrows: 2 },
    (fx) => `${numberWord(fx.arrows)} arrows loosed at once, each a shot at ${ofBlow(fx.more)}.`, 'archery'),
  archer(7, 'Pinning Shot', 0.14, 25, ['enemy'], { more: 0.9, hold: 2, monster: 0.5 },
    (fx) => `a shot at ${ofBlow(fx.more)} that holds it where it stands, neither moving nor striking, for ${span(fx.hold)}; a monster for `
      + `${span(fx.hold * fx.monster)}.`, 'archery'),
  archer(14, 'Expose', 0.15, 60, ['enemy'], { more: 1.15, secs: 15 },
    (fx) => `An enemy within ${SPELL_REACH} tiles: for ${span(fx.secs)} every blow and shot a person lands on it does ${percent(fx.more - 1)} more damage.`),
  archer(25, 'Decoy', 0.12, 45, ['self'], { secs: 6 },
    (fx) => `For ${span(fx.secs)} every creature that strikes at you strikes a decoy at your feet instead, and nothing lands on you.`),
  archer(48, 'Snipe', 0.2, 60, ['enemy'], { more: 3 },
    (fx) => `a shot at ${ofBlow(fx.more)} on a creature that is not after anybody.`, 'archery'),
  archer(49, 'Deadeye', 0.3, 300, ['self'], { time: 0.6, secs: 10 },
    (fx) => `For ${span(fx.secs)} a draw takes ${percent(1 - fx.time)} less time.`),

  /* ---- The Skirmisher ---- */
  skirmisher(2, 'Snap Throw', 0.05, 5, ['enemy'], { more: 0.8, sooner: 1 },
    (fx) => `a throw at ${ofBlow(fx.more)}; your own next swing comes ${span(fx.sooner)} sooner.`, 'throwing'),
  skirmisher(3, 'Long Throw', 0.1, 15, ['enemy'], { more: 1.1, past: 2 },
    (fx) => `a throw at ${ofBlow(fx.more)} on an enemy up to ${fx.past} tiles past your reach.`, 'throwing'),
  skirmisher(31, 'Hit and Run', 0.12, 30, ['enemy'], { more: 1, pace: 1.4, secs: 5 },
    (fx) => `a throw or a knife blow at ${ofBlow(fx.more)}, and for ${span(fx.secs)} you walk ${percent(fx.pace - 1)} faster.`, 'skirmish'),
  skirmisher(7, 'Heavy Throw', 0.12, 20, ['enemy'], { more: 1.4 },
    (fx) => `a throw at ${ofBlow(fx.more)} that staggers it as a maul does: a heavy blow knocked off its stroke, and its next blow `
      + `put back ${span(STAGGER_MAUL)}.`, 'throwing'),
  skirmisher(8, 'Gut Throw', 0.12, 20, ['enemy'], { more: 0.9 },
    (fx) => `a throw at ${ofBlow(fx.more)} that bleeds it as a knife does, ${percent(KNIFE_BLEED)} of the throw a second for `
      + `${span(KNIFE_BLEED_SECS)}.`, 'throwing'),
  skirmisher(12, 'Parting Throw', 0.1, 20, ['enemy'], { more: 1, leap: 3 },
    (fx) => `a throw at ${ofBlow(fx.more)}, and you leap ${fx.leap} tiles straight back from it, over ground you could walk.`, 'throwing'),
  skirmisher(4, 'Double Throw', 0.14, 20, ['enemy'], { more: 0.7, throws: 2 },
    (fx) => `${numberWord(fx.throws)} throws at ${ofBlow(fx.more)} each, one after the other.`, 'throwing'),
  skirmisher(9, 'Ricochet', 0.15, 25, ['enemy'], { more: 1, reach: 3, glance: 0.6 },
    (fx) => `a throw at ${ofBlow(fx.more)} that, when it lands, glances on to the nearest other enemy within ${fx.reach} tiles of it `
      + `at ${ofBlow(fx.glance)}.`, 'throwing'),
  skirmisher(44, 'Opportunist', 0.1, 30, ['self'], { more: 1.3, secs: 10 },
    (fx) => `For ${span(fx.secs)} every blow, throw and shot of yours on a creature fighting somebody else does `
      + `${percent(fx.more - 1)} more damage.`),
  skirmisher(36, 'Fade', 0.1, 45, ['self'], { secs: 10 },
    (fx) => `Every creature hunting you loses you, and will not come for you again for ${span(fx.secs)} unless you strike it.`),
  skirmisher(10, 'Fan of Blades', 0.22, 45, ['enemy'], { more: 0.6, reach: 3 },
    (fx) => `a throw at ${ofBlow(fx.more)} at the enemy you aim at and at every other enemy within ${fx.reach} tiles of it.`, 'throwing'),
  skirmisher(49, 'Marked for Death', 0.15, 60, ['enemy'], { crit: 2, secs: 15 },
    (fx) => `An enemy within ${SPELL_REACH} tiles: for ${span(fx.secs)} every blow, throw and shot a person lands on it is critical `
      + `${times(fx.crit)} as often.`),

  /* ---- The Chirurgeon ---- */
  chirurgeon(1, 'Field Dressing', 0.06, 8, ['self', 'player'], { heal: 0.1, reach: 2 },
    (fx) => `You or somebody within ${fx.reach} tiles of you gets ${percent(fx.heal)} of their health back, and their worst bleeding `
      + 'wound stops bleeding.'),
  chirurgeon(2, 'Quick Stitch', 0.08, 10, ['self', 'player'], { close: 0.3, reach: 2 },
    (fx) => `The worst wound on you or on somebody within ${fx.reach} tiles of you closes by ${percent(fx.close)} of its severity.`),
  chirurgeon(49, 'Leech', 0.12, 20, ['enemy'], { more: 0.8 },
    (fx) => `a knife blow at ${ofBlow(fx.more)}, and you get back as large a share of your health as it takes of the creature's.`, 'knives'),
  chirurgeon(4, 'Regenerate', 0.15, 45, ['self', 'player'], { each: 0.02, secs: 15, reach: 4 },
    (fx) => `You or somebody within ${fx.reach} tiles of you gets ${percent(fx.each)} of their health back a second for ${span(fx.secs)}.`),
  chirurgeon(43, 'Toxin', 0.12, 30, ['enemy'], { each: 0.01, secs: 20, reach: 4 },
    (fx) => `An enemy within ${fx.reach} tiles of you bleeds ${percent(fx.each)} of its full health a second for ${span(fx.secs)}; `
      + 'a bleed never takes the last of it.'),
  chirurgeon(17, 'Surgeon’s Hands', 0.12, 60, ['self'], { more: 2, secs: 20 },
    (fx) => `For ${span(fx.secs)} every dressing you put on puts back ${times(fx.more)} as much health.`),
  chirurgeon(6, 'Healing Circle', 0.25, 60, ['self'], { heal: 0.15, reach: 4 },
    (fx) => `You and everybody within ${fx.reach} tiles of you each get back ${percent(fx.heal)} of their own full health.`),
  chirurgeon(19, 'Mass Dressing', 0.25, 60, ['self'], { close: 0.2, reach: 3 },
    (fx) => `On you and everybody within ${fx.reach} tiles of you, the worst wound stops bleeding and closes by ${percent(fx.close)} of `
      + 'its severity.'),
  chirurgeon(46, 'Plague', 0.2, 60, ['self'], { each: 0.01, secs: 10, reach: 4 },
    (fx) => `Every enemy within ${fx.reach} tiles of you bleeds ${percent(fx.each)} of its full health a second for ${span(fx.secs)}; `
      + 'a bleed never takes the last of it.'),
  chirurgeon(15, 'Battlefield Surgery', 0.3, 120, ['self', 'player'], { close: 0.5, heal: 0.2, reach: 2 },
    (fx) => `Every wound on you or on somebody within ${fx.reach} tiles of you closes by ${percent(fx.close)} of its severity, and they `
      + `get ${percent(fx.heal)} of their health back.`),
  chirurgeon(50, 'Restoration', 0.3, 300, ['self'], { heal: 0.3 },
    (fx) => `Every wound on you closes, and you get ${percent(fx.heal)} of your health back.`),
  chirurgeon(20, 'Miracle Worker', 0.4, 600, ['self', 'player'], { heal: 0.5, reach: 4 },
    (fx) => `Every wound on you or on somebody within ${fx.reach} tiles of you closes, with whatever bleeding and venom was in it, and `
      + `they get ${percent(fx.heal)} of their health back.`),

  /* ---- The Beastmaster ---- */
  beastmaster(1, 'Sic', 0.05, 6, ['enemy'], { more: 1.3 },
    (fx) => `your companion strikes an enemy within its reach (${COMPANION_REACH} tiles of it) at once, a blow at ${ofBlow(fx.more)} of its `
      + 'own.', 'companion'),
  beastmaster(15, 'Lick Wounds', 0.06, 15, ['self'], { heal: 0.15 },
    (fx) => `your companion gets ${percent(fx.heal)} of its health back.`, 'companion'),
  beastmaster(2, 'Pounce', 0.08, 12, ['enemy'], { reach: 5, more: 1, back: 0.5 },
    (fx) => `your companion leaps onto an enemy up to ${fx.reach} tiles from it, over ground it could run, and strikes it at `
      + `${ofBlow(fx.more)} of its own blow; the enemy's next blow is put back ${span(fx.back)}.`, 'companion'),
  beastmaster(28, 'Snarl', 0.08, 15, ['self'], { reach: 4 },
    (fx) => `every wild creature within ${fx.reach} tiles of your companion turns on it.`, 'companion'),
  beastmaster(27, 'Guard Me', 0.1, 30, ['self'], { reach: 6 },
    (fx) => `your companion leaps to your side, and every creature within ${fx.reach} tiles of you that is hunting you turns on it.`,
    'companion'),
  beastmaster(8, 'Drag Down', 0.15, 40, ['enemy'], { more: 0.5, hold: 4 },
    (fx) => `your companion strikes an enemy within its reach at ${ofBlow(fx.more)} of its own blow, and holds it where it stands, `
      + `neither moving nor striking, for ${span(fx.hold)}.`, 'companion'),
  beastmaster(13, 'Disembowel', 0.18, 60, ['enemy'], { more: 1, each: 0.3, secs: 8 },
    (fx) => `your companion strikes an enemy within its reach at ${ofBlow(fx.more)} of its own blow, and the enemy bleeds `
      + `${percent(fx.each)} of the blow a second for ${span(fx.secs)}; a bleed never takes the last of it.`, 'companion'),
  beastmaster(18, 'Bloodlust', 0.15, 60, ['self'], { more: 1.4, secs: 15 },
    (fx) => `for ${span(fx.secs)} your companion's blows are ${percent(fx.more - 1)} larger.`, 'companion'),
  beastmaster(32, 'Vengeance', 0.15, 90, ['self'], { more: 0.6, reach: 5, secs: 20 },
    (fx) => `for ${span(fx.secs)}, every creature that lands a blow on you is struck back by your companion at ${ofBlow(fx.more)} of `
      + `its own blow, when it is within ${fx.reach} tiles of it.`, 'companion'),
  beastmaster(50, 'Feral Bond', 0.25, 600, ['self'], { share: 0.5, secs: 30 },
    (fx) => `for ${span(fx.secs)} every blow that lands on you or on your companion is split between you, ${percent(fx.share)} `
      + 'to each.', 'companion'),
  beastmaster(48, 'Primal Fury', 0.3, 300, ['self'], { more: 1.75, quick: 1.5, secs: 20 },
    (fx) => `for ${span(fx.secs)} your companion's blows are ${percent(fx.more - 1)} larger and come ${percent(fx.quick - 1)} more often.`,
    'companion'),
  beastmaster(41, 'Call of the Wild', 0.4, 900, ['enemy'], { reach: 4 },
    (fx) => `A wild creature within ${fx.reach} tiles of you whose tame level is no more than your taming is tamed outright, as a tame `
      + 'that takes: it follows you, or goes into an empty creature crate in your pack if something follows you already. Never a '
      + 'monster.'),

  /* ---- The Kindler ---- */
  kindler(3, 'Scorch', 0.08, 12, ['enemy'], { reach: 8, fire: 0.8, each: 0.01, secs: 8 },
    (fx) => `${fire(fx.fire)} on an enemy within ${fx.reach} tiles of you, and it ${burns(fx.each, fx.secs)}; ${BURN_LAST}. ${FIRE_IS}`,
    'kindling'),
  kindler(6, 'Heat Seeker', 0.1, 15, ['self'], { reach: 10, fire: 1 },
    (fx) => `${fire(fx.fire)} on the enemy within ${fx.reach} tiles of you with the smallest share of its full health left, the `
      + `nearest of two alike. ${FIRE_IS}`, 'kindling'),
  kindler(11, 'Scald', 0.1, 20, ['enemy'], { reach: 8, fire: 0.7, pace: 0.6, secs: 6 },
    (fx) => `${fire(fx.fire)} on an enemy within ${fx.reach} tiles of you; for ${span(fx.secs)} it walks, hunts and flees at `
      + `${percent(fx.pace)} of its pace. ${FIRE_IS}`, 'kindling'),
  kindler(5, 'Flash Fire', 0.1, 20, ['enemy'], { reach: 2, fire: 2 },
    (fx) => `${fire(fx.fire)} on an enemy within ${fx.reach} tiles of you. ${FIRE_IS}`, 'kindling'),
  kindler(44, 'Stoke', 0.05, 30, ['self'], { more: 1.5, secs: 60 },
    (fx) => `the next spell of yours within ${span(fx.secs)} that deals fire deals ${percent(fx.more - 1)} more of it, on every `
      + 'creature it lands on.', 'kindling'),
  kindler(46, 'Firebrand', 0.2, 120, ['self'], { long: 2, secs: 30 },
    (fx) => `for ${span(fx.secs)} every burn you start lasts ${times(fx.long)} as long.`, 'kindling'),
  kindler(4, 'Immolate', 0.15, 30, ['enemy'], { reach: 8, each: 0.02, secs: 15 },
    (fx) => `an enemy within ${fx.reach} tiles of you ${burns(fx.each, fx.secs)}; ${BURN_LAST}.`, 'kindling'),
  kindler(10, 'Combust', 0.2, 45, ['enemy'], { reach: 8, more: 1.5 },
    (fx) => `a burning enemy within ${fx.reach} tiles of you takes at once ${percent(fx.more)} of what its burn still had to do (its `
      + 'burn a second times the seconds it had left), and stops burning and bleeding.', 'kindling'),
  kindler(24, 'Blaze Aura', 0.2, 90, ['self'], { reach: 2, fire: 0.3, secs: 15 },
    (fx) => `for ${span(fx.secs)}, ${fire(fx.fire)} a second on every enemy within ${fx.reach} tiles of you, as large as your fire is `
      + `when you cast it. ${FIRE_IS}`, 'kindling'),
  kindler(13, 'Inferno Bolt', 0.3, 120, ['enemy'], { reach: 10, fire: 3, each: 0.03, secs: 10 },
    (fx) => `${fire(fx.fire)} on an enemy within ${fx.reach} tiles of you, and it ${burns(fx.each, fx.secs)}; ${BURN_LAST}. ${FIRE_IS}`,
    'kindling'),
  kindler(14, 'Meteor', 0.35, 180, ['enemy'], { reach: 12, fire: 4, splash: 1.5, wide: 3 },
    (fx) => `${fire(fx.fire)} on an enemy within ${fx.reach} tiles of you, and ${fire(fx.splash)} on every other enemy within `
      + `${fx.wide} tiles of it. ${FIRE_IS}`, 'kindling'),
  kindler(26, 'Firestorm', 0.4, 300, ['self'], { reach: 6, fire: 1, each: 0.02, secs: 10 },
    (fx) => `${fire(fx.fire)} on every enemy within ${fx.reach} tiles of you, and each ${burns(fx.each, fx.secs)}; ${BURN_LAST}. `
      + FIRE_IS, 'kindling'),

  /* ---- The Binder ---- */
  binder(1, 'Bind', 0.05, 8, ['enemy'], { reach: 8, hold: 0.4, monster: 0.5 },
    (fx) => `an enemy within ${fx.reach} tiles of you is ${held(fx.hold)}; a monster for ${share(fx.monster)} as long. ${HOLD_IS}`,
    'binding'),
  binder(29, 'Shatter', 0.1, 15, ['enemy'], { reach: 8, shatter: 1, held: 2 },
    (fx) => `${shatter(fx.shatter)} on an enemy within ${fx.reach} tiles of you, or ${shatter(fx.held)} on one that is held. ${SHATTER_IS}`,
    'binding'),
  binder(6, 'Root', 0.06, 10, ['enemy'], { reach: 8, secs: 8 },
    (fx) => `an enemy within ${fx.reach} tiles of you is rooted for ${span(fx.secs)}: ${ROOTED}.`, 'binding'),
  binder(36, 'Stillness', 0.08, 30, ['self'], {},
    () => 'every wound on you stops bleeding.', 'binding'),
  binder(20, 'Heavy Limbs', 0.1, 20, ['enemy'], { reach: 8, often: 0.7, secs: 10 },
    (fx) => `for ${span(fx.secs)} an enemy within ${fx.reach} tiles of you strikes ${percent(1 - fx.often)} less often.`, 'binding'),
  binder(21, 'Dull Claws', 0.1, 20, ['enemy'], { reach: 8, dealt: 0.7, secs: 10 },
    (fx) => `for ${span(fx.secs)} every blow an enemy within ${fx.reach} tiles of you lands, on you or on anything else, is `
      + `${percent(1 - fx.dealt)} smaller.`, 'binding'),
  binder(8, 'Tether', 0.08, 20, ['enemy'], { reach: 8, leash: 3, secs: 15 },
    (fx) => `for ${span(fx.secs)} an enemy within ${fx.reach} tiles of you cannot go more than ${fx.leash} tiles from where it stood.`,
    'binding'),
  binder(27, 'Brittle', 0.12, 30, ['enemy'], { reach: 8, taken: 1.25, secs: 10 },
    (fx) => `for ${span(fx.secs)} an enemy within ${fx.reach} tiles of you takes ${percent(fx.taken - 1)} more from everything that `
      + 'strikes it: blows, shots, throws, fire and shatter.', 'binding'),
  binder(2, 'Lock', 0.1, 20, ['enemy'], { reach: 8, hold: 1, monster: 0.5 },
    (fx) => `an enemy within ${fx.reach} tiles of you is ${held(fx.hold)}; a monster for ${share(fx.monster)} as long. ${HOLD_IS}`,
    'binding'),
  binder(35, 'Still Skin', 0.12, 45, ['self'], { cut: 0.2, secs: 10 },
    (fx) => `for ${span(fx.secs)} you take ${percent(fx.cut)} less from every blow.`, 'binding'),
  binder(16, 'Mire', 0.15, 30, ['self'], { reach: 4, pace: 0.6, secs: 10 },
    (fx) => `every enemy within ${fx.reach} tiles of you walks, hunts and flees at ${percent(fx.pace)} of its pace for ${span(fx.secs)}.`,
    'binding'),
  binder(15, 'Mass Root', 0.18, 40, ['self'], { reach: 4, secs: 6 },
    (fx) => `every enemy within ${fx.reach} tiles of you is rooted for ${span(fx.secs)}: ${ROOTED}.`, 'binding'),

  /* ---- The Warder ---- */
  warder(1, 'Ward', 0.05, 10, ['self'], { skin: 0.4 },
    (fx) => `a ${skin(fx.skin)} over you. ${SKIN_IS}`, 'warding'),
  warder(11, 'Ward Other', 0.06, 10, ['player'], { skin: 0.4, reach: 6 },
    (fx) => `a ${skin(fx.skin)} over somebody within ${fx.reach} tiles of you. ${SKIN_IS}`, 'warding'),
  warder(2, 'Greater Ward', 0.1, 20, ['self'], { skin: 1 },
    (fx) => `a ${skin(fx.skin)} over you. ${SKIN_IS}`, 'warding'),
  warder(47, 'Thicken', 0.06, 30, ['self'], { more: 1.5, secs: 60 },
    (fx) => `the next skin you lay within ${span(fx.secs)}, over anybody, is ${percent(fx.more - 1)} larger.`, 'warding'),
  warder(12, 'Greater Ward Other', 0.12, 20, ['player'], { skin: 1, reach: 6 },
    (fx) => `a ${skin(fx.skin)} over somebody within ${fx.reach} tiles of you. ${SKIN_IS}`, 'warding'),
  warder(20, 'Ward Link', 0.15, 60, ['self'], { secs: 30, reach: 8, skin: 0.3 },
    (fx) => `for ${span(fx.secs)}, when a skin of yours over somebody within ${fx.reach} tiles of you is used up, a ${skin(fx.skin)} `
      + `goes back over them, once each. ${SKIN_IS}`, 'warding'),
  warder(7, 'Stoneskin', 0.12, 45, ['self'], { cut: 0.25, secs: 10 },
    (fx) => `for ${span(fx.secs)} you take ${percent(fx.cut)} less from every blow.`, 'warding'),
  warder(32, 'Ward Burst', 0.15, 30, ['self'], { reach: 3, dmg: 1 },
    (fx) => `the skin over you breaks, and every enemy within ${fx.reach} tiles of you takes ${fx.dmg} damage for every hundredth of `
      + 'your health it held.', 'warding'),
  warder(3, 'Deep Ward', 0.2, 60, ['self'], { skin: 2 },
    (fx) => `a ${skin(fx.skin)} over you. ${SKIN_IS}`, 'warding'),
  warder(14, 'Sanctuary', 0.25, 60, ['self'], { skin: 0.8, reach: 6 },
    (fx) => `a ${skin(fx.skin)} over you and over everybody within ${fx.reach} tiles of you. ${SKIN_IS}`, 'warding'),
  warder(42, 'Bastion of Stone', 0.35, 300, ['self'], { cut: 0.4, secs: 10, reach: 4 },
    (fx) => `for ${span(fx.secs)} you and everybody within ${fx.reach} tiles of you take ${percent(fx.cut)} less from every blow.`,
    'warding'),
  warder(44, 'Unbreakable', 0.45, 900, ['self'], { secs: 6 },
    (fx) => `for ${span(fx.secs)} no blow aimed at you lands.`, 'warding'),
];
export const CLASS_SPELL_BY_ID = new Map(CLASS_SPELLS.map((s) => [s.id, s]));
export const classSpellsOf = (cls: string): ClassSpellDef[] => CLASS_SPELLS.filter((s) => s.class === cls);

/** What a class spell costs and how long it rests, as the perk that grants it says first. */
export const spellTerms = (s: ClassSpellDef): string =>
  `Spell${s.cost > 0 ? `, ${percent(s.cost)} of your stamina` : ''}, ${span(s.rest)} before it can be called again.`;
