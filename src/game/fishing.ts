import { tryGain } from './learn';
import type { ActionDef } from './actions';
import type { Game } from './game';
import { itemDef } from './items';

/** What one cast and one sweep of the net teach, fish or no fish. */
export const ROD_GAIN = 0.4;
export const NET_GAIN = 0.55;

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

/**
 * Bait, and what comes to it.
 *
 * A bare hook catches whatever happens to be passing, which in practice means
 * minnows. Put something on it and you are fishing for a particular thing:
 * worms out of the dirt bring up perch, a live minnow brings up a pike, and a
 * pike takes a perch on the hook. It is a ladder, and every rung of it is
 * something you caught on the rung below.
 */
export interface BaitDef {
  /** The item put on the hook. */
  id: string;
  /** What it brings up, in the order it favours them. */
  favours: string[];
  note: string;
}

export const BAITS: BaitDef[] = [
  { id: 'worm', favours: ['perch', 'minnow'], note: 'Worms out of turned dirt. Everything small comes to them.' },
  { id: 'corn', favours: ['minnow', 'perch'], note: 'Corn, which is what you use when you have nothing better.' },
  { id: 'minnow', favours: ['pike', 'trout'], note: 'A live minnow. Nothing small enough to be eaten swims like that.' },
  { id: 'meat', favours: ['pike', 'trout'], note: 'Raw meat. A pike will come up out of the weed for it.' },
  { id: 'perch', favours: ['sturgeon', 'pike'], note: 'A whole perch on a hook, which is a lot of fish to give away for one that may not come.' },
];
export const BAIT_BY_ID = new Map(BAITS.map((b) => [b.id, b]));
export const isBait = (id: string): boolean => BAIT_BY_ID.has(id);
/** How much harder a favoured fish bites: a bait is worth eight of it. */
export const BAIT_PULL = 8;

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
export function catchFish(g: Game, depth: number, rodQl: number, bait?: string | null): FishDef | null {
  const skill = g.skills.get('fishing');
  const pool = fishHere(depth, skill);
  if (!pool.length) return null;
  // A poor hand loses most of what takes the hook; something on it helps.
  const b = bait ? BAIT_BY_ID.get(bait) : undefined;
  if (g.rand() > Math.min(0.95, 0.3 + skill / 190 + rodQl / 320 + (b ? 0.12 : 0))) return null;
  return pickFish(g, pool, b);
}

/** One fish out of a pool, weighted, with whatever is on the hook counted in. */
export function pickFish(g: Game, pool: FishDef[], b?: BaitDef): FishDef | null {
  if (!pool.length) return null;
  const weightOf = (f: FishDef): number => {
    if (!b) return f.weight;
    const rank = b.favours.indexOf(f.id);
    return rank < 0 ? f.weight * 0.35 : f.weight * (BAIT_PULL / (rank + 1));
  };
  let total = 0;
  for (const f of pool) total += weightOf(f);
  let roll = g.rand() * total;
  for (const f of pool) {
    roll -= weightOf(f);
    if (roll <= 0) return f;
  }
  return pool[0];
}

/** The bait in the pack that is worth using here: the one favouring the best fish available. */
export function baitFor(g: Game, depth: number): { id: string; def: BaitDef } | null {
  const pool = fishHere(depth, g.skills.get('fishing'));
  if (!pool.length) return null;
  let best: { id: string; def: BaitDef; score: number } | null = null;
  for (const b of BAITS) {
    // A fish on the hook is a fish you are not eating, so the last one of
    // anything is left alone: you have to be able to spare it.
    if (g.inventory.count(b.id) < (isFish(b.id) ? 2 : 1)) continue;
    // Rate a bait by the rarest thing it brings up that actually swims here.
    let score = 0;
    for (const want of b.favours) {
      const f = pool.find((x) => x.id === want);
      if (f) score = Math.max(score, 100 - f.weight);
    }
    if (score > 0 && (!best || score > best.score)) best = { id: b.id, def: b, score };
  }
  return best ? { id: best.id, def: best.def } : null;
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

/** How far a net is dragged, and how much water it wants under it. */
export const NET_REACH = 2.6;
export const NET_MIN_DEPTH = 1;
/** The most a net brings up in one drag, before the roll. */
export const NET_HAUL = 5;

export const FISHING_ACTIONS: ActionDef[] = [
  {
    id: 'drag_net',
    label: 'Drag the net',
    verb: 'dragging the net',
    skill: 'fishing',
    tool: 'fishing_net',
    range: NET_REACH,
    repeat: true,
    stamina: 0.09,
    baseTime: 16,
    applies: (t, g) => t.kind === 'tile' && g.inventory.has('fishing_net') && (fishable(g, t.x, t.y) || bestWaterNear(g, 2) !== null),
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (!g.inventory.has('fishing_net')) return 'You need a net.';
      const spot = fishable(g, t.x, t.y) && Math.hypot(t.x + 0.5 - g.player.x, t.y + 0.5 - g.player.y) <= NET_REACH ? { depth: waterDepth(g, t.x, t.y) } : bestWaterNear(g, 2);
      if (!spot) return 'There is no water close enough to drag a net through. Wade in.';
      if (spot.depth < NET_MIN_DEPTH) return 'The water is too thin to drag a net through.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const near = fishable(g, t.x, t.y) && Math.hypot(t.x + 0.5 - g.player.x, t.y + 0.5 - g.player.y) <= NET_REACH;
      const spot = near ? { depth: waterDepth(g, t.x, t.y) } : bestWaterNear(g, 2);
      if (!spot) return;
      const netQl = g.toolQl('fishing_net');
      g.wearTool('fishing_net', 1.4);
      // A net takes numbers, not size: the big fish go round it or through it.
      const pool = fishHere(spot.depth, g.skills.get('fishing')).filter((f) => f.depth <= 8 || g.rand() < 0.12);
      if (!pool.length) {
        g.gainSkill('fishing', tryGain(false, NET_GAIN));
        g.logMsg('The net comes up with nothing in it but weed.', 'event');
        return true;
      }
      const haul = 1 + Math.floor(g.rand() * (1 + (NET_HAUL - 1) * (0.3 + Math.min(100, netQl) / 160)));
      const got = new Map<string, number>();
      for (let i = 0; i < haul; i++) {
        const f = pickFish(g, pool);
        if (f) got.set(f.id, (got.get(f.id) ?? 0) + 1);
      }
      if (!got.size) {
        g.gainSkill('fishing', tryGain(false, NET_GAIN));
        g.logMsg('The net comes up empty.', 'event');
        return true;
      }
      g.gainSkill('fishing', tryGain(true, NET_GAIN));
      const parts: string[] = [];
      for (const [id, n] of got) {
        g.inventory.add(id, { count: n, ql: g.productQl('fishing', netQl) });
        g.note(`fish:${id}`);
        parts.push(`${n} \u00d7 ${itemDef(id).name.toLowerCase()}`);
      }
      g.note('netted');
      g.logMsg(`You walk the net round and haul it in: ${parts.join(', ')}.`, 'event');
      return true;
    },
  },
  {
    id: 'fish',
    label: 'Fish',
    verb: 'fishing',
    labelFor: (t, g) => {
      const spot = t.kind === 'tile' ? castAt(g, t.x, t.y) : null;
      const bait = spot ? baitFor(g, spot.depth) : null;
      return bait ? `Fish with ${itemDef(bait.id).name.toLowerCase()}` : 'Fish';
    },
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
      g.wearTool('fishing_rod', 0.5);
      // Something goes on the hook if anything worth using is in the pack.
      const bait = baitFor(g, spot.depth);
      if (bait) {
        const it = g.inventory.find(bait.id);
        if (it) g.inventory.remove(it.uid, 1);
        else return true;
      }
      const got = catchFish(g, spot.depth, rodQl, bait?.id);
      // Written below the cast rather than above it: what comes off the hook
      // used to teach exactly what a landed fish taught.
      g.gainSkill('fishing', tryGain(!!got, ROD_GAIN));
      if (!got) {
        g.logMsg(bait ? `Something takes the ${itemDef(bait.id).name.toLowerCase()} and comes off again.` : 'Something takes it and comes off again.', 'event');
        return true;
      }
      const item = g.inventory.add(got.id, { ql: g.productQl('fishing', rodQl) });
      g.note(`fish:${got.id}`);
      if (bait) g.note('baited');
      g.logMsg(
        `You land ${/^[aeiou]/i.test(got.name) ? 'an' : 'a'} ${got.name.toLowerCase()}${bait ? ` on the ${itemDef(bait.id).name.toLowerCase()}` : ''}. (QL ${item.ql.toFixed(1)})`,
        'event',
      );
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
