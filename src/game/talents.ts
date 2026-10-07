// The reach of a spell on a creature is `SPELL_REACH`, which `patrons.ts` takes from `TARGET_RANGE`; read here from where it is
// set, since `patrons.ts` reads this file.
import { DRAW_CLOSEST, HUNT_REACH, KNIFE_BLEED, KNIFE_BLEED_SECS, TARGET_RANGE as SPELL_REACH, THROW_REACH } from './fight';
import type { SpellOn } from './patrons';
import { capital, numberWord, percent, times } from './words';

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

/** What a spell wants in your hands before it can be called: a shield in the off hand, or a weapon of a kind in the other. */
export type SpellNeeds = 'shield' | 'axes' | 'mauls' | 'archery';
/** As the spell's note says it first, and as its refusal says it is missing. */
export const NEEDS_SAID: Record<SpellNeeds, { has: string; wants: string }> = {
  shield: { has: 'With a shield in your off hand', wants: 'a shield in your off hand' },
  axes: { has: 'With an axe in hand', wants: 'an axe in your hand' },
  mauls: { has: 'With a maul in hand', wants: 'a maul in your hand' },
  // A shot also wants an arrow to loose, which its refusal says when there is none.
  archery: { has: 'With a bow in hand', wants: 'a bow in your hands' },
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

/**
 * Every class spell there is, trade by trade, by the number each was picked
 * under. Which tier each sits in is the trade's row in `perks.ts`'s `TIERS`.
 *
 * "A blow" is a blow with what is in your hand, as a swing of it lands: its
 * damage, your stance, the creature's hide and a critical one now and then,
 * all as they are, and then the share the spell names. "A shot" is the same
 * of a draw of the bow in your hand: an arrow loosed, the one a draw would
 * nock, at an enemy within the bow's range and no nearer than a draw can be
 * made, landing less often at the far end of the range as a draw does.
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
];
export const CLASS_SPELL_BY_ID = new Map(CLASS_SPELLS.map((s) => [s.id, s]));
export const classSpellsOf = (cls: string): ClassSpellDef[] => CLASS_SPELLS.filter((s) => s.class === cls);

/** What a class spell costs and how long it rests, as the perk that grants it says first. */
export const spellTerms = (s: ClassSpellDef): string =>
  `Spell${s.cost > 0 ? `, ${percent(s.cost)} of your stamina` : ''}, ${span(s.rest)} before it can be called again.`;
