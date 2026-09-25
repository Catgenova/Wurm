/*
 * The land lets go of its history.
 *
 * Asked for: "Shrink the land-change history" -- `tile_change` was 829 MB of
 * the live project's 1,131 MB, 1.67 million rows.
 *
 * `tile_change` is what a browser replays to catch up from the moment it last
 * read the land. It was compacted and never aged out, because a row dropped
 * was ground somebody never heard about, and compacted it settled at one row
 * for every tile anybody had ever touched -- every tree the woods turn over at
 * dawn included. Nothing reads it from the beginning any more: a browser
 * coming ashore reads the land as it stands, from `land_tile` and
 * `land_corner` (`rpc_land_window`), and replays only what has happened since
 * that read.
 *
 * So the history is let go of, and the island says how far:
 *
 *   world.changes_from  every change up to this one may be gone. Nothing
 *                       with a higher number has been.
 *   compact_changes     lets go of changes older than `change_keep()` rather
 *                       than folding them to one a tile, oldest first, and
 *                       moves `changes_from` up to the last one it let go.
 *   rpc_land_window     never hands out a place in the history further back
 *                       than `changes_from`, so a browser that has just read
 *                       the land is never taken to be behind.
 *   rpc_settle          says `land_from` on every heartbeat. A browser whose
 *                       place in the history is further back than that --
 *                       a tab left asleep -- reads the land again instead of
 *                       replaying a history with a hole in it.
 *
 * And what is there now goes in one go, here. Emptied, not deleted from: a
 * delete of 1.67 million rows is 800 MB of WAL on the way to a table file that
 * stays the same size, and TRUNCATE hands the file back at once. Every island's
 * `changes_from` is set to the last change it had first, under a lock that
 * keeps new changes out until the table is empty, so no browser can be at a
 * place in the history that is gone without the island saying so. A browser
 * online through this reads the land it is standing on once more.
 */
set local lock_timeout = '3s';

select private.shut('alter table world add column if not exists changes_from bigint not null default 0');

-- One statement, so one transaction however the file is run: the lock is held
-- from before `changes_from` is read to after the table is empty.
do $$
begin
  perform private.shut('lock table tile_change in access exclusive mode');
  perform private.shut($ddl$
    update world w set changes_from = greatest(w.changes_from, m.top)
      from (select w2.id, (select max(n) from tile_change c where c.world_id = w2.id) as top from world w2) m
     where m.id = w.id and m.top is not null
  $ddl$);
  truncate tile_change;
end $$;

/*
 * Let go of, rather than folded: changes older than `change_keep()`, oldest
 * first, `sweep_rows()` at a go -- and `changes_from` moved up to the last of
 * them. Oldest first by number, so everything let go of is at or below
 * `changes_from`, which is the one thing a browser needs to be true of it.
 */
create or replace function public.compact_changes(p_world uuid)
 returns integer
 language plpgsql
as $function$
declare v_n int; v_top bigint;
begin
  with old as (
    select n from tile_change
     where world_id = p_world and at < now() - make_interval(secs => change_keep())
     order by n
     limit sweep_rows()
  ), gone as (
    delete from tile_change t using old where t.world_id = p_world and t.n = old.n
    returning t.n
  )
  select count(*), max(n) into v_n, v_top from gone;
  if v_top is not null then
    update world set changes_from = greatest(changes_from, v_top) where id = p_world;
  end if;
  return v_n;
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_land_window(p_world uuid, p_x0 integer, p_y0 integer, p_x1 integer, p_y1 integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me uuid := auth.uid();
  v_size int; v_n bigint;
  x0 int; y0 int; x1 int; y1 int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select size into v_size from world where id = p_world;
  if v_size is null then raise exception 'no such island'; end if;
  if not exists (select 1 from player where world_id = p_world and uid = me) then
    raise exception 'you are not on this island';
  end if;

  -- Clamped rather than refused: a box that runs off the edge of the island is
  -- what a body standing near the shore asks for, every time.
  x0 := greatest(0, least(v_size - 1, p_x0));
  x1 := greatest(x0, least(v_size - 1, p_x1));
  y0 := greatest(0, least(v_size, p_y0));
  y1 := greatest(y0, least(v_size, p_y1));
  if (x1 - x0 + 1) > land_ask() or (y1 - y0 + 1) > land_ask() then
    raise exception 'ask for a smaller square of the island';
  end if;

  -- Before the land, and see the note above. Never behind where the island has
  -- let its history go: a cursor from before that is one the browser takes to
  -- mean the land has to be read again.
  select greatest(coalesce((select max(n) from tile_change where world_id = p_world), 0),
                  (select changes_from from world where id = p_world)) into v_n;

  return jsonb_build_object(
    'n', v_n, 'x0', x0, 'y0', y0, 'x1', x1, 'y1', y1,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
          'y', c.y,
          'x0', x0,
          -- One more corner than there are tiles, in both directions: a row of
          -- squares from x0 to x1 stands on corners x0 to x1 + 1.
          'heights', encode(substring(c.heights from x0 * 2 + 1 for (x1 - x0 + 2) * 2), 'base64'),
          'dirt',    encode(substring(c.dirt    from x0     + 1 for (x1 - x0 + 2)), 'base64'),
          -- The row past the last row of squares comes for its corners alone.
          -- It has squares of its own on any island whose edge it is not, and
          -- sending them would lay a line of land outside the box that was
          -- asked for — right land in the wrong place, which is worse than no
          -- land, because the browser has not marked that row as read and will
          -- never think to ask for it again.
          'tiles',   case when c.y <= y1 then encode(substring(t.tiles from x0 + 1 for (x1 - x0 + 1)), 'base64') end,
          'data',    case when c.y <= y1 then encode(substring(t.data  from x0 + 1 for (x1 - x0 + 1)), 'base64') end,
          'rock',    case when c.y <= y1 then encode(substring(t.rock  from x0 + 1 for (x1 - x0 + 1)), 'base64') end)
        order by c.y)
      from land_corner c
      left join land_tile t on t.world_id = c.world_id and t.y = c.y
      -- One row past the last row of squares, for the same reason there is one
      -- more corner than there are squares across: a square at y1 stands on
      -- the corners at y1 and at y1 + 1. Asking only as far as y1 leaves the
      -- bottom edge of the window at whatever the browser had guessed, which
      -- is a seam of the generator's hillside along the foot of every window.
      where c.world_id = p_world and c.y between y0 and least(v_size, y1 + 1)), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_settle(p_seen bigint DEFAULT NULL::bigint, p_world uuid DEFAULT NULL::uuid, p_said bigint DEFAULT NULL::bigint, p_book boolean DEFAULT false, p_ticked jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); r record; n int := 0; p player; v_world uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;

  /*
   * Which island this is a heartbeat for, settled before anything is written.
   *
   * It used to be `order by seen_at desc limit 1` over every row with your uid
   * on it, and the update above it had no world in its `where` either — so one
   * beat set `seen_at` to the same instant on every island you have ever
   * joined, and then picked between them with a sort that had nothing left to
   * sort by. Three rows, one timestamp, no tie-break: the answer is whichever
   * one Postgres happens to hand back, and that is a choice of plan rather
   * than a fact about you.
   *
   * The same answer carries the hour and the bars, so when the choice moved,
   * both moved together — reported as "occasionally it switches randomly to
   * nighttime and hunger/thirst plummet until refreshed". A refresh put it
   * right because `rpc_join` names its island, and the next beat broke it
   * again because this one did not.
   *
   * So the browser says where it is standing. `rpc_settle` was the only door
   * of the twenty that did not take a `p_world`, and it is the one that runs
   * every minute of every session.
   */
  if p_world is not null then
    select world_id into v_world from player where uid = me and world_id = p_world;
  end if;
  if v_world is null then
    -- A page that has not been redeployed yet, and does not say. The best
    -- guess is still a guess, but `world_id` breaks the tie, so a session gets
    -- the same wrong island every beat rather than a different one each time.
    select world_id into v_world from player where uid = me
      order by seen_at desc, world_id limit 1;
  end if;
  if v_world is null then return jsonb_build_object('settled', 0); end if;

  -- Standing here, and only here. Keeping `seen_at` fresh on every island at
  -- once told each of them you were present, which is how a body could be left
  -- standing on an island you walked away from an hour ago.
  update player set seen_at = now(), away = false,
         seen_change = greatest(seen_change, coalesce(p_seen, 0))
    where uid = me and world_id = v_world
      and (away or seen_at < now() - interval '5 seconds' or coalesce(p_seen, 0) > seen_change);
  /*
   * And anything newly ticked off the journal.
   *
   * The ticking itself stays in the browser, because a goal is a question
   * about everything at once — the book, the pack, the ground, what is
   * standing on it — and eighty-five of those predicates are eighty-five
   * ports for another day. What the island owns is the *record*: which ones
   * are done, so that they stay done through a refresh and a change of
   * machine. An id nobody knows is kept as it is rather than refused; the
   * journal is a list of things somebody thought worth doing and there is
   * nothing here worth guarding.
   */
  if p_ticked is not null and jsonb_typeof(p_ticked) = 'array'
     and jsonb_array_length(p_ticked) > 0 then
    update player set
        ticked = (select coalesce(jsonb_agg(distinct g), '[]'::jsonb)
                  from (select jsonb_array_elements_text(coalesce(ticked, '[]'::jsonb)) as g
                        union
                        select jsonb_array_elements_text(p_ticked)) u),
        tally_at = now()
      where uid = me and world_id = v_world
        and not (coalesce(ticked, '[]'::jsonb) @> p_ticked);
  end if;
  for r in select world_id from player
    where uid = me and world_id = v_world and act is not null and act_ends <= now()
  loop
    n := n + settle(r.world_id, me);
  end loop;
  /*
   * And the body itself, which nothing had ever brought up to date.
   *
   * `settle` above runs only for somebody with a job whose time is up, and
   * `world_tick` only for the same — so a body standing still never got
   * hungry, never got its wind back and never healed. This is the heartbeat
   * every browser makes anyway, once a minute, and it is where a body that is
   * only standing there lives.
   */
  perform body_settle(v_world, me);
  select * into p from player where world_id = v_world and uid = me;
  -- Said before the row is read back, so what goes out is what was true when
  -- it was read rather than what was true a statement ago.
  if p.skills_at is not null and (p.skills_seen is null or p.skills_at > p.skills_seen) then
    update player set skills_seen = now() where world_id = v_world and uid = me;
  end if;
  if p.tally_at is not null and (p.tally_seen is null or p.tally_at > p.tally_seen) then
    update player set tally_seen = now() where world_id = v_world and uid = me;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'settled', n,
    -- How far the island has let the land's history go. A browser whose place
    -- in it is further back reads the land again; see `change_keep`.
    'land_from', (select nullif(changes_from, 0) from world where id = v_world),
    'act', p.act,
    'ends', p.act_ends,
    'left', p.act_left,
    -- And how many were asked for, which nothing wrote down until now. The bar
    -- says "3 of 10" off this and `left`; the browser used to keep its own
    -- tally, which is a second opinion about a number the island owns — and it
    -- only ever heard one for a job that *started*, never for one that waited
    -- its turn in the queue.
    'goes', p.act_goes,
    'secs', case when p.act_ends is null then null
                 else greatest(0, extract(epoch from (p.act_ends - now()))) end,
    'total', case when p.act_ends is null or p.act_started is null then null
                  else greatest(0.001, extract(epoch from (p.act_ends - p.act_started))) end,
    -- What is lined up behind it, and how much room is left in your head.
    'queue', coalesce((select jsonb_agg(jsonb_build_object(
                         'action', q->>'action',
                         'goes', greatest(1, coalesce((q->>'goes')::int, 1))) order by o)
                       from jsonb_array_elements(p.act_queue) with ordinality t(q, o)), '[]'::jsonb),
    'cap', case when v_world is null then null else queue_capacity(v_world, me) end,
    -- The bars, which have been the ones you came ashore with until now.
    'stats', p.stats,
    /*
     * And what you are carrying, which has never gone out at all.
     *
     * The island has kept wounds since they were ported — `wounds_settle`
     * drains your health from them, turns them bad, closes them over and says
     * so — and no door has ever mentioned them. So on an island the wound
     * window was empty however cut about you were, `bleeding()` was false, and
     * a bandage or a healing cover had nothing to be put on. The health you
     * were losing to them arrived as a number going down for no stated reason.
     *
     * Sent every beat rather than when they change, unlike the skill book
     * above: this is a column of the row that has already been read, not an
     * aggregate over a table, so there is nothing to save by leaving it out —
     * and `[]` has to be able to mean "they have all closed".
     */
    'wounds', coalesce(p.wounds, '[]'::jsonb),
    /*
     * And the rest of what you are, which the row has kept all along.
     *
     * Rest, the dishes favouring a trade, the knacks, the titles and what is
     * on your table: every one of them is a column the browser draws and none
     * of them has ever crossed. A hud saying "Rested 12m · everything ×2" off
     * a number the island never sent is a hud making it up.
     */
    'rested', coalesce(p.rested, 0),
    'boons', coalesce(p.boons, '[]'::jsonb),
    'knacks', coalesce(p.knacks, '{}'::jsonb),
    'titles', coalesce(p.titles, '[]'::jsonb),
    'title', p.title,
    'nutrition', coalesce(p.nutrition, '{}'::jsonb),
    /*
     * And what you have on.
     *
     * `equipped` is a column of this row that the island has written on every
     * `equip` and every `unequip` since the day those two were dispatched
     * here, and has never once handed back. So a browser that reloaded held
     * an empty record: nothing in the pack was marked worn, no armour of
     * yours counted towards what your back would take, and the only entry the
     * item menu would offer on the helm already on your head was `Wear or
     * wield`. Reported: *"there's no option to unequip gear."*
     *
     * Sent every beat rather than when it changes, like the wounds above and
     * for the same reason: it is a column of a row that has already been
     * read, so there is nothing to save by leaving it out -- and an empty
     * slot has to be able to mean "there is nothing on it".
     */
    'equipped', coalesce(p.equipped, '{}'::jsonb),
    /*
     * Every skill, but only when one of them has moved.
     *
     * The log says one went up and the window said it did not, which is why
     * this is here — and it was aggregating the whole book on every beat,
     * standing still, to hand back the forty numbers it handed back last time.
     * `skill_raise` stamps the player now, so a quiet beat costs nothing and a
     * busy one costs what it always did.
     *
     * Left out rather than emptied when nothing moved, and the browser applies
     * only the keys it is given.
     *
     * And `p_book`, which is the whole of what this got wrong. The stamp is on
     * the *player*, not on the session — so a browser that had just opened,
     * holding nothing but the starting value of every skill, was told nothing,
     * because the last session had already been told. Reported as mining
     * refusing an iron vein: "Iron vein needs mining 5 to work. Yours is 1.0",
     * with the island's own log line saying 13.26 two lines above it. Worse
     * than wrong — it locks: the seam you cannot start is the seam that would
     * have raised the skill that says you can.
     *
     * So the browser says whether it holds a book, the same way it says how
     * much of the talk it has heard. It asks once, gets the lot, and every
     * beat after that is the delta this was written for.
     */
    'skills', case when not coalesce(p_book, false)
                        and p.skills_seen is not null and p.skills_at is not null
                        and p.skills_at <= p.skills_seen then null
                   else coalesce((select jsonb_object_agg(s.id, s.value) from skill s
                                  where s.world_id = v_world and s.uid = me), '{}'::jsonb) end,
    /*
     * And the journal: what you have done, what you have made, and what is
     * ticked off.
     *
     * Behind the same cursor the book is behind, and for the same reason: it
     * only moves when something is noted, and a browser that has just opened
     * holds none of it. Three fields rather than one because they are three
     * different things — a count of goes, a record of a bench, and a list of
     * ids — and because the browser applies each of them differently.
     */
    'tally', case when not coalesce(p_book, false)
                       and p.tally_seen is not null and p.tally_at is not null
                       and p.tally_at <= p.tally_seen then null
                  else coalesce(p.tally, '{}'::jsonb) end,
    'ledger', case when not coalesce(p_book, false)
                        and p.tally_seen is not null and p.tally_at is not null
                        and p.tally_at <= p.tally_seen then null
                   else coalesce(p.ledger, '{}'::jsonb) end,
    'ticked', case when not coalesce(p_book, false)
                        and p.tally_seen is not null and p.tally_at is not null
                        and p.tally_at <= p.tally_seen then null
                   else coalesce(p.ticked, '[]'::jsonb) end,
    /*
     * And anything said since you last heard.
     *
     * Talk and the island's own lines arrive over Realtime, which is fast and
     * is not a promise: a channel that dropped for a moment loses them for
     * good, and `event` was the one table with no way to catch up. The browser
     * carries the highest `n` it has seen and gets whatever is newer, so a
     * dropped line is twenty seconds late rather than gone.
     */
    'said', case when p_said is null then null
                 when p_said <= 0 then '[]'::jsonb
                 else coalesce((select jsonb_agg(jsonb_build_object(
                        'n', e.n, 'text', e.text, 'kind', e.kind, 'at', e.at) order by e.n)
                      from event e
                      where e.world_id = v_world and e.n > p_said
                        and (e.uid is null or e.uid = me)
                      limit 60), '[]'::jsonb) end,
    /*
     * And where the talk had got to when you arrived.
     *
     * The catch-up above is for a channel that dropped, and it is counted from
     * the highest line the browser has heard. A browser that has just opened
     * has heard none, carries a nought, and was handed the *oldest* sixty
     * lines on the island — "You wash ashore on an untouched island", measured
     * on a body that came ashore a week ago — and then the next sixty on the
     * beat after that, walking forward through its own history while somebody
     * watched.
     *
     * So a nought means "I have just got here" rather than "from the
     * beginning": nothing is missed yet, and the mark to count from comes back
     * instead. What was said before you arrived is `rpc_chat`'s job and it
     * already does it, sixty lines of talk, which is a different question from
     * this one.
     */
    'saidTo', case when coalesce(p_said, 1) > 0 then null
                   else coalesce((select max(e.n) from event e where e.world_id = v_world), 0) end,
    -- The ore a prospector read, and how much longer it is lit for.
    'marks', case when jsonb_typeof(p.stats->'prospected') <> 'object' then null
                  else jsonb_build_object(
                    'tiles', p.stats->'prospected'->'tiles',
                    'secs', greatest(0, (p.stats->'prospected'->>'until')::double precision
                                        - extract(epoch from now()))) end,
    'queued', coalesce(jsonb_array_length(p.act_queue), 0),
    -- And what hour it is out there, which the browser had been keeping for
    -- itself. Seconds since the island began, so the browser works the hour
    -- out the way it always did rather than being handed a picture to draw.
    'time', case when v_world is null then null else world_time(v_world) end,
    -- The island's own reading of the same clock. Nothing draws from this: it
    -- is here so that two ends disagreeing about whether it is dark can be
    -- seen, rather than found out by a lantern that would not light.
    'night', case when v_world is null then null else is_night(v_world) end));
end $function$;

select private.lock_doors();
