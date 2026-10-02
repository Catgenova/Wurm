/**
 * Jetties and balconies, railings, and columns: the rules, on this side.
 *
 * A **jetty** is a floor of a storey above the ground laid on a tile one tile
 * out past the footprint (`JETTY_REACH`), sharing an edge with it, where the
 * storey below has a finished full-height wall on that edge for its joists or
 * its corbels to go into (`Buildings.jettyBearer`). It is planned, built,
 * walled, painted and torn up as any floor is, as a job on the tile out past
 * the building that names the building (`buildingId` in the target). Open to
 * the storey it is part of the storey (`Buildings.storeyArea`): its outer
 * sides want walls, a railing or columns before a roof goes on, and a roof
 * over the storey covers it. Shut off behind a door or a wall it is a
 * **balcony**: outside the storey, taking no roof, asking nothing of what is
 * over it. The ground under either stays open ground: walked, fenced and
 * rotted on as any field is.
 *
 * A **railing** is a wall type (`WALL_TYPES`): waist-high, seen through, and
 * low, so nothing is built on it. It goes on the edges of a storey above the
 * ground, a balcony's included, of a deck on piers (`piers.ts`), and round a
 * flat roof (`terrace` in the target puts wall work on the roof's own level). An edge with no railing on
 * it stops you as the edge of any upper floor always has: there is nothing
 * built out there to step onto (`Game.stepRule`, and the island's
 * `frame_footing` in `rpc_move`).
 *
 * A **column** stands on a tile corner of a storey (`Column`), a share of a
 * solid wall's bill (`COLUMN_SHARE`), carries what is over it as a wall does
 * (`Buildings.bearing`), and closes a side of a storey that has a finished
 * column at both ends of it (`Buildings.carried`). A roof over a room closed
 * by walls or columns keeps what lies under it as indoors does
 * (`Buildings.sheltered`); a bed wants the walls. On the ground a column
 * takes the corner spot of every tile round it (`Game.columnInBlock`).
 *
 * Where it meets the rest of a building: on piers every storey counts from
 * the deck, a jetty's included (`jettyBase`), a column stands on a finished
 * deck no heavier than the lightest deck under the building, and a deck's
 * edge takes a railing (`piers.ts`); glass is a pitched roof's out over a
 * jetty too, and never a column (`glasshouse.ts`); no jetty over the span of
 * a bridge or an aqueduct, and no aqueduct under a jetty (`aqueducts.ts`).
 *
 * Every refusal here is `frame_refusal` on the island, word for word.
 */
import type { Target } from './actions';
import {
  borderOf,
  heftWord,
  isDone,
  isLowWall,
  jobLevel,
  MATERIAL_BY_ID,
  progressOf,
  roofShapeOf,
  SIDE_NAMES,
  WALL_HEIGHT,
  type Border,
  type Building,
  type Column,
  type FloorKind,
  type Side,
  type Wall,
} from './building';
import type { Game } from './game';
import { AQ_OVER } from './aqueducts';
import { GLASS, GLASS_PITCHED } from './glasshouse';
import { TileType } from '../world/tiles';

type TileTarget = Extract<Target, { kind: 'tile' }>;

/**
 * The building a storey job on a tile is for: the one whose footprint it is,
 * or -- out past every footprint -- the one the job names, when the tile
 * shares an edge with its footprint.
 */
export const storeyOf = (g: Game, t: TileTarget): Building | undefined =>
  g.buildings.buildingAt(t.x, t.y) ?? g.buildings.jettyHost(t.x, t.y, t.buildingId);

/**
 * The storey wall work on a tile is on: the roof's own level round a flat
 * roof (`terrace`), the storey being worked on in a building, and the ground
 * anywhere else. `frame_wall_level` on the island.
 */
export const wallLevelOf = (g: Game, t: TileTarget): number => {
  const b = storeyOf(g, t);
  if (!b) return 0;
  return t.terrace ? b.levels : jobLevel(b, t);
};

/** The four sides of a tile, each with the step across it. */
const SIDES: Array<[Side, number, number]> = [['n', 0, -1], ['e', 1, 0], ['s', 0, 1], ['w', -1, 0]];

/** The two corners a border runs between, the first one first: its `x, y` end, then the other. */
const endsOf = (b: Border): Array<[number, number]> => [[b.x, b.y], [b.x + (b.dir === 'h' ? 1 : 0), b.y + (b.dir === 'v' ? 1 : 0)]];

/** Whether a border on a storey is held up: a finished full-height wall on it, or a finished column at each end. */
const holds = (g: Game, level: number, border: Border): boolean => {
  const w = g.buildings.wallOnBorder(level, border);
  return (!!w && isDone(w) && !isLowWall(w.type)) || g.buildings.carried(level, border);
};

/**
 * Whether a corner of a storey carries the end of a side that rests on it: a
 * finished column on it, or a finished full-height wall of the storey ending
 * there on another side than `side` itself.
 */
const cornerCarries = (g: Game, level: number, cx: number, cy: number, side: Border): boolean => {
  const c = g.buildings.column(level, cx, cy);
  if (c && isDone(c)) return true;
  const round: Border[] = [{ dir: 'h', x: cx - 1, y: cy }, { dir: 'h', x: cx, y: cy }, { dir: 'v', x: cx, y: cy - 1 }, { dir: 'v', x: cx, y: cy }];
  return round.some((b) => {
    if (b.dir === side.dir && b.x === side.x && b.y === side.y) return false;
    const w = g.buildings.wallOnBorder(level, b);
    return !!w && isDone(w) && !isLowWall(w.type);
  });
};

/**
 * Why the roof may not go out over a jetty on what stands round it, or null:
 * every side of the jetty that is not into its storey wants a finished
 * full-height wall, or at each end of it a finished column or the end of a
 * finished full-height wall (`cornerCarries`). A railing carries nothing. The
 * first side short of one, going round from the north, names the first
 * corner of it that carries nothing.
 */
export function jettyRoofRests(g: Game, b: Building, x: number, y: number): string | null {
  const top = b.levels - 1;
  const area = g.buildings.storeyArea(b, top);
  for (const [side, dx, dy] of SIDES) {
    if (area.has(`${x + dx},${y + dy}`)) continue;
    const border = borderOf(x, y, side);
    if (holds(g, top, border)) continue;
    for (const [cx, cy] of endsOf(border)) {
      if (cornerCarries(g, top, cx, cy, border)) continue;
      return `A roof over the jetty rests on walls or columns: raise a column on its ${cornerName({ x, y }, cx, cy)} corner first. A railing carries nothing.`;
    }
  }
  return null;
}

/**
 * Whether a floor of a storey on a tile out past the footprint lies on the
 * jetty of the storey under it, inside that storey: a storey over a jettied
 * room floored out as far as the room goes, on the room's walls.
 */
export function onJettyBelow(g: Game, b: Building, level: number, x: number, y: number): boolean {
  if (level < 2) return false;
  const f = g.buildings.floor(level - 1, x, y);
  return !!f && f.building === b.id && isDone(f) && f.kind !== 'roof' && f.kind !== 'stairs' && f.kind !== 'ladder'
    && g.buildings.storeyArea(b, level - 1).has(`${x},${y}`);
}

/** A tile's own corner a job names, or null when the corner is not one of its four. */
export const cornerOf = (t: TileTarget): [number, number] | null =>
  (t.cx === t.x || t.cx === t.x + 1) && (t.cy === t.y || t.cy === t.y + 1) ? [t.cx, t.cy] : null;

/** A corner of a tile by the two sides it is between: "north-west". */
export const cornerName = (t: { x: number; y: number }, cx: number, cy: number): string =>
  `${SIDE_NAMES[cy === t.y ? 'n' : 's']}-${SIDE_NAMES[cx === t.x ? 'w' : 'e']}`;

/** Whether a jetty of some building is over a tile, and so whose: nothing else may be built there. */
export function jettyOver(g: Game, x: number, y: number): string | null {
  const over = g.buildings.jettyAt(x, y);
  return over ? `That tile is under ${over.name}'s jetty.` : null;
}

/**
 * The height of the floor a jetty's storeys are counted from: a building on
 * piers counts every storey from its deck (`Building.deck`, `Game.deckBase`);
 * any other, from the ground at the footprint tile across the side it rests
 * on, as the building's own floors are drawn from their tile's corner.
 */
export function jettyBase(g: Game, b: Building, x: number, y: number): number | null {
  if (b.deck != null) return b.deck;
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    if (g.buildings.tileIndex.get(`${x + dx},${y + dy}`) === b.id) return g.world.getHeight(x + dx, y + dy);
  }
  return null;
}

/**
 * Why a floor, or the roof over one, may not be planned on a tile out past a
 * building's footprint, or null when it may. `kind` and `level` are what the
 * job asks for: a floor on the storey being worked, or the roof over the
 * top one. Asked after the material, the mallet and the building.
 */
export function jettyReason(g: Game, t: TileTarget, b: Building, kind: FloorKind, level: number): string | null {
  const bld = g.buildings;
  if (kind === 'stairs' || kind === 'ladder') return 'Stairs and ladders go inside the footprint, not out on a jetty.';
  if (kind === 'roof') {
    // Glass on a pitched roof and nowhere else, out over a jetty as over the footprint (`glassPlanRefusal`).
    if (t.material === GLASS && (b.roof ?? t.roofShape ?? 'hip') === 'flat') return GLASS_PITCHED;
    const top = b.levels - 1;
    const f = bld.floor(top, t.x, t.y);
    if (!f || f.building !== b.id || !isDone(f)) return `A roof goes out past the footprint only over a finished jetty of storey ${b.levels}.`;
    if (!bld.storeyArea(b, top).has(`${t.x},${t.y}`)) {
      return `That jetty is shut off from storey ${b.levels} by a wall or a door, which makes it a balcony, and a balcony takes no roof.`;
    }
    // And on what: walls or columns round it, never a railing.
    return jettyRoofRests(g, b, t.x, t.y);
  }
  if (level < 1) {
    return b.levels > 1 ? 'Work on storey 2 or above to floor a jetty here.'
      : 'A jetty is floored out from a storey above the ground: plan another storey and work on it.';
  }
  const other = bld.jettyAt(t.x, t.y);
  if (other && other.id !== b.id) return `That tile is under ${other.name}'s jetty.`;
  if (!g.onDeed(t.x, t.y)) return 'You may only build on your own deed.';
  // No span of a bridge or an aqueduct goes under it (`aqueducts.ts`); a bridge's ends are its banks.
  const span = g.bridges.size ? g.bridgeAt(t.x, t.y) : undefined;
  if (span) return span.kind === 'aqueduct' ? AQ_OVER : 'A bridge crosses that tile.';
  const tile = g.world.getTile(t.x, t.y);
  if (!g.world.isPassable(t.x, t.y) || tile === TileType.Bush) return 'A jetty is built over open ground: clear the tree or the bush from under it first.';
  const bears = bld.jettyBearer(b, level, t.x, t.y);
  if (bears) {
    // Clear of the ground by a storey: never lower over it than the storey under it stands.
    const [dx, dy] = bears.side === 'n' ? [0, -1] : bears.side === 's' ? [0, 1] : bears.side === 'w' ? [-1, 0] : [1, 0];
    // On piers, from the building's deck (`jettyBase`).
    const floorBelow = (b.deck ?? g.world.getHeight(t.x + dx, t.y + dy)) + (level - 1) * WALL_HEIGHT;
    const w = g.world;
    const high = Math.max(w.getHeight(t.x, t.y), w.getHeight(t.x + 1, t.y), w.getHeight(t.x + 1, t.y + 1), w.getHeight(t.x, t.y + 1));
    if (high > floorBelow) return `The ground under it rises above the floor of storey ${level}: dig it down, or floor the jetty out a storey higher.`;
  } else if (!onJettyBelow(g, b, level, t.x, t.y)) {
    // Or over the jetty of the storey below, inside that storey, on its walls.
    return `A jetty rests on a finished full-height wall of storey ${level}: build one on a side this tile shares with ${b.name} first.`;
  }
  const mat = t.material ? MATERIAL_BY_ID.get(t.material) : undefined;
  const carries = bld.bearing(b, level);
  if (mat && mat.heft > carries) {
    return `${mat.name} is too heavy to lay out past the walls. The walls under it carry ${heftWord(carries)}, no more.`;
  }
  return null;
}

/**
 * What wall work may not do round a flat roof or with a railing, or null.
 * Asked after the side, the type, the material, the mallet and the building.
 */
export function wallFrameReason(g: Game, t: TileTarget, b: Building): string | null {
  if (t.terrace) {
    if (roofShapeOf(b) !== 'flat') return 'Only a flat roof is a terrace.';
    if (t.wallType !== 'railing') return 'Only a railing goes round a terrace.';
    const deck = g.buildings.roofAt(b.levels, t.x, t.y);
    if (!deck || !isDone(deck)) return 'Finish the roof on this tile first.';
    return null;
  }
  const level = jobLevel(b, t);
  // The ground floor of a tile on piers is its deck, whose edge is a drop as an upper floor's is (`piers.ts`).
  if (t.wallType === 'railing' && level < 1 && !g.buildings.onPiers(t.x, t.y)) {
    return 'A railing goes on the edge of a storey above the ground, of a deck on piers, or round a terrace. On the ground, plan a fence.';
  }
  // A wall shutting a roofed jetty off from its storey would make a balcony with a roof on it.
  if (t.side && t.wallType && !isLowWall(t.wallType) && level === b.levels - 1 && !g.buildings.wall(level, t.x, t.y, t.side)
      && roofCutOff(g, b, borderOf(t.x, t.y, t.side))) {
    return 'The roof is over that jetty: take it off first. A balcony takes no roof.';
  }
  return null;
}

/** Whether a wall on a border of the top storey would shut a jetty with the roof over it out of the storey. */
function roofCutOff(g: Game, b: Building, border: Border): boolean {
  const bld = g.buildings;
  const top = b.levels - 1;
  let roofed = false;
  for (const [x, y] of bld.roofTiles(b)) if (!bld.tileIndex.has(`${x},${y}`) && bld.floor(b.levels, x, y)?.building === b.id) { roofed = true; break; }
  if (!roofed) return false;
  const now = bld.storeyArea(b, top);
  const then = bld.storeyArea(b, top, border);
  for (const key of now) {
    if (then.has(key) || bld.tileIndex.has(key)) continue;
    const [xs, ys] = key.split(',');
    if (bld.floor(b.levels, Number(xs), Number(ys))?.building === b.id) return true;
  }
  return false;
}

/** Whether a railing stands round a flat roof on any side of a tile, which tearing up that roof would leave in the air. */
export function terraceRailed(g: Game, b: Building, x: number, y: number): boolean {
  for (const side of ['n', 'e', 's', 'w'] as Side[]) {
    const w = g.buildings.wallOnBorder(b.levels, borderOf(x, y, side));
    if (w && w.building === b.id) return true;
  }
  return false;
}

/** The column on the corner a job names, on the storey being worked, if any. */
export function columnAt(g: Game, t: TileTarget): Column | undefined {
  const b = storeyOf(g, t);
  const c = cornerOf(t);
  return b && c ? g.buildings.column(jobLevel(b, t), c[0], c[1]) : undefined;
}

/**
 * Whether a tile of a storey is something for a column to stand on: on the
 * ground floor, a tile of the footprint -- on piers, once its deck is built
 * (`Game.pierDeckAt`) -- and higher up a finished floor of the building, its
 * own or its jetty's.
 */
function footsColumn(g: Game, b: Building, level: number, x: number, y: number): boolean {
  const bld = g.buildings;
  if (level <= 0) {
    if (bld.tileIndex.get(`${x},${y}`) !== b.id) return false;
    if (!bld.onPiers(x, y)) return true;
    const deck = bld.floor(0, x, y);
    return !!deck && isDone(deck);
  }
  const f = bld.floor(level, x, y);
  return !!f && f.building === b.id && isDone(f) && f.kind !== 'roof';
}

/** Whether a storey has a footing at a corner for a column to stand on: any of the four tiles round it (`footsColumn`). */
export function columnFooting(g: Game, b: Building, level: number, cx: number, cy: number): boolean {
  return [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]].some(([x, y]) => footsColumn(g, b, level, x, y));
}

/**
 * The storey of a jetty that rests on a wall and on nothing else, when one
 * does: what taking the wall down would leave in the air. Null for a wall
 * nothing rests on, one whose jetty has another wall to rest on, or one with
 * a finished column at each end of it to carry that side instead
 * (`Buildings.carried`).
 */
export function jettyOnWall(g: Game, wall: Wall): number | null {
  const bld = g.buildings;
  if (!wall.building || isLowWall(wall.type) || !isDone(wall)) return null;
  const b = bld.list.get(wall.building);
  if (!b || bld.carried(wall.level, wall)) return null;
  const [ox, oy] = wall.dir === 'h' ? [wall.x, wall.y - 1] : [wall.x - 1, wall.y];
  for (const [[jx, jy], [fx, fy]] of [[[wall.x, wall.y], [ox, oy]], [[ox, oy], [wall.x, wall.y]]] as Array<[[number, number], [number, number]]>) {
    if (bld.tileIndex.get(`${fx},${fy}`) !== b.id || bld.tileIndex.has(`${jx},${jy}`)) continue;
    const f = bld.floor(wall.level + 1, jx, jy);
    if (!f || f.building !== b.id) continue;
    // Its other walls to rest on, this one left out.
    let others = 0;
    for (const [side, dx, dy] of [['n', 0, -1], ['e', 1, 0], ['s', 0, 1], ['w', -1, 0]] as Array<[Side, number, number]>) {
      if (bld.tileIndex.get(`${jx + dx},${jy + dy}`) !== b.id) continue;
      const border = borderOf(jx, jy, side);
      if (border.dir === wall.dir && border.x === wall.x && border.y === wall.y) continue;
      const w = bld.wallOnBorder(wall.level, border);
      if (w && w.building === b.id && isDone(w) && !isLowWall(w.type)) others++;
    }
    if (!others) return wall.level + 1;
  }
  return null;
}

/**
 * The roof over a jetty that rests on a wall and on nothing else there, when
 * one does: a full-height wall of the top storey on a side of a roofed jetty
 * out of the storey, with no finished column at each end of it to take the
 * roof instead; or the end of a full-height wall that is all that carries an
 * end of such a side (`roofEndOn`). What to do first, or null.
 */
export function jettyRoofOnWall(g: Game, wall: Wall): string | null {
  const bld = g.buildings;
  if (!wall.building || isLowWall(wall.type) || !isDone(wall)) return null;
  const b = bld.list.get(wall.building);
  if (!b || bld.carried(wall.level, wall)) return null;
  if (wall.level === b.levels - 1) {
    const area = bld.storeyArea(b, wall.level);
    const [ox, oy] = wall.dir === 'h' ? [wall.x, wall.y - 1] : [wall.x - 1, wall.y];
    for (const [[jx, jy], [nx, ny]] of [[[wall.x, wall.y], [ox, oy]], [[ox, oy], [wall.x, wall.y]]] as Array<[[number, number], [number, number]]>) {
      // A jetty of the storey under the roof, with the other side of the wall out of the storey.
      if (bld.tileIndex.has(`${jx},${jy}`) || !area.has(`${jx},${jy}`) || area.has(`${nx},${ny}`)) continue;
      if (bld.floor(b.levels, jx, jy)?.building === b.id) {
        return 'The roof over the jetty rests on this wall: raise a column at each end of it, or take the roof off, first.';
      }
    }
  }
  const end = roofEndOn(g, wall);
  return end ? `The roof over the jetty rests on the ${end} end of this wall: raise a column there, or take the roof off, first.` : null;
}

/**
 * The end of a finished full-height wall, by its compass point, that is all
 * that carries an end of a side of a roofed jetty (`jettyRoofRests`): one on
 * a corner with no finished column on it, where `roofSideOn` finds a side
 * resting on it. Null when there is none.
 */
function roofEndOn(g: Game, wall: Wall): string | null {
  for (const [i, [cx, cy]] of endsOf(wall).entries()) {
    const c = g.buildings.column(wall.level, cx, cy);
    if (c && isDone(c)) continue;
    if (roofSideOn(g, wall.level, cx, cy, wall)) return SIDE_NAMES[wall.dir === 'h' ? (i === 0 ? 'w' : 'e') : (i === 0 ? 'n' : 's')];
  }
  return null;
}

/**
 * The first side of a roofed jetty of a storey, going round the tiles about a
 * corner from the north-west, whose end there nothing but `but` -- the wall or
 * the column it is asked for -- carries (`jettyRoofRests`): a side out of the
 * jetty's storey with no finished full-height wall on it, on a corner where no
 * other finished full-height wall ends. As the tile and its side, or null.
 */
function roofSideOn(g: Game, level: number, cx: number, cy: number, but?: Border): { x: number; y: number; side: Side } | null {
  const bld = g.buildings;
  const same = (a: Border, b: Border): boolean => a.dir === b.dir && a.x === b.x && a.y === b.y;
  const full = (r: Border): boolean => {
    const w = bld.wallOnBorder(level, r);
    return !!w && isDone(w) && !isLowWall(w.type);
  };
  const round: Border[] = [{ dir: 'h', x: cx - 1, y: cy }, { dir: 'h', x: cx, y: cy }, { dir: 'v', x: cx, y: cy - 1 }, { dir: 'v', x: cx, y: cy }];
  // Another finished full-height wall ending there carries the corner as well.
  if (round.some((r) => !(but && same(r, but)) && full(r))) return null;
  for (const [jx, jy] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]]) {
    const j = bld.jettyAt(jx, jy);
    if (!j || j.levels - 1 !== level || bld.tileIndex.has(`${jx},${jy}`) || bld.floor(j.levels, jx, jy)?.building !== j.id) continue;
    const area = bld.storeyArea(j, level);
    if (!area.has(`${jx},${jy}`)) continue;
    // The tile's two sides that meet on the corner, each with the tile across it.
    for (const [side, dx, dy] of SIDES) {
      const edge = borderOf(jx, jy, side);
      if (!endsOf(edge).some(([ex, ey]) => ex === cx && ey === cy) || (but && same(edge, but))) continue;
      if (area.has(`${jx + dx},${jy + dy}`) || full(edge)) continue;
      return { x: jx, y: jy, side };
    }
  }
  return null;
}

/**
 * The storey over a wall, standing on it, when one does: a finished
 * full-height wall of a storey under a wall of its building's storey over it
 * on the same border, one with any of its materials in -- a plan stands on
 * nothing, and a neighbour's jetty wall stands on its own floor -- with no
 * finished column at each end of it to carry that side instead. What to do
 * first, or null.
 */
export function storeyOnWall(g: Game, wall: Wall): string | null {
  const bld = g.buildings;
  if (isLowWall(wall.type) || !isDone(wall) || !wall.building) return null;
  const b = bld.list.get(wall.building);
  if (!b || wall.level + 1 > b.levels - 1) return null;
  const up = bld.wallOnBorder(wall.level + 1, wall);
  if (!up || up.building !== wall.building || progressOf(up) <= 0 || bld.carried(wall.level, wall)) return null;
  return `Storey ${wall.level + 2} stands on this wall: raise a column at each end of it, or take down the wall over it, first.`;
}

/**
 * What a column carries, when it carries anything: a side at its corner on
 * the edge of its storey, with no finished full-height wall on it, closed by
 * this column and the finished one at its other end, with a floor or a roof
 * of its building over one of the two tiles either side. The first such side
 * names the tile and its side. A side inside the storey carries nothing, nor
 * does one a wall stands on: a column on a corner that walls carry comes down.
 * Nor does one that alone carries an end of an open side of a roofed jetty
 * (`roofSideOn`), which it names too.
 */
export function columnCarries(g: Game, c: Column): string | null {
  const bld = g.buildings;
  const b = bld.list.get(c.building);
  if (!isDone(c) || !b) return null;
  const borders: Border[] = [
    { dir: 'h', x: c.x - 1, y: c.y }, { dir: 'h', x: c.x, y: c.y },
    { dir: 'v', x: c.x, y: c.y - 1 }, { dir: 'v', x: c.x, y: c.y },
  ];
  let area: Set<string> | undefined;
  for (const border of borders) {
    if (!bld.carried(c.level, border)) continue;
    const w = bld.wallOnBorder(c.level, border);
    if (w && isDone(w) && !isLowWall(w.type)) continue;
    const either: Array<[number, number, Side]> = border.dir === 'h'
      ? [[border.x, border.y - 1, 's'], [border.x, border.y, 'n']]
      : [[border.x - 1, border.y, 'e'], [border.x, border.y, 'w']];
    area ??= bld.storeyArea(b, c.level);
    if (either.filter(([x, y]) => area?.has(`${x},${y}`)).length !== 1) continue;
    for (const [x, y, side] of either) {
      if (bld.floor(c.level + 1, x, y)?.building === c.building) {
        return `The ${SIDE_NAMES[side]} side of ${x},${y} is carried on this column: wall it, or take off what is over it, first.`;
      }
    }
  }
  // And the end of a side of a roofed jetty that rests on it alone (`roofSideOn`).
  const open = roofSideOn(g, c.level, c.x, c.y);
  if (open) return `The roof over the jetty rests on this column: wall the ${SIDE_NAMES[open.side]} side of ${open.x},${open.y}, or take the roof off, first.`;
  return null;
}

/**
 * What a floor of a storey above the ground, or the deck of a tile on piers,
 * still holds up, when it does: a column of its building standing on it and
 * on nothing else round its corner (`footsColumn`), or, out on a jetty, the
 * building's roof over it. What to take down first, or null when it can come
 * up. A ground floor on the ground holds nothing up: the ground does.
 */
export function floorHolds(g: Game, b: Building, level: number, x: number, y: number): string | null {
  const bld = g.buildings;
  if (level < 0 || (level === 0 && !bld.onPiers(x, y))) return null;
  for (const [cx, cy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) {
    const c = bld.column(level, cx, cy);
    if (!c || c.building !== b.id) continue;
    const footed = [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]].some(([fx, fy]) => (fx !== x || fy !== y) && footsColumn(g, b, level, fx, fy));
    if (!footed) return `Take down the column on its ${cornerName({ x, y }, cx, cy)} corner first.`;
  }
  if (level === 0) return null;
  if (!bld.tileIndex.has(`${x},${y}`)) {
    if (level === b.levels - 1 && bld.floor(b.levels, x, y)?.building === b.id) return 'Take the roof over it off first.';
    // A floor of the storey over it laid on this one, with no wall of its own to rest on.
    const over = level + 1 <= b.levels - 1 ? bld.floor(level + 1, x, y) : undefined;
    if (over && over.building === b.id && !bld.jettyBearer(b, level + 1, x, y)) {
      return `The floor of storey ${level + 2} rests on it: take that up first.`;
    }
  }
  return null;
}
