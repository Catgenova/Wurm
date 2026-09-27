/*
 * Rare wildermon.
 *
 * A wildermon comes into the world as rare as a made thing comes off the
 * bench: `rarity_roll`, at the odds in `rarity_def` -- one in a hundred rare,
 * one in a thousand supreme, one in ten thousand fantastic. What that makes
 * of it is on the same row:
 *
 *   size   how much bigger it is than an ordinary one of its kind, which the
 *          browser draws (and makes it clickable by);
 *   blood  how much better every figure its blood decides is: multiplied in
 *          where more is better and divided in where less is, which is what
 *          `channel_def.up` says -- its upkeep, what a blow costs it and how
 *          often one lands on it are the three where less is.
 *
 * And it rolls its three traits on the wild table lifted as far again, for
 * each step of its rarity, as a hundred husbandry lifts it (`roll_trait`), so
 * a fantastic one has no common blood in it at all.
 *
 * A monster is not a wildermon and is never rare. A young one is rolled for
 * as anything coming into the world is; its traits are the ones its parents
 * gave it, which `drop_young` writes over the roll, and its health is read
 * again through `max_health`, which has its rarity in it.
 *
 * `beast_mul` is the one place a creature's channels are multiplied, so the
 * rarity goes in there and every rule that asks what a beast is worth -- its
 * health, its bite, its pace, its work, its keep -- has it. The browser does
 * the same in `bloodMul`, off the same row.
 */

set local lock_timeout = '3s';
alter table creature add column if not exists rare text;

/** What a wildermon's rarity makes of one channel of its blood: `blood` times as good, one way or the other. Nothing for an ordinary one. */
create or replace function rarity_blood(p_rare text, p_channel text) returns double precision
  language sql stable as $fn$
  select coalesce((select case when coalesce(ch.up, true) then r.blood else 1 / r.blood end
    from rarity_def r left join channel_def ch on ch.id = p_channel
    where r.id = p_rare), 1)
$fn$;

/** A rarity's step, nought for an ordinary one: the browser's index into `RARITIES`. */
create or replace function rarity_step(p_rare text) returns int
  language sql stable as $fn$ select coalesce((select ord from rarity_def where id = p_rare), 0) $fn$;

/*
 * One fresh trait out of the wild, avoiding what is already there, as it was,
 * with the rarity of what it is rolled for lifting the table alongside the
 * roller's husbandry: each step as far as a hundred husbandry. A row lifted
 * below nothing is not rolled at all. The signature grows a parameter, so the
 * old one goes first: two of them would make every two-argument call
 * ambiguous.
 */
drop function if exists roll_trait(text[], double precision);
create or replace function roll_trait(p_taken text[], p_husbandry double precision default 0, p_rare int default 0)
 returns text
 language plpgsql
as $function$
declare v_lift double precision := greatest(0, least(100, p_husbandry)) / 100 + greatest(0, coalesce(p_rare, 0));
        v_tier text; v_got text; v_family text; v_families text[];
begin
  v_families := trait_families(p_taken);
  select t.tier into v_tier from tier_odds t
  order by -ln(greatest(1e-12, random())) / greatest(1e-9, t.weight * greatest(0, case t.tier
      when 'common' then 1 - v_lift * 0.35 when 'rare' then 1 + v_lift * 1.5
      when 'supreme' then 1 + v_lift * 3 else 1 + v_lift * 5 end))
  limit 1;
  if random() < fight_share() then
    -- Fighting blood: a name the animal does not carry, in the grade just rolled.
    select d.family into v_family from trait_def d
      where d.family is not null and d.tier = 'common' and not (d.family = any(v_families))
      order by random() limit 1;
    if v_family is not null then
      select d.id into v_got from trait_def d where d.family = v_family and d.tier = v_tier;
      if v_got is not null then return v_got; end if;
    end if;
  end if;
  select d.id into v_got from trait_def d
    where d.tier = v_tier and d.family is null and not (d.id = any(coalesce(p_taken, '{}')))
    order by random() limit 1;
  -- Nothing left in that tier: take anything that is not already in, by name.
  if v_got is null then
    select d.id into v_got from trait_def d
      where not (coalesce(d.family, d.id) = any(v_families)) order by random() limit 1;
  end if;
  return v_got;
end $function$;

/* Three traits for something born in the wild, as rare as it came. */
drop function if exists roll_traits(double precision);
create or replace function roll_traits(p_husbandry double precision default 0, p_rare int default 0)
 returns text[]
 language plpgsql
as $function$
declare v_out text[] := '{}'; v_got text; v_i int;
begin
  for v_i in 1..trait_slots() loop
    v_got := roll_trait(v_out, p_husbandry, p_rare);
    if v_got is not null then v_out := v_out || v_got; end if;
  end loop;
  return v_out;
end $function$;

/**
 * Everything that bears on one channel for one animal: its blood, as rare as
 * it is, the herd it works in, and for work and learning its brushing.
 */
create or replace function beast_mul(c creature, p_channel text) returns double precision
  language sql stable as $fn$
  select trait_mul(c.traits, p_channel) * deed_aura(c, p_channel)
       -- Ninety-nine in a hundred are ordinary, and the world tick asks this of every beast it moves: they are spared the look-up.
       * case when c.rare is null then 1 else rarity_blood(c.rare, p_channel) end
       * case when p_channel in ('work', 'learn') then care_mul(c) else 1 end
$fn$;

CREATE OR REPLACE FUNCTION public.creature_spawn(p_world uuid, p_species text, p_x double precision, p_y double precision, p_mode text DEFAULT 'wild'::text, p_born timestamp with time zone DEFAULT NULL::timestamp with time zone, p_keeper uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $fn$
declare d species_def; new_id int; tr text[]; sk jsonb := '{}'::jsonb; gskill text; v_rare text;
        hx double precision; hy double precision;
begin
  select * into d from species_def where id = p_species;
  if not found then return null; end if;
  select coalesce(max(id), 0) + 1 into new_id from creature where world_id = p_world;
  -- As rare as a made thing may come off the bench, and born with blood to match; a monster is not a wildermon and never is.
  v_rare := case when coalesce(d.monster, false) then null else rarity_roll() end;
  tr := roll_traits(0, rarity_step(v_rare));
  -- A worker starts knowing nothing about its trade and learns it by doing it.
  select skill into gskill from gather_def where id = d.gathers;
  if gskill is not null then sk := jsonb_build_object(gskill, 1); end if;
  -- Its own ground, or a herd's. A grazer takes the home of the nearest of
  -- its own kind within reach; a hunter, and anything that is not wild, keeps
  -- where it is standing.
  hx := p_x; hy := p_y;
  if p_mode = 'wild' and not coalesce(d.hunter, false) then
    select c.home_x, c.home_y into hx, hy
      from creature c
      where c.world_id = p_world and c.species = d.id and c.mode = 'wild'
        and c.home_x is not null
        and (c.home_x - p_x) ^ 2 + (c.home_y - p_y) ^ 2 <= herd_reach() ^ 2
      order by (c.home_x - p_x) ^ 2 + (c.home_y - p_y) ^ 2
      limit 1;
    if hx is null then hx := p_x; hy := p_y; end if;
  end if;
  insert into creature (world_id, id, species, name, variant, mode, stance,
      from_x, from_y, to_x, to_y, leg_at, leg_ends, until,
      health, hunger, fleece, care, sex, traits, skills, born, keeper, home_x, home_y, rare)
  values (p_world, new_id, d.id, d.name, floor(random() * greatest(1, d.variants))::int,
      p_mode, coalesce(d.default_stance, 'defensive'),
      p_x, p_y, p_x, p_y, now(), now(), now(),
      round(d.health * trait_mul(tr, 'hardy') * rarity_blood(v_rare, 'hardy')), 0.6 + random() * 0.4, 0.6 + random() * 0.4,
      0, case when random() < 0.5 then 'male' else 'female' end, tr, sk, p_born, p_keeper, hx, hy, v_rare);
  return new_id;
end $fn$;

CREATE OR REPLACE FUNCTION public.rpc_creatures(p_world uuid, p_range double precision DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  /*
   * And the wildlife is not moved from in here any more.
   *
   * This is a read. It ran `creature_sweep`, which settles every creature in
   * forty tiles whose turn is due — up to a hundred and twenty of them, each
   * one a piece of animal thinking, some of it pathing. On the call a browser
   * makes every second, for every player, while the browser waits for the
   * answer.
   *
   * And `world_tick` already does it. It takes the same list of live bodies,
   * dedupes them onto their tiles, and sweeps forty tiles round each one, once
   * a second, on a clock nobody is waiting for. So this was the same work a
   * second time, on the worst possible thread to do it on: measured here at
   * 257 to 466 ms a call against 2.7 ms for the ground read beside it, which
   * is why an island would hand over a deed in a few seconds and its wildlife
   * not at all — eight PostgREST slots, and this sitting in them.
   *
   * Where there is no `pg_cron` there is no other clock, so it still happens
   * here: the suite's bare postgres and any project without the extension are
   * exactly as they were. The guard is the one `world_tick` already uses for
   * the stocking, for the same reason and with the same shape.
   */
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform creature_sweep(p_world, p.x, p.y, p_range);
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'species', c.species, 'name', c.name, 'variant', c.variant,
      'mode', c.mode, 'stance', c.stance, 'job', c.job, 'shod', shod(c), 'tack', c.tack,
      'x', creature_x(c), 'y', creature_y(c),
      'fromX', c.from_x, 'fromY', c.from_y, 'toX', c.to_x, 'toY', c.to_y,
      /*
       * How long the leg is and how much of it is left, in seconds.
       *
       * It used to hand over the two instants themselves, which asks a browser
       * to agree with this database about what time it is. A phone whose clock
       * is twenty seconds out pins every leg at one end or the other and then
       * re-pins it on the next answer, which reads as a thing jumping about —
       * and the action bar learnt this lesson already: "a browser whose clock
       * is a minute out still draws the right bar".
       */
      'legFor', case when c.leg_ends > c.leg_at
                     then extract(epoch from (c.leg_ends - c.leg_at)) else 0 end,
      'legLeft', greatest(0, extract(epoch from (c.leg_ends - now()))),
      'health', c.health, 'max', max_health(c), 'hunger', c.hunger,
      'sex', c.sex, 'age', age_of(c.born, old_of(c)), 'traits', c.traits,
      'hunting', c.hunting = me, 'mine', coalesce(c.keeper = me, false),
      -- What its keeper's perks make of keeping it, which the browser ages and feeds it by.
      'kept', c.kept,
      -- Which vehicle it is in the traces of, which no browser has ever been told.
      'hitchedTo', c.hitched_to)
      /*
       * And, for your own only, what the card has been making up.
       *
       * A worker's trade, its learning, its brushing and what is in its arms
       * are all here and none of them have ever gone out, so the browser
       * filled them in from the book: every wildermon on an island read
       * Foraging 1.00, Experience 0.0, Care 0% and "Looking for work", however
       * long it had been at it. Yours only, because it is a card you open
       * about your own and nobody needs five numbers about a wild boar.
       */
      || case when c.keeper = me then jsonb_build_object(
           'care', c.care, 'xp', c.xp, 'skills', c.skills,
           'phase', c.phase, 'carrying', c.carrying)
         else '{}'::jsonb end
      /*
       * And its pedigree, for anything bred: whole for your own, and for
       * anybody else's saying where a trait came from only for the traits
       * you can read, by the rule the card's chips keep.
       */
      || case when c.pedigree is null then '{}'::jsonb
              when c.keeper = me then jsonb_build_object('pedigree', c.pedigree)
              else jsonb_build_object('pedigree', pedigree_seen(p_world, me, c.pedigree)) end
      -- And how rare it came into the world, for a rare one: the browser draws it bigger and shining, and reckons with it.
      || case when c.rare is null then '{}'::jsonb else jsonb_build_object('rare', c.rare) end
      order by c.id)
    from creature c
    -- Your own in crates, wherever the crates are; and everything within range.
    where (c.world_id = p_world and c.keeper = me and c.mode = 'stored')
       or (c.world_id = p_world
      /*
       * Where the leg ends, first, because that is what there is an index on.
       *
       * The exact answer below is where the thing is *now*, which is a point
       * on the leg it is walking and so a function of four columns and the
       * clock — nothing a btree can help with, and it was being worked out for
       * every creature on the island before being thrown away. This narrows to
       * the neighbourhood first, generously: `leg_slack` is far longer than
       * any leg the rules make (the longest measured on a real island is 2.13
       * tiles), and anything walking further than that in one leg was already
       * invisible to `creature_sweep`, which has bounded itself this way since
       * it was written.
       */
      and c.to_x between p.x - (p_range + leg_slack()) and p.x + (p_range + leg_slack())
      and c.to_y between p.y - (p_range + leg_slack()) and p.y + (p_range + leg_slack())
      and greatest(abs(creature_x(c) - p.x), abs(creature_y(c) - p.y)) <= p_range)), '[]'::jsonb);
end $function$;

/* A wildermon in a crate, as a deal, a parcel or a stall names it: and how rare it is, for a rare one. */
create or replace function crate_occupant(p_world uuid, p_creature int) returns jsonb
language sql stable as $$
  select jsonb_build_object('name', c.name, 'species', c.species)
      || case when c.rare is null then '{}'::jsonb else jsonb_build_object('rare', c.rare) end
    from creature c where c.world_id = p_world and c.id = p_creature
$$;

select private.lock_doors();
