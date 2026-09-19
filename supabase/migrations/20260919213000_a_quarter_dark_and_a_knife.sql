/*
 * A quarter of the cycle dark, seed that does not stay in a worker's cheeks,
 * and a way to put one of your own down.
 *
 * Three asks off one message. The first is arithmetic: the night was very
 * nearly half the day and is now a quarter of it. The second is a farm hand
 * that harvested all season and put nothing but the crop in the crate. The
 * third is an action that did not exist: a wildermon you keep could only be
 * killed by fighting it, blow by blow, like something wild.
 */

/*
 * Three quarters day, one quarter night.
 *
 * Reported as "on the full day cycle, it shouldn't be half night half day".
 * It was not half, quite — dark from about ten to eight in the evening until
 * about six minutes past six in the morning, which is ten hours and a bit of
 * the twenty-four, or forty-two per cent. Near enough to half to be read as
 * half, and far too much of it to spend holding a lantern.
 *
 * Dawn moves to three and dusk to nine in the evening: eighteen hours between
 * the two, six the other way round, and noon sitting exactly between them,
 * which the old six-to-eight never did. Counted the way the browser counts it
 * — anything past darkness 0.45 — night runs from about ten to nine until
 * about six minutes past three, six hours and a quarter of the twenty-four.
 *
 * The hours themselves are generated from the browser's own `DAWN` and
 * `DUSK`, as `dawn_hour()` already was and `dusk_hour()` now is. This
 * function held 7, 19, 21 and 5 written out by hand, which is the same bug
 * `hour_of_day` had when it held 1440: the two sides could drift and nothing
 * would say so. It reads the generated pair now, so moving the constants
 * moves both halves at once.
 */
create or replace function darkness(p_world uuid) returns double precision
  language sql stable as $$
  select case
    when h >= dawn_hour() + 1 and h <= dusk_hour() - 1 then 0
    when h >= dusk_hour() + 1 or h <= dawn_hour() - 1 then 1
    when h > 12 then least(1, greatest(0, (h - (dusk_hour() - 1)) / 2))
    else least(1, greatest(0, (dawn_hour() + 1 - h) / 2)) end
  from (select hour_of_day(p_world) as h) q
$$;

/* And one more thing you may do to a wildermon of your own. */
create or replace function creature_action(p_action text) returns boolean
  language sql immutable as $$
  select p_action in ('examine_creature', 'tame', 'feed', 'groom', 'shear', 'milk_creature',
                      'set_stance', 'rename_creature', 'take_creature', 'store_creature',
                      'release_creature', 'cull_creature', 'assign_deed')
$$;

-- creature_refusal: one more thing you may do, and the two states that stop it.
CREATE OR REPLACE FUNCTION public.creature_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; food text; held int; working int; cap int;
begin
  -- Walked forward before it is looked at: where it was is not where it is.
  perform creature_settle(p_world, (p_target->>'id')::int);
  c := target_creature(p_world, p_target);
  if c.world_id is null then return 'It is gone.'; end if;
  select * into d from species_def where id = c.species;

  if p_action not in ('examine_creature', 'assign_deed')
     and not creature_in_reach(p_world, p_uid, c) then
    return case when c.mode = 'wild' then 'The ' || lower(d.name) || ' is not close enough.'
                else 'Stand next to ' || c.name || '.' end;
  end if;

  if p_action = 'tame' then
    if d.monster then
      return 'A ' || lower(d.name) || ' is not a wildermon. There is nothing to be done with it but kill it.';
    end if;
    if c.mode <> 'wild' then return c.name || ' is already yours.'; end if;
    if skill_of(p_world, p_uid, 'taming') < d.tame_level then
      return 'You need taming ' || to_char(d.tame_level, 'FM990.#') || ' to try.';
    end if;
    if bait_in_pack(p_world, p_uid, c.species) is null then
      return d.name || 's take ' || diet_text(c.species) || '. Bring some.';
    end if;
    if companion_of(p_world, p_uid) is not null and (my_deed(p_world, p_uid)).world_id is null then
      return 'You already have a companion and no settlement to keep another.';
    end if;
    return null;

  elsif p_action = 'assign_deed' then
    if c.mode = 'wild' then return 'It is not yours to set to work.'; end if;
    if (my_deed(p_world, p_uid)).world_id is null then
      return 'You have no settlement to assign it to.';
    end if;
    if d.gathers is null then return 'A ' || lower(d.name) || ' has no trade to be set to.'; end if;
    -- A trade asked for by name has to be one of its own.
    if nullif(p_target->>'job', '') is not null
       and not (p_target->>'job' = d.gathers or p_target->>'job' = any(coalesce(d.trades, '{}'::text[]))) then
      return 'A ' || lower(d.name) || ' cannot be set to that.';
    end if;
    if not worker_job_ported(coalesce(nullif(p_target->>'job', ''), d.gathers)) then
      return 'Nobody has taught this island what '
        || (select plain from gather_def where id = coalesce(nullif(p_target->>'job', ''), d.gathers))
        || ' looks like yet.';
    end if;
    if c.mode <> 'deed' then
      working := workers_on_deed(p_world, p_uid);
      cap := worker_cap(p_world, p_uid);
      if working >= cap then
        return (my_deed(p_world, p_uid)).name || ' has work for ' || cap
          || ' wildermon at level ' || cap || '. Upgrade the settlement to take on more.';
      end if;
    end if;
    return null;

  elsif p_action = 'feed' then
    if c.mode not in ('active', 'deed') then return 'It is not yours to feed.'; end if;
    if bait_in_pack(p_world, p_uid, c.species) is null then
      return 'It eats ' || diet_text(c.species) || '.';
    end if;
    return null;

  elsif p_action = 'groom' then
    if d.monster then return 'Not that. Not ever.'; end if;
    if c.mode = 'wild' then return 'It is not yours to brush.'; end if;
    if pack_count(p_world, p_uid, 'brush') <= 0 then return 'You need a brush.'; end if;
    if c.care >= 0.995 then return c.name || ' has been brushed to a shine already.'; end if;
    return null;

  elsif p_action = 'shear' then
    if d.fleece is null then return 'There is nothing on it worth shearing.'; end if;
    if c.mode = 'wild' then return 'Tame it first; it will not stand still for you otherwise.'; end if;
    if pack_count(p_world, p_uid, 'carving_knife') <= 0 then return 'You need a knife to shear with.'; end if;
    if c.fleece < 0.35 then
      return c.name || ' has hardly any '
        || case when d.shear_yield = 'feather' then 'feathers' else 'fleece' end || ' back yet.';
    end if;
    return null;

  elsif p_action = 'milk_creature' then
    if not d.milk then return 'That is not something you milk.'; end if;
    if c.mode in ('wild', 'stored') then return 'It is not yours to milk.'; end if;
    if pack_count(p_world, p_uid, 'bucket') <= 0 then return 'You need an empty bucket.'; end if;
    if c.sex <> 'female' then return c.name || ' is male. Nothing is coming out of him.'; end if;
    if c.fleece < 0.4 then return c.name || ' has nothing to give yet.'; end if;
    return null;

  elsif p_action = 'set_stance' then
    if c.mode <> 'active' then return 'Only a companion takes orders like that.'; end if;
    if coalesce(p_target->>'stance', '') not in ('passive', 'defensive', 'aggressive') then
      return 'Passive, defensive or aggressive.';
    end if;
    return null;

  elsif p_action = 'rename_creature' then
    if c.mode = 'wild' then return 'It is not yours to name.'; end if;
    if nullif(btrim(coalesce(p_target->>'name', '')), '') is null then return 'Choose a name.'; end if;
    return null;

  elsif p_action = 'take_creature' then
    if c.mode not in ('deed', 'stored') then return 'It is already with you.'; end if;
    held := companion_of(p_world, p_uid);
    if held is not null and (my_deed(p_world, p_uid)).world_id is null then
      return 'Nowhere to keep your current companion.';
    end if;
    return null;

  elsif p_action = 'store_creature' then
    if c.mode not in ('active', 'deed') then return 'It is already at the token.'; end if;
    if (my_deed(p_world, p_uid)).world_id is null then
      return 'You have no settlement token to keep it at.';
    end if;
    return null;

  elsif p_action = 'release_creature' then
    if c.mode = 'wild' then return 'It is already wild.'; end if;
    return null;

  elsif p_action = 'cull_creature' then
    -- Only your own, and only one that is not in the traces or under you when
    -- you ask: both of those are a mess this does not have to make.
    if c.mode = 'wild' then return 'That one is nobody''s. Fight it if you mean it.'; end if;
    if c.hitched_to is not null then return c.name || ' is in the traces. Take it out first.'; end if;
    if c.rider is not null then return 'Get down off ' || c.name || ' first.'; end if;
    return null;
  end if;
  return null;
end $function$;

-- perform_creature: culling one you keep.
CREATE OR REPLACE FUNCTION public.perform_creature(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; a age_def; food text; n int; made_ql double precision;
        gained double precision; chance double precision; warm double precision; nm text;
        held int; brush_id bigint; top double precision; before double precision; skill double precision;
        dd deed;
begin
  c := target_creature(p_world, p_target);
  if c.world_id is null then return; end if;
  select * into d from species_def where id = c.species;
  a := age_row(c.born);

  if p_action = 'examine_creature' then
    if c.mode = 'wild' and d.monster then
      perform tell(p_world, p_uid, 'A ' || lower(d.name) || ': ' || d.description
        || ' It has ' || ceil(c.health) || ' of ' || max_health(c) || ' in it and hits for '
        || to_char(attack_of(c), 'FM990') || '. It cannot be tamed. Kill it and butcher it, or keep well clear.', 'error');
    elsif c.mode = 'wild' then
      warm := coax_bonus(c);
      perform tell(p_world, p_uid, 'A wild ' || lower(d.name) || ': ' || d.description
        || ' It eats ' || diet_text(c.species) || '.'
        || case when warm > 0 then ' It has taken ' ||
             case when c.coaxed = 1 then 'an offering' else c.coaxed || ' offerings' end
             || ' from your hand and is ' || to_char(warm * 100, 'FM990') || '% readier for the next.'
           else '' end
        || ' You would have to tame it to learn more.', 'event');
    else
      perform tell(p_world, p_uid, c.name || ' (' || c.sex || ' ' || lower(d.name) || ', ' || a.name
        || '): ' || d.description || ' Level ' || creature_level(c.skills)
        || '. Health ' || ceil(c.health) || '/' || max_health(c) || '. It is ' || care_word(c.care)
        || ' and carries ' || trait_names(c.traits) || '. '
        || case when c.hunger < 0.3 then 'It looks hungry.' when c.hunger < 0.6 then 'It could eat.'
                else 'It looks well fed.' end
        || ' It eats ' || diet_text(c.species) || '.', 'event');
    end if;

  elsif p_action = 'tame' then
    food := bait_in_pack(p_world, p_uid, c.species);
    if food is null or not consume(p_world, p_uid, food, 1) then return; end if;
    chance := tame_chance(p_world, p_uid, c);
    update creature set hunger = least(1, hunger + 0.25) where world_id = p_world and id = c.id;
    if random() < chance then
      held := companion_of(p_world, p_uid);
      update creature set
          mode = case when held is null then 'active' else 'stored' end,
          stance = 'defensive', keeper = p_uid, coaxed = 0, coaxed_at = null
        where world_id = p_world and id = c.id;
      perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' takes the '
        || material_name(food, 1) || ' from your hand and trusts you. '
        || case when held is null then c.name || ' now follows you.'
             else 'As you already travel with a companion, it is kept at the token of '
                  || coalesce((my_deed(p_world, p_uid)).name, 'your settlement') || '.' end, 'system');
      perform journal_note(p_world, p_uid, 'tamed');
      perform skill_told(p_world, p_uid, 'taming', try_gain(true, tame_gain()));
      perform skill_told(p_world, p_uid, 'soul_strength', try_gain(true, tame_nerve()));
    else
      -- It refused, but it stayed for the offering, and that is worth
      -- something to the next one.
      update creature set coaxed = coaxed + 1, coaxed_at = now()
        where world_id = p_world and id = c.id returning * into c;
      warm := coax_bonus(c);
      perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' '
        || replace(d.tame_fail, '{food}', material_name(food, 1)) || '.'
        -- No ceiling on it any more, so nothing here says there is one: this
        -- read "as used to you as it will get" from the fourth offering on,
        -- which was true then and is not now.
        || case when warm > 0 then ' It is growing used to you: '
             || to_char(warm * 100, 'FM990') || '% readier than the first time.'
           else '' end, 'event');
      perform skill_told(p_world, p_uid, 'taming', try_gain(false, tame_gain()));
      perform skill_told(p_world, p_uid, 'soul_strength', try_gain(false, tame_nerve()));
    end if;

  elsif p_action = 'feed' then
    food := bait_in_pack(p_world, p_uid, c.species);
    if food is null or not consume(p_world, p_uid, food, 1) then return; end if;
    update creature set hunger = least(1, hunger + 0.5) where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' gobbles up the ' || material_name(food, 1) || '.', 'event');

  elsif p_action = 'groom' then
    select i.id into brush_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'brush'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    skill := skill_of(p_world, p_uid, 'animal_husbandry');
    before := c.care;
    top := max_health(c);
    update creature set
        care = least(1, care + 0.18 + (skill / 100) * 0.34
                          + (least(100, tool_ql(p_world, p_uid, 'brush')) / 100) * 0.22),
        -- A brushing is also a looking-over: it finds the small hurts.
        health = least(top, health + top * 0.06)
      where world_id = p_world and id = c.id returning * into c;
    if brush_id is not null then perform wear_tool(brush_id, 3); end if;
    perform journal_note(p_world, p_uid, 'groom');
    if c.care >= 0.995 then perform journal_note(p_world, p_uid, 'groomfull'); end if;
    gained := skill_told(p_world, p_uid, 'animal_husbandry', 0.4);
    perform tell(p_world, p_uid, case when before < 0.12 and c.care >= 0.12
        then 'You work the dust out of ' || c.name || '''s coat. It leans into the brush. ('
        else 'You brush ' || c.name || ' down. (' end || care_word(c.care) || ')', 'event');

  elsif p_action = 'shear' then
    -- A full fleece is three, a half-grown one is one, and quality follows the fleece.
    n := greatest(1, round(c.fleece * case when coalesce(d.shear_yield, 'wool') = 'wool' then 3 else 6 end)::int);
    made_ql := greatest(1, least(100, 15 + c.fleece * 45 + skill_of(p_world, p_uid, 'tailoring') * 0.4));
    perform give(p_world, p_uid, coalesce(d.shear_yield, 'wool'), n, made_ql);
    update creature set fleece = 0 where world_id = p_world and id = c.id;
    perform skill_told(p_world, p_uid, 'tailoring', 0.4);
    perform skill_told(p_world, p_uid, 'taming', 0.1);
    perform tell(p_world, p_uid, 'You '
      || case when coalesce(d.shear_yield, 'wool') = 'wool' then 'shear' else 'pluck' end
      || ' ' || c.name || ' and come away with ' || n || ' '
      || lower((select coalesce(name, 'wool') from item_def where id = coalesce(d.shear_yield, 'wool')))
      || '. (QL ' || to_char(made_ql, 'FM990.0') || ') It will grow back.', 'event');

  elsif p_action = 'milk_creature' then
    if not consume(p_world, p_uid, 'bucket', 1) then return; end if;
    -- What it has been fed on is what comes out of it.
    made_ql := greatest(1, least(100, 20 + c.fleece * 40 + c.hunger * 30));
    perform give(p_world, p_uid, 'milk_bucket', 1, made_ql);
    update creature set fleece = 0 where world_id = p_world and id = c.id;
    perform skill_told(p_world, p_uid, 'farming', 0.3);
    perform tell(p_world, p_uid, 'You milk ' || c.name || ' into the bucket. (QL '
      || to_char(made_ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'set_stance' then
    update creature set stance = p_target->>'stance' where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' will be ' || (p_target->>'stance') || '.', 'info');

  elsif p_action = 'rename_creature' then
    nm := left(btrim(p_target->>'name'), 24);
    update creature set name = nm where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, 'It answers to ' || nm || ' now.', 'info');

  elsif p_action = 'take_creature' then
    held := companion_of(p_world, p_uid);
    if held is not null then
      update creature set mode = 'stored' where world_id = p_world and id = held;
      perform tell(p_world, p_uid,
        (select name from creature where world_id = p_world and id = held)
        || ' stays at the token for now.', 'info');
    end if;
    update creature set mode = 'active', keeper = p_uid, settled_at = now()
      where world_id = p_world and id = c.id;
    perform creature_settle(p_world, c.id);
    perform tell(p_world, p_uid, c.name || ' now follows you.', 'system');

  elsif p_action = 'store_creature' then
    update creature set mode = 'stored', settled_at = now() where world_id = p_world and id = c.id;
    perform creature_settle(p_world, c.id);
    perform tell(p_world, p_uid, c.name || ' is kept at the token of '
      || (my_deed(p_world, p_uid)).name || '.', 'system');

  elsif p_action = 'assign_deed' then
    -- The same key, missed in the same place: this is the token the wildermon
    -- is being put to work around, so it is the caller's own, not whichever
    -- one the planner happened to hand back first. On an island with two
    -- settlements it teleported a stored beast to a stranger's token.
    dd := my_deed(p_world, p_uid);
    -- The trade it was asked for by name, or its species' own. The door has
    -- already said the name is one of its trades.
    update creature set mode = 'deed', keeper = p_uid, phase = 'idle',
        job = coalesce(nullif(p_target->>'job', ''), d.gathers),
        work_x = null, work_y = null, carrying = null,
        from_x = case when c.mode = 'stored' then dd.x + 0.5 else creature_x(c) end,
        from_y = case when c.mode = 'stored' then dd.y + 1.5 else creature_y(c) end,
        to_x = case when c.mode = 'stored' then dd.x + 0.5 else creature_x(c) end,
        to_y = case when c.mode = 'stored' then dd.y + 1.5 else creature_y(c) end,
        leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' will '
      || coalesce((select plain from gather_def where id = coalesce(nullif(p_target->>'job', ''), d.gathers)), 'stay around the settlement')
      || ' within ' || work_range(c) || ' tiles of the token and bring what it finds to the crate.', 'system');

  elsif p_action = 'release_creature' then
    -- Blood takes generations to build and a moment to walk away.
    update creature set mode = 'wild', stance = 'passive', keeper = null,
        name = d.name, coaxed = 0, coaxed_at = null, until = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' ' || d.leaves || '.', 'system');

  elsif p_action = 'cull_creature' then
    /*
     * One action, and it is done.
     *
     * A beast you keep could always be killed — by swinging at it until it
     * stopped, which is a strange thing to have to do to your own livestock
     * and takes as long as fighting a wild one. This is the short way, and it
     * leaves exactly what the long way left: a carcass on the tile, for the
     * knife.
     *
     * Walked forward first, so the carcass lands where the body actually is;
     * a kept one stands at the token, which `creature_settle` has already
     * seen to. Whatever it was carrying is not buried with it.
     */
    perform creature_settle(p_world, c.id);
    select * into c from creature where world_id = p_world and id = c.id;
    if c.world_id is null then return; end if;
    if c.carrying is not null then
      perform drop_on_ground(p_world, floor(creature_x(c))::int, floor(creature_y(c))::int,
        c.carrying->>'def', coalesce((c.carrying->>'ql')::double precision, 1),
        c.carrying->>'extra', coalesce((c.carrying->>'count')::int, 1));
      update creature set carrying = null where world_id = p_world and id = c.id;
    end if;
    nm := c.name;
    -- Past any soak its blood could put in the way: this is not a blow, it is
    -- a decision. `wound_beast` is told nobody struck it, so it writes no
    -- hunter's line and no "you kill the wild one" — the words below are what
    -- happened.
    perform wound_beast(p_world, c.id, 1e9, null, null, null, null);
    perform tell(p_world, p_uid, 'You put ' || nm || ' down. The ' || lower(d.name)
      || '''s carcass lies where it stood, ready for the knife.', 'fight');
  end if;
end $function$;

-- worker_gatherable: tidying the seed away is a job.
CREATE OR REPLACE FUNCTION public.worker_gatherable(p_world uuid, p_x integer, p_y integer, p_kind text, c creature)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
AS $function$
declare here int; t tile_def; rock rock_def;
begin
  if not in_bounds(p_world, p_x, p_y) or claimed(p_world, p_x, p_y, c.id) then return false; end if;
  here := land_tile(p_world, p_x, p_y);
  select * into t from tile_def where id = here;

  if p_kind = 'woodcut' then
    return here = tile_id('Tree') and exists (select 1 from beside_tile(p_world, p_x, p_y));
  elsif p_kind = 'prune' then
    -- What would otherwise die: a stage that prunes back and whose next stage
    -- has no life in it. Nothing else is touched — a mature tree pruned stops
    -- bearing, and a sapling pruned is a shrub for good.
    return here = tile_id('Tree') and exists (select 1 from beside_tile(p_world, p_x, p_y))
       and exists (select 1 from tree_age_def a join tree_age_def n on n.id = a.next
                    where a.id = tree_age(land_data(p_world, p_x, p_y))
                      and a.pruned is not null and not n.alive);
  elsif p_kind = 'fruit' then
    -- A bearing tree with something on it, and a tile beside it to stand on.
    return here = tile_id('Tree') and exists (select 1 from beside_tile(p_world, p_x, p_y))
       and not is_foraged(p_world, p_x, p_y, 'forage')
       and exists (select 1 from tree_def td, tree_age_def a
                    where td.id = tree_species(land_data(p_world, p_x, p_y))
                      and a.id = tree_age(land_data(p_world, p_x, p_y))
                      and td.fruit is not null and a.bears and a.alive);
  elsif p_kind = 'stump' then
    return here = tile_id('Stump') and creature_tile_ok(p_world, p_x, p_y);
  elsif p_kind = 'mine' then
    rock := bedrock_at(p_world, p_x, p_y);
    return here = tile_id('Rock') and rock.seam and rock.level <= task_skill(c)
       and rock_height(p_world, p_x, p_y) > 1;
  elsif p_kind = 'quarry' then
    rock := bedrock_at(p_world, p_x, p_y);
    return here = tile_id('Rock') and not rock.seam and rock_height(p_world, p_x, p_y) > 1;
  elsif p_kind in ('sand', 'clay') then
    return here = tile_id(case p_kind when 'sand' then 'Sand' else 'Clay' end)
       and land_dirt(p_world, p_x, p_y) > 0 and creature_tile_ok(p_world, p_x, p_y);
  elsif p_kind = 'peat' then
    return here in (tile_id('Peat'), tile_id('Tar')) and not is_foraged(p_world, p_x, p_y, 'dig')
       and creature_tile_ok(p_world, p_x, p_y);
  elsif p_kind = 'reed' then
    return here = tile_id('Reed') and not is_foraged(p_world, p_x, p_y, 'reed');
  elsif p_kind = 'fish' then
    return fishable(p_world, p_x, p_y);
  elsif p_kind = 'seek' then
    -- Ground nobody has been over yet, which is the only ground worth a nose.
    return t.diggable and not has_water(p_world, p_x, p_y)
       and creature_tile_ok(p_world, p_x, p_y)
       and not is_foraged(p_world, p_x, p_y, 'dig');
  elsif p_kind = 'fetch' then
    return on_my_deed(p_world, c.keeper, p_x, p_y) and creature_tile_ok(p_world, p_x, p_y)
       and exists (select 1 from item i where i.world_id = p_world and i.holder = 'ground'
                     and i.gx = p_x and i.gy = p_y);
  elsif p_kind = 'compost' then
    -- A carcass, or anything knocked about past saving.
    return on_my_deed(p_world, c.keeper, p_x, p_y) and creature_tile_ok(p_world, p_x, p_y)
       and exists (select 1 from item i where i.world_id = p_world and i.holder = 'ground'
                     and i.gx = p_x and i.gy = p_y and (i.def = 'corpse' or i.dmg >= 40));
  elsif p_kind = 'farm' then
    perform crop_settle(p_world, p_x, p_y);
    if exists (select 1 from crop cr where cr.world_id = p_world and cr.x = p_x and cr.y = p_y
      and (cr.stage >= crop_ripe() or not cr.tended_now)) then return true; end if;
    /*
     * And a field with nothing in it, which was never work at all: the island
     * knew how to weed a crop and how to reap one and not how to sow one, so a
     * seavic walked over bare fields with seed sitting in the crate behind it.
     * Reported exactly so.
     */
    /*
     * And seed lying on a field that is already sown, which this tile has no
     * use for. Reported as "seavics also move seeds to storage if not using
     * them when working deed": a harvest leaves its seed in the furrow, the
     * next sowing takes one of them, and the rest sat there under the growing
     * crop where nobody could see, count or cook them. Picking them up is
     * work, so it is work here.
     */
    if exists (select 1 from crop cr where cr.world_id = p_world and cr.x = p_x and cr.y = p_y)
       and exists (select 1 from item i join crop_def sd on sd.seed = i.def
                    where i.world_id = p_world and i.holder = 'ground'
                      and i.gx = p_x and i.gy = p_y)
    then return true; end if;
    return land_tile(p_world, p_x, p_y) = tile_id('Field')
       and not exists (select 1 from crop cr where cr.world_id = p_world and cr.x = p_x and cr.y = p_y)
       and (sow_seed(p_world, c, p_x, p_y)).id is not null;
  elsif p_kind = 'forage' then
    return coalesce(t.forage, false) and not is_foraged(p_world, p_x, p_y, 'forage')
       and creature_tile_ok(p_world, p_x, p_y);
  elsif p_kind = 'botanize' then
    return coalesce(t.botanize, false) and not is_foraged(p_world, p_x, p_y, 'botanize')
       and creature_tile_ok(p_world, p_x, p_y);
  end if;
  return false;
end $function$;

-- worker_do: the seed a sown field has no use for goes home.
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
end $function$;

select private.lock_doors();
