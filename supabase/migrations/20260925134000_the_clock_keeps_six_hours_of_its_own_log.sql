/*
 * pg_cron's log of its own runs, kept to what anybody reads of it.
 *
 * Run 652 could not push the creature crates: the project refused the first
 * ALTER with "cannot execute ALTER TABLE in a read-only transaction". A Free
 * Plan project goes read-only when its database passes 500 MB ("Understanding
 * Database and Disk Size", in Supabase's guides), and nothing that writes can
 * run until it is back under.
 *
 * pg_cron writes a row into `cron.job_run_details` for every run of every job
 * and never deletes one: "The records in the cron.job_run_details table are
 * not cleaned up automatically", in Supabase's own guide to it. `world-tick`
 * and `stock-tick` each run every second, which is 172,800 rows a day, and
 * nothing here had ever deleted one since the first clock was wound on 09-15.
 *
 * Nothing reads more than six hours of it. The deploy's readout counts the
 * last six hours of runs, and a fault in the island's own work is kept apart,
 * a week at a time, in `private.tick_fault`. So:
 *
 * - The backlog goes all at once, by emptying the table rather than deleting
 *   from it. A delete writes every row it takes out to the WAL, and a million
 *   of them onto a disk that is already full is the one thing worse than
 *   leaving them where they are. The deploy's "Room on the database" step
 *   empties it the same way when it finds the database read-only, which is
 *   what lets this be applied at all.
 * - And from now on a job deletes, every ten minutes, a run that succeeded
 *   once it is six hours old and any other run once it is a day old. That is
 *   about 45,000 rows at any one time.
 *
 * On a database without pg_cron -- the suite's, and any project without the
 * extension -- there is no log and nothing to do.
 */
set local lock_timeout = '3s';

do $$
begin
  if to_regclass('cron.job_run_details') is null then return; end if;
  truncate cron.job_run_details;
  -- `cron.schedule` is an upsert on the name, so a second deploy re-times the
  -- job rather than winding another beside it.
  perform cron.schedule('cron-log-trim', '*/10 * * * *',
    $trim$delete from cron.job_run_details
           where end_time < now() - interval '6 hours'
             and (status = 'succeeded' or end_time < now() - interval '1 day')$trim$);
end $$;
