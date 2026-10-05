/*
 * Driving and Sailing (`travel.ts`). Each makes what it steers go faster --
 * `driving_pace` on a cart or wagon you have the reins of, `sailing_pace` on
 * a boat you have the helm of, `driving_top` and `sailing_top` more at
 * `travel_top_at` --
 * and each is learned by going: a go for every tile the cart or the hull goes
 * into, paid off the walk the island is told about (`rpc_move`), as climbing
 * is. `travel_speed`, which is how far a walk may go, has both in it, so the
 * browser's faster pace is a pace the island lets stand.
 */
set local lock_timeout = '3s';

/** What Driving `p_skill` makes of a team's pace: the browser's `drivingPace`. */
create or replace function driving_pace(p_skill double precision)
  returns double precision language sql immutable as $$
  select 1 + driving_top() * least(travel_top_at(), p_skill) / travel_top_at()
$$;

/** What Sailing `p_skill` makes of a hull's pace: the browser's `sailingPace`. */
create or replace function sailing_pace(p_skill double precision)
  returns double precision language sql immutable as $$
  select 1 + sailing_top() * least(travel_top_at(), p_skill) / travel_top_at()
$$;

CREATE OR REPLACE FUNCTION public.travel_speed(p_world uuid, p_uid uuid)
 RETURNS double precision
 LANGUAGE plpgsql
 STABLE
AS $function$
declare c creature; p placed; v double precision; pl player;
begin
  p := driving(p_world, p_uid);
  if p.id is not null then
    -- As fast as she can go under the hands at her helm, and her builder's
    -- hand in her too: a Carpenter's Keel Layer. And the helm's own Sailing
    -- (`sailing_pace`), as the browser's `boatSpeed` has it.
    if is_boat(p) then
      return hull_speed(p_world, p_uid, p) * mark_of(p.mark, 'speed')
           * sailing_pace(skill_of(p_world, p_uid, sailing_skill()));
    end if;
    v := vehicle_speed(p_world, p.id);
    -- And the driver's Driving on the reins (`driving_pace`), past the cap as the mark is.
    if v > 0 then return v * driving_pace(skill_of(p_world, p_uid, driving_skill())); end if;
    return base_speed();
  end if;
  c := mount_of(p_world, p_uid);
  if c.id is not null then
    -- Shod, it goes quicker on laid stone and gravel.
    select * into pl from player where world_id = p_world and uid = p_uid;
    -- The cap comes after the shoes, as the browser has it: a mount at the cap is at the cap.
    -- And quicker again in tack its maker's hand is in (a Tailor's Saddler), past the cap, as a vehicle's mark is.
    return least(max_mount_speed(), mount_speed(c) * case when shod(c) and paved(land_tile(p_world, floor(pl.x)::int, floor(pl.y)::int))
                                                          then shoe_pace() else 1 end) * tack_speed(c);
  end if;
  -- On foot, and on a made road, a Terraformer's Road Legs.
  select * into pl from player where world_id = p_world and uid = p_uid;
  if coalesce((select t.road from tile_def t
                where t.id = land_tile(p_world, floor(pl.x)::int, floor(pl.y)::int)), false) then
    return base_speed() * pk(pl.class_mul, 'walk:road', 1);
  end if;
  return base_speed();
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_move(p_world uuid, p_x double precision, p_y double precision, p_level integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player; w world;
        gap double precision; far double precision; allowed double precision; share double precision;
        pulled boolean := false; blocked boolean := false; crawl double precision := 1;
        cart placed; beast creature; c double precision; v_tiles int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  perform settle(p_world, me);
  select * into p from player where world_id = p_world and uid = me for update;
  if not found then raise exception 'you are not on this island'; end if;
  select * into w from world where id = p_world;
  if p_x < 0 or p_y < 0 or p_x > w.size or p_y > w.size then raise exception 'that is off the island'; end if;

  /*
   * Aboard as a passenger, a body is where she is, whatever its browser says
   * it walked to: the only way off her is `leave_passenger`, and the only way
   * she moves is under whoever has her helm.
   */
  if p.aboard is not null then
    select pl.cx, pl.cy into p_x, p_y from placed pl where pl.id = p.aboard;
    update player set x = p_x, y = p_y, level = 0, moved_at = now(), seen_at = now(), away = false
      where world_id = p_world and uid = me;
    select * into p from player where world_id = p_world and uid = me;
    return jsonb_build_object('x', p_x, 'y', p_y, 'level', 0, 'pulled', false, 'blocked', false,
      'stats', p.stats, 'wounds', coalesce(p.wounds, '[]'::jsonb));
  end if;

  /*
   * And first: how much of a walk this body is good for.
   *
   * Past what a back takes everything is already slower and dearer in wind,
   * and that was the whole of it — load a body with ten times its limit and it
   * still walked, at a crawl. Half again over the limit used to be the flat
   * end of it: this pinned `p_x` and `p_y` to where the body already was, so
   * the only way out of an overload was to put things on the ground and leave
   * them. It is `carry_crawl()` of the pace now — a twentieth — which is slow
   * enough to be no way to travel and quick enough to be a way out.
   *
   * It still has to be decided here rather than only in the browser: what the
   * island will not allow is the only kind of cannot there is, and a limit
   * only the browser holds is a limit a browser can decline.
   *
   * Nothing is said from down here. This call is made a dozen times a walk, so
   * a line each time would be the whole event log; the browser holds the same
   * two numbers and says it once, when it happens.
   */
  if over_carry(p_world, me) > carry_stop() then
    crawl := carry_crawl();
    blocked := true;
  end if;

  gap := greatest(0.05, extract(epoch from (now() - p.moved_at)));
  far := sqrt(power(p_x - p.x, 2) + power(p_y - p.y, 2));
  /*
   * A walk, a saddle or a seat; the rest is slack for a link that hiccups.
   *
   * And `crawl` on the whole of it, slack included, when the load is half
   * again over the limit. It has to take the slack down with it or the slack
   * *is* the allowance: a second and a half of grace on a body that may move
   * a twentieth of a tile a second would let it cross a field a hiccup at a
   * time, which is the rule not applying at all.
   */
  allowed := (travel_speed(p_world, me) * least(gap, 10) * 1.6 + 1.5) * crawl;
  if far > allowed then
    p_x := p.x + (p_x - p.x) * (allowed / far);
    p_y := p.y + (p_y - p.y) * (allowed / far);
    pulled := true;
  end if;

  share := walk_share(p_world, me, p_level, p.x, p.y, p_x, p_y);
  -- Frame: up a storey the edge of what is built there stops a body, railed or not (`frame_footing`).
  if p_level > 0 then share := least(share, frame_footing(p_world, p_level, p.x, p.y, p_x, p_y)); end if;
  if share < 1 then
    p_x := p.x + (p_x - p.x) * share;
    p_y := p.y + (p_y - p.y) * share;
    blocked := true;
  end if;
  -- cellar: a body in a cellar, or going into or out of one, is held to its floor and its way down.
  if (p_level < 0 or p.level < 0) and not cellar_move_ok(p_world, me, p.level, p_level, p.x, p.y, p_x, p_y) then
    p_x := p.x; p_y := p.y; p_level := p.level; blocked := true;
  end if;

  update player set x = p_x, y = p_y, level = p_level, moved_at = now(), seen_at = now(), away = false
    where world_id = p_world and uid = me;
  perform drag_along(p_world, me, p_x, p_y);
  /*
   * And what the walk taught the feet that took it.
   *
   * Reported as climbing going up and then back to one. The browser raised it
   * off every step between tiles and the island never did, so there was no
   * `climbing` row to go in the book the island sends every beat: the number
   * went up in the tab, was written over the next time the book came, and was
   * gone at the next refresh. Swimming went the same way before it.
   *
   * So the island pays it, off the walk it has just let stand: every step
   * between neighbouring tiles steeper than `climb_learn_from` of `max_step`
   * is a go of `climb_learn`, and `climb_learn_steep` more for each
   * `max_step` of height in it -- the browser's rule, read from the same
   * numbers. Your own feet on the ground and nothing else: a saddle's climb is
   * the beast's, a hull and a cart seat climb nothing, a floor is flat, and a
   * bridge deck is not the ground under it (`walk_climbs`).
   *
   * It is paid a go a step, as the browser pays it, and no faster than a walk
   * the pull-back above accepts can take steps.
   */
  cart := driving(p_world, me);
  beast := mount_of(p_world, me);
  if p_level = 0 and p.level = 0 and cart.id is null and beast.id is null then
    foreach c in array walk_climbs(p_world, p.x, p.y, p_x, p_y) loop
      if c > max_step() * climb_learn_from() then
        perform skill_raise(p_world, me, 'climbing', climb_learn() + c / max_step() * climb_learn_steep());
      end if;
    end loop;
    /*
     * And the wear those feet put on the ground: a point on every tile of
     * grass, lawn, steppe, tundra or moss stepped into, and a trail at
     * `wear_trail` (`wear_walk`). Nothing at all unless the walk left the
     * tile it started in, which is four calls in five: a straight line cannot
     * leave a tile and come back into it. And then one small row a tile.
     */
    if floor(p_x) <> floor(p.x) or floor(p_y) <> floor(p.y) then
      perform wear_walk(p_world, p.x, p.y, p_x, p_y);
    end if;
  end if;
  /*
   * And what the reins or the helm taught the hands on them: a go of Driving
   * or of Sailing (`driving_learn`, `sailing_learn`) for every tile the cart
   * or the hull went into, which is what the browser pays in a game of its own.
   * A straight walk goes into one tile for every line between tiles it
   * crosses. Only under way: a cart nothing pulls goes nowhere in the browser,
   * and teaches nothing here either.
   */
  if cart.id is not null and p_level = 0 and p.level = 0 then
    v_tiles := least(20, abs(floor(p_x) - floor(p.x)) + abs(floor(p_y) - floor(p.y)))::int;
    if v_tiles > 0 and (is_boat(cart) or vehicle_speed(p_world, cart.id) > 0) then
      for i in 1 .. v_tiles loop
        perform skill_raise(p_world, me, case when is_boat(cart) then sailing_skill() else driving_skill() end,
                            case when is_boat(cart) then sailing_learn() else driving_learn() end);
      end loop;
    end if;
  end if;
  /*
   * And the wildlife is *not* put out here any more.
   *
   * It was: walking into a block of country nobody had been through stocked
   * it, on this call, while the walker stood and waited. A block of land is
   * something like a second and a half of that, and it is paid on the one
   * call a walking browser makes constantly -- so the walk stopped, and
   * because PostgREST answers eight at a time, three people crossing fresh
   * country took three of those eight for the duration and *everything* the
   * island was asked went slow with them. That is the whole of what was
   * reported as the island severely delaying its answers.
   *
   * It lives on `stock_tick` now, which has a clock of its own and a lock of
   * its own, and which puts out the block a body is standing in *and the
   * eight around it* -- so the country is stocked before anybody walks into
   * it rather than because they did. Nobody waits for it. See `stock_tick`.
   */
  /*
   * And the body, on the one call a walking browser makes constantly.
   *
   * Reported as being killed by a goblin with the health bar never moving and
   * no wound ever showing, and then walking about dead until a refresh. Both
   * halves are this answer: `stats` and `wounds` rode `rpc_settle` and nothing
   * else, and `rpc_settle` is a minute apart unless one of your *own* asks
   * arms it. Something eating you arms nothing, so a fight that takes ten
   * seconds happens entirely inside one heartbeat: the island takes the health
   * off and opens the wounds and kills you, and the browser is drawing a body
   * from a minute ago — full, unmarked, and still walking.
   *
   * Which is the second half. `settle` at the top of this function is where a
   * bleeding body dies, and `player_die` puts it back at the spawn; the row
   * below is read after that, so the pull-back above is already measuring from
   * where the island has *just put you*. The answer said none of it, and the
   * browser threw away what it did say — `x` and `y` have been in here since
   * the day it was written and nothing has ever read them.
   *
   * So it says where you are, what is left of you, and what you are carrying.
   * A walk is half a second apart at worst, which is the difference between
   * watching yourself die and being told about it afterwards.
   */
  select * into p from player where world_id = p_world and uid = me;
  return jsonb_build_object('x', p_x, 'y', p_y, 'level', p_level,
    'pulled', pulled, 'blocked', blocked,
    'stats', p.stats, 'wounds', coalesce(p.wounds, '[]'::jsonb));
end $function$;

select private.lock_doors();
