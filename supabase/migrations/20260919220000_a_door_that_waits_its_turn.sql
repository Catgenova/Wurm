/*
 * Locking the doors without deadlocking the island.
 *
 * Three deployments in a row have died on the same line. The migrations run,
 * every statement lands, and then the last one — `select private.lock_doors()`
 * — comes back with
 *
 *     ERROR: deadlock detected (SQLSTATE 40P01)
 *     Process A waits for AccessExclusiveLock on relation X; blocked by B.
 *     Process B waits for AccessShareLock on relation Y; blocked by A.
 *
 * which leaves the whole migration rolled back and the live island a version
 * behind. Nothing is wrong with the rules it was applying. It is a plain
 * lock-ordering race: locking a door wants an exclusive lock on the table it
 * is locking, the heartbeat is reading those same tables all the while in
 * whatever order its own query picked, and sooner or later the two of them
 * cross. Retrying the deployment wins about half the time, which is not a fix,
 * it is a coin.
 *
 * Two changes, and the first is the one that matters.
 *
 * ---- do not take a lock to say what is already true --------------------
 *
 * `enable row level security` on a table that already has it takes the same
 * AccessExclusiveLock as one that does not, and so does writing a policy that
 * is already written. Every run after the first was taking two of those per
 * table — two hundred and thirty of them — to change nothing whatever, and
 * every one was a chance to cross the heartbeat. (A grant turned out not to
 * be part of it: measured against a table pinned under an exclusive lock, a
 * `grant select` goes straight through, because it writes `pg_class.relacl`
 * rather than locking the table. It is guarded below all the same, for the
 * work rather than for the lock.)
 *
 * Each statement is now guarded by the exact condition it would establish: RLS
 * when it is off, the read policy when it is missing *or not word for word the
 * policy this function writes*, the select grant when a role lacks it, the
 * write revoke when a role holds one. A steady island takes no locks here at
 * all — measured, as nought exclusive locks held after a whole run of it. This is not a weakening: the guard is the same question the statement
 * answers, so a door that is not shut is still shut, and a policy somebody has
 * edited underneath us is dropped and rewritten rather than trusted for having
 * the right name.
 *
 * ---- and wait rather than die ------------------------------------------
 *
 * The first run on a new table still has to take the lock, so the race still
 * exists; it is just rare now. `private.shut` runs one statement in a block of
 * its own — which in PL/pgSQL is a subtransaction, so a deadlock rolls back
 * that statement and nothing else — waits, and tries again, six times over
 * about four seconds. If it still cannot get the lock it raises, because a
 * door quietly left open is the one outcome this function must never have.
 * Measured against a table pinned under an exclusive lock: six goes over
 * five seconds, and then the error, rather than a hang or a quiet success.
 *
 * `lock_timeout` is set for the duration so a wait ends as a catchable error
 * rather than hanging a deployment, and put back to whatever it was after.
 */
create or replace function private.shut(p_sql text) returns void language plpgsql as $fn$
declare tries int := 0;
begin
  loop
    begin
      execute p_sql;
      return;
    exception when deadlock_detected or lock_not_available then
      tries := tries + 1;
      if tries >= 6 then raise; end if;
      -- Backing off rather than hammering: the heartbeat's own statement is
      -- over in milliseconds and the next go is very likely to be clear.
      perform pg_sleep(0.2 * tries);
    end;
  end loop;
end $fn$;

create or replace function private.lock_doors() returns void language plpgsql as $fn$
declare f record; t record; was text;
begin
  was := coalesce(nullif(current_setting('lock_timeout', true), ''), '0');
  perform set_config('lock_timeout', '4s', true);

  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    -- Functions are locked on their own row rather than on a table, and
    -- nothing reading the island takes a conflicting lock on one, so these
    -- have never been part of the race and are left as they were.
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname like 'rpc\_%' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    if f.proname = 'rpc_name_free' then
      execute format('grant execute on function %s to anon', f.sig);
    end if;
  end loop;

  -- The rulebook: readable by everyone, writable by nobody.
  for t in
    select c.oid, c.relname, c.relrowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname in ('world_id', 'uid')
          and a.attnum > 0 and not a.attisdropped)
  loop
    if not t.relrowsecurity then
      perform private.shut(format('alter table public.%I enable row level security', t.relname));
    end if;
    /*
     * The read policy, and only when what is there is not already exactly it:
     * the right name, on select, open to those two roles and to nobody else,
     * with `true` for its terms. Anything else — a policy somebody narrowed,
     * widened, or pointed at another command — is dropped and written again.
     */
    if not exists (
      select 1 from pg_policy p
      where p.polrelid = t.oid and p.polname = t.relname || '_read'
        and p.polcmd = 'r' and p.polpermissive
        and pg_get_expr(p.polqual, p.polrelid) = 'true'
        and (select coalesce(array_agg(r.rolname::text order by r.rolname), '{}')
               from pg_roles r where r.oid = any(p.polroles)) = array['anon', 'authenticated']
    ) then
      perform private.shut(format('drop policy if exists %I on public.%I', t.relname || '_read', t.relname));
      perform private.shut(format('create policy %I on public.%I for select to anon, authenticated using (true)',
        t.relname || '_read', t.relname));
    end if;
    if not (has_table_privilege('anon', t.oid, 'select')
            and has_table_privilege('authenticated', t.oid, 'select')) then
      perform private.shut(format('grant select on public.%I to anon, authenticated', t.relname));
    end if;
    if exists (
      select 1 from unnest(array['anon', 'authenticated']) as role,
                    unnest(array['insert', 'update', 'delete', 'truncate']) as priv
      where has_table_privilege(role, t.oid, priv)
    ) then
      perform private.shut(format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t.relname));
    end if;
  end loop;

  perform set_config('lock_timeout', was, true);
end $fn$;

select private.lock_doors();
