import { Game, WORLD_SIZE } from '../game/game';
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

  const name = params.get('me') ?? 'Wanderer';
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
