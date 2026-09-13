import type { ActionDef, Target } from './actions';
import { creatureLevel, GATHER_DO, isBaitFor, SPECIES, STANCE_NAMES, workRangeOf, type Creature, type Stance } from './creatures';
import type { Game } from './game';
import { itemDef } from './items';

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

/** "a berry or vegetable" for a Rabba, "a spice or vegetable" for a Vola. */
export const baitHint = (c: Creature): string => SPECIES[c.species].baitHint;

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
      const range = c.mode === 'deed' && def.gathers ? ` It works up to ${workRangeOf(c, def)} tiles from the token.` : '';
      g.logMsg(`${c.name} (${def.name}, ${g.creatures.describe(c)}): ${def.description} Level ${creatureLevel(c)}, ${skills}. Health ${Math.ceil(c.health)}/${def.health}.${range} ${mood} It eats ${dietText(c)}.`, 'event');
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
        g.logMsg(`The ${def.name.toLowerCase()} moved off before it noticed your offering.`, 'event');
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
        g.logMsg(`The ${def.name.toLowerCase()} ${def.tameFail.replace('{food}', foodName)}.`, 'event');
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
    check: (t, g) => {
      if (!g.deed) return 'You have no settlement to assign it to.';
      const c = creatureOf(g, t);
      const working = g.creatures.workers().length;
      if (c && c.mode !== 'deed' && working >= g.workerCap) {
        return `${g.deed.name} has work for ${g.workerCap} wildermon at level ${g.deedLevel}. Upgrade the settlement to take on more.`;
      }
      return null;
    },
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
      const gathers = SPECIES[c.species].gathers;
      const job = gathers ? `${GATHER_DO[gathers]} within ${workRangeOf(c, SPECIES[c.species])} tiles of the token and bring what it finds to the crate` : 'stay around the settlement';
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
      const crate = g.deedCrate();
      if (c.carrying && !(crate && g.crateAdd(crate, c.carrying))) g.dropOnGround(Math.floor(c.x), Math.floor(c.y), c.carrying);
      c.carrying = null;
      c.mode = 'stored';
      c.enemy = null;
      g.logMsg(`${c.name} is kept at the token of ${g.deed.name}.`, 'system');
    },
  },
  {
    id: 'attack_creature',
    label: 'Attack',
    verb: 'fighting',
    skill: 'body_strength',
    stamina: 0.07,
    baseTime: 2.5,
    repeat: true,
    applies: (t, g) => creatureOf(g, t)?.mode === 'wild',
    check: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return 'It is dead or gone.';
      if (c.mode !== 'wild') return 'That one is tame. Release it first if you mean it.';
      if (Math.hypot(c.x - g.player.x, c.y - g.player.y) > 2.2) return 'It is out of reach.';
      return null;
    },
    perform: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return;
      const def = SPECIES[c.species];
      // Bare hands bruise; an edged tool does the work properly, a sword better still.
      const weapon = ['sword', 'butchering_knife', 'hatchet', 'carving_knife'].map((id) => g.inventory.tool(id)).find(Boolean);
      const bonus = weapon ? (weapon.id === 'sword' ? 2.6 + weapon.ql / 70 : 1.5 + weapon.ql / 120) : 1;
      const dmg = (2 + g.skills.get('body_strength') / 12) * bonus * (0.7 + g.rand() * 0.6);
      const before = c.health;
      g.creatures.hurt(g, c, dmg, 'player');
      g.gainSkill('body_strength', 0.05);
      if (c.health <= 0) return false;
      // A cornered animal gets a swipe in, and a helm turns most of it aside.
      // The defensive sorts never miss their chance at one.
      if (def.defensive || g.rand() < 0.35) {
        const helm = g.inventory.tool('helm');
        const soak = helm ? Math.min(0.85, 0.45 + helm.ql / 260) : 0;
        const hurt = def.attack * 0.012 * (1 - soak);
        g.player.stats.health = Math.max(0, g.player.stats.health - hurt);
        g.player.attackedBy = c.id;
        g.player.attackedAt = g.time;
        g.logMsg(`The ${def.name.toLowerCase()} ${def.defensive ? 'comes straight back at you' : 'turns on you'}${helm ? ', though your helm takes the worst of it' : ''}.`, 'error');
      }
      g.logMsg(`You strike the ${def.name.toLowerCase()}${weapon ? ` with your ${itemDef(weapon.id).name.toLowerCase()}` : ''}. ${before > c.health ? `It is down to ${Math.max(0, Math.ceil(c.health))} of ${def.health}.` : ''}`, 'event');
      // Keep swinging while it is still within reach.
      return Math.hypot(c.x - g.player.x, c.y - g.player.y) <= 2.2;
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
      g.logMsg(`The ${c.name.toLowerCase()} ${SPECIES[c.species].leaves}.`, 'system');
    },
  },
];

export const CREATURE_ACTION_BY_ID = new Map(CREATURE_ACTIONS.map((a) => [a.id, a]));
export type { Stance };
