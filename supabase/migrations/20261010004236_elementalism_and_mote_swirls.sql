/*
 * Elementalism, and the mote swirls it is learned from (`src/game/motes.ts`).
 *
 *   * `mote_swirl` is the day's swirls: a row each, a tile and an element.
 *     Nobody holds one and nothing moves one; it is there until it is
 *     collected or the next turn of the woods takes it. One to a tile.
 *   * `swirl_day` takes an island's swirls away and puts `swirls_a_day()` new
 *     ones down, at tiles drawn evenly over the whole map in up to
 *     `swirl_tries()` rounds: never where a tree stands (a tile that blocks),
 *     never inside a building. On water a swirl is water; on land it is dark
 *     at `swirl_dark()`, light at `swirl_light()`, and otherwise the element of
 *     the island of the chart it is on (`region_element` of `region_at`, the
 *     lookup the monsters and the treeless tundra already use), fixed for the
 *     island and the same on every world. `tree_tick` runs it after `tree_day`, so
 *     the swirls turn over with the woods, once a day at dawn; and an island
 *     that has never had any (`mote_day`) has the day's the first time
 *     anybody asks for them, rather than at its next dawn.
 *   * Collect motes (`collect_motes`) asks `swirl_refusal` -- the ground, the
 *     map, arm's reach, and whether the swirl is still there -- and
 *     `perform_swirl` asks it again at the end of the go, takes the row, and
 *     gives `motes_for` the collector's Elementalism of that element's mote
 *     before the go trains it. Two people at one swirl: the delete is the
 *     decider, and whoever's go ends second is told it is gone.
 *   * A browser reads the swirls of the nine blocks round it (`rpc_swirls`)
 *     and hears of a swirl collected, and of a new day's, on the block's
 *     `land` topic: `{ swirls: { gone: [id] } }` and `{ swirls: 'day' }`.
 *   * Examine says a swirl is there (`ground_says`), in the browser's words.
 *
 * `supabase/test/motes.ts` holds the two sides to each other.
 */
set local lock_timeout = '3s';

create table if not exists mote_swirl (
  world_id uuid not null references world on delete cascade,
  id bigint generated always as identity,
  x int not null,
  y int not null,
  /** One of `mote_elements()`. */
  element text not null,
  /** The block of country it is in (`region_of`), for the nine round a body. */
  region int not null,
  primary key (world_id, id),
  unique (world_id, x, y)
);
create index if not exists mote_swirl_region on mote_swirl (world_id, region);
alter table mote_swirl enable row level security;
revoke all on mote_swirl from anon, authenticated;

/* When each island's swirls were last put down: an island with no row has never had any. */
create table if not exists mote_day (
  world_id uuid primary key references world on delete cascade,
  laid_at timestamptz not null default now()
);
alter table mote_day enable row level security;
revoke all on mote_day from anon, authenticated;

/* ---- The rules, the browser's own ---------------------------------------------------------------- */

/** What a swirl gives at Elementalism `p_skill`, before the go trains it: the browser's `motesFor`. */
create or replace function motes_for(p_skill double precision) returns int language sql immutable as $$
  select least(motes_most(), motes_least() + floor(greatest(0, p_skill) / motes_step()))::int
$$;

/**
 * What a swirl put down is: water on water, then dark, then light, then the
 * land's own -- and nothing on land that is no island's (`swirlElement`).
 */
create or replace function swirl_element(p_water boolean, p_land text, p_roll double precision) returns text
  language sql immutable as $$
  select case when p_water then 'water'
              when p_land is null then null
              when p_roll < swirl_dark() then 'dark'
              when p_roll < swirl_dark() + swirl_light() then 'light'
              else p_land end
$$;

/** "a fire mote", "three ice motes": the browser's `motesWord`. */
create or replace function motes_word(p_n int, p_element text) returns text language sql stable as $$
  select case when p_n = 1 then case when p_element ~ '^[aeiou]' then 'an ' else 'a ' end || p_element || ' mote'
              else number_word(p_n) || ' ' || p_element || ' motes' end
$$;

create or replace function swirl_action(p_action text) returns boolean language sql immutable as $$
  select p_action = 'collect_motes'
$$;

/* ---- A day's swirls ------------------------------------------------------------------------------ */

/**
 * Yesterday's swirls gone and the day's put down (`laySwirls` in the browser).
 *
 * Each round draws `swirl_draws()` tiles for each one still wanted, keeps the
 * first drawn of those with room up to what is wanted, and reads what it needs
 * of each in one statement: the tile's byte and its four corners, out of the
 * rows they lie in. A row of the land is read once for every tile drawn on
 * it, and at five hundred tiles over four thousand lines that is nearly one
 * row each: a few thousand rows read, against the millions a day in the woods
 * reads. Water is the browser's `hasWater`: a corner under the sea, a pond, or
 * a pool.
 */
create or replace function swirl_day(p_world uuid) returns int language plpgsql as $fn$
declare w world; v_want int := swirls_a_day()::int; v_n int := 0; v_k int; v_round int := 0; v_block int;
begin
  select * into w from world where id = p_world;
  if not found or not w.ready then return 0; end if;
  -- One at a time for an island: a first read and the dawn could otherwise both put a day down.
  perform pg_advisory_xact_lock(hashtext('swirl_day:' || p_world::text)::bigint);
  delete from mote_swirl where world_id = p_world;
  while v_n < v_want and v_round < swirl_tries() loop
    v_round := v_round + 1;
    insert into mote_swirl (world_id, x, y, element, region)
    select p_world, o.x, o.y, o.element, region_of(o.x, o.y)
      from (
       select e.x, e.y, e.element from (
        select s.x, s.y, s.k,
               swirl_element(
                 s.low < 0
                 or exists (select 1 from spring_tile st where st.world_id = p_world and st.x = s.x and st.y = s.y)
                 or exists (select 1 from foundation fo where fo.world_id = p_world and fo.x = s.x and fo.y = s.y and fo.pool),
                 -- The island of the chart the tile's middle is on (`chartRegion` in the browser).
                 region_element(region_at(p_world, s.x + 0.5, s.y + 0.5)),
                 random()) as element
          from (
            select c.x, c.y, c.k, get_byte(t.tiles, c.x) as tile,
                   least(b_i16(h0.heights, c.x), b_i16(h0.heights, c.x + 1),
                         b_i16(h1.heights, c.x + 1), b_i16(h1.heights, c.x)) as low
              from (select distinct on (q.x, q.y) q.x, q.y, q.k
                      from (select floor(random() * w.size)::int as x, floor(random() * w.size)::int as y, g.k
                              from generate_series(1, (v_want - v_n) * swirl_draws()::int) g(k)) q) c
              join land_tile t on t.world_id = p_world and t.y = c.y
              join land_corner h0 on h0.world_id = p_world and h0.y = c.y
              join land_corner h1 on h1.world_id = p_world and h1.y = c.y + 1) s
         where not coalesce((select d.blocks from tile_def d where d.id = s.tile), false)
           and not exists (select 1 from building_tile b where b.world_id = p_world and b.x = s.x and b.y = s.y)
           and not exists (select 1 from mote_swirl m where m.world_id = p_world and m.x = s.x and m.y = s.y)
       ) e
       -- Land that is no island's takes no swirl. The chart gives every cell to one, so none is passed over here.
       where e.element is not null
       -- The first drawn of those with room, as many as are still wanted.
       order by e.k
       limit v_want - v_n
      ) o
    on conflict (world_id, x, y) do nothing;
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end loop;
  insert into mote_day (world_id, laid_at) values (p_world, now())
    on conflict (world_id) do update set laid_at = excluded.laid_at;
  -- And everybody about told to read them again: a word to each block somebody stands in.
  for v_block in
    select distinct region_of(floor(p.x)::int, floor(p.y)::int) from player p where p.world_id = p_world and not p.away
  loop
    perform private.send('land:' || p_world || ':' || v_block, 'land', jsonb_build_object('swirls', 'day'));
  end loop;
  return v_n;
end $fn$;

/** The day's swirls for an island that has never had any; nothing for one that has. */
create or replace function swirls_owed(p_world uuid) returns void language plpgsql as $fn$
begin
  if exists (select 1 from mote_day d where d.world_id = p_world) then return; end if;
  perform pg_advisory_xact_lock(hashtext('swirl_day:' || p_world::text)::bigint);
  -- Asked again behind the lock: whoever held it may have put them down.
  if exists (select 1 from mote_day d where d.world_id = p_world) then return; end if;
  perform swirl_day(p_world);
end $fn$;

/* ---- Collecting one ------------------------------------------------------------------------------ */

/**
 * Why a swirl cannot be collected, or null when it can: the browser's
 * `swirlRefusal`, word for word and in the same order, with the reach in it
 * because this family answers for its own.
 */
create or replace function swirl_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns text
  language plpgsql stable as $fn$
declare d action_def; p player; tx int; ty int;
begin
  select * into d from action_def where id = p_action;
  select * into p from player where world_id = p_world and uid = p_uid;
  if p_target->>'kind' is distinct from 'tile' then return swirl_said('ground'); end if;
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  if not in_bounds(p_world, tx, ty) then return swirl_said('nothing'); end if;
  if not in_reach(p.x, p.y, p_target, false, d.range) then return 'You are too far away from that.'; end if;
  if not exists (select 1 from mote_swirl m where m.world_id = p_world and m.x = tx and m.y = ty) then
    return swirl_said('gone');
  end if;
  return null;
end $fn$;

/** Said to the block a swirl was in, that it has gone, while anybody is near enough to be listening. */
create or replace function swirl_gone(p_world uuid, p_x int, p_y int, p_id bigint) returns void language plpgsql as $fn$
declare v_size int := region_size()::int;
begin
  if not exists (select 1 from player p
                  where p.world_id = p_world and not p.away
                    and abs(floor(p.x / v_size)::int - p_x / v_size) <= 1
                    and abs(floor(p.y / v_size)::int - p_y / v_size) <= 1) then
    return;
  end if;
  perform private.send('land:' || p_world || ':' || region_of(p_x, p_y), 'land',
    jsonb_build_object('swirls', jsonb_build_object('gone', jsonb_build_array(p_id))));
end $fn$;

/**
 * The swirl taken, and its motes given: `motes_for` the Elementalism you had
 * before the go, at your Elementalism's quality, and a full go of it. Asked
 * again first, since a go takes seconds and somebody else may have finished
 * theirs: the delete decides, and a go that finds nothing is a go that missed.
 */
create or replace function perform_swirl(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns void
  language plpgsql as $fn$
declare tx int := (p_target->>'x')::int; ty int := (p_target->>'y')::int; v_why text; s mote_swirl; v_n int; v_skill double precision;
begin
  v_why := swirl_refusal(p_world, p_uid, p_action, p_target);
  if v_why is null then
    delete from mote_swirl m where m.world_id = p_world and m.x = tx and m.y = ty returning m.* into s;
  end if;
  if s.id is null then
    perform skill_raise(p_world, p_uid, elementalism_skill(), try_gain(false));
    perform tell(p_world, p_uid, coalesce(v_why, swirl_said('gone')), 'error');
    return;
  end if;
  v_skill := skill_of(p_world, p_uid, elementalism_skill());
  v_n := motes_for(v_skill);
  perform gather(p_world, p_uid, s.element || '_mote', v_n, product_ql(v_skill));
  perform skill_raise(p_world, p_uid, elementalism_skill(), 1);
  perform tell(p_world, p_uid, 'You collect ' || motes_word(v_n, s.element) || ' from the swirl, and it is gone.', 'event');
  perform swirl_gone(p_world, s.x, s.y, s.id);
end $fn$;

/* ---- Reading them -------------------------------------------------------------------------------- */

/** The swirls in the nine blocks round you, as the browser's `swirlIn` reads them. */
create or replace function rpc_swirls(p_world uuid) returns jsonb
  language plpgsql security definer set search_path = public as $fn$
declare me uuid := auth.uid(); p player; v_size int := region_size()::int; v_bx int; v_by int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  perform swirls_owed(p_world);
  v_bx := floor(p.x / v_size)::int;
  v_by := floor(p.y / v_size)::int;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'x', m.x, 'y', m.y, 'element', m.element) order by m.id)
      from mote_swirl m
     where m.world_id = p_world
       and m.region = any (array(select (v_by + dj) * 1024 + (v_bx + di)
                                   from generate_series(-1, 1) di, generate_series(-1, 1) dj
                                  where v_bx + di >= 0 and v_by + dj >= 0))), '[]'::jsonb);
end $fn$;

/* ---- Where the rest of the island hears of them -------------------------------------------------- */

-- Collect motes is a family of its own, beside the wildflowers.
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
      -- Collecting a mote swirl (`motes.ts`).
      or swirl_action(p_action)
      or green_action(p_action)
      or water_garden_action(p_action)
      -- gates: raising and lowering a portcullis and a drawbridge.
      or gate_action(p_action)
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
  -- And a mote swirl for its own reach, and whether it is still there (`motes.ts`).
  if swirl_action(p_action) then
    return swirl_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Ivy and moss answer for their own reach: a statue and a bridge are not tiles.
  if green_action(p_action) then
    return green_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Stepping stones and water plants answer for their own reach, as a spring does.
  if water_garden_action(p_action) then
    return water_garden_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- gates: a portcullis and a drawbridge answer for their own reach: a side of a tile, and the tile at a winch.
  if gate_action(p_action) then
    return gate_refusal(p_world, p_uid, p_action, p_target);
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
  -- Collecting a mote swirl (`motes.ts`).
  if swirl_action(p_action) then
    perform perform_swirl(p_world, p_uid, p_action, p_target);
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
  -- gates: raising and lowering a portcullis and a drawbridge.
  if gate_action(p_action) then
    perform perform_gate(p_world, p_uid, p_action, p_target);
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

/* ---- At dawn, and on Examine ------------------------------------------------------------------- */

CREATE OR REPLACE FUNCTION public.tree_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare v_world uuid; v_grew int := 0;
begin
  if not pg_try_advisory_lock(hashtext('tree_tick')::bigint) then
    return jsonb_build_object('isles', 0, 'busy', true);
  end if;
  -- One island a go, whichever is owed, drawn at random so that an island
  -- which cannot finish is not first in the queue every time.
  select id into v_world from world
   where ready and trees_at < tree_last_dawn()
   order by random() limit 1;
  if v_world is not null then
    v_grew := tree_day(v_world);
    -- And the day's mote swirls in place of yesterday's, after the woods (`swirl_day`).
    perform swirl_day(v_world);
  end if;
  perform pg_advisory_unlock(hashtext('tree_tick')::bigint);
  return jsonb_build_object('isles', case when v_world is null then 0 else 1 end, 'grew', v_grew);
end $function$;

/** What Examine says of the ground itself: the browser's `groundSays`, now with a swirl over it in it. */
create or replace function ground_says(p_world uuid, p_x int, p_y int, p_at timestamptz default now()) returns text
  language plpgsql stable as $fn$
declare v_t int; v_d int; v_worn int; v_was text; v_n int; v_said text := ''; v_swirl text;
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
  -- And a mote swirl turning over it (`swirlSays`).
  select m.element into v_swirl from mote_swirl m where m.world_id = p_world and m.x = p_x and m.y = p_y;
  if v_swirl is not null then
    v_said := v_said || ' ' || case when v_swirl ~ '^[aeiou]' then 'An' else 'A' end || ' ' || v_swirl
      || ' mote swirl turns over it until the next turn of the woods.';
  end if;
  return v_said;
end $fn$;

select private.lock_doors();
