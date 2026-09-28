/*
 * The water garden: stepping stones laid across shallow water, a tiered
 * fountain, and water lilies and lotus planted in still water.
 *
 * Asked for with the owner's pictures of a marble garden pool: stones across
 * a stream, a fountain on paving, lilies and lotus in a pool.
 *
 *   * Stepping stones are a tile (`Stepping stones` in `tile_def`), laid over
 *     the bed of water no deeper than `stones_depth` -- the edge of the sea, a
 *     pond, or ground a stream runs over -- with the stone and the bed kept in
 *     the data byte (`stones_data`), and taken up again to the bed. Nobody on
 *     a tile of them is in deep water (`in_deep_water`), which is the one
 *     thing the move and the standing checks ask of water: nothing is added to
 *     `rpc_move` or `walk_share`, and the one new read, the tile under a body
 *     already out of its depth, is taken only when it is.
 *   * The fountain is a piece of furniture with `well` set, so it is a well to
 *     every rule here already (`is_well`, `placed_liquid`, `placed_litres`,
 *     `vessels_near`): it needs nothing of its own.
 *   * A water plant is a row of `water_plant`, keyed to its tile: which, when
 *     it was planted and when it was last picked. What it is at any moment is
 *     `water_plant_state` of those and the island's year (`season_at`), the
 *     browser's `waterPlantState` to the letter, and the browser is sent the
 *     rows on the slow half of the ground read (`rpc_ground`).
 *   * Botanizing at the water's edge rolls `botanize_water`, the botany table
 *     with a water lily root and a lotus seed in it (`perform_gather`).
 *
 * Every refusal is the browser's, in its words and its order
 * (`src/game/watergarden.ts`); `supabase/test/pondlife.ts` holds the two
 * sides to each other.
 *
 * Nothing here needs the generated definitions to exist when it is created:
 * whatever reads one of them is plpgsql, so this runs before or after the
 * definitions migration that carries them.
 */

set local lock_timeout = '3s';

-- The two water plants, filled by the definitions (`WATER_PLANTS`).
create table if not exists water_plant_def (
  id text primary key, name text not null, from_item text not null,
  leaves text[] not null, flowers text[] not null, flower_item text not null,
  seeds text[] not null, seed_item text, seed_count int not null default 0
);
alter table water_plant_def enable row level security;
-- Ground stepping stones are laid over (`STONE_BEDS`), filled by the definitions.
create table if not exists stone_bed (tile int primary key);
alter table stone_bed enable row level security;

-- A water lily or a lotus, planted in still water: one to a tile.
create table if not exists water_plant (
  world_id uuid not null references world(id) on delete cascade,
  x int not null,
  y int not null,
  kind text not null,
  planted_at timestamptz not null default now(),
  picked_at timestamptz,
  planted_by uuid,
  primary key (world_id, x, y)
);
alter table water_plant enable row level security;

/* ---- Where water runs, and what a season is ------------------------------------------------------ */

-- A tile of stepping stones' data byte: the stone in the low two bits, as a slab's is, and the bed under them in the six above (`stonesData`).
create or replace function stones_data(p_kind int, p_bed int) returns int language sql immutable as $$
  select (p_kind & 3) | ((p_bed & 63) << 2)
$$;

/*
 * Whether water runs over a tile rather than standing on it (`WaterField.runsOver`):
 * a stream's water crosses one of its corners -- over the lip, all the way
 * down, and wherever it falls -- or a pool's water goes over the edge of the
 * pool dug in it, the edge filed under the tile of the pool it is a side of.
 */
create or replace function water_runs(p_world uuid, p_x int, p_y int) returns boolean
  language sql stable as $$
  select exists (
    select 1 from spring s
      cross join lateral jsonb_array_elements(s.chain->'streams') st
      cross join lateral generate_series(0, jsonb_array_length(st->'path') / 2 - 1) k
     where s.world_id = p_world
       and s.lo_x <= p_x + 1 and p_x <= s.hi_x and s.lo_y <= p_y + 1 and p_y <= s.hi_y
       and (st->'path'->>(2 * k))::int between p_x and p_x + 1
       and (st->'path'->>(2 * k + 1))::int between p_y and p_y + 1)
  or exists (
    select 1 from spring s
      cross join lateral jsonb_array_elements(s.chain->'ponds') pd
     where s.world_id = p_world
       and s.lo_x <= p_x + 1 and p_x <= s.hi_x and s.lo_y <= p_y + 1 and p_y <= s.hi_y
       and pd ? 'tiles' and pd ? 'spill'
       and exists (select 1 from generate_series(0, jsonb_array_length(pd->'tiles') / 2 - 1) j
                    where (pd->'tiles'->>(2 * j))::int = p_x and (pd->'tiles'->>(2 * j + 1))::int = p_y)
       and case when pd->'spill'->'edge'->>1 = pd->'spill'->'edge'->>3
                -- Across the top or the bottom of a tile: the tiles above and below its first corner.
                then (pd->'spill'->'edge'->>0)::int = p_x
                     and p_y in ((pd->'spill'->'edge'->>1)::int - 1, (pd->'spill'->'edge'->>1)::int)
                -- Down its side: the tiles either side of its first corner.
                else (pd->'spill'->'edge'->>1)::int = p_y
                     and p_x in ((pd->'spill'->'edge'->>0)::int - 1, (pd->'spill'->'edge'->>0)::int) end)
$$;

-- The first dawn of the season a moment falls in: when the last season turned (`seasonBegan`).
create or replace function season_began(p_at timestamptz default now()) returns timestamptz
  language sql stable as $$
  select timestamptz '2026-09-28 00:00:00+00' + tree_dawn_utc() * interval '1 hour'
       + (year_day(p_at) - (season_day_at(p_at) - 1)) * interval '1 day'
$$;

/*
 * What a water plant is at a moment, as one line (`stateLine` of
 * `waterPlantState`): the season; whether it has rooted, `water_rooting`
 * after it was planted; whether its leaves are up or only its root is left;
 * what it bears this season once rooted, a flower or a seed head; and
 * whether that is there to pick -- nobody has picked it since the season
 * began.
 */
create or replace function water_plant_state(p_kind text, p_at timestamptz, p_picked timestamptz, p_now timestamptz default now())
  returns text language plpgsql stable as $$
declare d water_plant_def; v_season text := season_at(p_now); v_rooted boolean; v_bears text; v_ripe boolean;
begin
  select * into d from water_plant_def where id = p_kind;
  if not found then return null; end if;
  v_rooted := p_now >= p_at + make_interval(secs => water_rooting());
  v_bears := case when not v_rooted then null
                  when v_season = any (d.flowers) then 'flower'
                  when v_season = any (d.seeds) then 'seed' end;
  v_ripe := v_bears is not null and (p_picked is null or p_picked < season_began(p_now));
  return v_season || '|' || case when v_rooted then 'rooted' else 'rooting' end
      || '|' || case when v_season = any (d.leaves) then 'leaves' else 'root' end
      || '|' || coalesce(v_bears, 'none') || '|' || case when v_ripe then 'ripe' else 'bare' end;
end $$;

-- Whether a tile is at the water's edge, where botany turns up water lily roots and lotus seeds: water on it or beside it (`atWaterEdge`).
create or replace function water_edge(p_world uuid, p_x int, p_y int) returns boolean
  language sql stable as $$
  select exists (select 1 from (values (0, 0), (0, -1), (-1, 0), (1, 0), (0, 1)) v(dx, dy)
                  where in_bounds(p_world, p_x + v.dx, p_y + v.dy) and has_water(p_world, p_x + v.dx, p_y + v.dy))
$$;

/* ---- The doors ----------------------------------------------------------------------------------- */

create or replace function water_garden_action(p_action text) returns boolean language sql immutable as $$
  select p_action in ('lay_stones', 'lift_stones', 'plant_lily', 'plant_lotus', 'pick_water_plant', 'pull_water_plant')
$$;

-- A height in metres, to a tenth, as the browser says one (`metres`).
create or replace function metres(p_units double precision) returns text language sql immutable as $$
  select to_char(p_units / 10.0, 'FM990.0')
$$;

-- What a water plant is called, as a word in a sentence.
create or replace function water_plant_word(p_kind text) returns text language sql stable as $$
  select coalesce(lower((select name from water_plant_def where id = p_kind)), 'water plant')
$$;

-- "flowers in spring and summer and carries its seed heads in autumn" (`yearSays`).
create or replace function water_year_says(p_kind text) returns text language plpgsql stable as $$
declare d water_plant_def; v text;
begin
  select * into d from water_plant_def where id = p_kind;
  v := 'flowers in ' || list_of(d.flowers);
  if cardinality(d.seeds) > 0 then v := list_of(array[v, 'carries its seed heads in ' || list_of(d.seeds)]); end if;
  return v;
end $$;

-- Why stepping stones cannot be laid on a tile (`stonesRefusal`).
create or replace function stones_refusal(p_world uuid, p_x int, p_y int) returns text
  language plpgsql stable as $$
declare v_t int; v_kind text;
begin
  if not in_bounds(p_world, p_x, p_y) then return 'There is nothing there.'; end if;
  if under_building(p_world, p_x, p_y) is not null then return under_building(p_world, p_x, p_y); end if;
  if (slab_at(p_world, p_x, p_y)).id is not null then
    return 'Stepping stones stand on the bottom of the water, not on a poured slab.';
  end if;
  v_t := land_tile(p_world, p_x, p_y);
  if v_t = tile_id('Stepping stones') then return 'Stepping stones are laid here already.'; end if;
  if not has_water(p_world, p_x, p_y) and not water_runs(p_world, p_x, p_y) then
    return 'Stepping stones are laid across water: the edge of the sea, a pond, or where a stream runs.';
  end if;
  if water_depth(p_world, p_x, p_y) > stones_depth() then
    return 'The water here is too deep. A stepping stone stands on the bottom only where it is '
        || metres(stones_depth()) || ' m deep or less.';
  end if;
  if not exists (select 1 from stone_bed b where b.tile = v_t) then
    return 'Stepping stones go on bare ground or what grows flat on it. Clear what stands or is laid here first.';
  end if;
  select w.kind into v_kind from water_plant w where w.world_id = p_world and w.x = p_x and w.y = p_y;
  if v_kind is not null then return 'A ' || water_plant_word(v_kind) || ' grows here. Pull it up first.'; end if;
  return null;
end $$;

-- Why a water plant cannot be planted on a tile (`plantRefusal`).
create or replace function plant_refusal(p_world uuid, p_kind text, p_x int, p_y int) returns text
  language plpgsql stable as $$
declare v_name text := water_plant_word(p_kind); v_depth double precision; v_kind text;
begin
  if not in_bounds(p_world, p_x, p_y) then return 'There is nothing there.'; end if;
  if under_building(p_world, p_x, p_y) is not null then return under_building(p_world, p_x, p_y); end if;
  if not has_water(p_world, p_x, p_y) then
    return 'A ' || v_name || ' is planted in still water: a pond, a pool or the shallows of the sea.';
  end if;
  if water_runs(p_world, p_x, p_y) then return 'The water runs here. A ' || v_name || ' takes root only in still water.'; end if;
  v_depth := water_depth(p_world, p_x, p_y);
  if v_depth < water_plant_shallowest() or v_depth > water_plant_deepest() then
    return 'A ' || v_name || ' takes root where the water is ' || metres(water_plant_shallowest())
        || ' to ' || metres(water_plant_deepest()) || ' m deep.';
  end if;
  if land_tile(p_world, p_x, p_y) = tile_id('Stepping stones') then return 'Stepping stones are laid here.'; end if;
  select w.kind into v_kind from water_plant w where w.world_id = p_world and w.x = p_x and w.y = p_y;
  if v_kind is not null then return 'A ' || water_plant_word(v_kind) || ' grows here already.'; end if;
  return null;
end $$;

-- Why a water plant's flower or seed head cannot be picked (`pickRefusal`).
create or replace function pick_refusal(p_world uuid, p_x int, p_y int, p_now timestamptz default now()) returns text
  language plpgsql stable as $$
declare w water_plant; v_state text[]; v_name text;
begin
  select * into w from water_plant where world_id = p_world and x = p_x and y = p_y;
  if not found then return 'Nothing is planted here.'; end if;
  if not has_water(p_world, p_x, p_y) then return 'Its water is gone. It lies in the mud until the water comes back.'; end if;
  v_name := water_plant_word(w.kind);
  v_state := string_to_array(water_plant_state(w.kind, w.planted_at, w.picked_at, p_now), '|');
  if v_state[2] = 'rooting' then
    return 'It has not rooted yet. A ' || v_name || ' roots ' || water_rooting_said() || ' after it is planted.';
  end if;
  if v_state[4] = 'none' then return 'A ' || v_name || ' ' || water_year_says(w.kind) || ', and it is ' || v_state[1] || ' now.'; end if;
  if v_state[5] = 'bare' then
    return 'Its ' || case when v_state[4] = 'seed' then 'seed head was' else 'flower was' end
        || ' picked this ' || v_state[1] || '. There is no other until the season turns.';
  end if;
  return null;
end $$;

/*
 * The doors of the six, each in the browser's order: reach first, as every
 * family here answers for its own, and then what the browser asks.
 */
create or replace function water_garden_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns text
  language plpgsql stable as $$
declare d action_def; p player; tx int; ty int; v_why text; v_kind text;
begin
  select * into d from action_def where id = p_action;
  select * into p from player where world_id = p_world and uid = p_uid;
  if p_target->>'kind' is distinct from 'tile' then return 'Choose the ground.'; end if;
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  if not in_bounds(p_world, tx, ty) then return 'There is nothing there.'; end if;
  if not in_reach(p.x, p.y, p_target, false, d.range) then return 'You are too far away from that.'; end if;
  if p_action = 'lay_stones' then
    v_why := stones_refusal(p_world, tx, ty);
    if v_why is not null then return v_why; end if;
    if tool_ql(p_world, p_uid, 'trowel') <= 0 then return 'You need a trowel to set a stone.'; end if;
    if not exists (select 1 from item i join slab_def s on s.item = i.def
                    where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and not i.locked) then
      return 'You need a cut slab to break into stepping stones.';
    end if;
    return null;
  end if;
  if p_action = 'lift_stones' then
    if land_tile(p_world, tx, ty) is distinct from tile_id('Stepping stones') then return 'There are no stepping stones here.'; end if;
    return under_building(p_world, tx, ty);
  end if;
  if p_action in ('plant_lily', 'plant_lotus') then
    v_kind := substr(p_action, length('plant_') + 1);
    v_why := plant_refusal(p_world, v_kind, tx, ty);
    if v_why is not null then return v_why; end if;
    if pack_count(p_world, p_uid, (select from_item from water_plant_def where id = v_kind)) < 1 then
      return 'You have no ' || lower((select i.name from item_def i join water_plant_def w on w.from_item = i.id where w.id = v_kind))
          || ' to plant.';
    end if;
    return null;
  end if;
  if p_action = 'pick_water_plant' then return pick_refusal(p_world, tx, ty); end if;
  if p_action = 'pull_water_plant' then
    if not exists (select 1 from water_plant w where w.world_id = p_world and w.x = tx and w.y = ty) then
      return 'Nothing is planted here.';
    end if;
    return null;
  end if;
  return null;
end $$;

create or replace function perform_water_garden(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns void
  language plpgsql as $$
declare d action_def; tx int := (p_target->>'x')::int; ty int := (p_target->>'y')::int;
        v_slab item; v_kind int; v_tool bigint; v_data int; v_bed int; v_ql double precision;
        w water_plant; pd water_plant_def; v_state text[]; v_plant text;
begin
  select * into d from action_def where id = p_action;
  if p_action = 'lay_stones' then
    select i.* into v_slab from item i join slab_def s on s.item = i.def
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and not i.locked
      order by (i.id = target_item(p_target)) desc, i.id limit 1;
    if not found then return; end if;
    select id into v_kind from slab_def where item = v_slab.def;
    select i.id into v_tool from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'trowel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_tool is not null then perform wear_tool(v_tool); end if;
    if not perk_pass(skill_check(skill_of(p_world, p_uid, 'masonry'), d.difficulty, v_slab.ql),
                     pk(p_world, p_uid, 'fail:lay_stones', 1)) then
      perform skill_raise(p_world, p_uid, 'masonry', try_gain(false));
      perform tell(p_world, p_uid, 'The stone rocks on the bottom however you set it. You leave it for now.', 'event');
      return;
    end if;
    if not consume(p_world, p_uid, v_slab.def, stones_slabs()::int, v_slab.id) then return; end if;
    perform land_set_data(p_world, tx, ty, stones_data(v_kind, land_tile(p_world, tx, ty)));
    perform land_set_tile(p_world, tx, ty, tile_id('Stepping stones'));
    perform land_announce(p_world, tx, ty);
    perform skill_raise(p_world, p_uid, 'masonry', 1);
    perform tell(p_world, p_uid, 'You break the ' || lower((select name from item_def where id = v_slab.def))
      || ' into flat stones and set them on the bottom, a stride apart.', 'event');

  elsif p_action = 'lift_stones' then
    v_data := land_data(p_world, tx, ty);
    v_kind := v_data & 3;
    v_bed := (v_data >> 2) & 63;
    -- The bed goes back as it was: a rock one showing its own rock again.
    perform land_set_tile(p_world, tx, ty, v_bed);
    perform land_set_data(p_world, tx, ty, case when v_bed = tile_id('Rock') then land_rock(p_world, tx, ty) else 0 end);
    perform land_announce(p_world, tx, ty);
    v_ql := product_ql(skill_of(p_world, p_uid, 'masonry'));
    perform gather(p_world, p_uid, (select item from slab_def where id = v_kind), stones_slabs()::int, v_ql);
    perform skill_raise(p_world, p_uid, 'masonry', 1);
    perform tell(p_world, p_uid, 'You lift the stones out of the water, a '
      || lower((select i.name from item_def i join slab_def s on s.item = i.id where s.id = v_kind))
      || '''s worth. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');

  elsif p_action in ('plant_lily', 'plant_lotus') then
    v_plant := substr(p_action, length('plant_') + 1);
    select * into pd from water_plant_def where id = v_plant;
    if not consume(p_world, p_uid, pd.from_item, 1) then return; end if;
    insert into water_plant (world_id, x, y, kind, planted_at, planted_by) values (p_world, tx, ty, v_plant, now(), p_uid);
    perform skill_raise(p_world, p_uid, 'botanizing', 1);
    perform tell(p_world, p_uid, 'You press the ' || lower((select name from item_def where id = pd.from_item))
      || ' into the mud under the water. It will root in ' || water_rooting_said() || '.', 'event');

  elsif p_action = 'pick_water_plant' then
    if pick_refusal(p_world, tx, ty) is not null then return; end if;
    select * into w from water_plant where world_id = p_world and x = tx and y = ty for update;
    select * into pd from water_plant_def where id = w.kind;
    v_state := string_to_array(water_plant_state(w.kind, w.planted_at, w.picked_at, now()), '|');
    update water_plant set picked_at = now() where world_id = p_world and x = tx and y = ty;
    perform skill_raise(p_world, p_uid, 'botanizing', 1);
    v_ql := product_ql(skill_of(p_world, p_uid, 'botanizing'));
    if v_state[4] = 'seed' and pd.seed_item is not null then
      perform gather(p_world, p_uid, pd.seed_item, pd.seed_count, v_ql);
      perform tell(p_world, p_uid, 'You break the ' || lower(pd.name) || ' seed head open: ' || number_word(pd.seed_count)
        || ' ' || lower((select name from item_def where id = pd.seed_item)) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
    else
      perform gather(p_world, p_uid, pd.flower_item, 1, v_ql);
      perform tell(p_world, p_uid, 'You pick a ' || lower((select name from item_def where id = pd.flower_item))
        || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
    end if;

  elsif p_action = 'pull_water_plant' then
    delete from water_plant where world_id = p_world and x = tx and y = ty returning * into w;
    if w.kind is null then return; end if;
    select * into pd from water_plant_def where id = w.kind;
    perform give(p_world, p_uid, pd.from_item, 1, product_ql(skill_of(p_world, p_uid, 'botanizing')));
    perform skill_raise(p_world, p_uid, 'botanizing', 1);
    perform tell(p_world, p_uid, 'You pull up the ' || lower(pd.name) || ', root and all.', 'event');
  end if;
end $$;

/* ---- What a browser is sent ----------------------------------------------------------------------- */

-- The water plants within `p_range` of a point, as the browser keeps them: when each was planted and last picked, in epoch seconds.
create or replace function water_plants_near(p_world uuid, p_x double precision, p_y double precision, p_range double precision)
  returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('x', w.x, 'y', w.y, 'kind', w.kind,
           'at', extract(epoch from w.planted_at), 'picked', extract(epoch from w.picked_at)) order by w.y, w.x), '[]'::jsonb)
  from water_plant w
  where w.world_id = p_world
    and w.x between floor(p_x - p_range)::int and floor(p_x + p_range)::int
    and w.y between floor(p_y - p_range)::int and floor(p_y + p_range)::int
$$;


/* ---- Where the rest of the island hears of them ---------------------------------------------------- */

CREATE OR REPLACE FUNCTION public.in_deep_water(p_world uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select case
    -- A bridge deck or a mine floor is not the ground, and not the water.
    when p.level <> 0 then false
    /*
     * The cheap question first: almost everybody, almost always, is on dry
     * ground. And coalesced, because `land_height` answers NULL for ground
     * nothing has been written for, a NULL guard matches no `when`, and the
     * `else` below is a yes — so an unread height used to mean *swimming*, and
     * a swimmer spends wind rather than getting it back. Fourteen checks of
     * the live run failed with "You are too exhausted to do that" and the body
     * never recovered, because there was nothing to recover from but this.
     */
    -- Out of your depth in a pond as much as in the sea: measured down from whichever water is here.
    when coalesce(water_bed(p_world, floor(p.x)::int, floor(p.y)::int), 0)
         >= water_surface(p_world, floor(p.x)::int, floor(p.y)::int) - swim_depth()
      then false
    /*
     * On stepping stones the feet are dry however deep the water beside them
     * is (`Player.update`). Asked only of a body already out of its depth,
     * which is nobody on dry ground: one read of the tile under it, and the
     * move and the standing checks ask nothing else of stones.
     */
    when land_tile(p_world, floor(p.x)::int, floor(p.y)::int) = tile_id('Stepping stones') then false
    -- A hull, a cart bed or a saddle: something else is holding you up.
    when exists (select 1 from placed q where q.world_id = p_world and q.driver = p_uid) then false
    -- A passenger stands on a deck.
    when p.aboard is not null then false
    when exists (select 1 from creature c where c.world_id = p_world and c.rider = p_uid) then false
    else bridge_at(p_world, floor(p.x)::int, floor(p.y)::int) is null
  end
  from player p where p.world_id = p_world and p.uid = p_uid
$function$;

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
  -- The hour comes for a dam in young whoever is or is not standing there, and
  -- somebody is always about to do something. This is where they find out.
  perform herd_settle(p_world);
  -- A spring answers for its own reach, its own tool and whose spring it is.
  if spring_action(p_action) then
    return spring_refusal(p_world, p_uid, p_action, p_target);
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

CREATE OR REPLACE FUNCTION public.act_perform(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare d action_def; tq double precision; s double precision; cx int; cy int; tx int; ty int;
        t tile_def; left_dirt int; made_ql double precision; yield text; tool_id bigint;
begin
  if spring_action(p_action) then
    perform perform_spring(p_world, p_uid, p_action, p_target);
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
      or flower_action(p_action)
      or green_action(p_action)
      or water_garden_action(p_action)
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
      or p_action in ('dig', 'mine', 'chip_corner', 'pack', 'cultivate', 'pave_cobble',
                      'drop_dirt_here', 'cut_down', 'forage', 'botanize', 'collect',
                      'fish', 'drag_net', 'found_settlement', 'set_to_work', 'dig_tile', 'pan')
$function$;

CREATE OR REPLACE FUNCTION public.shapes_ground(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in ('dig', 'dredge', 'flatten', 'drop_dirt', 'drop_dirt_here', 'raise_rock',
                      'mine', 'chip_corner', 'pack', 'cultivate', 'pave_cobble',
                      'pave_slabs', 'remove_paving',
                      'plan_foundation', 'pour_foundation', 'strike_foundation',
                      'dig_spring', 'stop_spring', 'dig_pool', 'fill_pool',
                      'lay_steps', 'lay_timber_steps', 'take_up_steps', 'plant_moss',
                      -- Stepping stones laid and taken up, and a water lily or a lotus planted or pulled up.
                      'lay_stones', 'lift_stones', 'plant_lily', 'plant_lotus', 'pull_water_plant')
$function$;

CREATE OR REPLACE FUNCTION public.perform_gather(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare d action_def; tx int; ty int; here int; data int; t tile_def; tool_id bigint;
        s double precision; tq double precision; made_ql double precision;
        species int; logs int; tree tree_def;
        v_age tree_age_def; v_cuts int;
        passes int; i int; found text[] := '{}'; got text; yields text;
        v_n int; v_hits int; v_rare text;
begin
  select * into d from action_def where id = p_action;
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  here := land_tile(p_world, tx, ty);
  data := land_data(p_world, tx, ty);
  select * into t from tile_def where id = here;
  s := case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end;
  if d.tool is not null then
    select it.id into tool_id from item it
      where it.world_id = p_world and it.holder = 'player' and it.holder_uid = p_uid and it.def = d.tool
      order by tool_worth(it.ql, it.dmg, it.extra, it.rare, it.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id); end if;
  end if;

  if p_action = 'cut_down' then
    -- A Forester's Sure Hatchet glances off half as often (`fail:cut_down`).
    if not perk_pass(skill_check(s, d.difficulty, tq), pk(p_world, p_uid, 'fail:cut_down', 1)) then
      perform skill_raise(p_world, p_uid, 'woodcutting', try_gain(false));
      perform tell(p_world, p_uid, 'Your hatchet glances off and you fail to make headway.', 'event');
      return;
    end if;
    if here = tile_id('Bush') then
      perform land_set_tile(p_world, tx, ty, tile_id('Grass'));
      perform land_set_data(p_world, tx, ty, 0);
      perform land_announce(p_world, tx, ty);
      perform tell(p_world, p_uid, 'You hack the bush down.', 'event');
      -- And straight shafts out of it, for a Forester's Kindling (`bush:shaft`).
      v_n := floor(pk(p_world, p_uid, 'bush:shaft', 0))::int;
      if v_n > 0 then
        made_ql := product_ql(s, tq);
        perform give(p_world, p_uid, 'shaft', v_n, made_ql);
        perform tell(p_world, p_uid, 'You trim ' || number_word(v_n) || ' straight '
          || case when v_n = 1 then 'shaft' else 'shafts' end || ' out of it. (QL '
          || to_char(made_ql, 'FM990.0') || ')', 'event');
      end if;
    elsif here <> tile_id('Tree') then
      -- Nothing standing is nothing to fell. `act_refusal` says so before the
      -- swing and this says so after it: reading a tree off a tile that has
      -- none gives species 0 and age 0, which is a birch out of thin air.
      perform tell(p_world, p_uid, 'There is nothing standing here to cut down.', 'error');
      return;
    else
      species := tree_species(data);
      select * into tree from tree_def where id = species;
      select * into v_age from tree_age_def where id = tree_age(data);
      /*
       * A tree comes down in strokes, and how many depends on what it is.
       *
       * The count is kept beside the tile, in `tree_notch`, rather than in
       * the swinging — because a wood is not one woodcutter's. Leave a half-felled oak and the notch is still in it
       * tomorrow, for you or for whoever finds it. A cut that glances off is
       * not one of them: that is the skill check above, which has already
       * returned by here.
       */
      v_cuts := tree_cuts(p_world, tx, ty) + 1;
      -- A stroke fewer for a Forester's Heavy Swing, and never none.
      v_hits := tree_hits(p_world, p_uid, v_age.hits);
      if v_cuts < v_hits then
        perform tree_notch(p_world, tx, ty, v_cuts);
        perform tell(p_world, p_uid, 'You cut into the ' || lower(v_age.name) || ' '
          || lower(tree.name) || '. ' || (v_hits - v_cuts)
          || ' more like that and it comes down.', 'event');
      else
        logs := v_age.logs;
        -- A tree with timber in it leaves a stump of its kind, in the way of
        -- the ground for a day or until somebody digs it out. Nothing smaller
        -- leaves one worth the name.
        -- And none for a Forester's Clean Drop (`stump:clear`): grass where it stood.
        if logs = 0 or pk(p_world, p_uid, 'stump:clear', 0) > 0 then
          perform land_set_tile(p_world, tx, ty, tile_id('Grass'));
          perform land_set_data(p_world, tx, ty, 0);
        else
          perform land_set_tile(p_world, tx, ty, tile_id('Stump'));
          perform land_set_data(p_world, tx, ty, tree_pack(species, 0));
        end if;
        perform land_announce(p_world, tx, ty);
        perform journal_note(p_world, p_uid, 'tree');
        if logs = 0 then
          perform tell(p_world, p_uid, 'You clear the ' || lower(v_age.name) || ' '
            || lower(tree.name) || ' away. There is no timber in one that size.', 'event');
        else
          -- Better for a Forester's Choice Logs (`ql:cut_down`), and now and
          -- then rare for their Rare Heartwood (`rare:cut_down`).
          made_ql := least(100, product_ql(s, tq) * pk(p_world, p_uid, 'ql:cut_down', 1));
          v_rare := perk_rare(pk(p_world, p_uid, 'rare:cut_down', 0));
          perform gather(p_world, p_uid, 'log', logs, made_ql, tree.name, v_rare);
          perform tell(p_world, p_uid, 'The ' || lower(v_age.name) || ' ' || lower(tree.name)
            || ' comes down. You get ' || logs || coalesce(' ' || v_rare, '')
            || case when logs = 1 then ' log' else ' logs' end || '. (QL ' || to_char(made_ql, 'FM990.0') || ')'
            || case when pk(p_world, p_uid, 'stump:clear', 0) > 0 then ' The ground is clear where it stood.'
                    else ' The stump is left.' end, 'event');
          if v_rare is not null then
            perform journal_note(p_world, p_uid, v_rare);
            perform tell(p_world, p_uid, rarity_word(v_rare), 'skill');
          end if;
          -- A nest in the crown and a wild hive in the trunk, for a Forester's
          -- Nest Finder and Honey Hunter: into the pack, at the logs' quality.
          if random() < pk(p_world, p_uid, 'nest:chance', 0) then
            v_n := floor(pk(p_world, p_uid, 'nest:feathers', 0))::int;
            perform give(p_world, p_uid, 'feather', v_n, made_ql);
            perform tell(p_world, p_uid, 'A nest comes down with it: ' || number_word(v_n) || ' '
              || lower((select name from item_def where id = 'feather')) || '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
          end if;
          if random() < pk(p_world, p_uid, 'honey:chance', 0) then
            v_n := floor(pk(p_world, p_uid, 'honey:count', 0))::int;
            perform give(p_world, p_uid, 'honey', v_n, made_ql);
            perform tell(p_world, p_uid, 'A wild hive in the trunk gives up ' || number_word(v_n) || ' '
              || lower((select name from item_def where id = 'honey')) || '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
          end if;
        end if;
      end if;
    end if;
    perform skill_raise(p_world, p_uid, 'woodcutting', 1);

  elsif p_action in ('forage', 'botanize') then
    perform mark_foraged(p_world, tx, ty, p_action);
    -- A practised eye goes over the same ground more than once, and a
    -- Naturalist's Keen Eye once more again.
    passes := rolls_at(s) + floor(pk(p_world, p_uid, 'passes:' || p_action, 0))::int;
    for i in 1..passes loop
      -- None empty by chance for a Naturalist's Sure Find.
      if random() < forage_empty() * pk(p_world, p_uid, 'empty:' || p_action, 1)
         or not skill_check(s, find_check(), 0) then continue; end if;
      -- At the water's edge the botany table has water lily roots and lotus seeds in it too.
      got := roll_table(case when p_action = 'botanize' and water_edge(p_world, tx, ty) then 'botanize_water'
                             else p_action end, random());
      made_ql := product_ql(s, 0);
      -- And now and then a rare one, for a Naturalist's Rare Find.
      v_rare := perk_rare(pk(p_world, p_uid, 'rare:' || p_action, 0));
      perform gather(p_world, p_uid, got, 1, made_ql, null, v_rare);
      found := found || (coalesce(v_rare || ' ', '') || lower((select coalesce(name, got) from item_def where id = got))
        || ' (QL ' || to_char(made_ql, 'FM990.0') || ')');
      if v_rare is not null then
        perform journal_note(p_world, p_uid, v_rare);
        perform tell(p_world, p_uid, rarity_word(v_rare), 'skill');
      end if;
    end loop;
    if array_length(found, 1) is null then
      perform tell(p_world, p_uid, case when passes > 1
        then 'You go over the ground ' || passes || ' times and find nothing'
             || case when p_action = 'forage' then ' edible.' else ' of interest.' end
        else case when p_action = 'forage' then 'You find nothing edible.' else 'You find nothing of interest.' end
        end, 'event');
    else
      perform tell(p_world, p_uid, 'You find some ' || list_of(found) || '.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, d.skill, try_gain(array_length(found, 1) is not null));

  elsif p_action = 'collect' then
    yields := t.dig_yield;
    if yields is null then return; end if;
    if not skill_check(s, d.difficulty, tq) then
      perform skill_raise(p_world, p_uid, 'digging', try_gain(false));
      perform tell(p_world, p_uid, 'Your shovel comes up with nothing but a smear of '
        || lower(t.name) || '.', 'event');
      return;
    end if;
    made_ql := least(100, product_ql(s, tq) * pk(p_world, p_uid, 'ql:collect', 1));
    perform gather(p_world, p_uid, yields, 1, made_ql, null, perk_rare(pk(p_world, p_uid, 'rare:collect', 0)));
    perform tell(p_world, p_uid, 'You fill a shovel with '
      || lower((select coalesce(name, yields) from item_def where id = yields))
      || ' off the top of the bed. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    perform skill_raise(p_world, p_uid, 'digging', 1);
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
        'grown', v_field - crop_clock(false, c.stage_at),
        'ago', extract(epoch from (now() - c.stage_at)),
        'tended', c.tended, 'tendedNow', c.tended_now, 'ql', c.ql, 'pace', c.pace))
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
      'nextId', coalesce((select max(b.id) + 1 from building b where b.world_id = p_world), 1),
      'list', coalesce((select jsonb_agg(jsonb_build_object(
          'id', b.id, 'name', b.name, 'levels', b.levels, 'workLevel', b.work_level,
          'tiles', (select coalesce(jsonb_agg(bt.x || ',' || bt.y order by bt.y, bt.x), '[]'::jsonb)
                      from building_tile bt
                     where bt.world_id = p_world and bt.building = b.id)) order by b.id)
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
        'greenAgo', case when b.kind = 'stone' and not exists (select 1 from bridge_span s
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


select private.lock_doors();
