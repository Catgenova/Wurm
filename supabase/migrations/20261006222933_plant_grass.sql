-- Plant grass: mixed grass pressed into a tile of dirt turns it to grass, as
-- moss is planted. A player found no way to plant grass, and dirt never grows
-- grass back of itself. `grass_plant()` comes with the definitions just before
-- this; here the farm door routes the job, refuses it in the browser's words
-- (actions.ts, `plant_grass`), does it, and the settlement's border speaks for
-- it as it does for planting moss.
set local lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.farm_action(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in ('till', 'plant_seed', 'tend_crop', 'harvest_crop', 'clear_field',
                      'sow_patch', 'tend_patch', 'harvest_patch', 'plant_moss', 'plant_grass')
$function$;

CREATE OR REPLACE FUNCTION public.farm_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; here int; c crop; it item; v_r int; v_why text;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  here := land_tile(p_world, tx, ty);
  -- Anything that reads a crop reads it up to date.
  perform crop_settle(p_world, tx, ty);
  select * into c from crop cr where cr.world_id = p_world and cr.x = tx and cr.y = ty;

  if p_action = 'till' then
    -- In a building, only a glasshouse's ground, where no floor is planned on it (`glass_till_refusal`).
    if building_at(p_world, tx, ty) is not null then
      v_why := glass_till_refusal(p_world, tx, ty);
      if v_why is not null then return v_why; end if;
    elsif not tillable(here) then return not_tillable_said(); end if;
    if land_height(p_world, tx, ty) < 0 or land_height(p_world, tx + 1, ty) < 0
       or land_height(p_world, tx + 1, ty + 1) < 0 or land_height(p_world, tx, ty + 1) < 0 then
      return 'You cannot till underwater.';
    end if;
    if tile_slope(p_world, tx, ty) > 20 then return 'The ground is too steep to work.'; end if;
  elsif p_action = 'plant_moss' then
    -- In the browser's words and order (actions.ts, `plant_moss`).
    if here <> tile_id('Dirt') then return 'Moss is planted on a tile of dirt.'; end if;
    if has_water(p_world, tx, ty) then return 'You cannot plant moss underwater.'; end if;
    if pack_count(p_world, p_uid, 'moss') < moss_plant() then
      return 'It takes ' || moss_plant() || ' moss to plant a tile; you have ' || pack_count(p_world, p_uid, 'moss') || '.';
    end if;
    -- Piers: nor under a building, which a tile on piers is (`underBuilding`).
    if under_building(p_world, tx, ty) is not null then return under_building(p_world, tx, ty); end if;
  elsif p_action = 'plant_grass' then
    -- In the browser's words and order (actions.ts, `plant_grass`), as moss is planted.
    if here <> tile_id('Dirt') then return 'Grass is planted on a tile of dirt.'; end if;
    if has_water(p_world, tx, ty) then return 'You cannot plant grass underwater.'; end if;
    if pack_count(p_world, p_uid, 'mixed_grass') < grass_plant() then
      return 'It takes ' || grass_plant() || ' mixed grass to plant a tile; you have ' || pack_count(p_world, p_uid, 'mixed_grass') || '.';
    end if;
    if under_building(p_world, tx, ty) is not null then return under_building(p_world, tx, ty); end if;
  elsif p_action = 'plant_seed' then
    if here <> tile_id('Field') then return 'Sow on a tilled field.'; end if;
    if c.id is not null then return 'Something is already growing there.'; end if;
    select * into it from item
      where id = target_item(p_target) and world_id = p_world
        and holder = 'player' and holder_uid = p_uid;
    if not found or not exists (select 1 from crop_def where seed = it.def) then
      return 'Choose a seed to sow.';
    end if;
  elsif p_action = 'tend_crop' then
    if c.id is null then return 'Nothing is growing there.'; end if;
    if c.stage >= crop_ripe() then return 'It is ripe. Harvest it.'; end if;
    if c.tended_now then return 'You have already tended it at this stage. Wait for it to grow on.'; end if;
  elsif p_action = 'harvest_crop' then
    if c.id is null then return 'Nothing is growing there.'; end if;
    if c.stage < crop_ripe() then
      return 'It is only ' || crop_stage_name(c.stage) || '. Let it grow.';
    end if;
  elsif p_action = 'clear_field' then
    if here <> tile_id('Field') then return 'There is no field there.'; end if;
  elsif p_action = 'sow_patch' then
    if pk(p_world, p_uid, 'sow_patch', 0) <= 0 then return 'That wants a Farmer who has learned to sow a patch.'; end if;
    select * into it from item
      where id = target_item(p_target) and world_id = p_world
        and holder = 'player' and holder_uid = p_uid;
    if not found or not exists (select 1 from crop_def where seed = it.def) then
      return 'Choose a seed to sow.';
    end if;
    v_r := floor(pk(p_world, p_uid, 'sow_patch', 0))::int;
    if not exists (select 1 from generate_series(ty - v_r, ty + v_r) gy, generate_series(tx - v_r, tx + v_r) gx
                    where case when in_bounds(p_world, gx, gy) then land_tile(p_world, gx, gy) = tile_id('Field') else false end
                      and not exists (select 1 from crop cr where cr.world_id = p_world and cr.x = gx and cr.y = gy)) then
      return 'There is no empty field in the patch to sow.';
    end if;
  elsif p_action = 'tend_patch' then
    if pk(p_world, p_uid, 'tend_patch', 0) <= 0 then return 'That wants a Farmer who has learned to tend a patch.'; end if;
    v_r := floor(pk(p_world, p_uid, 'tend_patch', 0))::int;
    perform crops_settle(p_world, tx + 0.5, ty + 0.5, v_r);
    if not exists (select 1 from crop cr
                    where cr.world_id = p_world and cr.x between tx - v_r and tx + v_r and cr.y between ty - v_r and ty + v_r
                      and cr.stage < crop_ripe() and not cr.tended_now) then
      return 'Nothing in the patch wants tending.';
    end if;
  elsif p_action = 'harvest_patch' then
    if pk(p_world, p_uid, 'harvest_patch', 0) <= 0 then return 'That wants a Farmer who has learned to harvest a patch.'; end if;
    v_r := floor(pk(p_world, p_uid, 'harvest_patch', 0))::int;
    perform crops_settle(p_world, tx + 0.5, ty + 0.5, v_r);
    if not exists (select 1 from crop cr
                    where cr.world_id = p_world and cr.x between tx - v_r and tx + v_r and cr.y between ty - v_r and ty + v_r
                      and cr.stage >= crop_ripe()) then
      return 'Nothing in the patch is ripe.';
    end if;
  end if;
  return null;
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
        s double precision; made_ql double precision; got int;
        v_how text; v_r int; v_n int; v_kept int; v_row record; r record; v_ix int;
        v_ids text[] := '{}'; v_counts int[] := '{}'; v_rares text[] := '{}'; v_rare text; v_packed boolean;
begin
  -- A planter is sown, tended, harvested and pulled up by the same four jobs, aimed at the piece.
  if p_target->>'kind' = 'furniture' then
    perform perform_planter(p_world, p_uid, p_action, p_target);
    return;
  end if;
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

  elsif p_action = 'plant_moss' then
    -- `moss_plant` moss pressed into bare dirt turns the tile to moss.
    if land_tile(p_world, tx, ty) <> tile_id('Dirt') or pack_count(p_world, p_uid, 'moss') < moss_plant() then return; end if;
    if not consume(p_world, p_uid, 'moss', moss_plant()) then return; end if;
    perform land_set_tile(p_world, tx, ty, tile_id('Moss'));
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You plant ' || moss_plant() || ' moss and the dirt is moss now.', 'event');

  elsif p_action = 'plant_grass' then
    -- `grass_plant` mixed grass pressed into bare dirt turns the tile to grass, uncut and unpicked.
    if land_tile(p_world, tx, ty) <> tile_id('Dirt') or pack_count(p_world, p_uid, 'mixed_grass') < grass_plant() then return; end if;
    if not consume(p_world, p_uid, 'mixed_grass', grass_plant()) then return; end if;
    perform land_set_tile(p_world, tx, ty, tile_id('Grass'));
    perform land_set_data(p_world, tx, ty, 0);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You plant ' || grass_plant() || ' mixed grass and the dirt is grass now.', 'event');

  elsif p_action = 'plant_seed' then
    select * into it from item where id = target_item(p_target);
    select * into cd from crop_def where seed = it.def;
    v_how := sow_one(p_world, p_uid, tx, ty, it.id);
    if v_how is null then return; end if;
    select * into c from crop cr where cr.world_id = p_world and cr.x = tx and cr.y = ty;
    -- When it will be sprouting, in real time, from the season it was sown in -- or in any, under glass: the browser's words.
    perform tell(p_world, p_uid, sown_said_on(cd.name, crop_kind(c.glass),
        crop_when_on(crop_stage_name(1), crop_per(p_world, c.id, c.pace, tx, ty), crop_kind(c.glass)))
      || case when v_how = 'kept' then ' It cost you no seed.' else '' end, 'event');

  elsif p_action = 'tend_crop' then
    perform tend_one(p_world, p_uid, tx, ty, s);
    select * into c from crop cr where cr.world_id = p_world and cr.x = tx and cr.y = ty;
    yld := crop_yield(c.tended);
    -- What it should give the one tending it, with their own Bumper Crop.
    if c.tended >= crop_ripe() then
      yld[2] := yld[2] + floor(pk(p_world, p_uid, 'bumper:harvest_crop', 0))::int;
    end if;
    perform tell(p_world, p_uid, 'You weed and water the ' || lower(cd.name) || '. It should give '
      || yld[2] || ' ' || lower((select coalesce(name, cd.produce) from item_def where id = cd.produce))
      || ' and ' || yld[1] || ' seed' || case when yld[1] > 1 then 's' else '' end || '.', 'event');
    perform skill_raise(p_world, p_uid, 'farming', 1);

  elsif p_action = 'harvest_crop' then
    select * into r from reap_one(p_world, p_uid, tx, ty, s);
    if r.o_produce is null then return; end if;
    perform tell(p_world, p_uid, 'You harvest ' || r.o_got || ' × ' || coalesce(r.o_rare || ' ', '')
      || lower((select coalesce(name, r.o_produce) from item_def where id = r.o_produce))
      || ' and ' || r.o_seeds || ' ' || lower((select coalesce(name, r.o_seed) from item_def where id = r.o_seed))
      || '. The field is ready to sow again. (QL ' || to_char(r.o_ql, 'FM990.0') || ')', 'event');
    if r.o_rare is not null then
      perform journal_note(p_world, p_uid, r.o_rare);
      perform tell(p_world, p_uid, rarity_word(r.o_rare), 'skill');
    end if;
    perform skill_raise(p_world, p_uid, 'farming', 1);

  elsif p_action = 'clear_field' then
    delete from crop cr where cr.world_id = p_world and cr.x = tx and cr.y = ty;
    -- Broken up, it is not a field any more, and has no last crop.
    delete from crop_last l where l.world_id = p_world and l.x = tx and l.y = ty;
    -- Inside a footprint, packed flat again as the rest of it is (the browser's `clearedTo`, `clearedSaid`).
    v_packed := building_at(p_world, tx, ty) is not null;
    perform land_set_tile(p_world, tx, ty, tile_id(case when v_packed then 'Packed dirt' else 'Dirt' end));
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, case when c.id is not null
      then 'You turn the ' || lower(cd.name) || ' back into the soil' || case when v_packed then ' and pack the ground flat again' else '' end || '.'
      when v_packed then field_packed_said()
      else 'You break the field back up into plain dirt.' end, 'event');

  elsif p_action = 'sow_patch' then
    -- A Farmer's Sow a Patch: the seed chosen, one to a field, on every empty
    -- field within `sow_patch` tiles of the one chosen, row by row.
    select * into it from item where id = target_item(p_target);
    select * into cd from crop_def where seed = it.def;
    v_r := floor(pk(p_world, p_uid, 'sow_patch', 0))::int;
    v_n := 0;
    v_kept := 0;
    for v_row in select gx, gy from generate_series(ty - v_r, ty + v_r) gy, generate_series(tx - v_r, tx + v_r) gx
                  order by gy, gx loop
      continue when not in_bounds(p_world, v_row.gx, v_row.gy);
      continue when land_tile(p_world, v_row.gx, v_row.gy) is distinct from tile_id('Field');
      continue when exists (select 1 from crop cr where cr.world_id = p_world and cr.x = v_row.gx and cr.y = v_row.gy);
      v_how := sow_one(p_world, p_uid, v_row.gx, v_row.gy, it.id);
      exit when v_how is null;
      v_n := v_n + 1;
      if v_how = 'kept' then v_kept := v_kept + 1; end if;
    end loop;
    if v_n = 0 then return; end if;
    perform tell(p_world, p_uid, 'You sow ' || v_n || case when v_n = 1 then ' field' else ' fields' end
      || ' with ' || lower(cd.name) || '.'
      || case when v_kept = 0 then ''
              when v_kept = v_n then case when v_n = 1 then ' It' else ' They' end || ' cost you no seed.'
              else ' ' || v_kept || ' of them cost you no seed.' end, 'event');

  elsif p_action = 'tend_patch' then
    -- A Farmer's Tend a Patch: every crop within `tend_patch` tiles that is not
    -- ripe and not tended at the stage it is at.
    v_r := floor(pk(p_world, p_uid, 'tend_patch', 0))::int;
    perform crops_settle(p_world, tx + 0.5, ty + 0.5, v_r);
    v_n := 0;
    for v_row in select cr.x, cr.y from crop cr
                  where cr.world_id = p_world and cr.x between tx - v_r and tx + v_r and cr.y between ty - v_r and ty + v_r
                    and cr.stage < crop_ripe() and not cr.tended_now
                  order by cr.y, cr.x loop
      perform tend_one(p_world, p_uid, v_row.x, v_row.y, s);
      v_n := v_n + 1;
    end loop;
    if v_n = 0 then return; end if;
    perform tell(p_world, p_uid, 'You weed and water ' || v_n || case when v_n = 1 then ' crop.' else ' crops.' end, 'event');
    perform skill_raise(p_world, p_uid, 'farming', 1);

  elsif p_action = 'harvest_patch' then
    -- A Farmer's Harvest a Patch: every ripe crop within `harvest_patch` tiles,
    -- each for what its own tending earned, and what came up said by the thing.
    v_r := floor(pk(p_world, p_uid, 'harvest_patch', 0))::int;
    perform crops_settle(p_world, tx + 0.5, ty + 0.5, v_r);
    v_n := 0;
    for v_row in select cr.x, cr.y from crop cr
                  where cr.world_id = p_world and cr.x between tx - v_r and tx + v_r and cr.y between ty - v_r and ty + v_r
                    and cr.stage >= crop_ripe()
                  order by cr.y, cr.x loop
      select * into r from reap_one(p_world, p_uid, v_row.x, v_row.y, s);
      continue when r.o_produce is null;
      v_n := v_n + 1;
      v_ix := array_position(v_ids, r.o_produce);
      if v_ix is null then v_ids := v_ids || r.o_produce; v_counts := v_counts || r.o_got;
      else v_counts[v_ix] := v_counts[v_ix] + r.o_got; end if;
      v_ix := array_position(v_ids, r.o_seed);
      if v_ix is null then v_ids := v_ids || r.o_seed; v_counts := v_counts || r.o_seeds;
      else v_counts[v_ix] := v_counts[v_ix] + r.o_seeds; end if;
      if r.o_rare is not null then v_rares := v_rares || r.o_rare; end if;
    end loop;
    if v_n = 0 then return; end if;
    perform tell(p_world, p_uid, 'You harvest ' || v_n || case when v_n = 1 then ' field: ' else ' fields: ' end
      || (select string_agg(t.n || ' × ' || lower(coalesce(dd.name, t.id)), ', ' order by t.o)
            from unnest(v_ids, v_counts) with ordinality t(id, n, o) left join item_def dd on dd.id = t.id)
      || case when v_n = 1 then '. The field is' else '. The fields are' end || ' ready to sow again.', 'event');
    foreach v_rare in array v_rares loop
      perform journal_note(p_world, p_uid, v_rare);
      perform tell(p_world, p_uid, rarity_word(v_rare), 'skill');
    end loop;
    perform skill_raise(p_world, p_uid, 'farming', 1);
  end if;

end $function$;

CREATE OR REPLACE FUNCTION public.shapes_ground(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in ('dig', 'dredge', 'flatten', 'drop_dirt', 'drop_dirt_here', 'raise_rock',
                      'mine', 'chip_corner', 'pack', 'cultivate', 'pave_cobble',
                      'pave_slabs', 'remove_paving',
                      'plan_foundation', 'pour_foundation', 'strike_foundation',
                      'dig_spring', 'stop_spring', 'dig_pool', 'fill_pool',
                      'lay_steps', 'lay_timber_steps', 'take_up_steps', 'plant_moss', 'plant_grass',
                      -- Stepping stones laid and taken up, and a water lily or a lotus planted or pulled up.
                      'lay_stones', 'lift_stones', 'plant_lily', 'plant_lotus', 'pull_water_plant')
$function$;

select private.lock_doors();
