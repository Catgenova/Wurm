import { Game } from '../game/game';
import { cleanLook } from '../game/look';
import { whoAmI } from './accounts';
import { supabase } from './supabase';
import { Island, type ItemRow, type PlayerRow } from './island';
import { generateAtlasWorld, loadAtlas } from '../world/atlas-world';
import { ACTION_BY_ID, type ActionDef, type Target } from '../game/actions';

/**
 * Starting on an island that lives in Postgres rather than in this tab.
 *
 * The front door opens on the island. With nothing in the address bar at all
 * this asks the keeper which island it keeps and comes ashore on it, which is
 * what a front door should do — a page that needs a uuid pasted into it is not
 * one. The rest of the address bar still decides the unusual cases:
 *
 *   (nothing)        come ashore on the island this keeper keeps
 *   ?island=<id>     come ashore on a particular one
 *   ?found=<name>    roll a small one here, hand it over, and be its first
 *   ?alone           play by yourself, in this browser, with no keeper at all
 *
 * The single-player game is still all there and still saved in this browser;
 * it is one link away rather than the default. It is also where this lands
 * when the keeper cannot be reached or keeps no island yet — a page that
 * cannot get to the island should still have a game, and should say which it
 * gave you and why.
 */

export interface Started {
  game: Game;
  island: Island;
  id: string;
}

/** How long the front door waits for an answer before giving you the other game. */
const ASK_HOME_MS = 8000;

/** A line on the loading screen, since founding an island is not instant. */
type Telling = (text: string) => void;

/**
 * Which island this keeper keeps, if it keeps one.
 *
 * One small read of one small table. It is not an id anybody can set from a
 * browser: whoever could would be pointing every visitor at an island of their
 * own, so `home` is written by a migration and by the opening of an island
 * bigger than a tab may found, and by nothing else.
 */
async function homeIsland(): Promise<string | null> {
  /*
   * With a clock on it, because this is the first thing the page does.
   *
   * A front door that hangs is worse than one that opens on the wrong room:
   * the single-player game is right there, and eight seconds is already longer
   * than anybody should spend looking at a notice. A keeper that has not
   * answered by then is a keeper that is not answering.
   */
  const asked = supabase().from('home').select('island').limit(1).maybeSingle();
  const timeout = new Promise<never>((_, no) =>
    setTimeout(() => no(new Error('The island keeper did not answer.')), ASK_HOME_MS));
  const { data, error } = await Promise.race([asked, timeout]);
  if (error) throw new Error(`Could not ask the keeper which island it keeps: ${error.message}`);
  return ((data ?? {}) as { island?: string | null }).island ?? null;
}

export async function startIsland(params: URLSearchParams, tell: Telling): Promise<Started | null> {
  if (params.has('alone')) return null;
  const founding = params.get('found');
  let joining = params.get('island');
  if (!joining && founding === null) {
    tell('Asking which island…');
    joining = await homeIsland();
    if (!joining) {
      tell('This keeper has no island on it yet — playing on your own instead.');
      return null;
    }
  }

  /**
   * What to call you.
   *
   * An account first, and the address bar only if there is no account. That
   * order is the whole point of having accounts: `?me=` is a string anybody
   * can type, while `whoAmI()` is the island keeper reading a name back out of
   * the address you signed in with, which nobody can type their way into.
   * With neither, you are a Wanderer, and the island still lets you in — an
   * account is a name you can prove, not a toll.
   */
  const account = await whoAmI().catch(() => null);
  const name = account ?? params.get('me') ?? 'Wanderer';
  const log: Array<[string, string]> = [];
  const island = new Island({
    say: (text, kind) => log.push([text, kind]),
    ground: () => {},
    people: () => {},
    pack: () => {},
    progress: (done, total, what) => tell(`${what}… ${Math.round((done / total) * 100)}%`),
  });

  let id = joining ?? '';
  if (!id) {
    tell('Rolling an island…');
    /*
     * Founding from a tab is for small islands, and `Island.found` says so
     * above 512. The big one — `ISLAND_SIZE`, four thousand and ninety-six —
     * is founded once by `tools/found-island.ts`, because it is three minutes
     * of ground and 138 MB of land and neither belongs in a page somebody is
     * waiting on. Coming *ashore* on it costs nothing extra, which is the
     * whole point of the change.
     */
    const size = Number(params.get('size')) || 256;
    const seed = (Math.random() * 0x7fffffff) >>> 0;
    /*
     * From the survey chart, not from the old radial mask.
     *
     * This has to be the generator the *join* uses, or an island is one shape
     * the day it is founded and another shape the day somebody comes back to
     * it: founding uploads what was rolled here, and joining works the ground
     * out from the seed. Two generators is two islands that have to agree
     * forever, and they would not.
     */
    const gen = generateAtlasWorld(seed, await loadAtlas(), size);
    id = await island.found(gen.world, founding || 'An island', gen.spawn);
    /**
     * Put the island's name in the address bar.
     *
     * Without this an island is founded and then immediately lost: the only
     * copy of the one thing anybody needs in order to visit it — its id — was
     * a string in a variable. Now the page you are looking at *is* the
     * invitation, and reloading comes back to the same island rather than
     * founding another one.
     */
    const here = new URLSearchParams(params);
    here.delete('found');
    here.delete('size');
    here.set('island', id);
    history.replaceState({}, '', `?${here.toString()}`);
  }

  tell('Coming ashore…');
  await island.join(id, name);
  const world = island.world;
  const info = island.info;
  const me = island.me;
  if (!world || !info || !me) throw new Error('The island did not arrive in one piece.');

  // A game built on the island's land, with its own body where the island says
  // it is. Everything it would normally decide, it now asks about.
  const game = new Game({
    seed: info.seed,
    world,
    spawn: { x: info.spawn_x, y: info.spawn_y },
    player: {
      x: me.x, y: me.y, name: me.name,
      // The island's copy, not this browser's: the face you chose is kept with
      // the account and handed back at the join, so a new machine comes ashore
      // looking like you rather than like a stranger.
      look: cleanLook(me.look),
      stats: (me.stats as Game['player']['stats']) ?? { health: 1, stamina: 1, hunger: 1, thirst: 1 },
    },
    time: island.time(),
  });

  /** What was last asked about, so the bar has something to point at. */
  let lastTarget: Target | null = null;

  game.ask = (def: ActionDef, target: Target, goes?: number) => {
    lastTarget = target;
    void island.act(def.id, target as unknown as Record<string, unknown>, goes ?? 1);
  };

  /*
   * The clock on what the island is doing.
   *
   * `ask` sends the whole of an action away, which is what makes the island
   * the authority — and left the screen with nothing to draw. `showAction`
   * puts the island's own reckoning on the bar without this machine owning any
   * of the work: the clock runs here between one answer and the next, and
   * whether the job happened is still the island's to say.
   */
  /*
   * The wildlife, which the browser had simply never asked for.
   *
   * `creatures.fromIsland` stops this machine thinking for any of them — their
   * hunger, wandering and hunting are all settled over there, the same seam as
   * actions — and leaves it drawing the legs the island hands over.
   */
  game.creatures.fromIsland = true;
  island.hooks.mobs = (rows) => {
    game.creatures.sawAll(rows);
    game.events.emit('creature');
  };

  /*
   * The rest of you, which the browser had no way of hearing about.
   *
   * Each of these was a separate-looking bug with one cause: the island owns
   * the player row and the browser read it once, at the join. The action bar
   * never said what was queued behind the job in hand; prospecting said "they
   * are marked for a while" and marked nothing; the health and stamina bars
   * were the ones you came ashore with; the skills window disagreed with the
   * log line that had just said a skill went up.
   */
  island.hooks.mine = (what) => {
    game.showQueue(what.queue, what.cap);
    if (what.stats) {
      const s = game.player.stats as unknown as Record<string, number>;
      for (const k of ['health', 'stamina', 'hunger', 'thirst']) {
        if (typeof what.stats[k] === 'number') s[k] = what.stats[k];
      }
      game.events.emit('stats');
    }
    if (what.skills) {
      for (const [id, value] of Object.entries(what.skills)) game.skills.values.set(id, value);
      game.events.emit('skill', '', 0);
    }
    game.showProspected(what.marks?.tiles ?? [], what.marks?.secs ?? 0);
  };

  island.hooks.doing = (what) => {
    if (!what.act) {
      game.showAction(null, null);
      return;
    }
    const def = ACTION_BY_ID.get(what.act);
    if (!def) return;
    game.showAction(def, lastTarget, what.total, what.secs, what.left, what.goes);
  };

  // Everything the island says, said here. The lines that arrived while the
  // land was still coming down go up first, in the order they were said.
  island.hooks.say = (text, kind) => game.write(text, kind as Parameters<Game['write']>[1]);
  island.hooks.ground = (x, y) => game.events.emit('world', x, y);
  island.hooks.pack = (items: ItemRow[]) => {
    game.inventory.items = items.map((it) => ({
      uid: it.id, id: it.def, ql: it.ql, dmg: it.dmg, count: it.count, extra: it.extra ?? undefined,
    }));
    game.events.emit('inventory');
  };
  /*
   * Everybody, in one word, rather than one at a time.
   *
   * `saw` adds and updates and never removes, so somebody who left stood there
   * for ever. `sawAll` replaces the list — which is what this now is: the
   * roster is reconciled from the table every twenty seconds, and Broadcast
   * carries the walking in between.
   */
  island.hooks.people = (people: PlayerRow[]) => {
    game.roster.sawAll(people
      .filter((p) => p.uid !== island.uid)
      .map((p) => ({
        id: hashId(p.uid), name: p.name, x: p.x, y: p.y, dirX: 0, dirY: 1,
        level: p.level, moving: false, swimming: false, working: !!p.act, look: cleanLook(p.look),
      })));
  };
  for (const [text, kind] of log) game.write(text, kind as Parameters<Game['write']>[1]);
  game.write(`You are on ${info.name}. Send somebody this page's address and they can join you.`, 'system');
  game.write(
    account
      ? `You are signed in as ${account}.`
      : `You are playing as ${name}, which anybody could type. Settings (O) has a link to set up a name you can prove.`,
    'system',
  );
  await island.refreshPack();
  await island.refreshPeople();
  return { game, island, id };
}

/**
 * A uuid squeezed into the small number the roster files people under. The
 * roster is a drawing thing — it wants something to tell two bodies apart, not
 * something to look anybody up by, and it is never sent anywhere.
 */
function hashId(uid: string): number {
  let h = 2166136261;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 1000000;
}
