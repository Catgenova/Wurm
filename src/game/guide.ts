/**
 * The field guide: a page for every kind of creature on the island, and which
 * of them you have seen, tamed and bred.
 *
 * Asked for: a field guide of the wildermon, one page per species, marking
 * whether you have seen, tamed and bred it, and where it lives.
 *
 * Three marks, each set by the thing it names and by nothing else:
 *
 *   seen   a creature of that kind stood where you could see it: out of a
 *          crate, on a tile in sight now, which is what the drawing means by
 *          it (`Vision.isWatched`) and so what decides whether it is drawn;
 *   tamed  you won one over, by hand or out of a trap, which is the other
 *          door to keeping one and asks the same taming;
 *   bred   a young one was born to a dam you keep.
 *
 * A kind tamed or bred has been seen, so either mark sets `seen` as well: no
 * page is ticked for taming and still drawn as a stranger.
 *
 * Alone, the book is this side's and goes in the save. On an island it is the
 * island's: a taming and a birth are written down where they happen, a
 * sighting is handed over and checked against what is standing near you, and
 * the window reads the whole book as it opens. What this side holds there is
 * what the island has said.
 *
 * Everything a page says about a kind is read off its definition and the rules
 * that definition drives, and never written out, so a page cannot promise a
 * thing the rules do not do. A kind nobody has seen yet is its shape and
 * nothing else.
 */
import { TILE_DEFS, TileType } from '../world/tiles';
import { BUTCHER_PARTS, HOARD_LUMPS, HOARD_MORE } from './butcher';
import { TACK } from './creatureActions';
import {
  GATHER_DO, GATHER_SKILL, HERD_REACH, HUNT_SIGHT, MONSTER_CAP, MONSTER_KEEP_OFF, MONSTER_SHARE, MONSTERS, NIP_EVERY,
  PULL_DEFAULT, RANGE_PER_STEP, SKILL_STEP, SPECIES, WATER_RANGE, WILD_RANGE, WILD_SPECIES, type SpeciesDef,
} from './creatures';
import { BANE_BONUS } from './gear';
import { HOARD_METALS, itemDef } from './items';
import { PEACE_REACH } from './keep';
import { defaultKey } from './keybinds';
import { MATERIALS } from './materials';
import { SKILL_BY_ID } from './skills';
import { HUNTER_TRAPPED, TIMID_TRAPPED } from './traps';
import { COMPANION_SIGHT as KEPT_EYES } from './vision';
import { WOUND_KINDS } from './wounds';
import { article, capital, listed, numberWord, percent, spanWords, times } from './words';

export type GuideMark = 'seen' | 'tamed' | 'bred';
export const GUIDE_MARKS: GuideMark[] = ['seen', 'tamed', 'bred'];
/** How each mark reads on a page and on the counts over the index. */
export const MARK_NAMES: Record<GuideMark, string> = { seen: 'Seen', tamed: 'Tamed', bred: 'Bred' };

/** The book as it is kept: the kinds under each mark, by species id. */
export interface GuideBook {
  seen: string[];
  tamed: string[];
  bred: string[];
}

/**
 * How often what is in view is looked over for a kind the book has not got,
 * in seconds. A page is not a thing that has to be turned the instant a rabba
 * steps out of the trees, and a look is one pass over the creatures near you.
 */
export const GUIDE_LOOK = 1;

/** Every kind there is a page for, in the book's order, which is the order the definitions are written in. */
export const guidePages = (): SpeciesDef[] => Object.values(SPECIES);
/** Whether a kind can be tamed and bred at all: everything but a monster. */
export const keepable = (def: SpeciesDef): boolean => !def.monster;

export class FieldGuide {
  readonly seen = new Set<string>();
  readonly tamed = new Set<string>();
  readonly bred = new Set<string>();

  /**
   * Mark a kind, and say which marks are new. Taming or breeding one marks it
   * seen as well, so the answer can hold two.
   */
  mark(species: string, what: GuideMark): GuideMark[] {
    const fresh: GuideMark[] = [];
    for (const m of what === 'seen' ? (['seen'] as const) : (['seen', what] as const)) {
      if (this[m].has(species)) continue;
      this[m].add(species);
      fresh.push(m);
    }
    return fresh;
  }

  has(species: string, what: GuideMark): boolean {
    return this[what].has(species);
  }

  /**
   * Everything another telling of the book has, added to this one.
   *
   * Added rather than put in its place: a mark is never taken off, and a
   * sighting the island answered for while the window's read was on its way
   * back is as true as anything the read says. A kind this browser has no
   * page for is left out, since there is no page to put it on.
   */
  take(book: Partial<GuideBook> | null | undefined): void {
    for (const m of GUIDE_MARKS) {
      const kinds = book?.[m];
      if (!Array.isArray(kinds)) continue;
      for (const id of kinds) if (typeof id === 'string' && SPECIES[id]) this.mark(id, m);
    }
  }

  toJSON(): GuideBook {
    return { seen: [...this.seen].sort(), tamed: [...this.tamed].sort(), bred: [...this.bred].sort() };
  }

  static fromJSON(book: Partial<GuideBook> | null | undefined): FieldGuide {
    const guide = new FieldGuide();
    guide.take(book);
    return guide;
  }
}

/** How much of the book is filled in: each mark counted over the kinds it can be set on. */
export interface GuideCounts {
  seen: number;
  tamed: number;
  bred: number;
  /** Every kind there is a page for. */
  kinds: number;
  /** And the ones that can be tamed and bred, which the monsters are not. */
  keepable: number;
}

export function guideCounts(guide: FieldGuide): GuideCounts {
  const pages = guidePages();
  const kept = pages.filter(keepable);
  return {
    seen: pages.filter((d) => guide.seen.has(d.id)).length,
    tamed: kept.filter((d) => guide.tamed.has(d.id)).length,
    bred: kept.filter((d) => guide.bred.has(d.id)).length,
    kinds: pages.length,
    keepable: kept.length,
  };
}

/** The line over the index: "Seen 12 of 40 · Tamed 3 of 36 · Bred 1 of 36". */
export function countsLine(guide: FieldGuide): string {
  const n = guideCounts(guide);
  return `${MARK_NAMES.seen} ${n.seen} of ${n.kinds} · ${MARK_NAMES.tamed} ${n.tamed} of ${n.keepable} · ${MARK_NAMES.bred} ${n.bred} of ${n.keepable}`;
}

/** What the log says the first time a kind is seen, on either side. */
export function seenLine(def: SpeciesDef, guide: FieldGuide): string {
  const n = guideCounts(guide);
  return `The first ${def.name.toLowerCase()} you have seen, ${n.seen} of the ${n.kinds} kinds there are. (Field guide, ${defaultKey('win_guide')})`;
}

/* ---- What a page says ------------------------------------------------------ */

/** "a, b or c", for a choice rather than a list. */
const either = (xs: readonly string[]): string =>
  xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;
const tileName = (t: TileType): string => TILE_DEFS[t].name.toLowerCase();
const itemName = (id: string): string => itemDef(id).name.toLowerCase();
const skillName = (id: string): string => (SKILL_BY_ID.get(id)?.name ?? id).toLowerCase();

/**
 * How often the wild's roll comes out as this kind, as a share of one: its
 * weight in the table, over the share of rolls that are wildermon at all; or,
 * for a monster, its weight among the monsters over the share that are
 * monsters. Nothing for a kind the wild never puts down.
 */
export function wildShare(def: SpeciesDef): number {
  const wild = WILD_SPECIES.find(([id]) => id === def.id)?.[1];
  if (wild !== undefined) return (wild / WILD_SPECIES.reduce((n, [, w]) => n + w, 0)) * (1 - MONSTER_SHARE);
  const bad = MONSTERS.find(([id]) => id === def.id)?.[1];
  return bad !== undefined ? (bad / MONSTERS.reduce((n, [, w]) => n + w, 0)) * MONSTER_SHARE : 0;
}

/**
 * Where a kind lives, read off the rules that put it down and keep it there:
 * the ground `Creatures.suits` asks for, what it wants within `WATER_RANGE`,
 * the hour, the home ground every wild thing keeps to, the herd a grazer
 * throws in with, how often the wild's roll is this kind, and, for a monster,
 * how far it keeps from a settlement and how many may be about at once.
 *
 * `onIsland` adds the one rule only an island has: no monster is put down on
 * the quiet beach where everybody comes ashore (`at_peace`).
 */
export function whereItLives(def: SpeciesDef, onIsland = false): string[] {
  const lines: string[] = [];
  if (def.onOre) lines.push('Put down over a vein or a coal seam, bare or buried');
  else if (def.onSand) lines.push(`Put down on ${tileName(TileType.Sand)}`);
  else if (def.onStone) lines.push(`Put down on bare ${tileName(TileType.Rock)} with no vein or seam in it`);
  else lines.push(`Put down on ${either(Object.values(TILE_DEFS).filter((t) => t.forage).map((t) => t.name.toLowerCase()))}`);
  const near: string[] = [];
  if (def.nearWater) near.push('water');
  if (def.nearTrees) near.push(`a ${tileName(TileType.Tree)}`);
  if (def.nearClay) near.push(tileName(TileType.Clay));
  if (def.nearTar) near.push(either([TileType.Tar, TileType.Peat, TileType.Marsh].map(tileName)));
  if (near.length) lines.push(`Within ${WATER_RANGE} tiles of ${listed(near)}`);
  if (def.nocturnal) lines.push('Put down only at night');
  if (def.monster) {
    lines.push(`Never within ${MONSTER_KEEP_OFF[def.id] ?? 0} tiles of a settlement's token`);
    if (onIsland) lines.push(`Never within ${PEACE_REACH} tiles of where everybody comes ashore`);
  }
  lines.push(`Keeps within ${WILD_RANGE} tiles of its home ground`);
  lines.push(def.hunter
    ? 'Alone: a hunter keeps a home ground of its own'
    : `In herds: one put down within ${HERD_REACH} tiles of another's home takes that home for its own`);
  const share = wildShare(def);
  if (share > 0) lines.push(`1 in ${Math.round(1 / share)} of what the wild puts down`);
  if (def.monster) lines.push(`No more than ${numberWord(MONSTER_CAP[def.id] ?? 1)} on the island at once`);
  return lines;
}

/** One heading of a page and what is under it. */
export interface GuideSection {
  head: string;
  lines: string[];
}

/** Winning one over: what it asks, what it takes from the hand, and how it takes to a trap. */
function taming(def: SpeciesDef): string[] {
  if (def.monster) return ['It cannot be tamed, trapped, bred or kept'];
  const lines = [
    `Taming ${def.tameLevel} to try, and at that a base ${percent(def.tameChance)} chance an offering`,
    `Takes ${either(def.diet.map(itemName))} from your hand`,
  ];
  if (def.timid) lines.push(`Walks into a trap ${times(TIMID_TRAPPED)} as readily as most`);
  else if (def.hunter) lines.push(`Walks into a trap ${percent(HUNTER_TRAPPED)} as readily as most`);
  return lines;
}

/** What one is for once it is yours: its trade, what it gives, what it carries and pulls, and what it sees. */
/**
 * What a kept one is for. Three of these rules run only in a game of your
 * own -- an island fills no hive from one, reads no panniers and has no temper
 * on it -- and a page read on an island says so rather than promising them.
 */
const SOLO_ONLY = 'In a game of your own only: ';
function keeping(def: SpeciesDef, onIsland = false): string[] {
  const solo = onIsland ? SOLO_ONLY : '';
  const lines: string[] = [];
  if (def.gathers) {
    const skill = skillName(GATHER_SKILL[def.gathers]);
    lines.push(`Set to work on a settlement it will ${GATHER_DO[def.gathers]}, learning ${skill} as it does`);
    for (const other of def.trades ?? []) {
      if (other !== def.gathers) lines.push(`Or, set to it by name, ${GATHER_DO[other]}, learning ${skillName(GATHER_SKILL[other])}`);
    }
    lines.push(`It works ${def.workRange} tiles out from where it takes its orders, and ${def.rangePerStep ?? RANGE_PER_STEP} more `
      + `for every ${SKILL_STEP} levels of ${skill}`);
  } else lines.push('No trade of its own');
  if (def.fleece) {
    const yields = def.shearYield ?? 'wool';
    lines.push(`${yields === 'feather' ? 'Plucked' : 'Shorn'} with a ${itemName('carving_knife')} for ${itemName(yields)}`);
  }
  if (def.milk) lines.push(`A female is milked into an empty ${itemName('bucket')}, for a ${itemName('milk_bucket')}`);
  if (def.fleece) {
    const grown = itemName(def.shearYield ?? 'wool');
    const what = def.milk ? `${capital(grown)} and milk come` : `Its ${grown} ${grown.endsWith('s') ? 'come' : 'comes'}`;
    lines.push(`${what} back in full in ${spanWords(1 / def.fleece)} on a grown one`);
  }
  if (def.hives) lines.push(`${solo}${solo ? 'kept' : 'Kept'} on your settlement, it fills a hive standing there with ${itemName('honey')} and ${itemName('wax')}`);
  if (def.mount) lines.push(`Carries a rider once it wears ${listed(TACK.map((id) => `${article(itemName(id))} ${itemName(id)}`))}`);
  if (def.pitch) lines.push(`Under a rider, what its climbing adds to the steepest step it takes counts ${times(def.pitch)}`);
  if (def.swims) lines.push('Carries a rider across deep water');
  if (def.draught) {
    lines.push(`In the traces it adds ${percent(def.pull ?? PULL_DEFAULT)} to a team's pull`
      + `${def.pull !== undefined && def.pull !== PULL_DEFAULT ? `, where most add ${percent(PULL_DEFAULT)}` : ''}, and learns climbing as it pulls`);
  }
  if (def.pannier) lines.push(`${solo}${solo ? 'carries' : 'Carries'} ${def.pannier} things in panniers on its own back`);
  if (def.sight) lines.push(`Sees ${def.sight} tiles for you, where most see ${KEPT_EYES}`);
  if (def.unruly) lines.push(`${solo}${solo ? 'rounds' : 'Rounds'} on whoever stands beside it: ${percent(def.unruly)} odds every ${spanWords(NIP_EVERY)}`);
  return lines;
}

/** What it is like to meet: its body, what it does when struck, what its blows leave, and what bites it hardest. */
function fighting(def: SpeciesDef): string[] {
  const lines = [`Grown: ${def.health} health, hits for ${def.attack}, ${def.speed} ${def.speed === 1 ? 'tile' : 'tiles'} a second`];
  if (def.hunter) lines.push(`${def.monster ? 'It' : 'Wild, it'} comes for you on sight from ${def.notice ?? HUNT_SIGHT} tiles off`);
  if (def.timid) lines.push('Wild, it bolts when struck');
  if (def.defensive) lines.push('Strikes back every time it is struck');
  lines.push(`Its blows leave a ${WOUND_KINDS[def.wound ?? 'bite'].name}`);
  // A light of its own, wild or kept, and the one metal that bites what carries one.
  if (def.glow) {
    lines.push(`Lights ${def.glow} tiles round itself however dark it is`);
    const bane = MATERIALS.filter((m) => m.bane).map((m) => m.name.toLowerCase());
    lines.push(`A ${either(bane)} edge hits it ${times(BANE_BONUS)} as hard`);
  }
  return lines;
}

/** What a whole carcass gives, part by part, and the one hoard on the island. */
function carcass(def: SpeciesDef): string[] {
  // Counted as the butcher's own line counts them: "3 × meat".
  const parts = BUTCHER_PARTS.filter(([p]) => (def.butcher[p] ?? 0) > 0).map(([p, id]) => `${def.butcher[p]} \u00d7 ${itemName(id)}`);
  const lines = parts.length ? [`A grown one butchered whole gives at most ${listed(parts)}`] : [];
  if (def.butcher.hoard) {
    lines.push(`And a hoard of ${HOARD_LUMPS} to ${HOARD_LUMPS + HOARD_MORE} lumps, by how much of the carcass is kept, each `
      + either(HOARD_METALS.map((id) => `${article(itemName(id))} ${itemName(id)}`)));
  }
  return lines;
}

/** A kind's whole page, under its headings, for a kind that has been seen. */
export function guidePage(def: SpeciesDef, onIsland = false): GuideSection[] {
  return [
    { head: 'Where it lives', lines: whereItLives(def, onIsland) },
    { head: def.monster ? 'Not a wildermon' : 'Taming', lines: taming(def) },
    ...(def.monster ? [] : [{ head: 'Kept', lines: keeping(def, onIsland) }]),
    { head: 'Meeting one', lines: fighting(def) },
    { head: 'Butchered', lines: carcass(def) },
  ].filter((s) => s.lines.length);
}
