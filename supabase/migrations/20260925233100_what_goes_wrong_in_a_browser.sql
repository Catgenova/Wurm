/*
 * What goes wrong in a browser, written down where somebody can read it.
 *
 * Asked for: "Record the errors players hit". An error nothing caught went to
 * the console of the one browser it happened in, where nobody was looking.
 * Now each distinct one goes to the island once a session (src/net/errors.ts)
 * and lands here, with the build it happened in and who it happened to, and
 * the deploy's readout lists the last day of them.
 *
 * Nobody reads this table through the API: row level security is on and there
 * is no policy, so a player can write a report through `rpc_report_error` and
 * read nothing back, their own included. The readout reads it as the owner.
 *
 * Bounded three ways, because a table that anything can write to is a table
 * that anything can fill: every text is cut to a length, one account is heard
 * twenty times an hour and no more, and anything a week old is let go of --
 * now and then, by the reports themselves, rather than by a job of its own.
 */
set local lock_timeout = '3s';

select private.shut($ddl$
  create table if not exists client_error (
    id bigint generated always as identity primary key,
    at timestamptz not null default now(),
    uid uuid not null,
    world_id uuid,
    build text not null,
    message text not null,
    stack text,
    place text
  )
$ddl$);
select private.shut('create index if not exists client_error_at on client_error (at)');
select private.shut('create index if not exists client_error_uid on client_error (uid, at)');
select private.shut('alter table client_error enable row level security');

create or replace function public.rpc_report_error(
  p_build text, p_message text, p_stack text default null, p_place text default null, p_world uuid default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := auth.uid();
begin
  if me is null or coalesce(p_message, '') = '' then return; end if;
  -- Twenty an hour from one account. A browser sends each distinct error once
  -- a session, so this is only ever reached by something that is not one.
  if (select count(*) from client_error where uid = me and at > now() - interval '1 hour') >= 20 then
    return;
  end if;
  insert into client_error (uid, world_id, build, message, stack, place)
  values (me, p_world, left(coalesce(nullif(p_build, ''), '?'), 40), left(p_message, 500),
          left(p_stack, 4000), left(p_place, 300));
  -- And the week-old ones, one report in fifty.
  if random() < 0.02 then
    delete from client_error where at < now() - interval '7 days';
  end if;
end $function$;

select private.lock_doors();
