/*
 * Wagons up wide staircases, indoors.
 *
 * A wagon or a large cart is driven up a finished wide staircase from its
 * foot, through a doorway wide enough for wheels, onto the storey over it,
 * and on the building's finished floors up there; a single staircase, a
 * ladder and a roof take no wheels (`driveStorey` in the browser, which walks
 * the driver; the island trusts the walk to the share it allows, as it does
 * on the ground). The wagon stands on the storey it was driven to, its team
 * with it: so nobody takes the reins of one from another storey, and a team
 * goes into and out of the traces on the ground floor and nowhere else.
 */
set local lock_timeout = '3s';

/* Why a team is not put into or taken out of the traces of a vehicle a storey up, or null on the ground (`tracesStoreyRefusal`). */
create or replace function traces_storey_refusal(p placed)
  returns text language sql stable as $$
  select case when coalesce(p.level, 0) > 0
              then 'Bring the ' || lower(placed_name(p)) || ' down to the ground floor first: a team goes into and out of the traces on the ground.'
         end
$$;

CREATE OR REPLACE FUNCTION public.ride_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; p placed; v vehicle_def; want text; n int; v_aboard bigint; v_shut text;
begin
  if ride_beast_action(p_action) then
    perform creature_settle(p_world, (p_target->>'id')::int);
    c := target_creature(p_world, p_target);
    if c.world_id is null then return 'It is gone.'; end if;
    select * into d from species_def where id = c.species;
    if c.mode = 'stored' then return c.name || ' is in a creature crate. Let it out first.'; end if;

    if p_action = 'tack_creature' then
      if not creature_in_reach(p_world, p_uid, c) then return 'Stand next to ' || c.name || '.'; end if;
      if not (age_row(c.born, old_of(c))).works then
        return c.name || ' is not grown. Nothing that young takes a saddle.';
      end if;
      want := tack_missing(p_world, p_uid);
      if want is not null then return 'You need ' || want || '.'; end if;

    elsif p_action = 'shoe_creature' then
      -- Shoes, in the words the browser uses: a mount, grown, within reach,
      -- and four shoes and a mallet in the pack.
      if d.mount is null then return 'Only a mount takes shoes.'; end if;
      if not creature_in_reach(p_world, p_uid, c) then return 'Stand next to ' || c.name || '.'; end if;
      if not (age_row(c.born, old_of(c))).works then
        return c.name || ' is not grown. Nothing that young takes a shoe.';
      end if;
      if pack_count(p_world, p_uid, 'horseshoe') < shoes_per_mount()::int or pack_count(p_world, p_uid, 'mallet') < 1 then
        return 'You need four horseshoes and a mallet.';
      end if;

    elsif p_action = 'untack_creature' then
      if not creature_in_reach(p_world, p_uid, c) then return 'Stand next to ' || c.name || '.'; end if;

    elsif p_action = 'mount_creature' then
      if not c.tacked then return c.name || ' has no saddle or bridle on.'; end if;
      if not (age_row(c.born, old_of(c))).works then return c.name || ' is not grown enough to carry you.'; end if;
      if c.hitched_to is not null then return c.name || ' is in the traces.'; end if;
      if not creature_in_reach(p_world, p_uid, c) then return 'Stand next to ' || c.name || '.'; end if;
      if (driving(p_world, p_uid)).id is not null then
        return 'Get down off what you are driving first.';
      end if;
      if (select aboard from player where world_id = p_world and uid = p_uid) is not null then
        return 'Step ashore first.';
      end if;

    elsif p_action = 'hitch_creature' then
      -- Asked of one already in harness, which a browser that could not see
      -- the traces was offering: `hitch_up` said no and nobody heard why.
      if c.hitched_to is not null then return c.name || ' is already in the traces.'; end if;
      if c.rider is not null then return c.name || ' has a rider on it.'; end if;
      p := vehicle_for(p_world, p_uid, c);
      if p.id is null then return 'There is no cart or wagon here with an empty yoke.'; end if;
      if traces_storey_refusal(p) is not null then return traces_storey_refusal(p); end if;
      if not near_piece(p_world, p_uid, p) then
        return 'Stand by the ' || lower(placed_name(p)) || '.';
      end if;
      if not creature_in_reach(p_world, p_uid, c, 4) then
        return c.name || ' is too far off. Call it over first.';
      end if;
      if not (age_row(c.born, old_of(c))).works then
        return c.name || ' is not grown. A yearling is no use in the traces.';
      end if;
      if c.hunger < 0.15 then
        return c.name || ' is too hungry to pull anything. Feed it first.';
      end if;

    elsif p_action = 'unhitch_creature' then
      if c.hitched_to is null then return c.name || ' is not in the traces.'; end if;
      select * into p from placed where world_id = p_world and id = c.hitched_to;
      if p.id is not null and traces_storey_refusal(p) is not null then return traces_storey_refusal(p); end if;
    end if;
    return null;
  end if;

  -- The rest are asked of a thing standing on the ground.
  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint
    and kind = 'furniture';
  if not found then return 'It is gone.'; end if;

  if p_action = 'pull_cart' then
    if not near_piece(p_world, p_uid, p) then return 'Stand beside the shafts.'; end if;
    v_shut := lock_refusal(p_world, p_uid, p.lock, p.x, p.y);
    if v_shut is not null then return v_shut; end if;
    if exists (select 1 from placed q where q.world_id = p_world and q.puller = p_uid and q.id <> p.id) then
      return 'You already have a cart behind you.';
    end if;

  elsif p_action = 'board_vehicle' then
    -- Nobody takes the reins or the helm out of the hands of somebody who is here.
    if helm_held(p_world, p, p_uid) then
      return case when is_boat(p) then 'Somebody else has the helm.' else 'Somebody else has the reins.' end;
    end if;
    -- Aboard her already, the helm is a step away; aboard anything else, it is not yours to reach. And the
    -- helm of a hull whose helmsman has gone away is taken over from her deck and from nowhere else, so
    -- that they have a place to be put in; the reins of a wagon are anybody's who is beside it.
    select aboard into v_aboard from player where world_id = p_world and uid = p_uid;
    if v_aboard is not null and v_aboard <> p.id then return 'You are aboard another vessel. Step ashore first.'; end if;
    if p.driver is not null and p.driver <> p_uid and is_boat(p) and v_aboard is distinct from p.id then
      return 'Somebody else has the helm.';
    end if;
    -- A wagon driven up a wide staircase is beside you only on its own storey.
    if v_aboard is null and (not near_piece(p_world, p_uid, p)
        or greatest(0, coalesce(p.level, 0)) <> greatest(0, (select level from player where world_id = p_world and uid = p_uid))) then
      return 'Stand beside it first.';
    end if;
    if (driving(p_world, p_uid)).id is not null then return 'You are already driving something.'; end if;
    -- A padlock on her keeps her helm, or the reins, to whoever has its key.
    v_shut := lock_refusal(p_world, p_uid, p.lock, p.x, p.y);
    if v_shut is not null then return v_shut; end if;
    -- A hull asks nothing but that she is still floating.
    if is_boat(p) then
      if not launch_spot(p_world, p.sub, p.x, p.y) then return 'She is aground. Push her off first.'; end if;
      return null;
    end if;
    select * into v from vehicle_def where id = p.sub;
    if found then
      n := team_size(p_world, p.id);
      if n < v.needs then
        return case when n = 0
          then 'Nothing is in the yokes. ' || placed_name(p) || ' needs ' || v.needs || ' to move.'
          else 'Only ' || n || ' of ' || v.yokes || ' yokes are filled. It needs ' || v.needs || '.' end;
      end if;
    end if;

  elsif p_action = 'board_passenger' then
    n := boat_places(p);
    if n = 0 then return 'She carries nobody but whoever steers her.'; end if;
    select aboard into v_aboard from player where world_id = p_world and uid = p_uid;
    if v_aboard = p.id then return 'You are aboard her already.'; end if;
    if v_aboard is not null then return 'You are aboard another vessel. Step ashore first.'; end if;
    if (driving(p_world, p_uid)).id is not null then return 'You are already driving something.'; end if;
    if (mount_of(p_world, p_uid)).id is not null then return 'Get down off your mount first.'; end if;
    if not near_piece(p_world, p_uid, p) then return 'Stand beside her first.'; end if;
    v_shut := lock_refusal(p_world, p_uid, p.lock, p.x, p.y);
    if v_shut is not null then return v_shut; end if;
    if not launch_spot(p_world, p.sub, p.x, p.y) then return 'She is aground. Push her off first.'; end if;
    if (select count(*) from player r where r.world_id = p_world and r.aboard = p.id) >= n then
      return 'Every one of her ' || n || ' places is taken.';
    end if;

  elsif p_action = 'leave_passenger' then
    if (select aboard from player where world_id = p_world and uid = p_uid) is distinct from p.id then
      return 'You are not aboard her.';
    end if;
    if not exists (select 1 from player pl, lateral shore_near(p_world, pl.x, pl.y)
                   where pl.world_id = p_world and pl.uid = p_uid) then
      return 'There is no shore within reach. Wait until she comes in close.';
    end if;

  elsif p_action = 'leave_vehicle' then
    if is_boat(p) and not exists (select 1 from player pl, lateral shore_near(p_world, pl.x, pl.y)
                                  where pl.world_id = p_world and pl.uid = p_uid) then
      return 'There is no shore within reach. Bring her in first, or swim for it.';
    end if;

  elsif p_action = 'unhitch_team' then
    if not near_piece(p_world, p_uid, p) then return 'Stand beside it first.'; end if;
    if traces_storey_refusal(p) is not null then return traces_storey_refusal(p); end if;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.drag_along(p_world uuid, p_uid uuid, p_x double precision, p_y double precision)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_tx int := floor(p_x)::int; v_ty int := floor(p_y)::int;
begin
  update creature set from_x = p_x, from_y = p_y, to_x = p_x, to_y = p_y,
      leg_at = now(), leg_ends = now(), settled_at = now()
    where world_id = p_world and rider = p_uid;

  update placed set x = v_tx, y = v_ty, cx = p_x, cy = p_y,
      -- A wagon goes up a wide staircase with its driver, and stands on the storey they drove it to.
      level = case when driver = p_uid and not is_boat(placed)
                   then greatest(0, (select pl.level from player pl where pl.world_id = p_world and pl.uid = p_uid))
                   else level end
    where world_id = p_world and (puller = p_uid or driver = p_uid);

  -- And whoever is aboard her as a passenger goes where she goes.
  update player set x = p_x, y = p_y, level = 0, moved_at = now()
    where world_id = p_world and aboard in
      (select id from placed where world_id = p_world and driver = p_uid);

  update creature set from_x = p_x, from_y = p_y, to_x = p_x, to_y = p_y,
      leg_at = now(), leg_ends = now(), settled_at = now()
    where world_id = p_world and hitched_to in
      (select id from placed where world_id = p_world and driver = p_uid);
end $function$;

select private.lock_doors();
