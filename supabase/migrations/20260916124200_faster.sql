-- Winding the clock to its new time, which a number alone does not do.
--
-- `tick_seconds()` went from five to one in the generated defs beside this,
-- and on its own that changes nothing about when the clock actually comes
-- round. `cron.schedule` was called once, in `20260915083000_clock.sql`, with
-- the interval worked out *at that moment*:
--
--     every := case when ... >= array[1, 5]
--                   then tick_seconds()::int || ' seconds' else '* * * * *' end;
--     perform cron.schedule('world-tick', every, 'select public.world_tick()');
--
-- So the job on the live project still says '5 seconds' and would have gone on
-- saying it. This is the same block again, reading the new number, and
-- `cron.schedule` is an upsert on the job name — so it re-times the clock
-- rather than winding a second one beside it.
--
-- Nothing here runs on a database without `pg_cron`: the suite's bare
-- postgres:16 has none, and there the clock is wound by `rpc_settle` and the
-- browser exactly as before.
--
-- ## What a second costs
--
-- Measured on a warm database with three live islands and a hundred and
-- thirty-four creatures between them:
--
--     select world_tick();   770 ms   -- the first, which is planning
--     select world_tick();   3.1 ms
--     select world_tick();   2.4 ms
--     select world_tick();   2.6 ms
--
-- A quarter of one per cent of a core at one a second, and the work per round
-- is capped by `tick_worlds` and `tick_players` however many islands there
-- are, so it stays bounded. `world_tick` takes `for update` on each player row
-- it settles and re-checks `act_ends <= now()`, so two rounds overlapping —
-- which `pg_cron` will allow — cannot settle the same job twice.

do $$
declare every text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then return; end if;
  every := case when exists (select 1 from pg_extension where extname = 'pg_cron'
                               and string_to_array(extversion, '.')::int[] >= array[1, 5])
                then tick_seconds()::int || ' seconds' else '* * * * *' end;
  perform cron.schedule('world-tick', every, 'select public.world_tick()');
  raise notice 'world-tick now runs every %', every;
exception when others then
  raise notice 'could not re-wind the clock (%)', sqlerrm;
end $$;
