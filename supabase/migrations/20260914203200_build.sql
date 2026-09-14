-- A settlement, and the houses that stand on it.
--
-- ## Why a building is four tables
--
-- A building is a footprint of tiles, a wall on each of a set of *borders*,
-- and a floor slot per tile per storey. The browser keeps the three in maps
-- keyed by a string — `"2:h:14,9"` — which is a primary key written the long
-- way round. Here they are columns, and the key does the work it was always
-- doing: one wall per border per storey, one floor per tile per storey, one
-- building per tile.
--
-- Walls and floors are planned before they are built, and are then fed
-- materials one unit at a time. What is still owed is a bill on the row, and a
-- thing is finished when its bill is empty — which is the same rule for a
-- wall, a roof, a staircase and a ladder, so it is written once.

/* ------------------------------------------------------------------ *
 * Things any part of the island may want to ask about the land.
 * ------------------------------------------------------------------ */

create or replace function in_bounds(p_world uuid, p_x int, p_y int) returns boolean
  language sql stable as $$
  select p_x >= 0 and p_y >= 0 and p_x < (select size from world where id = p_world)
     and p_y < (select size from world where id = p_world)
$$;

/** Whether anything alive can stand on the tile at all. */
create or replace function passable(p_world uuid, p_x int, p_y int) returns boolean
  language sql stable as $$
  select in_bounds(p_world, p_x, p_y)
     and not coalesce((select blocks from tile_def where id = land_tile(p_world, p_x, p_y)), true)
$$;

/**
 * Whether a tile is wet at all.
 *
 * Not `water_depth() > 0`: a tile with one corner just under and three well
 * over averages out dry, and you still cannot build there.
 */
create or replace function has_water(p_world uuid, p_x int, p_y int) returns boolean
  language sql stable as $$
  select least(land_height(p_world, p_x, p_y), land_height(p_world, p_x + 1, p_y),
               land_height(p_world, p_x + 1, p_y + 1), land_height(p_world, p_x, p_y + 1)) < 0
$$;

/* ------------------------------------------------------------------ *
 * The settlement.
 * ------------------------------------------------------------------ */

/**
 * One deed to an island.
 *
 * In the browser the deed is the player's; here the island is shared, and a
 * shared island with a deed each would be a border dispute rather than a game.
 * So the first stake planted claims the island's one settlement and everybody
 * who lands there builds on it. Who planted it is kept, because the deed
 * actions that are still to come — disband, upgrade — are theirs to take.
 */
create table if not exists deed (
  world_id uuid primary key references world on delete cascade,
  name text not null check (length(name) between 1 and 32),
  x int not null,
  y int not null,
  radius int not null default 5,
  level int not null default 1 check (level between 1 and 5),
  founded_by uuid,
  founded_at timestamptz not null default now()
);
alter table deed enable row level security;
drop policy if exists deed_read on deed;
create policy deed_read on deed for select to authenticated using (true);
grant select on deed to authenticated;
revoke insert, update, delete on deed from anon, authenticated;

create or replace function deed_radius(p_level int) returns int language sql immutable as $$
  select 5 + (greatest(1, least(5, p_level)) - 1) * 2
$$;

create or replace function on_deed(p_world uuid, p_x int, p_y int) returns boolean
  language sql stable as $$
  select exists (select 1 from deed d where d.world_id = p_world
    and abs(p_x - d.x) <= d.radius and abs(p_y - d.y) <= d.radius)
$$;

create or replace function is_token(p_world uuid, p_x int, p_y int) returns boolean
  language sql stable as $$
  select exists (select 1 from deed d where d.world_id = p_world and d.x = p_x and d.y = p_y)
$$;

/* ------------------------------------------------------------------ *
 * The buildings themselves.
 * ------------------------------------------------------------------ */

create table if not exists building (
  world_id uuid not null references world on delete cascade,
  id int not null,
  name text not null check (length(name) between 1 and 32),
  /** Storeys planned; the ground floor counts as one. */
  levels int not null default 1 check (levels between 1 and 10),
  /** The storey wall and floor work applies to; null means the top one. */
  work_level int,
  planned_by uuid,
  primary key (world_id, id)
);

/**
 * The footprint. One building to a tile, which the key says outright — the
 * browser's `tileIndex` is this, and the check it does by hand before adding
 * a tile is one Postgres does for it.
 */
create table if not exists building_tile (
  world_id uuid not null,
  building int not null,
  x int not null,
  y int not null,
  primary key (world_id, x, y),
  foreign key (world_id, building) references building (world_id, id) on delete cascade
);
create index if not exists building_tile_by_building on building_tile (world_id, building);

/**
 * A wall, on a border rather than on a tile.
 *
 * `h` is the north border of (x, y) and `v` its west, so every border has
 * exactly one name and two tiles that share it. A fence belongs to no
 * building, which is what building 0 means — it is a real border with a real
 * wall on it, just with nothing around it.
 */
create table if not exists wall (
  world_id uuid not null references world on delete cascade,
  level int not null,
  dir text not null check (dir in ('h', 'v')),
  x int not null,
  y int not null,
  building int not null default 0,
  type text not null,
  material text not null,
  needed jsonb not null,
  total jsonb not null,
  planned_by uuid,
  primary key (world_id, level, dir, x, y)
);
create index if not exists wall_by_building on wall (world_id, building, level);

/** A tile's floor slot on a storey: a floor, a staircase, a ladder or a roof. */
create table if not exists floor_tile (
  world_id uuid not null references world on delete cascade,
  level int not null,
  x int not null,
  y int not null,
  building int not null,
  material text not null,
  kind text not null default 'floor' check (kind in ('floor', 'stairs', 'ladder', 'roof')),
  /** For stairs and ladders: the side you step on from below. */
  facing text,
  needed jsonb not null,
  total jsonb not null,
  planned_by uuid,
  primary key (world_id, level, x, y)
);
create index if not exists floor_by_building on floor_tile (world_id, building, level);

do $$
declare t text;
begin
  foreach t in array array['building', 'building_tile', 'wall', 'floor_tile'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_read', t);
    execute format('grant select on %I to authenticated', t);
    execute format('revoke insert, update, delete on %I from anon, authenticated', t);
  end loop;
end $$;

/* ------------------------------------------------------------------ *
 * Bills of materials.
 * ------------------------------------------------------------------ */

/** Nothing left owing. */
create or replace function bill_done(p_bill jsonb) returns boolean language sql immutable as $$
  select not exists (select 1 from jsonb_each_text(p_bill) e where e.value::numeric > 0)
$$;

/**
 * A material's own bill, scaled and rounded up, never to nothing.
 *
 * A window is three quarters of a solid wall and a fence less than a third of
 * one, but a third of one log is still a log: you cannot build with less than
 * a whole thing, so every line is at least one.
 */
create or replace function scaled_bill(p_material text, p_factor double precision) returns jsonb
  language sql stable as $$
  select coalesce(jsonb_object_agg(b.item, greatest(1, ceil(b.n * p_factor)::int)), '{}'::jsonb)
  from build_material_bill b where b.material = p_material
$$;

create or replace function wall_bill(p_material text, p_type text) returns jsonb
  language sql stable as $$
  select scaled_bill(p_material, coalesce((select factor from wall_type_def where id = p_type), 1))
$$;

/** Floors and roofs take half a wall, stairs three quarters; a ladder is two planks. */
create or replace function floor_bill(p_material text, p_kind text default 'floor') returns jsonb
  language sql stable as $$
  select case when p_kind = 'ladder' then '{"plank": 2}'::jsonb
    else scaled_bill(p_material, case when p_kind = 'stairs' then 0.75 else 0.5 end) end
$$;

/** What a floor slot is called, which is not always what it is keyed by. */
create or replace function floor_kind_name(p_kind text) returns text language sql immutable as $$
  select case p_kind when 'stairs' then 'staircase' else p_kind end
$$;

/** "2 logs", "1 mortar" — the plural rule of the thing rather than of English. */
create or replace function material_name(p_item text, p_n int) returns text
  language sql stable as $$
  select case
    when p_n = 1 or name ~ 's$' or name in ('mortar', 'thatch', 'adobe') then name
    else name || 's' end
  from (select lower((select coalesce(d.name, p_item) from item_def d where d.id = p_item)) as name) q
$$;

/**
 * What is still owed, in words, in the order the material lists it.
 *
 * The order matters twice over: it reads the way the bill was written, and it
 * is the order the units go in, so what the line says you need next is what
 * the next swing of the mallet will use.
 */
create or replace function bill_text(p_material text, p_bill jsonb) returns text
  language sql stable as $$
  select string_agg(part, ', ' order by ord) from (
    select coalesce(b.ord, 99) as ord, (e.value::int) || ' ' || material_name(e.key, e.value::int) as part
    from jsonb_each_text(p_bill) e
    left join build_material_bill b on b.material = p_material and b.item = e.key
    where e.value::int > 0) q
$$;

/** The next thing on a bill that the builder is actually carrying. */
create or replace function next_material(p_world uuid, p_uid uuid, p_material text, p_bill jsonb)
  returns text language sql stable as $$
  select e.key from jsonb_each_text(p_bill) e
  left join build_material_bill b on b.material = p_material and b.item = e.key
  where e.value::int > 0 and pack_count(p_world, p_uid, e.key) > 0
  order by coalesce(b.ord, 99), e.key limit 1
$$;

/* ------------------------------------------------------------------ *
 * Borders, footprints and storeys.
 * ------------------------------------------------------------------ */

/** A tile's side, in the one name a border has. */
create or replace function border_of(p_x int, p_y int, p_side text)
  returns table (x int, y int, dir text) language sql immutable as $$
  select case when p_side = 'e' then p_x + 1 else p_x end,
         case when p_side = 's' then p_y + 1 else p_y end,
         case when p_side in ('n', 's') then 'h' else 'v' end
$$;

create or replace function side_name(p_side text) returns text language sql immutable as $$
  select case p_side when 'n' then 'north' when 'e' then 'east'
                     when 's' then 'south' when 'w' then 'west' else p_side end
$$;

/** The tile on the far side of a border. */
create or replace function across(p_x int, p_y int, p_side text)
  returns table (x int, y int) language sql immutable as $$
  select p_x + case p_side when 'w' then -1 when 'e' then 1 else 0 end,
         p_y + case p_side when 'n' then -1 when 's' then 1 else 0 end
$$;

create or replace function building_at(p_world uuid, p_x int, p_y int) returns int
  language sql stable as $$
  select building from building_tile where world_id = p_world and x = p_x and y = p_y
$$;

/** An edge-adjacent building, for extending a plan onto the next tile. */
create or replace function neighbour_building(p_world uuid, p_x int, p_y int) returns int
  language sql stable as $$
  select building_at(p_world, p_x + dx, p_y + dy)
  from (values (1, 0), (-1, 0), (0, 1), (0, -1)) as d(dx, dy)
  where building_at(p_world, p_x + dx, p_y + dy) is not null
  limit 1
$$;

/** The storey being worked on, clamped to what exists. */
create or replace function work_level(p_world uuid, p_building int) returns int
  language sql stable as $$
  select least(coalesce(work_level, levels - 1), levels - 1) from building
  where world_id = p_world and id = p_building
$$;

/** Anything standing on a tile's borders or in its floor slot, at any storey. */
create or replace function tile_has_structures(p_world uuid, p_x int, p_y int) returns boolean
  language sql stable as $$
  select exists (select 1 from wall w where w.world_id = p_world
      and ((w.dir = 'h' and w.x = p_x and w.y in (p_y, p_y + 1))
        or (w.dir = 'v' and w.y = p_y and w.x in (p_x, p_x + 1))))
    or exists (select 1 from floor_tile f where f.world_id = p_world and f.x = p_x and f.y = p_y)
$$;

/** The borders of a footprint whose far side is somebody else's problem. */
create or replace function exterior_borders(p_world uuid, p_building int)
  returns table (x int, y int, dir text) language sql stable as $$
  select b.x, b.y, b.dir
  from building_tile t
  cross join lateral (values ('n'), ('s'), ('w'), ('e')) as s(side)
  cross join lateral across(t.x, t.y, s.side) a
  cross join lateral border_of(t.x, t.y, s.side) b
  where t.world_id = p_world and t.building = p_building
    and building_at(p_world, a.x, a.y) is distinct from p_building
$$;

/** Waist-high work: nothing rests on it, so no storey can be raised over it. */
create or replace function is_low_wall(p_type text) returns boolean language sql stable as $$
  select coalesce((select low from wall_type_def where id = p_type), false)
$$;

/**
 * Whether a storey carries anything waist-high — its own, or a fence that was
 * already standing on one of its borders when the footprint was laid out
 * around it. Either way there is nothing up there to build on.
 */
create or replace function has_low_wall(p_world uuid, p_building int, p_level int) returns boolean
  language sql stable as $$
  select exists (select 1 from wall w where w.world_id = p_world and w.building = p_building
      and w.level = p_level and is_low_wall(w.type))
    or (p_level = 0 and exists (
      select 1 from exterior_borders(p_world, p_building) b
      join wall w on w.world_id = p_world and w.level = 0
        and w.dir = b.dir and w.x = b.x and w.y = b.y
      where is_low_wall(w.type)))
$$;

create or replace function has_roof(p_world uuid, p_building int) returns boolean
  language sql stable as $$
  select exists (select 1 from floor_tile f where f.world_id = p_world
    and f.building = p_building and f.kind = 'roof')
$$;

/** Every exterior border walled and finished, and nothing half-built inside. */
create or replace function level_complete(p_world uuid, p_building int, p_level int) returns boolean
  language sql stable as $$
  select not exists (
      select 1 from exterior_borders(p_world, p_building) b
      left join wall w on w.world_id = p_world and w.level = p_level
        and w.dir = b.dir and w.x = b.x and w.y = b.y
      where w.type is null or not bill_done(w.needed))
    and not exists (
      select 1 from wall w where w.world_id = p_world and w.building = p_building
        and w.level = p_level and not bill_done(w.needed))
$$;

/**
 * Why a tile cannot take a building plan, or null when it can.
 *
 * Flat, packed, dry, clear, and yours. The order is the browser's, because
 * the first thing wrong is what a player is told and being told the same
 * thing in both places is the point of porting it rather than rewriting it.
 */
create or replace function plan_reason(p_world uuid, p_x int, p_y int) returns text
  language sql stable as $$
  select case
    when not on_deed(p_world, p_x, p_y) then 'You may only build on your own deed.'
    when is_token(p_world, p_x, p_y) then 'The settlement token stands here.'
    when building_at(p_world, p_x, p_y) is not null then 'That tile is already part of a building.'
    when land_tile(p_world, p_x, p_y) <> tile_id('Packed dirt')
      then 'Buildings need flat packed dirt. Pack the tile first.'
    when tile_slope(p_world, p_x, p_y) <> 0 then 'The tile must be perfectly flat. Flatten it first.'
    when has_water(p_world, p_x, p_y) then 'You cannot build in water.'
    when exists (select 1 from item i where i.world_id = p_world and i.holder = 'ground'
                   and i.gx = p_x and i.gy = p_y) then 'Clear away the items lying there first.'
    end
$$;

select private.lock_doors();
