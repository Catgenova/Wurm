import type { ActionDef, Target } from './actions';
import { creatureLevel, isBaitFor, SPECIES, STANCE_NAMES, type Creature, type Stance } from './creatures';
import type { Game } from './game';
import { itemDef, itemName } from './items';

type CreatureTarget = Extract<Target, { kind: 'creature' }>;
const isCreature = (t: Target): t is CreatureTarget => t.kind === 'creature';
const creatureOf = (g: Game, t: Target): Creature | undefined => (isCreature(t) ? g.creatures.get(t.id) : undefined);

/** The first item in the inventory that a species will eat; a specific one when asked for. */
function bait(g: Game, c: Creature, uid?: number) {
  const def = SPECIES[c.species];
  if (uid !== undefined) {
    const it = g.inventory.get(uid);
    return it && isBaitFor(def, it.id) ? it : undefined;
  }
  return g.inventory.items.find((it) => isBaitFor(def, it.id));
}

const dietText = (c: Creature): string => {
  const names = SPECIES[c.species].diet.map((id) => itemDef(id).name.toLowerCase());
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
};

function nearPlayer(g: Game, c: Creature): boolean {
  return Math.hypot(c.x - g.player.x, c.y - g.player.y) <= 1.9;
}

export const CREATURE_ACTIONS: ActionDef[] = [
  {
    id: 'examine_creature',
    label: 'Examine',
    verb: 'examining',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t) => isCreature(t),
    perform: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return;
      const def = SPECIES[c.species];
      if (c.mode === 'wild') {
        g.logMsg(`A wild ${def.name.toLowerCase()}: ${def.description} It eats ${dietText(c)}. You would have to tame it to learn more.`, 'event');
        return;
      }
      const mood = c.hunger < 0.3 ? 'It looks hungry.' : c.hunger < 0.6 ? 'It could eat.' : 'It looks well fed.';
      const skills = Object.entries(c.skills).map(([id, v]) => `${id} ${v.toFixed(1)}`).join(', ');
      g.logMsg(`${c.name} (${def.name}, ${g.creatures.describe(c)}): ${def.description} Level ${creatureLevel(c)}, ${skills}. Health ${Math.ceil(c.health)}/${def.health}. ${mood} It eats ${dietText(c)}.`, 'event');
    },
  },
  {
    id: 'tame',
    label: 'Tame',
    verb: 'coaxing it closer',
    skill: 'taming',
    stamina: 0.03,
    baseTime: 3.5,
    applies: (t, g) => creatureOf(g, t)?.mode === 'wild',
    check: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return 'It is gone.';
      const def = SPECIES[c.species];
      if (g.skills.get('taming') < def.tameLevel) return `You need taming ${def.tameLevel} to try.`;
      if (!bait(g, c)) return `${def.name}s take ${dietText(c)}. Bring some.`;
      if (g.creatures.active() && !g.deed) return 'You already have a companion and no settlement to keep another.';
      return null;
    },
    perform: (t, g) => {
      const c = creatureOf(g, t);
      if (!c || c.mode !== 'wild') return;
      const def = SPECIES[c.species];
      if (!nearPlayer(g, c)) {
        g.logMsg(`The ${def.name.toLowerCase()} hopped off before it noticed your offering.`, 'event');
        return;
      }
      const food = bait(g, c);
      if (!food) return;
      const foodName = itemDef(food.id).name.toLowerCase();
      g.inventory.remove(food.uid, 1);
      const skill = g.skills.get('taming');
      const chance = Math.min(0.95, def.tameChance + (skill - def.tameLevel) / 200 + (c.hunger < 0.5 ? 0.1 : 0));
      c.hunger = Math.min(1, c.hunger + 0.25);
      if (g.rand() < chance) {
        c.name = def.name;
        c.enemy = null;
        c.attackedBy = null;
        if (g.creatures.active()) {
          c.mode = 'stored';
          g.logMsg(`The ${def.name.toLowerCase()} takes the ${foodName} from your hand and trusts you. As you already travel with a companion, it is kept at the token of ${g.deed?.name ?? 'your settlement'}.`, 'system');
        } else {
          c.mode = 'active';
          c.stance = 'defensive';
          g.logMsg(`The ${def.name.toLowerCase()} takes the ${foodName} from your hand and trusts you. ${c.name} now follows you.`, 'system');
        }
        g.gainSkill('taming', 0.7);
      } else {
        g.logMsg(`The ${def.name.toLowerCase()} nibbles the ${foodName}, twitches its nose, and hops off unconvinced.`, 'event');
        g.gainSkill('taming', 0.35);
        c.state = 'idle';
        c.until = g.time;
      }
    },
  },
  {
    id: 'feed',
    label: 'Feed',
    verb: 'feeding',
    stamina: 0,
    baseTime: 1.5,
    applies: (t, g) => {
      const c = creatureOf(g, t);
      return !!c && (c.mode === 'active' || c.mode === 'deed');
    },
    check: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return 'It is gone.';
      return bait(g, c, isCreature(t) ? t.itemUid : undefined) ? null : `It eats ${dietText(c)}.`;
    },
    perform: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return;
      const food = bait(g, c, isCreature(t) ? t.itemUid : undefined);
      if (!food || !nearPlayer(g, c)) return;
      g.inventory.remove(food.uid, 1);
      c.hunger = Math.min(1, c.hunger + 0.5);
      g.logMsg(`${c.name} gobbles up the ${itemDef(food.id).name.toLowerCase()}.`, 'event');
    },
  },
  {
    id: 'set_stance',
    label: 'Stance',
    verb: 'instructing',
    instant: true,
    hidden: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => creatureOf(g, t)?.mode === 'active',
    perform: (t, g) => {
      const c = creatureOf(g, t);
      if (!c || !isCreature(t) || !t.stance) return;
      c.stance = t.stance;
      c.enemy = null;
      g.logMsg(`${c.name} will be ${STANCE_NAMES[t.stance].toLowerCase()}.`, 'info');
    },
  },
  {
    id: 'assign_deed',
    label: 'Assign to deed',
    verb: 'assigning',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => {
      const c = creatureOf(g, t);
      return !!c && (c.mode === 'active' || c.mode === 'stored');
    },
    check: (_t, g) => (g.deed ? null : 'You have no settlement to assign it to.'),
    perform: (t, g) => {
      const c = creatureOf(g, t);
      const d = g.deed;
      if (!c || !d) return;
      if (c.mode === 'stored') {
        c.x = d.x + 0.5;
        c.y = d.y + 1.5;
      }
      c.mode = 'deed';
      c.enemy = null;
      c.state = 'idle';
      c.until = g.time;
      const job = SPECIES[c.species].forages ? 'forage around the settlement and bring what it finds to the crate' : 'stay around the settlement';
      g.logMsg(`${c.name} will ${job}.`, 'system');
    },
  },
  {
    id: 'take_creature',
    label: 'Take with you',
    verb: 'calling',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => {
      const c = creatureOf(g, t);
      return !!c && (c.mode === 'deed' || c.mode === 'stored');
    },
    check: (_t, g) => (g.creatures.active() && !g.deed ? 'Nowhere to keep your current companion.' : null),
    perform: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return;
      const current = g.creatures.active();
      if (current) {
        current.mode = 'stored';
        g.logMsg(`${current.name} stays at the token for now.`, 'info');
      }
      if (c.mode === 'stored') {
        c.x = g.player.x;
        c.y = g.player.y;
      }
      c.mode = 'active';
      c.carrying = null;
      c.enemy = null;
      c.state = 'idle';
      g.logMsg(`${c.name} now follows you.`, 'system');
    },
  },
  {
    id: 'store_creature',
    label: 'Keep at token',
    verb: 'sending it home',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => {
      const c = creatureOf(g, t);
      return !!c && (c.mode === 'active' || c.mode === 'deed');
    },
    check: (_t, g) => (g.deed ? null : 'You have no settlement token to keep it at.'),
    perform: (t, g) => {
      const c = creatureOf(g, t);
      if (!c || !g.deed) return;
      if (c.carrying) g.crateAdd(c.carrying);
      c.carrying = null;
      c.mode = 'stored';
      c.enemy = null;
      g.logMsg(`${c.name} is kept at the token of ${g.deed.name}.`, 'system');
    },
  },
  {
    id: 'rename_creature',
    label: 'Rename',
    verb: 'renaming',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => {
      const c = creatureOf(g, t);
      return !!c && c.mode !== 'wild';
    },
    perform: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return;
      const name = g.hooks.prompt('Name it', c.name);
      if (name === null || !name.trim()) return;
      c.name = name.trim().slice(0, 24);
      g.logMsg(`It answers to ${c.name} now.`, 'info');
    },
  },
  {
    id: 'release_creature',
    label: 'Release',
    verb: 'releasing',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => {
      const c = creatureOf(g, t);
      return !!c && c.mode !== 'wild';
    },
    perform: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return;
      if (!g.hooks.confirm(`Release ${c.name} back into the wild?`)) return;
      if (c.mode === 'stored' && g.deed) {
        c.x = g.deed.x + 0.5;
        c.y = g.deed.y + 1.5;
      }
      if (c.carrying) g.dropOnGround(Math.floor(c.x), Math.floor(c.y), c.carrying);
      c.carrying = null;
      c.mode = 'wild';
      c.stance = 'passive';
      c.enemy = null;
      c.name = SPECIES[c.species].name;
      g.logMsg(`The ${c.name.toLowerCase()} bounds off into the wild.`, 'system');
    },
  },
  {
    id: 'crate_take_all',
    label: 'Take everything from the crate',
    verb: 'emptying the crate',
    stamina: 0.01,
    baseTime: 1,
    applies: (t, g) => t.kind === 'tile' && !!g.crate && g.crate.x === t.x && g.crate.y === t.y,
    check: (_t, g) => (g.crate && g.crate.items.length ? null : 'The crate is empty.'),
    perform: (_t, g) => {
      const crate = g.crate;
      if (!crate || !crate.items.length) return;
      const items = crate.items.splice(0, crate.items.length);
      for (const it of items) g.inventory.addItem(it);
      g.events.emit('crate');
      const names = items.map((it) => (it.count > 1 ? `${it.count} × ${itemName(it).toLowerCase()}` : itemName(it).toLowerCase()));
      g.logMsg(`You take ${names.join(', ')} from the crate.`, 'event');
    },
  },
  {
    id: 'store_in_crate',
    label: 'Put in deed crate',
    verb: 'stowing',
    instant: true,
    quantity: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => t.kind === 'item' && !!g.crate,
    check: (_t, g) => (g.crate && Math.hypot(g.crate.x + 0.5 - g.player.x, g.crate.y + 0.5 - g.player.y) <= 2.2 ? null : 'Stand next to the deed crate.'),
    perform: (t, g) => {
      if (t.kind !== 'item') return;
      const item = g.inventory.take(t.uid, t.count ?? 1);
      if (!item) return;
      g.crateAdd(item);
      g.logMsg(`You put ${item.count > 1 ? `${item.count} × ` : 'the '}${itemName(item).toLowerCase()} in the crate.`, 'event');
    },
  },
];

export const CREATURE_ACTION_BY_ID = new Map(CREATURE_ACTIONS.map((a) => [a.id, a]));
export type { Stance };
