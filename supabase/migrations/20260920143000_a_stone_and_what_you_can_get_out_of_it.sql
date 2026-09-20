-- A stone, and what you can get out of it
--
-- The three schools of the one art, and the system under them. There is no
-- mana here, no pool, no bar that fills while you stand about. Everything else
-- on this island came out of the ground and was worked, and there was no
-- reason for this to be different.
--
-- ## The stone is the magazine
--
-- A focus is a cut gem in a silver claw, and every number the system needs was
-- already on it:
--
--     the kind   item.extra   which spells it will carry
--     the cut    item.ql      how little each cast wastes
--     the find   item.rare    how many casts are in it at all
--     the wear   item.dmg     how much of it is left
--
-- A focus worn through to a hundred crumbles down the same path that takes a
-- rotten haunch off the ground, which was rebuilt this morning and wanted
-- nothing adding for this. **No new table, no new timestamp, no new sweeper**
-- -- the resource is an item, and items already wear out.
--
-- ## Which makes it an economy rather than a meter
--
-- A miner digs the stone, at the rarities mining has always given them -- one
-- in sixteen for a diamond. An artisan cuts it and sets it. The three schools
-- burn it. That is a supply chain across three trades that all existed before
-- this file, and it is the whole of what stops a mage casting for ever.
--
-- The small spell of each school is cast out of the commoner of its two stones
-- and the large one out of the rarer, so what a mage can do on a given day is
-- decided by what came out of the rock rather than by a cooldown.
--
-- ## And the land pays part of the cost
--
-- A stone gives up what is in it more easily on high ground and in the dark.
-- That is the one place in this game where *where you are standing* changes
-- what you can do -- and it is deliberately a different axis from faith, which
-- already has its own: an altar, and the hours either side of the sun.
--
-- Capped and floored both ways: a mountain is worth what a hill and a half is,
-- and the worst place to stand is about a third dearer than the best rather
-- than useless.
--
-- ## Six spells, and not one new way of hurting anybody
--
--     ember       garnet    a burn on one thing at five tiles
--     pyre        ruby      a burn on everything within three
--     snare       sapphire  one thing stands still for eight seconds
--     stillfield  diamond   everything within three stands still, for five
--     aegis       topaz     a skin on you that eats twenty damage and goes
--     bulwark     emerald   the same skin over everybody within three
--
-- A burn is a wound the island already had a kind for, with sage as its cover.
-- A hold is the same `until` the clock already reads before it settles an
-- animal -- set it forward and the animal is simply not due, which is what
-- standing still *is* here. And a skin is a number taken off a blow before the
-- shield, in `hurt_player`, which is the one function every blow already
-- arrives at.
--
-- ## Three channels, shared between the three schools
--
--     force   what a spell does when it arrives   spell_force
--     reach   how far it carries                  spell_range
--     thrift  how little of the stone it takes    spell_wear
--
-- They are the same three for all three schools, and that is the honest shape
-- of it: a kindler and a warder are not two kinds of person with different
-- hands, they are two people who learned different things to say to a stone.
-- The scope key keeps a kindler's thrift out of a warder's topaz, and the
-- spell list is what actually separates them.

set local lock_timeout = '3s';

/**
 * What the ground under you is worth to a stone: high, and dark.
 */
create or replace function land_ease(p_world uuid, p_x int, p_y int) returns double precision
  language sql stable as $fn$
  select greatest(0.6, 1
    - least(60, greatest(0, land_height(p_world, p_x, p_y) - 20)) / 300.0
    - darkness(p_world) * 0.22)
$fn$;

/**
 * How much of itself a stone gives up for one cast.
 *
 * A better cut wastes less and a rarer find holds more, which is the whole of
 * why anybody would want either. Floored, so no stone is ever free.
 */
create or replace function spell_wear(p_world uuid, p_uid uuid, d spell_def, it item)
  returns double precision language sql stable as $fn$
  select greatest(0.2, d.wear * (1.6 - coalesce(it.ql, 1) / 125.0) / rarity_boost(it.rare)
    * land_ease(p_world, floor((select x from player where world_id = p_world and uid = p_uid))::int,
                        floor((select y from player where world_id = p_world and uid = p_uid))::int)
    * class_mul(p_world, p_uid, 'thrift', (select skill from school_def where id = d.school)))
$fn$;

/** What the spell does, before anything gets in the way of it. */
create or replace function spell_force(p_world uuid, p_uid uuid, d spell_def, it item)
  returns double precision language sql stable as $fn$
  select d.power
    * (0.45 + skill_of(p_world, p_uid, (select skill from school_def where id = d.school)) / 110.0)
    * (0.7 + coalesce(it.ql, 1) / 170.0)
    * class_mul(p_world, p_uid, 'force', (select skill from school_def where id = d.school))
$fn$;

/** And how long its mark lasts, where it leaves one. */
create or replace function spell_secs(p_world uuid, p_uid uuid, d spell_def)
  returns double precision language sql stable as $fn$
  select d.secs
    * (0.6 + skill_of(p_world, p_uid, (select skill from school_def where id = d.school)) / 140.0)
    * class_mul(p_world, p_uid, 'force', (select skill from school_def where id = d.school))
$fn$;

/** How far it carries. */
create or replace function spell_range(p_world uuid, p_uid uuid, d spell_def)
  returns double precision language sql stable as $fn$
  select d.range * class_mul(p_world, p_uid, 'reach', (select skill from school_def where id = d.school))
$fn$;

/**
 * The stone in your pack a spell would be cast out of.
 *
 * The best cut first, because a better cut wastes less and there is no reason
 * to burn the good one last. A stone already worn through is not offered;
 * something else will delete it soon enough.
 */
create or replace function focus_for(p_world uuid, p_uid uuid, p_gem text) returns item
  language sql stable as $fn$
  select i.* from item i
   where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
     and i.def = 'focus' and lower(coalesce(i.extra, '')) = p_gem
     and coalesce(i.dmg, 0) < 100 and not i.locked
   order by i.ql desc nulls last, i.dmg, i.id limit 1
$fn$;

/**
 * Why a spell cannot be cast, or nothing. The same three sentences
 * `spellRefusal` builds on the browser's side.
 */
create or replace function spell_refusal(p_world uuid, p_uid uuid, p_spell text) returns text
  language plpgsql stable as $fn$
declare d spell_def; sc school_def; p player; v_mine text; it item;
begin
  select * into d from spell_def where id = p_spell;
  if not found then return 'There is no such spell.'; end if;
  select * into sc from school_def where id = d.school;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 'You are not on this island.'; end if;
  v_mine := p.combat_class;
  if v_mine is distinct from (select id from class_def where main = sc.skill) then
    return d.name || ' is ' || lower(sc.name) || ', and you are not of it.';
  end if;
  if skill_of(p_world, p_uid, sc.skill) < d.level then
    return d.name || ' takes ' || d.level::int || ' ' || sc.id || '; you have '
        || floor(skill_of(p_world, p_uid, sc.skill))::int || '.';
  end if;
  it := focus_for(p_world, p_uid, d.gem);
  if it.id is null then
    return d.name || ' is cast out of ' || d.gem || '. You are carrying no ' || d.gem || ' focus.';
  end if;
  return null;
end $fn$;

/**
 * Cast it.
 *
 * Three effects, one per school, each landing on machinery that was already
 * there: a wound, an `until`, and a number taken off the next blow.
 */
create or replace function do_spell(p_world uuid, p_uid uuid, p_spell text, p_target jsonb)
  returns text language plpgsql as $fn$
declare d spell_def; p player; it item; v_force double precision; v_secs double precision;
        v_rng double precision; v_n int := 0; c creature; r record; v_name text;
        v_cx double precision; v_cy double precision;
begin
  select * into d from spell_def where id = p_spell;
  select * into p from player where world_id = p_world and uid = p_uid;
  it := focus_for(p_world, p_uid, d.gem);
  v_force := spell_force(p_world, p_uid, d, it);
  v_secs := spell_secs(p_world, p_uid, d);
  v_rng := spell_range(p_world, p_uid, d);
  v_name := 'it';

  if d.school = 'kindling' then
    if d.at_what = 'creature' then
      select * into c from creature where world_id = p_world and id = (p_target->>'id')::int;
      if not found then return 'There is nothing there.'; end if;
      v_name := lower((select name from species_def where id = c.species));
      perform wound_beast(p_world, c.id, v_force, p.x, p.y, p_uid, null);
      v_n := round(v_force);
    else
      for c in select * from creature where world_id = p_world and mode = 'wild'
          and to_x between p.x - v_rng and p.x + v_rng
          and to_y between p.y - v_rng and p.y + v_rng loop
        perform wound_beast(p_world, c.id, v_force, p.x, p.y, p_uid, null);
        v_n := v_n + 1;
      end loop;
    end if;

  elsif d.school = 'binding' then
    /*
     * A hold is the `until` the clock already reads before it settles an
     * animal: set it forward and the animal is simply not due, which is what
     * standing still is here. The leg it was on is ended where it had got to,
     * so it stops rather than sliding on to wherever it was going.
     */
    if d.at_what = 'creature' then
      select * into c from creature where world_id = p_world and id = (p_target->>'id')::int;
      if not found then return 'There is nothing there.'; end if;
      v_name := lower((select name from species_def where id = c.species));
      v_cx := creature_x(c); v_cy := creature_y(c);
      update creature set until = now() + make_interval(secs => v_secs),
             from_x = v_cx, from_y = v_cy, to_x = v_cx, to_y = v_cy,
             leg_at = now(), leg_ends = now(), enemy = null, hunting = null
        where world_id = p_world and id = c.id;
      v_n := round(v_secs);
    else
      for c in select * from creature where world_id = p_world and mode = 'wild'
          and to_x between p.x - v_rng and p.x + v_rng
          and to_y between p.y - v_rng and p.y + v_rng loop
        v_cx := creature_x(c); v_cy := creature_y(c);
        update creature set until = now() + make_interval(secs => v_secs),
               from_x = v_cx, from_y = v_cy, to_x = v_cx, to_y = v_cy,
               leg_at = now(), leg_ends = now(), enemy = null, hunting = null
          where world_id = p_world and id = c.id;
        v_n := v_n + 1;
      end loop;
    end if;

  else
    -- Warding. The greater of what is already over you and what this would put
    -- there, so casting it again refreshes the skin rather than stacking one
    -- inside another.
    if d.at_what = 'self' then
      update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{aegis}',
          to_jsonb(greatest(coalesce((stats->>'aegis')::double precision, 0), v_force)))
        where world_id = p_world and uid = p_uid;
      v_n := round(v_force);
    else
      for r in select uid from player where world_id = p_world and not away
          and x between p.x - v_rng and p.x + v_rng
          and y between p.y - v_rng and p.y + v_rng loop
        update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{aegis}',
            to_jsonb(greatest(coalesce((stats->>'aegis')::double precision, 0), v_force)))
          where world_id = p_world and uid = r.uid;
        if r.uid <> p_uid then
          perform tell(p_world, r.uid, 'Something closes over you, put there by somebody else.', 'system');
        end if;
        v_n := v_n + 1;
      end loop;
    end if;
  end if;

  return replace(replace(d.done, '{n}', v_n::text), '{t}', v_name);
end $fn$;

/**
 * The door.
 *
 * The wear goes on the stone the way damage goes on anything else, and a stone
 * taken through a hundred is deleted here rather than waited for -- it is in
 * your hand, not lying in a field, and nothing sweeps a pack.
 */
create or replace function rpc_spell(p_world uuid, p_spell text, p_target jsonb default '{}'::jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); d spell_def; sc school_def; it item; v_why text;
        v_wear double precision; v_said text; v_gone boolean := false;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into d from spell_def where id = p_spell;
  if not found then return jsonb_build_object('why', 'There is no such spell.'); end if;
  v_why := spell_refusal(p_world, me, p_spell);
  if v_why is not null then return jsonb_build_object('why', v_why); end if;

  select * into sc from school_def where id = d.school;
  it := focus_for(p_world, me, d.gem);
  v_wear := spell_wear(p_world, me, d, it);
  v_said := do_spell(p_world, me, p_spell, p_target);

  update item set dmg = least(100, coalesce(dmg, 0) + v_wear) where id = it.id;
  if (select dmg from item where id = it.id) >= 100 then
    delete from item where id = it.id;
    v_gone := true;
  end if;
  perform skill_raise(p_world, me, sc.skill, 0.8);
  perform tell(p_world, me, v_said || case when v_gone
    then ' The ' || d.gem || ' goes to grit in your palm; there was nothing left in it.'
    else '' end, 'event');
  return jsonb_build_object('cast', d.id, 'said', v_said, 'wear', round(v_wear::numeric, 2),
    'spent', v_gone,
    'left', case when v_gone then 0 else round((100 - (select dmg from item where id = it.id))::numeric, 1) end);
end $fn$;

/**
 * Everything your school may say to a stone, and what you are holding to say
 * it with. One call, because a spell list is a screen.
 */
create or replace function rpc_spells(p_world uuid) returns jsonb
 language plpgsql security definer set search_path to 'public' as $fn$
declare me uuid := auth.uid(); p player;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then return jsonb_build_object('why', 'You are not on this island.'); end if;
  return jsonb_build_object(
    'school', (select sc.id from school_def sc join class_def c on c.main = sc.skill
                where c.id = p.combat_class),
    'ease', land_ease(p_world, floor(p.x)::int, floor(p.y)::int),
    'spells', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'school', d.school, 'name', d.name, 'level', d.level, 'gem', d.gem,
        'at', d.at_what, 'note', d.note,
        'range', spell_range(p_world, me, d),
        'force', spell_force(p_world, me, d, focus_for(p_world, me, d.gem)),
        'secs', spell_secs(p_world, me, d),
        'wear', case when (focus_for(p_world, me, d.gem)).id is null then null
                     else spell_wear(p_world, me, d, focus_for(p_world, me, d.gem)) end,
        'left', case when (focus_for(p_world, me, d.gem)).id is null then null
                     else 100 - coalesce((focus_for(p_world, me, d.gem)).dmg, 0) end,
        'why', spell_refusal(p_world, me, d.id)) order by d.level, d.id)
      from spell_def d), '[]'::jsonb));
end $fn$;

-- And the one function the skin had to reach: every blow arrives here.
-- Generated against the live definition, anchors asserted.

CREATE OR REPLACE FUNCTION public.hurt_player(p_world uuid, p_uid uuid, p_raw double precision, p_what text, p_kind text DEFAULT 'bite'::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player; shield item; sh shield_def; chance double precision; roll double precision;
        part text; piece item; cls armour_class_def; soak double precision; taken double precision;
        health double precision; ws jsonb; had jsonb; found_w boolean := false; out_w jsonb := '[]'::jsonb;
        w jsonb; k wound_kind_def; note text; aegis double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found then return; end if;

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
        * class_mul(p_world, p_uid, 'guard', 'shields'));
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
    -- And the trade, on the line of armour this piece belongs to: a pikeman's
    -- harness does nothing for the leather an archer is wearing.
    soak := piece_soak(piece, skill_of(p_world, p_uid, cls.skill))
          * class_mul(p_world, p_uid, 'guard', cls.skill);
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

notify pgrst, 'reload schema';
select private.lock_doors();
