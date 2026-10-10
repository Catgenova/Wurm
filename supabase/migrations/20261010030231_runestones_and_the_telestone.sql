/*
 * The five Runestones, and the Telestone that takes you to them (`src/game/runestones.ts`).
 *
 *   * `runestones()` (generated) is where each stone stands on the chart's own
 *     4096 island; `runestone_centres` lays them over a world of any size from
 *     `stone_least` up by scale, as `region_at` lays the chart, a tile in from
 *     the edge, and
 *     `runestone_on` / `runestone_at` say which stone stands on a tile. They
 *     are the same five places on every island, and are not rows anybody can
 *     change: nothing is stored for them.
 *   * A stone's nine tiles refuse every job that changes the ground or puts
 *     something on it (`stone_guarded`, generated), asked once in the
 *     dispatcher (`stone_ground_refusal`) on the tiles the job works
 *     (`stone_job_tiles`): a corner's four, a tile, the tile at your feet, and
 *     every tile between a bridge's or an aqueduct's two ends. Nobody walks
 *     into one (`walk_share`), nothing wild does (`creature_tile_ok`,
 *     `line_clear`), a worker plants nothing on one (`plantable_tile`), no
 *     mote swirl is put down on one (`swirl_day`), and Examine names it
 *     (`ground_says`).
 *   * Travel to a Runestone (`travel_runestone`) on a Telestone in your pack
 *     asks `telestone_refusal` -- the Telestone, the stone, another job in
 *     hand, a fight, a cart or a hull or a mount, a companion, swimming, a
 *     load too heavy to walk with, the reach, the wait, room to arrive -- and
 *     `perform_telestone` asks it again, puts the body on the first free tile
 *     of `landing_ring` round the stone (`telestone_landing`), starts the
 *     traveller's wait in `telestone_journey`, and tells the browser where
 *     the body went as a keeper's move does.
 *   * `rpc_move` leaves a body where a journey put it for `telestone_grace`
 *     seconds against a word claiming the old ground.
 *
 * `supabase/test/telestone.ts` holds the two sides to each other.
 */
set local lock_timeout = '3s';

/* When each traveller made their last journey by Telestone, and when they may make the next. One row a body. */
create table if not exists telestone_journey (
  world_id uuid not null references world on delete cascade,
  uid uuid not null,
  used_at timestamptz not null,
  until timestamptz not null,
  primary key (world_id, uid)
);
alter table telestone_journey enable row level security;
revoke all on telestone_journey from anon, authenticated;

/* ---- Where they stand -------------------------------------------------------------------------- */

/**
 * Each stone's centre tile on a world `p_size` across: the browser's
 * `stoneCentre`, term for term. None on a world under `stone_least`, as the
 * browser's `hasRunestones` has it: a test's island of sixteen or sixty-four
 * tiles would be mostly stone.
 */
create or replace function runestone_centres(p_size int) returns table (ord int, id text, name text, x int, y int)
  language sql immutable as $$
  select r.ord, r.id, r.name,
         least(p_size - 1 - stone_half()::int, greatest(stone_half()::int, floor((r.x + 0.5)::double precision * p_size / stone_chart())::int)),
         least(p_size - 1 - stone_half()::int, greatest(stone_half()::int, floor((r.y + 0.5)::double precision * p_size / stone_chart())::int))
    from runestones() r
   where p_size >= stone_least()
$$;

/** The stone standing on a tile of a world `p_size` across, by id, or null: the browser's `runestoneAt`. */
create or replace function runestone_on(p_size int, p_x int, p_y int) returns text language sql immutable as $$
  select c.id from runestone_centres(p_size) c
   where abs(p_x - c.x) <= stone_half() and abs(p_y - c.y) <= stone_half()
   order by c.ord limit 1
$$;

/** The same, on an island. */
create or replace function runestone_at(p_world uuid, p_x int, p_y int) returns text language sql stable as $$
  select runestone_on(w.size, p_x, p_y) from world w where w.id = p_world
$$;

/** Whether any stone's tiles come within the box from (`p_x0`, `p_y0`) to (`p_x1`, `p_y1`): one ask before a walk asks tile by tile. */
create or replace function runestone_near(p_size int, p_x0 double precision, p_y0 double precision,
                                          p_x1 double precision, p_y1 double precision) returns boolean
  language sql immutable as $$
  select exists (select 1 from runestone_centres(p_size) c
                  where c.x + stone_half() >= floor(p_x0) and c.x - stone_half() <= floor(p_x1)
                    and c.y + stone_half() >= floor(p_y0) and c.y - stone_half() <= floor(p_y1))
$$;

/** A stone's name, by id. */
create or replace function runestone_name(p_id text) returns text language sql immutable as $$
  select r.name from runestones() r where r.id = p_id
$$;

/* ---- Its ground -------------------------------------------------------------------------------- */

/**
 * The tiles a job works or puts something on, the browser's `stoneJobTiles`:
 * for a job aimed at something in your pack the tile at your feet, or the
 * four round the corner nearest you for a spadeful dropped there; for a
 * bridge every tile between you and where it is thrown, and for an aqueduct
 * every tile between its head and where it pours; a corner's four; a tile.
 * In the browser's order, a row at a time.
 */
create or replace function stone_job_tiles(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns table (x int, y int) language plpgsql stable as $fn$
declare d action_def; p player; v_cx int; v_cy int; v_x0 int; v_y0 int; v_x1 int; v_y1 int;
begin
  select * into d from action_def where id = p_action;
  select * into p from player where world_id = p_world and uid = p_uid;
  if p.uid is null then return; end if;
  if p_target->>'kind' is distinct from 'tile' then
    if p_action = 'drop_dirt_here' then
      v_cx := round(p.x)::int; v_cy := round(p.y)::int;
      return query select gx, gy from generate_series(v_cy - 1, v_cy) gy, generate_series(v_cx - 1, v_cx) gx order by gy, gx;
      return;
    end if;
    return query select floor(p.x)::int, floor(p.y)::int;
    return;
  end if;
  v_x1 := (p_target->>'x')::int; v_y1 := (p_target->>'y')::int;
  if p_action = 'plan_bridge' then
    v_x0 := floor(p.x)::int; v_y0 := floor(p.y)::int;
  elsif p_action = 'plan_aqueduct' then
    if jsonb_typeof(p_target->'head') = 'array' then
      v_x0 := (p_target->'head'->>0)::int; v_y0 := (p_target->'head'->>1)::int;
    else
      v_x0 := v_x1; v_y0 := v_y1;
    end if;
  elsif coalesce(d.corner, false) then
    v_cx := (p_target->>'cx')::int; v_cy := (p_target->>'cy')::int;
    return query select gx, gy from generate_series(v_cy - 1, v_cy) gy, generate_series(v_cx - 1, v_cx) gx order by gy, gx;
    return;
  else
    v_x0 := v_x1; v_y0 := v_y1;
  end if;
  return query select gx, gy from generate_series(least(v_y0, v_y1), greatest(v_y0, v_y1)) gy,
                                  generate_series(least(v_x0, v_x1), greatest(v_x0, v_x1)) gx
                order by gy, gx;
end $fn$;

/** Why a job will not be done on a stone's ground, or null: the browser's `stoneGroundRefusal`, in its words. */
create or replace function stone_ground_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns text
  language plpgsql stable as $fn$
declare v_size int; v_id text;
begin
  if not stone_guarded(p_action) then return null; end if;
  select w.size into v_size from world w where w.id = p_world;
  select runestone_on(v_size, t.x, t.y) into v_id
    from stone_job_tiles(p_world, p_uid, p_action, p_target) with ordinality t(x, y, o)
   where runestone_on(v_size, t.x, t.y) is not null
   order by t.o limit 1;
  if v_id is null then return null; end if;
  return 'That is the ground of ' || runestone_name(v_id) || '. Nothing can be dug, built, planted or set down on it.';
end $fn$;

/* ---- The Telestone ----------------------------------------------------------------------------- */

/** How far a Telestone of quality `p_ql` reaches, in tiles: the browser's `telestoneRange`. */
create or replace function telestone_range(p_ql double precision) returns double precision language sql immutable as $$
  select telestone_near() + (least(tele_ql_high(), greatest(tele_ql_low(), p_ql)) - tele_ql_low())
         * (telestone_far() - telestone_near()) / (tele_ql_high() - tele_ql_low())
$$;

/** How long a journey on one makes you wait, in seconds: the browser's `telestoneRest`. */
create or replace function telestone_rest(p_ql double precision) returns double precision language sql immutable as $$
  select telestone_slow() - (least(tele_ql_high(), greatest(tele_ql_low(), p_ql)) - tele_ql_low())
         * (telestone_slow() - telestone_fast()) / (tele_ql_high() - tele_ql_low())
$$;

/** Seconds until this traveller may make another journey: nought when they may (`telestoneWait`). */
create or replace function telestone_wait(p_world uuid, p_uid uuid) returns double precision language sql stable as $$
  select greatest(0, coalesce((select extract(epoch from (t.until - now()))::double precision
                                 from telestone_journey t where t.world_id = p_world and t.uid = p_uid), 0))
$$;

/**
 * Where a traveller arrives beside a stone, the browser's `landingTile`: the
 * first of `landing_ring` on the map that a body can stand on, no stone's,
 * dry, no steeper than `landing_stand` and under no building. None when
 * there is none.
 */
create or replace function telestone_landing(p_world uuid, p_stone text) returns table (x int, y int)
  language sql stable as $$
  select c.x + r.dx, c.y + r.dy
    from world w
    cross join lateral runestone_centres(w.size) c
    cross join landing_ring() r
   where w.id = p_world and c.id = p_stone
     and passable(p_world, c.x + r.dx, c.y + r.dy)
     and runestone_on(w.size, c.x + r.dx, c.y + r.dy) is null
     and not has_water(p_world, c.x + r.dx, c.y + r.dy)
     and tile_slope(p_world, c.x + r.dx, c.y + r.dy) <= landing_stand()
     and building_at(p_world, c.x + r.dx, c.y + r.dy) is null
   order by r.k
   limit 1
$$;

/**
 * Why this journey will not be made, or null when it will: the browser's
 * `telestoneRefusal`, word for word and in the same order. A journey already
 * in hand is not another job: it is this one, asked again as it is made.
 */
create or replace function telestone_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns text
  language plpgsql stable as $fn$
declare p player; w world; v_ql double precision; s record; v_d double precision; v_reach double precision;
        v_wait double precision; v_pet text;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  select * into w from world where id = p_world;
  if p_target->>'kind' is distinct from 'item' then return telestone_said('item'); end if;
  select i.ql into v_ql from item i
   where i.id = target_item(p_target) and i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
     and i.def = telestone_item();
  if v_ql is null then return telestone_said('item'); end if;
  if w.size < stone_least() then return telestone_said('nowhere'); end if;
  select c.* into s from runestone_centres(w.size) c where c.id = p_target->>'stone';
  if s.id is null then return telestone_said('stone'); end if;
  if p.act is not null and p.act <> telestone_action() then return telestone_said('busy'); end if;
  -- A fight: one in hand, or something wild and alive hunting you (`inAFight`).
  if is_fight(p.act) or exists (select 1 from creature c where c.world_id = p_world and c.hunting = p_uid
                                   and c.mode = 'wild' and c.health > 0) then
    return telestone_said('fight');
  end if;
  if exists (select 1 from placed q where q.world_id = p_world and (q.driver = p_uid or q.puller = p_uid)) then
    return telestone_said('driving');
  end if;
  if p.aboard is not null then return telestone_said('aboard'); end if;
  if exists (select 1 from creature c where c.world_id = p_world and c.rider = p_uid) then return telestone_said('mounted'); end if;
  select c.name into v_pet from creature c where c.world_id = p_world and c.keeper = p_uid and c.mode = 'active' order by c.id limit 1;
  if v_pet is not null then
    return v_pet || ' follows you and would be left behind. Send it to your deed or into a crate first.';
  end if;
  if in_deep_water(p_world, p_uid) then return telestone_said('swimming'); end if;
  if over_carry(p_world, p_uid) > carry_stop() then return telestone_said('heavy'); end if;
  v_d := sqrt(power(p.x - (s.x + 0.5), 2) + power(p.y - (s.y + 0.5), 2));
  v_reach := telestone_range(v_ql);
  if v_d > v_reach then
    return s.name || ' is ' || floor(v_d + 0.5)::bigint || ' tiles away. This Telestone reaches ' || floor(v_reach + 0.5)::bigint || '.';
  end if;
  v_wait := telestone_wait(p_world, p_uid);
  if v_wait > 0 then return 'You can travel by Telestone again in ' || time_words(v_wait) || '.'; end if;
  if not exists (select 1 from telestone_landing(p_world, s.id)) then
    return 'There is no free ground beside ' || s.name || ' to arrive on.';
  end if;
  return null;
end $fn$;

/**
 * The journey: asked again, the body put on the first free tile beside the
 * stone, the traveller's wait begun off the quality of the Telestone used,
 * and the browser told where the body went, as a keeper's move tells it, with
 * when the next journey may be made.
 */
create or replace function perform_telestone(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns void
  language plpgsql as $fn$
declare v_why text; w world; v_ql double precision; s record; v_lx int; v_ly int; v_rest double precision; v_until timestamptz;
begin
  v_why := telestone_refusal(p_world, p_uid, p_action, p_target);
  if v_why is not null then
    perform tell(p_world, p_uid, v_why, 'error');
    return;
  end if;
  select * into w from world where id = p_world;
  select i.ql into v_ql from item i where i.id = target_item(p_target) and i.world_id = p_world;
  select c.* into s from runestone_centres(w.size) c where c.id = p_target->>'stone';
  select l.x, l.y into v_lx, v_ly from telestone_landing(p_world, s.id) l;
  v_rest := telestone_rest(v_ql);
  v_until := now() + make_interval(secs => v_rest);
  update player set x = v_lx + 0.5, y = v_ly + 0.5, level = 0, moved_at = now(), seen_at = now(), away = false
   where world_id = p_world and uid = p_uid;
  insert into telestone_journey (world_id, uid, used_at, until) values (p_world, p_uid, now(), v_until)
    on conflict (world_id, uid) do update set used_at = excluded.used_at, until = excluded.until;
  perform tell(p_world, p_uid, 'You hold up the Telestone and are standing beside ' || s.name
    || '. You can travel by Telestone again in ' || time_words(v_rest) || '.', 'event');
  if private.here(p_world, p_uid) then
    perform private.send('own:' || p_world || ':' || p_uid, 'moved',
      jsonb_build_object('x', v_lx + 0.5, 'y', v_ly + 0.5, 'level', 0, 'until', extract(epoch from v_until)::double precision));
  end if;
end $fn$;

/* ---- Where the rest of the island hears of them -------------------------------------------------- */

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
      -- Travelling by Telestone to a Runestone (`runestones.ts`).
      or p_action = telestone_action()
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
  -- A Runestone's nine tiles, which no job changes or puts anything on, before whose ground it is (`stone_ground_refusal`).
  aimed := stone_ground_refusal(p_world, p_uid, p_action, p_target);
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
  -- And a journey by Telestone, which answers for everything it asks (`runestones.ts`).
  if p_action = telestone_action() then
    return telestone_refusal(p_world, p_uid, p_action, p_target);
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
  -- Travelling by Telestone to a Runestone (`runestones.ts`).
  if p_action = telestone_action() then
    perform perform_telestone(p_world, p_uid, p_action, p_target);
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
        there_tile int; here_tile int; lx0 int[]; ly0 int[]; lx1 int[]; ly1 int[]; lines int := 0; j int;
        v_piers boolean; v_step boolean;  -- Piers
        v_stones boolean;  -- Runestones
begin
  if p_level <> 0 then return 1; end if;
  far := sqrt(power(p_x1 - p_x0, 2) + power(p_y1 - p_y0, 2));
  if far <= 0.0001 then return 1; end if;
  -- Piers: and whether it has ever had a tile on piers (`world.piers`), off the same row.
  select w.size, w.piers into size, v_piers from world w where w.id = p_world;
  fx := floor(p_x0)::int; fy := floor(p_y0)::int;
  -- Runestones: whether the walk comes near one at all, asked once; a tile is asked about one only then (`runestone_on`).
  v_stones := runestone_near(size, least(p_x0, p_x1), least(p_y0, p_y1), greatest(p_x0, p_x1), greatest(p_y0, p_y1));
  -- Asked once for the island rather than once a tile. `bridge_at` is two
  -- index probes and a subquery, and on an island with no bridges on it at all
  -- — which is most of them, most of the time — it was the largest thing left
  -- in this loop once the ground came out of a square.
  spans := exists (select 1 from bridge b where b.world_id = p_world);
  -- The one tile nothing stands on, asked for once. A select per tile against
  -- a table of twenty rows is still a select per tile.
  select coalesce(array_agg(id), '{}') into walls from tile_def where blocks;
  -- An aqueduct's deck is water, and nobody starts a walk on it: the ground under it is the ground (`deck_at`).
  if spans and deck_at(p_world, fx, fy) is not null then return 1; end if;
  -- And the lines its aqueducts run along, read once: a step is asked about their piers only where it is on one of them.
  if spans then
    select array_agg(least(b.ax, b.bx)), array_agg(least(b.ay, b.by)), array_agg(greatest(b.ax, b.bx)), array_agg(greatest(b.ay, b.by))
      into lx0, ly0, lx1, ly1 from bridge b where b.world_id = p_world and b.kind = 'aqueduct';
    lines := coalesce(array_length(lx0, 1), 0);
  end if;

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
      -- Nobody walks into a Runestone, as nobody walks into a tree.
      if v_stones and runestone_on(size, tx, ty) is not null then return (i - 1)::double precision / n; end if;
      -- An aqueduct's piers stand between its tiles, along its run (`aqueduct_pier`).
      for j in 1 .. lines loop
        if greatest(fx, tx) >= lx0[j] and least(fx, tx) <= lx1[j] and greatest(fy, ty) >= ly0[j] and least(fy, ty) <= ly1[j] then
          if aqueduct_pier(p_world, fx, fy, tx, ty) then return (i - 1)::double precision / n; end if;
        end if;
      end loop;
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
      -- A bridge is walked as it always was, and lands on a deck as on a bank. An aqueduct's is no deck (`deck_at`).
      if v_piers and (not spans or (deck_at(p_world, tx, ty) is null and deck_at(p_world, fx, fy) is null)) then
        v_step := pier_step(p_world, fx, fy, tx, ty, climb, stand, there_tile, afloat or cart.id is not null or beast.id is not null);
        if v_step is not null then
          if not v_step then return (i - 1)::double precision / n; end if;
          fx := tx; fy := ty; here_tile := there_tile;
          continue;
        end if;
      end if;
      if not afloat and (not spans or deck_at(p_world, tx, ty) is null) then
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
         and (not spans or deck_at(p_world, tx, ty) is null) then
        there := chunk_centre(k, kx, ky, tx, ty, step);
        here := chunk_centre(k, kx, ky, fx, fy, step);
        if abs(there - here) > climb then return (i - 1)::double precision / n; end if;
      elsif abs(tx - fx) <= 1 and abs(ty - fy) <= 1
         and (not spans or deck_at(p_world, tx, ty) is null)
         and abs(centre_height(p_world, tx, ty) - centre_height(p_world, fx, fy)) > climb then
        return (i - 1)::double precision / n;
      end if;
      fx := tx; fy := ty; here_tile := there_tile;
    end if;
  end loop;
  return 1;
end $function$;

CREATE OR REPLACE FUNCTION public.creature_tile_ok(p_world uuid, p_x integer, p_y integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select p_x >= 0 and p_y >= 0 and p_x < q.size and p_y < q.size
     and not coalesce(q.blocks, true)
     -- Nor onto a Runestone (`runestone_on`).
     and runestone_on(q.size, p_x, p_y) is null
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
        v_stones boolean;  -- Runestones
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
  -- Runestones: whether the line comes near one at all, asked once (`runestone_near`).
  v_stones := runestone_near(size, least(p_x0, p_x1), least(p_y0, p_y1), greatest(p_x0, p_x1), greatest(p_y0, p_y1));
  n := greatest(1, ceil(2 * sqrt(power(p_x1 - p_x0, 2) + power(p_y1 - p_y0, 2)))::int);
  for i in 0..n loop
    t := i::double precision / n;
    tx := floor(p_x0 + (p_x1 - p_x0) * t)::int;
    ty := floor(p_y0 + (p_y1 - p_y0) * t)::int;
    -- `in_bounds`, which the square below cannot answer: a chunk at the edge is
    -- padded out to its full width, and a padded byte is not ground.
    if tx < 0 or ty < 0 or tx >= size or ty >= size then return false; end if;
    -- Nothing walks through a Runestone.
    if v_stones and runestone_on(size, tx, ty) is not null then return false; end if;
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

CREATE OR REPLACE FUNCTION public.plantable_tile(p_world uuid, p_x integer, p_y integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select in_bounds(p_world, p_x, p_y) and not has_water(p_world, p_x, p_y)
     and building_at(p_world, p_x, p_y) is null and not is_token(p_world, p_x, p_y)
     -- Nor a Runestone's ground (`runestone_at`).
     and runestone_at(p_world, p_x, p_y) is null
     and not exists (select 1 from crate cr where cr.world_id = p_world and cr.x = p_x and cr.y = p_y)
     and not exists (select 1 from placed pl where pl.world_id = p_world and pl.x = p_x and pl.y = p_y)
     and exists (select 1 from plantable pt where pt.tile = land_tile(p_world, p_x, p_y))
$function$;

CREATE OR REPLACE FUNCTION public.swirl_day(p_world uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
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
           -- Nor on a Runestone (`swirlRoom`).
           and runestone_on(w.size, s.x, s.y) is null
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
end $function$;

CREATE OR REPLACE FUNCTION public.ground_says(p_world uuid, p_x integer, p_y integer, p_at timestamp with time zone DEFAULT now())
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_t int; v_d int; v_worn int; v_was text; v_n int; v_said text := ''; v_swirl text; v_stone text;
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
  -- And a Runestone standing on it (`stoneSays`).
  v_stone := runestone_at(p_world, p_x, p_y);
  if v_stone is not null then
    v_said := v_said || ' ' || runestone_name(v_stone) || ', a Runestone, stands here. A Telestone can take you to it.';
  end if;
  return v_said;
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
        cart placed; beast creature; c double precision; v_tiles int;
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
  /*
   * A journey by Telestone puts the body beside a Runestone, hundreds or
   * thousands of tiles from where its browser last said it was. A word about
   * walking already on its way when the journey was made claims the old
   * ground, and pulled back a walk's worth towards it the body would be
   * walked part of the way home. So for `telestone_grace` seconds after a
   * journey a word claiming more than a walk could have gone is taken to be
   * from before it, and the body stays where the journey put it; the answer
   * says where that is.
   */
  if far > allowed and exists (select 1 from telestone_journey t where t.world_id = p_world and t.uid = me
                                  and t.used_at > now() - make_interval(secs => telestone_grace())) then
    p_x := p.x; p_y := p.y; p_level := p.level;
    far := 0;
    pulled := true;
  end if;
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
   * And what the reins or the helm taught the hands on them: a go of Driving
   * or of Sailing (`driving_learn`, `sailing_learn`) for every tile the cart
   * or the hull went into, which is what the browser pays in a game of its own.
   * A straight walk goes into one tile for every line between tiles it
   * crosses. Only under way: a cart nothing pulls goes nowhere in the browser,
   * and teaches nothing here either.
   */
  if cart.id is not null and p_level = 0 and p.level = 0 then
    v_tiles := least(20, abs(floor(p_x) - floor(p.x)) + abs(floor(p_y) - floor(p.y)))::int;
    if v_tiles > 0 and (is_boat(cart) or vehicle_speed(p_world, cart.id) > 0) then
      for i in 1 .. v_tiles loop
        perform skill_raise(p_world, me, case when is_boat(cart) then sailing_skill() else driving_skill() end,
                            case when is_boat(cart) then sailing_learn() else driving_learn() end);
      end loop;
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


select private.lock_doors();
