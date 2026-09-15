-- What a path is worth, wired into the rules that were already here.
--
-- A path with a row in a table and no effect behind it is a path nobody walks.
-- These are the five whose arithmetic this island already does: what a wild
-- thing will trust, how fast a field comes on, what a harvest gives, how
-- quickly work teaches, and what a blow lands.
--
-- Three are still only a row: carrying weight (`power 1`), the reach of sight
-- (`knowledge 5`) and how much of a blow armour turns (`power 5`). None of the
-- three is computed anywhere on this island — not half-computed, not
-- approximated: absent — so there is nothing to multiply. Named here rather
-- than quietly skipped.
--
-- The field is the odd one. A crop grows for whoever founded the ground it is
-- in, not for whoever is looking at it, so `crop_settle` asks the deed's
-- founder — the one effect of a path that belongs to somebody who is not here.

create or replace function tame_chance(p_world uuid, p_uid uuid, c creature) returns double precision
  language sql stable as $$
  select case when d.monster then 0 else
    greatest(0, least(0.95, (d.tame_chance
      + (skill_of(p_world, p_uid, 'taming') - d.tame_level) / 200
      + case when c.hunger < 0.5 then 0.1 else 0 end
      + coax_bonus(c)
      + greatest(0, (skill_of(p_world, p_uid, 'soul_strength') - 20) * 0.002))
      * (age_row(c.born)).tame
      -- Gentle hand: a wild thing is a quarter readier to trust you.
      * case when walks(p_world, p_uid, 'love', 3) then 1.25 else 1 end)) end
  from species_def d where d.id = c.species
$$;

create or replace function skill_raise(p_world uuid, p_uid uuid, p_id text, p_base double precision)
  returns double precision language plpgsql as $$
declare was double precision; now_v double precision;
begin
  was := skill_of(p_world, p_uid, p_id);
  -- Attentive: everything you do teaches you a tenth faster, for good.
  now_v := least(100, was + skill_gain_of(was, p_base, 0.6 + 0.8 * random())
    * case when p_id <> meditation_skill() and walks(p_world, p_uid, 'knowledge', 1)
           then 1.1 else 1 end);
  insert into skill (world_id, uid, id, value) values (p_world, p_uid, p_id, now_v)
    on conflict (world_id, uid, id) do update set value = excluded.value;
  return now_v - was;
end $$;

create or replace function weapon_damage(p_world uuid, p_uid uuid, w weapon_def, it item)
  returns double precision language sql stable as $$
  select w.damage
    * case when it.id is null then 1 else mat_edge(it.extra) * rarity_boost(it.rare) end
    * (0.55 + coalesce(it.ql, 20) / 180)
    * case when it.id is null then 1 else greatest(0.4, 1 - it.dmg / 150) end
    * (0.7 + skill_of(p_world, p_uid, 'body_strength') / 90)
    * (1 + (skill_of(p_world, p_uid, w.kind) + skill_of(p_world, p_uid, 'fighting')) / 260)
    -- Hard hands, and the half minute of fury that follows them.
    * case when walks(p_world, p_uid, 'power', 3) then 1.16 else 1 end
    * fury_mult(p_world, p_uid)
$$;

create or replace function crop_settle(p_world uuid, p_x int, p_y int) returns boolean
  language plpgsql as $$
declare c crop; per double precision; steps int;
begin
  select * into c from crop where world_id = p_world and x = p_x and y = p_y for update;
  if not found or c.stage >= crop_ripe() then return false; end if;
  select stage_seconds into per from crop_def where id = c.id;
  /*
   * And the gardener's path, which is the one effect of a path that belongs to
   * somebody who is not here. A crop grows for whoever founded the ground it
   * is in, not for whoever happens to be looking at it — so the question is
   * asked of the deed's founder rather than of a caller this function has not
   * got.
   */
  if exists (select 1 from deed d where d.world_id = p_world
               and abs(p_x - d.x) <= d.radius and abs(p_y - d.y) <= d.radius
               and walks(p_world, d.founded_by, 'love', 1)) then
    per := per * 0.8;
  end if;
  steps := least(crop_ripe() - c.stage, floor(extract(epoch from (now() - c.stage_at)) / per)::int);
  if steps <= 0 then return false; end if;
  update crop set
      stage = c.stage + steps,
      -- The stage's own length, added on; not restarted from now.
      stage_at = c.stage_at + make_interval(secs => per * steps),
      tended_now = false
    where world_id = p_world and x = p_x and y = p_y;
  return true;
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

  if gained > 0 then
    perform tell(p_world, p_uid, 'Farming increased by ' || to_char(gained, 'FM0.0000')
      || ' to ' || to_char(skill_of(p_world, p_uid, 'farming'), 'FM990.0000') || '.', 'skill');
  end if;
end $$;

select private.lock_doors();
