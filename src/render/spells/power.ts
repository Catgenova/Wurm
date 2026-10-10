/**
 * The Power path's techniques (`meditation.ts`): how each is cast and what it
 * looks like.
 *
 * Stand-ins for now (`placeholder`), each cast on oneself as a prayer is, in
 * the body's own colours: the red of a hard-worked face over iron. Every one
 * of them is done to the caster's own body, so none has anything else to land
 * on.
 */
import type { SpellVisual } from './index';
import { placeholder } from './generic';
import type { SpellPalette } from './kit';
import { TECHNIQUES } from '../../game/meditation';

/** A hard-worked face's red over iron. */
export const PALETTE: SpellPalette = {
  core: '#fff4ec',
  main: '#e8875a',
  deep: '#7a3a24',
  accent: '#c8ccd4',
  ink: '#2a2420',
  light: '#ffc8a0',
};

export const POWER: Record<string, SpellVisual> = Object.fromEntries(
  TECHNIQUES.filter((k) => k.path === 'power').map((k) => [k.id, placeholder(k.id, PALETTE, 'pray')]),
);
