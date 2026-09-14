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
do $$ begin
  begin perform land_set_height((select id from world limit 1), 0, 0, 9999); raise notice '16. call land_set_height:   ALLOWED';
  exception when others then raise notice '16. call land_set_height:   refused — %', sqlerrm; end;
  begin update land_corner set heights = heights; raise notice '17. write the land direct:  ALLOWED';
  exception when others then raise notice '17. write the land direct:  refused — %', sqlerrm; end;
  begin insert into item (world_id, holder, holder_uid, def, ql)
        values ((select id from world limit 1), 'player', auth.uid(), 'gold_lump', 100);
        raise notice '18. mint myself gold:       ALLOWED';
  exception when others then raise notice '18. mint myself gold:       refused — %', sqlerrm; end;
  begin update skill set value = 100; raise notice '19. set my skills to 100:   ALLOWED';
  exception when others then raise notice '19. set my skills to 100:   refused — %', sqlerrm; end;
  begin update player set x = 0, y = 0; raise notice '20. teleport myself:        ALLOWED';
  exception when others then raise notice '20. teleport myself:        refused — %', sqlerrm; end;
  begin perform settle((select id from world limit 1), auth.uid()); raise notice '21. call settle myself:     ALLOWED';
  exception when others then raise notice '21. call settle myself:     refused — %', sqlerrm; end;
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
