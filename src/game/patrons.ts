import { FAITH } from './faith';
import { TARGET_RANGE } from './fight';
import { SKILL_BY_ID } from './skills';
import { listedOr } from './words';

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
 * No patron has a spell written yet. `FAITH_SPELLS` is where they go, and the
 * Faith window and the bar already draw whatever is in it.
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

/** The faith a patron is taken at, which is also where its first tier of spells opens. */
export const PATRON_AT = 20;
/** The faith each tier of spells opens at: the patron's own, then every twenty to eighty, and the last at ninety-nine. */
export const FAITH_TIER_AT = [PATRON_AT, 40, 60, 80, 99] as const;
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
}

/**
 * Every faith spell there is, patron by patron and tier by tier.
 *
 * Empty until the first set is written: the Blessing's are next.
 */
export const FAITH_SPELLS: FaithSpellDef[] = [];
export const FAITH_SPELL_BY_ID = new Map(FAITH_SPELLS.map((s) => [s.id, s]));
export const spellsOf = (patron: PatronId, tier: number): FaithSpellDef[] =>
  FAITH_SPELLS.filter((s) => s.patron === patron && s.tier === tier);

/** What a spell can be cast on, as the Faith window says it. */
export const spellOnText = (s: FaithSpellDef): string =>
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

/** Which school a spell id belongs to; only faith spells exist yet. */
export const schoolOf = (id: string): SpellSchool | null => (FAITH_SPELL_BY_ID.has(id) ? 'faith' : null);

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
