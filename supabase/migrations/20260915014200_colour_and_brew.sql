-- Colour, and what a barrel of water becomes if you leave it alone.
--
-- ## A brew is a well running the other way
--
-- A well fills at a rate to a ceiling; a barrel of ale empties a clock down to
-- nought and then stops being a thing that is working and starts being a thing
-- you can draw off. Same settling, same one timestamp, opposite sign — and the
-- `since` it counts from is the one `placed` has carried since the first
-- campfire. A brew needed one column and no machinery.
--
-- ## And a dye is the first thing on this island that is yours
--
-- Everything made here comes out the colour of what it was made from. A dye
-- changes that, and `item.dye` has been in the schema (and in `item_name`)
-- since items were dyeable in the browser and unpaintable here, so the whole
-- of the porting is two actions and a pot.

alter table placed add column if not exists ferment real not null default 0;

/** Seconds of working a brew still has in it, which is a countdown like any other. */
create or replace function ferment_left(p placed) returns double precision language sql stable as $$
  select greatest(0, p.ferment - extract(epoch from (now() - p.since)))
$$;

/** Still working, and not to be drawn off until it has stopped. */
create or replace function is_working(p placed) returns boolean language sql stable as $$
  select ferment_left(p) > 0
$$;

/** Why this brew cannot be set going in this barrel, or null. */
create or replace function brew_reason(p_world uuid, p_uid uuid, p placed, b brew_def) returns text
  language plpgsql stable as $$
declare have int;
begin
  if p.id is null then return 'Stand at a barrel.'; end if;
  if not holds_liquid(p) then return 'That holds no liquid.'; end if;
  if is_working(p) then return 'It is already working. Leave it alone.'; end if;
  if coalesce(placed_liquid(p), '') <> 'water' then
    return 'A brew is started in water. Empty the ' || lower(placed_name(p))
      || ' and fill it from a well.';
  end if;
  if placed_litres(p) < b.litres then
    return 'That takes ' || to_char(b.litres, 'FM990') || ' litres of water; there are '
      || to_char(placed_litres(p), 'FM990') || ' in it.';
  end if;
  have := pack_count(p_world, p_uid, b.input);
  if have < b.count then
    return 'That takes ' || b.count || ' × '
      || lower((select coalesce(name, b.input) from item_def where id = b.input))
      || '; you have ' || have || '.';
  end if;
  return null;
end $$;

/**
 * What will take a dye: anything woven or tanned, and the things made out of
 * them. Metal will not, and neither will a tool you are going to get dirty.
 */
create or replace function takes_dye(p_def text) returns boolean language sql stable as $$
  select case
    when exists (select 1 from armour_def a where a.id = p_def)
      then exists (select 1 from armour_def a join dyeable_class c on c.cls = a.cls where a.id = p_def)
    else exists (select 1 from dyeable_item d where d.id = p_def) end
$$;

/** The dye in the pack that will be used: the best pot of the first colour found. */
create or replace function pick_dye(p_world uuid, p_uid uuid) returns item language sql stable as $$
  select i.* from item i
  where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
    and i.def = 'dye' and exists (select 1 from dye_def d where d.name = i.extra)
  order by i.ql desc, i.id
  limit 1
$$;

select private.lock_doors();
