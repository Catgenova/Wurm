-- A face that comes down one swing in thirty, for a mola as well as for you
--
-- Asked for: *"chance to reduce a corner elevation when Mining is currently
-- 1/100. change to 1/30 and ensure Mola have the chance to reduce as well."*
--
-- Two things, and the second was the real one.
--
-- One in a hundred is hardly ever enough to be a thing that happens. A seam
-- worked for an afternoon sank a step or two, and the whole business read as a
-- fixed wall you chipped at rather than rock you were taking down. A thirtieth
-- is still nobody's plan for moving stone -- `chip_corner` is the job for that
-- and it comes off three swings in four -- but it is often enough that a face
-- you have been at all day is visibly lower than it was.
--
-- And `worker_do`, which is every gathering swing a wildermon takes, took the
-- metal out of the seam and left the rock exactly where it stood. For every
-- swing a mola ever made, on every island. The browser's mola has been cutting
-- the face back by luck since the day workers went in -- `finishMining` and
-- `finishQuarry` both roll it -- so this is one more thing the browser did and
-- the island did not, and nobody had put the two side by side.
--
-- The number is `mine_collapse()` now rather than a literal in whichever
-- dispatcher happened to want it, and the browser's `MINE_COLLAPSE` is the
-- same fraction written the same way, so the two can be read against each
-- other without hunting for them.

/** How often working a face for its metal happens to bring a slab of it down. */
create or replace function mine_collapse() returns double precision
  language sql immutable as $fn$ select 1.0 / 30 $fn$;

CREATE OR REPLACE FUNCTION public.worker_do(p_world uuid, p_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; kind text; skill_id text; skill double precision;
        wx int; wy int; here int; data int; tree tree_def; rock rock_def; logs int;
        v_age tree_age_def; v_cuts int;
        made_ql double precision; got text; careful double precision; chance double precision;
        cr crop; yld int[]; depth double precision; v_seed item; v_cd crop_def;
begin
  select * into c from creature where world_id = p_world and id = p_id;
  if not found or c.work_x is null then return null; end if;
  select * into d from species_def where id = c.species;
  kind := coalesce(c.job, d.gathers);
  select g.skill into skill_id from gather_def g where g.id = kind;
  skill := task_skill(c);
  wx := c.work_x; wy := c.work_y;
  here := land_tile(p_world, wx, wy);
  careful := beast_mul(c, 'yield');
  perform worker_learn(p_world, p_id, skill_id, 0.225);
  made_ql := least(100, greatest(1, skill * (0.6 + random() * 0.8) + 1) * careful);

  if kind = 'woodcut' then
    if here <> tile_id('Tree') then return null; end if;
    data := land_data(p_world, wx, wy);
    select * into tree from tree_def where id = tree_species(data);
    select * into v_age from tree_age_def where id = tree_age(data);
    -- A worker swings the same number of times a person would, and the notch it
    -- leaves is the same notch: anybody may finish the tree it started.
    v_cuts := tree_cuts(p_world, wx, wy) + 1;
    if v_cuts < v_age.hits then
      perform tree_notch(p_world, wx, wy, v_cuts);
      return null;
    end if;
    logs := v_age.logs;
    -- A tree with timber in it leaves a stump, as it does under a hatchet.
    if logs = 0 then
      perform land_set_tile(p_world, wx, wy, tile_id('Grass'));
      perform land_set_data(p_world, wx, wy, 0);
    else
      perform land_set_tile(p_world, wx, wy, tile_id('Stump'));
      perform land_set_data(p_world, wx, wy, tree_pack(tree_species(data), 0));
    end if;
    perform land_announce(p_world, wx, wy);
    if logs = 0 then return null; end if;
    -- It can only carry one at a time; the rest of the tree waits at the stump.
    if logs > 1 then
      perform drop_on_ground(p_world, wx, wy, 'log', made_ql, tree.name, logs - 1);
    end if;
    return jsonb_build_object('def', 'log', 'count', 1, 'ql', made_ql, 'extra', tree.name);

  elsif kind = 'prune' then
    -- A stage back, as under a sickle: the age and nothing else. It carries
    -- nothing home.
    if here <> tile_id('Tree') then return null; end if;
    data := land_data(p_world, wx, wy);
    select * into v_age from tree_age_def where id = tree_age(data);
    if v_age.pruned is null then return null; end if;
    perform land_set_data(p_world, wx, wy, tree_pack(tree_species(data), v_age.pruned));
    perform land_announce(p_world, wx, wy);
    return null;

  elsif kind = 'fruit' then
    -- Off a bearing tree, as many as a person's hands would take: an old
    -- tree carries more than one only just come into bearing. The tree is
    -- left picked for the day, as it is behind a person.
    if here <> tile_id('Tree') then return null; end if;
    data := land_data(p_world, wx, wy);
    select * into tree from tree_def where id = tree_species(data);
    select * into v_age from tree_age_def where id = tree_age(data);
    if tree.fruit is null or not v_age.bears or not v_age.alive then return null; end if;
    perform mark_foraged(p_world, wx, wy, 'forage');
    return jsonb_build_object('def', tree.fruit,
      'count', greatest(1, round((case when v_age.id in (2, 4) then 5 else 3 end)
                                  * (0.5 + skill / 130.0) * (0.7 + random() * 0.6))::int),
      'ql', made_ql);

  elsif kind = 'stump' then
    -- Bare dirt where it stood, as under a shovel.
    if here <> tile_id('Stump') then return null; end if;
    perform land_set_tile(p_world, wx, wy, tile_id('Dirt'));
    perform land_set_data(p_world, wx, wy, 0);
    perform land_announce(p_world, wx, wy);
    return null;

  elsif kind in ('mine', 'quarry') then
    rock := bedrock_at(p_world, wx, wy);
    got := case when kind = 'mine' and rock.seam then rock.yields else 'rock_shards' end;
    made_ql := least(ore_max_ql((select seed from world where id = p_world), wx, wy), made_ql);
    /*
     * And the face, now and again, the same as for a hand on a pick.
     *
     * This branch took the metal and left the rock exactly where it stood, for
     * every swing a mola ever made -- so a mola set on a seam could work it a
     * week and not move it a step, where the browser's mola has been cutting
     * it back by luck since the day workers went in.
     *
     * The guard is the browser's: a corner one unit up is the floor, and
     * nothing digs the island out from under itself.
     */
    if random() < mine_collapse() and rock_height(p_world, wx, wy) > 1 then
      perform land_set_height(p_world, wx, wy, land_height(p_world, wx, wy) - 1);
      perform land_set_dirt(p_world, wx, wy, 0);
      perform reconcile_around(p_world, wx, wy);
      perform land_announce(p_world, wx, wy);
    end if;
    return jsonb_build_object('def', got, 'count', 1, 'ql', made_ql);

  elsif kind in ('sand', 'clay') then
    if land_dirt(p_world, wx, wy) <= 0 then return null; end if;
    perform land_set_dirt(p_world, wx, wy, land_dirt(p_world, wx, wy) - 1);
    return jsonb_build_object('def', kind, 'count', 1, 'ql', made_ql);

  elsif kind = 'peat' then
    perform mark_foraged(p_world, wx, wy, 'dig');
    return jsonb_build_object('def', case when here = tile_id('Tar') then 'tar' else 'peat' end,
      'count', 1, 'ql', made_ql);

  elsif kind = 'reed' then
    perform mark_foraged(p_world, wx, wy, 'reed');
    return jsonb_build_object('def', 'reed', 'count', 1, 'ql', made_ql);

  elsif kind = 'fish' then
    depth := water_depth(p_world, wx, wy);
    got := catch_fish(depth, skill, 0, null);
    if got is null then return null; end if;
    return jsonb_build_object('def', got, 'count', 1, 'ql', made_ql);

  elsif kind = 'seek' then
    -- A nose over ground nobody has turned. It finds what it knows to look
    -- for and no more, and nothing it brings up is sound.
    perform mark_foraged(p_world, wx, wy, 'dig');
    if random() > find_chance(skill, 30) then return null; end if;
    declare v_relic relic_def; v_part int;
    begin
      select * into v_relic from relics_within(skill) order by random() limit 1;
      if not found then return null; end if;
      v_part := 1 + floor(random() * v_relic.parts)::int;
      return jsonb_build_object('def', 'fragment', 'count', 1,
        'ql', least(100, greatest(1, skill * (0.6 + random() * 0.8))),
        'extra', v_relic.name || ' ' || v_part || '/' || v_relic.parts);
    end;

  elsif kind = 'fetch' then
    -- Whatever is lying there, carried home. A feller leaves two logs at every
    -- stump it works; this is what tidies them away.
    declare lying item;
    begin
      select * into lying from item where world_id = p_world and holder = 'ground'
        and gx = wx and gy = wy order by id limit 1;
      if not found then return null; end if;
      delete from item where id = lying.id;
      return jsonb_build_object('def', lying.def, 'count', lying.count,
        'ql', lying.ql, 'extra', lying.extra);
    end;

  elsif kind = 'compost' then
    -- Whatever it was, what comes back is compost, and the more of it the better.
    declare rot item;
    begin
      select * into rot from item where world_id = p_world and holder = 'ground'
        and gx = wx and gy = wy and (def = 'corpse' or dmg >= 40) order by id limit 1;
      if not found then return null; end if;
      delete from item where id = rot.id;
      return jsonb_build_object('def', 'compost', 'count', greatest(1, round(rot.count / 2.0)::int),
        'ql', least(100, 20 + skill * 0.6));
    end;

  elsif kind = 'farm' then
    perform crop_settle(p_world, wx, wy);
    select * into cr from crop where world_id = p_world and x = wx and y = wy;
    if not found then
      -- Nothing growing here. Sow it, if this is a field and there is a seed
      -- to be had: one lying where the last harvest left it, or one out of the
      -- settlement's stores.
      if land_tile(p_world, wx, wy) <> tile_id('Field') then return null; end if;
      select * into v_seed from sow_seed(p_world, c, wx, wy);
      if v_seed.id is null then return null; end if;
      if v_seed.count > 1 then
        update item set count = count - 1 where id = v_seed.id;
      else
        delete from item where id = v_seed.id;
      end if;
      select * into v_cd from crop_def where seed = v_seed.def;
      if v_cd.id is null then return null; end if;
      insert into crop (world_id, x, y, id, ql, sown_by)
      values (p_world, wx, wy, v_cd.id, v_seed.ql, c.keeper)
      on conflict (world_id, x, y) do update set id = v_cd.id, stage = 0, stage_at = now(),
        tended = 0, tended_now = false, ql = v_seed.ql, sown_by = c.keeper;
      perform land_announce(p_world, wx, wy);
      -- Nothing to carry home: the work was putting it in the ground.
      return null;
    end if;
    if cr.stage < crop_ripe() then
      -- Not ripe: weed and water it, which is what makes the harvest worth having.
      if not cr.tended_now then
        update crop set tended = tended + 1, tended_now = true,
            ql = least(100, ql + greatest(1, skill * 0.2))
          where world_id = p_world and x = wx and y = wy;
        return null;
      end if;
      /*
       * Weeded already, and still growing. What is left to do on this tile is
       * carry away the seed the last harvest left in the furrow: a sown field
       * has no use for it, and it goes home to the stores with everything
       * else a worker carries rather than lying out here for good.
       */
      select * into v_seed from item i
        where i.world_id = p_world and i.holder = 'ground' and i.gx = wx and i.gy = wy
          and exists (select 1 from crop_def sd where sd.seed = i.def)
        order by i.id limit 1;
      if v_seed.id is null then return null; end if;
      delete from item where id = v_seed.id;
      return jsonb_build_object('def', v_seed.def, 'count', v_seed.count, 'ql', v_seed.ql);
    end if;
    yld := crop_yield(cr.tended);
    select produce into got from crop_def where id = cr.id;
    delete from crop where world_id = p_world and x = wx and y = wy;
    perform land_set_tile(p_world, wx, wy, tile_id('Field'));
    perform land_announce(p_world, wx, wy);
    -- The seed goes back in the ground's place; the produce goes home.
    perform drop_on_ground(p_world, wx, wy, (select seed from crop_def where id = cr.id),
      cr.ql, null, yld[2]);
    return jsonb_build_object('def', got, 'count', yld[1], 'ql', cr.ql);

  else
    -- Foraging and botanizing: the same table a player rolls on, and the same
    -- bed left picked clean behind it.
    perform mark_foraged(p_world, wx, wy, kind);
    chance := least(0.98, greatest(0.3, 0.6 + (skill / 100) * 0.38 - 5 / 150.0) * careful);
    if random() < 0.2 or random() >= chance then return null; end if;
    got := roll_table(kind, random());
    if got is null then return null; end if;
    return jsonb_build_object('def', got, 'count', 1, 'ql', made_ql);
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.perform_terrain(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare d action_def; cx int; cy int; tx int; ty int; t tile_def; r rock_def;
        s double precision; tq double precision; yields text; made_ql double precision; tool_id bigint; here int;
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
      -- The swing happened. It taught nothing at all until now.
      perform skill_raise(p_world, p_uid, d.skill, try_gain(false));
      perform tell(p_world, p_uid, 'The rock is hard and you fail to loosen anything.', 'event');
      return;
    end if;
    r := bedrock_at(p_world, tx, ty);
    yields := case when land_tile(p_world, tx, ty) = 4 then r.yields else 'rock_shards' end;
    -- The first ore out of the ground is a thing worth remembering.
    if yields like '%\_ore' then perform journal_note(p_world, p_uid, 'ore'); end if;
    made_ql := least(ore_max_ql((select seed from world where id = p_world), tx, ty), product_ql(s, tq));
    perform give(p_world, p_uid, yields, 1, made_ql);
    -- And one swing in a thousand that brings out something nobody quarried.
    perform maybe_map(p_world, p_uid, s, tq);
    -- And a stone, now and again, which is the other thing a miner is for.
    perform maybe_gem(p_world, p_uid, s, tq);
    perform tell(p_world, p_uid,
      case when yields like '%lump' then 'You chip a ' else 'You mine some ' end
      || lower((select coalesce(name, yields) from item_def where id = yields))
      || case when yields like '%lump' then ' out of the vein.' else '.' end
      || ' (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    -- Cutting the face back is its own job. Now and again one comes down anyway.
    if random() < mine_collapse() then
      perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
      perform land_set_dirt(p_world, cx, cy, 0);
      perform reconcile_around(p_world, cx, cy);
      perform tell(p_world, p_uid, 'A slab breaks away of its own accord and the face drops.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'chip_corner' then
    if random() >= chip_chance() then
      perform skill_raise(p_world, p_uid, d.skill, try_gain(false));
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
    perform maybe_map(p_world, p_uid, s, tq);
    perform tell(p_world, p_uid, 'The corner breaks away and drops a step. You gather the '
      || lower((select coalesce(name, yields) from item_def where id = yields))
      || '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    perform skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'pack' then
    here := land_tile(p_world, tx, ty);
    perform land_set_tile(p_world, tx, ty, 2);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, case when here <> 1
      then 'You cut the turf away and tread the ground down firm.'
      else 'You pack the dirt down firmly.' end, 'event');
    perform skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'cultivate' then
    perform land_set_tile(p_world, tx, ty, 1);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You break up the packed earth.', 'event');
    perform skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'pave_gravel' then
    if not consume(p_world, p_uid, 'rock_shards', 1) then return; end if;
    perform land_set_tile(p_world, tx, ty, 13);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You spread the crushed rock into a gravel surface.', 'event');
    perform skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'pave_cobble' then
    if not consume(p_world, p_uid, 'stone_brick', 1) then return; end if;
    perform land_set_tile(p_world, tx, ty, 14);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You lay the cobblestones.', 'event');
    perform skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'drop_dirt_here' then
    if not consume(p_world, p_uid, 'dirt', 1) then return; end if;
    select round(x)::int, round(y)::int into cx, cy from player where world_id = p_world and uid = p_uid;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) + 1);
    perform land_set_dirt(p_world, cx, cy, land_dirt(p_world, cx, cy) + 1);
    perform reconcile_around(p_world, cx, cy);
    /*
     * And what the spadeful covered, which is the tile you are standing on.
     *
     * The corner this raises is the nearest one, which belongs to as many as
     * four tiles; the ground that took the dirt is the one under your feet.
     * `drop_dirt` at a corner covers the tile it names, and this covers that
     * one — the same spadeful and the same list either way.
     */
    select floor(x)::int, floor(y)::int into tx, ty from player where world_id = p_world and uid = p_uid;
    if exists (select 1 from buryable b where b.tile = land_tile(p_world, tx, ty)) then
      perform land_set_tile(p_world, tx, ty, 1);
      perform land_announce(p_world, tx, ty);
    end if;
    perform tell(p_world, p_uid, 'You drop the dirt at your feet, raising the ground.', 'event');
    perform skill_raise(p_world, p_uid, d.skill, 1);
  end if;

end $function$
;

select private.lock_doors();
