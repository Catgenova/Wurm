/*
 * The Bauble of Regret.
 *
 * Asked for: "Add a 3% chance for Bauble of Regret in archaeology. Bauble of
 * regret allows for the undoing of Class selection." The browser's rule is
 * `REGRET_SHARE` in `src/game/baubles.ts`, crossed in the defs just before
 * this as `regret_share()`, with the bauble itself (`item_def`).
 *
 *   * `investigate` asks one roll of every find (`findKind`): under
 *     `regret_share()` it is a Bauble of Regret, whole; under that and
 *     `bauble_share()` together a tarnished bauble, as before; the rest are
 *     pieces of relics. So a tarnished bauble is still `bauble_share()` of
 *     finds, and the relics give up the difference.
 *   * `rpc_regret_class` breaks one to undo a trade: the crafting or the
 *     fighting one is put down as though it had never been taken up, and its
 *     tree with it -- what `rpc_take_class` does to the trade it replaces --
 *     so the slot is empty and the next trade taken up in it costs nothing,
 *     where a change otherwise costs `class_change_cost()` silver.
 */
set local lock_timeout = '3s';

create or replace function rpc_regret_class(p_world uuid, p_kind text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $fn$
declare me uuid := auth.uid(); p player; v_had text;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  -- Held for the rest of this, so that two asked at once cannot both break the same bauble.
  select * into p from player where world_id = p_world and uid = me for update;
  if not found then return jsonb_build_object('why', 'You are not on this island.'); end if;
  if p_kind is null or p_kind not in ('craft', 'combat') then
    return jsonb_build_object('why', 'There is no such trade.');
  end if;
  v_had := case when p_kind = 'craft' then p.craft_class else p.combat_class end;
  if v_had is null then
    return jsonb_build_object('why', 'You have no ' || case when p_kind = 'craft' then 'crafting' else 'fighting' end
      || ' trade to undo.');
  end if;
  -- One carried anywhere, loose or in a bag, as `consume` takes it; one put by is not broken.
  if not consume(p_world, me, 'bauble_regret', 1) then
    if exists (select 1 from item i where i.world_id = p_world and i.holder = 'player' and i.holder_uid = me
                and i.def = 'bauble_regret') then
      return jsonb_build_object('why', 'Your Bauble of Regret is put by. Unlock it first.');
    end if;
    return jsonb_build_object('why', 'You need a Bauble of Regret to undo a trade.');
  end if;
  -- The tree goes with the trade, as it does when one is put down for another.
  delete from player_node pn using class_node n
   where n.id = pn.node and pn.world_id = p_world and pn.uid = me and n.class = v_had;
  if p_kind = 'craft' then
    update player set craft_class = null where world_id = p_world and uid = me;
  else
    update player set combat_class = null where world_id = p_world and uid = me;
  end if;
  perform class_fold(p_world, me);
  perform tell(p_world, me, 'The Bauble of Regret breaks, and the '
    || lower((select c.name from class_def c where c.id = v_had))
    || '’s trade is put down as though you had never taken it up, its tree with it. '
    || 'The next ' || case when p_kind = 'craft' then 'crafting' else 'fighting' end
    || ' trade you take up costs nothing, not ' || class_change_cost()::bigint || ' silver.', 'system');
  return jsonb_build_object('undone', v_had, 'kind', p_kind);
end $fn$;


CREATE OR REPLACE FUNCTION public.perform_dig(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; it item; r relic_def; v_skill double precision; v_tool double precision;
        v_part int; v_ql double precision; v_dmg double precision; v_left int; v_new bigint;
        v_missing int[]; v_relic text; v_avg double precision; v_gain double precision;
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
    if random() > find_chance(v_skill, v_tool) then
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
    if v_roll < regret_share() + bauble_share() then
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
    if not exists (select 1 from relics_within(v_skill)) then
      perform tell(p_world, p_uid,
        'You turn up a scrap of something worked, but you cannot tell what it was and it crumbles.',
        'event');
      return;
    end if;
    -- The commonplace comes up far more often than the rare, as it did when
    -- it was lost: weighted by difficulty, and the weights are small numbers.
    select sum(1 / (1 + w.difficulty / 12)) into v_sum from relics_within(v_skill) w;
    v_roll := random() * v_sum;
    for r in select * from relics_within(v_skill) loop
      v_roll := v_roll - 1 / (1 + r.difficulty / 12);
      exit when v_roll <= 0;
    end loop;
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
    -- A lectern holds the pages open at the right angle, and you get twice as
    -- much out of the hour.
    v_lectern := exists (select 1 from placed p where p.world_id = p_world and p.kind = 'furniture'
                           and p.sub = 'lectern' and near_piece(p_world, p_uid, p, 2.6));
    v_gain := skill_raise(p_world, p_uid, 'mind_logic',
      (0.5 + it.ql / 90) * case when v_lectern then 2 else 1 end);
    perform damage_item(it.id, 2 + random() * 3);
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
  if not skill_check(skill_of(p_world, p_uid, 'restoration'), r.difficulty, 0,
                     mind_ease(p_world, p_uid)) then
    for v_piece in select * from pieces_held(p_world, p_uid, v_relic) loop
      perform damage_item(v_piece.id, 5 + random() * 9);
    end loop;
    perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(false, restore_gain()));
    perform tell(p_world, p_uid, 'The pieces of the ' || r.name
      || ' will not sit together and you mark them trying.', 'event');
    return;
  end if;
  select avg(h.ql * (1 - h.dmg / 200)) into v_avg from pieces_held(p_world, p_uid, v_relic) h;
  -- And the tree, on restoration, which is the mender's and the only quality
  -- on this island that comes out of pieces rather than out of stock.
  v_ql := greatest(1, least(100, v_avg * (0.72 + skill_of(p_world, p_uid, 'restoration') / 260)
                                * class_mul(p_world, p_uid, 'fine', 'restoration')));
  for v_piece in select * from pieces_held(p_world, p_uid, v_relic) loop
    perform consume(p_world, p_uid, 'fragment', 1, v_piece.id);
  end loop;
  v_new := give(p_world, p_uid, r.result, 1, v_ql);
  perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(true, restore_gain()));
  perform tell(p_world, p_uid, 'The pieces go back together and the ' || r.name || ' is whole: '
    || lower((select item_name(i) from item i where i.id = v_new))
    || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
end $function$;

select private.lock_doors();
