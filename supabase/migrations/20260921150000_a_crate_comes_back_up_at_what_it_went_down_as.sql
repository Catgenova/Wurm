-- A crate comes back up at what it went down as
--
-- Asked for: *"fix the crate ql that always comes back as 20."*
--
-- It was not that a crate's quality was being lost. There was no crate quality
-- to lose. `crate` has carried a kind, a place, a wood, a name and a padlock
-- since the day it was written, and never a `ql` -- so `pick_up_crate` had
-- nothing on the row to hand back and wrote the number 20 into the item
-- instead:
--
--     perform give(p_world, p_uid, (select item from crate_def ...), 1, 20, ...)
--
-- A crate you had worked up to eighty was a crate you could only ever lose.
-- Set it down and pick it up and it was a beginner's crate again, and the
-- quality you had put into it went nowhere at all. The browser did exactly the
-- same, with the same literal, in `pick_up_crate`.
--
-- One column, defaulting to 20, which is what every crate standing on a live
-- island has in fact been. The settlement's own crate is inserted without one
-- and takes that default, which is right: it is issued, not made.
--
-- `crates_near` hands the browser `to_jsonb(c)` less two names, so the column
-- crosses for nothing, and the store window puts it in the title beside the
-- quality it already shows for a bag and for a piece of furniture.

alter table crate add column if not exists ql real not null default 20;

CREATE OR REPLACE FUNCTION public.perform_crate(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_p player; v_it item; v_c crate; v_tx int; v_ty int; v_sx int; v_sy int; v_new_id int;
        v_want int; v_fit int; v_names text[] := '{}'; v_r record; v_kind text;
begin
  select * into v_p from player where world_id = p_world and uid = p_uid;

  if p_action = 'place_crate' then
    v_tx := (p_target->>'x')::int; v_ty := (p_target->>'y')::int;
    v_sx := (p_target->>'sx')::int; v_sy := (p_target->>'sy')::int;
    select * into v_it from item where id = target_item(p_target);
    v_kind := crate_kind_of_item(v_it.def);
    if v_kind is null or not consume(p_world, p_uid, v_it.def, 1, v_it.id) then return; end if;
    select coalesce(max(id), 0) + 1 into v_new_id from crate where world_id = p_world;
    -- The wood was already coming across; the rarity was not, so a rare crate
    -- stopped being rare the moment it stood on the ground -- and a rare crate
    -- is the one that holds more.
    insert into crate (world_id, id, kind, x, y, sx, sy, material, made_by, rare, ql)
    values (p_world, v_new_id, v_kind, v_tx, v_ty, v_sx, v_sy, v_it.extra, p_uid, v_it.rare, v_it.ql);
    select * into v_c from crate where world_id = p_world and id = v_new_id;
    perform journal_note(p_world, p_uid, 'crate');
    perform tell(p_world, p_uid, 'You set the ' || lower(crate_name(v_c)) || ' down.', 'event');

  elsif p_action = 'pick_up_crate' then
    v_c := target_crate(p_world, p_target);
    if v_c.id is null or crate_units(p_world, v_c.id) > 0 then return; end if;
    delete from crate where world_id = p_world and id = v_c.id;
    perform give(p_world, p_uid, (select item from crate_def where crate_def.kind = v_c.kind), 1, v_c.ql, v_c.material, v_c.rare);
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
    -- And onto the piles already in the pack. Emptying a crate is the loudest
    -- of these: a worker fills it a load at a time, so a crate of seeds is a
    -- dozen stacks, and taking them all used to put a dozen stacks in the pack.
    perform pack_fold(p_world, p_uid);
    if array_length(v_names, 1) is null then return; end if;
    perform tell(p_world, p_uid, 'You take ' || array_to_string(v_names, ', ') || ' from the crate.', 'event');

  elsif p_action = 'store_in_crate' then
    v_c := named_crate(p_world, v_p.x, v_p.y, p_target);
    if v_c.id is null then v_c := nearest_crate(p_world, v_p.x, v_p.y); end if;
    select * into v_it from item where id = target_item(p_target);
    if v_c.id is null or not found then return; end if;
    v_want := greatest(1, least(v_it.count, coalesce((p_target->>'count')::int, 1)));
    if coalesce((select stackable from item_def where id = v_it.def), false) then
      -- Stackables merge into the crate's own stack of them, a part at a time,
      -- and as far as there is room: what is over stays in the pack.
      v_fit := least(v_want, crate_spare(p_world, v_c));
      if v_fit <= 0 or not crate_add(p_world, v_c.id, v_it.def, v_fit, v_it.ql, v_it.extra, v_it.piece) then
        perform tell(p_world, p_uid, 'The ' || lower(crate_name(v_c)) || ' is full.', 'error');
        return;
      end if;
      if v_fit >= v_it.count then delete from item where id = v_it.id;
      else update item set count = count - v_fit where id = v_it.id; end if;
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
      v_fit := v_it.count;
    end if;
    perform tell(p_world, p_uid,
      stored_line(v_fit, made_name(v_it.def, v_it.piece), crate_name(v_c), v_want - v_fit), 'event');

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
end $function$
;

select private.lock_doors();
