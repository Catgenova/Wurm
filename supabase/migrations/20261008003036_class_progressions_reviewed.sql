/*
 * The class progressions, reviewed.
 *
 * The definitions just before this carry the rest: Healing Circle says what it
 * does (each gets back a share of their own health), the Archer's Bow Mastery
 * opens at the first tier and Arrow Saver at the fifth, the Artisan's Gem
 * Finder turns up a gem 1 in 300, four perks that shared a name with another
 * trade's are renamed and keep their ids, and three are replaced: the Binder's
 * Unmoved, the Pikeman's Bastion over again, by Hard Edges; the Cook's Cool
 * Pack, which its own Long-lasting overlapped, by Quick Kitchen; and the
 * Smith's Long Shift by Master's Mark, as the Carpenter's and the Tailor's
 * last tiers have theirs. Here: the two of those that need a rule, and the
 * holders of a perk that went or moved tier, folded afresh to choose again.
 */
set local lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.perform_forge(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p placed; it item; v_mould item; d mould_def; v_lump item; m metal_def; v_cast item;
        v_per double precision; v_room double precision; v_fits int; v_whole int;
        v_ql double precision; v_mould_ql double precision; v_hard double precision;
        v_rare text; v_made bigint; v_broke boolean; v_sz int[]; v_sx int; v_sy int; v_left double precision;
        v_count int; v_kept boolean;
begin
  if p_action in ('fuel_oven', 'light_oven', 'put_out_oven', 'take_ashes_oven') then
    perform placed_settle((p_target->>'id')::bigint);
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;

    if p_action = 'fuel_oven' then
      select i.* into it from craft_stock(p_world, p_uid, target_item(p_target)) s join item i on i.id = s.id
        where fuel_value(s.def) is not null
          and (target_item(p_target) is null or s.id = target_item(p_target))
        order by s.draw limit 1;
      if not found then return; end if;
      v_per := fuel_value(it.def);
      v_room := greatest(0, hearth_capacity(p) - p.fuel);
      v_fits := greatest(1, least(least(coalesce((p_target->>'count')::int, 1), it.count),
                                  ceil(v_room / v_per)::int));
      if not spend_stack(p_world, p_uid, it.id, v_fits) then return; end if;
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
    -- An anvil's metal rides in `sub`, and its rarity now rides beside it.
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, rare)
    values (p_world, 'anvil', coalesce(it.extra, 'copper'),
            (p_target->>'x')::int, (p_target->>'y')::int, v_sx, v_sy,
            (p_target->>'x')::int + (v_sx + 1.0) / subtiles(),
            (p_target->>'y')::int + (v_sy + 1.0) / subtiles(), it.ql, p_uid, it.rare)
    returning * into p;
    delete from item where id = it.id;
    perform tell(p_world, p_uid, 'You set the ' || lower(anvil_name(p))
      || ' down. Bring a casting to it.', 'event');
    perform land_announce(p_world, p.x, p.y);
    return;
  end if;

  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
  if not found then return; end if;

  if p_action = 'pick_up_anvil' then
    perform give(p_world, p_uid, 'anvil', 1, p.ql, p.sub, p.rare);
    perform tell(p_world, p_uid, 'You heave the ' || lower(anvil_name(p))
      || ' up onto your shoulder.', 'event');
    delete from placed where id = p.id;
    perform land_announce(p_world, p.x, p.y);
    return;
  end if;

  -- Smithing: the mould, the metal, the anvil and the hands, in that order.
  if p_action = 'strike_coins' then
    -- The die wears with every strike, good or bad, and no die can be mended.
    select * into v_mould from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and def = 'coin_die' order by tool_worth(ql, dmg, extra, rare, bless) desc limit 1;
    v_lump := smith_lump(p_world, p_uid, target_item(p_target));
    m := metal_by_bar(v_lump.def);
    if v_mould.id is null or v_lump.id is null or m.id is null or not m.coins then return; end if;
    -- A bar is broken into for the lump a strike takes (a Smith's Ingots).
    v_lump := unbar(p_world, p_uid, v_lump.id, 1);
    if v_lump.id is null or not spend_stack(p_world, p_uid, v_lump.id, 1) then return; end if;
    v_mould_ql := greatest(1, v_mould.ql - v_mould.dmg / 2);
    v_broke := v_mould.dmg + die_wear() >= 100;
    if v_broke then
      delete from item where id = v_mould.id;
    else
      update item set dmg = least(100, v_mould.dmg + die_wear()) where id = v_mould.id;
    end if;
    v_hard := coin_difficulty() + (mat_of(v_lump.extra)).difficulty;
    -- A Smith's Sure Hammer fails half as often (`fail:` and the job).
    if not perk_pass(skill_check(skill_of(p_world, p_uid, 'blacksmithing'), v_hard, anvil_ql(p),
                                 mind_ease(p_world, p_uid)), pk(p_world, p_uid, 'fail:' || p_action, 1)) then
      perform skill_raise(p_world, p_uid, 'blacksmithing', try_gain(false, smith_gain()));
      perform tell(p_world, p_uid, 'The blanks come out smeared and you throw the metal back.'
        || case when v_broke then ' The die is worn through.' else '' end, 'event');
      return;
    end if;
    v_ql := smith_ql(p_world, p_uid, 'blacksmithing', v_mould_ql, v_lump.ql, anvil_ql(p));
    perform skill_raise(p_world, p_uid, 'blacksmithing', try_gain(true, smith_gain()));
    v_rare := rarity_roll();
    v_made := give(p_world, p_uid, 'coin', coins_per_lump()::int, v_ql, m.name, v_rare, maker_mark(p_world, p_uid, v_rare));
    perform journal_made(p_world, p_uid, 'coin', v_ql, coins_per_lump()::int, v_rare);
    perform journal_note(p_world, p_uid, 'minted');
    if v_rare is not null then
      perform journal_note(p_world, p_uid, v_rare);
      perform tell(p_world, p_uid, rarity_word(v_rare), 'skill');
    end if;
    perform tell(p_world, p_uid, 'You strike ' || coins_per_lump()::int || ' ' || lower(m.name)
      || ' coins on the ' || lower(anvil_name(p)) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')'
      || case when v_broke then ' The die is worn through and done.'
              else ' The die has ' || ceil((100 - (v_mould.dmg + die_wear())) / die_wear())::int || ' strikes left.' end, 'event');
    return;
  end if;

  -- Smithing: a casting poured at the smelter, beaten true on the anvil.
  v_cast := smith_casting(p_world, p_uid, target_item(p_target));
  select * into d from mould_def where makes = v_cast.piece;
  m := metal_by_name(v_cast.extra);
  if v_cast.id is null or d.id is null or m.id is null then return; end if;

  -- The deeper the seam it came out of, the harder it is to beat into shape.
  -- Rolled before the casting is spent, so that a Smith's Second Heat has a
  -- casting to keep; and a Smith's Sure Hammer fails half as often.
  v_hard := d.difficulty + (mat_of(v_cast.extra)).difficulty;
  if not perk_pass(skill_check(skill_of(p_world, p_uid, d.skill), v_hard, anvil_ql(p),
                               mind_ease(p_world, p_uid)), pk(p_world, p_uid, 'fail:' || p_action, 1)) then
    v_kept := random() < pk(p_world, p_uid, 'spare:' || p_action, 0);
    if not v_kept and not spend_stack(p_world, p_uid, v_cast.id, 1) then return; end if;
    perform skill_raise(p_world, p_uid, d.skill, try_gain(false, smith_gain()));
    perform tell(p_world, p_uid, 'The '
      || lower((select name from item_def where id = d.makes))
      || ' comes out misshapen and '
      || case when v_kept then 'goes back into the fire: the casting is kept.' else 'you throw the metal back.' end, 'event');
    return;
  end if;
  if not spend_stack(p_world, p_uid, v_cast.id, 1) then return; end if;

  -- The casting carries the mould and the metal it was poured from, so it stands for both.
  -- Better for a Smith's Toolsmith on a tool's head or blade (`ql:` and the piece).
  v_ql := least(100, smith_ql(p_world, p_uid, d.skill, v_cast.ql, v_cast.ql, anvil_ql(p))
                     * pk(p_world, p_uid, 'ql:' || d.makes, 1));
  perform skill_raise(p_world, p_uid, d.skill, try_gain(true, smith_gain()));
  -- Rarer odds for a Smith's Master's Mark (`rare:smith`).
  v_rare := perk_rare(pk(p_world, p_uid, 'rare:smith', (select r.odds from rarity_def r order by r.ord limit 1)));
  -- More to a filling for a Smith's Nail Maker (`count:` and the piece).
  v_count := floor(pk(p_world, p_uid, 'count:' || d.makes, d.per))::int;
  -- And what the smith's perks put into it (Keen Edge, Balanced, Mail Maker,
  -- Plate Maker, Temper Bath), which goes with a head into what it is fitted to.
  v_made := give(p_world, p_uid, d.makes, v_count, v_ql, m.name, v_rare, maker_mark(p_world, p_uid, v_rare), null,
                 made_mark((select pl.class_mul from player pl where pl.world_id = p_world and pl.uid = p_uid), d.makes));
  perform journal_made(p_world, p_uid, d.makes, v_ql, v_count, v_rare);
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
    || case when v_count > 1 then v_count || ' ' else 'a ' end
    || lower(m.name) || ' '
    || case when v_count > 1 and right(lower((select name from item_def where id = d.makes)), 1) <> 's'
            then lower((select name from item_def where id = d.makes)) || 's'
            else lower((select name from item_def where id = d.makes)) end
    || ' on the ' || lower(anvil_name(p)) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
  -- And what the go taught, said: it was raised and never told, which read as nothing learned.
end $function$;

CREATE OR REPLACE FUNCTION public.binder_shatter_at(p_world uuid, p_uid uuid)
 RETURNS double precision
 LANGUAGE plpgsql
 STABLE
AS $function$
declare d spell_def; it item;
begin
  it := school_focus(p_world, p_uid, 'binding');
  if it.id is null then return 0; end if;
  select * into d from spell_def where id = 'ember';
  d.school := 'binding';
  -- Larger for a Binder's Hard Edges (`shatter:size`).
  return spell_force(p_world, p_uid, d, it) * pk(p_world, p_uid, 'shatter:size', 1);
end $function$;

/* Whoever took a perk that is gone, or one that moved to another tier, has the choice back. */
delete from player_node
 where node in ('binder_unmoved', 'cook_cool_pack', 'smith_long_shift', 'archer_arrow_saver', 'archer_bow_mastery');
do $$ declare r record; begin
  for r in select world_id, uid from player where combat_class in ('binder', 'archer') or craft_class in ('cook', 'smith') loop
    perform class_fold(r.world_id, r.uid);
  end loop;
end $$;

select private.lock_doors();
