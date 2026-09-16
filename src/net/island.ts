import type { RealtimeChannel } from '@supabase/supabase-js';
import { World } from '../world/world';
import { blankWorld, layChange, rowsOf, type TileChange } from './landpack';
import { generateAtlasWindow, loadAtlas, type Atlas } from '../world/atlas-world';
import { PROJECT, supabase, signIn } from './supabase';
import type { IslandCreature } from '../game/creatures';
import type { IslandGround } from '../game/game';
import { BODY_EVERY, FOG_EVERY, FOUND_MAX, GROUND_EVERY, GROUND_RANGE, HEARTBEAT, MOBS_EVERY, MOBS_RANGE, RECONCILE_EVERY, REGION } from '../game/keep';
import { packFog, unpackFog } from './fogpack';

/**
 * Playing on an island that lives in Postgres.
 *
 * The shape of this is the whole design in miniature: **everything read comes
 * straight off the tables, and everything done goes through a function.** Row
 * level security decides the first; the rules in `supabase/migrations` decide
 * the second. There is no third path and no local authority — this class
 * cannot make anything true, it can only ask and then listen.
 *
 * What that buys, compared with the host-in-a-tab it replaces: nobody's tab
 * owns the world, so nobody's tab going to sleep stops it; a client that rolls
 * its own successes cannot, because it does not roll them; and an island is
 * still there next week whether or not the person who made it ever comes back.
 */

/** How many rows of island go in one request. Big enough to be few, small enough to land. */
const UPLOAD_BATCH = 32;
/**
 * The biggest island a browser will hand over.
 *
 * Founding uploads the land, and that is the one time it has to travel: it is
 * how the rules in Postgres come to know what the ground is. A 4096 island is
 * three minutes of generation and 138 MB of upload, which is fine for a tool
 * run once and is not something to do inside a tab with somebody watching. So
 * the browser founds small islands and `tools/found-island.ts` founds the big
 * one — and this is the line between them, said out loud rather than
 * discovered at minute two.
 */
/**
 * How often we tell the island where we are.
 *
 * Not the frame rate, and deliberately far below it: this is a write to a
 * table, and the only thing that *needs* it is the reach check on the next
 * thing we try to do. Other people see us move through the channel below,
 * which costs nothing and is allowed to be wrong for a moment.
 */
const MOVE_EVERY = 1.0;

/**
 * An answer, read as the rows it was meant to be.
 *
 * `?? []` covers an answer of `null` and nothing else, and an answer that is
 * not a list arrives here more often than it looks: a function whose signature
 * has moved on, an error object from PostgREST, a proxy putting its own page
 * in the way. Every one of those used to reach a `for … of` and throw, and a
 * throw out of an animation frame stops the frames. No rows is the right
 * reading of anything that is not rows — the island is still the authority,
 * and a browser that falls over is no use to it.
 */
const rowsIn = <T>(data: unknown): T[] => (Array.isArray(data) ? (data as T[]) : []);

/**
 * Who is holding a share of a topic that has to be shared.
 *
 * One `Island` per page is the only thing that ever ships, and then this is a
 * map with one entry in it. Two happen in a test that joins again to see what
 * somebody arriving now would see — and because `supabase-js` hands back one
 * channel object per name, the second one leaving would otherwise take the
 * first one's bodies down with it, which is a false negative that looks
 * exactly like the bug such a test is there to catch.
 */
const shares = new Map<string, { channel: RealtimeChannel; users: number }>();

/** Take a share of a shared topic, making the channel if nobody has yet. */
function hold(topic: string, make: () => RealtimeChannel): RealtimeChannel {
  const had = shares.get(topic);
  if (had) {
    had.users += 1;
    return had.channel;
  }
  const channel = make();
  shares.set(topic, { channel, users: 1 });
  return channel;
}

/** Give a share back, and close the channel when the last one goes. */
async function drop(topic: string): Promise<void> {
  const had = shares.get(topic);
  if (!had) return;
  had.users -= 1;
  if (had.users > 0) return;
  shares.delete(topic);
  await supabase().removeChannel(had.channel);
}

/**
 * A job lined up behind the one in hand, and how many goes it is for.
 *
 * The count used to be dropped on the way out of the island — the queue went
 * over as a list of action ids — so a queue of one flatten and a queue of ten
 * were the same three letters, and the line under the bar could not say which
 * it was looking at.
 */
export interface Lined {
  action: string;
  goes: number;
}

/**
 * The queue as it arrives, whichever shape it is in.
 *
 * An island that has not had the migration pushed yet sends bare ids, and a
 * browser that has not been redeployed reads objects as ids and finds no
 * action of that name. So this takes both and neither order of landing shows
 * anything false: the worst either end does is fall back to one go.
 */
export function lineUp(rows: unknown): Lined[] {
  if (!Array.isArray(rows)) return [];
  const out: Lined[] = [];
  for (const r of rows) {
    if (typeof r === 'string') out.push({ action: r, goes: 1 });
    else if (r && typeof r === 'object' && typeof (r as Lined).action === 'string') {
      const n = (r as Lined).goes;
      out.push({ action: (r as Lined).action, goes: typeof n === 'number' && n > 0 ? n : 1 });
    }
  }
  return out;
}

export interface WorldRow {
  id: string;
  name: string;
  seed: number;
  size: number;
  spawn_x: number;
  spawn_y: number;
  epoch: string;
  ready: boolean;
}

export interface PlayerRow {
  world_id: string;
  uid: string;
  name: string;
  x: number;
  y: number;
  level: number;
  /** Skin, hair, eyes and clothes, as ids out of `look_option`. */
  look?: unknown;
  act: string | null;
  act_ends: string | null;
  [key: string]: unknown;
}

/**
 * A row of the island's `item` table, whole.
 *
 * Named out rather than left to the index signature below, because what this
 * carries is the difference between a thing and the browser's idea of it: the
 * six fields at the top were all that was ever read off one, and the seven
 * under them were dropped on the floor. See `packed` in `play.ts`.
 */
export interface ItemRow {
  id: number;
  def: string;
  ql: number;
  dmg: number;
  count: number;
  extra: string | null;
  holder: string;
  /** Drinks left in a skin, or seconds of candle left as of `lit_at` in a lantern. */
  charges: number | null;
  /** Put by: not to be dropped, eaten, or swallowed by a recipe looking for its kind. */
  locked: boolean;
  /** Handed out rather than made, and so with nothing in it to better. */
  issued: boolean;
  /** 'rare', 'supreme' or 'fantastic'; null for the ordinary run of things. */
  rare: string | null;
  /** The colour it has taken, as a `dye_def` id. */
  dye: string | null;
  /** Circles of cunning worked into it. */
  bless: number | null;
  /** Alight, for the things that burn, and when it was set going. */
  lit: boolean;
  lit_at: string | null;
  /** The bag this is in, when `holder` says 'bag'. */
  inside: number | null;
  [key: string]: unknown;
}

export interface IslandHooks {
  /** A line for the log, from the island rather than from here. */
  say: (text: string, kind: string) => void;
  /** The ground changed under somebody's feet, possibly ours. */
  ground: (x: number, y: number) => void;
  /** Somebody moved, arrived or left. */
  people: (people: PlayerRow[]) => void;
  /** What is in our hands changed. */
  pack: (items: ItemRow[]) => void;
  /**
   * What the island says we are in the middle of, and how far through it is.
   *
   * Seconds rather than timestamps: they are worked out on the island, off two
   * of its own clocks, so a browser whose clock is a minute out still draws
   * the right bar.
   */
  doing?: (what: { act: string | null; total: number; secs: number; left?: number; goes?: number; queued: number }) => void;
  /**
   * The rest of you, as the island has it.
   *
   * The island owns the player — queue, skills, stats, and the ore a
   * prospector read — and `player` came off the Realtime publication when
   * bodies moved to Broadcast, so the browser's copy of you was whatever the
   * join handed over and never moved again. It rides the heartbeat, which was
   * making the round trip anyway.
   */
  /*
   * Every field is "what the island said about this", and a field it did not
   * mention is left alone. `rpc_settle` mentions all of them; `rpc_act`'s
   * answer to a queued job mentions the queue and nothing else, and must not
   * put out a prospector's marks on its way past.
   */
  mine?: (what: {
    queue?: Lined[];
    cap?: number | null;
    stats?: Record<string, number> | null;
    skills?: Record<string, number> | null;
    /** What you are carrying, which the island keeps and had never said. */
    wounds?: unknown[];
    marks?: { tiles: number[]; secs: number } | null;
  }) => void;
  /**
   * Everything wild within sight, as the island has it.
   *
   * Nothing under `src/` called `rpc_creatures` until now, so on a live island
   * the wildlife was there and moving and hunting and *invisible* — the
   * footer read `0/0 mobs` and was telling the truth about what the browser
   * had asked for.
   */
  mobs?: (rows: IslandCreature[]) => void;
  /**
   * Everything the island has set down on the ground near us.
   *
   * `placed` has been there since the island was built and nothing under
   * `src/` ever read it, so on a live island every campfire, smelter, kiln,
   * anvil, work post, trap and stick of furniture anybody had set down was in
   * Postgres and invisible — and so was every crate, and so was the
   * settlement. Reported as "placed campfire doesn't show": it was there.
   */
  built?: (ground: IslandGround) => void;
  /** Getting an island down takes a moment; this says how it is going. */
  progress?: (done: number, total: number, what: string) => void;
  /**
   * How to read the survey chart, for anybody joining from outside a browser.
   *
   * Left out, it is `loadAtlas`, which is an `Image` and a canvas. The smoke
   * test runs in Node and has neither, so it passes the reader in `tools/`.
   */
  chart?: () => Promise<Atlas>;
}

/**
 * What `rpc_act` says back. `done` comes back true for the instant sort, which
 * the island settles on the way out rather than leaving for the next touch.
 */
export interface ActResult {
  started: boolean;
  queued?: boolean;
  done?: boolean;
  why?: string;
  seconds?: number;
  ends?: string;
  inHand?: number;
  capacity?: number;
  /** What is lined up behind the job in hand, when this ask put something there. */
  queue?: unknown[];
}

export class Island {
  world: World | null = null;
  info: WorldRow | null = null;
  me: PlayerRow | null = null;
  uid = '';
  readonly people = new Map<string, PlayerRow>();
  private channel: RealtimeChannel | null = null;
  /**
   * What the channel said when we asked to listen.
   *
   * Worth keeping rather than discarding, because "subscribed and nothing has
   * happened" and "never subscribed at all" look identical from here — and a
   * client that has quietly stopped listening is a client watching a world
   * that has moved on without it.
   */
  channelState = 'not asked';
  private atlas: Atlas | null = null;
  private lastMove = 0;
  private lastMobs = 0;
  private lastGround = 0;
  private lastSaid = '';
  /** The highest tile change we have taken in, so catching up never doubles back. */
  private seenChange = 0;
  /**
   * The timer that turns our own handle.
   *
   * Nothing on this island ticks: every job settles off a timestamp the next
   * time something calls in. `rpc_move` was effectively the only caller, and
   * it is skipped when the body has not gone anywhere new — so a thirty-second
   * go at a rock finished while standing still landed at whatever later moment
   * we happened to walk somewhere, all of it at once. This is the other half
   * of the fix: the island has `pg_cron` for everybody else, and we ask for
   * ourselves the moment our own work is due.
   *
   * It is the heartbeat too. `rpc_settle` writes `seen_at`, which is what
   * tells the island the difference between somebody standing still at a forge
   * and a tab that was shut an hour ago.
   */
  private beat: ReturnType<typeof setTimeout> | null = null;
  /** The block of country the channel is listening to, as `rx,ry`. */
  private block = '';
  /**
   * The highest line of talk we have heard, from either road.
   *
   * Realtime is the fast one and is not a promise: a channel that dropped for
   * a moment loses whatever was said while it was down, and `event` was the
   * one table with no way to catch up. The beat carries this and gets back
   * anything newer, so a dropped line arrives late rather than never — and
   * because both roads are counted here, nothing arrives twice.
   */
  private said = 0;
  /**
   * Whether the next ground read should bring the things that hardly move.
   *
   * Buildings, walls, floors and settlements cost a correlated subquery and
   * three scans, and they only change when somebody builds. So they come on
   * the reconcile, and on the first read after any of our own work — which is
   * what stops a wall you just put up waiting twenty seconds to exist.
   */
  private groundSlow = true;
  /** The island's shared topic we are holding a share of, if any. */
  private bodiesTopic = '';
  /** Bodies go on a topic everybody on the island agrees on. */
  private bodies: RealtimeChannel | null = null;
  /** Numbers the row topics, so no two subscriptions are ever the same name. */
  private static topics = 0;
  private lastBody = 0;
  private lastReconcile = 0;
  /** When the fog of war last went over, so it goes rarely and not per step. */
  private lastFog = 0;
  /**
   * The signed-in token, kept rather than asked for.
   *
   * `getSession` is a promise, and the one moment this is needed — the page
   * going away — has no time for one. Refreshed wherever the channel refreshes
   * its own copy, which is every join and every walk into new country.
   */
  private token = '';
  /** Our pack, kept by row rather than refetched whole on anybody's crafting. */
  private pack = new Map<number, ItemRow>();
  /**
   * Where everything the island says goes. Not readonly: the first few lines
   * arrive while the land is still coming down, before there is a game to put
   * them in, so whoever is starting up swaps these once it has one.
   */
  constructor(readonly hooks: IslandHooks) {}

  /**
   * Put an island that was rolled here into the database, once.
   *
   * World generation stays in the browser: it is a large deterministic
   * function of a seed that already exists and is tested, and a second
   * implementation in SQL would be two islands that have to agree forever.
   * So it is rolled here, handed over, and after that it is not ours.
   */
  async found(world: World, name: string, spawn: { x: number; y: number }): Promise<string> {
    if (world.w > FOUND_MAX) {
      throw new Error(
        `An island of ${world.w} tiles is too big to hand over from a browser — that is ${Math.round((world.w + 1) * 33.7 / 1024)} MB of land and minutes of generation. `
        + `Found it with tools/found-island.ts instead, and come ashore on it with ?island=<id>.`,
      );
    }
    this.uid = await signIn();
    const sb = supabase();
    const { data: id, error } = await sb.rpc('rpc_found', {
      p_name: name, p_seed: world.seed, p_size: world.w, p_spawn_x: spawn.x, p_spawn_y: spawn.y,
    });
    if (error || typeof id !== 'string') throw new Error(`The island could not be started: ${error?.message}`);
    const rows = world.h + 1;
    for (let y = 0; y <= world.h; y += UPLOAD_BATCH) {
      const batch = rowsOf(world, y, Math.min(world.h, y + UPLOAD_BATCH - 1));
      const { error: put } = await sb.rpc('rpc_put_land', { p_world: id, p_rows: batch });
      if (put) throw new Error(`The land did not all arrive: ${put.message}`);
      this.hooks.progress?.(Math.min(rows, y + UPLOAD_BATCH), rows, 'handing over the island');
    }
    const { error: open } = await sb.rpc('rpc_ready', { p_world: id });
    if (open) throw new Error(`The island would not open: ${open.message}`);
    return id;
  }

  /**
   * Come ashore: the body first, then the land, then everything since.
   *
   * The land does not come down the wire any more, and that is the whole of
   * what makes a big island affordable. It used to: `rpc_land` for every
   * scanline, base64 inside JSON, which is about half a megabyte on a
   * 256-tile island and **138 MB on a 4096 one** — paid by every player, on
   * every join, forever. At ten thousand joins a day that is forty-one
   * terabytes a month.
   *
   * But the land is a pure function of the seed and the chart, and this
   * browser already has the generator and the chart. So the join carries the
   * seed, and the ground is worked out here, a square at a time, as somebody
   * walks into it. What is left on the wire is `tile_change` — what people
   * have actually dug — which grows with how much a place is lived in rather
   * than with how big it is. **World size stops being a cost.**
   *
   * Postgres keeps its own copy and stays the authority: it is what the rules
   * are checked against, and what settles it when generation and history
   * disagree. It is still there to be read, as `land_window` — by the owner,
   * from psql. It was `rpc_land` until the `rpc_` prefix handed every account
   * a grant to pull a hundred and thirty-eight megabytes of it in a loop.
   */
  async join(worldId: string, name: string): Promise<void> {
    this.uid = await signIn();
    const sb = supabase();
    const { data, error } = await sb.rpc('rpc_join', { p_world: worldId, p_name: name });
    if (error) throw new Error(`The island would not have us: ${error.message}`);
    const got = data as { world: WorldRow; you: PlayerRow; new: boolean };
    this.info = got.world;
    // The hour, straight away, so the first frame is drawn in the island's
    // light rather than in whatever this browser last believed.
    this.pinClock((got as { time?: unknown }).time);
    this.me = got.you;

    const size = got.world.size;
    const seed = got.world.seed;
    const world = blankWorld(size, seed);
    this.hooks.progress?.(1, 3, 'reading the chart');
    const atlas = await this.chart();
    world.streamFrom((x0, y0, w, h) => generateAtlasWindow(seed, atlas, x0, y0, w, h, size));
    // The ground under your own feet, before anything else asks for it.
    const here = got.you;
    world.ensureBox(Math.floor(here.x) - 64, Math.floor(here.y) - 64, Math.floor(here.x) + 64, Math.floor(here.y) + 64);
    this.hooks.progress?.(2, 3, 'working out the ground');

    /*
     * Everything ever dug, in the order it happened — from the beginning, not
     * from where we left off.
     *
     * This read the cursor the island keeps for us, and that was wrong in a way
     * that takes a moment to see. The cursor says how much of the history this
     * person has *been told*; it does not say anything about the world it was
     * told into. And the world is built fresh from the seed on every join, so
     * starting at the cursor lays pristine ground under every change anybody
     * ever made before this session — a tree somebody felled a week ago stands
     * again, you are told there is nothing there to cut down, and the island is
     * right and the screen is wrong. Reported from a phone; exactly this.
     *
     * The cursor is a within-a-session thing: `catchUp` moves it so that the
     * twenty-second reconcile asks for what is new rather than for everything
     * again. It is not where a join begins.
     *
     * What keeps this affordable is `compact_changes` rather than a cursor:
     * everything older than a week collapses to one row per tile, so the
     * history a join reads is bounded by how many tiles have ever been touched
     * and not by how many times anybody touched them.
     */
    /*
     * The world goes in *before* the replay, not after.
     *
     * `applyChange` starts `const w = this.world; if (!w) return;` — so with
     * the assignment below the loop, every change the replay read was thrown
     * away in silence. Not one of them has ever been applied at a join since
     * the land stopped travelling. Realtime worked, which is why nothing
     * noticed: the changes that arrive *while* you are here land fine, and it
     * is only the ones from before you arrived that vanish. A tree felled an
     * hour ago stands again on the next refresh, and the island tells you
     * there is nothing there to cut down.
     *
     * The cursor I removed yesterday was a second lid on the same box.
     */
    this.world = world;
    this.seenChange = 0;
    await this.catchUp();
    this.hooks.progress?.(3, 3, 'catching up');
    world.groundTouched = false;
    await this.restoreFog();
    await this.watch(worldId);
    this.armBeat(HEARTBEAT);
  }

  /**
   * Where this body has already been, which the island keeps for it.
   *
   * It was in `localStorage` and only there — the single-player answer, never
   * changed when the island became the game. A refresh, another phone, or a
   * browser tidying up its site data, and a 4096 island is black again with
   * somebody standing in the middle of it. Of everything that is yours, the
   * map of where you have walked was the one thing that lived in the tab.
   *
   * A fog that will not come back is not a reason to refuse to come ashore, so
   * nothing here throws: the worst of it is a black map and an afternoon's
   * walking to light it again.
   */
  private async restoreFog(): Promise<void> {
    const w = this.world;
    if (!this.info || !w) return;
    try {
      const { data } = await supabase().from('fog').select('seen')
        .eq('world_id', this.info.id).eq('uid', this.uid).maybeSingle();
      const packed = (data as { seen?: string } | null)?.seen;
      if (!packed) return;
      const tiles = unpackFog(w, packed);
      if (tiles < 0) {
        this.hooks.say('The island could not make out where you have been; the map starts dark.', 'error');
        return;
      }
      // Restored rather than newly seen: nothing has changed since the island
      // was told, so there is nothing to tell it back.
      w.fogTouched = false;
    } catch {
      // Offline, or a keeper that has never heard of fog. The map starts dark,
      // which is what it did before any of this and is survivable.
    }
  }

  /**
   * Hand the fog over, rarely, and only when there is new ground in it.
   *
   * Walking writes it constantly and none of it matters until the tab is shut,
   * so this is slow on purpose and skipped entirely while nothing new has been
   * looked at. `lastFog` is left alone when there is nothing to send, so
   * stepping over the ridge after an hour indoors is not made to wait another
   * three quarters of a minute.
   */
  private async keepFog(now: number): Promise<void> {
    if (!this.world?.fogTouched || now - this.lastFog < FOG_EVERY) return;
    this.lastFog = now;
    await this.saveFog();
  }

  /** The same, now, whoever is asking. */
  async saveFog(): Promise<void> {
    const w = this.world;
    if (!this.info || !w) return;
    w.fogTouched = false;
    const packed = packFog(w);
    if (!packed) return;
    const { error } = await supabase().rpc('rpc_fog', { p_world: this.info.id, p_seen: packed });
    // Refused or unreachable: put the flag back so the next round tries again
    // rather than waiting for somebody to walk somewhere new.
    if (error) w.fogTouched = true;
  }

  /**
   * The same, on the way out of the page, where an ordinary request is a race
   * with the tab closing.
   *
   * `keepalive` is what that is for: the browser promises to finish the
   * request even though the page that asked is gone. It is a raw call rather
   * than the client's own, because the client has no way to ask for it — and
   * without this the last three quarters of a minute of walking is lost on
   * every refresh, which is a smaller version of the thing being fixed.
   *
   * Nothing is awaited and nothing is reported: there is no page left to tell.
   */
  fogOnExit(): void {
    const w = this.world;
    if (!this.info || !w || !w.fogTouched) return;
    const packed = packFog(w);
    if (!packed) return;
    w.fogTouched = false;
    if (!this.token) return;
    try {
      void fetch(`${PROJECT.url}/rest/v1/rpc/rpc_fog`, {
        method: 'POST',
        keepalive: true,
        headers: {
          'content-type': 'application/json',
          apikey: PROJECT.key,
          authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ p_world: this.info.id, p_seen: packed }),
      });
    } catch {
      // A browser without `keepalive`, or one already halfway gone. The
      // periodic hand-over above has the rest of it.
    }
  }

  /**
   * Read the ground that changed while we were not listening, and move the
   * cursor up to it.
   *
   * This is the truth and Realtime is the fast path. They carry the same rows
   * the same way, so a message that never arrived — a channel that dropped, a
   * block walked into between one subscription and the next — is caught here
   * within twenty seconds rather than never. Applying a change twice is
   * nothing: it sets the tile to what the tile already is.
   */
  private async catchUp(): Promise<void> {
    if (!this.info) return;
    const { data } = await supabase().from('tile_change').select('*')
      .eq('world_id', this.info.id).gt('n', this.seenChange).order('n');
    const rows = rowsIn<{ n: number; x: number; y: number; tile: number; data: number; corners: number[] }>(data);
    for (const c of rows) this.applyChange(c);
    if (rows.length) this.seenChange = Math.max(this.seenChange, rows[rows.length - 1].n);
  }

  /** The nine blocks of country around a point, as Realtime filter values. */
  private blocksAround(x: number, y: number): number[] {
    const size = this.info?.size ?? 0;
    const last = Math.max(0, Math.floor((size - 1) / REGION));
    const rx = Math.floor(x / REGION);
    const ry = Math.floor(y / REGION);
    const out: number[] = [];
    for (let j = ry - 1; j <= ry + 1; j++) {
      for (let i = rx - 1; i <= rx + 1; i++) {
        if (i < 0 || j < 0 || i > last || j > last) continue;
        out.push(j * 1024 + i);
      }
    }
    return out;
  }

  /**
   * Ask the island to settle us, and set the next asking.
   *
   * The answer carries what is still due, so the next timer comes off the same
   * round trip rather than off a Realtime row we may not be carrying. A job
   * that ends in four seconds is asked for in four seconds; with nothing due
   * it falls back to the heartbeat.
   */
  private armBeat(seconds: number): void {
    if (this.beat) clearTimeout(this.beat);
    this.beat = setTimeout(() => void this.pulse(), Math.max(0.5, seconds) * 1000);
  }

  private async pulse(): Promise<void> {
    if (!this.info) return;
    try {
      /*
       * Which island this is a beat for, which it never said.
       *
       * `rpc_settle` was the one door of the twenty that took no `p_world`, so
       * the island had to guess — and `rpc_join` leaves a player row behind on
       * every island you have ever joined, so there was more than one row to
       * guess between and nothing to choose by. The same answer carries the
       * hour and the bars, so when the guess moved, the sun and the body moved
       * with it: "it switches randomly to nighttime and hunger/thirst plummet
       * until refreshed". Refreshing worked because `rpc_join` names its
       * island. This one does now too.
       */
      const { data } = await supabase().rpc('rpc_settle', {
        p_seen: this.seenChange,
        p_world: this.info.id,
        p_said: this.said,
      });
      const said = (data ?? {}) as {
        settled?: number; act?: string | null; ends?: string | null;
        left?: number | null; secs?: number | null; total?: number | null; queued?: number;
        queue?: unknown; cap?: number | null;
        stats?: Record<string, number> | null; skills?: Record<string, number> | null;
        wounds?: unknown[] | null;
        marks?: { tiles?: number[]; secs?: number } | null;
        goes?: number | null; time?: number | null; night?: boolean | null;
        said?: Array<{ n: number; text: string; kind: string }> | null;
      };
      // The hour, on the beat every browser makes anyway. Nothing else has to
      // happen for the sun to move, and nothing can make it drift for long.
      /*
       * Anything said while nobody was listening.
       *
       * Only ever lines we have not heard — the cursor moves with both roads —
       * so this is a catch-up and not an echo. Said before the rest of the
       * answer is applied, so the log reads in the order it happened.
       */
      for (const line of said.said ?? []) {
        if (line.n <= this.said) continue;
        this.said = line.n;
        this.hooks.say(line.text, line.kind);
      }
      this.pinClock(said.time);
      if (typeof said.night === 'boolean') this.islandNight = said.night;
      this.hooks.mine?.({
        queue: lineUp(said.queue),
        cap: said.cap ?? null,
        stats: said.stats ?? null,
        skills: said.skills ?? null,
        wounds: Array.isArray(said.wounds) ? said.wounds : undefined,
        marks: said.marks?.tiles ? { tiles: rowsIn<number>(said.marks.tiles), secs: said.marks.secs ?? 0 } : null,
      });
      this.hooks.doing?.({
        act: said.act ?? null,
        total: said.total ?? 0,
        secs: said.secs ?? 0,
        left: said.left ?? undefined,
        goes: said.goes ?? undefined,
        queued: said.queued ?? 0,
      });
      // Something landed, so what we are carrying may have changed in a way no
      // row-level message would have told us about — a thing put down, say.
      if ((said.settled ?? 0) > 0) void this.refreshPack();
      const due = said.ends ? (new Date(said.ends).getTime() - Date.now()) / 1000 : Infinity;
      // A quarter-second of slack, because a timer that fires a shade early
      // asks for work that is not due yet and has to ask again.
      this.armBeat(Math.min(HEARTBEAT, Math.max(0.5, due + 0.25)));
    } catch {
      // A round trip that failed is not a reason to stop asking; the island is
      // the authority on whether anything happened, and it will still be there
      // in a heartbeat's time.
      this.armBeat(HEARTBEAT);
    }
  }

  /**
   * The survey chart, read once and kept.
   *
   * `loadAtlas` goes through an `Image` and a canvas, which is the right way to
   * do it in a tab and no way at all anywhere else — the smoke test joins a
   * real island from Node and died on `Image is not defined` the moment the
   * join started generating ground. So whoever is joining may say how the
   * chart is read, and a browser, which is almost always the answer, says
   * nothing and gets the browser's way.
   */
  private async chart(): Promise<Atlas> {
    if (!this.atlas) this.atlas = await (this.hooks.chart ?? loadAtlas)();
    return this.atlas;
  }

  /**
   * A tile the island says changed.
   *
   * It does not touch the cursor. The cursor means "everything up to here has
   * been read out of the table", and a Realtime row is not that — we may be
   * listening to nine blocks of country out of two hundred and fifty-six, so
   * moving the cursor past a row that arrived here would step over every dig
   * in the rest of the island. `catchUp` owns it.
   */
  private applyChange(c: TileChange & { n: number; world_id?: string }): void {
    const w = this.world;
    if (!w) return;
    // A block number is a block number on every island, and Realtime takes one
    // filter per subscription. Row level security already refuses rows from an
    // island we are not on; this is the belt behind the braces.
    if (c.world_id && this.info && c.world_id !== this.info.id) return;
    if (!layChange(w, c)) return;
    this.hooks.ground(c.x, c.y);
  }

  /**
   * Listen to the island, and only to the part of it we are standing in.
   *
   * Still the tables rather than messages invented for the purpose — there is
   * no wire format here to keep in step with anything — but three of the four
   * streams changed shape, and each for its own reason.
   *
   * **Ground** comes by block. One channel per island sent a 4096 map's worth
   * of digging to everybody on it; nine blocks of 256 tiles is a square 768
   * across, far past anything a screen can show and far short of Cornwall.
   * Walking out of the square re-subscribes and reads the backlog of whatever
   * is new, so nothing is missed by moving.
   *
   * **Our pack** is filtered to rows with our own uid on them, and applied row
   * by row. It used to answer any item change anywhere on the island by
   * downloading the whole pack again, which with N people crafting is N round
   * trips per craft. A thing we put *down* stops matching the filter, so the
   * reconcile below is what notices that.
   *
   * **Bodies** are not a table at all any more. `player` is written once a
   * second by every walking body and was published, which is one billed
   * message per subscriber per second per player; Broadcast never touches the
   * write-ahead log. The roster is reconciled from the table every twenty
   * seconds, which is what notices somebody arriving or leaving.
   */
  private async watch(worldId: string): Promise<void> {
    const sb = supabase();
    /*
     * A new name every time, and the old channel thrown away rather than
     * merely hushed.
     *
     * `supabase-js` keeps its channels in a list and hands back the one it
     * already has for a name, so a topic written down and used twice is one
     * object used twice. That is three bugs wearing a coat. Asking it to
     * listen to `postgres_changes` after it has subscribed throws outright —
     * which is what took the live run down, when a second `Island` in the page
     * asked for the island's one topic. Where it does not throw it accumulates
     * instead: walking into a new block bound nine more tile filters onto the
     * nine already there, until the server's idea of the bindings and the
     * client's stopped matching and the whole channel was dropped. And
     * `subscribe()` is a quiet no-op on a channel that has not finished
     * leaving, so re-listening under the same name could simply never answer.
     *
     * None of it can happen to a name that has never been used, and rows do
     * not need an agreed name: every client filters them for itself.
     * `removeChannel` is the one that tears the old one down and takes it out
     * of the list, which `unsubscribe` on its own does not.
     */
    const stale = this.channel;
    this.channel = null;
    if (stale) void sb.removeChannel(stale);
    const on = `world_id=eq.${worldId}`;
    const here = this.me ?? { x: 0, y: 0 };
    const blocks = this.blocksAround(here.x, here.y);
    this.block = `${Math.floor(here.x / REGION)},${Math.floor(here.y / REGION)}`;
    let listening = sb.channel(`rows:${worldId}:${(Island.topics += 1)}`, { config: { broadcast: { self: false } } });
    for (const b of blocks) {
      listening = listening.on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tile_change', filter: `region=eq.${b}` },
        (m) => this.applyChange(m.new as never));
    }
    this.channel = listening
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'event', filter: on },
        (m) => {
          const e = m.new as { n?: number; text: string; kind: string; uid: string | null };
          if (e.uid && e.uid !== this.uid) return;
          // Counted on the way past, so the beat's catch-up knows where we got
          // to and does not say any of it twice.
          if (typeof e.n === 'number') this.said = Math.max(this.said, e.n);
          this.hooks.say(e.text, e.kind);
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'item', filter: `holder_uid=eq.${this.uid}` },
        (m) => {
          if (m.eventType === 'DELETE') this.pack.delete((m.old as ItemRow).id);
          else {
            const it = m.new as ItemRow;
            if (it.holder === 'player' || it.holder === 'bag') this.pack.set(it.id, it);
            else this.pack.delete(it.id);
          }
          this.hooks.pack([...this.pack.values()]);
        });

    /*
     * Bodies, on the one name everybody on the island agrees on.
     *
     * This is the opposite case to the rows above and for the same reason:
     * Broadcast only reaches people listening to the same topic, so it *has*
     * to be shared, and the block we are standing in has nothing to do with
     * it. Taken once at the join and held until we leave.
     */
    if (!this.bodies) {
      this.bodiesTopic = `island:${worldId}`;
      this.bodies = hold(this.bodiesTopic, () =>
        sb.channel(this.bodiesTopic, { config: { broadcast: { self: false } } }));
      this.bodies.on('broadcast', { event: 'body' }, (m) => {
        // A channel shared with another `Island` in the same page goes on
        // carrying bodies after we have left it; they are not ours any more.
        if (!this.bodies) return;
        const b = (m as { payload?: PlayerRow }).payload;
        if (!b?.uid || b.uid === this.uid) return;
        this.people.set(b.uid, { ...(this.people.get(b.uid) ?? b), ...b });
        this.hooks.people([...this.people.values()]);
      });
      this.bodies.subscribe();
    }

    // Realtime authorises against the signed-in user's token; make sure it has
    // the current one rather than whatever it started life with.
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (token) {
        this.token = token;
        (sb.realtime as unknown as { setAuth: (t: string) => void }).setAuth(token);
      }
    } catch {
      // An older or newer client may not want telling; the status below says
      // whether it mattered.
    }

    // Wait for the channel to actually say it is listening. `subscribe()`
    // hands back the channel immediately, so awaiting it proves nothing at
    // all: the status arrives later, through the callback, or never.
    const channel = this.channel;
    this.channelState = await new Promise<string>((resolve) => {
      let answered = false;
      const settle = (why: string): void => {
        if (!answered) {
          answered = true;
          resolve(why);
        }
      };
      channel.subscribe((status: string, err?: Error) => {
        if (status === 'SUBSCRIBED') settle('listening');
        else settle(`${status}${err ? `: ${err.message}` : ''}`);
      });
      setTimeout(() => settle('never answered'), 20000);
    });
    if (this.channelState !== 'listening') {
      this.hooks.say(`The island is not telling this machine what it does (${this.channelState}).`, 'error');
    }
    await this.refreshPeople();
    await this.refreshPack();
  }

  /**
   * Put the fast path back in step with the tables.
   *
   * Everything Realtime carries, read again the slow way: who is here, what we
   * are carrying, and what ground has changed. It is cheap — three indexed
   * reads that usually answer nothing new — and it is the only thing that
   * notices a body that left, a thing we put down, or a channel that quietly
   * stopped listening.
   */
  private async reconcile(now: number): Promise<void> {
    if (!this.info || now - this.lastReconcile < RECONCILE_EVERY) return;
    this.lastReconcile = now;
    // And the ground's slow half with it, so a wall somebody else built is
    // twenty seconds late at worst rather than never.
    this.groundSlow = true;
    await this.refreshPeople();
    await this.refreshPack();
    await this.catchUp();
  }

  /**
   * What is moving about near us.
   *
   * Asked for on its own beat, rather than with the rest of the reconcile: a
   * wild thing crossing a field is the one thing here that looks wrong when it
   * is twenty seconds stale, and the call also stirs the country round us — it
   * is `creature_sweep`'s only door.
   */
  async refreshMobs(now: number): Promise<void> {
    if (!this.info || !this.hooks.mobs || now - this.lastMobs < MOBS_EVERY) return;
    this.lastMobs = now;
    const { data, error } = await supabase().rpc('rpc_creatures', { p_world: this.info.id, p_range: MOBS_RANGE });
    /*
     * A call that failed is not an island with nothing on it.
     *
     * `rowsIn` makes `[]` of a `null`, and `sawAll([])` takes every creature
     * off the screen — so one dropped call, one rate limit, one blip of a
     * network emptied the field and the next answer put it all back. Harmless
     * while this ran every two seconds and somebody had to be unlucky; at one
     * a second it is sixty chances a minute. What we last saw is a better
     * picture of the island than nothing at all.
     */
    if (error || !Array.isArray(data)) return;
    this.hooks.mobs(rowsIn<IslandCreature>(data));
  }

  /**
   * What is on the ground here: everything set down, every crate, the deed.
   *
   * One call rather than a subscription to each of three tables, for the same
   * reason the wildlife is one call: the fires have to be worked out on
   * reading — a lit thing has burned the seconds since anybody last touched it
   * — so a row straight off the table would be stale in a way no client could
   * correct for.
   */
  async refreshGround(now: number): Promise<void> {
    if (!this.info || !this.hooks.built || now - this.lastGround < GROUND_EVERY) return;
    this.lastGround = now;
    // The slow half when it is owed, and the burning half every other time.
    const slow = this.groundSlow;
    this.groundSlow = false;
    const { data } = await supabase().rpc('rpc_ground', {
      p_world: this.info.id, p_range: GROUND_RANGE, p_slow: slow,
    });
    if (data) this.hooks.built(data as IslandGround);
  }

  async refreshPeople(): Promise<void> {
    if (!this.info) return;
    const { data } = await supabase().from('player').select('*')
      .eq('world_id', this.info.id).eq('away', false);
    this.people.clear();
    for (const p of rowsIn<PlayerRow>(data)) {
      this.people.set(p.uid, p);
      if (p.uid === this.uid) this.me = p;
    }
    this.hooks.people([...this.people.values()]);
  }

  /**
   * Our pack, whole rather than in changes.
   *
   * A dozen things is nothing to fetch, and a client that kept its own tally
   * from a stream of inserts and deletes would be a second opinion about what
   * we are carrying — which is exactly the sort of thing this whole move was
   * meant to get rid of.
   */
  async refreshPack(): Promise<void> {
    if (!this.info) return;
    /*
     * And what is in the bags, which never came down at all.
     *
     * `holder = 'player'` is what is loose in your hands; a thing stowed is
     * filed under `holder = 'bag'` with the bag's id in `inside`. So a
     * backpack on an island was an empty backpack however much was in it, and
     * `packed` nests the two back together on the way in.
     */
    const { data } = await supabase().from('item').select('*')
      .eq('world_id', this.info.id).in('holder', ['player', 'bag']).eq('holder_uid', this.uid);
    this.pack.clear();
    for (const it of rowsIn<ItemRow>(data)) this.pack.set(it.id, it);
    this.hooks.pack([...this.pack.values()]);
  }

  /**
   * Say where we have walked to — rarely, and never twice for standing still.
   *
   * The island believes this only as far as its own clock allows, and pulls us
   * back rather than refusing when the claim is too large. So this is not
   * where we are, it is what the island will let us have been.
   */
  async move(x: number, y: number, level: number, now: number): Promise<void> {
    if (!this.info) return;
    void this.reconcile(now);
    void this.refreshMobs(now);
    void this.refreshGround(now);
    void this.keepFog(now);
    const said = `${x.toFixed(2)},${y.toFixed(2)},${level}`;

    /*
     * Where the body is, five times a second, over Broadcast.
     *
     * This is a drawing message, not a fact: nobody's client can make anybody
     * else's position true, and the island keeps the truth on the row below.
     * It is here because the row used to be published, which made every
     * walking body one write-ahead-log record and one billed message per
     * subscriber every second — the single largest thing on the bill, and it
     * was people walking rather than people digging.
     */
    if (said !== this.lastSaid && now - this.lastBody >= BODY_EVERY && this.bodies) {
      this.lastBody = now;
      void this.bodies.send({
        type: 'broadcast', event: 'body',
        payload: { uid: this.uid, name: this.me?.name ?? '', x, y, level, look: this.me?.look, act: this.me?.act ?? null },
      });
    }

    if (said === this.lastSaid) return;
    if (now - this.lastMove < MOVE_EVERY) return;
    this.lastMove = now;
    this.lastSaid = said;
    await supabase().rpc('rpc_move', { p_world: this.info.id, p_x: x, p_y: y, p_level: level });

    // Walked out of the square of country the channel is listening to: take a
    // new one, and read whatever was dug in the blocks that are new to us.
    const block = `${Math.floor(x / REGION)},${Math.floor(y / REGION)}`;
    if (block !== this.block) {
      this.me = { ...(this.me as PlayerRow), x, y };
      await this.watch(this.info.id);
      await this.catchUp();
    }
  }

  /** Ask to do something. What comes back is a refusal or a promise, never a result. */
  async act(action: string, target: Record<string, unknown>, times = 1): Promise<ActResult> {
    if (!this.info) return { started: false, why: 'You are not on an island.' };
    const { data, error } = await supabase().rpc('rpc_act', {
      p_world: this.info.id, p_action: action, p_target: target, p_times: times,
    });
    if (error) return { started: false, why: error.message };
    const result = data as ActResult;
    // We know when this ends before the island tells anybody, so ask to be
    // settled then rather than at the next heartbeat — and put the clock on
    // the screen now rather than a heartbeat from now.
    if (result.started && !result.done && result.seconds) {
      this.hooks.doing?.({ act: action, total: result.seconds, secs: result.seconds, left: times, goes: times, queued: 0 });
    }
    /*
     * A job that went into the queue rather than into your hands.
     *
     * The bar heard about the queue only from `rpc_settle`, which runs on the
     * heartbeat and when a job comes due — never when one is added. So the
     * count sat one behind and topping it up kept it there: "2 of 3" for ever
     * while the third was plainly in hand. The island says the list in its
     * answer now, and this is where the bar takes it.
     */
    if (result.queued && result.queue) {
      this.hooks.mine?.({ queue: lineUp(result.queue), cap: result.capacity ?? null });
    }
    if (result.ends) this.armBeat((new Date(result.ends).getTime() - Date.now()) / 1000 + 0.25);
    /*
     * And an ask the island has already finished with.
     *
     * An instant job — eating, stowing, tipping a bucket out — comes back
     * `done` with no `ends` on it, so nothing above re-times the beat and
     * nothing carries the body back. Eat a loaf and the hunger bar sat still
     * for up to a minute and then jumped, which is most of what "some things
     * seem delayed" was.
     *
     * Half a second rather than at once, because `armBeat` clears the timer it
     * replaces: a dozen instant asks in a row cost one settle after the last
     * of them instead of a dozen, which matters more now the polls take the
     * budget they do.
     */
    if (result.done) this.armBeat(0.5);
    // Our own work is the one thing that can put a wall up, so the next ground
    // read after it brings the half that holds walls.
    this.groundSlow = true;
    return result;
  }

  /**
   * Put down whatever is in hand, and everything lined up behind it.
   *
   * The other half of `act`, and missing until somebody noticed what that
   * meant: stopping was a thing the browser did to its own copy. The bar went
   * out, the queue emptied on the screen, and over here the tree kept falling
   * and the six jobs behind it ran through to the end.
   *
   * The island settles what is due before it drops anything, so this cannot be
   * used to take back work already done — see the migration. Pulsing straight
   * afterwards is what puts the screen back in step: otherwise the bar comes
   * back for as long as it takes the next heartbeat to come round, which looks
   * exactly like the bug this fixes.
   */
  async stop(): Promise<void> {
    if (!this.info) return;
    if (this.beat) clearTimeout(this.beat);
    this.beat = null;
    await supabase().rpc('rpc_cancel', { p_world: this.info.id });
    await this.pulse();
  }

  /**
   * Say something to everybody on the island.
   *
   * Nothing is drawn here. The line goes over, the island writes it into
   * `event` with no `uid` on it, and it comes back down the subscription this
   * browser is already listening to — the same way it reaches everybody else,
   * at the same moment, in the same words. Drawn here as well it would appear
   * twice; drawn here instead, the one person who could not tell whether it
   * had been heard would be the one who said it.
   *
   * The only thing that comes back is a refusal, because a line the island
   * declined to keep would otherwise vanish without a word.
   */
  async say(text: string): Promise<string | null> {
    if (!this.info) return null;
    const { data, error } = await supabase().rpc('rpc_say', { p_world: this.info.id, p_text: text });
    if (error) return error.message;
    const said = data as { said?: string | null; why?: string } | null;
    return said?.why ?? null;
  }

  /** What has been said lately, oldest first, for somebody just arriving. */
  async recentChat(limit = 60): Promise<Array<{ n: number; text: string }>> {
    if (!this.info) return [];
    const { data } = await supabase().rpc('rpc_chat', { p_world: this.info.id, p_limit: limit });
    return rowsIn<{ n: number; text: string }>(data);
  }

  /**
   * What time it is on the island: its own reading, carried forward.
   *
   * Pinned at the join and again at every heartbeat, and extrapolated between
   * them against `performance.now()` — which is monotonic, is not the wall
   * clock, and keeps running while the tab is asleep. So the hour is right
   * while somebody is playing, right the moment they come back from a locked
   * screen, and cannot drift further than one heartbeat's worth of the two
   * clocks running at different speeds.
   *
   * It was `Date.now()` against the island's epoch, which is the same answer
   * on a machine whose clock is right and a wrong one everywhere else — and
   * an island where one person sees midnight and another sees noon is not a
   * shared island. That is kept only for the moment before the first pin.
   */
  time(): number {
    if (this.clock) return this.clock.secs + (performance.now() / 1000 - this.clock.at);
    if (!this.info) return 0;
    return (Date.now() - new Date(this.info.epoch).getTime()) / 1000;
  }

  /**
   * How long ago the island wrote a timestamp, in seconds, by its clock.
   *
   * Rows off the table carry instants rather than seconds — `select *` has no
   * arithmetic in it — so anything that wants an age has to work one out. The
   * subtraction is between two of the island's own stamps, which is the same
   * number on every machine, and `time()` is the island's reading carried
   * forward on a monotonic clock. So none of it asks this browser what the
   * hour is, which is the whole point: a phone twenty seconds out gets the
   * same answer as one that is right.
   */
  since(stamp: string | null): number {
    if (!stamp || !this.info) return 0;
    const at = (Date.parse(stamp) - Date.parse(this.info.epoch)) / 1000;
    if (!Number.isFinite(at)) return 0;
    return Math.max(0, this.time() - at);
  }

  /** The island's last word on its own clock, and when this machine heard it. */
  private clock: { secs: number; at: number } | null = null;

  /** Take the island's reading, against a clock of ours that only goes forward. */
  private pinClock(secs: unknown): void {
    if (typeof secs !== 'number' || !Number.isFinite(secs) || secs < 0) return;
    this.clock = { secs, at: performance.now() / 1000 };
  }

  /**
   * The island's own answer to "is it dark", which nothing draws from.
   *
   * The browser works the darkness out from the hour exactly as it always
   * has — two authorities on one fact is how these two ends have come apart
   * every other time. This is here to be compared against what the browser
   * decided, so a day that drifts apart again is found by asking rather than
   * by somebody lighting a lantern at noon.
   */
  night(): boolean | null {
    return this.islandNight;
  }

  private islandNight: boolean | null = null;

  async leave(): Promise<void> {
    if (this.beat) clearTimeout(this.beat);
    this.beat = null;
    // Where we have been, before the world it was worked out on goes.
    if (this.world?.fogTouched) await this.saveFog();
    const sb = supabase();
    if (this.channel) await sb.removeChannel(this.channel);
    this.channel = null;
    this.bodies = null;
    await drop(this.bodiesTopic);
    this.bodiesTopic = '';
  }
}
