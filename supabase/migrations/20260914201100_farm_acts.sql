-- Tilling, sowing, tending, harvesting and turning a field back into dirt.

create or replace function act_ported(p_action text) returns boolean language sql stable as $$
  select p_action in (
      'dig', 'mine', 'chip_corner', 'pack', 'cultivate',
      'pave_gravel', 'pave_cobble', 'drop_dirt_here',
      'cut_down', 'forage', 'botanize', 'collect',
      'till', 'plant_seed', 'tend_crop', 'harvest_crop', 'clear_field',
      'build_campfire', 'light_campfire', 'put_out_campfire', 'fuel_campfire',
      'take_ashes_fire', 'take_apart_campfire',
      'place_smelter', 'pick_up_smelter', 'light_smelter', 'fuel_smelter',
      'damp_smelter', 'take_ashes_smelter',
      'place_furniture', 'pick_up_furniture')
      or exists (select 1 from recipe where id = p_action)
$$;

/** Ground a field can be raked out of. */
create or replace function tillable(p_tile int) returns boolean language sql stable as $$
  select p_tile in (tile_id('Grass'), tile_id('Dirt'), tile_id('Lawn'),
                    tile_id('Steppe'), tile_id('Tundra'), tile_id('Moss'))
$$;

create or replace function farm_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql as $$
declare tx int; ty int; here int; c crop; it item;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  here := land_tile(p_world, tx, ty);
  -- Anything that reads a crop reads it up to date.
  perform crop_settle(p_world, tx, ty);
  select * into c from crop cr where cr.world_id = p_world and cr.x = tx and cr.y = ty;

  if p_action = 'till' then
    if not tillable(here) then return 'That ground will not rake into a field.'; end if;
    if land_height(p_world, tx, ty) < 0 or land_height(p_world, tx + 1, ty) < 0
       or land_height(p_world, tx + 1, ty + 1) < 0 or land_height(p_world, tx, ty + 1) < 0 then
      return 'You cannot till underwater.';
    end if;
    if tile_slope(p_world, tx, ty) > 20 then return 'The ground is too steep to work.'; end if;
  elsif p_action = 'plant_seed' then
    if here <> tile_id('Field') then return 'Sow on a tilled field.'; end if;
    if c.id is not null then return 'Something is already growing there.'; end if;
    select * into it from item
      where id = nullif(p_target->>'uid', '')::bigint and world_id = p_world
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
  end if;
  return null;
end $$;

create or replace function perform_farm(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns void language plpgsql as $$
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
    got := greatest(1, yld[2]);
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

  if gained > 0 then
    perform tell(p_world, p_uid, 'Farming increased by ' || to_char(gained, 'FM0.0000')
      || ' to ' || to_char(skill_of(p_world, p_uid, 'farming'), 'FM990.0000') || '.', 'skill');
  end if;
end $$;

select private.lock_doors();
