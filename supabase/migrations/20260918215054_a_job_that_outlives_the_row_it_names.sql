-- A job that outlives the row it names, whichever way it named it
--
-- Reported: "error placing a crate says it's not a crate". A crate does not
-- stack, so five crates in a pack are five rows, and five placings queued off
-- one menu entry all name the first of them. The first goes down and takes its
-- row with it, and the other four are pointed at nothing: "That is not a
-- crate", twice over, for jobs that were perfectly good when they were asked
-- for.
--
-- The machinery for this has been here since somebody queued three eats and
-- ate a different onion: `rpc_act` stamps the job with what the thing was
-- while there is still a row to ask, and `act_retarget` points a job at
-- another of the same kind when the row it named has gone. But the stamp is
-- taken off `target_item`, which reads `itemUid` and `uid` alike, and the
-- spending read `uid` alone — and every placing names its thing with
-- `itemUid`. So the stamp was taken and never spent. It reads the same two
-- keys now, and writes back to whichever one the job was carrying. The
-- browser's `retarget` had the same hole and is closed the same way.

CREATE OR REPLACE FUNCTION public.act_retarget(p_world uuid, p_uid uuid, p_job jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_uid bigint; v_was text; v_other bigint; v_key text;
begin
  if p_job is null then return p_job; end if;
  v_was := p_job->>'was';
  if v_was is null then return p_job; end if;
  /*
   * Both ways a target can name a thing, which is the whole of the bug
   * reported as "error placing a crate says it's not a crate": a crate does
   * not stack, so five crates are five rows, and five placings queued off one
   * menu entry all named the first of them. The first went down and took its
   * row with it, and the other four were pointed at nothing. `kind: 'item'`
   * carries `uid`; a tile with a thing to put on it carries `itemUid`, which
   * is what every placing uses — and `target_item` has read both since it was
   * written, while this read one. So the stamp was taken and never spent.
   */
  v_key := case when p_job->'target' ? 'itemUid' then 'itemUid' else 'uid' end;
  v_uid := target_item(p_job->'target');
  if v_uid is null then return p_job; end if;
  -- Still there: nothing to do, and this is the ordinary case.
  if (carried(p_world, p_uid, v_uid)).id is not null then return p_job; end if;
  select i.id into v_other from item i
   where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
     and i.def = v_was and not i.locked
   order by i.id limit 1;
  if v_other is null then return p_job; end if;
  return jsonb_set(p_job, array['target', v_key], to_jsonb(v_other));
end $function$;

select private.lock_doors();
