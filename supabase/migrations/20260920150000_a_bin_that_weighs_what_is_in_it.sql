/*
 * A bin that weighs what is in it rather than counting it.
 *
 * The raw material bin solved half the problem: a cartload of ore has
 * somewhere to go. What a smith and a carpenter turn out all day had nowhere.
 * Nails, ribbons, hinges, planks, lumps, bricks -- they fill a chest in an
 * afternoon, because a chest counts things and counting is the wrong unit for
 * them. Twelve hundred nails and twelve hundred planks are the same number and
 * not remotely the same load.
 *
 * So the craft material bin has no count limit at all. `furniture_def.heft` is
 * two and a half tonnes of it and `capacity` is null, which is a quarter of a
 * million nails or twelve hundred planks. The bill of materials is the raw
 * bin's, to the nail.
 *
 * ## One question instead of two
 *
 * Every caller used to ask `furniture_units(p) + n <= furniture_capacity(p)`,
 * and every one of them would have said no to a bin whose limit is weight. So
 * the question is asked once now, by `furniture_room(p, p_def)`, and it takes
 * the thing as well as the piece -- because once weight is the limit, how much
 * room there is depends on what you are putting in.
 *
 * `furniture_capacity` and `furniture_spare` are untouched and still mean a
 * count. They are what the readouts want; `furniture_room` is what a put
 * wants.
 */

create or replace function furniture_heft(p placed) returns double precision
language sql stable as $fn$
  select coalesce((select heft from furniture_def where id = p.sub), 0)
       * coalesce((mat_of(p.material)).hold, 1)
$fn$;

/*
 * A material a bench has touched, beside `item_raw`, which is what it is the
 * complement of. The two of them partition the material category between them,
 * which is what makes the pair of bins a partition rather than two overlapping
 * boxes -- and the browser has the same predicate under the same name.
 */
create or replace function item_worked(p_def text) returns boolean
language sql stable as $fn$
  select coalesce(category = 'material' and not coalesce(raw, false), false)
  from item_def where id = p_def
$fn$;

/* Kilograms standing in it, which is the only thing a heft bin counts. */
create or replace function furniture_kg(p placed) returns double precision
language sql stable as $fn$
  select coalesce(sum(d.weight * i.count), 0)
  from item i join item_def d on d.id = i.def
  where i.placed = p.id and i.holder = 'furniture'
$fn$;

/* Whether it holds things at all, whichever way it is measured. */
create or replace function furniture_holds(p placed) returns boolean
language sql stable as $fn$
  select furniture_capacity(p) > 0 or furniture_heft(p) > 0
$fn$;

/*
 * How many of a thing will go in: by count, or by what the weight leaves.
 *
 * Nothing on this island weighs nothing -- the lightest thing there is weighs
 * five grammes -- but a divide is a divide, so the weight is floored before it
 * is divided by.
 */
create or replace function furniture_room(p placed, p_def text) returns integer
language sql stable as $fn$
  select case when furniture_heft(p) <= 0 then furniture_spare(p)
    else greatest(0, floor((furniture_heft(p) - furniture_kg(p))
      / greatest(coalesce((select weight from item_def where id = p_def), 1), 0.001)))::int
  end
$fn$;

/*
 * How big a store a piece is for a given thing: what it holds when empty.
 *
 * The straight generalisation of `furniture_capacity`, and what two stores
 * standing beside each other are ranked by. A counting piece is ranked on
 * exactly the number it always was -- which is the point: the ordering of
 * every store that was here before this is bit for bit what it was, and a bin
 * measured in kilograms joins the ranking instead of sorting last on a
 * capacity of nought.
 */
create or replace function furniture_size(p placed, p_def text) returns integer
language sql stable as $fn$
  select case when furniture_heft(p) <= 0 then furniture_capacity(p)
    else greatest(0, floor(furniture_heft(p)
      / greatest(coalesce((select weight from item_def where id = p_def), 1), 0.001)))::int
  end
$fn$;

/*
 * The two bins, and what each says to what the other takes.
 *
 * They partition the material category between them: `raw` is what came out
 * of the ground with no bench between, `crafted` is the rest, and nothing that
 * is not a material goes in either.
 */
create or replace function furniture_refuses(p placed, p_def text) returns text
language sql stable as $fn$
  select case
    when holds_liquid(p) then v.it || ' holds liquid and nothing else.'
    when d.hive is not null then v.it || ' is the swarm''s, not yours. Take what is in it; do not put anything back.'
    when not furniture_holds(p) then v.it || ' does not hold things.'
    when d.raw and not item_raw(p_def) then
      'A raw material bin takes raw materials — ore, logs, dirt, shards, wool — and nothing a bench has touched.'
    when d.crafted and not item_worked(p_def) then
      'A craft material bin takes worked materials — planks, nails, ribbons, hinges — and nothing that has not been through a bench.'
    end
  from furniture_def d
  cross join lateral (select case when lower(d.name) ~ '^[aeiou]' then 'An ' else 'A ' end
                        || lower(d.name) as it) v
  where d.id = p.sub
$fn$;

CREATE OR REPLACE FUNCTION public.furniture_add(p_world uuid, p_id bigint, p_def text, p_count integer, p_ql double precision, p_extra text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare p placed; stacks boolean; into_id bigint;
begin
  select * into p from placed where world_id = p_world and id = p_id and kind = 'furniture';
  if not found then return false; end if;
  if furniture_refuses(p, p_def) is not null then return false; end if;
  if p_count > furniture_room(p, p_def) then return false; end if;
  select coalesce(d.stackable, false) into stacks from item_def d where d.id = p_def;
  if stacks then
    select i.id into into_id from item i
    where i.world_id = p_world and i.holder = 'furniture' and i.placed = p_id and i.def = p_def
      and i.extra is not distinct from p_extra
    limit 1;
    if into_id is not null then
      update item set ql = (ql * count + p_ql * p_count) / (count + p_count), count = count + p_count
        where id = into_id;
      return true;
    end if;
  end if;
  insert into item (world_id, holder, placed, def, ql, count, extra)
  values (p_world, 'furniture', p_id, p_def, greatest(0, least(100, p_ql)), p_count, p_extra);
  return true;
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
    if (first_bag(p_world, p_uid, it.def, 1)).id is null then
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
      if furniture_room(p, it.def) <= 0 then
        return 'The ' || lower(placed_name(p)) || ' is full.';
      end if;
      return null;
    end if;
    p := nearest_store(p_world, p_uid, it.def, 1);
    if p.id is null then
      -- Say why the thing beside you will not take it, rather than that
      -- nothing will: standing at a barrel with a plank, "a barrel holds
      -- liquid and nothing else" is the answer somebody wanted.
      for v_other in select o.* from placed o
        where o.world_id = p_world and o.kind = 'furniture' and near_piece(p_world, p_uid, o, 2.6)
        order by furniture_size(o, it.def) desc, o.id
      loop
        v_why := furniture_refuses(v_other, it.def);
        if v_why is not null then return v_why; end if;
        if furniture_room(v_other, it.def) <= 0 then
          return 'The ' || lower(placed_name(v_other)) || ' is full.';
        end if;
      end loop;
      return 'Stand next to something that will take it.';
    end if;

  elsif p_action = 'throw_away' then
    p := trash_near(p_world, p_uid);
    if p.id is null then return 'There is no trash crate beside you.'; end if;
    if v_want > furniture_room(p, it.def) then
      return 'The trash crate is full. Wait for it to rot down.';
    end if;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.named_store(p_world uuid, p_uid uuid, p_target jsonb)
 RETURNS placed
 LANGUAGE sql
 STABLE
AS $function$
  select p.* from placed p
  where p.world_id = p_world and p.kind = 'furniture' and p.id = (p_target->>'into')::bigint
    and near_piece(p_world, p_uid, p, 2.6) and furniture_holds(p)
$function$;

CREATE OR REPLACE FUNCTION public.nearest_store(p_world uuid, p_uid uuid, p_def text, p_count integer)
 RETURNS placed
 LANGUAGE sql
 STABLE
AS $function$
  select p.* from placed p
  where p.world_id = p_world and p.kind = 'furniture'
    and near_piece(p_world, p_uid, p, 2.6)
    and furniture_refuses(p, p_def) is null
    and p_count <= furniture_room(p, p_def)
  order by furniture_size(p, p_def) desc, p.id
  limit 1
$function$;

CREATE OR REPLACE FUNCTION public.perform_holding(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare it item; p placed; v_bag item; v_want int; v_fit int; v_moved bigint; v_names text; v_n int;
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
    perform pack_fold(p_world, p_uid);
    perform tell(p_world, p_uid, 'You take ' || v_names || ' out of the '
      || lower(placed_name(p)) || '.', 'event');
    return;
  end if;

  select * into it from item where world_id = p_world and id = target_item(p_target)
    and holder = 'player' and holder_uid = p_uid;
  if not found then return; end if;
  v_want := greatest(1, least(coalesce((p_target->>'count')::int, 1), it.count));

  if p_action = 'stow_item' then
    v_bag := first_bag(p_world, p_uid, it.def, 1);
    if v_bag.id is null then return; end if;
    v_fit := least(v_want, bag_spare(v_bag));
    if v_fit <= 0 then return; end if;
    v_moved := move_part(it.id, v_fit, 'bag', p_uid, v_bag.id, null);
    if v_moved is null then return; end if;
    perform tell(p_world, p_uid, stored_line(v_fit, item_name(it),
      (select name from item_def where id = v_bag.def), v_want - v_fit), 'event');

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
    if p.id is null then p := nearest_store(p_world, p_uid, it.def, 1); end if;
    if p.id is null then return; end if;
    v_fit := least(v_want, furniture_room(p, it.def));
    if v_fit <= 0 then return; end if;
    v_moved := move_part(it.id, v_fit, 'furniture', null, null, p.id);
    if v_moved is null then return; end if;
    perform tell(p_world, p_uid,
      stored_line(v_fit, item_name(it), placed_name(p), v_want - v_fit), 'event');

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

CREATE OR REPLACE FUNCTION public.worker_store(p_world uuid, c creature, p_def text, p_count integer)
 RETURNS TABLE(kind text, id bigint, cx double precision, cy double precision)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_site record; v_own boolean;
begin
  /*
   * A raw material bin takes the load first, when the load is raw.
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
   * The load no longer has to be tested for raw. A bin that is in this list
   * has already been through `furniture_refuses`, so it is the bin built for
   * exactly this thing -- which is how the craft material bin joined the rule
   * without a second clause: worked materials go to the craft bin the way ore
   * goes to the raw one.
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
      select 'furniture', p.id, p.x + 0.5, p.y + 0.5, fd.raw or fd.crafted
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
    select 'furniture', p.id, p.x + 0.5, p.y + 0.5, false, fd.raw or fd.crafted
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

select private.lock_doors();
