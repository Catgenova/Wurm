/*
 * Live updates over Broadcast.
 *
 * Asked for: "Live updates over Supabase Broadcast. Realtime's constant
 * reading of the database's change log is its second-biggest single query
 * (419,000 calls). Sending updates as Broadcast messages instead would remove
 * it."
 *
 * A browser on the island listened to three tables through Postgres Changes:
 * `tile_change` for the nine blocks round it, `event` for the island, and
 * `item` for its own pack. Postgres Changes is Realtime reading the change
 * log over and over, whether anything has changed or not, and checking every
 * row it finds against the row level security of everybody listening: the
 * `SELECT wal->>...` in the deploy's readout, 424,115 calls at 16 ms each.
 * And it sent a message a row: the woods turning over at dawn is a few
 * hundred thousand rows of `tile_change`, each one a message to everybody
 * listening to its block.
 *
 * Now the island says what changed itself, with `realtime.send`, once a
 * statement rather than once a row, and only to where somebody is:
 *
 *   land:<island>:<block>   what changed in a block: the rows themselves, up
 *                           to `sent_inline()` of them, and past that only how
 *                           far the island has got, for the browser to read
 *                           the rest the way a join does. Sent only while
 *                           somebody who is not away stands in that block or
 *                           one next to it, which is what a browser listens to.
 *   said:<island>           a line for everybody on the island, while anybody
 *                           is on it;
 *   own:<island>:<person>   a line for one person, and their pack: the things
 *                           in it now and the ones that have left it; while
 *                           they are not away. Past `sent_inline()` lines, or
 *                           things, only that there are more.
 *
 * `private.hears` says who may listen to which, through a policy on
 * `realtime.messages`: an island's land and its lines to anybody with a body
 * on it, a person's own to that person and nobody else. These are private
 * channels; the bodies' channel, which browsers broadcast on to each other,
 * stays as it was.
 *
 * `rpc_join` answers `hears`, and a browser only listens this way to an
 * island that says it: one that has not had this migration keeps Postgres
 * Changes, so a deploy that stops half way leaves nothing deaf.
 *
 * A message that cannot be sent is a warning in the log and nothing more: the
 * write it describes still happens, and the browser's twenty-second reconcile
 * reads it.
 *
 * Out of the `supabase_realtime` publication go the three tables, and
 * `bridge`, `bridge_span` and `foundation`, which nothing has listened to
 * since they were put in it. With nobody asking for Postgres Changes, Realtime
 * stops reading the change log.
 */
set local lock_timeout = '3s';

/*
 * What this is written against, checked rather than assumed: a project whose
 * Realtime is older or newer than this would otherwise take the triggers and
 * fail every write to the three tables.
 */
do $check$
begin
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is null then
    raise exception 'realtime.send(jsonb, text, text, boolean) is not on this database';
  end if;
  if (select proargnames from pg_proc where oid = to_regprocedure('realtime.send(jsonb, text, text, boolean)'))
       is distinct from array['payload', 'event', 'topic', 'private'] then
    raise exception 'realtime.send does not take (payload, event, topic, private)';
  end if;
  if to_regprocedure('realtime.topic()') is null then
    raise exception 'realtime.topic() is not on this database';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'realtime' and table_name = 'messages' and column_name = 'extension') then
    raise exception 'realtime.messages has no extension column';
  end if;
end $check$;

/* Who may listen to a topic. */
create or replace function private.hears(p_topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_kind text := split_part(p_topic, ':', 1);
        v_world text := split_part(p_topic, ':', 2);
        v_rest text := split_part(p_topic, ':', 3);
        me uuid := (select auth.uid());
begin
  if me is null or p_topic is null
     or v_world !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_topic, ':', 4) <> '' then
    return false;
  end if;
  if not exists (select 1 from public.player where world_id = v_world::uuid and uid = me) then
    return false;
  end if;
  return case v_kind
    when 'land' then v_rest ~ '^[0-9]{1,9}$'
    when 'said' then v_rest = ''
    when 'own' then v_rest = me::text
    else false end;
end $$;
revoke all on function private.hears(text) from public, anon;
grant execute on function private.hears(text) to authenticated;

select private.shut('drop policy if exists island_hears on realtime.messages');
select private.shut($ddl$
create policy island_hears on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and (select private.hears((select realtime.topic()))))$ddl$);

/* One message. One that will not go is a warning, never a refused write. */
create or replace function private.send(p_topic text, p_event text, p_payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(p_payload, p_event, p_topic, true);
exception when others then
  raise warning 'nothing sent to %: %', p_topic, sqlerrm;
end $$;
revoke all on function private.send(text, text, jsonb) from public, anon, authenticated;

/* Is anybody who is not away on this island? */
create or replace function private.anybody_on(p_world uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.player where world_id = p_world and not away)
$$;
revoke all on function private.anybody_on(uuid) from public, anon, authenticated;

/* Is this person on this island and not away? */
create or replace function private.here(p_world uuid, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.player where world_id = p_world and uid = p_uid and not away)
$$;
revoke all on function private.here(uuid, uuid) from public, anon, authenticated;

/*
 * The land, a block a message. Somebody listens to a block when they stand in
 * it or next to it: `blocksAround` in the browser, the same nine.
 */
create or replace function private.land_out() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record; v_rows jsonb; v_top int := public.sent_inline()::int; v_size int := public.region_size()::int;
begin
  for r in
    select f.world_id, f.region, count(*) as n, max(f.n) as upto
      from fresh f group by f.world_id, f.region
  loop
    if not exists (select 1 from public.player p
                    where p.world_id = r.world_id and not p.away
                      and abs(floor(p.x / v_size)::int - r.region % 1024) <= 1
                      and abs(floor(p.y / v_size)::int - r.region / 1024) <= 1) then
      continue;
    end if;
    if r.n <= v_top then
      select jsonb_agg(jsonb_build_object('n', f.n, 'x', f.x, 'y', f.y, 'tile', f.tile, 'data', f.data,
                                          'corners', f.corners, 'soil', f.soil) order by f.n)
        into v_rows from fresh f where f.world_id = r.world_id and f.region = r.region;
      perform private.send('land:' || r.world_id || ':' || r.region, 'land', jsonb_build_object('rows', v_rows));
    else
      perform private.send('land:' || r.world_id || ':' || r.region, 'land', jsonb_build_object('upto', r.upto));
    end if;
  end loop;
  return null;
end $$;

/* Lines: the island's to the island, and a person's to them. */
create or replace function private.said_out() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record; v_top int := public.sent_inline()::int;
begin
  for r in
    select f.world_id, f.uid, count(*) as n, max(f.n) as upto,
           jsonb_agg(jsonb_build_object('n', f.n, 'uid', f.uid, 'text', f.text, 'kind', f.kind,
                                        'at', f.at, 'said_by', f.said_by) order by f.n) as lines
      from fresh f group by f.world_id, f.uid
  loop
    if r.uid is null then
      if not private.anybody_on(r.world_id) then continue; end if;
    elsif not private.here(r.world_id, r.uid) then
      continue;
    end if;
    perform private.send(
      case when r.uid is null then 'said:' || r.world_id else 'own:' || r.world_id || ':' || r.uid end,
      'said',
      case when r.n <= v_top then jsonb_build_object('lines', r.lines) else jsonb_build_object('upto', r.upto) end);
  end loop;
  return null;
end $$;

/*
 * A pack, to its owner: what is in it now, and what has left it. One function
 * for the three triggers; each branch reads only the transition tables its
 * own statement has, since a query in PL/pgSQL is planned when it is reached.
 * Only the rows of somebody who is here are read into a message at all.
 */
create or replace function private.pack_send(p_world uuid, p_uid uuid, p_n bigint, p_set jsonb, p_gone jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.send('own:' || p_world || ':' || p_uid, 'pack',
    case when p_n <= public.sent_inline() then jsonb_build_object('set', p_set, 'gone', p_gone)
         else jsonb_build_object('refresh', true) end);
end $$;
revoke all on function private.pack_send(uuid, uuid, bigint, jsonb, jsonb) from public, anon, authenticated;

create or replace function private.pack_out() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if tg_op = 'INSERT' then
    for r in
      select f.world_id, f.holder_uid as uid, count(*) as n, jsonb_agg(to_jsonb(f) order by f.id) as set
        from fresh f join public.player p on p.world_id = f.world_id and p.uid = f.holder_uid and not p.away
       where f.holder in ('player', 'bag')
       group by f.world_id, f.holder_uid
    loop
      perform private.pack_send(r.world_id, r.uid, r.n, r.set, '[]'::jsonb);
    end loop;
  elsif tg_op = 'UPDATE' then
    for r in
      with moved as (
        select f.world_id, f.holder_uid as uid, to_jsonb(f) as row, null::bigint as gone
          from fresh f join public.player p on p.world_id = f.world_id and p.uid = f.holder_uid and not p.away
         where f.holder in ('player', 'bag')
        union all
        select s.world_id, s.holder_uid, null, s.id
          from stale s join fresh f on f.id = s.id
          join public.player p on p.world_id = s.world_id and p.uid = s.holder_uid and not p.away
         where s.holder in ('player', 'bag')
           and (f.holder not in ('player', 'bag') or f.holder_uid is distinct from s.holder_uid))
      select m.world_id, m.uid, count(*) as n,
             coalesce(jsonb_agg(m.row) filter (where m.row is not null), '[]'::jsonb) as set,
             coalesce(jsonb_agg(m.gone) filter (where m.gone is not null), '[]'::jsonb) as gone
        from moved m group by m.world_id, m.uid
    loop
      perform private.pack_send(r.world_id, r.uid, r.n, r.set, r.gone);
    end loop;
  else
    for r in
      select s.world_id, s.holder_uid as uid, count(*) as n, jsonb_agg(s.id) as gone
        from stale s join public.player p on p.world_id = s.world_id and p.uid = s.holder_uid and not p.away
       where s.holder in ('player', 'bag')
       group by s.world_id, s.holder_uid
    loop
      perform private.pack_send(r.world_id, r.uid, r.n, '[]'::jsonb, r.gone);
    end loop;
  end if;
  return null;
end $$;

select private.shut('drop trigger if exists land_out on public.tile_change');
select private.shut($ddl$create trigger land_out after insert on public.tile_change
  referencing new table as fresh for each statement execute function private.land_out()$ddl$);
select private.shut('drop trigger if exists said_out on public.event');
select private.shut($ddl$create trigger said_out after insert on public.event
  referencing new table as fresh for each statement execute function private.said_out()$ddl$);
select private.shut('drop trigger if exists pack_in on public.item');
select private.shut($ddl$create trigger pack_in after insert on public.item
  referencing new table as fresh for each statement execute function private.pack_out()$ddl$);
select private.shut('drop trigger if exists pack_moved on public.item');
select private.shut($ddl$create trigger pack_moved after update on public.item
  referencing old table as stale new table as fresh for each statement execute function private.pack_out()$ddl$);
select private.shut('drop trigger if exists pack_gone on public.item');
select private.shut($ddl$create trigger pack_gone after delete on public.item
  referencing old table as stale for each statement execute function private.pack_out()$ddl$);

/* Out of the publication, so nothing is left for Postgres Changes to read. */
do $pub$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['tile_change', 'event', 'item', 'bridge', 'bridge_span', 'foundation'] loop
      if exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        perform private.shut(format('alter publication supabase_realtime drop table public.%I', t));
      end if;
    end loop;
  end if;
end $pub$;

/*
 * And two doors that were never meant to be open: `private.shut` runs
 * whatever SQL it is handed and `private.lock_doors` rewrites every grant,
 * and `authenticated` could execute both. Nothing a browser can reach calls
 * them -- `private` is not a schema the API serves -- but a grant is not a
 * thing to leave lying about on the chance that stays true.
 */
revoke all on function private.shut(text) from public, anon, authenticated;
revoke all on function private.lock_doors() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_join(p_world uuid, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); w world; p player; born boolean := false; v_look jsonb; v_was_away boolean := false;
        v_since timestamptz; v_away jsonb;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into w from world where id = p_world;
  if not found then raise exception 'no such island'; end if;
  if not w.ready then raise exception 'that island is still being laid down'; end if;
  select a.look into v_look from account a where a.uid = me;

  select * into p from player where world_id = p_world and uid = me;
  if not found then
    insert into player (world_id, uid, name, x, y, stats, look)
    values (p_world, me, coalesce(nullif(trim(p_name), ''), 'Wanderer'), w.spawn_x + 0.5, w.spawn_y + 0.5,
            '{"health":1,"stamina":1,"hunger":1,"thirst":1}'::jsonb,
            look_clean(coalesce(v_look, look_random())))
    returning * into p;
    born := true;
    perform starter_kit(p_world, me);
    perform tell(p_world, me, 'You wash ashore on an untouched island with a few tools and your wits.', 'system');
  else
    v_was_away := p.away;
    v_since := coalesce(p.left_at, p.seen_at);
    select jsonb_agg(jsonb_build_object('what', t.what, 'def', t.def, 'n', t.n, 'silver', t.silver)
                     order by t.what, t.n desc, t.def)
      into v_away from away_tally t where t.world_id = p_world and t.uid = me;
    delete from away_tally where world_id = p_world and uid = me;
    update player set seen_at = now(), away = false, left_at = null,
           name = coalesce(nullif(trim(p_name), ''), name),
           look = look_clean(coalesce(v_look, nullif(player.look, '{}'::jsonb), look_random()))
      where world_id = p_world and uid = me returning * into p;
    perform tell(p_world, me,
      case when v_was_away then 'You come back to the island. Whatever you were doing has long since stopped.'
           else 'Your journey continues where you left off.' end, 'system');
  end if;

  return jsonb_build_object(
    'world', to_jsonb(w) - 'made_by',
    'you', to_jsonb(p),
    'new', born,
    'time', world_time(p_world),
    -- Land, lines and the pack come as Broadcast messages from this island.
    'hears', true,
    -- What happened to your things while you were away, and for how long you were.
    'away', case when v_away is not null then jsonb_build_object(
      'secs', greatest(0, extract(epoch from now() - v_since))::bigint, 'tally', v_away) end);
end $function$;

select private.lock_doors();
