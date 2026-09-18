-- The woods turn over at dawn
--
-- Asked for: "make the tree tick fire at 6am UTC-7 every day". A day in the
-- woods was measured from the last turnover: `tree_tick` ran every ten
-- minutes and turned an island over once twenty-four hours had passed since
-- its last, then stamped it with now — so the hour crept ten minutes a day,
-- and fell at a different hour on every island. It is a fixed hour now.
-- `tree_dawn_utc()` is thirteen, generated from the browser's
-- `TREE_DAWN_UTC`: thirteen hundred UTC is six in the morning at UTC-7, a
-- fixed offset rather than a place, so it does not move with the clocks.
-- `tree_last_dawn()` is the most recent one, `tree_next_dawn()` the one
-- after it, and the tick — still every ten minutes, so an island founded
-- during the day waits for the next dawn, and more islands than one tick
-- takes are taken by the next — turns over every island not yet stamped
-- since the last dawn. On a run at 13:00 UTC that is all of them; on any
-- other run, none. Look says when: the next dawn, or any moment for woods
-- due and not yet turned. The browser's own game turns at the same moment,
-- off the same hour. `tree_stage()`, the old day length, is gone: nothing
-- reads it.

CREATE OR REPLACE FUNCTION public.tree_last_dawn()
 RETURNS timestamptz
 LANGUAGE sql
 STABLE
AS $function$
  select case when d <= now() then d else d - interval '1 day' end
  from (select (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
               + make_interval(hours => tree_dawn_utc()::int) as d) s
$function$;

CREATE OR REPLACE FUNCTION public.tree_next_dawn()
 RETURNS timestamptz
 LANGUAGE sql
 STABLE
AS $function$
  select tree_last_dawn() + interval '1 day'
$function$;

CREATE OR REPLACE FUNCTION public.tree_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare w record; v_isles int := 0; v_grew int := 0;
begin
  if not pg_try_advisory_lock(hashtext('tree_tick')::bigint) then
    return jsonb_build_object('isles', 0, 'busy', true);
  end if;
  for w in
    select id from world
     where ready and trees_at < tree_last_dawn()
     order by trees_at limit tick_worlds()
  loop
    v_isles := v_isles + 1;
    v_grew := v_grew + tree_day(w.id);
  end loop;
  perform pg_advisory_unlock(hashtext('tree_tick')::bigint);
  return jsonb_build_object('isles', v_isles, 'grew', v_grew);
end $function$;

CREATE OR REPLACE FUNCTION public.tree_outlook(p_world uuid, p_age tree_age_def)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_when text; v_then text; v_out text; v_next tree_age_def;
begin
  if p_age.next = p_age.id then return ' It is clipped, and will stay as it is.'; end if;
  -- Not yet turned since the last dawn: any moment. Otherwise, at the next.
  select hours_hence(extract(epoch from ((case when w.trees_at < tree_last_dawn() then now() else tree_next_dawn() end) - now())))
    into v_when from world w where w.id = p_world;
  if p_age.next is null then
    v_then := 'it will be gone';
  else
    select * into v_next from tree_age_def where id = p_age.next;
    v_then := 'it will be ' || lower(v_next.name);
  end if;
  v_out := ' The woods turn over ' || v_when || ', and ' || v_then || '.';
  if not p_age.alive then
    v_out := v_out || ' Fell it for what timber is in it before then.';
  elsif p_age.pruned is not null and v_next.id is not null and not v_next.alive then
    v_out := v_out || ' Prune it to keep it.';
  end if;
  return v_out;
end $function$;

drop function if exists tree_stage();

select private.lock_doors();
