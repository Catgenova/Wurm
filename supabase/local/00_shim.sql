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

-- Supabase's own users table, enough of it for a foreign key to mean something
-- and, since accounts arrived, for a name to come out of.
--
-- The address is not decoration here: a username *is* an address in this game
-- (`alice` signs in as `alice@players.wurm.invalid`), so the unique index Auth
-- keeps over this column is the thing that makes a name yours, and a shim
-- without it would test the account rules against a database where two people
-- could be called the same thing.
create table if not exists auth.users (id uuid primary key);
alter table auth.users add column if not exists email text;
create unique index if not exists users_email_key on auth.users (lower(email));

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

/**
 * Supabase's default privileges, which are more generous than a bare
 * Postgres's and so must be copied here or every local test is run against a
 * stricter database than the real one.
 *
 * A real project grants ALL on every new table in `public` to `anon` and
 * `authenticated`, leaving row level security as the only thing between a
 * client and a write. Locally those grants did not exist, so "you may not
 * update your own row" passed for a reason that does not hold in production —
 * a table grant that was never there rather than a policy that refuses. The
 * live island found it; this is so that the local suite finds it next time.
 */
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
