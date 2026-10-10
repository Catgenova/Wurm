/**
 * The Knowledge path's techniques (`meditation.ts`): how each is cast and
 * what it looks like.
 *
 * Stand-ins for now (`placeholder`), each cast on oneself as a prayer is,
 * in the reader's colours: a lamp's warm white over an ink blue. Every one of
 * them is a thing found out rather than a thing done to anybody, so none of
 * them has anything to land on but the caster.
 */
import type { SpellVisual } from './index';
import { placeholder } from './generic';
import type { SpellPalette } from './kit';
import { TECHNIQUES } from '../../game/meditation';

/** A reading lamp's warm white over the blue of ink. */
export const PALETTE: SpellPalette = {
  core: '#fffaf0',
  main: '#f2d79a',
  deep: '#4a5f9c',
  accent: '#cfe0ff',
  ink: '#1e2a4f',
  light: '#ffe8b8',
};

export const KNOWLEDGE: Record<string, SpellVisual> = Object.fromEntries(
  TECHNIQUES.filter((k) => k.path === 'knowledge').map((k) => [k.id, placeholder(k.id, PALETTE, 'pray')]),
);
