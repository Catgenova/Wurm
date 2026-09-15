/**
 * Housekeeping: what the island does when nobody is asking it to.
 *
 * Everything here settles lazily off a timestamp, and that works beautifully
 * right up to the moment nobody calls. `settle` had three callers — `rpc_act`,
 * `rpc_move` and `rpc_sweep` — and the browser only calls `rpc_move` when the
 * body has actually moved somewhere new. So: start a thirty-second go at a
 * face of rock, stand still, and nothing lands. No ore, no line in the log, no
 * message to anybody watching, and the next go of a queued ten never begins.
 * It all arrives at once when you finally take a step.
 *
 * It was worse than that for everybody else. `creature_sweep` was reachable
 * only through `rpc_creatures`, which no browser code calls at all, and
 * `trap_sweep` and `post_sweep` had no callers anywhere — so on a live island
 * the wildlife never moved, the traps never sprang and the posts never
 * settled.
 *
 * The island has a clock now: `world_tick`, on `pg_cron` where the database
 * has it. These are the numbers it runs on, in one place, generated down into
 * Postgres like every other number.
 *
 * They are **real** seconds, not world seconds. A crop ripening is the world's
 * business and answers to `WORLD_PACE`; a database tidying up after itself is
 * nobody's idea of weather.
 */

/**
 * How often the clock comes round.
 *
 * The shortest job in the game is `ACTION_FLOOR`, four and a half seconds, so
 * five is close enough that nothing sits finished for long. It is a floor on
 * how stale the world can look to somebody watching, not on how quickly your
 * own work lands — the browser settles itself the moment its own job is due.
 */
export const TICK_SECONDS = 5;

/**
 * Quiet for this long and your body goes home.
 *
 * `seen_at` has been written by every join, move and act since the beginning
 * and read by nothing, so a shut tab left a body standing on the island for
 * ever — in the way, on the roster, and swept on every tick. Going home stops
 * whatever you were doing and says so; your skills, your pack and your land
 * are exactly where you left them when you come back.
 */
export const IDLE_LOGOUT = 15 * 60;

/**
 * How often the browser says it is still here.
 *
 * `rpc_settle` is the heartbeat as well as the settle, so one call does both:
 * it lands whatever is due and writes `seen_at`. A minute is far inside the
 * quarter-hour above, and the write is skipped when the row is already fresh.
 */
export const HEARTBEAT = 60;

/** Lines of talk kept before they are swept up. Nobody reads their own backlog. */
export const EVENT_KEEP = 24 * 3600;

/**
 * How long a tile change is kept after everybody has seen it.
 *
 * `land_set_tile` writes the change into `land_tile` *and* into `tile_change`,
 * so once the last live cursor is past a row the row is telling nobody
 * anything the land does not already say. The week is slack for somebody who
 * has been away.
 */
export const CHANGE_KEEP = 7 * 24 * 3600;

/** An island nobody has stood on for a month goes back to the sea. */
export const ISLAND_KEEP = 30 * 24 * 3600;

/**
 * What one round of the clock will touch.
 *
 * A tick is one PostgREST-sized piece of work, not a world simulation: it must
 * finish well inside a statement timeout however many islands there are. The
 * work it does not get to is still due on the next round, which is five
 * seconds away.
 */
export const TICK_WORLDS = 20;
export const TICK_PLAYERS = 200;

/** Calls one person may make in a minute before the island stops listening. */
export const CALLS_A_MINUTE = 240;
