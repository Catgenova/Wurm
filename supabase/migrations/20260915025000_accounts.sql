-- An account, and a name that is actually yours.
--
-- Until now anybody was anybody. The island read `?me=Wanderer` out of the
-- address bar and the only thing standing behind that name was an anonymous
-- sign-in that any tab can mint for itself in a millisecond. That is fine for
-- one person on one island and it is nothing at all once there are two: a name
-- nobody has to prove is not a name, it is a label, and two people can wear
-- the same one.
--
-- So: a username and a password, set up on a landing page of its own.
--
-- ## The name is the login, and that is the whole trick
--
-- Supabase Auth signs you in by e-mail address. There is no e-mail address
-- here and there is not going to be one, so the username *becomes* the
-- address:
--
--     alice  ->  alice@players.wurm.invalid
--
-- `.invalid` is reserved by RFC 2606 and can never be delegated to anybody, so
-- that address is guaranteed to reach no one, forever. Two things fall out of
-- the trick, and both are worth more than they look:
--
--   * **Signing up is the reservation.** There is no window between "the name
--     was free when I looked" and "the name is mine" for a second browser to
--     slip into, because the index that makes it true is the unique one Auth
--     already keeps over its own addresses. No lock, no retry, no race, and
--     no second authority that could ever disagree with the first.
--
--   * **The name cannot be forged.** `rpc_my_name()` takes no argument: it
--     reads the caller's own address back out of `auth.users` and cuts the
--     suffix off it. A browser that signed up as `alice` cannot file itself as
--     `bob`, because it never gets to say. Had the function taken a name and
--     trusted it, every account in this game would have been one RPC call away
--     from being anybody at all — which is exactly the hole the whole change
--     exists to close, reopened one layer down.
--
-- ## What this cannot do, said here rather than in a commit message
--
-- The password never comes near Postgres. Auth takes it, hashes it, and this
-- database only ever learns that a row appeared. So the eight-character
-- minimum and the check against known-breached passwords both happen in the
-- browser, and a check in the browser is not a control — it is a courtesy to
-- the honest. The settings that turn them into controls live in the project's
-- own Auth configuration and nowhere a migration can reach:
--
--     Authentication -> Sign In / Providers -> Minimum password length = 8
--     Authentication -> Sign In / Providers -> Prevent use of leaked passwords
--
-- And one more, without which none of this works at all, because a player with
-- an address at `.invalid` can never answer a confirmation mail:
--
--     Authentication -> Sign In / Providers -> Confirm email = off
--
-- The landing page says so plainly when it runs into it, rather than sitting
-- there looking like it worked.

/** The suffix every username wears so that Auth has an address to sign in. */
create or replace function name_domain() returns text language sql immutable as $$
  select '@players.wurm.invalid'
$$;

/**
 * Is that a username at all?
 *
 * Three to twenty, a letter first, then letters, digits, underscore, hyphen.
 * Narrow on purpose: it has to survive being the local part of an address,
 * being drawn over somebody's head at a hundred pixels, and being said out
 * loud to a stranger who then has to type it.
 */
create or replace function name_ok(p_name text) returns boolean language sql immutable as $$
  select p_name is not null and p_name ~ '^[a-z][a-z0-9_-]{2,19}$'
$$;

/** The address a username signs in with. */
create or replace function name_email(p_name text) returns text language sql immutable as $$
  select lower(trim(coalesce(p_name, ''))) || name_domain()
$$;

/**
 * And the username inside an address, or null if the address is not one of
 * ours. Compared by `right()` rather than by `like`, because `_` is a wildcard
 * in `like` and a perfectly ordinary character in a domain — the day somebody
 * changes the suffix to one with an underscore in it is not the day to find
 * that out.
 */
create or replace function email_name(p_email text) returns text language sql immutable as $$
  select case when p_email is not null
               and right(lower(p_email), length(name_domain())) = name_domain()
              then left(lower(p_email), length(p_email) - length(name_domain()))
         end
$$;

/**
 * Who has a name here.
 *
 * Derived, not declared: every row is the shadow of a row in `auth.users`, and
 * the only thing that ever writes it is `rpc_my_name()`. It is kept as its own
 * table all the same, because `auth.users` is not a table a browser may read
 * and the island still wants to be able to say who somebody is.
 */
create table if not exists account (
  uid uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  made_at timestamptz not null default now()
);
create unique index if not exists account_name_key on account (lower(name));
alter table account enable row level security;

/**
 * Names are public to anybody who has come ashore: they are written over
 * people's heads. There is no insert, update or delete policy, and that is not
 * an omission — with row level security on, a missing policy is a refusal, so
 * the only way a row gets into this table is through the function below.
 */
drop policy if exists account_read on account;
create policy account_read on account for select to authenticated using (true);

/**
 * Is this name still going spare?
 *
 * A courtesy, and it is worth being clear that it is only a courtesy: what
 * makes a name yours is signing up for it, and between this answer and that
 * there is nothing at all stopping somebody else. The cost of losing that race
 * is one message on the way in, because the thing that actually refuses is the
 * unique index over the addresses, not this.
 */
create or replace function rpc_name_free(p_name text) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare v_name text := lower(trim(coalesce(p_name, '')));
begin
  if not name_ok(v_name) then return false; end if;
  return not exists (select 1 from auth.users u where lower(u.email) = name_email(v_name));
end $$;

/**
 * Your own name, filed the first time you ask for it.
 *
 * Takes nothing, which is the entire point: the name comes out of the address
 * you signed in with, so there is no argument for a client to lie in. Filing
 * on read rather than on sign-up means there is no half-made account either —
 * a browser that signed up and then closed the tab before it could call
 * anything gets its row the next time it asks, and asking twice costs nothing.
 *
 * Anonymous accounts have no address and get null back. They are still welcome
 * on an island; they simply have no name they can prove.
 */
create or replace function rpc_my_name() returns text
  language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_name text;
begin
  if v_uid is null then return null; end if;
  select email_name(u.email) into v_name from auth.users u where u.id = v_uid;
  if v_name is null or not name_ok(v_name) then return null; end if;
  insert into account (uid, name) values (v_uid, v_name) on conflict (uid) do nothing;
  return v_name;
end $$;

/** What somebody on your island is called, for drawing over their head. */
create or replace function account_name(p_uid uuid) returns text language sql stable as $$
  select a.name from account a where a.uid = p_uid
$$;

/**
 * The rulebook sweep, and the first table to break its rule.
 *
 * `lock_doors()` decides what belongs to the rulebook by asking whether a
 * table has a `world_id`: no island of its own meant it was a definition, so
 * it was made readable by everybody and writable by nobody. That held for a
 * hundred and twenty migrations, and `account` is the first table to walk
 * straight through it — a roll of who exists belongs to no island, and it is
 * not a definition either.
 *
 * Left alone the sweep dropped the policy written forty lines above and put
 * back one granting `anon` a read of it, so that anybody holding the
 * publishable key could pull every username in the game in a single request.
 * It was found by asking as a stranger in the suite rather than by reading
 * this function, which is the only way this sort of thing is ever found.
 *
 * So the rule gets the other half it always wanted: the rulebook is what has
 * no island **and** nobody in it. A `uid` column means the rows are about
 * people, and people's rows are answered for by their own policies.
 *
 * The same sweep is also where `rpc_name_free` is opened to strangers, rather
 * than in a `grant` after the call. That is the difference between a door that
 * stays open and one the next migration to call `lock_doors()` quietly shuts —
 * and the next migration to call `lock_doors()` is every migration.
 *
 * It does tell an unsigned-in stranger whether one name is taken, and that is
 * worth saying out loud rather than leaving implied: it is an enumeration
 * oracle. It is also an unavoidable one, because here the name *is* the login
 * — the same fact falls out of trying to sign up for a name, or of failing to
 * sign in as it. Having the page answer kindly spends nothing that was not
 * already spent. A read of the whole table would have been something else
 * entirely, which is why the paragraph above matters.
 */
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
    if f.proname = 'rpc_name_free' then
      execute format('grant execute on function %s to anon', f.sig);
    end if;
  end loop;

  -- The rulebook: readable by everyone, writable by nobody.
  for t in
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname in ('world_id', 'uid')
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
