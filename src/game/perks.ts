/**
 * Perks: what a craft trade gives, six tiers of three.
 *
 * Asked for: "We are replacing the current bonuses. Each 10 levels in the
 * primary skill of the class grants 1 skill point, for a total of 6 (class
 * starts with 1 point)", and then "Every class will have 6 tiers: level 50,
 * 60, 70, 80, 90, 100. Each tier allows one choice between 3 choices." The
 * sixth has opened at 99 since: "Change tier 6 class perks from requiring
 * level 100 to requiring 99."
 *
 * So a trade in `PERK_CLASSES` has no tree. It has eighteen perks, three to a
 * tier, and at each tier its holder takes one of the three. The first tier
 * opens with the trade; the other five open at sixty to ninety-nine in the
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
  ACTION_BY_ID, CHIP_CHANCE, CLEARED_TO, DIG_TILE_TIME, DREDGE_DEPTH, FLATTEN_STEP, GRASS_PER_CUT, MINE_COLLAPSE, MINE_DEPTH, PAN_ORES,
  PLANTED_AGE, plantedAge, PROSPECT_REACH, PROSPECT_STEP, REED_CUT, REED_EXTRA_AT, RESIN_TREE, SLOPE_FLOOR, SLOPE_PER_SKILL, SPOIL_REACH,
  TILE_CORNERS, KIT_MEND, repairGo, GLAZE_ASH, GLAZEABLE,
} from './actions';
import {
  FIND_BASE, FIND_CAP, FIND_PER_SKILL, FIND_PER_TOOL, RESTORE_AGE, RESTORE_HARM, RESTORE_HARM_SPREAD, STUDY_WEAR, STUDY_WEAR_SPREAD,
} from './archaeology';
import { BAUBLE_HIGH, BAUBLE_LOW, BAUBLE_SHARE, BAUBLE_TIERS } from './baubles';
import { BRIDGES } from './bridges';
import { BUILD_ACTION_BY_ID, REPOINT_BACK } from './buildActions';
import { FENCE_TYPES, MATERIAL_BY_ID, MATERIALS, MAX_LEVELS, storeySkill, TALL_STOREYS, wallBill } from './building';
import { BUCKET_LITRES, FURNITURE, furnitureDef } from './furniture';
import { ARMOUR, ARMOUR_BY_ID, ARMOUR_CLASSES, HIT_CAP, SOAK_CAP, WEAPON_BY_ID, WEAPONS } from './gear';
import { CIRCLET_SHARE, CIRCLET_STONES, GEM_ODDS, GEMS, JEWEL_BONUS, tradeName } from './gems';
import {
  CARRY_BASE, CARRY_PER_STRENGTH, CHAR_START, goSeconds, MAX_MOUNT_SPEED, MAX_VEHICLE_SPEED, QL_TOP, QUEUE_PER_MIND, queueCapAt, TOOL_QL_SPAN,
} from './game';
import { CROP_LIST, cropYield, RIPE, type CropDef } from './farming';
import { IMPROVE_FLOOR, improveStepAt } from './improve';
import { POST_LIFE_MAX, POST_LIFE_MIN } from './posts';
import { billWords, countOf, ITEM_DEFS, RARITY_ODDS, type Item } from './items';
import { MELT_KEEP, MELT_SHARE, meltLumps } from './melt';
import {
  castWhole, COIN_DIFFICULTY, FORGE_WORK, INGOT_LUMPS, INGOT_WEIGHT, METALS, MOULD_BY_ID, MOULD_BY_MAKES, MOULD_DENT, mouldLumps, MOULDS,
  mouldUsesLeft,
} from './metal';
import { MAP_ODDS } from './treasure';
import { CRAFT_REACH, DISTIL_BUCKETS, isDish, RECIPES, TAILOR_SKILLS, TRADE_BOOK_AT, TRADE_BOOK_SKILLS, type Recipe } from './recipes';
import { BUSH_DEFS, ROAD_TILES, ROCK_VARIANTS, TILE_DEFS, TileType, TREE_AGES, TREE_DAWN_UTC, TREE_DEFS } from '../world/tiles';
import { walkKey } from './player';
import { article, capital, listed, numberWord, percent, share, spanWords, times } from './words';
import { helpingOf, NUTRIENTS, TABLE_BEST } from './nutrition';
import { BREWS } from './brewing';
import { boonTime, TINCTURE_BONUS, TINCTURE_SECONDS } from './boons';
import { EMPTY_CHANCE, PER_ROLL } from './forage';
import { DRESS_CHECK } from './firstaid';
import { TINCTURE_NAMES } from './remedies';
import { FESTER_CLOTH, FESTER_WRONG } from './wounds';
import { BAIT_BY_ID, BAIT_PULL, BAITS, biteShare, CAST, FISH, HOOK_BAIT, HOOK_MOST, NET_HAUL, NET_LEAST, NET_REACH } from './fishing';
import { POND_EVERY } from './furniture';
import { TRAPS } from './traps';
import { BUTCHER_BAIT } from './butcher';
import { SHEAR_FROM, SHEAR_WOOL, TAME_MOST } from './creatureActions';
import { AGES, BREED_REST, CARE_BONUS, CARE_HOURS, COAX_STEP, GESTATION, HUNGER_RATE, OLD_AT } from './creatures';
import { GROOM_HEAL, groomGain } from './husbandry';
import { inheritChance, TRAIT_SLOTS, upgradeChance } from './traits';

/** What the perks somebody holds come to, key by key. */
export type Fx = Record<string, number>;

/**
 * How two perks' numbers for the same key add up, by the key's family: the
 * part before the colon. Anything not named here is the larger of the two.
 */
export const FX_RULE: Record<string, 'mul' | 'add'> = {
  time: 'mul', ql: 'mul', weight: 'mul', walk: 'mul', fail: 'mul', wear: 'mul', need: 'mul', bill: 'mul',
  grow: 'mul', rotate: 'mul', feed: 'mul', fill: 'mul', knack: 'mul', rot: 'mul', cool: 'mul', catch: 'mul', empty: 'mul', mend: 'mul',
  bite: 'mul', cost: 'mul', worn: 'mul', life: 'mul', harm: 'mul', age: 'mul',
  bright: 'mul', thrift: 'mul', force: 'mul', keeps: 'mul', teach: 'mul', sturdy: 'mul',
  carry: 'add', serve: 'add', jobs: 'add', plus: 'add', bumper: 'add', fodder: 'add', tool: 'add', passes: 'add', hook: 'add', haul: 'add',
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
    note: (fx) => `Mine, Chip corner and Mine out the cellar work every ore at ${fx['ore:below']} less mining than it wants: ${oresAt(fx['ore:below'])} `
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

/*
 * ---------------------------------------------------------------------------
 * The Mason: the chisel, the trowel, and the rock under both.
 * ---------------------------------------------------------------------------
 */
/** Everything cut with a chisel: the bricks, the slabs, the whetstone and the quern. */
const STONECUTTING = RECIPES.filter((r) => r.skill === 'stonecutting');
/** The bricks a shard or a block is chiselled into, a few at a go. */
const CHISELLED = STONECUTTING.filter((r) => r.result.endsWith('_brick'));
/** What comes off the chisel as bricks and slabs, which Brick Porter lightens. */
const CUT_STONE = [...new Set(STONECUTTING.map((r) => r.result).filter((id) => /_(brick|slab)$/.test(id)))];
/** The masonry a failed go pulls down with its materials in it. */
const LOST_ON_FAIL = RECIPES.filter((r) => r.skill === 'masonry' && r.consumeOnFail);
/** What a building is made of that is not stone: the timber a Mason's perks leave as they find it. */
const TIMBER = MATERIALS.filter((m) => m.kind !== 'stone').map((m) => m.name.toLowerCase());
const STONE_WORK = `stone, anything but ${either(TIMBER)}`;
/** "6–16", or "8" where they are all one. */
const range = (xs: readonly number[]): string => {
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return lo === hi ? `${lo}` : `${lo}–${hi}`;
};
/** The same number on every one of a list of keys. */
const each = (keys: readonly string[], v: number): Fx => Object.fromEntries(keys.map((k) => [k, v]));
/** "bricks, whetstones, querns and slabs": what a run of recipes makes, by the last word of each. */
const kinds = (rs: readonly Recipe[]): string =>
  listed([...new Set(rs.map((r) => `${itemName(r.result).split(' ').pop()}s`))]);
/** "stone, slate, marble or sandstone": the stone of each brick, without the brick. */
const stonesOf = (ids: readonly string[]): string[] => ids.map((id) => itemName(id).replace(/ (brick|slab)$/, ''));
/** A bill in words: "24 stone bricks and 12 mortar". */
const billOf = (bill: ReadonlyArray<readonly [string, number]>): string =>
  listed(bill.map(([id, n]) => `${n} ${n === 1 ? itemName(id) : plural(itemName(id))}`));
const plural = (name: string): string =>
  (/(s|mortar|ash)$/.test(name) ? name : /(kni|shel)fe?$/.test(name) ? name.replace(/fe?$/, 'ves') : `${name}s`);
/** What each stone stands now, tallest first: "stone brick, marble, ornate silver and ornate gold 10, slate 8". */
const standsNow = (): string => {
  const by = new Map<number, string[]>();
  for (const m of MATERIALS.filter((x) => x.kind === 'stone')) by.set(m.storeys, [...(by.get(m.storeys) ?? []), m.name.toLowerCase()]);
  return [...by].sort((a, b) => b[0] - a[0]).map(([n, names]) => `${listed(names)} ${n}`).join(', ');
};
const STONE_BRICK_WALL = MATERIAL_BY_ID.get('stone_brick')!;
const CONCRETE = RECIPES.find((r) => r.result === 'concrete')!;

const MASON: Seed[] = [
  {
    num: 1, name: 'Quick Chisel',
    fx: each(STONECUTTING.map((r) => `time:${r.id}`), 0.75),
    note: (fx) => `Stonecutting takes ${less(fx[`time:${STONECUTTING[0].id}`])} less time a go: ${kinds(STONECUTTING)} `
      + `(now ${range(STONECUTTING.map((r) => r.baseTime))} s base).`,
  },
  {
    num: 2, name: 'Three from a Shard',
    fx: each(CHISELLED.map((r) => `count:${r.result}`), 3),
    note: (fx) => `Chiselling a brick of ${either(stonesOf(CHISELLED.map((r) => r.result)))} makes `
      + `${numberWord(fx[`count:${CHISELLED[0].result}`])} at a go (now ${numberWord(CHISELLED[0].count ?? 1)}).`,
  },
  {
    num: 4, name: 'Sure Chisel',
    fx: each(STONECUTTING.map((r) => `fail:${r.id}`), 0.5),
    note: (fx) => `Stonecutting fails ${share(fx[`fail:${STONECUTTING[0].id}`])} as often `
      + `(now a check at difficulty ${range(STONECUTTING.map((r) => r.difficulty ?? 0))}).`,
  },
  {
    num: 8, name: 'Quick Mason',
    fx: { 'time:build_stone': 0.7 },
    note: (fx) => `Build wall and Build floor take ${less(fx['time:build_stone'])} less time a go on ${STONE_WORK} `
      + `(${secs(base('build_wall'))} base).`,
  },
  {
    num: 9, name: 'Two at a Time',
    fx: { 'lay:build_stone': 2 },
    note: (fx) => `Build wall and Build floor lay ${numberWord(fx['lay:build_stone'])} units a go on ${STONE_WORK}, when you have them `
      + `(now one; a stone-brick wall is ${billOf(STONE_BRICK_WALL.bill)}).`,
  },
  {
    num: 12, name: 'Tall Walls',
    fx: { 'storeys:build_stone': TALL_STOREYS },
    note: (fx) => `Every stone in a building you planned stands ${numberWord(fx['storeys:build_stone'])} storeys taller, `
      + `up to ${MAX_LEVELS + fx['storeys:build_stone']} (now ${standsNow()}, and ${MAX_LEVELS} at most). `
      + `Timber stands no taller, and a building stops at the shortest thing in it. `
      + `Every storey past the ${numberWord(MAX_LEVELS)}th takes masonry ${storeySkill(MAX_LEVELS)} in the storey below.`,
  },
  {
    num: 16, name: 'Salvage',
    fx: { 'salvage:build_stone': 0.5 },
    note: (fx) => `Remove wall gives back ${share(fx['salvage:build_stone'])} the stone laid in a wall of ${STONE_WORK}, `
      + `rounded down: ${Math.floor(STONE_BRICK_WALL.bill[0][1] * fx['salvage:build_stone'])} of a stone-brick wall's `
      + `${STONE_BRICK_WALL.bill[0][1]} stone bricks (now none).`,
  },
  {
    num: 17, name: 'Concrete Hand',
    fx: { 'fail:raise_rock': 0 },
    note: () => `Raise the rock with concrete never fails (now a check at difficulty ${diff('raise_rock')}, `
      + 'and the concrete is lost when it does).',
  },
  {
    num: 18, name: 'Double Lift',
    fx: { 'lift:raise_rock': 2 },
    note: (fx) => `Raise the rock with concrete lifts the corner ${numberWord(fx['lift:raise_rock'])} steps for one concrete `
      + '(now one), where the slope you may leave and your level allow it; where they do not, one.',
  },
  {
    num: 19, name: 'Steep Stone',
    fx: { 'slope:masonry': 4 },
    note: (fx) => `The steepest slope raising rock may leave is ${numberWord(fx['slope:masonry'])} times your masonry `
      + `(now ${numberWord(SLOPE_PER_SKILL)} times, and never under ${SLOPE_FLOOR}).`,
  },
  {
    num: 20, name: 'Good Mix',
    fx: { 'count:concrete': 2 },
    note: (fx) => `Mix concrete makes ${numberWord(fx['count:concrete'])} concrete out of the same `
      + `${listed(CONCRETE.inputs.map((i) => itemName(i.item)))} (now ${numberWord(CONCRETE.count ?? 1)}).`,
  },
  {
    num: 22, name: 'Wet Set',
    fx: { 'depth:raise_rock': 10 },
    note: (fx) => `Raising rock works on rock under water up to ${fx['depth:raise_rock']} deep (now only above the water).`,
  },
  {
    num: 24, name: 'Nothing Wasted',
    fx: each(LOST_ON_FAIL.map((r) => `spare:${r.id}`), 1),
    note: () => `A failed ${either(LOST_ON_FAIL.map((r) => itemName(r.result)))} keeps its materials (now they are lost).`,
  },
  {
    num: 29, name: 'Bridge Mason',
    fx: { 'time:bridge_stone': 0.7, 'span:bridge_stone': 10 },
    note: (fx) => `Work on a ${BRIDGES.stone.name.toLowerCase()} takes ${less(fx['time:bridge_stone'])} less time a go `
      + `(${secs(base('build_bridge'))} base), and one spans ${fx['span:bridge_stone']} tiles (now ${BRIDGES.stone.span}).`,
  },
  {
    num: 33, name: 'Brick Porter',
    fx: each(CUT_STONE.map((id) => `weight:${id}`), 0.5),
    note: (fx) => `Bricks and slabs of ${either([...new Set(stonesOf(CUT_STONE))])} weigh ${share(fx[`weight:${CUT_STONE[0]}`])} `
      + `as much in your pack: a brick ${kg('stone_brick') * fx['weight:stone_brick']} kg and a slab `
      + `${kg('stone_slab') * fx['weight:stone_slab']} kg (now ${kg('stone_brick')} and ${kg('stone_slab')}).`,
  },
  {
    num: 35, name: 'Hod Carrier',
    fx: { 'reach:build_stone': 5 },
    note: (fx) => `Build wall and Build floor on ${STONE_WORK}, also take from crates, carts and containers within `
      + `${fx['reach:build_stone']} tiles that a craft may take from (now only your pack and a crate on the tile).`,
  },
  {
    num: 47, name: 'Repoint',
    fx: { repoint: 1 },
    note: () => `A new job, Repoint, on a finished wall of ${STONE_WORK}: it is laid again in another stone in one go of `
      + `${secs(BUILD_ACTION_BY_ID.get('repoint_wall')?.baseTime ?? 0)} base. You pay the new stone's whole bill and get `
      + `${share(REPOINT_BACK)} the old stone back, rounded down.`,
  },
  {
    num: 48, name: 'Rubble Fill',
    fx: { rubble: 5 },
    note: (fx) => `A new job, Raise the rock with rubble: a corner of bare rock rises a step for ${numberWord(fx.rubble)} rock shards `
      + `instead of a concrete, under the same rules as concrete and the same check at difficulty ${diff('raise_rock')}.`,
  },
];

/*
 * ---------------------------------------------------------------------------
 * The Carpenter: the saw, the bench, the hull and the bow.
 * ---------------------------------------------------------------------------
 */
const recipeOf = (id: string): Recipe => {
  const r = RECIPES.find((x) => x.id === id);
  if (!r) throw new Error(`no recipe ${id}`);
  return r;
};
/** What a log is sawn or carved into, a go at a time. */
const SAWN = ['make_planks', 'make_timbers', 'make_shafts'].map(recipeOf);
const PLANKS = recipeOf('make_planks');
const TIMBERS = recipeOf('make_timbers');
const THATCH = recipeOf('make_thatch');
const BOWSTRING = recipeOf('make_bow_string');
/** A piece of furniture's recipe, by the piece. */
const pieceRecipe = (id: string): Recipe => recipeOf(`make_${id}`);
/** Every piece of furniture made of wood at the bench: its recipe is carpentry or fine carpentry. */
const JOINERY = FURNITURE.filter((f) => RECIPES.some((r) => r.result === f.id && (r.skill === 'carpentry' || r.skill === 'fine_carpentry')))
  .map((f) => pieceRecipe(f.id));
/** The storage Deep Drawers deepen: the chests, cupboards, barrels, bins, shelves, wardrobes and larders. */
const DRAWERS = ['chest', 'coffer', 'cupboard', 'wardrobe', 'shelves', 'bookshelf', 'larder',
  'small_barrel', 'barrel', 'large_barrel', 'bulk_bin', 'craft_bin', 'seed_bin', 'sprout_bin'].map(furnitureDef);
const BOATS = FURNITURE.filter((f) => f.boat);
/** What goes on wheels behind a team. A hand cart has no pace of its own: it goes at yours. */
const VEHICLES = FURNITURE.filter((f) => f.vehicle);
/** Boats, carts and wagons: what Sure Hull steadies the hands on. */
const HULLS = FURNITURE.filter((f) => f.boat || f.vehicle || f.cart).map((f) => pieceRecipe(f.id));
/** The bows a bowyer makes: every weapon that throws an arrow and is tillered at the bench. */
const BOWS = WEAPONS.filter((w) => w.ammo && RECIPES.some((r) => r.result === w.id && r.skill === 'bowyery'));
/** The tools Saw Care keeps. */
const SAW_TOOLS = ['saw', 'carving_knife', 'mallet', 'file'];
/** A fence, a gate or a half wall: the wall types that stand on a border of their own. */
const FENCES = FENCE_TYPES.map((t) => t.name.toLowerCase());
const PLANK_WALL = MATERIAL_BY_ID.get('plank')!;
const piece = (id: string): string => furnitureDef(id).name.toLowerCase();
const pieces = (ids: readonly string[]): string => listed(ids.map((id) => plural(piece(id))));
const bill = (b: Record<string, number>): string => listed(Object.entries(b).map(([id, n]) => `${n} ${n === 1 ? itemName(id) : plural(itemName(id))}`));
/** "6.6", to a tenth. */
const tenth = (x: number): string => `${Number(x.toFixed(1))}`;
/** "10%", from a multiplier of 1.1: how much more, without the sign. */
const by = (m: number): string => percent(m - 1);
/** The same multiplier on the same family for every one of a list of things. */
const onEach = (family: string, ids: readonly string[], v: number): Fx => each(ids.map((id) => `${family}:${id}`), v);

const CARPENTER: Seed[] = [
  {
    num: 1, name: 'Quick Saw',
    fx: onEach('time', SAWN.map((r) => r.id), 0.7),
    note: (fx) => `${listed(SAWN.map((r) => r.label))} take ${less(fx[`time:${SAWN[0].id}`])} less time a go `
      + `(${range(SAWN.map((r) => r.baseTime))} s base).`,
  },
  {
    num: 2, name: 'Clean Sawing',
    fx: { 'count:plank': 4 },
    note: (fx) => `${PLANKS.label} makes ${numberWord(fx['count:plank'])} planks from a log (now ${numberWord(PLANKS.count ?? 1)}).`,
  },
  {
    num: 3, name: 'Heavy Timber',
    fx: { 'count:timber': 3 },
    note: (fx) => `${TIMBERS.label} makes ${numberWord(fx['count:timber'])} timbers from a log (now ${numberWord(TIMBERS.count ?? 1)}).`,
  },
  {
    num: 6, name: 'Thatcher',
    fx: { 'count:thatch': 2 },
    note: (fx) => `${THATCH.label} makes ${numberWord(fx['count:thatch'])} thatch from ${numberWord(THATCH.inputs[0].count ?? 1)} `
      + `${itemName(THATCH.inputs[0].item)} (now ${numberWord(THATCH.count ?? 1)}).`,
  },
  {
    num: 10, name: 'Master Joiner',
    fx: onEach('rare', JOINERY.map((r) => r.id), RARITY_ODDS[0] * 2),
    note: (fx) => `Furniture you make with carpentry or fine carpentry, all ${JOINERY.length} pieces of it with the boats, carts and `
      + `wagons, comes out rare ${oneIn(fx[`rare:${JOINERY[0].id}`])} (now ${oneIn(RARITY_ODDS[0])}); supreme and fantastic `
      + 'follow at their usual odds.',
  },
  {
    num: 12, name: 'Deep Drawers',
    fx: onEach('hold', DRAWERS.map((f) => f.id), 1.2),
    note: (fx) => `${capital(pieces(DRAWERS.map((f) => f.id)))} you make hold ${by(fx[`hold:${DRAWERS[0].id}`])} more, `
      + `before the wood and the rarity: a chest ${Math.round((furnitureDef('chest').capacity ?? 0) * fx['hold:chest'])} `
      + `(now ${furnitureDef('chest').capacity}) and a barrel ${Math.round((furnitureDef('barrel').liquid ?? 0) * fx['hold:barrel'])} litres `
      + `(now ${furnitureDef('barrel').liquid}). It stays with the piece whoever has it after.`,
  },
  {
    num: 14, name: 'Shipwright',
    fx: onEach('time', BOATS.map((f) => `make_${f.id}`), 0.7),
    note: (fx) => `Building ${either(BOATS.map((f) => `${article(piece(f.id))} ${piece(f.id)}`))} takes `
      + `${less(fx[`time:make_${BOATS[0].id}`])} less time (${listed(BOATS.map((f) => `${pieceRecipe(f.id).baseTime} s`))} base).`,
  },
  {
    num: 15, name: 'Keel Layer',
    fx: onEach('speed', BOATS.map((f) => f.id), 1.1),
    note: (fx) => `Boats you build go ${by(fx[`speed:${BOATS[0].id}`])} faster on the water, whoever is working them: `
      + `${listed(BOATS.map((f) => `a ${piece(f.id)} ${tenth((f.boat?.speed ?? 0) * fx[`speed:${f.id}`])}`))} tiles a second `
      + `at a fair effort (now ${listed(BOATS.map((f) => `${f.boat?.speed}`))}). It stays with the boat whoever has it after.`,
  },
  {
    num: 16, name: 'Deep Hold',
    fx: onEach('hold', BOATS.map((f) => f.id), 1.25),
    note: (fx) => `Boats you build carry ${by(fx[`hold:${BOATS[0].id}`])} more, before the wood and the rarity: `
      + `${listed(BOATS.map((f) => `a ${piece(f.id)} ${Math.round((f.capacity ?? 0) * fx[`hold:${f.id}`])}`))} `
      + `(now ${listed(BOATS.map((f) => `${f.capacity}`))}). It stays with the boat whoever has it after.`,
  },
  {
    num: 18, name: 'Smooth Axle',
    fx: onEach('speed', VEHICLES.map((f) => f.id), 1.1),
    note: (fx) => `${capital(pieces(VEHICLES.map((f) => f.id)))} you build go ${by(fx[`speed:${VEHICLES[0].id}`])} faster behind their team, `
      + `up to ${tenth(MAX_VEHICLE_SPEED * fx[`speed:${VEHICLES[0].id}`])} tiles a second (now at most ${MAX_VEHICLE_SPEED}). `
      + 'It stays with the vehicle whoever has it after.',
  },
  {
    num: 19, name: 'Sure Hull',
    fx: onEach('fail', HULLS.map((r) => r.id), 0.5),
    note: (fx) => `Building a boat, a cart or a wagon fails ${share(fx[`fail:${HULLS[0].id}`])} as often `
      + `(now a check at difficulty ${range(HULLS.map((r) => r.difficulty ?? 0))}).`,
  },
  {
    num: 25, name: 'Fence Builder',
    fx: { 'time:fence': 0.5, 'bill:fence': 0.5 },
    note: (fx) => `${capital(listed(FENCES.map(plural)))} take ${share(fx['time:fence'])} the time a go `
      + `(${secs(base('build_wall'))} base) and ${share(fx['bill:fence'])} the material, rounded up: a plank fence `
      + `${bill(wallBill('plank', 'fence', fx['bill:fence']).needed)} (now ${bill(wallBill('plank', 'fence').needed)}). `
      + 'Hinges and brackets are as they were.',
  },
  {
    num: 26, name: 'Timber Salvage',
    fx: { 'salvage:build_wood': 0.5 },
    note: (fx) => `Remove wall gives back ${share(fx['salvage:build_wood'])} the logs or planks laid in a wall of `
      + `${either(TIMBER)}, rounded down: ${Math.floor(PLANK_WALL.bill[0][1] * fx['salvage:build_wood'])} of a plank wall's `
      + `${PLANK_WALL.bill[0][1]} planks (now none).`,
  },
  {
    num: 27, name: 'Bridge Wright',
    fx: {
      'time:bridge_wood': 0.7, 'time:bridge_rope': 0.7,
      'span:bridge_wood': BRIDGES.wood.span + 2, 'span:bridge_rope': BRIDGES.rope.span + 2,
    },
    note: (fx) => `Work on a ${BRIDGES.wood.name.toLowerCase()} or a ${BRIDGES.rope.name.toLowerCase()} takes `
      + `${less(fx['time:bridge_wood'])} less time a go (${secs(base('build_bridge'))} base), and they span `
      + `${fx['span:bridge_wood'] - BRIDGES.wood.span} tiles more: ${fx['span:bridge_wood']} and ${fx['span:bridge_rope']} `
      + `(now ${BRIDGES.wood.span} and ${BRIDGES.rope.span}).`,
  },
  {
    num: 31, name: "Bowyer's Draw",
    fx: onEach('damage', BOWS.map((w) => w.id), 1.1),
    note: (fx) => `Bows you make hit ${by(fx[`damage:${BOWS[0].id}`])} harder: `
      + `${listed(BOWS.map((w) => `${article(itemName(w.id))} ${itemName(w.id)} ${tenth(w.damage * fx[`damage:${w.id}`])}`))} base damage `
      + `(now ${listed(BOWS.map((w) => `${w.damage}`))}). It stays with the bow whoever has it after.`,
  },
  {
    num: 32, name: 'True Bow',
    fx: onEach('range', BOWS.map((w) => w.id), 1.1),
    note: (fx) => `Bows you make reach ${by(fx[`range:${BOWS[0].id}`])} further: `
      + `${listed(BOWS.map((w) => `${article(itemName(w.id))} ${itemName(w.id)} ${tenth((w.range ?? 0) * fx[`range:${w.id}`])}`))} tiles `
      + `(now ${listed(BOWS.map((w) => `${w.range}`))}). It stays with the bow whoever has it after.`,
  },
  {
    num: 37, name: 'String Maker',
    fx: { [`need:${BOWSTRING.id}`]: 0.5, [`fail:${BOWSTRING.id}`]: 0 },
    note: (fx) => `${BOWSTRING.label} takes ${Math.max(1, Math.ceil((BOWSTRING.inputs[0].count ?? 1) * fx[`need:${BOWSTRING.id}`]))} `
      + `${itemName(BOWSTRING.inputs[0].item)} (now ${BOWSTRING.inputs[0].count ?? 1}) and never fails `
      + `(now a check at difficulty ${BOWSTRING.difficulty}).`,
  },
  {
    num: 45, name: 'Saw Care',
    fx: onEach('wear', SAW_TOOLS, 0.5),
    note: (fx) => `${capital(listed(SAW_TOOLS.map((id) => plural(itemName(id)))))} take ${share(fx[`wear:${SAW_TOOLS[0]}`])} the damage `
      + 'a use, at any quality and of any wood or metal: a go of work at the bench wears the tool it is done with.',
  },
];

/*
 * ---------------------------------------------------------------------------
 * The Smith: the smelter, the anvil and the file.
 * ---------------------------------------------------------------------------
 */
/** The alloys: every lump the smelter mixes rather than smelts out of ore. */
const ALLOYS = RECIPES.filter((r) => METALS.some((m) => m.ore === null && m.lump === r.result));
const GLASS = recipeOf('make_glass');
/** What the anvil beats out of a casting: every mould's piece but the anvil's and the two cast whole. */
const BEATEN = MOULDS.filter((m) => m.makes !== 'anvil' && !castWhole(m));
/** Every tool a job asks for. */
const TOOLS = new Set([...ACTION_BY_ID.values()].map((a) => a.tool).concat(RECIPES.map((r) => r.tool)).filter((t): t is string => !!t));
/** The things made one at a time out of any of these parts. */
const fittedFrom = (parts: readonly string[]): string[] =>
  [...new Set(RECIPES.filter((r) => !ITEM_DEFS[r.result]?.stackable && r.inputs.some((i) => parts.includes(i.item))).map((r) => r.result))];
/** The heads and blades the anvil beats out, which is what a weapon or a tool is fitted round -- not its nails or ribbons. */
const HEADS = BEATEN.map((m) => m.makes).filter((id) => /_(head|blade)$/.test(id));
/** The heads and blades a weapon is fitted from. */
const WEAPON_PARTS = HEADS.filter((id) => fittedFrom([id]).some((w) => WEAPON_BY_ID.has(w)));
/** And those a tool some job asks for is fitted from. */
const TOOL_PARTS = HEADS.filter((id) => fittedFrom([id]).some((t) => TOOLS.has(t)));
const WEAPONS_FITTED = fittedFrom(WEAPON_PARTS).filter((id) => WEAPON_BY_ID.has(id));
/** Chain and plate the anvil beats out: every piece of the class that has a mould. */
const armourOf = (cls: string): string[] => ARMOUR.filter((a) => a.cls === cls && MOULD_BY_MAKES.has(a.id)).map((a) => a.id);
const CHAIN = armourOf('chain');
const PLATE = armourOf('plate');
/** What Temper Bath quenches: a weapon or a tool fitted from a head or blade the anvil beat out, or one it beats out whole. */
const TEMPERED = [...new Set([
  ...fittedFrom([...WEAPON_PARTS, ...TOOL_PARTS]).filter((id) => WEAPON_BY_ID.has(id) || TOOLS.has(id)),
  ...BEATEN.map((m) => m.makes).filter((id) => !ITEM_DEFS[id]?.stackable && !ARMOUR_BY_ID.has(id)),
])];
/** Every mould but the anvil's, which one filling uses up whole. */
const MOULDS_KEPT = MOULDS.filter((m) => m.makes !== 'anvil').map((m) => m.id);
const NAIL = MOULD_BY_ID.get('nail_mould')!;
const SWORD = WEAPON_BY_ID.get('sword')!;
/** Examples the notes work their numbers through: examples, not rules. */
const SAMPLE = { mould: 50, dent: 40, head: 50, swing: 0.7, skill: 50, piece: 40, ql: 50 };
const HAUBERK = { uid: 0, id: 'chain_hauberk', ql: SAMPLE.ql, dmg: 0, count: 1, extra: 'Iron' } as Item;
const label = (id: string): string => ACTION_BY_ID.get(id)?.label ?? id;

const SMITH: Seed[] = [
  {
    num: 7, name: 'Sure Alloy',
    fx: onEach('fail', ALLOYS.map((r) => r.id), 0.5),
    note: (fx) => `${listed(ALLOYS.map((r) => r.label))} fail ${share(fx[`fail:${ALLOYS[0].id}`])} as often `
      + `(now a check at difficulty ${range(ALLOYS.map((r) => r.difficulty ?? 0))}).`,
  },
  {
    num: 8, name: 'Glassblower',
    fx: { 'count:glass': 3 },
    note: (fx) => `${GLASS.label} makes ${numberWord(fx['count:glass'])} glass from ${numberWord(GLASS.inputs[0].count ?? 1)} `
      + `${itemName(GLASS.inputs[0].item)} (now ${numberWord(GLASS.count ?? 1)}).`,
  },
  {
    num: 9, name: 'Reclaimer',
    fx: { 'melt:share': 0.75, 'melt:keep': 0.85 },
    note: (fx) => `Melt down gives back ${percent(fx['melt:share'])} of the lumps a thing holds, at ${percent(fx['melt:keep'])} of its `
      + `QL less its damage (now ${percent(MELT_SHARE)}, at ${percent(MELT_KEEP)}): a ${itemName(HAUBERK.id)} `
      + `${meltLumps(HAUBERK, 1, fx['melt:share'])} lumps (now ${meltLumps(HAUBERK, 1)}).`,
  },
  {
    num: 12, name: 'Hard Sand',
    fx: onEach('last', MOULDS_KEPT, 2),
    note: (fx) => `Moulds you make last ${times(fx[`last:${MOULDS_KEPT[0]}`])} as many fillings: a QL ${SAMPLE.mould} mould `
      + `${mouldUsesLeft(SAMPLE.mould, 0, fx[`last:${MOULDS_KEPT[0]}`])} fillings of copper (now ${mouldUsesLeft(SAMPLE.mould, 0)}). `
      + 'Every mould but the anvil\'s, which the one filling uses up. It stays with the mould whoever has it after.',
  },
  {
    num: 13, name: 'Clean Pour',
    fx: { 'pour:wear': 0 },
    note: (fx) => `A mould's damage ${fx['pour:wear'] ? `counts ${share(fx['pour:wear'])} of itself` : 'no longer counts'} against `
      + `what you pour from it: a QL ${SAMPLE.mould} mould at ${SAMPLE.dent} damage pours as ${SAMPLE.mould - SAMPLE.dent * fx['pour:wear']} `
      + `(now ${SAMPLE.mould - SAMPLE.dent * MOULD_DENT}), which the casting takes together with the lump's QL and your smelting's.`,
  },
  {
    num: 16, name: 'Sure Hammer',
    fx: { 'fail:smith': 0.5, 'fail:strike_coins': 0.5 },
    note: (fx) => `${label('smith')} and ${label('strike_coins').toLowerCase()} at the anvil fail ${share(fx['fail:smith'])} as often `
      + `(now a check at difficulty ${range(BEATEN.map((m) => m.difficulty))} for a piece and ${COIN_DIFFICULTY} for coins, `
      + 'and more for a hard metal).',
  },
  {
    num: 20, name: 'Second Heat',
    fx: { 'spare:smith': 1 },
    note: (fx) => `${fx['spare:smith'] >= 1 ? 'A go' : `${oneIn(fx['spare:smith'])} goes`} of ${label('smith')} that fails `
      + 'leaves its casting where it was, to be beaten again (now the metal is lost).',
  },
  {
    num: 22, name: 'Nail Maker',
    fx: { 'count:nail': 8 },
    note: (fx) => `A filling of the nail mould beats out ${numberWord(fx['count:nail'])} nails at the anvil `
      + `(now ${numberWord(NAIL.per ?? 1)}): ${fx['count:nail']} nails to ${NAIL.lumps === 1 ? 'a lump' : `${NAIL.lumps} lumps`} `
      + `of iron, and to ${mouldLumps(NAIL, 'gold')} of gold.`,
  },
  {
    num: 24, name: 'Keen Edge',
    fx: onEach('damage', WEAPON_PARTS, 1.1),
    note: (fx) => `Weapons fitted from heads and blades you beat out hit ${by(fx[`damage:${WEAPON_PARTS[0]}`])} harder, whoever `
      + `fits them: ${listed(WEAPONS_FITTED.map((id) => plural(itemName(id))))}. A sword ${tenth(SWORD.damage * fx[`damage:${WEAPON_PARTS[0]}`])} `
      + `base damage (now ${SWORD.damage}). It goes from the part into the weapon, and stays with it whoever has it after.`,
  },
  {
    num: 25, name: 'Balanced',
    fx: onEach('aim', WEAPON_PARTS, 1.05),
    note: (fx) => `Weapons fitted from heads and blades you beat out land ${by(fx[`aim:${WEAPON_PARTS[0]}`])} more often, whoever `
      + `fits them, up to the ${percent(HIT_CAP)} no swing passes: a ${percent(SAMPLE.swing)} swing lands `
      + `${percent(Math.min(HIT_CAP, SAMPLE.swing * fx[`aim:${WEAPON_PARTS[0]}`]))}. It goes from the part into the weapon, and `
      + 'stays with it whoever has it after.',
  },
  {
    num: 26, name: 'Mail Maker',
    fx: onEach('soak', CHAIN, 1.1),
    note: (fx) => `Chain you beat out turns aside ${by(fx[`soak:${CHAIN[0]}`])} more of a blow, up to the ${percent(SOAK_CAP)} no `
      + `piece passes: ${listed(CHAIN.map((id) => itemName(id)))}. Chain that turns aside ${percent(ARMOUR_CLASSES.chain.soak)} `
      + `turns ${percent(ARMOUR_CLASSES.chain.soak * fx[`soak:${CHAIN[0]}`])}. It stays with the piece whoever wears it after.`,
  },
  {
    num: 27, name: 'Plate Maker',
    fx: onEach('soak', PLATE, 1.1),
    note: (fx) => `Plate you beat out turns aside ${by(fx[`soak:${PLATE[0]}`])} more of a blow, up to the ${percent(SOAK_CAP)} no `
      + `piece passes: ${listed(PLATE.map((id) => itemName(id)))}. Plate that turns aside ${percent(ARMOUR_CLASSES.plate.soak)} `
      + `turns ${percent(ARMOUR_CLASSES.plate.soak * fx[`soak:${PLATE[0]}`])}. It stays with the piece whoever wears it after.`,
  },
  {
    num: 30, name: 'Toolsmith',
    fx: onEach('ql', TOOL_PARTS, 1.1),
    note: (fx) => `Tool heads and blades you beat out come out at ${more(fx[`ql:${TOOL_PARTS[0]}`])} QL: `
      + `${listed(TOOL_PARTS.map((id) => plural(itemName(id))))}. One that would come out at ${SAMPLE.head} comes out at `
      + `${tenth(SAMPLE.head * fx[`ql:${TOOL_PARTS[0]}`])}.`,
  },
  {
    num: 32, name: 'Metal Polisher',
    fx: { 'improve:metal': 1.5 },
    note: (fx) => `Improve raises anything of metal ${by(fx['improve:metal'])} more a pass: at ${SAMPLE.skill} in the skill, a QL `
      + `${SAMPLE.piece} piece gains ${tenth(improveStepAt(SAMPLE.skill, SAMPLE.piece) * fx['improve:metal'])} a pass `
      + `(now ${tenth(improveStepAt(SAMPLE.skill, SAMPLE.piece))}).`,
  },
  {
    num: 36, name: 'Forge Reach',
    fx: { 'reach:forge': 6 },
    note: (fx) => `Work at a smelter or an anvil takes what it uses from your stores within ${fx['reach:forge']} tiles `
      + `(now ${CRAFT_REACH}): ${listed(FORGE_WORK.map((id) => label(id).toLowerCase()))}, and every recipe made at the smelter.`,
  },
  {
    num: 38, name: 'Long Shift',
    fx: { jobs: 2 },
    note: (fx) => `You can keep ${numberWord(fx.jobs)} more jobs queued: ${queueCapAt(CHAR_START) + fx.jobs} at ${CHAR_START} mind `
      + `logic (now ${queueCapAt(CHAR_START)}), and one more for every ${QUEUE_PER_MIND} above that, as before.`,
  },
  {
    num: 45, name: 'Temper Bath',
    fx: onEach('temper', TEMPERED, 5),
    note: (fx) => `A weapon or tool you finish can be quenched once, for +${fx[`temper:${TEMPERED[0]}`]} QL, by you or any Smith `
      + `with Temper Bath: Quench it standing at water, or beside a barrel or a well of it. That is `
      + `${listed(TEMPERED.map((id) => plural(itemName(id))))}: what is `
      + 'fitted from a head or blade the anvil beat out, and what the anvil beats out whole. It stays with the thing until it is '
      + 'quenched.',
  },
  {
    num: 49, name: 'Ingots',
    fx: { ingot: 1 },
    note: () => `Pour ${INGOT_LUMPS} lumps of a metal into an ingot at the smelter, at the lumps' QL. An ingot weighs `
      + `${share(INGOT_WEIGHT)} what its lumps do and counts as ${INGOT_LUMPS} lumps wherever the smelter, the anvil, a recipe or `
      + 'Improve takes lumps; what a job does not use of one comes back as lumps.',
  },
];

/*
 * ---------------------------------------------------------------------------
 * The Forester: the hatchet, the sickle and the growing wood.
 * ---------------------------------------------------------------------------
 */
/** The ground a walker is slowed on that a Forester's Woodsman's Stride takes at full pace. */
export const STRIDE = [TileType.Bush, TileType.Reed, TileType.Stump, TileType.Marsh];
const tileName = (t: TileType): string => TILE_DEFS[t].name.toLowerCase();
/** The stages a tree is felled in more than one stroke. */
const MANY_STROKES = TREE_AGES.filter((a) => a.hits > 1);
/** A tree that can be coppiced: one grown enough to bear. */
const COPPICED = TREE_AGES.filter((a) => a.alive && a.bears);
const age = (id: number): string => TREE_AGES[id].name.toLowerCase();

const FORESTER: Seed[] = [
  {
    num: 1, name: 'Clean Stroke',
    fx: { 'time:cut_down': 0.75 },
    note: (fx) => `Each stroke of ${label('cut_down')} takes ${less(fx['time:cut_down'])} less time (${secs(base('cut_down'))} base), on a tree or a bush.`,
  },
  {
    num: 2, name: 'Heavy Swing',
    fx: { 'fewer:cut_down': 1 },
    note: (fx) => `Trees come down in ${numberWord(fx['fewer:cut_down'])} stroke fewer, and never under one: `
      + `${listed(MANY_STROKES.map((a) => `${a.name.toLowerCase()} ${Math.max(1, a.hits - fx['fewer:cut_down'])} (now ${a.hits})`))}.`,
  },
  {
    num: 3, name: 'Sure Hatchet',
    fx: { 'fail:cut_down': 0.5 },
    note: (fx) => `${label('cut_down')} glances off ${share(fx['fail:cut_down'])} as often (now a check at difficulty `
      + `${diff('cut_down')}), on a tree or a bush.`,
  },
  {
    num: 5, name: 'Choice Logs',
    fx: { 'ql:cut_down': 1.1 },
    note: (fx) => `Logs from a tree you fell come up at ${more(fx['ql:cut_down'])} QL.`,
  },
  {
    num: 6, name: 'Rare Heartwood',
    fx: { 'rare:cut_down': RARITY_ODDS[0] },
    note: (fx) => `${oneIn(fx['rare:cut_down'])} trees you fell give rare logs, rolling on to supreme and fantastic at the odds `
      + 'crafting has. Felled logs are never rare without it.',
  },
  {
    num: 7, name: 'Clean Drop',
    fx: { 'stump:clear': 1 },
    note: () => 'A tree you fell leaves grass where it stood (now a stump, for a day or until it is dug out).',
  },
  {
    num: 10, name: 'Sprout Picker',
    fx: { 'fail:pick_sprout': 0, 'count:sprout': 2 },
    note: (fx) => `${label('pick_sprout')} never fails (now a check at difficulty ${diff('pick_sprout')}) and gives `
      + `${numberWord(fx['count:sprout'])} sprouts (now one).`,
  },
  {
    num: 11, name: 'Nursery',
    fx: { 'grown:plant': 1 },
    note: (fx) => {
      const grown = TREE_AGES[plantedAge(fx['grown:plant'])];
      return `A sprout you plant comes up ${article(grown.name.toLowerCase())} ${grown.name.toLowerCase()} tree (now ${age(PLANTED_AGE)}): `
        + `it fells for ${numberWord(grown.logs)} logs (now ${numberWord(TREE_AGES[PLANTED_AGE].logs)})`
        + `${grown.bears ? ', and a fruit tree bears at once' : ''}.`;
    },
  },
  {
    num: 14, name: 'Master Grafter',
    fx: { 'fail:graft': 0, 'time:graft': 0.7 },
    note: (fx) => `${label('graft')} never fails (now a check at difficulty ${diff('graft')}, and the sprout is spent either way) `
      + `and takes ${less(fx['time:graft'])} less time (${secs(base('graft'))} base).`,
  },
  {
    num: 16, name: 'Fruitful',
    fx: { 'more:pick_fruit': 1 },
    note: (fx) => `${fx['more:pick_fruit'] >= 1 ? 'Every pick' : `${percent(fx['more:pick_fruit'])} of picks`} of `
      + `${label('pick_fruit')} gives one more fruit.`,
  },
  {
    num: 20, name: 'Hedge Harvest',
    fx: { 'more:harvest_bush': 1 },
    note: (fx) => `${fx['more:harvest_bush'] >= 1 ? 'Every go' : `${percent(fx['more:harvest_bush'])} of goes`} of harvesting a bush `
      + `gives one more of what it bears (${either(BUSH_DEFS.flatMap((b) => (b.yields ? [itemName(b.yields)] : [])))}).`,
  },
  {
    num: 21, name: 'Nest Finder',
    fx: { 'nest:chance': 0.1, 'nest:feathers': 3 },
    note: (fx) => `${oneIn(fx['nest:chance'])} trees you fell for timber give ${numberWord(fx['nest:feathers'])} `
      + `${itemName('feather')}, at the logs' QL.`,
  },
  {
    num: 22, name: 'Honey Hunter',
    fx: { 'honey:chance': 0.05, 'honey:count': 2 },
    note: (fx) => `${oneIn(fx['honey:chance'])} trees you fell for timber give ${numberWord(fx['honey:count'])} `
      + `${itemName('honey')}, at the logs' QL.`,
  },
  {
    num: 24, name: 'Kindling',
    fx: { 'bush:shaft': 2 },
    note: (fx) => `Cutting down a bush gives ${numberWord(fx['bush:shaft'])} ${plural(itemName('shaft'))} (now nothing).`,
  },
  {
    num: 34, name: "Woodsman's Stride",
    fx: Object.fromEntries(STRIDE.map((t) => [walkKey(t), 1 / TILE_DEFS[t].speed])),
    note: () => `You walk through ${listed(STRIDE.map(tileName))} at full pace, on foot `
      + `(now ${listed(STRIDE.map((t) => `${tileName(t)} at ${percent(TILE_DEFS[t].speed)}`))} of it).`,
  },
  {
    num: 40, name: 'Coppice',
    fx: { coppice: 2 },
    note: (fx) => `${label('coppice')} (a job with a hatchet, ${secs(base('coppice'))}, a check at difficulty ${diff('coppice')}): `
      + `${article(COPPICED[0].name.toLowerCase())} ${either(COPPICED.map((a) => a.name.toLowerCase()))} tree is cut back to ${age(PLANTED_AGE)} for `
      + `${numberWord(fx.coppice)} logs, and stays standing to grow on.`,
  },
  {
    num: 43, name: 'Tap Resin',
    fx: { tap_resin: 1 },
    note: (fx) => `${label('tap_resin')} (a job with a carving knife, ${secs(base('tap_resin'))}): ${numberWord(fx.tap_resin)} `
      + `${itemName('tar')} from a living ${TREE_DEFS[RESIN_TREE].name.toLowerCase()}, once a day for each; the day turns at `
      + `${TREE_DAWN_UTC} o'clock UTC, when the trees grow.`,
  },
  {
    num: 44, name: 'Clear Brush',
    fx: { clear_brush: 1 },
    note: (fx) => `${label('clear_brush')} (a job with a sickle, ${secs(base('clear_brush'))}): every bush and reed in the `
      + `${2 * fx.clear_brush + 1}×${2 * fx.clear_brush + 1} tiles around the one you choose, cleared in one go. A bush leaves `
      + `${tileName(CLEARED_TO[TileType.Bush] as TileType)} and reeds ${tileName(CLEARED_TO[TileType.Reed] as TileType)}; `
      + 'it gives nothing.',
  },
];

/** What a quern presses: juice and cider into a bucket, and olive oil. */
const PRESSES = RECIPES.filter((r) => ['juice_bucket', 'cider_bucket', 'olive_oil'].includes(r.result));
/** The fruit a press takes, which is its first input. */
const pressFruit = (r: Recipe): number => r.inputs[0]?.count ?? 1;
/** Each crop's produce and seed, flour and cornmeal: what a Farmer's Sack Porter lightens. */
const SACKED = [...CROP_LIST.flatMap((c) => [c.produce, c.seed]), 'flour', 'cornmeal'];
const cropNames = (list: readonly CropDef[]): string => listed(list.map((c) => c.name.toLowerCase()));
const HERBS = CROP_LIST.filter((c) => c.look === 'herb');
const GRAINS = CROP_LIST.filter((c) => c.look === 'grain');
const FIBRES = CROP_LIST.filter((c) => c.kind === 'fibre');
const plusOn = (list: readonly CropDef[], n: number): Fx => Object.fromEntries(list.map((c) => [`plus:${c.produce}`, n]));
/** The quickest crop and the slowest, for what a Farmer's pace does to a stage. */
const QUICKEST = CROP_LIST.reduce((a, b) => (b.stageSeconds < a.stageSeconds ? b : a));
const SLOWEST = CROP_LIST.reduce((a, b) => (b.stageSeconds > a.stageSeconds ? b : a));
const stageRange = (m: number): string =>
  `from ${QUICKEST.name.toLowerCase()}'s ${secs(QUICKEST.stageSeconds * m)} (now ${secs(QUICKEST.stageSeconds)}) `
  + `to ${SLOWEST.name.toLowerCase()}'s ${secs(SLOWEST.stageSeconds * m)} (now ${secs(SLOWEST.stageSeconds)})`;
/** "3×3", the patch a Farmer's patch job covers at a reach of `r`. */
const patchSide = (r: number): string => `${2 * r + 1}×${2 * r + 1}`;
const madeOf = (id: string): number => RECIPES.find((r) => r.id === id)?.count ?? 1;
const recipeLabel = (id: string): string => RECIPES.find((r) => r.id === id)?.label ?? id;

const FARMER: Seed[] = [
  {
    num: 4, name: 'Seed Saver',
    fx: { 'keep:plant_seed': 0.25 },
    note: (fx) => `${oneIn(fx['keep:plant_seed'])} fields you sow, with Sow or Sow a patch, use no seed.`,
  },
  {
    num: 5, name: 'Fast Growth',
    fx: { 'grow:plant_seed': 0.8 },
    note: (fx) => `Each stage of a crop you sow takes ${less(fx['grow:plant_seed'])} less time, ${stageRange(fx['grow:plant_seed'])}.`,
  },
  {
    num: 6, name: 'Crop Rotation',
    fx: { 'rotate:plant_seed': 0.75 },
    note: (fx) => `Each stage of a crop you sow on a field last sown with a different crop takes ${less(fx['rotate:plant_seed'])} less time, `
      + `${stageRange(fx['rotate:plant_seed'])}. A field never sown, or broken up since, has no last crop.`,
  },
  {
    num: 8, name: 'Bumper Crop',
    fx: { 'bumper:harvest_crop': 1 },
    note: (fx) => `A crop tended at all ${numberWord(RIPE)} stages gives ${cropYield(RIPE, fx['bumper:harvest_crop']).produce} `
      + `produce when you harvest it (now ${cropYield(RIPE).produce}).`,
  },
  {
    num: 11, name: 'Rare Harvest',
    fx: { 'rare:harvest_crop': RARITY_ODDS[0] },
    note: (fx) => `${oneIn(fx['rare:harvest_crop'])} crops you harvest come up rare, rolling on to supreme and fantastic at the odds `
      + 'crafting has; the seed does not. A harvest is never rare without it.',
  },
  {
    num: 14, name: 'Fodder',
    fx: { 'fodder:harvest_crop': 2 },
    note: (fx) => `Every crop you harvest also gives ${numberWord(fx['fodder:harvest_crop'])} ${itemName('mixed_grass')}, `
      + "at the harvest's QL, into your pack.",
  },
  {
    num: 15, name: 'Herb Plot',
    fx: plusOn(HERBS, 2),
    note: (fx) => `${capital(cropNames(HERBS))} give ${numberWord(fx[`plus:${HERBS[0].produce}`])} more each time you harvest one.`,
  },
  {
    num: 16, name: 'Grain Master',
    fx: plusOn(GRAINS, 2),
    note: (fx) => `${capital(cropNames(GRAINS))} give ${numberWord(fx[`plus:${GRAINS[0].produce}`])} more each time you harvest one.`,
  },
  {
    num: 17, name: 'Fibre Farmer',
    fx: plusOn(FIBRES, 2),
    note: (fx) => `${capital(cropNames(FIBRES))} give ${numberWord(fx[`plus:${FIBRES[0].produce}`])} more each time you harvest one.`,
  },
  {
    num: 22, name: 'More Meal',
    fx: { 'count:flour': 2, 'count:cornmeal': 2 },
    note: (fx) => `${recipeLabel('make_flour')} makes ${numberWord(fx['count:flour'])} ${itemName('flour')} a go `
      + `(now ${numberWord(madeOf('make_flour'))}), and ${recipeLabel('make_cornmeal')} ${numberWord(fx['count:cornmeal'])} `
      + `${itemName('cornmeal')} (now ${numberWord(madeOf('make_cornmeal'))}).`,
  },
  {
    num: 23, name: 'Full Press',
    fx: Object.fromEntries(PRESSES.map((r) => [`need:${r.id}`, 0.8])),
    note: (fx) => {
      const m = fx[`need:${PRESSES[0].id}`];
      const took = [...new Set(PRESSES.map(pressFruit))].sort((a, b) => a - b);
      return `Pressing juice, cider or olive oil at the quern takes ${less(m)} less fruit, `
        + `${listed(took.map((n) => `${Math.max(1, Math.ceil(n * m))} where it took ${n}`))}: `
        + `${percent(1 / m - 1)} more from the same fruit. Juice and cider still take one bucket to a pressing.`;
    },
  },
  {
    num: 25, name: 'Milkmaid',
    fx: { 'time:milk_creature': 0.6, 'more:milk_creature': 0.5 },
    note: (fx) => `${capital(ACTION_BY_ID.get('milk_creature')?.verb ?? 'milking')} takes ${less(fx['time:milk_creature'])} less time (${secs(base('milk_creature'))} base), `
      + `and ${oneIn(fx['more:milk_creature'])} goes fill a second bucket of milk, if you carry another empty bucket.`,
  },
  {
    num: 28, name: 'Sack Porter',
    fx: Object.fromEntries(SACKED.map((id) => [`weight:${id}`, 0.5])),
    note: (fx) => `The produce and seed of every crop, flour and cornmeal weigh ${less(fx[`weight:${SACKED[0]}`])} less in your pack: `
      + `${listed(['potato', 'wheat_seed', 'flour'].map((id) => `${itemName(id)} ${kg(id) * fx[`weight:${id}`]} kg a unit (now ${kg(id)} kg)`))}.`,
  },
  {
    num: 30, name: 'Barn Reach',
    fx: { 'into:harvest_crop': 5, 'into:harvest_patch': 5 },
    note: (fx) => `What Harvest and Harvest a patch bring up goes into the nearest unlocked cart or wagon that nobody else is pulling `
      + `or driving, or container you built or that stands on your settlement, within ${fx['into:harvest_crop']} tiles `
      + '(now into your pack).',
  },
  {
    num: 34, name: 'Worn-in Rake',
    fx: { 'tool:till': 20 },
    note: (fx) => `When you till, your rake counts as ${fx['tool:till']} QL better than it is, to at most ${QL_TOP}. `
      + `A tool takes one part in ${TOOL_QL_SPAN} of a go's time off for each point of its QL, so that is ${percent(fx['tool:till'] / TOOL_QL_SPAN)} `
      + `of ${label('till')}'s time (${secs(base('till'))} base).`,
  },
  {
    num: 39, name: 'Sow a Patch',
    fx: { sow_patch: 1 },
    note: (fx) => `${label('sow_patch')} (a job, ${secs(base('sow_patch'))}, as long as ${numberWord(base('sow_patch') / base('plant_seed'))} `
      + `sowings): the seed you choose, sown on every empty field in the ${patchSide(fx.sow_patch)} tiles around the one you choose, `
      + 'one seed a field.',
  },
  {
    num: 40, name: 'Tend a Patch',
    fx: { tend_patch: 1 },
    note: (fx) => `${label('tend_patch')} (a job, ${secs(base('tend_patch'))}, as long as ${numberWord(base('tend_patch') / base('tend_crop'))} `
      + `tendings): every crop in the ${patchSide(fx.tend_patch)} tiles around the one you choose that is not ripe and not yet `
      + 'tended at the stage it is at, tended.',
  },
  {
    num: 41, name: 'Harvest a Patch',
    fx: { harvest_patch: 1 },
    note: (fx) => `${label('harvest_patch')} (a job, ${secs(base('harvest_patch'))}, as long as `
      + `${numberWord(base('harvest_patch') / base('harvest_crop'))} harvests): every ripe crop in the ${patchSide(fx.harvest_patch)} `
      + 'tiles around the one you choose, harvested, each for what its own tending earned.',
  },
];

/** A Cook's dishes: what a cooking recipe makes that is food. */
const DISHES = RECIPES.filter((r) => r.skill === 'cooking' && ITEM_DEFS[r.result]?.category === 'food');
const DISH_ITEMS = [...new Set(DISHES.map((r) => r.result))];
const onDishes = (fam: string, v: number): Fx => Object.fromEntries(DISH_ITEMS.map((id) => [`${fam}:${id}`, v]));
const onDishRecipes = (fam: string, v: number): Fx => Object.fromEntries(DISHES.map((r) => [`${fam}:${r.id}`, v]));
/** What a Cook's Big Pot makes one more of, a go. */
const BIG_POT = ['stew', 'pottage', 'porridge', 'preserves'];
const madeOfItem = (id: string): number => RECIPES.find((r) => r.result === id)?.count ?? 1;
/** What a Cook's Hide Keeper takes better off a carcass. */
const HIDES = ['hide', 'fur', 'bone'];

const COOK: Seed[] = [
  {
    num: 3, name: 'Fine Fare',
    fx: onDishRecipes('ql', 1.1),
    note: (fx) => `Dishes you cook come up at ${more(fx[`ql:${DISHES[0].id}`])} QL: every one of the ${DISHES.length} cooking recipes that make food.`,
  },
  {
    num: 5, name: 'Big Pot',
    fx: Object.fromEntries(BIG_POT.map((id) => [`count:${id}`, madeOfItem(id) + 1])),
    note: (fx) => `${capital(listed(BIG_POT.map(itemName)))} each make one more a go: `
      + `${listed(BIG_POT.map((id) => `${itemName(id)} ${numberWord(fx[`count:${id}`])} (now ${numberWord(madeOfItem(id))})`))}.`,
  },
  {
    num: 6, name: 'Frugal Cook',
    fx: onDishRecipes('keep', 0.2),
    note: (fx) => `${oneIn(fx[`keep:${DISHES[0].id}`])} dishes you cook give back one of their first ingredient, other than a bucket, `
      + 'at the quality of the stack it came off.',
  },
  {
    num: 7, name: 'Hearty',
    fx: onDishes('feed', 1.25),
    note: (fx) => `Dishes you cook feed each of the ${numberWord(NUTRIENTS.length)} they feed ${percent(fx[`feed:${DISH_ITEMS[0]}`] - 1)} more, whoever eats them.`,
  },
  {
    num: 8, name: 'Long-lasting',
    fx: onDishes('rot', 0.5),
    note: (fx) => `Dishes you cook rot ${less(fx[`rot:${DISH_ITEMS[0]}`])} slower lying on the ground, whoever sets them down. `
      + 'Nothing rots in a pack or a store.',
  },
  {
    num: 11, name: 'Flavoursome',
    fx: onDishes('knack', 1.5),
    note: (fx) => `The knack from a dish you cooked lasts ${percent(fx[`knack:${DISH_ITEMS[0]}`] - 1)} longer, whoever eats it.`,
  },
  {
    num: 14, name: 'Balanced Diet',
    fx: { 'table:best': 0.3 },
    note: (fx) => `A full table is worth up to ${percent(fx['table:best'])} more on everything you learn (now ${percent(TABLE_BEST)}).`,
  },
  {
    num: 15, name: 'Filling',
    fx: onDishes('fill', 1.25),
    note: (fx) => `Dishes you cook fill ${percent(fx[`fill:${DISH_ITEMS[0]}`] - 1)} more of the food bar, whoever eats them.`,
  },
  {
    num: 18, name: 'Full Carcass',
    fx: { 'share:butcher': 1.15 },
    note: (fx) => `You take ${percent(fx['share:butcher'] - 1)} more of a carcass you butcher, and never more than all of it.`,
  },
  {
    num: 20, name: 'Prime Cuts',
    fx: { 'ql:meat': 1.1 },
    note: (fx) => `${capital(itemName('meat'))} you butcher comes up at ${more(fx['ql:meat'])} QL.`,
  },
  {
    num: 21, name: 'Hide Keeper',
    fx: Object.fromEntries(HIDES.map((id) => [`ql:${id}`, 1.1])),
    note: (fx) => `${capital(listed(HIDES.map((id) => plural(itemName(id)))))} you butcher come up at ${more(fx[`ql:${HIDES[0]}`])} QL.`,
  },
  {
    num: 28, name: 'Strong Brew',
    fx: Object.fromEntries(BREWS.map((b) => [`brewed:${b.id}`, 1.5])),
    note: (fx) => `The knack from ${listed(BREWS.map((b) => b.name.toLowerCase()))} you brewed lasts ${percent(fx[`brewed:${BREWS[0].id}`] - 1)} longer, `
      + 'whoever drinks it, from the barrel or from a bucket drawn off it.',
  },
  {
    num: 31, name: 'Pantry Reach',
    fx: { 'reach:cook': 6 },
    note: (fx) => `Cooking takes what goes into it from containers within ${fx['reach:cook']} tiles (now ${CRAFT_REACH}).`,
  },
  {
    num: 32, name: 'Cool Pack',
    fx: { 'cool:food': 0.5 },
    note: (fx) => `Food you drop rots ${less(fx['cool:food'])} slower where it lies, until it is picked up. Nothing rots in a pack.`,
  },
  {
    num: 46, name: 'Broth',
    fx: { broth: 1 },
    note: () => {
      const r = RECIPES.find((x) => x.id === 'make_broth')!;
      const feeds = ITEM_DEFS.broth.feeds ?? {};
      return `A new recipe, ${r.label}: ${listed(r.inputs.map((i) => `${numberWord(i.count ?? 1)} ${(i.count ?? 1) > 1 ? plural(itemName(i.item)) : itemName(i.item)}`))} `
        + `over a campfire make ${numberWord(r.count ?? 1)} ${itemName('broth')}, each feeding all ${numberWord(NUTRIENTS.length)} a little: `
        + `${listed(Object.entries(feeds).map(([k, v]) => `${k} ${percent((v ?? 0) * helpingOf(QL_TOP))}`))} at QL ${QL_TOP}.`;
    },
  },
  {
    num: 47, name: 'Distil',
    fx: { distil: 1 },
    note: () => `A new recipe for each brew: ${numberWord(DISTIL_BUCKETS)} buckets of it (${DISTIL_BUCKETS * BUCKET_LITRES} litres) boiled off over a campfire `
      + `into one of spirit (${BUCKET_LITRES} litres), and ${numberWord(DISTIL_BUCKETS - 1)} buckets back. A drink of spirit at QL ${QL_TOP} `
      + `gives a knack that lasts ${spanWords(boonTime('spirit_bucket', QL_TOP))} (${listed(BREWS.map((b) => `${b.name.toLowerCase()} `
      + `${spanWords(boonTime(`${b.id}_bucket`, QL_TOP))}`))}).`,
  },
  {
    num: 49, name: 'Bait Maker',
    fx: { 'bait:butcher': 2 },
    note: (fx) => `Butchering a carcass also gives ${numberWord(fx['bait:butcher'])} ${itemName(BUTCHER_BAIT)}, a fishing bait `
      + `${BAIT_BY_ID.get(BUTCHER_BAIT)?.favours.length ? `that ${listed(BAIT_BY_ID.get(BUTCHER_BAIT)!.favours.map((f) => itemName(f)))} bite on` : ''}.`,
  },
  {
    num: 50, name: 'Taste',
    fx: { taste: 1 },
    note: () => 'Examine on food or drink says how much of the food bar a helping fills (or of the thirst bar it quenches), how much of '
      + `each of the ${numberWord(NUTRIENTS.length)} it feeds, and how long its knack lasts, at its quality and with its maker's hand in it.`,
  },
];

/** A Tailor's spinning, weaving and trades. */
const SPINS = ['spin_wool', 'spin_cotton', 'spin_wemp'].map((id) => recipeOf(id));
const WEAVE = recipeOf('weave_cloth');
const TAILORED = RECIPES.filter((r) => r.skill === 'tailoring' && r.difficulty !== undefined);
const LEATHERED = RECIPES.filter((r) => r.skill === 'leatherworking' && r.difficulty !== undefined);
const TAILOR_RARE = RECIPES.filter((r) => r.skill === 'tailoring');
const TAILOR_LOST = RECIPES.filter((r) => TAILOR_SKILLS.has(r.skill) && r.consumeOnFail);
/** What a Tailor's Light Pack lightens, and the tack a Saddler's hand is in. */
const LIGHT = ['cloth', 'leather', 'yarn', 'hide'];
const TACKED = ['saddle', 'bridle', 'yoke'];
const needFor = (r: Recipe, m: number): number => Math.max(1, Math.ceil((r.inputs[0].count ?? 1) * m));
const holds = (id: string, m = 1): number => Math.round((ITEM_DEFS[id]?.holds ?? 0) * m);
const kgSaid = (x: number): string => `${Number(x.toFixed(3))} kg`;

const TAILOR: Seed[] = [
  {
    num: 2, name: 'Full Fleece',
    fx: { 'plus:wool': 1 },
    note: (fx) => `Shearing gives ${numberWord(fx['plus:wool'])} more wool a go (now ${numberWord(Math.max(1, Math.round(SHEAR_FROM * SHEAR_WOOL)))} `
      + `to ${numberWord(SHEAR_WOOL)}, by how grown the fleece is).`,
  },
  {
    num: 3, name: 'Quick Spindle',
    fx: onEach('time', SPINS.map((r) => r.id), 0.6),
    note: (fx) => `Spinning takes ${less(fx[`time:${SPINS[0].id}`])} less time (${secs(SPINS[0].baseTime)} base), wool, cotton and wemp alike.`,
  },
  {
    num: 4, name: 'Even Thread',
    fx: { 'count:yarn': 3 },
    note: (fx) => `Spinning makes ${numberWord(fx['count:yarn'])} yarn a go (now ${numberWord(SPINS[0].count ?? 1)}) from the same `
      + `${numberWord(SPINS[0].inputs[0].count ?? 1)} fibre.`,
  },
  {
    num: 7, name: 'Tight Weave',
    fx: { [`need:${WEAVE.id}`]: 2 / 3 },
    note: (fx) => `${capital(WEAVE.label)} takes ${numberWord(needFor(WEAVE, fx[`need:${WEAVE.id}`]))} yarn (now ${numberWord(needFor(WEAVE, 1))}).`,
  },
  {
    num: 9, name: 'Sure Needle',
    fx: onEach('fail', TAILORED.map((r) => r.id), 0.5),
    note: (fx) => `Tailoring fails ${share(fx[`fail:${TAILORED[0].id}`])} as often (now a check at difficulty `
      + `${range(TAILORED.map((r) => r.difficulty ?? 0))}).`,
  },
  {
    num: 11, name: 'Master Tailor',
    fx: onEach('rare', TAILOR_RARE.map((r) => r.id), RARITY_ODDS[0] * 2),
    note: (fx) => `What you tailor, all ${TAILOR_RARE.length} things, comes out rare ${oneIn(fx[`rare:${TAILOR_RARE[0].id}`])} `
      + `(now ${oneIn(RARITY_ODDS[0])}); supreme and fantastic follow at their usual odds.`,
  },
  {
    num: 16, name: 'Sack Maker',
    fx: { 'hold:sack': 1.5 },
    note: (fx) => `Sacks you stitch hold ${holds('sack', fx['hold:sack'])} (now ${holds('sack')}), whoever has them after.`,
  },
  {
    num: 18, name: 'Sure Tan',
    fx: { 'fail:tan_hide': 0.5 },
    note: (fx) => `${capital(label('tan_hide'))} fails ${share(fx['fail:tan_hide'])} as often (now a check at difficulty ${diff('tan_hide')}).`,
  },
  {
    num: 19, name: 'Lye Saver',
    fx: { 'lye:tan_hide': 0.5 },
    note: (fx) => `${oneIn(fx['lye:tan_hide'])} tannings leave the lye in the bucket for another (now the bucket comes back empty).`,
  },
  {
    num: 21, name: 'Sure Awl',
    fx: onEach('fail', LEATHERED.map((r) => r.id), 0.5),
    note: (fx) => `Leatherworking fails ${share(fx[`fail:${LEATHERED[0].id}`])} as often (now a check at difficulty `
      + `${range(LEATHERED.map((r) => r.difficulty ?? 0))}).`,
  },
  {
    num: 25, name: 'Deep Pockets',
    fx: { 'hold:satchel': 1.25, 'hold:backpack': 1.25 },
    note: (fx) => `Satchels you stitch hold ${holds('satchel', fx['hold:satchel'])} (now ${holds('satchel')}) and backpacks `
      + `${holds('backpack', fx['hold:backpack'])} (now ${holds('backpack')}), whoever has them after.`,
  },
  {
    num: 27, name: 'Saddler',
    fx: onEach('speed', TACKED, 1.1),
    note: (fx) => `A mount in a saddle or a bridle you stitched goes ${by(fx['speed:saddle'])} faster, up to `
      + `${tenth(MAX_MOUNT_SPEED * fx['speed:saddle'])} tiles a second (now at most ${MAX_MOUNT_SPEED}); and a cart or a wagon built with `
      + `yokes you stitched goes ${by(fx['speed:yoke'])} faster behind its team, over what its builder's hand puts into it. `
      + 'Whoever rides or drives them.',
  },
  {
    num: 31, name: "Fisher's Friend",
    fx: { 'catch:fishing_net': 1.2, 'catch:creel': 1.2 },
    note: (fx) => `Nets and creels you make catch ${by(fx['catch:fishing_net'])} more, whoever fishes with them: a net's haul, `
      + 'and a creel\'s chance of a fish each time it is looked at.',
  },
  {
    num: 34, name: 'Nothing Wasted',
    fx: each(TAILOR_LOST.map((r) => `spare:${r.id}`), 1),
    note: () => `A failed tailoring, leatherworking or ropemaking job keeps its materials (now they are lost), on every one of `
      + `the ${TAILOR_LOST.length} that lose them.`,
  },
  {
    num: 35, name: 'Light Pack',
    fx: each(LIGHT.map((id) => `weight:${id}`), 0.5),
    note: (fx) => `${capital(listed(LIGHT.map((id) => (id === 'hide' ? plural(itemName(id)) : itemName(id)))))} weigh `
      + `${less(fx['weight:cloth'])} less in your pack: ${listed(LIGHT.map((id) => `${itemName(id)} ${kgSaid(kg(id) * fx[`weight:${id}`])} a unit `
      + `(now ${kgSaid(kg(id))})`))}.`,
  },
  {
    num: 37, name: 'Workshop Reach',
    fx: { 'reach:tailor': 6 },
    note: (fx) => `Tailoring, leatherworking and ropemaking take what goes into them from containers within ${fx['reach:tailor']} tiles `
      + `(now ${CRAFT_REACH}).`,
  },
  {
    num: 46, name: 'Patch',
    fx: { patch_item: 20 },
    note: (fx) => `${label('patch_item')} (a job, ${secs(base('patch_item'))}): ${fx.patch_item} damage off a cloth or leather piece for `
      + 'one cloth or one leather, and nothing off its QL.',
  },
  {
    num: 49, name: 'Tent',
    fx: { tent: 1 },
    note: () => `A new piece to build, a ${piece('tent')} (${billWords(furnitureDef('tent').bill, false)}, with a needle), that you can set `
      + `down anywhere and sleep in: ${percent((furnitureDef('tent').bed ?? 0) / (furnitureDef('bed').bed ?? 1))} of the rest a bed gives.`,
  },
];

/** What a kept beast's hunger comes to, full to empty, at a pace. */
const emptyIn = (mode: 'active' | 'deed', m: number): string => spanWords(1 / (HUNGER_RATE[mode] * m));
const CRATE_KG = kg('creature_crate');

const HERDSMAN: Seed[] = [
  {
    num: 1, name: 'Soft Hand',
    fx: { 'tame:offer': 0.1 },
    note: (fx) => `Every offering to tame a wildermon is ${points(fx['tame:offer'])} likelier to take, over everything else that goes into `
      + `the chance (still ${percent(TAME_MOST)} at most).`,
  },
  {
    num: 2, name: 'Patient Coax',
    fx: { 'coax:step': 0.06 },
    note: (fx) => `Each offering a wildermon refuses makes the next ${points(fx['coax:step'])} likelier (now ${points(COAX_STEP)}).`,
  },
  {
    num: 9, name: 'Young Trust',
    fx: { 'tame:young': 2.5 },
    note: (fx) => `A young wildermon is ${fx['tame:young']} times as easy to tame as a grown one (now ${AGES.young.tame} times).`,
  },
  {
    num: 10, name: 'Any Bait',
    fx: { 'bait:any': 1 },
    note: () => 'Any food will do as an offering to tame any kind (now each kind takes only its own few). Feeding one you keep '
      + 'still takes its own.',
  },
  {
    num: 11, name: 'Brushwork',
    fx: { 'groom:care': 1.5 },
    note: (fx) => `A brushing puts ${by(fx['groom:care'])} more care in (now ${percent(groomGain(0, 0))} to ${percent(groomGain(100, 100))} `
      + 'of full care, by your husbandry and the brush).',
  },
  {
    num: 13, name: 'Lasting Care',
    fx: { 'kept:care_hours': 6 },
    note: (fx) => `The care in a wildermon you keep wears off over ${spanWords(fx['kept:care_hours'] * 3600)} `
      + `(now ${spanWords(CARE_HOURS * 3600)}), whoever brushed it.`,
  },
  {
    num: 14, name: 'Well Kept',
    fx: { 'kept:care_bonus': 0.4 },
    note: (fx) => `A wildermon you keep works and learns ${percent(fx['kept:care_bonus'])} faster brushed to a shine `
      + `(now ${percent(CARE_BONUS)}), and its share of that at less care: ${percent(fx['kept:care_bonus'] / 2)} at half.`,
  },
  {
    num: 15, name: 'Healing Hands',
    fx: { 'groom:heal': 0.15 },
    note: (fx) => `A brushing heals ${percent(fx['groom:heal'])} of a wildermon's health (now ${percent(GROOM_HEAL)}).`,
  },
  {
    num: 16, name: 'Light Eaters',
    fx: { 'kept:hunger': 0.7 },
    note: (fx) => `Wildermon you keep get hungry ${less(fx['kept:hunger'])} slower: one following you goes from fed to empty in `
      + `${emptyIn('active', fx['kept:hunger'])} (now ${emptyIn('active', 1)}), one working a settlement in `
      + `${emptyIn('deed', fx['kept:hunger'])} (now ${emptyIn('deed', 1)}).`,
  },
  {
    num: 18, name: 'Long-lived',
    fx: { 'kept:old_at': OLD_AT * 25 / 15 },
    note: (fx) => `Wildermon you keep grow old at ${spanWords(fx['kept:old_at'])} (now ${spanWords(OLD_AT)}).`,
  },
  {
    num: 21, name: 'Short Rest',
    fx: { 'breed:rest': 0.5 },
    note: (fx) => `A pair you put together can be put to a mate again ${spanWords(BREED_REST * fx['breed:rest'])} after `
      + `(now ${spanWords(BREED_REST)}), and half that after a pairing that did not take (now ${spanWords(BREED_REST / 2)}).`,
  },
  {
    num: 22, name: 'Quick Gestation',
    fx: { 'breed:gestation': 0.5 },
    note: (fx) => `A mother you pair carries for ${spanWords(GESTATION * fx['breed:gestation'])} (now ${spanWords(GESTATION)}).`,
  },
  {
    num: 24, name: 'Twins',
    fx: { 'breed:twins': 0.2 },
    note: (fx) => `${oneIn(fx['breed:twins'])} pairings give a second young as well, bred for itself from the pair.`,
  },
  {
    num: 25, name: 'True Blood',
    fx: { 'breed:inherit': 0.1 },
    note: (fx) => `Each of a young one's ${numberWord(TRAIT_SLOTS)} traits is ${points(fx['breed:inherit'])} likelier to be drawn `
      + `from its parents' blood (now ${percent(inheritChance(0, 0))}, plus ${Number(((inheritChance(100, 0) - inheritChance(0, 0)) / 100 * 100).toFixed(2))} `
      + `of a point for each husbandry level and up to ${points(inheritChance(0, 1) - inheritChance(0, 0))} for their care, `
      + `${percent(inheritChance(100, 1))} at most), and never past certain.`,
  },
  {
    num: 26, name: 'Bred Up',
    fx: { 'breed:upgrade': 0.1 },
    note: (fx) => `Each of a young one's traits is ${points(fx['breed:upgrade'])} likelier to come out a tier better (now `
      + `${Number((upgradeChance(100, 0) / 100 * 100).toFixed(2))} of a point for each husbandry level and up to `
      + `${points(upgradeChance(0, 1))} for their care, ${percent(upgradeChance(100, 1))} at most).`,
  },
  {
    num: 28, name: 'Choose the Sex',
    fx: { 'breed:sex': 1 },
    note: () => 'You choose whether a pairing gives a male or a female young (now even odds), twins alike.',
  },
  {
    num: 37, name: 'Light Crate',
    fx: { 'weight:creature_crate': 0.3 },
    note: (fx) => `A creature crate weighs ${kgSaid(CRATE_KG * fx['weight:creature_crate'])} in your pack (now ${kgSaid(CRATE_KG)}).`,
  },
  {
    num: 50, name: 'Stud Book',
    fx: { stud_book: 1 },
    note: () => 'Examine on one of yours says, for the mate it would be put to, how often the pairing takes and how often each of the '
      + 'young\'s traits is drawn from their blood and comes out a tier better.',
  },
];

/*
 * ---------------------------------------------------------------------------
 * The Naturalist: foraging and botanizing, alchemy and first aid.
 * ---------------------------------------------------------------------------
 */
const DYE_BOILS = RECIPES.filter((r) => r.result === 'dye');
const ALCHEMY = RECIPES.filter((r) => r.skill === 'alchemy' && r.difficulty !== undefined);
const COVER = recipeOf('make_cover_thyme');
const TEA = recipeOf('brew_tea_thyme');
const SALVE = recipeOf('make_salve_thyme');
const TINCTURE = recipeOf('make_tincture_thyme');
/** "two of one herb", from a recipe whose first input is the herb. */
const ofOneHerb = (r: Recipe): string => `${numberWord(r.inputs[0].count ?? 1)} of one herb`;

const NATURALIST: Seed[] = [
  {
    num: 2, name: 'Keen Eye',
    fx: { 'passes:forage': 1, 'passes:botanize': 1 },
    note: (fx) => `Foraging and botanizing go over the ground ${numberWord(fx['passes:forage'])} more `
      + `${fx['passes:forage'] === 1 ? 'time' : 'times'} a go (now once, and once more for every ${PER_ROLL} points of the skill).`,
  },
  {
    num: 3, name: 'Sure Find',
    fx: { 'empty:forage': 0, 'empty:botanize': 0 },
    note: () => `No look over the ground comes up empty by chance, foraging or botanizing (now ${oneIn(EMPTY_CHANCE)} does, `
      + 'before the skill is asked).',
  },
  {
    num: 10, name: 'Hay Cutter',
    fx: { 'count:mixed_grass': 3 },
    note: (fx) => `Cutting grass gives ${numberWord(fx['count:mixed_grass'])} bundles (now ${numberWord(GRASS_PER_CUT)}).`,
  },
  {
    num: 11, name: 'Reed Cutter',
    fx: { 'count:reed': 3 },
    note: (fx) => `Cutting reeds always gives ${numberWord(fx['count:reed'])} (now ${numberWord(REED_CUT)}, and one more on a chance of `
      + `your foraging in ${REED_EXTRA_AT}).`,
  },
  {
    num: 12, name: 'Rare Find',
    fx: { 'rare:forage': RARITY_ODDS[0], 'rare:botanize': RARITY_ODDS[0] },
    note: (fx) => `${oneIn(fx['rare:forage'])} finds foraging or botanizing come up rare (now none do); supreme and fantastic `
      + 'follow at their usual odds.',
  },
  {
    num: 13, name: 'Quick Lye',
    fx: { 'time:make_lye': 0.6 },
    note: (fx) => `${capital(recipeOf('make_lye').verb)} takes ${less(fx['time:make_lye'])} less time (${secs(base('make_lye'))} base).`,
  },
  {
    num: 15, name: 'Double Boil',
    fx: { 'count:dye': 3 },
    note: (fx) => `A dye boil makes ${numberWord(fx['count:dye'])} pots (now ${numberWord(DYE_BOILS[0].count ?? 1)}).`,
  },
  {
    num: 16, name: 'Thrifty Dyer',
    fx: onEach('need', DYE_BOILS.map((r) => r.id), 0.75),
    note: (fx) => `A dye boil takes ${range(DYE_BOILS.map((r) => needFor(r, fx[`need:${r.id}`])))} of its dyestuff `
      + `(now ${range(DYE_BOILS.map((r) => needFor(r, 1)))}), and the one bucket of lye.`,
  },
  {
    num: 17, name: 'Sure Boil',
    fx: onEach('fail', ALCHEMY.map((r) => r.id), 0.5),
    note: (fx) => `Alchemy fails ${share(fx[`fail:${ALCHEMY[0].id}`])} as often (now a check at difficulty `
      + `${range(ALCHEMY.map((r) => r.difficulty ?? 0))}).`,
  },
  {
    num: 19, name: 'Ink Maker',
    fx: { 'count:ink': 4 },
    note: (fx) => `${capital(recipeOf('make_ink').verb)} makes ${numberWord(fx['count:ink'])} (now ${numberWord(recipeOf('make_ink').count ?? 1)}).`,
  },
  {
    num: 23, name: 'Quick Dressing',
    fx: { 'time:bind_wound': 0.6 },
    note: (fx) => `Dressing a wound takes ${less(fx['time:bind_wound'])} less time (${secs(base('bind_wound'))} base).`,
  },
  {
    num: 24, name: 'Sure Hands',
    fx: { 'fail:bind_wound': 0.5 },
    note: (fx) => `A dressing slips ${share(fx['fail:bind_wound'])} as often (now a check at difficulty ${DRESS_CHECK}).`,
  },
  {
    num: 29, name: 'Quick Mend',
    fx: { 'mend:bind_wound': 1.5 },
    note: (fx) => `A wound you dress closes ${percent(fx['mend:bind_wound'] - 1)} faster until it closes or is cleaned out, whoever's it is.`,
  },
  {
    num: 30, name: 'Cover Maker',
    fx: { 'count:cover': 5 },
    note: (fx) => `${capital(ofOneHerb(COVER))} and ${numberWord(COVER.inputs[1].count ?? 1)} cotton make ${numberWord(fx['count:cover'])} `
      + `healing covers (now ${numberWord(COVER.count ?? 1)}).`,
  },
  {
    num: 34, name: 'Field Medic',
    fx: { dress_others: 1 },
    note: () => 'You can dress the wounds of somebody standing beside you, at your first aid and with your dressings (now only your own).',
  },
  {
    num: 43, name: 'Herb Tea',
    fx: { herb_tea: 1 },
    note: () => `A new recipe: ${ofOneHerb(TEA)} and a bucket of water make ${numberWord(TEA.count ?? 1)} cups of herb tea, and a cup `
      + `puts back ${percent(ITEM_DEFS.herb_tea.stamina ?? 0)} of your stamina.`,
  },
  {
    num: 44, name: 'Salve',
    fx: { salve: 1 },
    note: () => `A new recipe: ${ofOneHerb(SALVE)} and ${numberWord(SALVE.inputs[1].count ?? 1)} beeswax make a salve. Rubbed in over a `
      + `dressing, the wound under it never goes bad (now cloth over it leaves ${percent(FESTER_CLOTH)} of the chance and the wrong `
      + `herb ${percent(FESTER_WRONG)}).`,
  },
  {
    num: 50, name: 'Tincture',
    fx: { tincture: 1 },
    note: () => `A new recipe: ${ofOneHerb(TINCTURE)} make a tincture. Taken, ${TINCTURE_NAMES} each go in ${percent(TINCTURE_BONUS)} faster `
      + `for ${spanWords(TINCTURE_SECONDS)}, beside anything a dish is doing for them.`,
  },
];

/*
 * ---------------------------------------------------------------------------
 * The Fisher: the rod, the net and the creel.
 * ---------------------------------------------------------------------------
 */
/** The fish that run in water a net mostly misses: trout and deeper. */
const BIG_FISH = FISH.filter((f) => f.depth >= 8);
const fishName = (id: string): string => itemName(id);
const POND = furnitureDef('fish_pond');
/** A share of bites where every fish runs and nothing is on the hook, with a Fisher's perks or without. */
const bigShare = (fx: Fx): number => BIG_FISH.reduce((n, f) => n + biteShare(f.id, undefined, (k, d) => fx[k] ?? d), 0);
const SMOKED = recipeOf('smoke_trout');

const FISHER: Seed[] = [
  {
    num: 1, name: 'Quick Cast',
    fx: { 'time:fish': 0.7 },
    note: (fx) => `A cast takes ${less(fx['time:fish'])} less time (${secs(base('fish'))} base).`,
  },
  {
    num: 2, name: 'Long Cast',
    fx: { 'reach:fish': 6 },
    note: (fx) => `Your line reaches water ${fx['reach:fish']} tiles off (now ${CAST}); click water further than that and it goes into `
      + `the deepest water within ${Math.floor(fx['reach:fish'])} tiles of you each way (now ${Math.floor(CAST)}).`,
  },
  {
    num: 3, name: 'Steady Hand',
    fx: { 'hook:fish': 0.15 },
    note: (fx) => `A fish that bites stays on ${points(fx['hook:fish'])} more often, over everything else that goes into it `
      + `(still ${percent(HOOK_MOST)} at most).`,
  },
  {
    num: 4, name: 'Bait Saver',
    fx: { 'spare:fish': 1 },
    note: (fx) => `${fx['spare:fish'] >= 1 ? 'A fish that comes off leaves' : `${percent(fx['spare:fish'])} of the fish that come off leave`} `
      + 'your bait on the hook, so bait goes only with a fish you land (now every cast with bait on takes it).',
  },
  {
    num: 5, name: 'Strong Bait',
    fx: { 'bait:pull': 2 },
    note: (fx) => `Bait draws the fish it favours ${times(fx['bait:pull'])} as hard, on the hook and in a creel you set: `
      + `${BAIT_PULL * fx['bait:pull']} times its plain weight for the first it favours and ${(BAIT_PULL * fx['bait:pull']) / 2} for the `
      + `second (now ${BAIT_PULL} and ${BAIT_PULL / 2}).`,
  },
  {
    num: 6, name: 'Any Bait',
    fx: { 'bait:food': 1 },
    note: () => 'With no bait that draws a fish in your pack, any food goes on the hook or in a creel instead: it draws every fish at '
      + `its plain weight, and a fish on it stays on ${points(HOOK_BAIT)} more often, as on any bait (now only `
      + `${either(BAITS.map((b) => itemName(b.id)))} will do).`,
  },
  {
    num: 9, name: 'Big Fish',
    fx: onEach('bite', BIG_FISH.map((f) => f.id), 2),
    note: (fx) => `${capital(listed(BIG_FISH.map((f) => fishName(f.id))))} weigh ${times(fx[`bite:${BIG_FISH[0].id}`])} as much in the draw `
      + `of which fish bites, on your rod, in your net and in a creel you set: where every fish runs and nothing is on the hook, they `
      + `are ${percent(bigShare(fx))} of the bites (now ${percent(bigShare({}))}).`,
  },
  {
    num: 12, name: 'Rare Catch',
    fx: { 'rare:fish': RARITY_ODDS[0], 'rare:drag_net': RARITY_ODDS[0] },
    note: (fx) => `${oneIn(fx['rare:fish'])} fish you land on a rod or haul in a net come up rare (now none do); supreme and fantastic `
      + 'follow at their usual odds.',
  },
  {
    num: 13, name: 'Quick Net',
    fx: { 'time:drag_net': 0.7 },
    note: (fx) => `Dragging the net takes ${less(fx['time:drag_net'])} less time (${secs(base('drag_net'))} base).`,
  },
  {
    num: 14, name: 'Full Net',
    fx: { 'haul:drag_net': 2 },
    note: (fx) => `A drag of the net hauls ${fx['haul:drag_net']} more fish: ${NET_LEAST + fx['haul:drag_net']} to `
      + `${NET_HAUL + fx['haul:drag_net']} by the net's quality (now ${NET_LEAST} to ${NET_HAUL}), before its maker's mark is counted in.`,
  },
  {
    num: 15, name: 'Wide Net',
    fx: { 'reach:drag_net': 4 },
    note: (fx) => `Your net reaches water ${fx['reach:drag_net']} tiles off (now ${NET_REACH}); click water further than that and it is `
      + `dragged through the deepest water within ${Math.floor(fx['reach:drag_net'])} tiles of you each way (now ${Math.floor(NET_REACH)}).`,
  },
  {
    num: 17, name: 'Net Care',
    fx: { 'wear:fishing_net': 0.5 },
    note: (fx) => `A fishing net takes ${share(fx['wear:fishing_net'])} the damage a drag, at any quality.`,
  },
  {
    num: 19, name: 'Deep Creel',
    fx: { 'hold:creel': 2 },
    note: (fx) => `A creel you make holds ${Math.round((TRAPS.creel.hold ?? 0) * fx['hold:creel'])} fish before it takes no more `
      + `(now ${TRAPS.creel.hold}).`,
  },
  {
    num: 25, name: 'Cool Pack',
    fx: onEach('cool', FISH.map((f) => f.id), 0.5),
    note: (fx) => `${capital(listed(FISH.map((f) => fishName(f.id))))} you drop rot ${less(fx[`cool:${FISH[0].id}`])} slower where they lie, `
      + 'until they are picked up. Nothing rots in a pack.',
  },
  {
    num: 27, name: 'Smoke Fish',
    fx: { smoke_fish: 1, ...onEach('rot', FISH.map((f) => f.id), 0.2) },
    note: (fx) => `A new recipe: a fish hung in the smoke of a lit campfire, at your fishing, comes off at its own quality and rots `
      + `${less(fx[`rot:${SMOKED.result}`])} slower wherever it is left: it keeps ${times(1 / fx[`rot:${SMOKED.result}`])} as long.`,
  },
  {
    num: 33, name: 'Rod Care',
    fx: { 'wear:fishing_rod': 0.5 },
    note: (fx) => `A fishing rod takes ${share(fx['wear:fishing_rod'])} the damage a cast, at any quality and of any wood.`,
  },
  {
    num: 45, name: 'Fishing Journal',
    fx: { fish_journal: 1 },
    note: () => 'Examining water also says how deep it is, what share of the bites there each fish you could land is with the bait you '
      + 'would put on, and how often a fish that bites stays on with your rod.',
  },
  {
    num: 47, name: 'Fish Pond',
    fx: { fish_pond: 1 },
    note: () => `A new piece to build, a ${POND.name.toLowerCase()} (${billWords(POND.bill, false)}, with a ${itemName(POND.tool ?? 'shovel')}), `
      + `that you set down on your settlement: it stocks itself at a fish in ${spanWords(POND_EVERY)} until it holds ${POND.pond}, `
      + 'drawn from every fish at its plain weight.',
  },
];

/*
 * ---------------------------------------------------------------------------
 * The Mender: the repair bench, the tool kit and the restorer's table.
 * ---------------------------------------------------------------------------
 */
/**
 * The skill a trade's perk is first offered at, by the number it was picked
 * under: where its tier opens. Read when the notes are written, after `TIERS`.
 */
const offeredAt = (cls: string, num: number): number => PERK_TIER_AT[Math.max(0, (TIERS[cls] ?? []).findIndex((row) => row.includes(num)))];
/** Every tool a job or a recipe wears that there is, and the brush, which grooming wears by hand. */
const WORN_TOOLS = [...TOOLS, 'brush'].filter((id) => ITEM_DEFS[id]).sort();
const TRAP_KINDS = Object.keys(TRAPS);
const KIT = recipeOf('make_repair_kit');
const SEALANT = recipeOf('make_sealant');
/** What goes into a recipe, counted: "two cloth, two nails and one plank". */
const counted = (r: Recipe): string =>
  listed(r.inputs.map((i) => ((i.count ?? 1) === 1 ? `one ${itemName(i.item)}` : countOf(i.item, i.count ?? 1))));
/** "4.8", the damage a go of Repair takes out at this skill, times a perk's. */
const healedAt = (skill: number, m = 1): string => tenth(repairGo(skill).healed * m);
/** "0.0092", the quality a point of damage taken out costs at this skill, times a perk's. */
const costAt = (skill: number, m = 1): string => `${Number((repairGo(skill).cost * m).toFixed(4))}`;
/** "a minor one major and a major one ancient": what each tier of bauble comes out as a tier up. */
const tiersUp = (): string =>
  listed(BAUBLE_TIERS.slice(0, -1).map((t, i) => `${article(t.id)} ${t.id} one ${BAUBLE_TIERS[i + 1].id}`));

const MENDER: Seed[] = [
  {
    num: 1, name: 'Big Mend',
    fx: { 'mend:repair_item': 1.5 },
    note: (fx) => `Each go of Repair takes ${by(fx['mend:repair_item'])} more damage out, for the same quality on each point of it: `
      + `${healedAt(offeredAt('mender', 1), fx['mend:repair_item'])} at repair ${offeredAt('mender', 1)} (now ${healedAt(offeredAt('mender', 1))}).`,
  },
  {
    num: 2, name: 'Light Touch',
    fx: { 'cost:repair_item': 0.5 },
    note: (fx) => `Repairing takes ${share(fx['cost:repair_item'])} the quality off for each point of damage it takes out: `
      + `${costAt(offeredAt('mender', 2), fx['cost:repair_item'])} QL a point at repair ${offeredAt('mender', 2)} (now ${costAt(offeredAt('mender', 2))}).`,
  },
  {
    num: 3, name: 'Clean Repair',
    fx: { 'keep:repair_item': 0.25 },
    note: (fx) => `${oneIn(fx['keep:repair_item'])} goes of Repair take nothing off the quality of what they mend.`,
  },
  {
    num: 4, name: 'Quick Hands',
    fx: { 'time:repair_item': 0.6 },
    note: (fx) => `Each go of Repair takes ${less(fx['time:repair_item'])} less time: ${secs(goSeconds(base('repair_item')) * fx['time:repair_item'])}, `
      + `where it takes ${secs(goSeconds(base('repair_item')))} now, the shortest any job takes without a perk on it.`,
  },
  {
    num: 9, name: 'Tool Care',
    fx: onEach('wear', WORN_TOOLS, 0.75),
    note: (fx) => `Every tool you work with wears ${less(fx[`wear:${WORN_TOOLS[0]}`])} slower: each use puts that much less damage on it, `
      + 'whatever the job and whatever the tool is made of.',
  },
  {
    num: 10, name: 'Armour Care',
    fx: { 'worn:armour': 0.75, 'worn:shield': 0.75, 'worn:weapon': 0.75 },
    note: (fx) => `Armour you wear takes ${less(fx['worn:armour'])} less damage from each blow that lands on it, a shield `
      + `${less(fx['worn:shield'])} less from each blow it stops, and a weapon ${less(fx['worn:weapon'])} less from each blow it lands `
      + 'or arrow it puts home.',
  },
  {
    num: 14, name: 'Post Keeper',
    fx: onEach('life', ['work_post', ...TRAP_KINDS], 1.5),
    note: (fx) => `Work posts, ${listed(TRAP_KINDS.map((k) => plural(TRAPS[k as keyof typeof TRAPS].name.toLowerCase())))} you set stand `
      + `${by(fx['life:work_post'])} longer: a work post ${spanWords(POST_LIFE_MIN * fx['life:work_post'])} to `
      + `${spanWords(POST_LIFE_MAX * fx['life:work_post'])} by its quality (now ${spanWords(POST_LIFE_MIN)} to ${spanWords(POST_LIFE_MAX)}).`,
  },
  {
    num: 17, name: 'Quick Restore',
    fx: { 'time:restore_relic': 0.6 },
    note: (fx) => `Restoring a relic or a bauble takes ${less(fx['time:restore_relic'])} less time (${secs(base('restore_relic'))} base).`,
  },
  {
    num: 18, name: 'Sure Restore',
    fx: { 'fail:restore_relic': 0.5 },
    note: (fx) => `Restoring a relic or a bauble fails ${share(fx['fail:restore_relic'])} as often.`,
  },
  {
    num: 19, name: 'Gentle Hands',
    fx: { 'harm:restore_relic': 0 },
    note: (fx) => `A restoring that fails does ${fx['harm:restore_relic'] <= 0 ? 'no' : `${less(fx['harm:restore_relic'])} less`} damage `
      + `to the pieces or the bauble (now ${RESTORE_HARM} to ${RESTORE_HARM + RESTORE_HARM_SPREAD} to each).`,
  },
  {
    num: 20, name: 'Fine Restore',
    fx: { 'ql:restore_relic': 1.1 },
    note: (fx) => `What you restore comes out ${by(fx['ql:restore_relic'])} higher in quality than it would, a relic or a bauble, to `
      + `${QL_TOP} at most.`,
  },
  {
    num: 21, name: 'Age Undone',
    fx: { 'age:restore_relic': 0 },
    note: (fx) => `The damage on the pieces or the bauble takes ${fx['age:restore_relic'] <= 0 ? 'nothing' : `${less(fx['age:restore_relic'])} less`} `
      + `off the quality of what you restore (now each point of it takes ${percent(1 / RESTORE_AGE)} off).`,
  },
  {
    num: 24, name: 'Lucky Polish',
    fx: { 'rare:restore_relic': 2 * RARITY_ODDS[0] },
    note: (fx) => `${oneIn(fx['rare:restore_relic'])} baubles you restore come out rare (now ${oneIn(RARITY_ODDS[0])}); supreme and fantastic `
      + 'follow at their usual odds.',
  },
  {
    num: 25, name: 'Second Look',
    fx: { 'rolls:bauble': 2 },
    note: (fx) => `A minor or major bauble you restore is rolled ${times(fx['rolls:bauble'])} and keeps whichever roll gives the most `
      + `(each gives ${BAUBLE_LOW} to ${BAUBLE_HIGH}% before its rarity); an ancient one gives the same whichever it keeps.`,
  },
  {
    num: 26, name: 'Tier Up',
    fx: { 'tier:restore_relic': 0.1 },
    note: (fx) => `${oneIn(fx['tier:restore_relic'])} baubles you restore come out a tier better than they went in: ${tiersUp()}.`,
  },
  {
    num: 27, name: 'Handyman',
    fx: { 'floor:improve': 30 },
    note: (fx) => `You can improve anything to QL ${fx['floor:improve']}, whatever your skill in its trade (now ${IMPROVE_FLOOR}); past that `
      + 'your skill is the ceiling, as it is for everybody.',
  },
  {
    num: 42, name: 'Repair Kit',
    fx: { repair_kit: 1 },
    note: () => `A new recipe, on repair: ${counted(KIT)}, with a ${itemName(KIT.tool ?? 'hammer')}, make a repair kit, `
      + `which takes ${KIT_MEND} damage off anything in one use, anywhere, and none of its quality. Anybody may use one.`,
  },
  {
    num: 50, name: 'Sealant',
    fx: { sealant: 1 },
    note: () => `A new recipe, on repair: ${counted(SEALANT)} make sealant, and a thing it is worked over never decays after, `
      + 'wherever it is left: one to a thing, and one for each thing in a pile. Anybody may use it.',
  },
];

/*
 * ---------------------------------------------------------------------------
 * The Artisan: the jeweller's file, the potter's hands and the binder's needle.
 * ---------------------------------------------------------------------------
 */
/** The recipes a stone is set by: in a ring, a pendant or a focus. */
const SETTINGS = ['set_ring', 'set_pendant', 'set_focus'];
/** What a stone is set in to be worn. */
const JEWELS = ['jewelled_ring', 'jewelled_pendant', 'circlet'];
/** The dishes a recipe makes in one of these, as the recipes have them. */
const madeIn = (tools: readonly string[]): string[] =>
  [...new Set(RECIPES.filter((r) => r.tool && tools.includes(r.tool) && isDish(r.result)).map((r) => itemName(r.result)))];
const POT_DISHES = madeIn(['clay_pot', 'clay_bowl']);
const PUT_UP = madeIn(['clay_jar']);
const MORE_STONES = GEMS.filter((g) => g.perk === 'more_stones');
const CIRCLET_MAKE = recipeOf('make_circlet');
const AMPHORA_SHAPE = recipeOf('make_amphora');
const TRADE_BOOK = recipeOf(`write_trade_book_${TRADE_BOOK_SKILLS[0]}`);
const WHEEL = furnitureDef('potters_wheel');
/** "a clay pot, a clay bowl, a clay jar or an amphora". */
const GLAZE_ON = either([...GLAZEABLE].map((id) => `${article(itemName(id))} ${itemName(id)}`));

const ARTISAN: Seed[] = [
  {
    num: 2, name: 'Sure Setting',
    fx: onEach('fail', [...SETTINGS, 'set_in_circlet'], 0.5),
    note: (fx) => `Setting a stone in a ring, a pendant, a focus or a circlet fails ${share(fx['fail:set_ring'])} as often.`,
  },
  {
    num: 3, name: 'Keep the Stone',
    fx: { 'stone:set_focus': 1 },
    note: () => 'A focus you fail to set gives you its stone back whole, and only the silver is lost (now the stone splits with it).',
  },
  {
    num: 26, name: 'Deep Pot',
    fx: { 'serve:unfired_clay_pot': 1, 'serve:unfired_clay_bowl': 1 },
    note: (fx) => `A pot or a bowl you shape makes ${fx['serve:unfired_clay_pot']} more serving of every dish cooked in it, `
      + `whoever cooks it: ${listed(POT_DISHES)}.`,
  },
  {
    num: 7, name: 'Cut True',
    fx: onEach('cut', JEWELS, 0.05),
    note: (fx) => `A ring, a pendant or a circlet you make gives up to ${percent(fx['cut:jewelled_ring'])} more skill from every go at `
      + `each stone's trade, by its quality: all of it at QL ${QL_TOP} and half of it at QL ${QL_TOP / 2} (now its quality makes no `
      + `difference). A circlet's stones each give ${share(CIRCLET_SHARE)} of it.`,
  },
  {
    num: 9, name: 'Fine Castings',
    fx: { 'ql:ring': 1.1, 'ql:pendant': 1.1 },
    note: (fx) => `Rings and pendants you forge from a casting come off the anvil ${by(fx['ql:ring'])} higher in quality, to ${QL_TOP} at most.`,
  },
  {
    num: 10, name: 'Gem Eye',
    fx: { 'gem:mine': 2 * GEM_ODDS },
    note: (fx) => `Mine turns up a gem in ${oneIn(fx['gem:mine'])} goes (now ${oneIn(GEM_ODDS)}).`,
  },
  {
    num: 13, name: 'Focus Cutter',
    fx: { 'thrift:focus': 0.75 },
    note: (fx) => `A focus you set wears ${less(fx['thrift:focus'])} slower when a spell is cast from it, whoever casts it.`,
  },
  {
    num: 27, name: 'Sealed Jar',
    fx: { 'keeps:unfired_clay_jar': 0.5 },
    note: (fx) => `What is put up in a jar you shape keeps ${times(1 / fx['keeps:unfired_clay_jar'])} as long, whoever puts it up: `
      + `${listed(PUT_UP)}.`,
  },
  {
    num: 35, name: 'Sturdy Binding',
    fx: onEach('sturdy', ['book', 'trade_book'], 0.5),
    note: (fx) => `A book you bind takes ${share(fx['sturdy:book'])} the damage from a go of study (now ${STUDY_WEAR} to `
      + `${STUDY_WEAR + STUDY_WEAR_SPREAD} a go).`,
  },
  {
    num: 4, name: 'Bright Stone',
    fx: onEach('bright', JEWELS, 1.5),
    note: (fx) => `A ring or a pendant you make gives ${percent(JEWEL_BONUS * fx['bright:jewelled_ring'])} more skill from every go at its `
      + `stone's trade (now ${percent(JEWEL_BONUS)}), and each stone in a circlet you make `
      + `${percent(JEWEL_BONUS * CIRCLET_SHARE * fx['bright:circlet'])} (now ${percent(JEWEL_BONUS * CIRCLET_SHARE)}).`,
  },
  {
    num: 14, name: 'Keen Focus',
    fx: { 'force:focus': 1.1 },
    note: (fx) => `A spell cast from a focus you set is ${by(fx['force:focus'])} stronger, and a hold it leaves lasts `
      + `${by(fx['force:focus'])} longer, whoever casts it.`,
  },
  {
    num: 34, name: 'Good Read',
    fx: onEach('teach', ['book', 'trade_book'], 1.25),
    note: (fx) => `A book you bind teaches ${by(fx['teach:book'])} more from every go of study, whoever reads it.`,
  },
  {
    num: 12, name: 'More Stones',
    fx: { more_stones: 1 },
    note: () => `The rock gives up ${numberWord(MORE_STONES.length)} more stones to you, and to nobody without this: `
      + `${listed(MORE_STONES.map((g) => `${article(g.name)} ${g.name.toLowerCase()} for ${tradeName(g.skill)}`))}. `
      + 'Each is set and worn like any other stone.',
  },
  {
    num: 46, name: 'Amphora',
    fx: { amphora: 1 },
    note: () => `A new thing to shape, on pottery: ${counted(AMPHORA_SHAPE)} make an unfired amphora, which a kiln fires into an amphora `
      + `that holds ${ITEM_DEFS.amphora?.holds} of one food or drink at a time; what is in it rots at `
      + `${share(ITEM_DEFS.amphora?.shelter ?? 1)} the rate if it is left lying about. Anybody may fill one.`,
  },
  {
    num: 49, name: "Potter's Wheel",
    fx: { potters_wheel: 1 },
    note: () => `A new piece to build, a potter's wheel (${billWords(WHEEL.bill, false)}): anybody working at pottery within `
      + `${WHEEL.pace?.reach} tiles of it takes ${less(WHEEL.pace?.by ?? 1)} less time a go, whatever else makes it quicker.`,
  },
  {
    num: 28, name: 'Glaze',
    fx: { glaze_item: 1 },
    note: () => `A new job, Glaze it, on ${GLAZE_ON}: ${numberWord(GLAZE_ASH)} lot${GLAZE_ASH === 1 ? '' : 's'} of ashes brushed `
      + 'over it, and it never decays after, wherever it is left.',
  },
  {
    num: 36, name: 'Trade Book',
    fx: { trade_book: 1 },
    note: () => `A new book to write, on papyrusmaking: ${counted(TRADE_BOOK)}, with a ${itemName(TRADE_BOOK.tool ?? 'needle')}, make a `
      + `book on any craft trade you have ${TRADE_BOOK_AT} of, and studying it teaches that trade, as much a go as a plain book `
      + 'teaches mind logic. Anybody may read one.',
  },
  {
    num: 48, name: 'Circlet',
    fx: { circlet: 1 },
    note: () => `A new thing to make, on jewellery: ${counted(CIRCLET_MAKE)}, with a ${itemName(CIRCLET_MAKE.tool ?? 'file')}, make a `
      + `circlet, worn on the head in place of a helm. It takes ${numberWord(CIRCLET_STONES)} stones, set by anybody off each stone's `
      + `menu, and each gives ${share(CIRCLET_SHARE)} what it would in a ring: ${percent(JEWEL_BONUS * CIRCLET_SHARE)} more skill from `
      + 'every go at its trade.',
  },
];

/** Every trade's perks, in the order they were picked. */
const SEEDS: Record<string, Seed[]> = {
  terraformer: TERRAFORMER,
  miner: MINER,
  mason: MASON,
  carpenter: CARPENTER,
  smith: SMITH,
  forester: FORESTER,
  farmer: FARMER,
  cook: COOK,
  tailor: TAILOR,
  herdsman: HERDSMAN,
  naturalist: NATURALIST,
  fisher: FISHER,
  mender: MENDER,
  artisan: ARTISAN,
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
  mason: [[1, 8, 17], [4, 18, 19], [20, 22, 33], [2, 9, 29], [16, 35, 48], [47, 24, 12]],
  carpenter: [[1, 37, 45], [3, 6, 14], [15, 26, 31], [16, 19, 32], [2, 18, 25], [10, 12, 27]],
  smith: [[8, 26, 27], [30, 32, 49], [12, 20, 22], [24, 25, 36], [7, 9, 13], [16, 38, 45]],
  forester: [[34, 43, 44], [21, 22, 40], [1, 2, 3], [7, 16, 24], [10, 11, 20], [5, 6, 14]],
  farmer: [[14, 25, 28], [4, 5, 8], [22, 23, 30], [6, 34, 39], [11, 40, 41], [15, 16, 17]],
  cook: [[11, 18, 28], [31, 49, 50], [3, 7, 8], [5, 6, 15], [20, 21, 32], [14, 46, 47]],
  tailor: [[2, 3, 18], [27, 31, 37], [9, 19, 21], [16, 25, 34], [4, 7, 35], [11, 46, 49]],
  herdsman: [[1, 11, 21], [15, 37, 50], [2, 13, 22], [9, 16, 25], [14, 24, 28], [10, 18, 26]],
  naturalist: [[2, 13, 23], [10, 11, 19], [3, 17, 24], [16, 29, 30], [12, 15, 34], [43, 44, 50]],
  fisher: [[1, 4, 13], [2, 15, 45], [17, 25, 33], [3, 14, 19], [5, 6, 9], [12, 27, 47]],
  mender: [[4, 9, 17], [3, 10, 19], [1, 14, 18], [2, 20, 21], [24, 25, 42], [26, 27, 50]],
  artisan: [[2, 3, 26], [7, 9, 10], [13, 27, 35], [4, 14, 34], [12, 46, 49], [28, 36, 48]],
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
