/*
 * Building costs, raised.
 *
 * Asked for: "Look at the new material cost for cobblestone walls and suggest
 * similar material costs for all other building pieces. Costs should be
 * increased dramatically." And then: "apply them and push live".
 *
 * The bills themselves are data and came over with the definitions:
 * `build_material_bill`, `wall_fitting` and `bridge_bill`, off the same
 * tables the browser builds from. Two numbers were not data. A ladder was
 * `'{"plank": 2}'` written into `floor_bill`, twice, and a poured slab's
 * concrete a step was a hand-written `select 5`. Both are generated now --
 * `ladder_planks()` and `concrete_per_step()`, from `LADDER_PLANKS` and
 * `CONCRETE_PER_STEP` -- and `floor_bill` asks for the ladder's.
 *
 * What is already planned keeps the bill it was planned with: a wall or a
 * floor stores what it still needs, and so does a bridge span and a slab.
 */
set local lock_timeout = '3s';

create or replace function floor_bill(p_material text, p_kind text default 'floor') returns jsonb
language sql stable as $$
  select case when p_kind = 'ladder' then jsonb_build_object('plank', ladder_planks())
    else scaled_bill(p_material, case when p_kind = 'stairs' then 0.75 else 0.5 end) end
$$;

create or replace function floor_bill(p_material text, p_kind text, p_roof text) returns jsonb
language sql stable as $$
  select case
    when p_kind = 'ladder' then jsonb_build_object('plank', ladder_planks())
    when p_kind = 'roof' then scaled_bill(p_material,
      coalesce((select factor::text::float8 from roof_shape_def where id = p_roof), 0.5))
    else scaled_bill(p_material, case when p_kind = 'stairs' then 0.75 else 0.5 end) end
$$;

select private.lock_doors();
