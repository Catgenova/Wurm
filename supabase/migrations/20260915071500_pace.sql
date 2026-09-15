-- Everything took a few seconds. Now a face of rock takes thirty.
--
-- `base_time` in `action_def` and `recipe` was never a number of seconds. It
-- is a **weight**: felling a tree is worth more than picking a berry and the
-- tables say by how much. What nothing ever said is what one unit is worth,
-- and the answer was a second by default — which made a full go at solid rock
-- eight of them, and most of the game a handful.
--
-- A unit is `action_pace()` seconds now, chosen so that a beginner with a
-- plain pickaxe spends thirty on a face of rock. Nothing was re-weighted; the
-- unit was re-priced, so every job keeps exactly the ratio to mining it always
-- had. `src/game/pace.ts` is where that number lives and `action_pace()` is
-- generated from it, alongside every other constant down here — the browser
-- and this database have to price a job the same, and two hand-written numbers
-- are two numbers that drift.
--
-- The floor moves with it. It was 1.2 seconds against a one-second unit, so it
-- is 1.2 units still: a floor that stayed put would have turned every quick
-- job into the same quick job.
--
-- What is deliberately *not* re-priced is the world's own clock — how fast a
-- crop comes on, how long a kiln burns, how long a brew works, how long a
-- beast carries. Those are not action timers, and moving them is a different
-- change nobody asked for. It does mean a field now ripens in rather fewer
-- swings of a pickaxe than it used to, which is worth knowing before somebody
-- goes looking for it as a bug.

/** How long a go at something takes: skill and a good tool both shorten it. */
create or replace function act_duration(p_base double precision, p_skill double precision,
                                        p_tool_ql double precision, p_control double precision default 1)
  returns double precision language sql immutable as $$
  select greatest(action_floor(),
                  p_base * action_pace() * (1 - p_skill / 140) * (1 - p_tool_ql / 400) * p_control)
$$;

/** How long a worker takes over a task: twice what a player of the same skill would. */
create or replace function work_duration(p_skill double precision) returns double precision
  language sql immutable as $$
  select 2 * greatest(action_floor(), worker_weight() * action_pace() * (1 - p_skill / 140))
$$;

select private.lock_doors();
