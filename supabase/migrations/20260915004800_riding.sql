-- A seat, a set of traces, and the shafts of a cart.
--
-- ## A ridden thing is the ninth that will not sit still, and the only one
-- ## that settles from a place rather than a time
--
-- Everything else on this island that moves without being watched moves
-- because a clock moved: a fire has burned this much, a wound has drained this
-- far, a trap has had eighty rolls at the country round it. Not one of them
-- needs to know where anybody is.
--
-- A mount is the opposite. It moves for exactly one reason — the rider moved —
-- and it moves not by a rate but to a *place*. The browser keeps it under its
-- rider by copying the player's position onto the creature every frame, which
-- is a loop, and there are no loops here. But there does not have to be one:
-- the moment a rider's position changes is a moment this island already knows
-- about, because the client tells it, through `rpc_move`. So the mount, the
-- cart in your hands, the wagon under you and the team in front of it are all
-- dragged along there, in the same statement that moves you. Nothing is stale
-- and nothing is rolled forward, because the only clock that matters is the
-- one the rider is holding.
--
-- ## And what it costs is the one thing the ceiling had to learn
--
-- `rpc_move` believes a claimed position as far as the fastest thing on two
-- legs could have carried you. On a horse you are not on two legs. That
-- ceiling is the whole of what stops a client putting itself on the far side
-- of the island, so it is widened rather than lifted: to what the mount could
-- do, or what the team in the traces could do, and no further. A wagon with
-- nothing in the yokes still moves at a walk, because it is being pushed.

alter table creature add column if not exists tacked boolean not null default false;
alter table creature add column if not exists rider uuid;
alter table creature add column if not exists hitched_to bigint;
alter table placed add column if not exists puller uuid;
alter table placed add column if not exists driver uuid;
create index if not exists creature_in_traces on creature (world_id, hitched_to)
  where hitched_to is not null;

/* ------------------------------------------------------------------ *
 * What a piece is, and what is in front of it.
 * ------------------------------------------------------------------ */

/** Whether a piece of furniture is a cart you drag along by hand. */
create or replace function is_cart(p placed) returns boolean language sql stable as $$
  select p.kind = 'furniture' and coalesce((select cart from furniture_def where id = p.sub), false)
$$;

/** Whether it is driven from a seat with a team in front of it. */
create or replace function is_vehicle(p placed) returns boolean language sql stable as $$
  select p.kind = 'furniture' and exists (select 1 from vehicle_def v where v.id = p.sub)
$$;

create or replace function is_boat(p placed) returns boolean language sql stable as $$
  select p.kind = 'furniture' and exists (select 1 from boat_def b where b.id = p.sub)
$$;

/** Anything that is boarded and steered: wheels or hull. */
create or replace function is_driveable(p placed) returns boolean language sql stable as $$
  select is_vehicle(p) or is_boat(p)
$$;

/** The wildermon in the traces of a vehicle, in the order they went in. */
create or replace function team_of(p_world uuid, p_id bigint) returns setof creature
  language sql stable as $$
  select c.* from creature c where c.world_id = p_world and c.hitched_to = p_id order by c.id
$$;

create or replace function team_size(p_world uuid, p_id bigint) returns int language sql stable as $$
  select count(*)::int from creature c where c.world_id = p_world and c.hitched_to = p_id
$$;

/** The vehicle this player has the reins of, if any. */
create or replace function driving(p_world uuid, p_uid uuid) returns placed language sql stable as $$
  select p.* from placed p where p.world_id = p_world and p.driver = p_uid limit 1
$$;

/** The cart this player has by the shafts, if any. */
create or replace function cart_in_hand(p_world uuid, p_uid uuid) returns placed language sql stable as $$
  select p.* from placed p where p.world_id = p_world and p.puller = p_uid limit 1
$$;

/** The wildermon this player is up on, if any. */
create or replace function mount_of(p_world uuid, p_uid uuid) returns creature language sql stable as $$
  select c.* from creature c where c.world_id = p_world and c.rider = p_uid limit 1
$$;

/** The nearest vehicle with a yoke still empty. */
create or replace function vehicle_near(p_world uuid, p_x double precision, p_y double precision,
    p_range double precision default 5)
  returns placed language sql stable as $$
  select p.* from placed p
  join vehicle_def v on v.id = p.sub
  where p.world_id = p_world and p.kind = 'furniture'
    and team_size(p_world, p.id) < v.yokes
    and sqrt((p.cx - p_x) ^ 2 + (p.cy - p_y) ^ 2) <= p_range
  order by sqrt((p.cx - p_x) ^ 2 + (p.cy - p_y) ^ 2)
  limit 1
$$;

/**
 * The vehicle a given beast could be put to.
 *
 * One in the settlement token is fetched out and walked round to the front, so
 * what counts is where *you* are standing; one already out in the world has to
 * be within five tiles of the yoke itself.
 */
create or replace function vehicle_for(p_world uuid, p_uid uuid, c creature) returns placed
  language plpgsql stable as $$
declare p player;
begin
  if c.mode = 'stored' then
    select * into p from player where world_id = p_world and uid = p_uid;
    return vehicle_near(p_world, p.x, p.y, 3);
  end if;
  return vehicle_near(p_world, creature_x(c), creature_y(c), 5);
end $$;

/* ------------------------------------------------------------------ *
 * How fast, and how steep.
 * ------------------------------------------------------------------ */

/** What a draught beast learns in the traces, and under a saddle. */
create or replace function haul_skill() returns text language sql immutable as $$ select 'climbing' $$;
create or replace function base_speed() returns double precision language sql immutable as $$ select 2.4 $$;
create or replace function max_step() returns double precision language sql immutable as $$ select 32 $$;
create or replace function max_mount_speed() returns double precision language sql immutable as $$ select 5 $$;
create or replace function max_vehicle_speed() returns double precision language sql immutable as $$ select 4 $$;
create or replace function climb_pitch() returns double precision language sql immutable as $$ select 0.16 $$;

/** Sure-footedness earned on bad ground. */
create or replace function footing(p_climb double precision) returns double precision
  language sql immutable as $$ select 0.9 + coalesce(p_climb, 0) / 140 $$;

/** A body of light wood rolls a shade easier than one of oak. */
create or replace function roll_ease(p_extra text) returns double precision
  language sql stable as $$ select 1 / (0.82 + coalesce((mat_of(p_extra)).weight, 1) * 0.18) $$;

/** One beast's climbing, which is nought until something teaches it. */
create or replace function beast_climb(c creature) returns double precision
  language sql stable as $$ select coalesce((c.skills->>haul_skill())::double precision, 0) $$;

/** What a team knows about hills between them, which is what a slope asks. */
create or replace function team_climb(p_world uuid, p_id bigint) returns double precision
  language sql stable as $$
  select coalesce(avg(beast_climb(c)), 0) from team_of(p_world, p_id) c
$$;

/**
 * How fast a team takes a vehicle along, in tiles a second.
 *
 * The animals decide it and nothing else: a quick one gets there sooner, more
 * of them pull better than fewer, a practised one finds its feet, and a hungry
 * one drags. What is loaded on the back has no say at all, which is the whole
 * point of putting it there.
 */
create or replace function vehicle_speed(p_world uuid, p_id bigint) returns double precision
  language plpgsql stable as $$
declare v vehicle_def; p placed; c creature; n int := 0;
        sum_pace double precision := 0; worst double precision := 1; pull double precision := 0.75;
begin
  select * into p from placed where world_id = p_world and id = p_id;
  if not found then return 0; end if;
  select * into v from vehicle_def where id = p.sub;
  if not found then return 0; end if;
  for c in select * from team_of(p_world, p_id) loop
    n := n + 1;
    sum_pace := sum_pace + (select speed from species_def where id = c.species)
      * (age_row(c.born)).speed * trait_mul(c.traits, 'speed');
    worst := least(worst, 0.6 + 0.4 * c.hunger);
    -- Every beast adds its own share; the ones bred for it add more.
    pull := pull + coalesce((select sp.pull from species_def sp where sp.id = c.species), 0.25)
      * (age_row(c.born)).pull * trait_mul(c.traits, 'haul');
  end loop;
  if n < v.needs then return 0; end if;
  return least(max_vehicle_speed(),
    (sum_pace / n) * pull * worst * footing(team_climb(p_world, p_id)) * roll_ease(p.material));
end $$;

/** How fast a mount carries a rider: its own pace, steadied by practice. */
create or replace function mount_speed(c creature) returns double precision language sql stable as $$
  select least(max_mount_speed(),
    (select speed from species_def where id = c.species)
    * (age_row(c.born)).speed * trait_mul(c.traits, 'speed')
    * footing(beast_climb(c)) * (0.6 + 0.4 * c.hunger))
$$;

/**
 * The steepest step a mount will take. A green one is no worse than your own
 * legs and a worked one goes up what you would have to go round.
 */
create or replace function mount_step(c creature) returns double precision language sql stable as $$
  select max_step() + beast_climb(c) * climb_pitch() * 2
       * coalesce((select pitch from species_def where id = c.species), 1)
$$;

/**
 * And the steepest a vehicle will take. Wheels start off worse than a walker
 * and a trained team ends up better: what a draught beast learns in the traces
 * is which lines it can hold.
 */
create or replace function vehicle_step(p_world uuid, p_id bigint) returns double precision
  language sql stable as $$
  select max_step() / 2 + team_climb(p_world, p_id) * climb_pitch()
$$;

/** Water deep enough to float this hull. */
create or replace function launch_spot(p_world uuid, p_kind text, p_x int, p_y int) returns boolean
  language sql stable as $$
  select in_bounds(p_world, p_x, p_y)
     and -centre_height(p_world, p_x, p_y) >= (select draught from boat_def where id = p_kind)
$$;

/** Dry land within stepping distance of a hull, if there is any. */
create or replace function shore_near(p_world uuid, p_x double precision, p_y double precision,
    p_range int default 2)
  returns table (x int, y int) language sql stable as $$
  select t.x, t.y from
    (select floor(p_x)::int + dx as x, floor(p_y)::int + dy as y,
            sqrt(dx ^ 2 + dy ^ 2) as d
     from generate_series(-p_range, p_range) dx, generate_series(-p_range, p_range) dy) t
  where in_bounds(p_world, t.x, t.y) and passable(p_world, t.x, t.y)
    and not has_water(p_world, t.x, t.y)
  order by t.d
  limit 1
$$;

/* ------------------------------------------------------------------ *
 * Getting on, getting off, and being dragged along.
 * ------------------------------------------------------------------ */

/** Put a wildermon in a vehicle's traces. */
create or replace function hitch_up(p_world uuid, p_id int, p_piece bigint) returns boolean
  language plpgsql as $$
declare c creature; p placed; v vehicle_def;
begin
  select * into c from creature where world_id = p_world and id = p_id;
  if not found or c.hitched_to is not null or c.rider is not null then return false; end if;
  select * into p from placed where world_id = p_world and id = p_piece;
  select * into v from vehicle_def where id = p.sub;
  if not found or team_size(p_world, p_piece) >= v.yokes then return false; end if;
  update creature set hitched_to = p_piece, carrying = null, enemy = null, hunting = null,
      -- Fetched out of the token and walked round to the front.
      mode = case when c.mode = 'stored'
                  then case when exists (select 1 from deed where world_id = p_world)
                            then 'deed' else 'active' end
                  else c.mode end,
      from_x = p.cx, from_y = p.cy, to_x = p.cx, to_y = p.cy,
      leg_at = now(), leg_ends = now(), settled_at = now()
    where world_id = p_world and id = p_id;
  return true;
end $$;

/** Get down off a vehicle, leaving it where it stands. */
create or replace function leave_vehicle(p_world uuid, p_id bigint) returns void
  language sql as $$ update placed set driver = null where world_id = p_world and id = p_id $$;

/** Take a wildermon out of the traces, wherever it is standing. */
create or replace function unhitch_one(p_world uuid, p_id int) returns bigint
  language plpgsql as $$
declare was bigint;
begin
  select hitched_to into was from creature where world_id = p_world and id = p_id;
  update creature set hitched_to = null where world_id = p_world and id = p_id;
  -- The last one out takes the driver down with it: nobody drives an empty yoke.
  if was is not null and team_size(p_world, was) = 0 then perform leave_vehicle(p_world, was); end if;
  return was;
end $$;

/** Everything out of the traces at once, when the driver is done with it. */
create or replace function unhitch_all(p_world uuid, p_id bigint) returns int
  language plpgsql as $$
declare n int;
begin
  select count(*)::int into n from creature where world_id = p_world and hitched_to = p_id;
  update creature set hitched_to = null where world_id = p_world and hitched_to = p_id;
  perform leave_vehicle(p_world, p_id);
  return n;
end $$;

/**
 * Bring along whatever is following you.
 *
 * Called from `rpc_move` with the place the player has just got to, which is
 * the only moment any of this moves. A mount goes under its rider; a cart goes
 * where the shafts went; a driven vehicle goes where the driver went and the
 * team goes with it. Everything lands on the same spot, which is close enough
 * — nothing in the rules asks whether a horse is a half-tile ahead of the cart
 * it is pulling, and pretending to know would be inventing a simulation the
 * browser does not have either.
 */
create or replace function drag_along(p_world uuid, p_uid uuid, p_x double precision, p_y double precision)
  returns void language plpgsql as $$
declare v_tx int := floor(p_x)::int; v_ty int := floor(p_y)::int;
begin
  update creature set from_x = p_x, from_y = p_y, to_x = p_x, to_y = p_y,
      leg_at = now(), leg_ends = now(), settled_at = now()
    where world_id = p_world and rider = p_uid;

  update placed set x = v_tx, y = v_ty, cx = p_x, cy = p_y
    where world_id = p_world and (puller = p_uid or driver = p_uid);

  update creature set from_x = p_x, from_y = p_y, to_x = p_x, to_y = p_y,
      leg_at = now(), leg_ends = now(), settled_at = now()
    where world_id = p_world and hitched_to in
      (select id from placed where world_id = p_world and driver = p_uid);
end $$;

/**
 * How far this player could honestly have got in a second.
 *
 * On foot it is the walk the ceiling has always allowed. In a saddle or on a
 * seat it is what the animal could do — and a hull is its own hull's speed.
 * A vehicle with an unfilled yoke answers nought, and nought means walking:
 * you are pushing it.
 */
create or replace function travel_speed(p_world uuid, p_uid uuid) returns double precision
  language plpgsql stable as $$
declare c creature; p placed; v double precision;
begin
  p := driving(p_world, p_uid);
  if p.id is not null then
    if is_boat(p) then return (select speed from boat_def where id = p.sub); end if;
    v := vehicle_speed(p_world, p.id);
    if v > 0 then return v; end if;
    return base_speed();
  end if;
  c := mount_of(p_world, p_uid);
  if c.id is not null then return mount_speed(c); end if;
  return base_speed();
end $$;

select private.lock_doors();
