/*
 * Prayer, a skill of its own. Faith (`faith_skill`, whose id is `prayer` from
 * before the two were told apart) sets the most favour you can hold and what
 * you can call on; Prayer (`praying_skill`, from the defs before this) sets how
 * much favour a prayer banks, and is the skill the job is said with. Each
 * prayer trains both: faith by `prayer_gain`, in the browser's `perform`, and
 * Prayer by what any go that comes off teaches its own skill, which the
 * browser pays after the go (`completeAction`) and this island pays here.
 *
 * `prayer_worth` takes the Prayer skill now, and is made again rather than
 * replaced so that its argument says so.
 */
set local lock_timeout = '3s';

drop function if exists prayer_worth(double precision, double precision, double precision);
/** What one prayer banks: more at a better altar, at dawn and dusk than at noon, and the more Prayer it is said with. The browser's `prayerWorth`. */
create function prayer_worth(p_ql double precision, p_hour double precision,
    p_prayer double precision)
  returns double precision language sql immutable as $$
  -- The hour before the sun is properly up, and the one as it goes: those two.
  select prayer_favour()
       * (0.55 + greatest(greatest(0, 1 - abs(p_hour - 6) / 3),
                          greatest(0, 1 - abs(p_hour - 20) / 3)) * 0.75)
       * (0.6 + p_ql / 200)
       * (0.7 + p_prayer / 220)
$$;

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
    -- What a prayer banks is Prayer's to say; what you can hold is faith's (`favour_cap`).
    got := least(cap, favour_settle(p_world, p_uid) + prayer_worth(pc.ql, hour, skill_of(p_world, p_uid, praying_skill())));
    update player set favour = got, favour_at = now(), prayed_at = now()
      where world_id = p_world and uid = p_uid;
    perform journal_note(p_world, p_uid, 'prayed');
    perform skill_raise(p_world, p_uid, faith_skill(), prayer_gain());
    perform tell(p_world, p_uid,
      case when abs(hour - 6) < 2 or abs(hour - 20) < 2
           then 'You kneel in the half light and it goes better than it usually does.'
           else 'You kneel at the stone.' end
      || ' Favour ' || floor(got) || ' of ' || floor(cap) || '.', 'event');
    -- And Prayer, the skill it is said with, as every job teaches its own (`completeAction`).
    perform skill_raise(p_world, p_uid, praying_skill(), try_gain(true));

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
