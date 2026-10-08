/**
 * Driving and sailing: the skills of whoever has the reins of a cart or a
 * wagon, or the helm of a boat.
 *
 * A leaf on purpose: this module imports nothing, so the game, the help and
 * the defs dump can all read it without a ring back through `game.ts`.
 *
 * Each makes what it steers go faster, on top of everything else that decides
 * the pace -- the team, the hull, the wind, the builder's mark -- and each is
 * learned the way climbing is: by going somewhere, a go for every tile the
 * cart or the hull goes into. The island pays both off the walk it is told
 * about (`rpc_move`), and the browser pays them only in a game of its own.
 */

/** The skill a cart or a wagon is driven with. */
export const DRIVING = 'driving';
/** The skill a boat is handled with, rowed or sailed. */
export const SAILING = 'sailing';

/** The level each skill has the whole of what it adds at, rising evenly to it from nothing. */
export const TRAVEL_TOP_AT = 100;
/** What Driving `TRAVEL_TOP_AT` adds to the pace of a cart or wagon you drive, as a share of it. */
export const DRIVING_TOP = 0.25;
/** What Sailing `TRAVEL_TOP_AT` adds to the pace of a boat you have the helm of, as a share of it. */
export const SAILING_TOP = 0.25;

/** What one tile driven into teaches Driving, as the base of a gain (`skillGain`). */
export const DRIVING_LEARN = 0.003;
/** What one tile sailed or rowed into teaches Sailing, as the base of a gain. */
export const SAILING_LEARN = 0.003;

/** What Driving `skill` makes of a team's pace. The island's `driving_pace`. */
export const drivingPace = (skill: number): number => 1 + DRIVING_TOP * Math.min(TRAVEL_TOP_AT, skill) / TRAVEL_TOP_AT;
/** What a cart or wagon of quality 100 adds to its pace, as a share of it; less in proportion below that. */
export const VEHICLE_QL_TOP = 0.1;
/** What a cart or wagon's quality makes of its pace. The island's `vehicle_ql_pace`. */
export const vehicleQlPace = (ql: number): number => 1 + VEHICLE_QL_TOP * Math.max(0, Math.min(100, ql)) / 100;
/** What Sailing `skill` makes of a hull's pace. The island's `sailing_pace`. */
export const sailingPace = (skill: number): number => 1 + SAILING_TOP * Math.min(TRAVEL_TOP_AT, skill) / TRAVEL_TOP_AT;
