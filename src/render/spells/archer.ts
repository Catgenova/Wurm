/**
 * The Archer's spells: how each is cast and what it looks like.
 *
 * Twelve spells, each a stand-in (`placeholder`) until it is drawn. To draw
 * one, replace its line with a visual of its own (`SpellVisual`, ./index; SPELLS.md has the
 * long form). This file is this group's alone and nobody else edits it, so anything its spells
 * share -- a slash, a sigil, a colour -- is written here, not in the kit.
 */
import { placeholder } from './generic';
import type { SpellVisual } from './index';
import type { SpellPalette } from './kit';

/** Leaf green and fletching gold. */
export const PALETTE: SpellPalette = {
  core: '#f4ffd8',
  main: '#8cc56a',
  deep: '#3f6b2f',
  accent: '#e9d36a',
  ink: '#1d3318',
  light: '#c8f08a',
};

export const ARCHER: Record<string, SpellVisual> = {
  // Quick Shot (shot, on enemy): With a bow in hand: a shot at 80%;
  archer_quick_shot: placeholder('archer_quick_shot', PALETTE),
  // Aimed Shot (shot, on enemy): With a bow in hand: a shot at 140% that cannot miss.
  archer_aimed_shot: placeholder('archer_aimed_shot', PALETTE),
  // Read the Wind (buff, on self, lasts 30 s): Your next shot within 30 s, a draw's or a spell's, cannot miss and is critical twice as often.
  archer_read_the_wind: placeholder('archer_read_the_wind', PALETTE),
  // Long Shot (shot, on enemy): With a bow in hand: a shot at 110% on an enemy up to half again your bow's range off, landing as often as one at the near end does.
  archer_long_shot: placeholder('archer_long_shot', PALETTE),
  // Crippling Shot (shot, on enemy, lasts 8 s): With a bow in hand: a shot at 80%;
  archer_crippling_shot: placeholder('archer_crippling_shot', PALETTE),
  // Point Blank (shot, on enemy): With a bow in hand: a shot at 160% on an enemy within 2 tiles of you, nearer than a draw can be made (1.2 tiles) as well.
  archer_point_blank: placeholder('archer_point_blank', PALETTE),
  // Twin Arrows (shot, on enemy): With a bow in hand: two arrows loosed at once, each a shot at 75%.
  archer_twin_arrows: placeholder('archer_twin_arrows', PALETTE),
  // Pinning Shot (shot, on enemy, lasts 2 s): With a bow in hand: a shot at 90% that holds it where it stands, neither moving nor striking, for 2 s;
  archer_pinning_shot: placeholder('archer_pinning_shot', PALETTE),
  // Expose (curse, on enemy, lasts 15 s): An enemy within 12 tiles: for 15 s every blow and shot a person lands on it does 15% more damage.
  archer_expose: placeholder('archer_expose', PALETTE),
  // Decoy (buff, on self, lasts 6 s): For 6 s every creature that strikes at you strikes a decoy at your feet instead, and nothing lands on you.
  archer_decoy: placeholder('archer_decoy', PALETTE),
  // Snipe (shot, on enemy): With a bow in hand: a shot at 300% on a creature that is not after anybody.
  archer_snipe: placeholder('archer_snipe', PALETTE),
  // Deadeye (buff, on self, lasts 10 s): For 10 s a draw takes 40% less time.
  archer_deadeye: placeholder('archer_deadeye', PALETTE),
};
