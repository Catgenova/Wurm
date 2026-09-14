-- Two things the live island found that no local database could.
--
-- ## The policy that read itself
--
-- `player_read` asked "is this person on the same island as me?" by selecting
-- from `player` — inside a policy on `player`. Postgres calls that infinite
-- recursion and refuses the whole query, so a client could not read *any*
-- body, its own included. The local suite missed it because its security tests
-- read the land, the pack and the skills, and never the people.
--
-- The fix is the standard one: ask the question in a `security definer`
-- function, which runs as its owner and so is not subject to the policy it is
-- being asked on behalf of. It lives in a schema PostgREST does not publish,
-- it checks the caller's own identity inside its body, and execute is taken
-- away from everybody — all three of which matter, because a definer function
-- reachable from outside is an open door with the lock on the inside.
--
-- ## The changes nobody heard
--
-- Realtime only carries tables that are in the `supabase_realtime`
-- publication, and a table is not in it by default. Everything worked — the
-- hole was dug, the row was written — and not one client would ever have been
-- told. Which is the entire point of having a live test.

create schema if not exists private;

create or replace function private.on_island(p_world uuid)
  returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.player
    where world_id = p_world and uid = (select auth.uid())
  )
$$;

/**
 * Reachable from a policy, not from outside.
 *
 * A policy's expression is evaluated as the role doing the querying, so
 * `authenticated` has to be able to call this or every read of `player` fails
 * with "permission denied for function on_island" — which is what happened the
 * first time it was written the other way round.
 *
 * Execute is therefore granted, and safety comes from where the function lives
 * rather than from who may call it: PostgREST publishes only the schemas it is
 * told to, `private` is not one of them, and so this is not an endpoint. It
 * also answers only about the caller themselves, so there is nothing in it to
 * leak even if it were.
 */
revoke execute on function private.on_island(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.on_island(uuid) to authenticated;

/**
 * Shut every door that is not a front door.
 *
 * This was a loop at the end of `..._doors.sql`, which meant it could only
 * ever lock the functions that existed when that file ran — anything added by
 * a later migration was published to the world. As a function it can be called
 * again at the end of each migration that adds one, which is the convention
 * from here on.
 */
create or replace function private.lock_doors() returns void language plpgsql as $$
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

/**
 * Everybody on an island you are on is visible to you; nobody else is.
 *
 * `auth.uid()` is wrapped in a select throughout: bare, Postgres treats it as
 * volatile and calls it once per row, which on a table of any size is the
 * difference between one call and a million.
 */
drop policy if exists player_read on player;
create policy player_read on player for select to authenticated
  using ((select private.on_island(player.world_id)));

drop policy if exists skill_read on skill;
create policy skill_read on skill for select to authenticated
  using (uid = (select auth.uid()));

drop policy if exists item_read on item;
create policy item_read on item for select to authenticated using (
  (holder = 'player' and holder_uid = (select auth.uid())) or holder = 'ground'
);

drop policy if exists event_read on event;
create policy event_read on event for select to authenticated
  using (uid = (select auth.uid()) or uid is null);

/**
 * What Realtime is allowed to carry.
 *
 * Written so it can run twice, and so it can run against a bare Postgres that
 * has never heard of Supabase: the publication is made if it is missing, and a
 * table already in it is left alone rather than raising.
 */
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['tile_change', 'event', 'player', 'item'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

select private.lock_doors();
