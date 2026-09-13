import type { ActionDef, Target } from './actions';
import { SPECIES, type Creature } from './creatures';
import type { Game } from './game';
import { itemName } from './items';

/**
 * First aid. A wound closes on its own eventually, but a clean dressing is
 * the difference between carrying on and lying down. Bandages are cut from
 * cloth; binding a wound with one is a skill, and the same hands will do as
 * much for a hurt wildermon as for their owner.
 */

/** Fraction of a life a single dressing puts back, by the hand and the cloth. */
export const healAmount = (skill: number, ql: number): number => 0.06 + (skill / 100) * 0.24 + (ql / 100) * 0.1;

/** The soundest bandage carried: the good cloth is what you want on a wound. */
const bestBandage = (g: Game) =>
  g.inventory.items.filter((it) => it.id === 'bandage').sort((a, b) => b.ql - a.ql)[0];

const creatureOf = (g: Game, t: Target): Creature | undefined => (t.kind === 'creature' ? g.creatures.get(t.id) : undefined);

export const FIRST_AID_ACTIONS: ActionDef[] = [
  {
    id: 'bind_wound',
    label: 'Bind your wounds',
    verb: 'binding a wound',
    skill: 'first_aid',
    stamina: 0.02,
    baseTime: 7,
    repeat: true,
    applies: (t, g) => t.kind === 'item' && g.inventory.get(t.uid)?.id === 'bandage',
    check: (t, g) => {
      if (t.kind !== 'item') return null;
      if (g.inventory.get(t.uid)?.id !== 'bandage') return 'That is not a bandage.';
      if (g.player.stats.health >= 0.999) return 'There is nothing wrong with you.';
      return null;
    },
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.get(t.uid);
      if (!item || item.id !== 'bandage') return;
      const ql = item.ql;
      if (!g.inventory.remove(item.uid, 1)) return;
      const clean = g.skillCheck('first_aid', 10, ql, g.mindEase());
      const healed = healAmount(g.skills.get('first_aid'), ql) * (clean ? 1 : 0.35);
      const before = g.player.stats.health;
      g.player.stats.health = Math.min(1, before + healed);
      const pct = Math.round(g.player.stats.health * 100);
      g.logMsg(
        clean
          ? `You clean the wound and bind it. You are at ${pct} of a hundred.`
          : `The dressing slips and you make a poor job of it. You are at ${pct} of a hundred.`,
        'event',
      );
      // Keep going while there is a wound left and cloth to put on it.
      return g.player.stats.health < 0.999 && bestBandage(g) !== undefined;
    },
  },
  {
    id: 'treat_creature',
    label: 'Treat its wounds',
    verb: 'dressing a wound',
    skill: 'first_aid',
    stamina: 0.03,
    baseTime: 9,
    applies: (t, g) => {
      const c = creatureOf(g, t);
      return !!c && c.mode !== 'wild' && c.health < SPECIES[c.species].health;
    },
    check: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return 'It is gone.';
      if (c.mode === 'wild') return 'It will not stand still for you while it is wild.';
      if (c.health >= SPECIES[c.species].health) return `${c.name} is not hurt.`;
      if (!bestBandage(g)) return 'You have no bandages. Cut some from cloth.';
      if (Math.hypot(c.x - g.player.x, c.y - g.player.y) > 1.9) return 'You need to be beside it.';
      return null;
    },
    perform: (t, g) => {
      const c = creatureOf(g, t);
      const bandage = bestBandage(g);
      if (!c || !bandage) return;
      const def = SPECIES[c.species];
      const ql = bandage.ql;
      if (!g.inventory.remove(bandage.uid, 1)) return;
      const clean = g.skillCheck('first_aid', 14, ql, g.mindEase());
      const healed = def.health * healAmount(g.skills.get('first_aid'), ql) * (clean ? 1 : 0.35);
      c.health = Math.min(def.health, c.health + healed);
      g.logMsg(
        clean
          ? `You dress ${c.name}'s wounds with the ${itemName(bandage).toLowerCase()}. It is up to ${Math.ceil(c.health)} of ${def.health}.`
          : `${c.name} will not hold still and the dressing goes on badly. It is up to ${Math.ceil(c.health)} of ${def.health}.`,
        'event',
      );
    },
  },
];

export const FIRST_AID_ACTION_BY_ID = new Map(FIRST_AID_ACTIONS.map((a) => [a.id, a]));
