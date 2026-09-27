import { tryGain } from './learn';
import type { ActionDef } from './actions';
import type { Game } from './game';
import { ITEM_DEFS, itemDef, markOf, RARITIES, RARITY_WORD, rollRarity } from './items';

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
  { id: 'offal', favours: ['trout', 'pike'], note: 'Offal cut from a carcass. Trout and pike come to it.' },
];
export const BAIT_BY_ID = new Map(BAITS.map((b) => [b.id, b]));
export const isBait = (id: string): boolean => BAIT_BY_ID.has(id);
/** How much harder a favoured fish bites: a bait is worth eight of it. */
export const BAIT_PULL = 8;
/** And how much less readily a fish comes to a bait it does not favour. */
export const BAIT_SHY = 0.35;
/**
 * What counts as food here: anything that fills you. A Fisher with Any Bait
 * puts the first of it they carry on the hook, or in a creel, when no bait
 * that favours a fish is carried; every fish comes to it at its plain weight.
 */
export const isFood = (id: string): boolean => (ITEM_DEFS[id]?.food ?? 0) > 0;

/**
 * Somebody's perks as they bear on a bite, key by key with the rule's own
 * number as the default: a Fisher's Strong Bait (`bait:pull`) and Big Fish
 * (`bite:<fish>`). A creel's are its setter's, which on an island is not
 * always whoever is looking; with nobody's, a bite is as it always was.
 */
export type PerkOf = (key: string, otherwise: number) => number;
const NOBODY: PerkOf = (_key, otherwise) => otherwise;

/**
 * The chance a fish that takes the hook stays on it: a floor, the hand, the
 * rod and something on the hook, and a Fisher's Steady Hand's points over
 * all of it, never past the most anybody lands. The island's `stays_on`.
 */
export const HOOK_BASE = 0.3;
export const HOOK_BAIT = 0.12;
export const HOOK_MOST = 0.95;
export const staysOn = (skill: number, rodQl: number, baited: boolean, plus = 0): number =>
  Math.min(HOOK_MOST, HOOK_BASE + skill / 190 + rodQl / 320 + (baited ? HOOK_BAIT : 0) + plus);

/** How deep the water is on a tile, in height units; zero on dry land. */
export const waterDepth = (g: Game, x: number, y: number): number => (g.world.hasWater(x, y) ? Math.max(0, -g.world.centerHeight(x, y)) : 0);

/** Water worth putting a line into: deep enough to hold anything at all. */
export const fishable = (g: Game, x: number, y: number): boolean => g.world.inBounds(x, y) && waterDepth(g, x, y) >= 1;

/** What could be caught here by someone who knows this much. */
export const fishHere = (depth: number, skill: number): FishDef[] => FISH.filter((f) => depth >= f.depth && skill >= f.level);

/**
 * What comes up, or null for a bite that came off. Deeper water and a better
 * hand both help; the rarer fish are simply rarer wherever you stand. Any
 * bait on the hook helps it stay on; only a bait that favours a fish draws it.
 */
export function catchFish(g: Game, depth: number, rodQl: number, bait?: string | null): FishDef | null {
  const skill = g.skills.get('fishing');
  const pool = fishHere(depth, skill);
  if (!pool.length) return null;
  const perk: PerkOf = (k, d) => g.perk(k, d);
  if (g.rand() > staysOn(skill, rodQl, !!bait, perk('hook:fish', 0))) return null;
  return pickFish(g, pool, bait ? BAIT_BY_ID.get(bait) : undefined, perk);
}

/** What a fish counts for in a pick, with whatever is on the hook and the fisher's perks counted in. */
export const biteWeight = (f: FishDef, b?: BaitDef, perk: PerkOf = NOBODY): number => {
  const w = f.weight * perk(`bite:${f.id}`, 1);
  if (!b) return w;
  const rank = b.favours.indexOf(f.id);
  return rank < 0 ? w * BAIT_SHY : w * ((BAIT_PULL * perk('bait:pull', 1)) / (rank + 1));
};

/** One fish out of a pool, weighted, with whatever is on the hook and the fisher's perks counted in. */
export function pickFish(g: Game, pool: FishDef[], b?: BaitDef, perk: PerkOf = NOBODY): FishDef | null {
  if (!pool.length) return null;
  let total = 0;
  for (const f of pool) total += biteWeight(f, b, perk);
  let roll = g.rand() * total;
  for (const f of pool) {
    roll -= biteWeight(f, b, perk);
    if (roll <= 0) return f;
  }
  return pool[0];
}

/**
 * The share of bites a fish is, in water that holds every fish, for a hand
 * that can land them all: what the help says a bait is worth, and what a
 * Fisher's perks make of it.
 */
export function biteShare(fish: string, bait?: string, perk: PerkOf = NOBODY): number {
  const b = bait ? BAIT_BY_ID.get(bait) : undefined;
  const total = FISH.reduce((n, f) => n + biteWeight(f, b, perk), 0);
  const f = FISH_BY_ID.get(fish);
  return f && total > 0 ? biteWeight(f, b, perk) / total : 0;
}

/**
 * The bait in the pack that is worth using here: the one favouring the best
 * fish available. With none, for a Fisher's Any Bait, the first food carried,
 * which draws nothing in particular. `def` is the bait's favours, when it has
 * any. The island's `bait_for`.
 */
export function baitFor(g: Game, depth: number): { id: string; def?: BaitDef } | null {
  const pool = fishHere(depth, g.skills.get('fishing'));
  if (!pool.length) return null;
  // A fish on the hook is a fish you are not eating, so the last one of
  // anything is left alone: you have to be able to spare it.
  const spare = (id: string): boolean => g.inventory.count(id) >= (isFish(id) ? 2 : 1);
  let best: { id: string; def: BaitDef; score: number } | null = null;
  for (const b of BAITS) {
    if (!spare(b.id)) continue;
    // Rate a bait by the rarest thing it brings up that actually swims here.
    let score = 0;
    for (const want of b.favours) {
      const f = pool.find((x) => x.id === want);
      if (f) score = Math.max(score, 100 - f.weight);
    }
    if (score > 0 && (!best || score > best.score)) best = { id: b.id, def: b, score };
  }
  if (best) return { id: best.id, def: best.def };
  if (g.perk('bait:food', 0) <= 0) return null;
  const food = g.inventory.items.find((it) => !it.locked && isFood(it.id) && spare(it.id));
  return food ? { id: food.id } : null;
}

/** How far a line is cast, in tiles each way. */
export const LINE_REACH = 3;

/** How far your line goes (a Fisher's Long Cast), and your net (their Wide Net), from where you stand. */
export const castReach = (g: Game): number => g.perk('reach:fish', CAST);
export const netReach = (g: Game): number => g.perk('reach:drag_net', NET_REACH);

/** The best water within reach of where the player is standing. */
export function bestWaterNear(g: Game, range = LINE_REACH): { x: number; y: number; depth: number } | null {
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
 * Where the line or the net actually goes. Whatever was clicked is a hint: if
 * it is water within `reach` of where you stand, it is fished; otherwise the
 * deepest water in the square of whole tiles that reach spans round your feet
 * is, and if there is none you are not standing anywhere worth fishing from.
 * The island's `cast_at`.
 */
export function castAt(g: Game, x: number, y: number, reach = castReach(g)): { x: number; y: number; depth: number } | null {
  if (fishable(g, x, y) && Math.hypot(x + 0.5 - g.player.x, y + 0.5 - g.player.y) <= reach) return { x, y, depth: waterDepth(g, x, y) };
  return bestWaterNear(g, Math.floor(reach));
}

/** A fish or two landed as themselves: rare ones on a pile of their own, said as they are. */
const said = (id: string, n: number, rare: number): string =>
  `${n} \u00d7 ${rare ? `${RARITIES[rare].name} ` : ''}${itemDef(id).name.toLowerCase()}`;

/**
 * What the water here holds for you, as a Fisher's Fishing Journal reads it
 * when the water is looked at: how deep it is, what share of the bites each
 * fish you could land is with the bait you would put on, and how often what
 * bites stays on with your rod. Empty without the perk, or where no fish
 * could swim. The island's `fish_journal`.
 */
export function fishJournal(g: Game, x: number, y: number): string {
  if (g.perk('fish_journal', 0) <= 0) return '';
  const depth = waterDepth(g, x, y);
  if (depth < 1) return '';
  const skill = g.skills.get('fishing');
  const pool = fishHere(depth, skill);
  const deep = `Depth ${Math.floor(depth + 0.5)}.`;
  if (!pool.length) return ` ${deep} Nothing you could land runs here.`;
  const bait = baitFor(g, depth);
  const perk: PerkOf = (k, d) => g.perk(k, d);
  const w = pool.map((f) => ({ f, w: biteWeight(f, bait?.def, perk) }));
  const total = w.reduce((n, x) => n + x.w, 0);
  const pc = (x: number): string => `${Math.floor(x * 100 + 0.5)}%`;
  const shares = w.sort((a, b) => b.w - a.w || (a.f.id < b.f.id ? -1 : 1)).map((x) => `${pc(x.w / total)} ${x.f.name.toLowerCase()}`);
  const on = staysOn(skill, g.toolQl('fishing_rod'), !!bait, g.perk('hook:fish', 0));
  return ` ${deep} ${bait ? `With the ${itemDef(bait.id).name.toLowerCase()} you carry` : 'With a bare hook'}, the bites here are `
    + `${shares.length < 2 ? shares[0] : `${shares.slice(0, -1).join(', ')} and ${shares[shares.length - 1]}`}, and ${pc(on)} of them stay on.`;
}

/** How far a line will go from where you are standing. */
export const CAST = 3.6;

/** How far a net is dragged, and how much water it wants under it. */
export const NET_REACH = 2.6;
export const NET_MIN_DEPTH = 1;
/** The least and the most a net brings up in one drag, before the roll. */
export const NET_LEAST = 1;
export const NET_HAUL = 5;

export const FISHING_ACTIONS: ActionDef[] = [
  {
    id: 'drag_net',
    label: 'Drag the net',
    verb: 'dragging the net',
    skill: 'fishing',
    tool: 'fishing_net',
    range: NET_REACH,
    rangeFor: netReach,
    // What a drag takes out of the net, a go of any other job being one. The island's `perform_fish` says the same.
    wear: 1.4,
    repeat: true,
    stamina: 0.09,
    baseTime: 16,
    applies: (t, g) => t.kind === 'tile' && g.inventory.has('fishing_net') && (fishable(g, t.x, t.y) || bestWaterNear(g, Math.floor(netReach(g))) !== null),
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (!g.inventory.has('fishing_net')) return 'You need a net.';
      const spot = castAt(g, t.x, t.y, netReach(g));
      if (!spot) return 'There is no water close enough to drag a net through. Wade in.';
      if (spot.depth < NET_MIN_DEPTH) return 'The water is too thin to drag a net through.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const spot = castAt(g, t.x, t.y, netReach(g));
      if (!spot) return;
      const netQl = g.toolQl('fishing_net');
      const pool = fishHere(spot.depth, g.skills.get('fishing'));
      if (!pool.length) {
        g.gainSkill('fishing', tryGain(false, NET_GAIN));
        g.logMsg('The net comes up with nothing in it but weed.', 'event');
        return true;
      }
      // A Fisher's Full Net hauls more before anything else is counted in.
      const hauled = NET_LEAST + Math.floor(g.rand() * (1 + (NET_HAUL - NET_LEAST) * (0.3 + Math.min(100, netQl) / 160)))
        + Math.floor(g.perk('haul:drag_net', 0));
      // And more of it for its maker's hand in the net (a Tailor's Fisher's Friend): the share over a
      // whole fish is a chance at one more, so the catch is that much more on the average.
      const more = hauled * markOf(g.inventory.tool('fishing_net') ?? {}, 'catch');
      const haul = more === hauled ? hauled : Math.floor(more) + (g.rand() < more - Math.floor(more) ? 1 : 0);
      const perk: PerkOf = (k, d) => g.perk(k, d);
      const odds = g.perk('rare:drag_net', 0);
      const got = new Map<string, { id: string; n: number; rare: number }>();
      for (let i = 0; i < haul; i++) {
        const f = pickFish(g, pool, undefined, perk);
        // A net takes numbers, not size: the big fish mostly go round it or through it.
        if (!f || (f.depth > 8 && g.rand() >= 0.12)) continue;
        // And now and then a rare one, for a Fisher's Rare Catch, on a pile of its own.
        const rare = odds > 0 ? rollRarity(() => g.rand(), odds) : 0;
        const key = `${f.id}:${rare}`;
        const had = got.get(key) ?? { id: f.id, n: 0, rare };
        had.n += 1;
        got.set(key, had);
      }
      if (!got.size) {
        g.gainSkill('fishing', tryGain(false, NET_GAIN));
        g.logMsg('The net comes up empty.', 'event');
        return true;
      }
      g.gainSkill('fishing', tryGain(true, NET_GAIN));
      const parts: string[] = [];
      const ql = g.productQl('fishing', netQl);
      g.note('netted');
      for (const { id, n, rare } of got.values()) {
        g.gather(id, { count: n, ql, rare });
        g.note(`fish:${id}`);
        parts.push(said(id, n, rare));
        if (rare) {
          g.note(RARITIES[rare].name);
          g.logMsg(RARITY_WORD[rare], 'skill');
        }
      }
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
    // A cast reaches; you do not walk out to the fish. A Fisher's Long Cast reaches further.
    range: CAST,
    rangeFor: castReach,
    // What a cast takes out of the rod, a go of any other job being one. The island's `perform_fish` says the same.
    wear: 0.5,
    repeat: true,
    stamina: 0.02,
    baseTime: 9,
    applies: (t, g) => {
      if (t.kind !== 'tile') return false;
      return fishable(g, t.x, t.y) || bestWaterNear(g, Math.floor(castReach(g))) !== null;
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
      // Something goes on the hook if anything worth using is in the pack.
      const bait = baitFor(g, spot.depth);
      if (bait && !g.inventory.find(bait.id)) return true;
      const got = catchFish(g, spot.depth, rodQl, bait?.id);
      // The bait goes with a landed fish, and with one that comes off unless a
      // Fisher's Bait Saver keeps it on the hook.
      if (bait && (got || !(g.perk('spare:fish', 0) > 0 && g.rand() < g.perk('spare:fish', 0)))) {
        const it = g.inventory.find(bait.id);
        if (it) g.inventory.remove(it.uid, 1);
      }
      // Written below the cast rather than above it: what comes off the hook
      // used to teach exactly what a landed fish taught.
      g.gainSkill('fishing', tryGain(!!got, ROD_GAIN));
      if (!got) {
        g.logMsg(bait ? `Something takes the ${itemDef(bait.id).name.toLowerCase()} and comes off again.` : 'Something takes it and comes off again.', 'event');
        return true;
      }
      // And now and then a rare one, for a Fisher's Rare Catch.
      const odds = g.perk('rare:fish', 0);
      const rare = odds > 0 ? rollRarity(() => g.rand(), odds) : 0;
      const item = g.gather(got.id, { ql: g.productQl('fishing', rodQl), rare });
      g.note(`fish:${got.id}`);
      if (bait) g.note('baited');
      g.logMsg(
        `You land ${rare ? `${/^[aeiou]/i.test(RARITIES[rare].name) ? 'an' : 'a'} ${RARITIES[rare].name}` : /^[aeiou]/i.test(got.name) ? 'an' : 'a'} `
          + `${got.name.toLowerCase()}${bait ? ` on the ${itemDef(bait.id).name.toLowerCase()}` : ''}. (QL ${item.ql.toFixed(1)})`,
        'event',
      );
      if (rare) {
        g.note(RARITIES[rare].name);
        g.logMsg(RARITY_WORD[rare], 'skill');
      }
      return true;
    },
  },
];

export const FISHING_ACTION_BY_ID = new Map(FISHING_ACTIONS.map((a) => [a.id, a]));
