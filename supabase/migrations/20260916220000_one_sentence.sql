-- One sentence for a trade going up, said in one place.
--
-- "Digging increased by 0.1234 to 12.3456." is the most-read line on this
-- island: every go of every job ends with one. It was written out by hand in
-- ten places, and a line written ten times is a line that says ten things.
-- Three of them are wrong, and had been since the day they were written:
--
--   * **The wrong name, in ten of the eleven.** They built it with
--     `initcap(replace(id, '_', ' '))`, and fifteen of the sixty trades are
--     not spelled that way. `skill_def.name` says *Armoursmithing* and the
--     island's log said *Armorsmithing*. It says *Chain armoursmithing* and
--     the log said *Chainsmithing*. It says *First aid*, *Body stamina*,
--     *Animal husbandry*; the log capitalised the second word of every one.
--     The Skills window draws `name`, so the log has been using a different
--     name for a skill than the window it sends you to.
--
--   * **No full stop, in one of them.** `perform_ground` reads
--     `skill_def.name` — alone among the ten, it had the name right — and
--     ends without the stop every other line ends with. A tell-tale: the one
--     that was written differently is the one that drifted.
--
--   * **A gain rounded away, in all of them.** `skill_gain_of` floors a gain
--     at `min_gain()` — a ten-thousandth — and then multiplies by a roll of
--     0.6 to 1.4, so a trade near a hundred is forever gaining six hundredths
--     of a ten-thousandth. `FM0.0000` reads all of those as "increased by
--     0.0001", and some of them as nothing at all. The browser has always
--     dropped to six places for exactly that case: "a skill at ninety-nine
--     deserves to see that it is moving at all."
--
-- So: `skill_said`, which is the browser's line term for term, and nine call
-- sites that ask for it instead of writing it out. `skill_told` — the one
-- that raises *and* says, and the only one of the eleven that was already a
-- function — now calls it too, so there is one sentence and not two.
--
-- No rule moves. This is the tenth of the ten suggestions, and it is here
-- because the sweep that found the other nine (`rules this island keeps and
-- never runs`) only finds rules nobody calls. It cannot find a rule written
-- out by hand eleven times, which is the other way the same mistake is made.

/**
 * Say that a trade went up, in the words the Skills window uses for it.
 *
 * `skill_def.name` rather than a name built out of the id, because the id is
 * not the name for a quarter of them. Six places rather than four when the
 * gain is smaller than four places can show, because a trade at ninety-nine
 * deserves to see that it is moving at all — which is what the browser has
 * always done and this had never done.
 *
 * Says nothing when nothing was gained: every caller was wrapping this in
 * `if gained > 0`, so the guard belongs in here with the sentence.
 */
create or replace function skill_said(p_world uuid, p_uid uuid, p_id text,
                                      p_gained double precision)
  returns void language plpgsql as $fn$
begin
  if p_id is null or coalesce(p_gained, 0) <= 0 then return; end if;
  perform tell(p_world, p_uid,
    coalesce((select name from skill_def where id = p_id), initcap(replace(p_id, '_', ' ')))
    || ' increased by '
    || to_char(p_gained, case when p_gained < 0.0001 then 'FM0.000000' else 'FM0.0000' end)
    || ' to ' || to_char(skill_of(p_world, p_uid, p_id), 'FM990.0000') || '.', 'skill');
end $fn$;

CREATE OR REPLACE FUNCTION public.act_perform(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare d action_def; tq double precision; s double precision; cx int; cy int; tx int; ty int;
        t tile_def; left_dirt int; made_ql double precision; yield text; gained double precision; tool_id bigint;
begin
  if last_action(p_action) then
    perform perform_last(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if faith_action(p_action) then
    perform perform_faith(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if ride_action(p_action) then
    perform perform_ride(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if hands_action(p_action) then
    perform perform_hands(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if liquid_action(p_action) then
    perform perform_liquid(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if forge_action(p_action) then
    perform perform_forge(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if holding_action(p_action) then
    perform perform_holding(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if settlement_action(p_action) then
    perform perform_settlement(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if dig_action(p_action) then
    perform perform_dig(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if trap_action(p_action) then
    perform perform_trap(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if ground_action(p_action) then
    perform perform_ground(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if build_action(p_action) then
    perform perform_building(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action = 'found_settlement' then
    perform perform_deed(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if creature_action(p_action) then
    perform perform_creature(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if fight_action(p_action) then
    perform perform_fight(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if crate_action(p_action) then
    perform perform_crate(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if item_action(p_action) then
    perform perform_item(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if firing_action(p_action) then
    perform perform_firing(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if fire_action(p_action) then
    perform perform_fire(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('mine', 'chip_corner', 'pack', 'cultivate', 'pave_gravel', 'pave_cobble', 'drop_dirt_here') then
    perform perform_terrain(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('cut_down', 'forage', 'botanize', 'collect') then
    perform perform_gather(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('till', 'plant_seed', 'tend_crop', 'harvest_crop', 'clear_field') then
    perform perform_farm(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('fish', 'drag_net') then
    perform perform_fish(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if exists (select 1 from recipe where id = p_action) then
    perform perform_craft(p_world, p_uid, p_action, p_target);
    return;
  end if;

  select * into d from action_def where id = p_action;
  s := case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end;

  if p_action = 'dig' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    select i.id into tool_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = d.tool
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id); end if;
    if not skill_check(s, d.difficulty, tq) then
      perform tell(p_world, p_uid, 'You fail to dig anything useful.', 'event');
      return;
    end if;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
    left_dirt := land_dirt(p_world, cx, cy) - 1;
    perform land_set_dirt(p_world, cx, cy, left_dirt);
    if t.turns_to_dirt then perform land_set_tile(p_world, tx, ty, 1); end if;
    -- Dug to the rock, the tile becomes rock and shows the seam under it.
    perform reconcile_around(p_world, cx, cy);
    perform land_announce(p_world, tx, ty);
    if left_dirt <= 0 then
      perform tell(p_world, p_uid, 'Your shovel grates on bare rock.', 'event');
    end if;
    yield := coalesce(t.dig_yield, 'dirt');
    made_ql := product_ql(s, tq);
    perform give(p_world, p_uid, yield, 1, made_ql);
    gained := skill_raise(p_world, p_uid, d.skill, 1);
    perform tell(p_world, p_uid,
      'You dig up some ' || lower((select name from item_def where id = yield)) ||
      '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    perform skill_said(p_world, p_uid, d.skill, gained);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_building(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; side text; b building; w wall; f floor_tile; mat build_material_def;
        wt wall_type_def; lvl int; kind text; used text; nm text; gained double precision;
        sk text; bill jsonb; other record; what text; new_id int;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  side := p_target->>'side';
  select * into b from building where world_id = p_world and id = building_at(p_world, tx, ty);

  if p_action = 'plan_building' then
    nm := left(coalesce(nullif(btrim(coalesce(p_target->>'name', '')), ''), 'House'), 32);
    select coalesce(max(id), 0) + 1 into new_id from building where world_id = p_world;
    insert into building (world_id, id, name, planned_by) values (p_world, new_id, nm, p_uid);
    insert into building_tile (world_id, building, x, y) values (p_world, new_id, tx, ty);
    perform tell(p_world, p_uid, 'You plan ' || nm || ' here. Extend it onto neighbouring flat packed '
      || 'tiles, then plan walls on its borders.', 'event');

  elsif p_action = 'add_to_building' then
    select * into b from building where world_id = p_world and id = neighbour_building(p_world, tx, ty);
    if not found then return; end if;
    insert into building_tile (world_id, building, x, y) values (p_world, b.id, tx, ty)
      on conflict do nothing;
    perform tell(p_world, p_uid, 'You add the tile to ' || b.name || '.', 'event');

  elsif p_action = 'remove_from_plan' then
    if b.id is null then return; end if;
    delete from building_tile where world_id = p_world and x = tx and y = ty;
    if exists (select 1 from building_tile where world_id = p_world and building = b.id) then
      perform tell(p_world, p_uid, 'You remove the tile from ' || b.name || '.', 'event');
    else
      -- The last tile of a plan is the plan.
      delete from building where world_id = p_world and id = b.id;
      perform tell(p_world, p_uid, 'You remove the last of ' || b.name || '''s plan.', 'event');
    end if;

  elsif p_action = 'rename_building' then
    if b.id is null then return; end if;
    nm := left(btrim(p_target->>'name'), 32);
    update building set name = nm where world_id = p_world and id = b.id;
    perform tell(p_world, p_uid, 'The building is now called ' || nm || '.', 'event');

  elsif p_action in ('plan_wall', 'plan_fence') then
    select * into wt from wall_type_def where id = p_target->>'wallType';
    select * into mat from build_material_def where id = p_target->>'material';
    lvl := case when p_action = 'plan_fence' then 0 else work_level(p_world, b.id) end;
    bill := wall_bill(mat.id, wt.id);
    insert into wall (world_id, level, dir, x, y, building, type, material, needed, total, planned_by)
    select p_world, lvl, bd.dir, bd.x, bd.y,
           case when p_action = 'plan_fence' then 0 else b.id end,
           wt.id, mat.id, bill, bill, p_uid
    from border_of(tx, ty, side) bd;
    if p_action = 'plan_fence' then
      perform tell(p_world, p_uid, 'You mark out a ' || lower(mat.name) || ' ' || lower(wt.name)
        || ' on the ' || side_name(side) || ' border. It needs ' || bill_text(mat.id, bill) || '.', 'event');
    else
      perform tell(p_world, p_uid, 'You plan a ' || lower(wt.name) || ' ' || lower(mat.name)
        || ' wall on the ' || side_name(side) || ' side. It needs ' || bill_text(mat.id, bill) || '.', 'event');
    end if;

  elsif p_action = 'build_wall' then
    w := wall_at(p_world, tx, ty, side);
    if w.world_id is null or bill_done(w.needed) then return; end if;
    select * into mat from build_material_def where id = w.material;
    used := next_material(p_world, p_uid, w.material, w.needed);
    if used is null or not consume(p_world, p_uid, used, 1) then return; end if;
    bill := jsonb_set(w.needed, array[used], to_jsonb((w.needed->>used)::int - 1));
    update wall set needed = bill where world_id = w.world_id and level = w.level
      and dir = w.dir and x = w.x and y = w.y;
    gained := skill_raise(p_world, p_uid, mat.skill, 0.4);
    select * into wt from wall_type_def where id = w.type;
    if bill_done(bill) then
      what := case when wt.low then lower(wt.name) else 'wall' end;
      perform tell(p_world, p_uid, 'You finish the ' || lower(mat.name) || ' ' || what || '.', 'event');
    else
      perform tell(p_world, p_uid, 'You fit ' || material_name(used, 1) || ' into the wall. Still needed: '
        || bill_text(w.material, bill) || '.', 'event');
    end if;
    perform skill_said(p_world, p_uid, mat.skill, gained);

  elsif p_action = 'remove_wall' then
    w := wall_at(p_world, tx, ty, side);
    if w.world_id is null then return; end if;
    select * into wt from wall_type_def where id = w.type;
    delete from wall where world_id = w.world_id and level = w.level and dir = w.dir and x = w.x and y = w.y;
    perform tell(p_world, p_uid, 'You take down the '
      || case when wt.low then lower(wt.name) else 'wall' end
      || ' on the ' || side_name(side) || ' side.', 'event');

  elsif p_action = 'add_floor' then
    if b.id is null then return; end if;
    update building set levels = levels + 1, work_level = levels
      where world_id = p_world and id = b.id returning * into b;
    perform tell(p_world, p_uid, 'You plan storey ' || b.levels || ' of ' || b.name
      || '. Plan and build its floor tiles, then raise walls on them.', 'event');

  elsif p_action = 'plan_floor' then
    if b.id is null then return; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := floor_level(p_world, b.id, kind);
    select * into mat from build_material_def where id = p_target->>'material';
    bill := floor_bill(mat.id, kind);
    insert into floor_tile (world_id, level, x, y, building, material, kind, facing, needed, total, planned_by)
    values (p_world, lvl, tx, ty, b.id, mat.id, kind,
            case when kind in ('stairs', 'ladder') then side end, bill, bill, p_uid);
    perform tell(p_world, p_uid, 'You plan a '
      || case when kind = 'ladder' then 'ladder' else lower(mat.name) || ' ' || floor_kind_name(kind) end
      || '. It needs ' || bill_text(mat.id, bill) || '.', 'event');

  elsif p_action = 'build_floor' then
    if b.id is null then return; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := floor_level(p_world, b.id, kind);
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found or bill_done(f.needed) then return; end if;
    select * into mat from build_material_def where id = f.material;
    used := next_material(p_world, p_uid, f.material, f.needed);
    if used is null or not consume(p_world, p_uid, used, 1) then return; end if;
    bill := jsonb_set(f.needed, array[used], to_jsonb((f.needed->>used)::int - 1));
    update floor_tile set needed = bill where world_id = p_world and level = lvl and x = tx and y = ty;
    -- Floors are paving; stairs, ladders and roofs are carpentry or masonry by material.
    sk := case f.kind when 'floor' then 'paving' when 'ladder' then 'carpentry'
                      else coalesce(mat.skill, 'carpentry') end;
    gained := skill_raise(p_world, p_uid, sk, 0.4);
    what := case when f.kind = 'ladder' then 'ladder' else lower(mat.name) || ' ' || floor_kind_name(f.kind) end;
    if bill_done(bill) then
      perform tell(p_world, p_uid, 'You finish the ' || what || '.', 'event');
    else
      perform tell(p_world, p_uid, 'You work ' || material_name(used, 1) || ' into the '
        || floor_kind_name(f.kind) || '. Still needed: ' || bill_text(f.material, bill) || '.', 'event');
    end if;
    perform skill_said(p_world, p_uid, sk, gained);

  elsif p_action = 'remove_floor' then
    if b.id is null then return; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := floor_level(p_world, b.id, kind);
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found then return; end if;
    delete from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    -- Anybody standing on what was just torn up goes down a storey, not through it.
    if lvl > 0 then
      update player set level = lvl - 1
        where world_id = p_world and floor(x)::int = tx and floor(y)::int = ty and level >= lvl;
    end if;
    perform tell(p_world, p_uid, 'You remove the ' || floor_kind_name(f.kind) || '.', 'event');

  elsif p_action = 'remove_storey' then
    if b.id is null or b.levels <= 1 then return; end if;
    update building set levels = levels - 1, work_level = levels - 2
      where world_id = p_world and id = b.id returning * into b;
    perform tell(p_world, p_uid, b.name || ' is back to '
      || case when b.levels = 1 then 'a single storey' else b.levels || ' storeys' end || '.', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_craft(p_world uuid, p_uid uuid, p_recipe text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare r recipe; i record; prefer bigint; mat text; hard double precision; tq double precision;
        s double precision; made_ql double precision; rare text; total double precision := 0;
        weight double precision := 0; one double precision; gained double precision;
begin
  select * into r from recipe where id = p_recipe;
  prefer := nullif(p_target->>'uid', '')::bigint;
  mat := craft_material(p_world, p_uid, p_recipe, prefer);
  s := skill_of(p_world, p_uid, r.skill);
  tq := case when r.tool is null then 0 else tool_ql(p_world, p_uid, r.tool) end;
  -- Oak and the deep metals fight the hands that shape them.
  hard := coalesce(r.difficulty, 0) + coalesce((select difficulty from material_def where id = mat), 0);

  if r.difficulty is not null and not skill_check(s, hard, tq) then
    if r.consume_on_fail then
      for i in select * from recipe_input where recipe = p_recipe order by ord loop
        perform consume(p_world, p_uid, i.item, i.count, prefer, mat);
      end loop;
      -- The batch is wasted, not the vessel: you tip the ruin out and keep the
      -- bucket. Salvage if the recipe names any, otherwise whatever it returns.
      for i in
        select g.item, g.count from recipe_gives g
        where g.recipe = p_recipe
          and g.kind = (case when exists (select 1 from recipe_gives where recipe = p_recipe and kind = 'salvage')
                             then 'salvage' else 'return' end)
      loop
        perform give(p_world, p_uid, i.item, i.count, 20);
      end loop;
    end if;
    perform tell(p_world, p_uid, coalesce(r.fail,
      'You fail to make ' || lower((select coalesce(name, r.result) from item_def where id = r.result)) || '.'), 'event');
    return;
  end if;

  -- The quality of what is about to be used up, worked out before it is used
  -- up, since using it up changes the answer.
  if r.ql_from_inputs then
    for i in select * from recipe_input where recipe = p_recipe order by ord loop
      select it.ql into one from item it
        where it.world_id = p_world and it.holder = 'player' and it.holder_uid = p_uid and it.def = i.item
        order by it.id limit 1;
      if one is not null then
        total := total + one * i.count;
        weight := weight + i.count;
      end if;
    end loop;
  end if;

  for i in select * from recipe_input where recipe = p_recipe order by ord loop
    if not consume(p_world, p_uid, i.item, i.count, prefer, mat) then return; end if;
  end loop;

  if r.ql_from_inputs then
    made_ql := greatest(1, least(100, (case when weight > 0 then total / weight else 1 end) * (0.78 + s / 460)));
  else
    made_ql := product_ql(s, tq);
  end if;
  rare := rarity_roll();
  perform give(p_world, p_uid, r.result, r.count, made_ql, coalesce(r.extra, mat), rare);
  -- Into the ledger, which is the only memory this island has of what you have
  -- made. It says so when it is your first of a kind or your best.
  perform journal_made(p_world, p_uid, r.result, made_ql, r.count, rare);
  if rare is not null then
    perform journal_note(p_world, p_uid, rare);
    perform tell(p_world, p_uid, rarity_word(rare), 'skill');
  end if;
  for i in select g.item, g.count from recipe_gives g where g.recipe = p_recipe and g.kind = 'return' loop
    perform give(p_world, p_uid, i.item, i.count, 20);
  end loop;

  gained := skill_raise(p_world, p_uid, r.skill, 1);
  -- Working a thing out with your hands is what sharpens the head.
  perform skill_raise(p_world, p_uid, 'mind_logic', 0.25);
  perform tell(p_world, p_uid, r.done || ' (' || case when mat is not null then lower(mat) || ', ' else '' end
    || 'QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
  perform skill_said(p_world, p_uid, r.skill, gained);
end $function$;

CREATE OR REPLACE FUNCTION public.perform_farm(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
-- `yld`, not `y`: the crop table has a column called y, and a plpgsql variable
-- of that name shadows it inside every query in the function — which Postgres
-- reports as "column reference y is ambiguous" from a line that does not
-- mention the variable at all.
declare d action_def; tx int; ty int; c crop; cd crop_def; it item; yld int[];
        s double precision; made_ql double precision; gained double precision; got int;
begin
  select * into d from action_def where id = p_action;
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  s := skill_of(p_world, p_uid, 'farming');
  perform crop_settle(p_world, tx, ty);
  select * into c from crop cr where cr.world_id = p_world and cr.x = tx and cr.y = ty;
  if c.id is not null then select * into cd from crop_def where id = c.id; end if;

  if p_action = 'till' then
    perform land_set_tile(p_world, tx, ty, tile_id('Field'));
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You rake the ground into a field, ready for sowing.', 'event');

  elsif p_action = 'plant_seed' then
    select * into it from item where id = nullif(p_target->>'uid', '')::bigint;
    select * into cd from crop_def where seed = it.def;
    if not consume(p_world, p_uid, it.def, 1, it.id) then return; end if;
    insert into crop (world_id, x, y, id, ql, sown_by) values (p_world, tx, ty, cd.id, it.ql, p_uid)
      on conflict (world_id, x, y) do update set id = cd.id, stage = 0, stage_at = now(),
        tended = 0, tended_now = false, ql = it.ql, sown_by = p_uid;
    perform tell(p_world, p_uid, 'You sow ' || lower(cd.name)
      || '. It should be sprouting in a couple of minutes.', 'event');
    perform land_announce(p_world, tx, ty);

  elsif p_action = 'tend_crop' then
    made_ql := product_ql(s, 0);
    update crop cr set tended_now = true, tended = c.tended + 1,
      -- Quality follows the farmer, averaged over the care the field was given.
      ql = (c.ql * (c.tended + 1) + made_ql) / (c.tended + 2)
      where cr.world_id = p_world and cr.x = tx and cr.y = ty;
    yld := crop_yield(c.tended + 1);
    perform tell(p_world, p_uid, 'You weed and water the ' || lower(cd.name) || '. It should give '
      || yld[2] || ' ' || lower((select coalesce(name, cd.produce) from item_def where id = cd.produce))
      || ' and ' || yld[1] || ' seed' || case when yld[1] > 1 then 's' else '' end || '.', 'event');
    gained := skill_raise(p_world, p_uid, 'farming', 1);

  elsif p_action = 'harvest_crop' then
    yld := crop_yield(c.tended);
    -- The field's own quality, lifted by the farmer's skill at harvest.
    made_ql := greatest(1, least(100, (c.ql + product_ql(s, 0)) / 2));
    -- The gardener's path takes a third more out of the same ground.
    got := greatest(1, round(yld[2] * case when walks(p_world, p_uid, 'love', 5) then 1.34 else 1 end));
    perform give(p_world, p_uid, cd.produce, got, made_ql);
    perform give(p_world, p_uid, cd.seed, yld[1], made_ql);
    delete from crop cr where cr.world_id = p_world and cr.x = tx and cr.y = ty;
    perform tell(p_world, p_uid, 'You harvest ' || got || ' × '
      || lower((select coalesce(name, cd.produce) from item_def where id = cd.produce))
      || ' and ' || yld[1] || ' ' || lower((select coalesce(name, cd.seed) from item_def where id = cd.seed))
      || '. The field is ready to sow again. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    gained := skill_raise(p_world, p_uid, 'farming', 1);
    perform land_announce(p_world, tx, ty);

  elsif p_action = 'clear_field' then
    delete from crop cr where cr.world_id = p_world and cr.x = tx and cr.y = ty;
    perform land_set_tile(p_world, tx, ty, tile_id('Dirt'));
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, case when c.id is not null
      then 'You turn the ' || lower(cd.name) || ' back into the soil.'
      else 'You break the field back up into plain dirt.' end, 'event');
  end if;

  perform skill_said(p_world, p_uid, 'farming', gained);
end $function$;

CREATE OR REPLACE FUNCTION public.perform_fish(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; spot record; skill double precision; rod_ql double precision;
        bait text; got text; made_ql double precision; tool_id bigint; gained double precision;
        haul int; i int; parts text[] := '{}'; one text; counted jsonb := '{}'::jsonb; k text;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  skill := skill_of(p_world, p_uid, 'fishing');

  if p_action = 'fish' then
    select * into spot from cast_at(p_world, p_uid, tx, ty, cast_range());
    if spot.depth is null then return; end if;
    rod_ql := tool_ql(p_world, p_uid, 'fishing_rod');
    select it.id into tool_id from item it
      where it.world_id = p_world and it.holder = 'player' and it.holder_uid = p_uid and it.def = 'fishing_rod'
      order by tool_worth(it.ql, it.dmg, it.extra, it.rare, it.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id, 0.5); end if;
    gained := skill_raise(p_world, p_uid, 'fishing', 0.4);

    -- Something goes on the hook if anything worth using is in the pack.
    bait := bait_for(p_world, p_uid, spot.depth, skill);
    if bait is not null and not consume(p_world, p_uid, bait, 1) then return; end if;

    got := catch_fish(spot.depth, skill, rod_ql, bait);
    if got is null then
      perform tell(p_world, p_uid, case when bait is null then 'Something takes it and comes off again.'
        else 'Something takes the ' || lower((select coalesce(name, bait) from item_def where id = bait))
             || ' and comes off again.' end, 'event');
    else
      made_ql := product_ql(skill, rod_ql);
      perform give(p_world, p_uid, got, 1, made_ql);
      perform journal_note(p_world, p_uid, 'fish:' || got);
      if bait is not null then perform journal_note(p_world, p_uid, 'baited'); end if;
      perform tell(p_world, p_uid, 'You land '
        || case when lower((select name from fish_def where id = got)) ~ '^[aeiou]' then 'an ' else 'a ' end
        || lower((select name from fish_def where id = got))
        || case when bait is null then '' else ' on the '
             || lower((select coalesce(name, bait) from item_def where id = bait)) end
        || '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    end if;

  elsif p_action = 'drag_net' then
    select * into spot from cast_at(p_world, p_uid, tx, ty, net_range());
    if spot.depth is null then return; end if;
    rod_ql := tool_ql(p_world, p_uid, 'fishing_net');
    select it.id into tool_id from item it
      where it.world_id = p_world and it.holder = 'player' and it.holder_uid = p_uid and it.def = 'fishing_net'
      order by tool_worth(it.ql, it.dmg, it.extra, it.rare, it.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id, 1.4); end if;
    gained := skill_raise(p_world, p_uid, 'fishing', 0.55);

    if not exists (select 1 from fish_here(spot.depth, skill)) then
      perform tell(p_world, p_uid, 'The net comes up with nothing in it but weed.', 'event');
      return;
    end if;
    -- A net takes numbers, not size: the big fish go round it or through it.
    haul := 1 + floor(random() * (1 + 4 * (0.3 + least(100, rod_ql) / 160)))::int;
    for i in 1..haul loop
      one := pick_fish(spot.depth, skill, null, random());
      -- Anything that lives deeper than a net reaches mostly avoids it.
      if one is not null and ((select depth from fish_def where id = one) <= 8 or random() < 0.12) then
        counted := jsonb_set(counted, array[one], to_jsonb(coalesce((counted->>one)::int, 0) + 1));
      end if;
    end loop;
    if counted = '{}'::jsonb then
      perform tell(p_world, p_uid, 'The net comes up empty.', 'event');
      return;
    end if;
    made_ql := product_ql(skill, rod_ql);
    perform journal_note(p_world, p_uid, 'netted');
    for k in select jsonb_object_keys(counted) loop
      perform give(p_world, p_uid, k, (counted->>k)::int, made_ql);
      perform journal_note(p_world, p_uid, 'fish:' || k, (counted->>k)::int);
      parts := parts || ((counted->>k) || ' × ' || lower((select coalesce(name, k) from item_def where id = k)));
    end loop;
    perform tell(p_world, p_uid, 'You walk the net round and haul it in: '
      || array_to_string(parts, ', ') || '.', 'event');
  end if;

  perform skill_said(p_world, p_uid, 'fishing', gained);
end $function$;

CREATE OR REPLACE FUNCTION public.perform_gather(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare d action_def; tx int; ty int; here int; data int; t tile_def; tool_id bigint;
        s double precision; tq double precision; made_ql double precision;
        species int; logs int; tree tree_def; gained double precision;
        passes int; i int; found text[] := '{}'; got text; yields text;
begin
  select * into d from action_def where id = p_action;
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  here := land_tile(p_world, tx, ty);
  data := land_data(p_world, tx, ty);
  select * into t from tile_def where id = here;
  s := case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end;
  if d.tool is not null then
    select it.id into tool_id from item it
      where it.world_id = p_world and it.holder = 'player' and it.holder_uid = p_uid and it.def = d.tool
      order by tool_worth(it.ql, it.dmg, it.extra, it.rare, it.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id); end if;
  end if;

  if p_action = 'cut_down' then
    if not skill_check(s, d.difficulty, tq) then
      perform tell(p_world, p_uid, 'Your hatchet glances off and you fail to make headway.', 'event');
      return;
    end if;
    if here = tile_id('Bush') then
      perform land_set_tile(p_world, tx, ty, tile_id('Grass'));
      perform land_set_data(p_world, tx, ty, 0);
      perform land_announce(p_world, tx, ty);
      perform tell(p_world, p_uid, 'You hack the bush down.', 'event');
    else
      species := tree_species(data);
      select * into tree from tree_def where id = species;
      -- An old tree is worth one log more than a grown one.
      logs := tree.logs + case when tree_age(data) = 2 then 1 else 0 end;
      perform land_set_tile(p_world, tx, ty, tile_id('Grass'));
      perform land_set_data(p_world, tx, ty, 0);
      perform land_announce(p_world, tx, ty);
      made_ql := product_ql(s, tq);
      perform give(p_world, p_uid, 'log', logs, made_ql, tree.name);
      perform journal_note(p_world, p_uid, 'tree');
      perform tell(p_world, p_uid, 'The ' || lower(tree.name) || ' tree falls. You get ' || logs
        || case when logs = 1 then ' log' else ' logs' end || '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    end if;
    gained := skill_raise(p_world, p_uid, 'woodcutting', 1);

  elsif p_action in ('forage', 'botanize') then
    perform mark_foraged(p_world, tx, ty, p_action);
    -- A practised eye goes over the same ground more than once.
    passes := rolls_at(s);
    for i in 1..passes loop
      if random() < 0.2 or not skill_check(s, 5, 0) then continue; end if;
      got := roll_table(p_action, random());
      made_ql := product_ql(s, 0);
      perform give(p_world, p_uid, got, 1, made_ql);
      found := found || (lower((select coalesce(name, got) from item_def where id = got))
        || ' (QL ' || to_char(made_ql, 'FM990.0') || ')');
    end loop;
    if array_length(found, 1) is null then
      perform tell(p_world, p_uid, case when passes > 1
        then 'You go over the ground ' || passes || ' times and find nothing'
             || case when p_action = 'forage' then ' edible.' else ' of interest.' end
        else case when p_action = 'forage' then 'You find nothing edible.' else 'You find nothing of interest.' end
        end, 'event');
    else
      perform tell(p_world, p_uid, 'You find some ' || list_of(found) || '.', 'event');
    end if;
    gained := skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'collect' then
    yields := t.dig_yield;
    if yields is null then return; end if;
    if not skill_check(s, d.difficulty, tq) then
      perform tell(p_world, p_uid, 'Your shovel comes up with nothing but a smear of '
        || lower(t.name) || '.', 'event');
      return;
    end if;
    made_ql := product_ql(s, tq);
    perform give(p_world, p_uid, yields, 1, made_ql);
    perform tell(p_world, p_uid, 'You fill a shovel with '
      || lower((select coalesce(name, yields) from item_def where id = yields))
      || ' off the top of the bed. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    gained := skill_raise(p_world, p_uid, 'digging', 1);
  end if;

  perform skill_said(p_world, p_uid, d.skill, gained);
end $function$;

CREATE OR REPLACE FUNCTION public.perform_ground(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; cx int; cy int; here int; t tile_def; v_data int; v_tree tree_def;
        v_skill double precision; v_tool double precision; v_ql double precision; v_n int;
        v_gained double precision; v_slab item; v_kind int; v_target int; v_hi record; v_lo record;
        v_rock rock_def; v_rad int; v_tiles int[] := '{}'; v_names text[] := '{}'; v_row record;
        v_id bigint; v_species int; v_sprout item; v_buried text; v_size int;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  here := land_tile(p_world, tx, ty);
  select * into t from tile_def where id = here;
  v_data := land_data(p_world, tx, ty);

  if p_action = 'flatten' then
    v_target := flatten_target(p_world, p_uid, tx, ty);
    -- The corners furthest above and below the height we are working towards.
    select c.cx, c.cy into v_hi from tile_corners(tx, ty) c
      where land_height(p_world, c.cx, c.cy) > v_target
      order by land_height(p_world, c.cx, c.cy) desc limit 1;
    select c.cx, c.cy into v_lo from tile_corners(tx, ty) c
      where land_height(p_world, c.cx, c.cy) < v_target
      order by land_height(p_world, c.cx, c.cy) limit 1;
    if v_hi.cx is null and v_lo.cx is null then return; end if;
    -- Only soil can be moved with a shovel; bedrock needs a pickaxe.
    if v_hi.cx is not null and land_dirt(p_world, v_hi.cx, v_hi.cy) <= 0 then
      perform tell(p_world, p_uid, 'The high corner is bare rock. Mine it down instead.', 'error');
      return;
    end if;
    if v_hi.cx is not null and v_lo.cx is not null then
      -- One corner down and one up: the dirt simply moves across the tile.
      perform raise_corner(p_world, v_hi.cx, v_hi.cy, -1);
      perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
      perform tell(p_world, p_uid, 'You move some dirt across the tile.', 'event');
    elsif v_hi.cx is not null then
      perform raise_corner(p_world, v_hi.cx, v_hi.cy, -1);
      perform give(p_world, p_uid, 'dirt', 1,
        product_ql(skill_of(p_world, p_uid, 'digging'), tool_ql(p_world, p_uid, 'shovel')));
      perform tell(p_world, p_uid, 'You scrape the ground down and pocket the dirt.', 'event');
    else
      if not consume(p_world, p_uid, 'dirt', 1) then
        perform tell(p_world, p_uid, 'You need dirt to bring this ground up to your level.', 'error');
        return;
      end if;
      perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
      perform tell(p_world, p_uid, 'You pack dirt in to bring the ground up.', 'event');
    end if;
    if t.turns_to_dirt then perform land_set_tile(p_world, tx, ty, 1); end if;
    perform land_announce(p_world, tx, ty);
    if not needs_flattening(p_world, p_uid, tx, ty) then
      perform tell(p_world, p_uid,
        case when floor((select x from player where world_id = p_world and uid = p_uid))::int = tx
              and floor((select y from player where world_id = p_world and uid = p_uid))::int = ty
             then 'The tile is now flat at its lowest corner.'
             else 'The tile is now flat and level with the ground you stand on.' end, 'event');
    end if;

  elsif p_action = 'drop_dirt' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    if not consume(p_world, p_uid, 'dirt', 1) then return; end if;
    perform raise_corner(p_world, cx, cy, 1);
    if here in (0, 20) then perform land_set_tile(p_world, tx, ty, 1); end if;
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You drop the dirt on the ' || corner_name(tx, ty, cx, cy)
      || ' corner, raising the ground.', 'event');

  elsif p_action = 'pave_slabs' then
    select i.* into v_slab from item i join slab_def s on s.item = i.def
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and not i.locked
      order by (i.id = nullif(p_target->>'uid', '')::bigint) desc, i.id limit 1;
    if not found then return; end if;
    select id into v_kind from slab_def where item = v_slab.def;
    if not skill_check(skill_of(p_world, p_uid, 'paving'), 10, v_slab.ql) then
      perform tell(p_world, p_uid,
        'The slab rocks on its bed however you set it. You leave it for now.', 'event');
      return;
    end if;
    if not consume(p_world, p_uid, v_slab.def, 1, v_slab.id) then return; end if;
    perform land_set_tile(p_world, tx, ty, 21);
    perform land_set_data(p_world, tx, ty, v_kind);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You bed the '
      || lower((select name from item_def where id = v_slab.def)) || ' down flat and true.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'remove_paving' then
    -- A slab comes up whole more often than not; gravel and cobbles do not.
    v_kind := case when here = 21 then v_data & 3 else null end;
    perform land_set_tile(p_world, tx, ty, 1);
    perform land_announce(p_world, tx, ty);
    if v_kind is not null and random() < 0.6 then
      v_ql := product_ql(skill_of(p_world, p_uid, 'paving'));
      perform give(p_world, p_uid, (select item from slab_def where id = v_kind), 1, v_ql);
      perform tell(p_world, p_uid, 'You lever the '
        || regexp_replace(lower((select name from slab_def where id = v_kind)), 's$', '')
        || ' up whole. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
    else
      perform tell(p_world, p_uid, 'You break up the paving, leaving bare dirt.', 'event');
    end if;
    v_gained := skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'cut_grass' then
    perform mark_foraged(p_world, tx, ty, 'grass');
    perform give(p_world, p_uid, 'mixed_grass', 2, product_ql(skill_of(p_world, p_uid, 'foraging')));
    perform tell(p_world, p_uid, 'You cut two bundles of mixed grass.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'foraging', 1);

  elsif p_action = 'cut_reeds' then
    perform mark_foraged(p_world, tx, ty, 'reed');
    v_skill := skill_of(p_world, p_uid, 'foraging');
    v_n := 2 + case when random() < v_skill / 140 then 1 else 0 end;
    perform give(p_world, p_uid, 'reed', v_n,
      product_ql(v_skill, tool_ql(p_world, p_uid, 'carving_knife')));
    perform tell(p_world, p_uid, 'You cut ' || v_n || ' reeds out of the bed.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'foraging', 1);

  elsif p_action = 'pick_fruit' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    -- An old tree carries more than one only just come into bearing.
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_n := greatest(1, round(case when tree_age(v_data) = 2 then 5 else 3 end
                             * (0.5 + v_skill / 130) * (0.7 + random() * 0.6))::int);
    v_ql := product_ql(v_skill);
    perform give(p_world, p_uid, v_tree.fruit, v_n, v_ql);
    perform mark_foraged(p_world, tx, ty, 'forage');
    v_gained := skill_raise(p_world, p_uid, 'forestry', 0.35);
    perform tell(p_world, p_uid, 'You pick ' || v_n || ' '
      || lower((select name from item_def where id = v_tree.fruit))
      || case when v_n = 1 then '' else 's' end
      || ' off the ' || lower(v_tree.name) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'pick_sprout' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    if not skill_check(skill_of(p_world, p_uid, 'forestry'), 15) then
      perform tell(p_world, p_uid, 'You find no sprout worth picking.', 'event');
      return;
    end if;
    perform give(p_world, p_uid, 'sprout', 1,
      product_ql(skill_of(p_world, p_uid, 'forestry')), v_tree.name);
    perform tell(p_world, p_uid, 'You pick a ' || lower(v_tree.name) || ' sprout.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'plant' then
    select * into v_sprout from item where world_id = p_world and holder = 'player'
      and holder_uid = p_uid and def = 'sprout' and not locked order by id limit 1;
    if not found then return; end if;
    v_species := coalesce((select id from tree_def where name = v_sprout.extra), 0);
    if not consume(p_world, p_uid, 'sprout', 1, v_sprout.id) then return; end if;
    perform land_set_tile(p_world, tx, ty, 16);
    -- Species in the low nibble, age in the two bits above it: a planted tree
    -- starts as a sapling and grows on the same clock as one that seeded itself.
    perform land_set_data(p_world, tx, ty, v_species & 15);
    perform land_announce(p_world, tx, ty);
    perform journal_note(p_world, p_uid, 'planted');
    if (select fruit from tree_def where id = v_species) is not null then
      perform journal_note(p_world, p_uid, 'orchard');
    end if;
    perform tell(p_world, p_uid, 'You plant the '
      || lower((select name from tree_def where id = v_species)) || ' sprout.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'dig_worms' then
    v_gained := skill_raise(p_world, p_uid, 'digging', 0.2);
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'shovel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id, 0.4); end if;
    -- Damp ground gives more than dry: a marsh is full of them.
    v_n := floor(random() * case when t.rich_worms then 5 else 3 end)::int
           + case when t.rich_worms then 1 else 0 end;
    if v_n = 0 then
      perform tell(p_world, p_uid, 'You turn a spadeful over and nothing is moving in it.', 'event');
      return;
    end if;
    perform give(p_world, p_uid, 'worm', v_n, 20 + random() * 40);
    perform journal_note(p_world, p_uid, 'worms');
    perform tell(p_world, p_uid, 'You turn the dirt over and pick ' || v_n || ' worm'
      || case when v_n > 1 then 's' else '' end || ' out of it.', 'event');

  elsif p_action = 'prospect' then
    v_skill := skill_of(p_world, p_uid, 'prospecting');
    v_rad := prospect_radius(v_skill);
    v_size := (select size from world where id = p_world);
    -- Metal counts wherever it lies: bare, under soil, or below water.
    for v_row in select x, y, (bedrock_at(p_world, x, y)).name as nm
      from generate_series(greatest(0, tx - v_rad), least(v_size - 1, tx + v_rad)) x
      cross join generate_series(greatest(0, ty - v_rad), least(v_size - 1, ty + v_rad)) y
      where (bedrock_at(p_world, x, y)).ore
      order by y, x
    loop
      v_tiles := v_tiles || (v_row.y * v_size + v_row.x);
      v_names := v_names || lower(v_row.nm);
    end loop;
    perform mark_prospected(p_world, p_uid, v_tiles);

    -- Sampling where you stand tells you what that particular rock holds.
    v_rock := bedrock_at(p_world, tx, ty);
    v_ql := ore_max_ql((select seed from world where id = p_world), tx, ty);
    v_buried := case when here = 4 then ''
      else ' It lies under ' || greatest(1, land_dirt(p_world, tx, ty)) || ' of ground.' end;
    if v_rock.ore then
      perform tell(p_world, p_uid, 'You sample the ' || lower(v_rock.name)
        || '. It needs mining ' || to_char(v_rock.level, 'FM990')
        || ' to work' || case when skill_of(p_world, p_uid, 'mining') >= v_rock.level
                              then ', which you have' else '' end
        || ', and will give up nothing finer than quality ' || to_char(v_ql, 'FM990')
        || '.' || v_buried, 'event');
    else
      perform tell(p_world, p_uid, 'Plain ' || lower(v_rock.name)
        || ' beneath you, with no metal in it, and nothing finer than quality '
        || to_char(v_ql, 'FM990') || ' in the stone.' || v_buried, 'event');
    end if;

    if coalesce(array_length(v_tiles, 1), 0) = 0 then
      perform tell(p_world, p_uid, 'You read the ground ' || v_rad
        || ' tiles about you and find no sign of metal.', 'event');
    else
      perform tell(p_world, p_uid, 'Within ' || v_rad || ' tiles you read '
        || (select string_agg(case when n > 1 then n || ' tiles of ' || nm
                                   else 'a tile of ' || nm end, ' and ' order by nm)
            from (select nm, count(*) as n from unnest(v_names) nm group by nm) q)
        || ', buried or bare. They are marked for a while.', 'event');
    end if;
    v_gained := skill_raise(p_world, p_uid, 'prospecting', 1);
  end if;

  perform skill_said(p_world, p_uid,
    (select skill from action_def where id = p_action), v_gained);
end $function$;

CREATE OR REPLACE FUNCTION public.perform_terrain(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare d action_def; cx int; cy int; tx int; ty int; t tile_def; r rock_def;
        s double precision; tq double precision; yields text; made_ql double precision;
        gained double precision; tool_id bigint; here int;
begin
  select * into d from action_def where id = p_action;
  cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
  tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
  s := case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end;
  if d.tool is not null then
    select i.id into tool_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = d.tool
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id); end if;
  end if;

  if p_action = 'mine' then
    if not skill_check(s, d.difficulty, tq) then
      perform tell(p_world, p_uid, 'The rock is hard and you fail to loosen anything.', 'event');
      return;
    end if;
    r := bedrock_at(p_world, tx, ty);
    yields := case when land_tile(p_world, tx, ty) = 4 then r.yields else 'rock_shards' end;
    -- The first ore out of the ground is a thing worth remembering.
    if yields like '%\_ore' then perform journal_note(p_world, p_uid, 'ore'); end if;
    made_ql := least(ore_max_ql((select seed from world where id = p_world), tx, ty), product_ql(s, tq));
    perform give(p_world, p_uid, yields, 1, made_ql);
    perform tell(p_world, p_uid,
      case when yields like '%lump' then 'You chip a ' else 'You mine some ' end
      || lower((select coalesce(name, yields) from item_def where id = yields))
      || case when yields like '%lump' then ' out of the vein.' else '.' end
      || ' (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    -- Cutting the face back is its own job. Now and again one comes down anyway.
    if random() < 0.01 then
      perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
      perform land_set_dirt(p_world, cx, cy, 0);
      perform reconcile_around(p_world, cx, cy);
      perform tell(p_world, p_uid, 'A slab breaks away of its own accord and the face drops.', 'event');
    end if;
    gained := skill_raise(p_world, p_uid, 'mining', 1);

  elsif p_action = 'chip_corner' then
    if random() >= 0.25 then
      perform tell(p_world, p_uid, 'You work at the corner and find no line in it. The face holds.', 'event');
      return;
    end if;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
    perform land_set_dirt(p_world, cx, cy, 0);
    perform reconcile_around(p_world, cx, cy);
    r := bedrock_at(p_world, tx, ty);
    yields := case when land_tile(p_world, tx, ty) = 4 then r.yields else 'rock_shards' end;
    -- The first ore out of the ground is a thing worth remembering.
    if yields like '%\_ore' then perform journal_note(p_world, p_uid, 'ore'); end if;
    made_ql := least(ore_max_ql((select seed from world where id = p_world), tx, ty), product_ql(s, tq));
    perform give(p_world, p_uid, yields, 1, made_ql);
    perform tell(p_world, p_uid, 'The corner breaks away and drops a step. You gather the '
      || lower((select coalesce(name, yields) from item_def where id = yields))
      || '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    gained := skill_raise(p_world, p_uid, 'mining', 1);

  elsif p_action = 'pack' then
    here := land_tile(p_world, tx, ty);
    perform land_set_tile(p_world, tx, ty, 2);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, case when here <> 1
      then 'You cut the turf away and tread the ground down firm.'
      else 'You pack the dirt down firmly.' end, 'event');
    gained := skill_raise(p_world, p_uid, 'digging', 1);

  elsif p_action = 'cultivate' then
    perform land_set_tile(p_world, tx, ty, 1);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You break up the packed earth.', 'event');
    gained := skill_raise(p_world, p_uid, 'digging', 1);

  elsif p_action = 'pave_gravel' then
    if not consume(p_world, p_uid, 'rock_shards', 1) then return; end if;
    perform land_set_tile(p_world, tx, ty, 13);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You spread the crushed rock into a gravel surface.', 'event');
    gained := skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'pave_cobble' then
    if not consume(p_world, p_uid, 'stone_brick', 1) then return; end if;
    perform land_set_tile(p_world, tx, ty, 14);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You lay the cobblestones.', 'event');
    gained := skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'drop_dirt_here' then
    if not consume(p_world, p_uid, 'dirt', 1) then return; end if;
    select round(x)::int, round(y)::int into cx, cy from player where world_id = p_world and uid = p_uid;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) + 1);
    perform land_set_dirt(p_world, cx, cy, land_dirt(p_world, cx, cy) + 1);
    perform reconcile_around(p_world, cx, cy);
    perform tell(p_world, p_uid, 'You drop the dirt at your feet, raising the ground.', 'event');
    gained := skill_raise(p_world, p_uid, 'digging', 1);
  end if;

  perform skill_said(p_world, p_uid, d.skill, gained);
end $function$;

CREATE OR REPLACE FUNCTION public.skill_told(p_world uuid, p_uid uuid, p_id text, p_base double precision)
 RETURNS double precision
 LANGUAGE plpgsql
AS $function$
declare gained double precision;
begin
  gained := skill_raise(p_world, p_uid, p_id, p_base);
  perform skill_said(p_world, p_uid, p_id, gained);
  return gained;
end $function$;
