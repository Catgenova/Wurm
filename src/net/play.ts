import { Game, WORLD_SIZE } from '../game/game';
import { whoAmI } from './accounts';
import { Island, type ItemRow, type PlayerRow } from './island';
import { generateWorld } from '../world/generate';
import type { ActionDef, Target } from '../game/actions';

/**
 * Starting on an island that lives in Postgres rather than in this tab.
 *
 * The join is decided by the address bar, and nothing else in the program has
 * to know which of the two it got:
 *
 *   ?island=<id>     come ashore on one that exists
 *   ?found=<name>    roll a new one here, hand it over, and be its first
 *
 * With neither, the game is the single-player one it has always been, kept in
 * this browser. That path is untouched — an island is an addition, not a
 * replacement, and a page that cannot reach the keeper still has a game.
 */

export interface Started {
  game: Game;
  island: Island;
  id: string;
}

/** A line on the loading screen, since founding an island is not instant. */
type Telling = (text: string) => void;

export async function startIsland(params: URLSearchParams, tell: Telling): Promise<Started | null> {
  const joining = params.get('island');
  const founding = params.get('found');
  if (!joining && founding === null) return null;

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
    const size = Number(params.get('size')) || WORLD_SIZE;
    const seed = (Math.random() * 0x7fffffff) >>> 0;
    const gen = generateWorld(seed, size);
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
    player: { x: me.x, y: me.y, name: me.name, stats: (me.stats as Game['player']['stats']) ?? { health: 1, stamina: 1, hunger: 1, thirst: 1 } },
    time: island.time(),
  });

  game.ask = (def: ActionDef, target: Target, goes?: number) => {
    void island.act(def.id, target as unknown as Record<string, unknown>, goes ?? 1);
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
  island.hooks.people = (people: PlayerRow[]) => {
    for (const p of people) {
      if (p.uid === island.uid) continue;
      game.roster.saw({ id: hashId(p.uid), name: p.name, x: p.x, y: p.y, dirX: 0, dirY: 1, level: p.level, moving: false, swimming: false, working: !!p.act });
    }
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
