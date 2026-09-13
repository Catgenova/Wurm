import type { ActionDef, Target } from './actions';
import {
  describeNeeds,
  isDone,
  MATERIAL_BY_ID,
  MAX_LEVELS,
  SIDE_NAMES,
  WALL_TYPE_BY_ID,
  type Bill,
  type Building,
  type MaterialDef,
  workLevel,
} from './building';
import type { Game } from './game';
import { itemDef } from './items';

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

/** The next item on a bill that the player is carrying. */
function nextAvailable(g: Game, bill: Bill): string | null {
  for (const [id, n] of Object.entries(bill.needed)) if (n > 0 && g.inventory.has(id)) return id;
  return null;
}

function consumeUnit(g: Game, bill: Bill): string | null {
  const id = nextAvailable(g, bill);
  if (!id || !g.inventory.consume(id)) return null;
  bill.needed[id] -= 1;
  return id;
}

const buildingOf = (g: Game, t: TileTarget): Building | undefined => g.buildings.buildingAt(t.x, t.y);
const topLevel = (b: Building): number => workLevel(b);
const material = (id: string | undefined): MaterialDef | undefined => (id ? MATERIAL_BY_ID.get(id) : undefined);

/** Building work. These are hidden from the generic menu; the UI composes them with sides and materials. */
export const BUILD_ACTIONS: ActionDef[] = [
  {
    id: 'plan_building',
    label: 'Plan building',
    verb: 'planning a building',
    hidden: true,
    stamina: 0.02,
    baseTime: 3,
    applies: (t, g) => isTile(t) && !g.buildings.buildingAt(t.x, t.y),
    check: (t, g) => (isTile(t) ? (needTool(g, 'mallet') ?? g.planReason(t.x, t.y)) : null),
    perform: (t, g) => {
      if (!isTile(t)) return;
      const name = g.hooks.prompt('Name the building', 'House');
      if (name === null) {
        g.logMsg('You put the mallet away without planning anything.', 'info');
        return;
      }
      const b = g.buildings.create(name.trim().slice(0, 32) || 'House', t.x, t.y);
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
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t) || !t.side || !t.wallType || !t.material) return;
      const b = buildingOf(g, t);
      if (!b) return;
      const wall = g.buildings.setWall(b, topLevel(b), t.x, t.y, t.side, t.wallType, t.material);
      const type = WALL_TYPE_BY_ID.get(t.wallType)?.name.toLowerCase() ?? t.wallType;
      g.logMsg(`You plan a ${type} ${material(t.material)?.name.toLowerCase()} wall on the ${SIDE_NAMES[t.side]} side. It needs ${needsText(wall)}.`, 'event');
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
    applies: (t, g) => isTile(t) && !!buildingOf(g, t),
    check: (t, g) => {
      if (!isTile(t) || !t.side) return 'Choose a side.';
      const b = buildingOf(g, t);
      const wall = b && g.buildings.wall(topLevel(b), t.x, t.y, t.side);
      if (!wall) return 'There is no wall planned there.';
      if (isDone(wall)) return 'That wall is finished.';
      const mat = material(wall.material);
      const tool = mat ? needTool(g, mat.tool) : null;
      if (tool) return tool;
      if (!nextAvailable(g, wall)) return `You need ${needsText(wall)}.`;
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t) || !t.side) return false;
      const b = buildingOf(g, t);
      const wall = b && g.buildings.wall(topLevel(b), t.x, t.y, t.side);
      if (!wall || isDone(wall)) return false;
      const mat = material(wall.material);
      const used = consumeUnit(g, wall);
      if (!used || !mat) return false;
      g.gainSkill(mat.skill, 0.4);
      g.events.emit('world', t.x, t.y);
      if (isDone(wall)) {
        g.logMsg(`You finish the ${mat.name.toLowerCase()} wall.`, 'event');
        return false;
      }
      g.logMsg(`You fit ${materialName(used, 1)} into the wall. Still needed: ${needsText(wall)}.`, 'event');
      return nextAvailable(g, wall) !== null;
    },
  },
  {
    id: 'remove_wall',
    label: 'Remove wall',
    verb: 'taking down the wall',
    hidden: true,
    stamina: 0.04,
    baseTime: 4,
    applies: (t, g) => isTile(t) && !!buildingOf(g, t),
    check: (t, g) => {
      if (!isTile(t) || !t.side) return 'Choose a side.';
      const b = buildingOf(g, t);
      if (!b) return 'No building here.';
      if (!g.buildings.wall(topLevel(b), t.x, t.y, t.side)) return 'There is no wall there.';
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t) || !t.side) return;
      const b = buildingOf(g, t);
      if (!b) return;
      g.buildings.removeWall(topLevel(b), t.x, t.y, t.side);
      g.logMsg(`You take down the wall on the ${SIDE_NAMES[t.side]} side.`, 'event');
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
      const tool = needTool(g, 'mallet');
      if (tool) return tool;
      const b = buildingOf(g, t);
      if (!b) return 'No building here.';
      if (b.levels >= MAX_LEVELS) return `Buildings cannot be taller than ${MAX_LEVELS} storeys.`;
      if (!g.buildings.levelComplete(b, b.levels - 1)) return 'All walls of the storey below must be built first.';
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t)) return;
      const b = buildingOf(g, t);
      if (!b) return;
      b.levels += 1;
      b.workLevel = b.levels - 1;
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
      const tool = needTool(g, 'mallet');
      if (tool) return tool;
      const b = buildingOf(g, t);
      if (!b) return 'No building here.';
      if (g.buildings.floor(topLevel(b), t.x, t.y)) return 'There is already a floor planned here.';
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t) || !t.material) return;
      const b = buildingOf(g, t);
      if (!b) return;
      const floor = g.buildings.setFloor(b, topLevel(b), t.x, t.y, t.material);
      g.logMsg(`You plan a ${material(t.material)?.name.toLowerCase()} floor. It needs ${needsText(floor)}.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'build_floor',
    label: 'Build floor',
    verb: 'laying the floor',
    hidden: true,
    repeat: true,
    skill: 'paving',
    stamina: 0.03,
    baseTime: 5,
    applies: (t, g) => isTile(t) && !!buildingOf(g, t),
    check: (t, g) => {
      if (!isTile(t)) return null;
      const b = buildingOf(g, t);
      const floor = b && g.buildings.floor(topLevel(b), t.x, t.y);
      if (!floor) return 'There is no floor planned here.';
      if (isDone(floor)) return 'That floor is finished.';
      const mat = material(floor.material);
      const tool = mat ? needTool(g, mat.tool) : null;
      if (tool) return tool;
      if (!nextAvailable(g, floor)) return `You need ${needsText(floor)}.`;
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t)) return false;
      const b = buildingOf(g, t);
      const floor = b && g.buildings.floor(topLevel(b), t.x, t.y);
      if (!floor || isDone(floor)) return false;
      const used = consumeUnit(g, floor);
      if (!used) return false;
      g.events.emit('world', t.x, t.y);
      if (isDone(floor)) {
        g.logMsg(`You finish laying the ${material(floor.material)?.name.toLowerCase()} floor.`, 'event');
        return false;
      }
      g.logMsg(`You lay ${materialName(used, 1)} into the floor. Still needed: ${needsText(floor)}.`, 'event');
      return nextAvailable(g, floor) !== null;
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
      const level = topLevel(b);
      if (!g.buildings.floor(level, t.x, t.y)) return 'There is no floor here.';
      for (const side of ['n', 'e', 's', 'w'] as const) if (g.buildings.wall(level, t.x, t.y, side)) return 'Take down the walls standing on it first.';
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t)) return;
      const b = buildingOf(g, t);
      if (!b) return;
      g.buildings.removeFloor(topLevel(b), t.x, t.y);
      g.logMsg('You tear up the floor.', 'event');
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
      g.logMsg(`${b.name} is back to ${b.levels === 1 ? 'a single storey' : `${b.levels} storeys`}.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'rename_building',
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
      const name = g.hooks.prompt('Rename the building', b.name);
      if (name === null || !name.trim()) return;
      b.name = name.trim().slice(0, 32);
      g.logMsg(`The building is now called ${b.name}.`, 'event');
    },
  },
];

export const BUILD_ACTION_BY_ID = new Map(BUILD_ACTIONS.map((a) => [a.id, a]));
