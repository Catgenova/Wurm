-- Three reported: a mouthful of coal, a bin that ate what went in it
--
-- "Attempting to feed one coal to a smelter puts four coal in." The menu
-- offers one or all and sends the count either way; the island's fuelling fed
-- as much as would fit whatever it was told, so a firebox with room in it
-- swallowed the whole pile on a single "one". It reads the count now, as the
-- browser always has.
--
-- "I opened it and dragged my dirt into it and the dirt vanished." It had
-- not: the island had the dirt in the bin and told nobody. The ground read
-- sent every piece of furniture's row and never what was inside it, so every
-- chest, bin, larder and cart on an island read as empty in a browser — and
-- anything put away went out of the pack and was never seen again. This is
-- the same hole a crate fell down before crates carried their contents
-- ("if I put things in the deed crate it automatically puts them back in my
-- inventory"), and it closes the same way: the contents ride with the row,
-- for a piece within six tiles, which is more than the two and a half it
-- takes to reach into one.
--
-- The third of the three is the journal's, and the journal is the browser's
-- alone: the note for smelting ore was hung on the smelting skill passing 2
-- rather than on a lump coming out of the furnace.

CREATE OR REPLACE FUNCTION public.perform_fire(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p placed; it item; sz int[]; ax int; ay int; per double precision; room double precision;
        fits int; whole int; sub text; made bigint; back text;
begin
  if p_action = 'build_campfire' then
    ax := least(subtiles() - 2, greatest(0, (p_target->>'sx')::int));
    ay := least(subtiles() - 2, greatest(0, (p_target->>'sy')::int));
    if not consume(p_world, p_uid, 'shaft', 2) then return; end if;
    insert into placed (world_id, kind, x, y, sx, sy, cx, cy, fuel, made_by)
    values (p_world, 'campfire', (p_target->>'x')::int, (p_target->>'y')::int, ax, ay,
            (p_target->>'x')::int + (ax + 1.0) / subtiles(), (p_target->>'y')::int + (ay + 1.0) / subtiles(),
            120, p_uid);
    perform tell(p_world, p_uid, 'You lay a campfire from 2 shafts. Light it, or feed it more wood first.', 'event');
    perform land_announce(p_world, (p_target->>'x')::int, (p_target->>'y')::int);
    return;
  end if;

  if p_action in ('place_smelter', 'place_furniture', 'place_kiln') then
    select * into it from item where id = target_item(p_target);
    sub := case when p_action = 'place_furniture' then replace(it.def, 'furniture_', '') end;
    -- Which way it faces, which is the browser's to say and south when it says nothing.
    back := case when p_target->>'facing' in ('n', 'e', 's', 'w') then p_target->>'facing' else 's' end;
    sz := placed_size(case p_action when 'place_smelter' then 'smelter'
                                    when 'place_kiln' then 'kiln' else 'furniture' end, sub, back);
    ax := least(subtiles() - sz[1], greatest(0, coalesce((p_target->>'sx')::int, 0)));
    ay := least(subtiles() - sz[2], greatest(0, coalesce((p_target->>'sy')::int, 0)));
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, facing)
    values (p_world, case p_action when 'place_smelter' then 'smelter'
                                   when 'place_kiln' then 'kiln' else 'furniture' end, sub,
            (p_target->>'x')::int, (p_target->>'y')::int, ax, ay,
            (p_target->>'x')::int + (ax + sz[1] / 2.0) / subtiles(),
            (p_target->>'y')::int + (ay + sz[2] / 2.0) / subtiles(),
            it.ql, p_uid, back)
    returning id into made;
    delete from item where id = it.id;
    perform tell(p_world, p_uid, 'You set the ' ||
      lower(coalesce((select name from furniture_def where id = sub),
        case when p_action = 'place_kiln' then 'kiln' else 'smelter' end)) || ' down.', 'event');
    perform land_announce(p_world, (p_target->>'x')::int, (p_target->>'y')::int);
    return;
  end if;

  perform placed_settle(nullif(p_target->>'id', '')::bigint);
  p := target_placed(p_world, p_target);
  if p.id is null then return; end if;

  if p_action in ('light_campfire', 'light_smelter', 'light_kiln') then
    update placed set lit = true, since = now() where id = p.id;
    if p_action = 'light_campfire' then perform journal_note(p_world, p_uid, 'fire'); end if;
    perform tell(p_world, p_uid, 'The kindling catches and the ' || p.kind || ' burns. It has '
      || burns_for(p.fuel) || ' of fuel.', 'event');
  elsif p_action in ('put_out_campfire', 'damp_smelter', 'damp_kiln') then
    update placed set lit = false, since = now() where id = p.id;
    perform tell(p_world, p_uid, 'You smother the fire. The wood is saved for later.', 'event');
  elsif p_action in ('fuel_campfire', 'fuel_smelter', 'fuel_kiln') then
    select * into it from item
      where world_id = p_world and holder = 'player' and holder_uid = p_uid
        and (id = target_item(p_target) or fuel_value(def) is not null)
      order by (id = target_item(p_target)) desc limit 1;
    per := fuel_value(it.def);
    room := greatest(0, fire_capacity() - p.fuel);
    /*
     * How many you asked for, which this never read.
     *
     * Reported as "attempting to feed one coal to a smelter puts four coal
     * in". The menu offers one or all and sends the count either way; this
     * fed as much as would fit whatever it was told, so a firebox with room
     * in it swallowed the whole pile on a single "one". The browser has read
     * the count since fuelling was written.
     */
    fits := greatest(1, least(least(coalesce((p_target->>'count')::int, 1), it.count),
                              ceil(room / per)::int));
    if not consume(p_world, p_uid, it.def, fits, it.id) then return; end if;
    update placed set fuel = least(fire_capacity(), p.fuel + per * fits), since = now() where id = p.id;
    perform tell(p_world, p_uid, 'You feed ' || case when fits > 1 then fits || ' × ' else 'a ' end
      || lower((select name from item_def where id = it.def)) || ' to the fire. '
      || burns_for(least(fire_capacity(), p.fuel + per * fits)) || ' of fuel.', 'event');
  elsif p_action in ('take_ashes_fire', 'take_ashes_smelter', 'take_ashes_kiln') then
    whole := floor(p.ash)::int;
    update placed set ash = p.ash - whole, since = now() where id = p.id;
    perform give(p_world, p_uid, 'ash', whole, 20);
    perform tell(p_world, p_uid, 'You rake ' || whole || case when whole = 1 then ' lot' else ' lots' end
      || ' of ashes out of the ' || p.kind || '. (QL 20)', 'event');
  elsif p_action = 'take_apart_campfire' then
    -- Coal burns but is never got back, so a pile of logs cannot be turned
    -- into coal by rebuilding the fire.
    delete from placed where id = p.id;
    perform give(p_world, p_uid, 'shaft', 2, 20);
    perform tell(p_world, p_uid, 'You take the campfire apart and save what will burn again.', 'event');
    perform land_announce(p_world, p.x, p.y);
  elsif p_action = 'turn_furniture' then
    -- A quarter turn to the right, walked to the nearest spot the turned block fits.
    back := turned_facing(p.facing, 1);
    sz := placed_size(p.kind, p.sub, back);
    ax := least(subtiles() - sz[1], greatest(0, p.sx));
    ay := least(subtiles() - sz[2], greatest(0, p.sy));
    update placed set facing = back, sx = ax, sy = ay,
        cx = p.x + (ax + sz[1] / 2.0) / subtiles(), cy = p.y + (ay + sz[2] / 2.0) / subtiles()
      where id = p.id;
    perform tell(p_world, p_uid, 'You turn the ' || lower(placed_name(p)) || ' to face ' || side_name(back) || '.', 'event');
    perform land_announce(p_world, p.x, p.y);

  elsif p_action in ('pick_up_smelter', 'pick_up_furniture', 'pick_up_kiln') then
    back := case p.kind when 'smelter' then 'smelter' when 'kiln' then 'kiln'
                        else 'furniture_' || p.sub end;
    delete from placed where id = p.id;
    perform give(p_world, p_uid, back, 1, p.ql);
    perform tell(p_world, p_uid, 'You take up the ' || lower(coalesce(p.sub, p.kind)) || '.', 'event');
    perform land_announce(p_world, p.x, p.y);
  end if;
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
