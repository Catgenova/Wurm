-- Casting a line, and walking a net round.

create or replace function act_ported(p_action text) returns boolean language sql stable as $$
  select p_action in (
      'dig', 'mine', 'chip_corner', 'pack', 'cultivate',
      'pave_gravel', 'pave_cobble', 'drop_dirt_here',
      'cut_down', 'forage', 'botanize', 'collect',
      'till', 'plant_seed', 'tend_crop', 'harvest_crop', 'clear_field',
      'fish', 'drag_net',
      'build_campfire', 'light_campfire', 'put_out_campfire', 'fuel_campfire',
      'take_ashes_fire', 'take_apart_campfire',
      'place_smelter', 'pick_up_smelter', 'light_smelter', 'fuel_smelter',
      'damp_smelter', 'take_ashes_smelter',
      'place_furniture', 'pick_up_furniture')
      or exists (select 1 from recipe where id = p_action)
$$;

create or replace function fish_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql stable as $$
declare tx int; ty int; spot record; skill double precision;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  skill := skill_of(p_world, p_uid, 'fishing');

  if p_action = 'fish' then
    select * into spot from cast_at(p_world, p_uid, tx, ty, cast_range());
    if spot.depth is null then
      return 'There is no water within reach deep enough to hold anything. Walk to the bank.';
    end if;
    if not exists (select 1 from fish_here(spot.depth, skill)) then
      return 'Nothing you could land runs in water this shallow.';
    end if;
  elsif p_action = 'drag_net' then
    select * into spot from cast_at(p_world, p_uid, tx, ty, net_range());
    if spot.depth is null then
      return 'There is no water close enough to drag a net through. Wade in.';
    end if;
    if spot.depth < 1 then return 'The water is too thin to drag a net through.'; end if;
  end if;
  return null;
end $$;

create or replace function perform_fish(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns void language plpgsql as $$
declare tx int; ty int; spot record; skill double precision; rod_ql double precision;
        bait text; got text; made_ql double precision; tool_id bigint; gained double precision;
        haul int; i int; parts text[] := '{}'; one text; counted jsonb := '{}'::jsonb; k text;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  skill := skill_of(p_world, p_uid, 'fishing');

  if p_action = 'fish' then
    select * into spot from cast_at(p_world, p_uid, tx, ty, cast_range());
    if spot.depth is null then return; end if;
    rod_ql := tool_ql(p_world, p_uid, 'fishing_rod');
    select it.id into tool_id from item it
      where it.world_id = p_world and it.holder = 'player' and it.holder_uid = p_uid and it.def = 'fishing_rod'
      order by tool_worth(it.ql, it.dmg, it.extra, it.rare, it.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id, 0.5); end if;
    gained := skill_raise(p_world, p_uid, 'fishing', 0.4);

    -- Something goes on the hook if anything worth using is in the pack.
    bait := bait_for(p_world, p_uid, spot.depth, skill);
    if bait is not null and not consume(p_world, p_uid, bait, 1) then return; end if;

    got := catch_fish(spot.depth, skill, rod_ql, bait);
    if got is null then
      perform tell(p_world, p_uid, case when bait is null then 'Something takes it and comes off again.'
        else 'Something takes the ' || lower((select coalesce(name, bait) from item_def where id = bait))
             || ' and comes off again.' end, 'event');
    else
      made_ql := product_ql(skill, rod_ql);
      perform give(p_world, p_uid, got, 1, made_ql);
      perform tell(p_world, p_uid, 'You land '
        || case when lower((select name from fish_def where id = got)) ~ '^[aeiou]' then 'an ' else 'a ' end
        || lower((select name from fish_def where id = got))
        || case when bait is null then '' else ' on the '
             || lower((select coalesce(name, bait) from item_def where id = bait)) end
        || '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    end if;

  elsif p_action = 'drag_net' then
    select * into spot from cast_at(p_world, p_uid, tx, ty, net_range());
    if spot.depth is null then return; end if;
    rod_ql := tool_ql(p_world, p_uid, 'fishing_net');
    select it.id into tool_id from item it
      where it.world_id = p_world and it.holder = 'player' and it.holder_uid = p_uid and it.def = 'fishing_net'
      order by tool_worth(it.ql, it.dmg, it.extra, it.rare, it.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id, 1.4); end if;
    gained := skill_raise(p_world, p_uid, 'fishing', 0.55);

    if not exists (select 1 from fish_here(spot.depth, skill)) then
      perform tell(p_world, p_uid, 'The net comes up with nothing in it but weed.', 'event');
      return;
    end if;
    -- A net takes numbers, not size: the big fish go round it or through it.
    haul := 1 + floor(random() * (1 + 4 * (0.3 + least(100, rod_ql) / 160)))::int;
    for i in 1..haul loop
      one := pick_fish(spot.depth, skill, null, random());
      -- Anything that lives deeper than a net reaches mostly avoids it.
      if one is not null and ((select depth from fish_def where id = one) <= 8 or random() < 0.12) then
        counted := jsonb_set(counted, array[one], to_jsonb(coalesce((counted->>one)::int, 0) + 1));
      end if;
    end loop;
    if counted = '{}'::jsonb then
      perform tell(p_world, p_uid, 'The net comes up empty.', 'event');
      return;
    end if;
    made_ql := product_ql(skill, rod_ql);
    for k in select jsonb_object_keys(counted) loop
      perform give(p_world, p_uid, k, (counted->>k)::int, made_ql);
      parts := parts || ((counted->>k) || ' × ' || lower((select coalesce(name, k) from item_def where id = k)));
    end loop;
    perform tell(p_world, p_uid, 'You walk the net round and haul it in: '
      || array_to_string(parts, ', ') || '.', 'event');
  end if;

  if gained > 0 then
    perform tell(p_world, p_uid, 'Fishing increased by ' || to_char(gained, 'FM0.0000')
      || ' to ' || to_char(skill_of(p_world, p_uid, 'fishing'), 'FM990.0000') || '.', 'skill');
  end if;
end $$;

select private.lock_doors();
