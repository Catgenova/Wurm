-- A spadeful you could not put down
--
-- Dirt weighs twenty kilos. Three of them is sixty, which is most of what a
-- body can carry, and the island has had one thing to say about that since
-- the rule was written:
--
--     Dirt goes back in a hole, not on the grass.
--
-- It is a tidy sentiment and it made a trap. Dirt could leave the pack by
-- exactly one door — `drop_dirt`, the terraforming one, which does not put
-- the spadeful down so much as pack it into a corner and bring the ground up
-- a tenth of a metre. That door has its own refusals, and they are good ones:
-- not under a building, not past the slope the digging skill will hold, and
-- not on ground that belongs to somebody else. So a body standing on a
-- stranger's deed with three spadefuls in the pack had no door at all.
--
-- And the crawl, added this same week, walked straight into it. Overburdened
-- movement is no longer a wall but five percent of a walk, and the message
-- that comes with it says, in as many words:
--
--     You can still work what is beside you, or put something down.
--
-- The heaviest thing in the pack, and the one most likely to have put you
-- over, was the one thing that sentence was not true of.
--
-- So dirt drops like anything else drops: on the tile under your feet, as the
-- heap it always was, to be picked up again by whoever wants it. The
-- terraforming door is untouched and still says what it does — the item card
-- now names both, because there are now two honest answers to "what do I do
-- with this?" and the player picks.
--
-- Nothing else in `hands_refusal` moves: a thing set aside is still set
-- aside, and a thing that is gone is still gone.

CREATE OR REPLACE FUNCTION public.hands_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare it item; v_x int; v_y int; d action_def; p player;
begin
  if p_action in ('drop', 'examine_item', 'lock_item', 'unlock_item') then
    select * into it from item where world_id = p_world and id = target_item(p_target)
      and holder = 'player' and holder_uid = p_uid;
    if not found then return 'It is gone.'; end if;
    if p_action = 'drop' then
      if it.locked then return 'You have set that aside. Put it back in the pack first.'; end if;
    elsif p_action = 'lock_item' and it.locked then
      return 'That is already set aside.';
    elsif p_action = 'unlock_item' and not it.locked then
      return 'That is not set aside.';
    end if;
    return null;
  end if;

  if p_action in ('pick_up', 'pick_up_all', 'examine') then
    v_x := (p_target->>'x')::int; v_y := (p_target->>'y')::int;
    if v_x is null or v_y is null then return 'There is nothing there.'; end if;
    if not in_bounds(p_world, v_x, v_y) then return 'That is off the edge of the world.'; end if;
    -- These three answer for their own reach, because the dispatcher sends a
    -- hands action here before it has asked how far away anything is.
    select * into d from action_def where id = p_action;
    select * into p from player where world_id = p_world and uid = p_uid;
    if not in_reach(p.x, p.y, p_target, d.corner, d.range) then
      return 'You are too far away from that.';
    end if;
    if p_action = 'pick_up' and not exists (select 1 from item i where i.world_id = p_world
         and i.holder = 'ground' and i.gx = v_x and i.gy = v_y) then
      return 'There is nothing there any more.';
    end if;
    if p_action = 'pick_up_all' and sweepable(p_world, v_x, v_y) = 0 then
      return 'There is nothing lying about here.';
    end if;
    return null;
  end if;

  if p_action = 'name_thing' then
    if p_target->>'kind' = 'crate' then
      if not crate_yours(p_world, p_uid, (p_target->>'id')::int) then
        return 'That is not yours to name.';
      end if;
      if not exists (select 1 from crate where world_id = p_world and id = (p_target->>'id')::int) then
        return 'That is not there any more.';
      end if;
    elsif p_target->>'kind' = 'furniture' then
      if not exists (select 1 from placed where world_id = p_world and id = (p_target->>'id')::bigint
                       and kind = 'furniture') then
        return 'That is not there any more.';
      end if;
    else
      return 'That is not something that takes a name.';
    end if;
    return null;
  end if;
  return null;
end $function$;

select private.lock_doors();
