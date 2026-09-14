-- Swinging something, and what it leaves behind.
--
-- ## Wounds are the second thing that will not sit still
--
-- A creature moves, so it is stored as a walk. A wound *drains*, which is the
-- same problem wearing different clothes: health is not a number that sits
-- where you left it, it is a number that has been going down the whole time
-- nobody was looking. So wounds settle from a timestamp exactly as the legs
-- of a walk do — and the chance a wound goes bad, which the browser rolls
-- once a second, is rolled once over the whole elapsed stretch with the odds
-- compounded to match. One roll, the same expectation.

/* ------------------------------------------------------------------ *
 * What a thing is made of.
 * ------------------------------------------------------------------ */

/**
 * The material written on an item, as a row.
 *
 * `item.extra` holds the material the way a label does — `Oak`, `Steel` — and
 * `material_def.id` is the lower-cased form of the same word. Every lookup in
 * this database compared the two directly and so matched nothing at all: the
 * `coalesce(..., 1)` behind each one turned a miss into "made of nothing in
 * particular", which is a plausible number and therefore never noticed.
 */
create or replace function mat_of(p_extra text) returns material_def
  language sql stable as $$
  select * from material_def where id = lower(coalesce(p_extra, ''))
$$;

create or replace function mat_edge(p_extra text) returns double precision
  language sql stable as $$ select coalesce((mat_of(p_extra)).edge, 1) $$;
create or replace function mat_soak(p_extra text) returns double precision
  language sql stable as $$ select coalesce((mat_of(p_extra)).soak, 1) $$;
create or replace function mat_bane(p_extra text) returns boolean
  language sql stable as $$ select coalesce((mat_of(p_extra)).bane, false) $$;

-- The three lookups that have been quietly missing since the first migration.
create or replace function tool_worth(p_ql real, p_dmg real, p_extra text, p_rare text, p_bless real)
  returns double precision language sql stable as $$
  select least(100,
      least(100, p_ql * coalesce((mat_of(p_extra)).bite, 1))
      * rarity_boost(p_rare)
      * (1 + least(3, coalesce(p_bless, 0)) * 0.09))
    * greatest(0.3, 1 - p_dmg / 160)
$$;

/**
 * Put damage on a thing. Oak takes a third of what pine takes; seryll barely
 * marks at all — which is what the material lookup above was supposed to be
 * saying all along.
 */
create or replace function damage_item(p_item bigint, p_amount double precision) returns void
  language plpgsql as $$
declare it item;
begin
  if p_amount <= 0 then return; end if;
  select * into it from item where id = p_item;
  if not found then return; end if;
  update item set dmg = least(100, dmg + p_amount * coalesce((mat_of(it.extra)).wear, 1)
    * rarity_keep(it.rare)) where id = p_item;
  delete from item where id = p_item and dmg >= 100;
end $$;

create or replace function wear_tool(p_item bigint, p_multiplier double precision default 1)
  returns void language plpgsql as $$
declare it item;
begin
  select * into it from item where id = p_item;
  if not found then return; end if;
  perform damage_item(p_item, (0.06 + 3 / (10 + it.ql)) * p_multiplier);
end $$;

create or replace function mat_difficulty(p_extra text) returns double precision
  language sql stable as $$ select coalesce((mat_of(p_extra)).difficulty, 0) $$;

/* ------------------------------------------------------------------ *
 * What is on you and in your hands.
 * ------------------------------------------------------------------ */

create or replace function slot_of(p_def text) returns text language sql stable as $$
  select coalesce(
    (select slot from armour_def where id = p_def),
    (select 'weapon' from weapon_def where id = p_def),
    (select 'offhand' from shield_def where id = p_def),
    case when p_def = 'toolbelt' then 'belt' end)
$$;

/** What is worn or held in a slot, as an item. */
create or replace function worn(p_world uuid, p_uid uuid, p_slot text) returns item
  language sql stable as $$
  select i.* from player p
  join item i on i.id = (p.equipped->>p_slot)::bigint
    and i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
  where p.world_id = p_world and p.uid = p_uid
$$;

create or replace function two_handed_in_hand(p_world uuid, p_uid uuid) returns boolean
  language sql stable as $$
  select coalesce((select w.two_handed from weapon_def w
    where w.id = (worn(p_world, p_uid, 'weapon')).def), false)
$$;

/**
 * How much of a blow a piece of armour turns aside, given its state, what it
 * is made of and the wearer. A gold breastplate is a costly way to be killed;
 * the same plate in glimmersteel turns aside half again as much.
 */
create or replace function piece_soak(it item, p_skill double precision) returns double precision
  language sql stable as $$
  select least(0.92, c.soak * mat_soak(it.extra) * rarity_boost(it.rare)
    * (0.55 + it.ql / 220) * greatest(0.25, 1 - it.dmg / 130) * (1 + p_skill / 400))
  from armour_def a join armour_class_def c on c.id = a.cls where a.id = it.def
$$;

/**
 * Damage a weapon does in these hands, before the armour on the other side.
 * The metal of the head has as much say as the quality: a lead maul is a
 * heavy way of annoying something, and an adamantine one is not.
 */
create or replace function weapon_damage(p_world uuid, p_uid uuid, w weapon_def, it item)
  returns double precision language sql stable as $$
  select w.damage
    * case when it.id is null then 1 else mat_edge(it.extra) * rarity_boost(it.rare) end
    * (0.55 + coalesce(it.ql, 20) / 180)
    * case when it.id is null then 1 else greatest(0.4, 1 - it.dmg / 150) end
    * (0.7 + skill_of(p_world, p_uid, 'body_strength') / 90)
    * (1 + (skill_of(p_world, p_uid, w.kind) + skill_of(p_world, p_uid, 'fighting')) / 260)
$$;

/** Chance a swing lands at all: the weapon's own skill, then fighting behind it. */
create or replace function hit_chance(p_world uuid, p_uid uuid, p_kind text) returns double precision
  language sql stable as $$
  select least(0.96, 0.45 + skill_of(p_world, p_uid, p_kind) / 220
    + skill_of(p_world, p_uid, 'fighting') / 300
    + skill_of(p_world, p_uid, 'body_control') / 500)
$$;

/** Silver's old virtue: what carries its own light hates a silver edge. */
create or replace function bane_bonus() returns double precision language sql immutable as $$ select 1.5 $$;

/* ------------------------------------------------------------------ *
 * Wounds.
 * ------------------------------------------------------------------ */

create or replace function part_name(p_part text) returns text language sql immutable as $$
  select case p_part when 'arms' then 'arm' when 'legs' then 'leg' when 'feet' then 'foot'
                     when 'offhand' then 'hand' when 'weapon' then 'hand' else p_part end
$$;

/** "a deep cut to the arm, bleeding" */
create or replace function wound_text(w jsonb) returns text language sql stable as $$
  select 'a '
    || case when (w->>'severity')::double precision > 0.16 then 'deep '
            when (w->>'severity')::double precision > 0.07 then '' else 'light ' end
    || (select name from wound_kind_def where id = w->>'kind')
    || ' to the ' || part_name(w->>'part')
    || case when (w->>'infected')::boolean then ', gone bad'
            when (w->>'bleeding')::boolean then ', bleeding'
            when w->>'dressing' is not null then ', dressed' else '' end
$$;

/** What a wound is doing to you each second: blood out, or worse. */
create or replace function wound_drain(w jsonb) returns double precision language sql stable as $$
  select case when (w->>'bleeding')::boolean
           then k.bleed * (0.4 + (w->>'severity')::double precision * 3) else 0 end
       -- Something gone bad does not stop on its own, and dressing it will not do.
       + case when (w->>'infected')::boolean then k.bleed * 1.4 else 0 end
  from wound_kind_def k where k.id = w->>'kind'
$$;

/** How fast a wound closes, given what is on it. */
create or replace function wound_close(w jsonb, p_aid double precision) returns double precision
  language sql stable as $$
  select case when (w->>'infected')::boolean then 0 else
    (w->>'severity')::double precision
    * case when w->>'dressing' is null then 0.25 when w->>'dressing' = '' then 0.7
           when w->>'dressing' = k.herb then 1.6 else 0.9 end
    * (0.0006 + p_aid * 0.00002) end
  from wound_kind_def k where k.id = w->>'kind'
$$;

/**
 * The chance this wound goes bad, per second. An open wound left alone will
 * turn inside ten or twenty minutes; cloth over it is a holding measure that
 * usually holds; the wrong herb is better again; the right herb never turns.
 */
create or replace function fester_chance(w jsonb) returns double precision language sql stable as $$
  select case when (w->>'infected')::boolean or w->>'dressing' = k.herb then 0 else
    k.fester
    * case when w->>'dressing' is null then 1 when w->>'dressing' = '' then 0.12 else 0.05 end
    * (0.3 + (w->>'severity')::double precision * 2) / 60 end
  from wound_kind_def k where k.id = w->>'kind'
$$;

/** The worst wound on somebody, which is the one worth seeing to. */
create or replace function worst_wound(p_wounds jsonb) returns jsonb language sql stable as $$
  select w from jsonb_array_elements(coalesce(p_wounds, '[]'::jsonb)) w
  order by (w->>'severity')::double precision
    + case when (w->>'infected')::boolean then 1 else 0 end
    + case when (w->>'bleeding')::boolean then 0.5 else 0 end desc
  limit 1
$$;

/**
 * Everything open on somebody, brought up to the minute.
 *
 * Blood out of anything still bleeding, a little closing on anything dressed,
 * and the chance that something left alone has gone bad. The browser does
 * this every frame with a per-second chance; there is no frame here, so the
 * odds over the whole stretch are `1 - (1 - p)^seconds` and the roll happens
 * once. A wound left for ten minutes has had ten minutes to turn, whether or
 * not anybody was there to watch it.
 */
create or replace function wounds_settle(p_world uuid, p_uid uuid) returns boolean
  language plpgsql as $$
declare p player; elapsed double precision; aid double precision; w jsonb;
        out_w jsonb := '[]'::jsonb; health double precision; drained double precision := 0;
        sev double precision; turned boolean := false; kept int := 0;
begin
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found or jsonb_array_length(coalesce(p.wounds, '[]'::jsonb)) = 0 then return false; end if;
  elapsed := extract(epoch from (now() - coalesce((p.stats->>'hurtSettled')::timestamptz, p.seen_at)));
  if elapsed <= 0 then return false; end if;
  aid := skill_of(p_world, p_uid, 'first_aid');
  health := coalesce((p.stats->>'health')::double precision, 1);

  for w in select * from jsonb_array_elements(p.wounds) loop
    drained := drained + wound_drain(w) * elapsed;
    if not (w->>'infected')::boolean
       and random() < 1 - power(1 - least(0.9, fester_chance(w)), elapsed) then
      w := jsonb_set(jsonb_set(w, '{infected}', 'true'), '{dressing}', 'null'::jsonb);
      turned := true;
    end if;
    sev := (w->>'severity')::double precision - wound_close(w, aid) * elapsed;
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
end $$;

/* ------------------------------------------------------------------ *
 * Taking a blow.
 * ------------------------------------------------------------------ */

create or replace function player_die(p_world uuid, p_uid uuid) returns void
  language plpgsql as $$
declare w world;
begin
  select * into w from world where id = p_world;
  -- Whatever killed you stays with the body. The wounds that did it would
  -- open you again in a minute, and nothing you could do would be quick
  -- enough; waking up is waking up whole.
  update player set
      stats = jsonb_build_object('health', 1, 'stamina', 0.5, 'hunger', 0.6, 'thirst', 0.6,
                                 'hurtSettled', to_jsonb(now())),
      wounds = '[]'::jsonb, x = w.spawn_x + 0.5, y = w.spawn_y + 0.5, level = 0,
      act = null, act_target = null, act_started = null, act_ends = null, act_left = null,
      act_queue = '[]'::jsonb, moved_at = now()
    where world_id = p_world and uid = p_uid;
  perform tell(p_world, p_uid, 'You have died. You wake up, shivering, where you first came ashore.', 'error');
end $$;

/**
 * Hurt somebody through their armour, and say what happened.
 *
 * The shield first, then wherever it lands, then whatever is on that place —
 * and what gets through is not only a number off the bar: it leaves a wound,
 * of a kind, in the place the blow landed, and that wound has its own life.
 */
create or replace function hurt_player(p_world uuid, p_uid uuid, p_raw double precision,
                                       p_what text, p_kind text default 'bite') returns void
  language plpgsql as $$
declare p player; shield item; sh shield_def; chance double precision; roll double precision;
        part text; piece item; cls armour_class_def; soak double precision; taken double precision;
        health double precision; ws jsonb; had jsonb; found_w boolean := false; out_w jsonb := '[]'::jsonb;
        w jsonb; k wound_kind_def; note text;
begin
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found then return; end if;

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
          || lower((select name from item_def where id = shield.def)) || '.', 'error');
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
        || ' is beaten to pieces and falls away.', 'error');
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
  perform tell(p_world, p_uid, p_what || note || '. You have ' || wound_text(w) || '.', 'error');
  if health <= 0 then perform player_die(p_world, p_uid); end if;
end $$;

/* ------------------------------------------------------------------ *
 * Hurting something else.
 * ------------------------------------------------------------------ */

/** Put something down on the ground where it fell. */
create or replace function drop_on_ground(p_world uuid, p_x int, p_y int, p_def text,
    p_ql double precision, p_extra text default null, p_count int default 1) returns bigint
  language plpgsql as $$
declare new_id bigint;
begin
  insert into item (world_id, holder, gx, gy, def, ql, count, extra)
  values (p_world, 'ground', p_x, p_y, p_def, greatest(0, least(100, p_ql)), p_count, p_extra)
  returning id into new_id;
  return new_id;
end $$;

/**
 * Take a creature down, and leave the corpse where it fell.
 *
 * Nothing that has been hit takes food from the hand that hit it, and a timid
 * thing that survives the blow bolts: its next leg goes five tiles the other
 * way, at speed, which is what fleeing is once a walk is all a creature has.
 */
create or replace function hurt_creature(p_world uuid, p_id int, p_dmg double precision,
    p_by uuid default null) returns boolean
  language plpgsql as $$
declare c creature; d species_def; cx double precision; cy double precision;
        px double precision; py double precision; len double precision; size double precision;
begin
  perform creature_settle(p_world, p_id);
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  select * into d from species_def where id = c.species;
  cx := creature_x(c); cy := creature_y(c);

  update creature set health = c.health - p_dmg, hurt_at = now(), coaxed = 0, coaxed_at = null,
      from_x = cx, from_y = cy, to_x = cx, to_y = cy, leg_at = now(), leg_ends = now(),
      settled_at = now()
    where world_id = p_world and id = p_id;

  if c.health - p_dmg > 0 then
    if c.mode = 'wild' and d.timid and p_by is not null then
      select p.x, p.y into px, py from player p where p.world_id = p_world and p.uid = p_by;
      len := greatest(0.001, sqrt((cx - px) ^ 2 + (cy - py) ^ 2));
      update creature set to_x = cx + ((cx - px) / len) * 5, to_y = cy + ((cy - py) / len) * 5,
          leg_ends = now() + interval '3 seconds', until = now() + interval '3 seconds'
        where world_id = p_world and id = p_id;
    end if;
    return false;
  end if;

  -- What the carcass is worth follows the size of the thing that left it.
  size := (age_row(c.born)).yield;
  delete from creature where world_id = p_world and id = p_id;
  perform drop_on_ground(p_world, floor(cx)::int, floor(cy)::int, 'corpse',
    (15 + random() * 35) * size, d.name);
  if p_by is not null then
    if d.monster then
      perform tell(p_world, p_by, 'The ' || lower(d.name)
        || ' goes down. Butcher it before it rots: there is a great deal on it.', 'system');
    else
      perform tell(p_world, p_by, 'You kill the wild ' || lower(d.name)
        || '. Its corpse lies where it fell.', 'event');
    end if;
  end if;
  return true;
end $$;

/**
 * Settling somebody now settles what is open on them too.
 *
 * Every way into this island already calls `settle`, so this is the one place
 * that has to know: touch a player and their wounds are as they would be.
 */
create or replace function settle(p_world uuid, p_uid uuid) returns int
  language plpgsql as $$
declare p player; d action_def; done int := 0; guard int := 0; nxt jsonb; ended timestamptz;
begin
  perform wounds_settle(p_world, p_uid);
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found or p.act is null then return 0; end if;
  while p.act is not null and p.act_ends <= now() and guard < 200 loop
    guard := guard + 1;
    perform act_perform(p_world, p_uid, p.act, p.act_target);
    done := done + 1;
    select * into d from action_def where id = p.act;
    ended := p.act_ends;
    if p.act_left > 1 and act_refusal(p_world, p_uid, p.act, p.act_target) is null then
      update player set act_left = act_left - 1, act_started = ended,
             act_ends = ended + make_interval(secs => act_duration(
               d.base_time,
               case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end,
               case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end,
               control_speed(p_world, p_uid)))
        where world_id = p_world and uid = p_uid returning * into p;
    else
      if p.act_left > 1 then
        perform tell(p_world, p_uid, 'You stop ' || d.verb || '.', 'info');
      end if;
      nxt := p.act_queue -> 0;
      if nxt is null then
        update player set act = null, act_target = null, act_started = null, act_ends = null, act_left = null
          where world_id = p_world and uid = p_uid returning * into p;
      else
        select * into d from action_def where id = nxt->>'action';
        if d is null or act_refusal(p_world, p_uid, nxt->>'action', nxt->'target') is not null then
          perform tell(p_world, p_uid,
            coalesce(act_refusal(p_world, p_uid, nxt->>'action', nxt->'target'), 'That cannot be done now.'), 'error');
          update player set act = null, act_target = null, act_started = null, act_ends = null,
                 act_left = null, act_queue = act_queue - 0
            where world_id = p_world and uid = p_uid returning * into p;
        else
          update player set act = nxt->>'action', act_target = nxt->'target',
                 act_left = greatest(1, coalesce((nxt->>'goes')::int, 1)),
                 act_started = ended,
                 act_ends = ended + make_interval(secs => act_duration(
                   d.base_time,
                   case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end,
                   case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end,
                   control_speed(p_world, p_uid))),
                 act_queue = act_queue - 0
            where world_id = p_world and uid = p_uid returning * into p;
          perform tell(p_world, p_uid, 'You start ' || d.verb || '.', 'info');
        end if;
      end if;
    end if;
  end loop;
  return done;
end $$;

select private.lock_doors();
