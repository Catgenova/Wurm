-- A thing in a bag is a thing you are carrying.
--
-- Reported as "fix the bag so that liquid can be transferred between it like a
-- bucket or barrel". Put a water skin in your backpack and every liquid rule
-- on the island stops being able to see it:
--
--     in the bag, fill:          It is gone.
--     in the bag, drink:         It is gone.
--     in the bag, fill a bucket: It is gone.
--
-- Nothing was refusing anything. The lookup at the top of each of these is
-- `holder = 'player' and holder_uid = p_uid`, written out inline in four
-- places, and `stow_item` sets `holder = 'bag'`. So the row is right there,
-- with your uid on it, and the rules have never once looked.
--
-- `carried` is that lookup, once, with the bag in it. Its definition of at
-- hand is the honest one: on you, or in a bag that is itself on you — so a
-- backpack left at a work post is a store you stand next to like any other,
-- not a pocket you reach into from across the island.
--
-- Two of the four wrote it differently again. `perform_item` had no holder
-- check at all; it was not reachable, because `rpc_act` puts every ask through
-- `act_refusal` first and that one did check, but a perform that trusts its
-- caller for who owns a thing is a loose end and it is tied off here.
--
-- ## And what a bucket is
--
-- `fill_bucket`, `empty_bucket` and `pour_into_barrel` did their work with
-- `consume` and then `give`: spend the bucket, hand over a bucket of water.
-- Two rows where there is one thing. It cannot find a bucket in a bag at all,
-- and what it hands back goes into your hands rather than the pocket the
-- bucket came out of — so a bag would have quietly emptied itself one bucket
-- at a time.
--
-- `vessel_becomes` turns the row into the other def and leaves it where it is.
-- A bucket is not a stackable thing, so there was never more than one of it
-- anyway, and the swap keeps what the pair of them dropped:
--
--   * where it is — your hands, or the bag, and after this the ledger of a
--     bag is the same before and after you fill what is in it
--   * its number, so anything holding a uid still holds the same thing
--   * `locked`. A bucket put by used to fail `consume` and the whole action
--     returned without a word — click Fill, nothing happens, no message.
--     Filling a bucket is not spending it, so now it fills, and stays put by.
--
-- and sets `charges` from the def, which fixes something else found on the way
-- past. `give` has never set charges, so a bucket of milk drawn out of a
-- barrel arrived with `charges` null and could not be drunk:
--
--     said: You draw a bucket of milk out of the barrel.
--     the bucket is now milk_bucket, charges null
--     drinking it: It is empty.
--
-- The suite did not catch it because measurement 274 makes its bucket of milk
-- by hand, with the charges written in.
--
-- ## What still may not be done out of a bag
--
-- `eat` and `improve_item` spend through `consume`, which counts only what is
-- loose in your hands. Letting them reach into a bag would offer a job that
-- then quietly did nothing, which is the shape of bug this file exists to fix.
-- They keep the old reach and say so — "Take it out of the bag first." —
-- rather than failing silently, until `consume` learns about bags.

/**
 * A thing you are carrying: loose in your hands, or in a bag that is.
 *
 * Not merely "a row with your uid on it": dropping a bag leaves its contents
 * holding your uid and the bag on the grass, and reaching into that from the
 * far side of the island is not carrying it.
 */
create or replace function carried(p_world uuid, p_uid uuid, p_id bigint) returns item
  language sql stable as $$
  select i.* from item i
  where i.world_id = p_world and i.id = p_id
    and ((i.holder = 'player' and i.holder_uid = p_uid)
      or (i.holder = 'bag' and exists (
            select 1 from item b
            where b.id = i.inside and b.holder = 'player' and b.holder_uid = p_uid)))
$$;

/**
 * One vessel becoming another, in place: an empty bucket becoming a bucket of
 * water and back again. The same row, in the same pocket, with the same
 * number on it — and as many goes in it as the new thing holds.
 */
create or replace function vessel_becomes(p_id bigint, p_def text) returns boolean
  language plpgsql as $$
declare it item;
begin
  if p_def is null then return false; end if;
  select * into it from item where id = p_id for update;
  if not found or it.count <> 1 then return false; end if;
  update item set def = p_def, charges = (select charges from item_def where id = p_def)
    where id = p_id;
  return true;
end $$;

CREATE OR REPLACE FUNCTION public.liquid_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare it item; p placed; v_kind text;
begin
  if p_action in ('fill_bucket', 'fill_skin', 'empty_bucket', 'pour_into_barrel') then
    it := carried(p_world, p_uid, (p_target->>'uid')::bigint);
    if it.id is null then return 'It is gone.'; end if;
  else
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint
      and kind = 'furniture';
    if not found then return 'It is gone.'; end if;
    if not near_piece(p_world, p_uid, p) then return 'Stand next to it.'; end if;
  end if;

  if p_action = 'fill_bucket' then
    if it.def <> 'bucket' then return 'That is not an empty bucket.'; end if;
    if not exists (select 1 from vessels_near(p_world, p_uid) v where placed_litres(v) >= bucket_litres())
       and not near_water(p_world, p_uid) then
      return 'You need water: a shore, a well, or a barrel with something in it.';
    end if;

  elsif p_action = 'fill_skin' then
    if (select charges from item_def where id = it.def) is null then
      return 'That does not hold water.';
    end if;
    if coalesce(it.charges, 0) >= (select charges from item_def where id = it.def) then
      return 'It is already full.';
    end if;
    if not water_near(p_world, p_uid) then
      return 'You need water: a shore, a well, or a barrel of it.';
    end if;

  elsif p_action = 'empty_bucket' then
    if not exists (select 1 from vessel_def where item = it.def) then
      return 'That is not a bucket of anything.';
    end if;

  elsif p_action = 'pour_into_barrel' then
    select liquid into v_kind from vessel_def where item = it.def;
    if v_kind is null then return 'That is not a bucket of anything.'; end if;
    if (barrel_for(p_world, p_uid, v_kind)).id is null then
      return 'There is no barrel beside you with room for '
        || (select name from liquid_def where id = v_kind) || '.';
    end if;

  elsif p_action = 'empty_vessel' then
    if not holds_liquid(p) or is_well(p) then return 'That is not something you tip out.'; end if;
    if placed_litres(p) <= 0 then return 'It is already empty.'; end if;

  elsif p_action = 'drink_from_vessel' then
    if not holds_liquid(p) then return 'There is nothing in that to drink.'; end if;
    if not coalesce((select drinkable from liquid_def where id = placed_liquid(p)), false) then
      return 'You would not want to drink that.';
    end if;
    if placed_litres(p) < 1 then return 'It is dry.'; end if;
    if coalesce((select (stats->>'thirst')::double precision from player
                 where world_id = p_world and uid = p_uid), 1) >= 0.999
       and not coalesce((select brew from liquid_def where id = placed_liquid(p)), false) then
      return 'You are not thirsty.';
    end if;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_liquid(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare it item; p placed; v_kind text; v_from placed; v_full text; v_room double precision;
        v_poured double precision; v_favour text; v_full_msg text; v_thirst double precision;
begin
  if p_action in ('fill_bucket', 'fill_skin', 'empty_bucket', 'pour_into_barrel') then
    it := carried(p_world, p_uid, (p_target->>'uid')::bigint);
    if it.id is null then return; end if;
  else
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
  end if;

  if p_action = 'fill_bucket' then
    -- A barrel beside you first, and the shore only if there is none.
    select * into v_from from vessels_near(p_world, p_uid) v
      where placed_litres(v) >= bucket_litres() limit 1;
    if found then
      v_kind := placed_liquid(v_from);
      if not draw_from(v_from.id, bucket_litres()) then return; end if;
    elsif near_water(p_world, p_uid) then
      v_kind := 'water';
    else
      return;
    end if;
    select item into v_full from vessel_def where liquid = v_kind limit 1;
    if not vessel_becomes(it.id, v_full) then return; end if;
    perform tell(p_world, p_uid, case when v_from.id is not null
      then 'You draw a bucket of ' || (select name from liquid_def where id = v_kind)
           || ' out of the ' || lower(placed_name(v_from)) || '.'
      else 'You dip the bucket full of water.' end, 'event');

  elsif p_action = 'fill_skin' then
    update item set charges = (select charges from item_def where id = it.def) where id = it.id;
    perform tell(p_world, p_uid, 'You fill the '
      || lower((select name from item_def where id = it.def)) || ' with water.', 'event');

  elsif p_action = 'empty_bucket' then
    select empty into v_full from vessel_def where item = it.def;
    if v_full is null then return; end if;
    if not vessel_becomes(it.id, v_full) then return; end if;
    perform tell(p_world, p_uid, 'You tip the '
      || lower((select name from item_def where id = it.def)) || ' out.', 'event');

  elsif p_action = 'pour_into_barrel' then
    select liquid into v_kind from vessel_def where item = it.def;
    v_from := barrel_for(p_world, p_uid, v_kind);
    if v_from.id is null then return; end if;
    v_room := liquid_capacity(v_from) - placed_litres(v_from);
    v_poured := least(bucket_litres(), v_room);
    if v_poured <= 0 then return; end if;
    if not vessel_becomes(it.id, (select empty from vessel_def where item = it.def)) then return; end if;
    update placed set litres = placed_litres(v_from) + v_poured, liquid = v_kind, since = now()
      where id = v_from.id;
    perform tell(p_world, p_uid, 'You pour ' || to_char(v_poured, 'FM990') || ' litres of '
      || (select name from liquid_def where id = v_kind) || ' into the '
      || lower(placed_name(v_from)) || '. '
      || to_char(placed_litres(v_from) + v_poured, 'FM990') || ' of '
      || to_char(liquid_capacity(v_from), 'FM990') || '.', 'event');

  elsif p_action = 'empty_vessel' then
    v_kind := coalesce((select name from liquid_def where id = placed_liquid(p)), 'it');
    update placed set litres = 0, liquid = null, since = now() where id = p.id;
    perform tell(p_world, p_uid, 'You tip the ' || v_kind || ' out of the '
      || lower(placed_name(p)) || '.', 'event');

  elsif p_action = 'drink_from_vessel' then
    if not draw_from(p.id, 1) then return; end if;
    v_thirst := coalesce((select (stats->>'thirst')::double precision from player
                          where world_id = p_world and uid = p_uid), 1);
    update player set stats = jsonb_set(stats, '{thirst}', to_jsonb(least(1, v_thirst + 0.5)))
      where world_id = p_world and uid = p_uid;
    -- A brew straight out of the barrel favours a trade like any other.
    if coalesce((select brew from liquid_def where id = placed_liquid(p)), false) then
      select item into v_full from vessel_def where liquid = placed_liquid(p) limit 1;
      v_favour := grant_boon(p_world, p_uid, v_full, p.ql);
      v_full_msg := nourish(p_world, p_uid, v_full, p.ql);
    end if;
    perform tell(p_world, p_uid, 'You drink your fill from the ' || lower(placed_name(p)) || '.'
      || coalesce(' ' || v_favour, '') || coalesce(' ' || v_full_msg, ''), 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.item_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare v_it item; v_what improvable_def; v_mat improve_material_def; v_miss text;
        v_ceiling double precision; v_made text; v_tx int; v_ty int;
begin
  if p_action = 'drink' then
    v_tx := (p_target->>'x')::int; v_ty := (p_target->>'y')::int;
    if not has_water(p_world, v_tx, v_ty) then return 'There is no water there.'; end if;
    return null;
  end if;

  v_it := carried(p_world, p_uid, nullif(p_target->>'uid', '')::bigint);
  if v_it.id is null then return 'It is gone.'; end if;

  if p_action = 'eat' then
    if coalesce((select food from item_def where id = v_it.def), 0) <= 0 then
      return 'That is not food.';
    end if;
    if v_it.holder = 'bag' then return 'Take it out of the bag first.'; end if;
    if v_it.locked then return 'You have that one put by.'; end if;
    return null;

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
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_item(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_it item; v_what improvable_def; v_mat improve_material_def; v_stock item;
        v_made text; v_ceiling double precision; v_tool_ql double precision;
        v_healed double precision; v_lost double precision; v_skill double precision;
        v_favour text; v_full text; v_name text; v_p player;
begin
  if p_action = 'drink' then
    update player set stats = jsonb_set(stats, '{thirst}', '1') where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You drink the cool water. It is refreshing.', 'event');
    return;
  end if;

  v_it := carried(p_world, p_uid, nullif(p_target->>'uid', '')::bigint);
  if v_it.id is null then return; end if;
  v_name := lower((select coalesce(name, v_it.def) from item_def where id = v_it.def));
  select * into v_p from player where world_id = p_world and uid = p_uid;

  if p_action = 'eat' then
    if not consume(p_world, p_uid, v_it.def, 1, v_it.id) then return; end if;
    update player set stats = jsonb_set(stats, '{hunger}', to_jsonb(least(1,
        coalesce((v_p.stats->>'hunger')::double precision, 1)
        + coalesce((select food from item_def where id = v_it.def), 0) * (0.7 + v_it.ql / 200))))
      where world_id = p_world and uid = p_uid;
    -- A dish favours a trade, and having eaten it you are better at that
    -- trade for a while.
    v_favour := grant_boon(p_world, p_uid, v_it.def, v_it.ql);
    v_full := nourish(p_world, p_uid, v_it.def, v_it.ql);
    perform tell(p_world, p_uid, 'You eat the ' || v_name || '.'
      || coalesce(' ' || v_favour, '') || coalesce(' ' || v_full, ''), 'event');

  elsif p_action = 'drink_skin' then
    update item set charges = coalesce(charges, 1) - 1 where id = v_it.id;
    update player set stats = jsonb_set(stats, '{thirst}', to_jsonb(least(1,
        coalesce((v_p.stats->>'thirst')::double precision, 1)
        + coalesce((select drink from item_def where id = v_it.def), 0))))
      where world_id = p_world and uid = p_uid;
    -- Milk and anything brewed favour a trade the way a cooked dish does.
    v_favour := grant_boon(p_world, p_uid, v_it.def, v_it.ql);
    v_full := nourish(p_world, p_uid, v_it.def, v_it.ql);
    perform tell(p_world, p_uid, 'You take a drink from the ' || v_name || '.'
      || coalesce(' ' || v_favour, '') || coalesce(' ' || v_full, ''), 'event');

  elsif p_action = 'repair_item' then
    -- A second's work: some of the damage comes out, and a little of the
    -- quality with it — a little, not much, so mending a thing is not the end
    -- of it.
    v_skill := skill_of(p_world, p_uid, 'repair');
    v_healed := least(v_it.dmg, 1.2 + v_skill * 0.1);
    v_lost := v_healed * greatest(0.004, 0.03 - v_skill * 0.00026);
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
    if v_stock.id is null or not consume(p_world, p_uid, v_stock.def, 1, v_stock.id) then return; end if;
    v_tool_ql := coalesce((select max(tool_ql(p_world, p_uid, t.tool)) from improve_tool t
                           where t.material = v_mat.id), 0);
    perform skill_raise(p_world, p_uid, v_what.skill, 0.4);
    -- A failed pass marks the piece rather than spoiling it outright. Oak and
    -- the deep metals are stubborn under the file as under the saw.
    if not skill_check(skill_of(p_world, p_uid, v_what.skill),
        12 + v_it.ql / 3 + mat_difficulty(v_it.extra), v_tool_ql) then
      perform damage_item(v_it.id, 3 + random() * 5);
      perform tell(p_world, p_uid, 'You work at the ' || v_name || ' and mark it. (damage '
        || to_char((select dmg from item where id = v_it.id), 'FM990.0') || ')', 'event');
      return;
    end if;
    v_ceiling := least(99.9, improve_ceiling(p_world, p_uid, v_what.skill, v_it.rare));
    update item set ql = greatest(ql, least(v_ceiling,
        ql + improve_step(skill_of(p_world, p_uid, v_what.skill), ql)))
      where id = v_it.id returning * into v_it;
    perform tell(p_world, p_uid, 'The ' || v_name || ' is better than it was. (QL '
      || to_char(v_it.ql, 'FM990.0') || ')', 'event');
  end if;
end $function$;

/*
 * And a way to take one thing out of it.
 *
 * `take_from_store` is the door that exists so that taking a single thing out
 * of a container does not have to be done by the browser on its own — the
 * comment on it says what happened when it was: "it rubber bands from crate to
 * inventory". It knew about crates and about furniture, and a bag is neither,
 * so the bag window went on doing its own moving. That did not show while the
 * browser could not see into a bag at all; it would have started showing the
 * moment it could.
 *
 * A bag is worn rather than stood next to, so there is nothing to walk to and
 * no reach to check. The only question is whether it is on you, which is the
 * question `carried` answers.
 */

CREATE OR REPLACE FUNCTION public.crate_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare v_p player; v_it item; v_c crate; v_pl placed;
        v_tx int; v_ty int; v_sx int; v_sy int; v_want int;
begin
  select * into v_p from player where world_id = p_world and uid = p_uid;

  if p_action = 'place_crate' then
    v_tx := (p_target->>'x')::int; v_ty := (p_target->>'y')::int;
    v_sx := (p_target->>'sx')::int; v_sy := (p_target->>'sy')::int;
    if v_tx is null or v_sx is null or v_sy is null or p_target->>'itemUid' is null then
      return 'Choose a crate and a spot.';
    end if;
    select * into v_it from item where id = (p_target->>'itemUid')::bigint
      and world_id = p_world and holder = 'player' and holder_uid = p_uid;
    if not found or crate_kind_of_item(v_it.def) is null then return 'That is not a crate.'; end if;
    if not passable(p_world, v_tx, v_ty) or has_water(p_world, v_tx, v_ty) then
      return 'Crates need dry, open ground.';
    end if;
    if tile_slope(p_world, v_tx, v_ty) > 20 then return 'The ground is too steep for a crate to stand.'; end if;
    if (crate_at(p_world, v_tx, v_ty, v_sx, v_sy)).id is not null then return 'There is already a crate on that spot.'; end if;
    if is_token(p_world, v_tx, v_ty) then return 'Not on the token.'; end if;
    return null;

  elsif p_action in ('pick_up_crate', 'crate_take_all') then
    v_c := target_crate(p_world, p_target);
    if v_c.id is null then return 'It is gone.'; end if;
    if not crate_yours(p_world, p_uid, v_c.id) then
      return 'The ' || lower(crate_name(v_c)) || ' is not yours.';
    end if;
    if sqrt((crate_centre_x(v_c) - v_p.x) ^ 2 + (crate_centre_y(v_c) - v_p.y) ^ 2) > 2.4 then
      return 'Stand next to the crate.';
    end if;
    if p_action = 'pick_up_crate' then
      return case when crate_units(p_world, v_c.id) > 0 then 'Empty it first.' end;
    end if;
    return case when crate_units(p_world, v_c.id) = 0 then 'The crate is empty.' end;

  elsif p_action = 'store_in_crate' then
    v_c := nearest_crate(p_world, v_p.x, v_p.y);
    if v_c.id is null then return 'Stand next to a crate.'; end if;
    -- Putting your things into somebody else's crate is a way of losing them.
    if not crate_yours(p_world, p_uid, v_c.id) then
      return 'The ' || lower(crate_name(v_c)) || ' is not yours to put anything in.';
    end if;
    select * into v_it from item where id = (p_target->>'uid')::bigint
      and world_id = p_world and holder = 'player' and holder_uid = p_uid;
    if not found then return 'It is gone.'; end if;
    if crate_kind_of_item(v_it.def) is not null then return 'A crate does not go in a crate.'; end if;
    v_want := greatest(1, least(v_it.count, coalesce((p_target->>'count')::int, 1)));
    if crate_units(p_world, v_c.id) + v_want > crate_capacity(v_c) then
      return 'The ' || lower(crate_name(v_c)) || ' is full.';
    end if;
    return null;

  elsif p_action = 'take_from_store' then
    /*
     * Taking one thing out, which the island could not do until now.
     *
     * There has been a way to put a thing in and a way to take *everything*
     * out, and nothing in between — so the browser did the in-between itself,
     * moving the row from one window to the other in its own copy and never
     * telling anybody. On an island the next answer put it back, which is what
     * "it rubber bands from crate to inventory" was.
     */
    select * into v_it from item where id = (p_target->>'uid')::bigint and world_id = p_world;
    if not found or v_it.holder not in ('crate', 'furniture', 'bag') then return 'It is gone.'; end if;
    -- A bag is worn rather than stood next to, so there is nothing to walk to
    -- and the only question is whether it is on you.
    if v_it.holder = 'bag' then
      if (carried(p_world, p_uid, v_it.id)).id is null then return 'It is gone.'; end if;
      return null;
    end if;
    if v_it.holder = 'crate' then
      select * into v_c from crate where world_id = p_world and id = v_it.crate;
      if not found then return 'It is gone.'; end if;
      if sqrt((crate_centre_x(v_c) - v_p.x) ^ 2 + (crate_centre_y(v_c) - v_p.y) ^ 2) > 2.4 then
        return 'Stand next to the crate.';
      end if;
      if not crate_yours(p_world, p_uid, v_c.id) then
        return 'The ' || lower(crate_name(v_c)) || ' is not yours.';
      end if;
    else
      select * into v_pl from placed where id = v_it.placed and world_id = p_world;
      if not found then return 'It is gone.'; end if;
      if greatest(abs(v_pl.cx - v_p.x), abs(v_pl.cy - v_p.y)) > 2.4 then
        return 'Stand next to the ' || lower(placed_name(v_pl)) || '.';
      end if;
    end if;
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_crate(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_p player; v_it item; v_c crate; v_tx int; v_ty int; v_sx int; v_sy int; v_new_id int;
        v_want int; v_names text[] := '{}'; v_r record; v_kind text;
begin
  select * into v_p from player where world_id = p_world and uid = p_uid;

  if p_action = 'place_crate' then
    v_tx := (p_target->>'x')::int; v_ty := (p_target->>'y')::int;
    v_sx := (p_target->>'sx')::int; v_sy := (p_target->>'sy')::int;
    select * into v_it from item where id = (p_target->>'itemUid')::bigint;
    v_kind := crate_kind_of_item(v_it.def);
    if v_kind is null or not consume(p_world, p_uid, v_it.def, 1, v_it.id) then return; end if;
    select coalesce(max(id), 0) + 1 into v_new_id from crate where world_id = p_world;
    insert into crate (world_id, id, kind, x, y, sx, sy, material, made_by)
    values (p_world, v_new_id, v_kind, v_tx, v_ty, v_sx, v_sy, v_it.extra, p_uid);
    select * into v_c from crate where world_id = p_world and id = v_new_id;
    perform tell(p_world, p_uid, 'You set the ' || lower(crate_name(v_c)) || ' down.', 'event');

  elsif p_action = 'pick_up_crate' then
    v_c := target_crate(p_world, p_target);
    if v_c.id is null or crate_units(p_world, v_c.id) > 0 then return; end if;
    delete from crate where world_id = p_world and id = v_c.id;
    perform give(p_world, p_uid, (select item from crate_def where crate_def.kind = v_c.kind), 1, 20, v_c.material);
    perform tell(p_world, p_uid, 'You pick up the '
      || lower((select name from crate_def where crate_def.kind = v_c.kind)) || '.'
      || case when v_c.deed then ' Deed workers will leave their finds by the token until a deed crate stands again.'
              else '' end, 'event');

  elsif p_action = 'crate_take_all' then
    v_c := target_crate(p_world, p_target);
    if v_c.id is null then return; end if;
    for v_r in select * from item where world_id = p_world and holder = 'crate' and crate = v_c.id order by id loop
      v_names := v_names || (case when v_r.count > 1 then v_r.count || ' × ' else '' end
        || lower((select coalesce(name, v_r.def) from item_def where id = v_r.def)));
      update item set holder = 'player', holder_uid = p_uid, crate = null, gx = null, gy = null
        where id = v_r.id;
    end loop;
    if array_length(v_names, 1) is null then return; end if;
    perform tell(p_world, p_uid, 'You take ' || array_to_string(v_names, ', ') || ' from the crate.', 'event');

  elsif p_action = 'store_in_crate' then
    v_c := nearest_crate(p_world, v_p.x, v_p.y);
    select * into v_it from item where id = (p_target->>'uid')::bigint;
    if v_c.id is null or not found then return; end if;
    v_want := greatest(1, least(v_it.count, coalesce((p_target->>'count')::int, 1)));
    if not crate_add(p_world, v_c.id, v_it.def, v_want, v_it.ql, v_it.extra) then
      perform tell(p_world, p_uid, 'The crate is full.', 'error');
      return;
    end if;
    if v_want >= v_it.count then delete from item where id = v_it.id;
    else update item set count = count - v_want where id = v_it.id; end if;
    perform tell(p_world, p_uid, 'You put ' || case when v_want > 1 then v_want || ' × ' else 'the ' end
      || lower((select coalesce(name, v_it.def) from item_def where id = v_it.def))
      || ' in the ' || lower((select name from crate_def where crate_def.kind = v_c.kind)) || '.', 'event');

  elsif p_action = 'take_from_store' then
    select * into v_it from item where id = (p_target->>'uid')::bigint and world_id = p_world;
    if not found or v_it.holder not in ('crate', 'furniture', 'bag') then return; end if;
    v_want := greatest(1, least(v_it.count, coalesce((p_target->>'count')::int, 1)));
    -- `move_part` splits the stack, merges into one you already carry, and
    -- clears whichever of `crate` and `placed` was holding it.
    if move_part(v_it.id, v_want, 'player', p_uid, null, null) is null then return; end if;
    perform tell(p_world, p_uid, 'You take '
      || case when v_want > 1 then v_want || ' × ' else 'the ' end
      || lower((select coalesce(name, v_it.def) from item_def where id = v_it.def))
      || ' out.', 'event');
  end if;
end $function$;

select private.lock_doors();
