import type { ActionDef, Target } from './actions';
import { clockLeft, TINCTURE_BONUS, TINCTURE_SECONDS, TINCTURE_SKILLS } from './boons';
import type { Game } from './game';
import { describeFrom, itemDef } from './items';
import { SKILL_DEFS } from './skills';
import { listed, percent } from './words';
import { PART_NAMES, salvable, worstWound, WOUND_KINDS, type Wound } from './wounds';

/**
 * A Naturalist's remedies, taken: a cup of herb tea drunk, a salve rubbed in
 * over a dressing, a tincture taken. Only a Naturalist who has learned one
 * may make it; anybody who has one may use it. The island's `perform_item`
 * does the same, in the same words.
 */

/** The trades a tincture lifts, by the names they go by. */
export const TINCTURE_NAMES = listed(TINCTURE_SKILLS.map((id) => (SKILL_DEFS.find((d) => d.id === id)?.name ?? id).toLowerCase()));

describeFrom('tincture', { skills: TINCTURE_NAMES, bonus: TINCTURE_BONUS, span: TINCTURE_SECONDS });

const held = (g: Game, t: Target) => (t.kind === 'item' ? g.inventory.get(t.uid) : undefined);

/** The worst dressed wound on you that could still go bad: where a salve goes. */
export const salveFor = (wounds: Wound[]): Wound | null => worstWound(wounds.filter(salvable));

/** What a salve with nowhere to go says. The island says the same. */
export const salveRefusal = (wounds: Wound[]): string | null => {
  if (salveFor(wounds)) return null;
  return wounds.some((w) => !w.infected && w.dressing === null)
    ? 'A salve goes on over a dressing. Dress the wound first.'
    : 'Nothing dressed on you can go bad.';
};

export const REMEDY_ACTIONS: ActionDef[] = [
  {
    id: 'drink_tea',
    label: 'Drink it',
    verb: 'drinking',
    stamina: 0,
    baseTime: 2,
    applies: (t, g) => (itemDef(held(g, t)?.id ?? '').stamina ?? 0) > 0,
    check: (t, g) => {
      if (!held(g, t)) return 'It is gone.';
      if (g.player.stats.stamina >= 0.999) return 'You are not tired.';
      return null;
    },
    perform: (t, g) => {
      const it = held(g, t);
      if (!it) return;
      const lift = itemDef(it.id).stamina ?? 0;
      if (!g.inventory.remove(it.uid, 1)) return;
      g.player.stats.stamina = Math.min(1, g.player.stats.stamina + lift);
      g.events.emit('stats');
      g.logMsg(`You drink the ${itemDef(it.id).name.toLowerCase()}. It puts back ${percent(lift)} of your stamina.`, 'event');
    },
  },
  {
    id: 'apply_salve',
    label: 'Rub in the salve',
    verb: 'rubbing in a salve',
    stamina: 0,
    baseTime: 3,
    applies: (t, g) => held(g, t)?.id === 'salve',
    labelFor: (_t, g) => {
      const w = salveFor(g.player.wounds);
      return w ? `Rub it into the ${WOUND_KINDS[w.kind].name} on your ${PART_NAMES[w.part] ?? w.part}` : 'Rub in the salve';
    },
    check: (t, g) => (held(g, t) ? salveRefusal(g.player.wounds) : 'It is gone.'),
    perform: (t, g) => {
      const it = held(g, t);
      const w = salveFor(g.player.wounds);
      if (!it || !w || !g.inventory.remove(it.uid, 1)) return;
      w.salved = true;
      g.events.emit('stats');
      g.logMsg(`You rub the salve into the ${WOUND_KINDS[w.kind].name} on your ${PART_NAMES[w.part] ?? w.part}. It will not go bad under it.`, 'event');
    },
  },
  {
    id: 'take_tincture',
    label: 'Take it',
    verb: 'taking a tincture',
    stamina: 0,
    baseTime: 2,
    applies: (t, g) => held(g, t)?.id === 'tincture',
    check: (t, g) => (held(g, t) ? null : 'It is gone.'),
    perform: (t, g) => {
      const it = held(g, t);
      if (!it || !g.inventory.remove(it.uid, 1)) return;
      g.takeTincture();
      g.logMsg(`You take the tincture. ${TINCTURE_NAMES.charAt(0).toUpperCase()}${TINCTURE_NAMES.slice(1)} each go in ${percent(TINCTURE_BONUS)} faster for the next ${clockLeft(TINCTURE_SECONDS)}.`, 'event');
    },
  },
];
