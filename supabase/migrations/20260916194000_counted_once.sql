-- How full every crate is, counted once rather than once apiece.
--
-- `crates_near` asked `crate_units` — a `sum` over `item` — as a correlated
-- subquery for every crate within forty tiles, on every ground read, for every
-- player, a second apart. On a settlement with a dozen crates that is a dozen
-- aggregates a second per person, to report numbers that only move when
-- somebody puts something down.
--
-- One grouped pass over the same index (`item_in_crate`) answers all of them.
-- Nothing else changes: the same number comes out, and `crate_units` is still
-- there for everything that wants one crate's count on its own.
--
-- Deliberately not a cached column on `crate`. A count kept up to date by hand
-- is a count that goes wrong the first time somebody adds a path that moves an
-- item without knowing it has to, and a wrong count is worse than a slow one.

CREATE OR REPLACE FUNCTION public.crates_near(p_world uuid, p_uid uuid, p_range double precision)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce((select jsonb_agg((to_jsonb(c) - 'world_id' - 'made_by')
        || jsonb_build_object(
             'mine', crate_yours(p_world, p_uid, c.id),
             -- How full it is, for every crate in sight: a label does not need
             -- the contents and the contents are not free.
             /*
              * How full it is, counted once for the lot rather than once for
              * each of them.
              *
              * `crate_units` is a `sum` over `item`, and this ran it as a
              * correlated subquery for every crate within forty tiles, on
              * every ground read, for every player — a second apart. One
              * grouped pass over the same index answers all of them, and the
              * answer is the same answer.
              */
             'units', coalesce(u.units, 0),
             -- And what is actually in it, for the ones you could reach into.
             -- You must be within two and a half tiles to put anything in or
             -- take anything out, so six is generous and keeps a yard full of
             -- crates from costing a phone a hundred kilobytes every three
             -- seconds.
             'things', case when greatest(abs(crate_centre_x(c) - p.x), abs(crate_centre_y(c) - p.y)) <= 6
               then coalesce((select jsonb_agg(jsonb_build_object(
                     'id', i.id, 'def', i.def, 'ql', i.ql, 'dmg', i.dmg,
                     'count', i.count, 'extra', i.extra) order by i.id)
                   from item i where i.world_id = p_world and i.holder = 'crate' and i.crate = c.id),
                 '[]'::jsonb)
               else '[]'::jsonb end) order by c.id)
      from crate c
      left join (select i.crate, sum(i.count)::int as units
                   from item i
                  where i.world_id = p_world and i.holder = 'crate'
                  group by i.crate) u on u.crate = c.id
      where c.world_id = p_world
        and greatest(abs(c.x + 0.5 - p.x), abs(c.y + 0.5 - p.y)) <= p_range), '[]'::jsonb)
    from player p where p.world_id = p_world and p.uid = p_uid
$function$;

notify pgrst, 'reload schema';
