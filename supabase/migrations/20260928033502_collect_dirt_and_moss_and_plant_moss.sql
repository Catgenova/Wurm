/*
 * Collect dirt and collect moss, and moss planted on dirt.
 *
 * Asked for: "Add a collect dirt and collect moss option for each respective
 * tile, that operates like collect clay/sand. Moss can be planted in 10qty on
 * a dirt tile to change it to moss."
 *
 * Collect is the one door for every bed (`gather_refusal` asks the tile's
 * `collect`, which the definitions now set on dirt and moss). It fills the
 * shovel with the tile's `collect_yield` where it has one -- moss off a moss
 * tile, though digging a moss tile still gives dirt -- and with what digging
 * gives otherwise (`perform_gather`).
 *
 * Plant moss is farm work (`farm_action`): `moss_plant` moss from the pack on
 * a tile of dirt that is not under water turns it to moss (`farm_refusal`,
 * `perform_farm`), in the browser's words. It changes the surface of the
 * ground, so a settlement's border speaks for it (`shapes_ground`).
 *
 * `supabase/test/moss.ts` holds the two sides to each other.
 */

CREATE OR REPLACE FUNCTION public.perform_gather(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare d action_def; tx int; ty int; here int; data int; t tile_def; tool_id bigint;
        s double precision; tq double precision; made_ql double precision;
        species int; logs int; tree tree_def;
        v_age tree_age_def; v_cuts int;
        passes int; i int; found text[] := '{}'; got text; yields text;
        v_n int; v_hits int; v_rare text;
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
    -- A Forester's Sure Hatchet glances off half as often (`fail:cut_down`).
    if not perk_pass(skill_check(s, d.difficulty, tq), pk(p_world, p_uid, 'fail:cut_down', 1)) then
      perform skill_raise(p_world, p_uid, 'woodcutting', try_gain(false));
      perform tell(p_world, p_uid, 'Your hatchet glances off and you fail to make headway.', 'event');
      return;
    end if;
    if here = tile_id('Bush') then
      perform land_set_tile(p_world, tx, ty, tile_id('Grass'));
      perform land_set_data(p_world, tx, ty, 0);
      perform land_announce(p_world, tx, ty);
      perform tell(p_world, p_uid, 'You hack the bush down.', 'event');
      -- And straight shafts out of it, for a Forester's Kindling (`bush:shaft`).
      v_n := floor(pk(p_world, p_uid, 'bush:shaft', 0))::int;
      if v_n > 0 then
        made_ql := product_ql(s, tq);
        perform give(p_world, p_uid, 'shaft', v_n, made_ql);
        perform tell(p_world, p_uid, 'You trim ' || number_word(v_n) || ' straight '
          || case when v_n = 1 then 'shaft' else 'shafts' end || ' out of it. (QL '
          || to_char(made_ql, 'FM990.0') || ')', 'event');
      end if;
    elsif here <> tile_id('Tree') then
      -- Nothing standing is nothing to fell. `act_refusal` says so before the
      -- swing and this says so after it: reading a tree off a tile that has
      -- none gives species 0 and age 0, which is a birch out of thin air.
      perform tell(p_world, p_uid, 'There is nothing standing here to cut down.', 'error');
      return;
    else
      species := tree_species(data);
      select * into tree from tree_def where id = species;
      select * into v_age from tree_age_def where id = tree_age(data);
      /*
       * A tree comes down in strokes, and how many depends on what it is.
       *
       * The count is kept beside the tile, in `tree_notch`, rather than in
       * the swinging — because a wood is not one woodcutter's. Leave a half-felled oak and the notch is still in it
       * tomorrow, for you or for whoever finds it. A cut that glances off is
       * not one of them: that is the skill check above, which has already
       * returned by here.
       */
      v_cuts := tree_cuts(p_world, tx, ty) + 1;
      -- A stroke fewer for a Forester's Heavy Swing, and never none.
      v_hits := tree_hits(p_world, p_uid, v_age.hits);
      if v_cuts < v_hits then
        perform tree_notch(p_world, tx, ty, v_cuts);
        perform tell(p_world, p_uid, 'You cut into the ' || lower(v_age.name) || ' '
          || lower(tree.name) || '. ' || (v_hits - v_cuts)
          || ' more like that and it comes down.', 'event');
      else
        logs := v_age.logs;
        -- A tree with timber in it leaves a stump of its kind, in the way of
        -- the ground for a day or until somebody digs it out. Nothing smaller
        -- leaves one worth the name.
        -- And none for a Forester's Clean Drop (`stump:clear`): grass where it stood.
        if logs = 0 or pk(p_world, p_uid, 'stump:clear', 0) > 0 then
          perform land_set_tile(p_world, tx, ty, tile_id('Grass'));
          perform land_set_data(p_world, tx, ty, 0);
        else
          perform land_set_tile(p_world, tx, ty, tile_id('Stump'));
          perform land_set_data(p_world, tx, ty, tree_pack(species, 0));
        end if;
        perform land_announce(p_world, tx, ty);
        perform journal_note(p_world, p_uid, 'tree');
        if logs = 0 then
          perform tell(p_world, p_uid, 'You clear the ' || lower(v_age.name) || ' '
            || lower(tree.name) || ' away. There is no timber in one that size.', 'event');
        else
          -- Better for a Forester's Choice Logs (`ql:cut_down`), and now and
          -- then rare for their Rare Heartwood (`rare:cut_down`).
          made_ql := least(100, product_ql(s, tq) * pk(p_world, p_uid, 'ql:cut_down', 1));
          v_rare := perk_rare(pk(p_world, p_uid, 'rare:cut_down', 0));
          perform gather(p_world, p_uid, 'log', logs, made_ql, tree.name, v_rare);
          perform tell(p_world, p_uid, 'The ' || lower(v_age.name) || ' ' || lower(tree.name)
            || ' comes down. You get ' || logs || coalesce(' ' || v_rare, '')
            || case when logs = 1 then ' log' else ' logs' end || '. (QL ' || to_char(made_ql, 'FM990.0') || ')'
            || case when pk(p_world, p_uid, 'stump:clear', 0) > 0 then ' The ground is clear where it stood.'
                    else ' The stump is left.' end, 'event');
          if v_rare is not null then
            perform journal_note(p_world, p_uid, v_rare);
            perform tell(p_world, p_uid, rarity_word(v_rare), 'skill');
          end if;
          -- A nest in the crown and a wild hive in the trunk, for a Forester's
          -- Nest Finder and Honey Hunter: into the pack, at the logs' quality.
          if random() < pk(p_world, p_uid, 'nest:chance', 0) then
            v_n := floor(pk(p_world, p_uid, 'nest:feathers', 0))::int;
            perform give(p_world, p_uid, 'feather', v_n, made_ql);
            perform tell(p_world, p_uid, 'A nest comes down with it: ' || number_word(v_n) || ' '
              || lower((select name from item_def where id = 'feather')) || '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
          end if;
          if random() < pk(p_world, p_uid, 'honey:chance', 0) then
            v_n := floor(pk(p_world, p_uid, 'honey:count', 0))::int;
            perform give(p_world, p_uid, 'honey', v_n, made_ql);
            perform tell(p_world, p_uid, 'A wild hive in the trunk gives up ' || number_word(v_n) || ' '
              || lower((select name from item_def where id = 'honey')) || '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
          end if;
        end if;
      end if;
    end if;
    perform skill_raise(p_world, p_uid, 'woodcutting', 1);

  elsif p_action in ('forage', 'botanize') then
    perform mark_foraged(p_world, tx, ty, p_action);
    -- A practised eye goes over the same ground more than once, and a
    -- Naturalist's Keen Eye once more again.
    passes := rolls_at(s) + floor(pk(p_world, p_uid, 'passes:' || p_action, 0))::int;
    for i in 1..passes loop
      -- None empty by chance for a Naturalist's Sure Find.
      if random() < forage_empty() * pk(p_world, p_uid, 'empty:' || p_action, 1)
         or not skill_check(s, find_check(), 0) then continue; end if;
      got := roll_table(p_action, random());
      made_ql := product_ql(s, 0);
      -- And now and then a rare one, for a Naturalist's Rare Find.
      v_rare := perk_rare(pk(p_world, p_uid, 'rare:' || p_action, 0));
      perform gather(p_world, p_uid, got, 1, made_ql, null, v_rare);
      found := found || (coalesce(v_rare || ' ', '') || lower((select coalesce(name, got) from item_def where id = got))
        || ' (QL ' || to_char(made_ql, 'FM990.0') || ')');
      if v_rare is not null then
        perform journal_note(p_world, p_uid, v_rare);
        perform tell(p_world, p_uid, rarity_word(v_rare), 'skill');
      end if;
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
    perform skill_raise(p_world, p_uid, d.skill, try_gain(array_length(found, 1) is not null));

  elsif p_action = 'collect' then
    -- What the tile's top is where it is not what digging gives: moss off a moss tile.
    yields := coalesce(t.collect_yield, t.dig_yield);
    if yields is null then return; end if;
    if not skill_check(s, d.difficulty, tq) then
      perform skill_raise(p_world, p_uid, 'digging', try_gain(false));
      perform tell(p_world, p_uid, 'Your shovel comes up with nothing but a smear of '
        || lower(t.name) || '.', 'event');
      return;
    end if;
    made_ql := least(100, product_ql(s, tq) * pk(p_world, p_uid, 'ql:collect', 1));
    perform gather(p_world, p_uid, yields, 1, made_ql, null, perk_rare(pk(p_world, p_uid, 'rare:collect', 0)));
    perform tell(p_world, p_uid, 'You fill a shovel with '
      || lower((select coalesce(name, yields) from item_def where id = yields))
      || ' off the top of the bed. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    perform skill_raise(p_world, p_uid, 'digging', 1);
  end if;

end $function$;

create or replace function farm_action(p_action text) returns boolean language sql immutable as $fn$
  select p_action in ('till', 'plant_seed', 'tend_crop', 'harvest_crop', 'clear_field',
                      'sow_patch', 'tend_patch', 'harvest_patch', 'plant_moss')
$fn$;

CREATE OR REPLACE FUNCTION public.farm_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; here int; c crop; it item; v_r int;
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
  elsif p_action = 'plant_moss' then
    -- In the browser's words and order (actions.ts, `plant_moss`).
    if here <> tile_id('Dirt') then return 'Moss is planted on a tile of dirt.'; end if;
    if has_water(p_world, tx, ty) then return 'You cannot plant moss underwater.'; end if;
    if pack_count(p_world, p_uid, 'moss') < moss_plant() then
      return 'It takes ' || moss_plant() || ' moss to plant a tile; you have ' || pack_count(p_world, p_uid, 'moss') || '.';
    end if;
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
        v_ids text[] := '{}'; v_counts int[] := '{}'; v_rares text[] := '{}'; v_rare text;
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

  elsif p_action = 'plant_moss' then
    -- `moss_plant` moss pressed into bare dirt turns the tile to moss.
    if land_tile(p_world, tx, ty) <> tile_id('Dirt') or pack_count(p_world, p_uid, 'moss') < moss_plant() then return; end if;
    if not consume(p_world, p_uid, 'moss', moss_plant()) then return; end if;
    perform land_set_tile(p_world, tx, ty, tile_id('Moss'));
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You plant ' || moss_plant() || ' moss and the dirt is moss now.', 'event');

  elsif p_action = 'plant_seed' then
    select * into it from item where id = target_item(p_target);
    select * into cd from crop_def where seed = it.def;
    v_how := sow_one(p_world, p_uid, tx, ty, it.id);
    if v_how is null then return; end if;
    perform tell(p_world, p_uid, 'You sow ' || lower(cd.name)
      || '. It should be sprouting in a couple of minutes.'
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
    perform land_set_tile(p_world, tx, ty, tile_id('Dirt'));
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, case when c.id is not null
      then 'You turn the ' || lower(cd.name) || ' back into the soil.'
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
                      'lay_steps', 'lay_timber_steps', 'take_up_steps', 'plant_moss')
$function$;

select private.lock_doors();
