-- You turn on whatever bites you
--
-- Asked for: "players automatically attack back when attacked". A hunter's
-- bite marked you as struck and hurt you, and that was the whole of it: you
-- stood there being eaten until you clicked. Now a blow taken from something
-- wild turns you on it (`fight_back`, from `hurt_player`, on a blow that
-- lands and on one your shield turns): whatever was in hand goes to the
-- front of the line to be picked up again after, and you swing at it
-- `fight_back_goes` times, or until the first refusal — dead, gone, out of
-- reach — ends the run as it ends any run of goes. The next bite starts it
-- again. A swing already aimed at it is left alone; a companion that nipped
-- you, a body with no wind left, a thing already dead, are no fight. The
-- browser does the same in a game of its own, off the same number.
--
-- Found on the way: the suite's hunting subject (294–299) had been measuring
-- nothing since the beach went quiet. `peace_reach` is twenty-four tiles and
-- the suite's second island is sixteen across, so the whole of it was at
-- peace and nothing wild ever came for anybody. The suite moves that
-- island's beach off the map for the length of the subject, and the ulva
-- hunts again — which is how the bite below got measured at all.

/*
 * Turn on whatever just bit you.
 *
 * Asked for: "players automatically attack back when attacked". Whoever hurt
 * you was marked before the blow (`mark_attacker`, `stats.hurtBy`); if it is
 * something wild and you are not already swinging at it, whatever was in
 * hand goes to the front of the line to be picked up again after, and you
 * swing at it `fight_back_goes` times or until the first refusal — dead,
 * gone, out of reach — ends the run, as it ends any run of goes.
 *
 * Not through the ordinary door. `fight_refusal` walks the creature forward
 * before it looks at it, and this is called from inside that walk: the
 * hunter's own `creature_settle` is mid-bite, its row not yet written, and
 * settling it again from here ran the same ten seconds of biting over again
 * from the top — eighty-eight blows where there should have been seven. So
 * the guards here are the door's without the walk: alive, with wind, at
 * something wild and living, not already swinging at it. Reach is not
 * asked: the bite is the proof of it, and the first go of the swing asks
 * again through the door proper, by which time the row is written. The
 * browser's `fightBack` is the same rule off the same number.
 */
CREATE OR REPLACE FUNCTION public.fight_back(p_world uuid, p_uid uuid, p_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare p player; c creature; d action_def; v_target jsonb; secs double precision; s double precision;
        tq double precision; v_species text;
begin
  if p_id is null then return false; end if;
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found or coalesce((p.stats->>'health')::double precision, 1) <= 0 then return false; end if;
  if coalesce((p.stats->>'stamina')::double precision, 1) < exhausted() then return false; end if;
  select * into c from creature where world_id = p_world and id = p_id;
  if not found or c.mode <> 'wild' or c.health <= 0 then return false; end if;
  v_target := jsonb_build_object('kind', 'creature', 'id', p_id);
  -- Already at it: nothing to change.
  if p.act = 'attack_creature' and (p.act_target->>'id')::int = p_id then return false; end if;
  select * into d from action_def where id = 'attack_creature';
  s := case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end;
  secs := act_duration(d.base_time, s, tq, control_speed(p_world, p_uid));
  update player set
      -- What was in hand goes to the front of the line, to be picked up again after.
      act_queue = case when p.act is null then p.act_queue
                       else jsonb_build_array(jsonb_build_object('action', p.act, 'target', p.act_target,
                                                                 'goes', greatest(1, coalesce(p.act_left, 1)))) || p.act_queue end,
      act = 'attack_creature', act_target = v_target, act_started = now(),
      act_ends = now() + make_interval(secs => secs),
      act_left = fight_back_goes()::int, act_goes = fight_back_goes()::int
    where world_id = p_world and uid = p_uid;
  select lower(sd.name) into v_species from species_def sd where sd.id = c.species;
  perform tell(p_world, p_uid, 'You turn on the ' || coalesce(v_species, 'thing') || '.', 'fight');
  return true;
end $function$;

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
  if health <= 0 then perform player_die(p_world, p_uid);
  else perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int); end if;
end $function$

;

select private.lock_doors();
