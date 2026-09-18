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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- the numbers on things are the database''s to hand out'
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select rpc_act(:'world', 'dig', '{"x":8,"y":8,"cx":8,"cy":8}', 3) \g /dev/null
update player set act_started = act_started - interval '600 seconds', act_ends = act_ends - interval '600 seconds' where uid = :'hild';
select rpc_settle() \g /dev/null
select '12. Ivar and Hild both dug: ' || count(*) || ' things of dirt between them, '
     || count(distinct id) || ' distinct numbers, highest ' || max(id) from item where def = 'dirt';

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
     || ', ' || lower((select name from tree_age_def where id = tree_age(land_data(:'world2',11,11))))
     || ', worth ' || (select hits from tree_age_def where id = tree_age(land_data(:'world2',11,11))) || ' strokes and '
     || (select logs from tree_age_def where id = tree_age(land_data(:'world2',11,11))) || ' logs';
select '57. felling it: ' || coalesce(act_refusal(:'world2', :'ivar', 'cut_down', '{"kind":"tile","x":11,"y":11}'), 'allowed');
update skill set value = 90 where uid = :'ivar' and id = 'woodcutting';
insert into skill (world_id, uid, id, value) select :'world2', :'ivar', 'woodcutting', 90 where not exists (select 1 from skill where uid = :'ivar' and id = 'woodcutting');
-- Six asked for where three will do: an old tree is three strokes, and the ask
-- stops itself the moment there is nothing left standing to swing at.
select rpc_act(:'world2', 'cut_down', '{"kind":"tile","x":11,"y":11}', 6) \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
select '82. before anybody has claimed anything: ' || coalesce(plan_reason(:'world2', :'ivar', 6, 7), 'allowed');
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
select '85. on the token itself: ' || coalesce(plan_reason(:'world2', :'ivar', 5, 7), 'allowed')
     || ' | outside the border: ' || coalesce(plan_reason(:'world2', :'ivar', 14, 14), 'allowed')
     || ' | on grass inside it: ' || coalesce(plan_reason(:'world2', :'ivar', 6, 7), 'allowed');

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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- And how far a run of offerings gets you, which was reported as stopping.
-- `least(0.12, coaxed * 0.03)` — so the fourth offering was the last one worth
-- making, and twelve points is not enough to see on a hard tame, which turned
-- a long run of refusals back into no progress at all.
update creature set coaxed = 4, coaxed_at = now() where id = :'cid' \g /dev/null
select round((coax_bonus((select c from creature c where c.id = :'cid')) * 100)::numeric) as four \gset
update creature set coaxed = 12 where id = :'cid' \g /dev/null
select round((coax_bonus((select c from creature c where c.id = :'cid')) * 100)::numeric) as twelve \gset
update creature set coaxed_at = now() - make_interval(secs => coax_lapse() + 60) where id = :'cid' \g /dev/null
select round((coax_bonus((select c from creature c where c.id = :'cid')) * 100)::numeric) as gone \gset
select '133b. what a run of offerings is worth: four of them ' || :'four' || ' points, twelve of them '
     || :'twelve' || ' — where it used to stop at 12 however long you kept at it — and '
     || :'gone' || ' once you have walked away for ' || round(coax_lapse() / 60) || ' minutes';
update creature set coaxed = 200, coaxed_at = now() where id = :'cid' \g /dev/null
select '133c. and a hundred offerings do not make it a certainty: the whole chance is '
     || round((select tame_chance(:'world2', :'ivar', c) * 100 from creature c where id = :'cid')::numeric, 1)
     || '%, which is the ceiling tame_chance has always had on it — patience buys a hard tame, it does not promise one';
update creature set coaxed = 3, coaxed_at = now() where id = :'cid' \g /dev/null
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'tame', ('{"kind":"creature","id":' || :'cid' || '}')::jsonb) \g /dev/null
-- `kind` widened to take in 'skill', because that is the half that was
-- missing: reported as taming giving nothing for an attempt, "at least in
-- chat". It was giving something and nothing said so.
select '134. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind in ('system','event','skill'))
     || ' — it is ' || (select mode from creature where id = :'cid');
delete from event where uid = :'ivar';
select round(skill_told(:'world2', :'ivar', 'taming', 0.35)::numeric, 4) as onrefusal \gset
select '134b. and what a refusal is worth, which is what a refusal has always been worth: '
     || :'onrefusal' || ' of taming — ' || coalesce((select text from event where uid = :'ivar' and kind = 'skill'
                                                     order by n desc limit 1), 'AND STILL NOTHING SAID');
select '134c. performers that say what went up: '
     || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname like 'perform_%'
           and (p.prosrc like '%increased by%' or p.prosrc like '%skill_told(%'))
     || ' — including ' || (select string_agg(p.proname, ', ' order by p.proname)
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'perform_creature' and p.prosrc like '%skill_told(%');
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
select '198. on the books now: ' || workers_on_deed(:'world2', :'ivar') || ' of ' || worker_cap(:'world2', :'ivar')
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- a kiln, and the queue it works through'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
delete from event where uid = :'ivar';
update player set x = 8.5, y = 8.5 where uid = :'ivar';
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'kiln', 55, 1)
  returning id as kit \gset
select '230. a brick takes ' || round(fire_seconds('unfired_clay_brick', 55)) || ' seconds in a QL 55 kiln, '
     || round(fire_seconds('unfired_clay_brick', 20)) || ' in a rough one, and comes out at QL '
     || round(fired_ql(60, 55)::numeric, 1) || ' from QL 60 green ware';
/*
 * Asked both ways, and set down through the door the browser actually uses.
 *
 * A target names the thing in your hand under `itemUid` when the target is
 * something else — here a tile — and under `uid` only when the thing is
 * itself what you are aiming at. This line used to ask the second way, which
 * is the one way nobody asks: the island refused every kiln anybody tried to
 * put down, and this measurement went on saying `allowed` throughout, because
 * it was asking itself a question it had made up.
 */
select '231. setting it down, asked the island''s way and the browser''s: '
     || coalesce(act_refusal(:'world2', :'ivar', 'place_kiln', ('{"kind":"tile","x":8,"y":8,"sx":0,"sy":0,"uid":' || :'kit' || '}')::jsonb), 'allowed')
     || ' | ' || coalesce(act_refusal(:'world2', :'ivar', 'place_kiln', ('{"kind":"tile","x":8,"y":8,"sx":0,"sy":0,"itemUid":' || :'kit' || '}')::jsonb), 'allowed');
select act_perform(:'world2', :'ivar', 'place_kiln', ('{"kind":"tile","x":8,"y":8,"sx":0,"sy":0,"itemUid":' || :'kit' || '}')::jsonb) \g /dev/null
select coalesce(max(id), 0) as kiln from placed where world_id = :'world2' and kind = 'kiln' \gset
select '232. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — it holds ' || furnace_capacity('kiln') || ' pieces at once';
delete from event where uid = :'ivar';
select '233. packing it with nothing to pack: ' || coalesce(act_refusal(:'world2', :'ivar', 'load_kiln', ('{"kind":"kiln","id":' || :'kiln' || '}')::jsonb), 'allowed');
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'unfired_clay_brick', 60, 8);
insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (:'world2', 'player', :'ivar', 'log', 40, 6, 'Pine')
  returning id as logs \gset
select act_perform(:'world2', :'ivar', 'load_kiln', ('{"kind":"kiln","id":' || :'kiln' || ',"count":8}')::jsonb) \g /dev/null
select '234. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
select '235. lighting a kiln with a cold firebox: ' || coalesce(act_refusal(:'world2', :'ivar', 'light_kiln', ('{"kind":"kiln","id":' || :'kiln' || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
/*
 * And the fuel named, which is also what the browser does.
 *
 * With no name on it the rule takes whatever fuel comes to hand first, and
 * for every run of this suite that was the shafts left over from the campfire
 * two hundred measurements ago rather than the logs cut for it two lines up.
 * It said so, in 236, run after run.
 */
select act_perform(:'world2', :'ivar', 'fuel_kiln', ('{"kind":"kiln","id":' || :'kiln' || ',"itemUid":' || :'logs' || '}')::jsonb) \g /dev/null
select act_perform(:'world2', :'ivar', 'light_kiln', ('{"kind":"kiln","id":' || :'kiln' || '}')::jsonb) \g /dev/null
select '236. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar');
select '237. and nothing out of it yet: ' || coalesce(act_refusal(:'world2', :'ivar', 'kiln_take_all', ('{"kind":"kiln","id":' || :'kiln' || '}')::jsonb), 'allowed');
/*
 * The budget, spent in order. Two hundred seconds go by against an hour of
 * logs, and each brick wants about a minute: what comes out is what the
 * arithmetic says came out, in one pass, with nobody there.
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
insert into item (world_id, holder, holder_uid, def, ql, count) values (:'world2', 'player', :'ivar', 'iron_ore', 40, 9)
  returning id as ore \gset
select '244. charging it with a clay brick: ' || coalesce(act_refusal(:'world2', :'ivar', 'smelt_ore', ('{"kind":"smelter","id":' || :'furnace' || ',"itemUid":' || (select id from item where holder_uid = :'ivar' and def = 'clay_brick' limit 1) || '}')::jsonb), 'allowed');
select '245. and with nine iron ore, one short of a charge: ' || coalesce(act_refusal(:'world2', :'ivar', 'smelt_ore', ('{"kind":"smelter","id":' || :'furnace' || ',"itemUid":' || :'ore' || ',"count":9}')::jsonb), 'allowed');
-- Twenty-five of them: two whole charges, and five left in the pack.
update item set count = 25 where id = :'ore';
select '245b. and with twenty-five: ' || coalesce(act_refusal(:'world2', :'ivar', 'smelt_ore', ('{"kind":"smelter","id":' || :'furnace' || ',"itemUid":' || :'ore' || ',"count":25}')::jsonb), 'allowed');
select act_perform(:'world2', :'ivar', 'smelt_ore', ('{"kind":"smelter","id":' || :'furnace' || ',"itemUid":' || :'ore' || ',"count":25}')::jsonb) \g /dev/null
select '246. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — two charges out of twenty-five, and '
     || (select coalesce(sum(count), 0) from item where holder_uid = :'ivar' and def = 'iron_ore')
     || ' ore still in the pack, counting what was mined earlier';
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
select '250. with two lumps where it takes twenty: ' || coalesce(act_refusal(:'world2', :'ivar', 'cast_anvil', ('{"kind":"smelter","id":' || :'furnace' || ',"itemUid":' || (select id from item where holder_uid = :'ivar' and def = 'copper_lump' limit 1) || '}')::jsonb), 'allowed');
update item set count = 22 where holder_uid = :'ivar' and def = 'copper_lump';
select '251. and with twenty-two: ' || coalesce(act_refusal(:'world2', :'ivar', 'cast_anvil', ('{"kind":"smelter","id":' || :'furnace' || ',"itemUid":' || (select id from item where holder_uid = :'ivar' and def = 'copper_lump' limit 1) || '}')::jsonb), 'allowed');
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
\echo '--- and all of it out of a bag on your back'
-- Reported as "fix the bag so that liquid can be transferred between it like a
-- bucket or barrel". `stow_item` sets holder = 'bag' and every liquid rule
-- looked for holder = 'player', so a skin in a backpack was simply gone.
select give(:'world2', :'ivar', 'backpack', 1, 50) as pack \gset
select act_perform(:'world2', :'ivar', 'stow_item', ('{"kind":"item","uid":' || :'skin' || '}')::jsonb) \g /dev/null
select '363. the skin is in the backpack: holder ' || holder
     || ', and the pack holds ' || bag_units(:'pack') || ' of '
     || (select holds from item_def where id = 'backpack')
  from item where id = :'skin';
update item set charges = 0 where id = :'skin';
select '364. filling it where it lies: ' || coalesce(act_refusal(:'world2', :'ivar', 'fill_skin',
        ('{"kind":"item","uid":' || :'skin' || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'fill_skin', ('{"kind":"item","uid":' || :'skin' || '}')::jsonb) \g /dev/null
select '365. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — ' || (select charges from item where id = :'skin') || ' of 5, still in the bag: '
     || (select holder from item where id = :'skin');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'drink_skin', ('{"kind":"item","uid":' || :'skin' || '}')::jsonb) \g /dev/null
select '366. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — ' || (select charges from item where id = :'skin') || ' of 5 left';

-- And a bucket, which is the harder half: it does not fill, it becomes a
-- different thing. Through `consume` and `give` that thing arrived in your
-- hands and the bag quietly emptied itself one bucket at a time.
select give(:'world2', :'ivar', 'bucket', 1, 50) as bkt \gset
select act_perform(:'world2', :'ivar', 'stow_item', ('{"kind":"item","uid":' || :'bkt' || '}')::jsonb) \g /dev/null
select '367. a bucket in the bag: ' || coalesce(act_refusal(:'world2', :'ivar', 'fill_bucket',
        ('{"kind":"item","uid":' || :'bkt' || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'fill_bucket', ('{"kind":"item","uid":' || :'bkt' || '}')::jsonb) \g /dev/null
select '368. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and it is item ' || (case when (select id from item where id = :'bkt') is null
                                      then 'gone, which is the bug' else 'the same one' end)
     || ', now a ' || (select def from item where id = :'bkt')
     || ', still in the bag: ' || (select holder from item where id = :'bkt')
     || ', and the pack still holds ' || bag_units(:'pack');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'empty_bucket', ('{"kind":"item","uid":' || :'bkt' || '}')::jsonb) \g /dev/null
select '369. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — a ' || (select def from item where id = :'bkt')
     || ' again, in the bag, and the pack holds ' || bag_units(:'pack');

-- A bucket put by used to fail `consume` and the whole action returned without
-- a word: click Fill, nothing happens, nothing said. The swap keeps the row,
-- so filling it is not spending it and the keeping survives.
update item set locked = true where id = :'bkt';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'fill_bucket', ('{"kind":"item","uid":' || :'bkt' || '}')::jsonb) \g /dev/null
select '370. a bucket put by: ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and it is still put by: ' || (select locked from item where id = :'bkt');
update item set locked = false where id = :'bkt';

-- What `give` never carried. A bucket of milk out of a barrel arrived with no
-- charges in it at all and could not be drunk; measurement 274 makes its own
-- by hand with the charges written in, which is why nothing said so.
select act_perform(:'world2', :'ivar', 'empty_bucket', ('{"kind":"item","uid":' || :'bkt' || '}')::jsonb) \g /dev/null
update placed set litres = 40, liquid = 'milk', since = now() where id = :'barrel';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'fill_bucket', ('{"kind":"item","uid":' || :'bkt' || '}')::jsonb) \g /dev/null
select '371. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — ' || (select def from item where id = :'bkt') || ' with '
     || coalesce((select charges from item where id = :'bkt')::text, 'nothing') || ' in it, and drinking it: '
     || coalesce(item_refusal(:'world2', :'ivar', 'drink_skin',
        ('{"kind":"item","uid":' || :'bkt' || '}')::jsonb), 'allowed');

-- And what a bag is still not: a place to eat out of. Both of these spend
-- through `consume`, which counts only what is loose, so they say so rather
-- than offering a job that would quietly do nothing.
select give(:'world2', :'ivar', 'bread', 1, 50) as loaf \gset
select act_perform(:'world2', :'ivar', 'stow_item', ('{"kind":"item","uid":' || :'loaf' || '}')::jsonb) \g /dev/null
select '372. eating out of the bag: ' || coalesce(act_refusal(:'world2', :'ivar', 'eat',
        ('{"kind":"item","uid":' || :'loaf' || '}')::jsonb), 'allowed');

-- And one thing out of it, which is the door the bag window needs. It knew
-- about crates and furniture and a bag is neither, so that window went on
-- moving rows in the browser's own copy — which did not show while the browser
-- could not see into a bag at all, and would have the moment it could.
select '373. taking the skin out: ' || coalesce(act_refusal(:'world2', :'ivar', 'take_from_store',
        ('{"kind":"item","uid":' || :'skin' || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'take_from_store', ('{"kind":"item","uid":' || :'skin' || '}')::jsonb) \g /dev/null
select '374. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — holder ' || (select holder from item where id = :'skin')
     || ', still ' || (select charges from item where id = :'skin') || ' of 5 in it'
     || ', and the pack now holds ' || bag_units(:'pack');
select act_perform(:'world2', :'ivar', 'stow_item', ('{"kind":"item","uid":' || :'skin' || '}')::jsonb) \g /dev/null

-- A bag on the grass is a store you stand next to, not a pocket. Its contents
-- keep your uid on them, so "a row with your uid" would have reached in from
-- anywhere on the island.
update item set holder = 'ground', holder_uid = null, gx = 3, gy = 3 where id = :'pack';
select '375. and once the pack is on the grass: ' || coalesce(act_refusal(:'world2', :'ivar', 'fill_skin',
        ('{"kind":"item","uid":' || :'skin' || '}')::jsonb), 'allowed');
update item set holder = 'player', holder_uid = :'ivar', gx = null, gy = null where id = :'pack';

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- and a holla, which carries the shore to your barrels'
delete from creature where world_id = :'world2' and mode in ('deed', 'wild');
update placed set litres = 0, liquid = null, since = now() where id = :'barrel';
select creature_spawn(:'world2', 'holla', 5.5, 7.5, 'deed', now() - interval '3 hours', :'ivar') as carrier \gset
select '376. a holla set to carry water, ranging ' || work_range((select c from creature c where c.id = :'carrier'))
     || ' tiles — the barrel at 5,8 is empty and the well at 6,8 has '
     || round(placed_litres((select p from placed p where p.id = :'well'))::numeric, 1) || ' in it';
update creature set phase = 'idle', until = now() - interval '900 seconds',
    leg_at = now() - interval '900 seconds', leg_ends = now() - interval '900 seconds',
    settled_at = now() - interval '900 seconds' where id = :'carrier';
select worker_settle(:'world2', :'carrier') as carried \gset
select '377. a quarter of an hour of it: ' || :'carried' || ' goes — a fill and a pour apiece — and the barrel holds '
     || round(placed_litres((select p from placed p where p.id = :'barrel'))::numeric, 1) || ' of '
     || liquid_capacity((select p from placed p where p.id = :'barrel')) || ' litres of '
     || coalesce((select liquid from placed where id = :'barrel'), 'nothing')
     || ', with ' || round(placed_litres((select p from placed p where p.id = :'well'))::numeric, 1)
     || ' left in the well: it stops when there is not a bucket''s worth down there';
select '378. the six the liquids brought: '
     || (select string_agg(id, ', ' order by id) from action_def where liquid_action(id))
     || ' — of 374 the island now does ' || (select count(*) from action_def where act_ported(id));

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- an oven, which is a fire with a roof on it'
update player set x = 7.5, y = 7.5 where world_id = :'world2' and uid = :'ivar';
select give(:'world2', :'ivar', 'oven', 1, 55) \g /dev/null
select act_perform(:'world2', :'ivar', 'place_furniture',
  ('{"kind":"item","uid":' || (select id from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'oven' order by id desc limit 1) || ',"x":7,"y":8,"sx":0,"sy":0}')::jsonb) \g /dev/null
select id as oven from placed where world_id = :'world2' and sub = 'oven' order by id desc limit 1 \gset
select '379. an oven set down at 7,8, firebox ' || oven_capacity() || ' seconds against a campfire''s '
     || fire_capacity() || ' — and lighting it with nothing in it: '
     || coalesce(act_refusal(:'world2', :'ivar', 'light_oven', ('{"kind":"furniture","id":' || :'oven' || '}')::jsonb), 'allowed');
select give(:'world2', :'ivar', 'log', 6, 40, 'Pine') \g /dev/null
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'fuel_oven', ('{"kind":"furniture","id":' || :'oven' || ',"count":6}')::jsonb) \g /dev/null
select '380. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'light_oven', ('{"kind":"furniture","id":' || :'oven' || '}')::jsonb) \g /dev/null
select '381. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
-- An hour of it with nobody watching, which is the whole of the point.
update placed set since = now() - interval '1 hour' where id = :'oven';
select '382. an hour later, before anybody looks: the row still says '
     || round((select fuel from placed where id = :'oven')::numeric) || ' seconds — and once anybody does: '
     || oven_burns_for(placed_fuel((select p from placed p where p.id = :'oven')))
     || ' left, with ' || round(placed_ash((select p from placed p where p.id = :'oven'))::numeric, 1) || ' of ashes in it';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'take_ashes_oven', ('{"kind":"furniture","id":' || :'oven' || '}')::jsonb) \g /dev/null
select '383. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'put_out_oven', ('{"kind":"furniture","id":' || :'oven' || '}')::jsonb) \g /dev/null
select '384. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- a lantern, and the candle that burns only while it is lit'
select give(:'world2', :'ivar', 'lantern', 1, 60) \g /dev/null
select id as lamp from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'lantern' limit 1 \gset
select '385. a lantern at QL 60 throws ' || lantern_reach(60) || ' tiles and takes '
     || round(candle_burn(60) / 60) || ' minutes of candle — as it stands: '
     || lantern_state((select i from item i where i.id = :'lamp'))
     || ', and striking it: ' || coalesce(act_refusal(:'world2', :'ivar', 'light_lantern',
        ('{"kind":"item","uid":' || :'lamp' || '}')::jsonb), 'allowed');
select give(:'world2', :'ivar', 'candle', 2, 50) \g /dev/null
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'candle_lantern', ('{"kind":"item","uid":' || :'lamp' || '}')::jsonb) \g /dev/null
select '386. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — ' || lantern_state((select i from item i where i.id = :'lamp'));
/*
 * The browser asks for a tinderbox to strike a light, and there is no
 * tinderbox anywhere in the game — not in the item list, not in a recipe,
 * nowhere but that one check and a help page promising it. So a lantern
 * cannot be lit there either. Ported as written and measured, rather than
 * quietly given an item the game has never had.
 */
select '387. striking it with a candle in: ' || coalesce(act_refusal(:'world2', :'ivar', 'light_lantern',
       ('{"kind":"item","uid":' || :'lamp' || '}')::jsonb), 'allowed')
     || ' — and there is no such thing as a tinderbox in this game: '
     || (select count(*) from item_def where id = 'tinderbox') || ' of them';
-- So the burn is measured by striking it on the row, which is what the action
-- would have done had the item it asks for ever existed.
update item set lit = true, lit_at = now() - interval '5 minutes' where id = :'lamp';
select '388. five minutes lit: ' || lantern_state((select i from item i where i.id = :'lamp'));
update item set lit = false, lit_at = null where id = :'lamp';
select '389. and five minutes dark: ' || lantern_state((select i from item i where i.id = :'lamp'))
     || ' — a lantern in your pack costs you nothing but the weight of it';
update item set lit = true, lit_at = now() - interval '5 minutes' where id = :'lamp';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'douse_lantern', ('{"kind":"item","uid":' || :'lamp' || '}')::jsonb) \g /dev/null
select '390. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — ' || lantern_state((select i from item i where i.id = :'lamp'));

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- an anvil, and what is beaten out on it'
select give(:'world2', :'ivar', 'anvil', 1, 70, 'Iron') \g /dev/null
select id as anvil_item from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'anvil' order by id desc limit 1 \gset
update player set x = 8.5, y = 7.5 where world_id = :'world2' and uid = :'ivar';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'place_anvil',
  ('{"kind":"tile","x":8,"y":8,"sx":0,"sy":0,"uid":' || :'anvil_item' || '}')::jsonb) \g /dev/null
select id as anvil from placed where world_id = :'world2' and kind = 'anvil' order by id desc limit 1 \gset
select '391. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — it is worth ' || round(anvil_ql((select p from placed p where p.id = :'anvil'))::numeric, 1)
     || ' to beat on, from a quality of 70, because what a thing is made of decides how kindly it works';
select '392. and another on the same four subtiles: ' || coalesce(anvil_place_reason(:'world2', 8, 8, 0, 0), 'allowed');

select give(:'world2', :'ivar', 'shovel_head_mould', 1, 60) \g /dev/null
select give(:'world2', :'ivar', 'iron_lump', 8, 55, 'Iron') \g /dev/null
select id as mould from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'shovel_head_mould' limit 1 \gset
insert into skill (world_id, uid, id, value) values (:'world2', :'ivar', 'blacksmithing', 55)
  on conflict (world_id, uid, id) do update set value = 55;
select '393. a shovel head mould at QL 60 has ' || mould_uses_left(60, 0) || ' fillings in it'
     || ', and a rough one at QL 10 has ' || mould_uses_left(10, 0)
     || ' — smithing with no mould chosen: ' || coalesce(act_refusal(:'world2', :'ivar', 'smith',
        ('{"kind":"anvil","id":' || :'anvil' || '}')::jsonb), 'allowed')
     || ' | with an anvil mould, named the browser''s way: ' || coalesce(act_refusal(:'world2', :'ivar', 'smith',
        ('{"kind":"anvil","id":' || :'anvil' || ',"mouldUid":' || (select give(:'world2', :'ivar', 'anvil_mould', 1, 50)) || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
do $$
declare w uuid := (select id from world where name <> 'Rockhaven' order by made_at limit 1);
        me uuid := '11111111-1111-1111-1111-111111111111'; i int;
        a bigint := (select id from placed where kind = 'anvil' order by id desc limit 1);
        m bigint := (select id from item where holder_uid = '11111111-1111-1111-1111-111111111111'
                       and def = 'shovel_head_mould' limit 1);
begin
  for i in 1..6 loop
    -- `mouldUid`, which is what the browser sends and what the island read as
    -- `mould` until this was found: every smith anybody ever tried answered
    -- "Choose a mould." while this line, asking itself, passed.
    exit when act_refusal(w, me, 'smith', jsonb_build_object('kind', 'anvil', 'id', a, 'mouldUid', m)) is not null;
    perform act_perform(w, me, 'smith', jsonb_build_object('kind', 'anvil', 'id', a, 'mouldUid', m));
  end loop;
end $$;
select '394. six goes at it: ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'event');
select '395. shovel heads in the pack: ' || pack_count(:'world2', :'ivar', 'shovel_head')
     || ', lumps left ' || pack_count(:'world2', :'ivar', 'iron_lump')
     || ', and the mould is at ' || coalesce((select round(dmg::numeric, 1)::text from item where id = :'mould'), 'cracked through')
     || ' damage with ' || coalesce((select mould_uses_left(ql, dmg)::text from item where id = :'mould'), '0')
     || ' fillings left — no mould can be mended';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'pick_up_anvil', ('{"kind":"anvil","id":' || :'anvil' || '}')::jsonb) \g /dev/null
select '396. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — anvils standing about: ' || (select count(*) from placed where world_id = :'world2' and kind = 'anvil')
     || ', and in the pack: ' || pack_count(:'world2', :'ivar', 'anvil');
select '397. the ten the forge brought: '
     || (select string_agg(id, ', ' order by id) from action_def where forge_action(id))
     || ' — of 374 the island now does ' || (select count(*) from action_def where act_ported(id));

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- a satchel, and the whole reason bags waited three commits'
update player set x = 5.5, y = 7.5 where world_id = :'world2' and uid = :'ivar';
delete from item where world_id = :'world2' and holder = 'player' and holder_uid = :'ivar' and def = 'plank';
select give(:'world2', :'ivar', 'plank', 9, 45, 'Oak'), give(:'world2', :'ivar', 'nail', 20, 40) \g /dev/null
select give(:'world2', :'ivar', 'satchel', 1, 50) \g /dev/null
select id as bag from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'satchel' limit 1 \gset
select id as planks from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'plank' limit 1 \gset
select '398. a satchel takes ' || bag_room('satchel') || ', a sack ' || bag_room('sack')
     || ', a backpack ' || bag_room('backpack')
     || ' — and putting one bag inside another: ' || coalesce(act_refusal(:'world2', :'ivar', 'stow_item',
        ('{"kind":"item","uid":' || :'bag' || '}')::jsonb), 'allowed');
select '399. nine planks in the pack: ' || pack_count(:'world2', :'ivar', 'plank')
     || ', and a shield, which takes four of them: ' || coalesce(act_refusal(:'world2', :'ivar',
        'make_wooden_shield', '{"kind":"tile","x":5,"y":7}'::jsonb), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'stow_item', ('{"kind":"item","uid":' || :'planks' || ',"count":7}')::jsonb) \g /dev/null
select '400. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — to hand now: ' || pack_count(:'world2', :'ivar', 'plank')
     || ', in the satchel: ' || bag_units(:'bag') || ' of ' || bag_room('satchel');
select '401. and the same shield now: ' || coalesce(act_refusal(:'world2', :'ivar',
       'make_wooden_shield', '{"kind":"tile","x":5,"y":7}'::jsonb), 'allowed')
     || ' — which is the whole of what a bag means: it is yours, it is not to hand';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'empty_bag', ('{"kind":"item","uid":' || :'bag' || '}')::jsonb) \g /dev/null
select '402. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — to hand again: ' || pack_count(:'world2', :'ivar', 'plank')
     || ', in one stack: ' || (select count(*) from item where world_id = :'world2'
          and holder_uid = :'ivar' and holder = 'player' and def = 'plank');

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
select '403. standing at a chest of ' || furniture_capacity((select p from placed p where p.id = :'chest'))
     || ', a bulk bin of ' || furniture_capacity((select p from placed p where p.id = :'bin'))
     || ' and a trash crate of ' || furniture_capacity((select p from placed p where p.id = :'bin_trash'));
select '404. what each of them says to a hatchet: chest — '
     || coalesce(furniture_refuses((select p from placed p where p.id = :'chest'), 'hatchet'), 'it will take it')
     || ' | bulk bin — '
     || coalesce(furniture_refuses((select p from placed p where p.id = :'bin'), 'hatchet'), 'it will take it')
     || ' | a barrel — '
     || coalesce(furniture_refuses((select p from placed p where p.id = :'barrel'), 'hatchet'), 'it will take it');
select id as hatchet2 from item where world_id = :'world2' and holder_uid = :'ivar' and holder = 'player'
  and def = 'hatchet' order by id desc limit 1 \gset
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'store_in_furniture', ('{"kind":"item","uid":' || :'hatchet2' || '}')::jsonb) \g /dev/null
select '405. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — the chest holds ' || furniture_units((select p from placed p where p.id = :'chest'));
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'furniture_take_all', ('{"kind":"furniture","id":' || :'chest' || '}')::jsonb) \g /dev/null
select '406. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and it is now ' || furniture_units((select p from placed p where p.id = :'chest')) || ' deep';
select id as rot from item where world_id = :'world2' and holder_uid = :'ivar' and holder = 'player'
  and def = 'plank' order by id limit 1 \gset
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'throw_away', ('{"kind":"item","uid":' || :'rot' || ',"count":2}')::jsonb) \g /dev/null
select '407. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — the trash crate holds ' || furniture_units((select p from placed p where p.id = :'bin_trash'));

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- and who may read what is in them'
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select '408. Hild reads the island''s stores: ' || (select count(*) from item where holder = 'furniture')
     || ' things put away, and Ivar''s satchel: ' || (select count(*) from item where holder = 'bag')
     || ' — a thing in somebody else''s bag is still somebody else''s';
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select '409. the five that hold things: '
     || (select string_agg(id, ', ' order by id) from action_def where holding_action(id))
     || ' — of 374 the island now does ' || (select count(*) from action_def where act_ported(id));

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- a settlement grows by being built up'
update deed set level = 1, radius = deed_radius(1) where world_id = :'world2';
update player set x = 5.5, y = 7.5 where world_id = :'world2' and uid = :'ivar';
select '410. Stonehaven at level 1 reaches ' || (select radius from deed where world_id = :'world2')
     || ' tiles and works ' || worker_cap(:'world2', :'ivar') || ' wildermon — and level 5 would reach '
     || deed_radius(5) || ' with 5';
select '411. what level 2 wants: ' || (select string_agg(label || ' (' ||
       case when met then 'standing' else 'wanted' end || ')', ', ' order by label)
       from upgrade_wants(:'world2', :'ivar', 2))
     || ' — so: ' || coalesce(upgrade_reason(:'world2', :'ivar'), 'allowed');
-- A campfire on the deed is the one thing level 2 is short of.
delete from placed where world_id = :'world2' and kind = 'campfire';
select '412. with no campfire: ' || coalesce(upgrade_reason(:'world2', :'ivar'), 'allowed');
insert into placed (world_id, kind, x, y, sx, sy, cx, cy, fuel)
values (:'world2', 'campfire', 5, 8, 0, 0, 5.5, 8.5, 120);
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'upgrade_deed', '{"kind":"tile","x":5,"y":7}'::jsonb) \g /dev/null
select '413. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
select '414. and on to 3: ' || coalesce(upgrade_reason(:'world2', :'ivar'), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'rename_deed', '{"kind":"tile","x":5,"y":7,"name":"Ironhearth"}'::jsonb) \g /dev/null
select '415. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — and with no name at all: ' || coalesce(act_refusal(:'world2', :'ivar', 'rename_deed',
        '{"kind":"tile","x":5,"y":7,"name":"  "}'::jsonb), 'allowed');

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- a work post, which rots where it stands'
delete from creature where world_id = :'world2' and mode in ('deed', 'stored', 'wild');
delete from placed where world_id = :'world2' and kind = 'post';
select '416. a rough post stands ' || round(post_life(1) / 60) || ' minutes and reaches '
     || post_radius(1) || ' tiles; the best that can be made stands ' || round(post_life(100) / 60)
     || ' and reaches ' || post_radius(100);
select give(:'world2', :'ivar', 'work_post', 1, 30, 'Pine') \g /dev/null
select id as post_item from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'work_post'
  order by id desc limit 1 \gset
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'place_post',
  ('{"kind":"tile","x":9,"y":7,"sx":1,"sy":1,"uid":' || :'post_item' || '}')::jsonb) \g /dev/null
select id as post from placed where world_id = :'world2' and kind = 'post' order by id desc limit 1 \gset
select '417. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
update player set x = 9.5, y = 7.5 where world_id = :'world2' and uid = :'ivar';
-- Something for it to clear away, out by the post rather than by the token.
select drop_on_ground(:'world2', 9, 8, 'corpse', 30, 'Rabba'),
       drop_on_ground(:'world2', 10, 7, 'corpse', 30, 'Rabba') \g /dev/null
select creature_spawn(:'world2', 'middun', 5.5, 6.5, 'stored', now() - interval '3 hours', :'ivar') as posted \gset
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'assign_post',
  ('{"kind":"post","id":' || :'post' || ',"creature":' || :'posted' || '}')::jsonb) \g /dev/null
select '418. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
select '419. it takes its orders from ' || (select coalesce(post::text, 'the token') from creature where id = :'posted')
     || ', and the site it works out of is ' || (select x || ',' || y || ' within ' || radius || ' tiles'
        from work_site(:'world2', (select c from creature c where c.id = :'posted')))
     || ' — a post holds it to the post''s reach however much it has learned';
-- Ten minutes of it, out of the post rather than the token.
update creature set phase = 'idle', until = now() - interval '600 seconds',
    leg_at = now() - interval '600 seconds', leg_ends = now() - interval '600 seconds',
    settled_at = now() - interval '600 seconds' where id = :'posted';
select worker_settle(:'world2', :'posted') as posted_work \gset
select '420. ten minutes out of the post: ' || :'posted_work' || ' rounds of work — '
     || (select count(*) from item where world_id = :'world2' and holder = 'ground' and def = 'corpse')
     || ' carcasses left by the post, and it is at '
     || (select floor(to_x) || ',' || floor(to_y) from creature where id = :'posted')
     || ', which is ' || (select greatest(abs(floor(to_x) - 9), abs(floor(to_y) - 7))
        from creature where id = :'posted') || ' tiles from the post';

-- And the post goes over, which is the part no other settling does.
select '421. as it stands: ' || post_state((select p from placed p where p.id = :'post'));
update placed set dmg = 0, since = now() - interval '40 minutes' where id = :'post';
select round(post_dmg((select p from placed p where p.id = :'post'))::numeric) as half \gset
select '422. forty minutes into a seventy-four minute post: ' || :'half'
     || ' gone, and it is still standing — a post settles to a number like everything else';
update placed set dmg = 0, since = now() - interval '2 hours' where id = :'post';
delete from event where uid = :'ivar';
select post_sweep(:'world2') as fallen \gset
select '423. two hours nobody watched: ' || :'fallen' || ' post went over, '
     || (select count(*) from placed where world_id = :'world2' and kind = 'post') || ' left standing'
     || ' — and ' || coalesce((select text from event where uid = :'ivar' order by n desc limit 1),
          'nobody was told, which would be a bug');
select '424. and the middun: it takes its orders from '
     || (select coalesce(post::text, 'the token') from creature where id = :'posted')
     || ', standing at ' || (select floor(to_x) || ',' || floor(to_y) from creature where id = :'posted')
     || ' — which is the token, where it came home to';

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- and giving the whole thing up'
select give(:'world2', :'ivar', 'work_post', 1, 60, 'Oak') \g /dev/null
select act_perform(:'world2', :'ivar', 'place_post',
  ('{"kind":"tile","x":9,"y":7,"sx":2,"sy":2,"uid":' || (select id from item where world_id = :'world2'
     and holder_uid = :'ivar' and def = 'work_post' order by id desc limit 1) || '}')::jsonb) \g /dev/null
select id as post2 from placed where world_id = :'world2' and kind = 'post' order by id desc limit 1 \gset
update placed set dmg = 50, since = now() where id = :'post2';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'pick_up_post', ('{"kind":"post","id":' || :'post2' || '}')::jsonb) \g /dev/null
select '425. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — it went in at QL 60 and comes up at '
     || (select round(ql::numeric, 1) from item where world_id = :'world2' and holder_uid = :'ivar'
         and def = 'work_post' order by id desc limit 1) || ', half rotten';
update player set x = 5.5, y = 7.5 where world_id = :'world2' and uid = :'ivar';
select '426. on the deed before it goes: ' || (select count(*) from creature where world_id = :'world2'
       and mode in ('deed', 'stored')) || ' kept, and ' || (select coalesce(sum(count), 0) from item
       where world_id = :'world2' and holder = 'crate') || ' things in the settlement crate';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'disband_deed', '{"kind":"tile","x":5,"y":7}'::jsonb) \g /dev/null
select '427. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
select '428. after: ' || (select count(*) from deed where world_id = :'world2') || ' settlement, '
     || (select count(*) from crate where world_id = :'world2' and deed) || ' deed crate, and '
     || (select count(*) from creature where world_id = :'world2' and mode = 'wild') || ' running wild'
     || ' — founding again: ' || coalesce(act_refusal(:'world2', :'ivar', 'found_settlement',
        ('{"kind":"item","uid":' || (select give(:'world2', :'ivar', 'deed_stake', 1, 50)) || '}')::jsonb), 'allowed');
select '429. the seven the settlement brought: '
     || (select string_agg(id, ', ' order by id) from action_def where settlement_action(id))
     || ' — of 374 the island now does ' || (select count(*) from action_def where act_ported(id));

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- and a thing made of nothing in particular'
/*
 * The live smoke test found this by looking at the first thing in the pack,
 * which is something this file had never done: every examine here was of a
 * thing it had put there itself, with a material on it. The kit had a `knife`
 * in it that does not exist in this game, and a null in a concatenation is a
 * null all the way out, so the action died on a not-null constraint rather
 * than saying a word.
 */
select '430. things in the kit with no definition behind them: '
     || (select count(*) from item i left join item_def d on d.id = i.def where d.id is null)
     || ' — and the kit itself is ' || (select count(*) from item where world_id = :'world2'
          and holder_uid = :'hild' and holder = 'player' and issued) || ' issued tools plus a stake';
select give(:'world2', :'ivar', 'bucket', 1, 42) \g /dev/null
select '431. examining a bucket, which is made of nothing in particular: '
     || examine_item_text(:'world2', :'ivar', (select i from item i where i.world_id = :'world2'
          and i.holder_uid = :'ivar' and i.def = 'bucket' and i.extra is null order by i.id desc limit 1));
select '432. and one with a material on it: '
     || examine_item_text(:'world2', :'ivar', (select i from item i where i.world_id = :'world2'
          and i.holder_uid = :'ivar' and i.extra is not null order by i.id desc limit 1));

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- what the old people left in the ground'
update player set x = 8.5, y = 9.5 where world_id = :'world2' and uid = :'ivar';
select land_set_tile(:'world2', 8, 10, 1) \g /dev/null
delete from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'fragment';
select '433. the eight things under this island: '
     || (select string_agg(name || ' (' || parts || ' pieces, ' || result || ')', ', ' order by difficulty)
         from relic_def);
select '434. an archaeologist at 1 would know ' || (select count(*) from relics_within(1))
     || ' of them, at 30 ' || (select count(*) from relics_within(30))
     || ', at 60 ' || (select count(*) from relics_within(60))
     || ' — and a turn of the trowel at 30 with a QL 40 trowel finds something '
     || round(find_chance(30, 40) * 100) || ' times in a hundred';
update item set holder = 'ground', holder_uid = null, gx = 0, gy = 0
  where world_id = :'world2' and holder_uid = :'ivar' and def = 'trowel';
select '435. with no trowel in hand: ' || coalesce(act_refusal(:'world2', :'ivar', 'investigate',
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
select '436. forty-eight tiles gone over at archaeology 45: '
     || (select count(*) from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'fragment')
     || ' fragments, of ' || (select count(distinct fragment_relic(extra)) from item
          where world_id = :'world2' and holder_uid = :'ivar' and def = 'fragment') || ' different things'
     || ' — and going over the same ground again: ' || coalesce(act_refusal(:'world2', :'ivar',
        'investigate', '{"kind":"tile","x":8,"y":10}'::jsonb), 'allowed');
select '437. what has come up: ' || (select string_agg(fragment_relic(extra) || ' ' || fragment_part(extra)
       || '/' || (select parts from relic_def r where r.name = fragment_relic(i.extra)), ', '
       order by fragment_relic(extra), fragment_part(extra))
       from item i where i.world_id = :'world2' and i.holder_uid = :'ivar' and i.def = 'fragment');

-- Putting one back together.
select fragment_relic(extra) as relic from item where world_id = :'world2' and holder_uid = :'ivar'
  and def = 'fragment' order by fragment_relic(extra) limit 1 \gset
select '438. of the ' || (select parts from relic_def where name = :'relic') || ' pieces of the '
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
select '439. every piece of the ' || :'whole' || ' in hand at QL 55 and 30 damage: '
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
select '440. ' || (select string_agg(text, ' | ' order by n) from event where uid = :'ivar' and kind = 'event');

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- and a nose that does the digging for you'
select '441. a snout is the twenty-second trade: '
     || (select count(*) from (values ('forage'), ('botanize'), ('woodcut'), ('farm'), ('mine'), ('sand'),
                                      ('clay'), ('quarry'), ('stoke'), ('fetch'), ('guard'), ('hunt'),
                                      ('peat'), ('reed'), ('water'), ('prospect'), ('plant'), ('hod'),
                                      ('mend'), ('compost'), ('seek'), ('fish')) v(k) where worker_job_ported(v.k))
     || ' of twenty-two, which is all of them';
insert into deed (world_id, name, x, y, radius, level, founded_by)
values (:'world2', 'Lastfound', 8, 11, deed_radius(3), 3, :'ivar')
on conflict (world_id, founded_by) do update set name = 'Lastfound', x = 8, y = 11, radius = deed_radius(3), level = 3;
select place_deed_crate(:'world2', :'ivar') \g /dev/null
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
select '442. a quarter of an hour of a snout: ' || :'nosed' || ' holes dug, '
     || (select count(*) from foraged where world_id = :'world2' and kind = 'dig') || ' patches of ground gone over'
     || ', and in the crate: ' || coalesce((select count(*)::text from item where world_id = :'world2'
          and holder = 'crate' and def = 'fragment'), '0') || ' fragments';
select '443. the three that came with the relics: '
     || (select string_agg(id, ', ' order by id) from action_def where dig_action(id))
     || ' — of 374 the island now does ' || (select count(*) from action_def where act_ported(id));

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- what you catch while you are somewhere else'
delete from placed where world_id = :'world2' and kind = 'trap';
delete from creature where world_id = :'world2' and mode = 'wild';
update player set x = 2.5, y = 3.5 where world_id = :'world2' and uid = :'ivar';
select '444. the three of them: ' || (select string_agg(name || ' — holds taming ' || holds
       || ', reaches ' || reach || ', ' || round(odds * 100) || ' in a hundred a roll, stands '
       || round(life_min / 60) || '–' || round(life_max / 60) || ' minutes', ' | ' order by difficulty)
       from trap_def);
select give(:'world2', :'ivar', 'snare', 1, 60, 'Oak') \g /dev/null
select id as snare_item from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'snare'
  order by id desc limit 1 \gset
select '445. inside your own borders: ' || coalesce(act_refusal(:'world2', :'ivar', 'set_trap',
       ('{"kind":"tile","x":8,"y":11,"sx":0,"sy":0,"uid":' || :'snare_item' || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'set_trap',
  ('{"kind":"tile","x":2,"y":4,"sx":1,"sy":1,"uid":' || :'snare_item' || '}')::jsonb) \g /dev/null
select id as snare from placed where world_id = :'world2' and kind = 'trap' order by id desc limit 1 \gset
select '446. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
select '447. as it stands: ' || trap_state((select p from placed p where p.id = :'snare'))
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
select '448. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
select creature_spawn(:'world2', 'rabba', 2.6, 4.6, 'wild', now() - interval '2 hours') as prey2 \gset
update creature set from_x = to_x, from_y = to_y, leg_at = now(), leg_ends = now(),
    until = now() + interval '2 hours', settled_at = now() - interval '1 second' where id = :'prey2';
select '449. a rabba a stride from the noose: it would be caught '
     || round(catch_chance((select p from placed p where p.id = :'snare'),
                           (select c from creature c where c.id = :'prey2')) * 100)
     || ' times in a hundred a roll, and a roll is every ' || trap_check_every() || ' seconds'
     || ' — so an hour of it is ' || floor(3600 / trap_check_every()) || ' rolls, which is a certainty';
update placed set since = now() - interval '1 hour' where id = :'snare';
delete from event where uid = :'ivar';
select trap_settle(:'snare') \g /dev/null
select '450. an hour nobody watched: ' || trap_state((select p from placed p where p.id = :'snare'))
     || ' — and it said: ' || coalesce((select text from event where uid = :'ivar' order by n desc limit 1), 'nothing');
select '451. the rabba knows it: it is held by trap '
     || coalesce((select trapped::text from creature where id = :'prey2'), 'nothing')
     || ', and standing at ' || (select round(to_x::numeric, 1) || ',' || round(to_y::numeric, 1)
        from creature where id = :'prey2') || ', which is the noose';

-- Getting it out is a skill, and taking the trap up first is not allowed.
select '452. taking the trap up with something in it: ' || coalesce(act_refusal(:'world2', :'ivar',
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
select '453. ' || coalesce((select text from event where uid = :'ivar' and kind = 'event'
       order by n desc limit 1), 'it said nothing at all')
     || ' — the rabba is now ' || (select mode from creature where id = :'prey2')
     || ' and the trap is ' || trap_state((select p from placed p where p.id = :'snare'));

-- And the whole thing comes up again, half rotten.
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'pick_up_trap', ('{"kind":"trap","id":' || :'snare' || '}')::jsonb) \g /dev/null
select '454. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — it went down at QL 60 with nothing on it and comes up with '
     || (select round(dmg::numeric) from item where world_id = :'world2' and holder_uid = :'ivar'
         and def = 'snare' order by id desc limit 1) || ' damage on it, from an hour in the weather';
select '455. traps left standing: ' || (select count(*) from placed where world_id = :'world2' and kind = 'trap')
     || ' — and the six that came with them: '
     || (select string_agg(id, ', ' order by id) from action_def where trap_action(id))
     || ', of 374 the island now does ' || (select count(*) from action_def where act_ported(id));
/*
 * And the answer to that question is now nothing at all — which is what took
 * this measurement down the first time it was true, because `string_agg` over
 * no rows is null and a null in a sentence is a null all the way out. The
 * nineteenth time that has happened, and the last.
 */
select '456. and asked outright what it still cannot do: ' ||
       coalesce((select nullif(count(*), 0)::text || ' of them, the first eight being '
                 || (select string_agg(u, ', ') from (select u from rpc_unported() u limit 8) s)
                 from rpc_unported()),
                'nothing. Three hundred and seventy-three of three hundred and seventy-three')
     || ' — which is the question the live suite used to answer by trying six and'
     || ' filling its own head with the jobs that started';

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- a seat, a set of traces and the shafts of a cart'
delete from placed where world_id = :'world2' and kind = 'furniture';
delete from creature where world_id = :'world2';
update player set x = 5.5, y = 7.5 where world_id = :'world2' and uid = :'ivar';
select '457. what carries and what pulls: '
     || (select string_agg(name || ' (' || case when mount is not null then 'saddle' else 'traces only' end
         || ', pull ' || coalesce(pull, 0.25) || ')', ', ' order by id)
         from species_def where mount is not null or draught)
     || ' — and the tack is ' || (select string_agg(item, ' and ' order by ord) from tack_def);
select creature_spawn(:'world2', 'orse', 5.6, 7.6, 'active', now() - interval '1 day') as horse \gset
update creature set keeper = :'ivar', hunger = 1, from_x = to_x, from_y = to_y,
    leg_at = now(), leg_ends = now(), settled_at = now(), name = 'Greyfell' where id = :'horse';
select '458. with nothing in the pack: ' || coalesce(act_refusal(:'world2', :'ivar', 'tack_creature',
       ('{"kind":"creature","id":' || :'horse' || '}')::jsonb), 'allowed');
select give(:'world2', :'ivar', 'saddle', 1, 40) \g /dev/null
select give(:'world2', :'ivar', 'bridle', 1, 40) \g /dev/null
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'tack_creature',
  ('{"kind":"creature","id":' || :'horse' || '}')::jsonb) \g /dev/null
select '459. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and the tack is out of the pack: '
     || (select count(*) from item where world_id = :'world2' and holder_uid = :'ivar'
         and def in ('saddle', 'bridle')) || ' pieces left';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'mount_creature',
  ('{"kind":"creature","id":' || :'horse' || '}')::jsonb) \g /dev/null
select '460. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
/*
 * A green horse is no quicker than walking, and that is the browser's own
 * arithmetic rather than a slip: `footing` is 0.9 until something has been
 * learned on bad ground. What a horse is worth having is what it learns.
 */
select '461. how fast the island will believe you: ' || round(base_speed()::numeric, 2)
     || ' tiles a second on your own legs, and ' || round(travel_speed(:'world2', :'ivar')::numeric, 2)
     || ' up on a green Greyfell';
update creature set skills = jsonb_set(skills, '{climbing}', '60') where id = :'horse';
select '462. once it has learned the hills: ' || round(travel_speed(:'world2', :'ivar')::numeric, 2)
     || ' tiles a second, and a step of '
     || round(mount_step((select c from creature c where c.id = :'horse'))::numeric)
     || ' where your own legs take ' || round(max_step()::numeric)
     || ' — a horse is worth having for what it learns, not for what it is';
-- Nothing ticks, so the horse moves when the rider does and not before.
select drag_along(:'world2', :'ivar', 20.5, 30.5) \g /dev/null
update player set x = 20.5, y = 30.5 where world_id = :'world2' and uid = :'ivar';
select '463. fifteen tiles later Greyfell is at '
     || (select round(creature_x(c)::numeric, 1) || ',' || round(creature_y(c)::numeric, 1)
         from creature c where c.id = :'horse')
     || ' — which is under the saddle, because a mount does not walk, it is dragged along';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'dismount_creature',
  ('{"kind":"creature","id":' || :'horse' || '}')::jsonb) \g /dev/null
select '464. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
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
select '465. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
select drag_along(:'world2', :'ivar', 9.5, 12.5) \g /dev/null
update player set x = 9.5, y = 12.5 where world_id = :'world2' and uid = :'ivar';
-- A second cart, to be told you have your hands full. The same one is not a
-- second one: the browser lets you take hold of what you are already holding.
select give(:'world2', :'ivar', 'cart', 1, 50, 'Oak') \g /dev/null
select act_perform(:'world2', :'ivar', 'place_furniture',
  ('{"kind":"item","uid":' || (select id from item where world_id = :'world2' and holder_uid = :'ivar'
     and def = 'cart' order by id desc limit 1) || ',"x":9,"y":12,"sx":2,"sy":2}')::jsonb) \g /dev/null
select id as cart2 from placed where world_id = :'world2' and sub = 'cart' order by id desc limit 1 \gset
select '466. and it came: the cart is at ' || (select x || ',' || y from placed where id = :'cart')
     || ' — taking hold of the oak one as well: ' || coalesce(act_refusal(:'world2', :'ivar', 'pull_cart',
        ('{"kind":"furniture","id":' || :'cart2' || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'drop_cart', ('{"kind":"furniture","id":' || :'cart' || '}')::jsonb) \g /dev/null
select '467. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and it stays at ' || (select x || ',' || y from placed where id = :'cart') || ' now nobody has it';

-- A large cart, which will not stir until there is something in the yoke.
select give(:'world2', :'ivar', 'large_cart', 1, 50, 'Pine') \g /dev/null
select act_perform(:'world2', :'ivar', 'place_furniture',
  ('{"kind":"item","uid":' || (select id from item where world_id = :'world2' and holder_uid = :'ivar'
     and def = 'large_cart' order by id desc limit 1) || ',"x":9,"y":12,"sx":0,"sy":0}')::jsonb) \g /dev/null
select id as wain from placed where world_id = :'world2' and sub = 'large_cart' order by id desc limit 1 \gset
select '468. the ones that are driven: ' || (select string_agg(v.id || ' — ' || v.yokes || ' yokes, '
       || v.needs || ' needed, seat ' || v.seat, ' | ' order by v.yokes) from vehicle_def v)
     || ' — and the hulls: ' || (select string_agg(b.id || ' at ' || b.speed || ' in '
       || b.draught || ' of water' || case when b.sail then ' under sail' else ' on oars' end,
       ' | ' order by b.speed) from boat_def b);
select '469. with nothing in the yokes: ' || coalesce(act_refusal(:'world2', :'ivar', 'board_vehicle',
       ('{"kind":"furniture","id":' || :'wain' || '}')::jsonb), 'allowed');
update creature set to_x = 9.6, to_y = 12.6, from_x = 9.6, from_y = 12.6,
    leg_at = now(), leg_ends = now(), settled_at = now() where id = :'horse';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'hitch_creature',
  ('{"kind":"creature","id":' || :'horse' || '}')::jsonb) \g /dev/null
select '470. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
select creature_spawn(:'world2', 'orse', 9.7, 12.7, 'active', now() - interval '1 day') as horse2 \gset
update creature set keeper = :'ivar', hunger = 1, from_x = to_x, from_y = to_y,
    leg_at = now(), leg_ends = now(), settled_at = now(), name = 'Dunn',
    skills = jsonb_set(skills, '{climbing}', '20') where id = :'horse2';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'hitch_creature',
  ('{"kind":"creature","id":' || :'horse2' || '}')::jsonb) \g /dev/null
select '471. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and getting up on one of them now: ' || coalesce(act_refusal(:'world2', :'ivar',
        'mount_creature', ('{"kind":"creature","id":' || :'horse' || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'board_vehicle',
  ('{"kind":"furniture","id":' || :'wain' || '}')::jsonb) \g /dev/null
select '472. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
select '473. two in a pine cart make ' || round(vehicle_speed(:'world2', :'wain')::numeric, 2)
     || ' tiles a second and take a step of ' || round(vehicle_step(:'world2', :'wain')::numeric)
     || ' — the pair of them know ' || round(team_climb(:'world2', :'wain')::numeric)
     || ' of the hills between them, and the ceiling now allows '
     || round(travel_speed(:'world2', :'ivar')::numeric, 2);
select drag_along(:'world2', :'ivar', 14.5, 12.5) \g /dev/null
update player set x = 14.5, y = 12.5 where world_id = :'world2' and uid = :'ivar';
select '474. five tiles on: the cart is at ' || (select x || ',' || y from placed where id = :'wain')
     || ' and the team is at ' || (select string_agg(round(creature_x(c)::numeric, 1) || ','
        || round(creature_y(c)::numeric, 1), ' and ' order by c.id) from creature c
        where c.hitched_to = :'wain')
     || ' — the team goes where the cart goes, and the cart goes where the driver goes';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'leave_vehicle', ('{"kind":"furniture","id":' || :'wain' || '}')::jsonb) \g /dev/null
select '475. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and off the seat the ceiling is ' || round(travel_speed(:'world2', :'ivar')::numeric, 2)
     || ' again, with the pair of them still in the yokes';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'unhitch_creature',
  ('{"kind":"creature","id":' || :'horse' || '}')::jsonb) \g /dev/null
select '476. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — ' || (select count(*) from creature where world_id = :'world2' and hitched_to = :'wain')
     || ' left in the yokes';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'unhitch_team', ('{"kind":"furniture","id":' || :'wain' || '}')::jsonb) \g /dev/null
select '477. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and with the yokes empty nobody is driving: '
     || (select count(*) from placed where id = :'wain' and driver is not null) || ' hands on the reins';
update player set x = 14.5, y = 12.5 where world_id = :'world2' and uid = :'ivar';
update creature set to_x = 14.6, to_y = 12.6, from_x = 14.6, from_y = 12.6,
    leg_at = now(), leg_ends = now(), settled_at = now() where id = :'horse';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'untack_creature',
  ('{"kind":"creature","id":' || :'horse' || '}')::jsonb) \g /dev/null
select '478. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and it is back in the pack: ' || (select string_agg(def || ' at QL ' || round(ql::numeric), ', '
        order by def) from item where world_id = :'world2' and holder_uid = :'ivar'
        and def in ('saddle', 'bridle'));

-- And a hull, which asks nothing but that she is still floating.
select give(:'world2', :'ivar', 'rowing_boat', 1, 50, 'Pine') \g /dev/null
select act_perform(:'world2', :'ivar', 'place_furniture',
  ('{"kind":"item","uid":' || (select id from item where world_id = :'world2' and holder_uid = :'ivar'
     and def = 'rowing_boat' order by id desc limit 1) || ',"x":14,"y":12,"sx":0,"sy":0}')::jsonb) \g /dev/null
select id as boat from placed where world_id = :'world2' and sub = 'rowing_boat' order by id desc limit 1 \gset
select '479. a rowing boat dragged up a hillside that stands '
     || round(centre_height(:'world2', 14, 12)::numeric) || ' above the water, when she wants '
     || (select draught from boat_def where id = 'rowing_boat') || ' of it under her: '
     || coalesce(act_refusal(:'world2', :'ivar', 'board_vehicle',
        ('{"kind":"furniture","id":' || :'boat' || '}')::jsonb), 'allowed');
select '480. the eleven that came with the reins: '
     || (select string_agg(id, ', ' order by id) from action_def where ride_action(id))
     || ' — of 374 the island now does ' || (select count(*) from action_def where act_ported(id));

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- and what a thing has to be empty of before it will come up'
update player set x = 14.5, y = 12.5 where world_id = :'world2' and uid = :'ivar';
select act_perform(:'world2', :'ivar', 'hitch_creature',
  ('{"kind":"creature","id":' || :'horse2' || '}')::jsonb) \g /dev/null
select '481. with one in the yokes: ' || coalesce(act_refusal(:'world2', :'ivar', 'pick_up_furniture',
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
select '482. and from the seat of it: ' || coalesce(act_refusal(:'world2', :'ivar', 'pick_up_furniture',
       ('{"kind":"furniture","id":' || :'wain' || '}')::jsonb), 'allowed');
select act_perform(:'world2', :'ivar', 'leave_vehicle', ('{"kind":"furniture","id":' || :'wain' || '}')::jsonb) \g /dev/null
update player set x = 9.5, y = 12.5 where world_id = :'world2' and uid = :'ivar';
select act_perform(:'world2', :'ivar', 'pull_cart', ('{"kind":"furniture","id":' || :'cart' || '}')::jsonb) \g /dev/null
select '483. and a cart by the shafts: ' || coalesce(act_refusal(:'world2', :'ivar', 'pick_up_furniture',
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
select '484. a chest with twenty nails in it: ' || coalesce(act_refusal(:'world2', :'ivar',
       'pick_up_furniture', ('{"kind":"furniture","id":' || :'chest' || '}')::jsonb), 'allowed')
     || ' — and the nails are still there: '
     || (select coalesce(sum(count), 0) from item where holder = 'furniture' and placed = :'chest');
select give(:'world2', :'ivar', 'barrel', 1, 50, 'Oak') \g /dev/null
select act_perform(:'world2', :'ivar', 'place_furniture',
  ('{"kind":"item","uid":' || (select id from item where world_id = :'world2' and holder_uid = :'ivar'
     and def = 'barrel' order by id desc limit 1) || ',"x":9,"y":12,"sx":1,"sy":3}')::jsonb) \g /dev/null
select id as tun from placed where world_id = :'world2' and sub = 'barrel' order by id desc limit 1 \gset
update placed set litres = 30, liquid = 'water', since = now() where id = :'tun';
select '485. and a barrel with ' || round(placed_litres((select p from placed p where p.id = :'tun'))::numeric)
     || ' litres of water in it: ' || coalesce(act_refusal(:'world2', :'ivar', 'pick_up_furniture',
        ('{"kind":"furniture","id":' || :'tun' || '}')::jsonb), 'allowed');

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- an altar, and three ways of looking at all this'
delete from placed where world_id = :'world2' and kind = 'furniture';
delete from creature where world_id = :'world2';
delete from deed where world_id = :'world2';
update player set x = 5.5, y = 7.5, favour = 0, favour_at = now(), prayed_at = null,
    sat_at = null, way = null, used_at = '{}'::jsonb, wounds = '[]'::jsonb
  where world_id = :'world2' and uid = :'ivar';
delete from skill where world_id = :'world2' and uid = :'ivar' and id in ('prayer', 'meditation');
select '486. what a prayer buys: ' || (select string_agg(name || ' (' || cost || ' favour at prayer '
       || level || ', on ' || on_what || ')', ', ' order by level) from cast_def);
select '487. and the three ways: ' || (select string_agg(d.name || ' — ' ||
       (select string_agg(s.name, ', ' order by s.n) from path_step s where s.path = d.id),
       ' | ' order by d.id) from path_def d);
select '488. nothing to kneel at: ' || coalesce(act_refusal(:'world2', :'ivar', 'pray',
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
select '489. eighteen things with no definition behind them, now: '
     || (select count(*) from (select r.result as id from recipe r left join item_def d
         on d.id = r.result where d.id is null union select i.item from recipe_input i
         left join item_def d2 on d2.id = i.item where d2.id is null) z)
     || ' — and a spare altar in the pack says: '
     || coalesce(examine_item_text(:'world2', :'ivar', (select i from item i
        where i.world_id = :'world2' and i.holder_uid = :'ivar' and i.def = 'altar'
        order by i.id desc limit 1)), 'nothing at all');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'pray', ('{"kind":"furniture","id":' || :'altar' || '}')::jsonb) \g /dev/null
select '490. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — a QL 70 altar at ' || round(hour_of_day(:'world2')::numeric, 1) || ' o''clock is worth '
     || round(prayer_worth(70, hour_of_day(:'world2'), 0)::numeric, 1)
     || ', where dawn would be worth ' || round(prayer_worth(70, 6, 0)::numeric, 1);
select '491. and again today: ' || coalesce(act_refusal(:'world2', :'ivar', 'pray',
       ('{"kind":"furniture","id":' || :'altar' || '}')::jsonb), 'allowed');
-- Favour is a well: a rate, a ceiling, and a note of when anybody last looked.
update player set favour = 4, favour_at = now() - interval '1 hour'
  where world_id = :'world2' and uid = :'ivar';
select '492. four favour and an hour nobody looked: ' || round(favour_settle(:'world2', :'ivar')::numeric, 1)
     || ' — it fills at ' || favour_trickle() || ' a second up to '
     || round(favour_cap(skill_of(:'world2', :'ivar', 'prayer'))::numeric, 1)
     || ', which is what this much faith carries';
select '493. calling for something beyond us: ' || coalesce(act_refusal(:'world2', :'ivar', 'cast',
       '{"kind":"item","spell":"bounty"}'::jsonb), 'allowed');
insert into skill (world_id, uid, id, value) values (:'world2', :'ivar', 'prayer', 40)
  on conflict (world_id, uid, id) do update set value = 40;
update player set favour = 100, favour_at = now() where world_id = :'world2' and uid = :'ivar';
select id as issued from item where world_id = :'world2' and holder_uid = :'ivar' and issued limit 1 \gset
select '494. the circle on something we washed ashore with: ' || coalesce(act_refusal(:'world2', :'ivar',
       'cast', ('{"kind":"item","spell":"cunning","uid":' || :'issued' || '}')::jsonb), 'allowed');
select give(:'world2', :'ivar', 'hatchet', 1, 50, 'Steel') as made \gset
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'cast',
  ('{"kind":"item","spell":"cunning","uid":' || :'made' || '}')::jsonb) \g /dev/null
select '495. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — a steel hatchet at QL 50 was worth ' || round(tool_worth(50, 0, 'Steel', null, 0)::numeric, 1)
     || ' to work with and is now worth ' || round(tool_worth(50, 0, 'Steel', null, 1)::numeric, 1);
update item set bless = 3 where id = :'made';
update player set favour = 100, favour_at = now() where world_id = :'world2' and uid = :'ivar';
select '496. and a fourth time: ' || coalesce(act_refusal(:'world2', :'ivar', 'cast',
       ('{"kind":"item","spell":"cunning","uid":' || :'made' || '}')::jsonb), 'allowed')
     || ' — mending a thing with nothing wrong with it: '
     || coalesce(act_refusal(:'world2', :'ivar', 'cast',
        ('{"kind":"item","spell":"mend","uid":' || :'made' || '}')::jsonb), 'allowed');

-- The rug, and what comes of sitting on it.
select '497. sitting with nothing to sit on: ' || coalesce(act_refusal(:'world2', :'ivar', 'meditate',
       '{"kind":"tile","x":5,"y":7}'::jsonb), 'allowed');
select give(:'world2', :'ivar', 'rug', 1, 40) \g /dev/null
select '498. where you sit is most of it: ' || (select said from sitting_worth(:'world2', :'ivar'))
     || ' — worth ' || round((select gain from sitting_worth(:'world2', :'ivar'))::numeric, 2);
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'meditate', '{"kind":"tile","x":5,"y":7}'::jsonb) \g /dev/null
select '499. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — and again today: ' || coalesce(act_refusal(:'world2', :'ivar', 'meditate',
        '{"kind":"tile","x":5,"y":7}'::jsonb), 'allowed');
select '500. choosing before it is clear: ' || coalesce(act_refusal(:'world2', :'ivar', 'choose_path',
       '{"kind":"tile","material":"love"}'::jsonb), 'allowed');
insert into skill (world_id, uid, id, value) values (:'world2', :'ivar', 'meditation', 5)
  on conflict (world_id, uid, id) do update set value = 5;
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'choose_path', '{"kind":"tile","material":"love"}'::jsonb) \g /dev/null
select '501. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
select '502. and choosing again: ' || coalesce(act_refusal(:'world2', :'ivar', 'choose_path',
       '{"kind":"tile","material":"power"}'::jsonb), 'allowed');
-- Sitting until the path opens out. Each step announces itself as it arrives.
update player set sat_at = null where world_id = :'world2' and uid = :'ivar';
insert into skill (world_id, uid, id, value) values (:'world2', :'ivar', 'meditation', 11.6)
  on conflict (world_id, uid, id) do update set value = 11.6;
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'meditate', '{"kind":"tile","x":5,"y":7}'::jsonb) \g /dev/null
select '503. ' || coalesce((select string_agg(text, ' | ' order by n) from event
       where uid = :'ivar' and kind = 'system'), 'nothing opened out');
select '504. calling on something nobody taught us: ' || coalesce(act_refusal(:'world2', :'ivar',
       'use_ability', '{"kind":"tile","material":"fury"}'::jsonb), 'allowed');
update player set stats = jsonb_set(jsonb_set(stats, '{hunger}', '0.2'), '{thirst}', '0.1')
  where world_id = :'world2' and uid = :'ivar';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'use_ability', '{"kind":"tile","material":"refresh"}'::jsonb) \g /dev/null
select '505. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
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
select '506. what the path is worth, the same body either way: a rabba would trust him '
     || :'with_love' || ' times in a hundred with Gentle hand behind him and '
     || :'without' || ' without it'
     || ' — and ' || (select count(*) from path_step where ability is not null)
     || ' of the fifteen steps are called on rather than simply true, the rest being true all the time';
select '507. the five that came with it: '
     || (select string_agg(id, ', ' order by id) from action_def where faith_action(id))
     || ' — of 374 the island now does ' || (select count(*) from action_def where act_ported(id));

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- a bridge, a bed, a herd, a pot of dye and a barrel of ale'
delete from placed where world_id = :'world2' and kind = 'furniture';
delete from creature where world_id = :'world2';
delete from bridge where world_id = :'world2';
select '508. the three kinds: ' || (select string_agg(name || ' — spans ' || span || ', '
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
select '509. a rope bridge to the next tile along: '
     || coalesce(bridge_reason(:'world2', 'rope', 2, 13, 3, 13), 'allowed')
     || ' — and one that goes across a corner: '
     || coalesce(bridge_reason(:'world2', 'rope', 2, 13, 7, 14), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'plan_bridge', '{"kind":"tile","x":7,"y":13,"material":"wood"}'::jsonb) \g /dev/null
select id as span_bridge from bridge where world_id = :'world2' order by id desc limit 1 \gset
select '510. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
select '511. as it stands: ' || bridge_state(:'world2', :'span_bridge')
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
select '512. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
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
select '513. ' || (select text from event where uid = :'ivar' and kind = 'system' order by n desc limit 1)
     || ' — ' || bridge_state(:'world2', :'span_bridge');
update player set x = 2.5, y = 13.5 where world_id = :'world2' and uid = :'ivar';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'demolish_bridge',
  ('{"kind":"bridge","id":' || :'span_bridge' || '}')::jsonb) \g /dev/null
select '514. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
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
select '515. at ' || world_clock(:'world2') || ': ' || coalesce(act_refusal(:'world2', :'ivar', 'sleep',
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
select '516. ' || (select text from event where uid = :'ivar' order by n desc limit 1);
/*
 * And the night happened to everything else as well — not by being walked
 * forward, but by every one of them being told it was longer ago than it was.
 * The wheat has to be *looked at* before it shows, which is the whole of how
 * this island has worked since the first campfire.
 */
select crop_settle(:'world2', 12, 12) \g /dev/null
select '517. sown at bedtime, and nobody watched it: the wheat is at stage '
     || (select stage from crop where world_id = :'world2' and x = 12 and y = 12)
     || ' of ' || crop_ripe() || ' at ' || (select stage_seconds from crop_def where id = 'wheat')
     || ' seconds a stage, a plank made at bedtime is ' || round((extract(epoch from (now() -
        (select made_at from item where id = :'fresh'))) / 60)::numeric) || ' minutes old, '
     || 'and favour has come back to ' || round(favour_settle(:'world2', :'ivar')::numeric, 1)
     || ' — all of it out of one night that took no time at all';
select '518. what a night is worth: ' || round(rest_left((select p from player p
       where p.world_id = :'world2' and p.uid = :'ivar'))::numeric) || ' seconds of rest, '
     || 'while which everything teaches you ' || round(rest_bonus(:'world2', :'ivar')::numeric)
     || ' times as much — and the bed is now home: '
     || coalesce(act_refusal(:'world2', :'ivar', 'set_home',
        ('{"kind":"furniture","id":' || :'bed' || '}')::jsonb), 'allowed');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'set_home', ('{"kind":"furniture","id":' || :'bed' || '}')::jsonb) \g /dev/null
select '519. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
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
select '520. with no settlement to put the young one in: '
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
select '521. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
/*
 * Blood does not read itself: a common trait is plain to anybody, a rare one
 * takes fifteen husbandry, and a fantastic one sixty. The same beast reads
 * differently to two different people, which is the whole of the mechanism.
 */
select '522. at husbandry 70: ' || blood_read(:'world2', :'ivar',
       (select c from creature c where c.id = :'ewe'));
select '523. and at husbandry 1, the same beast: ' || blood_read(:'world2', :'hild',
       (select c from creature c where c.id = :'ewe'));
-- The hour comes whether anybody is there for it.
update creature set due = now() - interval '1 second' where id = :'ewe';
delete from event where uid = :'ivar';
select herd_settle(:'world2') as dropped \gset
select '524. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — ' || :'dropped' || ' hour came, and the herd is now '
     || (select count(*) from creature where world_id = :'world2' and mode <> 'wild') || ' strong';

-- Colour, and a barrel left alone.
select give(:'world2', :'ivar', 'satchel', 1, 50) as bag \gset
select '525. with no pot in the pack: ' || coalesce(act_refusal(:'world2', :'ivar', 'dye_item',
       ('{"kind":"item","uid":' || :'bag' || '}')::jsonb), 'allowed')
     || ' — and a hatchet, which will take nothing: '
     || coalesce(act_refusal(:'world2', :'ivar', 'dye_item',
        ('{"kind":"item","uid":' || (select give(:'world2', :'ivar', 'hatchet', 1, 40)) || '}')::jsonb), 'allowed');
select give(:'world2', :'ivar', 'dye', 1, 60, (select name from dye_def order by id limit 1)) \g /dev/null
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'dye_item', ('{"kind":"item","uid":' || :'bag' || '}')::jsonb) \g /dev/null
select '526. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — and it is called ' || (select item_name(i) from item i where i.id = :'bag');
delete from item where world_id = :'world2' and holder_uid = :'ivar'
  and def in ('lye_bucket', 'bucket');
select '527. boiling it out with nothing to boil it in: '
     || coalesce(act_refusal(:'world2', :'ivar', 'strip_dye',
        ('{"kind":"item","uid":' || :'bag' || '}')::jsonb), 'allowed');
select give(:'world2', :'ivar', 'lye_bucket', 1, 45) \g /dev/null
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'strip_dye', ('{"kind":"item","uid":' || :'bag' || '}')::jsonb) \g /dev/null
select '528. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — and the lye goes with it: ' ||
       (select count(*) from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'lye_bucket')
     || ' bucket of lye left and ' ||
       (select count(*) from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'bucket')
     || ' plain one back';
select '529. what a barrel of water becomes: ' || (select string_agg(name || ' — ' || count || ' '
       || input || ' in ' || litres || ' litres, ' || round(seconds / 60) || ' minutes at brewing '
       || difficulty, ' | ' order by seconds) from brew_def);
select give(:'world2', :'ivar', 'barrel', 1, 50, 'Oak') \g /dev/null
select act_perform(:'world2', :'ivar', 'place_furniture',
  ('{"kind":"item","uid":' || (select id from item where world_id = :'world2' and holder_uid = :'ivar'
     and def = 'barrel' order by id desc limit 1) || ',"x":5,"y":8,"sx":0,"sy":0}')::jsonb) \g /dev/null
select id as tun2 from placed where world_id = :'world2' and sub = 'barrel' order by id desc limit 1 \gset
select '530. a dry barrel: ' || coalesce(act_refusal(:'world2', :'ivar', 'start_brew',
       ('{"kind":"furniture","id":' || :'tun2' || ',"brew":"ale"}')::jsonb), 'allowed');
update placed set litres = 20, liquid = 'water', since = now() where id = :'tun2';
select '531. water but no wheat: ' || coalesce(act_refusal(:'world2', :'ivar', 'start_brew',
       ('{"kind":"furniture","id":' || :'tun2' || ',"brew":"ale"}')::jsonb), 'allowed');
insert into skill (world_id, uid, id, value) values (:'world2', :'ivar', 'brewing', 90)
  on conflict (world_id, uid, id) do update set value = 90;
select give(:'world2', :'ivar', 'wheat', 12, 55) \g /dev/null
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'start_brew',
  ('{"kind":"furniture","id":' || :'tun2' || ',"brew":"ale"}')::jsonb) \g /dev/null
select '532. ' || (select text from event where uid = :'ivar' order by n desc limit 1)
     || ' — and it is ' || (select case when is_working(p) then 'still working, '
        || round(ferment_left(p) / 60) || ' minutes to go' else 'ready' end
        from placed p where p.id = :'tun2');
select '533. and a barrel that is working: ' || coalesce(act_refusal(:'world2', :'ivar', 'start_brew',
       ('{"kind":"furniture","id":' || :'tun2' || ',"brew":"ale"}')::jsonb), 'allowed');
update placed set since = now() - interval '20 minutes' where id = :'tun2';
select '534. twenty minutes later: ' || (select case when is_working(p) then 'still working'
       else 'ale, ' || round(placed_litres(p)) || ' litres of it at QL ' || round(p.ql::numeric) end
       from placed p where p.id = :'tun2')
     || ' — and a brew is a well running the other way: one column, one timestamp, no machinery';
select '535. the last ten: '
     || (select string_agg(id, ', ' order by id) from action_def where last_action(id))
     || ' — of 374 the island now does ' || (select count(*) from action_def where act_ported(id));

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- a torch, and the end of the tinderbox'
delete from placed where world_id = :'world2' and kind = 'campfire';
delete from item where world_id = :'world2' and holder_uid = :'ivar' and def in ('torch', 'lantern');
update player set x = 5.5, y = 7.5 where world_id = :'world2' and uid = :'ivar';
select '536. what a torch is: ' || (select string_agg(i.item || ' × ' || i.count, ' + ' order by i.ord)
       from recipe_input i where i.recipe = 'make_torch')
     || ' at ' || (select skill || ' ' || difficulty from recipe where id = 'make_torch')
     || ' — it burns ' || round(torch_burn(50) / 60) || ' minutes at QL 50 and throws '
     || held_reach('torch', 50) || ' tiles, where a lantern of the same make throws '
     || held_reach('lantern', 50);
select give(:'world2', :'ivar', 'torch', 1, 50) as torch \gset
select '537. with nothing burning anywhere near: ' || coalesce(act_refusal(:'world2', :'ivar',
       'light_lantern', ('{"kind":"item","uid":' || :'torch' || '}')::jsonb), 'allowed');
-- A fire to light it at, set down rather than built: what is being measured
-- here is the torch, and building a campfire is measured elsewhere.
insert into placed (world_id, kind, x, y, sx, sy, cx, cy, ql, fuel, lit, since, made_by)
  values (:'world2', 'campfire', 5, 7, 1, 1, 5.5, 7.5, 40, 600, true, now(), :'ivar');
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'light_lantern', ('{"kind":"item","uid":' || :'torch' || '}')::jsonb) \g /dev/null
select '538. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1);
select '539. and a lantern with no candle in it: '
     || coalesce(act_refusal(:'world2', :'ivar', 'light_lantern',
        ('{"kind":"item","uid":' || (select give(:'world2', :'ivar', 'lantern', 1, 60)) || '}')::jsonb), 'allowed')
     || ' — but the torch in hand is a light to take one off: '
     || coalesce(flame_near(:'world2', :'ivar'), 'nothing');
-- And it burns down while it is lit, and only while it is lit.
update item set lit_at = now() - interval '2 minutes' where id = :'torch';
select '540. two minutes of torch later: ' || round(candle_left((select i from item i where i.id = :'torch')) / 60)
     || ' minutes left of the ' || round(torch_burn(50) / 60) || ' it started with';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'douse_lantern', ('{"kind":"item","uid":' || :'torch' || '}')::jsonb) \g /dev/null
select '541. ' || (select text from event where uid = :'ivar' and kind = 'event' order by n desc limit 1)
     || ' — and there are ' || (select count(*) from item_def where id = 'tinderbox')
     || ' tinderboxes in this game, which is how many there always were';

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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

select '542. what counts as a username: ' || string_agg(
         quote_literal(n) || ' ' || case when name_ok(n) then 'yes' else 'no' end, ', ' order by ord)
  from (values ('alice', 1), ('al', 2), ('a1ice_the-third', 3), ('1alice', 4),
               ('alice smith', 5), ('alice@home', 6), ('averyverylongnameindeedx', 7)) v(n, ord);

select '543. a name goes out as ' || name_email('Alice') || ' and comes back as '
     || coalesce(email_name('ALICE@players.wurm.invalid'), 'nothing')
     || ' — and an address that is not ours comes back as '
     || coalesce(email_name('alice@example.com'), 'nothing');

select '544. is bob free? ' || rpc_name_free('bob')::text
     || ' — is alice? ' || rpc_name_free('alice')::text
     || ' — is ALICE? ' || rpc_name_free('ALICE')::text
     || ' — is "al"? ' || rpc_name_free('al')::text;

-- What makes the name hers is not this call; it is the row above. This is the
-- filing, and the filing takes no argument at all.
select set_config('request.jwt.claims', json_build_object('sub', :'alice')::text, false) \g /dev/null
select '545. before alice asks, account holds ' || (select count(*) from account) || ' rows';
select rpc_my_name() \g /dev/null
select rpc_my_name() \g /dev/null
select '546. she asks her name three times: ' || coalesce(rpc_my_name(), 'none')
     || ' — and account holds ' || (select count(*) from account)
     || ' row, which is how many three askings should leave';

-- Signing up is the reservation, and this is the index that does it.
do $$ begin
  insert into auth.users (id, email) values ('66666666-6666-6666-6666-666666666666', 'ALICE@players.wurm.invalid');
  raise notice '547. a second alice signs up:      ALLOWED';
exception when others then raise notice '547. a second alice signs up:      refused — %', sqlerrm; end $$;

-- The name follows the address, so there is no argument for a client to lie in.
insert into auth.users (id, email) values (:'bob', 'bob@players.wurm.invalid');
select set_config('request.jwt.claims', json_build_object('sub', :'bob')::text, false) \g /dev/null
select '548. bob asks his own name: ' || coalesce(rpc_my_name(), 'none')
     || ' — and what alice is called is still ' || coalesce(account_name(:'alice'), 'nothing');

select set_config('request.jwt.claims', json_build_object('sub', :'ghost')::text, false) \g /dev/null
select '549. an anonymous account asks: ' || coalesce(rpc_my_name(), 'no name to prove')
     || ' — rows in account: ' || (select count(*) from account);

select set_config('request.jwt.claims', json_build_object('sub', null)::text, false) \g /dev/null
select '550. nobody at all asks: ' || coalesce(rpc_my_name(), 'no name to prove');

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
  raise notice '551. bob files a name for free:    ALLOWED';
exception when others then raise notice '551. bob files a name for free:    refused — %', sqlerrm; end $$;
do $$ begin
  update account set name = 'alice' where uid = '44444444-4444-4444-4444-444444444444';
  raise notice '552. bob renames himself alice:    ALLOWED';
exception when others then raise notice '552. bob renames himself alice:    refused — %', sqlerrm; end $$;
select '553. bob reads the names on the island: ' || string_agg(a.name, ', ' order by a.name) from account a;
reset role;

-- One door opens before you have an account, because whoever is knocking has
-- none. Every other door stays shut to a stranger.
select '554. what a stranger may call: '
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
select '555. the policies on the roll of names: '
     || string_agg(p.polname || ' for ' || array_to_string(p.polroles::regrole[], ' and '), ', ' order by p.polname)
  from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname = 'account';
select count(*) as really from account \gset
set role anon;
select set_config('request.jwt.claims', json_build_object('sub', null)::text, false) \g /dev/null
select '556. a stranger reads the roll of names: ' || (select count(*) from account)
     || ' of the ' || :really || ' there are';
reset role;

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- a face, and where it is kept'
-- Eight short strings, chosen on the landing page between making an account
-- and stepping ashore. What is measured here is that none of them can be
-- anything but an entry in a table we wrote: a look goes from a stranger's
-- browser through this database into `fillStyle` on everybody else's machine,
-- and that path is no place for a free-text colour.
select '557. what the creator offers: ' || string_agg(kind || ' ' || n, ', ' order by kind)
  from (select kind, count(*) as n from look_option group by kind) k;
select '558. and every kind has one to fall back on: '
     || (select count(*) from look_option where fallback) || ' of '
     || (select count(distinct kind) from look_option);

select '559. a look full of rubbish: '
     || look_clean('{"skin":"green","hair":"<script>alert(1)</script>","eyes":"blue","shirt":"woad","gender":"woman"}'::jsonb)::text;
select '560. and one that is empty: ' || look_clean('{}'::jsonb)::text;
select '561. a random face is a real one: '
     || (select count(*) from jsonb_each_text(look_random()) f
         where exists (select 1 from look_option o where o.kind = f.key and o.id = f.value))
     || ' of its ' || (select count(*) from jsonb_each_text(look_random())) || ' fields are in the tables';

-- Alice comes ashore, and then changes her mind about her hair.
select set_config('request.jwt.claims', json_build_object('sub', :'alice')::text, false) \g /dev/null
select rpc_join(:'world', 'Alice') \g /dev/null
select '562. alice comes ashore with no face chosen: ' || (select (look ->> 'hair') is not null
       from player where uid = :'alice') || ' — she has one anyway, because nobody is the default figure';
select rpc_set_look('{"gender":"woman","skin":"deep","hair":"braids","hairColour":"black","eyes":"green","beard":"none","shirt":"woad","trousers":"bark"}'::jsonb) \g /dev/null
select '563. she chooses: ' || (select look ->> 'hair' from account where uid = :'alice')
     || ', ' || (select look ->> 'skin' from account where uid = :'alice')
     || ' — and the body already ashore has it too: '
     || (select look ->> 'hair' from player where uid = :'alice');
-- A look is a whole face rather than a patch, so what is not named goes back
-- to the fallback along with what was named and is not real. The creator
-- always sends all eight; this is what happens to anything that does not.
select rpc_set_look('{"hair":"there is no such haircut","skin":"#ff0000","eyes":"amber"}'::jsonb) \g /dev/null
select '564. three fields, one of them a colour and one a haircut nobody has: '
     || (select look::text from account where uid = :'alice')
     || ' — a look is a whole face, not a patch';

-- And somebody on the island can see it, which is the whole point of storing
-- it on the body rather than only on the account.
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select '565. hild looks at alice: ' || coalesce((select p.look ->> 'eyes' || ' eyes, '
       || (p.look ->> 'skin') || ' skin' from player p where p.uid = :'alice'), 'nothing to see');
reset role;

-- A body with nobody behind it still gets a face of its own.
select set_config('request.jwt.claims', json_build_object('sub', :'ghost')::text, false) \g /dev/null
select rpc_join(:'world', 'Nobody') \g /dev/null
select '566. an account with no name comes ashore: ' || (select look::text from player where uid = :'ghost');
do $$ begin
  perform rpc_set_look('{"hair":"bald"}'::jsonb);
  raise notice '567. and tries to choose a face:   ALLOWED';
exception when others then raise notice '567. and tries to choose a face:   refused — %', sqlerrm; end $$;

select set_config('request.jwt.claims', json_build_object('sub', null)::text, false) \g /dev/null
do $$ begin
  perform rpc_set_look('{"hair":"bald"}'::jsonb);
  raise notice '568. nobody at all chooses a face: ALLOWED';
exception when others then raise notice '568. nobody at all chooses a face: refused — %', sqlerrm; end $$;

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- the big island'
-- Sixteen kilometres a side instead of one. What makes it affordable is not
-- storage and not writes — both were always fine — but that the land stops
-- travelling: a join carries the seed and every browser works out the ground
-- it is standing on. docs/tile-map-cost-analysis.md has the arithmetic.
select set_config('request.jwt.claims', json_build_object('sub', :'alice')::text, false) \g /dev/null
select rpc_found('Bigness', 7, 4096, 2048, 2048) as big \gset
select '569. an island of 4096: ' || (select size || ' tiles a side, ' || round((size::bigint * size) / 1e6) || ' M of them'
       from world where id = :'big')
     || ', laid down in ' || (select count(*) from land_corner where world_id = :'big') || ' rows of corners and '
     || (select count(*) from land_tile where world_id = :'big') || ' of tiles';
do $$ begin
  perform rpc_found('Bigger still', 7, 8192, 1, 1);
  raise notice '570. and one twice that:            ALLOWED';
exception when others then raise notice '570. and one twice that:            refused — %', sqlerrm; end $$;

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
select '571. coming ashore on it hands over ' || length(rpc_join(:'big', 'Alice')::text)
     || ' bytes — the world row, the body and the hour, and not one tile of land';
-- What the old way would have cost, from the same schema, so the two numbers
-- sit next to each other rather than one of them being a claim.
select '572. the land it did not send: ' || round(((select size from world where id = :'big') + 1)
       * (((select size from world where id = :'big') + 1) * 3 + (select size from world where id = :'big') * 3)
       * 4.0 / 3 / 1048576) || ' MB, which is what every join used to be';
select '573. and the land is still here to be asked: a band of four rows is '
     || length(land_window(:'big', 0, 3)::text) || ' bytes of it, off '
     || (select length(heights) from land_corner where world_id = :'big' and y = 0) || ' bytes a row of corners';

-- Walking into country nobody has been in puts the wildlife out there.
select set_config('request.jwt.claims', json_build_object('sub', :'alice')::text, false) \g /dev/null
update player set moved_at = now() - interval '1 hour' where uid = :'alice' and world_id = :'big';
select '574. blocks of country stocked before a step: ' || (select count(*) from world_stocked where world_id = :'big');
select rpc_move(:'big', 2300, 2048, 0) \g /dev/null
select '575. and after one: ' || (select count(*) from world_stocked where world_id = :'big')
     || ' — a step inside country already put out costs one index probe and nothing else';
-- And somewhere nobody has been. `rpc_move` believes about forty tiles a call,
-- so getting there properly is a dozen steps; what is being measured is what
-- happens when you arrive, not how long the walk is.
select creature_stock_near(:'big', 2600, 2048) \g /dev/null
select '576. arriving two blocks over: ' || (select count(*) from world_stocked where world_id = :'big')
     || ' blocks out now, and ' || (select count(*) from creature where world_id = :'big') || ' wild things on the island';

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- how long everything takes'
-- `base_time` is a weight, not a clock. Mining is the yardstick: a beginner
-- with a plain pickaxe spends thirty seconds on a face of rock, and every
-- other job keeps the ratio to that it always had.
select '577. the yardstick: a beginner at the rock takes '
     || round(act_duration((select base_time from action_def where id = 'mine'), 0, 0, 1))
     || ' seconds, and it is meant to take ' || round(mining_seconds())
     || ' — ' || case when act_duration((select base_time from action_def where id = 'mine'), 0, 0, 1) = mining_seconds()
                      then 'they agree' else 'THEY HAVE DRIFTED' end;
select '578. and mining still weighs ' || (select base_time from action_def where id = 'mine')
     || ' against the ' || round(mining_weight()) || ' the pace was worked out from';
select '579. the same rock with skill and a good tool: '
     || string_agg(round(act_duration((select base_time from action_def where id = 'mine'), s.skill, s.ql, 1)) || 's at skill '
                   || s.skill || ' with a QL ' || s.ql || ' pick', ', ' order by s.skill)
  from (values (1, 20), (50, 50), (90, 90)) s(skill, ql);
select '580. the shortest a go at anything can be: ' || act_duration(0, 99, 99, 1)
     || ' seconds, which is the old 1.2 at the new pace';
select '581. a spread of jobs, for the feel of it: '
     || string_agg(a.label || ' ' || round(act_duration(a.base_time, 1, 20, 1)) || 's', ', ' order by a.base_time, a.id)
  from action_def a where a.id in ('forage', 'dig', 'mine', 'make_large_cart', 'make_wagon');
select '582. and a worker over the same task takes ' || round(work_duration(20))
     || ' seconds at skill 20, which is twice what a hand of that skill would';

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- and how long the world takes'
-- Actions have a pace and so does everything the world does on its own. Cotton
-- is that second yardstick: five minutes a stage, and every other world timer
-- keeps the ratio to it that it always had.
select '583. the world runs at ' || world_pace() || ' seconds to the unit, against the '
     || action_pace() || ' a job runs at';
select '584. the yardstick: a stage of cotton is '
     || (select stage_seconds from crop_def where id = 'cotton') || ' seconds, and it is meant to be '
     || cotton_seconds() || ' — ' || case when (select stage_seconds from crop_def where id = 'cotton') = cotton_seconds()
                                          then 'they agree' else 'THEY HAVE DRIFTED' end;
select '585. a day is now ' || round(day_seconds() / 60) || ' minutes, of which '
     || round(day_seconds() * 10 / 24 / 60) || ' are dark';
select '586. every crop, sown to ripe: ' || string_agg(c.name || ' ' || round(c.stage_seconds * 3 / 60) || 'm',
       ', ' order by c.stage_seconds, c.id) from crop_def c;
select '587. and the rest of the world: carrying ' || round(gestation() / 60) || 'm, and again after '
     || round(breed_rest() / 60) || 'm; a prayer is worth something again after ' || round(prayer_rest() / 60)
     || 'm; ale works for ' || (select round(seconds / 60) from brew_def where id = 'ale') || 'm';
-- What matters is that the two clocks keep step with each other in game days,
-- which is the thing a rebase is for.
select '588. corn is ' || round((select stage_seconds * 3 from crop_def where id = 'corn') / mining_seconds())
     || ' swings of a pickaxe of waiting, against 56 before either clock moved and 15 after only the '
     || 'jobs did — the two paces are 3.75 and 2.5, so that ratio does not come all the way back. '
     || 'What does come back exactly is the day: ' || round((select stage_seconds * 3 from crop_def where id = 'corn')
        / day_seconds() * 100) || ' hundredths of one, which is what it always was';

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- a sprout under your own feet'
-- A tree is the one tile on this island that nothing can stand on, and `plant`
-- makes the ground into one. Asking nothing about where the planter stood let
-- somebody wall themselves in with a sprout and chop their way back out.
select land_set_tile(:'world2', 11, 9, 0) \g /dev/null
select give(:'world2', :'ivar', 'sprout', 1, 20, 'Oak') \g /dev/null
update player set x = 11.5, y = 9.5 where world_id = :'world2' and uid = :'ivar';
select '589. stood on 11,9 and asked to plant the sprout there: '
     || coalesce(act_refusal(:'world2', :'ivar', 'plant', '{"kind":"tile","x":11,"y":9}'::jsonb),
                 'ALLOWED — AND THE PLANTER IS WALLED IN');
update player set x = 12.5, y = 9.5 where world_id = :'world2' and uid = :'ivar';
select '590. one step to the side, the same tile and the same sprout: '
     || coalesce(act_refusal(:'world2', :'ivar', 'plant', '{"kind":"tile","x":11,"y":9}'::jsonb), 'allowed');

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- the island''s own clock'
-- Everything here settles off a timestamp, which works right up to the moment
-- nobody calls. `settle` had three callers and the browser reached one of them
-- only when the body moved, so a job finished while standing still landed at
-- whatever later moment somebody happened to walk somewhere.
/*
 * What the two hot creature queries are allowed to ask for.
 *
 * Both read every creature row on the island and threw nearly all of them
 * away, and both run once a second per player now — O(players x creatures),
 * which grows as the product. `creature_at` is what narrows them.
 *
 * This asks about the *shape* rather than the plan. At the half-dozen
 * creatures this suite keeps, a sequential scan is the right choice and
 * Postgres makes it; asking whether the index was used would fail here and
 * pass on a full island, which is worse than not asking. What can actually
 * regress is somebody writing the filter back as a function of the columns —
 * `greatest(abs(to_x - x), abs(to_y - y))` is the same square as two
 * `between`s and is not something a btree can be asked about.
 */
select '591. the box both hot creature reads narrow by: '
     || (select count(*) from pg_indexes
         where indexname = 'creature_at' and indexdef like '%(world_id, to_x, to_y)%')
     || ' index over (world_id, to_x, to_y), and the two that use it ask in ranges: '
     || (select count(*) from pg_proc
         where proname in ('creature_sweep', 'rpc_creatures')
           and prosrc like '%to_x between%' and prosrc like '%to_y between%')
     || ' of 2, with ' || leg_slack() || ' tiles of slack against a longest real leg of 2.13';
/*
 * Three answers that used to say more than they had to.
 *
 * The ground goes out in two halves — the fires that burn down while you watch
 * and the walls that do not — the skill book only when one of them has moved,
 * and the talk with a cursor under it, which it never had.
 *
 * All three are *absent* rather than empty when there is nothing to say, and
 * the browser applies only the keys it is given. That is the part worth
 * watching: a key that comes back empty instead of missing would wipe what the
 * browser holds, which for the settlements is your whole map.
 */
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select '592. the ground, whole: ' || (select string_agg(k, ', ' order by k)
         from jsonb_object_keys(rpc_ground(:'world2', 40)) k)
     || ' — and the half that burns: ' || (select string_agg(k, ', ' order by k)
         from jsonb_object_keys(rpc_ground(:'world2', 40, false)) k);
select rpc_settle(null, :'world2') \g /dev/null
select '593. a beat with nothing done carries ' || coalesce((select string_agg(k, ', ' order by k)
         from jsonb_object_keys(rpc_settle(null, :'world2')) k where k in ('skills', 'said')),
       'neither the book nor the talk');
select skill_raise(:'world2', :'ivar', 'mining', 1) \g /dev/null
select '594. and one after a skill moved carries ' || coalesce((select string_agg(k, ', ' order by k)
         from jsonb_object_keys(rpc_settle(null, :'world2')) k where k in ('skills', 'said')), 'nothing');
-- And the half of that which was wrong: the stamp is on the player, not on the
-- session, so a page that had just opened — holding nothing but the starting
-- value of every skill — was told nothing, because the last page had been.
-- Reported as an iron vein refusing a miner with "Yours is 1.0" under a log
-- line saying 13.26, which also locks: the seam you cannot start is the seam
-- that would have raised the skill that says you can.
select rpc_settle(null, :'world2') \g /dev/null
select '594b. a browser that has just opened, holding no book, asks for it: mining '
     || coalesce((rpc_settle(null, :'world2', null, true))->'skills'->>'mining', 'NOT SENT')
     || ' — and the beat after, holding it: ' || coalesce((select string_agg(k, ', ' order by k)
         from jsonb_object_keys(rpc_settle(null, :'world2', null, false)) k where k = 'skills'),
       'left out, which is what the delta is for');
-- And who the catch-up is for. It is counted from the highest line the browser
-- has heard, and a browser that has just opened has heard none: it carried a
-- nought, `e.n > 0` is every line on the island, and a refresh was handed its
-- own oldest sixty back — beginning, on a played-in body, at the day it washed
-- ashore. A nought means "I have just got here"; what was said before that is
-- `rpc_chat`'s, and a joining browser already asks it.
select '595. a browser that has just opened, carrying a nought: '
     || jsonb_array_length(coalesce((rpc_settle(null, :'world2', 0))->'said', '[]'::jsonb))
     || ' lines to catch up on, and the mark to count from after this: '
     || coalesce((rpc_settle(null, :'world2', 0))->>'saidTo',
                 'NONE, SO IT WILL ASK FROM THE BEGINNING AGAIN');
-- And the case it was built for: a channel down while two lines go past, one
-- to him and one to the island.
select (select coalesce(max(n), 0) from event where world_id = :'world2') as dropped \gset
select tell(:'world2', :'ivar', 'Your fire has gone out.', 'info') \g /dev/null
select tell(:'world2', null, 'Somewhere a tree comes down.', 'system') \g /dev/null
select '595b. and one whose channel dropped at ' || :'dropped' || ', two lines ago: '
     || jsonb_array_length(coalesce((rpc_settle(null, :'world2', :'dropped'))->'said', '[]'::jsonb))
     || ' lines it had not heard — "'
     || coalesce((rpc_settle(null, :'world2', :'dropped'))->'said'->0->>'text', 'NOTHING')
     || '" first — and the mark is '
     || coalesce((rpc_settle(null, :'world2', :'dropped'))->>'saidTo',
                 'left out, because it has one of its own');
/*
 * And the thing that would have broken the island: `create or replace` with a
 * new argument list makes a second function rather than replacing the first,
 * and PostgREST picks by the arguments it was handed — so two of either of
 * these is every call coming back "could not choose a best candidate".
 */
select '596. one door apiece, not two: '
     || (select string_agg(proname || '/' || pronargs, ', ' order by proname)
         from pg_proc where proname in ('rpc_settle', 'rpc_ground'));

/*
 * And what you are carrying, which had never gone out at all.
 *
 * `wounds_settle` has drained health, turned wounds bad and closed them over
 * since they were ported, and no door mentioned them — so the window was empty
 * however cut about you were, and the health going down had no stated reason.
 */
update player set wounds = '[{"kind":"cut","part":"chest","severity":0.2,"bleeding":true,"infected":false,"dressing":null}]'::jsonb
  where world_id = :'world2' and uid = :'ivar' \g /dev/null
select '597. the beat now says what you are carrying: '
     || jsonb_array_length(coalesce((rpc_settle(null, :'world2'))->'wounds', '[]'::jsonb))
     || ' — ' || coalesce(((rpc_settle(null, :'world2'))->'wounds'->0->>'kind'), 'nothing')
     || ' to the ' || coalesce(((rpc_settle(null, :'world2'))->'wounds'->0->>'part'), 'nowhere')
     || ', bleeding ' || round(wound_drain((rpc_settle(null, :'world2'))->'wounds'->0)::numeric, 4)
     || ' a second, which is what the bar has to come down by';
update player set wounds = '[]'::jsonb where world_id = :'world2' and uid = :'ivar' \g /dev/null
select '598. and once they have closed over it says so, rather than saying nothing: '
     || ((rpc_settle(null, :'world2'))->'wounds')::text;

select '599. the clock: a round every ' || tick_seconds() || ' seconds, a shut tab left standing for '
     || to_char(idle_logout() / 60, 'FM990.0') || ' minutes, talk kept ' || round(event_keep() / 3600)
     || ' hours, tile changes ' || round(change_keep() / 86400) || ' days, and an island nobody visits '
     || round(island_keep() / 86400) || ' days';
select '600. and the counter every door writes to is '
     || (select case relpersistence when 'u' then 'unlogged, so a hundred and thirty bytes a call is nothing'
                                    else 'LOGGED — every rate-limit check is write-ahead log' end
         from pg_class where relname = 'caller')
     || ', with ' || (select coalesce(substring(array_to_string(reloptions, ',') from 'fillfactor=[0-9]+'), 'no fillfactor')
                      from pg_class where relname = 'caller')
     || ' so the row is rewritten in place';

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
select '601. he digs, and then stands perfectly still. Ten minutes later he is still '
     || coalesce((select act from player where world_id = :'world2' and uid = :'ivar'), 'finished')
     || ' — nothing has called, so nothing has happened';
select world_tick()::text as tock \gset
select '602. one round of the clock: ' || :'tock';
select '603. and now he is ' || coalesce((select act from player where world_id = :'world2' and uid = :'ivar'), 'finished')
     || ', having been told: '
     || coalesce((select text from event where world_id = :'world2' and uid = :'ivar' and kind = 'event'
                  order by n desc limit 1), 'nothing');

-- A body nobody has been near for hours is a shut tab, not a person.
update player set seen_at = now() - interval '3 hours', away = false
  where world_id = :'world2' and uid = :'hild';
select world_tick() \g /dev/null
select '604. hild left her tab open three hours ago: away is now '
     || (select away from player where world_id = :'world2' and uid = :'hild')
     || ', and the island heard "'
     || coalesce((select text from event where world_id = :'world2' and uid is null
                  and text like '% has gone home.' order by n desc limit 1), 'nothing') || '"';
select '605. ivar, who was here a moment ago, is still on his feet: away is '
     || (select away from player where world_id = :'world2' and uid = :'ivar');
select '606. and nobody can turn the handle for anybody else: rpc_sweep is '
     || case when exists (select 1 from pg_proc where proname = 'rpc_sweep'
                            and pronamespace = 'public'::regnamespace)
             then 'STILL THERE' else 'gone, and rpc_settle only settles the caller' end;
select '607. does this database wind itself? '
     || case when clock_running() then 'yes — pg_cron has the key'
             else 'no pg_cron here, so the browser settles itself and the suite turns the handle' end;
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select rpc_join(:'world2') \g /dev/null
select '608. and she comes back: away is now '
     || (select away from player where world_id = :'world2' and uid = :'hild')
     || ', and she was told "'
     || coalesce((select text from event where world_id = :'world2' and uid = :'hild' and kind = 'system'
                  order by n desc limit 1), 'nothing') || '"';

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
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
select '609. an island Ivar has never been to: he can see '
     || (select count(*) from item where world_id = :'faraway' and holder = 'ground') || ' of its ground things, '
     || (select count(*) from placed where world_id = :'faraway') || ' of its fires and '
     || (select count(*) from tile_change where world_id = :'faraway') || ' of its dug tiles'
     || ' — all three were the whole service before';
select '610. and the land itself is still open on purpose: '
     || (select count(*) from land_tile where world_id = :'faraway') || ' rows, because it is a pure function of a seed anybody is handed';
do $$ begin
  begin perform land_window((select id from world where name = 'Faraway'), 0, 8);
    raise notice '611. pull the land down wholesale: ALLOWED';
  exception when others then raise notice '611. pull the land down wholesale: refused — %', sqlerrm; end;
end $$;
reset role;
select '612. and rpc_land itself is '
     || case when exists (select 1 from pg_proc where proname = 'rpc_land' and pronamespace = 'public'::regnamespace)
             then 'STILL THERE' else 'gone; land_window has the body and no grant' end;

-- The ground under a claimed walk, read on a flat empty island where the only
-- thing in the way is the thing put there.
insert into player (world_id, uid, name, x, y, stats)
  values (:'faraway', :'ivar', 'Ivar', 5.5, 5.5, '{"health":1,"stamina":1,"hunger":1,"thirst":1}'::jsonb)
  on conflict (world_id, uid) do update set x = 5.5, y = 5.5, away = false;
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select '613. four tiles of flat open ground: he gets '
     || round(walk_share(:'faraway', :'ivar', 0, 5.5, 5.5, 9.5, 5.5)::numeric * 100) || '% of the way';
select land_set_tile(:'faraway', 7, 5, 16) \g /dev/null
select '614. with a tree grown in the middle of it: '
     || round(walk_share(:'faraway', :'ivar', 0, 5.5, 5.5, 9.5, 5.5)::numeric * 100)
     || '% — pulled up at the trunk, which is the one tile nothing stands on';
select land_set_tile(:'faraway', 7, 5, 0) \g /dev/null
select land_set_height(:'faraway', 9, 5, 3000), land_set_height(:'faraway', 9, 6, 3000),
       land_set_height(:'faraway', 10, 5, 3000), land_set_height(:'faraway', 10, 6, 3000) \g /dev/null
select '615. and with a cliff instead: tile 8 is ' || round(centre_height(:'faraway', 8, 5))
     || ' units up from tile 7, against a step of '
     || round(max_step() + skill_of(:'faraway', :'ivar', 'climbing') * climb_per_level())
     || ' — he gets ' || round(walk_share(:'faraway', :'ivar', 0, 5.5, 5.5, 9.5, 5.5)::numeric * 100) || '%';
update player set moved_at = now() - interval '10 seconds' where world_id = :'faraway' and uid = :'ivar';
select '616. and through rpc_move, which is where it counts: ' || (rpc_move(:'faraway', 9.5, 5.5, 0))::text;
select land_set_height(:'faraway', 9, 5, 0), land_set_height(:'faraway', 9, 6, 0),
       land_set_height(:'faraway', 10, 5, 0), land_set_height(:'faraway', 10, 6, 0) \g /dev/null
update player set moved_at = now() - interval '10 seconds' where world_id = :'faraway' and uid = :'ivar';
select '617. the cliff levelled, the same walk again: ' || (rpc_move(:'faraway', 9.5, 5.5, 0))::text;

-- Counting the callers.
delete from caller where uid = :'ivar';
select '618. a minute of asking: the island keeps listening for '
     || (select count(*) from generate_series(1, (calls_a_minute() + 20)::int) g
         where not too_fast(:'ivar')) || ' of ' || (calls_a_minute() + 20)::int
     || ' calls, which is the ' || calls_a_minute() || ' it is meant to be';
delete from caller where uid = :'ivar';

-- Giving an island up.
update world set made_by = :'ivar' where id = :'world2';
update player set seen_at = now(), away = false where world_id = :'world2' and uid = :'hild';
do $$ begin
  begin perform rpc_abandon((select id from world where name <> 'Rockhaven' and name <> 'Faraway' order by made_at limit 1));
    raise notice '619. give up an island with Hild still on it: ALLOWED';
  exception when others then raise notice '619. give up an island with Hild still on it: refused — %', sqlerrm; end;
end $$;
select '620. and the one foreign key with nothing behind it now has: '
     || (select count(*) from pg_indexes where tablename = 'item' and indexdef like '%(placed)%')
     || ' index on item(placed)';

-- And what reading the ground costs where the ground is biggest. A move call
-- is at most one a second per person, so this is the budget that decides
-- whether the check can stay.
do $$
declare t0 timestamptz; s double precision; cold double precision; warm double precision;
        w uuid := (select id from world where size = 4096 order by made_at desc limit 1);
begin
  if w is null then raise notice '621. no 4096 island to read'; return; end if;
  delete from land_chunk where world_id = w;
  t0 := clock_timestamp();
  s := walk_share(w, '11111111-1111-1111-1111-111111111111', 0, 2000.5, 2000.5, 2030.5, 2000.5);
  cold := extract(milliseconds from (clock_timestamp() - t0));
  t0 := clock_timestamp();
  s := walk_share(w, '11111111-1111-1111-1111-111111111111', 0, 2000.5, 2000.5, 2030.5, 2000.5);
  warm := extract(milliseconds from (clock_timestamp() - t0));
  raise notice '621. the ground under a thirty-tile walk on the 4096 island: % per cent of it walkable, read in % ms '
               'with the square to build first and % ms with it built — against 13 ms off the scanlines',
    round(s::numeric * 100), round(cold::numeric, 1), round(warm::numeric, 2);
end $$;

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- the land, read in squares'
select '632. a square of the 4096 island holds ' || length(tiles) || ' bytes of tiles and '
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
  raise notice '633. a tree planted in the middle of that walk: % squares held, % after the write, '
               'and the walk now gets % per cent of the way — the cache never answers for the scanlines',
    had, left_after, saw;
end $$;
select '634. and the scanlines are still the truth: tile 2005,2000 says '
     || land_tile((select id from world where size = 4096 order by made_at desc limit 1), 2005, 2000)
     || ', which is what was written to them';

-- And does reading the ground in squares give the same answers as reading it
-- in strips? The live run that found the walk check also raised the question,
-- because "the ground refused a walk" and "the cache read the ground wrong"
-- look identical from outside. A reference that reads the scanlines directly,
-- against real generated terrain, tells them apart.
create function pg_temp.walk_share_strips(p_world uuid, p_uid uuid, p_level int,
  p_x0 double precision, p_y0 double precision,
  p_x1 double precision, p_y1 double precision) returns double precision
  language plpgsql stable as $$
declare far double precision; n int; i int; t double precision;
        fx int; fy int; tx int; ty int; climb double precision;
begin
  if p_level <> 0 then return 1; end if;
  far := sqrt(power(p_x1 - p_x0, 2) + power(p_y1 - p_y0, 2));
  if far <= 0.0001 then return 1; end if;
  fx := floor(p_x0)::int; fy := floor(p_y0)::int;
  if bridge_at(p_world, fx, fy) is not null then return 1; end if;
  n := least(walk_samples()::int, greatest(1, ceil(far * 2)::int));
  climb := max_step() + skill_of(p_world, p_uid, 'climbing') * climb_per_level();
  for i in 1..n loop
    t := i::double precision / n;
    tx := floor(p_x0 + (p_x1 - p_x0) * t)::int;
    ty := floor(p_y0 + (p_y1 - p_y0) * t)::int;
    if tx <> fx or ty <> fy then
      if not passable(p_world, tx, ty) then return (i - 1)::double precision / n; end if;
      if abs(tx - fx) <= 1 and abs(ty - fy) <= 1
         and bridge_at(p_world, tx, ty) is null
         and abs(centre_height(p_world, tx, ty) - centre_height(p_world, fx, fy)) > climb then
        return (i - 1)::double precision / n;
      end if;
      fx := tx; fy := ty;
    end if;
  end loop;
  return 1;
end $$;

do $$
declare w uuid := (select id from world where size = 4096 order by made_at desc limit 1);
        me uuid := '11111111-1111-1111-1111-111111111111';
        i int; x0 double precision; y0 double precision; x1 double precision; y1 double precision;
        a double precision; b double precision; bad int := 0; stopped int := 0;
begin
  if w is null then raise notice '635. no 4096 island to read'; return; end if;
  perform setseed(0.25);
  for i in 1..400 loop
    -- The same line to both, which the first draft of this did not do: two
    -- calls to random() in two argument lists is two different walks, and they
    -- disagreed twelve times out of four hundred for that reason alone.
    x0 := 1600 + random() * 900; y0 := 1600 + random() * 900;
    x1 := x0 + (random() - 0.5) * 40; y1 := y0 + (random() - 0.5) * 40;
    a := walk_share(w, me, 0, x0, y0, x1, y1);
    b := pg_temp.walk_share_strips(w, me, 0, x0, y0, x1, y1);
    if a is distinct from b then bad := bad + 1; end if;
    if a < 1 then stopped := stopped + 1; end if;
  end loop;
  raise notice '635. four hundred straight lines across real generated ground, read in squares and read in strips: '
               '% disagreements, and % of the lines were stopped short by the ground itself', bad, stopped;
end $$;

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- which island the front door opens on'
-- Coming ashore used to need somebody to hand you a uuid. The keeper knows
-- which island is the one now, in a row nothing with a browser can write.
select '636. the front door opens on ' || coalesce((select w.name || ', ' || w.size || ' tiles a side'
        from world w join home h on h.island = w.id), 'nowhere');
-- Rockhaven is eight tiles across and was opened long before the big one. A
-- browser is capped at found_max, so an island over it came from the tool, and
-- that is the whole of what makes this claim ungameable.
select '637. the islands that were opened first and did not claim it: '
     || coalesce((select string_agg(name || ' (' || size || ')', ', ' order by size)
                  from world where ready and size <= found_max()), 'none')
     || ' — a browser is capped at ' || found_max()
     || ' tiles, so anything over that came from the tool, and that is the whole of what makes the claim ungameable';
do $$
declare w uuid := (select island from home); was timestamptz;
begin
  if w is null then raise notice '638. no home island to leave alone'; return; end if;
  select made_at into was from world where id = w;
  update world set made_at = now() - interval '60 days' where id = w;
  update player set seen_at = now() - interval '60 days' where world_id = w;
  update keeper set swept_at = to_timestamp(0);
  perform world_tick();
  raise notice '638. sixty days with nobody on the home island: %',
    case when exists (select 1 from world where id = w)
         then 'still there, because the sea does not take the one the front door opens on'
         else 'GONE, AND THE FRONT DOOR NOW OPENS ON NOTHING' end;
  update world set made_at = was where id = w;
end $$;
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select '639. a client can read which island that is: ' || coalesce((select island::text from home), 'none');
do $$ begin
  begin update home set island = null; raise notice '640. and point the front door somewhere else: ALLOWED';
  exception when others then raise notice '640. and point the front door somewhere else: refused — %', sqlerrm; end;
end $$;
reset role;

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- the landing beach'
-- Wildlife never moved before the clock, so a goblin at the spawn was scenery.
-- It comes for you now, and a fresh body can do nothing about it.
select '641. nothing hunts within ' || peace_reach() || ' tiles of where people wash ashore: '
     || 'the spawn itself is ' || at_peace(:'world2', (select spawn_x + 0.5 from world where id = :'world2'),
                                           (select spawn_y + 0.5 from world where id = :'world2'))
     || ', a tile ' || (peace_reach() + 1) || ' away is '
     || at_peace(:'world2', (select spawn_x + 0.5 + peace_reach() + 1 from world where id = :'world2'),
                 (select spawn_y + 0.5 from world where id = :'world2'));
do $$
declare w uuid := (select id from world where name = 'Faraway');
        sx int; sy int; i int; beach int := 0; beyond int := 0;
begin
  select spawn_x, spawn_y into sx, sy from world where id = w;
  perform setseed(0.5);
  for i in 1..400 loop
    if exists (select 1 from wild_table t where t.monster and t.species = pick_wild(w, sx, sy)) then
      beach := beach + 1;
    end if;
    if exists (select 1 from wild_table t where t.monster
               and t.species = pick_wild(w, sx + peace_reach()::int + 40, sy)) then
      beyond := beyond + 1;
    end if;
  end loop;
  raise notice '642. four hundred things put down on the beach and four hundred well past it: % hunters on the beach, % beyond it',
    beach, beyond;
end $$;

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- putting a job down'
/*
 * Stopping, which until now was a thing the browser did to its own copy.
 *
 * The bar went out, the queue emptied on the screen, and over here the saw
 * kept going to the end of everything that had been asked for. `rpc_act` had
 * no opposite.
 *
 * Two things are being asked below and they pull against each other, which is
 * why both are here: everything still in your hands goes, and everything
 * already out of them stays.
 */
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
delete from event where uid = :'ivar';
update player set act = null, act_target = null, act_started = null, act_ends = null,
       act_left = null, act_queue = '[]' where world_id = :'world2' and uid = :'ivar';
insert into item (world_id, holder, holder_uid, def, ql, count, extra)
values (:'world2', 'player', :'ivar', 'log', 30, 40, 'Pine');
select coalesce((rpc_act(:'world2', 'make_planks', '{"kind":"item"}', 4))->>'started', 'no') as s1 \gset
select coalesce((rpc_act(:'world2', 'make_planks', '{"kind":"item"}', 1))->>'inHand', 'not queued') as s2 \gset
select coalesce((rpc_act(:'world2', 'make_planks', '{"kind":"item"}', 1))->>'inHand', 'not queued') as s3 \gset
select '643. four goes of sawing in hand with two more behind it: started ' || :'s1'
     || ', then ' || :'s2' || ' and ' || :'s3' || ' in hand';
select coalesce((rpc_cancel(:'world2'))::text, 'null') as put \gset
select '644. and he puts it down: ' || :'put';
select '645. nothing in hand and nothing in mind: ' || coalesce((select act from player where world_id = :'world2' and uid = :'ivar'), 'nothing')
     || ', ' || (select jsonb_array_length(act_queue) from player where world_id = :'world2' and uid = :'ivar') || ' queued, due '
     || coalesce((select act_ends::text from player where world_id = :'world2' and uid = :'ivar'), 'never');

-- And the other half: a go whose time was already up has happened, whether or
-- not anybody had been round to write it down. Stopping is for what is still
-- in your hands, not a way of taking back the last thirty seconds.
select coalesce((select sum(count) from item where holder_uid = :'ivar' and def = 'plank')::text, '0') as p0 \gset
select rpc_act(:'world2', 'make_planks', '{"kind":"item"}', 3) \g /dev/null
update player set act_started = now() - interval '11 seconds', act_ends = now() - interval '1 second'
  where world_id = :'world2' and uid = :'ivar';
select coalesce((rpc_cancel(:'world2'))::text, 'null') as late \gset
select coalesce((select sum(count) from item where holder_uid = :'ivar' and def = 'plank')::text, '0') as p1 \gset
select '646. one go of three comes due as he stops: ' || :'p0' || ' planks before and ' || :'p1'
     || ' after, which is one log sawn and no more — the go that was due is kept, and he is left doing '
     || coalesce((select act from player where world_id = :'world2' and uid = :'ivar'), 'nothing')
     || ', so the other two went with the stop (' || :'late' || ')';
select coalesce((rpc_cancel(:'world2'))::text, 'null') as again \gset
select '647. and stopping with empty hands is nothing at all: ' || :'again';

-- It has no uid to be given, so there is no version of this that reaches
-- anybody else's hands. Hild saws on while Ivar stops.
update player set act = null, act_target = null, act_started = null, act_ends = null,
       act_left = null, act_queue = '[]' where world_id = :'world2' and uid = :'hild';
insert into item (world_id, holder, holder_uid, def, ql, count, extra)
values (:'world2', 'player', :'hild', 'log', 30, 9, 'Pine');
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select rpc_act(:'world2', 'make_planks', '{"kind":"item"}', 3) \g /dev/null
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select rpc_act(:'world2', 'make_planks', '{"kind":"item"}', 3) \g /dev/null
select rpc_cancel(:'world2') \g /dev/null
select '648. ivar stops and hild does not: ivar is doing '
     || coalesce((select act from player where world_id = :'world2' and uid = :'ivar'), 'nothing')
     || ', hild is doing ' || coalesce((select act from player where world_id = :'world2' and uid = :'hild'), 'nothing');
select '649. and stopping is a door an account may knock on: rpc_cancel(uuid) '
     || case when has_function_privilege('authenticated', 'rpc_cancel(uuid)', 'execute') then 'yes' else 'NO' end
     || ', to a stranger ' || case when has_function_privilege('anon', 'rpc_cancel(uuid)', 'execute') then 'YES' else 'no' end;

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- where somebody has been'
/*
 * The fog of war, which lived in the tab and nowhere else.
 *
 * It is the one thing a browser hands over that the island does not check, and
 * that is worth stating rather than leaving to look like a hole: the browser
 * works the whole island out from its seed, so there is nothing in a map it
 * does not already have, and lifting your own fog was always a line in the
 * console. It is a note about where *you* have been, and only the tab that
 * pointed the camera knows. So the rules here are about whose it is and how
 * much of it there may be, not about whether it is true.
 */
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select coalesce((rpc_fog(:'world2', 'AAECAwQFBgcICQ=='))::text, 'null') as kept \gset
select '650. ivar hands over where he has been: ' || :'kept';
select '651. and the island keeps it: ' || coalesce((select seen from fog where world_id = :'world2' and uid = :'ivar'), 'nothing')
     || ', written ' || coalesce((select case when at > now() - interval '1 minute' then 'just now' else at::text end
                                  from fog where world_id = :'world2' and uid = :'ivar'), 'never');
do $$ begin
  perform rpc_fog((select id from world where name = 'Rockhaven'), 'AAEC');
  raise notice '652. and hands some to an island he is not on: ALLOWED';
exception when others then raise notice '652. and hands some to an island he is not on: refused — %', sqlerrm; end $$;
do $$
declare w uuid := (select world_id from player where uid = '11111111-1111-1111-1111-111111111111' limit 1);
begin
  perform rpc_fog(w, repeat('A', (fog_bytes() + 1)::int));
  raise notice '653. and hands over more than an island keeps: ALLOWED';
exception when others then raise notice '653. and hands over more than an island keeps: refused — %', sqlerrm; end $$;
select coalesce((rpc_fog(:'world2', ''))::text, 'null') as wiped \gset
select '654. handing over nothing puts the map back to black: ' || :'wiped'
     || ', ' || (select count(*) from fog where world_id = :'world2' and uid = :'ivar') || ' rows left';
select rpc_fog(:'world2', 'AAECAwQFBgcICQ==') \g /dev/null

-- Yours and nobody else's. `player` is readable by everybody on an island;
-- where somebody has walked is not a thing to hand to whoever is hunting them.
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select '655. hild looks for ivar''s map: ' || (select count(*) from fog where uid = :'ivar') || ' rows'
     || ', and for her own: ' || (select count(*) from fog where uid = :'hild') || ' rows';
do $$ begin
  update fog set seen = 'AAAA' where uid = '11111111-1111-1111-1111-111111111111';
  raise notice '656. and writes over it directly: ALLOWED';
exception when others then raise notice '656. and writes over it directly: refused — %', sqlerrm; end $$;
reset role;
select '657. and the door itself: rpc_fog(uuid,text) to an account '
     || case when has_function_privilege('authenticated', 'rpc_fog(uuid,text)', 'execute') then 'yes' else 'NO' end
     || ', to a stranger ' || case when has_function_privilege('anon', 'rpc_fog(uuid,text)', 'execute') then 'YES' else 'no' end;

\echo ''
-- A body rests between one subject and the next. This suite runs hundreds of
-- goes with no wall-clock time between them, so nothing ever gets its wind
-- back on its own and everybody would be face down by the third section.
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now() \g /dev/null
\echo '--- what is standing on the ground'
/*
 * Everything the island has set down, which the browser never asked for.
 *
 * "Placed campfire doesn't show." It was there — the row was in `placed` and
 * the log had said so — and nothing under `src/` had ever read that table. So
 * on a live island every campfire, smelter, kiln, anvil, work post, trap and
 * stick of furniture anybody had put down was in Postgres and invisible, and
 * so was every crate, and so was the settlement.
 *
 * The same shape as the wildlife, which had the same bug for the same reason,
 * and it answers the same way: one call, everything within sight, with the
 * fires worked out on reading rather than as they were last written down.
 */
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select coalesce(jsonb_array_length((rpc_ground(:'world2', 60))->'placed')::text, '0') as things \gset
select '658. everything ivar can see on the ground: ' || :'things' || ' things, of which '
     || coalesce((select string_agg(kind || ' ×' || n, ', ' order by kind) from (
          select v->>'kind' as kind, count(*) as n
          from jsonb_array_elements((rpc_ground(:'world2', 60))->'placed') v group by 1) k), 'nothing');
select '659. and a campfire comes with what is true of it now: '
     || coalesce((select jsonb_pretty(v)::text from jsonb_array_elements((rpc_ground(:'world2', 60))->'placed') v
                  where v->>'kind' = 'campfire' limit 1), 'no campfire in sight');
/*
 * A fire burning while nobody is there.
 *
 * `fuel` on the row is what was in it when `since` was stamped, so a row read
 * straight off the table is stale by however long it has been since anybody
 * touched it. A browser cannot correct for that — it does not know the rate —
 * which is the whole reason this is a function and not a subscription.
 */
select set_config('wurm.w', :'world2', false) \g /dev/null
do $$
declare v_id bigint; v_said double precision; v_row double precision;
        w uuid := current_setting('wurm.w')::uuid;
begin
  update placed set fuel = 600, lit = true, since = now() - interval '200 seconds'
    where world_id = w and kind = 'campfire'
    returning id, fuel into v_id, v_row;
  select (v->>'fuel')::double precision into v_said
    from jsonb_array_elements((rpc_ground(w, 60))->'placed') v
    where (v->>'id')::bigint = v_id;
  raise notice '660. a fire left burning for two hundred seconds: the row still says % and the island says %, which is the burning nobody watched',
    round(v_row), round(v_said);
end $$;
select '661. and the crates and the settlement come with it: '
     || jsonb_array_length((rpc_ground(:'world2', 60))->'crates') || ' crates, settlement '
     || coalesce(((rpc_ground(:'world2', 60))->'deed'->>'name'), 'none')
     || ', ours: ' || coalesce(((rpc_ground(:'world2', 60))->'deed'->>'mine'), 'n/a');
select '662. and asking about a patch of ground nobody is near: '
     || jsonb_array_length((rpc_ground(:'world2', 0.5))->'placed') || ' things within half a tile';
do $$ begin
  perform rpc_ground((select id from world where name = 'Rockhaven'), 40);
  raise notice '663. and the ground of an island he is not on: ALLOWED';
exception when others then raise notice '663. and the ground of an island he is not on: refused — %', sqlerrm; end $$;

-- And the settlement refusal, which used to claim somebody else's was yours.
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select '664. hild asks to found a settlement where ivar holds one: '
     || coalesce(deed_refusal(:'world2', :'hild', 'found_settlement', '{"kind":"item"}'), 'allowed');
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select '665. and ivar, who holds it, is told it is his to disband: '
     || coalesce(deed_refusal(:'world2', :'ivar', 'found_settlement', '{"kind":"item"}'), 'allowed');

\echo ''
\echo '--- a body that gets hungry'
/*
 * The four numbers the island owned and never moved.
 *
 * "Thirst and hunger reset to full on every client reset." `stats` is written
 * when you eat, drink, pray, sleep or die and at no other time — so nothing
 * over here ever drained hunger or thirst, spent or gave back wind, or healed
 * anybody, and `action_def.stamina` was a column no function read. The bars
 * fell in the browser because the browser was moving its own copy; a refresh
 * read this row, which had never moved since the day the body was made.
 *
 * It settles off a timestamp now, the way a fire does, because there is
 * nowhere in Supabase to put a loop.
 */
update player set stats = '{"health":0.5,"stamina":0.5,"hunger":1,"thirst":1}'::jsonb,
       act = null, act_target = null, act_started = null, act_ends = null, act_left = null,
       body_at = now() - interval '120 seconds'
  where world_id = :'world2' and uid = :'ivar' \g /dev/null
select body_settle(:'world2', :'ivar') \g /dev/null
select '666. two minutes of standing about: ' || (select 'hunger ' || round(((stats->>'hunger')::numeric), 4)
     || ', thirst ' || round(((stats->>'thirst')::numeric), 4)
     || ', wind ' || round(((stats->>'stamina')::numeric), 3)
     || ', health ' || round(((stats->>'health')::numeric), 3)
     from player where world_id = :'world2' and uid = :'ivar')
     || ' — from a full stomach, half wind and half health';

-- Wind comes back while your hands are empty and not while they are full.
update player set stats = jsonb_set(stats, '{stamina}', '0.5'), act = 'dig',
       act_started = now(), act_ends = now() + interval '60 seconds', act_left = 1,
       body_at = now() - interval '60 seconds'
  where world_id = :'world2' and uid = :'ivar' \g /dev/null
select body_settle(:'world2', :'ivar') \g /dev/null
select '667. a minute with a job in hand: wind ' || (select round(((stats->>'stamina')::numeric), 3)
     from player where world_id = :'world2' and uid = :'ivar') || ', which is the half it started with';

-- A wound knits only on a body that is fed and watered.
update player set stats = '{"health":0.5,"stamina":1,"hunger":0.05,"thirst":0.05}'::jsonb,
       act = null, act_ends = null, act_left = null, body_at = now() - interval '300 seconds'
  where world_id = :'world2' and uid = :'ivar' \g /dev/null
select body_settle(:'world2', :'ivar') \g /dev/null
select '668. five minutes starving and parched: health ' || (select round(((stats->>'health')::numeric), 3)
     from player where world_id = :'world2' and uid = :'ivar')
     || ', and nothing knits on a body with nothing in it';

-- And what a go of work takes out of you, which nothing here had ever charged.
update player set stats = '{"health":1,"stamina":1,"hunger":1,"thirst":1}'::jsonb, body_at = now()
  where world_id = :'world2' and uid = :'ivar' \g /dev/null
select spend_wind(:'world2', :'ivar', 'mine') \g /dev/null
select spend_wind(:'world2', :'ivar', 'mine') \g /dev/null
select '669. two swings at a rock face: wind ' || (select round(((stats->>'stamina')::numeric), 3)
     from player where world_id = :'world2' and uid = :'ivar')
     || ' — mine costs ' || (select stamina from action_def where id = 'mine') || ' a go, less what a hardy body saves';

update player set stats = jsonb_set(stats, '{stamina}', '0.02'), body_at = now()
  where world_id = :'world2' and uid = :'ivar' \g /dev/null
select '670. and asking for another with nothing left: '
     || coalesce(act_refusal(:'world2', :'ivar', 'mine', '{"kind":"tile","x":5,"y":5,"cx":5,"cy":5}'), 'allowed');
select '671. while something that costs no wind is still allowed: '
     || coalesce(act_refusal(:'world2', :'ivar', 'examine',
          (select jsonb_build_object('kind', 'tile', 'x', floor(x)::int, 'y', floor(y)::int)
           from player where world_id = :'world2' and uid = :'ivar')), 'allowed');

/*
 * And a week away, which must not be a week of thirst.
 *
 * A shut tab is not a body standing in a field. At most `body_gap` seconds are
 * ever charged at once, so somebody who comes back after a fortnight finds
 * themselves where they left off rather than dead — which is also how the game
 * has always behaved in a browser, where no time passes for a page that is not
 * open.
 */
update player set stats = '{"health":1,"stamina":1,"hunger":1,"thirst":1}'::jsonb,
       act = null, body_at = now() - interval '7 days'
  where world_id = :'world2' and uid = :'ivar' \g /dev/null
select body_settle(:'world2', :'ivar') \g /dev/null
select '672. a week away: thirst ' || (select round(((stats->>'thirst')::numeric), 4)
     from player where world_id = :'world2' and uid = :'ivar')
     || ', which is ' || body_gap() || ' seconds of it and not ' || (7 * 24 * 3600) || '';

-- The heartbeat is where a body that is only standing there lives.
update player set stats = jsonb_set(stats, '{hunger}', '1'), body_at = now() - interval '100 seconds'
  where world_id = :'world2' and uid = :'ivar' \g /dev/null
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select coalesce(((rpc_settle())->'stats'->>'hunger'), 'nothing') as beat \gset
select '673. and the heartbeat every browser makes anyway settles it: rpc_settle says hunger '
     || round(:'beat'::numeric, 4) || ', which the browser draws as it is told';

\echo ''
\echo '--- and which island the heartbeat is for'
/*
 * "Occasionally it switches randomly to nighttime and hunger/thirst plummet
 * until refreshed."
 *
 * One answer carries the hour and the bars, and `rpc_settle` was the only door
 * of the twenty that did not take a `p_world` — so it worked out which island
 * to answer about by touching `seen_at` on every row with your uid on it and
 * then sorting by the column it had just made identical. `rpc_join` leaves a
 * player row on every island you have ever joined, so there was more than one
 * row and nothing to choose by.
 */
select id as elsewhere from world where id <> :'world2' order by made_at limit 1 \gset
-- Ivar is on world2 already; put him on a second island whose clock is hours
-- from it, which is what two foundings an evening apart look like.
update world set epoch = now() - interval '2700 seconds' where id = :'elsewhere' \g /dev/null
update world set epoch = now() - interval '900 seconds' where id = :'world2' \g /dev/null
insert into player (world_id, uid, name, x, y, stats, look)
  values (:'elsewhere', :'ivar', 'Ivar', 1.5, 1.5,
          '{"health":1,"stamina":1,"hunger":0.2,"thirst":0.15}'::jsonb, '{}'::jsonb)
  on conflict (world_id, uid) do update set stats = excluded.stats \g /dev/null
select '674. one person, the islands he stands on, and a day one hour long: '
     || (select string_agg(w.name || ' at ' || to_char(hour_of_day(w.id), 'FM90.0')
                           || (case when is_night(w.id) then ' (night)' else ' (day)' end)
                           || ', hunger ' || to_char((p.stats->>'hunger')::numeric, 'FM0.00'),
                           ' | ' order by w.name)
         from player p join world w on w.id = p.world_id where p.uid = :'ivar');

-- One beat, and then how many of his rows tie on the newest `seen_at`: the
-- number the old sort had to pick between with nothing left to sort by.
update player set seen_at = now() - interval '61 seconds' where uid = :'ivar' \g /dev/null
update player set seen_at = now() where uid = :'ivar'
  and (seen_at < now() - interval '5 seconds') \g /dev/null
select '675. after one beat of the old, world-less kind, rows tied on the newest seen_at: '
     || (select count(*) from player where uid = :'ivar'
         and seen_at = (select max(seen_at) from player where uid = :'ivar'))
     || ' — and `order by seen_at desc limit 1` has nothing left to sort by';

-- Named, it answers about the island named, whichever one that is.
select '676. asked about ' || (select name from world where id = :'world2') || ': '
     || to_char(((rpc_settle(null, :'world2'))->>'time')::numeric % day_seconds()::numeric / day_seconds()::numeric * 24, 'FM90.0')
     || ' o''clock, hunger ' || to_char(((rpc_settle(null, :'world2'))->'stats'->>'hunger')::numeric, 'FM0.00');
select '677. asked about ' || (select name from world where id = :'elsewhere') || ': '
     || to_char(((rpc_settle(null, :'elsewhere'))->>'time')::numeric % day_seconds()::numeric / day_seconds()::numeric * 24, 'FM90.0')
     || ' o''clock, hunger ' || to_char(((rpc_settle(null, :'elsewhere'))->'stats'->>'hunger')::numeric, 'FM0.00')
     || ' — the same beat, the other island, and nothing random about which';

-- And standing on one island no longer tells the others you are there.
update player set seen_at = now() - interval '61 seconds', away = true where uid = :'ivar' \g /dev/null
select rpc_settle(null, :'world2') \g /dev/null
select '678. and a beat sent from ' || (select name from world where id = :'world2')
     || ' leaves the rest of them: '
     || (select string_agg(w.name || ' ' || (case when p.away then 'away' else 'here' end),
                           ', ' order by w.name)
         from player p join world w on w.id = p.world_id where p.uid = :'ivar')
     || ' — which is what lets log_out_idle sweep a body off an island you walked away from';
delete from player where world_id = :'elsewhere' and uid = :'ivar' \g /dev/null
update player set away = false, seen_at = now() where uid = :'ivar' \g /dev/null

\echo ''
\echo '--- what the ask says it did'
/*
 * "On the action queue it never changes from 2/3 to 3/3 despite all 3 slots
 * filled."
 *
 * It never did. The bar draws `act_queue` plus the job in hand, which is
 * right — but it only ever *heard* about `act_queue` from `rpc_settle`, which
 * runs on the heartbeat and when a job comes due, and never when one is added.
 * So the picture was the state as of the last settle: ask for a third while
 * two are running and it says "2 of 3"; the job in hand finishes, a settle
 * happens, one comes off the queue, and it says "2 of 3" again.
 *
 * The answer to an ask is where a browser should hear what the ask did.
 */
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
update player set act = null, act_target = null, act_started = null, act_ends = null,
       act_left = null, act_queue = '[]', stats = jsonb_set(stats, '{stamina}', '1'), body_at = now()
  where world_id = :'world2' and uid = :'ivar' \g /dev/null
delete from item where holder_uid = :'ivar' and def = 'log' \g /dev/null
insert into item (world_id, holder, holder_uid, def, ql, count, extra)
values (:'world2', 'player', :'ivar', 'log', 30, 30, 'Pine') \g /dev/null
select coalesce((rpc_act(:'world2', 'make_planks', '{"kind":"item"}', 1))->>'started', 'no') as a1 \gset
select coalesce((rpc_act(:'world2', 'make_planks', '{"kind":"item"}', 1))::text, 'null') as a2 \gset
select coalesce((rpc_act(:'world2', 'make_planks', '{"kind":"item"}', 1))::text, 'null') as a3 \gset
select '679. one in hand and two asked for behind it — the second ask says: ' || :'a2';
select '680. and the third: ' || :'a3';
select '681. which is the same three the bar would draw: in hand '
     || coalesce((select act from player where world_id = :'world2' and uid = :'ivar'), 'nothing')
     || ', queued ' || (select jsonb_array_length(act_queue) from player where world_id = :'world2' and uid = :'ivar')
     || ' — so ' || (select jsonb_array_length(act_queue) + 1 from player where world_id = :'world2' and uid = :'ivar')
     || ' of ' || queue_capacity(:'world2', :'ivar') || ', which is what the log line says too';

/*
 * And how many goes each of them is for, which nothing wrote down.
 *
 * "Action queue bar is screwed up, especially when interacting with actions
 * that have multiples, e.g. flatten x10." The bar draws "3 of 10" from `left`,
 * which is the island's, and `goes`, which the browser kept for itself — and
 * it only ever heard one for a job that *started*. Ask for ten while something
 * is in hand and the ask is queued, so the count it was still holding belonged
 * to the job before: goes 1, left 10, and the bar drew 1 - 10 + 1.
 */
update player set act = null, act_target = null, act_started = null, act_ends = null,
       act_left = null, act_goes = null, act_queue = '[]', stats = jsonb_set(stats, '{stamina}', '1')
  where world_id = :'world2' and uid = :'ivar' \g /dev/null
select rpc_act(:'world2', 'make_planks', '{"kind":"item"}', 1) \g /dev/null
select coalesce((rpc_act(:'world2', 'make_planks', '{"kind":"item"}', 10))->'queue', 'null'::jsonb) as lined \gset
select '682. one in hand, ten asked for behind it, and the queue says what for: ' || :'lined';
select '683. while the first is in hand: ' ||
       (select 'goes ' || coalesce((r->>'goes'), 'nothing') || ', left ' || coalesce((r->>'left'), 'nothing')
        from (select rpc_settle(null, :'world2') as r) q)
     || ' — so the bar reads 1 of 1, which is the job it is actually looking at';
update player set act_ends = now() - interval '1 second' where world_id = :'world2' and uid = :'ivar' \g /dev/null
select '684. and once the ten come to hand: ' ||
       (select 'goes ' || (r->>'goes') || ', left ' || (r->>'left')
               || ', so the bar reads ' || ((r->>'goes')::int - (r->>'left')::int + 1) || ' of ' || (r->>'goes')
        from (select rpc_settle(null, :'world2') as r) q)
     || ' — where the browser''s own tally would have said 1 - 10 + 1';
update player set act_ends = now() - interval '1 second' where world_id = :'world2' and uid = :'ivar' \g /dev/null
select rpc_settle(null, :'world2') \g /dev/null
update player set act_ends = now() - interval '1 second' where world_id = :'world2' and uid = :'ivar' \g /dev/null
select '685. two goes off the run: ' ||
       (select ((r->>'goes')::int - (r->>'left')::int + 1) || ' of ' || (r->>'goes')
               || ', and what was asked for has not moved: ' || (r->>'goes')
        from (select rpc_settle(null, :'world2') as r) q);
select rpc_cancel(:'world2') \g /dev/null
select '686. and stopping clears it, so there is ' ||
       (select coalesce(act_goes::text, 'nothing')
        from player where world_id = :'world2' and uid = :'ivar')
     || ' left over to be drawn against whatever comes next';

\echo ''
\echo '--- a wild thing that stands still long enough to be crept up on'
/*
 * "Reduce significantly wild wildermon movement. Especially with them jumping
 * around due to the server movement, its almost impossible to tame them as
 * theyre always too far away."
 *
 * It picked a spot up to four tiles off, walked it, stood for one to six
 * seconds, and went again — fifty-odd tiles of wandering a minute, without
 * pause. A faithful port of the browser's own numbers, and those were written
 * for a game where clicking a creature reached it at once. On an island you
 * ask and then your feet carry you there.
 */
-- On the beach everybody washes up on, which is ground a thing can walk.
select spawn_x + 0.5 as gx, spawn_y + 0.5 as gy from world where id = :'world2' \gset
select creature_spawn(:'world2', 'rabba', :'gx', :'gy', 'wild', now()) as grazer \gset
update creature set until = now(), settled_at = now(), leg = 0,
       from_x = :'gx', from_y = :'gy', to_x = :'gx', to_y = :'gy'
  where world_id = :'world2' and id = :'grazer' \g /dev/null
-- A minute of nobody watching, worked forward the moment somebody does.
update creature set until = now() - interval '60 seconds', settled_at = now() - interval '60 seconds'
  where world_id = :'world2' and id = :'grazer' \g /dev/null
select creature_settle(:'world2', :'grazer') \g /dev/null
select '687. a minute of grazing: ' || (select leg from creature where world_id = :'world2' and id = :'grazer')
     || ' legs walked, and it is ' || (select round(sqrt((to_x - :'gx') ^ 2 + (to_y - :'gy') ^ 2)::numeric, 1)
                                       from creature where world_id = :'world2' and id = :'grazer')
     || ' tiles from where it started — it used to walk a leg every three seconds and think nothing of five';
select '688. the numbers behind that: it drifts ' || wild_reach() || ' tiles at a time and stands '
     || wild_rest() || ' to ' || (wild_rest() + wild_rest_spread()) || ' seconds between';

/*
 * And a leg a browser can draw without agreeing what time it is.
 *
 * The other half of the jumping, and it would still have been there with a
 * beast standing perfectly still: `rpc_creatures` handed over the two instants
 * and the browser parsed them against its own clock, so a phone a few seconds
 * out pinned every leg at one end and re-pinned it with the next answer. The
 * action bar learnt this already and takes seconds; the wildlife never did.
 */
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
update player set x = :'gx', y = :'gy' where world_id = :'world2' and uid = :'ivar' \g /dev/null
select coalesce((select jsonb_pretty(v) from jsonb_array_elements(rpc_creatures(:'world2', 20)) v
                 where (v->>'id')::int = :'grazer'), 'not in sight') as legsays \gset
select '689. what the island says about the leg it is on: '
     || coalesce((select 'for ' || round((v->>'legFor')::numeric, 2) || 's with '
                       || round((v->>'legLeft')::numeric, 2) || 's of it left'
                  from jsonb_array_elements(rpc_creatures(:'world2', 20)) v
                  where (v->>'id')::int = :'grazer'), 'not in sight')
     || ' — seconds, so nothing has to agree about when';
select '690. and not a word about when: '
     || case when (select count(*) from jsonb_array_elements(rpc_creatures(:'world2', 20)) v
                   where v ? 'legAt' or v ? 'legEnds') = 0
             then 'no instants travel at all' else 'IT STILL SENDS INSTANTS' end;

\echo '--- the address a name wears'
-- The suffix was `@players.wurm.invalid`, chosen because RFC 2606 guarantees
-- `.invalid` reaches nobody. Auth agrees so thoroughly that it refuses the
-- address outright, from a list of barred host suffixes in its own source that
-- no project setting can reach — so every account made under it failed, and
-- one migration earlier the landing page became the only way ashore.
\set oldtimer '7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7a7a'
\set newcomer '7b7b7b7b-7b7b-7b7b-7b7b-7b7b7b7b7b7b'
reset role;
insert into auth.users (id, email) values
  (:'oldtimer', 'oldtimer@players.wurm.invalid'),
  (:'newcomer', 'newcomer@catgenova.github.io');

select '691. a name goes out as ' || name_email('Newcomer')
     || ' — at a host that resolves and keeps no mailbox, rather than one the internet forbids';

-- Both suffixes are read; only the first is ever handed out.
select '692. and comes back from ' || (select count(*) from unnest(name_domains())) || ' suffixes: '
     || coalesce(email_name('NEWCOMER@catgenova.github.io'), 'nothing')
     || ', ' || coalesce(email_name('oldtimer@players.wurm.invalid'), 'nothing')
     || ' — and from a stranger''s: ' || coalesce(email_name('someone@example.com'), 'nothing');

-- The bug this half exists to prevent: read only the current suffix and a name
-- somebody already holds reads as free, and the next person to ask gets it.
select '693. is oldtimer free? ' || rpc_name_free('oldtimer')::text
     || ' — is newcomer? ' || rpc_name_free('newcomer')::text
     || ' — is nobodyatall? ' || rpc_name_free('nobodyatall')::text;

select set_config('request.jwt.claims', json_build_object('sub', :'oldtimer')::text, false) \g /dev/null
select '694. somebody who came ashore before the suffix moved is still '
     || coalesce(rpc_my_name(), 'NAMELESS');
select set_config('request.jwt.claims', json_build_object('sub', :'newcomer')::text, false) \g /dev/null
select '695. and somebody who comes ashore today is '
     || coalesce(rpc_my_name(), 'NAMELESS');

\echo '--- how long a body lasts'
-- Forty-two minutes and twenty-eight, which is what these were, is a faithful
-- port of numbers written for a browser tab open for ten minutes at a time. An
-- island session is an afternoon, and a body that goes from full to empty
-- inside one makes eating and drinking the thing you are doing rather than
-- something you see to. Said in hours here, because that is the unit the
-- decision was actually made in and a rate per second hides it.
select '696. a full stomach lasts ' || round((1 / hunger_rate() / 3600)::numeric, 1)
     || ' hours and a full throat ' || round((1 / thirst_rate() / 3600)::numeric, 1)
     || ' — thirst still running ahead of hunger by the half it always did';

\echo '--- the hour, told rather than counted'
-- "Day and night only seem to change on client refresh." The island's clock
-- was never the thing that was wrong: `hour_of_day()` reads the island's own
-- age against `day_seconds()` and has been right since the world's pace moved.
--
-- The browser read it once, at the join, and then added up frames — and a
-- frame is capped at a tenth of a second, so that a tab coming back from a
-- stall cannot walk anybody across an island in one step. Every scrap of real
-- time past that cap is gone, and a tab nobody is looking at gets no frames to
-- cap at all. So the browser's clock fell behind and stayed behind, and a
-- reload was the only thing that ever put it right.
--
-- The heartbeat carries the island's own reading now. What is checked here is
-- that it carries it at all, and that the island's two answers about the same
-- clock — the hour, and whether it is dark — cannot drift apart from one
-- another without this saying so.
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null

update world set epoch = now() - make_interval(secs => 2 * day_seconds() / 24)
  where id = :'world2' \g /dev/null
select (rpc_settle()) as beat2 \gset
select '697. at ' || to_char(hour_of_day(:'world2')::numeric, 'FM90.0') || ' the heartbeat says night: '
     || coalesce((:'beat2'::jsonb)->>'night', 'nothing')
     || ' — and hands over ' || coalesce(round(((:'beat2'::jsonb)->>'time')::numeric)::text, 'nothing')
     || ' seconds of island, which is a clock and not a picture to draw';

update world set epoch = now() - make_interval(secs => 12 * day_seconds() / 24)
  where id = :'world2' \g /dev/null
select (rpc_settle()) as beat12 \gset
select '698. and at ' || to_char(hour_of_day(:'world2')::numeric, 'FM90.0') || ' it says night: '
     || coalesce((:'beat12'::jsonb)->>'night', 'nothing')
     || ' — the same two answers the island gives itself: '
     || case when ((:'beat12'::jsonb)->>'night')::boolean = is_night(:'world2')
                 and abs(((:'beat12'::jsonb)->>'time')::double precision - world_time(:'world2')) < 2
            then 'they agree' else 'THEY HAVE COME APART' end;

select '699. a day on this island runs ' || round((day_seconds() / 60)::numeric) || ' minutes, dawn at '
     || round(dawn_hour()::numeric) || ' — so a session sees the sun move, if anything is telling it to';

\echo '--- a settlement each'
-- `deed` was keyed on the island and nothing else, so `select * from deed
-- where world_id = p_world` was a complete sentence and thirty functions wrote
-- it. Three complaints came out of that one key: a stranger's homestead
-- burning a hole in your fog, because the browser lights *your* settlement
-- whatever the hour and was handed theirs; a journal ticking "plant a stake
-- and found a settlement" off somebody else's stake; and no way to plant your
-- own, because the island already held its one.
--
-- Done on the big island because two settlements will not fit on a sixteen
-- tile one: a border reaches five tiles from its token at level one, and they
-- may not overlap.
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select rpc_join(:'big', 'Ivar') \g /dev/null
update player set x = 2040.5, y = 2040.5 where world_id = :'big' and uid = :'ivar' \g /dev/null
insert into item (world_id, holder, holder_uid, def, ql, count)
values (:'big', 'player', :'ivar', 'deed_stake', 50, 1) \g /dev/null
select '700. ivar plants his stake on the big island: '
     || coalesce(deed_refusal(:'big', :'ivar', 'found_settlement', '{"kind":"item"}'), 'allowed');
select act_perform(:'big', :'ivar', 'found_settlement', '{"kind":"item","name":"Ivarholm"}') \g /dev/null

select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select rpc_join(:'big', 'Hild') \g /dev/null
insert into item (world_id, holder, holder_uid, def, ql, count)
values (:'big', 'player', :'hild', 'deed_stake', 50, 1) \g /dev/null
-- Standing inside ivar's border.
update player set x = 2042.5, y = 2041.5 where world_id = :'big' and uid = :'hild' \g /dev/null
select '701. hild tries to found inside ivar''s border: '
     || coalesce(deed_refusal(:'big', :'hild', 'found_settlement', '{"kind":"item"}'), 'ALLOWED');
-- And well clear of it.
update player set x = 2070.5, y = 2070.5 where world_id = :'big' and uid = :'hild' \g /dev/null
select '702. and well clear of it: '
     || coalesce(deed_refusal(:'big', :'hild', 'found_settlement', '{"kind":"item"}'), 'allowed');
select act_perform(:'big', :'hild', 'found_settlement', '{"kind":"item","name":"Hildstead"}') \g /dev/null
select '703. so the island holds ' || (select count(*) from deed where world_id = :'big')
     || ' settlements: ' || (select string_agg(name, ' and ' order by founded_at) from deed where world_id = :'big');

-- What each of them is handed. `deed` is yours or nothing; `deeds` is whose
-- ground you are near enough to be standing on, and lights nothing.
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select '704. ivar, at his own token, is told about '
     || coalesce((rpc_ground(:'big', 40))->'deed'->>'name', 'no settlement of his own')
     || ' as his, and ' || jsonb_array_length((rpc_ground(:'big', 40))->'deeds')
     || ' of anybody else''s within forty tiles';
update player set x = 2400.5, y = 2400.5 where world_id = :'big' and uid = :'ivar' \g /dev/null
select '705. and from four hundred tiles away, still '
     || coalesce((rpc_ground(:'big', 40))->'deed'->>'name', 'nothing')
     || ' as his and ' || jsonb_array_length((rpc_ground(:'big', 40))->'deeds')
     || ' of hild''s — which is what used to cut a hole in somebody''s fog';

-- And the things hung off a settlement are hung off the right one.
select '706. ivar works ' || worker_cap(:'big', :'ivar') || ' wildermon and hild '
     || worker_cap(:'big', :'hild') || ', each off their own level — and ivar has '
     || workers_on_deed(:'big', :'ivar') || ' on the books, not hild''s';

-- And the door that was standing open: `plan_reason` refused with the words
-- "You may only build on your own deed" while asking whether the tile was on
-- *a* deed. With one settlement to the island those were the same question.
select '707. hild plans a building inside ivar''s border: '
     || coalesce(plan_reason(:'big', :'hild',
          (select d.x + 1 from deed d where d.world_id = :'big' and d.founded_by = :'ivar'),
          (select d.y from deed d where d.world_id = :'big' and d.founded_by = :'ivar')), 'ALLOWED')
     || ' — and ivar, on the same tile: '
     || coalesce(plan_reason(:'big', :'ivar',
          (select d.x + 1 from deed d where d.world_id = :'big' and d.founded_by = :'ivar'),
          (select d.y from deed d where d.world_id = :'big' and d.founded_by = :'ivar')), 'allowed');

-- Whose crate, and whose building. `crate` had no column saying whose it was
-- at all, and `building` has had `planned_by` since the day it was made with
-- nothing ever reading it.
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
insert into crate (world_id, id, kind, x, y, sx, sy, made_by)
values (:'big', 9001, 'plank', 2041, 2041, 1, 1, :'ivar') \g /dev/null
select '708. ivar''s crate, to hild: '
     || coalesce(crate_refusal(:'big', :'hild', 'crate_take_all',
          '{"kind":"crate","id":9001}'::jsonb), 'ALLOWED')
     || ' — and to ivar: '
     || coalesce(crate_refusal(:'big', :'ivar', 'crate_take_all',
          '{"kind":"crate","id":9001}'::jsonb), 'allowed, once he is standing next to it');

-- A crate from before there was anywhere to write an owner is common ground,
-- because a migration that guessed would lock somebody out of their stores.
insert into crate (world_id, id, kind, x, y, sx, sy) values (:'big', 9002, 'plank', 2300, 2300, 1, 1) \g /dev/null
select '709. and one nobody has ever owned: ivar '
     || crate_yours(:'big', :'ivar', 9002)::text || ', hild ' || crate_yours(:'big', :'hild', 9002)::text
     || ' — while ivar''s is his alone: ivar ' || crate_yours(:'big', :'ivar', 9001)::text
     || ', hild ' || crate_yours(:'big', :'hild', 9001)::text;

insert into building (world_id, id, name, planned_by) values (:'big', 9001, 'Ivarhouse', :'ivar') \g /dev/null
insert into building_tile (world_id, building, x, y) values (:'big', 9001, 2300, 2305) \g /dev/null
select '710. ivar''s building, to hild: '
     || coalesce(build_refusal(:'big', :'hild', 'rename_building',
          '{"kind":"tile","x":2300,"y":2305,"name":"Hildhouse"}'::jsonb), 'ALLOWED')
     || ' — and to ivar: '
     || coalesce(build_refusal(:'big', :'ivar', 'rename_building',
          '{"kind":"tile","x":2300,"y":2305,"name":"Ivarhall"}'::jsonb), 'allowed');

-- A token hemmed in on all five of the spots the crate used to look at. Built
-- rather than hoped for: a crate on each, so every one is refused.
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
insert into crate (world_id, id, kind, x, y, sx, sy) values
  (:'big', 9101, 'plank', 2071, 2070, 1, 1), (:'big', 9102, 'plank', 2070, 2071, 1, 1),
  (:'big', 9103, 'plank', 2069, 2070, 1, 1), (:'big', 9104, 'plank', 2070, 2069, 1, 1),
  (:'big', 9105, 'plank', 2071, 2071, 1, 1) \g /dev/null
delete from crate where world_id = :'big' and deed and id = 2 \g /dev/null
select coalesce(place_deed_crate(:'big', :'hild')::text, 'nowhere') as penned \gset
select '711. a token with all five of its old spots taken still gets a crate: ' || :'penned'
     || ' — at ' || coalesce((select x || ',' || y from crate where world_id = :'big' and id = :'penned'::int), 'nowhere')
     || ', where the token is 2070,2070';

-- What is in a crate, which the browser was never told: `rpc_ground` sent the
-- crate and not its contents, so every crate on an island was drawn empty and
-- the browser's own "the crate is full" counted an empty list.
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
update player set x = 2041.5, y = 2040.5 where world_id = :'big' and uid = :'ivar' \g /dev/null
insert into item (world_id, holder, holder_uid, def, ql, count, extra)
values (:'big', 'player', :'ivar', 'log', 40, 2, 'Oak') returning id as logs \gset
select '679b. ivar puts two logs in his deed crate: '
     || coalesce(act_refusal(:'big', :'ivar', 'store_in_crate',
          ('{"kind":"item","uid":' || :'logs' || ',"count":2}')::jsonb), 'allowed');
select act_perform(:'big', :'ivar', 'store_in_crate',
  ('{"kind":"item","uid":' || :'logs' || ',"count":2}')::jsonb) \g /dev/null
select (rpc_ground(:'big', 40)) as ground \gset
select '712. the crate at ivar''s elbow holds '
     || coalesce((select (v->>'units') || ' units and lists ' || jsonb_array_length(v->'things') || ' sorts'
                  from jsonb_array_elements((:'ground'::jsonb)->'crates') v
                  where (v->>'id')::int = 1), 'nothing at all')
     || ' — and one twenty tiles off would list none of them';

-- And whose settlement a disbanding takes.
--
-- Reported from the island: a settlement gone, its crate standing where it
-- always had, and its holder had disbanded nothing. The disbanding ended
--
--     delete from deed where world_id = p_world;
--
-- which was a complete sentence for as long as an island held one settlement,
-- and which a day later took every settlement on the island. Nothing in this
-- file would have caught it: the disbanding subject above counts the island's
-- settlements after the fact, on an island that has only ever held one, so it
-- reads the same whether the delete was scoped or not.
\set quitter '66666666-6666-6666-6666-666666666666'
select set_config('request.jwt.claims', json_build_object('sub', :'quitter')::text, false) \g /dev/null
select rpc_join(:'big', 'Sella') \g /dev/null
update player set x = 2500.5, y = 2500.5 where world_id = :'big' and uid = :'quitter' \g /dev/null
insert into item (world_id, holder, holder_uid, def, ql, count)
values (:'big', 'player', :'quitter', 'deed_stake', 50, 1) \g /dev/null
select act_perform(:'big', :'quitter', 'found_settlement', '{"kind":"item","name":"Sellaby"}') \g /dev/null
select '712b. three settlements now: '
     || (select string_agg(name, ', ' order by founded_at) from deed where world_id = :'big')
     || ', and ' || (select count(*) from crate where world_id = :'big' and deed) || ' deed crates';
select act_perform(:'big', :'quitter', 'disband_deed', '{"kind":"tile","x":2500,"y":2500}') \g /dev/null
select '712c. sella gives hers up, four hundred tiles from anybody: '
     || coalesce((select string_agg(name, ' and ' order by founded_at) from deed where world_id = :'big'),
                 'NONE OF THEM ARE LEFT, WHICH WAS THE BUG')
     || ' still stand, with ' || (select count(*) from crate where world_id = :'big' and deed)
     || ' deed crates — ivar''s is still his to reach into: '
     || coalesce((deed_crate(:'big', :'ivar')).id::text, 'OUT OF REACH')
     || ', and sella''s went with her settlement: '
     || coalesce((deed_crate(:'big', :'quitter')).id::text, 'gone, as it should be');

-- And which token a wildermon is put to work at, which read the same
-- island-wide sentence for the home it sends a stored beast to. Hild's, and
-- she founded second, so the row a bare `select * from deed` hands back first
-- is ivar's — thirty tiles from where she is standing.
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select creature_spawn(:'big', 'rabba', 2070.5, 2071.5, 'stored', now() - interval '3 hours', :'hild') as hers \gset
select act_perform(:'big', :'hild', 'assign_deed', ('{"kind":"creature","id":' || :'hers' || '}')::jsonb) \g /dev/null
select '712d. hild sets a rabba to work and it stands at '
     || (select round(from_x::numeric, 1) || ', ' || round(from_y::numeric, 1)
         from creature where world_id = :'big' and id = :'hers')
     || ' — her token is at '
     || (select x || ', ' || y from deed where world_id = :'big' and founded_by = :'hild')
     || ' and ivar''s at '
     || (select x || ', ' || y from deed where world_id = :'big' and founded_by = :'ivar');

\echo '--- a global chat'
-- The event window has had a Talk tab and a box to type in since long before
-- there was an island, and on an island neither did anything: a line went into
-- the browser's own log and no further. Two people on the same tile could not
-- tell each other so.
--
-- Almost all of it was already built for something else. `event` has a `uid`
-- meaning *who it is for*, and a policy reading `uid = auth.uid() or uid is
-- null` — so a row with no uid is already, exactly, a thing everybody on the
-- island may read. It is already in the Realtime publication and the browser
-- already draws whatever arrives on it.
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select '713. ivar says something with a newline in it: '
     || coalesce((rpc_say(:'big', 'Hello  the island' || chr(10) || ' anyone about?'))->>'said', 'nothing')
     || ' — tidied rather than refused, because a phone keyboard puts them in by accident';

select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select (rpc_say(:'big', 'Over here')) \g /dev/null
select '714. and hild, arriving, reads back ' || jsonb_array_length(rpc_chat(:'big', 10)) || ' lines: '
     || (select string_agg(v->>'text', ' | ' order by (v->>'n')::bigint)
         from jsonb_array_elements(rpc_chat(:'big', 10)) v);

-- A name nobody can wear but their own: `rpc_say` reads it off the account
-- rather than taking it from the caller, for the same reason `rpc_my_name`
-- takes no argument.
select '715. the name on a line is the island''s to write: '
     || case when (select count(*) from jsonb_array_elements(rpc_chat(:'big', 10)) v
                    where v->>'text' like '<Hild>%') = 1
             then 'hild''s line is signed Hild, and there is nowhere to say otherwise'
             else 'A CLIENT PUT A NAME IN' end;

-- Twenty a minute, which is about the window rather than about load.
do $$
declare w uuid := (select id from world where name = 'Bigness'); n int := 0; i int; said jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '22222222-2222-2222-2222-222222222222')::text, false);
  for i in 1..say_a_minute()::int + 4 loop
    said := rpc_say(w, 'line ' || i);
    if said->>'said' is not null then n := n + 1; end if;
  end loop;
  raise notice '716. hild tries % lines in a row and gets % of them in — the rest are asked to give the others a moment',
    say_a_minute()::int + 4, n;
end $$;

-- Taking one thing out, which the island could not do. There has been a way to
-- put a thing in and a way to take everything out, and nothing in between — so
-- the browser did the in-between itself and the next answer put it back.
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select id as stowed from item where world_id = :'big' and holder = 'crate' and def = 'log' limit 1 \gset
select '717. ivar takes one of the two logs back out: '
     || coalesce(act_refusal(:'big', :'ivar', 'take_from_store',
          ('{"kind":"item","uid":' || :'stowed' || ',"count":1}')::jsonb), 'allowed');
select act_perform(:'big', :'ivar', 'take_from_store',
  ('{"kind":"item","uid":' || :'stowed' || ',"count":1}')::jsonb) \g /dev/null
select '718. and the crate is down to ' || crate_units(:'big', 1)
     || ' with ' || (select coalesce(sum(count), 0) from item
                     where world_id = :'big' and holder = 'player' and holder_uid = :'ivar' and def = 'log')
     || ' in his hands — split off the stack rather than all or nothing';

-- And it is a door, not a hole: hild cannot reach into ivar's crate.
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
update player set x = 2041.5, y = 2040.5 where world_id = :'big' and uid = :'hild' \g /dev/null
select id as theirs from item where world_id = :'big' and holder = 'crate' limit 1 \gset
select '719. hild reaches into ivar''s crate: '
     || coalesce(act_refusal(:'big', :'hild', 'take_from_store',
          ('{"kind":"item","uid":' || :'theirs' || ',"count":1}')::jsonb), 'ALLOWED');

\echo ''
-- What the island never said out loud.
--
-- Buildings have been kept here since they were ported and never sent, so a
-- plan stood in Postgres that no browser could draw; and a worker whose keeper
-- holds no settlement was turned loose without a word, which from a phone
-- looks exactly like a wildermon that has stopped bothering.
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
update player set x = 2040.5, y = 2040.5 where world_id = :'big' and uid = :'ivar' \g /dev/null
do $$
declare w uuid := (select id from world where name = 'Bigness');
begin
  insert into building (world_id, id, name, levels, planned_by)
  values (w, 1, 'The Longhouse', 2, '11111111-1111-1111-1111-111111111111');
  insert into building_tile (world_id, building, x, y) values (w, 1, 2040, 2040), (w, 1, 2041, 2040);
  insert into wall (world_id, level, dir, x, y, building, type, material, needed, total, planned_by)
  values (w, 0, 'h', 2040, 2040, 1, 'wall', 'wood', '{"plank":2}'::jsonb, '{"plank":4}'::jsonb,
          '11111111-1111-1111-1111-111111111111');
  insert into floor_tile (world_id, level, x, y, building, material, kind, needed, total, planned_by)
  values (w, 1, 2040, 2040, 1, 'wood', 'floor', '{"plank":1}'::jsonb, '{"plank":3}'::jsonb,
          '11111111-1111-1111-1111-111111111111');
end $$;
select '720. the ground ivar is standing on carries '
     || jsonb_array_length(rpc_ground(:'big', 40) -> 'buildings' -> 'list') || ' building, '
     || jsonb_array_length(rpc_ground(:'big', 40) -> 'buildings' -> 'walls') || ' wall and '
     || jsonb_array_length(rpc_ground(:'big', 40) -> 'buildings' -> 'floors') || ' floor — which it has never once mentioned before';
select '721. and the building comes whole: ' || (rpc_ground(:'big', 40) -> 'buildings' -> 'list' -> 0 ->> 'name')
     || ', ' || jsonb_array_length(rpc_ground(:'big', 40) -> 'buildings' -> 'list' -> 0 -> 'tiles') || ' tiles over '
     || (rpc_ground(:'big', 40) -> 'buildings' -> 'list' -> 0 ->> 'levels') || ' storeys';
-- Far enough off and it is somebody else's business, not yours to draw. Six
-- hundred tiles out, and clear of the Ivarhouse the earlier subjects put up —
-- the first go at this stood him five tiles from it and counted that as proof.
update player set x = 2600.5, y = 2600.5 where world_id = :'big' and uid = :'ivar' \g /dev/null
select '722. from five hundred tiles away it is out of sight: '
     || jsonb_array_length(rpc_ground(:'big', 40) -> 'buildings' -> 'list') || ' buildings';
update player set x = 2040.5, y = 2040.5 where world_id = :'big' and uid = :'ivar' \g /dev/null

-- And the worker nobody told. Somebody with no settlement at all, which is the
-- state a keeper is left in by disbanding, and the state an old wildermon is
-- in when its keeper is not who it thinks.
\set nolands '44444444-4444-4444-4444-444444444444'
select creature_spawn(:'big', 'rabba', 2040.5, 2041.5, 'deed', now() - interval '3 hours', :'nolands') as orphan \gset
select '723. a forager on the books of somebody with no settlement: work_site says '
     || coalesce((select x || ',' || y from work_site(:'big',
          (select c from creature c where c.world_id = :'big' and c.id = :'orphan'))), 'nothing');
select worker_settle(:'big', :'orphan') \g /dev/null
select '724. so it is let go — mode ' || mode || ' — and its keeper is told: '
     || coalesce((select text from event where world_id = :'big' and uid = :'nolands'
                  order by at desc limit 1), 'NOTHING, which was the bug')
from creature where world_id = :'big' and id = :'orphan';

\echo ''
\echo '--- and somebody to ask them'
/*
 * Every worker measurement above calls `worker_settle` by hand, and all of
 * them passed while nothing in the database called it at all. So: the door the
 * island actually opens, and a count of who can reach the rules behind it.
 */
select '725. functions on this island that ask a worker to do its day: '
     || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prokind = 'f'
           and p.prosrc like '%worker_settle(%' and p.proname <> 'worker_settle')
     || ' — ' || coalesce((select string_agg(p.proname, ', ' order by p.proname)
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prokind = 'f'
           and p.prosrc like '%worker_settle(%' and p.proname <> 'worker_settle'),
         'NOBODY, which was the bug');
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select creature_spawn(:'big', 'rabba', 2040.5, 2041.5, 'stored', now() - interval '3 hours', :'ivar') as hand \gset
select act_perform(:'big', :'ivar', 'assign_deed', ('{"kind":"creature","id":' || :'hand' || '}')::jsonb) \g /dev/null
-- Starving and a quarter of an hour owed, which is how the reported one stood.
update creature set hunger = 0, until = now() - interval '900 seconds',
    leg_at = now() - interval '900 seconds', leg_ends = now() - interval '900 seconds',
    settled_at = now() - interval '900 seconds'
  where world_id = :'big' and id = :'hand' \g /dev/null
select '726. a forager on the books, idle at the token, and nobody calling anything by hand — '
     || creature_sweep(:'big', 2040.5, 2040.5) || ' things stirred by somebody merely looking';
select '727. and it has been working: foraging ' || round((skills->>'foraging')::numeric, 2)
     || ' from 1, phase ' || phase || ', with '
     || (select count(*) from foraged f where f.world_id = :'big' and f.kind = 'forage')
     || ' beds behind it'
from creature where world_id = :'big' and id = :'hand';
select '728. and the window is told what it is doing, rather than guessing: '
     || coalesce((select 'foraging ' || round((r->'skills'->>'foraging')::numeric, 2)
                  || ', experience ' || round((r->>'xp')::numeric, 1)
                  || ', care ' || round((r->>'care')::numeric, 2)
                  || ', ' || (r->>'phase')
       from (select jsonb_array_elements(rpc_creatures(:'big', 40)) r) q
       where (r->>'id')::int = :'hand'), 'NOTHING, which was the other half of it');
select '729. and about somebody else''s, it still says only what anybody can see: '
     || (select count(*) from (select jsonb_object_keys(r) k
         from (select jsonb_array_elements(rpc_creatures(:'big', 40)) r) q
         where not (r->>'mine')::boolean) kk
       where k in ('skills', 'xp', 'care', 'phase', 'carrying')) || ' of the five';

\echo ''
\echo '--- the front door'
/*
 * Founding an island has never moved it. The claim was written as a coalesce —
 * "only when there is no home at all… not a door anybody can walk through
 * twice" — so two islands founded and opened on the live project left everyone
 * arriving at the oldest ground on it.
 */
select '730. the door opens on: ' || coalesce((select w.name from home h join world w on w.id = h.island), 'nowhere');
select set_config('request.jwt.claims', json_build_object('sub', :'alice')::text, false) \g /dev/null
select rpc_found('Elsewhere', 11, 1024, 512, 512) as door \gset
select rpc_ready(:'door') \g /dev/null
select '731. and after founding a second island over ' || found_max() || ' tiles a side: '
     || coalesce((select w.name from home h join world w on w.id = h.island), 'nowhere')
     || ' — which is what refounding was always supposed to mean';
select rpc_found('A tab''s island', 13, 64, 32, 32) as small \gset
select rpc_ready(:'small') \g /dev/null
select '732. and after one a browser could have rolled: '
     || coalesce((select w.name from home h join world w on w.id = h.island), 'nowhere')
     || ' — the live smoke test founds sixty-four tiles every run and gives them back';

\echo ''
\echo '--- a face at the tide line'
/*
 * Reported from the island with a picture of it: a copper vein, "You cannot
 * mine below the water level.", and no water drawn on the tile or anywhere
 * near it. One line was wrong in two ways.
 *
 *     if rock_height(p_world, cx, cy) <= 0 then
 *
 * `rock_height` is `land_height - land_dirt` — the bedrock under the soil, not
 * the ground. A corner a vein shares with a meadow carries that meadow's soil,
 * so a face standing clear of the sea is refused because the rock buried
 * beside it is not. And `<=` refuses a face standing *at* the waterline, while
 * water is drawn at `< 0`: nought is the one height that refuses and shows
 * nothing to refuse for, and nought is where a shore face stands.
 *
 * Done on the big island, well away from anything the earlier subjects built.
 */
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
do $$
declare w uuid := (select id from world where name = 'Bigness');
begin
  perform land_set_dirt(w, 2200, 2200, 0); perform land_set_dirt(w, 2201, 2200, 0);
  perform land_set_dirt(w, 2201, 2201, 0); perform land_set_dirt(w, 2200, 2201, 0);
  perform land_set_height(w, 2200, 2200, 0); perform land_set_height(w, 2201, 2200, 0);
  perform land_set_height(w, 2201, 2201, 0); perform land_set_height(w, 2200, 2201, 0);
  perform land_set_rock(w, 2200, 2200, 4);   -- the copper vein from the report
  perform reconcile(w, 2200, 2200);
end $$;
select '733. a ' || (select name from rock_def where id = land_rock(:'big', 2200, 2200))
     || ' standing exactly at the waterline: water drawn ' || has_water(:'big', 2200, 2200)::text
     || ', and mining it is ' || coalesce(terrain_refusal(:'big', :'ivar', 'mine',
          '{"x":2200,"y":2200,"cx":2200,"cy":2200}'::jsonb), 'allowed')
     || ' — nought is the one height that used to refuse and draw nothing to refuse for';

do $$
declare w uuid := (select id from world where name = 'Bigness');
begin
  perform land_set_height(w, 2200, 2200, -10); perform land_set_height(w, 2201, 2200, -10);
  perform land_set_height(w, 2201, 2201, -10); perform land_set_height(w, 2200, 2201, -10);
end $$;
select '734. and ' || mine_depth() || ' under, which you work standing in: water drawn '
     || has_water(:'big', 2200, 2200)::text || ', mining is ' || coalesce(terrain_refusal(:'big', :'ivar', 'mine',
          '{"x":2200,"y":2200,"cx":2200,"cy":2200}'::jsonb), 'allowed');

do $$
declare w uuid := (select id from world where name = 'Bigness');
begin
  perform land_set_height(w, 2200, 2200, -11); perform land_set_height(w, 2201, 2200, -11);
  perform land_set_height(w, 2201, 2201, -11); perform land_set_height(w, 2200, 2201, -11);
end $$;
select '735. one unit deeper than that: ' || coalesce(terrain_refusal(:'big', :'ivar', 'mine',
          '{"x":2200,"y":2200,"cx":2200,"cy":2200}'::jsonb), 'ALLOWED')
     || ' — and chipping it back: ' || coalesce(terrain_refusal(:'big', :'ivar', 'chip_corner',
          '{"x":2200,"y":2200,"cx":2200,"cy":2200}'::jsonb), 'ALLOWED');

-- And the case the report was almost certainly standing on: dry ground, well
-- above the sea, with a fathom of soil on the corner the vein shares.
do $$
declare w uuid := (select id from world where name = 'Bigness');
begin
  perform land_set_height(w, 2200, 2200, 5); perform land_set_height(w, 2201, 2200, 5);
  perform land_set_height(w, 2201, 2201, 5); perform land_set_height(w, 2200, 2201, 5);
  perform land_set_dirt(w, 2200, 2200, 20);
end $$;
select '736. a face five above the sea with a fathom of soil on its corner: water drawn '
     || has_water(:'big', 2200, 2200)::text || ', the bedrock under the soil at '
     || rock_height(:'big', 2200, 2200) || ', and mining it is '
     || coalesce(terrain_refusal(:'big', :'ivar', 'mine',
          '{"x":2200,"y":2200,"cx":2200,"cy":2200}'::jsonb), 'allowed')
     || ' — the old rule read that bedrock and refused, blaming water that was not there';

\echo ''
\echo '--- what your own ask did'
/*
 * Reported as inventory rubberbanding when things are moved between a pack and
 * a container: a stack put in a crate turns up in the crate and stays in the
 * pack as well, for the twenty seconds until the next reconcile, and then
 * goes.
 *
 * Nothing ever told a browser that a thing had *left* its hands. `item` is
 * published with the default replica identity, so a DELETE carries the primary
 * key and nothing else, and the browser's Realtime filter is `holder_uid = me`
 * — which a row with only an `id` on it cannot match. Putting a whole stack in
 * a crate deletes the row. And a thing that goes to the ground has
 * `holder_uid` set to null, so the *new* row does not match either. Realtime
 * carries every arrival and no departure.
 *
 * So the ask answers with both halves, read after the write and in the
 * transaction that did it.
 */
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
update player set x = 2040.5, y = 2040.5 where world_id = :'big' and uid = :'ivar' \g /dev/null
insert into crate (world_id, id, kind, x, y, sx, sy, made_by)
values (:'big', 9301, 'plank', 2039, 2040, 1, 1, :'ivar') \g /dev/null
-- Whichever one he would actually reach for, which is the one `store_in_crate`
-- picks: naming a crate here and measuring a different one is how the first
-- draft of this passed while saying nothing.
select (nearest_crate(:'big', 2040.5, 2040.5)).id as near \gset
insert into item (world_id, holder, holder_uid, def, ql, count, extra)
values (:'big', 'player', :'ivar', 'log', 40, 3, 'Oak') returning id as stack \gset
select (rpc_act(:'big', 'store_in_crate',
  ('{"kind":"item","uid":' || :'stack' || ',"count":3}')::jsonb, 1)) as put \gset
select '737. three logs put in a crate — the answer to the ask hands back a pack of '
     || jsonb_array_length((:'put'::jsonb)->'pack') || ', and the stack is '
     || case when exists (select 1 from jsonb_array_elements((:'put'::jsonb)->'pack') e
                          where (e->>'id')::bigint = :'stack') then 'STILL IN IT' else 'gone from it' end
     || ' — which is what nothing on the wire ever said';
select '738. and the crate he reached for (' || :'near' || ') comes with it: '
     || coalesce((select (v->>'units') || ' units, ' || jsonb_array_length(v->'things') || ' sort(s)'
                  from jsonb_array_elements((:'put'::jsonb)->'crates') v where (v->>'id')::int = :'near'),
                 'THE CRATE IS NOT IN THE ANSWER')
     || ' — both halves of the move from one reading, so it is never in both places or neither';
select (rpc_act(:'big', 'take_from_store',
  ('{"kind":"item","uid":' || (select id from item where world_id = :'big' and holder = 'crate' and crate = :'near' and def = 'log')
   || ',"count":2}')::jsonb, 1)) as took \gset
select '739. and two taken back out: the pack holds '
     || (select coalesce(sum((e->>'count')::int), 0) from jsonb_array_elements((:'took'::jsonb)->'pack') e
         where e->>'def' = 'log') || ' logs and the crate is down to '
     || coalesce((select v->>'units' from jsonb_array_elements((:'took'::jsonb)->'crates') v
                  where (v->>'id')::int = :'near'), '?') || ' units';
select '740. and the two answers about a crate are one expression: '
     || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosrc like '%crates_near(%' and p.proname <> 'crates_near')
     || ' functions read it — ' || (select string_agg(p.proname, ', ' order by p.proname)
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosrc like '%crates_near(%' and p.proname <> 'crates_near');

\echo ''
\echo '--- watching yourself die'
/*
 * Reported: killed by a goblin with the health bar never moving once and no
 * wound ever appearing, and then able to walk about dead until a refresh.
 * Three complaints, one cause — the island did all of it and told the browser
 * none of it in time.
 *
 * `stats` and `wounds` rode `rpc_settle`, which is a minute apart unless one
 * of your own asks arms a shorter beat, and something eating you arms nothing.
 * The reported fight ran two seconds. And `rpc_move` has answered with the
 * island's own position since the day it was written, with nothing on the
 * other side ever reading the answer — so a body put back at the spawn by
 * `player_die` went on walking from where it fell.
 */
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
update player set x = 2040.5, y = 2040.5, moved_at = now() - interval '10 seconds',
    stats = jsonb_build_object('health', 1, 'stamina', 1, 'hunger', 1, 'thirst', 1), wounds = '[]'::jsonb
  where world_id = :'big' and uid = :'ivar' \g /dev/null
select hurt_player(:'big', :'ivar', 0.3, 'The goblin is on you', 'cut') \g /dev/null
select (rpc_move(:'big', 2040.6, 2040.5, 0)) as bitten \gset
select '741. bitten once, and then a step: the walk answers health '
     || round(((:'bitten'::jsonb)->'stats'->>'health')::numeric, 2) || ' and '
     || jsonb_array_length((:'bitten'::jsonb)->'wounds') || ' wound — '
     || coalesce(((:'bitten'::jsonb)->'wounds'->0->>'kind') || ' to the '
                 || ((:'bitten'::jsonb)->'wounds'->0->>'part'), 'NONE')
     || ' — where it used to answer neither and the bar waited a minute';
select hurt_player(:'big', :'ivar', 5, 'The goblin is on you', 'cut') \g /dev/null
select (rpc_move(:'big', 2040.7, 2040.5, 0)) as died \gset
select '742. and when it kills him, the next step answers '
     || round(((:'died'::jsonb)->>'x')::numeric, 1) || ', ' || round(((:'died'::jsonb)->>'y')::numeric, 1)
     || ' — he came ashore at ' || (select spawn_x + 0.5 || ', ' || spawn_y + 0.5 from world where id = :'big')
     || ', and that is ' || round(sqrt(power(((:'died'::jsonb)->>'x')::numeric - 2040.7, 2)
                                     + power(((:'died'::jsonb)->>'y')::numeric - 2040.5, 2)))
     || ' tiles from where the browser thought it was standing';
select '743. and what he woke up as: health '
     || round(((:'died'::jsonb)->'stats'->>'health')::numeric, 2) || ', '
     || jsonb_array_length((:'died'::jsonb)->'wounds') || ' wounds, nothing in hand ('
     || coalesce((select act from player where world_id = :'big' and uid = :'ivar'), 'nothing')
     || ') and nothing queued behind it ('
     || (select jsonb_array_length(act_queue) from player where world_id = :'big' and uid = :'ivar') || ')';

\echo ''
\echo '--- a leash, and a knack off a dish'
/*
 * Two reports. Aggressive things chase you until you are dead: every give-up
 * in `hunt_settle` measured the gap between hunter and hunted, and a hunter
 * runs at `speed * 1.15`, so the gap it was tested against was a gap it was
 * closing. And a knack came off a raw berry: `boon_of` gave one for anything
 * with something in it, which is a handful of blueberries as much as a stew.
 */
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select '744. of the ' || (select count(*) from item_def f where f.category = 'food'
         and (coalesce(f.food,0) > 0 or coalesce(f.drink,0) > 0))
     || ' nourishing things on the island, '
     || (select count(*) from item_def f where f.category = 'food'
         and (coalesce(f.food,0) > 0 or coalesce(f.drink,0) > 0)
         and boon_of((select seed from world where id = :'world2'), f.id) is not null)
     || ' carry a knack — a berry gives '
     || coalesce(boon_of((select seed from world where id = :'world2'), 'blueberry'), 'nothing')
     || ', raw meat gives ' || coalesce(boon_of((select seed from world where id = :'world2'), 'meat'), 'nothing')
     || ', and a stew gives ' || coalesce(boon_of((select seed from world where id = :'world2'), 'stew'), 'NOTHING');

-- A goblin that has had your scent and run forty tiles for it.
update player set x = 2100.5, y = 2060.5 where world_id = :'big' and uid = :'ivar' \g /dev/null
select creature_spawn(:'big', 'goblin', 2099.5, 2060.5, 'wild', now() - interval '1 hour') as chaser \gset
update creature set hunting = :'ivar', hunt_x = 2060, hunt_y = 2060, hunt_again = null,
    until = now(), leg_at = now(), leg_ends = now() where world_id = :'big' and id = :'chaser' \g /dev/null
select (hunt_settle(:'big', (select c from creature c where c.world_id = :'big' and c.id = :'chaser'),
    (select s from species_def s where s.id = 'goblin'),
    age_row((select born from creature where world_id = :'big' and id = :'chaser')))) as ran \gset
select '745. a goblin ' || round(sqrt(power(2100.5 - 2060, 2) + power(2060.5 - 2060, 2)))
     || ' tiles from where it first had his scent, and the leash is ' || hunt_leash() || ': it is hunting '
     || coalesce(((:'ran'::creature).hunting)::text, 'nobody')
     || ', and will take an interest again in '
     || coalesce(round(extract(epoch from (((:'ran'::creature).hunt_again) - now())))::text, 'NO REST SET')
     || ' seconds — which is what stops it dropping you and picking you up again on the next breath';
-- And the same goblin with the leash tied where it is standing, which is a
-- chase that has only just started.
update creature set hunt_x = 2099.5, hunt_y = 2060.5, hunt_again = null, hunting = :'ivar'
  where world_id = :'big' and id = :'chaser' \g /dev/null
select '746. and one that has only just started, with the leash tied where it stands: hunting '
     || coalesce(((hunt_settle(:'big',
          (select c from creature c where c.world_id = :'big' and c.id = :'chaser'),
          (select s from species_def s where s.id = 'goblin'),
          age_row((select born from creature where world_id = :'big' and id = :'chaser')))).hunting)::text,
        'NOBODY, AND IT IS STANDING ON HIM')
     || ' — a leash is a leash, not a truce';

\echo ''
\echo '--- everything the island kept about you and never spent'
/*
 * `skill_raise` applied one modifier — the reader's path — and nothing else,
 * while `player` carried four columns the browser draws: `rested` banked by
 * sleeping with `rest_bonus()` called by nothing, `boons` written by eating
 * and read by nothing, and `knacks` and `titles` never written at all. No
 * function on the island mentioned a title.
 */
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
update player set rested = 0, boons = '[]'::jsonb, knacks = '{}'::jsonb, titles = '[]'::jsonb,
    title = null, nutrition = '{}'::jsonb, way = null where world_id = :'world2' and uid = :'ivar' \g /dev/null
select round(skill_mult(:'world2', :'ivar', 'mining')::numeric, 2) as plain \gset
update player set rested = 600 where world_id = :'world2' and uid = :'ivar' \g /dev/null
select round(skill_mult(:'world2', :'ivar', 'mining')::numeric, 2) as slept \gset
update player set knacks = '{"mining": 3}'::jsonb where world_id = :'world2' and uid = :'ivar' \g /dev/null
select round(skill_mult(:'world2', :'ivar', 'mining')::numeric, 2) as knacked \gset
update player set nutrition = '{"starch":1,"flesh":1,"fat":1,"greens":1}'::jsonb
  where world_id = :'world2' and uid = :'ivar' \g /dev/null
select round(skill_mult(:'world2', :'ivar', 'mining')::numeric, 2) as fed \gset
update player set boons = jsonb_build_array(jsonb_build_object('skill', 'mining', 'bonus', boon_bonus(),
    'until', world_time(:'world2') + 600, 'from', 'stew')) where world_id = :'world2' and uid = :'ivar' \g /dev/null
select '747. what a trade goes in at: ×' || :'plain' || ' plain, ×' || :'slept'
     || ' after a night in a bed, ×' || :'knacked' || ' with three knacks in it, ×' || :'fed'
     || ' with a full table, and ×' || round(skill_mult(:'world2', :'ivar', 'mining')::numeric, 2)
     || ' with a stew that favours it — where every one of the four was a column this island kept and never spent';
select '748. and on a trade the stew does not favour: ×'
     || round(skill_mult(:'world2', :'ivar', 'digging')::numeric, 2);
update skill set value = 49.99 where world_id = :'world2' and uid = :'ivar' and id = 'mining' \g /dev/null
delete from event where uid = :'ivar' \g /dev/null
select skill_raise(:'world2', :'ivar', 'mining', 50) \g /dev/null
select '749. taken past fifty: titles '
     || (select titles from player where world_id = :'world2' and uid = :'ivar')::text
     || ', wearing ' || coalesce((select title from player where world_id = :'world2' and uid = :'ivar'), 'NOTHING')
     || ' — and he is told: '
     || coalesce((select text from event where world_id = :'world2' and uid = :'ivar' and kind = 'skill'
                  order by n limit 1), 'NOTHING, WHICH WAS THE BUG');
select '750. and the beat carries all of it: ' || (select string_agg(k, ', ' order by k)
         from jsonb_object_keys(rpc_settle(null, :'world2')) k
         where k in ('rested', 'boons', 'knacks', 'titles', 'title', 'nutrition'));

\echo ''
\echo '--- and what goes off where it lies'
/*
 * `item_def.decay` is real data — food rots in about half an hour, a tool
 * lasts most of a day — and `groundDecayRate` is real arithmetic on top of it.
 * Neither side had ever called either, so a haunch of meat dropped in a field
 * was still a haunch of meat a week later.
 */
delete from item where world_id = :'world2' and holder = 'ground' \g /dev/null
insert into item (world_id, holder, gx, gy, def, ql) values (:'world2', 'ground', 3, 3, 'meat', 30)
  returning id as haunch \gset
insert into item (world_id, holder, gx, gy, def, ql) values (:'world2', 'ground', 3, 3, 'pickaxe', 30)
  returning id as dropped_pick \gset
select '751. on the floor at QL 30: meat goes off at '
     || round((select ground_decay_rate(i) from item i where i.id = :'haunch')::numeric, 1)
     || ' damage an hour, a pickaxe at '
     || round((select ground_decay_rate(i) from item i where i.id = :'dropped_pick')::numeric, 1)
     || ' — and a crate is a roof: nothing in one rots at all';
select ground_sweep(:'world2') \g /dev/null
update item set rot_at = now() - interval '2 hours' where world_id = :'world2' and holder = 'ground' \g /dev/null
select ground_sweep(:'world2') \g /dev/null
select '752. two hours later: the meat is '
     || coalesce((select round(dmg::numeric)::text || ' damaged' from item where id = :'haunch'), 'gone altogether')
     || ' and the pickaxe is '
     || coalesce((select round(dmg::numeric)::text || ' damaged' from item where id = :'dropped_pick'), 'gone');

-- And the body, which was thinner than the one being drawn.
update player set nutrition = '{}'::jsonb, stats = jsonb_set(stats, '{hunger}', '1'), act = null,
    body_at = now() - interval '600 seconds', moved_at = now() - interval '1 hour'
  where world_id = :'world2' and uid = :'ivar' \g /dev/null
select body_settle(:'world2', :'ivar') \g /dev/null
select round(((stats->>'hunger')::numeric), 4) as empty_table from player where world_id = :'world2' and uid = :'ivar' \gset
update player set nutrition = '{"starch":1,"flesh":1,"fat":1,"greens":1}'::jsonb,
    stats = jsonb_set(stats, '{hunger}', '1'), body_at = now() - interval '600 seconds'
  where world_id = :'world2' and uid = :'ivar' \g /dev/null
select body_settle(:'world2', :'ivar') \g /dev/null
select '753. ten minutes of standing about: hunger ' || :'empty_table' || ' on an empty table and '
     || (select round(((stats->>'hunger')::numeric), 4) from player where world_id = :'world2' and uid = :'ivar')
     || ' on a full one — and the table itself is down to '
     || (select round((nutrition->>'starch')::numeric, 3) from player where world_id = :'world2' and uid = :'ivar')
     || ' from 1, because one good dinner is not meant to feed a body for life';
update player set stats = jsonb_set(stats, '{stamina}', '0'), body_at = now() - interval '60 seconds',
    moved_at = now() - interval '1 hour' where world_id = :'world2' and uid = :'ivar' \g /dev/null
select body_settle(:'world2', :'ivar') \g /dev/null
select round(((stats->>'stamina')::numeric), 3) as still from player where world_id = :'world2' and uid = :'ivar' \gset
update player set stats = jsonb_set(stats, '{stamina}', '0'), body_at = now() - interval '60 seconds',
    moved_at = now() where world_id = :'world2' and uid = :'ivar' \g /dev/null
select body_settle(:'world2', :'ivar') \g /dev/null
select '754. a minute of wind back: ' || :'still' || ' standing still and '
     || (select round(((stats->>'stamina')::numeric), 3) from player where world_id = :'world2' and uid = :'ivar')
     || ' on the move — `wind_walk` was crossed the day the body was and called by nothing';

select '755. every crate in sight counted once for the lot: crates_near reads crate_units '
     || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'crates_near' and p.prosrc like '%crate_units(%')
     || ' times, where it used to run one for every crate within forty tiles on every ground read';

/*
 * And deep water, which cost nothing at all until now.
 *
 * A pool ten under the line, dug out of a meadow that stands at a hundred, so
 * that the one thing changing is whether the ground under a body is there.
 */
select land_set_height(:'world2', 3, 12, -10), land_set_height(:'world2', 4, 12, -10),
       land_set_height(:'world2', 4, 13, -10), land_set_height(:'world2', 3, 13, -10) \g /dev/null
update player set x = 8.5, y = 8.5, level = 0 where world_id = :'world2' and uid = :'ivar' \g /dev/null
select coalesce(in_deep_water(:'world2', :'ivar')::text, 'null') as on_grass \gset
update player set x = 3.5, y = 12.5 where world_id = :'world2' and uid = :'ivar' \g /dev/null
select coalesce(in_deep_water(:'world2', :'ivar')::text, 'null') as in_water \gset
insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, driver)
values (:'world2', 'furniture', 'rowing_boat', 3, 12, 1, 1, 3.5, 12.5, :'ivar')
returning id as hull \gset
select coalesce(in_deep_water(:'world2', :'ivar')::text, 'null') as in_hull \gset
delete from placed where id = :'hull' \g /dev/null
select '756. out of your depth: on the meadow ' || :'on_grass' || ', in ten feet of water '
     || :'in_water' || ', and in a hull in the same ten feet ' || :'in_hull'
     || ' — a hull in thirty feet of water was swimming, which is the one thing a boat is for';

update player set act = null, stats = '{"health":1,"stamina":1,"hunger":1,"thirst":1}'::jsonb,
    body_at = now() - interval '30 seconds', swim_at = null, drowned_at = null
  where world_id = :'world2' and uid = :'ivar' \g /dev/null
delete from skill where world_id = :'world2' and uid = :'ivar' and id = 'swimming' \g /dev/null
select body_settle(:'world2', :'ivar') \g /dev/null
select '757. half a minute of it: wind '
     || (select round((stats->>'stamina')::numeric, 4) from player where world_id = :'world2' and uid = :'ivar')
     || ' of a full breath, swimming up from 1 to '
     || round(skill_of(:'world2', :'ivar', 'swimming')::numeric, 4)
     || ' on twenty-five goes, with '
     || (select round(extract(epoch from (now() - swim_at))::numeric, 0) from player where world_id = :'world2' and uid = :'ivar')
     || ' seconds left on the clock for the next call';

delete from event where world_id = :'world2' and uid = :'ivar' \g /dev/null
update player set body_at = now() - interval '20 seconds' where world_id = :'world2' and uid = :'ivar' \g /dev/null
select body_settle(:'world2', :'ivar') \g /dev/null
select '758. twenty seconds more: wind '
     || (select round((stats->>'stamina')::numeric, 4) from player where world_id = :'world2' and uid = :'ivar')
     || ' and health ' || (select round((stats->>'health')::numeric, 4) from player where world_id = :'world2' and uid = :'ivar')
     || ' — charged for the part there was no breath left for and not for the whole stretch — "'
     || coalesce((select text from event where world_id = :'world2' and uid = :'ivar' and kind = 'error' order by n desc limit 1), 'nothing said') || '"';

update player set x = 8.5, y = 8.5, body_at = now() - interval '10 seconds',
    moved_at = now() - interval '1 hour' where world_id = :'world2' and uid = :'ivar' \g /dev/null
select body_settle(:'world2', :'ivar') \g /dev/null
select '759. and ashore: wind coming back at '
     || (select round((stats->>'stamina')::numeric, 4) from player where world_id = :'world2' and uid = :'ivar')
     || ', the swimming clock started again '
     || (select (swim_at >= now() - interval '2 seconds')::text from player where world_id = :'world2' and uid = :'ivar')
     || ' and the telling-off forgotten '
     || (select (drowned_at is null)::text from player where world_id = :'world2' and uid = :'ivar');

/*
 * And the journal, which could not tick a single one of its eighty-five goals
 * on an island.
 *
 * No measurement of its own is needed to set this up: the six hundred goes
 * above are a session, and this is what the island wrote down while they
 * happened. A key that stops appearing here is a note that has come unhooked
 * from the rule it sits next to.
 */
select '761. what the island noted through the whole of the above: '
     || (select string_agg(k || '×' || v, ', ' order by k)
         from (select key as k, value::text as v from jsonb_each_text(
                 (select tally from player where world_id = :'world2' and uid = :'ivar'))) q);
select '762. and the ledger of what came off the bench: '
     || (select count(*) from jsonb_object_keys(
           (select ledger from player where world_id = :'world2' and uid = :'ivar')) k)
     || ' kinds, ' || (select coalesce(sum((v->>'n')::int), 0)
         from jsonb_each((select ledger from player where world_id = :'world2' and uid = :'ivar')) e(k, v))
     || ' things in all, best QL ' || (select round(max((v->>'best')::numeric), 1)
         from jsonb_each((select ledger from player where world_id = :'world2' and uid = :'ivar')) e(k, v));

-- And the half of it the browser still works out: a tick comes up on the beat
-- and stays up, because done is done through a refresh and a change of machine.
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select rpc_settle(null, :'world2', null, false, '["tree","ore","fire"]'::jsonb) \g /dev/null
select rpc_settle(null, :'world2', null, false, '["fire","crate"]'::jsonb) \g /dev/null
select '763. ticked off, through two beats and no duplicates: '
     || (select string_agg(t, ', ' order by t) from jsonb_array_elements_text(
           (select ticked from player where world_id = :'world2' and uid = :'ivar')) t);
select coalesce((rpc_settle(null, :'world2', null, false))->>'tally', 'nothing') as quiet \gset
select journal_note(:'world2', :'ivar', 'worms') \g /dev/null
select '764. and the beat only carries it when it has moved: a quiet beat says '
     || case when :'quiet' = 'nothing' then 'nothing' else 'the lot' end
     || ', and one after a note says '
     || case when (rpc_settle(null, :'world2', null, false))->>'tally' is null then 'nothing' else 'the lot' end;

-- And the line every go of every job ends with, which was written out by hand
-- in ten places and said a different name from the window it sends you to.
delete from event where world_id = :'world2' and uid = :'ivar' \g /dev/null
select skill_told(:'world2', :'ivar', 'armorsmithing', 1) \g /dev/null
select '765. "' || (select text from event where world_id = :'world2' and uid = :'ivar'
                    and kind = 'skill' order by n desc limit 1)
     || '" — the Skills window calls it '
     || (select name from skill_def where id = 'armorsmithing')
     || ', and for fifteen of the sixty trades that is not what initcap gives you';
-- And a gain under four places, which happens whenever the floor meets a low
-- roll: `skill_gain_of` floors at 0.0001 and then multiplies by 0.6 to 1.4.
delete from event where world_id = :'world2' and uid = :'ivar' \g /dev/null
select skill_said(:'world2', :'ivar', 'armorsmithing', min_gain() * 0.6) \g /dev/null
select '766. and the smallest gain the rules can give: "'
     || (select text from event where world_id = :'world2' and uid = :'ivar'
         and kind = 'skill' order by n desc limit 1)
     || '" — four places would have read "increased by 0.0001", which is not what it was';
select '767. and it is written once now, not eleven times: '
     || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prokind = 'f' and p.prosrc like '% increased by %')
     || ' function says it';

/*
 * And the people you know, which this island had no way of saying anything
 * about: one inhabitant per settlement, no friends, and nothing you could say
 * to one person that the whole island did not hear.
 */
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select '769. Ivar asks Hild home: ' || (rpc_invite(:'world2', :'hild'))::text
     || ', and asking twice: ' || ((rpc_invite(:'world2', :'hild'))->>'why');
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select coalesce(on_my_deed(:'world2', :'hild', (select x from deed where world_id = :'world2' and founded_by = :'ivar'),
                           (select y from deed where world_id = :'world2' and founded_by = :'ivar'))::text, 'null') as before_yes \gset
select rpc_invite_answer(:'world2', :'ivar', true) \g /dev/null
select '770. before she answers the token is hers to build on: ' || :'before_yes'
     || '; after: ' || on_my_deed(:'world2', :'hild', (select x from deed where world_id = :'world2' and founded_by = :'ivar'),
                                  (select y from deed where world_id = :'world2' and founded_by = :'ivar'))::text
     || ' — one line in `on_my_deed`, and twenty rules know a citizen when they see one';
/*
 * And the roll: one settlement of your own, and a citizen of three besides.
 *
 * Three tiny deeds with made-up founders, because a founder holds exactly one
 * and this island is sixteen tiles across. What is being measured is the cap
 * and the door's words for it, not whether four squares fit on a small island.
 */
insert into deed (world_id, name, x, y, radius, level, founded_by) values
  (:'world2', 'Southfold', 2, 13, 1, 1, '0000000a-0000-0000-0000-00000000000a'),
  (:'world2', 'Eastmere',  13, 2, 1, 1, '0000000b-0000-0000-0000-00000000000b'),
  (:'world2', 'Northgate', 13, 13, 1, 1, '0000000c-0000-0000-0000-00000000000c') \g /dev/null
insert into deed_invite (world_id, founder, uid) values
  (:'world2', '0000000a-0000-0000-0000-00000000000a', :'hild'),
  (:'world2', '0000000b-0000-0000-0000-00000000000b', :'hild'),
  (:'world2', '0000000c-0000-0000-0000-00000000000c', :'hild') \g /dev/null
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select ((rpc_social(:'world2'))->>'room') as room_before \gset
select (rpc_invite_answer(:'world2', '0000000a-0000-0000-0000-00000000000a', true)) as took_a \gset
select (rpc_invite_answer(:'world2', '0000000b-0000-0000-0000-00000000000b', true)) as took_b \gset
select (rpc_invite_answer(:'world2', '0000000c-0000-0000-0000-00000000000c', true)) as took_c \gset
select '771. already living at Lambfold, Hild had room for ' || :'room_before' || ' more: '
     || coalesce((:'took_a'::jsonb)->>'deed', '-') || ' yes, '
     || coalesce((:'took_b'::jsonb)->>'deed', '-') || ' yes, and the third "'
     || coalesce((:'took_c'::jsonb)->>'why', 'ALLOWED') || '"'
     || ' — with the invitation left standing, so leaving one is all it takes';
select '772. and her land is now ' || (select string_agg(d.name, ', ' order by d.name) from deeds_of(:'world2', :'hild') d)
     || ' — she may build on every one of them ('
     || (select string_agg(on_my_deed(:'world2', :'hild', d.x, d.y)::text, ', ' order by d.name) from deeds_of(:'world2', :'hild') d)
     || ') and still may not disband Ivar''s: "'
     || coalesce(settlement_refusal(:'world2', :'hild', 'disband_deed', '{}'::jsonb), 'ALLOWED') || '"';

-- Its own statement, or the select beside it reads the island from before it
-- ran: the suite has been bitten by that before and says so at the top.
select rpc_friend(:'world2', :'ivar') as asked \gset
select '773. Hild asks to be a friend: ' || :'asked'
     || ', and Ivar is told: "' || (select text from event where world_id = :'world2' and uid = :'ivar' order by n desc limit 1) || '"';
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select rpc_friend(:'world2', :'hild') \g /dev/null
select '774. and once he says yes, where she is: ' || ((rpc_social(:'world2'))->'friends')::text;
update player set seen_at = now() - interval '2 hours' where world_id = :'world2' and uid = :'hild' \g /dev/null
select '775. and with Hild away from the keyboard: ' || ((rpc_social(:'world2'))->'friends')::text
     || ' — the island knows where every body is every second of the day, and a window that said so would be a radar';

/*
 * And ground nobody has a height for, which is not thirty feet of water.
 *
 * `land_height` answers NULL where nothing has been written, a NULL guard in a
 * `case` matches no `when`, and `in_deep_water` kept its yes in the `else` — so
 * a body on unread ground was a swimmer, and a swimmer spends wind rather than
 * getting it back. Fourteen checks of one live run failed with "You are too
 * exhausted to do that", and the body never recovered.
 */
update player set x = 9999.5, y = 9999.5 where world_id = :'world2' and uid = :'hild' \g /dev/null
select coalesce(in_deep_water(:'world2', :'hild')::text, 'null') as off_the_map \gset
update player set x = 2.5, y = 0.5, stats = jsonb_set(stats, '{stamina}', '0'),
    body_at = now() - interval '30 seconds', act = null
  where world_id = :'world2' and uid = :'hild' \g /dev/null
select body_settle(:'world2', :'hild') \g /dev/null
select '776. off the end of the land, where `land_height` says nothing: in deep water '
     || :'off_the_map' || ' — and thirty seconds of standing there leaves the wind at '
     || (select round((stats->>'stamina')::numeric, 3) from player where world_id = :'world2' and uid = :'hild')
     || ' rather than nought, which is the difference between resting and drowning';

select rpc_letter(:'world2', :'hild', 'The iron is in the crate by the token.') \g /dev/null
select set_config('request.jwt.claims', json_build_object('sub', :'hild')::text, false) \g /dev/null
select '777. a letter: waiting ' || ((rpc_social(:'world2'))->'unread')::text
     || ', delivered as "' || (select text from event where world_id = :'world2' and uid = :'hild' and kind = 'letter' order by n desc limit 1) || '"';
select '778. and read by the reading of it: ' || ((rpc_letters(:'world2', :'ivar'))->'letters')::text
     || ' then ' || ((rpc_social(:'world2'))->'unread')::text;

/*
 * And every number about a rare thing, read off the one table that holds them.
 *
 * `rarity_def` is generated from `RARITIES`, and four functions used to write
 * the same numbers out again by hand. One of them had drifted: `improve_ceiling`
 * said 4, 10 and 20 where the table, the browser and this island's own examine
 * line all said 5, 12 and 25 — so it told you a thing could be bettered five
 * past your skill and then refused at four.
 */
select '780. every rarity read off `rarity_def`: '
     || (select string_agg(r.id || ' ×' || round(rarity_boost(r.id)::numeric, 2)
           || ' wear ×' || round(rarity_keep(r.id)::numeric, 2)
           || ' +' || round(r.ceiling::numeric, 0) || ' QL, 1 in '
           || round(1 / r.odds::numeric, 0) || ' of the step before', ', ' order by r.ord) from rarity_def r)
     || ' — and a plain thing ×' || round(rarity_boost(null)::numeric, 2);

-- The rule and the sentence about the rule, which disagreed by five whole
-- points of quality on a fantastic tool.
insert into item (world_id, holder, holder_uid, def, ql, dmg, count, extra, rare)
values (:'world2', 'player', :'ivar', 'hatchet', 40, 0, 1, 'Iron', 'fantastic')
returning id as prize \gset
select round(skill_of(:'world2', :'ivar', 'blacksmithing')::numeric, 1) as smith \gset
select '781. a fantastic hatchet, with blacksmithing at ' || :'smith' || ': the island lets it be bettered to '
     || round(improve_ceiling(:'world2', :'ivar', 'blacksmithing', 'fantastic')::numeric, 1)
     || ', and tells you "' || substring((select examine_item_text(:'world2', :'ivar', i) from item i where i.id = :'prize')
          from 'can be bettered [0-9]+ past your own skill') || '"';
delete from item where id = :'prize' \g /dev/null

/*
 * And a thing coming on under the file, which is new: rarity used to be rolled
 * once at the bench and never again, so no amount of work could turn an
 * ordinary thing into a good one.
 */
select '783. the ladder: '
     || (select string_agg(coalesce(q.id, 'plain') || ' → ' || coalesce(rarity_next(q.id), 'nothing above it'), ', '
                           order by q.ord)
         from (select null::text as id, 0 as ord union all select r.id, r.ord from rarity_def r) q)
     || ' — at 1 in ' || (select string_agg(round(1 / rarity_chance(r.id)::numeric, 0)::text, ', 1 in ' order by r.ord) from rarity_def r)
     || ' a pass, which is `RARITY_ODDS` multiplied out rather than each step on its own';
/*
 * And what a pass can *ever* turn a thing into, which is the half of this that
 * matters: twenty thousand rolls from each starting point, and every distinct
 * thing that came out of them.
 *
 * Written as an exhaustive list rather than a rate, because the rates are
 * exact arithmetic and 782 already reads them off. The first draft of this
 * sampled a starting rarity with `random()` in a lateral and then passed it to
 * `rarity_lift` — and Postgres inlined the lateral, so the two references drew
 * *different* numbers and the measurement was reporting on pairs that never
 * happened. Nothing random decides what is being asked here now.
 */
select '784. what a good pass can ever turn a thing into, over twenty thousand rolls apiece: '
     || (select string_agg(q.was || ' → ' || q.got, ', ' order by q.ord)
         from (select coalesce(r.id, 'plain') as was, r.ord,
                 (select string_agg(distinct coalesce(l.got, 'itself'), ' or ' order by coalesce(l.got, 'itself'))
                  from (select rarity_lift(r.id) as got from generate_series(1, 20000)) l) as got
               from (select null::text as id, 0 as ord
                     union all select d.id, d.ord from rarity_def d) r) q)
     || ' — one step or none, and no road to the top of it but through the middle';

-- End to end, with the odds forced so the roll is not the thing being tested:
-- one good pass, and the thing in hand is not the thing it was.
update rarity_def set odds = 1 where id = 'rare' \g /dev/null
update player set stats = jsonb_set(stats, '{stamina}', '1') where world_id = :'world2' and uid = :'ivar' \g /dev/null
insert into item (world_id, holder, holder_uid, def, ql, count, extra)
values (:'world2', 'player', :'ivar', 'iron_lump', 60, 20, 'Iron') \g /dev/null
insert into item (world_id, holder, holder_uid, def, ql, dmg, count, extra)
values (:'world2', 'player', :'ivar', 'hatchet', 20, 0, 1, 'Iron') returning id as under_file \gset
delete from event where world_id = :'world2' and uid = :'ivar' \g /dev/null
/*
 * The world and the thing both read off the thing itself.
 *
 * psql does not substitute a variable inside a dollar-quoted block, so this
 * cannot be handed `:'world2'` — and `select id from world limit 1` is not it
 * either: there are several islands by the time the suite gets here and that
 * has no `order by`. The item knows which world it is on; ask it.
 */
do $$
declare me uuid := '11111111-1111-1111-1111-111111111111'; c bigint; w uuid; i int;
begin
  select q.id, q.world_id into c, w from item q
   where q.def = 'hatchet' and not q.issued and q.holder_uid = me order by q.id desc limit 1;
  for i in 1..40 loop
    exit when (select rare from item where id = c) is not null;
    update item set dmg = 0 where id = c;
    exit when item_refusal(w, me, 'improve_item', jsonb_build_object('kind', 'item', 'uid', c)) is not null;
    perform perform_item(w, me, 'improve_item', jsonb_build_object('kind', 'item', 'uid', c));
  end loop;
end $$;
select '785. a plain iron hatchet, worked on: it is now '
     || coalesce((select rare from item where id = :'under_file'), 'plain')
     || ' — "' || coalesce((select text from event where world_id = :'world2' and uid = :'ivar'
                            and kind = 'skill' order by n desc limit 1), 'nothing said') || '"'
     || ', the journal has counted ' || coalesce((select (tally->>'rare') from player where world_id = :'world2' and uid = :'ivar'), '0')
     || ', and the ceiling it may be bettered to went from '
     || round(improve_ceiling(:'world2', :'ivar', 'blacksmithing', null)::numeric, 1) || ' to '
     || round(improve_ceiling(:'world2', :'ivar', 'blacksmithing',
          (select rare from item where id = :'under_file'))::numeric, 1);
update rarity_def set odds = 0.01 where id = 'rare' \g /dev/null

/*
 * And how deep the soil is, which the island changed on every spadeful and
 * never told anybody.
 *
 * Reported from the island: fourteen dirt dug out of a corner and no nearer
 * the rock — "the number above water went down appropriately but not the
 * number above rock". `tile_change` carried the four corner heights and
 * nothing about the dirt, so the browser's soil stayed at whatever the
 * generator rolled, for ever.
 */
select land_set_height(:'world2', 6, 6, 40), land_set_dirt(:'world2', 6, 6, 14),
       land_set_height(:'world2', 7, 6, 40), land_set_dirt(:'world2', 7, 6, 14),
       land_set_height(:'world2', 7, 7, 40), land_set_dirt(:'world2', 7, 7, 14),
       land_set_height(:'world2', 6, 7, 40), land_set_dirt(:'world2', 6, 7, 14) \g /dev/null
delete from tile_change where world_id = :'world2' \g /dev/null
update player set x = 6.5, y = 6.5, stats = jsonb_set(stats, '{stamina}', '1'), act = null
  where world_id = :'world2' and uid = :'ivar' \g /dev/null
do $$
declare me uuid := '11111111-1111-1111-1111-111111111111'; w uuid; i int;
begin
  select p.world_id into w from player p where p.uid = me and p.x = 6.5 limit 1;
  for i in 1..12 loop
    exit when land_dirt(w, 6, 6) <= 11;
    perform act_perform(w, me, 'dig', '{"kind":"tile","x":6,"y":6,"cx":6,"cy":6}'::jsonb);
  end loop;
end $$;
select '787. three spadefuls out of a corner that stood at 40 with 14 of soil on it: the island has it at '
     || land_height(:'world2', 6, 6) || ' with ' || land_dirt(:'world2', 6, 6)
     || ' left, and rock at ' || rock_height(:'world2', 6, 6)
     || ' — which has not moved, because dirt does not roll';
select '788. and what it told the browser: heights '
     || (select corners::text from tile_change where world_id = :'world2' and x = 6 and y = 6 order by n desc limit 1)
     || ', soil ' || (select soil::text from tile_change where world_id = :'world2' and x = 6 and y = 6 order by n desc limit 1)
     || ' — the soil was the one thing about a square this row never carried, so fourteen stayed fourteen however long anybody dug';


\echo ''
\echo '--- a map is a picture of somewhere'
/*
 * A world of its own for the hunt: sixty-four tiles, flat, dry, with nobody's
 * stake in it. The main island is sixteen across and has three settlements on
 * it by now, and a treasure has to go somewhere that is none of them.
 */
\set dane '44444444-4444-4444-4444-444444444444'
do $$
declare w uuid; i int; j int;
begin
  insert into world (name, seed, size, spawn_x, spawn_y, ready)
  values ('Hoarding', 77, 64, 32, 32, true) returning id into w;
  perform land_blank(w, 64);
  for j in 0..64 loop
    for i in 0..64 loop perform land_set_height(w, i, j, 30); end loop;
  end loop;
  for j in 0..63 loop
    for i in 0..63 loop perform land_set_tile(w, i, j, 0); end loop;
  end loop;
end $$;
select id as world3 from world where name = 'Hoarding' \gset
select set_config('request.jwt.claims', json_build_object('sub', :'dane')::text, false) \g /dev/null
select rpc_join(:'world3', 'Dane') \g /dev/null
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1'), body_at = now()
  where uid = :'dane' \g /dev/null

-- Dug up out of the ground: a grand one, because the roll is being asked for
-- rather than waited a thousand spadefuls for.
select bury_treasure(:'world3', :'dane', 80, 32, 32) as mapid \gset
select '790. one spadeful in a thousand: ' ||
       (select item_name(i) || ', QL ' || round(i.ql::numeric, 0) from item i where i.id = :'mapid')
     || ' — buried ' || (select round(sqrt((t.x - 32) ^ 2 + (t.y - 32) ^ 2)::numeric, 0) from treasure t where t.item_id = :'mapid')
     || ' tiles off, on ground standing ' || (select round(centre_height(:'world3', t.x, t.y)::numeric, 0) from treasure t where t.item_id = :'mapid')
     || ' above the water, on nobody''s deed ('
     || (select not exists (select 1 from deed_covering(:'world3', t.x, t.y)) from treasure t where t.item_id = :'mapid')
     || ')';

/*
 * And the thing the whole mechanic rests on. `treasure` has `world_id` on it,
 * so `private.lock_doors()` gives it no read policy — RLS on and nothing
 * written is a table that answers empty whoever asks.
 */
select '791. and where it is, to anybody who asks the island directly: '
     || (select case when relrowsecurity then 'row security on' else 'WIDE OPEN' end
           from pg_class where relname = 'treasure')
     || ', policies ' || (select count(*) from pg_policies where tablename = 'treasure')
     || ', granted to ' || coalesce((select string_agg(distinct grantee, ', ')
           from information_schema.role_table_grants where table_name = 'treasure'
             and grantee in ('anon', 'authenticated')), 'nobody')
     || ' — the two calls below are the only things on the island that can see it';

-- What a browser is told instead.
select set_config('request.jwt.claims', json_build_object('sub', :'dane')::text, false) \g /dev/null
select '792. what it is told instead: ' ||
       (select (m->>'side') || ' tiles a side, ' || jsonb_array_length(m->'tiles') || ' of them and '
            || jsonb_array_length(m->'heights') || ' corner heights, a ' || (m->>'tier')
            || ' map — and not one number in it that says where on the island any of it is'
        from (select rpc_treasure_map(:'world3', :'mapid') as m) q);

-- Walking in. The body is put down at a distance rather than walked, because
-- what is being measured is the sentence, not the walking.
do $$
declare v_t treasure; v_d double precision;
begin
  select * into v_t from treasure where item_id = (select id from item where def = 'treasure_map' limit 1);
  for v_d in select unnest(array[60, 20, 6, 1]) loop
    update player set x = v_t.x + 0.5 + v_d, y = v_t.y + 0.5
      where uid = '44444444-4444-4444-4444-444444444444';
    raise notice '     % tiles off: %', v_d,
      coalesce(treasure_refusal((select world_id from treasure limit 1),
        '44444444-4444-4444-4444-444444444444', 'unearth',
        jsonb_build_object('uid', v_t.item_id)), 'DIG');
  end loop;
end $$;
select '793. and how warm you are, which is a distance and never a bearing — the four lines above, and the last of them is the one that lets you dig';

-- On the spot, and what comes out of the ground.
do $$
declare v_t treasure;
begin
  select * into v_t from treasure limit 1;
  update player set x = v_t.x + 0.5, y = v_t.y + 0.5
    where uid = '44444444-4444-4444-4444-444444444444';
end $$;
select t.x as hx, t.y as hy from treasure t limit 1 \gset
select rpc_act(:'world3', 'unearth', ('{"kind":"item","uid":' || :'mapid' || '}')::jsonb, 1) \g /dev/null
update player set act_started = act_started - interval '300 seconds', act_ends = act_ends - interval '300 seconds'
  where uid = :'dane' \g /dev/null
select settle(:'world3', :'dane') \g /dev/null
select '794. the spade goes through rotten board: '
     || (select count(*) from item where world_id = :'world3' and holder = 'ground' and gx = :'hx' and gy = :'hy')
     || ' things lying where they fell ('
     || (select string_agg(distinct def, ', ' order by def) from item
          where world_id = :'world3' and holder = 'ground' and gx = :'hx' and gy = :'hy')
     || '), ' || (select count(*) from creature where world_id = :'world3' and species = 'dragon')
     || ' dragon over them, and the map itself '
     || (select case when count(*) = 0 then 'gone from the pack, and the row with it: '
                     || (select count(*) from treasure where item_id = :'mapid') || ' left'
                else 'STILL IN THE PACK' end
         from item where id = :'mapid');

/*
 * And the rule that has to hold twice: a map drawn on open country that
 * somebody settles afterwards. Refusing the dig would leave a dead map in a
 * pack; refusing the settlement would need the island to explain itself
 * without giving the spot away. So the hoard moves, and nobody notices,
 * because nobody ever had a coordinate to notice leaving.
 */
select bury_treasure(:'world3', :'dane', 30, 32, 32) as map2 \gset
select t.x as wasx, t.y as wasy from treasure t where t.item_id = :'map2' \gset
do $$
declare v_t treasure;
begin
  select * into v_t from treasure where item_id = (select max(item_id) from treasure);
  insert into deed (world_id, name, x, y, radius, founded_by)
  values (v_t.world_id, 'Latecomer', v_t.x, v_t.y, 5, '44444444-4444-4444-4444-444444444444');
end $$;
select '795. a stake goes in over a buried hoard at ' || :'wasx' || ',' || :'wasy' || ': it is now at '
     || (select t.x || ',' || t.y from treasure_at(:'map2') t)
     || ', which is off the deed (' || (select not exists (select 1 from deed_covering(:'world3', t.x, t.y)) from treasure_at(:'map2') t)
     || ') — the map lives, the settlement stands, and the only thing that moved was a row nobody can read';

/*
 * What a map is worth, and what is over it. Both sides of the ladder read
 * `treasure_def`, which is crossed from `TREASURE_TIERS`.
 */
select '796. what a map is worth: ' || string_agg(
         t.id || ' from QL ' || round(t.min_ql::numeric, 0) || ' — ' || t.guards || ' ' || t.guard
         || ', ' || t.lumps || ' lump' || case when t.lumps = 1 then '' else 's' end
         || ' and ' || t.things || ' thing' || case when t.things = 1 then '' else 's' end,
         '; ' order by t.ord)
from treasure_def t;

select '797. and what a body is worth carrying one: ' || string_agg(
         s.name || ' 1 in ' || round((1 / map_chance_beast(s.health))::numeric, 0)
         || ' at about QL ' || round((12 + s.health / 8)::numeric, 0), ', ' order by s.health)
     || ' — and nothing you could have tamed drops one at all, which is '
     || (select count(*) from species_def where not monster) || ' of the ' || (select count(*) from species_def)
from species_def s where s.monster;


\echo ''
\echo '--- while the island is nearly empty'
/*
 * Reported from the island: *"player names on map / easier visibility of other
 * players would be welcome while the population is low, even if it's something
 * that's later removed"*. It removes itself.
 */
-- Three more ashore, which is the island this rule was asked for.
do $$
declare i int; u uuid;
begin
  for i in 1..3 loop
    u := ('55555555-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid;
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, false);
    perform rpc_join((select id from world where name = 'Hoarding'), 'Crowd' || i);
  end loop;
end $$;
select '799. four people on a 64-tile island: the island is quiet (' || folk_seen(:'world3')
     || '), and of the people ashore he is told '
     || (select count(*) filter (where f->>'x' is not null) || ' of ' || count(*)
         from jsonb_array_elements(folk_ashore(:'world3', :'dane')) f)
     || ' with whereabouts on them';

-- And the same list, through both doors that hand it out.
select set_config('request.jwt.claims', json_build_object('sub', :'dane')::text, false) \g /dev/null
select '800. which is what both doors say: rpc_social here '
     || (select jsonb_array_length(rpc_social(:'world3')->'here')) || ' with open '
     || (rpc_social(:'world3')->>'open') || ' at ' || (rpc_social(:'world3')->>'crowd')
     || ', and the slow half of rpc_ground folk '
     || (select jsonb_array_length(rpc_ground(:'world3', 40, true)->'folk'))
     || ' — one rule, read twice, so neither can drift open while the other closes';

-- Now fill it up.
do $$
declare i int; u uuid;
begin
  for i in 4..24 loop
    u := ('55555555-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid;
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, false);
    perform rpc_join((select id from world where name = 'Hoarding'), 'Crowd' || i);
  end loop;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', :'dane')::text, false) \g /dev/null
select '801. and with ' || (select count(*) from player where world_id = :'world3')
     || ' ashore, which is past the ' || crowd_hides()::int || ' the rule is written at: quiet ('
     || folk_seen(:'world3') || '), and of the people ashore he is now told '
     || (select count(*) filter (where f->>'x' is not null) || ' of ' || count(*)
         from jsonb_array_elements(folk_ashore(:'world3', :'dane')) f)
     || ' with whereabouts — nobody deployed anything, the island simply filled up';


\echo ''
\echo '--- a fire where you want one'
/*
 * Two braziers, the same fuel in each, built by two different masons. Time is
 * moved by winding `since` back rather than by waiting, which is how every
 * other clock in this suite is read.
 */
do $$
declare w uuid;
begin
  select id into w from world where name = 'Hoarding';
  insert into placed (world_id, kind, sub, x, y, cx, cy, ql, fuel, lit, since)
  values (w, 'furniture', 'brazier', 4, 4, 4.5, 4.5, 8,  3600, true, now() - interval '20 minutes'),
         (w, 'furniture', 'brazier', 6, 4, 6.5, 4.5, 95, 3600, true, now() - interval '20 minutes'),
         (w, 'furniture', 'oven',    8, 4, 8.5, 4.5, 8,  3600, true, now() - interval '20 minutes');
end $$;
select '803. twenty minutes alight, an hour of fuel in each: '
     || string_agg(
          coalesce(fd.name, p.sub) || ' QL ' || round(p.ql::numeric, 0)
          || ' burns ' || round(placed_burn_rate(p)::numeric, 2) || ' a second, '
          || round(placed_fuel(p)::numeric / 60, 0) || 'm left of '
          || round((placed_fuel(p) / placed_burn_rate(p))::numeric / 60, 0) || 'm burning',
          '; ' order by p.ql)
from placed p left join furniture_def fd on fd.id = p.sub
where p.world_id = :'world3' and p.kind = 'furniture';

select '804. and the ashes follow the fuel rather than the clock: '
     || string_agg(coalesce(fd.name, p.sub) || ' QL ' || round(p.ql::numeric, 0)
          || ' ' || round(placed_ash(p)::numeric, 1), ', ' order by p.ql)
     || ' — a rough one has burned more, so it has more of them'
from placed p left join furniture_def fd on fd.id = p.sub
where p.world_id = :'world3' and p.kind = 'furniture';

-- And the night, which is the whole reason a brazier is not an oven.
do $$
declare w uuid;
begin
  select id into w from world where name = 'Hoarding';
  update placed set lit = false, fuel = 3600, since = now() where world_id = w and kind = 'furniture';
  -- Wind the world to the small hours, and then to noon.
  update world set epoch = now() - make_interval(secs => (day_seconds() * 0.05)::int) where id = w;
end $$;
/*
 * Its own statement, and then the report. Folding a mutation into the select
 * that reports on it reads the snapshot from before it ran — which is what
 * this file's own preamble says, and this measurement came back blank the
 * first time for exactly that reason.
 */
select brazier_sweep(:'world3') as lit1 \gset
select '805. at ' || round(hour_of_day(:'world3')::numeric, 1) || ' o''clock (night ' || is_night(:'world3')
     || ') the heartbeat lights ' || :'lit1' || ' of them, and what is burning is '
     || coalesce((select string_agg(coalesce(fd.name, p.sub), ', ' order by p.sub) from placed p
          left join furniture_def fd on fd.id = p.sub
          where p.world_id = :'world3' and p.lit), 'nothing')
     || ' — the oven is not in that list, and an oven that lit itself every night is an oven nobody could keep fuel in';

do $$
declare w uuid;
begin
  select id into w from world where name = 'Hoarding';
  update world set epoch = now() - make_interval(secs => (day_seconds() * 0.5)::int) where id = w;
end $$;
-- The braziers burn for a while before dawn comes, so there is something to
-- carry forward rather than a full hour going back into an hour.
update placed set since = now() - interval '25 minutes'
  where world_id = :'world3' and sub = 'brazier' and lit \g /dev/null
select brazier_sweep(:'world3') as out1 \gset
select '806. and at ' || round(hour_of_day(:'world3')::numeric, 1) || ' o''clock (night ' || is_night(:'world3')
     || ') it rakes out ' || :'out1' || ', with what each burned taken off what it was carrying: '
     || (select string_agg(round(p.fuel::numeric / 60, 0) || 'm', ', ' order by p.ql) from placed p
          where p.world_id = :'world3' and p.sub = 'brazier')
     || ' left, carried forward rather than started again';


\echo ''
\echo '--- another onion will do'
/*
 * Reported with a screenshot: *"when you queue eat, the next 2 queues try to
 * eat the same food"*. They did: a queued job carries the row id it was asked
 * with, and eating the last of a stack deletes the row.
 */
\set eater '77777777-7777-7777-7777-777777777777'
select set_config('request.jwt.claims', json_build_object('sub', :'eater')::text, false) \g /dev/null
select rpc_join(:'world3', 'Hunger') \g /dev/null
update player set stats = jsonb_set(stats, '{stamina}', '1'), body_at = now() where uid = :'eater' \g /dev/null
delete from event where uid = :'eater' \g /dev/null
-- Three onions in one row, the way a pack holds them, and three eats asked for.
insert into item (world_id, holder, holder_uid, def, ql, count)
values (:'world3', 'player', :'eater', 'onion', 30, 2);
insert into item (world_id, holder, holder_uid, def, ql, count)
values (:'world3', 'player', :'eater', 'onion', 30, 1);
select min(id) as firstonion from item where holder_uid = :'eater' and def = 'onion' \gset
select rpc_act(:'world3', 'eat', ('{"kind":"item","uid":' || :'firstonion' || '}')::jsonb, 1) \g /dev/null
select rpc_act(:'world3', 'eat', ('{"kind":"item","uid":' || :'firstonion' || '}')::jsonb, 1) \g /dev/null
select rpc_act(:'world3', 'eat', ('{"kind":"item","uid":' || :'firstonion' || '}')::jsonb, 1) \g /dev/null
do $$
declare i int;
begin
  for i in 1..6 loop
    update player set act_started = act_started - interval '60 seconds',
                      act_ends = act_ends - interval '60 seconds'
      where uid = '77777777-7777-7777-7777-777777777777';
    perform settle((select id from world where name = 'Hoarding'),
                   '77777777-7777-7777-7777-777777777777');
  end loop;
end $$;
select '808. three eats queued at one row of two onions, with a third onion in another row: '
     || (select count(*) from event where uid = :'eater' and text like 'You eat%')
     || ' eaten, ' || (select count(*) from event where uid = :'eater' and kind = 'error')
     || ' refused, and ' || coalesce((select sum(count)::text from item where holder_uid = :'eater' and def = 'onion'), '0')
     || ' left — the second and third jobs were pointed at a row that had been eaten, and another onion did';

-- And with nothing left to point at, the refusal stands and says what it said.
select rpc_act(:'world3', 'eat', ('{"kind":"item","uid":' || :'firstonion' || '}')::jsonb, 1) as gone \gset
select '809. and asking again with the pack empty: ' || coalesce((:'gone'::jsonb)->>'why', 'ALLOWED')
     || ' — nothing is invented, and a job with nothing to do still says so in its own words';


\echo ''
\echo '--- packing is a paver''s job'
/*
 * The gain and the sentence about the gain, off the same column. Read as a
 * pair, because the fault this guards against is not "packing trains the
 * wrong skill" — it is the two of them disagreeing, which is what naming the
 * skill in `perform_terrain` and reading `d.skill` in `skill_said` would have
 * produced the moment the column changed.
 */
select '811. what each job on the ground trains, off `action_def` and nowhere else: '
     || string_agg(a.id || ' → ' || a.skill, ', ' order by a.skill, a.id)
from action_def a
where a.id in ('mine', 'chip_corner', 'pack', 'cultivate', 'pave_gravel', 'pave_cobble', 'drop_dirt_here');

do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; i int;
begin
  select id into w from world where name = 'Hoarding';
  delete from event where uid = me;
  delete from skill where world_id = w and uid = me and id in ('paving', 'digging');
  update player set x = 20.5, y = 20.5, stats = jsonb_set(stats, '{stamina}', '1'), body_at = now()
    where world_id = w and uid = me;
  perform land_set_tile(w, 20, 20, 1);
  insert into item (world_id, holder, holder_uid, def, ql, count)
  values (w, 'player', me, 'shovel', 40, 1);
  perform act_perform(w, me, 'pack', '{"kind":"tile","x":20,"y":20,"cx":20,"cy":20}'::jsonb);
end $$;
select '812. and one go at packing: paving '
     || coalesce((select round(value::numeric, 4)::text from skill
                   where world_id = :'world3' and uid = '77777777-7777-7777-7777-777777777777'
                     and id = 'paving'), 'untouched')
     || ', digging ' || coalesce((select round(value::numeric, 4)::text from skill
                   where world_id = :'world3' and uid = '77777777-7777-7777-7777-777777777777'
                     and id = 'digging'), 'untouched')
     || ' — and the island said: '
     || coalesce((select string_agg(text, ' | ' order by n) from event
                   where uid = '77777777-7777-7777-7777-777777777777' and kind in ('event', 'skill')), 'nothing');


\echo ''
\echo '--- the ground answers for itself'
/*
 * A clay bank at the waterline, dug and flattened, and a penned wildermon
 * beside a crate of the thing it eats.
 */
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; i int; j int;
begin
  select id into w from world where name = 'Hoarding';
  delete from event where uid = me;
  delete from skill where world_id = w and uid = me and id = 'digging';
  -- A patch of clay, standing four above the water and eight under it.
  for j in 24..27 loop
    for i in 24..27 loop
      perform land_set_tile(w, i, j, tile_id('Clay'));
      perform land_set_height(w, i, j, 4);
      perform land_set_dirt(w, i, j, 20);
    end loop;
  end loop;
  perform land_set_height(w, 26, 26, -8);
  update player set x = 24.5, y = 24.5, stats = jsonb_set(stats, '{stamina}', '1'), body_at = now()
    where world_id = w and uid = me;
  -- A few goes, because a beginner with a shovel fails most of them.
  for i in 1..12 loop
    perform act_perform(w, me, 'dig', '{"kind":"tile","x":24,"y":24,"cx":24,"cy":24}'::jsonb);
  end loop;
end $$;
select '814. digging a clay bank: ' ||
       coalesce((select string_agg(i.def || ' ×' || i.count, ', ') from item i
                  where i.holder_uid = '77777777-7777-7777-7777-777777777777'
                    and i.def in ('clay', 'dirt', 'sand')), 'nothing')
     || ' — `tile_def.dig_yield` says clay and the dig branch has always read it';

-- Flattening the same bank, which read `dirt` whatever it was scraping.
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; i int;
begin
  select id into w from world where name = 'Hoarding';
  -- All four corners above the ground the body stands on, so there is only a
  -- high corner to take down — which is the branch that hands you the spoil.
  perform land_set_height(w, 25, 25, 9);
  perform land_set_height(w, 26, 25, 9);
  perform land_set_height(w, 26, 26, 9);
  perform land_set_height(w, 25, 26, 9);
  for i in 1..4 loop
    perform act_perform(w, me, 'flatten', '{"kind":"tile","x":25,"y":25}'::jsonb);
  end loop;
end $$;
select '815. and flattening it: ' ||
       coalesce((select string_agg(i.def || ' ×' || i.count, ', ' order by i.def) from item i
                  where i.holder_uid = '77777777-7777-7777-7777-777777777777'
                    and i.def in ('clay', 'dirt', 'sand')), 'nothing')
     || ', digging now ' || coalesce((select round(value::numeric, 3)::text from skill
          where uid = '77777777-7777-7777-7777-777777777777' and id = 'digging'), 'untouched')
     || ' — an hour of levelling ground used to teach nothing and hand back dirt';

-- The waterline, on both of them.
update player set x = 26.5, y = 26.5 where uid = '77777777-7777-7777-7777-777777777777' \g /dev/null
select coalesce(act_refusal(:'world3', '77777777-7777-7777-7777-777777777777', 'dig',
          '{"kind":"tile","x":26,"y":26,"cx":26,"cy":26}'::jsonb), 'allowed') as shallowdig \gset
select coalesce(ground_refusal(:'world3', '77777777-7777-7777-7777-777777777777', 'flatten',
          '{"kind":"tile","x":26,"y":26}'::jsonb), 'allowed') as shallowflat \gset
select land_set_height(:'world3', 26, 26, -20) \g /dev/null
select coalesce(act_refusal(:'world3', '77777777-7777-7777-7777-777777777777', 'dig',
          '{"kind":"tile","x":26,"y":26,"cx":26,"cy":26}'::jsonb), 'allowed') as deepdig \gset
select '816. eight feet under, where a pick may still work: dig ' || :'shallowdig'
     || ', flatten ' || :'shallowflat'
     || ' — and at twenty under: dig ' || :'deepdig';

-- And the penned animal beside its dinner.
do $$
declare w uuid; v_deed deed; v_id int;
begin
  select id into w from world where name = 'Hoarding';
  select * into v_deed from deed where world_id = w limit 1;
  insert into crate (world_id, id, kind, x, y)
  values (w, 9001, 'plank', v_deed.x, v_deed.y);
  insert into item (world_id, holder, crate, def, ql, count)
  values (w, 'crate', 9001, 'potato', 40, 1), (w, 'crate', 9001, 'potato', 8, 4);
  v_id := creature_spawn(w, 'rabba', v_deed.x + 0.5, v_deed.y + 0.5, 'deed');
  update creature set hunger = 0.1 where world_id = w and id = v_id;
end $$;
select id as penned from creature where world_id = :'world3' and species = 'rabba' order by id desc limit 1 \gset
select coalesce(worker_feed(:'world3', :'penned'), 'nothing') as ate \gset
select '817. a rabba penned on a deed at hunger 0.1, with potatoes in the crate: it ate ' || :'ate'
     || ', belly now ' || (select round(hunger::numeric, 2) from creature where id = :'penned' and world_id = :'world3')
     || ', and what is left in the crate: '
     || (select string_agg(def || ' ×' || count || ' at QL ' || round(ql::numeric, 0), ', ' order by ql)
          from item where crate = 9001 and world_id = :'world3')
     || ' — the plainest first, because the good stuff keeps for people';


\echo ''
\echo '--- a coal seam is a seam'
/*
 * Reported from the island: *"I can't seem to find any Coal ore tiles on the
 * crescent island."* They were there all along. `ore` is `yields` ending in
 * `_ore`, coal yields plain `coal`, and every rule that goes looking for
 * something worth mining asked `ore`.
 */
select '819. what the two columns say now: ' || string_agg(
         r.name || ' ' || case when r.ore then 'metal' when r.seam then 'a seam, not metal' else 'stone' end,
         ', ' order by r.id)
from rock_def r where r.id in (0, 2, 4, 5, 15);

do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; i int; j int;
begin
  select id into w from world where name = 'Hoarding';
  delete from event where uid = me;
  -- A hillside of bare rock with a coal seam under three tiles of it.
  for j in 30..32 loop
    for i in 30..32 loop
      perform land_set_tile(w, i, j, tile_id('Rock'));
      perform land_set_height(w, i, j, 20);
      perform land_set_dirt(w, i, j, 0);
      -- The rock under a tile is its own byte, not the `data` byte — and
      -- `land_set_rock` is one of the rules this island keeps and never runs,
      -- which is how a test came to set the wrong one.
      perform land_set_rock(w, i, j, 5);
    end loop;
  end loop;
  update player set x = 31.5, y = 31.5 where world_id = w and uid = me;
  insert into item (world_id, holder, holder_uid, def, ql, count)
  values (w, 'player', me, 'pickaxe', 40, 1);
  perform act_perform(w, me, 'prospect', '{"kind":"tile","x":31,"y":31}'::jsonb);
end $$;
select '820. prospecting a coal hillside: ' ||
       (select string_agg(text, ' | ' order by n) from event
         where uid = '77777777-7777-7777-7777-777777777777' and kind = 'event')
     || ' — it used to say there was no sign of metal, and that the seam under your feet had none in it';

select '821. and who may work it: a miner '
     || worker_gatherable(:'world3', 31, 31, 'mine',
          (select c from creature c where c.world_id = :'world3' and c.species = 'rabba' limit 1))
     || ', a quarrier '
     || worker_gatherable(:'world3', 31, 31, 'quarry',
          (select c from creature c where c.world_id = :'world3' and c.species = 'rabba' limit 1))
     || ' — a seam is a miner''s work, and it was the quarrier''s, who brought back rock shards';


\echo ''
\echo '--- a swing that missed'
/*
 * Reported from the island: *"chipping rock corner should give mining exp"*.
 * It did, on the quarter of swings that land — and its failure is a flat
 * quarter rather than a skill check, so three in four taught nothing however
 * good you got.
 *
 * Forty swings at a face with a fixed roll, so what is measured is the rule
 * and not the dice.
 */
select setseed(0.4242) \g /dev/null
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; i int;
begin
  select id into w from world where name = 'Hoarding';
  delete from event where uid = me;
  delete from skill where world_id = w and uid = me and id = 'mining';
  update player set x = 31.5, y = 31.5 where world_id = w and uid = me;
  for i in 1..40 loop
    perform land_set_height(w, 31, 31, 20);
    perform act_perform(w, me, 'chip_corner',
      '{"kind":"tile","x":31,"y":31,"cx":31,"cy":31}'::jsonb);
  end loop;
end $$;
select '823. forty swings at a coal face: '
     || (select count(*) from event where uid = '77777777-7777-7777-7777-777777777777'
          and text like 'The corner breaks%') || ' landed, '
     || (select count(*) from event where uid = '77777777-7777-7777-7777-777777777777'
          and text like '%no line in it%') || ' found no line — and mining is now '
     || coalesce((select round(value::numeric, 3)::text from skill
          where uid = '77777777-7777-7777-7777-777777777777' and id = 'mining'), 'untouched')
     || ', where the ones that missed used to teach nothing at all';

select '824. and what a miss is worth against a landing: ' || try_learn()
     || ' of a go, said by both sides off the one number — the browser paid a full go for a miss and this side paid none';

/*
 * And the sweep that would have found most of today's work without anybody
 * reporting anything: rules the island keeps and never runs.
 *
 * A report rather than a rule. Some of these are honestly unused — a tool's
 * helper, a door the browser calls and nothing down here does — so a number
 * that goes up is a question rather than a failure. It is here because "the
 * rule is written and nothing runs it" was the shape of the sleep bonus, the
 * knacks, the titles, swimming, the walking wind and everything going off.
 */
select '825. rules this island keeps and never runs: ' || count(*) || ' — ' || string_agg(proname, ', ' order by proname)
from (
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname not like 'rpc\_%'
     and not exists (select 1 from pg_depend e where e.objid = p.oid and e.deptype = 'e')
     and not exists (select 1 from pg_proc q join pg_namespace m on m.oid = q.pronamespace
                     where m.nspname = 'public' and q.oid <> p.oid and q.prosrc like '%' || p.proname || '(%')
) q;


\echo ''
\echo '--- a trait that does nothing'
/*
 * Reported from the island: *"wildermon traits are useless flair text. provide
 * the actual stats and benefits they provide."*
 *
 * The flair was half of it. The other half is that three of the things a trait
 * card promised were not applied down here at all: the `learn` channel, the
 * communal half of an aura trait, and the brush. The browser applied all three,
 * so the two sides disagreed by the whole amount.
 */
select '826. what a trait may lift, and what down here reads it: ' || count(*) || ' channels, '
     || count(*) filter (where seen) || ' read by a rule — unread: '
     || coalesce(string_agg(id, ', ' order by ord) filter (where not seen), 'none')
     || ' (fog of war is the browser''s own, so sight is applied where it is felt)'
from (
  select cd.id, cd.ord, exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and strpos(pg_get_functiondef(p.oid), 'beast_mul(c, ''' || cd.id || '''') > 0
  ) as seen from channel_def cd
) q;

-- Two workers on one deed, one of them worth standing next to.
select creature_spawn(:'world3', 'rabba', 20.5, 20.5, 'deed', now() - interval '3 hours', :'dane') as plain \gset
select creature_spawn(:'world3', 'rabba', 21.5, 20.5, 'deed', now() - interval '3 hours', :'dane') as boss \gset
update creature set traits = '{willing}', care = 0, skills = '{}'::jsonb where world_id = :'world3' and id = :'plain';
update creature set traits = '{lead_beast}', care = 0, skills = '{}'::jsonb where world_id = :'world3' and id = :'boss';
select '827. a plain worker with a lead beast on the same deed: work ×'
     || (select round(beast_mul(c, 'work')::numeric, 3) from creature c where c.world_id = :'world3' and c.id = :'plain')
     || ' — its own willing 1.08 and the lead beast''s 1.16, which nothing down here had ever lent it';
update creature set mode = 'stored' where world_id = :'world3' and id = :'boss';
select '828. and with the lead beast stabled: work ×'
     || (select round(beast_mul(c, 'work')::numeric, 3) from creature c where c.world_id = :'world3' and c.id = :'plain')
     || ' — its own blood and nothing else, which is what it was worth either way before today';
update creature set mode = 'deed' where world_id = :'world3' and id = :'boss';

update creature set care = 1 where world_id = :'world3' and id = :'plain';
select '829. brushed to a shine: work ×'
     || (select round(beast_mul(c, 'work')::numeric, 3) from creature c where c.world_id = :'world3' and c.id = :'plain')
     || ', learning ×' || (select round(beast_mul(c, 'learn')::numeric, 3) from creature c where c.world_id = :'world3' and c.id = :'plain')
     || ', speed ×' || (select round(beast_mul(c, 'speed')::numeric, 3) from creature c where c.world_id = :'world3' and c.id = :'plain')
     || ' — the card has claimed the brush since the Care bar was drawn and no rule read it';

/*
 * And what it is worth to be clever. The same base, the same draw — the seed is
 * set again between them — and the only difference is the blood.
 */
update creature set traits = '{quick_witted}', care = 0, skills = '{}'::jsonb where world_id = :'world3' and id = :'plain';
update creature set traits = '{willing}', care = 0, skills = '{}'::jsonb where world_id = :'world3' and id = :'boss';
select setseed(0.5) \g /dev/null
select worker_learn(:'world3', :'plain', 'foraging', 1.0) as quick \gset
select setseed(0.5) \g /dev/null
select worker_learn(:'world3', :'boss', 'foraging', 1.0) as slow \gset
select '830. one go at the same job, quick-witted against plain: '
     || round(:'quick'::numeric, 4) || ' against ' || round(:'slow'::numeric, 4)
     || ' — ' || round((:'quick'::numeric / nullif(:'slow'::numeric, 0)), 2)
     || '× the learning, where this side used to teach both of them the same';

/*
 * And the island's own examine line, which named the traits and stopped. It
 * takes a breeder's eye to read a supreme trait at all, so Dane is given one:
 * a figure you cannot earn is a figure you should not be shown either.
 */
update creature set traits = '{quick_witted,thrifty,scrappy}', care = 1
  where world_id = :'world3' and id = :'plain';
insert into skill (world_id, uid, id, value) values (:'world3', :'dane', 'animal_husbandry', 60)
  on conflict (world_id, uid, id) do update set value = 60;
select '831. and what the blood reads as: '
     || blood_read(:'world3', :'dane', (select c from creature c where c.world_id = :'world3' and c.id = :'plain'))
     || ' — it used to name the three of them and stop there';


\echo ''
\echo '--- a go that did not come off'
/*
 * From the island: *"review all actions to give experience even on fail, just
 * less."* Twenty-three places, wrong in three directions: eight that taught
 * nothing on a failure, eight that taught exactly what a success taught
 * because the gain was written above the roll, and three that had the right
 * idea and wrote the fraction out a second time.
 */
select '832. what a go is worth, landed against missed: ' || try_gain(true) || ' against ' || try_gain(false)
     || ' — and the trades that had their own opinion about it: '
     || 'smithing ' || round(try_gain(true, smith_gain())::numeric, 2) || '/' || round(try_gain(false, smith_gain())::numeric, 3)
     || ', brewing ' || round(try_gain(true, brew_gain())::numeric, 2) || '/' || round(try_gain(false, brew_gain())::numeric, 3)
     || ', taming ' || round(try_gain(true, tame_gain())::numeric, 2) || '/' || round(try_gain(false, tame_gain())::numeric, 3)
     || ' — which used to be a hand-written half in all three';

select '833. and the bases they are taken from, crossed off the browser rather than written twice: '
     || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prokind = 'f'
            and p.proname in ('craft_head','smith_gain','brew_gain','improve_gain','restore_gain','free_gain',
                              'bandage_gain','clean_gain','tame_gain','tame_nerve','swing_fight','swing_arm',
                              'swing_body','shot_fight','shot_archery','rod_gain','net_gain','breed_gain'))
     || ' of 18, and ' || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
          lateral regexp_matches(pg_get_functiondef(p.oid), 'try_gain\(', 'g') m
          where n.nspname = 'public' and p.prokind = 'f') || ' rules that ask the one question';

/*
 * And the two headline shapes, measured. A hatchet that glances off taught
 * nothing at all; a swing that misses taught exactly what a landed one did.
 */
select setseed(0.3131) \g /dev/null
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; i int;
begin
  select id into w from world where name = 'Hoarding';
  delete from event where uid = me;
  delete from skill where world_id = w and uid = me and id in ('woodcutting', 'fighting');
  for i in 24..26 loop
    perform land_set_tile(w, i, 24, tile_id('Tree'));
    perform land_set_height(w, i, 24, 4);
  end loop;
  update player set x = 25.5, y = 24.5 where world_id = w and uid = me;
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', me, 'hatchet', 5, 1);
  for i in 1..12 loop
    perform land_set_tile(w, 25, 24, tile_id('Tree'));
    perform act_perform(w, me, 'cut_down', '{"kind":"tile","x":25,"y":24}'::jsonb);
  end loop;
end $$;
select '834. twelve goes at a tree with a quality-5 hatchet: '
     || (select count(*) from event where uid = '77777777-7777-7777-7777-777777777777'
          and text like '%glances off%') || ' glanced off, and woodcutting is '
     || coalesce((select round(value::numeric, 3)::text from skill
          where uid = '77777777-7777-7777-7777-777777777777' and id = 'woodcutting'), 'untouched')
     || ' — a hatchet that found no headway used to teach nothing at all';

select setseed(0.7171) \g /dev/null
select creature_spawn(:'world3', 'rabba', 25.5, 25.5, 'wild', now() - interval '2 hours') as sparring \gset
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; i int; cid int;
begin
  select id into w from world where name = 'Hoarding';
  delete from event where uid = me;
  select id into cid from creature where world_id = w and species = 'rabba' order by id desc limit 1;
  for i in 1..20 loop
    update creature set health = 400 where world_id = w and id = cid;
    perform act_perform(w, me, 'attack_creature', ('{"kind":"creature","id":' || cid || '}')::jsonb);
  end loop;
end $$;
select '835. twenty swings at a rabba: '
     || (select count(*) from event where uid = '77777777-7777-7777-7777-777777777777' and text like '%and miss.') || ' missed, '
     || (select count(*) from event where uid = '77777777-7777-7777-7777-777777777777' and text like 'You strike%') || ' landed'
     || ' — and fighting is ' || coalesce((select round(value::numeric, 3)::text from skill
          where uid = '77777777-7777-7777-7777-777777777777' and id = 'fighting'), 'untouched')
     || ', where a miss used to pay exactly what a landed blow paid';


\echo ''
\echo '--- craft all, all of it'
/*
 * Reported from the island: *"craft all still only does a single action"*.
 *
 * Nothing down here was wrong. `rpc_act` has always taken `p_times` and kept
 * it in `act_goes`, and the window was sending its number the other way — tied
 * *inside the target* as `count`, which is what a stack-mover uses ("how many
 * of this pile") and which `perform_craft` does not read at all. So the island
 * was asked for one craft with a meaningless 19 attached, and made one.
 *
 * Measured here because it is the half that has to keep working: the browser
 * can only be believed about `p_times` if `p_times` does what it says.
 */
select id as world4 from world where name = 'Hoarding' \gset
select set_config('request.jwt.claims', json_build_object('sub', '77777777-7777-7777-7777-777777777777')::text, false) \g /dev/null
delete from item where world_id = :'world4' and holder_uid = '77777777-7777-7777-7777-777777777777'
  and def in ('clay', 'sand', 'mortar');
insert into item (world_id, holder, holder_uid, def, ql, count) values
  (:'world4', 'player', '77777777-7777-7777-7777-777777777777', 'clay', 30, 25),
  (:'world4', 'player', '77777777-7777-7777-7777-777777777777', 'sand', 30, 25);
update player set act = null, act_queue = '[]'::jsonb, seen_at = now(),
    stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1')
  where world_id = :'world4' and uid = '77777777-7777-7777-7777-777777777777' \g /dev/null
select id as clay from item where world_id = :'world4'
  and holder_uid = '77777777-7777-7777-7777-777777777777' and def = 'clay' limit 1 \gset

-- The ask the window used to make: the number inside the target, one go asked for.
select rpc_act(:'world4', 'make_mortar', ('{"kind":"item","uid":' || :'clay' || ',"count":19}')::jsonb, 1) \g /dev/null
select '836. nineteen tied inside the target, which is how the window used to ask: the island kept '
     || coalesce((select act_goes::text from player where world_id = :'world4'
                   and uid = '77777777-7777-7777-7777-777777777777'), 'nothing')
     || ' go — a craft never read `count`, and a stack-mover is the only thing that does';
update player set act = null, act_queue = '[]'::jsonb where world_id = :'world4'
  and uid = '77777777-7777-7777-7777-777777777777' \g /dev/null

-- And the ask it makes now: the number where `rpc_act` looks for it.
select rpc_act(:'world4', 'make_mortar', ('{"kind":"item","uid":' || :'clay' || '}')::jsonb, 19) \g /dev/null
select '837. and asked as p_times: the island kept '
     || coalesce((select act_goes::text from player where world_id = :'world4'
                   and uid = '77777777-7777-7777-7777-777777777777'), 'nothing') || ' goes';
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; i int;
begin
  select id into w from world where name = 'Hoarding';
  for i in 1..40 loop
    update player set act_ends = now() - interval '1 second',
        stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1')
      where world_id = w and uid = me;
    perform settle(w, me);
    exit when (select act from player where world_id = w and uid = me) is null;
  end loop;
end $$;
select '838. and when the clock caught up: '
     || coalesce((select sum(count)::text from item where world_id = :'world4'
                   and holder_uid = '77777777-7777-7777-7777-777777777777' and def = 'mortar'), '0')
     || ' mortar off nineteen goes at two a go, and the clay is down to '
     || coalesce((select sum(count)::text from item where world_id = :'world4'
                   and holder_uid = '77777777-7777-7777-7777-777777777777' and def = 'clay'), '0')
     || ' of 25, with nothing left in hand: '
     || (select (act is null)::text from player where world_id = :'world4' and uid = '77777777-7777-7777-7777-777777777777');


\echo ''
\echo '--- a bed is not soil'
/*
 * Reported from the island: *"dropping dirt on sand or clay tiles converts them
 * to dirt tiles."* It did — and the step before it, which nobody saw, was worse:
 * a bed worked down to its last spadeful went to bare rock, and `reconcile`
 * knows exactly one thing to lay back down over rock.
 */
select id as world5 from world where name = 'Hoarding' \gset
select set_config('request.jwt.claims', json_build_object('sub', '77777777-7777-7777-7777-777777777777')::text, false) \g /dev/null
do $$
declare w uuid; i int; j int;
begin
  select id into w from world where name = 'Hoarding';
  -- One tile of each of the four beds, with a single spadeful left on them.
  for j in 44..47 loop for i in 44..47 loop
    perform land_set_height(w, i, j, 6);
    perform land_set_dirt(w, i, j, 1);
  end loop; end loop;
  perform land_set_tile(w, 44, 44, tile_id('Clay'));
  perform land_set_tile(w, 45, 44, tile_id('Sand'));
  perform land_set_tile(w, 44, 45, tile_id('Peat'));
  perform land_set_tile(w, 45, 45, tile_id('Tar'));
end $$;
select '839. four beds with one spadeful left on each: ' || string_agg(
         (select name from tile_def t where t.id = land_tile(:'world5', q.x, q.y)), ', ' order by q.x, q.y)
from (values (44,44),(45,44),(44,45),(45,45)) q(x, y);

-- Dug out to the bedrock, which is what working a pit comes to in the end.
do $$
declare w uuid; i int; j int;
begin
  select id into w from world where name = 'Hoarding';
  for j in 44..46 loop for i in 44..46 loop perform land_set_dirt(w, i, j, 0); end loop; end loop;
  for j in 44..46 loop for i in 44..46 loop perform reconcile_around(w, i, j); end loop; end loop;
end $$;
select '840. and dug out to the rock: ' || string_agg(
         (select name from tile_def t where t.id = land_tile(:'world5', q.x, q.y)), ', ' order by q.x, q.y)
     || ' — every one of them used to read Rock here'
from (values (44,44),(45,44),(44,45),(45,45)) q(x, y);

-- And a spadeful of dirt put back on the corner they share.
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777';
begin
  select id into w from world where name = 'Hoarding';
  update player set x = 44.4, y = 44.4, act = null, act_queue = '[]'::jsonb, seen_at = now(),
      stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1') where world_id = w and uid = me;
  delete from item where world_id = w and holder_uid = me and def = 'dirt';
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', me, 'dirt', 20, 5);
  perform perform_terrain(w, me, 'drop_dirt_here', '{"kind":"item"}'::jsonb);
end $$;
select '841. and a spadeful of dirt put back on them: ' || string_agg(
         (select name from tile_def t where t.id = land_tile(:'world5', q.x, q.y)), ', ' order by q.x, q.y)
     || ' — the three nobody was standing on are untouched, which is the rule this'
     || ' measures. The first is the tile under the shovel, and a spadeful buries'
     || ' what it lands on: that is 862, and it is a person doing it rather than'
     || ' the ground doing it to them.'
from (values (44,44),(45,44),(44,45),(45,45)) q(x, y);

-- And the thing the rule is for, which still has to work: grass over bedrock.
do $$
declare w uuid;
begin
  select id into w from world where name = 'Hoarding';
  perform land_set_tile(w, 48, 48, tile_id('Grass'));
  perform land_set_height(w, 48, 48, 6);
  perform land_set_dirt(w, 48, 48, 0); perform land_set_dirt(w, 49, 48, 0);
  perform land_set_dirt(w, 49, 49, 0); perform land_set_dirt(w, 48, 49, 0);
  perform reconcile(w, 48, 48);
end $$;
select '842. and grass with nothing left under it is still stripped: '
     || (select name from tile_def t where t.id = land_tile(:'world5', 48, 48));
do $$
declare w uuid;
begin
  select id into w from world where name = 'Hoarding';
  perform land_set_dirt(w, 48, 48, 1);
  perform reconcile(w, 48, 48);
end $$;
select '843. and comes back as dirt when the soil does: '
     || (select name from tile_def t where t.id = land_tile(:'world5', 48, 48))
     || ' — which is the rule this one is for, and it is untouched';


\echo ''
\echo '--- a tree comes down in strokes'
/*
 * Asked from the island: a sapling is one stroke and no timber, a young tree
 * two strokes and two logs, a mature one three and four, an old one three and
 * three. Felling used to be one swing and a species — a birch a log, a pine
 * two — so a tree you could step over came down for the same stroke as one the
 * size of a house.
 */
select '844. what each age is worth: ' || string_agg(
         lower(name) || ' ' || hits || case when hits = 1 then ' stroke, ' else ' strokes, ' end
         || case when logs = 0 then 'no timber' else logs || ' logs' end, '; ' order by hits, logs)
from tree_age_def;

select id as world6 from world where name = 'Hoarding' \gset
select set_config('request.jwt.claims', json_build_object('sub', '77777777-7777-7777-7777-777777777777')::text, false) \g /dev/null

-- One tree of each age, an oak apiece, and a hatchet good enough not to glance.
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; a record; v_x int := 50;
begin
  select id into w from world where name = 'Hoarding';
  delete from item where world_id = w and holder_uid = me and def in ('hatchet', 'log');
  delete from event where uid = me;
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', me, 'hatchet', 90, 1);
  update player set x = 50.5, y = 49.5, act = null, act_queue = '[]'::jsonb, seen_at = now(),
      stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1') where world_id = w and uid = me;
  update skill set value = 90 where world_id = w and uid = me and id = 'woodcutting';
  insert into skill (world_id, uid, id, value) values (w, me, 'woodcutting', 90)
    on conflict (world_id, uid, id) do update set value = 90;
  for a in select * from tree_age_def order by hits, logs loop
    perform land_set_tile(w, v_x, 50, tile_id('Tree'));
    perform land_set_height(w, v_x, 50, 4);
    -- Species 2 is oak; the age goes in the two bits over it.
    perform land_set_data(w, v_x, 50, 2 | (a.id << 4));
    v_x := v_x + 1;
  end loop;
end $$;

do $$
-- `x` is a column on `player` as well as a loop variable, and inside an
-- `update player` the column wins. The suite has been bitten by this before.
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; v_x int; i int;
begin
  select id into w from world where name = 'Hoarding';
  for v_x in 50..56 loop
    update player set x = v_x + 0.5, y = 49.5 where world_id = w and uid = me;
    -- Six swings at each, which is two more than the worst of them needs and
    -- room for a stroke to glance, and stopping the moment there is nothing
    -- standing there — which is what `act_refusal` does for a real swing and
    -- this loop has to do for itself.
    for i in 1..6 loop
      exit when land_tile(w, v_x, 50) <> tile_id('Tree');
      perform act_perform(w, me, 'cut_down', ('{"kind":"tile","x":' || v_x || ',"y":50}')::jsonb);
    end loop;
  end loop;
end $$;
select '845. six swings at one tree of each age, the smallest first: '
     || (select string_agg(text, ' | ' order by n) from event
          where uid = '77777777-7777-7777-7777-777777777777'
            and (text like '%cut into%' or text like '%comes down%' or text like '%no timber%'));
select '846. and the timber off the seven of them: '
     || coalesce((select sum(count)::text from item where world_id = :'world6'
                   and holder_uid = '77777777-7777-7777-7777-777777777777' and def = 'log'), '0')
     || ' logs — the sapling and the clipped shrub gave none of it, and every one of the seven stands where it stood'
     || ' until the last stroke lands';
select '847. and the ground they stood on, a stump wherever there was timber: ' || string_agg(
         (select name from tile_def t where t.id = land_tile(:'world6', q.x, 50)), ', ' order by q.x)
from (values (50),(51),(52),(53),(54),(55),(56)) q(x);

-- A notch is the tile's, not the woodcutter's.
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777';
begin
  select id into w from world where name = 'Hoarding';
  delete from event where uid = me;
  perform land_set_tile(w, 55, 50, tile_id('Tree'));
  perform land_set_height(w, 55, 50, 4);
  perform land_set_data(w, 55, 50, 2 | (1 << 4));   -- a mature oak
  update player set x = 55.5, y = 49.5 where world_id = w and uid = me;
  perform act_perform(w, me, 'cut_down', '{"kind":"tile","x":55,"y":50}'::jsonb);
end $$;
select '848. one stroke into a mature oak, and what the tile remembers: '
     || tree_cuts(:'world6', 55, 50) || ' of ' ||
        (select hits from tree_age_def where id = tree_age(land_data(:'world6', 55, 50)))
     || ' — on the tile rather than on the woodcutter, so whoever comes by next finishes it';


\echo ''
\echo '--- a wood that keeps itself'
/*
 * Asked from the island: *"trees need a life cycle. an old tree, when dying,
 * plants two saplings nearby. have each cycle last a real life day."* Nothing
 * here grew a tree from one age to the next before today: a wood was the wood
 * the generator laid down, for ever, minus whatever had been cut out of it.
 */
select '849. a tree''s life, a day a stage: ' || string_agg(
         lower(a.name) || ' → ' || coalesce(lower((select b.name from tree_age_def b where b.id = a.next)), 'gone'),
         ', ' order by case a.id when 3 then 0 else a.id + 1 end)
     || ' — and a stage is ' || (tree_stage() / 3600) || ' real hours'
from tree_age_def a;

select id as world7 from world where name = 'Hoarding' \gset
do $$
declare w uuid;
begin
  select id into w from world where name = 'Hoarding';
  -- A clearing with one oak sapling in the middle of it.
  for j in 58..62 loop for i in 58..62 loop
    perform land_set_tile(w, i, j, tile_id('Grass'));
    perform land_set_data(w, i, j, 0);
    perform land_set_height(w, i, j, 4);
  end loop; end loop;
  perform land_set_tile(w, 60, 60, tile_id('Tree'));
  perform land_set_data(w, 60, 60, 2 | (tree_first() << 4));
end $$;
select '850. an oak sapling at 60,60: ' || lower((select name from tree_age_def where id = tree_age(land_data(:'world7',60,60))));

-- A day of real time, and the island turns over once.
create or replace function pg_temp.one_day(p_world uuid) returns int
  language plpgsql as $fn$
begin
  update world set trees_at = now() - make_interval(secs => tree_stage() + 60) where id = p_world;
  return tree_day(p_world);
end $fn$;
select pg_temp.one_day(:'world7') as grew1 \gset
select '851. and a day later: ' || lower((select name from tree_age_def where id = tree_age(land_data(:'world7',60,60))))
     || ' — ' || :'grew1' || ' trees on the island turned over that day';
select pg_temp.one_day(:'world7') \g /dev/null
select pg_temp.one_day(:'world7') \g /dev/null
select lower((select name from tree_age_def where id = tree_age(land_data(:'world7',60,60)))) as day3 \gset
select pg_temp.one_day(:'world7') \g /dev/null
select lower((select name from tree_age_def where id = tree_age(land_data(:'world7',60,60)))) as day4 \gset
select pg_temp.one_day(:'world7') \g /dev/null
select '852. and two days after that: ' || :'day3' || '; a fourth: ' || :'day4'
     || ', the last a hatchet can take back; a fifth: '
     || lower((select name from tree_age_def where id = tree_age(land_data(:'world7',60,60))))
     || ', which is as far as a living tree goes';

-- The sixth day is the last one.
select pg_temp.one_day(:'world7') \g /dev/null
select '853. and on the sixth day: ' || (select name from tile_def where id = land_tile(:'world7',60,60))
     || ' where it stood — of its own kind, ' || lower((select name from tree_def where id = tree_species(land_data(:'world7',60,60))))
     || ', for a day — and ' || (select count(*) from (
          select q.gx, q.gy from (select 60 + dx as gx, 60 + dy as gy
            from generate_series(-2, 2) dx, generate_series(-2, 2) dy) q
          where land_tile(:'world7', q.gx, q.gy) = tile_id('Tree')) t)
     || ' saplings of its own kind standing within ' || tree_seed_reach() || ' tiles of the stump'
     || ' — nought to ' || tree_seeds() || ' of them, by a roll averaging '
     || round((1 + tree_seed_both() - tree_seed_none())::numeric, 2) || ' and by the room it had';
select '854. and what they are: ' || coalesce(string_agg(distinct
         lower((select name from tree_age_def a where a.id = tree_age(land_data(:'world7', q.gx, q.gy)))) || ' '
         || lower((select name from tree_def d where d.id = tree_species(land_data(:'world7', q.gx, q.gy)))), ', '), 'nothing')
from (select 60 + dx as gx, 60 + dy as gy from generate_series(-2, 2) dx, generate_series(-2, 2) dy) q
where land_tile(:'world7', q.gx, q.gy) = tile_id('Tree');

select '855. and what a day costs the clock that is not the woods'' own: '
     || (select count(*) from world w where w.ready
          and w.trees_at <= now() - make_interval(secs => tree_stage()))
     || ' islands due — which is the whole of what any other round has to ask,'
     || ' because the woods have a winding of their own now';

/*
 * And the thing the roll is for: a wood with somewhere to settle.
 *
 * Two saplings a stump is two offspring a tree, which is a doubling every four
 * days until the island is full. A flat average of one is not replacement
 * either — a seed with no room is a seed lost and nothing gives one back. So
 * the roll is a shade over replacement and the *room* does the regulating, and
 * the thing to show is not where it goes but that it goes there from both
 * ends: a thin wood and a thick one, on the same ground, moving towards one
 * another instead of to nothing or to everything.
 */
create or replace function pg_temp.wood(p_world uuid) returns numeric
  language sql stable as $fn$
  -- The whole island, not a window in it: a stump two tiles from the edge of a
  -- window seeds outside it, and a count that stops at the edge reads that as a
  -- wood shrinking when it is only a wood moving.
  select round(100.0 * count(*) filter (where get_byte(t.tiles, g.i) = tile_id('Tree'))
               / greatest(1, count(*)), 1)
    from world w, land_tile t, generate_series(0, w.size - 1) g(i)
   where w.id = p_world and t.world_id = p_world
$fn$;

create or replace function pg_temp.sow(p_world uuid, p_share double precision) returns void
  language plpgsql as $fn$
declare i int; j int; sz int;
begin
  perform setseed(0.9191);
  select size into sz from world where id = p_world;
  for j in 0 .. sz - 1 loop for i in 0 .. sz - 1 loop
    perform land_set_height(p_world, i, j, 4);
    if random() < p_share then
      perform land_set_tile(p_world, i, j, tile_id('Tree'));
      perform land_set_data(p_world, i, j, 2 | ((floor(random() * 4)::int) << 4));
    else
      perform land_set_tile(p_world, i, j, tile_id('Grass'));
      perform land_set_data(p_world, i, j, 0);
    end if;
  end loop; end loop;
end $fn$;

create or replace function pg_temp.years(p_world uuid, p_days int) returns numeric
  language plpgsql as $fn$
declare d int;
begin
  for d in 1 .. p_days loop perform pg_temp.one_day(p_world); end loop;
  return pg_temp.wood(p_world);
end $fn$;

-- Nobody about, so this measures the wood rather than the telling of it.
update player set away = true where world_id = :'world7' \g /dev/null
select pg_temp.sow(:'world7', 0.2) \g /dev/null
select pg_temp.wood(:'world7') as thin0 \gset
select pg_temp.years(:'world7', 40) as thin40 \gset
select pg_temp.sow(:'world7', 0.8) \g /dev/null
select pg_temp.wood(:'world7') as thick0 \gset
select pg_temp.years(:'world7', 40) as thick40 \gset
select '856. the whole island sown thin and sown thick, forty days each: '
     || :'thin0' || '% → ' || :'thin40' || '%, and ' || :'thick0' || '% → ' || :'thick40' || '%'
     || ' — one up and one down, towards one another. Two apiece only ever went up,'
     || ' and a roll averaging 1.02 only ever went down: measured to three hundred days it'
     || ' took a fifth of the island to a twentieth and kept going.';
select '857. and the dial that says where: two saplings where ' || tree_room_two()
     || '+ of the twenty-four round the stump are open, one where ' || tree_room_one()
     || '+ are, none where the wood has closed over — and a roll averaging '
     || round((1 + tree_seed_both() - tree_seed_none())::numeric, 2) || ' under all of it';

/*
 * And the guard that would have caught all of it.
 *
 * Not "does placing a kiln work" — that was measured, and passed, and was
 * wrong. The rules and the browser had two names for the thing in your hand,
 * and any measurement that writes its own ask picks one of them and proves
 * nothing about the other. So this one does not ask a question at all: it
 * reads the rulebook and says whether anything in it still reaches into a
 * target for an item by name instead of asking `target_item()`, which
 * answers to both.
 *
 * A rule that goes back to doing it by hand is named here the same day.
 */
select '858. rules still reaching into a target for an item or a mould by name: '
     || coalesce(string_agg(p.proname, ', ' order by p.proname),
                 'none — all ' || (select count(*) from pg_proc q join pg_namespace m on m.oid = q.pronamespace
                                    where m.nspname = 'public' and q.prokind = 'f'
                                      and (pg_get_functiondef(q.oid) like '%target\_item(p\_target)%'
                                        or pg_get_functiondef(q.oid) like '%target\_mould(p\_target)%'))
                 || ' of them ask target_item() or target_mould(), which answer to either name')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f' and p.proname not in ('target_item', 'target_mould')
   and (pg_get_functiondef(p.oid) like '%p_target->>''uid''%'
     or pg_get_functiondef(p.oid) like '%p_target->>''itemUid''%'
     or pg_get_functiondef(p.oid) like '%p_target->>''mould''%'
     or pg_get_functiondef(p.oid) like '%p_target->>''mouldUid''%');

/*
 * And the record of a day, which is the only thing a browser ever sees of one.
 *
 * The land does not travel: a join builds the ground from the seed and the
 * chart and then lays `tile_change` over it. So a change the woods make and do
 * not write down did not happen anywhere but here, and every browser draws the
 * old ground for ever — which is how a sapling on a dirt tile became *"some
 * dirt tiles return an error when trying to pack"*. The island had a tree
 * there. Nobody else had been told.
 *
 * Measured with the island empty, because an island is empty most of the time
 * and that is exactly when this went wrong.
 */
create or replace function pg_temp.faces(p_world uuid) returns bytea
  language sql stable as $fn$
  select string_agg(t.tiles, ''::bytea order by t.y) from land_tile t where t.world_id = p_world
$fn$;
create or replace function pg_temp.apart(a bytea, b bytea) returns int
  language sql immutable as $fn$
  select count(*)::int from generate_series(0, length(a) - 1) i where get_byte(a, i) <> get_byte(b, i)
$fn$;

update player set away = true where world_id = :'world7' \g /dev/null
delete from tile_change where world_id = :'world7' \g /dev/null
select pg_temp.faces(:'world7') as was \gset
select pg_temp.one_day(:'world7') as turned \gset
select pg_temp.faces(:'world7') as now \gset
select pg_temp.apart(:'was'::bytea, :'now'::bytea) as moved \gset
select count(*) as told from tile_change where world_id = :'world7' \gset
-- Every tile whose face moved, against the record of it moving.
select count(*) as untold from (
  select g.x, g.y from generate_series(0, length(:'was'::bytea) - 1) i,
    lateral (select i % (select size from world where id = :'world7') as x,
                    i / (select size from world where id = :'world7') as y) g
   where get_byte(:'was'::bytea, i) <> get_byte(:'now'::bytea, i)
     and not exists (select 1 from tile_change c
                      where c.world_id = :'world7' and c.x = g.x and c.y = g.y)) q \gset
-- And that what the record says is what the land says.
select count(*) as wrong from (
  select distinct on (c.x, c.y) c.x, c.y, c.tile, c.data from tile_change c
   where c.world_id = :'world7' order by c.x, c.y, c.n desc) last
  join land_tile t on t.world_id = :'world7' and t.y = last.y
 where get_byte(t.tiles, last.x) <> last.tile or get_byte(t.data, last.x) <> last.data \gset

select '859. a day in the woods with nobody on the island: ' || :'turned' || ' trees turned over, '
     || :'moved' || ' tiles changed face, ' || :'told' || ' written into the record'
     || ' — and ' || :'untold' || ' of the changed tiles went unwritten, which is'
     || ' the number that used to be all of them';
select '860. and the record against the land it is a record of: ' || :'wrong'
     || ' tiles where the last thing written down is not what the island holds';

/*
 * And the half that is only worth telling somebody who can see it.
 *
 * A birthday does not change what a tile is, only which of four pictures is
 * drawn over it and how many logs the browser guesses. Writing every one of
 * them down is four million rows a day on a full island to keep a picture in
 * step; writing the stumps and the saplings is a quarter of a million and is
 * what stops the ground itself being wrong. So the first is told to whoever
 * is standing near enough to watch it happen, and the second to everybody.
 */
update player set away = false, seen_at = now(), x = 32.5, y = 32.5 where world_id = :'world7' \g /dev/null
delete from tile_change where world_id = :'world7' \g /dev/null
select pg_temp.one_day(:'world7') \g /dev/null
select count(*) as watched from tile_change where world_id = :'world7' \gset
select '861. and the same day with somebody standing in the middle of it: ' || :'watched'
     || ' rows rather than ' || :'told' || ' — the difference is the birthdays,'
     || ' which are told to whoever can see them and worked out by nobody';

/*
 * And what a spadeful of dirt covers over.
 *
 * Reported from the island: *"dropping dirt on a clay/sand tile corner isn't
 * properly changing those tiles to dirt."* The rule named grass and lawn out
 * loud and nothing else, so a bank of clay took the dirt, rose a step and
 * stayed a bank of clay.
 *
 * Both spadefuls are asked here, because there are two of them and only one
 * was ever covering anything: `drop_dirt` aims at a corner and covers the tile
 * it names, and `drop_dirt_here` aims at your feet and covered nothing at all.
 *
 * This is the opposite rule to 839-843 on purpose, and they are both wanted.
 * `reconcile` leaves a bed alone, so the ground never turns your clay to dirt
 * behind your back; a spadeful buries it, because you asked it to with a
 * shovel in your hand.
 */
\echo ''
\echo '--- a spadeful of dirt covers what it lands on'
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; i int; j int;
begin
  select id into w from world where name = 'Hoarding';
  for j in 20..22 loop for i in 20..22 loop
    perform land_set_height(w, i, j, 4);
    perform land_set_dirt(w, i, j, 10);
  end loop; end loop;
  perform land_set_tile(w, 20, 20, tile_id('Clay'));
  perform land_set_tile(w, 21, 20, tile_id('Sand'));
  perform land_set_tile(w, 20, 21, tile_id('Peat'));
  perform land_set_tile(w, 21, 21, tile_id('Cobblestone'));
  update player set x = 20.4, y = 20.4, act = null, act_queue = '[]'::jsonb, seen_at = now(), away = false,
      stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1') where world_id = w and uid = me;
  delete from item where world_id = w and holder_uid = me and def = 'dirt';
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', me, 'dirt', 20, 9);
end $$;
select '862. four faces to drop dirt on: ' || string_agg(
         (select name from tile_def t where t.id = land_tile(:'world7', q.x, q.y)), ', ' order by q.y, q.x)
from (values (20,20),(21,20),(20,21),(21,21)) q(x, y);

-- A spadeful on each, aimed at the corner the way the browser aims one.
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; q record;
begin
  select id into w from world where name = 'Hoarding';
  for q in select * from (values (20,20),(21,20),(20,21),(21,21)) v(x, y) loop
    update player set x = q.x + 0.4, y = q.y + 0.4,
        stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1') where world_id = w and uid = me;
    perform act_perform(w, me, 'drop_dirt', jsonb_build_object(
      'kind', 'tile', 'x', q.x, 'y', q.y, 'cx', q.x, 'cy', q.y));
  end loop;
end $$;
select '863. and after one each: ' || string_agg(
         (select name from tile_def t where t.id = land_tile(:'world7', q.x, q.y)), ', ' order by q.y, q.x)
     || ' — the cobblestone is broken up rather than buried, which is why it is still there'
from (values (20,20),(21,20),(20,21),(21,21)) q(x, y);

-- And the other spadeful: the one you drop at your feet.
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777';
begin
  select id into w from world where name = 'Hoarding';
  perform land_set_tile(w, 22, 22, tile_id('Sand'));
  perform land_set_height(w, 22, 22, 4);
  update player set x = 22.4, y = 22.4, act = null, act_queue = '[]'::jsonb, seen_at = now(),
      stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1') where world_id = w and uid = me;
  perform act_perform(w, me, 'drop_dirt_here', '{"kind":"item"}'::jsonb);
end $$;
select '864. and a spadeful dropped at your feet on sand: '
     || (select name from tile_def t where t.id = land_tile(:'world7', 22, 22))
     || ' — which used to raise the corner and leave the face exactly as it was';
select '865. and the list both sides read: ' || string_agg(d.name, ', ' order by b.tile)
  from buryable b join tile_def d on d.id = b.tile;

/*
 * And the hour a line was said at, which is not the hour you read it.
 *
 * Reported from the island: *"when logging in, all prior world chats default
 * to the login timestamp."* They did, on the browser's side — every line went
 * through one door that stamped it `Date.now()`, which for anything said
 * before you opened the page is the moment you opened the page.
 *
 * The hour was never lost. `event.at` has been on every row since the table
 * was written and `rpc_chat` has sent it since the day it was written; the
 * browser read the `n` and the `text` and let the `at` fall on the floor.
 * `rpc_settle` was the one end with nothing to drop, and it is the catch-up
 * for a channel that went quiet — the lines most likely to be hours old by
 * the time they land.
 */
\echo ''
\echo '--- a line keeps the hour it was said at'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
delete from event where world_id = :'world2' and kind = 'chat';
insert into event (world_id, uid, text, kind, at)
  values (:'world2', null, 'Anybody selling nails?', 'chat', now() - interval '7 hours'),
         (:'world2', null, 'Three hundred, at the token.', 'chat', now() - interval '6 hours');
select '866. the chat book, read now, for a line said seven hours ago: '
     || coalesce((select string_agg(round(extract(epoch from now() - (l->>'at')::timestamptz) / 3600)::text
                                    || 'h ago', ', ' order by (l->>'n')::bigint)
                    from jsonb_array_elements(rpc_chat(:'world2', 60)) l), 'nothing')
     || ' — and not "0h ago, 0h ago", which is what a line stamped on arrival reads as';

-- And the catch-up, which is the one that was sending no hour at all.
insert into event (world_id, uid, text, kind, at)
  values (:'world2', :'ivar', 'Your hatchet is worn to the haft.', 'event', now() - interval '90 minutes')
  returning n as heard \gset
select '867. and a line caught up on after a quiet channel: '
     || coalesce((select string_agg(round(extract(epoch from now() - (l->>'at')::timestamptz) / 60)::text
                                    || ' minutes ago', ', ')
                    from jsonb_array_elements(rpc_settle(null, :'world2', :'heard' - 1) -> 'said') l
                   where l->>'kind' = 'event'), 'nothing said')
     || ' — the whole of what rpc_settle used to leave out';

/*
 * And the kilograms the craft numbers are supposed to follow.
 *
 * Asked from the island: a lump should be twenty kilograms of ore, an anvil
 * twenty lumps, and the rare six should come out of the same charge at a
 * tenth — so a mould takes ten times as many of them, which is the same
 * weight of metal read from the other end.
 */
\echo ''
\echo '--- what a thing costs in kilograms of what it came from'
select '868. a charge of ore is ' || ore_per_lump()::int || ' × '
     || (select weight from item_def where id = 'iron_ore') || 'kg = '
     || (ore_per_lump() * (select weight from item_def where id = 'iron_ore'))::int
     || 'kg, and comes out as one lump of '
     || (select weight from item_def where id = 'iron_lump') || 'kg — against '
     || (select weight from item_def where id = 'mithril_lump')
     || 'kg for the same charge of mithril';
select '869. so an anvil, which is one weight of metal however you pour it: '
     || string_agg(mould_lumps('anvil_mould', m.id) || ' ' || lower(m.name) || ' ('
                   || round((mould_lumps('anvil_mould', m.id)
                             * (select weight from item_def d where d.id = m.lump))::numeric, 1) || 'kg)', ', '
                   order by m.level)
  from metal_def m where m.id in ('copper', 'iron', 'gold', 'mithril');
select '870. and the stonework, per block out of the seam, in every stone there is: '
     || (select string_agg(r.count || ' ' || replace(replace(r.id, 'make_', ''), '_brick', '')
                           || ' from ' || i.count, ', ' order by r.id)
           from recipe r join recipe_input i on i.recipe = r.id
          where r.id like 'make%\_brick' and r.id <> 'make_clay_brick')
     || ' — and to a slab: '
     || (select string_agg(i.count || ' ' || replace(replace(r.id, 'make_', ''), '_slab', ''), ', ' order by r.id)
           from recipe r join recipe_input i on i.recipe = r.id where r.id like 'make%\_slab')
     || ', with ' || (select count from recipe where id = 'make_mortar')
     || ' mortar from one sand and one clay';
select '871. and a lump of the common metals weighs the same kilogram whichever it is: '
     || (select string_agg(m.id || ' ' || d.weight, ', ' order by m.level)
           from metal_def m join item_def d on d.id = m.lump
          where m.ore is not null and not m.rare)
     || ' — against the rare six at '
     || (select string_agg(distinct d.weight::text, ', ')
           from metal_def m join item_def d on d.id = m.lump where m.rare);

/*
 * And the citizen, who had a settlement everywhere but in the rules that
 * needed one.
 *
 * Asked from the island: for now every citizen of a deed should be able to
 * place items and modify everything except the totem.
 *
 * Half of that was already true. `deeds_of` has counted citizens since the day
 * they landed, so `my_deed`, `deed_here` and `on_my_deed` — and through them
 * the planning, the paving, the crates and the buildings, measured at 770 and
 * 772 — have always known one. Eighteen rules did not use it: they asked
 *
 *     exists (select 1 from deed where world_id = p_world and founded_by = p_uid)
 *
 * by hand, which is not "have you a settlement" but "did you found one". A
 * citizen got a browser that offered the work and an island that answered no.
 *
 * Hild is a citizen of Ivar's Lambfold and founded nothing. Alice founded
 * nothing and was asked nowhere, and stands beside her as the control: the
 * only thing that differs between the two lines below is citizenship.
 */
\echo ''
\echo '--- a citizen of the settlement, and the token that is still the founder''s'
update player set x = 5.5, y = 8.5, favour = 60, favour_at = now()
  where world_id = :'world2' and uid in (:'hild', :'alice') \g /dev/null
insert into skill (world_id, uid, id, value)
values (:'world2', :'hild', 'prayer', 45), (:'world2', :'alice', 'prayer', 45)
  on conflict (world_id, uid, id) do update set value = 45 \g /dev/null
select creature_spawn(:'world2', 'bevere', 5.5, 8.5, 'active', now() - interval '3 hours', :'hild') as cit_doe \gset
select creature_spawn(:'world2', 'bevere', 5.6, 8.6, 'active', now() - interval '3 hours', :'hild') as cit_buck \gset
select creature_spawn(:'world2', 'bevere', 5.4, 8.4, 'active', now() - interval '3 hours', :'alice') as out_doe \gset
-- Sexes by hand: what is being measured is the settlement, not the coin the
-- spawner tosses, and breeding wants one of each standing there.
update creature set sex = 'female', until = now() + interval '1 hour'
  where world_id = :'world2' and id in (:'cit_doe', :'out_doe') \g /dev/null
update creature set sex = 'male', until = now() + interval '1 hour'
  where world_id = :'world2' and id = :'cit_buck' \g /dev/null
select '872. a citizen and a stranger side by side at the token of Lambfold — keeping a wildermon at it: "'
     || coalesce(creature_refusal(:'world2', :'hild', 'store_creature', ('{"id":' || :'cit_doe' || '}')::jsonb), 'ALLOWED')
     || '" against "'
     || coalesce(creature_refusal(:'world2', :'alice', 'store_creature', ('{"id":' || :'out_doe' || '}')::jsonb), 'ALLOWED')
     || '", and setting one to work: "'
     || coalesce(creature_refusal(:'world2', :'hild', 'assign_deed', ('{"id":' || :'cit_doe' || '}')::jsonb), 'ALLOWED')
     || '" against "'
     || coalesce(creature_refusal(:'world2', :'alice', 'assign_deed', ('{"id":' || :'out_doe' || '}')::jsonb), 'ALLOWED') || '"';
select '873. and breeding: "'
     || coalesce(last_refusal(:'world2', :'hild', 'pair_creature', ('{"id":' || :'cit_doe' || '}')::jsonb), 'ALLOWED')
     || '" against "'
     || coalesce(last_refusal(:'world2', :'alice', 'pair_creature', ('{"id":' || :'out_doe' || '}')::jsonb), 'ALLOWED')
     || '"; the harvest: "' || coalesce(cast_reason(:'world2', :'hild', 'bounty', null), 'ALLOWED')
     || '" against "' || coalesce(cast_reason(:'world2', :'alice', 'bounty', null), 'ALLOWED')
     || '"; and the walk home: "' || work_ability(:'world2', :'hild', 'recall')
     || '" against "' || work_ability(:'world2', :'alice', 'recall') || '"';
select '874. and the hands she may set to it: ' || worker_cap(:'world2', :'hild') || ' against '
     || worker_cap(:'world2', :'alice') || ', working out of '
     || coalesce((select x || ',' || y || ' within ' || radius || ' tiles'
                    from work_site(:'world2', (select c from creature c where c.world_id = :'world2' and c.id = :'cit_doe'))),
                 'nowhere')
     || ' against '
     || coalesce((select x || ',' || y || ' within ' || radius || ' tiles'
                    from work_site(:'world2', (select c from creature c where c.world_id = :'world2' and c.id = :'out_doe'))),
                 'nowhere')
     || ' — a beast keyed to a citizen has a token to work out of, and one keyed to nobody has none';
-- And the eighteenth site, which was not in the first pass: a beast called off
-- a work post was sent to its keeper's *founded* deed, so a citizen's was left
-- standing where the post was.
update player set x = 6.5, y = 8.5 where world_id = :'world2' and uid = :'hild' \g /dev/null
select give(:'world2', :'hild', 'work_post', 1, 30, 'Pine') \g /dev/null
select id as cit_post_item from item where world_id = :'world2' and holder_uid = :'hild' and def = 'work_post'
  order by id desc limit 1 \gset
select act_perform(:'world2', :'hild', 'place_post',
  ('{"kind":"tile","x":6,"y":8,"sx":1,"sy":1,"itemUid":' || :'cit_post_item' || '}')::jsonb) \g /dev/null
select id as cit_post from placed where world_id = :'world2' and kind = 'post' order by id desc limit 1 \gset
select act_perform(:'world2', :'hild', 'assign_post',
  ('{"kind":"post","id":' || :'cit_post' || ',"creature":' || :'cit_doe' || '}')::jsonb) \g /dev/null
select '875. and a citizen''s wildermon called off the post at 6,8 walks to '
     || (select floor(to_x) || ',' || floor(to_y) from creature where world_id = :'world2' and id = :'cit_doe')
     || ' — the post, until it is called off: '
     || coalesce((select post::text from creature where world_id = :'world2' and id = :'cit_doe'), 'none');
select act_perform(:'world2', :'hild', 'unassign_post',
  ('{"kind":"post","id":' || :'cit_post' || '}')::jsonb) \g /dev/null
select '875b. and once it is: ' || (select floor(to_x) || ',' || floor(to_y) from creature where world_id = :'world2' and id = :'cit_doe')
     || ', which is the token of Lambfold at '
     || (select x || ',' || y from deed where world_id = :'world2' and name = 'Lambfold')
     || ' rather than the post it was standing at';
select '876. and the token itself, which is not hers to touch: "'
     || coalesce(settlement_refusal(:'world2', :'hild', 'upgrade_deed', '{}'::jsonb), 'ALLOWED') || '", "'
     || coalesce(settlement_refusal(:'world2', :'hild', 'rename_deed', '{"name":"Hildfold"}'::jsonb), 'ALLOWED') || '", "'
     || coalesce(settlement_refusal(:'world2', :'hild', 'disband_deed', '{}'::jsonb), 'ALLOWED') || '"';
select '877. and what is left deciding a settlement by who founded it: '
     || (select string_agg(p.proname, ', ' order by p.proname)
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prokind = 'f' and p.prosrc like '%founded_by = p_uid%')
     || ' — the token, the crate beside it and the roll of citizens; and rules that send a beast to its keeper''s founded deed: '
     || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prokind = 'f'
            and p.prosrc ~ 'founded_by = [a-z_]+\.(keeper|made_by)');
/*
 * And the door I assumed rather than asked.
 *
 * Reported from the island while the above was going live: *"i'm a citizen of
 * your deed but i'm unable to place down a smelter"* — with the refusal in the
 * screenshot reading "Smelters stand on your own deed."
 *
 * That line is the browser's, not this island's: `place_smelter` has no deed
 * check at all, which 878 says out loud. What the island does check is
 * `plan_reason`, and that has known a citizen all along. So the rule that
 * refused was the browser's own copy, and the reason it refused is that the
 * browser held *one* settlement — `my_deed`, which is founder first — where
 * the island holds the list. Somebody who founded a stake of their own and was
 * then asked onto another's had their own held and the other one ignored.
 *
 * Asked here anyway, because "the island already allows it" was a thing I
 * believed rather than measured, and the believing is what cost the afternoon.
 */
select give(:'world2', :'hild', 'smelter', 1, 30, 'Stone') \g /dev/null
select give(:'world2', :'alice', 'smelter', 1, 30, 'Stone') \g /dev/null
select id as cit_smelter from item where world_id = :'world2' and holder_uid = :'hild' and def = 'smelter'
  order by id desc limit 1 \gset
select id as out_smelter from item where world_id = :'world2' and holder_uid = :'alice' and def = 'smelter'
  order by id desc limit 1 \gset
select '878. building on a settlement you are a citizen of: "'
     || coalesce(plan_reason(:'world2', :'hild', 5, 8), 'ALLOWED')
     || '" against "' || coalesce(plan_reason(:'world2', :'alice', 5, 8), 'ALLOWED')
     || '" — and setting a smelter down there: "'
     || coalesce(act_refusal(:'world2', :'hild', 'place_smelter',
          ('{"kind":"tile","x":5,"y":8,"sx":1,"sy":1,"itemUid":' || :'cit_smelter' || '}')::jsonb), 'ALLOWED')
     || '" against "'
     || coalesce(act_refusal(:'world2', :'alice', 'place_smelter',
          ('{"kind":"tile","x":5,"y":8,"sx":1,"sy":1,"itemUid":' || :'out_smelter' || '}')::jsonb), 'ALLOWED')
     || '", which this island has never asked a deed about at all: the rule that refused a citizen was the browser''s own';

/*
 * And the door that hands over the land rather than the story of it.
 *
 * Asked from the island, looking at a boot screen reading "reading what has
 * been dug — 126,396": could a join read only what the player has seen, before
 * this gets expensive for everybody logging in and out?
 *
 * It reads the land now. `land_tile` and `land_corner` have been kept current
 * by every dig since the rules moved into Postgres — `land_set_tile` and its
 * neighbours write them — and `rpc_land_window` is the door a body may knock
 * on for a square of them. What that costs is what the square *is*; what
 * replaying `tile_change` costs is everything that has ever been *done* to the
 * island, which only goes up. `supabase/test/window.ts` drives both roads over
 * one island and compares them byte for byte; these are the door's own rules.
 */
\echo ''
\echo '--- the land as it is, rather than the story of how it got there'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select land_set_tile(:'world2', 3, 3, 7), land_set_height(:'world2', 3, 3, -77) \g /dev/null
select land_announce(:'world2', 3, 3) \g /dev/null
select (rpc_land_window(:'world2', 2, 2, 4, 4)) as win \gset
select '879. a square of the island, asked for as a body standing on it: '
     || jsonb_array_length((:'win'::jsonb)->'rows') || ' rows for 3 of squares, because a row of squares '
     || 'stands on the row of corners under it as well as its own; the tile just changed reads '
     || land_tile(:'world2', 3, 3) || ' at height ' || land_height(:'world2', 3, 3)
     || ', and the cursor it was read at is '
     || case when ((:'win'::jsonb)->>'n')::bigint >= (select max(n) from tile_change where world_id = :'world2')
             then 'the newest change there is' else 'BEHIND THE NEWEST CHANGE' end;
select '880. and the corners come one wider than the squares: '
     || octet_length(decode(((:'win'::jsonb)->'rows'->0->>'dirt'), 'base64')) || ' soil against '
     || octet_length(decode(((:'win'::jsonb)->'rows'->0->>'tiles'), 'base64')) || ' tiles, with '
     || octet_length(decode(((:'win'::jsonb)->'rows'->0->>'heights'), 'base64')) || ' bytes of height for two apiece'
     || ' — and the row past the last one carries corners and no squares: '
     || coalesce(((:'win'::jsonb)->'rows'->-1->>'tiles'), 'none');
-- What it will not hand over is measured in `window.ts`, where an exception is
-- an answer rather than the end of the run: a square bigger than `land_ask` a
-- side, and anybody who is not on the island.
select '881. and what one of these weighs against the road it replaces: '
     || round(length((rpc_land_window(:'world2', 0, 0, 15, 15))::text) / 256.0, 1)
     || ' bytes a tile of land, against '
     || round((select avg(length(jsonb_build_object('n',n,'x',x,'y',y,'tile',tile,'data',data,
                                                    'corners',corners,'soil',soil)::text))
                from tile_change where world_id = :'world2'), 0)
     || ' bytes for every spadeful ever turned — the first number is what the square is and does not move, '
     || 'the second is what has been done to it and only goes up';

/*
 * And peat, which burns.
 *
 * Asked from the island: "allow peat as fuel." It is the one thing here dug
 * straight out of the ground and worth nothing at all — a bed of it, a shovel
 * that fills off the top of one, and a bogga whose whole trade is cutting it
 * and carrying it home, with nowhere for any of it to go.
 *
 * Asked the browser's way, through `fuel_campfire` with a lump of it in hand,
 * rather than by asking `fuel_value` what it thinks: the door is what refused.
 */
\echo ''
\echo '--- peat burns'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select coalesce((select id::text from placed where world_id = :'world2' and kind = 'campfire' order by id limit 1), '0') as peatfire \gset
update placed set fuel = 0, since = now() where id = :'peatfire' \g /dev/null
select give(:'world2', :'ivar', 'peat', 3, 30) \g /dev/null
select id as peat_uid from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'peat'
  order by id desc limit 1 \gset
select give(:'world2', :'ivar', 'iron_ore', 1, 30) \g /dev/null
select id as notfuel_uid from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'iron_ore'
  order by id desc limit 1 \gset
select '882. a lump of peat offered to a cold fire: "'
     || coalesce(act_refusal(:'world2', :'ivar', 'fuel_campfire',
          ('{"kind":"campfire","id":' || :'peatfire' || ',"itemUid":' || :'peat_uid' || '}')::jsonb), 'ALLOWED')
     || '" — and the same fire offered a lump of iron ore: "'
     || coalesce(act_refusal(:'world2', :'ivar', 'fuel_campfire',
          ('{"kind":"campfire","id":' || :'peatfire' || ',"itemUid":' || :'notfuel_uid' || '}')::jsonb), 'ALLOWED')
     || '", which is the list said once rather than typed into every rule that needs it';
select rpc_act(:'world2', 'fuel_campfire',
  ('{"kind":"campfire","id":' || :'peatfire' || ',"itemUid":' || :'peat_uid' || '}')::jsonb, 1) \g /dev/null
update player set act_started = act_started - interval '60 seconds', act_ends = act_ends - interval '60 seconds'
  where world_id = :'world2' and uid = :'ivar' \g /dev/null
select settle(:'world2', :'ivar') \g /dev/null
select '883. and three of them fed to it: ' || burns_for((select fuel from placed where id = :'peatfire'))
     || ' of fuel, with ' || coalesce((select sum(count)::text from item where world_id = :'world2'
                                        and holder_uid = :'ivar' and def = 'peat'), '0')
     || ' peat left in hand — ' || (select text from event where world_id = :'world2' and uid = :'ivar'
                                      and kind = 'event' order by n desc limit 1);
select '884. and where peat sits in what burns: '
     || (select string_agg(d.id || ' ' || fuel_value(d.id)::int || 's', ', ' order by fuel_value(d.id))
           from item_def d where fuel_value(d.id) is not null)
     || ' — one table, in the browser, generated down here: '
     || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prokind = 'f' and p.prosrc like '%shafts, thatch%')
     || ' rules still spell the list out by hand';

/*
 * And the body, which learns from the work.
 *
 * Reported from the island: "i haven't seemed to be able to increase any
 * characteristics aside from mind logic so far in this iteration, in the solo
 * world i was making body gains from my digging and mining."
 *
 * Exactly right. `body_stamina` rose here only from a night's sleep and
 * `body_control` from nothing whatever, because "wind from spending it,
 * control from doing it" lived in the browser's `finishGo` and nowhere else —
 * and the island has been charging the wind and saying nothing about what
 * spending it taught you. Awareness was worse: the one characteristic that is
 * meant to be hard to get was impossible, because nothing on this island had
 * ever paid anybody for being out in the dark.
 */
\echo ''
\echo '--- the body learns from the work'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select round(skill_of(:'world2', :'ivar', 'body_control')::numeric, 4) as hand0,
       round(skill_of(:'world2', :'ivar', 'body_stamina')::numeric, 4) as wind0 \gset
select spend_wind(:'world2', :'ivar', 'dig') \g /dev/null
select round(skill_of(:'world2', :'ivar', 'body_control')::numeric, 4) as hand1,
       round(skill_of(:'world2', :'ivar', 'body_stamina')::numeric, 4) as wind1 \gset
select spend_wind(:'world2', :'ivar', 'examine') \g /dev/null
select '885. one go of digging: hands ' || :'hand0' || ' to ' || :'hand1'
     || ', wind ' || :'wind0' || ' to ' || :'wind1'
     || ' — and then a go that costs no wind at all: hands '
     || round(skill_of(:'world2', :'ivar', 'body_control')::numeric, 4) || ', wind '
     || round(skill_of(:'world2', :'ivar', 'body_stamina')::numeric, 4)
     || ', which is the browser''s rule: the hands learn from every go and the chest only from what it spent';
-- And the dark, which nothing here has ever paid for.
select epoch as was_epoch from world where id = :'world2' \gset
update world set epoch = now() - make_interval(secs => 12 / 24.0 * day_seconds()) where id = :'world2' \g /dev/null
select round(skill_of(:'world2', :'ivar', 'awareness')::numeric, 4) as eyes0, round(darkness(:'world2')::numeric, 2) as noon \gset
select fought_in_dark(:'world2', :'ivar', dark_hit()) \g /dev/null
select round(skill_of(:'world2', :'ivar', 'awareness')::numeric, 4) as eyes1 \gset
update world set epoch = now() - make_interval(secs => 1 / 24.0 * day_seconds()) where id = :'world2' \g /dev/null
select fought_in_dark(:'world2', :'ivar', dark_hit()) \g /dev/null
select '886. a blow taken at midday, darkness ' || :'noon' || ': awareness ' || :'eyes0' || ' to ' || :'eyes1'
     || ' — and the same blow at one in the morning, darkness ' || round(darkness(:'world2')::numeric, 2)
     || ': ' || round(skill_of(:'world2', :'ivar', 'awareness')::numeric, 4)
     || ' — the one characteristic bought with the hours you can see least';
update world set epoch = :'was_epoch' where id = :'world2' \g /dev/null
select '887. and what this island pays a characteristic for, all six of them: '
     || (select string_agg(d.name || ' (' || coalesce(g.who, 'NOTHING AT ALL') || ')', ', ' order by d.name)
           from skill_def d
           left join lateral (
             select string_agg(distinct p.proname, ' + ') as who
               from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prokind = 'f'
                and p.prosrc ~ ('(skill_raise|skill_told|char_told)\([^,]+,[^,]+,\s*''' || d.id || '''')) g on true
          where d.id in ('body_strength','body_stamina','body_control','mind_logic','soul_strength','awareness'));

/*
 * And two things a person chose that nobody was keeping.
 *
 * Reported from the island: "my title seems to revert automatically to the
 * first on the list" and "might want an option to plant a specific sprout."
 *
 * One cause under both. The browser held the choice and the island held the
 * thing, and there was no step between them: `wearTitle` set its own copy and
 * told nobody, while `rpc_settle` reported the island's `title` on every beat
 * and the browser took it — so a title lasted until the next heartbeat. The
 * sprout is the same shape without the reverting: both sides planted the first
 * one they found, so a forester carrying oak, cedar and maple had no way to
 * say which, and the island's "first" was the oldest in the pack.
 */
\echo ''
\echo '--- what you chose is what you get'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
update player set titles = '["digger_1","miner_1"]'::jsonb, title = 'digger_1'
  where world_id = :'world2' and uid = :'ivar' \g /dev/null
-- Each on its own statement, or the select beside it reads the island from
-- before it ran: the suite has been bitten by that before and says so at the top.
select (rpc_wear_title(:'world2', 'miner_1'))::text as wore \gset
select '888. the first title earned is worn by default, and then the second is chosen: '
     || :'wore' || ' — the island holds "'
     || coalesce((select title from player where world_id = :'world2' and uid = :'ivar'), 'none')
     || '" now, which is what the next heartbeat hands back rather than the first one ever earned';
select ((rpc_wear_title(:'world2', 'no_such_title'))->>'why') as refused \gset
select '889. and one nobody earned: "' || :'refused' || '", still wearing '
     || coalesce((select title from player where world_id = :'world2' and uid = :'ivar'), 'none');
select (rpc_wear_title(:'world2', null))::text as bare \gset
select '890. and taking it off: ' || :'bare' || ', wearing '
     || coalesce((select title from player where world_id = :'world2' and uid = :'ivar'), 'nothing at all');
/*
 * And the sprout, which is the same question asked of a pack rather than a
 * list: both sides planted the first one they found, so a forester carrying
 * oak, cedar and maple had no way to say which.
 */
delete from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'sprout' \g /dev/null
update land_tile set tiles = set_byte(tiles, 9, 1) where world_id = :'world2' and y = 9 \g /dev/null
update player set x = 8.5, y = 8.5 where world_id = :'world2' and uid = :'ivar' \g /dev/null
select name as old_tree from tree_def order by id limit 1 \gset
select name as new_tree from tree_def order by id desc limit 1 \gset
select give(:'world2', :'ivar', 'sprout', 1, 30, :'old_tree') \g /dev/null
select give(:'world2', :'ivar', 'sprout', 1, 30, :'new_tree') \g /dev/null
select id as chosen_sprout from item where world_id = :'world2' and holder_uid = :'ivar'
  and def = 'sprout' and extra = :'new_tree' order by id desc limit 1 \gset
select act_perform(:'world2', :'ivar', 'plant',
  ('{"kind":"tile","x":9,"y":9,"itemUid":' || :'chosen_sprout' || '}')::jsonb) \g /dev/null
select '891. a pack holding a ' || lower(:'old_tree') || ' sprout and a ' || lower(:'new_tree')
     || ', with the ' || lower(:'new_tree') || ' asked for by name: what goes in the ground is '
     || coalesce((select lower(name) from tree_def where id = (land_data(:'world2', 9, 9) & 15)), 'nothing')
     || ', and what is left in the pack is '
     || coalesce((select lower(extra) from item where world_id = :'world2' and holder_uid = :'ivar'
                    and def = 'sprout' limit 1), 'none')
     || ' — asked for nothing in particular it still plants the oldest to hand, which is what it always did';

/*
 * And the crate rack, whose footprint is what it carries.
 *
 * Asked from the island: a shelf two subtiles across and four deep, holding
 * eight plank crates, drawn with however many of its spots are occupied.
 *
 * It holds nothing. Its eight subtiles *are* its eight crate spots, and a
 * crate standing on one is an ordinary crate at an ordinary subtile — the same
 * row in the same table, with its own contents and its own name. So there is
 * no new store anywhere and nothing to keep in step; what changes is the two
 * rules that would otherwise be in its way.
 */
\echo ''
\echo '--- a rack whose footprint is what it carries'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
delete from crate where world_id = :'world2' and x = 11 and y = 11 \g /dev/null
delete from placed where world_id = :'world2' and sub = 'crate_shelf' \g /dev/null
update player set x = 11.5, y = 11.5 where world_id = :'world2' and uid = :'ivar' \g /dev/null
select give(:'world2', :'ivar', 'crate_shelf', 1, 40) \g /dev/null
select act_perform(:'world2', :'ivar', 'place_furniture',
  ('{"kind":"item","uid":' || (select id from item where world_id = :'world2' and holder_uid = :'ivar'
      and def = 'crate_shelf' order by id desc limit 1) || ',"x":11,"y":11,"sx":0,"sy":0}')::jsonb) \g /dev/null
select id as rack from placed where world_id = :'world2' and sub = 'crate_shelf' order by id desc limit 1 \gset
select '892. a crate shelf set down at 11,11: ' || (select w || ' spots across and ' || h || ' deep, ' || crates
         || ' crate spots' from furniture_def where id = 'crate_shelf')
     || ', standing on subtiles ' || (select p.sx || ',' || p.sy from placed p where p.id = :'rack')
     || ' — and what the rack itself holds: '
     || (select count(*) from item where world_id = :'world2' and holder = 'furniture' and placed = :'rack') || ' things';
-- A log crate will not sit on the runners; a plank crate will.
select give(:'world2', :'ivar', 'crate_log', 1, 30) \g /dev/null
select give(:'world2', :'ivar', 'crate_plank', 8, 30) \g /dev/null
select id as logcrate from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'crate_log'
  order by id desc limit 1 \gset
select id as plankcrate from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'crate_plank'
  order by id desc limit 1 \gset
select '893. offering the rack a log crate: "'
     || coalesce(act_refusal(:'world2', :'ivar', 'place_crate',
          ('{"kind":"tile","x":11,"y":11,"sx":0,"sy":0,"itemUid":' || :'logcrate' || '}')::jsonb), 'ALLOWED')
     || '", and a plank crate: "'
     || coalesce(act_refusal(:'world2', :'ivar', 'place_crate',
          ('{"kind":"tile","x":11,"y":11,"sx":0,"sy":0,"itemUid":' || :'plankcrate' || '}')::jsonb), 'ALLOWED') || '"';
-- Load all eight spots, the browser's way, one at a time.
select act_perform(:'world2', :'ivar', 'place_crate',
  ('{"kind":"tile","x":11,"y":11,"sx":' || (n % 2) || ',"sy":' || (n / 2) || ',"itemUid":'
   || (select id from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'crate_plank' limit 1) || '}')::jsonb)
  from generate_series(0, 7) n \g /dev/null
select '894. and loaded a spot at a time: ' || crates_on_rack(:'world2', :'rack') || ' of '
     || (select crates from furniture_def where id = 'crate_shelf') || ' spots taken, which is '
     || (select count(*) from crate where world_id = :'world2' and x = 11 and y = 11)
     || ' crates standing at 11,11 — each its own crate in the ordinary table, at an ordinary subtile';
select '895. and lifting the rack out from under them: "'
     || coalesce(act_refusal(:'world2', :'ivar', 'pick_up_furniture',
          ('{"kind":"furniture","id":' || :'rack' || '}')::jsonb), 'ALLOWED')
     || '" — with one taken off again: ' as lifting \gset
delete from crate where world_id = :'world2' and x = 11 and y = 11 and sx = 1 and sy = 3 \g /dev/null
select :'lifting' || '"' || coalesce(act_refusal(:'world2', :'ivar', 'pick_up_furniture',
          ('{"kind":"furniture","id":' || :'rack' || '}')::jsonb), 'ALLOWED') || '"';

/*
 * And who said it, which the line has always carried and nothing has read.
 *
 * Asked from the island: a speech bubble over somebody's head when they talk.
 * The whole of what that needs from this side was already here — `rpc_say`
 * writes `said_by` on every chat line and has since chat went in — and the
 * browser was reading four columns off the row and dropping that one.
 *
 * So there is no island change for the bubbles at all. What is worth pinning
 * is the two things they quietly depend on: that a chat line names its
 * speaker, and that the column is in what Realtime publishes. Drop it from the
 * publication and the lines still arrive, the log still reads right, and the
 * bubbles simply stop — with nothing anywhere to say why.
 */
\echo ''
\echo '--- a line that says who said it'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select rpc_say(:'world2', 'eight crates of iron ore on the rack if anybody wants some') \g /dev/null
select '896. the newest thing said on this island: "' || e.text || '", said by '
     || coalesce(folk_name(:'world2', e.said_by), 'NOBODY')
     || ', heard by ' || coalesce(e.uid::text, 'everyone')
     || ' — the name is in the line for the log, and `said_by` is who to draw it over'
  from event e where e.world_id = :'world2' and e.kind = 'chat' order by e.n desc limit 1;
select '897. and what Realtime hands a browser off that row: '
     || (select array_to_string(attnames, ', ') from pg_publication_tables
          where pubname = 'supabase_realtime' and tablename = 'event')
     || ' — `said_by` among them, or the bubbles stop with nothing to say why';

/*
 * And what is growing, which nobody had been told to look for.
 *
 * Reported from the island: "farming is broken, planting crops doesn't change
 * from an unfarmed field", and with it: make all the stages work with correct
 * timers.
 *
 * One omission under both. `rpc_ground` has never carried a row of `crop` — it
 * was found and wired up for `placed` and `crates` and the crops beside them
 * were missed — so sowing wrote a row nothing on the other side would ever
 * read. And `crop_settle` was only ever called by somebody touching that exact
 * tile, so a stage advanced when you interacted with it and at no other time.
 */
\echo ''
\echo '--- what is growing, and when it turns'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
delete from crop where world_id = :'world2' \g /dev/null
update player set x = 12.5, y = 12.5 where world_id = :'world2' and uid = :'ivar' \g /dev/null
select act_perform(:'world2', :'ivar', 'till', '{"kind":"tile","x":12,"y":12}'::jsonb) \g /dev/null
select give(:'world2', :'ivar', 'cotton_seed', 1, 40) \g /dev/null
select act_perform(:'world2', :'ivar', 'plant_seed',
  ('{"kind":"tile","x":12,"y":12,"itemUid":' || (select id from item where world_id = :'world2'
     and holder_uid = :'ivar' and def = 'cotton_seed' order by id desc limit 1) || '}')::jsonb) \g /dev/null
select jsonb_array_length((rpc_ground(:'world2', 40, true))->'crops') as sown_seen \gset
select '898. sown on a tilled field at 12,12: the island holds '
     || (select count(*) from crop where world_id = :'world2' and x = 12 and y = 12)
     || ' crop there, and what a browser reading the ground is handed: ' || :'sown_seen'
     || ' — which was 0 for every crop ever sown on this island, because the read never carried one';
select ((rpc_ground(:'world2', 40, true))->'crops'->0)::text as sown_row \gset
select '899. and what it says: ' || :'sown_row'
     || ' — the stage, and how long it has been in it, which is what the browser counts from';
-- Four stages at the crop's own pace, each one turned by the clock alone.
select stage_seconds as per from crop_def where id = 'cotton' \gset
select stage as s0 from crop where world_id = :'world2' and x = 12 and y = 12 \gset
update crop set stage_at = stage_at - make_interval(secs => :per) where world_id = :'world2' and x = 12 and y = 12 \g /dev/null
select crops_settle(:'world2', 12.5, 12.5, 40) \g /dev/null
select stage as s1 from crop where world_id = :'world2' and x = 12 and y = 12 \gset
update crop set stage_at = stage_at - make_interval(secs => :per) where world_id = :'world2' and x = 12 and y = 12 \g /dev/null
select crops_settle(:'world2', 12.5, 12.5, 40) \g /dev/null
select stage as s2 from crop where world_id = :'world2' and x = 12 and y = 12 \gset
update crop set stage_at = stage_at - make_interval(secs => :per * 4) where world_id = :'world2' and x = 12 and y = 12 \g /dev/null
select crops_settle(:'world2', 12.5, 12.5, 40) \g /dev/null
select '900. a stage of cotton is ' || :'per' || ' seconds, and standing the clock back one at a time: '
     || :'s0' || ' → ' || :'s1' || ' → ' || :'s2' || ' → '
     || (select stage from crop where world_id = :'world2' and x = 12 and y = 12)
     || ' of ' || crop_ripe()
     || ' — the last jump was four stages'' worth of waiting and it stops at ripe rather than running past it';
select '901. and ripe is what the doors say it is: tending "'
     || coalesce(act_refusal(:'world2', :'ivar', 'tend_crop', '{"kind":"tile","x":12,"y":12}'::jsonb), 'ALLOWED')
     || '", harvesting "'
     || coalesce(act_refusal(:'world2', :'ivar', 'harvest_crop', '{"kind":"tile","x":12,"y":12}'::jsonb), 'ALLOWED') || '"';

/*
 * And a tree pruned back a stage.
 *
 * Asked from the island: add Prune on trees to take their age back one stage,
 * only on old and mature trees. A stage back apiece, so an old tree that would
 * be gone when its day is up is a mature one instead — which is what pruning
 * is for — and a mature one is young again and stops bearing until it grows.
 */
\echo ''
\echo '--- a tree pruned back a stage'
select '902. what each age prunes to: ' || string_agg(
         lower(a.name) || ' → ' || coalesce(lower(b.name), 'left to grow'), '; ' order by a.hits, a.logs)
from tree_age_def a left join tree_age_def b on b.id = a.pruned;

select set_config('request.jwt.claims', json_build_object('sub', '77777777-7777-7777-7777-777777777777')::text, false) \g /dev/null
-- The four ages the rule was asked about, an oak apiece in a row — sapling,
-- young, old, mature — a forester who knows the work, and a sickle. Named
-- rather than walked off the table, which has grown since: the later stages
-- have their own measurements.
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; a int; v_x int := 50;
begin
  select id into w from world where name = 'Hoarding';
  delete from item where world_id = w and holder_uid = me and def = 'sickle';
  delete from event where uid = me;
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', me, 'sickle', 90, 1);
  update player set act = null, act_queue = '[]'::jsonb, seen_at = now(),
      stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1') where world_id = w and uid = me;
  insert into skill (world_id, uid, id, value) values (w, me, 'forestry', 90)
    on conflict (world_id, uid, id) do update set value = 90;
  foreach a in array array[3, 0, 2, 1] loop
    perform land_set_tile(w, v_x, 52, tile_id('Tree'));
    perform land_set_height(w, v_x, 52, 4);
    -- Species 2 is oak; the age goes in the bits over it.
    perform land_set_data(w, v_x, 52, 2 | (a << 4));
    v_x := v_x + 1;
  end loop;
end $$;
-- What the door says to each of the four, standing beside it.
create temp table prune_door (ord int, age text, said text);
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; v_x int;
begin
  select id into w from world where name = 'Hoarding';
  for v_x in 50..53 loop
    update player set x = v_x + 0.5, y = 51.5 where world_id = w and uid = me;
    insert into prune_door values (v_x,
      lower((select name from tree_age_def where id = tree_age(land_data(w, v_x, 52)))),
      coalesce(act_refusal(w, me, 'prune', ('{"kind":"tile","x":' || v_x || ',"y":52}')::jsonb), 'ALLOWED'));
  end loop;
end $$;
select '903. and what the door says to each: ' || string_agg(age || ' "' || said || '"', ' | ' order by ord)
from prune_door;

-- A stroke can glance even at ninety, so each pruning is swung at until the
-- age turns, which is what a forester does too.
create or replace function pg_temp.prune_until(p_x int, p_age int) returns int
  language plpgsql as $fn$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; i int;
begin
  select id into w from world where name = 'Hoarding';
  update player set x = p_x + 0.5, y = 51.5 where world_id = w and uid = me;
  for i in 1..8 loop
    exit when tree_age(land_data(w, p_x, 52)) = p_age;
    perform act_perform(w, me, 'prune', ('{"kind":"tile","x":' || p_x || ',"y":52}')::jsonb);
  end loop;
  return i;
end $fn$;
delete from event where uid = '77777777-7777-7777-7777-777777777777' \g /dev/null
select pg_temp.prune_until(52, 1) \g /dev/null
select '904. pruning the old oak: "'
     || (select text from event where uid = '77777777-7777-7777-7777-777777777777'
          and text like 'You prune%' order by n desc limit 1)
     || '" — the tile says ' || lower((select name from tree_age_def where id = tree_age(land_data(:'world6', 52, 52))))
     || ', and it is still an ' || lower((select name from tree_def where id = tree_species(land_data(:'world6', 52, 52))));
select pg_temp.prune_until(52, 0) \g /dev/null
select '905. and again: ' || lower((select name from tree_age_def where id = tree_age(land_data(:'world6', 52, 52))))
     || ', which no longer bears — and a third time: "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'prune', '{"kind":"tile","x":52,"y":52}'::jsonb), 'ALLOWED')
     || '"';

-- A notch is the trunk's, and pruning is the crown's.
do $$
declare w uuid;
begin
  select id into w from world where name = 'Hoarding';
  perform land_set_tile(w, 55, 52, tile_id('Tree'));
  perform land_set_height(w, 55, 52, 4);
  perform land_set_data(w, 55, 52, 2 | (1 << 4));   -- a mature oak
  perform tree_notch(w, 55, 52, 1);                 -- with one stroke in it
  perform land_set_tile(w, 56, 52, tile_id('Bush'));
  perform land_set_height(w, 56, 52, 4);
  perform land_set_data(w, 56, 52, 0);
end $$;
select pg_temp.prune_until(55, 0) \g /dev/null
select '906. a mature oak with a stroke in it, pruned: '
     || lower((select name from tree_age_def where id = tree_age(land_data(:'world6', 55, 52))))
     || ' with ' || tree_cuts(:'world6', 55, 52) || ' of '
     || (select hits from tree_age_def where id = tree_age(land_data(:'world6', 55, 52)))
     || ' strokes still in the trunk — a half-felled tree pruned back is still half felled';
update player set x = 56.5, y = 51.5 where world_id = :'world6' and uid = '77777777-7777-7777-7777-777777777777' \g /dev/null
select '907. and a bush: "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'prune', '{"kind":"tile","x":56,"y":52}'::jsonb), 'ALLOWED')
     || '"';

-- An old oak pruned and an old oak left alone, and the day that comes for both.
do $$
declare w uuid;
begin
  select id into w from world where name = 'Hoarding';
  perform land_set_tile(w, 57, 52, tile_id('Tree'));
  perform land_set_height(w, 57, 52, 4);
  perform land_set_data(w, 57, 52, 2 | (2 << 4));
  perform land_set_tile(w, 58, 52, tile_id('Tree'));
  perform land_set_height(w, 58, 52, 4);
  perform land_set_data(w, 58, 52, 2 | (2 << 4));
end $$;
select pg_temp.prune_until(57, 1) \g /dev/null
select pg_temp.one_day(:'world6') \g /dev/null
select '908. an old oak pruned and one beside it left alone, and a day later: the pruned one is '
     || case when land_tile(:'world6', 57, 52) = tile_id('Tree')
             then lower((select name from tree_age_def where id = tree_age(land_data(:'world6', 57, 52))))
             else 'gone' end
     || ' and the other is '
     || case when land_tile(:'world6', 58, 52) = tile_id('Tree')
             then lower((select name from tree_age_def where id = tree_age(land_data(:'world6', 58, 52))))
             else 'gone' end
     || ' — a day further on than the one taken back, and two days from gone; 915 takes the last of those days back too';


/*
 * And where the notch is kept: beside the land rather than in it.
 *
 * A tree's byte had four ages in two bits and the felling notch in the two
 * above, and a fifth stage was wanted. The notch is a row now, one per
 * half-felled tree, and the age has all four bits over the species.
 */
\echo ''
\echo '--- the notch beside the land'
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777';
begin
  select id into w from world where name = 'Hoarding';
  delete from event where uid = me;
  perform land_set_tile(w, 60, 52, tile_id('Tree'));
  perform land_set_height(w, 60, 52, 4);
  perform land_set_data(w, 60, 52, 2 | (1 << 4));   -- a mature oak
  update player set x = 60.5, y = 51.5 where world_id = w and uid = me;
  update skill set value = 90 where world_id = w and uid = me and id = 'woodcutting';
  -- One stroke that lands: swung at until it does.
  for i in 1..8 loop
    exit when tree_cuts(w, 60, 52) > 0;
    perform act_perform(w, me, 'cut_down', '{"kind":"tile","x":60,"y":52}'::jsonb);
  end loop;
end $$;
select '909. one stroke into a mature oak: the notch says ' || tree_cuts(:'world6', 60, 52)
     || ' of ' || (select hits from tree_age_def where id = tree_age(land_data(:'world6', 60, 52)))
     || ', kept in ' || (select count(*) from tree_notch where world_id = :'world6' and x = 60 and y = 52)
     || ' row beside the land, and the byte holds species ' || tree_species(land_data(:'world6', 60, 52))
     || ' and age ' || tree_age(land_data(:'world6', 60, 52))
     || ' with its top two bits ' || case when land_data(:'world6', 60, 52) >= 64 then 'set' else 'clear' end;
-- A day closes it.
select pg_temp.one_day(:'world6') \g /dev/null
select '910. and a day later the notch is ' || tree_cuts(:'world6', 60, 52)
     || ' and the tree is ' || lower((select name from tree_age_def where id = tree_age(land_data(:'world6', 60, 52))))
     || ' — a year''s growth closes whatever was cut into it';
-- And the tree coming down takes it with it.
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777';
begin
  select id into w from world where name = 'Hoarding';
  perform tree_notch(w, 60, 52, 2);
  for i in 1..8 loop
    exit when land_tile(w, 60, 52) <> tile_id('Tree');
    perform act_perform(w, me, 'cut_down', '{"kind":"tile","x":60,"y":52}'::jsonb);
  end loop;
end $$;
select '911. notched to 2 of 3 and felled: the tile is '
     || (select name from tile_def where id = land_tile(:'world6', 60, 52))
     || ' and the notch rows left for it: ' || (select count(*) from tree_notch where world_id = :'world6' and x = 60 and y = 52)
     || ' — forgotten at the one door every tile change goes through';


/*
 * The last two days of a tree, and a shrub.
 *
 * Asked from the island: a very old stage between old and gone — one more day
 * of life, the biggest timber, and a look that says prune me or lose me; a
 * shrivelled stage after it, a dead trunk for a day, felled for what timber is
 * in it and nothing else; and a sapling pruned into a shrub that never grows
 * and never dies. Every one of them is a row of the one table.
 */
\echo ''
\echo '--- the last two days of a tree, and a shrub'
with recursive life as (
  select a.*, 0 as step from tree_age_def a where a.id = tree_first()
  union all
  select b.*, l.step + 1 from life l join tree_age_def b on b.id = l.next and b.id <> l.id
)
select '912. the ladder, walked from the first stage: ' || string_agg(
         lower(name) || ' (' || hits || ' strokes, ' || logs || ' logs'
         || case when bears then ', bears' else '' end
         || case when alive then '' else ', dead' end
         || case when pruned is not null then ', prunes to ' || lower((select name from tree_age_def p where p.id = life.pruned)) else '' end
         || ')', ' → ' order by step)
     || ' → gone — and off the ladder: '
     || (select string_agg(lower(name) || ', whose next stage is itself', ', ') from tree_age_def where next = id)
from life;

select set_config('request.jwt.claims', json_build_object('sub', '77777777-7777-7777-7777-777777777777')::text, false) \g /dev/null
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777';
begin
  select id into w from world where name = 'Hoarding';
  delete from event where uid = me;
  -- A sapling oak, a very old oak, a shrivelled oak and a shrivelled apple, in a row.
  perform land_set_tile(w, 50, 54, tile_id('Tree')); perform land_set_height(w, 50, 54, 4); perform land_set_data(w, 50, 54, 2 | (3 << 4));
  perform land_set_tile(w, 51, 54, tile_id('Tree')); perform land_set_height(w, 51, 54, 4); perform land_set_data(w, 51, 54, 2 | (4 << 4));
  perform land_set_tile(w, 52, 54, tile_id('Tree')); perform land_set_height(w, 52, 54, 4); perform land_set_data(w, 52, 54, 2 | (5 << 4));
  perform land_set_tile(w, 53, 54, tile_id('Tree')); perform land_set_height(w, 53, 54, 4); perform land_set_data(w, 53, 54, 6 | (5 << 4));
  perform land_set_tile(w, 54, 54, tile_id('Tree')); perform land_set_height(w, 54, 54, 4); perform land_set_data(w, 54, 54, 6 | (4 << 4));
end $$;
create or replace function pg_temp.prune_row(p_x int, p_y int, p_age int) returns int
  language plpgsql as $fn$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; i int;
begin
  select id into w from world where name = 'Hoarding';
  update player set x = p_x + 0.5, y = p_y - 0.5 where world_id = w and uid = me;
  for i in 1..8 loop
    exit when tree_age(land_data(w, p_x, p_y)) = p_age;
    perform act_perform(w, me, 'prune', ('{"kind":"tile","x":' || p_x || ',"y":' || p_y || '}')::jsonb);
  end loop;
  return i;
end $fn$;
select pg_temp.prune_row(50, 54, 6) \g /dev/null
select '913. a sapling oak pruned: ' || lower((select name from tree_age_def where id = tree_age(land_data(:'world6', 50, 54))))
     || ' — "' || (select text from event where uid = '77777777-7777-7777-7777-777777777777' and text like 'You prune%' order by n desc limit 1) || '"';
select pg_temp.one_day(:'world6') \g /dev/null
select pg_temp.one_day(:'world6') \g /dev/null
select '914. and two days later it is ' || lower((select name from tree_age_def where id = tree_age(land_data(:'world6', 50, 54))))
     || ', and asked to prune it again: "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'prune', '{"kind":"tile","x":50,"y":54}'::jsonb), 'ALLOWED')
     || '" — a shrub for good';
-- Two days have passed for the whole row: the very old oak is gone and the shrivelled ones with it. Set them again.
do $$
declare w uuid;
begin
  select id into w from world where name = 'Hoarding';
  perform land_set_tile(w, 51, 54, tile_id('Tree')); perform land_set_data(w, 51, 54, 2 | (4 << 4));
  perform land_set_tile(w, 52, 54, tile_id('Tree')); perform land_set_data(w, 52, 54, 2 | (5 << 4));
  perform land_set_tile(w, 53, 54, tile_id('Tree')); perform land_set_data(w, 53, 54, 6 | (5 << 4));
  perform land_set_tile(w, 54, 54, tile_id('Tree')); perform land_set_data(w, 54, 54, 6 | (4 << 4));
  update player set x = 51.5, y = 53.5 where world_id = w and uid = '77777777-7777-7777-7777-777777777777';
end $$;
select '915. a very old oak, the door: "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'prune', '{"kind":"tile","x":51,"y":54}'::jsonb), 'ALLOWED')
     || '"' as very_old_door \gset
select pg_temp.prune_row(51, 54, 2) \g /dev/null
select :'very_old_door' || ', and pruned: ' || lower((select name from tree_age_def where id = tree_age(land_data(:'world6', 51, 54))))
     || ' — the last day it could be taken back, taken back';
update player set x = 52.5, y = 53.5 where world_id = :'world6' and uid = '77777777-7777-7777-7777-777777777777' \g /dev/null
select '916. a shrivelled oak: pruning "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'prune', '{"kind":"tile","x":52,"y":54}'::jsonb), 'ALLOWED')
     || '", a sprout "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'pick_sprout', '{"kind":"tile","x":52,"y":54}'::jsonb), 'ALLOWED')
     || '", felling "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'cut_down', '{"kind":"tile","x":52,"y":54}'::jsonb), 'ALLOWED')
     || '"';
update player set x = 53.5, y = 53.5 where world_id = :'world6' and uid = '77777777-7777-7777-7777-777777777777' \g /dev/null
select coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'pick_fruit', '{"kind":"tile","x":53,"y":54}'::jsonb), 'ALLOWED') as dead_fruit \gset
update player set x = 54.5, y = 53.5 where world_id = :'world6' and uid = '77777777-7777-7777-7777-777777777777' \g /dev/null
select '917. and a shrivelled apple beside a very old one: fruit off the dead one "' || :'dead_fruit'
     || '", and off the very old one "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'pick_fruit', '{"kind":"tile","x":54,"y":54}'::jsonb), 'ALLOWED')
     || '"';
-- Felling the dead oak: dead wood, still timber.
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; i int;
begin
  select id into w from world where name = 'Hoarding';
  delete from item where world_id = w and holder_uid = me and def = 'log';
  delete from event where uid = me;
  update player set x = 52.5, y = 53.5 where world_id = w and uid = me;
  for i in 1..8 loop
    exit when land_tile(w, 52, 54) <> tile_id('Tree');
    perform act_perform(w, me, 'cut_down', '{"kind":"tile","x":52,"y":54}'::jsonb);
  end loop;
end $$;
select '918. felling it: "' || (select string_agg(text, '" "' order by n) from event
          where uid = '77777777-7777-7777-7777-777777777777' and (text like '%cut into%' or text like '%comes down%'))
     || '" — ' || coalesce((select sum(count) from item where world_id = :'world6'
          and holder_uid = '77777777-7777-7777-7777-777777777777' and def = 'log'), 0) || ' logs of dead wood';


/*
 * What a felled tree leaves.
 *
 * Asked from the island: a felled tree leaves a stump tile you must dig out,
 * or that rots after a day. A tree with timber in it leaves one; a sapling
 * cleared away does not. A stump is walked over and in the way of everything
 * else — no planting, no paving, no building, no digging its corners — until
 * a shovel takes it out or the day does.
 */
\echo ''
\echo '--- what a felled tree leaves'
select set_config('request.jwt.claims', json_build_object('sub', '77777777-7777-7777-7777-777777777777')::text, false) \g /dev/null
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; i int;
begin
  select id into w from world where name = 'Hoarding';
  delete from item where world_id = w and holder_uid = me and def in ('shovel', 'log');
  delete from event where uid = me;
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', me, 'shovel', 80, 1);
  insert into skill (world_id, uid, id, value) values (w, me, 'digging', 60)
    on conflict (world_id, uid, id) do update set value = 60;
  -- A mature oak and a sapling pine, felled.
  perform land_set_tile(w, 50, 56, tile_id('Tree')); perform land_set_height(w, 50, 56, 4); perform land_set_data(w, 50, 56, 2 | (1 << 4));
  perform land_set_tile(w, 51, 56, tile_id('Tree')); perform land_set_height(w, 51, 56, 4); perform land_set_data(w, 51, 56, 1 | (3 << 4));
  update player set x = 50.5, y = 55.5 where world_id = w and uid = me;
  for i in 1..8 loop
    exit when land_tile(w, 50, 56) <> tile_id('Tree');
    perform act_perform(w, me, 'cut_down', '{"kind":"tile","x":50,"y":56}'::jsonb);
  end loop;
  update player set x = 51.5, y = 55.5 where world_id = w and uid = me;
  for i in 1..8 loop
    exit when land_tile(w, 51, 56) <> tile_id('Tree');
    perform act_perform(w, me, 'cut_down', '{"kind":"tile","x":51,"y":56}'::jsonb);
  end loop;
end $$;
select '919. a mature oak felled leaves ' || (select name from tile_def where id = land_tile(:'world6', 50, 56))
     || ' — "' || (select text from event where uid = '77777777-7777-7777-7777-777777777777' and text like '%comes down%' order by n desc limit 1)
     || '" — an ' || lower((select name from tree_def where id = tree_species(land_data(:'world6', 50, 56))))
     || ' stump; and a sapling pine cleared leaves ' || (select name from tile_def where id = land_tile(:'world6', 51, 56));
update player set x = 50.5, y = 55.5 where world_id = :'world6' and uid = '77777777-7777-7777-7777-777777777777' \g /dev/null
select '920. what the stump is in the way of: planting "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'plant', '{"kind":"tile","x":50,"y":56}'::jsonb), 'ALLOWED')
     || '", digging a corner "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'dig', '{"kind":"tile","x":50,"y":56,"cx":50,"cy":56}'::jsonb), 'ALLOWED')
     || '", and digging it out "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'dig_stump', '{"kind":"tile","x":50,"y":56}'::jsonb), 'ALLOWED')
     || '" — and asked of the grass beside it: "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'dig_stump', '{"kind":"tile","x":51,"y":56}'::jsonb), 'ALLOWED') || '"';
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; i int;
begin
  select id into w from world where name = 'Hoarding';
  delete from event where uid = me;
  for i in 1..8 loop
    exit when land_tile(w, 50, 56) <> tile_id('Stump');
    perform act_perform(w, me, 'dig_stump', '{"kind":"tile","x":50,"y":56}'::jsonb);
  end loop;
end $$;
select '921. and dug out: ' || (select name from tile_def where id = land_tile(:'world6', 50, 56))
     || ' — "' || (select text from event where uid = '77777777-7777-7777-7777-777777777777' and text like '%stump%' order by n desc limit 1) || '"';
-- A stump left alone, and the day.
do $$
declare w uuid;
begin
  select id into w from world where name = 'Hoarding';
  -- Well away from anything that could die and seed a sapling onto it the same day.
  perform land_set_tile(w, 62, 58, tile_id('Stump')); perform land_set_height(w, 62, 58, 4); perform land_set_data(w, 62, 58, 2);
end $$;
select examine_tile_text(:'world6', 62, 58) as stump_look \gset
select pg_temp.one_day(:'world6') \g /dev/null
select '922. what the island says of a stump: "' || :'stump_look'
     || '" — and a stump left a day is ' || (select name from tile_def where id = land_tile(:'world6', 62, 58));


/*
 * The sickle: the forester's own blade.
 *
 * Asked from the island. Pruning was done with the hatchet because the island
 * had no sickle; it has one now, cast at the anvil and fitted to a handle like
 * the hatchet, and Prune is its. It cuts what a bush has on it as well — rose
 * petals and lavender, both dyestuffs — and a thorn bush has nothing on it
 * worth the blade.
 */
\echo ''
\echo '--- the sickle'
select '923. the sickle, off the tables: a mould that makes ' || (select makes from mould_def where id = 'sickle_blade_mould')
     || ' for ' || (select lumps from mould_def where id = 'sickle_blade_mould') || ' lump, a recipe that fits it — "'
     || (select label from recipe where id = 'fit_sickle_blade') || '" for ' || (select result from recipe where id = 'fit_sickle_blade')
     || ' — and what Prune asks for now: ' || (select tool from action_def where id = 'prune');
select '924. what a sickle cuts off a bush: ' || string_agg(lower(name) || ' → ' || coalesce(yields, 'nothing worth the blade'), '; ' order by id)
from bush_def;
select set_config('request.jwt.claims', json_build_object('sub', '77777777-7777-7777-7777-777777777777')::text, false) \g /dev/null
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777';
begin
  select id into w from world where name = 'Hoarding';
  delete from item where world_id = w and holder_uid = me and def in ('rose_petals', 'lavender');
  delete from event where uid = me;
  -- A rose bush, a thorn bush and a lavender bush in a row.
  perform land_set_tile(w, 50, 58, tile_id('Bush')); perform land_set_height(w, 50, 58, 4); perform land_set_data(w, 50, 58, 0);
  perform land_set_tile(w, 51, 58, tile_id('Bush')); perform land_set_height(w, 51, 58, 4); perform land_set_data(w, 51, 58, 1);
  perform land_set_tile(w, 52, 58, tile_id('Bush')); perform land_set_height(w, 52, 58, 4); perform land_set_data(w, 52, 58, 2);
  update player set x = 50.5, y = 57.5 where world_id = w and uid = me;
  perform act_perform(w, me, 'harvest_bush', '{"kind":"tile","x":50,"y":58}'::jsonb);
end $$;
select '925. a rose bush, with the sickle: "'
     || (select text from event where uid = '77777777-7777-7777-7777-777777777777' and text like 'You cut%' order by n desc limit 1)
     || '" — ' || coalesce((select sum(count) from item where world_id = :'world6' and holder_uid = '77777777-7777-7777-7777-777777777777' and def = 'rose_petals'), 0)
     || ' rose petals in the pack, and asked again: "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'harvest_bush', '{"kind":"tile","x":50,"y":58}'::jsonb), 'ALLOWED') || '"';
update player set x = 51.5, y = 57.5 where world_id = :'world6' and uid = '77777777-7777-7777-7777-777777777777' \g /dev/null
select coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'harvest_bush', '{"kind":"tile","x":51,"y":58}'::jsonb), 'ALLOWED') as thorn_said \gset
update player set x = 52.5, y = 57.5 where world_id = :'world6' and uid = '77777777-7777-7777-7777-777777777777' \g /dev/null
select '926. a thorn bush: "' || :'thorn_said' || '", and a lavender bush: "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'harvest_bush', '{"kind":"tile","x":52,"y":58}'::jsonb), 'ALLOWED') || '"';
-- And without the blade.
update item set holder_uid = '00000000-0000-0000-0000-000000000000' where world_id = :'world6' and holder_uid = '77777777-7777-7777-7777-777777777777' and def = 'sickle' \g /dev/null
select '927. and with no sickle in hand, pruning: "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'prune', '{"kind":"tile","x":52,"y":58}'::jsonb), 'ALLOWED')
     || '" — the hatchet does not do any more';
update item set holder_uid = '77777777-7777-7777-7777-777777777777' where world_id = :'world6' and holder_uid = '00000000-0000-0000-0000-000000000000' and def = 'sickle' \g /dev/null

/*
 * A snedda set to prune, and a grubba set to dig out stumps.
 *
 * Asked from the island: wildermon foresters set to prune, and a stumping
 * wildermon — each its own kind. A snedda prunes only what would otherwise
 * die — a stage that prunes back and whose next stage has no life in it — and
 * nothing else, because a mature tree pruned stops bearing and a sapling
 * pruned is a shrub for good. A grubba digs out stumps. A bevere fells, and is
 * set to nothing else.
 */
\echo ''
\echo '--- a snedda set to prune, and a grubba set to dig out stumps'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select '928. the two new wildermon: ' || (select string_agg(name || ' gathers ' || gathers || ', near trees ' || near_trees, '; ' order by id) from species_def where id in ('snedda', 'grubba'))
     || ' — and a bevere is set to nothing but felling: trades ' || coalesce(array_to_string((select trades from species_def where id = 'bevere'), ', '), 'none')
     || ' — the two trades as the island knows them: '
     || (select string_agg(id || ' (' || skill || ', ' || plain || ')', '; ' order by id) from gather_def where id in ('prune', 'stump'))
     || ' — ported: ' || worker_job_ported('prune') || ' and ' || worker_job_ported('stump')
     || ' — and wild: ' || (select string_agg(species || ' ' || weight, ', ' order by species) from wild_table where species in ('snedda', 'grubba'));
-- Room on the deed: every worker of Ivar's stood down, and a fresh snedda, a
-- grubba and a bevere kept at the token.
update creature set mode = 'stored', job = null where world_id = :'world2' and keeper = :'ivar' and mode = 'deed' \g /dev/null
select x as tok_x, y as tok_y from deed where world_id = :'world2' and founded_by = :'ivar' \gset
select creature_spawn(:'world2', 'snedda', :tok_x + 0.5, :tok_y + 1.5, 'stored', now() - interval '3 hours', :'ivar') as pruner \gset
select creature_spawn(:'world2', 'grubba', :tok_x + 0.5, :tok_y + 1.5, 'stored', now() - interval '3 hours', :'ivar') as stumper \gset
select creature_spawn(:'world2', 'bevere', :tok_x + 0.5, :tok_y + 1.5, 'stored', now() - interval '3 hours', :'ivar') as feller2 \gset
select '929. setting the snedda to farm: "'
     || coalesce(act_refusal(:'world2', :'ivar', 'assign_deed', ('{"kind":"creature","id":' || :'pruner' || ',"job":"farm"}')::jsonb), 'ALLOWED')
     || '", to prune: "'
     || coalesce(act_refusal(:'world2', :'ivar', 'assign_deed', ('{"kind":"creature","id":' || :'pruner' || ',"job":"prune"}')::jsonb), 'ALLOWED')
     || '" — and the bevere to prune: "'
     || coalesce(act_refusal(:'world2', :'ivar', 'assign_deed', ('{"kind":"creature","id":' || :'feller2' || ',"job":"prune"}')::jsonb), 'ALLOWED') || '"';
-- A very old oak and an old oak within reach of the token, and a stump, with
-- grass either side to stand on.
create or replace function pg_temp.stand_the_wood(p_world uuid, p_uid uuid) returns void
  language plpgsql as $fn$
declare dd deed; gx int; gy int;
begin
  dd := my_deed(p_world, p_uid);
  -- Level ground under the whole stand, so a worker can stand beside a tree:
  -- since a body has had a slope it can stand on, one corner set to four
  -- against corners at fifty made every tile round it a cliff face.
  for gx in dd.x + 1 .. dd.x + 6 loop for gy in dd.y - 1 .. dd.y + 3 loop
    perform land_set_height(p_world, gx, gy, 4);
  end loop; end loop;
  perform land_set_tile(p_world, dd.x + 3, dd.y, tile_id('Tree')); perform land_set_height(p_world, dd.x + 3, dd.y, 4); perform land_set_data(p_world, dd.x + 3, dd.y, 2 | (4 << 4));
  perform land_set_tile(p_world, dd.x + 4, dd.y, tile_id('Tree')); perform land_set_height(p_world, dd.x + 4, dd.y, 4); perform land_set_data(p_world, dd.x + 4, dd.y, 2 | (2 << 4));
  perform land_set_tile(p_world, dd.x + 3, dd.y + 2, tile_id('Stump')); perform land_set_height(p_world, dd.x + 3, dd.y + 2, 4); perform land_set_data(p_world, dd.x + 3, dd.y + 2, 2);
  perform land_set_tile(p_world, dd.x + 2, dd.y, tile_id('Grass')); perform land_set_data(p_world, dd.x + 2, dd.y, 0);
  perform land_set_tile(p_world, dd.x + 5, dd.y, tile_id('Grass')); perform land_set_data(p_world, dd.x + 5, dd.y, 0);
  perform land_set_tile(p_world, dd.x + 3, dd.y + 1, tile_id('Grass')); perform land_set_data(p_world, dd.x + 3, dd.y + 1, 0);
end $fn$;
select pg_temp.stand_the_wood(:'world2', :'ivar') \g /dev/null
delete from event where uid = :'ivar' \g /dev/null
select act_perform(:'world2', :'ivar', 'assign_deed', ('{"kind":"creature","id":' || :'pruner' || '}')::jsonb) \g /dev/null
select '930. the snedda set to work, no trade named: the island holds job = ' || (select job from creature where world_id = :'world2' and id = :'pruner')
     || ', and says "' || (select text from event where uid = :'ivar' order by n desc limit 1) || '"';
update creature set until = until - interval '1200 seconds', leg_at = leg_at - interval '1200 seconds',
    leg_ends = leg_ends - interval '1200 seconds', settled_at = settled_at - interval '1200 seconds'
  where id = :'pruner';
select worker_settle(:'world2', :'pruner') as prune_rounds \gset
select '931. twenty minutes of it, ' || :'prune_rounds' || ' rounds: the very old oak is '
     || lower((select name from tree_age_def where id = tree_age(land_data(:'world2', :tok_x + 3, :tok_y))))
     || ' and the old oak beside it is still '
     || lower((select name from tree_age_def where id = tree_age(land_data(:'world2', :tok_x + 4, :tok_y))))
     || ' — a snedda prunes what would otherwise die, and nothing else';
update creature set mode = 'stored', job = null where world_id = :'world2' and id = :'pruner' \g /dev/null
select act_perform(:'world2', :'ivar', 'assign_deed', ('{"kind":"creature","id":' || :'stumper' || '}')::jsonb) \g /dev/null
update creature set until = until - interval '1200 seconds', leg_at = leg_at - interval '1200 seconds',
    leg_ends = leg_ends - interval '1200 seconds', settled_at = settled_at - interval '1200 seconds'
  where id = :'stumper';
select worker_settle(:'world2', :'stumper') as stump_rounds \gset
update creature set job = 'prune' where world_id = :'world2' and id = :'feller2' \g /dev/null
select trades_settled(:'world2') as settled \gset
select '932. the grubba set to work, job = ' || (select job from creature where world_id = :'world2' and id = :'stumper') || ', twenty minutes of it: the stump is '
     || (select name from tile_def where id = land_tile(:'world2', :tok_x + 3, :tok_y + 2))
     || ' — and what a browser is handed for it: job ' || coalesce((select x->>'job' from jsonb_array_elements(rpc_creatures(:'world2', 40)) x where (x->>'id')::int = :'stumper'), 'NOTHING')
     || '. And a bevere left set to prune from before its trades went: put back to felling, '
     || :'settled' || ' settled, job now ' || coalesce((select job from creature where world_id = :'world2' and id = :'feller2'), 'none') as m932 \gset
select :'m932';

/*
 * Grafting: a fruit sprout onto a wild tree.
 *
 * Asked from the island. A forester at fifty grafts an apple, cherry or olive
 * sprout onto a living tree that does not bear, with a carving knife, and the
 * tree is that kind from then on — at the age it was, notch and all. A graft
 * that does not take is a sprout spent. An orchard without felling a thing.
 */
\echo ''
\echo '--- grafting'
select set_config('request.jwt.claims', json_build_object('sub', '77777777-7777-7777-7777-777777777777')::text, false) \g /dev/null
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777';
begin
  select id into w from world where name = 'Hoarding';
  delete from item where world_id = w and holder_uid = me and def in ('sprout', 'carving_knife');
  delete from event where uid = me;
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', me, 'carving_knife', 80, 1);
  insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (w, 'player', me, 'sprout', 50, 6, 'Apple');
  insert into item (world_id, holder, holder_uid, def, ql, count, extra) values (w, 'player', me, 'sprout', 50, 1, 'Birch');
  insert into skill (world_id, uid, id, value) values (w, me, 'forestry', 40)
    on conflict (world_id, uid, id) do update set value = 40;
  -- A mature oak with a stroke in it, a mature apple, and a shrivelled pine.
  perform land_set_tile(w, 50, 60, tile_id('Tree')); perform land_set_height(w, 50, 60, 4); perform land_set_data(w, 50, 60, 2 | (1 << 4)); perform tree_notch(w, 50, 60, 1);
  perform land_set_tile(w, 51, 60, tile_id('Tree')); perform land_set_height(w, 51, 60, 4); perform land_set_data(w, 51, 60, 6 | (1 << 4));
  perform land_set_tile(w, 52, 60, tile_id('Tree')); perform land_set_height(w, 52, 60, 4); perform land_set_data(w, 52, 60, 1 | (5 << 4));
  update player set x = 50.5, y = 59.5 where world_id = w and uid = me;
end $$;
select '933. at forestry 40, grafting: "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'graft', '{"kind":"tile","x":50,"y":60}'::jsonb), 'ALLOWED') || '"';
update skill set value = 50 where world_id = :'world6' and uid = '77777777-7777-7777-7777-777777777777' and id = 'forestry' \g /dev/null
select '934. at fifty: the oak "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'graft', '{"kind":"tile","x":50,"y":60}'::jsonb), 'ALLOWED')
     || '", with the birch sprout named "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'graft',
          ('{"kind":"tile","x":50,"y":60,"itemUid":' || (select id from item where world_id = :'world6' and holder_uid = '77777777-7777-7777-7777-777777777777' and def = 'sprout' and extra = 'Birch') || '}')::jsonb), 'ALLOWED')
     || '"' as oak_doors \gset
update player set x = 51.5, y = 59.5 where world_id = :'world6' and uid = '77777777-7777-7777-7777-777777777777' \g /dev/null
select coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'graft', '{"kind":"tile","x":51,"y":60}'::jsonb), 'ALLOWED') as apple_door \gset
update player set x = 52.5, y = 59.5 where world_id = :'world6' and uid = '77777777-7777-7777-7777-777777777777' \g /dev/null
select :'oak_doors' || ', the apple "' || :'apple_door' || '", the shrivelled pine "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'graft', '{"kind":"tile","x":52,"y":60}'::jsonb), 'ALLOWED') || '"';
-- The graft, tried until it takes: a stroke of the knife glances like any other.
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; i int;
begin
  select id into w from world where name = 'Hoarding';
  delete from event where uid = me;
  update player set x = 50.5, y = 59.5 where world_id = w and uid = me;
  for i in 1..6 loop
    exit when tree_species(land_data(w, 50, 60)) = 6;
    perform act_perform(w, me, 'graft', '{"kind":"tile","x":50,"y":60}'::jsonb);
  end loop;
end $$;
select '935. grafted: the tree at 50,60 is a ' || lower((select name from tree_age_def where id = tree_age(land_data(:'world6', 50, 60))))
     || ' ' || lower((select name from tree_def where id = tree_species(land_data(:'world6', 50, 60))))
     || ' with ' || tree_cuts(:'world6', 50, 60) || ' stroke still in it — "'
     || (select text from event where uid = '77777777-7777-7777-7777-777777777777' and text like 'You graft%' order by n desc limit 1)
     || '" — and the sprouts spent on it: ' || (6 - coalesce((select sum(count) from item where world_id = :'world6' and holder_uid = '77777777-7777-7777-7777-777777777777' and def = 'sprout' and extra = 'Apple'), 0))
     || ' of 6, the birch sprout untouched: ' || coalesce((select sum(count) from item where world_id = :'world6' and holder_uid = '77777777-7777-7777-7777-777777777777' and def = 'sprout' and extra = 'Birch'), 0);
select '936. and the journal counts it as an orchard planted: ' || (select coalesce(tally->>'orchard', '0') from player where world_id = :'world6' and uid = '77777777-7777-7777-7777-777777777777');

/*
 * Look says what a tree is, what is in it, what is coming, and what to do.
 *
 * Asked from the island: Look shows the age and what is next — an old oak,
 * gone in nine hours, prune it to keep it. The hour was always on the island
 * and the notch beside the land; nothing had been told to say them.
 */
\echo ''
\echo '--- what Look says of a tree'
select set_config('request.jwt.claims', json_build_object('sub', '77777777-7777-7777-7777-777777777777')::text, false) \g /dev/null
do $$
declare w uuid;
begin
  select id into w from world where name = 'Hoarding';
  -- The woods turned over nine hours ago, so they turn again in fifteen.
  update world set trees_at = now() - interval '9 hours' where id = w;
  perform land_set_tile(w, 50, 62, tile_id('Tree')); perform land_set_height(w, 50, 62, 4); perform land_set_data(w, 50, 62, 2 | (4 << 4));   -- a very old oak
  perform land_set_tile(w, 51, 62, tile_id('Tree')); perform land_set_height(w, 51, 62, 4); perform land_set_data(w, 51, 62, 2 | (1 << 4)); perform tree_notch(w, 51, 62, 2);   -- a mature oak, two strokes in
  perform land_set_tile(w, 52, 62, tile_id('Tree')); perform land_set_height(w, 52, 62, 4); perform land_set_data(w, 52, 62, 2 | (6 << 4));   -- clipped
  perform land_set_tile(w, 53, 62, tile_id('Tree')); perform land_set_height(w, 53, 62, 4); perform land_set_data(w, 53, 62, 1 | (5 << 4));   -- a shrivelled pine
  update player set x = 51.5, y = 61.5 where world_id = w and uid = '77777777-7777-7777-7777-777777777777';
end $$;
select '937. a very old oak: "' || examine_tile_text(:'world6', 50, 62) || '"';
select '938. a mature oak with two strokes in it: "' || examine_tile_text(:'world6', 51, 62) || '"';
select '939. a clipped oak: "' || examine_tile_text(:'world6', 52, 62) || '"';
select '940. a shrivelled pine: "' || examine_tile_text(:'world6', 53, 62) || '"';
select '941. and what the ground read hands a browser for it: notches ' || ((rpc_ground(:'world6', 40, true))->'notches')::text
     || ', the woods turned over ' || round(((rpc_ground(:'world6', 40, true))->>'treesAgo')::numeric / 3600) || ' hours ago'
     || ' — and the fast half says nothing about either: ' || coalesce(((rpc_ground(:'world6', 40, false))->'notches')::text, 'nothing');

/*
 * A spadeful of clay or sand lays down the ground it was.
 *
 * Asked from the island: clay and sand as ground you can lay. Dropped, a
 * spadeful raised the corner and covered the ground with dirt whatever was in
 * it; now dirt makes dirt, clay makes clay and sand makes sand.
 */
\echo ''
\echo '--- a spadeful of clay or sand'
select set_config('request.jwt.claims', json_build_object('sub', '77777777-7777-7777-7777-777777777777')::text, false) \g /dev/null
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; i int; j int;
begin
  select id into w from world where name = 'Hoarding';
  delete from item where world_id = w and holder_uid = me and def in ('dirt', 'clay', 'sand');
  delete from event where uid = me;
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', me, 'clay', 40, 3);
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', me, 'sand', 40, 3);
  insert into skill (world_id, uid, id, value) values (w, me, 'digging', 60) on conflict (world_id, uid, id) do update set value = 60;
  -- A flat patch of grass, level at four, well inside the island's sixty-four.
  for j in 40..43 loop for i in 40..43 loop
    perform land_set_tile(w, i, j, tile_id('Grass')); perform land_set_data(w, i, j, 0); perform land_set_height(w, i, j, 4);
  end loop; end loop;
  update player set x = 41.5, y = 40.5 where world_id = w and uid = me;
end $$;
select land_height(:'world6', 41, 41) as h0 \gset
select act_perform(:'world6', '77777777-7777-7777-7777-777777777777', 'drop_dirt',
  ('{"kind":"tile","x":41,"y":41,"cx":41,"cy":41,"itemUid":' || (select id from item where world_id = :'world6' and holder_uid = '77777777-7777-7777-7777-777777777777' and def = 'clay') || '}')::jsonb) \g /dev/null
select '942. clay dropped on a grass corner: the ground is ' || (select name from tile_def where id = land_tile(:'world6', 41, 41))
     || ', the corner rose from ' || :'h0' || ' to ' || land_height(:'world6', 41, 41)
     || ' — "' || (select text from event where uid = '77777777-7777-7777-7777-777777777777' and text like 'You drop%' order by n desc limit 1) || '"';
select act_perform(:'world6', '77777777-7777-7777-7777-777777777777', 'drop_dirt',
  ('{"kind":"tile","x":41,"y":41,"cx":41,"cy":41,"itemUid":' || (select id from item where world_id = :'world6' and holder_uid = '77777777-7777-7777-7777-777777777777' and def = 'sand') || '}')::jsonb) \g /dev/null
select '943. and sand on the same corner: ' || (select name from tile_def where id = land_tile(:'world6', 41, 41))
     || ' — and asked with nothing named, what goes down first: ' || spoil_in_hand(:'world6', '77777777-7777-7777-7777-777777777777', null);
select '944. a log named: "' || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'drop_dirt',
        ('{"kind":"tile","x":41,"y":41,"cx":41,"cy":41,"itemUid":' || (select id from item where world_id = :'world6' and holder_uid = '77777777-7777-7777-7777-777777777777' and def = 'log' order by id desc limit 1) || '}')::jsonb), 'ALLOWED')
     || '"' as named_log \gset
-- The three out of the pack, the door asked, and back again.
update item set holder_uid = '00000000-0000-0000-0000-000000000000' where world_id = :'world6' and holder_uid = '77777777-7777-7777-7777-777777777777' and def in ('dirt', 'clay', 'sand') \g /dev/null
select :'named_log' || ' — and with none of the three in the pack: "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'drop_dirt', '{"kind":"tile","x":41,"y":41,"cx":41,"cy":41}'::jsonb), 'ALLOWED') || '"';
update item set holder_uid = '77777777-7777-7777-7777-777777777777' where world_id = :'world6' and holder_uid = '00000000-0000-0000-0000-000000000000' and def in ('dirt', 'clay', 'sand') \g /dev/null

/*
 * Raising rock with concrete.
 *
 * Asked from the island. The only way to build up on rock was dirt, which
 * slides off it. Mortar worked stiff with ashes is concrete, and a lot of it
 * raises a bare rock corner by one: on soil it is refused, under water it
 * will not set, and the slope it would make is the mason's to answer for as
 * a digger answers for a spadeful.
 */
\echo ''
\echo '--- raising rock with concrete'
select '945. concrete, off the tables: "' || (select label from recipe where id = 'mix_concrete') || '" — '
     || (select string_agg(item || ' × ' || count, ' + ' order by ord) from recipe_input where recipe = 'mix_concrete')
     || ' → ' || (select result from recipe where id = 'mix_concrete') || ' (' || (select skill from recipe where id = 'mix_concrete') || ')'
     || ' — and what raising the rock asks for: ' || (select tool from action_def where id = 'raise_rock') || ', ' || (select skill from action_def where id = 'raise_rock');
select set_config('request.jwt.claims', json_build_object('sub', '77777777-7777-7777-7777-777777777777')::text, false) \g /dev/null
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; i int; j int;
begin
  select id into w from world where name = 'Hoarding';
  delete from item where world_id = w and holder_uid = me and def in ('concrete', 'trowel');
  delete from event where uid = me;
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', me, 'trowel', 80, 1);
  insert into item (world_id, holder, holder_uid, def, ql, count) values (w, 'player', me, 'concrete', 50, 6);
  insert into skill (world_id, uid, id, value) values (w, me, 'masonry', 70) on conflict (world_id, uid, id) do update set value = 70;
  -- Bare rock at four, and one corner of soil beside it, and a corner under water.
  for j in 40..43 loop for i in 45..48 loop
    perform land_set_tile(w, i, j, tile_id('Rock')); perform land_set_data(w, i, j, 0);
    perform land_set_height(w, i, j, 4); perform land_set_dirt(w, i, j, 0);
  end loop; end loop;
  perform land_set_dirt(w, 47, 41, 2);
  perform land_set_height(w, 48, 43, -3);
  update player set x = 46.5, y = 40.5 where world_id = w and uid = me;
end $$;
select land_height(:'world6', 46, 41) as r0 \gset
select '946. the doors: bare rock "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'raise_rock', '{"kind":"tile","x":46,"y":41,"cx":46,"cy":41}'::jsonb), 'ALLOWED')
     || '", a corner with soil on it "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'raise_rock', '{"kind":"tile","x":46,"y":41,"cx":47,"cy":41}'::jsonb), 'ALLOWED')
     || '"' as doors1 \gset
update player set x = 47.5, y = 42.5 where world_id = :'world6' and uid = '77777777-7777-7777-7777-777777777777' \g /dev/null
select :'doors1' || ', a corner under water "'
     || coalesce(act_refusal(:'world6', '77777777-7777-7777-7777-777777777777', 'raise_rock', '{"kind":"tile","x":47,"y":42,"cx":48,"cy":43}'::jsonb), 'ALLOWED') || '"';
-- Laid until it sets: concrete that slumps off is concrete gone.
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; i int;
begin
  select id into w from world where name = 'Hoarding';
  update player set x = 46.5, y = 40.5 where world_id = w and uid = me;
  for i in 1..6 loop
    exit when land_height(w, 46, 41) > 4;
    perform act_perform(w, me, 'raise_rock', '{"kind":"tile","x":46,"y":41,"cx":46,"cy":41}'::jsonb);
  end loop;
end $$;
select '947. laid: the corner is ' || land_height(:'world6', 46, 41) || ' from ' || :'r0' || ', with ' || land_dirt(:'world6', 46, 41)
     || ' soil over it — "' || (select text from event where uid = '77777777-7777-7777-7777-777777777777' and text like 'You lay concrete%' order by n desc limit 1)
     || '" — concrete spent: ' || (6 - coalesce((select sum(count) from item where world_id = :'world6' and holder_uid = '77777777-7777-7777-7777-777777777777' and def = 'concrete'), 0)) || ' of 6';

/*
 * Grass kept cut on a deed becomes lawn.
 *
 * Asked from the island: lawn you can grow. Cut grass on a deed tile three
 * days running and it is lawn; a day with no cut starts the count over; off a
 * deed, cutting counts nothing.
 */
\echo ''
\echo '--- grass kept cut on a deed becomes lawn'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select x - 2 as lx, y - 2 as ly from deed where world_id = :'world2' and founded_by = :'ivar' \gset
-- Two grass tiles on the deed, and Ivar beside them.
select land_set_tile(:'world2', :lx, :ly, tile_id('Grass')), land_set_data(:'world2', :lx, :ly, 0) \g /dev/null
select land_set_tile(:'world2', :lx + 1, :ly, tile_id('Grass')), land_set_data(:'world2', :lx + 1, :ly, 0) \g /dev/null
update player set x = :lx + 0.5, y = :ly - 0.5 where world_id = :'world2' and uid = :'ivar';
delete from event where uid = :'ivar';
select act_perform(:'world2', :'ivar', 'cut_grass', ('{"kind":"tile","x":' || :lx || ',"y":' || :ly || '}')::jsonb) \g /dev/null
select '948. grass cut on the deed: the tile holds ' || land_data(:'world2', :lx, :ly) || ' (cut today, 0 days) — "'
     || (select text from event where uid = :'ivar' and text like 'You cut%' order by n desc limit 1)
     || '" — and Look: "' || examine_tile_text(:'world2', :lx, :ly) || '"';
select pg_temp.one_day(:'world2') \g /dev/null
select act_perform(:'world2', :'ivar', 'cut_grass', ('{"kind":"tile","x":' || :lx || ',"y":' || :ly || '}')::jsonb) \g /dev/null
select land_data(:'world2', :lx, :ly) as d2 \gset
select pg_temp.one_day(:'world2') \g /dev/null
select act_perform(:'world2', :'ivar', 'cut_grass', ('{"kind":"tile","x":' || :lx || ',"y":' || :ly || '}')::jsonb) \g /dev/null
select '949. a day and a cut, twice more: the tile held ' || :'d2' || ' after the second cut, and says "'
     || (select text from event where uid = :'ivar' and text like 'You cut%' order by n desc limit 1) || '" after the third';
-- The third day.
select pg_temp.one_day(:'world2') \g /dev/null
select '950. and on the third day it is ' || (select name from tile_def where id = land_tile(:'world2', :lx, :ly))
     || ' holding ' || land_data(:'world2', :lx, :ly);
-- The tile beside it: cut once, then a day with no cut.
select act_perform(:'world2', :'ivar', 'cut_grass', ('{"kind":"tile","x":' || (:lx + 1) || ',"y":' || :ly || '}')::jsonb) \g /dev/null
select pg_temp.one_day(:'world2') \g /dev/null
select land_data(:'world2', :lx + 1, :ly) as d_after_one \gset
select pg_temp.one_day(:'world2') \g /dev/null
select '951. the tile beside it, cut once: ' || :'d_after_one' || ' day the morning after, and a day with no cut leaves '
     || land_data(:'world2', :lx + 1, :ly) || ' — the count starts over; and grass off any deed, Hoarding at 41,41: on a deed '
     || on_deed(:'world6', 41, 41) || ', so cutting it counts nothing';

/*
 * Dredging, which is digging from a boat.
 *
 * Asked from the island. A shovel works a corner from the shore to ten under
 * the water line and no further; from a boat the same shovel reaches the
 * bottom to thirty, and every spadeful deepens the water it floats on.
 */
\echo ''
\echo '--- dredging, which is digging from a boat'
select set_config('request.jwt.claims', json_build_object('sub', :'eater')::text, false) \g /dev/null
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; gx int; gy int;
begin
  select id into w from world where name = 'Hoarding';
  -- A pond two tiles square in open country: eight under, sand on the bottom
  -- and five of soil over the rock at every corner of it. Hunger stands on
  -- the bank at 19,20, which is one of the four tiles the pond's corner 20,21
  -- can be worked from.
  for gx in 20..22 loop for gy in 20..22 loop
    perform land_set_height(w, gx, gy, -8); perform land_set_dirt(w, gx, gy, 5);
  end loop; end loop;
  for gx in 20..21 loop for gy in 20..21 loop
    perform land_set_tile(w, gx, gy, tile_id('Sand'));
  end loop; end loop;
  perform land_set_tile(w, 19, 20, tile_id('Grass'));
  update player set x = 19.5, y = 20.5 where world_id = w and uid = me;
  delete from item where world_id = w and holder_uid = me and def in ('shovel', 'sand', 'rowing_boat');
  perform give(w, me, 'shovel', 1, 50);
  perform give(w, me, 'rowing_boat', 1, 50, 'Pine');
  delete from event where uid = me;
end $$;
select '952. off the table: dredge is corner work with a ' || (select tool from action_def where id = 'dredge')
     || ' at ' || (select skill from action_def where id = 'dredge') || ' ' || (select difficulty from action_def where id = 'dredge')
     || ', ported ' || act_ported('dredge') || ', to ' || dredge_depth() || ' under against the shore''s ' || mine_depth()
     || ' — and from the bank, shovel in hand: "' || coalesce(act_refusal(:'world6', :'eater', 'dredge', '{"kind":"tile","x":20,"y":20,"cx":20,"cy":21}'::jsonb), 'allowed') || '"';
select act_perform(:'world6', :'eater', 'place_furniture',
  ('{"kind":"item","uid":' || (select id from item where world_id = :'world6' and holder_uid = :'eater'
     and def = 'rowing_boat' order by id desc limit 1) || ',"x":20,"y":20,"sx":0,"sy":0}')::jsonb) \g /dev/null
select id as dredger from placed where world_id = :'world6' and sub = 'rowing_boat' order by id desc limit 1 \gset
select act_perform(:'world6', :'eater', 'board_vehicle', ('{"kind":"furniture","id":' || :'dredger' || '}')::jsonb) \g /dev/null
select '953. aboard a ' || coalesce((select sub from placed where id = :'dredger' and driver = :'eater'), 'nothing — not aboard')
     || ' over eight of water, the bank''s corner at ' || land_height(:'world6', 19, 20) || ': "'
     || coalesce(act_refusal(:'world6', :'eater', 'dredge', '{"kind":"tile","x":19,"y":20,"cx":19,"cy":20}'::jsonb), 'allowed')
     || '" — and the bottom: ' || coalesce(act_refusal(:'world6', :'eater', 'dredge', '{"kind":"tile","x":20,"y":20,"cx":20,"cy":21}'::jsonb), 'allowed');
do $$
declare w uuid; me uuid := '77777777-7777-7777-7777-777777777777'; i int;
begin
  select id into w from world where name = 'Hoarding';
  for i in 1..8 loop
    exit when land_height(w, 20, 21) < -8;
    perform act_perform(w, me, 'dredge', '{"kind":"tile","x":20,"y":20,"cx":20,"cy":21}'::jsonb);
  end loop;
end $$;
select '954. dredged: the corner is ' || land_height(:'world6', 20, 21) || ' under with ' || land_dirt(:'world6', 20, 21)
     || ' of soil left, ' || coalesce((select sum(count) from item where world_id = :'world6' and holder_uid = :'eater' and def = 'sand'), 0)
     || ' sand in the pack — "' || (select text from event where uid = :'eater' and text like 'You dredge%' order by n desc limit 1) || '"';
select land_set_height(:'world6', 20, 21, -31) \g /dev/null
select coalesce(act_refusal(:'world6', :'eater', 'dredge', '{"kind":"tile","x":20,"y":20,"cx":20,"cy":21}'::jsonb), 'allowed') as deep_door \gset
select land_set_height(:'world6', 20, 21, -9), land_set_dirt(:'world6', 20, 21, 0) \g /dev/null
select '955. and the other doors — the same corner thirty-one under: "' || :'deep_door'
     || '"; back at nine with the soil gone off it: "'
     || coalesce(act_refusal(:'world6', :'eater', 'dredge', '{"kind":"tile","x":20,"y":20,"cx":20,"cy":21}'::jsonb), 'allowed') || '"';

/*
 * A slope you can stand on.
 *
 * Asked from the island. A walk was refused by the step between tile middles
 * and nothing else, so a tile dug into a wall seventy high between its
 * corners could still be walked. Now a tile has a slope you can stand on —
 * sixty, raised by climbing — a rider has the mount's, wheels the bare sixty,
 * and afloat there is none.
 */
\echo ''
\echo '--- a slope you can stand on'
do $$
declare w uuid; gx int; gy int;
begin
  select id into w from world where name = 'Hoarding';
  -- Flat at four from 26 to 36, one corner raised seventy and one fifty.
  for gx in 26..36 loop for gy in 26..36 loop
    perform land_set_height(w, gx, gy, 4); perform land_set_dirt(w, gx, gy, 5);
    if gx < 36 and gy < 36 then perform land_set_tile(w, gx, gy, tile_id('Grass')); end if;
  end loop; end loop;
  perform land_set_height(w, 32, 32, 74);
  perform land_set_height(w, 28, 32, 54);
  delete from skill where world_id = w and id = 'climbing'
    and uid = (select uid from player where world_id = w and name = 'Dane');
end $$;
select uid as dane from player where world_id = :'world6' and name = 'Dane' \gset
select walk_share(:'world6', :'dane', 0, 30.5, 32.5, 31.5, 32.5) as share70 \gset
select walk_share(:'world6', :'dane', 0, 29.5, 32.5, 28.5, 32.5) as share50 \gset
insert into skill (world_id, uid, id, value) values (:'world6', :'dane', 'climbing', 50)
  on conflict (world_id, uid, id) do update set value = excluded.value;
select '956. off the table a body stands on ' || max_stand() || ', climbing adding ' || climb_per_level() || ' a level. A tile dug '
     || tile_slope(:'world6', 31, 32) || ' steep beside one dug ' || tile_slope(:'world6', 28, 32)
     || ': a walker with no climbing gets ' || :'share70' || ' of a step off the flat into the first and ' || :'share50'
     || ' into the second; at climbing 50 the first is ' || walk_share(:'world6', :'dane', 0, 30.5, 32.5, 31.5, 32.5);
select '957. a wild thing, which has no climbing, would stand on the seventy: ' || creature_tile_ok(:'world6', 31, 32)
     || ', on the fifty: ' || creature_tile_ok(:'world6', 28, 32) || ', on the flat: ' || creature_tile_ok(:'world6', 31, 30)
     || ' — and the slope read off the square in hand is ' || chunk_slope(land_chunk_get(:'world6', 31 / chunk_size()::int, 32 / chunk_size()::int), 31 / chunk_size()::int, 32 / chunk_size()::int, 31, 32, chunk_size()::int)
     || ' against ' || tile_slope(:'world6', 31, 32) || ' off the scanlines';
-- The pond's corner ninety under makes the tile the boat sits on a ninety
-- slope: Hunger, aboard, is not asked; Dane, on his feet, is.
select land_set_height(:'world6', 20, 21, -98) \g /dev/null
select '958. the boat''s tile dug ' || tile_slope(:'world6', 20, 20) || ' steep under it: aboard, Hunger gets '
     || walk_share(:'world6', :'eater', 0, 19.5, 20.5, 20.5, 20.5) || ' of the way onto it; Dane on his feet, climbing 50, gets '
     || walk_share(:'world6', :'dane', 0, 19.5, 20.5, 20.5, 20.5);

/*
 * Giving up an island waits for the clock.
 *
 * The delete that gives an island up cascades through everything on it, and
 * the clock's round is at the same rows every second; on the real project the
 * two met in a deadlock. The abandon now holds the clock's two keys for its
 * transaction, so a round and a delete never share a moment.
 */
\echo ''
\echo '--- giving up an island waits for the clock'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
insert into world (id, name, seed, size, spawn_x, spawn_y, made_by, ready) values ('0000000f-0000-0000-0000-00000000000f', 'Fleeting', 1, 8, 4, 4, :'ivar', true)
  on conflict (id) do nothing;
begin;
select rpc_abandon('0000000f-0000-0000-0000-00000000000f') as gone \gset
select '959. Fleeting given up: ' || :'gone' || ' — and until the delete is done its transaction holds '
     || (select count(*) from pg_locks l where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted)
     || ' advisory locks, the clock''s two keys, so a round that starts now finds the clock busy and goes back to bed';
commit;
select '960. and afterwards the island is gone: ' || (select count(*) from world where name = 'Fleeting')
     || ' left, and the keys let go: ' || (select count(*) from pg_locks l where l.locktype = 'advisory' and l.pid = pg_backend_pid());

/*
 * A maker's mark on rare work.
 *
 * Rare work and better carries who made it, and Look says so; the ordinary
 * run of things stays unsigned.
 */
\echo ''
\echo '--- a maker''s mark on rare work'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select give(:'world2', :'ivar', 'hatchet_head', 1, 70, 'Iron', 'rare', maker_mark(:'world2', :'ivar', 'rare')) as marked \gset
select give(:'world2', :'ivar', 'hatchet_head', 1, 70, 'Iron', null, maker_mark(:'world2', :'ivar', null)) as plain \gset
select '961. rare work is signed: the mark for rare is ' || maker_mark(:'world2', :'ivar', 'rare') || ', for the ordinary run '
     || coalesce(maker_mark(:'world2', :'ivar', null), 'nobody') || '; the rare head holds maker '
     || coalesce((select maker from item where id = :'marked'), 'none') || ' and the plain one '
     || coalesce((select maker from item where id = :'plain'), 'none') || ' — and Look: "'
     || examine_item_text(:'world2', :'ivar', (select i from item i where i.id = :'marked')) || '"';

/*
 * Melting down: what the fire gives back.
 *
 * A thing cast from metal goes back into the smelter and comes out as lumps
 * of its own metal: half of what it was cast from, at seven tenths of the
 * quality less the damage it carried, in half an ore charge's heat.
 */
\echo ''
\echo '--- melting down'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select coalesce(max(id), 0) as scrapper from placed where world_id = :'world2' and kind = 'smelter' \gset
update placed set state = '{}'::jsonb, lit = false, fuel = 0 where id = :'scrapper' \g /dev/null
update player set x = (select x from placed where id = :'scrapper') + 0.5, y = (select y from placed where id = :'scrapper') - 0.5
  where world_id = :'world2' and uid = :'ivar' \g /dev/null
-- Heads stack, and the pack has one from the mark on rare work: cleared, so
-- what goes into the fire is the one head given here.
delete from item where world_id = :'world2' and holder_uid = :'ivar' and def in ('hatchet_head', 'nail') \g /dev/null
select give(:'world2', :'ivar', 'hatchet_head', 1, 60, 'Iron') as scrap \gset
update item set dmg = 20 where id = :'scrap' \g /dev/null
select give(:'world2', :'ivar', 'plank', 1, 60, 'Pine') as board \gset
select give(:'world2', :'ivar', 'nail', 100, 40, 'Copper') as tacks \gset
delete from event where uid = :'ivar' \g /dev/null
select '962. off the table: a hatchet head holds ' || (select content from melt_def where item = 'hatchet_head') || ' lump of its metal, a hatchet the same '
     || (select content from melt_def where item = 'hatchet') || ', an anvil ' || (select content from melt_def where item = 'anvil') || ', a nail '
     || (select content from melt_def where item = 'nail') || ' — half comes back (' || melt_share() || ') at ' || melt_keep()
     || ' of the quality, in ' || melt_heat() || ' of an ore charge''s heat; ported ' || act_ported('melt_down')
     || ' — a plank: "' || coalesce(act_refusal(:'world2', :'ivar', 'melt_down', ('{"kind":"smelter","id":' || :'scrapper' || ',"itemUid":' || :'board' || '}')::jsonb), 'ALLOWED')
     || '"; the iron head, damaged twenty: "' || coalesce(act_refusal(:'world2', :'ivar', 'melt_down', ('{"kind":"smelter","id":' || :'scrapper' || ',"itemUid":' || :'scrap' || '}')::jsonb), 'ALLOWED') || '"';
select act_perform(:'world2', :'ivar', 'melt_down', ('{"kind":"smelter","id":' || :'scrapper' || ',"itemUid":' || :'scrap' || '}')::jsonb) \g /dev/null
select act_perform(:'world2', :'ivar', 'melt_down', ('{"kind":"smelter","id":' || :'scrapper' || ',"itemUid":' || :'tacks' || ',"count":100}')::jsonb) \g /dev/null
select '963. "' || (select string_agg(text, '" | "' order by n) from event where uid = :'ivar' and text like 'You put%')
     || '" — jobs in the furnace: ' || jsonb_array_length(furnace_jobs((select p from placed p where p.id = :'scrapper')))
     || ', the head left in the pack: ' || (select count(*) from item where id = :'scrap')
     || ', nails left: ' || coalesce((select count from item where id = :'tacks'), 0)
     || ' — a hundred copper nails are ' || melt_lumps('nail', 100) || ' lump, and the head''s lump will be QL ' || round(melt_ql(60, 20)::numeric, 1);
-- An hour of heat.
update placed set lit = true, fuel = 100000, since = now() - interval '1 hour' where id = :'scrapper' \g /dev/null
select furnace_settle(:'world2', :'scrapper') as melted \gset
select '964. an hour of heat later, ' || :'melted' || ' finished: ' || (select string_agg(o->>'def' || ' QL ' || round((o->>'ql')::numeric, 1), ', ' order by o->>'def')
       from jsonb_array_elements(furnace_output((select p from placed p where p.id = :'scrapper'))) o);

/*
 * Coins and a die.
 *
 * A coin die is cast at the anvil; with it a lump of silver or gold is
 * struck into twenty coins, and the die wears with every strike.
 */
\echo ''
\echo '--- coins and a die'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
-- An anvil of Ivar's own to strike on: the earlier one was taken up again.
select give(:'world2', :'ivar', 'anvil', 1, 70, 'Iron') \g /dev/null
update player set x = 8.5, y = 7.5 where world_id = :'world2' and uid = :'ivar' \g /dev/null
select act_perform(:'world2', :'ivar', 'place_anvil',
  ('{"kind":"tile","x":8,"y":8,"sx":0,"sy":0,"uid":' || (select id from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'anvil' order by id desc limit 1) || '}')::jsonb) \g /dev/null
select id as mint from placed where world_id = :'world2' and kind = 'anvil' order by id desc limit 1 \gset
delete from item where world_id = :'world2' and holder_uid = :'ivar' and def in ('coin', 'coin_die', 'silver_lump', 'copper_lump') \g /dev/null
select give(:'world2', :'ivar', 'copper_lump', 3, 60, 'Copper') as base \gset
select give(:'world2', :'ivar', 'silver_lump', 3, 60, 'Silver') as bullion \gset
select '965. off the table: a ' || (select name from mould_def where id = 'coin_die_mould') || ' makes a ' || (select name from item_def where id = (select makes from mould_def where id = 'coin_die_mould'))
     || ' from ' || (select lumps from mould_def where id = 'coin_die_mould') || ' lumps; a lump strikes ' || coins_per_lump() || ' coins, a strike wears the die '
     || die_wear() || ', and the metals that coin are ' || (select string_agg(name, ' and ' order by level) from metal_def where coins)
     || '; a coin holds ' || (select content from melt_def where item = 'coin') || ' of a lump; ported ' || act_ported('strike_coins')
     || ' — with no die: "' || coalesce(act_refusal(:'world2', :'ivar', 'strike_coins', ('{"kind":"anvil","id":' || :'mint' || ',"itemUid":' || :'bullion' || '}')::jsonb), 'ALLOWED') || '"';
select give(:'world2', :'ivar', 'coin_die', 1, 60, 'Iron') as die \gset
delete from event where uid = :'ivar' \g /dev/null
select '966. with a die — copper: "' || coalesce(act_refusal(:'world2', :'ivar', 'strike_coins', ('{"kind":"anvil","id":' || :'mint' || ',"itemUid":' || :'base' || '}')::jsonb), 'ALLOWED')
     || '"; silver: "' || coalesce(act_refusal(:'world2', :'ivar', 'strike_coins', ('{"kind":"anvil","id":' || :'mint' || ',"itemUid":' || :'bullion' || '}')::jsonb), 'ALLOWED') || '"';
-- Struck until it takes, on the island the suite names rather than one
-- found again: `world limit 1` is a different island by this point.
update skill set value = 70 where world_id = :'world2' and uid = :'ivar' and id = 'blacksmithing' \g /dev/null
insert into skill (world_id, uid, id, value) select :'world2', :'ivar', 'blacksmithing', 70
  where not exists (select 1 from skill where world_id = :'world2' and uid = :'ivar' and id = 'blacksmithing') \g /dev/null
create or replace function pg_temp.strike_until(p_world uuid, p_uid uuid, p_anvil bigint) returns int
  language plpgsql as $fn$
declare l bigint; i int; n int := 0;
begin
  for i in 1..12 loop
    select id into l from item where world_id = p_world and holder_uid = p_uid and def = 'silver_lump' limit 1;
    exit when l is null or exists (select 1 from item where world_id = p_world and holder_uid = p_uid and def = 'coin');
    perform act_perform(p_world, p_uid, 'strike_coins', jsonb_build_object('kind', 'anvil', 'id', p_anvil, 'itemUid', l));
    n := n + 1;
  end loop;
  return n;
end $fn$;
select pg_temp.strike_until(:'world2', :'ivar', :'mint') as strikes \gset
select '967. ' || :'strikes' || ' strikes at blacksmithing 70: ' || coalesce((select count || ' coins (' || extra || ') at QL ' || round(ql::numeric, 1) from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'coin' limit 1), 'no coins')
     || ', silver lumps left ' || coalesce((select count from item where id = :'bullion'), 0) || ', the die worn to ' || (select dmg from item where id = :'die')
     || ' — "' || coalesce((select text from event where uid = :'ivar' and text like 'You strike%' order by n desc limit 1), 'no strike landed')
     || '" — and the coins melt back: ' || melt_lumps('coin', 20) || ' lump from twenty, "'
     || coalesce(act_refusal(:'world2', :'ivar', 'melt_down', ('{"kind":"smelter","id":' || (select coalesce(max(id), 0) from placed where world_id = :'world2' and kind = 'smelter') || ',"itemUid":' || coalesce((select id from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'coin' limit 1), 0) || ',"count":20}')::jsonb), 'ALLOWED') || '"';

/*
 * A bell and a statue, cast in bronze.
 *
 * Two big castings off the mould table, hung or set up as furniture. A bell
 * rung on a settlement calls its wildermon to the ringer and tells every
 * citizen where it hangs; a statue is on the map from the day it stands.
 */
\echo ''
\echo '--- a bell and a statue, cast in bronze'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select '968. off the table: a ' || (select name from mould_def where id = 'bell_mould') || ' takes ' || (select lumps from mould_def where id = 'bell_mould')
     || ' lumps and a ' || (select name from mould_def where id = 'statue_mould') || ' ' || (select lumps from mould_def where id = 'statue_mould')
     || '; a bell is hung from ' || (select string_agg(item || ' ×' || count, ', ' order by ord) from recipe_input where recipe = 'make_bell')
     || ' and a statue set up from ' || (select string_agg(item || ' ×' || count, ', ' order by ord) from recipe_input where recipe = 'make_statue')
     || '; the bell rings ' || (select bell from furniture_def where id = 'bell') || ', the statue is a landmark ' || (select landmark from furniture_def where id = 'statue')
     || '; ported ' || act_ported('ring_bell');
-- A bell hung on Ivar's deed, Ivar beside it, and a worker of the deed away at its work.
select x as tok_x, y as tok_y from deed where world_id = :'world2' and founded_by = :'ivar' \gset
insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, material)
  values (:'world2', 'furniture', 'bell', :tok_x + 1, :tok_y, 0, 0, :tok_x + 1.5, :tok_y + 0.5, 60, :'ivar', 'Bronze') returning id as chime \gset
update player set x = :tok_x + 1.5, y = :tok_y + 1.5 where world_id = :'world2' and uid = :'ivar' \g /dev/null
update player set x = :tok_x + 0.5, y = :tok_y + 1.5 where world_id = :'world2' and uid = :'alice' \g /dev/null
update creature set mode = 'deed', keeper = :'ivar', job = 'stump', phase = 'idle', enemy = null,
    from_x = :tok_x + 5.5, from_y = :tok_y + 5.5, to_x = :tok_x + 5.5, to_y = :tok_y + 5.5,
    leg_at = now(), leg_ends = now(), until = now()
  where world_id = :'world2' and id = :'stumper' \g /dev/null
delete from event where uid = :'ivar' or text like 'The bell rings out%' \g /dev/null
select '969. Alice, no citizen, at the rope: "' || coalesce(act_refusal(:'world2', :'alice', 'ring_bell', ('{"kind":"furniture","id":' || :'chime' || '}')::jsonb), 'ALLOWED')
     || '"; Ivar: "' || coalesce(act_refusal(:'world2', :'ivar', 'ring_bell', ('{"kind":"furniture","id":' || :'chime' || '}')::jsonb), 'ALLOWED') || '"';
select act_perform(:'world2', :'ivar', 'ring_bell', ('{"kind":"furniture","id":' || :'chime' || '}')::jsonb) \g /dev/null
select '970. "' || (select text from event where uid = :'ivar' order by n desc limit 1) || '" — the grubba is walking to '
     || (select round(to_x::numeric, 1) || ',' || round(to_y::numeric, 1) from creature where world_id = :'world2' and id = :'stumper')
     || ', there in ' || (select round(extract(epoch from (leg_ends - now()))::numeric, 1) from creature where world_id = :'world2' and id = :'stumper')
     || ' s and standing a while after — and the citizens of ' || (select name from deed where world_id = :'world2' and founded_by = :'ivar') || ' told: '
     || (select count(*) from event where kind = 'system' and text like 'The bell rings out%') || ' of '
     || (select count(*) from deed_member where world_id = :'world2' and founder = :'ivar');

/*
 * Horseshoes.
 *
 * Four to a lump off a gang mould, nailed onto a mount with a mallet. They
 * hold a week: quicker on stone and gravel, and a step higher.
 */
\echo ''
\echo '--- horseshoes'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select '971. off the table: a ' || (select name from mould_def where id = 'horseshoe_mould') || ' casts ' || (select per from mould_def where id = 'horseshoe_mould')
     || ' shoes from ' || (select lumps from mould_def where id = 'horseshoe_mould') || ' lump; a mount takes ' || shoes_per_mount() || ', they hold ' || shoe_days()
     || ' days, at ' || shoe_pace() || ' the pace on paved ground — ' || (select string_agg(name, ', ' order by id) from tile_def where paved) || ' — and ' || shoe_step()
     || ' more of step; ported ' || act_ported('shoe_creature');
-- A horse of Ivar's for the shoes, since the suite's first horse was cleared with its island long ago: grown, standing beside him, and a grubba that is no mount.
select creature_spawn(:'world2', 'orse', 14.6, 12.6, 'active', now() - interval '1 day') as shodhorse \gset
update creature set from_x = 14.6, from_y = 12.6, to_x = 14.6, to_y = 12.6, leg_at = now(), leg_ends = now(), settled_at = now(),
    rider = null, shod_at = null where world_id = :'world2' and id = :'shodhorse' \g /dev/null
update player set x = 14.5, y = 12.5 where world_id = :'world2' and uid = :'ivar' \g /dev/null
delete from item where world_id = :'world2' and holder_uid = :'ivar' and def in ('horseshoe', 'mallet') \g /dev/null
select '972. the grubba: "' || coalesce(act_refusal(:'world2', :'ivar', 'shoe_creature', ('{"kind":"creature","id":' || :'stumper' || '}')::jsonb), 'ALLOWED')
     || '"; the horse, with nothing in the pack: "' || coalesce(act_refusal(:'world2', :'ivar', 'shoe_creature', ('{"kind":"creature","id":' || :'shodhorse' || '}')::jsonb), 'ALLOWED')
     || '"' as doors \gset
select give(:'world2', :'ivar', 'horseshoe', 4, 50, 'Iron') \g /dev/null
select give(:'world2', :'ivar', 'mallet', 1, 50, 'Pine') \g /dev/null
select round(mount_step((select c from creature c where c.world_id = :'world2' and c.id = :'shodhorse'))::numeric, 1) as step_before \gset
select :'doors' || '; with four shoes and a mallet: "' || coalesce(act_refusal(:'world2', :'ivar', 'shoe_creature', ('{"kind":"creature","id":' || :'shodhorse' || '}')::jsonb), 'ALLOWED') || '"';
delete from event where uid = :'ivar' \g /dev/null
select act_perform(:'world2', :'ivar', 'shoe_creature', ('{"kind":"creature","id":' || :'shodhorse' || '}')::jsonb) \g /dev/null
update creature set rider = :'ivar' where world_id = :'world2' and id = :'shodhorse' \g /dev/null
select round(travel_speed(:'world2', :'ivar')::numeric, 2) as pace_grass \gset
select land_tile(:'world2', 14, 12) as was_tile \gset
select land_set_tile(:'world2', 14, 12, tile_id('Stone slabs')) \g /dev/null
select '973. "' || (select text from event where uid = :'ivar' order by n desc limit 1) || '" — shoes left ' || coalesce((select count from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'horseshoe'), 0)
     || ', shod ' || shod((select c from creature c where c.world_id = :'world2' and c.id = :'shodhorse')) || ' and handed to a browser as shod '
     || coalesce((select x->>'shod' from jsonb_array_elements(rpc_creatures(:'world2', 40)) x where (x->>'id')::int = :'shodhorse'), 'NOTHING')
     || '; its step ' || :'step_before' || ' then ' || round(mount_step((select c from creature c where c.world_id = :'world2' and c.id = :'shodhorse'))::numeric, 1)
     || '; under saddle on grass ' || :'pace_grass' || ' and on slabs ' || round(travel_speed(:'world2', :'ivar')::numeric, 2);
select land_set_tile(:'world2', 14, 12, :'was_tile') \g /dev/null
update creature set rider = null where world_id = :'world2' and id = :'shodhorse' \g /dev/null

/*
 * Iron fittings for building.
 *
 * A door takes two hinges, a double door four, a gate two, on top of the
 * wall's bill; and an iron-bound gate, four brackets over its hinges, swings
 * for a person and for nothing else.
 */
\echo ''
\echo '--- iron fittings for building'
select '974. off the table: hinges come ' || (select per from mould_def where id = 'hinge_mould') || ' to a lump and brackets ' || (select per from mould_def where id = 'bracket_mould')
     || '; a plank door wants ' || (select string_agg(key || ' ' || value, ', ' order by key) from jsonb_each_text(wall_bill('plank', 'door')))
     || ', a plank double door ' || (select string_agg(key || ' ' || value, ', ' order by key) from jsonb_each_text(wall_bill('plank', 'double_door')))
     || ', a log fence gate ' || (select string_agg(key || ' ' || value, ', ' order by key) from jsonb_each_text(wall_bill('log', 'fence_gate')))
     || ', and a plain log fence still ' || (select string_agg(key || ' ' || value, ', ' order by key) from jsonb_each_text(wall_bill('log', 'fence')));
select '975. the iron-bound gate: ' || (select name from wall_type_def where id = 'iron_gate') || ', passable ' || (select passable from wall_type_def where id = 'iron_gate')
     || ' and proof against beasts ' || (select beast_proof from wall_type_def where id = 'iron_gate') || ', where a fence gate is ' || (select beast_proof from wall_type_def where id = 'fence_gate')
     || '; of log it wants ' || (select string_agg(key || ' ' || value, ', ' order by key) from jsonb_each_text(wall_bill('log', 'iron_gate')))
     || ' — ' || (select count(*) from wall_fitting) || ' fittings on ' || (select count(distinct type) from wall_fitting) || ' kinds of wall';

/*
 * Gems and jewellery.
 *
 * A stone out of the rock now and again, each favouring a trade; a ring or a
 * pendant cast two to a lump; the stone set in it with a file, the piece
 * taking the stone's name; and worn, a knack's worth on the trade.
 */
\echo ''
\echo '--- gems and jewellery'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select '976. off the table: ' || (select string_agg(name || ' for ' || skill || ' (' || weight || ')', ', ' order by ord) from gem_def)
     || '; one swing in ' || round(1 / gem_odds()) || ' brings one out and a worn stone is worth ' || jewel_bonus() || ' on its trade'
     || '; a ' || (select name from mould_def where id = 'ring_mould') || ' casts ' || (select per from mould_def where id = 'ring_mould') || ' and a '
     || (select name from mould_def where id = 'pendant_mould') || ' ' || (select per from mould_def where id = 'pendant_mould') || ', at ' || (select skill from mould_def where id = 'ring_mould')
     || '; setting takes ' || (select string_agg(item || ' ×' || count, ', ' order by ord) from recipe_input where recipe = 'set_ring') || ' with a ' || (select tool from recipe where id = 'set_ring')
     || '; the pieces go in the ' || slot_of('jewelled_ring') || ' and ' || slot_of('jewelled_pendant') || ' slot and a plain ring in ' || coalesce(slot_of('ring'), 'none')
     || '; ported ' || act_ported('set_ring') || ' and ' || act_ported('set_pendant');
-- The draw, three thousand times: every stone turns up, and the diamond least.
select string_agg(name || ' ' || n, ', ' order by n desc) as draws, coalesce(min(n) filter (where name = 'Diamond'), 0) as diamonds, count(*) as kinds
  from (select name, count(*) as n from (select roll_gem() as name from generate_series(1, 3000)) d group by name) t \gset
delete from item where world_id = :'world2' and holder_uid = :'ivar' and def in ('gem', 'ring', 'pendant', 'jewelled_ring', 'jewelled_pendant', 'file') \g /dev/null
select count(*) from (select maybe_gem(:'world2', :'ivar', 50, 50) from generate_series(1, 4000)) x \g /dev/null
select '977. three thousand draws — ' || :'draws' || ' — every one of ' || (select count(*) from gem_def) || ' kinds seen: ' || (:kinds = (select count(*) from gem_def))
     || ', the diamond the rarest and about one in sixteen: ' || (:diamonds between 90 and 300)
     || '; and four thousand swings at fifty bring out ' || coalesce((select sum(count) from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'gem'), 0)
     || ' stones, between one and forty: ' || (coalesce((select sum(count) from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'gem'), 0) between 1 and 40)
     || ', every one at a quality in (0, 100]: ' || coalesce((select bool_and(ql > 0 and ql <= 100) from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'gem'), false)
     || ', the last of them told as "' || (select text from event where uid = :'ivar' and text like 'Something glints%' order by n desc limit 1) || '"';
-- Setting a ruby in a silver band, and wearing it.
delete from item where world_id = :'world2' and holder_uid = :'ivar' and def in ('gem', 'ring', 'pendant', 'jewelled_ring', 'jewelled_pendant', 'file') \g /dev/null
select give(:'world2', :'ivar', 'ring', 1, 60, 'Silver') as band \gset
select give(:'world2', :'ivar', 'gem', 1, 70, 'Ruby') as stone \gset
select coalesce(act_refusal(:'world2', :'ivar', 'set_ring', ('{"kind":"item","uid":' || :'stone' || '}')::jsonb), 'ALLOWED') as nofile \gset
select give(:'world2', :'ivar', 'file', 1, 50, 'Iron') \g /dev/null
select coalesce(act_refusal(:'world2', :'ivar', 'set_ring', ('{"kind":"item","uid":' || :'stone' || '}')::jsonb), 'ALLOWED') as withfile \gset
select round(skill_mult(:'world2', :'ivar', 'fighting')::numeric, 2) as bare_fight, round(skill_mult(:'world2', :'ivar', 'mining')::numeric, 2) as bare_mine \gset
-- The seating can fail, as any craft can; the stone and the band are kept on a failure, so it is tried until it takes.
create or replace function pg_temp.set_until(p_world uuid, p_uid uuid, p_stone bigint) returns int language plpgsql as $$
declare i int := 0;
begin
  loop
    i := i + 1;
    if exists (select 1 from item where world_id = p_world and holder_uid = p_uid and def = 'jewelled_ring') or i > 40 then return i; end if;
    perform act_perform(p_world, p_uid, 'set_ring', jsonb_build_object('kind', 'item', 'uid', p_stone));
  end loop;
end $$;
delete from event where uid = :'ivar' \g /dev/null
select pg_temp.set_until(:'world2', :'ivar', :'stone') as tries \gset
select id as jewel from item where world_id = :'world2' and holder_uid = :'ivar' and def = 'jewelled_ring' \gset
select coalesce(act_refusal(:'world2', :'ivar', 'equip', ('{"kind":"item","uid":' || :'jewel' || '}')::jsonb), 'ALLOWED') as wearable \gset
select act_perform(:'world2', :'ivar', 'equip', ('{"kind":"item","uid":' || :'jewel' || '}')::jsonb) \g /dev/null
select '978. without a file: "' || :'nofile' || '"; with one: "' || :'withfile' || '"; seated at try ' || :'tries' || ': "' || (select text from event where uid = :'ivar' and text like 'You seat%' order by n desc limit 1) || '"'
     || ' — a ' || (select lower(name) from item_def where id = (select def from item where id = :'jewel')) || ' of ' || (select extra from item where id = :'jewel')
     || ' at QL ' || (select round(ql) from item where id = :'jewel') || ', the stone and the band gone: '
     || (not exists (select 1 from item where world_id = :'world2' and holder_uid = :'ivar' and def in ('gem', 'ring')))
     || '; worn: "' || :'wearable' || '", in the ' || (select key from player p, jsonb_each(p.equipped) where p.world_id = :'world2' and p.uid = :'ivar' and value::bigint = :'jewel') || ' slot'
     || ', and fighting goes in at ' || :'bare_fight' || ' then ' || round(skill_mult(:'world2', :'ivar', 'fighting')::numeric, 2)
     || ' where mining stays at ' || :'bare_mine' || ' then ' || round(skill_mult(:'world2', :'ivar', 'mining')::numeric, 2);
-- What a craft is made of decides how stubborn it is, on the island now as in the browser.
select id as woodrec from recipe where material = 'wood' and difficulty is not null order by id limit 1 \gset
select '979. what it is made of decides how stubborn the work is: setting a diamond is ' || craft_hardness('set_ring', 'Diamond') || ' and a garnet ' || craft_hardness('set_ring', 'Garnet')
     || '; ' || :'woodrec' || ' of oak is ' || craft_hardness(:'woodrec', 'Oak') || ' and of pine ' || craft_hardness(:'woodrec', 'Pine')
     || ', which is the recipe''s ' || (select difficulty from recipe where id = :'woodrec') || ' and the wood''s ' || (mat_of('Oak')).difficulty || ' or ' || (mat_of('Pine')).difficulty
     || ', where the island used to read the recipe alone';
update player set equipped = equipped - 'jewel' where world_id = :'world2' and uid = :'ivar' \g /dev/null

/*
 * A stack taken out is yours.
 *
 * Farce's seeds: put in the crate and taken out again, they joined the
 * lowest-numbered stack of seeds on the island, which was somebody else's.
 */
\echo ''
\echo '--- a stack taken out is yours'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
select id as box, x as bx, y as by from crate where world_id = :'world2' order by id limit 1 \gset
delete from item where world_id = :'world2' and def = 'cabbage_seed' \g /dev/null
-- Alice holds seeds first, so hers is the lowest-numbered stack ashore; Ivar puts one in the crate and takes it out.
select give(:'world2', :'alice', 'cabbage_seed', 3, 50) \g /dev/null
select give(:'world2', :'ivar', 'cabbage_seed', 1, 50) as seed \gset
select x as was_x, y as was_y from player where world_id = :'world2' and uid = :'ivar' \gset
update player set x = :bx + 0.5, y = :by + 0.5 where world_id = :'world2' and uid = :'ivar' \g /dev/null
select act_perform(:'world2', :'ivar', 'store_in_crate', ('{"kind":"item","uid":' || :'seed' || ',"count":1}')::jsonb) \g /dev/null
select id as stored from item where world_id = :'world2' and holder = 'crate' and crate = :box and def = 'cabbage_seed' \gset
select act_perform(:'world2', :'ivar', 'take_from_store', ('{"kind":"item","uid":' || :'stored' || ',"count":1}')::jsonb) \g /dev/null
-- And a split stack keeps its maker's mark: one of Ivar's three rare seeds handed to Alice, who has none like it.
select give(:'world2', :'ivar', 'cabbage_seed', 3, 60, null, 'rare', 'Ivar') as marked \gset
select move_part(:'marked', 1, 'player', :'alice', null, null) as split \gset
select '980. Farce''s seed, put in the crate and taken out again, with Alice''s stack of them the lowest-numbered ashore: Ivar holds '
     || coalesce((select sum(count) from item where world_id = :'world2' and holder = 'player' and holder_uid = :'ivar' and def = 'cabbage_seed' and rare is null), 0)
     || ' and Alice ' || coalesce((select sum(count) from item where world_id = :'world2' and holder = 'player' and holder_uid = :'alice' and def = 'cabbage_seed' and rare is null), 0)
     || ', the crate ' || coalesce((select sum(count) from item where world_id = :'world2' and holder = 'crate' and crate = :box and def = 'cabbage_seed'), 0)
     || ', and Ivar told "' || (select text from event where uid = :'ivar' and text like 'You take%' order by n desc limit 1) || '"'
     || '; and one of three rare seeds split off to Alice keeps its mark: ' || (select coalesce(maker, 'nobody') || ', ' || coalesce(rare, 'plain') from item where id = :'split')
     || ', with ' || (select count from item where id = :'marked') || ' left marked in Ivar''s pack';
update player set x = :was_x, y = :was_y where world_id = :'world2' and uid = :'ivar' \g /dev/null
delete from item where world_id = :'world2' and def = 'cabbage_seed' \g /dev/null

/*
 * The body learns from the heavy trades.
 *
 * Every go at digging or mining trains the back as well, in the one place
 * both sides pay for a go; a go at anything lighter does not.
 */
\echo ''
\echo '--- the body learns from the heavy trades'
select set_config('request.jwt.claims', json_build_object('sub', :'ivar')::text, false) \g /dev/null
update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', to_jsonb(1.0)) where world_id = :'world2' and uid = :'ivar' \g /dev/null
select round(skill_of(:'world2', :'ivar', 'body_strength')::numeric, 4) as back_before \gset
select spend_wind(:'world2', :'ivar', 'dig') from generate_series(1, 3) \g /dev/null
select round(skill_of(:'world2', :'ivar', 'body_strength')::numeric, 4) as back_dug \gset
select spend_wind(:'world2', :'ivar', 'mine') from generate_series(1, 3) \g /dev/null
select round(skill_of(:'world2', :'ivar', 'body_strength')::numeric, 4) as back_mined \gset
select spend_wind(:'world2', :'ivar', 'forage') from generate_series(1, 3) \g /dev/null
select '981. the heavy trades, ' || (select string_agg(id, ' and ' order by id) from skill_def where heavy) || ', train the back at ' || work_back() || ' a go, off the same list and number as the browser'
     || ': body strength ' || :'back_before' || ', then ' || :'back_dug' || ' after three spadefuls (up: ' || (:back_dug > :back_before) || ')'
     || ', ' || :'back_mined' || ' after three swings of the pick (up: ' || (:back_mined > :back_dug) || ')'
     || ', and ' || round(skill_of(:'world2', :'ivar', 'body_strength')::numeric, 4) || ' after three goes at foraging, which is no heavier than it was (up: '
     || (round(skill_of(:'world2', :'ivar', 'body_strength')::numeric, 4) > :back_mined) || ')';

/*
 * A container's contents are its own.
 *
 * A bag's contents carry the bag's holder and follow the bag: into a crate,
 * out again, onto the ground and into somebody else's hands. And every
 * container is a line of the container table.
 */
\echo ''
\echo '--- what is in a container belongs to the container'
select id as box, x as bx, y as by from crate where world_id = :'world2' order by id limit 1 \gset
delete from item where world_id = :'world2' and def in ('satchel', 'cabbage_seed') \g /dev/null
select x as was_x, y as was_y from player where world_id = :'world2' and uid = :'ivar' \gset
update player set x = :bx + 0.5, y = :by + 0.5 where world_id = :'world2' and uid = :'ivar' \g /dev/null
select give(:'world2', :'ivar', 'satchel', 1, 50) as satchel \gset
select give(:'world2', :'ivar', 'cabbage_seed', 5, 50) as seeds \gset
select act_perform(:'world2', :'ivar', 'stow_item', ('{"kind":"item","uid":' || :'seeds' || ',"count":5}')::jsonb) \g /dev/null
-- The island stows into the first bag with room, which may be one Ivar already carries; that bag is the one measured.
select id as stowed, inside as bag from item where world_id = :'world2' and holder = 'bag' and def = 'cabbage_seed' \gset
select lower(d.name) as bagname from item b join item_def d on d.id = b.def where b.id = :'bag' \gset
create or replace function pg_temp.whose(p_id bigint, p_ivar uuid, p_alice uuid) returns text language sql as $$
  select holder || ' / ' || case when holder_uid = p_ivar then 'Ivar' when holder_uid = p_alice then 'Alice' when holder_uid is null then 'nobody' else 'somebody else' end
    || case when inside is not null then ' / in the bag' else '' end from item where id = p_id
$$;
select pg_temp.whose(:'stowed', :'ivar', :'alice') as stowed_as \gset
-- Into the crate, bag and all, and out again.
select act_perform(:'world2', :'ivar', 'store_in_crate', ('{"kind":"item","uid":' || :'bag' || ',"count":1}')::jsonb) \g /dev/null
select pg_temp.whose(:'bag', :'ivar', :'alice') as bag_crated, pg_temp.whose(:'stowed', :'ivar', :'alice') as seeds_crated \gset
select act_perform(:'world2', :'ivar', 'take_from_store', ('{"kind":"item","uid":' || :'bag' || ',"count":1}')::jsonb) \g /dev/null
select pg_temp.whose(:'bag', :'ivar', :'alice') as bag_back, pg_temp.whose(:'stowed', :'ivar', :'alice') as seeds_back \gset
-- Dropped, and picked up by Alice.
select act_perform(:'world2', :'ivar', 'drop', ('{"kind":"item","uid":' || :'bag' || ',"count":1}')::jsonb) \g /dev/null
select pg_temp.whose(:'bag', :'ivar', :'alice') as bag_dropped, pg_temp.whose(:'stowed', :'ivar', :'alice') as seeds_dropped \gset
select gx as bag_gx, gy as bag_gy from item where id = :'bag' \gset
update player set x = :bag_gx + 0.5, y = :bag_gy + 0.5 where world_id = :'world2' and uid = :'alice' \g /dev/null
select act_perform(:'world2', :'alice', 'pick_up', ('{"kind":"ground","x":' || :bag_gx || ',"y":' || :bag_gy || ',"uid":' || :'bag' || '}')::jsonb) \g /dev/null
select '982. five seeds stowed in Ivar''s ' || :'bagname' || ' are ' || :'stowed_as' || '; the ' || :'bagname' || ' put in the crate is ' || :'bag_crated' || ' and the seeds ' || :'seeds_crated'
     || '; taken out again, ' || :'bag_back' || ' and ' || :'seeds_back'
     || '; dropped, ' || :'bag_dropped' || ' and ' || :'seeds_dropped'
     || '; picked up by Alice, ' || pg_temp.whose(:'bag', :'ivar', :'alice') || ' and ' || pg_temp.whose(:'stowed', :'ivar', :'alice')
     || ', all ' || (select count from item where id = :'stowed') || ' of them'
     || '; and the container table has a line for it: ' || (select kind || ' ' || lower(name) || ', ' || units || ' of ' || capacity || ', held by '
          || case when holder_uid = :'alice' then 'Alice' when holder_uid is null then 'nobody' else 'somebody else' end from container where world_id = :'world2' and kind = 'bag' and id = :'bag');
select '983. after everything above, things in a crate or a piece of furniture with a holder of their own: ' || (select count(*) from item where holder in ('crate', 'furniture') and holder_uid is not null)
     || '; things in a bag not carrying the bag''s holder: ' || (select count(*) from item i join item b on b.id = i.inside where i.holder = 'bag' and i.holder_uid is distinct from b.holder_uid)
     || '; and the island''s containers, one line each: ' || (select string_agg(kind || ' ' || n, ', ' order by kind) from (select kind, count(*) as n from container where world_id = :'world2' group by kind) t)
     || ', ' || (select count(*) from container where world_id = :'world2' and units > 0) || ' of them with something in';
-- The bag goes back to Ivar, contents following.
update item set holder = 'player', holder_uid = :'ivar', gx = null, gy = null where id = :'bag' \g /dev/null
update player set x = :was_x, y = :was_y where world_id = :'world2' and uid = :'ivar' \g /dev/null
delete from item where world_id = :'world2' and def = 'cabbage_seed' \g /dev/null
