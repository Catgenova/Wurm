/**
 * What the island says a cast did, as it goes over the wire: in the door's
 * answer (`rpc_cast_spell`, `fx_told`), from the caster's browser to everybody
 * watching (`Island.castSeen`), and what fires after a cast (`fx_fired`). Read
 * and checked here, and turned into what is drawn (`CastTold`, `game/events`).
 * Nothing but types is imported, so the spell bar can read an answer without
 * bringing the island's connection along.
 */
import type { CastAt, CastTold } from '../game/events';

/**
 * What the island said a cast did (`fx_told`), as its door answers and as the
 * caster's browser passes it on: who it reached (`hit`: a creature by its id,
 * a person by uid, in the order it reached them), the seconds what it left
 * lasts on each (`secs`, the same length, null where nothing lasts), which of
 * them it holds still (`held`), the caster's waiting spells it spent (`used`:
 * a Stoke, a Thicken), the largest skin it laid or the skin a Ward Burst broke
 * as a share of health (`size`), and an Execute's on a creature below its line
 * (`low`). An island from before it says none of it.
 */
export interface ToldWire {
  hit: Array<number | string>;
  secs?: Array<number | null>;
  held?: Array<number | string>;
  used?: string[];
  size?: number;
  low?: boolean;
}

/** The most a cast is believed to have reached, from an answer or a broadcast; anything longer is not read at all. */
const TOLD_MOST = 64;

/** What a cast did, read out of an answer or a broadcast and checked: nothing at all when it says no `hit`, or says it wrongly. */
export function toldIn(v: unknown): ToldWire | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  const who = (w: unknown): w is number | string => num(w) || (typeof w === 'string' && w.length > 0 && w.length < 64);
  if (!Array.isArray(o.hit) || o.hit.length > TOLD_MOST || !o.hit.every(who)) return undefined;
  const out: ToldWire = { hit: o.hit as Array<number | string> };
  if (Array.isArray(o.secs) && o.secs.length === out.hit.length && o.secs.every((s) => s === null || (num(s) && s >= 0))) {
    out.secs = o.secs as Array<number | null>;
  }
  if (Array.isArray(o.held) && o.held.length <= out.hit.length && o.held.every(who)) out.held = o.held as Array<number | string>;
  if (Array.isArray(o.used) && o.used.length <= 8 && o.used.every((s) => typeof s === 'string' && s.length < 64)) out.used = o.used as string[];
  if (num(o.size) && o.size >= 0) out.size = o.size;
  if (o.low === true) out.low = true;
  return out;
}

/**
 * What a cast did, as it is drawn (`CastTold`), from what the island said:
 * a creature by its id, a person by `person(uid)` -- you, or somebody this
 * browser knows -- and nobody it does not.
 */
export function toldOf(w: ToldWire, person: (uid: string) => CastAt | null): CastTold {
  const held = new Set(w.held ?? []);
  const hit: CastTold['hit'] = [];
  w.hit.forEach((who, i) => {
    const at: CastAt | null = typeof who === 'number' ? { kind: 'creature', id: who } : person(who);
    if (!at) return;
    const secs = w.secs?.[i];
    hit.push({ at, ...(typeof secs === 'number' ? { secs } : {}), ...(held.has(who) ? { held: true } : {}) });
  });
  return { hit, ...(w.used ? { used: w.used } : {}), ...(w.size !== undefined ? { size: w.size } : {}), ...(w.low ? { low: true } : {}) };
}

/** And back again, for passing your own cast on (`castSeen`): each person by `uidOf`, and nobody it cannot name. */
export function toldWire(t: CastTold, uidOf: (at: CastAt) => string | null): ToldWire {
  const hit: ToldWire['hit'] = [], secs: Array<number | null> = [], held: ToldWire['hit'] = [];
  for (const h of t.hit) {
    const who = h.at.kind === 'creature' ? h.at.id : uidOf(h.at);
    if (who === null) continue;
    hit.push(who);
    secs.push(h.secs ?? null);
    if (h.held) held.push(who);
  }
  return {
    hit, ...(secs.some((s) => s !== null) ? { secs } : {}), ...(held.length ? { held } : {}),
    ...(t.used ? { used: t.used } : {}), ...(t.size !== undefined ? { size: t.size } : {}), ...(t.low ? { low: true } : {}),
  };
}

/**
 * Something of a spell's that fired after its cast, on its own: a Ward Link
 * laying a skin back over somebody. The island tells the caster's browser
 * (`fx_fired`, Broadcast `fx`), which passes it on to everybody watching
 * (`Island.castFired`): which spell, on whom (by uid), and how large.
 */
export interface FiredWire {
  spell: string;
  on: string;
  size?: number;
}

/** One of those, checked: nothing when it is malformed. */
export function firedIn(v: unknown): FiredWire | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.spell !== 'string' || o.spell.length > 64 || typeof o.on !== 'string' || !o.on || o.on.length > 64) return null;
  const out: FiredWire = { spell: o.spell, on: o.on };
  if (typeof o.size === 'number' && Number.isFinite(o.size) && o.size >= 0) out.size = o.size;
  return out;
}
