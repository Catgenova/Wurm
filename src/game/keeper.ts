/**
 * An island's keepers, and what the Island keeper window says.
 *
 * Who keeps an island is the island's to say (`rpc_owner_am_i`): anybody the
 * deploy made an owner of every island on the project, and whoever founded
 * this one. Only they are shown any of this. The lines are here, apart from
 * the window, so they can be read and held against the island's answers
 * without a page to draw them on.
 */
import { awayFor } from './away';

/** How often the window asks again who is on the island, while it is open, in seconds. */
export const KEEPER_REFRESH = 30;

/**
 * How long a keeper may mute somebody for, in seconds, shortest first; `null`
 * is until a keeper lifts it. The island takes any number of seconds; these are
 * the ones offered.
 */
export const MUTE_FOR: ReadonlyArray<number | null> = [60 * 60, 24 * 60 * 60, null];

/** What a mute shuts, which the island's refusal names in the same three. */
export const MUTE_SHUTS = 'what they say aloud, write in a letter or put in a parcel note';

/** One body on the island, as `rpc_owner_online` sends it. */
export interface KeptBody {
  uid: string;
  name: string;
  /** The tile they stand on. */
  x: number;
  y: number;
  away: boolean;
  /** Seconds since the island last heard from them. */
  heard: number;
  muted: boolean;
  /** Seconds of the mute left; null while it lasts until a keeper lifts it, or when there is none. */
  muted_for: number | null;
  /** The token of the settlement they founded, which Move puts them on. */
  home: { x: number; y: number; name: string } | null;
  /** Whether they keep this island too. */
  keeper: boolean;
  /** Whether this is the one asking. */
  you: boolean;
}

/** Everybody with a body on the island, and where newcomers come ashore. */
export interface Kept {
  people: KeptBody[];
  spawn: { x: number; y: number };
}

/** A mute's menu row: "For 1 hour", "Until lifted". */
export const muteLabel = (secs: number | null): string => (secs === null ? 'Until lifted' : `For ${awayFor(secs)}`);

/** What a mute of that length does, for the note under its row. */
export const muteNote = (secs: number | null): string =>
  secs === null ? 'Lasts until you or another keeper lifts it' : `Lifts by itself after ${awayFor(secs)}`;

/** How long ago the island last heard from somebody. */
export const heardLine = (secs: number): string =>
  secs < 60 ? 'heard from just now' : `heard from ${awayFor(secs)} ago`;

/**
 * The mute on somebody, as their row says it; empty when there is none. `until`
 * says when that many seconds from now is, on this machine's clock.
 */
export const muteLine = (b: KeptBody, until?: (secs: number) => string): string => {
  if (!b.muted) return '';
  if (b.muted_for === null) return 'muted until lifted';
  return `muted for ${awayFor(b.muted_for)} more${until ? `, until ${until(b.muted_for)}` : ''}`;
};

/** Where Move puts somebody, in the island's words for it. */
export const moveTarget = (b: KeptBody, spawn: Kept['spawn']): string =>
  b.home ? `the token of ${b.home.name} at (${b.home.x}, ${b.home.y})` : `where newcomers come ashore, at (${spawn.x}, ${spawn.y})`;

/** Everything Move does, for the button's title. */
export const moveHint = (b: KeptBody, spawn: Kept['spawn']): string =>
  `Put ${b.you ? 'yourself' : b.name} on ${moveTarget(b, spawn)}, stop what ${b.you ? 'you are' : 'they are'} doing, `
  + `empty ${b.you ? 'your' : 'their'} queue, and take ${b.you ? 'you' : 'them'} off anything ridden, driven, pulled or boarded.`;

/** What clearing a pile deletes, for the question asked before it goes. */
export const clearQuestion = (x: number, y: number, stacks: number, things: number): string =>
  `Delete everything lying on the ground at (${x}, ${y}): ${things} ${things === 1 ? 'thing' : 'things'} in `
  + `${stacks} ${stacks === 1 ? 'stack' : 'stacks'}, and whatever is inside them? Nobody can get it back.`;
