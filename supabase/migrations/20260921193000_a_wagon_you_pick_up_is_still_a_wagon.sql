-- A wagon you picked up came back as `furniture_wagon`, which is not a thing.
--
-- Reported: "picking up a wagon turned it into this now I can't place it
-- again", with a pack holding one furniture_wagon under OTHER.
--
-- `perform_fire` handles the three pick-ups, and for furniture it built the
-- definition to hand back by gluing 'furniture_' onto the piece's `sub`. The
-- catalogue has no such definition -- a wagon is 'wagon' -- so the row that
-- went into the pack named nothing, and the browser would not set it down
-- because it asks `isFurniture` of that name.
--
-- Two things here: the function stops gluing the prefix on, and every row
-- already made that way is renamed to the piece it was meant to be. Only rows
-- whose stripped name is a real piece are touched, so a definition that
-- honestly begins with those ten letters is left alone.

CREATE OR REPLACE FUNCTION public.perform_fire(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p placed; it item; sz int[]; ax int; ay int; per double precision; room double precision;
        fits int; whole int; sub text; made bigint; back text;
begin
  if p_action = 'build_campfire' then
    ax := least(subtiles() - 2, greatest(0, (p_target->>'sx')::int));
    ay := least(subtiles() - 2, greatest(0, (p_target->>'sy')::int));
    if not consume(p_world, p_uid, 'shaft', 2) then return; end if;
    insert into placed (world_id, kind, x, y, sx, sy, cx, cy, fuel, made_by)
    values (p_world, 'campfire', (p_target->>'x')::int, (p_target->>'y')::int, ax, ay,
            (p_target->>'x')::int + (ax + 1.0) / subtiles(), (p_target->>'y')::int + (ay + 1.0) / subtiles(),
            120, p_uid);
    perform tell(p_world, p_uid, 'You lay a campfire from 2 shafts. Light it, or feed it more wood first.', 'event');
    perform land_announce(p_world, (p_target->>'x')::int, (p_target->>'y')::int);
    return;
  end if;

  if p_action in ('place_smelter', 'place_furniture', 'place_kiln') then
    select * into it from item where id = target_item(p_target);
    -- A piece stands there as whatever it was in the pack. This read the def
    -- through replace(it.def, 'furniture_', '') for as long as the pick-up put
    -- that prefix on, which meant the two halves disagreed about what an item
    -- is called and only one of them ever said so. Neither does now.
    sub := case when p_action = 'place_furniture' then it.def end;
    -- Which way it faces, which is the browser's to say and south when it says nothing.
    back := case when p_target->>'facing' in ('n', 'e', 's', 'w') then p_target->>'facing' else 's' end;
    sz := placed_size(case p_action when 'place_smelter' then 'smelter'
                                    when 'place_kiln' then 'kiln' else 'furniture' end, sub, back);
    ax := least(subtiles() - sz[1], greatest(0, coalesce((p_target->>'sx')::int, 0)));
    ay := least(subtiles() - sz[2], greatest(0, coalesce((p_target->>'sy')::int, 0)));
    /*
     * The quality, and -- new here -- the rarity and the wood.
     *
     * A piece set down used to reach the ground with nothing but its quality.
     * Its rarity went in the bin, so a rare chest was a rare chest right up
     * until somebody put it in a room and then it was a chest; and its wood
     * went with it, so an oak chest and a pine one were the same chest the
     * moment they were standing. Both are on the item being consumed here,
     * and both come across now.
     */
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, facing, rare, material)
    values (p_world, case p_action when 'place_smelter' then 'smelter'
                                   when 'place_kiln' then 'kiln' else 'furniture' end, sub,
            (p_target->>'x')::int, (p_target->>'y')::int, ax, ay,
            (p_target->>'x')::int + (ax + sz[1] / 2.0) / subtiles(),
            (p_target->>'y')::int + (ay + sz[2] / 2.0) / subtiles(),
            it.ql, p_uid, back, it.rare, it.extra)
    returning id into made;
    delete from item where id = it.id;
    perform tell(p_world, p_uid, 'You set the ' ||
      lower(coalesce((select name from furniture_def where id = sub),
        case when p_action = 'place_kiln' then 'kiln' else 'smelter' end)) || ' down.', 'event');
    perform land_announce(p_world, (p_target->>'x')::int, (p_target->>'y')::int);
    return;
  end if;

  perform placed_settle(nullif(p_target->>'id', '')::bigint);
  p := target_placed(p_world, p_target);
  if p.id is null then return; end if;

  if p_action in ('light_campfire', 'light_smelter', 'light_kiln') then
    update placed set lit = true, since = now() where id = p.id;
    if p_action = 'light_campfire' then perform journal_note(p_world, p_uid, 'fire'); end if;
    perform tell(p_world, p_uid, 'The kindling catches and the ' || p.kind || ' burns. It has '
      || burns_for(p.fuel) || ' of fuel.', 'event');
  elsif p_action in ('put_out_campfire', 'damp_smelter', 'damp_kiln') then
    update placed set lit = false, since = now() where id = p.id;
    perform tell(p_world, p_uid, 'You smother the fire. The wood is saved for later.', 'event');
  elsif p_action in ('fuel_campfire', 'fuel_smelter', 'fuel_kiln') then
    select * into it from item
      where world_id = p_world and holder = 'player' and holder_uid = p_uid
        and (id = target_item(p_target) or fuel_value(def) is not null)
      order by (id = target_item(p_target)) desc limit 1;
    per := fuel_value(it.def);
    room := greatest(0, fire_capacity() - p.fuel);
    /*
     * How many you asked for, which this never read.
     *
     * Reported as "attempting to feed one coal to a smelter puts four coal
     * in". The menu offers one or all and sends the count either way; this
     * fed as much as would fit whatever it was told, so a firebox with room
     * in it swallowed the whole pile on a single "one". The browser has read
     * the count since fuelling was written.
     */
    fits := greatest(1, least(least(coalesce((p_target->>'count')::int, 1), it.count),
                              ceil(room / per)::int));
    if not consume(p_world, p_uid, it.def, fits, it.id) then return; end if;
    update placed set fuel = least(fire_capacity(), p.fuel + per * fits), since = now() where id = p.id;
    perform tell(p_world, p_uid, 'You feed ' || case when fits > 1 then fits || ' × ' else 'a ' end
      || lower((select name from item_def where id = it.def)) || ' to the fire. '
      || burns_for(least(fire_capacity(), p.fuel + per * fits)) || ' of fuel.', 'event');
  elsif p_action in ('take_ashes_fire', 'take_ashes_smelter', 'take_ashes_kiln') then
    whole := floor(p.ash)::int;
    update placed set ash = p.ash - whole, since = now() where id = p.id;
    perform give(p_world, p_uid, 'ash', whole, 20);
    perform tell(p_world, p_uid, 'You rake ' || whole || case when whole = 1 then ' lot' else ' lots' end
      || ' of ashes out of the ' || p.kind || '. (QL 20)', 'event');
  elsif p_action = 'take_apart_campfire' then
    -- Coal burns but is never got back, so a pile of logs cannot be turned
    -- into coal by rebuilding the fire.
    delete from placed where id = p.id;
    perform give(p_world, p_uid, 'shaft', 2, 20);
    perform tell(p_world, p_uid, 'You take the campfire apart and save what will burn again.', 'event');
    perform land_announce(p_world, p.x, p.y);
  elsif p_action = 'turn_furniture' then
    -- A quarter turn to the right, walked to the nearest spot the turned block fits.
    back := turned_facing(p.facing, 1);
    sz := placed_size(p.kind, p.sub, back);
    ax := least(subtiles() - sz[1], greatest(0, p.sx));
    ay := least(subtiles() - sz[2], greatest(0, p.sy));
    update placed set facing = back, sx = ax, sy = ay,
        cx = p.x + (ax + sz[1] / 2.0) / subtiles(), cy = p.y + (ay + sz[2] / 2.0) / subtiles()
      where id = p.id;
    perform tell(p_world, p_uid, 'You turn the ' || lower(placed_name(p)) || ' to face ' || side_name(back) || '.', 'event');
    perform land_announce(p_world, p.x, p.y);

  elsif p_action in ('pick_up_smelter', 'pick_up_furniture', 'pick_up_kiln') then
    /*
     * What goes back in the pack is the thing's own definition, which for a
     * piece of furniture is its `sub` and nothing else.
     *
     * It used to be 'furniture_' || p.sub. There is no such item: the
     * catalogue calls a wagon a wagon, so picking one up put a row in your
     * pack with a definition nothing has ever heard of. It showed as its own
     * id under OTHER, weighed whatever the fallback weighs, and could not be
     * set down again, because the browser asks `isFurniture` of the id it is
     * holding and the answer was no. The wagon was not lost, but it was not a
     * wagon either.
     *
     * The other half of the pair hid it: `place_furniture` reads its `sub`
     * with replace(it.def, 'furniture_', ''), so it would have accepted the
     * broken id perfectly well and nothing on this side ever complained.
     */
    back := case p.kind when 'smelter' then 'smelter' when 'kiln' then 'kiln'
                        else p.sub end;
    delete from placed where id = p.id;
    -- And back the same way: what it stood there as is what goes in the pack.
    -- `give` has taken a material and a rarity since the day it was written.
    perform give(p_world, p_uid, back, 1, p.ql, p.material, p.rare);
    perform tell(p_world, p_uid, 'You take up the ' || lower(coalesce(p.sub, p.kind)) || '.', 'event');
    perform land_announce(p_world, p.x, p.y);
  end if;
end $function$;

/*
 * And the ones already in people's packs, chests and carts.
 *
 * Anything called furniture_<x> where <x> is a real piece is that piece: it
 * was made by the bug above and by nothing else, since no recipe and no other
 * hand ever writes that name. The join to `furniture_def` is what keeps this
 * honest -- a definition that merely starts with those ten letters and is not
 * a piece is left exactly as it is.
 */
update item i
   set def = f.id
  from furniture_def f
 where i.def = 'furniture_' || f.id;
