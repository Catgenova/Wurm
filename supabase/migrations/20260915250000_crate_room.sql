-- A deed crate that takes no for an answer too easily.
--
-- The live run founds a settlement on a fresh island every time and then asks
-- whether the deed crate is standing beside the token. It has always passed
-- and this time it did not — "0 crates, 0 of them the settlement's" — on an
-- island rolled from a different seed.
--
-- `place_deed_crate` looked at five spots: east, south, west, north, and
-- south-east. If all five were water, rock, too steep, inside a building or
-- already taken, it gave up and the settlement had no crate at all. On a token
-- planted in a clearing with trees close on four sides, or on a shelf above
-- the water, five is not many — and the player is left without the one
-- container every worker carries its load to, with nothing said about why.
--
-- The same five first, in the same order, so that every settlement that would
-- have got a crate gets it in exactly the spot it always did. Only when all
-- five are refused does it look further, out to three tiles, nearest first. A
-- crate at the token's elbow is what it is for; one three tiles off is better
-- than none.
create or replace function place_deed_crate(p_world uuid, p_uid uuid) returns integer
  language plpgsql as $$
declare d deed; spot record; new_id int;
begin
  select * into d from deed where world_id = p_world and founded_by = p_uid;
  if not found or (deed_crate(p_world, p_uid)).id is not null then return null; end if;
  select gx, gy into spot from (values (1, 0), (0, 1), (-1, 0), (0, -1), (1, 1)) as v(dx, dy),
    lateral (select d.x + v.dx as gx, d.y + v.dy as gy) q
  where in_bounds(p_world, q.gx, q.gy) and passable(p_world, q.gx, q.gy)
    and not has_water(p_world, q.gx, q.gy)
    and building_at(p_world, q.gx, q.gy) is null
    and not exists (select 1 from crate cr where cr.world_id = p_world and cr.x = q.gx and cr.y = q.gy)
  limit 1;
  if not found then
    -- Hemmed in. Anywhere within three tiles, closest first, rather than none.
    select gx, gy into spot from (
      select d.x + dx as gx, d.y + dy as gy,
             greatest(abs(dx), abs(dy)) as ring, abs(dx) + abs(dy) as reach
        from generate_series(-3, 3) dx, generate_series(-3, 3) dy
       where not (dx = 0 and dy = 0)) q
    where in_bounds(p_world, q.gx, q.gy) and passable(p_world, q.gx, q.gy)
      and not has_water(p_world, q.gx, q.gy)
      and building_at(p_world, q.gx, q.gy) is null
      and not exists (select 1 from crate cr where cr.world_id = p_world and cr.x = q.gx and cr.y = q.gy)
    order by q.ring, q.reach, q.gx, q.gy
    limit 1;
    if not found then return null; end if;
  end if;
  select coalesce(max(id), 0) + 1 into new_id from crate where world_id = p_world;
  insert into crate (world_id, id, kind, x, y, sx, sy, deed, made_by)
  values (p_world, new_id, 'plank', spot.gx, spot.gy, 1, 1, true, p_uid);
  return new_id;
end $$;

select private.lock_doors();
