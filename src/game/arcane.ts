/**
 * The arcane, which is a stone and what you can get out of it.
 *
 * Everything else on this island came out of the ground and was worked, and
 * there was no reason for this to be different. So there is no mana, no pool,
 * no bar that fills while you stand about. There is a cut stone in a silver
 * claw, and casting wears it away.
 *
 * **The stone is the magazine, and every number on it was already there.**
 *
 *     the kind   `item.extra`   which spells it will carry
 *     the cut    `item.ql`      how little each cast wastes
 *     the find   `item.rare`    how many casts are in it at all
 *     the wear   `item.dmg`     how much of it is left
 *
 * A focus worn through to a hundred crumbles down the same path that takes a
 * rotten haunch off the ground, which was rebuilt this morning and needed
 * nothing adding for this. There is no new table, no new timestamp and no new
 * sweeper: the resource is an item, and items already wear out.
 *
 * ## Which makes it an economy rather than a meter
 *
 * A miner digs the stone -- six kinds at the rarities mining has always given
 * them, one in sixteen for a diamond -- an artisan cuts and sets it, and the
 * three schools burn it. That is a supply chain across three trades that all
 * existed before this file, and it is the whole of what stops a mage casting
 * for ever.
 *
 * ## And the land pays part of the cost
 *
 * A stone gives up what is in it more easily on high ground and in the dark,
 * which is the one place in this game where *where you are standing* changes
 * what you can do. Faith already has its own axis -- an altar, and the hours
 * either side of the sun -- so this deliberately took a different one.
 */

/** The stone a spell is cast out of, by the kind it must be. */
export type Stone = 'ruby' | 'garnet' | 'sapphire' | 'diamond' | 'emerald' | 'topaz';

export interface SchoolDef {
  id: string;
  name: string;
  /** The skill, which is also the class's gate and the scope of its nodes. */
  skill: string;
  /** The stones it works, commonest first. */
  stones: Stone[];
  note: string;
}

/**
 * Three schools of one art.
 *
 * They share their three channels and differ entirely in what their spells
 * do, which is the honest shape of it: a kindler and a warder are not two
 * kinds of person with different hands, they are two people who learned
 * different things to say to a stone.
 */
export const SCHOOLS: SchoolDef[] = [
  {
    id: 'kindling', name: 'Kindling', skill: 'kindling', stones: ['garnet', 'ruby'],
    note: 'Heat, out of the warm stones. What it touches burns, and goes on burning.',
  },
  {
    id: 'binding', name: 'Binding', skill: 'binding', stones: ['sapphire', 'diamond'],
    note: 'Stillness, out of the clear stones. What it touches stops, and stays stopped.',
  },
  {
    id: 'warding', name: 'Warding', skill: 'warding', stones: ['topaz', 'emerald'],
    note: 'A skin, out of the soft stones. It stands between a blow and whoever it was aimed at.',
  },
];

export const schoolOf = (id: string): SchoolDef | undefined => SCHOOLS.find((s) => s.id === id);

/** What a spell reaches for, once it has left the stone. */
export type SpellAt = 'creature' | 'self' | 'around';

export interface SpellDef {
  id: string;
  school: string;
  name: string;
  /** The school skill it takes. */
  level: number;
  /** The stone it must be cast out of. Nothing else will carry it. */
  gem: Stone;
  /** Marks of wear it costs a perfect stone, before quality, find and land. */
  wear: number;
  /** What it does, before skill, stone and trade. Damage, or seconds of hold. */
  power: number;
  /** How long its mark lasts, where it leaves one. */
  secs: number;
  /** Tiles it carries. */
  range: number;
  at: SpellAt;
  note: string;
  /** What the island says when it takes. `{n}` is what it did. */
  done: string;
}

/**
 * Six spells: two to a school, one for a thing and one for everything near it.
 *
 * The small one is cast out of the commoner of the school's two stones and the
 * large one out of the rarer, so what a mage can do on a given day is decided
 * by what came out of the rock rather than by a cooldown.
 *
 * Nothing here needed a new way of hurting, holding or shielding. A burn is a
 * wound the island already had a kind for, with sage as its cover; a hold is
 * the same `until` the clock already reads before it settles an animal; and a
 * skin is a number taken off a blow before the shield, in the one function
 * where every blow already arrives.
 */
export const SPELLS: SpellDef[] = [
  {
    id: 'ember', school: 'kindling', name: 'Ember', level: 1, gem: 'garnet',
    wear: 3, power: 12, secs: 0, range: 5, at: 'creature',
    note: 'A coal out of the stone, put where you are looking.',
    done: 'The garnet goes cold in your hand and the {t} is burning. ({n})',
  },
  {
    id: 'pyre', school: 'kindling', name: 'Pyre', level: 30, gem: 'ruby',
    wear: 7, power: 9, secs: 0, range: 3, at: 'around',
    note: 'Everything close enough to feel it, at once.',
    done: 'The air goes white and everything near you is alight. ({n})',
  },
  {
    id: 'snare', school: 'binding', name: 'Snare', level: 1, gem: 'sapphire',
    wear: 3, power: 0, secs: 8, range: 5, at: 'creature',
    note: 'One thing, standing exactly where it is.',
    done: 'The {t} puts a foot down and does not pick it up again. ({n})',
  },
  {
    id: 'stillfield', school: 'binding', name: 'Still field', level: 30, gem: 'diamond',
    wear: 7, power: 0, secs: 5, range: 3, at: 'around',
    note: 'Everything close enough, for rather less time each.',
    done: 'Everything around you stops where it stands. ({n})',
  },
  {
    id: 'aegis', school: 'warding', name: 'Aegis', level: 1, gem: 'topaz',
    wear: 4, power: 20, secs: 0, range: 0, at: 'self',
    note: 'A skin over you that takes the blows instead, until it is used up.',
    done: 'Something closes over you, a half inch out from the skin. ({n})',
  },
  {
    id: 'bulwark', school: 'warding', name: 'Bulwark', level: 30, gem: 'emerald',
    wear: 8, power: 16, secs: 0, range: 3, at: 'around',
    note: 'The same skin, over everybody standing near you.',
    done: 'It closes over everybody within reach of you. ({n})',
  },
];

export const spellDef = (id: string): SpellDef | undefined => SPELLS.find((s) => s.id === id);
export const spellsOf = (school: string): SpellDef[] => SPELLS.filter((s) => s.school === school);

/** The item a stone is set into, and the skill that sets it. */
export const FOCUS = 'focus';

/**
 * How much of itself a stone gives up for one cast.
 *
 * A better cut wastes less and a rarer find holds more, which is the whole of
 * why anybody would want either. Floored, so no stone is ever free.
 */
export const spellWear = (
  s: SpellDef, stoneQl: number, rareBoost: number, ease: number, thrift: number,
): number => Math.max(0.2, s.wear * (1.6 - stoneQl / 125) / rareBoost * ease * thrift);

/** What the spell does, before anything gets in the way of it. */
export const spellForce = (s: SpellDef, skill: number, stoneQl: number, force: number): number =>
  s.power * (0.45 + skill / 110) * (0.7 + stoneQl / 170) * force;

/** And how long its mark lasts, where it leaves one. */
export const spellSecs = (s: SpellDef, skill: number, force: number): number =>
  s.secs * (0.6 + skill / 140) * force;

/** How far it carries. */
export const spellRange = (s: SpellDef, reach: number): number => s.range * reach;

/**
 * What the ground under you is worth to a stone.
 *
 * High and dark. Height is capped so a mountain is worth what a hill and a
 * half is, and the whole thing has a floor, so the worst place to stand is
 * about a third dearer than the best rather than useless.
 */
export const landEase = (height: number, darkness: number): number =>
  Math.max(0.6, 1 - Math.min(60, Math.max(0, height - 20)) / 300 - darkness * 0.22);

/** Why a spell cannot be cast, or nothing. */
export function spellRefusal(
  s: SpellDef, mine: string | null, skill: number, stone: { ql: number; dmg: number } | null,
): string | null {
  if (s.school !== mine) {
    return `${s.name} is ${(schoolOf(s.school)?.name ?? s.school).toLowerCase()}, and you are not of it.`;
  }
  if (skill < s.level) {
    return `${s.name} takes ${s.level} ${s.school}; you have ${Math.floor(skill)}.`;
  }
  if (!stone) return `${s.name} is cast out of ${s.gem}. You are carrying no ${s.gem} focus.`;
  if (stone.dmg >= 100) return `Your ${s.gem} is spent.`;
  return null;
}
