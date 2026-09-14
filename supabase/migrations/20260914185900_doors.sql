-- The lockdown, last of all.
--
-- This has to run after every function exists, which is why it is numbered to
-- sort to the end rather than living with the policies. It ran alongside them
-- once, and every function added in a later migration was published to the
-- world with nobody the wiser -- the loop can only take execute away from
-- functions that are there when it runs.

/**
 * Nothing but the front door.
 *
 * PostgREST publishes *every* function in this schema as an endpoint, so
 * without this a client could simply call `land_set_height` and put the island
 * wherever it liked. Execute is taken away from everybody and handed back only
 * to the handful of `rpc_` functions that check who is asking and what they
 * are asking for.
 */
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname like 'rpc\_%' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
