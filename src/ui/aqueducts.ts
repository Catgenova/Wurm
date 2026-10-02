import { ACTION_BY_ID, type Target } from '../game/actions';
import { AQ_SAME, AQ_THERE, AQUEDUCT, aqueductHeads, aqueductPlan, footSays, waterAlong } from '../game/aqueducts';
import { isDone } from '../game/building';
import { spanWants, type Bridge } from '../game/bridges';
import type { Game } from '../game/game';
import { itemDef } from '../game/items';
import { AQUEDUCT_FLOW, pondCovers } from '../world/aqueducts';
import { settleChain, springCorner } from '../world/springs';
import type { MenuItem } from './contextmenu';

/** What one span of an aqueduct takes, written out. */
const BILL = AQUEDUCT.bill.map(([id, n]) => `${n} ${itemDef(id).name.toLowerCase()}`).join(', ');

/**
 * Whether a tile is something an aqueduct can pour into: a pool, a fountain,
 * a pond, or a hollow that would hold one. Asked before the menu offers to
 * lead one there, so it is offered only where it could go.
 */
function isFoot(g: Game, x: number, y: number): boolean {
  if (g.slabAt(x, y)?.pool) return true;
  if (g.furnitureOnTile(x, y).some((f) => f.kind === 'fountain')) return true;
  if (g.world.water?.pondsAt(x, y).length) return true;
  if (g.slabAt(x, y) || g.world.hasWater(x, y)) return false;
  const w = g.world;
  const [cx, cy] = springCorner((a, b) => w.getHeight(a, b), x, y);
  return typeof settleChain((a, b) => (w.cornerInBounds(a, b) ? w.getHeight(a, b) : null), cx, cy) !== 'string';
}

/**
 * "Lead an aqueduct here", on a tile an aqueduct could pour into with water
 * straight out from it: one row for the first pond or pool met each way, as
 * far as an aqueduct spans, with what it would take or why it cannot be.
 */
export function aqueductMenu(g: Game, x: number, y: number, target: Extract<Target, { kind: 'tile' }>): MenuItem[] {
  const def = ACTION_BY_ID.get('plan_aqueduct');
  if (!def) return [];
  const near = aqueductHeads(g, x, y);
  if (!near.length || !isFoot(g, x, y)) return [];
  // Not the water it stands in itself, a pond or a pool reaching out from under the tile, nor the head of the aqueduct that pours into it already.
  const heads = near.map((h) => ({ ...h, plan: aqueductPlan(g, h.x, h.y, x, y) })).filter((h) => h.plan !== AQ_SAME && h.plan !== AQ_THERE);
  if (!heads.length) return [];
  return [{
    label: 'Lead an aqueduct here',
    children: heads.map((h) => {
      const t: Target = { ...target, head: [h.x, h.y] };
      const plan = h.plan;
      const spans = h.tiles - 1;
      return {
        label: `From the ${g.slabAt(h.x, h.y)?.pool ? 'pool' : 'pond'} ${h.tiles} tiles ${h.dir}`,
        note: typeof plan === 'string' ? undefined
          : `${spans} span${spans === 1 ? '' : 's'} of ${BILL} · its channel at ${plan.height}, ${AQUEDUCT_FLOW} litres a minute into the ${plan.foot} at ${plan.level}`,
        hint: typeof plan === 'string' ? plan : undefined,
        disabled: typeof plan === 'string',
        onSelect: () => g.requestAction(def, t),
      };
    }),
  }];
}

/** An aqueduct's own menu: what it is, whether water runs along it, and working it or pulling it down. */
export function aqueductEntries(g: Game, b: Bridge): MenuItem[] {
  const bt: Target = { kind: 'bridge', id: b.id };
  const entries: MenuItem[] = [];
  const n = b.spans.length;
  entries.push({ label: `${n} span${n === 1 ? '' : 's'} · its channel at ${b.height} · nobody walks it`, disabled: true });
  const open = b.spans.find((s) => !isDone(s));
  const foot = open ? null : footSays(g, b, Date.now());
  if (open) entries.push({ label: `The open span wants ${spanWants(open)}`, disabled: true });
  else if (foot) {
    entries.push({ label: `A spring's water runs along it, ${AQUEDUCT_FLOW} litres a minute`, disabled: true });
    entries.push({ label: foot, disabled: true });
  } else entries.push({ label: dryWhy(g, b), disabled: true });
  for (const id of ['build_aqueduct', 'scrub_moss', 'demolish_aqueduct']) {
    const a = ACTION_BY_ID.get(id);
    if (!a || !a.applies(bt, g)) continue;
    const reason = a.check?.(bt, g) ?? null;
    entries.push({ label: a.labelFor?.(bt, g) ?? a.label, hint: reason ?? undefined, disabled: !!reason, onSelect: () => g.requestAction(a, bt) });
  }
  return entries;
}

/**
 * Why no water runs along a finished aqueduct, as its menu says it: no
 * spring's water at its head at all, water there standing under its channel,
 * or another aqueduct from the same water taking all of it first -- as
 * `settleWater` decides it.
 */
function dryWhy(g: Game, b: Bridge): string {
  const there = [...g.springs.list.values()].flatMap((s) => s.chain.ponds).filter((p) => pondCovers(p, b.ax, b.ay));
  if (!there.length) {
    return g.slabAt(b.ax, b.ay)?.pool ? 'Dry: no spring rises in the pool at its head, and none runs into it' : 'Dry: no spring\'s water stands at its head';
  }
  const top = Math.max(...there.map((p) => p.level));
  if (top < b.height) return `Dry: the water at its head stands at ${top}, under its channel at ${b.height}`;
  const first = [...g.bridges.values()]
    .filter((o) => o.kind === 'aqueduct' && o.id !== b.id && waterAlong(g, o.id) && there.some((p) => pondCovers(p, o.ax, o.ay)))
    .sort((p, q) => p.id - q.id)[0];
  if (first) return `Dry: the aqueduct from ${first.ax}, ${first.ay} takes that water first`;
  return `Dry: no spring's water stands at its head at ${b.height} or over`;
}
