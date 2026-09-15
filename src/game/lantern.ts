import type { ActionDef, Target } from './actions';
import type { Game } from './game';
import { itemDef, itemName, type Item } from './items';
import { candleBurn, heldReach, HELD_LIGHTS, torchBurn } from './light';

/**
 * A light you carry: a lantern with a candle in it, or a torch.
 *
 * A candle has always been makeable and has never done anything; its own
 * description promised a lantern that was not in the game. Here it is. Put a
 * candle in, strike it, and it burns down while it is lit and only while it is
 * lit — carrying a dark lantern costs you nothing but the weight of it.
 *
 * ## The tinderbox that was never in the game
 *
 * Striking a lantern used to want a tinderbox, and there is no tinderbox: not
 * in `ITEM_DEFS`, not in any recipe, nowhere but that one check and a line of
 * help promising it. Which meant the lantern could not be lit, by anybody,
 * ever — a whole subsystem with no way in.
 *
 * It is lit at a fire now, or off something already burning in your own hands.
 * That is a better rule than the tinderbox would have been: it gives the
 * campfire a second job, and it means the first thing you do on a dark island
 * is get something burning.
 */

/** A light of any kind in the pack, by the target it was asked about. */
const lightOf = (g: Game, t: Target): Item | undefined => {
  if (t.kind !== 'item') return undefined;
  const it = g.inventory.get(t.uid);
  return it && (HELD_LIGHTS as readonly string[]).includes(it.id) ? it : undefined;
};

/** Seconds of burning left in it. */
export const candleLeft = (it: Item): number => Math.max(0, it.charges ?? 0);

/** How it reads: dark, lit with so long left, or spent. */
export function lanternState(it: Item): string {
  const left = candleLeft(it);
  if (it.id === 'torch') {
    if (it.lit) return `alight, ${Math.ceil(left / 60)}m left`;
    return left > 0 ? `guttered out, ${Math.ceil(left / 60)}m left in it` : 'unlit';
  }
  if (!left) return 'no candle in it';
  const mins = Math.ceil(left / 60);
  return it.lit ? `lit, ${mins}m of candle left` : `${mins}m of candle in it, unlit`;
}

/**
 * Something to light it from: a fire you are standing at, or a light already
 * burning in your own hand. Returns what it was, for the message.
 */
export function flameNear(g: Game, except?: Item): string | null {
  const alight = g.inventory.items.find((o) => o !== except && o.lit && (o.charges ?? 0) > 0 && (HELD_LIGHTS as readonly string[]).includes(o.id));
  if (alight) return itemName(alight).toLowerCase();
  const near = (x: number, y: number): boolean => Math.hypot(x + 0.5 - g.player.x, y + 0.5 - g.player.y) <= 2.6;
  for (const f of g.campfires.values()) if (f.lit && near(f.x, f.y)) return 'campfire';
  for (const s of g.smelters.values()) if (s.lit && near(s.x, s.y)) return 'smelter';
  for (const k of g.kilns.values()) if (k.lit && near(k.x, k.y)) return 'kiln';
  for (const f of g.furniture.values()) if (f.lit && near(f.x, f.y)) return 'oven';
  return null;
}

export const LANTERN_ACTIONS: ActionDef[] = [
  {
    id: 'candle_lantern',
    label: 'Put a candle in',
    verb: 'setting a candle',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => lightOf(g, t)?.id === 'lantern',
    check: (t, g) => {
      const it = lightOf(g, t);
      if (!it) return 'It is gone.';
      if (it.id !== 'lantern') return 'Nothing goes in a torch.';
      if (candleLeft(it) > 0) return 'There is still a candle in it.';
      if (!g.inventory.has('candle')) return 'You have no candles. Two are drawn from two beeswax and a yarn.';
      return null;
    },
    perform: (t, g) => {
      const it = lightOf(g, t);
      const candle = g.inventory.find('candle');
      if (!it || !candle) return;
      g.inventory.remove(candle.uid, 1);
      it.charges = Math.round(candleBurn(it.ql));
      g.logMsg(`You set a candle in the lantern. ${Math.ceil(it.charges / 60)} minutes of it, at a guess.`, 'event');
      g.events.emit('inventory');
    },
  },
  {
    id: 'light_lantern',
    label: 'Strike a light',
    verb: 'striking a light',
    instant: true,
    stamina: 0,
    baseTime: 0,
    labelFor: (t, g) => (lightOf(g, t)?.id === 'torch' ? 'Light it' : 'Strike a light'),
    applies: (t, g) => {
      const it = lightOf(g, t);
      return !!it && !it.lit;
    },
    check: (t, g) => {
      const it = lightOf(g, t);
      if (!it) return 'It is gone.';
      if (it.id === 'lantern' && !candleLeft(it)) return 'There is no candle in it.';
      if (!flameNear(g, it)) {
        return 'Nothing here is burning. Light it at a campfire, a kiln, a smelter or an oven — or off something already alight in your hand.';
      }
      return null;
    },
    perform: (t, g) => {
      const it = lightOf(g, t);
      if (!it) return;
      const from = flameNear(g, it);
      if (!from) return;
      // A torch is wound and then lit; the pitch in it only starts burning at
      // the moment it catches, so the clock starts here rather than at the bench.
      if (it.id === 'torch' && candleLeft(it) <= 0) it.charges = Math.round(torchBurn(it.ql));
      it.lit = true;
      g.logMsg(
        it.id === 'torch'
          ? `You touch the torch to the ${from} and it takes. ${Math.ceil(candleLeft(it) / 60)} minutes of it, throwing ${heldReach(it.id, it.ql)} tiles.`
          : `You take a light off the ${from} and the lantern throws it ${heldReach(it.id, it.ql)} tiles.`,
        'event',
      );
      g.events.emit('inventory');
    },
  },
  {
    id: 'douse_lantern',
    label: 'Put it out',
    verb: 'putting it out',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => {
      const it = lightOf(g, t);
      return !!it && !!it.lit;
    },
    perform: (t, g) => {
      const it = lightOf(g, t);
      if (!it) return;
      it.lit = false;
      g.logMsg(
        it.id === 'torch'
          ? `You smother the torch. ${Math.ceil(candleLeft(it) / 60)} minutes of it left, if it will take again.`
          : `You pinch the wick out. ${Math.ceil(candleLeft(it) / 60)} minutes of candle saved.`,
        'event',
      );
      g.events.emit('inventory');
    },
  },
];

export const LANTERN_ACTION_BY_ID = new Map(LANTERN_ACTIONS.map((a) => [a.id, a]));
export { itemDef };
