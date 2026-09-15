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
     || ' — a second kit would have made it twenty-four';

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
select (rpc_settle()->>'settled') as swept \gset
select '11. ' || :'swept' || ' goes settled by the sweep, and he is now '
     || coalesce((select act from player where uid = :'ivar'), 'finished');
select '    height at that corner ' || land_height(:'world', 9, 9) || ' from 100, dirt ' || land_dirt(:'world', 9, 9) || ' from 20'
     || ', and ' || (select count(*) from event where uid = :'ivar' and text like 'You dig up%') || ' of the six came off';

\echo ''
\echo '--- the numbers on things are the database''s to hand out'
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select rpc_act(:'world', 'dig', '{"x":8,"y":8,"cx":8,"cy":8}', 3) \g /dev/null
update player set act_started = act_started - interval '600 seconds', act_ends = act_ends - interval '600 seconds' where uid = :'hild';
select rpc_settle() \g /dev/null
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
from jsonb_array_elements(land_window(:'made', 3, 3)) r;
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
\echo '--- put to work'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
delete from event where uid = :'ivar';
update player set x = 5.5, y = 7.5 where uid = :'ivar';
select '193. the crate the token came with: '
     || coalesce((select 'a ' || kind || ' crate at ' || x || ',' || y || ', holding ' || crate_units(:'world2', id)
                  || ' of ' || crate_capacity(c) from crate c where world_id = :'world2' and deed), 'none');
select creature_spawn(:'world2', 'rabba', 5.5, 8.5, 'stored', now() - interval '3 hours', :'ivar') as forager \gset
select creature_spawn(:'world2', 'ulva', 5.5, 6.5, 'stored', now() - interval '3 hours', :'ivar') as guard \gset
select creature_spawn(:'world2', 'bevere', 4.5, 8.5, 'stored', now() - interval '3 hours', :'ivar') as feller \gset
select '194. a rabba forages, an ulva keeps watch, a bevere fells trees — and of the three this island knows '
     || (select count(*) from (values ('forage'), ('guard'), ('woodcut')) v(k) where worker_job_ported(v.k)) || ' trades';
select '195. setting the ulva to watch: ' || coalesce(act_refusal(:'world2', :'ivar', 'assign_deed', ('{"kind":"creature","id":' || :'guard' || '}')::jsonb), 'allowed');
select '196. something wild: ' || coalesce(act_refusal(:'world2', :'ivar', 'assign_deed', ('{"kind":"creature","id":' || (select id from creature where world_id = :'world2' and mode = 'wild' order by id limit 1) || '}')::jsonb), 'allowed');
select act_perform(:'world2', :'ivar', 'assign_deed', ('{"kind":"creature","id":' || :'forager' || '}')::jsonb) \g /dev/null
select '197. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
select '198. on the books now: ' || workers_on_deed(:'world2') || ' of ' || worker_cap(:'world2')
     || ' at deed level ' || (select level from deed where world_id = :'world2')
     || ' — so a second: ' || coalesce(act_refusal(:'world2', :'ivar', 'assign_deed', ('{"kind":"creature","id":' || :'feller' || '}')::jsonb), 'allowed');
update deed set level = 3, radius = deed_radius(3) where world_id = :'world2';
select '199. and at level three: ' || coalesce(act_refusal(:'world2', :'ivar', 'assign_deed', ('{"kind":"creature","id":' || :'feller' || '}')::jsonb), 'allowed');

-- Half an hour of it, with nobody watching at all.
update creature set until = until - interval '1800 seconds', leg_at = leg_at - interval '1800 seconds',
    leg_ends = leg_ends - interval '1800 seconds', settled_at = settled_at - interval '1800 seconds'
  where id = :'forager';
select worker_settle(:'world2', :'forager') as trips \gset
select '200. half an hour nobody watched: ' || :'trips' || ' rounds of it, and its foraging went from 1 to '
     || (select round(((skills->>'foraging')::numeric), 2) from creature where id = :'forager');
select '201. in the crate: ' || coalesce((select string_agg(def || ' ×' || count, ', ' order by def)
       from item where world_id = :'world2' and holder = 'crate'), 'nothing')
     || ' — and it is ' || (select phase from creature where id = :'forager')
     || ', carrying ' || coalesce((select carrying->>'def' from creature where id = :'forager'), 'nothing');
select '202. the beds it went over are picked clean for now: '
     || (select count(*) from foraged where world_id = :'world2' and kind = 'forage') || ' of them';

\echo ''
\echo '--- a woodcutter, and one tile to one worker'
-- A stand of oaks inside the deed for it to work.
do $$
declare w uuid := (select id from world limit 1); i int; j int;
begin
  for j in 9..11 loop
    for i in 2..5 loop
      perform land_set_tile(w, i, j, tile_id('Tree'));
      -- Species 1, old: its own logs and one more for its age.
      perform land_set_data(w, i, j, 1 + (2 << 4));
    end loop;
  end loop;
end $$;
select act_perform(:'world2', :'ivar', 'assign_deed', ('{"kind":"creature","id":' || :'feller' || '}')::jsonb) \g /dev/null
select '203. trees standing inside the deed: ' || (select count(*) from generate_series(0,15) gx, generate_series(0,15) gy where land_tile(:'world2', gx, gy) = tile_id('Tree'));
update creature set until = until - interval '1200 seconds', leg_at = leg_at - interval '1200 seconds',
    leg_ends = leg_ends - interval '1200 seconds', settled_at = settled_at - interval '1200 seconds'
  where id = :'feller';
select worker_settle(:'world2', :'feller') as fells \gset
select '204. twenty minutes of felling: ' || :'fells' || ' rounds, and ' || (select count(*) from generate_series(0,15) gx, generate_series(0,15) gy where land_tile(:'world2', gx, gy) = tile_id('Tree')) || ' trees left standing';
select '205. logs in the crate: ' || coalesce((select sum(count)::text from item where world_id = :'world2' and holder = 'crate' and def = 'log'), '0')
     || ', and the rest of each tree waiting at its stump: '
     || coalesce((select sum(count)::text from item where world_id = :'world2' and holder = 'ground' and def = 'log'), '0')
     || ' — it can only carry one at a time';
-- Two workers never walk to the same tile.
update creature set phase = 'out', work_x = 3, work_y = 10 where id = :'feller';
select '206. a tile another worker is walking to: ' || claimed(:'world2', 3, 10, :'forager')
     || ', and the same tile to the worker walking to it: ' || claimed(:'world2', 3, 10, :'feller');
update creature set phase = 'idle', work_x = null, work_y = null where id = :'feller';
-- A full crate is a reason to hold on to a load, not to tip it out.
insert into item (world_id, holder, crate, gx, gy, def, ql, count)
select :'world2', 'crate', c.id, c.x, c.y, 'rock_shards', 20, crate_capacity(c) - crate_units(:'world2', c.id)
from crate c where c.world_id = :'world2' and c.deed;
select '207. the crate is ' || (select crate_units(:'world2', id) || ' of ' || crate_capacity(c) from crate c where world_id = :'world2' and deed) || ' now';
update creature set until = until - interval '300 seconds', leg_at = leg_at - interval '300 seconds',
    leg_ends = leg_ends - interval '300 seconds', settled_at = settled_at - interval '300 seconds'
  where id = :'forager';
select worker_settle(:'world2', :'forager') \g /dev/null
select '208. five more minutes against a full crate: it is holding '
     || coalesce((select carrying->>'def' from creature where id = :'forager'), 'nothing')
     || ', and the crate is still ' || (select crate_units(:'world2', id) from crate c where world_id = :'world2' and deed)
     || ' — a worker will not tip a load out on the ground';
delete from item where world_id = :'world2' and holder = 'crate' and def = 'rock_shards';

\echo ''
\echo '--- and what a client may do to the stores'
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select '209. Hild can see what is in the crate: ' || (select count(*) from item where holder = 'crate');
do $$ begin
  begin update item set holder = 'player', holder_uid = auth.uid() where holder = 'crate';
        raise notice '210. and help herself to it:        ALLOWED';
  exception when others then raise notice '210. and help herself to it:        refused — %', sqlerrm; end;
  begin insert into crate (world_id, id, kind, x, y) values ((select id from world limit 1), 99, 'plank', 1, 1);
        raise notice '211. and stand a crate of her own:  ALLOWED';
  exception when others then raise notice '211. and stand a crate of her own:  refused — %', sqlerrm; end;
  begin perform worker_settle((select id from world limit 1), 1);
        raise notice '212. and work somebody else''s beast: ALLOWED';
  exception when others then raise notice '212. and work somebody else''s beast: refused — %', sqlerrm; end;
end $$;
reset role;
select '213. and it is all still in the crate: ' || (select coalesce(sum(count), 0) from item where world_id = :'world2' and holder = 'crate');
\echo ''
\echo '--- crates, and the beast that fills them'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
delete from event where uid = :'ivar';
update player set x = 4.5, y = 7.5 where uid = :'ivar';
select '214. setting one down with nothing in hand: ' || coalesce(act_refusal(:'world2', :'ivar', 'place_crate', '{"kind":"tile","x":4,"y":7,"sx":1,"sy":1}'), 'allowed');
insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (:'world2', 'player', :'ivar', 'crate_log', 20, 2, 'Oak')
  returning id as boxes \gset
select '215. with a log crate in hand: ' || coalesce(act_refusal(:'world2', :'ivar', 'place_crate', ('{"kind":"tile","x":4,"y":7,"sx":1,"sy":1,"itemUid":' || :'boxes' || '}')::jsonb), 'allowed')
     || ' | on the token: ' || coalesce(act_refusal(:'world2', :'ivar', 'place_crate', ('{"kind":"tile","x":5,"y":7,"sx":1,"sy":1,"itemUid":' || :'boxes' || '}')::jsonb), 'allowed')
     || ' | out in the water: ' || coalesce(act_refusal(:'world2', :'ivar', 'place_crate', ('{"kind":"tile","x":4,"y":3,"sx":1,"sy":1,"itemUid":' || :'boxes' || '}')::jsonb), 'allowed');
select act_perform(:'world2', :'ivar', 'place_crate', ('{"kind":"tile","x":4,"y":7,"sx":1,"sy":1,"itemUid":' || :'boxes' || '}')::jsonb) \g /dev/null
select '216. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — an oak log crate holds ' || (select crate_capacity(c) from crate c where world_id = :'world2' and x = 4 and y = 7)
     || ', where a plain one holds 30';
select '217. and another on the same spot: ' || coalesce(act_refusal(:'world2', :'ivar', 'place_crate', ('{"kind":"tile","x":4,"y":7,"sx":1,"sy":1,"itemUid":' || :'boxes' || '}')::jsonb), 'allowed');
select id as box from crate where world_id = :'world2' and x = 4 and y = 7 \gset

delete from event where uid = :'ivar';
insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (:'world2', 'player', :'ivar', 'log', 45, 12, 'Pine')
  returning id as pine \gset
select '218. stowing a dozen pine logs: ' || coalesce(act_refusal(:'world2', :'ivar', 'store_in_crate', ('{"kind":"item","uid":' || :'pine' || ',"count":12}')::jsonb), 'allowed');
select act_perform(:'world2', :'ivar', 'store_in_crate', ('{"kind":"item","uid":' || :'pine' || ',"count":12}')::jsonb) \g /dev/null
select '219. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — the crate holds ' || crate_units(:'world2', :'box') || ', the pack holds '
     || (select coalesce(sum(count),0) from item where holder_uid = :'ivar' and def = 'log' and extra = 'Pine');
insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (:'world2', 'player', :'ivar', 'log', 45, 40, 'Pine')
  returning id as more \gset
select '220. forty more into a crate with room for twenty-two: ' || coalesce(act_refusal(:'world2', :'ivar', 'store_in_crate', ('{"kind":"item","uid":' || :'more' || ',"count":40}')::jsonb), 'allowed');
select '221. and a crate inside a crate: ' || coalesce(act_refusal(:'world2', :'ivar', 'store_in_crate', ('{"kind":"item","uid":' || :'boxes' || ',"count":1}')::jsonb), 'allowed');
update player set x = 12.5, y = 12.5 where uid = :'ivar';
select '222. from across the deed: ' || coalesce(act_refusal(:'world2', :'ivar', 'store_in_crate', ('{"kind":"item","uid":' || :'more' || ',"count":1}')::jsonb), 'allowed')
     || ' | and emptying it from there: ' || coalesce(act_refusal(:'world2', :'ivar', 'crate_take_all', ('{"kind":"crate","id":' || :'box' || '}')::jsonb), 'allowed');
update player set x = 4.5, y = 7.5 where uid = :'ivar';
select '223. lifting a crate with logs in it: ' || coalesce(act_refusal(:'world2', :'ivar', 'pick_up_crate', ('{"kind":"crate","id":' || :'box' || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'crate_take_all', ('{"kind":"crate","id":' || :'box' || '}')::jsonb) \g /dev/null
select '224. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
select '225. now: ' || coalesce(act_refusal(:'world2', :'ivar', 'crate_take_all', ('{"kind":"crate","id":' || :'box' || '}')::jsonb), 'allowed')
     || ' | and lifting it: ' || coalesce(act_refusal(:'world2', :'ivar', 'pick_up_crate', ('{"kind":"crate","id":' || :'box' || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'pick_up_crate', ('{"kind":"crate","id":' || :'box' || '}')::jsonb) \g /dev/null
select '226. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — crates standing: ' || (select count(*) from crate where world_id = :'world2')
     || ', crates in the pack: ' || (select coalesce(sum(count),0) from item where holder_uid = :'ivar' and def = 'crate_log');

\echo ''
\echo '--- and a magga, which tidies up'
select '227. logs lying at the stumps: ' || coalesce((select sum(count)::text from item where world_id = :'world2' and holder = 'ground' and def = 'log'), '0');
select creature_spawn(:'world2', 'magga', 5.5, 8.5, 'stored', now() - interval '3 hours', :'ivar') as tidier \gset
select '228. a magga clears up: ' || coalesce(act_refusal(:'world2', :'ivar', 'assign_deed', ('{"kind":"creature","id":' || :'tidier' || '}')::jsonb), 'allowed');
select act_perform(:'world2', :'ivar', 'assign_deed', ('{"kind":"creature","id":' || :'tidier' || '}')::jsonb) \g /dev/null
-- Room in the settlement's crate for what it brings in.
delete from item where world_id = :'world2' and holder = 'crate';
update creature set until = until - interval '900 seconds', leg_at = leg_at - interval '900 seconds',
    leg_ends = leg_ends - interval '900 seconds', settled_at = settled_at - interval '900 seconds'
  where id = :'tidier';
select worker_settle(:'world2', :'tidier') as tidied \gset
select '229. fifteen minutes of it: ' || :'tidied' || ' rounds, ' ||
       coalesce((select sum(count)::text from item where world_id = :'world2' and holder = 'ground' and def = 'log'), '0')
     || ' logs still at the stumps, and ' ||
       coalesce((select sum(count)::text from item where world_id = :'world2' and holder = 'crate' and def = 'log'), '0')
     || ' of them in the deed crate';
\echo ''
\echo '--- a kiln, and the queue it works through'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
delete from event where uid = :'ivar';
update player set x = 8.5, y = 8.5 where uid = :'ivar';
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'kiln', 55, 1)
  returning id as kit \gset
select '230. a brick takes ' || round(fire_seconds('unfired_clay_brick', 55)) || ' seconds in a QL 55 kiln, '
     || round(fire_seconds('unfired_clay_brick', 20)) || ' in a rough one, and comes out at QL '
     || round(fired_ql(60, 55)::numeric, 1) || ' from QL 60 green ware';
select '231. setting it down: ' || coalesce(act_refusal(:'world2', :'ivar', 'place_kiln', ('{"kind":"tile","x":8,"y":8,"sx":0,"sy":0,"uid":' || :'kit' || '}')::jsonb), 'allowed');
select act_perform(:'world2', :'ivar', 'place_kiln', ('{"kind":"tile","x":8,"y":8,"sx":0,"sy":0,"uid":' || :'kit' || '}')::jsonb) \g /dev/null
select coalesce(max(id), 0) as kiln from placed where world_id = :'world2' and kind = 'kiln' \gset
select '232. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — it holds ' || furnace_capacity('kiln') || ' pieces at once';
delete from event where uid = :'ivar';
select '233. packing it with nothing to pack: ' || coalesce(act_refusal(:'world2', :'ivar', 'load_kiln', ('{"kind":"kiln","id":' || :'kiln' || '}')::jsonb), 'allowed');
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'unfired_clay_brick', 60, 8);
insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (:'world2', 'player', :'ivar', 'log', 40, 6, 'Pine');
select act_perform(:'world2', :'ivar', 'load_kiln', ('{"kind":"kiln","id":' || :'kiln' || ',"count":8}')::jsonb) \g /dev/null
select '234. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
select '235. lighting a kiln with a cold firebox: ' || coalesce(act_refusal(:'world2', :'ivar', 'light_kiln', ('{"kind":"kiln","id":' || :'kiln' || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'fuel_kiln', ('{"kind":"kiln","id":' || :'kiln' || '}')::jsonb) \g /dev/null
select act_perform(:'world2', :'ivar', 'light_kiln', ('{"kind":"kiln","id":' || :'kiln' || '}')::jsonb) \g /dev/null
select '236. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar');
select '237. and nothing out of it yet: ' || coalesce(act_refusal(:'world2', :'ivar', 'kiln_take_all', ('{"kind":"kiln","id":' || :'kiln' || '}')::jsonb), 'allowed');
/*
 * The budget, spent in order. Two hundred seconds go by, but there are only
 * six hundred of fuel in it and each brick wants twenty-three: what comes out
 * is what the arithmetic says came out, in one pass, with nobody there.
 */
select '238. fuel in it: ' || round((select fuel from placed where id = :'kiln')::numeric) || ' seconds';
update placed set since = since - interval '200 seconds' where id = :'kiln';
select furnace_settle(:'world2', :'kiln') as fired \gset
select '239. two hundred seconds of it, nobody watching: ' || :'fired' || ' bricks fired, '
     || (select jsonb_array_length(state->'jobs') from placed where id = :'kiln') || ' still in the kiln, '
     || round((select fuel from placed where id = :'kiln')::numeric) || ' seconds of fuel left';
-- And the other half of a budget: one that runs out part way down the list.
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'unfired_clay_bowl', 60, 6);
select act_perform(:'world2', :'ivar', 'load_kiln', ('{"kind":"kiln","id":' || :'kiln' || ',"count":6}')::jsonb) \g /dev/null
update placed set fuel = 100, lit = true, since = now() - interval '600 seconds' where id = :'kiln';
select furnace_settle(:'world2', :'kiln') as part \gset
select '240. six bowls at ' || round(fire_seconds('unfired_clay_bowl', 55)) || ' seconds each, against a hundred of fuel: '
     || :'part' || ' came out, ' || (select jsonb_array_length(state->'jobs') from placed where id = :'kiln')
     || ' left inside, and the kiln is ' || (select case when lit then 'still burning' else 'cold' end from placed where id = :'kiln');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'kiln_take_all', ('{"kind":"kiln","id":' || :'kiln' || '}')::jsonb) \g /dev/null
select '241. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
select '242. bricks in the pack: ' || (select coalesce(sum(count),0) from item where holder_uid = :'ivar' and def = 'clay_brick')
     || ' at QL ' || (select round(max(ql)::numeric, 1) from item where holder_uid = :'ivar' and def = 'clay_brick')
     || ', and the kiln is empty of finished work: ' || coalesce(act_refusal(:'world2', :'ivar', 'kiln_take_all', ('{"kind":"kiln","id":' || :'kiln' || '}')::jsonb), 'allowed');

\echo ''
\echo '--- and the smelter, which takes its time by the metal'
select '243. copper takes ' || round(smelt_seconds('copper', 40, 50)) || ' seconds of heat, iron '
     || round(smelt_seconds('iron', 40, 50)) || ', seryll ' || round(smelt_seconds('seryll', 40, 50))
     || ' — and a better furnace hurries all of them: copper in a QL 90 smelter is '
     || round(smelt_seconds('copper', 40, 90));
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'smelter', 50, 1)
  returning id as skit \gset
select act_perform(:'world2', :'ivar', 'place_smelter', ('{"kind":"tile","x":8,"y":8,"sx":2,"sy":2,"uid":' || :'skit' || '}')::jsonb) \g /dev/null
select coalesce(max(id), 0) as furnace from placed where world_id = :'world2' and kind = 'smelter' \gset
delete from event where uid = :'ivar';
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'iron_ore', 40, 5)
  returning id as ore \gset
select '244. charging it with a clay brick: ' || coalesce(act_refusal(:'world2', :'ivar', 'smelt_ore', ('{"kind":"smelter","id":' || :'furnace' || ',"itemUid":' || (select id from item where holder_uid = :'ivar' and def = 'clay_brick' limit 1) || '}')::jsonb), 'allowed');
select '245. and with iron ore: ' || coalesce(act_refusal(:'world2', :'ivar', 'smelt_ore', ('{"kind":"smelter","id":' || :'furnace' || ',"itemUid":' || :'ore' || ',"count":5}')::jsonb), 'allowed');
select act_perform(:'world2', :'ivar', 'smelt_ore', ('{"kind":"smelter","id":' || :'furnace' || ',"itemUid":' || :'ore' || ',"count":5}')::jsonb) \g /dev/null
select '246. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (:'world2', 'player', :'ivar', 'log', 40, 4, 'Pine');
select act_perform(:'world2', :'ivar', 'fuel_smelter', ('{"kind":"smelter","id":' || :'furnace' || '}')::jsonb) \g /dev/null
select act_perform(:'world2', :'ivar', 'light_smelter', ('{"kind":"smelter","id":' || :'furnace' || '}')::jsonb) \g /dev/null
update placed set since = since - interval '90 seconds' where id = :'furnace';
select furnace_settle(:'world2', :'furnace') as run \gset
select '247. ninety seconds of heat: ' || :'run' || ' lumps drawn, '
     || (select jsonb_array_length(state->'jobs') from placed where id = :'furnace') || ' still charged';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'smelter_take_all', ('{"kind":"smelter","id":' || :'furnace' || '}')::jsonb) \g /dev/null
select '248. ' || (select text from event where uid = :'ivar' order by n desc limit 1);

delete from event where uid = :'ivar';
select '249. pouring an anvil with no mould: ' || coalesce(act_refusal(:'world2', :'ivar', 'cast_anvil', ('{"kind":"smelter","id":' || :'furnace' || ',"itemUid":' || (select id from item where holder_uid = :'ivar' and def = 'iron_lump' limit 1) || '}')::jsonb), 'allowed');
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'anvil_mould', 45, 1);
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'copper_lump', 50, 2);
select '250. with two lumps where it takes four: ' || coalesce(act_refusal(:'world2', :'ivar', 'cast_anvil', ('{"kind":"smelter","id":' || :'furnace' || ',"itemUid":' || (select id from item where holder_uid = :'ivar' and def = 'copper_lump' limit 1) || '}')::jsonb), 'allowed');
update item set count = 6 where holder_uid = :'ivar' and def = 'copper_lump';
select '251. and with six: ' || coalesce(act_refusal(:'world2', :'ivar', 'cast_anvil', ('{"kind":"smelter","id":' || :'furnace' || ',"itemUid":' || (select id from item where holder_uid = :'ivar' and def = 'copper_lump' limit 1) || '}')::jsonb), 'allowed');
select act_perform(:'world2', :'ivar', 'cast_anvil', ('{"kind":"smelter","id":' || :'furnace' || ',"itemUid":' || (select id from item where holder_uid = :'ivar' and def = 'copper_lump' limit 1) || '}')::jsonb) \g /dev/null
select '252. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — lumps left ' || (select coalesce(sum(count),0) from item where holder_uid = :'ivar' and def = 'copper_lump')
     || ', moulds left ' || (select coalesce(sum(count),0) from item where holder_uid = :'ivar' and def = 'anvil_mould');
update placed set fuel = 900, lit = true, since = now() - interval '600 seconds' where id = :'furnace';
select furnace_settle(:'world2', :'furnace') \g /dev/null
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'smelter_take_all', ('{"kind":"smelter","id":' || :'furnace' || '}')::jsonb) \g /dev/null
select '253. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — and it remembers what it was poured from: '
     || coalesce((select extra from item where holder_uid = :'ivar' and def = 'anvil' limit 1), 'nothing');
\echo ''
\echo '--- bettering a thing, and mending it'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
delete from event where uid = :'ivar';
update player set x = 8.5, y = 8.5, stats = '{"health":1,"stamina":1,"hunger":0.4,"thirst":0.3}'::jsonb,
    nutrition = '{}'::jsonb, boons = '[]'::jsonb where uid = :'ivar';
delete from item where holder_uid = :'ivar' and def in ('file', 'whetstone', 'iron_lump', 'copper_lump');
select '254. the kit you washed ashore with: ' || coalesce(item_refusal(:'world2', :'ivar', 'improve_item',
       ('{"kind":"item","uid":' || (select id from item where holder_uid = :'ivar' and def = 'hatchet' and issued limit 1) || '}')::jsonb), 'allowed');
insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (:'world2', 'player', :'ivar', 'hatchet', 30, 1, 'Iron')
  returning id as axe \gset
select '255. one of your own, with nothing in hand: ' || coalesce(item_refusal(:'world2', :'ivar', 'improve_item', ('{"kind":"item","uid":' || :'axe' || '}')::jsonb), 'allowed');
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'file', 50, 1), (:'world2', 'player', :'ivar', 'whetstone', 50, 1);
insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (:'world2', 'player', :'ivar', 'copper_lump', 40, 3, 'Copper');
select '256. and with the wrong metal to build it up: ' || coalesce(item_refusal(:'world2', :'ivar', 'improve_item', ('{"kind":"item","uid":' || :'axe' || '}')::jsonb), 'allowed');
insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (:'world2', 'player', :'ivar', 'iron_lump', 40, 10, 'Iron');
select '257. with iron in the pack, at blacksmithing ' || to_char(skill_of(:'world2', :'ivar', 'blacksmithing'), 'FM990.0')
     || ': ' || coalesce(item_refusal(:'world2', :'ivar', 'improve_item', ('{"kind":"item","uid":' || :'axe' || '}')::jsonb), 'allowed');
update skill set value = 45 where uid = :'ivar' and id = 'blacksmithing';
insert into skill (world_id, uid, id, value) select :'world2', :'ivar', 'blacksmithing', 45 where not exists (select 1 from skill where uid = :'ivar' and id = 'blacksmithing');
select '258. at 45 the ceiling is ' || round(improve_ceiling(:'world2', :'ivar', 'blacksmithing', null)::numeric, 1)
     || ', and a rare one would go to ' || round(improve_ceiling(:'world2', :'ivar', 'blacksmithing', 'rare')::numeric, 1)
     || ' — a rare thing has something in it the hands did not put there';
do $$
declare w uuid := (select id from world limit 1); me uuid := '11111111-1111-1111-1111-111111111111';
        c bigint := (select max(id) from item where def = 'hatchet' and not issued); i int;
begin
  for i in 1..8 loop
    exit when item_refusal(w, me, 'improve_item', jsonb_build_object('kind', 'item', 'uid', c)) is not null;
    perform perform_item(w, me, 'improve_item', jsonb_build_object('kind', 'item', 'uid', c));
  end loop;
end $$;
select '259. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar');
select '260. the hatchet is QL ' || (select round(ql::numeric, 1) from item where id = :'axe')
     || ' from 30, with ' || (select round(dmg::numeric, 1) from item where id = :'axe')
     || ' damage on it, and ' || (select coalesce(sum(count), 0) from item where holder_uid = :'ivar' and def = 'iron_lump')
     || ' lumps left of ten — a failed pass marks the piece rather than spoiling it';
-- Just past whatever the hand is worth now: the ceiling follows the skill,
-- and the skill has been climbing all the way up this section.
update item set ql = improve_ceiling(:'world2', :'ivar', 'blacksmithing', null) + 0.5, dmg = 0 where id = :'axe';
select '261. and once it is as good as the hands that made it: ' || coalesce(item_refusal(:'world2', :'ivar', 'improve_item', ('{"kind":"item","uid":' || :'axe' || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
update item set dmg = 22 where id = :'axe';
select ql as before_repair from item where id = :'axe' \gset
select '262. too knocked about to work on: ' || coalesce(item_refusal(:'world2', :'ivar', 'improve_item', ('{"kind":"item","uid":' || :'axe' || '}')::jsonb), 'allowed')
     || ' | and mending it: ' || coalesce(item_refusal(:'world2', :'ivar', 'repair_item', ('{"kind":"item","uid":' || :'axe' || '}')::jsonb), 'allowed');
do $$
declare w uuid := (select id from world limit 1); me uuid := '11111111-1111-1111-1111-111111111111';
        c bigint := (select max(id) from item where def = 'hatchet' and not issued); i int;
begin
  for i in 1..30 loop
    exit when item_refusal(w, me, 'repair_item', jsonb_build_object('kind', 'item', 'uid', c)) is not null;
    perform perform_item(w, me, 'repair_item', jsonb_build_object('kind', 'item', 'uid', c));
  end loop;
end $$;
select '263. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar')
     || ' — 22 points of damage came out, and ' || (select round(:'before_repair'::numeric - ql::numeric, 2) from item where id = :'axe')
     || ' of quality went with them';
select '264. nothing left to mend: ' || coalesce(item_refusal(:'world2', :'ivar', 'repair_item', ('{"kind":"item","uid":' || :'axe' || '}')::jsonb), 'allowed');

\echo ''
\echo '--- a meal, and what is actually in it'
delete from event where uid = :'ivar';
select '265. hunger ' || (select round(((stats->>'hunger')::numeric), 2) from player where uid = :'ivar')
     || ', thirst ' || (select round(((stats->>'thirst')::numeric), 2) from player where uid = :'ivar')
     || ', and nothing in the four';
select '266. eating a hatchet: ' || coalesce(item_refusal(:'world2', :'ivar', 'eat', ('{"kind":"item","uid":' || :'axe' || '}')::jsonb), 'allowed');
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'cheese', 70, 3)
  returning id as cheese \gset
select '267. cheese feeds ' || (select string_agg(nutrient || ' ' || amount, ', ' order by nutrient) from item_feeds where item = 'cheese')
     || ', and a QL 70 helping of it is worth ' || round(helping_of(70)::numeric, 2) || ' of that';
select act_perform(:'world2', :'ivar', 'eat', ('{"kind":"item","uid":' || :'cheese' || '}')::jsonb) \g /dev/null
select '268. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
select '269. hunger is now ' || (select round(((stats->>'hunger')::numeric), 2) from player where uid = :'ivar')
     || ', and the four read ' || (select nutrition::text from player where uid = :'ivar');
select '270. the knack it left: ' || coalesce((select string_agg(b->>'skill' || ' +' || (b->>'bonus'), ', ')
       from player p, jsonb_array_elements(p.boons) b where p.uid = :'ivar'), 'none')
     || ' — and on an island raised from a different seed, cheese would favour '
     || coalesce(boon_of(999, 'cheese'), 'nothing') || ' instead of ' || coalesce(boon_of((select seed from world where id = :'world2'), 'cheese'), 'nothing');
delete from event where uid = :'ivar';
-- A second helping pushes the hour out rather than stacking a second bonus.
select act_perform(:'world2', :'ivar', 'eat', ('{"kind":"item","uid":' || :'cheese' || '}')::jsonb) \g /dev/null
select '271. a second helping: ' || (select jsonb_array_length(boons) from player where uid = :'ivar')
     || ' knack, not two — it runs longer rather than harder';

\echo ''
\echo '--- and something to drink'
delete from event where uid = :'ivar';
update player set stats = jsonb_set(stats, '{thirst}', '0.2') where uid = :'ivar';
update player set x = 3.5, y = 4.5 where uid = :'ivar';
select '272. drinking from dry ground: ' || coalesce(act_refusal(:'world2', :'ivar', 'drink', '{"kind":"tile","x":3,"y":4}'), 'allowed')
     || ' | from the shore: ' || coalesce(act_refusal(:'world2', :'ivar', 'drink', '{"kind":"tile","x":3,"y":3}'), 'allowed');
select act_perform(:'world2', :'ivar', 'drink', '{"kind":"tile","x":3,"y":3}') \g /dev/null
select '273. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — thirst ' || (select round(((stats->>'thirst')::numeric), 2) from player where uid = :'ivar');
update player set stats = jsonb_set(stats, '{thirst}', '0.3') where uid = :'ivar';
insert into item (world_id, holder, holder_uid, def, ql, count, charges) values (:'world2', 'player', :'ivar', 'milk_bucket', 60, 1, 2)
  returning id as milk \gset
delete from event where uid = :'ivar';
select '274. a bucket of milk: ' || coalesce(item_refusal(:'world2', :'ivar', 'drink_skin', ('{"kind":"item","uid":' || :'milk' || '}')::jsonb), 'allowed');
select act_perform(:'world2', :'ivar', 'drink_skin', ('{"kind":"item","uid":' || :'milk' || '}')::jsonb) \g /dev/null
select act_perform(:'world2', :'ivar', 'drink_skin', ('{"kind":"item","uid":' || :'milk' || '}')::jsonb) \g /dev/null
select '275. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar');
select '276. and the bucket is: ' || coalesce(item_refusal(:'world2', :'ivar', 'drink_skin', ('{"kind":"item","uid":' || :'milk' || '}')::jsonb), 'allowed')
     || ' — thirst ' || (select round(((stats->>'thirst')::numeric), 2) from player where uid = :'ivar')
     || ', and the four now read ' || (select nutrition::text from player where uid = :'ivar');
\echo ''
\echo '--- the rulebook, as a client sees it'
/*
 * This is the check that was missing, and the live run had to find it instead.
 *
 * `grant select` on the definition tables was a list of five names written
 * when there were five of them. Everything generated since arrived with row
 * level security on and no way through it, and nothing here noticed because
 * almost every question in this file is asked as the owner. So: ask as a
 * client, about every table that has no `world_id` on it — which is the rule
 * the doors are set by now.
 */
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select '277. tables in the rulebook a client can read: ' || count(*) || ' of ' ||
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and not exists (select 1 from pg_attribute a where a.attrelid = c.oid
            and a.attname = 'world_id' and a.attnum > 0 and not a.attisdropped))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and not exists (select 1 from pg_attribute a where a.attrelid = c.oid
      and a.attname = 'world_id' and a.attnum > 0 and not a.attisdropped)
    and has_table_privilege('authenticated', c.oid, 'select');
select '278. and some of what is in it: ' || (select count(*) from recipe) || ' recipes, '
     || (select count(*) from species_def) || ' species, ' || (select count(*) from metal_def) || ' metals, '
     || (select count(*) from weapon_def) || ' weapons, ' || (select count(*) from improvable_def) || ' things worth bettering';
do $$ begin
  begin update item_def set weight = 0; raise notice '279. and rewriting it:            ALLOWED';
  exception when others then raise notice '279. and rewriting it:            refused — %', sqlerrm; end;
  begin insert into metal_def values ('unobtainium', 'Unobtainium', null, 'x_lump', 1, 1);
        raise notice '280. and adding a metal of her own: ALLOWED';
  exception when others then raise notice '280. and adding a metal of her own: refused — %', sqlerrm; end;
end $$;
reset role;
\echo ''
\echo '--- the errands: work done where it is found'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
delete from event where uid = :'ivar';
update player set x = 5.5, y = 7.5 where uid = :'ivar';
update deed set level = 5, radius = deed_radius(5) where world_id = :'world2';
select '281. of the eight errands this island now knows ' ||
       (select count(*) from (values ('hod'), ('mend'), ('stoke'), ('plant'), ('compost'), ('water'), ('prospect'), ('seek')) v(k)
        where worker_job_ported(v.k)) || ' — and of the rest: '
     || coalesce((select string_agg(v.k, ', ' order by v.k)
                  from (values ('water'), ('prospect'), ('seek')) v(k) where not worker_job_ported(v.k)),
                 'there is no rest');
select '282. setting a holla to carry water: ' || coalesce(act_refusal(:'world2', :'ivar', 'assign_deed',
       ('{"kind":"creature","id":' || (select creature_spawn(:'world2', 'holla', 5.5, 6.5, 'stored', now() - interval '3 hours', :'ivar')) || '}')::jsonb), 'allowed');

-- Everything the errands draw on comes out of the settlement's own crate.
delete from item where world_id = :'world2' and holder = 'crate';
insert into item (world_id, holder, crate, gx, gy, def, ql, count, extra)
select :'world2', 'crate', c.id, c.x, c.y, v.def, v.ql, v.n, v.extra
from crate c, (values ('log', 40, 20, 'Pine'), ('plank', 45, 12, 'Oak'), ('sprout', 50, 4, 'Oak')) v(def, ql, n, extra)
where c.world_id = :'world2' and c.deed;
insert into item (world_id, holder, crate, gx, gy, def, ql, count, dmg)
select :'world2', 'crate', c.id, c.x, c.y, 'shovel', 60, 1, 55 from crate c where c.world_id = :'world2' and c.deed;
select '283. in the stores: ' || (select string_agg(def || ' ×' || count, ', ' order by def) from item where world_id = :'world2' and holder = 'crate');

\echo ''
\echo '--- a stoker, which is why the furnaces are never cold'
-- Every hearth cold and its clock stamped now, so what follows is measuring
-- the stoker rather than whatever the earlier sections left burning.
update placed set fuel = 0, ash = 0, lit = false, since = now()
  where world_id = :'world2' and kind in ('campfire', 'kiln', 'smelter');
select '284. hearths burning low: ' || (select count(*) from placed where world_id = :'world2'
       and kind in ('campfire', 'smelter', 'kiln') and placed_fuel(placed) < hearth_full());
select creature_spawn(:'world2', 'embra', 5.5, 8.5, 'deed', now() - interval '3 hours', :'ivar') as stoker \gset
update creature set job = 'stoke', phase = 'idle', until = now() - interval '600 seconds',
    leg_at = now() - interval '600 seconds', leg_ends = now() - interval '600 seconds',
    settled_at = now() - interval '600 seconds' where id = :'stoker';
select worker_settle(:'world2', :'stoker') as stoked \gset
select '285. ten minutes of it: ' || :'stoked' || ' loads carried, the kiln is '
     || (select case when placed_lit(p) then 'lit with ' || round(placed_fuel(p)::numeric) || ' seconds in it'
                     else 'still cold' end from placed p where world_id = :'world2' and kind = 'kiln')
     || ', and the stores are down to ' || (select string_agg(def || ' ×' || count, ', ' order by def)
          from item where world_id = :'world2' and holder = 'crate' and fuel_value(def) is not null)
     || ' — it takes the first thing in the crate that will catch, and the logs went in first';

\echo ''
\echo '--- a hod carrier, which builds the wall you planned and walked away from'
-- A wall planned and left owing, the way they always are.
insert into wall (world_id, level, dir, x, y, building, type, material, needed, total)
values (:'world2', 0, 'h', 7, 6, 0, 'solid', 'log', '{"log": 4}'::jsonb, '{"log": 4}'::jsonb)
on conflict (world_id, level, dir, x, y) do update set needed = '{"log": 4}'::jsonb;
select '286. a wall on the deed owing ' || (select bill_text('log', needed) from wall where world_id = :'world2' and dir = 'h' and x = 7 and y = 6);
select creature_spawn(:'world2', 'cobbe', 5.5, 8.5, 'deed', now() - interval '3 hours', :'ivar') as hodder \gset
update creature set job = 'hod', phase = 'idle', until = now() - interval '600 seconds',
    leg_at = now() - interval '600 seconds', leg_ends = now() - interval '600 seconds',
    settled_at = now() - interval '600 seconds' where id = :'hodder';
select worker_settle(:'world2', :'hodder') as hodded \gset
select '287. ten minutes of the hod: ' || :'hodded' || ' pieces fitted, and the wall now owes '
     || coalesce((select bill_text('log', needed) from wall where world_id = :'world2' and dir = 'h' and x = 7 and y = 6), 'nothing')
     || ' — it is ' || (select case when bill_done(needed) then 'up' else 'still going up' end
                        from wall where world_id = :'world2' and dir = 'h' and x = 7 and y = 6);

\echo ''
\echo '--- a mender, a planter, and something to do with a carcass'
select '288. the worst thing in the stores: a shovel at ' ||
       (select round(dmg::numeric, 1) from item where world_id = :'world2' and holder = 'crate' and def = 'shovel')
     || ' damage, QL ' || (select round(ql::numeric, 1) from item where world_id = :'world2' and holder = 'crate' and def = 'shovel');
select creature_spawn(:'world2', 'tinka', 5.5, 8.5, 'deed', now() - interval '3 hours', :'ivar') as mender \gset
update creature set job = 'mend', phase = 'idle', until = now() - interval '600 seconds',
    leg_at = now() - interval '600 seconds', leg_ends = now() - interval '600 seconds',
    settled_at = now() - interval '600 seconds' where id = :'mender';
select worker_settle(:'world2', :'mender') as mended \gset
select '289. ten minutes of mending: ' || :'mended' || ' goes at it, and the shovel is at '
     || (select round(dmg::numeric, 1) from item where world_id = :'world2' and holder = 'crate' and def = 'shovel')
     || ' damage, QL ' || (select round(ql::numeric, 1) from item where world_id = :'world2' and holder = 'crate' and def = 'shovel')
     || ' — damage out, and a little quality with it';

select '290. trees standing on the deed: ' || (select count(*) from generate_series(0,15) gx, generate_series(0,15) gy
       where land_tile(:'world2', gx, gy) = tile_id('Tree') and on_deed(:'world2', gx, gy));
select creature_spawn(:'world2', 'sappa', 5.5, 8.5, 'deed', now() - interval '3 hours', :'ivar') as planter \gset
update creature set job = 'plant', phase = 'idle', until = now() - interval '900 seconds',
    leg_at = now() - interval '900 seconds', leg_ends = now() - interval '900 seconds',
    settled_at = now() - interval '900 seconds' where id = :'planter';
select worker_settle(:'world2', :'planter') as planted \gset
select '291. fifteen minutes of planting: ' || :'planted' || ' sprouts in the ground, '
     || (select count(*) from generate_series(0,15) gx, generate_series(0,15) gy
         where land_tile(:'world2', gx, gy) = tile_id('Tree') and on_deed(:'world2', gx, gy))
     || ' trees standing, and ' || coalesce((select sum(count)::text from item where world_id = :'world2' and holder = 'crate' and def = 'sprout'), '0')
     || ' sprouts left of four';

-- Two clear tiles on the deed, found rather than assumed: the planter has
-- just been round putting trees on some of them.
do $$
declare w uuid := (select id from world limit 1); r record; n int := 0;
begin
  delete from item where world_id = w and holder = 'ground' and def = 'corpse';
  for r in select gx, gy from generate_series(0, 15) gx, generate_series(0, 15) gy
    where creature_tile_ok(w, gx, gy) and on_deed(w, gx, gy)
    order by gx, gy
  loop
    exit when n >= 2;
    perform drop_on_ground(w, r.gx, r.gy, 'corpse', 40, 'Rabba');
    n := n + 1;
  end loop;
end $$;
select '292. carcasses lying about the deed: ' || (select count(*) from item where world_id = :'world2' and holder = 'ground' and def = 'corpse')
     || ', at ' || (select string_agg(gx || ',' || gy, ' and ') from item where world_id = :'world2' and holder = 'ground' and def = 'corpse');
select creature_spawn(:'world2', 'middun', 5.5, 8.5, 'deed', now() - interval '3 hours', :'ivar') as tidy \gset
update creature set job = 'compost', phase = 'idle', until = now() - interval '600 seconds',
    leg_at = now() - interval '600 seconds', leg_ends = now() - interval '600 seconds',
    settled_at = now() - interval '600 seconds' where id = :'tidy';
select worker_settle(:'world2', :'tidy') as composted \gset
select '293. ten minutes of a middun: ' || :'composted' || ' rounds, '
     || (select count(*) from item where world_id = :'world2' and holder = 'ground' and def = 'corpse')
     || ' carcasses left, and ' || coalesce((select sum(count)::text from item where world_id = :'world2' and holder = 'crate' and def = 'compost'), '0')
     || ' of compost in the crate — the best thing that ever happened to a field';
\echo ''
\echo '--- something that does not wait to be asked'
/*
 * Everything else wild swept off the island first. Twenty sections have been
 * spawning things to hit, butcher and tame, and a guard that goes for the
 * nearest of them is unreadable if there are thirty of them.
 */
delete from creature where world_id = :'world2' and mode = 'wild';
update player set x = 2.5, y = 0.5 where world_id = :'world2' and uid = :'hild';
update player set x = 2.5, y = 9.5, wounds = '[]'::jsonb,
    stats = jsonb_set(jsonb_set(stats, '{health}', '1'), '{hurtSettled}', to_jsonb(now()))
  where world_id = :'world2' and uid = :'ivar';

-- Stood still at a measured distance rather than wherever the walk took it.
select creature_spawn(:'world2', 'ulva', 10.5, 9.5, 'wild', now() - interval '3 hours') as stalker \gset
select creature_spawn(:'world2', 'goblin', 10.5, 9.5, 'wild', now() - interval '3 hours') as gob \gset
update creature set from_x = to_x, from_y = to_y, leg_at = now(), leg_ends = now(),
    until = now() + interval '1 hour', settled_at = now() - interval '1 second', hunting = null
  where world_id = :'world2' and id in (:'stalker', :'gob');
select creature_settle(:'world2', :'stalker'), creature_settle(:'world2', :'gob') \g /dev/null
select '294. eight tiles off, an ulva '
     || case when (select hunting from creature where id = :'stalker') is null then 'has not noticed him' else 'has his scent' end
     || ' and a goblin ' || case when (select hunting from creature where id = :'gob') is null then 'has not either' else 'has' end
     || ' — a monster sees eleven tiles where everything else sees seven';

delete from creature where world_id = :'world2' and id = :'gob';
delete from event where uid = :'ivar';
update creature set from_x = 8.5, from_y = 9.5, to_x = 8.5, to_y = 9.5, leg_at = now(), leg_ends = now(),
    until = now() + interval '1 hour', settled_at = now() - interval '1 second'
  where world_id = :'world2' and id = :'stalker';
select creature_settle(:'world2', :'stalker') \g /dev/null
select '295. six tiles off: ' || coalesce((select string_agg(text, ' | ' order by n) from event where uid = :'ivar'), 'nothing said')
     || ' — and it is now hunting ' || case when (select hunting from creature where id = :'stalker') = :'ivar' then 'him' else 'nobody' end;

-- One settle with the clock caught up: the leg it takes is aimed.
update creature set until = now(), settled_at = now() - interval '1 second'
  where world_id = :'world2' and id = :'stalker';
select creature_settle(:'world2', :'stalker') \g /dev/null
select '296. and it comes: a leg from ' || (select round(from_x::numeric, 1) || ',' || round(from_y::numeric, 1) from creature where id = :'stalker')
     || ' to ' || (select round(to_x::numeric, 1) || ',' || round(to_y::numeric, 1) from creature where id = :'stalker')
     || ' taking ' || (select round(extract(epoch from (leg_ends - leg_at))::numeric, 1) from creature where id = :'stalker')
     || ' seconds — it stops a pace short of him rather than on him';

-- Beside him, and ten seconds of standing there.
delete from event where uid = :'ivar';
update creature set from_x = 3.5, from_y = 9.5, to_x = 3.5, to_y = 9.5, leg_at = now(), leg_ends = now(),
    until = now() - interval '10 seconds', settled_at = now() - interval '10 seconds'
  where world_id = :'world2' and id = :'stalker';
select creature_settle(:'world2', :'stalker') \g /dev/null
select '297. ten seconds of it: ' || (select count(*) from event where uid = :'ivar' and text like '%is on you%')
     || ' blows, health down to ' || (select round(((stats->>'health')::numeric), 3) from player where uid = :'ivar')
     || ', and he is carrying ' || coalesce((select string_agg(wound_text(x.value), ' | ') from player p, jsonb_array_elements(p.wounds) x where p.uid = :'ivar'), 'nothing');

-- And an hour of it, which is the whole point: see the head of the migration.
delete from event where uid = :'ivar';
update player set x = 2.5, y = 9.5, wounds = '[]'::jsonb,
    stats = jsonb_set(jsonb_set(stats, '{health}', '1'), '{hurtSettled}', to_jsonb(now()))
  where world_id = :'world2' and uid = :'ivar';
update creature set from_x = 3.5, from_y = 9.5, to_x = 3.5, to_y = 9.5, leg_at = now(), leg_ends = now(),
    until = now() - interval '1 hour', settled_at = now() - interval '1 hour'
  where world_id = :'world2' and id = :'stalker';
select creature_settle(:'world2', :'stalker') \g /dev/null
select '298. an hour with the tab shut: ' || (select count(*) from event where uid = :'ivar' and text like '%is on you%')
     || ' blows, not two and a half thousand — an hour of absence is not an hour of being chased';

-- Far enough away and it thinks better of it — and a monster does not.
update player set x = 1.5, y = 9.5 where world_id = :'world2' and uid = :'ivar';
select creature_spawn(:'world2', 'goblin', 15.5, 9.5, 'wild', now() - interval '3 hours') as gob2 \gset
update creature set hunting = :'ivar', from_x = 15.5, from_y = 9.5, to_x = 15.5, to_y = 9.5,
    leg_at = now(), leg_ends = now(), until = now() + interval '1 hour', settled_at = now() - interval '1 second'
  where world_id = :'world2' and id in (:'stalker', :'gob2');
select creature_settle(:'world2', :'stalker'), creature_settle(:'world2', :'gob2') \g /dev/null
select '299. fourteen tiles of open ground later the ulva '
     || case when (select hunting from creature where id = :'stalker') is null then 'has given him up' else 'is still coming' end
     || ', and the goblin '
     || case when (select hunting from creature where id = :'gob2') is null then 'has given him up too' else 'has not: a monster follows better than twice as far' end;

\echo ''
\echo '--- a guard on the border, and a hunter in the country'
delete from creature where world_id = :'world2' and mode = 'wild';
delete from item where world_id = :'world2' and holder = 'ground' and def = 'corpse';
select '300. of the twenty-two trades a wildermon may be set to, this island now knows '
     || (select count(*) from (values ('forage'), ('botanize'), ('woodcut'), ('farm'), ('mine'), ('sand'),
                                      ('clay'), ('quarry'), ('stoke'), ('fetch'), ('guard'), ('hunt'),
                                      ('peat'), ('reed'), ('water'), ('prospect'), ('plant'), ('hod'),
                                      ('mend'), ('compost'), ('seek'), ('fish')) v(k) where worker_job_ported(v.k))
     || ' — and nothing wild is left standing on the deed: '
     || (select count(*) from creature where world_id = :'world2' and mode = 'wild');

select creature_spawn(:'world2', 'ulva', 5.5, 7.5, 'deed', now() - interval '3 hours', :'ivar') as warden \gset
select creature_spawn(:'world2', 'rabba', 9.5, 7.5, 'wild', now() - interval '2 hours') as trespass \gset
update creature set from_x = to_x, from_y = to_y, leg_at = now(), leg_ends = now(),
    until = now() + interval '1 hour', settled_at = now() - interval '1 second'
  where world_id = :'world2' and id = :'trespass';
update creature set phase = 'idle', until = now() - interval '300 seconds',
    leg_at = now() - interval '300 seconds', leg_ends = now() - interval '300 seconds',
    settled_at = now() - interval '300 seconds' where id = :'warden';
select '301. a rabba four tiles off, well inside a border thirteen tiles out, and an ulva set to watch it — what it knows: '
     || (select round((skills->>'body_strength')::numeric, 2) from creature where id = :'warden') || ' of keeping watch';
select worker_settle(:'world2', :'warden') as watched \gset
select '302. five minutes of it: ' || :'watched' || ' killed, the rabba is '
     || case when exists (select 1 from creature where id = :'trespass') then 'still there' else 'gone' end
     || ', there is a corpse at ' || coalesce((select gx || ',' || gy from item where world_id = :'world2' and holder = 'ground' and def = 'corpse' limit 1), 'nowhere')
     || ', and the ulva is up to ' || (select round((skills->>'body_strength')::numeric, 2) from creature where id = :'warden');

-- A hunter does the same and then does what every other worker does with it.
delete from creature where world_id = :'world2' and mode = 'wild';
delete from item where world_id = :'world2' and holder = 'ground' and def = 'corpse';
delete from creature where world_id = :'world2' and id = :'warden';
delete from item where world_id = :'world2' and holder = 'crate' and def = 'corpse';
select creature_spawn(:'world2', 'rowl', 5.5, 7.5, 'deed', now() - interval '3 hours', :'ivar') as hunter \gset
select creature_spawn(:'world2', 'rabba', 11.5, 7.5, 'wild', now() - interval '2 hours') as quarry \gset
select creature_spawn(:'world2', 'rabba', 3.5, 11.5, 'wild', now() - interval '2 hours') as quarry2 \gset
update creature set from_x = to_x, from_y = to_y, leg_at = now(), leg_ends = now(),
    until = now() + interval '1 hour', settled_at = now() - interval '1 second'
  where world_id = :'world2' and id in (:'quarry', :'quarry2');
update creature set phase = 'idle', until = now() - interval '900 seconds',
    leg_at = now() - interval '900 seconds', leg_ends = now() - interval '900 seconds',
    settled_at = now() - interval '900 seconds' where id = :'hunter';
select '303. a rowl set to hunt, ranging ' || work_range((select c from creature c where c.id = :'hunter'))
     || ' tiles from the token, with two rabbas out in it';
select worker_settle(:'world2', :'hunter') as hunted \gset
select '304. a quarter of an hour of it: ' || :'hunted' || ' pulled down, '
     || (select count(*) from creature where world_id = :'world2' and mode = 'wild') || ' left walking, '
     || coalesce((select sum(count)::text from item where world_id = :'world2' and holder = 'crate' and def = 'corpse'), '0')
     || ' carcasses in the crate and ' || (select count(*) from item where world_id = :'world2' and holder = 'ground' and def = 'corpse')
     || ' still in the grass — the carcass is the load, and it goes in the crate like sand or stone';
select '305. and what it learned by it: fighting ' || (select round((skills->>'fighting')::numeric, 2) from creature where id = :'hunter')
     || ', from the one it started with';

-- A worker with no trade in fighting at all, and what its stance makes of company.
-- Nobody freshly mauled: the ulva up the page left both of them reading as
-- struck at seconds ago, and a defensive worker answers for its keeper too.
delete from creature where world_id = :'world2' and mode = 'wild';
update player set stats = stats - 'hurtBy' - 'hurtAt' where world_id = :'world2';
select creature_spawn(:'world2', 'holla', 5.5, 7.5, 'deed', now() - interval '3 hours', :'ivar') as digger \gset
select creature_spawn(:'world2', 'rabba', 6.5, 7.5, 'wild', now() - interval '2 hours') as company \gset
update creature set from_x = to_x, from_y = to_y, leg_at = now(), leg_ends = now(),
    until = now() + interval '1 hour', settled_at = now() - interval '1 second'
  where world_id = :'world2' and id = :'company';
update creature set stance = 'passive' where id = :'digger';
select '306. a passive holla, with a rabba at its elbow: ' ||
       case when (select id from fight_target(:'world2', :'digger')) is null then 'it carries on digging' else 'it goes for it' end;
update creature set stance = 'defensive' where id = :'digger';
select '307. defensive, and nothing has struck at anybody: ' ||
       case when (select id from fight_target(:'world2', :'digger')) is null then 'it carries on digging' else 'it goes for it' end;
update creature set hurt_at = now() - interval '2 seconds', hurt_by = :'company' where id = :'digger';
select '308. defensive, and the rabba bit it two seconds ago: ' ||
       case when (select id from fight_target(:'world2', :'digger')) is null then 'it carries on digging' else 'it breaks off and goes for it' end;
update creature set hurt_at = now() - interval '30 seconds' where id = :'digger';
select '309. and thirty seconds later, which is long enough to have forgotten: ' ||
       case when (select id from fight_target(:'world2', :'digger')) is null then 'it carries on digging' else 'it is still going for it' end;
update creature set stance = 'aggressive', hurt_at = null, hurt_by = null where id = :'digger';
select '310. aggressive, which needs no reason at all: ' ||
       case when (select id from fight_target(:'world2', :'digger')) is null then 'it carries on digging' else 'it goes for it' end;

-- And through the front door, which is where a keeper actually sets one on.
-- The deed has work for five at level five and eight have been put on it over
-- the last ten sections, so it is paid off first.
delete from creature where world_id = :'world2' and mode = 'deed';
update player set x = 5.5, y = 7.5 where world_id = :'world2' and uid = :'ivar';
select creature_spawn(:'world2', 'ulva', 5.5, 6.5, 'stored', now() - interval '3 hours', :'ivar') as recruit \gset
select creature_spawn(:'world2', 'rowl', 5.5, 6.5, 'stored', now() - interval '3 hours', :'ivar') as tracker \gset
select '311. setting an ulva to keep watch: ' || coalesce(act_refusal(:'world2', :'ivar', 'assign_deed',
       ('{"kind":"creature","id":' || :'recruit' || '}')::jsonb), 'allowed')
     || ' | and a rowl to hunt: ' || coalesce(act_refusal(:'world2', :'ivar', 'assign_deed',
       ('{"kind":"creature","id":' || :'tracker' || '}')::jsonb), 'allowed')
     || ' — which up to this commit were both "Nobody has taught this island what that looks like yet."';

\echo ''
\echo '--- the ground, which until now nobody could pick anything up off'
-- The deed swept, so what is lying about is what this section put there.
delete from item where world_id = :'world2' and holder = 'ground';
update player set x = 5.5, y = 7.5 where world_id = :'world2' and uid = :'ivar';
select drop_on_ground(:'world2', 5, 7, 'log', 42, 'Oak', 2) as lying \gset
select drop_on_ground(:'world2', 6, 7, 'rock_shards', 30, null, 5) \g /dev/null
select drop_on_ground(:'world2', 4, 8, 'corpse', 25, 'Rabba') \g /dev/null
select drop_on_ground(:'world2', 12, 2, 'log', 20, 'Pine') \g /dev/null
select '312. lying within reach of the token: ' || sweepable(:'world2', 5, 7)
     || ' heaps, and one out at 12,2 that is not';

delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'examine', '{"kind":"tile","x":5,"y":7}'::jsonb) \g /dev/null
select '313. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
select x as treex, y as treey from generate_series(0, 15) x cross join generate_series(0, 15) y
  where land_tile(:'world2', x, y) = (select id from tile_def where name = 'Tree') order by x, y limit 1 \gset
select '314. and a tree, which says what sort and how old: ' || examine_tile_text(:'world2', :'treex', :'treey');

select pack_count(:'world2', :'ivar', 'log') as logs_before \gset
select '315. picking the logs up: ' || coalesce(act_refusal(:'world2', :'ivar', 'pick_up',
       ('{"kind":"ground","x":5,"y":7,"uid":' || :'lying' || '}')::jsonb), 'allowed')
     || ' | the heap out at 12,2: ' || coalesce(act_refusal(:'world2', :'ivar', 'pick_up',
       '{"kind":"ground","x":12,"y":2}'::jsonb), 'allowed')
     || ' | bare grass: ' || coalesce(act_refusal(:'world2', :'ivar', 'pick_up',
       '{"kind":"ground","x":5,"y":8}'::jsonb), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'pick_up', ('{"kind":"ground","x":5,"y":7,"uid":' || :'lying' || '}')::jsonb) \g /dev/null
select '316. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — logs in the pack ' || pack_count(:'world2', :'ivar', 'log') || ', from ' || :'logs_before';

-- And down again, which is the half of it that did work: a worker could put
-- things down all along.
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'drop',
  ('{"kind":"item","uid":' || (select id from item where world_id = :'world2' and holder = 'player'
      and holder_uid = :'ivar' and def = 'log' and extra = 'Oak' order by id limit 1) || ',"count":3}')::jsonb) \g /dev/null
select '317. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — and there are now ' || (select coalesce(sum(count), 0) from item where world_id = :'world2'
          and holder = 'ground' and gx = 5 and gy = 7) || ' of it at his feet';

delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'pick_up_all', '{"kind":"tile","x":5,"y":7}'::jsonb) \g /dev/null
select '318. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
select '319. left lying about the deed: ' || (select count(*) from item where world_id = :'world2'
       and holder = 'ground') || ' — the one out at 12,2, which is further than an arm';

\echo ''
\echo '--- and what a thing says about itself'
insert into item (world_id, holder, holder_uid, def, ql, dmg, count, extra, rare)
values (:'world2', 'player', :'ivar', 'hatchet', 63.5, 12, 1, 'Steel', 'supreme') returning id as prize \gset
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'examine_item', ('{"kind":"item","uid":' || :'prize' || '}')::jsonb) \g /dev/null
select '320. ' || (select text from event where uid = :'ivar' order by n desc limit 1);

-- Setting a thing aside, which is only a word until the things that spend
-- things read it.
select '321. a supreme steel hatchet is called: ' || (select item_name(i) from item i where i.id = :'prize');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'lock_item', ('{"kind":"item","uid":' || :'prize' || '}')::jsonb) \g /dev/null
select '322. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
select '323. and now: the pack counts ' || pack_count(:'world2', :'ivar', 'hatchet') || ' hatchets'
     || ', a tool in hand is still worth ' || to_char(tool_ql(:'world2', :'ivar', 'hatchet'), 'FM990.0')
     || ', and dropping it: ' || coalesce(act_refusal(:'world2', :'ivar', 'drop',
        ('{"kind":"item","uid":' || :'prize' || '}')::jsonb), 'allowed');
select act_perform(:'world2', :'ivar', 'unlock_item', ('{"kind":"item","uid":' || :'prize' || '}')::jsonb) \g /dev/null
select '324. put back in the pack: the pack counts ' || pack_count(:'world2', :'ivar', 'hatchet')
     || ', and dropping it: ' || coalesce(act_refusal(:'world2', :'ivar', 'drop',
        ('{"kind":"item","uid":' || :'prize' || '}')::jsonb), 'allowed');

-- And calling a thing by a name, which is the difference between six bins and
-- the one marked Planks.
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'name_thing',
  ('{"kind":"crate","id":' || (select id from crate where world_id = :'world2' and deed) || ',"name":"Planks"}')::jsonb) \g /dev/null
select '325. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — and it now answers to ' || (select coalesce(name, crate_name(c)) from crate c where c.world_id = :'world2' and c.deed);
select '326. the eight a pair of hands brought: '
     || (select string_agg(id, ', ' order by id) from action_def where hands_action(id));

\echo ''
\echo '--- working the ground, and what grows out of it'
-- The tile a building stands on, which is the case the last commit could not
-- examine: `building_at` hands back a number and it was being read as a row.
select bt.x as inx, bt.y as iny from building_tile bt where bt.world_id = :'world2' order by bt.x, bt.y limit 1 \gset
select '327. examining the floor of a building: ' || examine_tile_text(:'world2', :'inx', :'iny');

-- A tile with one corner standing a metre proud of the rest.
update player set x = 9.5, y = 9.5 where world_id = :'world2' and uid = :'ivar';
select land_set_tile(:'world2', 10, 9, 1), land_set_height(:'world2', 10, 9, 103),
       land_set_dirt(:'world2', 10, 9, 20) \g /dev/null
select '328. the tile at 10,9 stands ' || tile_slope(:'world2', 10, 9)
     || ' out of true, and flattening it: ' || coalesce(act_refusal(:'world2', :'ivar', 'flatten',
        '{"kind":"tile","x":10,"y":9}'::jsonb), 'allowed');
delete from event where uid = :'ivar';
do $$
declare w uuid := (select id from world where name <> 'Rockhaven' order by made_at limit 1);
        me uuid := '11111111-1111-1111-1111-111111111111'; i int;
begin
  for i in 1..8 loop
    exit when act_refusal(w, me, 'flatten', '{"kind":"tile","x":10,"y":9}'::jsonb) is not null;
    perform act_perform(w, me, 'flatten', '{"kind":"tile","x":10,"y":9}'::jsonb);
  end loop;
end $$;
select '329. ' || (select string_agg(distinct text, ' | ') from event where uid = :'ivar' and kind = 'event')
     || ' — the tile is now ' || tile_slope(:'world2', 10, 9) || ' out of true';

-- Dirt, dropped on a named corner rather than under your own feet.
delete from event where uid = :'ivar';
select give(:'world2', :'ivar', 'dirt', 3, 20) \g /dev/null
select land_height(:'world2', 11, 9) as was_h \gset
select act_perform(:'world2', :'ivar', 'drop_dirt', '{"kind":"tile","x":10,"y":9,"cx":11,"cy":9}'::jsonb) \g /dev/null
select '330. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — the corner went from ' || :'was_h' || ' to ' || land_height(:'world2', 11, 9);

\echo ''
\echo '--- paving with cut slabs, and taking it up again'
select land_set_tile(:'world2', 9, 10, 2) \g /dev/null
select '331. slabs on packed earth with nothing to lay: ' || coalesce(act_refusal(:'world2', :'ivar',
       'pave_slabs', '{"kind":"tile","x":9,"y":10}'::jsonb), 'allowed');
select give(:'world2', :'ivar', 'marble_slab', 2, 70) \g /dev/null
select give(:'world2', :'ivar', 'trowel', 1, 40) \g /dev/null
select '332. with a marble slab and a trowel: ' || coalesce(act_refusal(:'world2', :'ivar',
       'pave_slabs', '{"kind":"tile","x":9,"y":10}'::jsonb), 'allowed')
     || ' | on bare grass: ' || coalesce(act_refusal(:'world2', :'ivar', 'pave_slabs',
        '{"kind":"tile","x":9,"y":9}'::jsonb), 'allowed');
delete from event where uid = :'ivar';
do $$
declare w uuid := (select id from world where name <> 'Rockhaven' order by made_at limit 1);
        me uuid := '11111111-1111-1111-1111-111111111111'; i int;
begin
  for i in 1..8 loop
    exit when land_tile(w, 9, 10) = 21;
    perform act_perform(w, me, 'pave_slabs', '{"kind":"tile","x":9,"y":10}'::jsonb);
  end loop;
end $$;
select '333. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — the tile is paved, and what is in its data byte says '
     || lower((select name from slab_def where id = land_data(:'world2', 9, 10)))
     || ', which is how a slab tile remembers the stone it was cut from';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'remove_paving', '{"kind":"tile","x":9,"y":10}'::jsonb) \g /dev/null
select '334. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and it is back to ' || (select name from tile_def where id = land_tile(:'world2', 9, 10));

\echo ''
\echo '--- grass, reeds, fruit and worms'
select land_set_tile(:'world2', 9, 9, 0), land_set_tile(:'world2', 8, 9, 19) \g /dev/null
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'cut_grass', '{"kind":"tile","x":9,"y":9}'::jsonb) \g /dev/null
select '335. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and going back for more: ' || coalesce(act_refusal(:'world2', :'ivar', 'cut_grass',
        '{"kind":"tile","x":9,"y":9}'::jsonb), 'allowed');
select give(:'world2', :'ivar', 'carving_knife', 1, 40) \g /dev/null
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'cut_reeds', '{"kind":"tile","x":8,"y":9}'::jsonb) \g /dev/null
select '336. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);

-- An apple tree, young and then old, which is the whole of what bearing means.
select land_set_tile(:'world2', 10, 10, 16), land_set_data(:'world2', 10, 10, 6) \g /dev/null
update player set x = 10.5, y = 9.5 where world_id = :'world2' and uid = :'ivar';
select '337. a sapling apple: ' || coalesce(act_refusal(:'world2', :'ivar', 'pick_fruit',
       '{"kind":"tile","x":10,"y":10}'::jsonb), 'allowed');
select land_set_data(:'world2', 10, 10, 6 | (2 << 4)) \g /dev/null
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'pick_fruit', '{"kind":"tile","x":10,"y":10}'::jsonb) \g /dev/null
select '338. an old one: ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and again straight away: ' || coalesce(act_refusal(:'world2', :'ivar', 'pick_fruit',
        '{"kind":"tile","x":10,"y":10}'::jsonb), 'allowed');

-- A sprout off it, planted somewhere else, which is how an orchard happens.
insert into skill (world_id, uid, id, value) values (:'world2', :'ivar', 'forestry', 60)
  on conflict (world_id, uid, id) do update set value = 60;
delete from event where uid = :'ivar';
do $$
declare w uuid := (select id from world where name <> 'Rockhaven' order by made_at limit 1);
        me uuid := '11111111-1111-1111-1111-111111111111'; i int;
begin
  for i in 1..10 loop
    exit when pack_count(w, me, 'sprout') > 0;
    perform act_perform(w, me, 'pick_sprout', '{"kind":"tile","x":10,"y":10}'::jsonb);
  end loop;
end $$;
select '339. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — in the pack: ' || coalesce((select count || ' ' || lower(extra) || ' sprout' from item
          where world_id = :'world2' and holder_uid = :'ivar' and def = 'sprout' limit 1), 'none');
select land_set_tile(:'world2', 11, 9, 0) \g /dev/null
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'plant', '{"kind":"tile","x":11,"y":9}'::jsonb) \g /dev/null
select '340. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — 11,9 now holds an ' || lower((select name from tree_def where id = tree_species(land_data(:'world2', 11, 9))))
     || ' tree at age ' || tree_age(land_data(:'world2', 11, 9))
     || ', which is where a planted one starts and a felled one never gets back to';

-- Worms, which is what a marsh is full of and a gravel path is not.
select land_set_tile(:'world2', 9, 11, 7), land_set_tile(:'world2', 8, 10, 3) \g /dev/null
update player set x = 9.5, y = 10.5 where world_id = :'world2' and uid = :'ivar';
delete from event where uid = :'ivar';
do $$
declare w uuid := (select id from world where name <> 'Rockhaven' order by made_at limit 1);
        me uuid := '11111111-1111-1111-1111-111111111111'; i int;
begin
  for i in 1..6 loop perform act_perform(w, me, 'dig_worms', '{"kind":"tile","x":9,"y":11}'::jsonb); end loop;
end $$;
select '341. six spadefuls of marsh: ' || pack_count(:'world2', :'ivar', 'worm') || ' worms'
     || ' — and turning over the sand at 8,10: ' || coalesce(act_refusal(:'world2', :'ivar', 'dig_worms',
        '{"kind":"tile","x":8,"y":10}'::jsonb), 'allowed');

\echo ''
\echo '--- reading the ground for metal'
insert into skill (world_id, uid, id, value) values (:'world2', :'ivar', 'prospecting', 40)
  on conflict (world_id, uid, id) do update set value = 40;
select '342. at prospecting 40 a prospector reads ' || prospect_radius(40) || ' tiles about them'
     || ', and at 1, ' || prospect_radius(1);
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'prospect', '{"kind":"tile","x":9,"y":10}'::jsonb) \g /dev/null
select '343. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'event');
select '344. and what is now lit for him: ' ||
       (select count(*) from generate_series(0, 15) x cross join generate_series(0, 15) y
        where is_prospected(:'world2', :'ivar', x, y)) || ' tiles — for Hild, who has not looked: '
     || (select count(*) from generate_series(0, 15) x cross join generate_series(0, 15) y
         where is_prospected(:'world2', :'hild', x, y));
select '345. the eleven the ground brought: '
     || (select string_agg(id, ', ' order by id) from action_def where ground_action(id))
     || ' — of 374 the island now does ' || (select count(*) from action_def where act_ported(id));

\echo ''
\echo '--- and a beast that does the reading for you'
-- Nothing else on the deed, and a seam of bare rock to find.
delete from creature where world_id = :'world2' and mode in ('deed', 'wild');
update player set stats = jsonb_set(stats, '{prospected}', 'null'::jsonb)
  where world_id = :'world2' and uid = :'ivar';
select '346. lit for Ivar before anybody looks: '
     || (select count(*) from generate_series(0, 15) x cross join generate_series(0, 15) y
         where is_prospected(:'world2', :'ivar', x, y)) || ' tiles';
select creature_spawn(:'world2', 'dowse', 5.5, 7.5, 'deed', now() - interval '3 hours', :'ivar') as reader \gset
select '347. a dowse set to read the ground, ranging ' || work_range((select c from creature c where c.id = :'reader'))
     || ' tiles — and setting one on through the front door is now: '
     || coalesce(act_refusal(:'world2', :'ivar', 'assign_deed',
        ('{"kind":"creature","id":' || (select creature_spawn(:'world2', 'dowse', 5.5, 6.5, 'stored', now() - interval '3 hours', :'ivar')) || '}')::jsonb), 'allowed');
update creature set phase = 'idle', until = now() - interval '900 seconds',
    leg_at = now() - interval '900 seconds', leg_ends = now() - interval '900 seconds',
    settled_at = now() - interval '900 seconds' where id = :'reader';
delete from event where uid = :'ivar';
select worker_settle(:'world2', :'reader') as read_rounds \gset
select '348. a quarter of an hour of it: ' || :'read_rounds' || ' readings, and it is out at '
     || (select floor(to_x) || ',' || floor(to_y) from creature where id = :'reader')
     || ' on leg ' || (select leg from creature where id = :'reader')
     || ' — a reading is a leg, and a leg is what the next spot is hashed from';
/*
 * The reading itself, measured separately from the walk.
 *
 * There is exactly one tile of bare metal on this island and the dowse ranges
 * nine tiles round the token, so whether forty readings happen to cover that
 * one square is a question about luck rather than about the port. Stood on it,
 * what it does is the thing worth measuring.
 */
-- Read in its own statement: folded into the sentence below it, the count
-- would be taken from the snapshot the reading has not landed in yet.
delete from event where uid = :'ivar';
select read_ground(:'world2', :'reader', 5, 5, 2) as seam \gset
select '349. stood on the seam at 5,5: ' || :'seam'
     || ' tile of metal found, now lit for its keeper: '
     || (select count(*) from generate_series(0, 15) x cross join generate_series(0, 15) y
         where is_prospected(:'world2', :'ivar', x, y))
     || ' — and it said: ' || coalesce((select text from event where uid = :'ivar' and kind = 'event'
          order by n desc limit 1), 'nothing');
select '350. of the twenty-two trades a wildermon may be set to, this island now knows '
     || (select count(*) from (values ('forage'), ('botanize'), ('woodcut'), ('farm'), ('mine'), ('sand'),
                                      ('clay'), ('quarry'), ('stoke'), ('fetch'), ('guard'), ('hunt'),
                                      ('peat'), ('reed'), ('water'), ('prospect'), ('plant'), ('hod'),
                                      ('mend'), ('compost'), ('seek'), ('fish')) v(k) where worker_job_ported(v.k))
     || ' — and the ones it does not: '
     || coalesce((select string_agg(v.k, ', ' order by v.k) from (values ('water'), ('seek')) v(k)
                  where not worker_job_ported(v.k)), 'none at all: that is every trade in the game');

\echo ''
\echo '--- barrels, buckets, and a well that fills itself'
update player set x = 5.5, y = 7.5,
    stats = jsonb_set(stats, '{thirst}', '0.3') where world_id = :'world2' and uid = :'ivar';
delete from placed where world_id = :'world2' and kind = 'furniture' and sub in ('barrel', 'well');
select give(:'world2', :'ivar', 'barrel', 1, 60) \g /dev/null
select act_perform(:'world2', :'ivar', 'place_furniture',
  ('{"kind":"item","uid":' || (select id from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'barrel' order by id desc limit 1) || ',"x":5,"y":8,"sx":0,"sy":0}')::jsonb) \g /dev/null
select id as barrel from placed where world_id = :'world2' and sub = 'barrel' order by id desc limit 1 \gset
select '351. a barrel set down at 5,8 holds ' || liquid_capacity((select p from placed p where p.id = :'barrel'))
     || ' litres and has ' || placed_litres((select p from placed p where p.id = :'barrel')) || ' in it';

-- A well, which is the fifth thing on this island that will not sit still.
select give(:'world2', :'ivar', 'well', 1, 80) \g /dev/null
select act_perform(:'world2', :'ivar', 'place_furniture',
  ('{"kind":"item","uid":' || (select id from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'well' order by id desc limit 1) || ',"x":6,"y":8,"sx":0,"sy":0}')::jsonb) \g /dev/null
select id as well from placed where world_id = :'world2' and sub = 'well' order by id desc limit 1 \gset
select '352. a well at QL 80 finds ' || round(well_rate(80)::numeric, 4) || ' litres a second'
     || ', so a fresh one has ' || round(placed_litres((select p from placed p where p.id = :'well'))::numeric, 1) || ' in it';
update placed set since = now() - interval '5 minutes' where id = :'well';
select round(placed_litres((select p from placed p where p.id = :'well'))::numeric, 1) as five \gset
update placed set since = now() - interval '1 day' where id = :'well';
select '353. five minutes nobody watched: ' || :'five' || ' litres — and a day of it: '
     || round(placed_litres((select p from placed p where p.id = :'well'))::numeric, 1)
     || ', which is the depth it was sunk to and not a drop more';
update placed set since = now() - interval '5 minutes' where id = :'well';

\echo ''
\echo '--- a bucket, filled and tipped out'
select give(:'world2', :'ivar', 'bucket', 3, 50) \g /dev/null
select id as bucket from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'bucket' order by id desc limit 1 \gset
update player set x = 6.5, y = 8.5 where world_id = :'world2' and uid = :'ivar';
select '354. standing at the well: ' || coalesce(act_refusal(:'world2', :'ivar', 'fill_bucket',
       ('{"kind":"item","uid":' || :'bucket' || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'fill_bucket', ('{"kind":"item","uid":' || :'bucket' || '}')::jsonb) \g /dev/null
select '355. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — the well is down to ' || round(placed_litres((select p from placed p where p.id = :'well'))::numeric, 1)
     || ', and the pack holds ' || pack_count(:'world2', :'ivar', 'water_bucket') || ' of water';

update player set x = 5.5, y = 8.5 where world_id = :'world2' and uid = :'ivar';
select id as full_bucket from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'water_bucket' order by id desc limit 1 \gset
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'pour_into_barrel', ('{"kind":"item","uid":' || :'full_bucket' || '}')::jsonb) \g /dev/null
select '356. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and the empty bucket is back: ' || pack_count(:'world2', :'ivar', 'bucket') || ' of them';

\echo ''
\echo '--- drinking out of it, and tipping it out'
select '357. thirst before: ' || (select round((stats->>'thirst')::numeric, 2) from player where uid = :'ivar')
     || ', and drinking from the barrel: ' || coalesce(act_refusal(:'world2', :'ivar', 'drink_from_vessel',
        ('{"kind":"furniture","id":' || :'barrel' || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'drink_from_vessel', ('{"kind":"furniture","id":' || :'barrel' || '}')::jsonb) \g /dev/null
select '358. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — thirst ' || (select round((stats->>'thirst')::numeric, 2) from player where uid = :'ivar')
     || ', and ' || round(placed_litres((select p from placed p where p.id = :'barrel'))::numeric, 1) || ' left in it';
update player set stats = jsonb_set(stats, '{thirst}', '1') where world_id = :'world2' and uid = :'ivar';
select '359. and asked again with a full belly: ' || coalesce(act_refusal(:'world2', :'ivar', 'drink_from_vessel',
       ('{"kind":"furniture","id":' || :'barrel' || '}')::jsonb), 'allowed');
update placed set liquid = 'lye' where id = :'barrel';
select '360. a barrel of lye: ' || coalesce(act_refusal(:'world2', :'ivar', 'drink_from_vessel',
       ('{"kind":"furniture","id":' || :'barrel' || '}')::jsonb), 'allowed')
     || ' | and a well, which is not something you tip out: '
     || coalesce(act_refusal(:'world2', :'ivar', 'empty_vessel', ('{"kind":"furniture","id":' || :'well' || '}')::jsonb), 'allowed');
update placed set liquid = 'water' where id = :'barrel';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'empty_vessel', ('{"kind":"furniture","id":' || :'barrel' || '}')::jsonb) \g /dev/null
select '361. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — ' || round(placed_litres((select p from placed p where p.id = :'barrel'))::numeric, 1) || ' left';

-- A water skin, which is the other way of carrying it.
select give(:'world2', :'ivar', 'water_skin', 1, 50) \g /dev/null
update item set charges = 1 where world_id = :'world2' and holder_uid = :'ivar' and def = 'water_skin';
select id as skin from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'water_skin' limit 1 \gset
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'fill_skin', ('{"kind":"item","uid":' || :'skin' || '}')::jsonb) \g /dev/null
select '362. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — it is now ' || (select charges from item where id = :'skin') || ' of '
     || (select charges from item_def where id = 'water_skin')
     || ', and filling it again: ' || coalesce(act_refusal(:'world2', :'ivar', 'fill_skin',
        ('{"kind":"item","uid":' || :'skin' || '}')::jsonb), 'allowed');

\echo ''
\echo '--- and a holla, which carries the shore to your barrels'
delete from creature where world_id = :'world2' and mode in ('deed', 'wild');
update placed set litres = 0, liquid = null, since = now() where id = :'barrel';
select creature_spawn(:'world2', 'holla', 5.5, 7.5, 'deed', now() - interval '3 hours', :'ivar') as carrier \gset
select '363. a holla set to carry water, ranging ' || work_range((select c from creature c where c.id = :'carrier'))
     || ' tiles — the barrel at 5,8 is empty and the well at 6,8 has '
     || round(placed_litres((select p from placed p where p.id = :'well'))::numeric, 1) || ' in it';
update creature set phase = 'idle', until = now() - interval '900 seconds',
    leg_at = now() - interval '900 seconds', leg_ends = now() - interval '900 seconds',
    settled_at = now() - interval '900 seconds' where id = :'carrier';
select worker_settle(:'world2', :'carrier') as carried \gset
select '364. a quarter of an hour of it: ' || :'carried' || ' goes — a fill and a pour apiece — and the barrel holds '
     || round(placed_litres((select p from placed p where p.id = :'barrel'))::numeric, 1) || ' of '
     || liquid_capacity((select p from placed p where p.id = :'barrel')) || ' litres of '
     || coalesce((select liquid from placed where id = :'barrel'), 'nothing')
     || ', with ' || round(placed_litres((select p from placed p where p.id = :'well'))::numeric, 1)
     || ' left in the well: it stops when there is not a bucket''s worth down there';
select '365. the six the liquids brought: '
     || (select string_agg(id, ', ' order by id) from action_def where liquid_action(id))
     || ' — of 374 the island now does ' || (select count(*) from action_def where act_ported(id));

\echo ''
\echo '--- an oven, which is a fire with a roof on it'
update player set x = 7.5, y = 7.5 where world_id = :'world2' and uid = :'ivar';
select give(:'world2', :'ivar', 'oven', 1, 55) \g /dev/null
select act_perform(:'world2', :'ivar', 'place_furniture',
  ('{"kind":"item","uid":' || (select id from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'oven' order by id desc limit 1) || ',"x":7,"y":8,"sx":0,"sy":0}')::jsonb) \g /dev/null
select id as oven from placed where world_id = :'world2' and sub = 'oven' order by id desc limit 1 \gset
select '366. an oven set down at 7,8, firebox ' || oven_capacity() || ' seconds against a campfire''s '
     || fire_capacity() || ' — and lighting it with nothing in it: '
     || coalesce(act_refusal(:'world2', :'ivar', 'light_oven', ('{"kind":"furniture","id":' || :'oven' || '}')::jsonb), 'allowed');
select give(:'world2', :'ivar', 'log', 6, 40, 'Pine') \g /dev/null
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'fuel_oven', ('{"kind":"furniture","id":' || :'oven' || ',"count":6}')::jsonb) \g /dev/null
select '367. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'light_oven', ('{"kind":"furniture","id":' || :'oven' || '}')::jsonb) \g /dev/null
select '368. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
-- An hour of it with nobody watching, which is the whole of the point.
update placed set since = now() - interval '1 hour' where id = :'oven';
select '369. an hour later, before anybody looks: the row still says '
     || round((select fuel from placed where id = :'oven')::numeric) || ' seconds — and once anybody does: '
     || oven_burns_for(placed_fuel((select p from placed p where p.id = :'oven')))
     || ' left, with ' || round(placed_ash((select p from placed p where p.id = :'oven'))::numeric, 1) || ' of ashes in it';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'take_ashes_oven', ('{"kind":"furniture","id":' || :'oven' || '}')::jsonb) \g /dev/null
select '370. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'put_out_oven', ('{"kind":"furniture","id":' || :'oven' || '}')::jsonb) \g /dev/null
select '371. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);

\echo ''
\echo '--- a lantern, and the candle that burns only while it is lit'
select give(:'world2', :'ivar', 'lantern', 1, 60) \g /dev/null
select id as lamp from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'lantern' limit 1 \gset
select '372. a lantern at QL 60 throws ' || lantern_reach(60) || ' tiles and takes '
     || round(candle_burn(60) / 60) || ' minutes of candle — as it stands: '
     || lantern_state((select i from item i where i.id = :'lamp'))
     || ', and striking it: ' || coalesce(act_refusal(:'world2', :'ivar', 'light_lantern',
        ('{"kind":"item","uid":' || :'lamp' || '}')::jsonb), 'allowed');
select give(:'world2', :'ivar', 'candle', 2, 50) \g /dev/null
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'candle_lantern', ('{"kind":"item","uid":' || :'lamp' || '}')::jsonb) \g /dev/null
select '373. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — ' || lantern_state((select i from item i where i.id = :'lamp'));
/*
 * The browser asks for a tinderbox to strike a light, and there is no
 * tinderbox anywhere in the game — not in the item list, not in a recipe,
 * nowhere but that one check and a help page promising it. So a lantern
 * cannot be lit there either. Ported as written and measured, rather than
 * quietly given an item the game has never had.
 */
select '374. striking it with a candle in: ' || coalesce(act_refusal(:'world2', :'ivar', 'light_lantern',
       ('{"kind":"item","uid":' || :'lamp' || '}')::jsonb), 'allowed')
     || ' — and there is no such thing as a tinderbox in this game: '
     || (select count(*) from item_def where id = 'tinderbox') || ' of them';
-- So the burn is measured by striking it on the row, which is what the action
-- would have done had the item it asks for ever existed.
update item set lit = true, lit_at = now() - interval '5 minutes' where id = :'lamp';
select '375. five minutes lit: ' || lantern_state((select i from item i where i.id = :'lamp'));
update item set lit = false, lit_at = null where id = :'lamp';
select '376. and five minutes dark: ' || lantern_state((select i from item i where i.id = :'lamp'))
     || ' — a lantern in your pack costs you nothing but the weight of it';
update item set lit = true, lit_at = now() - interval '5 minutes' where id = :'lamp';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'douse_lantern', ('{"kind":"item","uid":' || :'lamp' || '}')::jsonb) \g /dev/null
select '377. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — ' || lantern_state((select i from item i where i.id = :'lamp'));

\echo ''
\echo '--- an anvil, and what is beaten out on it'
select give(:'world2', :'ivar', 'anvil', 1, 70, 'Iron') \g /dev/null
select id as anvil_item from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'anvil' order by id desc limit 1 \gset
update player set x = 8.5, y = 7.5 where world_id = :'world2' and uid = :'ivar';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'place_anvil',
  ('{"kind":"tile","x":8,"y":8,"sx":0,"sy":0,"uid":' || :'anvil_item' || '}')::jsonb) \g /dev/null
select id as anvil from placed where world_id = :'world2' and kind = 'anvil' order by id desc limit 1 \gset
select '378. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — it is worth ' || round(anvil_ql((select p from placed p where p.id = :'anvil'))::numeric, 1)
     || ' to beat on, from a quality of 70, because what a thing is made of decides how kindly it works';
select '379. and another on the same four subtiles: ' || coalesce(anvil_place_reason(:'world2', 8, 8, 0, 0), 'allowed');

select give(:'world2', :'ivar', 'shovel_head_mould', 1, 60) \g /dev/null
select give(:'world2', :'ivar', 'iron_lump', 8, 55, 'Iron') \g /dev/null
select id as mould from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'shovel_head_mould' limit 1 \gset
insert into skill (world_id, uid, id, value) values (:'world2', :'ivar', 'blacksmithing', 55)
  on conflict (world_id, uid, id) do update set value = 55;
select '380. a shovel head mould at QL 60 has ' || mould_uses_left(60, 0) || ' fillings in it'
     || ', and a rough one at QL 10 has ' || mould_uses_left(10, 0)
     || ' — smithing with no mould chosen: ' || coalesce(act_refusal(:'world2', :'ivar', 'smith',
        ('{"kind":"anvil","id":' || :'anvil' || '}')::jsonb), 'allowed')
     || ' | with an anvil mould: ' || coalesce(act_refusal(:'world2', :'ivar', 'smith',
        ('{"kind":"anvil","id":' || :'anvil' || ',"mould":' || (select give(:'world2', :'ivar', 'anvil_mould', 1, 50)) || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
do $$
declare w uuid := (select id from world where name <> 'Rockhaven' order by made_at limit 1);
        me uuid := '11111111-1111-1111-1111-111111111111'; i int;
        a bigint := (select id from placed where kind = 'anvil' order by id desc limit 1);
        m bigint := (select id from item where holder_uid = '11111111-1111-1111-1111-111111111111'
                       and def = 'shovel_head_mould' limit 1);
begin
  for i in 1..6 loop
    exit when act_refusal(w, me, 'smith', jsonb_build_object('kind', 'anvil', 'id', a, 'mould', m)) is not null;
    perform act_perform(w, me, 'smith', jsonb_build_object('kind', 'anvil', 'id', a, 'mould', m));
  end loop;
end $$;
select '381. six goes at it: ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'event');
select '382. shovel heads in the pack: ' || pack_count(:'world2', :'ivar', 'shovel_head')
     || ', lumps left ' || pack_count(:'world2', :'ivar', 'iron_lump')
     || ', and the mould is at ' || coalesce((select round(dmg::numeric, 1)::text from item where id = :'mould'), 'cracked through')
     || ' damage with ' || coalesce((select mould_uses_left(ql, dmg)::text from item where id = :'mould'), '0')
     || ' fillings left — no mould can be mended';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'pick_up_anvil', ('{"kind":"anvil","id":' || :'anvil' || '}')::jsonb) \g /dev/null
select '383. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — anvils standing about: ' || (select count(*) from placed where world_id = :'world2' and kind = 'anvil')
     || ', and in the pack: ' || pack_count(:'world2', :'ivar', 'anvil');
select '384. the ten the forge brought: '
     || (select string_agg(id, ', ' order by id) from action_def where forge_action(id))
     || ' — of 374 the island now does ' || (select count(*) from action_def where act_ported(id));

\echo ''
\echo '--- a satchel, and the whole reason bags waited three commits'
update player set x = 5.5, y = 7.5 where world_id = :'world2' and uid = :'ivar';
delete from item where world_id = :'world2' and holder = 'player' and holder_uid = :'ivar' and def = 'plank';
select give(:'world2', :'ivar', 'plank', 9, 45, 'Oak'), give(:'world2', :'ivar', 'nail', 20, 40) \g /dev/null
select give(:'world2', :'ivar', 'satchel', 1, 50) \g /dev/null
select id as bag from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'satchel' limit 1 \gset
select id as planks from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'plank' limit 1 \gset
select '385. a satchel takes ' || bag_room('satchel') || ', a sack ' || bag_room('sack')
     || ', a backpack ' || bag_room('backpack')
     || ' — and putting one bag inside another: ' || coalesce(act_refusal(:'world2', :'ivar', 'stow_item',
        ('{"kind":"item","uid":' || :'bag' || '}')::jsonb), 'allowed');
select '386. nine planks in the pack: ' || pack_count(:'world2', :'ivar', 'plank')
     || ', and a shield, which takes four of them: ' || coalesce(act_refusal(:'world2', :'ivar',
        'make_wooden_shield', '{"kind":"tile","x":5,"y":7}'::jsonb), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'stow_item', ('{"kind":"item","uid":' || :'planks' || ',"count":7}')::jsonb) \g /dev/null
select '387. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — to hand now: ' || pack_count(:'world2', :'ivar', 'plank')
     || ', in the satchel: ' || bag_units(:'bag') || ' of ' || bag_room('satchel');
select '388. and the same shield now: ' || coalesce(act_refusal(:'world2', :'ivar',
       'make_wooden_shield', '{"kind":"tile","x":5,"y":7}'::jsonb), 'allowed')
     || ' — which is the whole of what a bag means: it is yours, it is not to hand';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'empty_bag', ('{"kind":"item","uid":' || :'bag' || '}')::jsonb) \g /dev/null
select '389. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — to hand again: ' || pack_count(:'world2', :'ivar', 'plank')
     || ', in one stack: ' || (select count(*) from item where world_id = :'world2'
          and holder_uid = :'ivar' and holder = 'player' and def = 'plank');

\echo ''
\echo '--- a chest, a bulk bin, and a crate with a rotten bottom'
delete from placed where world_id = :'world2' and kind = 'furniture'
  and sub in ('chest', 'bulk_bin', 'trash_crate');
select give(:'world2', :'ivar', 'chest', 1, 50), give(:'world2', :'ivar', 'bulk_bin', 1, 50),
       give(:'world2', :'ivar', 'trash_crate', 1, 40) \g /dev/null
do $$
declare w uuid := (select id from world where name <> 'Rockhaven' order by made_at limit 1);
        me uuid := '11111111-1111-1111-1111-111111111111'; r record; n int := 0;
begin
  for r in select id, def from item where world_id = w and holder_uid = me
    and def in ('chest', 'bulk_bin', 'trash_crate') order by def
  loop
    perform act_perform(w, me, 'place_furniture',
      jsonb_build_object('kind', 'item', 'uid', r.id, 'x', 5, 'y', 6, 'sx', n * 2, 'sy', 0));
    n := n + 1;
  end loop;
end $$;
update player set x = 5.5, y = 6.5 where world_id = :'world2' and uid = :'ivar';
select id as chest from placed where world_id = :'world2' and sub = 'chest' order by id desc limit 1 \gset
select id as bin from placed where world_id = :'world2' and sub = 'bulk_bin' order by id desc limit 1 \gset
select id as bin_trash from placed where world_id = :'world2' and sub = 'trash_crate' order by id desc limit 1 \gset
select '390. standing at a chest of ' || furniture_capacity((select p from placed p where p.id = :'chest'))
     || ', a bulk bin of ' || furniture_capacity((select p from placed p where p.id = :'bin'))
     || ' and a trash crate of ' || furniture_capacity((select p from placed p where p.id = :'bin_trash'));
select '391. what each of them says to a hatchet: chest — '
     || coalesce(furniture_refuses((select p from placed p where p.id = :'chest'), 'hatchet'), 'it will take it')
     || ' | bulk bin — '
     || coalesce(furniture_refuses((select p from placed p where p.id = :'bin'), 'hatchet'), 'it will take it')
     || ' | a barrel — '
     || coalesce(furniture_refuses((select p from placed p where p.id = :'barrel'), 'hatchet'), 'it will take it');
select id as hatchet2 from item where world_id = :'world2' and holder_uid = :'ivar' and holder = 'player'
  and def = 'hatchet' order by id desc limit 1 \gset
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'store_in_furniture', ('{"kind":"item","uid":' || :'hatchet2' || '}')::jsonb) \g /dev/null
select '392. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — the chest holds ' || furniture_units((select p from placed p where p.id = :'chest'));
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'furniture_take_all', ('{"kind":"furniture","id":' || :'chest' || '}')::jsonb) \g /dev/null
select '393. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and it is now ' || furniture_units((select p from placed p where p.id = :'chest')) || ' deep';
select id as rot from item where world_id = :'world2' and holder_uid = :'ivar' and holder = 'player'
  and def = 'plank' order by id limit 1 \gset
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'throw_away', ('{"kind":"item","uid":' || :'rot' || ',"count":2}')::jsonb) \g /dev/null
select '394. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — the trash crate holds ' || furniture_units((select p from placed p where p.id = :'bin_trash'));

\echo ''
\echo '--- and who may read what is in them'
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select '395. Hild reads the island''s stores: ' || (select count(*) from item where holder = 'furniture')
     || ' things put away, and Ivar''s satchel: ' || (select count(*) from item where holder = 'bag')
     || ' — a thing in somebody else''s bag is still somebody else''s';
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select '396. the five that hold things: '
     || (select string_agg(id, ', ' order by id) from action_def where holding_action(id))
     || ' — of 374 the island now does ' || (select count(*) from action_def where act_ported(id));

\echo ''
\echo '--- a settlement grows by being built up'
update deed set level = 1, radius = deed_radius(1) where world_id = :'world2';
update player set x = 5.5, y = 7.5 where world_id = :'world2' and uid = :'ivar';
select '397. Stonehaven at level 1 reaches ' || (select radius from deed where world_id = :'world2')
     || ' tiles and works ' || worker_cap(:'world2') || ' wildermon — and level 5 would reach '
     || deed_radius(5) || ' with 5';
select '398. what level 2 wants: ' || (select string_agg(label || ' (' ||
       case when met then 'standing' else 'wanted' end || ')', ', ' order by label)
       from upgrade_wants(:'world2', 2))
     || ' — so: ' || coalesce(upgrade_reason(:'world2'), 'allowed');
-- A campfire on the deed is the one thing level 2 is short of.
delete from placed where world_id = :'world2' and kind = 'campfire';
select '399. with no campfire: ' || coalesce(upgrade_reason(:'world2'), 'allowed');
insert into placed (world_id, kind, x, y, sx, sy, cx, cy, fuel)
values (:'world2', 'campfire', 5, 8, 0, 0, 5.5, 8.5, 120);
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'upgrade_deed', '{"kind":"tile","x":5,"y":7}'::jsonb) \g /dev/null
select '400. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
select '401. and on to 3: ' || coalesce(upgrade_reason(:'world2'), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'rename_deed', '{"kind":"tile","x":5,"y":7,"name":"Ironhearth"}'::jsonb) \g /dev/null
select '402. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — and with no name at all: ' || coalesce(act_refusal(:'world2', :'ivar', 'rename_deed',
        '{"kind":"tile","x":5,"y":7,"name":"  "}'::jsonb), 'allowed');

\echo ''
\echo '--- a work post, which rots where it stands'
delete from creature where world_id = :'world2' and mode in ('deed', 'stored', 'wild');
delete from placed where world_id = :'world2' and kind = 'post';
select '403. a rough post stands ' || round(post_life(1) / 60) || ' minutes and reaches '
     || post_radius(1) || ' tiles; the best that can be made stands ' || round(post_life(100) / 60)
     || ' and reaches ' || post_radius(100);
select give(:'world2', :'ivar', 'work_post', 1, 30, 'Pine') \g /dev/null
select id as post_item from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'work_post'
  order by id desc limit 1 \gset
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'place_post',
  ('{"kind":"tile","x":9,"y":7,"sx":1,"sy":1,"uid":' || :'post_item' || '}')::jsonb) \g /dev/null
select id as post from placed where world_id = :'world2' and kind = 'post' order by id desc limit 1 \gset
select '404. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
update player set x = 9.5, y = 7.5 where world_id = :'world2' and uid = :'ivar';
-- Something for it to clear away, out by the post rather than by the token.
select drop_on_ground(:'world2', 9, 8, 'corpse', 30, 'Rabba'),
       drop_on_ground(:'world2', 10, 7, 'corpse', 30, 'Rabba') \g /dev/null
select creature_spawn(:'world2', 'middun', 5.5, 6.5, 'stored', now() - interval '3 hours', :'ivar') as posted \gset
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'assign_post',
  ('{"kind":"post","id":' || :'post' || ',"creature":' || :'posted' || '}')::jsonb) \g /dev/null
select '405. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
select '406. it takes its orders from ' || (select coalesce(post::text, 'the token') from creature where id = :'posted')
     || ', and the site it works out of is ' || (select x || ',' || y || ' within ' || radius || ' tiles'
        from work_site(:'world2', (select c from creature c where c.id = :'posted')))
     || ' — a post holds it to the post''s reach however much it has learned';
-- Ten minutes of it, out of the post rather than the token.
update creature set phase = 'idle', until = now() - interval '600 seconds',
    leg_at = now() - interval '600 seconds', leg_ends = now() - interval '600 seconds',
    settled_at = now() - interval '600 seconds' where id = :'posted';
select worker_settle(:'world2', :'posted') as posted_work \gset
select '407. ten minutes out of the post: ' || :'posted_work' || ' rounds of work — '
     || (select count(*) from item where world_id = :'world2' and holder = 'ground' and def = 'corpse')
     || ' carcasses left by the post, and it is at '
     || (select floor(to_x) || ',' || floor(to_y) from creature where id = :'posted')
     || ', which is ' || (select greatest(abs(floor(to_x) - 9), abs(floor(to_y) - 7))
        from creature where id = :'posted') || ' tiles from the post';

-- And the post goes over, which is the part no other settling does.
select '408. as it stands: ' || post_state((select p from placed p where p.id = :'post'));
update placed set dmg = 0, since = now() - interval '40 minutes' where id = :'post';
select round(post_dmg((select p from placed p where p.id = :'post'))::numeric) as half \gset
select '409. forty minutes into a seventy-four minute post: ' || :'half'
     || ' gone, and it is still standing — a post settles to a number like everything else';
update placed set dmg = 0, since = now() - interval '2 hours' where id = :'post';
delete from event where uid = :'ivar';
select post_sweep(:'world2') as fallen \gset
select '410. two hours nobody watched: ' || :'fallen' || ' post went over, '
     || (select count(*) from placed where world_id = :'world2' and kind = 'post') || ' left standing'
     || ' — and ' || coalesce((select text from event where uid = :'ivar' order by n desc limit 1),
          'nobody was told, which would be a bug');
select '411. and the middun: it takes its orders from '
     || (select coalesce(post::text, 'the token') from creature where id = :'posted')
     || ', standing at ' || (select floor(to_x) || ',' || floor(to_y) from creature where id = :'posted')
     || ' — which is the token, where it came home to';

\echo ''
\echo '--- and giving the whole thing up'
select give(:'world2', :'ivar', 'work_post', 1, 60, 'Oak') \g /dev/null
select act_perform(:'world2', :'ivar', 'place_post',
  ('{"kind":"tile","x":9,"y":7,"sx":2,"sy":2,"uid":' || (select id from item where world_id = :'world2'
     and holder_uid = :'ivar' and def = 'work_post' order by id desc limit 1) || '}')::jsonb) \g /dev/null
select id as post2 from placed where world_id = :'world2' and kind = 'post' order by id desc limit 1 \gset
update placed set dmg = 50, since = now() where id = :'post2';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'pick_up_post', ('{"kind":"post","id":' || :'post2' || '}')::jsonb) \g /dev/null
select '412. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — it went in at QL 60 and comes up at '
     || (select round(ql::numeric, 1) from item where world_id = :'world2' and holder_uid = :'ivar'
         and def = 'work_post' order by id desc limit 1) || ', half rotten';
update player set x = 5.5, y = 7.5 where world_id = :'world2' and uid = :'ivar';
select '413. on the deed before it goes: ' || (select count(*) from creature where world_id = :'world2'
       and mode in ('deed', 'stored')) || ' kept, and ' || (select coalesce(sum(count), 0) from item
       where world_id = :'world2' and holder = 'crate') || ' things in the settlement crate';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'disband_deed', '{"kind":"tile","x":5,"y":7}'::jsonb) \g /dev/null
select '414. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
select '415. after: ' || (select count(*) from deed where world_id = :'world2') || ' settlement, '
     || (select count(*) from crate where world_id = :'world2' and deed) || ' deed crate, and '
     || (select count(*) from creature where world_id = :'world2' and mode = 'wild') || ' running wild'
     || ' — founding again: ' || coalesce(act_refusal(:'world2', :'ivar', 'found_settlement',
        ('{"kind":"item","uid":' || (select give(:'world2', :'ivar', 'deed_stake', 1, 50)) || '}')::jsonb), 'allowed');
select '416. the seven the settlement brought: '
     || (select string_agg(id, ', ' order by id) from action_def where settlement_action(id))
     || ' — of 374 the island now does ' || (select count(*) from action_def where act_ported(id));

\echo ''
\echo '--- and a thing made of nothing in particular'
/*
 * The live smoke test found this by looking at the first thing in the pack,
 * which is something this file had never done: every examine here was of a
 * thing it had put there itself, with a material on it. The kit had a `knife`
 * in it that does not exist in this game, and a null in a concatenation is a
 * null all the way out, so the action died on a not-null constraint rather
 * than saying a word.
 */
select '417. things in the kit with no definition behind them: '
     || (select count(*) from item i left join item_def d on d.id = i.def where d.id is null)
     || ' — and the kit itself is ' || (select count(*) from item where world_id = :'world2'
          and holder_uid = :'hild' and holder = 'player' and issued) || ' issued tools plus a stake';
select give(:'world2', :'ivar', 'bucket', 1, 42) \g /dev/null
select '418. examining a bucket, which is made of nothing in particular: '
     || examine_item_text(:'world2', :'ivar', (select i from item i where i.world_id = :'world2'
          and i.holder_uid = :'ivar' and i.def = 'bucket' and i.extra is null order by i.id desc limit 1));
select '419. and one with a material on it: '
     || examine_item_text(:'world2', :'ivar', (select i from item i where i.world_id = :'world2'
          and i.holder_uid = :'ivar' and i.extra is not null order by i.id desc limit 1));

\echo ''
\echo '--- what the old people left in the ground'
update player set x = 8.5, y = 9.5 where world_id = :'world2' and uid = :'ivar';
select land_set_tile(:'world2', 8, 10, 1) \g /dev/null
delete from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'fragment';
select '420. the eight things under this island: '
     || (select string_agg(name || ' (' || parts || ' pieces, ' || result || ')', ', ' order by difficulty)
         from relic_def);
select '421. an archaeologist at 1 would know ' || (select count(*) from relics_within(1))
     || ' of them, at 30 ' || (select count(*) from relics_within(30))
     || ', at 60 ' || (select count(*) from relics_within(60))
     || ' — and a turn of the trowel at 30 with a QL 40 trowel finds something '
     || round(find_chance(30, 40) * 100) || ' times in a hundred';
update item set holder = 'ground', holder_uid = null, gx = 0, gy = 0
  where world_id = :'world2' and holder_uid = :'ivar' and def = 'trowel';
select '422. with no trowel in hand: ' || coalesce(act_refusal(:'world2', :'ivar', 'investigate',
       '{"kind":"tile","x":8,"y":10}'::jsonb), 'allowed')
     || ' | on bare rock: ' || coalesce(act_refusal(:'world2', :'ivar', 'investigate',
        '{"kind":"tile","x":5,"y":5}'::jsonb), 'allowed');
select give(:'world2', :'ivar', 'trowel', 1, 40) \g /dev/null
insert into skill (world_id, uid, id, value) values (:'world2', :'ivar', 'archaeology', 45)
  on conflict (world_id, uid, id) do update set value = 45;
insert into skill (world_id, uid, id, value) values (:'world2', :'ivar', 'restoration', 70)
  on conflict (world_id, uid, id) do update set value = 70;
delete from event where uid = :'ivar';
do $$
declare w uuid := (select id from world where name <> 'Rockhaven' order by made_at limit 1);
        me uuid := '11111111-1111-1111-1111-111111111111'; v_x int; v_y int;
begin
  -- Fresh ground every time: one turn of the trowel per tile is all it gives.
  for v_y in 9..14 loop for v_x in 6..13 loop
    perform land_set_tile(w, v_x, v_y, 1);
    update player set x = v_x + 0.5, y = v_y + 0.5 where world_id = w and uid = me;
    if act_refusal(w, me, 'investigate', jsonb_build_object('kind','tile','x',v_x,'y',v_y)) is null then
      perform act_perform(w, me, 'investigate', jsonb_build_object('kind','tile','x',v_x,'y',v_y));
    end if;
  end loop; end loop;
end $$;
select '423. forty-eight tiles gone over at archaeology 45: '
     || (select count(*) from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'fragment')
     || ' fragments, of ' || (select count(distinct fragment_relic(extra)) from item
          where world_id = :'world2' and holder_uid = :'ivar' and def = 'fragment') || ' different things'
     || ' — and going over the same ground again: ' || coalesce(act_refusal(:'world2', :'ivar',
        'investigate', '{"kind":"tile","x":8,"y":10}'::jsonb), 'allowed');
select '424. what has come up: ' || (select string_agg(fragment_relic(extra) || ' ' || fragment_part(extra)
       || '/' || (select parts from relic_def r where r.name = fragment_relic(i.extra)), ', '
       order by fragment_relic(extra), fragment_part(extra))
       from item i where i.world_id = :'world2' and i.holder_uid = :'ivar' and i.def = 'fragment');

-- Putting one back together.
select fragment_relic(extra) as relic from item where world_id = :'world2' and holder_uid = :'ivar'
  and def = 'fragment' order by fragment_relic(extra) limit 1 \gset
select '425. of the ' || (select parts from relic_def where name = :'relic') || ' pieces of the '
     || :'relic' || ' he has ' || (select count(*) from pieces_held(:'world2', :'ivar', :'relic'))
     || ', and is short ' || coalesce(array_to_string(parts_missing(:'world2', :'ivar', :'relic'), ', '), 'none')
     || ' — so restoring it: ' || coalesce(act_refusal(:'world2', :'ivar', 'restore_relic',
        ('{"kind":"item","uid":' || (select id from item where world_id = :'world2' and holder_uid = :'ivar'
           and def = 'fragment' and fragment_relic(extra) = :'relic' order by id limit 1) || '}')::jsonb), 'allowed');
-- The rest of the pieces of one thing, so there is something to put back.
do $$
declare w uuid := (select id from world where name <> 'Rockhaven' order by made_at limit 1);
        me uuid := '11111111-1111-1111-1111-111111111111';
        r relic_def; n int; made bigint;
begin
  select * into r from relic_def order by difficulty limit 1;
  delete from item where world_id = w and holder_uid = me and def = 'fragment';
  for n in 1..r.parts loop
    made := give(w, me, 'fragment', 1, 55, r.name || ' ' || n || '/' || r.parts);
    update item set dmg = 30 where id = made;
  end loop;
end $$;
select name as whole from relic_def order by difficulty limit 1 \gset
select '426. every piece of the ' || :'whole' || ' in hand at QL 55 and 30 damage: '
     || coalesce(act_refusal(:'world2', :'ivar', 'restore_relic',
        ('{"kind":"item","uid":' || (select id from item where world_id = :'world2' and holder_uid = :'ivar'
           and def = 'fragment' order by id limit 1) || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
do $$
declare w uuid := (select id from world where name <> 'Rockhaven' order by made_at limit 1);
        me uuid := '11111111-1111-1111-1111-111111111111'; i int; f bigint;
begin
  for i in 1..8 loop
    select id into f from item where world_id = w and holder_uid = me and def = 'fragment' order by id limit 1;
    exit when f is null;
    exit when act_refusal(w, me, 'restore_relic', jsonb_build_object('kind','item','uid',f)) is not null;
    perform act_perform(w, me, 'restore_relic', jsonb_build_object('kind','item','uid',f));
  end loop;
end $$;
select '427. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'event');

\echo ''
\echo '--- and a nose that does the digging for you'
select '428. a snout is the twenty-second trade: '
     || (select count(*) from (values ('forage'), ('botanize'), ('woodcut'), ('farm'), ('mine'), ('sand'),
                                      ('clay'), ('quarry'), ('stoke'), ('fetch'), ('guard'), ('hunt'),
                                      ('peat'), ('reed'), ('water'), ('prospect'), ('plant'), ('hod'),
                                      ('mend'), ('compost'), ('seek'), ('fish')) v(k) where worker_job_ported(v.k))
     || ' of twenty-two, which is all of them';
insert into deed (world_id, name, x, y, radius, level, founded_by)
values (:'world2', 'Lastfound', 8, 11, deed_radius(3), 3, :'ivar')
on conflict (world_id) do update set name = 'Lastfound', x = 8, y = 11, radius = deed_radius(3), level = 3;
select place_deed_crate(:'world2') \g /dev/null
delete from creature where world_id = :'world2' and mode in ('deed', 'stored', 'wild');
do $$
declare w uuid := (select id from world where name <> 'Rockhaven' order by made_at limit 1);
        v_x int; v_y int;
begin
  for v_y in 5..15 loop for v_x in 2..14 loop
    perform land_set_tile(w, v_x, v_y, 1);
  end loop; end loop;
  delete from foraged f where f.world_id = w and f.kind = 'dig';
end $$;
select creature_spawn(:'world2', 'snout', 8.5, 11.5, 'deed', now() - interval '3 hours', :'ivar') as nose \gset
update creature set phase = 'idle', until = now() - interval '900 seconds',
    leg_at = now() - interval '900 seconds', leg_ends = now() - interval '900 seconds',
    settled_at = now() - interval '900 seconds' where id = :'nose';
select worker_settle(:'world2', :'nose') as nosed \gset
select '429. a quarter of an hour of a snout: ' || :'nosed' || ' holes dug, '
     || (select count(*) from foraged where world_id = :'world2' and kind = 'dig') || ' patches of ground gone over'
     || ', and in the crate: ' || coalesce((select count(*)::text from item where world_id = :'world2'
          and holder = 'crate' and def = 'fragment'), '0') || ' fragments';
select '430. the three that came with the relics: '
     || (select string_agg(id, ', ' order by id) from action_def where dig_action(id))
     || ' — of 374 the island now does ' || (select count(*) from action_def where act_ported(id));

\echo ''
\echo '--- what you catch while you are somewhere else'
delete from placed where world_id = :'world2' and kind = 'trap';
delete from creature where world_id = :'world2' and mode = 'wild';
update player set x = 2.5, y = 3.5 where world_id = :'world2' and uid = :'ivar';
select '431. the three of them: ' || (select string_agg(name || ' — holds taming ' || holds
       || ', reaches ' || reach || ', ' || round(odds * 100) || ' in a hundred a roll, stands '
       || round(life_min / 60) || '–' || round(life_max / 60) || ' minutes', ' | ' order by difficulty)
       from trap_def);
select give(:'world2', :'ivar', 'snare', 1, 60, 'Oak') \g /dev/null
select id as snare_item from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'snare'
  order by id desc limit 1 \gset
select '432. inside your own borders: ' || coalesce(act_refusal(:'world2', :'ivar', 'set_trap',
       ('{"kind":"tile","x":8,"y":11,"sx":0,"sy":0,"uid":' || :'snare_item' || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'set_trap',
  ('{"kind":"tile","x":2,"y":4,"sx":1,"sy":1,"uid":' || :'snare_item' || '}')::jsonb) \g /dev/null
select id as snare from placed where world_id = :'world2' and kind = 'trap' order by id desc limit 1 \gset
select '433. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
select '434. as it stands: ' || trap_state((select p from placed p where p.id = :'snare'))
     || ' — and an hour of an unbaited trap catches ' ||
       (select case when trap_settle(:'snare') then 'nothing, it rotted' else 'nothing at all' end);

/*
 * Bait it, and put something in reach that would come to it.
 *
 * The pack is cleared of everything edible first, and not for tidiness: bait
 * is whatever comes first in the pack, exactly as the browser takes it, so a
 * sprig of mint left over from the cooking section was what went in the noose
 * — and no rabba eats mint, so the snare sat baited for an hour and caught
 * nothing. Faithful, and a useless measurement.
 */
delete from item where world_id = :'world2' and holder = 'player' and holder_uid = :'ivar'
  and exists (select 1 from species_diet sd where sd.item = item.def);
select give(:'world2', :'ivar', 'blueberry', 3, 40) \g /dev/null
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'bait_trap', ('{"kind":"trap","id":' || :'snare' || '}')::jsonb) \g /dev/null
select '435. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
select creature_spawn(:'world2', 'rabba', 2.6, 4.6, 'wild', now() - interval '2 hours') as prey2 \gset
update creature set from_x = to_x, from_y = to_y, leg_at = now(), leg_ends = now(),
    until = now() + interval '2 hours', settled_at = now() - interval '1 second' where id = :'prey2';
select '436. a rabba a stride from the noose: it would be caught '
     || round(catch_chance((select p from placed p where p.id = :'snare'),
                           (select c from creature c where c.id = :'prey2')) * 100)
     || ' times in a hundred a roll, and a roll is every ' || trap_check_every() || ' seconds'
     || ' — so an hour of it is ' || floor(3600 / trap_check_every()) || ' rolls, which is a certainty';
update placed set since = now() - interval '1 hour' where id = :'snare';
delete from event where uid = :'ivar';
select trap_settle(:'snare') \g /dev/null
select '437. an hour nobody watched: ' || trap_state((select p from placed p where p.id = :'snare'))
     || ' — and it said: ' || coalesce((select text from event where uid = :'ivar' order by n desc limit 1), 'nothing');
select '438. the rabba knows it: it is held by trap '
     || coalesce((select trapped::text from creature where id = :'prey2'), 'nothing')
     || ', and standing at ' || (select round(to_x::numeric, 1) || ',' || round(to_y::numeric, 1)
        from creature where id = :'prey2') || ', which is the noose';

-- Getting it out is a skill, and taking the trap up first is not allowed.
select '439. taking the trap up with something in it: ' || coalesce(act_refusal(:'world2', :'ivar',
       'pick_up_trap', ('{"kind":"trap","id":' || :'snare' || '}')::jsonb), 'allowed');
insert into skill (world_id, uid, id, value) values (:'world2', :'ivar', 'taming', 60)
  on conflict (world_id, uid, id) do update set value = 60;
delete from creature where world_id = :'world2' and mode = 'active';
delete from event where uid = :'ivar';
do $$
declare w uuid := (select id from world where name <> 'Rockhaven' order by made_at limit 1);
        me uuid := '11111111-1111-1111-1111-111111111111'; i int;
        t bigint := (select id from placed where kind = 'trap' order by id desc limit 1);
begin
  for i in 1..8 loop
    exit when act_refusal(w, me, 'take_catch', jsonb_build_object('kind','trap','id',t)) is not null;
    perform act_perform(w, me, 'take_catch', jsonb_build_object('kind','trap','id',t));
    exit when (select caught from placed where id = t) is null;
  end loop;
end $$;
select '440. ' || coalesce((select text from event where uid = :'ivar' and kind = 'event'
       order by n desc limit 1), 'it said nothing at all')
     || ' — the rabba is now ' || (select mode from creature where id = :'prey2')
     || ' and the trap is ' || trap_state((select p from placed p where p.id = :'snare'));

-- And the whole thing comes up again, half rotten.
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'pick_up_trap', ('{"kind":"trap","id":' || :'snare' || '}')::jsonb) \g /dev/null
select '441. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — it went down at QL 60 with nothing on it and comes up with '
     || (select round(dmg::numeric) from item where world_id = :'world2' and holder_uid = :'ivar'
         and def = 'snare' order by id desc limit 1) || ' damage on it, from an hour in the weather';
select '442. traps left standing: ' || (select count(*) from placed where world_id = :'world2' and kind = 'trap')
     || ' — and the six that came with them: '
     || (select string_agg(id, ', ' order by id) from action_def where trap_action(id))
     || ', of 374 the island now does ' || (select count(*) from action_def where act_ported(id));
/*
 * And the answer to that question is now nothing at all — which is what took
 * this measurement down the first time it was true, because `string_agg` over
 * no rows is null and a null in a sentence is a null all the way out. The
 * nineteenth time that has happened, and the last.
 */
select '443. and asked outright what it still cannot do: ' ||
       coalesce((select nullif(count(*), 0)::text || ' of them, the first eight being '
                 || (select string_agg(u, ', ') from (select u from rpc_unported() u limit 8) s)
                 from rpc_unported()),
                'nothing. Three hundred and seventy-three of three hundred and seventy-three')
     || ' — which is the question the live suite used to answer by trying six and'
     || ' filling its own head with the jobs that started';

\echo ''
\echo '--- a seat, a set of traces and the shafts of a cart'
delete from placed where world_id = :'world2' and kind = 'furniture';
delete from creature where world_id = :'world2';
update player set x = 5.5, y = 7.5 where world_id = :'world2' and uid = :'ivar';
select '444. what carries and what pulls: '
     || (select string_agg(name || ' (' || case when mount is not null then 'saddle' else 'traces only' end
         || ', pull ' || coalesce(pull, 0.25) || ')', ', ' order by id)
         from species_def where mount is not null or draught)
     || ' — and the tack is ' || (select string_agg(item, ' and ' order by ord) from tack_def);
select creature_spawn(:'world2', 'orse', 5.6, 7.6, 'active', now() - interval '1 day') as horse \gset
update creature set keeper = :'ivar', hunger = 1, from_x = to_x, from_y = to_y,
    leg_at = now(), leg_ends = now(), settled_at = now(), name = 'Greyfell' where id = :'horse';
select '445. with nothing in the pack: ' || coalesce(act_refusal(:'world2', :'ivar', 'tack_creature',
       ('{"kind":"creature","id":' || :'horse' || '}')::jsonb), 'allowed');
select give(:'world2', :'ivar', 'saddle', 1, 40) \g /dev/null
select give(:'world2', :'ivar', 'bridle', 1, 40) \g /dev/null
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'tack_creature',
  ('{"kind":"creature","id":' || :'horse' || '}')::jsonb) \g /dev/null
select '446. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and the tack is out of the pack: '
     || (select count(*) from item where world_id = :'world2' and holder_uid = :'ivar'
         and def in ('saddle', 'bridle')) || ' pieces left';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'mount_creature',
  ('{"kind":"creature","id":' || :'horse' || '}')::jsonb) \g /dev/null
select '447. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
/*
 * A green horse is no quicker than walking, and that is the browser's own
 * arithmetic rather than a slip: `footing` is 0.9 until something has been
 * learned on bad ground. What a horse is worth having is what it learns.
 */
select '448. how fast the island will believe you: ' || round(base_speed()::numeric, 2)
     || ' tiles a second on your own legs, and ' || round(travel_speed(:'world2', :'ivar')::numeric, 2)
     || ' up on a green Greyfell';
update creature set skills = jsonb_set(skills, '{climbing}', '60') where id = :'horse';
select '449. once it has learned the hills: ' || round(travel_speed(:'world2', :'ivar')::numeric, 2)
     || ' tiles a second, and a step of '
     || round(mount_step((select c from creature c where c.id = :'horse'))::numeric)
     || ' where your own legs take ' || round(max_step()::numeric)
     || ' — a horse is worth having for what it learns, not for what it is';
-- Nothing ticks, so the horse moves when the rider does and not before.
select drag_along(:'world2', :'ivar', 20.5, 30.5) \g /dev/null
update player set x = 20.5, y = 30.5 where world_id = :'world2' and uid = :'ivar';
select '450. fifteen tiles later Greyfell is at '
     || (select round(creature_x(c)::numeric, 1) || ',' || round(creature_y(c)::numeric, 1)
         from creature c where c.id = :'horse')
     || ' — which is under the saddle, because a mount does not walk, it is dragged along';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'dismount_creature',
  ('{"kind":"creature","id":' || :'horse' || '}')::jsonb) \g /dev/null
select '451. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and on your own legs again the ceiling is '
     || round(travel_speed(:'world2', :'ivar')::numeric, 2);

-- The shafts of a hand cart, which wants nothing in front of it at all.
update player set x = 5.5, y = 7.5 where world_id = :'world2' and uid = :'ivar';
select give(:'world2', :'ivar', 'cart', 1, 50, 'Pine') \g /dev/null
select act_perform(:'world2', :'ivar', 'place_furniture',
  ('{"kind":"item","uid":' || (select id from item where world_id = :'world2' and holder_uid = :'ivar'
     and def = 'cart' order by id desc limit 1) || ',"x":5,"y":7,"sx":0,"sy":0}')::jsonb) \g /dev/null
select id as cart from placed where world_id = :'world2' and sub = 'cart' order by id desc limit 1 \gset
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'pull_cart', ('{"kind":"furniture","id":' || :'cart' || '}')::jsonb) \g /dev/null
select '452. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
select drag_along(:'world2', :'ivar', 9.5, 12.5) \g /dev/null
update player set x = 9.5, y = 12.5 where world_id = :'world2' and uid = :'ivar';
-- A second cart, to be told you have your hands full. The same one is not a
-- second one: the browser lets you take hold of what you are already holding.
select give(:'world2', :'ivar', 'cart', 1, 50, 'Oak') \g /dev/null
select act_perform(:'world2', :'ivar', 'place_furniture',
  ('{"kind":"item","uid":' || (select id from item where world_id = :'world2' and holder_uid = :'ivar'
     and def = 'cart' order by id desc limit 1) || ',"x":9,"y":12,"sx":2,"sy":2}')::jsonb) \g /dev/null
select id as cart2 from placed where world_id = :'world2' and sub = 'cart' order by id desc limit 1 \gset
select '453. and it came: the cart is at ' || (select x || ',' || y from placed where id = :'cart')
     || ' — taking hold of the oak one as well: ' || coalesce(act_refusal(:'world2', :'ivar', 'pull_cart',
        ('{"kind":"furniture","id":' || :'cart2' || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'drop_cart', ('{"kind":"furniture","id":' || :'cart' || '}')::jsonb) \g /dev/null
select '454. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and it stays at ' || (select x || ',' || y from placed where id = :'cart') || ' now nobody has it';

-- A large cart, which will not stir until there is something in the yoke.
select give(:'world2', :'ivar', 'large_cart', 1, 50, 'Pine') \g /dev/null
select act_perform(:'world2', :'ivar', 'place_furniture',
  ('{"kind":"item","uid":' || (select id from item where world_id = :'world2' and holder_uid = :'ivar'
     and def = 'large_cart' order by id desc limit 1) || ',"x":9,"y":12,"sx":0,"sy":0}')::jsonb) \g /dev/null
select id as wain from placed where world_id = :'world2' and sub = 'large_cart' order by id desc limit 1 \gset
select '455. the ones that are driven: ' || (select string_agg(v.id || ' — ' || v.yokes || ' yokes, '
       || v.needs || ' needed, seat ' || v.seat, ' | ' order by v.yokes) from vehicle_def v)
     || ' — and the hulls: ' || (select string_agg(b.id || ' at ' || b.speed || ' in '
       || b.draught || ' of water' || case when b.sail then ' under sail' else ' on oars' end,
       ' | ' order by b.speed) from boat_def b);
select '456. with nothing in the yokes: ' || coalesce(act_refusal(:'world2', :'ivar', 'board_vehicle',
       ('{"kind":"furniture","id":' || :'wain' || '}')::jsonb), 'allowed');
update creature set to_x = 9.6, to_y = 12.6, from_x = 9.6, from_y = 12.6,
    leg_at = now(), leg_ends = now(), settled_at = now() where id = :'horse';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'hitch_creature',
  ('{"kind":"creature","id":' || :'horse' || '}')::jsonb) \g /dev/null
select '457. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
select creature_spawn(:'world2', 'orse', 9.7, 12.7, 'active', now() - interval '1 day') as horse2 \gset
update creature set keeper = :'ivar', hunger = 1, from_x = to_x, from_y = to_y,
    leg_at = now(), leg_ends = now(), settled_at = now(), name = 'Dunn',
    skills = jsonb_set(skills, '{climbing}', '20') where id = :'horse2';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'hitch_creature',
  ('{"kind":"creature","id":' || :'horse2' || '}')::jsonb) \g /dev/null
select '458. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and getting up on one of them now: ' || coalesce(act_refusal(:'world2', :'ivar',
        'mount_creature', ('{"kind":"creature","id":' || :'horse' || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'board_vehicle',
  ('{"kind":"furniture","id":' || :'wain' || '}')::jsonb) \g /dev/null
select '459. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
select '460. two in a pine cart make ' || round(vehicle_speed(:'world2', :'wain')::numeric, 2)
     || ' tiles a second and take a step of ' || round(vehicle_step(:'world2', :'wain')::numeric)
     || ' — the pair of them know ' || round(team_climb(:'world2', :'wain')::numeric)
     || ' of the hills between them, and the ceiling now allows '
     || round(travel_speed(:'world2', :'ivar')::numeric, 2);
select drag_along(:'world2', :'ivar', 14.5, 12.5) \g /dev/null
update player set x = 14.5, y = 12.5 where world_id = :'world2' and uid = :'ivar';
select '461. five tiles on: the cart is at ' || (select x || ',' || y from placed where id = :'wain')
     || ' and the team is at ' || (select string_agg(round(creature_x(c)::numeric, 1) || ','
        || round(creature_y(c)::numeric, 1), ' and ' order by c.id) from creature c
        where c.hitched_to = :'wain')
     || ' — the team goes where the cart goes, and the cart goes where the driver goes';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'leave_vehicle', ('{"kind":"furniture","id":' || :'wain' || '}')::jsonb) \g /dev/null
select '462. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and off the seat the ceiling is ' || round(travel_speed(:'world2', :'ivar')::numeric, 2)
     || ' again, with the pair of them still in the yokes';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'unhitch_creature',
  ('{"kind":"creature","id":' || :'horse' || '}')::jsonb) \g /dev/null
select '463. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — ' || (select count(*) from creature where world_id = :'world2' and hitched_to = :'wain')
     || ' left in the yokes';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'unhitch_team', ('{"kind":"furniture","id":' || :'wain' || '}')::jsonb) \g /dev/null
select '464. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and with the yokes empty nobody is driving: '
     || (select count(*) from placed where id = :'wain' and driver is not null) || ' hands on the reins';
update player set x = 14.5, y = 12.5 where world_id = :'world2' and uid = :'ivar';
update creature set to_x = 14.6, to_y = 12.6, from_x = 14.6, from_y = 12.6,
    leg_at = now(), leg_ends = now(), settled_at = now() where id = :'horse';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'untack_creature',
  ('{"kind":"creature","id":' || :'horse' || '}')::jsonb) \g /dev/null
select '465. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and it is back in the pack: ' || (select string_agg(def || ' at QL ' || round(ql::numeric), ', '
        order by def) from item where world_id = :'world2' and holder_uid = :'ivar'
        and def in ('saddle', 'bridle'));

-- And a hull, which asks nothing but that she is still floating.
select give(:'world2', :'ivar', 'rowing_boat', 1, 50, 'Pine') \g /dev/null
select act_perform(:'world2', :'ivar', 'place_furniture',
  ('{"kind":"item","uid":' || (select id from item where world_id = :'world2' and holder_uid = :'ivar'
     and def = 'rowing_boat' order by id desc limit 1) || ',"x":14,"y":12,"sx":0,"sy":0}')::jsonb) \g /dev/null
select id as boat from placed where world_id = :'world2' and sub = 'rowing_boat' order by id desc limit 1 \gset
select '466. a rowing boat dragged up a hillside that stands '
     || round(centre_height(:'world2', 14, 12)::numeric) || ' above the water, when she wants '
     || (select draught from boat_def where id = 'rowing_boat') || ' of it under her: '
     || coalesce(act_refusal(:'world2', :'ivar', 'board_vehicle',
        ('{"kind":"furniture","id":' || :'boat' || '}')::jsonb), 'allowed');
select '467. the eleven that came with the reins: '
     || (select string_agg(id, ', ' order by id) from action_def where ride_action(id))
     || ' — of 374 the island now does ' || (select count(*) from action_def where act_ported(id));

\echo ''
\echo '--- and what a thing has to be empty of before it will come up'
update player set x = 14.5, y = 12.5 where world_id = :'world2' and uid = :'ivar';
select act_perform(:'world2', :'ivar', 'hitch_creature',
  ('{"kind":"creature","id":' || :'horse2' || '}')::jsonb) \g /dev/null
select '468. with one in the yokes: ' || coalesce(act_refusal(:'world2', :'ivar', 'pick_up_furniture',
       ('{"kind":"furniture","id":' || :'wain' || '}')::jsonb), 'allowed');
/*
 * And from the seat of it — which needs the yokes emptied by hand, because
 * `Get down off it first.` is unreachable through a wheeled vehicle. Nobody
 * can board one without a team in front of it, and the browser asks about the
 * team before it asks about the driver, so the only thing that ever reaches
 * this line is a hull. Ported in the browser's order and reached here the only
 * way there is.
 */
select act_perform(:'world2', :'ivar', 'board_vehicle', ('{"kind":"furniture","id":' || :'wain' || '}')::jsonb) \g /dev/null
update creature set hitched_to = null where world_id = :'world2' and hitched_to = :'wain';
select '469. and from the seat of it: ' || coalesce(act_refusal(:'world2', :'ivar', 'pick_up_furniture',
       ('{"kind":"furniture","id":' || :'wain' || '}')::jsonb), 'allowed');
select act_perform(:'world2', :'ivar', 'leave_vehicle', ('{"kind":"furniture","id":' || :'wain' || '}')::jsonb) \g /dev/null
update player set x = 9.5, y = 12.5 where world_id = :'world2' and uid = :'ivar';
select act_perform(:'world2', :'ivar', 'pull_cart', ('{"kind":"furniture","id":' || :'cart' || '}')::jsonb) \g /dev/null
select '470. and a cart by the shafts: ' || coalesce(act_refusal(:'world2', :'ivar', 'pick_up_furniture',
       ('{"kind":"furniture","id":' || :'cart' || '}')::jsonb), 'allowed');
/*
 * The two that were here all along, and were worse than a missing refusal:
 * `item.placed` cascades, so lifting a chest with anything in it took the
 * contents with it, and lifting a barrel poured the water away in silence.
 */
select give(:'world2', :'ivar', 'chest', 1, 50, 'Oak') \g /dev/null
select act_perform(:'world2', :'ivar', 'place_furniture',
  ('{"kind":"item","uid":' || (select id from item where world_id = :'world2' and holder_uid = :'ivar'
     and def = 'chest' order by id desc limit 1) || ',"x":9,"y":12,"sx":3,"sy":3}')::jsonb) \g /dev/null
select id as chest from placed where world_id = :'world2' and sub = 'chest' order by id desc limit 1 \gset
insert into item (world_id, holder, placed, def, ql, count)
  values (:'world2', 'furniture', :'chest', 'nail', 40, 20);
select '471. a chest with twenty nails in it: ' || coalesce(act_refusal(:'world2', :'ivar',
       'pick_up_furniture', ('{"kind":"furniture","id":' || :'chest' || '}')::jsonb), 'allowed')
     || ' — and the nails are still there: '
     || (select coalesce(sum(count), 0) from item where holder = 'furniture' and placed = :'chest');
select give(:'world2', :'ivar', 'barrel', 1, 50, 'Oak') \g /dev/null
select act_perform(:'world2', :'ivar', 'place_furniture',
  ('{"kind":"item","uid":' || (select id from item where world_id = :'world2' and holder_uid = :'ivar'
     and def = 'barrel' order by id desc limit 1) || ',"x":9,"y":12,"sx":1,"sy":3}')::jsonb) \g /dev/null
select id as tun from placed where world_id = :'world2' and sub = 'barrel' order by id desc limit 1 \gset
update placed set litres = 30, liquid = 'water', since = now() where id = :'tun';
select '472. and a barrel with ' || round(placed_litres((select p from placed p where p.id = :'tun'))::numeric)
     || ' litres of water in it: ' || coalesce(act_refusal(:'world2', :'ivar', 'pick_up_furniture',
        ('{"kind":"furniture","id":' || :'tun' || '}')::jsonb), 'allowed');

\echo ''
\echo '--- an altar, and three ways of looking at all this'
delete from placed where world_id = :'world2' and kind = 'furniture';
delete from creature where world_id = :'world2';
delete from deed where world_id = :'world2';
update player set x = 5.5, y = 7.5, favour = 0, favour_at = now(), prayed_at = null,
    sat_at = null, way = null, used_at = '{}'::jsonb, wounds = '[]'::jsonb
  where world_id = :'world2' and uid = :'ivar';
delete from skill where world_id = :'world2' and uid = :'ivar' and id in ('prayer', 'meditation');
select '473. what a prayer buys: ' || (select string_agg(name || ' (' || cost || ' favour at prayer '
       || level || ', on ' || on_what || ')', ', ' order by level) from cast_def);
select '474. and the three ways: ' || (select string_agg(d.name || ' — ' ||
       (select string_agg(s.name, ', ' order by s.n) from path_step s where s.path = d.id),
       ' | ' order by d.id) from path_def d);
select '475. nothing to kneel at: ' || coalesce(act_refusal(:'world2', :'ivar', 'pray',
       '{"kind":"furniture","id":0}'::jsonb), 'allowed');
select give(:'world2', :'ivar', 'altar', 1, 70) \g /dev/null
select act_perform(:'world2', :'ivar', 'place_furniture',
  ('{"kind":"item","uid":' || (select id from item where world_id = :'world2' and holder_uid = :'ivar'
     and def = 'altar' order by id desc limit 1) || ',"x":5,"y":7,"sx":0,"sy":0}')::jsonb) \g /dev/null
select id as altar from placed where world_id = :'world2' and sub = 'altar' order by id desc limit 1 \gset
-- A second one, unplaced, so there is something to look at as well as kneel at.
select give(:'world2', :'ivar', 'altar', 1, 70) \g /dev/null
/*
 * An altar is one of eighteen things this game can make and had no definition
 * for — seventeen moulds and this. The browser calls it `altar` and gives it a
 * kilo, because `itemDef` hands back a fallback for anything it has not heard
 * of; down here a missing row was a null, and a null in a sentence is a null
 * all the way out. The rows are generated now, from the browser's own fallback.
 */
select '476. eighteen things with no definition behind them, now: '
     || (select count(*) from (select r.result as id from recipe r left join item_def d
         on d.id = r.result where d.id is null union select i.item from recipe_input i
         left join item_def d2 on d2.id = i.item where d2.id is null) z)
     || ' — and a spare altar in the pack says: '
     || coalesce(examine_item_text(:'world2', :'ivar', (select i from item i
        where i.world_id = :'world2' and i.holder_uid = :'ivar' and i.def = 'altar'
        order by i.id desc limit 1)), 'nothing at all');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'pray', ('{"kind":"furniture","id":' || :'altar' || '}')::jsonb) \g /dev/null
select '477. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — a QL 70 altar at ' || round(hour_of_day(:'world2')::numeric, 1) || ' o''clock is worth '
     || round(prayer_worth(70, hour_of_day(:'world2'), 0)::numeric, 1)
     || ', where dawn would be worth ' || round(prayer_worth(70, 6, 0)::numeric, 1);
select '478. and again today: ' || coalesce(act_refusal(:'world2', :'ivar', 'pray',
       ('{"kind":"furniture","id":' || :'altar' || '}')::jsonb), 'allowed');
-- Favour is a well: a rate, a ceiling, and a note of when anybody last looked.
update player set favour = 4, favour_at = now() - interval '1 hour'
  where world_id = :'world2' and uid = :'ivar';
select '479. four favour and an hour nobody looked: ' || round(favour_settle(:'world2', :'ivar')::numeric, 1)
     || ' — it fills at ' || favour_trickle() || ' a second up to '
     || round(favour_cap(skill_of(:'world2', :'ivar', 'prayer'))::numeric, 1)
     || ', which is what this much faith carries';
select '480. calling for something beyond us: ' || coalesce(act_refusal(:'world2', :'ivar', 'cast',
       '{"kind":"item","spell":"bounty"}'::jsonb), 'allowed');
insert into skill (world_id, uid, id, value) values (:'world2', :'ivar', 'prayer', 40)
  on conflict (world_id, uid, id) do update set value = 40;
update player set favour = 100, favour_at = now() where world_id = :'world2' and uid = :'ivar';
select id as issued from item where world_id = :'world2' and holder_uid = :'ivar' and issued limit 1 \gset
select '481. the circle on something we washed ashore with: ' || coalesce(act_refusal(:'world2', :'ivar',
       'cast', ('{"kind":"item","spell":"cunning","uid":' || :'issued' || '}')::jsonb), 'allowed');
select give(:'world2', :'ivar', 'hatchet', 1, 50, 'Steel') as made \gset
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'cast',
  ('{"kind":"item","spell":"cunning","uid":' || :'made' || '}')::jsonb) \g /dev/null
select '482. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — a steel hatchet at QL 50 was worth ' || round(tool_worth(50, 0, 'Steel', null, 0)::numeric, 1)
     || ' to work with and is now worth ' || round(tool_worth(50, 0, 'Steel', null, 1)::numeric, 1);
update item set bless = 3 where id = :'made';
update player set favour = 100, favour_at = now() where world_id = :'world2' and uid = :'ivar';
select '483. and a fourth time: ' || coalesce(act_refusal(:'world2', :'ivar', 'cast',
       ('{"kind":"item","spell":"cunning","uid":' || :'made' || '}')::jsonb), 'allowed')
     || ' — mending a thing with nothing wrong with it: '
     || coalesce(act_refusal(:'world2', :'ivar', 'cast',
        ('{"kind":"item","spell":"mend","uid":' || :'made' || '}')::jsonb), 'allowed');

-- The rug, and what comes of sitting on it.
select '484. sitting with nothing to sit on: ' || coalesce(act_refusal(:'world2', :'ivar', 'meditate',
       '{"kind":"tile","x":5,"y":7}'::jsonb), 'allowed');
select give(:'world2', :'ivar', 'rug', 1, 40) \g /dev/null
select '485. where you sit is most of it: ' || (select said from sitting_worth(:'world2', :'ivar'))
     || ' — worth ' || round((select gain from sitting_worth(:'world2', :'ivar'))::numeric, 2);
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'meditate', '{"kind":"tile","x":5,"y":7}'::jsonb) \g /dev/null
select '486. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — and again today: ' || coalesce(act_refusal(:'world2', :'ivar', 'meditate',
        '{"kind":"tile","x":5,"y":7}'::jsonb), 'allowed');
select '487. choosing before it is clear: ' || coalesce(act_refusal(:'world2', :'ivar', 'choose_path',
       '{"kind":"tile","material":"love"}'::jsonb), 'allowed');
insert into skill (world_id, uid, id, value) values (:'world2', :'ivar', 'meditation', 5)
  on conflict (world_id, uid, id) do update set value = 5;
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'choose_path', '{"kind":"tile","material":"love"}'::jsonb) \g /dev/null
select '488. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
select '489. and choosing again: ' || coalesce(act_refusal(:'world2', :'ivar', 'choose_path',
       '{"kind":"tile","material":"power"}'::jsonb), 'allowed');
-- Sitting until the path opens out. Each step announces itself as it arrives.
update player set sat_at = null where world_id = :'world2' and uid = :'ivar';
insert into skill (world_id, uid, id, value) values (:'world2', :'ivar', 'meditation', 11.6)
  on conflict (world_id, uid, id) do update set value = 11.6;
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'meditate', '{"kind":"tile","x":5,"y":7}'::jsonb) \g /dev/null
select '490. ' || coalesce((select string_agg(text, ' | ' order by n) from event
       where uid = :'ivar' and kind = 'system'), 'nothing opened out');
select '491. calling on something nobody taught us: ' || coalesce(act_refusal(:'world2', :'ivar',
       'use_ability', '{"kind":"tile","material":"fury"}'::jsonb), 'allowed');
update player set stats = jsonb_set(jsonb_set(stats, '{hunger}', '0.2'), '{thirst}', '0.1')
  where world_id = :'world2' and uid = :'ivar';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'use_ability', '{"kind":"tile","material":"refresh"}'::jsonb) \g /dev/null
select '492. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — hunger ' || (select round((stats->>'hunger')::numeric, 1) from player
        where world_id = :'world2' and uid = :'ivar')
     || ', and again: ' || coalesce(act_refusal(:'world2', :'ivar', 'use_ability',
        '{"kind":"tile","material":"refresh"}'::jsonb), 'allowed');
/*
 * And what a path is worth where the island already does the arithmetic. Three
 * of the fifteen steps are a row and nothing else — carrying weight, the reach
 * of sight, and what armour turns — because none of the three is computed
 * anywhere down here to multiply.
 */
select creature_spawn(:'world2', 'rabba', 5.7, 7.7, 'wild', now() - interval '1 day') as bun \gset
insert into skill (world_id, uid, id, value) values (:'world2', :'ivar', 'meditation', 25)
  on conflict (world_id, uid, id) do update set value = 25;
select round((tame_chance(:'world2', :'ivar', (select c from creature c where c.id = :'bun')) * 100)::numeric)
  as with_love \gset
update player set way = null where world_id = :'world2' and uid = :'ivar';
select round((tame_chance(:'world2', :'ivar', (select c from creature c where c.id = :'bun')) * 100)::numeric)
  as without \gset
update player set way = 'love' where world_id = :'world2' and uid = :'ivar';
select '493. what the path is worth, the same body either way: a rabba would trust him '
     || :'with_love' || ' times in a hundred with Gentle hand behind him and '
     || :'without' || ' without it'
     || ' — and ' || (select count(*) from path_step where ability is not null)
     || ' of the fifteen steps are called on rather than simply true, the rest being true all the time';
select '494. the five that came with it: '
     || (select string_agg(id, ', ' order by id) from action_def where faith_action(id))
     || ' — of 374 the island now does ' || (select count(*) from action_def where act_ported(id));

\echo ''
\echo '--- a bridge, a bed, a herd, a pot of dye and a barrel of ale'
delete from placed where world_id = :'world2' and kind = 'furniture';
delete from creature where world_id = :'world2';
delete from bridge where world_id = :'world2';
select '495. the three kinds: ' || (select string_agg(name || ' — spans ' || span || ', '
       || skill || ' ' || difficulty || ', ' || case when carts then 'carts cross' else 'foot only' end
       || ', and one tile of it takes ' || (select string_agg(count || ' ' || item, ', ' order by item)
          from bridge_bill b2 where b2.kind = b.id), ' | ' order by difficulty)
       from bridge_def b);
/*
 * A ravine to bridge. Banks at tiles 2 and 7, four tiles of gap between them,
 * and sixteen height units of nothing underneath — which is well past the
 * three a gap has to be before it counts as one.
 */
do $$
declare w uuid := (select id from world where name <> 'Rockhaven' order by made_at limit 1); i int; j int;
begin
  for i in 1..9 loop
    for j in 12..15 loop
      perform land_set_height(w, i, j, 40);
      perform land_set_dirt(w, i, j, 10);
    end loop;
  end loop;
  for i in 3..7 loop
    for j in 12..15 loop
      perform land_set_height(w, i, j, 8);
    end loop;
  end loop;
  for i in 1..9 loop
    for j in 12..15 loop
      perform land_set_tile(w, i, j, tile_id('Grass'));
    end loop;
  end loop;
end $$;
update player set x = 2.5, y = 13.5 where world_id = :'world2' and uid = :'ivar';
select '496. a rope bridge to the next tile along: '
     || coalesce(bridge_reason(:'world2', 'rope', 2, 13, 3, 13), 'allowed')
     || ' — and one that goes across a corner: '
     || coalesce(bridge_reason(:'world2', 'rope', 2, 13, 7, 14), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'plan_bridge', '{"kind":"tile","x":7,"y":13,"material":"wood"}'::jsonb) \g /dev/null
select id as span_bridge from bridge where world_id = :'world2' order by id desc limit 1 \gset
select '497. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
select '498. as it stands: ' || bridge_state(:'world2', :'span_bridge')
     || ' — with nothing in the pack: ' || coalesce(act_refusal(:'world2', :'ivar', 'build_bridge',
        ('{"kind":"bridge","id":' || :'span_bridge' || '}')::jsonb), 'allowed');
select give(:'world2', :'ivar', 'mallet', 1, 50) \g /dev/null
select give(:'world2', :'ivar', 'timber', 40, 40) \g /dev/null
select give(:'world2', :'ivar', 'plank', 60, 40) \g /dev/null
select give(:'world2', :'ivar', 'nail', 120, 40) \g /dev/null
update player set x = 3.5, y = 13.5 where world_id = :'world2' and uid = :'ivar';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'build_bridge',
  ('{"kind":"bridge","id":' || :'span_bridge' || '}')::jsonb) \g /dev/null
select '499. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
-- The whole deck, one unit of one thing at a time, from wherever the open span is.
do $$
declare w uuid := (select id from world where name <> 'Rockhaven' order by made_at limit 1);
        me uuid := '11111111-1111-1111-1111-111111111111';
        b bigint := (select id from bridge where world_id = w order by id desc limit 1);
        s record; i int;
begin
  for i in 1..200 loop
    select * into s from bridge_span sp where sp.world_id = w and sp.bridge = b
      and not span_done(sp.needed) order by sp.n limit 1;
    exit when not found;
    update player set x = s.x + 0.5, y = s.y + 0.5 where world_id = w and uid = me;
    exit when act_refusal(w, me, 'build_bridge', jsonb_build_object('kind','bridge','id',b)) is not null;
    perform act_perform(w, me, 'build_bridge', jsonb_build_object('kind','bridge','id',b));
  end loop;
end $$;
select '500. ' || (select text from event where uid = :'ivar' and kind = 'system' order by n desc limit 1)
     || ' — ' || bridge_state(:'world2', :'span_bridge');
update player set x = 2.5, y = 13.5 where world_id = :'world2' and uid = :'ivar';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'demolish_bridge',
  ('{"kind":"bridge","id":' || :'span_bridge' || '}')::jsonb) \g /dev/null
select '501. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — and there are ' || (select count(*) from bridge where world_id = :'world2')
     || ' bridges left on the island';

-- A bed, and the night that goes past whether anybody is awake for it.
select give(:'world2', :'ivar', 'bed', 1, 60, 'Oak') \g /dev/null
update player set x = 5.5, y = 7.5 where world_id = :'world2' and uid = :'ivar';
select act_perform(:'world2', :'ivar', 'place_furniture',
  ('{"kind":"item","uid":' || (select id from item where world_id = :'world2' and holder_uid = :'ivar'
     and def = 'bed' order by id desc limit 1) || ',"x":5,"y":7,"sx":0,"sy":0}')::jsonb) \g /dev/null
select id as bed from placed where world_id = :'world2' and sub = 'bed' order by id desc limit 1 \gset
-- Noon, by moving the island's memory rather than waiting for it.
update world set epoch = now() - make_interval(secs => 12 / 24.0 * day_seconds())
  where id = :'world2';
select '502. at ' || world_clock(:'world2') || ': ' || coalesce(act_refusal(:'world2', :'ivar', 'sleep',
       ('{"kind":"furniture","id":' || :'bed' || '}')::jsonb), 'allowed');
update world set epoch = now() - make_interval(secs => 22 / 24.0 * day_seconds())
  where id = :'world2';
select give(:'world2', :'ivar', 'plank', 1, 40) as fresh \gset
update item set made_at = now() where id = :'fresh';
insert into crop (world_id, x, y, id, stage, stage_at, ql, tended)
  values (:'world2', 12, 12, 'wheat', 0, now(), 40, 0)
  on conflict (world_id, x, y) do update set stage = 0, stage_at = now();
update player set favour = 0, favour_at = now(), prayed_at = now(), rested = 0, rested_at = now(),
    stats = jsonb_set(jsonb_set(stats, '{health}', '0.5'), '{hunger}', '0.9')
  where world_id = :'world2' and uid = :'ivar';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'sleep', ('{"kind":"furniture","id":' || :'bed' || '}')::jsonb) \g /dev/null
select '503. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
/*
 * And the night happened to everything else as well — not by being walked
 * forward, but by every one of them being told it was longer ago than it was.
 * The wheat has to be *looked at* before it shows, which is the whole of how
 * this island has worked since the first campfire.
 */
select crop_settle(:'world2', 12, 12) \g /dev/null
select '504. sown at bedtime, and nobody watched it: the wheat is at stage '
     || (select stage from crop where world_id = :'world2' and x = 12 and y = 12)
     || ' of ' || crop_ripe() || ' at ' || (select stage_seconds from crop_def where id = 'wheat')
     || ' seconds a stage, a plank made at bedtime is ' || round((extract(epoch from (now() -
        (select made_at from item where id = :'fresh'))) / 60)::numeric) || ' minutes old, '
     || 'and favour has come back to ' || round(favour_settle(:'world2', :'ivar')::numeric, 1)
     || ' — all of it out of one night that took no time at all';
select '505. what a night is worth: ' || round(rest_left((select p from player p
       where p.world_id = :'world2' and p.uid = :'ivar'))::numeric) || ' seconds of rest, '
     || 'while which everything teaches you ' || round(rest_bonus(:'world2', :'ivar')::numeric)
     || ' times as much — and the bed is now home: '
     || coalesce(act_refusal(:'world2', :'ivar', 'set_home',
        ('{"kind":"furniture","id":' || :'bed' || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'set_home', ('{"kind":"furniture","id":' || :'bed' || '}')::jsonb) \g /dev/null
select '506. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — and asking twice: ' || coalesce(act_refusal(:'world2', :'ivar', 'set_home',
        ('{"kind":"furniture","id":' || :'bed' || '}')::jsonb), 'allowed');

-- A herd. Two of them, put together, and what comes of it twelve minutes later.
insert into skill (world_id, uid, id, value) values (:'world2', :'ivar', 'animal_husbandry', 70)
  on conflict (world_id, uid, id) do update set value = 70;
select creature_spawn(:'world2', 'shaggan', 5.6, 7.6, 'deed', now() - interval '3 hours') as ewe \gset
select creature_spawn(:'world2', 'shaggan', 5.7, 7.7, 'deed', now() - interval '3 hours') as ram \gset
update creature set sex = 'female', keeper = :'ivar', hunger = 1, care = 0.8,
    traits = array['biddable', 'bright'], from_x = to_x, from_y = to_y,
    leg_at = now(), leg_ends = now(), settled_at = now(), name = 'Snow' where id = :'ewe';
update creature set sex = 'male', keeper = :'ivar', hunger = 1, care = 0.8,
    traits = array['broad_backed'], from_x = to_x, from_y = to_y,
    leg_at = now(), leg_ends = now(), settled_at = now(), name = 'Horn' where id = :'ram';
select '507. with no settlement to put the young one in: '
     || coalesce(act_refusal(:'world2', :'ivar', 'pair_creature',
        ('{"kind":"creature","id":' || :'ewe' || '}')::jsonb), 'allowed');
insert into deed (world_id, name, x, y, radius, level, founded_by)
  values (:'world2', 'Lambfold', 5, 7, 5, 1, :'ivar');
delete from event where uid = :'ivar';
do $$
declare w uuid := (select id from world where name <> 'Rockhaven' order by made_at limit 1);
        me uuid := '11111111-1111-1111-1111-111111111111';
        c int := (select id from creature where world_id = w and sex = 'female' order by id desc limit 1);
        i int;
begin
  -- A pairing can be refused by the pair themselves; that is a roll, so it is
  -- tried until it takes or the rest between tries says no.
  for i in 1..12 loop
    exit when (select due from creature where world_id = w and id = c) is not null;
    update creature set bred_at = null where world_id = w;
    exit when act_refusal(w, me, 'pair_creature', jsonb_build_object('kind','creature','id',c)) is not null;
    perform act_perform(w, me, 'pair_creature', jsonb_build_object('kind','creature','id',c));
  end loop;
end $$;
select '508. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
/*
 * Blood does not read itself: a common trait is plain to anybody, a rare one
 * takes fifteen husbandry, and a fantastic one sixty. The same beast reads
 * differently to two different people, which is the whole of the mechanism.
 */
select '509. at husbandry 70: ' || blood_read(:'world2', :'ivar',
       (select c from creature c where c.id = :'ewe'));
select '510. and at husbandry 1, the same beast: ' || blood_read(:'world2', :'hild',
       (select c from creature c where c.id = :'ewe'));
-- The hour comes whether anybody is there for it.
update creature set due = now() - interval '1 second' where id = :'ewe';
delete from event where uid = :'ivar';
select herd_settle(:'world2') as dropped \gset
select '511. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — ' || :'dropped' || ' hour came, and the herd is now '
     || (select count(*) from creature where world_id = :'world2' and mode <> 'wild') || ' strong';

-- Colour, and a barrel left alone.
select give(:'world2', :'ivar', 'satchel', 1, 50) as bag \gset
select '512. with no pot in the pack: ' || coalesce(act_refusal(:'world2', :'ivar', 'dye_item',
       ('{"kind":"item","uid":' || :'bag' || '}')::jsonb), 'allowed')
     || ' — and a hatchet, which will take nothing: '
     || coalesce(act_refusal(:'world2', :'ivar', 'dye_item',
        ('{"kind":"item","uid":' || (select give(:'world2', :'ivar', 'hatchet', 1, 40)) || '}')::jsonb), 'allowed');
select give(:'world2', :'ivar', 'dye', 1, 60, (select name from dye_def order by id limit 1)) \g /dev/null
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'dye_item', ('{"kind":"item","uid":' || :'bag' || '}')::jsonb) \g /dev/null
select '513. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — and it is called ' || (select item_name(i) from item i where i.id = :'bag');
delete from item where world_id = :'world2' and holder_uid = :'ivar'
  and def in ('lye_bucket', 'bucket');
select '514. boiling it out with nothing to boil it in: '
     || coalesce(act_refusal(:'world2', :'ivar', 'strip_dye',
        ('{"kind":"item","uid":' || :'bag' || '}')::jsonb), 'allowed');
select give(:'world2', :'ivar', 'lye_bucket', 1, 45) \g /dev/null
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'strip_dye', ('{"kind":"item","uid":' || :'bag' || '}')::jsonb) \g /dev/null
select '515. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — and the lye goes with it: ' ||
       (select count(*) from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'lye_bucket')
     || ' bucket of lye left and ' ||
       (select count(*) from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'bucket')
     || ' plain one back';
select '516. what a barrel of water becomes: ' || (select string_agg(name || ' — ' || count || ' '
       || input || ' in ' || litres || ' litres, ' || round(seconds / 60) || ' minutes at brewing '
       || difficulty, ' | ' order by seconds) from brew_def);
select give(:'world2', :'ivar', 'barrel', 1, 50, 'Oak') \g /dev/null
select act_perform(:'world2', :'ivar', 'place_furniture',
  ('{"kind":"item","uid":' || (select id from item where world_id = :'world2' and holder_uid = :'ivar'
     and def = 'barrel' order by id desc limit 1) || ',"x":5,"y":8,"sx":0,"sy":0}')::jsonb) \g /dev/null
select id as tun2 from placed where world_id = :'world2' and sub = 'barrel' order by id desc limit 1 \gset
select '517. a dry barrel: ' || coalesce(act_refusal(:'world2', :'ivar', 'start_brew',
       ('{"kind":"furniture","id":' || :'tun2' || ',"brew":"ale"}')::jsonb), 'allowed');
update placed set litres = 20, liquid = 'water', since = now() where id = :'tun2';
select '518. water but no wheat: ' || coalesce(act_refusal(:'world2', :'ivar', 'start_brew',
       ('{"kind":"furniture","id":' || :'tun2' || ',"brew":"ale"}')::jsonb), 'allowed');
insert into skill (world_id, uid, id, value) values (:'world2', :'ivar', 'brewing', 90)
  on conflict (world_id, uid, id) do update set value = 90;
select give(:'world2', :'ivar', 'wheat', 12, 55) \g /dev/null
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'start_brew',
  ('{"kind":"furniture","id":' || :'tun2' || ',"brew":"ale"}')::jsonb) \g /dev/null
select '519. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — and it is ' || (select case when is_working(p) then 'still working, '
        || round(ferment_left(p) / 60) || ' minutes to go' else 'ready' end
        from placed p where p.id = :'tun2');
select '520. and a barrel that is working: ' || coalesce(act_refusal(:'world2', :'ivar', 'start_brew',
       ('{"kind":"furniture","id":' || :'tun2' || ',"brew":"ale"}')::jsonb), 'allowed');
update placed set since = now() - interval '20 minutes' where id = :'tun2';
select '521. twenty minutes later: ' || (select case when is_working(p) then 'still working'
       else 'ale, ' || round(placed_litres(p)) || ' litres of it at QL ' || round(p.ql::numeric) end
       from placed p where p.id = :'tun2')
     || ' — and a brew is a well running the other way: one column, one timestamp, no machinery';
select '522. the last ten: '
     || (select string_agg(id, ', ' order by id) from action_def where last_action(id))
     || ' — of 374 the island now does ' || (select count(*) from action_def where act_ported(id));

\echo ''
\echo '--- a torch, and the end of the tinderbox'
delete from placed where world_id = :'world2' and kind = 'campfire';
delete from item where world_id = :'world2' and holder_uid = :'ivar' and def in ('torch', 'lantern');
update player set x = 5.5, y = 7.5 where world_id = :'world2' and uid = :'ivar';
select '523. what a torch is: ' || (select string_agg(i.item || ' × ' || i.count, ' + ' order by i.ord)
       from recipe_input i where i.recipe = 'make_torch')
     || ' at ' || (select skill || ' ' || difficulty from recipe where id = 'make_torch')
     || ' — it burns ' || round(torch_burn(50) / 60) || ' minutes at QL 50 and throws '
     || held_reach('torch', 50) || ' tiles, where a lantern of the same make throws '
     || held_reach('lantern', 50);
select give(:'world2', :'ivar', 'torch', 1, 50) as torch \gset
select '524. with nothing burning anywhere near: ' || coalesce(act_refusal(:'world2', :'ivar',
       'light_lantern', ('{"kind":"item","uid":' || :'torch' || '}')::jsonb), 'allowed');
-- A fire to light it at, set down rather than built: what is being measured
-- here is the torch, and building a campfire is measured elsewhere.
insert into placed (world_id, kind, x, y, sx, sy, cx, cy, ql, fuel, lit, since, made_by)
  values (:'world2', 'campfire', 5, 7, 1, 1, 5.5, 7.5, 40, 600, true, now(), :'ivar');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'light_lantern', ('{"kind":"item","uid":' || :'torch' || '}')::jsonb) \g /dev/null
select '525. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
select '526. and a lantern with no candle in it: '
     || coalesce(act_refusal(:'world2', :'ivar', 'light_lantern',
        ('{"kind":"item","uid":' || (select give(:'world2', :'ivar', 'lantern', 1, 60)) || '}')::jsonb), 'allowed')
     || ' — but the torch in hand is a light to take one off: '
     || coalesce(flame_near(:'world2', :'ivar'), 'nothing');
-- And it burns down while it is lit, and only while it is lit.
update item set lit_at = now() - interval '2 minutes' where id = :'torch';
select '527. two minutes of torch later: ' || round(candle_left((select i from item i where i.id = :'torch')) / 60)
     || ' minutes left of the ' || round(torch_burn(50) / 60) || ' it started with';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'douse_lantern', ('{"kind":"item","uid":' || :'torch' || '}')::jsonb) \g /dev/null
select '528. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and there are ' || (select count(*) from item_def where id = 'tinderbox')
     || ' tinderboxes in this game, which is how many there always were';

\echo ''
\echo '--- a name you can prove'
-- Until now every name in this file was a string somebody typed. An account is
-- a name the database can check, and the check is not a column of its own: the
-- username *is* the address Auth signs you in with, so the unique index over
-- addresses is the thing that makes a name yours.
\set alice '33333333-3333-3333-3333-333333333333'
\set bob   '44444444-4444-4444-4444-444444444444'
\set ghost '55555555-5555-5555-5555-555555555555'
reset role;
-- Auth's own table, written here the way Auth writes it: an address for an
-- account that has one, and nothing at all for an anonymous one.
insert into auth.users (id, email) values (:'alice', 'alice@players.wurm.invalid'), (:'ghost', null);

select '529. what counts as a username: ' || string_agg(
         quote_literal(n) || ' ' || case when name_ok(n) then 'yes' else 'no' end, ', ' order by ord)
  from (values ('alice', 1), ('al', 2), ('a1ice_the-third', 3), ('1alice', 4),
               ('alice smith', 5), ('alice@home', 6), ('averyverylongnameindeedx', 7)) v(n, ord);

select '530. a name goes out as ' || name_email('Alice') || ' and comes back as '
     || coalesce(email_name('ALICE@players.wurm.invalid'), 'nothing')
     || ' — and an address that is not ours comes back as '
     || coalesce(email_name('alice@example.com'), 'nothing');

select '531. is bob free? ' || rpc_name_free('bob')::text
     || ' — is alice? ' || rpc_name_free('alice')::text
     || ' — is ALICE? ' || rpc_name_free('ALICE')::text
     || ' — is "al"? ' || rpc_name_free('al')::text;

-- What makes the name hers is not this call; it is the row above. This is the
-- filing, and the filing takes no argument at all.
select set_config('request.jwt.claims', json_build_object('sub', :'alice')::text, false) \g /dev/null
select '532. before alice asks, account holds ' || (select count(*) from account) || ' rows';
select rpc_my_name() \g /dev/null
select rpc_my_name() \g /dev/null
select '533. she asks her name three times: ' || coalesce(rpc_my_name(), 'none')
     || ' — and account holds ' || (select count(*) from account)
     || ' row, which is how many three askings should leave';

-- Signing up is the reservation, and this is the index that does it.
do $$ begin
  insert into auth.users (id, email) values ('66666666-6666-6666-6666-666666666666', 'ALICE@players.wurm.invalid');
  raise notice '534. a second alice signs up:      ALLOWED';
exception when others then raise notice '534. a second alice signs up:      refused — %', sqlerrm; end $$;

-- The name follows the address, so there is no argument for a client to lie in.
insert into auth.users (id, email) values (:'bob', 'bob@players.wurm.invalid');
select set_config('request.jwt.claims', json_build_object('sub', :'bob')::text, false) \g /dev/null
select '535. bob asks his own name: ' || coalesce(rpc_my_name(), 'none')
     || ' — and what alice is called is still ' || coalesce(account_name(:'alice'), 'nothing');

select set_config('request.jwt.claims', json_build_object('sub', :'ghost')::text, false) \g /dev/null
select '536. an anonymous account asks: ' || coalesce(rpc_my_name(), 'no name to prove')
     || ' — rows in account: ' || (select count(*) from account);

select set_config('request.jwt.claims', json_build_object('sub', null)::text, false) \g /dev/null
select '537. nobody at all asks: ' || coalesce(rpc_my_name(), 'no name to prove');

-- And a client may not simply file itself one.
--
-- Two layers say no and the outer one answers first, which is why the message
-- below is about a grant and not about a policy. `20260914190200_no_writes`
-- revoked insert, update and delete by default privilege on every table added
-- from then on, so `account` arrived unwritable without anybody having to
-- remember; and behind that, `account` has a select policy and no other, which
-- with row level security on is a refusal in its own right. Either alone would
-- do. Both is the point.
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'bob')::text, false) \g /dev/null
do $$ begin
  insert into account (uid, name) values ('77777777-7777-7777-7777-777777777777', 'alice_the_real');
  raise notice '538. bob files a name for free:    ALLOWED';
exception when others then raise notice '538. bob files a name for free:    refused — %', sqlerrm; end $$;
do $$ begin
  update account set name = 'alice' where uid = '44444444-4444-4444-4444-444444444444';
  raise notice '539. bob renames himself alice:    ALLOWED';
exception when others then raise notice '539. bob renames himself alice:    refused — %', sqlerrm; end $$;
select '540. bob reads the names on the island: ' || string_agg(a.name, ', ' order by a.name) from account a;
reset role;

-- One door opens before you have an account, because whoever is knocking has
-- none. Every other door stays shut to a stranger.
select '541. what a stranger may call: '
     || string_agg(f || ' ' || case when has_function_privilege('anon', f, 'execute') then 'yes' else 'no' end,
                   ', ' order by f)
  from unnest(array['rpc_name_free(text)', 'rpc_my_name()', 'rpc_join(uuid,text)', 'rpc_act(uuid,text,jsonb,int)']) f;

/*
 * And what a stranger may read, which is the question this file did not think
 * to ask until it had cost something.
 *
 * `lock_doors()` sweeps every table with no `world_id` into the rulebook —
 * readable by everyone, writable by nobody — and `account` is the first table
 * to have no island and still be nobody's business but its own. The sweep
 * dropped the policy this migration had just written and put back one that let
 * anybody holding the publishable key pull every username in the game in one
 * request. Nothing above would have noticed: every measurement so far asked as
 * somebody who had already come ashore.
 */
select '542. the policies on the roll of names: '
     || string_agg(p.polname || ' for ' || array_to_string(p.polroles::regrole[], ' and '), ', ' order by p.polname)
  from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname = 'account';
select count(*) as really from account \gset
set role anon;
select set_config('request.jwt.claims', json_build_object('sub', null)::text, false) \g /dev/null
select '543. a stranger reads the roll of names: ' || (select count(*) from account)
     || ' of the ' || :really || ' there are';
reset role;

\echo ''
\echo '--- a face, and where it is kept'
-- Eight short strings, chosen on the landing page between making an account
-- and stepping ashore. What is measured here is that none of them can be
-- anything but an entry in a table we wrote: a look goes from a stranger's
-- browser through this database into `fillStyle` on everybody else's machine,
-- and that path is no place for a free-text colour.
select '544. what the creator offers: ' || string_agg(kind || ' ' || n, ', ' order by kind)
  from (select kind, count(*) as n from look_option group by kind) k;
select '545. and every kind has one to fall back on: '
     || (select count(*) from look_option where fallback) || ' of '
     || (select count(distinct kind) from look_option);

select '546. a look full of rubbish: '
     || look_clean('{"skin":"green","hair":"<script>alert(1)</script>","eyes":"blue","shirt":"woad","gender":"woman"}'::jsonb)::text;
select '547. and one that is empty: ' || look_clean('{}'::jsonb)::text;
select '548. a random face is a real one: '
     || (select count(*) from jsonb_each_text(look_random()) f
         where exists (select 1 from look_option o where o.kind = f.key and o.id = f.value))
     || ' of its ' || (select count(*) from jsonb_each_text(look_random())) || ' fields are in the tables';

-- Alice comes ashore, and then changes her mind about her hair.
select set_config('request.jwt.claims', json_build_object('sub', :'alice')::text, false) \g /dev/null
select rpc_join(:'world', 'Alice') \g /dev/null
select '549. alice comes ashore with no face chosen: ' || (select (look ->> 'hair') is not null
       from player where uid = :'alice') || ' — she has one anyway, because nobody is the default figure';
select rpc_set_look('{"gender":"woman","skin":"deep","hair":"braids","hairColour":"black","eyes":"green","beard":"none","shirt":"woad","trousers":"bark"}'::jsonb) \g /dev/null
select '550. she chooses: ' || (select look ->> 'hair' from account where uid = :'alice')
     || ', ' || (select look ->> 'skin' from account where uid = :'alice')
     || ' — and the body already ashore has it too: '
     || (select look ->> 'hair' from player where uid = :'alice');
-- A look is a whole face rather than a patch, so what is not named goes back
-- to the fallback along with what was named and is not real. The creator
-- always sends all eight; this is what happens to anything that does not.
select rpc_set_look('{"hair":"there is no such haircut","skin":"#ff0000","eyes":"amber"}'::jsonb) \g /dev/null
select '551. three fields, one of them a colour and one a haircut nobody has: '
     || (select look::text from account where uid = :'alice')
     || ' — a look is a whole face, not a patch';

-- And somebody on the island can see it, which is the whole point of storing
-- it on the body rather than only on the account.
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select '552. hild looks at alice: ' || coalesce((select p.look ->> 'eyes' || ' eyes, '
       || (p.look ->> 'skin') || ' skin' from player p where p.uid = :'alice'), 'nothing to see');
reset role;

-- A body with nobody behind it still gets a face of its own.
select set_config('request.jwt.claims', json_build_object('sub', :'ghost')::text, false) \g /dev/null
select rpc_join(:'world', 'Nobody') \g /dev/null
select '553. an account with no name comes ashore: ' || (select look::text from player where uid = :'ghost');
do $$ begin
  perform rpc_set_look('{"hair":"bald"}'::jsonb);
  raise notice '554. and tries to choose a face:   ALLOWED';
exception when others then raise notice '554. and tries to choose a face:   refused — %', sqlerrm; end $$;

select set_config('request.jwt.claims', json_build_object('sub', null)::text, false) \g /dev/null
do $$ begin
  perform rpc_set_look('{"hair":"bald"}'::jsonb);
  raise notice '555. nobody at all chooses a face: ALLOWED';
exception when others then raise notice '555. nobody at all chooses a face: refused — %', sqlerrm; end $$;

\echo ''
\echo '--- the big island'
-- Sixteen kilometres a side instead of one. What makes it affordable is not
-- storage and not writes — both were always fine — but that the land stops
-- travelling: a join carries the seed and every browser works out the ground
-- it is standing on. docs/tile-map-cost-analysis.md has the arithmetic.
select set_config('request.jwt.claims', json_build_object('sub', :'alice')::text, false) \g /dev/null
select rpc_found('Bigness', 7, 4096, 2048, 2048) as big \gset
select '556. an island of 4096: ' || (select size || ' tiles a side, ' || round((size::bigint * size) / 1e6) || ' M of them'
       from world where id = :'big')
     || ', laid down in ' || (select count(*) from land_corner where world_id = :'big') || ' rows of corners and '
     || (select count(*) from land_tile where world_id = :'big') || ' of tiles';
do $$ begin
  perform rpc_found('Bigger still', 7, 8192, 1, 1);
  raise notice '557. and one twice that:            ALLOWED';
exception when others then raise notice '557. and one twice that:            refused — %', sqlerrm; end $$;

-- A plateau of grass around the spawn, written as whole rows rather than
-- corner by corner: eight thousand `land_set_height` calls on a 4096-wide
-- island is eight thousand rewrites of an eight kilobyte row, and what is
-- being measured here is the stocking, not the digging.
update land_corner set heights = decode(repeat('6400', 4097), 'hex'), dirt = decode(repeat('14', 4097), 'hex')
  where world_id = :'big' and y between 1790 and 2310;
update land_tile set tiles = decode(repeat('00', 4096), 'hex'), data = decode(repeat('00', 4096), 'hex')
  where world_id = :'big' and y between 1790 and 2310;

-- Opening it is what used to never come back: it laid down sixteen thousand
-- creatures by throwing six hundred thousand darts at sixteen million tiles,
-- each one detoasting an eight kilobyte scanline to read two bytes.
select rpc_ready(:'big') \g /dev/null
select '557b. opening it put out ' || (select count(*) from creature where world_id = :'big')
     || ' wild things in the one block of country people come ashore in; the other '
     || ((select ceil(size / 256.0) * ceil(size / 256.0) from world where id = :'big')::int
        - (select count(*) from world_stocked where world_id = :'big'))
     || ' fill in as somebody walks into them — nine of them at once is five to thirteen seconds, '
     || 'and PostgREST allows eight';

select rpc_join(:'big', 'Alice') \g /dev/null
select '558. coming ashore on it hands over ' || length(rpc_join(:'big', 'Alice')::text)
     || ' bytes — the world row, the body and the hour, and not one tile of land';
-- What the old way would have cost, from the same schema, so the two numbers
-- sit next to each other rather than one of them being a claim.
select '559. the land it did not send: ' || round(((select size from world where id = :'big') + 1)
       * (((select size from world where id = :'big') + 1) * 3 + (select size from world where id = :'big') * 3)
       * 4.0 / 3 / 1048576) || ' MB, which is what every join used to be';
select '560. and the land is still here to be asked: a band of four rows is '
     || length(land_window(:'big', 0, 3)::text) || ' bytes of it, off '
     || (select length(heights) from land_corner where world_id = :'big' and y = 0) || ' bytes a row of corners';

-- Walking into country nobody has been in puts the wildlife out there.
select set_config('request.jwt.claims', json_build_object('sub', :'alice')::text, false) \g /dev/null
update player set moved_at = now() - interval '1 hour' where uid = :'alice' and world_id = :'big';
select '561. blocks of country stocked before a step: ' || (select count(*) from world_stocked where world_id = :'big');
select rpc_move(:'big', 2300, 2048, 0) \g /dev/null
select '562. and after one: ' || (select count(*) from world_stocked where world_id = :'big')
     || ' — a step inside country already put out costs one index probe and nothing else';
-- And somewhere nobody has been. `rpc_move` believes about forty tiles a call,
-- so getting there properly is a dozen steps; what is being measured is what
-- happens when you arrive, not how long the walk is.
select creature_stock_near(:'big', 2600, 2048) \g /dev/null
select '563. arriving two blocks over: ' || (select count(*) from world_stocked where world_id = :'big')
     || ' blocks out now, and ' || (select count(*) from creature where world_id = :'big') || ' wild things on the island';

\echo ''
\echo '--- how long everything takes'
-- `base_time` is a weight, not a clock. Mining is the yardstick: a beginner
-- with a plain pickaxe spends thirty seconds on a face of rock, and every
-- other job keeps the ratio to that it always had.
select '564. the yardstick: a beginner at the rock takes '
     || round(act_duration((select base_time from action_def where id = 'mine'), 0, 0, 1))
     || ' seconds, and it is meant to take ' || round(mining_seconds())
     || ' — ' || case when act_duration((select base_time from action_def where id = 'mine'), 0, 0, 1) = mining_seconds()
                      then 'they agree' else 'THEY HAVE DRIFTED' end;
select '565. and mining still weighs ' || (select base_time from action_def where id = 'mine')
     || ' against the ' || round(mining_weight()) || ' the pace was worked out from';
select '566. the same rock with skill and a good tool: '
     || string_agg(round(act_duration((select base_time from action_def where id = 'mine'), s.skill, s.ql, 1)) || 's at skill '
                   || s.skill || ' with a QL ' || s.ql || ' pick', ', ' order by s.skill)
  from (values (1, 20), (50, 50), (90, 90)) s(skill, ql);
select '567. the shortest a go at anything can be: ' || act_duration(0, 99, 99, 1)
     || ' seconds, which is the old 1.2 at the new pace';
select '568. a spread of jobs, for the feel of it: '
     || string_agg(a.label || ' ' || round(act_duration(a.base_time, 1, 20, 1)) || 's', ', ' order by a.base_time, a.id)
  from action_def a where a.id in ('forage', 'dig', 'mine', 'make_large_cart', 'make_wagon');
select '569. and a worker over the same task takes ' || round(work_duration(20))
     || ' seconds at skill 20, which is twice what a hand of that skill would';

\echo ''
\echo '--- and how long the world takes'
-- Actions have a pace and so does everything the world does on its own. Cotton
-- is that second yardstick: five minutes a stage, and every other world timer
-- keeps the ratio to it that it always had.
select '570. the world runs at ' || world_pace() || ' seconds to the unit, against the '
     || action_pace() || ' a job runs at';
select '571. the yardstick: a stage of cotton is '
     || (select stage_seconds from crop_def where id = 'cotton') || ' seconds, and it is meant to be '
     || cotton_seconds() || ' — ' || case when (select stage_seconds from crop_def where id = 'cotton') = cotton_seconds()
                                          then 'they agree' else 'THEY HAVE DRIFTED' end;
select '572. a day is now ' || round(day_seconds() / 60) || ' minutes, of which '
     || round(day_seconds() * 10 / 24 / 60) || ' are dark';
select '573. every crop, sown to ripe: ' || string_agg(c.name || ' ' || round(c.stage_seconds * 3 / 60) || 'm',
       ', ' order by c.stage_seconds, c.id) from crop_def c;
select '574. and the rest of the world: carrying ' || round(gestation() / 60) || 'm, and again after '
     || round(breed_rest() / 60) || 'm; a prayer is worth something again after ' || round(prayer_rest() / 60)
     || 'm; ale works for ' || (select round(seconds / 60) from brew_def where id = 'ale') || 'm';
-- What matters is that the two clocks keep step with each other in game days,
-- which is the thing a rebase is for.
select '575. corn is ' || round((select stage_seconds * 3 from crop_def where id = 'corn') / mining_seconds())
     || ' swings of a pickaxe of waiting, against 56 before either clock moved and 15 after only the '
     || 'jobs did — the two paces are 3.75 and 2.5, so that ratio does not come all the way back. '
     || 'What does come back exactly is the day: ' || round((select stage_seconds * 3 from crop_def where id = 'corn')
        / day_seconds() * 100) || ' hundredths of one, which is what it always was';

\echo ''
\echo '--- a sprout under your own feet'
-- A tree is the one tile on this island that nothing can stand on, and `plant`
-- makes the ground into one. Asking nothing about where the planter stood let
-- somebody wall themselves in with a sprout and chop their way back out.
select land_set_tile(:'world2', 11, 9, 0) \g /dev/null
select give(:'world2', :'ivar', 'sprout', 1, 20, 'Oak') \g /dev/null
update player set x = 11.5, y = 9.5 where world_id = :'world2' and uid = :'ivar';
select '576. stood on 11,9 and asked to plant the sprout there: '
     || coalesce(act_refusal(:'world2', :'ivar', 'plant', '{"kind":"tile","x":11,"y":9}'::jsonb),
                 'ALLOWED — AND THE PLANTER IS WALLED IN');
update player set x = 12.5, y = 9.5 where world_id = :'world2' and uid = :'ivar';
select '577. one step to the side, the same tile and the same sprout: '
     || coalesce(act_refusal(:'world2', :'ivar', 'plant', '{"kind":"tile","x":11,"y":9}'::jsonb), 'allowed');

\echo ''
\echo '--- the island''s own clock'
-- Everything here settles off a timestamp, which works right up to the moment
-- nobody calls. `settle` had three callers and the browser reached one of them
-- only when the body moved, so a job finished while standing still landed at
-- whatever later moment somebody happened to walk somewhere.
select '578. the clock: a round every ' || tick_seconds() || ' seconds, a shut tab left standing for '
     || round(idle_logout() / 60) || ' minutes, talk kept ' || round(event_keep() / 3600)
     || ' hours, tile changes ' || round(change_keep() / 86400) || ' days, and an island nobody visits '
     || round(island_keep() / 86400) || ' days';

select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
update world set ready = true where id = :'world2';
select land_set_tile(:'world2', 12, 9, 0) \g /dev/null
update player set x = 12.5, y = 9.5, seen_at = now(), away = false,
       stats = jsonb_set(stats, '{stamina}', '1') where world_id = :'world2' and uid = :'ivar';
select give(:'world2', :'ivar', 'shovel', 1, 30) \g /dev/null
delete from event where world_id = :'world2';
select rpc_act(:'world2', 'dig', '{"x":12,"y":9,"cx":12,"cy":9}', 1) \g /dev/null
update player set act_started = act_started - interval '600 seconds',
       act_ends = act_ends - interval '600 seconds' where world_id = :'world2' and uid = :'ivar';
select '579. he digs, and then stands perfectly still. Ten minutes later he is still '
     || coalesce((select act from player where world_id = :'world2' and uid = :'ivar'), 'finished')
     || ' — nothing has called, so nothing has happened';
select world_tick()::text as tock \gset
select '580. one round of the clock: ' || :'tock';
select '581. and now he is ' || coalesce((select act from player where world_id = :'world2' and uid = :'ivar'), 'finished')
     || ', having been told: '
     || coalesce((select text from event where world_id = :'world2' and uid = :'ivar' and kind = 'event'
                  order by n desc limit 1), 'nothing');

-- A body nobody has been near for hours is a shut tab, not a person.
update player set seen_at = now() - interval '3 hours', away = false
  where world_id = :'world2' and uid = :'hild';
select world_tick() \g /dev/null
select '582. hild left her tab open three hours ago: away is now '
     || (select away from player where world_id = :'world2' and uid = :'hild')
     || ', and the island heard "'
     || coalesce((select text from event where world_id = :'world2' and uid is null
                  and text like '% has gone home.' order by n desc limit 1), 'nothing') || '"';
select '583. ivar, who was here a moment ago, is still on his feet: away is '
     || (select away from player where world_id = :'world2' and uid = :'ivar');
select '584. and nobody can turn the handle for anybody else: rpc_sweep is '
     || case when exists (select 1 from pg_proc where proname = 'rpc_sweep'
                            and pronamespace = 'public'::regnamespace)
             then 'STILL THERE' else 'gone, and rpc_settle only settles the caller' end;
select '585. does this database wind itself? '
     || case when clock_running() then 'yes — pg_cron has the key'
             else 'no pg_cron here, so the browser settles itself and the suite turns the handle' end;
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select rpc_join(:'world2') \g /dev/null
select '586. and she comes back: away is now '
     || (select away from player where world_id = :'world2' and uid = :'hild')
     || ', and she was told "'
     || coalesce((select text from event where world_id = :'world2' and uid = :'hild' and kind = 'system'
                  order by n desc limit 1), 'nothing') || '"';

\echo ''
\echo '--- doors that were open'
-- An island somebody else founded and Ivar has never set foot on.
insert into world (name, seed, size, spawn_x, spawn_y, ready)
  values ('Faraway', 99, 64, 32, 32, true) returning id as faraway \gset
insert into land_corner (world_id, y, heights, dirt)
  select :'faraway', g, repeat('\000', 65 * 2)::bytea, repeat('\000', 65)::bytea from generate_series(0, 64) g;
insert into land_tile (world_id, y, tiles, data, rock)
  select :'faraway', g, repeat('\000', 64)::bytea, repeat('\000', 64)::bytea, repeat('\000', 64)::bytea
  from generate_series(0, 63) g;
insert into item (world_id, holder, gx, gy, def, ql) values (:'faraway', 'ground', 5, 5, 'dirt', 20);
insert into placed (world_id, kind, x, y, cx, cy) values (:'faraway', 'fire', 6, 6, 6.5, 6.5);
insert into tile_change (world_id, x, y, tile, data, corners) values (:'faraway', 7, 7, 2, 0, '{0,0,0,0}');

set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select '587. an island Ivar has never been to: he can see '
     || (select count(*) from item where world_id = :'faraway' and holder = 'ground') || ' of its ground things, '
     || (select count(*) from placed where world_id = :'faraway') || ' of its fires and '
     || (select count(*) from tile_change where world_id = :'faraway') || ' of its dug tiles'
     || ' — all three were the whole service before';
select '588. and the land itself is still open on purpose: '
     || (select count(*) from land_tile where world_id = :'faraway') || ' rows, because it is a pure function of a seed anybody is handed';
do $$ begin
  begin perform land_window((select id from world where name = 'Faraway'), 0, 8);
    raise notice '589. pull the land down wholesale: ALLOWED';
  exception when others then raise notice '589. pull the land down wholesale: refused — %', sqlerrm; end;
end $$;
reset role;
select '590. and rpc_land itself is '
     || case when exists (select 1 from pg_proc where proname = 'rpc_land' and pronamespace = 'public'::regnamespace)
             then 'STILL THERE' else 'gone; land_window has the body and no grant' end;

-- The ground under a claimed walk, read on a flat empty island where the only
-- thing in the way is the thing put there.
insert into player (world_id, uid, name, x, y, stats)
  values (:'faraway', :'ivar', 'Ivar', 5.5, 5.5, '{"health":1,"stamina":1,"hunger":1,"thirst":1}'::jsonb)
  on conflict (world_id, uid) do update set x = 5.5, y = 5.5, away = false;
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select '591. four tiles of flat open ground: he gets '
     || round(walk_share(:'faraway', :'ivar', 0, 5.5, 5.5, 9.5, 5.5)::numeric * 100) || '% of the way';
select land_set_tile(:'faraway', 7, 5, 16) \g /dev/null
select '592. with a tree grown in the middle of it: '
     || round(walk_share(:'faraway', :'ivar', 0, 5.5, 5.5, 9.5, 5.5)::numeric * 100)
     || '% — pulled up at the trunk, which is the one tile nothing stands on';
select land_set_tile(:'faraway', 7, 5, 0) \g /dev/null
select land_set_height(:'faraway', 9, 5, 3000), land_set_height(:'faraway', 9, 6, 3000),
       land_set_height(:'faraway', 10, 5, 3000), land_set_height(:'faraway', 10, 6, 3000) \g /dev/null
select '593. and with a cliff instead: tile 8 is ' || round(centre_height(:'faraway', 8, 5))
     || ' units up from tile 7, against a step of '
     || round(max_step() + skill_of(:'faraway', :'ivar', 'climbing') * climb_per_level())
     || ' — he gets ' || round(walk_share(:'faraway', :'ivar', 0, 5.5, 5.5, 9.5, 5.5)::numeric * 100) || '%';
update player set moved_at = now() - interval '10 seconds' where world_id = :'faraway' and uid = :'ivar';
select '594. and through rpc_move, which is where it counts: ' || (rpc_move(:'faraway', 9.5, 5.5, 0))::text;
select land_set_height(:'faraway', 9, 5, 0), land_set_height(:'faraway', 9, 6, 0),
       land_set_height(:'faraway', 10, 5, 0), land_set_height(:'faraway', 10, 6, 0) \g /dev/null
update player set moved_at = now() - interval '10 seconds' where world_id = :'faraway' and uid = :'ivar';
select '595. the cliff levelled, the same walk again: ' || (rpc_move(:'faraway', 9.5, 5.5, 0))::text;

-- Counting the callers.
delete from caller where uid = :'ivar';
select '596. a minute of asking: the island keeps listening for '
     || (select count(*) from generate_series(1, (calls_a_minute() + 20)::int) g
         where not too_fast(:'ivar')) || ' of ' || (calls_a_minute() + 20)::int
     || ' calls, which is the ' || calls_a_minute() || ' it is meant to be';
delete from caller where uid = :'ivar';

-- Giving an island up.
update world set made_by = :'ivar' where id = :'world2';
update player set seen_at = now(), away = false where world_id = :'world2' and uid = :'hild';
do $$ begin
  begin perform rpc_abandon((select id from world where name <> 'Rockhaven' and name <> 'Faraway' order by made_at limit 1));
    raise notice '597. give up an island with Hild still on it: ALLOWED';
  exception when others then raise notice '597. give up an island with Hild still on it: refused — %', sqlerrm; end;
end $$;
select '598. and the one foreign key with nothing behind it now has: '
     || (select count(*) from pg_indexes where tablename = 'item' and indexdef like '%(placed)%')
     || ' index on item(placed)';

-- And what reading the ground costs where the ground is biggest. A move call
-- is at most one a second per person, so this is the budget that decides
-- whether the check can stay.
do $$
declare t0 timestamptz; s double precision; cold double precision; warm double precision;
        w uuid := (select id from world where size = 4096 order by made_at desc limit 1);
begin
  if w is null then raise notice '599. no 4096 island to read'; return; end if;
  delete from land_chunk where world_id = w;
  t0 := clock_timestamp();
  s := walk_share(w, '11111111-1111-1111-1111-111111111111', 0, 2000.5, 2000.5, 2030.5, 2000.5);
  cold := extract(milliseconds from (clock_timestamp() - t0));
  t0 := clock_timestamp();
  s := walk_share(w, '11111111-1111-1111-1111-111111111111', 0, 2000.5, 2000.5, 2030.5, 2000.5);
  warm := extract(milliseconds from (clock_timestamp() - t0));
  raise notice '599. the ground under a thirty-tile walk on the 4096 island: % per cent of it walkable, read in % ms '
               'with the square to build first and % ms with it built — against 13 ms off the scanlines',
    round(s::numeric * 100), round(cold::numeric, 1), round(warm::numeric, 2);
end $$;

\echo ''
\echo '--- the land, read in squares'
select '610. a square of the 4096 island holds ' || length(tiles) || ' bytes of tiles and '
     || length(heights) || ' of corners, which is ' || chunk_size() || ' tiles to a side'
  from land_chunk where world_id = (select id from world where size = 4096 order by made_at desc limit 1)
  order by cx, cy limit 1;
-- The squares are a cache with no opinions: a land write throws away the ones
-- it touches and the next reader builds what it needs.
do $$
declare w uuid := (select id from world where size = 4096 order by made_at desc limit 1);
        had int; left_after int; saw int;
begin
  perform walk_share(w, '11111111-1111-1111-1111-111111111111', 0, 2000.5, 2000.5, 2030.5, 2000.5);
  select count(*) into had from land_chunk where world_id = w;
  perform land_set_tile(w, 2005, 2000, 16);
  select count(*) into left_after from land_chunk where world_id = w;
  saw := round(walk_share(w, '11111111-1111-1111-1111-111111111111', 0, 2000.5, 2000.5, 2030.5, 2000.5) * 100);
  raise notice '611. a tree planted in the middle of that walk: % squares held, % after the write, '
               'and the walk now gets % per cent of the way — the cache never answers for the scanlines',
    had, left_after, saw;
end $$;
select '612. and the scanlines are still the truth: tile 2005,2000 says '
     || land_tile((select id from world where size = 4096 order by made_at desc limit 1), 2005, 2000)
     || ', which is what was written to them';
