import type { ActionDef, Target } from './actions';
import { borderOf, isDone, MATERIAL_BY_ID, SIDE_NAMES, type Side, type Wall } from './building';
import { bridgeDone, type Bridge } from './bridges';
import { foundationDone, type Foundation } from './foundations';
import { furnitureDef, type PlacedFurniture } from './furniture';
import type { Game } from './game';
import { itemDef } from './items';
import { rankAtLeast } from './ranks';
import { PAVED } from '../world/tiles';

/**
 * Stone that ages.
 *
 * Asked for off a picture of a grey castle: ivy climbing its walls from the
 * foot and hanging from the tops, moss in the joints of the paving and on the
 * tops of the stones -- stone that has stood a while and looks it. So every
 * wall and garden wall of stone or brick greens over with ivy, and paving,
 * statues, poured slabs and stone bridges with moss, from bare on the day they
 * were built, laid or set down to as green as they get `GREEN_DAYS` days
 * later, a day at a time. **Clear the ivy** with a sickle and **Scrub the
 * moss** with a brush and it starts again from bare stone.
 *
 * The clock is the same for everybody, so it is the island's to keep. A thing
 * carries when it began to green (`greenSince`, in real seconds, the woods'
 * clock) and everything that draws it or asks about it works the days out
 * from that. On an island it comes with the thing itself: a wall with the
 * walls, a statue with what is set down, paving with the ground's slow half
 * -- as seconds since, which is the one thing two clocks agree on without
 * being set to each other.
 *
 * Nothing greens from before greening came in. `Game.greenFrom` is that
 * moment -- the migration's on an island, the first time a save is opened
 * with this in it at home -- and a thing that says nothing about itself, or
 * began before it, began then. So a village that stood for a month is bare on
 * the day this arrives and greens over the fortnight after, like everything
 * else.
 */

/** Days stone takes to green over, from bare to as green as it gets. */
export const GREEN_DAYS = 14;
/** A day on the woods' clock, in real seconds. */
export const GREEN_DAY = 24 * 60 * 60;

/** Now, on the clock `greenSince` is kept in: real seconds. */
export const greenNow = (): number => Date.now() / 1000;

/**
 * Whole days a thing has been greening, from nought, bare, to `GREEN_DAYS`,
 * as green as it gets: what it has grown, from when it began to `now`. The
 * island's `green_days`.
 */
export function greenDays(since: number, now: number): number {
  return Math.max(0, Math.min(GREEN_DAYS, Math.floor((now - since) / GREEN_DAY)));
}

/** When a thing began to green: when it says, and never before greening came in (`from`). The island's `green_start`. */
export const greenStart = (since: number | undefined, from: number): number => Math.max(since ?? from, from);

/* ---- how much of it shows ---------------------------------------------------- */

/*
 * The days are the rule; how much green they put on a thing depends on where
 * it stands, and that is the drawing's alone, so the island has no copy. A
 * thing's days over `GREEN_DAYS`, times a pace: `GREEN_SUN` for the top of
 * anything and for a south or an east face, which the sun (in the south-east)
 * is on; `GREEN_SHADE` more for a north or a west face, which it never
 * reaches; and `GREEN_WET` more on water, less a share a tile further off.
 * All of it shows at most.
 */
/** The pace of a top, or a south or an east face, on dry ground. */
export const GREEN_SUN = 0.85;
/** More for a north or a west face, turned from the sun. */
export const GREEN_SHADE = 0.3;
/** More by water: all of this on a tile of it, and less a tile further off each tile, to none this many tiles off. */
export const GREEN_WET = 0.3;
export const GREEN_WET_REACH = 4;

/** How much of its green a thing shows, nought to one, after `days`: `shade` one on a north or a west face, `wet` from `wetFrom`. */
export const greenShows = (days: number, shade: number, wet: number): number =>
  Math.min(1, (days / GREEN_DAYS) * (GREEN_SUN + GREEN_SHADE * shade + GREEN_WET * wet));

/** How wet a tile is for `greenShows`, from the tiles to the nearest water. */
export const wetFrom = (near: number): number => Math.max(0, 1 - near / GREEN_WET_REACH);

/* ---- what greens ---------------------------------------------------------- */

/** A wall ivy climbs: a finished wall, fence or half wall of stone or brick. */
export const ivied = (w: Wall): boolean => isDone(w) && MATERIAL_BY_ID.get(w.material)?.kind === 'stone';
/** A piece moss gathers on (`FurnitureDef.mossy`): a statue. */
export const mossyPiece = (f: { kind: string }): boolean => !!furnitureDef(f.kind).mossy;
/** A bridge moss gathers on: a finished stone arch. */
export const mossyBridge = (b: Bridge): boolean => b.kind === 'stone' && bridgeDone(b);

/** The days a wall has been greening, or null for a wall ivy does not climb. */
export function wallGreen(g: Game, w: Wall, now: number): number | null {
  return ivied(w) ? greenDays(greenStart(w.greenSince, g.greenFrom), now) : null;
}
/** The days a statue has been greening, or null for a piece that gathers no moss. */
export function pieceGreen(g: Game, f: PlacedFurniture, now: number): number | null {
  return mossyPiece(f) ? greenDays(greenStart(f.greenSince, g.greenFrom), now) : null;
}
/** The days the paving on a tile has been greening, or null where it is not paved. */
export function pavingGreen(g: Game, x: number, y: number, now: number): number | null {
  if (!PAVED.has(g.world.getTile(x, y))) return null;
  return greenDays(greenStart(g.pavingSince.get(`${x},${y}`), g.greenFrom), now);
}
/** The days a poured slab has been greening, or null for shuttering. */
export function slabGreen(g: Game, f: Foundation, now: number): number | null {
  return foundationDone(f) ? greenDays(greenStart(f.greenSince, g.greenFrom), now) : null;
}
/** The days a stone bridge has been greening, or null for a bridge that gathers no moss. */
export function bridgeGreen(g: Game, b: Bridge, now: number): number | null {
  return mossyBridge(b) ? greenDays(greenStart(b.greenSince, g.greenFrom), now) : null;
}

/* ---- starting it again ------------------------------------------------------ */

/**
 * Every wall ivy climbs on a border, every storey of it: what Clear the ivy
 * clears. A house is cleared a side at a time from the ground to the top, as
 * a man on a ladder would, rather than a storey at a time.
 */
export function ivyWalls(g: Game, x: number, y: number, side: Side): Wall[] {
  const b = borderOf(x, y, side);
  const out: Wall[] = [];
  for (const w of g.buildings.walls.values()) if (w.dir === b.dir && w.x === b.x && w.y === b.y && ivied(w)) out.push(w);
  return out.sort((p, q) => p.level - q.level);
}

/** What Scrub the moss would take the moss off, for a target: the paving and the slab on a tile, a statue, a stone bridge. */
export interface Mossy {
  /** The tile the refusal and the reach are asked about. */
  x: number;
  y: number;
  paving: boolean;
  slab?: Foundation;
  piece?: PlacedFurniture;
  bridge?: Bridge;
  /** The most any of it has grown, in days. */
  days: number;
}

export function mossOn(g: Game, t: Target, now: number): Mossy | null {
  if (t.kind === 'tile') {
    const paving = pavingGreen(g, t.x, t.y, now);
    const slab = g.slabAt(t.x, t.y);
    const slabDays = slab ? slabGreen(g, slab, now) : null;
    if (paving === null && slabDays === null) return null;
    return { x: t.x, y: t.y, paving: paving !== null, slab: slabDays === null ? undefined : slab, days: Math.max(paving ?? 0, slabDays ?? 0) };
  }
  if (t.kind === 'furniture') {
    const f = g.furniture.get(t.id);
    const days = f ? pieceGreen(g, f, now) : null;
    return f && days !== null ? { x: f.x, y: f.y, paving: false, piece: f, days } : null;
  }
  if (t.kind === 'bridge') {
    const b = g.bridges.get(t.id);
    const days = b ? bridgeGreen(g, b, now) : null;
    return b && days !== null ? { x: b.ax, y: b.ay, paving: false, bridge: b, days } : null;
  }
  return null;
}

/** What is scrubbed, as the log says it. */
export function mossWords(m: Mossy): string {
  if (m.piece) return `the ${furnitureDef(m.piece.kind).name.toLowerCase()}`;
  if (m.bridge) return 'the bridge';
  return m.paving && m.slab ? 'the paving and the foundation' : m.paving ? 'the paving' : 'the foundation';
}

/** The sentence both sides end a clearing with: what it starts again from, and how long it takes to come back. */
export const GREEN_AGAIN = `It starts again from bare stone and is as green as it gets in ${GREEN_DAYS} days.`;
/** Why there is nothing to clear yet. The island says the same (`green_refusal`). */
export const NOTHING_YET = `Nothing has grown on it yet. It greens a day at a time, over ${GREEN_DAYS} days from when it was built, laid, set down or last cleared.`;

/**
 * Why a settlement's builders are the ones to do it: somebody else's garden
 * is not yours to strip, and a guest of your own is a guest. Asked of the
 * tile the thing is on, the way the island asks `may_shape`.
 */
function notYours(g: Game, def: ActionDef, x: number, y: number): string | null {
  const mine = g.deedOfMineAt(x, y);
  const d = mine ? (rankAtLeast(mine.role, 'builder') ? null : mine) : g.deedAt(x, y);
  return d ? `That is part of ${d.name}. Only its builders may ${def.label.toLowerCase()} there.` : null;
}

/** The tool, as every job says it wants one. */
const toolRefusal = (g: Game, def: ActionDef): string | null =>
  def.tool && !g.inventory.has(def.tool) ? `You need a ${itemDef(def.tool).name.toLowerCase()} to ${def.label.toLowerCase()}.` : null;

/**
 * Why a clearing cannot be done, in the island's order: what is there, the
 * tool, whose it is, and whether anything has grown. The reach is the walk's
 * business here and the island's there (`green_refusal`).
 */
export function greenRefusal(g: Game, def: ActionDef, t: Target, now = greenNow()): string | null {
  let days = 0;
  let x = 0;
  let y = 0;
  if (def.id === 'clear_ivy') {
    if (t.kind !== 'tile' || !t.side) return 'Choose a side.';
    const walls = ivyWalls(g, t.x, t.y, t.side);
    if (!walls.length) return 'There is no finished wall of stone or brick there.';
    days = Math.max(...walls.map((w) => wallGreen(g, w, now) ?? 0));
    [x, y] = [t.x, t.y];
  } else {
    const m = mossOn(g, t, now);
    if (!m) return t.kind === 'tile' ? 'There is no paving or poured foundation here.' : 'No moss grows on that.';
    days = m.days;
    [x, y] = [m.x, m.y];
  }
  return toolRefusal(g, def) ?? notYours(g, def, x, y) ?? (days <= 0 ? NOTHING_YET : null);
}

const CLEAR_IVY: ActionDef = {
  id: 'clear_ivy',
  label: 'Clear the ivy',
  verb: 'clearing ivy',
  tool: 'sickle',
  stamina: 0.04,
  baseTime: 8,
  // Offered on the wall's own menu, a side at a time: see `buildingEntries`.
  hidden: true,
  applies: (t, g) => t.kind === 'tile' && !!t.side && ivyWalls(g, t.x, t.y, t.side).length > 0,
  labelFor: (t) => (t.kind === 'tile' && t.side ? `Clear the ivy (${SIDE_NAMES[t.side]})` : 'Clear the ivy'),
  check: (t, g) => greenRefusal(g, CLEAR_IVY, t),
  perform: (t, g) => {
    const now = greenNow();
    if (t.kind !== 'tile' || !t.side || greenRefusal(g, CLEAR_IVY, t, now)) return;
    for (const w of ivyWalls(g, t.x, t.y, t.side)) w.greenSince = now;
    g.logMsg(`You clear the ivy off the ${SIDE_NAMES[t.side]} wall. ${GREEN_AGAIN}`, 'event');
    g.events.emit('world', t.x, t.y);
  },
};

const SCRUB_MOSS: ActionDef = {
  id: 'scrub_moss',
  label: 'Scrub the moss',
  verb: 'scrubbing moss',
  tool: 'brush',
  stamina: 0.04,
  baseTime: 8,
  applies: (t, g) => mossOn(g, t, greenNow()) !== null,
  check: (t, g) => greenRefusal(g, SCRUB_MOSS, t),
  perform: (t, g) => {
    const now = greenNow();
    const m = mossOn(g, t, now);
    if (!m || greenRefusal(g, SCRUB_MOSS, t, now)) return;
    if (m.paving) g.pavingSince.set(`${m.x},${m.y}`, now);
    if (m.slab) m.slab.greenSince = now;
    if (m.piece) m.piece.greenSince = now;
    if (m.bridge) m.bridge.greenSince = now;
    g.logMsg(`You scrub the moss off ${mossWords(m)}. ${GREEN_AGAIN}`, 'event');
    g.events.emit('world', m.x, m.y);
  },
};

export const GREEN_ACTIONS: ActionDef[] = [CLEAR_IVY, SCRUB_MOSS];
