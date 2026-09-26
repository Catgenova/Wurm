-- Who keeps every island on the project, from the address the deploy is given.
--
-- The migrate job in .github/workflows/island.yml runs this after the push,
-- when the ISLAND_OWNER_EMAIL secret is set, as
--
--   psql -X -q -t -A -v ON_ERROR_STOP=1 -v email="$ISLAND_OWNER_EMAIL" -f supabase/owner.sql
--
-- and supabase/test/keeper.ts runs it the same way against a test address.
--
-- The address comes in as a psql variable and reaches the server as a quoted
-- literal (`:'email'`), so nothing in it can become SQL, and it is never
-- printed: errors are terse, which leaves the statement out of them, and what
-- comes back is three counts -- accounts with that address, how many of them
-- were made island owners by this run, and how many island owners there are
-- now -- as `matched|added|owners`.
--
-- An account signed up with the address becomes an owner of every island
-- (20260925234600). Nobody is taken off: an address changed in the secret
-- adds the new account and leaves the old one where it was.
\set ON_ERROR_STOP on
\set VERBOSITY terse
with found as (
  select u.id from auth.users u
   where u.email is not null and lower(u.email) = lower(btrim(:'email'))
), added as (
  insert into private.island_owner (uid)
  select f.id from found f
  on conflict (uid) do nothing
  returning uid
)
select (select count(*) from found) || '|' || (select count(*) from added) || '|'
       || ((select count(*) from private.island_owner) + (select count(*) from added));
