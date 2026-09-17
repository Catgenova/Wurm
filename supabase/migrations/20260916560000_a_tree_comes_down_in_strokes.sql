-- A tree comes down in strokes, and the age says how many and what is left
--
-- Asked from the island: *"saplings take one hit to destroy and give no logs.
-- young trees take two hits and give two logs. mature trees take 3 hits and
-- give 4 logs. old trees take 3 hits and give 3 logs."*
--
-- Felling was one swing and a species. A birch was one log, a pine two, and an
-- old one of anything a log more than a grown one — so a tree the size of a
-- house and a tree you could step over came down for the same single stroke,
-- and what you got for it depended on which kind it was rather than on how much
-- of it there was.
--
-- Now the age decides both, and the species decides neither.
--
--     sapling   1 stroke, no timber
--     young     2 strokes, 2 logs
--     mature    3 strokes, 4 logs
--     old       3 strokes, 3 logs
--
-- `tree_age_def` is that table, crossed from `TREE_AGES`, and `tree_def.logs`
-- is gone: a birch and an oak of the same age now come down for the same
-- timber. Say the word and species comes back as a multiplier on top.
--
-- ## Where the strokes are kept
--
-- In the tile. A tile's `data` byte holds the species in its low four bits and
-- the age in the next two, and the top two were doing nothing — they hold how
-- many cuts it has taken. On the tile rather than on the woodcutter, because a
-- wood is not one woodcutter's: leave a half-felled oak and the notch is still
-- in it tomorrow, for you or for whoever comes by. A wildermon set to fell does
-- the same, into the same notch, and either can finish what the other started.
--
-- A cut that glances off is not one of them. That is the skill check, which
-- returns before any of this and pays `try_gain(false)` for the swing.
--
-- ## Why sapling is the fourth value and not the first
--
-- The two bits over the species have held 0 young, 1 mature, 2 old since a tree
-- had an age at all, and every tree standing on every island holds one of those
-- three. Putting sapling at 0 would have been a rename of every wood in the
-- world, one age younger overnight, with no way to tell which was which. So it
-- is the fourth value, the table is indexed by the byte rather than by
-- seniority, and nothing anywhere reads it as an order — `bears` is what "old
-- enough to fruit" used to ask as `= 0`, and it answers the same for young and
-- the same for old.
--
-- Worth saying plainly: nothing on this island grows a tree from one age to the
-- next. It never has. So a sapling is a stage the world generator makes and a
-- planted sprout is still a young tree, exactly as before — a planted sapling
-- would stand there for ever being worth nothing. The clock that would fix that
-- is a separate piece of work.

/** The age bits, all four of them now. */
create or replace function tree_age(p_data integer) returns integer
  language sql immutable as $fn$ select (p_data >> 4) & 3 $fn$;

/** And how many cuts the tile has taken, in the two bits above those. */
create or replace function tree_cuts(p_data integer) returns integer
  language sql immutable as $fn$ select (p_data >> 6) & 3 $fn$;

CREATE OR REPLACE FUNCTION public.perform_gather(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare d action_def; tx int; ty int; here int; data int; t tile_def; tool_id bigint;
        s double precision; tq double precision; made_ql double precision;
        species int; logs int; tree tree_def; gained double precision;
        v_age tree_age_def; v_cuts int;
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
      gained := skill_raise(p_world, p_uid, 'woodcutting', try_gain(false));
      perform tell(p_world, p_uid, 'Your hatchet glances off and you fail to make headway.', 'event');
      perform skill_said(p_world, p_uid, 'woodcutting', gained);
      return;
    end if;
    if here = tile_id('Bush') then
      perform land_set_tile(p_world, tx, ty, tile_id('Grass'));
      perform land_set_data(p_world, tx, ty, 0);
      perform land_announce(p_world, tx, ty);
      perform tell(p_world, p_uid, 'You hack the bush down.', 'event');
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
       * The count is kept in the tile, in the two bits over the age that
       * nothing was using, rather than in the swinging — because a wood is not
       * one woodcutter's. Leave a half-felled oak and the notch is still in it
       * tomorrow, for you or for whoever finds it. A cut that glances off is
       * not one of them: that is the skill check above, which has already
       * returned by here.
       */
      v_cuts := tree_cuts(data) + 1;
      if v_cuts < v_age.hits then
        perform land_set_data(p_world, tx, ty, (data & 63) | ((v_cuts & 3) << 6));
        perform land_announce(p_world, tx, ty);
        perform tell(p_world, p_uid, 'You cut into the ' || lower(v_age.name) || ' '
          || lower(tree.name) || '. ' || (v_age.hits - v_cuts)
          || ' more like that and it comes down.', 'event');
      else
        logs := v_age.logs;
        perform land_set_tile(p_world, tx, ty, tile_id('Grass'));
        perform land_set_data(p_world, tx, ty, 0);
        perform land_announce(p_world, tx, ty);
        perform journal_note(p_world, p_uid, 'tree');
        if logs = 0 then
          perform tell(p_world, p_uid, 'You clear the ' || lower(v_age.name) || ' '
            || lower(tree.name) || ' away. There is no timber in one that size.', 'event');
        else
          made_ql := product_ql(s, tq);
          perform give(p_world, p_uid, 'log', logs, made_ql, tree.name);
          perform tell(p_world, p_uid, 'The ' || lower(v_age.name) || ' ' || lower(tree.name)
            || ' comes down. You get ' || logs
            || case when logs = 1 then ' log' else ' logs' end || '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
        end if;
      end if;
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
    gained := skill_raise(p_world, p_uid, d.skill, try_gain(array_length(found, 1) is not null));

  elsif p_action = 'collect' then
    yields := t.dig_yield;
    if yields is null then return; end if;
    if not skill_check(s, d.difficulty, tq) then
      gained := skill_raise(p_world, p_uid, 'digging', try_gain(false));
      perform tell(p_world, p_uid, 'Your shovel comes up with nothing but a smear of '
        || lower(t.name) || '.', 'event');
      perform skill_said(p_world, p_uid, 'digging', gained);
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

CREATE OR REPLACE FUNCTION public.worker_do(p_world uuid, p_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; kind text; skill_id text; skill double precision;
        wx int; wy int; here int; data int; tree tree_def; rock rock_def; logs int;
        v_age tree_age_def; v_cuts int;
        made_ql double precision; got text; careful double precision; chance double precision;
        cr crop; yld int[]; depth double precision;
begin
  select * into c from creature where world_id = p_world and id = p_id;
  if not found or c.work_x is null then return null; end if;
  select * into d from species_def where id = c.species;
  kind := d.gathers;
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
    v_cuts := tree_cuts(data) + 1;
    if v_cuts < v_age.hits then
      perform land_set_data(p_world, wx, wy, (data & 63) | ((v_cuts & 3) << 6));
      perform land_announce(p_world, wx, wy);
      return null;
    end if;
    logs := v_age.logs;
    perform land_set_tile(p_world, wx, wy, tile_id('Grass'));
    perform land_set_data(p_world, wx, wy, 0);
    perform land_announce(p_world, wx, wy);
    if logs = 0 then return null; end if;
    -- It can only carry one at a time; the rest of the tree waits at the stump.
    if logs > 1 then
      perform drop_on_ground(p_world, wx, wy, 'log', made_ql, tree.name, logs - 1);
    end if;
    return jsonb_build_object('def', 'log', 'count', 1, 'ql', made_ql, 'extra', tree.name);

  elsif kind in ('mine', 'quarry') then
    rock := bedrock_at(p_world, wx, wy);
    got := case when kind = 'mine' and rock.seam then rock.yields else 'rock_shards' end;
    made_ql := least(ore_max_ql((select seed from world where id = p_world), wx, wy), made_ql);
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
    if not found then return null; end if;
    if cr.stage < crop_ripe() then
      -- Not ripe: weed and water it, which is what makes the harvest worth having.
      if cr.tended_now then return null; end if;
      update crop set tended = tended + 1, tended_now = true,
          ql = least(100, ql + greatest(1, skill * 0.2))
        where world_id = p_world and x = wx and y = wy;
      return null;
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
end $function$;

CREATE OR REPLACE FUNCTION public.ground_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare tx int; ty int; cx int; cy int; here int; t tile_def; v_data int; v_tree tree_def;
        v_under text; p player;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  if tx is null or ty is null or not in_bounds(p_world, tx, ty) then
    return 'There is nothing there.';
  end if;
  here := land_tile(p_world, tx, ty);
  select * into t from tile_def where id = here;
  v_data := land_data(p_world, tx, ty);

  if p_action = 'flatten' then
    if t.dig_yield is null then return 'You cannot flatten that.'; end if;
    if pack_count(p_world, p_uid, 'shovel') < 1 then return 'You need a shovel to flatten.'; end if;
    -- Shallows are workable, to the depth a pick works to. `has_water` refuses
    -- a tile with one corner an inch under, which is most of a shoreline.
    if centre_height(p_world, tx, ty) < -mine_depth() then
      return 'The water is too deep here to work in.';
    end if;
    if flatten_target(p_world, p_uid, tx, ty) < -mine_depth() then
      return 'The ground you stand on is too deep to work from.';
    end if;
    v_under := under_building(p_world, tx, ty);
    if v_under is not null then return v_under; end if;
    if not needs_flattening(p_world, p_uid, tx, ty) then return 'That ground is already flat.'; end if;

  elsif p_action = 'drop_dirt' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    if pack_count(p_world, p_uid, 'dirt') < 1 then return 'You have no dirt to drop.'; end if;
    v_under := corner_under_building(p_world, cx, cy);
    if v_under is not null then return v_under; end if;
    if corner_slope_after(p_world, cx, cy, 1) > max_dig_slope(p_world, p_uid) then
      return 'The slope would be too steep for your digging skill.';
    end if;

  elsif p_action = 'pave_slabs' then
    v_under := under_building(p_world, tx, ty);
    if v_under is not null then return v_under; end if;
    if here <> 2 then return 'The ground has to be packed flat before anything is laid on it.'; end if;
    if pack_count(p_world, p_uid, 'trowel') < 1 then return 'You need a trowel to bed a slab.'; end if;
    if not exists (select 1 from item i join slab_def s on s.item = i.def
                   where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
                     and not i.locked) then
      return 'You need a cut slab to pave with.';
    end if;

  elsif p_action = 'remove_paving' then
    if here not in (13, 14, 21) then return 'There is no paving here to break up.'; end if;
    v_under := under_building(p_world, tx, ty);
    if v_under is not null then return v_under; end if;
    if pack_count(p_world, p_uid, 'pickaxe') < 1 then return 'You need a pickaxe to break up paving.'; end if;

  elsif p_action = 'cut_grass' then
    if here not in (0, 5, 6, 20) then return 'There is no grass here to cut.'; end if;
    if is_foraged(p_world, tx, ty, 'grass') then return 'The grass here is still short.'; end if;

  elsif p_action = 'cut_reeds' then
    if here <> 19 then return 'There are no reeds here.'; end if;
    if pack_count(p_world, p_uid, 'carving_knife') < 1 then return 'You need a knife to cut reeds.'; end if;
    if is_foraged(p_world, tx, ty, 'reed') then return 'The reeds here are cut back to the water.'; end if;

  elsif p_action = 'pick_fruit' then
    if here <> 16 then return 'There is no tree here.'; end if;
    select * into v_tree from tree_def where id = tree_species(v_data);
    if v_tree.fruit is null then return 'Nothing grows on this that you would eat.'; end if;
    -- A sapling bears nothing; it has to have some years in it first.
    if not coalesce((select bears from tree_age_def where id = tree_age(v_data)), false) then
      return 'The ' || lower(v_tree.name) || ' is too young to bear. Leave it to grow.';
    end if;
    if is_foraged(p_world, tx, ty, 'forage') then
      return 'You have had what this ' || lower(v_tree.name) || ' has on it. Come back later.';
    end if;

  elsif p_action = 'pick_sprout' then
    if here <> 16 then return 'There is no tree here.'; end if;

  elsif p_action = 'plant' then
    if not exists (select 1 from plantable where tile = here) then
      return 'Nothing will take root in that.';
    end if;
    if pack_count(p_world, p_uid, 'sprout') < 1 then return 'You have no sprout to plant.'; end if;
    -- A grown tile of tree is something you walk round, not through, and the
    -- sprout becomes that tile the moment it goes in.
    select * into p from player where world_id = p_world and uid = p_uid;
    if p.uid is not null and floor(p.x)::int = tx and floor(p.y)::int = ty then
      return 'You would be planting it under your own feet. Step off the tile first.';
    end if;

  elsif p_action = 'dig_worms' then
    if not t.wormy then return 'Nothing lives in that.'; end if;
    if pack_count(p_world, p_uid, 'shovel') < 1 then return 'You need a shovel.'; end if;
    if has_water(p_world, tx, ty) then return 'Not under water.'; end if;

  elsif p_action = 'prospect' then
    if pack_count(p_world, p_uid, 'pickaxe') < 1 then return 'You need a pickaxe to prospect.'; end if;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.examine_tile_text(p_world uuid, p_x integer, p_y integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_t int; v_data int; v_out text; v_extra text := ''; b building; v_id int; n int;
begin
  v_t := land_tile(p_world, p_x, p_y);
  v_data := land_data(p_world, p_x, p_y);
  if v_t = 16 then
    v_out := 'You see a '
      || lower(coalesce((select name from tree_age_def where id = tree_age(v_data)), 'young'))
      || ' ' || lower((select name from tree_def where id = tree_species(v_data)))
      || ' tree at (' || p_x || ', ' || p_y || ').';
  elsif v_t = 17 then
    v_out := 'You see a ' || lower((select name from bush_def where id = bush_species(v_data)))
      || ' at (' || p_x || ', ' || p_y || ').';
  else
    v_out := 'You see ' || lower((select name from tile_def where id = v_t))
      || ' at (' || p_x || ', ' || p_y || ').';
  end if;
  v_out := v_out || ' Height ' || to_char(centre_height(p_world, p_x, p_y), 'FM990.0')
    || ', slope ' || tile_slope(p_world, p_x, p_y) || '.';
  if has_water(p_world, p_x, p_y) then v_out := v_out || ' Water laps over it.'; end if;

  if is_token(p_world, p_x, p_y) then
    v_extra := v_extra || ' The settlement token of '
      || (deed_at(p_world, p_x, p_y)).name || ' stands here.';
  elsif on_deed(p_world, p_x, p_y) then
    v_extra := v_extra || ' This is part of ' || (deed_at(p_world, p_x, p_y)).name || '.';
  end if;
  v_id := building_at(p_world, p_x, p_y);
  if v_id is not null then
    select * into b from building where world_id = p_world and id = v_id;
    if found then
      v_extra := v_extra || ' It belongs to ' || b.name || ', '
        || case when b.levels = 1 then 'a single-storey building'
                else b.levels || ' storeys tall' end || '.';
    end if;
  end if;
  select count(*) into n from crate c where c.world_id = p_world
    and p_x between c.x and c.x + c.sx - 1 and p_y between c.y and c.y + c.sy - 1;
  if n = 1 then v_extra := v_extra || ' A crate stands here.';
  elsif n > 1 then v_extra := v_extra || ' ' || n || ' crates stand here.'; end if;
  return v_out || v_extra;
end $function$;

notify pgrst, 'reload schema';
select private.lock_doors();
