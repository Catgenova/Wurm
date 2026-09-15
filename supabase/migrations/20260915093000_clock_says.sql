-- Does this island wind itself?
--
-- `world_tick` is the whole of what makes a finished job land for somebody
-- watching, a wild thing move, a trap spring or a shut tab go home — and
-- whether it is ever *called* depends on a thing no migration controls:
-- whether `pg_cron` is available on the database it was applied to. The suite
-- runs against a bare `postgres:16` where it is not, and says so out loud in
-- measurement 585.
--
-- The real project had no way to say. `clock_running()` has known the answer
-- since the clock went in, but it is not an `rpc_` and so nothing outside the
-- database could ask it — which left the single most important fact about the
-- keeper as something to be assumed. There is now one call that asks.
create or replace function rpc_clock() returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object('winds', clock_running(), 'every', tick_seconds());
end $$;

select private.lock_doors();
