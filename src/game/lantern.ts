import type { ActionDef, Target } from './actions';
import type { Game } from './game';
import { itemDef, type Item } from './items';
import { candleBurn, lanternReach } from './light';

/**
 * A lantern, and the candle in it.
 *
 * A candle has always been makeable and has never done anything; its own
 * description promised a lantern that was not in the game. Here it is. Put a
 * candle in, strike it, and it burns down while it is lit and only while it is
 * lit — carrying a dark lantern costs you nothing but the weight of it.
 */
const lanternOf = (g: Game, t: Target): Item | undefined => {
  if (t.kind !== 'item') return undefined;
  const it = g.inventory.get(t.uid);
  return it?.id === 'lantern' ? it : undefined;
};

/** Seconds of candle left in it. */
export const candleLeft = (it: Item): number => Math.max(0, it.charges ?? 0);

/** How it reads: dark, lit with so long left, or empty. */
export function lanternState(it: Item): string {
  const left = candleLeft(it);
  if (!left) return 'no candle in it';
  const mins = Math.ceil(left / 60);
  return it.lit ? `lit, ${mins}m of candle left` : `${mins}m of candle in it, unlit`;
}

export const LANTERN_ACTIONS: ActionDef[] = [
  {
    id: 'candle_lantern',
    label: 'Put a candle in',
    verb: 'setting a candle',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => !!lanternOf(g, t),
    check: (t, g) => {
      const it = lanternOf(g, t);
      if (!it) return 'It is gone.';
      if (candleLeft(it) > 0) return 'There is still a candle in it.';
      if (!g.inventory.has('candle')) return 'You have no candles. Two are drawn from two beeswax and a yarn.';
      return null;
    },
    perform: (t, g) => {
      const it = lanternOf(g, t);
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
    applies: (t, g) => {
      const it = lanternOf(g, t);
      return !!it && !it.lit;
    },
    check: (t, g) => {
      const it = lanternOf(g, t);
      if (!it) return 'It is gone.';
      if (!candleLeft(it)) return 'There is no candle in it.';
      if (!g.inventory.has('tinderbox')) return 'You need a tinderbox to strike a light.';
      return null;
    },
    perform: (t, g) => {
      const it = lanternOf(g, t);
      if (!it) return;
      it.lit = true;
      g.logMsg(`The wick catches and the lantern throws its light ${lanternReach(it.ql)} tiles.`, 'event');
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
      const it = lanternOf(g, t);
      return !!it && !!it.lit;
    },
    perform: (t, g) => {
      const it = lanternOf(g, t);
      if (!it) return;
      it.lit = false;
      g.logMsg(`You pinch the wick out. ${Math.ceil(candleLeft(it) / 60)} minutes of candle saved.`, 'event');
      g.events.emit('inventory');
    },
  },
];

export const LANTERN_ACTION_BY_ID = new Map(LANTERN_ACTIONS.map((a) => [a.id, a]));
export { itemDef };
