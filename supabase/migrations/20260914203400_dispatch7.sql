-- The dispatcher, with a settlement and the houses on it.

/**
 * Which jobs belong to the building code.
 *
 * Written as a list rather than a prefix on purpose: `build_wall` and
 * `build_floor` share their first word with `build_campfire`, and the
 * dispatcher used to send anything beginning with `build_` to the fires. A
 * prefix that was unambiguous when it was written stopped being so the moment
 * a second family wanted the same verb, and nothing would have said so — the
 * wall would simply have been handed to the code that lights things.
 */
create or replace function build_action(p_action text) returns boolean language sql immutable as $$
  select p_action in (
    'plan_building', 'add_to_building', 'remove_from_plan', 'rename_building',
    'plan_wall', 'plan_fence', 'build_wall', 'remove_wall',
    'add_floor', 'plan_floor', 'build_floor', 'remove_floor', 'remove_storey')
$$;

create or replace function act_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql as $$
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
  if aimed in ('campfire', 'smelter', 'kiln', 'furniture', 'anvil') or p_action like 'place\_%' then
    return fire_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- The stake is in your hand and the ground is under your feet: nothing to reach for.
  if p_action = 'found_settlement' then
    return deed_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if not in_reach(p.x, p.y, p_target, d.corner, d.range) then return 'You are too far away from that.'; end if;
  if d.tool is not null and tool_ql(p_world, p_uid, d.tool) <= 0 then
    return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || ' to ' || lower(d.label) || '.';
  end if;
  if p_action = 'build_campfire' then
    return fire_refusal(p_world, p_uid, p_action, p_target);
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
end $$;

create or replace function act_perform(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns void language plpgsql as $$
declare d action_def; tq double precision; s double precision; cx int; cy int; tx int; ty int;
        t tile_def; left_dirt int; made_ql double precision; yield text; gained double precision; tool_id bigint;
begin
  -- Before the `build_%` prefix below, which would otherwise take the walls.
  if build_action(p_action) then
    perform perform_building(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action = 'found_settlement' then
    perform perform_deed(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action like 'build\_%' or p_action like 'place\_%' or p_action like 'pick\_up\_%'
     or p_action like 'light\_%' or p_action like 'fuel\_%' or p_action like 'put\_out\_%'
     or p_action like 'damp\_%' or p_action like 'take\_ashes\_%' or p_action like 'take\_apart\_%' then
    perform perform_fire(p_world, p_uid, p_action, p_target);
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
    gained := skill_raise(p_world, p_uid, d.skill, 1);
    perform tell(p_world, p_uid,
      'You dig up some ' || lower((select name from item_def where id = yield)) ||
      '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    if gained > 0 then
      perform tell(p_world, p_uid, 'Digging increased by ' || to_char(gained, 'FM0.0000') ||
        ' to ' || to_char(skill_of(p_world, p_uid, d.skill), 'FM990.0000') || '.', 'skill');
    end if;
  end if;
end $$;

/**
 * Instant work happens now rather than on the next touch.
 *
 * An action with no duration still went through the same door as a six-second
 * dig: it was written down as what you are doing, given an end time of *now*,
 * and then sat there until something else came along and settled it. Renaming
 * a building and being told nothing until your next dig is not what instant
 * means, so the settle happens on the way out.
 */
create or replace function rpc_act(p_world uuid, p_action text, p_target jsonb, p_times int default 1)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); d action_def; p player; why text; secs double precision;
        s double precision; tq double precision; cap int; room int;
begin
  if me is null then raise exception 'not signed in'; end if;
  perform settle(p_world, me);
  why := act_refusal(p_world, me, p_action, p_target);
  if why is not null then
    perform tell(p_world, me, why, 'error');
    return jsonb_build_object('started', false, 'why', why);
  end if;
  select * into d from action_def where id = p_action;
  select * into p from player where world_id = p_world and uid = me for update;

  -- Something already in hand: line this one up behind it rather than drop it.
  if p.act is not null then
    cap := queue_capacity(p_world, me);
    room := cap - 1 - jsonb_array_length(p.act_queue);
    if room <= 0 then
      why := 'You can only keep ' || cap || ' jobs in your head at once. Mind logic is what widens that.';
      perform tell(p_world, me, why, 'error');
      return jsonb_build_object('started', false, 'queued', false, 'why', why);
    end if;
    update player set act_queue = act_queue || jsonb_build_object(
        'action', p_action, 'target', p_target, 'goes', greatest(1, least(100, coalesce(p_times, 1))))
      where world_id = p_world and uid = me returning * into p;
    perform tell(p_world, me, d.label || ' is next, ' || jsonb_array_length(p.act_queue) + 1 || ' of ' || cap || ' in hand.', 'info');
    return jsonb_build_object('started', false, 'queued', true,
      'inHand', jsonb_array_length(p.act_queue) + 1, 'capacity', cap);
  end if;

  s := case when d.skill is null then 50 else skill_of(p_world, me, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, me, d.tool) end;
  -- Every other job has a floor of a second or so under it; an instant one has
  -- no duration to put a floor under, and act_duration would give it one.
  secs := case when d.instant then 0 else act_duration(d.base_time, s, tq, control_speed(p_world, me)) end;
  update player set
      act = p_action, act_target = p_target, act_started = now(),
      act_ends = now() + make_interval(secs => secs),
      act_left = greatest(1, least(100, coalesce(p_times, 1))), seen_at = now()
    where world_id = p_world and uid = me;
  if d.instant then
    perform settle(p_world, me);
    return jsonb_build_object('started', true, 'done', true, 'seconds', 0);
  end if;
  perform tell(p_world, me, 'You start ' || d.verb || '.', 'info');
  return jsonb_build_object('started', true, 'ends', now() + make_interval(secs => secs), 'seconds', secs);
end $$;

select private.lock_doors();
