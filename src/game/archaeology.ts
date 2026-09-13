import { TileType } from '../world/tiles';
import type { ActionDef } from './actions';
import type { Game } from './game';
import { itemName, type Item } from './items';

/**
 * Archaeology and restoration. People lived on this island before you did and
 * left their things in the ground. Investigating a tile with a trowel turns up
 * broken pieces of them; gathering every piece of one thing and putting it back
 * together is the restorer's work, and it is the only way to hold what the old
 * people held.
 */
export interface RelicDef {
  /** Name as it reads on a fragment, and the key it is found by. */
  name: string;
  /** Pieces a whole one broke into. */
  parts: number;
  /** Item id it becomes when the pieces go back together. */
  result: string;
  /** How hard it is to put back, and how deep in the skill it is found. */
  difficulty: number;
}

/**
 * What lies under the island, from the commonplace to the thing nobody has
 * seen whole in a lifetime. A relic is only turned up once archaeology has
 * come far enough to know what it is looking at.
 */
export const RELICS: RelicDef[] = [
  { name: 'old pot', parts: 2, result: 'clay_pot', difficulty: 12 },
  { name: 'bone comb', parts: 2, result: 'bone_comb', difficulty: 16 },
  { name: 'old file', parts: 3, result: 'file', difficulty: 22 },
  { name: 'old lamp', parts: 3, result: 'old_lamp', difficulty: 26 },
  { name: 'bronze mirror', parts: 3, result: 'bronze_mirror', difficulty: 30 },
  { name: 'old blade', parts: 4, result: 'short_sword', difficulty: 34 },
  { name: 'statuette', parts: 4, result: 'statuette', difficulty: 38 },
  { name: 'ancient helm', parts: 5, result: 'helm', difficulty: 44 },
];

/** Ground worth turning over: soil and sand, not bare rock or standing water. */
const DIGGABLE: ReadonlySet<number> = new Set<number>([
  TileType.Grass,
  TileType.Dirt,
  TileType.PackedDirt,
  TileType.Sand,
  TileType.Steppe,
  TileType.Tundra,
  TileType.Moss,
  TileType.Gravel,
  TileType.Lawn,
  TileType.Clay,
  TileType.Marsh,
]);

/** "old lamp 2/3" on the end of a fragment says what it is a piece of. */
const FRAGMENT = /^(.+) (\d+)\/(\d+)$/;

export const relicByName = (name: string): RelicDef | undefined => RELICS.find((r) => r.name.toLowerCase() === name.toLowerCase());

/** What a fragment is a piece of, and which piece, or null if it is not one. */
export function fragmentOf(item: Item): { relic: RelicDef; part: number } | null {
  if (item.id !== 'fragment') return null;
  const m = FRAGMENT.exec(item.extra ?? '');
  const relic = m && relicByName(m[1]);
  return relic ? { relic, part: Number(m[2]) } : null;
}

/** Every fragment of one relic that is carried, at most one of each piece. */
export function piecesHeld(g: Game, relic: RelicDef): Item[] {
  const seen = new Map<number, Item>();
  for (const it of g.inventory.items) {
    const f = fragmentOf(it);
    if (!f || f.relic.name !== relic.name) continue;
    // The soundest of any duplicates is the one that goes into the work.
    const best = seen.get(f.part);
    if (!best || it.dmg < best.dmg) seen.set(f.part, it);
  }
  return [...seen.values()];
}

/** Which pieces of a relic are still missing, in order. */
export function partsMissing(g: Game, relic: RelicDef): number[] {
  const held = new Set(piecesHeld(g, relic).map((it) => fragmentOf(it)?.part));
  const out: number[] = [];
  for (let n = 1; n <= relic.parts; n++) if (!held.has(n)) out.push(n);
  return out;
}

/** How likely a turn of the trowel is to find anything at all. */
export const findChance = (skill: number, toolQl: number): number => Math.min(0.7, 0.14 + (skill / 100) * 0.4 + (toolQl / 100) * 0.1);

/** The relics a given archaeologist would recognise if they turned one up. */
export const relicsWithin = (skill: number): RelicDef[] => RELICS.filter((r) => r.difficulty <= skill + 14);

export const ARCHAEOLOGY_ACTIONS: ActionDef[] = [
  {
    id: 'investigate',
    label: 'Investigate',
    verb: 'investigating the ground',
    skill: 'archaeology',
    tool: 'trowel',
    stamina: 0.05,
    baseTime: 10,
    applies: (t, g) => t.kind === 'tile' && DIGGABLE.has(g.world.getTile(t.x, t.y)) && !g.world.hasWater(t.x, t.y),
    check: (t, g) => {
      if (t.kind !== 'tile') return null;
      if (!g.inventory.has('trowel')) return 'You need a trowel to go through the soil carefully.';
      if (g.isForaged(t.x, t.y, 'dig')) return 'You have been over this ground already. Try somewhere else.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'tile') return;
      g.markForaged(t.x, t.y, 'dig');
      const skill = g.skills.get('archaeology');
      const toolQl = g.toolQl('trowel');
      if (g.rand() > findChance(skill, toolQl)) {
        g.logMsg('You go through the soil and turn up nothing but roots and small stones.', 'event');
        return;
      }
      const within = relicsWithin(skill);
      if (!within.length) {
        g.logMsg('You turn up a scrap of something worked, but you cannot tell what it was and it crumbles.', 'event');
        return;
      }
      // The commonplace comes up far more often than the rare, as it did when it was lost.
      const weights = within.map((r) => 1 / (1 + r.difficulty / 12));
      let roll = g.rand() * weights.reduce((a, b) => a + b, 0);
      let relic = within[0];
      for (let i = 0; i < within.length; i++) {
        roll -= weights[i];
        if (roll <= 0) {
          relic = within[i];
          break;
        }
      }
      // A piece you are still short of, if you are short of any: the ground is kinder than it needs to be.
      const missing = partsMissing(g, relic);
      const part = missing.length ? missing[Math.floor(g.rand() * missing.length)] : 1 + Math.floor(g.rand() * relic.parts);
      const item = g.inventory.add('fragment', {
        ql: Math.max(1, g.productQl('archaeology', toolQl) * (0.55 + g.rand() * 0.35)),
        extra: `${relic.name} ${part}/${relic.parts}`,
      });
      // Nothing comes out of the ground sound.
      item.dmg = 18 + g.rand() * 50;
      g.events.emit('inventory');
      const left = partsMissing(g, relic).length;
      const short = left ? ` ${left} of ${relic.parts} still missing.` : ` That is all ${relic.parts} of them.`;
      g.logMsg(`Your trowel turns up a fragment of ${relic.name}, piece ${part} of ${relic.parts}. (QL ${item.ql.toFixed(1)}, damage ${item.dmg.toFixed(0)})${short}`, 'event');
    },
  },
  {
    id: 'restore_relic',
    label: 'Restore',
    verb: 'restoring',
    skill: 'restoration',
    stamina: 0.07,
    baseTime: 20,
    applies: (t, g) => {
      if (t.kind !== 'item') return false;
      const item = g.inventory.get(t.uid);
      return !!item && fragmentOf(item) !== null;
    },
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      const item = g.inventory.get(t.uid);
      const f = item && fragmentOf(item);
      if (!f) return 'That is not a fragment of anything.';
      const missing = partsMissing(g, f.relic);
      if (missing.length) return `You are missing ${missing.length} of the ${f.relic.parts} pieces of the ${f.relic.name} (${missing.join(', ')}).`;
      const rough = piecesHeld(g, f.relic).find((it) => it.dmg >= 85);
      if (rough) return 'One of the pieces is too far gone to join. Repair it first.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.get(t.uid);
      const f = item && fragmentOf(item);
      if (!f) return;
      const pieces = piecesHeld(g, f.relic);
      if (pieces.length < f.relic.parts) return;
      if (!g.skillCheck('restoration', f.relic.difficulty, 0, g.mindEase())) {
        for (const p of pieces) g.damageItem(p, 5 + g.rand() * 9);
        g.logMsg(`The pieces of the ${f.relic.name} will not sit together and you mark them trying.`, 'event');
        return;
      }
      // What comes out is only as good as the pieces that went in, less what age took.
      const avgQl = pieces.reduce((sum, p) => sum + p.ql * (1 - p.dmg / 200), 0) / pieces.length;
      const ql = Math.max(1, Math.min(100, avgQl * (0.72 + g.skills.get('restoration') / 260)));
      for (const p of pieces) g.inventory.remove(p.uid, 1);
      const made = g.inventory.add(f.relic.result, { ql });
      g.gainSkill('mind_logic', 0.4);
      g.logMsg(`The pieces go back together and the ${f.relic.name} is whole: ${itemName(made).toLowerCase()}. (QL ${made.ql.toFixed(1)})`, 'event');
    },
  },
  {
    id: 'study_book',
    label: 'Study',
    verb: 'studying',
    stamina: 0.02,
    baseTime: 30,
    applies: (t, g) => t.kind === 'item' && g.inventory.get(t.uid)?.id === 'book',
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      const item = g.inventory.get(t.uid);
      if (item?.id !== 'book') return 'That is not a book.';
      if (item.dmg >= 90) return 'The pages are too far gone to read. Repair it first.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.get(t.uid);
      if (!item || item.id !== 'book') return;
      // A lectern holds the pages open at the right angle, and you get twice as much out of the hour.
      const lectern = g.furnitureNear('lectern') !== undefined;
      const gain = g.gainSkill('mind_logic', (0.5 + item.ql / 90) * (lectern ? 2 : 1));
      g.damageItem(item, 2 + g.rand() * 3);
      const where = lectern ? ' The lectern holds it open at the right angle and you make good use of the hour.' : ' Held in one hand, it is hard going. A lectern would be better.';
      g.logMsg(`You work through the ${itemName(item).toLowerCase()}.${where}${gain > 0.0005 ? '' : ' There is nothing left in it you do not already know.'}`, 'event');
    },
  },
];

export const ARCHAEOLOGY_ACTION_BY_ID = new Map(ARCHAEOLOGY_ACTIONS.map((a) => [a.id, a]));
