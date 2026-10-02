import { ACTION_BY_ID, type Target } from '../game/actions';
import type { PlacedFurniture } from '../game/furniture';
import type { Game } from '../game/game';
import { itemName } from '../game/items';
import { isLampPiece, lampState } from '../game/lamps';
import { candleBurn, lanternReach } from '../game/light';
import { timeWords } from '../game/words';
import type { MenuItem } from './contextmenu';

/** The five, in the order they come: in, a candle, a light, out, and down. */
const LAMP_ENTRIES = ['fit_lamp', 'candle_lamp', 'light_lamp', 'douse_lamp', 'take_lamp'];

/**
 * A lantern post's or a lantern pillar's own entries: what is in it, said
 * first, and whichever of the five apply, each refused in the island's words.
 * With more than one lantern in the pack, fitting asks which, and says what
 * each would throw and how long a candle in it would last.
 */
export function lampEntries(g: Game, f: PlacedFurniture): MenuItem[] {
  if (!isLampPiece(f)) return [];
  const ft: Target = { kind: 'furniture', id: f.id };
  const entries: MenuItem[] = [{ label: lampState(f), disabled: true }];
  for (const id of LAMP_ENTRIES) {
    const def = ACTION_BY_ID.get(id);
    if (!def || !def.applies(ft, g)) continue;
    const label = def.labelFor?.(ft, g) ?? def.label;
    const lanterns = id === 'fit_lamp' ? g.inventory.items.filter((it) => it.id === 'lantern' && !it.locked) : [];
    if (lanterns.length > 1) {
      entries.push({
        label,
        children: lanterns.map((it) => {
          const t: Target = { ...ft, itemUid: it.uid };
          const why = def.check?.(t, g) ?? null;
          return {
            label: `${itemName(it)} (QL ${it.ql.toFixed(0)})`,
            note: `throws ${lanternReach(it.ql)} tiles · a candle in it lasts ${timeWords(candleBurn(it.ql))}`,
            hint: why ?? undefined,
            disabled: !!why,
            onSelect: () => g.requestAction(def, t),
          };
        }),
      });
      continue;
    }
    const why = def.check?.(ft, g) ?? null;
    entries.push({ label, hint: why ?? undefined, disabled: !!why, onSelect: () => g.requestAction(def, ft) });
  }
  return entries;
}
