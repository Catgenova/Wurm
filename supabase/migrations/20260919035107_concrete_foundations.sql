-- Concrete foundations: level ground poured into a slope, leaving the slope alone.
--
-- Asked for out of a conversation about the thing Wurm never had: "some sort of
-- foundation piece, something material-intensive that fills in the terrain of
-- the tile and has perfectly vertical edges — could base the maximum slope you
-- can build them on skill", and then "specifically featuring vertical edges
-- that are easy to attach other building components to; in wurm i'd often run
-- into awkward building situations next to slopes."
--
-- Every other answer to a slope in this game moves the ground, and the corners
-- it moves are shared with four tiles, so levelling one tile pulls its
-- neighbours about and the hillside you wanted to build against stops being a
-- hillside. A foundation does the opposite: every corner stays exactly where it
-- is and a slab is poured over the tile to one flat top, with sides straight
-- down to whatever is underneath.
--
-- What it costs is the hole it fills — five concrete a step a corner — and what
-- it asks of you is the deepest part of that pour, three units of lift a point
-- of masonry. Both sides work those out from the same two functions, so a plan
-- the browser offers is a plan the island will take.

create table if not exists foundation (
  world_id uuid not null references world(id) on delete cascade,
  id bigint not null,
  x int not null,
  y int not null,
  -- The elevation the top of the slab is poured to, in terrain units.
  top int not null,
  needed jsonb not null,
  total jsonb not null,
  made_by uuid,
  made_at timestamptz not null default now(),
  primary key (world_id, id)
);
-- One to a tile, which is the whole of what a foundation is.
create unique index if not exists foundation_tile on foundation (world_id, x, y);

alter table foundation enable row level security;
drop policy if exists foundation_read on foundation;
create policy foundation_read on foundation for select to authenticated using (true);
grant select on foundation to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table foundation;
    exception when duplicate_object then null; end;
  end if;
end $$;

/** Concrete per step of one corner lifted, and how much lift a point of masonry is worth. */
create or replace function concrete_per_step() returns int language sql immutable as $fn$ select 5 $fn$;
create or replace function lift_per_masonry() returns int language sql immutable as $fn$ select 3 $fn$;
/** How near a building or its plan a slab may be poured: not this near. */
create or replace function clear_of_buildings() returns int language sql immutable as $fn$ select 1 $fn$;

/** The foundation on a tile, shuttered or poured. */
create or replace function foundation_at(p_world uuid, p_x int, p_y int)
returns foundation language sql stable as $fn$
  select f.* from foundation f where f.world_id = p_world and f.x = p_x and f.y = p_y
$fn$;

/**
 * The poured one, which is the only one you can stand on. Shuttering is a line
 * of boards round a hole: everything that asks whether there is ground here has
 * to be asking about the slab, not about the plan.
 */
create or replace function slab_at(p_world uuid, p_x int, p_y int)
returns foundation language sql stable as $fn$
  select f.* from foundation f
  where f.world_id = p_world and f.x = p_x and f.y = p_y and bill_done(f.needed)
$fn$;

/** How high the top of a tile is: a poured slab's, or the ground's own. */
create or replace function surface_height(p_world uuid, p_x int, p_y int)
returns double precision language sql stable as $fn$
  select coalesce((select f.top::double precision from foundation f
                    where f.world_id = p_world and f.x = p_x and f.y = p_y and bill_done(f.needed)),
                  centre_height(p_world, p_x, p_y))
$fn$;

/** What a pour to `p_top` costs over the four corners: the hole it fills, priced by the step. */
create or replace function concrete_for(p_world uuid, p_x int, p_y int, p_top int)
returns int language sql stable as $fn$
  select concrete_per_step() * coalesce(sum(greatest(0, p_top - c.h)), 0)::int
  from tile_corners(p_x, p_y) v
  cross join lateral (select land_height(p_world, v.cx, v.cy) as h) c
$fn$;

/** The deepest part of that pour, which is the part that wants the skill. */
create or replace function lift_for(p_world uuid, p_x int, p_y int, p_top int)
returns int language sql stable as $fn$
  select p_top - min(land_height(p_world, v.cx, v.cy))::int from tile_corners(p_x, p_y) v
$fn$;

/**
 * The level a foundation here would be poured to: what the player has sighted
 * if they have sighted anything above the tile, and the top of the tile
 * otherwise — which is the cheapest slab that squares the tile off and is what
 * anybody wants nine times in ten. Sighting a level is already how this game is
 * told "work to *here*", so a plinth needs no new question asked at the menu.
 */
create or replace function foundation_top(p_world uuid, p_uid uuid, p_x int, p_y int)
returns int language sql stable as $fn$
  select greatest(
    (select max(land_height(p_world, v.cx, v.cy))::int from tile_corners(p_x, p_y) v),
    coalesce((select p.level_h from player p where p.world_id = p_world and p.uid = p_uid),
             (select max(land_height(p_world, v.cx, v.cy))::int from tile_corners(p_x, p_y) v)))
$fn$;

/** Why a slab cannot be poured over this tile to that level, or null. */
create or replace function foundation_reason(p_world uuid, p_uid uuid, p_x int, p_y int, p_top int)
returns text language plpgsql stable as $fn$
declare v_high int; v_low int; v_lift int; v_want double precision; v_have double precision; v_name text;
begin
  if foundation_at(p_world, p_x, p_y) is not null then
    return 'There is already a foundation on that tile.';
  end if;
  select max(land_height(p_world, v.cx, v.cy))::int, min(land_height(p_world, v.cx, v.cy))::int
    into v_high, v_low from tile_corners(p_x, p_y) v;
  -- It fills a hole; it does not cut one.
  if p_top < v_high then
    return 'A foundation fills a tile up, never down. Its high corner is at ' || v_high
      || '; sight a level at or above that.';
  end if;
  -- And it is an answer to a slope. On ground that is already flat there is
  -- nothing to fill, and the tile next to it is the flat tile you were after.
  if p_top = v_high and v_high = v_low then
    return 'That tile is already level. A foundation is for ground that is not.';
  end if;
  /*
   * Not up against a building. A wall is planned against the ground as the
   * ground was, and a slab poured at its foot is a shelf under somebody else's
   * footings; keep a tile between them.
   */
  select b.name into v_name from building b
   where b.world_id = p_world
     and exists (select 1 from building_tile bt
                  where bt.world_id = p_world and bt.building = b.id
                    and abs(bt.x - p_x) <= clear_of_buildings()
                    and abs(bt.y - p_y) <= clear_of_buildings())
   order by b.id limit 1;
  if v_name is not null then
    return v_name || ' is too close. A foundation wants a tile clear of any building or plan.';
  end if;
  if is_token(p_world, p_x, p_y) then return 'The settlement token stands there.'; end if;
  if bridge_at(p_world, p_x, p_y) is not null then return 'A bridge is carried over that tile.'; end if;
  if exists (select 1 from item i where i.world_id = p_world and i.holder = 'ground'
               and i.gx = p_x and i.gy = p_y) then
    return 'Clear away the things lying there first: the pour would bury them.';
  end if;
  -- And the deepest part of the pour is what asks for the skill: shuttering a
  -- step is a morning's work and shuttering a cliff is not.
  v_lift := lift_for(p_world, p_x, p_y, p_top);
  v_want := v_lift::double precision / lift_per_masonry();
  v_have := skill_of(p_world, p_uid, 'masonry');
  if v_have < v_want then
    return 'A pour ' || v_lift || ' deep wants ' || to_char(v_want, 'FM990.0')
      || ' masonry and you have ' || to_char(v_have, 'FM990.0')
      || '. At your skill the deepest you can shutter is '
      || to_char(v_have * lift_per_masonry(), 'FM990') || '.';
  end if;
  return null;
end $fn$;

create or replace function foundation_action(p_action text)
returns boolean language sql immutable as $fn$
  select p_action in ('plan_foundation', 'pour_foundation', 'strike_foundation')
$fn$;

create or replace function foundation_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
returns text language plpgsql stable as $fn$
declare tx int; ty int; f foundation; v_tool text;
begin
  if p_target->>'kind' is distinct from 'tile' then return 'Point at a tile.'; end if;
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  f := foundation_at(p_world, tx, ty);
  if p_action = 'plan_foundation' then
    v_tool := need_tool(p_world, p_uid, 'mallet');
    if v_tool is not null then return v_tool; end if;
    if tile_slope(p_world, tx, ty) = 0 then
      return 'That tile is already level. A foundation is for ground that is not.';
    end if;
    return foundation_reason(p_world, p_uid, tx, ty, foundation_top(p_world, p_uid, tx, ty));
  end if;
  if f.id is null then return 'There is no shuttering here.'; end if;
  if p_action = 'strike_foundation' then
    if bill_done(f.needed) then return 'It is poured. That is a floor now, not a plan.'; end if;
    return null;
  end if;
  -- Pouring.
  if bill_done(f.needed) then return 'It is poured.'; end if;
  v_tool := need_tool(p_world, p_uid, 'trowel');
  if v_tool is not null then return 'You need a trowel to work concrete.'; end if;
  if pack_count(p_world, p_uid, 'concrete') < 1 then return 'You have no concrete.'; end if;
  return null;
end $fn$;

create or replace function perform_foundation(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
returns void language plpgsql as $fn$
declare tx int; ty int; f foundation; v_top int; v_want int; v_left int; v_back int; v_id bigint;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  f := foundation_at(p_world, tx, ty);

  if p_action = 'plan_foundation' then
    v_top := foundation_top(p_world, p_uid, tx, ty);
    if foundation_reason(p_world, p_uid, tx, ty, v_top) is not null then return; end if;
    v_want := concrete_for(p_world, tx, ty, v_top);
    select coalesce(max(fo.id), 0) + 1 into v_id from foundation fo where fo.world_id = p_world;
    insert into foundation (world_id, id, x, y, top, needed, total, made_by)
      values (p_world, v_id, tx, ty, v_top,
              jsonb_build_object('concrete', v_want), jsonb_build_object('concrete', v_want), p_uid);
    perform journal_note(p_world, p_uid, 'planned_foundation', 1);
    perform tell(p_world, p_uid,
      'You shutter a foundation over the tile, to be poured level at ' || v_top
      || '. It wants ' || v_want || ' concrete. The ground around it will not move: the slab fills the hole instead.',
      'system');
    perform land_announce(p_world, tx, ty);
    return;
  end if;

  if f.id is null then return; end if;

  if p_action = 'strike_foundation' then
    if bill_done(f.needed) then return; end if;
    v_back := coalesce((f.total->>'concrete')::int, 0) - coalesce((f.needed->>'concrete')::int, 0);
    delete from foundation fo where fo.world_id = p_world and fo.id = f.id;
    -- What went in has set; the boards come away and the rest is rubble.
    if v_back > 0 then perform give(p_world, p_uid, 'rock_shards', v_back, 20); end if;
    perform tell(p_world, p_uid,
      'You strike the shuttering' ||
      case when v_back > 0 then ' and break out ' || v_back || ' barrowful'
                                 || case when v_back > 1 then 's' else '' end || ' of set concrete as shards'
           else '' end || '.', 'event');
    perform land_announce(p_world, tx, ty);
    return;
  end if;

  -- Pouring: one barrowful a go, and the skill for the go whichever it is.
  if bill_done(f.needed) then return; end if;
  if not consume(p_world, p_uid, 'concrete', 1) then return; end if;
  v_left := greatest(0, coalesce((f.needed->>'concrete')::int, 0) - 1);
  update foundation fo set needed = jsonb_build_object('concrete', v_left)
    where fo.world_id = p_world and fo.id = f.id;
  perform skill_raise(p_world, p_uid, 'masonry', 1);
  if v_left > 0 then
    perform tell(p_world, p_uid, 'You work another barrowful into the shuttering. ' || v_left || ' to go.', 'event');
    perform land_announce(p_world, tx, ty);
    return;
  end if;
  /*
   * And the top of it is packed ground, which is what everything that asks what
   * a tile is made of wants to hear: a building wants packed dirt under it and
   * paving wants a packed floor, and a slab is both. The corners are not
   * touched — that is the whole promise of the thing — only what the top of the
   * tile is surfaced with.
   */
  perform land_set_tile(p_world, tx, ty, tile_id('Packed dirt'));
  perform journal_note(p_world, p_uid, 'poured_foundation', 1);
  perform tell(p_world, p_uid,
    'The last of it goes in and the slab stands level at ' || f.top
    || '. You can build on it, pave it, or bring a bridge to it.', 'event');
  perform land_announce(p_world, tx, ty);
end $fn$;


CREATE OR REPLACE FUNCTION public.act_ported(p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (select 1 from recipe where id = p_action)
      or last_action(p_action)
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
      or build_action(p_action)
      or creature_action(p_action)
      or fight_action(p_action)
      or foundation_action(p_action)
      or p_action in ('dig', 'mine', 'chip_corner', 'pack', 'cultivate', 'pave_gravel', 'pave_cobble',
                      'drop_dirt_here', 'cut_down', 'forage', 'botanize', 'collect',
                      'till', 'plant_seed', 'tend_crop', 'harvest_crop', 'clear_field',
                      'fish', 'drag_net', 'found_settlement', 'set_to_work')
$function$;

CREATE OR REPLACE FUNCTION public.shapes_ground(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in ('dig', 'dredge', 'flatten', 'drop_dirt', 'drop_dirt_here', 'raise_rock',
                      'mine', 'chip_corner', 'pack', 'cultivate', 'pave_gravel', 'pave_cobble',
                      'pave_slabs', 'remove_paving',
                      'plan_foundation', 'pour_foundation', 'strike_foundation')
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

  aimed := p_target->>'kind';
  -- Whose ground it is, before anything about what it is made of.
  aimed := ground_deed_refusal(p_world, p_uid, p_action, p_target);
  if aimed is not null then return aimed; end if;
  aimed := p_target->>'kind';
  -- The hour comes for a dam in young whoever is or is not standing there, and
  -- somebody is always about to do something. This is where they find out.
  perform herd_settle(p_world);
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
  if not in_reach(p.x, p.y, p_target, d.corner, d.range) then return 'You are too far away from that.'; end if;
  if d.tool is not null and tool_ql(p_world, p_uid, d.tool) <= 0 then
    return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || ' to ' || lower(d.label) || '.';
  end if;
  if foundation_action(p_action) then
    return foundation_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if build_action(p_action) then
    return build_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('mine', 'chip_corner', 'pack', 'cultivate', 'pave_gravel', 'pave_cobble', 'drop_dirt_here') then
    return terrain_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('cut_down', 'forage', 'botanize', 'collect') then
    return gather_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('till', 'plant_seed', 'tend_crop', 'harvest_crop', 'clear_field') then
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
    if land_height(p_world, cx, cy) < -mine_depth() then
      return 'The water is too deep here to work in.';
    end if;
    if land_dirt(p_world, cx, cy) <= 0 then
      return 'That corner is bare rock. Only a pickaxe will take it lower.';
    end if;
    return coalesce(level_stop(p_world, p_uid, cx, cy, -1),
                    slope_refusal(p_world, p_uid, 'digging', cx, cy, -1));
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
  if p_action in ('mine', 'chip_corner', 'pack', 'cultivate', 'pave_gravel', 'pave_cobble', 'drop_dirt_here') then
    perform perform_terrain(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('cut_down', 'forage', 'botanize', 'collect') then
    perform perform_gather(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('till', 'plant_seed', 'tend_crop', 'harvest_crop', 'clear_field') then
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
    made_ql := product_ql(s, tq);
    perform give(p_world, p_uid, yield, 1, made_ql);
    -- And one spadeful in a thousand that is not dirt at all.
    perform maybe_map(p_world, p_uid, s, tq);
    perform skill_raise(p_world, p_uid, d.skill, 1);
    perform tell(p_world, p_uid,
      'You dig up some ' || lower((select name from item_def where id = yield)) ||
      '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.plan_reason(p_world uuid, p_uid uuid, p_x integer, p_y integer)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select case
    when not on_my_deed(p_world, p_uid, p_x, p_y) then 'You may only build on your own deed.'
    when is_token(p_world, p_x, p_y) then 'The settlement token stands here.'
    when building_at(p_world, p_x, p_y) is not null then 'That tile is already part of a building.'
    when land_tile(p_world, p_x, p_y) <> tile_id('Packed dirt')
      then 'Buildings need flat packed dirt. Pack the tile first.'
    when foundation_at(p_world, p_x, p_y) is not null and slab_at(p_world, p_x, p_y) is null
      then 'The foundation here is only shuttered. Pour it first.'
    /*
     * A poured slab is level, dry and out of the water by construction — that
     * is the whole of what it was poured for — so the three questions asked of
     * open ground are already answered and asking the terrain again would
     * refuse the one tile on the hillside that was built to be built on.
     */
    when slab_at(p_world, p_x, p_y) is null and tile_slope(p_world, p_x, p_y) <> 0
      then 'The tile must be perfectly flat. Flatten it first.'
    when slab_at(p_world, p_x, p_y) is null and has_water(p_world, p_x, p_y)
      then 'You cannot build in water.'
    when exists (select 1 from item i where i.world_id = p_world and i.holder = 'ground'
                   and i.gx = p_x and i.gy = p_y) then 'Clear away the items lying there first.'
    end
$function$;

CREATE OR REPLACE FUNCTION public.deed_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p player; tx int; ty int; want int := 5; other deed;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  tx := floor(p.x)::int; ty := floor(p.y)::int;
  if exists (select 1 from deed d where d.world_id = p_world and d.founded_by = p_uid) then
    return 'You already hold a settlement. Disband it first.';
  end if;
  if pack_count(p_world, p_uid, 'deed_stake') <= 0 then return 'You have no deed stake.'; end if;
  if tx - want < 0 or ty - want < 0
     or not in_bounds(p_world, tx + want, ty + want) then
    return 'Too close to the edge of the world.';
  end if;
  -- A poured slab is dry, level ground standing above whatever is under it,
  -- which is what a token wants and is sometimes the only such tile about.
  if slab_at(p_world, tx, ty) is null then
    if has_water(p_world, tx, ty) then return 'The token must stand on dry land.'; end if;
    if not passable(p_world, tx, ty) then return 'The token needs a clear tile.'; end if;
  end if;
  -- Two squares overlap when their centres are closer than the sum of their
  -- reaches, on either axis.
  select * into other from deed d
   where d.world_id = p_world
     and abs(tx - d.x) <= want + d.radius
     and abs(ty - d.y) <= want + d.radius
   order by d.founded_at limit 1;
  if found then
    return other.name || ' stands too close. Settlements may not overlap, and yours would '
        || 'reach ' || want || ' tiles from here. Walk further out.';
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.bridge_reason(p_world uuid, p_kind text, p_ax integer, p_ay integer, p_bx integer, p_by integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare d bridge_def; n int; ha double precision; hb double precision; h int; r record; e record;
begin
  select * into d from bridge_def where id = p_kind;
  if not found then return 'Choose what to build it out of.'; end if;
  if not in_bounds(p_world, p_ax, p_ay) or not in_bounds(p_world, p_bx, p_by) then return 'Not there.'; end if;
  if p_ax <> p_bx and p_ay <> p_by then
    return 'A bridge runs straight. Pick an end level with this one, north, south, east or west.';
  end if;
  select count(*)::int into n from span_tiles(p_ax, p_ay, p_bx, p_by);
  if n = 0 then return 'There is nothing between those two. Bridge a gap.'; end if;
  if n > d.span then
    return 'A ' || lower(d.name) || ' spans ' || d.span || ' tiles; that is ' || n || '.';
  end if;
  for e in select * from (values (p_ax, p_ay), (p_bx, p_by)) v(x, y) loop
    -- The bank of a ravine always shares a corner with the ravine, so what
    -- matters is whether you can stand in the middle of the tile, not whether
    -- every corner of it is dry.
    if slab_at(p_world, e.x, e.y) is null
       and (not passable(p_world, e.x, e.y) or centre_height(p_world, e.x, e.y) < 0) then
      return 'Both ends want dry, solid ground to stand on.';
    end if;
    if bridge_at(p_world, e.x, e.y) is not null then return 'One end is already under a bridge.'; end if;
  end loop;
  ha := surface_height(p_world, p_ax, p_ay);
  hb := surface_height(p_world, p_bx, p_by);
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

CREATE OR REPLACE FUNCTION public.rpc_ground(p_world uuid, p_range double precision DEFAULT 40, p_slow boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player;
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
  if p_slow then perform crops_settle(p_world, p.x, p.y, p_range); end if;
  return jsonb_build_object(
    'placed', coalesce((select jsonb_agg(
        (to_jsonb(pl) - 'world_id' - 'made_by' - 'since' - 'made_at' - 'cx' - 'cy')
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
                                then coalesce((select jsonb_agg(jsonb_build_object(
                                       'id', i.id, 'def', i.def, 'ql', i.ql, 'dmg', i.dmg,
                                       'count', i.count, 'extra', i.extra) order by i.id)
                                     from item i
                                     where i.world_id = p_world and i.holder = 'furniture' and i.placed = pl.id),
                                   '[]'::jsonb)
                                else '[]'::jsonb end)
        order by pl.id)
      from placed pl
      where pl.world_id = p_world
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
     * What is growing here, settled first so the stage reported is the stage
     * it is actually at rather than the stage it was at when somebody last
     * touched it. Everything on this island settles lazily off a timestamp,
     * and for a crop nobody had ever been the one to ask.
     *
     * `ago` rather than `stage_at`: the browser counts in its own seconds and
     * has no use for the hour this island stamped on it.
     */
    'crops', coalesce((select jsonb_agg(jsonb_build_object(
        'x', c.x, 'y', c.y, 'id', c.id, 'stage', c.stage,
        'ago', extract(epoch from (now() - c.stage_at)),
        'tended', c.tended, 'tendedNow', c.tended_now, 'ql', c.ql))
      from crop c
      where c.world_id = p_world
        and greatest(abs(c.x + 0.5 - p.x), abs(c.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    /*
     * The felling notches near you, and how long ago the woods last turned
     * over. Look reads both: "2 of 3 strokes in it", "the woods turn over in
     * 9 hours". A browser on an island keeps no clock of its own for the
     * woods, so this is the only place it hears the hour.
     */
    'notches', coalesce((select jsonb_agg(jsonb_build_object('x', n.x, 'y', n.y, 'cuts', n.cuts))
      from tree_notch n
      where n.world_id = p_world
        and greatest(abs(n.x + 0.5 - p.x), abs(n.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    'treesAgo', (select extract(epoch from (now() - w.trees_at)) from world w where w.id = p_world),
    -- The mark the ground is being worked to, which lives on the player row
    -- so that it is the same mark in every browser you open.
    'level', p.level_h,
    'deed', (select jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level, 'mine', true)
      from my_deed(p_world, me) d where d.world_id is not null),
    'deeds', coalesce((select jsonb_agg(jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level,
        -- Land you were asked onto is land you may work, so it is drawn as
        -- yours rather than as a stranger's border you happen to be inside.
        'mine', exists (select 1 from deed_member m where m.world_id = p_world
                          and m.uid = me and m.founder = d.founded_by),
        'holder', account_name(d.founded_by)) order by d.founded_at)
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
          'type', w.type, 'material', w.material, 'needed', w.needed, 'total', w.total)
          order by w.level, w.dir, w.x, w.y)
        from wall w
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
        'id', fo.id, 'x', fo.x, 'y', fo.y, 'top', fo.top,
        'needed', fo.needed, 'total', fo.total) order by fo.id)
      from foundation fo
      where fo.world_id = p_world
        and greatest(abs(fo.x + 0.5 - p.x), abs(fo.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    'nextFoundationId', coalesce((select max(fo.id) + 1 from foundation fo where fo.world_id = p_world), 1)) end;
end $function$;

select private.lock_doors();
