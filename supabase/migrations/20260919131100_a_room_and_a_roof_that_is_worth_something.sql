-- A room, a roof that is worth something, and three shapes of roof
--
-- A roof cost half a wall, took the same work as one, and did nothing at all.
-- A building was a shape with a door in it: what you left on the floor of a
-- finished house rotted at exactly the rate it rotted at in a field, and the
-- only thing on the island that ever sheltered anything was a sack.
--
-- So: a **room** — everywhere you can walk to from a tile without crossing a
-- wall, a door being a wall with a hole in it — and a room that has walls all
-- round it and something overhead is **indoors**. What is indoors rots at a
-- tenth of what it would outside, on top of whatever the ground is already
-- worth, so a crate of planks in a closed room on a deed keeps a hundred times
-- as long as the same crate in the open. And a bed indoors banks a third again
-- as much of a night as the same bed standing in the weather.
--
-- The sweep never applied the deed's own tenth either — `ground_sweep` rotted
-- everything at the bare rate wherever it lay, while the browser had always
-- halved it on a deed. Both tenths are in one function now, asked once, so the
-- two sides answer alike about a thing on the ground for the first time.
--
-- And a roof has a shape. Every roof on the island was hipped, because there
-- was one way of drawing a roof: a gable runs one ridge the length of the
-- building and is the cheapest, a hip falls away on all four sides and is what
-- everything had, and a flat roof is a deck you can walk out onto and costs
-- most. The shape is the building's, chosen with the first tile of roof.

alter table building add column if not exists roof text;

/** A building's roof shape; hipped is what every roof was before there was a choice. */
create or replace function roof_shape_of(p_world uuid, p_building int) returns text
  language sql stable as $fn$
  select coalesce((select roof from building where world_id = p_world and id = p_building), 'hip')
$fn$;

/**
 * Materials for a floor slot. A roof is whatever its shape costs — a gable
 * least, because a gable end is wall rather than roof, and a flat deck most,
 * because a thing you walk on is built like a floor.
 */
create or replace function floor_bill(p_material text, p_kind text, p_roof text) returns jsonb
  language sql stable as $fn$
  select case
    when p_kind = 'ladder' then '{"plank": 2}'::jsonb
    when p_kind = 'roof' then scaled_bill(p_material,
      coalesce((select factor from roof_shape_def where id = p_roof), 0.5)::double precision)
    else scaled_bill(p_material, case when p_kind = 'stairs' then 0.75 else 0.5 end) end
$fn$;

/** Whether anything stands over a tile on a storey: a floor, or a roof. */
create or replace function covered_at(p_world uuid, p_level int, p_x int, p_y int) returns boolean
  language sql stable as $fn$
  select exists (select 1 from floor_tile f
                  where f.world_id = p_world and f.level = p_level + 1
                    and f.x = p_x and f.y = p_y and bill_done(f.needed))
$fn$;

/**
 * The room a tile is in: everywhere reachable without crossing a finished
 * wall, and never off the building it belongs to.
 */
create or replace function room_tiles(p_world uuid, p_level int, p_x int, p_y int)
returns table (x int, y int) language sql stable as $fn$
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
  )
  select x, y from fill
$fn$;

/**
 * Indoors: a room with walls all round it and something over every tile of it.
 *
 * The whole of what a roof is worth. One pass of the fill answers both halves,
 * because this is asked by the sweep and the sweep is the hot path.
 */
create or replace function indoors(p_world uuid, p_level int, p_x int, p_y int) returns boolean
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
     and not exists (select 1 from gaps g
                      where not exists (select 1 from border_of(g.x, g.y, g.side) bd
                                         join wall w on w.world_id = p_world and w.level = p_level
                                           and w.dir = bd.dir and w.x = bd.x and w.y = bd.y
                                        where bill_done(w.needed)))
$fn$;

/**
 * How fast a thing on the ground rots where it lies: full speed in the wild, a
 * tenth of that on deed land, and a tenth of whatever that comes to indoors.
 */
create or replace function decay_multiplier(p_world uuid, p_x int, p_y int)
returns double precision language sql stable as $fn$
  select (case when on_deed(p_world, p_x, p_y) then 0.1 else 1 end)
       * (case when indoors(p_world, 0, p_x, p_y) then indoors_decay() else 1 end)
$fn$;

CREATE OR REPLACE FUNCTION public.ground_sweep(p_world uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare v_n int;
begin
  with due as (
    select i.id from item i
     where i.world_id = p_world and i.holder = 'ground'
     order by i.rot_at nulls first, i.id
     limit sweep_rows()
  )
  update item i set
      dmg = least(100, i.dmg + case when i.rot_at is null then 0
                   else ground_decay_rate(i) * decay_multiplier(p_world, i.gx, i.gy)
                        * extract(epoch from (now() - i.rot_at)) / 3600 end),
      rot_at = now()
    from due where i.id = due.id;
  get diagnostics v_n = row_count;
  delete from item where world_id = p_world and holder = 'ground' and dmg >= 100;
  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_building(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare shape text; tx int; ty int; side text; b building; w wall; f floor_tile; mat build_material_def;
        wt wall_type_def; lvl int; kind text; used text; nm text;
        sk text; bill jsonb; other record; what text; new_id int;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  side := p_target->>'side';
  select * into b from building where world_id = p_world and id = building_at(p_world, tx, ty);

  if p_action = 'plan_building' then
    nm := left(coalesce(nullif(btrim(coalesce(p_target->>'name', '')), ''), 'House'), 32);
    select coalesce(max(id), 0) + 1 into new_id from building where world_id = p_world;
    insert into building (world_id, id, name, planned_by) values (p_world, new_id, nm, p_uid);
    insert into building_tile (world_id, building, x, y) values (p_world, new_id, tx, ty);
    perform tell(p_world, p_uid, 'You plan ' || nm || ' here. Extend it onto neighbouring flat packed '
      || 'tiles, then plan walls on its borders.', 'event');

  elsif p_action = 'add_to_building' then
    select * into b from building where world_id = p_world and id = neighbour_building(p_world, tx, ty);
    if not found then return; end if;
    insert into building_tile (world_id, building, x, y) values (p_world, b.id, tx, ty)
      on conflict do nothing;
    perform tell(p_world, p_uid, 'You add the tile to ' || b.name || '.', 'event');

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
    bill := wall_bill(mat.id, wt.id);
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
    used := next_material(p_world, p_uid, w.material, w.needed);
    if used is null or not consume(p_world, p_uid, used, 1) then return; end if;
    bill := jsonb_set(w.needed, array[used], to_jsonb((w.needed->>used)::int - 1));
    update wall set needed = bill where world_id = w.world_id and level = w.level
      and dir = w.dir and x = w.x and y = w.y;
    perform skill_raise(p_world, p_uid, mat.skill, 0.4);
    select * into wt from wall_type_def where id = w.type;
    if bill_done(bill) then
      what := case when wt.low then lower(wt.name) else 'wall' end;
      perform tell(p_world, p_uid, 'You finish the ' || lower(mat.name) || ' ' || what || '.', 'event');
    else
      perform tell(p_world, p_uid, 'You fit ' || material_name(used, 1) || ' into the wall. Still needed: '
        || bill_text(w.material, bill) || '.', 'event');
    end if;

  elsif p_action = 'remove_wall' then
    w := wall_at(p_world, tx, ty, side);
    if w.world_id is null then return; end if;
    select * into wt from wall_type_def where id = w.type;
    delete from wall where world_id = w.world_id and level = w.level and dir = w.dir and x = w.x and y = w.y;
    perform tell(p_world, p_uid, 'You take down the '
      || case when wt.low then lower(wt.name) else 'wall' end
      || ' on the ' || side_name(side) || ' side.', 'event');

  elsif p_action = 'add_floor' then
    if b.id is null then return; end if;
    update building set levels = levels + 1, work_level = levels
      where world_id = p_world and id = b.id returning * into b;
    perform tell(p_world, p_uid, 'You plan storey ' || b.levels || ' of ' || b.name
      || '. Plan and build its floor tiles, then raise walls on them.', 'event');

  elsif p_action = 'plan_floor' then
    if b.id is null then return; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := floor_level(p_world, b.id, kind);
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
    insert into floor_tile (world_id, level, x, y, building, material, kind, facing, needed, total, planned_by)
    values (p_world, lvl, tx, ty, b.id, mat.id, kind,
            case when kind in ('stairs', 'ladder') then side end, bill, bill, p_uid);
    perform tell(p_world, p_uid, 'You plan a '
      || case when kind = 'ladder' then 'ladder'
              else case when kind = 'roof'
                        then lower((select name from roof_shape_def where id = shape)) || ' ' else '' end
                   || lower(mat.name) || ' ' || floor_kind_name(kind) end
      || '. It needs ' || bill_text(mat.id, bill) || '.', 'event');

  elsif p_action = 'build_floor' then
    if b.id is null then return; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := floor_level(p_world, b.id, kind);
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found or bill_done(f.needed) then return; end if;
    select * into mat from build_material_def where id = f.material;
    used := next_material(p_world, p_uid, f.material, f.needed);
    if used is null or not consume(p_world, p_uid, used, 1) then return; end if;
    bill := jsonb_set(f.needed, array[used], to_jsonb((f.needed->>used)::int - 1));
    update floor_tile set needed = bill where world_id = p_world and level = lvl and x = tx and y = ty;
    -- Floors are paving; stairs, ladders and roofs are carpentry or masonry by material.
    sk := case f.kind when 'floor' then 'paving' when 'ladder' then 'carpentry'
                      else coalesce(mat.skill, 'carpentry') end;
    perform skill_raise(p_world, p_uid, sk, 0.4);
    what := case when f.kind = 'ladder' then 'ladder' else lower(mat.name) || ' ' || floor_kind_name(f.kind) end;
    if bill_done(bill) then
      perform tell(p_world, p_uid, 'You finish the ' || what || '.', 'event');
    else
      perform tell(p_world, p_uid, 'You work ' || material_name(used, 1) || ' into the '
        || floor_kind_name(f.kind) || '. Still needed: ' || bill_text(f.material, bill) || '.', 'event');
    end if;

  elsif p_action = 'remove_floor' then
    if b.id is null then return; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := floor_level(p_world, b.id, kind);
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found then return; end if;
    delete from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    -- Anybody standing on what was just torn up goes down a storey, not through it.
    if lvl > 0 then
      update player set level = lvl - 1
        where world_id = p_world and floor(x)::int = tx and floor(y)::int = ty and level >= lvl;
    end if;
    perform tell(p_world, p_uid, 'You remove the ' || floor_kind_name(f.kind) || '.', 'event');

  elsif p_action = 'remove_storey' then
    if b.id is null or b.levels <= 1 then return; end if;
    update building set levels = levels - 1, work_level = levels - 2
      where world_id = p_world and id = b.id returning * into b;
    perform tell(p_world, p_uid, b.name || ' is back to '
      || case when b.levels = 1 then 'a single storey' else b.levels || ' storeys' end || '.', 'event');
  end if;
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

  if p_action = 'plan_bridge' then
    v_kind := coalesce(p_target->>'material', 'rope');
    if bridge_reason(p_world, v_kind, floor(p.x)::int, floor(p.y)::int,
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
             where cr.world_id = p_world and cr.mode = 'deed'
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
        * case when indoors(p_world, 0, floor(pc.x)::int, floor(pc.y)::int) then indoors_rest() else 1 end,
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
      update creature set bred_at = now() - make_interval(secs => breed_rest() / 2)
        where world_id = p_world and id in (dam.id, sire.id);
      perform tell(p_world, p_uid, dam.name || ' and ' || sire.name
        || ' will have nothing to do with one another. Brush them, feed them, and try again.', 'error');
      return;
    end if;
    perform pair_them(p_world, dam.id, sire.id, v_skill);
    perform journal_note(p_world, p_uid, 'paired');
    perform tell(p_world, p_uid, sire.name || ' is put to ' || dam.name
      || '. She is in young and will drop in about ' || clock_left(gestation())
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
    select * into v_stock from item i where i.world_id = p_world and i.holder = 'player'
      and i.holder_uid = p_uid and i.def = bd.input order by i.id limit 1;
    v_ql := coalesce(v_stock.ql, 20);
    if not consume(p_world, p_uid, bd.input, bd.count) then return; end if;
    if not skill_check(skill_of(p_world, p_uid, 'brewing'), bd.difficulty, 0) then
      update placed set litres = greatest(0, placed_litres(pc) - bd.litres), since = now()
        where id = pc.id;
      update placed set liquid = null where id = pc.id and litres <= 0;
      perform skill_raise(p_world, p_uid, 'brewing', try_gain(false, brew_gain()));
      perform tell(p_world, p_uid, 'It will not take. You tip the whole soured lot out of the '
        || lower(placed_name(pc)) || '.', 'event');
      return;
    end if;
    update placed set litres = bd.litres, liquid = bd.id, ferment = bd.seconds, since = now(),
        ql = greatest(1, least(100, (v_ql + skill_of(p_world, p_uid, 'brewing')) / 2))
      where id = pc.id;
    perform journal_note(p_world, p_uid, 'brew');
    perform journal_note(p_world, p_uid, 'brew:' || bd.id);
    perform skill_raise(p_world, p_uid, 'brewing', try_gain(true, brew_gain()));
    perform tell(p_world, p_uid, bd.done || ' (about ' || round(bd.seconds / 60) || ' minutes)', 'event');
  end if;
end $function$;

select private.lock_doors();
