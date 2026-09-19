-- The island stops reading the whole island to answer one question
--
-- None of this changes a rule. Every answer below is the answer that was
-- given before, arrived at without walking past everything that was not being
-- asked about. Measured on Bigness, four thousand and ninety-six square, with
-- `pg_stat_statements` tracking inside the functions.
--
-- ## A pack was weighed by reading every item on every island
--
-- `item_weight` asks what is inside a container: `where i.inside = it.id`. The
-- index for that is `item_in_bag`, which is `btree (inside) where holder =
-- 'bag'` -- and the query says nothing about `holder`, so the index could not
-- be used and the question was answered by reading the `item` table end to
-- end. Once per thing carried. On `rpc_move`, which is the call a walking
-- browser makes constantly, because `over_carry` weighs the pack on every
-- step to ask whether it is over half again the limit.
--
-- It is not the pack that sets the price, it is the table:
--
--     455 rows in `item`:     1.16 ms a call
--     50,455 rows in `item`:  40 ms a call
--
-- -- and the fifty thousand were on a *different island*. Somebody else's
-- chest slowed your walk down.
--
-- The index is widened rather than the query narrowed. Adding `and i.holder =
-- 'bag'` would have done the same job and would have been a change to what
-- gets weighed; this way the query is the same query, byte for byte, and only
-- the path to the answer is different. **4,107 ms to 84 ms over a hundred
-- calls, forty-nine times.**
--
-- ## Every row read was asking the same question over again
--
-- Five read policies are shaped `(select private.on_island(t.world_id))`. The
-- wrapper is the right idea -- it is how you tell the planner to work
-- something out once -- but it only works when what is inside does not depend
-- on the row. `t.world_id` is a column, so it does, so the planner cannot
-- hoist it, and what should have been one question became one per row:
--
--     reading 13,065 `tile_change` rows, no policy:   1.84 ms
--     the same read, through the policy:             77.97 ms   (loops=13065)
--
-- `private.my_islands()` takes no arguments and names no column, so it is
-- worked out once and the rows are matched against what it returns. Same
-- function, same `security definer`, same islands, same rows -- **2.57 ms,
-- thirty times**, and the planner can now use an index on the read, which it
-- never could before. `player`'s own policy reads `player`, which is the
-- recursion this shape usually walks into; `security definer` is what keeps
-- it out, and that was already there.
--
-- ## A box a btree could not look up
--
-- `creature_sweep` learned this one already and says so in its own comment:
-- `greatest(abs(dx), abs(dy)) <= r` *is* a box, but it is a function of a
-- column, and a btree cannot look one up. It was fixed there and nowhere
-- else. `rpc_ground`, `crates_near` and `crops_settle` all still read every
-- placed thing, every crate and every crop on the island and then threw away
-- the ones that were not close -- on every ground poll, for every player,
-- seconds apart.
--
-- Each now asks the box first, in whole tiles, which the index is keyed on,
-- and *then* the same exact question as before. `x` is `floor(cx)` on every
-- row that exists -- `drag_along` and every placing write the pair together,
-- and nothing on this island violates it -- so a tile of slack each way makes
-- the box a superset of the answer and the line after it still decides.
--
-- ## A line of sight read the island a corner at a time
--
-- `line_clear` walks the tiles between two points asking `creature_tile_ok`
-- of each, and that is nine single-row lookups a tile: one for the ground,
-- four corners for the height, the same four again for the slope. It is
-- seventy per cent of `creature_sweep`, which is twenty-six of the twenty-
-- eight milliseconds of `rpc_creatures` -- the poll that is deliberately
-- never slowed down, because stale wildlife is the one thing here that reads
-- as broken.
--
-- `walk_share` solved this for walking bodies years of commits ago: the land
-- is kept in sixty-four-square blocks, one row apiece. `line_clear` now reads
-- the same blocks. It only ever *reads* one -- `land_chunk_get` makes a
-- missing block and therefore writes, and this function has to stay STABLE
-- because `chase_leg` is STABLE and calls it -- so where no block has been
-- built yet it falls back to the old road tile by tile, which is also what
-- makes it exactly the old answer. **27.2 ms to 10.2 ms, and nought
-- disagreements over seven thousand lines** taken across block seams, off the
-- edges of the map, and on an island sixteen tiles wide.
--
-- ## And the small ones
--
-- `walk_share` asked `driving` twice, `mount_of` after it, and `skill_of` for
-- climbing twice. All three are STABLE and the function writes nothing in
-- between, so the second ask could only ever return what the first did.
--
-- Four indexes that were simply missing. `creature.rider`, `placed.driver`
-- and `placed.puller` are looked up by `mount_of`, `driving` and `drag_along`
-- -- three times, twice and three times per walk call respectively -- and had
-- no index at all, so each was a scan of everything on the island. `crate`
-- had no spatial index for the box above. `tile_def.name` had none either,
-- and `tile_id(name)` is called from twenty functions: stocking one block of
-- country called it seventy-four thousand times, and every one of those was
-- a sequential scan.
--
-- ## What was measured to prove it is the same island
--
-- `rpc_ground` and `crates_near` byte-identical before and after; seven
-- thousand `line_clear` lines with nought disagreements; the row counts
-- behind all five policies unchanged, a stranger still seeing nothing of an
-- island they are not on, and `player` not recursing.

-- ---------------------------------------------------------------- the indexes
drop index if exists item_in_bag;
create index if not exists item_inside on item (inside) where inside is not null;
create index if not exists tile_def_by_name on tile_def (name);
create index if not exists crate_near on crate (world_id, x, y);
create index if not exists creature_ridden on creature (world_id, rider) where rider is not null;
create index if not exists placed_driven on placed (world_id, driver) where driver is not null;
create index if not exists placed_pulled on placed (world_id, puller) where puller is not null;

-- ---------------------------------------------------------------- the doors
create or replace function private.my_islands() returns uuid[]
  language sql stable security definer set search_path to '' as $fn$
  select coalesce(array_agg(world_id), '{}'::uuid[])
  from public.player where uid = (select auth.uid())
$fn$;
revoke all on function private.my_islands() from public, anon;
grant execute on function private.my_islands() to authenticated;

alter policy player_read      on player      using (world_id = any (private.my_islands()));
alter policy placed_read      on placed      using (world_id = any (private.my_islands()));
alter policy tile_change_read on tile_change using (world_id = any (private.my_islands()));
alter policy deed_member_read on deed_member using (world_id = any (private.my_islands()));
alter policy item_read on item using (
  (holder = 'player' and holder_uid = (select auth.uid()))
  or (holder = 'bag' and holder_uid = (select auth.uid()))
  or (holder = 'ground' and world_id = any (private.my_islands()))
  or (holder = 'crate' and world_id = any (private.my_islands()))
  or (holder = 'furniture' and world_id = any (private.my_islands())));

-- ---------------------------------------------------------------- line_clear
create or replace function line_clear(p_world uuid, p_x0 double precision, p_y0 double precision,
                                      p_x1 double precision, p_y1 double precision)
returns boolean language plpgsql stable as $fn$
declare n int; i int; tx int; ty int; t double precision; size int;
        step int := chunk_size()::int; k land_chunk; kx int := -999; ky int := -999; walls int[];
begin
  select w.size into size from world w where w.id = p_world;
  if size is null then return false; end if;
  select coalesce(array_agg(id), '{}') into walls from tile_def where blocks;
  n := greatest(1, ceil(2 * sqrt(power(p_x1 - p_x0, 2) + power(p_y1 - p_y0, 2)))::int);
  for i in 0..n loop
    t := i::double precision / n;
    tx := floor(p_x0 + (p_x1 - p_x0) * t)::int;
    ty := floor(p_y0 + (p_y1 - p_y0) * t)::int;
    -- `in_bounds`, which the square below cannot answer: a chunk at the edge is
    -- padded out to its full width, and a padded byte is not ground.
    if tx < 0 or ty < 0 or tx >= size or ty >= size then return false; end if;
    if tx / step <> kx or ty / step <> ky then
      kx := tx / step; ky := ty / step;
      select * into k from land_chunk c where c.world_id = p_world and c.cx = kx and c.cy = ky;
    end if;
    if k.tiles is null or length(k.tiles) <= (ty - ky * step) * step + (tx - kx * step)
       or k.heights is null or length(k.heights) < (step + 1) * (step + 1) * 2 then
      -- No square built here yet, or one built short. The scanlines are the
      -- truth; this only ever reads the square, never makes one, because a
      -- STABLE function may not write and `chase_leg` needs this one STABLE.
      if not creature_tile_ok(p_world, tx, ty) then return false; end if;
    else
      if get_byte(k.tiles, (ty - ky * step) * step + (tx - kx * step)) = any (walls) then return false; end if;
      -- `bool_and` ignored a null and so does this: a corner the island has no
      -- row for makes the comparison null, which is not `true`, so nothing
      -- returns and the walk carries on. That was the old answer too.
      if chunk_centre(k, kx, ky, tx, ty, step) < -1 then return false; end if;
      if chunk_slope(k, kx, ky, tx, ty, step) > max_stand() then return false; end if;
    end if;
  end loop;
  return true;
end $fn$;

CREATE OR REPLACE FUNCTION public.walk_share(p_world uuid, p_uid uuid, p_level integer, p_x0 double precision, p_y0 double precision, p_x1 double precision, p_y1 double precision)
 RETURNS double precision
 LANGUAGE plpgsql
AS $function$
declare far double precision; n int; i int; t double precision;
        cart placed; climbing double precision;
        fx int; fy int; tx int; ty int; climb double precision;
        size int; step int := chunk_size()::int;
        k land_chunk; kx int := -999; ky int := -999;
        here double precision; there double precision; spans boolean; walls int[];
        stand double precision; afloat boolean; beast creature;
begin
  if p_level <> 0 then return 1; end if;
  far := sqrt(power(p_x1 - p_x0, 2) + power(p_y1 - p_y0, 2));
  if far <= 0.0001 then return 1; end if;
  select w.size into size from world w where w.id = p_world;
  fx := floor(p_x0)::int; fy := floor(p_y0)::int;
  -- Asked once for the island rather than once a tile. `bridge_at` is two
  -- index probes and a subquery, and on an island with no bridges on it at all
  -- — which is most of them, most of the time — it was the largest thing left
  -- in this loop once the ground came out of a square.
  spans := exists (select 1 from bridge b where b.world_id = p_world);
  -- The one tile nothing stands on, asked for once. A select per tile against
  -- a table of twenty rows is still a select per tile.
  select coalesce(array_agg(id), '{}') into walls from tile_def where blocks;
  if spans and bridge_at(p_world, fx, fy) is not null then return 1; end if;

  n := least(walk_samples()::int, greatest(1, ceil(far * 2)::int));
  -- Asked once. `driving`, `mount_of` and `skill_of` are all STABLE and this
  -- function writes nothing, so the second ask could only ever return what the
  -- first did -- at the price of another index probe apiece, on the one call a
  -- walking browser makes constantly.
  climbing := skill_of(p_world, p_uid, 'climbing');
  climb := max_step() + climbing * climb_per_level();
  /*
   * The steepest tile a body can stand on, before the step between tiles is
   * asked about at all: sixty between a tile's highest corner and its lowest,
   * and climbing raises it at the rate it raises the step. A rider has the
   * mount's legs under them, so the cap is the mount's, raised the way its
   * step is; wheels get the bare sixty; and a hull floats over whatever the
   * bottom does, so afloat there is no cap. A deck is ground: a bridge over a
   * steep tile is not the tile.
   */
  cart := driving(p_world, p_uid);
  afloat := coalesce(is_boat(cart), false);
  beast := mount_of(p_world, p_uid);
  if beast.id is not null then stand := max_stand() + mount_step(beast) - max_step();
  elsif cart.id is not null then stand := max_stand();
  else stand := max_stand() + climbing * climb_per_level();
  end if;
  for i in 1..n loop
    t := i::double precision / n;
    tx := floor(p_x0 + (p_x1 - p_x0) * t)::int;
    ty := floor(p_y0 + (p_y1 - p_y0) * t)::int;
    if tx <> fx or ty <> fy then
      if tx < 0 or ty < 0 or tx >= size or ty >= size then return (i - 1)::double precision / n; end if;
      if tx / step <> kx or ty / step <> ky then
        kx := tx / step; ky := ty / step;
        k := land_chunk_get(p_world, kx, ky);
      end if;
      -- A square built from an island with rows missing can be short; the
      -- scanlines are the truth, so fall back to them rather than reading off
      -- the end of a cache.
      if k.tiles is null or length(k.tiles) <= (ty - ky * step) * step + (tx - kx * step) then
        if not passable(p_world, tx, ty) then return (i - 1)::double precision / n; end if;
      elsif get_byte(k.tiles, (ty - ky * step) * step + (tx - kx * step)) = any (walls) then
        return (i - 1)::double precision / n;
      end if;
      if not afloat and (not spans or bridge_at(p_world, tx, ty) is null) then
        if k.heights is not null and length(k.heights) >= (step + 1) * (step + 1) * 2 then
          if chunk_slope(k, kx, ky, tx, ty, step) > stand then return (i - 1)::double precision / n; end if;
        elsif tile_slope(p_world, tx, ty) > stand then
          return (i - 1)::double precision / n;
        end if;
      end if;
      if abs(tx - fx) <= 1 and abs(ty - fy) <= 1
         and fx / step = kx and fy / step = ky
         and k.heights is not null and length(k.heights) >= (step + 1) * (step + 1) * 2
         and (not spans or bridge_at(p_world, tx, ty) is null) then
        there := chunk_centre(k, kx, ky, tx, ty, step);
        here := chunk_centre(k, kx, ky, fx, fy, step);
        if abs(there - here) > climb then return (i - 1)::double precision / n; end if;
      elsif abs(tx - fx) <= 1 and abs(ty - fy) <= 1
         and (not spans or bridge_at(p_world, tx, ty) is null)
         and abs(centre_height(p_world, tx, ty) - centre_height(p_world, fx, fy)) > climb then
        return (i - 1)::double precision / n;
      end if;
      fx := tx; fy := ty;
    end if;
  end loop;
  return 1;
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
        (to_jsonb(pl) - 'world_id' - 'made_by' - 'since' - 'made_at' - 'cx' - 'cy')
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
                                then coalesce((select jsonb_agg(jsonb_build_object(
                                       'id', i.id, 'def', i.def, 'ql', i.ql, 'dmg', i.dmg,
                                       'count', i.count, 'extra', i.extra) order by i.id)
                                     from item i
                                     where i.world_id = p_world and i.holder = 'furniture' and i.placed = pl.id),
                                   '[]'::jsonb)
                                else '[]'::jsonb end)
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

CREATE OR REPLACE FUNCTION public.crates_near(p_world uuid, p_uid uuid, p_range double precision)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce((select jsonb_agg((to_jsonb(c) - 'world_id' - 'made_by')
        || jsonb_build_object(
             'mine', crate_yours(p_world, p_uid, c.id),
             -- How full it is, for every crate in sight: a label does not need
             -- the contents and the contents are not free.
             /*
              * How full it is, counted once for the lot rather than once for
              * each of them.
              *
              * `crate_units` is a `sum` over `item`, and this ran it as a
              * correlated subquery for every crate within forty tiles, on
              * every ground read, for every player — a second apart. One
              * grouped pass over the same index answers all of them, and the
              * answer is the same answer.
              */
             'units', coalesce(u.units, 0),
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
      left join (select i.crate, sum(i.count)::int as units
                   from item i
                  where i.world_id = p_world and i.holder = 'crate'
                  group by i.crate) u on u.crate = c.id
      where c.world_id = p_world
        -- The box first, for `crate_near`; the exact question after it. See
        -- the note in `rpc_ground`.
        and c.x between floor(p.x - p_range)::int - 1 and floor(p.x + p_range)::int + 1
        and c.y between floor(p.y - p_range)::int - 1 and floor(p.y + p_range)::int + 1
        and greatest(abs(c.x + 0.5 - p.x), abs(c.y + 0.5 - p.y)) <= p_range), '[]'::jsonb)
    from player p where p.world_id = p_world and p.uid = p_uid
$function$;

CREATE OR REPLACE FUNCTION public.crops_settle(p_world uuid, p_x double precision, p_y double precision, p_range double precision)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare n int;
begin
  with near as (
    select c.x, c.y, c.stage, c.stage_at,
           /*
            * The gardener's path, which is the one effect of a path belonging
            * to somebody who is not here. A crop grows for whoever founded the
            * ground it is in, not for whoever happens to be looking at it.
            */
           d.stage_seconds * case when exists (
               select 1 from deed dd where dd.world_id = p_world
                 and abs(c.x - dd.x) <= dd.radius and abs(c.y - dd.y) <= dd.radius
                 and walks(p_world, dd.founded_by, 'love', 1)) then 0.8 else 1 end as per
      from crop c join crop_def d on d.id = c.id
     where c.world_id = p_world and c.stage < crop_ripe()
       -- The box first, which `crop_pkey` is keyed on. See the note in
       -- `rpc_ground`.
       and c.x between floor(p_x - p_range)::int - 1 and floor(p_x + p_range)::int + 1
       and c.y between floor(p_y - p_range)::int - 1 and floor(p_y + p_range)::int + 1
       and greatest(abs(c.x + 0.5 - p_x), abs(c.y + 0.5 - p_y)) <= p_range
  ), due as (
    select x, y, per,
           least(crop_ripe() - stage, floor(extract(epoch from (now() - stage_at)) / per)::int) as steps
      from near
  )
  update crop c set stage = c.stage + due.steps,
      -- The stage's own length, added on; not restarted from now.
      stage_at = c.stage_at + make_interval(secs => due.per * due.steps),
      tended_now = false
    from due
   where c.world_id = p_world and c.x = due.x and c.y = due.y and due.steps > 0;
  get diagnostics n = row_count;
  return n;
end $function$;

select private.lock_doors();
