-- Everything the island has put on the ground, which the browser never asked for.
--
-- "Placed campfire doesn't show." It was there — the log said "You lay a
-- campfire from 2 shafts", and the island had the row. Nothing under `src/`
-- has ever read `placed`, so on a live island every campfire, smelter, kiln,
-- anvil, work post, trap and stick of furniture anybody has ever set down is
-- in Postgres and invisible. So is every crate, and so is the settlement
-- itself: its token, its crate and the square of ground it owns.
--
-- The same shape as the wildlife, which had the same bug for the same reason —
-- and this answers the same way. One call, everything within sight, rather
-- than nine subscriptions to nine tables:
--
--   * The fires are worked out on reading. `fuel` is what was in a thing when
--     `since` was stamped, so a lit fire that nobody has touched for ten
--     minutes has burned ten minutes of it — and the browser must be told what
--     is true now, not what was written down then.
--   * The kinds are sent as they are. What a campfire *is* the browser already
--     knows; what it needs is where, how much is in it and whether it is lit.
--   * Range, because a 4096 island's worth of everything anybody ever built is
--     not what somebody standing in a field needs.

create or replace function rpc_ground(p_world uuid, p_range double precision default 40)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); p player;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  return jsonb_build_object(
    /*
     * The row itself, less what is nobody's business.
     *
     * Written out column by column this would have to be edited every time the
     * island learns something new about a thing on the ground — and it has
     * learnt eleven since the table was made: what a barrel holds, how far
     * gone a post is, what is baited in a trap, who is pulling a cart. A row
     * with the private columns taken off cannot fall behind that.
     */
    'placed', coalesce((select jsonb_agg(
        (to_jsonb(pl) - 'world_id' - 'made_by' - 'since' - 'made_at' - 'cx' - 'cy')
        -- The fires, worked out now rather than when somebody last looked.
        || jsonb_build_object('fuel', placed_fuel(pl), 'ash', placed_ash(pl),
                              'lit', placed_lit(pl), 'mine', coalesce(pl.made_by = me, false))
        order by pl.id)
      from placed pl
      where pl.world_id = p_world
        and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= p_range), '[]'::jsonb),
    'crates', coalesce((select jsonb_agg((to_jsonb(c) - 'world_id') order by c.id)
      from crate c
      where c.world_id = p_world
        and greatest(abs(c.x + 0.5 - p.x), abs(c.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    -- The settlement, whether or not it is ours: a token in the ground and a
    -- square of land somebody owns are things you can see from outside them.
    'deed', (select jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level,
        'mine', coalesce(d.founded_by = me, false))
      from deed d where d.world_id = p_world));
end $$;

select private.lock_doors();

/**
 * And a refusal that says whose settlement is in the way.
 *
 * "Cant place a deed despite having a stake." The old words were "You already
 * hold a settlement. Disband it first." — which on a shared island is a lie
 * whenever the settlement is somebody else's, and a dead end either way,
 * because there is nothing to disband and nothing to say so.
 *
 * The rule itself has not changed and needs to: `deed` is keyed on `world_id`
 * alone, so there is one settlement per island for ever, and on the one island
 * everybody comes ashore on that is first-come-and-that-is-that. Putting a
 * settlement behind each person's own name means re-emitting every function
 * that reads `deed`, which is a piece of work in its own right and not one to
 * bury in a bug fix. Until then this at least tells the truth, and the browser
 * now draws the settlement that is in the way, so it is a thing you can see
 * rather than a sentence you cannot act on.
 */
create or replace function deed_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
  returns text language plpgsql stable as $$
declare p player; tx int; ty int; radius int := 5; other deed;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  tx := floor(p.x)::int; ty := floor(p.y)::int;
  select * into other from deed where world_id = p_world;
  if found then
    if other.founded_by is not distinct from p_uid then
      return 'You already hold a settlement. Disband it first.';
    end if;
    return other.name || ' already stands on this island, and an island holds one settlement. '
        || 'Come ashore on another, or ask whoever holds it.';
  end if;
  if pack_count(p_world, p_uid, 'deed_stake') <= 0 then return 'You have no deed stake.'; end if;
  if tx - radius < 0 or ty - radius < 0
     or not in_bounds(p_world, tx + radius, ty + radius) then
    return 'Too close to the edge of the world.';
  end if;
  if has_water(p_world, tx, ty) then return 'The token must stand on dry land.'; end if;
  if not passable(p_world, tx, ty) then return 'The token needs a clear tile.'; end if;
  return null;
end $$;

select private.lock_doors();
