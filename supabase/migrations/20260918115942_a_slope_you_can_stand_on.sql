-- A slope you can stand on
--
-- Asked from the island. A walk was refused by the step between one tile's
-- middle and the next's — thirty-two, and climbing raises it — and by nothing
-- else, so a tile could be dug into a wall seventy high between its corners
-- and still be walked, as long as the middles of it and its neighbour were
-- near enough. A body stood on a cliff face. And nothing on the island could
-- be fenced with a spade, which is the oldest fence there is.
--
-- So a tile has a slope you can stand on: sixty between its highest corner
-- and its lowest, off the one table both sides read (`max_stand`), raised by
-- climbing at the rate the step is (`climb_per_level`). The island's generator
-- leaves nothing steeper than twenty-two, so this touches only ground somebody
-- has worked: a dirt wall keeps a wildermon in, or a stranger out, exactly as
-- it would. `walk_share` reads the slope off the square it already has in
-- hand (`chunk_slope`, beside `chunk_centre`) and falls back to the scanlines
-- where the square is short; a rider has the mount's cap, wheels the bare
-- sixty, and a hull floats over whatever the bottom does. `creature_tile_ok`
-- asks the same of a wild thing, so it neither wanders up a wall nor is put
-- down on one.

/** The steepest edge of a tile, out of a square already in hand: highest corner less lowest. */
create or replace function chunk_slope(k land_chunk, p_cx int, p_cy int, p_x int, p_y int, p_step int)
  returns int language sql immutable as $fn$
  select greatest(a, b, c, d) - least(a, b, c, d) from (select
    b_i16(k.heights, (p_y - p_cy * p_step) * (p_step + 1) + (p_x - p_cx * p_step)) a,
    b_i16(k.heights, (p_y - p_cy * p_step) * (p_step + 1) + (p_x - p_cx * p_step) + 1) b,
    b_i16(k.heights, (p_y + 1 - p_cy * p_step) * (p_step + 1) + (p_x - p_cx * p_step) + 1) c,
    b_i16(k.heights, (p_y + 1 - p_cy * p_step) * (p_step + 1) + (p_x - p_cx * p_step)) d) q
$fn$;

create or replace function creature_tile_ok(p_world uuid, p_x int, p_y int) returns boolean
  language sql stable as $fn$
  select passable(p_world, p_x, p_y) and centre_height(p_world, p_x, p_y) >= -1
     and tile_slope(p_world, p_x, p_y) <= max_stand()
$fn$;

CREATE OR REPLACE FUNCTION public.walk_share(p_world uuid, p_uid uuid, p_level integer, p_x0 double precision, p_y0 double precision, p_x1 double precision, p_y1 double precision)
 RETURNS double precision
 LANGUAGE plpgsql
AS $function$
declare far double precision; n int; i int; t double precision;
        fx int; fy int; tx int; ty int; climb double precision;
        size int; step int := chunk_size()::int;
        k land_chunk; kx int := -999; ky int := -999;
        here double precision; there double precision; spans boolean; walls int[];
        stand double precision; afloat boolean; beast creature;
begin
  if p_level <> 0 then return 1; end if;
  far := sqrt(power(p_x1 - p_x0, 2) + power(p_y1 - p_y0, 2));
  if far <= 0.0001 then return 1; end if;
  select w.size into size from world w where w.id = p_world;
  fx := floor(p_x0)::int; fy := floor(p_y0)::int;
  -- Asked once for the island rather than once a tile. `bridge_at` is two
  -- index probes and a subquery, and on an island with no bridges on it at all
  -- — which is most of them, most of the time — it was the largest thing left
  -- in this loop once the ground came out of a square.
  spans := exists (select 1 from bridge b where b.world_id = p_world);
  -- The one tile nothing stands on, asked for once. A select per tile against
  -- a table of twenty rows is still a select per tile.
  select coalesce(array_agg(id), '{}') into walls from tile_def where blocks;
  if spans and bridge_at(p_world, fx, fy) is not null then return 1; end if;

  n := least(walk_samples()::int, greatest(1, ceil(far * 2)::int));
  climb := max_step() + skill_of(p_world, p_uid, 'climbing') * climb_per_level();
  /*
   * The steepest tile a body can stand on, before the step between tiles is
   * asked about at all: sixty between a tile's highest corner and its lowest,
   * and climbing raises it at the rate it raises the step. A rider has the
   * mount's legs under them, so the cap is the mount's, raised the way its
   * step is; wheels get the bare sixty; and a hull floats over whatever the
   * bottom does, so afloat there is no cap. A deck is ground: a bridge over a
   * steep tile is not the tile.
   */
  afloat := coalesce(is_boat(driving(p_world, p_uid)), false);
  beast := mount_of(p_world, p_uid);
  if beast.id is not null then stand := max_stand() + mount_step(beast) - max_step();
  elsif (driving(p_world, p_uid)).id is not null then stand := max_stand();
  else stand := max_stand() + skill_of(p_world, p_uid, 'climbing') * climb_per_level();
  end if;
  for i in 1..n loop
    t := i::double precision / n;
    tx := floor(p_x0 + (p_x1 - p_x0) * t)::int;
    ty := floor(p_y0 + (p_y1 - p_y0) * t)::int;
    if tx <> fx or ty <> fy then
      if tx < 0 or ty < 0 or tx >= size or ty >= size then return (i - 1)::double precision / n; end if;
      if tx / step <> kx or ty / step <> ky then
        kx := tx / step; ky := ty / step;
        k := land_chunk_get(p_world, kx, ky);
      end if;
      -- A square built from an island with rows missing can be short; the
      -- scanlines are the truth, so fall back to them rather than reading off
      -- the end of a cache.
      if k.tiles is null or length(k.tiles) <= (ty - ky * step) * step + (tx - kx * step) then
        if not passable(p_world, tx, ty) then return (i - 1)::double precision / n; end if;
      elsif get_byte(k.tiles, (ty - ky * step) * step + (tx - kx * step)) = any (walls) then
        return (i - 1)::double precision / n;
      end if;
      if not afloat and (not spans or bridge_at(p_world, tx, ty) is null) then
        if k.heights is not null and length(k.heights) >= (step + 1) * (step + 1) * 2 then
          if chunk_slope(k, kx, ky, tx, ty, step) > stand then return (i - 1)::double precision / n; end if;
        elsif tile_slope(p_world, tx, ty) > stand then
          return (i - 1)::double precision / n;
        end if;
      end if;
      if abs(tx - fx) <= 1 and abs(ty - fy) <= 1
         and fx / step = kx and fy / step = ky
         and k.heights is not null and length(k.heights) >= (step + 1) * (step + 1) * 2
         and (not spans or bridge_at(p_world, tx, ty) is null) then
        there := chunk_centre(k, kx, ky, tx, ty, step);
        here := chunk_centre(k, kx, ky, fx, fy, step);
        if abs(there - here) > climb then return (i - 1)::double precision / n; end if;
      elsif abs(tx - fx) <= 1 and abs(ty - fy) <= 1
         and (not spans or bridge_at(p_world, tx, ty) is null)
         and abs(centre_height(p_world, tx, ty) - centre_height(p_world, fx, fy)) > climb then
        return (i - 1)::double precision / n;
      end if;
      fx := tx; fy := ty;
    end if;
  end loop;
  return 1;
end $function$
;

select private.lock_doors();
