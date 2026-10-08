/**
 * The Kindler's spells: how each is cast and what it looks like.
 *
 * Twelve spells, and the arcane Ember and Pyre, each a stand-in (`placeholder`) until it is drawn. To draw
 * one, replace its line with a visual of its own (`SpellVisual`, ./index; SPELLS.md has the
 * long form). This file is this group's alone and nobody else edits it, so anything its spells
 * share -- a slash, a sigil, a colour -- is written here, not in the kit.
 */
import { placeholder } from './generic';
import type { SpellVisual } from './index';
import type { SpellPalette } from './kit';

/** Fire: a white-yellow heart, orange body, a deep red edge. Garnet and ruby. */
export const PALETTE: SpellPalette = {
  core: '#fff2a8',
  main: '#ff7a1a',
  deep: '#b3300f',
  accent: '#ffd23a',
  ink: '#4a1305',
  light: '#ff8a2a',
};

export const KINDLER: Record<string, SpellVisual> = {
  // Scorch (bolt, on enemy, lasts 8 s): With a garnet or ruby focus in your pack: fire at 80% on an enemy within 8 tiles of you, and it burns 1% of its full health a second for 8 s;
  kindler_scorch: placeholder('kindler_scorch', PALETTE),
  // Heat Seeker (nova, on self, 10 tiles round): With a garnet or ruby focus in your pack: fire at 100% on the enemy within 10 tiles of you with the smallest share of its full health left, the nea...
  kindler_heat_seeker: placeholder('kindler_heat_seeker', PALETTE),
  // Scald (bolt, on enemy, lasts 6 s): With a garnet or ruby focus in your pack: fire at 70% on an enemy within 8 tiles of you;
  kindler_scald: placeholder('kindler_scald', PALETTE),
  // Flash Fire (bolt, on enemy): With a garnet or ruby focus in your pack: fire at 200% on an enemy within 2 tiles of you.
  kindler_flash_fire: placeholder('kindler_flash_fire', PALETTE),
  // Stoke (buff, on self, lasts 60 s): With a garnet or ruby focus in your pack: the next spell of yours within 60 s that deals fire deals 50% more of it, on every creature it lands on.
  kindler_stoke: placeholder('kindler_stoke', PALETTE),
  // Firebrand (buff, on self, lasts 30 s): With a garnet or ruby focus in your pack: for 30 s every burn you start lasts twice as long.
  kindler_firebrand: placeholder('kindler_firebrand', PALETTE),
  // Immolate (bolt, on enemy, lasts 15 s): With a garnet or ruby focus in your pack: an enemy within 8 tiles of you burns 2% of its full health a second for 15 s;
  kindler_immolate: placeholder('kindler_immolate', PALETTE),
  // Combust (bolt, on enemy): With a garnet or ruby focus in your pack: a burning enemy within 8 tiles of you takes at once 150% of what its burn still had to do (its burn a sec...
  kindler_combust: placeholder('kindler_combust', PALETTE),
  // Blaze Aura (nova, on self, 2 tiles round, lasts 15 s): With a garnet or ruby focus in your pack: for 15 s, fire at 30% a second on every enemy within 2 tiles of you, as large as your fire is when you ca...
  kindler_blaze_aura: placeholder('kindler_blaze_aura', PALETTE),
  // Inferno Bolt (bolt, on enemy, lasts 10 s): With a garnet or ruby focus in your pack: fire at 300% on an enemy within 10 tiles of you, and it burns 3% of its full health a second for 10 s;
  kindler_inferno_bolt: placeholder('kindler_inferno_bolt', PALETTE),
  // Meteor (bolt, on enemy, 3 tiles round): With a garnet or ruby focus in your pack: fire at 400% on an enemy within 12 tiles of you, and fire at 150% on every other enemy within 3 tiles of it.
  kindler_meteor: placeholder('kindler_meteor', PALETTE),
  // Firestorm (nova, on self, 6 tiles round, lasts 10 s): With a garnet or ruby focus in your pack: fire at 100% on every enemy within 6 tiles of you, and each burns 2% of its full health a second for 10 s;
  kindler_firestorm: placeholder('kindler_firestorm', PALETTE),

  /* ---- the arcane, out of a focus ---- */
  // Ember (bolt, on enemy): A coal out of the stone, put where you are looking.
  ember: placeholder('ember', PALETTE),
  // Pyre (nova, on self, 3 tiles round): Everything close enough to feel it, at once.
  pyre: placeholder('pyre', PALETTE),
};
