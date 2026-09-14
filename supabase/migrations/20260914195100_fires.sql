-- Laying a fire, lighting it, feeding it, and raking it out.
--
-- Ported from src/game/campfire.ts and src/game/smelter.ts. The smelter is
-- carried and set down; the campfire is built where it stands out of two
-- shafts, which is why one has a `place_` action and the other a `build_`.

/**
 * Reach to a thing on the ground is measured to its middle, not to the tile it
 * was dropped on: a smelter is three subtiles wide and you can stand at either
 * end of it. `in_reach` cannot do this — it is immutable and knows nothing of
 * the island — so anything aimed at a placed thing is measured here instead.
 */
create or replace function placed_in_reach(p_world uuid, p_uid uuid, p_id bigint, p_range double precision default 2.4)
  returns boolean language sql stable as $$
  select exists (
    select 1 from placed pl, player py
    where pl.id = p_id and pl.world_id = p_world and py.world_id = p_world and py.uid = p_uid
      and sqrt(power(pl.cx - py.x, 2) + power(pl.cy - py.y, 2)) <= p_range)
$$;

/** The thing an action is aimed at, when it is aimed at something on the ground. */
create or replace function target_placed(p_world uuid, p_target jsonb) returns placed language sql stable as $$
  select * from placed where world_id = p_world and id = nullif(p_target->>'id', '')::bigint
$$;

create or replace function act_ported(p_action text) returns boolean language sql stable as $$
  select p_action in (
      'dig',
      'build_campfire', 'light_campfire', 'put_out_campfire', 'fuel_campfire',
      'take_ashes_fire', 'take_apart_campfire',
      'place_smelter', 'pick_up_smelter', 'light_smelter', 'fuel_smelter',
      'damp_smelter', 'take_ashes_smelter',
      'place_furniture', 'pick_up_furniture')
      or exists (select 1 from recipe where id = p_action)
$$;

/** What the fire actions refuse, and why. */
create or replace function fire_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql stable as $$
declare p placed; it item; n int; sub text;
begin
  if p_action = 'build_campfire' then
    if p_target->>'sx' is null or p_target->>'sy' is null then return 'Choose a spot.'; end if;
    if pack_count(p_world, p_uid, 'shaft') < 2 then return 'A campfire takes 2 shafts.'; end if;
    return null;
  end if;

  if p_action in ('place_smelter', 'place_furniture') then
    select * into it from item
      where id = nullif(p_target->>'uid', '')::bigint and world_id = p_world
        and holder = 'player' and holder_uid = p_uid;
    if not found then return 'You are not carrying that.'; end if;
    if p_action = 'place_smelter' and it.def <> 'smelter' then return 'That is not a smelter.'; end if;
    if p_action = 'place_furniture' then
      sub := replace(it.def, 'furniture_', '');
      if not exists (select 1 from furniture_def where id = sub) then return 'That is not something you can set down.'; end if;
    end if;
    return null;
  end if;

  p := target_placed(p_world, p_target);
  if p.id is null then return 'It is gone.'; end if;
  if not placed_in_reach(p_world, p_uid, p.id) then
    return 'Stand next to the ' || coalesce(p.sub, p.kind) || '.';
  end if;

  if p_action in ('light_campfire', 'light_smelter') then
    if placed_lit(p) then return 'It is already burning.'; end if;
    if placed_fuel(p) <= 0 then return 'There is nothing left to burn. Feed it some wood.'; end if;
  elsif p_action in ('put_out_campfire', 'damp_smelter') then
    if not placed_lit(p) then return 'It is not burning.'; end if;
  elsif p_action in ('fuel_campfire', 'fuel_smelter') then
    select * into it from item
      where world_id = p_world and holder = 'player' and holder_uid = p_uid
        and (id = nullif(p_target->>'uid', '')::bigint or fuel_value(def) is not null)
      order by (id = nullif(p_target->>'uid', '')::bigint) desc limit 1;
    if not found or fuel_value(it.def) is null then
      return 'Fires take wood and coal: shafts, thatch, planks, timbers, logs or coal.';
    end if;
    if placed_fuel(p) >= fire_capacity() then return 'It is already piled as high as it will take.'; end if;
  elsif p_action in ('take_ashes_fire', 'take_ashes_smelter') then
    if floor(placed_ash(p)) < 1 then return 'There are no ashes worth taking yet.'; end if;
  elsif p_action in ('take_apart_campfire', 'pick_up_smelter', 'pick_up_furniture') then
    if placed_lit(p) then return 'Put it out first.'; end if;
  end if;
  return null;
end $$;

/** And what they do. */
create or replace function perform_fire(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns void language plpgsql as $$
declare p placed; it item; sz int[]; ax int; ay int; per double precision; room double precision;
        fits int; whole int; sub text; made bigint; back text;
begin
  if p_action = 'build_campfire' then
    ax := least(subtiles() - 2, greatest(0, (p_target->>'sx')::int));
    ay := least(subtiles() - 2, greatest(0, (p_target->>'sy')::int));
    if not consume(p_world, p_uid, 'shaft', 2) then return; end if;
    insert into placed (world_id, kind, x, y, sx, sy, cx, cy, fuel, made_by)
    values (p_world, 'campfire', (p_target->>'x')::int, (p_target->>'y')::int, ax, ay,
            (p_target->>'x')::int + (ax + 1.0) / subtiles(), (p_target->>'y')::int + (ay + 1.0) / subtiles(),
            120, p_uid);
    perform tell(p_world, p_uid, 'You lay a campfire from 2 shafts. Light it, or feed it more wood first.', 'event');
    perform land_announce(p_world, (p_target->>'x')::int, (p_target->>'y')::int);
    return;
  end if;

  if p_action in ('place_smelter', 'place_furniture') then
    select * into it from item where id = nullif(p_target->>'uid', '')::bigint;
    sub := case when p_action = 'place_furniture' then replace(it.def, 'furniture_', '') end;
    sz := placed_size(case when p_action = 'place_smelter' then 'smelter' else 'furniture' end, sub);
    ax := least(subtiles() - sz[1], greatest(0, coalesce((p_target->>'sx')::int, 0)));
    ay := least(subtiles() - sz[2], greatest(0, coalesce((p_target->>'sy')::int, 0)));
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (p_world, case when p_action = 'place_smelter' then 'smelter' else 'furniture' end, sub,
            (p_target->>'x')::int, (p_target->>'y')::int, ax, ay,
            (p_target->>'x')::int + (ax + sz[1] / 2.0) / subtiles(),
            (p_target->>'y')::int + (ay + sz[2] / 2.0) / subtiles(),
            it.ql, p_uid)
    returning id into made;
    delete from item where id = it.id;
    perform tell(p_world, p_uid, 'You set the ' ||
      lower(coalesce((select name from furniture_def where id = sub), 'smelter')) || ' down.', 'event');
    perform land_announce(p_world, (p_target->>'x')::int, (p_target->>'y')::int);
    return;
  end if;

  perform placed_settle(nullif(p_target->>'id', '')::bigint);
  p := target_placed(p_world, p_target);
  if p.id is null then return; end if;

  if p_action in ('light_campfire', 'light_smelter') then
    update placed set lit = true, since = now() where id = p.id;
    perform tell(p_world, p_uid, 'The kindling catches and the ' || p.kind || ' burns. It has '
      || burns_for(p.fuel) || ' of fuel.', 'event');
  elsif p_action in ('put_out_campfire', 'damp_smelter') then
    update placed set lit = false, since = now() where id = p.id;
    perform tell(p_world, p_uid, 'You smother the fire. The wood is saved for later.', 'event');
  elsif p_action in ('fuel_campfire', 'fuel_smelter') then
    select * into it from item
      where world_id = p_world and holder = 'player' and holder_uid = p_uid
        and (id = nullif(p_target->>'uid', '')::bigint or fuel_value(def) is not null)
      order by (id = nullif(p_target->>'uid', '')::bigint) desc limit 1;
    per := fuel_value(it.def);
    room := greatest(0, fire_capacity() - p.fuel);
    fits := greatest(1, least(it.count, ceil(room / per)::int));
    if not consume(p_world, p_uid, it.def, fits, it.id) then return; end if;
    update placed set fuel = least(fire_capacity(), p.fuel + per * fits), since = now() where id = p.id;
    perform tell(p_world, p_uid, 'You feed ' || case when fits > 1 then fits || ' × ' else 'a ' end
      || lower((select name from item_def where id = it.def)) || ' to the fire. '
      || burns_for(least(fire_capacity(), p.fuel + per * fits)) || ' of fuel.', 'event');
  elsif p_action in ('take_ashes_fire', 'take_ashes_smelter') then
    whole := floor(p.ash)::int;
    update placed set ash = p.ash - whole, since = now() where id = p.id;
    perform give(p_world, p_uid, 'ash', whole, 20);
    perform tell(p_world, p_uid, 'You rake ' || whole || case when whole = 1 then ' lot' else ' lots' end
      || ' of ashes out of the ' || p.kind || '. (QL 20)', 'event');
  elsif p_action = 'take_apart_campfire' then
    -- Coal burns but is never got back, so a pile of logs cannot be turned
    -- into coal by rebuilding the fire.
    delete from placed where id = p.id;
    perform give(p_world, p_uid, 'shaft', 2, 20);
    perform tell(p_world, p_uid, 'You take the campfire apart and save what will burn again.', 'event');
    perform land_announce(p_world, p.x, p.y);
  elsif p_action in ('pick_up_smelter', 'pick_up_furniture') then
    back := case when p.kind = 'smelter' then 'smelter' else 'furniture_' || p.sub end;
    delete from placed where id = p.id;
    perform give(p_world, p_uid, back, 1, p.ql);
    perform tell(p_world, p_uid, 'You take up the ' || lower(coalesce(p.sub, p.kind)) || '.', 'event');
    perform land_announce(p_world, p.x, p.y);
  end if;
end $$;

select private.lock_doors();
