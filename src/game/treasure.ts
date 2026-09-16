/**
 * Treasure hunting: a map is a picture of somewhere, not a pair of numbers.
 *
 * Everything about a hunt lives here and is crossed into `treasure_def` and a
 * handful of scalar functions by `npm run defs`, so the island and the browser
 * cannot come to disagree about what a map is worth or what is guarding it.
 *
 * The one thing that is *not* here, and must never be, is where a particular
 * treasure is buried. That lives on the island in a table nothing may read,
 * and the browser is told a picture of the ground instead — which is the whole
 * mechanic. A waypoint would make it a chore.
 */

/**
 * The odds of a map turning up on any one spadeful or swing of a pick.
 *
 * One in a thousand, measured against `act_duration`, is a map every two to
 * seven hours of solid digging depending on how good you are at it:
 *
 *     dig,  skill 1,  QL60 shovel:  19.0 s  →  1000 digs = 5.3 hours
 *     dig,  skill 90:                6.8 s  →              1.9 hours
 *     mine, skill 1,  QL60 pickaxe: 25.3 s  →              7.0 hours
 *     mine, skill 90:                9.1 s  →              2.5 hours
 */
export const MAP_ODDS = 1 / 1000;

/**
 * And off a hostile, which is the other way one turns up.
 *
 * Scaled by what the thing was, so it is the size of the fight that pays
 * rather than the luck of it: `health / MAP_KILL_SCALE`, which comes out at a
 * goblin in thirty-five, an orc in fifteen, an ogre in eight and a dragon in
 * two. The wildermon are not in this — nothing you could have tamed drops a
 * map, and `species_def.monster` is already the line between the two.
 */
export const MAP_KILL_SCALE = 1400;

/** And never better than even, however big the thing was. */
export const MAP_KILL_CAP = 0.5;

/**
 * How far from where it turned up the treasure is buried.
 *
 * Far enough to be a journey and near enough that the picture is of ground you
 * have some chance of recognising. A hundred and fifty tiles is about four
 * minutes' walk.
 */
export const MAP_RANGE = 150;

/** How close you must stand to dig it up. */
export const UNEARTH_REACH = 2;

/** How many tiles a side the picture on the map covers. */
export const MAP_SNIPPET = 24;

/**
 * The bands the map tells you it is in, coarsest first.
 *
 * A distance and never a bearing. Told which way to walk, anybody would walk
 * it, and the picture would be decoration; told only that it is close, you
 * have to look at the ground. The nearest band is `UNEARTH_REACH` wide, so
 * "under your feet" means exactly "you may dig now".
 */
export const MAP_BANDS: Array<{ within: number; say: string }> = [
  { within: UNEARTH_REACH, say: 'The ground under your feet is the ground on the map.' },
  { within: 8, say: 'This is the place. It is within a few paces of you.' },
  { within: 25, say: 'You are close. Walk a little and look again.' },
  { within: 70, say: 'The lie of the land is beginning to match. Keep on.' },
  { within: 200, say: 'Something about this country is right, but not this part of it.' },
  { within: Infinity, say: 'Nothing here looks anything like the map.' },
];

/**
 * What a map of a given quality is a map to.
 *
 * Four tiers and four hostiles, one each, which is not a coincidence — a
 * treasure is guarded by something worth the trouble of getting to it, and
 * this island has exactly four things hostile enough to set to it. A dragon
 * over a grand hoard is a raid; that is what a grand hoard is for.
 *
 * `lumps` are drawn off `hoard_metal`, which is already what a dragon is
 * sleeping on when you butcher one — so a hoard is made of the same stuff
 * however it is come by.
 */
export interface TreasureTier {
  id: string;
  ord: number;
  /** Map quality at or above which this is the tier. */
  minQl: number;
  name: string;
  /** What is waiting, and how many of it. */
  guard: string;
  guards: number;
  /** Lumps of deep metal in the chest, and ordinary things beside them. */
  lumps: number;
  things: number;
}

export const TREASURE_TIERS: TreasureTier[] = [
  { id: 'worn', ord: 0, minQl: 0, name: 'worn map', guard: 'goblin', guards: 1, lumps: 1, things: 1 },
  { id: 'sound', ord: 1, minQl: 25, name: 'sound map', guard: 'orc', guards: 1, lumps: 2, things: 1 },
  { id: 'fine', ord: 2, minQl: 50, name: 'fine map', guard: 'ogre', guards: 1, lumps: 3, things: 2 },
  { id: 'grand', ord: 3, minQl: 75, name: 'grand map', guard: 'dragon', guards: 1, lumps: 6, things: 3 },
];

/** The tier a map of this quality belongs to. */
export function treasureTier(ql: number): TreasureTier {
  let got = TREASURE_TIERS[0];
  for (const t of TREASURE_TIERS) if (ql >= t.minQl) got = t;
  return got;
}

/**
 * How good a map you turn up, by your skill and the tool in your hand.
 *
 * Deliberately *not* `product_ql`, which every other thing out of the ground
 * uses. That one is a lottery rather than a curve — with a tool it is
 * `random() * 100 < tool_ql` for your full skill and **quality 1 otherwise**,
 * so a QL 60 shovel gives you a QL 1 result two times in five. That is the
 * right shape for a spadeful of dirt, which costs you twenty seconds. It is
 * the wrong shape for the one thing in a thousand spadefuls: five hours of
 * digging should not come back as a worn map because a coin landed badly.
 *
 * So: a floor that means even a beginner's map is worth walking to, skill
 * weighted a little above the tool, and a quarter either way of luck.
 */
export function mapQl(skill: number, toolQl: number, rand: () => number = Math.random): number {
  const base = 20 + 0.45 * Math.max(1, skill) + 0.35 * Math.max(0, toolQl);
  return Math.max(1, Math.min(100, base * (0.75 + rand() * 0.5)));
}

/**
 * And how good a map comes off a body, which has nothing to do with your tools.
 *
 * What was guarding the last one is what decides: a goblin was carrying a
 * scrap, a dragon was carrying something worth a dragon. Health is the only
 * number on `species_def` that says how big a thing is, and it is the one the
 * odds of the drop already use.
 */
export function mapQlFromBeast(health: number, rand: () => number = Math.random): number {
  return Math.max(1, Math.min(100, (12 + health / 8) * (0.8 + rand() * 0.4)));
}

/** The odds of a map at all off a body of this size. */
export function mapChanceFromBeast(health: number): number {
  return Math.min(MAP_KILL_CAP, health / MAP_KILL_SCALE);
}

/* ------------------------------------------------------------------ the game */

import type { Game } from './game';
import type { ActionDef } from './actions';
import { ITEM_DEFS, rollRarity, type Item } from './items';
import { canImprove } from './improve';
import { HOARD_METALS } from './butcher';

/**
 * The ordinary things in a hoard, beside the lumps: a tool or a blade.
 *
 * Everything worth bettering, less the furniture and the boats — which are
 * worth bettering too and are not things anybody buried. The suite's first
 * hoard came up with a cart and a chest in it. `category` already draws the
 * line, so there is no weight written down here to drift from the island's.
 */
export const HOARD_THINGS = Object.keys(ITEM_DEFS)
  .filter((id) => canImprove(id) && ITEM_DEFS[id].category === 'tool');

/**
 * A hoard in the ground, as the browser keeps one.
 *
 * On an island this lives in `treasure`, a table nothing may read. Here it is
 * in the save, which is not a hiding place at all — a single-player island is
 * the player's own machine and always was. The mechanic is the same either
 * way: the map shows you a picture, and you go and look.
 */
export interface Hoard {
  /** The map it belongs to. */
  uid: number;
  x: number;
  y: number;
  tier: string;
}

/** Does anybody's settlement reach this spot? */
export function deedCovers(g: Game, x: number, y: number): boolean {
  const near = [...(g.deed ? [g.deed] : []), ...g.neighbourDeeds];
  return near.some((d) => Math.abs(x - d.x) <= d.radius && Math.abs(y - d.y) <= d.radius);
}

/**
 * Somewhere to bury one: dry, walkable, inside the island, on nobody's deed.
 *
 * Sixty goes and then nothing, which is an honest answer — on a small or a
 * crowded island there may be no such spot, and a map to the sea would be
 * worse than no map at all.
 */
export function hoardSpot(g: Game, fromX: number, fromY: number): { x: number; y: number } | null {
  for (let i = 0; i < 60; i++) {
    const a = g.rand() * Math.PI * 2;
    // Scaled to the island: a hundred and fifty tiles is off the edge of a
    // small one, and every candidate would land in the sea.
    const reach = Math.min(MAP_RANGE, Math.max(4, Math.min(g.world.w, g.world.h) / 3));
    const r = reach * Math.sqrt(g.rand());
    const x = Math.floor(fromX + Math.cos(a) * r);
    const y = Math.floor(fromY + Math.sin(a) * r);
    if (x < 1 || y < 1 || x >= g.world.w - 1 || y >= g.world.h - 1) continue;
    if (g.world.centerHeight(x, y) < 4) continue;
    if (deedCovers(g, x, y)) continue;
    return { x, y };
  }
  return null;
}

/** Bury one, and put the map of it in the pack. */
export function buryTreasure(g: Game, ql: number, fromX: number, fromY: number): Item | null {
  const spot = hoardSpot(g, fromX, fromY);
  if (!spot) return null;
  const tier = treasureTier(ql);
  const map = g.inventory.add('treasure_map', { ql, extra: tier.id });
  g.hoards.push({ uid: map.uid, x: spot.x, y: spot.y, tier: tier.id });
  g.note('map');
  g.logMsg(`Oiled hide, folded small and waxed at the edge: a ${tier.name}. (QL ${ql.toFixed(1)})`
    + ' Read it to see what country it is a picture of.', 'skill');
  return map;
}

/**
 * Where a map points, now.
 *
 * "Now", because a deed may have gone in over it since it was drawn. The spot
 * moves rather than the map dying: refusing the dig would leave a dead map in
 * a pack with no recourse, and refusing the settlement would mean explaining a
 * refusal that cannot be explained without giving the spot away. Nobody
 * notices it move, because nobody ever had a coordinate to notice leaving.
 */
export function hoardOf(g: Game, uid: number): Hoard | undefined {
  const h = g.hoards.find((k: Hoard) => k.uid === uid);
  if (!h || !deedCovers(g, h.x, h.y)) return h;
  const moved = hoardSpot(g, h.x, h.y);
  if (moved) { h.x = moved.x; h.y = moved.y; }
  return h;
}

/** How warm you are: a band, and never a bearing. */
export function warmthOf(g: Game, h: Hoard): { here: boolean; say: string } {
  const d = Math.hypot(g.player.x - (h.x + 0.5), g.player.y - (h.y + 0.5));
  const band = MAP_BANDS.find((b) => d <= b.within) ?? MAP_BANDS[MAP_BANDS.length - 1];
  return { here: d <= UNEARTH_REACH, say: band.say };
}

/** One spadeful or swing in a thousand comes up with something that is not dirt. */
export function maybeMap(g: Game, skill: string, tool?: string): void {
  if (g.rand() >= MAP_ODDS) return;
  buryTreasure(g, mapQl(g.skills.get(skill), tool ? g.toolQl(tool) : 0, g.rand),
    g.player.x, g.player.y);
}

/** And what a hostile was keeping, which is the other way one turns up. */
export function mapFromBeast(g: Game, health: number, x: number, y: number): void {
  if (g.rand() >= mapChanceFromBeast(health)) return;
  buryTreasure(g, mapQlFromBeast(health, g.rand), x, y);
}

export const TREASURE_ACTIONS: ActionDef[] = [
  {
    id: 'unearth',
    label: 'Dig it up',
    verb: 'digging',
    skill: 'digging',
    tool: 'shovel',
    stamina: 0.06,
    baseTime: 8,
    applies: (t, g) => t.kind === 'item' && g.inventory.get(t.uid)?.id === 'treasure_map',
    /*
     * The refusal *is* the search: a map that will not be dug tells you how
     * warm you are and nothing else. `MAP_BANDS` holds the sentences and is
     * crossed into `map_band`, so the island says the same words.
     */
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      const map = g.inventory.get(t.uid);
      if (map?.id !== 'treasure_map') return 'That is not a map.';
      const h = hoardOf(g, map.uid);
      if (!h) return 'The hide is worn blank. Whatever was drawn on it is gone.';
      const warm = warmthOf(g, h);
      return warm.here ? null : warm.say;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const map = g.inventory.get(t.uid);
      if (map?.id !== 'treasure_map') return;
      const h = hoardOf(g, map.uid);
      if (!h) return;
      const tier = TREASURE_TIERS.find((k) => k.id === h.tier) ?? TREASURE_TIERS[0];
      // What was left to watch it, before anything is worth picking up.
      for (let i = 0; i < tier.guards; i++) {
        g.creatures.spawn(tier.guard, h.x + 0.5, h.y + 0.5, 'wild', g.rand);
      }
      const goods: string[] = [];
      for (let i = 0; i < tier.lumps; i++) goods.push(HOARD_METALS[Math.floor(g.rand() * HOARD_METALS.length)]);
      for (let i = 0; i < tier.things; i++) goods.push(HOARD_THINGS[Math.floor(g.rand() * HOARD_THINGS.length)]);
      for (const id of goods) {
        const ql = Math.max(1, Math.min(100, map.ql * (0.7 + g.rand() * 0.5)));
        const rare = rollRarity(g.rand);
        g.dropOnGround(h.x, h.y, {
          uid: g.inventory.nextUid++, id, ql, dmg: 0, count: 1,
          rare: rare || undefined,
        });
      }
      g.inventory.remove(map.uid, 1);
      g.hoards = g.hoards.filter((k: Hoard) => k.uid !== map.uid);
      g.note('hoard');
      g.logMsg('The spade goes through rotten board and the hoard is open — '
        + `${tier.lumps} lump${tier.lumps === 1 ? '' : 's'} and ${tier.things} `
        + `thing${tier.things === 1 ? '' : 's'} lying where they fell.`
        + ' And something was left to watch over it.', 'event');
    },
  },
];
