-- A worker that can reach the larder
--
-- Asked: "allow working wildermon to eat any eligible food from any container
-- on the deed."
--
-- It could not. `worker_feed` looked in crates and nowhere else:
--
--     from crate k
--     join item i on ... i.holder = 'crate' and i.crate = k.id
--     where k.world_id = p_world and deed_covers(v_deed, k.x, k.y)
--
-- A larder holds a hundred and fifty and is the piece of furniture whose whole
-- purpose is keeping food. A cupboard holds eighty, a chest sixty, shelves a
-- hundred and twenty, a cart a hundred. A worker could stand beside any of
-- them, full of exactly what it eats, and starve.
--
-- The browser has not had this fault: `foodCrate` walks `deedStores`, which is
-- every crate *and* every piece of furniture on the deed that holds things.
-- So this is the island catching up with the rule the other side already had,
-- and the set is defined the same way on both: it holds things, and it is not
-- the trash crate.
--
-- ## Three things in a store that are not lunch
--
-- Widening where a worker may look makes it worth saying what it may not take,
-- and none of these were checked before -- a worker could eat a locked stack
-- out of a crate today.
--
--   * A **locked** thing. Locking is how a person says *this one, not the next
--     thing the game reaches for*. A worker helping itself is the plainest
--     possible breach of that, and the same sentence was written into
--     `stack_key` an hour ago for the same reason.
--   * A thing with a **price** on it, which is stock on a market stall.
--   * A **letter** or goods promised in a **deal**, which belong to whoever is
--     waiting on them.
--
-- The browser checks the first two; it does not model post or deals, and its
-- half of this lives in `mayEat` beside `isBaitFor`.
--
-- Nothing else moves. It is still the plainest thing it eats, lowest quality
-- first, one at a time, with `graze_fill()` of hunger for it -- the good food
-- is still yours.


CREATE OR REPLACE FUNCTION public.worker_feed(p_world uuid, p_id integer)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare c creature; v_deed deed; v_it item;
begin
  select * into c from creature where world_id = p_world and id = p_id;
  if not found or c.mode = 'wild' then return null; end if;
  select * into v_deed from deed_covering(p_world, floor(creature_x(c))::int, floor(creature_y(c))::int)
   limit 1;
  if v_deed.world_id is null then return null; end if;
  /*
   * The plainest thing it eats, out of anything on that land that holds
   * things.
   *
   * Crates only, until now -- so a worker starved standing next to a larder.
   * A larder holds a hundred and fifty and is where anybody would actually
   * keep the food; a cupboard holds eighty, a chest sixty, a cart a hundred.
   * Asked for: "allow working wildermon to eat any eligible food from any
   * container on the deed."
   *
   * Any container means the same set a load gets put away into, which is what
   * `deedStores` is on the browser's side: it holds things and is not the
   * trash crate. The trash crate is left out for the obvious reason, and
   * because the browser has always left it out.
   *
   * And three things in a store are not lunch, whatever is in them. A locked
   * thing, because locking is how a person says *not this one, not the next
   * thing the game reaches for*, and a worker helping itself would be the
   * plainest possible breach of that. A thing with a price on it, which is
   * stock on a stall. And a letter or a parcel under a deal, which belong to
   * whoever is waiting on them. None of the three were checked before, so a
   * worker could eat a locked stack out of a crate; that is fixed here too.
   */
  select i.* into v_it
    from (
      select i.*
        from crate k
        join item i on i.world_id = k.world_id and i.holder = 'crate' and i.crate = k.id
       where k.world_id = p_world and deed_covers(v_deed, k.x, k.y)
      union all
      select i.*
        from placed p
        join furniture_def fd on fd.id = p.sub
        join item i on i.world_id = p.world_id and i.holder = 'furniture' and i.placed = p.id
       where p.world_id = p_world and p.kind = 'furniture'
         and coalesce(fd.capacity, 0) > 0 and coalesce(fd.trash, 0) = 0
         and deed_covers(v_deed, p.x, p.y)) i
   where not i.locked and i.price is null and i.letter is null and i.deal is null
     and exists (select 1 from species_diet sd where sd.species = c.species and sd.item = i.def)
   order by i.ql, i.id
   limit 1;
  if v_it.id is null then return null; end if;
  if v_it.count > 1 then update item set count = count - 1 where id = v_it.id;
  else delete from item where id = v_it.id; end if;
  update creature set hunger = least(1, hunger + graze_fill())
    where world_id = p_world and id = p_id;
  return v_it.def;
end $function$;