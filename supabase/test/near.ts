/**
 * A craft reaches into the stores around you.
 *
 * Asked for: "When crafting, allow the ingredients to be used from any
 * container within 3 tiles."
 *
 * A saw, two oak logs in the pack and three in a satchel, and around the body
 * a spread of stores holding more of them:
 *
 *   * a crate two tiles off, five logs;
 *   * a chest three tiles off, four logs -- the far edge, and inside it;
 *   * a crate four tiles off, which is outside it;
 *   * a crate with a padlock on it and no key in the pack;
 *   * a trash crate, and a market stall, each with logs in;
 *   * and a stack in the near crate that is put by.
 *
 * Asked of both sides, the same spread:
 *
 *   * what is at hand is the pack, the satchel, the near crate and the chest,
 *     and nothing else -- fourteen logs;
 *   * the pack is spent first, then the satchel, then the stores nearest
 *     first, and the put-by stack never;
 *   * a run of goes started on the pack's two logs carries on into the
 *     satchel and the stores, rather than stopping when that stack is gone;
 *   * and the wood the crafting window says it will make a thing of is the
 *     wood that comes out, when the only oak is in the chest.
 *
 * The island half runs against the database the suite leaves behind.
 */
import { execFileSync } from 'node:child_process';
import { ACTION_BY_ID } from '../../src/game/actions';
import { Game } from '../../src/game/game';
import type { Item } from '../../src/game/items';
import { CRAFT_REACH, chooseMaterial, recipeStatus, RECIPE_BY_ID } from '../../src/game/recipes';

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

check('the reach is the three tiles asked for', CRAFT_REACH === 3, `${CRAFT_REACH}`);
check('and both sides read the same number',
  Number(psql('select craft_reach();')) === CRAFT_REACH, psql('select craft_reach();'));

/* ---- the browser --------------------------------------------------------- */

const game = Game.create(4242);
/*
 * Dry land with dry land round it: a body stood in the sea spends a craft
 * swimming, and stops, which is right and is not what is being measured.
 */
let spot: [number, number] | null = null;
for (let r = 0; r < 80 && !spot; r++) {
  for (let dx = -r; dx <= r && !spot; dx++) {
    for (const dy of [-r, r]) {
      const [x, y] = [64 + dx, 64 + dy];
      let dry = game.world.slope(x, y) < 20;
      for (let j = -1; j <= 1 && dry; j++) {
        for (let i = -1; i <= 1 && dry; i++) dry = game.world.isPassable(x + i, y + j) && !game.world.hasWater(x + i, y + j);
      }
      if (dry) {
        spot = [x, y];
        break;
      }
    }
  }
}
const [px, py] = spot ?? [64, 64];
game.player.x = px + 0.5;
game.player.y = py + 0.5;
for (const c of [...game.crates.values()]) game.removeCrate(c.id);
for (const f of [...game.furniture.values()]) game.removeFurniture(f.id);

const pack = game.inventory;
for (const it of [...pack.items]) if (['log', 'plank', 'saw'].includes(it.id) || it.inside) pack.remove(it.uid, it.count);
pack.add('saw', { ql: 60 });
const packLogs = pack.add('log', { count: 2, extra: 'Oak', ql: 30 });
const logs = (count: number, ql: number, extra = 'Oak'): Item => ({ uid: pack.nextUid++, id: 'log', ql, dmg: 0, count, extra });
const satchel = pack.add('satchel', { ql: 30 });
satchel.inside = [logs(3, 31)];

const near = game.addCrate('plank', px + 2, py, 0, 0, [logs(5, 32)]);
const putBy = logs(6, 90);
putBy.locked = true;
near.items.push(putBy);
const chest = game.addFurniture('chest', px - 3, py + 3, 0, 0, 40, [logs(4, 33)]);
const far = game.addCrate('plank', px + 4, py, 0, 0, [logs(10, 34)]);
const shut = game.addCrate('plank', px, py - 2, 0, 0, [logs(10, 35)]);
shut.lock = 987654;
const trash = game.addFurniture('trash_crate', px - 1, py - 1, 0, 0, 40, [logs(10, 36)]);
const stall = game.addFurniture('stall', px + 1, py + 1, 0, 0, 40, [logs(10, 37)]);

const planks = RECIPE_BY_ID.get('make_planks')!;
const at = recipeStatus(planks, game);
console.log('--- the spread, in the browser');
check('at hand: two in the pack, three in the satchel, five in the near crate, four in the chest',
  at.inputs[0].have === 14, `${at.inputs[0].have}`);
check('of which five are carried', at.inputs[0].carried === 5, `${at.inputs[0].carried}`);
check('so fourteen goes', at.max === 14, `${at.max}`);

const count = (items: Item[]): number => items.filter((it) => it.id === 'log').reduce((n, it) => n + it.count, 0);
const saw = ACTION_BY_ID.get('make_planks')!;
const run = (goes: number, uid: number): void => {
  game.player.stats.stamina = 1;
  game.requestAction(saw, { kind: 'item', uid }, goes);
  for (let t = 0; t < 4000 && game.action; t++) {
    game.player.stats.stamina = 1;
    game.update(0.25);
  }
};
const left = (): string => [
  count(pack.items), count(satchel.inside ?? []), count(near.items.filter((it) => !it.locked)),
  count(chest.items), count(far.items), count(shut.items), count(trash.items), count(stall.items),
].join(',');

// Four goes: the pack's two, then two of the satchel's three.
run(4, packLogs.uid);
check('the pack goes first, then the satchel', left() === '0,1,5,4,10,10,10,10', left());
// Four more, off the satchel's last one: the near crate before the chest.
run(4, satchel.inside?.[0]?.uid ?? -1);
check('then the nearest store', left() === '0,0,2,4,10,10,10,10', left());
// And the rest, started on the near crate: into the chest when it runs out.
run(6, near.items.find((it) => !it.locked)?.uid ?? -1);
check('then the next store out, until there is nothing left in reach', left() === '0,0,0,0,10,10,10,10', left());
check('and the stack put by is never spent', near.items.includes(putBy) && putBy.count === 6, `${putBy.count}`);
check('fourteen logs made forty-two planks', count(pack.items.filter((it) => it.id === 'log')) === 0
  && pack.items.filter((it) => it.id === 'plank').reduce((n, it) => n + it.count, 0) === 42,
  `${pack.items.filter((it) => it.id === 'plank').reduce((n, it) => n + it.count, 0)} planks`);
check('and nothing more can be made', !recipeStatus(planks, game).ready, `${recipeStatus(planks, game).max}`);

console.log('--- a run that carries on');
// Two logs in the pack and six in the near crate, and eight goes asked for
// off the pack's stack: the run does not stop when that stack is gone.
const again = pack.add('log', { count: 2, extra: 'Oak', ql: 30 });
near.items.push(logs(6, 32));
run(8, again.uid);
check('eight goes asked for off two logs in the pack are eight goes',
  left() === '0,0,0,0,10,10,10,10', left());

console.log('--- the wood the window says');
// Pine in the pack, oak in the chest: the window left alone says oak, and the
// oak in the chest clicked makes an oak plank out of the chest's oak.
pack.add('log', { count: 2, extra: 'Pine', ql: 30 });
chest.items.push(logs(3, 33, 'Oak'));
const both = recipeStatus(planks, game);
check('left alone, the most there is of', both.material === 'Oak', `${both.material}`);
check('and the chest counts toward it', both.inputs[0].have === 3 && both.inputs[0].carried === 0,
  `${both.inputs[0].have} at hand, ${both.inputs[0].carried} carried`);
const oak = chest.items.find((it) => it.extra === 'Oak')!;
check('the oak in the chest clicked is oak', chooseMaterial(game, planks, oak.uid) === 'Oak');
const oakPlanks = (): number => pack.items.filter((it) => it.id === 'plank' && it.extra === 'Oak').reduce((n, it) => n + it.count, 0);
const pine = (): number => pack.items.filter((it) => it.id === 'log' && it.extra === 'Pine').reduce((n, it) => n + it.count, 0);
const before = oakPlanks();
run(1, oak.uid);
check('and three oak planks come off the chest\'s oak, the pack\'s pine untouched',
  oakPlanks() - before === 3 && count(chest.items) === 2 && pine() === 2,
  `${oakPlanks() - before} oak planks, ${count(chest.items)} oak left in the chest, ${pine()} pine in the pack`);

console.log('--- out of reach, not yours, and locked');
const oakAtHand = (): number => game.craftStock()
  .filter((s) => s.item.id === 'log' && s.item.extra === 'Oak').reduce((n, s) => n + s.item.count, 0);
check('the two oak left in the chest are at hand', oakAtHand() === 2, `${oakAtHand()}`);
// A step north: the chest is four tiles off now, and nothing else comes into reach.
game.player.y = py - 0.5;
check('a step away, the chest is out of reach', oakAtHand() === 0, `${oakAtHand()}`);
game.player.y = py + 0.5;
// On an island, a crate the island says is not yours is not reached into.
near.items.push(logs(4, 32));
near.mine = false;
check('a crate that is not yours is not reached into', oakAtHand() === 2, `${oakAtHand()}`);
near.mine = undefined;
check('and one that is, is', oakAtHand() === 6, `${oakAtHand()}`);
// And a padlock opens for its key.
const key: Item = { uid: pack.nextUid++, id: 'key', ql: 40, dmg: 0, count: 1, keyed: shut.lock };
pack.addItem(key);
check('a padlocked crate opens for its key', oakAtHand() === 16, `${oakAtHand()}`);
pack.remove(key.uid, 1);

/* ---- the island ---------------------------------------------------------- */

/*
 * The same spread, laid round Dane on Hoarding and put to `perform_craft` a go
 * at a time, inside a transaction that is rolled back. Off every settlement,
 * so nothing is his by the ground it stands on: the crates he set down are
 * his, and one somebody else set down is not.
 */
const isle = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; me uuid; them uuid := gen_random_uuid(); v_x int; v_y int; sat bigint;
        c_near int; c_far int; c_shut int; c_theirs int; p_chest bigint; p_trash bigint; p_stall bigint;
        first bigint; g int;
begin
  select id into w from world where name = 'Hoarding';
  select uid into me from player where world_id = w and name = 'Dane';
  -- Somewhere no settlement covers, with room round it.
  select gx, gy into v_x, v_y
    from generate_series(20, 200, 7) gx, generate_series(20, 200, 7) gy
   where not exists (select 1 from deed d where d.world_id = w
                      and abs(d.x - gx) <= d.radius + 6 and abs(d.y - gy) <= d.radius + 6)
   order by gx, gy limit 1;
  update player set x = v_x + 0.5, y = v_y + 0.5, act = null, act_queue = '[]'::jsonb
   where world_id = w and uid = me;
  delete from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = me
    and (i.def in ('log', 'plank', 'saw', 'key') or is_bag(i.def));
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', me, 'saw', 60, 1);
  insert into item (world_id, holder, holder_uid, def, ql, count, extra)
    values (w, 'player', me, 'log', 30, 2, 'Oak') returning id into first;
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', me, 'satchel', 30, 1)
    returning id into sat;
  insert into item (world_id, holder, holder_uid, inside, def, ql, count, extra)
    values (w, 'bag', me, sat, 'log', 31, 3, 'Oak');
  select coalesce(max(id), 0) + 1 into c_near from crate where world_id = w;
  c_far := c_near + 1; c_shut := c_near + 2; c_theirs := c_near + 3;
  insert into crate (world_id, id, kind, x, y, sx, sy, made_by, lock) values
    (w, c_near, 'plank', v_x + 2, v_y, 0, 0, me, null),
    (w, c_far, 'plank', v_x + 4, v_y, 0, 0, me, null),
    (w, c_shut, 'plank', v_x, v_y - 2, 0, 0, me, 987654),
    -- Set down by somebody else, off any settlement: not Dane's.
    (w, c_theirs, 'plank', v_x, v_y + 2, 0, 0, them, null);
  insert into item (world_id, holder, crate, gx, gy, def, ql, count, extra, locked) values
    (w, 'crate', c_near, v_x + 2, v_y, 'log', 32, 5, 'Oak', false),
    (w, 'crate', c_near, v_x + 2, v_y, 'log', 90, 6, 'Oak', true),
    (w, 'crate', c_far, v_x + 4, v_y, 'log', 34, 10, 'Oak', false),
    (w, 'crate', c_shut, v_x, v_y - 2, 'log', 35, 10, 'Oak', false),
    (w, 'crate', c_theirs, v_x, v_y + 2, 'log', 35, 10, 'Oak', false);
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, made_by)
    values (w, 'furniture', 'chest', v_x - 3, v_y + 3, 0, 0, v_x - 2.75, v_y + 3.25, me) returning id into p_chest;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, made_by)
    values (w, 'furniture', 'trash_crate', v_x - 1, v_y - 1, 0, 0, v_x - 0.875, v_y - 0.875, me) returning id into p_trash;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, made_by)
    values (w, 'furniture', 'stall', v_x + 1, v_y + 1, 0, 0, v_x + 1.375, v_y + 1.25, me) returning id into p_stall;
  insert into item (world_id, holder, placed, def, ql, count, extra) values
    (w, 'furniture', p_chest, 'log', 33, 4, 'Oak'),
    (w, 'furniture', p_trash, 'log', 36, 10, 'Oak'),
    (w, 'furniture', p_stall, 'log', 37, 10, 'Oak');

  insert into said values ('AT|' || craft_count(w, me, 'log'));
  insert into said values ('WHY|' || coalesce(craft_refusal(w, me, 'make_planks', first), 'none'));

  -- Fourteen goes, the way the settle loop does them: each go reads the job
  -- in hand, which the go that used up its stack has re-aimed.
  update player set act = 'make_planks', act_target = jsonb_build_object('kind', 'item', 'uid', first)
   where world_id = w and uid = me;
  for g in 1..14 loop
    perform perform_craft(w, me, 'make_planks', (select act_target from player where world_id = w and uid = me));
    if g in (4, 8) then
      insert into said values ('AFTER' || g || '|' || concat_ws(',',
        (select coalesce(sum(count), 0) from item where world_id = w and holder = 'player' and holder_uid = me and def = 'log'),
        (select coalesce(sum(count), 0) from item where world_id = w and holder = 'bag' and inside = sat),
        (select coalesce(sum(count), 0) from item where world_id = w and holder = 'crate' and crate = c_near and not locked),
        (select coalesce(sum(count), 0) from item where world_id = w and holder = 'furniture' and placed = p_chest)));
    end if;
  end loop;
  insert into said values ('LEFT|' || concat_ws(',',
    (select coalesce(sum(count), 0) from item where world_id = w and holder = 'player' and holder_uid = me and def = 'log'),
    (select coalesce(sum(count), 0) from item where world_id = w and holder = 'bag' and inside = sat),
    (select coalesce(sum(count), 0) from item where world_id = w and holder = 'crate' and crate = c_near and not locked),
    (select coalesce(sum(count), 0) from item where world_id = w and holder = 'furniture' and placed = p_chest),
    (select coalesce(sum(count), 0) from item where world_id = w and holder = 'crate' and crate = c_far),
    (select coalesce(sum(count), 0) from item where world_id = w and holder = 'crate' and crate = c_shut),
    (select coalesce(sum(count), 0) from item where world_id = w and holder = 'furniture' and placed = p_trash),
    (select coalesce(sum(count), 0) from item where world_id = w and holder = 'furniture' and placed = p_stall),
    (select coalesce(sum(count), 0) from item where world_id = w and holder = 'crate' and crate = c_theirs)));
  insert into said values ('PUTBY|' || (select coalesce(sum(count), 0) from item
    where world_id = w and holder = 'crate' and crate = c_near and locked));
  insert into said values ('PLANKS|' || (select coalesce(sum(count), 0) from item
    where world_id = w and holder = 'player' and holder_uid = me and def = 'plank'));
  insert into said values ('NOW|' || coalesce(craft_refusal(w, me, 'make_planks', null), 'none'));

  -- A padlock opens for its key.
  insert into item (world_id, holder, holder_uid, def, ql, count, keyed) values (w, 'player', me, 'key', 40, 1, 987654);
  insert into said values ('KEY|' || craft_count(w, me, 'log'));
  delete from item where world_id = w and holder = 'player' and holder_uid = me and def in ('key', 'plank');

  -- Pine in the pack and oak in the chest: aimed at the oak, it is oak.
  insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (w, 'player', me, 'log', 30, 2, 'Pine');
  insert into item (world_id, holder, placed, def, ql, count, extra) values (w, 'furniture', p_chest, 'log', 33, 3, 'Oak')
    returning id into first;
  insert into said values ('MAT|' || coalesce(craft_material(w, me, 'make_planks', first), 'none'));
  perform perform_craft(w, me, 'make_planks', jsonb_build_object('kind', 'item', 'uid', first));
  insert into said values ('OAK|' || concat_ws(',',
    (select coalesce(sum(count), 0) from item where world_id = w and holder = 'player' and holder_uid = me and def = 'plank' and extra = 'Oak'),
    (select coalesce(sum(count), 0) from item where world_id = w and holder = 'furniture' and placed = p_chest),
    (select coalesce(sum(count), 0) from item where world_id = w and holder = 'player' and holder_uid = me and def = 'log' and extra = 'Pine')));

  -- And through the door a browser uses. Aimed at a log in the chest, the ask
  -- is taken; asked for three goes off the one log in the pack with two more
  -- in the chest, and settled, it makes three.
  delete from item where world_id = w and holder = 'player' and holder_uid = me and def in ('log', 'plank');
  delete from item where world_id = w and holder = 'furniture' and placed = p_chest;
  insert into item (world_id, holder, placed, def, ql, count, extra) values (w, 'furniture', p_chest, 'log', 33, 2, 'Oak')
    returning id into first;
  insert into said values ('AIMED|' || coalesce(act_refusal(w, me, 'make_planks',
    jsonb_build_object('kind', 'item', 'uid', first)), 'none'));
  insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (w, 'player', me, 'log', 30, 1, 'Oak')
    returning id into first;
  update player set act = null, act_target = null, act_queue = '[]'::jsonb where world_id = w and uid = me;
  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  insert into said values ('ASK|' || (rpc_act(w, 'make_planks', jsonb_build_object('kind', 'item', 'uid', first), 3)->>'started'));
  update player set act_ends = now() - interval '1 hour' where world_id = w and uid = me;
  perform settle(w, me);
  insert into said values ('DOOR|' || concat_ws(',',
    (select coalesce(sum(count), 0) from item where world_id = w and holder = 'player' and holder_uid = me and def = 'log'),
    (select coalesce(sum(count), 0) from item where world_id = w and holder = 'furniture' and placed = p_chest),
    (select coalesce(sum(count), 0) from item where world_id = w and holder = 'player' and holder_uid = me and def = 'plank'),
    coalesce((select act from player where world_id = w and uid = me), 'idle')));
end $$;
select * from said;
rollback;
`);
const said = (key: string): string =>
  isle.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? 'MISSING';

console.log('--- the spread, on the island');
check('the island counts the same fourteen logs at hand', said('AT') === '14', said('AT'));
check('and will saw them', said('WHY') === 'none', said('WHY'));
check('the pack goes first, then the satchel', said('AFTER4') === '0,1,5,4', said('AFTER4'));
check('then the nearest store', said('AFTER8') === '0,0,2,4', said('AFTER8'));
check('then the next store out, and nothing out of reach, locked, thrown away, for sale or not yours',
  said('LEFT') === '0,0,0,0,10,10,10,10,10', said('LEFT'));
check('the stack put by is never spent', said('PUTBY') === '6', said('PUTBY'));
check('fourteen logs made forty-two planks', said('PLANKS') === '42', said('PLANKS'));
check('and it says so when there is nothing left in reach', /^Planks? takes 1 log\.$/.test(said('NOW')), said('NOW'));
check('a padlocked crate opens for its key', said('KEY') === '10', said('KEY'));
check('aimed at the oak in the chest, the island makes it of oak', said('MAT') === 'Oak', said('MAT'));
check('and uses the chest\'s oak, not the pack\'s pine', said('OAK') === '3,2,2', said('OAK'));
check('aimed at a log in the chest, the island takes the ask', said('AIMED') === 'none', said('AIMED'));
check('asked for three goes through rpc_act', said('ASK') === 'true', said('ASK'));
check('and settled, the pack\'s log and the chest\'s two make nine planks, and the job is done',
  said('DOOR') === '0,0,9,idle', said('DOOR'));

for (const line of [...ok, ...bad]) console.log(line);
console.log(bad.length ? `\n${bad.length} of ${ok.length + bad.length} wrong` : `\nall ${ok.length} right`);
process.exit(bad.length ? 1 : 0);
