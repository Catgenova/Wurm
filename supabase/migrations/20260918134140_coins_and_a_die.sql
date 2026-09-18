-- Coins and a die
--
-- Asked from the island. Silver and gold had one use between them, electrum,
-- and a hoard was a heap of lumps. A coin die is cast at the anvil like any
-- head, from two lumps in a sand mould, and with it a lump of silver or gold
-- set on the anvil is struck into twenty coins — `coins_per_lump` — a compact
-- store of metal that goes in a pocket and, melted down, comes back as the
-- lump it was. The die wears with every strike, good or bad (`die_wear`),
-- and no die can be mended; a strike is as hard as a blacksmith's work of
-- middling difficulty (`coin_difficulty`) plus what the metal adds. Which
-- metals coin is a column on the metal table both sides read.
--
-- `strike_coins` joins the forge family beside `smith`: the same lump named
-- off the menu, the same quality rule, the same roll for rare work and the
-- same mark on it. The doors are the smith's, in the smith's words: no die,
-- no metal, or a metal that does not coin.

CREATE OR REPLACE FUNCTION public.forge_action(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in ('fuel_oven', 'light_oven', 'put_out_oven', 'take_ashes_oven',
                      'candle_lantern', 'light_lantern', 'douse_lantern',
                      'place_anvil', 'pick_up_anvil', 'smith', 'strike_coins')
$function$
;

CREATE OR REPLACE FUNCTION public.forge_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p placed; it item; v_mould item; d mould_def; v_lump item;
begin
  if p_action in ('fuel_oven', 'light_oven', 'put_out_oven', 'take_ashes_oven') then
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found or not is_oven(p) then return 'That is not an oven.'; end if;
    if not near_piece(p_world, p_uid, p) then return 'Stand next to the oven.'; end if;
    if p_action = 'fuel_oven' then
      select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
        and not locked and fuel_value(def) is not null
        and (target_item(p_target) is null or id = target_item(p_target))
        order by id limit 1;
      if not found then return 'An oven takes what a fire takes: ' || fuel_said() || '.'; end if;
      if placed_fuel(p) >= hearth_capacity(p) then return 'It is packed as full as it will take.'; end if;
    elsif p_action = 'light_oven' then
      if placed_lit(p) then return 'It is already burning.'; end if;
      if placed_fuel(p) <= 0 then return 'There is nothing in the firebox. Feed it some wood.'; end if;
    elsif p_action = 'put_out_oven' then
      if not placed_lit(p) then return 'It is not burning.'; end if;
    elsif p_action = 'take_ashes_oven' then
      if floor(placed_ash(p)) < 1 then return 'There are no ashes worth taking yet.'; end if;
    end if;
    return null;
  end if;

  if p_action in ('candle_lantern', 'light_lantern', 'douse_lantern') then
    select * into it from item where world_id = p_world and id = target_item(p_target)
      and holder = 'player' and holder_uid = p_uid;
    if not found or not held_light(it.def) then return 'It is gone.'; end if;
    if p_action = 'candle_lantern' then
      if it.def <> 'lantern' then return 'Nothing goes in a torch.'; end if;
      if candle_left(it) > 0 then return 'There is still a candle in it.'; end if;
      if pack_count(p_world, p_uid, 'candle') < 1 then
        return 'You have no candles. Two are drawn from two beeswax and a yarn.';
      end if;
    elsif p_action = 'light_lantern' then
      if it.def = 'lantern' and candle_left(it) <= 0 then return 'There is no candle in it.'; end if;
      if it.lit then return 'It is already lit.'; end if;
      /*
       * The tinderbox is gone, and so is the hole it left.
       *
       * This check used to want one, faithfully, because the browser wanted
       * one — and there was no tinderbox in the browser either, so a lantern
       * could not be struck on either side of the port. That was the right
       * thing to *port* and the wrong thing to leave: a whole subsystem with
       * no way into it. The browser lights it at a fire now, and so does this.
       */
      if flame_near(p_world, p_uid, it.id) is null then
        return 'Nothing here is burning. Light it at a campfire, a kiln, a smelter or an oven — '
          || 'or off something already alight in your hand.';
      end if;
    elsif p_action = 'douse_lantern' then
      if not it.lit then return 'It is not lit.'; end if;
    end if;
    return null;
  end if;

  if p_action = 'place_anvil' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and def = 'anvil' and not locked
      and (target_item(p_target) is null or id = target_item(p_target))
      order by id limit 1;
    if not found then return 'You have no anvil to set down.'; end if;
    return anvil_place_reason(p_world, (p_target->>'x')::int, (p_target->>'y')::int,
      coalesce((p_target->>'sx')::int, 0), coalesce((p_target->>'sy')::int, 0));
  end if;

  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint
    and kind = 'anvil';
  if not found then return 'It is gone.'; end if;
  if p_action = 'pick_up_anvil' then return null; end if;

  -- Smithing.
  if not near_piece(p_world, p_uid, p) then return 'Stand at the anvil.'; end if;
  if p_action = 'strike_coins' then
    -- Coins: a die in the pack, and a lump of a metal that coins, in the
    -- words the browser uses.
    if pack_count(p_world, p_uid, 'coin_die') < 1 then return 'You need a coin die.'; end if;
    v_lump := smith_lump(p_world, p_uid, target_item(p_target));
    if v_lump.id is null then return 'You have no metal to strike.'; end if;
    if not coalesce((metal_by_lump(v_lump.def)).coins, false) then return 'Coins are struck from silver or gold.'; end if;
    return null;
  end if;
  select * into v_mould from item where world_id = p_world
    and id = target_mould(p_target)
    and holder = 'player' and holder_uid = p_uid;
  if not found then return 'Choose a mould.'; end if;
  select * into d from mould_def where id = v_mould.def;
  if not found then return 'Choose a mould.'; end if;
  if d.makes = 'anvil' then return 'An anvil is cast in a smelter, not beaten out here.'; end if;
  v_lump := smith_lump(p_world, p_uid, target_item(p_target));
  if v_lump.id is null then return 'You have no metal to pour.'; end if;
  if v_lump.count < mould_lumps(d.id, (metal_by_lump(v_lump.def)).id) then
    return 'That takes ' || mould_lumps(d.id, (metal_by_lump(v_lump.def)).id) || ' lumps.';
  end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.perform_forge(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p placed; it item; v_mould item; d mould_def; v_lump item; m metal_def;
        v_per double precision; v_room double precision; v_fits int; v_whole int;
        v_ql double precision; v_mould_ql double precision; v_hard double precision;
        v_rare text; v_made bigint; v_broke boolean; v_sz int[]; v_sx int; v_sy int;
        v_gained double precision; v_left double precision;
begin
  if p_action in ('fuel_oven', 'light_oven', 'put_out_oven', 'take_ashes_oven') then
    perform placed_settle((p_target->>'id')::bigint);
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;

    if p_action = 'fuel_oven' then
      select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
        and not locked and fuel_value(def) is not null
        and (target_item(p_target) is null or id = target_item(p_target))
        order by id limit 1;
      if not found then return; end if;
      v_per := fuel_value(it.def);
      v_room := greatest(0, hearth_capacity(p) - p.fuel);
      v_fits := greatest(1, least(least(coalesce((p_target->>'count')::int, 1), it.count),
                                  ceil(v_room / v_per)::int));
      if not consume(p_world, p_uid, it.def, v_fits, it.id) then return; end if;
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
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (p_world, 'anvil', coalesce(it.extra, 'copper'),
            (p_target->>'x')::int, (p_target->>'y')::int, v_sx, v_sy,
            (p_target->>'x')::int + (v_sx + 1.0) / subtiles(),
            (p_target->>'y')::int + (v_sy + 1.0) / subtiles(), it.ql, p_uid)
    returning * into p;
    delete from item where id = it.id;
    perform tell(p_world, p_uid, 'You set the ' || lower(anvil_name(p))
      || ' down. Bring a filled mould to it.', 'event');
    perform land_announce(p_world, p.x, p.y);
    return;
  end if;

  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
  if not found then return; end if;

  if p_action = 'pick_up_anvil' then
    perform give(p_world, p_uid, 'anvil', 1, p.ql, p.sub);
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
    select * into m from metal_def where lump = v_lump.def;
    if v_mould.id is null or v_lump.id is null or m.id is null or not m.coins then return; end if;
    if not consume(p_world, p_uid, v_lump.def, 1, v_lump.id) then return; end if;
    v_mould_ql := greatest(1, v_mould.ql - v_mould.dmg / 2);
    v_broke := v_mould.dmg + die_wear() >= 100;
    if v_broke then
      delete from item where id = v_mould.id;
    else
      update item set dmg = least(100, v_mould.dmg + die_wear()) where id = v_mould.id;
    end if;
    v_hard := coin_difficulty() + (mat_of(v_lump.extra)).difficulty;
    if not skill_check(skill_of(p_world, p_uid, 'blacksmithing'), v_hard, anvil_ql(p),
                       mind_ease(p_world, p_uid)) then
      v_gained := skill_raise(p_world, p_uid, 'blacksmithing', try_gain(false, smith_gain()));
      perform tell(p_world, p_uid, 'The blanks come out smeared and you throw the metal back.'
        || case when v_broke then ' The die is worn through.' else '' end, 'event');
      return;
    end if;
    v_ql := smith_ql(p_world, p_uid, 'blacksmithing', v_mould_ql, v_lump.ql, anvil_ql(p));
    v_gained := skill_raise(p_world, p_uid, 'blacksmithing', try_gain(true, smith_gain()));
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

  select * into v_mould from item where world_id = p_world
    and id = target_mould(p_target);
  select * into d from mould_def where id = v_mould.def;
  v_lump := smith_lump(p_world, p_uid, target_item(p_target));
  select * into m from metal_def where lump = v_lump.def;
  if v_mould.id is null or d.id is null or v_lump.id is null or m.id is null
     or v_lump.count < mould_lumps(d.id, m.id) then return; end if;
  if not consume(p_world, p_uid, v_lump.def, mould_lumps(d.id, m.id), v_lump.id) then return; end if;

  v_mould_ql := greatest(1, v_mould.ql - v_mould.dmg / 2);
  -- Every filling wears the mould, and a hard metal takes more out of it.
  v_broke := v_mould.dmg + mould_wear(v_mould.ql) * (1 + (mat_of(m.name)).difficulty / 30) >= 100;
  if v_broke then
    delete from item where id = v_mould.id;
  else
    update item set dmg = least(100, v_mould.dmg
        + mould_wear(v_mould.ql) * (1 + (mat_of(m.name)).difficulty / 30))
      where id = v_mould.id;
  end if;

  -- The deeper the seam it came out of, the harder it is to beat into shape.
  v_hard := d.difficulty + (mat_of(v_lump.extra)).difficulty;
  if not skill_check(skill_of(p_world, p_uid, d.skill), v_hard, anvil_ql(p),
                     mind_ease(p_world, p_uid)) then
    v_gained := skill_raise(p_world, p_uid, d.skill, try_gain(false, smith_gain()));
    perform tell(p_world, p_uid, 'The '
      || lower((select name from item_def where id = d.makes))
      || ' comes out misshapen and you throw the metal back.'
      || case when v_broke then ' The ' || lower((select name from item_def where id = v_mould.def))
                                || ' cracks through.' else '' end, 'event');
    return;
  end if;

  v_ql := smith_ql(p_world, p_uid, d.skill, v_mould_ql, v_lump.ql, anvil_ql(p));
  v_gained := skill_raise(p_world, p_uid, d.skill, try_gain(true, smith_gain()));
  v_rare := rarity_roll();
  v_made := give(p_world, p_uid, d.makes, d.per, v_ql, m.name, v_rare, maker_mark(p_world, p_uid, v_rare));
  perform journal_made(p_world, p_uid, d.makes, v_ql, d.per, v_rare);
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
    || case when d.per > 1 then d.per || ' ' else 'a ' end
    || lower(m.name) || ' '
    || case when d.per > 1 and right(lower((select name from item_def where id = d.makes)), 1) <> 's'
            then lower((select name from item_def where id = d.makes)) || 's'
            else lower((select name from item_def where id = d.makes)) end
    || ' on the ' || lower(anvil_name(p)) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')'
    || case when v_broke then ' The ' || lower((select name from item_def where id = v_mould.def))
                              || ' cracks through and is done.'
            else ' The mould has ' || mould_uses_left(v_mould.ql, v_mould.dmg
                   + mould_wear(v_mould.ql) * (1 + (mat_of(m.name)).difficulty / 30))
                 || ' fillings left.' end, 'event');
end $function$
;

select private.lock_doors();
