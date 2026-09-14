-- Mining, packing, cultivating, paving, and putting dirt back.

create or replace function act_ported(p_action text) returns boolean language sql stable as $$
  select p_action in (
      'dig', 'mine', 'chip_corner', 'pack', 'cultivate',
      'pave_gravel', 'pave_cobble', 'drop_dirt_here',
      'build_campfire', 'light_campfire', 'put_out_campfire', 'fuel_campfire',
      'take_ashes_fire', 'take_apart_campfire',
      'place_smelter', 'pick_up_smelter', 'light_smelter', 'fuel_smelter',
      'damp_smelter', 'take_ashes_smelter',
      'place_furniture', 'pick_up_furniture')
      or exists (select 1 from recipe where id = p_action)
$$;

/** Why the ground refuses to be worked. */
create or replace function terrain_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql stable as $$
declare cx int; cy int; tx int; ty int; t tile_def; r rock_def; mining double precision; here int;
begin
  cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
  tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;

  if p_action in ('mine', 'chip_corner') then
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    if not t.mineable then return 'There is no rock face there to work.'; end if;
    if rock_height(p_world, cx, cy) <= 0 then
      return case when p_action = 'mine' then 'You cannot mine below the water level.'
                  else 'You cannot cut the rock below the water level.' end;
    end if;
    -- A seam only gives up its metal to somebody who knows how to take it.
    if land_tile(p_world, tx, ty) = 4 then
      r := bedrock_at(p_world, tx, ty);
      mining := skill_of(p_world, p_uid, 'mining');
      if r.ore and mining < r.level then
        -- `FM990.9` leaves "5." on a whole number, which reads as a typo in the
        -- middle of a sentence. The browser prints the number as it is.
        return r.name || ' needs mining ' || rtrim(rtrim(to_char(r.level, 'FM990.99'), '0'), '.')
          || ' to work. Yours is ' || to_char(mining, 'FM990.0') || '.';
      end if;
    end if;
    return null;
  end if;

  here := land_tile(p_world, tx, ty);
  if p_action = 'pack' then
    if not packable(here) then return 'That ground will not pack down.'; end if;
  elsif p_action = 'cultivate' then
    if here <> 2 then return 'Only packed earth can be broken up.'; end if;
  elsif p_action in ('pave_gravel', 'pave_cobble') then
    if here <> 2 then return 'Pack the ground down before paving it.'; end if;
    if p_action = 'pave_gravel' and pack_count(p_world, p_uid, 'rock_shards') < 1 then
      return 'You need rock shards to pave with gravel.';
    end if;
    if p_action = 'pave_cobble' and pack_count(p_world, p_uid, 'stone_brick') < 1 then
      return 'You need a stone brick to lay cobblestone.';
    end if;
  elsif p_action = 'drop_dirt_here' then
    if pack_count(p_world, p_uid, 'dirt') < 1 then return 'You have no dirt to drop.'; end if;
    -- The corner nearest whoever is standing there, as the game reckons it.
    select round(x)::int, round(y)::int into cx, cy from player where world_id = p_world and uid = p_uid;
    if corner_slope_after(p_world, cx, cy, 1) > max_dig_slope(p_world, p_uid) then
      return 'The slope would be too steep for your digging skill.';
    end if;
  end if;
  return null;
end $$;

/**
 * The slope around a corner if it were moved.
 *
 * Worked out rather than tried: the browser nudges the height, measures, and
 * puts it back, which is fine when nobody else is looking at the array. Here
 * somebody else always might be, so the four tiles are measured with the new
 * height substituted in place.
 */
create or replace function corner_slope_after(p_world uuid, p_cx int, p_cy int, p_delta int)
  returns int language sql stable as $$
  select coalesce(max(greatest(a, b, c, d) - least(a, b, c, d)), 0)
  from generate_series(p_cx - 1, p_cx) gx, generate_series(p_cy - 1, p_cy) gy,
  lateral (select
    land_height(p_world, gx, gy) + case when gx = p_cx and gy = p_cy then p_delta else 0 end a,
    land_height(p_world, gx + 1, gy) + case when gx + 1 = p_cx and gy = p_cy then p_delta else 0 end b,
    land_height(p_world, gx + 1, gy + 1) + case when gx + 1 = p_cx and gy + 1 = p_cy then p_delta else 0 end c,
    land_height(p_world, gx, gy + 1) + case when gx = p_cx and gy + 1 = p_cy then p_delta else 0 end d) q
  where gx >= 0 and gy >= 0
$$;

create or replace function perform_terrain(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns void language plpgsql as $$
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
      perform tell(p_world, p_uid, 'The rock is hard and you fail to loosen anything.', 'event');
      return;
    end if;
    r := bedrock_at(p_world, tx, ty);
    yields := case when land_tile(p_world, tx, ty) = 4 then r.yields else 'rock_shards' end;
    made_ql := least(ore_max_ql((select seed from world where id = p_world), tx, ty), product_ql(s, tq));
    perform give(p_world, p_uid, yields, 1, made_ql);
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
    gained := skill_raise(p_world, p_uid, 'mining', 1);

  elsif p_action = 'chip_corner' then
    if random() >= 0.25 then
      perform tell(p_world, p_uid, 'You work at the corner and find no line in it. The face holds.', 'event');
      return;
    end if;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
    perform land_set_dirt(p_world, cx, cy, 0);
    perform reconcile_around(p_world, cx, cy);
    r := bedrock_at(p_world, tx, ty);
    yields := case when land_tile(p_world, tx, ty) = 4 then r.yields else 'rock_shards' end;
    made_ql := least(ore_max_ql((select seed from world where id = p_world), tx, ty), product_ql(s, tq));
    perform give(p_world, p_uid, yields, 1, made_ql);
    perform tell(p_world, p_uid, 'The corner breaks away and drops a step. You gather the '
      || lower((select coalesce(name, yields) from item_def where id = yields))
      || '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    gained := skill_raise(p_world, p_uid, 'mining', 1);

  elsif p_action = 'pack' then
    here := land_tile(p_world, tx, ty);
    perform land_set_tile(p_world, tx, ty, 2);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, case when here <> 1
      then 'You cut the turf away and tread the ground down firm.'
      else 'You pack the dirt down firmly.' end, 'event');
    gained := skill_raise(p_world, p_uid, 'digging', 1);

  elsif p_action = 'cultivate' then
    perform land_set_tile(p_world, tx, ty, 1);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You break up the packed earth.', 'event');
    gained := skill_raise(p_world, p_uid, 'digging', 1);

  elsif p_action = 'pave_gravel' then
    if not consume(p_world, p_uid, 'rock_shards', 1) then return; end if;
    perform land_set_tile(p_world, tx, ty, 13);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You spread the crushed rock into a gravel surface.', 'event');
    gained := skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'pave_cobble' then
    if not consume(p_world, p_uid, 'stone_brick', 1) then return; end if;
    perform land_set_tile(p_world, tx, ty, 14);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You lay the cobblestones.', 'event');
    gained := skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'drop_dirt_here' then
    if not consume(p_world, p_uid, 'dirt', 1) then return; end if;
    select round(x)::int, round(y)::int into cx, cy from player where world_id = p_world and uid = p_uid;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) + 1);
    perform land_set_dirt(p_world, cx, cy, land_dirt(p_world, cx, cy) + 1);
    perform reconcile_around(p_world, cx, cy);
    perform tell(p_world, p_uid, 'You drop the dirt at your feet, raising the ground.', 'event');
    gained := skill_raise(p_world, p_uid, 'digging', 1);
  end if;

  if gained > 0 and d.skill is not null then
    perform tell(p_world, p_uid,
      initcap(replace(d.skill, '_', ' ')) || ' increased by ' || to_char(gained, 'FM0.0000')
      || ' to ' || to_char(skill_of(p_world, p_uid, d.skill), 'FM990.0000') || '.', 'skill');
  end if;
end $$;

select private.lock_doors();
