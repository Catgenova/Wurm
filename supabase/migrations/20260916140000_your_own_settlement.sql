-- Your settlement, and not the island's.
--
-- Reported from the island: a settlement gone, its crate still standing, and
-- its holder had disbanded nothing. `perform_settlement` ended its disbanding
-- with
--
--     delete from deed where world_id = p_world;
--
-- and `deed` stopped being one row to the island a day ago. Every read either
-- side of that line was re-scoped to `(world_id, founded_by)` when the key
-- changed; the delete was not. So one person giving up their homestead took
-- every homestead on the island with it, and left everybody else's deed crate
-- standing in a field with nothing to say whose it was.
--
-- Measured before it was touched: two settlements nineteen tiles apart, the
-- far one disbanded, and the island came back with none.
--
-- The same key was missed once more, three hundred lines away, where a
-- wildermon put to work at a settlement is sent to `select * from deed where
-- world_id = p_world` — whichever the planner hands back first, which on an
-- island with two settlements is a coin toss between your token and a
-- stranger's.
--
-- And then what is left of the settlements already lost, which is further
-- down: the disbanding takes the caller's crate with it, so a deed crate whose
-- founder holds no settlement is the fingerprint of this and nothing else.

CREATE OR REPLACE FUNCTION public.perform_settlement(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare dd deed; p placed; it item; c creature; v_name text; v_level int; v_sx int; v_sy int;
        v_freed int := 0; v_tipped int := 0; cr crate; r record;
begin
  if p_action = 'upgrade_deed' then
    select * into dd from deed where world_id = p_world and founded_by = p_uid;
    v_level := dd.level + 1;
    update deed set level = v_level, radius = deed_radius(v_level)
      where world_id = p_world and founded_by = p_uid;
    perform tell(p_world, p_uid, dd.name || ' grows to level ' || v_level
      || '. The border reaches ' || deed_radius(v_level) || ' tiles from the token and '
      || worker_cap(p_world, p_uid) || ' wildermon may work here.', 'system');
    perform land_announce(p_world, dd.x, dd.y);

  elsif p_action = 'rename_deed' then
    v_name := left(btrim(p_target->>'name'), 32);
    update deed set name = v_name where world_id = p_world and founded_by = p_uid;
    perform tell(p_world, p_uid, 'The settlement is now called ' || v_name || '.', 'system');

  elsif p_action = 'disband_deed' then
    select * into dd from deed where world_id = p_world and founded_by = p_uid;
    -- Everything kept here runs wild, and what it was carrying goes on the
    -- ground where it stood rather than with it.
    for c in select * from creature where world_id = p_world and keeper = p_uid and mode in ('stored', 'deed') loop
      if c.carrying is not null then
        perform drop_on_ground(p_world, floor(creature_x(c))::int, floor(creature_y(c))::int,
          c.carrying->>'def', (c.carrying->>'ql')::double precision, c.carrying->>'extra',
          (c.carrying->>'count')::int);
      end if;
      update creature set mode = 'wild', phase = 'idle', job = null, post = null, carrying = null,
          name = (select name from species_def where id = c.species)
        where world_id = p_world and id = c.id;
      v_freed := v_freed + 1;
    end loop;
    -- The settlement's own crate goes with the settlement, and whatever was in
    -- it is tipped out where it stood rather than vanishing with it.
    cr := deed_crate(p_world, p_uid);
    if cr.id is not null then
      for r in select * from item where world_id = p_world and crate = cr.id loop
        update item set holder = 'ground', holder_uid = null, crate = null, gx = cr.x, gy = cr.y
          where id = r.id;
        v_tipped := v_tipped + 1;
      end loop;
      delete from crate where world_id = p_world and id = cr.id;
    end if;
    /*
     * Yours, and not the island's.
     *
     * Reported by somebody whose settlement was gone while his crate still
     * stood and who had not disbanded anything: somebody else had, at the
     * other end of the island, and this line took every settlement on it. The
     * deed crate is the tell — the disbanding tips out and removes the
     * *caller's* crate, so everybody else was left with an orphan standing in
     * a field and nothing to say what it had belonged to.
     *
     * `deed` was keyed on the island alone until a day ago, when it became
     * `(world_id, founded_by)`. The reads either side of this were re-scoped
     * with the key; the delete was not, and a delete is the one statement
     * where the whole island being in range does not read as a mistake.
     */
    delete from deed where world_id = p_world and founded_by = p_uid;
    perform tell(p_world, p_uid, dd.name || ' is disbanded. '
      || v_freed || case when v_freed = 1 then ' wildermon runs' else ' wildermon run' end
      || ' wild and ' || v_tipped
      || case when v_tipped = 1 then ' thing is' else ' things are' end
      || ' tipped out where the crate stood.', 'system');
    perform land_announce(p_world, dd.x, dd.y);

  elsif p_action = 'place_post' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and def = 'work_post' and not locked
      and (nullif(p_target->>'uid', '') is null or id = (p_target->>'uid')::bigint)
      order by id limit 1;
    if not found then return; end if;
    v_sx := least(subtiles() - 1, greatest(0, coalesce((p_target->>'sx')::int, 0)));
    v_sy := least(subtiles() - 1, greatest(0, coalesce((p_target->>'sy')::int, 0)));
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (p_world, 'post', it.extra, (p_target->>'x')::int, (p_target->>'y')::int, v_sx, v_sy,
            (p_target->>'x')::int + (v_sx + 0.5) / subtiles(),
            (p_target->>'y')::int + (v_sy + 0.5) / subtiles(), it.ql, p_uid)
    returning * into p;
    delete from item where id = it.id;
    perform tell(p_world, p_uid, 'You drive the post in and tack the ribbon to it. It will stand about '
      || round(post_life(p.ql) / 60) || ' minutes and reach ' || post_radius(p.ql)
      || ' tiles. Set a wildermon to it.', 'event');
    perform land_announce(p_world, p.x, p.y);
    return;
  end if;

  if p_action in ('upgrade_deed', 'rename_deed', 'disband_deed') then return; end if;

  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
  if not found then return; end if;

  if p_action = 'pick_up_post' then
    -- Half rotten by now, most likely, and it comes up as it went in.
    perform give(p_world, p_uid, 'work_post', 1,
      greatest(1, p.ql * (1 - post_dmg(p) / 100)), p.sub);
    update creature set post = null, phase = 'idle' where world_id = p_world and post = p.id;
    delete from placed where id = p.id;
    perform tell(p_world, p_uid, 'You pull the post up and coil the ribbon round it.', 'event');
    perform land_announce(p_world, p.x, p.y);

  elsif p_action = 'assign_post' then
    select * into c from creature where world_id = p_world and id = (p_target->>'creature')::int;
    if not found then return; end if;
    update creature set post = p.id, mode = 'deed', phase = 'idle', enemy = null, hunting = null,
        from_x = p.cx, from_y = p.cy + 0.6, to_x = p.cx, to_y = p.cy + 0.6,
        leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' will '
      || coalesce((select g.plain from gather_def g
                   where g.id = (select gathers from species_def where id = c.species)),
                  'keep to the post')
      || ' within ' || least(work_range(c), post_radius(p.ql))
      || ' tiles of the post while it stands. (' || post_state(p) || ')', 'system');

  elsif p_action = 'unassign_post' then
    select * into c from creature where world_id = p_world and post = p.id limit 1;
    if not found then return; end if;
    select * into dd from deed where world_id = p_world and founded_by = c.keeper;
    update creature set post = null, phase = 'idle',
        from_x = coalesce(dd.x + 0.5, p.cx), from_y = coalesce(dd.y + 1.5, p.cy),
        to_x = coalesce(dd.x + 0.5, p.cx), to_y = coalesce(dd.y + 1.5, p.cy),
        leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' is called off the post.', 'system');
  end if;
end $function$;

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
                  || coalesce((select name from deed where world_id = p_world and founded_by = p_uid), 'your settlement') || '.' end, 'system');
      perform skill_raise(p_world, p_uid, 'taming', 0.7);
      perform skill_raise(p_world, p_uid, 'soul_strength', 0.4);
    else
      -- It refused, but it stayed for the offering, and that is worth
      -- something to the next one.
      update creature set coaxed = coaxed + 1, coaxed_at = now()
        where world_id = p_world and id = c.id returning * into c;
      warm := coax_bonus(c);
      perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' '
        || replace(d.tame_fail, '{food}', material_name(food, 1)) || '.'
        || case when warm > 0 then ' It is ' ||
             case when warm >= 0.12 then 'as used to you as it will get' else 'growing used to you' end
             || ': ' || to_char(warm * 100, 'FM990') || '% readier than the first time.'
           else '' end, 'event');
      perform skill_raise(p_world, p_uid, 'taming', 0.35);
      perform skill_raise(p_world, p_uid, 'soul_strength', 0.2);
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
    gained := skill_raise(p_world, p_uid, 'animal_husbandry', 0.4);
    perform tell(p_world, p_uid, case when before < 0.12 and c.care >= 0.12
        then 'You work the dust out of ' || c.name || '''s coat. It leans into the brush. ('
        else 'You brush ' || c.name || ' down. (' end || care_word(c.care) || ')', 'event');

  elsif p_action = 'shear' then
    -- A full fleece is three, a half-grown one is one, and quality follows the fleece.
    n := greatest(1, round(c.fleece * case when coalesce(d.shear_yield, 'wool') = 'wool' then 3 else 6 end)::int);
    made_ql := greatest(1, least(100, 15 + c.fleece * 45 + skill_of(p_world, p_uid, 'tailoring') * 0.4));
    perform give(p_world, p_uid, coalesce(d.shear_yield, 'wool'), n, made_ql);
    update creature set fleece = 0 where world_id = p_world and id = c.id;
    perform skill_raise(p_world, p_uid, 'tailoring', 0.4);
    perform skill_raise(p_world, p_uid, 'taming', 0.1);
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
    perform skill_raise(p_world, p_uid, 'farming', 0.3);
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
      || (select name from deed where world_id = p_world and founded_by = p_uid) || '.', 'system');

  elsif p_action = 'assign_deed' then
    -- The same key, missed in the same place: this is the token the wildermon
    -- is being put to work around, so it is the caller's own, not whichever
    -- one the planner happened to hand back first. On an island with two
    -- settlements it teleported a stored beast to a stranger's token.
    dd := my_deed(p_world, p_uid);
    update creature set mode = 'deed', keeper = p_uid, phase = 'idle', job = d.gathers,
        work_x = null, work_y = null, carrying = null,
        from_x = case when c.mode = 'stored' then dd.x + 0.5 else creature_x(c) end,
        from_y = case when c.mode = 'stored' then dd.y + 1.5 else creature_y(c) end,
        to_x = case when c.mode = 'stored' then dd.x + 0.5 else creature_x(c) end,
        to_y = case when c.mode = 'stored' then dd.y + 1.5 else creature_y(c) end,
        leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' will '
      || coalesce((select plain from gather_def where id = d.gathers), 'stay around the settlement')
      || ' within ' || work_range(c) || ' tiles of the token and bring what it finds to the crate.', 'system');

  elsif p_action = 'release_creature' then
    -- Blood takes generations to build and a moment to walk away.
    update creature set mode = 'wild', stance = 'passive', keeper = null,
        name = d.name, coaxed = 0, coaxed_at = null, until = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' ' || d.leaves || '.', 'system');
  end if;
end $function$;

/* ------------------------------------------------------------------ *
 * And the settlements that went down with somebody else's.
 * ------------------------------------------------------------------ */

/*
 * What is left of a settlement the delete above should never have touched.
 *
 * A disbanding takes the caller's deed crate with it and always has, so a
 * crate marked `deed` whose founder holds no settlement is not somebody who
 * gave one up — it is somebody whose settlement was deleted out from under
 * them. That is a fingerprint, not a guess, and it is the only one there is:
 * the deed row itself leaves no trace behind.
 *
 * Three things have to come back, and they are known to three different
 * degrees.
 *
 *   * Where the token stood — certain, near enough. `place_deed_crate` sets
 *     the crate on the first of five tiles round the token that is in bounds,
 *     dry, passable, unbuilt and clear of other crates, in a fixed order. So
 *     the token is the one tile from which that walk lands on this crate,
 *     which is a question the island can still answer because the ground it
 *     asks about has not moved. Where nothing answers it — the ground has
 *     changed, or the crate went in the hemmed-in fallback — the first
 *     preference is taken, which is the tile to the west of the crate.
 *
 *   * What it was called, and how far it reached — from what its holder was
 *     told. `event` keeps a day, and an upgrade line carries both the name and
 *     the level; a renaming and a founding carry the name. Past a day there is
 *     nothing, and it comes back as a level-one Homestead, which is the name
 *     `found_settlement` gives a settlement nobody named.
 *
 *   * How many wildermon it could work — the floor of it is certain. A
 *     settlement may keep as many as its level and no more, so a holder with
 *     four still on the books had at least level four. That is a floor and not
 *     the number: somebody who upgraded and kept nobody comes back at one.
 *
 * Whoever holds it is told what happened and what was reconstructed, because
 * a border that has quietly moved a tile is worse than one you were warned
 * about. A settlement that would now overlap a standing one is left alone and
 * said so, rather than made into a world with two answers for a tile.
 */
do $$
declare cr crate; t record; spot record; v_tx int; v_ty int;
        v_name text; v_level int; v_kept int; v_done int := 0; v_held int := 0;
begin
  for cr in
    select c.* from crate c
     where c.deed and c.made_by is not null
       and not exists (select 1 from deed d
                        where d.world_id = c.world_id and d.founded_by = c.made_by)
     order by c.world_id, c.id
  loop
    -- The tile the crate was set down beside.
    v_tx := null;
    for t in select cr.x - v.dx as tx, cr.y - v.dy as ty
               from (values (1, 0), (0, 1), (-1, 0), (0, -1), (1, 1)) as v(dx, dy)
    loop
      continue when not in_bounds(cr.world_id, t.tx, t.ty);
      select q.gx, q.gy into spot
        from (values (1, 0), (0, 1), (-1, 0), (0, -1), (1, 1)) as v(dx, dy),
             lateral (select t.tx + v.dx as gx, t.ty + v.dy as gy) q
       where in_bounds(cr.world_id, q.gx, q.gy) and passable(cr.world_id, q.gx, q.gy)
         and not has_water(cr.world_id, q.gx, q.gy)
         and building_at(cr.world_id, q.gx, q.gy) is null
         and not exists (select 1 from crate c2 where c2.world_id = cr.world_id
                           and c2.x = q.gx and c2.y = q.gy and c2.id <> cr.id)
       limit 1;
      if found and spot.gx = cr.x and spot.gy = cr.y then
        v_tx := t.tx; v_ty := t.ty; exit;
      end if;
    end loop;
    if v_tx is null then v_tx := cr.x - 1; v_ty := cr.y; end if;

    -- What it was called, out of what its holder was told.
    v_name := null; v_level := null;
    select substring(e.text from '^(.+) grows to level [0-9]+\. The border reaches '),
           (substring(e.text from ' grows to level ([0-9]+)\. The border reaches '))::int
      into v_name, v_level
      from event e
     where e.world_id = cr.world_id and e.uid = cr.made_by
       and e.text ~ ' grows to level [0-9]+\. The border reaches '
     order by e.n desc limit 1;
    if v_name is null then
      select substring(e.text from '^The settlement is now called (.+)\.$') into v_name
        from event e
       where e.world_id = cr.world_id and e.uid = cr.made_by
         and e.text ~ '^The settlement is now called .+\.$'
       order by e.n desc limit 1;
    end if;
    if v_name is null then
      select substring(e.text from '^You found the settlement of (.+)\. The land ') into v_name
        from event e
       where e.world_id = cr.world_id and e.uid = cr.made_by
         and e.text like 'You found the settlement of %'
       order by e.n desc limit 1;
    end if;
    v_name := left(coalesce(nullif(btrim(coalesce(v_name, '')), ''), 'Homestead'), 32);

    -- And how far it reached, floored by what it is still keeping.
    select count(*) into v_kept from creature c
     where c.world_id = cr.world_id and c.keeper = cr.made_by and c.mode = 'deed';
    v_level := least(5, greatest(1, coalesce(v_level, 1), v_kept));

    -- Two squares overlap when their centres are closer than the sum of their
    -- reaches, on either axis — the rule `deed_refusal` founds by.
    if exists (select 1 from deed d
                where d.world_id = cr.world_id
                  and abs(v_tx - d.x) <= deed_radius(v_level) + d.radius
                  and abs(v_ty - d.y) <= deed_radius(v_level) + d.radius) then
      perform tell(cr.world_id, cr.made_by,
        'Your settlement was taken down by somebody else disbanding theirs, which was a '
        || 'fault in the island and not anything you did. It cannot be put back where it '
        || 'stood, because another settlement now reaches that ground. Your crate is still '
        || 'at ' || cr.x || ', ' || cr.y || ' and everything in it is yours.', 'system');
      v_held := v_held + 1;
      continue;
    end if;

    insert into deed (world_id, name, x, y, radius, level, founded_by)
    values (cr.world_id, v_name, v_tx, v_ty, deed_radius(v_level), v_level, cr.made_by)
    on conflict do nothing;
    perform tell(cr.world_id, cr.made_by,
      v_name || ' stands again at ' || v_tx || ', ' || v_ty || ', level ' || v_level
      || '. It was taken down by somebody else disbanding theirs, which was a fault in the '
      || 'island and not anything you did. The token is where your deed crate says it was '
      || 'and the name and level are what you were last told — if any of the three is '
      || 'wrong, say so and it will be set right.', 'system');
    v_done := v_done + 1;
  end loop;
  if v_done > 0 or v_held > 0 then
    raise notice 'settlements put back: %, left alone because the ground is taken: %', v_done, v_held;
  end if;
end $$;
