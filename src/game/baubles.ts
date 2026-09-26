import type { ActionDef, Target } from './actions';
import type { Deed, Game } from './game';
import { rankAtLeast } from './game';
import { furnitureCentre, furnitureDef, type PlacedFurniture } from './furniture';
import { describeWith, itemName, rarityOf, rarityStep, type Item } from './items';
import { times } from './words';

/**
 * Baubles: small things the old people left in the ground, which a settlement
 * sets into its altar.
 *
 * Asked for: "Add a 30% chance during archeology to uncover Baubles. Baubles
 * need to be restored during the restoration process like normal artifacts.
 * Baubles can be Minor (70%) Major (25%) and Ancient (5%). These will be
 * inserted into the Deed Alter to unlock permanent bonuses for all citizens for
 * actions on that deed only. Alters have 3 ancient Baubles slots, 5 major
 * slots, and 21 minor slots." And then what each gives, and that rarity
 * doubles, triples or quadruples it, and that one set in can be replaced but
 * never taken out.
 *
 * So:
 *
 *   * `BAUBLE_SHARE` of whatever a trowel turns up is a tarnished bauble
 *     rather than a piece of a relic, its tier rolled on `BAUBLE_TIERS`.
 *   * It is put right by the same Restore as a relic (`restore_relic`), at
 *     its tier's difficulty. That is when what it does is rolled, and its
 *     rarity with it, which multiplies the roll by `baubleTimes`; the whole
 *     of it is then written on the bauble (`extra`), so what you read is
 *     what it gives.
 *   * It is set into the altar of a settlement of yours (`set_bauble`), into
 *     one of that settlement's sockets for its tier. The sockets are the
 *     settlement's, not the stone's: every altar on it opens the same ones,
 *     and a second altar is not a second set. A socket is filled for good --
 *     another bauble can take its place, and the one in it is lost.
 *   * What the baubles in a settlement's sockets give, they give to its
 *     citizens -- not its guests -- while they stand on it (`baubleHere`).
 *     Each kind adds up across sockets for the same skill, to `BAUBLE_CAP`.
 *
 * The island holds the same numbers (crossed in the defs) and the same rules
 * (`bauble_*` in the migrations), and says the same words.
 */

/** Of what archaeology turns up, the share that is a bauble rather than a piece of a relic. */
export const BAUBLE_SHARE = 0.3;

export type BaubleTier = 'minor' | 'major' | 'ancient';
export type BaubleKind = 'time' | 'learn' | 'double' | 'plus';

export interface BaubleTierDef {
  id: BaubleTier;
  name: string;
  /** Of the baubles found, the share that are of this tier. */
  odds: number;
  /** Sockets for it on a settlement's altar. */
  slots: number;
  /** How hard it is to restore. */
  difficulty: number;
  /** The item it becomes once restored. */
  item: string;
}

export const BAUBLE_TIERS: BaubleTierDef[] = [
  { id: 'minor', name: 'Minor', odds: 0.7, slots: 21, difficulty: 15, item: 'bauble_minor' },
  { id: 'major', name: 'Major', odds: 0.25, slots: 5, difficulty: 30, item: 'bauble_major' },
  { id: 'ancient', name: 'Ancient', odds: 0.05, slots: 3, difficulty: 45, item: 'bauble_ancient' },
];
export const BAUBLE_TIER_BY_ID = new Map(BAUBLE_TIERS.map((t) => [t.id, t]));
export const tierOfItem = (id: string): BaubleTierDef | undefined => BAUBLE_TIERS.find((t) => t.item === id);

/** What comes out of the ground: one item, its tier on it (`extra`), to be restored. */
export const TARNISHED = 'tarnished_bauble';

/** The least and the most a minor or major bauble rolls, in percent, before its rarity. */
export const BAUBLE_LOW = 1;
export const BAUBLE_HIGH = 5;
/** What an ancient bauble adds, before its rarity. */
export const ANCIENT_PLUS = 1;

/** What a bauble's rarity multiplies its roll by: an ordinary one once, a rare one twice, a supreme three and a fantastic four times. */
export const baubleTimes = (rare: number | undefined): number => 1 + Math.max(0, Math.min(3, rare ?? 0));

/** What a major bauble multiplies a go's yield by, the times it comes up. */
export const YIELD_TIMES = 2;

export interface BaubleKindDef {
  /** How it is written on a bauble, after the skill: what goes before its amount, and what after. */
  lead: string;
  tail: string;
  /** The most it adds up to, for one skill, on one settlement, in percent, however many baubles give it. */
  cap: number;
}

/**
 * The three kinds that are a share of something: less time on a job, more
 * skill from a go, and a chance of `YIELD_TIMES` the yield. An ancient
 * bauble's `plus` is a count, and is written from `ANCIENT_EFFECTS`.
 */
export const BAUBLE_KINDS: Record<Exclude<BaubleKind, 'plus'>, BaubleKindDef> = {
  time: { lead: '', tail: '% less time', cap: 50 },
  learn: { lead: '+', tail: '% skill gain', cap: 100 },
  double: { lead: '', tail: `% chance of ${times(YIELD_TIMES)} the yield`, cap: 50 },
};

// What each bauble's description counts and multiplies, from the rules themselves.
describeWith({
  bauble: {
    ...Object.fromEntries(BAUBLE_TIERS.map((t) => [t.id, { slots: t.slots, difficulty: t.difficulty }])),
    yield: YIELD_TIMES,
  },
});

/**
 * The skills a minor bauble speaks for: every skill that is not a
 * characteristic or a fighting skill and that some job is done with. Climbing
 * and swimming are done with your feet, not a job, so they are not here.
 * `supabase/test/baubles.ts` holds this against the actions themselves.
 */
export const MINOR_SKILLS: string[] = [
  'digging', 'mining', 'prospecting', 'woodcutting', 'forestry', 'foraging', 'botanizing', 'fishing', 'brewing', 'paving',
  'masonry', 'stonecutting', 'carpentry', 'fine_carpentry', 'pottery', 'tailoring', 'ropemaking', 'cooking', 'milling',
  'smelting', 'blacksmithing', 'weaponsmithing', 'armorsmithing', 'farming', 'taming', 'animal_husbandry', 'butchering',
  'alchemy', 'prayer', 'meditation', 'repair', 'first_aid', 'chirurgy', 'papyrusmaking', 'archaeology', 'restoration',
  'leatherworking', 'chainsmithing', 'platesmithing', 'jewellery', 'bowyery', 'fletching',
];

/**
 * The skills a major bauble speaks for: those whose jobs put something in
 * your hands -- everything made at the crafting window, and the gathering
 * trades. Not archaeology: a bauble that doubled what the trowel turns up
 * would be a bauble that made baubles. Nor paving, whose only yield is the
 * slab you laid, lifted again.
 */
export const MAJOR_SKILLS: string[] = [
  'digging', 'mining', 'woodcutting', 'forestry', 'foraging', 'botanizing', 'fishing', 'farming', 'butchering',
  'alchemy', 'animal_husbandry', 'armorsmithing', 'blacksmithing', 'bowyery', 'carpentry', 'chainsmithing', 'cooking',
  'fine_carpentry', 'first_aid', 'fletching', 'jewellery', 'leatherworking', 'masonry', 'milling', 'papyrusmaking',
  'platesmithing', 'pottery', 'ropemaking', 'smelting', 'stonecutting', 'tailoring', 'weaponsmithing',
];

export interface AncientEffect {
  /** The word it goes by on the bauble, first. */
  id: string;
  /** The job it adds to. */
  action: string;
  /** What it adds to, after "+1". */
  said: string;
}

/** What an ancient bauble adds to: one job each, and one more of what that job gives, every time it gives anything. */
export const ANCIENT_EFFECTS: AncientEffect[] = [
  { id: 'mining', action: 'mine', said: 'to the output of each mining action' },
  { id: 'felling', action: 'cut_down', said: 'to the logs from each tree felled' },
  { id: 'digging', action: 'dig', said: 'to the output of each dig' },
  { id: 'harvest', action: 'harvest_crop', said: 'to the crop and to the seed from each harvest' },
  { id: 'fishing', action: 'fish', said: 'to each catch with a rod' },
  { id: 'foraging', action: 'forage', said: 'to each find when foraging' },
];
export const ANCIENT_BY_ID = new Map(ANCIENT_EFFECTS.map((e) => [e.id, e]));

/** A skill as it is written on a bauble: its id, in words. */
const words = (skill: string): string => skill.replace(/_/g, ' ');
const tenth = (n: number): string => n.toFixed(1);

/**
 * What a bauble gives, as it is written on it. The island writes the same
 * (`bauble_text`), and reads it back the same way (`bauble_read`).
 */
export function baubleText(kind: BaubleKind, key: string, amount: number): string {
  if (kind === 'plus') return `${key}: +${Math.round(amount)} ${ANCIENT_BY_ID.get(key)?.said ?? ''}`.trimEnd();
  const k = BAUBLE_KINDS[kind];
  return `${words(key)}: ${k.lead}${tenth(amount)}${k.tail}`;
}

/** A bauble, as a settlement holds it: the socket it is in, and what it gives. */
export interface DeedBauble {
  tier: BaubleTier;
  /** Which socket of its tier, from 0. */
  slot: number;
  kind: BaubleKind;
  /** The skill it speaks for, or for an ancient one the job it adds to (`AncientEffect.id`). */
  key: string;
  /** Percent for the three kinds that are shares; a count for `plus`. Rarity already counted. */
  amount: number;
  rare?: number;
  ql?: number;
}

/**
 * What a restored bauble gives, read off what is written on it; null for
 * anything that is not one. An ancient one is read by its job and its count,
 * whatever words follow them; the others by the words around the amount,
 * which are what say which kind it is.
 */
export function readBauble(item: Pick<Item, 'id' | 'extra'>): Omit<DeedBauble, 'slot' | 'rare' | 'ql'> | null {
  const tier = tierOfItem(item.id);
  const m = tier && item.extra ? /^([a-z ]+): (\+?)(\d+(?:\.\d+)?)(.*)$/.exec(item.extra) : null;
  if (!tier || !m) return null;
  const [, head, lead, figure, tail] = m;
  const amount = Number(figure);
  if (tier.id === 'ancient') {
    return ANCIENT_BY_ID.has(head) && lead === '+' && Number.isInteger(amount) ? { tier: tier.id, kind: 'plus', key: head, amount } : null;
  }
  const key = head.replace(/ /g, '_');
  const [kinds, skills] = tier.id === 'major' ? [['double'] as const, MAJOR_SKILLS] : [['time', 'learn'] as const, MINOR_SKILLS];
  const kind = kinds.find((k) => BAUBLE_KINDS[k].lead === lead && BAUBLE_KINDS[k].tail === tail);
  return kind && skills.includes(key) ? { tier: tier.id, kind, key, amount } : null;
}

/** Which tier a find is: 70 in a hundred minor, 25 major and 5 ancient. */
export function rollTier(rand: () => number): BaubleTier {
  let r = rand();
  for (const t of BAUBLE_TIERS) {
    if (r < t.odds) return t.id;
    r -= t.odds;
  }
  return BAUBLE_TIERS[0].id;
}

/**
 * What a bauble of this tier and rarity turns out to give, as it will be
 * written on it: a skill and a share for a minor or a major one -- a tenth of
 * a percent at a time, `BAUBLE_LOW` to `BAUBLE_HIGH`, times its rarity -- and
 * one of `ANCIENT_EFFECTS` for an ancient one.
 */
export function rollBauble(tier: BaubleTier, rare: number | undefined, rand: () => number): string {
  const times = baubleTimes(rare);
  const pick = <T>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
  if (tier === 'ancient') return baubleText('plus', pick(ANCIENT_EFFECTS).id, ANCIENT_PLUS * times);
  const share = Math.round((BAUBLE_LOW + rand() * (BAUBLE_HIGH - BAUBLE_LOW)) * 10) / 10;
  if (tier === 'major') return baubleText('double', pick(MAJOR_SKILLS), share * times);
  const kind: BaubleKind = rand() < 0.5 ? 'time' : 'learn';
  return baubleText(kind, pick(MINOR_SKILLS), share * times);
}

/**
 * What the baubles in one settlement's sockets add up to for one kind and one
 * skill (or, for `plus`, one job): percent, to the kind's cap, or a count.
 */
export function baubleBonus(list: readonly DeedBauble[] | undefined, kind: BaubleKind, key: string): number {
  let sum = 0;
  for (const b of list ?? []) if (b.kind === kind && b.key === key) sum += b.amount;
  return kind === 'plus' ? sum : Math.min(BAUBLE_KINDS[kind].cap, sum);
}

/** What the baubles take off a job's time, as a multiplier on it. */
export const baublePace = (list: readonly DeedBauble[] | undefined, skill: string | undefined): number =>
  skill ? 1 - baubleBonus(list, 'time', skill) / 100 : 1;

/** What the baubles add to what a go teaches, as a multiplier on it. */
export const baubleLearn = (list: readonly DeedBauble[] | undefined, skill: string): number =>
  1 + baubleBonus(list, 'learn', skill) / 100;

/** Whether this go's yield comes out doubled. */
export const baubleTwice = (list: readonly DeedBauble[] | undefined, skill: string | undefined, rand: () => number): boolean => {
  const chance = skill ? baubleBonus(list, 'double', skill) : 0;
  return chance > 0 && rand() * 100 < chance;
};

/** What the baubles add to a yield of this job. */
export const baublePlus = (list: readonly DeedBauble[] | undefined, action: string | undefined): number => {
  const effect = action ? ANCIENT_EFFECTS.find((e) => e.action === action) : undefined;
  return effect ? baubleBonus(list, 'plus', effect.id) : 0;
};

/** A settlement's sockets for one tier, in order: what is in each, or nothing. */
export function socketsOf(deed: Pick<Deed, 'baubles'> | null | undefined, tier: BaubleTier): Array<DeedBauble | null> {
  const n = BAUBLE_TIER_BY_ID.get(tier)?.slots ?? 0;
  const out: Array<DeedBauble | null> = Array.from({ length: n }, () => null);
  for (const b of deed?.baubles ?? []) if (b.tier === tier && b.slot >= 0 && b.slot < n) out[b.slot] = b;
  return out;
}

/** Why a guest's work on a settlement gets nothing from its baubles: only its citizens do. */
export const baublesServe = (deed: Pick<Deed, 'role'> | null | undefined): boolean => !!deed && rankAtLeast(deed.role, 'builder');

/* ---- setting one into the altar ---------------------------------------- */

/** Why a bauble will not go into this altar, for the words both sides say. */
export const BAUBLE_SAID = {
  notAltar: 'That is not an altar.',
  reach: 'Stand at the altar.',
  notOurs: 'This altar does not stand on a settlement of yours.',
  guest: 'A guest of this settlement may not set baubles into its altar.',
  notBauble: 'That is not a bauble you can set.',
  tarnished: 'Restore it first: tarnished, it does nothing.',
  replace: 'Only its founder or a mayor may replace a bauble already set.',
} as const;
export const fullSaid = (tier: BaubleTierDef): string =>
  `All ${tier.slots} ${tier.name.toLowerCase()} sockets are filled. Choose one to replace.`;

const pieceOf = (g: Game, t: Target): PlacedFurniture | undefined => (t.kind === 'furniture' ? g.furniture.get(t.id) : undefined);
const atPiece = (g: Game, f: PlacedFurniture): boolean => {
  const [cx, cy] = furnitureCentre(f);
  return Math.hypot(cx - g.player.x, cy - g.player.y) <= 2.4;
};
/** The socket asked for: a whole number, or -1 for anything else that was sent, so it is refused rather than ignored. */
const slotOf = (t: Target): number | undefined => {
  const s = t.kind === 'furniture' ? t.slot : undefined;
  return s === undefined ? undefined : Number.isInteger(s) ? s : -1;
};

/** Why this bauble cannot go into this altar, and which socket it would go into when it can. */
export function baubleSetting(g: Game, t: Target): { why: string } | { deed: Deed; bauble: Omit<DeedBauble, 'slot' | 'rare' | 'ql'>; item: Item; slot: number } {
  const f = pieceOf(g, t);
  if (!f || !furnitureDef(f.kind).altar) return { why: BAUBLE_SAID.notAltar };
  if (!atPiece(g, f)) return { why: BAUBLE_SAID.reach };
  const deed = g.deedOfMineAt(f.x, f.y);
  if (!deed) return { why: BAUBLE_SAID.notOurs };
  if (!rankAtLeast(deed.role, 'builder')) return { why: BAUBLE_SAID.guest };
  const item = t.kind === 'furniture' && t.itemUid !== undefined ? g.inventory.get(t.itemUid) : undefined;
  if (item?.id === TARNISHED) return { why: BAUBLE_SAID.tarnished };
  const bauble = item ? readBauble(item) : null;
  if (!item || !bauble) return { why: BAUBLE_SAID.notBauble };
  const tier = BAUBLE_TIER_BY_ID.get(bauble.tier) as BaubleTierDef;
  const sockets = socketsOf(deed, tier.id);
  const asked = slotOf(t);
  if (asked !== undefined) {
    if (asked < 0 || asked >= tier.slots) return { why: BAUBLE_SAID.notBauble };
    if (sockets[asked] && !rankAtLeast(deed.role, 'mayor')) return { why: BAUBLE_SAID.replace };
    return { deed, bauble, item, slot: asked };
  }
  const free = sockets.findIndex((s) => !s);
  if (free < 0) return { why: fullSaid(tier) };
  return { deed, bauble, item, slot: free };
}

export const BAUBLE_ACTIONS: ActionDef[] = [
  {
    id: 'set_bauble',
    label: 'Set into the altar',
    verb: 'setting a bauble',
    hidden: true,
    stamina: 0.01,
    baseTime: 4,
    applies: (t) => t.kind === 'furniture',
    check: (t, g) => {
      const s = baubleSetting(g, t);
      return 'why' in s ? s.why : null;
    },
    perform: (t, g) => {
      const s = baubleSetting(g, t);
      if ('why' in s) return;
      const { deed, bauble, item, slot } = s;
      const was = socketsOf(deed, bauble.tier)[slot];
      const name = itemName(item).toLowerCase();
      if (!g.inventory.remove(item.uid, 1)) return;
      deed.baubles = [
        ...(deed.baubles ?? []).filter((b) => !(b.tier === bauble.tier && b.slot === slot)),
        { ...bauble, slot, rare: item.rare, ql: item.ql },
      ];
      const lost = was ? ` The ${baubleText(was.kind, was.key, was.amount)} that was there crumbles away.` : '';
      g.logMsg(`You set the ${name} into the altar, in ${bauble.tier} socket ${slot + 1}. Every citizen working on ${deed.name} has it now.${lost}`, 'event');
      g.events.emit('inventory');
      g.events.emit('world', deed.x, deed.y);
    },
  },
];

/** What is in a socket, as a line to read: what it gives, and its rarity when it has one. */
export const socketText = (b: DeedBauble): string => {
  const rare = baubleRareWord(b);
  return `${baubleText(b.kind, b.key, b.amount)}${rare ? ` · ${rare}` : ''}`;
};

/**
 * What a settlement's baubles add up to, one line for each thing they give,
 * in the order the kinds and the ancient jobs are listed: the total as it
 * works, and whether the cap has cut it short of what is set.
 */
export function baubleSummary(list: readonly DeedBauble[] | undefined): Array<{ text: string; capped: boolean }> {
  const out: Array<{ text: string; capped: boolean; order: number }> = [];
  const seen = new Set<string>();
  const kinds: BaubleKind[] = [...(Object.keys(BAUBLE_KINDS) as BaubleKind[]), 'plus'];
  for (const b of list ?? []) {
    const id = `${b.kind}:${b.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const worth = baubleBonus(list, b.kind, b.key);
    const raw = (list ?? []).filter((x) => x.kind === b.kind && x.key === b.key).reduce((n, x) => n + x.amount, 0);
    out.push({ text: baubleText(b.kind, b.key, worth), capped: raw > worth + 1e-9, order: kinds.indexOf(b.kind) * 1000 + (b.kind === 'plus' ? ANCIENT_EFFECTS.findIndex((e) => e.id === b.key) : 0) });
  }
  return out.sort((a, b) => a.order - b.order || a.text.localeCompare(b.text)).map(({ text, capped }) => ({ text, capped }));
}

/** A bauble as the island sends it with a settlement: its rarity as the word. */
export interface IslandBauble {
  tier: string;
  slot: number;
  kind: string;
  key: string;
  amount: number;
  rare?: string | null;
  ql?: number | null;
}

/** The island's baubles as the browser holds them; absent when it said nothing. */
export const baublesFrom = (rows: IslandBauble[] | null | undefined): DeedBauble[] | undefined =>
  rows ? rows.map((r) => ({
    tier: r.tier as BaubleTier, slot: r.slot, kind: r.kind as BaubleKind, key: r.key, amount: r.amount,
    rare: rarityStep(r.rare), ql: r.ql ?? undefined,
  })) : undefined;

/** A bauble's rarity, as a word to go before it, for the lists that print one. */
export const baubleRareWord = (b: Pick<DeedBauble, 'rare'>): string => rarityOf({ rare: b.rare }).name;
