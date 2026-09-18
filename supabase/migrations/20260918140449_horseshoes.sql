-- Horseshoes
--
-- Asked from the island. Four shoes to a lump off a gang mould, nailed onto
-- a mount by a farrier with a mallet. They hold a week (`shoe_days`) from
-- the fitting, and while they hold the mount goes a share quicker on laid
-- stone and gravel (`shoe_pace`, on ground the tile table now calls paved)
-- and takes a step a fixed height steeper (`shoe_step`), which is a step
-- higher onto a dug bank as well, since the standing cap rides on the step.
-- Four numbers, off the one table both sides read.
--
-- `shod_at` is a column on the creature; `shod` is the one rule for whether
-- the shoes are still on, and the creature payload carries it to a browser,
-- which keeps its own week from there. `shoe_creature` joins the ride family
-- beside saddling, and is refused in the browser's words: not a mount, not
-- grown, or short of four shoes and a mallet.

alter table creature add column if not exists shod_at timestamptz;

/** Whether the shoes are still on: a week from the fitting. */
create or replace function shod(c creature) returns boolean language sql stable as $fn$
  select c.shod_at is not null and c.shod_at > now() - make_interval(days => shoe_days()::int)
$fn$;

/** Laid stone or gravel, off the tile table. */
create or replace function paved(p_tile int) returns boolean language sql stable as $fn$
  select coalesce((select t.paved from tile_def t where t.id = p_tile), false)
$fn$;

CREATE OR REPLACE FUNCTION public.ride_beast_action(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in ('tack_creature', 'shoe_creature', 'untack_creature', 'mount_creature', 'dismount_creature',
                      'hitch_creature', 'unhitch_creature')
$function$
;

CREATE OR REPLACE FUNCTION public.ride_action(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in ('tack_creature', 'shoe_creature', 'untack_creature', 'mount_creature', 'dismount_creature',
                      'hitch_creature', 'unhitch_creature', 'pull_cart', 'drop_cart',
                      'board_vehicle', 'leave_vehicle', 'unhitch_team')
$function$
;

CREATE OR REPLACE FUNCTION public.ride_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; p placed; v vehicle_def; want text; n int;
begin
  if ride_beast_action(p_action) then
    perform creature_settle(p_world, (p_target->>'id')::int);
    c := target_creature(p_world, p_target);
    if c.world_id is null then return 'It is gone.'; end if;
    select * into d from species_def where id = c.species;

    if p_action = 'tack_creature' then
      if not creature_in_reach(p_world, p_uid, c) then return 'Stand next to ' || c.name || '.'; end if;
      if not (age_row(c.born)).works then
        return c.name || ' is not grown. Nothing that young takes a saddle.';
      end if;
      want := tack_missing(p_world, p_uid);
      if want is not null then return 'You need ' || want || '.'; end if;

    elsif p_action = 'shoe_creature' then
      -- Shoes, in the words the browser uses: a mount, grown, within reach,
      -- and four shoes and a mallet in the pack.
      if d.mount is null then return 'Only a mount takes shoes.'; end if;
      if not creature_in_reach(p_world, p_uid, c) then return 'Stand next to ' || c.name || '.'; end if;
      if not (age_row(c.born)).works then
        return c.name || ' is not grown. Nothing that young takes a shoe.';
      end if;
      if pack_count(p_world, p_uid, 'horseshoe') < shoes_per_mount()::int or pack_count(p_world, p_uid, 'mallet') < 1 then
        return 'You need four horseshoes and a mallet.';
      end if;

    elsif p_action = 'untack_creature' then
      if not creature_in_reach(p_world, p_uid, c) then return 'Stand next to ' || c.name || '.'; end if;

    elsif p_action = 'mount_creature' then
      if not c.tacked then return c.name || ' has no saddle or bridle on.'; end if;
      if not (age_row(c.born)).works then return c.name || ' is not grown enough to carry you.'; end if;
      if c.hitched_to is not null then return c.name || ' is in the traces.'; end if;
      if not creature_in_reach(p_world, p_uid, c) then return 'Stand next to ' || c.name || '.'; end if;
      if (driving(p_world, p_uid)).id is not null then
        return 'Get down off what you are driving first.';
      end if;

    elsif p_action = 'hitch_creature' then
      p := vehicle_for(p_world, p_uid, c);
      if p.id is null then return 'There is no cart or wagon here with an empty yoke.'; end if;
      if not near_piece(p_world, p_uid, p) then
        return 'Stand by the ' || lower(placed_name(p)) || '.';
      end if;
      if c.mode <> 'stored' and not creature_in_reach(p_world, p_uid, c, 4) then
        return c.name || ' is too far off. Call it over first.';
      end if;
      if not (age_row(c.born)).works then
        return c.name || ' is not grown. A yearling is no use in the traces.';
      end if;
      if c.hunger < 0.15 then
        return c.name || ' is too hungry to pull anything. Feed it first.';
      end if;
    end if;
    return null;
  end if;

  -- The rest are asked of a thing standing on the ground.
  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint
    and kind = 'furniture';
  if not found then return 'It is gone.'; end if;

  if p_action = 'pull_cart' then
    if not near_piece(p_world, p_uid, p) then return 'Stand beside the shafts.'; end if;
    if exists (select 1 from placed q where q.world_id = p_world and q.puller = p_uid and q.id <> p.id) then
      return 'You already have a cart behind you.';
    end if;

  elsif p_action = 'board_vehicle' then
    if not near_piece(p_world, p_uid, p) then return 'Stand beside it first.'; end if;
    if (driving(p_world, p_uid)).id is not null then return 'You are already driving something.'; end if;
    -- A hull asks nothing but that she is still floating.
    if is_boat(p) then
      if not launch_spot(p_world, p.sub, p.x, p.y) then return 'She is aground. Push her off first.'; end if;
      return null;
    end if;
    select * into v from vehicle_def where id = p.sub;
    if found then
      n := team_size(p_world, p.id);
      if n < v.needs then
        return case when n = 0
          then 'Nothing is in the yokes. ' || placed_name(p) || ' needs ' || v.needs || ' to move.'
          else 'Only ' || n || ' of ' || v.yokes || ' yokes are filled. It needs ' || v.needs || '.' end;
      end if;
    end if;

  elsif p_action = 'leave_vehicle' then
    if is_boat(p) and not exists (select 1 from player pl, lateral shore_near(p_world, pl.x, pl.y)
                                  where pl.world_id = p_world and pl.uid = p_uid) then
      return 'There is no shore within reach. Bring her in first, or swim for it.';
    end if;

  elsif p_action = 'unhitch_team' then
    if not near_piece(p_world, p_uid, p) then return 'Stand beside it first.'; end if;
  end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.perform_ride(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare c creature; p placed; v vehicle_def; r record; v_names text; v_short text; v_n int;
        v_was bigint; v_shore record; v_sail boolean;
begin
  if ride_beast_action(p_action) then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;

    if p_action = 'tack_creature' then
      for r in select item from tack_def order by ord loop
        if not consume(p_world, p_uid, r.item, 1) then return; end if;
      end loop;
      update creature set tacked = true where world_id = p_world and id = c.id;
      perform tell(p_world, p_uid, 'You saddle ' || c.name
        || ' and slip the bit into its mouth. It stands for it.', 'event');

    elsif p_action = 'shoe_creature' then
      if not consume(p_world, p_uid, 'horseshoe', shoes_per_mount()::int) then return; end if;
      update creature set shod_at = now() where world_id = p_world and id = c.id;
      perform tell(p_world, p_uid, 'You nail four shoes onto ' || c.name
        || '''s hooves. They will hold a week: quicker on stone, and up what it would have baulked at.', 'event');

    elsif p_action = 'untack_creature' then
      update creature set tacked = false where world_id = p_world and id = c.id;
      for r in select item from tack_def order by ord loop
        perform give(p_world, p_uid, r.item, 1, 40);
      end loop;
      perform tell(p_world, p_uid, 'You strip the saddle and bridle off ' || c.name || '.', 'event');

    elsif p_action = 'mount_creature' then
      -- One seat at a time: whoever was up gets down without being asked.
      update creature set rider = null where world_id = p_world and rider = p_uid;
      update creature set rider = p_uid, enemy = null, hunting = null,
          from_x = pl.x, from_y = pl.y, to_x = pl.x, to_y = pl.y,
          leg_at = now(), leg_ends = now(), settled_at = now()
        from player pl
        where creature.world_id = p_world and creature.id = c.id
          and pl.world_id = p_world and pl.uid = p_uid;
      perform journal_note(p_world, p_uid, 'mounted');
      perform tell(p_world, p_uid, 'You take a fistful of mane and swing up onto '
        || c.name || '.', 'event');

    elsif p_action = 'dismount_creature' then
      update creature set rider = null where world_id = p_world and id = c.id;
      perform tell(p_world, p_uid, 'You swing down off ' || c.name || '.', 'event');

    elsif p_action = 'hitch_creature' then
      p := vehicle_for(p_world, p_uid, c);
      if p.id is null or not hitch_up(p_world, c.id, p.id) then return; end if;
      select * into v from vehicle_def where id = p.sub;
      v_n := team_size(p_world, p.id);
      v_short := case when v_n < v.needs
        then ' It needs ' || (v.needs - v_n) || ' more before it will move.' else '' end;
      perform journal_note(p_world, p_uid, 'hitched');
      perform tell(p_world, p_uid, 'You back ' || c.name || ' into a yoke of the '
        || lower(placed_name(p)) || '. ' || v_n || ' of ' || v.yokes || ' filled.' || v_short, 'event');

    elsif p_action = 'unhitch_creature' then
      v_was := unhitch_one(p_world, c.id);
      perform tell(p_world, p_uid, 'You unbuckle ' || c.name || ' from the '
        || coalesce(lower((select placed_name(q) from placed q where q.id = v_was)), 'traces') || '.', 'event');
    end if;
    return;
  end if;

  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
  if not found then return; end if;

  if p_action = 'pull_cart' then
    update placed set puller = p_uid where world_id = p_world and id = p.id;
    perform tell(p_world, p_uid, 'You take up the shafts of the ' || lower(placed_name(p))
      || '. It will follow you now.', 'event');

  elsif p_action = 'drop_cart' then
    update placed set puller = null where world_id = p_world and id = p.id;
    perform tell(p_world, p_uid, 'You set the ' || lower(placed_name(p))
      || ' down and let go of the shafts.', 'event');

  elsif p_action = 'board_vehicle' then
    update placed set driver = p_uid where world_id = p_world and id = p.id;
    if is_boat(p) then
      select sail into v_sail from boat_def where id = p.sub;
      perform tell(p_world, p_uid, 'You push off and climb into the ' || lower(placed_name(p)) || '. '
        || case when v_sail then 'The sail fills and she comes round.'
                else 'You ship the oars and take a stroke.' end, 'event');
      return;
    end if;
    select string_agg(t.name, ' and ' order by t.id) into v_names from team_of(p_world, p.id) t;
    perform tell(p_world, p_uid, 'You climb onto the ' || lower(placed_name(p)) || ' and take the reins. '
      || coalesce(v_names, 'Nothing') || ' lean into the traces.', 'event');

  elsif p_action = 'leave_vehicle' then
    if is_boat(p) then
      select s.x, s.y into v_shore from player pl, lateral shore_near(p_world, pl.x, pl.y) s
        where pl.world_id = p_world and pl.uid = p_uid;
      perform leave_vehicle(p_world, p.id);
      if v_shore.x is not null then
        update player set x = v_shore.x + 0.5, y = v_shore.y + 0.5, moved_at = now()
          where world_id = p_world and uid = p_uid;
      end if;
      perform tell(p_world, p_uid, 'You bring the ' || lower(placed_name(p))
        || ' alongside and step ashore.', 'event');
      return;
    end if;
    perform leave_vehicle(p_world, p.id);
    perform tell(p_world, p_uid, 'You climb down off the ' || lower(placed_name(p)) || '.', 'event');

  elsif p_action = 'unhitch_team' then
    v_n := unhitch_all(p_world, p.id);
    perform tell(p_world, p_uid, 'You let ' || case when v_n = 1 then 'it' else 'them' end
      || ' out of the traces of the ' || lower(placed_name(p)) || '.', 'event');
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.mount_step(c creature)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select max_step() + beast_climb(c) * climb_pitch() * 2 + case when shod(c) then shoe_step() else 0 end
       * coalesce((select pitch from species_def where id = c.species), 1)
$function$
;

CREATE OR REPLACE FUNCTION public.travel_speed(p_world uuid, p_uid uuid)
 RETURNS double precision
 LANGUAGE plpgsql
 STABLE
AS $function$
declare c creature; p placed; v double precision; pl player;
begin
  p := driving(p_world, p_uid);
  if p.id is not null then
    if is_boat(p) then return (select speed from boat_def where id = p.sub); end if;
    v := vehicle_speed(p_world, p.id);
    if v > 0 then return v; end if;
    return base_speed();
  end if;
  c := mount_of(p_world, p_uid);
  if c.id is not null then
    -- Shod, it goes quicker on laid stone and gravel.
    select * into pl from player where world_id = p_world and uid = p_uid;
    -- The cap comes after the shoes, as the browser has it: a mount at the cap is at the cap.
    return least(max_mount_speed(), mount_speed(c) * case when shod(c) and paved(land_tile(p_world, floor(pl.x)::int, floor(pl.y)::int))
                                                          then shoe_pace() else 1 end);
  end if;
  return base_speed();
end $function$
;

CREATE OR REPLACE FUNCTION public.rpc_creatures(p_world uuid, p_range double precision DEFAULT 40)
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
  perform creature_sweep(p_world, p.x, p.y, p_range);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'species', c.species, 'name', c.name, 'variant', c.variant,
      'mode', c.mode, 'stance', c.stance, 'job', c.job, 'shod', shod(c),
      'x', creature_x(c), 'y', creature_y(c),
      'fromX', c.from_x, 'fromY', c.from_y, 'toX', c.to_x, 'toY', c.to_y,
      /*
       * How long the leg is and how much of it is left, in seconds.
       *
       * It used to hand over the two instants themselves, which asks a browser
       * to agree with this database about what time it is. A phone whose clock
       * is twenty seconds out pins every leg at one end or the other and then
       * re-pins it on the next answer, which reads as a thing jumping about —
       * and the action bar learnt this lesson already: "a browser whose clock
       * is a minute out still draws the right bar".
       */
      'legFor', case when c.leg_ends > c.leg_at
                     then extract(epoch from (c.leg_ends - c.leg_at)) else 0 end,
      'legLeft', greatest(0, extract(epoch from (c.leg_ends - now()))),
      'health', c.health, 'max', max_health(c), 'hunger', c.hunger,
      'sex', c.sex, 'age', age_of(c.born), 'traits', c.traits,
      'hunting', c.hunting = me, 'mine', coalesce(c.keeper = me, false))
      /*
       * And, for your own only, what the card has been making up.
       *
       * A worker's trade, its learning, its brushing and what is in its arms
       * are all here and none of them have ever gone out, so the browser
       * filled them in from the book: every wildermon on an island read
       * Foraging 1.00, Experience 0.0, Care 0% and "Looking for work", however
       * long it had been at it. Yours only, because it is a card you open
       * about your own and nobody needs five numbers about a wild boar.
       */
      || case when c.keeper = me then jsonb_build_object(
           'care', c.care, 'xp', c.xp, 'skills', c.skills,
           'phase', c.phase, 'carrying', c.carrying)
         else '{}'::jsonb end
      order by c.id)
    from creature c
    where c.world_id = p_world
      /*
       * Where the leg ends, first, because that is what there is an index on.
       *
       * The exact answer below is where the thing is *now*, which is a point
       * on the leg it is walking and so a function of four columns and the
       * clock — nothing a btree can help with, and it was being worked out for
       * every creature on the island before being thrown away. This narrows to
       * the neighbourhood first, generously: `leg_slack` is far longer than
       * any leg the rules make (the longest measured on a real island is 2.13
       * tiles), and anything walking further than that in one leg was already
       * invisible to `creature_sweep`, which has bounded itself this way since
       * it was written.
       */
      and c.to_x between p.x - (p_range + leg_slack()) and p.x + (p_range + leg_slack())
      and c.to_y between p.y - (p_range + leg_slack()) and p.y + (p_range + leg_slack())
      and greatest(abs(creature_x(c) - p.x), abs(creature_y(c) - p.y)) <= p_range), '[]'::jsonb);
end $function$
;

-- A column was added to a table the API sees.
notify pgrst, 'reload schema';

select private.lock_doors();
