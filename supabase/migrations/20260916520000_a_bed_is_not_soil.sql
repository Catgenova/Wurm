-- A bed is not soil, and dirt is the only thing this rule could put back
--
-- Reported from the island: *"dropping dirt on sand or clay tiles converts them
-- to dirt tiles."* It does, and the half that was not reported is worse.
--
-- `reconcile` keeps a tile's face in step with the soil on its corners. Take
-- the last spadeful off all four and the bedrock shows; put a spadeful back on
-- any of them and it is ground again. Two lines, and they have been right since
-- the day they were written — for grass. Grass grows back, and dirt is what is
-- under it.
--
-- Over a bed it is the end of the bed. Measured before anything was touched:
--
--     1. a clay bank with one spadeful of it left: Clay, corners 1111
--     2. dug out, and the ground reconciled: Rock
--     3. one spadeful of dirt put back: Dirt — and the clay is gone for good
--
-- So the reported symptom is the *second* step. The first is that a clay pit
-- worked down to its last spadeful stops being a clay pit at all, silently, and
-- nothing anywhere remembers what it was: `land_rock` holds the stone under a
-- bare tile, not the face that was over it, so by the time the dirt goes back
-- there is nothing left to ask.
--
-- ## The column that already said so
--
-- `tile_def.collect` marks the four faces this matters for — sand, clay, peat
-- and tar — and its own line says exactly why this rule must leave them alone:
--
--     A bed of something that can be taken off the top without cutting the
--     ground about. You stand on the tile and fill a shovel, and the tile is
--     exactly as it was afterwards.
--
-- *Exactly as it was afterwards.* So `reconcile` leaves early over a bed, on
-- both sides, and a bed neither strips to rock nor comes back as dirt. Nothing
-- else needed changing: `dig` and `flatten` both ask `turns_to_dirt`, which is
-- false for all four, and the other `drop_dirt` buries grass and lawn by name.
--
-- What this cannot do is give back a bed somebody has already lost. There is no
-- record of it anywhere. From here on, nothing else goes the same way.

CREATE OR REPLACE FUNCTION public.reconcile(p_world uuid, p_x integer, p_y integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare bare boolean; t int; sz int;
begin
  select size into sz from world where id = p_world;
  if p_x < 0 or p_y < 0 or p_x >= sz or p_y >= sz then return; end if;
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

select private.lock_doors();
