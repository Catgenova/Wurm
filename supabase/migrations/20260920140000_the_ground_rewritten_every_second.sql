-- The ground, rewritten every second
--
-- Two samples of `pg_stat_statements` from the live project, eight hours and
-- twenty-three minutes apart:
--
--     select public.world_tick()   3,636 calls,  1,970.88 ms each
--                                 18,661 calls,  1,301.07 ms each
--
-- Subtracting one from the other: fifteen thousand rounds in thirty thousand
-- seconds, about 1,139 ms of database time apiece. The clock is scheduled once
-- a second and `pg_cron` will not start a round while the last one is running,
-- so a round that takes longer than a second is a clock that runs slow. It was
-- landing every two seconds, at half the rate it is configured for.
--
-- ## Where the round went
--
-- Every per-world sweep, timed on a 4096-wide island with things lying about
-- on it. The wildlife is not in this list because it has had a 250 ms budget
-- since `a round that always finishes`:
--
--     ground_sweep     198 ms      trap_sweep      0.5 ms
--     log_out_idle     1.8 ms      post_sweep      0.2 ms
--     brazier_sweep    1.0 ms      furnace_sweep   0.3 ms
--     prune_events     0.6 ms      compact_changes 0.6 ms
--
-- That is at two thousand things on the ground. It is linear -- about 95
-- microseconds a thing -- and it does not care whether anything has changed:
--
--     ground rows | sweep ms | us per row
--     480         | 45       | 94
--     2000        | 193      | 97
--     10000       | 1038     | 104
--     40000       | 3795     | 95
--
-- `ground_sweep` took `limit sweep_rows()`, and `sweep_rows()` is fifty
-- thousand. It was not a cap; it was every thing lying on that island. So once
-- a second the island rewrote the whole of its ground: `rot_at = now()` on
-- every row, whether or not any damage had accrued worth writing down. On a
-- busy island that is tens of thousands of row versions a second, every one of
-- them WAL, and every one of them decoded again by realtime on the way out.
--
-- Broken down at ten thousand rows, the 975 ms goes:
--
--     3.3 ms   finding them
--     235 ms   ground_decay_rate, per row -- three catalogue lookups apiece
--     414 ms   decay_multiplier,  per row -- of which indoors() is 361
--     110 ms   the bare write of every row
--     2.3 ms   the delete that finds nothing
--
-- ## Charging it less often is not charging it less
--
-- The whole of the arithmetic is
--
--     dmg += rate * multiplier * (now - rot_at) / 3600
--
-- and `rot_at` is simply *when this was last charged*. Charging at t1 and
-- again at t2 adds exactly what charging once at t2 would have: the elapsed
-- terms telescope. It is linear in time, so the interval it is charged over
-- makes no difference to the total -- only to how coarsely it arrives.
--
-- So a thing is not worth touching until it has been lying there at least
-- `ground_step()`, which is five minutes. Ground decay is quoted per hour, so
-- five minutes is an eighth of the smallest unit anybody sees. Nothing rots
-- more slowly and nothing rots less; it rots in fewer, larger steps.
--
-- And a round charges at most `ground_rows()` of them, oldest first, which is
-- the shape `creature_sweep` already has. A backlog therefore costs a bounded
-- amount per round and drains over several, rather than landing on one round
-- whole. Oldest-first is what makes the cap a delay instead of a wall -- the
-- same lesson as the wildlife queue, which was ordered by id and starved
-- everything above the hundred and twentieth row for ever.
--
-- ## And two indexes, because the cheap version still read everything
--
-- With the step in, a quiet round still had to *discover* that nothing was
-- due, and the delete still had to scan every thing on the ground to find the
-- none of them at a hundred damage. Two partial indexes, both tiny, turn both
-- into a lookup that touches one to three pages:
--
--     item_ground_due   (world_id, coalesce(rot_at, '-infinity'))  280 kB
--     item_ground_gone  (world_id) where dmg >= 100                  8 kB
--
-- The `coalesce` is in the index because it is in the query: a thing that has
-- never been charged has a null `rot_at`, sorts first, and is charged nothing
-- -- the pass exists only to start its clock. `-infinity` says that in a form
-- a btree can range over, which `nulls first` in an ORDER BY cannot.
--
-- The tie-break on `i.id` had to go with it. With it, the planner could use
-- the index for the range but not for the order, so an incremental sort read
-- all thirty-seven thousand matching rows to be sure of the first two hundred
-- and fifty. Without it the limit stops the scan. Nothing is starved by
-- dropping it: rows sharing a `rot_at` are equally due, and the ones charged
-- move to the back of the queue by being charged.
--
-- ## Measured, on forty thousand things on the ground
--
--     a round with nothing due          3,795 ms  ->   0.56 ms
--     a round with the whole lot overdue 3,795 ms  ->  29 ms
--
-- The second figure is the cap doing its job and is the worst this can be. The
-- first is what almost every round actually is.
--
-- The next thing in here, if the ground ever gets big enough to matter again,
-- is `indoors()` at 36 microseconds a call -- a third of what is left. It is
-- asked per item rather than per tile, and things on the ground come in piles.
-- At two hundred and fifty rows a round it is nine milliseconds and not worth
-- the change.

set local lock_timeout = '3s';

/**
 * How long a thing has to have been lying there before charging it is worth a
 * write. Five minutes against a decay quoted per hour.
 */
create or replace function ground_step() returns interval
  language sql immutable as $fn$ select interval '5 minutes' $fn$;

/**
 * How many things one round may charge. A backlog is spread over rounds rather
 * than paid by one of them; oldest first, so spreading it is a delay and not a
 * starvation.
 */
create or replace function ground_rows() returns int
  language sql immutable as $fn$ select 250 $fn$;

/**
 * What is lying about, going off where it lies.
 *
 * Only the things that have been there a step, only as many as a round can
 * afford, and oldest first.
 */
create or replace function ground_sweep(p_world uuid) returns integer
 language plpgsql as $fn$
declare v_n int;
begin
  with due as (
    select i.id from item i
     where i.world_id = p_world and i.holder = 'ground'
       and coalesce(i.rot_at, '-infinity'::timestamptz) <= now() - ground_step()
     -- No tie-break on id: it would cost the ordered index scan, and rows
     -- sharing a moment are equally due.
     order by coalesce(i.rot_at, '-infinity'::timestamptz)
     limit ground_rows()
  )
  update item i set
      dmg = least(100, i.dmg + case when i.rot_at is null then 0
                   else ground_decay_rate(i) * decay_multiplier(p_world, i.gx, i.gy)
                        * extract(epoch from (now() - i.rot_at)) / 3600 end),
      rot_at = now()
    from due where i.id = due.id;
  get diagnostics v_n = row_count;
  delete from item where world_id = p_world and holder = 'ground' and dmg >= 100;
  return v_n;
end $fn$;

/*
 * The two indexes, asked for the way the class columns were.
 *
 * `create index` takes SHARE on `item`, which conflicts with every write to
 * it, and `item` is written by every action on the island. One long wait would
 * queue every one of them behind it; a short wait and another go does not. The
 * build itself is quick -- twenty-two and twenty-five milliseconds over a
 * hundred-megabyte table here -- because both are partial and index almost
 * nothing.
 *
 * Both in one subtransaction, so a go that gets the first and loses the second
 * rolls back to neither and the retry starts clean.
 */
do $$
declare i int;
begin
  for i in 1 .. 30 loop
    begin
      set local lock_timeout = '2s';
      execute $q$create index if not exists item_ground_due
                   on item (world_id, coalesce(rot_at, '-infinity'::timestamptz))
                 where holder = 'ground'$q$;
      execute $q$create index if not exists item_ground_gone
                   on item (world_id)
                 where holder = 'ground' and dmg >= 100$q$;
      return;
    exception when lock_not_available then
      perform pg_sleep(2);
    end;
  end loop;
  raise exception 'could not get a moment on item to index the ground';
end $$;

notify pgrst, 'reload schema';
select private.lock_doors();
