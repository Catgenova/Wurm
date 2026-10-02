import type { ActionDef, Target } from './actions';
import {
  borderOf,
  describeNeeds,
  scaledBill,
  FLOOR_KIND_NAMES,
  floorKind,
  isDone,
  MATERIAL_BY_ID,
  MAX_LEVELS,
  SIDE_NAMES,
  gapText,
  heftWord,
  roofShapeDef,
  storeySkill,
  WALL_TYPE_BY_ID,
  type Bill,
  type Building,
  type Wall,
  type WallType,
  type FloorKind,
  type MaterialDef,
  workLevel,
} from './building';
import type { PlacedCrate } from './crates';
import { pickDye } from './dyes';
import type { Game } from './game';
import { greenNow } from './greening';
import { glassPlanRefusal, glassResync } from './glasshouse';
import { itemDef, spendOut, type Item } from './items';

type TileTarget = Extract<Target, { kind: 'tile' }>;
const isTile = (t: Target): t is TileTarget => t.kind === 'tile';

const TOOL_NAMES: Record<string, string> = { mallet: 'a mallet', trowel: 'a trowel' };
const needTool = (g: Game, tool: string): string | null => (g.inventory.has(tool) ? null : `You need ${TOOL_NAMES[tool] ?? tool} for that.`);

/** Plural-ish item names for material lists. */
export function materialName(id: string, n: number): string {
  const name = itemDef(id).name.toLowerCase();
  if (n === 1 || name.endsWith('s') || ['mortar', 'thatch', 'adobe'].includes(name)) return name;
  return `${name}s`;
}

const needsText = (bill: Bill): string => describeNeeds(bill, materialName);

/**
 * The work site: a crate standing on the tile you are building on.
 *
 * A builder carried everything. Six log walls, at what a log weighs, is trip
 * after trip from the woodpile to the corner of a house, and the crate you
 * tipped them all into is standing on the very tile you are working — which
 * is where a builder's materials have stood since anybody built anything. So
 * the bill draws from a crate on the tile first and from the pack after: the
 * pile on the site is the pile you are building out of.
 *
 * On the tile, not within reach: a crate two tiles off is a store, and walking
 * to it is the point of it being over there.
 */
const siteCrates = (g: Game, x: number, y: number): PlacedCrate[] =>
  [...g.crates.values()].filter((c) => c.x === x && c.y === y);

/**
 * What a perk names building work by: `build_stone` for anything laid with
 * the trowel, `build_wood` for timber (`time:build_stone`, `reach:build_stone`).
 */
export const buildWork = (mat: MaterialDef | undefined): string => `build_${mat?.kind ?? 'wood'}`;

/**
 * The stores a Mason's Hod Carrier builds out of, besides the pack and a
 * crate on the tile: those within the perk's reach that a craft may take
 * from, nearest first. None for anybody without it, and none for timber.
 */
const hodStores = (g: Game, mat: MaterialDef | undefined): Array<{ items: Item[] }> => {
  const reach = g.perk(`reach:${buildWork(mat)}`, 0);
  return reach > 0 ? g.storesWithin(reach) : [];
};
const takeable = (it: Item, id: string): boolean => it.id === id && it.count > 0 && !it.locked && it.price === undefined;

/** The next item on a bill that is to hand: in the pack, in a crate on the tile, or in a Hod Carrier's reach. */
function nextAvailable(g: Game, bill: Bill & { material: string }, at?: { x: number; y: number }): string | null {
  const stores = hodStores(g, material(bill.material));
  for (const [id, n] of Object.entries(bill.needed)) {
    if (n <= 0) continue;
    if (g.inventory.has(id)) return id;
    if (at && siteCrates(g, at.x, at.y).some((c) => c.items.some((it) => it.id === id && it.count > 0))) return id;
    if (stores.some((st) => st.items.some((it) => takeable(it, id)))) return id;
  }
  return null;
}

/** One unit of `id` out of the pack, then a crate on the tile, then a Hod Carrier's stores. */
function takeUnit(g: Game, id: string, mat: MaterialDef | undefined, at?: { x: number; y: number }): boolean {
  if (g.inventory.has(id)) return g.inventory.consume(id);
  // Out of the crate on the site, a unit at a time, and the row goes when
  // the last of it does.
  for (const c of siteCrates(g, at?.x ?? 0, at?.y ?? 0)) {
    const i = c.items.findIndex((it) => it.id === id && it.count > 0);
    if (i < 0) continue;
    const it = c.items[i];
    it.count -= 1;
    if (it.count <= 0) c.items.splice(i, 1);
    return true;
  }
  for (const st of hodStores(g, mat)) {
    const it = st.items.find((x) => takeable(x, id));
    if (it && spendOut(st.items, it.uid, 1)) {
      g.events.emit('crate');
      return true;
    }
  }
  return false;
}

function consumeUnit(g: Game, bill: Bill & { material: string }, at?: { x: number; y: number }): string | null {
  const id = nextAvailable(g, bill, at);
  if (!id || !takeUnit(g, id, material(bill.material), at)) return null;
  bill.needed[id] -= 1;
  return id;
}

/** How much of `id` is to hand for a bill: the pack, a crate on the tile, and a Hod Carrier's reach. */
function toHand(g: Game, id: string, mat: MaterialDef | undefined, at: { x: number; y: number }): number {
  let n = g.inventory.count(id);
  for (const c of siteCrates(g, at.x, at.y)) for (const it of c.items) if (it.id === id) n += it.count;
  for (const st of hodStores(g, mat)) for (const it of st.items) if (takeable(it, id)) n += it.count;
  return n;
}

/**
 * A Mason's Repoint.
 *
 * A finished stone wall laid again in another stone, in one go: the new
 * stone's whole bill is paid out of whatever a wall may be built out of, the
 * fittings stay where they are, and `REPOINT_BACK` of the old stone comes
 * back -- the bricks, shards or adobe, not the mortar, which is spent once it
 * has set. The paint goes with the old face.
 */
/**
 * The share of its material a wall of this type is planned for: all of it,
 * or less for a fence type and a Carpenter's Fence Builder (`bill:fence`).
 * A fence type is one that stands on its own border (`FENCE_TYPES`), wherever
 * it is planned; the island asks the same of `wall_type_def.standalone`.
 */
export const fenceScale = (g: Game, type: WallType): number =>
  WALL_TYPE_BY_ID.get(type)?.standalone ? g.perk('bill:fence', 1) : 1;

export const REPOINT_BACK = 0.5;
export const REPOINT_TIME = 30;
/** What a wall of `mat` is laid in, without its fittings: the bill a Repoint pays. */
export const layingBill = (mat: string, type: Wall['type']): Bill => scaledBill(mat, WALL_TYPE_BY_ID.get(type)?.factor ?? 1);

function repointReason(g: Game, t: TileTarget): string | null {
  if (g.perk('repoint', 0) <= 0) return 'That wants a Mason who has learned to repoint.';
  if (!t.side) return 'Choose a side.';
  const wall = wallAt(g, t);
  if (!wall) return 'There is no wall there.';
  const was = material(wall.material);
  if (was?.kind !== 'stone') return 'Only a wall of stone is repointed.';
  if (!isDone(wall)) return 'Finish it before you repoint it.';
  const mat = material(t.material);
  if (!mat || mat.kind !== 'stone') return 'Choose the stone to lay it in.';
  if (mat.id === was.id) return `It is ${mat.name.toLowerCase()} already.`;
  const tool = needTool(g, mat.tool);
  if (tool) return tool;
  const b = buildingOf(g, t);
  if (b && wall.building === b.id) {
    // What is under it has to carry the new stone, as it would a new wall,
    // and the new stone has to carry what stands on it.
    const bears = g.buildings.bearing(b, wall.level);
    if (mat.heft > bears) return `${mat.name} is too heavy to raise over what is under it. This storey carries ${heftWord(bears)}, no more.`;
    let over = 0;
    for (const w of g.buildings.walls.values()) {
      if (w.building === b.id && w.level > wall.level) over = Math.max(over, material(w.material)?.heft ?? 0);
    }
    if (mat.heft < over) return `${mat.name} will not carry the ${heftWord(over)} standing on it.`;
    const stands = mat.storeys + g.perk(`storeys:${buildWork(mat)}`, 0);
    if (b.levels > stands) return `${mat.name} will not stand ${b.levels} storeys. ${stands} is as high as it goes.`;
  }
  const bill = layingBill(mat.id, wall.type);
  const short = Object.entries(bill.needed).filter(([id, n]) => toHand(g, id, mat, t) < n);
  if (short.length) return `You need ${needsText(bill)}.`;
  return null;
}

const buildingOf = (g: Game, t: TileTarget): Building | undefined => g.buildings.buildingAt(t.x, t.y);
const topLevel = (b: Building): number => workLevel(b);
/** The storey wall work happens on: a building's working one, or the ground. */
const wallLevel = (g: Game, t: TileTarget): number => {
  const b = buildingOf(g, t);
  return b ? topLevel(b) : 0;
};
/** The wall or fence on the side of a tile that is being worked on. */
const wallAt = (g: Game, t: TileTarget) => (t.side ? g.buildings.wall(wallLevel(g, t), t.x, t.y, t.side) : undefined);
const material = (id: string | undefined): MaterialDef | undefined => (id ? MATERIAL_BY_ID.get(id) : undefined);
/** "second", "third": the ordinal ending, for the sentence that names a storey. */
const nth = (n: number): string => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');

/** Building work. These are hidden from the generic menu; the UI composes them with sides and materials. */
export const BUILD_ACTIONS: ActionDef[] = [
  {
    id: 'plan_building',
    label: 'Plan building',
    verb: 'planning a building',
    hidden: true,
    asks: {
      question: 'What is the building called?',
      fallback: () => 'House',
      declined: 'You put the mallet away without planning anything.',
    },
    stamina: 0.02,
    baseTime: 3,
    applies: (t, g) => isTile(t) && !g.buildings.buildingAt(t.x, t.y),
    check: (t, g) => (isTile(t) ? (needTool(g, 'mallet') ?? g.planReason(t.x, t.y)) : null),
    perform: (t, g) => {
      if (!isTile(t)) return;
      const name = ((t as { name?: string }).name ?? '').trim();
      const b = g.buildings.create(name.slice(0, 32) || 'House', t.x, t.y);
      g.logMsg(`You plan ${b.name} here. Extend it onto neighbouring flat packed tiles, then plan walls on its borders.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'add_to_building',
    label: 'Add to building',
    verb: 'extending the plan',
    hidden: true,
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => isTile(t) && !g.buildings.buildingAt(t.x, t.y) && !!g.buildings.neighbourBuilding(t.x, t.y),
    check: (t, g) => {
      if (!isTile(t)) return null;
      const tool = needTool(g, 'mallet');
      if (tool) return tool;
      const b = g.buildings.neighbourBuilding(t.x, t.y);
      if (!b) return 'There is no building next to this tile.';
      if (b.levels > 1) return 'The footprint cannot change once upper floors are planned.';
      return g.planReason(t.x, t.y);
    },
    perform: (t, g) => {
      if (!isTile(t)) return;
      const b = g.buildings.neighbourBuilding(t.x, t.y);
      if (!b) return;
      g.buildings.addTile(b, t.x, t.y);
      // A tile with no glass over it: a glasshouse is one no longer, and what grows in it goes back on the field's clock.
      glassResync(g);
      g.logMsg(`You add the tile to ${b.name}.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'remove_from_plan',
    label: 'Remove from plan',
    verb: 'removing the plan',
    hidden: true,
    stamina: 0.01,
    baseTime: 2,
    applies: (t, g) => isTile(t) && !!buildingOf(g, t),
    check: (t, g) => {
      if (!isTile(t)) return null;
      const b = buildingOf(g, t);
      if (!b) return 'No building here.';
      if (b.levels > 1) return 'Remove the upper floors first.';
      if (g.buildings.tileHasStructures(t.x, t.y)) return 'Remove the walls and floor on this tile first.';
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t)) return;
      const b = buildingOf(g, t);
      if (!b) return;
      g.buildings.removeTile(b, t.x, t.y);
      glassResync(g);
      g.logMsg(b.tiles.length ? `You remove the tile from ${b.name}.` : `You remove the last of ${b.name}'s plan.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'plan_wall',
    label: 'Plan wall',
    verb: 'planning a wall',
    hidden: true,
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => isTile(t) && !!buildingOf(g, t),
    check: (t, g) => {
      if (!isTile(t) || !t.side || !t.wallType || !t.material) return 'Choose a side, a wall type and a material.';
      // Glass goes on a roof and nowhere else (`glasshouse.ts`).
      const glass = glassPlanRefusal(g, t, 'plan_wall');
      if (glass) return glass;
      const tool = needTool(g, 'mallet');
      if (tool) return tool;
      const b = buildingOf(g, t);
      if (!b) return 'No building here.';
      const level = topLevel(b);
      if (level > 0) {
        const floor = g.buildings.floor(level, t.x, t.y);
        if (!floor || !isDone(floor)) return 'Build the floor of this storey first.';
      }
      if (g.buildings.wall(level, t.x, t.y, t.side)) return 'There is already a wall on that side.';
      /*
       * And what is underneath has to carry it. A storey of cut stone raised
       * over a log one is a roof looking for somewhere to fall; the courses
       * below are what hold a wall up, and a beginner finds that out by
       * being told rather than by watching it come down.
       */
      const mat = material(t.material);
      const bears = g.buildings.bearing(b, level);
      if (mat && mat.heft > bears) {
        return `${mat.name} is too heavy to raise over what is under it. This storey carries ${heftWord(bears)}, no more.`;
      }
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t) || !t.side || !t.wallType || !t.material) return;
      const b = buildingOf(g, t);
      if (!b) return;
      // A fence type stood in a building is still a fence, to a Carpenter's Fence Builder.
      const wall = g.buildings.setWall(b, topLevel(b), t.x, t.y, t.side, t.wallType, t.material, fenceScale(g, t.wallType));
      // A glasshouse is walled all round (`glasshouse.ts`).
      glassResync(g);
      const type = WALL_TYPE_BY_ID.get(t.wallType)?.name.toLowerCase() ?? t.wallType;
      g.logMsg(`You plan a ${type} ${material(t.material)?.name.toLowerCase()} wall on the ${SIDE_NAMES[t.side]} side. It needs ${needsText(wall)}.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'plan_fence',
    label: 'Plan fence',
    verb: 'planning a fence',
    hidden: true,
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => isTile(t) && !buildingOf(g, t),
    check: (t, g) => {
      if (!isTile(t) || !t.side || !t.wallType || !t.material) return 'Choose a side, a kind and a material.';
      const glass = glassPlanRefusal(g, t, 'plan_fence');
      if (glass) return glass;
      const type = WALL_TYPE_BY_ID.get(t.wallType);
      if (!type?.standalone) return 'Only fences and half walls stand on their own.';
      const mat = material(t.material);
      const tool = mat ? needTool(g, mat.tool) : 'Choose a material.';
      if (tool) return tool;
      if (buildingOf(g, t)) return 'That is part of a building: plan a wall instead.';
      const border = borderOf(t.x, t.y, t.side);
      // The border is shared, so the tile on the other side of it has a say.
      const [ax, ay] = t.side === 'n' ? [t.x, t.y - 1] : t.side === 's' ? [t.x, t.y + 1] : t.side === 'w' ? [t.x - 1, t.y] : [t.x + 1, t.y];
      if (g.buildings.buildingAt(ax, ay)) return 'A building stands on the other side of that border.';
      if (!g.world.inBounds(ax, ay)) return 'That border is the edge of the world.';
      if (g.world.hasWater(t.x, t.y) || g.world.hasWater(ax, ay)) return 'Fences do not stand in water.';
      if (!g.world.isPassable(t.x, t.y) || !g.world.isPassable(ax, ay)) return 'There is no room for posts there.';
      if (g.buildings.wallOnBorder(0, border)) return 'There is already something on that border.';
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t) || !t.side || !t.wallType || !t.material) return;
      // For less of the material, for a Carpenter's Fence Builder, as `perform_building` has it.
      const wall = g.buildings.setFence(t.x, t.y, t.side, t.wallType, t.material, fenceScale(g, t.wallType));
      const type = WALL_TYPE_BY_ID.get(t.wallType)?.name.toLowerCase() ?? 'fence';
      g.logMsg(`You mark out a ${material(t.material)?.name.toLowerCase()} ${type} on the ${SIDE_NAMES[t.side]} border. It needs ${needsText(wall)}.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'build_wall',
    label: 'Build wall',
    verb: 'building',
    hidden: true,
    repeat: true,
    stamina: 0.03,
    baseTime: 5,
    applies: (t, g) => isTile(t) && (!!buildingOf(g, t) || !!wallAt(g, t)),
    check: (t, g) => {
      if (!isTile(t) || !t.side) return 'Choose a side.';
      const wall = wallAt(g, t);
      if (!wall) return 'There is no wall planned there.';
      if (isDone(wall)) return 'That wall is finished.';
      const mat = material(wall.material);
      const tool = mat ? needTool(g, mat.tool) : null;
      if (tool) return tool;
      if (!nextAvailable(g, wall, t)) return `You need ${needsText(wall)}.`;
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t) || !t.side) return false;
      const wall = wallAt(g, t);
      if (!wall || isDone(wall)) return false;
      const mat = material(wall.material);
      const used = consumeUnit(g, wall, t);
      if (!used || !mat) return false;
      g.gainSkill(mat.skill, 0.4);
      g.events.emit('world', t.x, t.y);
      if (isDone(wall)) {
        // Finished, and bare: the ivy starts from here (`greening.ts`).
        wall.greenSince = greenNow();
        // The last wall round a building roofed in glass makes a glasshouse of it (`glasshouse.ts`).
        glassResync(g);
        const what = WALL_TYPE_BY_ID.get(wall.type)?.low ? WALL_TYPE_BY_ID.get(wall.type)?.name.toLowerCase() : 'wall';
        g.logMsg(`You finish the ${mat.name.toLowerCase()} ${what}.`, 'event');
        return false;
      }
      g.logMsg(`You fit ${materialName(used, 1)} into the wall. Still needed: ${needsText(wall)}.`, 'event');
      return nextAvailable(g, wall, t) !== null;
    },
  },
  /*
   * Paint.
   *
   * Everything on this island comes out the colour of what it was made of, so
   * a street of twelve materials is a street of twelve colours and no more:
   * the builder chooses what a wall is *of* and never what it looks like. A
   * pot of the same dye the tailoring uses, worked into a limewash and
   * brushed over finished work, is the first thing a builder gets to choose —
   * and it is cheap, which is the point of offering it at all.
   */
  {
    id: 'paint_wall',
    label: 'Paint the wall',
    verb: 'painting',
    hidden: true,
    skill: 'alchemy',
    stamina: 0.02,
    baseTime: 6,
    applies: (t, g) => isTile(t) && !!wallAt(g, t),
    labelFor: (t, g) => {
      const d = pickDye(g);
      return d ? `Paint it ${d.def.word}` : 'Paint the wall';
    },
    check: (t, g) => {
      if (!isTile(t) || !t.side) return 'Choose a side.';
      const wall = wallAt(g, t);
      if (!wall) return 'There is no wall there.';
      if (!isDone(wall)) return 'Finish it before you paint it.';
      const d = pickDye(g);
      if (!d) return 'You have no dye. Boil one out of berries, acorns or herbs with a bucket of lye.';
      if (wall.dye === d.def.id) return `It is ${d.def.word} already.`;
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t) || !t.side) return;
      const wall = wallAt(g, t);
      const d = pickDye(g);
      if (!wall || !d || !g.inventory.remove(d.item.uid, 1)) return;
      wall.dye = d.def.id;
      g.gainSkill('alchemy', 0.3);
      g.logMsg(`You brush the ${d.def.name.toLowerCase()} over the wall on the ${SIDE_NAMES[t.side]} side. It comes up ${d.def.word}.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'strip_wall_paint',
    label: 'Scrub the paint off',
    verb: 'scrubbing',
    hidden: true,
    skill: 'alchemy',
    stamina: 0.03,
    baseTime: 5,
    applies: (t, g) => isTile(t) && !!wallAt(g, t)?.dye,
    check: (t, g) => {
      if (!isTile(t) || !t.side) return 'Choose a side.';
      const wall = wallAt(g, t);
      if (!wall?.dye) return 'It has taken no colour.';
      if (!g.inventory.has('lye_bucket')) return 'You need a bucket of lye to scrub it back.';
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t) || !t.side) return;
      const wall = wallAt(g, t);
      const lye = g.inventory.find('lye_bucket');
      if (!wall || !lye) return;
      g.inventory.remove(lye.uid, 1);
      g.inventory.add('bucket', { ql: lye.ql });
      delete wall.dye;
      g.gainSkill('alchemy', 0.2);
      g.logMsg(`You scrub the wall back to bare ${material(wall.material)?.name.toLowerCase() ?? 'stone'}.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'repoint_wall',
    label: 'Repoint the wall',
    verb: 'repointing',
    hidden: true,
    skill: 'masonry',
    tool: 'trowel',
    stamina: 0.06,
    baseTime: REPOINT_TIME,
    applies: (t, g) => isTile(t) && g.perk('repoint', 0) > 0 && material(wallAt(g, t)?.material)?.kind === 'stone',
    labelFor: (t) => (isTile(t) && t.material ? `Repoint in ${material(t.material)?.name.toLowerCase()}` : 'Repoint the wall'),
    check: (t, g) => (isTile(t) ? repointReason(g, t) : null),
    perform: (t, g) => {
      if (!isTile(t) || !t.side || repointReason(g, t)) return;
      const wall = wallAt(g, t);
      const was = material(wall?.material);
      const mat = material(t.material);
      if (!wall || !was || !mat) return;
      const bill = layingBill(mat.id, wall.type);
      for (const [id, n] of Object.entries(bill.needed)) for (let i = 0; i < n; i++) if (!takeUnit(g, id, mat, t)) return;
      // Half the old stone back, rounded down: what was laid of the first thing on its bill.
      const stone = was.bill[0][0];
      const back = Math.floor((wall.total[stone] ?? 0) * REPOINT_BACK);
      if (back > 0) g.inventory.add(stone, { count: back, ql: 20 });
      // The fittings stay where they are; the stone around them is new.
      const fitted = WALL_TYPE_BY_ID.get(wall.type)?.fittings ?? [];
      wall.material = mat.id;
      wall.total = { ...bill.total };
      for (const [id, n] of fitted) wall.total[id] = (wall.total[id] ?? 0) + n;
      wall.needed = Object.fromEntries(Object.keys(wall.total).map((id) => [id, 0]));
      delete wall.dye;
      // New stone, and bare: whatever grew on the old went with it.
      wall.greenSince = greenNow();
      g.gainSkill('masonry', 1);
      g.logMsg(`You take the ${was.name.toLowerCase()} out of the wall on the ${SIDE_NAMES[t.side]} side and lay it again in ${mat.name.toLowerCase()}`
        + `${back > 0 ? `, and save ${back} ${materialName(stone, back)}` : ''}.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'paint_floor',
    label: 'Paint the floor',
    verb: 'painting',
    hidden: true,
    skill: 'alchemy',
    stamina: 0.02,
    baseTime: 6,
    applies: (t, g) => {
      if (!isTile(t)) return false;
      const b = buildingOf(g, t);
      return !!b && !!g.buildings.floor(topLevel(b), t.x, t.y);
    },
    labelFor: (t, g) => {
      const d = pickDye(g);
      return d ? `Paint the floor ${d.def.word}` : 'Paint the floor';
    },
    check: (t, g) => {
      if (!isTile(t)) return null;
      const b = buildingOf(g, t);
      const floor = b && g.buildings.floor(topLevel(b), t.x, t.y);
      if (!floor) return 'There is no floor here.';
      if (!isDone(floor)) return 'Finish it before you paint it.';
      const d = pickDye(g);
      if (!d) return 'You have no dye. Boil one out of berries, acorns or herbs with a bucket of lye.';
      if (floor.dye === d.def.id) return `It is ${d.def.word} already.`;
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t)) return;
      const b = buildingOf(g, t);
      const floor = b && g.buildings.floor(topLevel(b), t.x, t.y);
      const d = pickDye(g);
      if (!floor || !d || !g.inventory.remove(d.item.uid, 1)) return;
      floor.dye = d.def.id;
      g.gainSkill('alchemy', 0.3);
      g.logMsg(`You work the ${d.def.name.toLowerCase()} into the boards. The floor comes up ${d.def.word}.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'remove_wall',
    label: 'Remove wall',
    verb: 'taking down the wall',
    hidden: true,
    stamina: 0.04,
    baseTime: 4,
    applies: (t, g) => isTile(t) && (!!buildingOf(g, t) || !!wallAt(g, t)),
    check: (t, g) => {
      if (!isTile(t) || !t.side) return 'Choose a side.';
      return wallAt(g, t) ? null : 'There is no wall there.';
    },
    perform: (t, g) => {
      if (!isTile(t) || !t.side) return;
      const wall = wallAt(g, t);
      if (!wall) return;
      const what = WALL_TYPE_BY_ID.get(wall.type)?.low ? (WALL_TYPE_BY_ID.get(wall.type)?.name.toLowerCase() ?? 'fence') : 'wall';
      g.buildings.removeWall(wallLevel(g, t), t.x, t.y, t.side);
      // A glasshouse with a wall down is open to the weather (`glasshouse.ts`).
      glassResync(g);
      g.logMsg(`You take down the ${what} on the ${SIDE_NAMES[t.side]} side.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'add_floor',
    label: 'Plan another storey',
    verb: 'planning a storey',
    hidden: true,
    stamina: 0.02,
    baseTime: 3,
    applies: (t, g) => isTile(t) && !!buildingOf(g, t),
    check: (t, g) => {
      if (!isTile(t)) return null;
      // No storey over a field (`glasshouse.ts`).
      const glass = glassPlanRefusal(g, t, 'add_floor');
      if (glass) return glass;
      const tool = needTool(g, 'mallet');
      if (tool) return tool;
      const b = buildingOf(g, t);
      if (!b) return 'No building here.';
      // A Mason's Tall Walls: stone stands higher in a building of theirs.
      const tall = g.perk('storeys:build_stone', 0);
      if (b.levels >= MAX_LEVELS + tall) return `Buildings cannot be taller than ${MAX_LEVELS + tall} storeys.`;
      /*
       * And no taller than what it is made of will stand.
       *
       * The shortest material in the whole building answers, not the one you
       * are standing on: a plank wing joined to a stone tower caps the tower,
       * because a building is one thing and comes down as one thing.
       */
      const cap = g.buildings.storeyCap(b, tall);
      if (b.levels >= cap) {
        const stands = (m: MaterialDef): number => m.storeys + (m.kind === 'stone' ? tall : 0);
        const worst = g.buildings.materialsIn(b).reduce((a, m) => (a && stands(a) <= stands(m) ? a : m), undefined as MaterialDef | undefined);
        return `${worst?.name ?? 'What this is built of'} will not stand ${cap + 1} storeys. ${cap} is as high as it goes.`;
      }
      // And the hands to raise it: ten a storey in the trade of the one below.
      const under = g.buildings.storeyMaterial(b, b.levels - 1);
      const want = storeySkill(b.levels);
      if (under && g.skills.get(under.skill) < want) {
        return `Raising a ${b.levels + 1}${nth(b.levels + 1)} storey over ${under.name.toLowerCase()} takes ${under.skill} ${want}. You have ${g.skills.get(under.skill).toFixed(1)}.`;
      }
      if (g.buildings.hasRoof(b)) return 'Take the roof off first.';
      if (g.buildings.hasLowWall(b, b.levels - 1)) return 'Nothing rests on a fence or a half wall. The storey below needs walls all round.';
      const below = gapText(b.levels, g.buildings.levelGaps(b, b.levels - 1, g.player.x, g.player.y));
      if (below) return below;
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t)) return;
      const b = buildingOf(g, t);
      if (!b) return;
      b.levels += 1;
      b.workLevel = b.levels - 1;
      glassResync(g);
      g.logMsg(`You plan storey ${b.levels} of ${b.name}. Plan and build its floor tiles, then raise walls on them.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'plan_floor',
    label: 'Plan floor',
    verb: 'planning a floor',
    hidden: true,
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => isTile(t) && !!buildingOf(g, t),
    check: (t, g) => {
      if (!isTile(t) || !t.material) return 'Choose a material.';
      // Glass on a pitched roof and nowhere else, no floor over a field, and no roof but glass on a building with one (`glasshouse.ts`).
      const glass = glassPlanRefusal(g, t, 'plan_floor');
      if (glass) return glass;
      const tool = needTool(g, 'mallet');
      if (tool) return tool;
      const b = buildingOf(g, t);
      if (!b) return 'No building here.';
      const kind: FloorKind = t.floorKind ?? 'floor';
      const level = kind === 'roof' ? b.levels : topLevel(b);
      if (kind === 'roof') {
        // Which storey and which border, because "all walls must be built"
        // reads like a lie while you are standing in a finished room and the
        // storey that is short of a wall is the one planned over your head.
        const top = gapText(b.levels, g.buildings.levelGaps(b, b.levels - 1, g.player.x, g.player.y));
        if (top) return top;
      } else if (kind === 'stairs' || kind === 'ladder') {
        if (level < 1) return 'Stairs and ladders belong to an upper storey; plan another storey first.';
        if (!t.side) return 'Choose the side to climb from.';
        if (level > 1 && !g.buildings.floor(level - 1, t.x, t.y)) return 'Plan the floor of the storey below first.';
      }
      if (g.buildings.floor(level, t.x, t.y)) return kind === 'roof' ? 'There is already roof planned here.' : 'There is already a floor planned here.';
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t) || !t.material) return;
      const b = buildingOf(g, t);
      if (!b) return;
      const kind: FloorKind = t.floorKind ?? 'floor';
      const level = kind === 'roof' ? b.levels : topLevel(b);
      /*
       * A building has one roof, so the first tile of it decides the shape and
       * the rest follow. Changing your mind means taking the roof off, which
       * is what changing your mind about a roof means anywhere.
       */
      if (kind === 'roof' && !b.roof) b.roof = t.roofShape ?? 'hip';
      const floor = g.buildings.setFloor(b, level, t.x, t.y, t.material, kind, kind === 'stairs' || kind === 'ladder' ? t.side : undefined);
      glassResync(g);
      const shape = kind === 'roof' ? `${roofShapeDef(b).name.toLowerCase()} ` : '';
      const what = kind === 'ladder' ? 'ladder' : `${shape}${material(t.material)?.name.toLowerCase()} ${FLOOR_KIND_NAMES[kind]}`;
      g.logMsg(`You plan a ${what}. It needs ${needsText(floor)}.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'build_floor',
    label: 'Build floor',
    verb: 'building',
    hidden: true,
    repeat: true,
    stamina: 0.03,
    baseTime: 5,
    applies: (t, g) => isTile(t) && !!buildingOf(g, t),
    check: (t, g) => {
      if (!isTile(t)) return null;
      const b = buildingOf(g, t);
      const floor = b && g.buildings.floor(t.floorKind === 'roof' ? b.levels : topLevel(b), t.x, t.y);
      if (!floor) return 'There is nothing planned here.';
      if (isDone(floor)) return 'That is already finished.';
      const mat = material(floor.material);
      const tool = floorKind(floor) === 'ladder' ? needTool(g, 'mallet') : mat ? needTool(g, mat.tool) : null;
      if (tool) return tool;
      if (!nextAvailable(g, floor, t)) return `You need ${needsText(floor)}.`;
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t)) return false;
      const b = buildingOf(g, t);
      const floor = b && g.buildings.floor(t.floorKind === 'roof' ? b.levels : topLevel(b), t.x, t.y);
      if (!floor || isDone(floor)) return false;
      const used = consumeUnit(g, floor, t);
      if (!used) return false;
      // The last pane of a glass roof makes a glasshouse, and what grows in it goes onto the glass clock.
      glassResync(g);
      const kind = floorKind(floor);
      const mat = material(floor.material);
      // Floors are paving; stairs, ladders and roofs are carpentry or masonry by material.
      g.gainSkill(kind === 'floor' ? 'paving' : kind === 'ladder' ? 'carpentry' : (mat?.skill ?? 'carpentry'), 0.4);
      g.events.emit('world', t.x, t.y);
      const what = kind === 'ladder' ? 'ladder' : `${mat?.name.toLowerCase()} ${FLOOR_KIND_NAMES[kind]}`;
      if (isDone(floor)) {
        g.logMsg(`You finish the ${what}.`, 'event');
        return false;
      }
      g.logMsg(`You work ${materialName(used, 1)} into the ${FLOOR_KIND_NAMES[kind]}. Still needed: ${needsText(floor)}.`, 'event');
      return nextAvailable(g, floor, t) !== null;
    },
  },
  {
    id: 'remove_floor',
    label: 'Remove floor',
    verb: 'tearing up the floor',
    hidden: true,
    stamina: 0.04,
    baseTime: 4,
    applies: (t, g) => isTile(t) && !!buildingOf(g, t),
    check: (t, g) => {
      if (!isTile(t)) return null;
      const b = buildingOf(g, t);
      if (!b) return 'No building here.';
      const level = t.floorKind === 'roof' ? b.levels : topLevel(b);
      const floor = g.buildings.floor(level, t.x, t.y);
      if (!floor) return 'There is nothing here to remove.';
      if (floorKind(floor) !== 'roof') {
        for (const side of ['n', 'e', 's', 'w'] as const) if (g.buildings.wall(level, t.x, t.y, side)) return 'Take down the walls standing on it first.';
      }
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t)) return;
      const b = buildingOf(g, t);
      if (!b) return;
      const level = t.floorKind === 'roof' ? b.levels : topLevel(b);
      const floor = g.buildings.floor(level, t.x, t.y);
      if (!floor) return;
      g.buildings.removeFloor(level, t.x, t.y);
      // Glass taken off a glasshouse: what grows in it goes back on the field's clock.
      glassResync(g);
      const p = g.player;
      if (p.tileX === t.x && p.tileY === t.y && p.level >= level && level > 0) p.level = level - 1;
      g.logMsg(`You remove the ${FLOOR_KIND_NAMES[floorKind(floor)]}.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'remove_storey',
    label: 'Remove top storey',
    verb: 'removing the storey',
    hidden: true,
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => isTile(t) && (buildingOf(g, t)?.levels ?? 0) > 1,
    check: (t, g) => {
      if (!isTile(t)) return null;
      const b = buildingOf(g, t);
      if (!b || b.levels <= 1) return 'There is no upper storey.';
      const level = b.levels - 1;
      if (g.buildings.hasRoof(b)) return 'Take the roof off first.';
      for (const w of g.buildings.walls.values()) if (w.building === b.id && w.level === level) return 'Take down the walls of the top storey first.';
      for (const f of g.buildings.floors.values()) if (f.building === b.id && f.level === level) return 'Tear up the floors of the top storey first.';
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t)) return;
      const b = buildingOf(g, t);
      if (!b || b.levels <= 1) return;
      b.levels -= 1;
      b.workLevel = b.levels - 1;
      glassResync(g);
      g.logMsg(`${b.name} is back to ${b.levels === 1 ? 'a single storey' : `${b.levels} storeys`}.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'rename_building',
    asks: {
      question: 'What should the building be called?',
      fallback: (t, g) => (isTile(t) ? buildingOf(g, t)?.name ?? '' : ''),
    },
    label: 'Rename building',
    verb: 'renaming',
    hidden: true,
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => isTile(t) && !!buildingOf(g, t),
    perform: (t, g) => {
      if (!isTile(t)) return;
      const b = buildingOf(g, t);
      if (!b) return;
      const name = ((t as { name?: string }).name ?? '').trim();
      if (!name) return;
      b.name = name.slice(0, 32);
      g.logMsg(`The building is now called ${b.name}.`, 'event');
    },
  },
];

export const BUILD_ACTION_BY_ID = new Map(BUILD_ACTIONS.map((a) => [a.id, a]));
