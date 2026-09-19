-- Ranks on a deed, and a padlock with one key
--
-- Two holes in the same wall: who may do what on a settlement, and whether
-- anything anybody builds can be shut.
--
-- **`deed_member` was a flat list.** In or out, and everybody in it could dig
-- up the gardens, empty the stores and pull the walls down. So inviting
-- anybody to anything was a decision nobody could take back short of throwing
-- them out, which is not a thing you want to have to do to somebody you are
-- merely unsure about. Four ranks now, and `role` on the row:
--
--   founder   planted the stake. Cannot be demoted, may do everything, and
--             holds the master key to every lock on their own land.
--   mayor     everything but founding: invites, expels, ranks, and disbands.
--   builder   the ordinary citizen, and what an invitation makes you.
--   guest     walks the land and opens nothing.
--
-- `deeds_of` is unchanged — it still says which settlements you belong to,
-- which is what entry and the aura ask — and the *shaping* question goes
-- through `may_shape` instead, which asks the rank as well.
--
-- **And everything anybody built was open to everybody.** A crate on your own
-- deed was safe because the ground was yours; a crate anywhere else, a cart
-- at a work post, a cupboard in a house you had invited somebody into, was a
-- thing anybody could empty. (`item.locked` means something else entirely: it
-- stops *you* feeding your own hatchet to a wildermon by accident.)
--
-- A padlock is forged with no key; fitting it to a store closes it and cuts
-- one key, there and then, and the number they share is the padlock's own
-- item id — unique on an island for as long as the island lasts, so there is
-- nothing to mint and nothing two machines could disagree about. A key is an
-- ordinary item: hand it over and you have handed over what it opens. The one
-- way back in is the ground: the **founder** of the settlement a store stands
-- on may open anything on their own land, because a game where losing a small
-- item costs you a building is a game nobody enjoys.

alter table deed_member add column if not exists role text not null default 'builder';
do $$ begin
  alter table deed_member add constraint deed_member_role
    check (role in ('mayor', 'builder', 'guest'));
exception when duplicate_object then null; end $$;

-- The number a store shares with its key, and the number a key carries.
alter table crate add column if not exists lock bigint;
alter table placed add column if not exists lock bigint;
alter table item add column if not exists keyed bigint;

/**
 * What somebody is on a settlement: 'founder' for whoever planted the stake,
 * the member's own rank otherwise, and null for somebody who does not belong
 * to it at all.
 */
create or replace function deed_role(p_world uuid, p_founder uuid, p_uid uuid)
returns text language sql stable as $fn$
  select case when p_uid = p_founder then 'founder'
              else (select m.role from deed_member m
                     where m.world_id = p_world and m.founder = p_founder and m.uid = p_uid) end
$fn$;

/** The ranks in order, so "at least a builder" is one comparison. */
create or replace function deed_rank(p_role text) returns int language sql immutable as $fn$
  select case p_role when 'founder' then 3 when 'mayor' then 2
                     when 'builder' then 1 when 'guest' then 0 else -1 end
$fn$;

/**
 * Whether this body may shape the ground here, build on it, or take from its
 * stores: a settlement of theirs covers the tile and they are at least a
 * builder on it.
 *
 * `on_my_deed` stays what it was — whether a settlement of yours covers the
 * tile at all — because that is the right question for entry, for the aura
 * and for where your own wildermon will work. A guest is still of the
 * settlement; they simply may not dig it up.
 */
create or replace function may_shape(p_world uuid, p_uid uuid, p_x int, p_y int)
returns boolean language sql stable as $fn$
  select exists (
    select 1 from deeds_of(p_world, p_uid) d
     where deed_covers(d, p_x, p_y)
       and deed_rank(deed_role(p_world, d.founded_by, p_uid)) >= deed_rank('builder'))
$fn$;

/**
 * Whether a store is shut against this body.
 *
 * The key in their pack, or the ground under it: the founder of the
 * settlement it stands on has the master key. Nothing else opens it.
 */
create or replace function lock_shut(p_world uuid, p_uid uuid, p_lock bigint,
                                     p_x int, p_y int) returns boolean
language sql stable as $fn$
  select coalesce(p_lock, 0) <> 0
     and not exists (select 1 from item i
                      where i.world_id = p_world and i.holder = 'player'
                        and i.holder_uid = p_uid and i.def = 'key' and i.keyed = p_lock)
     and not exists (select 1 from deed d
                      where d.world_id = p_world and d.founded_by = p_uid
                        and deed_covers(d, p_x, p_y))
$fn$;

/** What a shut store says, in the browser's own words. */
create or replace function lock_refusal(p_world uuid, p_uid uuid, p_lock bigint,
                                        p_x int, p_y int) returns text
language sql stable as $fn$
  select case when lock_shut(p_world, p_uid, p_lock, p_x, p_y)
              then 'It is locked, and you have no key to it.' end
$fn$;

CREATE OR REPLACE FUNCTION public.ground_deed_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $fn$
-- `may_shape` rather than `on_my_deed`: a guest is of the settlement and
-- may walk it, and may not dig it up.
declare d action_def; v_name text; cx int; cy int;
begin
  if not shapes_ground(p_action) then return null; end if;
  select * into d from action_def where id = p_action;
  if p_target->>'kind' is distinct from 'tile' then
    select floor(p.x)::int, floor(p.y)::int into cx, cy from player p
      where p.world_id = p_world and p.uid = p_uid;
    if cx is null then return null; end if;
    select dd.name into v_name from deed_covering(p_world, cx, cy) dd
      where not may_shape(p_world, p_uid, cx, cy) limit 1;
    if v_name is null then return null; end if;
    return 'That ground is part of ' || v_name || '. Only its builders may shape it.';
  end if;
  if coalesce(d.corner, false) then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    -- Ordered, so that a corner on the border of two settlements always names
    -- the same one of them.
    select dd.name into v_name from (values (cx - 1, cy - 1), (cx, cy - 1), (cx - 1, cy), (cx, cy)) v(x, y)
      cross join lateral deed_covering(p_world, v.x, v.y) dd
      where not may_shape(p_world, p_uid, v.x, v.y)
      order by dd.founded_at, v.x, v.y limit 1;
  else
    select dd.name into v_name from deed_covering(p_world, (p_target->>'x')::int, (p_target->>'y')::int) dd
      where not may_shape(p_world, p_uid, (p_target->>'x')::int, (p_target->>'y')::int) limit 1;
  end if;
  if v_name is null then return null; end if;
  return 'That ground is part of ' || v_name || '. Only its builders may shape it.';
end $fn$;
CREATE OR REPLACE FUNCTION public.building_yours(p_world uuid, p_uid uuid, p_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $fn$
  select coalesce(b.planned_by = p_uid, true)
      or exists (select 1 from building_tile t where t.world_id = p_world and t.building = p_id
                   and may_shape(p_world, p_uid, t.x, t.y))
    from building b where b.world_id = p_world and b.id = p_id
$fn$;
CREATE OR REPLACE FUNCTION public.crate_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $fn$
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
    end if;
    return null;
  end if;
  return null;
end $fn$;

/**
 * Fitting a padlock, and taking it off.
 *
 * The number a store and its key share is the padlock's own item id, minted
 * by being consumed: unique on this island for as long as it lasts, with
 * nothing to allocate and nothing two machines could disagree about.
 */
create or replace function lock_refusal_for(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
returns text language plpgsql stable as $fn$
declare v_c crate; v_pl placed; v_lock bigint; v_x int; v_y int; v_p player;
begin
  if p_action not in ('fit_lock', 'take_off_lock') then return null; end if;
  select * into v_p from player where world_id = p_world and uid = p_uid;
  if p_target->>'kind' = 'crate' then
    v_c := target_crate(p_world, p_target);
    if v_c.id is null then return 'It is gone.'; end if;
    v_lock := v_c.lock; v_x := v_c.x; v_y := v_c.y;
  else
    select * into v_pl from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return 'It is gone.'; end if;
    v_lock := v_pl.lock; v_x := v_pl.x; v_y := v_pl.y;
  end if;
  if sqrt((v_x + 0.5 - v_p.x) ^ 2 + (v_y + 0.5 - v_p.y) ^ 2) > 2.4 then
    return 'Stand next to it.';
  end if;
  if p_action = 'fit_lock' then
    if coalesce(v_lock, 0) <> 0 then return 'There is a padlock on it already.'; end if;
    if not exists (select 1 from item where world_id = p_world and holder = 'player'
                     and holder_uid = p_uid and def = 'padlock') then
      return 'You have no padlock. Forge one at a smelter.';
    end if;
    return null;
  end if;
  if coalesce(v_lock, 0) = 0 then return 'There is no padlock on it.'; end if;
  return lock_refusal(p_world, p_uid, v_lock, v_x, v_y);
end $fn$;

create or replace function perform_lock(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
returns void language plpgsql as $fn$
declare v_c crate; v_pl placed; v_lock bigint; v_x int; v_y int; v_padlock item; v_key item;
begin
  if p_target->>'kind' = 'crate' then
    v_c := target_crate(p_world, p_target);
    if v_c.id is null then return; end if;
    v_lock := v_c.lock; v_x := v_c.x; v_y := v_c.y;
  else
    select * into v_pl from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    v_lock := v_pl.lock; v_x := v_pl.x; v_y := v_pl.y;
  end if;

  if p_action = 'fit_lock' then
    select * into v_padlock from item where world_id = p_world and holder = 'player'
      and holder_uid = p_uid and def = 'padlock' order by ql desc limit 1;
    if not found then return; end if;
    delete from item where id = v_padlock.id;
    if p_target->>'kind' = 'crate' then
      update crate set lock = v_padlock.id where world_id = p_world and id = v_c.id;
    else
      update placed set lock = v_padlock.id where world_id = p_world and id = v_pl.id;
    end if;
    insert into item (world_id, holder, holder_uid, def, ql, count, extra, keyed)
      values (p_world, 'player', p_uid, 'key', v_padlock.ql, 1, v_padlock.extra, v_padlock.id);
    perform tell(p_world, p_uid, 'You fit the padlock and cut its key. Nothing opens it now but that key'
      || case when exists (select 1 from deed d where d.world_id = p_world and d.founded_by = p_uid
                             and deed_covers(d, v_x, v_y))
              then ', or you, on your own land' else '' end || '.', 'event');
    return;
  end if;

  -- Taking it off. The key goes with the lock it was cut to: a key to
  -- nothing is an item nobody can tell from a key to something.
  select * into v_key from item where world_id = p_world and holder = 'player'
    and holder_uid = p_uid and def = 'key' and keyed = v_lock limit 1;
  if p_target->>'kind' = 'crate' then
    update crate set lock = null where world_id = p_world and id = v_c.id;
  else
    update placed set lock = null where world_id = p_world and id = v_pl.id;
  end if;
  if v_key.id is not null then delete from item where id = v_key.id; end if;
  insert into item (world_id, holder, holder_uid, def, ql, count)
    values (p_world, 'player', p_uid, 'padlock', 40, 1);
  perform tell(p_world, p_uid, 'You take the padlock off'
    || case when v_key.id is not null then ' and throw the key in after it' else '' end
    || '. It is open to anybody again.', 'event');
end $fn$;


-- And the two new jobs joined to the dispatch.
CREATE OR REPLACE FUNCTION public.act_refusal_rules(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $fn$
declare d action_def; p player; cx int; cy int; tx int; ty int; t tile_def; aimed text;
begin
  select * into d from action_def where id = p_action;
  if not found then return 'There is no such thing as ' || p_action || '.'; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 'You are not on this island.'; end if;
  -- Deliberately not "are you busy": asked of queued jobs too. That is rpc_act's.
  if not act_ported(p_action) then
    return 'You cannot ' || lower(d.label) || ' on this island yet.';
  end if;

  aimed := p_target->>'kind';
  -- Whose ground it is, before anything about what it is made of.
  aimed := ground_deed_refusal(p_world, p_uid, p_action, p_target);
  if aimed is not null then return aimed; end if;
  aimed := p_target->>'kind';
  -- The hour comes for a dam in young whoever is or is not standing there, and
  -- somebody is always about to do something. This is where they find out.
  perform herd_settle(p_world);
  -- The last ten answer for their own reach, every one of them: a bridge is
  -- worked from either bank, a bed is furniture, and a beast is not at a tile.
  -- First of all, because a map is an item and every other family that takes
  -- an item wants one it can name a use for. This one is aimed at the map.
  if treasure_action(p_action) then
    return treasure_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if last_action(p_action) then
    return last_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Then the only family that does not care what it is
  -- pointed at: a prayer wants an altar, a cast wants a name, and the other
  -- three want nothing but the ground you are sitting on.
  if faith_action(p_action) then
    return faith_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Then the ones asked of a beast, which is not at a
  -- tile, and half of a cart, which is furniture and would otherwise be handed
  -- to the code that lights fires. Both answer for their own reach.
  if ride_action(p_action) then
    return ride_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if hands_action(p_action) then
    return hands_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Before the one that lights fires, which is what pointing at furniture has
  -- meant up to now: a barrel is furniture too, and tipping it out is not a fire.
  if liquid_action(p_action) then
    return liquid_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Also before the one that lights fires: an oven is furniture and an anvil
  -- is pointed at the same way a kiln is, and neither wants that route.
  if forge_action(p_action) then
    return forge_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if holding_action(p_action) then
    return holding_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- The token is under your feet and a post answers for its own reach, so
  -- neither wants the reach check below.
  if settlement_action(p_action) then
    return settlement_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if dig_action(p_action) then
    return dig_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A trap answers for its own reach, and rolls itself forward before it
  -- answers anything at all.
  if trap_action(p_action) then
    return trap_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Working the ground answers for its own reach for the same reason: a
  -- corner is a place rather than a thing, and `drop_dirt` names one.
  if ground_action(p_action) then
    if not in_reach(p.x, p.y, p_target, d.corner, d.range) then return 'You are too far away from that.'; end if;
    if d.tool is not null and tool_ql(p_world, p_uid, d.tool) <= 0 then
      return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || ' to ' || lower(d.label) || '.';
    end if;
    return ground_refusal(p_world, p_uid, p_action, p_target);
  end if;
  /*
   * A furnace is brought up to date before anything asks it a question: its
   * fire and its queue together, so that "is anything finished" is answered
   * about now rather than about whenever somebody last stood here.
   */
  if aimed in ('smelter', 'kiln') then
    perform furnace_settle(p_world, nullif(p_target->>'id', '')::bigint);
  end if;
  if item_action(p_action) then
    return item_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if firing_action(p_action) then
    return firing_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if aimed in ('campfire', 'smelter', 'kiln', 'furniture', 'anvil') or fire_action(p_action) then
    return fire_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A crate is reached for rather than stood in front of, so it answers for
  -- its own reach the way the creatures do.
  if crate_action(p_action) then
    return crate_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Fitting a padlock and taking one off: aimed at a crate or at a piece of
  -- furniture, so it sits beside the family that answers for crates.
  if p_action in ('fit_lock', 'take_off_lock') then
    return lock_refusal_for(p_world, p_uid, p_action, p_target);
  end if;
  -- The stake is in your hand and the ground is under your feet: nothing to reach for.
  if p_action = 'found_settlement' then
    return deed_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A creature is not at a tile, it is wherever its last leg left it, so the
  -- reach check below cannot answer for it. Both of these do their own; the
  -- fighting ones reach as far as what is in your hand, which is further.
  if creature_action(p_action) then
    return creature_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if fight_action(p_action) then
    return fight_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if not in_reach(p.x, p.y, p_target, d.corner, d.range) then return 'You are too far away from that.'; end if;
  if d.tool is not null and tool_ql(p_world, p_uid, d.tool) <= 0 then
    return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || ' to ' || lower(d.label) || '.';
  end if;
  if foundation_action(p_action) then
    return foundation_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if build_action(p_action) then
    return build_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('mine', 'chip_corner', 'pack', 'cultivate', 'pave_gravel', 'pave_cobble', 'drop_dirt_here') then
    return terrain_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('cut_down', 'forage', 'botanize', 'collect') then
    return gather_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('till', 'plant_seed', 'tend_crop', 'harvest_crop', 'clear_field') then
    return farm_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('fish', 'drag_net') then
    return fish_refusal(p_world, p_uid, p_action, p_target);
  end if;

  if exists (select 1 from recipe where id = p_action) then
    return craft_refusal(p_world, p_uid, p_action, target_item(p_target));
  end if;

  if p_action = 'dig' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    if t.dig_yield is null then return 'You cannot dig that.'; end if;
    /*
     * The same depth a pick works to. This was the exact line `terrain_refusal`
     * condemns in its own comment — `<= 0` refuses a corner standing at the
     * waterline, where no water is drawn — and mining was fixed for it while
     * digging was left with it.
     */
    if land_height(p_world, cx, cy) < -mine_depth() then
      return 'The water is too deep here to work in.';
    end if;
    if land_dirt(p_world, cx, cy) <= 0 then
      return 'That corner is bare rock. Only a pickaxe will take it lower.';
    end if;
    return coalesce(level_stop(p_world, p_uid, cx, cy, -1),
                    slope_refusal(p_world, p_uid, 'digging', cx, cy, -1));
  end if;
  return null;
end $fn$;
CREATE OR REPLACE FUNCTION public.act_perform(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $fn$
declare d action_def; tq double precision; s double precision; cx int; cy int; tx int; ty int;
        t tile_def; left_dirt int; made_ql double precision; yield text; tool_id bigint;
begin
  if last_action(p_action) then
    perform perform_last(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if faith_action(p_action) then
    perform perform_faith(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if ride_action(p_action) then
    perform perform_ride(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if hands_action(p_action) then
    perform perform_hands(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if liquid_action(p_action) then
    perform perform_liquid(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if forge_action(p_action) then
    perform perform_forge(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if holding_action(p_action) then
    perform perform_holding(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if settlement_action(p_action) then
    perform perform_settlement(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if dig_action(p_action) then
    perform perform_dig(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if trap_action(p_action) then
    perform perform_trap(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if ground_action(p_action) then
    perform perform_ground(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if foundation_action(p_action) then
    perform perform_foundation(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if build_action(p_action) then
    perform perform_building(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action = 'found_settlement' then
    perform perform_deed(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if creature_action(p_action) then
    perform perform_creature(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if fight_action(p_action) then
    perform perform_fight(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('fit_lock', 'take_off_lock') then
    perform perform_lock(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if crate_action(p_action) then
    perform perform_crate(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if item_action(p_action) then
    perform perform_item(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if firing_action(p_action) then
    perform perform_firing(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if fire_action(p_action) then
    perform perform_fire(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if treasure_action(p_action) then
    perform perform_treasure(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('mine', 'chip_corner', 'pack', 'cultivate', 'pave_gravel', 'pave_cobble', 'drop_dirt_here') then
    perform perform_terrain(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('cut_down', 'forage', 'botanize', 'collect') then
    perform perform_gather(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('till', 'plant_seed', 'tend_crop', 'harvest_crop', 'clear_field') then
    perform perform_farm(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('fish', 'drag_net') then
    perform perform_fish(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if exists (select 1 from recipe where id = p_action) then
    perform perform_craft(p_world, p_uid, p_action, p_target);
    return;
  end if;

  select * into d from action_def where id = p_action;
  s := case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end;

  if p_action = 'dig' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    select i.id into tool_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = d.tool
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id); end if;
    if not skill_check(s, d.difficulty, tq) then
      perform skill_raise(p_world, p_uid, d.skill, try_gain(false));
      perform tell(p_world, p_uid, 'You fail to dig anything useful.', 'event');
      return;
    end if;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
    left_dirt := land_dirt(p_world, cx, cy) - 1;
    perform land_set_dirt(p_world, cx, cy, left_dirt);
    if t.turns_to_dirt then perform land_set_tile(p_world, tx, ty, 1); end if;
    -- Dug to the rock, the tile becomes rock and shows the seam under it.
    perform reconcile_around(p_world, cx, cy);
    perform land_announce(p_world, tx, ty);
    if left_dirt <= 0 then
      perform tell(p_world, p_uid, 'Your shovel grates on bare rock.', 'event');
    end if;
    yield := coalesce(t.dig_yield, 'dirt');
    made_ql := product_ql(s, tq);
    perform give(p_world, p_uid, yield, 1, made_ql);
    -- And one spadeful in a thousand that is not dirt at all.
    perform maybe_map(p_world, p_uid, s, tq);
    perform skill_raise(p_world, p_uid, d.skill, 1);
    perform tell(p_world, p_uid,
      'You dig up some ' || lower((select name from item_def where id = yield)) ||
      '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
  end if;
end $fn$;
CREATE OR REPLACE FUNCTION public.act_ported(p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $fn$
  select exists (select 1 from recipe where id = p_action)
      or last_action(p_action)
      or faith_action(p_action)
      or ride_action(p_action)
      or trap_action(p_action)
      or dig_action(p_action)
      or treasure_action(p_action)
      or settlement_action(p_action)
      or holding_action(p_action)
      or forge_action(p_action)
      or liquid_action(p_action)
      or hands_action(p_action)
      or ground_action(p_action)
      or item_action(p_action)
      or firing_action(p_action)
      or fire_action(p_action)
      or crate_action(p_action)
      -- Fitting a padlock, and taking one off again.
      or p_action in ('fit_lock', 'take_off_lock')
      or build_action(p_action)
      or creature_action(p_action)
      or fight_action(p_action)
      or foundation_action(p_action)
      or p_action in ('dig', 'mine', 'chip_corner', 'pack', 'cultivate', 'pave_gravel', 'pave_cobble',
                      'drop_dirt_here', 'cut_down', 'forage', 'botanize', 'collect',
                      'till', 'plant_seed', 'tend_crop', 'harvest_crop', 'clear_field',
                      'fish', 'drag_net', 'found_settlement', 'set_to_work')
$fn$;
-- And what you are on each settlement, sent with the ground.
CREATE OR REPLACE FUNCTION public.rpc_ground(p_world uuid, p_range double precision DEFAULT 40, p_slow boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
declare me uuid := auth.uid(); p player;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  /*
   * On the slow half only, because this writes.
   *
   * The fast read runs about once a second per body — everything burning, what
   * is on the tile under you — and a settle on that path is an update a second
   * per player whether or not anything is due. The crops ride the slow half
   * beside the settlements, and any of your own work forces one of those, so
   * sowing is seen at once and a stage is at worst one reconcile late.
   */
  if p_slow then perform crops_settle(p_world, p.x, p.y, p_range); end if;
  return jsonb_build_object(
    'placed', coalesce((select jsonb_agg(
        (to_jsonb(pl) - 'world_id' - 'made_by' - 'since' - 'made_at' - 'cx' - 'cy')
        || jsonb_build_object('fuel', placed_fuel(pl), 'ash', placed_ash(pl),
                              'lit', placed_lit(pl), 'mine', coalesce(pl.made_by = me, false),
        /*
         * And what is in it, which this never said.
         *
         * Reported as "i opened it and dragged my dirt into it and the dirt
         * vanished". It had not: the island had the dirt in the bin and told
         * nobody. Every chest, bin, larder and cart on an island read as
         * empty over there, so anything put away went out of the pack and was
         * never seen again — the same hole a crate fell down before crates
         * carried their contents, and closed the same way. Within six tiles
         * only: you must be within two and a half to reach into one, so six
         * is generous, and a yard of full chests is not worth a phone's
         * second.
         */
                              'things', case when pl.kind = 'furniture'
                                              and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= 6
                                then coalesce((select jsonb_agg(jsonb_build_object(
                                       'id', i.id, 'def', i.def, 'ql', i.ql, 'dmg', i.dmg,
                                       'count', i.count, 'extra', i.extra) order by i.id)
                                     from item i
                                     where i.world_id = p_world and i.holder = 'furniture' and i.placed = pl.id),
                                   '[]'::jsonb)
                                else '[]'::jsonb end)
        order by pl.id)
      from placed pl
      where pl.world_id = p_world
        and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= p_range), '[]'::jsonb),
    'crates', crates_near(p_world, me, p_range),
    /*
     * And what is lying on the ground, which this never carried.
     *
     * Reported as "killed a roxxa, no corpse dropped to butcher, or at least
     * isn't displaying". The corpse was there: `wound_beast` drops one where
     * the thing fell, and the suite has measured it since kills were ported.
     * This sent the fires, the crates, the crops and the walls, and never a
     * thing lying on the grass — and the browser's map of the ground was only
     * ever written by its own rules, which do not run on an island. So a
     * corpse, a log a worker put down, a hatchet somebody else dropped: all
     * in this table and drawn by nobody.
     *
     * On the fast half, because a corpse is looked for the second the thing
     * goes down; `item_on_ground` serves the box. The whole row, the way the
     * pack is sent, so the browser reads it with the same map.
     */
    'lying', coalesce((select jsonb_agg(to_jsonb(i) - 'world_id' order by i.id)
      from item i
      where i.world_id = p_world and i.holder = 'ground'
        and i.gx between floor(p.x - p_range)::int and floor(p.x + p_range)::int
        and i.gy between floor(p.y - p_range)::int and floor(p.y + p_range)::int), '[]'::jsonb))
  /*
   * And the half that hardly ever moves.
   *
   * A fire burns down and a kiln works through its load while you stand and
   * watch it, which is why this is asked for every second. A wall is not like
   * that: it goes up when somebody builds it and then it is a wall. Sending
   * both at one pace meant a correlated subquery over `building_tile` per
   * building, a scan of `wall` and one of `floor_tile`, every second for every
   * player, to say that the house is still a house.
   *
   * So the caller says whether it wants them. A browser asks for the lot on
   * its twenty-second reconcile and after any of its own work, and for the
   * burning half the rest of the time. Left out rather than emptied: the
   * browser applies only the keys it is given, so what it holds stands.
   *
   * `p_slow` defaults true, so a page that has not been redeployed gets
   * exactly what it always got.
   */
  || case when not p_slow then '{}'::jsonb else jsonb_build_object(
    /*
     * And everybody ashore, on the slow half, which is the beat that already
     * carries the settlements. The map draws them; `folk_ashore` decides
     * whether there is anything to draw them at.
     */
    'folk', folk_ashore(p_world, me),
    /*
     * What is growing here, settled first so the stage reported is the stage
     * it is actually at rather than the stage it was at when somebody last
     * touched it. Everything on this island settles lazily off a timestamp,
     * and for a crop nobody had ever been the one to ask.
     *
     * `ago` rather than `stage_at`: the browser counts in its own seconds and
     * has no use for the hour this island stamped on it.
     */
    'crops', coalesce((select jsonb_agg(jsonb_build_object(
        'x', c.x, 'y', c.y, 'id', c.id, 'stage', c.stage,
        'ago', extract(epoch from (now() - c.stage_at)),
        'tended', c.tended, 'tendedNow', c.tended_now, 'ql', c.ql))
      from crop c
      where c.world_id = p_world
        and greatest(abs(c.x + 0.5 - p.x), abs(c.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    /*
     * The felling notches near you, and how long ago the woods last turned
     * over. Look reads both: "2 of 3 strokes in it", "the woods turn over in
     * 9 hours". A browser on an island keeps no clock of its own for the
     * woods, so this is the only place it hears the hour.
     */
    'notches', coalesce((select jsonb_agg(jsonb_build_object('x', n.x, 'y', n.y, 'cuts', n.cuts))
      from tree_notch n
      where n.world_id = p_world
        and greatest(abs(n.x + 0.5 - p.x), abs(n.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    'treesAgo', (select extract(epoch from (now() - w.trees_at)) from world w where w.id = p_world),
    -- The mark the ground is being worked to, which lives on the player row
    -- so that it is the same mark in every browser you open.
    'level', p.level_h,
    -- What you are on each of them, so the browser can say what you may do
    -- rather than finding out by being refused. Your own first one is your
    -- own or one you were asked onto; either way `deed_role` says which.
    'deed', (select jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level, 'mine', true,
        'role', deed_role(p_world, d.founded_by, me))
      from my_deed(p_world, me) d where d.world_id is not null),
    'deeds', coalesce((select jsonb_agg(jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level,
        -- Land you were asked onto is land you may work, so it is drawn as
        -- yours rather than as a stranger's border you happen to be inside.
        'mine', exists (select 1 from deed_member m where m.world_id = p_world
                          and m.uid = me and m.founder = d.founded_by),
        'role', deed_role(p_world, d.founded_by, me),
        'holder', account_name(d.founded_by)) order by d.founded_at)
      from deed d
      where d.world_id = p_world and d.founded_by <> me
        and greatest(abs(d.x + 0.5 - p.x), abs(d.y + 0.5 - p.y)) <= p_range + d.radius),
      '[]'::jsonb),
    /*
     * And what is standing.
     *
     * `building`, `wall` and `floor_tile` have been kept here since buildings
     * were ported and have never been sent to anybody. The rules answered
     * about them, a plan went up in Postgres, and no browser ever drew a wall
     * of it — so on an island a building was invisible to everyone, the person
     * who planned it included.
     *
     * Shaped as the browser's own `BuildingsJSON`, so it is laid straight in.
     * A building comes along whole if any of its tiles is in range: half a
     * house is worse than none, and a house is a handful of rows.
     */
    'buildings', jsonb_build_object(
      'nextId', coalesce((select max(b.id) + 1 from building b where b.world_id = p_world), 1),
      'list', coalesce((select jsonb_agg(jsonb_build_object(
          'id', b.id, 'name', b.name, 'levels', b.levels, 'workLevel', b.work_level,
          'tiles', (select coalesce(jsonb_agg(bt.x || ',' || bt.y order by bt.y, bt.x), '[]'::jsonb)
                      from building_tile bt
                     where bt.world_id = p_world and bt.building = b.id)) order by b.id)
        from building b
        where b.world_id = p_world
          and exists (select 1 from building_tile bt
                       where bt.world_id = p_world and bt.building = b.id
                         and greatest(abs(bt.x + 0.5 - p.x), abs(bt.y + 0.5 - p.y)) <= p_range)),
        '[]'::jsonb),
      'walls', coalesce((select jsonb_agg(jsonb_build_object(
          'building', w.building, 'level', w.level, 'x', w.x, 'y', w.y, 'dir', w.dir,
          'type', w.type, 'material', w.material, 'needed', w.needed, 'total', w.total)
          order by w.level, w.dir, w.x, w.y)
        from wall w
        where w.world_id = p_world
          and greatest(abs(w.x + 0.5 - p.x), abs(w.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
      'floors', coalesce((select jsonb_agg(jsonb_build_object(
          'building', f.building, 'level', f.level, 'x', f.x, 'y', f.y,
          'material', f.material, 'kind', f.kind, 'facing', f.facing,
          'needed', f.needed, 'total', f.total) order by f.level, f.x, f.y)
        from floor_tile f
        where f.world_id = p_world
          and greatest(abs(f.x + 0.5 - p.x), abs(f.y + 0.5 - p.y)) <= p_range), '[]'::jsonb)),
    /*
     * And the slabs, which are not buildings and do not go in with them: a
     * foundation is ground somebody poured, and the browser lays it beside the
     * terrain rather than inside a house.
     */
    'foundations', coalesce((select jsonb_agg(jsonb_build_object(
        'id', fo.id, 'x', fo.x, 'y', fo.y, 'top', fo.top,
        'needed', fo.needed, 'total', fo.total) order by fo.id)
      from foundation fo
      where fo.world_id = p_world
        and greatest(abs(fo.x + 0.5 - p.x), abs(fo.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    'nextFoundationId', coalesce((select max(fo.id) + 1 from foundation fo where fo.world_id = p_world), 1)) end;
end $fn$;
select private.lock_doors();
