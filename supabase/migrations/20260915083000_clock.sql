-- The island gets a clock.
--
-- Everything down here settles lazily off a timestamp, which is the right
-- shape for a database with no long-running compute — and it works beautifully
-- right up to the moment nobody calls. `settle` had exactly three callers:
-- `rpc_act`, `rpc_move` and `rpc_sweep`. The browser calls `rpc_move` only
-- when the body has actually gone somewhere new, and the only caller of
-- `rpc_sweep` in the whole repository is the smoke test.
--
-- So: start a thirty-second go at a face of rock, stand still, and nothing
-- lands. No ore, no line in the log, no message to anybody watching, and the
-- next go of a queued ten never begins. It all arrives at once when you
-- finally take a step.
--
-- It was worse for everything that is not you. `creature_sweep` is reachable
-- only through `rpc_creatures`, which nothing under `src/` calls, and
-- `trap_sweep` and `post_sweep` had no callers at all — so on a live island
-- the wildlife never moved, the traps never sprang, and the posts never
-- settled. Three sweepers written and none of them ever reached.
--
-- `world_tick` is the clock. `pg_cron` turns it where the database has it; it
-- is an ordinary function either way, so a Postgres without the extension
-- still has everything except the winding.

/* ------------------------------------------------------------------ *
 * A body that has gone home.
 * ------------------------------------------------------------------ */

/**
 * `seen_at` has been written by every join, move and act since the beginning
 * and read by nothing at all, so a shut tab left a body standing on the island
 * for ever: in the way, on the roster, and swept on every round of the clock.
 */
alter table player add column if not exists away boolean not null default false;
alter table player add column if not exists left_at timestamptz;

/** The clock's own index: whose work is due, without reading everybody. */
create index if not exists player_acting on player (act_ends) where act is not null;
/** And who is still on their feet, for the roster and the idle sweep. */
create index if not exists player_afoot on player (world_id, seen_at) where not away;

/**
 * Put ashore whoever has been quiet too long.
 *
 * Not a deletion: the row stays, with everything on it. Skills, pack, land and
 * position are exactly where they were left. Coming back is `rpc_join`, which
 * clears the flag — the same call it always was.
 */
create or replace function log_out_idle(p_world uuid) returns int language plpgsql as $$
declare r record; n int := 0;
begin
  for r in select uid, name from player
    where world_id = p_world and not away
      and seen_at < now() - make_interval(secs => idle_logout())
    order by uid limit tick_players()
  loop
    update player set away = true, left_at = now(),
           act = null, act_target = null, act_started = null, act_ends = null,
           act_left = null, act_queue = '[]'::jsonb
      where world_id = p_world and uid = r.uid;
    perform tell(p_world, null, r.name || ' has gone home.', 'info');
    n := n + 1;
  end loop;
  return n;
end $$;

/* ------------------------------------------------------------------ *
 * The clock itself.
 * ------------------------------------------------------------------ */

/**
 * One round.
 *
 * Bounded on purpose, and in the one dimension that can actually run away:
 * islands. Within an island the work is bounded by how many people are on it
 * and how many traps and posts they have built, which are numbers a person had
 * to make by hand. What a round does not get to is still due on the next one,
 * five seconds later.
 *
 * Only islands with somebody recently on them are wound. An island nobody has
 * visited has nothing happening on it that anybody could see, and pretending
 * otherwise would mean simulating Cornwall for the benefit of nobody.
 */
create or replace function world_tick() returns jsonb language plpgsql as $$
declare w record; p record;
        v_worlds int := 0; v_settled int := 0; v_stirred int := 0;
        v_sprung int := 0; v_gone int := 0;
begin
  for w in
    select id from world where ready and exists (
      select 1 from player
      where player.world_id = world.id and not player.away
        and player.seen_at > now() - make_interval(secs => idle_logout()))
    order by id limit tick_worlds()
  loop
    v_worlds := v_worlds + 1;

    -- Everything anybody has finished doing, and the next go of it.
    for p in select uid from player
      where world_id = w.id and act is not null and act_ends <= now()
      order by uid limit tick_players()
    loop
      v_settled := v_settled + settle(w.id, p.uid);
    end loop;

    -- The country round everybody still on their feet. Creatures are swept
    -- near a body rather than island-wide for the same reason they are stocked
    -- near one: at 4096 there are sixteen thousand of them and nobody is
    -- looking at all but a few.
    for p in select uid, x, y from player
      where world_id = w.id and not away
        and seen_at > now() - make_interval(secs => idle_logout())
      order by uid limit tick_players()
    loop
      v_stirred := v_stirred + creature_sweep(w.id, p.x, p.y);
    end loop;

    v_sprung := v_sprung + trap_sweep(w.id) + post_sweep(w.id);
    v_gone := v_gone + log_out_idle(w.id);
  end loop;

  return jsonb_build_object('worlds', v_worlds, 'settled', v_settled,
                            'stirred', v_stirred, 'sprung', v_sprung, 'left', v_gone);
end $$;

/* ------------------------------------------------------------------ *
 * What a person may ask for themselves.
 * ------------------------------------------------------------------ */

/**
 * Settle me, and nobody else.
 *
 * The browser arms a timer at `act_ends` and calls this when it goes off, so
 * your own work lands the second it is due rather than whenever you next
 * happen to walk somewhere. It cannot be used to settle anybody else, it reads
 * one indexed row, and there is nothing in it worth calling in a loop.
 */
create or replace function rpc_settle() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r record; n int := 0; p player;
begin
  if me is null then raise exception 'not signed in'; end if;
  -- It is also the heartbeat, which is what makes the logout above mean
  -- anything: a person standing still at a forge for twenty minutes is here,
  -- and a shut tab is not, and `seen_at` could not tell them apart while the
  -- only thing that wrote it was walking somewhere.
  update player set seen_at = now(), away = false where uid = me and (away or seen_at < now() - interval '5 seconds');
  for r in select world_id from player
    where uid = me and act is not null and act_ends <= now()
  loop
    n := n + settle(r.world_id, me);
  end loop;
  -- What is still due, so the browser can re-arm its timer off this answer
  -- rather than off a Realtime row it may not be carrying any more.
  select * into p from player where uid = me order by seen_at desc limit 1;
  return jsonb_build_object('settled', n, 'act', p.act, 'ends', p.act_ends, 'left', p.act_left);
end $$;

/**
 * Coming back.
 *
 * `rpc_join` is the one door onto an island, so it is the one place that has
 * to undo a going-home. Everything it needs is already on the row — the flag
 * is the whole of what changed — and a person who was put ashore while they
 * were away is told so rather than left to notice their queue is empty.
 */
create or replace function rpc_join(p_world uuid, p_name text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); w world; p player; born boolean := false; v_look jsonb; v_was_away boolean := false;
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
    'time', world_time(p_world));
end $$;

/**
 * And `rpc_sweep` goes.
 *
 * It was `grant execute to authenticated` by the sweep in `lock_doors`, and it
 * ran `select ... from player where act is not null and act_ends <= now()
 * limit 500` against a table whose only index was its primary key: a full scan
 * settling five hundred bodies across every island, inside PostgREST's eight
 * seconds, at the request of anybody with an account. The clock owns that work
 * now, and a person can only settle themselves.
 */
drop function if exists rpc_sweep();

/* ------------------------------------------------------------------ *
 * Winding it.
 * ------------------------------------------------------------------ */

/**
 * `pg_cron` if this database has it, and no complaint if it does not.
 *
 * The suite runs against a bare `postgres:16` with no extensions and no
 * `shared_preload_libraries`, and a migration that insisted would fail there
 * and take the whole run with it. So the clock is wound where there is a key
 * for it and left to `rpc_settle` and the browser where there is not — and
 * `clock_running()` says which, out loud, rather than leaving it to be guessed.
 */
do $$
begin
  execute 'create extension if not exists pg_cron';
exception when others then
  raise notice 'no pg_cron on this database (%); the clock will not wind itself here', sqlerrm;
end $$;

do $$
declare every text;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then return; end if;
  -- pg_cron learned seconds in 1.5. Older ones get the minute, which is slower
  -- than the island deserves but is not nothing.
  every := case when exists (select 1 from pg_extension where extname = 'pg_cron'
                               and string_to_array(extversion, '.')::int[] >= array[1, 5])
                then tick_seconds()::int || ' seconds' else '* * * * *' end;
  -- `cron.schedule` is an upsert on the job name, so running this migration
  -- against a database that already has the clock re-times it rather than
  -- winding a second one.
  perform cron.schedule('world-tick', every, 'select public.world_tick()');
exception when others then
  raise notice 'could not wind the clock (%)', sqlerrm;
end $$;

/** Whether this database winds itself, for anything that wants to say so. */
create or replace function clock_running() returns boolean language plpgsql stable as $$
declare n int;
begin
  -- Asked of the catalogue rather than of `cron.job` directly, because a plain
  -- SQL function naming a schema that is not there would not even parse.
  if not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
                 where s.nspname = 'cron' and c.relname = 'job') then return false; end if;
  execute $q$select count(*) from cron.job where jobname = 'world-tick'$q$ into n;
  return n > 0;
exception when others then return false;
end $$;

select private.lock_doors();
