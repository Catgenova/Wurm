/*
 * Restoring teaches restoration.
 *
 * Reported: "Restoring artifacts is giving no restoration experience." It was
 * not. Every trade on the island raises its own skill in its own performer --
 * there is no blanket for it the way the browser's `finishGo` has one -- and
 * the two that restore, a relic's pieces put back together in `perform_dig`
 * and a tarnished bauble in `restore_bauble`, raised mind logic and nothing
 * else. So on the island Restoration stood where it started however much
 * anybody restored, and with it the quality of what they restored and how
 * often it came off, both of which are read off it.
 *
 * Now a go pays Restoration as every other go pays its trade: the whole of a
 * go when it comes off and `try_gain`'s share of one when it does not, which
 * is what the browser pays for the same go. Mind logic as it was.
 */

CREATE OR REPLACE FUNCTION public.perform_dig(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; it item; r relic_def; v_skill double precision; v_tool double precision;
        v_part int; v_ql double precision; v_dmg double precision; v_left int; v_new bigint;
        v_missing int[]; v_relic text; v_avg double precision; v_gain double precision; v_fit text;
        /*
         * `v_piece`, not `h`. The seventh time this class has bitten and the
         * first that was not a column name: `h` was the loop variable *and*
         * the alias of `pieces_held(...) h`, so `h.ql` was ambiguous between a
         * record field and a column of the very rows being looped over. Alias
         * every table, prefix every local, and the two can never meet.
         */
        v_piece item;
        v_lectern boolean; v_roll double precision; v_sum double precision;
begin
  if p_action = 'investigate' then
    tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
    perform mark_foraged(p_world, tx, ty, 'dig');
    v_skill := skill_of(p_world, p_uid, 'archaeology');
    v_tool := tool_ql(p_world, p_uid, 'trowel');
    -- More often, up to a higher cap, for a Miner's Keen Trowel.
    if random() > find_chance(v_skill, v_tool, pk(p_world, p_uid, 'find:investigate', 0),
                              pk(p_world, p_uid, 'cap:investigate', find_cap())) then
      -- Half a go here, where the browser's blanket pays a whole one. That
      -- disagreement is older than this change and is left where it is: what
      -- moves today is only what a *failed* go is worth.
      perform skill_raise(p_world, p_uid, 'archaeology', try_gain(false, 0.5));
      perform tell(p_world, p_uid,
        'You go through the soil and turn up nothing but roots and small stones.', 'event');
      return;
    end if;
    perform skill_raise(p_world, p_uid, 'archaeology', try_gain(true, 0.5));
    -- A share of whatever comes up is a bauble, whatever the archaeologist
    -- knows, off one roll (`findKind`): now and again a Bauble of Regret,
    -- whole; otherwise whole but black with age, and good for nothing until
    -- restored.
    v_roll := random();
    if v_roll < regret_share() then
      v_ql := greatest(1, product_ql(v_skill, v_tool) * (0.55 + random() * 0.35));
      v_new := gather(p_world, p_uid, 'bauble_regret', 1, v_ql);
      perform tell(p_world, p_uid, 'Your trowel turns up a Bauble of Regret, whole. It undoes one of your trades, '
        || 'in the Trades window. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
      return;
    end if;
    -- More of them for a Miner's Bauble Hunter, out of the relics' share.
    if v_roll < regret_share() + pk(p_world, p_uid, 'share:bauble', bauble_share()) then
      v_relic := bauble_tier_roll();
      v_ql := greatest(1, product_ql(v_skill, v_tool) * (0.55 + random() * 0.35));
      v_dmg := 18 + random() * 50;
      v_new := gather(p_world, p_uid, 'tarnished_bauble', 1, v_ql, v_relic);
      update item set dmg = v_dmg where id = v_new;
      perform tell(p_world, p_uid, 'Your trowel turns up a tarnished ' || v_relic
        || ' bauble. Restore it to see what it does. (QL ' || to_char(v_ql, 'FM990.0')
        || ', damage ' || to_char(v_dmg, 'FM990') || ')', 'event');
      return;
    end if;
    -- A piece of a relic already begun, now and again, for a Miner's Pieces that Fit.
    if random() < pk(p_world, p_uid, 'fit:relic', 0) then
      select rd.name into v_fit from relic_def rd
       where exists (select 1 from pieces_held(p_world, p_uid, rd.name))
         and coalesce(array_length(parts_missing(p_world, p_uid, rd.name), 1), 0) > 0
       order by random() limit 1;
    end if;
    if v_fit is null and not exists (select 1 from relics_within(v_skill)) then
      perform tell(p_world, p_uid,
        'You turn up a scrap of something worked, but you cannot tell what it was and it crumbles.',
        'event');
      return;
    end if;
    if v_fit is not null then
      select * into r from relic_def where name = v_fit;
    else
      -- The commonplace comes up far more often than the rare, as it did when
      -- it was lost: weighted by difficulty, and the weights are small numbers.
      select sum(1 / (1 + w.difficulty / 12)) into v_sum from relics_within(v_skill) w;
      v_roll := random() * v_sum;
      for r in select * from relics_within(v_skill) loop
        v_roll := v_roll - 1 / (1 + r.difficulty / 12);
        exit when v_roll <= 0;
      end loop;
    end if;
    -- A piece you are still short of, if you are short of any.
    v_missing := parts_missing(p_world, p_uid, r.name);
    if coalesce(array_length(v_missing, 1), 0) > 0 then
      v_part := v_missing[1 + floor(random() * array_length(v_missing, 1))::int];
    else
      v_part := 1 + floor(random() * r.parts)::int;
    end if;
    v_ql := greatest(1, product_ql(v_skill, v_tool) * (0.55 + random() * 0.35));
    -- Nothing comes out of the ground sound.
    v_dmg := 18 + random() * 50;
    v_new := gather(p_world, p_uid, 'fragment', 1, v_ql, r.name || ' ' || v_part || '/' || r.parts);
    update item set dmg = v_dmg where id = v_new;
    v_left := coalesce(array_length(parts_missing(p_world, p_uid, r.name), 1), 0);
    perform tell(p_world, p_uid, 'Your trowel turns up a fragment of ' || r.name || ', piece '
      || v_part || ' of ' || r.parts || '. (QL ' || to_char(v_ql, 'FM990.0')
      || ', damage ' || to_char(v_dmg, 'FM990') || ')'
      || case when v_left > 0 then ' ' || v_left || ' of ' || r.parts || ' still missing.'
              else ' That is all ' || r.parts || ' of them.' end, 'event');
    return;
  end if;

  select * into it from item where world_id = p_world and id = target_item(p_target);
  if not found then return; end if;

  if p_action = 'study_book' then
    -- A lectern holds the pages open at the right angle, and you get
    -- `lectern_gain` times as much out of the hour: within `lectern_reach`,
    -- which the island had as 2.6 where the browser's is 2.4.
    v_lectern := exists (select 1 from placed_near(p_world, p_uid, 'furniture', 'lectern', lectern_reach()));
    -- What it teaches (a trade book its trade), more of it for an Artisan's
    -- Good Read in the binding and less wear on it for their Sturdy Binding.
    v_gain := skill_raise(p_world, p_uid, book_teaches(it),
      (0.5 + it.ql / 90) * case when v_lectern then lectern_gain() else 1 end * mark_of(it.mark, 'teach'));
    perform damage_item(it.id, (study_wear() + random() * study_wear_spread()) * mark_of(it.mark, 'sturdy'));
    perform tell(p_world, p_uid, 'You work through the ' || lower(item_name(it)) || '.'
      || case when v_lectern
              then ' The lectern holds it open at the right angle and you make good use of the hour.'
              else ' Held in one hand, it is hard going. A lectern would be better.' end
      || case when v_gain > 0.0005 then '' else ' There is nothing left in it you do not already know.' end,
      'event');
    return;
  end if;

  if it.def = 'tarnished_bauble' then
    perform restore_bauble(p_world, p_uid, it);
    return;
  end if;

  -- Restoring: every piece in at once, and what comes out is only as good as
  -- the pieces that went in, less what age took.
  v_relic := fragment_relic(it.extra);
  select * into r from relic_def where name = v_relic;
  if not found then return; end if;
  -- Surer for a Mender's Sure Restore, and no harm on a failure for Gentle Hands.
  if not perk_pass(skill_check(skill_of(p_world, p_uid, 'restoration'), r.difficulty, 0,
                               mind_ease(p_world, p_uid)),
                   pk(p_world, p_uid, 'fail:restore_relic', 1)) then
    for v_piece in select * from pieces_held(p_world, p_uid, v_relic) loop
      perform damage_item(v_piece.id, (restore_harm() + random() * restore_harm_spread())
                                      * pk(p_world, p_uid, 'harm:restore_relic', 1));
    end loop;
    perform skill_raise(p_world, p_uid, 'restoration', try_gain(false));
    perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(false, restore_gain()));
    perform tell(p_world, p_uid, 'The pieces of the ' || r.name
      || case when pk(p_world, p_uid, 'harm:restore_relic', 1) <= 0
              then ' will not sit together, and they take no harm from the trying.'
              else ' will not sit together and you mark them trying.' end, 'event');
    return;
  end if;
  -- The damage on them taking nothing off for Age Undone.
  select avg(h.ql * (1 - h.dmg / restore_age() * pk(p_world, p_uid, 'age:restore_relic', 1))) into v_avg
    from pieces_held(p_world, p_uid, v_relic) h;
  -- And better for Fine Restore.
  v_ql := greatest(1, least(100, v_avg * (0.72 + skill_of(p_world, p_uid, 'restoration') / 260)
                                * pk(p_world, p_uid, 'ql:restore_relic', 1)));
  for v_piece in select * from pieces_held(p_world, p_uid, v_relic) loop
    perform consume(p_world, p_uid, 'fragment', 1, v_piece.id);
  end loop;
  v_new := give(p_world, p_uid, r.result, 1, v_ql);
  perform skill_raise(p_world, p_uid, 'restoration', try_gain(true));
  perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(true, restore_gain()));
  perform tell(p_world, p_uid, 'The pieces go back together and the ' || r.name || ' is whole: '
    || lower((select item_name(i) from item i where i.id = v_new))
    || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
end $function$;

CREATE OR REPLACE FUNCTION public.restore_bauble(p_world uuid, p_uid uuid, p_it item)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare t bauble_tier; found_t bauble_tier; up bauble_tier; v_ql double precision; v_rare text; v_new bigint;
        v_harm double precision; v_lift double precision; v_text text; v_again text;
begin
  select * into t from bauble_tier b where b.id = p_it.extra;
  if not found then select * into t from bauble_tier b order by b.ord limit 1; end if;
  found_t := t;
  -- Surer for a Mender's Sure Restore, and no harm on a failure for Gentle Hands.
  if not perk_pass(skill_check(skill_of(p_world, p_uid, 'restoration'), t.difficulty, 0, mind_ease(p_world, p_uid)),
                   pk(p_world, p_uid, 'fail:restore_relic', 1)) then
    v_harm := pk(p_world, p_uid, 'harm:restore_relic', 1);
    perform damage_item(p_it.id, (restore_harm() + random() * restore_harm_spread()) * v_harm);
    perform skill_raise(p_world, p_uid, 'restoration', try_gain(false));
    perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(false, restore_gain()));
    perform tell(p_world, p_uid, 'The tarnish will not lift from the ' || t.id || ' bauble'
      || case when v_harm <= 0 then ', and it takes no harm from the trying.' else ' and you mark it trying.' end, 'event');
    return;
  end if;
  -- A tier better under the tarnish than it looked, now and then, for a Mender's Tier Up.
  v_lift := pk(p_world, p_uid, 'tier:restore_relic', 0);
  select * into up from bauble_tier b where b.ord > t.ord order by b.ord limit 1;
  if up.id is not null and v_lift > 0 and random() < v_lift then t := up; end if;
  -- Better for Fine Restore, and the damage on it taking nothing off for Age Undone.
  v_ql := greatest(1, least(100, p_it.ql * (1 - p_it.dmg / restore_age() * pk(p_world, p_uid, 'age:restore_relic', 1))
                                * (0.72 + skill_of(p_world, p_uid, 'restoration') / 260)
                                * pk(p_world, p_uid, 'ql:restore_relic', 1)));
  -- Rarer for Lucky Polish: the first step at its odds, the rest at their own.
  v_rare := perk_rare(pk(p_world, p_uid, 'rare:restore_relic', (select d.odds from rarity_def d order by d.ord limit 1)));
  -- And for Second Look the best of more rolls: the one that gives most, the first where they give the same.
  v_text := bauble_roll(t.id, v_rare);
  for v_try in 2..floor(pk(p_world, p_uid, 'rolls:bauble', 1))::int loop
    v_again := bauble_roll(t.id, v_rare);
    if coalesce((bauble_read(t.item, v_again)).amount, 0) > coalesce((bauble_read(t.item, v_text)).amount, 0) then
      v_text := v_again;
    end if;
  end loop;
  perform consume(p_world, p_uid, 'tarnished_bauble', 1, p_it.id);
  v_new := give(p_world, p_uid, t.item, 1, v_ql, v_text, v_rare);
  if v_rare is not null then perform tell(p_world, p_uid, rarity_word(v_rare), 'skill'); end if;
  perform skill_raise(p_world, p_uid, 'restoration', try_gain(true));
  perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(true, restore_gain()));
  perform tell(p_world, p_uid, case when t.id = found_t.id then 'The tarnish comes away and the bauble is whole: '
      else 'The tarnish comes away and the ' || found_t.id || ' bauble is '
           || case when t.id ~ '^[aeiou]' then 'an ' else 'a ' end || t.id || ' one: ' end
    || lower((select item_name(i) from item i where i.id = v_new)) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
end $function$;
