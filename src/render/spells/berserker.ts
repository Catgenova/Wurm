/**
 * The Berserker's spells: how each is cast and what it looks like.
 *
 * Twelve spells, each a stand-in (`placeholder`) until it is drawn. To draw
 * one, replace its line with a visual of its own (`SpellVisual`, ./index; SPELLS.md has the
 * long form). This file is this group's alone and nobody else edits it, so anything its spells
 * share -- a slash, a sigil, a colour -- is written here, not in the kit.
 */
import { placeholder } from './generic';
import type { SpellVisual } from './index';
import type { SpellPalette } from './kit';

/** Blood red going to ember orange: rage, and what it costs. */
export const PALETTE: SpellPalette = {
  core: '#ffd9b0',
  main: '#d8452c',
  deep: '#7e1c16',
  accent: '#ff9a3c',
  ink: '#3a0f0c',
  light: '#ff6a3a',
};

export const BERSERKER: Record<string, SpellVisual> = {
  // Wild Swing (strike, on enemy): A blow at 140% that misses twice as often as a swing does.
  berserker_wild_swing: placeholder('berserker_wild_swing', PALETTE),
  // Shrug It Off (buff, on self): Your worst wound is 50% less severe, and it stops bleeding.
  berserker_shrug_it_off: placeholder('berserker_shrug_it_off', PALETTE),
  // Rending Chop (strike, on enemy): With an axe in hand: a blow at 110% that bleeds it as a knife does, 15% of the blow a second for 6 s.
  berserker_rending_chop: placeholder('berserker_rending_chop', PALETTE),
  // Skull Crack (strike, on enemy, lasts 2 s): With a maul in hand: a blow at 120% that holds it where it stands, neither moving nor striking, for 2 s;
  berserker_skull_crack: placeholder('berserker_skull_crack', PALETTE),
  // Battle Rage (buff, on self, lasts 15 s): For 15 s you deal 30% more damage and take 20% more.
  berserker_battle_rage: placeholder('berserker_battle_rage', PALETTE),
  // Adrenaline (buff, on self, lasts 10 s): Costs no stamina.
  berserker_adrenaline: placeholder('berserker_adrenaline', PALETTE),
  // Blood Price (strike, on enemy): Costs no stamina but 10% of your health: a blow at 250%.
  berserker_blood_price: placeholder('berserker_blood_price', PALETTE),
  // Execute (strike, on enemy): A blow at 300% on a creature below 25% of its health, and at 100% on one above it.
  berserker_execute: placeholder('berserker_execute', PALETTE),
  // Overhead Smash (strike, on enemy): A crushing blow at 250% that cannot miss;
  berserker_overhead_smash: placeholder('berserker_overhead_smash', PALETTE),
  // Whirlwind (nova, on self, 2 tiles round): Two blows at 90% on every enemy within 2 tiles of you.
  berserker_whirlwind: placeholder('berserker_whirlwind', PALETTE),
  // Earthshaker (nova, on self, 3 tiles round, lasts 1 s): With a maul in hand: a blow at 100% on every enemy within 3 tiles of you, and each one held where it stands for 1 s.
  berserker_earthshaker: placeholder('berserker_earthshaker', PALETTE),
  // Last Rage (buff, on self, lasts 10 s): Costs no stamina.
  berserker_last_rage: placeholder('berserker_last_rage', PALETTE),
};
