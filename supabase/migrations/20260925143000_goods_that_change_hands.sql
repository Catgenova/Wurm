/*
 * Goods that change hands: stalls that sell, a board that finds them, and a
 * wildermon that goes with its crate.
 *
 * Asked for: "A market board. List every merchant stall on the island at any
 * settlement token or post: what's for sale, where, and at what price", and
 * "Trade a wildermon in its crate. Face to face, at a stall, or by post."
 *
 * The stalls had never sold anything. `rpc_price` and `mailbox_at` looked a
 * piece up by `placed.kind`, which is 'furniture' for every piece anybody
 * builds -- the piece is in `sub` -- so a price was always refused and a
 * mailbox was never found. The test that covered them put rows down with
 * `kind` 'stall' and 'mailbox' by hand, which no builder ever does, so it
 * passed. And with nothing ever priced, nothing was ever bought.
 *
 * Two more things came up on the way:
 *
 * - Anybody could take anything off anybody's stall. `take_from_store`
 *   asked only whether you were standing next to it, which is the right
 *   question for a chest on your own settlement and the wrong one for a
 *   counter. A stall now gives its goods back to its owner alone.
 * - A thing taken off a stall kept its price, and was for sale again at the
 *   old price the next time it was put on one. `move_part` keeps a price
 *   only while a thing stays on the piece it was priced on.
 *
 * A crate with a wildermon in it could be carried, set down or opened and
 * nothing else. Now it can also be offered in a deal, laid on a stall and
 * priced, bought, posted and collected -- and whoever it goes to keeps the
 * wildermon in it: `creature.keeper` follows the crate's `holder_uid`. It
 * still goes into no bag and no other store. While it is out of its keeper's
 * pack or held in a deal it cannot be opened, and what is in it cannot be
 * let go or culled, or a seller could empty a crate that was already sold.
 */
set local lock_timeout = '3s';

/* The wildermon in a crate, as a deal, a parcel or a stall names it. */
create or replace function crate_occupant(p_world uuid, p_creature int) returns jsonb
language sql stable as $$
  select jsonb_build_object('name', c.name, 'species', c.species)
    from creature c where c.world_id = p_world and c.id = p_creature
$$;

/*
 * The market board is read at a settlement token or a mailbox: standing on or
 * beside any settlement's token, or within reach of any mailbox.
 */
create or replace function board_at(p_world uuid, p_uid uuid) returns boolean
language sql stable as $$
  select exists (select 1 from player p join deed d on d.world_id = p.world_id
                  where p.world_id = p_world and p.uid = p_uid
                    and greatest(abs(d.x + 0.5 - p.x), abs(d.y + 0.5 - p.y)) <= 2.4)
      or (mailbox_at(p_world, p_uid)).id is not null
$$;

/*
 * Every stall on the island and what is for sale on it, for somebody at the
 * board; and your own stalls wherever you are, with their tills and the
 * things on them not priced yet, so they can be priced from anywhere.
 */
create or replace function rpc_market(p_world uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_board boolean;
begin
  if me is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from player where world_id = p_world and uid = me) then
    raise exception 'you are not on this island';
  end if;
  v_board := board_at(p_world, me);
  return jsonb_build_object(
    'board', v_board,
    'stalls', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pl.id, 'x', pl.x, 'y', pl.y,
        'owner', folk_name(p_world, pl.made_by), 'mine', pl.made_by = me,
        'deed', (select d.name from deed d where d.world_id = p_world
                   and abs(pl.x - d.x) <= d.radius and abs(pl.y - d.y) <= d.radius
                 order by d.level desc limit 1),
        'till', case when pl.made_by = me then coalesce(pl.till, 0) end,
        'goods', coalesce((select jsonb_agg(jsonb_build_object(
              'id', i.id, 'def', i.def, 'ql', i.ql, 'dmg', i.dmg, 'count', i.count,
              'extra', i.extra, 'rare', i.rare, 'price', i.price,
              'creature', crate_occupant(p_world, i.creature))
            order by i.price nulls last, i.id)
          from item i where i.world_id = p_world and i.holder = 'furniture' and i.placed = pl.id
            and (i.price is not null or pl.made_by = me)), '[]'::jsonb))
        order by pl.made_by = me desc, pl.id)
      from placed pl
      where pl.world_id = p_world and pl.kind = 'furniture' and pl.sub = 'stall'
        and (v_board or pl.made_by = me)), '[]'::jsonb));
end $$;

/*
 * A crate with a wildermon in it: carried, set down, opened -- and traded.
 * On a stall and priced there, in the post, or held in a deal; into no bag
 * and no other store, and priced nowhere but on a stall.
 */
create or replace function occupied_crate_stays() returns trigger language plpgsql as $$
begin
  if new.inside is not null
     or new.holder not in ('player', 'furniture', 'post')
     or (new.holder = 'furniture' and not coalesce((
           select f.stall from placed pl join furniture_def f on f.id = pl.sub
            where pl.world_id = new.world_id and pl.id = new.placed and pl.kind = 'furniture'), false))
     or (new.price is not null and new.holder <> 'furniture')
     or (new.letter is not null and new.holder <> 'post')
     or (new.deal is not null and new.holder <> 'player') then
    raise exception 'A creature crate with a wildermon in it is carried, set down, opened or traded, and nothing else.';
  end if;
  return new;
end $$;

/* Whoever a crate goes to keeps what is in it. */
create or replace function crate_changes_hands() returns trigger language plpgsql as $$
begin
  update creature set keeper = new.holder_uid, post = null
   where world_id = new.world_id and id = new.creature and keeper is distinct from new.holder_uid;
  return null;
end $$;
-- Through `private.shut`, which waits its turn: a trigger on `item` wants a
-- lock the clock's round holds for a few milliseconds every second.
select private.shut('drop trigger if exists crate_changes_hands on item');
select private.shut($ddl$
create trigger crate_changes_hands after update of holder_uid on item
  for each row when (new.creature is not null and new.holder_uid is not null
                     and new.holder_uid is distinct from old.holder_uid)
  execute function crate_changes_hands()$ddl$);

CREATE OR REPLACE FUNCTION public.rpc_price(p_world uuid, p_item bigint, p_silver bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); v_it item; v_pl placed;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into v_it from item where world_id = p_world and id = p_item;
  if not found or v_it.placed is null then
    return jsonb_build_object('why', 'That is not laid out on anything.');
  end if;
  select * into v_pl from placed where world_id = p_world and id = v_it.placed;
  if not found or v_pl.kind <> 'furniture' or not coalesce((select stall from furniture_def where id = v_pl.sub), false) then
    return jsonb_build_object('why', 'Only what is on a stall can carry a price.');
  end if;
  if v_pl.made_by is distinct from me then
    return jsonb_build_object('why', 'That is not your stall.');
  end if;
  update item set price = case when coalesce(p_silver, 0) > 0 then p_silver end
    where world_id = p_world and id = p_item;
  return jsonb_build_object('priced', coalesce(p_silver, 0));
end $function$;

CREATE OR REPLACE FUNCTION public.mailbox_at(p_world uuid, p_uid uuid)
 RETURNS placed
 LANGUAGE sql
 STABLE
AS $function$
  select pl.* from placed pl, player p
   where pl.world_id = p_world and p.world_id = p_world and p.uid = p_uid
     and pl.kind = 'furniture' and coalesce((select post from furniture_def where id = pl.sub), false)
     and greatest(abs(pl.x + 0.5 - p.x), abs(pl.y + 0.5 - p.y)) <= 2.4
   limit 1
$function$;

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
      and o.piece is not distinct from it.piece
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
        gx = null, gy = null, crate = null,
        -- A price belongs to the stall it was set on: off it, it is not for sale.
        price = case when p_holder = 'furniture' and p_placed is not distinct from it.placed then it.price end
      where id = it.id;
    return it.id;
  end if;
  update item set count = it.count - p_count where id = it.id;
  insert into item (world_id, holder, holder_uid, inside, placed, def, ql, dmg, count,
                    extra, rare, dye, bless, charges, locked, maker, piece)
  values (it.world_id, p_holder, p_uid, p_inside, p_placed, it.def, it.ql, it.dmg, p_count,
          it.extra, it.rare, it.dye, it.bless, it.charges, false, it.maker, it.piece)
  returning id into v_new;
  return v_new;
end $function$;

CREATE OR REPLACE FUNCTION public.furniture_refuses(p placed, p_def text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select case
    when holds_liquid(p) then v.it || ' holds liquid and nothing else.'
    when d.hive is not null then v.it || ' is the swarm''s, not yours. Take what is in it; do not put anything back.'
    when not furniture_holds(p) then v.it || ' does not hold things.'
    when p_def = 'creature_crate' and not coalesce(d.stall, false)
      then 'A creature crate goes on a stall, and in no other store.'
    else furniture_takes(d.takes, p_def)
    end
  from furniture_def d
  cross join lateral (select case when lower(d.name) ~ '^[aeiou]' then 'An ' else 'A ' end
                        || lower(d.name) as it) v
  where d.id = p.sub
$function$;

CREATE OR REPLACE FUNCTION public.occupied_crate_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(c.name, 'A wildermon')
         || ' is in that crate. A crate with a wildermon in it can be carried, set down, opened or traded, and nothing else.'
    from item i left join creature c on c.world_id = i.world_id and c.id = i.creature
   where p_action not in ('examine', 'examine_item', 'place_furniture', 'crate_follow', 'crate_work',
                          'lock_item', 'unlock_item', 'name_thing', 'store_in_furniture', 'take_from_store')
     and i.world_id = p_world and i.id = target_item(p_target) and i.creature is not null
$function$;

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
    -- A crate with a padlock on it opens for its key and for the founder of
    -- the settlement it stands on, and for nobody else. Picking it up is
    -- shut the same way: a locked thing you could simply carry off is not
    -- locked at all.
    if lock_shut(p_world, p_uid, v_c.lock, v_c.x, v_c.y) then
      return lock_refusal(p_world, p_uid, v_c.lock, v_c.x, v_c.y);
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
    if lock_shut(p_world, p_uid, v_c.lock, v_c.x, v_c.y) then
      return lock_refusal(p_world, p_uid, v_c.lock, v_c.x, v_c.y);
    end if;
    select * into v_it from item where id = target_item(p_target)
      and world_id = p_world and holder = 'player' and holder_uid = p_uid;
    if not found then return 'It is gone.'; end if;
    if crate_kind_of_item(v_it.def) is not null then return 'A crate does not go in a crate.'; end if;
    v_want := greatest(1, least(v_it.count, coalesce((p_target->>'count')::int, 1)));
    /*
     * Room for some of it is enough.
     *
     * Asked for: "when trying to put 48 items in a container that has room for
     * 13, deposit 13 and reject the 35." It was all or nothing, so an armful
     * of ore and a nearly full crate meant counting the difference yourself
     * and splitting the stack by hand. A thing that stacks goes in as far as
     * there is room; a thing that does not is one row and goes in whole or not
     * at all, which is what it always was.
     */
    if crate_spare(p_world, v_c)
       < (case when coalesce((select stackable from item_def where id = v_it.def), false)
               then 1 else v_want end) then
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
      if v_pl.kind = 'furniture' and coalesce((select stall from furniture_def where id = v_pl.sub), false)
         and v_pl.made_by is distinct from p_uid then
        return 'That is on somebody else''s stall. Buy it at the counter.';
      end if;
    end if;
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.crate_open_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare v_at record; v_c creature; v_cur creature; v_d species_def; v_dd deed;
begin
  select * into v_at from crate_aimed(p_world, p_uid, p_target);
  if v_at.v_item is null and v_at.v_placed is null then return 'That is not a creature crate.'; end if;
  if v_at.v_creature is null then return 'The crate is empty.'; end if;
  select * into v_c from creature where world_id = p_world and id = v_at.v_creature;
  if not found then return 'The crate is empty.'; end if;
  if v_c.mode <> 'stored' then return v_c.name || ' is not in it.'; end if;
  if v_c.keeper is distinct from p_uid then return v_c.name || ' is not yours to let out.'; end if;
  if v_at.v_item is not null and exists (select 1 from item i where i.world_id = p_world and i.id = v_at.v_item and i.deal is not null) then
    return 'That crate is offered in a deal. Take the offer back first.';
  end if;
  if v_at.v_placed is not null and not placed_in_reach(p_world, p_uid, v_at.v_placed) then
    return 'Stand next to the crate.';
  end if;
  if p_action = 'crate_follow' then
    select * into v_cur from creature where world_id = p_world and keeper = p_uid and mode = 'active' limit 1;
    if v_cur.id is not null and v_cur.hitched_to is not null then
      return v_cur.name || ' is in the traces, and would have to go into the crate in its place. Take it out first.';
    end if;
    if v_cur.id is not null and v_cur.rider is not null then
      return 'Get down off ' || v_cur.name || ' first: it goes into the crate in its place.';
    end if;
    return null;
  end if;
  v_dd := my_deed(p_world, p_uid);
  if v_dd.world_id is null then return 'You have no settlement to set it to work on.'; end if;
  select * into v_d from species_def where id = v_c.species;
  if v_d.gathers is null then return 'A ' || lower(v_d.name) || ' has no trade to be set to.'; end if;
  if not worker_job_ported(v_d.gathers) then
    return 'Nobody has taught this island what '
      || (select plain from gather_def where id = v_d.gathers) || ' looks like yet.';
  end if;
  if workers_on_deed(p_world, p_uid) >= worker_cap(p_world, p_uid) then
    return v_dd.name || ' has work for ' || worker_cap(p_world, p_uid) || ' wildermon at level '
      || v_dd.level || '. Upgrade the settlement to take on more.';
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.creature_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; food text; held int; working int; cap int;
begin
  -- Opening a crate you carry is asked of the crate, not of a creature.
  if p_action in ('crate_follow', 'crate_work') then
    return crate_open_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Walked forward before it is looked at: where it was is not where it is.
  perform creature_settle(p_world, (p_target->>'id')::int);
  c := target_creature(p_world, p_target);
  if c.world_id is null then return 'It is gone.'; end if;
  select * into d from species_def where id = c.species;

  -- In the traces until somebody takes it out: nothing that would send it
  -- anywhere else is open to it, in the words culling one already uses.
  if p_action in ('assign_deed', 'take_creature', 'crate_creature', 'release_creature')
     and c.hitched_to is not null then
    return c.name || ' is in the traces. Take it out first.';
  end if;

  -- Only your own is yours to send anywhere, put in a crate, order about or name.
  if p_action in ('take_creature', 'assign_deed', 'crate_creature', 'release_creature', 'cull_creature',
                  'set_stance', 'rename_creature')
     and c.mode <> 'wild' and c.keeper is distinct from p_uid then
    return c.name || ' is not yours.';
  end if;

  if p_action not in ('examine_creature', 'assign_deed')
     and not creature_in_reach(p_world, p_uid, c) then
    return case when c.mode = 'wild' then 'The ' || lower(d.name) || ' is not close enough.'
                else 'Stand next to ' || c.name || '.' end;
  end if;

  if p_action = 'tame' then
    if d.monster then
      return 'A ' || lower(d.name) || ' is not a wildermon. There is nothing to be done with it but kill it.';
    end if;
    if c.mode <> 'wild' then return c.name || ' is already yours.'; end if;
    if skill_of(p_world, p_uid, 'taming') < d.tame_level then
      return 'You need taming ' || to_char(d.tame_level, 'FM990.#') || ' to try.';
    end if;
    if bait_in_pack(p_world, p_uid, c.species) is null then
      return d.name || 's take ' || diet_text(c.species) || '. Bring some.';
    end if;
    -- The first follows you, and every one after that goes into a crate you carry.
    return tame_room_refusal(p_world, p_uid);

  elsif p_action = 'assign_deed' then
    if c.mode = 'wild' then return 'It is not yours to set to work.'; end if;
    if c.mode = 'stored' then return c.name || ' is in a creature crate. Open the crate to set it to work.'; end if;
    if (my_deed(p_world, p_uid)).world_id is null then
      return 'You have no settlement to assign it to.';
    end if;
    if d.gathers is null then return 'A ' || lower(d.name) || ' has no trade to be set to.'; end if;
    -- A trade asked for by name has to be one of its own.
    if nullif(p_target->>'job', '') is not null
       and not (p_target->>'job' = d.gathers or p_target->>'job' = any(coalesce(d.trades, '{}'::text[]))) then
      return 'A ' || lower(d.name) || ' cannot be set to that.';
    end if;
    if not worker_job_ported(coalesce(nullif(p_target->>'job', ''), d.gathers)) then
      return 'Nobody has taught this island what '
        || (select plain from gather_def where id = coalesce(nullif(p_target->>'job', ''), d.gathers))
        || ' looks like yet.';
    end if;
    -- One off a post takes a place as much as one off the road, since a post costs none.
    if c.mode <> 'deed' or c.post is not null then
      working := workers_on_deed(p_world, p_uid);
      cap := worker_cap(p_world, p_uid);
      if working >= cap then
        return (my_deed(p_world, p_uid)).name || ' has work for ' || cap
          || ' wildermon at level ' || cap || '. Upgrade the settlement to take on more.';
      end if;
    end if;
    return null;

  elsif p_action = 'feed' then
    if c.mode not in ('active', 'deed') then return 'It is not yours to feed.'; end if;
    if bait_in_pack(p_world, p_uid, c.species) is null then
      return 'It eats ' || diet_text(c.species) || '.';
    end if;
    return null;

  elsif p_action = 'groom' then
    if d.monster then return 'Not that. Not ever.'; end if;
    if c.mode = 'wild' then return 'It is not yours to brush.'; end if;
    if pack_count(p_world, p_uid, 'brush') <= 0 then return 'You need a brush.'; end if;
    if c.care >= 0.995 then return c.name || ' has been brushed to a shine already.'; end if;
    return null;

  elsif p_action = 'shear' then
    if d.fleece is null then return 'There is nothing on it worth shearing.'; end if;
    if c.mode = 'wild' then return 'Tame it first; it will not stand still for you otherwise.'; end if;
    if pack_count(p_world, p_uid, 'carving_knife') <= 0 then return 'You need a knife to shear with.'; end if;
    if c.fleece < 0.35 then
      return c.name || ' has hardly any '
        || case when d.shear_yield = 'feather' then 'feathers' else 'fleece' end || ' back yet.';
    end if;
    return null;

  elsif p_action = 'milk_creature' then
    if not d.milk then return 'That is not something you milk.'; end if;
    if c.mode in ('wild', 'stored') then return 'It is not yours to milk.'; end if;
    if pack_count(p_world, p_uid, 'bucket') <= 0 then return 'You need an empty bucket.'; end if;
    if c.sex <> 'female' then return c.name || ' is male. Nothing is coming out of him.'; end if;
    if c.fleece < 0.4 then return c.name || ' has nothing to give yet.'; end if;
    return null;

  elsif p_action = 'set_stance' then
    if c.mode <> 'active' then return 'Only a companion takes orders like that.'; end if;
    if coalesce(p_target->>'stance', '') not in ('passive', 'defensive', 'aggressive') then
      return 'Passive, defensive or aggressive.';
    end if;
    return null;

  elsif p_action = 'rename_creature' then
    if c.mode = 'wild' then return 'It is not yours to name.'; end if;
    if nullif(btrim(coalesce(p_target->>'name', '')), '') is null then return 'Choose a name.'; end if;
    return null;

  elsif p_action = 'take_creature' then
    if c.mode = 'stored' then return c.name || ' is in a creature crate. Open the crate to let it out.'; end if;
    if c.mode <> 'deed' then return 'It is already with you.'; end if;
    -- Where the one following you now goes, or why it has nowhere to.
    return (companion_swap(p_world, p_uid, c)).v_why;

  elsif p_action = 'crate_creature' then
    if c.mode = 'stored' then return c.name || ' is already in a creature crate.'; end if;
    if c.mode not in ('active', 'deed') then return 'It is not yours to put in a crate.'; end if;
    if c.rider is not null then return 'Get down off ' || c.name || ' first.'; end if;
    if empty_crate(p_world, p_uid) is null then return 'You need an empty creature crate in your pack.'; end if;
    return null;

  elsif p_action = 'release_creature' then
    if c.mode = 'wild' then return 'It is already wild.'; end if;
    if c.mode = 'stored' and exists (select 1 from item i where i.world_id = p_world and i.creature = c.id
                                        and (i.deal is not null or i.holder <> 'player')) then
      return c.name || '''s crate is on offer, on a stall or in the post. Take it back first.';
    end if;
    return null;

  elsif p_action = 'cull_creature' then
    -- Only your own, and only one that is not in the traces or under you when
    -- you ask: both of those are a mess this does not have to make.
    if c.mode = 'wild' then return 'That one is nobody''s. Fight it if you mean it.'; end if;
    if c.hitched_to is not null then return c.name || ' is in the traces. Take it out first.'; end if;
    if c.rider is not null then return 'Get down off ' || c.name || ' first.'; end if;
    if c.mode = 'stored' and exists (select 1 from item i where i.world_id = p_world and i.creature = c.id
                                        and (i.deal is not null or i.holder <> 'player')) then
      return c.name || '''s crate is on offer, on a stall or in the post. Take it back first.';
    end if;
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_deals(p_world uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'n', d.n, 'mine', d.seller = me,
      'who', folk_name(p_world, case when d.seller = me then d.buyer else d.seller end),
      'uid', case when d.seller = me then d.buyer else d.seller end,
      'want', d.want, 'give', d.give,
      'things', coalesce((select jsonb_agg(jsonb_build_object(
            'id', i.id, 'def', i.def, 'ql', i.ql, 'dmg', i.dmg, 'count', i.count,
            'extra', i.extra, 'rare', i.rare, 'creature', crate_occupant(p_world, i.creature)) order by i.id)
          from item i where i.world_id = p_world and i.deal = d.n), '[]'::jsonb))
      order by d.at)
    from deal d
    where d.world_id = p_world and d.closed_at is null and me in (d.seller, d.buyer)),
    '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_parcels(p_world uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  return jsonb_build_object(
    'at_box', (mailbox_at(p_world, me)).id is not null,
    'things', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'def', i.def, 'ql', i.ql, 'dmg', i.dmg, 'count', i.count,
        'extra', i.extra, 'rare', i.rare, 'letter', i.letter,
        'from', folk_name(p_world, l.sender), 'creature', crate_occupant(p_world, i.creature)) order by i.id)
      from item i left join letter l on l.world_id = i.world_id and l.n = i.letter
      where i.world_id = p_world and i.holder = 'post' and i.holder_uid = me), '[]'::jsonb));
end $function$;

select private.lock_doors();
