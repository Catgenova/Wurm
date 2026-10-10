/**
 * What a spell is, as far as drawing it goes, read off the game's own tables:
 * whose it is, what it is cast on, its numbers, how it is cast (`CastKind`)
 * and how long what it leaves lasts. Nothing here is written twice: a spell's
 * reach, radius and seconds are the ones the island casts it from
 * (`CLASS_SPELLS`, `FAITH_SPELLS`, `SPELLS`), so a change to a spell's numbers
 * is a change to how far its ring spreads and how long its mark stays.
 */
import { SPELLS, spellDef, spellSecs } from '../../game/arcane';
import { FAITH_SPELL_BY_ID, FAITH_SPELLS, type SpellOn } from '../../game/patrons';
import { CLASS_SPELL_BY_ID, CLASS_SPELLS } from '../../game/talents';
import { PATH_PICK_BY_ID, TECHNIQUES } from '../../game/meditation';

/** The groups of spells, one file each in this folder: the ten fighting trades, the three patrons, and the Knowledge path's techniques. */
export type SpellGroup = 'blade' | 'berserker' | 'pikeman' | 'archer' | 'skirmisher' | 'chirurgeon' | 'beastmaster'
  | 'kindler' | 'binder' | 'warder' | 'blessing' | 'justice' | 'chaos' | 'knowledge';
export const SPELL_GROUPS: readonly SpellGroup[] = ['blade', 'berserker', 'pikeman', 'archer', 'skirmisher', 'chirurgeon', 'beastmaster',
  'kindler', 'binder', 'warder', 'blessing', 'justice', 'chaos', 'knowledge'];

/**
 * How a spell is cast, which is what its stand-in pose and effect are picked
 * by until an artist draws it properly:
 *
 *   strike   a blow with what is in the hand, at an enemy in reach
 *   thrust   a pole's thrust, at an enemy in reach and past it
 *   shot     a bow drawn and loosed
 *   throw    a javelin, an axe or a knife thrown
 *   bolt     something sent out of the hand at an enemy: fire, a binding
 *   curse    a creature pointed at and marked: a hex, a judgment, a mark
 *   buff     on oneself: a skin, a rage, a breath
 *   ally     on somebody else, or oneself: a dressing, a ward
 *   nova     everything round oneself at once: a whirlwind, a firestorm
 *   ground   a patch of ground chosen and blessed or cursed
 *   command  a companion told to do something, or a creature told off
 *   pray     a patron asked, for oneself or a thing carried
 */
export type CastKind = 'strike' | 'thrust' | 'shot' | 'throw' | 'bolt' | 'curse' | 'buff' | 'ally' | 'nova' | 'ground' | 'command' | 'pray';

export interface SpellInfo {
  id: string;
  name: string;
  group: SpellGroup;
  kind: CastKind;
  /** Every kind of thing it can be cast on, the one it goes at by default first. */
  on: readonly SpellOn[];
  /** Its numbers, as the island casts it from. */
  fx: Readonly<Record<string, number>>;
  /** Tiles round where it lands (a patron's spell on the ground), or round the caster (`fx.reach` of a spell on oneself). */
  radius: number;
  /**
   * Seconds what it leaves lasts, from when it lands: its `secs`, or how long
   * it holds a creature; `null` for a spell that is over when it lands. A
   * skin lasts until blows use it up, which the island does not say, so a
   * skin is shown for `SKIN_SHOWN`.
   */
  lasts: number | null;
  /** What wants a weapon in the hand, from the spell's own `needs`. */
  needs?: string;
}

/** Seconds a skin (a Warder's, an Aegis, a Bulwark) is shown over somebody, the island not saying when it is used up. */
export const SKIN_SHOWN = 12;
/** The binding and the focus a hold's seconds are shown at, the island not saying the caster's. */
const HOLD_AT = 50;

const CLASS_GROUP = new Set<string>(SPELL_GROUPS);
const SCHOOL_GROUP: Record<string, SpellGroup> = { kindling: 'kindler', binding: 'binder', warding: 'warder' };

function classKind(cls: string, on: readonly SpellOn[], fx: Readonly<Record<string, number>>, needs?: string): CastKind {
  const self = on.length === 1 && on[0] === 'self';
  if (cls === 'beastmaster') return 'command';
  if (on.includes('player')) return 'ally';
  if (self) return fx.reach ? 'nova' : 'buff';
  if (needs === 'archery') return 'shot';
  if (needs === 'throwing' || needs === 'skirmish') return 'throw';
  if (needs === 'kindling' || needs === 'binding') return 'bolt';
  if (cls === 'pikeman') return 'thrust';
  // A trade's spell on an enemy with nothing in the hand to do it with is said at it: a challenge, an exposing look, a toxin.
  if (!needs && (cls === 'archer' || cls === 'skirmisher' || cls === 'chirurgeon' || (!fx.more && !fx.hold))) return 'curse';
  return 'strike';
}

function faithKind(on: readonly SpellOn[], patron: string, fx: Readonly<Record<string, number>>): CastKind {
  if (on.includes('area')) return 'ground';
  if (on.includes('enemy') || on.includes('wildermon')) return patron === 'blessing' ? 'ally' : fx.share || fx.below ? 'bolt' : 'curse';
  if (on.includes('player')) return 'ally';
  return 'pray';
}

function classLasts(id: string, fx: Readonly<Record<string, number>>): number | null {
  if (fx.skin) return SKIN_SHOWN;
  if (fx.secs) return fx.secs;
  // A Binder's holds are a share of a Snare's.
  if (id.startsWith('binder_') && fx.hold) return spellSecs(spellDef('snare')!, HOLD_AT, 1) * fx.hold;
  if (fx.hold) return fx.hold;
  return null;
}

const infos = new Map<string, SpellInfo>();
for (const s of CLASS_SPELLS) {
  if (!CLASS_GROUP.has(s.class)) continue;
  infos.set(s.id, {
    id: s.id, name: s.name, group: s.class as SpellGroup, kind: classKind(s.class, s.on, s.fx, s.needs), on: s.on, fx: s.fx,
    radius: s.fx.reach && s.on.includes('self') ? s.fx.reach : s.fx.wide ?? 0, lasts: classLasts(s.id, s.fx), needs: s.needs,
  });
}
for (const s of FAITH_SPELLS) {
  infos.set(s.id, {
    id: s.id, name: s.name, group: s.patron, kind: faithKind(s.on, s.patron, s.fx), on: s.on, fx: s.fx,
    radius: s.radius ?? s.fx.reach ?? 0, lasts: s.fx.secs ?? null,
  });
}
for (const s of SPELLS) {
  const group = SCHOOL_GROUP[s.school];
  if (!group) continue;
  const on: SpellOn[] = s.at === 'creature' ? ['enemy'] : ['self'];
  infos.set(s.id, {
    id: s.id, name: s.name, group, kind: s.at === 'creature' ? 'bolt' : s.at === 'around' ? 'nova' : 'buff', on,
    fx: { reach: s.range, secs: s.secs, power: s.power },
    radius: s.at === 'around' ? s.range : 0,
    lasts: s.school === 'warding' ? SKIN_SHOWN : s.secs ? spellSecs(s, HOLD_AT, 1) : null,
  });
}

// A path's techniques, every one cast on oneself and over when it lands: what it finds is said, not drawn.
for (const k of TECHNIQUES) {
  infos.set(k.id, { id: k.id, name: k.name, group: k.path as SpellGroup, kind: 'pray', on: ['self'], fx: k.fx, radius: 0, lasts: null });
}

/** What a spell is, by id: a trade's, a patron's, one of the six arcane, or a path's technique. */
export const spellInfo = (id: string): SpellInfo | undefined => infos.get(id);
/** Every spell there is, by group, in the order the tables write them. */
export const spellsIn = (group: SpellGroup): SpellInfo[] => [...infos.values()].filter((s) => s.group === group);
/** Every spell id there is. */
export const ALL_SPELL_IDS: readonly string[] = [...infos.keys()];
/** Whether an id is a spell at all, as a broadcast from somebody else's browser is checked. */
export const isSpell = (id: string): boolean =>
  infos.has(id) && (CLASS_SPELL_BY_ID.has(id) || FAITH_SPELL_BY_ID.has(id) || !!spellDef(id) || PATH_PICK_BY_ID.get(id)?.kind === 'technique');
