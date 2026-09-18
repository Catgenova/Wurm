-- A bevere is set to felling and nothing else
--
-- Pruning and stumping were put on the bevere as trades it could be set to
-- beside felling. They are two kinds of wildermon now — a snedda prunes what
-- would otherwise die, a grubba digs out stumps — and the bevere fells, and is
-- set to nothing else. The rulebook says so already: the snapshot before this
-- carries no trades for it.
--
-- What the rulebook cannot say is what to do with a bevere that was set to
-- prune before its trades went. Its job would go on reading `prune`, and the
-- worker rules key off the job, so it would go on pruning as a kind it no
-- longer is. So a job that is neither what a kind gathers nor one of its
-- trades is let go of, and the body goes back to what its kind does.

/** Let go of any job a kind may no longer be set to; how many bodies changed. */
create or replace function trades_settled(p_world uuid) returns integer
  language plpgsql as $fn$
declare n integer;
begin
  update creature c set job = null
    from species_def d
    where d.id = c.species and c.world_id = p_world and c.job is not null
      and c.job is distinct from d.gathers
      and not (c.job = any (coalesce(d.trades, '{}'::text[])));
  get diagnostics n = row_count;
  return n;
end $fn$;

select sum(trades_settled(id)) from world;

select private.lock_doors();
