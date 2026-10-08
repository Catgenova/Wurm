-- A better-made cart or wagon goes a little faster: up to a tenth at quality 100, after
-- the cap with the builder's mark, as the browser's `vehicleQlPace` has it.
set local lock_timeout = '3s';

/** What a cart or wagon of quality 100 adds to its pace, as a share of it. The browser's `VEHICLE_QL_TOP`. */
create or replace function vehicle_ql_top() returns double precision language sql immutable as $$ select 0.1 $$;
/** What a cart or wagon's quality makes of its pace. The browser's `vehicleQlPace`. */
create or replace function vehicle_ql_pace(p_ql double precision) returns double precision language sql immutable as $$
  select 1 + vehicle_ql_top() * greatest(0, least(100, coalesce(p_ql, 0))) / 100
$$;

CREATE OR REPLACE FUNCTION public.vehicle_speed(p_world uuid, p_id bigint)
 RETURNS double precision
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v vehicle_def; p placed; c creature; n int := 0;
        sum_pace double precision := 0; worst double precision := 1; pull double precision := 0.75;
begin
  select * into p from placed where world_id = p_world and id = p_id;
  if not found then return 0; end if;
  select * into v from vehicle_def where id = p.sub;
  if not found then return 0; end if;
  for c in select * from team_of(p_world, p_id) loop
    n := n + 1;
    sum_pace := sum_pace + (select speed from species_def where id = c.species)
      * (age_row(c.born, old_of(c))).speed * beast_mul(c, 'speed');
    worst := least(worst, 0.6 + 0.4 * c.hunger);
    -- Every beast adds its own share; the ones bred for it add more.
    pull := pull + coalesce((select sp.pull from species_def sp where sp.id = c.species), 0.25)
      * (age_row(c.born, old_of(c))).pull * beast_mul(c, 'haul');
  end loop;
  if n < v.needs then return 0; end if;
  -- The builder's mark goes on after the cap, so a Carpenter's Smooth Axle is
  -- its whole share at the top of the range too, as `vehicleSpeed` has it; and
  -- so does how well the thing was built (`vehicle_ql_pace`).
  return least(max_vehicle_speed(),
    (sum_pace / n) * pull * worst * footing(team_climb(p_world, p_id)) * roll_ease(p.material)) * mark_of(p.mark, 'speed')
    * vehicle_ql_pace(p.ql);
end $function$;

select private.lock_doors();
