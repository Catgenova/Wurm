-- A stack taken out is yours
--
-- Farce, on Discord: five strawberries and five cabbage seeds taken from
-- the crate seemed to just poof, and a seed put in and taken out again
-- went bye bye. Measured, it went into somebody else's pack. `move_part`,
-- which takes a stack or part of one out of a crate, a bag or a piece of
-- furniture, merged it into the first stack of the same thing held by
-- anybody on the island: the kind of holder was checked and the holder
-- was not, so on a shared island a seed taken out of the crate joined the
-- lowest-numbered stack of seeds ashore, whoever's it was. Alone on an
-- island nobody would ever see it. The merge now asks whose stack it is,
-- and a split stack keeps its maker's mark, which the insert had dropped.

CREATE OR REPLACE FUNCTION public.move_part(p_item bigint, p_count integer, p_holder text, p_uid uuid, p_inside bigint, p_placed bigint)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare it item; v_new bigint; v_stack item;
begin
  select * into it from item where id = p_item for update;
  if not found or p_count <= 0 or p_count > it.count then return null; end if;

  -- Somewhere to merge into, if the thing stacks at all.
  if coalesce((select stackable from item_def where id = it.def), false) then
    select * into v_stack from item o
    where o.world_id = it.world_id and o.holder = p_holder and o.id <> it.id
      and o.inside is not distinct from p_inside and o.placed is not distinct from p_placed
      -- Whose stack it is, not only what kind of holder has it: on a shared
      -- island the first stack of seeds ashore is somebody else's.
      and o.holder_uid is not distinct from p_uid
      and o.def = it.def and o.extra is not distinct from it.extra
      and o.rare is not distinct from it.rare and o.dye is not distinct from it.dye
      and o.maker is not distinct from it.maker
    order by o.id limit 1;
  end if;

  if v_stack.id is not null then
    update item set ql = (v_stack.ql * v_stack.count + it.ql * p_count) / (v_stack.count + p_count),
        count = v_stack.count + p_count
      where id = v_stack.id;
    if p_count >= it.count then delete from item where id = it.id;
    else update item set count = it.count - p_count where id = it.id; end if;
    return v_stack.id;
  end if;

  if p_count = it.count then
    update item set holder = p_holder, holder_uid = p_uid, inside = p_inside, placed = p_placed,
        gx = null, gy = null, crate = null
      where id = it.id;
    return it.id;
  end if;
  update item set count = it.count - p_count where id = it.id;
  insert into item (world_id, holder, holder_uid, inside, placed, def, ql, dmg, count,
                    extra, rare, dye, bless, charges, locked, maker)
  values (it.world_id, p_holder, p_uid, p_inside, p_placed, it.def, it.ql, it.dmg, p_count,
          it.extra, it.rare, it.dye, it.bless, it.charges, false, it.maker)
  returning id into v_new;
  return v_new;
end $function$

;

select private.lock_doors();
