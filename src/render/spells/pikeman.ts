/**
 * The Pikeman's spells: how each is cast and what it looks like.
 *
 * Twelve spells, each a stand-in (`placeholder`) until it is drawn. To draw
 * one, replace its line with a visual of its own (`SpellVisual`, ./index; SPELLS.md has the
 * long form). This file is this group's alone and nobody else edits it, so anything its spells
 * share -- a slash, a sigil, a colour -- is written here, not in the kit.
 */
import { placeholder } from './generic';
import type { SpellVisual } from './index';
import type { SpellPalette } from './kit';

/** Bronze and ochre, with a sky-blue edge: the line held. */
export const PALETTE: SpellPalette = {
  core: '#fff1c4',
  main: '#d9a441',
  deep: '#8a5a22',
  accent: '#7fb3d5',
  ink: '#3b2610',
  light: '#ffc861',
};

export const PIKEMAN: Record<string, SpellVisual> = {
  // Warning Thrust (thrust, on enemy, lasts 30 s): A creature within your reach that is not fighting you will not come for you for 30 s, alone or with its pack, unless you strike it first.
  pikeman_warning_thrust: placeholder('pikeman_warning_thrust', PALETTE),
  // Overreach (thrust, on enemy): A blow at 110% on an enemy up to 2 tiles past your reach;
  pikeman_overreach: placeholder('pikeman_overreach', PALETTE),
  // Sweep the Legs (thrust, on enemy, lasts 8 s): A blow at 80%;
  pikeman_sweep_the_legs: placeholder('pikeman_sweep_the_legs', PALETTE),
  // Vital Thrust (thrust, on enemy): A blow at 120% that is critical twice as often as a swing is.
  pikeman_vital_thrust: placeholder('pikeman_vital_thrust', PALETTE),
  // Hook (thrust, on enemy): An enemy up to 4 tiles off is dragged 2 tiles towards you, no nearer than 1 tile, over ground it could walk, and turns on you as if struck.
  pikeman_hook: placeholder('pikeman_hook', PALETTE),
  // Rally the Line (nova, on self, 5 tiles round): You and everybody within 5 tiles of you get 20% of a full bar of stamina back.
  pikeman_rally_the_line: placeholder('pikeman_rally_the_line', PALETTE),
  // Twin Thrust (thrust, on enemy): Two blows at 70% each, one after the other.
  pikeman_twin_thrust: placeholder('pikeman_twin_thrust', PALETTE),
  // Reach Advantage (thrust, on enemy): A blow at 150% on a creature not yet within its own reach of you (1.1 tiles, or 6 for one that throws), and at 100% on one that is.
  pikeman_reach_advantage: placeholder('pikeman_reach_advantage', PALETTE),
  // Skewer (thrust, on enemy): A blow at 150%, and one at 60% on every enemy up to 2 tiles behind it and within 0.5 tiles of the line of the thrust.
  pikeman_skewer: placeholder('pikeman_skewer', PALETTE),
  // Keep Away (buff, on self, lasts 10 s): For 10 s every blow you land pushes what it lands on 1 tile further from you, over ground it could walk.
  pikeman_keep_away: placeholder('pikeman_keep_away', PALETTE),
  // Fend Off (buff, on self, lasts 8 s): For 8 s anything that comes within 1.1 tiles of you to strike is pushed 2 tiles back instead, over ground it could walk.
  pikeman_fend_off: placeholder('pikeman_fend_off', PALETTE),
  // Brace for the Charge (buff, on self, lasts 6 s): For 6 s the first creature that comes at you from outside your reach is stopped at the edge of it by a blow at 200%, and its next blow is put back...
  pikeman_brace_for_the_charge: placeholder('pikeman_brace_for_the_charge', PALETTE),
};
