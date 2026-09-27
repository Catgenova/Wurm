/**
 * Perks: what a craft trade gives, six tiers of three.
 *
 * Asked for: "We are replacing the current bonuses. Each 10 levels in the
 * primary skill of the class grants 1 skill point, for a total of 6 (class
 * starts with 1 point)", and then "Every class will have 6 tiers: level 50,
 * 60, 70, 80, 90, 100. Each tier allows one choice between 3 choices."
 *
 * So a trade in `PERK_CLASSES` has no tree. It has eighteen perks, three to a
 * tier, and at each tier its holder takes one of the three. The first tier
 * opens with the trade; the other five open at sixty to a hundred in the
 * trade's main skill (`PERK_TIER_AT`). A perk taken is taken: the way to
 * choose again is to put the trade down, which clears it, and costs what
 * putting a trade down always has -- `CLASS_CHANGE_COST` in silver, or a
 * Bauble of Regret.
 *
 * ## Which perk is in which tier
 *
 * `TIERS`, trade by trade: the three offered at each of the six tiers, by the
 * number each perk was picked under, as the tiers were swept one trade at a
 * time. Moving a perk between tiers is moving its number in that list; the
 * island clears whoever held a perk that moved, so that nobody keeps two
 * from one tier.
 *
 * ## What a perk does, as data
 *
 * Every perk is a handful of numbers in `fx`, keyed by what they change and
 * where: `time:flatten` is the time a go of Flatten takes, `ql:dig` the
 * quality of what Dig brings up. The island folds the perks somebody has
 * taken into one map on their row (`class_fold`) and every rule that a perk
 * changes reads its key off that map, with the old number as the default --
 * so a rule nobody has a perk for is exactly the rule it was.
 *
 * How two perks with the same key add up is the key's family, `FX_RULE`:
 * times and qualities multiply, a carry adds, and everything else -- a depth,
 * a reach, a chance -- is the larger of the two. The island does the same in
 * `class_fold`, and the suite holds the two folds to each other.
 *
 * ## What a perk says
 *
 * `note` is the exact benefit, in the game's own terms, and every number in it
 * is read off `fx` or off the rule it changes. It is built by a function of the
 * perk's own `fx` so that the two cannot say different things, and the
 * benefit check reads these functions as it reads any other note.
 */
import { CLASSES, PERK_CLASSES, PERK_TIER_AT, PERKS_PER_TIER } from './classes';
import {
  ACTION_BY_ID, CHIP_CHANCE, DIG_TILE_TIME, DREDGE_DEPTH, FLATTEN_STEP, MINE_COLLAPSE, MINE_DEPTH, PAN_ORES, PROSPECT_REACH,
  PROSPECT_STEP, SLOPE_FLOOR, SLOPE_PER_SKILL, SPOIL_REACH, TILE_CORNERS,
} from './actions';
import { FIND_BASE, FIND_CAP, FIND_PER_SKILL, FIND_PER_TOOL } from './archaeology';
import { BAUBLE_SHARE } from './baubles';
import { GEM_ODDS } from './gems';
import { CARRY_BASE, CARRY_PER_STRENGTH } from './game';
import { ITEM_DEFS } from './items';
import { MAP_ODDS } from './treasure';
import { ROAD_TILES, ROCK_VARIANTS, TILE_DEFS } from '../world/tiles';
import { listed, numberWord, percent, share } from './words';

/** What the perks somebody holds come to, key by key. */
export type Fx = Record<string, number>;

/**
 * How two perks' numbers for the same key add up, by the key's family: the
 * part before the colon. Anything not named here is the larger of the two.
 */
export const FX_RULE: Record<string, 'mul' | 'add'> = {
  time: 'mul', ql: 'mul', weight: 'mul', walk: 'mul', fail: 'mul', wear: 'mul',
  carry: 'add', jobs: 'add',
};

export const fxFamily = (key: string): string => key.split(':')[0];

/** Fold perks' numbers together, in the order given, by `FX_RULE`. */
export function foldFx(list: readonly Fx[]): Fx {
  const out: Fx = {};
  for (const fx of list) {
    for (const [k, v] of Object.entries(fx)) {
      const rule = FX_RULE[fxFamily(k)];
      if (!(k in out)) out[k] = v;
      else if (rule === 'mul') out[k] *= v;
      else if (rule === 'add') out[k] += v;
      else out[k] = Math.max(out[k], v);
    }
  }
  return out;
}

export interface PerkDef {
  /** `<class>_<name>`, which is what the island keeps. */
  id: string;
  class: string;
  /** The number it was offered under, which is the number it was picked by. */
  num: number;
  name: string;
  /** One to six. */
  tier: number;
  fx: Fx;
  note: string;
}

/** A perk as it is written: its note is made from its own numbers. */
interface Seed {
  num: number;
  name: string;
  fx: Fx;
  note: (fx: Fx) => string;
}

/** "1 in 200", from a chance of 0.005. */
const oneIn = (p: number): string => `1 in ${Math.round(1 / p)}`;
/** "35%" off, from a multiplier of 0.65. */
const less = (m: number): string => percent(1 - m);
/** "+10%" on, from a multiplier of 1.1. */
const more = (m: number): string => `+${percent(m - 1)}`;
const secs = (s: number): string => `${Number(s.toFixed(1))} s`;
const base = (id: string): number => ACTION_BY_ID.get(id)?.baseTime ?? 0;
const diff = (id: string): number => ACTION_BY_ID.get(id)?.difficulty ?? 0;
const kg = (id: string): number => ITEM_DEFS[id]?.weight ?? 0;
/** "15 percentage points", from 0.15 added to a chance. */
const points = (x: number): string => `${Math.round(x * 100)} percentage points`;
/** "a, b or c". */
const either = (xs: readonly string[]): string =>
  xs.length > 1 ? `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}` : (xs[0] ?? '');
const itemName = (id: string): string => (ITEM_DEFS[id]?.name ?? id).toLowerCase();

/*
 * ---------------------------------------------------------------------------
 * The Terraformer: digging and paving.
 * ---------------------------------------------------------------------------
 */
const TERRAFORMER: Seed[] = [
  {
    num: 5, name: 'Clean Earth',
    fx: { 'ql:dig': 1.1, 'ql:dredge': 1.1, 'ql:collect': 1.1, 'ql:flatten': 1.1 },
    note: (fx) => `Dirt, sand, clay, peat and tar you dig, dredge, collect or flatten off come up at ${more(fx['ql:dig'])} QL.`,
  },
  {
    num: 6, name: 'Rare Earth',
    fx: { 'rare:dig': 0.01, 'rare:dredge': 0.01, 'rare:collect': 0.01 },
    note: (fx) => `${oneIn(fx['rare:dig'])} goes of Dig, Dredge and Collect bring the material up rare, `
      + 'rolling on to supreme and fantastic at the odds crafting has. Nothing gathered is rare without it.',
  },
  {
    num: 9, name: 'Level Hand',
    fx: { 'flatten:step': 2 },
    note: (fx) => `Flatten moves ${numberWord(fx['flatten:step'])} height units a go (now ${numberWord(FLATTEN_STEP)}).`,
  },
  {
    num: 10, name: 'Quick Level',
    fx: { 'time:flatten': 0.65 },
    note: (fx) => `Flatten takes ${less(fx['time:flatten'])} less time a go (${secs(base('flatten'))} base).`,
  },
  {
    num: 12, name: 'Steep Cut',
    fx: { 'slope:digging': 4 },
    note: (fx) => `The steepest slope Dig, Drop dirt and Dredge may leave is ${numberWord(fx['slope:digging'])} times your digging `
      + `(now ${numberWord(SLOPE_PER_SKILL)} times, and never under ${SLOPE_FLOOR}).`,
  },
  {
    num: 14, name: 'Wader',
    fx: { 'depth:dig': 20 },
    note: (fx) => `Dig and Flatten work in water up to ${fx['depth:dig']} deep (now ${MINE_DEPTH}).`,
  },
  {
    num: 15, name: 'Dredger',
    fx: { 'depth:dredge': 60, 'time:dredge': 0.8 },
    note: (fx) => `Dredge reaches bottoms up to ${fx['depth:dredge']} deep (now ${DREDGE_DEPTH}) `
      + `and takes ${less(fx['time:dredge'])} less time a go.`,
  },
  {
    num: 17, name: 'Bed Worker',
    fx: { 'time:collect': 0.7 },
    note: (fx) => `Collect takes ${less(fx['time:collect'])} less time a go (${secs(base('collect'))} base).`,
  },
  {
    num: 20, name: 'Treasure Nose',
    fx: { 'map:dig': 1 / 200, 'map:dig_tile': 1 / 200 },
    note: (fx) => `Digging turns up a treasure map in ${oneIn(fx['map:dig'])} goes (now ${oneIn(MAP_ODDS)}).`,
  },
  {
    num: 23, name: 'Stump Puller',
    fx: { 'time:dig_stump': 0.5, 'stump:log': 1 },
    note: (fx) => `Dig out the stump takes ${less(fx['time:dig_stump'])} less time, `
      + `and gives ${numberWord(fx['stump:log'])} log of the tree's kind (now nothing).`,
  },
  {
    num: 25, name: 'Quick Paver',
    fx: { 'time:pack': 0.65, 'time:pave_cobble': 0.65, 'time:pave_slabs': 0.65 },
    note: (fx) => `Pack, Pave (cobblestone) and Pave (slabs) take ${less(fx['time:pack'])} less time a go.`,
  },
  {
    num: 26, name: 'Bed True',
    fx: { 'fail:pave_slabs': 0 },
    note: () => `Pave (slabs) never fails (now a check at difficulty ${diff('pave_slabs')} against the slab's QL).`,
  },
  {
    num: 27, name: 'Frugal Cobbler',
    fx: { 'keep:pave_cobble': 1 / 3 },
    note: (fx) => `${oneIn(fx['keep:pave_cobble'])} goes of Pave (cobblestone) use no stone brick.`,
  },
  {
    num: 29, name: 'Road Legs',
    fx: { 'walk:road': 1.15 },
    note: (fx) => `You walk ${percent(fx['walk:road'] - 1)} faster on `
      + `${listed(ROAD_TILES.map((t) => TILE_DEFS[t].name.toLowerCase()))}.`,
  },
  {
    num: 32, name: 'Soil Porter',
    fx: { 'weight:dirt': 0.5, 'weight:sand': 0.5, 'weight:clay': 0.5 },
    note: (fx) => `Dirt, sand and clay weigh ${kg('dirt') * fx['weight:dirt']} kg a unit in your pack (now ${kg('dirt')} kg).`,
  },
  {
    num: 33, name: 'Strong Back',
    fx: { carry: 40 },
    note: (fx) => `You carry ${fx.carry} kg more before the load slows you `
      + `(now ${CARRY_BASE} kg, and ${CARRY_PER_STRENGTH} more for every level of body strength).`,
  },
  {
    num: 34, name: 'Long Reach',
    fx: { 'reach:soil': 5 },
    note: (fx) => `Drop dirt and Flatten take soil from carts and containers within ${fx['reach:soil']} tiles `
      + `(now ${SPOIL_REACH}), and what you dig goes into the nearest unlocked cart or wagon within ${fx['reach:soil']} tiles `
      + 'that nobody else is pulling or driving (now into your pack).',
  },
  {
    num: 44, name: 'Dig Out the Tile',
    fx: { dig_tile: 1 },
    note: () => `A new job, Dig out the tile: all ${numberWord(TILE_CORNERS)} corners of a tile come down by one in a single go `
      + `of ${secs(DIG_TILE_TIME)} base (${numberWord(TILE_CORNERS)} digs take ${secs(TILE_CORNERS * base('dig'))}), `
      + `and it gives ${numberWord(TILE_CORNERS)} of the material.`,
  },
];

/*
 * ---------------------------------------------------------------------------
 * The Miner: the face, the seam, and what else is in the ground.
 * ---------------------------------------------------------------------------
 */
/** The veins an ore comes out of, from the least mining they want to the most. */
const ORES = ROCK_VARIANTS.filter((r) => r.yields.endsWith('_ore'))
  .map((r) => ({ yields: r.yields, level: r.level ?? 0 })).sort((a, b) => a.level - b.level);
const oreName = (yields: string): string => itemName(yields).replace(/ ore$/, '');
/** Each ore with the mining it would want of somebody `below` short of it: "gold at 40". */
const oresAt = (below: number): string => {
  const any = ORES.filter((o) => o.level - below <= 0).map((o) => oreName(o.yields));
  const rest = ORES.filter((o) => o.level - below > 0).map((o) => `${oreName(o.yields)} at ${o.level - below}`);
  return listed([...(any.length ? [`${listed(any)} at any mining`] : []), ...rest]);
};

const MINER: Seed[] = [
  {
    num: 1, name: 'Quick Pick',
    fx: { 'time:mine': 0.75 },
    note: (fx) => `Mine takes ${less(fx['time:mine'])} less time a go (${secs(base('mine'))} base).`,
  },
  {
    num: 2, name: 'Rich Seam',
    fx: { 'more:mine': 0.15 },
    note: (fx) => `${percent(fx['more:mine'])} of goes of Mine bring up one more of what they bring up.`,
  },
  {
    num: 3, name: 'Sure Swing',
    fx: { 'fail:mine': 0.5 },
    note: (fx) => `Mine fails ${share(fx['fail:mine'])} as often (now a check at difficulty ${diff('mine')}, with the pickaxe's QL).`,
  },
  {
    num: 6, name: 'Rare Ore',
    fx: { 'rare:mine': 0.01 },
    note: (fx) => `${oneIn(fx['rare:mine'])} goes of Mine bring what they bring up rare, `
      + 'rolling on to supreme and fantastic at the odds crafting has. Nothing mined is rare without it.',
  },
  {
    num: 7, name: 'Ore Sense',
    fx: { 'ore:below': 10 },
    note: (fx) => `Mine and Chip corner work every ore at ${fx['ore:below']} less mining than it wants: ${oresAt(fx['ore:below'])} `
      + `(now ${oresAt(0)}).`,
  },
  {
    num: 8, name: 'Coal Hand',
    fx: { 'count:coal': 2 },
    note: (fx) => `Mine on a coal seam brings up ${numberWord(fx['count:coal'])} coal a go (now one).`,
  },
  {
    num: 9, name: 'Chipper',
    fx: { 'chip:chance': 0.5 },
    note: (fx) => `Chip corner takes the corner down in ${oneIn(fx['chip:chance'])} goes (now ${oneIn(CHIP_CHANCE)}).`,
  },
  {
    num: 11, name: 'Face Shaper',
    fx: { 'chip:step': 2 },
    note: (fx) => `When Chip corner takes the corner down, it drops ${numberWord(fx['chip:step'])} steps (now one), `
      + 'but never past a level you have taken.',
  },
  {
    num: 13, name: 'Rock Slide',
    fx: { 'slide:more': 3 },
    note: (fx) => `When the face drops of its own accord as you mine (${oneIn(MINE_COLLAPSE)} goes), `
      + `${numberWord(fx['slide:more'])} more of what you are mining come down with it.`,
  },
  {
    num: 14, name: 'Wet Work',
    fx: { 'depth:mine': 20 },
    note: (fx) => `Mine and Chip corner work in water up to ${fx['depth:mine']} deep (now ${MINE_DEPTH}).`,
  },
  {
    num: 15, name: 'Gem Eye',
    fx: { 'gem:mine': 1 / 150 },
    note: (fx) => `Mine turns up a gem in ${oneIn(fx['gem:mine'])} goes (now ${oneIn(GEM_ODDS)}).`,
  },
  {
    num: 17, name: 'Treasure in the Rock',
    fx: { 'map:mine': 1 / 200 },
    note: (fx) => `Mine turns up a treasure map in ${oneIn(fx['map:mine'])} goes (now ${oneIn(MAP_ODDS)}).`,
  },
  {
    num: 19, name: 'Far Reader',
    fx: { 'further:prospect': 3 },
    note: (fx) => `Prospect reads ${numberWord(fx['further:prospect'])} tiles further `
      + `(now ${numberWord(PROSPECT_REACH)}, and one more for every ${PROSPECT_STEP} prospecting).`,
  },
  {
    num: 25, name: 'Keen Trowel',
    fx: { 'find:investigate': 0.15, 'cap:investigate': 0.85 },
    note: (fx) => `Investigate finds something ${points(fx['find:investigate'])} more often, up to ${percent(fx['cap:investigate'])} `
      + `(now ${percent(FIND_BASE)}, plus ${percent(FIND_PER_SKILL)} of your archaeology and ${percent(FIND_PER_TOOL)} `
      + `of the trowel's QL, at most ${percent(FIND_CAP)}).`,
  },
  {
    num: 27, name: 'Pieces that Fit',
    fx: { 'fit:relic': 0.5 },
    note: (fx) => `While you hold pieces of a relic that is not yet whole, ${share(fx['fit:relic'])} of the relic pieces `
      + 'Investigate turns up are a piece you are missing of one of those.',
  },
  {
    num: 28, name: 'Bauble Hunter',
    fx: { 'share:bauble': 0.4 },
    note: (fx) => `${percent(fx['share:bauble'])} of what Investigate finds is a tarnished bauble (now ${percent(BAUBLE_SHARE)}).`,
  },
  {
    num: 35, name: 'Ore Cart',
    fx: { 'into:mine': 5 },
    note: (fx) => `What Mine brings up goes into the nearest unlocked cart or wagon that nobody else is pulling or driving, `
      + `or container you built or that stands on your settlement, within ${fx['into:mine']} tiles (now into your pack).`,
  },
  {
    num: 50, name: 'Pan',
    fx: { pan: 1 / 8 },
    note: (fx) => `A new job, Pan, on sand with water at one of its corners: ${oneIn(fx.pan)} goes give `
      + `${either(PAN_ORES.map(itemName))}, each as likely, at a QL set by your prospecting.`,
  },
];

/** Every trade's perks, in the order they were picked. */
const SEEDS: Record<string, Seed[]> = {
  terraformer: TERRAFORMER,
  miner: MINER,
};

const slug = (name: string): string => name.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Every perk there is, three to a tier in the order they were picked. */
/**
 * The perks each tier offers, lowest tier first, by the number each was picked
 * under. Every trade with perks has its six rows of three here.
 */
export const TIERS: Record<string, number[][]> = {
  terraformer: [[10, 17, 25], [9, 14, 23], [15, 12, 26], [32, 29, 27], [33, 34, 44], [5, 6, 20]],
  miner: [[7, 8, 9], [14, 13, 19], [1, 2, 25], [3, 27, 35], [28, 15, 11], [50, 17, 6]],
};

/** Every perk there is, tier by tier, and in each tier by the number it was picked under, as the island lists them. */
export const PERKS: PerkDef[] = Object.entries(SEEDS).flatMap(([cls, seeds]) =>
  (TIERS[cls] ?? []).flatMap((nums, t) => [...nums].sort((a, b) => a - b).map((num) => {
    const s = seeds.find((x) => x.num === num);
    if (!s) throw new Error(`${cls}'s tier ${t + 1} offers ${num}, and there is no such perk`);
    return {
      id: `${cls}_${slug(s.name)}`,
      class: cls,
      num: s.num,
      name: s.name,
      tier: t + 1,
      fx: s.fx,
      note: s.note(s.fx),
    };
  })));

export const PERK_BY_ID = new Map(PERKS.map((p) => [p.id, p]));
export const perksOf = (cls: string): PerkDef[] => PERKS.filter((p) => p.class === cls);

/** The skill a tier opens at. The first opens with the trade itself. */
export const tierAt = (tier: number): number => PERK_TIER_AT[tier - 1];

/** What a set of taken perks comes to. */
export const foldPerks = (taken: readonly string[]): Fx =>
  foldFx(taken.map((id) => PERK_BY_ID.get(id)).filter((p): p is PerkDef => !!p).map((p) => p.fx));

/**
 * Why a perk cannot be taken, or nothing.
 *
 * The same refusals the island builds in `perk_refusal`, in the same order and
 * the same words, which the suite asks the two of them to agree on: it is not
 * your trade's, you have it, you took another at that tier, or the tier is not
 * open yet.
 */
export function perkRefusal(p: PerkDef, mine: string | null, taken: readonly string[], main: number): string | null {
  if (p.class !== mine) {
    return `That is the ${(CLASSES.find((c) => c.id === p.class)?.name ?? p.class).toLowerCase()}’s, and you are not one.`;
  }
  if (taken.includes(p.id)) return 'You have that already.';
  const other = taken.map((id) => PERK_BY_ID.get(id)).find((o) => o && o.class === p.class && o.tier === p.tier);
  if (other) return `You took ${other.name} at this tier.`;
  if (p.tier > 1 && main < tierAt(p.tier)) {
    const c = CLASSES.find((x) => x.id === p.class);
    return `This tier opens at ${tierAt(p.tier)} in ${(c?.main ?? '').replace(/_/g, ' ')}; you have ${Math.floor(main)}.`;
  }
  return null;
}

// Every trade moved over has its full eighteen, three to each of six tiers, and
// every trade with perks has been moved over: a card is never offered with a
// tier missing, nor a trade half moved.
for (const cls of PERK_CLASSES) {
  const n = perksOf(cls).length;
  if (n !== PERK_TIER_AT.length * PERKS_PER_TIER) throw new Error(`${cls} has ${n} perks`);
  // Every perk offered at exactly one tier, and every tier offering its three.
  const rows = TIERS[cls] ?? [];
  if (rows.length !== PERK_TIER_AT.length || rows.some((r) => r.length !== PERKS_PER_TIER)) {
    throw new Error(`${cls} does not have ${PERK_TIER_AT.length} tiers of ${PERKS_PER_TIER}`);
  }
  if (new Set(rows.flat()).size !== n || (SEEDS[cls] ?? []).some((s) => !rows.flat().includes(s.num))) {
    throw new Error(`${cls} offers a perk at two tiers, or one at none`);
  }
}
for (const cls of Object.keys(SEEDS)) {
  if (!PERK_CLASSES.has(cls)) throw new Error(`${cls} has perks but still has its tree`);
}
