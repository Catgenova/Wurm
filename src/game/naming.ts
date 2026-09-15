import type { ActionDef, Target } from './actions';
import { crateName } from './crates';
import { furnitureName } from './furniture';
import type { Game } from './game';
import { postName } from './posts';
import { trapName } from './traps';

/**
 * Calling things by name.
 *
 * A settlement of any age has six bins, four crates and a row of chests, and
 * every one of them is called "Bulk bin (oak)". Naming them is the difference
 * between hunting through the lot and walking to the one marked Planks. Any
 * crate, bin, chest, cart, piece of furniture, work post or trap takes a name,
 * and that name is what it is called everywhere afterwards: the Stores window,
 * the settlement window, its own menu, and the tooltip when you point at it.
 */
export const NAME_MAX = 28;

/** What a thing is called now, whatever kind of thing it is. */
function nameOf(g: Game, t: Target): string | null {
  if (t.kind === 'crate') return g.crates.get(t.id) ? crateName(g.crates.get(t.id)!) : null;
  if (t.kind === 'furniture') return g.furniture.get(t.id) ? furnitureName(g.furniture.get(t.id)!) : null;
  if (t.kind === 'post') return g.posts.get(t.id) ? postName(g.posts.get(t.id)!) : null;
  if (t.kind === 'trap') return g.traps.get(t.id) ? trapName(g.traps.get(t.id)!) : null;
  return null;
}

/** The thing itself, for writing the name onto. */
function thingOf(g: Game, t: Target): { name?: string } | null {
  if (t.kind === 'crate') return g.crates.get(t.id) ?? null;
  if (t.kind === 'furniture') return g.furniture.get(t.id) ?? null;
  if (t.kind === 'post') return g.posts.get(t.id) ?? null;
  if (t.kind === 'trap') return g.traps.get(t.id) ?? null;
  return null;
}

export const NAMING_ACTIONS: ActionDef[] = [
  {
    id: 'name_thing',
    /*
     * `allowEmpty`, because here an empty answer is an answer: it takes the
     * name off again rather than being a refusal, which is what the rest of
     * `perform` goes on to do with it.
     */
    asks: {
      question: 'What is this called?',
      fallback: (t, g) => nameOf(g, t) ?? '',
      max: NAME_MAX,
      allowEmpty: true,
    },
    label: 'Give it a name',
    verb: 'naming it',
    instant: true,
    stamina: 0,
    baseTime: 0,
    applies: (t, g) => thingOf(g, t) !== null,
    labelFor: (t, g) => (thingOf(g, t)?.name ? 'Call it something else' : 'Give it a name'),
    perform: (t, g) => {
      const thing = thingOf(g, t);
      if (!thing) return;
      const was = nameOf(g, t) ?? '';
      const name = ((t as { name?: string }).name ?? '').trim().slice(0, NAME_MAX);
      if (!name) {
        // An empty answer takes the name off again rather than leaving a blank.
        if (thing.name) {
          delete thing.name;
          g.logMsg(`It goes back to being a ${(nameOf(g, t) ?? 'thing').toLowerCase()}.`, 'info');
        }
      } else {
        thing.name = name;
        g.logMsg(`The ${was.toLowerCase()} is called ${name} from now on.`, 'info');
      }
      g.events.emit('world', 0, 0);
      g.events.emit('crate');
    },
  },
];

export const NAMING_ACTION_BY_ID = new Map(NAMING_ACTIONS.map((a) => [a.id, a]));
