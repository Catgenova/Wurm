-- The address a username wears, and why it has to change.
--
-- `20260915025000_accounts.sql` turned the username into an e-mail address so
-- that Auth would have something to sign people in by, and picked the suffix
-- for what looked like an unanswerable reason: `.invalid` is reserved by RFC
-- 2606, can never be delegated to anybody, and so reaches no one, forever.
--
-- It reaches no one so thoroughly that Auth will not take it. GoTrue keeps a
-- list of host suffixes it refuses outright — `.invalid`, `.test`, `.local`,
-- `.localhost`, `.example` — and that list lives in the server's own source,
-- not in a project's configuration. So every attempt to make an account came
-- back "Email address is invalid", and the landing page passed that on as
-- *its Auth settings need that restriction lifted*, which is advice nobody
-- could act on. One migration earlier that page became the only way ashore.
-- Between the two, nobody could play at all.
--
-- The suffix becomes a host that is real:
--
--     alice  ->  alice@catgenova.github.io
--
-- which is the site this game is served from. It resolves, because `*.github.io`
-- is a DNS wildcard, so an Auth that checks whether a domain exists at all is
-- satisfied by it. It publishes no MX record, so mail addressed there is
-- refused by the internet rather than delivered to a stranger. The property
-- the old suffix was chosen for survives intact; only where it comes from
-- changes — from a promise in a standards document to the plain absence of a
-- mailbox.
--
-- ## Both are recognised. Only one is handed out.
--
-- `name_domains()` is the list, the one in use first. `name_email()` gives out
-- that first one and nothing else, so every account made from here on is made
-- at the new host. `email_name()` and `rpc_name_free()` read the whole list,
-- because an account made under the old suffix — if the refusal ever let one
-- through — is still somebody's account, and a name reserved under either
-- suffix is still reserved.
--
-- No row is rewritten. An address in `auth.users` belongs to Auth, and a
-- migration that went editing them would be reaching into the one index that
-- makes a name mean anything in the first place.

/** Every suffix this island answers to. The first is the one it hands out. */
create or replace function name_domains() returns text[] language sql immutable as $$
  select array['@catgenova.github.io', '@players.wurm.invalid']
$$;

/** The suffix a new username wears. */
create or replace function name_domain() returns text language sql immutable as $$
  select (name_domains())[1]
$$;

/**
 * And the username inside an address, or null if the address is none of ours.
 *
 * Compared by `right()` rather than by `like`, because `_` is a wildcard in
 * `like` and an ordinary character in a domain. Reading the list rather than
 * the single current suffix is what keeps an account made under the old one
 * from quietly becoming nameless the moment this migration runs.
 */
create or replace function email_name(p_email text) returns text language sql immutable as $$
  select left(lower(p_email), length(p_email) - length(d))
    from unnest(name_domains()) as d
   where p_email is not null
     and right(lower(p_email), length(d)) = d
   limit 1
$$;

/**
 * Is this name still going spare?
 *
 * Still only a courtesy — what makes a name yours is signing up for it, and
 * the thing that actually refuses a second alice is the unique index Auth
 * keeps over its own addresses. What changes here is the reach: a name is free
 * only when it is free under every suffix, so somebody who got ashore before
 * the suffix moved does not find their name being handed to a stranger.
 */
create or replace function rpc_name_free(p_name text) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare v_name text := lower(trim(coalesce(p_name, '')));
begin
  if not name_ok(v_name) then return false; end if;
  return not exists (
    select 1 from auth.users u, unnest(name_domains()) as d
     where lower(u.email) = v_name || d);
end $$;

select private.lock_doors();
