/**
 * Blood.
 *
 * Every wildermon is born with three **traits**, and they are the difference
 * between one Roxxen and the next. A trait sits in one of four tiers — the
 * same four words the smiths use of a rare hatchet — and what it is worth
 * climbs steeply with the tier: a common trait is a few percent, a fantastic
 * one is half again or better.
 *
 * Traits are not found, they are bred. What is walking about in the wild is
 * almost all common, and the only way to put a fantastic trait into a herd is
 * to breed for it, generation after generation, with animal husbandry behind
 * you and a brush in your hand.
 *
 * Thirty of them are **fighting blood** (`FIGHTING`): one name in all four
 * tiers, so a fanged animal may be fanged, fanged (rare), fanged (supreme) or
 * fanged (fantastic), and which of those it is born with is a roll of its
 * own, off the same odds as the rest.
 */

export type TraitTier = 'common' | 'rare' | 'supreme' | 'fantastic';

/**
 * What a trait can lift. Everything here is a multiplier with one as neutral,
 * `appetite` included — below one there is thrift in it.
 */
export type TraitChannel =
  /** How fast it moves: on its own feet, under a rider, in the traces. */
  | 'speed'
  /** How quickly it gets a task done. */
  | 'work'
  /** How fast what it does goes into it as skill. */
  | 'learn'
  /** Panniers on its back and its share of a team's pull. */
  | 'haul'
  /** What it brings back from a trip out. */
  | 'yield'
  /** How fast the belly empties; below one is a cheap keep. */
  | 'appetite'
  /** How much it can take. */
  | 'hardy'
  /** What its attack lands for. */
  | 'tough'
  /** How far it sees for you. */
  | 'sight'
  /** How far from the token or the post it will work. */
  | 'range'
  /** How fast fleece grows back and milk comes in. */
  | 'grow'
  /** What a blow costs it once it lands; below one is armour. */
  | 'soak'
  /** How often a swing at it lands; below one is hard to hit. */
  | 'evade'
  /** How quickly its blows come. */
  | 'haste'
  /** How fast its wounds close. */
  | 'mend';

export interface TraitDef {
  id: string;
  name: string;
  tier: TraitTier;
  /** What it lifts, and by how much. */
  effects: Partial<Record<TraitChannel, number>>;
  /**
   * A communal trait. What it lifts, it lifts for every wildermon working the
   * same settlement or the same post — the bearer included. One lead beast
   * makes a whole deed quicker.
   */
  aura?: boolean;
  /**
   * The fighting trait this is one grade of. Fighting blood comes in all four
   * tiers of the one name, and which grade an animal gets is its own roll.
   */
  family?: string;
  note: string;
}

export const TIERS: TraitTier[] = ['common', 'rare', 'supreme', 'fantastic'];
/** What each tier is called on a card, and the colour it is written in. */
export const TIER_COLOUR: Record<TraitTier, string> = {
  common: '#9fb0a4',
  rare: '#8fc8f0',
  supreme: '#c79bf0',
  fantastic: '#f0c060',
};

const PLAIN_TRAITS: TraitDef[] = [
  // ---- Common: a few percent apiece, and most of what the wild holds. ----
  { id: 'light_footed', name: 'light-footed', tier: 'common', effects: { speed: 1.08 }, note: 'It picks its way quickly.' },
  { id: 'willing', name: 'willing', tier: 'common', effects: { work: 1.08 }, note: 'It sets to work without being asked twice.' },
  { id: 'curious', name: 'curious', tier: 'common', effects: { learn: 1.12 }, note: 'It watches what it is doing and takes something from it.' },
  { id: 'broad_backed', name: 'broad-backed', tier: 'common', effects: { haul: 1.12 }, note: 'It carries and pulls more than its size says.' },
  { id: 'thrifty', name: 'thrifty', tier: 'common', effects: { appetite: 0.92 }, note: 'A cheap thing to keep.' },
  { id: 'thick_coated', name: 'thick-coated', tier: 'common', effects: { hardy: 1.12 }, note: 'There is a lot of coat between the world and it.' },
  { id: 'keen_nosed', name: 'keen-nosed', tier: 'common', effects: { sight: 1.18 }, note: 'It notices things before you do.' },
  { id: 'biddable', name: 'biddable', tier: 'common', effects: { work: 1.03 }, aura: true, note: 'It sets an example, and the others keep up with it.' },
  { id: 'careful', name: 'careful', tier: 'common', effects: { yield: 1.07 }, note: 'It brings back what it went out for, in one piece.' },
  { id: 'rangy', name: 'rangy', tier: 'common', effects: { range: 1.12 }, note: 'It will go further out than most before it turns for home.' },
  { id: 'milky', name: 'milky', tier: 'common', effects: { grow: 1.25 }, note: 'Fleece and milk come back quickly on it.' },
  { id: 'scrappy', name: 'scrappy', tier: 'common', effects: { tough: 1.12 }, note: 'It fights above its weight.' },

  // ---- Rare: worth a fifth to a third, and worth breeding towards. ----
  { id: 'fleet', name: 'fleet', tier: 'rare', effects: { speed: 1.2 }, note: 'Quick over open ground.' },
  { id: 'diligent', name: 'diligent', tier: 'rare', effects: { work: 1.2 }, note: 'It does not stop to look about.' },
  { id: 'bright', name: 'bright', tier: 'rare', effects: { learn: 1.32 }, note: 'It learns a trade faster than it has any right to.' },
  { id: 'draught_bred', name: 'draught-bred', tier: 'rare', effects: { haul: 1.32 }, note: 'Bred for the traces and built for them.' },
  { id: 'frugal', name: 'frugal', tier: 'rare', effects: { appetite: 0.8 }, note: 'It goes a long way on very little.' },
  { id: 'deep_chested', name: 'deep-chested', tier: 'rare', effects: { hardy: 1.32, speed: 1.05 }, note: 'Wind enough to keep going, and to keep standing.' },
  { id: 'herd_minded', name: 'herd-minded', tier: 'rare', effects: { work: 1.08, learn: 1.08 }, aura: true, note: 'The herd works and learns better for having it among them.' },
  { id: 'far_ranging', name: 'far-ranging', tier: 'rare', effects: { range: 1.32, sight: 1.2 }, note: 'It knows the country a long way out.' },

  // ---- Supreme: a third to a half, and rarely caught rather than bred. ----
  { id: 'swift', name: 'swift', tier: 'supreme', effects: { speed: 1.4 }, note: 'There is very little on the island that will catch it.' },
  { id: 'tireless', name: 'tireless', tier: 'supreme', effects: { work: 1.4, appetite: 0.9 }, note: 'It works all day on one meal.' },
  { id: 'quick_witted', name: 'quick-witted', tier: 'supreme', effects: { learn: 1.6 }, note: 'Show it once.' },
  { id: 'lead_beast', name: 'lead beast', tier: 'supreme', effects: { work: 1.16 }, aura: true, note: 'The whole herd works to its pace.' },
  { id: 'strong_shouldered', name: 'strong-shouldered', tier: 'supreme', effects: { haul: 1.6, tough: 1.2 }, note: 'Put it in front of anything.' },
  { id: 'fine_fleeced', name: 'fine-fleeced', tier: 'supreme', effects: { grow: 1.9, yield: 1.2 }, note: 'What comes off it is worth twice what comes off the rest.' },

  // ---- Fantastic: half again and better. A herd may hold one. ----
  { id: 'windborn', name: 'windborn', tier: 'fantastic', effects: { speed: 1.65, range: 1.2 }, note: 'It moves like weather.' },
  { id: 'unflagging', name: 'unflagging', tier: 'fantastic', effects: { work: 1.65, appetite: 0.85 }, note: 'It has never once been seen to stop.' },
  { id: 'old_blood', name: 'old blood', tier: 'fantastic', effects: { learn: 2, yield: 1.2 }, note: 'Something in it remembers being wild and clever.' },
  { id: 'pack_leader', name: 'pack leader', tier: 'fantastic', effects: { work: 1.25, learn: 1.25, speed: 1.1 }, aura: true, note: 'Every wildermon on the deed is the better for it standing there.' },
  { id: 'ironsides', name: 'ironsides', tier: 'fantastic', effects: { hardy: 2, tough: 1.6 }, note: 'It has been through worse than you can arrange.' },
];

// ---- Fighting blood ----

/**
 * Thirty traits for a fight, each in all four tiers.
 *
 * Asked for: "add 30 combat traits that can roll on wildermon, each with its
 * own rarity roll as well". A plain trait *is* its tier — scrappy is common
 * and ironsides fantastic — so the tier roll and the trait roll are one
 * roll. Fighting blood is a name and a grade: the roll picks the name, and
 * then rolls the grade for it off the same wild odds, lifted by husbandry
 * like the rest. What it is worth climbs with the grade by `GRADE_STEP`, so
 * a fanged animal hits for a tenth more and a fanged (fantastic) one for
 * seven tenths more, the same steep climb the plain tiers keep.
 *
 * Every one of them goes into `TRAITS` as four rows, one a tier, so a card,
 * a roll, a breeding and the island's tables read them like any other
 * trait; `family` on the row is the name they share, and an animal never
 * carries two grades of one name.
 */
export interface FightingTraitDef {
  id: string;
  name: string;
  /** What it lifts at the common grade, as a share: 0.1 is a tenth. */
  gains: Partial<Record<TraitChannel, number>>;
  aura?: boolean;
  note: string;
}

export const FIGHTING: FightingTraitDef[] = [
  // What its blows land for.
  { id: 'fanged', name: 'fanged', gains: { tough: 0.1 }, note: 'Long teeth, and it uses them.' },
  { id: 'heavy_pawed', name: 'heavy-pawed', gains: { tough: 0.12 }, note: 'There is weight behind everything it lands.' },
  { id: 'hook_clawed', name: 'hook-clawed', gains: { tough: 0.09 }, note: 'What it catches, it opens.' },
  { id: 'hard_biting', name: 'hard-biting', gains: { tough: 0.11 }, note: 'It does not let go until something gives.' },
  { id: 'horned', name: 'horned', gains: { tough: 0.08, hardy: 0.03 }, note: 'It meets what comes at it head first.' },
  // How much it can take.
  { id: 'thick_hided', name: 'thick-hided', gains: { hardy: 0.1 }, note: 'There is a lot of it between a blow and anything that matters.' },
  { id: 'big_boned', name: 'big-boned', gains: { hardy: 0.12 }, note: 'Built heavier than its kind.' },
  { id: 'broad_chested', name: 'broad-chested', gains: { hardy: 0.09, mend: 0.03 }, note: 'Room in it for a long fight.' },
  { id: 'stout', name: 'stout', gains: { hardy: 0.11 }, note: 'It takes a great deal of stopping.' },
  { id: 'long_lived', name: 'long-lived', gains: { hardy: 0.08, mend: 0.05 }, note: 'Old wounds and old years sit lightly on it.' },
  // What a blow costs it.
  { id: 'tough_skinned', name: 'tough-skinned', gains: { soak: 0.1 }, note: 'A blow lands, and less of it goes in.' },
  { id: 'plated', name: 'plated', gains: { soak: 0.12 }, note: 'The hide over its back is nearer shell than skin.' },
  { id: 'scarred', name: 'scarred', gains: { soak: 0.08, tough: 0.03 }, note: 'It has been in fights before, and learned from them.' },
  { id: 'bristled', name: 'bristled', gains: { soak: 0.09 }, note: 'Everything about it says do not.' },
  { id: 'stone_backed', name: 'stone-backed', gains: { soak: 0.11 }, note: 'Strike it and it is your hand that hurts.' },
  // How often a swing at it lands.
  { id: 'slippery', name: 'slippery', gains: { evade: 0.1 }, note: 'It is never quite where the blow lands.' },
  { id: 'wary', name: 'wary', gains: { evade: 0.11 }, note: 'It sees a swing coming a long way off.' },
  { id: 'nimble', name: 'nimble', gains: { evade: 0.08, speed: 0.03 }, note: 'Light on its feet in a fight.' },
  { id: 'low_slung', name: 'low-slung', gains: { evade: 0.1 }, note: 'It goes under what was meant for it.' },
  { id: 'sharp_eyed', name: 'sharp-eyed', gains: { evade: 0.09 }, note: 'Nothing gets to it unseen.' },
  // How quickly its blows come.
  { id: 'quick_jawed', name: 'quick-jawed', gains: { haste: 0.1 }, note: 'It bites twice where another bites once.' },
  { id: 'snappish', name: 'snappish', gains: { haste: 0.11 }, note: 'It does not wait to be sure.' },
  { id: 'twitchy', name: 'twitchy', gains: { haste: 0.08, evade: 0.03 }, note: 'Never still, and never where it was.' },
  { id: 'sudden', name: 'sudden', gains: { haste: 0.1 }, note: 'It is on you before you have decided about it.' },
  { id: 'wild_eyed', name: 'wild-eyed', gains: { haste: 0.09, tough: 0.03 }, note: 'Something in it does not know when to stop.' },
  // How fast its wounds close.
  { id: 'quick_healing', name: 'quick-healing', gains: { mend: 0.12 }, note: 'It closes in a day what would lay another up for a week.' },
  { id: 'clean_blooded', name: 'clean-blooded', gains: { mend: 0.1 }, note: 'Its wounds do not go bad.' },
  { id: 'hard_to_kill', name: 'hard to kill', gains: { mend: 0.08, hardy: 0.04 }, note: 'It has been left for dead before.' },
  // And two that fight for the herd.
  { id: 'war_leader', name: 'war leader', gains: { tough: 0.04, haste: 0.02 }, aura: true, note: 'The others fight harder with it in the line.' },
  { id: 'shield_wall', name: 'shield wall', gains: { soak: 0.04 }, aura: true, note: 'Beside it the herd stands closer and takes less.' },
];

/** What each grade multiplies the common gain by: the same steep climb the plain tiers keep. */
export const GRADE_STEP: Record<TraitTier, number> = { common: 1, rare: 2.5, supreme: 4.5, fantastic: 7 };
/** The channels where less is better. `CHANNELS` says the same of each, and the blood test checks they agree. */
export const DOWN_CHANNELS = new Set<TraitChannel>(['appetite', 'soak', 'evade']);
/** The row id of one grade of a name: the plain name for common, and the tier hung on it above that. */
export const gradeId = (family: string, tier: TraitTier): string => tier === 'common' ? family : `${family}_${tier}`;
/** What a gain is worth at a grade: a tenth more, or on a channel where less is better, a tenth less of it. */
export function gradeMul(channel: TraitChannel, gain: number, tier: TraitTier): number {
  const g = gain * GRADE_STEP[tier];
  return Math.round((DOWN_CHANNELS.has(channel) ? 1 / (1 + g) : 1 + g) * 1000) / 1000;
}
export const FIGHTING_TRAITS: TraitDef[] = FIGHTING.flatMap((f) => TIERS.map((tier): TraitDef => {
  const effects: Partial<Record<TraitChannel, number>> = {};
  for (const [ch, g] of Object.entries(f.gains)) effects[ch as TraitChannel] = gradeMul(ch as TraitChannel, g as number, tier);
  return { id: gradeId(f.id, tier), name: tier === 'common' ? f.name : `${f.name} (${tier})`, tier, family: f.id, aura: f.aura, effects, note: f.note };
}));
/** The share of what the wild throws up, per slot, that is fighting blood. */
export const FIGHT_SHARE = 0.3;

export const TRAITS: TraitDef[] = [...PLAIN_TRAITS, ...FIGHTING_TRAITS];

export const TRAIT_BY_ID = new Map(TRAITS.map((t) => [t.id, t]));
export const traitOf = (id: string): TraitDef | undefined => TRAIT_BY_ID.get(id);
/** The plain traits by tier: what a roll that is not fighting blood draws from, and what a plain trait climbs into. */
export const BY_TIER: Record<TraitTier, TraitDef[]> = {
  common: PLAIN_TRAITS.filter((t) => t.tier === 'common'),
  rare: PLAIN_TRAITS.filter((t) => t.tier === 'rare'),
  supreme: PLAIN_TRAITS.filter((t) => t.tier === 'supreme'),
  fantastic: PLAIN_TRAITS.filter((t) => t.tier === 'fantastic'),
};

/** Traits every wildermon carries. */
export const TRAIT_SLOTS = 3;

/**
 * What the wild throws up, per slot. Almost all common: a fantastic trait on
 * something you caught is about one animal in seventy, and a fantastic trait
 * you can rely on is one you bred.
 */
export const WILD_ODDS: Record<TraitTier, number> = { common: 0.86, rare: 0.11, supreme: 0.025, fantastic: 0.005 };

const pick = <T,>(list: T[], rand: () => number): T => list[Math.floor(rand() * list.length)];

/** Roll a tier from a table of weights. */
function rollTier(odds: Record<TraitTier, number>, rand: () => number): TraitTier {
  let r = rand() * TIERS.reduce((n, t) => n + odds[t], 0);
  for (const t of TIERS) {
    r -= odds[t];
    if (r < 0) return t;
  }
  return 'common';
}

/** The name a row answers to in a roll: a fighting trait's family, or the plain trait itself. */
export const familyOf = (id: string): string => TRAIT_BY_ID.get(id)?.family ?? id;
/** Whether a set already carries a name, in any grade. */
const holds = (taken: string[], id: string): boolean => taken.some((t) => familyOf(t) === familyOf(id));

/**
 * What a hundred husbandry does to each row of the wild table: a third off the
 * common one, and the three worth having lifted steeply.
 */
export const HUSBANDRY_LIFT: Record<TraitTier, number> = { common: -0.35, rare: 1.5, supreme: 3, fantastic: 5 };
/** The table a keeper of this much husbandry rolls against. Skill of nought is `WILD_ODDS` itself. */
export function husbandryOdds(husbandry = 0): Record<TraitTier, number> {
  const lift = Math.max(0, Math.min(100, husbandry)) / 100;
  const odds = {} as Record<TraitTier, number>;
  for (const t of TIERS) odds[t] = WILD_ODDS[t] * (1 + lift * HUSBANDRY_LIFT[t]);
  return odds;
}

/**
 * One fresh trait out of the wild, avoiding what is already there. Husbandry
 * tilts the table: a keeper who knows what they are looking at finds better
 * blood in the wild as well as breeding it. A share of what comes up is
 * fighting blood, and that is two rolls: the name, and then its own grade.
 */
export function rollTrait(rand: () => number, taken: string[] = [], husbandry = 0): string | null {
  const odds = husbandryOdds(husbandry);
  for (let i = 0; i < 12; i++) {
    const id = rand() < FIGHT_SHARE
      ? gradeId(pick(FIGHTING, rand).id, rollTier(odds, rand))
      : pick(BY_TIER[rollTier(odds, rand)], rand).id;
    if (!holds(taken, id)) return id;
  }
  const rest = TRAITS.filter((t) => !holds(taken, t.id));
  return rest.length ? pick(rest, rand).id : null;
}

/** Three traits for something born in the wild. */
export function rollTraits(rand: () => number, husbandry = 0): string[] {
  const out: string[] = [];
  for (let i = 0; i < TRAIT_SLOTS; i++) {
    const id = rollTrait(rand, out, husbandry);
    if (id) out.push(id);
  }
  return out;
}

// ---- What it is all worth ----

/** One creature's own traits multiplied together on a channel. */
export function traitMul(traits: string[] | undefined, channel: TraitChannel): number {
  let m = 1;
  for (const id of traits ?? []) {
    const t = TRAIT_BY_ID.get(id);
    const v = t?.effects[channel];
    if (v !== undefined) m *= v;
  }
  return m;
}

/** The communal part alone: what one creature's aura traits give everyone. */
export function auraMul(traits: string[] | undefined, channel: TraitChannel): number {
  let m = 1;
  for (const id of traits ?? []) {
    const t = TRAIT_BY_ID.get(id);
    if (!t?.aura) continue;
    const v = t.effects[channel];
    if (v !== undefined) m *= v;
  }
  return m;
}

/** Whether a set of traits carries anything communal at all. */
export const hasAura = (traits: string[] | undefined): boolean => (traits ?? []).some((id) => TRAIT_BY_ID.get(id)?.aura);


// ---- What a channel is, in the words a card uses ----

/**
 * The fifteen things a trait can lift, written out.
 *
 * Every one of these was already declared on `TraitChannel` with a line of
 * comment above it, and a comment is not something a card can print. Reported
 * from the island: *"wildermon traits are useless flair text"* — and they read
 * as flair because the only thing shown was the name and the note. The numbers
 * were sitting in `effects` the whole time and nothing ever put them on a
 * screen.
 *
 * `up` is which way is better, which is the whole of why `appetite` needs a
 * row of its own: it is the one channel where a trait below one is the good
 * one, and a card that prints "−20%" in the colour it prints "−20% speed" in
 * has told you the opposite of what happened.
 */
export interface ChannelDef {
  id: TraitChannel;
  /** What a card calls it. */
  label: string;
  /** What it actually decides. */
  note: string;
  /** Whether more of it is better. False for appetite, and for the two fighting channels where less is better: what a blow costs and how often one lands. */
  up: boolean;
}

export const CHANNELS: ChannelDef[] = [
  { id: 'speed', label: 'speed', up: true, note: 'how fast it moves — on its own feet, under a rider, in the traces' },
  { id: 'work', label: 'work', up: true, note: 'how quickly it finishes a job on the deed' },
  { id: 'learn', label: 'learning', up: true, note: 'how fast the work it does goes into it as skill' },
  { id: 'haul', label: 'hauling', up: true, note: 'what its panniers hold and its share of a team’s pull' },
  { id: 'yield', label: 'yield', up: true, note: 'what it brings back from a trip out' },
  { id: 'appetite', label: 'upkeep', up: false, note: 'how fast its belly empties' },
  { id: 'hardy', label: 'health', up: true, note: 'how much it can take' },
  { id: 'tough', label: 'damage', up: true, note: 'what its attack lands for' },
  { id: 'sight', label: 'sight', up: true, note: 'how far it sees for you' },
  { id: 'range', label: 'range', up: true, note: 'how far from the token or the post it will work' },
  { id: 'grow', label: 'regrowth', up: true, note: 'how fast fleece grows back and milk comes in' },
  { id: 'soak', label: 'damage taken', up: false, note: 'what a blow costs it once it lands' },
  { id: 'evade', label: 'chance to be hit', up: false, note: 'how often a swing at it lands' },
  { id: 'haste', label: 'speed of blows', up: true, note: 'how quickly its blows come' },
  { id: 'mend', label: 'healing', up: true, note: 'how fast its wounds close' },
];

export const CHANNEL_BY_ID = new Map(CHANNELS.map((c) => [c.id, c]));
export const channelOf = (id: TraitChannel): ChannelDef | undefined => CHANNEL_BY_ID.get(id);

/**
 * A multiplier as a card prints it: `1.32` is `+32%`, `0.8` is `-20%`.
 *
 * Rounded to whole percent, because the figures are all two decimal places and
 * `+31.999999999999996%` is what floating point does to `1.32`.
 */
export function pct(mul: number): string {
  const n = Math.round((mul - 1) * 100);
  return `${n >= 0 ? '+' : '−'}${Math.abs(n)}%`;
}

/** Whether a figure on a channel is a gain, for the colour a card gives it. */
export const isGain = (channel: TraitChannel, mul: number): boolean =>
  (CHANNEL_BY_ID.get(channel)?.up ?? true) ? mul > 1 : mul < 1;

/** "+32% learning", or "+32% learning, +20% yield" for a trait that does two things. */
export function traitSays(t: TraitDef): string {
  return CHANNELS.filter((ch) => t.effects[ch.id] !== undefined)
    .map((ch) => `${pct(t.effects[ch.id] as number)} ${ch.label}`)
    .join(', ');
}

/** Every channel a set of traits touches at all, in the order a card reads them. */
export const channelsOf = (traits: string[] | undefined): ChannelDef[] =>
  CHANNELS.filter((ch) => traitMul(traits, ch.id) !== 1);

/** A trait written out for a log line or a card. */
export const traitName = (id: string): string => TRAIT_BY_ID.get(id)?.name ?? id;
export const traitTier = (id: string): TraitTier => TRAIT_BY_ID.get(id)?.tier ?? 'common';
/** "light-footed, fleet and quick-witted" */
export function traitList(traits: string[]): string {
  const names = traits.map(traitName);
  if (!names.length) return 'nothing worth the name';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The best tier in a set, for sorting a herd by its blood. */
export function bestTier(traits: string[] | undefined): TraitTier {
  let best: TraitTier = 'common';
  for (const id of traits ?? []) {
    const t = traitTier(id);
    if (TIERS.indexOf(t) > TIERS.indexOf(best)) best = t;
  }
  return best;
}

// ---- Breeding ----

/**
 * How much of the sire and dam comes through, by the keeper's hand.
 *
 * At no husbandry half of a foal is its parents and half is whatever the blood
 * throws up; at a hundred, with a well-brushed pair, it is nearly all theirs.
 */
export const inheritChance = (husbandry: number, care: number): number =>
  Math.min(0.96, 0.5 + (Math.max(0, Math.min(100, husbandry)) / 100) * 0.35 + Math.max(0, Math.min(1, care)) * 0.11);

/**
 * The chance that a trait comes through one tier better than it went in. This
 * is the whole of why husbandry is worth having: commons become rares,
 * rares become supremes, and a line that is worked at climbs.
 */
export const upgradeChance = (husbandry: number, care: number): number =>
  (Math.max(0, Math.min(100, husbandry)) / 100) * 0.22 + Math.max(0, Math.min(1, care)) * 0.08;

/** One tier up, or null at the top. */
export const nextTier = (t: TraitTier): TraitTier | null => TIERS[TIERS.indexOf(t) + 1] ?? null;

/**
 * What a pairing throws. Three slots, and for each of them the blood of the
 * parents is drawn on first — weighted, as husbandry rises, towards the best
 * of what the two of them carry — and then given its chance to come through
 * better than either of them had it.
 */
export function breedTraits(
  sire: string[],
  dam: string[],
  husbandry: number,
  care: number,
  rand: () => number,
): string[] {
  const pool = [...new Set([...sire, ...dam])];
  const keep = inheritChance(husbandry, care);
  const up = upgradeChance(husbandry, care);
  const lift = Math.max(0, Math.min(100, husbandry)) / 100;
  const out: string[] = [];
  for (let slot = 0; slot < TRAIT_SLOTS; slot++) {
    // What the pair carry that the foal does not, by name: two grades of one name are one name.
    const left = pool.filter((id) => !holds(out, id));
    let id: string | null = null;
    if (left.length && rand() < keep) {
      // A good keeper's eye falls on the best of what the pair carry.
      const weights = left.map((t) => 1 + TIERS.indexOf(traitTier(t)) * lift * 2.4);
      let r = rand() * weights.reduce((a, b) => a + b, 0);
      id = left[left.length - 1];
      for (let i = 0; i < left.length; i++) {
        r -= weights[i];
        if (r < 0) {
          id = left[i];
          break;
        }
      }
    } else {
      id = rollTrait(rand, out, husbandry);
    }
    if (!id) continue;
    // And then the chance that it comes through better than it went in. Fighting
    // blood climbs a grade of its own name; a plain trait climbs into the tier above.
    if (rand() < up) {
      const above = nextTier(traitTier(id));
      const fam = TRAIT_BY_ID.get(id)?.family;
      if (above && fam) id = gradeId(fam, above);
      else {
        const room = above ? BY_TIER[above].filter((t) => !holds(out, t.id)) : [];
        if (room.length) id = pick(room, rand).id;
      }
    }
    if (!holds(out, id)) out.push(id);
  }
  // A short straw in the draw never leaves a foal with fewer than three.
  while (out.length < TRAIT_SLOTS) {
    const id = rollTrait(rand, out, husbandry);
    if (!id) break;
    out.push(id);
  }
  return out;
}
