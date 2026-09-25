import type { Target } from './actions';
import { SUBTILES } from './crates';
import { furnitureAnchor, furnitureFootprint, furnitureUnits, type PlacedFurniture } from './furniture';
import type { Game } from './game';
import { HIT_LOCATIONS, SLOTS, type Slot } from './gear';
import { shoreNear } from './placeables';
import { SWIM_DEPTH } from './player';
import { spanWords } from './words';

/**
 * A grave where you fell.
 *
 * Dying cost the walk back and nothing else: the body woke on the shore it
 * came in on, whole, with everything it had been carrying still on its back.
 * So a fight you could not win cost you a stroll, and deep water was a short
 * cut home.
 *
 * Now what you carry stays where you fell. The pack, what is in your hands,
 * the toolbelt, and every bag with what is in it go into a grave on that
 * spot, and for `GRAVE_KEEPS` of real time -- whether or not anybody is
 * playing -- it is yours and nobody else's: only you open it, only you take
 * from it, and nobody picks it up or breaks it. Then it crumbles, and
 * whatever is still in it goes with it.
 *
 * What you wear stays on the body: whatever is on you where a blow lands,
 * which is your clothing and your armour, and a jewel. So does a crate with a
 * wildermon in it, which goes where you go and into no store at all; and on
 * an island, whatever is held in a deal, which is promised to somebody.
 *
 * The island digs its own grave in `player_die`, by the same rule and in the
 * same words (`bury` there as here). This is the game you play by yourself,
 * and the host of a shared one.
 */

/** Seconds of real time a grave keeps what you carried for you, before it crumbles and takes it with it. */
export const GRAVE_KEEPS = 3600;
/** How far from water too deep to stand in a grave goes to find dry ground, in tiles. */
export const GRAVE_REACH = 3;
/** The piece a grave is. */
export const GRAVE = 'grave';
/** What a grave is built at, which is nothing anybody reads: nobody built it. */
const GRAVE_QL = 20;
/** What your grave is called on your map. */
export const GRAVE_MARK = 'Your grave';

/** What stays on the body: whatever is worn where a blow lands, head to feet, and a jewel. */
export const STAYS_ON: readonly Slot[] = [...HIT_LOCATIONS.map(([slot]) => slot), 'jewel'];

export const isGrave = (f: { kind: string }): boolean => f.kind === GRAVE;

/** Whether a grave is yours: an island says so of every piece, and here it is whoever died there. */
export const graveMine = (g: Game, f: PlacedFurniture): boolean => f.mine ?? f.grave?.who === g.actor.who;

/** Seconds until a grave crumbles, and never fewer than none. */
export const graveLeft = (f: PlacedFurniture, now = Date.now() / 1000): number => Math.max(0, (f.grave?.crumbles ?? now) - now);

/** Whose it is, as its menu and its window say: yours, or somebody's by name. */
export const graveName = (g: Game, f: PlacedFurniture): string =>
  graveMine(g, f) ? 'Your grave' : `${f.grave?.name ?? 'Somebody'}'s grave`;

/** How many things are in a grave: what an island says, which holds from any distance, or what is in it here. */
export const graveUnits = (f: PlacedFurniture): number => f.grave?.units ?? furnitureUnits(f);

/** What a grave says after its name: how much is in it, to the one who may take it, and when it crumbles. */
export function graveLine(g: Game, f: PlacedFurniture): string {
  const left = graveLeft(f);
  const when = left >= 1 ? `crumbles in ${spanWords(left)}` : 'crumbling';
  if (!graveMine(g, f)) return when;
  const n = graveUnits(f);
  return `${n} ${n === 1 ? 'thing' : 'things'} in it · ${when}`;
}

/* ---- who may do what at a grave --------------------------------------------- */

/**
 * What may be done at your own grave: take one thing out, or everything.
 * Nothing else is done to a grave by anybody -- nothing goes in, nobody picks
 * it up, turns it, names it or puts a padlock on it -- and nothing at all is
 * done at somebody else's. The island holds the same two, in `grave_refusal`.
 */
export const GRAVE_OPENS: ReadonlySet<string> = new Set(['furniture_take_all', 'take_from_store']);

/** What anybody but its owner is told at a grave, whatever they try. The island says it in the same words. */
export const graveNotYours = (name: string): string =>
  `That is ${name}'s grave. Nobody but ${name} can open it, take from it or move it.`;

/** What its owner is told for anything but taking things out. The island says the same. */
export const GRAVE_SHUT = 'Nothing goes into a grave and nothing moves it. Take what is in it out before it crumbles.';

/**
 * The grave an action is aimed at, if it is aimed at one: the piece itself, a
 * thing lying in one, or one a thing is being put into.
 */
export function graveAt(g: Game, t: Target): PlacedFurniture | undefined {
  if (t.kind === 'furniture') {
    const f = g.furniture.get(t.id);
    return f && isGrave(f) ? f : undefined;
  }
  if (t.kind !== 'item') return undefined;
  if (!g.inventory.get(t.uid)) {
    const piece = g.storeWith(t.uid)?.piece;
    if (piece && isGrave(piece)) return piece;
  }
  if (t.into !== undefined) {
    const f = g.furniture.get(t.into);
    if (f && isGrave(f)) return f;
  }
  return undefined;
}

/** Why this cannot be asked of this grave, or null when it may. */
export function graveSays(g: Game, f: PlacedFurniture, actionId: string): string | null {
  if (!graveMine(g, f)) return graveNotYours(f.grave?.name ?? 'Somebody');
  return GRAVE_OPENS.has(actionId) ? null : GRAVE_SHUT;
}

/** Why this cannot be asked of the grave it is aimed at; null when it is not aimed at one, or may be. */
export function graveRefusal(g: Game, actionId: string, t: Target): string | null {
  const f = graveAt(g, t);
  return f ? graveSays(g, f, actionId) : null;
}

/* ---- dying, and the grave it leaves ----------------------------------------- */

/** What a death is said in: with no grave, and with one where you fell or on the dry ground nearest it. */
export function deathSaid(grave: 'here' | 'shore' | null): string {
  if (!grave) return 'You have died. You wake up, shivering, where you first came ashore.';
  return `You have died. What you carried is in a grave ${grave === 'shore' ? 'on the nearest dry ground to where you fell' : 'where you fell'}; only you can open it, and it crumbles in ${spanWords(GRAVE_KEEPS)}.`;
}

/** What its owner is told when a grave crumbles with something still in it. The island says the same. */
export const crumbledSaid = (x: number, y: number, n: number): string =>
  `Your grave at ${x}, ${y} has crumbled. ${n === 1 ? 'The one thing still in it is lost.' : `The ${n} things still in it are lost.`}`;

/**
 * Where a grave goes for a body that fell at (`x`, `y`): the tile it fell on,
 * or -- when that is water too deep to stand in -- the nearest dry tile within
 * `GRAVE_REACH`, if there is one. On that tile it takes the free block nearest
 * where the body lay, so a second grave on the same tile is not dug into the
 * first and none stands in a chest; with nothing free it goes where the body
 * lay. The island's `bury` asks the same questions in the same order.
 */
export function graveSpot(g: Game, x: number, y: number): { x: number; y: number; sx: number; sy: number; shore: boolean } {
  let tx = Math.floor(x);
  let ty = Math.floor(y);
  let fx = x;
  let fy = y;
  let shore = false;
  if (g.world.inBounds(tx, ty) && g.world.centerHeight(tx, ty) < -SWIM_DEPTH) {
    const dry = shoreNear(g, GRAVE_REACH, [x, y]);
    if (dry) {
      tx = dry.x;
      ty = dry.y;
      fx = tx + 0.5;
      fy = ty + 0.5;
      shore = true;
    }
  }
  const [w, h] = furnitureFootprint(GRAVE);
  const [ax, ay] = furnitureAnchor(GRAVE, Math.floor((fx - tx) * SUBTILES), Math.floor((fy - ty) * SUBTILES));
  const taken = (sx: number, sy: number): boolean => {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (g.occupiedSubtile(tx, ty, sx + dx, sy + dy) || g.trapAt(tx, ty, sx + dx, sy + dy)) return true;
      }
    }
    return false;
  };
  let best: [number, number] = [ax, ay];
  let bestD = Infinity;
  for (let sy = 0; sy <= SUBTILES - h; sy++) {
    for (let sx = 0; sx <= SUBTILES - w; sx++) {
      const d = (sx - ax) ** 2 + (sy - ay) ** 2;
      if (d < bestD && !taken(sx, sy)) {
        bestD = d;
        best = [sx, sy];
      }
    }
  }
  return { x: tx, y: ty, sx: best[0], sy: best[1], shore };
}

/**
 * What the body that is acting was carrying, into a grave where it fell, and
 * what its death is said in. Nothing carried, no grave.
 *
 * Called before the body is put back on the shore, since where it fell is
 * where the grave goes. A light that was burning goes out: nothing burns down
 * in the ground. Whatever was held in a hand or hung on the belt is off the
 * body with the rest.
 */
export function bury(g: Game): string {
  const p = g.player;
  const worn = new Set(STAYS_ON.map((slot) => p.equipped[slot]).filter((uid): uid is number => typeof uid === 'number'));
  const goes = g.inventory.items.filter((it) => !worn.has(it.uid) && it.creature === undefined);
  if (!goes.length) return deathSaid(null);
  const spot = graveSpot(g, p.x, p.y);
  const gone = new Set(goes.map((it) => it.uid));
  const pack = g.inventory.items;
  for (let i = pack.length - 1; i >= 0; i--) if (gone.has(pack[i].uid)) pack.splice(i, 1);
  for (const it of goes) if (it.lit) it.lit = false;
  for (const slot of SLOTS) {
    const uid = p.equipped[slot];
    if (typeof uid === 'number' && gone.has(uid)) p.equipped[slot] = null;
  }
  g.inventory.onChange?.();
  const f = g.addFurniture(GRAVE, spot.x, spot.y, spot.sx, spot.sy, GRAVE_QL, goes);
  f.grave = { who: g.actor.who, name: p.name, crumbles: Date.now() / 1000 + GRAVE_KEEPS };
  g.events.emit('world', f.x, f.y);
  g.markOwnGraves();
  return deathSaid(spot.shore ? 'shore' : 'here');
}

/**
 * Graves whose hour is up, on this machine: gone, and whatever was still in
 * them with them. Whoever lies under one is told if anything was lost, and
 * their map loses the mark. An island crumbles its own, in `grave_sweep`, and
 * the next ground read simply leaves it out.
 */
export function crumble(g: Game, due: readonly PlacedFurniture[]): void {
  for (const f of due) {
    const lost = furnitureUnits(f);
    g.removeFurniture(f.id);
    g.events.emit('world', f.x, f.y);
    if (!lost) continue;
    for (const a of g.actors.values()) if (a.who === f.grave?.who) a.hear(crumbledSaid(f.x, f.y, lost), 'event');
  }
  g.markOwnGraves();
}
