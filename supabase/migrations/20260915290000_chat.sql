-- A global chat, kept by the island.
--
-- The event window has had a Talk tab and a box to type in since long before
-- there was an island, and on an island neither did anything: `say` wrote a
-- line into the browser's own log and stopped there. Two people standing on
-- the same tile could not tell each other so.
--
-- Almost all of it was already built, for something else. `event` has a row
-- shape for "something that happened", a `uid` column meaning *who it is for*,
-- and a policy that reads
--
--     uid = auth.uid() or uid is null
--
-- so a row with no `uid` is already, exactly, a thing everybody on the island
-- may read. The table is already in the Realtime publication, the browser
-- already listens to it, and `island.ts` already shows any row whose `uid` is
-- null. A chat line is one of those rows with `kind = 'chat'`.
--
-- So this is the two things that were missing: a door to speak through,
-- because nothing may write `event` directly, and a backlog, because a chat
-- you cannot scroll back through after a refresh is not a persistent one.
--
-- ## `said_by`, which is not `uid`
--
-- `uid` on an event means *who it is for*, and a chat line is for everybody,
-- so it has to be null — that is the whole trick. But a line nobody owns
-- cannot be rate limited, and "twenty lines a minute" is a rule about a person
-- rather than about a row. `said_by` is who said it, and it is separate from
-- who it is for because those are genuinely different questions: every other
-- event in the game is *for* somebody and said by the island.

alter table event add column if not exists said_by uuid;
create index if not exists event_said_by on event (world_id, said_by, at desc)
  where said_by is not null;

/**
 * Say something to the island.
 *
 * Cleaned the same way the browser cleans it — newlines and tabs to spaces,
 * runs of whitespace collapsed, cut to `say_max()`. The browser's copy is a
 * courtesy so the box behaves; this is the rule.
 *
 * The name is read from the account rather than taken from the caller, for
 * the same reason `rpc_my_name` takes no argument: a chat line is the one
 * place in this game where a name is shown to other people, and a name a
 * client could put in the message would be a name anybody could wear.
 */
create or replace function rpc_say(p_world uuid, p_text text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_name text; v_text text; v_n bigint; v_recent int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from player where world_id = p_world and uid = me) then
    raise exception 'you are not on this island';
  end if;
  v_text := btrim(regexp_replace(
    regexp_replace(coalesce(p_text, ''), '[\r\n\t]+', ' ', 'g'), '\s{2,}', ' ', 'g'));
  v_text := left(v_text, say_max()::int);
  if v_text = '' then return null; end if;

  select count(*) into v_recent from event e
   where e.world_id = p_world and e.said_by = me and e.at > now() - interval '1 minute';
  if v_recent >= say_a_minute()::int then
    return jsonb_build_object('said', null,
      'why', 'That is a great deal of talking. Give the others a moment.');
  end if;

  v_name := coalesce(account_name(me),
                     (select p.name from player p where p.world_id = p_world and p.uid = me),
                     'somebody');
  insert into event (world_id, uid, said_by, text, kind)
  values (p_world, null, me, '<' || v_name || '> ' || v_text, 'chat')
  returning n into v_n;
  return jsonb_build_object('n', v_n, 'said', v_text, 'name', v_name);
end $$;

/**
 * What has been said lately, oldest first.
 *
 * Read on the way in, so that somebody arriving — or coming back from a
 * refresh — walks into a conversation rather than into a blank window. Only
 * the lines meant for everybody: your own private event log is already carried
 * by the join.
 */
create or replace function rpc_chat(p_world uuid, p_limit int default 60) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from player where world_id = p_world and uid = me) then
    raise exception 'you are not on this island';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('n', q.n, 'text', q.text, 'at', q.at) order by q.n)
      from (select e.n, e.text, e.at from event e
             where e.world_id = p_world and e.kind = 'chat' and e.uid is null
             order by e.n desc limit least(greatest(coalesce(p_limit, 60), 1), 200)) q),
    '[]'::jsonb);
end $$;

/*
 * How long it is kept, said out loud rather than left to be discovered.
 *
 * `prune_events` already sweeps this table on the clock and keeps a day of it,
 * and a chat line is an event, so a day is what the backlog is worth. That is
 * a choice rather than an oversight: a conversation you can scroll back to
 * yesterday is a conversation; one kept for ever is a table that only grows,
 * on an island where nothing else is kept for ever either.
 */

select private.lock_doors();
