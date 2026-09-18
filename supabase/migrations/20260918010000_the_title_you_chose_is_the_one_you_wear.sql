-- The title you chose is the one you wear
--
-- Reported from the island: *"my title seems to revert automatically to the
-- first on the list."*
--
-- It does, every few seconds, and the whole of why is that there was never a
-- door for it. The chain:
--
--   * `earn_titles` writes `title = coalesce(title, t.id)` — so the first
--     title anybody earns is worn, and it is never written again. That part is
--     right: it is a default, not an opinion, and it deliberately does not
--     tread on a choice.
--   * `wearTitle` in the browser sets `game.player.title` and stops there. It
--     tells nobody. On the solo world that was the whole of the rule and there
--     was nothing to tell.
--   * `rpc_settle` reports `title` on every heartbeat and the browser takes
--     it: `if (what.title !== undefined) game.player.title = what.title`.
--
-- So you click the one you want, wear it for as long as it takes the next beat
-- to come round, and the island — which has never been told and is answering
-- honestly — hands back the first one you ever earned. Nothing is broken
-- anywhere in that; there is simply a step missing, and the symptom of a
-- missing step is a setting that will not stay set.
--
-- This is the step. It answers a body on the island, it will not wear a title
-- that body has not earned, and null takes it off — which the browser has
-- always offered ("Worn. Click to take it off.") and the island has had no way
-- to hear either.

create or replace function rpc_wear_title(p_world uuid, p_title text)
  returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); p player;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me for update;
  if not found then raise exception 'you are not on this island'; end if;
  -- Refused rather than raised: a title you have not earned is somebody's
  -- stale window, not an attack, and what it wants back is what you *are*
  -- wearing so the window can put itself right.
  if p_title is not null and not (coalesce(p.titles, '[]'::jsonb) ? p_title) then
    return jsonb_build_object('title', p.title, 'why', 'You have not earned that one.');
  end if;
  update player set title = p_title where world_id = p_world and uid = me;
  return jsonb_build_object('title', p_title);
end $fn$;

select private.lock_doors();
