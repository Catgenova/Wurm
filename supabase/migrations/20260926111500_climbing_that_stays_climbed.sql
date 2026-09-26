/*
 * Climbing that stays climbed.
 *
 * Reported as "climbing seems to level up then resets to 1". It did exactly
 * that. Climbing was the last trade the browser still raised for itself on an
 * island: every step between tiles steeper than a third of `max_step` went
 * into the tab's own copy of the skill book, and nothing told the island. The
 * book the island sends every beat is the `skill` table and the island had no
 * `climbing` row in it, so the next beat wrote the number back to what the
 * island had -- the starting one -- and a refresh did the same. Swimming was
 * lost the same way until `out_of_your_depth` moved it over here.
 *
 * Now `rpc_move` pays it, off the walk it has just accepted, by the browser's
 * own rule and from the browser's own numbers (`climb_learn_from`,
 * `climb_learn`, `climb_learn_steep`, crossed in the defs just before this),
 * and the browser stops raising it wherever the island owns the body.
 *
 * `max_step` was written out by hand in `riding`, as 32. The defs carry it
 * now, from the same `MAX_STEP` the browser walks by, so the step you may take
 * and the step that teaches you cannot come apart.
 */
set local lock_timeout = '3s';

/**
 * The steps a straight walk takes between neighbouring tiles, as heights.
 *
 * Read the way `walk_share` reads the same walk -- the same samples, the same
 * neighbours -- and called on the part of it that `walk_share` let stand. A
 * step onto a bridge is left out: the deck is flat, and the drop under it is
 * not what anybody's feet did.
 */
create or replace function walk_climbs(p_world uuid, p_x0 double precision, p_y0 double precision,
                                       p_x1 double precision, p_y1 double precision)
returns double precision[] language plpgsql stable as $fn$
declare far double precision; n int; i int; t double precision;
        fx int; fy int; tx int; ty int; spans boolean;
        steps double precision[] := '{}';
begin
  far := sqrt(power(p_x1 - p_x0, 2) + power(p_y1 - p_y0, 2));
  if far <= 0.0001 then return steps; end if;
  spans := exists (select 1 from bridge b where b.world_id = p_world);
  fx := floor(p_x0)::int; fy := floor(p_y0)::int;
  n := least(walk_samples()::int, greatest(1, ceil(far * 2)::int));
  for i in 1..n loop
    t := i::double precision / n;
    tx := floor(p_x0 + (p_x1 - p_x0) * t)::int;
    ty := floor(p_y0 + (p_y1 - p_y0) * t)::int;
    if tx <> fx or ty <> fy then
      if abs(tx - fx) <= 1 and abs(ty - fy) <= 1
         and (not spans or bridge_at(p_world, tx, ty) is null) then
        steps := steps || abs(centre_height(p_world, tx, ty) - centre_height(p_world, fx, fy));
      end if;
      fx := tx; fy := ty;
    end if;
  end loop;
  return steps;
end $fn$;

CREATE OR REPLACE FUNCTION public.rpc_move(p_world uuid, p_x double precision, p_y double precision, p_level integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player; w world;
        gap double precision; far double precision; allowed double precision; share double precision;
        pulled boolean := false; blocked boolean := false; crawl double precision := 1;
        cart placed; beast creature; c double precision;
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
  if share < 1 then
    p_x := p.x + (p_x - p.x) * share;
    p_y := p.y + (p_y - p.y) * share;
    blocked := true;
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
