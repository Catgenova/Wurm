/**
 * Garden steps: a flight laid up a sloping tile, in stone or in timber.
 *
 * Asked for with the pictures of the marble garden: broad outdoor steps up a
 * bank, treads and risers following the slope, cheeks at the sides and a pot
 * of flowers at either end of the top and the bottom. The tile becomes
 * `TileType.Steps`, the stone or the wood goes in its data byte, and which way
 * it climbs is read off the corners (`stepsFit`). What makes it more than a
 * picture is that a flight is walked at any slope it can be laid on, where the
 * bare ground would be too steep to stand on (`standsOn`, `groundStep`), and a
 * wheel will not take it.
 *
 * Every door here is the island's too, in the same words and the same order
 * (`steps_refusal`, `perform_steps`): the tool first, as the island asks it of
 * every job that works the ground, then the building over it, the packing, the
 * water, the shape of the ground, and what goes into it.
 */
import type { ActionDef, Target } from './actions';
import type { Game } from './game';
import { itemDef, type Item } from './items';
import {
  SLAB_BY_ITEM, SLAB_VARIANTS, STEPS_BRICKS, STEPS_MORTAR, STEPS_NAILS, STEPS_PLANKS, STEPS_SLABS, STEPS_TIMBER,
  TREE_DEFS, TileType, stepsBrick, stepsGroundRefusal, stepsKind, stepsName, stepsTimber,
} from '../world/tiles';
import { numberWord } from './words';

/** What comes back whole when a flight is taken up: half of each of its slabs, bricks and planks, rounded down. */
export const STEPS_BACK = 0.5;
/** How hard a flight is to lay well, in stone and in timber: the go's skill check, read by the island off the action. */
export const STONE_DIFFICULTY = 15;
export const TIMBER_DIFFICULTY = 12;
export const stepsBack = (n: number): number => Math.floor(n * STEPS_BACK);

type TileTarget = Extract<Target, { kind: 'tile' }>;
const onTile = (t: Target): t is TileTarget => t.kind === 'tile';

/** The corners of a tile, north-west first and clockwise. */
const cornersOf = (g: Game, x: number, y: number): number[] => g.world.corners(x, y, [0, 0, 0, 0]);

/** Why the ground itself will not take a flight: a building on it, loose ground, water, or the wrong shape. */
function groundWhyNot(g: Game, t: TileTarget): string | null {
  if (g.buildings.buildingAt(t.x, t.y)) return 'You cannot do that inside a building.';
  if (g.world.getTile(t.x, t.y) !== TileType.PackedDirt) return 'The ground has to be packed flat before anything is laid on it.';
  if (g.world.hasWater(t.x, t.y)) return 'Not under water.';
  return stepsGroundRefusal(cornersOf(g, t.x, t.y));
}

/** The slab a stone flight is laid with: the stack named, or the first cut slab in the pack. */
export const stepsSlab = (g: Game, t: Target): Item | undefined => {
  const named = onTile(t) && t.itemUid !== undefined ? g.inventory.get(t.itemUid) : undefined;
  if (named) return SLAB_BY_ITEM.has(named.id) && !named.locked ? named : undefined;
  return g.inventory.items.find((it) => SLAB_BY_ITEM.has(it.id) && !it.locked);
};

/** The planks a timber flight is laid with: the stack named, or the first planks in the pack. */
export const stepsPlanks = (g: Game, t: Target): Item | undefined => {
  const named = onTile(t) && t.itemUid !== undefined ? g.inventory.get(t.itemUid) : undefined;
  if (named) return named.id === 'plank' && !named.locked ? named : undefined;
  return g.inventory.items.find((it) => it.id === 'plank' && !it.locked);
};

/** How many loose ones of a kind there are in the pack. */
const loose = (g: Game, id: string): number => g.inventory.count(id);

/** Loose planks of exactly this wood, a plank with none written on it counting only with others like it. */
const planksOf = (g: Game, wood: string | undefined): Item[] =>
  g.inventory.items.filter((it) => it.id === 'plank' && !it.locked && it.extra === wood);

/** Take `n` planks of one wood, the stack named first: false, and nothing taken, when there are not that many. */
function takePlanks(g: Game, first: Item, n: number): boolean {
  const stacks = [first, ...planksOf(g, first.extra).filter((it) => it.uid !== first.uid)];
  if (stacks.reduce((k, it) => k + it.count, 0) < n) return false;
  let left = n;
  for (const st of stacks) {
    const take = Math.min(left, st.count);
    if (take > 0 && g.inventory.remove(st.uid, take)) left -= take;
    if (left <= 0) break;
  }
  return left === 0;
}

/** Which of the woods a plank is, as the data byte keeps it; a plank with no wood written on it is pine. */
export const woodIndex = (extra: string | undefined): number => {
  const i = TREE_DEFS.findIndex((d) => d.name === extra);
  return i >= 0 ? i : TREE_DEFS.findIndex((d) => d.name === 'Pine');
};

export const STONE_STEPS_BILL = `${numberWord(STEPS_SLABS)} cut slabs of one stone, ${numberWord(STEPS_BRICKS)} bricks of the same stone and ${numberWord(STEPS_MORTAR)} mortar`;
export const TIMBER_STEPS_BILL = `${numberWord(STEPS_PLANKS)} planks of one wood and ${numberWord(STEPS_NAILS)} nails`;

export const STEPS_ACTIONS: ActionDef[] = [
  {
    id: 'lay_steps',
    label: 'Lay stone steps',
    labelFor: (t, g) => {
      const slab = stepsSlab(g, t);
      return slab ? `Lay ${stepsName(SLAB_BY_ITEM.get(slab.id) ?? 0).toLowerCase()}` : 'Lay stone steps';
    },
    verb: 'laying steps',
    skill: 'masonry',
    tool: 'trowel',
    stamina: 0.06,
    baseTime: 20,
    difficulty: STONE_DIFFICULTY,
    applies: (t, g) => onTile(t) && g.world.getTile(t.x, t.y) === TileType.PackedDirt,
    check: (t, g) => {
      if (!onTile(t)) return null;
      if (!g.inventory.has('trowel')) return 'You need a trowel to lay stone steps.';
      const ground = groundWhyNot(g, t);
      if (ground) return ground;
      const slab = stepsSlab(g, t);
      if (!slab || loose(g, slab.id) < STEPS_SLABS || loose(g, stepsBrick(slab.id)) < STEPS_BRICKS || loose(g, 'mortar') < STEPS_MORTAR) {
        return `A flight of stone steps takes ${STONE_STEPS_BILL}.`;
      }
      return null;
    },
    perform: (t, g) => {
      if (!onTile(t)) return;
      const slab = stepsSlab(g, t);
      // What goes into it is counted before the go, so that a go never spends half of it.
      if (!slab || loose(g, slab.id) < STEPS_SLABS || loose(g, stepsBrick(slab.id)) < STEPS_BRICKS || loose(g, 'mortar') < STEPS_MORTAR) return;
      const kind = SLAB_BY_ITEM.get(slab.id) ?? 0;
      if (!g.skillCheck('masonry', STONE_DIFFICULTY, g.toolQl('trowel'))) {
        g.missed();
        g.logMsg('The treads rock on their bed however you set them. You take them up again.', 'event');
        return;
      }
      const slabId = slab.id;
      // The stack named first, then any other of the same stone.
      const fromNamed = Math.min(STEPS_SLABS, slab.count);
      if (!g.inventory.remove(slab.uid, fromNamed)) return;
      if (fromNamed < STEPS_SLABS && !g.inventory.consume(slabId, STEPS_SLABS - fromNamed)) return;
      if (!g.inventory.consume(stepsBrick(slabId), STEPS_BRICKS) || !g.inventory.consume('mortar', STEPS_MORTAR)) return;
      g.world.setTile(t.x, t.y, TileType.Steps, kind);
      g.logMsg(`You lay a flight of ${stepsName(kind).toLowerCase()} up the slope.`, 'event');
    },
  },
  {
    id: 'lay_timber_steps',
    label: 'Lay timber steps',
    labelFor: (t, g) => {
      const planks = stepsPlanks(g, t);
      return planks ? `Lay ${stepsName(STEPS_TIMBER | woodIndex(planks.extra)).toLowerCase()}` : 'Lay timber steps';
    },
    verb: 'laying steps',
    skill: 'carpentry',
    tool: 'mallet',
    stamina: 0.05,
    baseTime: 16,
    difficulty: TIMBER_DIFFICULTY,
    applies: (t, g) => onTile(t) && g.world.getTile(t.x, t.y) === TileType.PackedDirt,
    check: (t, g) => {
      if (!onTile(t)) return null;
      if (!g.inventory.has('mallet')) return 'You need a mallet to lay timber steps.';
      const ground = groundWhyNot(g, t);
      if (ground) return ground;
      const planks = stepsPlanks(g, t);
      if (!planks || planksOf(g, planks.extra).reduce((n, it) => n + it.count, 0) < STEPS_PLANKS || loose(g, 'nail') < STEPS_NAILS) {
        return `A flight of timber steps takes ${TIMBER_STEPS_BILL}.`;
      }
      return null;
    },
    perform: (t, g) => {
      if (!onTile(t)) return;
      const planks = stepsPlanks(g, t);
      if (!planks || planksOf(g, planks.extra).reduce((n, it) => n + it.count, 0) < STEPS_PLANKS || loose(g, 'nail') < STEPS_NAILS) return;
      const wood = planks.extra;
      if (!g.skillCheck('carpentry', TIMBER_DIFFICULTY, g.toolQl('mallet'))) {
        g.missed();
        g.logMsg('The boards will not sit square on their bearers. You knock them loose again.', 'event');
        return;
      }
      if (g.inventory.count('nail') < STEPS_NAILS || !takePlanks(g, planks, STEPS_PLANKS)) return;
      if (!g.inventory.consume('nail', STEPS_NAILS)) return;
      const data = STEPS_TIMBER | woodIndex(wood);
      g.world.setTile(t.x, t.y, TileType.Steps, data);
      g.logMsg(`You lay a flight of ${stepsName(data).toLowerCase()} up the slope.`, 'event');
    },
  },
  {
    id: 'take_up_steps',
    label: 'Take up the steps',
    verb: 'taking up the steps',
    skill: 'paving',
    tool: 'pickaxe',
    stamina: 0.05,
    baseTime: 10,
    applies: (t, g) => onTile(t) && g.world.getTile(t.x, t.y) === TileType.Steps,
    check: (t, g) => {
      if (!onTile(t)) return null;
      if (!g.inventory.has('pickaxe')) return 'You need a pickaxe to take up the steps.';
      if (g.world.getTile(t.x, t.y) !== TileType.Steps) return 'There are no steps here.';
      if (g.buildings.buildingAt(t.x, t.y)) return 'You cannot do that inside a building.';
      return null;
    },
    perform: (t, g) => {
      if (!onTile(t)) return;
      const data = g.world.getData(t.x, t.y);
      const name = stepsName(data).toLowerCase();
      g.world.setTile(t.x, t.y, TileType.PackedDirt);
      const ql = g.productQl('paving');
      const kept: string[] = [];
      if (stepsTimber(data)) {
        const wood = TREE_DEFS[stepsKind(data)].name;
        g.gather('plank', { count: stepsBack(STEPS_PLANKS), ql, extra: wood });
        kept.push(`${numberWord(stepsBack(STEPS_PLANKS))} planks`);
      } else {
        const slab = SLAB_VARIANTS[stepsKind(data)].item;
        g.gather(slab, { count: stepsBack(STEPS_SLABS), ql });
        g.gather(stepsBrick(slab), { count: stepsBack(STEPS_BRICKS), ql });
        kept.push(`${numberWord(stepsBack(STEPS_SLABS))} ${itemDef(slab).name.toLowerCase()}${stepsBack(STEPS_SLABS) === 1 ? '' : 's'}`,
          `${numberWord(stepsBack(STEPS_BRICKS))} ${itemDef(stepsBrick(slab)).name.toLowerCase()}s`);
      }
      g.logMsg(`You take up the ${name} and keep ${kept.join(' and ')} whole. The ground under them is packed dirt.`, 'event');
    },
  },
];
