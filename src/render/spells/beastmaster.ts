/**
 * The Beastmaster's spells: how each is cast and what it looks like.
 *
 * Twelve spells, each a stand-in (`placeholder`) until it is drawn. To draw
 * one, replace its line with a visual of its own (`SpellVisual`, ./index; SPELLS.md has the
 * long form). This file is this group's alone and nobody else edits it, so anything its spells
 * share -- a slash, a sigil, a colour -- is written here, not in the kit.
 */
import { placeholder } from './generic';
import type { SpellVisual } from './index';
import type { SpellPalette } from './kit';

/** Amber eyes and earth brown, with a green of the wild. */
export const PALETTE: SpellPalette = {
  core: '#fff0cc',
  main: '#e0a346',
  deep: '#7a4e1f',
  accent: '#8bbf5a',
  ink: '#352210',
  light: '#ffc760',
};

export const BEASTMASTER: Record<string, SpellVisual> = {
  // Sic (command, on enemy): With a companion following you: your companion strikes an enemy within its reach (0.9 tiles of it) at once, a blow at 130% of its own.
  beastmaster_sic: placeholder('beastmaster_sic', PALETTE),
  // Lick Wounds (command, on self): With a companion following you: your companion gets 15% of its health back.
  beastmaster_lick_wounds: placeholder('beastmaster_lick_wounds', PALETTE),
  // Pounce (command, on enemy): With a companion following you: your companion leaps onto an enemy up to 5 tiles from it, over ground it could run, and strikes it at 100% of its o...
  beastmaster_pounce: placeholder('beastmaster_pounce', PALETTE),
  // Snarl (command, on self, 4 tiles round): With a companion following you: every wild creature within 4 tiles of your companion turns on it.
  beastmaster_snarl: placeholder('beastmaster_snarl', PALETTE),
  // Guard Me (command, on self, 6 tiles round): With a companion following you: your companion leaps to your side, and every creature within 6 tiles of you that is hunting you turns on it.
  beastmaster_guard_me: placeholder('beastmaster_guard_me', PALETTE),
  // Drag Down (command, on enemy, lasts 4 s): With a companion following you: your companion strikes an enemy within its reach at 50% of its own blow, and holds it where it stands, neither movi...
  beastmaster_drag_down: placeholder('beastmaster_drag_down', PALETTE),
  // Disembowel (command, on enemy, lasts 8 s): With a companion following you: your companion strikes an enemy within its reach at 100% of its own blow, and the enemy bleeds 30% of the blow a se...
  beastmaster_disembowel: placeholder('beastmaster_disembowel', PALETTE),
  // Bloodlust (command, on self, lasts 15 s): With a companion following you: for 15 s your companion's blows are 40% larger.
  beastmaster_bloodlust: placeholder('beastmaster_bloodlust', PALETTE),
  // Vengeance (command, on self, 5 tiles round, lasts 20 s): With a companion following you: for 20 s, every creature that lands a blow on you is struck back by your companion at 60% of its own blow, when it...
  beastmaster_vengeance: placeholder('beastmaster_vengeance', PALETTE),
  // Feral Bond (command, on self, lasts 30 s): With a companion following you: for 30 s every blow that lands on you or on your companion is split between you, 50% to each.
  beastmaster_feral_bond: placeholder('beastmaster_feral_bond', PALETTE),
  // Primal Fury (command, on self, lasts 20 s): With a companion following you: for 20 s your companion's blows are 75% larger and come 50% more often.
  beastmaster_primal_fury: placeholder('beastmaster_primal_fury', PALETTE),
  // Call of the Wild (command, on enemy): A wild creature within 4 tiles of you whose tame level is no more than your taming is tamed outright, as a tame that takes: it follows you, or goes...
  beastmaster_call_of_the_wild: placeholder('beastmaster_call_of_the_wild', PALETTE),
};
