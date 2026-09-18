-- What is growing, which nobody had been told to look for
--
-- Reported from the island: *"farming is broken, planting crops doesn't change
-- from an unfarmed field"*, and with it: make all the stages work with correct
-- timers.
--
-- Both are one omission, and `sawGround` in the browser already has the note
-- that explains it:
--
--     The browser never asked. `placed` has been there since the island was
--     built and nothing under `src/` ever read it…
--
-- That was written when the campfires and crates were found. `crop` sat in
-- Postgres beside them and was missed, and `rpc_ground` has never carried a
-- single row of it.
--
-- So on an island, sowing wrote a `crop` row that nothing on the other side of
-- the wire would ever read. The field stayed the bare tile it was tilled into,
-- no stage was ever drawn, and `cropAt` answering nothing meant the browser
-- went on offering Sow and never once offered Tend or Harvest. Every part of
-- farming past raking the ground was invisible, and the crops were growing the
-- whole time.
--
-- ## And the timers
--
-- `crop_settle` catches a crop up off its own timestamp, which is how
-- everything on this island works — but it was only ever called by somebody
-- *touching that tile*: `perform_farm`, `farm_refusal`, and the two worker
-- rules. Nothing asked on the clock and nothing asked on a read, so a stage
-- advanced at the moment you interacted with it and at no other.
--
-- `rpc_ground` settles what is growing near the body before it reports it, so
-- what comes back is the stage the crop is actually at. That also makes the
-- timers right for the *browser*, which now has a stage and how long it has
-- been in it and can count to the next one itself between reads.
--
-- ## One arithmetic, not two
--
-- Settling a field of crops a tile at a time on every ground read is a
-- statement per crop per player per twenty seconds. `crops_settle` does the
-- whole reach in one, and `crop_settle` is now a call of it with a reach of
-- nought — so the stage length, the steps, and the gardener's path bonus are
-- written once rather than in a fast version and a slow version that drift.

create or replace function crops_settle(p_world uuid, p_x double precision,
                                        p_y double precision, p_range double precision)
  returns integer language plpgsql as $fn$
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
end $fn$;

CREATE OR REPLACE FUNCTION public.crop_settle(p_world uuid, p_x integer, p_y integer)
 RETURNS boolean
 LANGUAGE sql
AS $function$
  -- One tile's worth of `crops_settle`, which is where the arithmetic lives.
  -- A reach of nought covers exactly the tile asked about.
  select crops_settle(p_world, p_x + 0.5, p_y + 0.5, 0) > 0
$function$;

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
end $function$

;

select private.lock_doors();
