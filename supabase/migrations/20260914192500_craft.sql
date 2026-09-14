-- Making things: two hundred and five actions, one performer.
--
-- The count was the frightening part and it should not have been. Most of what
-- a person does on this island is a recipe with a label on it — take these
-- things, hold that tool, stand near that fire, roll against this difficulty,
-- be left with that — and a recipe is a row. So none of them needs a line of
-- its own here. What follows is the doing of *any* of them, read out of
-- `recipe` and `recipe_input`, which are generated from the same TypeScript
-- the browser reads.
--
-- Ported faithfully from `recipeAction` in src/game/recipes.ts, including the
-- parts that are easy to leave out and would be missed: a failed batch eats
-- its inputs when the recipe says so but hands back the bucket it was mixed
-- in; quality comes from the inputs for the things that are mixed rather than
-- made; and once in a hundred a thing comes off the bench better than the
-- hands that made it had any right to produce.

/* `action_def.range` is a real now — a fishing rod reaches three and a half
 * tiles — and this was written when the only action had a range of one. */
drop function if exists in_reach(double precision, double precision, jsonb, boolean, int);
create or replace function in_reach(p_px double precision, p_py double precision,
                                    p_target jsonb, p_corner boolean, p_range real)
  returns boolean language sql immutable as $$
  select case
    when p_target->>'kind' = 'item' then true
    when p_corner then
      floor(p_px) between (p_target->>'cx')::int - 1 and (p_target->>'cx')::int
      and floor(p_py) between (p_target->>'cy')::int - 1 and (p_target->>'cy')::int
    else
      greatest(abs(floor(p_px) - (p_target->>'x')::int), abs(floor(p_py) - (p_target->>'y')::int))
        <= coalesce(p_range, 1)
    end
$$;

/** How many of a thing somebody is carrying, of a given material or of any. */
create or replace function pack_count(p_world uuid, p_uid uuid, p_item text, p_mat text default null)
  returns int language sql stable as $$
  select coalesce(sum(i.count), 0)::int from item i
  where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
    and i.def = p_item and (p_mat is null or i.extra is not distinct from p_mat)
$$;

/**
 * Use up `n` of something, taking from the clicked stack first.
 *
 * Once a material has been settled on, only stock of that material is drawn
 * from for the inputs that have enough of it — which is what stops a chest
 * being half oak and half pine. Where there is not enough of the chosen
 * material, that input falls back to anything, because refusing to finish a
 * chest over the last nail would be worse than a mixed one.
 */
create or replace function consume(p_world uuid, p_uid uuid, p_item text, p_n int,
                                   p_prefer bigint default null, p_mat text default null)
  returns boolean language plpgsql as $$
declare left_to_take int := p_n; r record; take int; only_mat boolean;
begin
  only_mat := p_mat is not null and pack_count(p_world, p_uid, p_item, p_mat) >= p_n;
  if pack_count(p_world, p_uid, p_item, case when only_mat then p_mat end) < p_n then return false; end if;
  for r in
    select i.id, i.count from item i
    where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = p_item
      and (not only_mat or i.extra is not distinct from p_mat)
    order by (i.id = p_prefer) desc, i.id
  loop
    exit when left_to_take <= 0;
    take := least(left_to_take, r.count);
    if take >= r.count then delete from item where id = r.id;
    else update item set count = count - take where id = r.id; end if;
    left_to_take := left_to_take - take;
  end loop;
  return left_to_take = 0;
end $$;

/** Put something in somebody's hands, merging into a stack where it stacks. */
create or replace function give(p_world uuid, p_uid uuid, p_item text, p_n int,
                                p_ql double precision, p_extra text default null, p_rare text default null)
  returns bigint language plpgsql as $$
declare stacks boolean; found bigint;
begin
  select coalesce(d.stackable, false) into stacks from item_def d where d.id = p_item;
  if stacks then
    select i.id into found from item i
    where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = p_item
      and i.extra is not distinct from p_extra and i.rare is not distinct from p_rare
    limit 1;
    if found is not null then
      -- Quality of a stack is the average of what is in it, by the unit.
      update item set ql = (ql * count + p_ql * p_n) / (count + p_n), count = count + p_n where id = found;
      return found;
    end if;
  end if;
  insert into item (world_id, holder, holder_uid, def, ql, count, extra, rare)
  values (p_world, 'player', p_uid, p_item, greatest(0, least(100, p_ql)), p_n, p_extra, p_rare)
  returning id into found;
  return found;
end $$;

/**
 * Now and again a thing comes off the bench better than it had any right to
 * be. Nothing brings it on, and nothing here is allowed to know it is coming:
 * the roll happens on the island, after the work, where no client can watch.
 */
create or replace function rarity_roll() returns text language plpgsql volatile as $$
declare step int := 0; odds double precision[] := array[0.01, 0.1, 0.1]; o double precision;
begin
  foreach o in array odds loop
    exit when random() >= o;
    step := step + 1;
  end loop;
  return (array[null, 'rare', 'supreme', 'fantastic'])[step + 1];
end $$;

create or replace function rarity_word(p_rare text) returns text language sql immutable as $$
  select case p_rare
    when 'rare' then 'Something in the grain runs true and it comes out better than it had any right to be.'
    when 'supreme' then 'Your hands know what to do before you do, and what they leave is not far off perfect.'
    when 'fantastic' then 'For a moment the whole of it is obvious, and what you set down is the finest thing you will ever make.'
    end
$$;

/**
 * Whether you are standing at the thing a recipe needs.
 *
 * Always no, for now, and it says so in the recipe's own words rather than
 * pretending the recipe does not exist. Fires, smelters, spindles and looms
 * are things placed on the ground, and nothing is placed on the ground yet —
 * so the hundred-odd recipes that want one are known, listed and honestly
 * refused until they are.
 */
create or replace function at_station(p_world uuid, p_uid uuid, p_station text)
  returns boolean language sql stable as $$ select false $$;

create or replace function station_name(p_station text) returns text language sql immutable as $$
  select case p_station
    when 'campfire' then 'lit campfire' when 'smelter' then 'hot smelter'
    when 'spindle' then 'spindle' when 'loom' then 'loom' else p_station end
$$;

/** What a recipe would be made of: the material of what is going into it. */
create or replace function craft_material(p_world uuid, p_uid uuid, p_recipe text, p_prefer bigint)
  returns text language plpgsql stable as $$
declare wants text; first_item text; mat text;
begin
  select material into wants from recipe where id = p_recipe;
  if wants is null then return null; end if;
  select item into first_item from recipe_input where recipe = p_recipe order by ord limit 1;
  -- The clicked stack decides, when it is one of the things going in.
  select i.extra into mat from item i
    where i.id = p_prefer and i.world_id = p_world and i.holder_uid = p_uid
      and i.def in (select item from recipe_input where recipe = p_recipe);
  if mat is not null then return mat; end if;
  select i.extra into mat from item i
    where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = first_item
      and i.extra is not null
    order by i.id limit 1;
  return mat;
end $$;

/** Why a recipe cannot be made right now, in the words it should be refused in. */
create or replace function craft_refusal(p_world uuid, p_uid uuid, p_recipe text, p_prefer bigint)
  returns text language plpgsql stable as $$
declare r recipe; i record; mat text; have int;
begin
  select * into r from recipe where id = p_recipe;
  if not found then return null; end if;
  if r.tool is not null and tool_ql(p_world, p_uid, r.tool) <= 0 then
    return 'You need a ' || lower((select coalesce(name, r.tool) from item_def where id = r.tool)) || '.';
  end if;
  if r.station is not null and not at_station(p_world, p_uid, r.station) then
    return 'You need to stand at a ' || station_name(r.station) || '.';
  end if;
  mat := craft_material(p_world, p_uid, p_recipe, p_prefer);
  for i in select * from recipe_input where recipe = p_recipe order by ord loop
    have := greatest(pack_count(p_world, p_uid, i.item, mat), pack_count(p_world, p_uid, i.item));
    if have < i.count then
      return (select coalesce(name, r.result) from item_def where id = r.result)
        || ' takes ' || i.count || ' ' || lower((select coalesce(name, i.item) from item_def where id = i.item))
        || case when i.count = 1 then '' else 's' end || '.';
    end if;
  end loop;
  return null;
end $$;

/** One go at a recipe. */
create or replace function perform_craft(p_world uuid, p_uid uuid, p_recipe text, p_target jsonb)
  returns void language plpgsql as $$
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
