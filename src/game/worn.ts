/**
 * What a body has on, as it goes over the wire and as the figure draws it.
 *
 * A body is drawn in its gear (src/render/figure.ts): each piece by what it
 * is, how rare, what it is made of and the colour it took. Your own the
 * browser reads off your pack. Somebody else's comes from the island
 * (`rpc_worn`) or from them, on the Broadcast channel with their position,
 * and in both it is the same four things a slot: [the thing's id, its rarity
 * from nought to three, its material as the item names it, its dye's id].
 *
 * Ids and not colours, as a look is sent (`cleanLook`): what arrives from
 * somebody else's machine and goes on this one's canvas has to be something
 * out of a table we wrote. A thing we do not know, or one that is not worn
 * where it says it is, draws nothing.
 */
import type { GearLook } from '../render/figure';
import { SLOTS, slotOf, type Slot } from './gear';
import { materialOf } from './materials';
import { DYE_BY_ID } from './dyestuffs';

/** One piece: which thing, how rare, what it is made of as the item names it, and the dye's id. */
export type WornPiece = [string, number, string | null, string | null];
export type WornWire = Partial<Record<Slot, WornPiece>>;

/** What is worn in each slot, as the wire has it: from a function that says what is in a slot. */
export function wornWire(worn: (slot: Slot) => { id: string; rare?: number; extra?: string; dye?: string } | undefined): WornWire {
  const out: WornWire = {};
  for (const slot of SLOTS) {
    const it = worn(slot);
    if (it) out[slot] = [it.id, Math.max(0, Math.min(3, it.rare ?? 0)), it.extra ?? null, it.dye ?? null];
  }
  return out;
}

/** What the wire says is worn, made into what the figure draws; nothing for anything it does not recognise. */
export function gearFrom(raw: unknown): GearLook | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: GearLook = {};
  let any = false;
  for (const slot of SLOTS) {
    const v = (raw as Record<string, unknown>)[slot];
    if (!Array.isArray(v) || typeof v[0] !== 'string' || slotOf(v[0]) !== slot) continue;
    const rare = typeof v[1] === 'number' && Number.isInteger(v[1]) ? Math.max(0, Math.min(3, v[1])) : 0;
    const material = typeof v[2] === 'string' ? materialOf(v[2])?.id : undefined;
    const dye = typeof v[3] === 'string' ? DYE_BY_ID.get(v[3])?.colour : undefined;
    out[slot] = { id: v[0], rare: rare || undefined, material, dye };
    any = true;
  }
  return any ? out : undefined;
}
