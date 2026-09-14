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
\echo '--- taking what the island grows'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
delete from event where uid = :'ivar';
update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null, act_queue = '[]', x = 11.5, y = 11.5 where uid = :'ivar';

-- An old oak standing at 11,11. Species in the low four bits, age in the next two.
do $$
declare w uuid := (select id from world order by name limit 1); oak int;
begin
  select id into oak from tree_def where name = 'Oak';
  perform land_set_tile(w, 11, 11, tile_id('Tree'));
  perform land_set_data(w, 11, 11, oak | (2 << 4));
end $$;
select '56. standing at 11,11: a ' || (select name from tree_def where id = tree_species(land_data(:'world2',11,11)))
     || ', age ' || tree_age(land_data(:'world2',11,11)) || ' of 2, worth '
     || ((select logs from tree_def where id = tree_species(land_data(:'world2',11,11))) + 1) || ' logs standing';
select '57. felling it: ' || coalesce(act_refusal(:'world2', :'ivar', 'cut_down', '{"kind":"tile","x":11,"y":11}'), 'allowed');
update skill set value = 40 where uid = :'ivar' and id = 'woodcutting';
insert into skill (world_id, uid, id, value) select :'world2', :'ivar', 'woodcutting', 40 where not exists (select 1 from skill where uid = :'ivar' and id = 'woodcutting');
select rpc_act(:'world2', 'cut_down', '{"kind":"tile","x":11,"y":11}', 3) \g /dev/null
update player set act_started = act_started - interval '300 seconds', act_ends = act_ends - interval '300 seconds' where uid = :'ivar';
select settle(:'world2', :'ivar') \g /dev/null
select '58. ' || coalesce((select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'event'), 'nothing said');
select '    the tile is now ' || (select name from tile_def where id = land_tile(:'world2',11,11))
     || ', and the logs are ' || coalesce((select 'made of ' || extra || ', ' || sum(count) || ' of them' from item where holder_uid = :'ivar' and def = 'log' group by extra limit 1), 'not there')
     || ' — and swinging again: ' || coalesce(act_refusal(:'world2', :'ivar', 'cut_down', '{"kind":"tile","x":11,"y":11}'), 'ALLOWED');

delete from event where uid = :'ivar';
do $$ declare w uuid := (select id from world order by name limit 1);
begin perform land_set_tile(w, 12, 12, tile_id('Grass')); end $$;
update player set x = 12.5, y = 12.5 where uid = :'ivar';
update skill set value = 45 where uid = :'ivar' and id = 'foraging';
insert into skill (world_id, uid, id, value) select :'world2', :'ivar', 'foraging', 45 where not exists (select 1 from skill where uid = :'ivar' and id = 'foraging');
select '59. foraging at 45 goes over the ground ' || rolls_at(45) || ' times; the spot is '
     || case when is_foraged(:'world2', 12, 12, 'forage') then 'picked over' else 'untouched' end;
select rpc_act(:'world2', 'forage', '{"kind":"tile","x":12,"y":12}', 1) \g /dev/null
update player set act_started = act_started - interval '60 seconds', act_ends = act_ends - interval '60 seconds' where uid = :'ivar';
select settle(:'world2', :'ivar') \g /dev/null
select '60. ' || coalesce((select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'event'), 'nothing said');
select '61. going back to the same spot: ' || coalesce(act_refusal(:'world2', :'ivar', 'forage', '{"kind":"tile","x":12,"y":12}'), 'ALLOWED');
update foraged set at = at - interval '200 seconds' where x = 12 and y = 12;
select '62. and three minutes later: ' || coalesce(act_refusal(:'world2', :'ivar', 'forage', '{"kind":"tile","x":12,"y":12}'), 'allowed again');
\echo ''
\echo '--- a field, sown and left to itself'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
delete from event where uid = :'ivar';
update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null, act_queue = '[]', x = 13.5, y = 13.5 where uid = :'ivar';
do $$ declare w uuid := (select id from world order by name limit 1);
begin
  perform land_set_tile(w, 13, 13, tile_id('Grass'));
  perform land_set_height(w, 13, 13, 60); perform land_set_height(w, 14, 13, 60);
  perform land_set_height(w, 14, 14, 60); perform land_set_height(w, 13, 14, 60);
end $$;
select '63. raking grass into a field: ' || coalesce(act_refusal(:'world2', :'ivar', 'till', '{"kind":"tile","x":13,"y":13}'), 'allowed');
select rpc_act(:'world2', 'till', '{"kind":"tile","x":13,"y":13}', 1) \g /dev/null
update player set act_started = act_started - interval '60 seconds', act_ends = act_ends - interval '60 seconds' where uid = :'ivar';
select settle(:'world2', :'ivar') \g /dev/null
select '64. it is now ' || (select name from tile_def where id = land_tile(:'world2',13,13))
     || '; sowing with nothing in hand: ' || coalesce(act_refusal(:'world2', :'ivar', 'plant_seed', '{"kind":"tile","x":13,"y":13}'), 'ALLOWED');
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'mint_seed', 55, 3);
select coalesce((select id::text from item where holder_uid = :'ivar' and def = 'mint_seed'), '0') as seed \gset
select rpc_act(:'world2', 'plant_seed', ('{"kind":"tile","x":13,"y":13,"uid":' || :'seed' || '}')::jsonb, 1) \g /dev/null
update player set act_started = act_started - interval '60 seconds', act_ends = act_ends - interval '60 seconds' where uid = :'ivar';
select settle(:'world2', :'ivar') \g /dev/null
select '65. ' || coalesce((select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'event'), 'nothing said')
     || ' — seeds left ' || (select coalesce(sum(count),0) from item where holder_uid = :'ivar' and def = 'mint_seed');
select '66. the field holds ' || id || ', ' || crop_stage_name(stage) || ', tended ' || tended || ' of 3, at QL ' || round(ql::numeric,1)
from crop where x = 13 and y = 13;
select '67. harvesting it now: ' || coalesce(act_refusal(:'world2', :'ivar', 'harvest_crop', '{"kind":"tile","x":13,"y":13}'), 'ALLOWED');
delete from event where uid = :'ivar';
select rpc_act(:'world2', 'tend_crop', '{"kind":"tile","x":13,"y":13}', 1) \g /dev/null
update player set act_started = act_started - interval '60 seconds', act_ends = act_ends - interval '60 seconds' where uid = :'ivar';
select settle(:'world2', :'ivar') \g /dev/null
select '68. ' || coalesce((select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'event'), 'nothing said');
select '69. tending it again straight away: ' || coalesce(act_refusal(:'world2', :'ivar', 'tend_crop', '{"kind":"tile","x":13,"y":13}'), 'ALLOWED');

-- Mint takes fifty seconds a stage. Nothing here has to sit up with it.
update crop set stage_at = stage_at - interval '200 seconds' where x = 13 and y = 13;
select '70. left alone for two hundred seconds — before anybody looks, the row still says ' || crop_stage_name(stage) from crop where x = 13 and y = 13;
select crop_settle(:'world2', 13, 13) \g /dev/null
select '71. and once anybody does: ' || crop_stage_name(stage) || ', tended ' || tended
     || ', and the stage clock reads ' || round(extract(epoch from (now() - stage_at))::numeric) || 's into it — not reset to zero'
from crop where x = 13 and y = 13;
delete from event where uid = :'ivar';
select rpc_act(:'world2', 'harvest_crop', '{"kind":"tile","x":13,"y":13}', 1) \g /dev/null
update player set act_started = act_started - interval '60 seconds', act_ends = act_ends - interval '60 seconds' where uid = :'ivar';
select settle(:'world2', :'ivar') \g /dev/null
select '72. ' || coalesce((select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'event'), 'nothing said');
select '73. the field is ' || (select name from tile_def where id = land_tile(:'world2',13,13))
     || ' with ' || (select count(*) from crop where x = 13 and y = 13) || ' growing in it, and the pack holds '
     || (select coalesce(sum(count),0) from item where holder_uid = :'ivar' and def = 'mint') || ' mint and '
     || (select coalesce(sum(count),0) from item where holder_uid = :'ivar' and def = 'mint_seed') || ' seeds';
\echo ''
\echo '--- a line in the water'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
delete from event where uid = :'ivar';
update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null, act_queue = '[]', x = 2.5, y = 2.5 where uid = :'ivar';
-- A shelf of water: shallow at 3,2 and a drop-off at 4,2.
do $$
declare w uuid := (select id from world order by name limit 1); i int;
begin
  for i in 2..6 loop
    perform land_set_height(w, i, 2, -4); perform land_set_height(w, i, 3, -4);
  end loop;
  perform land_set_height(w, 4, 2, -20); perform land_set_height(w, 5, 2, -20);
  perform land_set_height(w, 4, 3, -20); perform land_set_height(w, 5, 3, -20);
  perform land_set_height(w, 2, 2, 10); perform land_set_height(w, 2, 3, 10);
end $$;
select '74. water off the bank: ' || round(water_depth(:'world2', 3, 2)) || ' deep at 3,2 and '
     || round(water_depth(:'world2', 4, 2)) || ' at the drop-off';
select '75. with no rod: ' || coalesce(act_refusal(:'world2', :'ivar', 'fish', '{"kind":"tile","x":3,"y":2}'), 'allowed');
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'fishing_rod', 45, 1);
select '76. rod in hand, line in the shallows: ' || coalesce(act_refusal(:'world2', :'ivar', 'fish', '{"kind":"tile","x":3,"y":2}'), 'allowed')
     || ' — and what runs there: ' || (select string_agg(name, ', ' order by depth) from fish_here(water_depth(:'world2',3,2), skill_of(:'world2',:'ivar','fishing')));
update skill set value = 40 where uid = :'ivar' and id = 'fishing';
insert into skill (world_id, uid, id, value) select :'world2', :'ivar', 'fishing', 40 where not exists (select 1 from skill where uid = :'ivar' and id = 'fishing');
select '77. at fishing 40 over the drop-off: ' || (select string_agg(name, ', ' order by depth) from fish_here(water_depth(:'world2',4,2), 40))
     || ' — a beginner over the same water would land ' || (select string_agg(name, ', ' order by depth) from fish_here(water_depth(:'world2',4,2), 1));
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'worm', 30, 5);
select '78. the bait it would choose: ' || coalesce(bait_for(:'world2', :'ivar', water_depth(:'world2',4,2), 40), 'none worth using');
select rpc_act(:'world2', 'fish', '{"kind":"tile","x":3,"y":2}', 6) \g /dev/null
update player set act_started = act_started - interval '900 seconds', act_ends = act_ends - interval '900 seconds' where uid = :'ivar';
select settle(:'world2', :'ivar') \g /dev/null
select '79. six casts: ' || coalesce((select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'event'), 'nothing said');
select '80. in the creel: ' || coalesce((select string_agg(d, ', ' order by d) from (
         select def || ' ×' || sum(count) as d from item
         where holder_uid = :'ivar' and def in (select id from fish_def) group by def) q), 'nothing')
     || ', worms left ' || (select coalesce(sum(count),0) from item where holder_uid = :'ivar' and def = 'worm');
-- A bait's pull, over enough draws to see it.
select '81. a thousand draws over the drop-off, bare hook vs a live minnow:';
select '    bare:  ' || string_agg(f || ' ' || n, ', ' order by n desc) from (select pick_fish(20, 60, null, random()) f, count(*) n from generate_series(1,1000) group by 1) q;
select '    minnow on it: ' || string_agg(f || ' ' || n, ', ' order by n desc) from (select pick_fish(20, 60, 'minnow', random()) f, count(*) n from generate_series(1,1000) group by 1) q;
\echo ''
\echo '--- a settlement, and a house on it'
delete from event where uid = :'ivar';
delete from item where holder_uid = :'ivar' and def in ('log', 'plank');
update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null, act_queue = '[]', x = 5.5, y = 7.5 where uid = :'ivar';
-- A flat, dry shelf to build on: the digging and mining above left this corner
-- of the island anything but level.
do $$
declare w uuid := (select id from world limit 1); i int; j int;
begin
  for j in 6..9 loop for i in 5..9 loop perform land_set_height(w, i, j, 100); end loop; end loop;
end $$;
select '82. before anybody has claimed anything: ' || coalesce(plan_reason(:'world2', 6, 7), 'allowed');
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'deed_stake', 50, 1)
  returning id as stake \gset
select '83. planting the stake: ' || coalesce(act_refusal(:'world2', :'ivar', 'found_settlement',
        ('{"kind":"item","uid":' || :'stake' || ',"name":"Stonehaven"}')::jsonb), 'allowed');
select rpc_act(:'world2', 'found_settlement', ('{"kind":"item","uid":' || :'stake' || ',"name":"Stonehaven"}')::jsonb) \g /dev/null
update player set act_started = act_started - interval '60 seconds', act_ends = act_ends - interval '60 seconds' where uid = :'ivar';
select settle(:'world2', :'ivar') \g /dev/null
select '84. ' || (select name || ' stands at ' || x || ',' || y || ', ' || (radius * 2 + 1) || ' tiles across' from deed where world_id = :'world2')
     || ' — and the stake is gone: ' || (select count(*) from item where holder_uid = :'ivar' and def = 'deed_stake')
     || ' | a second stake: ' || coalesce(act_refusal(:'world2', :'ivar', 'found_settlement', '{"kind":"item"}'), 'allowed');
select '85. on the token itself: ' || coalesce(plan_reason(:'world2', 5, 7), 'allowed')
     || ' | outside the border: ' || coalesce(plan_reason(:'world2', 14, 14), 'allowed')
     || ' | on grass inside it: ' || coalesce(plan_reason(:'world2', 6, 7), 'allowed');

update player set x = 6.5, y = 7.5 where uid = :'ivar';
select land_set_tile(:'world2', 6, 7, tile_id('Packed dirt')), land_set_tile(:'world2', 7, 7, tile_id('Packed dirt')) \g /dev/null
delete from item where holder_uid = :'ivar' and def = 'mallet';
select '86. packed, but the mallet is at home: ' || coalesce(act_refusal(:'world2', :'ivar', 'plan_building', '{"kind":"tile","x":6,"y":7}'), 'allowed');
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'mallet', 40, 1);
select rpc_act(:'world2', 'plan_building', '{"kind":"tile","x":6,"y":7,"name":"The Long Hall"}') \g /dev/null
update player set act_started = act_started - interval '60 seconds', act_ends = act_ends - interval '60 seconds' where uid = :'ivar';
select settle(:'world2', :'ivar') \g /dev/null
select '87. ' || (select name || ' is planned, ' || levels || ' storey, ' ||
        (select count(*) from building_tile t where t.building = b.id) || ' tile' from building b where world_id = :'world2');
select '88. the next tile over: ' || coalesce(act_refusal(:'world2', :'ivar', 'add_to_building', '{"kind":"tile","x":7,"y":7}'), 'allowed')
     || ' | a tile that touches nothing: ' || coalesce(act_refusal(:'world2', :'ivar', 'add_to_building', '{"kind":"tile","x":5,"y":8}'), 'allowed');
select act_perform(:'world2', :'ivar', 'add_to_building', '{"kind":"tile","x":7,"y":7}') \g /dev/null
select '89. the footprint is now ' || (select count(*) from building_tile where world_id = :'world2') || ' tiles, with '
     || (select count(*) from exterior_borders(:'world2', (select id from building where world_id = :'world2'))) || ' borders to wall';

delete from event where uid = :'ivar';
select '90. a wall with nothing chosen: ' || coalesce(act_refusal(:'world2', :'ivar', 'plan_wall', '{"kind":"tile","x":6,"y":7}'), 'allowed');
select rpc_act(:'world2', 'plan_wall', '{"kind":"tile","x":6,"y":7,"side":"n","wallType":"solid","material":"log"}') \g /dev/null
update player set act_started = act_started - interval '60 seconds', act_ends = act_ends - interval '60 seconds' where uid = :'ivar';
select settle(:'world2', :'ivar') \g /dev/null
select '91. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'event');
select '92. planning over it again: ' || coalesce(act_refusal(:'world2', :'ivar', 'plan_wall', '{"kind":"tile","x":6,"y":7,"side":"n","wallType":"solid","material":"log"}'), 'allowed')
     || ' | and with nothing to build it from: ' || coalesce(act_refusal(:'world2', :'ivar', 'build_wall', '{"kind":"tile","x":6,"y":7,"side":"n"}'), 'allowed');
insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (:'world2', 'player', :'ivar', 'log', 40, 1, 'Oak');
delete from event where uid = :'ivar';
select rpc_act(:'world2', 'build_wall', '{"kind":"tile","x":6,"y":7,"side":"n"}', 4) \g /dev/null
update player set act_started = act_started - interval '600 seconds', act_ends = act_ends - interval '600 seconds' where uid = :'ivar';
select settle(:'world2', :'ivar') \g /dev/null
select '93. one log and four goes at it: ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind in ('event','info'));
-- The one log went into the wall, row and all; a fresh stack, not a top-up.
insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (:'world2', 'player', :'ivar', 'log', 40, 100, 'Oak');
delete from event where uid = :'ivar';
select rpc_act(:'world2', 'build_wall', '{"kind":"tile","x":6,"y":7,"side":"n"}', 4) \g /dev/null
update player set act_started = act_started - interval '600 seconds', act_ends = act_ends - interval '600 seconds' where uid = :'ivar';
select settle(:'world2', :'ivar') \g /dev/null
select '94. with a stack of oak: ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'event')
     || ' — logs left ' || (select coalesce(sum(count),0) from item where holder_uid = :'ivar' and def = 'log');

select '95. raising a storey with one wall up: ' || coalesce(act_refusal(:'world2', :'ivar', 'add_floor', '{"kind":"tile","x":6,"y":7}'), 'allowed');
-- The other five borders, each checked before it is built rather than forced.
do $$
declare w uuid := (select id from world limit 1); me uuid := '11111111-1111-1111-1111-111111111111';
        job record; why text; i int;
begin
  for job in select * from (values (6,7,'s'), (6,7,'w'), (7,7,'n'), (7,7,'s'), (7,7,'e')) as v(x, y, side) loop
    why := act_refusal(w, me, 'plan_wall', jsonb_build_object('kind','tile','x',job.x,'y',job.y,
      'side',job.side,'wallType','solid','material','log'));
    if why is not null then raise exception 'plan % % %: %', job.x, job.y, job.side, why; end if;
    perform act_perform(w, me, 'plan_wall', jsonb_build_object('kind','tile','x',job.x,'y',job.y,
      'side',job.side,'wallType','solid','material','log'));
    for i in 1..4 loop
      why := act_refusal(w, me, 'build_wall', jsonb_build_object('kind','tile','x',job.x,'y',job.y,'side',job.side));
      if why is not null then raise exception 'build % % % (%): %', job.x, job.y, job.side, i, why; end if;
      perform act_perform(w, me, 'build_wall', jsonb_build_object('kind','tile','x',job.x,'y',job.y,'side',job.side));
    end loop;
  end loop;
end $$;
select '96. six walls up, twenty-four logs in them: the ground floor is '
     || case when level_complete(:'world2', (select id from building where world_id = :'world2'), 0) then 'complete' else 'unfinished' end
     || ', logs left ' || (select coalesce(sum(count),0) from item where holder_uid = :'ivar' and def = 'log')
     || ', carpentry ' || to_char(skill_of(:'world2', :'ivar', 'carpentry'), 'FM990.00');
select '97. and now: ' || coalesce(act_refusal(:'world2', :'ivar', 'add_floor', '{"kind":"tile","x":6,"y":7}'), 'allowed')
     || ' | pulling a tile out from under it: ' || coalesce(act_refusal(:'world2', :'ivar', 'remove_from_plan', '{"kind":"tile","x":6,"y":7}'), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'add_floor', '{"kind":"tile","x":6,"y":7}') \g /dev/null
select '98. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'event')
     || ' — and the footprint is now fixed: ' || coalesce(act_refusal(:'world2', :'ivar', 'add_to_building', '{"kind":"tile","x":5,"y":7}'), 'allowed');
select '99. a wall on the new storey before its floor: ' || coalesce(act_refusal(:'world2', :'ivar', 'plan_wall', '{"kind":"tile","x":6,"y":7,"side":"n","wallType":"solid","material":"log"}'), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'plan_floor', '{"kind":"tile","x":6,"y":7,"material":"log"}') \g /dev/null
select '100. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'event')
     || ' — a floor is half a wall';
do $$
declare w uuid := (select id from world limit 1); me uuid := '11111111-1111-1111-1111-111111111111';
        why text; i int;
begin
  for i in 1..2 loop
    why := act_refusal(w, me, 'build_floor', '{"kind":"tile","x":6,"y":7}');
    if why is not null then raise exception 'build floor %: %', i, why; end if;
    perform act_perform(w, me, 'build_floor', '{"kind":"tile","x":6,"y":7}');
  end loop;
end $$;
select '101. the upper floor at 6,7 is ' || case when bill_done((select needed from floor_tile where level = 1 and x = 6 and y = 7)) then 'laid' else 'still owing' end
     || ', paving is ' || to_char(skill_of(:'world2', :'ivar', 'paving'), 'FM990.00')
     || ' — a wall may go on it now: ' || coalesce(act_refusal(:'world2', :'ivar', 'plan_wall', '{"kind":"tile","x":6,"y":7,"side":"n","wallType":"solid","material":"log"}'), 'allowed');
select '102. roofing before the top storey is walled: ' || coalesce(act_refusal(:'world2', :'ivar', 'plan_floor', '{"kind":"tile","x":6,"y":7,"material":"log","floorKind":"roof"}'), 'allowed');
select '103. a ladder with no side to climb from: ' || coalesce(act_refusal(:'world2', :'ivar', 'plan_floor', '{"kind":"tile","x":7,"y":7,"material":"log","floorKind":"ladder"}'), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'plan_floor', '{"kind":"tile","x":7,"y":7,"material":"log","floorKind":"ladder","side":"w"}') \g /dev/null
select '104. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'event')
     || ' — a ladder is two planks whatever it is nailed to, and there are '
     || (select coalesce(sum(count),0) from item where holder_uid = :'ivar' and def = 'plank') || ' in the pack: '
     || coalesce(act_refusal(:'world2', :'ivar', 'build_floor', '{"kind":"tile","x":7,"y":7,"floorKind":"ladder"}'), 'allowed');
select act_perform(:'world2', :'ivar', 'plan_wall', '{"kind":"tile","x":6,"y":7,"side":"n","wallType":"solid","material":"log"}') \g /dev/null
select '105. tearing up a floor with a wall standing on it: ' || coalesce(act_refusal(:'world2', :'ivar', 'remove_floor', '{"kind":"tile","x":6,"y":7}'), 'allowed')
     || ' | and taking the storey off: ' || coalesce(act_refusal(:'world2', :'ivar', 'remove_storey', '{"kind":"tile","x":6,"y":7}'), 'allowed');
-- Down again, in the order the island insists on: wall, floors, storey.
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'remove_wall', '{"kind":"tile","x":6,"y":7,"side":"n"}') \g /dev/null
select act_perform(:'world2', :'ivar', 'remove_floor', '{"kind":"tile","x":6,"y":7}') \g /dev/null
select act_perform(:'world2', :'ivar', 'remove_floor', '{"kind":"tile","x":7,"y":7}') \g /dev/null
select act_perform(:'world2', :'ivar', 'remove_storey', '{"kind":"tile","x":6,"y":7}') \g /dev/null
select '106. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'event');
select '107. what is left standing: ' || (select levels || ' storey, ' || (select count(*) from wall w where w.building = b.id)
        || ' walls, ' || (select count(*) from floor_tile f where f.building = b.id) || ' floors' from building b where world_id = :'world2');

\echo ''
\echo '--- a fence, which is a wall with nothing around it'
delete from event where uid = :'ivar';
update player set x = 3.5, y = 7.5 where uid = :'ivar';
select '108. a solid wall out in the open: ' || coalesce(act_refusal(:'world2', :'ivar', 'plan_fence', '{"kind":"tile","x":3,"y":7,"side":"n","wallType":"solid","material":"log"}'), 'allowed');
select rpc_act(:'world2', 'plan_fence', '{"kind":"tile","x":3,"y":7,"side":"n","wallType":"fence","material":"log"}') \g /dev/null
update player set act_started = act_started - interval '60 seconds', act_ends = act_ends - interval '60 seconds' where uid = :'ivar';
select settle(:'world2', :'ivar') \g /dev/null
select '109. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'event')
     || ' — it belongs to building ' || (select building from wall where world_id = :'world2' and dir = 'h' and x = 3 and y = 7);
select '110. the same border from the other side: ' || coalesce(act_refusal(:'world2', :'ivar', 'plan_fence', '{"kind":"tile","x":3,"y":6,"side":"s","wallType":"fence","material":"log"}'), 'allowed');
update player set x = 3.5, y = 4.5 where uid = :'ivar';
select '111. down at the shore: ' || coalesce(act_refusal(:'world2', :'ivar', 'plan_fence', '{"kind":"tile","x":3,"y":3,"side":"n","wallType":"fence","material":"log"}'), 'allowed');
update player set x = 3.5, y = 7.5 where uid = :'ivar';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'build_wall', '{"kind":"tile","x":3,"y":7,"side":"n"}') \g /dev/null
select act_perform(:'world2', :'ivar', 'build_wall', '{"kind":"tile","x":3,"y":7,"side":"n"}') \g /dev/null
select '112. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'event');
delete from event where uid = :'ivar';
select rpc_act(:'world2', 'rename_building', '{"kind":"tile","x":3,"y":7,"name":"Nowhere"}') \g /dev/null
select '113. renaming a fence: ' || coalesce((select string_agg(text, ' | ' order by n) from event where uid = :'ivar'), 'nothing said');
update player set x = 6.5, y = 7.5 where uid = :'ivar';
delete from event where uid = :'ivar';
select rpc_act(:'world2', 'rename_building', '{"kind":"tile","x":6,"y":7,"name":"Mead Hall"}') as instant \gset
select '114. renaming the hall, which takes no time at all: done=' || coalesce((:'instant'::jsonb->>'done'), 'no')
     || ' — ' || (select name from building where world_id = :'world2')
     || ', said at once: ' || coalesce((select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'event'), 'nothing');
\echo ''
\echo '--- and what a client may do to a house that is not theirs'
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select '115. Hild reads the island: ' || (select count(*) from building) || ' building, '
     || (select count(*) from wall) || ' walls, ' || (select count(*) from deed) || ' deed';
do $$ begin
  begin update building set name = 'Hild''s'; raise notice '116. rename it out from under him: ALLOWED';
  exception when others then raise notice '116. rename it out from under him: refused — %', sqlerrm; end;
  begin insert into wall (world_id, level, dir, x, y, building, type, material, needed, total)
        values ((select id from world limit 1), 0, 'h', 1, 1, 0, 'solid', 'log', '{}', '{}');
        raise notice '117. a wall for free:              ALLOWED';
  exception when others then raise notice '117. a wall for free:              refused — %', sqlerrm; end;
  begin update wall set needed = '{}'; raise notice '118. wish the bills away:          ALLOWED';
  exception when others then raise notice '118. wish the bills away:          refused — %', sqlerrm; end;
  begin insert into deed (world_id, name, x, y) values ((select id from world limit 1), 'Hildstead', 1, 1);
        raise notice '119. claim the island as well:     ALLOWED';
  exception when others then raise notice '119. claim the island as well:     refused — %', sqlerrm; end;
end $$;
reset role;
select '120. and it is all still his: ' || (select name from building where world_id = :'world2')
     || ', ' || (select count(*) from wall where world_id = :'world2') || ' walls, deed of '
     || (select name from deed where world_id = :'world2');
\echo ''
\echo '--- the things that are alive when nobody is looking'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
delete from event where uid = :'ivar';
update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null, act_queue = '[]', x = 6.5, y = 7.5 where uid = :'ivar';
-- Its own statement: folding a write into the select that reports on it reads
-- the snapshot from before it ran, which is how this file lies to you.
select creature_stock(:'world2') as stocked \gset
select '121. stocking a 16-tile island: ' || :'stocked' || ' head of wildlife, '
     || (select count(distinct species) from creature where world_id = :'world2') || ' sorts of it';
select '122. and none of it on the deed: ' || (select count(*) from creature c where on_deed(:'world2', floor(c.to_x)::int, floor(c.to_y)::int));
-- Habitat: what settles where is the ground's business, not the roll's.
select '123. a bevere wants open water: ' || suits(:'world2', 'bevere', 3, 4) || ' by the shore, '
     || suits(:'world2', 'bevere', 14, 14) || ' inland'
     || ' | a seavic wants trees: ' || suits(:'world2', 'seavic', 14, 14) || ' by the oak, '
     || suits(:'world2', 'seavic', 3, 4) || ' out on the grass'
     || ' | a crawler wants sand: ' || suits(:'world2', 'crawler', 14, 14);

-- One creature, watched, then not watched.
select creature_spawn(:'world2', 'rabba', 6.8, 7.4, 'wild', now() - interval '2 hours') as cid \gset
create temp table snap as select * from creature where world_id = :'world2' and id = :'cid';
select '124. a rabba stands at ' || round(to_x::numeric, 2) || ',' || round(to_y::numeric, 2)
     || ' on leg ' || leg || ', and it is ' || age_of(born) || ', ' || sex || ', carrying ' || trait_names(traits)
  from creature where id = :'cid';
update creature set until = until - interval '30 seconds', leg_at = leg_at - interval '30 seconds',
    leg_ends = leg_ends - interval '30 seconds', settled_at = settled_at - interval '30 seconds' where id = :'cid';
select creature_settle(:'world2', :'cid') \g /dev/null
select '125. thirty seconds nobody watched: it is at ' || round(to_x::numeric, 2) || ',' || round(to_y::numeric, 2)
     || ' on leg ' || leg from creature where id = :'cid';
select to_x || ',' || to_y as walk1 from creature where id = :'cid' \gset
-- The same row, walked forward again: the legs are a hash, not a roll.
delete from creature where world_id = :'world2' and id = :'cid';
insert into creature select * from snap;
update creature set until = until - interval '30 seconds', leg_at = leg_at - interval '30 seconds',
    leg_ends = leg_ends - interval '30 seconds', settled_at = settled_at - interval '30 seconds' where id = :'cid';
select creature_settle(:'world2', :'cid') \g /dev/null
select '126. the same row walked forward again: ' ||
       case when (select to_x || ',' || to_y from creature where id = :'cid') = :'walk1'
            then 'the same place' else 'SOMEWHERE ELSE' end;
-- Mid-leg, it is neither at one end nor the other.
update creature set from_x = 4, from_y = 4, to_x = 8, to_y = 4,
    leg_at = now() - interval '2 seconds', leg_ends = now() + interval '2 seconds', until = now() + interval '5 seconds'
  where id = :'cid';
select '127. halfway along a leg from 4,4 to 8,4: ' || round(creature_x(c)::numeric, 1) || ',' || round(creature_y(c)::numeric, 1)
  from creature c where id = :'cid';
update creature set leg_at = now() - interval '9 seconds', leg_ends = now() - interval '5 seconds' where id = :'cid';
select '128. and once the leg is over it stays put: ' || round(creature_x(c)::numeric, 1) || ',' || round(creature_y(c)::numeric, 1)
  from creature c where id = :'cid';
-- An hour with nobody near it at all.
update creature set from_x = 6.8, from_y = 7.4, to_x = 6.8, to_y = 7.4, leg = 0,
    until = now() - interval '1 hour', leg_at = now() - interval '1 hour', leg_ends = now() - interval '1 hour',
    settled_at = now() - interval '1 hour', hunger = 0.8 where id = :'cid';
select creature_settle(:'world2', :'cid') \g /dev/null
select '129. an hour alone: leg ' || leg || ' (forty is as far back as anyone walks), it is at '
     || round(to_x::numeric, 1) || ',' || round(to_y::numeric, 1) || ', and it fed itself: hunger '
     || round(hunger::numeric, 2) from creature where id = :'cid';

\echo ''
\echo '--- winning one over'
update creature set from_x = 6.8, from_y = 7.4, to_x = 6.8, to_y = 7.4,
    leg_at = now(), leg_ends = now(), until = now() + interval '1 hour', settled_at = now(),
    hunger = 0.8, coaxed = 0, coaxed_at = null where id = :'cid';
delete from event where uid = :'ivar';
delete from item where holder_uid = :'ivar' and def in (select item from species_diet where species = 'rabba');
select act_perform(:'world2', :'ivar', 'examine_creature', ('{"kind":"creature","id":' || :'cid' || '}')::jsonb) \g /dev/null
select '130. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
select '131. with an empty hand: ' || coalesce(act_refusal(:'world2', :'ivar', 'tame', ('{"kind":"creature","id":' || :'cid' || '}')::jsonb), 'allowed');
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'blueberry', 30, 20);
select '132. with berries: ' || coalesce(act_refusal(:'world2', :'ivar', 'tame', ('{"kind":"creature","id":' || :'cid' || '}')::jsonb), 'allowed')
     || ' | across the island: ' || coalesce(act_refusal(:'world2', :'ivar', 'tame', ('{"kind":"creature","id":' || (select id from creature where world_id = :'world2' and id <> :'cid' and greatest(abs(to_x - 6.5), abs(to_y - 7.5)) > 4 order by id limit 1) || '}')::jsonb), 'allowed');
select '133. the odds as they stand: ' || round((select tame_chance(:'world2', :'ivar', c) * 100 from creature c where id = :'cid')::numeric, 1)
     || '% — and hungry, at taming 60, with three offerings already taken:';
update skill set value = 60 where uid = :'ivar' and id = 'taming';
insert into skill (world_id, uid, id, value) select :'world2', :'ivar', 'taming', 60 where not exists (select 1 from skill where uid = :'ivar' and id = 'taming');
update creature set hunger = 0.2, coaxed = 3, coaxed_at = now() where id = :'cid';
select '     ' || round((select tame_chance(:'world2', :'ivar', c) * 100 from creature c where id = :'cid')::numeric, 1) || '%';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'tame', ('{"kind":"creature","id":' || :'cid' || '}')::jsonb) \g /dev/null
select '134. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind in ('system','event'))
     || ' — it is ' || (select mode from creature where id = :'cid');
update creature set mode = 'active', keeper = :'ivar', stance = 'defensive' where id = :'cid';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'feed', ('{"kind":"creature","id":' || :'cid' || '}')::jsonb) \g /dev/null
select '135. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — belly ' || (select round(hunger::numeric, 2) from creature where id = :'cid');
select '136. brushing it with nothing in hand: ' || coalesce(act_refusal(:'world2', :'ivar', 'groom', ('{"kind":"creature","id":' || :'cid' || '}')::jsonb), 'allowed');
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'brush', 60, 1);
delete from event where uid = :'ivar';
do $$
declare w uuid := (select id from world limit 1); me uuid := '11111111-1111-1111-1111-111111111111';
        c int := (select max(id) from creature where species = 'rabba'); i int;
begin
  for i in 1..4 loop
    exit when act_refusal(w, me, 'groom', jsonb_build_object('kind', 'creature', 'id', c)) is not null;
    perform act_perform(w, me, 'groom', jsonb_build_object('kind', 'creature', 'id', c));
  end loop;
end $$;
select '137. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'event');
select '138. and once it shines: ' || coalesce(act_refusal(:'world2', :'ivar', 'groom', ('{"kind":"creature","id":' || :'cid' || '}')::jsonb), 'allowed');
select '139. a rabba carries no fleece: ' || coalesce(act_refusal(:'world2', :'ivar', 'shear', ('{"kind":"creature","id":' || :'cid' || '}')::jsonb), 'allowed');

-- Something with a coat on it, and something with milk in it.
select creature_spawn(:'world2', 'woola', 6.6, 7.6, 'deed', now() - interval '3 hours', :'ivar') as woola \gset
update creature set fleece = 1, sex = 'female' where id = :'woola';
delete from event where uid = :'ivar';
select '140. shearing with bare hands: ' || coalesce(act_refusal(:'world2', :'ivar', 'shear', ('{"kind":"creature","id":' || :'woola' || '}')::jsonb), 'allowed');
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'carving_knife', 40, 1);
select act_perform(:'world2', :'ivar', 'shear', ('{"kind":"creature","id":' || :'woola' || '}')::jsonb) \g /dev/null
select '141. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
select '142. straight away again: ' || coalesce(act_refusal(:'world2', :'ivar', 'shear', ('{"kind":"creature","id":' || :'woola' || '}')::jsonb), 'allowed');
update creature set fleece = 0.9 where id = :'woola';
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'bucket', 40, 1);
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'milk_creature', ('{"kind":"creature","id":' || :'woola' || '}')::jsonb) \g /dev/null
select '143. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — and there is ' || (select coalesce(sum(count),0) from item where holder_uid = :'ivar' and def = 'milk_bucket') || ' bucket of milk in the pack';
update creature set sex = 'male', fleece = 0.9 where id = :'woola';
select '144. and the same of a male: ' || coalesce(act_refusal(:'world2', :'ivar', 'milk_creature', ('{"kind":"creature","id":' || :'woola' || '}')::jsonb), 'allowed');

-- One companion at a time, and the token keeps the rest.
delete from event where uid = :'ivar';
select '145. one at heel and one working: ' || (select count(*) from creature where keeper = :'ivar' and mode = 'active')
     || ' active, ' || (select count(*) from creature where keeper = :'ivar' and mode = 'deed') || ' on the deed';
select act_perform(:'world2', :'ivar', 'take_creature', ('{"kind":"creature","id":' || :'woola' || '}')::jsonb) \g /dev/null
select '146. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind in ('info','system'))
     || ' — at heel ' || (select count(*) from creature where keeper = :'ivar' and mode = 'active')
     || ', at the token ' || (select count(*) from creature where keeper = :'ivar' and mode = 'stored');
select act_perform(:'world2', :'ivar', 'take_creature', ('{"kind":"creature","id":' || :'cid' || '}')::jsonb) \g /dev/null
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'rename_creature', ('{"kind":"creature","id":' || :'cid' || ',"name":"Thump"}')::jsonb) \g /dev/null
select act_perform(:'world2', :'ivar', 'set_stance', ('{"kind":"creature","id":' || :'cid' || ',"stance":"aggressive"}')::jsonb) \g /dev/null
select '147. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar');
select '148. a companion stands where its keeper stands: ' ||
  (select case when round(creature_x(c)::numeric, 1) = 6.5 and round(creature_y(c)::numeric, 1) = 7.5
          then 'yes' else round(creature_x(c)::numeric,1) || ',' || round(creature_y(c)::numeric,1) end
   from creature c where id = :'cid');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'release_creature', ('{"kind":"creature","id":' || :'cid' || '}')::jsonb) \g /dev/null
select '149. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — it is ' || (select mode || ', called ' || name || ', keeper ' || coalesce(keeper::text, 'nobody') from creature where id = :'cid');
select '150. a monster is not a wildermon: ' || coalesce(act_refusal(:'world2', :'ivar', 'tame',
       ('{"kind":"creature","id":' || (select creature_spawn(:'world2', 'goblin', 6.9, 7.2, 'wild')) || '}')::jsonb), 'allowed');
\echo ''
\echo '--- and through the front door'
delete from event where uid = :'ivar';
select rpc_act(:'world2', 'examine_creature', ('{"kind":"creature","id":' || :'cid' || '}')::jsonb) as looked \gset
select '151. examining through rpc_act, which takes no time: done=' || coalesce((:'looked'::jsonb->>'done'), 'no')
     || ' — ' || coalesce((select text from event where uid = :'ivar' order by n desc limit 1), 'nothing said');
select '152. what is around us: ' || jsonb_array_length(rpc_creatures(:'world2', 6)) || ' within six tiles, '
     || jsonb_array_length(rpc_creatures(:'world2', 200)) || ' on the whole island';
select rpc_creatures(:'world2', 3) as near \gset
select '153. the nearest of them: ' || coalesce((:'near'::jsonb->0->>'species'), 'nothing')
     || ' at ' || coalesce(round((:'near'::jsonb->0->>'x')::numeric, 1)::text, '-')
     || ',' || coalesce(round((:'near'::jsonb->0->>'y')::numeric, 1)::text, '-')
     || ', ours: ' || coalesce((:'near'::jsonb->0->>'mine'), '-');
-- Everything on the island moves because somebody looked at it.
update creature set until = until - interval '5 minutes', leg_at = leg_at - interval '5 minutes',
    leg_ends = leg_ends - interval '5 minutes', settled_at = settled_at - interval '5 minutes'
  where world_id = :'world2' and mode = 'wild';
select '154. five minutes on, ' || (select count(*) from creature where world_id = :'world2' and now() - until > interval '30 seconds')
     || ' of them are a good way behind the clock';
select creature_sweep(:'world2', 6.5, 7.5, 200) as swept \gset
/*
 * "Still behind" is not a number worth chasing to nought: a creature whose
 * next leg falls due in two seconds is behind the clock two seconds later,
 * which is what being alive looks like. What matters is that none of them is
 * *minutes* behind any more.
 */
select '155. one look walks ' || :'swept' || ' of them forward, and '
     || (select count(*) from creature where world_id = :'world2' and now() - until > interval '30 seconds')
     || ' are still a good way behind';

set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select '156. Hild can see the wildlife: ' || (select count(*) from creature);
do $$ begin
  begin update creature set health = 1; raise notice '157. and strike it from her chair:  ALLOWED';
  exception when others then raise notice '157. and strike it from her chair:  refused — %', sqlerrm; end;
  begin update creature set keeper = auth.uid(), mode = 'active';
        raise notice '158. help herself to somebody''s pet: ALLOWED';
  exception when others then raise notice '158. help herself to somebody''s pet: refused — %', sqlerrm; end;
  begin perform creature_settle((select id from world limit 1), 1);
        raise notice '159. walk one forward by hand:      ALLOWED';
  exception when others then raise notice '159. walk one forward by hand:      refused — %', sqlerrm; end;
end $$;
reset role;
select '160. and it is all still Ivar''s: ' || (select count(*) from creature where keeper = :'ivar')
     || ' of them, and nothing is hurt: ' || (select count(*) from creature where health < 1);
\echo ''
\echo '--- what it is made of, which until now it was not'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
delete from event where uid = :'ivar';
update player set x = 8.5, y = 8.5, level = 0, wounds = '[]',
    stats = '{"health":1,"stamina":1,"hunger":1,"thirst":1}'::jsonb, equipped = '{}'::jsonb,
    act = null, act_target = null, act_started = null, act_ends = null, act_left = null, act_queue = '[]'
  where uid = :'ivar';
select '161. the materials, keyed by their own names at last: '
     || (select string_agg(id || ' edge ' || edge, ', ' order by id) from material_def where id in ('pine','oak','steel','silver'))
     || ' | a silver edge bites the unnatural: ' || mat_bane('Silver') || ', a steel one: ' || mat_bane('Steel');
insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (:'world2', 'player', :'ivar', 'sword', 60, 1, 'Steel')
  returning id as sword \gset
select '162. a steel sword in these hands: ' || round(weapon_damage(:'world2', :'ivar', (select w from weapon_def w where id = 'sword'), (select i from item i where i.id = :'sword'))::numeric, 2);
update item set extra = 'Copper' where id = :'sword';
select '163. the same sword in copper:     ' || round(weapon_damage(:'world2', :'ivar', (select w from weapon_def w where id = 'sword'), (select i from item i where i.id = :'sword'))::numeric, 2)
     || ' — edge 1.28 against 0.85, and both of them were silently 1 before today';
update item set extra = 'Steel' where id = :'sword';

\echo ''
\echo '--- a sword, a rabba, and what they do to each other'
select '164. empty hands reach ' || melee_reach(:'world2', :'ivar') || ' tiles; taking the sword up: '
     || coalesce(act_refusal(:'world2', :'ivar', 'equip', ('{"kind":"item","uid":' || :'sword' || '}')::jsonb), 'allowed');
select act_perform(:'world2', :'ivar', 'equip', ('{"kind":"item","uid":' || :'sword' || '}')::jsonb) \g /dev/null
select '165. in hand: ' || (worn(:'world2', :'ivar', 'weapon')).def || ' of ' || (worn(:'world2', :'ivar', 'weapon')).extra
     || ', and taking it up again: ' || coalesce(act_refusal(:'world2', :'ivar', 'equip', ('{"kind":"item","uid":' || :'sword' || '}')::jsonb), 'allowed');
insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (:'world2', 'player', :'ivar', 'wooden_shield', 40, 1, 'Oak')
  returning id as shield \gset
select act_perform(:'world2', :'ivar', 'equip', ('{"kind":"item","uid":' || :'shield' || '}')::jsonb) \g /dev/null
insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (:'world2', 'player', :'ivar', 'long_sword', 55, 1, 'Steel')
  returning id as twohand \gset
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'equip', ('{"kind":"item","uid":' || :'twohand' || '}')::jsonb) \g /dev/null
select '166. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'info')
     || ' — off hand now holds ' || coalesce((select def from item where id = (select (equipped->>'offhand')::bigint from player where uid = :'ivar')), 'nothing');
select '167. and a shield back on top of it: ' || coalesce(act_refusal(:'world2', :'ivar', 'equip', ('{"kind":"item","uid":' || :'shield' || '}')::jsonb), 'allowed');
select act_perform(:'world2', :'ivar', 'equip', ('{"kind":"item","uid":' || :'sword' || '}')::jsonb) \g /dev/null

select creature_spawn(:'world2', 'rabba', 8.8, 8.4, 'wild', now() - interval '2 hours') as prey \gset
select '168. a rabba at arm''s length: ' || coalesce(act_refusal(:'world2', :'ivar', 'attack_creature', ('{"kind":"creature","id":' || :'prey' || '}')::jsonb), 'allowed')
     || ' | one across the island: ' || coalesce(act_refusal(:'world2', :'ivar', 'attack_creature', ('{"kind":"creature","id":' || (select id from creature where world_id = :'world2' and mode = 'wild' and greatest(abs(to_x - 8.5), abs(to_y - 8.5)) > 6 order by id limit 1) || '}')::jsonb), 'allowed');
select '169. and one of ours: ' || coalesce(act_refusal(:'world2', :'ivar', 'attack_creature', ('{"kind":"creature","id":' || :'woola' || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
do $$
declare w uuid := (select id from world limit 1); me uuid := '11111111-1111-1111-1111-111111111111';
        c int := (select max(id) from creature where species = 'rabba'); i int;
begin
  for i in 1..12 loop
    exit when act_refusal(w, me, 'attack_creature', jsonb_build_object('kind', 'creature', 'id', c)) is not null;
    perform act_perform(w, me, 'attack_creature', jsonb_build_object('kind', 'creature', 'id', c));
  end loop;
end $$;
select '170. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar');
select '171. it is gone: ' || (select count(*) from creature where id = :'prey')
     || ', and there is a corpse at 8,8: ' || (select count(*) from item where def = 'corpse' and gx = 8 and gy = 8)
     || ' — the sword has taken ' || (select round(dmg::numeric, 2) from item where id = :'sword') || ' damage';
-- Some things always get their swipe in, rather than one swing in three.
select creature_spawn(:'world2', 'crawler', 8.7, 8.6, 'wild', now() - interval '2 hours') as biter \gset
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'attack_creature', ('{"kind":"creature","id":' || :'biter' || '}')::jsonb) \g /dev/null
select '172. a crawler is a defensive sort: ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar');

\echo ''
\echo '--- and what it left on you'
select '173. carrying: ' || coalesce((select string_agg(wound_text(x.value), ' | ') from player p, jsonb_array_elements(p.wounds) x where p.uid = :'ivar'), 'nothing')
     || ' — health ' || (select round(((stats->>'health')::numeric), 3) from player where uid = :'ivar');
-- Two minutes on the floor with nobody looking at you.
update player set wounds = '[{"kind":"cut","part":"arms","severity":0.12,"bleeding":true,"infected":false,"dressing":null}]'::jsonb,
    stats = jsonb_set(jsonb_set(stats, '{health}', '0.8'), '{hurtSettled}', to_jsonb(now() - interval '120 seconds'))
  where uid = :'ivar';
select '174. a bleeding cut loses ' || round((select sum(wound_drain(x.value)) from player p, jsonb_array_elements(p.wounds) x where p.uid = :'ivar')::numeric, 5) || ' of a life a second';
select wounds_settle(:'world2', :'ivar') \g /dev/null
select '175. two minutes of it, settled in one go: health ' || (select round(((stats->>'health')::numeric), 3) from player where uid = :'ivar')
     || ', and it is ' || coalesce((select string_agg(wound_text(x.value), ' | ') from player p, jsonb_array_elements(p.wounds) x where p.uid = :'ivar'), 'closed over');
/*
 * The browser rolls the chance a wound turns once a second. There is no second
 * here, so the odds over the whole stretch are rolled once: 1 - (1 - p)^secs.
 * Ten minutes of a bare cut is a third of a chance, which is why this asks for
 * it a dozen times rather than once.
 */
update player set wounds = '[{"kind":"cut","part":"arms","severity":0.05,"bleeding":true,"infected":false,"dressing":null}]'::jsonb
  where uid = :'ivar';
select '176. the chance a bare cut goes bad, per second: '
     || round((select fester_chance(x.value) from player p, jsonb_array_elements(p.wounds) x where p.uid = :'ivar' limit 1)::numeric, 6)
     || ' — over ten minutes that is '
     || round((select (1 - power(1 - fester_chance(x.value), 600)) * 100 from player p, jsonb_array_elements(p.wounds) x where p.uid = :'ivar' limit 1)::numeric, 1) || '%';
do $$
declare w uuid := (select id from world limit 1); me uuid := '11111111-1111-1111-1111-111111111111'; i int;
begin
  for i in 1..14 loop
    exit when exists (select 1 from player p, jsonb_array_elements(p.wounds) x
                      where p.uid = me and (x.value->>'infected')::boolean);
    update player set wounds = '[{"kind":"cut","part":"arms","severity":0.05,"bleeding":true,"infected":false,"dressing":null}]'::jsonb,
        stats = jsonb_set(jsonb_set(stats, '{health}', '1'), '{hurtSettled}', to_jsonb(now() - interval '600 seconds'))
      where uid = me;
    perform wounds_settle(w, me);
  end loop;
end $$;
delete from event where uid = :'ivar';
select '177. ten minutes untended: ' || coalesce((select string_agg(wound_text(x.value), ' | ') from player p, jsonb_array_elements(p.wounds) x where p.uid = :'ivar'), 'closed over');
select '178. dressing it now: ' || coalesce(act_refusal(:'world2', :'ivar', 'bind_wound', '{"kind":"item"}'), 'allowed');
select '179. scouring it out with nothing: ' || coalesce(act_refusal(:'world2', :'ivar', 'clean_wound', '{"kind":"item"}'), 'allowed');
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'lye_bucket', 80, 3);
update skill set value = 70 where uid = :'ivar' and id = 'first_aid';
insert into skill (world_id, uid, id, value) select :'world2', :'ivar', 'first_aid', 70 where not exists (select 1 from skill where uid = :'ivar' and id = 'first_aid');
do $$
declare w uuid := (select id from world limit 1); me uuid := '11111111-1111-1111-1111-111111111111'; i int;
begin
  for i in 1..3 loop
    exit when act_refusal(w, me, 'clean_wound', '{"kind":"item"}') is not null;
    perform act_perform(w, me, 'clean_wound', '{"kind":"item"}');
  end loop;
end $$;
select '180. ' || coalesce((select string_agg(text, ' | ' order by n) from event where uid = :'ivar'), 'nothing said')
     || ' — and a bucket came back: ' || (select coalesce(sum(count),0) from item where holder_uid = :'ivar' and def = 'bucket');
delete from event where uid = :'ivar';
insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (:'world2', 'player', :'ivar', 'cover', 70, 2, 'thyme');
select '181. with the right herb for a cut: ' || coalesce(act_refusal(:'world2', :'ivar', 'bind_wound', '{"kind":"item"}'), 'allowed');
select act_perform(:'world2', :'ivar', 'bind_wound', '{"kind":"item"}') \g /dev/null
select '182. ' || coalesce((select string_agg(text, ' | ' order by n) from event where uid = :'ivar'), 'nothing said')
     || ' — ' || coalesce((select string_agg(wound_text(x.value), ' | ') from player p, jsonb_array_elements(p.wounds) x where p.uid = :'ivar'), 'closed over');
-- Bled out, with nobody watching.
update player set wounds = '[{"kind":"cut","part":"chest","severity":0.4,"bleeding":true,"infected":true,"dressing":null}]'::jsonb,
    stats = jsonb_set(jsonb_set(stats, '{health}', '0.3'), '{hurtSettled}', to_jsonb(now() - interval '600 seconds')),
    x = 3.5, y = 3.5 where uid = :'ivar';
delete from event where uid = :'ivar';
select wounds_settle(:'world2', :'ivar') \g /dev/null
select '183. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'error')
     || ' — health ' || (select round(((stats->>'health')::numeric), 2) from player where uid = :'ivar')
     || ', wounds ' || (select jsonb_array_length(wounds) from player where uid = :'ivar')
     || ', standing at ' || (select round(x::numeric, 1) || ',' || round(y::numeric, 1) from player where uid = :'ivar')
     || ' which is where the island put him ashore';

\echo ''
\echo '--- a bow, and a carcass'
update player set x = 8.5, y = 8.5, wounds = '[]', stats = '{"health":1,"stamina":1,"hunger":1,"thirst":1}'::jsonb where uid = :'ivar';
select creature_spawn(:'world2', 'rabba', 13.5, 8.5, 'wild', now() - interval '2 hours') as far \gset
select '184. shooting with a sword in hand: ' || coalesce(act_refusal(:'world2', :'ivar', 'shoot_creature', ('{"kind":"creature","id":' || :'far' || '}')::jsonb), 'allowed');
insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (:'world2', 'player', :'ivar', 'long_bow', 60, 1, 'Willow')
  returning id as bow \gset
select act_perform(:'world2', :'ivar', 'equip', ('{"kind":"item","uid":' || :'bow' || '}')::jsonb) \g /dev/null
select '185. bow in hand and no arrows: ' || coalesce(act_refusal(:'world2', :'ivar', 'shoot_creature', ('{"kind":"creature","id":' || :'far' || '}')::jsonb), 'allowed');
insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (:'world2', 'player', :'ivar', 'arrow', 50, 30, 'Iron');
select '186. with a quiver: ' || coalesce(act_refusal(:'world2', :'ivar', 'shoot_creature', ('{"kind":"creature","id":' || :'far' || '}')::jsonb), 'allowed')
     || ' | at something in your face: ' || coalesce(act_refusal(:'world2', :'ivar', 'shoot_creature', ('{"kind":"creature","id":' || :'biter' || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
do $$
declare w uuid := (select id from world limit 1); me uuid := '11111111-1111-1111-1111-111111111111';
        c int := (select max(id) from creature where species = 'rabba' and to_x > 12); i int;
begin
  for i in 1..14 loop
    exit when act_refusal(w, me, 'shoot_creature', jsonb_build_object('kind', 'creature', 'id', c)) is not null;
    perform act_perform(w, me, 'shoot_creature', jsonb_build_object('kind', 'creature', 'id', c));
  end loop;
end $$;
select '187. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar')
     || ' — arrows left ' || (select coalesce(sum(count),0) from item where holder_uid = :'ivar' and def = 'arrow');
delete from event where uid = :'ivar';
select '188. butchering it: ' || coalesce(act_refusal(:'world2', :'ivar', 'butcher', '{"kind":"ground","x":13,"y":8}'), 'allowed');
select act_perform(:'world2', :'ivar', 'butcher', '{"kind":"ground","x":13,"y":8}') \g /dev/null
select '189. ' || coalesce((select string_agg(text, ' | ' order by n) from event where uid = :'ivar'), 'nothing said')
     || ' — and the carcass is gone: ' || (select count(*) from item where def = 'corpse' and gx = 13);
select '190. a knife against bare hands, at butchering 70: ' || round(butcher_yield(70, 80)::numeric, 2) || ' of a carcass against ' || round(butcher_yield(70, null)::numeric, 2);
delete from event where uid = :'ivar';
update creature set health = 1 where id = :'woola';
select '191. mending one of ours with nothing: ' || coalesce(act_refusal(:'world2', :'ivar', 'treat_creature', ('{"kind":"creature","id":' || :'woola' || '}')::jsonb), 'allowed');
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'bandage', 60, 3);
select act_perform(:'world2', :'ivar', 'treat_creature', ('{"kind":"creature","id":' || :'woola' || '}')::jsonb) \g /dev/null
select '192. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar');
\echo ''
