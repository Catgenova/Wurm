-- Nothing walks under half again what it can carry.
--
-- Asked for: "time to implement the inventory movement cap. when inventory is
-- above 150% cap, movement speed becomes 0."
--
-- What a body carries has been the browser's own business since there was a
-- body: `carryLimit` and `totalWeight` live there, the drag of a full pack is
-- drawn there, and the island was told none of it. That is fine for a drag —
-- the worst a browser can do by ignoring it is tire itself out — and no good
-- at all for a stop, because a rule only one side holds is a rule the other
-- side can decline. So the island weighs the pack too, off the same two
-- numbers, now generated into `carry_base()` and `carry_per_strength()`.
--
-- The sum is the same sum on both sides: everything a body holds, bags counted
-- with what is in them, and nothing counted twice — a thing in a bag is held
-- by the bag, and `item_weight` already adds it to the bag it is in.

/** What a back takes: the base, and more for every point of body strength. */
create or replace function carry_limit(p_world uuid, p_uid uuid) returns double precision
  language sql stable as $fn$
  select carry_base() + skill_of(p_world, p_uid, 'body_strength') * carry_per_strength()
$fn$;

/**
 * Everything on a body, in kilos. A bag is weighed with what is in it, and
 * what is in it is held by the bag rather than by the body, so the top of the
 * pack is the whole of the pack.
 */
create or replace function carried_weight(p_world uuid, p_uid uuid) returns double precision
  language sql stable as $fn$
  select coalesce(sum(item_weight(i)), 0) from item i
  where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.inside is null
$fn$;

/** What is on a body as a share of what it takes: one is exactly full. */
create or replace function over_carry(p_world uuid, p_uid uuid) returns double precision
  language sql stable as $fn$
  select case when carry_limit(p_world, p_uid) > 0
              then carried_weight(p_world, p_uid) / carry_limit(p_world, p_uid)
              else 0 end
$fn$;

CREATE OR REPLACE FUNCTION public.rpc_move(p_world uuid, p_x double precision, p_y double precision, p_level integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player; w world;
        gap double precision; far double precision; allowed double precision; share double precision;
        pulled boolean := false; blocked boolean := false;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  perform settle(p_world, me);
  select * into p from player where world_id = p_world and uid = me for update;
  if not found then raise exception 'you are not on this island'; end if;
  select * into w from world where id = p_world;
  if p_x < 0 or p_y < 0 or p_x > w.size or p_y > w.size then raise exception 'that is off the island'; end if;

  /*
   * And first: whether this body can walk at all.
   *
   * Past what a back takes everything is already slower and dearer in wind,
   * and that was the whole of it — load a body with ten times its limit and it
   * still walked, at a crawl. Asked for: "when inventory is above 150% cap,
   * movement speed becomes 0". Half again over the limit is the end of it, and
   * the end has to be here rather than only in the browser: what the island
   * will not do is the only kind of cannot there is.
   *
   * Nothing is said from down here. This call is made a dozen times a walk, so
   * a line each time would be the whole event log; the browser holds the same
   * two numbers and says it once, when it happens.
   */
  if over_carry(p_world, me) > carry_stop() then
    p_x := p.x;
    p_y := p.y;
    p_level := p.level;
    blocked := true;
  end if;

  gap := greatest(0.05, extract(epoch from (now() - p.moved_at)));
  far := sqrt(power(p_x - p.x, 2) + power(p_y - p.y, 2));
  -- A walk, a saddle or a seat; the rest is slack for a link that hiccups.
  allowed := travel_speed(p_world, me) * least(gap, 10) * 1.6 + 1.5;
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
  -- Walking into empty country is what fills it in.
  perform creature_stock_near(p_world, p_x, p_y);
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
