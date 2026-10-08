/**
 * The Binder's spells: how each is cast and what it looks like.
 *
 * Twelve spells, and the arcane Snare and Still field, each a stand-in (`placeholder`) until it is drawn. To draw
 * one, replace its line with a visual of its own (`SpellVisual`, ./index; SPELLS.md has the
 * long form). This file is this group's alone and nobody else edits it, so anything its spells
 * share -- a slash, a sigil, a colour -- is written here, not in the kit.
 */
import { placeholder } from './generic';
import type { SpellVisual } from './index';
import type { SpellPalette } from './kit';

/** Stillness: ice blue going to violet. Sapphire and diamond. */
export const PALETTE: SpellPalette = {
  core: '#eef8ff',
  main: '#7fb7ff',
  deep: '#3b5cc4',
  accent: '#c6a8ff',
  ink: '#141f4a',
  light: '#8fc4ff',
};

export const BINDER: Record<string, SpellVisual> = {
  // Bind (bolt, on enemy, lasts 3.06286 s): With a sapphire or diamond focus in your pack: an enemy within 8 tiles of you is held at 40%, neither moving nor striking;
  binder_bind: placeholder('binder_bind', PALETTE),
  // Shatter (bolt, on enemy): With a sapphire or diamond focus in your pack: shatter at 100% on an enemy within 8 tiles of you, or shatter at 200% on one that is held.
  binder_shatter: placeholder('binder_shatter', PALETTE),
  // Root (bolt, on enemy, lasts 8 s): With a sapphire or diamond focus in your pack: an enemy within 8 tiles of you is rooted for 8 s: it cannot move, but strikes and throws at anything...
  binder_root: placeholder('binder_root', PALETTE),
  // Stillness (buff, on self): With a sapphire or diamond focus in your pack: every wound on you stops bleeding.
  binder_stillness: placeholder('binder_stillness', PALETTE),
  // Heavy Limbs (bolt, on enemy, lasts 10 s): With a sapphire or diamond focus in your pack: for 10 s an enemy within 8 tiles of you strikes 30% less often.
  binder_heavy_limbs: placeholder('binder_heavy_limbs', PALETTE),
  // Dull Claws (bolt, on enemy, lasts 10 s): With a sapphire or diamond focus in your pack: for 10 s every blow an enemy within 8 tiles of you lands, on you or on anything else, is 30% smaller.
  binder_dull_claws: placeholder('binder_dull_claws', PALETTE),
  // Tether (bolt, on enemy, lasts 15 s): With a sapphire or diamond focus in your pack: for 15 s an enemy within 8 tiles of you cannot go more than 3 tiles from where it stood.
  binder_tether: placeholder('binder_tether', PALETTE),
  // Brittle (bolt, on enemy, lasts 10 s): With a sapphire or diamond focus in your pack: for 10 s an enemy within 8 tiles of you takes 25% more from everything that strikes it: blows, shots...
  binder_brittle: placeholder('binder_brittle', PALETTE),
  // Lock (bolt, on enemy, lasts 7.65714 s): With a sapphire or diamond focus in your pack: an enemy within 8 tiles of you is held at 100%, neither moving nor striking;
  binder_lock: placeholder('binder_lock', PALETTE),
  // Still Skin (buff, on self, lasts 10 s): With a sapphire or diamond focus in your pack: for 10 s you take 20% less from every blow.
  binder_still_skin: placeholder('binder_still_skin', PALETTE),
  // Mire (nova, on self, 4 tiles round, lasts 10 s): With a sapphire or diamond focus in your pack: every enemy within 4 tiles of you walks, hunts and flees at 60% of its pace for 10 s.
  binder_mire: placeholder('binder_mire', PALETTE),
  // Mass Root (nova, on self, 4 tiles round, lasts 6 s): With a sapphire or diamond focus in your pack: every enemy within 4 tiles of you is rooted for 6 s: it cannot move, but strikes and throws at anyth...
  binder_mass_root: placeholder('binder_mass_root', PALETTE),

  /* ---- the arcane, out of a focus ---- */
  // Snare (bolt, on enemy, lasts 7.65714 s): One thing, standing exactly where it is.
  snare: placeholder('snare', PALETTE),
  // Still field (nova, on self, 3 tiles round, lasts 4.78571 s): Everything close enough, for rather less time each.
  stillfield: placeholder('stillfield', PALETTE),
};
