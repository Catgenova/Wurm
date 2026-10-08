/**
 * Justice's spells: how each is cast and what it looks like.
 *
 * Fifteen spells, each a stand-in (`placeholder`) until it is drawn. To draw
 * one, replace its line with a visual of its own (`SpellVisual`, ./index; SPELLS.md has the
 * long form). This file is this group's alone and nobody else edits it, so anything its spells
 * share -- a slash, a sigil, a colour -- is written here, not in the kit.
 */
import { placeholder } from './generic';
import type { SpellVisual } from './index';
import type { SpellPalette } from './kit';

/** The scales: silver blue and a pale violet. */
export const PALETTE: SpellPalette = {
  core: '#f3f5ff',
  main: '#9fb4ff',
  deep: '#4b5aa8',
  accent: '#e6e8ff',
  ink: '#1d2350',
  light: '#b8c6ff',
};

export const JUSTICE: Record<string, SpellVisual> = {
  // Mark of Judgment (curse, on enemy, lasts 30 s): For 30 s the creature takes 15% more damage from every blow, whoever or whatever strikes it.
  justice_mark: placeholder('justice_mark', PALETTE),
  // Retribution (ally, on self, player, lasts 60 s): For 60 s, 20% of every blow that lands on them is dealt back to whatever struck.
  justice_retribution: placeholder('justice_retribution', PALETTE),
  // Assay (ground, on area, 8 tiles round, lasts 600 s): Every ore seam under the ground within 8 tiles of the spot is marked for you for 10 minutes, as a prospector's sensing marks it.
  justice_assay: placeholder('justice_assay', PALETTE),
  // Sentence (bolt, on enemy): Strikes the creature for 25% of the health it has already lost.
  justice_sentence: placeholder('justice_sentence', PALETTE),
  // Bind (curse, on enemy, lasts 5 s): Holds the creature where it stands for 5 s: it neither moves nor strikes.
  justice_bind: placeholder('justice_bind', PALETTE),
  // Equity (ally, on player): You and the other person both end at the average of your healths.
  justice_equity: placeholder('justice_equity', PALETTE),
  // Verdict (bolt, on enemy): A creature below 20% of its health dies at once, a monster below 10%;
  justice_verdict: placeholder('justice_verdict', PALETTE),
  // Summons (curse, on enemy, lasts 20 s): The creature turns on you and hunts only you for 20 s, whoever it was after.
  justice_summons: placeholder('justice_summons', PALETTE),
  // Temper (pray, on object, lasts 1800 s): For 30 minutes, the thing takes no wear at all while you carry it.
  justice_temper: placeholder('justice_temper', PALETTE),
  // Judgment (ground, on area, 6 tiles round, lasts 30 s): Every creature within 6 tiles of the spot that is hunting somebody loses 15% of its health and, for 30 s, takes 15% more damage from every blow.
  justice_judgment: placeholder('justice_judgment', PALETTE),
  // Truce (ground, on area, 8 tiles round, lasts 30 s): For 30 s, nothing within 8 tiles of the spot can strike or be struck, people and creatures alike.
  justice_truce: placeholder('justice_truce', PALETTE),
  // Restitution (ally, on self, player): Everything in their latest grave comes back into their pack, wherever they are.
  justice_restitution: placeholder('justice_restitution', PALETTE),
  // Execution (bolt, on enemy): A creature below 50% of its health dies at once, a monster below 30%;
  justice_execution: placeholder('justice_execution', PALETTE),
  // Oath (ally, on player, lasts 600 s): For 10 minutes, every blow that lands on you or on the friend it is cast on is split evenly between you.
  justice_oath: placeholder('justice_oath', PALETTE),
  // Due Reward (ally, on self, player, lasts 1800 s): For 30 minutes, every skill they raise gains 20% more.
  justice_reward: placeholder('justice_reward', PALETTE),
};
