/**
 * What a crown wears through the island's year.
 *
 * Asked for with the year itself (`../world/calendar`): "add seasonal models
 * for trees". Four seasons of a week each, the same for everybody, read off
 * the wall clock -- the same clock the hud names the season by -- and turning
 * with the woods at dawn, so a tree's look changes once a day and not a
 * moment otherwise.
 *
 * - **Spring.** Leaf comes out fresh, lighter and yellower than summer's:
 *   thin on the first day, thicker on the second, full from the third. Every
 *   tree that bears fruit is in flower the whole week -- white, pale pink or
 *   deep pink by its kind, the cherry the pinkest -- over the new leaf.
 * - **Summer.** The look the island has always had: the canopies in
 *   `TREE_DEFS` are summer's.
 * - **Autumn.** Each broadleaf turns a colour of its own: patches of it in
 *   the green on the first two days, the whole crown from the third to the
 *   fifth, and on the last two the crown thinning as the leaves come down.
 * - **Winter.** The broadleaves stand bare, trunk, limbs and twigs grown into
 *   the shape their crown had, so a winter wood still reads kind by kind. The
 *   four that keep their leaves (`EVERGREEN`) keep them, a shade darker and
 *   cooler.
 *
 * Every living stage goes through it; a worn crown's dulling goes on over
 * whatever the season has made of it. Dead wood and stumps have no season.
 *
 * Only drawn. No rule asks what a tree looks like, and nothing here is kept.
 */
import { seasonAt, type Season } from '../world/calendar';
import { TREE_AGES, TREE_DEFS } from '../world/tiles';

/** The kinds that keep their leaves all year, by name. Every other kind is bare in winter. */
export const EVERGREEN: ReadonlySet<string> = new Set(['Pine', 'Cedar', 'Olive', 'Lemon']);

/** Whether a species keeps its leaves through the winter. */
export const evergreen = (species: number): boolean => EVERGREEN.has(TREE_DEFS[species]?.name ?? '');

/* ---- Blossom ---------------------------------------------------------------- */

/** Which of the three the brief named a tree's flower is. */
export type BloomFamily = 'white' | 'pale pink' | 'deep pink';

export interface Bloom {
  family: BloomFamily;
  /** Lit, body and underside, as a crown is painted. */
  tones: readonly [light: string, mid: string, deep: string];
  /** The middle of a flower, where it shows; null where the flower is too small to have one that reads. */
  eye: string | null;
  /**
   * How much of the crown is flower rather than leaf, 0 to 1. A cherry or a
   * plum flowers before it leafs and is a cloud of it; a lemon, an olive and
   * a fig carry their flowers among the leaves.
   */
  cover: number;
}

/**
 * By the fruit a tree bears. Botany, near enough: pears and plums flower
 * white, lemons white and waxy, olives a cream that is barely a flower at
 * all; apples, apricots and quinces pink-flushed white; peaches and
 * pomegranates a strong pink, the pomegranate's going over to coral; and the
 * cherry, which was asked to be the pinkest.
 *
 * A fig's flowers are inside the fruit and nobody ever sees them. It is given
 * the olive's cream at the olive's scatter so that every fruit tree answers
 * to spring, which is what was asked for.
 *
 * The colours are chalked to sit in this palette the way the canopies are,
 * and each tree's three are the same three a crown is painted in, so a crown
 * in flower keeps the light it had in leaf. The underside of a white one
 * goes to a cool lilac grey rather than to grey, which is what white does in
 * shadow in the pictures this is drawn from.
 */
export const BLOOMS: Readonly<Record<string, Bloom>> = {
  cherry: { family: 'deep pink', tones: ['#f7cadd', '#eb9dbf', '#bd6f93'], eye: '#c05683', cover: 0.9 },
  peach: { family: 'deep pink', tones: ['#f8d0d8', '#eda3b3', '#c3788b'], eye: '#b8506a', cover: 0.84 },
  pomegranate: { family: 'deep pink', tones: ['#f6cdc6', '#e99a93', '#bd6f6c'], eye: '#e0b25a', cover: 0.46 },
  apple: { family: 'pale pink', tones: ['#fdf1f2', '#f3d2da', '#cfa2b1'], eye: '#e4c25e', cover: 0.68 },
  apricot: { family: 'pale pink', tones: ['#fdf4f1', '#f4dad6', '#d0aba9'], eye: '#d9a05a', cover: 0.84 },
  quince: { family: 'pale pink', tones: ['#fcf0ef', '#f0d0d3', '#c99da6'], eye: '#e0c070', cover: 0.62 },
  pear: { family: 'white', tones: ['#fbf9f2', '#ebe7df', '#bdbac8'], eye: '#8e4f55', cover: 0.84 },
  plum: { family: 'white', tones: ['#fbf8f6', '#ece5e4', '#c1b6c8'], eye: '#e0bf5c', cover: 0.86 },
  lemon: { family: 'white', tones: ['#fbf9ee', '#ede9d8', '#c4c1bd'], eye: '#e6cf64', cover: 0.42 },
  olive: { family: 'white', tones: ['#fbf8e8', '#ebe5c8', '#c3bfa5'], eye: null, cover: 0.36 },
  fig: { family: 'white', tones: ['#fbfaf1', '#eceadb', '#c3c3b3'], eye: null, cover: 0.3 },
};

/** The flower of a species, or null for one that bears nothing. */
export function bloomOf(species: number): Bloom | null {
  const fruit = TREE_DEFS[species]?.fruit;
  return fruit ? BLOOMS[fruit] ?? null : null;
}

/**
 * Whether a tree of this species at this stage flowers when the season does:
 * one that fruits, old enough to (`bears`), and alive. A sapling or a young
 * tree is not in flower any more than it has fruit on it.
 */
export function blooms(species: number, variant: number): boolean {
  const age = TREE_AGES[variant] ?? TREE_AGES[0];
  return age.bears && age.alive && bloomOf(species) !== null;
}

/* ---- Autumn ------------------------------------------------------------------ */

/**
 * The colour each broadleaf turns, as a crown is painted: lit, body and
 * underside. Asked for as maple scarlet and orange, birch gold, oak russet,
 * willow yellow-green, and the fruit trees yellow, orange and red varied by
 * kind -- and chalked to the canopies' register, so a wood in autumn is warm
 * without shouting.
 */
export const AUTUMN: Readonly<Record<string, readonly [string, string, string]>> = {
  Birch: ['#eed89c', '#d8b660', '#9c8a4e'],
  Oak: ['#d8a686', '#b97a56', '#7e5846'],
  Maple: ['#f0b088', '#d86a50', '#9a4846'],
  Willow: ['#dcdc98', '#b8ba68', '#7e8a58'],
  Apple: ['#eac688', '#d09c5c', '#946e4c'],
  Cherry: ['#eaa68c', '#cb6c5a', '#8a4c4a'],
  Pear: ['#e4aa96', '#bf6e64', '#7e4a4e'],
  Plum: ['#d8a6a6', '#b2707c', '#744e5c'],
  Peach: ['#eed496', '#d6ac60', '#9a824c'],
  Fig: ['#e6dc9e', '#cab868', '#8e8450'],
  Pomegranate: ['#f0d890', '#d8b058', '#9c8448'],
  Apricot: ['#eeb88c', '#d38a58', '#946248'],
  Quince: ['#ecd68e', '#d2b258', '#968446'],
};

/* ---- The look of a day ---------------------------------------------------- */

/**
 * What a crown is on a day of the year.
 *
 * `palette` is the leaf, or null for none; `turning` is a second leaf laid in
 * patches over it for that share of the crown (autumn coming on); `full` is
 * how much of the crown is there at all, the bare wood showing through the
 * rest (leaf coming out, or coming down); `bloom` is the flower over the leaf.
 * `key` names the look, for a picture to be kept under.
 */
export interface Leafage {
  key: string;
  palette: readonly [string, string, string] | null;
  turning: { palette: readonly [string, string, string]; share: number } | null;
  full: number;
  bloom: Bloom | null;
  /**
   * What has come down and lies under it: how many, in which colours, and
   * whether they are leaves or petals. Petals gather through the week of
   * flower; leaves on the two days the crown is thinning.
   */
  litter: { tones: readonly [string, string, string]; n: number; leaf: boolean } | null;
}

const SUMMER: Leafage = { key: '', palette: null, turning: null, full: 1, bloom: null, litter: null };

/** How full a crown is on each day of spring as the leaf comes out, and of autumn as it comes down. */
export const LEAFING = [0.42, 0.74, 1, 1, 1, 1, 1] as const;
export const SHEDDING = [1, 1, 1, 1, 1, 0.64, 0.34] as const;
/** How much of a broadleaf's crown has turned on each day of autumn. */
export const TURNING = [0.3, 0.62, 1, 1, 1, 1, 1] as const;
/** How many days of spring the leaf takes to come out, of autumn the colour takes to come on, and of autumn the leaves take to come down. */
export const LEAF_DAYS = LEAFING.filter((v) => v < 1).length;
export const TURN_DAYS = TURNING.filter((v) => v < 1).length;
export const SHED_DAYS = SHEDDING.filter((v) => v < 1).length;
/** Petals lying under a tree in flower on each day of spring, and leaves under one on each day of autumn. */
export const PETALS_DOWN = [5, 7, 9, 11, 13, 15, 17] as const;
export const LEAVES_DOWN = [0, 0, 0, 0, 3, 14, 24] as const;

const hex = (c: string): [number, number, number] => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: string, b: string, k: number): string => {
  const [r1, g1, b1] = hex(a);
  const [r2, g2, b2] = hex(b);
  return toHex(r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k);
};

/**
 * New leaf: summer's crown taken toward a fresh yellow-green and lifted. A
 * crown that is not green in summer -- the cherry's bronze, the plum's
 * purple, the maple's apricot -- is lifted and only touched by the green,
 * since its new leaf is its own colour paler, not somebody else's.
 */
const FRESH = ['#e2eaa6', '#b8ce7a', '#809c5a'] as const;
function fresh(canopy: readonly [string, string, string]): [string, string, string] {
  const [r, g] = hex(canopy[1]);
  const k = g > r ? 0.42 : 0.14;
  return canopy.map((c, i) => mix(mix(c, FRESH[i], k), '#ffffff', 0.1)) as [string, string, string];
}

/**
 * The leaf that shows among blossom: the year's new green on every kind,
 * whatever its crown is in summer. Among white flowers the plum's purple and
 * the pear's olive read as stains on the flower rather than as leaf.
 */
export function newLeaf(canopy: readonly [string, string, string]): [string, string, string] {
  return canopy.map((c, i) => mix(mix(c, FRESH[i], 0.55), '#ffffff', 0.08)) as [string, string, string];
}

/** An evergreen in winter: darker and cooler. */
function wintry(canopy: readonly [string, string, string]): [string, string, string] {
  return canopy.map((c) => mix(c, '#34505c', 0.2)) as [string, string, string];
}

/** The season and its day at `now`, in epoch seconds: what every crown is worked out from. */
export function yearAt(now: number): { season: Season; day: number } {
  return seasonAt(now);
}

/**
 * What a tree of this species at this stage wears on a day of the year.
 * Shrivelled wood has no season; neither has anything this does not know.
 */
export function leafageOf(species: number, variant: number, season: Season, day: number): Leafage {
  // Asked of every tree drawn, every frame; worked out once a look.
  const k = ((species * 8 + variant) * 4 + SEASON_AT[season]) * 8 + day;
  let had = LOOKS.get(k);
  if (!had) {
    had = lookOf(species, variant, season, day);
    LOOKS.set(k, had);
  }
  return had;
}
const LOOKS = new Map<number, Leafage>();
const SEASON_AT: Record<Season, number> = { spring: 0, summer: 1, autumn: 2, winter: 3 };

function lookOf(species: number, variant: number, season: Season, day: number): Leafage {
  const def = TREE_DEFS[species];
  const age = TREE_AGES[variant] ?? TREE_AGES[0];
  if (!def || !age.alive || season === 'summer') return SUMMER;
  const i = Math.max(0, Math.min(6, day - 1));
  if (evergreen(species)) {
    // An evergreen that fruits still flowers: over the leaf it kept.
    const bloom = season === 'spring' && blooms(species, variant) ? bloomOf(species) : null;
    if (bloom) return { key: `b${i}`, palette: null, turning: null, full: 1, bloom, litter: { tones: bloom.tones, n: PETALS_DOWN[i], leaf: false } };
    if (season !== 'winter') return SUMMER;
    return { key: 'w', palette: wintry(def.canopy), turning: null, full: 1, bloom: null, litter: null };
  }
  if (season === 'spring') {
    const bloom = blooms(species, variant) ? bloomOf(species) : null;
    return {
      key: `s${LEAFING[i]}${bloom ? `b${i}` : ''}`, palette: fresh(def.canopy), turning: null, full: LEAFING[i], bloom,
      litter: bloom ? { tones: bloom.tones, n: PETALS_DOWN[i], leaf: false } : null,
    };
  }
  if (season === 'autumn') {
    const turned = AUTUMN[def.name] ?? def.canopy;
    const share = TURNING[i];
    const litter = LEAVES_DOWN[i] ? { tones: turned, n: LEAVES_DOWN[i], leaf: true } : null;
    return share >= 1
      ? { key: `a${i}`, palette: turned, turning: null, full: SHEDDING[i], bloom: null, litter }
      : { key: `t${share}`, palette: def.canopy, turning: { palette: turned, share }, full: 1, bloom: null, litter };
  }
  return { key: 'x', palette: null, turning: null, full: 0, bloom: null, litter: null };
}

/**
 * How much of a broadleaf's crown is coming down today, 0 to 1: what the
 * leaves falling round it are measured by. Only the last two days of autumn.
 */
export function shedding(species: number, variant: number, season: Season, day: number): number {
  const age = TREE_AGES[variant] ?? TREE_AGES[0];
  if (!age.alive || evergreen(species)) return 0;
  return shedOn(season, day);
}

/** How much of a broadleaf's crown is coming down on a day of the year, whatever the tree. */
export const shedOn = (season: Season, day: number): number =>
  season === 'autumn' ? 1 - SHEDDING[Math.max(0, Math.min(6, day - 1))] : 0;
/** The most there ever is: the last day of autumn. */
export const SHED_MOST = 1 - SHEDDING[6];

/* ---- Bushes ------------------------------------------------------------------ */

/**
 * The bushes go through the year by the same rules, where it costs nothing:
 * the rose and the thorn are bare in winter and turn in autumn, and lavender
 * keeps its leaves. What is in flower when: the thorn white through spring,
 * as a hawthorn is; roses and lavender from the fourth day of spring to the
 * end of summer; nothing in autumn, when the rose has hips on it and the
 * thorn its haws, and nothing in winter.
 */
export const BUSH_EVERGREEN: ReadonlySet<string> = new Set(['Lavender bush']);
const BUSH_AUTUMN: Readonly<Record<string, readonly [string, string]>> = {
  'Rose bush': ['#d0986a', '#9a5e44'],
  'Thorn bush': ['#d4845e', '#984a3e'],
};
/** What a bush flowers with, when it is not its own `flowers`. */
const BUSH_BLOSSOM: Readonly<Record<string, string>> = { 'Thorn bush': '#f3efe6' };
/** And what hangs on it in autumn. */
const BUSH_FRUIT: Readonly<Record<string, string>> = { 'Rose bush': '#c0584a', 'Thorn bush': '#9a3c42' };
/** The day of spring roses and lavender come into flower. */
export const BUSH_FLOWER_FROM = 4;

export interface BushYear {
  key: string;
  /** Its leaf, light and dark, or null when it is bare. */
  foliage: readonly [string, string] | null;
  /** How much of it is in leaf, the bare wood showing through the rest. */
  full: number;
  /** What is out on it, flowers or fruit, or null. */
  flowers: string | null;
}

const BUSH_LOOKS = new Map<number, BushYear>();

/** What a bush of this kind wears on a day of the year. */
export function bushYear(def: { name: string; foliage: readonly [string, string]; flowers?: string }, index: number, season: Season, day: number): BushYear {
  const k = (index * 4 + SEASON_AT[season]) * 8 + day;
  let had = BUSH_LOOKS.get(k);
  if (!had) {
    had = bushLook(def, season, day);
    BUSH_LOOKS.set(k, had);
  }
  return had;
}

function bushLook(def: { name: string; foliage: readonly [string, string]; flowers?: string }, season: Season, day: number): BushYear {
  const i = Math.max(0, Math.min(6, day - 1));
  const keeps = BUSH_EVERGREEN.has(def.name);
  const own = def.flowers ?? null;
  if (season === 'summer') return { key: '', foliage: def.foliage, full: 1, flowers: own };
  if (season === 'spring') {
    const flowers = BUSH_BLOSSOM[def.name] ?? (day >= BUSH_FLOWER_FROM ? own : null);
    if (keeps) return { key: `s${flowers ? 1 : 0}`, foliage: def.foliage, full: 1, flowers };
    const leaf = fresh([def.foliage[0], def.foliage[0], def.foliage[1]]);
    return { key: `s${i}`, foliage: [leaf[0], leaf[2]], full: LEAFING[i], flowers };
  }
  if (season === 'autumn') {
    if (keeps) return { key: 'a', foliage: def.foliage, full: 1, flowers: null };
    const turned = BUSH_AUTUMN[def.name] ?? def.foliage;
    const share = TURNING[i];
    const foliage: readonly [string, string] = share >= 1 ? turned : [mix(def.foliage[0], turned[0], share), mix(def.foliage[1], turned[1], share)];
    return { key: `a${i}`, foliage, full: SHEDDING[i], flowers: BUSH_FRUIT[def.name] ?? null };
  }
  if (keeps) {
    const w = wintry([def.foliage[0], def.foliage[0], def.foliage[1]]);
    return { key: 'w', foliage: [w[0], w[2]], full: 1, flowers: null };
  }
  return { key: 'x', foliage: null, full: 0, flowers: null };
}
