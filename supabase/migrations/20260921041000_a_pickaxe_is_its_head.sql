-- A pickaxe is its head
--
-- Reported from the island: *"Max ql anyone is getting from an 84ql ore is 72
-- even at 93 mining."*
--
-- They were right, and the wall was not in the mining. Trace an ore all the
-- way through and the metal reaches the last step in good order -- the vein
-- caps the swing, the smelter loses nothing, the mould and the anvil each take
-- their share -- and then `fit_pickaxe_head` throws the head away. That recipe
-- carried no `ql_from_inputs`, so `perform_craft` fell to `product_ql(s, tq)`:
-- a straight roll on *carpentry*, with a carpentry tool of nought, and not one
-- reference to the head being fitted. Seventeen recipes do this -- every tool,
-- blade and haft in the game that is finished by pushing a shaft into it --
-- so the whole of mining, smelting, pouring and forging was decorative, and
-- the ceiling on every tool anybody owned was 1.4 times their carpentry.
--
-- Two changes, and the other one is generated. The recipe rows get
-- `ql_from_inputs`, which puts them on the rule the five alloys have always
-- taken: what goes in decides what comes out, and the hands decide how much of
-- it survives -- 78% of it at no skill, 99.7% at a hundred.
--
-- This is the other half: that rule weighed the inputs *by the count*, which
-- was the same answer for every recipe that had ever asked it, because a
-- crucible of bronze is lumps and lumps all weigh the same. It is a very
-- different answer for a head, a shaft and two nails, where counting makes the
-- nails worth half the pickaxe. So it weighs by mass, and a pickaxe is its
-- head: 1.2 kg of it against a 1 kg shaft and 20 grams of nails.
--
-- The five alloys are untouched by this -- copper and tin both weigh a
-- kilogram, silver and gold both weigh a hundred grams -- so mass and count
-- divide them identically and no existing recipe changes its answer.

create or replace function perform_craft(p_world uuid, p_uid uuid, p_recipe text, p_target jsonb)
  returns void language plpgsql as $$
declare r recipe; i record; prefer bigint; mat text; hard double precision; tq double precision;
        s double precision; made_ql double precision; rare text; total double precision := 0;
        weight double precision := 0; one double precision; gained double precision;
        share double precision;
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
        -- By mass, not by the count. Two nails weigh two hundredths of a
        -- kilogram between them and do not get to decide what a pickaxe is.
        share := coalesce((select d.weight from item_def d where d.id = i.item), 1) * i.count;
        total := total + one * share;
        weight := weight + share;
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
  if rare is not null then perform tell(p_world, p_uid, rarity_word(rare), 'skill'); end if;
  for i in select g.item, g.count from recipe_gives g where g.recipe = p_recipe and g.kind = 'return' loop
    perform give(p_world, p_uid, i.item, i.count, 20);
  end loop;

  gained := skill_raise(p_world, p_uid, r.skill, 1);
  -- Working a thing out with your hands is what sharpens the head.
  perform skill_raise(p_world, p_uid, 'mind_logic', 0.25);
  perform tell(p_world, p_uid, r.done || ' (' || case when mat is not null then lower(mat) || ', ' else '' end
    || 'QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
  if gained > 0 then
    perform tell(p_world, p_uid,
      initcap(replace(r.skill, '_', ' ')) || ' increased by ' || to_char(gained, 'FM0.0000')
      || ' to ' || to_char(skill_of(p_world, p_uid, r.skill), 'FM990.0000') || '.', 'skill');
  end if;
end $$;


select private.lock_doors();
