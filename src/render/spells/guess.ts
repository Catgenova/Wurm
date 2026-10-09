/**
 * What the island would say a cast did (`Told`), worked out in the browser
 * from the same rules and numbers, for a cast drawn with no island to ask: a
 * spell played from the console (`wurm.spell`) and the preview sheet. So the
 * effects follow the island's rules there too -- a monster held for its own
 * share of a hold, a Panic's monsters fleeing for its three seconds, a Fright
 * on a monster refused, an area reaching the wild things within it and no
 * further -- and a change to a spell's numbers changes both at once.
 *
 * Only what can be known without the island: who a spell reaches by where they
 * stand and what they are, and for how long by the spell's own numbers. A blow
 * that misses, a passive that lengthens a burn and a Stoke that is spent are
 * the island's alone, and are not guessed; `supabase/test/did.ts` holds this to
 * what the island says for the spells it casts.
 */
import { SPECIES } from '../../game/creatures';
import { spellInfo } from './info';
import { sameWho, type Body, type Told, type Who } from './kit';

/** Somebody a guess is asked about: who they are, where they stand, and what they are. */
export interface Standing {
  who: Who;
  x: number;
  y: number;
  kind: Body['kind'];
  species?: string;
  /** Somebody's (a companion, a beast on a deed), which no harm reaches. */
  tame?: boolean;
  /** Hunting or fighting somebody: all a Judgment strikes. */
  hostile?: boolean;
}

/** The spells the island refuses on a monster, with nothing done (`faith_spell_cast`, `class_spell_cast`). */
const NOT_ON_MONSTERS = new Set(['chaos_fright', 'blessing_calm', 'blessing_kinship', 'beastmaster_call_of_the_wild']);
/** Spells round the caster that reach people rather than creatures: you and everybody within its reach. */
const ON_PEOPLE = new Set([
  'pikeman_rally_the_line', 'warder_sanctuary', 'warder_bastion_of_stone', 'chirurgeon_healing_circle', 'chirurgeon_mass_dressing', 'bulwark',
]);
/** Ground blessed or cursed for a while, which reaches whoever comes into it on the clock and nobody as it is cast. */
const ZONES = new Set(['blessing_radiance', 'blessing_sanctuary', 'justice_truce']);
/** Spells whose hold the island puts on with `class_hold` and marks held, beside every trade's spell with a `hold`. */
const HOLDS = new Set(['justice_bind', 'snare', 'stillfield']);

const isMonster = (s: Standing): boolean => !!(s.species && SPECIES[s.species]?.monster);

/**
 * Seconds what a spell leaves on one it reached lasts, as the island gives them: a hold's share on a monster, a
 * Panic's own seconds for a monster, a Justice's Bind its share; otherwise the spell's own (`SpellInfo.lasts`). Nothing
 * for a skin (it lasts until blows use it up) or a spell that leaves nothing.
 */
export function secsFor(id: string, on: Standing): number | undefined {
  const info = spellInfo(id);
  if (!info) return undefined;
  const fx = info.fx, monster = on.kind === 'creature' && isMonster(on);
  if (fx.skin || (info.group === 'warder' && !fx.secs)) return undefined;
  if (id === 'chaos_panic') return monster ? fx.monster : fx.secs;
  if (id === 'justice_bind') return fx.secs * (monster ? fx.monster ?? 1 : 1);
  if (fx.hold && info.lasts !== null) return info.lasts * (monster ? fx.monster ?? 1 : 1);
  return info.lasts ?? undefined;
}

/**
 * What the island would say `caster` casting `id` at `target` did (`Told`), with `near` everybody standing about; null
 * where the island refuses it outright (a Fright on a monster), and so draws nothing.
 */
export function guessTold(id: string, caster: Standing, target: Standing | { x: number; y: number } | null, near: readonly Standing[]): Told | null {
  const info = spellInfo(id);
  if (!info) return null;
  const aimed = target && 'who' in target ? target : null;
  if (aimed && aimed.kind === 'creature' && isMonster(aimed) && NOT_ON_MONSTERS.has(id)) return null;
  const fx = info.fx;
  const centre = info.kind === 'ground' && target ? target : caster;
  const within = (s: Standing, r: number): boolean => Math.hypot(s.x - centre.x, s.y - centre.y) <= r;
  const others = near.filter((s) => !sameWho(s.who, caster.who));
  let reached: Standing[];
  if (ZONES.has(id)) reached = [];
  else if (ON_PEOPLE.has(id)) reached = [caster, ...others.filter((s) => s.kind !== 'creature' && within(s, fx.reach ?? info.radius))];
  else if ((info.kind === 'nova' || info.kind === 'ground') && info.radius > 0) {
    reached = others.filter((s) => s.kind === 'creature' && !s.tame && within(s, info.radius) && (id !== 'justice_judgment' || !!s.hostile));
  } else if (id === 'kindler_meteor' && aimed) {
    reached = [aimed, ...others.filter((s) => s.kind === 'creature' && !s.tame && !sameWho(s.who, aimed.who)
      && Math.hypot(s.x - aimed.x, s.y - aimed.y) <= (fx.wide ?? 0))];
  } else reached = aimed ? [aimed] : [caster];
  const held = HOLDS.has(id) || (!!fx.hold && info.group !== 'warder');
  return {
    hit: reached.map((s) => {
      const secs = secsFor(id, s);
      return { who: s.who, ...(secs !== undefined ? { secs } : {}), ...(held && s.kind === 'creature' ? { held: true } : {}) };
    }),
  };
}
