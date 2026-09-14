-- Joining an island, walking about it, and doing something to it.
--
-- ## Why nothing ticks
--
-- Supabase has no long-running process: an Edge Function answers a request and
-- stops, and there is nowhere to put a loop. That sounds like a problem for a
-- game with a clock in it, and it turns out to be a simplification.
--
-- Nothing here advances. A job that takes six seconds is written down once,
-- with the moment it will be finished, and then *settled* — the next time
-- anything touches that player, and by a slow sweep for anyone who has
-- wandered off mid-dig. The result is the same and there is no tick to miss,
-- no host tab to fall asleep, and no two machines that can disagree about
-- whether the hole got dug.

/**
 * Come ashore, or come back.
 *
 * The guest book is this table. Somebody the island has met keeps their body,
 * their skills and the spot they logged out on, because their row is still
 * here; somebody new gets a row on the shore with a starting kit. Which of the
 * two it is is not the client's to say — it is whether `auth.uid()` is already
 * in the table.
 */
create or replace function rpc_join(p_world uuid, p_name text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); w world; p player; born boolean := false;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into w from world where id = p_world;
  if not found then raise exception 'no such island'; end if;
  if not w.ready then raise exception 'that island is still being laid down'; end if;

  select * into p from player where world_id = p_world and uid = me;
  if not found then
    insert into player (world_id, uid, name, x, y, stats)
    values (p_world, me, coalesce(nullif(trim(p_name), ''), 'Wanderer'), w.spawn_x + 0.5, w.spawn_y + 0.5,
            '{"health":1,"stamina":1,"hunger":1,"thirst":1}'::jsonb)
    returning * into p;
    born := true;
    -- The kit everybody washes ashore with. Issued, so no one can better it
    -- into something it was never meant to be.
    insert into item (world_id, holder, holder_uid, def, ql, issued)
    select p_world, 'player', me, d, 20, true
    from unnest(array['hatchet','shovel','pickaxe','knife','mallet','trowel','saw','butchering_knife','rake']) d;
    perform tell(p_world, me, 'You wash ashore on an untouched island with a few tools and your wits.', 'system');
  else
    update player set seen_at = now(), name = coalesce(nullif(trim(p_name), ''), name)
      where world_id = p_world and uid = me returning * into p;
    perform tell(p_world, me, 'Your journey continues where you left off.', 'system');
  end if;

  return jsonb_build_object(
    'world', to_jsonb(w) - 'made_by',
    'you', to_jsonb(p),
    'new', born,
    'time', world_time(p_world));
end $$;

/**
 * Where I have walked to.
 *
 * The island believes a claim only as far as the clock allows: you may have
 * moved as far as the fastest thing on two legs could have carried you since
 * the last time you said so, plus a little slack for a link that stuttered.
 * It is not a movement simulation and is not meant to be — it is the ceiling
 * that stops a client putting itself on the far side of the island in order to
 * reach something it has no business reaching.
 */
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
  -- 2.4 tiles a second is a walk; the rest is slack for a link that hiccups.
  allowed := 2.4 * least(gap, 10) * 1.6 + 1.5;
  if far > allowed then
    -- Not an error: a client that has been asleep is not a cheat, and telling
    -- it off would be unplayable. It is simply pulled back to where it could
    -- actually have got to, and it will notice and correct.
    p_x := p.x + (p_x - p.x) * (allowed / far);
    p_y := p.y + (p_y - p.y) * (allowed / far);
  end if;
  update player set x = p_x, y = p_y, level = p_level, moved_at = now(), seen_at = now()
    where world_id = p_world and uid = me;
  return jsonb_build_object('x', p_x, 'y', p_y, 'pulled', far > allowed);
end $$;

/**
 * Whether somebody standing where they are can work on what they have asked
 * for. Straight out of `Game.inRange`: a corner job wants you on one of the
 * four tiles that touch it, anything else wants you within its reach in the
 * square sense.
 */
create or replace function in_reach(p_px double precision, p_py double precision,
                                    p_target jsonb, p_corner boolean, p_range int)
  returns boolean language sql immutable as $$
  select case when p_corner then
      floor(p_px) between (p_target->>'cx')::int - 1 and (p_target->>'cx')::int
      and floor(p_py) between (p_target->>'cy')::int - 1 and (p_target->>'cy')::int
    else
      greatest(abs(floor(p_px) - (p_target->>'x')::int), abs(floor(p_py) - (p_target->>'y')::int)) <= coalesce(p_range, 1)
    end
$$;
