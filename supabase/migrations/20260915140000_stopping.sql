-- Putting a job down, where the job actually is.
--
-- "A player that stops a task locally doesn't stop it on the server, the task
-- continues until completed."
--
-- Quite right, and it had never been anywhere else. Everything asked for goes
-- through `rpc_act`; nothing took it back. `cancelAction` in the browser
-- clears the bar, the job in hand and the queue behind it — all three of them
-- copies — and there was no word for saying so over here. So Escape, the Stop
-- button and clicking somewhere to walk each put down a picture of the job and
-- left the real one running: the tree still falls, the wind is still spent,
-- and everything lined up behind it still runs through to the end. Worse than
-- the bar being wrong, it is the bar being wrong in the direction that costs
-- you something.
--
-- Settling first is the part worth saying out loud. A go whose time is already
-- up has happened, whether or not anybody has been round to write it down yet:
-- `world_tick` gets to everybody in its own time and `rpc_settle` only when
-- somebody calls. Without the settle, the gap between a job coming due and
-- being noticed would be a window in which pressing Escape *undid finished
-- work* — thirty seconds of chopping refunded because nobody had looked. So:
-- settle what is due, then put down whatever is still in your hands.
--
-- It says nothing. The browser already writes "You stop chopping" and "You put
-- the other two jobs out of your mind" when you press the key, and those are
-- sentences about what somebody decided rather than claims about the world —
-- the island confirms them by the bar going out, which is the only
-- confirmation they need.

create or replace function rpc_cancel(p_world uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); p player; had text; dropped int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  -- What is due is done. Stopping is for what is still in your hands.
  perform settle(p_world, me);
  select * into p from player where world_id = p_world and uid = me for update;
  if not found then return jsonb_build_object('stopped', false, 'dropped', 0); end if;
  had := p.act;
  dropped := coalesce(jsonb_array_length(p.act_queue), 0);
  if had is null and dropped = 0 then
    return jsonb_build_object('stopped', false, 'dropped', 0);
  end if;
  update player set
      act = null, act_target = null, act_started = null, act_ends = null,
      act_left = null, act_queue = '[]'::jsonb, seen_at = now()
    where world_id = p_world and uid = me;
  return jsonb_build_object('stopped', had is not null, 'was', had, 'dropped', dropped);
end $$;

select private.lock_doors();
