/*
 * One bucket off the pile.
 *
 * A bucket does not stack with other buckets, but three of them given at once
 * -- `give(..., 'bucket', 3, ...)`, a trade, a bill paid back -- are written as
 * one row of three, as the browser's pack holds them as one item of three.
 * `vessel_becomes` swapped a row in place and refused any row of more than
 * one, so filling "a bucket" of such a pile did nothing at all: after the
 * water had been drawn out of the well or the barrel for it, which went
 * nowhere. Pouring a bucket of a pile of full ones into a barrel was refused
 * the same way, and said nothing.
 *
 * Now the one that changes comes off the pile, where the pile lies -- in the
 * pack, or in the same bag -- and the rest of the pile stays as it was. A
 * single vessel is still swapped in place, so it keeps its number and its
 * place in the bag, which is what `vessel_becomes` was written for.
 *
 * The suite's bucket at the well was one of these piles. It passed only while
 * some other water bucket happened to be in the pack by then, and failed on a
 * run where none was.
 */
set local lock_timeout = '3s';

create or replace function vessel_becomes(p_id bigint, p_def text) returns boolean
  language plpgsql as $$
declare it item;
begin
  if p_def is null then return false; end if;
  select * into it from item where id = p_id for update;
  if not found or it.count < 1 then return false; end if;
  if it.count = 1 then
    update item set def = p_def, charges = (select charges from item_def where id = p_def)
      where id = p_id;
    return true;
  end if;
  update item set count = count - 1 where id = p_id;
  insert into item (world_id, holder, holder_uid, gx, gy, inside, def, ql, dmg, count, extra, rare,
                    dye, bless, charges, locked, issued, made_at, crate, lit, lit_at, placed, rot_at, maker, piece)
  values (it.world_id, it.holder, it.holder_uid, it.gx, it.gy, it.inside, p_def, it.ql, it.dmg, 1, it.extra, it.rare,
          it.dye, it.bless, (select charges from item_def where id = p_def), it.locked, it.issued, it.made_at,
          it.crate, it.lit, it.lit_at, it.placed, it.rot_at, it.maker, it.piece);
  return true;
end $$;
