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
  | 'grow';

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

export const TRAITS: TraitDef[] = [
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

export const TRAIT_BY_ID = new Map(TRAITS.map((t) => [t.id, t]));
export const traitOf = (id: string): TraitDef | undefined => TRAIT_BY_ID.get(id);
export const BY_TIER: Record<TraitTier, TraitDef[]> = {
  common: TRAITS.filter((t) => t.tier === 'common'),
  rare: TRAITS.filter((t) => t.tier === 'rare'),
  supreme: TRAITS.filter((t) => t.tier === 'supreme'),
  fantastic: TRAITS.filter((t) => t.tier === 'fantastic'),
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

/**
 * One fresh trait out of the wild, avoiding what is already there. Husbandry
 * tilts the table: a keeper who knows what they are looking at finds better
 * blood in the wild as well as breeding it.
 */
export function rollTrait(rand: () => number, taken: string[] = [], husbandry = 0): string | null {
  const lift = Math.max(0, Math.min(100, husbandry)) / 100;
  const odds: Record<TraitTier, number> = {
    common: WILD_ODDS.common * (1 - lift * 0.35),
    rare: WILD_ODDS.rare * (1 + lift * 1.5),
    supreme: WILD_ODDS.supreme * (1 + lift * 3),
    fantastic: WILD_ODDS.fantastic * (1 + lift * 5),
  };
  for (let i = 0; i < 12; i++) {
    const t = pick(BY_TIER[rollTier(odds, rand)], rand);
    if (!taken.includes(t.id)) return t.id;
  }
  const rest = TRAITS.filter((t) => !taken.includes(t.id));
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
 * The eleven things a trait can lift, written out.
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
  /** Whether more of it is better. False for appetite, and only appetite. */
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
    const left = pool.filter((id) => !out.includes(id));
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
    // And then the chance that it comes through better than it went in.
    if (rand() < up) {
      const above = nextTier(traitTier(id));
      const room = above ? BY_TIER[above].filter((t) => !out.includes(t.id)) : [];
      if (room.length) id = pick(room, rand).id;
    }
    if (!out.includes(id)) out.push(id);
  }
  // A short straw in the draw never leaves a foal with fewer than three.
  while (out.length < TRAIT_SLOTS) {
    const id = rollTrait(rand, out, husbandry);
    if (!id) break;
    out.push(id);
  }
  return out;
}
