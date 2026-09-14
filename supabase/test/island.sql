\set QUIET on
\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on
set client_min_messages = notice;
-- A fixed seed, so a run that reads differently from the last one is a change
-- in the rules rather than the luck of the draw. The rolls are still rolls:
-- this only makes them the same rolls every time.
select setseed(0.4242) \g /dev/null

-- A small island, flat, grassy, with a fathom of soil over the rock.
--
-- Every mutation below is its own statement. Folding one into the select that
-- reports on it reads the snapshot from before it ran, which made the first
-- draft of this file cheerfully report the answer to the previous question.
\set ivar '11111111-1111-1111-1111-111111111111'
\set hild '22222222-2222-2222-2222-222222222222'

do $$
declare w uuid; i int; j int;
begin
  insert into world (name, seed, size, spawn_x, spawn_y, ready)
  values ('Stonehaven', 61, 16, 8, 8, true) returning id into w;
  perform land_blank(w, 16);
  for j in 0..16 loop
    for i in 0..16 loop perform land_set_height(w, i, j, 100); end loop;
  end loop;
  for j in 0..15 loop
    for i in 0..15 loop perform land_set_tile(w, i, j, 0); end loop;
  end loop;
end $$;
select id as world from world \gset

\echo ''
\echo '--- coming ashore'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select rpc_join(:'world', 'Ivar') \g /dev/null
select '1. Ivar knocks and is new here: standing at ' || round(x::numeric, 1) || ', ' || round(y::numeric, 1)
     || ', carrying ' || (select count(*) from item where holder_uid = :'ivar') || ' tools'
from player where uid = :'ivar';

select rpc_join(:'world', 'Ivar') \g /dev/null
select '2. Ivar knocks again: bodies on the island ' || (select count(*) from player)
     || ', tools in his pack ' || (select count(*) from item where holder_uid = :'ivar')
     || ' — a second kit would have made it eighteen';

select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select rpc_join(:'world', 'Hild') \g /dev/null
select '3. Hild knocks: bodies ' || (select count(*) from player)
     || ', and her pack is her own: ' || (select count(*) from item where holder_uid = :'hild') || ' tools';

\echo ''
\echo '--- what the island refuses, and why'
select '4. a corner across the island:  ' || coalesce(act_refusal(:'world', :'ivar', 'dig', '{"x":2,"y":2,"cx":2,"cy":2}'), 'ALLOWED');
select land_set_height(:'world', 8, 8, 0) \g /dev/null
select '5. a corner at the water line:  ' || coalesce(act_refusal(:'world', :'ivar', 'dig', '{"x":8,"y":8,"cx":8,"cy":8}'), 'ALLOWED');
select land_set_height(:'world', 8, 8, 100), land_set_dirt(:'world', 8, 8, 0) \g /dev/null
select '6. a corner of bare rock:       ' || coalesce(act_refusal(:'world', :'ivar', 'dig', '{"x":8,"y":8,"cx":8,"cy":8}'), 'ALLOWED');
select land_set_dirt(:'world', 8, 8, 20) \g /dev/null
delete from item where holder_uid = :'ivar' and def = 'shovel';
select '7. with no shovel in the pack:  ' || coalesce(act_refusal(:'world', :'ivar', 'dig', '{"x":8,"y":8,"cx":8,"cy":8}'), 'ALLOWED');
insert into item (world_id, holder, holder_uid, def, ql, issued) values (:'world', 'player', :'ivar', 'shovel', 20, true);
select '8. shovel back in hand:         ' || coalesce(act_refusal(:'world', :'ivar', 'dig', '{"x":8,"y":8,"cx":8,"cy":8}'), 'allowed, and about time');

\echo ''
\echo '--- digging a hole, which takes as long as it takes'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select land_height(:'world', 8, 8) as h0, (select count(*) from item where holder_uid = :'ivar') as n0 \gset
select rpc_act(:'world', 'dig', '{"x":8,"y":8,"cx":8,"cy":8}', 1) \g /dev/null
select '9. the moment he starts: height ' || land_height(:'world', 8, 8) || ' (was ' || :'h0' || ')'
     || ', things in his pack ' || (select count(*) from item where holder_uid = :'ivar') || ' (was ' || :'n0' || ')'
     || ' — nothing has happened yet, and the island already knows when it will';
select '   the job will take ' || round(extract(epoch from (act_ends - act_started))::numeric, 2) || ' seconds'
from player where uid = :'ivar';

-- The clock moved on. Nothing had to notice: the next thing to touch him does.
update player set act_started = act_started - interval '30 seconds', act_ends = act_ends - interval '30 seconds' where uid = :'ivar';
select '10. somebody looks at him thirty seconds later: ' || settle(:'world', :'ivar') || ' go settled';
select '    height ' || land_height(:'world', 8, 8) || ', dirt ' || land_dirt(:'world', 8, 8)
     || ', pack ' || (select count(*) from item where holder_uid = :'ivar')
     || ', digging ' || round(skill_of(:'world', :'ivar', 'digging')::numeric, 4)
     || ', and ' || (select count(*) from tile_change) || ' tile change went out to the island';
select '    he was told: ' || string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind in ('event','skill');

\echo ''
\echo '--- a queue of six, settled by a sweep for somebody who walked away'
delete from event;
select rpc_act(:'world', 'dig', '{"x":9,"y":9,"cx":9,"cy":9}', 6) \g /dev/null
update player set act_started = act_started - interval '600 seconds', act_ends = act_ends - interval '600 seconds' where uid = :'ivar';
select rpc_sweep() as swept \gset
select '11. ' || :'swept' || ' goes settled by the sweep, and he is now '
     || coalesce((select act from player where uid = :'ivar'), 'finished');
select '    height at that corner ' || land_height(:'world', 9, 9) || ' from 100, dirt ' || land_dirt(:'world', 9, 9) || ' from 20'
     || ', and ' || (select count(*) from event where uid = :'ivar' and text like 'You dig up%') || ' of the six came off';

\echo ''
\echo '--- the numbers on things are the database''s to hand out'
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select rpc_act(:'world', 'dig', '{"x":8,"y":8,"cx":8,"cy":8}', 3) \g /dev/null
update player set act_started = act_started - interval '600 seconds', act_ends = act_ends - interval '600 seconds' where uid = :'hild';
select rpc_sweep() \g /dev/null
select '12. Ivar and Hild both dug: ' || count(*) || ' things of dirt between them, '
     || count(distinct id) || ' distinct numbers, highest ' || max(id) from item where def = 'dirt';

\echo ''
\echo '--- what a client holding the publishable key can actually do'
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select '13. read the island:        ' || (select count(*) from land_tile)::text || ' rows of land';
select '14. read my pack:           ' || (select count(*) from item)::text || ' things — mine, plus whatever lies on the ground';
select '15. read skills:            ' || (select count(*) from skill)::text || ' of them, and every one mine';
/*
 * Reading the people, which the local suite never did.
 *
 * `player_read` used to answer "are we on the same island?" by selecting from
 * `player` inside a policy on `player`, and Postgres refuses the whole query
 * as infinite recursion. Everything above passed anyway, because nothing here
 * had ever asked a client to read a body — so the first thing to find out was
 * a live island, which is the wrong place to find it out.
 */
select '16. read the people:        ' || (select count(*) from player)::text || ' on this island with me';
do $$ begin
  begin perform land_set_height((select id from world limit 1), 0, 0, 9999); raise notice '17. call land_set_height:   ALLOWED';
  exception when others then raise notice '17. call land_set_height:   refused — %', sqlerrm; end;
  begin update land_corner set heights = heights; raise notice '18. write the land direct:  ALLOWED';
  exception when others then raise notice '18. write the land direct:  refused — %', sqlerrm; end;
  begin insert into item (world_id, holder, holder_uid, def, ql)
        values ((select id from world limit 1), 'player', auth.uid(), 'gold_lump', 100);
        raise notice '19. mint myself gold:       ALLOWED';
  exception when others then raise notice '19. mint myself gold:       refused — %', sqlerrm; end;
  begin update skill set value = 100; raise notice '20. set my skills to 100:   ALLOWED';
  exception when others then raise notice '20. set my skills to 100:   refused — %', sqlerrm; end;
  begin update player set x = 0, y = 0; raise notice '21. teleport myself:        ALLOWED';
  exception when others then raise notice '21. teleport myself:        refused — %', sqlerrm; end;
  begin perform settle((select id from world limit 1), auth.uid()); raise notice '22. call settle myself:     ALLOWED';
  exception when others then raise notice '22. call settle myself:     refused — %', sqlerrm; end;
end $$;
reset role;
\echo ''

\echo ''
\echo '--- founding an island and handing the land over'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select rpc_found('Rockhaven', 99, 8, 4, 4) as made \gset
select '22. founded: ' || (select name from world where id = :'made') || ', open to visitors: '
     || (select ready from world where id = :'made')::text;
do $$
declare w uuid := (select id from world where name = 'Rockhaven');
        rows jsonb := '[]'::jsonb; j int;
begin
  -- Nine rows of corners and eight of tiles, with a recognisable pattern in
  -- them so that what comes back can be checked against what went out.
  for j in 0..8 loop
    rows := rows || jsonb_build_object(
      'y', j,
      'heights', encode(decode(repeat(lpad(to_hex(j), 2, '0') || '01', 9), 'hex'), 'base64'),
      'dirt', encode(decode(repeat(lpad(to_hex(j + 20), 2, '0'), 9), 'hex'), 'base64'),
      'tiles', case when j < 8 then encode(decode(repeat(lpad(to_hex(j), 2, '0'), 8), 'hex'), 'base64') end,
      'data',  case when j < 8 then encode(decode(repeat('00', 8), 'hex'), 'base64') end,
      'rock',  case when j < 8 then encode(decode(repeat('0f', 8), 'hex'), 'base64') end);
  end loop;
  perform rpc_put_land(w, rows);
end $$;
select '23. land handed over, then opened: ' || rpc_ready(:'made')::text;
select '24. read back row 3: heights say ' || (r->>'y') || ' at corner 0 = ' || land_height(:'made', 0, 3)
     || ' (0x0100 + 3 = 259), soil ' || land_dirt(:'made', 0, 3) || ', tile ' || land_tile(:'made', 0, 3)
     || ', rock ' || land_rock(:'made', 0, 3)
from jsonb_array_elements(rpc_land(:'made', 3, 3)) r;
do $$
declare w uuid := (select id from world where name = 'Rockhaven');
begin
  begin perform rpc_put_land(w, '[{"y":0,"heights":"AAAA","dirt":"AA"}]'::jsonb);
        raise notice '25. writing land to an open island: ALLOWED';
  exception when others then raise notice '25. writing land to an open island: refused — %', sqlerrm; end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
do $$
declare w uuid := (select id from world where name = 'Rockhaven');
begin
  begin perform rpc_ready(w); raise notice '26. Hild opening Ivar''s island:      ALLOWED';
  exception when others then raise notice '26. Hild opening Ivar''s island:      refused — %', sqlerrm; end;
end $$;
\echo ''
\echo '--- giving an island up, and what goes with it'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select id as rock from world where name = 'Rockhaven' \gset
select rpc_join(:'rock', 'Ivar') \g /dev/null
select '27. before: ' || (select count(*) from land_corner where world_id = :'rock') || ' rows of corners, '
     || (select count(*) from land_tile where world_id = :'rock') || ' of tiles, '
     || (select count(*) from player where world_id = :'rock') || ' body, '
     || (select count(*) from item where world_id = :'rock') || ' things, '
     || (select count(*) from skill where world_id = :'rock') || ' skills, '
     || (select count(*) from event where world_id = :'rock') || ' lines';
select rpc_abandon(:'rock') \g /dev/null
select '28. after:  ' || (select count(*) from land_corner where world_id = :'rock') || ' rows of corners, '
     || (select count(*) from land_tile where world_id = :'rock') || ' of tiles, '
     || (select count(*) from player where world_id = :'rock') || ' body, '
     || (select count(*) from item where world_id = :'rock') || ' things, '
     || (select count(*) from skill where world_id = :'rock') || ' skills, '
     || (select count(*) from event where world_id = :'rock') || ' lines'
     || ' — and the other island still has ' || (select count(*) from player) || ' people on it';
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
do $$
declare w uuid := (select id from world limit 1);
begin
  begin perform rpc_abandon(w); raise notice '29. Hild giving up an island that is not hers: ALLOWED';
  exception when others then raise notice '29. Hild giving up an island that is not hers: refused — %', sqlerrm; end;
end $$;
\echo ''
\echo '--- making things: two hundred and five actions, one performer'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select id as world2 from world limit 1 \gset
delete from event where uid = :'ivar';

-- An oak log and a pine one, so the material has something to choose between.
insert into item (world_id, holder, holder_uid, def, ql, count, extra)
values (:'world2', 'player', :'ivar', 'log', 40, 3, 'Oak'), (:'world2', 'player', :'ivar', 'log', 12, 5, 'Pine');
select '30. a recipe that wants a loom:     ' || coalesce(act_refusal(:'world2', :'ivar', 'make_rug', '{"kind":"item"}'), 'ALLOWED');
select '31. a recipe with nothing to make it from: ' || coalesce(act_refusal(:'world2', :'ivar', 'make_clay_bowl', '{"kind":"item"}'), 'ALLOWED');
select '32. an action nobody has ported yet: ' || coalesce(act_refusal(:'world2', :'ivar', 'cut_down', '{"kind":"tile","x":8,"y":8}'), 'ALLOWED');
select '33. sawing a log into planks:       ' || coalesce(act_refusal(:'world2', :'ivar', 'make_planks', '{"kind":"item"}'), 'allowed');

select id as oaklog from item where holder_uid = :'ivar' and def = 'log' and extra = 'Oak' \gset
select rpc_act(:'world2', 'make_planks', ('{"kind":"item","uid":' || :'oaklog' || '}')::jsonb, 2) \g /dev/null
update player set act_started = act_started - interval '300 seconds', act_ends = act_ends - interval '300 seconds' where uid = :'ivar';
select settle(:'world2', :'ivar') as made \gset
select '34. ' || :'made' || ' goes settled; planks in the pack: '
     || coalesce((select count || ' at QL ' || round(ql::numeric,1) || ', made of ' || coalesce(extra,'nothing')
                  from item where holder_uid = :'ivar' and def = 'plank' limit 1), 'none')
     || ', oak logs left ' || (select coalesce(sum(count),0) from item where holder_uid = :'ivar' and def = 'log' and extra = 'Oak')
     || ' of 3, pine untouched at ' || (select coalesce(sum(count),0) from item where holder_uid = :'ivar' and def = 'log' and extra = 'Pine');
select '    the island said: ' || string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind in ('event','skill');

-- Something that hands a thing back, and eats its inputs when it fails.
delete from event where uid = :'ivar';
insert into item (world_id, holder, holder_uid, def, ql, count)
select :'world2', 'player', :'ivar', i.item, 50, i.count * 2 from recipe_input i where i.recipe = 'make_lye';
select '35. lye needs ' || string_agg(i.count || ' ' || i.item, ' + ' order by i.ord)
     || ', and a spoiled batch leaves ' || (select kind || ' ' || count || ' ' || item from recipe_gives where recipe = 'make_lye')
from recipe_input i where i.recipe = 'make_lye';
select rpc_act(:'world2', 'make_lye', '{"kind":"item"}', 1) \g /dev/null
update player set act_started = act_started - interval '300 seconds', act_ends = act_ends - interval '300 seconds' where uid = :'ivar';
select settle(:'world2', :'ivar') \g /dev/null
select '36. ' || coalesce((select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'event'), 'nothing said')
     || ' — buckets in hand: ' || (select coalesce(sum(count),0) from item where holder_uid = :'ivar' and def = 'bucket');

select '37. of ' || (select count(*) from action_def) || ' actions the island knows, '
     || (select count(*) from action_def where act_ported(id)) || ' can be done and '
     || (select count(*) from action_def where not act_ported(id)) || ' are honestly refused';
\echo ''
\echo '--- jobs held in your head'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
delete from event where uid = :'ivar';
update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null, act_queue = '[]' where uid = :'ivar';
insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (:'world2', 'player', :'ivar', 'log', 30, 9, 'Pine');
/*
 * Every value below goes through coalesce before \gset sees it. A null unsets
 * the variable rather than emptying it, and the next line then hands psql the
 * literal text `:'q1'`, which fails as a syntax error a long way from the
 * thing that actually went wrong.
 */
select coalesce(queue_capacity(:'world2', :'ivar')::text, '?') as cap \gset
select coalesce((rpc_act(:'world2', 'make_planks', '{"kind":"item"}', 1))->>'started', 'no') as first \gset
select coalesce((rpc_act(:'world2', 'make_planks', '{"kind":"item"}', 1))->>'inHand', 'not queued') as second \gset
select coalesce((rpc_act(:'world2', 'make_planks', '{"kind":"item"}', 1))->>'inHand', 'not queued') as third \gset
select coalesce((rpc_act(:'world2', 'make_planks', '{"kind":"item"}', 1))->>'why', 'still room') as fourth \gset
select '38. he can hold ' || :'cap' || ': the first is started (' || :'first' || '), then ' || :'second'
     || ' in hand, then ' || :'third' || ', and the next is refused — "' || :'fourth' || '"';
select '    told: ' || string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'info';
delete from event where uid = :'ivar';
update player set act_started = act_started - interval '600 seconds', act_ends = act_ends - interval '600 seconds' where uid = :'ivar';
select coalesce(settle(:'world2', :'ivar')::text, '0') as swept \gset
select '39. settled ' || :'swept' || ' goes; queue now ' || (select jsonb_array_length(act_queue) from player where uid = :'ivar')
     || ', busy with ' || coalesce((select act from player where uid = :'ivar'), 'nothing')
     || ', and the pack holds ' || (select coalesce(sum(count),0) from item where holder_uid = :'ivar' and def = 'plank') || ' planks in all';
\echo ''
\echo '--- a fire on the ground, and what it unlocks'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
delete from event where uid = :'ivar';
update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null, act_queue = '[]', x = 8.5, y = 8.5 where uid = :'ivar';
delete from item where holder_uid = :'ivar' and def in ('shaft','log');
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'shaft', 30, 4);

-- Baking a potato wants a fire and nothing else, so the fire is the only
-- thing in the way and the gate opening is visible rather than hidden behind
-- a missing bowl.
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'potato', 40, 3);
select coalesce(act_refusal(:'world2', :'ivar', 'bake_potato', '{"kind":"item"}'), 'allowed') as before \gset
select '40. with a potato in hand and no fire anywhere: ' || :'before';
select coalesce(act_refusal(:'world2', :'ivar', 'build_campfire', '{"kind":"tile","x":8,"y":8,"sx":1,"sy":1}'), 'allowed') as lay \gset
select '41. laying a fire with 4 shafts in hand: ' || :'lay';
select rpc_act(:'world2', 'build_campfire', '{"kind":"tile","x":8,"y":8,"sx":1,"sy":1}', 1) \g /dev/null
update player set act_started = act_started - interval '60 seconds', act_ends = act_ends - interval '60 seconds' where uid = :'ivar';
select settle(:'world2', :'ivar') \g /dev/null
select coalesce((select id::text from placed where world_id = :'world2' and kind = 'campfire' limit 1), '0') as fire \gset
select '42. the fire is down at ' || round(cx::numeric,2) || ', ' || round(cy::numeric,2)
     || ' with ' || burns_for(fuel) || ' of fuel, lit: ' || placed_lit(placed.*)::text
     || ', shafts left ' || (select coalesce(sum(count),0) from item where holder_uid = :'ivar' and def = 'shaft')
from placed where id = :'fire';
select '43. baking while it is laid but unlit:  ' || coalesce(act_refusal(:'world2', :'ivar', 'bake_potato', '{"kind":"item"}'), 'allowed');

select rpc_act(:'world2', 'light_campfire', ('{"kind":"campfire","id":' || :'fire' || '}')::jsonb, 1) \g /dev/null
update player set act_started = act_started - interval '60 seconds', act_ends = act_ends - interval '60 seconds' where uid = :'ivar';
select settle(:'world2', :'ivar') \g /dev/null
select '44. once it is lit: ' || coalesce((select string_agg(text, ' ' order by n) from event where uid = :'ivar' and kind = 'event' and text like '%kindling%'), 'nothing said')
     || ' — and baking is now: ' || coalesce(act_refusal(:'world2', :'ivar', 'bake_potato', '{"kind":"item"}'), 'ALLOWED');

-- Fire burns on the wall clock. Nothing ticked it; two minutes simply passed.
update placed set since = since - interval '130 seconds' where id = :'fire';
select '45. two minutes later, without anything having run: ' || burns_for(placed_fuel(placed.*)) || ' of fuel left of the '
     || burns_for(fuel) || ' it had, and ' || floor(placed_ash(placed.*)) || ' lot of ashes'
from placed where id = :'fire';
select '46. raking them out: ' || coalesce(act_refusal(:'world2', :'ivar', 'take_ashes_fire', ('{"kind":"campfire","id":' || :'fire' || '}')::jsonb), 'allowed');

-- And a fire left alone long enough goes out by itself.
update placed set since = since - interval '3 hours' where id = :'fire';
select '47. left for three hours: lit says ' || placed_lit(placed.*)::text || ', fuel ' || round(placed_fuel(placed.*)::numeric) from placed where id = :'fire';
select placed_settle(:'fire') \g /dev/null
select '48. and once anything looks at it, that is written down: lit=' || lit::text || ', fuel=' || round(fuel::numeric)
     || ', ashes ' || floor(ash) || ' — and baking is refused again: '
     || coalesce(act_refusal(:'world2', :'ivar', 'bake_potato', '{"kind":"item"}'), 'STILL ALLOWED') from placed where id = :'fire';
\echo ''
\echo '--- working the ground: rock, soil and what is laid over them'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
delete from event where uid = :'ivar';
update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null, act_queue = '[]', x = 5.5, y = 5.5 where uid = :'ivar';

-- A corner dug right down to the rock, which is what turns a tile to rock.
do $$
declare w uuid := (select id from world order by name limit 1);
begin
  perform land_set_dirt(w, 5, 5, 0); perform land_set_dirt(w, 6, 5, 0);
  perform land_set_dirt(w, 6, 6, 0); perform land_set_dirt(w, 5, 6, 0);
  perform land_set_height(w, 5, 5, 40); perform land_set_height(w, 6, 5, 40);
  perform land_set_height(w, 6, 6, 40); perform land_set_height(w, 5, 6, 40);
  perform land_set_rock(w, 5, 5, 15);   -- an iron vein
  perform reconcile(w, 5, 5);
end $$;
select '49. every corner cut to the rock: the tile is now ' || (select name from tile_def where id = land_tile(:'world2',5,5))
     || ', showing ' || (select name from rock_def where id = land_rock(:'world2',5,5))
     || ' at up to QL ' || ore_max_ql((select seed from world where id = :'world2'), 5, 5);
select '50. mining it at digging-level skill: ' || coalesce(act_refusal(:'world2', :'ivar', 'mine', '{"kind":"tile","x":5,"y":5,"cx":5,"cy":5}'), 'allowed');
update skill set value = 30 where uid = :'ivar' and id = 'mining';
insert into skill (world_id, uid, id, value) select :'world2', :'ivar', 'mining', 30 where not exists (select 1 from skill where uid = :'ivar' and id = 'mining');
select '51. and with mining at 30: ' || coalesce(act_refusal(:'world2', :'ivar', 'mine', '{"kind":"tile","x":5,"y":5,"cx":5,"cy":5}'), 'allowed');
select rpc_act(:'world2', 'mine', '{"kind":"tile","x":5,"y":5,"cx":5,"cy":5}', 8) \g /dev/null
update player set act_started = act_started - interval '900 seconds', act_ends = act_ends - interval '900 seconds' where uid = :'ivar';
select coalesce(settle(:'world2', :'ivar')::text, '0') as mined \gset
select '52. eight swings: ' || :'mined' || ' settled, and the pack holds '
     || (select coalesce(sum(count),0) from item where holder_uid = :'ivar' and def = 'iron_ore') || ' iron ore at QL '
     || coalesce((select round(ql::numeric,1)::text from item where holder_uid = :'ivar' and def = 'iron_ore' limit 1), '-')
     || ' (the seam holds at most ' || ore_max_ql((select seed from world where id = :'world2'), 5, 5) || ')';
select '    told: ' || coalesce(string_agg(text, ' | ' order by n), 'nothing') from event where uid = :'ivar' and kind = 'event' and text not like 'You start%';

-- And the soil side of it.
delete from event where uid = :'ivar';
update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null, act_queue = '[]', x = 9.5, y = 9.5 where uid = :'ivar';
do $$ declare w uuid := (select id from world order by name limit 1);
begin perform land_set_tile(w, 9, 9, 0); end $$;
select '53. grass at 9,9 — pack it: ' || coalesce(act_refusal(:'world2', :'ivar', 'pack', '{"kind":"tile","x":9,"y":9}'), 'allowed');
select rpc_act(:'world2', 'pack', '{"kind":"tile","x":9,"y":9}', 1) \g /dev/null
update player set act_started = act_started - interval '60 seconds', act_ends = act_ends - interval '60 seconds' where uid = :'ivar';
select settle(:'world2', :'ivar') \g /dev/null
select '54. it is now ' || (select name from tile_def where id = land_tile(:'world2',9,9))
     || '; paving it with gravel: ' || coalesce(act_refusal(:'world2', :'ivar', 'pave_gravel', '{"kind":"tile","x":9,"y":9}'), 'allowed');
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'rock_shards', 40, 2);
select rpc_act(:'world2', 'pave_gravel', '{"kind":"tile","x":9,"y":9}', 1) \g /dev/null
update player set act_started = act_started - interval '60 seconds', act_ends = act_ends - interval '60 seconds' where uid = :'ivar';
select settle(:'world2', :'ivar') \g /dev/null
select '55. with shards in hand it becomes ' || (select name from tile_def where id = land_tile(:'world2',9,9))
     || ', shards left ' || (select coalesce(sum(count),0) from item where holder_uid = :'ivar' and def = 'rock_shards')
     || ' — and cultivating gravel: ' || coalesce(act_refusal(:'world2', :'ivar', 'cultivate', '{"kind":"tile","x":9,"y":9}'), 'ALLOWED');
\echo ''
