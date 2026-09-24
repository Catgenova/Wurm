/**
 * What a craft may take, as the player says.
 *
 * Asked: "add a toggle in settings for allowing or disallowing crafting from
 * nearby containers. add another setting that disallows the automatic use of
 * any rare material in crafting."
 *
 * One spread, asked of both sides: a crate of ten pine logs of your own beside
 * you, a carving knife in the pack, and a recipe that takes one log and rolls
 * no skill, so that what it takes is the only thing that can vary. Then:
 *
 *   * with the stores in, the crate's logs are at hand and a shaft is cut out
 *     of them;
 *   * with them out, nothing in the crate is at hand: the recipe is refused
 *     for want of a log, the crate is untouched, and a log in the crate named
 *     by its number is not at hand either;
 *   * with rare stock spared, and a common and a rare stack of logs carried,
 *     the count leaves the rare out, the work the craft picks for itself takes
 *     the common, and the rare is untouched;
 *   * with only the rare one left, the craft will not pick it -- and pointed at
 *     it, it takes it;
 *   * a fire fed with nothing named passes over a rare log, and one fed that
 *     log by name burns it;
 *   * and with rare stock not spared, the craft picks the rare log like any
 *     other.
 *
 * The island half also asks `rpc_craft_prefs`, which is how the browser tells
 * it, and runs against the database the suite leaves behind, in one
 * transaction that is rolled back.
 */
import { execFileSync } from 'node:child_process';
import { Game } from '../../src/game/game';
import { ACTION_BY_ID, type Target } from '../../src/game/actions';
import type { Item } from '../../src/game/items';

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

const RECIPE = 'make_shafts';

/* ---- the browser --------------------------------------------------------- */

const game = Game.create(4242);
let spot: [number, number] | null = null;
for (let r = 0; r < 80 && !spot; r++) {
  for (let dx = -r; dx <= r && !spot; dx++) {
    for (const dy of [-r, r]) {
      const [x, y] = [64 + dx, 64 + dy];
      let dry = true;
      for (let j = -2; j <= 2 && dry; j++) {
        for (let i = -2; i <= 2 && dry; i++) dry = game.world.isPassable(x + i, y + j) && !game.world.hasWater(x + i, y + j);
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
for (const it of [...pack.items]) if (['log', 'shaft', 'carving_knife'].includes(it.id) || it.inside) pack.remove(it.uid, it.count);
pack.add('carving_knife', { ql: 50 });
const crate = game.addCrate('plank', px + 1, py, 0, 0, [{ uid: pack.nextUid++, id: 'log', ql: 30, dmg: 0, count: 10, extra: 'Pine' }]);
const fire = game.addCampfire(px, py - 1, 0, 0, 0, false);

const count = (items: Item[], id: string): number => items.filter((it) => it.id === id).reduce((n, it) => n + it.count, 0);
const make = ACTION_BY_ID.get(RECIPE);
const feed = ACTION_BY_ID.get('fuel_campfire');
if (!make || !feed) throw new Error('an action is missing');
/** Ask, and do it when the answer is yes: the answer, or "done". */
const go = (def: typeof make, t: Target): string => {
  game.player.stats.stamina = 1;
  const why = def.check?.(t, game) ?? null;
  if (why) return why;
  def.perform(t, game);
  return 'done';
};
/** The stack the crafting window starts a recipe on: the first log a craft would reach. */
const windowAim = (): number | undefined => game.craftStock().find((s) => s.item.id === 'log')?.item.uid;
const shafts = (): number => count(pack.items, 'shaft');

console.log('--- the browser');
game.settings.fromStores = true;
game.settings.spareRare = false;
check('with the stores in, the crate\'s ten logs are at hand', game.stockCount('log') === 10, `${game.stockCount('log')}`);
let aim = windowAim();
check('and a shaft is cut out of them', aim !== undefined && go(make, { kind: 'item', uid: aim } as Target) === 'done'
  && count(crate.items, 'log') === 9 && shafts() === 4, `${count(crate.items, 'log')} logs in the crate, ${shafts()} shafts`);

game.settings.fromStores = false;
check('with them out, nothing in the crate is at hand', game.stockCount('log') === 0 && windowAim() === undefined, `${game.stockCount('log')}`);
const stored = crate.items.find((it) => it.id === 'log')!;
const refused = go(make, { kind: 'item', uid: stored.uid } as Target);
check('the recipe is refused, and a log in the crate named by its number is not at hand either',
  refused !== 'done' && count(crate.items, 'log') === 9, `${refused}; ${count(crate.items, 'log')} logs in the crate`);
check('nor is it offered on a station\'s menu', game.stockChoices((it) => it.id === 'log').length === 0,
  `${game.stockChoices((it) => it.id === 'log').length} offered`);

// Carried: a common stack and a rare one, which do not stack together.
const rareLog = (): Item => pack.addItem({ uid: pack.nextUid++, id: 'log', ql: 30, dmg: 0, count: 1, extra: 'Pine', rare: 1 });
const common = pack.add('log', { count: 2, ql: 30, extra: 'Pine' });
const rare = rareLog();
game.settings.spareRare = true;
check('with rare stock spared, the count leaves the rare log out', game.stockCount('log') === 2, `${game.stockCount('log')}`);
aim = windowAim();
check('the work the craft picks for itself takes the common logs', aim === common.uid
  && go(make, { kind: 'item', uid: aim } as Target) === 'done' && go(make, { kind: 'item', uid: aim } as Target) === 'done'
  && !pack.get(common.uid) && pack.get(rare.uid)?.count === 1, `aimed at ${aim === rare.uid ? 'the rare one' : aim === common.uid ? 'the common one' : 'nothing'}`);
check('with only the rare one left, the craft will not pick it', windowAim() === undefined && game.stockCount('log') === 0,
  `${game.stockCount('log')} counted`);
const beforeShafts = shafts();
check('and pointed at it, it takes it', go(make, { kind: 'item', uid: rare.uid } as Target) === 'done'
  && !pack.get(rare.uid) && shafts() === beforeShafts + 4, `${pack.get(rare.uid)?.count ?? 0} left`);

// Nothing else to burn: the shafts cut so far are fuel too.
for (const it of [...pack.items]) if (it.id === 'shaft') pack.remove(it.uid, it.count);
const rareFuel = rareLog();
const fuelled = go(feed, { kind: 'campfire', id: fire.id, count: 1 } as Target);
check('a fire fed with nothing named passes over a rare log', fuelled !== 'done' && pack.get(rareFuel.uid)?.count === 1 && fire.fuel === 0,
  `${fuelled}; fuel ${fire.fuel}`);
check('but it is on the fire\'s menu to be chosen', game.stockChoices((it) => it.id === 'log').some((s) => s.item.uid === rareFuel.uid));
check('and fed that log by name, the fire burns it', go(feed, { kind: 'campfire', id: fire.id, itemUid: rareFuel.uid, count: 1 } as Target) === 'done'
  && !pack.get(rareFuel.uid) && fire.fuel > 0, `fuel ${fire.fuel}`);

const plain = rareLog();
game.settings.spareRare = false;
aim = windowAim();
check('with rare stock not spared, the craft picks the rare log like any other', aim === plain.uid
  && go(make, { kind: 'item', uid: aim } as Target) === 'done' && !pack.get(plain.uid));
game.settings.fromStores = true;

/* ---- the island ---------------------------------------------------------- */

const isle = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; me uuid; v_x int; v_y int; v_crate int; v_fire bigint; v_log bigint; v_common bigint; v_rare bigint;
        v_fuel bigint; v_plain bigint; v_prefs jsonb;
begin
  select id into w from world where name = 'Hoarding';
  select uid into me from player where world_id = w and name = 'Dane';
  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  select gx, gy into v_x, v_y
    from generate_series(20, 200, 7) gx, generate_series(20, 200, 7) gy
   where not exists (select 1 from deed d where d.world_id = w
                      and abs(d.x - gx) <= d.radius + 8 and abs(d.y - gy) <= d.radius + 8)
   order by gx, gy limit 1;
  update player set x = v_x + 0.5, y = v_y + 0.5, act = null, act_queue = '[]'::jsonb,
      stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1')
   where world_id = w and uid = me;
  delete from item i where i.world_id = w and i.holder = 'player' and i.holder_uid = me
    and (i.def in ('log', 'shaft', 'carving_knife') or is_bag(i.def));
  perform give(w, me, 'carving_knife', 1, 50);
  select coalesce(max(id), 0) + 1 into v_crate from crate where world_id = w;
  insert into crate (world_id, id, kind, x, y, sx, sy, made_by) values (w, v_crate, 'plank', v_x + 1, v_y, 0, 0, me);
  insert into item (world_id, holder, crate, gx, gy, def, ql, count, extra)
    values (w, 'crate', v_crate, v_x + 1, v_y, 'log', 30, 10, 'Pine');
  insert into placed (world_id, kind, x, y, sx, sy, cx, cy, fuel, made_by)
    values (w, 'campfire', v_x, v_y - 1, 0, 0, v_x + 0.25, v_y - 0.75, 0, me) returning id into v_fire;

  insert into said values ('NEVER|' || coalesce((select craft_from_stores::text from player where world_id = w and uid = me), 'null')
    || ',' || coalesce((select craft_spare_rare::text from player where world_id = w and uid = me), 'null'));
  insert into said values ('IN|' || craft_count(w, me, 'log'));
  select id into v_log from item where world_id = w and holder = 'crate' and crate = v_crate;
  insert into said values ('CUT?|' || coalesce(act_refusal(w, me, '${RECIPE}', jsonb_build_object('kind', 'item', 'uid', v_log)), 'none'));
  perform perform_craft(w, me, '${RECIPE}', jsonb_build_object('kind', 'item', 'uid', v_log));
  insert into said values ('CUT|' || (select count from item where id = v_log) || ','
    || (select coalesce(sum(count), 0) from item where world_id = w and holder = 'player' and holder_uid = me and def = 'shaft'));

  v_prefs := rpc_craft_prefs(w, false, null);
  insert into said values ('OUT|' || (v_prefs->>'from_stores') || ',' || (v_prefs->>'spare_rare') || ',' || craft_count(w, me, 'log'));
  insert into said values ('OUT?|' || coalesce(act_refusal(w, me, '${RECIPE}', jsonb_build_object('kind', 'item', 'uid', v_log)), 'none'));
  insert into said values ('NAMED|' || at_hand(w, me, v_log) || ',' || (select count from item where id = v_log));

  v_common := give(w, me, 'log', 2, 30, 'Pine');
  insert into item (world_id, holder, holder_uid, def, ql, count, extra, rare)
    values (w, 'player', me, 'log', 30, 1, 'Pine', 'rare') returning id into v_rare;
  v_prefs := rpc_craft_prefs(w, null, true);
  insert into said values ('SPARE|' || (v_prefs->>'from_stores') || ',' || (v_prefs->>'spare_rare') || ',' || craft_count(w, me, 'log'));
  -- The window's aim: the first log a craft would reach.
  insert into said values ('AIM|' || coalesce((select case s.id when v_common then 'common' when v_rare then 'rare' else 'other' end
    from craft_stock(w, me) s where s.def = 'log' order by s.draw limit 1), 'nothing'));
  perform perform_craft(w, me, '${RECIPE}', jsonb_build_object('kind', 'item', 'uid', v_common));
  perform perform_craft(w, me, '${RECIPE}', jsonb_build_object('kind', 'item', 'uid', v_common));
  insert into said values ('COMMON|' || exists (select 1 from item where id = v_common) || ',' || (select count from item where id = v_rare));
  insert into said values ('ALONE|' || craft_count(w, me, 'log') || ','
    || coalesce(craft_refusal(w, me, '${RECIPE}', null), 'none'));
  insert into said values ('POINTED?|' || coalesce(act_refusal(w, me, '${RECIPE}', jsonb_build_object('kind', 'item', 'uid', v_rare)), 'none'));
  perform perform_craft(w, me, '${RECIPE}', jsonb_build_object('kind', 'item', 'uid', v_rare));
  insert into said values ('POINTED|' || exists (select 1 from item where id = v_rare));

  -- Nothing else to burn: the shafts cut so far are fuel too.
  delete from item where world_id = w and holder = 'player' and holder_uid = me and def = 'shaft';
  insert into item (world_id, holder, holder_uid, def, ql, count, extra, rare)
    values (w, 'player', me, 'log', 30, 1, 'Pine', 'rare') returning id into v_fuel;
  insert into said values ('FIRE?|' || coalesce(act_refusal(w, me, 'fuel_campfire',
    jsonb_build_object('kind', 'campfire', 'id', v_fire, 'count', 1)), 'none'));
  perform perform_fire(w, me, 'fuel_campfire', jsonb_build_object('kind', 'campfire', 'id', v_fire, 'count', 1));
  insert into said values ('FIRE|' || (select count from item where id = v_fuel) || ',' || (select fuel from placed where id = v_fire));
  insert into said values ('BYNAME?|' || coalesce(act_refusal(w, me, 'fuel_campfire',
    jsonb_build_object('kind', 'campfire', 'id', v_fire, 'itemUid', v_fuel, 'count', 1)), 'none'));
  perform perform_fire(w, me, 'fuel_campfire', jsonb_build_object('kind', 'campfire', 'id', v_fire, 'itemUid', v_fuel, 'count', 1));
  insert into said values ('BYNAME|' || exists (select 1 from item where id = v_fuel) || ',' || ((select fuel from placed where id = v_fire) > 0));

  insert into item (world_id, holder, holder_uid, def, ql, count, extra, rare)
    values (w, 'player', me, 'log', 30, 1, 'Pine', 'rare') returning id into v_plain;
  v_prefs := rpc_craft_prefs(w, true, false);
  insert into said values ('PLAIN|' || (v_prefs->>'from_stores') || ',' || (v_prefs->>'spare_rare') || ',' || craft_count(w, me, 'log'));
end $$;
select string_agg(k, E'\\n') from said;
rollback;
`);
const said = (key: string): string => isle.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? '(nothing)';

// A refusal from the island names what is missing; any words at all are a no.
const no = (s: string): boolean => s !== 'none' && s !== '(nothing)';
console.log('--- the island');
check('a body never told has neither setting', said('NEVER') === 'null,null', said('NEVER'));
check('with the stores in, the crate\'s ten logs are at hand', said('IN') === '10', said('IN'));
check('and a shaft is cut out of them', said('CUT?') === 'none' && said('CUT') === '9,4', `${said('CUT?')}; ${said('CUT')}`);
check('rpc_craft_prefs takes the stores out, and nothing in the crate is at hand', said('OUT') === 'false,false,0', said('OUT'));
check('the recipe is refused', no(said('OUT?')), said('OUT?'));
check('and a log in the crate named by its number is not at hand either, and is still there', said('NAMED') === 'false,9', said('NAMED'));
check('with rare stock spared, the count leaves the rare log out', said('SPARE') === 'false,true,2', said('SPARE'));
check('the craft\'s own pick is the common stack', said('AIM') === 'common', said('AIM'));
check('which is what the work takes, and the rare log is untouched', said('COMMON') === 'false,1', said('COMMON'));
check('with only the rare one left, the craft will not pick it', /^0,/.test(said('ALONE')) && no(said('ALONE').slice(2)), said('ALONE'));
check('and pointed at it, it takes it', said('POINTED?') === 'none' && said('POINTED') === 'false', `${said('POINTED?')}; ${said('POINTED')}`);
check('a fire fed with nothing named passes over a rare log', no(said('FIRE?')) && said('FIRE') === '1,0', `${said('FIRE?')}; ${said('FIRE')}`);
check('and fed that log by name, the fire burns it', said('BYNAME?') === 'none' && said('BYNAME') === 'false,true', `${said('BYNAME?')}; ${said('BYNAME')}`);
check('with rare stock not spared and the stores back in, the rare log counts like any other', said('PLAIN') === 'true,false,10', said('PLAIN'));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`what a craft may take is the player's to say — ${ok.length} of ${ok.length}`);
