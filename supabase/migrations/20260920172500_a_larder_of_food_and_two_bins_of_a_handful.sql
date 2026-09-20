/*
 * A larder of food, a bin of seed, a bin of sprouts -- and one field where
 * there were two booleans.
 *
 * Asked for: "change the larder to only allow raw and cooked food and up items
 * hold to 250", and "create a Sprout Bin and Seed Bin, each that can hold
 * 100kg of items".
 *
 * ## The field
 *
 * Until now a store that took one sort of thing was a store with a boolean on
 * it: `furniture_def.raw` for the raw material bin, `furniture_def.crafted`
 * for the craft material bin. Two was already one more than the shape wanted,
 * and this makes five -- food, seed, sprouts -- so five booleans, five
 * clauses in `furniture_refuses` and five branches in `worker_store` would be
 * five places to forget the sixth.
 *
 * So the two columns go and `furniture_def.takes` arrives in their place: one
 * word naming the kind, and `furniture_takes` below holding the question and
 * the sentence for each. A store that takes something new is a row in that
 * case expression and a word in the rulebook; nothing else moves. The browser
 * has the same field and the same table, in `TAKES`.
 *
 * `worker_store` gets the same treatment for free: it ordered bins ahead of
 * everything else by `fd.raw or fd.crafted`, and now asks whether the piece
 * takes one sort of thing at all. A seed bin on the deed is the bin built for
 * seed the same way the raw bin is the bin built for ore, and a worker
 * carrying seed home walks to it without a clause of its own.
 *
 * ## The larder
 *
 * It holds 250 rather than 150, and takes food and drink only -- which is the
 * one thing a larder is. Note what that leaves out: flour, dough and cornmeal
 * are `material`, not `food`, so they go to the craft material bin now. That
 * is the honest reading of "food": a sack of flour is not a meal.
 *
 * ## The two small bins
 *
 * Both are weighed rather than counted, for the same reason the craft bin is.
 * A sprout weighs 0.1 kg and a wheat seed 0.02, so a hundred kilograms is a
 * thousand sprouts or five thousand seeds, and no one count would have been
 * right for both. `heft` is 100 on each and `capacity` is null, which is all
 * `furniture_room` needs to know.
 */

/*
 * The column first, and filled from the two it replaces, so the rulebook that
 * follows finds it already right on an island that has been running.
 */
select private.shut('alter table furniture_def add column if not exists takes text');
update furniture_def set takes = 'raw' where id = 'bulk_bin' and takes is null;
update furniture_def set takes = 'worked' where id = 'craft_bin' and takes is null;
update furniture_def set takes = 'food' where id = 'larder' and takes is null;
update furniture_def set capacity = 250 where id = 'larder' and capacity = 150;

/*
 * The weight of a thing, as the browser holds it.
 *
 * `item_def.weight` is a `real` -- four bytes -- and the browser's is an
 * ordinary JavaScript number, which is eight. Both were written from the same
 * decimal in the rulebook, but they are not the same number afterwards: `0.1`
 * stores as 0.100000001490116 here and 0.100000000000000006 there. Divide a
 * hundred kilograms by each and floor it and you get 999 on this side and 1000
 * on that one -- a bin that offered room for a thousand sprouts taking nine
 * hundred and ninety-nine, and the last one bouncing off a door the browser
 * said was open.
 *
 * Postgres prints a float as the shortest string that reads back as the same
 * value, so the text of that `real` is `0.1`: the decimal it was written from.
 * Read that back as a float8 and it is exactly the double the browser has, and
 * the divide is then the same IEEE operation on the same two numbers.
 *
 * This was already wrong before these two bins, and had simply never been
 * asked: 2500 kg of anything weighing 0.1 counted 24,999 on the island against
 * the browser's 25,000. Every weight the craft bin had been tested on --
 * 0.01, 2, 6 -- happened to come out the same either way.
 */
create or replace function item_kg(p_def text) returns double precision
language sql stable as $fn$
  select weight::text::double precision from item_def where id = p_def
$fn$;

/*
 * And what the piece holds, rounded the way the browser rounds it.
 *
 * The same disagreement one step up. A bin built of a stronger wood holds more
 * than a plain one; the browser rounds that product to a whole kilogram and
 * the island did not, so most of the time a float4 landed near enough to the
 * whole number for nobody to notice, and four woods did not. Measured over
 * every material against a hundred kilograms and against two and a half
 * tonnes, of nails, planks, seed and sprouts:
 *
 *     apple        100 kg  1059 sprouts, where the browser says 1060
 *     maple        100 kg  1049                                 1050
 *     pear         100 kg  1049                                 1050
 *     pomegranate  100 kg  1059                                 1060
 *
 * Rounded on both sides, both hold the same double afterwards, and the divide
 * that follows is the same operation on the same two numbers. Oak, pine and
 * the rest were already right by luck, and stay right.
 *
 * `furniture_capacity` is deliberately left alone. It does not multiply by the
 * wood at all where the browser does, which is not a rounding error but a
 * different rule -- and changing it would change what every chest, cupboard,
 * cart and boat on a live island holds. That is a decision, not a fix.
 */
create or replace function furniture_heft(p placed) returns double precision
language sql stable as $fn$
  select round(coalesce((select heft from furniture_def where id = p.sub), 0)::double precision
              * coalesce((mat_of(p.material)).hold, 1)::double precision)
$fn$;

/* Kilograms standing in it, in those same numbers. */
create or replace function furniture_kg(p placed) returns double precision
language sql stable as $fn$
  select coalesce(sum(d.weight::text::double precision * i.count), 0)
  from item i join item_def d on d.id = i.def
  where i.placed = p.id and i.holder = 'furniture'
$fn$;

/* How many of a thing will go in: by count, or by what the weight leaves. */
create or replace function furniture_room(p placed, p_def text) returns integer
language sql stable as $fn$
  select case when furniture_heft(p) <= 0 then furniture_spare(p)
    else greatest(0, floor((furniture_heft(p) - furniture_kg(p))
      / greatest(coalesce(item_kg(p_def), 1), 0.001)))::int
  end
$fn$;

/* And how big a store it is for that thing: what it holds when empty. */
create or replace function furniture_size(p placed, p_def text) returns integer
language sql stable as $fn$
  select case when furniture_heft(p) <= 0 then furniture_capacity(p)
    else greatest(0, floor(furniture_heft(p)
      / greatest(coalesce(item_kg(p_def), 1), 0.001)))::int
  end
$fn$;

/*
 * What each of the five takes, and what it says to the rest.
 *
 * One function rather than a clause apiece in `furniture_refuses`, because the
 * door is the same door five times over and only the question at it varies.
 * Null means it will go in. The browser says every one of these sentences in
 * exactly these words; see `TAKES` in `src/game/furniture.ts`.
 */
create or replace function furniture_takes(p_takes text, p_def text) returns text
language sql stable as $fn$
  select case p_takes
    when 'raw' then case when item_raw(p_def) then null else
      'A raw material bin takes raw materials — ore, logs, dirt, shards, wool — and nothing a bench has touched.' end
    when 'worked' then case when item_worked(p_def) then null else
      'A craft material bin takes worked materials — planks, nails, ribbons, hinges — and nothing that has not been through a bench.' end
    when 'food' then case when (select d.category from item_def d where d.id = p_def) = 'food' then null else
      'A larder takes food — raw, cooked, and what is drunk — and nothing else.' end
    when 'seed' then case when exists (select 1 from crop_def c where c.seed = p_def) then null else
      'A seed bin takes seeds and nothing else.' end
    when 'sprout' then case when p_def = 'sprout' then null else
      'A sprout bin takes sprouts and nothing else.' end
    end
$fn$;

/*
 * Why a piece will not take something, or null if it will. A barrel takes no
 * solids, a hive is the swarm's, and a restricted store asks the one question
 * it was built around.
 */
create or replace function furniture_refuses(p placed, p_def text) returns text
language sql stable as $fn$
  select case
    when holds_liquid(p) then v.it || ' holds liquid and nothing else.'
    when d.hive is not null then v.it || ' is the swarm''s, not yours. Take what is in it; do not put anything back.'
    when not furniture_holds(p) then v.it || ' does not hold things.'
    else furniture_takes(d.takes, p_def)
    end
  from furniture_def d
  cross join lateral (select case when lower(d.name) ~ '^[aeiou]' then 'An ' else 'A ' end
                        || lower(d.name) as it) v
  where d.id = p.sub
$fn$;

CREATE OR REPLACE FUNCTION public.worker_store(p_world uuid, c creature, p_def text, p_count integer)
 RETURNS TABLE(kind text, id bigint, cx double precision, cy double precision)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_site record; v_own boolean;
begin
  /*
   * A purpose-built bin takes the load first, when the load is what it was
   * built for.
   *
   * Asked for: "molas should prioritize storing into raw material bins." A
   * bin holds four hundred where a crate holds a fraction of that, and it
   * takes nothing a bench has touched -- so it is the one store built for
   * exactly what a worker brings home by the cartload, and it was competing
   * for the job on distance alone. Worse, a worker that filled the deed crate
   * with ore left nowhere for the things only a crate will hold.
   *
   * Only ahead of the ordering that was already here: nearest bin first, and
   * failing a bin the same deed crate and the same nearest store as before.
   *
   * The load is never tested against the bin here. Anything in this list has
   * already been through `furniture_refuses`, so a bin in it is the bin built
   * for exactly this thing -- which is how the craft material bin, and then
   * the larder, the seed bin and the sprout bin, joined the rule without a
   * clause each: `fd.takes is not null` is the whole of it.
   */
  select * into v_site from work_site(p_world, c);
  if v_site.x is null then return; end if;
  -- Beside the post first, when it is working off one.
  if v_site.post is not null then
    return query
    with room as (
      select 'crate'::text as kind, cr.id::bigint as id, crate_centre_x(cr) as cx, crate_centre_y(cr) as cy,
             false as bin
      from crate cr
      where cr.world_id = p_world
        and abs(cr.x + 0.5 - v_site.x) <= v_site.radius and abs(cr.y + 0.5 - v_site.y) <= v_site.radius
        and crate_units(p_world, cr.id) + p_count <= crate_capacity(cr)
      union all
      select 'furniture', p.id, p.x + 0.5, p.y + 0.5, fd.takes is not null
      from placed p join furniture_def fd on fd.id = p.sub
      where p.world_id = p_world and p.kind = 'furniture'
        and abs(p.x + 0.5 - v_site.x) <= v_site.radius and abs(p.y + 0.5 - v_site.y) <= v_site.radius
        and furniture_holds(p) and furniture_refuses(p, p_def) is null
        and p_count <= furniture_room(p, p_def))
    select r.kind, r.id, r.cx, r.cy from room r
    order by r.bin desc, (r.cx - creature_x(c)) ^ 2 + (r.cy - creature_y(c)) ^ 2
    limit 1;
    if found then return; end if;
  end if;
  -- Then home: the settlement's own crate while it has room, and the nearest
  -- thing on the deed that will take it after.
  return query
  with mine as (select * from my_deed(p_world, c.keeper) md where md.world_id is not null),
  room as (
    select 'crate'::text as kind, cr.id::bigint as id, crate_centre_x(cr) as cx, crate_centre_y(cr) as cy,
           cr.deed as own, false as bin
    from crate cr, mine d
    where cr.world_id = p_world
      and abs(cr.x - d.x) <= d.radius and abs(cr.y - d.y) <= d.radius
      and crate_units(p_world, cr.id) + p_count <= crate_capacity(cr)
    union all
    select 'furniture', p.id, p.x + 0.5, p.y + 0.5, false, fd.takes is not null
    from placed p join furniture_def fd on fd.id = p.sub, mine d
    where p.world_id = p_world and p.kind = 'furniture'
      and abs(p.x - d.x) <= d.radius and abs(p.y - d.y) <= d.radius
      and furniture_holds(p) and furniture_refuses(p, p_def) is null
      and p_count <= furniture_room(p, p_def))
  select r.kind, r.id, r.cx, r.cy from room r
  order by r.bin desc, r.own desc,
           (r.cx - creature_x(c)) ^ 2 + (r.cy - creature_y(c)) ^ 2
  limit 1;
end $function$;

/*
 * And the two columns go, now that nothing reads them.
 *
 * Through `private.shut`, which is what every genuine piece of DDL on this
 * island goes through: an `alter table` wants ACCESS EXCLUSIVE, and the moment
 * it starts waiting for one every query behind it waits too. Six goes with a
 * bounded timeout and a back-off between them, and a failed deploy rather than
 * a stopped island if it never gets in.
 */
select private.shut('alter table furniture_def drop column if exists raw');
select private.shut('alter table furniture_def drop column if exists crafted');

select private.lock_doors();
