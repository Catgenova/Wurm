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
 * How long the full history of a tile is kept before it is compacted.
 *
 * `tile_change` is what a client replays to catch up, so it cannot simply be
 * aged out — a row dropped is ground somebody never hears about. It can be
 * *compacted*, though, and losslessly: replaying diffs in order, only the last
 * one for a given tile decides where that tile ends up. So everything older
 * than this collapses to one row per tile, and a client replaying from any
 * cursor at all lands on exactly the same island as before.
 *
 * The week is for the intermediate states, which nothing needs and which are
 * cheap enough to keep for a while anyway.
 */
export const CHANGE_KEEP = 7 * 24 * 3600;

/**
 * How often the keeper does the tidying, as against the settling.
 *
 * The clock comes round every few seconds because a finished job should land
 * at once. Sweeping up old talk and collapsing old diffs is not that sort of
 * work — doing it twelve times a minute would be twelve scans to delete
 * nothing.
 */
export const SWEEP_EVERY = 300;

/** Rows one sweep will delete, per island, per kind. */
export const SWEEP_ROWS = 5000;

/* ---- What Realtime carries, and to whom ---------------------------------- */

/**
 * How big a block of country one Realtime channel covers.
 *
 * Every change went to one channel per island, `island:<id>`, so a 4096 map —
 * two hundred and sixty-eight square kilometres of it — sent every player the
 * sound of somebody digging ten kilometres away. Supabase bills one message
 * sent plus one per receiving client, so that fanout is the single thing that
 * makes a big island cost more to run than a small one.
 *
 * Blocked, it goes the other way: density per channel *falls* as the map
 * grows, because people spread out. A client listens to the nine blocks around
 * it, which at 256 is a square 768 tiles on a side — far past anything it can
 * draw, and far short of Cornwall.
 */
export const REGION = 256;

/** How often a body tells the island where it is, over Broadcast. */
export const BODY_EVERY = 0.2;

/**
 * How often the browser reconciles with the tables.
 *
 * Realtime is the fast path and this is the truth: the same rows, read the
 * same way, so a message that never arrived — a channel that dropped, a block
 * walked into between subscriptions — is caught within twenty seconds instead
 * of never. It is also what moves the tile-change cursor along.
 */
export const RECONCILE_EVERY = 20;

/**
 * How often the browser asks what is moving about near it.
 *
 * Its own beat rather than the reconcile's, because a wild thing crossing a
 * field is the one thing on this island that looks wrong when it is twenty
 * seconds stale. The answer carries a leg with the island's own two instants
 * on it, so the seconds in between are drawn rather than guessed.
 *
 * It is also how the country round somebody gets stirred at all — `rpc_creatures`
 * is `creature_sweep`'s only door — so this is a heartbeat as much as a read.
 */
export const MOBS_EVERY = 2;

/** How far out to ask. Beyond this a thing is somebody else's weather. */
export const MOBS_RANGE = 40;

/**
 * The biggest island a tab may found.
 *
 * A 4096 world is three minutes of ground and 138 MB of land: a thing done
 * once by `tools/found-island.ts`, and no way at all to spend a tab somebody
 * is waiting on. The keeper reads the same number, because it is also how it
 * tells the tool's island from a browser's — and so which islands may become
 * the one the front door opens on.
 */
export const FOUND_MAX = 512;

/**
 * How far from where people wash ashore nothing hunts.
 *
 * The clock is what made this matter. Wildlife never moved before it, so a
 * goblin standing at the landing beach was scenery; now it comes for you, and
 * a fresh body with a hatchet and no fighting to speak of can do nothing about
 * it. The first live run after the front door opened on the island lost both
 * its settlement and its dig to one — `The goblin is on you. You have a deep
 * cut to the chest, bleeding.` — which is a game working exactly as written
 * and a first five minutes nobody would come back from.
 *
 * So there is a quiet beach: nothing that hunts is put down within this of the
 * spawn, and nothing that hunts will start on somebody standing inside it or
 * keep at them once they are. Twenty-four tiles is about a screen — a corner
 * of a 4096 island, and most of a small one, which is right both times.
 *
 * It is not safety, it is a beginning. Walk off the beach and the island is
 * exactly as dangerous as it was.
 */
export const PEACE_REACH = 24;

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

/**
 * How finely the island reads the ground under a claimed walk.
 *
 * `rpc_move` checked how far somebody said they had got against how fast they
 * could possibly have gone, and nothing else — so a modified client could walk
 * through a tree and up a sheer cliff at a perfectly legal pace. It samples
 * the line now, two to a tile, and pulls the body up at the first tile it
 * could not have entered.
 *
 * Capped, because a client that has been asleep may honestly claim sixty tiles
 * and reading sixty tiles of ground on every move call is not a thing a move
 * call can afford. Past the cap the line is read coarsely, which can only ever
 * let something through — the climb is checked between neighbouring tiles
 * only, never across a gap the sampling jumped.
 */
export const WALK_SAMPLES = 64;

/**
 * The most fog of war the island will keep for one body, in bytes.
 *
 * What has been seen is a bit a tile, run-length encoded over the box the
 * exploring falls inside, so an island somebody has walked a road across costs
 * a few kilobytes and one somebody has combed costs tens. A quarter of a
 * megabyte is far past either, and it is here so that the one thing a browser
 * writes by the yard cannot be used as free storage: past this the island says
 * no rather than keeping whatever it is handed.
 */
export const FOG_BYTES = 262144;

/**
 * How often the browser hands its fog of war over, at most.
 *
 * Walking writes it constantly, and none of it matters until the tab is shut —
 * so this is slow on purpose, and skipped entirely when no new ground has been
 * looked at since the last time. It also goes once on the way out, which is
 * what catches the last half minute.
 */
export const FOG_EVERY = 45;

/**
 * How often the browser asks what is on the ground around it.
 *
 * Slower than the wildlife, which is moving, and faster than the heartbeat,
 * because a fire burning down and a kiln working through its load are things
 * you watch. The answer is usually a handful of rows and often none.
 */
export const GROUND_EVERY = 3;

/** And how far out, which is past anything a screen shows. */
export const GROUND_RANGE = 40;
