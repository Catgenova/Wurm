import type { RealtimeChannel } from '@supabase/supabase-js';
import { World } from '../world/world';
import type { TileType } from '../world/tiles';
import { blankWorld, rowsOf } from './landpack';
import { generateAtlasWindow, loadAtlas, type Atlas } from '../world/atlas-world';
import { supabase, signIn } from './supabase';

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
const FOUND_MAX = 512;
/**
 * How often we tell the island where we are.
 *
 * Not the frame rate, and deliberately far below it: this is a write to a
 * table, and the only thing that *needs* it is the reach check on the next
 * thing we try to do. Other people see us move through the channel below,
 * which costs nothing and is allowed to be wrong for a moment.
 */
const MOVE_EVERY = 1.0;

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

export interface ItemRow {
  id: number;
  def: string;
  ql: number;
  dmg: number;
  count: number;
  extra: string | null;
  holder: string;
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
  private lastSaid = '';
  /** The highest tile change we have taken in, so catching up never doubles back. */
  private seenChange = 0;

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
   * disagree. `rpc_land` is still there to be asked. It is simply not asked
   * for sixteen million tiles at the door.
   */
  async join(worldId: string, name: string): Promise<void> {
    this.uid = await signIn();
    const sb = supabase();
    const { data, error } = await sb.rpc('rpc_join', { p_world: worldId, p_name: name });
    if (error) throw new Error(`The island would not have us: ${error.message}`);
    const got = data as { world: WorldRow; you: PlayerRow; new: boolean };
    this.info = got.world;
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

    // Everything dug since the land was laid down, in the order it happened.
    // The same rows Realtime will carry from here on, so there is one way in
    // and not a second, thinner one for catching up.
    const { data: since } = await sb.from('tile_change').select('*').eq('world_id', worldId).order('n');
    for (const c of (since ?? []) as Array<{ n: number; x: number; y: number; tile: number; data: number; corners: number[] }>) {
      this.applyChange(c);
    }
    this.hooks.progress?.(3, 3, 'catching up');
    world.groundTouched = false;
    this.world = world;
    await this.watch(worldId);
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

  private applyChange(c: { n: number; x: number; y: number; tile: number; data: number; corners: number[] }): void {
    const w = this.world;
    if (!w || !w.inBounds(c.x, c.y)) return;
    if (c.n <= this.seenChange) return;
    this.seenChange = c.n;
    const k = c.corners;
    if (Array.isArray(k) && k.length === 4) {
      w.setHeight(c.x, c.y, k[0]);
      w.setHeight(c.x + 1, c.y, k[1]);
      w.setHeight(c.x + 1, c.y + 1, k[2]);
      w.setHeight(c.x, c.y + 1, k[3]);
    }
    w.setTile(c.x, c.y, c.tile as TileType, c.data);
    this.hooks.ground(c.x, c.y);
  }

  /**
   * Listen to the island.
   *
   * Four streams, and each is the table it is about rather than a message
   * invented for the purpose: ground that changed, lines meant for us, our own
   * pack, and everybody's body. Nothing here is a protocol — it is the
   * database saying what it just wrote, which means there is no wire format to
   * keep in step with anything.
   */
  private async watch(worldId: string): Promise<void> {
    const sb = supabase();
    this.channel?.unsubscribe();
    const on = `world_id=eq.${worldId}`;
    this.channel = sb
      .channel(`island:${worldId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tile_change', filter: on },
        (m) => this.applyChange(m.new as never))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'event', filter: on },
        (m) => {
          const e = m.new as { text: string; kind: string; uid: string | null };
          if (e.uid && e.uid !== this.uid) return;
          this.hooks.say(e.text, e.kind);
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player', filter: on },
        (m) => {
          const p = m.new as PlayerRow;
          if (m.eventType === 'DELETE') this.people.delete((m.old as PlayerRow).uid);
          else if (p?.uid) {
            this.people.set(p.uid, p);
            if (p.uid === this.uid) this.me = p;
          }
          this.hooks.people([...this.people.values()]);
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'item', filter: on },
        () => void this.refreshPack());

    // Realtime authorises against the signed-in user's token; make sure it has
    // the current one rather than whatever it started life with.
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      if (token) (sb.realtime as unknown as { setAuth: (t: string) => void }).setAuth(token);
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

  async refreshPeople(): Promise<void> {
    if (!this.info) return;
    const { data } = await supabase().from('player').select('*').eq('world_id', this.info.id);
    this.people.clear();
    for (const p of (data ?? []) as PlayerRow[]) {
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
    const { data } = await supabase().from('item').select('*')
      .eq('world_id', this.info.id).eq('holder', 'player').eq('holder_uid', this.uid);
    this.hooks.pack((data ?? []) as ItemRow[]);
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
    const said = `${x.toFixed(2)},${y.toFixed(2)},${level}`;
    if (said === this.lastSaid) return;
    if (now - this.lastMove < MOVE_EVERY) return;
    this.lastMove = now;
    this.lastSaid = said;
    await supabase().rpc('rpc_move', { p_world: this.info.id, p_x: x, p_y: y, p_level: level });
  }

  /** Ask to do something. What comes back is a refusal or a promise, never a result. */
  async act(action: string, target: Record<string, unknown>, times = 1): Promise<ActResult> {
    if (!this.info) return { started: false, why: 'You are not on an island.' };
    const { data, error } = await supabase().rpc('rpc_act', {
      p_world: this.info.id, p_action: action, p_target: target, p_times: times,
    });
    if (error) return { started: false, why: error.message };
    return data as ActResult;
  }

  /** What time it is on the island, worked out rather than asked for. */
  time(): number {
    if (!this.info) return 0;
    return (Date.now() - new Date(this.info.epoch).getTime()) / 1000;
  }

  async leave(): Promise<void> {
    await this.channel?.unsubscribe();
    this.channel = null;
  }
}
