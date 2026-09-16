-- While the island is nearly empty, everybody is on the map.
--
-- `rpc_social` has carried this comment since the day it was written, over the
-- list of everybody ashore:
--
--     -- And everybody ashore, for the window to pick from. No whereabouts: a
--     -- list of every body on the island with a position beside it is a radar.
--
-- That is the right rule for a place with people in it, and it is the wrong
-- rule for an empty one. Four thousand tiles a side with a half-dozen ashore
-- is a game you can play for a week without learning that anybody else exists,
-- and the thing a new island needs most is for its handful of people to run
-- into one another. Somebody said so from the island, and said the rest of it
-- too: *even if it's something that's later removed*.
--
-- ## A headcount, not a switch
--
-- So it is not a switch. A switch is a thing somebody has to remember to turn
-- off, and the day it should be turned off is a day nobody is looking at it.
-- `crowd_hides()` is a number of bodies: while fewer than that are about, the
-- island says where everybody is; from the moment there are that many, it goes
-- back to friends and neighbours only, on its own, with nothing to deploy.
--
-- Twenty, crossed from `CROWD_HIDES`. The Social window says which side of the
-- line the island is on and why, so the day it changes is a thing people read
-- rather than a thing they notice.
--
-- ## Written once, read twice
--
-- `folk_ashore` is the list, and both doors that hand it out call it: the
-- Social window asks `rpc_social` for it, and the map gets it on the slow half
-- of `rpc_ground`, which is the beat that already carries the settlements.
-- Putting the rule in one function is the point — two copies of "when may I
-- say where somebody is" is exactly the shape that lets one of them drift open
-- while the other closes.

/**
 * Is the island quiet enough to say where everybody is?
 *
 * Counted rather than guessed, and counted the way `afoot` counts one body:
 * here, not away, and seen inside the logout window.
 */
create or replace function folk_seen(p_world uuid) returns boolean
  language sql stable as $fn$
  select (select count(*) from player p
           where p.world_id = p_world and not p.away
             and p.seen_at > now() - make_interval(secs => idle_logout()))
         < crowd_hides()
$fn$;

/**
 * Everybody else ashore: who they are, whether they are about, and — while
 * the island is quiet — where.
 *
 * `folk_row`'s third argument is the whole of it. It already knew how to add
 * whereabouts to a friend and withhold them from a stranger; all this does is
 * decide which of those a stranger is today.
 */
create or replace function folk_ashore(p_world uuid, p_uid uuid) returns jsonb
  language sql stable as $fn$
  select coalesce((select jsonb_agg(folk_row(p_world, q.uid, folk_seen(p_world))
      order by q.online desc, folk_name(p_world, q.uid))
    from (select p.uid, afoot(p_world, p.uid) as online from player p
           where p.world_id = p_world and p.uid <> p_uid
           order by afoot(p_world, p.uid) desc, p.name limit 200) q), '[]'::jsonb)
$fn$;

CREATE OR REPLACE FUNCTION public.rpc_social(p_world uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  if not exists (select 1 from player where world_id = p_world and uid = me) then
    raise exception 'you are not on this island';
  end if;
  return jsonb_build_object(
    /*
     * Every settlement that is yours, the one you founded first.
     *
     * A list rather than the one it used to be: a person holds at most one and
     * may be a citizen of `deeds_joined` others, and a window that showed only
     * the first of four would be hiding three places somebody lives.
     *
     * Each carries its own roll — founder included, you left off it — with
     * whereabouts, because people off the same land are near by definition.
     */
    'deeds', coalesce((select jsonb_agg(jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'level', d.level, 'radius', d.radius,
        'founder', d.founded_by, 'by', folk_name(p_world, d.founded_by),
        'mine', d.founded_by = me,
        'folk', coalesce((
          select jsonb_agg(folk_row(p_world, q.uid, true)
                 order by q.ord, folk_name(p_world, q.uid))
            from (select d.founded_by as uid, 0 as ord
                  union all
                  select m.uid, 1 from deed_member m
                   where m.world_id = p_world and m.founder = d.founded_by) q
            where q.uid <> me), '[]'::jsonb))
        order by d.founded_by = me desc, d.founded_at)
      from deeds_of(p_world, me) d), '[]'::jsonb),
    -- And how many more you may join, which is what the window says when the
    -- answer is none.
    'room', greatest(0, deeds_joined()::int - deeds_joined_by(p_world, me)),
    -- Asked to live somewhere, and waiting on you.
    'invites', coalesce((select jsonb_agg(jsonb_build_object(
        'founder', i.founder, 'by', folk_name(p_world, i.founder),
        'deed', dd.name, 'at', extract(epoch from i.made_at)) order by i.made_at)
      from deed_invite i join deed dd
        on dd.world_id = i.world_id and dd.founded_by = i.founder
      where i.world_id = p_world and i.uid = me), '[]'::jsonb),
    -- And the ones you have out, which only a founder ever has.
    'sent', coalesce((select jsonb_agg(jsonb_build_object(
        'uid', i.uid, 'name', folk_name(p_world, i.uid),
        'at', extract(epoch from i.made_at)) order by i.made_at)
      from deed_invite i where i.world_id = p_world and i.founder = me), '[]'::jsonb),
    'friends', coalesce((select jsonb_agg(folk_row(p_world, f.other, true)
        order by afoot(p_world, f.other) desc, folk_name(p_world, f.other))
      from friend f where f.world_id = p_world and f.uid = me and f.state = 'friends'), '[]'::jsonb),
    'asked', coalesce((select jsonb_agg(jsonb_build_object(
        'uid', f.uid, 'name', folk_name(p_world, f.uid),
        'at', extract(epoch from f.at)) order by f.at)
      from friend f where f.world_id = p_world and f.other = me and f.state = 'asked'), '[]'::jsonb),
    'asking', coalesce((select jsonb_agg(jsonb_build_object(
        'uid', f.other, 'name', folk_name(p_world, f.other),
        'at', extract(epoch from f.at)) order by f.at)
      from friend f where f.world_id = p_world and f.uid = me and f.state = 'asked'), '[]'::jsonb),
    -- Letters waiting, by whoever wrote them, so the window can put a number
    -- against a name rather than a bare total nobody can act on.
    'unread', coalesce((select jsonb_agg(jsonb_build_object(
        'uid', q.sender, 'name', folk_name(p_world, q.sender), 'n', q.n) order by q.n desc)
      from (select l.sender, count(*)::int as n from letter l
             where l.world_id = p_world and l.reader = me and l.read_at is null
             group by l.sender) q), '[]'::jsonb),
    /*
     * And everybody ashore. Whereabouts with them while the island is quiet
     * and not once there are people in it — a list of every body on the
     * island with a position beside it is a radar, and it is also, on an
     * island with six people on four thousand tiles, the only way any of them
     * ever meets another.
     */
    'here', folk_ashore(p_world, me),
    -- Which side of that line the island is on, so the window can say why.
    'open', folk_seen(p_world),
    'crowd', crowd_hides()::int);
end $function$;

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
    /*
     * And everybody ashore, on the slow half, which is the beat that already
     * carries the settlements. The map draws them; `folk_ashore` decides
     * whether there is anything to draw them at.
     */
    'folk', folk_ashore(p_world, me),
    'deed', (select jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level, 'mine', true)
      from my_deed(p_world, me) d where d.world_id is not null),
    'deeds', coalesce((select jsonb_agg(jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level,
        -- Land you were asked onto is land you may work, so it is drawn as
        -- yours rather than as a stranger's border you happen to be inside.
        'mine', exists (select 1 from deed_member m where m.world_id = p_world
                          and m.uid = me and m.founder = d.founded_by),
        'holder', account_name(d.founded_by)) order by d.founded_at)
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


select private.lock_doors();

notify pgrst, 'reload schema';
