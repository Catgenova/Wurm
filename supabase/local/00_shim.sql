-- Everything Supabase already has and a bare Postgres does not.
--
-- The migrations next door are written against a real Supabase project and
-- must stay that way — no "if we are local" branches in them, or what is
-- tested here stops being what runs there. So the difference lives here
-- instead, and this file is never applied to the project.
create schema if not exists auth;

-- The real one, copied. It reads the signed token PostgREST puts on the
-- connection, so locally a test says who it is by setting the same thing.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

-- Supabase's own users table, enough of it for a foreign key to mean something.
create table if not exists auth.users (id uuid primary key);

/**
 * What Supabase grants on the auth schema, granted here too.
 *
 * Without it a client cannot so much as call `auth.uid()`, and every
 * security test passes for the wrong reason: "you may not mint yourself gold"
 * turns out to mean "you could not reach the function that says who you are".
 * A refusal that happens earlier than the one being tested proves nothing.
 */
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant select on auth.users to authenticated;
