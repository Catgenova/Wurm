import type { Item } from './items';
import { COINS_PER_LUMP, METALS, MOULD_BY_MAKES, MOULDS, type MetalDef } from './metal';
import { RECIPES } from './recipes';

/**
 * What the fire gives back.
 *
 * A thing cast from metal holds the lumps its mould took, a piece at a time
 * for a gang mould, and a tool with a cast head fitted to a haft holds its
 * head's. Melted down, half of that comes back, at seven tenths of the
 * quality it had less the damage it carried, in half the heat an ore charge
 * takes. A ruined cast is a setback rather than a total loss, and the metal
 * in an old tool is metal again. The island reads the same table and the
 * same three numbers.
 */
export const MELT_SHARE = 0.5;
export const MELT_KEEP = 0.7;
export const MELT_HEAT = 0.5;

/** Lumps of metal in a thing, by what it was cast from. Absent for a thing not made of metal. */
export const METAL_CONTENT: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (const m of MOULDS) out[m.makes] = m.lumps / (m.per ?? 1);
  // A coin is a twentieth of the lump it was struck from.
  out.coin = 1 / COINS_PER_LUMP;
  // A haft fitted to a cast head holds the head's metal; the nails do not count.
  for (const r of RECIPES) {
    if (out[r.result] !== undefined) continue;
    const head = r.inputs.find((i) => (out[i.item] ?? 0) >= 1 && (i.count ?? 1) === 1);
    if (head) out[r.result] = out[head.item];
  }
  return out;
})();

const METAL_BY_NAME = new Map(METALS.map((m) => [m.name.toLowerCase(), m]));

/** The metal a thing is made of, off what it was cast from. */
export const metalOfItem = (item: Item): MetalDef | undefined => (item.extra ? METAL_BY_NAME.get(item.extra.toLowerCase()) : undefined);

/** Lumps of metal in one of a thing: a casting holds its whole filling, anything else what the table says. */
export const metalContent = (item: Item): number | undefined =>
  item.id === 'casting' && item.piece ? MOULD_BY_MAKES.get(item.piece)?.lumps : METAL_CONTENT[item.id];

export const meltable = (item: Item): boolean => !!metalOfItem(item) && metalContent(item) !== undefined;

export function meltRefusal(item: Item): string | null {
  if (item.locked) return 'It is put by. Unlock it first.';
  if (!meltable(item)) return 'That is not made of metal the fire would give back.';
  return null;
}

/** Lumps that come back from this many of a thing: half its metal, and never none. */
export const meltLumps = (item: Item, count: number): number => Math.max(1, Math.round((metalContent(item) ?? 0) * count * MELT_SHARE));

/** The quality of what comes back: seven tenths, less the damage the thing carried. */
export const meltQl = (item: Item): number => Math.max(1, item.ql * MELT_KEEP * (1 - item.dmg / 100));
