/*
 * A barrel holds what its wood holds, and every piece holds what the browser
 * says it holds.
 *
 * The browser has always reckoned a coopered thing's litres by its wood --
 * `liquidCapacity`, the wood's `hold` times what the build holds -- and the
 * island never did: every barrel held its build's litres whatever it was made
 * of. So an oak barrel said "0 / 90 litres" in the browser and turned the
 * ninety-first bucket away at eighty, and a pine one said 76 and took 80.
 *
 * Asking the wood turned up the second half. A wood's `hold` is kept as a
 * four-byte real, so the island multiplied by 0.949999988 where the browser
 * multiplies by 0.95; and it rounded half to even where the browser's
 * `Math.round` rounds half up. Most sums never land on a half and the two
 * agreed by luck, but some do: a pine larder is 250 x 0.95 = 237.5, which the
 * browser shows as 238 and the island stopped at 237, and a pine small barrel
 * is 28.5, which would have been 29 against 28. Both sums are the browser's
 * now: the wood's hold read as the decimal it was written as (`mat_hold`),
 * and a half rounded up, in the plain size and in a rarity's share of it
 * (`room_for`, `liquid_capacity`). A piece's maker's mark comes after the
 * wood, as it does there.
 *
 * A pine, willow or fig barrel standing fuller than its wood now allows keeps
 * every litre in it: pouring into one that is full is refused on both sides,
 * so it takes nothing more until it is drawn below the line, and nothing
 * anybody put in it is poured away here.
 */
set local lock_timeout = '3s';

/* A wood's hold, as the decimal the rulebook wrote it as rather than the nearest four-byte real to it. */
create or replace function mat_hold(p_extra text)
 returns double precision language sql stable as $fn$
  select coalesce((mat_of(p_extra)).hold::text::float8, 1)
$fn$;

/*
 * What a container holds given what a plain one holds: `roomFor`, with both of
 * its roundings -- the plain size and the rarity's share of it -- taking a half
 * up as `Math.round` does. A supreme olive chest is 65 and a tenth of that more,
 * 6.5, which was 6 here and 7 there.
 */
create or replace function room_for(p_base double precision, p_rare text)
 returns integer language sql stable as $fn$
  select case when step = 0 then plain
              else plain + greatest(step, floor(plain * rarity_room() * step + 0.5)::int) end
  from (select floor(coalesce(p_base, 0) + 0.5)::int as plain,
               coalesce((select ord from rarity_def where id = p_rare), 0) as step) a
$fn$;

create or replace function furniture_capacity(p placed)
 returns integer language sql stable as $fn$
  select room_for(coalesce((select coalesce(capacity, hive, 0) from furniture_def where id = p.sub), 0)
    * mat_hold(p.material) * mark_of(p.mark, 'hold'), p.rare)
$fn$;

create or replace function furniture_heft(p placed)
 returns double precision language sql stable as $fn$
  select room_for(coalesce((select heft from furniture_def where id = p.sub), 0)
    * mat_hold(p.material) * mark_of(p.mark, 'hold'), p.rare)::double precision
$fn$;

create or replace function crate_capacity(c crate)
 returns integer language sql stable as $fn$
  select room_for((select capacity from crate_def where kind = c.kind) * mat_hold(c.material), c.rare)
$fn$;

create or replace function liquid_capacity(p placed)
 returns double precision language sql stable as $fn$
  select case when d.liquid is not null
              then floor(d.liquid * mat_hold(p.material) * mark_of(p.mark, 'hold') + 0.5)
              else coalesce(d.well, 0) end
  from furniture_def d where d.id = p.sub
$fn$;

revoke all on function mat_hold(text) from public, anon, authenticated;
select private.lock_doors();
