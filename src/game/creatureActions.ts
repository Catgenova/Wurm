import { DARK_SHOT, DARK_SWING, tryGain } from './learn';
import type { ActionDef, Target } from './actions';
import { isShod, SHOES_PER_MOUNT, ageDef, attackOf, bloodMul, careWord, coaxBonus, creatureLevel, forgetCoaxing, GATHER_DO, isBaitFor, maxHealth, SEX_NAMES, SPECIES, STANCE_NAMES, workRangeOf, type Creature, type Stance, type GatherKind } from './creatures';
import { bestTier, traitList } from './traits';
import type { Game } from './game';
import { furnitureCentre, furnitureName, vehicleOf } from './furniture';
import { itemDef, itemName } from './items';
import { BANE_BONUS, banes, hitChance, isBow, WEAPON_BY_ID, weaponDamage, type WeaponDef } from './gear';
import { matOfItem } from './materials';

/**
 * What one offering and one blow teach, landed or not.
 *
 * Taming already paid less for a refusal — by a second set of numbers written
 * out beside the first. A swing and a shot paid the same either way, because
 * the gains sat above the roll.
 */
export const TAME_GAIN = 0.7;
export const TAME_NERVE = 0.4;
export const SWING_FIGHT = 0.3;
export const SWING_ARM = 0.45;
export const SWING_BODY = 0.05;
export const SHOT_FIGHT = 0.2;
export const SHOT_ARCHERY = 0.5;

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

/** "blueberries, raspberries or potatoes" — everything this one will take. */
export const dietText = (c: Creature): string => {
  const names = SPECIES[c.species].diet.map((id) => itemDef(id).name.toLowerCase());
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
};

/** "a berry or vegetable" for a Rabba, "a spice or vegetable" for a Vola. */
export const baitHint = (c: Creature): string => SPECIES[c.species].baitHint;

/**
 * The odds of winning a wild thing over with one offering, as they stand: its
 * own wariness, how far your taming is past what it asks, whether it is
 * hungry, what a run of offerings has already bought you, your soul, its age,
 * and the love path if you walk it. The tooltip and the attempt itself read
 * the same number, so what you are told is what you get.
 */
export function tameChance(g: Game, c: Creature): number {
  const def = SPECIES[c.species];
  if (!def || def.monster) return 0;
  const skill = g.skills.get('taming');
  const raw = def.tameChance + (skill - def.tameLevel) / 200 + (c.hunger < 0.5 ? 0.1 : 0) + coaxBonus(c, g.time) + g.soulBonus();
  return Math.max(0, Math.min(0.95, raw * ageDef(c, g.time).tame * (g.walks('love', 3) ? 1.25 : 1)));
}

function nearPlayer(g: Game, c: Creature): boolean {
  return Math.hypot(c.x - g.player.x, c.y - g.player.y) <= 1.9;
}

/**
 * The vehicle this one would be hitched to: the nearest with a yoke free,
 * looked for where it stands, or where the player stands when it is being
 * fetched out of the token.
 */
function vehicleFor(g: Game, c: Creature) {
  return c.mode === 'stored' ? g.vehicleNear(g.player.x, g.player.y, 3) : g.vehicleNear(c.x, c.y, 5);
}

/** What has to be fitted before anything can be ridden. */
export const TACK = ['saddle', 'bridle'];

/** Bare hands: what you fight with when there is nothing in them. */
const FIST: WeaponDef = { id: 'fist', kind: 'knives', damage: 3, swing: 1.8 };
/** How far you can reach with what is in your hand. */
const meleeReach = (g: Game): number => {
  const held = g.worn('weapon');
  const w = held && WEAPON_BY_ID.get(held.id);
  return w && !w.ammo ? Math.max(2.2, (w.range ?? 1) + 1.2) : 2.2;
};

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
        if (def.monster) {
          g.logMsg(`A ${def.name.toLowerCase()}: ${def.description} It has ${Math.ceil(c.health)} of ${maxHealth(c, def)} in it and hits for ${attackOf(c, def).toFixed(0)}. It cannot be tamed. Kill it and butcher it, or keep well clear.`, 'error');
          return;
        }
        const warm = coaxBonus(c, g.time);
        const used = warm > 0 ? ` It has taken ${c.coaxed === 1 ? 'an offering' : `${c.coaxed} offerings`} from your hand and is ${(warm * 100).toFixed(0)}% readier for the next.` : '';
        g.logMsg(`A wild ${def.name.toLowerCase()}: ${def.description} It eats ${dietText(c)}.${used} You would have to tame it to learn more.`, 'event');
        return;
      }
      const mood = c.hunger < 0.3 ? 'It looks hungry.' : c.hunger < 0.6 ? 'It could eat.' : 'It looks well fed.';
      const skills = Object.entries(c.skills).map(([id, v]) => `${id} ${v.toFixed(1)}`).join(', ');
      const range = c.mode === 'deed' && def.gathers ? ` It works up to ${workRangeOf(c, def)} tiles from the token.` : '';
      g.logMsg(`${c.name} (${SEX_NAMES[c.sex]} ${def.name.toLowerCase()}, ${g.creatures.describe(c)}): ${def.description} Level ${creatureLevel(c)}, ${skills}. Health ${Math.ceil(c.health)}/${maxHealth(c, def)}. It is ${careWord(c.care)} and carries ${traitList(c.traits)}.${range} ${mood} It eats ${dietText(c)}.`, 'event');
    },
  },
  {
    id: 'tame',
    label: 'Tame',
    verb: 'coaxing it closer',
    skill: 'taming',
    stamina: 0.03,
    baseTime: 3.5,
    applies: (t, g) => {
      const c = creatureOf(g, t);
      return c?.mode === 'wild' && !SPECIES[c.species]?.monster;
    },
    check: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return 'It is gone.';
      const def = SPECIES[c.species];
      if (def.monster) return `A ${def.name.toLowerCase()} is not a wildermon. There is nothing to be done with it but kill it.`;
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
      // Something that has not yet learned to mistrust you is far easier won,
      // and so is something that has taken food from this hand all afternoon.
      const chance = tameChance(g, c);
      void skill;
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
        forgetCoaxing(c);
        g.note('tamed');
        g.gainSkill('taming', tryGain(true, TAME_GAIN));
        g.gainSkill('soul_strength', tryGain(true, TAME_NERVE));
      } else {
        // It refused, but it stayed for the offering, and that is worth
        // something to the next one.
        c.coaxed += 1;
        c.coaxedAt = g.time;
        const won = coaxBonus(c, g.time);
        const warming = won > 0 ? ` It is growing used to you: ${(won * 100).toFixed(0)}% readier than the first time.` : '';
        g.logMsg(`The ${def.name.toLowerCase()} ${def.tameFail.replace('{food}', foodName)}.${warming}`, 'event');
        g.gainSkill('taming', tryGain(false, TAME_GAIN));
        g.gainSkill('soul_strength', tryGain(false, TAME_NERVE));
        c.state = 'idle';
        c.until = g.time;
      }
    },
  },
  {
    id: 'shear',
    label: 'Shear',
    labelFor: (t, g) => {
      const c = creatureOf(g, t);
      return (c && SPECIES[c.species]?.shearYield) === 'feather' ? 'Pluck' : 'Shear';
    },
    verb: 'shearing',
    skill: 'tailoring',
    tool: 'carving_knife',
    stamina: 0.04,
    baseTime: 6,
    applies: (t, g) => {
      const c = creatureOf(g, t);
      return !!c && !!SPECIES[c.species]?.fleece && c.mode !== 'wild';
    },
    check: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return 'It is gone.';
      if (!SPECIES[c.species]?.fleece) return 'There is nothing on it worth shearing.';
      if (c.mode === 'wild') return 'Tame it first; it will not stand still for you otherwise.';
      if (!g.inventory.has('carving_knife')) return 'You need a knife to shear with.';
      if (c.fleece < 0.35) return `${c.name} has hardly any ${SPECIES[c.species].shearYield === 'feather' ? 'feathers' : 'fleece'} back yet.`;
      return null;
    },
    perform: (t, g) => {
      const c = creatureOf(g, t);
      if (!c || c.fleece < 0.35) return;
      if (!nearPlayer(g, c)) {
        g.logMsg(`${c.name} moved off before you could start.`, 'event');
        return;
      }
      // A full fleece is three, a half-grown one is one, and quality follows the fleece.
      const yields = SPECIES[c.species].shearYield ?? 'wool';
      const n = Math.max(1, Math.round(c.fleece * (yields === 'wool' ? 3 : 6)));
      const ql = Math.max(1, Math.min(100, 15 + c.fleece * 45 + g.skills.get('tailoring') * 0.4));
      const wool = g.inventory.add(yields, { count: n, ql });
      c.fleece = 0;
      g.gainSkill('tailoring', 0.4);
      g.gainSkill('taming', 0.1);
      g.logMsg(`You ${yields === 'wool' ? 'shear' : 'pluck'} ${c.name} and come away with ${n} ${itemDef(yields).name.toLowerCase()}. (QL ${wool.ql.toFixed(1)}) It will grow back.`, 'event');
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
      return !!c && c.hitchedTo === null && !c.ridden && (c.mode === 'active' || c.mode === 'stored' || c.post !== null);
    },
    check: (t, g) => {
      if (!g.deed) return 'You have no settlement to assign it to.';
      const c = creatureOf(g, t);
      const working = g.creatures.workers().length;
      if (c && c.mode !== 'deed' && working >= g.workerCap) {
        return `${g.deed.name} has work for ${g.workerCap} wildermon at level ${g.deedLevel}. Upgrade the settlement to take on more.`;
      }
      // A trade it was asked for by name has to be one of its own.
      const want = t.kind === 'creature' ? t.job : undefined;
      if (c && want) {
        const def = SPECIES[c.species];
        const trades: string[] = def.trades ?? (def.gathers ? [def.gathers] : []);
        if (!trades.includes(want)) return `A ${def.name.toLowerCase()} cannot be set to that.`;
      }
      return null;
    },
    perform: (t, g) => {
      const c = creatureOf(g, t);
      const d = g.deed;
      if (!c || !d) return;
      g.clearPost(c);
      // The trade it was set to, remembered only when it is not what its kind
      // does anyway.
      const want = t.kind === 'creature' ? t.job : undefined;
      c.trade = want && want !== SPECIES[c.species].gathers ? (want as GatherKind) : null;
      if (c.mode === 'stored') {
        c.x = d.x + 0.5;
        c.y = d.y + 1.5;
      }
      c.mode = 'deed';
      c.enemy = null;
      c.state = 'idle';
      c.until = g.time;
      const gathers = c.trade ?? SPECIES[c.species].gathers;
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
      return !!c && c.hitchedTo === null && !c.ridden && (c.mode === 'deed' || c.mode === 'stored');
    },
    check: (_t, g) => (g.creatures.active() && !g.deed ? 'Nowhere to keep your current companion.' : null),
    perform: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return;
      g.clearPost(c);
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
      return !!c && c.hitchedTo === null && !c.ridden && (c.mode === 'active' || c.mode === 'deed');
    },
    check: (_t, g) => (g.deed ? null : 'You have no settlement token to keep it at.'),
    perform: (t, g) => {
      const c = creatureOf(g, t);
      if (!c || !g.deed) return;
      g.clearPost(c);
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
    skill: 'fighting',
    stamina: 0.07,
    baseTime: 2.5,
    repeat: true,
    applies: (t, g) => creatureOf(g, t)?.mode === 'wild',
    check: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return 'It is dead or gone.';
      if (c.mode !== 'wild') return 'That one is tame. Release it first if you mean it.';
      if (Math.hypot(c.x - g.player.x, c.y - g.player.y) > meleeReach(g)) return 'It is out of reach.';
      return null;
    },
    perform: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return;
      const def = SPECIES[c.species];
      const held = g.worn('weapon');
      const wdef = held && WEAPON_BY_ID.get(held.id);
      const bow = wdef?.ammo;
      // A bow is no use swung; bare hands are the fallback either way.
      const usable = wdef && !bow ? wdef : FIST;
      const item = wdef && !bow ? held : null;
      const before = c.health;
      // Its blood has a say in whether you connect at all.
      const landed = g.rand() <= hitChance(g, usable) * bloodMul(c, 'evade');
      g.gainSkill('fighting', tryGain(landed, SWING_FIGHT));
      g.gainSkill(usable.kind, tryGain(landed, SWING_ARM));
      g.gainSkill('body_strength', tryGain(landed, SWING_BODY));
      // And, if it is dark enough to matter, what it teaches you about noticing.
      g.fought(DARK_SWING);
      if (!landed) {
        g.logMsg(`You swing at the ${def.name.toLowerCase()}${item ? ` with your ${itemName(item).toLowerCase()}` : ''} and miss.`, 'event');
      } else {
        // Silver's old virtue: what carries its own light hates a silver edge.
        const bane = banes(item) && def.glow ? BANE_BONUS : 1;
        const dmg = weaponDamage(g, usable, item) * bane * (0.75 + g.rand() * 0.5);
        g.creatures.hurt(g, c, dmg, 'player');
        if (item) g.damageItem(item, 0.35);
        g.logMsg(
          `You strike the ${def.name.toLowerCase()}${item ? ` with your ${itemName(item).toLowerCase()}` : ''}. ${before > c.health ? `It is down to ${Math.max(0, Math.ceil(c.health))} of ${maxHealth(c, def)}.` : ''}`,
          'event',
        );
      }
      if (c.health <= 0) return false;
      // A cornered animal gets a swipe in, and the defensive sorts never miss their chance.
      if (def.defensive || g.rand() < 0.35) {
        g.player.attackedBy = c.id;
        g.player.attackedAt = g.time;
        g.hurtPlayer(attackOf(c, def) * 0.012, `The ${def.name.toLowerCase()} ${def.defensive ? 'comes straight back at you' : 'turns on you'}`, def.wound ?? 'bite');
      }
      // Keep swinging while it is still within reach.
      return Math.hypot(c.x - g.player.x, c.y - g.player.y) <= meleeReach(g);
    },
  },
  {
    id: 'shoot_creature',
    label: 'Shoot',
    verb: 'drawing the bow',
    skill: 'archery',
    range: 13,
    stamina: 0.05,
    baseTime: 2.6,
    repeat: true,
    applies: (t, g) => {
      const c = creatureOf(g, t);
      const held = g.worn('weapon');
      return !!c && c.mode === 'wild' && !!held && isBow(held.id);
    },
    check: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return 'It is dead or gone.';
      const held = g.worn('weapon');
      const bow = held && WEAPON_BY_ID.get(held.id);
      if (!held || !bow?.ammo) return 'You have no bow in your hands.';
      if (!g.inventory.has(bow.ammo)) return 'You are out of arrows.';
      const d = Math.hypot(c.x - g.player.x, c.y - g.player.y);
      if (d > (bow.range ?? 6)) return `Too far for a ${itemName(held).toLowerCase()}.`;
      if (d < 1.2) return 'It is too close to draw on.';
      return null;
    },
    perform: (t, g) => {
      const c = creatureOf(g, t);
      const held = g.worn('weapon');
      const bow = held && WEAPON_BY_ID.get(held.id);
      if (!c || !held || !bow?.ammo) return;
      const arrow = g.inventory.find(bow.ammo);
      if (!arrow || !g.inventory.remove(arrow.uid, 1)) return;
      const def = SPECIES[c.species];
      const d = Math.hypot(c.x - g.player.x, c.y - g.player.y);
      // Picking a target out of the dark at range is the hardest looking there is.
      g.fought(DARK_SHOT);
      // The far end of a bow's range is a far harder shot than the near end.
      const reach = 1 - (d / (bow.range ?? 6)) * 0.35;
      const landed = g.rand() <= hitChance(g, bow) * reach * bloodMul(c, 'evade');
      g.gainSkill('fighting', tryGain(landed, SHOT_FIGHT));
      g.gainSkill('archery', tryGain(landed, SHOT_ARCHERY));
      if (!landed) {
        g.logMsg(`Your arrow goes wide of the ${def.name.toLowerCase()}.`, 'event');
      } else {
        // The stave throws it; the head is what goes in. Both have a say.
        const head = matOfItem(arrow);
        const bane = head.bane && def.glow ? BANE_BONUS : 1;
        const dmg = weaponDamage(g, bow, held) * head.edge * bane * (0.6 + arrow.ql / 140) * (0.8 + g.rand() * 0.4);
        g.creatures.hurt(g, c, dmg, 'player');
        g.damageItem(held, 0.25);
        g.logMsg(`Your arrow goes home. The ${def.name.toLowerCase()} is down to ${Math.max(0, Math.ceil(c.health))} of ${maxHealth(c, def)}.`, 'event');
      }
      if (c.health <= 0) return false;
      return g.inventory.has(bow.ammo) && Math.hypot(c.x - g.player.x, c.y - g.player.y) <= (bow.range ?? 6);
    },
  },
  {
    id: 'rename_creature',
    asks: {
      question: 'What should it answer to?',
      fallback: (t, g) => creatureOf(g, t)?.name ?? '',
      max: 24,
    },
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
      const name = ((t as { name?: string }).name ?? '').trim();
      if (!name) return;
      c.name = name.slice(0, 24);
      g.logMsg(`It answers to ${c.name} now.`, 'info');
    },
  },
  {
    id: 'milk_creature',
    label: 'Milk it',
    verb: 'milking',
    skill: 'farming',
    stamina: 0.02,
    baseTime: 6,
    applies: (t, g) => {
      const c = creatureOf(g, t);
      return !!c && !!SPECIES[c.species].milk && c.sex === 'female' && c.mode !== 'wild' && c.mode !== 'stored';
    },
    check: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return 'It is gone.';
      if (!nearPlayer(g, c)) return `Stand next to ${c.name}.`;
      if (!g.inventory.has('bucket')) return 'You need an empty bucket.';
      if (c.sex !== 'female') return `${c.name} is male. Nothing is coming out of him.`;
      if (c.fleece < 0.4) return `${c.name} has nothing to give yet.`;
      return null;
    },
    perform: (t, g) => {
      const c = creatureOf(g, t);
      const bucket = g.inventory.find('bucket');
      if (!c || !bucket || c.fleece < 0.4) return;
      g.inventory.remove(bucket.uid, 1);
      // What it has been fed on is what comes out of it.
      const ql = Math.max(1, Math.min(100, 20 + c.fleece * 40 + c.hunger * 30));
      g.inventory.add('milk_bucket', { ql });
      c.fleece = 0;
      g.gainSkill('farming', 0.3);
      g.logMsg(`You milk ${c.name} into the bucket. (QL ${ql.toFixed(1)})`, 'event');
    },
  },
  // ---- The saddle: tack fitted, and a rider up. ----
  {
    id: 'tack_creature',
    label: 'Saddle and bridle it',
    verb: 'tacking it up',
    stamina: 0.02,
    baseTime: 4,
    applies: (t, g) => {
      const c = creatureOf(g, t);
      return !!c && !!SPECIES[c.species].mount && c.mode !== 'wild' && !c.tacked;
    },
    check: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return 'It is gone.';
      if (!nearPlayer(g, c)) return `Stand next to ${c.name}.`;
      if (!ageDef(c, g.time).works) return `${c.name} is not grown. Nothing that young takes a saddle.`;
      const want = TACK.filter((id) => !g.inventory.has(id));
      if (want.length) return `You need ${want.map((id) => itemDef(id).name.toLowerCase()).join(' and ')}.`;
      return null;
    },
    perform: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return;
      for (const id of TACK) {
        const it = g.inventory.find(id);
        if (!it || !g.inventory.remove(it.uid, 1)) return;
      }
      c.tacked = true;
      g.logMsg(`You saddle ${c.name} and slip the bit into its mouth. It stands for it.`, 'event');
    },
  },
  {
    id: 'shoe_creature',
    label: 'Shoe it',
    verb: 'shoeing it',
    stamina: 0.03,
    baseTime: 6,
    applies: (t, g) => {
      const c = creatureOf(g, t);
      return !!c && !!SPECIES[c.species].mount && c.mode !== 'wild' && !isShod(g.time, c);
    },
    check: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return 'It is gone.';
      if (!SPECIES[c.species].mount) return 'Only a mount takes shoes.';
      if (!nearPlayer(g, c)) return `Stand next to ${c.name}.`;
      if (!ageDef(c, g.time).works) return `${c.name} is not grown. Nothing that young takes a shoe.`;
      if (g.inventory.count('horseshoe') < SHOES_PER_MOUNT || !g.inventory.has('mallet')) return 'You need four horseshoes and a mallet.';
      return null;
    },
    perform: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return;
      const shoes = g.inventory.find('horseshoe');
      if (!shoes || !g.inventory.remove(shoes.uid, SHOES_PER_MOUNT)) return;
      c.shodAt = g.time;
      g.logMsg(`You nail four shoes onto ${c.name}'s hooves. They will hold a week: quicker on stone, and up what it would have baulked at.`, 'event');
    },
  },
  {
    id: 'untack_creature',
    label: 'Take the tack off',
    verb: 'unsaddling it',
    stamina: 0.01,
    baseTime: 2,
    applies: (t, g) => {
      const c = creatureOf(g, t);
      return !!c && c.tacked && !c.ridden;
    },
    check: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return 'It is gone.';
      return nearPlayer(g, c) ? null : `Stand next to ${c.name}.`;
    },
    perform: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return;
      c.tacked = false;
      for (const id of TACK) g.inventory.add(id, { ql: 40 });
      g.logMsg(`You strip the saddle and bridle off ${c.name}.`, 'event');
    },
  },
  {
    id: 'mount_creature',
    label: 'Mount',
    verb: 'getting up',
    stamina: 0.02,
    baseTime: 1.5,
    applies: (t, g) => {
      const c = creatureOf(g, t);
      return !!c && !!SPECIES[c.species].mount && c.mode !== 'wild' && !c.ridden;
    },
    check: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return 'It is gone.';
      if (!c.tacked) return `${c.name} has no saddle or bridle on.`;
      if (!ageDef(c, g.time).works) return `${c.name} is not grown enough to carry you.`;
      if (c.hitchedTo !== null) return `${c.name} is in the traces.`;
      if (!nearPlayer(g, c)) return `Stand next to ${c.name}.`;
      if (g.driving()) return 'Get down off what you are driving first.';
      return null;
    },
    perform: (t, g) => {
      const c = creatureOf(g, t);
      if (!c || !g.mount(c)) return;
      g.note('mounted');
      g.logMsg(`You take a fistful of mane and swing up onto ${c.name}.`, 'event');
    },
  },
  {
    id: 'dismount_creature',
    label: 'Get down',
    verb: 'dismounting',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => !!creatureOf(g, t)?.ridden,
    perform: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return;
      g.dismount();
      g.logMsg(`You swing down off ${c.name}.`, 'event');
    },
  },
  // ---- The traces: a wildermon put to a cart or a wagon. ----
  {
    id: 'hitch_creature',
    label: 'Hitch to the traces',
    verb: 'hitching it up',
    stamina: 0.02,
    baseTime: 2.5,
    applies: (t, g) => {
      const c = creatureOf(g, t);
      return !!c && c.mode !== 'wild' && c.hitchedTo === null && !c.ridden && !!vehicleFor(g, c);
    },
    check: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return 'It is gone.';
      const f = vehicleFor(g, c);
      if (!f) return 'There is no cart or wagon here with an empty yoke.';
      const [cx, cy] = furnitureCentre(f);
      if (Math.hypot(cx - g.player.x, cy - g.player.y) > 2.4) return `Stand by the ${furnitureName(f).toLowerCase()}.`;
      if (c.mode !== 'stored' && Math.hypot(c.x - g.player.x, c.y - g.player.y) > 4) return `${c.name} is too far off. Call it over first.`;
      if (!ageDef(c, g.time).works) return `${c.name} is not grown. A yearling is no use in the traces.`;
      if (c.hunger < 0.15) return `${c.name} is too hungry to pull anything. Feed it first.`;
      return null;
    },
    perform: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return;
      const f = vehicleFor(g, c);
      if (!f || !g.hitch(c, f)) return;
      const v = vehicleOf(f);
      const filled = (f.team ?? []).length;
      const short = v && filled < v.needs ? ` It needs ${v.needs - filled} more before it will move.` : '';
      g.note('hitched');
      g.logMsg(`You back ${c.name} into a yoke of the ${furnitureName(f).toLowerCase()}. ${filled} of ${v?.yokes ?? 0} filled.${short}`, 'event');
    },
  },
  {
    id: 'unhitch_creature',
    label: 'Take out of the traces',
    verb: 'unhitching it',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => creatureOf(g, t)?.hitchedTo !== null && creatureOf(g, t) !== undefined,
    perform: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return;
      const f = g.vehicleOfCreature(c);
      g.unhitch(c);
      g.logMsg(`You unbuckle ${c.name} from the ${f ? furnitureName(f).toLowerCase() : 'traces'}.`, 'event');
    },
  },
  {
    id: 'release_creature',
    /*
     * Asked before it happens rather than inside `perform`, which on an island
     * is the island's half — so letting a supreme-blooded wildermon go asked
     * nobody anything at all over there.
     */
    confirms: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return null;
      const tier = bestTier(c.traits);
      return tier === 'supreme' || tier === 'fantastic'
        ? `${c.name} carries ${tier} blood: ${traitList(c.traits)}. Release it back into the wild? You will not get that back.`
        : `Release ${c.name} back into the wild?`;
    },
    label: 'Release',
    verb: 'releasing',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => {
      const c = creatureOf(g, t);
      return !!c && c.mode !== 'wild' && c.hitchedTo === null && !c.ridden;
    },
    perform: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return;
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
