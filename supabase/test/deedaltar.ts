/**
 * An altar goes up on your own ground.
 *
 * Asked for: "Make the altar only craftable within deed perimeter." A recipe
 * may say it is worked only by somebody standing on a settlement of theirs,
 * and the altar says so. What this asks:
 *
 *   * the same recipes carry the flag on both sides -- the browser's
 *     `Recipe.deed` and the island's `recipe.deed` -- and the altar is one;
 *   * both sides refuse it off the ground in the same words, `DEED_ONLY`;
 *   * it is the tile under the crafter that is asked: inside a settlement they
 *     founded, to its last tile, it goes up; a tile past the border does not;
 *   * a settlement they are a citizen of counts, a stranger's does not;
 *   * a recipe without the flag is not asked about the ground at all;
 *   * and an altar is set down only on a settlement of theirs, asked of the
 *     tile it goes on, in the same words on both sides (`DEED_PLACE`), while
 *     a chest goes down anywhere and an altar already standing may be turned.
 *
 * Runs against the database the suite leaves behind, and puts it back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { DEED_PLACE } from '../../src/game/furniture';
import { DEED_ONLY, RECIPES, recipeReason, recipeStatus } from '../../src/game/recipes';
import { TileType } from '../../src/world/tiles';

const psql = (sql: string): string =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
    env: {
      ...process.env,
      PGHOST: process.env.PGHOST ?? '/var/run/postgresql',
      PGPORT: process.env.PGPORT ?? '5433',
      PGUSER: process.env.PGUSER ?? 'wurm',
      PGDATABASE: process.env.PGDATABASE ?? 'postgres',
    },
  }).trim();

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

const ALTAR = RECIPES.find((r) => r.id === 'make_altar');
const flagged = RECIPES.filter((r) => r.deed).map((r) => r.id).sort();
check('the browser says an altar is built on a settlement of yours', !!ALTAR?.deed);

/* ---- the island ---------------------------------------------------------- */
const out = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; u uuid; other uuid; t int; alt bigint; box bigint;
begin
  -- A world with two people in it: the one building, and a neighbour.
  select p.world_id into w from player p group by p.world_id having count(*) >= 2 order by p.world_id limit 1;
  select p.uid into u from player p where p.world_id = w order by p.uid limit 1;
  select p.uid into other from player p where p.world_id = w and p.uid <> u order by p.uid limit 1;
  delete from deed where world_id = w;
  -- Plain dry ground under everything asked about.
  for t in 30..70 loop
    perform land_set_height(w, t, 40, 4); perform land_set_tile(w, t, 40, tile_id('Grass'));
    perform land_set_height(w, 43, t, 4); perform land_set_tile(w, 43, t, tile_id('Grass'));
  end loop;
  -- A trowel and everything an altar takes, on them.
  delete from item where world_id = w and holder = 'player' and holder_uid = u;
  perform give(w, u, 'trowel', 1, 50);
  perform give(w, u, 'stone_brick', 64, 30);
  perform give(w, u, 'mortar', 32, 30);
  perform give(w, u, 'stone_slab', 4, 30);
  perform give(w, u, 'gold_lump', 1, 30);
  perform give(w, u, 'mallet', 1, 50);
  alt := give(w, u, 'altar', 1, 50);
  box := give(w, u, 'chest', 1, 50);

  insert into said select 'FLAGGED|' || coalesce(string_agg(id, ',' order by id), '') from recipe where deed;

  -- Out in the country.
  update player set x = 40.5, y = 40.5 where world_id = w and uid = u;
  insert into said select 'WILD|' || coalesce(craft_refusal(w, u, 'make_altar', null), 'null');
  insert into said select 'WILDACT|' || coalesce(act_refusal(w, u, 'make_altar', '{}'::jsonb), 'null');
  -- Something without the flag is refused for what it lacks, never for the ground.
  insert into said select 'STOOL|' || coalesce(craft_refusal(w, u, 'make_stool', null), 'null');
  -- Nor set down anywhere but a settlement of theirs; a chest goes down where it likes.
  insert into said select 'PUTWILD|' || coalesce(act_refusal(w, u, 'place_furniture',
    jsonb_build_object('itemUid', alt, 'x', 41, 'y', 40, 'sx', 0, 'sy', 0)), 'null');
  insert into said select 'CHESTWILD|' || coalesce(act_refusal(w, u, 'place_furniture',
    jsonb_build_object('itemUid', box, 'x', 41, 'y', 40, 'sx', 0, 'sy', 0)), 'null');

  -- On a settlement they founded, from its token to its last tile.
  insert into deed (world_id, name, x, y, radius, level, founded_by) values (w, 'Home', 40, 40, 3, 1, u);
  insert into said select 'OWN|' || coalesce(craft_refusal(w, u, 'make_altar', null), 'null');
  insert into said select 'OWNACT|' || coalesce(act_refusal(w, u, 'make_altar', '{}'::jsonb), 'null');
  insert into said select 'PUTOWN|' || coalesce(act_refusal(w, u, 'place_furniture',
    jsonb_build_object('itemUid', alt, 'x', 41, 'y', 40, 'sx', 0, 'sy', 0)), 'null');
  insert into said select 'PUTPAST|' || coalesce(act_refusal(w, u, 'place_furniture',
    jsonb_build_object('itemUid', alt, 'x', 44, 'y', 40, 'sx', 0, 'sy', 0)), 'null');
  update player set x = 43.9, y = 40.5 where world_id = w and uid = u;
  insert into said select 'EDGE|' || coalesce(craft_refusal(w, u, 'make_altar', null), 'null');
  update player set x = 44.1, y = 40.5 where world_id = w and uid = u;
  insert into said select 'PAST|' || coalesce(craft_refusal(w, u, 'make_altar', null), 'null');

  -- A neighbour's settlement is not theirs to raise one on...
  insert into deed (world_id, name, x, y, radius, level, founded_by) values (w, 'Next door', 60, 40, 3, 1, other);
  update player set x = 60.5, y = 40.5 where world_id = w and uid = u;
  insert into said select 'STRANGER|' || coalesce(craft_refusal(w, u, 'make_altar', null), 'null');
  insert into said select 'PUTSTRANGER|' || coalesce(act_refusal(w, u, 'place_furniture',
    jsonb_build_object('itemUid', alt, 'x', 61, 'y', 40, 'sx', 0, 'sy', 0)), 'null');
  -- ...until they are made a citizen of it.
  insert into deed_member (world_id, founder, uid, role) values (w, other, u, 'builder');
  insert into said select 'CITIZEN|' || coalesce(craft_refusal(w, u, 'make_altar', null), 'null');
  insert into said select 'PUTCITIZEN|' || coalesce(act_refusal(w, u, 'place_furniture',
    jsonb_build_object('itemUid', alt, 'x', 61, 'y', 40, 'sx', 0, 'sy', 0)), 'null');
end $$;
select k from said;
rollback;
`);

const said = new Map(out.split('\n').filter(Boolean).map((l) => {
  const at = l.indexOf('|');
  return [l.slice(0, at), l.slice(at + 1)] as [string, string];
}));
const say = (k: string): string => said.get(k) ?? '(nothing)';

check('the island flags the same recipes as the browser', say('FLAGGED') === flagged.join(','), `island ${say('FLAGGED')}, browser ${flagged.join(',')}`);
check('out in the country the island refuses an altar, in the browser\'s words', say('WILD') === DEED_ONLY, say('WILD'));
check('and the action says the same', say('WILDACT') === DEED_ONLY, say('WILDACT'));
check('a stool is not asked about the ground', say('STOOL') !== DEED_ONLY, say('STOOL'));
check('on a settlement they founded it goes up', say('OWN') === 'null', say('OWN'));
check('by the action too', say('OWNACT') === 'null', say('OWNACT'));
check('on the last tile inside the border', say('EDGE') === 'null', say('EDGE'));
check('and not a tile past it', say('PAST') === DEED_ONLY, say('PAST'));
check('not on a neighbour\'s settlement', say('STRANGER') === DEED_ONLY, say('STRANGER'));
check('but on one they are a citizen of', say('CITIZEN') === 'null', say('CITIZEN'));
check('out in the country the island will not have an altar set down, in the browser\'s words', say('PUTWILD') === DEED_PLACE, say('PUTWILD'));
check('a chest goes down there all the same', say('CHESTWILD') === 'null', say('CHESTWILD'));
check('on a settlement they founded an altar goes down', say('PUTOWN') === 'null', say('PUTOWN'));
check('and not a tile past its border', say('PUTPAST') === DEED_PLACE, say('PUTPAST'));
check('nor on a neighbour\'s settlement', say('PUTSTRANGER') === DEED_PLACE, say('PUTSTRANGER'));
check('until they are a citizen of it', say('PUTCITIZEN') === 'null', say('PUTCITIZEN'));

/* ---- the browser --------------------------------------------------------- */
if (ALTAR) {
  const game = Game.create(4242);
  // Plain dry level ground wherever an altar is asked to stand.
  for (let y = 36; y <= 44; y++) for (let x = 34; x <= 50; x++) {
    game.world.setHeight(x, y, 4);
    game.world.setDirt(x, y, 5);
    game.world.setTile(x, y, TileType.Grass, 0);
  }
  for (const [id, count] of [['trowel', 1], ['stone_brick', 64], ['mortar', 32], ['stone_slab', 4], ['gold_lump', 1]] as Array<[string, number]>) {
    game.inventory.add(id, { ql: 30, count });
  }
  game.deed = null;
  game.neighbourDeeds = [];
  game.player.x = 40.5; game.player.y = 40.5;
  check('out in the country the browser refuses an altar', recipeReason(ALTAR, game) === DEED_ONLY, String(recipeReason(ALTAR, game)));
  check('and the crafting window shows it can make none', recipeStatus(ALTAR, game).max === 0 && !recipeStatus(ALTAR, game).deed);
  game.deed = { name: 'Home', x: 40, y: 40, radius: 3, level: 1, mine: true } as never;
  check('on a settlement of theirs it may', recipeReason(ALTAR, game) === null, String(recipeReason(ALTAR, game)));
  check('and the window counts one', recipeStatus(ALTAR, game).max === 1 && recipeStatus(ALTAR, game).deed);
  game.player.x = 44.1;
  check('a step past the border it may not', recipeReason(ALTAR, game) === DEED_ONLY, String(recipeReason(ALTAR, game)));
  game.deed = null;
  game.neighbourDeeds = [{ name: 'Next door', x: 44, y: 40, radius: 3, level: 1, holder: 'Somebody' }];
  check('a neighbour\'s settlement is not theirs', recipeReason(ALTAR, game) === DEED_ONLY, String(recipeReason(ALTAR, game)));
  game.neighbourDeeds = [{ name: 'Next door', x: 44, y: 40, radius: 3, level: 1, holder: 'Somebody', mine: true, role: 'builder' as never }];
  check('until they are a citizen of it', recipeReason(ALTAR, game) === null, String(recipeReason(ALTAR, game)));

  // Setting one down: asked of the tile it goes on, not of where you stand.
  game.neighbourDeeds = [];
  game.deed = { name: 'Home', x: 40, y: 40, radius: 3, level: 1, mine: true } as never;
  game.player.x = 40.5; game.player.y = 40.5;
  check('the browser sets an altar down on a settlement of theirs', game.furniturePlaceReason('altar', 41, 40, 0, 0) === null, String(game.furniturePlaceReason('altar', 41, 40, 0, 0)));
  check('and not a tile past its border', game.furniturePlaceReason('altar', 44, 40, 0, 0) === DEED_PLACE, String(game.furniturePlaceReason('altar', 44, 40, 0, 0)));
  check('where a chest goes down all the same', game.furniturePlaceReason('chest', 44, 40, 0, 0) === null, String(game.furniturePlaceReason('chest', 44, 40, 0, 0)));
  check('and an altar already standing there may still be turned', game.furniturePlaceReason('altar', 44, 40, 0, 0, 'e', 12345) === null, String(game.furniturePlaceReason('altar', 44, 40, 0, 0, 'e', 12345)));
}

for (const line of [...ok, ...bad]) console.log(line);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
if (bad.length) process.exit(1);
