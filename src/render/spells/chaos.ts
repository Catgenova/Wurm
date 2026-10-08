/**
 * Chaos's spells: how each is cast and what it looks like.
 *
 * Fifteen spells, each a stand-in (`placeholder`) until it is drawn. To draw
 * one, replace its line with a visual of its own (`SpellVisual`, ./index; SPELLS.md has the
 * long form). This file is this group's alone and nobody else edits it, so anything its spells
 * share -- a slash, a sigil, a colour -- is written here, not in the kit.
 */
import { placeholder } from './generic';
import type { SpellVisual } from './index';
import type { SpellPalette } from './kit';

/** Ruin: violet and black, with a sick green. */
export const PALETTE: SpellPalette = {
  core: '#f0c8ff',
  main: '#a64dd6',
  deep: '#4a1a6e',
  accent: '#7dff6a',
  ink: '#1c0828',
  light: '#b45cff',
};

export const CHAOS: Record<string, SpellVisual> = {
  // Hex (curse, on enemy, lasts 15 s): The creature bleeds 2% of its health a second for 15 s, 30% in all.
  chaos_hex: placeholder('chaos_hex', PALETTE),
  // Fright (curse, on enemy, lasts 8 s): The creature flees from you for 8 s.
  chaos_fright: placeholder('chaos_fright', PALETTE),
  // Blood Price (pray, on self): Costs no favour.
  chaos_blood_price: placeholder('chaos_blood_price', PALETTE),
  // Siphon (bolt, on enemy): Takes 10% of the creature's health, and heals you by what a blow of that much would take from you.
  chaos_siphon: placeholder('chaos_siphon', PALETTE),
  // Cower (curse, on enemy, lasts 30 s): For 30 s the creature's blows do 30% less damage.
  chaos_cower: placeholder('chaos_cower', PALETTE),
  // Pact (pray, on self, lasts 60 s): Costs no favour.
  chaos_pact: placeholder('chaos_pact', PALETTE),
  // Plague (ground, on area, 5 tiles round, lasts 30 s): Every wild creature within 5 tiles of the spot bleeds 1.5% of its health a second for 30 s, 45% in all.
  chaos_plague: placeholder('chaos_plague', PALETTE),
  // Panic (ground, on area, 6 tiles round, lasts 10 s): Every wild creature within 6 tiles of the spot flees from it for 10 s, a monster for 3 s.
  chaos_panic: placeholder('chaos_panic', PALETTE),
  // Unmake (pray, on object): Costs no favour.
  chaos_unmake: placeholder('chaos_unmake', PALETTE),
  // Soul Rend (bolt, on enemy): Takes 30% of the creature's health;
  chaos_soul_rend: placeholder('chaos_soul_rend', PALETTE),
  // Shroud (pray, on self, 3 tiles round, lasts 60 s): For 60 s nothing notices you from further than 3 tiles off, and whatever is hunting you from further than that loses you.
  chaos_shroud: placeholder('chaos_shroud', PALETTE),
  // Blood Feast (pray, on self, lasts 60 s): Costs no favour.
  chaos_blood_feast: placeholder('chaos_blood_feast', PALETTE),
  // Cataclysm (ground, on area, 8 tiles round): Every wild creature within 8 tiles of the spot loses 40% of its health at once.
  chaos_cataclysm: placeholder('chaos_cataclysm', PALETTE),
  // Abyssal Gaze (curse, on enemy, lasts 15 s): The creature flees from you for 15 s, monsters too, and takes 50% more damage from every blow while it does.
  chaos_abyssal_gaze: placeholder('chaos_abyssal_gaze', PALETTE),
  // Undying (pray, on self, lasts 60 s): Costs no favour.
  chaos_undying: placeholder('chaos_undying', PALETTE),
};
