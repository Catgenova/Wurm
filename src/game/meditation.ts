import type { ActionDef } from './actions';
import type { Game } from './game';
import { world } from './pace';

/**
 * Meditation, and the three paths.
 *
 * Sitting still on a rug and thinking about nothing is not obviously work,
 * and it is the slowest thing anybody does here. What comes of it is a
 * **path**: one of three ways of looking at the island, chosen once and never
 * changed, which opens out as the sitting goes on and leaves things behind
 * that nothing else gives.
 *
 * **Love** is the gardener's path: things grow for you, things trust you, and
 * what is hurt mends. **Knowledge** is the reader's: the work goes in faster,
 * you see further, and you can read what is in front of you. **Power** is the
 * plain one: you carry more, you hit harder, and less of what is aimed at you
 * lands.
 */

export const MEDITATION = 'meditation';

export type PathId = 'love' | 'knowledge' | 'power';

export interface PathStep {
  /** Meditation it takes. */
  at: number;
  name: string;
  note: string;
  /** An ability that is called on, rather than something that is simply true. */
  ability?: { id: string; rest: number; note: string };
}

export interface PathDef {
  id: PathId;
  name: string;
  note: string;
  steps: PathStep[];
}

export const PATHS: Record<PathId, PathDef> = {
  love: {
    id: 'love',
    name: 'Love',
    note: 'The gardener’s way. Things grow for you, things trust you, and what is hurt mends.',
    steps: [
      { at: 3, name: 'Green thumb', note: 'Everything sown on your settlement comes on a fifth faster.' },
      { at: 12, name: 'Refresh', note: 'Hunger and thirst, both full, in a breath.', ability: { id: 'refresh', rest: 20 * 60, note: 'You are neither hungry nor thirsty.' } },
      { at: 25, name: 'Gentle hand', note: 'A wild thing is a quarter readier to trust you.' },
      { at: 45, name: 'Mend the flesh', note: 'Everything open on you closes and a good deal of the damage goes with it.', ability: { id: 'mendflesh', rest: 40 * 60, note: 'Wounds closed.' } },
      { at: 70, name: 'Abundance', note: 'A harvest gives a third more than it did.' },
    ],
  },
  knowledge: {
    id: 'knowledge',
    name: 'Knowledge',
    note: 'The reader’s way. The work goes in faster, you see further, and you can read what is in front of you.',
    steps: [
      { at: 3, name: 'Attentive', note: 'Everything you do teaches you a tenth faster, for good.' },
      { at: 12, name: 'Sense the rock', note: 'What metal is under the ground within fifteen tiles, all at once.', ability: { id: 'sense', rest: 15 * 60, note: 'The ground gives up what is in it.' } },
      { at: 25, name: 'Reader', note: 'You read the blood of any wildermon at a glance, whatever your husbandry.' },
      { at: 45, name: 'Recall the way', note: 'You are standing at your own token, however far off you had got.', ability: { id: 'recall', rest: 40 * 60, note: 'Home.' } },
      { at: 70, name: 'Keen sight', note: 'You see a quarter further than anybody else on the island.' },
    ],
  },
  power: {
    id: 'power',
    name: 'Power',
    note: 'The plain way. You carry more, you hit harder, and less of what is aimed at you lands.',
    steps: [
      { at: 3, name: 'Strong back', note: 'You carry a fifth more than your body says you should.' },
      { at: 12, name: 'Second wind', note: 'Your wind comes back all at once.', ability: { id: 'secondwind', rest: 12 * 60, note: 'Wind back.' } },
      { at: 25, name: 'Hard hands', note: 'You hit a sixth harder with anything, or with nothing.' },
      { at: 45, name: 'Fury', note: 'For half a minute everything you hit takes twice what it would.', ability: { id: 'fury', rest: 40 * 60, note: 'Fury.' } },
      { at: 70, name: 'Ironhide', note: 'What you are wearing turns a tenth more of every blow.' },
    ],
  },
};

export const PATH_LIST = Object.values(PATHS);
/** The path may be chosen once this much meditation is behind you. */
export const CHOOSE_AT = 5;
/** How long between sittings that are worth anything. */
export const SIT_REST = world(12 * 60);

/** How many steps of their path somebody has behind them. */
export function stepsOf(path: PathId | null, meditation: number): number {
  if (!path) return 0;
  return PATHS[path].steps.filter((s) => meditation >= s.at).length;
}

/** Whether a particular step is behind them, by its one-based number. */
export const hasStep = (path: PathId | null, meditation: number, n: number): boolean => stepsOf(path, meditation) >= n;

/** The next step and what it wants, for the panel. */
export function nextStep(path: PathId | null, meditation: number): PathStep | null {
  if (!path) return null;
  return PATHS[path].steps.find((s) => meditation < s.at) ?? null;
}

/** Every ability the walker of this path may call on. */
export function abilitiesOf(path: PathId | null, meditation: number): PathStep[] {
  if (!path) return [];
  return PATHS[path].steps.filter((s) => s.ability && meditation >= s.at);
}

/**
 * What a sitting is worth. Somewhere quiet and out of the way is worth more
 * than the middle of your own yard: the island does not give up much to
 * somebody who has not gone looking.
 */
export function sittingWorth(g: Game): { gain: number; where: string } {
  const x = g.player.tileX;
  const y = g.player.tileY;
  let quiet = 1;
  let where = 'You sit down and let the day go past.';
  const onDeed = g.deed && g.onDeed(x, y);
  if (onDeed) {
    quiet *= 0.7;
    where = 'You sit in your own yard. It is hard to empty your head where there is so much to do.';
  }
  // High, wild ground is what the paths are walked on.
  const h = g.world.centerHeight(x, y);
  if (h > 60) {
    quiet *= 1.6;
    where = 'You sit where the ground runs out and the air is thin, and the day goes past a long way below.';
  } else if (h > 25 && !onDeed) {
    quiet *= 1.25;
    where = 'You sit on the high ground with your back to a stone.';
  }
  if (g.world.hasWater(x, y)) {
    quiet *= 1.3;
    where = 'You sit with your feet in the water and let it go past.';
  }
  return { gain: 1.5 * quiet, where };
}

const rugDown = (g: Game): boolean => g.inventory.has('rug');

export const MEDITATION_ACTIONS: ActionDef[] = [
  {
    id: 'meditate',
    label: 'Sit and think about nothing',
    verb: 'sitting',
    skill: MEDITATION,
    stamina: 0,
    baseTime: 25,
    applies: (t, g) => t.kind === 'tile' && rugDown(g),
    check: (t, g) => {
      if (!rugDown(g)) return 'You need a rug to sit on.';
      const rest = g.player.satAt + SIT_REST - g.time;
      if (rest > 0) return `You have sat today and got what there was to get. ${Math.ceil(rest / 60)} minutes.`;
      return null;
    },
    perform: (t, g) => {
      const { gain, where } = sittingWorth(g);
      const before = g.skills.get(MEDITATION);
      g.player.satAt = g.time;
      g.gainSkill(MEDITATION, gain);
      g.note('sat');
      const now = g.skills.get(MEDITATION);
      g.logMsg(where, 'event');
      if (!g.player.way && now >= CHOOSE_AT && before < CHOOSE_AT) {
        g.logMsg('Something settles. Three ways of looking at all this have become clear, and you may walk exactly one of them. Choose from the rug.', 'system');
      }
      const path = g.player.way;
      if (path) {
        for (const s of PATHS[path].steps) {
          if (before < s.at && now >= s.at) {
            g.note('path');
            g.logMsg(`${PATHS[path].name}: ${s.name}. ${s.note}`, 'system');
          }
        }
      }
    },
  },
  {
    id: 'choose_path',
    label: 'Choose a path',
    verb: 'choosing',
    hidden: true,
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => !g.player.way && g.skills.get(MEDITATION) >= CHOOSE_AT,
    check: (t, g) => {
      if (g.player.way) return 'You have chosen, and it is not the sort of thing that is chosen twice.';
      if (g.skills.get(MEDITATION) < CHOOSE_AT) return `Sit until you have ${CHOOSE_AT} meditation behind you.`;
      const id = t.kind === 'tile' ? (t.material as PathId | undefined) : undefined;
      if (!id || !PATHS[id]) return 'Choose one of the three.';
      return null;
    },
    perform: (t, g) => {
      const id = t.kind === 'tile' ? (t.material as PathId | undefined) : undefined;
      if (!id || !PATHS[id] || g.player.way) return;
      g.player.way = id;
      g.note('path');
      g.logMsg(`You take the path of ${PATHS[id].name}. ${PATHS[id].note}`, 'system');
    },
  },
  {
    id: 'use_ability',
    label: 'Call on what you know',
    verb: 'calling on it',
    hidden: true,
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => abilitiesOf(g.player.way, g.skills.get(MEDITATION)).length > 0,
    labelFor: (t, g) => {
      const id = t.kind === 'tile' ? t.material : undefined;
      const step = abilitiesOf(g.player.way, g.skills.get(MEDITATION)).find((s) => s.ability?.id === id);
      return step ? step.name : 'Call on what you know';
    },
    check: (t, g) => {
      const id = t.kind === 'tile' ? t.material : undefined;
      const step = abilitiesOf(g.player.way, g.skills.get(MEDITATION)).find((s) => s.ability?.id === id);
      if (!step?.ability) return 'That is not something you know.';
      const rest = (g.player.usedAt[step.ability.id] ?? -1e9) + step.ability.rest - g.time;
      if (rest > 0) return `${step.name} again in ${Math.ceil(rest / 60)} minutes.`;
      return null;
    },
    perform: (t, g) => {
      const id = t.kind === 'tile' ? t.material : undefined;
      const step = abilitiesOf(g.player.way, g.skills.get(MEDITATION)).find((s) => s.ability?.id === id);
      if (!step?.ability) return;
      g.player.usedAt[step.ability.id] = g.time;
      g.gainSkill(MEDITATION, 0.2);
      g.note(`used:${step.ability.id}`);
      g.logMsg(g.workAbility(step.ability.id), 'event');
    },
  },
];
