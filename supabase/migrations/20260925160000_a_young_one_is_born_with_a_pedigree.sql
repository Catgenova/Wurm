/*
 * A pedigree on the creature window.
 *
 * Asked for: "A pedigree on the creature window. Show the dam, the sire and
 * which traits came from which, so breeding can be planned."
 *
 * A young one was born knowing nothing of where it came from. The covering
 * wrote its traits and its sex into the dam's `unborn` and let the sire go,
 * since what he gave was settled then; and `breed_traits` pooled the two
 * bloods before drawing on them, so which of them a trait was drawn from was
 * lost at the draw.
 *
 * So `breed_traits` says where each trait came from as it draws it, and
 * returns that beside the traits: the dam's, the sire's or both of theirs, by
 * which of them carries that very trait, grade and all; a fresh roll, for a
 * slot the wild filled or a short draw topped up; or bred up, for one that
 * came through a tier better than it was drawn. `pair_them` writes the sire's
 * id and name into `unborn` beside them, and `give_birth` gives the young one
 * a `pedigree` for good: its dam and its sire, by id and by name -- an id
 * alone would not do, since a dead creature's id goes to the next thing born
 * on the island -- and where each trait came from. The browser says the same,
 * in the same five words: `breedTraits`, `pair` and `giveBirth`.
 *
 * A young one of a covering made before this has no pedigree rather than
 * half of one, and neither has anything born before it.
 *
 * `rpc_creatures` sends it: whole for your own, and for anybody else's saying
 * where a trait came from only for the traits you can read. That rule was
 * written inside `blood_read`; it is `blood_seen` now, and both read it.
 */
set local lock_timeout = '3s';

alter table creature add column if not exists pedigree jsonb;

-- What it returns changes, which `create or replace` will not do.
drop function if exists public.breed_traits(text[], text[], double precision, double precision);

/*
 * What a pairing throws, and where each trait came from, as
 * {"traits": [...], "from": {trait: "dam" | "sire" | "both" | "roll" | "up"}}.
 */
CREATE OR REPLACE FUNCTION public.breed_traits(p_sire text[], p_dam text[], p_husbandry double precision, p_care double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare pool text[]; keep double precision; up double precision; lift double precision; out_t text[] := '{}';
        slot int; left_t text[]; weights double precision[]; total double precision; r double precision;
        i int; pick text; v_above text; v_family text; v_up text;
        v_from jsonb := '{}'; v_source text;
begin
  select array_agg(distinct t) into pool from unnest(p_sire || p_dam) t;
  pool := coalesce(pool, '{}');
  keep := inherit_chance(p_husbandry, p_care);
  up := upgrade_chance(p_husbandry, p_care);
  lift := greatest(0, least(100, p_husbandry)) / 100;
  for slot in 1..trait_slots() loop
    -- What the pair carry that the foal does not, by name.
    select array_agg(t) into left_t from unnest(pool) t where not (trait_family(t) = any(trait_families(out_t)));
    left_t := coalesce(left_t, '{}');
    pick := null; v_source := 'roll';
    if array_length(left_t, 1) > 0 and random() < keep then
      -- A good keeper's eye falls on the best of what the pair carry.
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
      -- Whose it was: which of them carries that very trait, grade and all.
      v_source := case when pick = any(coalesce(p_dam, '{}')) then
                    case when pick = any(coalesce(p_sire, '{}')) then 'both' else 'dam' end
                  else 'sire' end;
    else
      pick := roll_trait(out_t, p_husbandry);
    end if;
    if pick is null then continue; end if;
    -- And then the chance that it comes through better than it went in.
    if random() < up then
      v_above := null; v_up := null;
      select o2.tier into v_above from trait_def d
        join tier_odds o on o.tier = d.tier join tier_odds o2 on o2.ord = o.ord + 1
        where d.id = pick;
      if v_above is not null then
        select d.family into v_family from trait_def d where d.id = pick;
        if v_family is not null then
          select d.id into v_up from trait_def d where d.family = v_family and d.tier = v_above;
        else
          select d.id into v_up from trait_def d
            where d.tier = v_above and d.family is null and not (d.id = any(out_t))
            order by random() limit 1;
        end if;
        if v_up is not null then pick := v_up; v_source := 'up'; end if;
      end if;
    end if;
    if not (trait_family(pick) = any(trait_families(out_t))) then
      out_t := out_t || pick;
      v_from := v_from || jsonb_build_object(pick, v_source);
    end if;
  end loop;
  -- A short straw in the draw never leaves a foal with fewer than three.
  while coalesce(array_length(out_t, 1), 0) < trait_slots() loop
    pick := roll_trait(out_t, p_husbandry);
    exit when pick is null;
    out_t := out_t || pick;
    v_from := v_from || jsonb_build_object(pick, 'roll');
  end loop;
  return jsonb_build_object('traits', to_jsonb(out_t), 'from', v_from);
end $function$;

/* Put a sire to a dam: what she carries, who by, and where each trait of it came from. */
CREATE OR REPLACE FUNCTION public.pair_them(p_world uuid, p_dam integer, p_sire integer, p_husbandry double precision)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
/*
 * `v_care`, not `care`. The eighth time this class has bitten: a local called
 * `care` inside an `update creature` is not a local, it is the column, and
 * Postgres says "ambiguous" if you are lucky. Alias every table, prefix every
 * local — the rule has not changed and neither has the mistake.
 */
declare dam creature; sire creature; v_care double precision; v_bred jsonb;
begin
  select * into dam from creature where world_id = p_world and id = p_dam;
  select * into sire from creature where world_id = p_world and id = p_sire;
  v_care := (dam.care + sire.care) / 2;
  v_bred := breed_traits(sire.traits, dam.traits, p_husbandry, v_care);
  -- The sire is written down now, by id and by name, with where each trait
  -- came from: he need not be about when the hour comes.
  update creature set
      unborn = jsonb_build_object(
        'traits', v_bred->'traits',
        'sex', case when random() < 0.5 then 'male' else 'female' end,
        'sire', jsonb_build_object('id', sire.id, 'name', sire.name),
        'from', v_bred->'from'),
      due = now() + make_interval(secs => gestation()),
      bred_at = now()
    where world_id = p_world and id = p_dam;
  update creature set bred_at = now() where world_id = p_world and id = p_sire;
end $function$;

/* The hour comes, and the young one is born with its pedigree. */
CREATE OR REPLACE FUNCTION public.give_birth(p_world uuid, p_id integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
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
        v_mode text; v_where text := ''; v_crate bigint; v_placed bigint;
begin
  select * into v_dam from creature where world_id = p_world and id = p_id for update;
  if not found or v_dam.due is null or v_dam.due > now() then return 0; end if;
  v_coming := v_dam.unborn;
  update creature set unborn = null, due = null where world_id = p_world and id = p_id;
  if v_coming is null then return 0; end if;
  select * into v_d from species_def where id = v_dam.species;
  v_nx := creature_x(v_dam); v_ny := creature_y(v_dam);
  /*
   * Where it goes, now that nothing is kept at the token: where a tamed one
   * goes, and then a crate standing on the settlement -- with its keeper's
   * name on it, which a young one born at the token never had.
   *
   * A dam that is nobody's drops a wild one. Otherwise it follows its keeper
   * when nothing else does; goes into an empty creature crate in their pack
   * when something does; and, when they carry none, into an empty one of
   * theirs standing on their settlement, the nearest the dam. With none of
   * those it goes off into the wild.
   */
  v_mode := 'wild';
  if v_dam.keeper is not null and v_dam.mode <> 'wild' then
    if companion_of(p_world, v_dam.keeper) is null then
      v_mode := 'active';
      select py.x, py.y into v_home from player py where py.world_id = p_world and py.uid = v_dam.keeper;
      if found then v_nx := v_home.x; v_ny := v_home.y; end if;
      v_where := ' It follows you.';
    else
      v_crate := empty_crate(p_world, v_dam.keeper);
      if v_crate is null then v_placed := standing_crate(p_world, v_dam.keeper, v_nx, v_ny); end if;
      if v_crate is not null then
        v_mode := 'stored';
        v_where := ' It goes into the creature crate in your pack.';
      elsif v_placed is not null then
        v_mode := 'stored';
        select ' It goes into the empty creature crate at (' || pl.x || ', ' || pl.y || ') on '
               || coalesce((my_deed(p_world, v_dam.keeper)).name, 'your settlement') || '.'
          into v_where from placed pl where pl.id = v_placed;
      else
        v_where := ' Something already follows you and there is no empty creature crate in your pack or standing on your settlement, so it goes off into the wild.';
      end if;
    end if;
  end if;
  v_born := creature_spawn(p_world, v_dam.species, v_nx, v_ny,
    case when v_mode = 'stored' then 'active' else v_mode end, now(),
    case when v_mode = 'wild' then null else v_dam.keeper end);
  select array_agg(t) into v_traits from jsonb_array_elements_text(v_coming->'traits') t;
  /*
   * And its pedigree, for good: the dam as she is now, and the sire and where
   * each trait came from as the covering wrote them down. A young one of a
   * covering made before pedigrees were kept has none, rather than half of one.
   */
  update creature set traits = coalesce(v_traits, '{}'), sex = v_coming->>'sex',
      hunger = 0.9, care = 0.5,
      pedigree = case when v_coming ? 'sire' then jsonb_build_object(
        'dam', jsonb_build_object('id', v_dam.id, 'name', v_dam.name),
        'sire', v_coming->'sire',
        'from', coalesce(v_coming->'from', '{}'::jsonb)) end
    where world_id = p_world and id = v_born;
  update creature c set health = max_health(c) where c.world_id = p_world and c.id = v_born;
  if v_mode = 'stored' then perform crate_shut_in(p_world, v_born, v_crate, v_placed); end if;
  if v_dam.keeper is not null then
    perform journal_note(p_world, v_dam.keeper, 'bred');
    -- Blood worth keeping, which is the whole point of putting two together.
    if exists (select 1 from unnest(coalesce(v_traits, '{}')) t
               join trait_def td on td.id = t where td.tier in ('supreme', 'fantastic')) then
      perform journal_note(p_world, v_dam.keeper, 'goodblood');
    end if;
    perform tell(p_world, v_dam.keeper, v_dam.name || ' drops a young ' || lower(v_d.name)
      || ' (' || (v_coming->>'sex') || '): ' || trait_names(coalesce(v_traits, '{}'))
      || '.' || v_where, 'event');
  end if;
  return v_born;
end $function$;

/*
 * Which of these traits somebody can read off an animal, in the order it
 * carries them: all of them on the third step of the way of knowledge, and
 * otherwise each whose tier's level in `tier_odds` is at least one under
 * their husbandry. What `blood_read` names and the card's chips name, and so
 * all that a pedigree may say where it came from. The browser's `read_blood`
 * and its card keep the same rule.
 */
create or replace function blood_seen(p_world uuid, p_uid uuid, p_traits text[]) returns text[]
language sql stable as $$
  select coalesce(array_agg(t.id order by t.ord), '{}')
    from unnest(coalesce(p_traits, '{}')) with ordinality t(id, ord)
    join trait_def td on td.id = t.id
    join tier_odds o on o.tier = td.tier
   where walks(p_world, p_uid, 'knowledge', 3)
      or skill_of(p_world, p_uid, 'animal_husbandry') >= 1 + o.level
$$;

/* What somebody can read off a beast, through `blood_seen`. */
CREATE OR REPLACE FUNCTION public.blood_read(p_world uuid, p_uid uuid, c creature)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare seen text[]; hidden int; d species_def; carrying text;
begin
  select * into d from species_def where id = c.species;
  -- Blood does not read itself. Without the skill you can see that there is
  -- something in it; with the skill you can see what.
  seen := blood_seen(p_world, p_uid, c.traits);
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
    || '.'
    -- And what that blood is actually worth, which the line had never said.
    -- Only over what can be read: a trait you cannot name is a trait whose
    -- figure you have not earned either.
    || coalesce(' That blood comes to ' || trait_worth(seen) || '.', '') || carrying;
end $function$;

/*
 * Somebody else's young one's pedigree, as far as you can read it: its dam and
 * its sire, and where a trait came from only for the traits `blood_seen` lets
 * you read.
 */
create or replace function pedigree_seen(p_world uuid, p_uid uuid, p_pedigree jsonb) returns jsonb
language sql stable as $$
  select (p_pedigree - 'from') || jsonb_build_object('from', coalesce((
    select jsonb_object_agg(s.id, p_pedigree->'from'->s.id)
      from unnest(blood_seen(p_world, p_uid,
             array(select jsonb_object_keys(coalesce(p_pedigree->'from', '{}'::jsonb))))) s(id)),
    '{}'::jsonb))
$$;

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
      'mode', c.mode, 'stance', c.stance, 'job', c.job, 'shod', shod(c),
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
      'sex', c.sex, 'age', age_of(c.born), 'traits', c.traits,
      'hunting', c.hunting = me, 'mine', coalesce(c.keeper = me, false),
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

select private.lock_doors();
