-- Five doors that were open, and one index.
--
-- `rpc_move` believed the ground under a walk it only checked the speed of.
-- `rpc_land` was granted to every account and called by nothing. `item_read`,
-- `placed_read` and `tile_change_read` handed every island's business to
-- anybody with a login. `rpc_abandon` deleted an island out from under the
-- people standing on it. And nothing anywhere counted how fast a caller was
-- calling.

/* ------------------------------------------------------------------ *
 * The land is not a download.
 * ------------------------------------------------------------------ */

/**
 * `rpc_land` becomes `land_window`, and loses its grant with its name.
 *
 * The browser stopped calling it when the join started generating ground from
 * the seed; the `grant execute to authenticated` that `lock_doors` hands to
 * everything named `rpc_%` did not stop. It answers about two megabytes a call
 * and a hundred and thirty-eight for a whole 4096 island, so a stranger with
 * an account could bill this project for egress in a loop, for nothing.
 *
 * The body is untouched. It is still the authority when generation and history
 * disagree, and `supabase/test/landtrip.ts` still reads it — from psql, as the
 * owner, which is who ought to be reading it.
 */
create or replace function land_window(p_world uuid, p_y0 int, p_y1 int) returns jsonb
  language plpgsql stable as $$
begin
  if p_y1 - p_y0 > 256 then raise exception 'ask for fewer rows at a time'; end if;
  return coalesce((
    select jsonb_agg(row order by y)
    from (
      select c.y,
             jsonb_build_object(
               'y', c.y,
               'heights', encode(c.heights, 'base64'),
               'dirt', encode(c.dirt, 'base64'),
               'tiles', encode(t.tiles, 'base64'),
               'data', encode(t.data, 'base64'),
               'rock', encode(t.rock, 'base64')) as row
      from land_corner c
      left join land_tile t on t.world_id = c.world_id and t.y = c.y
      where c.world_id = p_world and c.y between p_y0 and p_y1
    ) q), '[]'::jsonb);
end $$;

drop function if exists rpc_land(uuid, int, int);

/* ------------------------------------------------------------------ *
 * What one island's business is, and whose.
 * ------------------------------------------------------------------ */

/**
 * Three policies that said `true` where they meant "on this island".
 *
 * `item_read`'s ground arm had no `world_id` about it at all, so every thing
 * lying on the grass of every island was readable by anybody signed in — while
 * the `crate` and `furniture` arms beside it were already doing it properly.
 * `placed_read` and `tile_change_read` were `using (true)` outright: every
 * fire, forge, cart and dug tile on the whole service.
 *
 * The land itself stays open, deliberately. It is a pure function of a seed
 * that travels in the world row, so there is nothing in it to keep.
 */
drop policy if exists item_read on item;
create policy item_read on item for select to authenticated using (
  (holder = 'player' and holder_uid = (select auth.uid()))
  or (holder = 'bag' and holder_uid = (select auth.uid()))
  or (holder = 'ground' and private.on_island(world_id))
  or (holder = 'crate' and private.on_island(world_id))
  or (holder = 'furniture' and private.on_island(world_id))
);

drop policy if exists placed_read on placed;
create policy placed_read on placed for select to authenticated
  using ((select private.on_island(placed.world_id)));

drop policy if exists tile_change_read on tile_change;
create policy tile_change_read on tile_change for select to authenticated
  using ((select private.on_island(tile_change.world_id)));

/**
 * The schema's one unindexed foreign key.
 *
 * `item_in_furniture` is `(world_id, placed) where holder = 'furniture'`, which
 * cannot serve a bare `placed = X`, so every delete or replace of a `placed`
 * row scanned `item` to check the constraint.
 */
create index if not exists item_by_placed on item (placed) where placed is not null;

/* ------------------------------------------------------------------ *
 * How fast one person may ask.
 * ------------------------------------------------------------------ */

/**
 * A minute's worth of calls, per account.
 *
 * Nothing counted. `rpc_act` clamps `p_times` to a hundred, which is the only
 * ceiling in the whole surface, and it is on the size of one request rather
 * than on how many there are. One row per caller, one indexed upsert per call,
 * and no contention because the row is nobody else's.
 *
 * A refusal rolls the increment back with it, which is the behaviour you want:
 * a caller who is over the line sits exactly on it and is refused again until
 * the minute turns, rather than digging themselves deeper.
 */
create table if not exists caller (
  uid uuid primary key,
  minute timestamptz not null default date_trunc('minute', now()),
  calls int not null default 0
);
alter table caller enable row level security;

create or replace function too_fast(p_uid uuid) returns boolean language plpgsql as $$
declare n int;
begin
  if p_uid is null then return false; end if;
  insert into caller (uid, minute, calls) values (p_uid, date_trunc('minute', now()), 1)
  on conflict (uid) do update
    set calls = case when caller.minute < date_trunc('minute', now()) then 1 else caller.calls + 1 end,
        minute = date_trunc('minute', now())
  returning calls into n;
  return n > calls_a_minute();
end $$;

/* ------------------------------------------------------------------ *
 * The ground under a claimed walk.
 * ------------------------------------------------------------------ */

/**
 * How far along a claimed walk the ground actually lets somebody get, 0..1.
 *
 * `rpc_move` asked how far they said they had gone against how fast they could
 * possibly have gone, and nothing else — so a modified client could walk
 * through a tree, up a sheer cliff and over a mountain at a perfectly legal
 * pace. The browser has always known better: `World.isPassable` for the tile
 * and `groundStep` for the climb. This is the same pair of questions, asked by
 * the side that decides.
 *
 * Two properties it is built to have:
 *
 * - **It never refuses something the browser would allow.** Past the sampling
 *   cap the line is read coarsely, and a coarse read can only miss a tile —
 *   let something through — never invent one. The climb is compared between
 *   neighbouring tiles only, so a gap the sampling jumped is not read as a
 *   cliff.
 * - **It lets you out of somewhere you should not be.** The tile the body
 *   starts in is never asked about, only the ones it enters. Somebody standing
 *   inside a tree walks out of it, exactly as they do in the browser.
 *
 * Storeys and bridges are left alone: a body on a bridge or an upper floor is
 * standing on something this has no reading of, and refusing it would be
 * wrong. Walls are not checked yet either — that wants the browser's
 * `blocksAt` ported, and a half-ported one that refuses a doorway is worse
 * than none.
 */
create or replace function walk_share(p_world uuid, p_uid uuid, p_level int,
  p_x0 double precision, p_y0 double precision,
  p_x1 double precision, p_y1 double precision) returns double precision
  language plpgsql stable as $$
declare far double precision; n int; i int; t double precision;
        fx int; fy int; tx int; ty int; climb double precision;
begin
  if p_level <> 0 then return 1; end if;
  far := sqrt(power(p_x1 - p_x0, 2) + power(p_y1 - p_y0, 2));
  if far <= 0.0001 then return 1; end if;
  fx := floor(p_x0)::int; fy := floor(p_y0)::int;
  if bridge_at(p_world, fx, fy) is not null then return 1; end if;

  n := least(walk_samples()::int, greatest(1, ceil(far * 2)::int));
  climb := max_step() + skill_of(p_world, p_uid, 'climbing') * climb_per_level();
  for i in 1..n loop
    t := i::double precision / n;
    tx := floor(p_x0 + (p_x1 - p_x0) * t)::int;
    ty := floor(p_y0 + (p_y1 - p_y0) * t)::int;
    if tx <> fx or ty <> fy then
      if not passable(p_world, tx, ty) then return (i - 1)::double precision / n; end if;
      if abs(tx - fx) <= 1 and abs(ty - fy) <= 1
         and bridge_at(p_world, tx, ty) is null
         and abs(centre_height(p_world, tx, ty) - centre_height(p_world, fx, fy)) > climb then
        return (i - 1)::double precision / n;
      end if;
      fx := tx; fy := ty;
    end if;
  end loop;
  return 1;
end $$;

/**
 * Where somebody says they have walked to, believed as far as it deserves.
 *
 * The speed ceiling is unchanged and still pulls back rather than refusing — a
 * client that has been asleep is not a cheat, and telling it off would be
 * unplayable. The ground is now asked the same way, in the same spirit: the
 * body is put wherever along the claimed line it could actually have reached.
 */
create or replace function rpc_move(p_world uuid, p_x double precision, p_y double precision, p_level int default 0)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); p player; w world;
        gap double precision; far double precision; allowed double precision; share double precision;
        pulled boolean := false; blocked boolean := false;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  perform settle(p_world, me);
  select * into p from player where world_id = p_world and uid = me for update;
  if not found then raise exception 'you are not on this island'; end if;
  select * into w from world where id = p_world;
  if p_x < 0 or p_y < 0 or p_x > w.size or p_y > w.size then raise exception 'that is off the island'; end if;

  gap := greatest(0.05, extract(epoch from (now() - p.moved_at)));
  far := sqrt(power(p_x - p.x, 2) + power(p_y - p.y, 2));
  -- A walk, a saddle or a seat; the rest is slack for a link that hiccups.
  allowed := travel_speed(p_world, me) * least(gap, 10) * 1.6 + 1.5;
  if far > allowed then
    p_x := p.x + (p_x - p.x) * (allowed / far);
    p_y := p.y + (p_y - p.y) * (allowed / far);
    pulled := true;
  end if;

  share := walk_share(p_world, me, p_level, p.x, p.y, p_x, p_y);
  if share < 1 then
    p_x := p.x + (p_x - p.x) * share;
    p_y := p.y + (p_y - p.y) * share;
    blocked := true;
  end if;

  update player set x = p_x, y = p_y, level = p_level, moved_at = now(), seen_at = now(), away = false
    where world_id = p_world and uid = me;
  perform drag_along(p_world, me, p_x, p_y);
  -- Walking into empty country is what fills it in.
  perform creature_stock_near(p_world, p_x, p_y);
  return jsonb_build_object('x', p_x, 'y', p_y, 'pulled', pulled, 'blocked', blocked);
end $$;

/* ------------------------------------------------------------------ *
 * Giving an island up.
 * ------------------------------------------------------------------ */

/**
 * An island is not the founder's to delete while anybody is standing on it.
 *
 * `rpc_abandon` checked `made_by` and then `delete from world`, and the
 * cascades took everybody else's body, pack, skills and land with it. Somebody
 * who has gone home counts as gone; somebody who was here within the quarter
 * hour does not.
 */
create or replace function rpc_abandon(p_world uuid) returns boolean
  language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); w world; others int;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into w from world where id = p_world;
  if not found then return false; end if;
  if w.made_by is distinct from me then raise exception 'that is not your island to give up'; end if;
  select count(*) into others from player
    where world_id = p_world and uid <> me and not away
      and seen_at > now() - make_interval(secs => idle_logout());
  if others > 0 then
    raise exception 'there % still on this island; it is not yours alone to give up',
      case when others = 1 then 'is somebody' else 'are ' || others || ' people' end;
  end if;
  delete from world where id = p_world;
  return true;
end $$;

/* ------------------------------------------------------------------ *
 * And the rest of the hot surface counts its callers.
 * ------------------------------------------------------------------ */

create or replace function rpc_settle() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r record; n int := 0; p player;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  update player set seen_at = now(), away = false
    where uid = me and (away or seen_at < now() - interval '5 seconds');
  for r in select world_id from player
    where uid = me and act is not null and act_ends <= now()
  loop
    n := n + settle(r.world_id, me);
  end loop;
  select * into p from player where uid = me order by seen_at desc limit 1;
  return jsonb_build_object('settled', n, 'act', p.act, 'ends', p.act_ends, 'left', p.act_left);
end $$;

/**
 * And the other two hot ones count their callers as well.
 *
 * Four between them — `rpc_move`, `rpc_settle`, `rpc_act` and `rpc_creatures`
 * — are every call a client makes while somebody is playing. The rest are
 * doors: joining, founding, naming, choosing a face. They are rare enough that
 * an upsert on every one of them would cost more than it saved.
 */
create or replace function rpc_act(p_world uuid, p_action text, p_target jsonb, p_times int default 1)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); d action_def; p player; why text; secs double precision;
        s double precision; tq double precision; cap int; room int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  perform settle(p_world, me);
  why := act_refusal(p_world, me, p_action, p_target);
  if why is not null then
    perform tell(p_world, me, why, 'error');
    return jsonb_build_object('started', false, 'why', why);
  end if;
  select * into d from action_def where id = p_action;
  select * into p from player where world_id = p_world and uid = me for update;

  -- Something already in hand: line this one up behind it rather than drop it.
  if p.act is not null then
    cap := queue_capacity(p_world, me);
    room := cap - 1 - jsonb_array_length(p.act_queue);
    if room <= 0 then
      why := 'You can only keep ' || cap || ' jobs in your head at once. Mind logic is what widens that.';
      perform tell(p_world, me, why, 'error');
      return jsonb_build_object('started', false, 'queued', false, 'why', why);
    end if;
    update player set act_queue = act_queue || jsonb_build_object(
        'action', p_action, 'target', p_target, 'goes', greatest(1, least(100, coalesce(p_times, 1))))
      where world_id = p_world and uid = me returning * into p;
    perform tell(p_world, me, d.label || ' is next, ' || jsonb_array_length(p.act_queue) + 1 || ' of ' || cap || ' in hand.', 'info');
    return jsonb_build_object('started', false, 'queued', true,
      'inHand', jsonb_array_length(p.act_queue) + 1, 'capacity', cap);
  end if;

  s := case when d.skill is null then 50 else skill_of(p_world, me, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, me, d.tool) end;
  -- Every other job has a floor of a second or so under it; an instant one has
  -- no duration to put a floor under, and act_duration would give it one.
  secs := case when d.instant then 0 else act_duration(d.base_time, s, tq, control_speed(p_world, me)) end;
  update player set
      act = p_action, act_target = p_target, act_started = now(),
      act_ends = now() + make_interval(secs => secs),
      act_left = greatest(1, least(100, coalesce(p_times, 1))), seen_at = now(), away = false
    where world_id = p_world and uid = me;
  if d.instant then
    perform settle(p_world, me);
    return jsonb_build_object('started', true, 'done', true, 'seconds', 0);
  end if;
  perform tell(p_world, me, 'You start ' || d.verb || '.', 'info');
  return jsonb_build_object('started', true, 'ends', now() + make_interval(secs => secs), 'seconds', secs);
end $$;

create or replace function rpc_creatures(p_world uuid, p_range double precision default 40)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); p player;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  perform creature_sweep(p_world, p.x, p.y, p_range);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'species', c.species, 'name', c.name, 'variant', c.variant,
      'mode', c.mode, 'stance', c.stance,
      'x', creature_x(c), 'y', creature_y(c),
      'fromX', c.from_x, 'fromY', c.from_y, 'toX', c.to_x, 'toY', c.to_y,
      'legAt', c.leg_at, 'legEnds', c.leg_ends,
      'health', c.health, 'max', max_health(c), 'hunger', c.hunger,
      'sex', c.sex, 'age', age_of(c.born), 'traits', c.traits,
      'hunting', c.hunting = me, 'mine', coalesce(c.keeper = me, false))
      order by c.id)
    from creature c
    where c.world_id = p_world
      and greatest(abs(creature_x(c) - p.x), abs(creature_y(c) - p.y)) <= p_range), '[]'::jsonb);
end $$;

select private.lock_doors();
