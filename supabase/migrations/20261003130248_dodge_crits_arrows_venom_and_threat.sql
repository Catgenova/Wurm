/*
 * Dodging, critical hits, arrow heads, venom and burns, and threat.
 *
 *   * Every blow a creature lands on you is first rolled against your dodge
 *     (`dodge_chance`): `dodge_per_control` a point of body control, less
 *     `dodge_per_kg` a kilogram of armour worn (`worn_kg`), never more than
 *     `dodge_most`; a dodge teaches body control `dodge_gain`.
 *   * A blow or shot that lands is critical `crit_chance` of the time and lands
 *     `crit_hit` as hard.
 *   * Arrows come with four heads (`arrow_head_of`): a shot looses the kind
 *     asked for (`p_target.arrow`), else plain ones, else any; a broadhead
 *     bleeds as a knife does, a bodkin lands `bodkin_hide` as hard through a
 *     hide, a blunt crushes and staggers as a maul does (`side_blow`).
 *   * A venomous bite (`species_def.venom`) leaves `venom_secs` of venom in its
 *     wound, which takes `venom_drain` of your health a second while the wound
 *     is undressed (`wounds_settle`); a burn wears the armour it lands on
 *     `burn_wear` times as fast.
 *   * Threat: a wild thing turns on a tame one that hurt it (`beast_threat`,
 *     `brawl`) once what it is on has not hurt it for `threat_hold` seconds, at
 *     once for one guarding you, and fights it (`brawl_settle`); your own blow
 *     takes it back on the same terms (`engage_beast`).
 *
 * The browser does all of it off the same names in `src/game/fight.ts`.
 */
set local lock_timeout = '3s';
alter table creature add column if not exists brawl int;
alter table creature add column if not exists threat_at timestamptz;

-- Your chance of dodging a blow, for your body control and the kilograms of armour on you (`dodgeChance`).
create or replace function dodge_chance(p_control double precision, p_kg double precision) returns double precision
  language sql immutable as $$
  select greatest(0, least(dodge_most(), p_control * dodge_per_control() - p_kg * dodge_per_kg()))
$$;

-- The kilograms of armour on a body: every piece worn on the head, chest, arms, legs and feet.
create or replace function worn_kg(p_world uuid, p_uid uuid) returns double precision
  language sql stable as $$
  select coalesce(sum(idf.weight), 0)::double precision
    from unnest(array['head', 'chest', 'arms', 'legs', 'feet']) s(slot)
    cross join lateral worn(p_world, p_uid, s.slot) w
    join item_def idf on idf.id = w.def
   where w.id is not null and exists (select 1 from armour_def a where a.id = w.def)
$$;

-- The chance a landed blow of this weapon is critical, at this skill with it (`critChance`).
create or replace function crit_chance(p_skill double precision, p_weapon text, p_kind text) returns double precision
  language sql immutable as $$
  select (crit_base() + p_skill * crit_per_skill())
       * case when p_kind = 'knives' and p_weapon <> 'fist' then crit_knife() else 1 end
$$;

/*
 * Threat, from a tame creature's blow (`threat`): a wild thing turns on it when
 * what it is on has not hurt it for `threat_hold` seconds, or at once when it
 * is guarding you.
 */
create or replace function beast_threat(p_world uuid, p_id int, p_by int) returns void
  language plpgsql as $fn$
declare c creature; b creature;
begin
  select * into c from creature where world_id = p_world and id = p_id;
  select * into b from creature where world_id = p_world and id = p_by;
  if c.id is null or b.id is null or b.mode = 'wild' then return; end if;
  if c.brawl is not distinct from p_by then
    update creature set threat_at = now() where world_id = p_world and id = p_id;
    return;
  end if;
  if b.stance <> 'guard' and c.threat_at > now() - make_interval(secs => threat_hold()) then return; end if;
  update creature set brawl = p_by, threat_at = now(), windup_at = null where world_id = p_world and id = p_id;
  if b.mode = 'active' and b.keeper is not null then
    perform tell(p_world, b.keeper, 'The ' || lower((select name from species_def where id = c.species))
      || ' turns on ' || b.name || '.', 'fight');
  end if;
end $fn$;

/*
 * A wild thing fighting a tame one that hurt it (`brawlStep`): it goes to it
 * and lands its blows on its own clock until the other is gone, `fight_leash`
 * off, or it loses its nerve. Then whatever it was after before, it goes back
 * to. The row goes down before each blow, as a companion's does, so the answer
 * the blow brings settles nothing twice.
 */
create or replace function brawl_settle(p_world uuid, c creature, d species_def, a age_def) returns creature
  language plpgsql as $fn$
declare q creature; v_cx double precision; v_cy double precision; v_qx double precision; v_qy double precision;
        v_dist double precision; v_guard int := 0; v_step record; v_pace double precision; v_run double precision;
        v_id int := c.id;
begin
  select * into q from creature where world_id = p_world and id = c.brawl;
  v_cx := creature_x(c); v_cy := creature_y(c);
  if q.id is null or q.mode in ('wild', 'stored') or q.health <= 0 or q.hitched_to is not null then
    c.brawl := null;
    return c;
  end if;
  v_qx := creature_x(q); v_qy := creature_y(q);
  if sqrt((v_qx - v_cx) ^ 2 + (v_qy - v_cy) ^ 2) > fight_leash() then
    c.brawl := null;
    return c;
  end if;
  -- Its nerve, as on you (`turns_at`): it runs from what it was fighting.
  if d.hunter and c.health < max_health(c) * turns_at(d) then
    c.brawl := null; c.hunting := null; c.windup_at := null;
    c.hunt_again := now() + make_interval(secs => hunt_rest());
    v_run := d.speed * flee_pace() * flee_secs();
    v_dist := greatest(0.001, sqrt((v_cx - v_qx) ^ 2 + (v_cy - v_qy) ^ 2));
    select * into v_step from chase_leg(p_world, v_cx, v_cy,
      v_cx + (v_cx - v_qx) / v_dist * v_run, v_cy + (v_cy - v_qy) / v_dist * v_run);
    c.from_x := v_cx; c.from_y := v_cy;
    c.to_x := coalesce(v_step.x, v_cx); c.to_y := coalesce(v_step.y, v_cy);
    c.leg_at := now();
    c.leg_ends := now() + make_interval(secs => greatest(0.2, sqrt((c.to_x - v_cx) ^ 2 + (c.to_y - v_cy) ^ 2)
                                               / greatest(0.1, d.speed * a.speed * beast_mul(c, 'speed') * flee_pace())));
    c.until := greatest(c.leg_ends, now() + make_interval(secs => flee_secs()));
    if q.keeper is not null then perform tell(p_world, q.keeper, 'The ' || lower(d.name) || ' turns tail.', 'fight'); end if;
    return c;
  end if;
  -- Only the last few seconds of the gap were spent on it.
  if c.until < now() - make_interval(secs => hunt_window()) then
    c.from_x := v_cx; c.from_y := v_cy; c.to_x := v_cx; c.to_y := v_cy;
    c.until := now() - make_interval(secs => hunt_window());
    c.leg_at := c.until; c.leg_ends := c.until;
  end if;
  v_pace := d.speed * a.speed * beast_mul(c, 'speed') * 1.15;
  while c.until <= now() and v_guard < 12 loop
    v_guard := v_guard + 1;
    v_dist := sqrt((v_qx - c.to_x) ^ 2 + (v_qy - c.to_y) ^ 2);
    if v_dist <= hunt_reach() then
      c.until := c.until + make_interval(secs => blow_every(d) / beast_mul(c, 'haste'));
      update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
          leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, leg = c.leg,
          health = c.health, hunger = c.hunger, fleece = c.fleece, care = c.care,
          hunting = c.hunting, hunt_x = c.hunt_x, hunt_y = c.hunt_y, hunt_again = c.hunt_again,
          fight_blows = c.fight_blows, windup_at = c.windup_at, bleed_rate = c.bleed_rate, bleed_until = c.bleed_until,
          hurt_at = c.hurt_at, pack_lead = c.pack_lead, home_x = c.home_x, home_y = c.home_y,
          brawl = c.brawl, threat_at = c.threat_at, settled_at = now()
        where world_id = p_world and id = v_id;
      if creature_attack(p_world, v_id, q.id) then
        select * into c from creature where world_id = p_world and id = v_id;
        if c.id is not null then c.brawl := null; end if;
        return c;
      end if;
      select * into c from creature where world_id = p_world and id = v_id;
      if c.id is null or c.brawl is null then return c; end if;
      select * into q from creature where world_id = p_world and id = c.brawl;
      if q.id is null then
        c.brawl := null;
        return c;
      end if;
      v_qx := creature_x(q); v_qy := creature_y(q);
    else
      -- A leg that ends a pace short of it, round whatever is between.
      select * into v_step from chase_leg(p_world, c.to_x, c.to_y,
        c.to_x + (v_qx - c.to_x) * (v_dist - 1) / v_dist, c.to_y + (v_qy - c.to_y) * (v_dist - 1) / v_dist);
      if v_step.x is null then
        c.brawl := null;
        exit;
      end if;
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.to_x := v_step.x; c.to_y := v_step.y;
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, sqrt((c.to_x - c.from_x) ^ 2 + (c.to_y - c.from_y) ^ 2)
                                                     / greatest(0.1, v_pace)));
      c.until := c.leg_ends;
    end if;
  end loop;
  return c;
end $fn$;

CREATE OR REPLACE FUNCTION public.hurt_player(p_world uuid, p_uid uuid, p_raw double precision, p_what text, p_kind text DEFAULT 'bite'::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player; shield item; sh shield_def; chance double precision; roll double precision;
        part text; piece item; cls armour_class_def; soak double precision; taken double precision;
        health double precision; ws jsonb; had jsonb; found_w boolean := false; out_w jsonb := '[]'::jsonb;
        w jsonb; k wound_kind_def; note text; aegis double precision; v_worn double precision;
        v_from creature; v_venom boolean := false;
begin
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found then return; end if;
  -- Dodged, before anything else has its say (`dodge_chance`): your body control, less the armour on you.
  select * into v_from from creature where world_id = p_world and id = (p.stats->>'hurtBy')::int;
  if random() < dodge_chance(skill_of(p_world, p_uid, 'body_control'), worn_kg(p_world, p_uid)) then
    perform skill_raise(p_world, p_uid, 'body_control', dodge_gain());
    perform tell(p_world, p_uid, 'You dodge the '
      || coalesce((select lower(name) from species_def where id = v_from.species), 'blow') || '.', 'fight');
    perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
    return;
  end if;
  -- A venomous bite leaves venom in what it opens (`venom_secs`).
  v_venom := coalesce((select venom from species_def where id = v_from.species), false);
  -- Harder or softer for the way you stand (`stance_taken`), before anything has its say,
  p_raw := p_raw * stance_taken(p.fight_stance);
  -- and harder from something on you that is not what you are fighting: it is at your back (`flank_hit`).
  if is_fight(p.act) and p.act_target->>'kind' = 'creature' and p.stats ? 'hurtBy'
     and (p.act_target->>'id')::int is distinct from (p.stats->>'hurtBy')::int then
    p_raw := p_raw * flank_hit();
  end if;

  -- Being hit in the dark teaches more about watching than hitting does, and
  -- before the shield, because a blow you turned is still a blow you did not
  -- see coming.
  perform fought_in_dark(p_world, p_uid, dark_hit());

  /*
   * The skin a warder put over you, which takes the blow instead and is spent
   * doing it.
   *
   * Before the shield, because it is not a thing you are holding -- it is
   * between the blow and everything you are holding. A skin that covers the
   * whole blow stops it dead; one that does not goes, and what is left of the
   * blow carries on into the shield and the armour as it always did. Nothing
   * downstream of here knows it happened.
   */
  aegis := coalesce((p.stats->>'aegis')::double precision, 0);
  if aegis > 0 then
    if aegis >= p_raw then
      update player set stats = jsonb_set(stats, '{aegis}', to_jsonb(aegis - p_raw))
        where world_id = p_world and uid = p_uid;
      perform tell(p_world, p_uid, 'The ward takes ' || p_what || ', and holds.', 'fight');
      perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
      return;
    end if;
    update player set stats = jsonb_set(stats, '{aegis}', to_jsonb(0::double precision))
      where world_id = p_world and uid = p_uid;
    p_raw := p_raw - aegis;
    perform tell(p_world, p_uid, 'The ward goes with a sound like ice, and the rest of it reaches you.', 'fight');
  end if;

  -- The shield, next.
  shield := worn(p_world, p_uid, 'offhand');
  if shield.id is not null then
    select * into sh from shield_def where id = shield.def;
    if found then
      chance := least(0.6, (sh.block * (0.6 + shield.ql / 160)
        + skill_of(p_world, p_uid, 'shields') / 400)
        * class_mul(p_world, p_uid, 'guard', 'shields'))
        -- Less of one for every other thing on you than the one that struck (`crowd_block`).
        * greatest(0, 1 - crowd_block() * (select count(*) from creature o
            where o.world_id = p_world and o.hunting = p_uid and o.mode = 'wild' and o.health > 0 and o.brawl is null
              and o.id is distinct from (p.stats->>'hurtBy')::int));
      perform skill_raise(p_world, p_uid, 'shields', 0.12);
      if random() < chance then
        -- Less for a Mender's Armour Care.
        update item set dmg = least(100, dmg + p_raw * 3 * pk(p_world, p_uid, 'worn:shield', 1)) where id = shield.id;
        perform skill_raise(p_world, p_uid, 'shields', 0.5);
        perform tell(p_world, p_uid, 'You take ' || p_what || ' on your '
          || lower((select name from item_def where id = shield.def)) || '.', 'fight');
        -- A blow turned is still a blow, and you turn on whatever struck it.
        perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
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
    -- And the trade, on the line of armour this piece belongs to: a pikeman's
    -- harness does nothing for the leather an archer is wearing.
    soak := piece_soak(piece, skill_of(p_world, p_uid, cls.skill))
          * class_mul(p_world, p_uid, 'guard', cls.skill)
          -- And what this class of armour makes of this kind of blow (`armour_vs`).
          * armour_vs(cls.id, p_kind);
    -- Armour is learned by being hit in it, and worn out the same way.
    perform skill_raise(p_world, p_uid, cls.skill, 0.4);
    -- Less for a Mender's Armour Care.
    -- And a burn wears it out `burn_wear` times as fast.
    v_worn := p_raw * 4 * pk(p_world, p_uid, 'worn:armour', 1) * case when p_kind = 'burn' then burn_wear() else 1 end;
    update item set dmg = least(100, dmg + v_worn) where id = piece.id;
    if piece.dmg + v_worn >= 100 then
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
      if v_venom then w := jsonb_set(w, '{venom}', to_jsonb(venom_secs())); end if;
      found_w := true;
    end if;
    out_w := out_w || w;
  end loop;
  if not found_w then
    -- A bruise does not bleed; everything else does until it is seen to.
    w := jsonb_build_object('kind', p_kind, 'part', part, 'severity', taken,
      'bleeding', p_kind <> 'crush', 'infected', false, 'dressing', null, 'at', now())
      || case when v_venom then jsonb_build_object('venom', venom_secs()) else '{}'::jsonb end;
    out_w := out_w || w;
  end if;

  health := greatest(0, coalesce((p.stats->>'health')::double precision, 1) - taken);
  /*
   * Built from the row as it stands rather than from the copy taken at the top
   * of this function.
   *
   * `p` is a snapshot, and writing `p.stats` back puts everything in it back
   * -- including anything this function itself changed on the way down. That
   * was harmless while nothing did, and the ward is the first thing that does:
   * it was spent against the blow, and then handed straight back, so a warder's
   * skin absorbed for ever. Measured, before the fix: a 0.15 skin took 0.15 of
   * a 0.20 blow, the remaining 0.05 opened a wound as it should -- and the skin
   * read 0.15 again afterwards.
   *
   * Unqualified, `stats` is the column of the row being updated, which is the
   * live value. Nothing else in here reads it after this point.
   */
  update player set wounds = out_w,
      stats = jsonb_set(jsonb_set(stats, '{health}', to_jsonb(health)),
                        '{hurtSettled}', to_jsonb(now()))
    where world_id = p_world and uid = p_uid;
  perform tell(p_world, p_uid, p_what || note || '. You have ' || wound_text(w) || '.', 'fight');
  if health <= 0 then perform player_die(p_world, p_uid);
  else perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int); end if;
end $function$;

CREATE OR REPLACE FUNCTION public.wounds_settle(p_world uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare p player; elapsed double precision; aid double precision; w jsonb;
        out_w jsonb := '[]'::jsonb; health double precision; drained double precision := 0;
        sev double precision; turned boolean := false; kept int := 0;
begin
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found or jsonb_array_length(coalesce(p.wounds, '[]'::jsonb)) = 0 then return false; end if;
  elapsed := extract(epoch from (now() - coalesce((p.stats->>'hurtSettled')::timestamptz, p.seen_at)));
  if elapsed <= 0 then return false; end if;
  /*
   * Chirurgy, not first aid.
   *
   * Making a dressing and putting one on are two different pieces of knowledge
   * and they were one skill. The forager keeps `first_aid` -- the bandages,
   * the covers, what goes in them -- and the hands that close a wound are
   * their own trade now.
   */
  aid := skill_of(p_world, p_uid, 'chirurgy');
  health := coalesce((p.stats->>'health')::double precision, 1);

  for w in select * from jsonb_array_elements(p.wounds) loop
    drained := drained + wound_drain(w) * elapsed;
    -- Venom, for what is left of it, unless the wound is dressed (`venom_drain`).
    if coalesce((w->>'venom')::double precision, 0) > 0 then
      if w->>'dressing' is null then
        drained := drained + venom_drain() * least(elapsed, (w->>'venom')::double precision);
      end if;
      w := jsonb_set(w, '{venom}', to_jsonb(greatest(0, (w->>'venom')::double precision - elapsed)));
    end if;
    if not (w->>'infected')::boolean
       and random() < 1 - power(1 - least(0.9, fester_chance(w)), elapsed) then
      w := jsonb_set(jsonb_set(w, '{infected}', 'true'), '{dressing}', 'null'::jsonb);
      turned := true;
    end if;
    sev := (w->>'severity')::double precision
         - wound_close(w, aid) * class_mul(p_world, p_uid, 'knit', 'chirurgy') * elapsed;
    if sev > 0.004 or (w->>'infected')::boolean then
      w := jsonb_set(w, '{severity}', to_jsonb(greatest(0.004, sev)));
      out_w := out_w || w;
      kept := kept + 1;
    end if;
  end loop;

  health := greatest(0, health - drained);
  update player set wounds = out_w,
      stats = jsonb_set(jsonb_set(p.stats, '{health}', to_jsonb(health)),
                        '{hurtSettled}', to_jsonb(now()))
    where world_id = p_world and uid = p_uid;
  if turned then
    perform tell(p_world, p_uid, 'Something you have been carrying has gone bad. Lye, and then a dressing.', 'error');
  end if;
  if kept = 0 and jsonb_array_length(p.wounds) > 0 then
    perform tell(p_world, p_uid, 'The last of what you were carrying has closed over.', 'event');
  end if;
  if health <= 0 then perform player_die(p_world, p_uid); end if;
  return true;
end $function$;

create or replace function wound_text(w jsonb) returns text language sql stable as $$
  select 'a '
    || case when (w->>'severity')::double precision > 0.16 then 'deep '
            when (w->>'severity')::double precision > 0.07 then '' else 'light ' end
    || (select name from wound_kind_def where id = w->>'kind')
    || ' to the ' || part_name(w->>'part')
    || case when (w->>'infected')::boolean then ', gone bad'
            when coalesce((w->>'venom')::double precision, 0) > 0 and w->>'dressing' is null then ', with venom in it'
            when (w->>'bleeding')::boolean then ', bleeding'
            when w->>'dressing' is not null then ', dressed' else '' end
$$;

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
        top double precision; out_w jsonb; one jsonb; lye item; got text; v_bait int;
        pt player; v_other boolean; v_mend double precision; v_kind text; v_crit boolean := false; v_head text;
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
    v_landed := random() <= hit_chance(p_world, p_uid, w.kind, mark_of(held.mark, 'aim')) * beast_mul(c, 'evade');
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
      -- And harder or softer for the way you stand (`stance_dealt`).
      -- And for what its hide makes of an edge, a point or a weight, and at something whose mind is on another fight.
      -- And now and then a critical one (`crit_chance`).
      v_crit := random() < crit_chance(skill_of(p_world, p_uid, w.kind), w.id, w.kind);
      dmg := weapon_damage(p_world, p_uid, w, held) * bane * stance_dealt(p.fight_stance)
             * hide_takes(d.hide, blow_of(w.id, w.kind)) * blindside_of(c, p_uid) * (0.75 + random() * 0.5)
             * case when v_crit then crit_hit() else 1 end;
      died := hurt_creature(p_world, c.id, dmg, p_uid);
      -- And what the weapon does besides: a maul staggers, a spear holds it off, a knife opens it up (`sideBlow`).
      if not died and w.id <> 'fist' then perform side_blow(p_world, p_uid, c.id, w.kind, dmg); end if;
      -- Less for a Mender's Armour Care.
      if held.id is not null then perform damage_item(held.id, 0.35 * pk(p_world, p_uid, 'worn:weapon', 1)); end if;
      if not died then
        perform tell(p_world, p_uid, 'You strike the ' || lower(d.name)
          || case when held.id is null then '' else ' with your '
               || lower((select name from item_def where id = held.def)) end
          || case when v_crit then ', a critical blow' else '' end
          || '. It is down to ' || greatest(0, ceil(c.health - dmg)) || ' of ' || max_health(c) || '.', 'fight');
      end if;
    end if;
    /*
     * And it fights back, on its own clock rather than yours: whatever is
     * struck that does not bolt is after you now (`engage_beast`), and lands
     * its blows every `blow_every` seconds in `hunt_settle` while you are in
     * reach of it, swinging or not. It used to answer each swing with a roll.
     */
    if not coalesce(died, false) then perform engage_beast(p_world, c.id, p_uid); end if;

  elsif p_action = 'shoot_creature' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    select * into d from species_def where id = c.species;
    held := worn(p_world, p_uid, 'weapon');
    select bw.* into bow from weapon_def bw where bw.id = held.def and bw.ammo is not null;
    if not found then return; end if;
    -- The arrows asked for, else plain ones, else any (`nockedArrow`).
    select i.* into arrow from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and arrow_head_of(i.def) is not null
      order by (i.def = coalesce(p_target->>'arrow', 'arrow')) desc, (i.def = 'arrow') desc, i.ql desc limit 1;
    if arrow.id is null or not consume(p_world, p_uid, arrow.def, 1, arrow.id) then return; end if;
    v_head := arrow_head_of(arrow.def);
    dist := (select sqrt((creature_x(c) - pl.x) ^ 2 + (creature_y(c) - pl.y) ^ 2)
             from player pl where pl.world_id = p_world and pl.uid = p_uid);
    -- The far end of a bow's range is a far harder shot than the near end.
    v_landed := random() <= hit_chance(p_world, p_uid, 'archery', mark_of(held.mark, 'aim'))
                            * (1 - (dist / (coalesce(bow.range, 6) * mark_of(held.mark, 'range'))) * 0.35) * beast_mul(c, 'evade');
    perform skill_raise(p_world, p_uid, 'fighting', try_gain(v_landed, shot_fight()));
    perform skill_raise(p_world, p_uid, 'archery', try_gain(v_landed, shot_archery()));
    -- Picking a target out of the dark at range is the hardest looking there is.
    perform fought_in_dark(p_world, p_uid, dark_shot());
    if not v_landed then
      perform tell(p_world, p_uid, 'Your arrow goes wide of the ' || lower(d.name) || '.', 'fight');
    else
      -- The stave throws it; the head is what goes in. Both have a say.
      bane := case when mat_bane(arrow.extra) and d.glow is not null then bane_bonus() else 1 end;
      v_crit := random() < crit_chance(skill_of(p_world, p_uid, 'archery'), bow.id, bow.kind);
      -- And what the head is: a blunt crushes, a bodkin goes through a hide (`headBlow`, `headHide`).
      dmg := weapon_damage(p_world, p_uid, bow, held) * mat_edge(arrow.extra) * bane * stance_dealt(p.fight_stance)
             * hide_takes(d.hide, case when v_head = 'blunt' then 'crush' else blow_of(bow.id, bow.kind) end)
             * case when v_head = 'bodkin' and d.hide is not null then bodkin_hide() else 1 end
             * blindside_of(c, p_uid)
             * (0.6 + arrow.ql / 140) * (0.8 + random() * 0.4)
             * case when v_crit then crit_hit() else 1 end;
      died := hurt_creature(p_world, c.id, dmg, p_uid);
      perform damage_item(held.id, 0.25 * pk(p_world, p_uid, 'worn:weapon', 1));
      -- A broadhead bleeds it as a knife does, a blunt staggers it as a maul does (`headSide`).
      if not died and v_head in ('broadhead', 'blunt') then
        perform side_blow(p_world, p_uid, c.id, case when v_head = 'broadhead' then 'knives' else 'mauls' end, dmg);
      end if;
      if not died then
        perform tell(p_world, p_uid, 'Your arrow goes home'
          || case when v_crit then ', a critical hit' else '' end || '. The ' || lower(d.name)
          || ' is down to ' || greatest(0, ceil(c.health - dmg)) || ' of ' || max_health(c) || '.', 'fight');
      end if;
    end if;
    -- Shot at, it comes for you, as anything struck does.
    if not coalesce(died, false) then perform engage_beast(p_world, c.id, p_uid); end if;

  elsif p_action = 'butcher' then
    corpse := target_corpse(p_world, p_uid, p_target);
    sp := corpse_species(corpse.extra);
    if corpse.id is null or sp.id is null then return; end if;
    knife_ql := nullif(tool_ql(p_world, p_uid, 'butchering_knife'), 0);
    -- And more of it for a Cook's Full Carcass, and never more than all of it.
    v_share := least(1, butcher_yield(skill_of(p_world, p_uid, 'butchering'), knife_ql)
                        * pk(p_world, p_uid, 'share:butcher', 1));
    /*
     * The Butchering skill decides the quality of everything that comes off
     * the carcass, the way every trade's skill decides what it makes: with a
     * knife it is your skill, or the knife's quality spread 0.6 to 1.4 when
     * that comes out lower; bare-handed it is your skill spread the same way.
     * The corpse's own quality used to scale it down again by 0.6 to 1.0, so
     * a butcher at 100 took meat off at 66 to 80 and the skill did not decide
     * it. Asked for: "Butchering skill determines ql of Butchering output".
     */
    made_ql := product_ql(skill_of(p_world, p_uid, 'butchering'), coalesce(knife_ql, 0));
    -- What it was sleeping on, which is not a part of it at all.
    for r in select sb.n from species_butcher sb where sb.species = sp.id and sb.part = 'hoard' loop
      for v_n in 1..round(r.n * (4 + v_share * 6))::int loop
        select item into got from hoard_metal order by random() limit 1;
        perform gather(p_world, p_uid, got, 1, greatest(20, least(100, 40 + random() * 55)));
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
      -- Better for a perk on the part (a Cook's Prime Cuts and Hide Keeper).
      perform gather(p_world, p_uid, r.item, v_n,
        least(100, greatest(1, least(100, made_ql)) * pk(p_world, p_uid, 'ql:' || r.item, 1)));
      taken := taken || (case when v_n > 1 then v_n || ' × ' else '' end
        || lower((select name from item_def where id = r.item)));
    end loop;
    -- And bait for the hook out of what is left (a Cook's Bait Maker), into the pack.
    v_bait := floor(pk(p_world, p_uid, 'bait:butcher', 0))::int;
    if v_bait > 0 then
      perform give(p_world, p_uid, 'offal', v_bait, greatest(1, least(100, made_ql)));
      taken := taken || (v_bait || ' × ' || lower((select name from item_def where id = 'offal')));
    end if;
    delete from item where id = corpse.id;
    if array_length(taken, 1) is null then
      perform tell(p_world, p_uid, 'You make a mess of the ' || lower(sp.name)
        || ' carcass and salvage nothing.', 'event');
    else
      perform tell(p_world, p_uid, 'You butcher the ' || lower(sp.name) || ' and take '
        || array_to_string(taken, ', ') || ' (QL ' || to_char(greatest(1, least(100, made_ql)), 'FM990.0') || ').'
        || case when knife_ql is null then ' Bare hands waste most of a carcass.' else '' end, 'event');
    end if;
    /*
     * And what a go at it teaches, which was nothing: every other trade's
     * performer raises its own skill, and this one never did, so Butchering
     * stayed where it started on an island however much was butchered -- and
     * with it the quality of everything taken off a carcass. A full go, as
     * the browser has always counted one, whatever the carcass gave.
     */
    perform skill_raise(p_world, p_uid, 'butchering', 1);

  elsif p_action = 'bind_wound' then
    -- Your own, or somebody else's beside you for a Naturalist's Field Medic:
    -- at your first aid and out of your pack either way.
    v_other := p_target->>'kind' = 'person' and p_target->>'uid' is distinct from p_uid::text;
    if v_other then
      select * into pt from player where world_id = p_world and uid = (p_target->>'uid')::uuid;
      if not found then return; end if;
    else
      select * into pt from player where world_id = p_world and uid = p_uid;
    end if;
    hurt := worst_wound(pt.wounds);
    if hurt is null or (hurt->>'infected')::boolean then return; end if;
    use := dressing_for(p_world, p_uid, hurt);
    if use.id is null or not consume(p_world, p_uid, use.def, 1, use.id) then return; end if;
    got := case when use.def = 'cover' then lower(coalesce(use.extra, '')) else '' end;
    v_kind := (select name from wound_kind_def where id = hurt->>'kind');
    suits := got = (select herb from wound_kind_def where id = hurt->>'kind');
    -- Slips half as often for a Naturalist's Sure Hands.
    clean := perk_pass(skill_check(skill_of(p_world, p_uid, 'first_aid'), dress_check(), use.ql),
                       pk(p_world, p_uid, 'fail:bind_wound', 1));
    -- And closes faster for the hands that dressed it: a Naturalist's Quick Mend.
    v_mend := pk(p_world, p_uid, 'mend:bind_wound', 1);
    -- Cloth holds a dressing on. The right herb closes the wound.
    healed := (0.06 + (skill_of(p_world, p_uid, 'first_aid') / 100) * 0.24 + (use.ql / 100) * 0.1)
              * (case when clean then 1 else 0.35 end)
              * (case when suits then 1.5 when got <> '' then 1.1 else 1 end);
    out_w := '[]'::jsonb;
    for one in select * from jsonb_array_elements(pt.wounds) loop
      if one = hurt then
        one := jsonb_set(one, '{severity}', to_jsonb(greatest(0, (one->>'severity')::double precision - healed)));
        if clean then
          one := jsonb_set(jsonb_set(one, '{dressing}', to_jsonb(got)), '{bleeding}', 'false');
          one := case when v_mend <> 1 then jsonb_set(one, '{mend}', to_jsonb(v_mend)) else one - 'mend' end;
        end if;
      end if;
      if (one->>'severity')::double precision > 0.004 or (one->>'infected')::boolean then
        out_w := out_w || one;
      end if;
    end loop;
    update player set wounds = out_w,
        stats = jsonb_set(pt.stats, '{health}',
          to_jsonb(least(1, coalesce((pt.stats->>'health')::double precision, 1) + healed)))
      where world_id = p_world and uid = pt.uid;
    perform journal_note(p_world, p_uid, 'dressed');
    if clean and suits then perform journal_note(p_world, p_uid, 'covered'); end if;
    perform skill_raise(p_world, p_uid, 'first_aid', try_gain(clean, bandage_gain()));
    if v_other then
      perform tell(p_world, p_uid, case
        when not clean then 'The dressing slips and you make a poor job of it. ' || coalesce(pt.name, 'They')
          || ' still has ' || wound_text(hurt) || '.'
        else 'You dress the ' || v_kind || ' on ' || coalesce(pt.name, 'their') || '''s ' || part_name(hurt->>'part')
          || case when suits then ' with ' || got || ', which suits it.' when got <> '' then ' with ' || got || '.'
                  else ' with cloth.' end
        end, 'event');
      perform tell(p_world, pt.uid, coalesce(p.name, 'Somebody') || case when clean
        then ' dresses the ' || v_kind || ' on your ' || part_name(hurt->>'part') || '.'
        else ' tries to dress the ' || v_kind || ' on your ' || part_name(hurt->>'part') || ' and makes a poor job of it.' end,
        'event');
      return;
    end if;
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
        -- Scoured out, nothing of the old dressing is left on it: no salve and no quick hands.
        one := jsonb_set(jsonb_set(jsonb_set(one, '{infected}', 'false'),
          '{bleeding}', 'true'), '{dressing}', 'null'::jsonb) - 'mend' - 'salved';
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
end $function$;

CREATE OR REPLACE FUNCTION public.fight_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare it item; c creature; d species_def; w weapon_def; bow weapon_def; dist double precision;
        p player; slot text; corpse item; hurt jsonb; use item; pt player;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action in ('equip', 'unequip') then
    select * into it from item where id = target_item(p_target)
      and world_id = p_world and holder = 'player' and holder_uid = p_uid;
    if not found then return 'It is gone.'; end if;
    slot := slot_of(it.def);
    if slot is null then return 'That is not worn or wielded.'; end if;
    if p_action = 'unequip' then
      return case when (p.equipped->>slot)::bigint is distinct from it.id
                  then 'You are not wearing that.' end;
    end if;
    if (p.equipped->>slot)::bigint = it.id then return 'You already have it on.'; end if;
    if slot = 'offhand' and two_handed_in_hand(p_world, p_uid) then
      return 'Both your hands are on your weapon.';
    end if;
    return null;

  elsif p_action in ('attack_creature', 'shoot_creature', 'treat_creature') then
    perform creature_settle(p_world, (p_target->>'id')::int);
    c := target_creature(p_world, p_target);
    if c.world_id is null then return 'It is dead or gone.'; end if;
    select * into d from species_def where id = c.species;
    dist := (select sqrt((creature_x(c) - pl.x) ^ 2 + (creature_y(c) - pl.y) ^ 2)
             from player pl where pl.world_id = p_world and pl.uid = p_uid);
    if p_action = 'attack_creature' then
      if c.mode <> 'wild' then return 'That one is tame. Release it first if you mean it.'; end if;
      if dist > melee_reach(p_world, p_uid) then return 'It is out of reach.'; end if;
      return null;
    elsif p_action = 'shoot_creature' then
      if c.mode <> 'wild' then return 'That one is tame. Release it first if you mean it.'; end if;
      select bw.* into bow from weapon_def bw where bw.id = (worn(p_world, p_uid, 'weapon')).def and bw.ammo is not null;
      if not found then return 'You have no bow in your hands.'; end if;
      if coalesce((select sum(pack_count(p_world, p_uid, idf.id)) from item_def idf
                   where arrow_head_of(idf.id) is not null), 0) <= 0 then return 'You are out of arrows.'; end if;
      -- Further for the bow's maker's mark: a Carpenter's True Bow.
      if dist > coalesce(bow.range, 6) * mark_of((worn(p_world, p_uid, 'weapon')).mark, 'range') then
        return 'Too far for a ' || lower((select name from item_def where id = bow.id)) || '.';
      end if;
      if dist < 1.2 then return 'It is too close to draw on.'; end if;
      return null;
    else
      if c.mode = 'wild' then return 'It will not stand still for you while it is wild.'; end if;
      if c.health >= max_health(c) then return c.name || ' is not hurt.'; end if;
      if pack_count(p_world, p_uid, 'bandage') <= 0 then return 'You have no bandages. Cut some from cloth.'; end if;
      if dist > 1.9 then return 'You need to be beside it.'; end if;
      return null;
    end if;

  elsif p_action = 'butcher' then
    corpse := target_corpse(p_world, p_uid, p_target);
    if corpse.id is null then return 'There is nothing to butcher.'; end if;
    if (corpse_species(corpse.extra)).id is null then return 'You cannot make sense of this carcass.'; end if;
    return null;

  elsif p_action = 'bind_wound' then
    /*
     * Somebody else's, for a Naturalist's Field Medic: standing beside you,
     * at your first aid and with your dressings. What is wrong with them is
     * this side's to say; the browser knows only the perk and your pack.
     */
    if p_target->>'kind' = 'person' and p_target->>'uid' is distinct from p_uid::text then
      if pk(p_world, p_uid, 'dress_others', 0) <= 0 then
        return 'Dressing somebody else''s wounds wants a Naturalist who has learned Field Medic.';
      end if;
      if coalesce(p_target->>'uid', '') !~ '^[0-9a-f-]{36}$' then return 'They are not on this island.'; end if;
      select * into pt from player where world_id = p_world and uid = (p_target->>'uid')::uuid;
      if not found then return 'They are not on this island.'; end if;
      if sqrt((pt.x - p.x) ^ 2 + (pt.y - p.y) ^ 2) > 1.9 then return 'You need to be beside them.'; end if;
      perform wounds_settle(p_world, pt.uid);
      select * into pt from player where world_id = p_world and uid = pt.uid;
      hurt := worst_wound(pt.wounds);
      if hurt is null then return coalesce(pt.name, 'They') || ' has nothing open to dress.'; end if;
      if (hurt->>'infected')::boolean then
        return 'The ' || (select name from wound_kind_def where id = hurt->>'kind') || ' on '
          || coalesce(pt.name, 'their') || '''s ' || part_name(hurt->>'part')
          || ' has gone bad. It wants cleaning out before anything will hold on it.';
      end if;
      if (dressing_for(p_world, p_uid, hurt)).id is null then return 'You have nothing to dress it with.'; end if;
      return null;
    end if;
    perform wounds_settle(p_world, p_uid);
    select * into p from player where world_id = p_world and uid = p_uid;
    hurt := worst_wound(p.wounds);
    if hurt is null then
      return case when coalesce((p.stats->>'health')::double precision, 1) >= 0.999
        then 'There is nothing wrong with you.' else 'Nothing is open. You are only tired and thin.' end;
    end if;
    if (hurt->>'infected')::boolean then
      return 'The ' || (select name from wound_kind_def where id = hurt->>'kind')
        || ' on your ' || part_name(hurt->>'part')
        || ' has gone bad. Clean it out before anything will hold on it.';
    end if;
    use := dressing_for(p_world, p_uid, hurt);
    if use.id is null then return 'You have nothing to dress it with.'; end if;
    return null;

  elsif p_action = 'clean_wound' then
    perform wounds_settle(p_world, p_uid);
    select * into p from player where world_id = p_world and uid = p_uid;
    if not exists (select 1 from jsonb_array_elements(coalesce(p.wounds, '[]'::jsonb)) x
                   where (x->>'infected')::boolean) then
      return 'Nothing on you has gone bad.';
    end if;
    if pack_count(p_world, p_uid, 'lye_bucket') <= 0 then
      return 'You need a bucket of lye to clean it out with.';
    end if;
    return null;
  end if;
  return null;
end $function$;

create or replace function engage_beast(p_world uuid, p_id int, p_uid uuid) returns void
  language plpgsql as $fn$
declare c creature; v_timid boolean; v_pack boolean; cx double precision; cy double precision; v_name text; v_held boolean;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found or c.mode <> 'wild' or c.health <= 0 then return; end if;
  select sd.timid, sd.pack, lower(sd.name) into v_timid, v_pack, v_name from species_def sd where sd.id = c.species;
  if coalesce(v_timid, false) then return; end if;
  /*
   * Threat: it goes for whatever hurt it last, once what it is on has not
   * hurt it for `threat_hold` seconds. On something else that has, it stays on
   * that, and comes for you after.
   */
  v_held := c.threat_at > now() - make_interval(secs => threat_hold());
  if c.brawl is not null then
    if coalesce(v_held, false) then
      if c.hunting is null then
        update creature set hunting = p_uid, hunt_x = creature_x(c), hunt_y = creature_y(c), hunt_again = null
          where world_id = p_world and id = p_id;
      end if;
      return;
    end if;
    perform tell(p_world, p_uid, 'The ' || v_name || ' turns back on you.', 'fight');
  elsif c.hunting is not distinct from p_uid then
    update creature set threat_at = now() where world_id = p_world and id = p_id;
    return;
  elsif c.hunting is not null and coalesce(v_held, false) then
    return;
  end if;
  cx := creature_x(c); cy := creature_y(c);
  update creature set hunting = p_uid, hunt_x = cx, hunt_y = cy, hunt_again = null, fight_blows = 0, windup_at = null,
      brawl = null, threat_at = now(),
      pack_lead = case when coalesce(v_pack, false) then p_id end,
      from_x = cx, from_y = cy, to_x = cx, to_y = cy, leg_at = now(), leg_ends = now(),
      until = least(until, now())
    where world_id = p_world and id = p_id;
end $fn$;

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
    -- A wild thing that stands and fights turns on a tame one that hurt it (`beast_threat`).
    if c.mode = 'wild' and not coalesce(d.timid, false) and p_by is not null then
      perform beast_threat(p_world, p_id, p_by);
    end if;
    if c.mode = 'wild' and d.timid and p_from_x is not null then
      v_len := greatest(0.001, sqrt((cx - p_from_x) ^ 2 + (cy - p_from_y) ^ 2));
      update creature set to_x = cx + ((cx - p_from_x) / v_len) * 5, to_y = cy + ((cy - p_from_y) / v_len) * 5,
          leg_ends = now() + interval '3 seconds', until = now() + interval '3 seconds'
        where world_id = p_world and id = p_id;
    end if;
    return false;
  end if;

  -- What the carcass is worth follows the size of the thing that left it.
  v_size := (age_row(c.born, old_of(c))).yield;
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
end $function$;

CREATE OR REPLACE FUNCTION public.creature_settle(p_world uuid, p_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; a age_def; elapsed double precision; top double precision;
        guard int := 0; n int; i int; nx double precision; ny double precision;
        dist double precision; secs double precision; pace double precision; ok boolean;
        home record; ax double precision; ay double precision; v_rig placed; v_bled double precision;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  select * into d from species_def where id = c.species;
  a := age_row(c.born, old_of(c));
  /*
   * In the traces until somebody takes it out.
   *
   * A hitch was a column and nothing else read it: the settle below went on
   * walking a companion to its keeper's feet and sending a worker out to its
   * trade, so an animal backed into a yoke was at its owner's heels a second
   * later, still hitched to a wagon it was nowhere near. It stands at the
   * vehicle now, thinks nothing, and does not get hungry, until `unhitch_one`
   * or `unhitch_all` takes it out -- or what it was hitched to is gone, in
   * which case there is nothing left to be in the traces of.
   */
  if c.hitched_to is not null then
    select * into v_rig from placed where world_id = p_world and id = c.hitched_to;
    if not found then
      update creature set hitched_to = null where world_id = p_world and id = p_id;
      c.hitched_to := null;
    end if;
  end if;
  elapsed := extract(epoch from (now() - c.settled_at));
  if elapsed <= 0 then
    -- Nothing has passed for the body — but a worker's day is not its body,
    -- and the trips it is owed are still owed. One in the traces owes none.
    if c.hitched_to is not null then return false; end if;
    if c.mode = 'deed' then perform worker_settle(p_world, p_id);
    elsif c.mode = 'active' then perform companion_settle(p_world, p_id); end if;
    return false;
  end if;

  -- The body: hunger falling, wounds closing, fleece coming back, and a
  -- brushing wearing off. None of it needs a step; it is all just elapsed time.
  top := max_health(c);
  /*
   * A knife's bleeding, for the part of the time since the last settle that it
   * ran, and never the last of it: what finishes a thing is a blow. While it
   * bleeds it is hurt, so it mends nothing (`KNIFE_BLEED`).
   */
  if c.bleed_until is not null then
    v_bled := extract(epoch from (least(now(), c.bleed_until) - c.settled_at));
    if v_bled > 0 then
      if c.health > 1 then c.health := greatest(1, c.health - coalesce(c.bleed_rate, 0) * v_bled); end if;
      c.hurt_at := greatest(coalesce(c.hurt_at, c.settled_at), least(now(), c.bleed_until));
    end if;
    if c.bleed_until <= now() then c.bleed_until := null; c.bleed_rate := null; end if;
  end if;
  -- Except in the traces, where the belly holds where it was when it went in.
  if c.hitched_to is null then
    -- Hungry slower for its keeper's Light Eaters.
    c.hunger := greatest(0, c.hunger - elapsed * hunger_rate(c.mode) * beast_mul(c, 'appetite')
                                   * coalesce((c.kept->>'kept:hunger')::double precision, 1));
  end if;
  if c.health > top then
    c.health := top;
  elsif c.health < top and (c.hurt_at is null or now() - c.hurt_at > interval '6 seconds') then
    c.health := least(top, c.health + elapsed * case when c.mode = 'wild' then 0.25 else 0.6 end * beast_mul(c, 'mend'));
  end if;
  if d.fleece is not null and a.growth > 0 and c.fleece < 1 then
    c.fleece := least(1, c.fleece + elapsed * d.fleece * a.growth * beast_mul(c, 'grow'));
  end if;
  -- A brushing wears off over a few hours: longer for its keeper's Lasting Care.
  c.care := greatest(0, c.care - elapsed / (coalesce((c.kept->>'kept:care_hours')::double precision, care_hours()) * 3600));
  /*
   * And a hungry one on a deed goes to the stores.
   *
   * Written on the row rather than on `c`, so the settle below does not carry
   * the old belly back over it. Only when it is actually hungry, which for a
   * worker is an hour or so apart — this is not a cost anybody pays on a beat.
   */
  if c.mode <> 'wild' and c.hitched_to is null and c.hunger < graze_hungry() then
    if worker_feed(p_world, p_id) is not null then
      c.hunger := least(1, c.hunger + graze_fill());
    end if;
  end if;

  -- And no further: it stands at the vehicle, the body settled and nothing else.
  if c.hitched_to is not null then
    update creature set
        from_x = v_rig.cx, from_y = v_rig.cy, to_x = v_rig.cx, to_y = v_rig.cy,
        leg_at = now(), leg_ends = now(), until = now(),
        health = c.health, fleece = c.fleece, care = c.care,
        enemy = null, hunting = null, settled_at = now()
      where world_id = p_world and id = p_id;
    return true;
  end if;

  if c.mode = 'wild' then
    -- A hunter looks for you; anything else you struck that stands and fights is after you already (`engage_beast`).
    -- A tame thing that hurt it, first, while it is on one (`brawl_settle`).
    if c.brawl is not null then c := brawl_settle(p_world, c, d, a); end if;
    if c.id is not null and c.brawl is null and (d.hunter or c.hunting is not null) then c := hunt_settle(p_world, c, d, a); end if;
  else
    c.hunting := null;
    c.brawl := null;
  end if;

  if c.mode = 'wild' and c.hunting is null and c.brawl is null then
    pace := d.speed * a.speed * beast_mul(c, 'speed') * 0.7;
    while c.until <= now() and guard < catch_up_legs() loop
      guard := guard + 1;
      n := c.leg + 1;
      ok := false;
      -- A step about its own country rather than a step from wherever it
      -- last got to. Past the edge of its range it draws towards home
      -- instead, which is what keeps an island's wildlife somewhere in
      -- particular. A creature from before homes existed takes where it
      -- stands, which is what it would have had anyway.
      if c.home_x is null then c.home_x := c.to_x; c.home_y := c.to_y; end if;
      -- A pack keeps closer to home, so that it is met together (`pack_range`).
      if (c.to_x - c.home_x) ^ 2 + (c.to_y - c.home_y) ^ 2 > (case when d.pack then pack_range() else wild_range() end) ^ 2 then
        ax := c.home_x; ay := c.home_y;
      else
        ax := c.to_x; ay := c.to_y;
      end if;
      for i in 0..7 loop
        nx := ax + (hash_tile(p_id, n, 7001 + i) * 2 - 1) * wild_reach();
        ny := ay + (hash_tile(p_id, n, 9001 + i) * 2 - 1) * wild_reach();
        if creature_tile_ok(p_world, floor(nx)::int, floor(ny)::int)
           and line_clear(p_world, c.to_x, c.to_y, nx, ny) then ok := true; exit; end if;
      end loop;
      c.leg := n;
      if not ok then
        -- Hemmed in: stand where it is and look again in a moment.
        c.from_x := c.to_x; c.from_y := c.to_y;
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '2 seconds';
        continue;
      end if;
      -- It feeds itself on the way. The browser walks it to a forage bed,
      -- grazes for a few seconds and tops the belly up; out here the leg that
      -- ends on ground worth grazing is the same thing without the detail.
      if c.hunger < graze_hungry() and coalesce((select forage from tile_def
            where id = land_tile(p_world, floor(nx)::int, floor(ny)::int)), false) then
        c.hunger := least(1, c.hunger + graze_fill());
      end if;
      dist := sqrt((nx - c.to_x) ^ 2 + (ny - c.to_y) ^ 2);
      secs := greatest(0.2, dist / greatest(0.1, pace));
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.to_x := nx; c.to_y := ny;
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs => secs);
      c.until := c.leg_ends + make_interval(secs => wild_rest() + hash_tile(p_id, n, 11001) * wild_rest_spread());
    end loop;
    /*
     * And past the cap it is where it got to, and the clock catches up with
     * it. This line is the whole reason the cap can come down: it was already
     * here, and it was already the answer for anything more than forty legs
     * behind. Forty was doing an eighth of a second of arithmetic to reach an
     * answer this line gives for nothing.
     *
     * Measured, on a creature an hour behind: 109.10 ms with the cap at forty,
     * against 4.78 ms for one a second behind. Every one of those legs is a
     * random step inside a home range nobody was standing in.
     */
    if c.until <= now() then
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.leg_at := now(); c.leg_ends := now();
      c.until := now() + make_interval(secs => 1 + hash_tile(p_id, c.leg, 11001) * 5);
    end if;
  elsif c.mode = 'active' and c.keeper is not null and c.enemy is null then
    -- A companion is wherever its keeper is; following is not a walk of its own.
    -- A fight is, and one with something in its teeth keeps the legs it has:
    -- `companion_settle`, below, walks it, strikes, and brings it back to heel.
    select p.x, p.y into home from player p where p.world_id = p_world and p.uid = c.keeper;
    -- Piers: but not onto a tile on piers, where it does not go: it waits where it is (`creature_tile_ok`).
    if found and not on_piers(p_world, floor(home.x)::int, floor(home.y)::int) then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      c.leg_at := now(); c.leg_ends := now(); c.until := now();
    end if;
  elsif c.mode = 'stored' then
    -- In a crate: where the crate stands, or at the feet of whoever carries it.
    select pl.cx as x, pl.cy as y into home from placed pl where pl.world_id = p_world and pl.creature = p_id limit 1;
    if not found then
      select py.x, py.y into home from player py where py.world_id = p_world and py.uid = c.keeper;
    end if;
    if found then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      -- A crated one never walks, so it is not asked every round.
      c.leg_at := now(); c.leg_ends := now(); c.until := now() + make_interval(secs => stored_settle());
    end if;
  end if;

  update creature set
      from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, leg = c.leg,
      health = c.health, hunger = c.hunger, fleece = c.fleece, care = c.care,
      hunting = c.hunting, hunt_x = c.hunt_x, hunt_y = c.hunt_y, hunt_again = c.hunt_again,
      fight_blows = c.fight_blows, windup_at = c.windup_at, bleed_rate = c.bleed_rate, bleed_until = c.bleed_until,
      hurt_at = c.hurt_at, pack_lead = c.pack_lead, brawl = c.brawl, threat_at = c.threat_at,
      home_x = c.home_x, home_y = c.home_y,
      settled_at = now()
    where world_id = p_world and id = p_id;
  -- And then the day's work, for whichever of them is on a deed rather than
  -- out in the country. The row goes down first because the work reads it back.
  if c.mode = 'deed' then perform worker_settle(p_world, p_id);
  -- And a companion's company, which is the one thing at heel that is a walk of its own.
  elsif c.mode = 'active' then perform companion_settle(p_world, p_id); end if;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_creatures(p_world uuid, p_range double precision DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  /*
   * And the wildlife is not moved from in here any more.
   *
   * This is a read. It ran `creature_sweep`, which settles every creature in
   * forty tiles whose turn is due — up to a hundred and twenty of them, each
   * one a piece of animal thinking, some of it pathing. On the call a browser
   * makes every second, for every player, while the browser waits for the
   * answer.
   *
   * And `world_tick` already does it. It takes the same list of live bodies,
   * dedupes them onto their tiles, and sweeps forty tiles round each one, once
   * a second, on a clock nobody is waiting for. So this was the same work a
   * second time, on the worst possible thread to do it on: measured here at
   * 257 to 466 ms a call against 2.7 ms for the ground read beside it, which
   * is why an island would hand over a deed in a few seconds and its wildlife
   * not at all — eight PostgREST slots, and this sitting in them.
   *
   * Where there is no `pg_cron` there is no other clock, so it still happens
   * here: the suite's bare postgres and any project without the extension are
   * exactly as they were. The guard is the one `world_tick` already uses for
   * the stocking, for the same reason and with the same shape.
   */
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform creature_sweep(p_world, p.x, p.y, p_range);
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'species', c.species, 'name', c.name, 'variant', c.variant,
      'mode', c.mode, 'stance', c.stance, 'job', c.job, 'shod', shod(c), 'tack', c.tack,
      'x', creature_x(c), 'y', creature_y(c),
      'fromX', c.from_x, 'fromY', c.from_y, 'toX', c.to_x, 'toY', c.to_y,
      /*
       * How long the leg is and how much of it is left, in seconds.
       *
       * It used to hand over the two instants themselves, which asks a browser
       * to agree with this database about what time it is. A phone whose clock
       * is twenty seconds out pins every leg at one end or the other and then
       * re-pins it on the next answer, which reads as a thing jumping about —
       * and the action bar learnt this lesson already: "a browser whose clock
       * is a minute out still draws the right bar".
       */
      'legFor', case when c.leg_ends > c.leg_at
                     then extract(epoch from (c.leg_ends - c.leg_at)) else 0 end,
      'legLeft', greatest(0, extract(epoch from (c.leg_ends - now()))),
      'health', c.health, 'max', max_health(c), 'hunger', c.hunger,
      'sex', c.sex, 'age', age_of(c.born, old_of(c)), 'traits', c.traits,
      'hunting', c.hunting = me, 'mine', coalesce(c.keeper = me, false),
      -- How long is left of a heavy blow it is drawing back for, so it can be seen coming.
      'windup', case when c.windup_at > now() then extract(epoch from (c.windup_at - now())) end,
      -- Which one leads the pack it hunts with, which the browser says of the leader.
      'lead', c.pack_lead,
      -- And the tame one it has turned on, when it has.
      'brawl', c.brawl,
      -- What its keeper's perks make of keeping it, which the browser ages and feeds it by.
      'kept', c.kept,
      -- Which vehicle it is in the traces of, which no browser has ever been told.
      'hitchedTo', c.hitched_to)
      /*
       * And, for your own only, what the card has been making up.
       *
       * A worker's trade, its learning, its brushing and what is in its arms
       * are all here and none of them have ever gone out, so the browser
       * filled them in from the book: every wildermon on an island read
       * Foraging 1.00, Experience 0.0, Care 0% and "Looking for work", however
       * long it had been at it. Yours only, because it is a card you open
       * about your own and nobody needs five numbers about a wild boar.
       */
      || case when c.keeper = me then jsonb_build_object(
           'care', c.care, 'xp', c.xp, 'skills', c.skills,
           'phase', c.phase, 'carrying', c.carrying,
           -- What it is fighting, for the line drawn to it.
           'enemy', c.enemy)
         else '{}'::jsonb end
      /*
       * And its pedigree, for anything bred: whole for your own, and for
       * anybody else's saying where a trait came from only for the traits
       * you can read, by the rule the card's chips keep.
       */
      || case when c.pedigree is null then '{}'::jsonb
              when c.keeper = me then jsonb_build_object('pedigree', c.pedigree)
              else jsonb_build_object('pedigree', pedigree_seen(p_world, me, c.pedigree)) end
      -- And how rare it came into the world, for a rare one: the browser draws it bigger and shining, and reckons with it.
      || case when c.rare is null then '{}'::jsonb else jsonb_build_object('rare', c.rare) end
      order by c.id)
    from creature c
    -- Your own in crates, wherever the crates are; and everything within range.
    where (c.world_id = p_world and c.keeper = me and c.mode = 'stored')
       or (c.world_id = p_world
      /*
       * Where the leg ends, first, because that is what there is an index on.
       *
       * The exact answer below is where the thing is *now*, which is a point
       * on the leg it is walking and so a function of four columns and the
       * clock — nothing a btree can help with, and it was being worked out for
       * every creature on the island before being thrown away. This narrows to
       * the neighbourhood first, generously: `leg_slack` is far longer than
       * any leg the rules make (the longest measured on a real island is 2.13
       * tiles), and anything walking further than that in one leg was already
       * invisible to `creature_sweep`, which has bounded itself this way since
       * it was written.
       */
      and c.to_x between p.x - (p_range + leg_slack()) and p.x + (p_range + leg_slack())
      and c.to_y between p.y - (p_range + leg_slack()) and p.y + (p_range + leg_slack())
      and greatest(abs(creature_x(c) - p.x), abs(creature_y(c) - p.y)) <= p_range)), '[]'::jsonb);
end $function$;
