-- Where you are and what is left of you, on the call a walk already makes.
--
-- Reported: killed by a goblin with the health bar never moving once and no
-- wound ever appearing, and then able to walk about dead until a refresh.
-- Three complaints, one cause — the island did all of it correctly and told
-- the browser none of it in time.
--
-- `stats` and `wounds` ride `rpc_settle`, and `rpc_settle` is a minute apart
-- unless one of your own asks arms a shorter beat. Something eating you arms
-- nothing. The fight in the report ran from 11:46:21 to 11:46:23 and the
-- browser was drawing a body pinned a minute earlier: full health, no wounds,
-- and `body_forward` on the browser's side quietly knitting it back up because
-- it had no wounds to bleed from.
--
-- And the death. `settle` at the top of `rpc_move` is where a bleeding body
-- dies; `player_die` empties the wounds, fills the bars and puts the body back
-- at the spawn. `rpc_move` reads the row *after* that, so its pull-back is
-- already measuring from the spawn and the island is right about where you
-- are. It answered with `x` and `y` — and nothing in the browser has ever read
-- this answer, so the body on screen kept walking from where it fell.
--
-- The answer now carries the position, the storey, the bars and the wounds. A
-- walk is at worst half a second apart, so a fight is watched rather than
-- reported afterwards, and a death lands where the island put it.

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

notify pgrst, 'reload schema';
