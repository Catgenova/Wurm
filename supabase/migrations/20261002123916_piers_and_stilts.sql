/*
 * Piers and stilts.
 *
 * A building's footprint was flat packed dirt and nothing else, which ruled
 * out every hillside and every shore. Now a tile that slopes, or lies under
 * shallow water, may be taken into a building by standing its ground floor
 * on piers: the tile's ground floor is a level deck at the building's floor
 * height, carried down to the ground or to the bed of the sea or a pond on
 * posts braced across (a deck of timber) or on piers of the stone with small
 * arches between them (a deck of stone). The browser's rules are
 * `src/game/piers.ts`, `Game.planReason`, `Game.pierSite`, `Game.deckStep`
 * and the building actions; these are the same rules on the island, and
 * `supabase/test/piers.ts` holds the two to each other.
 *
 *   * The deck's height is kept on the building (`building.deck`), and which
 *     of its tiles stand on piers on the tiles (`building_tile.pier`). A
 *     building planned on a tile that has to stand on piers takes the tile's
 *     highest corner, raised to clear the water by `pier_clear()` where the
 *     water stands higher, or the level the player has taken where that is
 *     higher still; one that grows onto piers from level ground keeps that
 *     ground's height. Every tile taken in after that lies wholly under the
 *     deck (`pier_deck_for`, `pier_refusal`).
 *   * A pier spans `pier_drop()` at most, from the deck to the lowest corner
 *     of its tile, and stands in water `pier_water()` deep at most; only bare
 *     ground or what grows flat on it (`stone_bed`) takes one, with no water
 *     plant on it.
 *   * The deck is the tile's ground-floor floor, planned and built like any
 *     floor, and the piers go on its bill: a solid wall's bill of the deck's
 *     material for every `pier_wall_drop()` of drop, rounded up item by item
 *     (`pier_bill`, `deck_bill`).
 *   * A tile on piers is its deck: stood on at the deck's height once the
 *     floor on it is finished (`deck_surface`), and not at all before.
 *     `walk_share` holds a step on or off a deck to the climb a body takes
 *     between two tile centres, as the browser's `deckStep` does; nobody on a
 *     deck is in the water under it (`in_deep_water`), and a step on or off
 *     one teaches no climbing (`walk_climbs`). No hull, wheel or hoof goes
 *     onto a tile on piers (`walk_share`, `launch_spot`).
 *   * Nothing but a body on its own two feet goes onto a tile on piers, or
 *     under one: no creature, wild, at work or at heel (`creature_tile_ok`,
 *     `line_clear`, `creature_settle`, `companion_settle`); one standing on a
 *     tile as it is planned on piers is moved off it (`pier_shoo_all`), and one
 *     let out of a crate on a deck is put down off it (`crate_let_out`,
 *     `creature_off_piers`).
 *   * A tile is not taken onto piers with a bridge landing on it, anything
 *     standing on it, or anybody (`pier_site_refusal`).
 *   * Walls go on a tile on piers once its deck is built, and a staircase or
 *     a ladder up from one once its deck is planned; a deck carries what it is
 *     laid in, and the lightest deck under a building carries all of it
 *     (`deck_carries`, `deck_bears`); the deck comes up again only with
 *     nothing standing or lying on it, no bridge landing on it and nobody on
 *     it (`deck_refusal`); a crate stands on a finished deck however wet or
 *     steep the ground under it (`crate_refusal`).
 *   * A bridge lands on a finished deck as on a bank, at the deck's height
 *     (`surface_height`, `bridge_reason`), and on no deck that is not built.
 *   * The ground under a building cannot be dug, raised, flattened, mined,
 *     packed, tilled, paved or planted (`under_building`,
 *     `corner_under_building`), and a tile on piers is a tile of a building;
 *     nor does a worker's face come down at a corner of one (`worker_do`).
 *   * The ground read sends a building's deck and its tiles on piers, and
 *     nothing at all for one standing on its ground (`piers_json`); Examine
 *     says what stands on piers, and the water under it where it has risen
 *     close to the deck (`pier_says`).
 *
 * The shared functions changed here (`plan_reason`, `build_refusal`,
 * `perform_building`, `walk_share`, `walk_climbs`, `in_deep_water`,
 * `rpc_ground`, `examine_tile_text`, `launch_spot`, `crate_refusal`,
 * `act_refusal_rules`, `terrain_refusal`, `ground_refusal`, `farm_refusal`,
 * `worker_do`, `creature_tile_ok`, `line_clear`, `creature_settle`,
 * `companion_settle`, `crate_let_out`, `surface_height`, `bridge_reason`)
 * change only by the lines marked `-- Piers`, each a call to a function here
 * or to one the island had. Some close gaps the browser never had: a
 * spadeful at a corner of a building, a face cut back under one, and its
 * floor packed, tilled or paved with cobblestone were refused in the browser
 * and taken on the island -- the ground under a deck most of all.
 */

set local lock_timeout = '3s';

-- The height a building's ground floor stands at when any of it stands on piers; null for one standing on its ground.
alter table building add column if not exists deck int;
-- Whether a tile of a building stands on piers.
alter table building_tile add column if not exists pier boolean not null default false;
-- The tiles on piers, which most islands have none of: asked of a tile only where the island has any.
create index if not exists building_tile_piers on building_tile (world_id, x, y) where pier;
/*
 * Whether an island has ever had a tile on piers: set the first time one is
 * planned (`stand_on_piers`), and never cleared, since a stale yes costs one
 * probe of an empty index. It rides on the world's own row, which the move,
 * a creature's footing and a creature's line of walk read already -- so an
 * island with no piers pays nothing at all for them, and one with piers one
 * probe of `building_tile_piers` where it asks.
 */
alter table world add column if not exists piers boolean not null default false;
update world w set piers = true
 where not w.piers and exists (select 1 from building_tile bt where bt.world_id = w.id and bt.pier);

/* ---- The ground under a pier ------------------------------------------------------------------- */

/** What a tile offers a pier (`pierGround`): its highest and lowest corner, the water standing over it (null where it is dry), and what it is. */
create or replace function pier_ground(p_world uuid, p_x int, p_y int,
    out high int, out low int, out water int, out tile int)
  language sql stable as $$
  select max(h.v)::int, min(h.v)::int,
         case when has_water(p_world, p_x, p_y) then water_surface(p_world, p_x, p_y) end,
         land_tile(p_world, p_x, p_y)
  from tile_corners(p_x, p_y) c cross join lateral (select land_height(p_world, c.cx, c.cy) as v) h
$$;

/** Why a tile cannot stand on piers under a deck at `p_deck`, or null: `pierRefusal`, word for word and in its order. */
create or replace function pier_refusal(p_world uuid, p_x int, p_y int, p_deck int) returns text
  language plpgsql stable as $$
declare g record; v_plant text;
begin
  select * into g from pier_ground(p_world, p_x, p_y);
  if not exists (select 1 from stone_bed s where s.tile = g.tile) then
    return 'Piers go down on bare ground or what grows flat on it. Clear what stands or is laid here first.';
  end if;
  select water_plant_word(p.kind) into v_plant from water_plant p where p.world_id = p_world and p.x = p_x and p.y = p_y;
  if v_plant is not null then return 'A ' || v_plant || ' grows here. Pull it up first.'; end if;
  if g.high > p_deck then
    return 'The ground here rises to ' || g.high || ', over the deck at ' || p_deck
      || '. A deck is level: plan a building on piers from its highest tile.';
  end if;
  if g.water is not null and g.water - g.low > pier_water() then
    return 'The water here is ' || metres(g.water - g.low) || ' m deep. A pier stands in '
      || metres(pier_water()) || ' m of water at most.';
  end if;
  if g.water is not null and p_deck < g.water + pier_clear() then
    return 'The water here stands at ' || g.water || ' and the deck would be at ' || p_deck
      || '. A deck clears the water by ' || metres(pier_clear()) || ' m.';
  end if;
  if p_deck - g.low > pier_drop() then
    return 'The ground falls ' || metres(p_deck - g.low) || ' m under the deck. A pier spans '
      || metres(pier_drop()) || ' m at most.';
  end if;
  return null;
end $$;

/**
 * The floor of a building with no deck yet, at the first of its tiles east,
 * west, south and north of a tile -- the order `neighbour_building` looks in --
 * at its poured slab's top or its own ground (`floorNear`).
 */
create or replace function building_floor_near(p_world uuid, p_building int, p_x int, p_y int) returns int
  language sql stable as $$
  select coalesce((select f.top from foundation f where f.world_id = p_world and f.x = p_x + d.dx and f.y = p_y + d.dy
                     and bill_done(f.needed)),
                  land_height(p_world, p_x + d.dx, p_y + d.dy))
  from (values (1, 0, 0), (-1, 0, 1), (0, 1, 2), (0, -1, 3)) d(dx, dy, ord)
  where building_at(p_world, p_x + d.dx, p_y + d.dy) = p_building
  order by d.ord limit 1
$$;

/**
 * The deck a tile would stand on piers under as a tile of a building, or null
 * for level ground built on as it stands (`Game.pierSite`). `p_into` is the
 * building it would join, whose deck it takes -- or its floor beside the tile,
 * if it has no deck yet; without one it is a new plan, whose deck is the
 * tile's top, or the level the player has taken where that is higher.
 */
create or replace function pier_deck_for(p_world uuid, p_uid uuid, p_x int, p_y int, p_into int) returns int
  language plpgsql stable as $$
declare g record; v_floor int; v_top int; v_level int;
begin
  select * into g from pier_ground(p_world, p_x, p_y);
  if p_into is not null then
    select coalesce(b.deck, building_floor_near(p_world, b.id, p_x, p_y)) into v_floor
      from building b where b.world_id = p_world and b.id = p_into;
  end if;
  -- Level, dry ground at the floor -- at its own height, for a new plan -- is built on as it stands.
  if g.high = g.low and g.water is null and (v_floor is null or g.high = v_floor) then return null; end if;
  if v_floor is not null then return v_floor; end if;
  v_top := case when g.water is null then g.high else greatest(g.high, g.water + pier_clear()) end;
  select p.level_h into v_level from player p where p.world_id = p_world and p.uid = p_uid;
  return case when v_level is not null and v_level > v_top then v_level else v_top end;
end $$;

/**
 * Why a tile whose ground would take piers cannot be taken onto them yet, or
 * null (`Game.pierSiteRefusal`, in its words and order): a bridge landing on
 * it lands on its ground; anything standing on it -- a hull, a cart, a fire,
 * a crate -- would be shut under the deck; and a body standing on it would
 * stand on nothing until the deck is built. A creature on it is moved off
 * as it is planned (`pier_shoo_all`).
 */
create or replace function pier_site_refusal(p_world uuid, p_uid uuid, p_x int, p_y int) returns text
  language sql stable as $$
  select case
    when exists (select 1 from bridge br where br.world_id = p_world
                   and ((br.ax = p_x and br.ay = p_y) or (br.bx = p_x and br.by = p_y)))
      then 'A bridge lands on this tile. Take the bridge down first.'
    when exists (select 1 from placed q where q.world_id = p_world and q.x = p_x and q.y = p_y)
      or exists (select 1 from crate c where c.world_id = p_world and c.x = p_x and c.y = p_y)
      then 'Move what stands on the tile first.'
    when exists (select 1 from player p where p.world_id = p_world and p.uid = p_uid
                   and floor(p.x)::int = p_x and floor(p.y)::int = p_y)
      then 'Step off the tile first.'
    when exists (select 1 from player p where p.world_id = p_world and p.uid <> p_uid and p.level = 0
                   and floor(p.x)::int = p_x and floor(p.y)::int = p_y)
      then 'Somebody is standing on that tile.'
  end
$$;

/**
 * Why a tile cannot be taken into a building, or null: a new plan on it, or
 * into `p_into`, the building beside it (`Game.planReason`). Level, dry
 * ground is built on as it stands and has to be packed first; a poured slab
 * is the slab's business, and level with a deck the building already has;
 * any other ground stands on piers.
 */
create or replace function extend_reason(p_world uuid, p_uid uuid, p_x int, p_y int, p_into int) returns text
  language plpgsql stable as $$
declare v_slab foundation; v_deck int; b building; v_why text;
begin
  if not on_my_deed(p_world, p_uid, p_x, p_y) then return 'You may only build on your own deed.'; end if;
  if is_token(p_world, p_x, p_y) then return 'The settlement token stands here.'; end if;
  if building_at(p_world, p_x, p_y) is not null then return 'That tile is already part of a building.'; end if;
  select * into b from building where world_id = p_world and id = p_into;
  select * into v_slab from foundation f where f.world_id = p_world and f.x = p_x and f.y = p_y;
  if v_slab.world_id is not null then
    if land_tile(p_world, p_x, p_y) <> tile_id('Packed dirt') then return 'Buildings need flat packed dirt. Pack the tile first.'; end if;
    if not bill_done(v_slab.needed) then return 'The foundation here is only shuttered. Pour it first.'; end if;
    if v_slab.pool then return 'You cannot build in water.'; end if;
    if b.deck is not null and v_slab.top <> b.deck then
      return 'The slab here is poured to ' || v_slab.top || ' and the floor of ' || b.name || ' stands at ' || b.deck
        || '. A floor is level.';
    end if;
  else
    v_deck := pier_deck_for(p_world, p_uid, p_x, p_y, p_into);
    if v_deck is null then
      if land_tile(p_world, p_x, p_y) <> tile_id('Packed dirt') then return 'Buildings need flat packed dirt. Pack the tile first.'; end if;
    else
      v_why := coalesce(pier_refusal(p_world, p_x, p_y, v_deck), pier_site_refusal(p_world, p_uid, p_x, p_y));
      if v_why is not null then return v_why; end if;
    end if;
  end if;
  if exists (select 1 from item i where i.world_id = p_world and i.holder = 'ground' and i.gx = p_x and i.gy = p_y) then
    return 'Clear away the items lying there first.';
  end if;
  return null;
end $$;

/* ---- A tile on piers ---------------------------------------------------------------------------- */

/**
 * Whether a tile stands on piers: one probe of `building_tile_piers`, which
 * on an island with no piers is an empty index.
 */
create or replace function on_piers(p_world uuid, p_x int, p_y int) returns boolean
  language sql stable as $$
  select exists (select 1 from building_tile bt where bt.world_id = p_world and bt.x = p_x and bt.y = p_y and bt.pier)
$$;

/** The height of the finished deck over a tile on piers (`Game.pierDeckAt`), or null: off the piers, or a deck not built yet. */
create or replace function deck_surface(p_world uuid, p_x int, p_y int) returns int
  language sql stable as $$
  select b.deck from building_tile bt
    join building b on b.world_id = bt.world_id and b.id = bt.building
    join floor_tile f on f.world_id = bt.world_id and f.level = 0 and f.x = bt.x and f.y = bt.y
   where bt.world_id = p_world and bt.x = p_x and bt.y = p_y and bt.pier and bill_done(f.needed)
$$;

/** Both, for the move, in one read: whether a tile stands on piers, and its finished deck's height if it has one. */
create or replace function pier_footing(p_world uuid, p_x int, p_y int, out piers boolean, out deck int)
  language sql stable as $$
  select coalesce(bt.pier, false),
         case when bt.pier and f.world_id is not null and bill_done(f.needed) then b.deck end
  from (select 1) one
  left join building_tile bt on bt.world_id = p_world and bt.x = p_x and bt.y = p_y
  left join building b on b.world_id = p_world and b.id = bt.building
  left join floor_tile f on f.world_id = p_world and f.level = 0 and f.x = p_x and f.y = p_y
$$;

/** How far the deck over a tile on piers stands above its lowest corner (`Game.pierDropAt`): what its tallest post spans. Nought off the piers. */
create or replace function pier_drop_at(p_world uuid, p_x int, p_y int) returns int
  language sql stable as $$
  select coalesce((
    select b.deck - (select min(land_height(p_world, c.cx, c.cy)) from tile_corners(p_x, p_y) c)
      from building_tile bt join building b on b.world_id = bt.world_id and b.id = bt.building
     where bt.world_id = p_world and bt.x = p_x and bt.y = p_y and bt.pier and b.deck is not null), 0)::int
$$;

/**
 * What the piers under a tile take (`pierBill`): a solid wall's bill of the
 * deck's material for every `pier_wall_drop()` of drop, rounded up item by
 * item and never to nothing -- in whole numbers, as the browser works it.
 */
create or replace function pier_bill(p_material text, p_drop int) returns jsonb
  language sql stable as $$
  select coalesce(jsonb_object_agg(b.item, greatest(1, (b.n * p_drop + pier_wall_drop() - 1) / pier_wall_drop())), '{}'::jsonb)
  from build_material_bill b where b.material = p_material
$$;

/** Two bills as one, item by item (`billPlus`). */
create or replace function bill_plus(a jsonb, b jsonb) returns jsonb
  language sql immutable as $$
  select coalesce(jsonb_object_agg(k, coalesce((a->>k)::int, 0) + coalesce((b->>k)::int, 0)), '{}'::jsonb)
  from (select jsonb_object_keys(a) k union select jsonb_object_keys(b)) ks
$$;

/** A floor's bill as it is planned, and on the ground floor of a tile on piers the piers under its deck as well. */
create or replace function deck_bill(p_world uuid, p_x int, p_y int, p_level int, p_kind text, p_material text, p_bill jsonb)
  returns jsonb language sql stable as $$
  select case when p_level = 0 and p_kind = 'floor' and on_piers(p_world, p_x, p_y)
              then bill_plus(p_bill, pier_bill(p_material, pier_drop_at(p_world, p_x, p_y))) else p_bill end
$$;

/** What a floor is called as it is planned: the ground floor of a tile on piers is a deck on piers. */
create or replace function floor_kind_said(p_world uuid, p_x int, p_y int, p_level int, p_kind text) returns text
  language sql stable as $$
  select case when p_level = 0 and p_kind = 'floor' and on_piers(p_world, p_x, p_y) then 'deck on piers'
              else floor_kind_name(p_kind) end
$$;

/**
 * A tile just taken into a building, stood on piers where its ground is not
 * level with the floor (`Buildings.standOnPiers`): the building's deck set if
 * it had none, the tile marked, and what the player is told -- or null for
 * level ground and for a slab, which are built on as they stand. `p_new` is a
 * new plan, whose deck is the tile's own.
 */
create or replace function stand_on_piers(p_world uuid, p_uid uuid, p_building int, p_x int, p_y int, p_new boolean)
  returns text language plpgsql as $$
declare v_deck int; v_low int; b building;
begin
  if exists (select 1 from foundation f where f.world_id = p_world and f.x = p_x and f.y = p_y) then return null; end if;
  v_deck := pier_deck_for(p_world, p_uid, p_x, p_y, case when p_new then null else p_building end);
  if v_deck is null then return null; end if;
  update building set deck = coalesce(deck, v_deck) where world_id = p_world and id = p_building returning * into b;
  update building_tile set pier = true where world_id = p_world and x = p_x and y = p_y and building = p_building;
  update world set piers = true where id = p_world and not piers;
  -- Nothing walks under a deck: a creature standing there is moved off.
  perform pier_shoo_all(p_world, p_x, p_y);
  v_low := (pier_ground(p_world, p_x, p_y)).low;
  if p_new then
    return 'You plan ' || b.name || ' here on piers: its deck at ' || v_deck || ', ' || metres(v_deck - v_low)
      || ' m over the lowest ground under it. Plan the deck to build it and the piers under it, then plan walls on it.';
  end if;
  return 'You add the tile to ' || b.name || ' on piers: under its deck at ' || v_deck || ', ' || metres(v_deck - v_low)
    || ' m over the lowest ground under it.';
end $$;

/**
 * The nearest tile to (p_x, p_y) a creature may walk (`creature_tile_ok`), ring
 * by ring out to `pier_shoo()` tiles, each ring from its north-west corner a
 * row at a time (`Creatures.nearestOk`); no row where there is none.
 */
create or replace function pier_shoo_to(p_world uuid, p_x int, p_y int, out x int, out y int)
  language sql stable as $$
  select r.x, r.y from (
    select p_x + dx as x, p_y + dy as y, greatest(abs(dx), abs(dy)) as ring
      from generate_series(-pier_shoo(), pier_shoo()) dy cross join generate_series(-pier_shoo(), pier_shoo()) dx
     where greatest(abs(dx), abs(dy)) >= 1) r
   where creature_tile_ok(p_world, r.x, r.y)
   order by r.ring, r.y, r.x limit 1
$$;

/**
 * Every creature standing on a tile just planned on piers -- or walking to
 * it -- moved off it (`Creatures.shoo`): to the middle of the nearest tile it
 * may walk (`pier_shoo_to`), and left where it is if there is none. One in a
 * crate is where its crate is, and one in the traces where its cart is.
 */
create or replace function pier_shoo_all(p_world uuid, p_x int, p_y int) returns void
  language plpgsql as $$
declare c creature; v_to record;
begin
  for c in select * from creature cr where cr.world_id = p_world and cr.mode <> 'stored' and cr.hitched_to is null
      and ((floor(creature_x(cr))::int = p_x and floor(creature_y(cr))::int = p_y)
        or (floor(cr.to_x)::int = p_x and floor(cr.to_y)::int = p_y)) loop
    select * into v_to from pier_shoo_to(p_world, p_x, p_y);
    if v_to.x is null then continue; end if;
    update creature set from_x = v_to.x + 0.5, from_y = v_to.y + 0.5, to_x = v_to.x + 0.5, to_y = v_to.y + 0.5,
        leg_at = now(), leg_ends = now()
      where world_id = p_world and id = c.id;
  end loop;
end $$;

/**
 * A creature put down on a tile on piers -- let out of a crate standing on a
 * deck, or at the feet of somebody standing on one -- moved off it as
 * `pier_shoo_all` moves one (`Creatures.offPiers`).
 */
create or replace function creature_off_piers(p_world uuid, p_id int) returns void
  language plpgsql as $$
declare c creature; v_x int; v_y int; v_to record;
begin
  select * into c from creature where world_id = p_world and id = p_id;
  if c.id is null then return; end if;
  v_x := floor(creature_x(c))::int; v_y := floor(creature_y(c))::int;
  if not on_piers(p_world, v_x, v_y) then return; end if;
  select * into v_to from pier_shoo_to(p_world, v_x, v_y);
  if v_to.x is null then return; end if;
  update creature set from_x = v_to.x + 0.5, from_y = v_to.y + 0.5, to_x = v_to.x + 0.5, to_y = v_to.y + 0.5,
      leg_at = now(), leg_ends = now()
    where world_id = p_world and id = p_id;
end $$;

/**
 * Why the deck of a tile on piers cannot come up yet, or null: what stands or
 * lies on it, a bridge landing on it, whoever takes it up standing on it, and
 * anybody else standing on it -- none of whom would be left standing on
 * anything.
 */
create or replace function deck_refusal(p_world uuid, p_uid uuid, p_level int, p_x int, p_y int) returns text
  language sql stable as $$
  select case
    when p_level <> 0 or not on_piers(p_world, p_x, p_y) then null
    when exists (select 1 from placed q where q.world_id = p_world and q.x = p_x and q.y = p_y)
      or exists (select 1 from crate c where c.world_id = p_world and c.x = p_x and c.y = p_y)
      or exists (select 1 from item i where i.world_id = p_world and i.holder = 'ground' and i.gx = p_x and i.gy = p_y)
      then 'Clear what stands or lies on the deck first.'
    when exists (select 1 from bridge br where br.world_id = p_world
                   and ((br.ax = p_x and br.ay = p_y) or (br.bx = p_x and br.by = p_y)))
      then 'A bridge lands on the deck. Take the bridge down first.'
    when exists (select 1 from player p where p.world_id = p_world and p.uid = p_uid and p.level = 0
                   and floor(p.x)::int = p_x and floor(p.y)::int = p_y)
      then 'Step off the deck first.'
    when exists (select 1 from player p where p.world_id = p_world and p.uid <> p_uid and p.level = 0
                   and floor(p.x)::int = p_x and floor(p.y)::int = p_y)
      then 'Somebody is standing on the deck.'
  end
$$;

/** What Examine says of a tile on piers (`pierSays`): its deck, the drop under it, and whether the deck is built. */
create or replace function pier_says(p_world uuid, p_x int, p_y int) returns text
  language sql stable as $$
  select coalesce((
    select ' It stands on piers under a deck at ' || b.deck || ', ' || metres(pier_drop_at(p_world, p_x, p_y))
        || ' m over the lowest ground under it.'
        || case when deck_surface(p_world, p_x, p_y) is null
                then ' The deck is not built: nothing stands on the tile until it is.' else '' end
        -- And the water under it, where it has risen to within `pier_clear()` of the deck since it was planned.
        || case when g.water is not null and g.water + pier_clear() > b.deck
                then ' The water under it has risen to ' || g.water || ', '
                  || case when g.water < b.deck then metres(b.deck - g.water) || ' m under the deck' else 'over the deck' end || '.'
                else '' end
      from building_tile bt join building b on b.world_id = bt.world_id and b.id = bt.building
      cross join pier_ground(p_world, p_x, p_y) g
     where bt.world_id = p_world and bt.x = p_x and bt.y = p_y and bt.pier and b.deck is not null), '')
$$;

/** A building's deck and its tiles on piers, for the ground read, and nothing at all for one standing on its ground. */
create or replace function piers_json(p_world uuid, p_building int, p_deck int) returns jsonb
  language sql stable as $$
  select case when p_deck is null then '{}'::jsonb else jsonb_build_object('deck', p_deck,
    'piers', (select coalesce(jsonb_agg(bt.x || ',' || bt.y order by bt.y, bt.x), '[]'::jsonb)
                from building_tile bt where bt.world_id = p_world and bt.building = p_building and bt.pier)) end
$$;

/* ---- What a deck carries ------------------------------------------------------------------------- */

/**
 * Why a wall of a material cannot stand in a building on piers, or null
 * (`deckCarries`): a deck carries what it is laid in (`heft`), and the
 * lightest deck planned under the building -- least heft first, then by id
 * -- carries the whole of it, as the lightest wall of a storey carries
 * everything over it (`bearing`).
 */
create or replace function deck_carries(p_world uuid, p_building int, p_material text) returns text
  language sql stable as $$
  select case when m.heft > d.heft
    then m.name || ' is too heavy for the ' || lower(d.name) || ' deck under ' || b.name
      || ': a deck on piers carries what it is laid in, ' || heft_word(d.heft) || ', no more.' end
  from build_material_def m
  join building b on b.world_id = p_world and b.id = p_building
  cross join lateral (
    select dm.heft, dm.name from building_tile bt
      join floor_tile f on f.world_id = bt.world_id and f.level = 0 and f.x = bt.x and f.y = bt.y and f.kind = 'floor'
      join build_material_def dm on dm.id = f.material
     where bt.world_id = p_world and bt.building = p_building and bt.pier
     order by dm.heft, dm.id limit 1) d
  where m.id = p_material
$$;

/** Why a deck cannot be laid in a material under a building whose heaviest wall is heavier than it, or null (`deckBears`). */
create or replace function deck_bears(p_world uuid, p_building int, p_material text) returns text
  language sql stable as $$
  select case when m.heft < w.over
    then m.name || ' will not carry the ' || heft_word(w.over) || ' standing on ' || b.name
      || ': a deck on piers carries what it is laid in.' end
  from build_material_def m
  join building b on b.world_id = p_world and b.id = p_building
  cross join (select coalesce(max(wm.heft), 0) as over from wall w2 join build_material_def wm on wm.id = w2.material
               where w2.world_id = p_world and w2.building = p_building) w
  where m.id = p_material
$$;

/* ---- The shared functions, each changed only by its lines marked `-- Piers` ----------------------- */


-- ---- A new plan is asked what any tile taken into a building is.

CREATE OR REPLACE FUNCTION public.plan_reason(p_world uuid, p_uid uuid, p_x integer, p_y integer)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  -- Piers: on level ground as it stands, and on piers anywhere else (`extend_reason`).
  select extend_reason(p_world, p_uid, p_x, p_y, null)
$function$;

-- ---- The doors of building: extending onto piers, walls and stairs on a deck, and taking a deck up.

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
    lvl := floor_level(p_world, b.id, kind);
    if kind = 'roof' then
      v_gap := level_gap(p_world, b.id, b.levels - 1, p_uid);
      if v_gap is not null then return v_gap; end if;
    elsif kind in ('stairs', 'ladder') then
      if lvl < 1 then return 'Stairs and ladders belong to an upper storey; plan another storey first.'; end if;
      if side is null then return 'Choose the side to climb from.'; end if;
      -- Piers: a flight or a ladder up from a tile on piers stands on its deck.
      if (lvl > 1 or on_piers(p_world, tx, ty)) and not exists (select 1 from floor_tile where world_id = p_world
          and level = lvl - 1 and x = tx and y = ty) then
        return 'Plan the floor of the storey below first.';
      end if;
    end if;
    if exists (select 1 from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty) then
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
    lvl := floor_level(p_world, b.id, kind);
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if p_action = 'remove_floor' then
      if not found then return 'There is nothing here to remove.'; end if;
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

-- ---- And what they do: a plan or a tile on piers, and the piers on a deck's bill.

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
    -- Piers: and the piers under a deck (`deck_bill`).
    bill := deck_bill(p_world, tx, ty, lvl, kind, mat.id, bill);
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
    lvl := floor_level(p_world, b.id, kind);
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

-- ---- The move: a step on, off or along a deck, and nothing under one.

/**
 * A step between two tiles where a tile on piers is one of them, for the
 * move (`Game.deckStep`): null when neither is, false when it is refused.
 * Nothing goes onto a tile on piers whose deck is not built, and nothing
 * carried -- a hull, a cart, a saddle -- onto one at all; on, off or along a
 * deck the two surfaces are held to the climb, and stepping off one the
 * ground has to be one a body stands on.
 */
create or replace function pier_step(p_world uuid, p_fx int, p_fy int, p_tx int, p_ty int,
    p_climb double precision, p_stand double precision, p_tile int, p_carried boolean) returns boolean
  language plpgsql stable as $$
declare v_to record; v_from record;
begin
  -- One probe of the tiles on piers for both tiles, which is all a step clear of every deck pays.
  if not exists (select 1 from building_tile bt where bt.world_id = p_world and bt.pier
                   and ((bt.x = p_tx and bt.y = p_ty) or (bt.x = p_fx and bt.y = p_fy))) then
    return null;
  end if;
  select * into v_to from pier_footing(p_world, p_tx, p_ty);
  if v_to.piers and (v_to.deck is null or p_carried) then return false; end if;
  select * into v_from from pier_footing(p_world, p_fx, p_fy);
  if v_to.deck is null and v_from.deck is null then return null; end if;
  if abs(coalesce(v_to.deck, surface_height(p_world, p_tx, p_ty))
         - coalesce(v_from.deck, surface_height(p_world, p_fx, p_fy))) > p_climb then
    return false;
  end if;
  return v_to.deck is not null or tile_slope(p_world, p_tx, p_ty) <= stand_cap(p_tile, p_stand);
end $$;

CREATE OR REPLACE FUNCTION public.walk_share(p_world uuid, p_uid uuid, p_level integer, p_x0 double precision, p_y0 double precision, p_x1 double precision, p_y1 double precision)
 RETURNS double precision
 LANGUAGE plpgsql
AS $function$
declare far double precision; n int; i int; t double precision;
        cart placed; climbing double precision;
        fx int; fy int; tx int; ty int; climb double precision;
        size int; step int := chunk_size()::int;
        k land_chunk; kx int := -999; ky int := -999;
        here double precision; there double precision; spans boolean; walls int[];
        stand double precision; afloat boolean; beast creature;
        there_tile int; here_tile int;
        v_piers boolean; v_step boolean;  -- Piers
begin
  if p_level <> 0 then return 1; end if;
  far := sqrt(power(p_x1 - p_x0, 2) + power(p_y1 - p_y0, 2));
  if far <= 0.0001 then return 1; end if;
  -- Piers: and whether it has ever had a tile on piers (`world.piers`), off the same row.
  select w.size, w.piers into size, v_piers from world w where w.id = p_world;
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
  -- Asked once. `driving`, `mount_of` and `skill_of` are all STABLE and this
  -- function writes nothing, so the second ask could only ever return what the
  -- first did -- at the price of another index probe apiece, on the one call a
  -- walking browser makes constantly.
  climbing := skill_of(p_world, p_uid, 'climbing');
  climb := max_step() + climbing * climb_per_level();
  /*
   * The steepest tile a body can stand on, before the step between tiles is
   * asked about at all: sixty between a tile's highest corner and its lowest,
   * and climbing raises it at the rate it raises the step. A rider has the
   * mount's legs under them, so the cap is the mount's, raised the way its
   * step is; wheels get the bare sixty; and a hull floats over whatever the
   * bottom does, so afloat there is no cap. A deck is ground: a bridge over a
   * steep tile is not the tile.
   */
  cart := driving(p_world, p_uid);
  afloat := coalesce(is_boat(cart), false);
  beast := mount_of(p_world, p_uid);
  if beast.id is not null then stand := max_stand() + mount_step(beast) - max_step();
  elsif cart.id is not null then stand := max_stand();
  else stand := max_stand() + climbing * climb_per_level();
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
        there_tile := land_tile(p_world, tx, ty);
      else
        there_tile := get_byte(k.tiles, (ty - ky * step) * step + (tx - kx * step));
        if there_tile = any (walls) then return (i - 1)::double precision / n; end if;
      end if;
      -- A flight of garden steps is climbed, not driven: no wheel takes one.
      if cart.id is not null and not afloat and there_tile = steps_tile() then
        return (i - 1)::double precision / n;
      end if;
      -- And what the tile being left is, the first time it is asked: a flight
      -- carries you on or off it without the step between centres.
      if here_tile is null then
        here_tile := case when fx / step = kx and fy / step = ky and k.tiles is not null
                               and length(k.tiles) > (fy - ky * step) * step + (fx - kx * step)
                          then get_byte(k.tiles, (fy - ky * step) * step + (fx - kx * step))
                          else land_tile(p_world, fx, fy) end;
      end if;
      -- Piers: a tile on piers is its deck, walked at the deck's height; nothing goes under one (`pier_step`).
      -- A bridge is walked as it always was, and lands on a deck as on a bank.
      if v_piers and (not spans or (bridge_at(p_world, tx, ty) is null and bridge_at(p_world, fx, fy) is null)) then
        v_step := pier_step(p_world, fx, fy, tx, ty, climb, stand, there_tile, afloat or cart.id is not null or beast.id is not null);
        if v_step is not null then
          if not v_step then return (i - 1)::double precision / n; end if;
          fx := tx; fy := ty; here_tile := there_tile;
          continue;
        end if;
      end if;
      if not afloat and (not spans or bridge_at(p_world, tx, ty) is null) then
        if k.heights is not null and length(k.heights) >= (step + 1) * (step + 1) * 2 then
          if chunk_slope(k, kx, ky, tx, ty, step) > stand_cap(there_tile, stand) then return (i - 1)::double precision / n; end if;
        elsif tile_slope(p_world, tx, ty) > stand_cap(there_tile, stand) then
          return (i - 1)::double precision / n;
        end if;
      end if;
      if there_tile = steps_tile() or here_tile = steps_tile() then
        null;
      elsif abs(tx - fx) <= 1 and abs(ty - fy) <= 1
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
      fx := tx; fy := ty; here_tile := there_tile;
    end if;
  end loop;
  return 1;
end $function$;

-- ---- And a step on or off a deck teaches no climbing.

CREATE OR REPLACE FUNCTION public.walk_climbs(p_world uuid, p_x0 double precision, p_y0 double precision, p_x1 double precision, p_y1 double precision)
 RETURNS double precision[]
 LANGUAGE plpgsql
 STABLE
AS $function$
declare far double precision; n int; i int; t double precision;
        fx int; fy int; tx int; ty int; spans boolean;
        v_piers boolean;  -- Piers
        steps double precision[] := '{}';
begin
  far := sqrt(power(p_x1 - p_x0, 2) + power(p_y1 - p_y0, 2));
  if far <= 0.0001 then return steps; end if;
  spans := exists (select 1 from bridge b where b.world_id = p_world);
  fx := floor(p_x0)::int; fy := floor(p_y0)::int;
  n := least(walk_samples()::int, greatest(1, ceil(far * 2)::int));
  for i in 1..n loop
    t := i::double precision / n;
    tx := floor(p_x0 + (p_x1 - p_x0) * t)::int;
    ty := floor(p_y0 + (p_y1 - p_y0) * t)::int;
    if tx <> fx or ty <> fy then
      -- And a step on or off a flight of garden steps is no climb.
      if abs(tx - fx) <= 1 and abs(ty - fy) <= 1
         and (not spans or bridge_at(p_world, tx, ty) is null)
         and land_tile(p_world, tx, ty) <> steps_tile() and land_tile(p_world, fx, fy) <> steps_tile() then
        -- Piers: nor one on or off a deck, which a tile on piers is wherever it is walked. Whether the island
        -- has ever had a tile on piers is read once, at the first climb (`world.piers`); only then is a tile asked.
        if v_piers is null then select w.piers into v_piers from world w where w.id = p_world; end if;  -- Piers
        if not coalesce(v_piers, false) then  -- Piers
          steps := steps || abs(centre_height(p_world, tx, ty) - centre_height(p_world, fx, fy));
        elsif not exists (select 1 from building_tile bt where bt.world_id = p_world and bt.pier  -- Piers
                          and ((bt.x = tx and bt.y = ty) or (bt.x = fx and bt.y = fy))) then
          steps := steps || abs(centre_height(p_world, tx, ty) - centre_height(p_world, fx, fy));
        end if;  -- Piers
      end if;
      fx := tx; fy := ty;
    end if;
  end loop;
  return steps;
end $function$;

-- ---- Nobody on a deck is in the water under it.

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
    -- Piers: on the finished deck of a tile on piers, whatever is under it (`deck_surface`).
    when deck_surface(p_world, floor(p.x)::int, floor(p.y)::int) is not null then false
    else bridge_at(p_world, floor(p.x)::int, floor(p.y)::int) is null
  end
  from player p where p.world_id = p_world and p.uid = p_uid
$function$;

-- ---- No hull goes in under a deck.

CREATE OR REPLACE FUNCTION public.launch_spot(p_world uuid, p_kind text, p_x integer, p_y integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select in_bounds(p_world, p_x, p_y)
     and -centre_height(p_world, p_x, p_y) >= (select draught from boat_def where id = p_kind)
     -- Piers: no hull goes in under a deck.
     and not on_piers(p_world, p_x, p_y)
$function$;

-- ---- A crate stands on a finished deck, whatever is under it.

CREATE OR REPLACE FUNCTION public.crate_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare v_p player; v_it item; v_c crate; v_pl placed;
        v_tx int; v_ty int; v_sx int; v_sy int; v_want int;
begin
  select * into v_p from player where world_id = p_world and uid = p_uid;

  if p_action = 'place_crate' then
    v_tx := (p_target->>'x')::int; v_ty := (p_target->>'y')::int;
    v_sx := (p_target->>'sx')::int; v_sy := (p_target->>'sy')::int;
    if v_tx is null or v_sx is null or v_sy is null or target_item(p_target) is null then
      return 'Choose a crate and a spot.';
    end if;
    select * into v_it from item where id = target_item(p_target)
      and world_id = p_world and holder = 'player' and holder_uid = p_uid;
    if not found or crate_kind_of_item(v_it.def) is null then return 'That is not a crate.'; end if;
    /*
     * A rack's deck is a crate spot, and the ground under it is the rack's
     * business rather than the crate's: whoever set the rack there already
     * answered for the footing. So the ground rules are asked on bare earth
     * and skipped on a deck, which is the only difference between the two — a
     * crate on a rack is an ordinary crate at an ordinary subtile, with its own
     * contents, its own name and its own deed flag.
     */
    if (rack_at(p_world, v_tx, v_ty, v_sx, v_sy)).id is null then
      -- Piers: a finished deck is dry, level floor whatever is under it, and one not built yet nothing to stand on.
      if on_piers(p_world, v_tx, v_ty) then
        if deck_surface(p_world, v_tx, v_ty) is null then return 'Crates need dry, open ground.'; end if;
      elsif not passable(p_world, v_tx, v_ty) or has_water(p_world, v_tx, v_ty) then
        return 'Crates need dry, open ground.';
      elsif tile_slope(p_world, v_tx, v_ty) > 20 then return 'The ground is too steep for a crate to stand.';
      end if;
    elsif crate_kind_of_item(v_it.def) <> 'plank' then
      return 'A ' || lower((select name from item_def where id = v_it.def))
        || ' will not sit on the runners. The rack takes plank crates.';
    end if;
    if (crate_at(p_world, v_tx, v_ty, v_sx, v_sy)).id is not null then return 'There is already a crate on that spot.'; end if;
    if is_token(p_world, v_tx, v_ty) then return 'Not on the token.'; end if;
    return null;

  elsif p_action in ('pick_up_crate', 'crate_take_all') then
    v_c := target_crate(p_world, p_target);
    if v_c.id is null then return 'It is gone.'; end if;
    if not crate_yours(p_world, p_uid, v_c.id) then
      return 'The ' || lower(crate_name(v_c)) || ' is not yours.';
    end if;
    if sqrt((crate_centre_x(v_c) - v_p.x) ^ 2 + (crate_centre_y(v_c) - v_p.y) ^ 2) > 2.4 then
      return 'Stand next to the crate.';
    end if;
    -- A crate with a padlock on it opens for its key and for the founder of
    -- the settlement it stands on, and for nobody else. Picking it up is
    -- shut the same way: a locked thing you could simply carry off is not
    -- locked at all.
    if lock_shut(p_world, p_uid, v_c.lock, v_c.x, v_c.y) then
      return lock_refusal(p_world, p_uid, v_c.lock, v_c.x, v_c.y);
    end if;
    if p_action = 'pick_up_crate' then
      return case when crate_units(p_world, v_c.id) > 0 then 'Empty it first.' end;
    end if;
    return case when crate_units(p_world, v_c.id) = 0 then 'The crate is empty.' end;

  elsif p_action = 'store_in_crate' then
    -- The crate the ask names, when it names one you can reach; the nearest
    -- when it names none, which is what an item's own menu means by it.
    v_c := named_crate(p_world, v_p.x, v_p.y, p_target);
    if v_c.id is null then v_c := nearest_crate(p_world, v_p.x, v_p.y); end if;
    if v_c.id is null then return 'Stand next to a crate.'; end if;
    -- Putting your things into somebody else's crate is a way of losing them.
    if not crate_yours(p_world, p_uid, v_c.id) then
      return 'The ' || lower(crate_name(v_c)) || ' is not yours to put anything in.';
    end if;
    if lock_shut(p_world, p_uid, v_c.lock, v_c.x, v_c.y) then
      return lock_refusal(p_world, p_uid, v_c.lock, v_c.x, v_c.y);
    end if;
    select * into v_it from item where id = target_item(p_target)
      and world_id = p_world and holder = 'player' and holder_uid = p_uid;
    if not found then return 'It is gone.'; end if;
    if crate_kind_of_item(v_it.def) is not null then return 'A crate does not go in a crate.'; end if;
    v_want := greatest(1, least(v_it.count, coalesce((p_target->>'count')::int, 1)));
    /*
     * Room for some of it is enough.
     *
     * Asked for: "when trying to put 48 items in a container that has room for
     * 13, deposit 13 and reject the 35." It was all or nothing, so an armful
     * of ore and a nearly full crate meant counting the difference yourself
     * and splitting the stack by hand. A thing that stacks goes in as far as
     * there is room; a thing that does not is one row and goes in whole or not
     * at all, which is what it always was.
     */
    if crate_spare(p_world, v_c)
       < (case when coalesce((select stackable from item_def where id = v_it.def), false)
               then 1 else v_want end) then
      return 'The ' || lower(crate_name(v_c)) || ' is full.';
    end if;
    return null;

  elsif p_action = 'take_from_store' then
    /*
     * Taking one thing out, which the island could not do until now.
     *
     * There has been a way to put a thing in and a way to take *everything*
     * out, and nothing in between — so the browser did the in-between itself,
     * moving the row from one window to the other in its own copy and never
     * telling anybody. On an island the next answer put it back, which is what
     * "it rubber bands from crate to inventory" was.
     */
    select * into v_it from item where id = target_item(p_target) and world_id = p_world;
    if not found or v_it.holder not in ('crate', 'furniture', 'bag') then return 'It is gone.'; end if;
    -- A bag is worn rather than stood next to, so there is nothing to walk to
    -- and the only question is whether it is on you.
    if v_it.holder = 'bag' then
      if (carried(p_world, p_uid, v_it.id)).id is null then return 'It is gone.'; end if;
      return null;
    end if;
    if v_it.holder = 'crate' then
      select * into v_c from crate where world_id = p_world and id = v_it.crate;
      if not found then return 'It is gone.'; end if;
      if sqrt((crate_centre_x(v_c) - v_p.x) ^ 2 + (crate_centre_y(v_c) - v_p.y) ^ 2) > 2.4 then
        return 'Stand next to the crate.';
      end if;
      if not crate_yours(p_world, p_uid, v_c.id) then
        return 'The ' || lower(crate_name(v_c)) || ' is not yours.';
      end if;
    else
      select * into v_pl from placed where id = v_it.placed and world_id = p_world;
      if not found then return 'It is gone.'; end if;
      if greatest(abs(v_pl.cx - v_p.x), abs(v_pl.cy - v_p.y)) > 2.4 then
        return 'Stand next to the ' || lower(placed_name(v_pl)) || '.';
      end if;
      if v_pl.kind = 'furniture' and coalesce((select stall from furniture_def where id = v_pl.sub), false)
         and v_pl.made_by is distinct from p_uid then
        return 'That is on somebody else''s stall. Buy it at the counter.';
      end if;
    end if;
    return null;
  end if;
  return null;
end $function$;

-- ---- The ground under a building is left alone: a spadeful at a corner of one, a chip off its rock, and packing, tilling or paving its tile.

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

-- ---- Nor is anything planted under a building: a sprout, a graft or moss.

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

CREATE OR REPLACE FUNCTION public.farm_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; here int; c crop; it item; v_r int; v_why text;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  here := land_tile(p_world, tx, ty);
  -- Anything that reads a crop reads it up to date.
  perform crop_settle(p_world, tx, ty);
  select * into c from crop cr where cr.world_id = p_world and cr.x = tx and cr.y = ty;

  if p_action = 'till' then
    -- In a building, only a glasshouse's ground, where no floor is planned on it (`glass_till_refusal`).
    if building_at(p_world, tx, ty) is not null then
      v_why := glass_till_refusal(p_world, tx, ty);
      if v_why is not null then return v_why; end if;
    elsif not tillable(here) then return not_tillable_said(); end if;
    if land_height(p_world, tx, ty) < 0 or land_height(p_world, tx + 1, ty) < 0
       or land_height(p_world, tx + 1, ty + 1) < 0 or land_height(p_world, tx, ty + 1) < 0 then
      return 'You cannot till underwater.';
    end if;
    if tile_slope(p_world, tx, ty) > 20 then return 'The ground is too steep to work.'; end if;
  elsif p_action = 'plant_moss' then
    -- In the browser's words and order (actions.ts, `plant_moss`).
    if here <> tile_id('Dirt') then return 'Moss is planted on a tile of dirt.'; end if;
    if has_water(p_world, tx, ty) then return 'You cannot plant moss underwater.'; end if;
    if pack_count(p_world, p_uid, 'moss') < moss_plant() then
      return 'It takes ' || moss_plant() || ' moss to plant a tile; you have ' || pack_count(p_world, p_uid, 'moss') || '.';
    end if;
    -- Piers: nor under a building, which a tile on piers is (`underBuilding`).
    if under_building(p_world, tx, ty) is not null then return under_building(p_world, tx, ty); end if;
  elsif p_action = 'plant_seed' then
    if here <> tile_id('Field') then return 'Sow on a tilled field.'; end if;
    if c.id is not null then return 'Something is already growing there.'; end if;
    select * into it from item
      where id = target_item(p_target) and world_id = p_world
        and holder = 'player' and holder_uid = p_uid;
    if not found or not exists (select 1 from crop_def where seed = it.def) then
      return 'Choose a seed to sow.';
    end if;
  elsif p_action = 'tend_crop' then
    if c.id is null then return 'Nothing is growing there.'; end if;
    if c.stage >= crop_ripe() then return 'It is ripe. Harvest it.'; end if;
    if c.tended_now then return 'You have already tended it at this stage. Wait for it to grow on.'; end if;
  elsif p_action = 'harvest_crop' then
    if c.id is null then return 'Nothing is growing there.'; end if;
    if c.stage < crop_ripe() then
      return 'It is only ' || crop_stage_name(c.stage) || '. Let it grow.';
    end if;
  elsif p_action = 'clear_field' then
    if here <> tile_id('Field') then return 'There is no field there.'; end if;
  elsif p_action = 'sow_patch' then
    if pk(p_world, p_uid, 'sow_patch', 0) <= 0 then return 'That wants a Farmer who has learned to sow a patch.'; end if;
    select * into it from item
      where id = target_item(p_target) and world_id = p_world
        and holder = 'player' and holder_uid = p_uid;
    if not found or not exists (select 1 from crop_def where seed = it.def) then
      return 'Choose a seed to sow.';
    end if;
    v_r := floor(pk(p_world, p_uid, 'sow_patch', 0))::int;
    if not exists (select 1 from generate_series(ty - v_r, ty + v_r) gy, generate_series(tx - v_r, tx + v_r) gx
                    where case when in_bounds(p_world, gx, gy) then land_tile(p_world, gx, gy) = tile_id('Field') else false end
                      and not exists (select 1 from crop cr where cr.world_id = p_world and cr.x = gx and cr.y = gy)) then
      return 'There is no empty field in the patch to sow.';
    end if;
  elsif p_action = 'tend_patch' then
    if pk(p_world, p_uid, 'tend_patch', 0) <= 0 then return 'That wants a Farmer who has learned to tend a patch.'; end if;
    v_r := floor(pk(p_world, p_uid, 'tend_patch', 0))::int;
    perform crops_settle(p_world, tx + 0.5, ty + 0.5, v_r);
    if not exists (select 1 from crop cr
                    where cr.world_id = p_world and cr.x between tx - v_r and tx + v_r and cr.y between ty - v_r and ty + v_r
                      and cr.stage < crop_ripe() and not cr.tended_now) then
      return 'Nothing in the patch wants tending.';
    end if;
  elsif p_action = 'harvest_patch' then
    if pk(p_world, p_uid, 'harvest_patch', 0) <= 0 then return 'That wants a Farmer who has learned to harvest a patch.'; end if;
    v_r := floor(pk(p_world, p_uid, 'harvest_patch', 0))::int;
    perform crops_settle(p_world, tx + 0.5, ty + 0.5, v_r);
    if not exists (select 1 from crop cr
                    where cr.world_id = p_world and cr.x between tx - v_r and tx + v_r and cr.y between ty - v_r and ty + v_r
                      and cr.stage >= crop_ripe()) then
      return 'Nothing in the patch is ripe.';
    end if;
  end if;
  return null;
end $function$;

-- ---- And a worker's face never comes down at a corner of a building.

CREATE OR REPLACE FUNCTION public.worker_do(p_world uuid, p_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; kind text; skill_id text; skill double precision;
        wx int; wy int; here int; data int; tree tree_def; rock rock_def; logs int;
        v_age tree_age_def; v_cuts int;
        made_ql double precision; got text; careful double precision; chance double precision;
        cr crop; yld int[]; depth double precision; v_seed item; v_cd crop_def;
begin
  select * into c from creature where world_id = p_world and id = p_id;
  if not found or c.work_x is null then return null; end if;
  select * into d from species_def where id = c.species;
  kind := coalesce(c.job, d.gathers);
  select g.skill into skill_id from gather_def g where g.id = kind;
  skill := task_skill(c);
  wx := c.work_x; wy := c.work_y;
  here := land_tile(p_world, wx, wy);
  careful := beast_mul(c, 'yield');
  perform worker_learn(p_world, p_id, skill_id, 0.225);
  made_ql := least(100, greatest(1, skill * (0.6 + random() * 0.8) + 1) * careful);

  if kind = 'woodcut' then
    if here <> tile_id('Tree') then return null; end if;
    data := land_data(p_world, wx, wy);
    select * into tree from tree_def where id = tree_species(data);
    select * into v_age from tree_age_def where id = tree_age(data);
    -- A worker swings the same number of times a person would, and the notch it
    -- leaves is the same notch: anybody may finish the tree it started.
    v_cuts := tree_cuts(p_world, wx, wy) + 1;
    if v_cuts < v_age.hits then
      perform tree_notch(p_world, wx, wy, v_cuts);
      return null;
    end if;
    logs := v_age.logs;
    -- A tree with timber in it leaves a stump, as it does under a hatchet.
    if logs = 0 then
      perform land_set_tile(p_world, wx, wy, tile_id('Grass'));
      perform land_set_data(p_world, wx, wy, 0);
    else
      perform land_set_tile(p_world, wx, wy, tile_id('Stump'));
      perform land_set_data(p_world, wx, wy, tree_pack(tree_species(data), 0));
    end if;
    perform land_announce(p_world, wx, wy);
    if logs = 0 then return null; end if;
    -- It can only carry one at a time; the rest of the tree waits at the stump.
    if logs > 1 then
      perform drop_on_ground(p_world, wx, wy, 'log', made_ql, tree.name, logs - 1);
    end if;
    return jsonb_build_object('def', 'log', 'count', 1, 'ql', made_ql, 'extra', tree.name);

  elsif kind = 'prune' then
    -- A stage back, as under a sickle: the age and nothing else. It carries
    -- nothing home.
    if here <> tile_id('Tree') then return null; end if;
    data := land_data(p_world, wx, wy);
    select * into v_age from tree_age_def where id = tree_age(data);
    if v_age.pruned is null then return null; end if;
    perform land_set_data(p_world, wx, wy, tree_pack(tree_species(data), v_age.pruned));
    perform land_announce(p_world, wx, wy);
    return null;

  elsif kind = 'fruit' then
    -- Off a bearing tree, as many as a person's hands would take: an old
    -- tree carries more than one only just come into bearing. The tree is
    -- left picked for the day, as it is behind a person.
    if here <> tile_id('Tree') then return null; end if;
    data := land_data(p_world, wx, wy);
    select * into tree from tree_def where id = tree_species(data);
    select * into v_age from tree_age_def where id = tree_age(data);
    if tree.fruit is null or not v_age.bears or not v_age.alive then return null; end if;
    perform mark_foraged(p_world, wx, wy, 'forage');
    return jsonb_build_object('def', tree.fruit,
      'count', greatest(1, round((case when v_age.id in (2, 4) then 5 else 3 end)
                                  * (0.5 + skill / 130.0) * (0.7 + random() * 0.6))::int),
      'ql', made_ql);

  elsif kind = 'stump' then
    -- Bare dirt where it stood, as under a shovel.
    if here <> tile_id('Stump') then return null; end if;
    perform land_set_tile(p_world, wx, wy, tile_id('Dirt'));
    perform land_set_data(p_world, wx, wy, 0);
    perform land_announce(p_world, wx, wy);
    return null;

  elsif kind in ('mine', 'quarry') then
    rock := bedrock_at(p_world, wx, wy);
    got := case when kind = 'mine' and rock.seam then rock.yields else 'rock_shards' end;
    made_ql := least(ore_max_ql((select seed from world where id = p_world), wx, wy), made_ql);
    /*
     * And the face, now and again, the same as for a hand on a pick.
     *
     * This branch took the metal and left the rock exactly where it stood, for
     * every swing a mola ever made -- so a mola set on a seam could work it a
     * week and not move it a step, where the browser's mola has been cutting
     * it back by luck since the day workers went in.
     *
     * The guard is the browser's: a corner one unit up is the floor, and
     * nothing digs the island out from under itself.
     */
    -- Piers: and never a corner of a building, a tile on piers among them (`Buildings.aroundCorner`).
    if random() < mine_collapse() and rock_height(p_world, wx, wy) > 1 and corner_under_building(p_world, wx, wy) is null then
      perform land_set_height(p_world, wx, wy, land_height(p_world, wx, wy) - 1);
      perform land_set_dirt(p_world, wx, wy, 0);
      perform reconcile_around(p_world, wx, wy);
      perform land_announce(p_world, wx, wy);
    end if;
    return jsonb_build_object('def', got, 'count', 1, 'ql', made_ql);

  elsif kind in ('sand', 'clay') then
    if land_dirt(p_world, wx, wy) <= 0 then return null; end if;
    perform land_set_dirt(p_world, wx, wy, land_dirt(p_world, wx, wy) - 1);
    return jsonb_build_object('def', kind, 'count', 1, 'ql', made_ql);

  elsif kind = 'peat' then
    perform mark_foraged(p_world, wx, wy, 'dig');
    return jsonb_build_object('def', case when here = tile_id('Tar') then 'tar' else 'peat' end,
      'count', 1, 'ql', made_ql);

  elsif kind = 'reed' then
    perform mark_foraged(p_world, wx, wy, 'reed');
    return jsonb_build_object('def', 'reed', 'count', 1, 'ql', made_ql);

  elsif kind = 'fish' then
    depth := water_depth(p_world, wx, wy);
    got := catch_fish(depth, skill, 0, null);
    if got is null then return null; end if;
    return jsonb_build_object('def', got, 'count', 1, 'ql', made_ql);

  elsif kind = 'seek' then
    -- A nose over ground nobody has turned. It finds what it knows to look
    -- for and no more, and nothing it brings up is sound.
    perform mark_foraged(p_world, wx, wy, 'dig');
    if random() > find_chance(skill, 30) then return null; end if;
    declare v_relic relic_def; v_part int;
    begin
      select * into v_relic from relics_within(skill) order by random() limit 1;
      if not found then return null; end if;
      v_part := 1 + floor(random() * v_relic.parts)::int;
      return jsonb_build_object('def', 'fragment', 'count', 1,
        'ql', least(100, greatest(1, skill * (0.6 + random() * 0.8))),
        'extra', v_relic.name || ' ' || v_part || '/' || v_relic.parts);
    end;

  elsif kind = 'fetch' then
    -- Whatever is lying there, carried home. A feller leaves two logs at every
    -- stump it works; this is what tidies them away.
    declare lying item;
    begin
      select * into lying from item where world_id = p_world and holder = 'ground'
        and gx = wx and gy = wy order by id limit 1;
      if not found then return null; end if;
      delete from item where id = lying.id;
      return jsonb_build_object('def', lying.def, 'count', lying.count,
        'ql', lying.ql, 'extra', lying.extra);
    end;

  elsif kind = 'compost' then
    -- Whatever it was, what comes back is compost, and the more of it the better.
    declare rot item;
    begin
      select * into rot from item where world_id = p_world and holder = 'ground'
        and gx = wx and gy = wy and (def = 'corpse' or dmg >= 40) order by id limit 1;
      if not found then return null; end if;
      delete from item where id = rot.id;
      return jsonb_build_object('def', 'compost', 'count', greatest(1, round(rot.count / 2.0)::int),
        'ql', least(100, 20 + skill * 0.6));
    end;

  elsif kind = 'farm' then
    perform crop_settle(p_world, wx, wy);
    select * into cr from crop where world_id = p_world and x = wx and y = wy;
    if not found then
      -- Nothing growing here. Sow it, if this is a field and there is a seed
      -- to be had: one lying where the last harvest left it, or one out of the
      -- settlement's stores.
      if land_tile(p_world, wx, wy) <> tile_id('Field') then return null; end if;
      select * into v_seed from sow_seed(p_world, c, wx, wy);
      if v_seed.id is null then return null; end if;
      if v_seed.count > 1 then
        update item set count = count - 1 where id = v_seed.id;
      else
        delete from item where id = v_seed.id;
      end if;
      select * into v_cd from crop_def where seed = v_seed.def;
      if v_cd.id is null then return null; end if;
      insert into crop (world_id, x, y, id, ql, sown_by)
      values (p_world, wx, wy, v_cd.id, v_seed.ql, c.keeper)
      on conflict (world_id, x, y) do update set id = v_cd.id, stage = 0, stage_at = now(),
        tended = 0, tended_now = false, ql = v_seed.ql, sown_by = c.keeper, pace = 1;
      perform crop_sown(p_world, wx, wy, v_cd.id);
      perform land_announce(p_world, wx, wy);
      -- Nothing to carry home: the work was putting it in the ground.
      return null;
    end if;
    if cr.stage < crop_ripe() then
      -- Not ripe: weed and water it, which is what makes the harvest worth having.
      if not cr.tended_now then
        update crop set tended = tended + 1, tended_now = true,
            ql = least(100, ql + greatest(1, skill * 0.2))
          where world_id = p_world and x = wx and y = wy;
        return null;
      end if;
      /*
       * Weeded already, and still growing. What is left to do on this tile is
       * carry away the seed the last harvest left in the furrow: a sown field
       * has no use for it, and it goes home to the stores with everything
       * else a worker carries rather than lying out here for good.
       */
      select * into v_seed from item i
        where i.world_id = p_world and i.holder = 'ground' and i.gx = wx and i.gy = wy
          and exists (select 1 from crop_def sd where sd.seed = i.def)
        order by i.id limit 1;
      if v_seed.id is null then return null; end if;
      delete from item where id = v_seed.id;
      return jsonb_build_object('def', v_seed.def, 'count', v_seed.count, 'ql', v_seed.ql);
    end if;
    yld := crop_yield(cr.tended);
    select produce into got from crop_def where id = cr.id;
    delete from crop where world_id = p_world and x = wx and y = wy;
    perform land_set_tile(p_world, wx, wy, tile_id('Field'));
    perform land_announce(p_world, wx, wy);
    -- The seed goes back in the ground's place; the produce goes home. They
    -- were the other way round, the seed's count of produce handed home and
    -- the produce's count of seed left on the field; `crop_yield` is
    -- [seeds, produce], as the browser's worker has always read it.
    perform drop_on_ground(p_world, wx, wy, (select seed from crop_def where id = cr.id),
      cr.ql, null, yld[1]);
    return jsonb_build_object('def', got, 'count', yld[2], 'ql', cr.ql);

  else
    -- Foraging and botanizing: the same table a player rolls on, and the same
    -- bed left picked clean behind it.
    perform mark_foraged(p_world, wx, wy, kind);
    chance := least(0.98, greatest(0.3, 0.6 + (skill / 100) * 0.38 - 5 / 150.0) * careful);
    if random() < 0.2 or random() >= chance then return null; end if;
    got := roll_table(kind, random());
    if got is null then return null; end if;
    return jsonb_build_object('def', got, 'count', 1, 'ql', made_ql);
  end if;
end $function$;

-- ---- No creature goes onto a tile on piers, or under one: wild, at work, at heel, or out of a crate.

CREATE OR REPLACE FUNCTION public.creature_tile_ok(p_world uuid, p_x integer, p_y integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select p_x >= 0 and p_y >= 0 and p_x < q.size and p_y < q.size
     and not coalesce(q.blocks, true)
     and (q.a + q.b + q.c + q.d) / 4.0 >= -1
     and greatest(q.a, q.b, q.c, q.d) - least(q.a, q.b, q.c, q.d) <= stand_cap(q.tile, max_stand())
     -- Piers: and not a tile on piers, asked only on an island that has had one (`world.piers`).
     and case when q.piers then not exists (select 1 from building_tile bt
               where bt.world_id = p_world and bt.x = p_x and bt.y = p_y and bt.pier) else true end
  from (
    -- Piers: `w.piers`.
    select w.size, w.piers,
           case when p_x >= 0 and p_x < length(t.tiles) then get_byte(t.tiles, p_x) end as tile,
           (select d.blocks from tile_def d
             where d.id = case when p_x >= 0 and p_x < length(t.tiles)
                               then get_byte(t.tiles, p_x) end) as blocks,
           case when p_x >= 0 and (p_x + 1) * 2 + 1 < length(c0.heights) then b_i16(c0.heights, p_x) end as a,
           case when p_x >= 0 and (p_x + 1) * 2 + 1 < length(c0.heights) then b_i16(c0.heights, p_x + 1) end as b,
           case when p_x >= 0 and (p_x + 1) * 2 + 1 < length(c1.heights) then b_i16(c1.heights, p_x + 1) end as c,
           case when p_x >= 0 and (p_x + 1) * 2 + 1 < length(c1.heights) then b_i16(c1.heights, p_x) end as d
    from world w
    left join land_tile   t  on t.world_id  = p_world and t.y = p_y
    left join land_corner c0 on c0.world_id = p_world and c0.y = p_y
    left join land_corner c1 on c1.world_id = p_world and c1.y = p_y + 1
    where w.id = p_world) q
$function$;

CREATE OR REPLACE FUNCTION public.line_clear(p_world uuid, p_x0 double precision, p_y0 double precision, p_x1 double precision, p_y1 double precision)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
AS $function$
declare n int; i int; tx int; ty int; t double precision; size int;
        step int := chunk_size()::int; k land_chunk; kx int := -999; ky int := -999; walls int[];
        v_piers boolean;  -- Piers
begin
  -- Piers: and whether it has ever had a tile on piers (`world.piers`), off the same row.
  select w.size, w.piers into size, v_piers from world w where w.id = p_world;
  if size is null then return false; end if;
  -- Piers: and then whether one lies anywhere in the line's box: one probe, before any tile is asked.
  if v_piers then
    v_piers := exists (select 1 from building_tile bt where bt.world_id = p_world and bt.pier
      and bt.x between floor(least(p_x0, p_x1))::int and floor(greatest(p_x0, p_x1))::int
      and bt.y between floor(least(p_y0, p_y1))::int and floor(greatest(p_y0, p_y1))::int);
  end if;
  select coalesce(array_agg(id), '{}') into walls from tile_def where blocks;
  n := greatest(1, ceil(2 * sqrt(power(p_x1 - p_x0, 2) + power(p_y1 - p_y0, 2)))::int);
  for i in 0..n loop
    t := i::double precision / n;
    tx := floor(p_x0 + (p_x1 - p_x0) * t)::int;
    ty := floor(p_y0 + (p_y1 - p_y0) * t)::int;
    -- `in_bounds`, which the square below cannot answer: a chunk at the edge is
    -- padded out to its full width, and a padded byte is not ground.
    if tx < 0 or ty < 0 or tx >= size or ty >= size then return false; end if;
    -- Piers: nothing walks onto a tile on piers, or under one (`creature_tile_ok`): asked only where one may be.
    if v_piers then
      if exists (select 1 from building_tile bt where bt.world_id = p_world and bt.x = tx and bt.y = ty and bt.pier) then
        return false;
      end if;
    end if;
    if tx / step <> kx or ty / step <> ky then
      kx := tx / step; ky := ty / step;
      select * into k from land_chunk c where c.world_id = p_world and c.cx = kx and c.cy = ky;
    end if;
    if k.tiles is null or length(k.tiles) <= (ty - ky * step) * step + (tx - kx * step)
       or k.heights is null or length(k.heights) < (step + 1) * (step + 1) * 2 then
      -- No square built here yet, or one built short. The scanlines are the
      -- truth; this only ever reads the square, never makes one, because a
      -- STABLE function may not write and `chase_leg` needs this one STABLE.
      if not creature_tile_ok(p_world, tx, ty) then return false; end if;
    else
      if get_byte(k.tiles, (ty - ky * step) * step + (tx - kx * step)) = any (walls) then return false; end if;
      -- `bool_and` ignored a null and so does this: a corner the island has no
      -- row for makes the comparison null, which is not `true`, so nothing
      -- returns and the walk carries on. That was the old answer too.
      if chunk_centre(k, kx, ky, tx, ty, step) < -1 then return false; end if;
      if chunk_slope(k, kx, ky, tx, ty, step) > stand_cap(get_byte(k.tiles, (ty - ky * step) * step + (tx - kx * step)), max_stand()) then return false; end if;
    end if;
  end loop;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.creature_settle(p_world uuid, p_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; a age_def; elapsed double precision; top double precision;
        guard int := 0; n int; i int; nx double precision; ny double precision;
        dist double precision; secs double precision; pace double precision; ok boolean;
        home record; ax double precision; ay double precision; v_rig placed;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  select * into d from species_def where id = c.species;
  a := age_row(c.born, old_of(c));
  /*
   * In the traces until somebody takes it out.
   *
   * A hitch was a column and nothing else read it: the settle below went on
   * walking a companion to its keeper's feet and sending a worker out to its
   * trade, so an animal backed into a yoke was at its owner's heels a second
   * later, still hitched to a wagon it was nowhere near. It stands at the
   * vehicle now, thinks nothing, and does not get hungry, until `unhitch_one`
   * or `unhitch_all` takes it out -- or what it was hitched to is gone, in
   * which case there is nothing left to be in the traces of.
   */
  if c.hitched_to is not null then
    select * into v_rig from placed where world_id = p_world and id = c.hitched_to;
    if not found then
      update creature set hitched_to = null where world_id = p_world and id = p_id;
      c.hitched_to := null;
    end if;
  end if;
  elapsed := extract(epoch from (now() - c.settled_at));
  if elapsed <= 0 then
    -- Nothing has passed for the body — but a worker's day is not its body,
    -- and the trips it is owed are still owed. One in the traces owes none.
    if c.hitched_to is not null then return false; end if;
    if c.mode = 'deed' then perform worker_settle(p_world, p_id);
    elsif c.mode = 'active' then perform companion_settle(p_world, p_id); end if;
    return false;
  end if;

  -- The body: hunger falling, wounds closing, fleece coming back, and a
  -- brushing wearing off. None of it needs a step; it is all just elapsed time.
  top := max_health(c);
  -- Except in the traces, where the belly holds where it was when it went in.
  if c.hitched_to is null then
    -- Hungry slower for its keeper's Light Eaters.
    c.hunger := greatest(0, c.hunger - elapsed * hunger_rate(c.mode) * beast_mul(c, 'appetite')
                                   * coalesce((c.kept->>'kept:hunger')::double precision, 1));
  end if;
  if c.health > top then
    c.health := top;
  elsif c.health < top and (c.hurt_at is null or now() - c.hurt_at > interval '6 seconds') then
    c.health := least(top, c.health + elapsed * case when c.mode = 'wild' then 0.25 else 0.6 end * beast_mul(c, 'mend'));
  end if;
  if d.fleece is not null and a.growth > 0 and c.fleece < 1 then
    c.fleece := least(1, c.fleece + elapsed * d.fleece * a.growth * beast_mul(c, 'grow'));
  end if;
  -- A brushing wears off over a few hours: longer for its keeper's Lasting Care.
  c.care := greatest(0, c.care - elapsed / (coalesce((c.kept->>'kept:care_hours')::double precision, care_hours()) * 3600));
  /*
   * And a hungry one on a deed goes to the stores.
   *
   * Written on the row rather than on `c`, so the settle below does not carry
   * the old belly back over it. Only when it is actually hungry, which for a
   * worker is an hour or so apart — this is not a cost anybody pays on a beat.
   */
  if c.mode <> 'wild' and c.hitched_to is null and c.hunger < graze_hungry() then
    if worker_feed(p_world, p_id) is not null then
      c.hunger := least(1, c.hunger + graze_fill());
    end if;
  end if;

  -- And no further: it stands at the vehicle, the body settled and nothing else.
  if c.hitched_to is not null then
    update creature set
        from_x = v_rig.cx, from_y = v_rig.cy, to_x = v_rig.cx, to_y = v_rig.cy,
        leg_at = now(), leg_ends = now(), until = now(),
        health = c.health, fleece = c.fleece, care = c.care,
        enemy = null, hunting = null, settled_at = now()
      where world_id = p_world and id = p_id;
    return true;
  end if;

  if c.mode = 'wild' then
    if d.hunter then c := hunt_settle(p_world, c, d, a); else c.hunting := null; end if;
  else
    c.hunting := null;
  end if;

  if c.mode = 'wild' and c.hunting is null then
    pace := d.speed * a.speed * beast_mul(c, 'speed') * 0.7;
    while c.until <= now() and guard < catch_up_legs() loop
      guard := guard + 1;
      n := c.leg + 1;
      ok := false;
      -- A step about its own country rather than a step from wherever it
      -- last got to. Past the edge of its range it draws towards home
      -- instead, which is what keeps an island's wildlife somewhere in
      -- particular. A creature from before homes existed takes where it
      -- stands, which is what it would have had anyway.
      if c.home_x is null then c.home_x := c.to_x; c.home_y := c.to_y; end if;
      if (c.to_x - c.home_x) ^ 2 + (c.to_y - c.home_y) ^ 2 > wild_range() ^ 2 then
        ax := c.home_x; ay := c.home_y;
      else
        ax := c.to_x; ay := c.to_y;
      end if;
      for i in 0..7 loop
        nx := ax + (hash_tile(p_id, n, 7001 + i) * 2 - 1) * wild_reach();
        ny := ay + (hash_tile(p_id, n, 9001 + i) * 2 - 1) * wild_reach();
        if creature_tile_ok(p_world, floor(nx)::int, floor(ny)::int)
           and line_clear(p_world, c.to_x, c.to_y, nx, ny) then ok := true; exit; end if;
      end loop;
      c.leg := n;
      if not ok then
        -- Hemmed in: stand where it is and look again in a moment.
        c.from_x := c.to_x; c.from_y := c.to_y;
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '2 seconds';
        continue;
      end if;
      -- It feeds itself on the way. The browser walks it to a forage bed,
      -- grazes for a few seconds and tops the belly up; out here the leg that
      -- ends on ground worth grazing is the same thing without the detail.
      if c.hunger < graze_hungry() and coalesce((select forage from tile_def
            where id = land_tile(p_world, floor(nx)::int, floor(ny)::int)), false) then
        c.hunger := least(1, c.hunger + graze_fill());
      end if;
      dist := sqrt((nx - c.to_x) ^ 2 + (ny - c.to_y) ^ 2);
      secs := greatest(0.2, dist / greatest(0.1, pace));
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.to_x := nx; c.to_y := ny;
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs => secs);
      c.until := c.leg_ends + make_interval(secs => wild_rest() + hash_tile(p_id, n, 11001) * wild_rest_spread());
    end loop;
    /*
     * And past the cap it is where it got to, and the clock catches up with
     * it. This line is the whole reason the cap can come down: it was already
     * here, and it was already the answer for anything more than forty legs
     * behind. Forty was doing an eighth of a second of arithmetic to reach an
     * answer this line gives for nothing.
     *
     * Measured, on a creature an hour behind: 109.10 ms with the cap at forty,
     * against 4.78 ms for one a second behind. Every one of those legs is a
     * random step inside a home range nobody was standing in.
     */
    if c.until <= now() then
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.leg_at := now(); c.leg_ends := now();
      c.until := now() + make_interval(secs => 1 + hash_tile(p_id, c.leg, 11001) * 5);
    end if;
  elsif c.mode = 'active' and c.keeper is not null and c.enemy is null then
    -- A companion is wherever its keeper is; following is not a walk of its own.
    -- A fight is, and one with something in its teeth keeps the legs it has:
    -- `companion_settle`, below, walks it, strikes, and brings it back to heel.
    select p.x, p.y into home from player p where p.world_id = p_world and p.uid = c.keeper;
    -- Piers: but not onto a tile on piers, where it does not go: it waits where it is (`creature_tile_ok`).
    if found and not on_piers(p_world, floor(home.x)::int, floor(home.y)::int) then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      c.leg_at := now(); c.leg_ends := now(); c.until := now();
    end if;
  elsif c.mode = 'stored' then
    -- In a crate: where the crate stands, or at the feet of whoever carries it.
    select pl.cx as x, pl.cy as y into home from placed pl where pl.world_id = p_world and pl.creature = p_id limit 1;
    if not found then
      select py.x, py.y into home from player py where py.world_id = p_world and py.uid = c.keeper;
    end if;
    if found then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      -- A crated one never walks, so it is not asked every round.
      c.leg_at := now(); c.leg_ends := now(); c.until := now() + make_interval(secs => stored_settle());
    end if;
  end if;

  update creature set
      from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, leg = c.leg,
      health = c.health, hunger = c.hunger, fleece = c.fleece, care = c.care,
      hunting = c.hunting, hunt_x = c.hunt_x, hunt_y = c.hunt_y, hunt_again = c.hunt_again,
      home_x = c.home_x, home_y = c.home_y,
      settled_at = now()
    where world_id = p_world and id = p_id;
  -- And then the day's work, for whichever of them is on a deed rather than
  -- out in the country. The row goes down first because the work reads it back.
  if c.mode = 'deed' then perform worker_settle(p_world, p_id);
  -- And a companion's company, which is the one thing at heel that is a walk of its own.
  elsif c.mode = 'active' then perform companion_settle(p_world, p_id); end if;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.companion_settle(p_world uuid, p_id integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; k player; q creature; guard int := 0; done int := 0;
        pace double precision; cx double precision; cy double precision;
        ax double precision; ay double precision; dist double precision; v_step record;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found or c.mode <> 'active' or c.keeper is null then return 0; end if;
  -- Under a rider or in the traces it goes where it is taken, and does no thinking.
  if c.rider is not null or c.hitched_to is not null then return 0; end if;
  select * into k from player where world_id = p_world and uid = c.keeper;
  if not found then return 0; end if;
  select * into d from species_def where id = c.species;
  pace := d.speed * (age_row(c.born, old_of(c))).speed * beast_mul(c, 'speed');

  while c.until <= now() and guard < 60 loop
    guard := guard + 1;
    cx := c.to_x; cy := c.to_y;

    if c.phase = 'strike' then
      -- The row goes down first: the blow settles the other one, and a kill
      -- takes the enemy off every row that had it, this one included.
      update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
          leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
          enemy = c.enemy, settled_at = now()
        where world_id = p_world and id = p_id;
      if c.enemy is not null and creature_attack(p_world, p_id, c.enemy) then done := done + 1; end if;
      select * into c from creature where world_id = p_world and id = p_id;
      c.phase := 'idle';
      c.leg_at := c.until; c.leg_ends := c.until;
      continue;
    end if;

    q := companion_target(p_world, c, k);
    if q.id is null then
      c.enemy := null;
      exit;
    end if;
    if c.enemy is distinct from q.id then
      c.enemy := q.id;
      perform tell(p_world, c.keeper, c.name || ' goes for the '
        || lower((select name from species_def where id = q.species)) || '.', 'fight');
    end if;
    ax := creature_x(q); ay := creature_y(q);
    dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
    if dist <= companion_reach() then
      c.phase := 'strike';
      c.leg_at := c.until; c.leg_ends := c.until;
      c.until := c.until + make_interval(secs => companion_blow() / beast_mul(c, 'haste'));
    else
      -- A leg that ends well inside its reach, so a thing shuffling half a
      -- step does not put it out of reach again, round whatever is between.
      select * into v_step from chase_leg(p_world, cx, cy,
        cx + (ax - cx) * (dist - companion_reach() / 2) / dist,
        cy + (ay - cy) * (dist - companion_reach() / 2) / dist);
      if v_step.x is null then
        -- Nothing open at all: the browser gives up here too.
        c.enemy := null;
        exit;
      end if;
      c.from_x := cx; c.from_y := cy;
      c.to_x := v_step.x; c.to_y := v_step.y;
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs =>
        greatest(0.2, sqrt((c.to_x - cx) ^ 2 + (c.to_y - cy) ^ 2)
                      / greatest(0.1, pace * companion_pace())));
      c.until := c.leg_ends;
    end if;
  end loop;

  -- Piers: at heel, unless its keeper is on a tile on piers, where it does not go: then where it is (`creature_tile_ok`).
  if c.enemy is null and on_piers(p_world, floor(k.x)::int, floor(k.y)::int) then
    c.from_x := c.to_x; c.from_y := c.to_y;
    c.leg_at := now(); c.leg_ends := now(); c.until := now();
    c.phase := 'idle';
  elsif c.enemy is null then
    -- Nothing to go for: at heel, which is not a walk of its own.
    c.from_x := k.x; c.from_y := k.y; c.to_x := k.x; c.to_y := k.y;
    c.leg_at := now(); c.leg_ends := now(); c.until := now();
    c.phase := 'idle';
  elsif c.until <= now() then
    c.from_x := c.to_x; c.from_y := c.to_y;
    c.leg_at := now(); c.leg_ends := now(); c.until := now() + interval '1 second';
  end if;
  update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
      enemy = c.enemy, settled_at = now()
    where world_id = p_world and id = p_id;
  return done;
end $function$;

create or replace function crate_let_out(p_world uuid, p_id int) returns void
language plpgsql as $$
declare v_pl placed; v_x double precision; v_y double precision; v_keeper uuid;
begin
  select * into v_pl from placed where world_id = p_world and creature = p_id limit 1;
  if v_pl.id is not null then
    v_x := v_pl.cx + case v_pl.facing when 'e' then 0.6 when 'w' then -0.6 else 0 end;
    v_y := v_pl.cy + case v_pl.facing when 'n' then -0.6 when 'e' then 0 when 'w' then 0 else 0.6 end;
  else
    select keeper into v_keeper from creature where world_id = p_world and id = p_id;
    select py.x, py.y into v_x, v_y from player py where py.world_id = p_world and py.uid = v_keeper;
  end if;
  update placed set creature = null where world_id = p_world and creature = p_id;
  update item set creature = null where world_id = p_world and creature = p_id;
  if v_x is not null then
    update creature set from_x = v_x, from_y = v_y, to_x = v_x, to_y = v_y, phase = 'idle',
        leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
      where world_id = p_world and id = p_id;
  end if;
  -- Piers: and never onto a deck on piers, where no creature goes (`creature_off_piers`).
  perform creature_off_piers(p_world, p_id);
end $$;

-- ---- A bridge lands on a finished deck as on a bank, at the deck.

create or replace function surface_height(p_world uuid, p_x int, p_y int)
returns double precision language sql stable as $fn$
  select coalesce((select (case when f.pool then f.top - pool_lip() else f.top end)::double precision from foundation f
                    where f.world_id = p_world and f.x = p_x and f.y = p_y and bill_done(f.needed)),
                  -- Piers: a finished deck on piers (`deck_surface`), where a bridge lands, as the browser has it.
                  deck_surface(p_world, p_x, p_y),
                  centre_height(p_world, p_x, p_y))
$fn$;

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
    if h - surface_height(p_world, r.x, r.y) < clearance() then return 'That is not a gap, it is ground. Walk it.'; end if;
  end loop;
  return null;
end $function$;

-- ---- Examine says what stands on piers.

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
      -- And a glasshouse says what it is for (`glass_examine`).
      v_extra := v_extra || glass_examine(p_world, b.id);
      -- Piers: and its deck, if the tile stands on piers (`pier_says`).
      v_extra := v_extra || pier_says(p_world, p_x, p_y);
    end if;
  end if;
  select count(*) into n from crate c where c.world_id = p_world
    and p_x between c.x and c.x + c.sx - 1 and p_y between c.y and c.y + c.sy - 1;
  if n = 1 then v_extra := v_extra || ' A crate stands here.';
  elsif n > 1 then v_extra := v_extra || ' ' || n || ' crates stand here.'; end if;
  return v_out || v_extra;
end $function$;

-- ---- The ground read sends a building's deck and its tiles on piers.

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
