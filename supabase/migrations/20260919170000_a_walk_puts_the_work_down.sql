-- A walk puts the work down, and a piece can be asked for a quality
--
-- Two things the hands wanted, and both of them are about asking for work in
-- a unit a person actually thinks in.
--
-- **A walk holds the queue.** Walking anywhere threw the whole list away:
-- `moveTo` cancelled, `rpc_cancel` emptied `act_queue`, and a builder with
-- four walls lined up who stepped three tiles to the woodpile came back to an
-- empty head and four right-clicks to do again. Nothing warned them and
-- nothing could get it back. `rpc_hold` is `rpc_cancel` with the one
-- difference that matters: whatever was in hand goes back to the *front* of
-- the queue with however many goes it had left, and the rest of the queue
-- stays where it is. It is the same move `fight_back` has always made when
-- something bites you mid-job, which is the proof that the shape is right —
-- being interrupted has never meant forgetting, and walking should not
-- either. Nothing starts itself again; the browser offers to take them up.
--
-- **A piece can be asked for a quality.** Improving is the deepest time sink
-- on this island and the only way to ask for it in bulk was a count of
-- passes. That is the wrong unit and always was: what a pass is worth falls
-- away as the piece gets better, so forty to forty-one is one pass and ninety
-- to ninety-one is a dozen, and any number you name is either short or
-- wasted. A target may now carry `upto`, and a piece already at or above it
-- is refused — which is the whole feature, because a repeating job asks its
-- own refusal before every go and stops the moment it is refused. Nothing
-- about what a pass does has changed on either side.

/**
 * Put the work down without forgetting what is lined up behind it.
 *
 * `rpc_cancel` is giving up: it empties the queue, which is what Esc means.
 * This is a pause, which is what walking somewhere means.
 */
create or replace function rpc_hold(p_world uuid) returns jsonb
  language plpgsql security definer set search_path = public as $fn$
declare me uuid := auth.uid(); p player; had text;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  -- What is due is done. Holding is for what is still in your hands.
  perform settle(p_world, me);
  select * into p from player where world_id = p_world and uid = me for update;
  if not found then return jsonb_build_object('held', false, 'waiting', 0); end if;
  had := p.act;
  if had is null and coalesce(jsonb_array_length(p.act_queue), 0) = 0 then
    return jsonb_build_object('held', false, 'waiting', 0);
  end if;
  update player set
      -- The same move `fight_back` makes: to the front of the line, with what
      -- was left of it, to be picked up again after.
      act_queue = case when p.act is null then p.act_queue
                       else jsonb_build_array(jsonb_build_object('action', p.act, 'target', p.act_target,
                                                                 'goes', greatest(1, coalesce(p.act_left, 1)))) || p.act_queue end,
      act = null, act_target = null, act_started = null, act_ends = null,
      act_left = null, act_goes = null, seen_at = now()
    where world_id = p_world and uid = me
    returning coalesce(jsonb_array_length(act_queue), 0) into p.act_left;
  return jsonb_build_object('held', had is not null, 'was', had, 'waiting', p.act_left);
end $fn$;

CREATE OR REPLACE FUNCTION public.item_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $fn$
declare v_it item; v_what improvable_def; v_mat improve_material_def; v_miss text;
        v_ceiling double precision; v_made text; v_tx int; v_ty int;
begin
  if p_action = 'drink' then
    v_tx := (p_target->>'x')::int; v_ty := (p_target->>'y')::int;
    if not has_water(p_world, v_tx, v_ty) then return 'There is no water there.'; end if;
    return null;
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
    -- A quality to stop at, when one was asked for. This refusal is the whole
    -- of "take it to sixty": a repeating job asks before every go and stops
    -- the moment it is told no.
    if (p_target ? 'upto') and v_it.ql >= (p_target->>'upto')::numeric then
      return 'The ' || lower(item_name(v_it)) || ' is at QL '
        || to_char(v_it.ql, 'FM990.0') || ', which is what you asked for.';
    end if;
    return null;
  end if;
  return null;
end $fn$;

select private.lock_doors();
