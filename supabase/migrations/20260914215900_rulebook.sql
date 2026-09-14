-- The rulebook was never readable.
--
-- `grant select` on the definition tables was a list of five names written
-- when there were five of them. Every table generated since — recipes, fish,
-- crops, species, traits, weapons, armour, wall types, metals, moulds,
-- pottery, crates, what a carcass gives, what a dish feeds — arrived with row
-- level security on, no read policy, and no grant. A client could not read one
-- row of any of it.
--
-- Nothing said so, because nothing had asked yet: the browser still reads its
-- own copy of the numbers out of TypeScript, and the local suite asks almost
-- everything as the owner. It took a live run through PostgREST, as a real
-- signed-in client, to get a straight no.
--
-- ## The rule rather than another list
--
-- A list would go stale again on the next `npm run defs`. There is a real
-- invariant to lean on instead: **everything that belongs to a player or an
-- island carries a `world_id`, and the rulebook does not.** So the doors are
-- set by that, every time they are locked, and a definition table generated
-- tomorrow is readable the moment it exists.

create or replace function private.lock_doors() returns void language plpgsql as $$
declare f record; t text;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname like 'rpc\_%' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;

  -- The rulebook: readable by everyone, writable by nobody.
  for t in
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'world_id'
          and a.attnum > 0 and not a.attisdropped)
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)',
      t || '_read', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
  end loop;
end $$;

select private.lock_doors();
