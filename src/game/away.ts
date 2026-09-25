import { itemDef } from './items';
import { SPECIES } from './creatures';
import { priceWords } from './money';

/**
 * While you were away.
 *
 * The island counts, for somebody who is not there, what their workers bring
 * home, the young born to their wildermon, what their stalls sell, what is
 * brought to their buy orders and the parcels posted to them, and hands the
 * counts over when they come back (`rpc_join`, `away_tally`). This turns them
 * into the lines they are shown.
 */

/** One count the island kept for you while you were away. */
export interface AwayRow {
  /**
   * haul: a worker's load put into a store. born: a young one that stayed
   * yours. strayed: a young one that went off into the wild. sold: a thing
   * bought off your stall. bought: a thing brought to one of your buy orders.
   * parcel: a parcel posted to you.
   */
  what: 'haul' | 'born' | 'strayed' | 'sold' | 'bought' | 'parcel';
  /** The item, the species, or the name of whoever sent the parcel. */
  def: string;
  n: number;
  /** Silver taken for it, for a sale; paid for it out of an order, for a thing bought. */
  silver: number;
}

/** What the island kept for you, and how many seconds you were gone. */
export interface Away {
  secs: number;
  tally: AwayRow[];
}

/** The most sorts of thing one line names before it says how many more there were. */
export const AWAY_NAMED = 6;

/** "3 hours and 12 minutes", "2 days and 4 hours", "25 minutes". */
export function awayFor(secs: number): string {
  const m = Math.max(1, Math.round(secs / 60));
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  const unit = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
  if (days) return hours ? `${unit(days, 'day')} and ${unit(hours, 'hour')}` : unit(days, 'day');
  if (hours) return mins ? `${unit(hours, 'hour')} and ${unit(mins, 'minute')}` : unit(hours, 'hour');
  return unit(mins, 'minute');
}

/** "a, b and c", naming at most `AWAY_NAMED` and counting the rest. */
function listed(parts: string[]): string {
  const shown = parts.slice(0, AWAY_NAMED);
  const more = parts.length - shown.length;
  if (more > 0) shown.push(`${more} more ${more === 1 ? 'sort' : 'sorts'}`);
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : (shown[0] ?? '');
}

const itemCount = (r: AwayRow): string => `${r.n} × ${itemDef(r.def).name.toLowerCase()}`;
const speciesCount = (r: AwayRow): string => `${r.n} ${(SPECIES[r.def]?.name ?? r.def).toLowerCase()}`;
const sum = (rows: AwayRow[], of: (r: AwayRow) => number): number => rows.reduce((t, r) => t + of(r), 0);

/** The lines, most first within each, in the order: loads, young, sales, orders, parcels. Empty when nothing happened. */
export function awayLines(away: Away): string[] {
  const of = (what: AwayRow['what']): AwayRow[] =>
    away.tally.filter((r) => r.what === what && r.n > 0).sort((a, b) => b.n - a.n || a.def.localeCompare(b.def));
  const lines: string[] = [];
  const hauls = of('haul');
  if (hauls.length) lines.push(`Your workers put ${listed(hauls.map(itemCount))} into the stores.`);
  const born = of('born');
  if (born.length) lines.push(`Born to your wildermon: ${listed(born.map(speciesCount))}.`);
  const strayed = of('strayed');
  if (strayed.length) {
    lines.push('Born to your wildermon and gone off into the wild, with something already following you and no empty '
      + `creature crate in your pack or standing on your settlement: ${listed(strayed.map(speciesCount))}.`);
  }
  const sold = of('sold');
  if (sold.length) {
    lines.push(`Your stalls sold ${listed(sold.map(itemCount))} for ${priceWords(sum(sold, (r) => r.silver))}. It is in their tills.`);
  }
  const bought = of('bought');
  if (bought.length) {
    lines.push(`Brought to your buy orders: ${listed(bought.map(itemCount))}, paid for with `
      + `${priceWords(sum(bought, (r) => r.silver))} of what they held. It waits for you at any mailbox.`);
  }
  const parcels = of('parcel');
  const posted = sum(parcels, (r) => r.n);
  if (posted === 1) lines.push(`A parcel from ${parcels[0].def} waits for you at any mailbox.`);
  else if (posted > 1) lines.push(`${posted} parcels wait for you at any mailbox: ${listed(parcels.map((r) => `${r.n} from ${r.def}`))}.`);
  if (lines.length) lines.unshift(`You were away ${awayFor(away.secs)}.`);
  return lines;
}
