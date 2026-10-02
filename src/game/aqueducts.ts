import type { ActionDef, Target } from './actions';
import { isDone } from './building';
import { BRIDGES, bridgeDone, CLEARANCE, PULL_REACH, pullDownRefusal, spanTiles, spanWants, type Bridge } from './bridges';
import type { Game } from './game';
import { greenNow } from './greening';
import { itemDef } from './items';
import { rankAtLeast } from './ranks';
import { POND_MOST, pondFull, poolLevel, settleChain, springCorner, SPRING_DEPTH, type Chain, type Stream } from '../world/springs';
import { AQUEDUCT_FLOW, CHANNEL_DEEP, fillSeconds, FOUNTAIN_RIM, pondRate, type Channel } from '../world/aqueducts';
import { TileType } from '../world/tiles';

/**
 * Aqueducts: a stone arch whose deck is a channel, carrying a spring's water
 * from a pond or a pool at its head across whatever is between to a basin at
 * its foot -- a pool, a pond, a fountain, or a hollow for it to fill.
 *
 * It is a bridge in every way a bridge is kept -- spans laid one at a time,
 * pulled down for half of what went into it -- and in none of the ways one is
 * walked: its deck is water between two parapets, and nobody goes up on it.
 * What its water does is the springs' business (`../world/aqueducts`); this is
 * setting one out, building it and taking it down, and what is said about it.
 *
 * It is set out from the basin it pours into, pointed at, with the water it
 * draws from chosen among what lies straight out from there
 * (`aqueductHeads`). Its channel is carried at the height the water at its
 * head stands when it is set out, and it never moves after.
 */

/** The bridge kind an aqueduct is kept as. */
export const AQUEDUCT = BRIDGES.aqueduct;

/** What is at each end of an aqueduct, as it is set out. */
export type HeadKind = 'pond' | 'pool';
export type FootKind = 'pond' | 'pool' | 'fountain' | 'hollow';

/** An aqueduct that may be set out: its channel's height, what it draws from and pours into, and where the water at its foot stands or will. */
export interface AqueductPlan {
  height: number;
  head: HeadKind;
  foot: FootKind;
  level: number;
}

export const AQ_STRAIGHT = 'An aqueduct runs straight: its head due north, south, east or west of the tile it pours into.';
export const AQ_BESIDE = 'That water is right beside it: there is nothing for an aqueduct to carry it over.';
export const AQ_SEA_HEAD = 'The sea is below everything: an aqueduct carries a spring\'s water, from a pond or a pool.';
export const AQ_DRY_HEAD = 'There is no pond or pool there for an aqueduct to draw from.';
export const AQ_SLAB_FOOT = 'Dig a pool in the foundation first: the water would run straight off its top.';
export const AQ_SEA_FOOT = 'An aqueduct pours into a pool, a pond, a fountain or a hollow, not the sea.';
export const AQ_FLAT = `Water poured here would run straight off downhill: the foot of an aqueduct wants a pool, a pond, a fountain, or a hollow that holds ${(SPRING_DEPTH / 10).toFixed(1)} m of water or more.`;
export const AQ_WIDE = `That hollow is too wide ever to fill: a pond spreads over ${POND_MOST} corners at most.`;
export const AQ_SAME = 'That is the water it would draw from.';
export const AQ_END_BRIDGED = 'A bridge is carried over one end of it already.';
/** Why "Throw a bridge across" will not make one: an aqueduct is set out from where it pours. */
export const AQ_NOT_THROWN = 'An aqueduct is set out from the pool, pond, fountain or hollow it pours into, not thrown from a bank.';
export const aqSpan = (n: number): string => `An aqueduct spans ${AQUEDUCT.span} tiles; that is ${n}.`;
export const aqDeed = (name: string): string => `That is part of ${name}. Only its builders may lead water from it or to it.`;
export const aqUphill = (level: number, height: number): string =>
  `The water there stands at ${level}, over the ${height} its head stands at: water only runs downhill.`;
/** What stands too high under a span: the ground, a foundation's top, or the water in a pool dug in one. */
export type UnderKind = 'ground' | 'foundation' | 'pool';
const UNDER_WORD: Record<UnderKind, [string, string]> = {
  ground: ['The ground', 'the ground'], foundation: ['The foundation', 'a foundation'], pool: ['The water in the pool', 'the water'],
};
export const aqGround = (x: number, y: number, what: UnderKind = 'ground'): string =>
  `${UNDER_WORD[what][0]} at ${x}, ${y} stands within ${(CLEARANCE / 10).toFixed(1)} m of the channel's bed: an aqueduct is carried over ${UNDER_WORD[what][1]}, not through it.`;
/** A tree or a bush where a span would stand over it: it would grow up through the arches. */
export const aqGrowing = (x: number, y: number, what: 'tree' | 'bush'): string => `A ${what} stands at ${x}, ${y}, under where a span would go. Cut it down first.`;
/** The water at the head drawn from by another aqueduct already, which takes all of it: by the tile that one draws from. */
export const aqTaken = (x: number, y: number): string => `The aqueduct from ${x}, ${y} draws from that water already.`;
/** The head and the foot of an aqueduct that is there already. */
export const AQ_THERE = 'An aqueduct already runs from there to here.';
/** What is said of a tile an aqueduct's span is carried over, where a building, a pour, a pool or a tree would stand. */
export const AQ_OVER = 'An aqueduct is carried over that tile.';

/** A number of seconds as a fill is said: to the second under a minute and a half, and to the minute from there. The island's `fill_words`. */
export function fillWords(secs: number): string {
  const s = Math.floor(secs + 0.5);
  if (s < 90) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.floor(secs / 60 + 0.5);
  const h = Math.floor(m / 60);
  const mi = m % 60;
  const unit = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
  return h ? (mi ? `${unit(h, 'hour')} and ${unit(mi, 'minute')}` : unit(h, 'hour')) : unit(mi, 'minute');
}

/** Whose settlement a tile is, where the one asking may not shape it: the island's `may_shape`. */
function notYours(g: Game, x: number, y: number): string | null {
  const mine = g.deedOfMineAt(x, y);
  const d = mine ? (rankAtLeast(mine.role, 'builder') ? null : mine) : g.deedAt(x, y);
  return d ? d.name : null;
}

/**
 * Whether an aqueduct may be led from the water in one tile to the basin in
 * another, and if so what it is: or why not, in these words, which the island
 * says the same (`aqueduct_reason`), in the same order.
 */
export function aqueductPlan(g: Game, sx: number, sy: number, tx: number, ty: number): AqueductPlan | string {
  const w = g.world;
  if (!w.inBounds(sx, sy) || !w.inBounds(tx, ty)) return 'Not there.';
  if ((sx !== tx && sy !== ty) || (sx === tx && sy === ty)) return AQ_STRAIGHT;
  const span = spanTiles(sx, sy, tx, ty);
  if (!span.length) return AQ_BESIDE;
  if (span.length > AQUEDUCT.span) return aqSpan(span.length);
  for (const [x, y] of [[sx, sy], [tx, ty]]) {
    const name = notYours(g, x, y);
    if (name) return aqDeed(name);
  }
  const water = w.water;
  const height = (x: number, y: number): number | null => (w.cornerInBounds(x, y) ? w.getHeight(x, y) : null);
  // The head: a pool, or a spring's pond.
  let head: HeadKind;
  let top: number;
  const hs = g.slabAt(sx, sy);
  if (hs?.pool) {
    head = 'pool';
    top = poolLevel(hs.top);
  } else if (water?.pondsAt(sx, sy).length) {
    head = 'pond';
    top = Math.max(...water.pondsAt(sx, sy).map((p) => p.level));
  } else return w.hasSea(sx, sy) ? AQ_SEA_HEAD : AQ_DRY_HEAD;
  // The foot: a pool, a fountain, a pond, or a hollow that would hold one.
  let foot: FootKind;
  let level: number;
  const fs = g.slabAt(tx, ty);
  if (fs && !fs.pool) return AQ_SLAB_FOOT;
  if (fs?.pool) {
    foot = 'pool';
    level = poolLevel(fs.top);
  } else if (g.furnitureOnTile(tx, ty).some((f) => f.kind === 'fountain')) {
    foot = 'fountain';
    // To the nearest unit, as a pond's and a pool's water stand.
    level = Math.floor(g.surfaceHeight(tx, ty) + FOUNTAIN_RIM + 0.5);
  } else if (water?.pondsAt(tx, ty).length) {
    foot = 'pond';
    level = Math.max(...water.pondsAt(tx, ty).map((p) => p.level));
  } else if (w.hasSea(tx, ty)) {
    return AQ_SEA_FOOT;
  } else {
    const [cx, cy] = springCorner((x, y) => w.getHeight(x, y), tx, ty);
    const r = settleChain(height, cx, cy);
    if (r === 'wide') return AQ_WIDE;
    if (typeof r === 'string') return AQ_FLAT;
    foot = 'hollow';
    level = r.ponds[0].level;
  }
  // Not the water it draws from: one pool, or one pond, under both ends.
  if (head === 'pool' && foot === 'pool') {
    const [cx, cy] = springCorner((x, y) => w.getHeight(x, y), sx, sy);
    const r = settleChain(height, cx, cy, g.springs.slabs, [sx, sy]);
    const tiles = typeof r === 'string' ? [] : r.ponds[0].tiles ?? [];
    for (let k = 0; k < tiles.length; k += 2) if (tiles[k] === tx && tiles[k + 1] === ty) return AQ_SAME;
  }
  if (head === 'pond' && foot === 'pond' && water) {
    const there = water.pondsAt(tx, ty);
    for (const p of water.pondsAt(sx, sy)) if (there.some((q) => q.spring === p.spring && q.index === p.index)) return AQ_SAME;
  }
  // Not the line of one there already.
  if ([...g.bridges.values()].some((b) => b.kind === 'aqueduct' && b.ax === sx && b.ay === sy && b.bx === tx && b.by === ty)) return AQ_THERE;
  // Not water another aqueduct draws from already: the first of them takes all of it.
  const other = drawsAlready(g, sx, sy, head);
  if (other) return aqTaken(other.ax, other.ay);
  if (level > top) return aqUphill(level, top);
  if (g.bridgeAt(sx, sy) || g.bridgeAt(tx, ty)) return AQ_END_BRIDGED;
  for (const [x, y] of span) {
    if (g.bridgeAt(x, y)) return 'Something is already bridged across there.';
    if (g.buildings.buildingAt(x, y)) return 'Not over a building.';
    // Nor through a building's jetty, as a bridge is not (`frame.ts`).
    if (g.buildings.jettyAt(x, y)) return "Not over a building's jetty.";
    const ground = w.getTile(x, y);
    if (ground === TileType.Tree || ground === TileType.Bush) return aqGrowing(x, y, ground === TileType.Tree ? 'tree' : 'bush');
    if (top - CHANNEL_DEEP - g.surfaceHeight(x, y) < CLEARANCE) {
      const slab = g.slabAt(x, y);
      return aqGround(x, y, slab ? (slab.pool ? 'pool' : 'foundation') : 'ground');
    }
  }
  return { height: top, head, foot, level };
}

/**
 * The aqueduct already drawing from the water at a tile, set out or built, the
 * first by id: one whose head is in the same pool (every pool joined to it), or
 * in the same spring's pond. The island's `aqueduct_draws`.
 */
export function drawsAlready(g: Game, sx: number, sy: number, head: HeadKind): Bridge | undefined {
  const all = [...g.bridges.values()].filter((b) => b.kind === 'aqueduct').sort((a, b) => a.id - b.id);
  if (!all.length) return undefined;
  if (head === 'pool') {
    const w = g.world;
    const [cx, cy] = springCorner((x, y) => w.getHeight(x, y), sx, sy);
    const r = settleChain((x, y) => (w.cornerInBounds(x, y) ? w.getHeight(x, y) : null), cx, cy, g.springs.slabs, [sx, sy]);
    const tiles = typeof r === 'string' ? [] : r.ponds[0].tiles ?? [];
    return all.find((b) => {
      for (let k = 0; k < tiles.length; k += 2) if (tiles[k] === b.ax && tiles[k + 1] === b.ay) return true;
      return false;
    });
  }
  const here = g.world.water?.pondsAt(sx, sy) ?? [];
  return all.find((b) => (g.world.water?.pondsAt(b.ax, b.ay) ?? []).some((q) => here.some((p) => p.spring === q.spring && p.index === q.index)));
}

/**
 * Where an aqueduct could be led from to a tile: the first pond or pool met
 * going out from it each way, as far as an aqueduct spans, whatever the
 * answer about leading it from there -- the menu shows why not.
 */
export function aqueductHeads(g: Game, tx: number, ty: number): Array<{ x: number; y: number; dir: 'north' | 'south' | 'east' | 'west'; tiles: number }> {
  const out: Array<{ x: number; y: number; dir: 'north' | 'south' | 'east' | 'west'; tiles: number }> = [];
  const water = g.world.water;
  for (const [dx, dy, dir] of [[0, -1, 'north'], [1, 0, 'east'], [0, 1, 'south'], [-1, 0, 'west']] as const) {
    for (let k = 2; k <= AQUEDUCT.span + 1; k++) {
      const x = tx + dx * k;
      const y = ty + dy * k;
      if (!g.world.inBounds(x, y)) break;
      if (g.slabAt(x, y)?.pool || water?.pondsAt(x, y).length) {
        out.push({ x, y, dir, tiles: k });
        break;
      }
    }
  }
  return out;
}

/** An aqueduct as the springs see it, finished and pouring into what stands at its foot now. */
export const channelOf = (g: Game, b: Bridge): Channel => ({
  id: b.id, from: [b.ax, b.ay], to: [b.bx, b.by], height: b.height, along: b.spans.length,
  fountain: g.furnitureOnTile(b.bx, b.by).some((f) => f.kind === 'fountain'),
});

/** The stream a spring's water takes along an aqueduct, the chain it is in and how its ponds rose, when any spring's does. */
export function waterAlong(g: Game, id: number): { chain: Chain; stream: Stream; fill: Array<{ from: number; since: number }> } | null {
  for (const s of g.springs.list.values()) {
    const stream = s.chain.streams.find((st) => st.via === id);
    if (stream) return { chain: s.chain, stream, fill: s.fill };
  }
  return null;
}

/**
 * What is said when the last span is laid: where the water goes now, or that
 * none comes. The island says the same (`aqueduct_says`).
 */
export function aqueductSays(g: Game, b: Bridge): string {
  const foot = footSays(g, b);
  if (!foot) {
    return `The last span is laid. No spring's water stands at its head at ${b.height} or over, so the channel stays dry until some does.`;
  }
  return `The last span is laid and water runs along the channel, ${AQUEDUCT_FLOW} litres a minute, out of its head instead of over that water's lip. ${foot}`;
}

/**
 * Where the water an aqueduct carries goes at its foot, as it is said; null
 * while none runs along it. Asked at `now`, a hollow it has filled since is
 * said to be full.
 */
export function footSays(g: Game, b: Bridge, now?: number): string | null {
  const along = waterAlong(g, b.id);
  if (!along) return null;
  const { chain, stream } = along;
  const into = typeof stream.to === 'number' ? chain.ponds[stream.to] : undefined;
  if (stream.fountain) return 'It keeps the fountain at its foot full.';
  // Onto a foundation with no pool in it: off its top over its lowest edge (`settleChain`'s `pour`).
  const slab = g.slabAt(b.bx, b.by);
  if (slab && !slab.pool) return 'It pours onto the foundation at its foot and runs off its lowest edge.';
  if (into?.tiles) return into.spill ? 'The pool at its foot is full already, and spills over its lowest edge.' : 'The pool at its foot is full already, and nothing beside it is lower: it keeps the water.';
  if (into?.volume) {
    // Standing at its level already -- another spring's pond, or this one's own water there before -- or risen to it since.
    const f = along.fill[stream.to as number];
    const full = f && (f.from >= into.level || (now !== undefined && pondFull({ from: f.from, level: into.level, since: f.since, rate: pondRate(into) }) <= now));
    if (full) return 'The pond at its foot is full already, and spills over its lip.';
    return `It fills the hollow it runs into to ${into.level} in ${fillWords(fillSeconds(into.volume))}, and then spills over its lip and runs on.`;
  }
  return 'It pours out onto the ground at its foot and runs away downhill.';
}

type BridgeTarget = Extract<Target, { kind: 'bridge' }>;
/** The aqueduct a job is aimed at, if it is one. */
export const aqueductOf = (g: Game, t: Target): Bridge | undefined => {
  const b = t.kind === 'bridge' ? g.bridges.get((t as BridgeTarget).id) : undefined;
  return b?.kind === 'aqueduct' ? b : undefined;
};

/** What is at each end, as the log says it. */
const HEAD_WORD: Record<HeadKind, string> = { pond: 'pond', pool: 'pool' };
const FOOT_WORD: Record<FootKind, string> = { pond: 'pond', pool: 'pool', fountain: 'fountain', hollow: 'hollow' };

export const AQUEDUCT_ACTIONS: ActionDef[] = [
  {
    id: 'plan_aqueduct',
    label: 'Lead an aqueduct here',
    verb: 'setting out an aqueduct',
    hidden: true,
    // Set out from as far off as a bridge is thrown: the whole of a span away and more.
    range: 18,
    stamina: 0.04,
    baseTime: 5,
    applies: (t) => t.kind === 'tile',
    check: (t, g) => {
      if (t.kind !== 'tile') return 'Choose where it pours.';
      if (!t.head) return 'Choose the water it draws from.';
      const plan = aqueductPlan(g, t.head[0], t.head[1], t.x, t.y);
      return typeof plan === 'string' ? plan : null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile' || !t.head) return;
      const [sx, sy] = t.head;
      const plan = aqueductPlan(g, sx, sy, t.x, t.y);
      if (typeof plan === 'string') return;
      const b = g.addBridge('aqueduct', sx, sy, t.x, t.y, plan.height);
      // Its piers stand on the edges between its tiles from now, and no pool's water goes over one (`aqueductShut`).
      g.springs.channelChanged({ from: [sx, sy], to: [t.x, t.y] });
      g.springs.update(Date.now());
      g.gainSkill(AQUEDUCT.skill, 0.4);
      const n = b.spans.length;
      g.logMsg(
        `You set out an aqueduct of ${n} span${n > 1 ? 's' : ''} from the ${HEAD_WORD[plan.head]} to the ${FOOT_WORD[plan.foot]}, its channel at ${plan.height}. `
        + `Each span wants ${spanWants(b.spans[0])}. ${AQUEDUCT.note}`,
        'system',
      );
      for (const sp of b.spans) g.events.emit('world', sp.x, sp.y);
    },
  },
  {
    id: 'build_aqueduct',
    label: 'Work on the aqueduct',
    verb: 'building the aqueduct',
    stamina: 0.06,
    baseTime: 9,
    repeat: true,
    applies: (t, g) => aqueductOf(g, t) !== undefined,
    labelFor: (t, g) => {
      const b = aqueductOf(g, t);
      const s = b && b.spans.find((x) => !isDone(x));
      return s ? `Work on the aqueduct (wants ${spanWants(s)})` : 'Work on the aqueduct';
    },
    check: (t, g) => {
      const b = aqueductOf(g, t);
      if (!b) return 'It is gone.';
      const s = b.spans.find((x) => !isDone(x));
      if (!s) return 'It is finished.';
      if (!g.inventory.has(AQUEDUCT.tool)) return `You need a ${itemDef(AQUEDUCT.tool).name.toLowerCase()}.`;
      if (Math.hypot(s.x + 0.5 - g.player.x, s.y + 0.5 - g.player.y) > 4.5) return 'Work from one end. Walk to the open part of the span.';
      const short = Object.keys(s.needed).sort().filter((id) => s.needed[id] > 0 && g.inventory.count(id) < 1);
      if (short.length) return `That span wants ${spanWants(s)}; you are carrying no ${itemDef(short[0]).name.toLowerCase()}.`;
      return null;
    },
    perform: (t, g) => {
      const b = aqueductOf(g, t);
      if (!b) return;
      const s = b.spans.find((x) => !isDone(x));
      if (!s) return;
      // One unit of one thing a go, as with a bridge: the first by name that is carried.
      const id = Object.keys(s.needed).sort().find((k) => s.needed[k] > 0 && g.inventory.count(k) > 0);
      if (!id || !g.inventory.consume(id, 1)) return;
      s.needed[id] = Math.max(0, s.needed[id] - 1);
      g.gainSkill(AQUEDUCT.skill, 0.5);
      g.wearTool(AQUEDUCT.tool, 0.4);
      g.events.emit('world', s.x, s.y);
      if (!isDone(s)) {
        g.logMsg(`You work a ${itemDef(id).name.toLowerCase()} into the span. It still wants ${spanWants(s)}.`, 'event');
        return true;
      }
      const left = b.spans.filter((x) => !isDone(x)).length;
      if (left) {
        g.logMsg(`That span is laid. ${left} still open.`, 'event');
        return true;
      }
      // Finished, and bare: the moss on its stone starts from here, as on a stone arch (`greening.ts`).
      b.greenSince = greenNow();
      // The springs whose water reaches its head are settled again now, so what is said is what happens.
      g.springs.channelChanged(channelOf(g, b));
      g.springs.update(Date.now());
      g.logMsg(aqueductSays(g, b), 'system');
      return false;
    },
  },
  {
    id: 'demolish_aqueduct',
    label: 'Pull the aqueduct down',
    verb: 'pulling the aqueduct down',
    stamina: 0.08,
    baseTime: 12,
    applies: (t, g) => aqueductOf(g, t) !== undefined,
    check: (t, g) => {
      const b = aqueductOf(g, t);
      if (!b) return 'It is gone.';
      // gates: from as near either end as a bridge is pulled down from (`PULL_REACH`), and on a settlement only by
      // its builders, as a bridge is (`pullDownRefusal`).
      if (Math.hypot(b.ax + 0.5 - g.player.x, b.ay + 0.5 - g.player.y) > PULL_REACH && Math.hypot(b.bx + 0.5 - g.player.x, b.by + 0.5 - g.player.y) > PULL_REACH) {
        return 'Stand at one end of it.';
      }
      return pullDownRefusal(g, b, AQUEDUCT_ACTIONS.find((a) => a.id === 'demolish_aqueduct')?.label);
    },
    perform: (t, g) => {
      const b = aqueductOf(g, t);
      if (!b) return;
      const ran = bridgeDone(b) && waterAlong(g, b.id) !== null;
      // Half of what went into it comes back, as with a bridge.
      const back = new Map<string, number>();
      for (const s of b.spans) {
        for (const [id, total] of Object.entries(s.total)) {
          const used = total - (s.needed[id] ?? 0);
          if (used > 0) back.set(id, (back.get(id) ?? 0) + used);
        }
      }
      const parts: string[] = [];
      for (const id of [...back.keys()].sort()) {
        const half = Math.floor((back.get(id) ?? 0) / 2);
        if (half > 0) {
          g.inventory.add(id, { count: half, ql: 20 });
          parts.push(`${half} ${itemDef(id).name.toLowerCase()}`);
        }
      }
      const channel = channelOf(g, b);
      g.removeBridge(b.id);
      g.springs.channelChanged(channel);
      g.springs.update(Date.now());
      g.logMsg(
        (parts.length ? `You take the aqueduct down and save ${parts.join(', ')}.` : 'You take the aqueduct down.')
        + (ran ? ' The water at its head goes over its own lip again.' : ''),
        'event',
      );
    },
  },
];

export const AQUEDUCT_ACTION_BY_ID = new Map(AQUEDUCT_ACTIONS.map((a) => [a.id, a]));
