import type { ActionDef, Target } from './actions';
import { STORE_REACH, SUBTILES } from './crates';
import { ageDef, GATHER_DO, SPECIES, workRangeOf, type Creature } from './creatures';
import { facingOf, furnitureCentre, furnitureDef, type PlacedFurniture } from './furniture';
import type { Side } from './building';
import type { Game } from './game';
import type { Item } from './items';

/**
 * A creature crate: the one place a wildermon goes when it is neither
 * travelling with you nor working the deed.
 *
 * It replaces keeping one at the settlement token. Asked for: "Wildermon can
 * be tamed to be set to active if currently no active wildermon, but any
 * additional wildermon cannot be tamed unless the player carries a creature
 * crate. Creature crates can be placed on the ground and display the
 * wildermon inside them. ... Wildermon can no longer be Kept at Token.
 * Interacting with a creature crate allows you to pick it up / place it,
 * assign the creature to active, or assign the creature to work the deed."
 *
 * A crate holds one wildermon. The crate knows which: `Item.creature` while
 * it is carried or lying anywhere, `PlacedFurniture.creature` while it stands
 * on the ground, and the island keeps the same two columns. The wildermon's
 * own mode is `stored`, which has always meant put away -- not moving, not
 * eating, not drawn in the world -- and now means put away in a crate.
 */
export const CREATURE_CRATE = 'creature_crate';

/** The name of the wildermon in a crate, carried or standing, for the lists that show one; undefined when it is empty. */
export const occupantOf = (g: Game, crate: { creature?: number }): string | undefined =>
  crate.creature === undefined ? undefined : (g.creatures.get(crate.creature)?.name ?? 'A wildermon');

/** What a standing crate says after its quality: who is in it, or that it is empty. */
export function crateLine(g: Game, crate: { creature?: number }): string {
  const c = crate.creature === undefined ? undefined : g.creatures.get(crate.creature);
  if (crate.creature === undefined) return 'empty';
  if (!c) return 'a wildermon inside';
  return `${c.name}, ${ageOfWord(c, g.time)} ${SPECIES[c.species].name.toLowerCase()}, inside`;
}
const ageOfWord = (c: Creature, now: number): string => (ageDef(c, now).name === 'grown' ? 'a' : `a ${ageDef(c, now).name}`);

/** An empty creature crate in the pack, the first there is. */
export const emptyCrate = (g: Game): Item | undefined =>
  g.inventory.items.find((it) => it.id === CREATURE_CRATE && it.creature === undefined);

/** An empty creature crate of yours standing on your settlement, the nearest to (x, y) there is. */
export function standingCrate(g: Game, x: number, y: number): PlacedFurniture | undefined {
  let best: PlacedFurniture | undefined;
  let bestD = Infinity;
  for (const f of g.furniture.values()) {
    if (f.kind !== CREATURE_CRATE || f.creature !== undefined || f.mine === false || !g.onDeed(f.x, f.y)) continue;
    const [cx, cy] = furnitureCentre(f);
    const d = Math.hypot(cx - x, cy - y);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

/**
 * What may be done with a crate that has a wildermon in it: carry it, set it
 * down, open it, look at it, put it by and name it. Nothing else -- it is not
 * dropped, bagged, stored, sold, posted, traded or thrown away, because a
 * wildermon goes where its crate goes and nobody keeps yours but you. The
 * island asks the same of the same list.
 */
export const OCCUPIED_CRATE_ACTIONS: ReadonlySet<string> = new Set([
  'examine_item', 'place_furniture', 'crate_follow', 'crate_work', 'lock_item', 'unlock_item', 'name_thing',
]);

/** Why this cannot be asked of the thing aimed at, when that is a crate with a wildermon in it; null otherwise. */
export function occupiedRefusal(g: Game, actionId: string, t: Target): string | null {
  if (t.kind !== 'item' || OCCUPIED_CRATE_ACTIONS.has(actionId)) return null;
  const it = g.inventory.get(t.uid);
  if (!it || it.creature === undefined) return null;
  const c = g.creatures.get(it.creature);
  return `${c?.name ?? 'A wildermon'} is in that crate. A crate with a wildermon in it can be carried, set down or opened, and nothing else.`;
}

/**
 * The crate a wildermon is shut in: standing on the ground, in the pack, or
 * lying anywhere else an item can lie -- in a bag, on the ground, in a store.
 * Only the first two can be opened where they are.
 */
export type Holding = { piece: PlacedFurniture } | { item: Item; carried: boolean };

export function crateOf(g: Game, id: number): Holding | null {
  for (const f of g.furniture.values()) if (f.kind === CREATURE_CRATE && f.creature === id) return { piece: f };
  for (const it of g.inventory.items) if (it.id === CREATURE_CRATE && it.creature === id) return { item: it, carried: true };
  const holds = (it: Item): boolean => it.id === CREATURE_CRATE && it.creature === id;
  for (const it of g.inventory.items) for (const inner of it.inside ?? []) if (holds(inner)) return { item: inner, carried: false };
  for (const pile of g.ground.values()) for (const it of pile) if (holds(it)) return { item: it, carried: false };
  for (const c of g.crates.values()) for (const it of c.items) if (holds(it)) return { item: it, carried: false };
  for (const f of g.furniture.values()) for (const it of f.items) if (holds(it)) return { item: it, carried: false };
  return null;
}

/** Out through a crate's door, which is on the side it faces: the way the one inside faces, and the way it comes out. */
export const CRATE_DOOR: Record<Side, [number, number]> = { s: [0, 1], e: [1, 0], n: [0, -1], w: [-1, 0] };
/** How far in front of a standing crate's middle one comes out, in tiles. */
export const DOOR_STEP = 0.6;

/** Where a wildermon comes out of a crate: in front of the door of one standing on the ground, and at your feet from one you carry. */
function doorOf(g: Game, h: Holding): [number, number] {
  if ('piece' in h) {
    const [cx, cy] = furnitureCentre(h.piece);
    const [dx, dy] = CRATE_DOOR[facingOf(h.piece)];
    return [cx + dx * DOOR_STEP, cy + dy * DOOR_STEP];
  }
  return [g.player.x, g.player.y];
}

/**
 * Shut a wildermon in a crate. Whatever it was carrying is put down where it
 * stood, and a post it was at is let go. It stops where it is, and it does
 * not get hungry while it is in there.
 */
export function shutIn(g: Game, c: Creature, crate: Item | PlacedFurniture): void {
  g.clearPost(c);
  if (c.carrying) g.dropOnGround(Math.floor(c.x), Math.floor(c.y), c.carrying);
  c.carrying = null;
  c.mode = 'stored';
  c.enemy = null;
  c.state = 'idle';
  c.moving = false;
  c.until = g.time;
  crate.creature = c.id;
  if ('kind' in crate) {
    const [cx, cy] = furnitureCentre(crate);
    c.x = cx;
    c.y = cy;
    g.events.emit('world', crate.x, crate.y);
  } else {
    c.x = g.player.x;
    c.y = g.player.y;
  }
  g.events.emit('creature');
}

/** Let a wildermon out of whatever crate holds it: the crate forgets it, and it stands at the crate's door. */
export function letOut(g: Game, c: Creature): void {
  const h = crateOf(g, c.id);
  if (h) {
    const [x, y] = doorOf(g, h);
    c.x = x;
    c.y = y;
    if ('piece' in h) {
      h.piece.creature = undefined;
      g.events.emit('world', h.piece.x, h.piece.y);
    } else h.item.creature = undefined;
  }
  c.state = 'idle';
  c.until = g.time;
  g.events.emit('creature');
}

/** The crate an action is aimed at -- one standing on the ground, or one in the pack -- and whoever is in it. */
function crateAt(g: Game, t: Target): { crate: Item | PlacedFurniture; placed: boolean; c: Creature | undefined } | null {
  if (t.kind === 'furniture') {
    const f = g.furniture.get(t.id);
    if (!f || f.kind !== CREATURE_CRATE) return null;
    return { crate: f, placed: true, c: f.creature === undefined ? undefined : g.creatures.get(f.creature) };
  }
  if (t.kind === 'item') {
    const it = g.inventory.get(t.uid);
    if (!it || it.id !== CREATURE_CRATE) return null;
    return { crate: it, placed: false, c: it.creature === undefined ? undefined : g.creatures.get(it.creature) };
  }
  return null;
}

/** Why a crate cannot be opened from where you stand, or null. */
function openRefusal(g: Game, at: NonNullable<ReturnType<typeof crateAt>>): string | null {
  if (!at.c) return 'The crate is empty.';
  if (at.c.mode !== 'stored') return `${at.c.name} is not in it.`;
  if (at.placed) {
    const [cx, cy] = furnitureCentre(at.crate as PlacedFurniture);
    if (Math.hypot(cx - g.player.x, cy - g.player.y) > STORE_REACH) return 'Stand next to the crate.';
  }
  return null;
}

/** Why the companion you have cannot go into the crate in place of the one coming out, or null. */
function swapRefusal(g: Game): string | null {
  const current = g.creatures.active();
  if (!current) return null;
  if (current.hitchedTo !== null) return `${current.name} is in the traces, and would have to go into the crate in its place. Take it out first.`;
  if (current.ridden) return `Get down off ${current.name} first: it goes into the crate in its place.`;
  return null;
}

/** What a worker set to the deed will do, said the same way whether it came off a leash or out of a crate. */
export function deedJobLine(c: Creature): string {
  const gathers = c.trade ?? SPECIES[c.species].gathers;
  return gathers
    ? `${GATHER_DO[gathers]} within ${workRangeOf(c, SPECIES[c.species])} tiles of the token and bring what it finds to the crate`
    : 'stay around the settlement';
}

export const CREATURE_CRATE_ACTIONS: ActionDef[] = [
  {
    id: 'crate_creature',
    label: 'Put in a crate',
    verb: 'crating it',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => {
      const c = t.kind === 'creature' ? g.creatures.get(t.id) : undefined;
      return !!c && (c.mode === 'active' || c.mode === 'deed') && c.hitchedTo === null && !c.ridden;
    },
    check: (t, g) => {
      const c = t.kind === 'creature' ? g.creatures.get(t.id) : undefined;
      if (!c) return 'It is gone.';
      if (!emptyCrate(g)) return 'You need an empty creature crate in your pack.';
      return null;
    },
    perform: (t, g) => {
      const c = t.kind === 'creature' ? g.creatures.get(t.id) : undefined;
      const crate = emptyCrate(g);
      if (!c || !crate || (c.mode !== 'active' && c.mode !== 'deed')) return;
      shutIn(g, c, crate);
      g.logMsg(`${c.name} goes into the creature crate. Set the crate down and it can be seen inside.`, 'system');
    },
  },
  {
    id: 'crate_follow',
    label: 'Let it out to follow you',
    labelFor: (t, g) => {
      const at = crateAt(g, t);
      return at?.c ? `Let ${at.c.name} out to follow you` : 'Let it out to follow you';
    },
    verb: 'opening the crate',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => !!crateAt(g, t)?.c,
    check: (t, g) => {
      const at = crateAt(g, t);
      if (!at) return 'That is not a creature crate.';
      return openRefusal(g, at) ?? swapRefusal(g);
    },
    perform: (t, g) => {
      const at = crateAt(g, t);
      if (!at?.c || openRefusal(g, at) || swapRefusal(g)) return;
      const c = at.c;
      // The companion there is already goes into the crate this one leaves.
      const current = g.creatures.active();
      letOut(g, c);
      c.mode = 'active';
      c.enemy = null;
      if (current && current !== c) {
        shutIn(g, current, at.crate);
        g.logMsg(`${c.name} comes out of the crate and follows you. ${current.name} goes into the crate in its place.`, 'system');
      } else {
        g.logMsg(`${c.name} comes out of the crate and follows you.`, 'system');
      }
    },
  },
  {
    id: 'crate_work',
    label: 'Set it to work the deed',
    labelFor: (t, g) => {
      const at = crateAt(g, t);
      return at?.c ? `Set ${at.c.name} to work the deed` : 'Set it to work the deed';
    },
    verb: 'opening the crate',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => !!crateAt(g, t)?.c,
    check: (t, g) => {
      const at = crateAt(g, t);
      if (!at) return 'That is not a creature crate.';
      const shut = openRefusal(g, at);
      if (shut) return shut;
      if (!g.deed) return 'You have no settlement to set it to work on.';
      const def = at.c ? SPECIES[at.c.species] : undefined;
      if (def && !def.gathers) return `A ${def.name.toLowerCase()} has no trade to be set to.`;
      if (g.creatures.workers().length >= g.workerCap) {
        return `${g.deed.name} has work for ${g.workerCap} wildermon at level ${g.deedLevel}. Upgrade the settlement to take on more.`;
      }
      return null;
    },
    perform: (t, g) => {
      const at = crateAt(g, t);
      if (!at?.c || !g.deed || openRefusal(g, at)) return;
      const c = at.c;
      letOut(g, c);
      c.mode = 'deed';
      c.trade = null;
      c.enemy = null;
      g.logMsg(`${c.name} comes out of the crate and will ${deedJobLine(c)}.`, 'system');
    },
  },
];

export const CREATURE_CRATE_ACTION_BY_ID = new Map(CREATURE_CRATE_ACTIONS.map((a) => [a.id, a]));

/** A free spot for a crate on the ground nearest a tile, looked for out to `reach` tiles. */
function spotNear(g: Game, x0: number, y0: number, reach: number): { x: number; y: number; sx: number; sy: number } | null {
  const [w, h] = [furnitureDef(CREATURE_CRATE).w, furnitureDef(CREATURE_CRATE).h];
  for (let r = 1; r <= reach; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const [x, y] = [x0 + dx, y0 + dy];
        if (!g.world.inBounds(x, y)) continue;
        for (let sy = 0; sy + h <= SUBTILES; sy += h) {
          for (let sx = 0; sx + w <= SUBTILES; sx += w) {
            if (!g.furniturePlaceReason(CREATURE_CRATE, x, y, sx, sy, 's')) return { x, y, sx, sy };
          }
        }
      }
    }
  }
  return null;
}

/**
 * Every wildermon that was kept at the token before there were creature
 * crates, put in a crate of its own: set down beside the token where there is
 * room, and in the pack where there is none. Before that, a crate naming a
 * wildermon that is not shut in one -- or one another crate already names --
 * is emptied, so a crate and what is in it always agree. Returns how many were
 * crated.
 */
export function crateTheKept(g: Game): number {
  const named = new Set<number>();
  const tidy = (it: { creature?: number }): void => {
    if (it.creature === undefined) return;
    const c = g.creatures.get(it.creature);
    if (!c || c.mode !== 'stored' || named.has(c.id)) it.creature = undefined;
    else named.add(c.id);
  };
  for (const f of g.furniture.values()) if (f.kind === CREATURE_CRATE) tidy(f);
  for (const it of g.inventory.items) if (it.id === CREATURE_CRATE) tidy(it);
  let n = 0;
  for (const c of g.creatures.stored()) {
    if (named.has(c.id)) continue;
    const spot = g.deed ? spotNear(g, g.deed.x, g.deed.y, Math.max(1, g.deed.radius)) : null;
    if (spot) {
      const f = g.addFurniture(CREATURE_CRATE, spot.x, spot.y, spot.sx, spot.sy, 20, [], undefined, 's');
      f.creature = c.id;
      [c.x, c.y] = furnitureCentre(f);
      g.events.emit('world', f.x, f.y);
    } else {
      const it = g.inventory.add(CREATURE_CRATE, { ql: 20 });
      it.creature = c.id;
      c.x = g.player.x;
      c.y = g.player.y;
    }
    named.add(c.id);
    n++;
  }
  if (n) g.events.emit('creature');
  return n;
}
