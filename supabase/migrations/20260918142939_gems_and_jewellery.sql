-- Gems and jewellery
--
-- Asked from the island. The rock gave up ore, shards and one map in a
-- thousand swings, and a smith's finest work was a coin. Now one swing in a
-- few hundred (`gem_odds`) brings out a stone, at the miner's quality, and
-- each kind of stone favours one trade (`gem_def`, in the order they are
-- drawn, the rarest one part in the total). A jeweller casts a ring or a
-- pendant at the anvil, two to a lump, and sets the stone in it with a file;
-- the piece takes the stone's name the way a chest takes its wood. Worn, in
-- the jewel slot (`jewel_def` says which pieces go there), it is worth a
-- knack on the trade its stone favours (`jewel_bonus`), for as long as it
-- is worn, in the one place a trade's pace is decided: `skill_mult`.
--
-- And a thing found on the way: what a craft is made of decides how
-- stubborn the work is, on both sides, but the island looked the material
-- up by its id with its name, so oak fought back exactly as hard as pine
-- and a diamond would have seated as easily as a garnet. `craft_hardness`
-- goes through `mat_of` like everything else that reads the table.

/** How stubborn a craft is: the recipe's own difficulty and its material's. */
create or replace function craft_hardness(p_recipe text, p_mat text) returns double precision language sql stable as $fn$
  select coalesce((select difficulty from recipe where id = p_recipe), 0) + coalesce((mat_of(p_mat)).difficulty, 0)
$fn$;

/** Which stone the rock gives up: by weight, in table order, the rarest one part in the total. */
create or replace function roll_gem() returns text language sql volatile as $fn$
  with c as (select name, sum(weight) over (order by ord) as upto from gem_def),
       r as (select random() * (select sum(weight) from gem_def) as x)
  select c.name from c, r where c.upto > r.x order by c.upto limit 1
$fn$;

/** One swing in a few hundred brings out something nobody was mining for. */
create or replace function maybe_gem(p_world uuid, p_uid uuid, p_skill double precision, p_tool_ql double precision) returns void
  language plpgsql as $fn$
declare v_gem text; v_ql double precision;
begin
  if random() >= gem_odds() then return; end if;
  v_gem := roll_gem();
  v_ql := product_ql(p_skill, p_tool_ql);
  perform give(p_world, p_uid, 'gem', 1, v_ql, v_gem);
  perform tell(p_world, p_uid, 'Something glints in the rubble: a ' || lower(v_gem) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
end $fn$;

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
      -- The swing happened. It taught nothing at all until now.
      gained := skill_raise(p_world, p_uid, d.skill, try_gain(false));
      perform tell(p_world, p_uid, 'The rock is hard and you fail to loosen anything.', 'event');
      perform skill_said(p_world, p_uid, d.skill, gained);
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
    if random() < 0.01 then
      perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
      perform land_set_dirt(p_world, cx, cy, 0);
      perform reconcile_around(p_world, cx, cy);
      perform tell(p_world, p_uid, 'A slab breaks away of its own accord and the face drops.', 'event');
    end if;
    gained := skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'chip_corner' then
    if random() >= chip_chance() then
      gained := skill_raise(p_world, p_uid, d.skill, try_gain(false));
      perform tell(p_world, p_uid, 'You work at the corner and find no line in it. The face holds.', 'event');
      perform skill_said(p_world, p_uid, d.skill, gained);
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
    gained := skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'pack' then
    here := land_tile(p_world, tx, ty);
    perform land_set_tile(p_world, tx, ty, 2);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, case when here <> 1
      then 'You cut the turf away and tread the ground down firm.'
      else 'You pack the dirt down firmly.' end, 'event');
    gained := skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'cultivate' then
    perform land_set_tile(p_world, tx, ty, 1);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You break up the packed earth.', 'event');
    gained := skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'pave_gravel' then
    if not consume(p_world, p_uid, 'rock_shards', 1) then return; end if;
    perform land_set_tile(p_world, tx, ty, 13);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You spread the crushed rock into a gravel surface.', 'event');
    gained := skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'pave_cobble' then
    if not consume(p_world, p_uid, 'stone_brick', 1) then return; end if;
    perform land_set_tile(p_world, tx, ty, 14);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You lay the cobblestones.', 'event');
    gained := skill_raise(p_world, p_uid, d.skill, 1);

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
    gained := skill_raise(p_world, p_uid, d.skill, 1);
  end if;

  perform skill_said(p_world, p_uid, d.skill, gained);
end $function$

;

CREATE OR REPLACE FUNCTION public.slot_of(p_def text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(
    (select slot from armour_def where id = p_def),
    (select 'weapon' from weapon_def where id = p_def),
    (select 'offhand' from shield_def where id = p_def),
    (select 'jewel' from jewel_def where id = p_def),
    case when p_def = 'toolbelt' then 'belt' end)
$function$

;

CREATE OR REPLACE FUNCTION public.skill_mult(p_world uuid, p_uid uuid, p_id text)
 RETURNS double precision
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p player; m double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 1; end if;
  m := case when coalesce(p.rested, 0) > 0 then rest_mult() else 1 end;
  -- A knack earned on the way up never wears off, unlike a meal or a night's sleep.
  m := m + knack_bonus((p.knacks->>p_id)::int);
  -- And the stone you wear, worth a knack on the one trade it favours.
  m := m + coalesce((select jewel_bonus() from gem_def g
                      where g.skill = p_id and lower(g.name) = lower((worn(p_world, p_uid, 'jewel')).extra)), 0);
  -- And the reader's path is a tenth on everything, for good.
  if p_id <> meditation_skill() and walks(p_world, p_uid, 'knowledge', 1) then m := m + 0.1; end if;
  m := m * table_mul(p.nutrition);
  -- And the dish that favours this one, while it lasts.
  m := m + coalesce((select sum((b->>'bonus')::double precision)
                       from jsonb_array_elements(coalesce(p.boons, '[]'::jsonb)) b
                      where b->>'skill' = p_id
                        and (b->>'until')::double precision > world_time(p_world)), 0);
  return greatest(0.01, m);
end $function$

;

CREATE OR REPLACE FUNCTION public.perform_craft(p_world uuid, p_uid uuid, p_recipe text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare r recipe; i record; prefer bigint; mat text; hard double precision; tq double precision;
        s double precision; made_ql double precision; rare text; total double precision := 0;
        weight double precision := 0; one double precision; gained double precision;
begin
  select * into r from recipe where id = p_recipe;
  prefer := target_item(p_target);
  mat := craft_material(p_world, p_uid, p_recipe, prefer);
  s := skill_of(p_world, p_uid, r.skill);
  tq := case when r.tool is null then 0 else tool_ql(p_world, p_uid, r.tool) end;
  -- Oak and the deep metals fight the hands that shape them.
  hard := craft_hardness(p_recipe, mat);

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
    perform skill_raise(p_world, p_uid, r.skill, try_gain(false));
    perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(false, craft_head()));
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
  perform give(p_world, p_uid, r.result, r.count, made_ql, coalesce(r.extra, mat), rare, maker_mark(p_world, p_uid, rare));
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
  perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(true, craft_head()));
  perform tell(p_world, p_uid, r.done || ' (' || case when mat is not null then lower(mat) || ', ' else '' end
    || 'QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
  perform skill_said(p_world, p_uid, r.skill, gained);
end $function$

;

-- The definitions before this added two tables the API sees.
notify pgrst, 'reload schema';

select private.lock_doors();
