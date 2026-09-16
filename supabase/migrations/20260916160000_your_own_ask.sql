-- What your own ask did, said in the answer to it.
--
-- Reported as inventory rubberbanding when things are moved between a pack and
-- a container. Put a stack in a crate and it turns up in the crate within the
-- second — and stays in the pack as well, for up to the twenty seconds until
-- the next reconcile, and then goes.
--
-- Two causes with one shape: nothing ever tells the browser that a thing has
-- *left* its hands.
--
--   * `item` is published with the default replica identity, so a DELETE
--     carries the primary key and nothing else. The browser's Realtime filter
--     is `holder_uid = me`, and a row with only an `id` on it cannot match —
--     so putting a whole stack in a crate, which deletes the row, is silent.
--
--   * A thing that goes to the ground, or to somebody else, has `holder_uid`
--     set to null, so the *new* row does not match the filter either. Silent
--     as well.
--
-- Realtime carries every arrival and no departure. `refresh_pack` on the
-- twenty-second reconcile was the only thing that ever noticed, and an instant
-- ask — which is what stowing and taking are — does not cause one.
--
-- The browser's own ask is the one moment it knows for certain that something
-- moved, and the answer to it is read after the write, inside the transaction
-- that did it. So the ask carries the pack and the crates within reach, and
-- the browser lays both down together: one round trip, both halves at once,
-- and nothing for a read already in flight to undo.
--
-- `crates_near` is `rpc_ground`'s own crate expression lifted out whole rather
-- than written a second time, so the two answers cannot drift.

/**
 * Every crate in sight, and what is in the ones you could reach into.
 *
 * Lifted out of `rpc_ground` whole rather than written a second time, because
 * `rpc_act` answers with it now as well. Two copies of this would be two
 * answers about one crate, and one of them would always be a second behind.
 */
create or replace function crates_near(p_world uuid, p_uid uuid, p_range double precision)
  returns jsonb language sql stable as $fn$
  select coalesce((select jsonb_agg((to_jsonb(c) - 'world_id' - 'made_by')
        || jsonb_build_object(
             'mine', crate_yours(p_world, p_uid, c.id),
             -- How full it is, for every crate in sight: a label does not need
             -- the contents and the contents are not free.
             'units', crate_units(p_world, c.id),
             -- And what is actually in it, for the ones you could reach into.
             -- You must be within two and a half tiles to put anything in or
             -- take anything out, so six is generous and keeps a yard full of
             -- crates from costing a phone a hundred kilobytes every three
             -- seconds.
             'things', case when greatest(abs(crate_centre_x(c) - p.x), abs(crate_centre_y(c) - p.y)) <= 6
               then coalesce((select jsonb_agg(jsonb_build_object(
                     'id', i.id, 'def', i.def, 'ql', i.ql, 'dmg', i.dmg,
                     'count', i.count, 'extra', i.extra) order by i.id)
                   from item i where i.world_id = p_world and i.holder = 'crate' and i.crate = c.id),
                 '[]'::jsonb)
               else '[]'::jsonb end) order by c.id)
      from crate c
      where c.world_id = p_world
        and greatest(abs(c.x + 0.5 - p.x), abs(c.y + 0.5 - p.y)) <= p_range), '[]'::jsonb)
    from player p where p.world_id = p_world and p.uid = p_uid
$fn$;

/**
 * What you are holding, and what is in the crates at your elbow.
 *
 * The answer to your own ask, read at the moment the ask is answered. Six
 * tiles because that is `crates_near`'s own reach for contents, and an ask
 * cannot have touched a crate further off than you can put a hand in.
 */
create or replace function held_now(p_world uuid, p_uid uuid) returns jsonb
  language sql stable as $fn$
  select jsonb_build_object(
    'pack', coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from item i
                       where i.world_id = p_world and i.holder in ('player', 'bag')
                         and i.holder_uid = p_uid), '[]'::jsonb),
    'crates', crates_near(p_world, p_uid, 6))
$fn$;

CREATE OR REPLACE FUNCTION public.rpc_ground(p_world uuid, p_range double precision DEFAULT 40, p_slow boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  return jsonb_build_object(
    'placed', coalesce((select jsonb_agg(
        (to_jsonb(pl) - 'world_id' - 'made_by' - 'since' - 'made_at' - 'cx' - 'cy')
        || jsonb_build_object('fuel', placed_fuel(pl), 'ash', placed_ash(pl),
                              'lit', placed_lit(pl), 'mine', coalesce(pl.made_by = me, false))
        order by pl.id)
      from placed pl
      where pl.world_id = p_world
        and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= p_range), '[]'::jsonb),
    'crates', crates_near(p_world, me, p_range))
  /*
   * And the half that hardly ever moves.
   *
   * A fire burns down and a kiln works through its load while you stand and
   * watch it, which is why this is asked for every second. A wall is not like
   * that: it goes up when somebody builds it and then it is a wall. Sending
   * both at one pace meant a correlated subquery over `building_tile` per
   * building, a scan of `wall` and one of `floor_tile`, every second for every
   * player, to say that the house is still a house.
   *
   * So the caller says whether it wants them. A browser asks for the lot on
   * its twenty-second reconcile and after any of its own work, and for the
   * burning half the rest of the time. Left out rather than emptied: the
   * browser applies only the keys it is given, so what it holds stands.
   *
   * `p_slow` defaults true, so a page that has not been redeployed gets
   * exactly what it always got.
   */
  || case when not p_slow then '{}'::jsonb else jsonb_build_object(
    'deed', (select jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level, 'mine', true)
      from my_deed(p_world, me) d where d.world_id is not null),
    'deeds', coalesce((select jsonb_agg(jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level,
        'mine', false, 'holder', account_name(d.founded_by)) order by d.founded_at)
      from deed d
      where d.world_id = p_world and d.founded_by <> me
        and greatest(abs(d.x + 0.5 - p.x), abs(d.y + 0.5 - p.y)) <= p_range + d.radius),
      '[]'::jsonb),
    /*
     * And what is standing.
     *
     * `building`, `wall` and `floor_tile` have been kept here since buildings
     * were ported and have never been sent to anybody. The rules answered
     * about them, a plan went up in Postgres, and no browser ever drew a wall
     * of it — so on an island a building was invisible to everyone, the person
     * who planned it included.
     *
     * Shaped as the browser's own `BuildingsJSON`, so it is laid straight in.
     * A building comes along whole if any of its tiles is in range: half a
     * house is worse than none, and a house is a handful of rows.
     */
    'buildings', jsonb_build_object(
      'nextId', coalesce((select max(b.id) + 1 from building b where b.world_id = p_world), 1),
      'list', coalesce((select jsonb_agg(jsonb_build_object(
          'id', b.id, 'name', b.name, 'levels', b.levels, 'workLevel', b.work_level,
          'tiles', (select coalesce(jsonb_agg(bt.x || ',' || bt.y order by bt.y, bt.x), '[]'::jsonb)
                      from building_tile bt
                     where bt.world_id = p_world and bt.building = b.id)) order by b.id)
        from building b
        where b.world_id = p_world
          and exists (select 1 from building_tile bt
                       where bt.world_id = p_world and bt.building = b.id
                         and greatest(abs(bt.x + 0.5 - p.x), abs(bt.y + 0.5 - p.y)) <= p_range)),
        '[]'::jsonb),
      'walls', coalesce((select jsonb_agg(jsonb_build_object(
          'building', w.building, 'level', w.level, 'x', w.x, 'y', w.y, 'dir', w.dir,
          'type', w.type, 'material', w.material, 'needed', w.needed, 'total', w.total)
          order by w.level, w.dir, w.x, w.y)
        from wall w
        where w.world_id = p_world
          and greatest(abs(w.x + 0.5 - p.x), abs(w.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
      'floors', coalesce((select jsonb_agg(jsonb_build_object(
          'building', f.building, 'level', f.level, 'x', f.x, 'y', f.y,
          'material', f.material, 'kind', f.kind, 'facing', f.facing,
          'needed', f.needed, 'total', f.total) order by f.level, f.x, f.y)
        from floor_tile f
        where f.world_id = p_world
          and greatest(abs(f.x + 0.5 - p.x), abs(f.y + 0.5 - p.y)) <= p_range), '[]'::jsonb))) end;
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_act(p_world uuid, p_action text, p_target jsonb, p_times integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    /*
     * And what is in the head now, not just how much of it.
     *
     * The bar drew its queue from `rpc_settle` and nothing else, and
     * `rpc_settle` runs on the heartbeat and when a job comes due — never when
     * one is *added*. So asking for a third job while two were running left the
     * bar saying "2 of 3" until the job in hand finished, at which point one
     * came off the queue and it said "2 of 3" again. Reported as never changing
     * from 2/3 to 3/3, which is exactly what it did: it was always one behind,
     * and topping the queue up kept it there.
     *
     * The answer to the ask is where the browser should hear about what the ask
     * did, so it says so here rather than waiting to be asked again.
     */
    return held_now(p_world, me) || jsonb_build_object('started', false, 'queued', true,
      'inHand', jsonb_array_length(p.act_queue) + 1, 'capacity', cap,
      'queue', coalesce((select jsonb_agg(jsonb_build_object(
                           'action', q->>'action',
                           'goes', greatest(1, coalesce((q->>'goes')::int, 1))) order by o)
                         from jsonb_array_elements(p.act_queue) with ordinality t(q, o)), '[]'::jsonb));
  end if;

  s := case when d.skill is null then 50 else skill_of(p_world, me, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, me, d.tool) end;
  -- Every other job has a floor of a second or so under it; an instant one has
  -- no duration to put a floor under, and act_duration would give it one.
  secs := case when d.instant then 0 else act_duration(d.base_time, s, tq, control_speed(p_world, me)) end;
  update player set
      act = p_action, act_target = p_target, act_started = now(),
      act_ends = now() + make_interval(secs => secs),
      act_left = greatest(1, least(100, coalesce(p_times, 1))),
      act_goes = greatest(1, least(100, coalesce(p_times, 1))), seen_at = now(), away = false
    where world_id = p_world and uid = me;
  /*
   * And what the ask left you holding, said in the answer to the ask.
   *
   * Reported as inventory rubberbanding: a thing put in a crate turns up in
   * the crate and stays in the pack as well, for up to the twenty seconds
   * until the next reconcile, and then goes. Two causes with one shape —
   * nothing ever tells a browser that a thing has *left* its hands.
   *
   * `item` is published with the default replica identity, so a DELETE carries
   * the primary key and nothing else, and the browser's Realtime filter is
   * `holder_uid = me`: a row carrying only an `id` cannot match it. Putting a
   * whole stack in a crate deletes the row, so nothing is said. And a thing
   * that goes to the ground, or to somebody else, has `holder_uid` set to
   * null, so the *new* row does not match the filter either. Realtime carries
   * every arrival and no departure, and `refresh_pack` on the twenty-second
   * reconcile was the only thing that ever noticed.
   *
   * Said at each return rather than worked out once at the top, because for an
   * instant ask the work happens in the `settle` three lines below this — a
   * value built any earlier is the pack as it was before the thing moved,
   * which is the very answer that was wrong.
   */
  if d.instant then
    perform settle(p_world, me);
    return held_now(p_world, me) || jsonb_build_object('started', true, 'done', true, 'seconds', 0);
  end if;
  perform tell(p_world, me, 'You start ' || d.verb || '.', 'info');
  return held_now(p_world, me)
      || jsonb_build_object('started', true, 'ends', now() + make_interval(secs => secs), 'seconds', secs);
end $function$;

/*
 * And a word to PostgREST, which caches what the doors look like.
 *
 * The last migration changed `rpc_settle`'s argument list, and the live smoke
 * test ran ten seconds behind it: `rpc_act` came back not-started with the
 * head already empty, which is what a call against a cache that no longer
 * matches the catalogue looks like from the outside. The rules themselves were
 * fine — the same sequence against a database built from these migrations
 * starts the eight goes and holds them, measured.
 *
 * One line, and it belongs on any migration that moves a signature.
 */
notify pgrst, 'reload schema';
