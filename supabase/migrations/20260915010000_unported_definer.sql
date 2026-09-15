-- `rpc_unported` could not read the answer it was asked for.
--
-- Every other front door on this island is `security definer`, and this one was
-- not — it was one line of SQL over a rulebook table, and a rulebook table is
-- readable by everybody, so it looked like it needed nothing. It does:
-- `lock_doors()` revokes execute on *every* function in `public` and then hands
-- back only the ones called `rpc_%`. `act_ported` is not one of those, so a
-- client got as far as the door and no further: `permission denied for function
-- act_ported`.
--
-- Caught by the live suite in one run, and by nothing else — locally the tests
-- run as the owner, for whom no door is shut.

create or replace function rpc_unported() returns setof text
  language sql stable security definer set search_path = public as $$
  select id from action_def where not act_ported(id) order by id
$$;

select private.lock_doors();
