-- Nobody writes to a table. Said out loud, rather than assumed.
--
-- The whole design rests on a client being able to read the island and change
-- nothing, and until now that rested in turn on `authenticated` simply never
-- having been granted a write. On a bare Postgres that is true. On a real
-- Supabase project it is not: default privileges hand ALL on every new table
-- in `public` to `anon` and `authenticated`, and row level security is then
-- the only thing in the way.
--
-- Which is *nearly* enough, and the gap is worth knowing. A refused INSERT
-- raises — "new row violates row-level security policy". A refused UPDATE or
-- DELETE does not: with no policy to match, it simply touches no rows and
-- reports success. So a client's attempt to move its own body came back
-- looking like it had worked, and only did not because there was nothing for
-- it to change.
--
-- Defence in depth, then, and an honest error instead of a quiet nothing.

do $$
declare t text;
begin
  foreach t in array array[
    'world', 'land_corner', 'land_tile', 'player', 'skill', 'item',
    'tile_change', 'event', 'item_def', 'tile_def', 'skill_def',
    'material_def', 'action_def'
  ] loop
    execute format('revoke insert, update, delete, truncate on table public.%I from anon, authenticated', t);
  end loop;
end $$;

/**
 * And for everything added from here on, so this never has to be remembered
 * again: no new table in `public` arrives writable.
 */
alter default privileges in schema public revoke insert, update, delete on tables from anon, authenticated;

select private.lock_doors();
