/*
 * A grave where you fell.
 *
 * Dying cost nothing but the walk back: `player_die` put the body on the
 * shore it came in on, closed its wounds, and left everything it had been
 * carrying on its back.
 *
 * Now what you carry stays where you fell. `bury` digs a grave there -- a
 * placed piece, `furniture` of the kind 'grave', its owner in `made_by` as
 * for anything set down and the moment it crumbles in the new column
 * `crumbles_at` -- and moves into it everything in the pack but what is worn
 * where a blow lands (clothing and armour, `hit_location`'s five) and a jewel.
 * What is in your hands and on your belt goes; every bag goes with what is in
 * it, which `item_bag_follows` sees to. A crate with a wildermon in it stays
 * with you, since `occupied_crate_stays` will not have one in any store but a
 * stall, and so does whatever is held in a deal, which is promised and which
 * `rpc_deal_answer` hands over from the pack. A light goes out on the way in.
 * Nothing carried, no grave, and the old words.
 *
 * Where: the tile you fell on, or -- in water too deep to stand in -- the
 * nearest dry tile within `grave_reach()` (`shore_near`, as a passenger
 * stepping ashore), and where you fell when there is none. On that tile it
 * takes the free block nearest where you lay, so a second grave is not dug
 * into the first. The browser's `bury` asks the same in the same order.
 *
 * For `grave_keeps()` seconds only its owner may open it or take from it, and
 * nothing else is done to it by anybody: `grave_refusal`, asked by
 * `act_refusal` before any family's own rules, lets its owner take one thing
 * out or all of them and refuses everything else, in the browser's words; and
 * `spoil_near` and `take_spoil`, which reach into any piece beside you for a
 * spadeful, pass a grave by.
 * `rpc_ground` sends what is in a grave to its owner only, says whose it is
 * and how long it has, and lists every grave of yours for the map. Then
 * `grave_sweep` -- on the heartbeat, inside `ground_sweep`, off an index of
 * nothing but graves ordered by when they crumble -- takes it and what is
 * still in it away, and tells its owner what was lost.
 *
 * The number and the words it is said in, `grave_keeps()`, `grave_reach()`
 * and `grave_keeps_said()`, are generated from `graves.ts` with the rest of
 * the definitions, and so is the piece itself.
 */
set local lock_timeout = '3s';

/* When a grave crumbles. Nothing else has one; its owner is `made_by`, as it is of anything set down. */
select private.shut('alter table placed add column if not exists crumbles_at timestamptz');
-- What the sweep looks graves up by, and what `rpc_ground` lists yours off: graves and nothing else.
select private.shut($ddl$create index if not exists placed_crumbles on placed (world_id, crumbles_at) where crumbles_at is not null$ddl$);

/* Whose grave it is, by the name they go by on this island. */
create or replace function grave_owner(g placed) returns text
language sql stable as $$
  select coalesce((select r.name from player r where r.world_id = g.world_id and r.uid = g.made_by), 'Somebody')
$$;

/*
 * Why this cannot be asked of the grave it is aimed at -- the piece, a thing
 * lying in one, or one a thing is being put into -- or null when it is not
 * aimed at one, or may be. Its owner takes one thing out or everything; all
 * else is refused, and everything is refused to anybody else. The browser's
 * `graveRefusal`, in the same words.
 */
create or replace function grave_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns text
language plpgsql stable as $$
declare g placed;
begin
  if p_target->>'kind' = 'furniture' then
    select * into g from placed
     where world_id = p_world and id = nullif(p_target->>'id', '')::bigint and crumbles_at is not null;
  elsif p_target->>'kind' = 'item' then
    select pl.* into g from item i join placed pl on pl.id = i.placed
     where i.world_id = p_world and i.id = target_item(p_target) and i.holder = 'furniture'
       and pl.crumbles_at is not null;
    if g.id is null and p_target ? 'into' then
      select * into g from placed
       where world_id = p_world and id = nullif(p_target->>'into', '')::bigint and crumbles_at is not null;
    end if;
  end if;
  if g.id is null then return null; end if;
  if g.made_by is distinct from p_uid then
    return 'That is ' || grave_owner(g) || '''s grave. Nobody but ' || grave_owner(g)
      || ' can open it, take from it or move it.';
  end if;
  if p_action in ('furniture_take_all', 'take_from_store') then return null; end if;
  return 'Nothing goes into a grave and nothing moves it. Take what is in it out before it crumbles.';
end $$;

/*
 * What somebody was carrying, into a grave where they fell, and what their
 * death is said in. Called by `player_die` before the body goes back to the
 * shore, since where it fell is where the grave goes. The browser's `bury`.
 */
create or replace function bury(p_world uuid, p_uid uuid) returns text
language plpgsql as $$
declare p player; v_worn bigint[]; v_x int; v_y int; v_fx double precision; v_fy double precision;
        v_shore boolean := false; v_size int[]; v_ax int; v_ay int; v_sx int; v_sy int; v_grave bigint;
        c record;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  -- What stays on the body: whatever is worn where a blow lands, and a jewel.
  v_worn := array(select e.value::bigint from jsonb_each_text(coalesce(p.equipped, '{}'::jsonb)) e
                   where e.value ~ '^[0-9]+$'
                     and (e.key in (select h.slot from hit_location h) or e.key = 'jewel'));
  if p.uid is null or not exists (
       select 1 from item i
        where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
          and i.creature is null and i.deal is null and not (i.id = any(v_worn))) then
    return 'You have died. You wake up, shivering, where you first came ashore.';
  end if;

  v_x := floor(p.x)::int; v_y := floor(p.y)::int; v_fx := p.x; v_fy := p.y;
  -- Water too deep to stand in: the nearest dry ground within reach, when there is any.
  if coalesce(centre_height(p_world, v_x, v_y), 0) < -swim_depth() then
    select s.x, s.y into c from shore_near(p_world, p.x, p.y, grave_reach()::int) s;
    if found then
      v_x := c.x; v_y := c.y; v_fx := c.x + 0.5; v_fy := c.y + 0.5; v_shore := true;
    end if;
  end if;
  -- On that tile, the free block nearest where the body lay; with none free, where it lay.
  v_size := placed_size('furniture', 'grave', 's');
  v_ax := least(subtiles() - v_size[1], greatest(0, floor((v_fx - v_x) * subtiles())::int));
  v_ay := least(subtiles() - v_size[2], greatest(0, floor((v_fy - v_y) * subtiles())::int));
  select a.sx, b.sy into v_sx, v_sy
    from generate_series(0, subtiles() - v_size[1]) a(sx), generate_series(0, subtiles() - v_size[2]) b(sy)
   where not block_taken(p_world, v_x, v_y, a.sx, b.sy, v_size[1], v_size[2])
   order by (a.sx - v_ax) ^ 2 + (b.sy - v_ay) ^ 2, b.sy, a.sx
   limit 1;
  if v_sx is null then v_sx := v_ax; v_sy := v_ay; end if;

  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, crumbles_at)
  values (p_world, 'furniture', 'grave', v_x, v_y, v_sx, v_sy,
          v_x + (v_sx + v_size[1] / 2.0) / subtiles(), v_y + (v_sy + v_size[2] / 2.0) / subtiles(),
          20, p_uid, now() + make_interval(secs => grave_keeps()))
  returning id into v_grave;
  -- A light goes out on the way in: nothing burns down in the ground.
  update item i set charges = round(candle_left(i))::int, lit = false, lit_at = null
   where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.lit
     and i.creature is null and i.deal is null and not (i.id = any(v_worn));
  -- And in. A bag's contents follow it (`item_bag_follows`), so they are nobody's
  -- until it is taken out again, and then its taker's.
  update item i set holder = 'furniture', holder_uid = null, placed = v_grave
   where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
     and i.creature is null and i.deal is null and not (i.id = any(v_worn));
  -- Nothing is in your hands or on your belt any more.
  update player set equipped = coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(equipped) e
                                          where e.key in (select h.slot from hit_location h) or e.key = 'jewel'),
                                        '{}'::jsonb)
   where world_id = p_world and uid = p_uid;
  return 'You have died. What you carried is in a grave '
    || case when v_shore then 'on the nearest dry ground to where you fell' else 'where you fell' end
    || '; only you can open it, and it crumbles in ' || grave_keeps_said() || '.';
end $$;

/*
 * The graves whose hour is up, and whatever was still in them: `item.placed`
 * takes what lay in one when it goes, and a bag takes what was in it. Its
 * owner is told what was lost, in the browser's words. Ordered by when each
 * crumbles, off `placed_crumbles`, so a round with none due is a probe that
 * finds nothing.
 */
create or replace function grave_sweep(p_world uuid) returns int
language plpgsql as $$
declare g record; n int := 0;
begin
  for g in
    select pl.id, pl.made_by, pl.x, pl.y,
           (select coalesce(sum(i.count), 0) from item i where i.placed = pl.id and i.holder = 'furniture') as lost
      from placed pl
     where pl.world_id = p_world and pl.crumbles_at is not null and pl.crumbles_at <= now()
     order by pl.crumbles_at
  loop
    delete from placed where id = g.id;
    if g.lost > 0 and g.made_by is not null then
      perform tell(p_world, g.made_by, 'Your grave at ' || g.x || ', ' || g.y || ' has crumbled. '
        || case when g.lost = 1 then 'The one thing still in it is lost.'
                else 'The ' || g.lost || ' things still in it are lost.' end, 'event');
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

CREATE OR REPLACE FUNCTION public.act_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare why text;
begin
  why := body_refusal(p_world, p_uid, p_action);
  if why is not null then return why; end if;
  -- A grave opens for whoever lies under it, and only to be emptied.
  why := grave_refusal(p_world, p_uid, p_action, p_target);
  if why is not null then return why; end if;
  return act_refusal_rules(p_world, p_uid, p_action, p_target);
end $function$;

CREATE OR REPLACE FUNCTION public.player_die(p_world uuid, p_uid uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare w world; v_said text;
begin
  select * into w from world where id = p_world;
  -- What you were carrying goes into a grave where you fell, before the body
  -- is anywhere else: where it fell is where the grave goes.
  v_said := bury(p_world, p_uid);
  -- Whatever killed you stays with the body. The wounds that did it would
  -- open you again in a minute, and nothing you could do would be quick
  -- enough; waking up is waking up whole.
  update player set
      stats = jsonb_build_object('health', 1, 'stamina', 0.5, 'hunger', 0.6, 'thirst', 0.6,
                                 'hurtSettled', to_jsonb(now())),
      wounds = '[]'::jsonb, x = w.spawn_x + 0.5, y = w.spawn_y + 0.5, level = 0,
      act = null, act_target = null, act_started = null, act_ends = null, act_left = null, act_goes = null,
      act_queue = '[]'::jsonb, moved_at = now(), aboard = null, seat = null
    where world_id = p_world and uid = p_uid;
  perform tell(p_world, p_uid, v_said, 'error');
end $function$;

CREATE OR REPLACE FUNCTION public.spoil_near(p_world uuid, p_uid uuid, p_item bigint)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_def text; v_want text[] := array['dirt', 'clay', 'sand'];
begin
  v_def := spoil_in_hand(p_world, p_uid, p_item);
  if v_def is not null or p_item is not null then return v_def; end if;
  select i.def into v_def from item i
    join crate c on c.world_id = i.world_id and c.id = i.crate
   where i.world_id = p_world and i.holder = 'crate' and i.def = any(v_want) and not i.locked
     and c.id = (select cc.id from nearest_crate(p_world, crate_centre_x(c), crate_centre_y(c), 2.5) cc limit 1)
   order by array_position(v_want, i.def), i.id limit 1;
  if v_def is not null then return v_def; end if;
  select i.def into v_def from item i
    join placed p on p.world_id = i.world_id and p.id = i.placed
   where i.world_id = p_world and i.holder = 'furniture' and i.def = any(v_want) and not i.locked
     and near_piece(p_world, p_uid, p, 2.5)
     -- Not out of a grave, whoever's it is: what is in one comes out through its own doors or not at all.
     and p.crumbles_at is null
   order by array_position(v_want, i.def), i.id limit 1;
  return v_def;
end $function$;

CREATE OR REPLACE FUNCTION public.take_spoil(p_world uuid, p_uid uuid, p_def text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare v_id bigint;
begin
  if consume(p_world, p_uid, p_def, 1) then return true; end if;
  select i.id into v_id from item i
    join crate c on c.world_id = i.world_id and c.id = i.crate
   where i.world_id = p_world and i.holder = 'crate' and i.def = p_def and not i.locked
     and sqrt((crate_centre_x(c) - (select pl.x from player pl where pl.world_id = p_world and pl.uid = p_uid)) ^ 2
            + (crate_centre_y(c) - (select pl.y from player pl where pl.world_id = p_world and pl.uid = p_uid)) ^ 2) <= 2.5
   order by i.id limit 1;
  if v_id is null then
    select i.id into v_id from item i
      join placed p on p.world_id = i.world_id and p.id = i.placed
     where i.world_id = p_world and i.holder = 'furniture' and i.def = p_def and not i.locked
       and near_piece(p_world, p_uid, p, 2.5)
       -- Not out of a grave, as `spoil_near` asks.
       and p.crumbles_at is null
     order by i.id limit 1;
  end if;
  if v_id is null then return false; end if;
  update item set count = count - 1 where id = v_id and count > 1;
  if found then return true; end if;
  delete from item where id = v_id;
  return found;
end $function$;

CREATE OR REPLACE FUNCTION public.ground_sweep(p_world uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare v_n int;
begin
  with due as (
    select i.id from item i
     where i.world_id = p_world and i.holder = 'ground'
       and coalesce(i.rot_at, '-infinity'::timestamptz) <= now() - ground_step()
     -- No tie-break on id: it would cost the ordered index scan, and rows
     -- sharing a moment are equally due.
     order by coalesce(i.rot_at, '-infinity'::timestamptz)
     limit ground_rows()
  )
  update item i set
      dmg = least(100, i.dmg + case when i.rot_at is null then 0
                   else ground_decay_rate(i) * decay_multiplier(p_world, i.gx, i.gy)
                        * extract(epoch from (now() - i.rot_at)) / 3600 end),
      rot_at = now()
    from due where i.id = due.id;
  get diagnostics v_n = row_count;
  delete from item where world_id = p_world and holder = 'ground' and dmg >= 100;
  -- And the graves whose hour is up, which go the same way and on the same round.
  perform grave_sweep(p_world);
  return v_n;
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
  /*
   * On the slow half only, because this writes.
   *
   * The fast read runs about once a second per body — everything burning, what
   * is on the tile under you — and a settle on that path is an update a second
   * per player whether or not anything is due. The crops ride the slow half
   * beside the settlements, and any of your own work forces one of those, so
   * sowing is seen at once and a stage is at worst one reconcile late.
   */
  if p_slow then perform crops_settle(p_world, p.x, p.y, p_range); end if;
  return jsonb_build_object(
    'placed', coalesce((select jsonb_agg(
        (to_jsonb(pl) - 'world_id' - 'made_by' - 'since' - 'made_at' - 'cx' - 'cy' - 'crumbles_at')
        || jsonb_build_object('fuel', placed_fuel(pl), 'ash', placed_ash(pl),
                              'lit', placed_lit(pl), 'mine', coalesce(pl.made_by = me, false),
        /*
         * And what is in it, which this never said.
         *
         * Reported as "i opened it and dragged my dirt into it and the dirt
         * vanished". It had not: the island had the dirt in the bin and told
         * nobody. Every chest, bin, larder and cart on an island read as
         * empty over there, so anything put away went out of the pack and was
         * never seen again — the same hole a crate fell down before crates
         * carried their contents, and closed the same way. Within six tiles
         * only: you must be within two and a half to reach into one, so six
         * is generous, and a yard of full chests is not worth a phone's
         * second.
         */
                              'things', case when pl.kind = 'furniture'
                                              and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= 6
                                              -- A grave's, to whoever lies under it and nobody else.
                                              and (pl.crumbles_at is null or pl.made_by = me)
                                then coalesce((select jsonb_agg(jsonb_build_object(
                                       'id', i.id, 'def', i.def, 'ql', i.ql, 'dmg', i.dmg,
                                       'count', i.count, 'extra', i.extra) order by i.id)
                                     from item i
                                     where i.world_id = p_world and i.holder = 'furniture' and i.placed = pl.id),
                                   '[]'::jsonb)
                                else '[]'::jsonb end)
        /*
         * Whether a helm is as good as empty, its holder gone away, and who is
         * aboard as a passenger and in which place: only for a piece that has
         * either, so nothing else carries two more keys it does not need.
         */
        || case when pl.driver is null then '{}'::jsonb
                else jsonb_build_object('helm_open', coalesce((select r.away from player r
                       where r.world_id = p_world and r.uid = pl.driver), true)) end
        || coalesce((select jsonb_build_object('riders', jsonb_agg(jsonb_build_object('uid', r.uid, 'seat', r.seat)
                       order by r.seat))
                     from player r where r.world_id = p_world and r.aboard = pl.id
                     having count(*) > 0), '{}'::jsonb)
        /*
         * And a grave: whose it is, for what anybody else is told when they
         * try it; the seconds it has left, which a browser counts down on its
         * own clock rather than reading this island's; and, to its owner, how
         * many things are in it, which `things` only says from within reach --
         * the way `units` rides beside a crate's contents.
         */
        || case when pl.crumbles_at is null then '{}'::jsonb
                else jsonb_build_object('grave', jsonb_build_object('name', grave_owner(pl),
                       'left', greatest(0, extract(epoch from (pl.crumbles_at - now()))),
                       'units', case when pl.made_by = me then (select coalesce(sum(i.count), 0) from item i
                                  where i.placed = pl.id and i.holder = 'furniture') end)) end
        order by pl.id)
      from placed pl
      where pl.world_id = p_world
        -- The box first, in the whole tiles `placed_near` is keyed on, and then
        -- the exact question. A btree cannot look up a function of a column, so
        -- the exact test on its own read every placed thing on the island, on
        -- every ground poll, for every player. `x` is `floor(cx)` and `y` is
        -- `floor(cy)` -- `drag_along` and every placing write both together --
        -- so a tile of slack each way makes the box a superset of the answer
        -- and the line below still decides who is in it.
        and pl.x between floor(p.x - p_range)::int - 1 and floor(p.x + p_range)::int + 1
        and pl.y between floor(p.y - p_range)::int - 1 and floor(p.y + p_range)::int + 1
        and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= p_range), '[]'::jsonb),
    'crates', crates_near(p_world, me, p_range),
    /*
     * And what is lying on the ground, which this never carried.
     *
     * Reported as "killed a roxxa, no corpse dropped to butcher, or at least
     * isn't displaying". The corpse was there: `wound_beast` drops one where
     * the thing fell, and the suite has measured it since kills were ported.
     * This sent the fires, the crates, the crops and the walls, and never a
     * thing lying on the grass — and the browser's map of the ground was only
     * ever written by its own rules, which do not run on an island. So a
     * corpse, a log a worker put down, a hatchet somebody else dropped: all
     * in this table and drawn by nobody.
     *
     * On the fast half, because a corpse is looked for the second the thing
     * goes down; `item_on_ground` serves the box. The whole row, the way the
     * pack is sent, so the browser reads it with the same map.
     */
    'lying', coalesce((select jsonb_agg(to_jsonb(i) - 'world_id' order by i.id)
      from item i
      where i.world_id = p_world and i.holder = 'ground'
        and i.gx between floor(p.x - p_range)::int and floor(p.x + p_range)::int
        and i.gy between floor(p.y - p_range)::int and floor(p.y + p_range)::int), '[]'::jsonb))
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
    /*
     * And every grave of yours, however far off: you wake a long way from
     * where you fell, and `placed` above is only what is in range. The map
     * marks them and takes the mark up when one goes. Off the index the
     * sweep uses, which holds nothing but graves.
     */
    'graves', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'x', g.x, 'y', g.y) order by g.id)
      from placed g
      where g.world_id = p_world and g.crumbles_at is not null and g.made_by = me), '[]'::jsonb),
    /*
     * What is growing here, settled first so the stage reported is the stage
     * it is actually at rather than the stage it was at when somebody last
     * touched it. Everything on this island settles lazily off a timestamp,
     * and for a crop nobody had ever been the one to ask.
     *
     * `ago` rather than `stage_at`: the browser counts in its own seconds and
     * has no use for the hour this island stamped on it.
     */
    'crops', coalesce((select jsonb_agg(jsonb_build_object(
        'x', c.x, 'y', c.y, 'id', c.id, 'stage', c.stage,
        'ago', extract(epoch from (now() - c.stage_at)),
        'tended', c.tended, 'tendedNow', c.tended_now, 'ql', c.ql))
      from crop c
      where c.world_id = p_world
        and greatest(abs(c.x + 0.5 - p.x), abs(c.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    /*
     * The felling notches near you, and how long ago the woods last turned
     * over. Look reads both: "2 of 3 strokes in it", "the woods turn over in
     * 9 hours". A browser on an island keeps no clock of its own for the
     * woods, so this is the only place it hears the hour.
     */
    'notches', coalesce((select jsonb_agg(jsonb_build_object('x', n.x, 'y', n.y, 'cuts', n.cuts))
      from tree_notch n
      where n.world_id = p_world
        and greatest(abs(n.x + 0.5 - p.x), abs(n.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    'treesAgo', (select extract(epoch from (now() - w.trees_at)) from world w where w.id = p_world),
    -- The mark the ground is being worked to, which lives on the player row
    -- so that it is the same mark in every browser you open.
    'level', p.level_h,
    -- What you are on each of them, so the browser can say what you may do
    -- rather than finding out by being refused. Your own first one is your
    -- own or one you were asked onto; either way `deed_role` says which.
    'deed', (select jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level, 'mine', true,
        'role', deed_role(p_world, d.founded_by, me))
      from my_deed(p_world, me) d where d.world_id is not null),
    'deeds', coalesce((select jsonb_agg(jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level,
        -- Land you were asked onto is land you may work, so it is drawn as
        -- yours rather than as a stranger's border you happen to be inside.
        'mine', exists (select 1 from deed_member m where m.world_id = p_world
                          and m.uid = me and m.founder = d.founded_by),
        'role', deed_role(p_world, d.founded_by, me),
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
          and greatest(abs(f.x + 0.5 - p.x), abs(f.y + 0.5 - p.y)) <= p_range), '[]'::jsonb)),
    /*
     * And the slabs, which are not buildings and do not go in with them: a
     * foundation is ground somebody poured, and the browser lays it beside the
     * terrain rather than inside a house.
     */
    'foundations', coalesce((select jsonb_agg(jsonb_build_object(
        'id', fo.id, 'x', fo.x, 'y', fo.y, 'top', fo.top,
        'needed', fo.needed, 'total', fo.total) order by fo.id)
      from foundation fo
      where fo.world_id = p_world
        and greatest(abs(fo.x + 0.5 - p.x), abs(fo.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    'nextFoundationId', coalesce((select max(fo.id) + 1 from foundation fo where fo.world_id = p_world), 1)) end;
end $function$;

select private.lock_doors();
