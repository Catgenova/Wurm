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
 * It is a floor on how stale the world can look to somebody *watching*, not on
 * how quickly your own work lands — the browser settles itself the moment its
 * own job is due. So this is what somebody else's dig, somebody else's fire
 * and somebody else's beast cost you in lateness.
 *
 * A second. It was five, chosen against `ACTION_FLOOR` — the shortest job in
 * the game is four and a half seconds, so nothing sat finished for long. What
 * that reasoning missed is that the tick is also the only thing that stirs the
 * country around a body standing still, so five seconds was five seconds of
 * everything-but-you.
 *
 * Measured on a warm database with three live islands and a hundred and
 * thirty-four creatures on them, a round of `world_tick` costs **2.5 ms** —
 * the first call after a restart is 770 ms of planning and then it settles.
 * At one a second that is a quarter of one per cent of a core, and the work
 * per round is capped by `TICK_WORLDS` and `TICK_PLAYERS` regardless, so the
 * cost of turning it up is bounded whatever the island grows into.
 */
export const TICK_SECONDS = 1;

/**
 * Quiet for this long and your body goes home.
 *
 * `seen_at` has been written by every join, move and act since the beginning
 * and read by nothing, so a shut tab left a body standing on the island for
 * ever — in the way, on the roster, and swept on every tick. Going home stops
 * whatever you were doing and says so; your skills, your pack and your land
 * are exactly where you left them when you come back.
 */
export const IDLE_LOGOUT = 450;

/**
 * How often the browser says it is still here.
 *
 * `rpc_settle` is the heartbeat as well as the settle, so one call does both:
 * it lands whatever is due and writes `seen_at`. A minute leaves six and a
 * half of the seven and a half above, and the write is skipped when the row is
 * already fresh.
 *
 * Worth knowing where the margin goes: a phone that backgrounds the tab
 * freezes this timer, so the walk from "put the phone down" to "your body has
 * gone home" is now seven and a half minutes rather than fifteen. Your skills,
 * your pack and your land are exactly where you left them either way.
 */
export const HEARTBEAT = 60;

/**
 * How far the island's word on where you are may differ from ours before we
 * take it, in tiles.
 *
 * Every walk is answered with the island's own position, and the two normally
 * agree: the allowance over there is generous and a browser that walks at a
 * walking pace is never pulled. They come apart for two reasons, and only one
 * of them is worth a jump. A link that hiccups gets tugged back a fraction of
 * a tile, and snapping to that would fight your own feet every step. Dying
 * puts you back where you first came ashore, which is hundreds of tiles, and
 * not jumping to *that* is walking around dead — which is what was reported.
 *
 * Four tiles is well past any tug and nowhere near any teleport.
 */
export const SNAP_GAP = 4;

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
 * It was a week, and a week turned out to be the whole life of an island.
 *
 * Reported: a browser hung coming ashore. Nothing was broken by then — the
 * read had just been fixed to page properly — but an island played on all day
 * had every single change anybody had ever made still sitting in the table,
 * because not one of them was seven days old yet. A morning of levelling and
 * paving is a row per tile per spadeful, and the join was replaying every one
 * of them to arrive at a state that a fraction of them describes.
 *
 * An hour. Long enough that somebody who dropped off over lunch still gets
 * their own afternoon in the order it happened, short enough that the table
 * settles at roughly one row per tile anybody has ever touched — which is
 * what a join actually wants, and what it would have to download anyway.
 */
export const CHANGE_KEEP = 3600;

/**
 * How often the keeper does the tidying, as against the settling.
 *
 * The clock comes round every few seconds because a finished job should land
 * at once. Sweeping up old talk and collapsing old diffs is not that sort of
 * work — doing it twelve times a minute would be twelve scans to delete
 * nothing.
 */
export const SWEEP_EVERY = 300;

/**
 * Rows one sweep will delete, per island, per kind.
 *
 * Five thousand every five minutes is a thousand an hour more than a busy
 * island makes, which is fine until an island has a backlog — and with a keep
 * window of a week, every island has one the first time this runs against it.
 * The work is a delete by primary key; fifty thousand of them is not a
 * different kind of job from five, and it is the difference between a backlog
 * that drains in an afternoon and one that never does.
 */
export const SWEEP_ROWS = 50000;

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

/* ---- Reading the land rather than replaying how it got that way --------- */

/**
 * The side of the biggest square of land the island will hand over at once.
 *
 * Four hundred tiles is a hundred and sixty thousand of them — about a
 * megabyte of tiles, data, rock, heights and soil before base64 and before the
 * transport gzips it, which land does unusually well at. Big enough that
 * coming ashore is one ask; small enough that no ask can be used to pull a
 * 4096 island down a row at a time.
 *
 * The island enforces it; the browser splits anything bigger into several.
 */
export const LAND_ASK = 400;

/**
 * And the square read around the body before anybody comes ashore.
 *
 * Far past what the camera draws and far past a walk between reconciles, so
 * the ground under you is the island's own and not the generator's guess at
 * it. What has been seen but is not near gets read after the first frame, so
 * the map fills in behind you rather than holding the page.
 */
export const LAND_NEAR = 192;

/**
 * How many rows of the island's history come down in one request.
 *
 * It used to be all of them: `select('*')` over a table that grows with every
 * spadeful anybody has ever turned, in one go, on every join. That works on a
 * young island and stops working at some point during a morning's paving —
 * and because a failed read looks exactly like an island where nothing has
 * ever happened, what it looked like was every paved tile and every levelled
 * yard reverting to the hillside it was cut from.
 *
 * Twenty thousand is a page small enough to come back reliably and big enough
 * that a well-dug island is a handful of them rather than a hundred round
 * trips a phone has to make one after another.
 */
export const CHANGE_PAGE = 20000;

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
 *
 * One second. Together with the ground below it this is the largest call in
 * the budget, which is why `CALLS_A_MINUTE` moved with it.
 */
export const MOBS_EVERY = 1;

/**
 * And how much slower everything is asked for when nobody is looking.
 *
 * A tab in the background is still a browser with a clock in it: it kept
 * asking the island for the wildlife and the ground once a second apiece, for
 * a screen nobody could see, and paid for both. A browser throttles its own
 * timers when a tab is hidden, but not reliably and not by this much, and the
 * frames that do run should not spend the island's budget. Eight to one is
 * enough that a tab left open all afternoon costs a tenth of what it did, and
 * little enough that coming back to it is still a second or so behind.
 */
export const AWAY_SLOWER = 8;

/**
 * And how far apart the ground is asked for when nothing here is happening.
 *
 * The wildlife is deliberately not slowed this way — a beast crossing a field
 * is the one thing on this island that reads as broken when it is stale. What
 * is *set down* is different: a crate, a fire, a wall does not move unless
 * somebody moves it, and while you are standing still and not working, the
 * only thing that can change it is another person. Four seconds is a fair
 * wait to hear about somebody else's fence, and the moment you move or do
 * anything at all it goes back to one.
 */
export const GROUND_IDLE = 4;

/** How far out to ask. Beyond this a thing is somebody else's weather. */
export const MOBS_RANGE = 40;

/**
 * How far past the asking a creature's leg is allowed to reach.
 *
 * Where a thing *is* is a point on the leg it is walking: four columns and the
 * clock, which is nothing a btree can look up. So both the sweep and the read
 * narrow first on where the leg *ends*, which is one index away, and then work
 * the exact answer out for the handful that survives.
 *
 * This is the slack that makes the first filter a superset of the second. It
 * is enormous on purpose: the longest leg measured on a real island is 2.13
 * tiles, and `creature_sweep` has bounded itself this way since it was written
 * with eight. Sixty-four still cuts a 4096 island to a twentieth — measured,
 * one island with four thousand creatures on it:
 *
 *     rpc_creatures, whole island   120 buffers   1.51 ms
 *     narrowed to the box            22 buffers   0.25 ms
 *     creature_sweep, the same        9 buffers   0.05 ms
 *
 * and it changes the shape rather than the constant: what these cost is the
 * creatures near you now, not the creatures on the island.
 */
export const LEG_SLACK = 64;

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

/**
 * Calls one person may make in a minute before the island stops listening.
 *
 * It has to carry the polls above with room to spare, and they moved. What one
 * body costs now, per minute:
 *
 *     wildlife, every second      60
 *     ground, every second        60
 *     reconcile, every twenty      9   (three calls a round)
 *     the beat                     1   at rest, ~13 through a run of work
 *     fog, every forty-five        1   and only when new ground was seen
 *     where you are                60   while walking, and never standing still
 *                                ---
 *                                 203  walking and working, against 240
 *
 * Eighty-five per cent of the old ceiling, with nothing left for a handful of
 * instant asks — and what happens at the ceiling is not a polite refusal. A
 * thrown `rpc_creatures` hands the browser `null`, `rowsIn` makes `[]` of it,
 * and `sawAll([])` takes every creature off the screen. So the ceiling is
 * doubled, which is the same order of traffic per player and leaves the burst
 * room the old one had.
 *
 * (The other half of that hazard is fixed where it lives: `refreshMobs` no
 * longer treats a call that failed as an island with nothing on it.)
 */
export const CALLS_A_MINUTE = 480;

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
 * The same beat as the wildlife now. It used to be slower on the grounds that
 * the wildlife is the thing that moves — but a fire burning down and a kiln
 * working through its load are things you stand and watch, and a second is
 * what they are worth. The answer is usually a handful of rows and often none.
 */
export const GROUND_EVERY = 1;

/** And how far out, which is past anything a screen shows. */
export const GROUND_RANGE = 40;
