/*
 * Cellars: the storey under the ground floor (`src/game/cellar.ts`).
 *
 * A finished building's ground-floor tile is dug out from under it a slice at
 * a time -- a unit of depth over the whole tile a go, one of what that ground
 * gives -- until it is `cellar_depth()` down, one storey: a cellar tile, and
 * somewhere to stand at `cellar_level()`. The slices down through the soil
 * over the rock are shovel work (`dig_cellar`, digging, a spadeful of dirt);
 * the rest is the rock (`mine_cellar`, mining, what that rock gives -- shards,
 * or the ore of a seam). The ground over it is left as it is, and is not dug
 * or raised while the cellar is there. `fill_cellar` puts it back. All three
 * are done by somebody inside the building, on its ground floor or down in
 * its cellar (`cellar_stands_in`).
 *
 *   * `cellar_tile` is what has been dug, by tile: `dug` of `cellar_depth()`.
 *   * A crate or a piece set down by somebody in a cellar is down there:
 *     `crate.level` and `placed.level` are -1, stamped as the row goes in
 *     (`cellar_set_down`). What is dropped there is `holder = 'cellar'`, so
 *     nothing that looks at the ground -- a beast, a worker, the sweep --
 *     sees it; `cellar_sweep` rots it at `cellar_decay()` of the outdoor rate.
 *   * Every rule that asks what is within a body's reach asks it on the body's
 *     own side of the ground floor (`same_floor`): `act_refusal` and `settle`
 *     set `wurm.floor` from the body's row for the refusal and the go, as they
 *     set the perks -- its storey, and down in a cellar whose cellar it is. A
 *     thing down in the cellar is reached from down there, a thing up top from
 *     up top, and from down in one cellar nothing in the cellar of the
 *     building next door: two cellars side by side have the ground between
 *     them (`cellar_gate`, the browser's `cellarGate`).
 *   * The way down is a flight or a ladder on the ground floor over a cellar
 *     tile, its foot on the cellar tile on the side it is climbed from
 *     (`flight_down`, `cellar_flight_refusal`); `rpc_move` holds a body to it
 *     (`cellar_move_ok`) only when it is in a cellar or going into one: down
 *     off the flight onto its foot, up onto it off its foot, and about the
 *     floor of the one cellar.
 *
 * Every refusal is the browser's, in its words and its order;
 * `supabase/test/cellar.ts` holds the two sides to each other.
 */

set local lock_timeout = '3s';

create table if not exists cellar_tile (
  world_id uuid not null references world on delete cascade,
  x int not null,
  y int not null,
  building int not null,
  /** How far down it has been dug; a cellar at `cellar_depth()`. */
  dug int not null check (dug > 0),
  primary key (world_id, x, y),
  foreign key (world_id, building) references building (world_id, id) on delete cascade
);
create index if not exists cellar_by_building on cellar_tile (world_id, building);
alter table cellar_tile enable row level security;
drop policy if exists cellar_tile_read on cellar_tile;
create policy cellar_tile_read on cellar_tile for select to authenticated using (true);
grant select on cellar_tile to authenticated;
revoke insert, update, delete on cellar_tile from anon, authenticated;

-- The storey a crate or a piece stands on: -1 down in a cellar, 0 on the ground.
alter table crate add column if not exists level int not null default 0;
alter table placed add column if not exists level int not null default 0;
-- What lies on a cellar's floor, and the sweep's two indexes over it, as the ground has them.
create index if not exists item_in_cellar on item (world_id, gx, gy) where holder = 'cellar';
create index if not exists item_cellar_due on item (world_id, coalesce(rot_at, '-infinity'::timestamptz)) where holder = 'cellar';
create index if not exists item_cellar_gone on item (world_id) where holder = 'cellar' and dmg >= 100;

/* ---- Which storey a thing and a body are on ----------------------------------------------------------- */

-- The storey the rules are being asked from: the refusal or the go in hand (`wurm.floor`, `<storey>:<building>`),
-- or the ground when nobody is asking -- a worker, a beast, the tick.
create or replace function actor_floor() returns int language sql stable as $$
  select coalesce(nullif(split_part(current_setting('wurm.floor', true), ':', 1), '')::int, 0)
$$;

-- And down in a cellar, the building whose cellar it is (`Game.myCellar`).
create or replace function actor_cellar() returns int language sql stable as $$
  select nullif(split_part(current_setting('wurm.floor', true), ':', 2), '')::int
$$;

-- The storey a thing or a body counts as for reach: the cellar (-1), or the ground and everything over it (0).
create or replace function floor_of(p_level int) returns int language sql immutable as $$
  select case when coalesce(p_level, 0) < 0 then -1 else 0 end
$$;

-- What is dug out under a tile, if anything (`Buildings.cellar`).
create or replace function cellar_at(p_world uuid, p_x int, p_y int) returns cellar_tile language sql stable as $$
  select * from cellar_tile where world_id = p_world and x = p_x and y = p_y
$$;

-- What `wurm.floor` says of a body at a storey and a spot: the storey, and down in a cellar whose cellar it is.
create or replace function floor_said(p_world uuid, p_level int, p_x double precision, p_y double precision) returns text
  language sql stable as $$
  select floor_of(p_level) || ':'
      || coalesce(case when p_level < 0 then (cellar_at(p_world, floor(p_x)::int, floor(p_y)::int)).building end::text, '')
$$;

/*
 * Whether a thing standing on a tile at a storey is on the side of the ground
 * floor the rules are being asked from (`Game.onMySide`): up top from up top,
 * and from down in a cellar, in that same cellar. Up top it reads nothing.
 */
create or replace function same_floor(p_level int, p_world uuid, p_x int, p_y int) returns boolean language sql stable as $$
  select case when actor_floor() < 0
              then coalesce(p_level, 0) < 0 and (cellar_at(p_world, p_x, p_y)).building = actor_cellar()
              else coalesce(p_level, 0) >= 0 end
$$;

/* ---- The cellar under a tile ------------------------------------------------------------------------- */

-- Dug out the whole storey down: somewhere to stand at `cellar_level()` (`Buildings.cellarDone`).
create or replace function cellar_done(p_world uuid, p_x int, p_y int) returns boolean language sql stable as $$
  select exists (select 1 from cellar_tile where world_id = p_world and x = p_x and y = p_y and dug >= cellar_depth())
$$;

-- A finished flight or ladder down from the ground floor over a finished cellar tile (`Buildings.flightDown`).
create or replace function flight_down(p_world uuid, p_x int, p_y int) returns floor_tile language sql stable as $$
  select f.* from floor_tile f
   where f.world_id = p_world and f.level = 0 and f.x = p_x and f.y = p_y
     and f.kind in ('stairs', 'ladder') and bill_done(f.needed) and cellar_done(p_world, p_x, p_y)
$$;

-- The soil over the rock under a tile as a cellar reckons it: its corners' averaged and rounded down (`cellarSoil`).
create or replace function cellar_soil(p_world uuid, p_x int, p_y int) returns int language sql stable as $$
  select floor((coalesce(land_dirt(p_world, p_x, p_y), 0) + coalesce(land_dirt(p_world, p_x + 1, p_y), 0)
              + coalesce(land_dirt(p_world, p_x + 1, p_y + 1), 0) + coalesce(land_dirt(p_world, p_x, p_y + 1), 0)) / 4.0)::int
$$;

-- And at its shallowest corner, which is what `cellar_least_soil()` is asked of (`cellarShallowest`).
create or replace function cellar_shallowest(p_world uuid, p_x int, p_y int) returns int language sql stable as $$
  select least(coalesce(land_dirt(p_world, p_x, p_y), 0), coalesce(land_dirt(p_world, p_x + 1, p_y), 0),
               coalesce(land_dirt(p_world, p_x + 1, p_y + 1), 0), coalesce(land_dirt(p_world, p_x, p_y + 1), 0))
$$;

-- Whether the next slice down under a tile is rock, for a pickaxe, rather than soil, for a shovel (`nextSliceRock`).
create or replace function cellar_rock_next(p_world uuid, p_x int, p_y int) returns boolean language sql stable as $$
  select coalesce((cellar_at(p_world, p_x, p_y)).dug, 0) >= cellar_soil(p_world, p_x, p_y)
$$;

-- Whether anybody is down in a building's cellar (`Game.cellarOccupied`).
create or replace function cellar_occupied(p_world uuid, p_building int) returns boolean language sql stable as $$
  select exists (select 1 from player p join cellar_tile c
                   on c.world_id = p.world_id and c.x = floor(p.x)::int and c.y = floor(p.y)::int
                  where p.world_id = p_world and p.level < 0 and c.building = p_building)
$$;

-- Whether a body stands in a building: on its ground floor, or down in its cellar (`standsIn`).
create or replace function cellar_stands_in(p_world uuid, p_uid uuid, p_building int) returns boolean language sql stable as $$
  select coalesce((select case when pl.level = 0 then building_at(p_world, floor(pl.x)::int, floor(pl.y)::int) = p_building
                               when pl.level < 0 then (cellar_at(p_world, floor(pl.x)::int, floor(pl.y)::int)).building = p_building
                               else false end
                     from player pl where pl.world_id = p_world and pl.uid = p_uid), false)
$$;

-- What is dug out under a tile, as an examine says it (`examine` in the browser).
create or replace function cellar_said(p_world uuid, p_x int, p_y int) returns text language sql stable as $$
  select coalesce((select case when c.dug >= cellar_depth()
                               then ' A cellar is dug out under it, ' || cellar_depth()::int || ' deep.'
                               else ' The ground under it is dug out ' || c.dug || ' of ' || cellar_depth()::int
                                    || ' down, for a cellar.' end
                     from cellar_tile c where c.world_id = p_world and c.x = p_x and c.y = p_y), '')
$$;

/*
 * An examine of a tile of the cellar a body is down in, from down there
 * (`cellarFloorSaid`): the floor of it -- what it is cut in, how far under the
 * ground floor, at what height -- and how much lies on it, rather than the
 * ground up top. Null for any other tile, or asked from up top.
 */
create or replace function cellar_floor_said(p_world uuid, p_x int, p_y int) returns text language plpgsql stable as $$
declare c cellar_tile; v_name text; v_floor text; v_h text; n bigint;
begin
  if actor_floor() >= 0 then return null; end if;
  c := cellar_at(p_world, p_x, p_y);
  if c.world_id is null or c.building is distinct from actor_cellar() then return null; end if;
  select b.name into v_name from building b where b.world_id = p_world and b.id = c.building;
  if v_name is null then return null; end if;
  v_floor := case when c.dug > cellar_soil(p_world, p_x, p_y) then lower((bedrock_at(p_world, p_x, p_y)).name) else 'soil' end;
  v_h := to_char(land_height(p_world, p_x, p_y) - c.dug, 'FM990.0');
  select coalesce(sum(i.count), 0) into n from item i
   where i.world_id = p_world and i.holder = 'cellar' and i.gx = p_x and i.gy = p_y;
  return case when c.dug >= cellar_depth()
              then 'You see the floor of the cellar under ' || v_name || ' at (' || p_x || ', ' || p_y || '): ' || v_floor || ', '
                   || cellar_depth()::int || ' under the ground floor, at height ' || v_h || '.'
              else 'You see the bottom of the cellar being dug under ' || v_name || ' at (' || p_x || ', ' || p_y || '): '
                   || v_floor || ', ' || c.dug || ' of ' || cellar_depth()::int || ' down, at height ' || v_h || '.' end
      || case when n = 0 then ' Nothing lies on it.' when n = 1 then ' 1 thing lies on it.' else ' ' || n || ' things lie on it.' end;
end $$;

/* ---- The refusals ------------------------------------------------------------------------------------ */

-- What stops a tile being dug out any further, whichever tool the next slice wants (`cellarDigReason`).
create or replace function cellar_dig_reason(p_world uuid, p_uid uuid, p_target jsonb) returns text
  language plpgsql stable as $$
declare v_x int := (p_target->>'x')::int; v_y int := (p_target->>'y')::int;
        v_b int; v_dug int; v_gap text; v_shallow int; v_h int;
begin
  v_b := building_at(p_world, v_x, v_y);
  if v_b is null then return 'A cellar is dug out under a building.'; end if;
  -- The ground under a deck on piers is not dug while the building stands (`piers.ts`).
  if on_piers(p_world, v_x, v_y) then return 'A cellar is not dug out under a deck on piers.'; end if;
  if not cellar_stands_in(p_world, p_uid, v_b) then
    return 'Dig it out from inside that building, on its ground floor or down in its cellar.';
  end if;
  v_dug := coalesce((cellar_at(p_world, v_x, v_y)).dug, 0);
  if v_dug >= cellar_depth() then
    return 'The cellar is dug out here, the whole ' || cellar_depth()::int || ' down.';
  end if;
  -- A building standing over it, and closed in: there is no ground floor to dig under until there is.
  v_gap := level_gap(p_world, v_b, 0, p_uid);
  if v_gap is not null then return v_gap; end if;
  if (slab_at(p_world, v_x, v_y)).id is not null then return 'A cellar is not dug out under a poured foundation.'; end if;
  v_shallow := cellar_shallowest(p_world, v_x, v_y);
  if v_dug = 0 and v_shallow < cellar_least_soil() then
    return 'The rock lies ' || v_shallow || ' under the ground floor at the shallowest corner here. A cellar is begun in soil, '
      || cellar_least_soil()::int || ' of it at every corner.';
  end if;
  v_h := land_height(p_world, v_x, v_y);
  if v_h - cellar_depth() < 0 then
    return 'The ground floor here stands at ' || v_h || '. A cellar ' || cellar_depth()::int
      || ' deep under it would lie under the sea: it wants the ground floor ' || cellar_depth()::int || ' over the water.';
  end if;
  return null;
end $$;

-- A flight or a ladder down that stands on a tile, or has its foot on it: which, or null (`flightOnto`).
create or replace function cellar_flight_onto(p_world uuid, p_x int, p_y int) returns text language sql stable as $$
  select f.kind from floor_tile f
   where f.world_id = p_world and f.level = 0 and f.kind in ('stairs', 'ladder')
     and exists (select 1 from cellar_tile c where c.world_id = p_world and c.x = f.x and c.y = f.y)
     and ((f.x = p_x and f.y = p_y)
          or (f.x, f.y, coalesce(f.facing, 's')) in ((p_x, p_y + 1, 'n'), (p_x - 1, p_y, 'e'), (p_x, p_y - 1, 's'), (p_x + 1, p_y, 'w')))
   order by (f.x = p_x and f.y = p_y) desc, f.y, f.x limit 1
$$;

-- Why a tile cannot be filled back in by a slice, or null (`cellarFillReason`).
create or replace function cellar_fill_reason(p_world uuid, p_uid uuid, p_target jsonb) returns text
  language plpgsql stable as $$
declare v_x int := (p_target->>'x')::int; v_y int := (p_target->>'y')::int; p player; v_kind text; v_under cellar_tile;
begin
  v_under := cellar_at(p_world, v_x, v_y);
  if v_under.world_id is null then return 'There is no cellar dug out under this tile.'; end if;
  if not cellar_stands_in(p_world, p_uid, v_under.building) then
    return 'Fill it in from inside that building, on its ground floor or down in its cellar.';
  end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if p.level < 0 and floor(p.x)::int = v_x and floor(p.y)::int = v_y then return 'You are standing on it. Step off it first.'; end if;
  if exists (select 1 from item i where i.world_id = p_world and i.holder = 'cellar' and i.gx = v_x and i.gy = v_y) then
    return 'Clear away what is lying down there first.';
  end if;
  if exists (select 1 from crate c where c.world_id = p_world and c.x = v_x and c.y = v_y and c.level < 0)
     or exists (select 1 from placed q where q.world_id = p_world and q.x = v_x and q.y = v_y and q.level < 0) then
    return 'Carry out what stands down there first.';
  end if;
  v_kind := cellar_flight_onto(p_world, v_x, v_y);
  if v_kind is not null then
    return 'The ' || floor_kind_name(v_kind) || ' down to the cellar stands on it. Take it out first.';
  end if;
  if exists (select 1 from player o where o.world_id = p_world and o.uid <> p_uid and o.level < 0
               and floor(o.x)::int = v_x and floor(o.y)::int = v_y) then
    return 'Somebody is standing down there.';
  end if;
  return null;
end $$;

/*
 * Why a flight or a ladder cannot go down from the ground floor here into the
 * cellar under it (`flightDownReason`): it stands over a finished tile of the
 * cellar and comes down, on the side it is climbed from, onto another.
 */
create or replace function cellar_flight_refusal(p_world uuid, p_building int, p_x int, p_y int, p_side text, p_down boolean)
  returns text language plpgsql stable as $$
declare c cellar_tile; v_fx int; v_fy int;
begin
  c := cellar_at(p_world, p_x, p_y);
  if c.world_id is null and not p_down then return 'Stairs and ladders belong to an upper storey; plan another storey first.'; end if;
  if coalesce(c.dug, 0) < cellar_depth() then
    return 'Dig the cellar out under it first: it is ' || coalesce(c.dug, 0) || ' of ' || cellar_depth()::int || ' down.';
  end if;
  -- A glasshouse's field is cleared before anything is planned over it (`glasshouse.ts`).
  if land_tile(p_world, p_x, p_y) = tile_id('Field') then
    return 'There is a field here: clear the field before you plan a way down through it.';
  end if;
  if p_side is null then return 'Choose the side to climb from.'; end if;
  v_fx := p_x + case p_side when 'w' then -1 when 'e' then 1 else 0 end;
  v_fy := p_y + case p_side when 'n' then -1 when 's' then 1 else 0 end;
  if (cellar_at(p_world, v_fx, v_fy)).building is distinct from p_building or not cellar_done(p_world, v_fx, v_fy) then
    return 'Its foot would come down on ' || v_fx || ',' || v_fy || ', and there is no cellar dug out there to come down on.';
  end if;
  return null;
end $$;

/*
 * Why a flight or a ladder cannot go in at a storey because one the other way
 * is on the same tile (`stackedFlightReason`): a flight up from the ground
 * floor and a flight down from it are both walked onto from the ground
 * floor's tile, and only the one would ever be taken.
 */
create or replace function cellar_stack_refusal(p_world uuid, p_level int, p_x int, p_y int) returns text language sql stable as $$
  select case when p_level = 1 then (select 'The ' || floor_kind_name(f.kind) || ' down to the cellar is there.' from floor_tile f
                                      where f.world_id = p_world and f.level = 0 and f.x = p_x and f.y = p_y
                                        and f.kind in ('stairs', 'ladder'))
              when p_level = 0 then (select 'The ' || floor_kind_name(f.kind) || ' up to the next storey is there.' from floor_tile f
                                      where f.world_id = p_world and f.level = 1 and f.x = p_x and f.y = p_y
                                        and f.kind in ('stairs', 'ladder')) end
$$;

-- The storey a floor job works on: the ground floor's, for a flight or a ladder down to a cellar (`slotLevel`).
create or replace function floor_level(p_world uuid, p_building int, p_kind text, p_target jsonb) returns int
  language sql stable as $$
  select case when p_kind <> 'roof' and coalesce((p_target->>'down')::boolean, false) then 0
              else floor_level(p_world, p_building, p_kind) end
$$;

-- Whether a piece of furniture may go down into a cellar, and why not when it may not (`cellarPieceReason`): every
-- piece may, but for what burns an open fire, what is on wheels or afloat, and `cellar_outdoor`'s pieces.
create or replace function cellar_piece_reason(p_sub text) returns text language sql stable as $$
  select case
    when d.id is null then null
    when coalesce(d.hearth, false) then 'Nothing that burns an open fire goes down into a cellar.'
    when coalesce(d.cart, false) or exists (select 1 from vehicle_def v where v.id = d.id)
         or exists (select 1 from boat_def b where b.id = d.id)
      then 'Nothing on wheels or afloat goes down into a cellar.'
    when cellar_outdoor(d.id)
      then case when lower(left(d.name, 1)) in ('a', 'e', 'i', 'o', 'u') then 'An ' else 'A ' end || lower(d.name)
           || ' does not go down into a cellar.'
    end
  from (select 1) one left join furniture_def d on d.id = p_sub
$$;

/*
 * Where a job's target is, for reach (`targetSpot`): on which side of the
 * ground floor -- the cellar (-1), or the ground and everything over it (0) --
 * and on which tile; or a null side where it is wherever you are.
 */
create or replace function target_spot(p_world uuid, p_action text, p_target jsonb, out floor int, out x int, out y int)
  language plpgsql stable as $$
declare it item;
begin
  case p_target->>'kind'
    when 'crate' then
      select floor_of(c.level), c.x, c.y into floor, x, y from crate c where c.world_id = p_world and c.id = (p_target->>'id')::int;
    when 'furniture' then
      select floor_of(q.level), q.x, q.y into floor, x, y from placed q where q.world_id = p_world and q.id = (p_target->>'id')::bigint;
    when 'ground' then
      floor := case when coalesce((p_target->>'down')::boolean, false) then -1 else 0 end;
      x := (p_target->>'x')::int; y := (p_target->>'y')::int;
    when 'item' then
      -- A shop counter is set in a wall of the ground floor (`counters.ts`): goods go onto it and come off it up top.
      if p_action in ('set_out_goods', 'take_off_counter') then
        floor := 0; x := 0; y := 0;
      -- Going into a store, or coming out of one, is done where the store is.
      elsif p_target ? 'into' then
        if p_action = 'store_in_crate' then
          select floor_of(c.level), c.x, c.y into floor, x, y from crate c where c.world_id = p_world and c.id = (p_target->>'into')::int;
        elsif p_action = 'store_in_furniture' then
          select floor_of(q.level), q.x, q.y into floor, x, y from placed q where q.world_id = p_world and q.id = (p_target->>'into')::bigint;
        end if;
      elsif p_action = 'take_from_store' then
        select * into it from item where world_id = p_world and id = target_item(p_target);
        if it.holder = 'crate' then
          select floor_of(c.level), c.x, c.y into floor, x, y from crate c where c.world_id = p_world and c.id = it.crate;
        elsif it.holder = 'furniture' then
          select floor_of(q.level), q.x, q.y into floor, x, y from placed q where q.world_id = p_world and q.id = it.placed;
        end if;
      end if;
    when 'person' then
      select floor_of(o.level), floor(o.x)::int, floor(o.y)::int into floor, x, y
        from player o where o.world_id = p_world and o.uid = (p_target->>'uid')::uuid;
    when 'tile' then
      if p_action not in ('examine', 'dig_cellar', 'mine_cellar', 'fill_cellar', 'pick_up_all', 'place_crate', 'place_furniture') then
        floor := 0; x := (p_target->>'x')::int; y := (p_target->>'y')::int;
      end if;
    else
      -- A creature, a fire, a forge, a kiln, an anvil, a post, a trap and a bridge are all out on the ground.
      floor := 0; x := 0; y := 0;
  end case;
end $$;

/*
 * Why a job cannot be done from where the body stands, or null
 * (`cellarGate`): a thing in the cellar is reached from the cellar, a thing
 * up top from up top, and from down in a cellar only a thing in that same
 * cellar. And from down there, a crate or a piece is set down on that
 * cellar's floor, and only a piece that may go down there. `p_floor` and
 * `p_cellar` are the body's side of the ground floor and, down there, whose
 * cellar it is in -- read once by `act_refusal`.
 */
create or replace function cellar_gate(p_world uuid, p_uid uuid, p_action text, p_target jsonb, p_floor int, p_cellar int)
  returns text language plpgsql stable as $$
declare v_at record; it item;
begin
  v_at := target_spot(p_world, p_action, p_target);
  if v_at.floor is not null and v_at.floor <> p_floor then
    return case when p_floor < 0 then 'You are down in the cellar. Go up to do that.' else 'That is down in the cellar.' end;
  end if;
  if p_floor >= 0 then return null; end if;
  if v_at.floor is not null and (cellar_at(p_world, v_at.x, v_at.y)).building is distinct from p_cellar then
    return 'That is in another building''s cellar.';
  end if;
  if p_action in ('place_crate', 'place_furniture') and p_target->>'x' is not null then
    if (cellar_at(p_world, (p_target->>'x')::int, (p_target->>'y')::int)).building is distinct from p_cellar
       or not cellar_done(p_world, (p_target->>'x')::int, (p_target->>'y')::int) then
      return 'Set it down on the floor of the cellar you are in.';
    end if;
    if p_action = 'place_furniture' then
      select * into it from item where world_id = p_world and id = target_item(p_target) and holder = 'player' and holder_uid = p_uid;
      if found then return cellar_piece_reason(replace(it.def, 'furniture_', '')); end if;
    end if;
  end if;
  return null;
end $$;

/* ---- The family: dig out, mine out, fill in; and drop and pick up down there -------------------------- */

create or replace function cellar_action(p_action text) returns boolean language sql immutable as $$
  select p_action in ('dig_cellar', 'mine_cellar', 'fill_cellar')
$$;

-- A drop, a pick up or a sweep that happens on a cellar's floor rather than on the ground (`sweepFloor`), and a drop on
-- the head of a way down up top, which is refused (`cellar_refusal`). Asked by the dispatchers of those three alone.
create or replace function cellar_hands(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns boolean
  language sql stable as $$
  select case
    when p_action = 'drop' then exists (select 1 from player pl where pl.world_id = p_world and pl.uid = p_uid
      and (pl.level < 0 or (pl.level = 0 and (flight_down(p_world, floor(pl.x)::int, floor(pl.y)::int)).world_id is not null)))
    when p_action = 'pick_up' then coalesce((p_target->>'down')::boolean, false)
    when p_action = 'pick_up_all' then
      case when p_target->>'kind' = 'ground' then coalesce((p_target->>'down')::boolean, false)
           else exists (select 1 from player pl where pl.world_id = p_world and pl.uid = p_uid and pl.level < 0) end
    else false end
$$;

create or replace function cellar_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns text
  language plpgsql stable as $$
declare v_x int := (p_target->>'x')::int; v_y int := (p_target->>'y')::int; why text; r rock_def;
        v_need double precision; v_mining double precision; it item; p player; d action_def;
begin
  -- The three jobs answer for their own reach, as the ground's jobs do: a tile of the building beside you, either side of its floor.
  if cellar_action(p_action) then
    select * into d from action_def where id = p_action;
    select * into p from player where world_id = p_world and uid = p_uid;
    if not in_reach(p.x, p.y, p_target, d.corner, d.range) then return 'You are too far away from that.'; end if;
  end if;
  if p_action in ('dig_cellar', 'mine_cellar') then
    why := cellar_dig_reason(p_world, p_uid, p_target);
    if why is not null then return why; end if;
    if p_action = 'dig_cellar' then
      if cellar_rock_next(p_world, v_x, v_y) then
        return 'The soil is dug through here, ' || coalesce((cellar_at(p_world, v_x, v_y)).dug, 0) || ' down. The rest is rock, for a pickaxe.';
      end if;
      return case when pack_count(p_world, p_uid, 'shovel') > 0 then null else 'You need a shovel to dig.' end;
    end if;
    if not cellar_rock_next(p_world, v_x, v_y) then
      return 'There is soil to dig out here first, ' || (cellar_soil(p_world, v_x, v_y) - coalesce((cellar_at(p_world, v_x, v_y)).dug, 0))
        || ' of it, for a shovel.';
    end if;
    if pack_count(p_world, p_uid, 'pickaxe') <= 0 then return 'You need a pickaxe to mine.'; end if;
    -- A seam under the building gives up its metal only to somebody who knows how to take it, as a face of it would.
    r := bedrock_at(p_world, v_x, v_y);
    v_need := greatest(0, r.level - pk(p_world, p_uid, 'ore:below', 0));
    v_mining := skill_of(p_world, p_uid, 'mining');
    if r.ore and v_mining < v_need then
      return r.name || ' needs mining ' || rtrim(rtrim(to_char(v_need, 'FM990.99'), '0'), '.')
        || ' to work. Yours is ' || to_char(v_mining, 'FM990.0') || '.';
    end if;
    return null;
  end if;

  if p_action = 'fill_cellar' then
    why := cellar_fill_reason(p_world, p_uid, p_target);
    if why is not null then return why; end if;
    if pack_count(p_world, p_uid, 'shovel') <= 0 then return 'You need a shovel to fill it in.'; end if;
    if spoil_near(p_world, p_uid, null) is null then
      return 'You need dirt, clay or sand to fill it in, in the pack or in something beside you.';
    end if;
    return null;
  end if;

  -- Down there, as the hands family asks it up top (`hands_refusal`).
  if p_action = 'drop' then
    -- Not on the head of a way down, up top: what is let go of there would lie over the stairwell (`dropRefusal`).
    select * into p from player where world_id = p_world and uid = p_uid;
    if p.level >= 0 then
      return case (flight_down(p_world, floor(p.x)::int, floor(p.y)::int)).kind
        when 'ladder' then 'Not on the ladder: step off it first.' else 'Not on the stairs: step off them first.' end;
    end if;
    select * into it from item where world_id = p_world and id = target_item(p_target) and holder = 'player' and holder_uid = p_uid;
    if not found then return 'It is gone.'; end if;
    if it.locked then return 'You have set that aside. Put it back in the pack first.'; end if;
    return null;
  end if;
  if p_action in ('pick_up', 'pick_up_all') then
    if v_x is null or v_y is null then return 'There is nothing there.'; end if;
    select * into d from action_def where id = p_action;
    select * into p from player where world_id = p_world and uid = p_uid;
    if not in_reach(p.x, p.y, p_target, d.corner, d.range) then return 'You are too far away from that.'; end if;
    if p_action = 'pick_up' and not exists (select 1 from item i where i.world_id = p_world
         and i.holder = 'cellar' and i.gx = v_x and i.gy = v_y) then
      return 'There is nothing there any more.';
    end if;
    if p_action = 'pick_up_all' and not exists (select 1 from item i where i.world_id = p_world and i.holder = 'cellar'
         and abs(i.gx - v_x) <= sweep_range() and abs(i.gy - v_y) <= sweep_range()
         and (cellar_at(p_world, i.gx, i.gy)).building = (cellar_at(p_world, floor(p.x)::int, floor(p.y)::int)).building) then
      return 'There is nothing lying about here.';
    end if;
    return null;
  end if;
  return null;
end $$;

create or replace function perform_cellar(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns void
  language plpgsql as $$
declare v_x int := (p_target->>'x')::int; v_y int := (p_target->>'y')::int; d action_def; p player;
        s double precision; tq double precision; tool_id bigint; v_b int; v_dug int; r rock_def;
        made_ql double precision; v_def text; it item; v_want int; v_took bigint[]; v_row record;
begin
  select * into d from action_def where id = p_action;
  select * into p from player where world_id = p_world and uid = p_uid;

  if cellar_action(p_action) then
    s := case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end;
    tq := case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end;
    select i.id into tool_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = d.tool
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id); end if;
  end if;

  if p_action = 'dig_cellar' then
    if not skill_check(s, d.difficulty, tq) then
      perform skill_raise(p_world, p_uid, d.skill, try_gain(false));
      perform tell(p_world, p_uid, 'You fail to dig anything useful.', 'event');
      return;
    end if;
    v_b := building_at(p_world, v_x, v_y);
    insert into cellar_tile (world_id, x, y, building, dug) values (p_world, v_x, v_y, v_b, 1)
      on conflict (world_id, x, y) do update set dug = least(cellar_depth()::int, cellar_tile.dug + 1)
      returning dug into v_dug;
    made_ql := product_ql(s, tq);
    perform gather(p_world, p_uid, 'dirt', 1, made_ql);
    perform tell(p_world, p_uid, 'You dig out some dirt from under the ground floor: ' || v_dug || ' of '
      || cellar_depth()::int || ' down. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    perform maybe_map(p_world, p_uid, s, tq);
    perform skill_raise(p_world, p_uid, d.skill, 1);
    if v_dug >= cellar_depth() then
      perform tell(p_world, p_uid, 'The cellar is dug out here, the whole ' || cellar_depth()::int || ' down.', 'event');
    elsif cellar_rock_next(p_world, v_x, v_y) then
      perform tell(p_world, p_uid, 'Your shovel grates on rock ' || v_dug || ' down. The rest is for a pickaxe.', 'event');
    end if;
    perform land_announce(p_world, v_x, v_y);

  elsif p_action = 'mine_cellar' then
    if not skill_check(s, d.difficulty, tq) then
      perform skill_raise(p_world, p_uid, d.skill, try_gain(false));
      perform tell(p_world, p_uid, 'The rock is hard and you fail to loosen anything.', 'event');
      return;
    end if;
    v_b := building_at(p_world, v_x, v_y);
    insert into cellar_tile (world_id, x, y, building, dug) values (p_world, v_x, v_y, v_b, 1)
      on conflict (world_id, x, y) do update set dug = least(cellar_depth()::int, cellar_tile.dug + 1)
      returning dug into v_dug;
    -- What the rock under the building gives, as a face of it would: shards, or the ore of a seam.
    r := bedrock_at(p_world, v_x, v_y);
    if r.yields like '%\_ore' then perform journal_note(p_world, p_uid, 'ore'); end if;
    made_ql := least(ore_max_ql((select seed from world where id = p_world), v_x, v_y), product_ql(s, tq));
    perform gather(p_world, p_uid, r.yields, 1, made_ql);
    perform tell(p_world, p_uid, 'You cut some ' || lower((select coalesce(name, r.yields) from item_def where id = r.yields))
      || ' out of the rock under the ground floor: ' || v_dug || ' of ' || cellar_depth()::int
      || ' down. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    perform maybe_map(p_world, p_uid, s, tq);
    perform maybe_gem(p_world, p_uid, s, tq);
    perform skill_raise(p_world, p_uid, d.skill, 1);
    if v_dug >= cellar_depth() then
      perform tell(p_world, p_uid, 'The cellar is dug out here, the whole ' || cellar_depth()::int || ' down.', 'event');
    end if;
    perform land_announce(p_world, v_x, v_y);

  elsif p_action = 'fill_cellar' then
    v_def := spoil_near(p_world, p_uid, null);
    if v_def is null or not take_spoil(p_world, p_uid, v_def) then return; end if;
    select c.dug - 1 into v_dug from cellar_tile c where c.world_id = p_world and c.x = v_x and c.y = v_y for update;
    if v_dug is null then return; end if;
    if v_dug <= 0 then
      delete from cellar_tile where world_id = p_world and x = v_x and y = v_y;
      perform tell(p_world, p_uid, 'You pack the last of the ' || lower((select name from item_def where id = v_def))
        || ' in, and the ground under the floor here is whole again.', 'event');
    else
      update cellar_tile set dug = v_dug where world_id = p_world and x = v_x and y = v_y;
      perform tell(p_world, p_uid, 'You pack ' || lower((select name from item_def where id = v_def))
        || ' back in under the ground floor: ' || v_dug || ' of ' || cellar_depth()::int || ' down.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, d.skill, 1);
    perform land_announce(p_world, v_x, v_y);

  elsif p_action = 'drop' then
    -- Onto the cellar's floor, where things keep longest (`cellar_decay`): `perform_hands` has it up top.
    select * into it from item where world_id = p_world and id = target_item(p_target)
      and holder = 'player' and holder_uid = p_uid;
    if not found or p.level >= 0 or not cellar_done(p_world, floor(p.x)::int, floor(p.y)::int) then return; end if;
    v_want := least(greatest(1, coalesce((p_target->>'count')::int, 1)), it.count);
    if v_want >= it.count then
      update item set holder = 'cellar', holder_uid = null, gx = floor(p.x)::int, gy = floor(p.y)::int,
          locked = false, made_at = now(), cool = nullif(case when (select dd.category from item_def dd where dd.id = it.def) = 'food'
                          then pk(p_world, p_uid, 'cool:food', 1) else 1 end * pk(p_world, p_uid, 'cool:' || it.def, 1), 1),
          rot_at = null
        where id = it.id;
    else
      update item set count = it.count - v_want where id = it.id;
      insert into item (world_id, holder, gx, gy, def, ql, dmg, count, extra, rare, dye, bless, maker, piece, mark, cool)
      values (p_world, 'cellar', floor(p.x)::int, floor(p.y)::int, it.def, it.ql, it.dmg, v_want, it.extra,
              it.rare, it.dye, it.bless, it.maker, it.piece, it.mark,
              nullif(case when (select dd.category from item_def dd where dd.id = it.def) = 'food'
                          then pk(p_world, p_uid, 'cool:food', 1) else 1 end * pk(p_world, p_uid, 'cool:' || it.def, 1), 1));
    end if;
    perform tell(p_world, p_uid, 'You drop '
      || case when v_want > 1 then v_want || ' × ' || lower(item_name(it)) else 'the ' || lower(item_name(it)) end
      || ' on the cellar floor.', 'event');
    perform land_announce(p_world, floor(p.x)::int, floor(p.y)::int);

  elsif p_action = 'pick_up' then
    select * into it from item where world_id = p_world and holder = 'cellar'
      and gx = v_x and gy = v_y and (target_item(p_target) is null or id = target_item(p_target))
      order by id limit 1;
    if not found then return; end if;
    update item set holder = 'player', holder_uid = p_uid, gx = null, gy = null, cool = null where id = it.id;
    perform pack_fold_one(it.id);
    perform tell(p_world, p_uid, 'You pick up ' ||
      case when it.count > 1 then it.count || ' × ' else '' end || lower(item_name(it)) || '.', 'event');
    perform land_announce(p_world, v_x, v_y);

  elsif p_action = 'pick_up_all' then
    for v_row in select i.id, i.gx, i.gy from item i
      where i.world_id = p_world and i.holder = 'cellar'
        and abs(i.gx - v_x) <= sweep_range() and abs(i.gy - v_y) <= sweep_range()
        and (cellar_at(p_world, i.gx, i.gy)).building = (cellar_at(p_world, floor(p.x)::int, floor(p.y)::int)).building
      order by (i.gx - v_x) ^ 2 + (i.gy - v_y) ^ 2, i.id
    loop
      update item set holder = 'player', holder_uid = p_uid, gx = null, gy = null, cool = null where id = v_row.id;
      v_took := v_took || v_row.id;
      perform land_announce(p_world, v_row.gx, v_row.gy);
    end loop;
    if v_took is null then
      perform tell(p_world, p_uid, 'There is nothing lying about here.', 'error');
    else
      perform tell(p_world, p_uid, 'You gather up ' || pile_text(v_took) || '.', 'event');
      perform pack_fold(p_world, p_uid);
    end if;
  end if;
end $$;

/* ---- Setting things down, rotting, and what a browser is told ----------------------------------------- */

-- What is set down in a go taken in a cellar is down there: a crate or a piece placed from down there.
create or replace function cellar_set_down() returns trigger language plpgsql as $$
begin
  if actor_floor() < 0 and coalesce(current_setting('wurm.pk_act', true), '') in ('place_crate', 'place_furniture') then
    new.level := -1;
  end if;
  return new;
end $$;
drop trigger if exists crate_cellar_set_down on crate;
create trigger crate_cellar_set_down before insert on crate for each row execute function cellar_set_down();
drop trigger if exists placed_cellar_set_down on placed;
create trigger placed_cellar_set_down before insert on placed for each row execute function cellar_set_down();

/*
 * What lies on a cellar's floor, rotted as `ground_sweep` rots the ground --
 * charged in steps, the oldest first, at most `ground_rows()` a round -- at
 * `cellar_decay()` of the outdoor rate in place of the indoor tenth, and the
 * deed's tenth on top (`Game.decayMultiplier` at `CELLAR_LEVEL`). A round
 * with nothing due reads one index and nothing else.
 */
create or replace function cellar_sweep(p_world uuid) returns integer language plpgsql as $$
declare v_n int; v_gone bigint[];
begin
  with due as (
    select i.id, i.rot_at, i.gx, i.gy, i.def from item i
     where i.world_id = p_world and i.holder = 'cellar'
       and coalesce(i.rot_at, '-infinity'::timestamptz) <= now() - ground_step()
     order by coalesce(i.rot_at, '-infinity'::timestamptz)
     limit ground_rows()
  ),
  held as (
    update item h set dmg = least(100, h.dmg + ground_decay_rate(h) * cellar_decay_multiplier(p_world, due.gx, due.gy)
                                   * d.shelter * extract(epoch from (now() - due.rot_at)) / 3600)
      from due join item_def d on d.id = due.def
     where h.inside = due.id and h.holder = 'bag' and due.rot_at is not null and d.shelter is not null
    returning h.id, h.dmg
  ),
  charged as (
    update item i set
        dmg = least(100, i.dmg + case when i.rot_at is null then 0
                     else ground_decay_rate(i) * cellar_decay_multiplier(p_world, i.gx, i.gy)
                          * extract(epoch from (now() - i.rot_at)) / 3600 end),
        rot_at = now()
      from due where i.id = due.id
    returning i.id
  )
  select (select count(*) from charged), (select array_agg(id) from held where dmg >= 100) into v_n, v_gone;
  delete from item where world_id = p_world and holder = 'cellar' and dmg >= 100;
  if v_gone is not null then delete from item where id = any(v_gone); end if;
  return v_n;
end $$;

-- What a cellar is worth to what lies in it: the deed's tenth, and `cellar_decay()` in place of the indoor tenth.
create or replace function cellar_decay_multiplier(p_world uuid, p_x int, p_y int) returns double precision
  language sql stable as $$
  select (case when on_deed(p_world, p_x, p_y) then 0.1 else 1 end) * cellar_decay()
$$;

-- The cellar tiles under the buildings that are sent, for `rpc_ground`'s `buildings` (`BuildingsJSON.cellars`).
create or replace function cellars_near(p_world uuid, p_x double precision, p_y double precision, p_range double precision)
  returns jsonb language sql stable as $$
  select coalesce((select jsonb_agg(jsonb_build_object('building', c.building, 'x', c.x, 'y', c.y, 'dug', c.dug)
                     order by c.y, c.x)
    from cellar_tile c
    where c.world_id = p_world
      and c.building in (select bt.building from building_tile bt
                          where bt.world_id = p_world
                            and greatest(abs(bt.x + 0.5 - p_x), abs(bt.y + 0.5 - p_y)) <= p_range)), '[]'::jsonb)
$$;

/*
 * Whether a walk into, out of or about a cellar holds (`Game.cellarStep`),
 * from where the body was last said to be (`p_fx`, `p_fy`, on `p_from`) to
 * where it says it is now (`p_x`, `p_y`, on `p_to`):
 *
 *   * about the cellar: onto a finished tile of the same cellar -- the cellar
 *     of the building next door is the far side of solid ground;
 *   * down: off a finished flight or ladder down, across the side it is
 *     climbed from, onto its foot, and with nothing in tow and no mount;
 *   * up: onto a finished flight or ladder down, off its foot.
 *
 * The browser says where it is at once whenever it stands on a flight's tile
 * up top or on its foot down there (`Island.move`), so the tile it was last
 * said to be on is the one it changes storey from. Asked by `rpc_move` only of
 * a body in a cellar or going into one, so a walk up top pays nothing for it:
 * a read or two by key down there. The corners of the earth round a cellar
 * are not asked about, as walls are not up top: a body is said to be where it
 * is a second apart, and the line between two of those cuts the corner of
 * every turn it took.
 */
create or replace function cellar_move_ok(p_world uuid, p_uid uuid, p_from int, p_to int,
    p_fx double precision, p_fy double precision, p_x double precision, p_y double precision)
  returns boolean language plpgsql stable as $$
declare v_fx int := floor(p_fx)::int; v_fy int := floor(p_fy)::int; v_x int := floor(p_x)::int; v_y int := floor(p_y)::int;
        c cellar_tile; f floor_tile;
begin
  if p_to >= 0 and p_from >= 0 then return true; end if;
  if p_to < 0 then
    c := cellar_at(p_world, v_x, v_y);
    if c.world_id is null or c.dug < cellar_depth() then return false; end if;
    if p_from < 0 then
      return (v_x = v_fx and v_y = v_fy) or c.building = (cellar_at(p_world, v_fx, v_fy)).building;
    end if;
    -- Down: nothing in tow goes down a flight, and nobody rides or drives down one.
    if exists (select 1 from placed q where q.world_id = p_world and (q.puller = p_uid or q.driver = p_uid))
       or (mount_of(p_world, p_uid)).id is not null then
      return false;
    end if;
    f := flight_down(p_world, v_fx, v_fy);
    return f.world_id is not null and f.building = c.building and (v_x, v_y) = cellar_foot(v_fx, v_fy, f.facing);
  end if;
  -- Up: onto the flight, off its foot, to the ground floor.
  f := flight_down(p_world, v_x, v_y);
  return p_to = 0 and f.world_id is not null and (v_fx, v_fy) = cellar_foot(v_x, v_y, f.facing);
end $$;

-- The tile at the foot of a flight or a ladder down on a tile: across the side it is climbed from (`across`).
create or replace function cellar_foot(p_x int, p_y int, p_facing text, out x int, out y int) language sql immutable as $$
  select p_x + case coalesce(p_facing, 's') when 'w' then -1 when 'e' then 1 else 0 end,
         p_y + case coalesce(p_facing, 's') when 'n' then -1 when 's' then 1 else 0 end
$$;


/* ---- The shared functions, each with the cellar's lines put in (marked `cellar`) ---------------- */

CREATE OR REPLACE FUNCTION public.act_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare why text; was_pk text; was_act text; was_floor text; v_fx jsonb; v_floor int; v_cellar int; -- cellar
begin
  why := body_refusal(p_world, p_uid, p_action);
  if why is not null then return why; end if;
  -- A grave opens for whoever lies under it, and only to be emptied.
  why := grave_refusal(p_world, p_uid, p_action, p_target);
  if why is not null then return why; end if;
  -- cellar: the body's perks and its side of the ground floor, in the one read of its row (the perks were read below).
  select pl.class_mul->'fx', floor_of(pl.level), -- cellar
         case when pl.level < 0 then (cellar_at(p_world, floor(pl.x)::int, floor(pl.y)::int)).building end -- cellar
    into v_fx, v_floor, v_cellar from player pl where pl.world_id = p_world and pl.uid = p_uid; -- cellar
  v_floor := coalesce(v_floor, 0); -- cellar
  -- cellar: a thing down in the cellar is reached from down there, a thing up top from up top, and from one cellar
  -- cellar: nothing in the cellar next door -- asked down there, or of the five kinds of thing that can be down there.
  if v_floor < 0 or p_target->>'kind' in ('crate', 'furniture', 'ground', 'item', 'person') then -- cellar
    why := cellar_gate(p_world, p_uid, p_action, p_target, v_floor, v_cellar); -- cellar
    if why is not null then return why; end if; -- cellar
  end if; -- cellar
  /*
   * The go's perks, for the rules too deep to be handed the body (`pkx`), as
   * the clock sets them for a go: so a Smith's Forge Reach reaches the same
   * stores for the refusal as for the go. Put back as they were after.
   */
  was_pk := current_setting('wurm.pk', true);
  was_act := current_setting('wurm.pk_act', true);
  perform set_config('wurm.pk', coalesce(v_fx, '{}'::jsonb)::text, true); -- cellar: read above, with the storey
  perform set_config('wurm.pk_act', coalesce(p_action, ''), true);
  -- cellar: and the side of the ground floor it is asked from (`actor_floor`, `actor_cellar`), put back after.
  was_floor := current_setting('wurm.floor', true); -- cellar
  perform set_config('wurm.floor', v_floor || ':' || coalesce(v_cellar::text, ''), true); -- cellar
  why := act_refusal_rules(p_world, p_uid, p_action, p_target);
  perform set_config('wurm.floor', coalesce(was_floor, ''), true); -- cellar
  perform set_config('wurm.pk', coalesce(was_pk, ''), true);
  perform set_config('wurm.pk_act', coalesce(was_act, ''), true);
  return why;
end $function$;

CREATE OR REPLACE FUNCTION public.settle(p_world uuid, p_uid uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare p player; d action_def; done int := 0; guard int := 0; nxt jsonb; ended timestamptz;
        v_err text; v_state text; v_where text;
begin
  /*
   * One body's work, and nobody else's.
   *
   * Everything below used to run bare, and `world_tick` settles every body on
   * every island in one transaction: one go that raised an error took the
   * whole round down with it, every second, for as long as that job was
   * still due. Reported as "something just broke, no actions are working":
   * `take_spoil` set the last spadeful in a cart to a count of 0, which the
   * item table refuses, and for a quarter of an hour nothing anybody did on
   * the island finished.
   *
   * So the goes run in a block of their own. A fault undoes what the block
   * had done -- the goes that had come due in this call, and nothing else --
   * stops that job and the queue behind it, tells its owner what the island
   * said, and is kept in `private.tick_fault` for the deploy to report. A
   * deadlock, a lock that timed out or a serialization failure is not a
   * fault in the job: those are raised as before, and the job is tried again
   * next round. A statement timeout is not caught by `others` at all.
   */
  begin
    perform wounds_settle(p_world, p_uid);
    perform body_settle(p_world, p_uid);
    select * into p from player where world_id = p_world and uid = p_uid for update;
    if not found or p.act is null then return 0; end if;
    /*
     * Twenty-five goes to a call, not two hundred.
     *
     * This is the one way a round of the clock can run long: somebody back from
     * an hour away is owed hundreds of goes, and at two hundred apiece — inside
     * `tick_players` inside `tick_worlds` — one person's backlog is the whole
     * tick. It mattered less at five seconds. It matters at one.
     *
     * Nothing is lost by taking less at a time: what is still due is still due,
     * and there is another round a second from now, plus the browser's own beat
     * the moment its job comes up. A backlog drains in seconds either way; the
     * difference is whether everybody else waits while it does.
     */
    while p.act is not null and p.act_ends <= now() and guard < 25 loop
      guard := guard + 1;
      -- A go, for what the baubles make of its yield (`bauble_yield`), and
      -- what they made of it said after the go has said its own piece.
      perform set_config('wurm.bauble_go', 'go', true);
      perform set_config('wurm.bauble_made', '', true);
      -- And the perks, for the rules too deep to be handed the body: for
      -- this go and no other (`pkx`), cleared the moment it is done.
      perform set_config('wurm.pk', coalesce(p.class_mul->'fx', '{}'::jsonb)::text, true);
      perform set_config('wurm.pk_act', p.act, true);
      perform set_config('wurm.floor', floor_said(p_world, p.level, p.x, p.y), true); -- cellar: the side the go is taken on
      perform act_perform(p_world, p_uid, p.act, p.act_target);
      perform set_config('wurm.pk', '', true);
      perform set_config('wurm.pk_act', '', true);
      perform set_config('wurm.floor', '', true); -- cellar
      perform bauble_said(p_world, p_uid);
      -- And what the go took out of you, which nothing over here had ever
      -- charged: `action_def.stamina` was a column no function read.
      perform spend_wind(p_world, p_uid, p.act);
      done := done + 1;
      select * into d from action_def where id = p.act;
      ended := p.act_ends;
      if p.act_left > 1 and act_refusal(p_world, p_uid, p.act, p.act_target) is null then
        update player set act_left = act_left - 1, act_started = ended,
               act_ends = ended + make_interval(secs => act_duration(
                 d.base_time,
                 case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end,
                 job_tool_ql(coalesce(p.class_mul, '{}'::jsonb), p_world, p_uid, d.id, d.tool),
                 -- The body's own pace, and then the trade's, which tells only
                 -- on the skill this job is done with.
                 control_speed(p_world, p_uid)
                   * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands',
                               act_scope(p_world, p_uid, d.skill)) * bauble_pace(p_world, p_uid, d.skill))
                 -- And a perk on the job's time, after the floor.
                 * perk_time(coalesce(p.class_mul, '{}'::jsonb), p_world, d.id, p.act_target)
                 * piece_pace(p_world, p_uid, d.skill))
          where world_id = p_world and uid = p_uid returning * into p;
      else
        if p.act_left > 1 then
          -- Why, when there is a why. A run of goes that stops because the wind
          -- gave out should say so rather than leave somebody wondering what
          -- they did wrong, which is what the browser has always said.
          perform tell(p_world, p_uid,
            coalesce(act_refusal(p_world, p_uid, p.act, p.act_target) || ' That was '
                     || (coalesce(p.act_left, 1)) || ' to go.',
                     'You stop ' || d.verb || '.'), 'info');
        end if;
        /*
         * The next job in the line, or the first one behind it that can be done.
         *
         * Reported: "queued up multiple chopping actions, then after the tree
         * was felled and no actions were running I'd dig up the stump and it
         * would show a cutting action following that I didn't queue." The
         * second chop, popped once the tree was down, was refused and put out of
         * the line — and the third stayed in it, behind an empty hand, until the
         * next thing asked for was done and it came up as "then". A refusal puts
         * that job out of the line and asks the next, as the browser's
         * `nextInQueue` has always done, until one starts or the line is empty.
         */
        loop
          nxt := p.act_queue -> 0;
          -- Another onion will do. See `act_retarget`: only when the row it named
          -- has gone, and only to another of what it was.
          nxt := act_retarget(p_world, p_uid, nxt);
          if nxt is null then
            update player set act = null, act_target = null, act_started = null, act_ends = null,
                   act_left = null, act_goes = null
              where world_id = p_world and uid = p_uid returning * into p;
            exit;
          end if;
          select * into d from action_def where id = nxt->>'action';
          if d is null or act_refusal(p_world, p_uid, nxt->>'action', nxt->'target') is not null then
            perform tell(p_world, p_uid,
              coalesce(act_refusal(p_world, p_uid, nxt->>'action', nxt->'target'), 'That cannot be done now.'), 'error');
            update player set act = null, act_target = null, act_started = null, act_ends = null,
                   act_left = null, act_goes = null, act_queue = act_queue - 0
              where world_id = p_world and uid = p_uid returning * into p;
            -- And the one behind it.
          else
            update player set act = nxt->>'action', act_target = nxt->'target',
                   act_left = greatest(1, coalesce((nxt->>'goes')::int, 1)),
                   -- What was asked for, carried out of the queue with the job.
                   -- Without it the browser was left holding the count of
                   -- whatever ran *before* this one, and the bar drew "3 of 10"
                   -- off two numbers from different jobs.
                   act_goes = greatest(1, coalesce((nxt->>'goes')::int, 1)),
                   act_started = ended,
                   act_ends = ended + make_interval(secs => act_duration(
                     d.base_time,
                     case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end,
                     job_tool_ql(coalesce(p.class_mul, '{}'::jsonb), p_world, p_uid, d.id, d.tool),
                     control_speed(p_world, p_uid)
                       * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands',
                                   act_scope(p_world, p_uid, d.skill)) * bauble_pace(p_world, p_uid, d.skill))
                     * perk_time(coalesce(p.class_mul, '{}'::jsonb), p_world, d.id, nxt->'target')
                     * piece_pace(p_world, p_uid, d.skill)),
                   act_queue = act_queue - 0
              where world_id = p_world and uid = p_uid returning * into p;
            perform tell(p_world, p_uid, 'You start ' || d.verb || '.', 'info');
            exit;
          end if;
        end loop;
      end if;
    end loop;
    return done;
  exception
    when deadlock_detected or lock_not_available or serialization_failure then raise;
    when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_where = pg_exception_context;
      perform settle_fault(p_world, p_uid, v_err, v_state, v_where);
      return 0;
  end;
end $function$;

CREATE OR REPLACE FUNCTION public.act_refusal_rules(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare d action_def; p player; cx int; cy int; tx int; ty int; t tile_def; aimed text;
begin
  select * into d from action_def where id = p_action;
  if not found then return 'There is no such thing as ' || p_action || '.'; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 'You are not on this island.'; end if;
  -- Deliberately not "are you busy": asked of queued jobs too. That is rpc_act's.
  if not act_ported(p_action) then
    return 'You cannot ' || lower(d.label) || ' on this island yet.';
  end if;

  -- A crate with a wildermon in it is carried, set down or opened, and that is all.
  aimed := occupied_crate_refusal(p_world, p_uid, p_action, p_target);
  if aimed is not null then return aimed; end if;
  aimed := p_target->>'kind';
  -- Whose ground it is, before anything about what it is made of.
  aimed := ground_deed_refusal(p_world, p_uid, p_action, p_target);
  if aimed is not null then return aimed; end if;
  aimed := p_target->>'kind';
  -- Shop counters and lantern posts (`counters.ts`, `lamps.ts`), and a lantern post lifted with its lantern in it.
  if counter_action(p_action) then return counter_refusal(p_world, p_uid, p_action, p_target); end if;
  if lamp_action(p_action) then return lamp_refusal(p_world, p_uid, p_action, p_target); end if;
  if lamp_lift_refusal(p_world, p_uid, p_action, p_target) is not null then return lamp_lift_refusal(p_world, p_uid, p_action, p_target); end if;
  -- The hour comes for a dam in young whoever is or is not standing there, and
  -- somebody is always about to do something. This is where they find out.
  perform herd_settle(p_world);
  -- cellar: digging out, mining out and filling in a cellar, and a drop, a pick up or a sweep down there.
  if cellar_action(p_action) or (p_action in ('drop', 'pick_up', 'pick_up_all') and cellar_hands(p_world, p_uid, p_action, p_target)) then
    return cellar_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A spring answers for its own reach, its own tool and whose spring it is.
  if spring_action(p_action) then
    return spring_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- An aqueduct answers for its own reach and both its ends, and for a bridge's job aimed at one.
  if aqueduct_aimed(p_world, p_action, p_target) then
    return aqueduct_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- And wildflowers for their own reach, their season and whether they are picked.
  if flower_action(p_action) then
    return flower_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Ivy and moss answer for their own reach: a statue and a bridge are not tiles.
  if green_action(p_action) then
    return green_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Stepping stones and water plants answer for their own reach, as a spring does.
  if water_garden_action(p_action) then
    return water_garden_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- The last ten answer for their own reach, every one of them: a bridge is
  -- worked from either bank, a bed is furniture, and a beast is not at a tile.
  -- First of all, because a map is an item and every other family that takes
  -- an item wants one it can name a use for. This one is aimed at the map.
  if treasure_action(p_action) then
    return treasure_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if last_action(p_action) then
    return last_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Then the only family that does not care what it is
  -- pointed at: a prayer wants an altar, a cast wants a name, and the other
  -- three want nothing but the ground you are sitting on.
  if faith_action(p_action) then
    return faith_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Then the ones asked of a beast, which is not at a
  -- tile, and half of a cart, which is furniture and would otherwise be handed
  -- to the code that lights fires. Both answer for their own reach.
  if ride_action(p_action) then
    return ride_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if hands_action(p_action) then
    return hands_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Before the one that lights fires, which is what pointing at furniture has
  -- meant up to now: a barrel is furniture too, and tipping it out is not a fire.
  if liquid_action(p_action) then
    return liquid_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Also before the one that lights fires: an oven is furniture and an anvil
  -- is pointed at the same way a kiln is, and neither wants that route.
  if forge_action(p_action) then
    return forge_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if holding_action(p_action) then
    return holding_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- The token is under your feet and a post answers for its own reach, so
  -- neither wants the reach check below.
  if settlement_action(p_action) then
    return settlement_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if dig_action(p_action) then
    return dig_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A trap answers for its own reach, and rolls itself forward before it
  -- answers anything at all.
  if trap_action(p_action) then
    return trap_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Working the ground answers for its own reach for the same reason: a
  -- corner is a place rather than a thing, and `drop_dirt` names one.
  if ground_action(p_action) then
    if not in_reach(p.x, p.y, p_target, d.corner, d.range) then return 'You are too far away from that.'; end if;
    if d.tool is not null and tool_ql(p_world, p_uid, d.tool) <= 0 then
      return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || ' to ' || lower(d.label) || '.';
    end if;
    -- Nothing is planted under an aqueduct's arches: a tree would grow up through them.
    if p_action = 'plant' and aqueduct_over(p_world, (p_target->>'x')::int, (p_target->>'y')::int) then return 'An aqueduct is carried over that tile.'; end if;
    return ground_refusal(p_world, p_uid, p_action, p_target);
  end if;
  /*
   * A furnace is brought up to date before anything asks it a question: its
   * fire and its queue together, so that "is anything finished" is answered
   * about now rather than about whenever somebody last stood here.
   */
  if aimed in ('smelter', 'kiln') then
    perform furnace_settle(p_world, nullif(p_target->>'id', '')::bigint);
  end if;
  if item_action(p_action) then
    return item_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if firing_action(p_action) then
    return firing_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if aimed in ('campfire', 'smelter', 'kiln', 'furniture', 'anvil') or fire_action(p_action) then
    return fire_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A crate is reached for rather than stood in front of, so it answers for
  -- its own reach the way the creatures do.
  if crate_action(p_action) then
    return crate_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Fitting a padlock and taking one off: aimed at a crate or at a piece of
  -- furniture, so it sits beside the family that answers for crates.
  if p_action in ('fit_lock', 'take_off_lock') then
    return lock_refusal_for(p_world, p_uid, p_action, p_target);
  end if;
  -- The stake is in your hand and the ground is under your feet: nothing to reach for.
  if p_action = 'found_settlement' then
    return deed_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A creature is not at a tile, it is wherever its last leg left it, so the
  -- reach check below cannot answer for it. Both of these do their own; the
  -- fighting ones reach as far as what is in your hand, which is further.
  if creature_action(p_action) then
    return creature_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if fight_action(p_action) then
    return fight_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A line and a net reach as far as their Fisher casts and drags them (a Long Cast, a Wide Net).
  if not in_reach(p.x, p.y, p_target, d.corner, case p_action when 'fish' then cast_reach(p_world, p_uid)::real
                                                                when 'drag_net' then net_reach(p_world, p_uid)::real
                                                                else d.range end) then
    return 'You are too far away from that.';
  end if;
  if d.tool is not null and tool_ql(p_world, p_uid, d.tool) <= 0 then
    return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || ' to ' || lower(d.label) || '.';
  end if;
  if foundation_action(p_action) then
    return foundation_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if build_action(p_action) then
    return build_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('mine', 'chip_corner', 'pack', 'cultivate', 'pave_cobble', 'drop_dirt_here') then
    return terrain_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('cut_down', 'forage', 'botanize', 'collect') then
    return gather_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if farm_action(p_action) then
    return farm_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('fish', 'drag_net') then
    return fish_refusal(p_world, p_uid, p_action, p_target);
  end if;

  if exists (select 1 from recipe where id = p_action) then
    return craft_refusal(p_world, p_uid, p_action, target_item(p_target));
  end if;

  if p_action = 'dig' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    if t.dig_yield is null then return 'You cannot dig that.'; end if;
    -- cellar: not a corner of a building, nor of the cellar under one (`cornerUnderBuilding`, as the browser asks it).
    aimed := corner_under_building(p_world, cx, cy); -- cellar
    if aimed is not null then return aimed; end if; -- cellar
    -- Piers: not under a building, a tile on piers among them, as the browser has it (`cornerUnderBuilding`).
    aimed := corner_under_building(p_world, cx, cy);
    if aimed is not null then return aimed; end if;
    /*
     * The same depth a pick works to. This was the exact line `terrain_refusal`
     * condemns in its own comment — `<= 0` refuses a corner standing at the
     * waterline, where no water is drawn — and mining was fixed for it while
     * digging was left with it.
     */
    -- Deeper for a Terraformer who wades.
    if land_height(p_world, cx, cy) < -pk(p.class_mul, 'depth:dig', mine_depth()) then
      return 'The water is too deep here to work in.';
    end if;
    if land_dirt(p_world, cx, cy) <= 0 then
      return 'That corner is bare rock. Only a pickaxe will take it lower.';
    end if;
    return coalesce(level_stop(p_world, p_uid, cx, cy, -1),
                    slope_refusal(p_world, p_uid, 'digging', cx, cy, -1));
  end if;
  -- A Miner's Pan: sand with water at one of its corners, and the perk to work it.
  if p_action = 'pan' then
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    if pk(p.class_mul, 'pan', 0) <= 0 then
      return 'That wants a Miner who has learned to pan.';
    end if;
    if land_tile(p_world, tx, ty) <> tile_id('Sand') then return 'Panning is done on sand.'; end if;
    if not exists (select 1 from tile_corners(tx, ty) c where land_height(p_world, c.cx, c.cy) < 0) then
      return 'There is no water at this sand to wash it in.';
    end if;
    return null;
  end if;
  -- A Terraformer's Dig out the tile: every corner of it asked what a dig asks.
  if p_action = 'dig_tile' then
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    if pk(p.class_mul, 'dig_tile', 0) <= 0 then
      return 'That wants a Terraformer who has learned to dig out a whole tile.';
    end if;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    if t.dig_yield is null then return 'You cannot dig that.'; end if;
    for cx, cy in select c.cx, c.cy from tile_corners(tx, ty) c loop
      aimed := corner_under_building(p_world, cx, cy);
      if aimed is not null then return aimed; end if;
      if land_height(p_world, cx, cy) < -pk(p.class_mul, 'depth:dig', mine_depth()) then
        return 'The water is too deep here to work in.';
      end if;
      if land_dirt(p_world, cx, cy) <= 0 then
        return 'A corner of it is bare rock. Only a pickaxe will take that lower.';
      end if;
      aimed := coalesce(level_stop(p_world, p_uid, cx, cy, -1),
                        slope_refusal(p_world, p_uid, 'digging', cx, cy, -1));
      if aimed is not null then return aimed; end if;
    end loop;
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.terrain_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare cx int; cy int; tx int; ty int; t tile_def; r rock_def; mining double precision; here int;
        v_needs double precision;
        v_under text;  -- Piers
begin
  cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
  tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;

  if p_action in ('mine', 'chip_corner') then
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    if not t.mineable then return 'There is no rock face there to work.'; end if;
    -- cellar: a face is not cut back at a corner of a building, nor of the cellar under one (`cornerUnderBuilding`).
    if p_action = 'chip_corner' and corner_under_building(p_world, cx, cy) is not null then -- cellar
      return corner_under_building(p_world, cx, cy); -- cellar
    end if; -- cellar
    -- Piers: cutting a face back under a building, or working one that may come down, a tile on piers among them (`cornerUnderBuilding`).
    if p_action in ('chip_corner', 'mine') then
      v_under := corner_under_building(p_world, cx, cy);
      if v_under is not null then return v_under; end if;
    end if;
    /*
     * How deep the water over a face may be and still be worked.
     *
     * This was `rock_height(corner) <= 0`, and the report that moved it came
     * with a picture: a copper vein, "You cannot mine below the water level",
     * and no water drawn anywhere on the tile. Two things were wrong in the
     * one line.
     *
     * It asked the wrong height. `rock_height` is the surface less the soil
     * over it, so a corner shared with a meadow refuses a face standing fifty
     * units above the sea because the bedrock buried under the grass beside it
     * is below sea level. Water is a question about the surface, and the
     * surface is what `has_water` reads and what a browser draws.
     *
     * And it was a height out even where the two agree: `<= 0` refuses a face
     * standing *at* the waterline, while water is only drawn below it. Nought
     * is the one height that refuses and shows nothing — which is exactly
     * where a shore face sits.
     *
     * So: the corner's own height, and `mine_depth` of water allowed over it.
     * That is about waist deep at the tide line and you work standing in it,
     * which is what a shore quarry looks like. Past that you are swimming, and
     * nobody swings a pick while swimming — so the refusal says that, rather
     * than blaming water for ground that is not under any.
     */
    -- Deeper for a Miner's Wet Work.
    if land_height(p_world, cx, cy) < -pk(p_world, p_uid, 'depth:mine', mine_depth()) then
      return 'The water is too deep here to work in.';
    end if;
    -- A seam only gives up its metal to somebody who knows how to take it.
    if land_tile(p_world, tx, ty) = 4 then
      r := bedrock_at(p_world, tx, ty);
      mining := skill_of(p_world, p_uid, 'mining');
      -- Less of it for a Miner's Ore Sense.
      v_needs := greatest(0, r.level - pk(p_world, p_uid, 'ore:below', 0));
      if r.ore and mining < v_needs then
        -- `FM990.9` leaves "5." on a whole number, which reads as a typo in the
        -- middle of a sentence. The browser prints the number as it is.
        return r.name || ' needs mining ' || rtrim(rtrim(to_char(v_needs, 'FM990.99'), '0'), '.')
          || ' to work. Yours is ' || to_char(mining, 'FM990.0') || '.';
      end if;
    end if;
    -- Cutting a face back stops at the level like everything else; working it
    -- for what is in it does not, since that leaves the face where it was.
    if p_action = 'chip_corner' then return level_stop(p_world, p_uid, cx, cy, -1); end if;
    return null;
  end if;

  here := land_tile(p_world, tx, ty);
  -- Piers: and packing, tilling or paving the floor of a building, a tile on piers among them, as the browser has it (`underBuilding`).
  if p_action in ('pack', 'cultivate', 'pave_cobble') then
    v_under := under_building(p_world, tx, ty);
    if v_under is not null then return v_under; end if;
  end if;
  if p_action = 'pack' then
    if not packable(here) then return 'That ground will not pack down.'; end if;
  elsif p_action = 'cultivate' then
    if here <> 2 then return 'Only packed earth can be broken up.'; end if;
  elsif p_action = 'pave_cobble' then
    if here <> 2 then return 'Pack the ground down before paving it.'; end if;
    if pack_count(p_world, p_uid, 'stone_brick') < 1 then
      return 'You need a stone brick to lay cobblestone.';
    end if;
  elsif p_action = 'drop_dirt_here' then
    if pack_count(p_world, p_uid, 'dirt') < 1 then return 'You have no dirt to drop.'; end if;
    -- The corner nearest whoever is standing there, as the game reckons it.
    select round(x)::int, round(y)::int into cx, cy from player where world_id = p_world and uid = p_uid;
    -- Piers: not a corner of a building -- standing on a deck on piers, the ground under it -- as `drop_dirt` has it.
    v_under := corner_under_building(p_world, cx, cy);
    if v_under is not null then return v_under; end if;
    return slope_refusal(p_world, p_uid, 'digging', cx, cy, 1);
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.act_perform(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare d action_def; tq double precision; s double precision; cx int; cy int; tx int; ty int;
        t tile_def; left_dirt int; made_ql double precision; yield text; tool_id bigint;
begin
  -- cellar: digging out, mining out and filling in a cellar, and a drop, a pick up or a sweep down there.
  if cellar_action(p_action) or (p_action in ('drop', 'pick_up', 'pick_up_all') and cellar_hands(p_world, p_uid, p_action, p_target)) then
    perform perform_cellar(p_world, p_uid, p_action, p_target);
    return;
  end if;
  -- Shop counters and lantern posts (`counters.ts`, `lamps.ts`).
  if counter_action(p_action) then perform perform_counter(p_world, p_uid, p_action, p_target); return; end if;
  if lamp_action(p_action) then perform perform_lamp(p_world, p_uid, p_action, p_target); return; end if;
  if spring_action(p_action) then
    perform perform_spring(p_world, p_uid, p_action, p_target);
    return;
  end if;
  -- An aqueduct's jobs, and a bridge's aimed at one (`aqueduct_aimed`).
  if aqueduct_aimed(p_world, p_action, p_target) then
    perform perform_aqueduct(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if flower_action(p_action) then
    perform perform_flowers(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if green_action(p_action) then
    perform perform_green(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if water_garden_action(p_action) then
    perform perform_water_garden(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if last_action(p_action) then
    perform perform_last(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if faith_action(p_action) then
    perform perform_faith(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if ride_action(p_action) then
    perform perform_ride(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if hands_action(p_action) then
    perform perform_hands(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if liquid_action(p_action) then
    perform perform_liquid(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if forge_action(p_action) then
    perform perform_forge(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if holding_action(p_action) then
    perform perform_holding(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if settlement_action(p_action) then
    perform perform_settlement(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if dig_action(p_action) then
    perform perform_dig(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if trap_action(p_action) then
    perform perform_trap(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if ground_action(p_action) then
    perform perform_ground(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if foundation_action(p_action) then
    perform perform_foundation(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if build_action(p_action) then
    perform perform_building(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action = 'found_settlement' then
    perform perform_deed(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if creature_action(p_action) then
    perform perform_creature(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if fight_action(p_action) then
    perform perform_fight(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('fit_lock', 'take_off_lock') then
    perform perform_lock(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if crate_action(p_action) then
    perform perform_crate(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if item_action(p_action) then
    perform perform_item(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if firing_action(p_action) then
    perform perform_firing(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if fire_action(p_action) then
    perform perform_fire(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if treasure_action(p_action) then
    perform perform_treasure(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('mine', 'chip_corner', 'pack', 'cultivate', 'pave_cobble', 'drop_dirt_here') then
    perform perform_terrain(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('cut_down', 'forage', 'botanize', 'collect') then
    perform perform_gather(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if farm_action(p_action) then
    perform perform_farm(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('fish', 'drag_net') then
    perform perform_fish(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if exists (select 1 from recipe where id = p_action) then
    perform perform_craft(p_world, p_uid, p_action, p_target);
    return;
  end if;

  select * into d from action_def where id = p_action;
  s := case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end;

  if p_action = 'dig_tile' then
    perform perform_dig_tile(p_world, p_uid, p_target);
    return;
  end if;
  if p_action = 'pan' then
    perform perform_pan(p_world, p_uid, p_target);
    return;
  end if;

  if p_action = 'dig' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    select i.id into tool_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = d.tool
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id); end if;
    if not skill_check(s, d.difficulty, tq) then
      perform skill_raise(p_world, p_uid, d.skill, try_gain(false));
      perform tell(p_world, p_uid, 'You fail to dig anything useful.', 'event');
      return;
    end if;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
    left_dirt := land_dirt(p_world, cx, cy) - 1;
    perform land_set_dirt(p_world, cx, cy, left_dirt);
    if t.turns_to_dirt then perform land_set_tile(p_world, tx, ty, 1); end if;
    -- Dug to the rock, the tile becomes rock and shows the seam under it.
    perform reconcile_around(p_world, cx, cy);
    perform land_announce(p_world, tx, ty);
    if left_dirt <= 0 then
      perform tell(p_world, p_uid, 'Your shovel grates on bare rock.', 'event');
    end if;
    yield := coalesce(t.dig_yield, 'dirt');
    -- Cleaner for a Terraformer's Clean Earth, and now and then rare.
    made_ql := least(100, product_ql(s, tq) * pkx('ql:dig', 1));
    perform gather(p_world, p_uid, yield, 1, made_ql, null, perk_rare(pkx('rare:dig', 0)));
    -- And one spadeful in a thousand that is not dirt at all.
    perform maybe_map(p_world, p_uid, s, tq);
    perform skill_raise(p_world, p_uid, d.skill, 1);
    perform tell(p_world, p_uid,
      'You dig up some ' || lower((select name from item_def where id = yield)) ||
      '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.act_ported(p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (select 1 from recipe where id = p_action)
      or last_action(p_action)
      or spring_action(p_action)
      or aqueduct_action(p_action)
      or flower_action(p_action)
      or green_action(p_action)
      or water_garden_action(p_action)
      or cellar_action(p_action) -- cellar
      or faith_action(p_action)
      or ride_action(p_action)
      or trap_action(p_action)
      or dig_action(p_action)
      or treasure_action(p_action)
      or settlement_action(p_action)
      or holding_action(p_action)
      or forge_action(p_action)
      or liquid_action(p_action)
      or hands_action(p_action)
      or ground_action(p_action)
      or item_action(p_action)
      or firing_action(p_action)
      or fire_action(p_action)
      or crate_action(p_action)
      -- Fitting a padlock, and taking one off again.
      or p_action in ('fit_lock', 'take_off_lock')
      or build_action(p_action)
      or creature_action(p_action)
      or fight_action(p_action)
      or foundation_action(p_action)
      or farm_action(p_action)
      -- Shop counters and lantern posts.
      or counter_action(p_action) or lamp_action(p_action)
      or p_action in ('dig', 'mine', 'chip_corner', 'pack', 'cultivate', 'pave_cobble',
                      'drop_dirt_here', 'cut_down', 'forage', 'botanize', 'collect',
                      'fish', 'drag_net', 'found_settlement', 'set_to_work', 'dig_tile', 'pan')
$function$;

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
    lvl := work_level(p_world, b.id);
    -- Piers: and on the ground floor of a tile on piers, which is its deck.
    if lvl > 0 or on_piers(p_world, tx, ty) then
      select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
      if not found or not bill_done(f.needed) then return 'Build the floor of this storey first.'; end if;
    end if;
    if (wall_at(p_world, tx, ty, side)).world_id is not null then return 'There is already a wall on that side.'; end if;
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
    w := wall_at(p_world, tx, ty, side);
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
      return 'Nothing rests on a fence or a half wall. The storey below needs walls all round.';
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
    lvl := floor_level(p_world, b.id, kind, p_target); -- cellar: storey nought for a flight down
    if kind = 'roof' then
      v_gap := level_gap(p_world, b.id, b.levels - 1, p_uid);
      if v_gap is not null then return v_gap; end if;
    elsif kind in ('stairs', 'ladder') then
      -- cellar: on the ground floor, a way down to the cellar under it.
      if lvl < 1 then
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
    lvl := floor_level(p_world, b.id, kind, p_target); -- cellar
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
    w := wall_at(p_world, tx, ty, side);
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
    lvl := work_level(p_world, b.id);
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
    w := wall_at(p_world, tx, ty, side);
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
    lvl := case when p_action = 'plan_fence' then 0 else work_level(p_world, b.id) end;
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
      perform tell(p_world, p_uid, 'You plan a ' || lower(wt.name) || ' ' || lower(mat.name)
        || ' wall on the ' || side_name(side) || ' side. It needs ' || bill_text(mat.id, bill) || '.', 'event');
    end if;

  elsif p_action = 'build_wall' then
    w := wall_at(p_world, tx, ty, side);
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
    w := wall_at(p_world, tx, ty, side);
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
    w := wall_at(p_world, tx, ty, side);
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
    lvl := floor_level(p_world, b.id, kind, p_target); -- cellar: storey nought for a flight down
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
    lvl := floor_level(p_world, b.id, kind, p_target); -- cellar: storey nought for a flight down
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
    lvl := floor_level(p_world, b.id, kind, p_target); -- cellar: storey nought for a flight down
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
    w := wall_at(p_world, tx, ty, side);
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
    w := wall_at(p_world, tx, ty, side);
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
    lvl := work_level(p_world, b.id);
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
                           where building_at(p_world, x, y) is not null)
              then 'You cannot dig under a building.' end
$function$;

CREATE OR REPLACE FUNCTION public.under_building(p_world uuid, p_x integer, p_y integer)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  -- cellar: said first, as `corner_under_building` says it.
  select case when (cellar_at(p_world, p_x, p_y)).world_id is not null
              then 'There is a cellar dug out under that ground. The ground over a cellar is not dug, raised or levelled while the cellar is there.'
              when building_at(p_world, p_x, p_y) is not null
              then 'You cannot do that inside a building.' end
$function$;

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
  select count(*) into n from crate c where c.world_id = p_world
    and p_x between c.x and c.x + c.sx - 1 and p_y between c.y and c.y + c.sy - 1;
  if n = 1 then v_extra := v_extra || ' A crate stands here.';
  elsif n > 1 then v_extra := v_extra || ' ' || n || ' crates stand here.'; end if;
  return v_out || v_extra;
end $function$;

CREATE OR REPLACE FUNCTION public.ground_sweep(p_world uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare v_n int; v_gone bigint[];
begin
  with due as (
    select i.id, i.rot_at, i.gx, i.gy, i.def from item i
     where i.world_id = p_world and i.holder = 'ground'
       and coalesce(i.rot_at, '-infinity'::timestamptz) <= now() - ground_step()
     -- No tie-break on id: it would cost the ordered index scan, and rows
     -- sharing a moment are equally due.
     order by coalesce(i.rot_at, '-infinity'::timestamptz)
     limit ground_rows()
  ),
  /*
   * What is in a bag lying there ages with it, over the same span, at the
   * share of the weather the bag keeps off (`shelter`): what the browser has
   * always done, and the island never did.
   */
  held as (
    update item h set dmg = least(100, h.dmg + ground_decay_rate(h) * decay_multiplier(p_world, due.gx, due.gy)
                                   * d.shelter * extract(epoch from (now() - due.rot_at)) / 3600)
      from due join item_def d on d.id = due.def
     where h.inside = due.id and h.holder = 'bag' and due.rot_at is not null and d.shelter is not null
    returning h.id, h.dmg
  ),
  charged as (
    update item i set
        dmg = least(100, i.dmg + case when i.rot_at is null then 0
                     else ground_decay_rate(i) * decay_multiplier(p_world, i.gx, i.gy)
                          * extract(epoch from (now() - i.rot_at)) / 3600 end),
        rot_at = now()
      from due where i.id = due.id
    returning i.id
  )
  select (select count(*) from charged), (select array_agg(id) from held where dmg >= 100) into v_n, v_gone;
  delete from item where world_id = p_world and holder = 'ground' and dmg >= 100;
  -- And what has rotted away in a bag on the ground, which is only ever what was just charged.
  if v_gone is not null then delete from item where id = any(v_gone); end if;
  -- And the graves whose hour is up, which go the same way and on the same round.
  perform grave_sweep(p_world);
  -- cellar: and what lies on the floors of cellars, at what a cellar is worth to it.
  perform cellar_sweep(p_world);
  return v_n;
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
          and greatest(abs(f.x + 0.5 - p.x), abs(f.y + 0.5 - p.y)) <= p_range), '[]'::jsonb)),
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

CREATE OR REPLACE FUNCTION public.near_water(p_world uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (
    select 1 from player pl,
      lateral generate_series(floor(pl.x)::int - 1, floor(pl.x)::int + 1) as g(wx),
      lateral generate_series(floor(pl.y)::int - 1, floor(pl.y)::int + 1) as h(wy)
    where pl.world_id = p_world and pl.uid = p_uid and pl.level >= 0 -- cellar: the sea and the ponds are up top
      and in_bounds(p_world, g.wx, h.wy) and has_water(p_world, g.wx, h.wy))
$function$;

CREATE OR REPLACE FUNCTION public.near_piece(p_world uuid, p_uid uuid, p placed, p_range double precision DEFAULT 2.4)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (select 1 from player pl where pl.world_id = p_world and pl.uid = p_uid
    and sqrt((p.cx - pl.x) ^ 2 + (p.cy - pl.y) ^ 2) <= p_range
    and same_floor(p.level, p.world_id, p.x, p.y)) -- cellar
$function$;

CREATE OR REPLACE FUNCTION public.placed_in_reach(p_world uuid, p_uid uuid, p_id bigint, p_range double precision DEFAULT 2.4)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (
    select 1 from placed pl, player py
    where pl.id = p_id and pl.world_id = p_world and py.world_id = p_world and py.uid = p_uid
      and sqrt(power(pl.cx - py.x, 2) + power(pl.cy - py.y, 2)) <= p_range
      and same_floor(pl.level, pl.world_id, pl.x, pl.y)) -- cellar
$function$;

CREATE OR REPLACE FUNCTION public.placed_near(p_world uuid, p_uid uuid, p_kind text, p_sub text DEFAULT NULL::text, p_range double precision DEFAULT 2.4)
 RETURNS SETOF placed
 LANGUAGE sql
 STABLE
AS $function$
  select pl.* from placed pl, player py
  where pl.world_id = p_world and py.world_id = p_world and py.uid = p_uid
    and pl.kind = p_kind and (p_sub is null or pl.sub = p_sub)
    and sqrt(power(pl.cx - py.x, 2) + power(pl.cy - py.y, 2)) <= p_range
    and same_floor(pl.level, pl.world_id, pl.x, pl.y) -- cellar
  order by sqrt(power(pl.cx - py.x, 2) + power(pl.cy - py.y, 2))
$function$;

CREATE OR REPLACE FUNCTION public.nearest_crate(p_world uuid, p_x double precision, p_y double precision, p_range double precision DEFAULT 2.4)
 RETURNS crate
 LANGUAGE sql
 STABLE
AS $function$
  select c.* from crate c
  where c.world_id = p_world
    and sqrt((crate_centre_x(c) - p_x) ^ 2 + (crate_centre_y(c) - p_y) ^ 2) <= p_range
    and same_floor(c.level, c.world_id, c.x, c.y) -- cellar
  order by sqrt((crate_centre_x(c) - p_x) ^ 2 + (crate_centre_y(c) - p_y) ^ 2)
  limit 1
$function$;

CREATE OR REPLACE FUNCTION public.named_crate(p_world uuid, p_x double precision, p_y double precision, p_target jsonb)
 RETURNS crate
 LANGUAGE sql
 STABLE
AS $function$
  select c.* from crate c
  where c.world_id = p_world and c.id = (p_target->>'into')::int
    and sqrt((crate_centre_x(c) - p_x) ^ 2 + (crate_centre_y(c) - p_y) ^ 2) <= 2.4
    and same_floor(c.level, c.world_id, c.x, c.y) -- cellar
$function$;

CREATE OR REPLACE FUNCTION public.crate_at(p_world uuid, p_x integer, p_y integer, p_sx integer, p_sy integer)
 RETURNS crate
 LANGUAGE sql
 STABLE
AS $function$
  select * from crate where world_id = p_world and x = p_x and y = p_y and sx = p_sx and sy = p_sy
    and same_floor(level, world_id, x, y) -- cellar: a cellar's floor and the ground over it are two spots
$function$;

CREATE OR REPLACE FUNCTION public.rack_at(p_world uuid, p_x integer, p_y integer, p_sx integer, p_sy integer)
 RETURNS placed
 LANGUAGE sql
 STABLE
AS $function$
  select p.* from placed p join furniture_def d on d.id = p.sub
   where p.world_id = p_world and p.kind = 'furniture' and d.crates is not null
     and p.x = p_x and p.y = p_y and same_floor(p.level, p.world_id, p.x, p.y) -- cellar
     and p_sx >= p.sx and p_sx < p.sx + d.w
     and p_sy >= p.sy and p_sy < p.sy + d.h
   limit 1
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION public.craft_stock(p_world uuid, p_uid uuid, p_chosen bigint DEFAULT NULL::bigint)
 RETURNS TABLE(id bigint, def text, count integer, extra text, ql real, carried boolean, draw bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with me as (
    select p.x, p.y, floor(p.x)::int as tx, floor(p.y)::int as ty,
           coalesce(p.craft_from_stores, true) as stores,
           coalesce(p.craft_spare_rare, false) as spare,
           -- Asked once: three tiles, or further for a Smith's Forge Reach at the smelter or the anvil.
           craft_reach() as r
      from player p where p.world_id = p_world and p.uid = p_uid
  ),
  crates as materialized (
    select c.id, sqrt((crate_centre_x(c) - me.x) ^ 2 + (crate_centre_y(c) - me.y) ^ 2) as d
      from crate c, me
     where me.stores and c.world_id = p_world
       and c.x between me.tx - me.r and me.tx + me.r
       and c.y between me.ty - me.r and me.ty + me.r
       and crate_yours(p_world, p_uid, c.id)
       and same_floor(c.level, c.world_id, c.x, c.y) -- cellar
       and not lock_shut(p_world, p_uid, c.lock, c.x, c.y)
  ),
  pieces as materialized (
    select pl.id, sqrt((pl.cx - me.x) ^ 2 + (pl.cy - me.y) ^ 2) as d
      from placed pl join furniture_def f on f.id = pl.sub, me
     where me.stores and pl.world_id = p_world and pl.kind = 'furniture'
       and pl.x between me.tx - me.r and me.tx + me.r
       and pl.y between me.ty - me.r and me.ty + me.r
       and furniture_holds(pl)
       and same_floor(pl.level, pl.world_id, pl.x, pl.y) -- cellar
       and coalesce(f.trash, 0) = 0 and not f.stall
       -- Yours, or on a settlement of yours -- or a cart, a wagon or a boat,
       -- which is anybody's to load and to empty, and so anybody's to use.
       and (pl.made_by = p_uid or on_my_deed(p_world, p_uid, pl.x, pl.y) or f.cart or is_driveable(pl))
       and not lock_shut(p_world, p_uid, pl.lock, pl.x, pl.y)
  ),
  stock as (
    -- Loose in your hands.
    select i.id, i.def, i.count, i.extra, i.ql, i.rare, true as carried,
           0 as rank, 0::double precision as d, 0 as kind, 0::bigint as store
      from item i
     where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
       and not i.locked and i.deal is null
    union all
    -- In a bag you are carrying: `carried`, the lookup `in_the_bag` made.
    select i.id, i.def, i.count, i.extra, i.ql, i.rare, true, 1, 0, 0, b.id
      from item b join item i on i.inside = b.id and i.holder = 'bag'
     where b.world_id = p_world and b.holder = 'player' and b.holder_uid = p_uid
       and not i.locked and i.deal is null
    union all
    select i.id, i.def, i.count, i.extra, i.ql, i.rare, false, 2, c.d, 0, c.id::bigint
      from crates c join item i on i.world_id = p_world and i.holder = 'crate' and i.crate = c.id
     where not i.locked and i.deal is null and i.price is null and i.letter is null
    union all
    select i.id, i.def, i.count, i.extra, i.ql, i.rare, false, 2, pc.d, 1, pc.id
      from pieces pc join item i on i.world_id = p_world and i.holder = 'furniture' and i.placed = pc.id
     where not i.locked and i.deal is null and i.price is null and i.letter is null
  )
  select s.id, s.def, s.count, s.extra, s.ql, s.carried,
         row_number() over (order by s.rank, s.d, s.kind, s.store, s.id)
    from stock s
   where coalesce(s.rare, '') = ''
      or s.id is not distinct from p_chosen
      or not coalesce((select m.spare from me m), false)
$function$;

CREATE OR REPLACE FUNCTION public.hod_stock(p_world uuid, p_uid uuid, p_item text, p_reach double precision)
 RETURNS TABLE(id bigint, count integer, draw bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with me as (
    select p.x, p.y, floor(p.x)::int as tx, floor(p.y)::int as ty, ceil(p_reach)::int as r
      from player p where p.world_id = p_world and p.uid = p_uid and p_reach > 0
  ),
  crates as materialized (
    select c.id, sqrt((crate_centre_x(c) - me.x) ^ 2 + (crate_centre_y(c) - me.y) ^ 2) as d
      from crate c, me
     where c.world_id = p_world
       and c.x between me.tx - me.r and me.tx + me.r
       and c.y between me.ty - me.r and me.ty + me.r
       and crate_yours(p_world, p_uid, c.id)
       and same_floor(c.level, c.world_id, c.x, c.y) -- cellar
       and not lock_shut(p_world, p_uid, c.lock, c.x, c.y)
  ),
  pieces as materialized (
    select pl.id, sqrt((pl.cx - me.x) ^ 2 + (pl.cy - me.y) ^ 2) as d
      from placed pl join furniture_def f on f.id = pl.sub, me
     where pl.world_id = p_world and pl.kind = 'furniture'
       and pl.x between me.tx - me.r and me.tx + me.r
       and pl.y between me.ty - me.r and me.ty + me.r
       and furniture_holds(pl)
       and same_floor(pl.level, pl.world_id, pl.x, pl.y) -- cellar
       and coalesce(f.trash, 0) = 0 and not f.stall
       and (pl.made_by = p_uid or on_my_deed(p_world, p_uid, pl.x, pl.y) or f.cart or is_driveable(pl))
       and not lock_shut(p_world, p_uid, pl.lock, pl.x, pl.y)
  ),
  stock as (
    select i.id, i.count, c.d, 0 as kind, c.id::bigint as store
      from crates c join item i on i.world_id = p_world and i.holder = 'crate' and i.crate = c.id
     where i.def = p_item and i.count > 0 and not i.locked and i.deal is null and i.price is null and i.letter is null
    union all
    select i.id, i.count, pc.d, 1, pc.id
      from pieces pc join item i on i.world_id = p_world and i.holder = 'furniture' and i.placed = pc.id
     where i.def = p_item and i.count > 0 and not i.locked and i.deal is null and i.price is null and i.letter is null
  )
  select s.id, s.count, row_number() over (order by s.d, s.kind, s.store, s.id) from stock s
$function$;

CREATE OR REPLACE FUNCTION public.take_spoil(p_world uuid, p_uid uuid, p_def text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare v_id bigint;
begin
  if consume(p_world, p_uid, p_def, 1) then return true; end if;
  select i.id into v_id from item i
    join crate c on c.world_id = i.world_id and c.id = i.crate
   where i.world_id = p_world and i.holder = 'crate' and i.def = p_def and not i.locked
     and same_floor(c.level, c.world_id, c.x, c.y) -- cellar
     and sqrt((crate_centre_x(c) - (select pl.x from player pl where pl.world_id = p_world and pl.uid = p_uid)) ^ 2
            + (crate_centre_y(c) - (select pl.y from player pl where pl.world_id = p_world and pl.uid = p_uid)) ^ 2)
         -- As far as a Terraformer's Long Reach, or the reach everybody has.
         <= pk(p_world, p_uid, 'reach:soil', spoil_reach())
   order by i.id limit 1;
  if v_id is null then
    select i.id into v_id from item i
      join placed p on p.world_id = i.world_id and p.id = i.placed
     where i.world_id = p_world and i.holder = 'furniture' and i.def = p_def and not i.locked
       and near_piece(p_world, p_uid, p, pk(p_world, p_uid, 'reach:soil', spoil_reach()))
       -- Not out of a grave, as `spoil_near` asks.
       and p.crumbles_at is null
     order by i.id limit 1;
  end if;
  if v_id is null then return false; end if;
  update item set count = count - 1 where id = v_id and count > 1;
  if found then return true; end if;
  delete from item where id = v_id;
  return found;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_last(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_took boolean; p player; pc placed; b bridge; d bridge_def; s bridge_span; c creature; mate creature;
        dam creature; sire creature; it item; dye item; bd brew_def; dd dye_def;
        v_kind text; v_id bigint; v_h int; v_n int; v_left int; v_want text; v_back jsonb;
        v_parts text[]; v_half int; e record; r record; v_skill double precision;
        v_care double precision; v_one bigint; v_stock item; v_ql double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'set_bauble' then
    perform perform_bauble(p_world, p_uid, p_target);
    return;
  end if;
  if p_action = 'sacrifice' then
    perform perform_sacrifice(p_world, p_uid, p_target);
    return;
  end if;
  if p_action = 'absorb_mote' then
    perform perform_absorb(p_world, p_uid, p_target);
    return;
  end if;

  if p_action = 'plan_bridge' then
    v_kind := coalesce(p_target->>'material', 'rope');
    if bridge_reason(p_world, p_uid, v_kind, floor(p.x)::int, floor(p.y)::int,
         (p_target->>'x')::int, (p_target->>'y')::int) is not null then return; end if;
    select * into d from bridge_def where id = v_kind;
    v_h := round((centre_height(p_world, floor(p.x)::int, floor(p.y)::int)
                + centre_height(p_world, (p_target->>'x')::int, (p_target->>'y')::int)) / 2);
    insert into bridge (world_id, kind, ax, ay, bx, by, height, material, made_by)
    values (p_world, v_kind, floor(p.x)::int, floor(p.y)::int,
            (p_target->>'x')::int, (p_target->>'y')::int, v_h,
            case when v_kind = 'stone' then null else 'Oak' end, p_uid)
    returning id into v_id;
    insert into bridge_span (world_id, bridge, n, x, y, needed, total)
    select p_world, v_id, t.n, t.x, t.y, span_bill(v_kind), span_bill(v_kind)
    from span_tiles(floor(p.x)::int, floor(p.y)::int,
                    (p_target->>'x')::int, (p_target->>'y')::int) t;
    select count(*)::int into v_n from bridge_span sp where sp.world_id = p_world and sp.bridge = v_id;
    perform journal_note(p_world, p_uid, 'planned_bridge');
    perform skill_raise(p_world, p_uid, d.skill, 0.4);
    perform tell(p_world, p_uid, 'You set out a ' || lower(d.name) || ' of ' || v_n || ' span'
      || case when v_n > 1 then 's' else '' end || ' across. Each one wants '
      || span_wants(span_bill(v_kind)) || '. ' || d.note, 'system');

  elsif p_action = 'build_bridge' then
    select * into b from bridge where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    select * into d from bridge_def where id = b.kind;
    select * into s from bridge_span sp where sp.world_id = p_world and sp.bridge = b.id
      and not span_done(sp.needed) order by sp.n limit 1;
    if not found then return; end if;
    -- One unit of one thing per go, as with a wall.
    select e2.key into v_want from jsonb_each(s.needed) e2
      where (e2.value)::int > 0 and pack_count(p_world, p_uid, e2.key) > 0 order by e2.key limit 1;
    if v_want is null then return; end if;
    if not consume(p_world, p_uid, v_want, 1) then return; end if;
    update bridge_span sp set needed = jsonb_set(sp.needed, array[v_want],
        to_jsonb(greatest(0, (sp.needed->>v_want)::int - 1)))
      where sp.world_id = p_world and sp.bridge = b.id and sp.n = s.n
      returning * into s;
    perform skill_raise(p_world, p_uid, d.skill, 0.5);
    perform wear_tool((select i.id from item i where i.world_id = p_world and i.holder = 'player'
      and i.holder_uid = p_uid and i.def = d.tool
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1), 0.4);
    if span_done(s.needed) then
      v_left := bridge_left(p_world, b.id);
      if v_left > 0 then
        perform tell(p_world, p_uid, 'That span is decked. ' || v_left || ' still open.', 'event');
      else
        perform journal_note(p_world, p_uid, 'bridged');
        perform tell(p_world, p_uid, 'The last span is decked and the ' || lower(bridge_name(b))
          || ' is open. ' || case when d.carts then 'A cart will cross it.'
                                  else 'Foot traffic only; nothing with a wheel.' end, 'system');
      end if;
    else
      perform tell(p_world, p_uid, 'You work a '
        || lower((select coalesce(name, v_want) from item_def where id = v_want))
        || ' into the span. It still wants ' || span_wants(s.needed) || '.', 'event');
    end if;

  elsif p_action = 'demolish_bridge' then
    select * into b from bridge where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    -- Half of what went into it comes back, which is what pulling a thing down
    -- is worth anywhere else in the world.
    v_parts := '{}';
    for e in
      select k.key as item, sum((k.value)::int - coalesce((sp.needed->>k.key)::int, 0))::int as used
      from bridge_span sp cross join lateral jsonb_each(sp.total) k
      where sp.world_id = p_world and sp.bridge = b.id
      group by k.key order by k.key
    loop
      v_half := floor(e.used / 2.0)::int;
      if v_half > 0 then
        perform give(p_world, p_uid, e.item, v_half, 20);
        v_parts := v_parts || (v_half || ' ' ||
          lower((select coalesce(name, e.item) from item_def where id = e.item)));
      end if;
    end loop;
    delete from bridge_span where world_id = p_world and bridge = b.id;
    delete from bridge where world_id = p_world and id = b.id;
    perform tell(p_world, p_uid, case when array_length(v_parts, 1) > 0
      then 'You take the ' || lower(bridge_name(b)) || ' down and save '
           || array_to_string(v_parts, ', ') || '.'
      else 'You take the ' || lower(bridge_name(b)) || ' down.' end, 'event');

  elsif p_action = 'ring_bell' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    select * into p from player where world_id = p_world and uid = p_uid;
    r := deed_at(p_world, pc.x, pc.y);
    if r.world_id is null then return; end if;
    v_n := 0;
    -- Every wildermon working the deed drops what it is doing and walks to
    -- whoever rang: a leg to the ringer, and a while standing there before
    -- the work takes it back.
    for e in select cr.*, coalesce(sp.speed, 1) as pace
             from creature cr join species_def sp on sp.id = cr.species
             where cr.world_id = p_world and cr.mode = 'deed' and cr.hitched_to is null
               and cr.keeper in (select m.uid from deed_member m
                                 where m.world_id = p_world and m.founder = r.founded_by
                                 union select r.founded_by)
    loop
      v_ql := greatest(0.5, sqrt(power(p.x - e.to_x, 2) + power(p.y - e.to_y, 2)) / greatest(0.4, e.pace));
      update creature set phase = 'idle', work_x = null, work_y = null, enemy = null,
          from_x = e.to_x, from_y = e.to_y, to_x = p.x, to_y = p.y,
          leg_at = now(), leg_ends = now() + make_interval(secs => v_ql),
          until = now() + make_interval(secs => v_ql + 20)
        where world_id = p_world and id = e.id;
      v_n := v_n + 1;
    end loop;
    -- And every citizen hears where it hangs.
    for e in select m.uid from deed_member m where m.world_id = p_world and m.founder = r.founded_by
             union select r.founded_by
    loop
      if e.uid <> p_uid then
        perform tell(p_world, e.uid, 'The bell rings out over ' || r.name || ' from ' || pc.x || ', ' || pc.y || '.', 'system');
      end if;
    end loop;
    perform journal_note(p_world, p_uid, 'rang');
    perform tell(p_world, p_uid, 'You ring the ' || lower(placed_name(pc)) || ' and it sounds over ' || r.name || '. '
      || case when v_n > 0 then v_n || ' wildermon ' || case when v_n = 1 then 'comes' else 'come' end || ' at the sound'
              else 'Nothing is working the deed to come' end
      || ', and every citizen hears where it hangs: ' || pc.x || ', ' || pc.y || '.', 'event');

  elsif p_action = 'sleep' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    /*
     * A well-made bed is a better night than a cot with a thin mattress — and
     * a bed under a roof, in a room with walls all round it, is a better night
     * again than the same bed standing in a field in the weather.
     */
    perform journal_note(p_world, p_uid, 'slept');
    perform sleep_until_morning(p_world, p_uid,
      (select bed from furniture_def where id = pc.sub) * (0.6 + pc.ql / 250)
        * case when case when pc.level < 0 then cellar_done(p_world, floor(pc.x)::int, floor(pc.y)::int) -- cellar: always indoors
                         else indoors(p_world, 0, floor(pc.x)::int, floor(pc.y)::int) end -- cellar
               then indoors_rest() else 1 end, -- cellar
      lower(placed_name(pc)));

  elsif p_action = 'set_home' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    update player set home_x = pc.x, home_y = pc.y where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You make up the ' || lower(placed_name(pc))
      || '. This is where you will wake, whatever happens to you.', 'event');

  elsif p_action = 'pair_creature' then
    c := target_creature(p_world, p_target);
    mate := mate_for(p_world, c);
    if c.world_id is null or mate.id is null or pair_refuses(p_world, c, mate) is not null then return; end if;
    if c.sex = 'female' then dam := c; sire := mate; else dam := mate; sire := c; end if;
    v_skill := skill_of(p_world, p_uid, 'animal_husbandry');
    v_care := (dam.care + sire.care) / 2;
    v_took := random() < breed_chance(v_skill, v_care);
    perform skill_raise(p_world, p_uid, 'animal_husbandry', try_gain(v_took, breed_gain()));
    if not v_took then
      -- A failed pairing costs both of them a rest, but only half of one.
      -- Half a shorter one for the breeder's Short Rest.
      update creature set bred_at = now() - make_interval(secs => breed_rest() * (1 - pk(p_world, p_uid, 'breed:rest', 1) / 2))
        where world_id = p_world and id in (dam.id, sire.id);
      perform tell(p_world, p_uid, dam.name || ' and ' || sire.name
        || ' will have nothing to do with one another. Brush them, feed them, and try again.', 'error');
      return;
    end if;
    perform pair_them(p_world, dam.id, sire.id, v_skill, p_uid, p_target->>'sex');
    perform journal_note(p_world, p_uid, 'paired');
    perform tell(p_world, p_uid, sire.name || ' is put to ' || dam.name
      || '. She is in young and will drop in about ' || clock_left(gestation() * pk(p_world, p_uid, 'breed:gestation', 1))
      || '. Between them they carry '
      || trait_names((select array_agg(distinct t) from unnest(sire.traits || dam.traits) t))
      || '.', 'event');

  elsif p_action = 'read_blood' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    perform tell(p_world, p_uid, blood_read(p_world, p_uid, c), 'event');

  elsif p_action = 'dye_item' then
    select * into it from item where world_id = p_world and id = target_item(p_target);
    dye := pick_dye(p_world, p_uid);
    if it.id is null or dye.id is null then return; end if;
    select * into dd from dye_def where name = dye.extra;
    if not consume(p_world, p_uid, 'dye', 1) then return; end if;
    -- One pot does one thing. A stack is split so the rest stays as it was.
    if it.count > 1 then
      update item set count = count - 1 where id = it.id;
      insert into item (world_id, holder, holder_uid, def, ql, dmg, count, extra, rare, dye)
      values (p_world, it.holder, it.holder_uid, it.def, it.ql, it.dmg, 1, it.extra, it.rare, dd.id);
    else
      update item set dye = dd.id where id = it.id;
    end if;
    perform journal_note(p_world, p_uid, 'dyed');
    perform skill_raise(p_world, p_uid, 'alchemy', 0.3);
    perform tell(p_world, p_uid, 'You work the ' || lower(dd.name)
      || ' through it. It comes out ' || dd.word || '.', 'event');

  elsif p_action = 'strip_dye' then
    select * into it from item where world_id = p_world and id = target_item(p_target);
    if it.id is null then return; end if;
    select * into dye from item i where i.world_id = p_world and i.holder = 'player'
      and i.holder_uid = p_uid and i.def = 'lye_bucket' order by i.id limit 1;
    if dye.id is null or not consume(p_world, p_uid, 'lye_bucket', 1) then return; end if;
    perform give(p_world, p_uid, 'bucket', 1, dye.ql);
    update item set dye = null where id = it.id;
    perform skill_raise(p_world, p_uid, 'alchemy', 0.2);
    perform tell(p_world, p_uid, 'You boil it out in lye. It is back to the colour of '
      || lower((select coalesce(name, it.def) from item_def where id = it.def)) || '.', 'event');

  elsif p_action = 'start_brew' then
    select * into bd from brew_def where id = p_target->>'brew';
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if bd.id is null or pc.id is null
       or brew_reason(p_world, p_uid, pc, bd) is not null then return; end if;
    -- What goes in decides most of what comes out; the hand only decides how
    -- much of it survives the working.
    select i.* into v_stock from craft_stock(p_world, p_uid) h join item i on i.id = h.id
      where h.def = bd.input order by h.draw limit 1;
    v_ql := coalesce(v_stock.ql, 20);
    if not craft_consume(p_world, p_uid, bd.input, bd.count) then return; end if;
    if not skill_check(skill_of(p_world, p_uid, 'brewing'), bd.difficulty, 0) then
      update placed set litres = greatest(0, placed_litres(pc) - bd.litres), since = now()
        where id = pc.id;
      update placed set liquid = null where id = pc.id and litres <= 0;
      update placed set knack = null where id = pc.id;
      perform skill_raise(p_world, p_uid, 'brewing', try_gain(false, brew_gain()));
      perform tell(p_world, p_uid, 'It will not take. You tip the whole soured lot out of the '
        || lower(placed_name(pc)) || '.', 'event');
      return;
    end if;
    update placed set litres = bd.litres, liquid = bd.id, ferment = bd.seconds, since = now(),
        ql = greatest(1, least(100, (v_ql + skill_of(p_world, p_uid, 'brewing')) / 2)),
        -- Its brewer's hand in it, which goes into every bucket drawn off it (a Cook's Strong Brew).
        knack = nullif(pk(p_world, p_uid, 'brewed:' || bd.id, 1), 1)
      where id = pc.id;
    perform journal_note(p_world, p_uid, 'brew');
    perform journal_note(p_world, p_uid, 'brew:' || bd.id);
    perform skill_raise(p_world, p_uid, 'brewing', try_gain(true, brew_gain()));
    perform tell(p_world, p_uid, bd.done || ' (about ' || round(bd.seconds / 60) || ' minutes)', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.fought_in_dark(p_world uuid, p_uid uuid, p_weight double precision)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare dark double precision;
begin
  dark := darkness(p_world);
  -- cellar: down in a cellar it is the dead of night at every hour.
  if exists (select 1 from player pl where pl.world_id = p_world and pl.uid = p_uid and pl.level < 0) then dark := 1; end if; -- cellar
  if coalesce(dark, 0) <= night_eyes_from() then return; end if;
  perform char_told(p_world, p_uid, 'awareness', p_weight * dark);
end $function$;

CREATE OR REPLACE FUNCTION public.work_ability(p_world uuid, p_uid uuid, p_ability text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare p player; n int; d deed;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if p_ability = 'refresh' then
    update player set stats = jsonb_set(jsonb_set(stats, '{hunger}', '1'), '{thirst}', '1')
      where world_id = p_world and uid = p_uid;
    return 'You are neither hungry nor thirsty, and cannot say when that happened.';

  elsif p_ability = 'mendflesh' then
    n := jsonb_array_length(p.wounds);
    update player set wounds = '[]'::jsonb,
        stats = jsonb_set(stats, '{health}',
          to_jsonb(least(1, coalesce((stats->>'health')::double precision, 1) + 0.4)))
      where world_id = p_world and uid = p_uid;
    return case when n = 1 then 'The wound closes and the ache goes with it.'
                when n > 1 then 'All ' || n || ' of them close and the ache goes with them.'
                else 'There was nothing to mend, and you feel better anyway.' end;

  elsif p_ability = 'sense' then
    n := sense_rock(p_world, p_uid, 15);
    return case when n > 0 then 'The ground gives up what is in it: ' || n
                  || ' seams within fifteen tiles, marked.'
                else 'There is nothing under this ground but rock.' end;

  elsif p_ability = 'recall' then
    select * into d from my_deed(p_world, p_uid) md where md.world_id is not null;
    if not found then return 'You have nowhere to be recalled to.'; end if;
    -- Off any deck; and from a helm, the hull stays where she is with her helm empty rather than
    -- following you ashore with whoever is aboard her.
    update placed set driver = null
      where world_id = p_world and driver = p_uid and exists (select 1 from boat_def b where b.id = placed.sub);
    update player set x = d.x + 0.5, y = d.y + 1.5, level = 0, moved_at = now(), aboard = null, seat = null -- cellar
      where world_id = p_world and uid = p_uid;
    perform drag_along(p_world, p_uid, d.x + 0.5, d.y + 1.5);
    return 'You are standing at the token of ' || d.name
      || ', and the walk is simply not in your legs.';

  elsif p_ability = 'secondwind' then
    update player set stats = jsonb_set(stats, '{stamina}', '1')
      where world_id = p_world and uid = p_uid;
    return 'Your wind comes back all at once.';

  elsif p_ability = 'fury' then
    update player set fury_until = now() + interval '30 seconds'
      where world_id = p_world and uid = p_uid;
    return 'For half a minute nothing you swing at is going to enjoy it.';
  end if;
  return 'Nothing happens.';
end $function$;


revoke all on function actor_floor() from public, anon, authenticated;
select private.lock_doors();
