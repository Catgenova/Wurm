-- What the island does not do yet, asked rather than found out by trying.
--
-- The live suite had a check that proved the dispatcher is honest about an
-- action with no performer behind it. It proved it by *playing*: try half a
-- dozen actions in turn and take the first that is refused for want of a
-- performer. The comment above it worried about that check rotting as the port
-- caught up, and it did — in the direction nobody planned for. Every one of
-- the six is ported now, so the loop found no refusal and started six real
-- jobs instead, filled the player's head, and took four unrelated checks down
-- with it.
--
-- A question that is asked rather than acted out cannot do that. This is the
-- same `act_ported` the dispatcher itself consults, read out loud.

create or replace function rpc_unported() returns setof text language sql stable as $$
  select id from action_def where not act_ported(id) order by id
$$;

select private.lock_doors();
