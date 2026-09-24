/**
 * The last spadeful in a cart, and a fault in one job kept to that job.
 *
 * Reported: "something just broke, no actions are working". The island's
 * clock had failed every second for a quarter of an hour with
 * `new row for relation "item" violates check constraint "item_count_check"`:
 * `take_spoil` took one off a stack by setting its count to one less and then
 * deleting the row if that left nothing, and the item table refuses a count
 * of 0 before the delete is reached. A cart's last spadeful of dirt could not
 * be used, and the job that tried took everybody's work down with it, because
 * `world_tick` settles every body on every island in one transaction.
 * `site_take`, which takes a building's material off the pile on its site,
 * did the same.
 *
 * Asked of the island, in one transaction that is rolled back:
 *
 *   * the last spadeful in a crate beside you is taken, and its row goes;
 *     one of three leaves two; with none anywhere the answer is no;
 *   * the last log on a building site's pile is taken, and its row goes;
 *   * the reported case through the clock itself: a job dropping dirt, due,
 *     with the last spadeful in a cart beside you, settles -- the corner
 *     comes up one, the cart is empty, the job is over;
 *   * and a job that raises an error stops only itself: with a fault put in
 *     the way of one body's spadeful, the clock's round still finishes,
 *     another body's job in the same round settles, and the faulty job stops
 *     with its queue, undone, with its owner told what the island said and
 *     the fault kept where the deploy reads it. The heartbeat a browser makes
 *     is not refused either, and the same fault again is counted on the same
 *     row;
 *   * and a sweep that raises an error stops only that sweep: the round
 *     finishes, says it had a fault, keeps it, and still settles work.
 */
import { execFileSync } from 'node:child_process';

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

const FAULT = 'a fault the test put there';
const SWEEP = 'a sweep the test broke';

const isle = psql(`
begin;
create temp table said (k text);
do $$
declare w uuid; me uuid; other uuid; v_x int; v_y int; v_crate int; v_site int; v_cart bigint;
        v_ok boolean; r jsonb; h0 int; h1 int; job jsonb; v_dirt bigint;
begin
  select id into w from world where name = 'Hoarding';
  select uid into me from player where world_id = w and name = 'Dane';
  select uid into other from player where world_id = w and name = 'Crowd1';
  perform set_config('request.jwt.claims', json_build_object('sub', me)::text, true);
  select gx, gy into v_x, v_y
    from generate_series(20, 200, 7) gx, generate_series(20, 200, 7) gy
   where not exists (select 1 from deed d where d.world_id = w
                      and abs(d.x - gx) <= d.radius + 14 and abs(d.y - gy) <= d.radius + 8)
   order by gx, gy limit 1;
  update player set x = v_x + 0.5, y = v_y + 0.5, act = null, act_queue = '[]'::jsonb,
      away = false, seen_at = now(), stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1')
   where world_id = w and uid = me;
  update player set x = v_x + 10.5, y = v_y + 0.5, act = null, act_queue = '[]'::jsonb,
      away = false, seen_at = now(), stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1')
   where world_id = w and uid = other;
  delete from item i where i.world_id = w and i.holder = 'player' and i.holder_uid in (me, other)
    and (i.def in ('dirt', 'clay', 'sand') or is_bag(i.def));

  -- A crate beside you with one spadeful in it, and then three.
  select coalesce(max(id), 0) + 1 into v_crate from crate where world_id = w;
  insert into crate (world_id, id, kind, x, y, sx, sy, made_by) values (w, v_crate, 'plank', v_x + 1, v_y, 0, 0, me);
  insert into item (world_id, holder, crate, gx, gy, def, ql, count) values (w, 'crate', v_crate, v_x + 1, v_y, 'dirt', 30, 1);
  v_ok := take_spoil(w, me, 'dirt');
  insert into said values ('CRATE1|' || v_ok || ',' || (select count(*) from item where world_id = w and holder = 'crate' and crate = v_crate));
  insert into item (world_id, holder, crate, gx, gy, def, ql, count) values (w, 'crate', v_crate, v_x + 1, v_y, 'dirt', 30, 3);
  v_ok := take_spoil(w, me, 'dirt');
  insert into said values ('CRATE3|' || v_ok || ',' || (select coalesce(sum(count), 0) from item where world_id = w and holder = 'crate' and crate = v_crate));
  delete from item where world_id = w and holder = 'crate' and crate = v_crate;
  delete from crate where world_id = w and id = v_crate;
  insert into said values ('NONE|' || take_spoil(w, me, 'dirt'));

  -- A building site's pile with one log on it.
  v_site := v_crate;
  insert into crate (world_id, id, kind, x, y, sx, sy, made_by) values (w, v_site, 'plank', v_x - 3, v_y, 0, 0, me);
  insert into item (world_id, holder, crate, gx, gy, def, ql, count) values (w, 'crate', v_site, v_x - 3, v_y, 'log', 30, 1);
  v_ok := site_take(w, v_x - 3, v_y, 'log');
  insert into said values ('SITE|' || v_ok || ',' || (select count(*) from item where world_id = w and holder = 'crate' and crate = v_site)
    || ',' || site_take(w, v_x - 3, v_y, 'log'));
  delete from crate where world_id = w and id = v_site;

  -- The reported case, through the clock: the last spadeful in a cart.
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, material, made_by)
    values (w, 'furniture', 'cart', v_x + 1, v_y, 0, 0, v_x + 1.5, v_y + 0.5, 40, 'Pine', me) returning id into v_cart;
  insert into item (world_id, holder, placed, def, ql, count) values (w, 'furniture', v_cart, 'dirt', 30, 1);
  job := jsonb_build_object('kind', 'tile', 'x', v_x, 'y', v_y, 'cx', v_x, 'cy', v_y);
  h0 := land_height(w, v_x, v_y);
  update player set act = 'drop_dirt', act_target = job, act_left = 1, act_goes = 1,
         act_started = now() - interval '5 seconds', act_ends = now() - interval '1 second'
   where world_id = w and uid = me;
  r := world_tick();
  insert into said values ('LAST|' || coalesce(r->>'busy', 'ran') || ','
    || (select count(*) from item where world_id = w and holder = 'furniture' and placed = v_cart) || ','
    || (land_height(w, v_x, v_y) - h0) || ','
    || coalesce((select act from player where world_id = w and uid = me), 'idle'));

  -- A fault in the way of Dane's spadeful, and nobody else's.
  alter function take_spoil(uuid, uuid, text) rename to take_spoil_as_it_was;
  execute format($f$
    create function take_spoil(p_world uuid, p_uid uuid, p_def text) returns boolean language plpgsql as $b$
    begin
      if p_uid = %L then raise exception %L; end if;
      return take_spoil_as_it_was(p_world, p_uid, p_def);
    end $b$ $f$, me, '${FAULT}');
  insert into item (world_id, holder, placed, def, ql, count) values (w, 'furniture', v_cart, 'dirt', 30, 5);
  update player set act = 'drop_dirt', act_target = job, act_left = 3, act_goes = 3,
         act_started = now() - interval '5 seconds', act_ends = now() - interval '1 second',
         act_queue = jsonb_build_array(jsonb_build_object('action', 'drop_dirt', 'target', job))
   where world_id = w and uid = me;
  perform give(w, other, 'dirt', 3, 30);
  update player set act = 'drop_dirt', act_left = 1, act_goes = 1,
         act_target = jsonb_build_object('kind', 'tile', 'x', v_x + 10, 'y', v_y, 'cx', v_x + 10, 'cy', v_y),
         act_started = now() - interval '5 seconds', act_ends = now() - interval '1 second'
   where world_id = w and uid = other;
  h0 := land_height(w, v_x, v_y);
  h1 := land_height(w, v_x + 10, v_y);
  r := world_tick();
  insert into said values ('ROUND|' || coalesce(r->>'busy', 'ran'));
  insert into said values ('OTHER|'
    || (select coalesce(sum(count), 0) from item where world_id = w and holder = 'player' and holder_uid = other and def = 'dirt') || ','
    || (land_height(w, v_x + 10, v_y) - h1) || ','
    || coalesce((select act from player where world_id = w and uid = other), 'idle'));
  insert into said values ('STOPPED|'
    || coalesce((select act from player where world_id = w and uid = me), 'idle') || ','
    || (select jsonb_array_length(act_queue) from player where world_id = w and uid = me) || ','
    || (select coalesce(sum(count), 0) from item where world_id = w and holder = 'furniture' and placed = v_cart) || ','
    || (land_height(w, v_x, v_y) - h0));
  insert into said values ('TOLD|' || coalesce((select e.text from event e where e.world_id = w and e.uid = me and e.kind = 'error'
    order by e.n desc limit 1), 'nothing'));
  insert into said values ('KEPT|' || coalesce((select f.stage || ',' || coalesce(f.job, '') || ',' || f.error || ',' || f.times
    from private.tick_fault f where f.world_id = w and f.uid = me order by f.n desc limit 1), 'nothing'));

  -- The heartbeat a browser makes, with the same job due again.
  update player set act = 'drop_dirt', act_target = job, act_left = 1, act_goes = 1,
         act_started = now() - interval '5 seconds', act_ends = now() - interval '1 second'
   where world_id = w and uid = me;
  r := rpc_settle(p_world => w);
  insert into said values ('BEAT|' || coalesce(r->>'settled', 'nothing') || ','
    || coalesce((select act from player where world_id = w and uid = me), 'idle') || ','
    || coalesce((select f.times from private.tick_fault f where f.world_id = w and f.uid = me
                  and f.error = '${FAULT}' order by f.n desc limit 1)::text, 'nothing'));

  -- A sweep that fails, on every island the round visits.
  alter function ground_sweep(uuid) rename to ground_sweep_as_it_was;
  execute format($f$
    create function ground_sweep(p_world uuid) returns int language plpgsql as $b$
    begin raise exception %L; end $b$ $f$, '${SWEEP}');
  update player set act = 'drop_dirt', act_left = 1, act_goes = 1,
         act_target = jsonb_build_object('kind', 'tile', 'x', v_x + 10, 'y', v_y, 'cx', v_x + 10, 'cy', v_y),
         act_started = now() - interval '5 seconds', act_ends = now() - interval '1 second'
   where world_id = w and uid = other;
  r := world_tick();
  insert into said values ('SWEPT|' || coalesce(r->>'busy', 'ran') || ',' || ((r->>'faults')::int >= 1) || ','
    || coalesce((select f.stage || ',' || f.error from private.tick_fault f
                  where f.world_id = w and f.uid is null order by f.n desc limit 1), 'nothing') || ','
    || (select coalesce(sum(count), 0) from item where world_id = w and holder = 'player' and holder_uid = other and def = 'dirt') || ','
    || coalesce((select act from player where world_id = w and uid = other), 'idle'));
end $$;
select string_agg(k, E'\\n') from said;
rollback;
`);
const said = (key: string): string => isle.split('\n').find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1) ?? '(nothing)';

console.log('--- the last one in a stack');
check('the last spadeful in a crate beside you is taken, and its row goes', said('CRATE1') === 'true,0', said('CRATE1'));
check('one spadeful of three leaves two', said('CRATE3') === 'true,2', said('CRATE3'));
check('with none anywhere, nothing is taken', said('NONE') === 'false', said('NONE'));
check('the last log on a building site\'s pile is taken, its row goes, and there is no second', said('SITE') === 'true,0,false', said('SITE'));
console.log('--- the reported case, through the clock');
check('a job dropping the last spadeful out of a cart settles: the cart is empty, the corner is up one, the job is over',
  said('LAST') === 'ran,0,1,idle', said('LAST'));
console.log('--- a fault in one job');
check('the round finishes', said('ROUND') === 'ran', said('ROUND'));
check('another body\'s job in the same round settles', said('OTHER') === '2,1,idle', said('OTHER'));
check('the faulty job stops with its queue, and what it did is undone', said('STOPPED') === 'idle,0,5,0', said('STOPPED'));
check('its owner is told what the island said', said('TOLD').startsWith('You stop ') && said('TOLD').includes(FAULT), said('TOLD'));
check('the fault is kept where the deploy reads it', said('KEPT') === `settle,drop_dirt,${FAULT},1`, said('KEPT'));
check('a browser\'s heartbeat is not refused for it, and the same fault again is counted on the same row',
  said('BEAT') === '0,idle,2', said('BEAT'));
console.log('--- a fault in a sweep');
check('the round finishes, says it had a fault, keeps it, and still settles work',
  said('SWEPT') === `ran,true,sweeps,${SWEEP},1,idle`, said('SWEPT'));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the last spadeful, and one fault one job — ${ok.length} of ${ok.length}`);
