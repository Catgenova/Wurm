-- Giving an island up.
--
-- Wanted for two quite different reasons. A person who rolls an island by
-- accident, or with the wrong seed, should be able to throw it away rather
-- than leave it lying about forever. And the smoke test in CI raises a real
-- island on the real project every time it runs, which without this would
-- silt the database up a little more each commit.
--
-- Only whoever founded it, and everything on it goes: the cascades on
-- `world_id` see to the land, the people, the packs and the lines.

create or replace function rpc_abandon(p_world uuid)
  returns boolean language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); w world;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into w from world where id = p_world;
  if not found then return false; end if;
  if w.made_by is distinct from me then raise exception 'that is not your island to give up'; end if;
  delete from world where id = p_world;
  return true;
end $$;
