-- The store you aimed at is the store it goes in.
--
-- Reported, with a crate rack on the screen and eight plank crates standing on
-- it: "container inventories need to update visually live on the browser. they
-- show as empty when transferring in items. also on the crate rack, trying to
-- place any items in any of the pine crates gives an error that the maple
-- crate is full."
--
-- One cause under both. Putting a thing into a container has never said which
-- container: `store_in_crate` took `nearest_crate` and `store_in_furniture`
-- took `nearest_store`, and the browser did the same, so the ask meant "put
-- this in whatever is closest" however carefully you had opened one particular
-- crate and dragged the thing into its window. A crate on its own is its own
-- nearest and nobody ever noticed. A rack stands eight of them on one tile:
-- the nearest of the eight was the maple, every put on that rack went into the
-- maple, the pine crate you were looking at stayed empty — which is the window
-- "not updating" — and once the maple was full every put was refused in the
-- maple's name, which is the second half word for word.
--
-- So the ask carries the store. `into` on the target is a crate id for
-- `store_in_crate` and a placed id for `store_in_furniture`; the browser's
-- crate window puts its own id in it, and a menu entry that names no store
-- still means the nearest, which is what "Put in crate" on a thing in your
-- pack has always meant. A named store answers for itself when it is full,
-- rather than quietly handing the load to its neighbour.

/**
 * The crate an ask names, when it names one within arm's reach.
 *
 * Reach is part of it rather than a check afterwards: a crate you have walked
 * away from is not the crate you are putting anything in, and the browser
 * reads the same rule the same way.
 */
create or replace function named_crate(p_world uuid, p_x double precision, p_y double precision,
                                       p_target jsonb) returns crate
  language sql stable as $fn$
  select c.* from crate c
  where c.world_id = p_world and c.id = (p_target->>'into')::int
    and sqrt((crate_centre_x(c) - p_x) ^ 2 + (crate_centre_y(c) - p_y) ^ 2) <= 2.4
$fn$;

/**
 * And the piece of furniture an ask names, on the same terms. Anything that
 * holds nothing is not a store, so naming a chair puts nothing in the chair.
 */
create or replace function named_store(p_world uuid, p_uid uuid, p_target jsonb) returns placed
  language sql stable as $fn$
  select p.* from placed p
  where p.world_id = p_world and p.kind = 'furniture' and p.id = (p_target->>'into')::bigint
    and near_piece(p_world, p_uid, p, 2.6) and furniture_capacity(p) > 0
$fn$;

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
    if v_tx is null or v_sx is null or v_sy is null or target_item(p_target) is null then
      return 'Choose a crate and a spot.';
    end if;
    select * into v_it from item where id = target_item(p_target)
      and world_id = p_world and holder = 'player' and holder_uid = p_uid;
    if not found or crate_kind_of_item(v_it.def) is null then return 'That is not a crate.'; end if;
    /*
     * A rack's deck is a crate spot, and the ground under it is the rack's
     * business rather than the crate's: whoever set the rack there already
     * answered for the footing. So the ground rules are asked on bare earth
     * and skipped on a deck, which is the only difference between the two — a
     * crate on a rack is an ordinary crate at an ordinary subtile, with its own
     * contents, its own name and its own deed flag.
     */
    if (rack_at(p_world, v_tx, v_ty, v_sx, v_sy)).id is null then
      if not passable(p_world, v_tx, v_ty) or has_water(p_world, v_tx, v_ty) then
        return 'Crates need dry, open ground.';
      end if;
      if tile_slope(p_world, v_tx, v_ty) > 20 then return 'The ground is too steep for a crate to stand.'; end if;
    elsif crate_kind_of_item(v_it.def) <> 'plank' then
      return 'A ' || lower((select name from item_def where id = v_it.def))
        || ' will not sit on the runners. The rack takes plank crates.';
    end if;
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
    -- The crate the ask names, when it names one you can reach; the nearest
    -- when it names none, which is what an item's own menu means by it.
    v_c := named_crate(p_world, v_p.x, v_p.y, p_target);
    if v_c.id is null then v_c := nearest_crate(p_world, v_p.x, v_p.y); end if;
    if v_c.id is null then return 'Stand next to a crate.'; end if;
    -- Putting your things into somebody else's crate is a way of losing them.
    if not crate_yours(p_world, p_uid, v_c.id) then
      return 'The ' || lower(crate_name(v_c)) || ' is not yours to put anything in.';
    end if;
    select * into v_it from item where id = target_item(p_target)
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
    select * into v_it from item where id = target_item(p_target) and world_id = p_world;
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
    select * into v_it from item where id = target_item(p_target);
    v_kind := crate_kind_of_item(v_it.def);
    if v_kind is null or not consume(p_world, p_uid, v_it.def, 1, v_it.id) then return; end if;
    select coalesce(max(id), 0) + 1 into v_new_id from crate where world_id = p_world;
    insert into crate (world_id, id, kind, x, y, sx, sy, material, made_by)
    values (p_world, v_new_id, v_kind, v_tx, v_ty, v_sx, v_sy, v_it.extra, p_uid);
    select * into v_c from crate where world_id = p_world and id = v_new_id;
    perform journal_note(p_world, p_uid, 'crate');
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
        || made_name(v_r.def, v_r.piece));
      update item set holder = 'player', holder_uid = p_uid, crate = null, gx = null, gy = null
        where id = v_r.id;
    end loop;
    if array_length(v_names, 1) is null then return; end if;
    perform tell(p_world, p_uid, 'You take ' || array_to_string(v_names, ', ') || ' from the crate.', 'event');

  elsif p_action = 'store_in_crate' then
    v_c := named_crate(p_world, v_p.x, v_p.y, p_target);
    if v_c.id is null then v_c := nearest_crate(p_world, v_p.x, v_p.y); end if;
    select * into v_it from item where id = target_item(p_target);
    if v_c.id is null or not found then return; end if;
    v_want := greatest(1, least(v_it.count, coalesce((p_target->>'count')::int, 1)));
    if coalesce((select stackable from item_def where id = v_it.def), false) then
      -- Stackables merge into the crate's own stack of them, a part at a time.
      if not crate_add(p_world, v_c.id, v_it.def, v_want, v_it.ql, v_it.extra, v_it.piece) then
        perform tell(p_world, p_uid, 'The ' || lower(crate_name(v_c)) || ' is full.', 'error');
        return;
      end if;
      if v_want >= v_it.count then delete from item where id = v_it.id;
      else update item set count = count - v_want where id = v_it.id; end if;
    else
      -- Anything else is the same row moved into the crate, so a bag keeps
      -- what is in it: the contents belong to the bag, wherever the bag is.
      -- The row used to be copied and the original deleted, and the deletion
      -- took the bag's contents with it.
      if crate_units(p_world, v_c.id) + v_it.count > crate_capacity(v_c) then
        perform tell(p_world, p_uid, 'The ' || lower(crate_name(v_c)) || ' is full.', 'error');
        return;
      end if;
      update item set holder = 'crate', holder_uid = null, crate = v_c.id, gx = v_c.x, gy = v_c.y, inside = null, placed = null
        where id = v_it.id;
    end if;
    perform tell(p_world, p_uid, 'You put ' || case when v_want > 1 then v_want || ' × ' else 'the ' end
      || made_name(v_it.def, v_it.piece)
      || ' in the ' || lower(crate_name(v_c)) || '.', 'event');

  elsif p_action = 'take_from_store' then
    select * into v_it from item where id = target_item(p_target) and world_id = p_world;
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

CREATE OR REPLACE FUNCTION public.holding_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare it item; p placed; v_bag item; v_want int; v_why text; v_other placed;
begin
  if p_action in ('furniture_take_all') then
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint
      and kind = 'furniture';
    if not found then return 'It is gone.'; end if;
    if not near_piece(p_world, p_uid, p) then return 'Stand next to it.'; end if;
    if furniture_units(p) = 0 then return 'It is empty.'; end if;
    return null;
  end if;

  select * into it from item where world_id = p_world and id = target_item(p_target)
    and holder = 'player' and holder_uid = p_uid;
  if not found then return 'It is gone.'; end if;
  v_want := greatest(1, least(coalesce((p_target->>'count')::int, 1), it.count));

  if p_action = 'stow_item' then
    if is_bag(it.def) then return 'One bag will not go inside another.'; end if;
    if (first_bag(p_world, p_uid, it.def, v_want)).id is null then
      return 'There is no bag with room for it.';
    end if;

  elsif p_action = 'empty_bag' then
    if not is_bag(it.def) then return 'That does not hold things.'; end if;
    if bag_units(it.id) = 0 then return 'There is nothing in it.'; end if;

  elsif p_action = 'store_in_furniture' then
    /*
     * A piece the ask names answers for itself, full or not: dragging a plank
     * into an open chest that has no room in it should say that the chest is
     * full, not put the plank in the barrel behind you.
     */
    p := named_store(p_world, p_uid, p_target);
    if p.id is not null then
      v_why := furniture_refuses(p, it.def);
      if v_why is not null then return v_why; end if;
      if furniture_units(p) + v_want > furniture_capacity(p) then
        return 'The ' || lower(placed_name(p)) || ' is full.';
      end if;
      return null;
    end if;
    p := nearest_store(p_world, p_uid, it.def, v_want);
    if p.id is null then
      -- Say why the thing beside you will not take it, rather than that
      -- nothing will: standing at a barrel with a plank, "a barrel holds
      -- liquid and nothing else" is the answer somebody wanted.
      for v_other in select o.* from placed o
        where o.world_id = p_world and o.kind = 'furniture' and near_piece(p_world, p_uid, o, 2.6)
        order by furniture_capacity(o) desc, o.id
      loop
        v_why := furniture_refuses(v_other, it.def);
        if v_why is not null then return v_why; end if;
        if furniture_units(v_other) + v_want > furniture_capacity(v_other) then
          return 'The ' || lower(placed_name(v_other)) || ' is full.';
        end if;
      end loop;
      return 'Stand next to something that will take it.';
    end if;

  elsif p_action = 'throw_away' then
    p := trash_near(p_world, p_uid);
    if p.id is null then return 'There is no trash crate beside you.'; end if;
    if furniture_units(p) + v_want > furniture_capacity(p) then
      return 'The trash crate is full. Wait for it to rot down.';
    end if;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_holding(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare it item; p placed; v_bag item; v_want int; v_moved bigint; v_names text; v_n int;
begin
  if p_action = 'furniture_take_all' then
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    select string_agg(case when q.count > 1 then q.count || ' × ' || lower(item_name(q))
                           else lower(item_name(q)) end, ', ' order by q.id), count(*)
      into v_names, v_n
      from item q where q.placed = p.id and q.holder = 'furniture';
    if v_n = 0 then return; end if;
    update item set holder = 'player', holder_uid = p_uid, placed = null
      where placed = p.id and holder = 'furniture';
    perform tell(p_world, p_uid, 'You take ' || v_names || ' out of the '
      || lower(placed_name(p)) || '.', 'event');
    return;
  end if;

  select * into it from item where world_id = p_world and id = target_item(p_target)
    and holder = 'player' and holder_uid = p_uid;
  if not found then return; end if;
  v_want := greatest(1, least(coalesce((p_target->>'count')::int, 1), it.count));

  if p_action = 'stow_item' then
    v_bag := first_bag(p_world, p_uid, it.def, v_want);
    if v_bag.id is null then return; end if;
    v_moved := move_part(it.id, v_want, 'bag', p_uid, v_bag.id, null);
    if v_moved is null then return; end if;
    perform tell(p_world, p_uid, 'You put '
      || case when v_want > 1 then v_want || ' × ' else '' end || lower(item_name(it))
      || ' in the ' || lower((select name from item_def where id = v_bag.def)) || '.', 'event');

  elsif p_action = 'empty_bag' then
    select count(*) into v_n from item where inside = it.id and holder = 'bag';
    -- Back through `move_part` rather than a bare update, so what comes out
    -- merges into the stack it left rather than sitting beside it.
    for v_bag in select * from item where inside = it.id and holder = 'bag' order by id loop
      perform move_part(v_bag.id, v_bag.count, 'player', p_uid, null, null);
    end loop;
    perform tell(p_world, p_uid, 'You turn the '
      || lower((select name from item_def where id = it.def)) || ' out: ' || v_n
      || case when v_n = 1 then ' thing' else ' things' end || ' back in your pack.', 'event');

  elsif p_action = 'store_in_furniture' then
    p := named_store(p_world, p_uid, p_target);
    if p.id is null then p := nearest_store(p_world, p_uid, it.def, v_want); end if;
    if p.id is null then return; end if;
    v_moved := move_part(it.id, v_want, 'furniture', null, null, p.id);
    if v_moved is null then return; end if;
    perform tell(p_world, p_uid, 'You put '
      || case when v_want > 1 then v_want || ' × ' else 'the ' end || lower(item_name(it))
      || ' in the ' || lower(placed_name(p)) || '.', 'event');

  elsif p_action = 'throw_away' then
    p := trash_near(p_world, p_uid);
    if p.id is null then return; end if;
    v_moved := move_part(it.id, v_want, 'furniture', null, null, p.id);
    if v_moved is null then return; end if;
    perform tell(p_world, p_uid, 'You throw '
      || case when v_want > 1 then v_want || ' × ' else 'the ' end || lower(item_name(it))
      || ' in the trash crate. It will not last long in there.', 'event');
  end if;
end $function$;

select private.lock_doors();
