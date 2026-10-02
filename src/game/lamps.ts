import type { ActionDef, Target } from './actions';
import { isLowWall, WALL_THICK, type Side, type WallType } from './building';
import { STORE_REACH, SUBTILES } from './crates';
import { facingOf, furnitureCentre, furnitureDef, furnitureFootprint, LAMP_TAKE_FIRST, turnedFacing, type PlacedFurniture } from './furniture';
import type { Game } from './game';
import { rarityStep, type Item } from './items';
import { candleLeft, flameNear, noCandleLine, noFlameLine } from './lantern';
import { candleBurn, lanternReach, type LightSource } from './light';
import { timeWords } from './words';

/**
 * Lantern posts: a lantern that stays where it is put.
 *
 * Two pieces, a timber post with an iron arm and the lantern hanging off it
 * (carpentry) and a stone pillar with the lantern standing in its top
 * (masonry). Neither is a light by itself. A lantern is fitted to one -- the
 * same lantern you carry, out of your pack -- and after that it is a carried
 * lantern to every rule there is: it takes a candle when it has none left,
 * the candle lasts what it would in that lantern in your hand (`candleBurn`
 * of the lantern's quality), it is lit at a fire or off a light in your hand,
 * it burns only while it is lit, and it is put out by pinching the wick. What
 * it throws is what the lantern throws (`lanternReach`), and it throws it for
 * everybody: at night the ground round it out to that reach is lit and seen,
 * whoever is standing there.
 *
 * The lantern goes into the piece rather than into a store in it: its
 * quality, rarity, damage and maker are kept on the piece (`lamp`; on the
 * island `placed.state -> lamp`), the candle left in it is the piece's `fuel`
 * and whether it burns is the piece's `lit` -- the two a fire has always been
 * worked out from on the island (`placed_fuel`, `placed_lit`), a second of
 * candle burned a second. Taken down, it is a lantern in your pack again,
 * with the candle it had left and alight if it was.
 */

/** The lantern fitted to a post or a pillar: what it was when it went in. */
export interface Lamp {
  ql: number;
  dmg?: number;
  /** 1 rare, 2 supreme, 3 fantastic; absent for the ordinary run. */
  rare?: number;
  maker?: string;
}

/**
 * How far out from the middle of a post its lantern hangs, toward the way it
 * faces, in the world's tenths of a metre: the reach of the iron arm. A
 * pillar's lantern stands on its top, over its middle. The model is drawn to
 * the same number and the light falls from under the lantern.
 */
export const LAMP_ARM = 6;
/**
 * The lantern on a post against the one in your hand, as the model draws it,
 * and half its width at the widest, which is its cap's eaves: a pane is 1.2
 * of that size from the middle and the cap stands 0.35 past the pane.
 */
export const LAMP_GLASS = 1.15;
export const LAMP_HALF = 1.55 * LAMP_GLASS;
/**
 * How high the middle of the lantern hangs on a post, and stands on a pillar,
 * in tenths of a metre: where the glow is drawn. Low enough that the top of
 * either, cap and ring, stays under the eaves of a house of one storey where
 * they hang out over it: the storey is thirty and its eaves come down to
 * about twenty-seven at their edge, and a post's head is 6.7 over its
 * lantern's middle and a pillar's lantern 5.7 over its own.
 */
export const LAMP_HANG = { arm: 19.3, top: 21.2 } as const;
/** A tile is forty tenths of a metre across. */
const UNITS_PER_TILE = 40;
/** How far from a post's middle its arm and the lantern on it reach, in tiles: the lantern's far side. */
export const LAMP_ARM_REACH = (LAMP_ARM + LAMP_HALF) / UNITS_PER_TILE;
/** How hard a fitted lantern pushes the dark back at its middle: a lantern in your hand's. */
export const LAMP_STRENGTH = 0.92;
/**
 * The colour a candle behind glass throws on the ground round it, and how
 * strong at full dark: a little over a fire's (0.16 of its strength). Where
 * several lights fall on one spot the warmest of them is what shows there,
 * not the sum (`drawOverlays`), so a street of them is no brighter than one.
 */
export const LAMP_CAST = '255, 200, 118';
export const LAMP_CAST_ALPHA = 0.18;

/** Whether a piece takes a lantern. */
export const isLampPiece = (f: { kind: string }): boolean => !!furnitureDef(f.kind).lamp;
/** Whether it has its lantern in and a candle burning in it. */
export const lampBurning = (f: PlacedFurniture): boolean => isLampPiece(f) && !!f.lamp && !!f.lit && (f.fuel ?? 0) > 0;
/** How far its lantern throws, in tiles; nought with none fitted. */
export const lampReach = (f: PlacedFurniture): number => (f.lamp ? lanternReach(f.lamp.ql) : 0);

/** Where its light falls from, in the world: under the lantern on its arm, or the middle of a pillar. */
export function lampAt(f: PlacedFurniture): [number, number] {
  const [cx, cy] = furnitureCentre(f);
  if (furnitureDef(f.kind).lamp !== 'arm') return [cx, cy];
  const out: Record<string, [number, number]> = { s: [0, 1], e: [1, 0], n: [0, -1], w: [-1, 0] };
  const [dx, dy] = out[facingOf(f)];
  return [cx + (dx * LAMP_ARM) / UNITS_PER_TILE, cy + (dy * LAMP_ARM) / UNITS_PER_TILE];
}

/** Its light, as the renderer cuts it out of the night and the eye reaches further inside it. */
export const lampLight = (f: PlacedFurniture): LightSource => {
  const [x, y] = lampAt(f);
  return { x, y, radius: lampReach(f), strength: LAMP_STRENGTH, steady: true, cast: LAMP_CAST, castAlpha: LAMP_CAST_ALPHA };
};

/**
 * The lantern on a piece as a ground read sends it, in `state -> lamp`: its
 * quality, and its rarity, damage and maker where it has them. Nothing when
 * there is none, so a piece without one carries no key.
 */
export function lampFrom(state: unknown): { lamp?: Lamp } {
  const l = (state as { lamp?: { ql?: unknown; dmg?: unknown; rare?: unknown; maker?: unknown } } | null)?.lamp;
  if (!l || typeof l.ql !== 'number') return {};
  const lamp: Lamp = { ql: l.ql };
  if (typeof l.dmg === 'number' && l.dmg > 0) lamp.dmg = l.dmg;
  const rare = typeof l.rare === 'string' ? rarityStep(l.rare) : undefined;
  if (rare) lamp.rare = rare;
  if (typeof l.maker === 'string' && l.maker) lamp.maker = l.maker;
  return { lamp };
}

/** What the piece is called in a sentence: its kind, whatever it has been named. */
const pieceWord = (f: PlacedFurniture): string => furnitureDef(f.kind).name.toLowerCase();

/** How it reads in its menu: no lantern, or the lantern, what it throws, and its candle. */
export function lampState(f: PlacedFurniture): string {
  if (!f.lamp) return 'no lantern in it';
  const left = Math.max(0, f.fuel ?? 0);
  const which = `QL ${f.lamp.ql.toFixed(0)} lantern, throws ${lampReach(f)} tiles`;
  if (left <= 0) return `${which} · no candle in it`;
  return f.lit ? `${which} · lit, ${timeWords(left)} of candle left` : `${which} · ${timeWords(left)} of candle in it, unlit`;
}

/** Too far from the piece to work it: how far, off the reach every store and piece is worked from. */
export const lampTooFar = (word: string): string => `Stand within ${STORE_REACH} tiles of the ${word}.`;
/** Said when there is no lantern in the pack to fit. */
export const LAMP_NO_LANTERN = 'You have no lantern to fit.';
/** When the piece already has its lantern. */
export const LAMP_HAS_ONE = 'There is a lantern in it already. Take it down first.';
/** When there is nothing to take down, light or put a candle in. */
export const LAMP_NONE = 'There is no lantern in it. Fit one first.';
/** What stops a piece with a lantern in it being lifted. */
export { LAMP_TAKE_FIRST };
/** No candle in the pack, and no flame to strike a light from: the carried lantern's own sentences, off the candle's recipe and what `flameNear` takes a light off. */
export { noCandleLine, noFlameLine };
/** Setting a post down, or turning it, with its arm into a wall. */
export const LAMP_INTO_WALL = 'The arm would go into the wall: turn it the other way.';
/** And planning or raising a wall across a standing post's arm. */
export const LAMP_ARM_CROSSES = "A lantern post's arm crosses this border: turn the post first.";

/**
 * Whether a post set at subtile (sx, sy) of tile (x, y) and facing this way
 * reaches its arm and lantern across the border on that side: the lantern's
 * far side passes where the face of a wall on it would be. A pillar's lantern
 * is over its middle and reaches nowhere. The island's `lamp_arm_passes`.
 */
export function lampArmPasses(kind: string, x: number, y: number, sx: number, sy: number, facing: Side): boolean {
  if (furnitureDef(kind).lamp !== 'arm') return false;
  const [w, h] = furnitureFootprint(kind, facing);
  const cx = x + (sx + w / 2) / SUBTILES, cy = y + (sy + h / 2) / SUBTILES;
  const reach = LAMP_ARM_REACH;
  return facing === 'n' ? cy - reach < y + WALL_THICK
    : facing === 's' ? cy + reach > y + 1 - WALL_THICK
      : facing === 'w' ? cx - reach < x + WALL_THICK
        : cx + reach > x + 1 - WALL_THICK;
}

/**
 * Why a post will not stand facing this way here, or null: its arm and the
 * lantern on it would go into a wall on the border it reaches toward. A
 * waist-high wall or a fence stays under the arm. The island asks the same
 * (`lamp_arm_refusal`).
 */
export function lampArmRefusal(g: Game, kind: string, x: number, y: number, sx: number, sy: number, facing: Side): string | null {
  if (!lampArmPasses(kind, x, y, sx, sy, facing)) return null;
  const wall = g.buildings.wall(0, x, y, facing);
  return wall && !isLowWall(wall.type) ? LAMP_INTO_WALL : null;
}

const STEP: Record<Side, [number, number]> = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };
const BACK: Record<Side, Side> = { n: 's', s: 'n', w: 'e', e: 'w' };

/**
 * Why a full-height wall will not be planned or raised on this side of this
 * tile, or null: a lantern post standing on either tile beside the border
 * reaches its arm across it, and the wall would close over the arm and the
 * lantern on it. The other half of `lampArmRefusal`, which keeps a post from
 * being set down into a wall already there. The island asks the same
 * (`lamp_wall_refusal`).
 */
export function lampWallRefusal(g: Game, level: number, x: number, y: number, side: Side, type: WallType): string | null {
  if (level !== 0 || isLowWall(type)) return null;
  const [dx, dy] = STEP[side];
  for (const [tx, ty, facing] of [[x, y, side], [x + dx, y + dy, BACK[side]]] as Array<[number, number, Side]>) {
    for (const f of g.furniture.values()) {
      if (f.x === tx && f.y === ty && facingOf(f) === facing && lampArmPasses(f.kind, f.x, f.y, f.sx, f.sy, facing)) return LAMP_ARM_CROSSES;
    }
  }
  return null;
}

/**
 * Which way a piece faces after a quarter turn to the right: a post goes on
 * round past any facing that would put its arm into a wall, rather than
 * refusing the turn -- refused, a post with a wall on its right could never
 * be turned again. The island turns it the same (`lamp_turns_to`).
 */
export function lampTurnsTo(g: Game, f: PlacedFurniture): Side {
  let facing = turnedFacing(facingOf(f), 1);
  for (let i = 0; i < 3 && lampArmRefusal(g, f.kind, f.x, f.y, f.sx, f.sy, facing); i++) facing = turnedFacing(facing, 1);
  return facing;
}

type PieceTarget = Extract<Target, { kind: 'furniture' }>;
const lampPiece = (g: Game, t: Target): PlacedFurniture | undefined => {
  if (t.kind !== 'furniture') return undefined;
  const f = g.furniture.get((t as PieceTarget).id);
  return f && isLampPiece(f) ? f : undefined;
};

/** The lantern a fitting takes: the one the ask names, or the best in the pack. A locked one never goes. */
export function lanternToFit(g: Game, t: Target): Item | undefined {
  const named = t.kind === 'furniture' && t.itemUid !== undefined ? g.inventory.get(t.itemUid) : undefined;
  if (t.kind === 'furniture' && t.itemUid !== undefined) return named && named.id === 'lantern' && !named.locked ? named : undefined;
  return g.inventory.items.filter((it) => it.id === 'lantern' && !it.locked).sort((a, b) => b.ql - a.ql || a.uid - b.uid)[0];
}

/**
 * Why a lamp action cannot be done now, or null. One function for the five,
 * because they ask the same first questions -- is it there, are you at it,
 * and for all but lighting it, is it padlocked against you -- and the island
 * asks the same five in the same order and the same words (`lamp_refusal`).
 *
 * A padlock keeps the lantern on its post: fitting one, taking it down,
 * putting a candle in and putting it out are the key's. Striking a light in
 * somebody's lantern is anybody's, as a lamp in a street is lit by whoever
 * passes with a flame.
 */
export function lampRefusal(g: Game, id: string, t: Target): string | null {
  const f = lampPiece(g, t);
  if (!f) return 'It is gone.';
  if (!g.besidePiece(f)) return lampTooFar(pieceWord(f));
  if (id !== 'light_lamp') {
    const shut = g.lockRefusal(f);
    if (shut) return shut;
  }
  switch (id) {
    case 'fit_lamp':
      if (f.lamp) return LAMP_HAS_ONE;
      return lanternToFit(g, t) ? null : LAMP_NO_LANTERN;
    case 'take_lamp':
      return f.lamp ? null : LAMP_NONE;
    case 'candle_lamp':
      if (!f.lamp) return LAMP_NONE;
      if ((f.fuel ?? 0) > 0) return 'There is still a candle in it.';
      return g.inventory.find('candle') ? null : noCandleLine();
    case 'light_lamp':
      if (!f.lamp) return LAMP_NONE;
      if ((f.fuel ?? 0) <= 0) return 'There is no candle in it.';
      if (f.lit) return 'It is already lit.';
      return flameNear(g) ? null : noFlameLine();
    case 'douse_lamp':
      return f.lamp && f.lit && (f.fuel ?? 0) > 0 ? null : 'It is not lit.';
  }
  return null;
}

/** The lantern on it, in a sentence. */
const lanternOn = (f: PlacedFurniture): string => `the lantern on the ${pieceWord(f)}`;
/**
 * What each of the five says as it is done, and what the candle says as it
 * gutters: the same sentences on the island, off the same numbers.
 */
export const LAMP_SAYS = {
  fit: (f: PlacedFurniture): string => `You fit the lantern to the ${pieceWord(f)}. It throws ${lampReach(f)} tiles, and has `
    + ((f.fuel ?? 0) > 0 ? `${timeWords(f.fuel ?? 0)} of candle in it${f.lit ? ', alight' : ''}.` : 'no candle in it.'),
  take: (f: PlacedFurniture): string => `You take the lantern down off the ${pieceWord(f)}.`,
  candle: (f: PlacedFurniture): string => `You set a candle in ${lanternOn(f)}. It will burn ${timeWords(f.fuel ?? 0)}.`,
  light: (f: PlacedFurniture, from: string): string => `You take a light off the ${from} and ${lanternOn(f)} throws it ${lampReach(f)} tiles.`,
  douse: (f: PlacedFurniture): string => `You pinch the wick out. ${timeWords(Math.max(0, f.fuel ?? 0))} of candle saved.`,
  gutter: (f: PlacedFurniture): string => `The candle gutters out and ${lanternOn(f)} goes dark.`,
};

/**
 * The candle in every lit lantern post burns down, a second of it a second,
 * and one that runs out goes dark. On an island the island's `placed_fuel`
 * is the word and this only draws it forward between one answer and the
 * next, so it says nothing there.
 */
export function burnLamps(g: Game, dt: number, say: boolean): void {
  for (const f of g.furniture.values()) {
    if (!f.lit || !isLampPiece(f)) continue;
    f.fuel = Math.max(0, (f.fuel ?? 0) - dt);
    if (f.fuel > 0) continue;
    f.lit = false;
    if (say) g.logMsg(LAMP_SAYS.gutter(f), 'event');
    g.events.emit('world', f.x, f.y);
  }
}

/** The five, each a moment's work at the piece, and none of them teaching anything. */
const lampJob = (id: string, label: string, verb: string): Pick<ActionDef, 'id' | 'label' | 'verb' | 'stamina' | 'baseTime'> =>
  ({ id, label, verb, stamina: 0, baseTime: 1 });

export const LAMP_ACTIONS: ActionDef[] = [
  {
    ...lampJob('fit_lamp', 'Fit a lantern', 'fitting a lantern'),
    labelFor: (t, g) => (furnitureDef(lampPiece(g, t)?.kind ?? '').lamp === 'arm' ? 'Hang a lantern on it' : 'Set a lantern in it'),
    applies: (t, g) => {
      const f = lampPiece(g, t);
      return !!f && !f.lamp;
    },
    check: (t, g) => lampRefusal(g, 'fit_lamp', t),
    perform: (t, g) => {
      const f = lampPiece(g, t);
      const it = lanternToFit(g, t);
      if (!f || !it || lampRefusal(g, 'fit_lamp', t)) return;
      const left = candleLeft(it);
      const burning = !!it.lit && left > 0;
      if (!g.inventory.remove(it.uid, 1)) return;
      f.lamp = { ql: it.ql, ...(it.dmg ? { dmg: it.dmg } : {}), ...(it.rare ? { rare: it.rare } : {}), ...(it.maker ? { maker: it.maker } : {}) };
      f.fuel = left;
      f.lit = burning;
      g.logMsg(LAMP_SAYS.fit(f), 'event');
      g.events.emit('world', f.x, f.y);
    },
  },
  {
    ...lampJob('take_lamp', 'Take the lantern down', 'taking the lantern down'),
    applies: (t, g) => !!lampPiece(g, t)?.lamp,
    check: (t, g) => lampRefusal(g, 'take_lamp', t),
    perform: (t, g) => {
      const f = lampPiece(g, t);
      if (!f?.lamp || lampRefusal(g, 'take_lamp', t)) return;
      const left = Math.max(0, Math.round(f.fuel ?? 0));
      const back = g.inventory.add('lantern', { ql: f.lamp.ql, rare: f.lamp.rare, maker: f.lamp.maker });
      if (f.lamp.dmg) back.dmg = f.lamp.dmg;
      back.charges = left;
      back.lit = !!f.lit && left > 0;
      delete f.lamp;
      f.fuel = 0;
      f.lit = false;
      g.logMsg(LAMP_SAYS.take(f), 'event');
      g.events.emit('inventory');
      g.events.emit('world', f.x, f.y);
    },
  },
  {
    ...lampJob('candle_lamp', 'Put a candle in', 'setting a candle'),
    applies: (t, g) => !!lampPiece(g, t)?.lamp,
    check: (t, g) => lampRefusal(g, 'candle_lamp', t),
    perform: (t, g) => {
      const f = lampPiece(g, t);
      const candle = g.inventory.find('candle');
      if (!f?.lamp || !candle || lampRefusal(g, 'candle_lamp', t) || !g.inventory.remove(candle.uid, 1)) return;
      f.fuel = Math.round(candleBurn(f.lamp.ql));
      g.logMsg(LAMP_SAYS.candle(f), 'event');
      g.events.emit('world', f.x, f.y);
    },
  },
  {
    ...lampJob('light_lamp', 'Strike a light', 'lighting the lantern'),
    applies: (t, g) => {
      const f = lampPiece(g, t);
      return !!f?.lamp && !f.lit;
    },
    check: (t, g) => lampRefusal(g, 'light_lamp', t),
    perform: (t, g) => {
      const f = lampPiece(g, t);
      if (!f?.lamp || lampRefusal(g, 'light_lamp', t)) return;
      const from = flameNear(g) ?? 'fire';
      f.lit = true;
      g.logMsg(LAMP_SAYS.light(f, from), 'event');
      g.events.emit('world', f.x, f.y);
    },
  },
  {
    ...lampJob('douse_lamp', 'Put it out', 'putting the lantern out'),
    applies: (t, g) => !!lampPiece(g, t)?.lit,
    check: (t, g) => lampRefusal(g, 'douse_lamp', t),
    perform: (t, g) => {
      const f = lampPiece(g, t);
      if (!f?.lamp || lampRefusal(g, 'douse_lamp', t)) return;
      f.lit = false;
      g.logMsg(LAMP_SAYS.douse(f), 'event');
      g.events.emit('world', f.x, f.y);
    },
  },
];
