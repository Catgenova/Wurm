/**
 * The Chirurgeon's spells: how each is cast and what it looks like.
 *
 * Twelve spells, each a stand-in (`placeholder`) until it is drawn. To draw
 * one, replace its line with a visual of its own (`SpellVisual`, ./index; SPELLS.md has the
 * long form). This file is this group's alone and nobody else edits it, so anything its spells
 * share -- a slash, a sigil, a colour -- is written here, not in the kit.
 */
import { placeholder } from './generic';
import type { SpellVisual } from './index';
import type { SpellPalette } from './kit';

/** Clean mint for what mends, and a blood red for what bleeds. */
export const PALETTE: SpellPalette = {
  core: '#f2fff7',
  main: '#8fe0b0',
  deep: '#3d8a63',
  accent: '#d65a6a',
  ink: '#16392a',
  light: '#a6ffcf',
};

export const CHIRURGEON: Record<string, SpellVisual> = {
  // Field Dressing (ally, on self, player, 2 tiles round): You or somebody within 2 tiles of you gets 10% of their health back, and their worst bleeding wound stops bleeding.
  chirurgeon_field_dressing: placeholder('chirurgeon_field_dressing', PALETTE),
  // Quick Stitch (ally, on self, player, 2 tiles round): The worst wound on you or on somebody within 2 tiles of you closes by 30% of its severity.
  chirurgeon_quick_stitch: placeholder('chirurgeon_quick_stitch', PALETTE),
  // Leech (strike, on enemy): With a knife in hand: a knife blow at 80%, and you get back as large a share of your health as it takes of the creature's.
  chirurgeon_leech: placeholder('chirurgeon_leech', PALETTE),
  // Regenerate (ally, on self, player, 4 tiles round, lasts 15 s): You or somebody within 4 tiles of you gets 2% of their health back a second for 15 s.
  chirurgeon_regenerate: placeholder('chirurgeon_regenerate', PALETTE),
  // Toxin (curse, on enemy, lasts 20 s): An enemy within 4 tiles of you bleeds 1% of its full health a second for 20 s;
  chirurgeon_toxin: placeholder('chirurgeon_toxin', PALETTE),
  // Surgeon’s Hands (buff, on self, lasts 20 s): For 20 s every dressing you put on puts back twice as much health.
  chirurgeon_surgeons_hands: placeholder('chirurgeon_surgeons_hands', PALETTE),
  // Healing Circle (nova, on self, 4 tiles round): You and everybody within 4 tiles of you each get back 15% of their own full health.
  chirurgeon_healing_circle: placeholder('chirurgeon_healing_circle', PALETTE),
  // Mass Dressing (nova, on self, 3 tiles round): On you and everybody within 3 tiles of you, the worst wound stops bleeding and closes by 20% of its severity.
  chirurgeon_mass_dressing: placeholder('chirurgeon_mass_dressing', PALETTE),
  // Plague (nova, on self, 4 tiles round, lasts 10 s): Every enemy within 4 tiles of you bleeds 1% of its full health a second for 10 s;
  chirurgeon_plague: placeholder('chirurgeon_plague', PALETTE),
  // Battlefield Surgery (ally, on self, player, 2 tiles round): Every wound on you or on somebody within 2 tiles of you closes by 50% of its severity, and they get 20% of their health back.
  chirurgeon_battlefield_surgery: placeholder('chirurgeon_battlefield_surgery', PALETTE),
  // Restoration (buff, on self): Every wound on you closes, and you get 30% of your health back.
  chirurgeon_restoration: placeholder('chirurgeon_restoration', PALETTE),
  // Miracle Worker (ally, on self, player, 4 tiles round): Every wound on you or on somebody within 4 tiles of you closes, with whatever bleeding and venom was in it, and they get 50% of their health back.
  chirurgeon_miracle_worker: placeholder('chirurgeon_miracle_worker', PALETTE),
};
