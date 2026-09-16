-- One settlement of your own, and a citizen of three besides.
--
-- The roll went in this morning with one row per person: `deed_member`'s
-- primary key was `(world_id, uid)`, so belonging anywhere meant belonging
-- nowhere else, and holding land of your own meant you could not be anybody's
-- citizen at all. That is one settlement per person by another name, which is
-- what was there before.
--
-- The rule now:
--
--     found     one, as always — you planted the stake, you pay for the
--               upgrades, you are the one who can disband it
--     join      up to `deeds_joined()` others, whether or not you hold one
--
-- Three is enough to be a neighbour, a partner and a guest without the word
-- *citizen* ceasing to mean anything, and it is crossed from `DEEDS_JOINED`
-- rather than written down twice.
--
-- ## Which is "my deed" when there are four of them
--
-- The question every rule on this island actually asks is `on_my_deed(uid, x,
-- y)` — *may I work here* — and that generalises without any argument: yes if
-- **any** land of yours covers the spot. Nine rules read it and none of them
-- needs telling.
--
-- What does not generalise is the handful that want *the* deed with no place
-- attached, and each of those turns out to want the one you founded:
-- `deed_crate` is where a worker hauls to, `place_deed_crate` is the token's
-- own crate, `rpc_ground` draws your border, `upgrade_wants` is the founder's
-- bill. So `deed_of` keeps meaning your home — founded first, then the
-- earliest you joined — and the new work is all in one place:
--
--     deeds_of(world, uid)    every settlement that is yours, founded first
--     deed_of                 the first of them: your home
--     deed_here(…, x, y)      the one of them that covers a spot
--     on_my_deed              whether any of them does
--
-- Four names, one statement of what "yours" means. Three of them used to write
-- that predicate out for themselves, which is exactly the shape that had
-- `improve_ceiling` disagreeing with its own examine line for a month.
--
-- ## And what a citizen still may not do
--
-- Disbanding, upgrading and renaming stay with whoever planted the stake —
-- `perform_settlement` and `settlement_refusal` read `founded_by` for
-- themselves and are untouched. So are the wildermon: `worker_cap` is the
-- deed's allowance and one per citizen would not be an allowance.
--
-- Founding is no longer refused to a citizen: you may hold your own and live
-- on three others, and `deeds_of` puts your own first so nothing has to guess.

alter table deed_member drop constraint if exists deed_member_pkey;
alter table deed_member add primary key (world_id, founder, uid);

/**
 * Every settlement that is yours: the one you founded, then the ones you were
 * asked into, oldest first.
 *
 * The one statement of what "yours" means. `deed_of`, `deed_here` and
 * `on_my_deed` are all one line over this, so a citizen cannot be a citizen
 * for one rule and a stranger for the next.
 */
create or replace function deeds_of(p_world uuid, p_uid uuid) returns setof deed
  language sql stable as $fn$
  select d.* from deed d
   where d.world_id = p_world
     and (d.founded_by = p_uid
          or exists (select 1 from deed_member m
                      where m.world_id = p_world and m.uid = p_uid
                        and m.founder = d.founded_by))
   order by (d.founded_by = p_uid) desc, d.founded_at
$fn$;

/**
 * Your home: the settlement you founded, or failing that the first you joined.
 *
 * What the handful of rules that want a deed with no place attached mean by
 * one — where a worker hauls to, whose border is drawn round you, whose next
 * upgrade you are being told about.
 */
create or replace function deed_of(p_world uuid, p_uid uuid) returns deed
  language sql stable as $fn$ select * from deeds_of(p_world, p_uid) limit 1 $fn$;

/** The settlement of yours that covers a spot, when one does. */
create or replace function deed_here(p_world uuid, p_uid uuid, p_x integer, p_y integer)
  returns deed language sql stable as $fn$
  select d.* from deeds_of(p_world, p_uid) d
   where abs(p_x - d.x) <= d.radius and abs(p_y - d.y) <= d.radius
   limit 1
$fn$;

/*
 * And the question the whole island asks: may I work here.
 *
 * Nine rules read this — may I build, is this crate mine, whose stores are
 * these, whose water, will this wildermon gather this ground — and every one
 * of them means the same thing by it whether the land is your own or somebody
 * else's that you were asked onto.
 *
 * Over `deed_here` rather than an `exists` of its own. The first draft wrote
 * the predicate out a second time for speed it does not gain — both stop at
 * the first match — and the suite's own sweep caught it at once: `deed_here`
 * came out as a rule this island keeps and never runs, which is what a second
 * copy looks like from the outside.
 */
create or replace function on_my_deed(p_world uuid, p_uid uuid, p_x integer, p_y integer)
  returns boolean language sql stable as $fn$
  select (deed_here(p_world, p_uid, p_x, p_y)).world_id is not null
$fn$;

/*
 * Founding, which no longer cares whether you are somebody's citizen.
 *
 * It did for half a day, because `deed_of` could not answer honestly with two
 * deeds in play. It can now: your own comes first, and every question with a
 * place attached asks `on_my_deed`, which does not need to choose at all.
 */
CREATE OR REPLACE FUNCTION public.deed_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p player; tx int; ty int; want int := 5; other deed;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  tx := floor(p.x)::int; ty := floor(p.y)::int;
  if exists (select 1 from deed d where d.world_id = p_world and d.founded_by = p_uid) then
    return 'You already hold a settlement. Disband it first.';
  end if;
  if pack_count(p_world, p_uid, 'deed_stake') <= 0 then return 'You have no deed stake.'; end if;
  if tx - want < 0 or ty - want < 0
     or not in_bounds(p_world, tx + want, ty + want) then
    return 'Too close to the edge of the world.';
  end if;
  if has_water(p_world, tx, ty) then return 'The token must stand on dry land.'; end if;
  if not passable(p_world, tx, ty) then return 'The token needs a clear tile.'; end if;
  -- Two squares overlap when their centres are closer than the sum of their
  -- reaches, on either axis.
  select * into other from deed d
   where d.world_id = p_world
     and abs(tx - d.x) <= want + d.radius
     and abs(ty - d.y) <= want + d.radius
   order by d.founded_at limit 1;
  if found then
    return other.name || ' stands too close. Settlements may not overlap, and yours would '
        || 'reach ' || want || ' tiles from here. Walk further out.';
  end if;
  return null;
end $function$;

/** How many other people's settlements somebody is already a citizen of. */
create or replace function deeds_joined_by(p_world uuid, p_uid uuid) returns integer
  language sql stable as $fn$
  select count(*)::int from deed_member m where m.world_id = p_world and m.uid = p_uid
$fn$;

/**
 * Ask somebody to come and live on your land.
 *
 * The founder's alone. Holding land of their own is no bar — one settlement is
 * yours and three more may be places you belong — but a full roll of three is,
 * and saying so by name is kinder than an invitation that cannot be answered.
 */
create or replace function rpc_invite(p_world uuid, p_uid uuid) returns jsonb
  language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); d deed; v_name text;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  if p_uid is null or p_uid = me then
    return jsonb_build_object('why', 'You are already here.');
  end if;
  select * into d from deed where world_id = p_world and founded_by = me;
  if not found then
    return jsonb_build_object('why', 'You hold no settlement to invite anybody to.');
  end if;
  if not exists (select 1 from player where world_id = p_world and uid = p_uid) then
    return jsonb_build_object('why', 'Nobody by that name is on this island.');
  end if;
  v_name := folk_name(p_world, p_uid);
  if exists (select 1 from deed_member m where m.world_id = p_world and m.uid = p_uid
               and m.founder = me) then
    return jsonb_build_object('why', v_name || ' already lives here.');
  end if;
  if deeds_joined_by(p_world, p_uid) >= deeds_joined()::int then
    return jsonb_build_object('why', v_name || ' is a citizen of '
      || deeds_joined()::int || ' settlements already, which is as many as anybody may be.');
  end if;
  if exists (select 1 from deed_invite i where i.world_id = p_world and i.founder = me
               and i.uid = p_uid) then
    return jsonb_build_object('why', v_name || ' has already been asked, and has not answered.');
  end if;
  insert into deed_invite (world_id, founder, uid) values (p_world, me, p_uid);
  perform tell(p_world, p_uid, folk_name(p_world, me) || ' invites you to live at '
    || d.name || '. (Social, to answer)', 'system');
  return jsonb_build_object('asked', v_name, 'deed', d.name);
end $fn$;

/**
 * Yes or no to an invitation.
 *
 * Yes is allowed while you hold land of your own: the one you founded stays
 * first in `deeds_of`, so nothing has to choose between them. The only thing
 * that refuses is a full roll.
 */
create or replace function rpc_invite_answer(p_world uuid, p_founder uuid, p_yes boolean)
  returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); d deed; v_n int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into d from deed where world_id = p_world and founded_by = p_founder;
  if not found or not exists (select 1 from deed_invite i
        where i.world_id = p_world and i.founder = p_founder and i.uid = me) then
    return jsonb_build_object('why', 'There is no invitation waiting from there.');
  end if;
  if not coalesce(p_yes, false) then
    delete from deed_invite where world_id = p_world and founder = p_founder and uid = me;
    perform tell(p_world, p_founder, folk_name(p_world, me) || ' will not come to '
      || d.name || '.', 'event');
    return jsonb_build_object('joined', false, 'deed', d.name);
  end if;
  v_n := deeds_joined_by(p_world, me);
  if v_n >= deeds_joined()::int then
    -- The invitation is left standing: leave one of the three and it is still
    -- there to answer.
    return jsonb_build_object('why', 'You are a citizen of ' || v_n
      || ' settlements already, which is as many as anybody may be. Leave one first.');
  end if;
  delete from deed_invite where world_id = p_world and founder = p_founder and uid = me;
  insert into deed_member (world_id, founder, uid) values (p_world, p_founder, me);
  perform tell(p_world, me, 'You are a citizen of ' || d.name
    || '. Its land is yours to work.', 'system');
  perform tell(p_world, p_founder, folk_name(p_world, me) || ' has come to live at '
    || d.name || '.', 'system');
  return jsonb_build_object('joined', true, 'deed', d.name);
end $fn$;

/**
 * Off one roll: yourself, or somebody the founder is sending away.
 *
 * Which settlement has to be named now that a person may be on several.
 */
create or replace function rpc_leave_deed(p_world uuid, p_founder uuid, p_uid uuid default null)
  returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); who uuid; d deed;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  who := coalesce(p_uid, me);
  if not exists (select 1 from deed_member m
        where m.world_id = p_world and m.uid = who and m.founder = p_founder) then
    return jsonb_build_object('why', 'Nobody there to send away.');
  end if;
  if who <> me and p_founder <> me then
    return jsonb_build_object('why', 'That is not your settlement to empty.');
  end if;
  select * into d from deed where world_id = p_world and founded_by = p_founder;
  delete from deed_member where world_id = p_world and uid = who and founder = p_founder;
  if who = me then
    perform tell(p_world, me, 'You are no longer a citizen of ' || d.name || '.', 'system');
    if p_founder <> me then
      perform tell(p_world, p_founder, folk_name(p_world, me) || ' has left ' || d.name || '.', 'event');
    end if;
  else
    perform tell(p_world, who, 'You are no longer welcome at ' || d.name || '.', 'error');
    perform tell(p_world, me, folk_name(p_world, who) || ' is off the roll of ' || d.name || '.', 'event');
  end if;
  return jsonb_build_object('left', d.name);
end $fn$;

-- The two-argument door goes, or PostgREST keeps both and a call naming a
-- settlement would land on the one that cannot take the name.
drop function if exists rpc_leave_deed(uuid, uuid);

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
    -- And everybody ashore, for the window to pick from. No whereabouts: a
    -- list of every body on the island with a position beside it is a radar.
    'here', coalesce((select jsonb_agg(jsonb_build_object(
        'uid', q.uid, 'name', folk_name(p_world, q.uid), 'online', q.online)
        order by q.online desc, folk_name(p_world, q.uid))
      from (select p.uid, afoot(p_world, p.uid) as online from player p
             where p.world_id = p_world and p.uid <> me
             order by afoot(p_world, p.uid) desc, p.name limit 200) q), '[]'::jsonb));
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
