import { ACTIONS } from '../../src/game/actions';
import { RECIPES } from '../../src/game/recipes';
const seen = new Map<string, number>();
for (const a of ACTIONS as unknown as Array<{ id: string; label: string }>) seen.set(a.id, (seen.get(a.id) ?? 0) + 1);
const dupes = [...seen].filter(([, n]) => n > 1);
console.log(`actions: ${ACTIONS.length}, distinct ids: ${seen.size}, duplicated: ${dupes.length}`);
for (const [id, n] of dupes) {
  const all = (ACTIONS as unknown as Array<{ id: string; label: string }>).filter((a) => a.id === id);
  console.log(`  ${id} ×${n}: ${all.map((a) => `"${a.label}"`).join(' / ')}`);
}
const rseen = new Map<string, number>();
for (const r of RECIPES) rseen.set(r.id, (rseen.get(r.id) ?? 0) + 1);
console.log(`recipes: ${RECIPES.length}, distinct: ${rseen.size}`);
for (const [id, n] of [...rseen].filter(([, n]) => n > 1)) {
  const all = RECIPES.filter((r) => r.id === id);
  console.log(`  ${id} ×${n}: ${all.map((r) => `${r.label} → ${r.result}`).join(' / ')}`);
}
