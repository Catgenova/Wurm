/**
 * The Love path's techniques (`meditation.ts`): how each is cast and what it
 * looks like.
 *
 * Stand-ins for now (`placeholder`), each cast on oneself as a prayer is, in
 * the living island's colours: new leaf over the brown of turned earth. What
 * they do lands on a companion, a hunter or the caster's own body, and is
 * said rather than drawn.
 */
import type { SpellVisual } from './index';
import { placeholder } from './generic';
import type { SpellPalette } from './kit';
import { TECHNIQUES } from '../../game/meditation';

/** New leaf over turned earth. */
export const PALETTE: SpellPalette = {
  core: '#f6fff0',
  main: '#9fdc7a',
  deep: '#5a7a34',
  accent: '#f0c8d8',
  ink: '#3a2a1a',
  light: '#d8f5b8',
};

export const LOVE: Record<string, SpellVisual> = Object.fromEntries(
  TECHNIQUES.filter((k) => k.path === 'love').map((k) => [k.id, placeholder(k.id, PALETTE, 'pray')]),
);
