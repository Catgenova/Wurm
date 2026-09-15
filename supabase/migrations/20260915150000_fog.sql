-- What you have already walked over, kept where the rest of you is kept.
--
-- "Every time the browser resets, the previously discovered fog of war resets
-- to black. That should be stored server side on a player table or
-- equivalent."
--
-- It was in `localStorage` and only in `localStorage`, which is the single
-- player game's answer and was never changed when the island became the game.
-- So a refresh, another phone, or a browser tidying up its site data, and a
-- 4096 island is black again with a body standing in the middle of it. Of all
-- the things that are yours — your skills, your pack, your deed, the face you
-- chose — the map of where you have been was the only one that lived in the
-- tab.
--
-- ## What is actually stored
--
-- One bit a tile, run-length encoded over the box the exploring falls inside,
-- and base64 on the way here. A road walked across an island is a few
-- kilobytes; an island somebody has combed is tens. `fog_bytes` is the ceiling
-- and it is generous by a wide margin — it is not there to be near, it is
-- there so that the one thing a browser writes by the yard cannot quietly
-- become free storage for something else.
--
-- ## Why this one is the browser's to say
--
-- Everything else a client asks for is checked here, because a client that
-- could decide things would be a client that could cheat. Fog is the exception
-- and it is worth saying why rather than leaving it looking like a hole: the
-- browser already works the whole island out from its seed, so there is
-- nothing in the map it does not have. Somebody who wanted their fog lifted
-- could lift it in the console and always could. It is not knowledge of the
-- world, it is a note about where *they* have been — and a note only they can
-- write, since only the tab knows what its camera has covered.
--
-- So this table takes what it is given, for the person who gives it, and never
-- for anybody else. `rpc_fog` has no uid to be handed: it writes yours.

create table if not exists fog (
  world_id uuid not null references world(id) on delete cascade,
  uid uuid not null,
  seen text not null,
  at timestamptz not null default now(),
  primary key (world_id, uid)
);
alter table fog enable row level security;

-- Yours and nobody else's — unlike `player`, which everybody on an island may
-- read. Where somebody has been is not a thing to hand to the person hunting
-- them.
drop policy if exists fog_read on fog;
create policy fog_read on fog for select to authenticated
  using (uid = (select auth.uid()));

/**
 * Hand over the fog of war, or take it away by handing over nothing.
 *
 * Only for a body that is actually on the island: without that check this is
 * a row anybody with an account may write against any island id they can
 * guess, which is a small thing and still not a thing to leave open.
 */
create or replace function rpc_fog(p_world uuid, p_seen text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int := coalesce(length(p_seen), 0);
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  if not exists (select 1 from player where world_id = p_world and uid = me) then
    raise exception 'you are not on that island';
  end if;
  if n > fog_bytes() then
    raise exception 'that is more fog than an island keeps (% of %)', n, fog_bytes()::int;
  end if;
  if n = 0 then
    delete from fog where world_id = p_world and uid = me;
    return jsonb_build_object('kept', 0);
  end if;
  insert into fog (world_id, uid, seen, at) values (p_world, me, p_seen, now())
    on conflict (world_id, uid) do update set seen = excluded.seen, at = now();
  return jsonb_build_object('kept', n);
end $$;

select private.lock_doors();
