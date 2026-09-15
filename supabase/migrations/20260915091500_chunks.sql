-- The land, read in squares instead of strips.
--
-- Land is stored one row per scanline, which is the right shape for storing it
-- and the wrong shape for reading a little of it. A scanline on a 4096 island
-- is four kilobytes of tiles or eight of corners, TOAST-compressed, and
-- Postgres decompresses the whole row to hand back one byte of it. Reading one
-- tile is cheap enough. Reading a *walk* is not: a diagonal thirty tiles
-- touches thirty scanlines of tiles and sixty of corners, and every one of
-- them is a separate decompression.
--
-- Measured on the real 4096 island, the same thirty tiles:
--
--     scanlines, as the rules read them now        5.19 ms
--     one chunk row, fetched once                  0.22 ms
--
-- Twenty-four times, which is the 443-buffers-against-39 the cost analysis
-- predicted and never had a caller to spend.
--
-- ## Derived, not authoritative
--
-- The scanlines stay the truth. A chunk is a cache with no opinions: a land
-- write throws away the one or four chunks it touches, and the next reader
-- builds whatever it needs. That keeps the write side where the analysis found
-- it — a dug tile is 1,532 bytes of WAL against a chunk row's 8,154 — because
-- a delete carries a tuple id and not a payload, while a second authoritative
-- copy would have carried the whole square.
--
-- Reads outnumber writes by a very long way here: a walk asks about the ground
-- every second, per person, and digging is something that happens now and then.

create table if not exists land_chunk (
  world_id uuid not null references world(id) on delete cascade,
  cx int not null,
  cy int not null,
  tiles bytea not null,
  heights bytea not null,
  primary key (world_id, cx, cy)
);
alter table land_chunk enable row level security;

/** A byte string brought up to length with noughts. */
create or replace function pad(b bytea, n int) returns bytea language sql immutable as $$
  select case when length(b) >= n then b
              else b || decode(repeat('00', n - length(b)), 'hex') end
$$;

/**
 * A square of land, built from the scanlines if it is not already about.
 *
 * Every row is padded to the full stride so the arithmetic is the same at the
 * edge of the island as in the middle: a plane is always `chunk_size` bytes to
 * the row of tiles and `chunk_size + 1` corners to the row of heights,
 * whatever the island's size does or does not divide into.
 *
 * `on conflict do nothing` rather than a lock: two callers building the same
 * square build the same bytes, so the loser of the race has lost nothing.
 */
create or replace function land_chunk_get(p_world uuid, p_cx int, p_cy int) returns land_chunk
  language plpgsql as $$
declare k land_chunk; n int := chunk_size()::int;
begin
  select * into k from land_chunk where world_id = p_world and cx = p_cx and cy = p_cy;
  if found then return k; end if;

  insert into land_chunk (world_id, cx, cy, tiles, heights)
  select p_world, p_cx, p_cy,
    coalesce((select string_agg(pad(substring(t.tiles from p_cx * n + 1 for n), n), ''::bytea order by t.y)
              from land_tile t where t.world_id = p_world and t.y between p_cy * n and p_cy * n + n - 1), ''::bytea),
    coalesce((select string_agg(pad(substring(c.heights from p_cx * n * 2 + 1 for (n + 1) * 2), (n + 1) * 2), ''::bytea order by c.y)
              from land_corner c where c.world_id = p_world and c.y between p_cy * n and p_cy * n + n), ''::bytea)
  on conflict (world_id, cx, cy) do nothing;

  select * into k from land_chunk where world_id = p_world and cx = p_cx and cy = p_cy;
  return k;
end $$;

/**
 * Throw away the square or squares a change touches.
 *
 * A tile belongs to one. A *corner* belongs to as many as four, because the
 * corner planes overlap by one at every edge — which is exactly what makes all
 * four corners of any tile readable out of that tile's own square.
 */
create or replace function land_chunk_forget(p_world uuid, p_x int, p_y int, p_corner boolean default false)
  returns void language sql as $$
  delete from land_chunk
  where world_id = p_world
    and cx between (case when p_corner then greatest(0, p_x - 1) else p_x end) / chunk_size()::int
                and p_x / chunk_size()::int
    and cy between (case when p_corner then greatest(0, p_y - 1) else p_y end) / chunk_size()::int
                and p_y / chunk_size()::int
$$;

create or replace function land_set_tile(p_world uuid, p_x int, p_y int, p_v int) returns void language sql as $$
  update land_tile t set tiles = set_byte(t.tiles, p_x, greatest(0, least(255, p_v)))
  where t.world_id = p_world and t.y = p_y;
  select land_chunk_forget(p_world, p_x, p_y);
$$;

create or replace function land_set_data(p_world uuid, p_x int, p_y int, p_v int) returns void language sql as $$
  update land_tile t set data = set_byte(t.data, p_x, greatest(0, least(255, p_v)))
  where t.world_id = p_world and t.y = p_y;
  select land_chunk_forget(p_world, p_x, p_y);
$$;

create or replace function land_set_rock(p_world uuid, p_x int, p_y int, p_v int) returns void language sql as $$
  update land_tile t set rock = set_byte(t.rock, p_x, greatest(0, least(255, p_v)))
  where t.world_id = p_world and t.y = p_y;
  select land_chunk_forget(p_world, p_x, p_y);
$$;

create or replace function land_set_height(p_world uuid, p_x int, p_y int, p_v int) returns void language sql as $$
  update land_corner c set heights = b_put_i16(c.heights, p_x, greatest(-32768, least(32767, p_v)))
  where c.world_id = p_world and c.y = p_y;
  select land_chunk_forget(p_world, p_x, p_y, true);
$$;

/**
 * The ground under a claimed walk, read a square at a time.
 *
 * Same answers as before, same two properties — it never refuses what the
 * browser allows, and it lets a body out of somewhere it should not be — and
 * the same sampling. What changed is that the tile and its four corners now
 * come out of a square held in hand, refetched only when the walk crosses into
 * a new one. A thirty-tile walk is one or two fetches instead of ninety.
 */
create or replace function walk_share(p_world uuid, p_uid uuid, p_level int,
  p_x0 double precision, p_y0 double precision,
  p_x1 double precision, p_y1 double precision) returns double precision
  language plpgsql as $$
declare far double precision; n int; i int; t double precision;
        fx int; fy int; tx int; ty int; climb double precision;
        size int; step int := chunk_size()::int;
        k land_chunk; kx int := -999; ky int := -999;
        here double precision; there double precision; spans boolean; walls int[];
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
end $$;

/** The middle of a tile, out of a square already in hand. */
create or replace function chunk_centre(k land_chunk, p_cx int, p_cy int, p_x int, p_y int, p_step int)
  returns double precision language sql immutable as $$
  select (b_i16(k.heights, (p_y - p_cy * p_step) * (p_step + 1) + (p_x - p_cx * p_step))
        + b_i16(k.heights, (p_y - p_cy * p_step) * (p_step + 1) + (p_x - p_cx * p_step) + 1)
        + b_i16(k.heights, (p_y + 1 - p_cy * p_step) * (p_step + 1) + (p_x - p_cx * p_step) + 1)
        + b_i16(k.heights, (p_y + 1 - p_cy * p_step) * (p_step + 1) + (p_x - p_cx * p_step))) / 4.0
$$;

select private.lock_doors();
