-- A function the planner could not see into
--
-- With the wildlife sweep off the read, `rpc_creatures` is a read and nothing
-- else — and at the density a real island has, four hundred creatures inside
-- the forty-tile box, it still took a hundred and fifty milliseconds to build
-- its answer. Measured here, same island, same box, ten calls apiece:
--
--     the whole payload                     150.7 ms a call
--     the same with `max_health` a constant    6.7 ms a call
--     `max_health` over the box alone        132.0 ms a call
--
-- So the JSON is not the problem. One field of it is ninety-six percent of
-- the cost, and that field is a number between 20 and 800 that four hundred
-- rows each work out from three small lookups.
--
-- ---- why a cheap sum cost that much --------------------------------------
--
-- Postgres folds a `language sql` scalar function into the query that calls
-- it — that is how `beast_mul` and `trait_mul` cost nearly nothing — but it
-- refuses when the body contains a sublink, among a handful of other bars.
-- `max_health` read:
--
--     select round((select health from species_def where id = c.species)
--                  * beast_mul(c, 'hardy'))
--
-- That scalar subquery is a sublink, so the function was never folded. Every
-- one of the four hundred rows paid a whole function invocation with the
-- entire `creature` row handed in as a composite, which then handed the row
-- in again to `beast_mul`. Writing the same body out in the query, with no
-- function around it, measured 11.8 ms against the function's 132: the work
-- was never the arithmetic, it was the wrapper.
--
-- The remedy is to put the sublink somewhere it does no harm. `species_health`
-- takes a species name and returns a number, and is itself unfoldable — but it
-- is called with one short string, not a row, and the body around it folds.
--
-- `deed_aura` had the same bar and the same cure. It is nearly always a
-- no-op: a creature that is not on a deed gets 1 without looking anything up.
-- But the `case` sat inside an unfoldable function, so four hundred wild
-- rabba each paid the call to be told nothing. Splitting the lookup out into
-- `deed_aura_of` lets the `case` fold into the caller, where `c.mode <>
-- 'deed'` is a field test and the lookup is reached only by the eight beasts
-- it is about. And because `beast_mul` is the one door for haste, haul, work,
-- learn and range as well as hardiness, the clock gets the same saving on
-- every creature it settles, not just the ones a browser is looking at.
--
--     the payload            150.7 ms  ->  15.2 ms
--     `max_health` alone     132.0 ms  ->   7.8 ms
--     `deed_aura` alone        4.3 ms  ->   0.4 ms
--
-- ---- and one thing that is not the answer --------------------------------
--
-- `trait_mul` filters `trait_effect` on `channel`, which is the second column
-- of the only index, so it scans all 199 rows every time. An index on
-- `(channel, trait)` was built and measured, and the planner declined to use
-- it — the table is one page, and reading one page beats descending a tree to
-- find out which page to read. It is written down here so the next person to
-- notice the seq scan does not spend the afternoon on it.
--
-- ---- the same numbers out -------------------------------------------------
--
-- Both rewrites are arithmetic-identical, not merely close: `max_health` was
-- compared against its old body over all 1,264 creatures on this island, and
-- `deed_aura` over all 1,264 against every one of the fifteen channels —
-- 18,960 pairs — with no disagreement in either.

create or replace function species_health(p_species text)
returns double precision
language sql stable as $fn$
  select health from species_def where id = p_species
$fn$;

create or replace function max_health(c creature)
returns double precision
language sql stable as $fn$
  select round(species_health(c.species) * beast_mul(c, 'hardy'))
$fn$;

create or replace function deed_aura_of(p_world uuid, p_keeper uuid, p_post bigint, p_channel text)
returns double precision
language sql stable as $fn$
  select coalesce((select exp(sum(ln(e.mul)))
    from creature o
    cross join lateral unnest(coalesce(o.traits, '{}')) u(id)
    join trait_def d on d.id = u.id and d.aura
    join trait_effect e on e.trait = u.id and e.channel = p_channel
    where o.world_id = p_world and o.mode = 'deed'
      and o.keeper is not distinct from p_keeper
      and o.post is not distinct from p_post), 1)
$fn$;

create or replace function deed_aura(c creature, p_channel text)
returns double precision
language sql stable as $fn$
  select case when c.mode <> 'deed' or not aura_channel(p_channel) then 1
              else deed_aura_of(c.world_id, c.keeper, c.post, p_channel) end
$fn$;

select private.lock_doors();
