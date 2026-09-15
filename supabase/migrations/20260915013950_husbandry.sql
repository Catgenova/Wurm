-- Putting two of them together, and reading what came of it.
--
-- ## A pregnancy is the eleventh thing that will not sit still, and the first
-- ## whose settling makes a new row
--
-- Everything else that settles changes something that was already there: a
-- fire has less fuel, a well has more water, a trap has something in it. A dam
-- in young settles into a *creature that did not exist before*, and it does it
-- whether or not her keeper is standing there when the hour comes.
--
-- What the young one carries is decided at the moment of pairing rather than
-- at the moment of birth — `unborn` is written then and read back out at the
-- hour — which is the browser's own arrangement and the right one: the blood
-- is the blood of the two of them as they were when they were put together,
-- not as they are twelve minutes later.

alter table creature add column if not exists due timestamptz;
alter table creature add column if not exists bred_at timestamptz;
alter table creature add column if not exists unborn jsonb;

/**
 * How likely a slot is inherited out of the pair rather than rolled fresh, and
 * one roll off the wild table avoiding what is already in hand.
 *
 * `roll_traits` has had the second of these inside it since the wildlife
 * arrived; breeding is the first thing that wants one at a time, so the loop
 * body comes out and both callers share it.
 */
create or replace function inherit_chance(p_husbandry double precision, p_care double precision)
  returns double precision language sql immutable as $$
  select least(0.96, 0.5 + greatest(0, least(100, p_husbandry)) / 100 * 0.35
                   + greatest(0, least(1, p_care)) * 0.11)
$$;

create or replace function roll_trait(p_taken text[], p_husbandry double precision default 0)
  returns text language plpgsql as $$
declare v_lift double precision := greatest(0, least(100, p_husbandry)) / 100;
        v_tier text; v_got text;
begin
  select t.tier into v_tier from tier_odds t
  order by random() / greatest(1e-9, t.weight * case t.tier
      when 'common' then 1 - v_lift * 0.35 when 'rare' then 1 + v_lift * 1.5
      when 'supreme' then 1 + v_lift * 3 else 1 + v_lift * 5 end)
  limit 1;
  select d.id into v_got from trait_def d
  where d.tier = v_tier and not (d.id = any(coalesce(p_taken, '{}'))) order by random() limit 1;
  -- Nothing left in that tier: take anything that is not already in.
  if v_got is null then
    select d.id into v_got from trait_def d
    where not (d.id = any(coalesce(p_taken, '{}'))) order by random() limit 1;
  end if;
  return v_got;
end $$;

/** The odds a pairing takes. */
create or replace function breed_chance(p_skill double precision, p_care double precision)
  returns double precision language sql immutable as $$
  select least(0.97, 0.35 + greatest(0, least(100, p_skill)) / 100 * 0.5
                   + greatest(0, least(1, p_care)) * 0.15)
$$;

/**
 * The mate standing nearest this one: same species, the other sex, tamed,
 * grown, fed, and rested since its last covering.
 */
create or replace function mate_for(p_world uuid, c creature) returns creature
  language sql stable as $$
  select o.* from creature o
  where o.world_id = p_world and o.id <> c.id and o.species = c.species and o.sex <> c.sex
    and o.mode in ('active', 'deed') and o.due is null
    and sqrt((creature_x(o) - creature_x(c)) ^ 2 + (creature_y(o) - creature_y(c)) ^ 2) <= pair_range()
  order by sqrt((creature_x(o) - creature_x(c)) ^ 2 + (creature_y(o) - creature_y(c)) ^ 2), o.id
  limit 1
$$;

/** Why these two will not be put together, or null. */
create or replace function pair_refuses(p_world uuid, a creature, b creature) returns text
  language plpgsql stable as $$
declare c creature; stage text;
begin
  foreach c in array array[a, b] loop
    stage := age_of(c.born);
    if stage <> 'grown' then
      return c.name || case when stage = 'young' then ' is not grown.' else ' is past it.' end;
    end if;
    if c.hunger < 0.5 then return c.name || ' is too hungry to think about it. Feed it first.'; end if;
    if c.bred_at is not null and now() - c.bred_at < make_interval(secs => breed_rest()) then
      return c.name || ' has been put to a mate lately and wants '
        || clock_left(breed_rest() - extract(epoch from (now() - c.bred_at))) || ' to itself.';
    end if;
    if c.due is not null then return c.name || ' is already in young.'; end if;
  end loop;
  return null;
end $$;

/**
 * What a pairing throws.
 *
 * A good keeper's eye falls on the best of what the pair carry: each slot is
 * either inherited out of the two bloods, weighted towards the rarer of them,
 * or rolled fresh off the wild table.
 */
create or replace function breed_traits(p_sire text[], p_dam text[], p_husbandry double precision,
    p_care double precision)
  returns text[] language plpgsql as $$
declare pool text[]; keep double precision; lift double precision; out_t text[] := '{}';
        slot int; left_t text[]; weights double precision[]; total double precision; r double precision;
        i int; pick text;
begin
  select array_agg(distinct t) into pool from unnest(p_sire || p_dam) t;
  pool := coalesce(pool, '{}');
  keep := inherit_chance(p_husbandry, p_care);
  lift := greatest(0, least(100, p_husbandry)) / 100;
  for slot in 1..trait_slots() loop
    select array_agg(t) into left_t from unnest(pool) t where not (t = any(out_t));
    left_t := coalesce(left_t, '{}');
    pick := null;
    if array_length(left_t, 1) > 0 and random() < keep then
      select array_agg(1 + (select o.ord from trait_def d join tier_odds o on o.tier = d.tier
                            where d.id = t) * lift * 2.4)
        into weights from unnest(left_t) t;
      select sum(w) into total from unnest(weights) w;
      r := random() * total;
      pick := left_t[array_length(left_t, 1)];
      for i in 1..array_length(left_t, 1) loop
        r := r - weights[i];
        if r < 0 then pick := left_t[i]; exit; end if;
      end loop;
    else
      pick := roll_trait(out_t, p_husbandry);
    end if;
    if pick is not null and not (pick = any(out_t)) then out_t := out_t || pick; end if;
  end loop;
  return out_t;
end $$;

/** Put a sire to a dam. What she carries is decided here and read back later. */
create or replace function pair_them(p_world uuid, p_dam int, p_sire int, p_husbandry double precision)
  returns void language plpgsql as $$
/*
 * `v_care`, not `care`. The eighth time this class has bitten: a local called
 * `care` inside an `update creature` is not a local, it is the column, and
 * Postgres says "ambiguous" if you are lucky. Alias every table, prefix every
 * local — the rule has not changed and neither has the mistake.
 */
declare dam creature; sire creature; v_care double precision;
begin
  select * into dam from creature where world_id = p_world and id = p_dam;
  select * into sire from creature where world_id = p_world and id = p_sire;
  v_care := (dam.care + sire.care) / 2;
  update creature set
      unborn = jsonb_build_object(
        'traits', to_jsonb(breed_traits(sire.traits, dam.traits, p_husbandry, v_care)),
        'sex', case when random() < 0.5 then 'male' else 'female' end),
      due = now() + make_interval(secs => gestation()),
      bred_at = now()
    where world_id = p_world and id = p_dam;
  update creature set bred_at = now() where world_id = p_world and id = p_sire;
end $$;

/**
 * The hour comes, whoever is or is not standing there.
 *
 * Born where the dam is if she is out in the world, and at the token if she is
 * not. Either way it goes to the herd: nothing that young is put to work.
 */
create or replace function give_birth(p_world uuid, p_id int) returns int language plpgsql as $$
/*
 * Every local prefixed, and the ninth and tenth times this class has bitten
 * were both in this one function: `born` is a column of `creature` and so is
 * `traits`, and an unprefixed local of either name inside `update creature` is
 * not a local at all. The rule is not "prefix the ones that have bitten", it
 * is "prefix all of them", and it has to be applied while writing rather than
 * while debugging.
 */
declare v_dam creature; v_d species_def; v_nx double precision; v_ny double precision;
        v_born int; v_coming jsonb; v_traits text[]; v_home record;
begin
  select * into v_dam from creature where world_id = p_world and id = p_id for update;
  if not found or v_dam.due is null or v_dam.due > now() then return 0; end if;
  v_coming := v_dam.unborn;
  update creature set unborn = null, due = null where world_id = p_world and id = p_id;
  if v_coming is null then return 0; end if;
  select * into v_d from species_def where id = v_dam.species;
  v_nx := creature_x(v_dam); v_ny := creature_y(v_dam);
  if v_dam.mode = 'stored' then
    select dd.x + 0.5 as x, dd.y + 1.5 as y into v_home from deed dd where dd.world_id = p_world;
    if found then v_nx := v_home.x; v_ny := v_home.y; end if;
  end if;
  v_born := creature_spawn(p_world, v_dam.species, v_nx, v_ny, 'stored', now());
  select array_agg(t) into v_traits from jsonb_array_elements_text(v_coming->'traits') t;
  update creature set traits = coalesce(v_traits, '{}'), sex = v_coming->>'sex',
      hunger = 0.9, care = 0.5
    where world_id = p_world and id = v_born;
  update creature c set health = max_health(c) where c.world_id = p_world and c.id = v_born;
  if v_dam.keeper is not null then
    perform tell(p_world, v_dam.keeper, v_dam.name || ' drops a young ' || lower(v_d.name)
      || ' (' || (v_coming->>'sex') || '): ' || trait_names(coalesce(v_traits, '{}'))
      || '. It is at the token until it is grown.', 'event');
  end if;
  return v_born;
end $$;

/** Every hour that has come on this island, whoever was watching. */
create or replace function herd_settle(p_world uuid) returns int language plpgsql as $$
declare r record; n int := 0;
begin
  for r in select id from creature where world_id = p_world and due is not null and due <= now()
    order by id
  loop
    if give_birth(p_world, r.id) > 0 then n := n + 1; end if;
  end loop;
  return n;
end $$;

/** What somebody with this much husbandry can read off a beast's blood. */
create or replace function blood_read(p_world uuid, p_uid uuid, c creature) returns text
  language plpgsql stable as $$
declare skill double precision; seen text[]; hidden int; d species_def; carrying text;
begin
  select * into d from species_def where id = c.species;
  skill := skill_of(p_world, p_uid, 'animal_husbandry');
  -- Blood does not read itself. Without the skill you can see that there is
  -- something in it; with the skill you can see what.
  select array_agg(t.id order by t.ord) into seen
  from unnest(coalesce(c.traits, '{}')) with ordinality t(id, ord)
  join trait_def td on td.id = t.id
  join tier_odds o on o.tier = td.tier
  where walks(p_world, p_uid, 'knowledge', 3) or skill >= 1 + o.level;
  seen := coalesce(seen, '{}');
  hidden := coalesce(array_length(c.traits, 1), 0) - coalesce(array_length(seen, 1), 0);
  carrying := case when c.due is not null
    then ' She is in young, due in about '
         || clock_left(extract(epoch from (c.due - now()))) || '.' else '' end;
  return c.name || ', ' || c.sex || ' ' || lower(d.name) || ', ' || age_of(c.born)
    || ' and ' || care_word(c.care) || '. It carries '
    || case when array_length(seen, 1) > 0 then trait_names(seen) else 'nothing you can read' end
    || case when hidden > 0 then ', and ' || case when hidden = 1 then 'one thing'
                                                  else hidden || ' things' end
                                 || ' you cannot read yet' else '' end
    || '.' || carrying;
end $$;

select private.lock_doors();
