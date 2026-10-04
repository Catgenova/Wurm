import type { ActionDef, Target } from './actions';
import { BRIDGES, bridgeDone, type Bridge, type BridgeKind } from './bridges';
import { borderOf, isDone, MATERIALS, onlyRefusal, progressOf, WALL_TYPE_BY_ID, type Border, type MaterialDef, type Side, type Wall, type WallType } from './building';
import type { Game } from './game';
import { rankAtLeast } from './ranks';
import type { Lockable } from './locks';
import { billWords, keyFromPadlock, padlockToFit } from './items';
import { article, capital, numberWord, percent, spanWords } from './words';

/**
 * Three ways to shut a way in: a portcullis, a drawbridge and a hidden door.
 *
 * **A portcullis** is a wall type: a wide archway of stone with an iron
 * grille in grooves in its jambs (`WALL_TYPES`, `portcullis`). It is laid
 * only in a stone or brick material and only on the ground floor. Raised, it
 * is the archway it is let into, and people, carts and beasts all pass;
 * lowered, nothing passes it. It is a grille either way, so the eye goes
 * through it. Anyone its padlock admits raises or lowers it, from either
 * side, within the reach of its jobs (`GATE_ACTIONS`), and takes it down
 * (`gateRemoveRefusal`); without a padlock, anybody.
 *
 * **A drawbridge** is a bridge kind (`BRIDGES.draw`): a plank deck of at
 * most `BRIDGES.draw.span` tiles, both ends on open ground, hinged at the end
 * it was set out from, where its winch stands. Lowered, it is a bridge that
 * carries a cart. Raised, there is no deck — whatever is under the span, a
 * moat or a ravine, is what there is — and the deck stands on end over the
 * hinge, which shuts that border to everything and stops the eye there. It is
 * worked from the winch end, standing on that tile, by anyone its padlock
 * admits, or anybody without one; and the padlock keeps it from being pulled
 * down as well.
 *
 * **A hidden door** is a wall type drawn exactly as a solid wall of its
 * material, and built of exactly a solid wall's bill. Its padlock and its
 * hinges go in when it is planned, and its key is cut then: to whoever that
 * key or the founder's master key admits it is a door, and to everybody else
 * it is a solid wall in every respect — the island sends it to them as one
 * (`wall_seen_type` in the ground read), so they cannot pass it, see through
 * it, or find it by reading what the island says. Never a way for a beast,
 * and never wide enough for a cart.
 *
 * It is planned as a solid wall: the very `plan_wall` job, the same time,
 * wind, words and sound, with "solid" for its type in everything anybody else
 * may read. The choice is kept for the border the plan is on, and only while
 * a plan of a wall on that border is in hand or lined up: here in
 * `hiddenAsks`; on an island, sent with the plan in its one call when the feet
 * arrive (`rpc_plan_hidden_wall`), and kept there (`private.hidden_door_plan`).
 * It is taken up by the next solid wall planned on that border (`planGate`,
 * `perform_gate_plan`).
 */

/** What a hidden door takes out of the pack when it is planned: its padlock, and a door's hinges. */
export const HIDDEN_DOOR_IRON: Array<[string, number]> = [
  ['padlock', 1],
  ...(WALL_TYPE_BY_ID.get('door')?.fittings ?? []).filter(([id]) => id === 'hinge'),
];
/** The hinges in that. */
export const HIDDEN_DOOR_HINGES = HIDDEN_DOOR_IRON.find(([id]) => id === 'hinge')?.[1] ?? 0;
/** Whether a wall type may be planned in a material: a portcullis only in stone or brick (`WallTypeDef.stone`). */
export const fitsMaterial = (type: WallType, mat: MaterialDef | undefined): boolean =>
  !WALL_TYPE_BY_ID.get(type)?.stone || mat?.kind === 'stone';

/** Why `plan_wall` will not take "hidden door" for a type: the menu plans one as a solid wall and says so beforehand. */
export const HIDDEN_DOOR_ALONE = 'A hidden door is planned with Plan wall, then Hidden door.';

/**
 * Why a wall of this type may not be planned here, over and above what any
 * wall asks, or null. `out` is a wall out past the footprint, on a jetty
 * (`frame.ts`), which no storey worked on brings down to the ground floor.
 * The island's `gate_plan_refusal`, word for word.
 */
export function gatePlanRefusal(type: WallType, mat: MaterialDef | undefined, level: number, out = false): string | null {
  const def = WALL_TYPE_BY_ID.get(type);
  if (!fitsMaterial(type, mat)) return `A ${def?.name.toLowerCase()} is laid in stone or brick, with a trowel.`;
  if (def?.ground && level > 0) return `A ${def.name.toLowerCase()} stands in a wall on the ground floor.${out ? '' : ' Work on storey 1 to plan one.'}`;
  if (type === 'hidden_door') return HIDDEN_DOOR_ALONE;
  return null;
}

/** What a hidden door wants in the pack as it is planned, or null: the island's `hidden_door_wants`. */
export function hiddenDoorWants(g: Game): string | null {
  if (g.inventory.count('padlock') < 1) return 'A hidden door takes a padlock when it is planned. Forge one at a smelter.';
  if (g.inventory.count('hinge') < HIDDEN_DOOR_HINGES) return `A hidden door takes ${numberWord(HIDDEN_DOOR_HINGES)} hinges when it is planned.`;
  return null;
}

type TileTarget = Extract<Target, { kind: 'tile' }>;

/**
 * How long a hidden door asked for waits for its solid wall to be planned, in
 * seconds: past that, the wall planned there is a plain solid wall. A
 * backstop only -- an ask goes with its job, and the job does not wait an
 * hour. The island's `hidden_door_lapse`.
 */
export const HIDDEN_DOOR_LAPSE = 3600;

/**
 * Hidden doors asked for and not yet planned, for each body: by the border
 * each was asked on ("h 11 9"), and when. The island's
 * `private.hidden_door_plan`, kept by the same rules: one ask to a border,
 * asked again it is asked anew; kept while that body has a plan of a wall on
 * that border in hand or lined up, whichever plan that is, and gone as soon as
 * it has none (`keepHiddenAsks`); taken up by the next solid wall that body
 * plans on that border, on whatever storey it is working (`planGate`). Nothing
 * on any job says so -- every job's fields are a solid wall's in everything
 * anybody else may read.
 */
const hiddenAsks = new WeakMap<object, Map<string, number>>();
/** The jobs asked for as hidden doors, by their targets: on an island, these plans go by `rpc_plan_hidden_wall`. */
const hiddenJobs = new WeakSet<object>();
const nowSecs = (): number => Date.now() / 1000;
const borderKey = (b: Border): string => `${b.dir} ${b.x} ${b.y}`;
/** The border a job plans a wall on, or null for any other job. */
const planBorder = (def: ActionDef, t: Target): string | null =>
  def.id === 'plan_wall' && t.kind === 'tile' && t.side ? borderKey(borderOf(t.x, t.y, t.side)) : null;

/**
 * Whether a job was asked for as a hidden door: on an island, the plan this
 * body sends by `rpc_plan_hidden_wall` rather than by `rpc_act`, when its
 * feet arrive (`play.ts`).
 */
export const hiddenAsk = (t: Target): boolean => hiddenJobs.has(t);

/**
 * Drop the asks of the body acting with no plan of a wall on their border in
 * hand or lined up: the island's `hidden_door_keep`, which does it whenever
 * the job in hand or the queue changes. Here it is done before any job is
 * asked for (`requestAction`) and before a wall is planned (`planGate`), which
 * comes to the same: a job comes to a border only by being asked for, so in
 * between the jobs on a border only ever go, and a border with a plan on it
 * now has had one all along.
 */
export function keepHiddenAsks(g: Game): void {
  const asks = hiddenAsks.get(g.actor);
  if (!asks?.size) return;
  const planned = new Set<string>();
  for (const j of [g.action, ...g.queue]) {
    const at = j ? planBorder(j.def, j.target) : null;
    if (at) planned.add(at);
  }
  for (const at of [...asks.keys()]) if (!planned.has(at)) asks.delete(at);
}

/**
 * Plan a hidden door: a solid wall's plan, asked for exactly as any is
 * (`requestAction`). Alone, the ask is kept for its border only if the plan
 * was started or lined up, as the island keeps it. On an island nothing goes
 * to the island before the walk: the plan goes when the feet arrive, as every
 * plan does, and in the one call that asks for the door too
 * (`rpc_plan_hidden_wall`), which keeps the ask on the same terms. Refused
 * here first, before any walking, for want of the padlock and the hinges, in
 * the island's words.
 */
export function planHiddenDoor(g: Game, planWall: ActionDef, t: TileTarget): void {
  // A material laid as only some things (`onlyRefusal`) is no hidden door unless it says so; then the padlock and the hinges.
  const why = onlyRefusal(t.material, { wall: 'hidden_door' }) ?? hiddenDoorWants(g);
  if (why) {
    g.logMsg(why, 'error');
    return;
  }
  const target = { ...t, wallType: 'solid' } as Target;
  hiddenJobs.add(target);
  g.requestAction(planWall, target);
  const at = planBorder(planWall, target);
  if (g.ask || !at || (g.action?.target !== target && !g.queue.some((q) => q.target === target))) return;
  let asks = hiddenAsks.get(g.actor);
  if (!asks) hiddenAsks.set(g.actor, (asks = new Map()));
  asks.set(at, nowSecs());
}

/**
 * The line planning a wall says: "You plan a solid stone brick wall on the
 * north side.", as it always has; a railing as one, "You plan a log railing
 * on the east side." (`frame.ts`); and any other type the thing it is, "You
 * plan a portcullis in stone brick on the south side.". The island's
 * `plan_line`.
 */
export function planLine(type: WallType, material: string, side: string): string {
  const name = (WALL_TYPE_BY_ID.get(type)?.name ?? type).toLowerCase();
  const mat = material.toLowerCase();
  if (type === 'solid') return `You plan ${article(name)} ${name} ${mat} wall on the ${side} side.`;
  if (type === 'railing') return `You plan ${article(mat)} ${mat} railing on the ${side} side.`;
  return `You plan ${article(name)} ${name} in ${mat} on the ${side} side.`;
}

/** What planning one says when the padlock or the hinges went before the wall was planned: it is the solid wall it was asked as. */
export const HIDDEN_DOOR_SHORT = `A padlock and ${numberWord(HIDDEN_DOOR_HINGES)} hinges were no longer in your pack, so it is a solid wall.`;

/**
 * A solid wall just planned on a border its planner asked a hidden door on,
 * within `HIDDEN_DOOR_LAPSE`, by whichever plan of a wall there it was: the
 * padlock goes in, its number becomes the door's, it becomes the key in the
 * planner's pack, and the hinges are spent. What it says, to go on the end of
 * the plan's own line, or null: anything else planned is left alone and says
 * nothing more. The island's `perform_gate_plan`, called the same way, after
 * the wall is.
 */
export function planGate(g: Game, wall: Wall): string | null {
  if (wall.type !== 'solid') return null;
  keepHiddenAsks(g);
  const asks = hiddenAsks.get(g.actor);
  const at = asks?.get(borderKey(wall));
  if (at === undefined) return null;
  asks?.delete(borderKey(wall));
  if (nowSecs() - at > HIDDEN_DOOR_LAPSE) return null;
  const lock = padlockToFit(g.inventory.items);
  if (!lock || g.inventory.count('hinge') < HIDDEN_DOOR_HINGES) return HIDDEN_DOOR_SHORT;
  g.inventory.consume('hinge', HIDDEN_DOOR_HINGES);
  // The padlock becomes its own key, as every padlock fitted does (`keyFromPadlock`).
  keyFromPadlock(lock);
  wall.type = 'hidden_door';
  wall.lock = lock.uid;
  g.events.emit('inventory');
  return hiddenDoorSaid(founderWord(g, wall.x, wall.y));
}

/**
 * Who besides the key holder a padlock on this tile admits, as the planning
 * line names them: you, on your own land; the founder of the settlement it
 * stands on, by name; or nobody. The master key belongs to the ground.
 */
export function founderWord(g: Game, x: number, y: number): { own: boolean; deed: string | null } {
  const mine = g.deedOfMineAt(x, y);
  if (mine && rankAtLeast(mine.role, 'founder')) return { own: true, deed: mine.name };
  const d = mine ?? g.deedAt(x, y);
  return { own: false, deed: d ? d.name : null };
}

/** What planning one says, as the island says it (`hidden_door_said`). */
export const hiddenDoorSaid = (who: { own: boolean; deed: string | null }): string =>
  `You set a padlock and ${numberWord(HIDDEN_DOOR_HINGES)} hinges in it and cut its key. It is a door to whoever holds that key${
    who.own ? ' and to you, on your own land' : who.deed ? ` and to the founder of ${who.deed}` : ''}, and a solid wall to everybody else.`;

// ---------------------------------------------------------------------------
// Where a bridge may start
// ---------------------------------------------------------------------------

/** Why a drawbridge will not be set out from inside a building, or come down inside one. */
export const drawbridgeEndsOut = (end: 0 | 1): string =>
  end === 0 ? `A ${BRIDGES.draw.name.toLowerCase()}'s winch stands outside, on open ground.`
    : `A ${BRIDGES.draw.name.toLowerCase()} comes down outside, on open ground.`;
/**
 * And why its winch is not set under a jetty (`frame.ts`), nor a jetty floored
 * over its winch: its gallows rise over that tile higher than a storey, and
 * its deck stands on end beside it.
 */
export const DRAWBRIDGE_UNDER_JETTY = `A ${BRIDGES.draw.name.toLowerCase()}'s winch is not set under a jetty: its gallows rise over it.`;
export const JETTY_OVER_WINCH = `A ${BRIDGES.draw.name.toLowerCase()}'s winch stands on that tile, and its gallows rise over it.`;
/** Whether a drawbridge's winch stands on this tile: the end it was set out from. The island's `drawbridge_winch_at`. */
export function drawbridgeWinchAt(g: Game, x: number, y: number): boolean {
  for (const b of g.bridges.values()) if (b.kind === 'draw' && b.ax === x && b.ay === y) return true;
  return false;
}
/** And any other bridge from a ground floor laid on the ground: a finished deck on piers is landed on as a bank is (`piers.ts`). */
export const BRIDGE_END_INSIDE = 'A bridge starts and ends on open ground, on a finished deck or on an upper storey, not inside on a ground floor.';
/**
 * And through a wall that nobody walks through, named as what stands there:
 * "A fence stands across one end of it.". A hidden door is the solid wall it
 * is to everybody else, whoever plans the bridge.
 */
export const bridgeEndWall = (type: WallType): string => {
  const what = type === 'solid' || type === 'hidden_door' ? 'solid wall' : (WALL_TYPE_BY_ID.get(type)?.name ?? type).toLowerCase();
  return `${capital(article(what))} ${what} stands across one end of it. A bridge goes out through a doorway, an archway or an open side.`;
};
/** And a building planned over one end of a bridge. */
export const BRIDGE_END_HERE = 'A bridge comes ashore on this tile. Build clear of its ends.';

/** The side of a tile that faces the way `dx`, `dy` runs. */
const sideTowards = (dx: number, dy: number): Side => (dx > 0 ? 'e' : dx < 0 ? 'w' : dy > 0 ? 's' : 'n');

/**
 * Why a bridge may not start or end where it would, over and above what
 * every bridge asks of its ends, or null. A drawbridge stands outside at both
 * ends, its winch not under a jetty; any other bridge on open ground, on a
 * finished deck on piers -- which
 * `bridgeReason` lands a bridge on as on a bank -- or on an upper storey, not
 * on a ground floor laid on the ground; and none goes through a wall a body
 * cannot walk through, at the storey it leaves from, a hidden door counted as
 * the solid wall it looks like. The island's `bridge_end_refusal`, in the same
 * order and the same words.
 */
export function bridgeEndRefusal(g: Game, kind: BridgeKind, ax: number, ay: number, bx: number, by: number, levels: [number, number]): string | null {
  const def = BRIDGES[kind];
  const dx = Math.sign(bx - ax);
  const dy = Math.sign(by - ay);
  const ends: Array<[number, number, number, number]> = [[ax, ay, dx, dy], [bx, by, -dx, -dy]];
  for (const [i, [x, y, ux, uy]] of ends.entries()) {
    if (g.buildings.buildingAt(x, y)) {
      if (def.grounded) return drawbridgeEndsOut(i as 0 | 1);
      if (!levels[i] && g.pierDeckAt(x, y) === null) return BRIDGE_END_INSIDE;
    }
    // On the ground under a jetty, built or only planned: a finished one is a storey, which its end would be on.
    if (kind === 'draw' && i === 0 && !levels[i] && g.buildings.jettyAt(x, y)) return DRAWBRIDGE_UNDER_JETTY;
    const w = g.buildings.wallOnBorder(levels[i], borderOf(x, y, sideTowards(ux, uy)));
    // A hidden door is a solid wall here to everybody, its key holder too: nobody lands a deck on one.
    const type = w && (w.type === 'hidden_door' ? 'solid' : g.buildings.seenType(w));
    if (type && !WALL_TYPE_BY_ID.get(type)?.passable) return bridgeEndWall(type);
  }
  return null;
}

/**
 * Whether a bridge thrown across comes ashore on this tile: one of its ends.
 * Not an aqueduct's: its ends are the pond or pool it draws from and the
 * basin it pours into, which answer for themselves. The island's
 * `bridge_end_at`.
 */
export function bridgeEndAt(g: Game, x: number, y: number): boolean {
  const b = g.bridgeEndAt(x, y);
  return !!b && b.kind !== 'aqueduct';
}

// ---------------------------------------------------------------------------
// The portcullis
// ---------------------------------------------------------------------------


/** The portcullis on the side of a tile a target names, as the body playing sees it: on the ground floor, where one stands. */
export function portcullisAt(g: Game, t: Target): Wall | undefined {
  if (t.kind !== 'tile' || !t.side) return undefined;
  const w = g.buildings.wall(0, t.x, t.y, t.side);
  return w && g.buildings.seenType(w) === 'portcullis' ? w : undefined;
}

/** Why a portcullis will not go up, or down, or null. The island's `gate_refusal`, word for word. */
function portcullisRefusal(g: Game, t: Target, up: boolean): string | null {
  const w = portcullisAt(g, t);
  if (!w) return 'There is no portcullis there.';
  if (!isDone(w)) return 'Finish the portcullis first.';
  if (up && !w.lowered) return 'The portcullis is up already.';
  if (!up && w.lowered) return 'The portcullis is down already.';
  return g.lockRefusal({ lock: w.lock, x: w.x, y: w.y });
}

/**
 * Why a wall may not be taken down, over and above what any wall asks, or
 * null: a portcullis's padlock keeps it from being taken down by anybody it
 * does not admit, as it keeps it from being raised or lowered. Asked of the
 * wall as the body sees it, so a hidden door it does not admit is the solid
 * wall it looks like, and says nothing. The island's `build_refusal`.
 */
export function gateRemoveRefusal(g: Game, w: Wall): string | null {
  return g.buildings.seenType(w) === 'portcullis' ? g.lockRefusal({ lock: w.lock, x: w.x, y: w.y }) : null;
}

/** What raising or lowering one says. */
export const portcullisSaid = (up: boolean): string => (up
  ? 'You winch the portcullis up. People, carts and beasts pass under it.'
  : 'You let the portcullis down. Nothing passes it until it is raised; it is still seen through.');

// ---------------------------------------------------------------------------
// The drawbridge
// ---------------------------------------------------------------------------

/** A finished deck that is there to be walked: every span decked, and not drawn up. */
export const deckDown = (b: Bridge): boolean => bridgeDone(b) && !b.raised;

/** Whether a bridge is a drawbridge. */
export const isDrawbridge = (b: Bridge | undefined): boolean => b?.kind === 'draw';

/**
 * The border a drawbridge is hinged on: between the end it was set out from,
 * where its winch stands, and the first tile of its deck.
 */
export function hingeOf(b: Bridge): Border {
  const dx = Math.sign(b.bx - b.ax);
  const dy = Math.sign(b.by - b.ay);
  if (dx > 0) return { dir: 'v', x: b.ax + 1, y: b.ay };
  if (dx < 0) return { dir: 'v', x: b.ax, y: b.ay };
  if (dy > 0) return { dir: 'h', x: b.ax, y: b.ay + 1 };
  return { dir: 'h', x: b.ax, y: b.ay };
}

/** The border a drawbridge comes down on: between its last tile of deck and the far end. */
export function landingOf(b: Bridge): Border {
  const dx = Math.sign(b.bx - b.ax);
  const dy = Math.sign(b.by - b.ay);
  if (dx > 0) return { dir: 'v', x: b.bx, y: b.by };
  if (dx < 0) return { dir: 'v', x: b.bx + 1, y: b.by };
  if (dy > 0) return { dir: 'h', x: b.bx, y: b.by };
  return { dir: 'h', x: b.bx, y: b.by + 1 };
}

/** A border as a key, storey and all: the buildings' own reckoning. */
export const hingeKey = (level: number, b: Border): string => `${level}:${b.dir}:${b.x},${b.y}`;

/** The drawbridge a target names. */
export const drawbridgeAt = (g: Game, t: Target): Bridge | undefined => {
  if (t.kind !== 'bridge') return undefined;
  const b = g.bridges.get(t.id);
  return b && isDrawbridge(b) ? b : undefined;
};

/** Why a drawbridge will not go up, or down, or null. The island's `gate_refusal`, word for word. */
function drawbridgeRefusal(g: Game, t: Target, up: boolean): string | null {
  if (t.kind !== 'bridge' || !g.bridges.get(t.id)) return 'It is gone.';
  const b = drawbridgeAt(g, t);
  if (!b) return 'That is not a drawbridge.';
  if (!bridgeDone(b)) return 'Deck every span of the drawbridge first.';
  if (up && b.raised) return 'The drawbridge is up already.';
  if (!up && !b.raised) return 'The drawbridge is down already.';
  return g.lockRefusal({ lock: b.lock, x: b.ax, y: b.ay });
}

/** Where a finished drawbridge stands, for a tooltip and its menu: "up: nothing crosses", "down: all cross". */
export const drawbridgeState = (b: Bridge): string =>
  `${b.raised ? 'up: nothing crosses' : `down: ${BRIDGES.draw.carts ? 'all cross' : 'all but carts cross'}`}${b.lock ? ' · padlocked' : ''}`;

/** And where a finished portcullis stands: "down: nothing passes", "up: all pass". */
export const portcullisState = (w: Wall): string =>
  `${w.lowered ? 'down: nothing passes' : 'up: all pass'}${w.lock ? ' · padlocked' : ''}`;

/**
 * The line the pointer is given for a portcullis, or for a hidden door to
 * whoever it admits, on the ground floor of the side of a tile it is nearest:
 * whatever storey is being worked on, and from outside as from in.
 * "south wall: portcullis stone brick · down: nothing passes · padlocked";
 * "east wall: hidden door stone brick · your key opens it".
 */
export function gateHoverLine(g: Game, x: number, y: number, side: Side, sideName: string, upstairs: boolean): string | null {
  const w = g.buildings.wall(0, x, y, side);
  if (!w) return null;
  const seen = g.buildings.seenType(w);
  if (seen !== 'portcullis' && seen !== 'hidden_door') return null;
  const mat = (MATERIALS.find((m) => m.id === w.material)?.name ?? w.material).toLowerCase();
  const head = `${sideName} wall${upstairs ? ' on the ground floor' : ''}: ${WALL_TYPE_BY_ID.get(seen)?.name.toLowerCase()} ${mat}`;
  if (!isDone(w)) return `${head} · ${Math.round(progressOf(w) * 100)}% built`;
  if (seen === 'portcullis') return `${head} · ${portcullisState(w)}`;
  const key = g.inventory.items.some((it) => it.id === 'key' && it.keyed === w.lock);
  return `${head} · ${key ? 'your key opens it' : 'it opens to you, on your own land'}`;
}

/** What raising or lowering one says. */
export const drawbridgeSaid = (up: boolean): string => (up
  ? 'You winch the drawbridge up. Nothing crosses it until it is let down.'
  : `You let the drawbridge down. It carries people and beasts${BRIDGES.draw.carts ? ', and carts' : ''}.`);

/**
 * A portcullis or a drawbridge as something a padlock is fitted to: the
 * store `fit_lock` and `take_off_lock` work on (`locks.ts`). A hidden door
 * has its padlock from the day it is planned and keeps it, so it is not one.
 */
export function gateLockable(g: Game, t: Target): (Lockable & { x: number; y: number }) | undefined {
  const w = portcullisAt(g, t);
  if (w) return w;
  const b = drawbridgeAt(g, t);
  if (!b) return undefined;
  return {
    x: b.ax,
    y: b.ay,
    get lock() { return b.lock; },
    set lock(n: number | undefined) { b.lock = n; },
  };
}

// ---------------------------------------------------------------------------
// The actions
// ---------------------------------------------------------------------------

const setPortcullis = (g: Game, t: Target, up: boolean): void => {
  const w = portcullisAt(g, t);
  if (!w || portcullisRefusal(g, t, up)) return;
  w.lowered = !up;
  g.logMsg(portcullisSaid(up), 'event');
  g.events.emit('world', (t as TileTarget).x, (t as TileTarget).y);
};

const setDrawbridge = (g: Game, t: Target, up: boolean): void => {
  const b = drawbridgeAt(g, t);
  if (!b || drawbridgeRefusal(g, t, up)) return;
  b.raised = up;
  // The deck is there to be walked, or it is not; and its hinge is shut, or it is not.
  g.reindexDecks();
  g.logMsg(drawbridgeSaid(up), 'event');
  for (const s of b.spans) g.events.emit('world', s.x, s.y);
  g.events.emit('world', b.ax, b.ay);
};

/**
 * Raise and lower, the two of each. The portcullis ones are aimed at a side
 * of a tile, like every job on a wall, and reach one tile (`range`, which the
 * island's `gate_refusal` measures the same way); the
 * drawbridge ones are aimed at the bridge and are done standing on the tile
 * at its winch end (`range` nought, which is the tile `targetTile` names for
 * a finished bridge).
 */
export const GATE_ACTIONS: ActionDef[] = [
  {
    id: 'raise_portcullis',
    label: 'Raise the portcullis',
    verb: 'winching the portcullis up',
    hidden: true,
    range: 1,
    stamina: 0.04,
    baseTime: 6,
    applies: (t, g) => !!portcullisAt(g, t)?.lowered,
    check: (t, g) => portcullisRefusal(g, t, true),
    perform: (t, g) => setPortcullis(g, t, true),
  },
  {
    id: 'lower_portcullis',
    label: 'Lower the portcullis',
    verb: 'letting the portcullis down',
    hidden: true,
    range: 1,
    stamina: 0.01,
    baseTime: 2,
    applies: (t, g) => { const w = portcullisAt(g, t); return !!w && !w.lowered; },
    check: (t, g) => portcullisRefusal(g, t, false),
    perform: (t, g) => setPortcullis(g, t, false),
  },
  {
    id: 'raise_drawbridge',
    label: 'Raise the drawbridge',
    verb: 'winching the drawbridge up',
    hidden: true,
    range: 0,
    stamina: 0.06,
    baseTime: 10,
    applies: (t, g) => { const b = drawbridgeAt(g, t); return !!b && !b.raised; },
    check: (t, g) => drawbridgeRefusal(g, t, true),
    perform: (t, g) => setDrawbridge(g, t, true),
  },
  {
    id: 'lower_drawbridge',
    label: 'Lower the drawbridge',
    verb: 'letting the drawbridge down',
    hidden: true,
    range: 0,
    stamina: 0.02,
    baseTime: 4,
    applies: (t, g) => !!drawbridgeAt(g, t)?.raised,
    check: (t, g) => drawbridgeRefusal(g, t, false),
    perform: (t, g) => setDrawbridge(g, t, false),
  },
];

export const GATE_ACTION_BY_ID = new Map(GATE_ACTIONS.map((a) => [a.id, a]));

/** How many tiles from the tile it is aimed at a gate's job is done: one for a portcullis, nought (on it) for a drawbridge's winch. */
export const gateReach = (id: string): number => GATE_ACTION_BY_ID.get(id)?.range ?? 0;

/**
 * What a gate's job takes, as the help and the news say it: "fourteen seconds
 * and 4% of your stamina", at the pace `go` gives a job of that base time
 * (`goSeconds`, passed in, which lives with the game).
 */
export const gateJobWords = (id: string, go: (baseTime: number) => number): string => {
  const a = GATE_ACTION_BY_ID.get(id);
  return `${spanWords(go(a?.baseTime ?? 0))} and ${percent(a?.stamina ?? 0)} of your stamina`;
};

/** What a hidden door's plan costs besides its wall, as a menu says it: "a padlock and four hinges". */
export const hiddenDoorIronWords = (): string => billWords(HIDDEN_DOOR_IRON);
