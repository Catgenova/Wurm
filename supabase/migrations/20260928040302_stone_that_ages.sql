/*
 * Stone that ages.
 *
 * Asked for off a picture of a grey castle: ivy climbing its walls from the
 * foot and hanging from the tops, moss in the joints of the paving and on the
 * tops of the stones. Every finished wall, fence and half wall of stone or
 * brick greens over with ivy, and paving, statues, poured slabs and stone
 * bridges with moss: bare on the day they were built, laid or set down, and
 * as green as they get `green_span()` days later, a day at a time. Clear the
 * ivy with a sickle, or Scrub the moss with a brush, and it starts again from
 * bare stone. The browser's half is `src/game/greening.ts`, and
 * `supabase/test/green.ts` holds the two to each other.
 *
 * ## One clock, kept here
 *
 * The days are worked out from when a thing began to green, and that is the
 * island's to say, so it is the same on every page. `green_since` holds it for
 * everything built, laid or cleared since this came in, keyed to the thing:
 *
 *   - `wall`: a finished wall of stone or brick, at its border (`x`, `y`) and
 *     storey and run (`k`, `green_wall_k`). Written when its last unit goes
 *     in or it is laid again in another stone, by a trigger on `wall`, so no
 *     way of finishing a wall can miss it.
 *   - `paving`: a paved tile, written by `land_set_tile` -- the one door every
 *     tile change goes through -- when paving goes down, and forgotten when it
 *     comes up.
 *   - `slab`: a poured foundation, when its last barrowful goes in.
 *   - `bridge`: a stone arch, at its first end (`x`, `y`) and id (`k`), when
 *     its last span is decked.
 *   - `piece`: a statue, at its tile and id, when it is scrubbed. When it was
 *     set down is its own `made_at`.
 *
 * Anything with no row began when greening came in, which is
 * `world.green_from`: the moment this migration ran, for every island there
 * is. So nothing already standing greens overnight; a village that stood for
 * a month is bare the day this arrives and greens over the fortnight after.
 *
 * ## Carried with the thing
 *
 * A wall's comes with the walls on the ground's slow half, a slab's with the
 * slabs, a statue's with what is set down on the fast half, and a bridge's
 * with the bridges -- which the slow half carries now for the first time: the
 * island has kept them since bridges were ported and never said a word about
 * one, so on an island a bridge was neither drawn nor walked by anybody. Each
 * as seconds since it began (`greenAgo`), the one thing two clocks agree on
 * without being set to each other. Paving comes as the rows in range and the
 * seconds since greening came in, for every paved tile without one.
 *
 * Nothing here is on a hot path: the triggers fire when a wall, a slab or a
 * bridge is finished or taken down, `land_set_tile` reads one byte more when a
 * tile changes, and `rpc_move` and the tick are untouched.
 */
set local lock_timeout = '3s';

-- When greening came to each island: now, for every island there is, and the day it is founded for any after.
alter table world add column if not exists green_from timestamptz not null default now();
-- Which pieces gather moss (`FurnitureDef.mossy`). The definitions fill it in, and they go in after this; the
-- column is made here as well so that the ground read and the doors below never run a moment without it.
alter table furniture_def add column if not exists mossy boolean not null default false;

/** Days stone takes to green over, from bare to as green as it gets (`GREEN_DAYS`). */
create or replace function green_span() returns int language sql immutable as 'select 14';
/** A day on the woods' clock, in seconds (`GREEN_DAY`). */
create or replace function green_day() returns int language sql immutable as 'select 86400';

/** Whole days a thing has been greening at `p_now`, from nought to `green_span()` (`greenDays`). */
create or replace function green_days(p_since timestamptz, p_now timestamptz default now()) returns int
language sql stable as $fn$
  select greatest(0, least(green_span(), floor(extract(epoch from (p_now - p_since)) / green_day())))::int
$fn$;

/** When a thing began to green: when it says, and never before greening came in (`greenStart`). */
create or replace function green_start(p_since timestamptz, p_from timestamptz) returns timestamptz
language sql immutable as $fn$
  select greatest(coalesce(p_since, p_from), p_from)
$fn$;

/** How long ago something began to green, in seconds, as the ground read carries it. */
create or replace function green_ago(p_since timestamptz, p_from timestamptz) returns double precision
language sql stable as $fn$
  select extract(epoch from (now() - green_start(p_since, p_from)))::double precision
$fn$;

/** The sentence a clearing ends with (`GREEN_AGAIN`). */
create or replace function green_again() returns text language sql immutable as $fn$
  select 'It starts again from bare stone and is as green as it gets in ' || green_span() || ' days.'
$fn$;
/** Why there is nothing to clear yet (`NOTHING_YET`). */
create or replace function green_nothing_yet() returns text language sql immutable as $fn$
  select 'Nothing has grown on it yet. It greens a day at a time, over ' || green_span()
      || ' days from when it was built, laid, set down or last cleared.'
$fn$;

create table if not exists green_since (
  world_id uuid not null references world(id) on delete cascade,
  thing text not null check (thing in ('wall', 'paving', 'slab', 'bridge', 'piece')),
  x int not null,
  y int not null,
  k bigint not null default 0,
  since timestamptz not null default now(),
  primary key (world_id, thing, x, y, k)
);
-- Read by the doors and the ground read, which are the island's own; nobody reads it straight off the table.
alter table green_since enable row level security;

/** A wall's `k`: its storey, and which way its border runs. */
create or replace function green_wall_k(p_level int, p_dir text) returns bigint language sql immutable as $fn$
  select (p_level * 2 + case when p_dir = 'v' then 1 else 0 end)::bigint
$fn$;

/** Something is bare stone from now: built, laid or cleared. */
create or replace function green_mark(p_world uuid, p_thing text, p_x int, p_y int, p_k bigint) returns void
language sql as $fn$
  insert into green_since (world_id, thing, x, y, k, since) values (p_world, p_thing, p_x, p_y, p_k, now())
  on conflict (world_id, thing, x, y, k) do update set since = excluded.since
$fn$;
/** And something that is gone forgets when it began. */
create or replace function green_forget(p_world uuid, p_thing text, p_x int, p_y int, p_k bigint) returns void
language sql as $fn$
  delete from green_since g
   where g.world_id = p_world and g.thing = p_thing and g.x = p_x and g.y = p_y and g.k = p_k
$fn$;

/** A wall of stone or brick finished, or laid again in another stone, is bare from now; one taken down forgets. */
create or replace function green_wall_trigger() returns trigger language plpgsql as $fn$
begin
  if tg_op = 'DELETE' then
    perform green_forget(old.world_id, 'wall', old.x, old.y, green_wall_k(old.level, old.dir));
    return null;
  end if;
  if bill_done(new.needed)
     and (tg_op = 'INSERT' or not bill_done(old.needed) or new.material is distinct from old.material)
     and exists (select 1 from build_material_def m where m.id = new.material and m.kind = 'stone') then
    perform green_mark(new.world_id, 'wall', new.x, new.y, green_wall_k(new.level, new.dir));
  end if;
  return null;
end $fn$;
drop trigger if exists green_wall on wall;
create trigger green_wall after insert or update of needed, material or delete on wall
  for each row execute function green_wall_trigger();

/** A slab poured is bare from now; one struck forgets. */
create or replace function green_slab_trigger() returns trigger language plpgsql as $fn$
begin
  if tg_op = 'DELETE' then
    perform green_forget(old.world_id, 'slab', old.x, old.y, 0);
    return null;
  end if;
  if bill_done(new.needed) and (tg_op = 'INSERT' or not bill_done(old.needed)) then
    perform green_mark(new.world_id, 'slab', new.x, new.y, 0);
  end if;
  return null;
end $fn$;
drop trigger if exists green_slab on foundation;
create trigger green_slab after insert or update of needed or delete on foundation
  for each row execute function green_slab_trigger();

/** A stone arch whose last span is decked is bare from now. */
create or replace function green_span_trigger() returns trigger language plpgsql as $fn$
declare b bridge;
begin
  if span_done(new.needed) and not span_done(old.needed)
     and not exists (select 1 from bridge_span s where s.world_id = new.world_id and s.bridge = new.bridge
                       and not span_done(s.needed)) then
    select * into b from bridge where world_id = new.world_id and id = new.bridge;
    if b.kind = 'stone' then perform green_mark(b.world_id, 'bridge', b.ax, b.ay, b.id); end if;
  end if;
  return null;
end $fn$;
drop trigger if exists green_span on bridge_span;
create trigger green_span after update of needed on bridge_span
  for each row execute function green_span_trigger();

/** A bridge pulled down, or a piece taken up, forgets when it began. */
create or replace function green_gone_trigger() returns trigger language plpgsql as $fn$
begin
  if tg_table_name = 'bridge' then perform green_forget(old.world_id, 'bridge', old.ax, old.ay, old.id);
  else perform green_forget(old.world_id, 'piece', old.x, old.y, old.id);
  end if;
  return null;
end $fn$;
drop trigger if exists green_bridge_gone on bridge;
create trigger green_bridge_gone after delete on bridge for each row execute function green_gone_trigger();
drop trigger if exists green_piece_gone on placed;
create trigger green_piece_gone after delete on placed for each row when (old.kind = 'furniture')
  execute function green_gone_trigger();

/** Paving laid is bare stone from now; paving lifted forgets when it was laid. */
create or replace function green_paving(p_world uuid, p_x int, p_y int, p_was int, p_to int) returns void
language plpgsql as $fn$
begin
  if coalesce((select d.paved from tile_def d where d.id = p_to), false) then
    perform green_mark(p_world, 'paving', p_x, p_y, 0);
  elsif coalesce((select d.paved from tile_def d where d.id = p_was), false) then
    perform green_forget(p_world, 'paving', p_x, p_y, 0);
  end if;
end $fn$;

CREATE OR REPLACE FUNCTION public.land_set_tile(p_world uuid, p_x integer, p_y integer, p_v integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_was int := land_tile(p_world, p_x, p_y); v_to int := greatest(0, least(255, p_v));
begin
  update land_tile t set tiles = set_byte(t.tiles, p_x, v_to)
  where t.world_id = p_world and t.y = p_y;
  -- A tile that stops being a tree forgets its notch, here, at the one door
  -- every tile change goes through.
  delete from tree_notch n where n.world_id = p_world and n.x = p_x and n.y = p_y and p_v <> 16;
  -- And paving going down is bare stone from now, and paving coming up
  -- forgets when it went down (`green_paving`), at the same door.
  if v_to is distinct from v_was then perform green_paving(p_world, p_x, p_y, v_was, v_to); end if;
  perform land_chunk_forget(p_world, p_x, p_y);
end $function$;

/* ---- Clear the ivy, and Scrub the moss --------------------------------------------------------- */

create or replace function green_action(p_action text) returns boolean language sql immutable as $fn$
  select p_action in ('clear_ivy', 'scrub_moss')
$fn$;

/**
 * Why a clearing cannot be done (`greenRefusal`), in the browser's order:
 * what is there, how far off it is, the tool, whose it is, and whether
 * anything has grown. It answers for its own reach, since a statue and a
 * bridge are not tiles.
 */
create or replace function green_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns text
language plpgsql stable as $fn$
declare p player; d action_def; v_from timestamptz; tx int; ty int; v_days int := 0; v_found boolean := false;
        v_side text; pc placed; br bridge; v_name text;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  select * into d from action_def where id = p_action;
  select w.green_from into v_from from world w where w.id = p_world;
  if p_action = 'clear_ivy' then
    v_side := p_target->>'side';
    if p_target->>'kind' is distinct from 'tile' or v_side is null then return 'Choose a side.'; end if;
    tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
    -- Every storey's wall on that border: a house is cleared a side at a time, top to bottom.
    select coalesce(max(green_days(green_start(g.since, v_from))), 0), count(*) > 0 into v_days, v_found
      from border_of(tx, ty, v_side) bo
      join wall wl on wl.world_id = p_world and wl.dir = bo.dir and wl.x = bo.x and wl.y = bo.y
      join build_material_def m on m.id = wl.material and m.kind = 'stone'
      left join green_since g on g.world_id = p_world and g.thing = 'wall' and g.x = wl.x and g.y = wl.y
                             and g.k = green_wall_k(wl.level, wl.dir)
     where bill_done(wl.needed);
    if not v_found then return 'There is no finished wall of stone or brick there.'; end if;
  elsif p_target->>'kind' = 'tile' then
    tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
    if coalesce((select td.paved from tile_def td where td.id = land_tile(p_world, tx, ty)), false) then
      v_found := true;
      v_days := green_days(green_start((select g.since from green_since g where g.world_id = p_world
                  and g.thing = 'paving' and g.x = tx and g.y = ty and g.k = 0), v_from));
    end if;
    if (slab_at(p_world, tx, ty)).id is not null then
      v_found := true;
      v_days := greatest(v_days, green_days(green_start((select g.since from green_since g where g.world_id = p_world
                  and g.thing = 'slab' and g.x = tx and g.y = ty and g.k = 0), v_from)));
    end if;
    if not v_found then return 'There is no paving or poured foundation here.'; end if;
  elsif p_target->>'kind' = 'furniture' then
    pc := target_placed(p_world, p_target);
    if pc.id is null or pc.kind is distinct from 'furniture'
       or not coalesce((select f.mossy from furniture_def f where f.id = pc.sub), false) then
      return 'No moss grows on that.';
    end if;
    tx := pc.x; ty := pc.y;
    v_days := green_days(green_start(greatest(pc.made_at, (select g.since from green_since g where g.world_id = p_world
                and g.thing = 'piece' and g.x = pc.x and g.y = pc.y and g.k = pc.id)), v_from));
  elsif p_target->>'kind' = 'bridge' then
    select * into br from bridge b where b.world_id = p_world and b.id = (p_target->>'id')::bigint;
    if br.id is null or br.kind is distinct from 'stone'
       or exists (select 1 from bridge_span s where s.world_id = p_world and s.bridge = br.id and not span_done(s.needed)) then
      return 'No moss grows on that.';
    end if;
    tx := br.ax; ty := br.ay;
    v_days := green_days(green_start((select g.since from green_since g where g.world_id = p_world
                and g.thing = 'bridge' and g.x = br.ax and g.y = br.ay and g.k = br.id), v_from));
  else
    return 'No moss grows on that.';
  end if;
  if not in_reach(p.x, p.y, jsonb_build_object('x', tx, 'y', ty), false, d.range) then
    return 'You are too far away from that.';
  end if;
  if tool_ql(p_world, p_uid, d.tool) <= 0 then
    return 'You need a ' || lower((select coalesce(i.name, d.tool) from item_def i where i.id = d.tool))
        || ' to ' || lower(d.label) || '.';
  end if;
  -- Somebody else's garden is not yours to strip, and a guest of yours is a guest (`may_shape`).
  select dd.name into v_name from deed_covering(p_world, tx, ty) dd
   where not may_shape(p_world, p_uid, tx, ty) order by dd.founded_at limit 1;
  if v_name is not null then
    return 'That is part of ' || v_name || '. Only its builders may ' || lower(d.label) || ' there.';
  end if;
  if v_days <= 0 then return green_nothing_yet(); end if;
  return null;
end $fn$;

/** Bare stone again from now, and said so (`GREEN_ACTIONS`). */
create or replace function perform_green(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns void
language plpgsql as $fn$
declare tx int; ty int; v_side text; pc placed; br bridge; v_paved boolean; v_slab boolean;
begin
  if green_refusal(p_world, p_uid, p_action, p_target) is not null then return; end if;
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  if p_action = 'clear_ivy' then
    v_side := p_target->>'side';
    insert into green_since (world_id, thing, x, y, k, since)
      select p_world, 'wall', wl.x, wl.y, green_wall_k(wl.level, wl.dir), now()
        from border_of(tx, ty, v_side) bo
        join wall wl on wl.world_id = p_world and wl.dir = bo.dir and wl.x = bo.x and wl.y = bo.y
        join build_material_def m on m.id = wl.material and m.kind = 'stone'
       where bill_done(wl.needed)
    on conflict (world_id, thing, x, y, k) do update set since = excluded.since;
    perform tell(p_world, p_uid, 'You clear the ivy off the ' || side_name(v_side) || ' wall. ' || green_again(), 'event');
    return;
  end if;
  if p_target->>'kind' = 'tile' then
    v_paved := coalesce((select td.paved from tile_def td where td.id = land_tile(p_world, tx, ty)), false);
    v_slab := (slab_at(p_world, tx, ty)).id is not null;
    if v_paved then perform green_mark(p_world, 'paving', tx, ty, 0); end if;
    if v_slab then perform green_mark(p_world, 'slab', tx, ty, 0); end if;
    perform tell(p_world, p_uid, 'You scrub the moss off '
      || case when v_paved and v_slab then 'the paving and the foundation' when v_paved then 'the paving' else 'the foundation' end
      || '. ' || green_again(), 'event');
  elsif p_target->>'kind' = 'furniture' then
    pc := target_placed(p_world, p_target);
    perform green_mark(p_world, 'piece', pc.x, pc.y, pc.id);
    perform tell(p_world, p_uid, 'You scrub the moss off the '
      || lower((select f.name from furniture_def f where f.id = pc.sub)) || '. ' || green_again(), 'event');
  else
    select * into br from bridge b where b.world_id = p_world and b.id = (p_target->>'id')::bigint;
    perform green_mark(p_world, 'bridge', br.ax, br.ay, br.id);
    perform tell(p_world, p_uid, 'You scrub the moss off the bridge. ' || green_again(), 'event');
  end if;
end $fn$;

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

CREATE OR REPLACE FUNCTION public.rpc_ground(p_world uuid, p_range double precision DEFAULT 40, p_slow boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player;
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
  if p_slow then perform crops_settle(p_world, p.x, p.y, p_range); end if;
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
     * `ago` rather than `stage_at`: the browser counts in its own seconds and
     * has no use for the hour this island stamped on it.
     */
    'crops', coalesce((select jsonb_agg(jsonb_build_object(
        'x', c.x, 'y', c.y, 'id', c.id, 'stage', c.stage,
        'ago', extract(epoch from (now() - c.stage_at)),
        'tended', c.tended, 'tendedNow', c.tended_now, 'ql', c.ql, 'pace', c.pace))
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
