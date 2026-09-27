/*
 * A foundation goes on bare rock.
 *
 * Asked for: "Establish that all dirt must be dug from a tile before planning
 * a foundation. Remove the option from dirt/grass etc tiles. Foundations can
 * be planned on rocks or seams or ores."
 *
 * `foundation_reason` refuses a tile with soil left on any of its corners, in
 * the browser's words (`soilSays`), and says how much is left: the soil on the
 * four corners together, which is the spadefuls it would take. It is asked by
 * `foundation_refusal` and again by `perform_foundation`, so a plan sent from a
 * page that still offers it over grass is refused as well. The rock under the
 * tile is not asked about: plain stone, a seam and an ore all take one.
 *
 * And `reconcile` leaves a poured slab alone. The last barrowful surfaces the
 * tile as packed ground, which a building plan and paving both want, and the
 * corners under it are now always bare. Left to itself the rule would turn the
 * tile into rock the first time a corner it shares was dug, mined or built up,
 * and nothing could be built or paved on the slab again. Any slab that has
 * already gone that way is packed ground again, below.
 */

create or replace function foundation_reason(p_world uuid, p_uid uuid, p_x int, p_y int, p_top int)
returns text language plpgsql stable as $fn$
declare v_high int; v_low int; v_lift int; v_want double precision; v_have double precision; v_name text;
        v_soil int;
begin
  if (foundation_at(p_world, p_x, p_y)).id is not null then
    return 'There is already a foundation on that tile.';
  end if;
  -- On bare rock and nowhere else: every spadeful of soil off all four corners first.
  select sum(land_dirt(p_world, v.cx, v.cy))::int into v_soil from tile_corners(p_x, p_y) v;
  if v_soil > 0 then
    return 'This tile still has ' || v_soil || ' soil over rock on its corners. A foundation goes on bare rock, '
      || 'seam or ore: dig every corner down to the rock first.';
  end if;
  select max(land_height(p_world, v.cx, v.cy))::int, min(land_height(p_world, v.cx, v.cy))::int
    into v_high, v_low from tile_corners(p_x, p_y) v;
  -- It fills a hole; it does not cut one.
  if p_top < v_high then
    return 'A foundation fills a tile up, never down. Its high corner is at ' || v_high
      || '; sight a level at or above that.';
  end if;
  -- And it is an answer to a slope. On ground that is already flat there is
  -- nothing to fill, and the tile next to it is the flat tile you were after.
  if p_top = v_high and v_high = v_low then
    return 'That tile is already level. A foundation is for ground that is not.';
  end if;
  /*
   * Not up against a building. A wall is planned against the ground as the
   * ground was, and a slab poured at its foot is a shelf under somebody else's
   * footings; keep a tile between them.
   */
  select b.name into v_name from building b
   where b.world_id = p_world
     and exists (select 1 from building_tile bt
                  where bt.world_id = p_world and bt.building = b.id
                    and abs(bt.x - p_x) <= clear_of_buildings()
                    and abs(bt.y - p_y) <= clear_of_buildings())
   order by b.id limit 1;
  if v_name is not null then
    return v_name || ' is too close. A foundation wants a tile clear of any building or plan.';
  end if;
  if is_token(p_world, p_x, p_y) then return 'The settlement token stands there.'; end if;
  if bridge_at(p_world, p_x, p_y) is not null then return 'A bridge is carried over that tile.'; end if;
  if exists (select 1 from item i where i.world_id = p_world and i.holder = 'ground'
               and i.gx = p_x and i.gy = p_y) then
    return 'Clear away the things lying there first: the pour would bury them.';
  end if;
  -- And the deepest part of the pour is what asks for the skill: shuttering a
  -- step is a morning's work and shuttering a cliff is not.
  v_lift := lift_for(p_world, p_x, p_y, p_top);
  v_want := v_lift::double precision / lift_per_masonry();
  v_have := skill_of(p_world, p_uid, 'masonry');
  if v_have < v_want then
    return 'A pour ' || v_lift || ' deep wants ' || to_char(v_want, 'FM990.0')
      || ' masonry and you have ' || to_char(v_have, 'FM990.0')
      || '. At your skill the deepest you can shutter is '
      || to_char(v_have * lift_per_masonry(), 'FM990') || '.';
  end if;
  return null;
end $fn$;

CREATE OR REPLACE FUNCTION public.reconcile(p_world uuid, p_x integer, p_y integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare bare boolean; t int; sz int;
begin
  select size into sz from world where id = p_world;
  if p_x < 0 or p_y < 0 or p_x >= sz or p_y >= sz then return; end if;
  -- A poured slab is surfaced as it was left, whatever the corners under it are.
  if exists (select 1 from foundation f where f.world_id = p_world and f.x = p_x and f.y = p_y
               and bill_done(f.needed)) then
    return;
  end if;
  t := land_tile(p_world, p_x, p_y);
  -- A bed is the ground itself, not soil lying on rock. Nothing here touches it.
  if coalesce((select collect from tile_def where id = t), false) then return; end if;
  bare := land_dirt(p_world, p_x, p_y) = 0 and land_dirt(p_world, p_x + 1, p_y) = 0
      and land_dirt(p_world, p_x + 1, p_y + 1) = 0 and land_dirt(p_world, p_x, p_y + 1) = 0;
  if bare and t <> 4 and t <> 12 then
    perform land_set_tile(p_world, p_x, p_y, 4);
    perform land_set_data(p_world, p_x, p_y, land_rock(p_world, p_x, p_y));
    perform land_announce(p_world, p_x, p_y);
  elsif not bare and t = 4 then
    perform land_set_tile(p_world, p_x, p_y, 1);
    perform land_announce(p_world, p_x, p_y);
  end if;
end $function$;

-- A slab already turned to rock under it is packed ground again, as its last barrowful left it.
do $$
declare f record;
begin
  for f in select fo.world_id, fo.x, fo.y from foundation fo
            where bill_done(fo.needed) and land_tile(fo.world_id, fo.x, fo.y) = tile_id('Rock') loop
    perform land_set_tile(f.world_id, f.x, f.y, tile_id('Packed dirt'));
    perform land_announce(f.world_id, f.x, f.y);
  end loop;
end $$;

select private.lock_doors();
