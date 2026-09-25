import type { ActionDef, Target } from './actions';
import { isDone, progressOf, type Bill } from './building';
import { TileType } from '../world/tiles';

/**
 * Foundations.
 *
 * Asked for, out of a conversation about the thing Wurm never had: "some sort
 * of foundation piece, something material-intensive that fills in the terrain
 * of the tile and has perfectly vertical edges — could base the maximum slope
 * you can build them on skill", and then "specifically featuring vertical
 * edges that are easy to attach other building components to; in wurm i'd
 * often run into awkward building situations next to slopes."
 *
 * Every other answer to a slope in this game moves the ground: you dig the
 * high corner down, you drop the low one, you flatten, and the corners you
 * move are shared with four tiles, so levelling one tile pulls its neighbours
 * about and the hillside you wanted to build against stops being a hillside.
 * A foundation does the opposite. It leaves every corner exactly where it is
 * and pours a slab over the tile up to one flat top, with sides straight down
 * to whatever is underneath. The hill keeps its shape and you get a square of
 * level ground standing in it.
 *
 * What it costs is the hole it fills. `CONCRETE_PER_STEP` concrete for every
 * step of every corner it lifts, so a slab over a gentle tile is cheap, one
 * over a cliff is an undertaking, and one poured into deep water is the work
 * of a season — which is the point of the thing being material-intensive
 * rather than forbidden.
 *
 * What it asks of you is the deepest part of that pour. Three units of lift a
 * point of masonry: a beginner can square off a step, and a hillside needs
 * somebody who has been doing this a while.
 */

/** Concrete per step of one corner lifted. */
export const CONCRETE_PER_STEP = 10;
/**
 * How much lift one point of masonry is worth.
 *
 * Measured against the deepest corner of the pour rather than against the
 * tile's slope, because those are the same number when you pour to the top of
 * the tile — which is the cheapest and by far the commonest choice — and they
 * come apart only when somebody sights a level well above it and asks for a
 * plinth. Shuttering a plinth is the harder job, and this says so.
 */
export const LIFT_PER_MASONRY = 3;
/** How near a building or its plan a slab may be poured: not this near. */
export const CLEAR_OF_BUILDINGS = 1;

export interface Foundation extends Bill {
  id: number;
  x: number;
  y: number;
  /** The elevation the top of the slab is poured to, in terrain units. */
  top: number;
  /** Who set it out. */
  madeBy?: string;
}

/** Poured, rather than still a shuttered plan. */
export const foundationDone = (f: Foundation): boolean => isDone(f);
export const foundationProgress = (f: Foundation): number => progressOf(f);

/** What a pour to `top` costs over four corners: the hole it fills, priced by the step. */
export const concreteFor = (corners: readonly number[], top: number): number =>
  CONCRETE_PER_STEP * corners.reduce((n, h) => n + Math.max(0, Math.round(top - h)), 0);

/** The deepest part of the pour, which is the part that wants the skill. */
export const liftFor = (corners: readonly number[], top: number): number => top - Math.min(...corners);

/** The masonry a lift that deep asks for. */
export const masonryFor = (lift: number): number => lift / LIFT_PER_MASONRY;

export const foundationBill = (concrete: number): Bill => ({ needed: { concrete }, total: { concrete } });

export const foundationState = (f: Foundation): string =>
  foundationDone(f)
    ? `poured to ${f.top}`
    : `${Math.round(foundationProgress(f) * 100)}% · ${f.needed.concrete ?? 0} concrete still to go`;

type TileTarget = Extract<Target, { kind: 'tile' }>;
const isTile = (t: Target): t is TileTarget => t.kind === 'tile';

export const FOUNDATION_ACTIONS: ActionDef[] = [
  {
    id: 'plan_foundation',
    label: 'Set out a foundation',
    verb: 'shuttering a foundation',
    skill: 'masonry',
    tool: 'mallet',
    stamina: 0.03,
    baseTime: 4,
    applies: (t, g) => isTile(t) && !g.foundationAt(t.x, t.y) && g.world.slope(t.x, t.y) > 0,
    labelFor: (t, g) => {
      if (!isTile(t)) return 'Set out a foundation';
      const top = g.foundationTop(t.x, t.y);
      const want = concreteFor(g.world.tileCorners(t.x, t.y), top);
      return `Set out a foundation to ${top} (wants ${want} concrete)`;
    },
    check: (t, g) => (isTile(t) ? g.foundationReason(t.x, t.y, g.foundationTop(t.x, t.y)) : null),
    perform: (t, g) => {
      if (!isTile(t)) return;
      const top = g.foundationTop(t.x, t.y);
      if (g.foundationReason(t.x, t.y, top)) return;
      const f = g.addFoundation(t.x, t.y, top);
      g.note('planned_foundation');
      g.logMsg(
        `You shutter a foundation over the tile, to be poured level at ${top}.`
        + ` It wants ${f.total.concrete} concrete. The ground around it will not move: the slab fills the hole instead.`,
        'system',
      );
      g.events.emit('world', t.x, t.y);
    },
  },
  {
    id: 'pour_foundation',
    label: 'Pour the foundation',
    verb: 'pouring concrete',
    skill: 'masonry',
    tool: 'trowel',
    stamina: 0.05,
    baseTime: 6,
    repeat: true,
    applies: (t, g) => isTile(t) && !!g.foundationAt(t.x, t.y) && !foundationDone(g.foundationAt(t.x, t.y)!),
    labelFor: (t, g) => {
      const f = isTile(t) ? g.foundationAt(t.x, t.y) : undefined;
      return f ? `Pour the foundation (${f.needed.concrete ?? 0} concrete to go)` : 'Pour the foundation';
    },
    check: (t, g) => {
      if (!isTile(t)) return null;
      const f = g.foundationAt(t.x, t.y);
      if (!f) return 'There is no shuttering here.';
      if (foundationDone(f)) return 'It is poured.';
      if (!g.inventory.has('trowel')) return 'You need a trowel to work concrete.';
      if (!g.inventory.has('concrete')) return 'You have no concrete.';
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t)) return;
      const f = g.foundationAt(t.x, t.y);
      if (!f || foundationDone(f) || !g.inventory.consume('concrete')) return;
      f.needed.concrete = Math.max(0, (f.needed.concrete ?? 0) - 1);
      g.events.emit('world', t.x, t.y);
      if (!foundationDone(f)) {
        g.logMsg(`You work another barrowful into the shuttering. ${f.needed.concrete} to go.`, 'event');
        return true;
      }
      /*
       * And the top of it is packed ground, which is what everything that asks
       * what a tile is made of wants to hear: a building wants packed dirt
       * under it and paving wants a packed floor, and a slab is both. The
       * corners are not touched — that is the whole promise of the thing —
       * only what the top of the tile is surfaced with.
       */
      g.world.setTile(f.x, f.y, TileType.PackedDirt);
      g.note('poured_foundation');
      g.logMsg(`The last of it goes in and the slab stands level at ${f.top}. You can build on it, pave it, or bring a bridge to it.`, 'event');
      return false;
    },
  },
  {
    id: 'strike_foundation',
    label: 'Strike the shuttering',
    verb: 'striking the shuttering',
    stamina: 0.02,
    baseTime: 2,
    applies: (t, g) => isTile(t) && !!g.foundationAt(t.x, t.y) && !foundationDone(g.foundationAt(t.x, t.y)!),
    check: (t, g) => {
      if (!isTile(t)) return null;
      const f = g.foundationAt(t.x, t.y);
      if (!f) return 'There is no shuttering here.';
      // Concrete that has gone off is not coming back out of the ground, and a
      // slab that is holding a house up is not a plan any more.
      if (foundationDone(f)) return 'It is poured. That is a floor now, not a plan.';
      return null;
    },
    perform: (t, g) => {
      if (!isTile(t)) return;
      const f = g.foundationAt(t.x, t.y);
      if (!f || foundationDone(f)) return;
      const back = (f.total.concrete ?? 0) - (f.needed.concrete ?? 0);
      g.removeFoundation(f.id);
      // What went in has set; the boards come away and the rest is rubble.
      if (back > 0) g.inventory.add('rock_shards', { count: back, ql: 20 });
      g.logMsg(`You strike the shuttering${back > 0 ? ` and break out ${back} barrowful${back > 1 ? 's' : ''} of set concrete as shards` : ''}.`, 'event');
      g.events.emit('world', t.x, t.y);
    },
  },
];

export const FOUNDATION_ACTION_BY_ID = new Map(FOUNDATION_ACTIONS.map((a) => [a.id, a]));
