import type { ActionDef } from './actions';
import type { Game } from './game';
import { itemDef } from './items';

/**
 * Fishing. A rod, a line and a bent strip of metal for a hook, and then the
 * only thing that matters is where you put it: what runs in the shallows is
 * not what runs off a drop-off, and what runs deep will not come up for a
 * beginner. Everything here is caught from the bank, so finding water with
 * depth to it close to something you can stand on is half the trade.
 */
export interface FishDef {
  id: string;
  name: string;
  /** Height units of water it will not be found in less than. */
  depth: number;
  /** Fishing skill it takes before one will come up at all. */
  level: number;
  /** How readily it takes a hook, against the others that could. */
  weight: number;
}

export const FISH: FishDef[] = [
  { id: 'minnow', name: 'Minnow', depth: 0, level: 1, weight: 30 },
  { id: 'perch', name: 'Perch', depth: 3, level: 1, weight: 24 },
  { id: 'trout', name: 'Trout', depth: 8, level: 15, weight: 16 },
  { id: 'pike', name: 'Pike', depth: 16, level: 35, weight: 9 },
  { id: 'sturgeon', name: 'Sturgeon', depth: 28, level: 60, weight: 3 },
];

export const FISH_BY_ID = new Map(FISH.map((f) => [f.id, f]));
export const isFish = (id: string): boolean => FISH_BY_ID.has(id);

/** How deep the water is on a tile, in height units; zero on dry land. */
export const waterDepth = (g: Game, x: number, y: number): number => (g.world.hasWater(x, y) ? Math.max(0, -g.world.centerHeight(x, y)) : 0);

/** Water worth putting a line into: deep enough to hold anything at all. */
export const fishable = (g: Game, x: number, y: number): boolean => g.world.inBounds(x, y) && waterDepth(g, x, y) >= 1;

/** What could be caught here by someone who knows this much. */
export const fishHere = (depth: number, skill: number): FishDef[] => FISH.filter((f) => depth >= f.depth && skill >= f.level);

/**
 * What comes up, or null for a bite that came off. Deeper water and a better
 * hand both help; the rarer fish are simply rarer wherever you stand.
 */
export function catchFish(g: Game, depth: number, rodQl: number): FishDef | null {
  const skill = g.skills.get('fishing');
  const pool = fishHere(depth, skill);
  if (!pool.length) return null;
  // A poor hand loses most of what takes the hook.
  if (g.rand() > Math.min(0.92, 0.3 + skill / 190 + rodQl / 320)) return null;
  let total = 0;
  for (const f of pool) total += f.weight;
  let roll = g.rand() * total;
  for (const f of pool) {
    roll -= f.weight;
    if (roll <= 0) return f;
  }
  return pool[0];
}

/** The best water within reach of where the player is standing. */
export function bestWaterNear(g: Game, range = 3): { x: number; y: number; depth: number } | null {
  let best: { x: number; y: number; depth: number } | null = null;
  const px = g.player.tileX;
  const py = g.player.tileY;
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const x = px + dx;
      const y = py + dy;
      if (!fishable(g, x, y)) continue;
      const depth = waterDepth(g, x, y);
      if (!best || depth > best.depth) best = { x, y, depth };
    }
  }
  return best;
}

/**
 * Where the line actually goes. Whatever was clicked is a hint: if it is
 * water you can reach from where you stand, it is fished; otherwise the
 * deepest water within a cast of your feet is, and if there is none you are
 * not standing anywhere worth fishing from.
 */
export function castAt(g: Game, x: number, y: number): { x: number; y: number; depth: number } | null {
  if (fishable(g, x, y) && Math.hypot(x + 0.5 - g.player.x, y + 0.5 - g.player.y) <= CAST) return { x, y, depth: waterDepth(g, x, y) };
  return bestWaterNear(g);
}

/** How far a line will go from where you are standing. */
export const CAST = 3.6;

export const FISHING_ACTIONS: ActionDef[] = [
  {
    id: 'fish',
    label: 'Fish',
    verb: 'fishing',
    skill: 'fishing',
    tool: 'fishing_rod',
    // A cast reaches; you do not walk out to the fish.
    range: CAST,
    repeat: true,
    stamina: 0.02,
    baseTime: 9,
    applies: (t, g) => {
      if (t.kind !== 'tile') return false;
      return fishable(g, t.x, t.y) || bestWaterNear(g) !== null;
    },
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (!g.inventory.has('fishing_rod')) return 'You need a fishing rod.';
      const spot = castAt(g, t.x, t.y);
      if (!spot) return 'There is no water within reach deep enough to hold anything. Walk to the bank.';
      if (!fishHere(spot.depth, g.skills.get('fishing')).length) return 'Nothing you could land runs in water this shallow.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const spot = castAt(g, t.x, t.y);
      if (!spot) return;
      const rodQl = g.toolQl('fishing_rod');
      g.gainSkill('fishing', 0.4);
      g.wearTool('fishing_rod', 0.5);
      const got = catchFish(g, spot.depth, rodQl);
      if (!got) {
        g.logMsg('Something takes it and comes off again.', 'event');
        return true;
      }
      const item = g.inventory.add(got.id, { ql: g.productQl('fishing', rodQl) });
      g.logMsg(`You land ${/^[aeiou]/i.test(got.name) ? 'an' : 'a'} ${got.name.toLowerCase()}. (QL ${item.ql.toFixed(1)})`, 'event');
      return true;
    },
  },
];

export const FISHING_ACTION_BY_ID = new Map(FISHING_ACTIONS.map((a) => [a.id, a]));
/** Told to the player when they look at water. */
export const fishingNote = (g: Game, x: number, y: number): string => {
  const depth = waterDepth(g, x, y);
  if (depth < 1) return '';
  const pool = fishHere(depth, g.skills.get('fishing'));
  return pool.length ? `Depth ${depth.toFixed(0)} · ${pool.map((f) => itemDef(f.id).name.toLowerCase()).join(', ')}` : `Depth ${depth.toFixed(0)} · nothing you could land`;
};
