import type { ActionDef } from './actions';
import type { Game } from './game';
import { DAY_SECONDS, world } from './pace';
import { wellCap } from './wells';
import { windAt, windFrom, windWord } from './wind';
import { article, listed, listedOr, NumberWord, numberWord, percent, share, spanWords, times, timeWords } from './words';
import { COMPANION_LEASH, GUARD_RANGE, HEAVY_HIT } from './fight';
import { HAND_WINTER, SPRING_GROWTH } from './growth';
import { lastDawn, TREE_AGES } from '../world/tiles';
import { runestoneWithin } from './runestones';

/**
 * Meditation, and the three paths.
 *
 * Sitting still on a rug and thinking about nothing is not obviously work,
 * and it is the slowest thing anybody does here. What comes of it is a
 * **path**: one of three ways of looking at the island, chosen once at
 * `CHOOSE_AT` meditation and never changed, and **Calm**, banked by every
 * sitting and spent on what the path teaches.
 *
 * **Love** is the living island's path -- companions, taming, breeding and
 * growing -- **Knowledge** the reader's, of senses and information, and
 * **Power** the body's own: endurance, carrying, moving and shrugging things
 * off.
 *
 * ## Two shapes of path
 *
 * A path is either still on its old **steps** -- five things, each opened by
 * the meditation it takes, that simply come to whoever walks it -- or it has
 * **moved** onto tiers (`PathDef.moved`), the way a trade moved off its tree
 * onto perks one at a time (`MOVED_TO_PERKS`). A moved path keeps no steps and
 * no old abilities. It offers, at each of `PATH_TIER_AT`, one **technique**
 * and two **disciplines** (`PATH_PICKS`), and its walker takes one of the
 * three at each tier, for good:
 *
 *   - a technique goes in the spell bar's one path slot (`SPELL_BAR`), is
 *     cast through the same door a faith spell is (`rpc_cast_spell`), costs
 *     Calm and rests;
 *   - a discipline is simply true from then on.
 *
 * All three have moved: Knowledge first, then Love and Power. The shape of a
 * path on its steps is kept for a path that might be added on them, and
 * nothing walks one now.
 *
 * The island keeps the path, the picks, Calm and the marks a technique leaves
 * (`path_def`, `path_pick`, `path_taken`, `player.calm`), and tells the browser
 * all of it on the beat (`rpc_settle`'s `path`) and in the Faith window's
 * answer (`faith_said`'s `path`). Playing by yourself, the browser keeps the
 * same things in its own save. What a path *offers* is the same for everybody
 * and is written here, which is what the island's rows are generated from.
 */

export const MEDITATION = 'meditation';

export type PathId = 'love' | 'knowledge' | 'power';

export interface PathStep {
  /** Meditation it takes. */
  at: number;
  name: string;
  note: string;
  /** An ability that is called on, rather than something that is simply true. */
  ability?: { id: string; rest: number; note: string };
}

export interface PathDef {
  id: PathId;
  name: string;
  note: string;
  /**
   * Moved onto tiers: its walker takes one of `PATH_PICKS` at each of
   * `PATH_TIER_AT`, and its old steps are gone. False, it keeps its steps.
   */
  moved: boolean;
  steps: PathStep[];
}

export const PATHS: Record<PathId, PathDef> = {
  love: {
    id: 'love',
    name: 'Love',
    note: 'The living island: companions, taming, breeding and growing.',
    moved: true,
    steps: [],
  },
  knowledge: {
    id: 'knowledge',
    name: 'Knowledge',
    note: 'The reader’s way: senses and information.',
    moved: true,
    steps: [],
  },
  power: {
    id: 'power',
    name: 'Power',
    note: 'The body itself: endurance, carrying, moving and shrugging things off.',
    moved: true,
    steps: [],
  },
};

export const PATH_LIST = Object.values(PATHS);
/**
 * The meditation each tier of a moved path opens at: the same five numbers as
 * a patron's tiers of faith (`FAITH_TIER_AT` is this list).
 */
export const PATH_TIER_AT = [20, 40, 60, 80, 99] as const;
/** The path may be chosen once this much meditation is behind you, which is also where its first tier opens. */
export const CHOOSE_AT = PATH_TIER_AT[0];
/** How many picks a tier offers, of which one is taken: one technique and two disciplines. */
export const PICKS_PER_TIER = 3;
/** How long between sittings that are worth anything. */
export const SIT_REST = world(12 * 60);

/** How many steps of their path somebody has behind them: none on a path that has moved onto tiers. */
export function stepsOf(path: PathId | null, meditation: number): number {
  if (!path || PATHS[path].moved) return 0;
  return PATHS[path].steps.filter((s) => meditation >= s.at).length;
}

/** Whether a particular step is behind them, by its one-based number. */
export const hasStep = (path: PathId | null, meditation: number, n: number): boolean => stepsOf(path, meditation) >= n;

/** The next step and what it wants, for the rug's menu. */
export function nextStep(path: PathId | null, meditation: number): PathStep | null {
  if (!path || PATHS[path].moved) return null;
  return PATHS[path].steps.find((s) => meditation < s.at) ?? null;
}

/** Every ability the walker of this path may call on: none on a path that has moved. */
export function abilitiesOf(path: PathId | null, meditation: number): PathStep[] {
  if (!path || PATHS[path].moved) return [];
  return PATHS[path].steps.filter((s) => s.ability && meditation >= s.at);
}

/* ---- Calm ---------------------------------------------------------------- */

/**
 * Calm a sitting banks, before where it was sat is counted: the place
 * multiplier the sitting's meditation is worked out with (`sitPlace`) times
 * this.
 */
export const SIT_CALM = 10;
/** What a sitting trains meditation by, before where it was sat is counted. */
export const SIT_GAIN = 1.5;

/**
 * The most Calm this much meditation holds: favour's curve off faith
 * (`wellCap`), and `deep` times that for a Deep Calm.
 */
export const calmCap = (meditation: number, deep = 1): number => wellCap(meditation) * deep;

/** Why a technique cannot be paid for: `cost` Calm wanted and `held` banked. The island's `spell_cast_refusal` says the same. */
export const calmRefusal = (name: string, cost: number, held: number): string =>
  `${name} costs ${cost} calm; you hold ${Math.floor(held)}. Sit somewhere quiet.`;

/* ---- Where a sitting is worth most ------------------------------------------- */

/**
 * What where you sit multiplies a sitting by, both the meditation it trains
 * and the Calm it banks. The help reads these, so the rug and the page cannot
 * say different things.
 */
export const SIT_WORTH = {
  /** Your own yard, off everything else. */
  yard: 0.7,
  /** Ground above `highAt`, off a settlement; and above `thinAt`, anywhere. */
  high: 1.25,
  highAt: 25,
  thin: 1.6,
  thinAt: 60,
  /** Your feet in the water. */
  water: 1.3,
  /** A mote swirl within `swirlReach` tiles. */
  swirl: 1.25,
  swirlReach: 3,
  /** Within `staleReach` tiles of anywhere you have sat since the woods last turned. */
  stale: 0.5,
  staleReach: 2,
  /** A Runestone within `stoneReach` tiles: of its nearest tile, centre to centre (`runestoneWithin`). */
  stone: 2,
  stoneReach: 5,
};

/** What is true of a spot, for what a sitting there is worth. */
export interface SitFacts {
  onDeed: boolean;
  /** The ground's height at the middle of the tile. */
  height: number;
  water: boolean;
  /** A mote swirl within `SIT_WORTH.swirlReach` tiles. */
  swirl: boolean;
  /** Sat within `SIT_WORTH.staleReach` tiles of here since the woods last turned. */
  stale: boolean;
  /** A Runestone within `SIT_WORTH.stoneReach` tiles. */
  stone: boolean;
}

/**
 * What a spot multiplies a sitting by, and what sitting there says: every
 * multiplier in one place, so a new one goes in here and nowhere else.
 * Somewhere quiet and out of the way is worth more than the middle of your
 * own yard. Every multiplier that applies multiplies the others: a sitting
 * beside a Runestone with your feet in the water is worth `SIT_WORTH.stone`
 * times `SIT_WORTH.water`. The island's `sit_place` is the same sum in the
 * same order, and says the same words.
 */
export function sitPlace(f: SitFacts): { place: number; where: string } {
  let place = 1;
  let where = 'You sit down and let the day go past.';
  if (f.onDeed) {
    place *= SIT_WORTH.yard;
    where = 'You sit in your own yard. It is hard to empty your head where there is so much to do.';
  }
  // High, wild ground is what the paths are walked on.
  if (f.height > SIT_WORTH.thinAt) {
    place *= SIT_WORTH.thin;
    where = 'You sit where the ground runs out and the air is thin, and the day goes past a long way below.';
  } else if (f.height > SIT_WORTH.highAt && !f.onDeed) {
    place *= SIT_WORTH.high;
    where = 'You sit on the high ground with your back to a stone.';
  }
  if (f.water) {
    place *= SIT_WORTH.water;
    where = 'You sit with your feet in the water and let it go past.';
  }
  if (f.swirl) {
    place *= SIT_WORTH.swirl;
    where += ` ${SIT_SWIRL_SAID}`;
  }
  if (f.stone) {
    place *= SIT_WORTH.stone;
    where += ` ${SIT_STONE_SAID}`;
  }
  if (f.stale) {
    place *= SIT_WORTH.stale;
    where += ` ${SIT_STALE_SAID}`;
  }
  return { place, where };
}

/** What a sitting beside a swirl says, after where it was sat. The island's `sit_swirl_said`. */
export const SIT_SWIRL_SAID = `A mote swirl turns within ${numberWord(SIT_WORTH.swirlReach)} tiles: ${share(SIT_WORTH.swirl - 1)} more.`;
/** And one beside a Runestone. The island's `sit_stone_said`. */
export const SIT_STONE_SAID = `A Runestone stands within ${numberWord(SIT_WORTH.stoneReach)} tiles: ${times(SIT_WORTH.stone)} as much.`;
/** And one near where you have sat today. The island's `sit_stale_said`. */
export const SIT_STALE_SAID = `You have sat within ${numberWord(SIT_WORTH.staleReach)} tiles of here since the woods last turned: ${share(SIT_WORTH.stale)} as much.`;

/**
 * Every place multiplier in one line, in `sitPlace`'s order, for the Faith
 * window's Path tab.
 */
export const SIT_PLACES_SAID = 'Where you sit multiplies the meditation and Calm a sitting gives: '
  + `your own yard ×${SIT_WORTH.yard}; ground over ${SIT_WORTH.highAt} high, off your settlement, ×${SIT_WORTH.high}, and over ${SIT_WORTH.thinAt} anywhere ×${SIT_WORTH.thin} instead; `
  + `your feet in the water ×${SIT_WORTH.water}; a mote swirl within ${numberWord(SIT_WORTH.swirlReach)} tiles ×${SIT_WORTH.swirl}; `
  + `a Runestone within ${numberWord(SIT_WORTH.stoneReach)} tiles ×${SIT_WORTH.stone}; `
  + `within ${numberWord(SIT_WORTH.staleReach)} tiles of anywhere you have sat since the woods last turned ×${SIT_WORTH.stale}. `
  + 'Every one that applies multiplies the others.';

/** Whether a spot is within `SIT_WORTH.staleReach` of any of these. */
export const satNear = (spots: ReadonlyArray<readonly [number, number]>, x: number, y: number): boolean =>
  spots.some(([sx, sy]) => Math.hypot(sx - x, sy - y) <= SIT_WORTH.staleReach);

/** The spots sat at since the woods last turned: none, once they have turned since (`satDawn`). */
export const satSince = (spots: ReadonlyArray<readonly [number, number]>, satDawn: number, dawn: number): ReadonlyArray<readonly [number, number]> =>
  (satDawn === dawn ? spots : []);

/** The facts of the spot you stand on. */
export function sitFacts(g: Game): SitFacts {
  const x = g.player.tileX;
  const y = g.player.tileY;
  const r = SIT_WORTH.swirlReach;
  let swirl = false;
  for (let dy = -r; dy <= r && !swirl; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (Math.hypot(dx, dy) <= r && g.swirlAt(x + dx, y + dy)) {
        swirl = true;
        break;
      }
    }
  }
  return {
    onDeed: g.onDeed(x, y),
    height: g.world.centerHeight(x, y),
    water: g.world.hasWater(x, y),
    swirl,
    stone: !!runestoneWithin(x, y, g.world.w, SIT_WORTH.stoneReach),
    stale: satNear(satSince(g.player.satSpots, g.player.satDawn, lastDawn(Date.now() / 1000)), x, y),
  };
}

/** What a sitting where you stand is worth: the meditation it trains and the Calm it banks. */
export function sittingWorth(g: Game): { gain: number; calm: number; place: number; where: string } {
  const { place, where } = sitPlace(sitFacts(g));
  return { gain: SIT_GAIN * place, calm: SIT_CALM * place, place, where };
}

/** What a sitting says when a blow lands in the middle of it (`stillness`). The island's `sitting_struck` says the same. */
export const STRUCK_SAID = 'You are struck, and the stillness goes. The sitting is over, and nothing comes of it.';

/* ---- What a moved path offers -------------------------------------------- */

export type PickKind = 'technique' | 'discipline';

export interface PathPickDef {
  /** `<path>_<name>`, which is what the island keeps. */
  id: string;
  path: PathId;
  /** One to `PATH_TIER_AT.length`. */
  tier: number;
  kind: PickKind;
  name: string;
  /** What it does, in the game's numbers. */
  note: string;
  /** Calm a technique costs; nought for a discipline. */
  cost: number;
  /** Seconds before a technique can be called again; nought for a discipline. */
  rest: number;
  /** The numbers behind what it does, by name, which the island reads off its row and the note is written from. */
  fx: Readonly<Record<string, number>>;
}

/** What calling a technique trains meditation by, as calling an ability of a path on its steps does. */
export const TECHNIQUE_GAIN = 0.2;

/** A game-hour: a twenty-fourth of the island's day. */
export const GAME_HOUR = DAY_SECONDS / 24;

const pickOf = (path: PathId) => (
  tier: number, kind: PickKind, id: string, name: string, cost: number, rest: number,
  fx: Record<string, number>, note: (fx: Record<string, number>) => string,
): PathPickDef => ({ id: `${path}_${id}`, path, tier, kind, name, cost, rest, fx, note: note(fx) });
const knowledge = pickOf('knowledge');
const love = pickOf('love');
const power = pickOf('power');

/**
 * The stages a tree is grown on by, in the order a tree grows: each living
 * stage to the next, so long as the next is alive and not the same stage over
 * again -- nothing is grown into dying, and a clipped tree stays clipped.
 * Bless the Land grows a tree by these (`patrons.ts`), and so does Love's
 * Bloom.
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
/** "sapling to young, young to mature, ...": the stages a tree is grown on by, as a note says them. */
export const LAND_GROWS_SAID = listed(LAND_GROWS.map(([a, b]) => `${ageName(a)} to ${ageName(b)}`));

/**
 * Every pick a moved path offers, tier by tier: at each, the technique first
 * and the two disciplines after it.
 *
 * Knowledge's are senses and information. Its techniques find a mote swirl,
 * read the wind ahead, find a buried hoard, make the next few goes certain and
 * sharpen everything learned for a while; its disciplines are more out of
 * every gain, the blood of any wildermon at a glance, further sight, a deeper
 * well of Calm, a day's first gain doubled, another mote a swirl, a map that
 * remembers further, a prospector's reach, sight that the dark leaves alone,
 * and knacks the oftener.
 *
 * Cartographer is the browser's alone, because the map you remember is: the
 * browser keeps it and tells the island what it has seen (`rpc_fog`), and
 * nothing on the island reads it. Keen Sight and Night Eyes are the browser's
 * too, which is where sight is worked out; the island keeps all three as
 * picks and sends them, and reads none.
 */
export const PATH_PICKS: PathPickDef[] = [
  knowledge(1, 'technique', 'seek', 'Seek', 10, 5 * 60, { reach: 200 },
    (fx) => `The nearest mote swirl within ${fx.reach} tiles of you is marked on your map and minimap until somebody collects it.`),
  knowledge(1, 'discipline', 'attentive', 'Attentive', 0, 0, { learn: 0.05 },
    (fx) => `Every skill gain you make is ${percent(fx.learn)} larger, added to your other bonuses rather than multiplying them.`),
  knowledge(1, 'discipline', 'reader', 'Reader', 0, 0, { blood: 1 },
    () => 'You read every trait in a wildermon’s blood at a glance, whatever your husbandry.'),

  knowledge(2, 'technique', 'sky', 'Read the Sky', 10, 10 * 60, { hours: 3 },
    (fx) => `Says where the wind will come from and how hard it will blow, as sails take it, at each of the next ${numberWord(fx.hours)} hours of the island’s clock. An hour of the island’s clock is ${spanWords(GAME_HOUR)}.`),
  knowledge(2, 'discipline', 'keen', 'Keen Sight', 0, 0, { sight: 1.25 },
    (fx) => `You see ${share(fx.sight - 1)} further, and the furthest anybody can see is ${share(fx.sight - 1)} further for you.`),
  knowledge(2, 'discipline', 'deep_calm', 'Deep Calm', 0, 0, { calm: 1.25 },
    (fx) => `The most Calm you can hold is ${share(fx.calm - 1)} higher: ${Math.floor(calmCap(PATH_TIER_AT[PATH_TIER_AT.length - 1], fx.calm))} at ${PATH_TIER_AT[PATH_TIER_AT.length - 1]} meditation rather than ${Math.floor(calmCap(PATH_TIER_AT[PATH_TIER_AT.length - 1]))}.`),

  knowledge(3, 'technique', 'trace', 'Trace', 25, 30 * 60, { reach: 40 },
    (fx) => `The nearest hoard buried for a treasure map in your pack, within ${fx.reach} tiles of you, is marked on your map and minimap until it is dug up.`),
  knowledge(3, 'discipline', 'quick_study', 'Quick Study', 0, 0, { first: 2 },
    (fx) => `The first gain in each skill on each day of the island’s clock is ${times(fx.first)} what it would be. A day of the island’s clock is ${spanWords(DAY_SECONDS)}.`),
  knowledge(3, 'discipline', 'lore', 'Elemental Lore', 0, 0, { motes: 1 },
    (fx) => `Collect motes gives ${numberWord(fx.motes)} more mote than your Elementalism would.`),

  knowledge(4, 'technique', 'foreknow', 'Foreknow', 40, 40 * 60, { goes: 5 },
    (fx) => `Your next ${numberWord(fx.goes)} goes at any job that rolls for success succeed: the roll is taken as a success.`),
  knowledge(4, 'discipline', 'cartographer', 'Cartographer', 0, 0, { reveal: 2 },
    (fx) => `Your map remembers the ground out to ${times(fx.reveal)} as far as you can see, round you as you walk.`),
  knowledge(4, 'discipline', 'deep_reading', 'Deep Reading', 0, 0, { further: 3 },
    (fx) => `Prospecting reads the ground ${numberWord(fx.further)} tiles further round you.`),

  knowledge(5, 'technique', 'clarity', 'Clarity', 60, 4 * 3600, { more: 0.5, secs: 600 },
    (fx) => `For ${spanWords(fx.secs)} every skill gain you make is ${percent(fx.more)} larger, added to your other bonuses rather than multiplying them.`),
  knowledge(5, 'discipline', 'night_eyes', 'Night Eyes', 0, 0, { dark: 0 },
    () => 'The dark takes nothing off how far you see.'),
  knowledge(5, 'discipline', 'polymath', 'Polymath', 0, 0, { knack: 1.5 },
    (fx) => `The chance that a go leaves a knack behind is ${times(fx.knack)} what it would be.`),

  /*
   * Love's are the living island: what follows you and what you keep, what
   * you tame and breed, and what grows. Its techniques see to hunger and
   * thirst, mend a companion, bring your wildermon to you, lull what is after
   * you and harden a companion for a fight; its disciplines quicken what is
   * sown, tame, age and breed better, fill a harvest, hold a companion to its
   * fight, make a knack last, grow a field through winter, make a tame of a
   * kind already tamed certain and grow the trees round a sitting.
   */
  love(1, 'technique', 'refresh', 'Refresh', 15, 20 * 60, {},
    () => 'Your hunger and thirst are both full at once.'),
  love(1, 'discipline', 'green_thumb', 'Green Thumb', 0, 0, { grow: 0.8 },
    (fx) => `A stage of anything sown on your settlement takes ${percent(1 - fx.grow)} less time.`),
  love(1, 'discipline', 'gentle_hand', 'Gentle Hand', 0, 0, { tame: 1.25 },
    (fx) => `Your chance to tame a wildermon is ${percent(fx.tame - 1)} higher: ${times(fx.tame)} what it would be.`),

  love(2, 'technique', 'bond', 'Bond', 20, 10 * 60, { reach: 10, heal: 0.4 },
    (fx) => `Your companion, the wildermon following you, regains ${percent(fx.heal)} of its health, if it is within ${fx.reach} tiles of you.`),
  love(2, 'discipline', 'kin', 'Kin', 0, 0, { 'kept:age': 0.75 },
    (fx) => `Wildermon you keep age ${percent(1 - fx['kept:age'])} slower: they stay young, and then grown, ${share(1 / fx['kept:age'] - 1)} longer.`),
  love(2, 'discipline', 'abundance', 'Abundance', 0, 0, { harvest: 1.25 },
    (fx) => `A crop harvested off a field or a planter, and fruit picked off a tree, comes to ${percent(fx.harvest - 1)} more.`),

  love(3, 'technique', 'gather', 'Gather', 15, 5 * 60, { reach: 30 },
    (fx) => `Every wildermon of yours within ${fx.reach} tiles of you, the one following you and those working your settlement, is beside you at once, as a call brings one. Those at work go back to it.`),
  love(3, 'discipline', 'steady_herd', 'Steady Herd', 0, 0, { steady: 1 },
    () => `Your companion never gives up a fight for how far from you it has gone: another gives one up ${COMPANION_LEASH} tiles from its keeper, or ${GUARD_RANGE} when it is guarding.`),
  love(3, 'discipline', 'long_table', 'Long Table', 0, 0, { table: 1.25 },
    (fx) => `A knack from food or drink lasts ${percent(fx.table - 1)} longer.`),

  love(4, 'technique', 'lull', 'Lull', 40, 30 * 60, { reach: 8, secs: 60 },
    (fx) => `Every creature within ${fx.reach} tiles of you that is hunting you stops, and starts no hunt for ${fx.secs} seconds unless you strike it.`),
  love(4, 'discipline', 'good_stock', 'Good Stock', 0, 0, { up: 0.1 },
    (fx) => `A young one you breed has ${Math.round(fx.up * 100)} points more chance, on each of its traits, to come out a grade better than it went in.`),
  love(4, 'discipline', 'seasons_hand', 'Season’s Hand', 0, 0, { winter: HAND_WINTER },
    (fx) => `A field you sow grows through winter at ${percent(fx.winter / SPRING_GROWTH)} of a spring field’s pace, where any other stands still until spring.`),

  love(5, 'technique', 'herd_heart', 'Heart of the Herd', 60, 3600, { secs: 600, reach: 10, cut: 0.3, more: 0.2 },
    (fx) => `For ${spanWords(fx.secs)}, your companion takes ${percent(fx.cut)} less damage and deals ${percent(fx.more)} more while it is within ${fx.reach} tiles of you.`),
  love(5, 'discipline', 'old_friend', 'Old Friend', 0, 0, { sure: 1 },
    () => 'Taming a kind of wildermon you have tamed before never fails: the first offering is taken.'),
  love(5, 'discipline', 'bloom', 'Bloom', 0, 0, { bloom: 5 },
    (fx) => `Once a day of the island’s clock, the first sitting you finish with a tree within ${fx.bloom} tiles of you grows every tree there a stage: ${LAND_GROWS_SAID}. One that would grow into dying, and one that is clipped, stays as it is. A day of the island’s clock is ${spanWords(DAY_SECONDS)}.`),

  /*
   * Power's are the body itself. Its techniques bring the wind back, make
   * deep water free, stop what is running out of you, put a turn of speed on
   * you and make wind free; its disciplines lighten a burden, lengthen a
   * stride, climb steeper and swim longer, turn more of a blow and more of a
   * heavy one, carry more, live through a killing blow, step down any drop
   * and keep hunger and thirst off longer. No damage: that is a fighting
   * trade's.
   */
  power(1, 'technique', 'second_wind', 'Second Wind', 15, 12 * 60, {},
    () => 'Your stamina is full at once.'),
  power(1, 'discipline', 'strong_back', 'Strong Back', 0, 0, { burden: 0.8 },
    (fx) => `Armour, and a load past what your back will take, burden you ${percent(1 - fx.burden)} less.`),
  power(1, 'discipline', 'long_stride', 'Long Stride', 0, 0, { stride: 1.05 },
    (fx) => `You walk ${percent(fx.stride - 1)} faster on your own feet.`),

  power(2, 'technique', 'deep_lungs', 'Deep Lungs', 20, 20 * 60, { secs: 300 },
    (fx) => `For ${spanWords(fx.secs)} swimming costs you no stamina.`),
  power(2, 'discipline', 'sure_feet', 'Sure Feet', 0, 0, { climb: 1.25 },
    (fx) => `The steepest step between tiles you can take on your own feet, up or down, is ${percent(fx.climb - 1)} higher, whatever your climbing.`),
  power(2, 'discipline', 'hard_breath', 'Hard Breath', 0, 0, { swim: 0.7 },
    (fx) => `Swimming costs you ${percent(1 - fx.swim)} less stamina.`),

  power(3, 'technique', 'shrug', 'Shrug', 25, 15 * 60, {},
    () => 'Every wound on you stops bleeding, a burn stops weeping, and the venom in any of them is gone. The wounds stay open until they are seen to.'),
  power(3, 'discipline', 'ironhide', 'Ironhide', 0, 0, { hide: 1.1 },
    (fx) => `What you wear turns ${percent(fx.hide - 1)} more of every blow.`),
  power(3, 'discipline', 'unshaken', 'Unshaken', 0, 0, { heavy: 0.5 },
    (fx) => `A creature’s heavy blow lands on you with ${share(fx.heavy)} its extra weight: ${1 + (HEAVY_HIT - 1) * fx.heavy} times an ordinary blow rather than ${HEAVY_HIT} times.`),

  power(4, 'technique', 'surge', 'Surge', 40, 30 * 60, { secs: 60, pace: 1.3 },
    (fx) => `For ${spanWords(fx.secs)} you walk ${percent(fx.pace - 1)} faster on your own feet, and nothing slows you: not a load, not the ground, a slope or a wounded leg, and not being out of wind.`),
  power(4, 'discipline', 'pack_mule', 'Pack Mule', 0, 0, { mule: 15 },
    (fx) => `You can carry ${fx.mule} kg more before a load weighs on you.`),
  power(4, 'discipline', 'hard_to_kill', 'Hard to Kill', 0, 0, { kill: 0.1, every: 3600 },
    (fx) => `At most once in ${spanWords(fx.every)}, a blow that would kill you leaves you at ${percent(fx.kill)} of your health instead.`),

  power(5, 'technique', 'unbroken', 'Unbroken', 60, 3600, { secs: 300 },
    (fx) => `For ${spanWords(fx.secs)} nothing costs you stamina: not work, a fight, swimming or a fighting trade’s spell.`),
  power(5, 'discipline', 'sure_fall', 'Sure Fall', 0, 0, { drop: 1 },
    () => 'On your own feet you can step down a drop of any height. A step up is still held to how steep you can climb.'),
  power(5, 'discipline', 'enduring', 'Enduring', 0, 0, { upkeep: 0.75 },
    (fx) => `Your hunger and thirst fall ${percent(1 - fx.upkeep)} slower.`),
];
export const PATH_PICK_BY_ID = new Map(PATH_PICKS.map((p) => [p.id, p]));
export const picksOf = (path: PathId, tier: number): PathPickDef[] => PATH_PICKS.filter((p) => p.path === path && p.tier === tier);
/** The techniques, which are what the path slot of the spell bar takes. */
export const TECHNIQUES = PATH_PICKS.filter((p) => p.kind === 'technique');

/** The meditation a tier opens at. */
export const pathTierAt = (tier: number): number => PATH_TIER_AT[tier - 1];

/**
 * Why a pick cannot be taken, or nothing: the same as the island's
 * `path_pick_refusal`, in the same order and words. No path, another path's,
 * a path still on its steps, already yours, another taken at that tier, or the
 * tier not open yet. `picks` is every pick there is, which the suite hands its
 * own.
 */
export function pathPickRefusal(
  p: PathPickDef, way: PathId | null, taken: readonly string[], meditation: number, picks: readonly PathPickDef[] = PATH_PICKS,
): string | null {
  if (!way) return `Choose a path first, at ${CHOOSE_AT} meditation.`;
  if (p.path !== way) return `That is ${PATHS[p.path].name}’s, and you walk ${PATHS[way].name}.`;
  if (!PATHS[way].moved) return `${PATHS[way].name} is still walked by its steps.`;
  if (taken.includes(p.id)) return 'You have that already.';
  const other = picks.find((o) => o.path === p.path && o.tier === p.tier && taken.includes(o.id));
  if (other) return `You took ${other.name} at this tier.`;
  const at = pathTierAt(p.tier);
  if (meditation < at) return `This tier opens at ${at} meditation; you have ${Math.floor(meditation)}.`;
  return null;
}

/** What a pick, once taken, says. The island's `rpc_take_path_pick` says the same. */
export const tookSaid = (p: PathPickDef): string => `${p.name}. ${p.note}`;

/** What reaching a tier says, at the rug. */
export const tierSaid = (path: PathId, tier: number): string =>
  `${PATHS[path].name}: tier ${tier} is open. Take one of ${listedOr(picksOf(path, tier).map((p) => p.name))} in the Faith window.`;

/* ---- What the techniques say ---------------------------------------------------------- */

/** Seek, finding one. */
export const seekSaid = (element: string, dist: number): string =>
  `The nearest mote swirl is ${dist} tiles off, ${article(element)} ${element} mote swirl. It is marked on your map.`;
/** And finding none, which costs nothing. */
export const seekNone = (reach: number): string => `There is no mote swirl within ${reach} tiles of you.`;
/** Trace, finding one. */
export const traceSaid = (dist: number): string => `A hoard buried for a map in your pack is ${dist} tiles off. It is marked on your map.`;
/** And finding none, which costs nothing. */
export const traceNone = (reach: number): string => `No hoard of a map in your pack is buried within ${reach} tiles of you.`;
/** Foreknow. */
export const foreknowSaid = (goes: number): string => `Your next ${numberWord(goes)} goes that roll for success will succeed.`;
/** Clarity. */
export const claritySaid = (secs: number, more: number): string => `For ${timeWords(secs)} every skill gain you make is ${percent(more)} larger.`;

/*
 * Love's and Power's, each said the same by the island's
 * `path_technique_cast`. A technique that finds nothing to work on is refused
 * and costs nothing, as a Seek that finds no swirl is.
 */
/** Refresh. */
export const REFRESH_SAID = 'You are neither hungry nor thirsty.';
/** Bond, mending a companion. */
export const bondSaid = (name: string, heal: number): string => `${name} regains ${percent(heal)} of its health.`;
/** And with none near, or one that is whole. */
export const bondNone = (reach: number): string => `No companion of yours is within ${reach} tiles of you.`;
export const bondWhole = (name: string): string => `${name} is not hurt.`;
/** How far from you Gather sets your wildermon down, round you in a ring. */
export const GATHER_RING = 0.8;
/** Where the `i`th of `n` wildermon a Gather brings stands, round (`x`, `y`): the island's `gather_spot`. */
export const gatherSpot = (x: number, y: number, i: number, n: number): [number, number] =>
  [x + Math.cos((2 * Math.PI * i) / n) * GATHER_RING, y + Math.sin((2 * Math.PI * i) / n) * GATHER_RING];
/** Gather. */
export const gatherSaid = (n: number, name: string): string =>
  (n === 1 ? `${name} is beside you.` : `${NumberWord(n)} of your wildermon are beside you.`);
export const gatherNone = (reach: number): string => `No wildermon of yours is within ${reach} tiles of you.`;
/** Lull. */
export const lullSaid = (n: number, secs: number): string =>
  (n === 1 ? `The one creature hunting you stops, and starts no hunt for ${secs} seconds unless you strike it.`
    : `The ${numberWord(n)} creatures hunting you stop, and start no hunt for ${secs} seconds unless you strike them.`);
export const lullNone = (reach: number): string => `Nothing within ${reach} tiles of you is hunting you.`;
/** Heart of the Herd. */
export const herdSaid = (name: string, secs: number, cut: number, more: number, reach: number): string =>
  `For ${timeWords(secs)} ${name} takes ${percent(cut)} less damage and deals ${percent(more)} more while it is within ${reach} tiles of you.`;
export const HERD_NONE = 'No companion follows you.';
/** Second Wind. */
export const SECOND_WIND_SAID = 'Your wind comes back all at once.';
/** Deep Lungs. */
export const deepLungsSaid = (secs: number): string => `For ${timeWords(secs)} swimming costs you no stamina.`;
/** Shrug, and with nothing to shrug off. */
export const SHRUG_SAID = 'Nothing on you is bleeding, weeping or carrying venom now.';
export const SHRUG_NONE = 'Nothing on you is bleeding, weeping or carrying venom.';
/** Surge. */
export const surgeSaid = (secs: number, pace: number): string => `For ${secs} seconds you walk ${percent(pace - 1)} faster, and nothing slows you.`;
/** Unbroken. */
export const unbrokenSaid = (secs: number): string => `For ${timeWords(secs)} nothing costs you stamina.`;
/** Hard to Kill, taking a killing blow. */
export const hardToKillSaid = (heal: number): string => `You should be dead. You are not: you stand at ${percent(heal)} of your health.`;
/** Bloom, after a sitting. */
export const bloomSaid = (n: number): string => `The trees round you grow while you sit: ${n} of them, a stage each.`;

/**
 * Read the Sky: the wind at each of the next `hours` game-hours from `time`,
 * as `windAt` will make it then, from where it comes and how hard as a share
 * of a gale, which is what a sail is worked out from. The island's `sky_said`.
 */
export function skySaid(seed: number, time: number, hours: number): string {
  const parts: string[] = [];
  for (let h = 1; h <= hours; h++) {
    const w = windAt(seed, time + h * GAME_HOUR);
    parts.push(`In ${h === 1 ? 'an hour' : `${numberWord(h)} hours`} the wind is from the ${windFrom(w)}: ${windWord(w.force)}, ${Math.round(w.force * 100)}% of a gale.`);
  }
  return parts.join(' ');
}

/**
 * Your path as the Faith window draws it: the island's answer (`faith_said`'s
 * `path`), or the same worked out here when you play by yourself (`pathSaid`).
 */
export interface PathSaid {
  way: PathId | null;
  meditation: number;
  calm: number;
  cap: number;
  /** Picks taken, in the order they were. */
  taken: string[];
  /** Why each pick of your path cannot be taken; null where it can. */
  picks: Record<string, string | null>;
}

/**
 * Your path as the island says it on the beat (`rpc_settle`'s `path`), for
 * the rules the browser works out itself -- sight, the map, a wildermon's
 * blood -- and the marks a technique left.
 */
export interface PathBeat {
  way?: PathId | null;
  picks?: string[];
  calm?: number;
  /** A Foreknow's goes left. */
  foreknow?: number;
  /** A Clarity's seconds left. */
  clarity?: number;
  /** Where you have sat since the woods last turned. */
  sat?: Array<[number, number]>;
  /** The day of the island's clock each skill last had its Quick Study gain. */
  studied?: Record<string, number>;
  seek?: { x: number; y: number } | null;
  trace?: { x: number; y: number } | null;
  /** Seconds left of a Heart of the Herd, a Deep Lungs, a Surge and an Unbroken. */
  herd?: number;
  lungs?: number;
  surge?: number;
  unbroken?: number;
  /** Seconds before a Hard to Kill is ready again; nought when it is. */
  hardToKill?: number;
}

/* ---- The rug ------------------------------------------------------------------ */

const rugDown = (g: Game): boolean => g.inventory.has('rug');

export const MEDITATION_ACTIONS: ActionDef[] = [
  {
    id: 'meditate',
    label: 'Sit and think about nothing',
    verb: 'sitting',
    skill: MEDITATION,
    stamina: 0,
    baseTime: 25,
    applies: (t, g) => t.kind === 'tile' && rugDown(g),
    check: (t, g) => {
      if (!rugDown(g)) return 'You need a rug to sit on.';
      const rest = g.player.satAt + SIT_REST - g.time;
      if (rest > 0) return `You have sat today and got what there was to get. ${Math.ceil(rest / 60)} minutes.`;
      return null;
    },
    perform: (t, g) => {
      const { gain, calm, where } = sittingWorth(g);
      const before = g.skills.get(MEDITATION);
      g.player.satAt = g.time;
      g.satHere();
      g.gainSkill(MEDITATION, gain);
      g.note('sat');
      const now = g.skills.get(MEDITATION);
      const cap = g.calmCap();
      g.player.calm = Math.min(cap, g.player.calm + calm);
      g.logMsg(`${where} Calm ${Math.floor(g.player.calm)} of ${Math.floor(cap)}.`, 'event');
      // And the trees round you, once a day, for Love's Bloom.
      const bloomed = g.bloomSitting();
      if (bloomed) g.logMsg(bloomSaid(bloomed), 'event');
      if (!g.player.way && now >= CHOOSE_AT && before < CHOOSE_AT) {
        g.logMsg(`Something settles. ${NumberWord(PATH_LIST.length)} ways of looking at all this have become clear, and you may walk exactly one of them. Choose from the rug.`, 'system');
      }
      const path = g.player.way;
      if (path && PATHS[path].moved) {
        PATH_TIER_AT.forEach((at, i) => {
          if (before < at && now >= at) {
            g.note('path');
            g.logMsg(tierSaid(path, i + 1), 'system');
          }
        });
      } else if (path) {
        for (const s of PATHS[path].steps) {
          if (before < s.at && now >= s.at) {
            g.note('path');
            g.logMsg(`${PATHS[path].name}: ${s.name}. ${s.note}`, 'system');
          }
        }
      }
    },
  },
  {
    id: 'choose_path',
    label: 'Choose a path',
    verb: 'choosing',
    hidden: true,
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => !g.player.way && g.skills.get(MEDITATION) >= CHOOSE_AT,
    check: (t, g) => {
      if (g.player.way) return 'You have chosen, and it is not the sort of thing that is chosen twice.';
      if (g.skills.get(MEDITATION) < CHOOSE_AT) return `Sit until you have ${CHOOSE_AT} meditation behind you.`;
      const id = t.kind === 'tile' ? (t.material as PathId | undefined) : undefined;
      if (!id || !PATHS[id]) return 'Choose one of the three.';
      return null;
    },
    perform: (t, g) => {
      const id = t.kind === 'tile' ? (t.material as PathId | undefined) : undefined;
      if (!id || !PATHS[id] || g.player.way) return;
      g.player.way = id;
      g.note('path');
      g.logMsg(`You take the path of ${PATHS[id].name}. ${PATHS[id].note}`, 'system');
    },
  },
  {
    id: 'use_ability',
    label: 'Call on what you know',
    verb: 'calling on it',
    hidden: true,
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => abilitiesOf(g.player.way, g.skills.get(MEDITATION)).length > 0,
    labelFor: (t, g) => {
      const id = t.kind === 'tile' ? t.material : undefined;
      const step = abilitiesOf(g.player.way, g.skills.get(MEDITATION)).find((s) => s.ability?.id === id);
      return step ? step.name : 'Call on what you know';
    },
    check: (t, g) => {
      const id = t.kind === 'tile' ? t.material : undefined;
      const step = abilitiesOf(g.player.way, g.skills.get(MEDITATION)).find((s) => s.ability?.id === id);
      if (!step?.ability) return 'That is not something you know.';
      const rest = (g.player.usedAt[step.ability.id] ?? -1e9) + step.ability.rest - g.time;
      if (rest > 0) return `${step.name} again in ${Math.ceil(rest / 60)} minutes.`;
      return null;
    },
    perform: (t, g) => {
      const id = t.kind === 'tile' ? t.material : undefined;
      const step = abilitiesOf(g.player.way, g.skills.get(MEDITATION)).find((s) => s.ability?.id === id);
      if (!step?.ability) return;
      g.player.usedAt[step.ability.id] = g.time;
      g.gainSkill(MEDITATION, TECHNIQUE_GAIN);
      g.note(`used:${step.ability.id}`);
      g.logMsg(g.workAbility(step.ability.id), 'event');
    },
  },
];
