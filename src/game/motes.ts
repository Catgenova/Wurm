/**
 * Elementalism, and the mote swirls it is learned from.
 *
 * A mote swirl is a small knot of motes turning over one tile: earth, wind,
 * fire, ice, dark, light, water or life. Nobody can pick one up or move it.
 * `SWIRLS_A_DAY` of them are put down at each turn of the woods, at tiles
 * drawn evenly over the whole map, and the day's swirls before them go:
 *
 *   * on a tile with water on it (`World.hasWater`: the sea, a pond, a pool)
 *     the swirl is water, on any island;
 *   * on land it is dark one time in `1 / SWIRL_DARK`, light one time in
 *     `1 / SWIRL_LIGHT`, and otherwise the element of the island of the chart
 *     it is on (`ISLAND_ELEMENT`), the same on every world: a world is laid
 *     over the chart by scale (`chartRegion`, the island's `region_at`), a
 *     game of your own as much as an island in Postgres. The chart gives every
 *     cell to some island, so there is no land on none; were there any, a
 *     swirl drawn there would be passed over, as a tree is;
 *   * never on a tile a tree stands on, nor inside a building, and never two
 *     on one tile.
 *
 * Collect motes, with bare hands and within arm's length, takes the swirl for
 * good and gives `motesFor` your Elementalism of that element's mote, and
 * trains Elementalism by a full go. Two people at one swirl: whoever finishes
 * first has it, and the other is told it is gone.
 *
 * A leaf on purpose, but for types: the game, the help, the items and the defs
 * dump all read it. The island has the same rules off the same numbers
 * (`swirl_day`, `swirl_refusal`, `perform_swirl` in the migrations) and says
 * the same words; `supabase/test/motes.ts` holds the two sides together.
 */
import type { ActionDef, Target } from './actions';
import type { Game } from './game';
import type { LightSource } from './light';
import { REGIONS } from '../world/regions';
import { chartRegion } from '../world/chart';
import { TILE_DEFS } from '../world/tiles';
import { article, capital, listed, numberWord } from './words';
import { runestoneAt } from './runestones';

/** The skill a mote swirl is collected with, and the only thing that trains it. */
export const ELEMENTALISM = 'elementalism';

/** Every element a mote can be, in the order they are listed. */
export const MOTE_ELEMENTS = ['earth', 'wind', 'fire', 'ice', 'dark', 'light', 'water', 'life'] as const;
export type MoteElement = (typeof MOTE_ELEMENTS)[number];

/** The elements an island's land can have: one each. */
export const LAND_ELEMENTS = ['earth', 'wind', 'fire', 'ice', 'life'] as const;
export type LandElement = (typeof LAND_ELEMENTS)[number];

/**
 * The element of each island of the chart's land, by the island's key in
 * `REGIONS`: fixed, and the same on every world. The island's
 * `region_element` is written from this.
 */
export const ISLAND_ELEMENT: Readonly<Record<string, LandElement>> = {
  Crescent: 'earth',
  NorthwestSteppe: 'wind',
  Volcano: 'fire',
  NortheastTundra: 'ice',
  MiddleIsle: 'life',
  EastIsle: 'life',
  WestSkerry: 'wind',
};

/** The item a swirl of this element gives. Not `mote`, which is the altar's (`sacrifice.ts`). */
export const moteItem = (e: MoteElement): string => `${e}_mote`;
/** And what it is called: "Fire mote". */
export const moteName = (e: MoteElement): string => `${capital(e)} mote`;
/** What a swirl is called on the ground: "Fire mote swirl". */
export const swirlName = (e: MoteElement): string => `${capital(e)} mote swirl`;

/** How many swirls each turn of the woods puts down, over the whole map. */
export const SWIRLS_A_DAY = 500;
/** Of swirls on land, the share that are dark, and the share that are light. */
export const SWIRL_DARK = 0.01;
export const SWIRL_LIGHT = 0.01;
/**
 * How many rounds a day draws tiles in: each round draws as many as are still
 * wanted, and keeps those with room. Past this many a day puts down what it
 * found, which on any map with land and water on it is all of them.
 */
export const SWIRL_TRIES = 4;
/**
 * How many tiles a round draws for each swirl still wanted. Drawing twice as
 * many as wanted and keeping the first of them with room fills a day in one
 * round wherever less than half the map is trees and buildings.
 */
export const SWIRL_DRAWS = 2;

/** What a swirl gives at Elementalism nought, one more for every `MOTES_STEP` points, to `MOTES_MOST`. */
export const MOTES_LEAST = 1;
export const MOTES_STEP = 20;
export const MOTES_MOST = 5;
/** The Elementalism a swirl gives the most from. */
export const MOTES_MOST_AT = (MOTES_MOST - MOTES_LEAST) * MOTES_STEP;
/** What one swirl gives at Elementalism `skill`, before the go trains it. The island's `motes_for`. */
export const motesFor = (skill: number): number => Math.min(MOTES_MOST, MOTES_LEAST + Math.floor(Math.max(0, skill) / MOTES_STEP));

/** The land element of the island at index `region` of `REGIONS`, or null for no island. The island's `region_element`. */
export const landElement = (region: number): LandElement | null => ISLAND_ELEMENT[REGIONS[region]?.key ?? ''] ?? null;
/**
 * What a swirl put down is: water on water, and on land dark for a roll under
 * `SWIRL_DARK`, light for one under that and `SWIRL_LIGHT` together, and the
 * land's own element otherwise -- and none at all on land that is no island's,
 * where the spot is passed over. The island's `swirl_element`.
 */
export const swirlElement = (water: boolean, land: LandElement | null, roll: number): MoteElement | null =>
  water ? 'water' : land === null ? null : roll < SWIRL_DARK ? 'dark' : roll < SWIRL_DARK + SWIRL_LIGHT ? 'light' : land;

/** The islands of the chart whose land swirls are this element, by name: "Middle Isle and East Isle". */
export const elementIslands = (e: MoteElement): string =>
  listed(REGIONS.filter((R) => ISLAND_ELEMENT[R.key] === e).map((R) => R.name.replace(/^The /, 'the ')));

/**
 * The colour each element's swirl throws after dark, as 'r, g, b' (`LightSource.cast`):
 * the ochre of earth, a pale grey-blue for wind, an ember's orange, ice blue,
 * violet, a warm white, water blue and leaf green.
 */
export const SWIRL_CAST: Record<MoteElement, string> = {
  earth: '214, 160, 86',
  wind: '206, 226, 236',
  fire: '255, 150, 60',
  ice: '160, 214, 255',
  dark: '150, 96, 210',
  light: '255, 240, 200',
  water: '90, 170, 240',
  life: '140, 220, 110',
};
/** How far a swirl's glow reaches, in tiles, and how hard it pushes the dark back at its middle: a small soft pool. */
export const SWIRL_REACH = 0.75;
export const SWIRL_GLOW = 0.24;

/** A swirl's glow after dark: drawn only, never asked about by any rule, soft as a spell's light. */
export const swirlLight = (s: Swirl): LightSource => ({
  x: s.x + 0.5,
  y: s.y + 0.5,
  radius: SWIRL_REACH,
  strength: SWIRL_GLOW,
  steady: true,
  soft: true,
  cast: SWIRL_CAST[s.element],
  castAlpha: 0.16,
});

/** One swirl, wherever it is. */
export interface Swirl {
  id: number;
  x: number;
  y: number;
  element: MoteElement;
}

/** A swirl as the island sends it, checked. */
export const swirlIn = (r: unknown): Swirl | null => {
  const s = r as { id?: unknown; x?: unknown; y?: unknown; element?: unknown } | null;
  if (!s || typeof s.id !== 'number' || typeof s.x !== 'number' || typeof s.y !== 'number') return null;
  if (!(MOTE_ELEMENTS as readonly unknown[]).includes(s.element)) return null;
  return { id: s.id, x: s.x, y: s.y, element: s.element as MoteElement };
};

/**
 * Whether a swirl can be put down on a tile: on the map, not where a tree
 * stands (a tile that blocks), not on a Runestone, and not inside a building. The island's
 * `swirl_day` asks the same.
 */
export function swirlRoom(g: Game, x: number, y: number): boolean {
  const w = g.world;
  if (!w.inBounds(x, y)) return false;
  if (TILE_DEFS[w.getTile(x, y)]?.blocks) return false;
  // Nor on a Runestone's ground (`runestones.ts`), which the island's `swirl_day` passes over too.
  if (runestoneAt(x, y, w.w)) return false;
  return !g.buildings.buildingAt(x, y);
}

/**
 * A day's swirls for a game of your own: tiles drawn evenly over the map,
 * `SWIRL_DRAWS` for each swirl still wanted a round for up to `SWIRL_TRIES`
 * rounds, each one asked `swirlRoom` and passed over if it has none or already
 * has a swirl, until there are `SWIRLS_A_DAY`. The land's element is the
 * island of the chart the tile's middle is on, the world laid over the chart
 * by scale as the island lays one (`chartRegion`). The island's `swirl_day`
 * draws the same way.
 */
export function laySwirls(g: Game, firstId: number, rand: () => number): Swirl[] {
  const w = g.world;
  const out: Swirl[] = [];
  const taken = new Set<number>();
  for (let round = 0; round < SWIRL_TRIES && out.length < SWIRLS_A_DAY; round++) {
    const draws = (SWIRLS_A_DAY - out.length) * SWIRL_DRAWS;
    for (let i = 0; i < draws && out.length < SWIRLS_A_DAY; i++) {
      const x = Math.floor(rand() * w.w);
      const y = Math.floor(rand() * w.h);
      const at = y * w.w + x;
      if (taken.has(at) || !swirlRoom(g, x, y)) continue;
      const element = swirlElement(w.hasWater(x, y), landElement(chartRegion(x + 0.5, y + 0.5, w.w)), rand());
      if (element === null) continue;
      taken.add(at);
      out.push({ id: firstId + out.length, x, y, element });
    }
  }
  return out;
}

/** What both sides say when a swirl will not be collected. */
export const SWIRL_SAID = {
  ground: 'Choose the ground.',
  nothing: 'There is nothing there.',
  gone: 'The mote swirl there is gone.',
} as const;

/** Why a swirl cannot be collected, or null when it can: the island's `swirl_refusal`, word for word. */
export function swirlRefusal(g: Game, t: Target): string | null {
  if (t.kind !== 'tile') return SWIRL_SAID.ground;
  if (!g.world.inBounds(t.x, t.y)) return SWIRL_SAID.nothing;
  if (!g.swirlAt(t.x, t.y)) return SWIRL_SAID.gone;
  return null;
}

/** "a fire mote", "three ice motes": what a swirl gave. */
export const motesWord = (n: number, e: MoteElement): string =>
  n === 1 ? `${article(e)} ${e} mote` : `${numberWord(n)} ${e} motes`;

/** What collecting says. The island's `perform_swirl` says the same. */
export const collectedSays = (n: number, e: MoteElement): string =>
  `You collect ${motesWord(n, e)} from the swirl, and it is gone.`;

/** What Examine says of a swirl over a tile. The island's `ground_says` says the same. */
export const swirlSays = (e: MoteElement): string =>
  ` ${capital(article(e))} ${e} mote swirl turns over it until the next turn of the woods.`;

export const MOTE_ACTIONS: ActionDef[] = [
  {
    id: 'collect_motes',
    label: 'Collect motes',
    // What it gives you, before the go trains you: "Collect three fire motes".
    labelFor: (t, g) => {
      const s = t.kind === 'tile' ? g.swirlAt(t.x, t.y) : undefined;
      return s ? `Collect ${motesWord(motesFor(g.skills.get(ELEMENTALISM)), s.element)}` : 'Collect motes';
    },
    verb: 'collecting motes',
    skill: ELEMENTALISM,
    stamina: 0.02,
    baseTime: 3,
    applies: (t, g) => t.kind === 'tile' && !!g.swirlAt(t.x, t.y),
    check: (t, g) => swirlRefusal(g, t),
    perform: (t, g) => {
      const s = t.kind === 'tile' ? g.swirlAt(t.x, t.y) : undefined;
      if (!s) {
        // Somebody else had it, or the day turned under the go: a go that found nothing.
        g.missed();
        g.logMsg(SWIRL_SAID.gone, 'error');
        return;
      }
      const n = motesFor(g.skills.get(ELEMENTALISM));
      g.takeSwirl(s.id);
      g.gather(moteItem(s.element), { count: n, ql: g.productQl(ELEMENTALISM) });
      g.logMsg(collectedSays(n, s.element), 'event');
    },
  },
];
