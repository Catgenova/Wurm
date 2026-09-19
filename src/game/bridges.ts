import type { ActionDef, Target } from './actions';
import { isDone, progressOf, type Bill } from './building';
import type { Game } from './game';
import { itemDef } from './items';

/**
 * Bridges.
 *
 * Water and ravines have been walls until now: the map is full of places you
 * can see across and cannot get to. A bridge is a run of deck between two
 * pieces of solid ground at much the same height, standing over whatever is
 * in between, and once it is finished it is simply ground — you walk it, you
 * ride it, and depending on what it is made of you drive a cart over it.
 *
 * Three kinds. A **rope bridge** is two hawsers and a plank walkway: cheap,
 * quick, long, and nothing with wheels is going over it. A **wooden bridge**
 * is a proper trestle and carries a cart. A **stone arch** is the work of a
 * season and carries anything at all, further than either.
 */

export type BridgeKind = 'rope' | 'wood' | 'stone';

export interface BridgeDef {
  id: BridgeKind;
  name: string;
  /** What one tile of deck takes. */
  bill: Array<[string, number]>;
  /** The longest gap it will span, in tiles of deck. */
  span: number;
  /** Tool and trade it is built with. */
  tool: 'mallet' | 'trowel';
  skill: 'carpentry' | 'masonry';
  difficulty: number;
  /** Wheels may cross it. */
  carts: boolean;
  note: string;
}

export const BRIDGES: Record<BridgeKind, BridgeDef> = {
  rope: {
    id: 'rope',
    name: 'Rope bridge',
    bill: [['thick_rope', 2], ['plank', 3], ['nail', 4]],
    span: 14,
    tool: 'mallet',
    skill: 'carpentry',
    difficulty: 18,
    carts: false,
    note: 'Two hawsers and a plank walkway. It goes a long way for very little and it sways the whole time; nothing with a wheel on it is crossing.',
  },
  wood: {
    id: 'wood',
    name: 'Wooden bridge',
    bill: [['timber', 4], ['plank', 6], ['nail', 12]],
    span: 10,
    tool: 'mallet',
    skill: 'carpentry',
    difficulty: 30,
    carts: true,
    note: 'Trestles under a plank deck, braced and pinned. A cart crosses it without anybody holding their breath.',
  },
  stone: {
    id: 'stone',
    name: 'Stone arch',
    bill: [['stone_brick', 10], ['mortar', 6], ['stone_slab', 3]],
    span: 8,
    tool: 'trowel',
    skill: 'masonry',
    difficulty: 44,
    carts: true,
    note: 'Voussoirs turned over a centring and a slab road laid on the fill. It is the work of a season and it will outlast everybody who used it.',
  },
};

export interface BridgeSpan extends Bill {
  x: number;
  y: number;
}

export interface Bridge {
  id: number;
  kind: BridgeKind;
  /** The two ends, on solid ground. Axis aligned: one of the pairs matches. */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Height the deck is carried at. */
  height: number;
  /**
   * The storey its two ends meet, and the storey you walk it on.
   *
   * Nought for a bridge between two banks, which is every bridge there was.
   * A bridge may land on a finished floor instead, and then both ends are that
   * storey of their buildings and the deck is walked at that storey — which is
   * how two towers get a walkway between them rather than a staircase down,
   * a path across the yard and a staircase up.
   */
  level?: number;
  material?: string;
  /** One entry per tile of deck between the ends, in order. */
  spans: BridgeSpan[];
}

export const bridgeDef = (b: Bridge): BridgeDef => BRIDGES[b.kind] ?? BRIDGES.rope;
export const bridgeName = (b: Bridge): string =>
  b.material ? `${bridgeDef(b).name} (${b.material.toLowerCase()})` : bridgeDef(b).name;
/** Finished when every tile of deck is. */
export const bridgeDone = (b: Bridge): boolean => b.spans.every(isDone);
export const bridgeProgress = (b: Bridge): number =>
  b.spans.length ? b.spans.reduce((n, s) => n + progressOf(s), 0) / b.spans.length : 1;

/** The tiles a bridge's deck covers, ends excluded. */
export function spanTiles(ax: number, ay: number, bx: number, by: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const dx = Math.sign(bx - ax);
  const dy = Math.sign(by - ay);
  if (dx !== 0 && dy !== 0) return out;
  let x = ax + dx;
  let y = ay + dy;
  while (x !== bx || y !== by) {
    out.push([x, y]);
    x += dx;
    y += dy;
  }
  return out;
}

/** One tile of deck, unbuilt. */
export const spanBill = (kind: BridgeKind): Bill => {
  const needed: Record<string, number> = {};
  for (const [id, n] of BRIDGES[kind].bill) needed[id] = n;
  return { needed, total: { ...needed } };
};

/** How much under a deck counts as a gap worth bridging. */
export const CLEARANCE = 3;
/**
 * How far apart the two ends may be in height and still carry one deck. Two
 * natural banks are rarely level, so there is some give in it; past this the
 * deck would meet one end and hang over the other.
 */
export const END_SLOP = 12;

export const bridgeState = (b: Bridge): string => {
  if (bridgeDone(b)) return `${b.spans.length} tiles · finished`;
  const left = b.spans.filter((s) => !isDone(s)).length;
  return `${b.spans.length} tiles · ${Math.round(bridgeProgress(b) * 100)}% · ${left} still open`;
};

/** What one tile of deck still wants, written out. */
export function spanWants(s: BridgeSpan): string {
  const parts: string[] = [];
  for (const [id, n] of Object.entries(s.needed)) if (n > 0) parts.push(`${n} ${itemDef(id).name.toLowerCase()}`);
  return parts.length ? parts.join(', ') : 'nothing';
}

type BridgeTarget = Extract<Target, { kind: 'bridge' }>;
const bridgeOf = (g: Game, t: Target): Bridge | undefined => (t.kind === 'bridge' ? g.bridges.get((t as BridgeTarget).id) : undefined);

export const BRIDGE_ACTIONS: ActionDef[] = [
  {
    id: 'plan_bridge',
    label: 'Throw a bridge across',
    verb: 'setting out a bridge',
    hidden: true,
    // You set a bridge out from where you are standing, so nothing may walk
    // you to the other side first: the reach covers the longest span there is.
    range: 18,
    stamina: 0.04,
    baseTime: 5,
    applies: (t) => t.kind === 'tile',
    check: (t, g) => {
      if (t.kind !== 'tile') return 'Choose the far side.';
      const kind = (t.material ?? 'rope') as BridgeKind;
      if (!BRIDGES[kind]) return 'Choose what to build it out of.';
      const [ax, ay] = [g.player.tileX, g.player.tileY];
      return g.bridgeReason(kind, ax, ay, t.x, t.y);
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      const kind = (t.material ?? 'rope') as BridgeKind;
      const [ax, ay] = [g.player.tileX, g.player.tileY];
      if (g.bridgeReason(kind, ax, ay, t.x, t.y)) return;
      /*
       * The height the deck is carried at, off whatever each end lands on:
       * bank, poured slab, or the floor of a storey. `centerHeight` was the
       * ground under the tile, which is the one thing a bridge to a second
       * storey is not carried at.
       */
      const ends = [g.topDeck(ax, ay), g.topDeck(t.x, t.y)];
      const height = Math.round((ends[0].height + ends[1].height) / 2);
      const b = g.addBridge(kind, ax, ay, t.x, t.y, height, kind === 'stone' ? undefined : 'Oak', ends[0].level);
      const def = BRIDGES[kind];
      g.gainSkill(def.skill, 0.4);
      g.note('planned_bridge');
      g.logMsg(
        `You set out a ${def.name.toLowerCase()} of ${b.spans.length} span${b.spans.length > 1 ? 's' : ''} across${b.level ? `, storey ${b.level + 1} to storey ${b.level + 1}` : ''}. Each one wants ${def.bill.map(([id, n]) => `${n} ${itemDef(id).name.toLowerCase()}`).join(', ')}. ${def.note}`,
        'system',
      );
      for (const sp of b.spans) g.events.emit('world', sp.x, sp.y);
    },
  },
  {
    id: 'build_bridge',
    label: 'Work on the bridge',
    verb: 'building the bridge',
    stamina: 0.06,
    baseTime: 9,
    repeat: true,
    applies: (t, g) => bridgeOf(g, t) !== undefined,
    labelFor: (t, g) => {
      const b = bridgeOf(g, t);
      const s = b && b.spans.find((x) => !isDone(x));
      return s ? `Work on the bridge (wants ${spanWants(s)})` : 'Work on the bridge';
    },
    check: (t, g) => {
      const b = bridgeOf(g, t);
      if (!b) return 'It is gone.';
      const def = bridgeDef(b);
      const s = b.spans.find((x) => !isDone(x));
      if (!s) return 'It is finished.';
      if (!g.inventory.has(def.tool)) return `You need a ${itemDef(def.tool).name.toLowerCase()}.`;
      if (Math.hypot(s.x + 0.5 - g.player.x, s.y + 0.5 - g.player.y) > 4.5) return 'Work from one end. Walk to the open part of the span.';
      const short = Object.entries(s.needed).filter(([id, n]) => n > 0 && g.inventory.count(id) < 1);
      if (short.length) return `That span wants ${spanWants(s)}; you are carrying no ${itemDef(short[0][0]).name.toLowerCase()}.`;
      return null;
    },
    perform: (t, g) => {
      const b = bridgeOf(g, t);
      if (!b) return;
      const def = bridgeDef(b);
      const s = b.spans.find((x) => !isDone(x));
      if (!s) return;
      // One unit of one thing per go, as with a wall.
      const want = Object.entries(s.needed).find(([id, n]) => n > 0 && g.inventory.count(id) > 0);
      if (!want) return;
      const [id] = want;
      if (!g.inventory.consume(id, 1)) return;
      s.needed[id] = Math.max(0, s.needed[id] - 1);
      g.gainSkill(def.skill, 0.5);
      g.wearTool(def.tool, 0.4);
      if (isDone(s)) {
        const left = b.spans.filter((x) => !isDone(x)).length;
        if (left) g.logMsg(`That span is decked. ${left} still open.`, 'event');
        else {
          g.note('bridged');
          g.logMsg(`The last span is decked and the ${bridgeName(b).toLowerCase()} is open. ${def.carts ? 'A cart will cross it.' : 'Foot traffic only; nothing with a wheel.'}`, 'system');
        }
      } else {
        g.logMsg(`You work a ${itemDef(id).name.toLowerCase()} into the span. It still wants ${spanWants(s)}.`, 'event');
      }
      g.events.emit('world', s.x, s.y);
      return !!b.spans.find((x) => !isDone(x));
    },
  },
  {
    id: 'demolish_bridge',
    label: 'Pull it down',
    verb: 'pulling the bridge down',
    stamina: 0.08,
    baseTime: 12,
    applies: (t, g) => bridgeOf(g, t) !== undefined,
    check: (t, g) => {
      const b = bridgeOf(g, t);
      if (!b) return 'It is gone.';
      if (Math.hypot(b.ax + 0.5 - g.player.x, b.ay + 0.5 - g.player.y) > 4.5 && Math.hypot(b.bx + 0.5 - g.player.x, b.by + 0.5 - g.player.y) > 4.5) {
        return 'Stand at one end of it.';
      }
      return null;
    },
    perform: (t, g) => {
      const b = bridgeOf(g, t);
      if (!b) return;
      // Half of what went into it comes back, which is what pulling a thing
      // down is worth anywhere else in the world.
      const back = new Map<string, number>();
      for (const s of b.spans) {
        for (const [id, total] of Object.entries(s.total)) {
          const used = total - (s.needed[id] ?? 0);
          if (used > 0) back.set(id, (back.get(id) ?? 0) + used);
        }
      }
      const parts: string[] = [];
      for (const [id, n] of back) {
        const half = Math.floor(n / 2);
        if (half > 0) {
          g.inventory.add(id, { count: half, ql: 20 });
          parts.push(`${half} ${itemDef(id).name.toLowerCase()}`);
        }
      }
      g.removeBridge(b.id);
      g.logMsg(parts.length ? `You take the ${bridgeName(b).toLowerCase()} down and save ${parts.join(', ')}.` : `You take the ${bridgeName(b).toLowerCase()} down.`, 'event');
    },
  },
];
