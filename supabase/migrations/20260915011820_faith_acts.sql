-- Kneeling, calling on it, sitting, choosing, and calling on what you know.

create or replace function faith_action(p_action text) returns boolean language sql immutable as $$
  select p_action in ('pray', 'cast', 'meditate', 'choose_path', 'use_ability')
$$;

create or replace function faith_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql as $$
declare p player; pc placed; rest double precision; med double precision;
        v_way text; v_step path_step;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'pray' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint
      and kind = 'furniture';
    if not found or not is_altar(pc) then return 'It is gone.'; end if;
    if not near_piece(p_world, p_uid, pc) then return 'Kneel at the altar.'; end if;
    rest := prayer_rest() - extract(epoch from (now() - coalesce(p.prayed_at, 'epoch')));
    if rest > 0 then
      return 'You have said what you had to say today. ' || ceil(rest / 60) || ' minutes.';
    end if;
    return null;

  elsif p_action = 'cast' then
    return cast_reason(p_world, p_uid, p_target->>'spell', nullif(p_target->>'uid', '')::bigint);

  elsif p_action = 'meditate' then
    if pack_count(p_world, p_uid, 'rug') <= 0 then return 'You need a rug to sit on.'; end if;
    rest := sit_rest() - extract(epoch from (now() - coalesce(p.sat_at, 'epoch')));
    if rest > 0 then
      return 'You have sat today and got what there was to get. ' || ceil(rest / 60) || ' minutes.';
    end if;
    return null;

  elsif p_action = 'choose_path' then
    if p.way is not null then
      return 'You have chosen, and it is not the sort of thing that is chosen twice.';
    end if;
    med := skill_of(p_world, p_uid, meditation_skill());
    if med < choose_at() then
      return 'Sit until you have ' || round(choose_at()) || ' meditation behind you.';
    end if;
    v_way := p_target->>'material';
    if v_way is null or not exists (select 1 from path_def where id = v_way) then
      return 'Choose one of the three.';
    end if;
    return null;

  elsif p_action = 'use_ability' then
    v_step := ability_of(p_world, p_uid, p_target->>'material');
    if v_step.path is null then return 'That is not something you know.'; end if;
    rest := v_step.rest - extract(epoch from (now()
      - coalesce((p.used_at->>v_step.ability)::timestamptz, 'epoch')));
    if rest > 0 then
      return v_step.name || ' again in ' || ceil(rest / 60) || ' minutes.';
    end if;
    return null;
  end if;
  return null;
end $$;

create or replace function perform_faith(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns void language plpgsql as $$
declare p player; pc placed; faith double precision; hour double precision;
        gained double precision; cap double precision; got double precision;
        was double precision; med double precision; sit record; v_step path_step;
        v_way text; r record;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'pray' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    faith := skill_of(p_world, p_uid, faith_skill());
    hour := hour_of_day(p_world);
    cap := favour_cap(faith);
    got := least(cap, favour_settle(p_world, p_uid) + prayer_worth(pc.ql, hour, faith));
    update player set favour = got, favour_at = now(), prayed_at = now()
      where world_id = p_world and uid = p_uid;
    perform skill_raise(p_world, p_uid, faith_skill(), 1.4);
    perform tell(p_world, p_uid,
      case when abs(hour - 6) < 2 or abs(hour - 20) < 2
           then 'You kneel in the half light and it goes better than it usually does.'
           else 'You kneel at the stone.' end
      || ' Favour ' || floor(got) || ' of ' || floor(cap) || '.', 'event');

  elsif p_action = 'cast' then
    if cast_reason(p_world, p_uid, p_target->>'spell', nullif(p_target->>'uid', '')::bigint) is not null then
      return;
    end if;
    perform tell(p_world, p_uid,
      do_cast(p_world, p_uid, p_target->>'spell', nullif(p_target->>'uid', '')::bigint), 'event');

  elsif p_action = 'meditate' then
    select * into sit from sitting_worth(p_world, p_uid);
    was := skill_of(p_world, p_uid, meditation_skill());
    update player set sat_at = now() where world_id = p_world and uid = p_uid;
    perform skill_raise(p_world, p_uid, meditation_skill(), sit.gain);
    med := skill_of(p_world, p_uid, meditation_skill());
    perform tell(p_world, p_uid, sit.said, 'event');
    if p.way is null and med >= choose_at() and was < choose_at() then
      perform tell(p_world, p_uid, 'Something settles. Three ways of looking at all this have '
        || 'become clear, and you may walk exactly one of them. Choose from the rug.', 'system');
    end if;
    if p.way is not null then
      for r in select s.*, d.name as path_name from path_step s join path_def d on d.id = s.path
        where s.path = p.way and was < s.at and med >= s.at order by s.n
      loop
        perform tell(p_world, p_uid, r.path_name || ': ' || r.name || '. ' || r.note, 'system');
      end loop;
    end if;

  elsif p_action = 'choose_path' then
    v_way := p_target->>'material';
    if p.way is not null or not exists (select 1 from path_def where id = v_way) then return; end if;
    update player set way = v_way where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You take the path of '
      || (select name from path_def where id = v_way) || '. '
      || (select note from path_def where id = v_way), 'system');

  elsif p_action = 'use_ability' then
    v_step := ability_of(p_world, p_uid, p_target->>'material');
    if v_step.path is null then return; end if;
    update player set used_at = jsonb_set(used_at, array[v_step.ability], to_jsonb(now()))
      where world_id = p_world and uid = p_uid;
    perform skill_raise(p_world, p_uid, meditation_skill(), 0.2);
    perform tell(p_world, p_uid, work_ability(p_world, p_uid, v_step.ability), 'event');
  end if;
end $$;

create or replace function act_ported(p_action text) returns boolean language sql stable as $$
  select exists (select 1 from recipe where id = p_action)
      or faith_action(p_action)
      or ride_action(p_action)
      or trap_action(p_action)
      or dig_action(p_action)
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
      or p_action in ('dig', 'mine', 'chip_corner', 'pack', 'cultivate', 'pave_gravel', 'pave_cobble',
                      'drop_dirt_here', 'cut_down', 'forage', 'botanize', 'collect',
                      'till', 'plant_seed', 'tend_crop', 'harvest_crop', 'clear_field',
                      'fish', 'drag_net', 'found_settlement', 'set_to_work')
$$;

select private.lock_doors();
