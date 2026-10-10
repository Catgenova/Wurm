import { TREE_AGES } from '../world/tiles';
import { FAITH } from './faith';
import { TARGET_RANGE } from './fight';
import { PATH_PICK_BY_ID, PATH_TIER_AT } from './meditation';
import { SKILL_BY_ID } from './skills';
import { CLASS_SPELL_BY_ID } from './talents';
import { listed, listedOr, percent } from './words';

/**
 * Patrons, and the spells they give.
 *
 * At `PATRON_AT` faith a person may take one of three patrons, once and for
 * good: **Blessing**, who is good; **Justice**, who is neither; and **Chaos**,
 * who is evil. A patron is what the faith spells come from. Each one offers
 * `SPELLS_PER_TIER` spells at each of the tiers in `FAITH_TIER_AT`, the first
 * with the patron itself and the last at ninety-nine, and one of the three is
 * taken at each tier, the way a trade's perks are. Each spell says what it can
 * be cast on (`SpellOn`), and the island checks what it was pointed at against
 * that (`spellTargetRefusal`).
 *
 * The island keeps all of it -- the patron, the spells taken, what is on the
 * spell bar and when each spell can be called again -- and the browser asks:
 * `rpc_faith` says what you hold and why anything is refused, `rpc_take_patron`,
 * `rpc_take_faith_spell` and `rpc_spell_bar` change it, and `rpc_cast_spell`
 * calls a spell off the bar. What a patron *offers* is the same for everybody
 * and is written here, which is what the island's rows are generated from.
 *
 * All three patrons' spells are written, fifteen apiece.
 * `FAITH_SPELLS` is where they go, and the Faith window and the bar draw
 * whatever is in it.
 */

export type PatronId = 'blessing' | 'justice' | 'chaos';
export type Alignment = 'good' | 'neutral' | 'evil';

export interface PatronDef {
  id: PatronId;
  name: string;
  alignment: Alignment;
}

export const PATRONS: PatronDef[] = [
  { id: 'blessing', name: 'Blessing', alignment: 'good' },
  { id: 'justice', name: 'Justice', alignment: 'neutral' },
  { id: 'chaos', name: 'Chaos', alignment: 'evil' },
];
export const PATRON_BY_ID = new Map(PATRONS.map((p) => [p.id, p]));
export const ALIGNMENT_NAMES: Record<Alignment, string> = { good: 'Good', neutral: 'Neutral', evil: 'Evil' };

/**
 * The faith each tier of spells opens at: the patron's own, then every twenty
 * to eighty, and the last at ninety-nine -- the same five numbers a path's
 * tiers open at in meditation (`PATH_TIER_AT`).
 */
export const FAITH_TIER_AT = PATH_TIER_AT;
/** The faith a patron is taken at, which is also where its first tier of spells opens. */
export const PATRON_AT = FAITH_TIER_AT[0];
/** How many spells each tier offers, of which one is taken. */
export const SPELLS_PER_TIER = 3;

/**
 * What a spell can be cast on. A spell names every kind it takes:
 *
 *   - `self`: you.
 *   - `player`: somebody else on the island.
 *   - `wildermon`: a creature that is not after you -- a companion, anybody's
 *     beast, or a wild one going about its own business.
 *   - `enemy`: a wild creature, which is anything that can be fought.
 *   - `object`: a thing in your pack, or a thing set down in the world.
 *   - `area`: everything within the spell's `radius` of a spot: where you
 *     stand, or a tile you choose.
 *
 * A wild creature that is not after you is both a wildermon and an enemy, so a
 * spell of either kind can be cast on it. Anything but yourself and what you
 * carry has to be within `SPELL_REACH` tiles.
 */
export type SpellOn = 'self' | 'player' | 'wildermon' | 'enemy' | 'object' | 'area';
export const SPELL_ONS: readonly SpellOn[] = ['self', 'player', 'wildermon', 'enemy', 'object', 'area'];
/** How each kind reads in "<spell> is cast on ...". */
export const SPELL_ON_WORDS: Record<SpellOn, string> = {
  self: 'yourself',
  player: 'another person',
  wildermon: 'a wildermon',
  enemy: 'an enemy',
  object: 'a thing',
  area: 'the ground',
};
/** How far off anything a spell is cast on may be, in tiles: as far as a foe can be marked. */
export const SPELL_REACH = TARGET_RANGE;

export interface FaithSpellDef {
  /** `<patron>_<name>`, which is what the island keeps. */
  id: string;
  patron: PatronId;
  /** One to `FAITH_TIER_AT.length`. */
  tier: number;
  name: string;
  /** What it does, in the game's numbers. */
  note: string;
  /** Favour it costs. */
  cost: number;
  /** Seconds before it can be called again. */
  rest: number;
  /** Every kind of thing it can be cast on, the one it goes at by default first. */
  on: readonly SpellOn[];
  /** For a spell cast on the ground: how many tiles round the spot it reaches. */
  radius?: number;
  /** The numbers behind what it does, by name, which the island reads off its row and the note is written from. */
  fx: Readonly<Record<string, number>>;
}

/** A stretch of time as the spell notes say it: seconds up to two minutes, then minutes. */
const span = (secs: number): string => (secs < 120 ? `${secs} s` : `${secs / 60} minutes`);

/**
 * The stages Bless the Land moves a tree on by, in the order a tree grows:
 * each living stage to the next, so long as the next is alive and not the
 * same stage over again -- nothing is grown into dying, and a clipped tree
 * stays clipped.
 */
export const LAND_GROWS: ReadonlyArray<readonly [number, number]> = (() => {
  const by = new Map(TREE_AGES.map((a) => [a.id, a]));
  const grows = (id: number): boolean => {
    const a = by.get(id);
    const n = a?.next ?? null;
    return !!a && a.alive && n !== null && n !== id && !!by.get(n)?.alive;
  };
  const into = new Set(TREE_AGES.filter((a) => grows(a.id)).map((a) => a.next as number));
  const out: Array<readonly [number, number]> = [];
  for (let at = TREE_AGES.find((a) => grows(a.id) && !into.has(a.id))?.id ?? -1; at >= 0 && grows(at);) {
    const next = by.get(at)?.next as number;
    out.push([at, next]);
    at = next;
  }
  return out;
})();
const ageName = (id: number): string => (TREE_AGES.find((a) => a.id === id)?.name ?? '').toLowerCase();

/** One of a patron's spells, its note written from its own numbers. */
const spellOf = (patron: PatronId) => (
  tier: number, id: string, name: string, cost: number, rest: number, on: readonly SpellOn[],
  fx: Record<string, number>, note: (fx: Record<string, number>, radius: number) => string, radius?: number,
): FaithSpellDef => ({ id: `${patron}_${id}`, patron, tier, name, cost, rest, on, radius, fx, note: note(fx, radius ?? 0) });
const blessing = spellOf('blessing');
const justice = spellOf('justice');
const chaos = spellOf('chaos');

/**
 * Every faith spell there is, patron by patron and tier by tier.
 *
 * The Blessing's three at each tier are one that mends, one that guards and
 * one for creatures, things and the land. Justice's are one that judges what
 * it is cast on, one that keeps order in a fight, and one that measures.
 * Chaos's are one that ruins, one that dreads and one that is a bargain --
 * paid for in your own health or your own things rather than favour -- and
 * none of them touches another person or anything of theirs. What
 * lasts a while is kept on the island against whoever it was cast on
 * (`player.blessings`), against a creature (`faith_mark`) or against the
 * ground (`faith_zone`), and the rules that fight, heal, tame, work and grow
 * look there.
 */
export const FAITH_SPELLS: FaithSpellDef[] = [
  blessing(1, 'soothe', 'Soothe', 8, 20, ['self', 'player'], { heal: 0.1 },
    (fx) => `Heals ${percent(fx.heal)} of their health and stops their worst bleeding wound bleeding.`),
  blessing(1, 'ward', 'Ward', 10, 60, ['self', 'player'], { cut: 0.5, secs: 30 },
    (fx) => `The next blow to land on them within ${span(fx.secs)} does ${percent(fx.cut)} less damage.`),
  blessing(1, 'tend', 'Tend', 8, 30, ['wildermon'], { heal: 0.25 },
    (fx) => `Heals the wildermon ${percent(fx.heal)} of its health and stops it bleeding.`),

  blessing(2, 'purify', 'Purify', 12, 45, ['self', 'player'], {},
    () => 'Draws the venom out of every wound they have and closes every burn.'),
  blessing(2, 'calm', 'Calm', 14, 90, ['enemy'], { secs: 60 },
    (fx) => `A wild creature stops hunting and cannot start a hunt for ${span(fx.secs)}. Monsters are not calmed.`),
  blessing(2, 'steady', 'Steady Hands', 14, 600, ['object'], { cut: 0.1, secs: 1800 },
    (fx) => `For ${span(fx.secs)}, every job that wants this tool takes ${percent(fx.cut)} less time while you carry it.`),

  blessing(3, 'renewal', 'Renewal', 20, 60, ['self', 'player'], { each: 0.03, every: 3, secs: 30 },
    (fx) => `Heals ${percent(fx.each)} of their health every ${span(fx.every)} for ${span(fx.secs)}: ${percent(fx.each * fx.secs / fx.every)} in all.`),
  blessing(3, 'arms', 'Bless Arms', 20, 120, ['self', 'player'], { more: 0.2, secs: 60 },
    (fx) => `For ${span(fx.secs)}, their blows do ${percent(fx.more)} more damage to monsters.`),
  blessing(3, 'kinship', 'Kinship', 20, 600, ['wildermon'], { points: 0.25, secs: 60 },
    (fx) => `Your next go at taming this wildermon within ${span(fx.secs)} is ${Math.round(fx.points * 100)} points likelier to succeed.`),

  blessing(4, 'benediction', 'Benediction', 30, 120, ['area'], { heal: 0.2 },
    (fx, r) => `Everybody within ${r} tiles of the spot, you too, and every wildermon there heals ${percent(fx.heal)} of their health and stops bleeding.`, 6),
  blessing(4, 'shield', 'Shield of Dawn', 30, 180, ['self', 'player'], { share: 0.3, secs: 60 },
    (fx) => `For ${span(fx.secs)}, damage up to ${percent(fx.share)} of their health is taken by the shield instead of them.`),
  blessing(4, 'sanctuary', 'Sanctuary', 34, 300, ['area'], { secs: 30 },
    (fx, r) => `For ${span(fx.secs)}, nothing wild starts a hunt on anybody within ${r} tiles of the spot, and whatever is hunting somebody there gives it up.`, 4),

  blessing(5, 'second_life', 'Second Life', 60, 1800, ['self', 'player'], { secs: 600, heal: 0.5 },
    (fx) => `For ${span(fx.secs)}, the first blow that would kill them leaves them at ${percent(fx.heal)} of their health instead.`),
  blessing(5, 'radiance', 'Radiance', 60, 600, ['area'], { each: 0.02, secs: 30 },
    (fx, r) => `For ${span(fx.secs)}, every creature within ${r} tiles of the spot that is hunting somebody loses ${percent(fx.each)} of its health a second, ${percent(fx.each * fx.secs)} in all; it is never killed by it.`, 8),
  blessing(5, 'land', 'Bless the Land', 50, 3600, ['area'], {},
    (_fx, r) => `Every tree within ${r} tiles of the spot grows a stage: ${listed(LAND_GROWS.map(([a, b]) => `${ageName(a)} to ${ageName(b)}`))}. One that would grow into dying, and one that is clipped, stays as it is.`, 10),

  justice(1, 'mark', 'Mark of Judgment', 10, 30, ['enemy'], { more: 0.15, secs: 30 },
    (fx) => `For ${span(fx.secs)} the creature takes ${percent(fx.more)} more damage from every blow, whoever or whatever strikes it.`),
  justice(1, 'retribution', 'Retribution', 10, 60, ['self', 'player'], { share: 0.2, secs: 60 },
    (fx) => `For ${span(fx.secs)}, ${percent(fx.share)} of every blow that lands on them is dealt back to whatever struck.`),
  justice(1, 'assay', 'Assay', 12, 600, ['area'], { secs: 600 },
    (fx, r) => `Every ore seam under the ground within ${r} tiles of the spot is marked for you for ${span(fx.secs)}, as a prospector's sensing marks it.`, 8),

  justice(2, 'sentence', 'Sentence', 16, 60, ['enemy'], { share: 0.25 },
    (fx) => `Strikes the creature for ${percent(fx.share)} of the health it has already lost. Not on a creature that is unhurt.`),
  justice(2, 'bind', 'Bind', 14, 90, ['enemy'], { secs: 5, monster: 0.5 },
    (fx) => `Holds the creature where it stands for ${span(fx.secs)}: it neither moves nor strikes. A monster is held for ${span(fx.secs * fx.monster)}.`),
  justice(2, 'equity', 'Equity', 10, 60, ['player'], {},
    () => 'You and the other person both end at the average of your healths.'),

  justice(3, 'verdict', 'Verdict', 24, 120, ['enemy'], { below: 0.2, monster: 0.1, share: 0.1 },
    (fx) => `A creature below ${percent(fx.below)} of its health dies at once, a monster below ${percent(fx.monster)}; any other loses ${percent(fx.share)} of its health.`),
  justice(3, 'summons', 'Summons', 20, 60, ['enemy'], { secs: 20 },
    (fx) => `The creature turns on you and hunts only you for ${span(fx.secs)}, whoever it was after.`),
  justice(3, 'temper', 'Temper', 20, 600, ['object'], { secs: 1800 },
    (fx) => `For ${span(fx.secs)}, the thing takes no wear at all while you carry it.`),

  justice(4, 'judgment', 'Judgment', 34, 300, ['area'], { share: 0.15, more: 0.15, secs: 30 },
    (fx, r) => `Every creature within ${r} tiles of the spot that is hunting somebody loses ${percent(fx.share)} of its health and, for ${span(fx.secs)}, takes ${percent(fx.more)} more damage from every blow.`, 6),
  justice(4, 'truce', 'Truce', 30, 600, ['area'], { secs: 30 },
    (fx, r) => `For ${span(fx.secs)}, nothing within ${r} tiles of the spot can strike or be struck, people and creatures alike.`, 8),
  justice(4, 'restitution', 'Restitution', 40, 3600, ['self', 'player'], {},
    () => 'Everything in their latest grave comes back into their pack, wherever they are.'),

  justice(5, 'execution', 'Execution', 60, 1800, ['enemy'], { below: 0.5, monster: 0.3, share: 0.2 },
    (fx) => `A creature below ${percent(fx.below)} of its health dies at once, a monster below ${percent(fx.monster)}; any other loses ${percent(fx.share)} of its health.`),
  justice(5, 'oath', 'Oath', 50, 3600, ['player'], { secs: 600 },
    (fx) => `For ${span(fx.secs)}, every blow that lands on you or on the friend it is cast on is split evenly between you. Only on a friend.`),
  justice(5, 'reward', 'Due Reward', 50, 3600, ['self', 'player'], { more: 0.2, secs: 1800 },
    (fx) => `For ${span(fx.secs)}, every skill they raise gains ${percent(fx.more)} more.`),

  chaos(1, 'hex', 'Hex', 8, 20, ['enemy'], { each: 0.02, secs: 15 },
    (fx) => `The creature bleeds ${percent(fx.each)} of its health a second for ${span(fx.secs)}, ${percent(fx.each * fx.secs)} in all. Bleeding never kills.`),
  chaos(1, 'fright', 'Fright', 10, 60, ['enemy'], { secs: 8 },
    (fx) => `The creature flees from you for ${span(fx.secs)}. Monsters are not frightened.`),
  chaos(1, 'blood_price', 'Blood Price', 0, 300, ['self'], { price: 0.2, favour: 15, floor: 0.3 },
    (fx) => `Costs no favour. Spend ${percent(fx.price)} of your health for ${fx.favour} favour; not with less than ${percent(fx.floor)} of your health.`),

  chaos(2, 'siphon', 'Siphon', 12, 30, ['enemy'], { share: 0.1 },
    (fx) => `Takes ${percent(fx.share)} of the creature's health, and heals you by what a blow of that much would take from you.`),
  chaos(2, 'cower', 'Cower', 14, 60, ['enemy'], { cut: 0.3, secs: 30 },
    (fx) => `For ${span(fx.secs)} the creature's blows do ${percent(fx.cut)} less damage.`),
  chaos(2, 'pact', 'Pact', 0, 180, ['self'], { price: 0.3, more: 0.4, secs: 60 },
    (fx) => `Costs no favour. Spend ${percent(fx.price)} of your health: for ${span(fx.secs)} your blows do ${percent(fx.more)} more damage.`),

  chaos(3, 'plague', 'Plague', 26, 180, ['area'], { each: 0.015, secs: 30 },
    (fx, r) => `Every wild creature within ${r} tiles of the spot bleeds ${percent(fx.each)} of its health a second for ${span(fx.secs)}, ${percent(fx.each * fx.secs)} in all. Bleeding never kills.`, 5),
  chaos(3, 'panic', 'Panic', 24, 120, ['area'], { secs: 10, monster: 3 },
    (fx, r) => `Every wild creature within ${r} tiles of the spot flees from it for ${span(fx.secs)}, a monster for ${span(fx.monster)}.`, 6),
  chaos(3, 'unmake', 'Unmake', 0, 600, ['object'], { per: 0.25, most: 25 },
    (fx) => `Costs no favour. Destroys a thing you carry and gives you favour of ${percent(fx.per)} of its quality, ${fx.most} at most. Not a thing you wear, a locked thing, or a bag with anything in it.`),

  chaos(4, 'soul_rend', 'Soul Rend', 36, 300, ['enemy'], { share: 0.3, favour: 30 },
    (fx) => `Takes ${percent(fx.share)} of the creature's health; if that kills it, ${fx.favour} favour comes back to you.`),
  chaos(4, 'shroud', 'Shroud', 30, 300, ['self'], { reach: 3, secs: 60 },
    (fx) => `For ${span(fx.secs)} nothing notices you from further than ${fx.reach} tiles off, and whatever is hunting you from further than that loses you.`),
  chaos(4, 'blood_feast', 'Blood Feast', 0, 600, ['self'], { price: 0.15, share: 0.25, secs: 60 },
    (fx) => `Costs no favour. Spend ${percent(fx.price)} of your health: for ${span(fx.secs)}, every blow you land heals you by ${percent(fx.share)} of what it dealt.`),

  chaos(5, 'cataclysm', 'Cataclysm', 70, 1800, ['area'], { share: 0.4 },
    (fx, r) => `Every wild creature within ${r} tiles of the spot loses ${percent(fx.share)} of its health at once.`, 8),
  chaos(5, 'abyssal_gaze', 'Abyssal Gaze', 60, 1800, ['enemy'], { secs: 15, more: 0.5 },
    (fx) => `The creature flees from you for ${span(fx.secs)}, monsters too, and takes ${percent(fx.more)} more damage from every blow while it does.`),
  chaos(5, 'undying', 'Undying', 0, 3600, ['self'], { price: 0.25, secs: 60, floor: 0.01 },
    (fx) => `Costs no favour. Spend ${percent(fx.price)} of your health: for ${span(fx.secs)} no blow can kill you, and one that would leaves you at ${percent(fx.floor)} of your health.`),
];
export const FAITH_SPELL_BY_ID = new Map(FAITH_SPELLS.map((s) => [s.id, s]));
export const spellsOf = (patron: PatronId, tier: number): FaithSpellDef[] =>
  FAITH_SPELLS.filter((s) => s.patron === patron && s.tier === tier);

/** What a spell can be cast on, as the Faith window says it. */
export const spellOnText = (s: Pick<FaithSpellDef, 'on' | 'radius'>): string =>
  listedOr(s.on.map((o) => (o === 'area' ? `the ground, everything within ${s.radius ?? 0} tiles of you or of a tile you choose` : SPELL_ON_WORDS[o])));

/**
 * What a spell was pointed at, as the island finds it. `rpc_cast_spell` takes
 * `{kind: 'self'}`, `{kind: 'player', uid}`, `{kind: 'creature', id}`,
 * `{kind: 'item', id}`, `{kind: 'placed', id}` or `{kind: 'area'}`, the last
 * with an `x` and `y` when it is not where you stand.
 */
export interface PointedAt {
  kind: 'self' | 'player' | 'creature' | 'item' | 'placed' | 'area';
  /** Whether it is there at all: somebody on the island, a thing in your own pack, and so on. */
  found: boolean;
  /** Tiles from you; nought for yourself and what you carry. */
  dist: number;
  /** A person who turns out to be you. */
  you?: boolean;
  /** A creature that is wild. */
  wild?: boolean;
  /** A creature that is after you. */
  after?: boolean;
}

/** Which of the spell's kinds the thing pointed at counts as, or nothing. */
export function spellOnOf(on: readonly SpellOn[], t: PointedAt): SpellOn | null {
  switch (t.kind) {
    case 'self':
      return on.includes('self') ? 'self' : null;
    case 'player':
      if (t.you) return on.includes('self') ? 'self' : null;
      return on.includes('player') ? 'player' : null;
    case 'creature':
      if (on.includes('enemy') && t.wild) return 'enemy';
      if (on.includes('wildermon') && !t.after) return 'wildermon';
      return null;
    case 'item':
    case 'placed':
      return on.includes('object') ? 'object' : null;
    case 'area':
      return on.includes('area') ? 'area' : null;
  }
}

/**
 * Why a spell cannot be cast on what it was pointed at, or nothing: the same
 * as the island's `spell_target`, in the same order and words. Not there, not
 * a kind the spell takes, or too far off.
 */
export function spellTargetRefusal(s: FaithSpellDef, t: PointedAt): string | null {
  if (!t.found) return 'That is not here.';
  if (!spellOnOf(s.on, t)) {
    if (t.kind === 'creature' && s.on.includes('enemy') && !t.wild) return 'That is tame, not an enemy.';
    if (t.kind === 'creature' && s.on.includes('wildermon') && t.after) return 'That is after you.';
    return `${s.name} is cast on ${listedOr(s.on.map((o) => SPELL_ON_WORDS[o]))}.`;
  }
  if (t.dist > SPELL_REACH) return `That is more than ${SPELL_REACH} tiles away.`;
  return null;
}

/** The faith a tier opens at. */
export const faithTierAt = (tier: number): number => FAITH_TIER_AT[tier - 1];
/** How many tiers this much faith has open. */
export const tiersOpen = (faith: number): number => FAITH_TIER_AT.filter((at) => faith >= at).length;

const faithName = (): string => (SKILL_BY_ID.get(FAITH)?.name ?? 'Faith').toLowerCase();

/**
 * Why this patron cannot be taken, or nothing.
 *
 * The same refusals the island builds in `patron_refusal`, in the same order
 * and the same words, which the suite asks the two of them to agree on.
 */
export function patronRefusal(id: string, mine: PatronId | null, faith: number): string | null {
  const p = PATRON_BY_ID.get(id as PatronId);
  if (!p) return 'There is no such patron.';
  if (mine) return `${PATRON_BY_ID.get(mine)?.name ?? mine} is your patron already, and a patron is for good.`;
  if (faith < PATRON_AT) return `A patron is taken at ${PATRON_AT} ${faithName()}; you have ${Math.floor(faith)}.`;
  return null;
}

/**
 * Why a faith spell cannot be taken, or nothing: the same as the island's
 * `faith_spell_refusal`. Not your patron's, already yours, another taken at
 * that tier, or the tier not open yet. `spells` is every spell there is, which
 * the suite hands its own.
 */
export function faithSpellRefusal(
  s: FaithSpellDef, mine: PatronId | null, taken: readonly string[], faith: number, spells: readonly FaithSpellDef[] = FAITH_SPELLS,
): string | null {
  if (!mine) return 'Take a patron first.';
  if (s.patron !== mine) return `That is ${PATRON_BY_ID.get(s.patron)?.name ?? s.patron}’s, and ${PATRON_BY_ID.get(mine)?.name ?? mine} is your patron.`;
  if (taken.includes(s.id)) return 'You have that already.';
  const other = spells.find((o) => o.patron === s.patron && o.tier === s.tier && taken.includes(o.id));
  if (other) return `You took ${other.name} at this tier.`;
  const at = faithTierAt(s.tier);
  if (faith < at) return `This tier opens at ${at} ${faithName()}; you have ${Math.floor(faith)}.`;
  return null;
}

/* ---- The spell bar ----------------------------------------------------------- */

/** What can be put in a slot of the bar: a trade's spell, a patron's, or a path's. */
export type SpellSchool = 'class' | 'faith' | 'path';
export const SCHOOL_NAMES: Record<SpellSchool, string> = { class: 'Class', faith: 'Faith', path: 'Path' };

/** The six slots, left to right: three for your trade's spells, two for your patron's, one for your path's. */
export const SPELL_BAR: readonly SpellSchool[] = ['class', 'class', 'class', 'faith', 'faith', 'path'];
export const BAR_SLOTS = SPELL_BAR.length;
/** How many slots each school has. */
export const slotsFor = (school: SpellSchool): number => SPELL_BAR.filter((s) => s === school).length;

/** Which school a spell id belongs to: a patron's, a fighting trade's (`talents.ts`), or a path's technique (`meditation.ts`). */
export const schoolOf = (id: string): SpellSchool | null =>
  (FAITH_SPELL_BY_ID.has(id) ? 'faith' : CLASS_SPELL_BY_ID.has(id) ? 'class'
    : PATH_PICK_BY_ID.get(id)?.kind === 'technique' ? 'path' : null);

/**
 * Why this spell cannot go in this slot, or nothing: the same as the island's
 * `spell_slot_refusal`. Clearing a slot is never refused. `school` is the
 * spell's own, which the suite hands in for spells of its own.
 */
export function slotRefusal(
  slot: number, id: string | null, known: readonly string[], school: SpellSchool | null = id ? schoolOf(id) : null,
): string | null {
  if (!Number.isInteger(slot) || slot < 0 || slot >= BAR_SLOTS) return 'There is no such slot.';
  if (id === null) return null;
  if (!school || !known.includes(id)) return 'You do not have that spell.';
  if (school !== SPELL_BAR[slot]) return `That slot is for ${SCHOOL_NAMES[SPELL_BAR[slot]].toLowerCase()} spells.`;
  return null;
}
