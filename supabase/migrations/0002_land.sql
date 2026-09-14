-- Reading and writing one corner or one tile of the land.
--
-- These are the only things that know the land is bytes. Everything above
-- asks for the height of a corner and is given a number, exactly as the
-- TypeScript world does, so the rules read the same in both places.

/** A signed 16-bit little-endian value out of a byte string. */
create or replace function b_i16(b bytea, i int) returns int language sql immutable as $$
  select case when v > 32767 then v - 65536 else v end
  from (select get_byte(b, i * 2) | (get_byte(b, i * 2 + 1) << 8) as v) q
$$;

/** And back in again. */
create or replace function b_put_i16(b bytea, i int, v int) returns bytea language sql immutable as $$
  select set_byte(set_byte(b, i * 2, (v & 255)), i * 2 + 1, ((v >> 8) & 255))
$$;

/**
 * Every accessor below takes `p_`-prefixed arguments, without exception.
 *
 * `land_tile` is both a table and a function, and when the function's argument
 * was plainly `y` the condition `y = land_tile.y` bound *both* sides to the
 * table's column: a where clause reading `y = y`, true of every row, returning
 * whichever row came first. It read plausible values from the wrong row of the
 * island and nothing complained. The prefix is not decoration.
 */
create or replace function land_height(p_world uuid, p_x int, p_y int) returns int language sql stable as $$
  select b_i16(c.heights, p_x) from land_corner c where c.world_id = p_world and c.y = p_y
$$;

create or replace function land_dirt(p_world uuid, p_x int, p_y int) returns int language sql stable as $$
  select get_byte(c.dirt, p_x) from land_corner c where c.world_id = p_world and c.y = p_y
$$;

create or replace function land_tile(p_world uuid, p_x int, p_y int) returns int language sql stable as $$
  select get_byte(t.tiles, p_x) from land_tile t where t.world_id = p_world and t.y = p_y
$$;

create or replace function land_data(p_world uuid, p_x int, p_y int) returns int language sql stable as $$
  select get_byte(t.data, p_x) from land_tile t where t.world_id = p_world and t.y = p_y
$$;

create or replace function land_rock(p_world uuid, p_x int, p_y int) returns int language sql stable as $$
  select get_byte(t.rock, p_x) from land_tile t where t.world_id = p_world and t.y = p_y
$$;

create or replace function land_set_height(p_world uuid, p_x int, p_y int, p_v int) returns void language sql as $$
  update land_corner c set heights = b_put_i16(c.heights, p_x, greatest(-32768, least(32767, p_v)))
  where c.world_id = p_world and c.y = p_y
$$;

create or replace function land_set_dirt(p_world uuid, p_x int, p_y int, p_v int) returns void language sql as $$
  update land_corner c set dirt = set_byte(c.dirt, p_x, greatest(0, least(255, p_v)))
  where c.world_id = p_world and c.y = p_y
$$;

create or replace function land_set_tile(p_world uuid, p_x int, p_y int, p_v int) returns void language sql as $$
  update land_tile t set tiles = set_byte(t.tiles, p_x, greatest(0, least(255, p_v)))
  where t.world_id = p_world and t.y = p_y
$$;

create or replace function land_set_data(p_world uuid, p_x int, p_y int, p_v int) returns void language sql as $$
  update land_tile t set data = set_byte(t.data, p_x, greatest(0, least(255, p_v)))
  where t.world_id = p_world and t.y = p_y
$$;

create or replace function land_set_rock(p_world uuid, p_x int, p_y int, p_v int) returns void language sql as $$
  update land_tile t set rock = set_byte(t.rock, p_x, greatest(0, least(255, p_v)))
  where t.world_id = p_world and t.y = p_y
$$;

/**
 * Say that a tile changed, once, to everybody.
 *
 * Realtime carries the insert; a player who was away reads the same rows back
 * in order. One shout, two jobs, and no second code path for catching up.
 */
create or replace function land_announce(p_world uuid, p_x int, p_y int) returns void language sql as $$
  insert into tile_change (world_id, x, y, tile, data, corners)
  values (p_world, p_x, p_y, land_tile(p_world, p_x, p_y), land_data(p_world, p_x, p_y),
          array[land_height(p_world, p_x, p_y), land_height(p_world, p_x + 1, p_y),
                land_height(p_world, p_x + 1, p_y + 1), land_height(p_world, p_x, p_y + 1)])
$$;

/**
 * Lay down an empty island of a given size, flat and at sea level, ready to
 * have a real one written over it. Generating the island itself stays in the
 * browser: it is a big deterministic function of a seed, it already exists,
 * and there is nothing to be gained by teaching Postgres to do it again.
 */
create or replace function land_blank(p_world uuid, p_size int) returns void language plpgsql as $$
declare i int;
begin
  for i in 0..p_size loop
    insert into land_corner (world_id, y, heights, dirt)
    values (p_world, i, decode(repeat('00', (p_size + 1) * 2), 'hex'), decode(repeat('14', p_size + 1), 'hex'))
    on conflict do nothing;
  end loop;
  for i in 0..(p_size - 1) loop
    insert into land_tile (world_id, y, tiles, data, rock)
    values (p_world, i, decode(repeat('00', p_size), 'hex'), decode(repeat('00', p_size), 'hex'), decode(repeat('00', p_size), 'hex'))
    on conflict do nothing;
  end loop;
end $$;
