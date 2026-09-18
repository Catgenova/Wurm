-- Giving up an island waits for the clock
--
-- The smoke test on the real project founds an island, plays on it, and gives
-- it up at the end. Giving it up is one delete that cascades through
-- everything on the island, and the clock's round is at the same rows every
-- second. This time the two met, and Postgres chose one to kill: "deadlock
-- detected", from `rpc_abandon`. The migrations had all applied; the island
-- itself was fine; the race was the abandon's, and it has always been there.
--
-- `rpc_abandon` now takes the two clock keys — `world_tick` and `tree_tick`,
-- the advisory locks each round holds while it turns — for its transaction,
-- before the delete. A round in progress finishes first; a round that starts
-- while the island is going finds the clock busy and goes back to bed, which
-- is exactly what it does whenever two rounds meet.

CREATE OR REPLACE FUNCTION public.rpc_abandon(p_world uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); w world; others int;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into w from world where id = p_world;
  if not found then return false; end if;
  if w.made_by is distinct from me then raise exception 'that is not your island to give up'; end if;
  select count(*) into others from player
    where world_id = p_world and uid <> me and not away
      and seen_at > now() - make_interval(secs => idle_logout());
  if others > 0 then
    raise exception 'there % still on this island; it is not yours alone to give up',
      case when others = 1 then 'is somebody' else 'are ' || others || ' people' end;
  end if;
  /*
   * Wait for the clock, and keep it waiting.
   *
   * Deleting an island cascades through everything on it — bodies, packs,
   * creatures, placed things, the land itself — and the clock's round is at
   * the same rows every second: settling a job, moving a creature, tending a
   * fire. The two met on the real project and Postgres chose one to kill:
   * "deadlock detected", from the smoke test giving its island up. So this
   * takes the clock's own locks, for the transaction: a round in progress
   * finishes first, and a round that starts while the island is going finds
   * the clock busy and goes back to bed, which is what it does whenever two
   * rounds meet.
   */
  perform pg_advisory_xact_lock(hashtext('world_tick')::bigint);
  perform pg_advisory_xact_lock(hashtext('tree_tick')::bigint);
  delete from world where id = p_world;
  return true;
end $function$
;

select private.lock_doors();
