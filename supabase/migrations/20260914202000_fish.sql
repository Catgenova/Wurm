-- Fishing: a rod off the bank, and a net walked round the shallows.
--
-- Everything is caught from where you stand, so finding water with depth to it
-- close to something you can stand on is half the trade. What runs in the
-- shallows is not what runs off a drop-off, and what runs deep will not come up
-- for a beginner.

/** How deep the water is on a tile, in height units; zero on dry land. */
create or replace function water_depth(p_world uuid, p_x int, p_y int) returns double precision
  language sql stable as $$
  select case when least(a, b, c, d) < 0 then greatest(0, -((a + b + c + d) / 4.0)) else 0 end
  from (select land_height(p_world, p_x, p_y) a, land_height(p_world, p_x + 1, p_y) b,
               land_height(p_world, p_x + 1, p_y + 1) c, land_height(p_world, p_x, p_y + 1) d) q
$$;

/** Water worth putting a line into: deep enough to hold anything at all. */
create or replace function fishable(p_world uuid, p_x int, p_y int) returns boolean
  language sql stable as $$ select water_depth(p_world, p_x, p_y) >= 1 $$;

/** The best water within reach of where somebody is standing. */
create or replace function best_water_near(p_world uuid, p_uid uuid, p_range int default 3)
  returns table (x int, y int, depth double precision) language sql stable as $$
  select gx, gy, water_depth(p_world, gx, gy)
  from player py,
       generate_series(floor(py.x)::int - p_range, floor(py.x)::int + p_range) gx,
       generate_series(floor(py.y)::int - p_range, floor(py.y)::int + p_range) gy
  where py.world_id = p_world and py.uid = p_uid
    and gx >= 0 and gy >= 0 and water_depth(p_world, gx, gy) >= 1
  order by water_depth(p_world, gx, gy) desc limit 1
$$;

/** How far a line will go, and how far a net is dragged. */
create or replace function cast_range() returns double precision language sql immutable as $$ select 3.6 $$;
create or replace function net_range() returns double precision language sql immutable as $$ select 2.6 $$;

/**
 * Where the line actually goes. Whatever was clicked is a hint: if it is water
 * you can reach from where you stand, it is fished; otherwise the deepest water
 * within a cast of your feet is.
 */
create or replace function cast_at(p_world uuid, p_uid uuid, p_x int, p_y int, p_range double precision)
  returns table (x int, y int, depth double precision) language plpgsql stable as $$
declare py player;
begin
  select * into py from player where world_id = p_world and uid = p_uid;
  if fishable(p_world, p_x, p_y)
     and sqrt(power(p_x + 0.5 - py.x, 2) + power(p_y + 0.5 - py.y, 2)) <= p_range then
    return query select p_x, p_y, water_depth(p_world, p_x, p_y);
  else
    return query select * from best_water_near(p_world, p_uid, 3);
  end if;
end $$;

/** What could be caught here by somebody who knows this much. */
create or replace function fish_here(p_depth double precision, p_skill double precision)
  returns setof fish_def language sql stable as $$
  select * from fish_def where p_depth >= depth and p_skill >= level
$$;

/**
 * One fish out of the pool, weighted, with whatever is on the hook counted in.
 *
 * A bait is worth eight of a fish's own weight for its first favourite, four
 * for its second, and everything it does not favour is worth a third of what it
 * would have been. The roll comes in as an argument so that a net taking five
 * passes gets five answers rather than one answer five times.
 */
create or replace function pick_fish(p_depth double precision, p_skill double precision,
                                     p_bait text, p_roll double precision)
  returns text language sql stable as $$
  select id from (
    select f.id, sum(w) over (order by w desc, f.id) upto, sum(w) over () total
    from fish_here(p_depth, p_skill) f
    cross join lateral (select case
      when p_bait is null then f.weight
      else coalesce(
        (select f.weight * (8.0 / (bf.rank + 1)) from bait_favours bf
         where bf.bait = p_bait and bf.fish = f.id),
        f.weight * 0.35)
      end as w) q
  ) r where upto >= p_roll * total order by upto limit 1
$$;

/**
 * What comes up, or nothing for a bite that came off. Deeper water and a
 * better hand both help; the rarer fish are simply rarer wherever you stand.
 */
create or replace function catch_fish(p_depth double precision, p_skill double precision,
                                      p_rod_ql double precision, p_bait text)
  returns text language sql volatile as $$
  select case
    when not exists (select 1 from fish_here(p_depth, p_skill)) then null
    when random() > least(0.95, 0.3 + p_skill / 190 + p_rod_ql / 320
                          + case when p_bait is null then 0 else 0.12 end) then null
    else pick_fish(p_depth, p_skill, p_bait, random())
    end
$$;

/**
 * The bait in the pack worth using here: the one favouring the rarest thing
 * that actually swims at this depth. A fish on the hook is a fish you are not
 * eating, so the last one of anything is left alone — you have to be able to
 * spare it.
 */
create or replace function bait_for(p_world uuid, p_uid uuid, p_depth double precision, p_skill double precision)
  returns text language sql stable as $$
  select b.id from bait_def b
  cross join lateral (
    select max(100 - f.weight) as score
    from bait_favours bf join fish_here(p_depth, p_skill) f on f.id = bf.fish
    where bf.bait = b.id) s
  where s.score > 0
    and pack_count(p_world, p_uid, b.id)
        >= case when exists (select 1 from fish_def where id = b.id) then 2 else 1 end
  order by s.score desc, b.id limit 1
$$;

select private.lock_doors();
