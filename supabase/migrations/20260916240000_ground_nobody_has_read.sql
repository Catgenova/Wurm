-- Ground nobody has a height for is not thirty feet of water.
--
-- Reported by the live run as fourteen failures in a row, every one of them
-- the same sentence: *You are too exhausted to do that. Rest a moment.* A body
-- that had just finished prospecting could not take hold of a cart, pray,
-- work a bridge, fill a bucket, bind a wound, build a wall or plant a stake —
-- and never got its wind back however long it stood there.
--
-- `in_deep_water` was written as a `case` whose guards answer the cheap
-- question first:
--
--     when centre_height(...) >= -swim_depth() then false
--     ...
--     else bridge_at(...) is null
--
-- `centre_height` is four `land_height` reads averaged, and `land_height`
-- answers **NULL** for ground the land has nothing written for. A NULL guard in
-- a `case` matches no `when` at all — it is not false, it is unknown — so the
-- whole thing fell past every test to the `else`, which is the affirmative
-- answer. A body standing on unread ground was a swimmer.
--
-- And a swimmer, since the rule landed a few hours ago, *spends* wind instead
-- of getting it back. So the body ran down to nothing and stayed there: every
-- `body_refusal` settles the body before it reads the bar, and every one of
-- those settles took a little more off. Not a soft lock by the minute — a
-- permanent one, until the body walked onto ground somebody had written a
-- height for.
--
--     select in_deep_water(w, bob)   -- standing on a meadow at 20:  false
--     update player set x = 999.5, y = 999.5 ...
--     select in_deep_water(w, bob)   -- height NULL:                 true
--
-- Two things fixed, not one. The height is coalesced, so an unknown height is
-- dry ground; and that is the honest default anyway — every other rule on this
-- island treats land it cannot read as land. It is *also* worth saying that a
-- `case` whose guards can be NULL must not keep its yes in the `else`, which
-- is the shape that turned one missing row into a body that could never act
-- again.

create or replace function in_deep_water(p_world uuid, p_uid uuid) returns boolean
  language sql stable as $fn$
  select case
    -- A bridge deck or a mine floor is not the ground, and not the water.
    when p.level <> 0 then false
    /*
     * The cheap question first: almost everybody, almost always, is on dry
     * ground. And coalesced, because `land_height` answers NULL for ground
     * nothing has been written for, a NULL guard matches no `when`, and the
     * `else` below is a yes — so an unread height used to mean *swimming*, and
     * a swimmer spends wind rather than getting it back. Fourteen checks of
     * the live run failed with "You are too exhausted to do that" and the body
     * never recovered, because there was nothing to recover from but this.
     */
    when coalesce(centre_height(p_world, floor(p.x)::int, floor(p.y)::int), 0) >= -swim_depth()
      then false
    -- A hull, a cart bed or a saddle: something else is holding you up.
    when exists (select 1 from placed q where q.world_id = p_world and q.driver = p_uid) then false
    when exists (select 1 from creature c where c.world_id = p_world and c.rider = p_uid) then false
    else bridge_at(p_world, floor(p.x)::int, floor(p.y)::int) is null
  end
  from player p where p.world_id = p_world and p.uid = p_uid
$fn$;

select private.lock_doors();

notify pgrst, 'reload schema';
