/*
 * How long a worker with nothing to do waits, read off the rule.
 *
 * `worker_rest` came in with its three numbers written into it -- four
 * seconds, a second more for every ten idle, never more than thirty -- and
 * the note telling players about it would have had to write them out again.
 * They are `WORKER_REST_FIRST`, `WORKER_REST_EVERY` and `WORKER_REST_MOST` in
 * src/game/keep.ts now, which reach the island as `worker_rest_first()`,
 * `worker_rest_every()` and `worker_rest_most()` through the definitions, and
 * this reads them. Same answer, from one place.
 */
set local lock_timeout = '3s';

create or replace function public.worker_rest(p_since timestamp with time zone)
 returns interval
 language sql
 stable
as $function$
  select make_interval(secs => least(worker_rest_most(),
    worker_rest_first() + extract(epoch from now() - coalesce(p_since, now())) / worker_rest_every()))
$function$;

select private.lock_doors();
