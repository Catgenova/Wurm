/*
 * The Runestones take their ground, and a sitting beside one is worth more.
 *
 *   * The stones moved from the places circled on the map, a little inland,
 *     to the shore nearest each (`RUNESTONES`, `tools/runestone-spots.ts`),
 *     and on an island already standing somebody may have built, planted,
 *     dug or left something on those nine tiles, or be standing there. So
 *     `runestone_clear` takes back each stone's nine tiles on an island:
 *
 *       - every building with a tile, a wall, a floor, a column or a cellar
 *         on them goes whole -- its tiles, walls and fences, floors, roofs and
 *         stairs, columns and cellars, what lies in its cellars, and whatever
 *         is set down or stacked in crates on its upper storeys -- and so does
 *         any wall, fence, floor, column or cellar of nobody's building there;
 *       - every bridge or aqueduct with an end or a span on them, and every
 *         spring dug there with its pond, and every foundation;
 *       - everything set down there (furniture, fires, smelters, kilns,
 *         planters, posts, traps, carts, ships ...) with everything in it, and
 *         every crate with what is in it, and everything lying on the ground;
 *       - crops, water plants, a tree's notch, worn paths and the ground's
 *         greening clocks, and a mote swirl;
 *       - and the ground itself: on an island whose generated ground under
 *         the stones is held here (`runestone_ground`: the live island, seed
 *         `STONE_SEED` at 4096), every tile's kind, data and rock and every
 *         corner's height and soil that differs from it is put back, which
 *         undoes digging, levelling, paving, ploughing and a planted tree;
 *         its `tile_change` rows go, and each tile is announced afresh, as
 *         the keeper's clear announces a cleared pile, so a browser reads it.
 *
 *     Anybody or anything standing on the nine tiles is put on the first
 *     free tile beside the stone (`telestone_landing`), and a body that is
 *     here is told where it went, as a journey tells it. A settlement whose
 *     token stands there keeps everything but its place: the token moves to
 *     the same tile beside the stone. The migration runs it once on every
 *     island with stones on it.
 *
 *   * A sitting within `sit_stone_reach` tiles of a Runestone (of its nearest
 *     tile, centre to centre: `runestone_within`, the browser's
 *     `runestoneWithin`) is worth `sit_stone` times as much, meditation and
 *     Calm. `sit_place` takes the fact in the browser's order (`sitPlace`):
 *     after a swirl and before a spot sat at, multiplying the rest as every
 *     place multiplier does, and says `sit_stone_said`.
 *
 * `supabase/test/telestone.ts` builds on a stone's ground, clears it and
 * finds it gone; `supabase/test/meditation.ts` holds the sitting to the
 * browser's.
 */
set local lock_timeout = '3s';

/* ---- The ground under each stone, as it was generated --------------------------------------------- */

/**
 * The generated ground of each stone's sixteen corners and nine tiles, on an
 * island of seed `seed` and `size` tiles a side: a row a corner, which for
 * the nine whose tile is the stone's also holds that tile. Written by
 * `tools/runestone-spots.ts --ground` for the live island; the island cannot
 * work ground out from a seed, so this is what it puts back.
 */
create table if not exists runestone_ground (
  seed bigint not null,
  size int not null,
  x int not null,
  y int not null,
  tile int,
  data int,
  rock int,
  height int not null,
  dirt int not null,
  primary key (seed, size, x, y)
);
alter table runestone_ground enable row level security;
revoke all on runestone_ground from anon, authenticated;

insert into runestone_ground (seed, size, x, y, tile, data, rock, height, dirt) values
  (7, 4096, 2151, 2947, 0, 0, 0, 9, 11),
  (7, 4096, 2152, 2947, 0, 0, 6, 7, 11),
  (7, 4096, 2153, 2947, 0, 0, 0, 8, 11),
  (7, 4096, 2154, 2947, null, null, null, 8, 11),
  (7, 4096, 2151, 2948, 0, 0, 0, 6, 11),
  (7, 4096, 2152, 2948, 3, 0, 0, 4, 11),
  (7, 4096, 2153, 2948, 3, 0, 0, 4, 11),
  (7, 4096, 2154, 2948, null, null, null, 5, 11),
  (7, 4096, 2151, 2949, 0, 0, 0, 3, 11),
  (7, 4096, 2152, 2949, 3, 0, 0, 4, 11),
  (7, 4096, 2153, 2949, 8, 0, 0, 3, 11),
  (7, 4096, 2154, 2949, null, null, null, 3, 11),
  (7, 4096, 2151, 2950, null, null, null, 3, 12),
  (7, 4096, 2152, 2950, null, null, null, 4, 12),
  (7, 4096, 2153, 2950, null, null, null, 1, 11),
  (7, 4096, 2154, 2950, null, null, null, 1, 11),
  (7, 4096, 1605, 3003, 0, 0, 0, 6, 12),
  (7, 4096, 1606, 3003, 0, 0, 0, 5, 12),
  (7, 4096, 1607, 3003, 0, 0, 0, 5, 13),
  (7, 4096, 1608, 3003, null, null, null, 4, 14),
  (7, 4096, 1605, 3004, 5, 0, 0, 4, 12),
  (7, 4096, 1606, 3004, 3, 0, 0, 3, 13),
  (7, 4096, 1607, 3004, 3, 0, 0, 5, 13),
  (7, 4096, 1608, 3004, null, null, null, 4, 14),
  (7, 4096, 1605, 3005, 5, 0, 0, 6, 13),
  (7, 4096, 1606, 3005, 3, 0, 15, 3, 13),
  (7, 4096, 1607, 3005, 3, 0, 6, 3, 14),
  (7, 4096, 1608, 3005, null, null, null, 2, 14),
  (7, 4096, 1605, 3006, null, null, null, 3, 14),
  (7, 4096, 1606, 3006, null, null, null, 2, 14),
  (7, 4096, 1607, 3006, null, null, null, 3, 14),
  (7, 4096, 1608, 3006, null, null, null, 1, 14),
  (7, 4096, 2549, 2999, 17, 2, 0, 10, 14),
  (7, 4096, 2550, 2999, 0, 0, 4, 10, 15),
  (7, 4096, 2551, 2999, 0, 0, 6, 9, 15),
  (7, 4096, 2552, 2999, null, null, null, 7, 16),
  (7, 4096, 2549, 3000, 0, 0, 0, 9, 14),
  (7, 4096, 2550, 3000, 0, 0, 0, 8, 15),
  (7, 4096, 2551, 3000, 3, 0, 0, 5, 15),
  (7, 4096, 2552, 3000, null, null, null, 6, 16),
  (7, 4096, 2549, 3001, 0, 0, 0, 7, 14),
  (7, 4096, 2550, 3001, 3, 0, 0, 8, 15),
  (7, 4096, 2551, 3001, 3, 0, 0, 6, 15),
  (7, 4096, 2552, 3001, null, null, null, 6, 15),
  (7, 4096, 2549, 3002, null, null, null, 6, 14),
  (7, 4096, 2550, 3002, null, null, null, 5, 14),
  (7, 4096, 2551, 3002, null, null, null, 4, 15),
  (7, 4096, 2552, 3002, null, null, null, 3, 15),
  (7, 4096, 1461, 3181, 0, 0, 0, 12, 15),
  (7, 4096, 1462, 3181, 0, 0, 0, 12, 15),
  (7, 4096, 1463, 3181, 0, 0, 0, 10, 15),
  (7, 4096, 1464, 3181, null, null, null, 7, 15),
  (7, 4096, 1461, 3182, 0, 0, 0, 9, 15),
  (7, 4096, 1462, 3182, 16, 32, 0, 7, 15),
  (7, 4096, 1463, 3182, 0, 0, 0, 8, 15),
  (7, 4096, 1464, 3182, null, null, null, 8, 15),
  (7, 4096, 1461, 3183, 11, 0, 0, 6, 15),
  (7, 4096, 1462, 3183, 3, 0, 0, 6, 16),
  (7, 4096, 1463, 3183, 3, 0, 0, 6, 15),
  (7, 4096, 1464, 3183, null, null, null, 6, 16),
  (7, 4096, 1461, 3184, null, null, null, 5, 15),
  (7, 4096, 1462, 3184, null, null, null, 3, 16),
  (7, 4096, 1463, 3184, null, null, null, 4, 16),
  (7, 4096, 1464, 3184, null, null, null, 5, 16),
  (7, 4096, 2767, 3174, 0, 0, 0, 8, 14),
  (7, 4096, 2768, 3174, 0, 0, 6, 6, 15),
  (7, 4096, 2769, 3174, 0, 0, 0, 4, 15),
  (7, 4096, 2770, 3174, null, null, null, 3, 15),
  (7, 4096, 2767, 3175, 0, 0, 15, 8, 14),
  (7, 4096, 2768, 3175, 3, 0, 0, 5, 15),
  (7, 4096, 2769, 3175, 8, 0, 0, 2, 15),
  (7, 4096, 2770, 3175, null, null, null, 3, 15),
  (7, 4096, 2767, 3176, 0, 0, 0, 7, 14),
  (7, 4096, 2768, 3176, 3, 0, 0, 3, 15),
  (7, 4096, 2769, 3176, 3, 0, 0, 3, 15),
  (7, 4096, 2770, 3176, null, null, null, 4, 15),
  (7, 4096, 2767, 3177, null, null, null, 4, 14),
  (7, 4096, 2768, 3177, null, null, null, 3, 15),
  (7, 4096, 2769, 3177, null, null, null, 3, 15),
  (7, 4096, 2770, 3177, null, null, null, 1, 15)
on conflict do nothing;

/* ---- Taking it back ------------------------------------------------------------------------------- */

/**
 * Take back every stone's nine tiles on an island: what was built, set down,
 * grown or left there is gone, the ground is the generated ground again where
 * it is held, and whoever stood there stands beside the stone. What it did,
 * counted, for the test and for the log.
 */
create or replace function runestone_clear(p_world uuid) returns jsonb language plpgsql as $fn$
declare w world; s record; h int := stone_half()::int; x0 int; y0 int; x1 int; y1 int;
        v_b int[]; v_br bigint[]; v_pl bigint[]; v_cr int[]; v_l record; v_n int; v_t int; g record;
        v_touched int[] := '{}';  -- tiles to announce, as y * size + x
        v_out jsonb := '{}'::jsonb;
        v_any boolean; v_uids uuid[]; v_uid uuid;
begin
  select * into w from world where id = p_world;
  if w.id is null or w.size < stone_least() then return v_out; end if;
  for s in select * from runestone_centres(w.size) order by ord loop
    x0 := s.x - h; x1 := s.x + h; y0 := s.y - h; y1 := s.y + h;
    v_any := false; v_pl := null;

    -- Buildings with anything on the stone's tiles, whole.
    select array_agg(distinct b) into v_b from (
      select building b from building_tile where world_id = p_world and x between x0 and x1 and y between y0 and y1
      -- A wall of nobody's building (a fence) is building nought.
      union select building from wall where world_id = p_world and x between x0 and x1 and y between y0 and y1 and building <> 0
      union select building from floor_tile where world_id = p_world and x between x0 and x1 and y between y0 and y1 and building is not null
      union select building from building_column where world_id = p_world and x between x0 and x1 and y between y0 and y1 and building is not null
      union select building from cellar_tile where world_id = p_world and x between x0 and x1 and y between y0 and y1 and building is not null
    ) z where b is not null;
    if v_b is not null then
      v_any := true;
      v_touched := v_touched || array(select t.y * w.size + t.x from building_tile t where t.world_id = p_world and t.building = any(v_b));
      -- What stands or is stacked up its storeys, and what lies in its cellars, goes with it; whoever is up there comes down.
      v_pl := array(select p.id from placed p join building_tile t on t.world_id = p_world and t.building = any(v_b) and p.x = t.x and p.y = t.y
                     where p.world_id = p_world and coalesce(p.level, 0) > 0);
      delete from item i using crate c, building_tile t
       where i.world_id = p_world and i.holder = 'crate' and i.crate = c.id and c.world_id = p_world
         and t.world_id = p_world and t.building = any(v_b) and c.x = t.x and c.y = t.y and coalesce(c.level, 0) > 0;
      delete from crate c using building_tile t
       where c.world_id = p_world and t.world_id = p_world and t.building = any(v_b) and c.x = t.x and c.y = t.y and coalesce(c.level, 0) > 0;
      delete from item i using cellar_tile t
       where i.world_id = p_world and i.holder = 'cellar' and t.world_id = p_world and t.building = any(v_b) and i.gx = t.x and i.gy = t.y;
      update player p set level = 0 from building_tile t
       where p.world_id = p_world and t.world_id = p_world and t.building = any(v_b)
         and floor(p.x)::int = t.x and floor(p.y)::int = t.y and p.level <> 0;
      delete from wall where world_id = p_world and building = any(v_b);
      delete from floor_tile where world_id = p_world and building = any(v_b);
      delete from building_column where world_id = p_world and building = any(v_b);
      -- Its tiles and cellars go with the building itself.
      delete from building where world_id = p_world and id = any(v_b);
      v_out := jsonb_set(v_out, '{buildings}', to_jsonb(coalesce((v_out->>'buildings')::int, 0) + cardinality(v_b)));
    end if;
    -- And whatever is left there of nobody's building: a fence, a floor, a column, a cellar and what lies in it.
    delete from wall where world_id = p_world and x between x0 and x1 and y between y0 and y1;
    get diagnostics v_n = row_count; v_any := v_any or v_n > 0;
    delete from floor_tile where world_id = p_world and x between x0 and x1 and y between y0 and y1;
    get diagnostics v_n = row_count; v_any := v_any or v_n > 0;
    delete from building_column where world_id = p_world and x between x0 and x1 and y between y0 and y1;
    get diagnostics v_n = row_count; v_any := v_any or v_n > 0;
    delete from item where world_id = p_world and holder = 'cellar' and gx between x0 and x1 and gy between y0 and y1;
    get diagnostics v_n = row_count; v_any := v_any or v_n > 0;
    delete from cellar_tile where world_id = p_world and x between x0 and x1 and y between y0 and y1;
    get diagnostics v_n = row_count; v_any := v_any or v_n > 0;

    -- Bridges and aqueducts with an end or a span on it, whole.
    select array_agg(distinct id) into v_br from (
      select b.id from bridge b where b.world_id = p_world
         and ((b.ax between x0 and x1 and b.ay between y0 and y1) or (b.bx between x0 and x1 and b.by between y0 and y1))
      union select sp.bridge from bridge_span sp where sp.world_id = p_world and sp.x between x0 and x1 and sp.y between y0 and y1
    ) z;
    if v_br is not null then
      v_any := true;
      v_touched := v_touched || array(select sp.y * w.size + sp.x from bridge_span sp where sp.world_id = p_world and sp.bridge = any(v_br));
      delete from aqueduct_feed where world_id = p_world and bridge_id = any(v_br);
      delete from bridge_span where world_id = p_world and bridge = any(v_br);
      delete from bridge where world_id = p_world and id = any(v_br);
      v_out := jsonb_set(v_out, '{bridges}', to_jsonb(coalesce((v_out->>'bridges')::int, 0) + cardinality(v_br)));
    end if;
    -- A spring dug there, with its pond and what it feeds; a foundation.
    delete from spring where world_id = p_world and x between x0 and x1 and y between y0 and y1;
    get diagnostics v_n = row_count; v_any := v_any or v_n > 0;
    delete from foundation where world_id = p_world and x between x0 and x1 and y between y0 and y1;
    get diagnostics v_n = row_count; v_any := v_any or v_n > 0;

    -- Everything set down there, and up the storeys of a building gone, with everything in it (`item.placed`, `planter_crop`):
    -- nothing is hitched to it, trapped in it or tied to it after.
    v_pl := coalesce(v_pl, '{}') || array(select p.id from placed p where p.world_id = p_world
       and ((p.x between x0 and x1 and p.y between y0 and y1)
            or (floor(p.cx)::int between x0 and x1 and floor(p.cy)::int between y0 and y1)));
    v_pl := array(select distinct u from unnest(v_pl) u);
    if cardinality(v_pl) > 0 then
      v_any := true;
      update creature set hitched_to = null where world_id = p_world and hitched_to = any(v_pl);
      update creature set trapped = null where world_id = p_world and trapped = any(v_pl);
      update creature set post = null where world_id = p_world and post = any(v_pl);
      delete from placed where world_id = p_world and id = any(v_pl);
      v_out := jsonb_set(v_out, '{placed}', to_jsonb(coalesce((v_out->>'placed')::int, 0) + cardinality(v_pl)));
    end if;
    -- Crates, with what is in them.
    select array_agg(c.id) into v_cr from crate c where c.world_id = p_world and c.x between x0 and x1 and c.y between y0 and y1;
    if v_cr is not null then
      v_any := true;
      delete from item where world_id = p_world and holder = 'crate' and crate = any(v_cr);
      delete from crate where world_id = p_world and id = any(v_cr);
      v_out := jsonb_set(v_out, '{crates}', to_jsonb(coalesce((v_out->>'crates')::int, 0) + cardinality(v_cr)));
    end if;
    -- What lies on the ground, with what is in it (`item.inside`).
    delete from item where world_id = p_world and holder = 'ground' and gx between x0 and x1 and gy between y0 and y1;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_any := true;
      v_out := jsonb_set(v_out, '{ground_items}', to_jsonb(coalesce((v_out->>'ground_items')::int, 0) + v_n));
    end if;
    -- What grows there, and the ground's own clocks.
    delete from crop where world_id = p_world and x between x0 and x1 and y between y0 and y1;
    get diagnostics v_n = row_count; v_any := v_any or v_n > 0;
    delete from crop_last where world_id = p_world and x between x0 and x1 and y between y0 and y1;
    delete from water_plant where world_id = p_world and x between x0 and x1 and y between y0 and y1;
    get diagnostics v_n = row_count; v_any := v_any or v_n > 0;
    delete from tree_notch where world_id = p_world and x between x0 and x1 and y between y0 and y1;
    delete from green_since where world_id = p_world and x between x0 and x1 and y between y0 and y1;
    delete from tile_wear where world_id = p_world and x between x0 and x1 and y between y0 and y1;
    delete from foraged where world_id = p_world and x between x0 and x1 and y between y0 and y1;
    delete from mote_swirl where world_id = p_world and x between x0 and x1 and y between y0 and y1;

    -- The ground, where its generated ground is held: each corner's height and soil, and each tile's kind, data and rock.
    v_n := 0;
    for g in select * from runestone_ground r where r.seed = w.seed and r.size = w.size
                and r.x between x0 and x1 + 1 and r.y between y0 and y1 + 1 order by r.y, r.x loop
      if land_height(p_world, g.x, g.y) is distinct from g.height then
        perform land_set_height(p_world, g.x, g.y, g.height); v_n := v_n + 1;
      end if;
      if land_dirt(p_world, g.x, g.y) is distinct from g.dirt then
        perform land_set_dirt(p_world, g.x, g.y, g.dirt); v_n := v_n + 1;
      end if;
      continue when g.tile is null;
      if land_tile(p_world, g.x, g.y) is distinct from g.tile then
        perform land_set_tile(p_world, g.x, g.y, g.tile); v_n := v_n + 1;
      end if;
      if land_data(p_world, g.x, g.y) is distinct from g.data then
        perform land_set_data(p_world, g.x, g.y, g.data); v_n := v_n + 1;
      end if;
      if land_rock(p_world, g.x, g.y) is distinct from g.rock then
        perform land_set_rock(p_world, g.x, g.y, g.rock); v_n := v_n + 1;
      end if;
    end loop;
    if v_n > 0 then
      v_any := true;
      v_out := jsonb_set(v_out, '{ground}', to_jsonb(coalesce((v_out->>'ground')::int, 0) + v_n));
    end if;
    -- What the ground went through on the way is no longer what it is: its changes go, and each tile is said afresh below.
    if v_any then
      delete from tile_change where world_id = p_world and x between x0 and x1 and y between y0 and y1;
      v_touched := v_touched || array(select gy * w.size + gx from generate_series(y0, y1) gy, generate_series(x0, x1) gx);
    end if;

    -- Nobody stands on it now: bodies, wildermon and settlement tokens go to the first free tile beside it.
    select l.x, l.y into v_l from telestone_landing(p_world, s.id) l;
    if v_l.x is not null then
      with moved as (
        update player set x = v_l.x + 0.5, y = v_l.y + 0.5, level = 0, aboard = null, moved_at = now()
         where world_id = p_world and floor(x)::int between x0 and x1 and floor(y)::int between y0 and y1
        returning uid
      ) select array_agg(uid) into v_uids from moved;
      if v_uids is not null then
        v_out := jsonb_set(v_out, '{bodies}', to_jsonb(coalesce((v_out->>'bodies')::int, 0) + cardinality(v_uids)));
        foreach v_uid in array v_uids loop
          -- Told where it went, as a keeper's move or a journey tells it.
          if private.here(p_world, v_uid) then
            perform private.send('own:' || p_world || ':' || v_uid, 'moved', jsonb_build_object('x', v_l.x + 0.5, 'y', v_l.y + 0.5, 'level', 0));
          end if;
        end loop;
      end if;
      update creature set from_x = v_l.x + 0.5, from_y = v_l.y + 0.5, to_x = v_l.x + 0.5, to_y = v_l.y + 0.5,
             leg_at = now(), leg_ends = now()
       where world_id = p_world
         and ((floor(to_x)::int between x0 and x1 and floor(to_y)::int between y0 and y1)
              or (floor(from_x)::int between x0 and x1 and floor(from_y)::int between y0 and y1));
      get diagnostics v_n = row_count;
      if v_n > 0 then v_out := jsonb_set(v_out, '{creatures}', to_jsonb(coalesce((v_out->>'creatures')::int, 0) + v_n)); end if;
      update deed set x = v_l.x, y = v_l.y where world_id = p_world and x between x0 and x1 and y between y0 and y1;
      get diagnostics v_n = row_count;
      if v_n > 0 then v_out := jsonb_set(v_out, '{deeds}', to_jsonb(coalesce((v_out->>'deeds')::int, 0) + v_n)); end if;
    end if;
  end loop;

  -- And every tile anything went from, said once, as the keeper's clear says it.
  for v_t in select distinct t from unnest(v_touched) t order by t loop
    perform land_announce(p_world, v_t % w.size, v_t / w.size);
  end loop;
  return v_out;
end $fn$;

/* ---- A sitting beside a stone ---------------------------------------------------------------------- */

/** The first stone within `p_reach` tiles of a tile, from the middle of the tile to the middle of the stone's nearest: the browser's `runestoneWithin`. */
create or replace function runestone_within(p_size int, p_x int, p_y int, p_reach double precision) returns text
  language sql immutable as $$
  select c.id from runestone_centres(p_size) c
   where sqrt(power(greatest(0, abs(p_x - c.x) - stone_half()), 2) + power(greatest(0, abs(p_y - c.y) - stone_half()), 2)) <= p_reach
   order by c.ord limit 1
$$;

/**
 * What a spot multiplies a sitting by, and what sitting there says: every
 * multiplier in one place, in the browser's order and words (`sitPlace`).
 * A Runestone within reach is the browser's `stone`, after a swirl.
 */
drop function if exists sit_place(boolean, double precision, boolean, boolean, boolean);
create or replace function sit_place(p_on_deed boolean, p_height double precision, p_water boolean, p_swirl boolean, p_stale boolean, p_stone boolean)
  returns table (place double precision, said text) language plpgsql immutable as $$
begin
  place := 1;
  said := 'You sit down and let the day go past.';
  if p_on_deed then
    place := place * sit_yard();
    said := 'You sit in your own yard. It is hard to empty your head where there is so much to do.';
  end if;
  -- High, wild ground is what the paths are walked on.
  if p_height > sit_thin_at() then
    place := place * sit_thin();
    said := 'You sit where the ground runs out and the air is thin, and the day goes past a long way below.';
  elsif p_height > sit_high_at() and not p_on_deed then
    place := place * sit_high();
    said := 'You sit on the high ground with your back to a stone.';
  end if;
  if p_water then
    place := place * sit_water();
    said := 'You sit with your feet in the water and let it go past.';
  end if;
  if p_swirl then
    place := place * sit_swirl();
    said := said || ' ' || sit_swirl_said();
  end if;
  if p_stone then
    place := place * sit_stone();
    said := said || ' ' || sit_stone_said();
  end if;
  if p_stale then
    place := place * sit_stale();
    said := said || ' ' || sit_stale_said();
  end if;
  return next;
end $$;

/**
 * What a sitting where somebody stands is worth: the meditation it trains,
 * the Calm it banks, the place's multiplier and what it says (`sittingWorth`).
 */
create or replace function sitting_worth(p_world uuid, p_uid uuid)
  returns table (gain double precision, calm double precision, place double precision, said text) language plpgsql stable as $$
declare p player; tx int; ty int; v_deed boolean; v_swirl boolean; v_stale boolean; v_stone boolean; r record;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  tx := floor(p.x)::int; ty := floor(p.y)::int;
  v_deed := exists (select 1 from deed d where d.world_id = p_world
    and abs(tx - d.x) <= d.radius and abs(ty - d.y) <= d.radius);
  v_swirl := exists (select 1 from mote_swirl m where m.world_id = p_world
    and sqrt(((m.x - tx) ^ 2 + (m.y - ty) ^ 2)::double precision) <= sit_swirl_reach());
  v_stale := exists (select 1 from jsonb_array_elements(sat_spots_now(p)) e
    where sqrt((((e->>0)::int - tx) ^ 2 + ((e->>1)::int - ty) ^ 2)::double precision) <= sit_stale_reach());
  -- A Runestone within reach (`runestoneWithin`).
  v_stone := runestone_within((select w.size from world w where w.id = p_world), tx, ty, sit_stone_reach()) is not null;
  select * into r from sit_place(v_deed, centre_height(p_world, tx, ty), has_water(p_world, tx, ty), v_swirl, v_stale, v_stone);
  place := r.place;
  said := r.said;
  gain := sit_gain() * r.place;
  calm := sit_calm() * r.place;
  return next;
end $$;

/* ---- And on every island standing ------------------------------------------------------------------ */

select runestone_clear(id) from world where size >= stone_least() order by id;

select private.lock_doors();
