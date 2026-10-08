/**
 * The Skirmisher's spells: how each is cast and what it looks like.
 *
 * Twelve spells, each a stand-in (`placeholder`) until it is drawn. To draw
 * one, replace its line with a visual of its own (`SpellVisual`, ./index; SPELLS.md has the
 * long form). This file is this group's alone and nobody else edits it, so anything its spells
 * share -- a slash, a sigil, a colour -- is written here, not in the kit.
 */
import { placeholder } from './generic';
import type { SpellVisual } from './index';
import type { SpellPalette } from './kit';

/** Sea teal and sand: quick, light, gone. */
export const PALETTE: SpellPalette = {
  core: '#e2fff9',
  main: '#4fc2b4',
  deep: '#1f6e69',
  accent: '#e8c68a',
  ink: '#123532',
  light: '#7cf0df',
};

export const SKIRMISHER: Record<string, SpellVisual> = {
  // Snap Throw (throw, on enemy): With a javelin or a throwing axe in hand: a throw at 80%;
  skirmisher_snap_throw: placeholder('skirmisher_snap_throw', PALETTE),
  // Long Throw (throw, on enemy): With a javelin or a throwing axe in hand: a throw at 110% on an enemy up to 2 tiles past your reach.
  skirmisher_long_throw: placeholder('skirmisher_long_throw', PALETTE),
  // Hit and Run (throw, on enemy, lasts 5 s): With a javelin, a throwing axe or a knife in hand: a throw or a knife blow at 100%, and for 5 s you walk 40% faster.
  skirmisher_hit_and_run: placeholder('skirmisher_hit_and_run', PALETTE),
  // Heavy Throw (throw, on enemy): With a javelin or a throwing axe in hand: a throw at 140% that staggers it as a maul does: a heavy blow knocked off its stroke, and its next blow p...
  skirmisher_heavy_throw: placeholder('skirmisher_heavy_throw', PALETTE),
  // Gut Throw (throw, on enemy): With a javelin or a throwing axe in hand: a throw at 90% that bleeds it as a knife does, 15% of the throw a second for 6 s.
  skirmisher_gut_throw: placeholder('skirmisher_gut_throw', PALETTE),
  // Parting Throw (throw, on enemy): With a javelin or a throwing axe in hand: a throw at 100%, and you leap 3 tiles straight back from it, over ground you could walk.
  skirmisher_parting_throw: placeholder('skirmisher_parting_throw', PALETTE),
  // Double Throw (throw, on enemy): With a javelin or a throwing axe in hand: two throws at 70% each, one after the other.
  skirmisher_double_throw: placeholder('skirmisher_double_throw', PALETTE),
  // Ricochet (throw, on enemy): With a javelin or a throwing axe in hand: a throw at 100% that, when it lands, glances on to the nearest other enemy within 3 tiles of it at 60%.
  skirmisher_ricochet: placeholder('skirmisher_ricochet', PALETTE),
  // Opportunist (buff, on self, lasts 10 s): For 10 s every blow, throw and shot of yours on a creature fighting somebody else does 30% more damage.
  skirmisher_opportunist: placeholder('skirmisher_opportunist', PALETTE),
  // Fade (buff, on self, lasts 10 s): Every creature hunting you loses you, and will not come for you again for 10 s unless you strike it.
  skirmisher_fade: placeholder('skirmisher_fade', PALETTE),
  // Fan of Blades (throw, on enemy): With a javelin or a throwing axe in hand: a throw at 60% at the enemy you aim at and at every other enemy within 3 tiles of it.
  skirmisher_fan_of_blades: placeholder('skirmisher_fan_of_blades', PALETTE),
  // Marked for Death (curse, on enemy, lasts 15 s): An enemy within 12 tiles: for 15 s every blow, throw and shot a person lands on it is critical twice as often.
  skirmisher_marked_for_death: placeholder('skirmisher_marked_for_death', PALETTE),
};
