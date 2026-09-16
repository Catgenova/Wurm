-- How deep the soil is, which the island has never told anybody.
--
-- Reported from the island: *"i've dug 14 dirt out of a tile and it's still
-- showing me as no closer to reaching rock"*, and then, exactly: *"the number
-- above water went down appropriately but not the number above rock"*.
--
-- Both halves of that are one hole. A square's change is announced on
-- `tile_change`, which carries what it is, what is growing on it, and its four
-- corner **heights** — and nothing else. There is no soil on it. So a dig
-- lowers the ground on both sides, turns the tile to dirt on both sides, and
-- takes a spadeful out of the soil **on the island only**. The browser's soil
-- depth is whatever the generator worked out from the seed the day somebody
-- came ashore, for ever.
--
--     land_announce   tile, data, corners            -- four heights
--     layChange       setHeight ×4, setTile          -- and nothing about dirt
--
-- Fourteen was the generator's answer, and it was going to stay fourteen
-- however long anybody dug. The rule itself was never wrong: `act_perform`
-- does `land_set_dirt(cx, cy, land_dirt(cx, cy) - 1)` on every spadeful, and
-- `perform_dig`, `raise_corner` and `worker_do` all move it too. The island
-- knew. Nothing asked, and nothing was sent.
--
-- ## What it cost besides the number
--
-- The number is the least of it. The browser reads its own soil to decide
-- things:
--
--   * `dig`'s own refusal — *"That corner is bare rock. Only a pickaxe will
--     take it lower"* — never fires, so a browser offers a dig the island then
--     refuses, over and over on a corner that has been down to rock for an
--     hour.
--   * `exposeRock` never runs, so a corner dug through to the rock does not
--     turn to rock on screen.
--   * `bedrockAt` reads the surface less the soil, so a prospector's reading
--     and the mining depth are worked out against rock that is not where the
--     browser thinks it is.
--
-- ## The fix
--
-- The four corner soils, beside the four corner heights, on the same row. A
-- second column rather than four more slots on `corners`, so a browser reading
-- a row written before today sees an empty array and leaves its own reckoning
-- alone — which is the right answer for a row that predates the column.
--
-- `compact_changes` keeps the newest row per square and needs no telling: the
-- newest row is the one with the soil on it.

alter table tile_change add column if not exists soil integer[] not null default '{}';

/**
 * Say a square changed — everything about it that a browser draws or reasons
 * from.
 *
 * `soil` in the same clockwise order as `corners`, so the two are read
 * together and cannot come apart.
 */
create or replace function land_announce(p_world uuid, p_x integer, p_y integer) returns void
 language sql as $fn$
  insert into tile_change (world_id, x, y, region, tile, data, corners, soil)
  values (p_world, p_x, p_y, region_of(p_x, p_y),
          land_tile(p_world, p_x, p_y), land_data(p_world, p_x, p_y),
          array[land_height(p_world, p_x, p_y), land_height(p_world, p_x + 1, p_y),
                land_height(p_world, p_x + 1, p_y + 1), land_height(p_world, p_x, p_y + 1)],
          array[land_dirt(p_world, p_x, p_y), land_dirt(p_world, p_x + 1, p_y),
                land_dirt(p_world, p_x + 1, p_y + 1), land_dirt(p_world, p_x, p_y + 1)])
$fn$;

select private.lock_doors();
