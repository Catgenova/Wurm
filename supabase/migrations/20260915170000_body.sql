-- A body that gets hungry, tired and better, on the island rather than in the tab.
--
-- "Thirst and hunger reset to full on every client reset. Those should both be
-- server authorization and the values should always match on client, same with
-- health."
--
-- They did reset, and here is why: the island owns the player and owned
-- everything about them *except this*. `stats` is written when you eat, drink,
-- pray, sleep or die, and at no other time — nothing drained hunger or thirst,
-- nothing spent or gave back wind, nothing healed. `action_def.stamina` has
-- been a column since the first day and not one function has ever read it.
--
-- So the bars fell all session because the browser was moving its own copy,
-- and a refresh read the island's, which had never moved since the day the
-- body was made. Every other number on that row was true and these four were
-- decoration.
--
-- ## Off a timestamp, like the fires
--
-- There is nowhere in Supabase to put a loop, and a body that only gets hungry
-- while somebody is watching is not a body. So `stats` is what was true at
-- `body_at`, and `body_settle` works the seconds since forward and writes both
-- — the same settle-on-touch as `placed_fuel`, and it hangs off `settle`,
-- which every act, every move, every heartbeat and every turn of the clock
-- already calls.
--
-- ## What a gap means
--
-- At most `body_gap` seconds are ever charged in one go. A shut tab is not a
-- body standing in a field, and somebody who comes back after a week should
-- find themselves where they left off rather than dead of thirst — which is
-- also how the game has always behaved in a browser, where no time passes for
-- a page that is not open.
--
-- ## What this changes about playing
--
-- Work costs wind now and a queue stops when the wind gives out, which is what
-- both ends have always said they do: the browser writes "Your wind gives out
-- after 3 of 10", and `settle` already asks `act_refusal` between goes. On an
-- island neither had ever happened, because nothing was tired.
--
-- Two things the island still does not know and the browser does, said out
-- loud rather than left to be found: what you are carrying, so there is no
-- burden on the cost of a go; and what you have eaten, so hunger falls at the
-- plain rate rather than the slower one a well-fed body earns.

alter table player add column if not exists body_at timestamptz not null default now();

/** The longest stretch a body is ever charged for at once. Three heartbeats. */
create or replace function body_gap() returns double precision language sql immutable as $fn$ select 180::double precision $fn$;

/** Where a skill starts, which is what "above where you began" is measured from. */
create or replace function char_start() returns double precision language sql immutable as $fn$ select 20::double precision $fn$;

/**
 * Bring a body up to date: hungrier, thirstier, and whatever it got back.
 *
 * Wind comes back only while your hands are empty — a job in hand is a job
 * being done — and a wound knits only on a body that is fed and watered.
 */
create or replace function body_settle(p_world uuid, p_uid uuid) returns void language plpgsql as $$
declare p player; secs double precision;
        h double precision; t double precision; w double precision; hp double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found then return; end if;
  secs := least(body_gap(), extract(epoch from (now() - p.body_at)));
  if secs <= 0 then
    update player set body_at = now() where world_id = p_world and uid = p_uid;
    return;
  end if;
  h := coalesce((p.stats->>'hunger')::double precision, 1);
  t := coalesce((p.stats->>'thirst')::double precision, 1);
  w := coalesce((p.stats->>'stamina')::double precision, 1);
  hp := coalesce((p.stats->>'health')::double precision, 1);

  h := greatest(0, h - secs * hunger_rate());
  t := greatest(0, t - secs * thirst_rate());
  if p.act is null then
    w := least(1, w + secs * wind_rest()
           * (1 + greatest(0, skill_of(p_world, p_uid, 'body_stamina') - char_start()) * wind_per_level())
           * (case when h <= 0 or t <= 0 then wind_starving() else 1 end));
  end if;
  if h > heal_fed() and t > heal_fed() and hp < 1 then
    hp := least(1, hp + secs * heal_rate());
  end if;

  update player set body_at = now(), stats = jsonb_set(jsonb_set(jsonb_set(jsonb_set(
      coalesce(stats, '{}'::jsonb),
      '{hunger}', to_jsonb(h)), '{thirst}', to_jsonb(t)),
      '{stamina}', to_jsonb(w)), '{health}', to_jsonb(hp))
    where world_id = p_world and uid = p_uid;
end $$;

/**
 * What a go of work takes out of you.
 *
 * Settled first, so the wind it is taken off is the wind you actually have
 * rather than the wind you had when somebody last looked.
 */
create or replace function spend_wind(p_world uuid, p_uid uuid, p_action text) returns void language plpgsql as $$
declare cost double precision; w double precision; body double precision;
begin
  select stamina into cost from action_def where id = p_action;
  if coalesce(cost, 0) <= 0 then return; end if;
  perform body_settle(p_world, p_uid);
  -- A hardy body spends less on the same job. No burden here: the island does
  -- not know what you are carrying.
  body := greatest(0.45, 1 - greatest(0, skill_of(p_world, p_uid, 'body_stamina') - char_start()) * 0.0045);
  select coalesce((stats->>'stamina')::double precision, 1) into w
    from player where world_id = p_world and uid = p_uid;
  update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}',
      to_jsonb(greatest(0, w - cost * body)))
    where world_id = p_world and uid = p_uid;
end $$;

/**
 * Whether the body itself says no, before any rule about the job does.
 *
 * `act_refusal` is a hundred and forty lines about tools, reach, ground and
 * materials, and none of it about you. Rather than retype it to add one
 * question at the top, it keeps its whole body under a new name and this takes
 * the old one.
 */
create or replace function body_refusal(p_world uuid, p_uid uuid, p_action text) returns text language plpgsql as $$
declare w double precision; cost double precision;
begin
  select stamina into cost from action_def where id = p_action;
  if coalesce(cost, 0) <= 0 then return null; end if;
  perform body_settle(p_world, p_uid);
  select coalesce((stats->>'stamina')::double precision, 1) into w
    from player where world_id = p_world and uid = p_uid;
  if w < exhausted() then return 'You are too exhausted to do that. Rest a moment.'; end if;
  return null;
end $$;

-- The rules, under their own name, exactly as they were.
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
  -- The hour comes for a dam in young whoever is or is not standing there, and
  -- somebody is always about to do something. This is where they find out.
  perform herd_settle(p_world);
  -- The last ten answer for their own reach, every one of them: a bridge is
  -- worked from either bank, a bed is furniture, and a beast is not at a tile.
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
    return craft_refusal(p_world, p_uid, p_action, nullif(p_target->>'uid', '')::bigint);
  end if;

  if p_action = 'dig' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    if t.dig_yield is null then return 'You cannot dig that.'; end if;
    if land_height(p_world, cx, cy) <= 0 then return 'You cannot dig below the water level.'; end if;
    if land_dirt(p_world, cx, cy) <= 0 then
      return 'That corner is bare rock. Only a pickaxe will take it lower.';
    end if;
  end if;
  return null;
end $function$;

/** The body first, then everything else that could say no. */
create or replace function act_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql as $$
declare why text;
begin
  why := body_refusal(p_world, p_uid, p_action);
  if why is not null then return why; end if;
  return act_refusal_rules(p_world, p_uid, p_action, p_target);
end $$;

-- And `settle`, which every act, move, heartbeat and turn of the clock calls,
-- brings the body up to date and charges the wind a finished go took.
CREATE OR REPLACE FUNCTION public.settle(p_world uuid, p_uid uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare p player; d action_def; done int := 0; guard int := 0; nxt jsonb; ended timestamptz;
begin
  perform wounds_settle(p_world, p_uid);
  perform body_settle(p_world, p_uid);
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found or p.act is null then return 0; end if;
  while p.act is not null and p.act_ends <= now() and guard < 200 loop
    guard := guard + 1;
    perform act_perform(p_world, p_uid, p.act, p.act_target);
    -- And what the go took out of you, which nothing over here had ever
    -- charged: `action_def.stamina` was a column no function read.
    perform spend_wind(p_world, p_uid, p.act);
    done := done + 1;
    select * into d from action_def where id = p.act;
    ended := p.act_ends;
    if p.act_left > 1 and act_refusal(p_world, p_uid, p.act, p.act_target) is null then
      update player set act_left = act_left - 1, act_started = ended,
             act_ends = ended + make_interval(secs => act_duration(
               d.base_time,
               case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end,
               case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end,
               control_speed(p_world, p_uid)))
        where world_id = p_world and uid = p_uid returning * into p;
    else
      if p.act_left > 1 then
        -- Why, when there is a why. A run of goes that stops because the wind
        -- gave out should say so rather than leave somebody wondering what
        -- they did wrong, which is what the browser has always said.
        perform tell(p_world, p_uid,
          coalesce(act_refusal(p_world, p_uid, p.act, p.act_target) || ' That was '
                   || (coalesce(p.act_left, 1)) || ' to go.',
                   'You stop ' || d.verb || '.'), 'info');
      end if;
      nxt := p.act_queue -> 0;
      if nxt is null then
        update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null
          where world_id = p_world and uid = p_uid returning * into p;
      else
        select * into d from action_def where id = nxt->>'action';
        if d is null or act_refusal(p_world, p_uid, nxt->>'action', nxt->'target') is not null then
          perform tell(p_world, p_uid,
            coalesce(act_refusal(p_world, p_uid, nxt->>'action', nxt->'target'), 'That cannot be done now.'), 'error');
          update player set act = null, act_target = null, act_started = null, act_ends = null,
                 act_left = null, act_queue = act_queue - 0
            where world_id = p_world and uid = p_uid returning * into p;
        else
          update player set act = nxt->>'action', act_target = nxt->'target',
                 act_left = greatest(1, coalesce((nxt->>'goes')::int, 1)),
                 act_started = ended,
                 act_ends = ended + make_interval(secs => act_duration(
                   d.base_time,
                   case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end,
                   case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end,
                   control_speed(p_world, p_uid))),
                 act_queue = act_queue - 0
            where world_id = p_world and uid = p_uid returning * into p;
          perform tell(p_world, p_uid, 'You start ' || d.verb || '.', 'info');
        end if;
      end if;
    end if;
  end loop;
  return done;
end $function$;

-- And the heartbeat, which is where a body that is only standing there lives.
CREATE OR REPLACE FUNCTION public.rpc_settle(p_seen bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); r record; n int := 0; p player; v_world uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  update player set seen_at = now(), away = false,
         seen_change = greatest(seen_change, coalesce(p_seen, 0))
    where uid = me and (away or seen_at < now() - interval '5 seconds' or coalesce(p_seen, 0) > seen_change);
  for r in select world_id from player
    where uid = me and act is not null and act_ends <= now()
  loop
    n := n + settle(r.world_id, me);
  end loop;
  select * into p from player where uid = me order by seen_at desc limit 1;
  v_world := p.world_id;
  /*
   * And the body itself, which nothing had ever brought up to date.
   *
   * `settle` above runs only for somebody with a job whose time is up, and
   * `world_tick` only for the same — so a body standing still never got
   * hungry, never got its wind back and never healed. This is the heartbeat
   * every browser makes anyway, once a minute, and it is where a body that is
   * only standing there lives.
   */
  if v_world is not null then
    perform body_settle(v_world, me);
    select * into p from player where world_id = v_world and uid = me;
  end if;
  return jsonb_build_object(
    'settled', n,
    'act', p.act,
    'ends', p.act_ends,
    'left', p.act_left,
    'secs', case when p.act_ends is null then null
                 else greatest(0, extract(epoch from (p.act_ends - now()))) end,
    'total', case when p.act_ends is null or p.act_started is null then null
                  else greatest(0.001, extract(epoch from (p.act_ends - p.act_started))) end,
    -- What is lined up behind it, and how much room is left in your head.
    'queue', coalesce((select jsonb_agg(q->>'action' order by o)
                       from jsonb_array_elements(p.act_queue) with ordinality t(q, o)), '[]'::jsonb),
    'cap', case when v_world is null then null else queue_capacity(v_world, me) end,
    -- The bars, which have been the ones you came ashore with until now.
    'stats', p.stats,
    -- Every skill, because the log says one went up and the window said it did not.
    'skills', coalesce((select jsonb_object_agg(s.id, s.value) from skill s
                        where s.world_id = v_world and s.uid = me), '{}'::jsonb),
    -- The ore a prospector read, and how much longer it is lit for.
    'marks', case when jsonb_typeof(p.stats->'prospected') <> 'object' then null
                  else jsonb_build_object(
                    'tiles', p.stats->'prospected'->'tiles',
                    'secs', greatest(0, (p.stats->'prospected'->>'until')::double precision
                                        - extract(epoch from now()))) end,
    'queued', coalesce(jsonb_array_length(p.act_queue), 0));
end $function$;

select private.lock_doors();
