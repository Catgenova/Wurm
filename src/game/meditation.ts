import type { ActionDef } from './actions';
import type { Game } from './game';
import { DAY_SECONDS, world } from './pace';
import { wellCap } from './wells';
import { windAt, windFrom, windWord } from './wind';
import { article, listedOr, NumberWord, numberWord, percent, share, spanWords, times, timeWords } from './words';
import { lastDawn } from '../world/tiles';

/**
 * Meditation, and the three paths.
 *
 * Sitting still on a rug and thinking about nothing is not obviously work,
 * and it is the slowest thing anybody does here. What comes of it is a
 * **path**: one of three ways of looking at the island, chosen once at
 * `CHOOSE_AT` meditation and never changed, and **Calm**, banked by every
 * sitting and spent on what the path teaches.
 *
 * **Love** is the gardener's path, **Knowledge** the reader's and **Power**
 * the plain one.
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
 * Knowledge has moved. Love and Power keep their old steps until they do: for
 * either of them to move, write its picks into `PATH_PICKS`, set `moved`, and
 * empty its `steps` with whatever reads them (`walks`).
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

/*
 * What each step of a path is worth, where it is a number. The rule that
 * reads one reads it from here, and so does the step's note, so the card and
 * the game cannot say different things.
 */
/** Green thumb: what a stage of anything sown on your settlement takes, of its usual time. */
export const GREEN_THUMB = 0.8;
/** Gentle hand: what your chance to tame is multiplied by. */
export const GENTLE_HAND = 1.25;
/** Mend the flesh: the share of your health it gives back. */
export const MEND_FLESH = 0.4;
/** Abundance: what a harvest is multiplied by. */
export const ABUNDANCE = 1.34;
/** Strong back: what armour and a load past your limit weigh on you, of what they would. */
export const STRONG_BACK = 0.8;
/** Hard hands: what everything you hit takes, over what it would. */
export const HARD_HANDS = 1.16;
/** Fury: how long it holds, in seconds, and what everything you hit takes while it does. */
export const FURY_SECS = 30;
export const FURY_MULT = 2;
/** Ironhide: what the share of a blow your armour turns is multiplied by. */
export const IRONHIDE = 1.1;

export const PATHS: Record<PathId, PathDef> = {
  love: {
    id: 'love',
    name: 'Love',
    note: 'The gardener’s way. Things grow for you, things trust you, and what is hurt mends.',
    moved: false,
    steps: [
      { at: 3, name: 'Green thumb', note: `A stage of anything sown on your settlement takes ${share(1 - GREEN_THUMB)} less time.` },
      { at: 12, name: 'Refresh', note: 'Hunger and thirst, both full, in a breath.', ability: { id: 'refresh', rest: 20 * 60, note: 'You are neither hungry nor thirsty.' } },
      { at: 25, name: 'Gentle hand', note: `Your chance to tame anything is ${share(GENTLE_HAND - 1)} higher.` },
      { at: 45, name: 'Mend the flesh', note: `Everything open on you closes, and ${share(MEND_FLESH)} of your health comes back.`, ability: { id: 'mendflesh', rest: 40 * 60, note: 'Wounds closed.' } },
      { at: 70, name: 'Abundance', note: `A harvest gives ${share(ABUNDANCE - 1)} more than it did.` },
    ],
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
    note: 'The plain way. You carry more, you hit harder, and less of what is aimed at you lands.',
    moved: false,
    steps: [
      { at: 3, name: 'Strong back', note: `Armour, and a load past what your back will take, burden you ${share(1 - STRONG_BACK)} less.` },
      { at: 12, name: 'Second wind', note: 'Your wind comes back all at once.', ability: { id: 'secondwind', rest: 12 * 60, note: 'Wind back.' } },
      { at: 25, name: 'Hard hands', note: `You hit ${share(HARD_HANDS - 1)} harder with anything, or with nothing.` },
      { at: 45, name: 'Fury', note: `For ${spanWords(FURY_SECS)} everything you hit takes ${times(FURY_MULT)} what it would.`, ability: { id: 'fury', rest: 40 * 60, note: 'Fury.' } },
      { at: 70, name: 'Ironhide', note: `What you are wearing turns ${share(IRONHIDE - 1)} more of every blow.` },
    ],
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
}

/**
 * What a spot multiplies a sitting by, and what sitting there says: every
 * multiplier in one place, so a new one (a Runestone's) goes in here and
 * nowhere else. Somewhere quiet and out of the way is worth more than the
 * middle of your own yard. The island's `sitting_worth` is the same sum in
 * the same order, and says the same words.
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
  if (f.stale) {
    place *= SIT_WORTH.stale;
    where += ` ${SIT_STALE_SAID}`;
  }
  return { place, where };
}

/** What a sitting beside a swirl says, after where it was sat. The island's `sit_swirl_said`. */
export const SIT_SWIRL_SAID = `A mote swirl turns within ${numberWord(SIT_WORTH.swirlReach)} tiles: ${share(SIT_WORTH.swirl - 1)} more.`;
/** And one near where you have sat today. The island's `sit_stale_said`. */
export const SIT_STALE_SAID = `You have sat within ${numberWord(SIT_WORTH.staleReach)} tiles of here since the woods last turned: ${share(SIT_WORTH.stale)} as much.`;

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
