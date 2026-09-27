/*
 * A ship at her best is not pulled back.
 *
 * Reported as players rubberbanding when they move quickly. `rpc_move` lets a
 * body go as far as `travel_speed` allows in the time since its last word,
 * half again and a little over, and pulls it back to that if it went further;
 * a browser more than `SNAP_GAP` from where the island put it is put back
 * there. For a hull, `travel_speed` was her build's pace and nothing else.
 * The browser sails her at `hullSpeed`: her build, the hands on her (control
 * under sail, strength at the oars), her quality, and under sail the weather
 * and the angle she holds to it -- up to two and a half times her build's
 * pace for a fine hull on a reach in a gale. So a good ship in a good wind was
 * dragged back every second, a couple of tiles at a time, and jumped back
 * whenever the tugs added up past four.
 *
 * The island has no weather of its own, so it allows her the best the weather
 * ever gives (`WEATHER_MOST` in src/game/wind.ts) and everything else as it
 * is: the helm's own skill, her own quality, an empty hold.
 */

create or replace function weather_most() returns double precision language sql immutable as $$
  -- windWorth(1) * pointAt of the broadest reach: (0.35 + 1.1) * 1.2.
  select (0.35 + 1.1 * 1) * 1.2
$$;

-- `hullSpeed` in src/game/game.ts, with the weather at its best and nothing in the hold.
create or replace function hull_speed(p_world uuid, p_uid uuid, p placed) returns double precision
  language sql stable as $$
  select b.speed
       * case when b.sail then 0.9 + skill_of(p_world, p_uid, 'body_control') / 320
              else 0.6 + skill_of(p_world, p_uid, 'body_strength') / 150 end
       * (0.75 + p.ql / 220)
       * case when b.sail then weather_most() else 1 end
  from boat_def b where b.id = p.sub
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
    -- hand in her too: a Carpenter's Keel Layer.
    if is_boat(p) then return hull_speed(p_world, p_uid, p) * mark_of(p.mark, 'speed'); end if;
    v := vehicle_speed(p_world, p.id);
    if v > 0 then return v; end if;
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

select private.lock_doors();
