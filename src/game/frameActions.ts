/**
 * Columns: planned on a tile corner of the storey being worked, built a unit
 * at a time as a wall is, and taken down. The rules are in `frame.ts`; the
 * island's are `frame_refusal` and `perform_frame`, in the same words.
 */
import type { ActionDef, Target } from './actions';
import { consumeUnit, materialName, needsText, needTool, nextAvailable } from './buildActions';
import { heftWord, INDOORS_DECAY, INDOORS_REST, isDone, jobLevel, MATERIAL_BY_ID, onlyRefusal, TOP_LEVELS } from './building';
import { SUBTILES } from './crates';
import { furnitureCovers } from './furniture';
import type { Game } from './game';
import { columnAt, columnCarries, columnFooting, cornerName, cornerOf, storeyOf } from './frame';
import { GLASS, GLASS_ROOF_ONLY } from './glasshouse';
import { deckCarries } from './piers';

type TileTarget = Extract<Target, { kind: 'tile' }>;
const isTile = (t: Target): t is TileTarget => t.kind === 'tile';

export const FRAME_ACTIONS: ActionDef[] = [
  {
    id: 'plan_column',
    label: 'Plan column',
    verb: 'planning a column',
    hidden: true,
    corner: true,
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => isTile(t) && !!storeyOf(g, t),
    check: (t, g) => {
      if (!isTile(t) || !t.material || !MATERIAL_BY_ID.get(t.material)) return 'Choose a material.';
      const corner = cornerOf(t);
      if (!corner) return 'Choose a corner of the tile.';
      // Glass goes on a roof and nowhere else (`glasshouse.ts`), and no material with an `only` makes a column.
      if (t.material === GLASS) return GLASS_ROOF_ONLY;
      const only = onlyRefusal(t.material, { column: true });
      if (only) return only;
      const tool = needTool(g, 'mallet');
      if (tool) return tool;
      const b = storeyOf(g, t);
      if (!b) return 'No building here.';
      const level = jobLevel(b, t);
      if (!columnFooting(g, b, level, corner[0], corner[1])) return 'Build the floor of this storey first.';
      if (g.buildings.column(level, corner[0], corner[1])) return 'There is already a column on that corner.';
      // On the ground floor it takes the corner spot of every tile round it (`Game.columnInBlock`): none with a piece in it.
      if (level === 0 && pieceInCorner(g, corner[0], corner[1])) return 'Move what stands in that corner first.';
      // What is under it has to carry it, as it would a wall: on piers its decks first (`piers.ts`).
      const mat = MATERIAL_BY_ID.get(t.material);
      const deck = mat && b.deck != null ? deckCarries(mat, g.buildings.deckUnder(b), b.name) : null;
      if (deck) return deck;
      const bears = g.buildings.bearing(b, level);
      if (mat && mat.heft > bears) return `${mat.name} is too heavy to raise over what is under it. This storey carries ${heftWord(bears)}, no more.`;
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t) || !t.material) return;
      const b = storeyOf(g, t);
      const corner = cornerOf(t);
      const mat = MATERIAL_BY_ID.get(t.material);
      if (!b || !corner || !mat) return;
      const c = g.buildings.setColumn(b, jobLevel(b, t), corner[0], corner[1], mat.id);
      g.logMsg(`You plan a ${mat.name.toLowerCase()} column on the ${cornerName(t, corner[0], corner[1])} corner. It needs ${needsText(c)}.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'build_column',
    label: 'Build column',
    verb: 'building',
    hidden: true,
    corner: true,
    repeat: true,
    stamina: 0.03,
    baseTime: 5,
    applies: (t, g) => isTile(t) && !!columnAt(g, t),
    check: (t, g) => {
      if (!isTile(t) || !cornerOf(t)) return 'Choose a corner of the tile.';
      const c = columnAt(g, t);
      if (!c) return 'There is no column planned there.';
      if (isDone(c)) return 'That column is finished.';
      const mat = MATERIAL_BY_ID.get(c.material);
      const tool = mat ? needTool(g, mat.tool) : null;
      if (tool) return tool;
      if (!nextAvailable(g, c, t)) return `You need ${needsText(c)}.`;
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t)) return false;
      const c = columnAt(g, t);
      if (!c || isDone(c)) return false;
      const mat = MATERIAL_BY_ID.get(c.material);
      const used = consumeUnit(g, c, t);
      if (!used || !mat) return false;
      g.gainSkill(mat.skill, 0.4);
      g.events.emit('world', t.x, t.y);
      if (isDone(c)) {
        g.logMsg(`You finish the ${mat.name.toLowerCase()} column.`, 'event');
        return false;
      }
      g.logMsg(`You fit ${materialName(used, 1)} into the column. Still needed: ${needsText(c)}.`, 'event');
      return nextAvailable(g, c, t) !== null;
    },
  },
  {
    id: 'remove_column',
    label: 'Remove column',
    verb: 'taking down the column',
    hidden: true,
    corner: true,
    stamina: 0.04,
    baseTime: 4,
    applies: (t, g) => isTile(t) && !!columnAt(g, t),
    check: (t, g) => {
      if (!isTile(t) || !cornerOf(t)) return 'Choose a corner of the tile.';
      const c = columnAt(g, t);
      if (!c) return 'There is no column there.';
      // What it carries, if it carries anything, comes down first, or a wall goes up to take it.
      return columnCarries(g, c);
    },
    perform: (t, g) => {
      if (!isTile(t)) return;
      const c = columnAt(g, t);
      if (!c) return;
      g.buildings.removeColumn(c.level, c.x, c.y);
      g.logMsg(`You take down the column on the ${cornerName(t, c.x, c.y)} corner.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
];

export const FRAME_ACTION_BY_ID = new Map(FRAME_ACTIONS.map((a) => [a.id, a]));

/** Whether a piece of furniture stands in the corner spot of any of the four tiles round a corner, up top. The island's `frame_piece_in_corner`. */
function pieceInCorner(g: Game, cx: number, cy: number): boolean {
  const last = SUBTILES - 1;
  for (const [tx, ty, sx, sy] of [[cx - 1, cy - 1, last, last], [cx, cy - 1, 0, last], [cx - 1, cy, last, 0], [cx, cy, 0, 0]]) {
    if (g.furnitureOnTile(tx, ty).some((f) => (f.level ?? 0) >= 0 && furnitureCovers(f, sx, sy))) return true;
  }
  return false;
}

/**
 * What Examine says of a tile's jetty, its columns and the roof on columns
 * over it: the island's `frame_says`, word for word.
 */
export function frameSays(g: Game, x: number, y: number): string {
  const bld = g.buildings;
  let out = '';
  // The jetty or balcony over it, if any, on its lowest storey.
  const j = bld.jettyAt(x, y);
  if (j) {
    for (let level = 1; level <= j.levels; level++) {
      const f = bld.floor(level, x, y);
      if (!f || f.building !== j.id) continue;
      if (!isDone(f)) out += ` A jetty of ${j.name}'s storey ${level + 1} is planned over it.`;
      else if (bld.storeyArea(j, level).has(`${x},${y}`)) {
        out += ` Over it is a jetty of ${j.name}'s storey ${level + 1}, part of that storey: its open sides want a wall, a railing or columns to close the storey in, and a roof over it rests on walls or columns, never on a railing.`;
      } else {
        out += ` Over it is a balcony of ${j.name}'s storey ${level + 1}, shut off from the storey by a wall or a door: it takes a railing, and no roof.`;
      }
      break;
    }
  }
  // The columns on its corners, storey by storey.
  if (bld.columns.size && (bld.hasColumnAt(x, y) || bld.hasColumnAt(x + 1, y) || bld.hasColumnAt(x, y + 1) || bld.hasColumnAt(x + 1, y + 1))) {
    const items: string[] = [];
    for (let level = 0; level < TOP_LEVELS; level++) {
      for (const [cx, cy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) {
        const c = bld.column(level, cx, cy);
        if (!c) continue;
        items.push(`${MATERIAL_BY_ID.get(c.material)?.name.toLowerCase() ?? c.material} on the ${cornerName({ x, y }, cx, cy)} corner`
          + `${level > 0 ? ` of storey ${level + 1}` : ''}${isDone(c) ? '' : ` (needs ${needsText(c)})`}`);
      }
    }
    if (items.length) out += ` Columns: ${items.join('; ')}.`;
  }
  // A roof on columns: shelter for what lies there, and not a room.
  if (bld.sheltered(0, x, y) && !bld.indoors(0, x, y)) {
    out += ` Under a roof on columns: what is left here decays at ${Math.round(INDOORS_DECAY * 100)}% of the rate in the open, but a bed here is in the open: the ×${INDOORS_REST} rest of a bed indoors wants walls all round.`;
  }
  return out;
}
