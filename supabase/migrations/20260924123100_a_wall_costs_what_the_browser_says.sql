-- A wall costs what the browser said it would
--
-- `arch.ts` has been red since the 21st, when a cobblestone wall became twenty
-- shards and ten mortar: a cobblestone arch cost 17 rock shards in the browser
-- and 18 on the island. Both sides work a bill out the same way -- the
-- material's bill times the type's factor, rounded up -- and the factor is
-- the whole of the difference.
-- `wall_type_def.factor` is a `real`, four bytes, so 0.85 is 0.8500000238
-- over here, twenty shards times that is a hair over seventeen, and a hair
-- over seventeen rounds up to eighteen. In the browser it is an ordinary
-- double, and twenty times 0.85 is seventeen.
--
-- It is the four-byte rounding `a_bin_that_weighs_what_is_in_it` found in an
-- item's weight, and it is put right the same way. Postgres prints a `real`
-- as the shortest decimal that reads back as it, so its text is the decimal
-- it was written from, and read back as a float8 that is exactly the number
-- the browser holds.
--
-- The arch was the one the suite asked about, and it was not the only one.
-- Worked out for every type and roof in all twelve materials, with the factor
-- as a double and as a four-byte real, nine lines of a bill came out one
-- dearer here than the window said:
--
--     cobblestone arch         rock shards 17 -> 18
--     cobblestone fence        rock shards  6 ->  7, mortar 3 -> 4
--     cobblestone fence gate   rock shards  8 ->  9, mortar 4 -> 5
--     cobblestone gabled roof  rock shards  6 ->  7, mortar 3 -> 4
--     cobblestone flat roof    rock shards 17 -> 18
--     adobe fence gate         adobe        2 ->  3
--
-- Every factor is read the one way now, and `arch.ts` asks every type and
-- every roof in every material rather than the arch alone.

create or replace function public.wall_bill(p_material text, p_type text)
 returns jsonb
 language sql
 stable
as $function$
  -- The fittings go on top of the material's bill, whatever the wall is of.
  select scaled_bill(p_material, coalesce((select factor::text::float8 from wall_type_def where id = p_type), 1))
      || coalesce((select jsonb_object_agg(f.item, f.count) from wall_fitting f where f.type = p_type), '{}'::jsonb)
$function$;

/**
 * Materials for a floor slot. A roof is whatever its shape costs — a gable
 * least, because a gable end is wall rather than roof, and a flat deck most,
 * because a thing you walk on is built like a floor.
 */
create or replace function floor_bill(p_material text, p_kind text, p_roof text) returns jsonb
  language sql stable as $fn$
  select case
    when p_kind = 'ladder' then '{"plank": 2}'::jsonb
    when p_kind = 'roof' then scaled_bill(p_material,
      coalesce((select factor::text::float8 from roof_shape_def where id = p_roof), 0.5))
    else scaled_bill(p_material, case when p_kind = 'stairs' then 0.75 else 0.5 end) end
$fn$;

select private.lock_doors();
