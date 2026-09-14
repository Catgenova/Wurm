-- Working the ground: the rock, the soil and what is laid over them.
--
-- Ported from the terrain half of src/game/actions.ts. Digging was already
-- here; this is the rest of what a shovel and a pickaxe do.

/**
 * The hash the island's ore was rolled from, reproduced exactly.
 *
 * This is not a hash chosen for this file — it is *the* hash, the one the
 * browser used when it decided what is under every tile, and the quality a
 * seam gives up is a pure function of it. Anything but an exact match and the
 * island would hand out different metal from the one it was made with.
 *
 * JavaScript does this in unsigned 32-bit arithmetic with `>>> 0` and
 * `Math.imul`; Postgres has neither, so every step is taken in `bigint` and
 * folded back with `% 4294967296`. Tile coordinates and seeds are never
 * negative here, which is what makes that safe — Postgres `%` keeps the sign
 * of its left operand, and a negative would quietly diverge.
 */
create or replace function hash_tile(p_x int, p_y int, p_salt bigint) returns double precision
  language sql immutable as $$
  select (h2 # (h2 >> 16))::double precision / 4294967296
  from (
    select ((h1 # (h1 >> 13)) * 1274126177) % 4294967296 as h2
    from (select (p_x::bigint * 374761393 + p_y::bigint * 668265263 + p_salt * 2246822519) % 4294967296 as h1) a
  ) b
$$;

/** No seam gives up more quality than it holds, however good the miner. */
create or replace function ore_max_ql(p_seed bigint, p_x int, p_y int) returns double precision
  language sql immutable as $$ select round(25 + hash_tile(p_x, p_y, p_seed + 991) * 74) $$;

/** The rock beneath any tile at all, bare or buried or drowned. */
create or replace function bedrock_at(p_world uuid, p_x int, p_y int) returns rock_def
  language sql stable as $$
  select * from rock_def
  where id = least((select max(id) from rock_def), land_rock(p_world, p_x, p_y))
$$;

/** How high the bare rock stands at a corner: the ground, less the soil on it. */
create or replace function rock_height(p_world uuid, p_x int, p_y int) returns int
  language sql stable as $$ select land_height(p_world, p_x, p_y) - land_dirt(p_world, p_x, p_y) $$;

create or replace function tile_slope(p_world uuid, p_x int, p_y int) returns int language sql stable as $$
  select greatest(a, b, c, d) - least(a, b, c, d) from (
    select land_height(p_world, p_x, p_y) a, land_height(p_world, p_x + 1, p_y) b,
           land_height(p_world, p_x + 1, p_y + 1) c, land_height(p_world, p_x, p_y + 1) d) q
$$;

/** Steepest slope of the four tiles that share a corner. */
create or replace function corner_slope(p_world uuid, p_cx int, p_cy int) returns int language sql stable as $$
  select coalesce(max(tile_slope(p_world, gx, gy)), 0)
  from generate_series(p_cx - 1, p_cx) gx, generate_series(p_cy - 1, p_cy) gy
  where gx >= 0 and gy >= 0
$$;

/** What a digger may leave behind: forty, or three times their skill. */
create or replace function max_dig_slope(p_world uuid, p_uid uuid) returns int language sql stable as $$
  select greatest(40, floor(skill_of(p_world, p_uid, 'digging') * 3)::int)
$$;

/**
 * Keep a tile showing what it is made of.
 *
 * Dig every corner of a tile down to the rock and the tile *is* rock, and
 * shows the seam under it; drop soil back on any corner and it is dirt again.
 * Called on the four tiles that share a corner whenever one is cut or raised.
 */
create or replace function reconcile(p_world uuid, p_x int, p_y int) returns void language plpgsql as $$
declare bare boolean; t int; sz int;
begin
  select size into sz from world where id = p_world;
  if p_x < 0 or p_y < 0 or p_x >= sz or p_y >= sz then return; end if;
  t := land_tile(p_world, p_x, p_y);
  bare := land_dirt(p_world, p_x, p_y) = 0 and land_dirt(p_world, p_x + 1, p_y) = 0
      and land_dirt(p_world, p_x + 1, p_y + 1) = 0 and land_dirt(p_world, p_x, p_y + 1) = 0;
  if bare and t <> 4 and t <> 12 then
    perform land_set_tile(p_world, p_x, p_y, 4);
    perform land_set_data(p_world, p_x, p_y, land_rock(p_world, p_x, p_y));
    perform land_announce(p_world, p_x, p_y);
  elsif not bare and t = 4 then
    perform land_set_tile(p_world, p_x, p_y, 1);
    perform land_announce(p_world, p_x, p_y);
  end if;
end $$;

create or replace function reconcile_around(p_world uuid, p_cx int, p_cy int) returns void language plpgsql as $$
declare gx int; gy int;
begin
  for gy in (p_cy - 1)..p_cy loop
    for gx in (p_cx - 1)..p_cx loop
      perform reconcile(p_world, gx, gy);
    end loop;
  end loop;
end $$;

/** Ground that can be trodden down firm. */
create or replace function packable(p_tile int) returns boolean language sql immutable as $$
  select p_tile in (1, 0, 20, 5, 6, 11)   -- dirt, grass, lawn, steppe, tundra, moss
$$;

select private.lock_doors();
