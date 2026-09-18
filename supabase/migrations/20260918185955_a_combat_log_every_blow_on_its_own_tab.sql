-- A combat log: every blow lands on its own tab
--
-- Asked for: "add a combat log to the event ui". The log's tabs keep lines by
-- kind, and a fight's lines were filed three ways: a swing, a strike and a
-- kill under `event` with the day's work, a bite taken and "has your scent"
-- under `error` with the refusals, a monster going down under `system` with
-- the chat. There is a kind for them now, `fight`, and a Combat tab that
-- keeps it: every blow given and taken, what is coming for you, what your
-- companion goes for and what it and you brought down. This files the
-- island's own lines that way (`perform_fight`, `hurt_player`,
-- `hunt_settle`, `companion_settle`, `wound_beast`); the browser files its
-- own the same, and arms the early beat on a `fight` line as it does on an
-- `error`, so a blow taken still shows on the bars within the second.

CREATE OR REPLACE FUNCTION public.perform_fight(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_landed boolean; it item; p player; slot text; shield item; c creature; d species_def; w weapon_def;
        bow weapon_def; arrow item; held item; dist double precision; dmg double precision;
        bane double precision; before double precision; died boolean; reach double precision;
        corpse item; sp species_def; knife_ql double precision; v_share double precision;
        made_ql double precision; taken text[] := '{}'; r record; v_n int; lumps text[] := '{}';
        hurt jsonb; use item; suits boolean; clean boolean; healed double precision;
        top double precision; out_w jsonb; one jsonb; lye item; got text;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'equip' then
    select * into it from item where id = target_item(p_target);
    slot := slot_of(it.def);
    update player set equipped = jsonb_set(equipped, array[slot], to_jsonb(it.id))
      where world_id = p_world and uid = p_uid returning * into p;
    -- Both hands on it means nothing else in them.
    if slot = 'weapon' and coalesce((select two_handed from weapon_def where id = it.def), false) then
      shield := worn(p_world, p_uid, 'offhand');
      if shield.id is not null then
        update player set equipped = equipped - 'offhand' where world_id = p_world and uid = p_uid;
        perform tell(p_world, p_uid, 'You need both hands for that, so the '
          || lower((select name from item_def where id = shield.def)) || ' goes on your back.', 'info');
      end if;
    end if;
    perform tell(p_world, p_uid, 'You '
      || case when slot in ('weapon', 'offhand') then 'take up' else 'put on' end
      || ' the ' || lower((select name from item_def where id = it.def)) || '.', 'info');

  elsif p_action = 'unequip' then
    select * into it from item where id = target_item(p_target);
    slot := slot_of(it.def);
    update player set equipped = equipped - slot where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You put the '
      || lower((select name from item_def where id = it.def)) || ' away.', 'info');

  elsif p_action = 'attack_creature' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    select * into d from species_def where id = c.species;
    w := swung_with(p_world, p_uid);
    held := swung_item(p_world, p_uid);
    before := c.health;
    -- The gains used to be written above the roll, so a miss paid exactly
    -- what a landed blow paid.
    -- Its blood has a say in whether you connect at all.
    v_landed := random() <= hit_chance(p_world, p_uid, w.kind) * beast_mul(c, 'evade');
    perform skill_raise(p_world, p_uid, 'fighting', try_gain(v_landed, swing_fight()));
    perform skill_raise(p_world, p_uid, w.kind, try_gain(v_landed, swing_arm()));
    perform skill_raise(p_world, p_uid, 'body_strength', try_gain(v_landed, swing_body()));
    -- And, if it is dark enough to matter, what it teaches about noticing.
    perform fought_in_dark(p_world, p_uid, dark_swing());
    if not v_landed then
      perform tell(p_world, p_uid, 'You swing at the ' || lower(d.name)
        || case when held.id is null then '' else ' with your '
             || lower((select name from item_def where id = held.def)) end || ' and miss.', 'fight');
    else
      bane := case when held.id is not null and mat_bane(held.extra) and d.glow is not null
                   then bane_bonus() else 1 end;
      dmg := weapon_damage(p_world, p_uid, w, held) * bane * (0.75 + random() * 0.5);
      died := hurt_creature(p_world, c.id, dmg, p_uid);
      if held.id is not null then perform damage_item(held.id, 0.35); end if;
      if not died then
        perform tell(p_world, p_uid, 'You strike the ' || lower(d.name)
          || case when held.id is null then '' else ' with your '
               || lower((select name from item_def where id = held.def)) end
          || '. It is down to ' || greatest(0, ceil(c.health - dmg)) || ' of ' || max_health(c) || '.', 'fight');
      end if;
    end if;
    -- A cornered animal gets a swipe in, and the defensive sorts never miss their chance.
    if not coalesce(died, false) and (d.defensive or random() < 0.35) then
      -- And you are marked as struck by it, which is what a defensive companion at
      -- heel answers; a hunter that bites you marks you the same way.
      perform mark_attacker(p_world, p_uid, c.id);
      perform hurt_player(p_world, p_uid, attack_of(c) * 0.012,
        'The ' || lower(d.name) || case when d.defensive then ' comes straight back at you'
                                        else ' turns on you' end,
        coalesce(d.wound, 'bite'));
    end if;

  elsif p_action = 'shoot_creature' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    select * into d from species_def where id = c.species;
    held := worn(p_world, p_uid, 'weapon');
    select bw.* into bow from weapon_def bw where bw.id = held.def and bw.ammo is not null;
    if not found then return; end if;
    select i.* into arrow from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = bow.ammo
      order by i.ql desc limit 1;
    if arrow.id is null or not consume(p_world, p_uid, bow.ammo, 1, arrow.id) then return; end if;
    dist := (select sqrt((creature_x(c) - pl.x) ^ 2 + (creature_y(c) - pl.y) ^ 2)
             from player pl where pl.world_id = p_world and pl.uid = p_uid);
    -- The far end of a bow's range is a far harder shot than the near end.
    v_landed := random() <= hit_chance(p_world, p_uid, 'archery')
                            * (1 - (dist / coalesce(bow.range, 6)) * 0.35) * beast_mul(c, 'evade');
    perform skill_raise(p_world, p_uid, 'fighting', try_gain(v_landed, shot_fight()));
    perform skill_raise(p_world, p_uid, 'archery', try_gain(v_landed, shot_archery()));
    -- Picking a target out of the dark at range is the hardest looking there is.
    perform fought_in_dark(p_world, p_uid, dark_shot());
    if not v_landed then
      perform tell(p_world, p_uid, 'Your arrow goes wide of the ' || lower(d.name) || '.', 'fight');
    else
      -- The stave throws it; the head is what goes in. Both have a say.
      bane := case when mat_bane(arrow.extra) and d.glow is not null then bane_bonus() else 1 end;
      dmg := weapon_damage(p_world, p_uid, bow, held) * mat_edge(arrow.extra) * bane
             * (0.6 + arrow.ql / 140) * (0.8 + random() * 0.4);
      died := hurt_creature(p_world, c.id, dmg, p_uid);
      perform damage_item(held.id, 0.25);
      if not died then
        perform tell(p_world, p_uid, 'Your arrow goes home. The ' || lower(d.name)
          || ' is down to ' || greatest(0, ceil(c.health - dmg)) || ' of ' || max_health(c) || '.', 'fight');
      end if;
    end if;

  elsif p_action = 'butcher' then
    corpse := target_corpse(p_world, p_uid, p_target);
    sp := corpse_species(corpse.extra);
    if corpse.id is null or sp.id is null then return; end if;
    knife_ql := nullif(tool_ql(p_world, p_uid, 'butchering_knife'), 0);
    v_share := butcher_yield(skill_of(p_world, p_uid, 'butchering'), knife_ql);
    made_ql := product_ql(skill_of(p_world, p_uid, 'butchering'), coalesce(knife_ql, 0))
               * (0.6 + corpse.ql / 250);
    -- What it was sleeping on, which is not a part of it at all.
    for r in select sb.n from species_butcher sb where sb.species = sp.id and sb.part = 'hoard' loop
      for v_n in 1..round(r.n * (4 + v_share * 6))::int loop
        select item into got from hoard_metal order by random() limit 1;
        perform give(p_world, p_uid, got, 1, greatest(20, least(100, 40 + random() * 55)));
        lumps := lumps || lower((select name from item_def where id = got));
      end loop;
    end loop;
    if array_length(lumps, 1) > 0 then
      perform journal_note(p_world, p_uid, 'hoard');
      perform tell(p_world, p_uid, 'Something rattles as the belly opens: ' || array_length(lumps, 1)
        || ' lumps of what it had been sleeping on. '
        || (select string_agg(distinct l, ', ') from unnest(lumps) l) || '.', 'event');
    end if;
    /* `n` was a plpgsql variable here and `species_butcher.n` a column, and
     * Postgres would not guess which was meant. That is the fourth time on
     * this island — `land_tile.y`, `crop.y`, `trait_def.tier` — so the locals
     * that could collide carry a prefix. */
    for r in select b.part, b.item, sb.n from butcher_part b
             join species_butcher sb on sb.part = b.part and sb.species = sp.id
             order by b.ord loop
      v_n := floor(r.n * v_share)::int;
      -- The remainder is a chance at one more, so a poor job still gives something.
      if random() < r.n * v_share - v_n then v_n := v_n + 1; end if;
      -- Glands are the rare part: only a steady hand finds them intact.
      if r.part = 'gland' and v_n > 0 and random() > 0.35 * (0.5 + v_share) then v_n := 0; end if;
      if v_n <= 0 then continue; end if;
      perform give(p_world, p_uid, r.item, v_n, greatest(1, least(100, made_ql)));
      taken := taken || (case when v_n > 1 then v_n || ' × ' else '' end
        || lower((select name from item_def where id = r.item)));
    end loop;
    delete from item where id = corpse.id;
    if array_length(taken, 1) is null then
      perform tell(p_world, p_uid, 'You make a mess of the ' || lower(sp.name)
        || ' carcass and salvage nothing.', 'event');
    else
      perform tell(p_world, p_uid, 'You butcher the ' || lower(sp.name) || ' and take '
        || array_to_string(taken, ', ') || '.'
        || case when knife_ql is null then ' Bare hands waste most of a carcass.' else '' end, 'event');
    end if;

  elsif p_action = 'bind_wound' then
    select * into p from player where world_id = p_world and uid = p_uid;
    hurt := worst_wound(p.wounds);
    if hurt is null or (hurt->>'infected')::boolean then return; end if;
    use := dressing_for(p_world, p_uid, hurt);
    if use.id is null or not consume(p_world, p_uid, use.def, 1, use.id) then return; end if;
    got := case when use.def = 'cover' then lower(coalesce(use.extra, '')) else '' end;
    suits := got = (select herb from wound_kind_def where id = hurt->>'kind');
    clean := skill_check(skill_of(p_world, p_uid, 'first_aid'), 10, use.ql);
    -- Cloth holds a dressing on. The right herb closes the wound.
    healed := (0.06 + (skill_of(p_world, p_uid, 'first_aid') / 100) * 0.24 + (use.ql / 100) * 0.1)
              * (case when clean then 1 else 0.35 end)
              * (case when suits then 1.5 when got <> '' then 1.1 else 1 end);
    out_w := '[]'::jsonb;
    for one in select * from jsonb_array_elements(p.wounds) loop
      if one = hurt then
        one := jsonb_set(one, '{severity}', to_jsonb(greatest(0, (one->>'severity')::double precision - healed)));
        if clean then one := jsonb_set(jsonb_set(one, '{dressing}', to_jsonb(got)), '{bleeding}', 'false'); end if;
      end if;
      if (one->>'severity')::double precision > 0.004 or (one->>'infected')::boolean then
        out_w := out_w || one;
      end if;
    end loop;
    update player set wounds = out_w,
        stats = jsonb_set(p.stats, '{health}',
          to_jsonb(least(1, coalesce((p.stats->>'health')::double precision, 1) + healed)))
      where world_id = p_world and uid = p_uid;
    perform journal_note(p_world, p_uid, 'dressed');
    if clean and suits then perform journal_note(p_world, p_uid, 'covered'); end if;
    perform skill_raise(p_world, p_uid, 'first_aid', try_gain(clean, bandage_gain()));
    perform tell(p_world, p_uid, case
      when not clean then 'The dressing slips and you make a poor job of it. You still have '
        || wound_text(hurt) || '.'
      when suits then 'You lay the ' || got
        || ' cover on and bind it. The bleeding stops at once and it is already closing.'
      when got <> '' then 'You bind the ' || got || ' cover over it. It is the wrong herb for a '
        || (select name from wound_kind_def where id = hurt->>'kind')
        || ', but it holds and the bleeding stops.'
      else 'You clean it and bind it with cloth. The bleeding stops, though it will be slow to close.'
      end, 'event');

  elsif p_action = 'clean_wound' then
    select * into p from player where world_id = p_world and uid = p_uid;
    select i.* into lye from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'lye_bucket'
      order by i.ql desc limit 1;
    if lye.id is null or not consume(p_world, p_uid, 'lye_bucket', 1, lye.id) then return; end if;
    perform give(p_world, p_uid, 'bucket', 1, lye.ql);
    clean := skill_check(skill_of(p_world, p_uid, 'first_aid'), 26, lye.ql);
    perform journal_note(p_world, p_uid, 'cleaned');
    perform skill_raise(p_world, p_uid, 'first_aid', try_gain(clean, clean_gain()));
    select x into hurt from jsonb_array_elements(p.wounds) x where (x->>'infected')::boolean limit 1;
    if not clean then
      perform tell(p_world, p_uid, 'You scour the '
        || (select name from wound_kind_def where id = hurt->>'kind')
        || ' out and it is no better for it. The lye is gone.', 'error');
      return;
    end if;
    out_w := '[]'::jsonb;
    for one in select * from jsonb_array_elements(p.wounds) loop
      if one = hurt then
        one := jsonb_set(jsonb_set(jsonb_set(one, '{infected}', 'false'),
          '{bleeding}', 'true'), '{dressing}', 'null'::jsonb);
      end if;
      out_w := out_w || one;
    end loop;
    update player set wounds = out_w where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You scour the '
      || (select name from wound_kind_def where id = hurt->>'kind') || ' on your '
      || part_name(hurt->>'part') || ' out with lye. It is open and clean again, and bleeding. Dress it.', 'event');

  elsif p_action = 'treat_creature' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    select i.* into use from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'bandage'
      order by i.ql desc limit 1;
    if use.id is null or not consume(p_world, p_uid, 'bandage', 1, use.id) then return; end if;
    clean := skill_check(skill_of(p_world, p_uid, 'first_aid'), 14, use.ql);
    top := max_health(c);
    healed := top * (0.06 + (skill_of(p_world, p_uid, 'first_aid') / 100) * 0.24 + (use.ql / 100) * 0.1)
              * (case when clean then 1 else 0.35 end);
    update creature set health = least(top, health + healed)
      where world_id = p_world and id = c.id returning * into c;
    perform skill_raise(p_world, p_uid, 'first_aid', try_gain(clean, bandage_gain()));
    perform tell(p_world, p_uid, case when clean
      then 'You dress ' || c.name || '''s wounds with the '
        || lower((select name from item_def where id = 'bandage')) || '. It is up to '
      else c.name || ' will not hold still and the dressing goes on badly. It is up to '
      end || ceil(c.health) || ' of ' || top || '.', 'event');
  end if;
end $function$

;

CREATE OR REPLACE FUNCTION public.hurt_player(p_world uuid, p_uid uuid, p_raw double precision, p_what text, p_kind text DEFAULT 'bite'::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player; shield item; sh shield_def; chance double precision; roll double precision;
        part text; piece item; cls armour_class_def; soak double precision; taken double precision;
        health double precision; ws jsonb; had jsonb; found_w boolean := false; out_w jsonb := '[]'::jsonb;
        w jsonb; k wound_kind_def; note text;
begin
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found then return; end if;

  -- Being hit in the dark teaches more about watching than hitting does, and
  -- before the shield, because a blow you turned is still a blow you did not
  -- see coming.
  perform fought_in_dark(p_world, p_uid, dark_hit());
  -- The shield, first of all.
  shield := worn(p_world, p_uid, 'offhand');
  if shield.id is not null then
    select * into sh from shield_def where id = shield.def;
    if found then
      chance := least(0.6, sh.block * (0.6 + shield.ql / 160) + skill_of(p_world, p_uid, 'shields') / 400);
      perform skill_raise(p_world, p_uid, 'shields', 0.12);
      if random() < chance then
        update item set dmg = least(100, dmg + p_raw * 3) where id = shield.id;
        perform skill_raise(p_world, p_uid, 'shields', 0.5);
        perform tell(p_world, p_uid, 'You take ' || p_what || ' on your '
          || lower((select name from item_def where id = shield.def)) || '.', 'fight');
        return;
      end if;
    end if;
  end if;

  -- Then wherever it lands.
  roll := random();
  select h.slot into part from (
    select slot, sum(share) over (order by ord) as upto from hit_location) h
  where roll <= h.upto order by h.upto limit 1;
  part := coalesce(part, 'chest');

  taken := p_raw;
  note := '';
  piece := worn(p_world, p_uid, part);
  if piece.id is not null and exists (select 1 from armour_def where id = piece.def) then
    select c.* into cls from armour_def a join armour_class_def c on c.id = a.cls where a.id = piece.def;
    soak := piece_soak(piece, skill_of(p_world, p_uid, cls.skill));
    -- Armour is learned by being hit in it, and worn out the same way.
    perform skill_raise(p_world, p_uid, cls.skill, 0.4);
    update item set dmg = least(100, dmg + p_raw * 4) where id = piece.id;
    if piece.dmg + p_raw * 4 >= 100 then
      delete from item where id = piece.id;
      update player set equipped = equipped - part where world_id = p_world and uid = p_uid;
      perform tell(p_world, p_uid, 'Your ' || lower((select name from item_def where id = piece.def))
        || ' is beaten to pieces and falls away.', 'fight');
    else
      note := ', though your ' || lower((select name from item_def where id = piece.def)) || ' takes the worst of it';
    end if;
    taken := p_raw * (1 - least(0.92, soak));
  end if;

  select * into k from wound_kind_def where id = p_kind;
  -- Open a wound, or deepen one of the same kind already in that place.
  for w in select * from jsonb_array_elements(coalesce(p.wounds, '[]'::jsonb)) loop
    if not found_w and w->>'kind' = p_kind and w->>'part' = part and not (w->>'infected')::boolean then
      w := jsonb_set(w, '{severity}', to_jsonb((w->>'severity')::double precision + taken));
      if k.bleed > 0.001 then w := jsonb_set(w, '{bleeding}', 'true'); end if;
      found_w := true;
    end if;
    out_w := out_w || w;
  end loop;
  if not found_w then
    -- A bruise does not bleed; everything else does until it is seen to.
    w := jsonb_build_object('kind', p_kind, 'part', part, 'severity', taken,
      'bleeding', p_kind <> 'crush', 'infected', false, 'dressing', null, 'at', now());
    out_w := out_w || w;
  end if;

  health := greatest(0, coalesce((p.stats->>'health')::double precision, 1) - taken);
  update player set wounds = out_w,
      stats = jsonb_set(jsonb_set(p.stats, '{health}', to_jsonb(health)),
                        '{hurtSettled}', to_jsonb(now()))
    where world_id = p_world and uid = p_uid;
  perform tell(p_world, p_uid, p_what || note || '. You have ' || wound_text(w) || '.', 'fight');
  if health <= 0 then perform player_die(p_world, p_uid); end if;
end $function$

;

CREATE OR REPLACE FUNCTION public.hunt_settle(p_world uuid, c creature, d species_def, a age_def)
 RETURNS creature
 LANGUAGE plpgsql
AS $function$
declare p record; v_dist double precision; v_pace double precision; v_guard int := 0;
        v_cx double precision; v_cy double precision; v_secs double precision;
        v_ax double precision; v_ay double precision; v_step record;
begin
  v_cx := creature_x(c); v_cy := creature_y(c);
  select * into p from nearest_player(p_world, v_cx, v_cy);
  if not found then c.hunting := null; return c; end if;

  if c.hunting is not null then
    /*
     * How far it has come from where it started, which is the one measure that
     * grows while it chases.
     *
     * Reported as being chased until you are dead, and that is exactly what
     * happened: every give-up here was about the gap between hunter and
     * hunted, and a hunter runs at `speed * 1.15` — so the gap it was measured
     * against was a gap it was closing. Outrunning one was the only way to
     * lose it, and most things on this island are faster than a body carrying
     * a pack.
     *
     * So the leash is tied where the chase began. It gives up at the end of it
     * and then wants nothing to do with hunting for `hunt_rest`, because
     * otherwise it drops you at thirty tiles, notices you again on the next
     * breath because you are still well inside its sight, and measures a fresh
     * leash from there — which is the same endless chase with a stutter in it.
     */
    if sqrt((v_cx - coalesce(c.hunt_x, v_cx)) ^ 2 + (v_cy - coalesce(c.hunt_y, v_cy)) ^ 2)
         > hunt_leash() then
      c.hunting := null;
      c.hunt_again := now() + make_interval(secs => hunt_rest());
      return c;
    end if;
    if p.d > (case when d.monster then hunt_give_up() * 2.2 else hunt_give_up() end)
       or c.health < max_health(c) * (case when d.monster then 0.08 else 0.3 end)
       or at_peace(p_world, p.x, p.y) then
      c.hunting := null;
      return c;
    end if;
    c.hunting := p.uid;
  else
    -- Nothing comes for you across ground it cannot stand on, and nothing
    -- comes for you at all while you are still standing on the beach.
    if at_peace(p_world, p.x, p.y) then return c; end if;
    if c.hunt_again is not null and c.hunt_again > now() then return c; end if;
    if p.d > coalesce(d.notice, hunt_sight()) then return c; end if;
    if not creature_tile_ok(p_world, floor(p.x)::int, floor(p.y)::int) then return c; end if;
    c.hunting := p.uid;
    -- Where the leash is tied.
    c.hunt_x := v_cx; c.hunt_y := v_cy;
    perform tell(p_world, p.uid, 'A ' || lower(d.name) || ' has your scent.', 'fight');
  end if;

  -- Only the last few seconds of the gap were spent on you.
  if c.until < now() - make_interval(secs => hunt_window()) then
    c.from_x := v_cx; c.from_y := v_cy; c.to_x := v_cx; c.to_y := v_cy;
    c.until := now() - make_interval(secs => hunt_window());
    c.leg_at := c.until; c.leg_ends := c.until;
  end if;

  v_pace := d.speed * a.speed * beast_mul(c, 'speed') * 1.15;
  while c.until <= now() and v_guard < 12 loop
    v_guard := v_guard + 1;
    v_dist := sqrt((p.x - c.to_x) ^ 2 + (p.y - c.to_y) ^ 2);
    if v_dist > hunt_reach() then
      -- A leg that ends a pace short of your feet, round whatever is between.
      v_ax := c.to_x + (p.x - c.to_x) * (v_dist - 1) / v_dist;
      v_ay := c.to_y + (p.y - c.to_y) * (v_dist - 1) / v_dist;
      select * into v_step from chase_leg(p_world, c.to_x, c.to_y, v_ax, v_ay);
      if v_step.x is null then
        c.hunting := null;
        exit;
      end if;
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.to_x := v_step.x; c.to_y := v_step.y;
      v_secs := greatest(0.2, sqrt((c.to_x - c.from_x) ^ 2 + (c.to_y - c.from_y) ^ 2)
                              / greatest(0.1, v_pace));
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs => v_secs);
      c.until := c.leg_ends;
    else
      perform mark_attacker(p_world, p.uid, c.id);
      perform hurt_player(p_world, p.uid, attack_of(c) * 0.012,
        'The ' || lower(d.name) || ' is on you', coalesce(d.wound, 'bite'));
      c.until := c.until + make_interval(secs => hunt_blow() / beast_mul(c, 'haste'));
    end if;
  end loop;
  return c;
end $function$

;

CREATE OR REPLACE FUNCTION public.companion_settle(p_world uuid, p_id integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; k player; q creature; guard int := 0; done int := 0;
        pace double precision; cx double precision; cy double precision;
        ax double precision; ay double precision; dist double precision; v_step record;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found or c.mode <> 'active' or c.keeper is null then return 0; end if;
  -- Under a rider or in the traces it goes where it is taken, and does no thinking.
  if c.rider is not null or c.hitched_to is not null then return 0; end if;
  select * into k from player where world_id = p_world and uid = c.keeper;
  if not found then return 0; end if;
  select * into d from species_def where id = c.species;
  pace := d.speed * (age_row(c.born)).speed * beast_mul(c, 'speed');

  while c.until <= now() and guard < 60 loop
    guard := guard + 1;
    cx := c.to_x; cy := c.to_y;

    if c.phase = 'strike' then
      -- The row goes down first: the blow settles the other one, and a kill
      -- takes the enemy off every row that had it, this one included.
      update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
          leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
          enemy = c.enemy, settled_at = now()
        where world_id = p_world and id = p_id;
      if c.enemy is not null and creature_attack(p_world, p_id, c.enemy) then done := done + 1; end if;
      select * into c from creature where world_id = p_world and id = p_id;
      c.phase := 'idle';
      c.leg_at := c.until; c.leg_ends := c.until;
      continue;
    end if;

    q := companion_target(p_world, c, k);
    if q.id is null then
      c.enemy := null;
      exit;
    end if;
    if c.enemy is distinct from q.id then
      c.enemy := q.id;
      perform tell(p_world, c.keeper, c.name || ' goes for the '
        || lower((select name from species_def where id = q.species)) || '.', 'fight');
    end if;
    ax := creature_x(q); ay := creature_y(q);
    dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
    if dist <= companion_reach() then
      c.phase := 'strike';
      c.leg_at := c.until; c.leg_ends := c.until;
      c.until := c.until + make_interval(secs => companion_blow() / beast_mul(c, 'haste'));
    else
      -- A leg that ends well inside its reach, so a thing shuffling half a
      -- step does not put it out of reach again, round whatever is between.
      select * into v_step from chase_leg(p_world, cx, cy,
        cx + (ax - cx) * (dist - companion_reach() / 2) / dist,
        cy + (ay - cy) * (dist - companion_reach() / 2) / dist);
      if v_step.x is null then
        -- Nothing open at all: the browser gives up here too.
        c.enemy := null;
        exit;
      end if;
      c.from_x := cx; c.from_y := cy;
      c.to_x := v_step.x; c.to_y := v_step.y;
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs =>
        greatest(0.2, sqrt((c.to_x - cx) ^ 2 + (c.to_y - cy) ^ 2)
                      / greatest(0.1, pace * companion_pace())));
      c.until := c.leg_ends;
    end if;
  end loop;

  if c.enemy is null then
    -- Nothing to go for: at heel, which is not a walk of its own.
    c.from_x := k.x; c.from_y := k.y; c.to_x := k.x; c.to_y := k.y;
    c.leg_at := now(); c.leg_ends := now(); c.until := now();
    c.phase := 'idle';
  elsif c.until <= now() then
    c.from_x := c.to_x; c.from_y := c.to_y;
    c.leg_at := now(); c.leg_ends := now(); c.until := now() + interval '1 second';
  end if;
  update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
      enemy = c.enemy, settled_at = now()
    where world_id = p_world and id = p_id;
  return done;
end $function$

;

CREATE OR REPLACE FUNCTION public.wound_beast(p_world uuid, p_id integer, p_dmg double precision, p_from_x double precision DEFAULT NULL::double precision, p_from_y double precision DEFAULT NULL::double precision, p_teller uuid DEFAULT NULL::uuid, p_by integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; cx double precision; cy double precision; v_taken double precision;
        v_len double precision; v_size double precision; v_killer creature;
begin
  perform creature_settle(p_world, p_id);
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  select * into d from species_def where id = c.species;
  cx := creature_x(c); cy := creature_y(c);
  -- What a blow costs it is its blood's to say, and its herd's.
  v_taken := p_dmg * beast_mul(c, 'soak');

  update creature set health = c.health - v_taken, hurt_at = now(), hurt_by = p_by,
      coaxed = 0, coaxed_at = null,
      from_x = cx, from_y = cy, to_x = cx, to_y = cy, leg_at = now(), leg_ends = now(),
      settled_at = now()
    where world_id = p_world and id = p_id;

  if c.health - v_taken > 0 then
    if c.mode = 'wild' and d.timid and p_from_x is not null then
      v_len := greatest(0.001, sqrt((cx - p_from_x) ^ 2 + (cy - p_from_y) ^ 2));
      update creature set to_x = cx + ((cx - p_from_x) / v_len) * 5, to_y = cy + ((cy - p_from_y) / v_len) * 5,
          leg_ends = now() + interval '3 seconds', until = now() + interval '3 seconds'
        where world_id = p_world and id = p_id;
    end if;
    return false;
  end if;

  -- What the carcass is worth follows the size of the thing that left it.
  v_size := (age_row(c.born)).yield;
  delete from creature where world_id = p_world and id = p_id;
  -- Nothing goes on fighting something that is no longer there.
  update creature set enemy = null where world_id = p_world and enemy = p_id;
  perform drop_on_ground(p_world, floor(cx)::int, floor(cy)::int, 'corpse',
    (15 + random() * 35) * v_size, d.name);

  -- A hunter marks where its kill went down and comes back for it.
  if p_by is not null then
    select * into v_killer from creature where world_id = p_world and id = p_by;
    -- A companion's kill is told to its keeper, who is standing right there. A
    -- worker's is not: a guard's week on a deed its keeper has left would come
    -- back as a page of them.
    if found and v_killer.mode = 'active' and v_killer.keeper is not null then
      perform tell(p_world, v_killer.keeper, v_killer.name || ' killed a wild ' || lower(d.name) || '.', 'fight');
    end if;
    if found and v_killer.carrying is null
       and (select gathers from species_def where id = v_killer.species) = 'hunt' then
      update creature set work_x = floor(cx)::int, work_y = floor(cy)::int
        where world_id = p_world and id = p_by;
      perform worker_learn(p_world, p_by, 'fighting', 0.4);
    end if;
  end if;

  /*
   * And what it was keeping, which is the other half of where a map comes
   * from. Only a monster — `species_def.monster` is already the line between
   * a thing that hunts you and a thing you could have tamed — and only to
   * whoever struck it down. The odds and the quality both come off its
   * health, which is the one number that says how big a thing was: a goblin
   * in thirty-five carries a scrap, a dragon in two carries a dragon's.
   */
  if p_teller is not null and d.monster and random() < map_chance_beast(d.health) then
    perform bury_treasure(p_world, p_teller, map_ql_beast(d.health), cx, cy);
  end if;

  if p_teller is not null then
    perform journal_note(p_world, p_teller, 'slew:' || c.species);
    if d.monster then
      perform tell(p_world, p_teller, 'The ' || lower(d.name)
        || ' goes down. Butcher it before it rots: there is a great deal on it.', 'fight');
    else
      perform tell(p_world, p_teller, 'You kill the wild ' || lower(d.name)
        || '. Its corpse lies where it fell.', 'fight');
    end if;
  end if;
  return true;
end $function$

;

select private.lock_doors();
