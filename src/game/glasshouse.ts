/**
 * Glasshouses.
 *
 * A roof tile may be laid in glass (`GLASS_ROOF` in building.ts): panes on
 * timber glazing bars, put up with a mallet and trained as carpentry, at a
 * roof shape's share of a solid wall's bill as every roof is -- a hipped tile
 * `floorBill('glass', 'roof', 'hip')`. It goes on a pitched roof, gabled or
 * hipped, and on nothing else: no wall, floor, fence or stair is laid in
 * glass, and a flat roof is a deck for walking on.
 *
 * A building of one storey, walled all round -- a finished full-height wall,
 * door, window or arch on every border of its footprint's outline
 * (`walledRound`); a fence, a gate or a half wall is low and does not do -- with
 * every tile of its footprint under a finished roof of glass is a glasshouse
 * (`isGlasshouse`), and it is the one building whose ground is tilled: a
 * ground-floor tile of it with no floor on it rakes into a field, and the
 * field is sown, tended and harvested as any field is -- the Farmer's perks
 * and patches, Bounty and a night's sleep included. No floor is planned over
 * a field, and while a building has a field in it no roof but glass is planned
 * on it and no storey raised over it: a field is cleared (`clear_field`)
 * before any of them, and a field cleared inside a footprint is packed flat
 * again as the rest of the footprint is (`clearedTo`).
 *
 * What grows there grows at `GLASSHOUSE_GROWTH` of its pace in every season,
 * winter included, on a clock of its own: the glass clock, `GLASSHOUSE_GROWTH`
 * of the plain one (`Game.glassNow`; the island's `crop_clock_on('glass')`).
 * A crop knows which clock it is on (`Crop.glass`, the island's `crop.glass`),
 * and when the building over it becomes a glasshouse or stops being one --
 * the last of its glass finished, a tile of the roof taken off, a wall taken
 * down or finished, a tile added to the footprint -- every crop on the footprint is carried onto the other
 * clock as far into its stage as it had grown (`rebaseStage`, the island's
 * `crop_rebased`). The island does it by triggers on the rows a roof, a wall
 * and a footprint are kept in, so no way of changing any of them can miss it;
 * this side after every building job, off the same rule (`glassResync`). A
 * planter keeps its own clock wherever it stands, a glasshouse included.
 *
 * Walled all round and roofed over, every room in it is shut in and covered,
 * so whatever is left lying in one is indoors (`Buildings.indoors`) and rots
 * at `INDOORS_DECAY` of the rate outside.
 */
import type { Target } from './actions';
import { floorKind, GLASS_ROOF, isDone, onlyRefusal, WALL_TYPE_BY_ID, workLevel, type Building, type Buildings } from './building';
import type { Game } from './game';
import { rebaseStage } from './growth';
import { TileType } from '../world/tiles';

type TileTarget = Extract<Target, { kind: 'tile' }>;

/** The material a glass roof is laid in, by its id. */
export const GLASS = GLASS_ROOF.id;

/** Why glass is not laid as a wall, a fence, a floor or a stair. */
export const GLASS_ROOF_ONLY = 'Glass is laid on a roof and nowhere else.';
/** Why a flat roof is not laid in glass. */
export const GLASS_PITCHED = 'A glass roof is pitched, gabled or hipped: a flat roof is a deck for walking on.';
/** Why a floor is not planned over a field. */
export const FIELD_UNFLOORED = 'There is a field here: clear the field before you floor it.';
/** Why a roof of anything but glass is not planned on a building with a field in it. */
export const FIELD_GLASS_ONLY = 'There is a field in this building, and only glass roofs a field: plan glass, or clear the field first.';
/** Why no storey is raised over a building with a field in it. */
export const FIELD_NO_STOREY = 'There is a field in this building: clear the field before you raise a storey over it.';
/** Why the ground in a building that is not a glasshouse does not rake into a field. */
export const NOT_A_GLASSHOUSE = 'Only a glasshouse is tilled: one storey, walled all round to full height, with every tile of it under a finished roof of glass.';
/** What clearing a field inside a footprint says: it goes back to packed earth, as the rest of the footprint is. */
export const FIELD_PACKED = 'You clear the field and pack the ground flat again.';
/**
 * What clearing a field says: the crop turned back into the soil if there was
 * one, and inside a footprint the ground packed flat again. The island's
 * `clear_field` in `perform_farm`, in the same words.
 */
export const clearedSaid = (crop: string | null, packed: boolean): string =>
  crop ? `You turn the ${crop} back into the soil${packed ? ' and pack the ground flat again' : ''}.` : packed ? FIELD_PACKED : 'You break the field back up into plain dirt.';
/** Why a glasshouse's ground does not rake into a field where a floor is planned on it. */
export const GLASS_FLOORED = 'There is a floor here: take it up before you till.';
/** Why a glasshouse's ground does not rake into a field where it stands on a foundation: a pour of concrete, packed over and with no soil in it. */
export const GLASS_SLAB = 'That is a poured slab: there is no soil in it to till. Till where the glasshouse stands on earth.';
/** Why ground that is not bare earth does not. The island's words for it anywhere (`farm_refusal`). */
export const NOT_TILLABLE = 'That ground will not rake into a field.';

/**
 * Whether a building is walled all round on its ground floor: a finished wall
 * of full height -- a door, a window and an arch are; a fence, a gate or a half
 * wall (`low`) is not -- on every border of its footprint's outline, which is
 * what shuts every room of it in to the eaves. The island's `walled_round`.
 */
export function walledRound(bld: Buildings, b: Building): boolean {
  for (const border of bld.exteriorBorders(b)) {
    const w = bld.wallOnBorder(0, border);
    if (!w || !isDone(w) || WALL_TYPE_BY_ID.get(w.type)?.low) return false;
  }
  return true;
}

/**
 * Whether a building is a glasshouse: one storey, walled all round, and every
 * tile of its footprint under a finished roof tile of glass.
 */
export function isGlasshouse(bld: Buildings, b: Building | undefined): boolean {
  if (!b || b.levels !== 1 || !b.tiles.length) return false;
  if (!walledRound(bld, b)) return false;
  for (const k of b.tiles) {
    const [xs, ys] = k.split(',');
    const f = bld.floor(1, Number(xs), Number(ys));
    if (!f || floorKind(f) !== 'roof' || f.material !== GLASS || !isDone(f)) return false;
  }
  return true;
}

/** Whether any of a building's roof is planned or laid in glass. */
export function glazing(bld: Buildings, b: Building | undefined): boolean {
  if (!b) return false;
  for (const k of b.tiles) {
    const [xs, ys] = k.split(',');
    const f = bld.floor(b.levels, Number(xs), Number(ys));
    if (f && floorKind(f) === 'roof' && f.material === GLASS) return true;
  }
  return false;
}

/** Whether a tile is under glass: part of a glasshouse. */
export const underGlass = (bld: Buildings, x: number, y: number): boolean => isGlasshouse(bld, bld.buildingAt(x, y));

/** What a field cleared at (x, y) turns back into: packed earth inside a footprint, as all of a footprint is; dirt anywhere else. */
export const clearedTo = (bld: Buildings, x: number, y: number): TileType => (bld.buildingAt(x, y) ? TileType.PackedDirt : TileType.Dirt);

/** Whether any tile of a building's footprint is a field. The island's `field_in`. */
export function fieldIn(g: Game, b: Building): boolean {
  for (const k of b.tiles) {
    const [xs, ys] = k.split(',');
    if (g.world.getTile(Number(xs), Number(ys)) === TileType.Field) return true;
  }
  return false;
}

/** How many of a building's footprint tiles are under a finished roof of glass, for the line that says how near it is. */
export function glassDone(bld: Buildings, b: Building): number {
  let n = 0;
  for (const k of b.tiles) {
    const [xs, ys] = k.split(',');
    const f = bld.floor(b.levels, Number(xs), Number(ys));
    if (f && floorKind(f) === 'roof' && f.material === GLASS && isDone(f)) n++;
  }
  return n;
}

/**
 * Why a building's ground at (x, y) does not rake into a field, or null when
 * it does: only a glasshouse's, only where no floor is planned on it, never a
 * poured slab, and only bare earth -- packed as a footprint is, or dirt or
 * grass. The island's `glass_till_refusal`, in the same order.
 */
export function glassTillRefusal(g: Game, x: number, y: number, tillable: ReadonlySet<number>): string | null {
  const b = g.buildings.buildingAt(x, y);
  if (!b) return null;
  if (!isGlasshouse(g.buildings, b)) return NOT_A_GLASSHOUSE;
  if (g.buildings.floor(0, x, y)) return GLASS_FLOORED;
  if (g.foundationAt(x, y)) return GLASS_SLAB;
  const t = g.world.getTile(x, y);
  if (t !== TileType.PackedDirt && !tillable.has(t)) return NOT_TILLABLE;
  return null;
}

/**
 * Why a wall, a fence, a floor slot or a storey will not be planned for glass
 * or over a field, or null: glass goes on a pitched roof and nowhere else; no
 * floor is planned on the ground floor over a field; and while a building has
 * a field in it, no roof but glass is planned on it and no storey raised over
 * it. Asked once the job knows its side, type and material (a storey, before
 * anything else); the island's `glass_refusal`, asked at the same point of
 * `build_refusal`.
 */
export function glassPlanRefusal(g: Game, t: TileTarget, action: 'plan_wall' | 'plan_fence' | 'plan_floor' | 'add_floor'): string | null {
  if (action === 'add_floor') {
    const b = g.buildings.buildingAt(t.x, t.y);
    return b && fieldIn(g, b) ? FIELD_NO_STOREY : null;
  }
  // Glass on a roof only, and a material with an `only` as that and nothing else (`onlyRefusal`).
  if (action !== 'plan_floor') return t.material === GLASS ? GLASS_ROOF_ONLY : onlyRefusal(t.material, { wall: t.wallType });
  const kind = t.floorKind ?? 'floor';
  if (t.material === GLASS && kind !== 'roof') return GLASS_ROOF_ONLY;
  const only = onlyRefusal(t.material, { floor: kind });
  if (only) return only;
  const b = g.buildings.buildingAt(t.x, t.y);
  if (!b) return null;
  // A building has one roof, and its first tile set the shape; the first tile asks for its own.
  if (t.material === GLASS && (b.roof ?? t.roofShape ?? 'hip') === 'flat') return GLASS_PITCHED;
  if (kind === 'floor' && workLevel(b) === 0 && g.world.getTile(t.x, t.y) === TileType.Field) return FIELD_UNFLOORED;
  if (kind === 'roof' && t.material !== GLASS && fieldIn(g, b)) return FIELD_GLASS_ONLY;
  return null;
}

/**
 * Every crop in a field on the clock its tile gives it now: the glass clock in
 * a glasshouse, a field's anywhere else. One that changes clock is carried
 * across as far into its stage as it had grown (`rebaseStage`), and says how
 * many did. Run after every building job by yourself; on an island the island
 * does it, and the ground read says which clock each crop is on.
 */
export function glassResync(g: Game): number {
  if (!g.crops.size) return 0;
  const glasshouse = new Map<number, boolean>();
  let n = 0;
  for (const c of g.crops.values()) {
    const b = g.buildings.buildingAt(c.x, c.y);
    let glass = false;
    if (b) {
      const was = glasshouse.get(b.id);
      glass = was ?? isGlasshouse(g.buildings, b);
      if (was === undefined) glasshouse.set(b.id, glass);
    }
    if (!!c.glass === glass) continue;
    // Read off the clock it was on, then the one it goes onto.
    const from = g.growNow(c);
    const to = glass ? g.glassNow() : g.fieldNow();
    c.stageAt = rebaseStage(c.stageAt, from, to);
    if (glass) c.glass = true;
    else delete c.glass;
    g.events.emit('world', c.x, c.y);
    n++;
  }
  return n;
}
