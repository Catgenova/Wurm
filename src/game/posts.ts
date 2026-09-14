import type { ActionDef, Target } from './actions';
import { SUBTILES } from './crates';
import type { Game } from './game';
import { matOf } from './materials';
import { SPECIES, workRangeOf, GATHER_DO, type Creature } from './creatures';

/**
 * A work post: a stake driven into open ground with a crossbar nailed to it
 * and a strip of metal tacked on for a marker. One wildermon may be set to
 * work out of it exactly as it would out of a settlement — only a post is not
 * a settlement. It stands in the weather with nothing holding it up, and it
 * rots where it stands: half an hour for a rough one, three hours for the
 * best that can be made. When it goes over, whoever was working out of it
 * comes back to you.
 */
export interface PlacedPost {
  id: number;
  x: number;
  y: number;
  /** Subtile it stands on, 0..3 each way. */
  sx: number;
  sy: number;
  ql: number;
  /** How far gone it is; at a hundred it falls over. */
  dmg: number;
  /** The one wildermon working out of it, if any. */
  worker: number | null;
  /** The wood it was cut from. */
  material?: string;
}

/** Half an hour at the roughest, three hours at the finest. */
export const POST_LIFE_MIN = 30 * 60;
export const POST_LIFE_MAX = 3 * 60 * 60;
const clampQl = (ql: number): number => Math.max(1, Math.min(100, ql));

/** How long a post of this quality stands, in seconds. */
export const postLife = (ql: number): number => POST_LIFE_MIN + ((clampQl(ql) - 1) / 99) * (POST_LIFE_MAX - POST_LIFE_MIN);
/** Damage it takes a second, which is the same thing said the other way round. */
export const postDecayRate = (ql: number): number => 100 / postLife(ql);
/** Seconds it has left in it. */
export const postLeft = (p: PlacedPost): number => Math.max(0, postLife(p.ql) * (1 - p.dmg / 100));

/**
 * How far the wildermon set to it will range. A post is a work site and not a
 * settlement: eight tiles round a rough one, twenty round the best, and never
 * further however much the creature itself has learned.
 */
export const postRadius = (ql: number): number => Math.round(8 + (clampQl(ql) / 100) * 12);

export const postCentre = (p: PlacedPost): [number, number] => [p.x + (p.sx + 0.5) / SUBTILES, p.y + (p.sy + 0.5) / SUBTILES];
export const postName = (p: PlacedPost): string => (p.material ? `Work post (${p.material.toLowerCase()})` : 'Work post');

/** How long it has left, said the way a person would say it. */
export function postState(p: PlacedPost): string {
  const left = postLeft(p);
  if (left <= 0) return 'falling over';
  const mins = Math.ceil(left / 60);
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m left` : `${mins}m left`;
}

/** The site a post stands for, in the shape the worker loop reads. */
export const postSite = (p: PlacedPost): { x: number; y: number; radius: number; post: number } => ({
  x: Math.floor(postCentre(p)[0]),
  y: Math.floor(postCentre(p)[1]),
  radius: postRadius(p.ql),
  post: p.id,
});

type PostTarget = Extract<Target, { kind: 'post' }>;
const postOf = (g: Game, t: Target): PlacedPost | undefined => (t.kind === 'post' ? g.posts.get((t as PostTarget).id) : undefined);
const nearPost = (g: Game, p: PlacedPost): boolean => {
  const [cx, cy] = postCentre(p);
  return Math.hypot(cx - g.player.x, cy - g.player.y) <= 2.4;
};

/** Every tamed wildermon that could be set to a post right now. */
export const postCandidates = (g: Game): Creature[] =>
  [...g.creatures.list.values()].filter((c) => c.mode !== 'wild' && c.hitchedTo === null && !c.ridden && c.post === null);

export const POST_ACTIONS: ActionDef[] = [
  {
    id: 'place_post',
    label: 'Drive the post in',
    verb: 'driving the post in',
    hidden: true,
    stamina: 0.04,
    baseTime: 4,
    applies: (t) => t.kind === 'tile',
    check: (t, g) => {
      if (t.kind !== 'tile' || t.sx === undefined || t.sy === undefined) return 'Choose a spot.';
      const item = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.find('work_post');
      if (!item || item.id !== 'work_post') return 'You have no work post to drive in.';
      return g.postPlaceReason(t.x, t.y, t.sx, t.sy);
    },
    perform: (t, g) => {
      if (t.kind !== 'tile' || t.sx === undefined || t.sy === undefined) return;
      const item = t.itemUid !== undefined ? g.inventory.get(t.itemUid) : g.inventory.find('work_post');
      if (!item || item.id !== 'work_post' || !g.inventory.remove(item.uid, 1)) return;
      const p = g.addPost(t.x, t.y, t.sx, t.sy, item.ql, item.extra);
      g.logMsg(
        `You drive the post in and tack the ribbon to it. It will stand about ${Math.round(postLife(p.ql) / 60)} minutes and reach ${postRadius(p.ql)} tiles. Set a wildermon to it.`,
        'event',
      );
      g.events.emit('world', p.x, p.y);
    },
  },
  {
    id: 'assign_post',
    label: 'Set a wildermon to it',
    verb: 'setting it to work',
    hidden: true,
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => postOf(g, t) !== undefined,
    check: (t, g) => {
      const p = postOf(g, t);
      if (!p) return 'It is gone.';
      if (!nearPost(g, p)) return 'Stand at the post.';
      if (p.worker !== null && g.creatures.get(p.worker)) return 'Something is already working out of it.';
      const id = t.kind === 'post' ? t.creatureId : undefined;
      const c = id !== undefined ? g.creatures.get(id) : undefined;
      if (!c) return 'Choose a wildermon.';
      if (c.mode === 'wild') return `${c.name} is not yours to set to work.`;
      if (c.hitchedTo !== null || c.ridden) return `${c.name} is in harness.`;
      return null;
    },
    perform: (t, g) => {
      const p = postOf(g, t);
      const id = t.kind === 'post' ? t.creatureId : undefined;
      const c = id !== undefined ? g.creatures.get(id) : undefined;
      if (!p || !c) return;
      const [cx, cy] = postCentre(p);
      if (c.mode === 'stored') {
        c.x = cx;
        c.y = cy + 0.6;
      }
      c.post = p.id;
      c.mode = 'deed';
      c.enemy = null;
      c.state = 'idle';
      c.until = g.time;
      p.worker = c.id;
      const def = SPECIES[c.species];
      const reach = Math.min(workRangeOf(c, def), postRadius(p.ql));
      const job = def.gathers ? `${GATHER_DO[def.gathers]} within ${reach} tiles of the post` : 'keep to the post';
      g.logMsg(`${c.name} will ${job} while it stands. (${postState(p)})`, 'system');
      g.events.emit('creature');
    },
  },
  {
    id: 'unassign_post',
    label: 'Call it off the post',
    verb: 'calling it off',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => {
      const p = postOf(g, t);
      return !!p && p.worker !== null && !!g.creatures.get(p.worker);
    },
    perform: (t, g) => {
      const p = postOf(g, t);
      const c = p && p.worker !== null ? g.creatures.get(p.worker) : undefined;
      if (!p || !c) return;
      g.leavePost(p, 'is called off the post');
    },
  },
  {
    id: 'pick_up_post',
    label: 'Pull the post up',
    verb: 'pulling the post up',
    stamina: 0.04,
    baseTime: 3,
    applies: (t, g) => postOf(g, t) !== undefined,
    check: (t, g) => {
      const p = postOf(g, t);
      if (!p) return 'It is gone.';
      if (!nearPost(g, p)) return 'Stand at the post.';
      return null;
    },
    perform: (t, g) => {
      const p = postOf(g, t);
      if (!p) return;
      g.removePost(p.id, 'is pulled up');
      // Half rotten by now, most likely, and it comes up as it went in.
      g.inventory.add('work_post', { ql: Math.max(1, p.ql * (1 - p.dmg / 100)), extra: p.material });
      g.logMsg(`You pull the post up and coil the ribbon round it.`, 'event');
      g.events.emit('world', p.x, p.y);
    },
  },
];

export const POST_ACTION_BY_ID = new Map(POST_ACTIONS.map((a) => [a.id, a]));
/** Kept honest against the material table so a post's wood still reads. */
export const postWoodNote = (p: PlacedPost): string => matOf(p.material).note;
