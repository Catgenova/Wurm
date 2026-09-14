import type { ActionDef, Target } from './actions';
import {
  ageOf,
  BREED_REST,
  careWord,
  GESTATION,
  maxHealth,
  SEX_NAMES,
  SPECIES,
  type Creature,
} from './creatures';
import type { Game } from './game';
import { clockLeft } from './boons';
import { itemName } from './items';
import { workingQl } from './materials';
import { bestTier, traitList, traitTier } from './traits';

/**
 * Animal husbandry: the brush, and the breeding of a herd.
 *
 * Two things sit under the skill. **Brushing** a wildermon down with a brush
 * puts care into it, and a beast that is cared for works quicker, learns
 * faster and throws better young. **Pairing** a male and a female of one
 * species puts a young one on the way, and what it is born carrying is decided
 * at that moment by the blood of the two of them, the keeper's skill, and how
 * well the pair have been kept.
 */

export const HUSBANDRY = 'animal_husbandry';

type CreatureTarget = Extract<Target, { kind: 'creature' }>;
const isCreature = (t: Target): t is CreatureTarget => t.kind === 'creature';
const creatureOf = (g: Game, t: Target): Creature | undefined => (isCreature(t) ? g.creatures.get(t.id) : undefined);
const nearPlayer = (g: Game, c: Creature, within = 1.9): boolean => Math.hypot(c.x - g.player.x, c.y - g.player.y) <= within;
/** Yours, and standing in the world rather than put away at the token. */
const outWithYou = (c: Creature): boolean => c.mode === 'active' || c.mode === 'deed';

/** How far apart a pair may stand and still be put together. */
export const PAIR_RANGE = 4;
/** Care will not be brushed past this in one go; it takes a while to get one up. */
export const GROOM_CAP = 1;

/**
 * What one brushing is worth. A poor brush in an unpractised hand puts a
 * little in; a good brush and a hundred in the skill puts most of a full
 * grooming in at once.
 */
export const groomGain = (skill: number, ql: number): number => 0.18 + (skill / 100) * 0.34 + (Math.min(100, ql) / 100) * 0.22;

/** The odds a pairing takes. */
export const breedChance = (skill: number, care: number): number =>
  Math.min(0.97, 0.35 + (Math.max(0, Math.min(100, skill)) / 100) * 0.5 + Math.max(0, Math.min(1, care)) * 0.15);

/**
 * The mate standing nearest this one: same species, the other sex, tamed,
 * grown, fed, and rested since its last covering.
 */
export function mateFor(g: Game, c: Creature): Creature | undefined {
  let best: Creature | undefined;
  let bestD = Infinity;
  for (const o of g.creatures.list.values()) {
    if (o.id === c.id || o.species !== c.species || o.sex === c.sex) continue;
    if (!outWithYou(o) || o.due > 0) continue;
    const d = Math.hypot(o.x - c.x, o.y - c.y);
    if (d > PAIR_RANGE || d >= bestD) continue;
    best = o;
    bestD = d;
  }
  return best;
}

/** Why these two will not be put together, or null. */
export function pairRefuses(g: Game, a: Creature, b: Creature): string | null {
  for (const c of [a, b]) {
    if (ageOf(c, g.time) !== 'grown') {
      return ageOf(c, g.time) === 'young' ? `${c.name} is not grown.` : `${c.name} is past it.`;
    }
    if (c.hunger < 0.5) return `${c.name} is too hungry to think about it. Feed it first.`;
    if (g.time - c.bredAt < BREED_REST) return `${c.name} has been put to a mate lately and wants ${clockLeft(BREED_REST - (g.time - c.bredAt))} to itself.`;
    if (c.due > 0) return `${c.name} is already in young.`;
  }
  return null;
}

export const HUSBANDRY_ACTIONS: ActionDef[] = [
  {
    id: 'groom',
    label: 'Brush it down',
    verb: 'brushing it down',
    skill: HUSBANDRY,
    stamina: 0.03,
    baseTime: 7,
    repeat: true,
    applies: (t, g) => {
      const c = creatureOf(g, t);
      return !!c && c.mode !== 'wild';
    },
    check: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return 'It is gone.';
      if (!nearPlayer(g, c)) return `Stand next to ${c.name}.`;
      if (!g.inventory.has('brush')) return 'You need a brush.';
      if (c.care >= 0.995) return `${c.name} has been brushed to a shine already.`;
      return null;
    },
    perform: (t, g) => {
      const c = creatureOf(g, t);
      const brush = g.inventory.tool('brush');
      if (!c || !brush) return;
      const skill = g.skills.get(HUSBANDRY);
      const before = c.care;
      c.care = Math.min(GROOM_CAP, c.care + groomGain(skill, workingQl(brush.ql, brush.extra)));
      // A brushing is also a looking-over: it finds the small hurts and sees to them.
      const top = maxHealth(c, SPECIES[c.species]);
      if (c.health < top) c.health = Math.min(top, c.health + top * 0.06);
      g.damageItem(brush, 0.03);
      g.gainSkill(HUSBANDRY, 0.4);
      g.note('groom');
      if (c.care >= 0.995) g.note('groomfull');
      g.logMsg(
        before < 0.12 && c.care >= 0.12
          ? `You work the dust out of ${c.name}'s coat. It leans into the brush. (${careWord(c.care)})`
          : `You brush ${c.name} down. (${careWord(c.care)})`,
        'event',
      );
      g.events.emit('creature');
    },
  },
  {
    id: 'pair_creature',
    label: 'Put it to a mate',
    verb: 'putting them together',
    skill: HUSBANDRY,
    stamina: 0.04,
    baseTime: 9,
    applies: (t, g) => {
      const c = creatureOf(g, t);
      return !!c && outWithYou(c) && c.due === 0;
    },
    labelFor: (t, g) => {
      const c = creatureOf(g, t);
      const mate = c && mateFor(g, c);
      return mate ? `Put it to ${mate.name}` : 'Put it to a mate';
    },
    check: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return 'It is gone.';
      if (!g.deed) return 'Breeding is settled work. Found a settlement first: the young one goes to the token.';
      if (!nearPlayer(g, c, 2.4)) return `Stand next to ${c.name}.`;
      if (c.due > 0) return `${c.name} is already in young.`;
      const mate = mateFor(g, c);
      if (!mate) {
        const def = SPECIES[c.species];
        return `There is no ${def.name.toLowerCase()} of the other sex within ${PAIR_RANGE} tiles. ${c.name} is ${SEX_NAMES[c.sex]}.`;
      }
      return pairRefuses(g, c, mate);
    },
    perform: (t, g) => {
      const c = creatureOf(g, t);
      if (!c) return;
      const mate = mateFor(g, c);
      if (!mate || pairRefuses(g, c, mate)) return;
      const dam = c.sex === 'female' ? c : mate;
      const sire = dam === c ? mate : c;
      const skill = g.skills.get(HUSBANDRY);
      const care = (dam.care + sire.care) / 2;
      g.gainSkill(HUSBANDRY, 0.9);
      if (g.rand() >= breedChance(skill, care)) {
        // A failed pairing costs both of them a rest, but only half of one.
        dam.bredAt = g.time - BREED_REST / 2;
        sire.bredAt = g.time - BREED_REST / 2;
        g.logMsg(`${dam.name} and ${sire.name} will have nothing to do with one another. Brush them, feed them, and try again.`, 'error');
        return;
      }
      g.creatures.pair(g, dam, sire, skill);
      g.note('paired');
      g.logMsg(
        `${sire.name} is put to ${dam.name}. She is in young and will drop in about ${clockLeft(GESTATION)}. Between them they carry ${traitList([...new Set([...sire.traits, ...dam.traits])])}.`,
        'event',
      );
      g.events.emit('creature');
    },
  },
  {
    id: 'read_blood',
    label: 'Look it over',
    verb: 'looking it over',
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
      const def = SPECIES[c.species];
      const skill = g.skills.get(HUSBANDRY);
      // Blood does not read itself. Without the skill you can see that there is
      // something in it; with the skill you can see what.
      const seen = c.traits.filter((id) => skill >= 1 + TIER_LEVEL[traitTier(id)]);
      const hidden = c.traits.length - seen.length;
      const carrying = c.due > 0 ? ` She is in young, due in about ${clockLeft(c.due - g.time)}.` : '';
      g.logMsg(
        `${c.name}, ${SEX_NAMES[c.sex]} ${def.name.toLowerCase()}, ${ageOf(c, g.time)} and ${careWord(c.care)}. It carries ${seen.length ? traitList(seen) : 'nothing you can read'}${hidden ? `, and ${hidden === 1 ? 'one thing' : `${hidden} things`} you cannot read yet` : ''}.${carrying}`,
        'event',
      );
    },
  },
];

/**
 * The husbandry it takes to read a trait off an animal. Anyone can see that
 * something is quick on its feet; it takes a breeder to know old blood when
 * it is standing in front of them.
 */
export const TIER_LEVEL = { common: 0, rare: 15, supreme: 35, fantastic: 60 } as const;

/** What a herd is worth at a glance, for the journal and the panel. */
export const herdBest = (g: Game): string => {
  let best = 'common';
  for (const c of g.creatures.list.values()) {
    if (c.mode === 'wild') continue;
    const t = bestTier(c.traits);
    if (['common', 'rare', 'supreme', 'fantastic'].indexOf(t) > ['common', 'rare', 'supreme', 'fantastic'].indexOf(best)) best = t;
  }
  return best;
};

/** The brush in hand, named, for a message. */
export const brushName = (g: Game): string => {
  const b = g.inventory.find('brush');
  return b ? itemName(b).toLowerCase() : 'brush';
};
