/*
 * Every gain at a fifth (`GAIN_RATE`, `gain_rate` from the defs before this).
 *
 * Asked for: global experience gains reduced five times, for everybody,
 * workers included. Every gain on the island goes through this one function
 * -- a body's skills and characteristics by `skill_raise`, a deed worker's
 * and a beast's by `worker_learn` -- so the rate goes on here, after the
 * floor, as the browser's `skillGain` has it: the last point of a skill slows
 * by the same five as the first.
 */
set local lock_timeout = '3s';

create or replace function skill_gain_of(p_v double precision, p_base double precision, p_roll double precision)
  returns double precision language sql immutable as $$
  select greatest(min_gain(), p_base * skill_room(p_v)) * p_roll * gain_rate()
$$;

select private.lock_doors();
