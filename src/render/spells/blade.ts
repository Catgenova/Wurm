/**
 * The Sworn Blade's spells: how each is cast and what it looks like.
 *
 * Twelve spells, each a stand-in (`placeholder`) until it is drawn. To draw
 * one, replace its line with a visual of its own (`SpellVisual`, ./index; SPELLS.md has the
 * long form). This file is this group's alone and nobody else edits it, so anything its spells
 * share -- a slash, a sigil, a colour -- is written here, not in the kit.
 */
import { placeholder } from './generic';
import type { SpellVisual } from './index';
import type { SpellPalette } from './kit';

/** Steel and a cold white edge, with brass where a blow lands. */
export const PALETTE: SpellPalette = {
  core: '#ffffff',
  main: '#c9d6e3',
  deep: '#6d7f94',
  accent: '#e8c35a',
  ink: '#27303d',
  light: '#bfd8ff',
};

export const BLADE: Record<string, SpellVisual> = {
  // Measured Cut (strike, on enemy): A blow at 130% that cannot miss, on an enemy within your reach.
  blade_measured_cut: placeholder('blade_measured_cut', PALETTE),
  // Challenge (curse, on enemy, lasts 10 s): The creature turns on you at once and hunts only you for 10 s.
  blade_challenge: placeholder('blade_challenge', PALETTE),
  // Lunge (strike, on enemy): You stride to an enemy up to 4 tiles off, over ground you could walk, and strike it at 150%.
  blade_lunge: placeholder('blade_lunge', PALETTE),
  // Hamstring (strike, on enemy, lasts 10 s): A blow at 80%;
  blade_hamstring: placeholder('blade_hamstring', PALETTE),
  // Shield Bash (strike, on enemy): With a shield in your off hand: a crushing blow at 70% that knocks a heavy blow off its stroke and puts its next blow back 2 s.
  blade_shield_bash: placeholder('blade_shield_bash', PALETTE),
  // Second Breath (buff, on self): Costs no stamina.
  blade_second_breath: placeholder('blade_second_breath', PALETTE),
  // Deflect (buff, on self, lasts 6 s): For 6 s, every blow you block lands back on what struck at 50% of the blow.
  blade_deflect: placeholder('blade_deflect', PALETTE),
  // Hold the Line (buff, on self, lasts 15 s): For 15 s your wounds bleed 50% less, and those on your arms do not slow your swing.
  blade_hold_the_line: placeholder('blade_hold_the_line', PALETTE),
  // Disarming Cut (strike, on enemy, lasts 30 s): A blow at 70%;
  blade_disarming_cut: placeholder('blade_disarming_cut', PALETTE),
  // Measured Breathing (buff, on self, lasts 20 s): For 20 s a swing or a draw costs no stamina.
  blade_measured_breathing: placeholder('blade_measured_breathing', PALETTE),
  // Guardian’s Call (nova, on self, 5 tiles round, lasts 8 s): Every creature within 5 tiles of you that is hunting somebody turns on you and hunts only you for 8 s.
  blade_guardians_call: placeholder('blade_guardians_call', PALETTE),
  // Last Stand (buff, on self, lasts 10 s): Costs no stamina.
  blade_last_stand: placeholder('blade_last_stand', PALETTE),
};
