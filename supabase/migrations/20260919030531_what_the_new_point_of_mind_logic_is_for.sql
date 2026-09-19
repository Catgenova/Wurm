-- And what the new point of mind logic is actually for.
--
-- Reported: "some skills like mind logic dont announce in the skill event tab
-- when they reach a new level."
--
-- They do now — that was the same silence a failed craft had, and it went with
-- it: a characteristic is raised by `skill_raise` and `skill_raise` says what
-- happened, so mind logic announces its whole numbers the way awareness always
-- has. What it still did not say was the only thing a point of mind logic is
-- worth anything for. The browser has said it since the queue went in:
--
--   Mind logic is now 30. You can keep 4 jobs in your head.
--
-- and the island said the first sentence and stopped. A characteristic that
-- announces itself once every ten points and does not mention the one thing
-- that changed is announcing the wrong half.
--
-- The two sides work the capacity out from the same rule, so the rule is a
-- function of the number now rather than of the player: the sentence has to be
-- asked twice, what it holds now against what it held before the go, and the
-- second of those is a value nobody is holding any more.

create or replace function queue_capacity(p_mind double precision)
returns integer language sql immutable as $fn$
  select 3 + floor(greatest(0, p_mind - 20) / 10)::int
$fn$;

create or replace function queue_capacity(p_world uuid, p_uid uuid)
returns integer language sql stable as $fn$
  select queue_capacity(skill_of(p_world, p_uid, 'mind_logic'))
$fn$;

create or replace function skill_said(p_world uuid, p_uid uuid, p_id text, p_gained double precision)
returns void language plpgsql as $fn$
declare d skill_def; now_at double precision; was double precision;
begin
  if p_id is null or coalesce(p_gained, 0) <= 0 then return; end if;
  select * into d from skill_def where id = p_id;
  now_at := skill_of(p_world, p_uid, p_id);
  was := now_at - p_gained;
  /*
   * What you pick up in the background says less about itself than what you
   * set out to do. A characteristic is read as a whole number and moves in
   * thousandths, so it speaks when the whole number moves and not otherwise —
   * and when it is mind logic, it says what the point bought, which is a job
   * more in hand and is the only reason anybody watches the number.
   */
  if coalesce(d.quiet, false) then
    if floor(now_at) > floor(was) then
      perform tell(p_world, p_uid,
        coalesce(d.name, initcap(replace(p_id, '_', ' ')))
        || ' is now ' || floor(now_at)::int || '.'
        || case when p_id = 'mind_logic' and queue_capacity(now_at) > queue_capacity(was)
                then ' You can keep ' || queue_capacity(now_at) || ' jobs in your head.'
                else '' end, 'skill');
    end if;
    return;
  end if;
  perform tell(p_world, p_uid,
    coalesce(d.name, initcap(replace(p_id, '_', ' ')))
    || ' increased by '
    || to_char(p_gained, case when p_gained < 0.0001 then 'FM0.000000' else 'FM0.0000' end)
    || ' to ' || to_char(now_at, 'FM990.0000') || '.', 'skill');
end $fn$;

select private.lock_doors();
