-- Iron fittings for building
--
-- Asked from the island. Nothing that swings took any metal: a door was
-- planks and nails, and a gate the same. Now a door takes two hinges, a
-- double door four and a gate two, cast two to a lump at the anvil, on top
-- of whatever the wall is of; and there is a gate bound in iron — four
-- brackets over its hinges — that swings for a person and holds against
-- everything else, a wildermon or a monster finding it shut. The fittings
-- are a table beside the wall types (`wall_fitting`), and `wall_bill` lays
-- them on top of the material's bill, so every planned wall on the island
-- asks for them from here on. The gate's iron is the wall type's own
-- column, `beast_proof`.
--
-- What the island does not yet do is keep a creature out of a building at
-- all: a wild thing on an island walks by tiles, and walls are the browser's
-- to enforce for its own body. The iron-bound gate holds in the game you
-- play by yourself, and on an island it holds exactly as much as any wall
-- there does, which is not yet at all. That is said here rather than left
-- to be found.

CREATE OR REPLACE FUNCTION public.wall_bill(p_material text, p_type text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  -- The fittings go on top of the material's bill, whatever the wall is of.
  select scaled_bill(p_material, coalesce((select factor from wall_type_def where id = p_type), 1))
      || coalesce((select jsonb_object_agg(f.item, f.count) from wall_fitting f where f.type = p_type), '{}'::jsonb)
$function$
;

-- The definitions before this added a column and a table the API sees.
notify pgrst, 'reload schema';

select private.lock_doors();
