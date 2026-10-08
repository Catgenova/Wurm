/**
 * The Warder's spells: how each is cast and what it looks like.
 *
 * Twelve spells, and the arcane Aegis and Bulwark, each a stand-in (`placeholder`) until it is drawn. To draw
 * one, replace its line with a visual of its own (`SpellVisual`, ./index; SPELLS.md has the
 * long form). This file is this group's alone and nobody else edits it, so anything its spells
 * share -- a slash, a sigil, a colour -- is written here, not in the kit.
 */
import { placeholder } from './generic';
import type { SpellVisual } from './index';
import type { SpellPalette } from './kit';

/** A skin: topaz gold over emerald green. */
export const PALETTE: SpellPalette = {
  core: '#fffbe0',
  main: '#e8c95a',
  deep: '#3f9a62',
  accent: '#6fe0a0',
  ink: '#2a3a1a',
  light: '#f2e08a',
};

export const WARDER: Record<string, SpellVisual> = {
  // Ward (buff, on self, lasts 12 s): With a topaz or emerald focus in your pack: a skin of 40% over you.
  warder_ward: placeholder('warder_ward', PALETTE),
  // Ward Other (ally, on player, lasts 12 s): With a topaz or emerald focus in your pack: a skin of 40% over somebody within 6 tiles of you.
  warder_ward_other: placeholder('warder_ward_other', PALETTE),
  // Greater Ward (buff, on self, lasts 12 s): With a topaz or emerald focus in your pack: a skin of 100% over you.
  warder_greater_ward: placeholder('warder_greater_ward', PALETTE),
  // Thicken (buff, on self, lasts 60 s): With a topaz or emerald focus in your pack: the next skin you lay within 60 s, over anybody, is 50% larger.
  warder_thicken: placeholder('warder_thicken', PALETTE),
  // Greater Ward Other (ally, on player, lasts 12 s): With a topaz or emerald focus in your pack: a skin of 100% over somebody within 6 tiles of you.
  warder_greater_ward_other: placeholder('warder_greater_ward_other', PALETTE),
  // Ward Link (nova, on self, 8 tiles round, lasts 12 s): With a topaz or emerald focus in your pack: for 30 s, when a skin of yours over somebody within 8 tiles of you is used up, a skin of 30% goes back...
  warder_ward_link: placeholder('warder_ward_link', PALETTE),
  // Stoneskin (buff, on self, lasts 10 s): With a topaz or emerald focus in your pack: for 10 s you take 25% less from every blow.
  warder_stoneskin: placeholder('warder_stoneskin', PALETTE),
  // Ward Burst (nova, on self, 3 tiles round): With a topaz or emerald focus in your pack: the skin over you breaks, and every enemy within 3 tiles of you takes 1 damage for every hundredth of y...
  warder_ward_burst: placeholder('warder_ward_burst', PALETTE),
  // Deep Ward (buff, on self, lasts 12 s): With a topaz or emerald focus in your pack: a skin of 200% over you.
  warder_deep_ward: placeholder('warder_deep_ward', PALETTE),
  // Sanctuary (nova, on self, 6 tiles round, lasts 12 s): With a topaz or emerald focus in your pack: a skin of 80% over you and over everybody within 6 tiles of you.
  warder_sanctuary: placeholder('warder_sanctuary', PALETTE),
  // Bastion of Stone (nova, on self, 4 tiles round, lasts 10 s): With a topaz or emerald focus in your pack: for 10 s you and everybody within 4 tiles of you take 40% less from every blow.
  warder_bastion_of_stone: placeholder('warder_bastion_of_stone', PALETTE),
  // Unbreakable (buff, on self, lasts 6 s): With a topaz or emerald focus in your pack: for 6 s no blow aimed at you lands.
  warder_unbreakable: placeholder('warder_unbreakable', PALETTE),

  /* ---- the arcane, out of a focus ---- */
  // Aegis (buff, on self, lasts 12 s): A skin over you that takes the blows instead, until it is used up.
  aegis: placeholder('aegis', PALETTE),
  // Bulwark (nova, on self, 3 tiles round, lasts 12 s): The same skin, over everybody standing near you.
  bulwark: placeholder('bulwark', PALETTE),
};
