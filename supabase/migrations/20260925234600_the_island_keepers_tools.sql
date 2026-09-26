/*
 * The island's keepers, and four tools for them.
 *
 * Asked for: "Island tools for the owner: who's online, move a stuck player,
 * mute, clear a stray pile." Each of those was a query somebody had to write
 * against the database by hand.
 *
 * ## Who keeps an island
 *
 * `private.is_island_owner` is the one place that says, and it says yes for
 * two kinds of person:
 *
 *   private.island_owner  anybody in it keeps every island on the project. The
 *                         deploy fills it from the ISLAND_OWNER_EMAIL secret
 *                         (`supabase/owner.sql`); nothing a browser can reach
 *                         writes to it.
 *   world.made_by         whoever founded an island keeps that island, and no
 *                         other.
 *
 * Every door below asks it before anything else -- before it so much as counts
 * the call -- and refuses everybody it does not say yes for: nobody signed in,
 * a player of the island, a player of another island, the founder of another
 * island.
 *
 * ## The doors
 *
 *   rpc_owner_am_i    whether you keep this island. The browser asks once,
 *                     after the join, and the Island keeper window and the
 *                     pile's menu row exist only when the answer is yes.
 *   rpc_owner_online  everybody with a body on the island: where they stand,
 *                     how long since the island heard from them, whether they
 *                     are away, whether they are muted and until when, and
 *                     where Move would put them.
 *   rpc_owner_move    a body to the token of the settlement it founded, or to
 *                     where newcomers come ashore when it founded none; what it
 *                     was doing stopped and its queue emptied; off whatever it
 *                     rode, drove, pulled or was aboard. It is told who moved
 *                     it and where, and its browser is sent the spot at once.
 *   rpc_owner_mute    for as many seconds as the keeper says, or until lifted.
 *   rpc_owner_unmute  lifted.
 *   rpc_owner_clear   everything lying on the ground on one tile, deleted, and
 *                     the keeper told what and how many.
 *
 * ## What a mute shuts
 *
 * The doors that carry somebody's words to somebody else: `rpc_say` (aloud, to
 * the island), `rpc_letter` (to one person) and the note on `rpc_parcel`. Each
 * refuses in one sentence saying the body is muted and until when. A parcel
 * with no note still goes: the line it travels with is the island's,
 * `parcel_note()`, not the sender's. An emote carries an id from a fixed list
 * and no words, and goes from browser to browser without passing a door.
 *
 * ## The trail
 *
 * `private.owner_log`: who did what, to whom, on which island, and what came of
 * it, written by every door. The list of who is on is asked for again and
 * again while its window is open, so a look within ten minutes of the last one
 * is counted on that row rather than starting another.
 *
 * No browser reads any of the three tables: row level security is on, there
 * is no policy, and nothing is granted to `anon` or `authenticated`.
 */
set local lock_timeout = '3s';

select private.shut($ddl$
  create table if not exists private.island_owner (
    uid uuid primary key references auth.users (id) on delete cascade,
    added_at timestamptz not null default now()
  )
$ddl$);
select private.shut('alter table private.island_owner enable row level security');

/* A mute: until when, `null` for until a keeper lifts it, and who set it. */
select private.shut($ddl$
  create table if not exists private.island_mute (
    world_id uuid not null references public.world (id) on delete cascade,
    uid uuid not null,
    until timestamptz,
    by_uid uuid not null,
    at timestamptz not null default now(),
    primary key (world_id, uid)
  )
$ddl$);
select private.shut('alter table private.island_mute enable row level security');

select private.shut($ddl$
  create table if not exists private.owner_log (
    n bigint generated always as identity primary key,
    at timestamptz not null default now(),
    owner uuid not null,
    world_id uuid not null references public.world (id) on delete cascade,
    what text not null,
    whom uuid,
    detail jsonb not null default '{}'::jsonb
  )
$ddl$);
select private.shut('create index if not exists owner_log_world on private.owner_log (world_id, owner, what, n)');
select private.shut('alter table private.owner_log enable row level security');

revoke all on table private.island_owner, private.island_mute, private.owner_log from public, anon, authenticated;

/* Whether somebody keeps this island: in `private.island_owner`, or its founder. */
create or replace function private.is_island_owner(p_world uuid, p_uid uuid) returns boolean
language sql stable set search_path = '' as $fn$
  select p_uid is not null and exists (
    select 1 from public.world w
     where w.id = p_world
       and (w.made_by = p_uid or exists (select 1 from private.island_owner o where o.uid = p_uid)))
$fn$;
revoke all on function private.is_island_owner(uuid, uuid) from public, anon, authenticated;

/*
 * A length of time as anybody says it: "3 hours and 12 minutes", "1 day",
 * "25 minutes". The browser's `awayFor` (src/game/away.ts) in the same words,
 * rounded the same way; supabase/test/keeper.ts holds the two together.
 */
create or replace function public.time_words(p_secs double precision) returns text
language sql immutable as $fn$
  select case
    when r.d > 0 then r.d || ' day' || case when r.d = 1 then '' else 's' end
      || case when r.h > 0 then ' and ' || r.h || ' hour' || case when r.h = 1 then '' else 's' end else '' end
    when r.h > 0 then r.h || ' hour' || case when r.h = 1 then '' else 's' end
      || case when r.mi > 0 then ' and ' || r.mi || ' minute' || case when r.mi = 1 then '' else 's' end else '' end
    else r.mi || ' minute' || case when r.mi = 1 then '' else 's' end end
  from (select q.m / 1440 as d, (q.m % 1440) / 60 as h, q.m % 60 as mi
          from (select greatest(1, floor(coalesce(p_secs, 0) / 60 + 0.5))::bigint as m) q) r
$fn$;

/* What a parcel sent without a note carries in its letter: the island's words, not the sender's. */
create or replace function public.parcel_note() returns text
language sql immutable as $fn$ select 'A parcel.'::text $fn$;

/* When a mute ends, as a line says it: "until 25 Sep 15:05 UTC". */
create or replace function private.mute_ends(p_until timestamptz) returns text
language sql stable set search_path = '' as $fn$
  select 'until ' || to_char(p_until at time zone 'UTC', 'FMDD Mon HH24:MI') || ' UTC'
$fn$;
revoke all on function private.mute_ends(timestamptz) from public, anon, authenticated;

/* What a mute shuts, said to whoever it is about ("you") or to a keeper ("they"). */
create or replace function private.mute_shuts(p_you boolean) returns text
language sql immutable set search_path = '' as $fn$
  select 'nothing ' || case when p_you then 'you say' else 'they say' end
    || ' aloud, write in a letter or put in a parcel note is sent'
$fn$;
revoke all on function private.mute_shuts(boolean) from public, anon, authenticated;

/*
 * Why somebody may not be heard: the sentence every door that carries words
 * refuses with, or null when they are not muted. A mute whose time has passed
 * is no mute; the row is left for the next mute or unmute to replace.
 */
create or replace function private.muted_why(p_world uuid, p_uid uuid) returns text
language plpgsql stable set search_path = '' as $fn$
declare v_until timestamptz;
begin
  select m.until into v_until from private.island_mute m
   where m.world_id = p_world and m.uid = p_uid and (m.until is null or m.until > now());
  if not found then return null; end if;
  return 'You are muted on this island '
    || case when v_until is null then 'until one of its keepers lifts it'
            else 'for ' || public.time_words(extract(epoch from v_until - now())) || ' more, '
                 || private.mute_ends(v_until) end
    || '. Until then, ' || private.mute_shuts(true) || '.';
end $fn$;
revoke all on function private.muted_why(uuid, uuid) from public, anon, authenticated;

/*
 * One line of the trail. A look at who is on, within ten minutes of the same
 * keeper's last look at the same island, is counted on that look's row.
 */
create or replace function private.owner_note(p_owner uuid, p_world uuid, p_what text, p_whom uuid, p_detail jsonb)
returns void language plpgsql set search_path = '' as $fn$
begin
  if p_what = 'online' then
    update private.owner_log l
       set detail = l.detail || coalesce(p_detail, '{}'::jsonb)
                    || jsonb_build_object('looks', coalesce((l.detail->>'looks')::int, 1) + 1, 'last', now())
     where l.n = (select max(q.n) from private.owner_log q
                   where q.world_id = p_world and q.owner = p_owner and q.what = 'online')
       and coalesce((l.detail->>'last')::timestamptz, l.at) > now() - interval '10 minutes';
    if found then return; end if;
    p_detail := coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('looks', 1, 'last', now());
  end if;
  insert into private.owner_log (owner, world_id, what, whom, detail)
  values (p_owner, p_world, p_what, p_whom, coalesce(p_detail, '{}'::jsonb));
end $fn$;
revoke all on function private.owner_note(uuid, uuid, text, uuid, jsonb) from public, anon, authenticated;

/*
 * Whether you keep this island. Anybody may ask; the answer is only ever about
 * the one asking, and nobody signed in keeps anything.
 */
create or replace function public.rpc_owner_am_i(p_world uuid)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare me uuid := auth.uid();
begin
  if me is null then return false; end if;
  return private.is_island_owner(p_world, me);
end $function$;

/*
 * Everybody with a body on the island, here first and the most lately heard
 * from first after that: where they stand, how long since the island heard
 * from them, whether they are away, whether they are muted and for how much
 * longer (`muted_for` is null for a mute that lasts until it is lifted), and
 * the settlement token Move would put them on, if they founded one.
 */
create or replace function public.rpc_owner_online(p_world uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := auth.uid(); w world; v_people jsonb; v_n int;
begin
  if not private.is_island_owner(p_world, me) then
    raise exception 'only a keeper of this island may do that';
  end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into w from world where id = p_world;
  select coalesce(jsonb_agg(jsonb_build_object(
           'uid', p.uid, 'name', folk_name(p_world, p.uid),
           'x', floor(p.x)::int, 'y', floor(p.y)::int,
           'away', p.away,
           'heard', greatest(0, floor(extract(epoch from now() - p.seen_at)))::bigint,
           'muted', m.uid is not null,
           'muted_for', case when m.until is not null then ceil(extract(epoch from m.until - now()))::bigint end,
           'home', case when d.founded_by is not null
                        then jsonb_build_object('x', d.x, 'y', d.y, 'name', d.name) end,
           'keeper', private.is_island_owner(p_world, p.uid),
           'you', p.uid = me)
         order by p.away, p.seen_at desc, p.uid), '[]'::jsonb),
         count(*)
    into v_people, v_n
    from player p
    left join private.island_mute m on m.world_id = p.world_id and m.uid = p.uid
                                   and (m.until is null or m.until > now())
    left join deed d on d.world_id = p.world_id and d.founded_by = p.uid
   where p.world_id = p_world;
  perform private.owner_note(me, p_world, 'online', null,
    jsonb_build_object('people', v_n, 'here', (select count(*) from player q where q.world_id = p_world and not q.away)));
  return jsonb_build_object('people', v_people, 'spawn', jsonb_build_object('x', w.spawn_x, 'y', w.spawn_y));
end $function$;

/*
 * What stopping somebody's work came to, in one sentence, said to them ("you")
 * or about them ("they"): the job in hand and how many were queued after it.
 */
create or replace function private.move_stops(p_verb text, p_queued int, p_you boolean) returns text
language sql immutable set search_path = '' as $fn$
  select case
    when p_verb is not null then
      case when p_you then 'You stop ' else 'They stop ' end || p_verb
      || case when coalesce(p_queued, 0) > 0
              then ', and the ' || p_queued || case when p_queued = 1 then ' job' else ' jobs' end
                   || ' queued after it ' || case when p_queued = 1 then 'is' else 'are' end || ' cleared'
              else '' end || '.'
    when coalesce(p_queued, 0) > 0 then
      'The ' || p_queued || case when p_queued = 1 then ' job ' else ' jobs ' end
      || case when p_you then 'you' else 'they' end || ' had queued '
      || case when p_queued = 1 then 'is' else 'are' end || ' cleared.'
    else '' end
$fn$;
revoke all on function private.move_stops(text, int, boolean) from public, anon, authenticated;

/*
 * A stuck body, put somewhere it can walk from.
 *
 * The token of the settlement it founded, or where the island's newcomers come
 * ashore when it founded none. What was due of its work lands first, as it
 * does when anybody stops for themselves; the rest of the job and everything
 * queued behind it are dropped. It is taken off whatever it rode, drove,
 * pulled or was aboard, which stay where they are. It is told who moved it and
 * where, and its browser is sent the spot, so the body is there at once rather
 * than on its next step.
 */
create or replace function public.rpc_owner_move(p_world uuid, p_uid uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := auth.uid(); w world; p player; d deed; q placed;
        v_x double precision; v_y double precision; v_where text; v_verb text; v_queued int;
        v_off text[] := '{}'; v_stops text; v_rest text; v_name text; r record;
begin
  if not private.is_island_owner(p_world, me) then
    raise exception 'only a keeper of this island may do that';
  end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into w from world where id = p_world;
  if not exists (select 1 from player where world_id = p_world and uid = p_uid) then
    return jsonb_build_object('why', 'That person has no body on this island.');
  end if;
  -- What is due is done. Stopping is for what is still in their hands.
  perform settle(p_world, p_uid);
  select * into p from player where world_id = p_world and uid = p_uid for update;

  select * into d from deed where world_id = p_world and founded_by = p_uid;
  if found then
    v_x := d.x + 0.5; v_y := d.y + 0.5;
    v_where := 'the token of ' || d.name || ' at (' || d.x || ', ' || d.y || ')';
  else
    v_x := w.spawn_x + 0.5; v_y := w.spawn_y + 0.5;
    v_where := 'where newcomers come ashore, at (' || w.spawn_x || ', ' || w.spawn_y || ')';
  end if;

  select a.verb into v_verb from action_def a where a.id = p.act;
  v_queued := coalesce(jsonb_array_length(p.act_queue), 0);

  -- Off whatever they were on. What they were on stays where it is.
  for r in update creature set rider = null where world_id = p_world and rider = p_uid returning name loop
    v_off := v_off || ('riding ' || r.name);
  end loop;
  for q in update placed set driver = null where world_id = p_world and driver = p_uid returning * loop
    v_off := v_off || ('driving the ' || lower(placed_name(q)));
  end loop;
  for q in update placed set puller = null where world_id = p_world and puller = p_uid returning * loop
    v_off := v_off || ('pulling the ' || lower(placed_name(q)));
  end loop;
  if p.aboard is not null then
    select * into q from placed where id = p.aboard;
    if found then v_off := v_off || ('aboard the ' || lower(placed_name(q))); end if;
  end if;

  update player set x = v_x, y = v_y, level = 0, moved_at = now(), aboard = null, seat = null,
         act = null, act_target = null, act_started = null, act_ends = null, act_left = null,
         act_goes = null, act_queue = '[]'::jsonb
   where world_id = p_world and uid = p_uid;

  v_stops := private.move_stops(v_verb, v_queued, true);
  v_rest := case when v_stops <> '' then ' ' || v_stops else '' end
    || case when cardinality(v_off) > 0 then ' You are no longer ' || array_to_string(v_off, ' or ') || '.' else '' end;
  if me = p_uid then
    perform tell(p_world, p_uid, 'You move yourself to ' || v_where || '.' || v_rest, 'system');
  else
    v_name := folk_name(p_world, p_uid);
    perform tell(p_world, p_uid, folk_name(p_world, me) || ', who keeps this island, has moved you to '
      || v_where || '.' || v_rest, 'system');
    v_stops := private.move_stops(v_verb, v_queued, false);
    perform tell(p_world, me, 'You move ' || v_name || ' to ' || v_where || '.'
      || case when v_stops <> '' then ' ' || v_stops else '' end
      || case when cardinality(v_off) > 0 then ' They are no longer ' || array_to_string(v_off, ' or ') || '.' else '' end,
      'system');
  end if;
  -- And the browser, which otherwise hears of it on its next step.
  if private.here(p_world, p_uid) then
    perform private.send('own:' || p_world || ':' || p_uid, 'moved',
      jsonb_build_object('x', v_x, 'y', v_y, 'level', 0));
  end if;
  perform private.owner_note(me, p_world, 'move', p_uid, jsonb_build_object(
    'from', jsonb_build_object('x', p.x, 'y', p.y, 'level', p.level),
    'to', jsonb_build_object('x', v_x, 'y', v_y), 'token', d.founded_by is not null,
    'stopped', p.act, 'queued', v_queued, 'off', to_jsonb(v_off)));
  return jsonb_build_object('x', v_x, 'y', v_y, 'to', v_where, 'token', d.founded_by is not null,
    'stopped', p.act, 'queued', v_queued, 'off', to_jsonb(v_off));
end $function$;

/*
 * A mute, for `p_secs` seconds or, with none, until a keeper lifts it. A
 * second mute replaces the first. Told to the one muted, in the words every
 * refusal after it uses.
 */
create or replace function public.rpc_owner_mute(p_world uuid, p_uid uuid, p_secs integer default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := auth.uid(); v_until timestamptz; v_span text;
begin
  if not private.is_island_owner(p_world, me) then
    raise exception 'only a keeper of this island may do that';
  end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  if not exists (select 1 from player where world_id = p_world and uid = p_uid) then
    return jsonb_build_object('why', 'That person has no body on this island.');
  end if;
  if p_secs is not null and p_secs < 1 then
    return jsonb_build_object('why', 'A mute lasts some seconds, or until it is lifted.');
  end if;
  v_until := case when p_secs is not null then now() + make_interval(secs => p_secs) end;
  insert into private.island_mute (world_id, uid, until, by_uid, at)
  values (p_world, p_uid, v_until, me, now())
  on conflict (world_id, uid) do update set until = excluded.until, by_uid = excluded.by_uid, at = excluded.at;
  v_span := case when p_secs is null then 'until one of the island''s keepers lifts it'
                 else 'for ' || time_words(p_secs) || ', ' || private.mute_ends(v_until) end;
  if me <> p_uid then
    perform tell(p_world, p_uid, folk_name(p_world, me) || ', who keeps this island, has muted you ' || v_span
      || '. Until then, ' || private.mute_shuts(true) || '.', 'system');
    perform tell(p_world, me, 'You mute ' || folk_name(p_world, p_uid) || ' ' || v_span
      || '. Until then, ' || private.mute_shuts(false) || '.', 'system');
  else
    perform tell(p_world, me, 'You mute yourself ' || v_span || '. Until then, ' || private.mute_shuts(true) || '.', 'system');
  end if;
  perform private.owner_note(me, p_world, 'mute', p_uid, jsonb_build_object('secs', p_secs, 'until', v_until));
  return jsonb_build_object('muted', true, 'secs', p_secs, 'until', v_until);
end $function$;

/* The mute lifted, and said so to the one it was on. */
create or replace function public.rpc_owner_unmute(p_world uuid, p_uid uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := auth.uid(); v_until timestamptz;
begin
  if not private.is_island_owner(p_world, me) then
    raise exception 'only a keeper of this island may do that';
  end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  delete from private.island_mute m where m.world_id = p_world and m.uid = p_uid returning m.until into v_until;
  if not found or v_until <= now() then
    return jsonb_build_object('why', folk_name(p_world, p_uid) || ' is not muted.');
  end if;
  if me <> p_uid then
    perform tell(p_world, p_uid, folk_name(p_world, me) || ', who keeps this island, has lifted your mute. '
      || 'What you say aloud, write in a letter or put in a parcel note is sent again.', 'system');
    perform tell(p_world, me, 'You lift ' || folk_name(p_world, p_uid) || '''s mute. '
      || 'What they say aloud, write in a letter or put in a parcel note is sent again.', 'system');
  else
    perform tell(p_world, me, 'You lift your own mute. '
      || 'What you say aloud, write in a letter or put in a parcel note is sent again.', 'system');
  end if;
  perform private.owner_note(me, p_world, 'unmute', p_uid, jsonb_build_object('until', v_until));
  return jsonb_build_object('muted', false);
end $function$;

/*
 * Everything lying on the ground on one tile, deleted for good, and whatever
 * is inside any of it with it. The keeper is told how many things went, in
 * how many stacks, and what they were.
 */
create or replace function public.rpc_owner_clear(p_world uuid, p_x integer, p_y integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := auth.uid(); v_ids bigint[]; v_things bigint; v_stacks int; v_inside bigint; v_what text;
begin
  if not private.is_island_owner(p_world, me) then
    raise exception 'only a keeper of this island may do that';
  end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select array_agg(i.id order by i.id), sum(i.count) into v_ids, v_things
    from item i where i.world_id = p_world and i.holder = 'ground' and i.gx = p_x and i.gy = p_y;
  if v_ids is null then
    return jsonb_build_object('why', 'Nothing is lying on the ground at (' || p_x || ', ' || p_y || ').');
  end if;
  v_stacks := cardinality(v_ids);
  v_what := pile_text(v_ids);
  select coalesce(sum(i.count), 0) into v_inside from item i where i.inside = any(v_ids);
  delete from item where id = any(v_ids);
  perform land_announce(p_world, p_x, p_y);
  perform tell(p_world, me, 'You clear the pile at (' || p_x || ', ' || p_y || ') for good: '
    || v_things || case when v_things = 1 then ' thing' else ' things' end
    || ' in ' || v_stacks || case when v_stacks = 1 then ' stack' else ' stacks' end
    || ' (' || v_what || ')'
    || case when v_inside > 0 then ', and ' || v_inside || ' more that '
                                   || case when v_inside = 1 then 'was' else 'were' end || ' inside them'
            else '' end || '.', 'system');
  perform private.owner_note(me, p_world, 'clear', null, jsonb_build_object(
    'x', p_x, 'y', p_y, 'stacks', v_stacks, 'things', v_things, 'inside', v_inside, 'what', v_what));
  return jsonb_build_object('stacks', v_stacks, 'things', v_things, 'inside', v_inside, 'what', v_what);
end $function$;

/* The doors that carry words, each refusing a muted body. */
CREATE OR REPLACE FUNCTION public.rpc_say(p_world uuid, p_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); v_name text; v_text text; v_n bigint; v_recent int; v_why text;
begin
  if me is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from player where world_id = p_world and uid = me) then
    raise exception 'you are not on this island';
  end if;
  v_text := btrim(regexp_replace(
    regexp_replace(coalesce(p_text, ''), '[\r\n\t]+', ' ', 'g'), '\s{2,}', ' ', 'g'));
  v_text := left(v_text, say_max()::int);
  if v_text = '' then return null; end if;
  -- Muted by a keeper of the island: refused, in a sentence that says until when.
  v_why := private.muted_why(p_world, me);
  if v_why is not null then return jsonb_build_object('said', null, 'why', v_why); end if;

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
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_letter(p_world uuid, p_uid uuid, p_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); v_text text; v_n bigint; v_recent int; v_why text;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  if not exists (select 1 from player where world_id = p_world and uid = me) then
    raise exception 'you are not on this island';
  end if;
  if p_uid is null or p_uid = me
     or not exists (select 1 from player where world_id = p_world and uid = p_uid) then
    return jsonb_build_object('why', 'There is nobody there to write to.');
  end if;
  v_text := btrim(regexp_replace(
    regexp_replace(coalesce(p_text, ''), '[\r\n\t]+', ' ', 'g'), '\s{2,}', ' ', 'g'));
  v_text := left(v_text, 400);
  if v_text = '' then return jsonb_build_object('why', 'Nothing to say.'); end if;
  -- Muted by a keeper of the island: refused, in a sentence that says until
  -- when. The one line a muted body still sends is the island's own, which a
  -- parcel posted without a note travels with.
  if v_text <> parcel_note() then
    v_why := private.muted_why(p_world, me);
    if v_why is not null then return jsonb_build_object('why', v_why); end if;
  end if;
  -- The same allowance talking out loud gets, counted over letters alone.
  select count(*) into v_recent from letter l
   where l.world_id = p_world and l.sender = me and l.at > now() - interval '1 minute';
  if v_recent >= say_a_minute()::int then
    return jsonb_build_object('why', 'That is a great deal of writing. Give it a moment.');
  end if;
  insert into letter (world_id, sender, reader, text) values (p_world, me, p_uid, v_text)
    returning n into v_n;
  perform tell(p_world, p_uid, '[' || folk_name(p_world, me) || '] ' || v_text, 'letter');
  return jsonb_build_object('n', v_n, 'sent', v_text, 'to', folk_name(p_world, p_uid));
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_parcel(p_world uuid, p_uid uuid, p_text text, p_items bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); v_box placed; v_n bigint; v_count int; v_mine int; v_said jsonb;
begin
  if me is null then raise exception 'not signed in'; end if;
  v_count := coalesce(array_length(p_items, 1), 0);
  if v_count = 0 then return rpc_letter(p_world, p_uid, p_text); end if;
  v_box := mailbox_at(p_world, me);
  if v_box.id is null then
    return jsonb_build_object('why', 'Stand at a mailbox to send anything but words.');
  end if;
  select count(*) into v_mine from item i
    where i.world_id = p_world and i.id = any(p_items)
      and i.holder = 'player' and i.holder_uid = me and i.deal is null and not i.locked;
  if v_mine <> v_count then
    return jsonb_build_object('why', 'Some of that is not yours to send, or is locked.');
  end if;
  -- The words first, through the door that already rate-limits and cleans
  -- them; a parcel with no letter to ride in is not a thing the post carries.
  v_said := rpc_letter(p_world, p_uid, coalesce(nullif(btrim(coalesce(p_text, '')), ''), parcel_note()));
  if v_said ? 'why' then return v_said; end if;
  v_n := (v_said->>'n')::bigint;
  if v_n is null then
    select max(n) into v_n from letter where world_id = p_world and sender = me and reader = p_uid;
  end if;
  update item set holder = 'post', holder_uid = p_uid, letter = v_n,
                  crate = null, placed = null
    where world_id = p_world and id = any(p_items);
  perform tell(p_world, p_uid, folk_name(p_world, me) || ' has sent you a parcel. (Any mailbox)', 'system');
  perform away_count(p_world, p_uid, 'parcel', folk_name(p_world, me), 1);
  return v_said || jsonb_build_object('parcel', v_count);
end $function$;

select private.lock_doors();
