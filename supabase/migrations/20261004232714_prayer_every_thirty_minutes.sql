/*
 * Prayer, every thirty minutes. The rest between prayers that are worth
 * anything is thirty minutes on the wall clock now (`prayer_rest`, from the
 * defs before this), and a prayer still waiting says how long it waits in the
 * browser's own words (`prayerRestWords`). What a prayer trains faith by is
 * the rulebook's `PRAYER_GAIN` (`prayer_gain`), rather than a number written
 * here a second time.
 */
set local lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.faith_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
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
      return 'You prayed less than ' || round(prayer_rest() / 60) || ' minutes ago. ' || ceil(rest / 60) || ' minutes to go.';
    end if;
    return null;

  elsif p_action = 'cast' then
    return cast_reason(p_world, p_uid, p_target->>'spell', target_item(p_target));

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
end $function$;

CREATE OR REPLACE FUNCTION public.perform_faith(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
    perform journal_note(p_world, p_uid, 'prayed');
    perform skill_raise(p_world, p_uid, faith_skill(), prayer_gain());
    perform tell(p_world, p_uid,
      case when abs(hour - 6) < 2 or abs(hour - 20) < 2
           then 'You kneel in the half light and it goes better than it usually does.'
           else 'You kneel at the stone.' end
      || ' Favour ' || floor(got) || ' of ' || floor(cap) || '.', 'event');

  elsif p_action = 'cast' then
    if cast_reason(p_world, p_uid, p_target->>'spell', target_item(p_target)) is not null then
      return;
    end if;
    perform journal_note(p_world, p_uid, 'cast:' || (p_target->>'spell'));
    perform tell(p_world, p_uid,
      do_cast(p_world, p_uid, p_target->>'spell', target_item(p_target)), 'event');

  elsif p_action = 'meditate' then
    select * into sit from sitting_worth(p_world, p_uid);
    was := skill_of(p_world, p_uid, meditation_skill());
    update player set sat_at = now() where world_id = p_world and uid = p_uid;
    perform journal_note(p_world, p_uid, 'sat');
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
end $function$;

select private.lock_doors();
