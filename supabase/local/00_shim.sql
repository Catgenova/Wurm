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
-- (`alice` signs in as `alice@catgenova.github.io`), so the unique index Auth
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

/**
 * Realtime's corner of the database, enough of it for Broadcast from the
 * database to be written and read back.
 *
 * On a project `realtime.send` puts a row in `realtime.messages` for Realtime
 * to carry to whoever has joined the topic, and `realtime.topic()` is the
 * topic a join is being authorised for, which Realtime sets on the connection
 * it checks the policy with. Here the row simply stays, so a test can read
 * what would have gone out, and a test sets `realtime.topic` itself to ask
 * the policy who may join. Same names, same argument names, since the
 * migration that uses them checks both.
 */
create schema if not exists realtime;
create table if not exists realtime.messages (
  id bigserial primary key,
  topic text not null,
  extension text not null,
  payload jsonb,
  event text,
  private boolean default false,
  inserted_at timestamptz not null default now()
);
alter table realtime.messages enable row level security;
create or replace function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '')::text
$$;
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language plpgsql as $$
begin
  insert into realtime.messages (topic, extension, payload, event, private)
  values (topic, 'broadcast', payload, event, private);
end $$;
grant usage on schema realtime to anon, authenticated;
grant select on realtime.messages to anon, authenticated;
grant execute on function realtime.topic() to anon, authenticated;
