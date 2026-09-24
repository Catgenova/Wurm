import type { ActionDef, Target } from './actions';
import { SPECIES, type ButcherPart } from './creatures';
import type { Game } from './game';
import { HOARD_METALS, itemDef, itemName, type Item } from './items';

/**
 * Butchering a corpse. The Butchering skill decides how much of a carcass is
 * worth keeping, and a butchering knife makes the difference between tearing
 * a body apart and taking it cleanly to pieces.
 */
export const BUTCHER_PARTS: Array<[ButcherPart, string]> = [
  ['meat', 'meat'],
  ['fur', 'fur'],
  ['leather', 'hide'],
  ['bone', 'bone'],
  ['gland', 'gland'],
  ['feather', 'feather'],
  ['tusk', 'tusk'],
  ['sinew', 'sinew'],
  ['scale', 'dragon_scale'],
];

/**
 * A hoard is not a part of the body. What a dragon has been sleeping on comes
 * out of the carcass with it, and it is the only place on the island four of
 * these lumps turn up together.
 */
export { HOARD_METALS } from './items';

/**
 * How much of a carcass is worth keeping. Bare hands manage about a third; a
 * knife's quality and the butchering skill lift that towards the whole
 * animal, which the species' table caps.
 */
export const butcherYield = (skill: number, knifeQl: number | null): number =>
  Math.min(1, (knifeQl === null ? 0.34 : 0.62 + (knifeQl / 100) * 0.3) + (skill / 100) * 0.28);

/** Glands are the rare part: only a steady hand finds them intact. */
const GLAND_CHANCE = 0.35;

export const corpseSpecies = (item: Item): (typeof SPECIES)[string] | undefined =>
  Object.values(SPECIES).find((s) => s.name.toLowerCase() === (item.extra ?? '').toLowerCase());

/** What a corpse would give right now, for the menu and the log. */
export function butcherPreview(g: Game, item: Item): string {
  const def = corpseSpecies(item);
  if (!def) return '';
  const knife = g.inventory.tool('butchering_knife');
  const share = butcherYield(g.skills.get('butchering'), knife ? knife.ql : null);
  const parts = BUTCHER_PARTS.filter(([p]) => (def.butcher[p] ?? 0) > 0).map(([, id]) => itemDef(id).name.toLowerCase());
  return `about ${Math.round(share * 100)}% of its ${parts.join(', ')}`;
}

export const BUTCHER_ACTIONS: ActionDef[] = [
  {
    id: 'butcher',
    label: 'Butcher',
    verb: 'butchering',
    skill: 'butchering',
    tool: 'butchering_knife',
    stamina: 0.06,
    baseTime: 8,
    applies: (t, g) => corpse(g, t) !== undefined,
    check: (t, g) => {
      const item = corpse(g, t);
      if (!item) return 'There is nothing to butcher.';
      if (!corpseSpecies(item)) return 'You cannot make sense of this carcass.';
      return null;
    },
    perform: (t, g) => {
      const item = corpse(g, t);
      const def = item && corpseSpecies(item);
      if (!item || !def) return;
      const knife = g.inventory.tool('butchering_knife');
      const share = butcherYield(g.skills.get('butchering'), knife ? knife.ql : null);
      const ql = g.productQl('butchering', knife ? knife.ql : 0) * (0.6 + item.ql / 250);
      const taken: string[] = [];
      // What it was sleeping on, which is not a part of it at all.
      const hoard = def.butcher.hoard ?? 0;
      if (hoard > 0) {
        const lumps: string[] = [];
        for (let i = 0; i < Math.round(hoard * (4 + share * 6)); i++) {
          const id = HOARD_METALS[Math.floor(g.rand() * HOARD_METALS.length)];
          g.gather(id, { ql: Math.max(20, Math.min(100, 40 + g.rand() * 55)) });
          lumps.push(itemDef(id).name.toLowerCase());
        }
        if (lumps.length) {
          g.note('hoard');
          g.logMsg(`Something rattles as the belly opens: ${lumps.length} lumps of what it had been sleeping on. ${[...new Set(lumps)].join(', ')}.`, 'event');
        }
      }
      for (const [part, id] of BUTCHER_PARTS) {
        const base = def.butcher[part] ?? 0;
        if (!base) continue;
        let count = Math.floor(base * share);
        // The remainder is a chance at one more, so a poor job still gives something.
        if (g.rand() < base * share - count) count += 1;
        if (part === 'gland' && count > 0 && g.rand() > GLAND_CHANCE * (0.5 + share)) count = 0;
        if (count <= 0) continue;
        const made = g.gather(id, { count, ql: Math.max(1, Math.min(100, ql)) });
        taken.push(made.count > 1 && count > 1 ? `${count} × ${itemDef(id).name.toLowerCase()}` : itemDef(id).name.toLowerCase());
      }
      removeCorpse(g, t, item);
      if (!taken.length) {
        g.logMsg(`You make a mess of the ${def.name.toLowerCase()} carcass and salvage nothing.`, 'event');
        return;
      }
      g.logMsg(`You butcher the ${def.name.toLowerCase()} and take ${taken.join(', ')}.${knife ? '' : ' Bare hands waste most of a carcass.'}`, 'event');
    },
  },
];

function corpse(g: Game, t: Target): Item | undefined {
  if (t.kind === 'ground') {
    const pile = g.groundAt(t.x, t.y);
    const item = t.uid === null ? pile.find((it) => it.id === 'corpse') : pile.find((it) => it.uid === t.uid);
    return item?.id === 'corpse' ? item : undefined;
  }
  if (t.kind === 'item') {
    const item = g.inventory.get(t.uid);
    return item?.id === 'corpse' ? item : undefined;
  }
  return undefined;
}

function removeCorpse(g: Game, t: Target, item: Item): void {
  if (t.kind === 'ground') g.takeFromGround(t.x, t.y, item.uid);
  else g.inventory.remove(item.uid, 1);
}

export const butcherName = (item: Item): string => itemName(item);
