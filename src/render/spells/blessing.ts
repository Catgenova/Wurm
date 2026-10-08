/**
 * Blessing's spells: how each is cast and what it looks like.
 *
 * Fifteen spells, each a stand-in (`placeholder`) until it is drawn. To draw
 * one, replace its line with a visual of its own (`SpellVisual`, ./index; SPELLS.md has the
 * long form). This file is this group's alone and nobody else edits it, so anything its spells
 * share -- a slash, a sigil, a colour -- is written here, not in the kit.
 */
import { placeholder } from './generic';
import type { SpellVisual } from './index';
import type { SpellPalette } from './kit';

/** Dawn: gold and white. */
export const PALETTE: SpellPalette = {
  core: '#fffbea',
  main: '#ffd86b',
  deep: '#d69a2e',
  accent: '#ffffff',
  ink: '#5a3b0e',
  light: '#ffe9a0',
};

export const BLESSING: Record<string, SpellVisual> = {
  // Soothe (ally, on self, player): Heals 10% of their health and stops their worst bleeding wound bleeding.
  blessing_soothe: placeholder('blessing_soothe', PALETTE),
  // Ward (ally, on self, player, lasts 30 s): The next blow to land on them within 30 s does 50% less damage.
  blessing_ward: placeholder('blessing_ward', PALETTE),
  // Tend (ally, on wildermon): Heals the wildermon 25% of its health and stops it bleeding.
  blessing_tend: placeholder('blessing_tend', PALETTE),
  // Purify (ally, on self, player): Draws the venom out of every wound they have and closes every burn.
  blessing_purify: placeholder('blessing_purify', PALETTE),
  // Calm (ally, on enemy, lasts 60 s): A wild creature stops hunting and cannot start a hunt for 60 s.
  blessing_calm: placeholder('blessing_calm', PALETTE),
  // Steady Hands (pray, on object, lasts 1800 s): For 30 minutes, every job that wants this tool takes 10% less time while you carry it.
  blessing_steady: placeholder('blessing_steady', PALETTE),
  // Renewal (ally, on self, player, lasts 30 s): Heals 3% of their health every 3 s for 30 s: 30% in all.
  blessing_renewal: placeholder('blessing_renewal', PALETTE),
  // Bless Arms (ally, on self, player, lasts 60 s): For 60 s, their blows do 20% more damage to monsters.
  blessing_arms: placeholder('blessing_arms', PALETTE),
  // Kinship (ally, on wildermon, lasts 60 s): Your next go at taming this wildermon within 60 s is 25 points likelier to succeed.
  blessing_kinship: placeholder('blessing_kinship', PALETTE),
  // Benediction (ground, on area, 6 tiles round): Everybody within 6 tiles of the spot, you too, and every wildermon there heals 20% of their health and stops bleeding.
  blessing_benediction: placeholder('blessing_benediction', PALETTE),
  // Shield of Dawn (ally, on self, player, lasts 60 s): For 60 s, damage up to 30% of their health is taken by the shield instead of them.
  blessing_shield: placeholder('blessing_shield', PALETTE),
  // Sanctuary (ground, on area, 4 tiles round, lasts 30 s): For 30 s, nothing wild starts a hunt on anybody within 4 tiles of the spot, and whatever is hunting somebody there gives it up.
  blessing_sanctuary: placeholder('blessing_sanctuary', PALETTE),
  // Second Life (ally, on self, player, lasts 600 s): For 10 minutes, the first blow that would kill them leaves them at 50% of their health instead.
  blessing_second_life: placeholder('blessing_second_life', PALETTE),
  // Radiance (ground, on area, 8 tiles round, lasts 30 s): For 30 s, every creature within 8 tiles of the spot that is hunting somebody loses 2% of its health a second, 60% in all;
  blessing_radiance: placeholder('blessing_radiance', PALETTE),
  // Bless the Land (ground, on area, 10 tiles round): Every tree within 10 tiles of the spot grows a stage: sapling to young, young to mature, mature to old and old to very old.
  blessing_land: placeholder('blessing_land', PALETTE),
};
