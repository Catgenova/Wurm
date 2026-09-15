-- How far you may have got, and what came with you.
--
-- `rpc_move` has always believed a claimed position as far as the fastest thing
-- on two legs could have carried you since you last said where you were. That
-- ceiling is the only thing standing between a client and the far side of the
-- island, so it is not lifted — it is told what you are sitting on.
--
-- And it is the one moment anything being carried along actually moves. There
-- is no loop to keep a mount under its rider, so `drag_along` does it here, in
-- the same statement: the beast under you, the cart behind you, the wagon you
-- are on and the team in front of it all land where you did. Nothing is rolled
-- forward from a clock, because for once the clock is not what moved.

create or replace function rpc_move(p_world uuid, p_x double precision, p_y double precision, p_level int default 0)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); p player; w world; gap double precision; far double precision; allowed double precision;
begin
  if me is null then raise exception 'not signed in'; end if;
  perform settle(p_world, me);
  select * into p from player where world_id = p_world and uid = me for update;
  if not found then raise exception 'you are not on this island'; end if;
  select * into w from world where id = p_world;
  if p_x < 0 or p_y < 0 or p_x > w.size or p_y > w.size then raise exception 'that is off the island'; end if;

  gap := greatest(0.05, extract(epoch from (now() - p.moved_at)));
  far := sqrt(power(p_x - p.x, 2) + power(p_y - p.y, 2));
  -- A walk, a saddle or a seat; the rest is slack for a link that hiccups.
  allowed := travel_speed(p_world, me) * least(gap, 10) * 1.6 + 1.5;
  if far > allowed then
    -- Not an error: a client that has been asleep is not a cheat, and telling
    -- it off would be unplayable. It is simply pulled back to where it could
    -- actually have got to, and it will notice and correct.
    p_x := p.x + (p_x - p.x) * (allowed / far);
    p_y := p.y + (p_y - p.y) * (allowed / far);
  end if;
  update player set x = p_x, y = p_y, level = p_level, moved_at = now(), seen_at = now()
    where world_id = p_world and uid = me;
  perform drag_along(p_world, me, p_x, p_y);
  return jsonb_build_object('x', p_x, 'y', p_y, 'pulled', far > allowed);
end $$;

select private.lock_doors();
