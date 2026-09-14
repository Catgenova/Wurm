-- Felling, foraging, botanizing, and filling a shovel off a bed.

create or replace function act_ported(p_action text) returns boolean language sql stable as $$
  select p_action in (
      'dig', 'mine', 'chip_corner', 'pack', 'cultivate',
      'pave_gravel', 'pave_cobble', 'drop_dirt_here',
      'cut_down', 'forage', 'botanize', 'collect',
      'build_campfire', 'light_campfire', 'put_out_campfire', 'fuel_campfire',
      'take_ashes_fire', 'take_apart_campfire',
      'place_smelter', 'pick_up_smelter', 'light_smelter', 'fuel_smelter',
      'damp_smelter', 'take_ashes_smelter',
      'place_furniture', 'pick_up_furniture')
      or exists (select 1 from recipe where id = p_action)
$$;

/**
 * A tile's number, by its name.
 *
 * The numbers are storage — a tile is written down as one, so the list may
 * only be appended to — but they are a poor thing to hand-write. `Tree` was
 * typed as 3 here, which is Sand, and cutting down a tree became cutting down
 * a beach. Looked up, it cannot be got wrong.
 */
create or replace function tile_id(p_name text) returns int language sql stable as $$
  select id from tile_def where name = p_name
$$;

create or replace function gather_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql stable as $$
declare tx int; ty int; here int; t tile_def;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  here := land_tile(p_world, tx, ty);
  select * into t from tile_def where id = here;

  if p_action = 'cut_down' then
    -- It may have come down since this was asked for; do not swing at air.
    if here not in (tile_id('Tree'), tile_id('Bush')) then return 'There is nothing standing here to cut down.'; end if;
  elsif p_action = 'forage' then
    if not t.forage then return 'Nothing grows here worth looking through.'; end if;
    if is_foraged(p_world, tx, ty, 'forage') then return 'This spot has been picked clean for now.'; end if;
  elsif p_action = 'botanize' then
    if not t.botanize then return 'Nothing grows here worth looking through.'; end if;
    if is_foraged(p_world, tx, ty, 'botanize') then return 'This spot has been picked clean for now.'; end if;
  elsif p_action = 'collect' then
    if not t.collect then return 'There is no bed of anything here.'; end if;
  end if;
  return null;
end $$;

create or replace function perform_gather(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns void language plpgsql as $$
declare d action_def; tx int; ty int; here int; data int; t tile_def; tool_id bigint;
        s double precision; tq double precision; made_ql double precision;
        species int; logs int; tree tree_def; gained double precision;
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
      perform tell(p_world, p_uid, 'Your hatchet glances off and you fail to make headway.', 'event');
      return;
    end if;
    if here = tile_id('Bush') then
      perform land_set_tile(p_world, tx, ty, tile_id('Grass'));
      perform land_set_data(p_world, tx, ty, 0);
      perform land_announce(p_world, tx, ty);
      perform tell(p_world, p_uid, 'You hack the bush down.', 'event');
    else
      species := tree_species(data);
      select * into tree from tree_def where id = species;
      -- An old tree is worth one log more than a grown one.
      logs := tree.logs + case when tree_age(data) = 2 then 1 else 0 end;
      perform land_set_tile(p_world, tx, ty, tile_id('Grass'));
      perform land_set_data(p_world, tx, ty, 0);
      perform land_announce(p_world, tx, ty);
      made_ql := product_ql(s, tq);
      perform give(p_world, p_uid, 'log', logs, made_ql, tree.name);
      perform tell(p_world, p_uid, 'The ' || lower(tree.name) || ' tree falls. You get ' || logs
        || case when logs = 1 then ' log' else ' logs' end || '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
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
    gained := skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'collect' then
    yields := t.dig_yield;
    if yields is null then return; end if;
    if not skill_check(s, d.difficulty, tq) then
      perform tell(p_world, p_uid, 'Your shovel comes up with nothing but a smear of '
        || lower(t.name) || '.', 'event');
      return;
    end if;
    made_ql := product_ql(s, tq);
    perform give(p_world, p_uid, yields, 1, made_ql);
    perform tell(p_world, p_uid, 'You fill a shovel with '
      || lower((select coalesce(name, yields) from item_def where id = yields))
      || ' off the top of the bed. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    gained := skill_raise(p_world, p_uid, 'digging', 1);
  end if;

  if gained > 0 and d.skill is not null then
    perform tell(p_world, p_uid,
      initcap(replace(d.skill, '_', ' ')) || ' increased by ' || to_char(gained, 'FM0.0000')
      || ' to ' || to_char(skill_of(p_world, p_uid, d.skill), 'FM990.0000') || '.', 'skill');
  end if;
end $$;

select private.lock_doors();
