/*
 * The Mender moved onto perks: its eighteen, on the island.
 *
 * The thirteenth trade off its tree (`PERK_CLASSES`). Its perks are rows the
 * definitions already carry (`class_perk`), and so are its repair kit and its
 * sealant. What is here is every rule the perks change, each reading its key
 * off the fold with the rule's own number as the default, so that for anybody
 * without the perk nothing moves:
 *
 *   * a go of Repair (`perform_item`): Big Mend's more damage out, Light
 *     Touch's less quality for each point of it, Clean Repair's now and then
 *     none; the tree's `fine` on repair, which divided the cost, went with the
 *     tree;
 *   * a job's time (`rpc_act`, `settle`): a perk on it (`perk_time`) comes off
 *     after the floor under every job rather than before it, so Quick Hands
 *     takes time off a go of Repair, which is always down on the floor, and
 *     every other trade's quick perks are what they say at any skill;
 *   * the blows a Mender's gear takes (`hurt_player`, `perform_fight`): Armour
 *     Care's less on armour, a shield and a weapon;
 *   * how long a work post, a trap or a creel stands for whoever set it
 *     (`kept_life`, read off `made_by`): Post Keeper's, wherever a post's or a
 *     trap's life, damage or time left is asked. `post_life` had thirty minutes
 *     written out by hand for the roughest post, where the browser's is a world
 *     half hour; both read `post_life_min` and `post_life_max` now;
 *   * restoring (`restore_bauble`, `perform_dig`): Sure Restore's failing less
 *     often, Gentle Hands' no harm when it does, Fine Restore's better quality,
 *     Age Undone's damage that takes nothing off it, and on a bauble Lucky
 *     Polish's rarer, Second Look's better of two rolls and Tier Up's now and
 *     then a tier better than it went in;
 *   * Handyman's floor under improving, whatever the trade
 *     (`improve_ceiling`);
 *   * and the two new things, each made only by a Mender who has learned it
 *     (`craft_refusal`) and used by anybody: a repair kit, which takes
 *     `kit_mend` damage off anything and none of its quality, and sealant,
 *     which marks a thing sealed (`seal`, nought) so that it never decays on
 *     the ground (`ground_decay_rate`), a pile taking one for each thing in it.
 *     A seal is not a maker's and is not carried from a part into what it
 *     goes into (`perform_craft`); it is said on its own (`mark_says`).
 *
 * Quick Restore and Tool Care are keys every job and tool already reads
 * (`time:`, `wear:`), and need nothing here.
 *
 * The Mender's nodes go with its tree, and every Mender's fold is written
 * again.
 */
set local lock_timeout = '3s';

/*
 * How many times as long a thing set down stands for whoever set it: a
 * Mender's Post Keeper, by what it is (`life:work_post`, `life:snare` ...),
 * read off its setter. One for anybody without it, and for a thing nobody set.
 */
create or replace function kept_life(p placed) returns double precision
  language sql stable as $$
  select pk(p.world_id, p.made_by, 'life:' || case when p.kind = 'post' then 'work_post' else p.sub end, 1)
$$;

CREATE OR REPLACE FUNCTION public.perform_item(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_ok boolean; v_it item; v_what improvable_def; v_mat improve_material_def; v_stock item;
        v_made text; v_ceiling double precision; v_tool_ql double precision;
        v_healed double precision; v_lost double precision; v_skill double precision;
        v_favour text; v_full text; v_name text; v_p player; v_lift text; v_keep double precision;
        v_up double precision; v_hurt jsonb; v_out jsonb; v_one jsonb; v_said text;
begin
  if p_action = 'drink' then
    update player set stats = jsonb_set(stats, '{thirst}', '1') where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You drink the cool water. It is refreshing.', 'event');
    return;
  end if;

  v_it := carried(p_world, p_uid, target_item(p_target));
  if v_it.id is null then return; end if;
  v_name := lower((select coalesce(name, v_it.def) from item_def where id = v_it.def));
  select * into v_p from player where world_id = p_world and uid = p_uid;

  if p_action = 'eat' then
    if not consume(p_world, p_uid, v_it.def, 1, v_it.id) then return; end if;
    update player set stats = jsonb_set(stats, '{hunger}', to_jsonb(least(1,
        coalesce((v_p.stats->>'hunger')::double precision, 1)
        + coalesce((select food from item_def where id = v_it.def), 0) * (0.7 + v_it.ql / 200)
          -- Fuller, the more and the longer for its maker's hand in it (a
          -- Cook's Filling, Hearty and Flavoursome), whoever is eating it.
          * mark_of(v_it.mark, 'fill'))))
      where world_id = p_world and uid = p_uid;
    -- A dish favours a trade, and having eaten it you are better at that
    -- trade for a while.
    v_favour := grant_boon(p_world, p_uid, v_it.def, v_it.ql, mark_of(v_it.mark, 'knack'));
    v_full := nourish(p_world, p_uid, v_it.def, v_it.ql, mark_of(v_it.mark, 'feed'));
    perform tell(p_world, p_uid, 'You eat the ' || v_name || '.'
      || coalesce(' ' || v_favour, '') || coalesce(' ' || v_full, ''), 'event');

  -- A Naturalist's herb tea: a cup of it puts back its share of your stamina.
  elsif p_action = 'drink_tea' then
    v_up := coalesce((select stamina from item_def where id = v_it.def), 0);
    if not consume(p_world, p_uid, v_it.def, 1, v_it.id) then return; end if;
    update player set stats = jsonb_set(stats, '{stamina}', to_jsonb(least(1,
        coalesce((v_p.stats->>'stamina')::double precision, 1) + v_up)))
      where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You drink the ' || v_name || '. It puts back ' || whole_pct(v_up)
      || ' of your stamina.', 'event');

  -- And a tincture: the Naturalist's four trades go in faster for a while.
  elsif p_action = 'take_tincture' then
    if not consume(p_world, p_uid, v_it.def, 1, v_it.id) then return; end if;
    perform grant_tincture(p_world, p_uid);
    v_said := tincture_names();
    perform tell(p_world, p_uid, 'You take the tincture. ' || upper(left(v_said, 1)) || substr(v_said, 2)
      || ' each go in ' || whole_pct(tincture_bonus()) || ' faster for the next ' || clock_left(tincture_seconds()) || '.',
      'event');

  -- And a salve, rubbed in over the worst dressing on you that could still go bad.
  elsif p_action = 'apply_salve' then
    v_hurt := salve_for(v_p.wounds);
    if v_hurt is null or not consume(p_world, p_uid, v_it.def, 1, v_it.id) then return; end if;
    v_out := '[]'::jsonb;
    for v_one in select * from jsonb_array_elements(v_p.wounds) loop
      if v_one = v_hurt then v_one := jsonb_set(v_one, '{salved}', 'true'); end if;
      v_out := v_out || v_one;
    end loop;
    update player set wounds = v_out where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You rub the salve into the '
      || (select name from wound_kind_def where id = v_hurt->>'kind') || ' on your ' || part_name(v_hurt->>'part')
      || '. It will not go bad under it.', 'event');

  elsif p_action = 'drink_skin' then
    update item set charges = coalesce(charges, 1) - 1 where id = v_it.id;
    update player set stats = jsonb_set(stats, '{thirst}', to_jsonb(least(1,
        coalesce((v_p.stats->>'thirst')::double precision, 1)
        + coalesce((select drink from item_def where id = v_it.def), 0))))
      where world_id = p_world and uid = p_uid;
    -- Milk and anything brewed favour a trade the way a cooked dish does,
    -- and for longer for its brewer's hand in it (a Cook's Strong Brew).
    v_favour := grant_boon(p_world, p_uid, v_it.def, v_it.ql, mark_of(v_it.mark, 'knack'));
    v_full := nourish(p_world, p_uid, v_it.def, v_it.ql, mark_of(v_it.mark, 'feed'));
    perform tell(p_world, p_uid, 'You take a drink from the ' || v_name || '.'
      || coalesce(' ' || v_favour, '') || coalesce(' ' || v_full, ''), 'event');

  elsif p_action = 'patch_item' then
    -- A Tailor's Patch: a cloth or leather piece mended with a piece of its own
    -- stuff, the perk's own number of damage off and nothing off its quality.
    v_made := patch_with(v_it.def);
    if v_made is null or v_it.dmg <= 0 then return; end if;
    if not consume(p_world, p_uid, v_made, 1) then return; end if;
    v_healed := least(v_it.dmg, pk(p_world, p_uid, 'patch_item', 0));
    update item set dmg = greatest(0, dmg - v_healed) where id = v_it.id;
    perform skill_raise(p_world, p_uid, (select skill from improvable_def where item = v_it.def), 0.25);
    perform tell(p_world, p_uid, 'You patch the ' || v_name || ' with ' || v_made || '. (damage '
      || to_char(greatest(0, v_it.dmg - v_healed), 'FM990.00') || ')', 'event');

  -- A Mender's repair kit, which anybody who has one may use: damage off
  -- anything, anywhere, and none of its quality.
  elsif p_action = 'mend_kit' then
    if v_it.dmg <= 0 or v_it.def = 'repair_kit' then return; end if;
    if not consume(p_world, p_uid, 'repair_kit', 1) then return; end if;
    update item set dmg = greatest(0, dmg - kit_mend()) where id = v_it.id returning * into v_it;
    perform skill_raise(p_world, p_uid, 'repair', 0.25);
    perform tell(p_world, p_uid, 'You mend the ' || v_name || ' with a repair kit. (damage '
      || to_char(v_it.dmg, 'FM990.00') || ')', 'event');

  -- And a Mender's sealant, which anybody who has some may work over a thing:
  -- it never decays after. A pile takes one for each thing in it.
  elsif p_action = 'seal_item' then
    if v_it.def = 'sealant' or coalesce(v_it.mark, '{}'::jsonb) ? 'seal' then return; end if;
    if not consume(p_world, p_uid, 'sealant', v_it.count) then return; end if;
    update item set mark = coalesce(mark, '{}'::jsonb) || '{"seal": 0}'::jsonb where id = v_it.id returning * into v_it;
    perform skill_raise(p_world, p_uid, 'repair', 0.1);
    perform tell(p_world, p_uid, 'You work the sealant over the ' || lower(item_name(v_it)) || '. It will not decay now.', 'event');

  elsif p_action = 'repair_item' then
    -- A second's work: some of the damage comes out, and a little of the
    -- quality with it — a little, not much, so mending a thing is not the end
    -- of it. More out at a go for a Mender's Big Mend, less quality for each
    -- point of it for Light Touch, and now and then none at all for Clean
    -- Repair, asked only of somebody who has it.
    v_skill := skill_of(p_world, p_uid, 'repair');
    v_healed := least(v_it.dmg, (1.2 + v_skill * 0.1) * pk(p_world, p_uid, 'mend:repair_item', 1));
    v_lost := v_healed * greatest(0.004, 0.03 - v_skill * 0.00026) * pk(p_world, p_uid, 'cost:repair_item', 1);
    v_keep := pk(p_world, p_uid, 'keep:repair_item', 0);
    if v_keep > 0 and random() < v_keep then v_lost := 0; end if;
    update item set dmg = greatest(0, dmg - v_healed), ql = greatest(1, ql - v_lost)
      where id = v_it.id returning * into v_it;
    perform skill_raise(p_world, p_uid, 'repair', 0.25);
    if v_it.dmg <= 0 then
      perform tell(p_world, p_uid, 'The ' || v_name || ' is as sound as it will ever be again. (QL '
        || to_char(v_it.ql, 'FM990.0') || ')', 'event');
    end if;

  elsif p_action = 'improve_item' then
    select * into v_what from improvable_def where item = v_it.def;
    if not found then return; end if;
    select * into v_mat from improve_material_def where id = v_what.material;
    v_made := (mat_of(v_it.extra)).name;
    v_stock := stock_for(p_world, p_uid, v_mat.id, v_made);
    -- A bar is broken into for the lump a pass takes (a Smith's Ingots).
    if v_stock.id is not null then v_stock := unbar(p_world, p_uid, v_stock.id, 1); end if;
    if v_stock.id is null or not spend_stack(p_world, p_uid, v_stock.id, 1) then return; end if;
    v_tool_ql := coalesce((select max(tool_ql(p_world, p_uid, t.tool)) from improve_tool t
                           where t.material = v_mat.id), 0);
    -- A failed pass marks the piece rather than spoiling it outright. Oak and
    -- the deep metals are stubborn under the file as under the saw. The gain
    -- used to be written above the roll, which paid a marked piece what a
    -- passed one is worth.
    v_ok := skill_check(skill_of(p_world, p_uid, v_what.skill),
        12 + v_it.ql / 3 + mat_difficulty(v_it.extra), v_tool_ql,
        mind_ease(p_world, p_uid));
    perform skill_raise(p_world, p_uid, v_what.skill, try_gain(v_ok, improve_gain()));
    if not v_ok then
      perform damage_item(v_it.id, 3 + random() * 5);
      perform tell(p_world, p_uid, 'You work at the ' || v_name || ' and mark it. (damage '
        || to_char((select dmg from item where id = v_it.id), 'FM990.0') || ')', 'event');
      return;
    end if;
    v_ceiling := least(99.9, improve_ceiling(p_world, p_uid, v_what.skill, v_it.rare));
    -- And the tree, on the trade that would have made the thing: a smith's
    -- temper is worth as much at the file as at the anvil. The ceiling is
    -- untouched, so this buys passes rather than a higher top.
    update item set ql = greatest(ql, least(v_ceiling,
        ql + improve_step(skill_of(p_world, p_uid, v_what.skill), ql)
             * class_mul(p_world, p_uid, 'fine', v_what.skill)
             -- More a pass for a perk on what it is made of (a Smith's Metal Polisher).
             * pk(p_world, p_uid, 'improve:' || v_what.material, 1)))
      where id = v_it.id returning * into v_it;
    /*
     * And now and again the thing itself comes on, not only its quality.
     *
     * The same odds as the bench, one step at a time: a hundred good passes
     * turn a plain thing rare about once, a thousand a rare thing supreme, ten
     * thousand a supreme thing fantastic. Never two steps, so the only road to
     * the top of it is through the middle of it.
     *
     * A step up also lifts the ceiling it may be bettered to, which is the
     * next pass's business rather than this one's — `v_ceiling` above was
     * worked out for the thing as it stood when this pass started.
     */
    v_lift := rarity_lift(v_it.rare);
    if v_lift is not null then
      update item set rare = v_lift where id = v_it.id returning * into v_it;
      perform journal_note(p_world, p_uid, v_lift);
      perform tell(p_world, p_uid,
        (select r.lift from rarity_def r where r.id = v_lift), 'skill');
    end if;
    perform tell(p_world, p_uid, 'The ' || v_name || ' is better than it was. (QL '
      || to_char(v_it.ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'quench_item' then
    -- A Smith's Temper Bath: the quench its maker put into it, once.
    if coalesce((v_it.mark->>'temper')::double precision, 0) <= 0 then return; end if;
    update item set ql = least(100, ql + (mark->>'temper')::double precision),
                    mark = nullif(mark - 'temper', '{}'::jsonb)
      where id = v_it.id returning * into v_it;
    perform tell(p_world, p_uid, 'You quench the ' || lower(item_name(v_it)) || ' and it comes out harder. (QL '
      || to_char(v_it.ql, 'FM990.0') || ')', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.item_action(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in ('improve_item', 'repair_item', 'patch_item', 'eat', 'drink', 'drink_skin', 'quench_item',
                      'drink_tea', 'take_tincture', 'apply_salve', 'mend_kit', 'seal_item')
$function$;

CREATE OR REPLACE FUNCTION public.item_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare v_it item; v_what improvable_def; v_mat improve_material_def; v_miss text;
        v_ceiling double precision; v_made text; v_tx int; v_ty int; v_p player;
begin
  if p_action = 'drink' then
    v_tx := (p_target->>'x')::int; v_ty := (p_target->>'y')::int;
    if not has_water(p_world, v_tx, v_ty) then return 'There is no water there.'; end if;
    return null;
  end if;

  -- A Tailor's Patch, before anything is asked of the piece: the browser's order.
  if p_action = 'patch_item' and pk(p_world, p_uid, 'patch_item', 0) <= 0 then
    return 'That wants a Tailor who has learned to patch.';
  end if;
  v_it := carried(p_world, p_uid, target_item(p_target));
  if v_it.id is null then return 'It is gone.'; end if;

  if p_action = 'eat' then
    if coalesce((select food from item_def where id = v_it.def), 0) <= 0 then
      return 'That is not food.';
    end if;
    if v_it.holder = 'bag' then return 'Take it out of the bag first.'; end if;
    if v_it.locked then return 'You have that one put by.'; end if;
    return null;

  -- A Naturalist's remedies, which anybody who has one may use.
  elsif p_action = 'drink_tea' then
    if coalesce((select stamina from item_def where id = v_it.def), 0) <= 0 then return 'That is not something to drink.'; end if;
    select * into v_p from player where world_id = p_world and uid = p_uid;
    if coalesce((v_p.stats->>'stamina')::double precision, 1) >= 0.999 then return 'You are not tired.'; end if;
    return null;

  elsif p_action = 'take_tincture' then
    if v_it.def <> 'tincture' then return 'That is not a tincture.'; end if;
    return null;

  elsif p_action = 'apply_salve' then
    if v_it.def <> 'salve' then return 'That is not a salve.'; end if;
    perform wounds_settle(p_world, p_uid);
    select * into v_p from player where world_id = p_world and uid = p_uid;
    return salve_refusal(v_p.wounds);

  elsif p_action = 'drink_skin' then
    if coalesce((select drink from item_def where id = v_it.def), 0) <= 0
       or (select charges from item_def where id = v_it.def) is null then
      return 'There is nothing in that to drink.';
    end if;
    if coalesce(v_it.charges, 0) <= 0 then return 'It is empty.'; end if;
    return null;

  elsif p_action = 'repair_item' then
    if v_it.dmg <= 0 then return 'There is nothing wrong with it.'; end if;
    if v_it.ql <= 1 then return 'It is worn away to nothing and will not take another repair.'; end if;
    return null;

  -- A Mender's kit and sealant, which anybody who has one may use, in the browser's words.
  elsif p_action = 'mend_kit' then
    if v_it.dmg <= 0 then return 'There is nothing wrong with it.'; end if;
    if v_it.def = 'repair_kit' then return 'A kit does not mend itself.'; end if;
    if pack_count(p_world, p_uid, 'repair_kit', null) < 1 then return 'You have no repair kit.'; end if;
    return null;

  elsif p_action = 'seal_item' then
    if v_it.def = 'sealant' then return 'Sealant does not seal itself.'; end if;
    if coalesce(v_it.mark, '{}'::jsonb) ? 'seal' then return 'It is sealed already.'; end if;
    if pack_count(p_world, p_uid, 'sealant', null) < v_it.count then
      return 'You need ' || v_it.count || ' sealant to seal all ' || v_it.count || ' of them; you have '
        || pack_count(p_world, p_uid, 'sealant', null) || '.';
    end if;
    return null;

  elsif p_action = 'patch_item' then
    if patch_with(v_it.def) is null then return 'Only cloth or leather takes a patch.'; end if;
    if v_it.dmg <= 0 then return 'There is nothing wrong with it.'; end if;
    if pack_count(p_world, p_uid, patch_with(v_it.def), null) < 1 then
      return 'You need ' || patch_with(v_it.def) || ' to patch it with.';
    end if;
    return null;

  elsif p_action = 'improve_item' then
    select * into v_what from improvable_def where item = v_it.def;
    if not found then return 'That is not something you can better.'; end if;
    if v_it.holder = 'bag' then return 'Take it out of the bag first.'; end if;
    if v_it.issued then
      return 'That came ashore with you. There is nothing in it to better — make one of your own.';
    end if;
    if v_it.dmg > 10 then return 'It is too knocked about to work on. Repair it first.'; end if;
    select * into v_mat from improve_material_def where id = v_what.material;
    v_miss := missing_tool(p_world, p_uid, v_mat.id);
    if v_miss is not null then
      return 'You need ' || (select string_agg(lower((select coalesce(name, t.tool) from item_def where id = t.tool)),
                                               ' and ' order by t.ord)
                             from improve_tool t where t.material = v_mat.id)
        || ' to work ' || v_mat.name || '.';
    end if;
    v_made := (mat_of(v_it.extra)).name;
    if (stock_for(p_world, p_uid, v_mat.id, v_made)).id is null then
      return 'You have no ' || lower(coalesce(v_made, v_mat.name))
        || ' to work into it, and nothing else will do.';
    end if;
    v_ceiling := improve_ceiling(p_world, p_uid, v_what.skill, v_it.rare);
    if v_it.ql >= v_ceiling then
      return 'Your ' || replace(v_what.skill, '_', ' ') || ' is not good enough to better it further.';
    end if;
    if v_it.ql >= 99.9 then return 'It cannot be bettered.'; end if;
    -- A quality to stop at, when one was asked for. This refusal is the whole
    -- of "take it to sixty": a repeating job asks before every go and stops
    -- the moment it is told no.
    if (p_target ? 'upto') and v_it.ql >= (p_target->>'upto')::numeric then
      return 'The ' || lower(item_name(v_it)) || ' is at QL '
        || to_char(v_it.ql, 'FM990.0') || ', which is what you asked for.';
    end if;
    return null;

  elsif p_action = 'quench_item' then
    -- A Smith's Temper Bath, in the words the browser uses.
    if v_it.holder = 'bag' then return 'Take it out of the bag first.'; end if;
    if coalesce((v_it.mark->>'temper')::double precision, 0) <= 0 then return 'There is no quench left in it.'; end if;
    if pk(p_world, p_uid, 'temper:' || v_it.def, 0) <= 0 then return 'That wants a Smith who has learned to temper.'; end if;
    if not water_near(p_world, p_uid) then
      return 'You need water to quench it in: stand at the water, or beside a barrel or a well of it.';
    end if;
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_act(p_world uuid, p_action text, p_target jsonb, p_times integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); d action_def; p player; why text; secs double precision;
        s double precision; tq double precision; cap int; room int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  perform settle(p_world, me);
  why := act_refusal(p_world, me, p_action, p_target);
  if why is not null then
    perform tell(p_world, me, why, 'error');
    return jsonb_build_object('started', false, 'why', why);
  end if;
  select * into d from action_def where id = p_action;
  select * into p from player where world_id = p_world and uid = me for update;

  -- Something already in hand: line this one up behind it rather than drop it.
  if p.act is not null then
    cap := queue_capacity(p_world, me);
    room := cap - 1 - jsonb_array_length(p.act_queue);
    if room <= 0 then
      why := 'You can only keep ' || cap || ' jobs in your head at once. Mind logic is what widens that.';
      perform tell(p_world, me, why, 'error');
      return jsonb_build_object('started', false, 'queued', false, 'why', why);
    end if;
    /*
     * And what the thing *was*, for a job that may outlive the row it names.
     *
     * Stamped now rather than worked out later, because later is exactly when
     * it cannot be: once `consume` has deleted the last of a stack there is
     * nothing left to ask what kind of thing it had been.
     */
    update player set act_queue = act_queue || (jsonb_build_object(
        'action', p_action, 'target', p_target, 'goes', greatest(1, least(100, coalesce(p_times, 1))))
        || coalesce((select jsonb_build_object('was', i.def) from item i
                      where i.id = target_item(p_target) and i.world_id = p_world), '{}'::jsonb))
      where world_id = p_world and uid = me returning * into p;
    perform tell(p_world, me, d.label || ' is next, ' || jsonb_array_length(p.act_queue) + 1 || ' of ' || cap || ' in hand.', 'info');
    /*
     * And what is in the head now, not just how much of it.
     *
     * The bar drew its queue from `rpc_settle` and nothing else, and
     * `rpc_settle` runs on the heartbeat and when a job comes due — never when
     * one is *added*. So asking for a third job while two were running left the
     * bar saying "2 of 3" until the job in hand finished, at which point one
     * came off the queue and it said "2 of 3" again. Reported as never changing
     * from 2/3 to 3/3, which is exactly what it did: it was always one behind,
     * and topping the queue up kept it there.
     *
     * The answer to the ask is where the browser should hear about what the ask
     * did, so it says so here rather than waiting to be asked again.
     */
    return held_now(p_world, me) || jsonb_build_object('started', false, 'queued', true,
      'inHand', jsonb_array_length(p.act_queue) + 1, 'capacity', cap,
      'queue', coalesce((select jsonb_agg(jsonb_build_object(
                           'action', q->>'action',
                           'goes', greatest(1, coalesce((q->>'goes')::int, 1))) order by o)
                         from jsonb_array_elements(p.act_queue) with ordinality t(q, o)), '[]'::jsonb));
  end if;

  s := case when d.skill is null then 50 else skill_of(p_world, me, d.skill) end;
  -- The tool at what it counts at: a Farmer's Worn-in Rake counts the rake better.
  tq := job_tool_ql(coalesce(p.class_mul, '{}'::jsonb), p_world, me, p_action, d.tool);
  -- Every other job has a floor of a second or so under it; an instant one has
  -- no duration to put a floor under, and act_duration would give it one.
  secs := case when d.instant then 0
               else act_duration(d.base_time, s, tq, control_speed(p_world, me)
                 * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands',
                             act_scope(p_world, me, d.skill)) * bauble_pace(p_world, me, d.skill))
                 -- And what a perk makes of this job's time: a Terraformer's Quick Level,
                 -- a Mason's Quick Mason on stone. After the floor, so that it says
                 -- what it does of a job already down on it (a Mender's Quick Hands).
                 * perk_time(coalesce(p.class_mul, '{}'::jsonb), p_world, p_action, p_target) end;
  update player set
      act = p_action, act_target = p_target, act_started = now(),
      act_ends = now() + make_interval(secs => secs),
      act_left = greatest(1, least(100, coalesce(p_times, 1))),
      act_goes = greatest(1, least(100, coalesce(p_times, 1))), seen_at = now(), away = false
    where world_id = p_world and uid = me;
  /*
   * And what the ask left you holding, said in the answer to the ask.
   *
   * Reported as inventory rubberbanding: a thing put in a crate turns up in
   * the crate and stays in the pack as well, for up to the twenty seconds
   * until the next reconcile, and then goes. Two causes with one shape —
   * nothing ever tells a browser that a thing has *left* its hands.
   *
   * `item` is published with the default replica identity, so a DELETE carries
   * the primary key and nothing else, and the browser's Realtime filter is
   * `holder_uid = me`: a row carrying only an `id` cannot match it. Putting a
   * whole stack in a crate deletes the row, so nothing is said. And a thing
   * that goes to the ground, or to somebody else, has `holder_uid` set to
   * null, so the *new* row does not match the filter either. Realtime carries
   * every arrival and no departure, and `refresh_pack` on the twenty-second
   * reconcile was the only thing that ever noticed.
   *
   * Said at each return rather than worked out once at the top, because for an
   * instant ask the work happens in the `settle` three lines below this — a
   * value built any earlier is the pack as it was before the thing moved,
   * which is the very answer that was wrong.
   */
  if d.instant then
    perform settle(p_world, me);
    return held_now(p_world, me) || jsonb_build_object('started', true, 'done', true, 'seconds', 0);
  end if;
  perform tell(p_world, me, 'You start ' || d.verb || '.', 'info');
  return held_now(p_world, me)
      || jsonb_build_object('started', true, 'ends', now() + make_interval(secs => secs), 'seconds', secs);
end $function$;

CREATE OR REPLACE FUNCTION public.settle(p_world uuid, p_uid uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare p player; d action_def; done int := 0; guard int := 0; nxt jsonb; ended timestamptz;
        v_err text; v_state text; v_where text;
begin
  /*
   * One body's work, and nobody else's.
   *
   * Everything below used to run bare, and `world_tick` settles every body on
   * every island in one transaction: one go that raised an error took the
   * whole round down with it, every second, for as long as that job was
   * still due. Reported as "something just broke, no actions are working":
   * `take_spoil` set the last spadeful in a cart to a count of 0, which the
   * item table refuses, and for a quarter of an hour nothing anybody did on
   * the island finished.
   *
   * So the goes run in a block of their own. A fault undoes what the block
   * had done -- the goes that had come due in this call, and nothing else --
   * stops that job and the queue behind it, tells its owner what the island
   * said, and is kept in `private.tick_fault` for the deploy to report. A
   * deadlock, a lock that timed out or a serialization failure is not a
   * fault in the job: those are raised as before, and the job is tried again
   * next round. A statement timeout is not caught by `others` at all.
   */
  begin
    perform wounds_settle(p_world, p_uid);
    perform body_settle(p_world, p_uid);
    select * into p from player where world_id = p_world and uid = p_uid for update;
    if not found or p.act is null then return 0; end if;
    /*
     * Twenty-five goes to a call, not two hundred.
     *
     * This is the one way a round of the clock can run long: somebody back from
     * an hour away is owed hundreds of goes, and at two hundred apiece — inside
     * `tick_players` inside `tick_worlds` — one person's backlog is the whole
     * tick. It mattered less at five seconds. It matters at one.
     *
     * Nothing is lost by taking less at a time: what is still due is still due,
     * and there is another round a second from now, plus the browser's own beat
     * the moment its job comes up. A backlog drains in seconds either way; the
     * difference is whether everybody else waits while it does.
     */
    while p.act is not null and p.act_ends <= now() and guard < 25 loop
      guard := guard + 1;
      -- A go, for what the baubles make of its yield (`bauble_yield`), and
      -- what they made of it said after the go has said its own piece.
      perform set_config('wurm.bauble_go', 'go', true);
      perform set_config('wurm.bauble_made', '', true);
      -- And the perks, for the rules too deep to be handed the body: for
      -- this go and no other (`pkx`), cleared the moment it is done.
      perform set_config('wurm.pk', coalesce(p.class_mul->'fx', '{}'::jsonb)::text, true);
      perform set_config('wurm.pk_act', p.act, true);
      perform act_perform(p_world, p_uid, p.act, p.act_target);
      perform set_config('wurm.pk', '', true);
      perform set_config('wurm.pk_act', '', true);
      perform bauble_said(p_world, p_uid);
      -- And what the go took out of you, which nothing over here had ever
      -- charged: `action_def.stamina` was a column no function read.
      perform spend_wind(p_world, p_uid, p.act);
      done := done + 1;
      select * into d from action_def where id = p.act;
      ended := p.act_ends;
      if p.act_left > 1 and act_refusal(p_world, p_uid, p.act, p.act_target) is null then
        update player set act_left = act_left - 1, act_started = ended,
               act_ends = ended + make_interval(secs => act_duration(
                 d.base_time,
                 case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end,
                 job_tool_ql(coalesce(p.class_mul, '{}'::jsonb), p_world, p_uid, d.id, d.tool),
                 -- The body's own pace, and then the trade's, which tells only
                 -- on the skill this job is done with.
                 control_speed(p_world, p_uid)
                   * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands',
                               act_scope(p_world, p_uid, d.skill)) * bauble_pace(p_world, p_uid, d.skill))
                 -- And a perk on the job's time, after the floor.
                 * perk_time(coalesce(p.class_mul, '{}'::jsonb), p_world, d.id, p.act_target))
          where world_id = p_world and uid = p_uid returning * into p;
      else
        if p.act_left > 1 then
          -- Why, when there is a why. A run of goes that stops because the wind
          -- gave out should say so rather than leave somebody wondering what
          -- they did wrong, which is what the browser has always said.
          perform tell(p_world, p_uid,
            coalesce(act_refusal(p_world, p_uid, p.act, p.act_target) || ' That was '
                     || (coalesce(p.act_left, 1)) || ' to go.',
                     'You stop ' || d.verb || '.'), 'info');
        end if;
        /*
         * The next job in the line, or the first one behind it that can be done.
         *
         * Reported: "queued up multiple chopping actions, then after the tree
         * was felled and no actions were running I'd dig up the stump and it
         * would show a cutting action following that I didn't queue." The
         * second chop, popped once the tree was down, was refused and put out of
         * the line — and the third stayed in it, behind an empty hand, until the
         * next thing asked for was done and it came up as "then". A refusal puts
         * that job out of the line and asks the next, as the browser's
         * `nextInQueue` has always done, until one starts or the line is empty.
         */
        loop
          nxt := p.act_queue -> 0;
          -- Another onion will do. See `act_retarget`: only when the row it named
          -- has gone, and only to another of what it was.
          nxt := act_retarget(p_world, p_uid, nxt);
          if nxt is null then
            update player set act = null, act_target = null, act_started = null, act_ends = null,
                   act_left = null, act_goes = null
              where world_id = p_world and uid = p_uid returning * into p;
            exit;
          end if;
          select * into d from action_def where id = nxt->>'action';
          if d is null or act_refusal(p_world, p_uid, nxt->>'action', nxt->'target') is not null then
            perform tell(p_world, p_uid,
              coalesce(act_refusal(p_world, p_uid, nxt->>'action', nxt->'target'), 'That cannot be done now.'), 'error');
            update player set act = null, act_target = null, act_started = null, act_ends = null,
                   act_left = null, act_goes = null, act_queue = act_queue - 0
              where world_id = p_world and uid = p_uid returning * into p;
            -- And the one behind it.
          else
            update player set act = nxt->>'action', act_target = nxt->'target',
                   act_left = greatest(1, coalesce((nxt->>'goes')::int, 1)),
                   -- What was asked for, carried out of the queue with the job.
                   -- Without it the browser was left holding the count of
                   -- whatever ran *before* this one, and the bar drew "3 of 10"
                   -- off two numbers from different jobs.
                   act_goes = greatest(1, coalesce((nxt->>'goes')::int, 1)),
                   act_started = ended,
                   act_ends = ended + make_interval(secs => act_duration(
                     d.base_time,
                     case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end,
                     job_tool_ql(coalesce(p.class_mul, '{}'::jsonb), p_world, p_uid, d.id, d.tool),
                     control_speed(p_world, p_uid)
                       * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands',
                                   act_scope(p_world, p_uid, d.skill)) * bauble_pace(p_world, p_uid, d.skill))
                     * perk_time(coalesce(p.class_mul, '{}'::jsonb), p_world, d.id, nxt->'target')),
                   act_queue = act_queue - 0
              where world_id = p_world and uid = p_uid returning * into p;
            perform tell(p_world, p_uid, 'You start ' || d.verb || '.', 'info');
            exit;
          end if;
        end loop;
      end if;
    end loop;
    return done;
  exception
    when deadlock_detected or lock_not_available or serialization_failure then raise;
    when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_where = pg_exception_context;
      perform settle_fault(p_world, p_uid, v_err, v_state, v_where);
      return 0;
  end;
end $function$;

CREATE OR REPLACE FUNCTION public.hurt_player(p_world uuid, p_uid uuid, p_raw double precision, p_what text, p_kind text DEFAULT 'bite'::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player; shield item; sh shield_def; chance double precision; roll double precision;
        part text; piece item; cls armour_class_def; soak double precision; taken double precision;
        health double precision; ws jsonb; had jsonb; found_w boolean := false; out_w jsonb := '[]'::jsonb;
        w jsonb; k wound_kind_def; note text; aegis double precision; v_worn double precision;
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
          * class_mul(p_world, p_uid, 'guard', cls.skill);
    -- Armour is learned by being hit in it, and worn out the same way.
    perform skill_raise(p_world, p_uid, cls.skill, 0.4);
    -- Less for a Mender's Armour Care.
    v_worn := p_raw * 4 * pk(p_world, p_uid, 'worn:armour', 1);
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
        pt player; v_other boolean; v_mend double precision; v_kind text;
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
      dmg := weapon_damage(p_world, p_uid, w, held) * bane * (0.75 + random() * 0.5);
      died := hurt_creature(p_world, c.id, dmg, p_uid);
      -- Less for a Mender's Armour Care.
      if held.id is not null then perform damage_item(held.id, 0.35 * pk(p_world, p_uid, 'worn:weapon', 1)); end if;
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
      dmg := weapon_damage(p_world, p_uid, bow, held) * mat_edge(arrow.extra) * bane
             * (0.6 + arrow.ql / 140) * (0.8 + random() * 0.4);
      died := hurt_creature(p_world, c.id, dmg, p_uid);
      perform damage_item(held.id, 0.25 * pk(p_world, p_uid, 'worn:weapon', 1));
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

CREATE OR REPLACE FUNCTION public.post_life(p_ql double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select post_life_min() + ((least(100, greatest(1, p_ql)) - 1) / 99) * (post_life_max() - post_life_min())
$function$;

CREATE OR REPLACE FUNCTION public.post_dmg(p placed)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select least(100, p.dmg + post_decay_rate(p.ql) / kept_life(p) * extract(epoch from (now() - p.since)))
$function$;

CREATE OR REPLACE FUNCTION public.post_left(p placed)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select greatest(0, post_life(p.ql) * kept_life(p) * (1 - post_dmg(p) / 100))
$function$;

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
    -- Everything working here runs wild, and what it was carrying goes on the
    -- ground where it stood rather than with it. One in a creature crate is in
    -- your crate rather than the settlement's, and stays yours.
    for c in select * from creature where world_id = p_world and keeper = p_uid and mode = 'deed' loop
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
      and (target_item(p_target) is null or id = target_item(p_target))
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
      || round(post_life(p.ql) * kept_life(p) / 60) || ' minutes and reach ' || post_radius(p.ql)
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
    perform journal_note(p_world, p_uid, 'posted');
    perform tell(p_world, p_uid, c.name || ' will '
      || coalesce((select g.plain from gather_def g
                   where g.id = (select gathers from species_def where id = c.species)),
                  'keep to the post')
      || ' within ' || least(work_range(c), post_radius(p.ql))
      || ' tiles of the post while it stands. (' || post_state(p) || ')', 'system');

  elsif p_action = 'unassign_post' then
    select * into c from creature where world_id = p_world and post = p.id limit 1;
    if not found then return; end if;
    select * into dd from my_deed(p_world, c.keeper) md where md.world_id is not null;
    update creature set post = null, phase = 'idle',
        from_x = coalesce(dd.x + 0.5, p.cx), from_y = coalesce(dd.y + 1.5, p.cy),
        to_x = coalesce(dd.x + 0.5, p.cx), to_y = coalesce(dd.y + 1.5, p.cy),
        leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' is called off the post.', 'system');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.trap_dmg(p placed)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select least(100, p.dmg + (100 / (trap_life(p.sub, p.ql) * kept_life(p)))
                            * extract(epoch from (now() - p.since)))
$function$;

CREATE OR REPLACE FUNCTION public.trap_left(p placed)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select greatest(0, trap_life(p.sub, p.ql) * kept_life(p) * (1 - trap_dmg(p) / 100))
$function$;

CREATE OR REPLACE FUNCTION public.trap_settle(p_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare p placed; d trap_def; v_dmg double precision; v_n int; v_best creature;
        v_chance double precision; v_odds double precision; s species_def;
        v_depth double precision; v_got text; v_held int; v_ql double precision; v_new bigint; v_mul jsonb;
begin
  select * into p from placed where id = p_id and kind = 'trap' for update;
  if not found then return false; end if;
  select * into d from trap_def where id = p.sub;

  v_dmg := trap_dmg(p);
  if v_dmg >= 100 then
    if p.caught is not null then
      perform spring_trap(p_id, 'The ' || lower(trap_name(p))
        || ' rots through and whatever was in it walks away.');
    end if;
    if p.made_by is not null then
      perform tell(p.world_id, p.made_by, 'A ' || lower(trap_name(p))
        || ' has rotted through out in the country.', 'system');
    end if;
    delete from item where holder = 'trap' and placed = p_id;
    delete from placed where id = p_id;
    return true;
  end if;

  -- How many rolls there were between then and now, bounded by its own life.
  v_n := floor(least(extract(epoch from (now() - p.since)), trap_life(p.sub, p.ql) * kept_life(p))
               / trap_check_every())::int;
  update placed set dmg = v_dmg, since = now() where id = p_id;
  if p.bait is null or v_n < 1 then return false; end if;

  if d.water then
    v_held := coalesce((select sum(i.count)::int from item i
                        where i.holder = 'trap' and i.placed = p_id), 0);
    -- As many as it holds, more for a Fisher's Deep Creel in it.
    if v_held >= creel_hold(p) then return false; end if;
    -- What its setter's perks make of what its bait draws (a Fisher's Strong Bait and Big Fish).
    select pl.class_mul into v_mul from player pl where pl.world_id = p.world_id and pl.uid = p.made_by;
    v_depth := water_depth(p.world_id, p.x, p.y);
    -- Better odds for its maker's hand in it (a Tailor's Fisher's Friend).
    v_odds := d.odds * (0.6 + least(100, greatest(1, p.ql)) / 250) * mark_of(p.mark, 'catch');
    -- One roll standing for all of them, then one fish for each success it is
    -- still willing to hold.
    for v_n in 1..least(v_n, creel_hold(p) - v_held) loop
      exit when random() >= v_odds;
      v_got := pick_fish(v_depth, 40, p.bait, random(), v_mul);
      exit when v_got is null;
      v_ql := greatest(1, least(100, p.ql * (0.5 + random() * 0.7)));
      insert into item (world_id, holder, placed, def, ql, count)
      values (p.world_id, 'trap', p_id, v_got, v_ql, 1);
      -- Every so often the bait is worked out of it and it goes on empty.
      if random() < 0.14 then
        update placed set bait = null, bait_ql = null where id = p_id;
        if p.made_by is not null then
          perform tell(p.world_id, p.made_by, 'The bait is gone out of a creel. '
            || 'It will take nothing more until it is baited again.', 'system');
        end if;
        exit;
      end if;
    end loop;
    return false;
  end if;

  if p.caught is not null then return false; end if;
  -- The likeliest thing in reach that would come to what is laid, and is not
  -- so wary that it simply takes the bait and goes.
  for v_best in select c.* from creature c
    where c.world_id = p.world_id and c.mode = 'wild' and c.trapped is null
      and sqrt((creature_x(c) - p.cx) ^ 2 + (creature_y(c) - p.cy) ^ 2) <= d.reach
    order by catch_chance(p, c) desc, c.id
  loop
    select * into s from species_def where id = v_best.species;
    if s.monster or not exists (select 1 from species_diet sd
          where sd.species = s.id and sd.item = p.bait) then
      continue;
    end if;
    if s.tame_level > trap_holds(p) then
      -- Too much trap for: a third of a chance a roll that it lifts the bait.
      if random() < 1 - power(0.7, v_n) then
        update placed set bait = null, bait_ql = null where id = p_id;
        if p.made_by is not null then
          perform tell(p.world_id, p.made_by, 'Something took the bait out of your '
            || lower(trap_name(p)) || ' and was gone. It was too much trap for.', 'system');
        end if;
        return false;
      end if;
      continue;
    end if;
    v_chance := catch_chance(p, v_best);
    exit;
  end loop;
  if v_best.id is null or v_chance is null then return false; end if;

  -- The one roll that stands for all of them.
  if random() >= 1 - power(1 - v_chance, v_n) then return false; end if;
  update creature set trapped = p_id,
      from_x = p.cx, from_y = p.cy, to_x = p.cx, to_y = p.cy,
      leg_at = now(), leg_ends = now(), until = now() + interval '1 hour',
      hunting = null, enemy = null, settled_at = now()
    where world_id = p.world_id and id = v_best.id;
  update placed set caught = v_best.id where id = p_id;
  if p.made_by is not null then
    -- The browser's own words, and it says them the instant the board falls.
    -- Here nobody was there for the instant, so it is said when somebody next
    -- looks — which is the whole of what a trap is for.
    perform journal_note(p.world_id, p.made_by, 'caught');
    perform tell(p.world_id, p.made_by, 'Your ' || lower(trap_name(p))
      || ' has sprung. There is a ' || lower(s.name) || ' in it.', 'event');
  end if;
  return false;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_trap(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p placed; d trap_def; it item; c creature; s species_def; dd deed;
        v_sx int; v_sy int; v_names text; v_comers int; v_clean boolean; v_back bigint; v_one bigint;
begin
  if p_action = 'set_trap' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and not locked and exists (select 1 from trap_def td where td.id = item.def)
      and (target_item(p_target) is null or id = target_item(p_target))
      order by id limit 1;
    if not found then return; end if;
    select * into d from trap_def where id = it.def;
    v_sx := least(subtiles() - 1, greatest(0, coalesce((p_target->>'sx')::int, 0)));
    v_sy := least(subtiles() - 1, greatest(0, coalesce((p_target->>'sy')::int, 0)));
    -- Its maker's hand goes into the water with it (a Tailor's Fisher's Friend).
    insert into placed (world_id, kind, sub, material, x, y, sx, sy, cx, cy, ql, dmg, made_by, mark)
    values (p_world, 'trap', it.def, it.extra, (p_target->>'x')::int, (p_target->>'y')::int,
            v_sx, v_sy, (p_target->>'x')::int + (v_sx + 0.5) / subtiles(),
            (p_target->>'y')::int + (v_sy + 0.5) / subtiles(), it.ql, it.dmg, p_uid, nullif(it.mark, '{}'::jsonb))
    returning * into p;
    delete from item where id = it.id;
    perform tell(p_world, p_uid, case when d.water
      then 'You sink the ' || lower(trap_name(p)) || ' and make the line fast. It will fish about '
           || round(trap_life(p.sub, p.ql) * kept_life(p) / 60) || ' minutes and holds ' || creel_hold(p) || '. Bait it.'
      else 'You set the ' || lower(trap_name(p)) || ' and cover the sign of it. It will stand about '
           || round(trap_life(p.sub, p.ql) * kept_life(p) / 60) || ' minutes and will hold anything up to taming '
           || to_char(trap_holds(p), 'FM990') || '. Bait it.' end, 'event');
    perform land_announce(p_world, p.x, p.y);
    return;
  end if;

  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
  if not found then return; end if;
  select * into d from trap_def where id = p.sub;

  if p_action = 'bait_trap' then
    it := bait_in_pack(p_world, p_uid, d.water);
    if it.id is null then return; end if;
    -- Whatever was in it goes back in the pack rather than on the ground.
    if p.bait is not null then perform give(p_world, p_uid, p.bait, 1, coalesce(p.bait_ql, 20)); end if;
    if not consume(p_world, p_uid, it.def, 1, it.id) then return; end if;
    update placed set bait = it.def, bait_ql = it.ql, since = now() where id = p.id;
    if d.water then
      perform tell(p_world, p_uid, 'You put the '
        || lower((select name from item_def where id = it.def))
        || ' in the creel and sink it again. '
        || coalesce((select note from bait_def where id = it.def), ''), 'event');
    else
      select count(*) into v_comers from species_def sp
        where exists (select 1 from species_diet sd where sd.species = sp.id and sd.item = it.def)
          and sp.tame_level <= trap_holds(p);
      perform tell(p_world, p_uid, 'You lay the '
        || lower((select name from item_def where id = it.def)) || ' in the ' || lower(trap_name(p))
        || '. ' || case when v_comers = 0 then 'Nothing this trap will hold eats that.'
                        when v_comers = 1 then 'One sort would come to that.'
                        else v_comers || ' sorts would come to that.' end, 'event');
    end if;

  elsif p_action = 'take_catch' then
    select * into c from creature where world_id = p_world and id = p.caught;
    if not found then return; end if;
    select * into s from species_def where id = c.species;
    if tame_room_refusal(p_world, p_uid) is not null then
      perform tell(p_world, p_uid, tame_room_refusal(p_world, p_uid), 'error');
      return;
    end if;
    -- It is held, not willing. Getting it out without being bitten is the skill.
    v_clean := skill_check(skill_of(p_world, p_uid, 'taming'), s.tame_level + 10, p.ql,
                           mind_ease(p_world, p_uid));
    perform skill_raise(p_world, p_uid, 'taming', try_gain(v_clean, free_gain()));
    if not v_clean then
      perform tell(p_world, p_uid, 'The ' || lower(s.name)
        || ' thrashes and you cannot get a hand on it. It is still held.', 'error');
      return;
    end if;
    update placed set caught = null, bait = null, bait_ql = null where id = p.id;
    -- Won over as surely as by hand, and on the same skill: the field guide counts it as tamed.
    perform guide_mark(p_world, p_uid, c.species, 'tamed');
    select * into dd from my_deed(p_world, p_uid) md where md.world_id is not null;
    if not exists (select 1 from creature q where q.world_id = p_world and q.mode = 'active'
                     and q.keeper = p_uid) then
      update creature set trapped = null, mode = 'active', keeper = p_uid, until = now()
        where world_id = p_world and id = c.id;
      perform journal_note(p_world, p_uid, 'trapped');
      perform tell(p_world, p_uid, 'You get the noose off the ' || lower(s.name)
        || ' and it stays. It comes with you.', 'event');
    else
      update creature set trapped = null, mode = 'active', keeper = p_uid, until = now()
        where world_id = p_world and id = c.id;
      perform crate_shut_in(p_world, c.id, empty_crate(p_world, p_uid), null);
      perform journal_note(p_world, p_uid, 'trapped');
      perform tell(p_world, p_uid, 'You get the noose off the ' || lower(s.name)
        || ' and put it straight into the creature crate in your pack.', 'event');
    end if;

  elsif p_action = 'free_catch' then
    perform spring_trap(p.id,
      'You lift the board and it is gone into the grass before you have straightened up.');

  elsif p_action = 'empty_creel' then
    select string_agg(i.count || ' × ' || lower(f.name), ', ' order by f.name), count(*)
      into v_names, v_comers
      from item i join item_def f on f.id = i.def
      where i.holder = 'trap' and i.placed = p.id;
    if v_comers = 0 then return; end if;
    -- Into the cart you are working from first, as far as it has room.
    for v_one in select i.id from item i where i.holder = 'trap' and i.placed = p.id order by i.id loop
      perform gather_item(p_world, p_uid, v_one);
    end loop;
    update item set holder = 'player', holder_uid = p_uid, placed = null
      where holder = 'trap' and placed = p.id;
    perform pack_fold(p_world, p_uid);
    perform skill_raise(p_world, p_uid, 'fishing', 0.5);
    perform journal_note(p_world, p_uid, 'creeled');
    perform tell(p_world, p_uid, 'You lift the creel and tip it out: ' || v_names || '.', 'event');

  elsif p_action = 'pick_up_trap' then
    if p.bait is not null then perform give(p_world, p_uid, p.bait, 1, coalesce(p.bait_ql, 20)); end if;
    update item set holder = 'player', holder_uid = p_uid, placed = null
      where holder = 'trap' and placed = p.id;
    perform pack_fold(p_world, p_uid);
    v_back := give(p_world, p_uid, p.sub, 1, p.ql, p.material, null, null, null, p.mark);
    update item set dmg = trap_dmg(p) where id = v_back;
    perform tell(p_world, p_uid, 'You take the ' || lower(trap_name(p)) || ' up'
      || case when p.bait is not null then ' and pocket the bait' else '' end || '.', 'event');
    delete from placed where id = p.id;
    perform land_announce(p_world, p.x, p.y);
  end if;
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
  perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(true, restore_gain()));
  perform tell(p_world, p_uid, case when t.id = found_t.id then 'The tarnish comes away and the bauble is whole: '
      else 'The tarnish comes away and the ' || found_t.id || ' bauble is '
           || case when t.id ~ '^[aeiou]' then 'an ' else 'a ' end || t.id || ' one: ' end
    || lower((select item_name(i) from item i where i.id = v_new)) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
end $function$;

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
  -- Surer for a Mender's Sure Restore, and no harm on a failure for Gentle Hands.
  if not perk_pass(skill_check(skill_of(p_world, p_uid, 'restoration'), r.difficulty, 0,
                               mind_ease(p_world, p_uid)),
                   pk(p_world, p_uid, 'fail:restore_relic', 1)) then
    for v_piece in select * from pieces_held(p_world, p_uid, v_relic) loop
      perform damage_item(v_piece.id, (restore_harm() + random() * restore_harm_spread())
                                      * pk(p_world, p_uid, 'harm:restore_relic', 1));
    end loop;
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
  perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(true, restore_gain()));
  perform tell(p_world, p_uid, 'The pieces go back together and the ' || r.name || ' is whole: '
    || lower((select item_name(i) from item i where i.id = v_new))
    || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
end $function$;

CREATE OR REPLACE FUNCTION public.improve_ceiling(p_world uuid, p_uid uuid, p_skill text, p_rare text)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  -- Nobody is held under the floor, and a Mender with Handyman under one of their own.
  select greatest(pk(p_world, p_uid, 'floor:improve', improve_floor()), skill_of(p_world, p_uid, p_skill))
       + coalesce((select r.ceiling from rarity_def r where r.id = p_rare), 0)
$function$;

CREATE OR REPLACE FUNCTION public.craft_refusal(p_world uuid, p_uid uuid, p_recipe text, p_prefer bigint)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare r recipe; i record; mat text; have int; tx int; ty int;
begin
  select * into r from recipe where id = p_recipe;
  if not found then return null; end if;
  -- What only a Cook who has learned it may make (a Cook's Broth and Distil).
  -- The browser says the same (`RECIPE_PERK_SAYS`).
  if p_recipe = 'make_broth' and pk(p_world, p_uid, 'broth', 0) <= 0 then
    return 'That wants a Cook who has learned to make broth.';
  end if;
  if p_recipe like 'distil\_%' and pk(p_world, p_uid, 'distil', 0) <= 0 then
    return 'That wants a Cook who has learned to distil.';
  end if;
  if p_recipe = 'make_tent' and pk(p_world, p_uid, 'tent', 0) <= 0 then
    return 'That wants a Tailor who has learned to make a tent.';
  end if;
  -- A Naturalist's three remedies, each of any of the healing herbs.
  if p_recipe like 'brew\_tea\_%' and pk(p_world, p_uid, 'herb_tea', 0) <= 0 then
    return 'That wants a Naturalist who has learned to make herb tea.';
  end if;
  if p_recipe like 'make\_salve\_%' and pk(p_world, p_uid, 'salve', 0) <= 0 then
    return 'That wants a Naturalist who has learned to make a salve.';
  end if;
  if p_recipe like 'make\_tincture\_%' and pk(p_world, p_uid, 'tincture', 0) <= 0 then
    return 'That wants a Naturalist who has learned to make a tincture.';
  end if;
  -- A Fisher's smoked fish, of any fish, and their pond.
  if p_recipe like 'smoke\_%' and pk(p_world, p_uid, 'smoke_fish', 0) <= 0 then
    return 'That wants a Fisher who has learned to smoke fish.';
  end if;
  if p_recipe = 'make_fish_pond' and pk(p_world, p_uid, 'fish_pond', 0) <= 0 then
    return 'That wants a Fisher who has learned to make a fish pond.';
  end if;
  -- A Mender's repair kit and sealant.
  if p_recipe = 'make_repair_kit' and pk(p_world, p_uid, 'repair_kit', 0) <= 0 then
    return 'That wants a Mender who has learned to make a repair kit.';
  end if;
  if p_recipe = 'make_sealant' and pk(p_world, p_uid, 'sealant', 0) <= 0 then
    return 'That wants a Mender who has learned to make sealant.';
  end if;
  if r.tool is not null and tool_ql(p_world, p_uid, r.tool) <= 0 then
    return 'You need a ' || lower((select coalesce(name, r.tool) from item_def where id = r.tool)) || '.';
  end if;
  if r.station is not null and not at_station(p_world, p_uid, r.station) then
    return 'You need to stand at a ' || station_name(r.station) || '.';
  end if;
  if r.deed then
    select floor(p.x)::int, floor(p.y)::int into tx, ty
      from player p where p.world_id = p_world and p.uid = p_uid;
    if tx is null or not on_my_deed(p_world, p_uid, tx, ty) then
      return 'You can only build this standing on a settlement of yours.';
    end if;
    -- And one altar to a settlement: none built on one that has its altar.
    if exists (select 1 from furniture_def f where f.id = r.result and f.altar)
       and altar_on_deed(p_world, p_uid, tx, ty) then
      return 'This settlement already has an altar, and a settlement may have only one.';
    end if;
  end if;
  mat := craft_material(p_world, p_uid, p_recipe, p_prefer);
  for i in select * from recipe_input where recipe = p_recipe order by ord loop
    have := greatest(craft_count(p_world, p_uid, i.item, mat, p_prefer), craft_count(p_world, p_uid, i.item, null, p_prefer));
    -- As few as a perk on the recipe asks (a Carpenter's String Maker).
    if have < recipe_need(p_world, p_uid, p_recipe, i.count) then
      return (select coalesce(name, r.result) from item_def where id = r.result)
        || ' takes ' || recipe_need(p_world, p_uid, p_recipe, i.count) || ' '
        || plural_of(i.item, recipe_need(p_world, p_uid, p_recipe, i.count)) || '.';
    end if;
  end loop;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.ground_decay_rate(it item)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(d.decay, (select c.per_hour from category_decay c where c.category = d.category), 12)
       * greatest(0.3, 1.4 - it.ql / 120)
       * coalesce((select m.decay from material_def m where m.id = it.extra), 1)
       * rarity_keep(it.rare)
       -- Slower for its maker's hand in it (a Cook's Long-lasting), and for
       -- the hand that set it down (a Cook's Cool Pack); not at all for a
       -- Mender's sealant on it.
       * mark_of(it.mark, 'rot') * mark_of(it.mark, 'seal') * coalesce(it.cool, 1)
    from item_def d where d.id = it.def
$function$;

CREATE OR REPLACE FUNCTION public.perform_craft(p_world uuid, p_uid uuid, p_recipe text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare r recipe; i record; v_n int; prefer bigint; mat text; hard double precision; tq double precision;
        s double precision; made_ql double precision; rare text; total double precision := 0;
        v_made bigint; weight double precision := 0; one double precision; share double precision;
        only_mat boolean; was text; v_base int; spared boolean := false; v_mark jsonb;
        v_parts jsonb := '{}'::jsonb; v_part jsonb; v_own jsonb; v_lye double precision; v_kept boolean := false;
        v_keep double precision; v_spare recipe_input; v_spare_ql double precision;
begin
  select * into r from recipe where id = p_recipe;
  prefer := target_item(p_target);
  -- What the run is aimed at, while it is still there to ask.
  select it.def into was from item it where it.id = prefer and it.world_id = p_world;
  mat := craft_material(p_world, p_uid, p_recipe, prefer);
  s := skill_of(p_world, p_uid, r.skill);
  tq := case when r.tool is null then 0 else tool_ql(p_world, p_uid, r.tool) end;
  /*
   * The tool wears on every go, whether or not the go comes off, as it does in
   * the hand and always has in the browser (`Game.act`). The island's bench
   * never wore anything, so a saw sawed for ever -- and a Carpenter's Saw
   * Care, which is how much less it wears (`wear_tool`), spared nothing.
   */
  if r.tool is not null then perform wear_tool(held_tool(p_world, p_uid, r.tool)); end if;
  -- Oak and the deep metals fight the hands that shape them.
  hard := craft_hardness(p_recipe, mat);
  -- Bars broken into for what loose lumps are short of (a Smith's Ingots),
  -- before anything reads the lumps: what they weigh in the quality, and what
  -- a failed batch throws away.
  for i in select ri.item, ri.count from recipe_input ri join metal_def m on m.lump = ri.item where ri.recipe = p_recipe loop
    perform break_bars(p_world, p_uid, i.item,
      recipe_need(p_world, p_uid, p_recipe, i.count) - craft_count_loose(p_world, p_uid, i.item, null, prefer), prefer);
  end loop;

  -- A Mason's Sure Chisel fails half as often on stonecutting (`fail:` and the recipe).
  if r.difficulty is not null and not perk_pass(skill_check(s, hard, tq), pk(p_world, p_uid, 'fail:' || p_recipe, 1)) then
    -- And a Mason's Nothing Wasted keeps what went into a failed smelter or kiln.
    spared := r.consume_on_fail and random() < pk(p_world, p_uid, 'spare:' || p_recipe, 0);
    if r.consume_on_fail and not spared then
      for i in select * from recipe_input where recipe = p_recipe order by ord loop
        perform craft_consume(p_world, p_uid, i.item, recipe_need(p_world, p_uid, p_recipe, i.count), prefer, mat);
      end loop;
      -- The batch is wasted, not the vessel: you tip the ruin out and keep the
      -- bucket. Salvage if the recipe names any, otherwise whatever it returns.
      for i in
        select g.item, g.count from recipe_gives g
        where g.recipe = p_recipe
          and g.kind = (case when exists (select 1 from recipe_gives where recipe = p_recipe and kind = 'salvage')
                             then 'salvage' else 'return' end)
      loop
        perform give(p_world, p_uid, i.item, i.count, 20);
      end loop;
      perform craft_carry_on(p_world, p_uid, p_recipe, p_target, was, mat);
    end if;
    perform skill_raise(p_world, p_uid, r.skill, try_gain(false));
    perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(false, craft_head()));
    perform tell(p_world, p_uid, coalesce(r.fail,
      'You fail to make ' || lower((select coalesce(name, r.result) from item_def where id = r.result)) || '.'), 'event');
    if spared then perform tell(p_world, p_uid, 'Nothing that went into it is lost.', 'event'); end if;
    return;
  end if;

  -- The quality of what is about to be used up, worked out before it is used
  -- up, since using it up changes the answer: off the stack each input would
  -- be spent from first, which is the clicked one where it is one of them.
  if r.ql_from_inputs then
    for i in select * from recipe_input where recipe = p_recipe order by ord loop
      only_mat := mat is not null and craft_count(p_world, p_uid, i.item, mat, prefer) >= recipe_need(p_world, p_uid, p_recipe, i.count);
      select st.ql into one from craft_stock(p_world, p_uid, prefer) st
        where st.def = i.item and (not only_mat or st.extra is not distinct from mat)
        order by (st.id = prefer) desc, st.draw limit 1;
      if one is not null then
        -- By mass, not by the count. Two nails weigh two hundredths of a
        -- kilogram between them and do not get to decide what a pickaxe is.
        share := coalesce((select d.weight from item_def d where d.id = i.item), 1) * i.count;
        total := total + one * share;
        weight := weight + share;
      end if;
    end loop;
  end if;

  /*
   * What the parts carry of their makers' marks, off the stack each would be
   * spent from first, before spending them: a Smith's Keen Edge in a sword
   * blade goes into the sword whoever fits it. Only the parts the anvil beats
   * out, which are the only ones that carry a mark into anything, and only for
   * a thing made one at a time, which has a row to carry it; the larger where
   * two say the same, and never a temper, which is for whoever finishes it,
   * nor a seal, which is on the part and not on what it goes into.
   */
  if not item_stackable(r.result) then
    for i in select ri.* from recipe_input ri where ri.recipe = p_recipe
               and (exists (select 1 from mould_def md where md.makes = ri.item)
                    -- And a yoke's pace into the cart or wagon it goes on (a Tailor's Saddler).
                    or ri.item in ('yoke')) order by ri.ord loop
      only_mat := mat is not null and craft_count(p_world, p_uid, i.item, mat, prefer) >= recipe_need(p_world, p_uid, p_recipe, i.count);
      select it.mark into v_part from craft_stock(p_world, p_uid, prefer) st join item it on it.id = st.id
        where st.def = i.item and (not only_mat or st.extra is not distinct from mat)
        order by (st.id = prefer) desc, st.draw limit 1;
      if v_part is not null then
        select v_parts || coalesce(jsonb_object_agg(k.key, greatest(k.value::text::double precision,
                 coalesce((v_parts->>k.key)::double precision, k.value::text::double precision))), '{}'::jsonb)
          into v_parts
          from jsonb_each(v_part - 'temper' - 'seal') k;
      end if;
    end loop;
  end if;
  /*
   * A Cook's Frugal Cook: one of the first ingredient that is not a vessel
   * back now and then, at the quality of the stack it would be spent from
   * first -- asked before the spending, which changes the answer. Only asked
   * of a recipe the perk is on.
   */
  v_keep := pk(p_world, p_uid, 'keep:' || p_recipe, 0);
  if v_keep > 0 then
    select ri.* into v_spare from recipe_input ri
     where ri.recipe = p_recipe and ri.item <> 'bucket'
       and not exists (select 1 from vessel_def v where v.item = ri.item)
     order by ri.ord limit 1;
    if v_spare.item is not null then
      only_mat := mat is not null and craft_count(p_world, p_uid, v_spare.item, mat, prefer) >= recipe_need(p_world, p_uid, p_recipe, v_spare.count);
      select st.ql into v_spare_ql from craft_stock(p_world, p_uid, prefer) st
        where st.def = v_spare.item and (not only_mat or st.extra is not distinct from mat)
        order by (st.id = prefer) desc, st.draw limit 1;
    end if;
  end if;
  -- A Tailor's Lye Saver: now and then the vessel's liquid is not used up,
  -- and the full vessel stays as it was rather than coming back empty.
  v_lye := pk(p_world, p_uid, 'lye:' || p_recipe, 0);
  v_kept := v_lye > 0 and random() < v_lye;
  for i in select * from recipe_input where recipe = p_recipe order by ord loop
    continue when v_kept and exists (select 1 from vessel_def v where v.item = i.item);
    if not craft_consume(p_world, p_uid, i.item, recipe_need(p_world, p_uid, p_recipe, i.count), prefer, mat) then return; end if;
  end loop;
  perform craft_carry_on(p_world, p_uid, p_recipe, p_target, was, mat);

  if r.ql_from_inputs then
    made_ql := greatest(1, least(100, (case when weight > 0 then total / weight else 1 end) * (0.78 + s / 460)));
  else
    made_ql := product_ql(s, tq);
  end if;
  -- And the tree, on the trade the recipe belongs to: the quality of what came
  -- off the bench, however it was arrived at. A hundred is still a hundred.
  made_ql := least(100, made_ql * class_mul(p_world, p_uid, 'fine', r.skill));
  -- And better for a perk on the recipe (a Cook's Fine Fare).
  made_ql := least(100, made_ql * pk(p_world, p_uid, 'ql:' || p_recipe, 1));
  -- A Carpenter's Master Joiner: the first step of rarity at better odds on the joinery (`rare:` and the recipe).
  rare := perk_rare(pk(p_world, p_uid, 'rare:' || p_recipe, (select d.odds from rarity_def d order by d.ord limit 1)));
  -- More, the go a bauble on the trade comes up in the altar of the settlement you work on.
  -- A Mason's Three from a Shard and Good Mix: more of it at a go (`count:` and what it makes).
  v_base := pk(p_world, p_uid, 'count:' || r.result, r.count)::int;
  v_n := bauble_yield(p_world, p_uid, r.result, v_base);
  /*
   * What the maker's perks put into it, which stays with it whoever has it
   * after (a Carpenter's Deep Drawers, Keel Layer, True Bow; a Cook's Hearty),
   * over what its parts carried (a Smith's Keen Edge). A pile of the same
   * thing marked the same way is one pile, so a thing made by the handful goes
   * into the pack with its mark and stacks by it; a thing made one at a time
   * is a row of its own and takes it after.
   */
  v_own := coalesce(made_mark((select pl.class_mul from player pl
                                where pl.world_id = p_world and pl.uid = p_uid), r.result), '{}'::jsonb);
  v_mark := v_parts || v_own;
  -- A pace is multiplied, since a yoke's and a builder's are two reasons to go
  -- faster; the maker's own stands over the parts' in everything else.
  if v_parts ? 'speed' and v_own ? 'speed' then
    v_mark := jsonb_set(v_mark, '{speed}', to_jsonb((v_parts->>'speed')::double precision * (v_own->>'speed')::double precision));
  end if;
  v_mark := nullif(v_mark, '{}'::jsonb);
  if item_stackable(r.result) then
    v_made := give(p_world, p_uid, r.result, v_n, made_ql, coalesce(r.extra, mat), rare, maker_mark(p_world, p_uid, rare), null, v_mark);
  else
    v_made := give(p_world, p_uid, r.result, v_n, made_ql, coalesce(r.extra, mat), rare, maker_mark(p_world, p_uid, rare));
    if v_mark is not null then update item set mark = v_mark where id = v_made; end if;
  end if;
  -- A vessel comes off the bench full: a bucket of juice holds its five drinks.
  update item set charges = d.charges from item_def d
    where item.id = v_made and item.charges is null and d.id = item.def and d.charges is not null;
  -- Into the ledger, which is the only memory this island has of what you have
  -- made. It says so when it is your first of a kind or your best.
  perform journal_made(p_world, p_uid, r.result, made_ql, v_n, rare);
  if rare is not null then
    perform journal_note(p_world, p_uid, rare);
    perform tell(p_world, p_uid, rarity_word(rare), 'skill');
  end if;
  for i in select g.item, g.count from recipe_gives g where g.recipe = p_recipe and g.kind = 'return' loop
    continue when v_kept and exists (select 1 from recipe_input ri join vessel_def v on v.item = ri.item
                                      where ri.recipe = p_recipe and v.empty = i.item);
    perform give(p_world, p_uid, i.item, i.count, 20);
  end loop;
  if v_kept then perform tell(p_world, p_uid, 'There is enough left in the bucket for another.', 'event'); end if;
  if v_spare.item is not null and random() < v_keep then
    perform give(p_world, p_uid, v_spare.item, 1, coalesce(v_spare_ql, made_ql));
    perform tell(p_world, p_uid, 'You save '
      || case when lower((select coalesce(name, v_spare.item) from item_def where id = v_spare.item)) ~ '^[aeiou]' then 'an ' else 'a ' end
      || lower((select coalesce(name, v_spare.item) from item_def where id = v_spare.item)) || ' from the pot.', 'event');
  end if;

  perform skill_raise(p_world, p_uid, r.skill, 1);
  -- Working a thing out with your hands is what sharpens the head.
  perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(true, craft_head()));
  perform tell(p_world, p_uid, count_said(r.done, r.count, v_base) || ' (' || case when mat is not null then lower(mat) || ', ' else '' end
    || 'QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
end $function$;

CREATE OR REPLACE FUNCTION public.mark_says(p_mark jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case when count(*) = 0 then ''
              else ' Its maker''s hand is in it: it ' || list_of(array_agg(s.say order by s.ord)) || '.' end
         -- A seal is whoever sealed it, not the maker, and is said on its own.
         || case when p_mark ? 'seal' then ' It is sealed and never decays.' else '' end
  from (
    select f.ord, case f.fam
        when 'hold' then 'holds ' || round(((m - 1) * 100)::numeric)::int || '% more'
        when 'speed' then 'goes ' || round(((m - 1) * 100)::numeric)::int || '% faster'
        when 'damage' then 'hits ' || round(((m - 1) * 100)::numeric)::int || '% harder'
        when 'range' then 'reaches ' || round(((m - 1) * 100)::numeric)::int || '% further'
        when 'soak' then 'turns aside ' || round(((m - 1) * 100)::numeric)::int || '% more of a blow'
        when 'aim' then 'lands ' || round(((m - 1) * 100)::numeric)::int || '% more often'
        when 'last' then 'lasts ' || times_said(m) || ' as many fillings'
        when 'temper' then 'can be quenched once, for +' || rtrim(to_char(m, 'FM9999990.999999'), '.') || ' QL'
        when 'feed' then 'feeds each thing it feeds ' || round(((m - 1) * 100)::numeric)::int || '% more'
        when 'fill' then 'fills ' || round(((m - 1) * 100)::numeric)::int || '% more of the food bar'
        when 'knack' then 'gives a knack that lasts ' || round(((m - 1) * 100)::numeric)::int || '% longer'
        when 'rot' then 'rots ' || round(((1 - m) * 100)::numeric)::int || '% slower'
        when 'catch' then 'catches ' || round(((m - 1) * 100)::numeric)::int || '% more'
      end as say
    from unnest(array['hold', 'speed', 'damage', 'range', 'soak', 'aim', 'last', 'temper',
                      'feed', 'fill', 'knack', 'rot', 'catch']) with ordinality f(fam, ord),
         lateral (select (p_mark->>f.fam)::double precision as m) v
    where p_mark ? f.fam
  ) s
$function$;

CREATE OR REPLACE FUNCTION public.made_mark(p_mul jsonb, p_def text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select nullif(jsonb_strip_nulls(jsonb_build_object(
    'hold', p_mul->'fx'->('hold:' || p_def),
    'speed', p_mul->'fx'->('speed:' || p_def),
    'damage', p_mul->'fx'->('damage:' || p_def),
    'range', p_mul->'fx'->('range:' || p_def),
    'soak', p_mul->'fx'->('soak:' || p_def),
    'aim', p_mul->'fx'->('aim:' || p_def),
    'last', p_mul->'fx'->('last:' || p_def),
    'temper', p_mul->'fx'->('temper:' || p_def),
    'feed', p_mul->'fx'->('feed:' || p_def),
    'fill', p_mul->'fx'->('fill:' || p_def),
    'knack', p_mul->'fx'->('knack:' || p_def),
    'rot', p_mul->'fx'->('rot:' || p_def),
    'catch', p_mul->'fx'->('catch:' || p_def),
    'seal', p_mul->'fx'->('seal:' || p_def))), '{}'::jsonb)
$function$;


/*
 * The Mender's tree, cleared, as the twelve before it were: its nodes left
 * `class_node` with the rulebook that brought its perks, whatever of them
 * anybody had taken goes, and every Mender's fold is written again. And every
 * Smith's: the hammer these definitions bring is a tool head the anvil beats
 * out and a tool fitted from it, so a Smith's Toolsmith and Temper Bath speak
 * for it now, and a fold written before it was there would not.
 */
delete from player_node where node ~ '^mender_[0-9]_[0-9]$';
do $$
declare r record;
begin
  for r in select world_id, uid from player where craft_class in ('mender', 'smith') loop
    perform class_fold(r.world_id, r.uid);
  end loop;
end $$;

revoke all on function kept_life(placed) from public, anon, authenticated;
select private.lock_doors();
