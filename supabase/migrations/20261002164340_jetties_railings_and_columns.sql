-- Jetties and balconies, railings, and columns.
--
-- Asked for: a floor of an upper storey laid one tile out past the footprint,
-- on the storey below's wall -- a jettied storey with more room in it than the
-- footprint under it, or, shut off behind a door, a balcony; a railing for the
-- open edges of balconies and flat-roof terraces; and columns on the corners
-- of a storey, holding up what is over them the way walls do, so that four
-- columns and a roof are an open hall and a row of them a colonnade.
--
-- The browser's half is `src/game/frame.ts`, `src/game/frameActions.ts` and
-- the storey rules in `src/game/building.ts`; `supabase/test/frame.ts` holds
-- the two to each other, refusal by refusal and sentence by sentence.
--
-- ## Jetties
--
-- A jetty is a `floor_tile` like any other, on a tile that is no building's
-- footprint (`frame_jetty_of`). A job on such a tile names the building it is
-- for (`buildingId` in the target) and acts on that building's storey being
-- worked (`frame_building`, `frame_wall_level`): plan it, build it, wall it,
-- paint it, tear it up. Every storey job may name its storey (`level` in the
-- target, `frame_job_level`) -- a wall planned, built, painted or taken down,
-- a floor or a flight of stairs, a column, a jetty -- and then it is done on
-- that storey, so a storey below the top is worked from the island as from
-- the browser; a job that names none is done on the top storey, as before.
-- Stairs asked for on the ground floor of a building with a storey over it
-- send you a storey up (a marked line of `build_refusal`). And so a finished
-- full-height wall under a wall of its own building's storey over it on the
-- same border, one with any of its materials in (`frame_begun`), stays up
-- until that wall comes down, or until a finished column at each end carries
-- the side (`frame_storey_on_wall`). What may be
-- planned there is `frame_refusal`: never on the ground floor, never under
-- another building's jetty, on your own deed, over open ground, resting on a
-- finished full-height wall of the storey below on a side the tile shares
-- with the footprint, or on a finished floor of a jetty of the storey below
-- inside that storey (`frame_on_jetty_below`), clear of the ground by a
-- storey, and no heavier than the walls under it carry. The last wall a jetty
-- rests on stays up until the jetty is torn up or a finished column at each
-- end of it carries that side (`frame_bears_jetty`), its
-- floor comes up only with nothing on it or over it (`frame_floor_holds`),
-- and the ground under it is neither dug nor raised, as the ground under a
-- footprint is not (`corner_under_building`), nor planted (`ground_refusal`,
-- `frame_jetty_over`), nor bridged (`bridge_reason`).
--
-- A jetty open to its storey is part of it (`frame_storey`): its outer sides
-- want a wall, a railing or columns before the storey is closed in
-- (`level_gap`). A roof over it rests on walls or columns, never a railing:
-- every side of it out of the storey wants a finished full-height wall, or
-- at each end a finished column or the end of a finished full-height wall
-- (`frame_corner_carries`, `frame_jetty_roof_rests`, which names the first
-- corner short of one); the wall a roof over a jetty rests on stays up until
-- columns take the roof (`frame_roof_on_wall`), and so does a wall whose end
-- is all that carries an end of such a side, until a column stands on that
-- corner (`frame_roof_end_on`), and a column that is all that carries one,
-- until that side is walled (`frame_roof_side_on`); and no wall or door goes
-- between a storey and its roofed jetty (`frame_roof_cut_off`). One shut off
-- behind a door or a wall is a balcony: outside the storey, roofless, and
-- nothing it carries is asked about (`has_low_wall`).
--
-- ## Railings
--
-- A wall type (`wall_type_def`, from the definitions): low, see-through, and
-- only on a storey above the ground, on the deck of a tile on piers, or round
-- a flat roof, where the wall work is on the roof's own level (`terrace` in
-- the target). An edge with nothing
-- on it stops a body as any upper floor's edge does: up a storey the island
-- now lets a body stand only on what is built there (`frame_footing`, one
-- indexed read, and only when a walk crosses into another tile).
--
-- ## Columns
--
-- `building_column`, a row a corner a storey, `column_share()` of a solid
-- wall's bill. A column bears its material's heft (`bearing`), counts in what
-- a building may rise to (`storey_cap`) and in the trade a storey is raised
-- in (`storey_material`), and a side of a storey with a finished column at
-- both ends of it is closed (`frame_carried`). A column comes down unless it
-- carries a side on the edge of its storey with no full-height wall on it,
-- under a floor or a roof of its building, or alone carries an end of an open
-- side of a roofed jetty (`frame_column_carries`, which names that side). A roof over a room closed by walls or columns keeps what lies
-- under it as a room does (`sheltered`, `decay_multiplier`); a bed wants the
-- walls (`indoors`, unchanged).
--
-- ## Where it meets the rest of a building
--
-- On piers a building's storeys count from its deck, a jetty's included
-- (`frame_jetty_refusal`); a column stands on a finished deck
-- (`frame_foots_column`), no heavier than the lightest deck under the
-- building (`deck_carries`), a deck carries the heaviest column as it does the
-- heaviest wall (`deck_bears`, a marked line), a deck with a column on it and
-- on nothing else stays down (`frame_floor_holds`), and a deck's edge takes a
-- railing. Glass is a pitched roof's out over a jetty as over the footprint,
-- and never a column; the glass refusals are asked before the frame ones, as
-- the browser asks them. No jetty over the span of a bridge or an aqueduct --
-- a bridge's ends are its banks -- and no aqueduct set out under a jetty
-- (`aqueduct_plan`, a marked line). A building over a cellar comes off the
-- plan once the cellar is filled in, whatever stands on its corners. A column
-- on the ground takes the corner spot of every tile round it: no piece,
-- smelter or kiln is set down or turned into one and no grave is dug in one
-- (`frame_column_corner`, asked by `block_taken`, a marked line), and no
-- column is planned over a piece standing in one (`frame_piece_in_corner`).
--
-- The shared functions changed here change in a few marked lines each, and
-- every one of those lines calls a function of this migration:
-- `build_action`, `build_refusal`, `perform_building`, `rpc_ground`,
-- `rpc_move`, `examine_tile_text` (what Examine says, `frame_says`),
-- `corner_under_building` (no digging or raising the ground under a jetty),
-- `ground_refusal` (no planting under one), `bridge_reason` (no bridge
-- across one), `aqueduct_plan` (no aqueduct under one), `deck_bears` (a deck
-- carries the columns on it) and `block_taken` (a column's corner spots). `level_gap`, `has_low_wall`, `bearing`, `storey_cap`,
-- `storey_capper`, `storey_material` and `decay_multiplier` are the rules
-- themselves, restated whole.

set local lock_timeout = '3s';

create table if not exists building_column (
  world_id uuid not null references world(id) on delete cascade,
  level int not null,
  x int not null,
  y int not null,
  building int not null,
  material text not null,
  needed jsonb not null,
  total jsonb not null,
  planned_by uuid,
  dye text,
  primary key (world_id, level, x, y)
);
create index if not exists building_column_by_building on building_column (world_id, building, level);
-- Read by the doors and the ground read, which are the island's own.
alter table building_column enable row level security;
-- A tile's floors by where they stand, whatever the storey: what a jetty is asked by.
create index if not exists floor_tile_at on floor_tile (world_id, x, y);

/* ---- Jetties ------------------------------------------------------------------------------------- */

/** The building whose floors a tile out past every footprint carries: a jetty's, a balcony's or the roof over one (`Buildings.jettyAt`). */
create or replace function frame_jetty_of(p_world uuid, p_x int, p_y int) returns int
  language sql stable as $fn$
  select f.building from floor_tile f
   where f.world_id = p_world and f.x = p_x and f.y = p_y and f.level > 0
     and building_at(p_world, p_x, p_y) is null
   order by f.level limit 1
$fn$;

/** The building `p_id`, when a tile could be a jetty of it: out past every footprint and sharing an edge with this one's (`Buildings.jettyHost`). */
create or replace function frame_host(p_world uuid, p_x int, p_y int, p_id int) returns int
  language sql stable as $fn$
  select b.id from building b
   where b.world_id = p_world and b.id = p_id
     and building_at(p_world, p_x, p_y) is null
     and exists (select 1 from building_tile t
                  where t.world_id = p_world and t.building = b.id
                    and (t.x, t.y) in ((p_x, p_y - 1), (p_x + 1, p_y), (p_x, p_y + 1), (p_x - 1, p_y)))
$fn$;

/** The jobs done on a storey of a building, which on a tile out past it are done for the building they name. */
create or replace function frame_storey_action(p_action text) returns boolean language sql immutable as $fn$
  select p_action in ('plan_wall', 'build_wall', 'remove_wall', 'paint_wall', 'strip_wall_paint', 'repoint_wall',
                      'plan_floor', 'build_floor', 'remove_floor', 'paint_floor',
                      'plan_column', 'build_column', 'remove_column')
$fn$;

/**
 * The building a job acts on: the footprint's, as ever, or -- for a storey
 * job on a tile out past every footprint that names one -- the building whose
 * jetty the tile is (`storeyOf`).
 */
create or replace function frame_building(p_world uuid, p_action text, p_target jsonb, p_b building) returns building
  language plpgsql stable as $fn$
declare v building;
begin
  if p_b.id is not null or not frame_storey_action(p_action) or not (p_target ? 'buildingId') then return p_b; end if;
  select * into v from building b
   where b.world_id = p_world
     and b.id = frame_host(p_world, (p_target->>'x')::int, (p_target->>'y')::int, (p_target->>'buildingId')::int);
  return v;
end $fn$;

/**
 * The storey wall work on a tile is on (`wallLevelOf`): the roof's own level
 * round a flat roof (`terrace`), the storey being worked in a building or its
 * jetty, and the ground anywhere else.
 */
/**
 * The storey a storey job is for (`jobLevel`): the one the job names (`level`
 * in the target, which a menu fills in from the storey it was showing), when
 * the building has it, or else the storey being worked.
 */
create or replace function frame_job_level(p_b building, p_target jsonb) returns int
  language sql immutable as $fn$
  select case when jsonb_typeof(p_target->'level') = 'number'
               and (p_target->>'level')::numeric = trunc((p_target->>'level')::numeric)
               and (p_target->>'level')::numeric between 0 and p_b.levels - 1
              then (p_target->>'level')::int
              else least(coalesce(p_b.work_level, p_b.levels - 1), p_b.levels - 1) end
$fn$;

/** The level a floor job is on: the job's storey (`frame_job_level`), except a roof, over the top storey, and a
 *  flight or a ladder down to a cellar, in the ground floor -- those two are `floor_level`'s, as they were (`slotLevel`). */
create or replace function frame_floor_level(p_world uuid, p_building int, p_kind text, p_target jsonb) returns int
  language sql stable as $fn$
  select case when p_kind <> 'roof' and not coalesce((p_target->>'down')::boolean, false) then frame_job_level(b, p_target)
              else floor_level(p_world, p_building, p_kind, p_target) end
    from building b where b.world_id = p_world and b.id = p_building
$fn$;

create or replace function frame_wall_level(p_world uuid, p_x int, p_y int, p_target jsonb) returns int
  language sql stable as $fn$
  select coalesce((
    select case when coalesce((p_target->>'terrace')::boolean, false) then b.levels
                else frame_job_level(b, p_target) end
      from building b
     where b.world_id = p_world
       and b.id = coalesce(building_at(p_world, p_x, p_y),
                           case when p_target ? 'buildingId'
                                then frame_host(p_world, p_x, p_y, (p_target->>'buildingId')::int) end)), 0)
$fn$;

/** The wall on a side of a tile, on the storey the job is on (`wall_at`, with the job's say in which). */
create or replace function frame_wall_at(p_world uuid, p_x int, p_y int, p_side text, p_target jsonb) returns wall
  language sql stable as $fn$
  select w.* from border_of(p_x, p_y, p_side) bd
  join wall w on w.world_id = p_world and w.level = frame_wall_level(p_world, p_x, p_y, p_target)
    and w.dir = bd.dir and w.x = bd.x and w.y = bd.y
$fn$;

/**
 * A storey as far as what stands over it is concerned (`Buildings.storeyArea`):
 * the footprint, and every jetty of that storey reached from it without
 * crossing a finished full-height wall. A jetty behind a door is a balcony.
 */
create or replace function frame_storey_shut(p_world uuid, p_building int, p_level int,
                                             p_dir text, p_bx int, p_by int)
returns table (x int, y int) language sql stable as $fn$
  with recursive area as (
    select t.x, t.y from building_tile t where t.world_id = p_world and t.building = p_building
    union
    select n.x, n.y from area a
      cross join lateral (values ('n'), ('e'), ('s'), ('w')) s(side)
      cross join lateral across(a.x, a.y, s.side) n
      cross join lateral border_of(a.x, a.y, s.side) sb
     where p_level > 0
       and building_at(p_world, n.x, n.y) is null
       -- `p_dir`: as it would be with a wall on that border, which is what a wall planned there is asked.
       and (p_dir is null or not (sb.dir = p_dir and sb.x = p_bx and sb.y = p_by))
       and exists (select 1 from floor_tile f
                    where f.world_id = p_world and f.level = p_level and f.x = n.x and f.y = n.y
                      and f.building = p_building)
       and not exists (select 1 from wall w
                        where w.world_id = p_world and w.level = p_level
                          and w.dir = sb.dir and w.x = sb.x and w.y = sb.y
                          and bill_done(w.needed) and not is_low_wall(w.type))
  )
  select area.x, area.y from area
$fn$;

create or replace function frame_storey(p_world uuid, p_building int, p_level int)
returns table (x int, y int) language sql stable as $fn$
  select s.x, s.y from frame_storey_shut(p_world, p_building, p_level, null, null, null) s
$fn$;

/**
 * Why a floor, or the roof over one, may not be planned on a tile out past a
 * building's footprint (`jettyReason`), or null. Asked after the material, the
 * mallet and the building.
 */
create or replace function frame_jetty_refusal(p_world uuid, p_uid uuid, p_b building, p_x int, p_y int,
                                               p_kind text, p_level int, p_mat build_material_def, p_roof_shape text)
returns text language plpgsql stable as $fn$
declare over building; v_side text; v_fx int; v_fy int; v_below double precision; v_high int; bears int; v_kind text;
begin
  if p_kind in ('stairs', 'ladder') then return 'Stairs and ladders go inside the footprint, not out on a jetty.'; end if;
  if p_kind = 'roof' then
    -- Glass on a pitched roof and nowhere else, out over a jetty as over the footprint (`glass_refusal`).
    if p_mat.id = glass_material()
       and coalesce(p_b.roof, (select r.id from roof_shape_def r where r.id = p_roof_shape), 'hip') = 'flat' then
      return glass_pitched_said();
    end if;
    if not exists (select 1 from floor_tile f where f.world_id = p_world and f.level = p_b.levels - 1
                     and f.x = p_x and f.y = p_y and f.building = p_b.id and bill_done(f.needed)) then
      return 'A roof goes out past the footprint only over a finished jetty of storey ' || p_b.levels || '.';
    end if;
    if not exists (select 1 from frame_storey(p_world, p_b.id, p_b.levels - 1) a where a.x = p_x and a.y = p_y) then
      return 'That jetty is shut off from storey ' || p_b.levels
          || ' by a wall or a door, which makes it a balcony, and a balcony takes no roof.';
    end if;
    -- And on what: walls or columns round it, never a railing.
    return frame_jetty_roof_rests(p_world, p_b, p_x, p_y);
  end if;
  if p_level < 1 then
    return case when p_b.levels > 1 then 'Work on storey 2 or above to floor a jetty here.'
                else 'A jetty is floored out from a storey above the ground: plan another storey and work on it.' end;
  end if;
  select * into over from building where world_id = p_world and id = frame_jetty_of(p_world, p_x, p_y);
  if over.id is not null and over.id <> p_b.id then return 'That tile is under ' || over.name || '''s jetty.'; end if;
  if not on_my_deed(p_world, p_uid, p_x, p_y) then return 'You may only build on your own deed.'; end if;
  -- No span of a bridge or an aqueduct goes under it; a bridge's ends are its banks (`jettyReason`).
  select b.kind into v_kind from bridge_span s join bridge b on b.world_id = s.world_id and b.id = s.bridge
   where s.world_id = p_world and s.x = p_x and s.y = p_y limit 1;
  if v_kind is not null then
    return case when v_kind = 'aqueduct' then 'An aqueduct is carried over that tile.' else 'A bridge crosses that tile.' end;
  end if;
  if not passable(p_world, p_x, p_y) or land_tile(p_world, p_x, p_y) = tile_id('Bush') then
    return 'A jetty is built over open ground: clear the tree or the bush from under it first.';
  end if;
  -- What it rests on: the first finished full-height wall of the storey below, going round from the north.
  v_side := frame_jetty_bearer(p_world, p_b.id, p_level, p_x, p_y);
  if v_side is not null then
    select a.x, a.y into v_fx, v_fy from across(p_x, p_y, v_side) a;
    -- Clear of the ground by a storey: never lower over it than the storey under it stands.
    -- On piers, from the building's deck (`jettyBase`).
    v_below := coalesce(p_b.deck, land_height(p_world, v_fx, v_fy)) + (p_level - 1) * wall_height();
    v_high := greatest(land_height(p_world, p_x, p_y), land_height(p_world, p_x + 1, p_y),
                       land_height(p_world, p_x + 1, p_y + 1), land_height(p_world, p_x, p_y + 1));
    if v_high > v_below then
      return 'The ground under it rises above the floor of storey ' || p_level || ': dig it down, or floor the jetty out a storey higher.';
    end if;
  elsif not frame_on_jetty_below(p_world, p_b.id, p_level, p_x, p_y) then
    -- Or over the jetty of the storey below, inside that storey, on its walls.
    return 'A jetty rests on a finished full-height wall of storey ' || p_level || ': build one on a side this tile shares with '
        || p_b.name || ' first.';
  end if;
  bears := bearing(p_world, p_b.id, p_level);
  if p_mat.heft > coalesce(bears, 9) then
    return p_mat.name || ' is too heavy to lay out past the walls. The walls under it carry ' || heft_word(bears) || ', no more.';
  end if;
  return null;
end $fn$;

/* ---- Columns ------------------------------------------------------------------------------------- */

create or replace function frame_action(p_action text) returns boolean language sql immutable as $fn$
  select p_action in ('plan_column', 'build_column', 'remove_column')
$fn$;

/** Whether a finished column stands at both ends of a border on a storey (`Buildings.carried`). */
create or replace function frame_carried(p_world uuid, p_level int, p_dir text, p_x int, p_y int)
returns boolean language sql stable as $fn$
  select coalesce((select bill_done(c.needed) from building_column c
                    where c.world_id = p_world and c.level = p_level and c.x = p_x and c.y = p_y), false)
     and coalesce((select bill_done(c.needed) from building_column c
                    where c.world_id = p_world and c.level = p_level
                      and c.x = p_x + case when p_dir = 'h' then 1 else 0 end
                      and c.y = p_y + case when p_dir = 'v' then 1 else 0 end), false)
$fn$;

/** Whether a storey has a finished floor at a corner for a column to stand on (`columnFooting`): the ground floor stands on the ground. */
/**
 * Whether a tile of a storey is something for a column to stand on
 * (`footsColumn`): on the ground floor a tile of the footprint -- on piers,
 * once its deck is built -- and higher up a finished floor of the building.
 */
create or replace function frame_foots_column(p_world uuid, p_building int, p_level int, p_x int, p_y int)
returns boolean language sql stable as $fn$
  select case when p_level <= 0 then
    exists (select 1 from building_tile t where t.world_id = p_world and t.building = p_building and t.x = p_x and t.y = p_y
              and (not t.pier or exists (select 1 from floor_tile f where f.world_id = p_world and f.level = 0
                                            and f.x = p_x and f.y = p_y and bill_done(f.needed))))
  else
    exists (select 1 from floor_tile f where f.world_id = p_world and f.level = p_level and f.building = p_building
              and f.x = p_x and f.y = p_y and bill_done(f.needed) and f.kind <> 'roof')
  end
$fn$;

create or replace function frame_column_footing(p_world uuid, p_building int, p_level int, p_cx int, p_cy int)
returns boolean language sql stable as $fn$
  select exists (select 1 from (values (p_cx - 1, p_cy - 1), (p_cx, p_cy - 1), (p_cx - 1, p_cy), (p_cx, p_cy)) t(x, y)
                  where frame_foots_column(p_world, p_building, p_level, t.x, t.y))
$fn$;

/**
 * Whether a column of the ground floor stands in a corner spot of a block of
 * spots on a tile (`Game.columnInBlock`): a column takes the corner spot of
 * every tile round its corner. Asked by `block_taken`, so of every piece,
 * smelter and kiln set down or turned and every grave dug, as the browser
 * asks it of the same.
 */
create or replace function frame_column_corner(p_world uuid, p_x int, p_y int, p_sx int, p_sy int, p_w int, p_h int)
returns boolean language sql stable as $fn$
  select exists (select 1 from building_column c
                  where c.world_id = p_world and c.level = 0
                    and c.x in (p_x, p_x + 1) and c.y in (p_y, p_y + 1)
                    and case when c.x = p_x then p_sx = 0 else p_sx + p_w = subtiles() end
                    and case when c.y = p_y then p_sy = 0 else p_sy + p_h = subtiles() end)
$fn$;

/** Whether a piece of furniture stands in the corner spot of any of the four tiles round a corner, up top (`pieceInCorner`). */
create or replace function frame_piece_in_corner(p_world uuid, p_cx int, p_cy int)
returns boolean language sql stable as $fn$
  select exists (select 1 from (values (p_cx - 1, p_cy - 1, subtiles() - 1, subtiles() - 1), (p_cx, p_cy - 1, 0, subtiles() - 1),
                                       (p_cx - 1, p_cy, subtiles() - 1, 0), (p_cx, p_cy, 0, 0)) t(x, y, sx, sy)
                  join placed o on o.world_id = p_world and o.kind = 'furniture' and o.level >= 0 and o.x = t.x and o.y = t.y
                   and o.sx <= t.sx and o.sx + (placed_size(o.kind, o.sub, o.facing))[1] > t.sx
                   and o.sy <= t.sy and o.sy + (placed_size(o.kind, o.sub, o.facing))[2] > t.sy)
$fn$;

/** Every material standing in a building: its walls and its columns. */
create or replace function frame_materials(p_world uuid, p_building int) returns table (material text)
  language sql stable as $fn$
  select w.material from wall w where w.world_id = p_world and w.building = p_building
  union all
  select c.material from building_column c where c.world_id = p_world and c.building = p_building
$fn$;

/** The columns within range of a body, shaped as the browser's `Column`, for the ground read. */
create or replace function frame_columns_json(p_world uuid, p_x double precision, p_y double precision, p_range double precision)
returns jsonb language sql stable as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
      'building', c.building, 'level', c.level, 'x', c.x, 'y', c.y, 'material', c.material,
      'needed', c.needed, 'total', c.total) order by c.level, c.x, c.y), '[]'::jsonb)
    from building_column c
   where c.world_id = p_world
     and greatest(abs(c.x - p_x), abs(c.y - p_y)) <= p_range
$fn$;

/**
 * The storey of a jetty that rests on a wall and on nothing else (`jettyOnWall`):
 * what taking the wall down would leave in the air, or null -- null too with a
 * finished column at each end of the wall to carry that side instead.
 */
create or replace function frame_bears_jetty(p_world uuid, p_wall wall) returns int
  language plpgsql stable as $fn$
declare v_j record; v_others int;
        ox int := case when p_wall.dir = 'h' then p_wall.x else p_wall.x - 1 end;
        oy int := case when p_wall.dir = 'h' then p_wall.y - 1 else p_wall.y end;
begin
  if p_wall.world_id is null or p_wall.building = 0 or is_low_wall(p_wall.type) or not bill_done(p_wall.needed) then return null; end if;
  if not exists (select 1 from building b where b.world_id = p_world and b.id = p_wall.building)
     or frame_carried(p_world, p_wall.level, p_wall.dir, p_wall.x, p_wall.y) then return null; end if;
  -- The jetty on either side of it, the footprint on the other.
  for v_j in
    select v.jx, v.jy, v.fx, v.fy
      from (values (1, p_wall.x, p_wall.y, ox, oy), (2, ox, oy, p_wall.x, p_wall.y)) as v(ord, jx, jy, fx, fy)
     order by v.ord
  loop
    if building_at(p_world, v_j.fx, v_j.fy) is distinct from p_wall.building
       or building_at(p_world, v_j.jx, v_j.jy) is not null then continue; end if;
    if not exists (select 1 from floor_tile ft where ft.world_id = p_world and ft.level = p_wall.level + 1
                     and ft.x = v_j.jx and ft.y = v_j.jy and ft.building = p_wall.building) then continue; end if;
    -- Its other walls to rest on, this one left out.
    select count(*) into v_others
      from (values ('n'), ('e'), ('s'), ('w')) s(side)
      cross join lateral across(v_j.jx, v_j.jy, s.side) a
      cross join lateral border_of(v_j.jx, v_j.jy, s.side) bd
      join wall w on w.world_id = p_world and w.level = p_wall.level and w.dir = bd.dir and w.x = bd.x and w.y = bd.y
     where building_at(p_world, a.x, a.y) = p_wall.building
       and not (bd.dir = p_wall.dir and bd.x = p_wall.x and bd.y = p_wall.y)
       and w.building = p_wall.building and bill_done(w.needed) and not is_low_wall(w.type);
    if v_others = 0 then return p_wall.level + 1; end if;
  end loop;
  return null;
end $fn$;

/**
 * What a floor of a storey above the ground still holds up (`floorHolds`): a
 * column of its building standing on it and on no other floor round its
 * corner, or, out on a jetty, the building's roof over it. What to take down
 * first, or null.
 */
create or replace function frame_floor_holds(p_world uuid, p_b building, p_level int, p_x int, p_y int) returns text
  language plpgsql stable as $fn$
declare c record;
begin
  -- A ground floor on the ground holds nothing up: the ground does. A deck on piers does.
  if p_level < 0 or (p_level = 0 and not on_piers(p_world, p_x, p_y)) then return null; end if;
  for c in
    select bc.x, bc.y from building_column bc
     where bc.world_id = p_world and bc.level = p_level and bc.building = p_b.id
       and (bc.x, bc.y) in ((p_x, p_y), (p_x + 1, p_y), (p_x, p_y + 1), (p_x + 1, p_y + 1))
     order by bc.y, bc.x
  loop
    if not exists (select 1 from (values (c.x - 1, c.y - 1), (c.x, c.y - 1), (c.x - 1, c.y), (c.x, c.y)) t(x, y)
                    where (t.x, t.y) <> (p_x, p_y) and frame_foots_column(p_world, p_b.id, p_level, t.x, t.y)) then
      return 'Take down the column on its ' || side_name(case when c.y = p_y then 'n' else 's' end) || '-'
        || side_name(case when c.x = p_x then 'w' else 'e' end) || ' corner first.';
    end if;
  end loop;
  if p_level = 0 then return null; end if;
  if building_at(p_world, p_x, p_y) is null then
    if p_level = p_b.levels - 1
       and exists (select 1 from floor_tile ft where ft.world_id = p_world and ft.level = p_b.levels
                     and ft.x = p_x and ft.y = p_y and ft.building = p_b.id) then
      return 'Take the roof over it off first.';
    end if;
    -- A floor of the storey over it laid on this one, with no wall of its own to rest on.
    if p_level + 1 <= p_b.levels - 1
       and exists (select 1 from floor_tile ft where ft.world_id = p_world and ft.level = p_level + 1
                     and ft.x = p_x and ft.y = p_y and ft.building = p_b.id)
       and frame_jetty_bearer(p_world, p_b.id, p_level + 1, p_x, p_y) is null then
      return 'The floor of storey ' || (p_level + 2) || ' rests on it: take that up first.';
    end if;
  end if;
  return null;
end $fn$;

/** What Examine says of a tile's jetty, its columns and the roof on columns over it (`frameSays`), word for word. */
create or replace function frame_says(p_world uuid, p_x int, p_y int) returns text
  language plpgsql stable as $fn$
declare v_out text := ''; j building; v_f floor_tile; v_cols text;
begin
  -- The jetty or balcony over it, if any, on its lowest storey.
  select * into j from building where world_id = p_world and id = frame_jetty_of(p_world, p_x, p_y);
  if j.id is not null then
    select * into v_f from floor_tile ft
     where ft.world_id = p_world and ft.x = p_x and ft.y = p_y and ft.level between 1 and j.levels and ft.building = j.id
     order by ft.level limit 1;
    if v_f.world_id is not null then
      if not bill_done(v_f.needed) then
        v_out := v_out || ' A jetty of ' || j.name || '''s storey ' || (v_f.level + 1) || ' is planned over it.';
      elsif exists (select 1 from frame_storey(p_world, j.id, v_f.level) s where s.x = p_x and s.y = p_y) then
        v_out := v_out || ' Over it is a jetty of ' || j.name || '''s storey ' || (v_f.level + 1)
          || ', part of that storey: its open sides want a wall, a railing or columns to close the storey in, and a roof over it rests on walls or columns, never on a railing.';
      else
        v_out := v_out || ' Over it is a balcony of ' || j.name || '''s storey ' || (v_f.level + 1)
          || ', shut off from the storey by a wall or a door: it takes a railing, and no roof.';
      end if;
    end if;
  end if;
  -- The columns on its corners, storey by storey.
  select string_agg(lower(m.name) || ' on the ' || side_name(case when c.y = p_y then 'n' else 's' end) || '-'
           || side_name(case when c.x = p_x then 'w' else 'e' end) || ' corner'
           || case when c.level > 0 then ' of storey ' || (c.level + 1) else '' end
           || case when bill_done(c.needed) then '' else ' (needs ' || bill_text(c.material, c.needed) || ')' end,
         '; ' order by c.level, c.y, c.x)
    into v_cols
    from building_column c join build_material_def m on m.id = c.material
   where c.world_id = p_world and c.x in (p_x, p_x + 1) and c.y in (p_y, p_y + 1);
  if v_cols is not null then v_out := v_out || ' Columns: ' || v_cols || '.'; end if;
  -- A roof on columns: shelter for what lies there, and not a room.
  if sheltered(p_world, 0, p_x, p_y) and not indoors(p_world, 0, p_x, p_y) then
    v_out := v_out || ' Under a roof on columns: what is left here decays at ' || round(indoors_decay() * 100)::int
      || '% of the rate in the open, but a bed here is in the open: the ×' || indoors_rest()
      || ' rest of a bed indoors wants walls all round.';
  end if;
  return v_out;
end $fn$;

/** Whose jetty is over a tile, in words, when one is (`jettyOver`): nothing else is built or grown there. */
create or replace function frame_jetty_over(p_world uuid, p_x int, p_y int) returns text
  language sql stable as $fn$
  select 'That tile is under ' || b.name || '''s jetty.' from building b
   where b.world_id = p_world and b.id = frame_jetty_of(p_world, p_x, p_y)
$fn$;

/* ---- What carries what (round 2) ------------------------------------------------------------------ */

/** Whether a border on a storey is held up: a finished full-height wall on it, or a finished column at each end (`holds`). */
create or replace function frame_holds(p_world uuid, p_level int, p_dir text, p_x int, p_y int) returns boolean
  language sql stable as $fn$
  select exists (select 1 from wall w where w.world_id = p_world and w.level = p_level and w.dir = p_dir
                   and w.x = p_x and w.y = p_y and bill_done(w.needed) and not is_low_wall(w.type))
      or frame_carried(p_world, p_level, p_dir, p_x, p_y)
$fn$;

/** The side of a tile out past the footprint whose finished full-height wall of the storey below a jetty there rests on, the first going round from the north (`jettyBearer`). */
create or replace function frame_jetty_bearer(p_world uuid, p_building int, p_level int, p_x int, p_y int) returns text
  language sql stable as $fn$
  select s.side
    from (values (1, 'n'), (2, 'e'), (3, 's'), (4, 'w')) s(ord, side)
    cross join lateral across(p_x, p_y, s.side) a
    cross join lateral border_of(p_x, p_y, s.side) bd
    join wall w on w.world_id = p_world and w.level = p_level - 1
      and w.dir = bd.dir and w.x = bd.x and w.y = bd.y
   where p_level >= 1 and building_at(p_world, a.x, a.y) = p_building and w.building = p_building
     and bill_done(w.needed) and not is_low_wall(w.type)
   order by s.ord limit 1
$fn$;

/** Whether a floor of a storey out past the footprint lies on the finished jetty of the storey under it, inside that storey (`onJettyBelow`). */
create or replace function frame_on_jetty_below(p_world uuid, p_building int, p_level int, p_x int, p_y int) returns boolean
  language sql stable as $fn$
  select p_level >= 2
     and exists (select 1 from floor_tile f where f.world_id = p_world and f.level = p_level - 1 and f.x = p_x and f.y = p_y
                   and f.building = p_building and bill_done(f.needed) and f.kind = 'floor')
     and exists (select 1 from frame_storey(p_world, p_building, p_level - 1) a where a.x = p_x and a.y = p_y)
$fn$;

/**
 * Whether a corner of a storey carries the end of a side resting on it
 * (`cornerCarries`): a finished column on it, or a finished full-height wall
 * of the storey ending there on another border than the side's own.
 */
create or replace function frame_corner_carries(p_world uuid, p_level int, p_cx int, p_cy int, p_dir text, p_x int, p_y int)
returns boolean language sql stable as $fn$
  select exists (select 1 from building_column c where c.world_id = p_world and c.level = p_level
                   and c.x = p_cx and c.y = p_cy and bill_done(c.needed))
      or exists (select 1 from wall w
                  where w.world_id = p_world and w.level = p_level and bill_done(w.needed) and not is_low_wall(w.type)
                    and ((w.dir = 'h' and w.y = p_cy and w.x in (p_cx - 1, p_cx))
                      or (w.dir = 'v' and w.x = p_cx and w.y in (p_cy - 1, p_cy)))
                    and not (w.dir = p_dir and w.x = p_x and w.y = p_y))
$fn$;

/**
 * Why the roof may not go out over a jetty on what stands round it, or null
 * (`jettyRoofRests`): every side of it not into its storey wants a finished
 * full-height wall, or at each end a finished column or the end of a finished
 * full-height wall (`frame_corner_carries`). The first side short of one, from
 * the north, names the first corner of it that carries nothing.
 */
create or replace function frame_jetty_roof_rests(p_world uuid, p_b building, p_x int, p_y int) returns text
  language plpgsql stable as $fn$
declare top int := p_b.levels - 1; s record; e record; v_area text[];
begin
  select coalesce(array_agg(a.x || ',' || a.y), '{}') into v_area from frame_storey(p_world, p_b.id, top) a;
  for s in
    select v.ord, v.nx, v.ny, bd.dir, bd.x as xx, bd.y as yy
      from (values (1, 'n', p_x, p_y - 1), (2, 'e', p_x + 1, p_y), (3, 's', p_x, p_y + 1), (4, 'w', p_x - 1, p_y)) v(ord, side, nx, ny)
      cross join lateral border_of(p_x, p_y, v.side) bd
     order by v.ord
  loop
    if (s.nx || ',' || s.ny) = any (v_area) then continue; end if;
    if frame_holds(p_world, top, s.dir, s.xx, s.yy) then continue; end if;
    for e in
      select v.cx, v.cy from (values (1, s.xx, s.yy),
                                     (2, s.xx + case when s.dir = 'h' then 1 else 0 end, s.yy + case when s.dir = 'v' then 1 else 0 end)) v(ord, cx, cy)
       order by v.ord
    loop
      if frame_corner_carries(p_world, top, e.cx, e.cy, s.dir, s.xx, s.yy) then continue; end if;
      return 'A roof over the jetty rests on walls or columns: raise a column on its '
          || side_name(case when e.cy = p_y then 'n' else 's' end) || '-' || side_name(case when e.cx = p_x then 'w' else 'e' end)
          || ' corner first. A railing carries nothing.';
    end loop;
  end loop;
  return null;
end $fn$;

/** Whether a wall on a border of the top storey would shut a jetty with the roof over it out of the storey (`roofCutOff`). */
create or replace function frame_roof_cut_off(p_world uuid, p_b building, p_dir text, p_x int, p_y int) returns boolean
  language sql stable as $fn$
  select exists (
    select 1 from frame_storey(p_world, p_b.id, p_b.levels - 1) a
     where building_at(p_world, a.x, a.y) is null
       and exists (select 1 from floor_tile f where f.world_id = p_world and f.level = p_b.levels
                     and f.x = a.x and f.y = a.y and f.building = p_b.id)
       and not exists (select 1 from frame_storey_shut(p_world, p_b.id, p_b.levels - 1, p_dir, p_x, p_y) z
                        where z.x = a.x and z.y = a.y))
$fn$;

/**
 * The roof over a jetty that rests on a wall and nothing else there
 * (`jettyRoofOnWall`): a full-height wall of the top storey on a side of a
 * roofed jetty out of the storey, with no finished column at each end of it;
 * or the end of a full-height wall that is all that carries an end of such a
 * side (`frame_roof_end_on`). What to do first, or null.
 */
create or replace function frame_roof_on_wall(p_world uuid, p_wall wall) returns text
  language plpgsql stable as $fn$
declare b building; ox int; oy int; v_j record; v_end text;
begin
  if p_wall.world_id is null or p_wall.building = 0 or is_low_wall(p_wall.type) or not bill_done(p_wall.needed) then return null; end if;
  select * into b from building where world_id = p_world and id = p_wall.building;
  if b.id is null or frame_carried(p_world, p_wall.level, p_wall.dir, p_wall.x, p_wall.y) then return null; end if;
  if p_wall.level = b.levels - 1 then
    ox := case when p_wall.dir = 'h' then p_wall.x else p_wall.x - 1 end;
    oy := case when p_wall.dir = 'h' then p_wall.y - 1 else p_wall.y end;
    for v_j in
      select v.jx, v.jy, v.nx, v.ny from (values (1, p_wall.x, p_wall.y, ox, oy), (2, ox, oy, p_wall.x, p_wall.y)) v(ord, jx, jy, nx, ny)
       order by v.ord
    loop
      if building_at(p_world, v_j.jx, v_j.jy) is not null then continue; end if;
      if not exists (select 1 from frame_storey(p_world, b.id, p_wall.level) a where a.x = v_j.jx and a.y = v_j.jy)
         or exists (select 1 from frame_storey(p_world, b.id, p_wall.level) a where a.x = v_j.nx and a.y = v_j.ny) then continue; end if;
      if exists (select 1 from floor_tile f where f.world_id = p_world and f.level = b.levels
                   and f.x = v_j.jx and f.y = v_j.jy and f.building = b.id) then
        return 'The roof over the jetty rests on this wall: raise a column at each end of it, or take the roof off, first.';
      end if;
    end loop;
  end if;
  v_end := frame_roof_end_on(p_world, p_wall);
  if v_end is not null then
    return 'The roof over the jetty rests on the ' || v_end || ' end of this wall: raise a column there, or take the roof off, first.';
  end if;
  return null;
end $fn$;

/**
 * The end of a finished full-height wall, by its compass point, that is all
 * that carries an end of a side of a roofed jetty (`roofEndOn`): one on a
 * corner with no finished column on it, where `frame_roof_side_on` finds a
 * side resting on it. Null when there is none.
 */
create or replace function frame_roof_end_on(p_world uuid, p_wall wall) returns text
  language plpgsql stable as $fn$
declare e record;
begin
  for e in
    select v.cx, v.cy, v.name from (values
        (1, p_wall.x, p_wall.y, case when p_wall.dir = 'h' then 'west' else 'north' end),
        (2, p_wall.x + case when p_wall.dir = 'h' then 1 else 0 end, p_wall.y + case when p_wall.dir = 'v' then 1 else 0 end,
            case when p_wall.dir = 'h' then 'east' else 'south' end)) v(ord, cx, cy, name)
     order by v.ord
  loop
    if exists (select 1 from building_column c where c.world_id = p_world and c.level = p_wall.level
                 and c.x = e.cx and c.y = e.cy and bill_done(c.needed)) then continue; end if;
    if frame_roof_side_on(p_world, p_wall.level, e.cx, e.cy, p_wall.dir, p_wall.x, p_wall.y) is not null then return e.name; end if;
  end loop;
  return null;
end $fn$;

/**
 * The first side of a roofed jetty of a storey, going round the tiles about a
 * corner from the north-west, whose end there nothing but the border `p_dir`,
 * `p_x`, `p_y` -- the wall it is asked for, or none for a column -- carries
 * (`roofSideOn`): a side out of the jetty's storey with no finished full-height
 * wall on it, on a corner where no other finished full-height wall ends. As
 * "<side> side of <x>,<y>", or null.
 */
create or replace function frame_roof_side_on(p_world uuid, p_level int, p_cx int, p_cy int, p_dir text, p_x int, p_y int)
returns text language plpgsql stable as $fn$
declare t record; s record; j building; v_area text[];
begin
  -- Another finished full-height wall ending there carries the corner as well.
  if exists (select 1 from wall w
              where w.world_id = p_world and w.level = p_level and bill_done(w.needed) and not is_low_wall(w.type)
                and ((w.dir = 'h' and w.y = p_cy and w.x in (p_cx - 1, p_cx)) or (w.dir = 'v' and w.x = p_cx and w.y in (p_cy - 1, p_cy)))
                and (p_dir is null or not (w.dir = p_dir and w.x = p_x and w.y = p_y))) then return null; end if;
  for t in
    select v.jx, v.jy from (values (1, p_cx - 1, p_cy - 1), (2, p_cx, p_cy - 1), (3, p_cx - 1, p_cy), (4, p_cx, p_cy)) v(ord, jx, jy)
     order by v.ord
  loop
    select * into j from building where world_id = p_world and id = frame_jetty_of(p_world, t.jx, t.jy);
    if j.id is null or j.levels - 1 <> p_level or building_at(p_world, t.jx, t.jy) is not null then continue; end if;
    if not exists (select 1 from floor_tile f where f.world_id = p_world and f.level = j.levels
                     and f.x = t.jx and f.y = t.jy and f.building = j.id) then continue; end if;
    select coalesce(array_agg(a.x || ',' || a.y), '{}') into v_area from frame_storey(p_world, j.id, p_level) a;
    if not ((t.jx || ',' || t.jy) = any (v_area)) then continue; end if;
    -- The tile's two sides that meet on the corner, each with the tile across it.
    for s in
      select v.side, bd.dir, bd.x as xx, bd.y as yy, a.x as nx, a.y as ny
        from (values (1, 'n'), (2, 'e'), (3, 's'), (4, 'w')) v(ord, side)
        cross join lateral border_of(t.jx, t.jy, v.side) bd
        cross join lateral across(t.jx, t.jy, v.side) a
       order by v.ord
    loop
      if not ((s.xx = p_cx and s.yy = p_cy)
              or (s.xx + case when s.dir = 'h' then 1 else 0 end = p_cx and s.yy + case when s.dir = 'v' then 1 else 0 end = p_cy)) then
        continue;
      end if;
      if p_dir is not null and s.dir = p_dir and s.xx = p_x and s.yy = p_y then continue; end if;
      if (s.nx || ',' || s.ny) = any (v_area) then continue; end if;
      if exists (select 1 from wall w where w.world_id = p_world and w.level = p_level and w.dir = s.dir
                   and w.x = s.xx and w.y = s.yy and bill_done(w.needed) and not is_low_wall(w.type)) then continue; end if;
      return side_name(s.side) || ' side of ' || t.jx || ',' || t.jy;
    end loop;
  end loop;
  return null;
end $fn$;

/** Whether any of a bill's materials have gone in, or there were none to go in (`progressOf` over nought). */
create or replace function frame_begun(p_needed jsonb, p_total jsonb) returns boolean
  language sql immutable as $fn$
  select coalesce((select sum(e.value::numeric) from jsonb_each_text(p_needed) e), 0)
           < coalesce((select sum(e.value::numeric) from jsonb_each_text(p_total) e), 0)
      or coalesce((select sum(e.value::numeric) from jsonb_each_text(p_total) e), 0) = 0
$fn$;

/**
 * The storey over a wall, standing on it (`storeyOnWall`): a finished
 * full-height wall of a storey under a wall of its building's storey over it
 * on the same border, one with any of its materials in -- a plan stands on
 * nothing, and a neighbour's jetty wall on its own floor -- with no finished
 * column at each end of it to carry that side instead. What to do first, or
 * null.
 */
create or replace function frame_storey_on_wall(p_world uuid, p_w wall) returns text
  language sql stable as $fn$
  select 'Storey ' || (p_w.level + 2) || ' stands on this wall: raise a column at each end of it, or take down the wall over it, first.'
   where p_w.world_id is not null and bill_done(p_w.needed) and not is_low_wall(p_w.type)
     and exists (select 1 from building b where b.world_id = p_world and b.id = p_w.building and p_w.level + 1 <= b.levels - 1)
     and exists (select 1 from wall u where u.world_id = p_world and u.level = p_w.level + 1
                   and u.dir = p_w.dir and u.x = p_w.x and u.y = p_w.y
                   and u.building = p_w.building and frame_begun(u.needed, u.total))
     and not frame_carried(p_world, p_w.level, p_w.dir, p_w.x, p_w.y)
$fn$;

/**
 * What a column carries, when it carries anything (`columnCarries`): a side at
 * its corner on the edge of its storey with no finished full-height wall,
 * closed by this column and the finished one at its other end, with a floor or
 * a roof of its building over one of the two tiles either side. The first
 * names the tile and its side. Nor one that alone carries an end of an open
 * side of a roofed jetty (`frame_roof_side_on`), which it names too.
 */
create or replace function frame_column_carries(p_world uuid, p_col building_column) returns text
  language plpgsql stable as $fn$
declare r record; v_side text;
begin
  if p_col.world_id is null or not bill_done(p_col.needed) then return null; end if;
  for r in
    with area as materialized (select s.x, s.y from frame_storey(p_world, p_col.building, p_col.level) s)
    select v.bord, v.dir, v.xx, v.yy, t.tord, t.tx, t.ty, t.side
      from (values (1, 'h', p_col.x - 1, p_col.y), (2, 'h', p_col.x, p_col.y),
                   (3, 'v', p_col.x, p_col.y - 1), (4, 'v', p_col.x, p_col.y)) v(bord, dir, xx, yy)
      cross join lateral (values
        (1, case when v.dir = 'h' then v.xx else v.xx - 1 end, case when v.dir = 'h' then v.yy - 1 else v.yy end,
            case when v.dir = 'h' then 's' else 'e' end),
        (2, v.xx, v.yy, case when v.dir = 'h' then 'n' else 'w' end)) t(tord, tx, ty, side)
     where frame_carried(p_world, p_col.level, v.dir, v.xx, v.yy)
       and not exists (select 1 from wall w where w.world_id = p_world and w.level = p_col.level and w.dir = v.dir
                         and w.x = v.xx and w.y = v.yy and bill_done(w.needed) and not is_low_wall(w.type))
       -- On the edge of the storey: inside it a side carries nothing.
       and (select count(*) from area a
             where (a.x = v.xx and a.y = v.yy)
                or (a.x = case when v.dir = 'h' then v.xx else v.xx - 1 end
                    and a.y = case when v.dir = 'h' then v.yy - 1 else v.yy end)) = 1
       and exists (select 1 from floor_tile f where f.world_id = p_world and f.level = p_col.level + 1
                     and f.x = t.tx and f.y = t.ty and f.building = p_col.building)
     order by v.bord, t.tord
     limit 1
  loop
    return 'The ' || side_name(r.side) || ' side of ' || r.tx || ',' || r.ty
        || ' is carried on this column: wall it, or take off what is over it, first.';
  end loop;
  -- And the end of a side of a roofed jetty that rests on it alone (`frame_roof_side_on`).
  v_side := frame_roof_side_on(p_world, p_col.level, p_col.x, p_col.y, null, null, null);
  if v_side is not null then
    return 'The roof over the jetty rests on this column: wall the ' || v_side || ', or take the roof off, first.';
  end if;
  return null;
end $fn$;

/* ---- The refusals and the doing, in the browser's order and words ----------------------------------- */

/**
 * What `build_refusal` asks of jetties, terraces, railings and columns, at the
 * point it is asked in the browser. Where the browser would stop first on
 * something `build_refusal` already says, this says nothing and lets it.
 */
create or replace function frame_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb, p_b building)
returns text language plpgsql stable as $fn$
declare tx int := (p_target->>'x')::int; ty int := (p_target->>'y')::int; side text := p_target->>'side';
        cx int := (p_target->>'cx')::int; cy int := (p_target->>'cy')::int;
        mat build_material_def; lvl int; kind text; over building; f floor_tile; tool text; bears int;
        col building_column; v_lvl int; v_gap text;
        v_terrace boolean := coalesce((p_target->>'terrace')::boolean, false);
begin
  select * into mat from build_material_def where id = p_target->>'material';

  -- Nothing is planned under a jetty: the ground there stays open ground.
  if p_action in ('plan_building', 'add_to_building') then
    select * into over from building where world_id = p_world and id = frame_jetty_of(p_world, tx, ty);
    if over.id is not null then return 'That tile is under ' || over.name || '''s jetty.'; end if;
    return null;
  end if;

  if p_action = 'remove_from_plan' then
    -- The cellar's word comes first, as the browser asks it (`cellar.ts`).
    if p_b.id is null or p_b.levels > 1 or (cellar_at(p_world, tx, ty)).world_id is not null
       or tile_has_structures(p_world, tx, ty) then return null; end if;
    if exists (select 1 from building_column c where c.world_id = p_world and c.level = 0
                 and c.x in (tx, tx + 1) and c.y in (ty, ty + 1)) then
      return 'Take down the columns on its corners first.';
    end if;
    return null;
  end if;

  if p_action = 'remove_storey' then
    if p_b.id is null or p_b.levels <= 1 or has_roof(p_world, p_b.id)
       or exists (select 1 from wall where world_id = p_world and building = p_b.id and level = p_b.levels - 1)
       or exists (select 1 from floor_tile where world_id = p_world and building = p_b.id and level = p_b.levels - 1) then
      return null;
    end if;
    if exists (select 1 from building_column c where c.world_id = p_world and c.building = p_b.id
                 and c.level = p_b.levels - 1) then
      return 'Take down the columns of the top storey first.';
    end if;
    return null;
  end if;

  -- A terrace takes a railing and nothing else; a railing goes nowhere on the ground.
  if p_action = 'plan_wall' then
    if side is null or not exists (select 1 from wall_type_def where id = p_target->>'wallType') or mat.id is null
       or need_tool(p_world, p_uid, 'mallet') is not null or p_b.id is null then
      return null;
    end if;
    if v_terrace then
      if roof_shape_of(p_world, p_b.id) <> 'flat' then return 'Only a flat roof is a terrace.'; end if;
      if p_target->>'wallType' <> 'railing' then return 'Only a railing goes round a terrace.'; end if;
      if not exists (select 1 from floor_tile ft where ft.world_id = p_world and ft.level = p_b.levels
                       and ft.x = tx and ft.y = ty and ft.kind = 'roof' and bill_done(ft.needed)) then
        return 'Finish the roof on this tile first.';
      end if;
      return null;
    end if;
    -- The ground floor of a tile on piers is its deck, whose edge is a drop as an upper floor's is.
    if p_target->>'wallType' = 'railing' and frame_job_level(p_b, p_target) < 1 and not on_piers(p_world, tx, ty) then
      return 'A railing goes on the edge of a storey above the ground, of a deck on piers, or round a terrace. On the ground, plan a fence.';
    end if;
    -- A wall shutting a roofed jetty off from its storey would make a balcony with a roof on it.
    if not is_low_wall(p_target->>'wallType') and frame_job_level(p_b, p_target) = p_b.levels - 1
       and (frame_wall_at(p_world, tx, ty, side, p_target)).world_id is null
       and exists (select 1 from border_of(tx, ty, side) bd where frame_roof_cut_off(p_world, p_b, bd.dir, bd.x, bd.y)) then
      return 'The roof is over that jetty: take it off first. A balcony takes no roof.';
    end if;
    return null;
  end if;

  -- A floor out past the footprint: a jetty, or the roof over one.
  if p_action = 'plan_floor' then
    if mat.id is null or need_tool(p_world, p_uid, 'mallet') is not null or p_b.id is null
       or building_at(p_world, tx, ty) is not null then
      return null;
    end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    return frame_jetty_refusal(p_world, p_uid, p_b, tx, ty, kind, frame_floor_level(p_world, p_b.id, kind, p_target), mat,
                               p_target->>'roofShape');
  end if;

  -- A jetty resting on a wall and on nothing else would be left in the air.
  if p_action = 'remove_wall' then
    if side is null then return null; end if;
    v_lvl := frame_bears_jetty(p_world, frame_wall_at(p_world, tx, ty, side, p_target));
    if v_lvl is not null then
      return 'A jetty of storey ' || (v_lvl + 1) || ' rests on this wall: raise a column at each end of it, or tear the jetty up, first.';
    end if;
    -- And a roof over a jetty resting on it alone, or the storey over it.
    return coalesce(frame_roof_on_wall(p_world, frame_wall_at(p_world, tx, ty, side, p_target)),
                    frame_storey_on_wall(p_world, frame_wall_at(p_world, tx, ty, side, p_target)));
  end if;

  -- A railing round a flat roof stands on it.
  if p_action = 'remove_floor' then
    if p_b.id is null then return null; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := frame_floor_level(p_world, p_b.id, kind, p_target);
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found then return null; end if;
    if f.kind = 'roof' and exists (
        select 1 from (values ('n'), ('e'), ('s'), ('w')) s(side)
        cross join lateral border_of(tx, ty, s.side) bd
        join wall w on w.world_id = p_world and w.level = p_b.levels
          and w.dir = bd.dir and w.x = bd.x and w.y = bd.y
       where w.building = p_b.id) then
      return 'Take down the railing standing on it first.';
    end if;
    -- A column on it, or the roof over a jetty: asked after the walls on it, which `build_refusal` names.
    if f.kind <> 'roof' and not exists (
        select 1 from (values ('n'), ('e'), ('s'), ('w')) s(side)
        cross join lateral border_of(tx, ty, s.side) bd
        join wall w on w.world_id = p_world and w.level = lvl and w.dir = bd.dir and w.x = bd.x and w.y = bd.y) then
      return frame_floor_holds(p_world, p_b, lvl, tx, ty);
    end if;
    return null;
  end if;

  if p_action = 'plan_column' then
    if mat.id is null then return 'Choose a material.'; end if;
    if cx is null or cy is null or cx not in (tx, tx + 1) or cy not in (ty, ty + 1) then return 'Choose a corner of the tile.'; end if;
    -- Glass goes on a roof and nowhere else (`glass_refusal`).
    if mat.id = glass_material() then return glass_roof_only_said(); end if;
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    if p_b.id is null then return 'No building here.'; end if;
    lvl := frame_job_level(p_b, p_target);
    if not frame_column_footing(p_world, p_b.id, lvl, cx, cy) then return 'Build the floor of this storey first.'; end if;
    if exists (select 1 from building_column c where c.world_id = p_world and c.level = lvl and c.x = cx and c.y = cy) then
      return 'There is already a column on that corner.';
    end if;
    -- On the ground floor it takes the corner spot of every tile round it (`frame_column_corner`): none with a piece in it.
    if lvl = 0 and frame_piece_in_corner(p_world, cx, cy) then return 'Move what stands in that corner first.'; end if;
    -- What is under it has to carry it, as it would a wall: on piers its decks first (`deck_carries`).
    v_gap := case when p_b.deck is not null then deck_carries(p_world, p_b.id, mat.id) end;
    if v_gap is not null then return v_gap; end if;
    bears := bearing(p_world, p_b.id, lvl);
    if mat.heft > coalesce(bears, 9) then
      return mat.name || ' is too heavy to raise over what is under it. This storey carries '
          || heft_word(bears) || ', no more.';
    end if;
    return null;
  end if;

  if p_action in ('build_column', 'remove_column') then
    if cx is null or cy is null or cx not in (tx, tx + 1) or cy not in (ty, ty + 1) then return 'Choose a corner of the tile.'; end if;
    if p_b.id is not null then
      select * into col from building_column c
       where c.world_id = p_world and c.level = frame_job_level(p_b, p_target) and c.x = cx and c.y = cy;
    end if;
    if p_action = 'remove_column' then
      if col.world_id is null then return 'There is no column there.'; end if;
      -- What it carries, if it carries anything, comes down first, or a wall goes up to take it.
      return frame_column_carries(p_world, col);
    end if;
    if col.world_id is null then return 'There is no column planned there.'; end if;
    if bill_done(col.needed) then return 'That column is finished.'; end if;
    select * into mat from build_material_def where id = col.material;
    tool := need_tool(p_world, p_uid, mat.tool);
    if tool is not null then return tool; end if;
    if next_material(p_world, p_uid, col.material, col.needed, tx, ty) is null then
      return 'You need ' || bill_text(col.material, col.needed) || '.';
    end if;
    return null;
  end if;
  return null;
end $fn$;

/** Planning, building and taking down a column: `FRAME_ACTIONS`. */
create or replace function perform_frame(p_world uuid, p_uid uuid, p_action text, p_target jsonb, p_b building)
returns void language plpgsql as $fn$
declare tx int := (p_target->>'x')::int; ty int := (p_target->>'y')::int;
        cx int := (p_target->>'cx')::int; cy int := (p_target->>'cy')::int;
        mat build_material_def; col building_column; bill jsonb; used text; v_laid text[]; v_i int; lvl int;
        v_corner text;
begin
  if p_b.id is null or cx is null or cy is null then return; end if;
  lvl := frame_job_level(p_b, p_target);
  v_corner := side_name(case when cy = ty then 'n' else 's' end) || '-' || side_name(case when cx = tx then 'w' else 'e' end);
  if p_action = 'plan_column' then
    select * into mat from build_material_def where id = p_target->>'material';
    if mat.id is null then return; end if;
    bill := scaled_bill(mat.id, column_share());
    insert into building_column (world_id, level, x, y, building, material, needed, total, planned_by)
    values (p_world, lvl, cx, cy, p_b.id, mat.id, bill, bill, p_uid);
    perform tell(p_world, p_uid, 'You plan a ' || lower(mat.name) || ' column on the ' || v_corner
      || ' corner. It needs ' || bill_text(mat.id, bill) || '.', 'event');

  elsif p_action = 'build_column' then
    select * into col from building_column c where c.world_id = p_world and c.level = lvl and c.x = cx and c.y = cy;
    if col.world_id is null or bill_done(col.needed) then return; end if;
    select * into mat from build_material_def where id = col.material;
    -- A unit a go, or as many as a Mason's Two at a Time lays on stone, as a wall is built.
    bill := col.needed;
    v_laid := '{}';
    for v_i in 1 .. greatest(1, floor(pk(p_world, p_uid, 'lay:' || build_work(mat.kind), 1))::int) loop
      exit when bill_done(bill);
      used := next_material(p_world, p_uid, col.material, bill, tx, ty);
      exit when used is null or not take_material(p_world, p_uid, used, tx, ty, col.material);
      bill := jsonb_set(bill, array[used], to_jsonb((bill->>used)::int - 1));
      v_laid := v_laid || used;
    end loop;
    if coalesce(array_length(v_laid, 1), 0) = 0 then return; end if;
    update building_column set needed = bill where world_id = p_world and level = lvl and x = cx and y = cy;
    perform skill_raise(p_world, p_uid, mat.skill, 0.4);
    if bill_done(bill) then
      perform tell(p_world, p_uid, 'You finish the ' || lower(mat.name) || ' column.', 'event');
    else
      perform tell(p_world, p_uid, 'You fit ' || laid_text(v_laid) || ' into the column. Still needed: '
        || bill_text(col.material, bill) || '.', 'event');
    end if;

  elsif p_action = 'remove_column' then
    delete from building_column where world_id = p_world and level = lvl and x = cx and y = cy returning * into col;
    if col.world_id is null then return; end if;
    perform tell(p_world, p_uid, 'You take down the column on the ' || v_corner || ' corner.', 'event');
  end if;
end $fn$;

/* ---- Footing up a storey ------------------------------------------------------------------------- */

/**
 * Whether a body up a storey has anything to stand on at a tile: a finished
 * floor, staircase or ladder, a flat roof, or a walkway from storey to storey
 * (`Game.standable` up a storey, and the browser's bridges at a level).
 */
create or replace function frame_stands(p_world uuid, p_x int, p_y int, p_level int) returns boolean
  language plpgsql stable as $fn$
declare f floor_tile;
begin
  select * into f from floor_tile where world_id = p_world and level = p_level and x = p_x and y = p_y;
  if found and bill_done(f.needed) then
    if f.kind <> 'roof' then return true; end if;
    return coalesce((select r.walkable from building b join roof_shape_def r on r.id = coalesce(b.roof, 'hip')
                      where b.world_id = p_world and b.id = f.building), false);
  end if;
  return exists (select 1 from bridge b where b.world_id = p_world and b.level = p_level
                   and ((b.ax = p_x and b.ay = p_y) or (b.bx = p_x and b.by = p_y)
                        or exists (select 1 from bridge_span s where s.world_id = p_world and s.bridge = b.id
                                     and s.x = p_x and s.y = p_y)));
end $fn$;

/**
 * How much of a walk up a storey stands on something (`walk_share`, up a
 * storey): the edge of what is built there -- a balcony's, a terrace's, any
 * upper floor's -- stops a body, railed or not. Nothing is read unless the
 * walk leaves the tile it started on.
 */
create or replace function frame_footing(p_world uuid, p_level int, p_x0 double precision, p_y0 double precision,
                                         p_x1 double precision, p_y1 double precision) returns double precision
  language plpgsql stable as $fn$
declare far double precision; n int; i int; t double precision; fx int; fy int; tx int; ty int;
begin
  fx := floor(p_x0)::int; fy := floor(p_y0)::int;
  if floor(p_x1)::int = fx and floor(p_y1)::int = fy then return 1; end if;
  far := sqrt(power(p_x1 - p_x0, 2) + power(p_y1 - p_y0, 2));
  n := least(walk_samples()::int, greatest(1, ceil(far * 2)::int));
  for i in 1..n loop
    t := i::double precision / n;
    tx := floor(p_x0 + (p_x1 - p_x0) * t)::int;
    ty := floor(p_y0 + (p_y1 - p_y0) * t)::int;
    if tx <> fx or ty <> fy then
      if not frame_stands(p_world, tx, ty, p_level) then return (i - 1)::double precision / n; end if;
      fx := tx; fy := ty;
    end if;
  end loop;
  return 1;
end $fn$;

/* ---- The storey rules, restated whole ------------------------------------------------------------ */

/**
 * What is left before a storey is closed in: over the storey's own floor, its
 * jetties open to it included (`frame_storey`), and a side with no wall on it
 * closed all the same when a finished column stands at both ends of it.
 */
create or replace function level_gap(p_world uuid, p_building int, p_level int,
                                     p_x double precision, p_y double precision) returns text
  language sql stable as $fn$
  with area as (select * from frame_storey(p_world, p_building, p_level)),
  sides as (
    select t.x, t.y, s.side, b.dir, b.x as bx, b.y as by
    from area t
    cross join lateral (values ('n'), ('e'), ('s'), ('w')) as s(side)
    cross join lateral across(t.x, t.y, s.side) a
    cross join lateral border_of(t.x, t.y, s.side) b
    where not exists (select 1 from area q where q.x = a.x and q.y = a.y)),
  holes as (
    select s.x, s.y, s.side, (w.type is null) as bare
    from sides s
    left join wall w on w.world_id = p_world and w.level = p_level
      and w.dir = s.dir and w.x = s.bx and w.y = s.by
    where (w.type is null and not frame_carried(p_world, p_level, s.dir, s.bx, s.by))
       or (w.type is not null and not bill_done(w.needed))),
  -- And anything planned inside it and never finished, which stops a storey
  -- being closed in just as surely as a hole in the outside wall.
  within as (
    select count(*)::int as n from wall w
    where w.world_id = p_world and w.building = p_building and w.level = p_level
      and not bill_done(w.needed)
      and not exists (select 1 from sides s where s.dir = w.dir and s.bx = w.x and s.by = w.y)),
  tally as (
    select count(*) filter (where bare)::int as bare,
           count(*) filter (where not bare)::int + (select n from within) as going,
           (select ', nearest the ' || side_name(h.side) || ' side of ' || h.x || ',' || h.y
              from holes h
             order by (h.x + 0.5 - p_x) ^ 2 + (h.y + 0.5 - p_y) ^ 2, h.x, h.y, strpos('nesw', h.side)
             limit 1) as at
    from holes)
  select case when bare = 0 and going = 0 then null else
    'Storey ' || (p_level + 1) || ' is not closed in: '
      || array_to_string(array_remove(array[
           case when bare > 0 then bare || ' side' || case when bare = 1 then '' else 's' end
                                  || ' with no wall or columns' end,
           case when going > 0 then going || ' still going up' end], null), ' and ')
      || coalesce(at, '') || '.' end
  from tally
$fn$;

/**
 * Whether anything waist-high stands where the storey over it would rest:
 * up a storey, on a side of the storey itself (`frame_storey`) -- a railing
 * round a balcony shut off behind a door carries nothing and is not asked.
 */
create or replace function has_low_wall(p_world uuid, p_building int, p_level int) returns boolean
  language sql stable as $fn$
  select exists (select 1 from wall w where w.world_id = p_world and w.building = p_building
      and w.level = p_level and is_low_wall(w.type)
      and (p_level = 0 or exists (
        select 1 from frame_storey(p_world, p_building, p_level) a
         where (a.x = w.x and a.y = w.y)
            or (w.dir = 'h' and a.x = w.x and a.y = w.y - 1)
            or (w.dir = 'v' and a.x = w.x - 1 and a.y = w.y))))
    or (p_level = 0 and exists (
      select 1 from exterior_borders(p_world, p_building) b
      join wall w on w.world_id = p_world and w.level = 0
        and w.dir = b.dir and w.x = b.x and w.y = b.y
      where is_low_wall(w.type)))
$fn$;

/** The heaviest thing a storey may carry: the lightest wall or column under it. */
create or replace function bearing(p_world uuid, p_building int, p_level int)
returns int language sql stable as $fn$
  select least(
    (select min(m.heft) from wall w join build_material_def m on m.id = w.material
      where w.world_id = p_world and w.building = p_building and w.level < p_level),
    (select min(m.heft) from building_column c join build_material_def m on m.id = c.material
      where c.world_id = p_world and c.building = p_building and c.level < p_level))
$fn$;

create or replace function storey_cap(p_world uuid, p_building integer)
 returns integer language sql stable as $fn$
  select least(max_levels()::int + t.n,
               coalesce((select min(m.storeys + case when m.kind = 'stone' then t.n else 0 end)
                           from frame_materials(p_world, p_building) u
                           join build_material_def m on m.id = u.material), max_levels()::int + t.n))
    from (select coalesce(tall_of(p_world, p_building), 0) as n) t
$fn$;

create or replace function storey_capper(p_world uuid, p_building integer)
 returns build_material_def language sql stable as $fn$
  select m.* from frame_materials(p_world, p_building) u join build_material_def m on m.id = u.material
   order by m.storeys + case when m.kind = 'stone' then coalesce(tall_of(p_world, p_building), 0) else 0 end, m.id
   limit 1
$fn$;

/** The material a storey is mostly built in, walls and columns counted alike; a tie goes to the first by name. */
create or replace function storey_material(p_world uuid, p_building int, p_level int)
returns build_material_def language sql stable as $fn$
  select m.* from (
      select w.material from wall w
       where w.world_id = p_world and w.building = p_building and w.level = p_level
      union all
      select c.material from building_column c
       where c.world_id = p_world and c.building = p_building and c.level = p_level) u
    join build_material_def m on m.id = u.material
   group by m.id
   order by count(*) desc, m.id limit 1
$fn$;

/**
 * Under a roof: a room covered all over whose every side has a finished wall
 * on it or a finished column at both ends of it (`Buildings.sheltered`).
 * `indoors` is the same with walls alone, and is what a bed asks.
 */
create or replace function sheltered(p_world uuid, p_level int, p_x int, p_y int) returns boolean
  language sql stable as $fn$
  with recursive fill as (
    select p_x as x, p_y as y
    union
    select n.nx, n.ny from fill f
      cross join lateral (values (f.x, f.y - 1, 'n'), (f.x + 1, f.y, 'e'),
                                 (f.x, f.y + 1, 's'), (f.x - 1, f.y, 'w')) n(nx, ny, side)
     where building_at(p_world, n.nx, n.ny) is not null
       and building_at(p_world, n.nx, n.ny) = building_at(p_world, p_x, p_y)
       and (p_level = 0 or exists (select 1 from floor_tile ft
              where ft.world_id = p_world and ft.level = p_level and ft.x = n.nx and ft.y = n.ny))
       and not exists (select 1 from border_of(f.x, f.y, n.side) bd
                        join wall w on w.world_id = p_world and w.level = p_level
                          and w.dir = bd.dir and w.x = bd.x and w.y = bd.y
                       where bill_done(w.needed))
  ),
  room as (select x, y from fill),
  gaps as (
    select t.x, t.y, n.side from room t
      cross join lateral (values (t.x, t.y - 1, 'n'), (t.x + 1, t.y, 'e'),
                                 (t.x, t.y + 1, 's'), (t.x - 1, t.y, 'w')) n(nx, ny, side)
     where not exists (select 1 from room q where q.x = n.nx and q.y = n.ny)
  )
  select building_at(p_world, p_x, p_y) is not null
     and not exists (select 1 from room t where not covered_at(p_world, p_level, t.x, t.y))
     and not exists (select 1 from gaps g cross join lateral border_of(g.x, g.y, g.side) bd
                      where not exists (select 1 from wall w where w.world_id = p_world and w.level = p_level
                                          and w.dir = bd.dir and w.x = bd.x and w.y = bd.y and bill_done(w.needed))
                        and (exists (select 1 from wall w where w.world_id = p_world and w.level = p_level
                                       and w.dir = bd.dir and w.x = bd.x and w.y = bd.y)
                             or not frame_carried(p_world, p_level, bd.dir, bd.x, bd.y)))
$fn$;

/** How fast things rot at a spot: a tenth on a deed, and `indoors_decay()` of that under a roof on walls or columns. */
create or replace function decay_multiplier(p_world uuid, p_x int, p_y int)
returns double precision language sql stable as $fn$
  select (case when on_deed(p_world, p_x, p_y) then 0.1 else 1 end)
       * (case when sheltered(p_world, 0, p_x, p_y) then indoors_decay() else 1 end)
$fn$;

/* ---- The shared functions, each changed in a few marked lines ---------------------------------- */

create or replace function build_action(p_action text)
 returns boolean language sql immutable as $fn$
  select p_action in (
    'plan_building', 'add_to_building', 'remove_from_plan', 'rename_building',
    'plan_wall', 'plan_fence', 'build_wall', 'remove_wall',
    'add_floor', 'plan_floor', 'build_floor', 'remove_floor', 'remove_storey',
    'paint_wall', 'strip_wall_paint', 'paint_floor',
    -- A Mason's Repoint.
    'repoint_wall')
    -- Frame: the column jobs (`frame_action`).
    or frame_action(p_action)
$fn$;

CREATE OR REPLACE FUNCTION public.build_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare tx int; ty int; side text; wt wall_type_def; mat build_material_def; b building;
        w wall; f floor_tile; lvl int; kind text; tool text; other record; v_gap text;
        bears int; cap int; worst build_material_def; under build_material_def;
        pot item; colour dye_def; v_was build_material_def; v_over int; v_stands int; v_bill jsonb; v_glass text;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  side := p_target->>'side';
  select * into wt from wall_type_def where id = p_target->>'wallType';
  select * into mat from build_material_def where id = p_target->>'material';
  select * into b from building where world_id = p_world and id = building_at(p_world, tx, ty);
  -- Frame: a storey job out past the footprint is for the building it names (`frame_building`).
  b := frame_building(p_world, p_action, p_target, b);

  /*
   * Whose building it is, asked once for every action that acts on one that
   * already stands.
   *
   * `plan_building` and `add_to_building` are answered by `plan_reason`, which
   * asks whose *ground* it is. Everything else — renaming, unpicking, walling,
   * flooring, adding a storey — was asked of nobody at all, so anybody could
   * rename or take apart anybody's building. `plan_fence` never reaches this
   * because it refuses outright on a tile that is part of a building.
   */
  if b.id is not null and p_action <> 'plan_building'
     and not building_yours(p_world, p_uid, b.id) then
    return 'That is not your building.';
  end if;
  -- Glass goes on a pitched roof and nowhere else, and no floor over a field (`glass_refusal`).
  v_glass := glass_refusal(p_world, p_uid, p_action, p_target);
  if v_glass is not null then return v_glass; end if;
  -- Frame: jetties, terraces, railings and columns, where the browser asks them, after the glass (`frame_refusal`).
  v_gap := frame_refusal(p_world, p_uid, p_action, p_target, b);
  if v_gap is not null or frame_action(p_action) then return v_gap; end if;

  if p_action = 'plan_building' then
    return coalesce(need_tool(p_world, p_uid, 'mallet'), plan_reason(p_world, p_uid, tx, ty),
                    counter_street_refusal(p_world, tx, ty));  -- a counter's street (`counters.ts`)

  elsif p_action = 'add_to_building' then
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    select * into b from building where world_id = p_world and id = neighbour_building(p_world, tx, ty);
    if not found then return 'There is no building next to this tile.'; end if;
    if b.levels > 1 then return 'The footprint cannot change once upper floors are planned.'; end if;
    -- Piers: under the deck, or beside the floor, of the building it joins (`extend_reason`).
    return coalesce(extend_reason(p_world, p_uid, tx, ty, b.id), counter_street_refusal(p_world, tx, ty));  -- a counter's street

  elsif p_action = 'remove_from_plan' then
    if b.id is null then return 'No building here.'; end if;
    if b.levels > 1 then return 'Remove the upper floors first.'; end if;
    -- cellar: a building with a cellar under it comes down only once the cellar is filled in.
    if (cellar_at(p_world, tx, ty)).world_id is not null then return 'Fill in the cellar under it first.'; end if;
    if tile_has_structures(p_world, tx, ty) then return 'Remove the walls and floor on this tile first.'; end if;
    return null;

  elsif p_action = 'rename_building' then
    if b.id is null then return 'No building here.'; end if;
    if nullif(btrim(coalesce(p_target->>'name', '')), '') is null then return 'Choose a name.'; end if;
    return null;

  elsif p_action = 'plan_wall' then
    if side is null or wt.id is null or mat.id is null then return 'Choose a side, a wall type and a material.'; end if;
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    if b.id is null then return 'No building here.'; end if;
    lvl := frame_wall_level(p_world, tx, ty, p_target);  -- Frame: a jetty's storey, or round a terrace.
    -- Piers: and on the ground floor of a tile on piers, which is its deck.
    if lvl > 0 or on_piers(p_world, tx, ty) then
      select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
      if not found or not bill_done(f.needed) then return 'Build the floor of this storey first.'; end if;
    end if;
    -- Frame: and on the job's storey.
    if (frame_wall_at(p_world, tx, ty, side, p_target)).world_id is not null then return 'There is already a wall on that side.'; end if;
    -- A shop counter faces the street from the ground floor (`counters.ts`).
    if wt.id = 'counter' then
      v_gap := counter_plan_refusal(p_world, lvl, tx, ty, side);
      if v_gap is not null then return v_gap; end if;
    end if;
    -- Nor does a wall close over a lantern post's arm (`lamps.ts`).
    v_gap := lamp_wall_refusal(p_world, lvl, tx, ty, side, wt.id);
    if v_gap is not null then return v_gap; end if;
    /*
     * And what is underneath has to carry it. The courses below are what hold
     * a wall up, and a beginner finds that out by being told rather than by
     * watching it come down.
     */
    -- Piers: and a building on piers stands on its decks, which carry what they are laid in (`deck_carries`).
    v_gap := case when b.deck is not null then deck_carries(p_world, b.id, mat.id) end;
    if v_gap is not null then return v_gap; end if;
    bears := coalesce(bearing(p_world, b.id, lvl), 9);
    if mat.heft > bears then
      return mat.name || ' is too heavy to raise over what is under it. This storey carries '
          || heft_word(bears) || ', no more.';
    end if;
    return null;

  elsif p_action = 'plan_fence' then
    if side is null or wt.id is null or mat.id is null then return 'Choose a side, a kind and a material.'; end if;
    if not wt.standalone then return 'Only fences and half walls stand on their own.'; end if;
    tool := need_tool(p_world, p_uid, mat.tool);
    if tool is not null then return tool; end if;
    if b.id is not null then return 'That is part of a building: plan a wall instead.'; end if;
    select * into other from across(tx, ty, side);
    -- The border is shared, so the tile on the other side of it has a say.
    if building_at(p_world, other.x, other.y) is not null then return 'A building stands on the other side of that border.'; end if;
    if not in_bounds(p_world, other.x, other.y) then return 'That border is the edge of the world.'; end if;
    if has_water(p_world, tx, ty) or has_water(p_world, other.x, other.y) then return 'Fences do not stand in water.'; end if;
    if not passable(p_world, tx, ty) or not passable(p_world, other.x, other.y) then return 'There is no room for posts there.'; end if;
    if exists (select 1 from border_of(tx, ty, side) bd
               join wall w2 on w2.world_id = p_world and w2.level = 0
                 and w2.dir = bd.dir and w2.x = bd.x and w2.y = bd.y) then
      return 'There is already something on that border.';
    end if;
    return null;

  elsif p_action in ('build_wall', 'remove_wall') then
    if side is null then return 'Choose a side.'; end if;
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    if p_action = 'remove_wall' then
      -- And a shop counter comes down empty, till and all (`counters.ts`).
      return case when w.world_id is null then 'There is no wall there.' else counter_remove_refusal(p_world, w) end;
    end if;
    if w.world_id is null then return 'There is no wall planned there.'; end if;
    if bill_done(w.needed) then return 'That wall is finished.'; end if;
    -- Nor is one raised over a lantern post's arm (`lamps.ts`).
    v_gap := lamp_wall_refusal(p_world, w.level, tx, ty, side, w.type);
    if v_gap is not null then return v_gap; end if;
    select * into mat from build_material_def where id = w.material;
    if mat.id is not null then
      tool := need_tool(p_world, p_uid, mat.tool);
      if tool is not null then return tool; end if;
    end if;
    if next_material(p_world, p_uid, w.material, w.needed, tx, ty) is null then
      return 'You need ' || bill_text(w.material, w.needed) || '.';
    end if;
    return null;

  elsif p_action = 'add_floor' then
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    if b.id is null then return 'No building here.'; end if;
    -- A Mason's Tall Walls: stone stands higher in a building they planned.
    if b.levels >= max_levels()::int + tall_of(p_world, b.id) then
      return 'Buildings cannot be taller than ' || (max_levels()::int + tall_of(p_world, b.id)) || ' storeys.';
    end if;
    /*
     * And no taller than what it is made of will stand. The shortest material
     * in the whole building answers, not the one you are standing on: a plank
     * wing joined to a stone tower caps the tower.
     */
    cap := storey_cap(p_world, b.id);
    if b.levels >= cap then
      worst := storey_capper(p_world, b.id);
      return coalesce(worst.name, 'What this is built of') || ' will not stand '
          || (cap + 1) || ' storeys. ' || cap || ' is as high as it goes.';
    end if;
    -- And the hands to raise it: ten a storey in the trade of the one below.
    under := storey_material(p_world, b.id, b.levels - 1);
    -- Past the tenth storey, which only Tall Walls reaches, a hundred is as much as there is.
    if under.id is not null and skill_of(p_world, p_uid, under.skill) < least(100, b.levels * storey_skill()) then
      return 'Raising a ' || (b.levels + 1) || nth(b.levels + 1) || ' storey over '
          || lower(under.name) || ' takes ' || under.skill || ' '
          || least(100, b.levels * storey_skill()) || '. You have '
          || to_char(skill_of(p_world, p_uid, under.skill), 'FM990.0') || '.';
    end if;
    if has_roof(p_world, b.id) then return 'Take the roof off first.'; end if;
    if has_low_wall(p_world, b.id, b.levels - 1) then
      -- Frame: a railing is low work too, and columns close a side.
      return 'Nothing rests on a fence, a half wall or a railing: the storey below needs walls, or finished columns at both ends of every open side.';
    end if;
    v_gap := level_gap(p_world, b.id, b.levels - 1, p_uid);
    if v_gap is not null then return v_gap; end if;
    return null;

  elsif p_action = 'plan_floor' then
    if mat.id is null then return 'Choose a material.'; end if;
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    if b.id is null then return 'No building here.'; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := frame_floor_level(p_world, b.id, kind, p_target); -- cellar: storey nought for a flight down; Frame: else the job's storey.
    if kind = 'roof' then
      v_gap := level_gap(p_world, b.id, b.levels - 1, p_uid);
      if v_gap is not null then return v_gap; end if;
    elsif kind in ('stairs', 'ladder') then
      -- cellar: on the ground floor, a way down to the cellar under it.
      if lvl < 1 then
        -- Frame: not a way down, so a way up: in a building with a storey over the ground, that storey to work on.
        if (cellar_at(p_world, tx, ty)).world_id is null and not coalesce((p_target->>'down')::boolean, false) and b.levels > 1 then
          return 'Work on storey 2 or above to plan ' || case when kind = 'ladder' then 'a ladder' else 'stairs' end || ' here.';
        end if;
        v_gap := cellar_flight_refusal(p_world, b.id, tx, ty, side, coalesce((p_target->>'down')::boolean, false));
        if v_gap is not null then return v_gap; end if;
      end if;
      if side is null then return 'Choose the side to climb from.'; end if;
      -- Piers: a flight or a ladder up from a tile on piers stands on its deck.
      if (lvl > 1 or on_piers(p_world, tx, ty)) and not exists (select 1 from floor_tile where world_id = p_world
          and level = lvl - 1 and x = tx and y = ty) then
        return 'Plan the floor of the storey below first.';
      end if;
      -- cellar: one way off the ground floor a tile: a flight up and a flight down are not stacked on it.
      v_gap := cellar_stack_refusal(p_world, lvl, tx, ty); -- cellar
      if v_gap is not null then return v_gap; end if; -- cellar
    end if;
    -- cellar: a flight or a ladder down takes up the ground floor's flooring where it goes (`flooringUnder`).
    if exists (select 1 from floor_tile f2 where f2.world_id = p_world and f2.level = lvl and f2.x = tx and f2.y = ty
                 and not (lvl = 0 and f2.kind = 'floor' and p_target->>'floorKind' in ('stairs', 'ladder'))) then -- cellar
      return case when kind = 'roof' then 'There is already roof planned here.'
                  else 'There is already a floor planned here.' end;
    end if;
    -- Piers: a deck on piers carries what it is laid in, and the building on it is as heavy as its heaviest wall (`deck_bears`).
    if lvl = 0 and kind = 'floor' and on_piers(p_world, tx, ty) then return deck_bears(p_world, b.id, mat.id); end if;
    return null;

  elsif p_action in ('build_floor', 'remove_floor') then
    if b.id is null then return case when p_action = 'build_floor'
      then 'There is nothing planned here.' else 'No building here.' end; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := frame_floor_level(p_world, b.id, kind, p_target); -- cellar; Frame: on the job's storey.
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if p_action = 'remove_floor' then
      if not found then return 'There is nothing here to remove.'; end if;
      -- cellar: a flight down is let into the ground floor, and the walls round it stand on the ground;
      -- cellar: and a way down is a way up too, for whoever is down there.
      if lvl = 0 and f.kind in ('stairs', 'ladder') then -- cellar
        if (cellar_at(p_world, tx, ty)).world_id is not null and cellar_occupied(p_world, b.id) then -- cellar
          return 'Somebody is down in the cellar, and this is a way up out of it.'; -- cellar
        end if; -- cellar
        return null; -- cellar
      end if; -- cellar
      if f.kind <> 'roof' and exists (
          select 1 from (values ('n'), ('e'), ('s'), ('w')) as s(side)
          cross join lateral border_of(tx, ty, s.side) bd
          join wall w2 on w2.world_id = p_world and w2.level = lvl
            and w2.dir = bd.dir and w2.x = bd.x and w2.y = bd.y) then
        return 'Take down the walls standing on it first.';
      end if;
      -- Piers: a deck holds up whatever stands or lies on it, and whoever is taking it up (`deck_refusal`).
      v_gap := deck_refusal(p_world, p_uid, lvl, tx, ty);
      if v_gap is not null then return v_gap; end if;
      return null;
    end if;
    if not found then return 'There is nothing planned here.'; end if;
    if bill_done(f.needed) then return 'That is already finished.'; end if;
    select * into mat from build_material_def where id = f.material;
    tool := need_tool(p_world, p_uid, case when f.kind = 'ladder' then 'mallet' else mat.tool end);
    if tool is not null then return tool; end if;
    if next_material(p_world, p_uid, f.material, f.needed, tx, ty) is null then
      return 'You need ' || bill_text(f.material, f.needed) || '.';
    end if;
    return null;

  elsif p_action in ('paint_wall', 'strip_wall_paint') then
    if side is null then return 'Choose a side.'; end if;
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    if w.world_id is null then return 'There is no wall there.'; end if;
    if p_action = 'strip_wall_paint' then
      if w.dye is null then return 'It has taken no colour.'; end if;
      if pack_count(p_world, p_uid, 'lye_bucket') <= 0 then return 'You need a bucket of lye to scrub it back.'; end if;
      return null;
    end if;
    if not bill_done(w.needed) then return 'Finish it before you paint it.'; end if;
    pot := pick_dye(p_world, p_uid);
    if pot.id is null then return 'You have no dye. Boil one out of berries, acorns or herbs with a bucket of lye.'; end if;
    select * into colour from dye_def where name = pot.extra;
    if w.dye = colour.id then return 'It is ' || colour.word || ' already.'; end if;
    return null;

  elsif p_action = 'paint_floor' then
    if b.id is null then return 'There is no floor here.'; end if;
    lvl := frame_job_level(b, p_target);  -- Frame: on the job's storey.
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found then return 'There is no floor here.'; end if;
    if not bill_done(f.needed) then return 'Finish it before you paint it.'; end if;
    pot := pick_dye(p_world, p_uid);
    if pot.id is null then return 'You have no dye. Boil one out of berries, acorns or herbs with a bucket of lye.'; end if;
    select * into colour from dye_def where name = pot.extra;
    if f.dye = colour.id then return 'It is ' || colour.word || ' already.'; end if;
    return null;

  /*
   * A Mason's Repoint, in the browser's words: a finished wall of stone, a
   * stone to lay it in that is not what it is, and everything to hand -- and
   * what is under it has to carry the new stone and the new stone what stands
   * on it, and stand as many storeys as the building has.
   */
  elsif p_action = 'repoint_wall' then
    if pk(p_world, p_uid, 'repoint', 0) <= 0 then return 'That wants a Mason who has learned to repoint.'; end if;
    if side is null then return 'Choose a side.'; end if;
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    if w.world_id is null then return 'There is no wall there.'; end if;
    select * into v_was from build_material_def where id = w.material;
    if v_was.kind is distinct from 'stone' then return 'Only a wall of stone is repointed.'; end if;
    if not bill_done(w.needed) then return 'Finish it before you repoint it.'; end if;
    if mat.id is null or mat.kind <> 'stone' then return 'Choose the stone to lay it in.'; end if;
    if mat.id = v_was.id then return 'It is ' || lower(mat.name) || ' already.'; end if;
    tool := need_tool(p_world, p_uid, mat.tool);
    if tool is not null then return tool; end if;
    if b.id is not null and w.building = b.id then
      -- Piers: a building on piers stands on its decks, which carry what they are laid in (`deck_carries`).
      v_gap := case when b.deck is not null then deck_carries(p_world, b.id, mat.id) end;
      if v_gap is not null then return v_gap; end if;
      bears := bearing(p_world, b.id, w.level);
      if mat.heft > bears then
        return mat.name || ' is too heavy to raise over what is under it. This storey carries '
            || heft_word(bears) || ', no more.';
      end if;
      select max(m2.heft) into v_over from wall w2 join build_material_def m2 on m2.id = w2.material
       where w2.world_id = p_world and w2.building = b.id and w2.level > w.level;
      if mat.heft < coalesce(v_over, 0) then
        return mat.name || ' will not carry the ' || heft_word(v_over) || ' standing on it.';
      end if;
      v_stands := mat.storeys + floor(pk(p_world, p_uid, 'storeys:' || build_work(mat.kind), 0))::int;
      if b.levels > v_stands then
        return mat.name || ' will not stand ' || b.levels || ' storeys. ' || v_stands || ' is as high as it goes.';
      end if;
    end if;
    v_bill := scaled_bill(mat.id, coalesce((select t2.factor::text::float8 from wall_type_def t2 where t2.id = w.type), 1));
    if exists (select 1 from jsonb_each_text(v_bill) e
                where build_to_hand(p_world, p_uid, e.key, tx, ty, mat.id) < e.value::int) then
      return 'You need ' || bill_text(mat.id, v_bill) || '.';
    end if;
    return null;

  elsif p_action = 'remove_storey' then
    if b.id is null or b.levels <= 1 then return 'There is no upper storey.'; end if;
    lvl := b.levels - 1;
    if has_roof(p_world, b.id) then return 'Take the roof off first.'; end if;
    if exists (select 1 from wall where world_id = p_world and building = b.id and level = lvl) then
      return 'Take down the walls of the top storey first.';
    end if;
    if exists (select 1 from floor_tile where world_id = p_world and building = b.id and level = lvl) then
      return 'Tear up the floors of the top storey first.';
    end if;
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_building(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare shape text; pot item; colour dye_def; tx int; ty int; side text; b building; w wall; f floor_tile; mat build_material_def;
        wt wall_type_def; lvl int; kind text; used text; nm text;
        sk text; bill jsonb; other record; what text; new_id int;
        v_laid text[]; v_i int; v_stone text; v_back int; v_was build_material_def; v_total jsonb;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  side := p_target->>'side';
  select * into b from building where world_id = p_world and id = building_at(p_world, tx, ty);
  -- Frame: a storey job out past the footprint is for the building it names, and columns are frame's (`perform_frame`).
  b := frame_building(p_world, p_action, p_target, b);
  if frame_action(p_action) then perform perform_frame(p_world, p_uid, p_action, p_target, b); return; end if;

  if p_action = 'plan_building' then
    nm := left(coalesce(nullif(btrim(coalesce(p_target->>'name', '')), ''), 'House'), 32);
    select coalesce(max(id), 0) + 1 into new_id from building where world_id = p_world;
    insert into building (world_id, id, name, planned_by) values (p_world, new_id, nm, p_uid);
    insert into building_tile (world_id, building, x, y) values (p_world, new_id, tx, ty);
    -- Piers: on piers, where the ground is not level (`stand_on_piers`).
    perform tell(p_world, p_uid, coalesce(stand_on_piers(p_world, p_uid, new_id, tx, ty, true),
      'You plan ' || nm || ' here. Extend it onto neighbouring flat packed '
      || 'tiles, then plan walls on its borders.'), 'event');

  elsif p_action = 'add_to_building' then
    select * into b from building where world_id = p_world and id = neighbour_building(p_world, tx, ty);
    if not found then return; end if;
    insert into building_tile (world_id, building, x, y) values (p_world, b.id, tx, ty)
      on conflict do nothing;
    -- Piers: under its deck, where the ground is not level with its floor (`stand_on_piers`).
    perform tell(p_world, p_uid, coalesce(stand_on_piers(p_world, p_uid, b.id, tx, ty, false),
      'You add the tile to ' || b.name || '.'), 'event');

  elsif p_action = 'remove_from_plan' then
    if b.id is null then return; end if;
    delete from building_tile where world_id = p_world and x = tx and y = ty;
    if exists (select 1 from building_tile where world_id = p_world and building = b.id) then
      perform tell(p_world, p_uid, 'You remove the tile from ' || b.name || '.', 'event');
    else
      -- The last tile of a plan is the plan.
      delete from building where world_id = p_world and id = b.id;
      perform tell(p_world, p_uid, 'You remove the last of ' || b.name || '''s plan.', 'event');
    end if;

  elsif p_action = 'rename_building' then
    if b.id is null then return; end if;
    nm := left(btrim(p_target->>'name'), 32);
    update building set name = nm where world_id = p_world and id = b.id;
    perform tell(p_world, p_uid, 'The building is now called ' || nm || '.', 'event');

  elsif p_action in ('plan_wall', 'plan_fence') then
    select * into wt from wall_type_def where id = p_target->>'wallType';
    select * into mat from build_material_def where id = p_target->>'material';
    lvl := case when p_action = 'plan_fence' then 0 else frame_wall_level(p_world, tx, ty, p_target) end;  -- Frame: a jetty's storey, or round a terrace.
    -- A fence, a gate or a half wall for less of its material: a Carpenter's Fence Builder.
    bill := wall_bill(mat.id, wt.id, case when wt.standalone then pk(p_world, p_uid, 'bill:fence', 1) else 1 end);
    insert into wall (world_id, level, dir, x, y, building, type, material, needed, total, planned_by)
    select p_world, lvl, bd.dir, bd.x, bd.y,
           case when p_action = 'plan_fence' then 0 else b.id end,
           wt.id, mat.id, bill, bill, p_uid
    from border_of(tx, ty, side) bd;
    if p_action = 'plan_fence' then
      perform tell(p_world, p_uid, 'You mark out a ' || lower(mat.name) || ' ' || lower(wt.name)
        || ' on the ' || side_name(side) || ' border. It needs ' || bill_text(mat.id, bill) || '.', 'event');
    else
      perform tell(p_world, p_uid, 'You plan a '
        || case when wt.id = 'railing' then lower(mat.name) || ' railing' else lower(wt.name) || ' ' || lower(mat.name) || ' wall' end  -- Frame: a railing named as one.
        || ' on the ' || side_name(side) || ' side. It needs ' || bill_text(mat.id, bill) || '.', 'event');
    end if;

  elsif p_action = 'build_wall' then
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    if w.world_id is null or bill_done(w.needed) then return; end if;
    select * into mat from build_material_def where id = w.material;
    -- A unit a go, or as many as a Mason's Two at a Time lays on stone.
    bill := w.needed;
    v_laid := '{}';
    for v_i in 1 .. greatest(1, floor(pk(p_world, p_uid, 'lay:' || build_work(mat.kind), 1))::int) loop
      exit when bill_done(bill);
      used := next_material(p_world, p_uid, w.material, bill, tx, ty);
      exit when used is null or not take_material(p_world, p_uid, used, tx, ty, w.material);
      bill := jsonb_set(bill, array[used], to_jsonb((bill->>used)::int - 1));
      v_laid := v_laid || used;
    end loop;
    if coalesce(array_length(v_laid, 1), 0) = 0 then return; end if;
    update wall set needed = bill where world_id = w.world_id and level = w.level
      and dir = w.dir and x = w.x and y = w.y;
    -- A shop counter's store opens as it is finished (`counters.ts`).
    if bill_done(bill) then perform counter_finished(p_world, w); end if;
    perform skill_raise(p_world, p_uid, mat.skill, 0.4);
    select * into wt from wall_type_def where id = w.type;
    if bill_done(bill) then
      what := case when wt.low then lower(wt.name) else 'wall' end;
      perform tell(p_world, p_uid, 'You finish the ' || lower(mat.name) || ' ' || what || '.', 'event');
    else
      perform tell(p_world, p_uid, 'You fit ' || laid_text(v_laid) || ' into the wall. Still needed: '
        || bill_text(w.material, bill) || '.', 'event');
    end if;

  elsif p_action = 'remove_wall' then
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    if w.world_id is null then return; end if;
    select * into wt from wall_type_def where id = w.type;
    select * into mat from build_material_def where id = w.material;
    -- A Mason's Salvage: a share of the stone laid in it -- the first thing on
    -- its material's bill, not the mortar -- rounded down.
    v_stone := (select b2.item from build_material_bill b2 where b2.material = w.material order by b2.ord limit 1);
    v_back := floor(greatest(0, coalesce((w.total->>v_stone)::int, 0) - coalesce((w.needed->>v_stone)::int, 0))
                    * pk(p_world, p_uid, 'salvage:' || build_work(mat.kind), 0))::int;
    perform counter_gone(p_world, w);
    delete from wall where world_id = w.world_id and level = w.level and dir = w.dir and x = w.x and y = w.y;
    if v_back > 0 then perform give(p_world, p_uid, v_stone, v_back, 20); end if;
    perform tell(p_world, p_uid, 'You take down the '
      || case when wt.low then lower(wt.name) else 'wall' end
      || ' on the ' || side_name(side) || ' side'
      || case when v_back > 0 then ' and save ' || v_back || ' ' || material_name(v_stone, v_back) else '' end
      || '.', 'event');

  /*
   * A Mason's Repoint: a finished stone wall laid again in another stone, in
   * one go. The new stone's bill without the fittings is paid out of whatever
   * a wall may be built out of, the fittings stay, a share of the old stone
   * comes back, and the paint goes with the old face. `build_refusal` has
   * already asked that every unit of it is to hand.
   */
  elsif p_action = 'repoint_wall' then
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    select * into mat from build_material_def where id = p_target->>'material';
    select * into v_was from build_material_def where id = w.material;
    if w.world_id is null or mat.id is null or v_was.id is null then return; end if;
    bill := scaled_bill(mat.id, coalesce((select t2.factor::text::float8 from wall_type_def t2 where t2.id = w.type), 1));
    for other in select e.key, e.value::int as n from jsonb_each_text(bill) e loop
      for v_i in 1 .. other.n loop
        if not take_material(p_world, p_uid, other.key, tx, ty, mat.id) then return; end if;
      end loop;
    end loop;
    v_stone := (select b2.item from build_material_bill b2 where b2.material = v_was.id order by b2.ord limit 1);
    v_back := floor(coalesce((w.total->>v_stone)::int, 0) * repoint_back())::int;
    if v_back > 0 then perform give(p_world, p_uid, v_stone, v_back, 20); end if;
    v_total := wall_bill(mat.id, w.type);
    update wall set material = mat.id, total = v_total, dye = null,
           needed = (select jsonb_object_agg(k, 0) from jsonb_object_keys(v_total) k)
     where world_id = w.world_id and level = w.level and dir = w.dir and x = w.x and y = w.y;
    perform skill_raise(p_world, p_uid, 'masonry', 1);
    perform tell(p_world, p_uid, 'You take the ' || lower(v_was.name) || ' out of the wall on the '
      || side_name(side) || ' side and lay it again in ' || lower(mat.name)
      || case when v_back > 0 then ', and save ' || v_back || ' ' || material_name(v_stone, v_back) else '' end
      || '.', 'event');

  elsif p_action = 'add_floor' then
    if b.id is null then return; end if;
    update building set levels = levels + 1, work_level = levels
      where world_id = p_world and id = b.id returning * into b;
    perform tell(p_world, p_uid, 'You plan storey ' || b.levels || ' of ' || b.name
      || '. Plan and build its floor tiles, then raise walls on them.', 'event');

  elsif p_action = 'plan_floor' then
    if b.id is null then return; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := frame_floor_level(p_world, b.id, kind, p_target); -- cellar: storey nought for a flight down; Frame: else the job's storey.
    select * into mat from build_material_def where id = p_target->>'material';
    /*
     * A building has one roof, so the first tile of it decides the shape and
     * the rest follow. Changing your mind means taking the roof off, which is
     * what changing your mind about a roof means anywhere.
     */
    if kind = 'roof' and (select roof from building where world_id = p_world and id = b.id) is null then
      update building set roof = coalesce(
          (select id from roof_shape_def where id = p_target->>'roofShape'), 'hip')
        where world_id = p_world and id = b.id;
    end if;
    shape := roof_shape_of(p_world, b.id);
    bill := floor_bill(mat.id, kind, shape);
    -- Piers: and the piers under a deck (`deck_bill`).
    bill := deck_bill(p_world, tx, ty, lvl, kind, mat.id, bill);
    -- cellar: a flight or a ladder down takes up the ground floor's flooring where it goes.
    if lvl = 0 and kind in ('stairs', 'ladder') then -- cellar
      delete from floor_tile where world_id = p_world and level = 0 and x = tx and y = ty and floor_tile.kind = 'floor'; -- cellar
      if found then perform tell(p_world, p_uid, 'You take up the flooring there.', 'event'); end if; -- cellar
    end if; -- cellar
    insert into floor_tile (world_id, level, x, y, building, material, kind, facing, needed, total, planned_by)
    values (p_world, lvl, tx, ty, b.id, mat.id, kind,
            case when kind in ('stairs', 'ladder') then side end, bill, bill, p_uid);
    perform tell(p_world, p_uid, 'You plan a '
      || case when kind = 'ladder' then 'ladder'
              else case when kind = 'roof'
                        then lower((select name from roof_shape_def where id = shape)) || ' ' else '' end
                   -- Piers: a deck on piers (`floor_kind_said`).
                   || lower(mat.name) || ' ' || floor_kind_said(p_world, tx, ty, lvl, kind) end
      || '. It needs ' || bill_text(mat.id, bill) || '.', 'event');

  elsif p_action = 'build_floor' then
    if b.id is null then return; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := frame_floor_level(p_world, b.id, kind, p_target); -- cellar: storey nought for a flight down; Frame: else the job's storey.
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found or bill_done(f.needed) then return; end if;
    select * into mat from build_material_def where id = f.material;
    -- A unit a go, or as many as a Mason's Two at a Time lays on stone.
    bill := f.needed;
    v_laid := '{}';
    for v_i in 1 .. greatest(1, floor(pk(p_world, p_uid, 'lay:' || build_work(mat.kind), 1))::int) loop
      exit when bill_done(bill);
      used := next_material(p_world, p_uid, f.material, bill, tx, ty);
      exit when used is null or not take_material(p_world, p_uid, used, tx, ty, f.material);
      bill := jsonb_set(bill, array[used], to_jsonb((bill->>used)::int - 1));
      v_laid := v_laid || used;
    end loop;
    if coalesce(array_length(v_laid, 1), 0) = 0 then return; end if;
    update floor_tile set needed = bill where world_id = p_world and level = lvl and x = tx and y = ty;
    -- Floors are paving; stairs, ladders and roofs are carpentry or masonry by material.
    sk := case f.kind when 'floor' then 'paving' when 'ladder' then 'carpentry'
                      else coalesce(mat.skill, 'carpentry') end;
    perform skill_raise(p_world, p_uid, sk, 0.4);
    what := case when f.kind = 'ladder' then 'ladder' else lower(mat.name) || ' ' || floor_kind_name(f.kind) end;
    if bill_done(bill) then
      perform tell(p_world, p_uid, 'You finish the ' || what || '.', 'event');
    else
      perform tell(p_world, p_uid, 'You work ' || laid_text(v_laid) || ' into the '
        || floor_kind_name(f.kind) || '. Still needed: ' || bill_text(f.material, bill) || '.', 'event');
    end if;

  elsif p_action = 'remove_floor' then
    if b.id is null then return; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := frame_floor_level(p_world, b.id, kind, p_target); -- cellar: storey nought for a flight down; Frame: else the job's storey.
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found then return; end if;
    delete from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    -- Anybody standing on what was just torn up goes down a storey, not through it.
    if lvl > 0 then
      update player set level = lvl - 1
        where world_id = p_world and floor(x)::int = tx and floor(y)::int = ty and level >= lvl;
    end if;
    perform tell(p_world, p_uid, 'You remove the ' || floor_kind_name(f.kind) || '.', 'event');

  elsif p_action = 'paint_wall' then
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    if w.world_id is null then return; end if;
    pot := pick_dye(p_world, p_uid);
    select * into colour from dye_def where name = pot.extra;
    if colour.id is null or not consume(p_world, p_uid, 'dye', 1) then return; end if;
    update wall set dye = colour.id where world_id = p_world and level = w.level
      and dir = w.dir and x = w.x and y = w.y;
    perform skill_raise(p_world, p_uid, 'alchemy', 0.3);
    perform tell(p_world, p_uid, 'You brush the ' || lower(colour.name) || ' over the wall on the '
      || side_name(side) || ' side. It comes up ' || colour.word || '.', 'event');

  elsif p_action = 'strip_wall_paint' then
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    if w.world_id is null or w.dye is null then return; end if;
    select * into pot from item where world_id = p_world and holder = 'player'
      and holder_uid = p_uid and def = 'lye_bucket' order by id limit 1;
    if pot.id is null or not consume(p_world, p_uid, 'lye_bucket', 1) then return; end if;
    perform give(p_world, p_uid, 'bucket', 1, pot.ql);
    update wall set dye = null where world_id = p_world and level = w.level
      and dir = w.dir and x = w.x and y = w.y;
    perform skill_raise(p_world, p_uid, 'alchemy', 0.2);
    select * into mat from build_material_def where id = w.material;
    perform tell(p_world, p_uid, 'You scrub the wall back to bare '
      || coalesce(lower(mat.name), 'stone') || '.', 'event');

  elsif p_action = 'paint_floor' then
    if b.id is null then return; end if;
    lvl := frame_job_level(b, p_target);  -- Frame: on the job's storey.
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found then return; end if;
    pot := pick_dye(p_world, p_uid);
    select * into colour from dye_def where name = pot.extra;
    if colour.id is null or not consume(p_world, p_uid, 'dye', 1) then return; end if;
    update floor_tile set dye = colour.id where world_id = p_world and level = lvl and x = tx and y = ty;
    perform skill_raise(p_world, p_uid, 'alchemy', 0.3);
    perform tell(p_world, p_uid, 'You work the ' || lower(colour.name)
      || ' into the boards. The floor comes up ' || colour.word || '.', 'event');

  elsif p_action = 'remove_storey' then
    if b.id is null or b.levels <= 1 then return; end if;
    update building set levels = levels - 1, work_level = levels - 2
      where world_id = p_world and id = b.id returning * into b;
    perform tell(p_world, p_uid, b.name || ' is back to '
      || case when b.levels = 1 then 'a single storey' else b.levels || ' storeys' end || '.', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_ground(p_world uuid, p_range double precision DEFAULT 40, p_slow boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player; v_field double precision; v_box double precision;
        -- When greening came to this island (`greening.ts`).
        v_from timestamptz := (select w.green_from from world w where w.id = p_world);
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  /*
   * On the slow half only, because this writes.
   *
   * The fast read runs about once a second per body — everything burning, what
   * is on the tile under you — and a settle on that path is an update a second
   * per player whether or not anything is due. The crops ride the slow half
   * beside the settlements, and any of your own work forces one of those, so
   * sowing is seen at once and a stage is at worst one reconcile late.
   */
  if p_slow then
    perform crops_settle(p_world, p.x, p.y, p_range);
    perform planters_settle(p_world, p.x, p.y, p_range);
    -- Each clock read once, for every crop on it.
    v_field := crop_clock(false, now());
    v_box := crop_clock(true, now());
  end if;
  return jsonb_build_object(
    'placed', coalesce((select jsonb_agg(
        (to_jsonb(pl) - 'world_id' - 'made_by' - 'since' - 'made_at' - 'cx' - 'cy' - 'crumbles_at')
        || jsonb_build_object('fuel', placed_fuel(pl), 'ash', placed_ash(pl),
                              'lit', placed_lit(pl), 'mine', coalesce(pl.made_by = me, false),
        /*
         * And what is in it, which this never said.
         *
         * Reported as "i opened it and dragged my dirt into it and the dirt
         * vanished". It had not: the island had the dirt in the bin and told
         * nobody. Every chest, bin, larder and cart on an island read as
         * empty over there, so anything put away went out of the pack and was
         * never seen again — the same hole a crate fell down before crates
         * carried their contents, and closed the same way. Within six tiles
         * only: you must be within two and a half to reach into one, so six
         * is generous, and a yard of full chests is not worth a phone's
         * second.
         */
                              'things', case when pl.kind = 'furniture'
                                              and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= 6
                                              -- A grave's, to whoever lies under it and nobody else.
                                              and (pl.crumbles_at is null or pl.made_by = me)
                                then coalesce((select jsonb_agg(jsonb_build_object(
                                       'id', i.id, 'def', i.def, 'ql', i.ql, 'dmg', i.dmg,
                                       'count', i.count, 'extra', i.extra) order by i.id)
                                     from item i
                                     where i.world_id = p_world and i.holder = 'furniture' and i.placed = pl.id),
                                   '[]'::jsonb)
                                else '[]'::jsonb end)
        /*
         * Whether a helm is as good as empty, its holder gone away, and who is
         * aboard as a passenger and in which place: only for a piece that has
         * either, so nothing else carries two more keys it does not need.
         */
        || case when pl.driver is null then '{}'::jsonb
                else jsonb_build_object('helm_open', coalesce((select r.away from player r
                       where r.world_id = p_world and r.uid = pl.driver), true)) end
        || coalesce((select jsonb_build_object('riders', jsonb_agg(jsonb_build_object('uid', r.uid, 'seat', r.seat)
                       order by r.seat))
                     from player r where r.world_id = p_world and r.aboard = pl.id
                     having count(*) > 0), '{}'::jsonb)
        /*
         * And a grave: whose it is, for what anybody else is told when they
         * try it; the seconds it has left, which a browser counts down on its
         * own clock rather than reading this island's; and, to its owner, how
         * many things are in it, which `things` only says from within reach --
         * the way `units` rides beside a crate's contents.
         */
        || case when pl.crumbles_at is null then '{}'::jsonb
                else jsonb_build_object('grave', jsonb_build_object('name', grave_owner(pl),
                       'left', greatest(0, extract(epoch from (pl.crumbles_at - now()))),
                       'units', case when pl.made_by = me then (select coalesce(sum(i.count), 0) from item i
                                  where i.placed = pl.id and i.holder = 'furniture') end)) end
        /*
         * And for a piece with roses on it, the moment it was set down, which
         * is what its roses grow from (`roses.ts`): the same moment for
         * everybody, and sent for nothing else.
         */
        || case when coalesce((select fd.roses from furniture_def fd where fd.id = pl.sub), false)
                then jsonb_build_object('set', extract(epoch from pl.made_at)) else '{}'::jsonb end
        /*
         * And for a piece that gathers moss -- a statue -- the seconds since
         * the moss on it began: since it was set down or last scrubbed, and
         * never from before greening came in (`greening.ts`). Only for those,
         * so nothing else carries a key it does not need.
         */
        || case when pl.kind = 'furniture' and pl.sub in (select fd.id from furniture_def fd where fd.mossy)
                then jsonb_build_object('green_ago', green_ago(greatest(pl.made_at,
                       (select gs.since from green_since gs where gs.world_id = p_world and gs.thing = 'piece'
                           and gs.x = pl.x and gs.y = pl.y and gs.k = pl.id)), v_from))
                else '{}'::jsonb end
        -- And for a shop counter's store, what is set out on it and for whom (`counters.ts`).
        || case when pl.kind = 'counter' then counter_json(pl, me, p.x, p.y) else '{}'::jsonb end
        order by pl.id)
      from placed pl
      where pl.world_id = p_world
        -- The box first, in the whole tiles `placed_near` is keyed on, and then
        -- the exact question. A btree cannot look up a function of a column, so
        -- the exact test on its own read every placed thing on the island, on
        -- every ground poll, for every player. `x` is `floor(cx)` and `y` is
        -- `floor(cy)` -- `drag_along` and every placing write both together --
        -- so a tile of slack each way makes the box a superset of the answer
        -- and the line below still decides who is in it.
        and pl.x between floor(p.x - p_range)::int - 1 and floor(p.x + p_range)::int + 1
        and pl.y between floor(p.y - p_range)::int - 1 and floor(p.y + p_range)::int + 1
        and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= p_range), '[]'::jsonb),
    'crates', crates_near(p_world, me, p_range),
    /*
     * And what is lying on the ground, which this never carried.
     *
     * Reported as "killed a roxxa, no corpse dropped to butcher, or at least
     * isn't displaying". The corpse was there: `wound_beast` drops one where
     * the thing fell, and the suite has measured it since kills were ported.
     * This sent the fires, the crates, the crops and the walls, and never a
     * thing lying on the grass — and the browser's map of the ground was only
     * ever written by its own rules, which do not run on an island. So a
     * corpse, a log a worker put down, a hatchet somebody else dropped: all
     * in this table and drawn by nobody.
     *
     * On the fast half, because a corpse is looked for the second the thing
     * goes down; `item_on_ground` serves the box. The whole row, the way the
     * pack is sent, so the browser reads it with the same map.
     */
    'lying', coalesce((select jsonb_agg(to_jsonb(i) - 'world_id' order by i.id)
      from item i
      where i.world_id = p_world and i.holder = 'ground'
        and i.gx between floor(p.x - p_range)::int and floor(p.x + p_range)::int
        and i.gy between floor(p.y - p_range)::int and floor(p.y + p_range)::int), '[]'::jsonb),
    -- cellar: and what is lying on the floors of the cellars in range, the same way (`item_in_cellar` serves the box).
    'cellarLying', coalesce((select jsonb_agg(to_jsonb(i) - 'world_id' order by i.id) from item i -- cellar
      where i.world_id = p_world and i.holder = 'cellar' -- cellar
        and i.gx between floor(p.x - p_range)::int and floor(p.x + p_range)::int -- cellar
        and i.gy between floor(p.y - p_range)::int and floor(p.y + p_range)::int), '[]'::jsonb))
  /*
   * And the half that hardly ever moves.
   *
   * A fire burns down and a kiln works through its load while you stand and
   * watch it, which is why this is asked for every second. A wall is not like
   * that: it goes up when somebody builds it and then it is a wall. Sending
   * both at one pace meant a correlated subquery over `building_tile` per
   * building, a scan of `wall` and one of `floor_tile`, every second for every
   * player, to say that the house is still a house.
   *
   * So the caller says whether it wants them. A browser asks for the lot on
   * its twenty-second reconcile and after any of its own work, and for the
   * burning half the rest of the time. Left out rather than emptied: the
   * browser applies only the keys it is given, so what it holds stands.
   *
   * `p_slow` defaults true, so a page that has not been redeployed gets
   * exactly what it always got.
   */
  || case when not p_slow then '{}'::jsonb else jsonb_build_object(
    /*
     * And everybody ashore, on the slow half, which is the beat that already
     * carries the settlements. The map draws them; `folk_ashore` decides
     * whether there is anything to draw them at.
     */
    'folk', folk_ashore(p_world, me),
    /*
     * And every grave of yours, however far off: you wake a long way from
     * where you fell, and `placed` above is only what is in range. The map
     * marks them and takes the mark up when one goes. Off the index the
     * sweep uses, which holds nothing but graves.
     */
    'graves', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'x', g.x, 'y', g.y) order by g.id)
      from placed g
      where g.world_id = p_world and g.crumbles_at is not null and g.made_by = me), '[]'::jsonb),
    /*
     * What is growing here, settled first so the stage reported is the stage
     * it is actually at rather than the stage it was at when somebody last
     * touched it. Everything on this island settles lazily off a timestamp,
     * and for a crop nobody had ever been the one to ask.
     *
     * `grown` rather than `stage_at`: how far into its stage it has grown, in
     * growing seconds on the clock it grows on, which the browser lays on its
     * own reading of the same clock -- a winter between the stage's start and
     * now adds nothing to it. `ago`, the wall seconds, is what a page from
     * before the year reads.
     */
    'crops', coalesce((select jsonb_agg(jsonb_build_object(
        'x', c.x, 'y', c.y, 'id', c.id, 'stage', c.stage,
        'grown', crop_grown(c.glass, c.stage_at, v_field),
        'ago', extract(epoch from (now() - c.stage_at)),
        'tended', c.tended, 'tendedNow', c.tended_now, 'ql', c.ql, 'pace', c.pace)
        -- And a crop under glass says so, and `grown` is on the glass clock (`glasshouse.ts`).
        || case when c.glass then '{"glass": true}'::jsonb else '{}'::jsonb end)
      from crop c
      where c.world_id = p_world
        and greatest(abs(c.x + 0.5 - p.x), abs(c.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    -- And what grows in the planters, by the piece, on the planter's own clock.
    'planted', coalesce((select jsonb_agg(jsonb_build_object(
        'planter', c.placed, 'x', pl.x, 'y', pl.y, 'id', c.id, 'stage', c.stage,
        'grown', v_box - crop_clock(true, c.stage_at),
        'ago', extract(epoch from (now() - c.stage_at)),
        'tended', c.tended, 'tendedNow', c.tended_now, 'ql', c.ql, 'pace', c.pace) order by c.placed)
      from placed pl join planter_crop c on c.placed = pl.id
      where pl.world_id = p_world
        and pl.x between floor(p.x - p_range)::int - 1 and floor(p.x + p_range)::int + 1
        and pl.y between floor(p.y - p_range)::int - 1 and floor(p.y + p_range)::int + 1
        and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= p_range), '[]'::jsonb),
    -- And the island's wall clock, which a field's clock is read off, so the browser reads it off the same one.
    'now', extract(epoch from now())::double precision,
    /*
     * The felling notches near you, and how long ago the woods last turned
     * over. Look reads both: "2 of 3 strokes in it", "the woods turn over in
     * 9 hours". A browser on an island keeps no clock of its own for the
     * woods, so this is the only place it hears the hour.
     */
    /*
     * The water lilies and lotus planted near you: when each was planted and
     * last picked, which is all of one. The browser works out the rest from
     * the year, as `water_plant_state` does.
     */
    'waterPlants', water_plants_near(p_world, p.x, p.y, p_range),
    'notches', coalesce((select jsonb_agg(jsonb_build_object('x', n.x, 'y', n.y, 'cuts', n.cuts))
      from tree_notch n
      where n.world_id = p_world
        and greatest(abs(n.x + 0.5 - p.x), abs(n.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    'treesAgo', (select extract(epoch from (now() - w.trees_at)) from world w where w.id = p_world),
    -- The mark the ground is being worked to, which lives on the player row
    -- so that it is the same mark in every browser you open.
    'level', p.level_h,
    -- What you are on each of them, so the browser can say what you may do
    -- rather than finding out by being refused. Your own first one is your
    -- own or one you were asked onto; either way `deed_role` says which.
    'deed', (select jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level, 'mine', true,
        'role', deed_role(p_world, d.founded_by, me),
        'baubles', deed_baubles_json(p_world, d.founded_by))
      from my_deed(p_world, me) d where d.world_id is not null),
    'deeds', coalesce((select jsonb_agg(jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level,
        -- Land you were asked onto is land you may work, so it is drawn as
        -- yours rather than as a stranger's border you happen to be inside.
        'mine', exists (select 1 from deed_member m where m.world_id = p_world
                          and m.uid = me and m.founder = d.founded_by),
        'role', deed_role(p_world, d.founded_by, me),
        'holder', account_name(d.founded_by),
        -- And what is in its altar, for the settlements you are a citizen of.
        'baubles', case when exists (select 1 from deed_member m where m.world_id = p_world
                                       and m.uid = me and m.founder = d.founded_by)
                        then deed_baubles_json(p_world, d.founded_by) end) order by d.founded_at)
      from deed d
      where d.world_id = p_world and d.founded_by <> me
        and greatest(abs(d.x + 0.5 - p.x), abs(d.y + 0.5 - p.y)) <= p_range + d.radius),
      '[]'::jsonb),
    /*
     * And what is standing.
     *
     * `building`, `wall` and `floor_tile` have been kept here since buildings
     * were ported and have never been sent to anybody. The rules answered
     * about them, a plan went up in Postgres, and no browser ever drew a wall
     * of it — so on an island a building was invisible to everyone, the person
     * who planned it included.
     *
     * Shaped as the browser's own `BuildingsJSON`, so it is laid straight in.
     * A building comes along whole if any of its tiles is in range: half a
     * house is worse than none, and a house is a handful of rows.
     */
    'buildings', jsonb_build_object(
      -- cellar: what is dug out under the buildings sent (`BuildingsJSON.cellars`).
      'cellars', cellars_near(p_world, p.x, p.y, p_range),
      'nextId', coalesce((select max(b.id) + 1 from building b where b.world_id = p_world), 1),
      'list', coalesce((select jsonb_agg(jsonb_build_object(
          'id', b.id, 'name', b.name, 'levels', b.levels, 'workLevel', b.work_level,
          -- Frame: the shape of its roof, which says whether it is a terrace to rail.
          'roof', b.roof,
          'tiles', (select coalesce(jsonb_agg(bt.x || ',' || bt.y order by bt.y, bt.x), '[]'::jsonb)
                      from building_tile bt
                     where bt.world_id = p_world and bt.building = b.id))
          -- Piers: and its deck and its tiles on piers, if it has any (`piers_json`).
          || piers_json(p_world, b.id, b.deck) order by b.id)
        from building b
        where b.world_id = p_world
          and exists (select 1 from building_tile bt
                       where bt.world_id = p_world and bt.building = b.id
                         and greatest(abs(bt.x + 0.5 - p.x), abs(bt.y + 0.5 - p.y)) <= p_range)),
        '[]'::jsonb),
      'walls', coalesce((select jsonb_agg(jsonb_build_object(
          'building', w.building, 'level', w.level, 'x', w.x, 'y', w.y, 'dir', w.dir,
          'type', w.type, 'material', w.material, 'needed', w.needed, 'total', w.total,
          -- And the seconds since the ivy on a finished wall of stone or brick began (`greening.ts`).
          'greenAgo', case when bill_done(w.needed) and m.kind = 'stone' then green_ago(gs.since, v_from) end)
          order by w.level, w.dir, w.x, w.y)
        from wall w
        left join build_material_def m on m.id = w.material
        left join green_since gs on gs.world_id = p_world and gs.thing = 'wall' and gs.x = w.x and gs.y = w.y
                                and gs.k = green_wall_k(w.level, w.dir)
        where w.world_id = p_world
          and greatest(abs(w.x + 0.5 - p.x), abs(w.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
      'floors', coalesce((select jsonb_agg(jsonb_build_object(
          'building', f.building, 'level', f.level, 'x', f.x, 'y', f.y,
          'material', f.material, 'kind', f.kind, 'facing', f.facing,
          'needed', f.needed, 'total', f.total) order by f.level, f.x, f.y)
        from floor_tile f
        where f.world_id = p_world
          and greatest(abs(f.x + 0.5 - p.x), abs(f.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
      -- Frame: the columns on the corners of its storeys.
      'columns', frame_columns_json(p_world, p.x, p.y, p_range)),
    /*
     * And the slabs, which are not buildings and do not go in with them: a
     * foundation is ground somebody poured, and the browser lays it beside the
     * terrain rather than inside a house.
     */
    'foundations', coalesce((select jsonb_agg(jsonb_build_object(
        'id', fo.id, 'x', fo.x, 'y', fo.y, 'top', fo.top, 'pool', fo.pool,
        'needed', fo.needed, 'total', fo.total,
        -- And the seconds since the moss on a poured one began.
        'greenAgo', case when bill_done(fo.needed) then green_ago(gs.since, v_from) end) order by fo.id)
      from foundation fo
      left join green_since gs on gs.world_id = p_world and gs.thing = 'slab' and gs.x = fo.x and gs.y = fo.y and gs.k = 0
      where fo.world_id = p_world
        and greatest(abs(fo.x + 0.5 - p.x), abs(fo.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    'nextFoundationId', coalesce((select max(fo.id) + 1 from foundation fo where fo.world_id = p_world), 1),
    /*
     * And the bridges, shaped as the browser's own `Bridge`, spans and all.
     *
     * The island has kept `bridge` and `bridge_span` since bridges were ported
     * and never said a word about one, so on an island a bridge was drawn by
     * nobody and walked by nobody: the browser decides where its feet go, and
     * it had never heard of the deck. One comes whole if either end is in
     * range, and a stone arch with the seconds since the moss on it began.
     */
    'bridges', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'kind', b.kind, 'ax', b.ax, 'ay', b.ay, 'bx', b.bx, 'by', b.by,
        'height', b.height, 'level', b.level, 'material', b.material,
        'spans', (select coalesce(jsonb_agg(jsonb_build_object('x', s.x, 'y', s.y, 'needed', s.needed, 'total', s.total)
                    order by s.n), '[]'::jsonb)
                  from bridge_span s where s.world_id = p_world and s.bridge = b.id),
        'greenAgo', case when b.kind in ('stone', 'aqueduct') and not exists (select 1 from bridge_span s
                           where s.world_id = p_world and s.bridge = b.id and not span_done(s.needed))
                         then green_ago(gs.since, v_from) end) order by b.id)
      from bridge b
      left join green_since gs on gs.world_id = p_world and gs.thing = 'bridge' and gs.x = b.ax and gs.y = b.ay and gs.k = b.id
      where b.world_id = p_world
        and (greatest(abs(b.ax + 0.5 - p.x), abs(b.ay + 0.5 - p.y)) <= p_range
             or greatest(abs(b.bx + 0.5 - p.x), abs(b.by + 0.5 - p.y)) <= p_range)), '[]'::jsonb),
    /*
     * And the paving: the seconds since greening came in, which is when every
     * paved tile without a row of its own began, and the tiles in range paved
     * or scrubbed since, off the key's own box.
     */
    'greenFromAgo', extract(epoch from (now() - v_from))::double precision,
    'paving', coalesce((select jsonb_agg(jsonb_build_object('x', gs.x, 'y', gs.y, 'ago', green_ago(gs.since, v_from)))
      from green_since gs
      where gs.world_id = p_world and gs.thing = 'paving'
        and gs.x between floor(p.x - p_range)::int and floor(p.x + p_range)::int
        and gs.y between floor(p.y - p_range)::int and floor(p.y + p_range)::int), '[]'::jsonb)) end;
end $function$;

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
  -- Frame: up a storey the edge of what is built there stops a body, railed or not (`frame_footing`).
  if p_level > 0 then share := least(share, frame_footing(p_world, p_level, p.x, p.y, p_x, p_y)); end if;
  if share < 1 then
    p_x := p.x + (p_x - p.x) * share;
    p_y := p.y + (p_y - p.y) * share;
    blocked := true;
  end if;
  -- cellar: a body in a cellar, or going into or out of one, is held to its floor and its way down.
  if (p_level < 0 or p.level < 0) and not cellar_move_ok(p_world, me, p.level, p_level, p.x, p.y, p_x, p_y) then
    p_x := p.x; p_y := p.y; p_level := p.level; blocked := true;
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
    /*
     * And the wear those feet put on the ground: a point on every tile of
     * grass, lawn, steppe, tundra or moss stepped into, and a trail at
     * `wear_trail` (`wear_walk`). Nothing at all unless the walk left the
     * tile it started in, which is four calls in five: a straight line cannot
     * leave a tile and come back into it. And then one small row a tile.
     */
    if floor(p_x) <> floor(p.x) or floor(p_y) <> floor(p.y) then
      perform wear_walk(p_world, p.x, p.y, p_x, p_y);
    end if;
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

CREATE OR REPLACE FUNCTION public.corner_under_building(p_world uuid, p_cx integer, p_cy integer)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  -- cellar: the ground over a cellar is left as it is while the cellar is there, said first (`CELLAR_UNDER`).
  select case when exists (select 1 from cellar_tile c where c.world_id = p_world
                             and c.x between p_cx - 1 and p_cx and c.y between p_cy - 1 and p_cy)
              then 'There is a cellar dug out under that ground. The ground over a cellar is not dug, raised or levelled while the cellar is there.'
              when exists (select 1 from generate_series(p_cx - 1, p_cx) x
                             cross join generate_series(p_cy - 1, p_cy) y
                           where building_at(p_world, x, y) is not null
                              -- Frame: and the ground under a jetty (`frame_jetty_of`).
                              or frame_jetty_of(p_world, x, y) is not null)
              then 'You cannot dig under a building.' end
$function$;

CREATE OR REPLACE FUNCTION public.bridge_reason(p_world uuid, p_uid uuid, p_kind text, p_ax integer, p_ay integer, p_bx integer, p_by integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare d bridge_def; n int; ha double precision; hb double precision; h int; r record; e record;
        la int; lb int;
begin
  select * into d from bridge_def where id = p_kind;
  if not found then return 'Choose what to build it out of.'; end if;
  if not in_bounds(p_world, p_ax, p_ay) or not in_bounds(p_world, p_bx, p_by) then return 'Not there.'; end if;
  if p_ax <> p_bx and p_ay <> p_by then
    return 'A bridge runs straight. Pick an end level with this one, north, south, east or west.';
  end if;
  select count(*)::int into n from span_tiles(p_ax, p_ay, p_bx, p_by);
  if n = 0 then return 'There is nothing between those two. Bridge a gap.'; end if;
  -- A Mason's Bridge Mason carries a stone arch further (`span:bridge_stone`).
  if n > pk(p_world, p_uid, 'span:' || ('bridge_' || p_kind), d.span)::int then
    return 'A ' || lower(d.name) || ' spans ' || pk(p_world, p_uid, 'span:' || ('bridge_' || p_kind), d.span)::int
        || ' tiles; that is ' || n || '.';
  end if;
  /*
   * And what each end lands on: a bank, a poured slab, or a finished floor of
   * a building — which is the new one, and the reason anybody builds a tower
   * and then wishes they had not.
   */
  la := top_deck(p_world, p_ax, p_ay);
  lb := top_deck(p_world, p_bx, p_by);
  for e in select * from (values (p_ax, p_ay, la), (p_bx, p_by, lb)) v(x, y, lvl) loop
    -- The bank of a ravine always shares a corner with the ravine, so what
    -- matters is whether you can stand in the middle of the tile, not whether
    -- every corner of it is dry.
    -- Piers: a deck on piers is landed on once it is built, and is dry, solid ground whatever is under it (`deck_surface`).
    if on_piers(p_world, e.x, e.y) and deck_surface(p_world, e.x, e.y) is null then
      return 'A bridge lands on a finished deck: build the deck at that end first.';
    end if;
    if e.lvl = 0 and slab_at(p_world, e.x, e.y) is null
       and deck_surface(p_world, e.x, e.y) is null  -- Piers
       and (not passable(p_world, e.x, e.y) or centre_height(p_world, e.x, e.y) < 0) then
      return 'Both ends want dry, solid ground to stand on.';
    end if;
    if bridge_at(p_world, e.x, e.y) is not null then return 'One end is already under a bridge.'; end if;
  end loop;
  if la <> lb then
    return 'One end is on ' || case when la = 0 then 'the ground' else 'storey ' || (la + 1) end
        || ' and the other on ' || case when lb = 0 then 'the ground' else 'storey ' || (lb + 1) end
        || '. A deck meets one storey or the other.';
  end if;
  ha := deck_height(p_world, p_ax, p_ay);
  hb := deck_height(p_world, p_bx, p_by);
  if abs(ha - hb) > end_slop() then
    return 'The two ends are ' || to_char(abs(ha - hb), 'FM990')
      || ' apart in height. One deck will not meet both; level one of them.';
  end if;
  h := round((ha + hb) / 2);
  for r in select * from span_tiles(p_ax, p_ay, p_bx, p_by) loop
    if bridge_at(p_world, r.x, r.y) is not null then return 'Something is already bridged across there.'; end if;
    if building_at(p_world, r.x, r.y) is not null then return 'Not over a building.'; end if;
    -- Frame: nor through a jetty, a balcony and its railings (`frame_jetty_of`).
    if frame_jetty_of(p_world, r.x, r.y) is not null then return 'Not over a building''s jetty.'; end if;
    if h - surface_height(p_world, r.x, r.y) < clearance() then return 'That is not a gap, it is ground. Walk it.'; end if;
  end loop;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.ground_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare tx int; ty int; cx int; cy int; here int; t tile_def; v_data int; v_tree tree_def;
        v_under text; p player; v_spoil text;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  if tx is null or ty is null or not in_bounds(p_world, tx, ty) then
    return 'There is nothing there.';
  end if;
  here := land_tile(p_world, tx, ty);
  select * into t from tile_def where id = here;
  v_data := land_data(p_world, tx, ty);

  -- A flight of garden steps answers for itself (`steps_refusal`).
  if p_action in ('lay_steps', 'lay_timber_steps', 'take_up_steps') then
    return steps_refusal(p_world, p_uid, p_action, p_target);
  end if;

  if p_action = 'flatten' then
    if t.dig_yield is null then return 'You cannot flatten that.'; end if;
    if pack_count(p_world, p_uid, 'shovel') < 1 then return 'You need a shovel to flatten.'; end if;
    -- Shallows are workable, to the depth a pick works to. `has_water` refuses
    -- a tile with one corner an inch under, which is most of a shoreline.
    if centre_height(p_world, tx, ty) < -pk(p_world, p_uid, 'depth:dig', mine_depth()) then
      return 'The water is too deep here to work in.';
    end if;
    if flatten_target(p_world, p_uid, tx, ty) < -pk(p_world, p_uid, 'depth:dig', mine_depth()) then
      return 'The ground you stand on is too deep to work from.';
    end if;
    v_under := under_building(p_world, tx, ty);
    if v_under is not null then return v_under; end if;
    if not needs_flattening(p_world, p_uid, tx, ty) then return 'That ground is already flat.'; end if;

  elsif p_action = 'drop_dirt' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    v_spoil := spoil_near(p_world, p_uid, target_item(p_target));
    if v_spoil is null then
      return case when target_item(p_target) is not null then 'That is not dirt, clay or sand.'
                  else 'You have no dirt, clay or sand to drop, and nothing beside you is holding any.' end;
    end if;
    v_under := corner_under_building(p_world, cx, cy);
    if v_under is not null then return v_under; end if;
    return coalesce(level_stop(p_world, p_uid, cx, cy, 1),
                    slope_refusal(p_world, p_uid, 'digging', cx, cy, 1));

  elsif p_action = 'raise_rock' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    if pack_count(p_world, p_uid, 'concrete') < 1 then return 'You have no concrete.'; end if;
    -- Concrete goes on bare rock, above the water: the only way to build up
    -- on rock without dirt, which slides off it.
    return rock_raise_refusal(p_world, p_uid, cx, cy, 'Concrete');

  elsif p_action = 'rubble_fill' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    if pk(p_world, p_uid, 'rubble', 0) <= 0 then return 'That wants a Mason who has learned to fill with rubble.'; end if;
    if pack_count(p_world, p_uid, 'rock_shards') < pk(p_world, p_uid, 'rubble', 0) then
      return 'You need ' || number_word(pk(p_world, p_uid, 'rubble', 0)::int) || ' rock shards.';
    end if;
    return rock_raise_refusal(p_world, p_uid, cx, cy, 'Rubble');

  elsif p_action = 'dredge' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    -- Digging from a boat: the bottom comes up a spadeful at a time, to a
    -- depth the shore never reaches. The doors are the digger's, in the
    -- digger's words, with the hull's in front of them.
    if t.dig_yield is null then return 'You cannot dredge that.'; end if;
    if pack_count(p_world, p_uid, 'shovel') < 1 then return 'You need a shovel to dredge with.'; end if;
    if not coalesce(is_boat(driving(p_world, p_uid)), false) then return 'Dredging is done from a boat.'; end if;
    if land_height(p_world, cx, cy) >= 0 then return 'That corner is above the water. Dig it from the shore.'; end if;
    if land_height(p_world, cx, cy) < -pk(p_world, p_uid, 'depth:dredge', dredge_depth()) then return 'The bottom is too deep to reach from a boat.'; end if;
    if land_dirt(p_world, cx, cy) <= 0 then return 'That corner is bare rock down there. A shovel will not bite on it.'; end if;
    v_under := corner_under_building(p_world, cx, cy);
    if v_under is not null then return v_under; end if;
    return slope_refusal(p_world, p_uid, 'digging', cx, cy, -1);

  elsif p_action = 'pave_slabs' then
    v_under := under_building(p_world, tx, ty);
    if v_under is not null then return v_under; end if;
    if here <> 2 then return 'The ground has to be packed flat before anything is laid on it.'; end if;
    if pack_count(p_world, p_uid, 'trowel') < 1 then return 'You need a trowel to bed a slab.'; end if;
    if not exists (select 1 from item i join slab_def s on s.item = i.def
                   where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
                     and not i.locked) then
      return 'You need a cut slab to pave with.';
    end if;

  elsif p_action = 'remove_paving' then
    if here not in (14, 21) then return 'There is no paving here to break up.'; end if;
    v_under := under_building(p_world, tx, ty);
    if v_under is not null then return v_under; end if;
    if pack_count(p_world, p_uid, 'pickaxe') < 1 then return 'You need a pickaxe to break up paving.'; end if;

  elsif p_action = 'cut_grass' then
    if here not in (0, 5, 6, 20) then return 'There is no grass here to cut.'; end if;
    if is_foraged(p_world, tx, ty, 'grass') then return 'The grass here is still short.'; end if;

  elsif p_action = 'cut_moss' then
    if here <> tile_id('Moss') then return 'There is no moss here to cut.'; end if;
    if is_foraged(p_world, tx, ty, 'moss') then return 'The moss here is still short.'; end if;

  elsif p_action = 'cut_reeds' then
    if here <> 19 then return 'There are no reeds here.'; end if;
    if pack_count(p_world, p_uid, 'carving_knife') < 1 then return 'You need a knife to cut reeds.'; end if;
    if is_foraged(p_world, tx, ty, 'reed') then return 'The reeds here are cut back to the water.'; end if;

  elsif p_action = 'pick_fruit' then
    if here <> 16 then return 'There is no tree here.'; end if;
    select * into v_tree from tree_def where id = tree_species(v_data);
    if v_tree.fruit is null then return 'Nothing grows on this that you would eat.'; end if;
    if not coalesce((select alive from tree_age_def where id = tree_age(v_data)), true) then
      return 'Nothing hangs on a dead tree.';
    end if;
    -- A sapling bears nothing; it has to have some years in it first.
    if not coalesce((select bears from tree_age_def where id = tree_age(v_data)), false) then
      return 'The ' || lower(v_tree.name) || ' is too young to bear. Leave it to grow.';
    end if;
    if is_foraged(p_world, tx, ty, 'forage') then
      return 'You have had what this ' || lower(v_tree.name) || ' has on it. Come back later.';
    end if;

  elsif p_action = 'pick_sprout' then
    if here <> 16 then return 'There is no tree here.'; end if;
    if not coalesce((select alive from tree_age_def where id = tree_age(v_data)), true) then
      return 'There is no life in it to sprout.';
    end if;

  elsif p_action = 'prune' then
    if here <> 16 then return 'There is no tree here to prune.'; end if;
    select * into v_tree from tree_def where id = tree_species(v_data);
    if not coalesce((select alive from tree_age_def where id = tree_age(v_data)), true) then
      return 'There is no pruning a dead tree.';
    end if;
    -- What each stage prunes to is the table's: a stage back for a grown
    -- tree, a shrub for good out of a sapling, and a young tree left to grow.
    -- A stage whose next stage is itself is a shrub already kept.
    if exists (select 1 from tree_age_def where id = tree_age(v_data) and pruned is null and next = id) then
      return 'It is clipped as far as it goes.';
    end if;
    if (select pruned from tree_age_def where id = tree_age(v_data)) is null then
      return 'The ' || lower(v_tree.name) || ' is too young to prune. Let it grow.';
    end if;

  elsif p_action = 'plant' then
    if not exists (select 1 from plantable where tile = here) then
      return 'Nothing will take root in that.';
    end if;
    if pack_count(p_world, p_uid, 'sprout') < 1 then return 'You have no sprout to plant.'; end if;
    -- A grown tile of tree is something you walk round, not through, and the
    -- sprout becomes that tile the moment it goes in.
    select * into p from player where world_id = p_world and uid = p_uid;
    if p.uid is not null and floor(p.x)::int = tx and floor(p.y)::int = ty then
      return 'You would be planting it under your own feet. Step off the tile first.';
    end if;
    -- Piers: nor under a building, where a tile on piers has grass or sand under its deck (`underBuilding`).
    v_under := under_building(p_world, tx, ty);
    if v_under is not null then return v_under; end if;
    -- Frame: and not under a jetty, which it would grow up through (`frame_jetty_over`).
    if frame_jetty_over(p_world, tx, ty) is not null then return frame_jetty_over(p_world, tx, ty); end if;

  elsif p_action = 'graft' then
    if here <> 16 then return 'There is no tree here to graft to.'; end if;
    if not coalesce((select alive from tree_age_def where id = tree_age(v_data)), true) then
      return 'There is no life in it to graft to.';
    end if;
    if (select fruit from tree_def where id = tree_species(v_data)) is not null then return 'It bears already.'; end if;
    -- Grafting is the forester's finest work, and a beginner's graft is a
    -- sprout thrown away.
    if skill_of(p_world, p_uid, 'forestry') < graft_skill() then
      return 'You do not know enough of trees to graft one yet. It takes forestry ' || graft_skill() || '.';
    end if;
    -- The sprout named, or any of the three that bear.
    if target_item(p_target) is not null and not exists (
        select 1 from item i join tree_def td on td.name = i.extra and td.fruit is not null
         where i.world_id = p_world and i.id = target_item(p_target) and i.holder = 'player'
           and i.holder_uid = p_uid and i.def = 'sprout') then
      return 'That is not a fruit sprout.';
    end if;
    if not exists (
        select 1 from item i join tree_def td on td.name = i.extra and td.fruit is not null
         where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
           and i.def = 'sprout' and not i.locked) then
      return 'You have no fruit sprout to graft.';
    end if;
    -- Piers: nor under a building (`underBuilding`).
    v_under := under_building(p_world, tx, ty);
    if v_under is not null then return v_under; end if;

  elsif p_action = 'harvest_bush' then
    if here <> 17 then return 'There is no bush here.'; end if;
    if (select yields from bush_def where id = bush_species(v_data)) is null then
      return 'Nothing on a ' || lower((select name from bush_def where id = bush_species(v_data))) || ' is worth a sickle.';
    end if;
    if is_foraged(p_world, tx, ty, 'forage') then
      return 'You have had what this ' || lower((select name from bush_def where id = bush_species(v_data))) || ' has on it. Come back later.';
    end if;

  elsif p_action = 'dig_stump' then
    if here <> tile_id('Stump') then return 'There is no stump here.'; end if;

  elsif p_action = 'coppice' then
    if pk(p_world, p_uid, 'coppice', 0) <= 0 then return 'That wants a Forester who has learned to coppice.'; end if;
    if here <> 16 then return 'There is no tree here to coppice.'; end if;
    select * into v_tree from tree_def where id = tree_species(v_data);
    if not coalesce((select alive from tree_age_def where id = tree_age(v_data)), true) then
      return 'There is no coppicing a dead tree.';
    end if;
    -- Grown enough to bear: mature and older.
    if not coalesce((select bears from tree_age_def where id = tree_age(v_data)), false) then
      return 'The ' || lower(v_tree.name) || ' is too young to coppice. Let it grow.';
    end if;

  elsif p_action = 'tap_resin' then
    if pk(p_world, p_uid, 'tap_resin', 0) <= 0 then return 'That wants a Forester who has learned to tap resin.'; end if;
    if here <> 16 then return 'There is no tree here to tap.'; end if;
    select * into v_tree from tree_def where id = resin_tree();
    if tree_species(v_data) <> resin_tree() then return 'Only a ' || lower(v_tree.name) || ' gives resin.'; end if;
    if not coalesce((select alive from tree_age_def where id = tree_age(v_data)), true) then
      return 'A dead ' || lower(v_tree.name) || ' gives no resin.';
    end if;
    -- Not a sapling, and not one clipped to a shrub: a tree with timber in it.
    if coalesce((select logs from tree_age_def where id = tree_age(v_data)), 0) <= 0 then
      return 'The ' || lower(v_tree.name) || ' is too small to tap. Let it grow.';
    end if;
    -- Once a day for each pine, the day turning at the woods' dawn.
    if exists (select 1 from foraged f where f.world_id = p_world and f.x = tx and f.y = ty
                 and f.kind = 'resin' and f.at >= tree_last_dawn()) then
      return 'This ' || lower(v_tree.name) || ' has given its resin today. It runs again at dawn.';
    end if;

  elsif p_action = 'clear_brush' then
    if pk(p_world, p_uid, 'clear_brush', 0) <= 0 then return 'That wants a Forester who has learned to clear brush.'; end if;
    if here not in (tile_id('Bush'), tile_id('Reed')) then return 'There is no brush here to clear.'; end if;

  elsif p_action = 'dig_worms' then
    if not t.wormy then return 'Nothing lives in that.'; end if;
    if pack_count(p_world, p_uid, 'shovel') < 1 then return 'You need a shovel.'; end if;
    if has_water(p_world, tx, ty) then return 'Not under water.'; end if;

  elsif p_action = 'prospect' then
    if pack_count(p_world, p_uid, 'pickaxe') < 1 then return 'You need a pickaxe to prospect.'; end if;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.examine_tile_text(p_world uuid, p_x integer, p_y integer, p_uid uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_t int; v_data int; v_out text; v_extra text := ''; b building; v_id int; n int; v_age tree_age_def;
begin
  -- cellar: from down in a cellar, a tile of it is its floor, and not the ground up top (`cellarFloorSaid`).
  v_out := cellar_floor_said(p_world, p_x, p_y); -- cellar
  if v_out is not null then return v_out; end if; -- cellar
  v_t := land_tile(p_world, p_x, p_y);
  v_data := land_data(p_world, p_x, p_y);
  if v_t = 16 then
    select * into v_age from tree_age_def where id = tree_age(v_data);
    v_out := 'You see ' || an(lower(coalesce(v_age.name, 'young'))
      || ' ' || lower((select name from tree_def where id = tree_species(v_data))) || ' tree')
      || ' at (' || p_x || ', ' || p_y || ').';
    -- What is in it, what is coming for it, and what to do about that — the
    -- same words the browser uses, so a tree reads the same on both.
    if tree_cuts(p_world, p_x, p_y) > 0 then
      -- Of as many as the one looking would fell it in (a Forester's Heavy Swing).
      v_out := v_out || ' It has ' || tree_cuts(p_world, p_x, p_y) || ' of ' || tree_hits(p_world, p_uid, v_age.hits)
        || ' strokes in it.';
    end if;
    v_out := v_out || tree_outlook(p_world, v_age);
  elsif v_t = 17 then
    v_out := 'You see a ' || lower((select name from bush_def where id = bush_species(v_data)))
      || ' at (' || p_x || ', ' || p_y || ').';
  elsif v_t = tile_id('Stump') then
    v_out := 'You see the stump of ' || an(lower((select name from tree_def where id = tree_species(v_data))))
      || ' at (' || p_x || ', ' || p_y || '). Dig it out, or leave it a day.';
  else
    v_out := 'You see ' || lower((select name from tile_def where id = v_t))
      || ' at (' || p_x || ', ' || p_y || ').';
    if v_t = tile_id('Grass') and (v_data & 7) <> 0 then
      v_out := v_out || ' Kept cut: ' || ((v_data & 3) + case when (v_data & 4) <> 0 then 1 else 0 end) || ' of 3 days towards lawn.';
    end if;
  end if;
  -- What feet have done to it, and what is in flower on it: the browser's words (`groundSays`).
  v_out := v_out || ground_says(p_world, p_x, p_y);
  v_out := v_out || ' Height ' || to_char(centre_height(p_world, p_x, p_y), 'FM990.0')
    || ', slope ' || tile_slope(p_world, p_x, p_y) || '.';
  -- And for a Fisher with a Fishing Journal, what the water holds for them.
  if has_water(p_world, p_x, p_y) then
    v_out := v_out || ' Water laps over it.' || fish_journal(p_world, p_uid, p_x, p_y);
  end if;

  if is_token(p_world, p_x, p_y) then
    v_extra := v_extra || ' The settlement token of '
      || (deed_at(p_world, p_x, p_y)).name || ' stands here.';
  elsif on_deed(p_world, p_x, p_y) then
    v_extra := v_extra || ' This is part of ' || (deed_at(p_world, p_x, p_y)).name || '.';
  end if;
  v_id := building_at(p_world, p_x, p_y);
  if v_id is not null then
    select * into b from building where world_id = p_world and id = v_id;
    if found then
      v_extra := v_extra || ' It belongs to ' || b.name || ', '
        || case when b.levels = 1 then 'a single-storey building'
                else b.levels || ' storeys tall' end || '.';
      -- And a glasshouse says what it is for (`glass_examine`).
      v_extra := v_extra || glass_examine(p_world, b.id);
      -- Piers: and its deck, if the tile stands on piers (`pier_says`).
      v_extra := v_extra || pier_says(p_world, p_x, p_y);
    end if;
    v_extra := v_extra || cellar_said(p_world, p_x, p_y); -- cellar: what is dug out under it, after the glass and the deck
  end if;
  -- Frame: a jetty over it, columns on its corners, a roof on columns (`frame_says`).
  v_extra := v_extra || frame_says(p_world, p_x, p_y);
  select count(*) into n from crate c where c.world_id = p_world
    and p_x between c.x and c.x + c.sx - 1 and p_y between c.y and c.y + c.sy - 1;
  if n = 1 then v_extra := v_extra || ' A crate stands here.';
  elsif n > 1 then v_extra := v_extra || ' ' || n || ' crates stand here.'; end if;
  return v_out || v_extra;
end $function$;

create or replace function deck_bears(p_world uuid, p_building int, p_material text) returns text
  language sql stable as $$
  select case when m.heft < w.over
    then m.name || ' will not carry the ' || heft_word(w.over) || ' standing on ' || b.name
      || ': a deck on piers carries what it is laid in.' end
  from build_material_def m
  join building b on b.world_id = p_world and b.id = p_building
  -- Frame: its columns counted with its walls, as the walls they stand for (`frame_materials`, `heaviestWall`).
  cross join (select coalesce(max(wm.heft), 0) as over from frame_materials(p_world, p_building) w2
               join build_material_def wm on wm.id = w2.material) w
  where m.id = p_material
$$;

create or replace function aqueduct_plan(p_world uuid, p_uid uuid, p_sx int, p_sy int, p_tx int, p_ty int)
  returns jsonb language plpgsql stable as $fn$
declare n int; v_name text; v_head text; v_top int; v_foot text; v_level int; hs foundation; fs foundation;
        v_c int[]; v_r jsonb; r record; e record; ob bridge;
begin
  if not in_bounds(p_world, p_sx, p_sy) or not in_bounds(p_world, p_tx, p_ty) then
    return jsonb_build_object('refused', 'Not there.');
  end if;
  if (p_sx <> p_tx and p_sy <> p_ty) or (p_sx = p_tx and p_sy = p_ty) then
    return jsonb_build_object('refused', 'An aqueduct runs straight: its head due north, south, east or west of the tile it pours into.');
  end if;
  select count(*)::int into n from span_tiles(p_sx, p_sy, p_tx, p_ty);
  if n = 0 then
    return jsonb_build_object('refused', 'That water is right beside it: there is nothing for an aqueduct to carry it over.');
  end if;
  if n > (select d.span from bridge_def d where d.id = 'aqueduct') then
    return jsonb_build_object('refused', 'An aqueduct spans ' || (select d.span from bridge_def d where d.id = 'aqueduct')
      || ' tiles; that is ' || n || '.');
  end if;
  for e in select * from (values (1, p_sx, p_sy), (2, p_tx, p_ty)) v(o, x, y) order by o loop
    select dd.name into v_name from deed_covering(p_world, e.x, e.y) dd where not may_shape(p_world, p_uid, e.x, e.y) limit 1;
    if v_name is not null then
      return jsonb_build_object('refused', 'That is part of ' || v_name || '. Only its builders may lead water from it or to it.');
    end if;
  end loop;
  -- The head: a pool, or a spring's pond.
  hs := slab_at(p_world, p_sx, p_sy);
  if hs.id is not null and hs.pool then
    v_head := 'pool'; v_top := hs.top - pool_lip();
  elsif exists (select 1 from spring_tile t where t.world_id = p_world and t.x = p_sx and t.y = p_sy) then
    v_head := 'pond';
    select max(t.level) into v_top from spring_tile t where t.world_id = p_world and t.x = p_sx and t.y = p_sy;
  elsif least(land_height(p_world, p_sx, p_sy), land_height(p_world, p_sx + 1, p_sy),
              land_height(p_world, p_sx + 1, p_sy + 1), land_height(p_world, p_sx, p_sy + 1)) < 0 then
    return jsonb_build_object('refused', 'The sea is below everything: an aqueduct carries a spring''s water, from a pond or a pool.');
  else
    return jsonb_build_object('refused', 'There is no pond or pool there for an aqueduct to draw from.');
  end if;
  -- The foot: a pool, a fountain, a pond, or a hollow that would hold one.
  fs := slab_at(p_world, p_tx, p_ty);
  if fs.id is not null and not fs.pool then
    return jsonb_build_object('refused', 'Dig a pool in the foundation first: the water would run straight off its top.');
  end if;
  if fs.id is not null then
    v_foot := 'pool'; v_level := fs.top - pool_lip();
  elsif exists (select 1 from placed q where q.world_id = p_world and q.kind = 'furniture' and q.sub = 'fountain'
                  and q.x = p_tx and q.y = p_ty) then
    -- To the nearest unit, as a pond's and a pool's water stand.
    v_foot := 'fountain'; v_level := floor(surface_height(p_world, p_tx, p_ty) + fountain_rim() + 0.5)::int;
  elsif exists (select 1 from spring_tile t where t.world_id = p_world and t.x = p_tx and t.y = p_ty) then
    v_foot := 'pond';
    select max(t.level) into v_level from spring_tile t where t.world_id = p_world and t.x = p_tx and t.y = p_ty;
  elsif least(land_height(p_world, p_tx, p_ty), land_height(p_world, p_tx + 1, p_ty),
              land_height(p_world, p_tx + 1, p_ty + 1), land_height(p_world, p_tx, p_ty + 1)) < 0 then
    return jsonb_build_object('refused', 'An aqueduct pours into a pool, a pond, a fountain or a hollow, not the sea.');
  else
    v_c := spring_corner(p_world, p_tx, p_ty);
    v_r := settle_chain(p_world, v_c[1], v_c[2]);
    if v_r->>'refused' = 'wide' then
      return jsonb_build_object('refused', 'That hollow is too wide ever to fill: a pond spreads over ' || pond_most() || ' corners at most.');
    end if;
    if v_r ? 'refused' then
      return jsonb_build_object('refused', 'Water poured here would run straight off downhill: the foot of an aqueduct wants a pool, a pond, a fountain, or a hollow that holds '
        || to_char(spring_depth() / 10.0, 'FM990.0') || ' m of water or more.');
    end if;
    v_foot := 'hollow'; v_level := (v_r->'ponds'->0->>'level')::int;
  end if;
  -- Not the water it draws from: one pool, or one pond, under both ends.
  if v_head = 'pool' and v_foot = 'pool' then
    v_c := spring_corner(p_world, p_sx, p_sy);
    v_r := settle_chain(p_world, v_c[1], v_c[2], p_sx, p_sy);
    if not (v_r ? 'refused') and pond_covers(v_r->'ponds'->0, p_tx, p_ty) then
      return jsonb_build_object('refused', 'That is the water it would draw from.');
    end if;
  end if;
  if v_head = 'pond' and v_foot = 'pond'
     and exists (select 1 from spring_tile a join spring_tile b on b.world_id = a.world_id and b.spring_id = a.spring_id and b.pond = a.pond
                  where a.world_id = p_world and a.x = p_sx and a.y = p_sy and b.x = p_tx and b.y = p_ty) then
    return jsonb_build_object('refused', 'That is the water it would draw from.');
  end if;
  -- Not the line of one there already.
  if exists (select 1 from bridge b where b.world_id = p_world and b.kind = 'aqueduct'
              and b.ax = p_sx and b.ay = p_sy and b.bx = p_tx and b.by = p_ty) then
    return jsonb_build_object('refused', 'An aqueduct already runs from there to here.');
  end if;
  -- Not water another aqueduct draws from already: the first of them takes all of it.
  select b.* into ob from bridge b where b.world_id = p_world and b.id = aqueduct_draws(p_world, p_sx, p_sy, v_head);
  if ob.id is not null then
    return jsonb_build_object('refused', 'The aqueduct from ' || ob.ax || ', ' || ob.ay || ' draws from that water already.');
  end if;
  if v_level > v_top then
    return jsonb_build_object('refused', 'The water there stands at ' || v_level || ', over the ' || v_top
      || ' its head stands at: water only runs downhill.');
  end if;
  if bridge_at(p_world, p_sx, p_sy) is not null or bridge_at(p_world, p_tx, p_ty) is not null then
    return jsonb_build_object('refused', 'A bridge is carried over one end of it already.');
  end if;
  for r in select * from span_tiles(p_sx, p_sy, p_tx, p_ty) order by n loop
    if bridge_at(p_world, r.x, r.y) is not null then return jsonb_build_object('refused', 'Something is already bridged across there.'); end if;
    if building_at(p_world, r.x, r.y) is not null then return jsonb_build_object('refused', 'Not over a building.'); end if;
    -- Frame: nor through a building's jetty, as a bridge is not (`frame_jetty_of`).
    if frame_jetty_of(p_world, r.x, r.y) is not null then return jsonb_build_object('refused', 'Not over a building''s jetty.'); end if;
    if land_tile(p_world, r.x, r.y) in (tile_id('Tree'), tile_id('Bush')) then
      return jsonb_build_object('refused', 'A ' || case when land_tile(p_world, r.x, r.y) = tile_id('Tree') then 'tree' else 'bush' end
        || ' stands at ' || r.x || ', ' || r.y || ', under where a span would go. Cut it down first.');
    end if;
    if v_top - channel_deep() - surface_height(p_world, r.x, r.y) < clearance() then
      fs := slab_at(p_world, r.x, r.y);
      return jsonb_build_object('refused', case when fs.id is null then 'The ground' when fs.pool then 'The water in the pool' else 'The foundation' end
        || ' at ' || r.x || ', ' || r.y || ' stands within '
        || to_char(clearance() / 10.0, 'FM990.0') || ' m of the channel''s bed: an aqueduct is carried over '
        || case when fs.id is null then 'the ground' when fs.pool then 'the water' else 'a foundation' end || ', not through it.');
    end if;
  end loop;
  return jsonb_build_object('height', v_top, 'head', v_head, 'foot', v_foot, 'level', v_level);
end $fn$;

CREATE OR REPLACE FUNCTION public.block_taken(p_world uuid, p_x integer, p_y integer, p_sx integer, p_sy integer, p_w integer, p_h integer, p_except bigint DEFAULT NULL::bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (select 1 from placed o
                 where o.world_id = p_world and o.x = p_x and o.y = p_y and o.id is distinct from p_except
                   and same_floor(o.level, o.world_id, o.x, o.y) -- cellar
                   and o.sx < p_sx + p_w and o.sx + (placed_size(o.kind, o.sub, o.facing))[1] > p_sx
                   and o.sy < p_sy + p_h and o.sy + (placed_size(o.kind, o.sub, o.facing))[2] > p_sy)
      or exists (select 1 from crate c
                 where c.world_id = p_world and c.x = p_x and c.y = p_y and same_floor(c.level, c.world_id, c.x, c.y) -- cellar
                   and c.sx >= p_sx and c.sx < p_sx + p_w and c.sy >= p_sy and c.sy < p_sy + p_h)
      -- Frame: and a column of the ground floor, in the corner spot of each tile round it, up top (`frame_column_corner`).
      or (same_floor(0, p_world, p_x, p_y) and frame_column_corner(p_world, p_x, p_y, p_sx, p_sy, p_w, p_h))
$function$;

select private.lock_doors();
