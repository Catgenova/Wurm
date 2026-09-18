-- A maker's mark on rare work
--
-- Asked from the island, for rare work and better. Anything that comes off
-- the bench or the anvil rare, supreme or fantastic now carries who made it,
-- and Look says so — "Made by Ivar." — in the same words on both sides. The
-- ordinary run of things stays unsigned: a mark on everything is a mark on
-- nothing.
--
-- `maker` is a column on the item, so it crosses to a browser with the rest
-- of the row and follows the thing through every hand it passes to. `give`
-- takes it beside the rarity, and a stack only takes a thing whose maker it
-- shares, so two smiths' rare nails do not become one smith's. `maker_mark`
-- is the one rule for whose name goes on: the maker's, when the thing is
-- rare at all.

alter table item add column if not exists maker text;

/** Whose mark goes on a thing made at this rarity: the maker's, when it is rare at all. */
create or replace function maker_mark(p_world uuid, p_uid uuid, p_rare text) returns text
  language sql stable as $fn$
  select case when p_rare is null then null
              else (select p.name from player p where p.world_id = p_world and p.uid = p_uid) end
$fn$;

-- The old shape would stand beside the new one and make every call ambiguous.
drop function if exists give(uuid, uuid, text, int, double precision, text, text);

CREATE OR REPLACE FUNCTION public.give(p_world uuid, p_uid uuid, p_item text, p_n integer, p_ql double precision, p_extra text DEFAULT NULL::text, p_rare text DEFAULT NULL::text, p_maker text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare stacks boolean; found bigint;
begin
  select coalesce(d.stackable, false) into stacks from item_def d where d.id = p_item;
  if stacks then
    select i.id into found from item i
    where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = p_item
      and i.extra is not distinct from p_extra and i.rare is not distinct from p_rare
      and i.maker is not distinct from p_maker
    limit 1;
    if found is not null then
      -- Quality of a stack is the average of what is in it, by the unit.
      update item set ql = (ql * count + p_ql * p_n) / (count + p_n), count = count + p_n where id = found;
      return found;
    end if;
  end if;
  insert into item (world_id, holder, holder_uid, def, ql, count, extra, rare, maker)
  values (p_world, 'player', p_uid, p_item, greatest(0, least(100, p_ql)), p_n, p_extra, p_rare, p_maker)
  returning id into found;
  return found;
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

CREATE OR REPLACE FUNCTION public.perform_forge(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p placed; it item; v_mould item; d mould_def; v_lump item; m metal_def;
        v_per double precision; v_room double precision; v_fits int; v_whole int;
        v_ql double precision; v_mould_ql double precision; v_hard double precision;
        v_rare text; v_made bigint; v_broke boolean; v_sz int[]; v_sx int; v_sy int;
        v_gained double precision; v_left double precision;
begin
  if p_action in ('fuel_oven', 'light_oven', 'put_out_oven', 'take_ashes_oven') then
    perform placed_settle((p_target->>'id')::bigint);
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;

    if p_action = 'fuel_oven' then
      select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
        and not locked and fuel_value(def) is not null
        and (target_item(p_target) is null or id = target_item(p_target))
        order by id limit 1;
      if not found then return; end if;
      v_per := fuel_value(it.def);
      v_room := greatest(0, hearth_capacity(p) - p.fuel);
      v_fits := greatest(1, least(least(coalesce((p_target->>'count')::int, 1), it.count),
                                  ceil(v_room / v_per)::int));
      if not consume(p_world, p_uid, it.def, v_fits, it.id) then return; end if;
      update placed set fuel = least(hearth_capacity(p), p.fuel + v_per * v_fits), since = now()
        where id = p.id;
      perform tell(p_world, p_uid, 'You feed '
        || case when v_fits > 1 then v_fits || ' × ' else 'a ' end
        || lower((select name from item_def where id = it.def)) || ' into the oven. '
        || oven_burns_for(least(hearth_capacity(p), p.fuel + v_per * v_fits) / placed_burn_rate(p)) || ' of fuel.', 'event');

    elsif p_action = 'light_oven' then
      update placed set lit = true, since = now() where id = p.id;
      perform tell(p_world, p_uid, 'The oven draws and the fire takes hold. '
        || oven_burns_for(p.fuel) || ' of fuel.', 'event');

    elsif p_action = 'put_out_oven' then
      update placed set lit = false, since = now() where id = p.id;
      perform tell(p_world, p_uid,
        'You rake the fire out of the oven. It will keep its heat for nobody.', 'event');

    elsif p_action = 'take_ashes_oven' then
      v_whole := floor(p.ash)::int;
      update placed set ash = p.ash - v_whole, since = now() where id = p.id;
      perform give(p_world, p_uid, 'ash', v_whole, 20);
      perform tell(p_world, p_uid, 'You rake ' || v_whole
        || case when v_whole = 1 then ' lot' else ' lots' end
        || ' of ashes out of the oven. (QL 20)', 'event');
    end if;
    return;
  end if;

  if p_action in ('candle_lantern', 'light_lantern', 'douse_lantern') then
    perform lantern_settle(target_item(p_target));
    select * into it from item where world_id = p_world and id = target_item(p_target);
    if not found then return; end if;
    if p_action = 'candle_lantern' then
      if not consume(p_world, p_uid, 'candle', 1) then return; end if;
      update item set charges = round(candle_burn(it.ql))::int, lit = false, lit_at = null
        where id = it.id;
      perform tell(p_world, p_uid, 'You set a candle in the lantern. '
        || ceil(candle_burn(it.ql) / 60) || ' minutes of it, at a guess.', 'event');
    elsif p_action = 'light_lantern' then
      -- A torch is wound and then lit; the pitch in it only starts burning at
      -- the moment it catches, so its clock starts here rather than at the bench.
      if it.def = 'torch' and candle_left(it) <= 0 then
        update item set charges = round(torch_burn(it.ql))::int where id = it.id;
        select * into it from item where id = it.id;
      end if;
      update item set lit = true, lit_at = now() where id = it.id;
      perform tell(p_world, p_uid, case when it.def = 'torch'
        then 'You touch the torch to the ' || flame_near(p_world, p_uid, it.id)
             || ' and it takes. ' || ceil(candle_left(it) / 60) || ' minutes of it, throwing '
             || held_reach(it.def, it.ql) || ' tiles.'
        else 'You take a light off the ' || flame_near(p_world, p_uid, it.id)
             || ' and the lantern throws it ' || held_reach(it.def, it.ql) || ' tiles.' end, 'event');
    else
      v_left := candle_left(it);
      update item set lit = false, lit_at = null, charges = round(v_left)::int where id = it.id;
      perform tell(p_world, p_uid, case when it.def = 'torch'
        then 'You smother the torch. ' || ceil(v_left / 60)
             || ' minutes of it left, if it will take again.'
        else 'You pinch the wick out. ' || ceil(v_left / 60) || ' minutes of candle saved.' end, 'event');
    end if;
    return;
  end if;

  if p_action = 'place_anvil' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and def = 'anvil' and not locked
      and (target_item(p_target) is null or id = target_item(p_target))
      order by id limit 1;
    if not found then return; end if;
    v_sx := least(subtiles() - anvil_subtiles(), greatest(0, coalesce((p_target->>'sx')::int, 0)));
    v_sy := least(subtiles() - anvil_subtiles(), greatest(0, coalesce((p_target->>'sy')::int, 0)));
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (p_world, 'anvil', coalesce(it.extra, 'copper'),
            (p_target->>'x')::int, (p_target->>'y')::int, v_sx, v_sy,
            (p_target->>'x')::int + (v_sx + 1.0) / subtiles(),
            (p_target->>'y')::int + (v_sy + 1.0) / subtiles(), it.ql, p_uid)
    returning * into p;
    delete from item where id = it.id;
    perform tell(p_world, p_uid, 'You set the ' || lower(anvil_name(p))
      || ' down. Bring a filled mould to it.', 'event');
    perform land_announce(p_world, p.x, p.y);
    return;
  end if;

  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
  if not found then return; end if;

  if p_action = 'pick_up_anvil' then
    perform give(p_world, p_uid, 'anvil', 1, p.ql, p.sub);
    perform tell(p_world, p_uid, 'You heave the ' || lower(anvil_name(p))
      || ' up onto your shoulder.', 'event');
    delete from placed where id = p.id;
    perform land_announce(p_world, p.x, p.y);
    return;
  end if;

  -- Smithing: the mould, the metal, the anvil and the hands, in that order.
  select * into v_mould from item where world_id = p_world
    and id = target_mould(p_target);
  select * into d from mould_def where id = v_mould.def;
  v_lump := smith_lump(p_world, p_uid, target_item(p_target));
  select * into m from metal_def where lump = v_lump.def;
  if v_mould.id is null or d.id is null or v_lump.id is null or m.id is null
     or v_lump.count < mould_lumps(d.id, m.id) then return; end if;
  if not consume(p_world, p_uid, v_lump.def, mould_lumps(d.id, m.id), v_lump.id) then return; end if;

  v_mould_ql := greatest(1, v_mould.ql - v_mould.dmg / 2);
  -- Every filling wears the mould, and a hard metal takes more out of it.
  v_broke := v_mould.dmg + mould_wear(v_mould.ql) * (1 + (mat_of(m.name)).difficulty / 30) >= 100;
  if v_broke then
    delete from item where id = v_mould.id;
  else
    update item set dmg = least(100, v_mould.dmg
        + mould_wear(v_mould.ql) * (1 + (mat_of(m.name)).difficulty / 30))
      where id = v_mould.id;
  end if;

  -- The deeper the seam it came out of, the harder it is to beat into shape.
  v_hard := d.difficulty + (mat_of(v_lump.extra)).difficulty;
  if not skill_check(skill_of(p_world, p_uid, d.skill), v_hard, anvil_ql(p),
                     mind_ease(p_world, p_uid)) then
    v_gained := skill_raise(p_world, p_uid, d.skill, try_gain(false, smith_gain()));
    perform tell(p_world, p_uid, 'The '
      || lower((select name from item_def where id = d.makes))
      || ' comes out misshapen and you throw the metal back.'
      || case when v_broke then ' The ' || lower((select name from item_def where id = v_mould.def))
                                || ' cracks through.' else '' end, 'event');
    return;
  end if;

  v_ql := smith_ql(p_world, p_uid, d.skill, v_mould_ql, v_lump.ql, anvil_ql(p));
  v_gained := skill_raise(p_world, p_uid, d.skill, try_gain(true, smith_gain()));
  v_rare := rarity_roll();
  v_made := give(p_world, p_uid, d.makes, d.per, v_ql, m.name, v_rare, maker_mark(p_world, p_uid, v_rare));
  perform journal_made(p_world, p_uid, d.makes, v_ql, d.per, v_rare);
  perform journal_note(p_world, p_uid, 'smithed');
  -- The four that come out of the deep seams, which are worth a line of their own.
  if m.id in ('adamantine', 'glimmersteel', 'mithril', 'seryll') then
    perform journal_note(p_world, p_uid, 'moonmetal');
  end if;
  if v_rare is not null then
    perform journal_note(p_world, p_uid, v_rare);
    perform tell(p_world, p_uid, rarity_word(v_rare), 'skill');
  end if;
  perform tell(p_world, p_uid, 'You beat out '
    || case when d.per > 1 then d.per || ' ' else 'a ' end
    || lower(m.name) || ' '
    || case when d.per > 1 and right(lower((select name from item_def where id = d.makes)), 1) <> 's'
            then lower((select name from item_def where id = d.makes)) || 's'
            else lower((select name from item_def where id = d.makes)) end
    || ' on the ' || lower(anvil_name(p)) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')'
    || case when v_broke then ' The ' || lower((select name from item_def where id = v_mould.def))
                              || ' cracks through and is done.'
            else ' The mould has ' || mould_uses_left(v_mould.ql, v_mould.dmg
                   + mould_wear(v_mould.ql) * (1 + (mat_of(m.name)).difficulty / 30))
                 || ' fillings left.' end, 'event');
end $function$
;

CREATE OR REPLACE FUNCTION public.examine_item_text(p_world uuid, p_uid uuid, it item)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare d item_def; m material_def; r rarity_def; v_worth double precision;
        v_skill text; v_out text;
begin
  select * into d from item_def where id = it.def;
  if not found then return 'It is nothing you have a name for.'; end if;
  m := mat_of(it.extra);
  select * into r from rarity_def where id = it.rare;
  v_worth := tool_worth(it.ql, it.dmg, it.extra, it.rare, it.bless);

  v_out := item_name(it) || ': QL ' || to_char(it.ql, 'FM990.00')
    || ', damage ' || to_char(it.dmg, 'FM990.00')
    || ', weight ' || to_char(item_weight(it), 'FM990.00') || ' kg.';
  if d.category = 'tool' and abs(v_worth - it.ql) >= 0.05 then
    v_out := v_out || ' It works as a ' || to_char(v_worth, 'FM990.0') || ' today.';
  end if;
  if d.description is not null then v_out := v_out || ' ' || d.description; end if;
  if r.id is not null then
    v_out := v_out || ' It is ' || r.id || ': better at what it is for by a '
      || case when r.boost > 1.3 then 'half' when r.boost > 1.15 then 'quarter' else 'tenth' end
      || ', slower to wear and to rot, and can be bettered ' || to_char(r.ceiling, 'FM990')
      || ' past your own skill.';
  end if;
  -- Rare work is signed.
  if it.maker is not null then v_out := v_out || ' Made by ' || it.maker || '.'; end if;
  v_skill := boon_of((select seed from world where id = p_world), it.def);
  if v_skill is not null then
    v_out := v_out || ' It favours '
      || lower(coalesce((select name from skill_def where id = v_skill), v_skill)) || '.';
  end if;
  -- What it is made of is half of what it is — when it is made of anything.
  if m.name is not null and m.note is not null then
    v_out := v_out || ' ' || m.name || ': ' || m.note;
  end if;
  return v_out;
end $function$
;

select private.lock_doors();

notify pgrst, 'reload schema';
