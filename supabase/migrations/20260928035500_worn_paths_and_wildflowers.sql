/*
 * Worn paths and wildflowers.
 *
 * ## Worn paths
 *
 * Grass, lawn, steppe, tundra and moss wear where people walk. Every step a
 * body takes on its own feet into a tile of one of those (`tile_def.wears`)
 * puts a point of wear on it, up to `wear_most`; at `wear_trail` it is worn
 * through to a trail, tile 24, whose data byte keeps what it was. At every
 * turn of the woods each worn tile loses `wear_fall`, and a trail with none
 * left is the ground it was again. A trail takes wear as well, so a path
 * people keep walking stays a path. Ground a building or a foundation stands
 * on is built ground, and a bridge deck is not the ground under it: neither
 * wears. The browser keeps the same rule for a game of its own
 * (`Game.wearStep`, `World.wear`), and `supabase/test/trails.ts` holds the two
 * to each other.
 *
 * The count is kept beside the land, as the felling notches are, in
 * `tile_wear`: it changes with every step, and nobody needs to hear of it
 * until the tile changes. So the walk costs one small keyed row a tile
 * stepped into, only on a call whose walk left the tile it started in, and a
 * trail forming or going is written and told as any other change of a tile.
 *
 * ## Wildflowers
 *
 * Untouched grass carries drifts of flowers in spring and summer, where the
 * drift -- two lattices of whole numbers hashed out of the world's seed
 * (`flower_drift`, the browser's `flowerDrift`) -- stands over the season's
 * line (`flower_season`). Pick flowers gives a wildflower for each clump on a
 * tile and marks the tile picked (`flowers_picked`, bit 8 of a grass byte)
 * until the next year begins with the spring; `tree_day` keeps the bit beside
 * the mowing count and clears it at the first turn of a new year, and tells
 * everybody when it does. `supabase/test/flowers.ts` asks both sides.
 */

set local lock_timeout = '3s';

/* ---- The year, counted --------------------------------------------------------------------------- */

/** Which year a moment falls in: nought for the first, below nought before it. The browser's `yearOf`. */
create or replace function year_of(p_at timestamptz default now())
returns int language sql stable as $fn$
  select floor(year_day(p_at)::numeric / 28)::int
$fn$;

/* ---- Worn paths ------------------------------------------------------------------------------------ */

create table if not exists tile_wear (
  world_id uuid not null references world(id) on delete cascade,
  x int not null,
  y int not null,
  -- Points of wear. A tile with none has no row.
  wear smallint not null,
  primary key (world_id, x, y)
);
alter table tile_wear enable row level security;
revoke all on tile_wear from anon, authenticated;

/** The ground a trail was worn out of, off its data byte: grass for a byte that names none of them. */
create or replace function trail_ground(p_data int) returns int
  language sql stable as $fn$
  select case when exists (select 1 from tile_def d where d.id = p_data and d.wears) then p_data
              else tile_id('Grass') end
$fn$;

/**
 * A step on somebody's own feet into a tile: a point of wear on it if it is
 * ground that wears or a trail already, up to `wear_most`, and at
 * `wear_trail` a trail that keeps in its byte what it was. The browser's
 * `wearStep`. One keyed row; nothing written at all once the tile holds all
 * the wear it can.
 */
create or replace function wear_step(p_world uuid, p_x int, p_y int) returns void
  language plpgsql as $fn$
declare v_t int; v_wears boolean; v_trail boolean; v_wear int;
begin
  v_t := land_tile(p_world, p_x, p_y);
  -- Whether it wears and whether it is a trail already, in one keyed read.
  select d.wears, d.name = 'Trail' into v_wears, v_trail from tile_def d where d.id = v_t;
  if not coalesce(v_wears or v_trail, false) then return; end if;
  -- Built ground: a building's footprint, or a foundation set out or poured.
  if exists (select 1 from building_tile b where b.world_id = p_world and b.x = p_x and b.y = p_y)
     or exists (select 1 from foundation f where f.world_id = p_world and f.x = p_x and f.y = p_y) then
    return;
  end if;
  insert into tile_wear as tw (world_id, x, y, wear) values (p_world, p_x, p_y, 1)
    on conflict (world_id, x, y) do update set wear = tw.wear + 1 where tw.wear < wear_most()::int
    returning tw.wear into v_wear;
  if v_wear is null or v_wear < wear_trail()::int or v_trail then return; end if;
  perform land_set_tile(p_world, p_x, p_y, tile_id('Trail'));
  perform land_set_data(p_world, p_x, p_y, v_t);
  perform land_announce(p_world, p_x, p_y);
end $fn$;

/**
 * The tiles a walk between two places stepped into, as `walk_climbs` finds
 * the steps it pays climbing for -- the same samples, and neighbours only --
 * with a point of wear on each (`wear_step`). Never a tile a bridge's deck
 * spans; the banks at its two ends are ground, and walked, as the browser's
 * `bridgeAt` has them.
 */
create or replace function wear_walk(p_world uuid, p_x0 double precision, p_y0 double precision,
                                     p_x1 double precision, p_y1 double precision) returns void
  language plpgsql as $fn$
declare far double precision; n int; i int; t double precision;
        fx int; fy int; tx int; ty int; spans boolean;
begin
  far := sqrt(power(p_x1 - p_x0, 2) + power(p_y1 - p_y0, 2));
  if far <= 0.0001 then return; end if;
  spans := exists (select 1 from bridge b where b.world_id = p_world);
  fx := floor(p_x0)::int; fy := floor(p_y0)::int;
  n := least(walk_samples()::int, greatest(1, ceil(far * 2)::int));
  for i in 1..n loop
    t := i::double precision / n;
    tx := floor(p_x0 + (p_x1 - p_x0) * t)::int;
    ty := floor(p_y0 + (p_y1 - p_y0) * t)::int;
    if tx <> fx or ty <> fy then
      if abs(tx - fx) <= 1 and abs(ty - fy) <= 1
         and (not spans or not exists (select 1 from bridge_span s
                                        where s.world_id = p_world and s.x = tx and s.y = ty)) then
        perform wear_step(p_world, tx, ty);
      end if;
      fx := tx; fy := ty;
    end if;
  end loop;
end $fn$;

/**
 * The day's fall off every worn tile, at the turn of the woods: `wear_fall`
 * each, and a tile with none left forgotten -- and if it is a trail, the
 * ground it was worn out of again, written and told for everybody. Whether
 * any tile changed, so `tree_day` knows to drop the cached chunks.
 */
create or replace function trail_day(p_world uuid) returns boolean
  language plpgsql as $fn$
declare v_trail int := tile_id('Trail'); r record; v_any boolean := false;
begin
  update tile_wear set wear = wear - wear_fall()::int where world_id = p_world;
  for r in select tw.x, tw.y from tile_wear tw where tw.world_id = p_world and tw.wear <= 0 order by tw.y, tw.x loop
    if land_tile(p_world, r.x, r.y) = v_trail then
      perform land_set_tile(p_world, r.x, r.y, trail_ground(land_data(p_world, r.x, r.y)));
      perform land_set_data(p_world, r.x, r.y, 0);
      perform land_announce(p_world, r.x, r.y);
      v_any := true;
    end if;
  end loop;
  delete from tile_wear where world_id = p_world and wear <= 0;
  return v_any;
end $fn$;

/**
 * Ground a shovel treads down into packed dirt: soil, anything growing on it,
 * and a trail, which feet have half packed already -- how a path people wore
 * becomes a road. The browser's `PACKABLE`.
 */
create or replace function packable(p_tile int) returns boolean language sql immutable as $$
  select p_tile in (1, 0, 20, 5, 6, 11, 24)   -- dirt, grass, lawn, steppe, tundra, moss, trail
$$;

/* ---- Wildflowers ------------------------------------------------------------------------------------ */

/**
 * How deep in a drift a tile lies, nought to 255: the browser's `flowerDrift`
 * to the last whole number. Each lattice is eased (a smoothstep) or taken
 * straight between its four corners at the tile's middle, as a numerator over
 * `(2 cell)^6`; the two are weighed together over the product of their
 * denominators, in `bigint` all the way, and divided once.
 */
create or replace function flower_drift(p_seed bigint, p_x int, p_y int) returns int
  language plpgsql stable as $fn$
declare o record; v_num bigint[] := '{}'; v_den bigint[] := '{}'; v_w bigint[] := '{}';
        k bigint; k3 bigint; gx int; gy int; sx bigint; sy bigint; tx bigint; ty bigint;
        c00 bigint; c10 bigint; c01 bigint; c11 bigint; v_top bigint; v_bottom bigint;
begin
  for o in select * from flower_octave order by i loop
    k := 2 * o.cell; k3 := k * k * k;
    gx := p_x / o.cell; gy := p_y / o.cell;
    tx := 2 * (p_x - gx * o.cell) + 1; ty := 2 * (p_y - gy * o.cell) + 1;
    sx := case when o.eased then tx * tx * (3 * k - 2 * tx) else tx * k * k end;
    sy := case when o.eased then ty * ty * (3 * k - 2 * ty) else ty * k * k end;
    c00 := floor(hash_tile(gx, gy, p_seed + o.salt) * 256)::bigint;
    c10 := floor(hash_tile(gx + 1, gy, p_seed + o.salt) * 256)::bigint;
    c01 := floor(hash_tile(gx, gy + 1, p_seed + o.salt) * 256)::bigint;
    c11 := floor(hash_tile(gx + 1, gy + 1, p_seed + o.salt) * 256)::bigint;
    v_top := c00 * (k3 - sx) + c10 * sx;
    v_bottom := c01 * (k3 - sx) + c11 * sx;
    v_num := v_num || (v_top * (k3 - sy) + v_bottom * sy);
    v_den := v_den || (k3 * k3);
    v_w := v_w || o.weight::bigint;
  end loop;
  return ((v_w[1] * v_num[1] * v_den[2] + v_w[2] * v_num[2] * v_den[1])
          / ((v_w[1] + v_w[2]) * v_den[1] * v_den[2]))::int;
end $fn$;

/** How many clumps a drift this deep carries in a season: nought where it does not flower. The browser's `bloomOf`. */
create or replace function flower_bloom(p_drift int, p_season text) returns int
  language sql stable as $fn$
  select coalesce((select case when s.drift is null or p_drift < s.drift then 0
                               else least(s.most, 1 + (p_drift - s.drift) / flower_step()::int) end
                     from flower_season s where s.season = p_season), 0)
$fn$;

/**
 * The clumps of wildflowers on a tile at a moment: grass, not picked this
 * year, and no building over it. The browser's `flowersHere`.
 */
create or replace function flowers_on(p_world uuid, p_x int, p_y int, p_at timestamptz default now()) returns int
  language plpgsql stable as $fn$
declare v_t int; v_d int;
begin
  v_t := land_tile(p_world, p_x, p_y);
  if v_t is distinct from tile_id('Grass') then return 0; end if;
  v_d := land_data(p_world, p_x, p_y);
  if (v_d & flowers_picked()::int) <> 0 then return 0; end if;
  if exists (select 1 from building_tile b where b.world_id = p_world and b.x = p_x and b.y = p_y) then return 0; end if;
  return flower_bloom(flower_drift((select w.seed from world w where w.id = p_world), p_x, p_y), season_at(p_at));
end $fn$;

/** The seasons anything flowers in, as a sentence says them: "spring and summer". */
create or replace function flower_seasons_said() returns text
  language sql stable as $fn$
  select case when count(*) < 2 then coalesce(max(season), '')
              else string_agg(season, ', ' order by ord) filter (where ord < max_ord)
                   || ' and ' || max(season) filter (where ord = max_ord) end
    from (select s.season, array_position(array['spring', 'summer', 'autumn', 'winter'], s.season) as ord,
                 max(array_position(array['spring', 'summer', 'autumn', 'winter'], s.season)) over () as max_ord
            from flower_season s where s.drift is not null) q
$fn$;

create or replace function flower_action(p_action text) returns boolean language sql immutable as $$
  select p_action = 'pick_flowers'
$$;

/**
 * Why a tile's flowers cannot be picked, or null when they can: the
 * browser's `flowerRefusal`, word for word and in the same order, with the
 * reach first because this family answers for its own.
 */
create or replace function flower_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns text
  language plpgsql stable as $fn$
declare d action_def; p player; tx int; ty int; v_season text;
begin
  select * into d from action_def where id = p_action;
  select * into p from player where world_id = p_world and uid = p_uid;
  if p_target->>'kind' is distinct from 'tile' then return 'Choose the ground.'; end if;
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  if not in_bounds(p_world, tx, ty) then return 'There is nothing there.'; end if;
  if not in_reach(p.x, p.y, p_target, false, d.range) then return 'You are too far away from that.'; end if;
  if land_tile(p_world, tx, ty) <> tile_id('Grass') then return 'Wildflowers grow on grass.'; end if;
  if exists (select 1 from building_tile b where b.world_id = p_world and b.x = tx and b.y = ty) then
    return 'Nothing flowers inside a building.';
  end if;
  v_season := season_at();
  if not exists (select 1 from flower_season s where s.season = v_season and s.drift is not null) then
    return 'Nothing is in flower in ' || v_season || ': wildflowers bloom in ' || flower_seasons_said() || '.';
  end if;
  -- Until the season a year begins with.
  if (land_data(p_world, tx, ty) & flowers_picked()::int) <> 0 then
    return 'The flowers here have been picked. Nothing flowers here again until spring.';
  end if;
  if flowers_on(p_world, tx, ty) = 0 then return 'There are no flowers here.'; end if;
  return null;
end $fn$;

/** A wildflower for each clump, and the tile picked until the next year begins. The browser's `pick_flowers`. */
create or replace function perform_flowers(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns void
  language plpgsql as $fn$
declare tx int := (p_target->>'x')::int; ty int := (p_target->>'y')::int; v_n int;
begin
  v_n := flowers_on(p_world, tx, ty);
  if v_n <= 0 then return; end if;
  perform gather(p_world, p_uid, 'wildflowers', v_n, product_ql(skill_of(p_world, p_uid, 'foraging')));
  perform land_set_data(p_world, tx, ty, land_data(p_world, tx, ty) | flowers_picked()::int);
  perform land_announce(p_world, tx, ty);
  perform skill_raise(p_world, p_uid, 'foraging', 1);
  perform tell(p_world, p_uid, 'You pick '
    || case when v_n = 1 then 'a wildflower' else number_word(v_n) || ' wildflowers' end
    || '. Nothing flowers here again until spring.', 'event');
end $fn$;

/**
 * What Examine says of the ground itself: the wear feet have put on it and
 * what is in flower on it. The browser's `groundSays`, the same sentence off
 * the same numbers.
 */
create or replace function ground_says(p_world uuid, p_x int, p_y int, p_at timestamptz default now()) returns text
  language plpgsql stable as $fn$
declare v_t int; v_d int; v_worn int; v_was text; v_n int; v_said text := '';
begin
  v_t := land_tile(p_world, p_x, p_y);
  v_d := land_data(p_world, p_x, p_y);
  v_worn := coalesce((select tw.wear from tile_wear tw
                       where tw.world_id = p_world and tw.x = p_x and tw.y = p_y), 0);
  if v_t = tile_id('Trail') then
    v_was := lower((select d.name from tile_def d where d.id = trail_ground(v_d)));
    v_said := ' Worn bare out of ' || v_was || ': ' || v_worn || ' of ' || wear_most()::int
      || ' wear. It loses ' || wear_fall()::int || ' at each turn of the woods and is '
      || v_was || ' again with none left.';
  elsif coalesce((select d.wears from tile_def d where d.id = v_t), false) and v_worn > 0 then
    v_said := ' Walked: ' || v_worn || ' of ' || wear_trail()::int || ' wear towards a trail.';
  end if;
  if v_t = tile_id('Grass')
     and exists (select 1 from flower_season s where s.season = season_at(p_at) and s.drift is not null)
     and building_at(p_world, p_x, p_y) is null then
    v_n := flowers_on(p_world, p_x, p_y, p_at);
    if v_n > 0 then
      v_said := v_said || ' In flower: ' || case when v_n = 1 then 'a clump' else number_word(v_n) || ' clumps' end
        || ' of wildflowers.';
    elsif (v_d & flowers_picked()::int) <> 0 then
      v_said := v_said || ' Its flowers have been picked: none until spring.';
    end if;
  end if;
  return v_said;
end $fn$;

/* ---- Where the rest of the island hears of them ---------------------------------------------------- */


-- Pick flowers answers for itself, beside the springs: its reach, its season and whether the tile is picked.
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

/* ---- The walk, and the day ---------------------------------------------------------------------- */

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

CREATE OR REPLACE FUNCTION public.tree_day(p_world uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare w record; v_y int; v_tiles bytea; v_data bytea; v_row record; v_stump int := tile_id('Stump'); v_grass int := tile_id('Grass'); v_lawn int := tile_id('Lawn');
        v_next int[]; v_kind int[]; v_first int := tree_first(); v_reach int := tree_seed_reach()::int;
        v_moved int := 0; i int; k int; v_a int; v_b int; v_n int;
        v_sx int[] := '{}'; v_sy int[] := '{}'; v_ss int[] := '{}';
        v_gx int[] := '{}'; v_gy int[] := '{}'; v_gs int[] := '{}';
        v_tx int[]; v_ty int[]; v_ts int[]; v_touched boolean := false;
        v_px int[]; v_py int[]; v_near boolean; v_told int[];
        v_h0 bytea; v_h1 bytea; v_d0 bytea; v_d1 bytea;
        v_band int := 16; v_w0 int; v_w1 int; v_ground bytea; v_plant boolean[]; v_deeds deed[]; v_pick record;
        v_c0 int; v_c1 int;
        -- Whether a new year has begun since the last turn, which is when
        -- every tile of picked flowers flowers again; and the bit that says so.
        v_new_year boolean; v_picked int := flowers_picked()::int;
begin
  select * into w from world where id = p_world;
  if not found or not w.ready then return 0; end if;
  v_new_year := w.trees_at is null or year_of(now()) <> year_of(w.trees_at);

  -- What each age becomes, read once rather than per tree. -1 is the end of it.
  select array_agg(coalesce(next, -1) order by id) into v_next from tree_age_def;
  -- And what kind of tree each data byte is, the same way.
  select array_agg(tree_species(b) order by b) into v_kind from generate_series(0, 255) b;
  -- And who is about, for the half of this that is only worth telling somebody
  -- who can see it happen.
  select array_agg(floor(p.x)::int), array_agg(floor(p.y)::int) into v_px, v_py
    from player p where p.world_id = p_world and not p.away
      and p.seen_at > now() - make_interval(secs => idle_logout());

  for v_y in 0 .. w.size - 1 loop
    /*
     * Read the line out, not the note that says where it is.
     *
     * Both columns are four thousand and ninety-six bytes wide and both
     * compress hard -- a wooded line is 621 bytes of tiles and 56 of data --
     * so what the row holds is the packed form, and `select into` copies the
     * datum it is handed, packed. `v_tiles` was never a line. It was a line
     * folded up.
     *
     * That is free until the fourth time round this loop. plpgsql plans a
     * statement afresh for its first few goes, and a fresh plan folds the
     * parameter in as a constant, which is unpacked once. On the fifth go it
     * keeps the plan, and a kept plan takes the value as a parameter instead
     * -- so every `get_byte` below unpacks the whole four kilobytes again to
     * read one byte of it. The statement under this reads three bytes a tile
     * as written, but the subqueries flatten and the cases repeat them, so it
     * is nearer a dozen: fifty thousand unpackings of a folded line, per line.
     *
     *     line 1-3, plan made fresh      1.8 ms
     *     line 4 onward, plan kept      89.0 ms     <-- the cliff
     *
     * Appending nothing unpacks it here instead, once, and hands `select into`
     * a line rather than a folded line. The kept plan then costs what the
     * fresh one did, and goes on costing it:
     *
     *     line 4 onward, unpacked here   1.8 ms
     *
     * Which is a day in the woods on an island four thousand tiles square
     * going from **five minutes fifty-seven** to **eight seconds**, for the
     * same 1,677,610 trees and the same bytes in every line of the island.
     */
    select t.tiles || ''::bytea, t.data || ''::bytea into v_tiles, v_data
      from land_tile t where t.world_id = p_world and t.y = v_y;
    if not found then continue; end if;
    -- A line with nothing on it that the day moves is thrown out unread: no
    -- tree, no stump, and no grass with a count in it. The last is asked of
    -- the data bytes, which a rock or a tree can also put in the range, so it
    -- errs towards reading a line, never towards skipping one.
    -- A picked tile of grass is eight and up: read on a day that moves its
    -- count, which is nine and up, and on the day a new year clears it.
    if position('\x10'::bytea in v_tiles) = 0 and position(set_byte('\x00'::bytea, 0, v_stump) in v_tiles) = 0
       and not any_byte_between(v_data, 1, 7)
       and not any_byte_between(v_data, case when v_new_year then 8 else 9 end, 15) then continue; end if;

    /*
     * The whole line in one statement: the new faces, the new ages, how many
     * trees were in it, which of them went, and which columns moved at all.
     *
     * Built rather than edited — `set_byte` on a variable copies the line every
     * time, so a thousand trees in a row would be four megabytes of copying to
     * change a thousand bytes — and one pass rather than three, because reading
     * four thousand bytes is the cost and doing it once is the saving.
     *
     * `dead` is the trees that went, which seed. `faced` is every tile that is
     * something else after the day: those, the stumps, and grass become lawn.
     * `stirred` is all of that and every tree in the line that moved: a new
     * age byte, or gone. A stage whose next is itself is not stirred, and is
     * not told of. They are wanted separately, because they are not worth the
     * same.
     */
    select
      -- A tree that dies of age leaves grass: a stump is what a hatchet leaves,
      -- and every stump there is, however long it has stood, is grass after
      -- the turn.
      -- And grass kept cut on a deed: the day moves the cut-today flag into
      -- the count, the third day makes lawn, and a day with no cut starts
      -- the count over.
      string_agg(set_byte('\x00'::bytea, 0, case
        when g.t = 16 and g.n < 0 then v_grass
        when g.t = v_stump then 0
        when g.t = v_grass and (g.d & 4) <> 0 and (g.d & 3) + 1 >= 3 then v_lawn
        else g.t end), ''::bytea order by g.gi) as tiles,
      -- And flowers picked this year stay picked beside the count, until a
      -- new year begins (`FLOWERS_PICKED`).
      string_agg(set_byte('\x00'::bytea, 0, case
        when g.t = v_stump then 0
        when g.t = v_grass and (g.d & 4) <> 0 then case when (g.d & 3) + 1 >= 3 then 0
          else ((g.d & 3) + 1) | case when v_new_year then 0 else g.d & v_picked end end
        when g.t = v_grass then case when v_new_year then 0 else g.d & v_picked end
        when g.t <> 16 then g.d
        when g.n < 0 then 0
        -- The species bits, low nibble and top bit, kept; the age between them moved on.
        else (g.d & 143) | (g.n << 4) end), ''::bytea order by g.gi) as data,
      count(*) filter (where g.t = 16) as here,
      array_agg(g.gi) filter (where (g.t = 16 and (g.n < 0 or g.n <> g.a)) or g.t = v_stump
                                 or (g.t = v_grass and ((g.d & 7) <> 0 or (v_new_year and (g.d & v_picked) <> 0)))) as stirred,
      -- Every tile that is something else after the day: a tree gone, a stump
      -- gone, grass become lawn. Told to everybody, near or not.
      -- A tile of picked flowers flowering again is one of these: a browser
      -- that saw it picked would draw it bare until it next read the land.
      array_agg(g.gi) filter (where (g.t = 16 and g.n < 0) or g.t = v_stump
                                 or (g.t = v_grass and (g.d & 4) <> 0 and (g.d & 3) + 1 >= 3)
                                 or (g.t = v_grass and v_new_year and (g.d & v_picked) <> 0)) as faced,
      array_agg(g.gi) filter (where g.t = 16 and g.n < 0) as dead
      into v_row
      -- `i` is a local here as well as a column, and inside a query the column
      -- wins. The eighth time this class has bitten the island.
      --
      -- `n` is what the age becomes: the next stage, -1 for the end of it, or
      -- the same age again for one with nothing written down — a stage that
      -- stays as it is, or a byte nobody has a row for. A null here would
      -- drop the byte out of the line and shorten it.
      from (select q.gi, q.t, q.d, q.a, coalesce(v_next[q.a + 1], q.a) as n
              from (select gi, get_byte(v_tiles, gi) as t, get_byte(v_data, gi) as d,
                           tree_age(get_byte(v_data, gi)) as a
                      from generate_series(0, w.size - 1) gi) q) g;
    if v_row.here = 0 and v_row.stirred is null then continue; end if;
    v_moved := v_moved + v_row.here;
    v_touched := true;

    update land_tile t set tiles = v_row.tiles, data = v_row.data
      where t.world_id = p_world and t.y = v_y;

    /*
     * And the line's changes into the record, in one statement.
     *
     * This is `land_announce` for a whole line at once. That function reads
     * thirteen tiles to describe one — the face, the data and eight corner
     * lookups apiece for height and soil — and a line of a thousand trees is
     * thirteen thousand single-row reads. The corners of every tile in a line
     * live in exactly two rows of `land_corner`, and those two are read out
     * once, unpacked, for the same reason the line is: a row of heights is
     * eight kilobytes stored as five, and a byte read out of it where it lies
     * unpacks all eight.
     *
     * What changed face goes in whatever else is true, because a tile that has
     * stopped being a tree, or a stump, has stopped being one for everybody.
     */
    v_near := false;
    if v_px is not null then
      for k in 1 .. array_length(v_px, 1) loop
        if abs(v_py[k] - v_y) <= tree_tell_reach() then v_near := true; exit; end if;
      end loop;
    end if;
    v_told := case when v_near then v_row.stirred else v_row.faced end;
    if v_told is not null then
      select c.heights || ''::bytea, c.dirt || ''::bytea into v_h0, v_d0
        from land_corner c where c.world_id = p_world and c.y = v_y;
      select c.heights || ''::bytea, c.dirt || ''::bytea into v_h1, v_d1
        from land_corner c where c.world_id = p_world and c.y = v_y + 1;
      if found and v_h0 is not null then
        insert into tile_change (world_id, x, y, region, tile, data, corners, soil)
        select p_world, u.gi, v_y, region_of(u.gi, v_y),
               get_byte(v_row.tiles, u.gi), get_byte(v_row.data, u.gi),
               array[b_i16(v_h0, u.gi), b_i16(v_h0, u.gi + 1),
                     b_i16(v_h1, u.gi + 1), b_i16(v_h1, u.gi)],
               array[get_byte(v_d0, u.gi), get_byte(v_d0, u.gi + 1),
                     get_byte(v_d1, u.gi + 1), get_byte(v_d1, u.gi)]
          from unnest(v_told) as u(gi);
      end if;
    end if;

    -- What the ones that went leave behind them is gathered up, not planted
    -- here: seeds land in the lines either side of this one, and a line is
    -- written once.
    if v_row.dead is not null then
      foreach i in array v_row.dead loop
        v_sx := v_sx || i;
        v_sy := v_sy || v_y;
        v_ss := v_ss || v_kind[get_byte(v_data, i) + 1];
      end loop;
    end if;
  end loop;

  -- A year's growth closes whatever was cut into anything.
  delete from tree_notch where world_id = p_world;

  /*
   * And now the saplings, sixteen lines of the dead at a time.
   *
   * Every tree that died asks the twenty-four tiles round it whether a seed can
   * take there, and the ground it asks is the ground after the day -- except
   * where one of the dead stood. That ground took the day to clear, as it did
   * when a stump stood on it for the day, so a wood that dies together comes
   * back as thickly as it always did rather than in its own footprint. That was one
   * statement over every stump on the island, joined to the land a tile at a
   * time -- and a byte read out of a line where it lies unpacks the whole
   * line, eight and a half million times on a die-off. So the lines a band of
   * stumps can reach are read out once, unpacked, end to end, and every
   * candidate is one byte of that.
   *
   * What is drawn is what always was: one roll per stump, the spots it could
   * take in a random order, as many as the roll and the room allow -- and
   * where two stumps pick the same spot, one of them has it. A stump that
   * rolled nothing is dropped before its neighbours are asked, because the
   * answer cannot change what it takes.
   */
  select array_agg(exists (select 1 from plantable p where p.tile = b) order by b) into v_plant
    from generate_series(0, 255) b;
  select array_agg(d) into v_deeds from deed d where d.world_id = p_world;
  v_n := coalesce(array_length(v_sx, 1), 0);
  v_a := 1;
  while v_a <= v_n loop
    v_b := v_a;
    while v_b < v_n and v_sy[v_b + 1] < v_sy[v_a] + v_band loop v_b := v_b + 1; end loop;
    v_w0 := greatest(0, v_sy[v_a] - v_reach);
    v_w1 := least(w.size - 1, v_sy[v_b] + v_reach);
    select string_agg(t.tiles, ''::bytea order by t.y) into v_ground
      from land_tile t where t.world_id = p_world and t.y between v_w0 and v_w1;
    -- The dead in the lines the band reads, which are in order of their line:
    -- the band's own and those either side of it within a seed's reach.
    v_c0 := v_a;
    while v_c0 > 1 and v_sy[v_c0 - 1] >= v_w0 loop v_c0 := v_c0 - 1; end loop;
    v_c1 := v_b;
    while v_c1 < v_n and v_sy[v_c1 + 1] <= v_w1 loop v_c1 := v_c1 + 1; end loop;

    for v_pick in
      with dead as (
        -- One roll per tree, not per spot it might take: `random()` in the
        -- candidate list would give a different answer for every neighbour.
        select d.x, d.y, d.sp, random() as roll
          from unnest(v_sx[v_a:v_b], v_sy[v_a:v_b], v_ss[v_a:v_b]) as d(x, y, sp)
      ), cand as (
        select d.x, d.y, d.sp, d.roll, d.x + q.dx as gx, d.y + q.dy as gy
        from dead d cross join (
          select dx, dy from generate_series(-v_reach, v_reach) dx,
                             generate_series(-v_reach, v_reach) dy
          where not (dx = 0 and dy = 0)) q
        where d.roll >= tree_seed_none()
          and d.x + q.dx between 0 and w.size - 1 and d.y + q.dy between 0 and w.size - 1
      ), cleared as (
        select k.x, k.y from unnest(v_sx[v_c0:v_c1], v_sy[v_c0:v_c1]) as k(x, y)
      ), free as (
        select c.gx, c.gy, c.sp, c.roll,
               row_number() over (partition by c.x, c.y order by random()) as rn,
               count(*) over (partition by c.x, c.y) as room
        from cand c
        where v_plant[get_byte(v_ground, (c.gy - v_w0) * w.size + c.gx) + 1]
          and not exists (select 1 from cleared k where k.x = c.gx and k.y = c.gy)
          and (v_deeds is null or not exists (select 1 from unnest(v_deeds) d where deed_covers(d, c.gx, c.gy)))
      ), want as (
        /*
         * What it wants, and what the ground will have.
         *
         * The roll averages a shade over replacement; the room is what keeps a
         * thick wood from running away, because a tree with nothing open round
         * it leaves nothing. Neither alone settles anywhere — together they do.
         */
        select f.gx, f.gy, f.sp, f.rn, least(
          case when f.roll < tree_seed_none() then 0
               when f.roll < 1 - tree_seed_both() then 1 else tree_seeds()::int end,
          case when f.room >= tree_room_two() then tree_seeds()::int
               when f.room >= tree_room_one() then 1 else 0 end) as take
        from free f
      )
      select gx, gy, sp from want where rn <= take
    loop
      v_gx := v_gx || v_pick.gx;
      v_gy := v_gy || v_pick.gy;
      v_gs := v_gs || v_pick.sp;
    end loop;
    v_a := v_b + 1;
  end loop;

  -- Two trees that picked the same spot plant one between them.
  if array_length(v_gx, 1) > 0 then
    select array_agg(gx order by gy, gx), array_agg(gy order by gy, gx), array_agg(sp order by gy, gx)
      into v_tx, v_ty, v_ts
      from (select distinct on (gx, gy) gx, gy, sp
              from unnest(v_gx, v_gy, v_gs) as p(gx, gy, sp)
             order by gx, gy, random()) took;
  end if;

  /*
   * And planted, a line at a time: the line read out unpacked, a byte set for
   * each sapling in it, the line written back once.
   *
   * And each sapling into the record, which is the half that was once never
   * written at all. After the dead, deliberately: a tile can lose its stump
   * and gain a neighbour's sapling in the same day, and the reader lays
   * changes down in the order they were written. Grass first, then the
   * sapling on it.
   */
  v_n := coalesce(array_length(v_tx, 1), 0);
  v_a := 1;
  while v_a <= v_n loop
    v_y := v_ty[v_a];
    v_b := v_a;
    while v_b < v_n and v_ty[v_b + 1] = v_y loop v_b := v_b + 1; end loop;

    select t.tiles || ''::bytea, t.data || ''::bytea into v_tiles, v_data
      from land_tile t where t.world_id = p_world and t.y = v_y;
    for k in v_a .. v_b loop
      v_tiles := set_byte(v_tiles, v_tx[k], 16);
      v_data := set_byte(v_data, v_tx[k], tree_pack(v_ts[k], v_first));
    end loop;
    update land_tile t set tiles = v_tiles, data = v_data
      where t.world_id = p_world and t.y = v_y;

    select c.heights || ''::bytea, c.dirt || ''::bytea into v_h0, v_d0
      from land_corner c where c.world_id = p_world and c.y = v_y;
    select c.heights || ''::bytea, c.dirt || ''::bytea into v_h1, v_d1
      from land_corner c where c.world_id = p_world and c.y = v_y + 1;
    if found and v_h0 is not null then
      insert into tile_change (world_id, x, y, region, tile, data, corners, soil)
      select p_world, u.gx, v_y, region_of(u.gx, v_y),
             16, tree_pack(u.sp, v_first),
             array[b_i16(v_h0, u.gx), b_i16(v_h0, u.gx + 1),
                   b_i16(v_h1, u.gx + 1), b_i16(v_h1, u.gx)],
             array[get_byte(v_d0, u.gx), get_byte(v_d0, u.gx + 1),
                   get_byte(v_d1, u.gx + 1), get_byte(v_d1, u.gx)]
        from unnest(v_tx[v_a:v_b], v_ts[v_a:v_b]) as u(gx, sp);
    end if;
    v_touched := true;
    v_a := v_b + 1;
  end loop;

  /*
   * And the chunk cache, dropped for the island in one statement.
   *
   * `land_chunk_forget` takes a tile and deletes the chunk around it; calling
   * it per chunk per line is sixty-four deletes a line and thirty thousand for
   * a wooded island. A day in the woods changes ground everywhere, so the
   * answer is to forget all of it at once — a chunk is only a cache, and the
   * next read of one builds it again from the land.
   */
  /*
   * And the worn ground: the day's fall off every tile feet have worn, and a
   * trail with none left is the ground it was again (`trail_day`). After the
   * saplings, so a trail that goes back to grass today takes no seed until
   * tomorrow, as in a game of your own.
   */
  if trail_day(p_world) then v_touched := true; end if;

  if v_touched then delete from land_chunk where world_id = p_world; end if;
  update world set trees_at = now() where id = p_world;
  return v_moved;
end $function$;

-- And Examine: the mowing count is the low three bits of a grass byte now, and the ground says what feet and flowers have made of it.
CREATE OR REPLACE FUNCTION public.examine_tile_text(p_world uuid, p_x integer, p_y integer, p_uid uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_t int; v_data int; v_out text; v_extra text := ''; b building; v_id int; n int; v_age tree_age_def;
begin
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
    end if;
  end if;
  select count(*) into n from crate c where c.world_id = p_world
    and p_x between c.x and c.x + c.sx - 1 and p_y between c.y and c.y + c.sy - 1;
  if n = 1 then v_extra := v_extra || ' A crate stands here.';
  elsif n > 1 then v_extra := v_extra || ' ' || n || ' crates stand here.'; end if;
  return v_out || v_extra;
end $function$;

select private.lock_doors();
