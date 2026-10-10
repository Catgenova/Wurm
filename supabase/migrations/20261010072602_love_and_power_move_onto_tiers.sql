/*
 * Meditation, phase two: Love and Power move onto the tiers Knowledge took in
 * phase one (`src/game/meditation.ts`, `the_reader_moves_onto_tiers.sql`).
 *
 * `path_def.moved` is true for both now, written by the definitions, so
 * neither has a step left (`path_step` holds no rows) and `walks`,
 * `ability_of` and `work_ability` find nothing. Everything their steps were
 * read for reads a pick instead (`path_fx`), and every new pick is read where
 * its rule is:
 *
 *   * Love: Green Thumb (`crop_per`, `crops_settle`, `planters_settle`, off
 *     the founder of the ground as ever), Gentle Hand and Old Friend
 *     (`tame_chance`, Old Friend off the field guide's `tamed`), Kin (`kept`,
 *     read through `age_pace` by every reader of an age), Abundance
 *     (`reap_what`, and fruit in `perform_ground`), Steady Herd
 *     (`companion_target`), Long Table (`grant_boon`), Good Stock
 *     (`pair_them`), Season's Hand (`crop.hand`, stamped at sowing, and the
 *     clock it grows on, `hand_clock`) and Bloom (`path_bloom`, after a
 *     sitting in `perform_faith`); and Refresh, Bond, Gather, Lull and Heart
 *     of the Herd (`path_technique_cast`; the last read by `herd_heart`).
 *   * Power: Strong Back is the browser's alone, as it always was -- nothing
 *     here knows a burden; Long Stride and Surge (`travel_speed`, `rpc_move`),
 *     Sure Feet and Sure Fall (`walk_share`), Hard Breath, Deep Lungs,
 *     Enduring and Unbroken (`body_settle`, `spend_wind`, the class spell
 *     door), Ironhide and Hard to Kill (`hurt_player`, Ironhide counted down
 *     here for the first time), Unshaken (`hunt_settle`), Pack Mule
 *     (`carry_limit`); and Second Wind, Deep Lungs, Shrug, Surge and Unbroken
 *     (`path_technique_cast`).
 *
 * Fury, Hard Hands and Mend the Flesh are gone: damage is a fighting trade's,
 * and healing the Blessing's. Somebody who walks Love or Power keeps their
 * path and takes a pick at each tier their meditation has reached; their old
 * steps stop, because there are none to read.
 *
 * What a technique leaves running is kept with the faith's and the trades'
 * (`player.blessings`, `path_*`), and said on the beat (`path_beat`).
 *
 * `supabase/test/meditation.ts` holds the two sides to each other.
 */
set local lock_timeout = '3s';

-- Bloom's day, and when a Hard to Kill last took a killing blow. One alter, so one lock.
alter table player
  add column if not exists bloom_day bigint,
  add column if not exists kill_saved_at timestamptz;

-- A field sown with Love's Season's Hand, which grows on its own clock (`hand_clock`).
alter table crop add column if not exists hand boolean not null default false;

/* ------------------------------------------------------------------ *
 * What a technique leaves running, and the rules the picks read.
 * ------------------------------------------------------------------ */

/** Whether one of a path's techniques is still running on somebody: a `path_*` key of `blessings`. */
create or replace function path_running(p_world uuid, p_uid uuid, p_key text) returns boolean language sql stable as $$
  select coalesce((select (pl.blessings->p_key->>'until')::timestamptz > now() from player pl
                    where pl.world_id = p_world and pl.uid = p_uid), false)
$$;

/** Seconds left of one, for the beat. */
create or replace function path_left(p player, p_key text) returns double precision language sql stable as $$
  select greatest(0, coalesce(extract(epoch from ((p.blessings->p_key->>'until')::timestamptz - now())), 0))
$$;

/** Put one running for so many seconds. */
create or replace function path_start(p_world uuid, p_uid uuid, p_key text, p_secs double precision) returns void language sql as $$
  update player set blessings = coalesce(blessings, '{}'::jsonb)
      || jsonb_build_object(p_key, jsonb_build_object('until', now() + make_interval(secs => p_secs)))
   where world_id = p_world and uid = p_uid
$$;

/**
 * Kin (Love's): the share of the time it has lived that a creature's age
 * counts, off what its keeper's discipline stamped on it (`kept:age`).
 */
create or replace function age_pace(c creature) returns double precision language sql stable as $$
  select coalesce((c.kept->>'kept:age')::double precision, 1)
$$;

/** How old something is, its life counted at `p_pace` of itself (`ageOf`). */
create or replace function age_of(p_born timestamptz, p_old_at double precision, p_pace double precision) returns text
  language sql stable as $$
  select case
    when p_born is null then 'grown'
    when extract(epoch from (now() - p_born)) * p_pace < young_for() then 'young'
    when extract(epoch from (now() - p_born)) * p_pace < coalesce(p_old_at, old_at()) then 'grown'
    else 'old' end
$$;
create or replace function age_row(p_born timestamptz, p_old_at double precision, p_pace double precision) returns age_def
  language sql stable as $$ select * from age_def where id = age_of(p_born, p_old_at, p_pace) $$;

/**
 * What keeping a beast comes to under its keeper: their perks' `kept:` keys
 * (a Herdsman's), and their path's (Love's Kin), as the browser's
 * `refreshKept` puts them together.
 */
create or replace function kept_of(p_world uuid, p_uid uuid) returns jsonb language sql stable as $$
  select nullif(
    coalesce((select jsonb_object_agg(e.key, e.value)
                from player pl, jsonb_each(coalesce(pl.class_mul->'fx', '{}'::jsonb)) e
               where pl.world_id = p_world and pl.uid = p_uid and e.key like 'kept:%'), '{}'::jsonb)
    || coalesce((select jsonb_object_agg(e.key, e.value)
                   from path_taken t join path_pick k on k.id = t.pick
                   join player pl on pl.world_id = t.world_id and pl.uid = t.uid, jsonb_each(k.fx) e
                  where t.world_id = p_world and t.uid = p_uid and k.kind = 'discipline'
                    and pl.way = k.path and path_moved(k.path) and e.key like 'kept:%'), '{}'::jsonb),
    '{}'::jsonb)
$$;

/**
 * Heart of the Herd (Love's): what a blow on (`taken`) or by (`dealt`) a
 * companion is worth while its keeper's holds and it is within the
 * technique's reach of them; one otherwise (`Game.herdMul`).
 */
create or replace function herd_heart(c creature, p_way text) returns double precision language sql stable as $$
  select coalesce((
    select case when p_way = 'taken' then 1 - (k.fx->>'cut')::double precision else 1 + (k.fx->>'more')::double precision end
      from player pl, path_pick k
     where c.mode = 'active' and c.keeper is not null and pl.world_id = c.world_id and pl.uid = c.keeper
       and k.id = 'love_herd_heart' and (pl.blessings->'path_herd'->>'until')::timestamptz > now()
       and sqrt((creature_x(c) - pl.x) ^ 2 + (creature_y(c) - pl.y) ^ 2) <= (k.fx->>'reach')::double precision), 1)
$$;

/**
 * Hard to Kill (Power's), at a blow that would kill: at most once in its
 * `every` seconds, the body stands at its `kill` of its health instead, and
 * is told (`hardToKillSaid`). Whether it did.
 */
create or replace function path_hard_to_kill(p_world uuid, p_uid uuid) returns boolean language plpgsql as $$
declare k path_pick; p player;
begin
  select * into k from path_pick where id = 'power_hard_to_kill';
  if k.id is null or not path_holds(p_world, p_uid, k.id) then return false; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if p.kill_saved_at is not null and now() - p.kill_saved_at < make_interval(secs => (k.fx->>'every')::double precision) then
    return false;
  end if;
  update player set kill_saved_at = now(),
         stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{health}', to_jsonb((k.fx->>'kill')::double precision))
   where world_id = p_world and uid = p_uid;
  perform tell(p_world, p_uid, 'You should be dead. You are not: you stand at '
    || round((k.fx->>'kill')::numeric * 100)::int || '% of your health.', 'fight');
  return true;
end $$;

/**
 * Bloom (Love's), at the end of a sitting: every tree within its reach of the
 * one sitting a stage on, by the stages Bless the Land grows a tree by, once
 * a day of the island's clock -- the first sitting that finds one to grow.
 * How many grew (`bloomSitting`).
 */
create or replace function path_bloom(p_world uuid, p_uid uuid) returns int language plpgsql as $$
declare p player; v_r double precision := path_fx(p_world, p_uid, 'bloom', 0); v_day bigint; v_size int;
        v_tx int; v_ty int; v_data int; v_next int; v_n int := 0; v_tree int := tile_id('Tree');
begin
  if v_r <= 0 then return 0; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  v_day := floor(world_time(p_world) / day_seconds())::bigint;
  if p.bloom_day is not distinct from v_day then return 0; end if;
  select size into v_size from world where id = p_world;
  for v_ty in greatest(0, floor(p.y - v_r)::int) .. least(v_size - 1, floor(p.y + v_r)::int) loop
    for v_tx in greatest(0, floor(p.x - v_r)::int) .. least(v_size - 1, floor(p.x + v_r)::int) loop
      continue when (v_tx + 0.5 - p.x) ^ 2 + (v_ty + 0.5 - p.y) ^ 2 > v_r ^ 2;
      continue when land_tile(p_world, v_tx, v_ty) is distinct from v_tree;
      v_data := land_data(p_world, v_tx, v_ty);
      v_next := null;
      select a.next into v_next from tree_age_def a join tree_age_def b on b.id = a.next
       where a.id = tree_age(v_data) and a.alive and b.alive and a.next <> a.id;
      continue when v_next is null;
      perform land_set_data(p_world, v_tx, v_ty, (v_data & 143) | (v_next << 4));
      perform land_announce(p_world, v_tx, v_ty);
      v_n := v_n + 1;
    end loop;
  end loop;
  if v_n > 0 then update player set bloom_day = v_day where world_id = p_world and uid = p_uid; end if;
  return v_n;
end $$;

/* ------------------------------------------------------------------ *
 * Season's Hand: a field that grows through winter.
 * ------------------------------------------------------------------ */

/**
 * The field clock of a Season's Hand (`handClock`): `field_clock` with its
 * winter at `hand_winter()` rather than standing still, step for step.
 */
create or replace function hand_clock(p_at timestamptz) returns double precision language plpgsql stable as $$
declare
  t double precision := extract(epoch from p_at)::double precision;
  f double precision := year_from();
  s double precision := season_seconds();
  r double precision[] := season_growth();
  v_pin text := season_pinned();
  y double precision;
  d double precision; k double precision; w double precision; g double precision; i int;
begin
  r[array_position(seasons(), 'winter')] := hand_winter();
  y := year_growth() + hand_winter() * s;
  if v_pin is not null then return f + (t - f) * r[array_position(seasons(), v_pin)]; end if;
  if t < f then return f + (t - f) * yearless_growth(); end if;
  d := t - f;
  k := floor(d / year_seconds());
  w := d - k * year_seconds();
  g := f + k * y;
  for i in 1 .. array_length(r, 1) loop
    g := g + r[i] * least(greatest(w - (i - 1) * s, 0), s);
  end loop;
  return g;
end $$;

/** And back (`handMoment`): the moment a Season's Hand's clock reads `p_g`. */
create or replace function hand_moment(p_g double precision) returns double precision language plpgsql stable as $$
declare
  f double precision := year_from();
  s double precision := season_seconds();
  r double precision[] := season_growth();
  v_pin text := season_pinned();
  y double precision;
  e double precision; k double precision; rem double precision; t0 double precision; most double precision;
  i int; rp double precision;
begin
  r[array_position(seasons(), 'winter')] := hand_winter();
  y := year_growth() + hand_winter() * s;
  if v_pin is not null then
    rp := r[array_position(seasons(), v_pin)];
    if rp > 0 then return f + (p_g - f) / rp; end if;
    return case when p_g <= f then '-Infinity'::double precision else 'Infinity'::double precision end;
  end if;
  if p_g <= f then return f + (p_g - f) / yearless_growth(); end if;
  e := p_g - f;
  k := floor(e / y);
  rem := e - k * y;
  if rem <= 0 then
    k := k - 1;
    rem := rem + y;
  end if;
  t0 := f + k * year_seconds();
  for i in 1 .. array_length(r, 1) loop
    continue when r[i] <= 0;
    most := r[i] * s;
    if rem <= most then return t0 + (i - 1) * s + rem / r[i]; end if;
    rem := rem - most;
  end loop;
  return t0 + year_seconds();
end $$;

/** The clock a crop in the ground grows on, by name: under glass, a Season's Hand's, or a field's. */
create or replace function crop_kind(p_glass boolean, p_hand boolean) returns text language sql immutable as $$
  select case when p_glass then 'glass' when p_hand then 'hand' else 'field' end
$$;

/** A field sown by somebody with Love's Season's Hand grows on its clock: stamped as it is sown, as `glass` is. */
create or replace function hand_sown_trigger() returns trigger language plpgsql as $$
begin
  new.hand := new.sown_by is not null and path_holds(new.world_id, new.sown_by, 'love_seasons_hand');
  return new;
end $$;
drop trigger if exists hand_sown on crop;
create trigger hand_sown before insert or update of sown_by on crop
  for each row execute function hand_sown_trigger();

/* ------------------------------------------------------------------ *
 * Functions changed in place, each as it stood with the change.
 * ------------------------------------------------------------------ */

-- Gentle Hand off the pick (`path_fx`), and Love's Old Friend: a kind you have tamed before is certain.
CREATE OR REPLACE FUNCTION public.tame_chance(p_world uuid, p_uid uuid, c creature)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select case when d.monster then 0
    -- Love's Old Friend: a kind you have tamed before is taken at the first offering (`tameChance`).
    when path_fx(p_world, p_uid, 'sure', 0) > 0
         and exists (select 1 from guide g where g.world_id = p_world and g.uid = p_uid and g.species = c.species and g.tamed) then 1
    else
    -- And a Kinship's points on top of whatever the rest comes to (`faith_kinship`).
    least(0.95, greatest(0, least(0.95, (d.tame_chance
      + (skill_of(p_world, p_uid, 'taming') - d.tame_level) / 200
      + case when c.hunger < 0.5 then 0.1 else 0 end
      + coax_bonus(c, pk(p_world, p_uid, 'coax:step', coax_step()))
      + greatest(0, (skill_of(p_world, p_uid, 'soul_strength') - 20) * 0.002))
      -- A young one easier still for a Herdsman's Young Trust.
      * case when age_of(c.born, old_of(c), age_pace(c)) = 'young' then pk(p_world, p_uid, 'tame:young', (age_row(c.born, old_of(c), age_pace(c))).tame)
             else (age_row(c.born, old_of(c), age_pace(c))).tame end
      -- Love's Gentle Hand.
      * path_fx(p_world, p_uid, 'tame', 1)
      * class_mul(p_world, p_uid, 'tame', 'soul_strength')
      -- And every offering so many points likelier for a Herdsman's Soft Hand, over all the rest of it.
      + pk(p_world, p_uid, 'tame:offer', 0))) + faith_kinship(p_world, p_uid, c.id)) end
  from species_def d where d.id = c.species
$function$;

-- Green Thumb off the founder's pick (`path_fx`).
CREATE OR REPLACE FUNCTION public.crop_per(p_world uuid, p_id text, p_pace double precision, p_x integer, p_y integer)
 RETURNS double precision
 LANGUAGE plpgsql
 STABLE
AS $function$
begin
  return (select d.stage_seconds from crop_def d where d.id = p_id) * p_pace
    -- Love's Green Thumb, for whoever founded the ground it is in.
    * coalesce((select min(path_fx(p_world, dd.founded_by, 'grow', 1)) from deed dd where dd.world_id = p_world
                  and abs(p_x - dd.x) <= dd.radius and abs(p_y - dd.y) <= dd.radius), 1);
end $function$;

-- Green Thumb off the founder's pick, and a Season's Hand's field on its own clock (`hand_clock`).
CREATE OR REPLACE FUNCTION public.crops_settle(p_world uuid, p_x double precision, p_y double precision, p_range double precision)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare n int;
begin
  with near as (
    select c.x, c.y, c.stage, c.stage_at, c.glass, c.hand,
           /*
            * The gardener's path, which is the one effect of a path belonging
            * to somebody who is not here. A crop grows for whoever founded the
            * ground it is in, not for whoever happens to be looking at it.
            */
           -- And the pace it was sown at: a Farmer's Fast Growth and Crop Rotation.
           d.stage_seconds * c.pace * coalesce((
               select min(path_fx(p_world, dd.founded_by, 'grow', 1)) from deed dd where dd.world_id = p_world
                 and abs(c.x - dd.x) <= dd.radius and abs(c.y - dd.y) <= dd.radius), 1) as per
      from crop c join crop_def d on d.id = c.id
     where c.world_id = p_world and c.stage < crop_ripe()
       -- The box first, which `crop_pkey` is keyed on. See the note in
       -- `rpc_ground`.
       and c.x between floor(p_x - p_range)::int - 1 and floor(p_x + p_range)::int + 1
       and c.y between floor(p_y - p_range)::int - 1 and floor(p_y + p_range)::int + 1
       and greatest(abs(c.x + 0.5 - p_x), abs(c.y + 0.5 - p_y)) <= p_range
  ), due as (
    -- On the field clock: a winter adds nothing, and a stage is still its own length added on.
    select n.x, n.y, s.o_stage, s.o_stage_at, s.o_steps
      from near n cross join lateral crop_settled(n.stage, n.stage_at, n.per, false) s
     where not n.glass and not n.hand
    -- And a field sown with Love's Season's Hand on its clock, which a winter does not stop (`hand_clock`).
    union all
    select n.x, n.y, s.o_stage, s.o_stage_at, s.o_steps
      from near n cross join lateral crop_settled_on(n.stage, n.stage_at, n.per, 'hand') s
     where not n.glass and n.hand
    -- And under glass on the glass clock, which runs in every season (`glasshouse.ts`).
    union all
    select n.x, n.y, s.o_stage, s.o_stage_at, s.o_steps
      from near n cross join lateral crop_settled_on(n.stage, n.stage_at, n.per, 'glass') s
     where n.glass
  )
  update crop c set stage = due.o_stage, stage_at = due.o_stage_at, tended_now = false
    from due
   where c.world_id = p_world and c.x = due.x and c.y = due.y and due.o_steps > 0;
  get diagnostics n = row_count;
  return n;
end $function$;

-- Green Thumb off the founder's pick.
CREATE OR REPLACE FUNCTION public.planters_settle(p_world uuid, p_x double precision, p_y double precision, p_range double precision)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare n int;
begin
  with near as (
    select c.placed, c.stage, c.stage_at,
           /*
            * `planter_per`, written out as `crops_settle` writes out its own:
            * called once a row, it cost more than the rest of the settling
            * put together.
            */
           d.stage_seconds * c.pace * coalesce((
               select min(path_fx(p_world, dd.founded_by, 'grow', 1)) from deed dd where dd.world_id = p_world
                 and abs(p.x - dd.x) <= dd.radius and abs(p.y - dd.y) <= dd.radius), 1) as per
      from planter_crop c join placed p on p.id = c.placed join crop_def d on d.id = c.id
     where c.world_id = p_world and c.stage < crop_ripe()
       and p.x between floor(p_x - p_range)::int - 1 and floor(p_x + p_range)::int + 1
       and p.y between floor(p_y - p_range)::int - 1 and floor(p_y + p_range)::int + 1
       and greatest(abs(p.cx - p_x), abs(p.cy - p_y)) <= p_range
  ), due as (
    select n.placed, s.o_stage, s.o_stage_at, s.o_steps
      from near n cross join lateral crop_settled(n.stage, n.stage_at, n.per, true) s
  )
  update planter_crop c set stage = due.o_stage, stage_at = due.o_stage_at, tended_now = false
    from due
   where c.placed = due.placed and due.o_steps > 0;
  get diagnostics n = row_count;
  return n;
end $function$;

-- Abundance off the pick, rounded as the browser rounds (`reapOne`).
CREATE OR REPLACE FUNCTION public.reap_what(p_world uuid, p_uid uuid, p_id text, p_tended integer, p_ql double precision, p_skill double precision, OUT o_produce text, OUT o_got integer, OUT o_seed text, OUT o_seeds integer, OUT o_ql double precision, OUT o_rare text)
 RETURNS record
 LANGUAGE plpgsql
AS $function$
declare cd crop_def; yld int[]; v_grass int;
begin
  select * into cd from crop_def where id = p_id;
  if cd.id is null then return; end if;
  yld := crop_yield(p_tended);
  if p_tended >= crop_ripe() then
    yld[2] := yld[2] + floor(pk(p_world, p_uid, 'bumper:harvest_crop', 0))::int;
  end if;
  -- The crop's own quality, lifted by the farmer's skill at harvest.
  o_ql := greatest(1, least(100, (p_ql + product_ql(p_skill, 0)) / 2));
  -- Love's Abundance takes more out of the same ground, a half rounded up as the browser rounds it.
  o_got := greatest(1, floor(yld[2] * path_fx(p_world, p_uid, 'harvest', 1) + 0.5)::int)
         + floor(pk(p_world, p_uid, 'plus:' || cd.produce, 0))::int;
  o_rare := perk_rare(pk(p_world, p_uid, 'rare:harvest_crop', 0));
  o_produce := cd.produce;
  o_seed := cd.seed;
  o_seeds := yld[1];
  perform gather(p_world, p_uid, cd.produce, o_got, o_ql, null, o_rare);
  perform gather(p_world, p_uid, cd.seed, o_seeds, o_ql);
  v_grass := floor(pk(p_world, p_uid, 'fodder:harvest_crop', 0))::int;
  if v_grass > 0 then perform give(p_world, p_uid, 'mixed_grass', v_grass, o_ql); end if;
end $function$;

-- Hard Hands and Fury are gone: damage is a fighting trade's.
CREATE OR REPLACE FUNCTION public.weapon_damage(p_world uuid, p_uid uuid, w weapon_def, it item)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select w.damage
    * case when it.id is null then 1 else mat_edge(it.extra) * rarity_boost(it.rare) end
    * (0.55 + coalesce(it.ql, 20) / 180)
    * case when it.id is null then 1 else greatest(0.4, 1 - it.dmg / 150) end
    * (0.7 + skill_of(p_world, p_uid, 'body_strength') / 90)
    * (1 + (skill_of(p_world, p_uid, w.kind) + skill_of(p_world, p_uid, 'fighting')) / 260)
    -- And the trade, scoped on the weapon's own kind, so a swordsman's edge is
    -- nothing at all to somebody holding an axe.
    * class_mul(p_world, p_uid, 'edge', w.kind)
    -- And what its maker put into it: a Carpenter's Bowyer's Draw.
    * case when it.id is null then 1 else mark_of(it.mark, 'damage') end
    -- And a fighting trade's mastery of this kind of weapon (a Berserker's Axe Mastery: `dmg:axes`).
    * pk(p_world, p_uid, 'dmg:' || w.kind, 1)
$function$;

-- Fruit picked comes to more for Love's Abundance.
CREATE OR REPLACE FUNCTION public.perform_ground(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; cx int; cy int; here int; t tile_def; v_data int; v_tree tree_def;
        d action_def; v_spoil text;
        v_skill double precision; v_tool double precision; v_ql double precision; v_n int; v_slab item; v_kind int; v_target int; v_hi record; v_lo record;
        v_rock rock_def; v_rad int; v_tiles int[] := '{}'; v_names text[] := '{}'; v_row record;
        v_id bigint; v_species int; v_sprout item; v_buried text; v_size int;
        v_age tree_age_def; v_to tree_age_def; v_needs double precision; v_grown int; v_cut int;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  here := land_tile(p_world, tx, ty);
  select * into t from tile_def where id = here;
  v_data := land_data(p_world, tx, ty);
  select * into d from action_def where id = p_action;
  -- What this ground is made of, which digging has always read off the tile
  -- and flattening never did.
  v_spoil := coalesce(t.dig_yield, 'dirt');

  -- A flight of garden steps, laid or taken up (`perform_steps`).
  if p_action in ('lay_steps', 'lay_timber_steps', 'take_up_steps') then
    perform perform_steps(p_world, p_uid, p_action, p_target);
    return;
  end if;

  if p_action in ('take_level', 'clear_level') then
    if p_action = 'clear_level' then
      update player set level_h = null where world_id = p_world and uid = p_uid;
      perform tell(p_world, p_uid,
        'You put the level away. Flattening works to the ground you stand on again.', 'event');
    else
      cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
      update player set level_h = land_height(p_world, cx, cy) where world_id = p_world and uid = p_uid;
      perform tell(p_world, p_uid, 'You sight the level at ' || land_height(p_world, cx, cy)
        || '. Flattening works to it, and digging, dropping and concrete stop at it.', 'event');
    end if;
    return;
  end if;

  if p_action = 'flatten' then
    v_target := flatten_target(p_world, p_uid, tx, ty);
    -- The corners furthest above and below the height we are working towards.
    /*
     * The high corner has to be soil, because a shovel does not move rock. It
     * used to be the highest corner whatever it was made of, and a tile with
     * one rock shoulder on it stopped the whole run dead with "Mine it down
     * instead" while the other three corners still had work in them. The rock
     * is stepped round now and named at the end.
     */
    select c.cx, c.cy into v_hi from tile_corners(tx, ty) c
      where land_height(p_world, c.cx, c.cy) > v_target and land_dirt(p_world, c.cx, c.cy) > 0
      order by land_height(p_world, c.cx, c.cy) desc limit 1;
    select c.cx, c.cy into v_lo from tile_corners(tx, ty) c
      where land_height(p_world, c.cx, c.cy) < v_target
      order by land_height(p_world, c.cx, c.cy) limit 1;
    if v_hi.cx is null and v_lo.cx is null then
      perform tell(p_world, p_uid,
        case when exists (select 1 from tile_corners(tx, ty) c
                           where land_height(p_world, c.cx, c.cy) > v_target and land_dirt(p_world, c.cx, c.cy) <= 0)
             then 'What is still standing high here is bare rock. Mine it down.'
             else 'There is nothing left to move here.' end, 'error');
      return;
    end if;
    /*
     * A go moves `flatten_step` -- two units for a Terraformer's Level Hand --
     * but never past the height being worked to, so a corner one short of it
     * moves the one.
     */
    v_n := pk(p_world, p_uid, 'flatten:step', flatten_step())::int;
    if v_hi.cx is not null then
      v_n := least(v_n, land_height(p_world, v_hi.cx, v_hi.cy) - v_target, land_dirt(p_world, v_hi.cx, v_hi.cy));
    end if;
    if v_lo.cx is not null then v_n := least(v_n, v_target - land_height(p_world, v_lo.cx, v_lo.cy)); end if;
    v_n := greatest(1, v_n);
    if v_hi.cx is not null and v_lo.cx is not null then
      -- One corner down and one up: the dirt simply moves across the tile.
      perform raise_corner(p_world, v_hi.cx, v_hi.cy, -v_n);
      perform raise_corner(p_world, v_lo.cx, v_lo.cy, v_n);
      perform tell(p_world, p_uid, 'You move some dirt across the tile.', 'event');
    elsif v_hi.cx is not null then
      perform raise_corner(p_world, v_hi.cx, v_hi.cy, -v_n);
      perform gather(p_world, p_uid, v_spoil, v_n,
        least(100, product_ql(skill_of(p_world, p_uid, d.skill), tool_ql(p_world, p_uid, 'shovel'))
                   * pk(p_world, p_uid, 'ql:flatten', 1)));
      perform tell(p_world, p_uid, 'You scrape the ground down and pocket the '
        || lower((select name from item_def where id = v_spoil)) || '.', 'event');
    else
      /*
       * Its own stuff first and dirt after. Dirt fills anything, and it would
       * be a strange rule that let you take clay out of a bank and not put it
       * back.
       */
      if take_spoil(p_world, p_uid, v_spoil) then
        perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
        -- And the second unit of a Level Hand's go, if there is soil for it.
        if v_n > 1 and take_spoil(p_world, p_uid, v_spoil) then perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1); end if;
        perform tell(p_world, p_uid, 'You pack '
          || lower((select name from item_def where id = v_spoil))
          || ' in to bring the ground up.', 'event');
      elsif take_spoil(p_world, p_uid, 'dirt') then
        perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
        if v_n > 1 and take_spoil(p_world, p_uid, 'dirt') then perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1); end if;
        perform tell(p_world, p_uid, 'You pack dirt in to bring the ground up.', 'event');
      else
        perform tell(p_world, p_uid, 'You need '
          || lower((select name from item_def where id = v_spoil))
          || ' or dirt to bring this ground up, in the pack or in something beside you.', 'error');
        return;
      end if;
    end if;
    -- And what an hour of levelling ground teaches, which was nothing at all.
    perform skill_raise(p_world, p_uid, d.skill, 1);
    if t.turns_to_dirt then perform land_set_tile(p_world, tx, ty, 1); end if;
    perform land_announce(p_world, tx, ty);
    if not needs_flattening(p_world, p_uid, tx, ty) then
      perform tell(p_world, p_uid,
        case when floor((select x from player where world_id = p_world and uid = p_uid))::int = tx
              and floor((select y from player where world_id = p_world and uid = p_uid))::int = ty
             then 'The tile is now flat at its lowest corner.'
             else 'The tile is now flat and level with the ground you stand on.' end, 'event');
    end if;

  elsif p_action = 'drop_dirt' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    -- Dirt, clay or sand: the one named off the menu, or the first to hand.
    v_spoil := spoil_near(p_world, p_uid, target_item(p_target));
    if v_spoil is null or not take_spoil(p_world, p_uid, v_spoil) then return; end if;
    perform raise_corner(p_world, cx, cy, 1);
    -- What a spadeful covers over becomes what was in it, off the list both
    -- sides read: a clay bank or a beach can be laid now as well as dug.
    if exists (select 1 from buryable b where b.tile = here) then
      perform land_set_tile(p_world, tx, ty, spoil_tile(v_spoil));
    end if;
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You drop the ' || lower((select name from item_def where id = v_spoil))
      || ' on the ' || corner_name(tx, ty, cx, cy) || ' corner, raising the ground.', 'event');

  elsif p_action = 'raise_rock' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    -- Spent either way: concrete that slumps off is concrete gone.
    if not consume(p_world, p_uid, 'concrete', 1) then return; end if;
    v_skill := skill_of(p_world, p_uid, 'masonry');
    v_tool := tool_ql(p_world, p_uid, 'trowel');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'trowel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    -- A Mason's Concrete Hand never fails (`fail:raise_rock`).
    if not perk_pass(skill_check(v_skill, d.difficulty, v_tool), pk(p_world, p_uid, 'fail:raise_rock', 1)) then
      perform skill_raise(p_world, p_uid, 'masonry', try_gain(false));
      perform tell(p_world, p_uid, 'The concrete slumps off the rock before it sets, and is lost.', 'event');
      return;
    end if;
    -- The rock rises: the height goes up and the soil over it stays nought --
    -- two steps for a Mason's Double Lift, where the slope and the level let it.
    v_n := greatest(1, floor(pk(p_world, p_uid, 'lift:raise_rock', 1))::int);
    if v_n > 1 and (slope_refusal(p_world, p_uid, 'masonry', cx, cy, v_n) is not null
                    or land_height(p_world, cx, cy) + v_n
                       > coalesce((select pl.level_h from player pl where pl.world_id = p_world and pl.uid = p_uid),
                                  land_height(p_world, cx, cy) + v_n)) then
      v_n := 1;
    end if;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) + v_n);
    perform reconcile_around(p_world, cx, cy);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You lay concrete on the ' || corner_name(tx, ty, cx, cy)
      || ' corner and the rock stands ' || case when v_n > 1 then number_word(v_n) || ' steps' else 'a step' end
      || ' higher.', 'event');
    perform skill_raise(p_world, p_uid, 'masonry', 1);

  /*
   * A Mason's Rubble Fill: the same step up on bare rock for rock shards
   * rather than a concrete, spent either way, under the same check.
   */
  elsif p_action = 'rubble_fill' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    if not consume(p_world, p_uid, 'rock_shards', pk(p_world, p_uid, 'rubble', 0)::int) then return; end if;
    v_skill := skill_of(p_world, p_uid, 'masonry');
    v_tool := tool_ql(p_world, p_uid, 'trowel');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'trowel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      perform skill_raise(p_world, p_uid, 'masonry', try_gain(false));
      perform tell(p_world, p_uid, 'The rubble slides off the rock before it binds, and is lost.', 'event');
      return;
    end if;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) + 1);
    perform reconcile_around(p_world, cx, cy);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You pack rubble into the ' || corner_name(tx, ty, cx, cy)
      || ' corner and the rock stands a step higher.', 'event');
    perform skill_raise(p_world, p_uid, 'masonry', 1);

  elsif p_action = 'dredge' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    v_skill := skill_of(p_world, p_uid, 'digging');
    v_tool := tool_ql(p_world, p_uid, 'shovel');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'shovel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      perform skill_raise(p_world, p_uid, 'digging', try_gain(false));
      perform tell(p_world, p_uid, 'The shovel comes up with nothing but water.', 'event');
      return;
    end if;
    -- The bottom comes up a spadeful at a time, exactly as a corner ashore
    -- does under `dig`: the height and the soil over the rock go down
    -- together, and the water over it is that much deeper.
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
    v_n := land_dirt(p_world, cx, cy) - 1;
    perform land_set_dirt(p_world, cx, cy, v_n);
    if t.turns_to_dirt then perform land_set_tile(p_world, tx, ty, 1); end if;
    perform reconcile_around(p_world, cx, cy);
    perform land_announce(p_world, tx, ty);
    v_ql := least(100, product_ql(v_skill, v_tool) * pk(p_world, p_uid, 'ql:dredge', 1));
    perform gather(p_world, p_uid, v_spoil, 1, v_ql, null, perk_rare(pk(p_world, p_uid, 'rare:dredge', 0)));
    perform tell(p_world, p_uid, 'You dredge up some ' || lower((select name from item_def where id = v_spoil))
      || ' off the bottom at the ' || corner_name(tx, ty, cx, cy) || ' corner. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
    perform skill_raise(p_world, p_uid, 'digging', 1);

  elsif p_action = 'pave_slabs' then
    select i.* into v_slab from item i join slab_def s on s.item = i.def
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and not i.locked
      order by (i.id = target_item(p_target)) desc, i.id limit 1;
    if not found then return; end if;
    select id into v_kind from slab_def where item = v_slab.def;
    if not perk_pass(skill_check(skill_of(p_world, p_uid, 'paving'), d.difficulty, v_slab.ql),
                     pk(p_world, p_uid, 'fail:pave_slabs', 1)) then
      perform skill_raise(p_world, p_uid, 'paving', try_gain(false));
      perform tell(p_world, p_uid,
        'The slab rocks on its bed however you set it. You leave it for now.', 'event');
      return;
    end if;
    if not consume(p_world, p_uid, v_slab.def, 1, v_slab.id) then return; end if;
    perform land_set_tile(p_world, tx, ty, 21);
    perform land_set_data(p_world, tx, ty, v_kind);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You bed the '
      || lower((select name from item_def where id = v_slab.def)) || ' down flat and true.', 'event');
    perform skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'remove_paving' then
    -- A slab comes up whole more often than not; gravel and cobbles do not.
    v_kind := case when here = 21 then v_data & 3 else null end;
    perform land_set_tile(p_world, tx, ty, 1);
    perform land_announce(p_world, tx, ty);
    if v_kind is not null and random() < 0.6 then
      v_ql := product_ql(skill_of(p_world, p_uid, 'paving'));
      perform gather(p_world, p_uid, (select item from slab_def where id = v_kind), 1, v_ql);
      perform tell(p_world, p_uid, 'You lever the '
        || regexp_replace(lower((select name from slab_def where id = v_kind)), 's$', '')
        || ' up whole. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
    else
      perform tell(p_world, p_uid, 'You break up the paving, leaving bare dirt.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'cut_grass' then
    perform mark_foraged(p_world, tx, ty, 'grass');
    -- More to a cut for a Naturalist's Hay Cutter.
    v_cut := floor(pk(p_world, p_uid, 'count:mixed_grass', grass_per_cut()))::int;
    perform gather(p_world, p_uid, 'mixed_grass', v_cut, product_ql(skill_of(p_world, p_uid, 'foraging')));
    -- Grass kept cut on a deed becomes lawn: the tile counts the days, in
    -- the bits `tree_day` reads.
    if here = tile_id('Grass') and on_deed(p_world, tx, ty) then
      v_n := v_data & 3;
      perform land_set_data(p_world, tx, ty, v_n | 4);
      perform land_announce(p_world, tx, ty);
      perform tell(p_world, p_uid, 'You cut ' || number_word(v_cut) || ' bundles of mixed grass.'
        || case when 3 - v_n - 1 > 0
             then ' Kept cut, this will be lawn in ' || (3 - v_n - 1) || ' more day' || case when 3 - v_n - 1 = 1 then '' else 's' end || '.'
             else ' Kept cut, this will be lawn tomorrow.' end, 'event');
    else
      perform tell(p_world, p_uid, 'You cut ' || number_word(v_cut) || ' bundles of mixed grass.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, 'foraging', 1);

  elsif p_action = 'cut_moss' then
    -- Cut as grass is, and the tile stays moss.
    perform mark_foraged(p_world, tx, ty, 'moss');
    v_cut := moss_per_cut()::int;
    perform gather(p_world, p_uid, 'moss', v_cut, product_ql(skill_of(p_world, p_uid, 'foraging')));
    perform tell(p_world, p_uid, 'You cut ' || number_word(v_cut) || ' clumps of moss.', 'event');
    perform skill_raise(p_world, p_uid, 'foraging', 1);

  elsif p_action = 'cut_reeds' then
    perform mark_foraged(p_world, tx, ty, 'reed');
    v_skill := skill_of(p_world, p_uid, 'foraging');
    -- Never fewer than a Naturalist's Reed Cutter says, whatever the roll.
    v_n := greatest(floor(pk(p_world, p_uid, 'count:reed', 0))::int,
                    reed_cut()::int + case when random() < v_skill / reed_extra_at() then 1 else 0 end);
    perform gather(p_world, p_uid, 'reed', v_n,
      product_ql(v_skill, tool_ql(p_world, p_uid, 'carving_knife')));
    perform tell(p_world, p_uid, 'You cut ' || v_n || ' reeds out of the bed.', 'event');
    perform skill_raise(p_world, p_uid, 'foraging', 1);

  elsif p_action = 'pick_fruit' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    -- An old tree carries more than one only just come into bearing, and a
    -- very old one as much as an old one.
    v_skill := skill_of(p_world, p_uid, 'forestry');
    -- And more for Love's Abundance, as a field's harvest has.
    v_n := greatest(1, round(case when tree_age(v_data) in (2, 4) then 5 else 3 end
                             * (0.5 + v_skill / 130) * (0.7 + random() * 0.6) * path_fx(p_world, p_uid, 'harvest', 1))::int)
           -- And one more for a Forester's Fruitful.
           + case when random() < pk(p_world, p_uid, 'more:pick_fruit', 0) then 1 else 0 end;
    v_ql := product_ql(v_skill);
    perform gather(p_world, p_uid, v_tree.fruit, v_n, v_ql);
    perform mark_foraged(p_world, tx, ty, 'forage');
    perform skill_raise(p_world, p_uid, 'forestry', 0.35);
    perform tell(p_world, p_uid, 'You pick ' || v_n || ' '
      || lower((select name from item_def where id = v_tree.fruit))
      || case when v_n = 1 then '' else 's' end
      || ' off the ' || lower(v_tree.name) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'pick_sprout' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    -- A Forester's Sprout Picker never fails (`fail:pick_sprout`).
    if not perk_pass(skill_check(skill_of(p_world, p_uid, 'forestry'), 15), pk(p_world, p_uid, 'fail:pick_sprout', 1)) then
      perform skill_raise(p_world, p_uid, 'forestry', try_gain(false));
      perform tell(p_world, p_uid, 'You find no sprout worth picking.', 'event');
      return;
    end if;
    -- And picks more than one (`count:sprout`).
    v_n := greatest(1, floor(pk(p_world, p_uid, 'count:sprout', 1))::int);
    perform gather(p_world, p_uid, 'sprout', v_n,
      product_ql(skill_of(p_world, p_uid, 'forestry')), v_tree.name);
    perform tell(p_world, p_uid, case when v_n = 1 then 'You pick a ' || lower(v_tree.name) || ' sprout.'
      else 'You pick ' || number_word(v_n) || ' ' || lower(v_tree.name) || ' sprouts.' end, 'event');
    perform skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'prune' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    select * into v_age from tree_age_def where id = tree_age(v_data);
    select * into v_to from tree_age_def where id = v_age.pruned;
    -- The door has already said no to a tree too young for this; a null age
    -- is never written into a tile.
    if v_to.id is null then return; end if;
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_tool := tool_ql(p_world, p_uid, 'sickle');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'sickle'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      perform skill_raise(p_world, p_uid, 'forestry', try_gain(false));
      perform tell(p_world, p_uid, 'You cut at the ' || lower(v_tree.name)
        || ' and take off nothing that matters.', 'event');
      return;
    end if;
    /*
     * The age and nothing else. The species stays, and so does the notch a
     * hatchet has left in the trunk — it is beside the land, and the tile is
     * still a tree: pruning is the crown's business, and a half-felled tree
     * pruned back is still half felled.
     */
    perform land_set_data(p_world, tx, ty, tree_pack(tree_species(v_data), v_to.id));
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You prune the ' || lower(v_age.name) || ' ' || lower(v_tree.name)
      || ' back. It stands as a ' || lower(v_to.name) || ' ' || lower(v_tree.name) || ' now.', 'event');
    perform skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'plant' then
    -- The one chosen off the menu first, and the oldest that comes to hand if
    -- nobody chose. Sprouts come in nine species and what goes in the ground
    -- is what stands there for the next twenty years, so "whichever was picked
    -- up first" was not a choice anybody had made.
    select * into v_sprout from item where world_id = p_world and holder = 'player'
      and holder_uid = p_uid and def = 'sprout' and not locked
      and (target_item(p_target) is null or id = target_item(p_target))
      order by (id = target_item(p_target)) desc, id limit 1;
    if not found then return; end if;
    v_species := coalesce((select id from tree_def where name = v_sprout.extra), 0);
    if not consume(p_world, p_uid, 'sprout', 1, v_sprout.id) then return; end if;
    perform land_set_tile(p_world, tx, ty, 16);
    -- Species and age packed the one way (`tree_pack`): a planted tree
    -- starts as a sapling and grows on the same clock as one that seeded itself.
    -- Young, or further on for a Forester's Nursery (`grown:plant`).
    v_grown := planted_age(floor(pk(p_world, p_uid, 'grown:plant', 0))::int);
    perform land_set_data(p_world, tx, ty, tree_pack(v_species, v_grown));
    perform land_announce(p_world, tx, ty);
    perform journal_note(p_world, p_uid, 'planted');
    if (select fruit from tree_def where id = v_species) is not null then
      perform journal_note(p_world, p_uid, 'orchard');
    end if;
    perform tell(p_world, p_uid, 'You plant the '
      || lower((select name from tree_def where id = v_species)) || ' sprout.'
      || case when v_grown = planted_age(0) then ''
              else ' It comes up a ' || lower((select name from tree_age_def where id = v_grown)) || ' '
                   || lower((select name from tree_def where id = v_species)) || '.' end, 'event');
    perform skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'graft' then
    -- The sprout named off the menu, or the first fruit sprout to hand.
    select i.* into v_sprout from item i join tree_def td on td.name = i.extra and td.fruit is not null
     where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
       and i.def = 'sprout' and not i.locked
       and (target_item(p_target) is null or i.id = target_item(p_target))
     order by (i.id = target_item(p_target)) desc, i.id limit 1;
    if not found then return; end if;
    select * into v_tree from tree_def where id = tree_species(v_data);
    v_species := (select id from tree_def where name = v_sprout.extra);
    -- The sprout is spent either way: a graft that does not take is a sprout gone.
    if not consume(p_world, p_uid, 'sprout', 1, v_sprout.id) then return; end if;
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_tool := tool_ql(p_world, p_uid, 'carving_knife');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'carving_knife'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    -- A Forester's Master Grafter's graft always takes (`fail:graft`).
    if not perk_pass(skill_check(v_skill, d.difficulty, v_tool), pk(p_world, p_uid, 'fail:graft', 1)) then
      perform skill_raise(p_world, p_uid, 'forestry', try_gain(false));
      perform tell(p_world, p_uid, 'The ' || lower(v_sprout.extra) || ' graft does not take, and the sprout is spent.', 'event');
      return;
    end if;
    -- The species and nothing else: the age stays, and so does any notch.
    perform land_set_data(p_world, tx, ty, tree_pack(v_species, tree_age(v_data)));
    perform land_announce(p_world, tx, ty);
    perform journal_note(p_world, p_uid, 'orchard');
    perform tell(p_world, p_uid, 'You graft the ' || lower(v_sprout.extra) || ' sprout onto the ' || lower(v_tree.name)
      || '. It is a ' || lower((select name from tree_age_def where id = tree_age(v_data))) || ' '
      || lower(v_sprout.extra) || ' tree now.', 'event');
    perform skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'harvest_bush' then
    -- As fruit off a tree: more to a practised hand, and never nothing.
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_tool := tool_ql(p_world, p_uid, 'sickle');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'sickle'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    v_n := greatest(1, round(3 * (0.5 + v_skill / 130) * (0.7 + random() * 0.6))::int)
           -- And one more for a Forester's Hedge Harvest.
           + case when random() < pk(p_world, p_uid, 'more:harvest_bush', 0) then 1 else 0 end;
    v_ql := product_ql(v_skill, v_tool);
    perform gather(p_world, p_uid, (select yields from bush_def where id = bush_species(v_data)), v_n, v_ql);
    perform mark_foraged(p_world, tx, ty, 'forage');
    perform skill_raise(p_world, p_uid, 'forestry', 0.35);
    perform tell(p_world, p_uid, 'You cut ' || v_n || ' '
      || lower((select name from item_def where id = (select yields from bush_def where id = bush_species(v_data))))
      || ' off the ' || lower((select name from bush_def where id = bush_species(v_data)))
      || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'coppice' then
    -- A Forester's Coppice: a tree grown enough to bear, cut back to young off
    -- the stool for `coppice` logs, and left standing to grow on.
    select * into v_tree from tree_def where id = tree_species(v_data);
    select * into v_age from tree_age_def where id = tree_age(v_data);
    if here <> 16 or not coalesce(v_age.alive and v_age.bears, false) then return; end if;
    v_skill := skill_of(p_world, p_uid, 'woodcutting');
    v_tool := tool_ql(p_world, p_uid, 'hatchet');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'hatchet'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      perform skill_raise(p_world, p_uid, 'woodcutting', try_gain(false));
      perform tell(p_world, p_uid, 'Your hatchet glances off and you fail to make headway.', 'event');
      return;
    end if;
    -- A fresh trunk off the stool: whatever notch was in the old one went with it.
    perform land_set_data(p_world, tx, ty, tree_pack(tree_species(v_data), planted_age(0)));
    delete from tree_notch where world_id = p_world and x = tx and y = ty;
    perform land_announce(p_world, tx, ty);
    v_n := floor(pk(p_world, p_uid, 'coppice', 0))::int;
    v_ql := product_ql(v_skill, v_tool);
    perform gather(p_world, p_uid, 'log', v_n, v_ql, v_tree.name);
    perform tell(p_world, p_uid, 'You cut the ' || lower(v_age.name) || ' ' || lower(v_tree.name)
      || ' back to the stool and get ' || v_n || case when v_n = 1 then ' log' else ' logs' end
      || '. (QL ' || to_char(v_ql, 'FM990.0') || ') It stands as a '
      || lower((select name from tree_age_def where id = planted_age(0))) || ' ' || lower(v_tree.name) || ' now.', 'event');
    perform skill_raise(p_world, p_uid, 'woodcutting', 1);

  elsif p_action = 'tap_resin' then
    -- A Forester's Tap Resin: `tap_resin` tar out of a living pine, once a day
    -- for each -- the refusal says when it runs again.
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_tool := tool_ql(p_world, p_uid, 'carving_knife');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'carving_knife'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    perform mark_foraged(p_world, tx, ty, 'resin');
    v_n := floor(pk(p_world, p_uid, 'tap_resin', 0))::int;
    v_ql := product_ql(v_skill, v_tool);
    perform gather(p_world, p_uid, 'tar', v_n, v_ql);
    perform tell(p_world, p_uid, 'You cut the ' || lower((select name from tree_def where id = resin_tree()))
      || '''s bark and collect ' || v_n || ' ' || lower((select name from item_def where id = 'tar'))
      || ' from it. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
    perform skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'clear_brush' then
    -- A Forester's Clear Brush: every bush and reed within `clear_brush` tiles
    -- of the one chosen, in one go. A bush leaves grass and reeds bare dirt,
    -- as `CLEARED_TO` has it in the browser.
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'sickle'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    v_rad := floor(pk(p_world, p_uid, 'clear_brush', 0))::int;
    v_n := 0;
    for v_row in select gx, gy from generate_series(ty - v_rad, ty + v_rad) gy, generate_series(tx - v_rad, tx + v_rad) gx
                  where in_bounds(p_world, gx, gy) and land_tile(p_world, gx, gy) in (tile_id('Bush'), tile_id('Reed')) loop
      perform land_set_tile(p_world, v_row.gx, v_row.gy,
        case when land_tile(p_world, v_row.gx, v_row.gy) = tile_id('Bush') then tile_id('Grass') else tile_id('Dirt') end);
      perform land_set_data(p_world, v_row.gx, v_row.gy, 0);
      perform land_announce(p_world, v_row.gx, v_row.gy);
      v_n := v_n + 1;
    end loop;
    perform tell(p_world, p_uid, 'You clear the brush off ' || v_n || case when v_n = 1 then ' tile.' else ' tiles.' end, 'event');
    perform skill_raise(p_world, p_uid, 'forestry', 1);

  elsif p_action = 'dig_stump' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    v_skill := skill_of(p_world, p_uid, 'digging');
    v_tool := tool_ql(p_world, p_uid, 'shovel');
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'shovel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id); end if;
    if not skill_check(v_skill, d.difficulty, v_tool) then
      perform skill_raise(p_world, p_uid, 'digging', try_gain(false));
      perform tell(p_world, p_uid, 'The roots hold. You dig round the ' || lower(v_tree.name)
        || ' stump and it does not shift.', 'event');
      return;
    end if;
    -- Bare dirt where it stood: the roots came out with it.
    perform land_set_tile(p_world, tx, ty, tile_id('Dirt'));
    perform land_set_data(p_world, tx, ty, 0);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You dig the ' || lower(v_tree.name)
      || ' stump out. The ground is bare dirt where it stood.', 'event');
    -- And a log of the tree's kind, for a Terraformer's Stump Puller.
    v_n := pk(p_world, p_uid, 'stump:log', 0)::int;
    if v_n > 0 then
      perform gather(p_world, p_uid, 'log', v_n, product_ql(v_skill, v_tool), v_tree.name);
      perform tell(p_world, p_uid, 'The root ball comes up with a length of good ' || lower(v_tree.name) || ' on it.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, 'digging', 1);

  elsif p_action = 'dig_worms' then
    perform skill_raise(p_world, p_uid, 'digging', 0.2);
    select i.id into v_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'shovel'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if v_id is not null then perform wear_tool(v_id, 0.4); end if;
    -- Damp ground gives more than dry: a marsh is full of them.
    v_n := floor(random() * case when t.rich_worms then 5 else 3 end)::int
           + case when t.rich_worms then 1 else 0 end;
    if v_n = 0 then
      perform tell(p_world, p_uid, 'You turn a spadeful over and nothing is moving in it.', 'event');
      return;
    end if;
    perform gather(p_world, p_uid, 'worm', v_n, 20 + random() * 40);
    perform journal_note(p_world, p_uid, 'worms');
    perform tell(p_world, p_uid, 'You turn the dirt over and pick ' || v_n || ' worm'
      || case when v_n > 1 then 's' else '' end || ' out of it.', 'event');

  elsif p_action = 'prospect' then
    v_skill := skill_of(p_world, p_uid, 'prospecting');
    v_rad := prospect_radius(v_skill) + pk(p_world, p_uid, 'further:prospect', 0)::int + path_fx(p_world, p_uid, 'further', 0)::int;
    v_size := (select size from world where id = p_world);
    -- Metal counts wherever it lies: bare, under soil, or below water.
    for v_row in select x, y, (bedrock_at(p_world, x, y)).name as nm
      from generate_series(greatest(0, tx - v_rad), least(v_size - 1, tx + v_rad)) x
      cross join generate_series(greatest(0, ty - v_rad), least(v_size - 1, ty + v_rad)) y
      -- Anything worth mining, not only what is metal: a coal seam is a
      -- seam, and asking `ore` is asking whether its name ends in `_ore`.
      where (bedrock_at(p_world, x, y)).seam
      order by y, x
    loop
      v_tiles := v_tiles || (v_row.y * v_size + v_row.x);
      v_names := v_names || lower(v_row.nm);
    end loop;
    perform mark_prospected(p_world, p_uid, v_tiles);

    -- Sampling where you stand tells you what that particular rock holds.
    v_rock := bedrock_at(p_world, tx, ty);
    v_ql := ore_max_ql((select seed from world where id = p_world), tx, ty);
    v_buried := case when here = 4 then ''
      else ' It lies under ' || greatest(1, land_dirt(p_world, tx, ty)) || ' of ground.' end;
    if v_rock.seam then
      perform tell(p_world, p_uid, 'You sample the ' || lower(v_rock.name)
        || '. It needs mining ' || to_char(case when v_rock.ore
                                                then greatest(0, v_rock.level - pk(p_world, p_uid, 'ore:below', 0))
                                                else v_rock.level end, 'FM990')
        || ' to work' || case when skill_of(p_world, p_uid, 'mining')
                                   >= case when v_rock.ore
                                           then greatest(0, v_rock.level - pk(p_world, p_uid, 'ore:below', 0))
                                           else v_rock.level end
                              then ', which you have' else '' end
        || ', and will give up nothing finer than quality ' || to_char(v_ql, 'FM990')
        || '.' || v_buried, 'event');
    else
      perform tell(p_world, p_uid, 'Plain ' || lower(v_rock.name)
        || ' beneath you, with no metal in it, and nothing finer than quality '
        || to_char(v_ql, 'FM990') || ' in the stone.' || v_buried, 'event');
    end if;

    if coalesce(array_length(v_tiles, 1), 0) = 0 then
      perform tell(p_world, p_uid, 'You read the ground ' || v_rad
        || ' tiles about you and find no sign of anything worth mining.', 'event');
    else
      perform tell(p_world, p_uid, 'Within ' || v_rad || ' tiles you read '
        || (select string_agg(case when n > 1 then n || ' tiles of ' || nm
                                   else 'a tile of ' || nm end, ' and ' order by nm)
            from (select nm, count(*) as n from unnest(v_names) nm group by nm) q)
        || ', buried or bare. They are marked for a while.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, 'prospecting', 1);
  end if;

end $function$;

-- Good Stock: more chance of a grade better on every trait.
CREATE OR REPLACE FUNCTION public.pair_them(p_world uuid, p_dam integer, p_sire integer, p_husbandry double precision, p_uid uuid DEFAULT NULL::uuid, p_sex text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
/*
 * `v_care`, not `care`. The eighth time this class has bitten: a local called
 * `care` inside an `update creature` is not a local, it is the column, and
 * Postgres says "ambiguous" if you are lucky. Alias every table, prefix every
 * local — the rule has not changed and neither has the mistake.
 */
declare dam creature; sire creature; v_care double precision; v_bred jsonb; v_twin jsonb;
        v_keep double precision; v_up double precision; v_sex text; v_rest double precision;
begin
  select * into dam from creature where world_id = p_world and id = p_dam;
  select * into sire from creature where world_id = p_world and id = p_sire;
  v_care := (dam.care + sire.care) / 2;
  /*
   * What the breeder's perks put into it, read off whoever put them together:
   * more of the pair and more of it a tier better (True Blood, Bred Up), the
   * sex they asked for (Choose the Sex) or even odds, now and then a second
   * young bred for itself (Twins), carried for less of the time (Quick
   * Gestation), and both ready again sooner (Short Rest).
   */
  v_keep := pk(p_world, p_uid, 'breed:inherit', 0);
  -- And more for Love's Good Stock.
  v_up := pk(p_world, p_uid, 'breed:upgrade', 0) + path_fx(p_world, p_uid, 'up', 0);
  v_sex := case when p_sex in ('male', 'female') and pk(p_world, p_uid, 'breed:sex', 0) > 0 then p_sex end;
  v_bred := breed_traits(sire.traits, dam.traits, p_husbandry, v_care, v_keep, v_up);
  if random() < pk(p_world, p_uid, 'breed:twins', 0) then
    v_twin := breed_traits(sire.traits, dam.traits, p_husbandry, v_care, v_keep, v_up);
    v_twin := jsonb_build_object('traits', v_twin->'traits', 'from', v_twin->'from',
      'sex', coalesce(v_sex, case when random() < 0.5 then 'male' else 'female' end));
  end if;
  v_rest := breed_rest() * (1 - pk(p_world, p_uid, 'breed:rest', 1));
  -- The sire is written down now, by id and by name, with where each trait
  -- came from: he need not be about when the hour comes.
  update creature set
      unborn = jsonb_build_object(
        'traits', v_bred->'traits',
        'sex', coalesce(v_sex, case when random() < 0.5 then 'male' else 'female' end),
        'sire', jsonb_build_object('id', sire.id, 'name', sire.name),
        'from', v_bred->'from')
        || case when v_twin is null then '{}'::jsonb else jsonb_build_object('twin', v_twin) end,
      due = now() + make_interval(secs => gestation() * pk(p_world, p_uid, 'breed:gestation', 1)),
      bred_at = now() - make_interval(secs => v_rest)
    where world_id = p_world and id = p_dam;
  update creature set bred_at = now() - make_interval(secs => v_rest) where world_id = p_world and id = p_sire;
end $function$;

-- Steady Herd: a companion gives up no fight for how far from its keeper it has gone.
CREATE OR REPLACE FUNCTION public.companion_target(p_world uuid, c creature, k player)
 RETURNS creature
 LANGUAGE plpgsql
 STABLE
AS $function$
declare q creature; v_threat int;
        -- As far as it looks and as far as it follows a fight: further for its keeper's Long Leash.
        v_sight double precision := pk(k.class_mul, 'sight:companion', companion_sight());
        v_leash double precision := pk(k.class_mul, 'leash:companion', companion_leash());
begin
  if k.away then return null; end if;
  -- Fallen back (`order_heel`): at your side, and no fight of its own until the time is up.
  if c.heel_until is not null and c.heel_until > now() then return null; end if;
  -- What it is on, whatever its stance: a passive one is on something only when told (`order_attack`).
  if c.enemy is not null then
    select * into q from creature where world_id = p_world and id = c.enemy;
    if found and q.mode = 'wild' and q.hitched_to is null
       and sqrt((creature_x(q) - k.x) ^ 2 + (creature_y(q) - k.y) ^ 2)
           <= (case when path_fx(p_world, k.uid, 'steady', 0) > 0 then 'Infinity'::double precision
                    when c.stance = 'guard' then guard_range() else v_leash end) then
      return q;
    end if;
    return null;
  end if;
  if c.stance = 'passive' then return null; end if;
  -- Guarding you: whatever is hunting you within `companion_sight`, nearest first, before it lands a blow.
  if c.stance = 'guard' then
    select qq.* into q from creature qq
      where qq.world_id = p_world and qq.hunting = k.uid and qq.mode = 'wild' and qq.hitched_to is null
        and sqrt((creature_x(qq) - k.x) ^ 2 + (creature_y(qq) - k.y) ^ 2) <= v_sight
      order by (creature_x(qq) - k.x) ^ 2 + (creature_y(qq) - k.y) ^ 2, qq.id
      limit 1;
    if found then return q; end if;
  end if;
  if c.stance = 'aggressive' then
    select qq.* into q from creature qq
      where qq.world_id = p_world and qq.mode = 'wild' and qq.hitched_to is null
        -- The box first, which the index can serve; the circle second.
        and qq.to_x between k.x - (v_sight + leg_slack()) and k.x + (v_sight + leg_slack())
        and qq.to_y between k.y - (v_sight + leg_slack()) and k.y + (v_sight + leg_slack())
        and sqrt((creature_x(qq) - k.x) ^ 2 + (creature_y(qq) - k.y) ^ 2) <= v_sight
      order by (creature_x(qq) - k.x) ^ 2 + (creature_y(qq) - k.y) ^ 2, qq.id
      limit 1;
    if not found then return null; end if;
    return q;
  end if;
  v_threat := case
    when c.hurt_at > now() - make_interval(secs => blow_memory()) then c.hurt_by
    when (k.stats->>'hurtAt')::timestamptz > now() - make_interval(secs => blow_memory())
      then (k.stats->>'hurtBy')::int
  end;
  if v_threat is null or v_threat = c.id then return null; end if;
  select * into q from creature where world_id = p_world and id = v_threat and mode = 'wild'
    and hitched_to is null;
  if not found then return null; end if;
  return q;
end $function$;

-- A companion inside its keeper's Heart of the Herd takes less of every blow.
CREATE OR REPLACE FUNCTION public.wound_beast(p_world uuid, p_id integer, p_dmg double precision, p_from_x double precision DEFAULT NULL::double precision, p_from_y double precision DEFAULT NULL::double precision, p_teller uuid DEFAULT NULL::uuid, p_by integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; cx double precision; cy double precision; v_taken double precision;
        v_len double precision; v_size double precision; v_killer creature; v_fx double precision; v_fy double precision;
begin
  perform creature_settle(p_world, p_id);
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  select * into d from species_def where id = c.species;
  cx := creature_x(c); cy := creature_y(c);
  -- What a blow costs it is its blood's to say, and its herd's.
  -- Nothing is struck inside a Truce, nor from one (`faith_truce`).
  if faith_truce(p_world, cx, cy) or (p_from_x is not null and faith_truce(p_world, p_from_x, p_from_y)) then
    return false;
  end if;
  -- And a creature under a Mark of Judgment takes its share more (`faith_marked`).
  v_taken := p_dmg * beast_mul(c, 'soak') * faith_marked(p_world, p_id)
    -- And more inside a Binder's Brittle, and while their Brittle Hold holds it (`class_brittle`).
    * class_brittle(p_world, p_id)
    -- And less on a companion inside its keeper's Heart of the Herd (Love's).
    * herd_heart(c, 'taken');
  -- And on a companion inside its keeper's Feral Bond, its keeper's share of it, straight off their health (`class_bond_give`).
  v_taken := class_bond_give(p_world, c, v_taken);

  update creature set health = c.health - v_taken, hurt_at = now(), hurt_by = p_by,
      coaxed = 0, coaxed_at = null,
      from_x = cx, from_y = cy, to_x = cx, to_y = cy, leg_at = now(), leg_ends = now(),
      settled_at = now()
    where world_id = p_world and id = p_id;

  if c.health - v_taken > 0 then
    -- A wild thing that stands and fights turns on a tame one that hurt it (`beast_threat`).
    if c.mode = 'wild' and not coalesce(d.timid, false) and p_by is not null then
      perform beast_threat(p_world, p_id, p_by);
    end if;
    -- Not while it is held, and no further than a Root or a Tether lets it (`class_leash_point`).
    if c.mode = 'wild' and d.timid and p_from_x is not null and not class_held(p_world, p_id) then
      v_len := greatest(0.001, sqrt((cx - p_from_x) ^ 2 + (cy - p_from_y) ^ 2));
      select lp.x, lp.y into v_fx, v_fy
        from class_leash_point(p_world, p_id, cx + ((cx - p_from_x) / v_len) * 5, cy + ((cy - p_from_y) / v_len) * 5) lp;
      update creature set to_x = v_fx, to_y = v_fy,
          leg_ends = now() + interval '3 seconds', until = now() + interval '3 seconds'
        where world_id = p_world and id = p_id;
    end if;
    return false;
  end if;

  -- What the carcass is worth follows the size of the thing that left it.
  v_size := (age_row(c.born, old_of(c), age_pace(c))).yield;
  delete from creature where world_id = p_world and id = p_id;
  -- Nothing goes on fighting something that is no longer there.
  update creature set enemy = null where world_id = p_world and enemy = p_id;
  perform drop_on_ground(p_world, floor(cx)::int, floor(cy)::int, 'corpse',
    (15 + random() * 35) * v_size, d.name);

  -- A hunter marks where its kill went down and comes back for it.
  if p_by is not null then
    select * into v_killer from creature where world_id = p_world and id = p_by;
    -- A companion's kill is told to its keeper, who is standing right there. A
    -- worker's is not: a guard's week on a deed its keeper has left would come
    -- back as a page of them.
    if found and v_killer.mode = 'active' and v_killer.keeper is not null then
      perform tell(p_world, v_killer.keeper, v_killer.name || ' killed a wild ' || lower(d.name) || '.', 'fight');
    end if;
    if found and v_killer.carrying is null
       and (select gathers from species_def where id = v_killer.species) = 'hunt' then
      update creature set work_x = floor(cx)::int, work_y = floor(cy)::int
        where world_id = p_world and id = p_by;
      perform worker_learn(p_world, p_by, 'fighting', 0.4);
    end if;
  end if;

  /*
   * And what it was keeping, which is the other half of where a map comes
   * from. Only a monster — `species_def.monster` is already the line between
   * a thing that hunts you and a thing you could have tamed — and only to
   * whoever struck it down. The odds and the quality both come off its
   * health, which is the one number that says how big a thing was: a goblin
   * in thirty-five carries a scrap, a dragon in two carries a dragon's.
   */
  if p_teller is not null and d.monster and random() < map_chance_beast(d.health) then
    perform bury_treasure(p_world, p_teller, map_ql_beast(d.health), cx, cy);
  end if;

  if p_teller is not null then
    perform journal_note(p_world, p_teller, 'slew:' || c.species);
    if d.monster then
      perform tell(p_world, p_teller, 'The ' || lower(d.name)
        || ' goes down. Butcher it before it rots: there is a great deal on it.', 'fight');
    else
      perform tell(p_world, p_teller, 'You kill the wild ' || lower(d.name)
        || '. Its corpse lies where it fell.', 'fight');
    end if;
  end if;
  return true;
end $function$;

-- Long Table: a knack from food or drink lasts longer.
CREATE OR REPLACE FUNCTION public.grant_boon(p_world uuid, p_uid uuid, p_item text, p_ql double precision, p_knack double precision DEFAULT 1)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare v_skill text; v_secs double precision; v_boons jsonb; v_out jsonb := '[]'::jsonb;
        v_one jsonb; v_found boolean := false; v_until double precision; v_now double precision;
begin
  select boon_of((select seed from world where id = p_world), p_item) into v_skill;
  if v_skill is null then return null; end if;
  -- And longer for Love's Long Table.
  v_secs := boon_time(p_item, p_ql, p_knack) * path_fx(p_world, p_uid, 'table', 1);
  v_now := world_time(p_world);
  v_until := v_now + v_secs;
  select boons into v_boons from player where world_id = p_world and uid = p_uid;
  for v_one in select * from jsonb_array_elements(coalesce(v_boons, '[]'::jsonb)) loop
    -- Drop what has already run out rather than letting the list grow for ever.
    if (v_one->>'until')::double precision <= v_now then continue; end if;
    -- A dish's own, never a tincture's: the two stand side by side.
    if v_one->>'skill' = v_skill and v_one->>'kind' is null then
      v_one := jsonb_set(v_one, '{until}', to_jsonb(greatest((v_one->>'until')::double precision, v_until)));
      v_found := true;
    end if;
    v_out := v_out || v_one;
  end loop;
  if not v_found then
    v_out := v_out || jsonb_build_object('skill', v_skill, 'bonus', boon_bonus(),
      'until', v_until, 'from', lower((select coalesce(name, p_item) from item_def where id = p_item)));
  end if;
  update player set boons = v_out where world_id = p_world and uid = p_uid;
  return (select name from skill_def where id = v_skill) || ' comes easier for the next '
    || clock_left(v_secs) || '.';
end $function$;

-- Unshaken: a heavy blow lands with less of its extra weight.
CREATE OR REPLACE FUNCTION public.hunt_settle(p_world uuid, c creature, d species_def, a age_def)
 RETURNS creature
 LANGUAGE plpgsql
AS $function$
declare p record; v_dist double precision; v_pace double precision; v_guard int := 0;
        v_cx double precision; v_cy double precision; v_secs double precision;
        v_ax double precision; v_ay double precision; v_step record;
        m creature; l creature; v_n int := 0; v_k int := 0; v_slot double precision; v_own double precision;
        v_turn double precision; v_b double precision; v_run double precision; v_nerve boolean := false;
        v_bl jsonb; v_fend double precision; v_brace double precision; v_braced boolean := false; v_t double precision;
begin
  v_cx := creature_x(c); v_cy := creature_y(c);
  -- A Radiance burns what is hunting somebody inside it (`faith_radiance`).
  if c.hunting is not null then c := faith_radiance(p_world, c, v_cx, v_cy); end if;
  /*
   * One of a pack that is not after anybody hears another of its kind within
   * `pack_call` that is, and comes for the same one (`packmateOn`).
   */
  if c.hunting is null and d.hunter and d.pack and (c.hunt_again is null or c.hunt_again <= now()) then
    select mm.* into m from creature mm
      where mm.world_id = p_world and mm.hunting is not null and mm.species = c.species
        and mm.id <> c.id and mm.mode = 'wild'
        and (creature_x(mm) - v_cx) ^ 2 + (creature_y(mm) - v_cy) ^ 2 <= pack_call() ^ 2
      order by (creature_x(mm) - v_cx) ^ 2 + (creature_y(mm) - v_cy) ^ 2, mm.id
      limit 1;
  end if;
  /*
   * Whoever it is already after, if anybody: a beast you struck stays on you
   * (`engage_beast`) rather than on whoever happens to be nearer. Then whoever
   * its pack is after, and otherwise the nearest, for a hunter to notice.
   */
  if c.hunting is not null then
    select pl.uid, pl.x, pl.y, sqrt((pl.x - v_cx) ^ 2 + (pl.y - v_cy) ^ 2) as d into p
      from player pl where pl.world_id = p_world and pl.uid = c.hunting;
  elsif m.id is not null then
    select pl.uid, pl.x, pl.y, sqrt((pl.x - v_cx) ^ 2 + (pl.y - v_cy) ^ 2) as d into p
      from player pl where pl.world_id = p_world and pl.uid = m.hunting;
  else
    select * into p from nearest_player(p_world, v_cx, v_cy);
  end if;
  if not found then c.hunting := null; return c; end if;

  if c.hunting is not null then
    /*
     * How far it has come from where it started, which is the one measure that
     * grows while it chases.
     *
     * Reported as being chased until you are dead, and that is exactly what
     * happened: every give-up here was about the gap between hunter and
     * hunted, and a hunter runs at `speed * 1.15` — so the gap it was measured
     * against was a gap it was closing. Outrunning one was the only way to
     * lose it, and most things on this island are faster than a body carrying
     * a pack.
     *
     * So the leash is tied where the chase began. It gives up at the end of it
     * and then wants nothing to do with hunting for `hunt_rest`, because
     * otherwise it drops you at thirty tiles, notices you again on the next
     * breath because you are still well inside its sight, and measures a fresh
     * leash from there — which is the same endless chase with a stutter in it.
     */
    /*
     * And how far it is from its own home ground, which is what stops a
     * hunter that had already strayed from taking you another thirty tiles
     * beyond where it strayed to. Both are asked; the first to run out ends
     * it.
     */
    if sqrt((v_cx - coalesce(c.hunt_x, v_cx)) ^ 2 + (v_cy - coalesce(c.hunt_y, v_cy)) ^ 2)
         > (case when d.hunter then hunt_leash() else fight_leash() end)
       or sqrt((v_cx - coalesce(c.home_x, v_cx)) ^ 2 + (v_cy - coalesce(c.home_y, v_cy)) ^ 2)
         > hunt_home() then
      c.hunting := null;
      c.windup_at := null;
      c.hunt_again := now() + make_interval(secs => hunt_rest());
      -- And back to its own country, rather than standing wherever it
      -- happened to stop. A hunter that gave up ten valleys from home and
      -- stayed there is how a range stops meaning anything.
      if c.home_x is not null then
        c.from_x := v_cx; c.from_y := v_cy;
        -- No further than a Root or a Tether lets it (`class_leash_point`).
        select lp.x, lp.y into c.to_x, c.to_y from class_leash_point(p_world, c.id, c.home_x, c.home_y) lp;
        c.leg_at := now();
        c.leg_ends := now() + make_interval(secs => greatest(1,
          sqrt((v_cx - c.home_x) ^ 2 + (v_cy - c.home_y) ^ 2)
            / greatest(0.1, d.speed * a.speed * beast_mul(c, 'speed') * 0.7)));
        c.until := c.leg_ends;
      end if;
      return c;
    end if;
    -- Far enough off, or on the beach: let go.
    if p.d > (case when not d.hunter then fight_give_up() when d.monster then hunt_give_up() * 2.2 else hunt_give_up() end)
       or at_peace(p_world, p.x, p.y) or p.d > faith_shroud(p_world, p.uid) then
      c.hunting := null;
      c.windup_at := null;
      return c;
    end if;
    /*
     * Its nerve (`nerveGoes`): a hunter hurt below what its kind stands, one
     * whose pack's leader is dead or has run, or a coward below `coward_drag`
     * with another of its kind within `pack_call` already run. Anything else
     * fights a fight it did not go looking for to the end.
     */
    if d.hunter then
      if c.health < max_health(c) * turns_at(d) then v_nerve := true; end if;
      if not v_nerve and c.pack_lead is not null and c.pack_lead <> c.id then
        select * into l from creature where world_id = p_world and id = c.pack_lead;
        if l.id is null or l.mode <> 'wild' or l.health <= 0 or l.hunt_again > now() then v_nerve := true; end if;
      end if;
      if not v_nerve and d.coward and c.health < max_health(c) * coward_drag() then
        v_nerve := exists (select 1 from creature o
          where o.world_id = p_world and o.species = c.species and o.id <> c.id and o.mode = 'wild'
            and o.hunt_again > now()
            and o.to_x between v_cx - (pack_call() + leg_slack()) and v_cx + (pack_call() + leg_slack())
            and o.to_y between v_cy - (pack_call() + leg_slack()) and v_cy + (pack_call() + leg_slack())
            and (creature_x(o) - v_cx) ^ 2 + (creature_y(o) - v_cy) ^ 2 <= pack_call() ^ 2);
      end if;
    end if;
    if v_nerve then
      -- It turns tail (`turnTail`): away from you, and no interest in you for a while.
      c.hunting := null;
      c.windup_at := null;
      c.hunt_again := now() + make_interval(secs => hunt_rest());
      v_run := d.speed * flee_pace() * flee_secs();
      select * into v_step from class_chase_leg(p_world, c.id, v_cx, v_cy,
        v_cx + (v_cx - p.x) / greatest(0.001, p.d) * v_run, v_cy + (v_cy - p.y) / greatest(0.001, p.d) * v_run);
      c.from_x := v_cx; c.from_y := v_cy;
      c.to_x := coalesce(v_step.x, v_cx); c.to_y := coalesce(v_step.y, v_cy);
      c.leg_at := now();
      c.leg_ends := now() + make_interval(secs => greatest(0.2, sqrt((c.to_x - v_cx) ^ 2 + (c.to_y - v_cy) ^ 2)
                                                 / greatest(0.1, d.speed * a.speed * beast_mul(c, 'speed') * flee_pace())));
      c.until := greatest(c.leg_ends, now() + make_interval(secs => flee_secs()));
      perform tell(p_world, p.uid, 'The ' || lower(d.name) || ' turns tail.', 'fight');
      return c;
    end if;
    c.hunting := p.uid;
  else
    -- Only a hunter goes looking for a fight.
    if not d.hunter then return c; end if;
    -- Nothing comes for you across ground it cannot stand on, and nothing
    -- comes for you at all while you are still standing on the beach.
    if at_peace(p_world, p.x, p.y) then return c; end if;
    if c.hunt_again is not null and c.hunt_again > now() then return c; end if;
    -- One of its pack already on you brings it from wherever it can hear; anything else has to notice you.
    if m.id is null and p.d > least(coalesce(d.notice, hunt_sight()), faith_shroud(p_world, p.uid)) then return c; end if;
    if not creature_tile_ok(p_world, floor(p.x)::int, floor(p.y)::int) then return c; end if;
    -- Nor on somebody who warned it off with a Pikeman's Warning Thrust, alone or with its pack, while that holds.
    if exists (select 1 from class_mark cm where cm.world_id = p_world and cm.creature_id = c.id and cm.kind = 'warned'
                 and cm.by_uid = p.uid and cm.until > now()) then
      return c;
    end if;
    c.hunting := p.uid;
    -- Where the leash is tied, and a fresh count of blows.
    c.hunt_x := v_cx; c.hunt_y := v_cy;
    c.fight_blows := 0; c.windup_at := null;
    -- The first of a pack leads it; the rest follow whoever the one they heard follows.
    c.pack_lead := case when not d.pack then null when m.id is not null then coalesce(m.pack_lead, m.id) else c.id end;
    perform tell(p_world, p.uid, case when m.id is not null then 'Another ' || lower(d.name) || ' comes with it.'
                                      else 'A ' || lower(d.name) || ' has your scent.' end, 'fight');
  end if;

  -- What the one it is after holds that changes its steps: a Pikeman's Fend Off, and Brace for the Charge at the edge of their reach.
  select pl.blessings into v_bl from player pl where pl.world_id = p_world and pl.uid = p.uid;
  if (v_bl->'fend_off'->>'until')::timestamptz > now() then v_fend := (v_bl->'fend_off'->>'push')::double precision; end if;
  if (v_bl->'brace'->>'until')::timestamptz > now() then v_brace := melee_reach(p_world, p.uid); end if;

  -- Only the last few seconds of the gap were spent on you.
  if c.until < now() - make_interval(secs => hunt_window()) then
    c.from_x := v_cx; c.from_y := v_cy; c.to_x := v_cx; c.to_y := v_cy;
    c.until := now() - make_interval(secs => hunt_window());
    c.leg_at := c.until; c.leg_ends := c.until;
  end if;

  v_pace := d.speed * a.speed * beast_mul(c, 'speed') * 1.15;
  /*
   * Its own side of you, when it hunts with a pack (`packWay`): the leader's is
   * where the leader is, and the rest share the circle out evenly from there,
   * in the order they came into the world.
   */
  if c.pack_lead is not null then
    select count(*), count(*) filter (where mm.id < c.id and mm.id <> c.pack_lead) into v_n, v_k
      from creature mm
      where mm.world_id = p_world and mm.hunting = p.uid and mm.pack_lead = c.pack_lead
        and mm.mode = 'wild' and mm.id <> c.id;
    v_n := v_n + 1;
    v_k := case when c.id = c.pack_lead then 0 else v_k + 1 end;
    if v_n >= 2 then
      select * into l from creature where world_id = p_world and id = c.pack_lead;
      v_slot := case when l.id is null then atan2(v_cy - p.y, v_cx - p.x)
                     else atan2(creature_y(l) - p.y, creature_x(l) - p.x) end + 2 * pi() * v_k / v_n;
    end if;
  end if;
  while c.until <= now() and v_guard < 12 loop
    v_guard := v_guard + 1;
    v_dist := sqrt((p.x - c.to_x) ^ 2 + (p.y - c.to_y) ^ 2);
    /*
     * A Pikeman's Fend Off: come within its reach of them to strike, a heavy
     * blow drawn back included, it is pushed back instead, over ground it
     * could walk (`shove_point`), and comes on again from there.
     */
    if v_fend is not null and v_dist <= hunt_reach() then
      select * into v_step from shove_point(p_world, c.to_x, c.to_y, p.x, p.y, v_fend);
      if v_step.x is not null then
        c.windup_at := null;
        c.from_x := c.to_x; c.from_y := c.to_y;
        c.to_x := v_step.x; c.to_y := v_step.y;
        c.leg_at := c.until;
        c.leg_ends := c.leg_at + make_interval(secs => sqrt((c.to_x - c.from_x) ^ 2 + (c.to_y - c.from_y) ^ 2) / shove_pace());
        c.until := c.leg_ends;
        perform tell(p_world, p.uid, (select name from class_spell where id = 'pikeman_fend_off') || ': you push the '
          || lower(d.name) || ' back.', 'fight');
        continue;
      end if;
    end if;
    /*
     * A heavy blow drawn back for (`windup_at`): it stood where it was for
     * `wind_up`, and lands on whatever is still in its reach.
     */
    if c.windup_at is not null then
      c.windup_at := null;
      c.fight_blows := c.fight_blows + 1;
      if v_dist <= hunt_reach() then
        perform mark_attacker(p_world, p.uid, c.id);
        -- With less of its extra weight on Power's Unshaken (`heavyOn`).
        perform hurt_player(p_world, p.uid, attack_of(c) * 0.012 * (1 + (heavy_hit() - 1) * path_fx(p_world, p.uid, 'heavy', 1)),
          'The ' || lower(d.name) || '''s heavy blow lands', coalesce(d.wound, 'bite'));
      else
        perform tell(p_world, p.uid, 'The ' || lower(d.name) || '''s heavy blow falls short.', 'fight');
      end if;
      c.until := c.until + make_interval(secs => blow_every(d) / (beast_mul(c, 'haste') * class_limbs(p_world, c.id))) + class_stagger_owed(p_world, c.id);
      continue;
    end if;
    /*
     * A thrower (`throwStep`): backs away from you inside `keep_off -
     * back_slack`, and with nowhere to back to fights hand to hand below;
     * within `throw_reach` it stands and throws; further, it closes to
     * `keep_off`, round to its own side of you when it runs with a pack.
     */
    if d.throws then
      if v_dist < keep_off() - back_slack() then
        select * into v_step from class_chase_leg(p_world, c.id, c.to_x, c.to_y,
          c.to_x + (c.to_x - p.x) / greatest(0.001, v_dist) * 2, c.to_y + (c.to_y - p.y) / greatest(0.001, v_dist) * 2);
        if v_step.x is not null and (v_step.x - c.to_x) ^ 2 + (v_step.y - c.to_y) ^ 2 > 0.01 then
          c.from_x := c.to_x; c.from_y := c.to_y;
          c.to_x := v_step.x; c.to_y := v_step.y;
          c.leg_at := c.until;
          c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, sqrt((c.to_x - c.from_x) ^ 2 + (c.to_y - c.from_y) ^ 2)
                                                         / greatest(0.1, d.speed * a.speed * beast_mul(c, 'speed') * back_pace())));
          c.until := c.leg_ends;
          continue;
        end if;
      elsif v_dist <= throw_reach() then
        c.fight_blows := c.fight_blows + 1;
        perform mark_attacker(p_world, p.uid, c.id);
        perform hurt_player(p_world, p.uid, attack_of(c) * 0.012 * throw_hit(),
          'The ' || lower(d.name) || '''s stone finds you', 'crush');
        c.until := c.until + make_interval(secs => blow_every(d) / (beast_mul(c, 'haste') * class_limbs(p_world, c.id))) + class_stagger_owed(p_world, c.id);
        continue;
      else
        v_ax := null;
        if v_slot is not null then
          v_own := atan2(c.to_y - p.y, c.to_x - p.x);
          v_turn := turn_to(v_own, v_slot);
          if abs(v_turn) > circle_arc() then
            v_b := v_own + sign(v_turn) * least(abs(v_turn), circle_arc());
            v_ax := p.x + cos(v_b) * keep_off(); v_ay := p.y + sin(v_b) * keep_off();
          end if;
        end if;
        if v_ax is null then
          v_ax := p.x + (c.to_x - p.x) / v_dist * keep_off(); v_ay := p.y + (c.to_y - p.y) / v_dist * keep_off();
        end if;
        select * into v_step from class_chase_leg(p_world, c.id, c.to_x, c.to_y, v_ax, v_ay);
        if v_step.x is null then
          c.hunting := null;
          exit;
        end if;
        c.from_x := c.to_x; c.from_y := c.to_y;
        c.to_x := v_step.x; c.to_y := v_step.y;
        c.leg_at := c.until;
        c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, sqrt((c.to_x - c.from_x) ^ 2 + (c.to_y - c.from_y) ^ 2)
                                                       / greatest(0.1, v_pace)));
        c.until := c.leg_ends;
        continue;
      end if;
    end if;
    if v_dist > hunt_reach() then
      -- Round to its own side of you first, when it runs with a pack and is not on it yet (`circlePoint`).
      v_ax := null;
      if v_slot is not null then
        v_own := atan2(c.to_y - p.y, c.to_x - p.x);
        v_turn := turn_to(v_own, v_slot);
        if abs(v_turn) > circle_arc() then
          v_b := v_own + sign(v_turn) * least(abs(v_turn), circle_arc());
          v_ax := p.x + cos(v_b) * circle_r(); v_ay := p.y + sin(v_b) * circle_r();
        end if;
      end if;
      -- Otherwise a leg that ends a pace short of your feet, round whatever is between.
      if v_ax is null then
        v_ax := c.to_x + (p.x - c.to_x) * (v_dist - 1) / v_dist;
        v_ay := c.to_y + (p.y - c.to_y) * (v_dist - 1) / v_dist;
      end if;
      select * into v_step from class_chase_leg(p_world, c.id, c.to_x, c.to_y, v_ax, v_ay);
      if v_step.x is null then
        c.hunting := null;
        exit;
      end if;
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.to_x := v_step.x; c.to_y := v_step.y;
      /*
       * A Pikeman braced for the charge: a leg that would carry it from outside
       * their reach into it stops at the edge, where the blow is waiting
       * (`class_owed_pay`), and the first such leg spends the brace.
       */
      if v_brace is not null and v_dist > v_brace and (c.to_x - p.x) ^ 2 + (c.to_y - p.y) ^ 2 < v_brace ^ 2 then
        v_t := circle_entry(c.from_x, c.from_y, c.to_x, c.to_y, p.x, p.y, v_brace);
        c.to_x := c.from_x + (c.to_x - c.from_x) * v_t; c.to_y := c.from_y + (c.to_y - c.from_y) * v_t;
        v_braced := true;
      end if;
      v_secs := greatest(0.2, sqrt((c.to_x - c.from_x) ^ 2 + (c.to_y - c.from_y) ^ 2)
                              / greatest(0.1, v_pace));
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs => v_secs);
      c.until := c.leg_ends;
      if v_braced then
        insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid)
          values (p_world, c.id, 'brace', 1, 0, c.until, p.uid)
          on conflict (world_id, creature_id, kind) do update set val = excluded.val, n = excluded.n, until = excluded.until, by_uid = excluded.by_uid;
        update player set blessings = blessings - 'brace' where world_id = p_world and uid = p.uid;
        v_brace := null; v_braced := false;
      end if;
    elsif d.heavy and (c.fight_blows + 1) % heavy_every()::int = 0 then
      -- Every `heavy_every`th blow of a kind that hits heavy is drawn back for first.
      c.windup_at := c.until + make_interval(secs => wind_up());
      c.until := c.windup_at;
      perform tell(p_world, p.uid, 'The ' || lower(d.name) || ' draws back for a heavy blow. Step out of its reach.', 'fight');
    else
      c.fight_blows := c.fight_blows + 1;
      perform mark_attacker(p_world, p.uid, c.id);
      perform hurt_player(p_world, p.uid, attack_of(c) * 0.012,
        'The ' || lower(d.name) || ' is on you', coalesce(d.wound, 'bite'));
      c.until := c.until + make_interval(secs => blow_every(d) / (beast_mul(c, 'haste') * class_limbs(p_world, c.id))) + class_stagger_owed(p_world, c.id);
    end if;
  end loop;
  return c;
end $function$;

-- Ironhide on the island too, and Hard to Kill.
CREATE OR REPLACE FUNCTION public.hurt_player(p_world uuid, p_uid uuid, p_raw double precision, p_what text, p_kind text DEFAULT 'bite'::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player; shield item; sh shield_def; chance double precision; roll double precision;
        part text; piece item; cls armour_class_def; soak double precision; taken double precision;
        health double precision; ws jsonb; had jsonb; found_w boolean := false; out_w jsonb := '[]'::jsonb;
        w jsonb; k wound_kind_def; note text; aegis double precision; v_worn double precision;
        v_from creature; v_venom boolean := false; v_dodge double precision; v_guard uuid; v_watch uuid;
begin
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found then return; end if;
  -- Dodged, before anything else has its say (`dodge_chance`): your body control, less the armour on you.
  select * into v_from from creature where world_id = p_world and id = (p.stats->>'hurtBy')::int;
  -- Nothing is struck inside a Truce, nor by anything standing in one (`faith_truce`).
  if faith_truce(p_world, p.x, p.y)
     or (v_from.id is not null and faith_truce(p_world, creature_x(v_from), creature_y(v_from))) then
    return;
  end if;
  -- A creature's blow lands on an Archer's Decoy instead, while it holds.
  if v_from.id is not null and (p.blessings->'decoy'->>'until')::timestamptz > now() then
    perform tell(p_world, p_uid, 'The ' || coalesce((select lower(name) from species_def where id = v_from.species), 'creature')
      || ' strikes your decoy.', 'fight');
    return;
  end if;
  -- And none lands at all inside a Warder's Unbreakable.
  if v_from.id is not null and (p.blessings->'unbreakable'->>'until')::timestamptz > now() then
    perform tell(p_world, p_uid, 'The ' || coalesce((select lower(name) from species_def where id = v_from.species), 'creature')
      || '’s blow does not land: ' || (select name from class_spell where id = 'warder_unbreakable') || '.', 'fight');
    perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
    return;
  end if;
  -- A Sworn Blade's Guardian standing near may take it on a shield instead (`class_guardian`).
  if v_from.id is not null then
    v_guard := class_guardian(p_world, p.x, p.y, p_uid);
    if v_guard is not null then
      perform class_guard_take(p_world, v_guard, p_raw,
        coalesce((select lower(name) from species_def where id = v_from.species), 'creature'), p.name);
      perform tell(p_world, p_uid, (select name from player where world_id = p_world and uid = v_guard)
        || ' takes the ' || coalesce((select lower(name) from species_def where id = v_from.species), 'creature')
        || '’s blow on a shield.', 'fight');
      perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
      return;
    end if;
  end if;
  -- No roll at all while there is no chance, so nothing else's luck moves.
  v_dodge := dodge_chance(skill_of(p_world, p_uid, 'body_control'), worn_kg(p_world, p_uid));
  if v_dodge > 0 and random() < v_dodge then
    perform skill_raise(p_world, p_uid, 'body_control', dodge_gain());
    perform tell(p_world, p_uid, 'You dodge the '
      || coalesce((select lower(name) from species_def where id = v_from.species), 'blow') || '.', 'fight');
    -- And answered, for a Skirmisher's Riposte: owed now, struck once its row is written (`class_riposte`).
    if v_from.id is not null and pk(p_world, p_uid, 'riposte:blow', 0) > 0 then
      insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid)
        values (p_world, v_from.id, 'riposte', pk(p_world, p_uid, 'riposte:blow', 0), 1, now(), p_uid)
        on conflict (world_id, creature_id, kind) do update set n = coalesce(class_mark.n, 0) + 1
          where class_mark.by_uid = excluded.by_uid;
    end if;
    perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
    return;
  end if;
  /*
   * A blow that lands. A Warder's Thorns answers it with its share of the
   * creature's own attack, and the nearest other Warder with Watchful within
   * their reach of you turns it on themselves -- both owed now and paid once
   * its row is written (`class_owed_pay`).
   */
  if v_from.id is not null then
    if pk(p.class_mul, 'thorns:attack', 0) > 0 then
      insert into class_mark (world_id, creature_id, kind, val, until, by_uid)
        values (p_world, v_from.id, 'thorns', attack_of(v_from) * pk(p.class_mul, 'thorns:attack', 0), now(), p_uid)
        on conflict (world_id, creature_id, kind) do update set val = class_mark.val + excluded.val, by_uid = excluded.by_uid;
    end if;
    select w.uid into v_watch from player w
     where w.world_id = p_world and w.uid <> p_uid and not w.away and w.combat_class = 'warder'
       and pk(w.class_mul, 'watch:reach', 0) > 0 and v_from.hunting is distinct from w.uid
       and (w.x - p.x) ^ 2 + (w.y - p.y) ^ 2 <= pk(w.class_mul, 'watch:reach', 0) ^ 2
     order by (w.x - p.x) ^ 2 + (w.y - p.y) ^ 2, w.uid limit 1;
    if v_watch is not null then
      insert into class_mark (world_id, creature_id, kind, val, until, by_uid)
        values (p_world, v_from.id, 'watched', 1, now(), v_watch)
        on conflict (world_id, creature_id, kind) do update set by_uid = excluded.by_uid;
    end if;
  end if;
  -- A venomous bite leaves venom in what it opens (`venom_secs`).
  -- A Ward, and then a Shield of Dawn, before anything else is asked of the blow (`faith_blunt`).
  p_raw := faith_blunt(p_world, p_uid, p_raw);
  if p_raw <= 0 then
    perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
    return;
  end if;
  -- A striker made to Cower lands its share less (`faith_weakened`).
  p_raw := p_raw * faith_weakened(p_world, v_from.id);
  -- And one Disarming Cut left on it lands its share less, counted off (`class_disarm_take`).
  p_raw := p_raw * class_disarm_take(p_world, v_from.id);
  -- And one that is burning lands its share less on a Kindler's Flame Ward (`class_burning`).
  if v_from.id is not null and pk(p.class_mul, 'ward:burning', 1) <> 1 and class_burning(p_world, v_from.id) then
    p_raw := p_raw * pk(p.class_mul, 'ward:burning', 1);
  end if;
  -- And one held, rooted or slowed lands its share less on a Binder's Frost Ward (`class_stilled`),
  if v_from.id is not null and pk(p.class_mul, 'ward:stilled', 1) <> 1 and class_stilled(p_world, v_from) then
    p_raw := p_raw * pk(p.class_mul, 'ward:stilled', 1);
  end if;
  -- and one inside a Dull Claws lands its share less on anybody (`class_dull`),
  if v_from.id is not null then p_raw := p_raw * class_dull(p_world, v_from.id); end if;
  -- and every blow its share less inside a Binder's Still Skin,
  if (p.blessings->'still_skin'->>'until')::timestamptz > now() then
    p_raw := p_raw * (1 - (p.blessings->'still_skin'->>'cut')::double precision);
  end if;
  -- and inside a Warder's Stoneskin, and again inside a Bastion of Stone.
  if (p.blessings->'stoneskin'->>'until')::timestamptz > now() then
    p_raw := p_raw * (1 - (p.blessings->'stoneskin'->>'cut')::double precision);
  end if;
  if (p.blessings->'bastion_stone'->>'until')::timestamptz > now() then
    p_raw := p_raw * (1 - (p.blessings->'bastion_stone'->>'cut')::double precision);
  end if;
  v_venom := coalesce((select venom from species_def where id = v_from.species), false);
  -- Harder or softer for the way you stand (`stance_taken`), before anything has its say,
  p_raw := p_raw * my_stance_taken(p_world, p_uid, p.fight_stance)
    -- and less inside a Sworn Blade's Last Stand,
    * case when (p.blessings->'last_stand'->>'until')::timestamptz > now()
           then 1 - (p.blessings->'last_stand'->>'cut')::double precision else 1 end
    -- and more inside a Berserker's Battle Rage,
    * case when (p.blessings->'battle_rage'->>'until')::timestamptz > now()
           then (p.blessings->'battle_rage'->>'taken')::double precision else 1 end
    -- and less on a Pikeman's feet that have not moved (Bastion), as `hurtPlayer` has it, which `fight_back` asks the same of;
    * case when p.moved_at is null or p.moved_at <= now() - make_interval(secs => fight_back_still())
           then pk(p.class_mul, 'still:taken', 1) else 1 end;
  -- and harder from something on you that is not what you are fighting: it is at your back (`flank_hit`).
  if is_fight(p.act) and p.act_target->>'kind' = 'creature' and p.stats ? 'hurtBy'
     and (p.act_target->>'id')::int is distinct from (p.stats->>'hurtBy')::int then
    p_raw := p_raw * flank_hit();
  end if;

  -- Being hit in the dark teaches more about watching than hitting does, and
  -- before the shield, because a blow you turned is still a blow you did not
  -- see coming.
  perform fought_in_dark(p_world, p_uid, dark_hit());

  /*
   * The skin a warder put over you, which takes the blow instead and is spent
   * doing it.
   *
   * Before the shield, because it is not a thing you are holding -- it is
   * between the blow and everything you are holding. A skin that covers the
   * whole blow stops it dead; one that does not goes, and what is left of the
   * blow carries on into the shield and the armour as it always did. Nothing
   * downstream of here knows it happened.
   */
  aegis := coalesce((p.stats->>'aegis')::double precision, 0);
  if aegis > 0 then
    if aegis >= p_raw then
      update player set stats = jsonb_set(stats, '{aegis}', to_jsonb(aegis - p_raw))
        where world_id = p_world and uid = p_uid;
      perform tell(p_world, p_uid, 'The ward takes ' || p_what || ', and holds.', 'fight');
      -- Taken to the last of it: a Second Wind, and a Ward Link of whoever laid it (`warder_skin_spent`).
      if aegis - p_raw <= 1e-9 then perform warder_skin_spent(p_world, p_uid); end if;
      perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
      return;
    end if;
    update player set stats = jsonb_set(stats, '{aegis}', to_jsonb(0::double precision))
      where world_id = p_world and uid = p_uid;
    p_raw := p_raw - aegis;
    perform tell(p_world, p_uid, 'The ward goes with a sound like ice, and the rest of it reaches you.', 'fight');
    perform warder_skin_spent(p_world, p_uid);
  end if;

  -- The shield, next.
  shield := worn(p_world, p_uid, 'offhand');
  if shield.id is not null then
    select * into sh from shield_def where id = shield.def;
    if found then
      -- With what a Sworn Blade's Shield Mastery adds, under the ceiling it raises (`shield_block`).
      chance := shield_block(p_world, p_uid, sh, shield.ql)
        -- Less of one for every other thing on you than the one that struck (`crowd_block`).
        * greatest(0, 1 - crowd_block() * (select count(*) from creature o
            where o.world_id = p_world and o.hunting = p_uid and o.mode = 'wild' and o.health > 0 and o.brawl is null
              and o.id is distinct from (p.stats->>'hurtBy')::int));
      perform skill_raise(p_world, p_uid, 'shields', 0.12);
      if random() < chance then
        -- Less for a Mender's Armour Care.
        update item set dmg = least(100, dmg + p_raw * 3 * pk(p_world, p_uid, 'worn:shield', 1)) where id = shield.id;
        perform skill_raise(p_world, p_uid, 'shields', 0.5);
        perform tell(p_world, p_uid, 'You take ' || p_what || ' on your '
          || lower((select name from item_def where id = shield.def)) || '.', 'fight');
        if v_from.id is not null then
          -- A Sworn Blade's Counterweight: its next blow put back, paid by its own turn (`class_stagger_owed`).
          if pk(p.class_mul, 'stagger:block', 0) > 0 then
            insert into class_mark (world_id, creature_id, kind, val, until, by_uid)
              values (p_world, v_from.id, 'stagger', pk(p.class_mul, 'stagger:block', 0), now() + interval '1 minute', p_uid)
              on conflict (world_id, creature_id, kind) do update set val = class_mark.val + excluded.val, until = excluded.until;
          end if;
          -- And a Deflect sends its share of the blow back, paid as a Retribution's is (`faith_owed`).
          if (p.blessings->'deflect'->>'until')::timestamptz > now() then
            insert into faith_owed (world_id, creature_id, dmg, from_uid)
              values (p_world, v_from.id, p_raw * (p.blessings->'deflect'->>'share')::double precision / blow_share(), p_uid);
          end if;
        end if;
        -- A blow turned is still a blow, and you turn on whatever struck it.
        perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
        return;
      end if;
    end if;
  end if;

  -- Then wherever it lands.
  roll := random();
  select h.slot into part from (
    select slot, sum(share) over (order by ord) as upto from hit_location) h
  where roll <= h.upto order by h.upto limit 1;
  part := coalesce(part, 'chest');

  taken := p_raw;
  note := '';
  piece := worn(p_world, p_uid, part);
  if piece.id is not null and exists (select 1 from armour_def where id = piece.def) then
    select c.* into cls from armour_def a join armour_class_def c on c.id = a.cls where a.id = piece.def;
    -- And the trade, on the line of armour this piece belongs to: a pikeman's
    -- harness does nothing for the leather an archer is wearing.
    soak := piece_soak(piece, skill_of(p_world, p_uid, cls.skill))
          * class_mul(p_world, p_uid, 'guard', cls.skill)
          -- And what this class of armour makes of this kind of blow (`armour_vs`).
          * armour_vs(cls.id, p_kind)
          -- And more for Power's Ironhide (`absorb`).
          * path_fx(p_world, p_uid, 'hide', 1);
    -- Armour is learned by being hit in it, and worn out the same way.
    perform skill_raise(p_world, p_uid, cls.skill, 0.4);
    -- Less for a Mender's Armour Care.
    -- And a burn wears it out `burn_wear` times as fast.
    v_worn := p_raw * 4 * pk(p_world, p_uid, 'worn:armour', 1) * case when p_kind = 'burn' then burn_wear() else 1 end;
    update item set dmg = least(100, dmg + v_worn) where id = piece.id;
    if (select i.dmg from item i where i.id = piece.id) >= 100 then
      delete from item where id = piece.id;
      update player set equipped = equipped - part where world_id = p_world and uid = p_uid;
      perform tell(p_world, p_uid, 'Your ' || lower((select name from item_def where id = piece.def))
        || ' is beaten to pieces and falls away.', 'fight');
    else
      note := ', though your ' || lower((select name from item_def where id = piece.def)) || ' takes the worst of it';
    end if;
    taken := p_raw * (1 - least(0.92, soak));
  end if;

  select * into k from wound_kind_def where id = p_kind;
  -- Open a wound, or deepen one of the same kind already in that place.
  for w in select * from jsonb_array_elements(coalesce(p.wounds, '[]'::jsonb)) loop
    if not found_w and w->>'kind' = p_kind and w->>'part' = part and not (w->>'infected')::boolean then
      -- Less of a wound than of a blow for a Sworn Blade's Battle-Hardened; the health it takes is the same.
      w := jsonb_set(w, '{severity}', to_jsonb((w->>'severity')::double precision + taken * pk(p.class_mul, 'severity:wound', 1)));
      if k.bleed > 0.001 then w := jsonb_set(w, '{bleeding}', 'true'); end if;
      if v_venom then w := jsonb_set(w, '{venom}', to_jsonb(venom_secs())); end if;
      found_w := true;
    end if;
    out_w := out_w || w;
  end loop;
  if not found_w then
    -- A bruise does not bleed; everything else does until it is seen to. And a fresh one less deep for a Pikeman's Scarred.
    w := jsonb_build_object('kind', p_kind, 'part', part,
      'severity', taken * pk(p.class_mul, 'severity:wound', 1) * pk(p.class_mul, 'severity:new', 1),
      'bleeding', p_kind <> 'crush', 'infected', false, 'dressing', null, 'at', now())
      || case when v_venom then jsonb_build_object('venom', venom_secs()) else '{}'::jsonb end;
    out_w := out_w || w;
  end if;

  -- A Retribution's share of what landed goes back to whatever struck, paid when it is next settled (`faith_owed`).
  if v_from.id is not null and (p.blessings->'retribution'->>'until')::timestamptz > now() then
    insert into faith_owed (world_id, creature_id, dmg, from_uid)
      values (p_world, v_from.id, taken * (p.blessings->'retribution'->>'share')::double precision / blow_share(), p_uid);
  end if;
  -- And answered by your companion inside a Beastmaster's Vengeance: owed now, struck once its row is written (`class_vengeance`).
  if v_from.id is not null and (p.blessings->'vengeance'->>'until')::timestamptz > now() then
    insert into class_mark (world_id, creature_id, kind, val, n, until, by_uid)
      values (p_world, v_from.id, 'vengeance', (p.blessings->'vengeance'->>'more')::double precision, 1, now(), p_uid)
      on conflict (world_id, creature_id, kind) do update set n = coalesce(class_mark.n, 0) + 1
        where class_mark.by_uid = excluded.by_uid;
  end if;
  -- And set alight for a Kindler's Burning Retort: owed now, lit once its row is written (`class_owed_pay`).
  if v_from.id is not null and pk(p.class_mul, 'retort:each', 0) > 0 then
    insert into class_mark (world_id, creature_id, kind, val, until, by_uid)
      values (p_world, v_from.id, 'retort', pk(p.class_mul, 'retort:each', 0), now(), p_uid)
      on conflict (world_id, creature_id, kind) do update set val = excluded.val, by_uid = excluded.by_uid;
  end if;
  -- A share of it on your companion, for a Beastmaster's Feral Bond or Shared Wounds (`class_bond_take`).
  taken := class_bond_take(p_world, p_uid, taken, v_from.id);
  -- And an Oath puts half of it on the friend sworn to (`faith_oath`).
  taken := faith_oath(p_world, p_uid, taken);
  health := greatest(0, coalesce((p.stats->>'health')::double precision, 1) - taken);
  /*
   * Built from the row as it stands rather than from the copy taken at the top
   * of this function.
   *
   * `p` is a snapshot, and writing `p.stats` back puts everything in it back
   * -- including anything this function itself changed on the way down. That
   * was harmless while nothing did, and the ward is the first thing that does:
   * it was spent against the blow, and then handed straight back, so a warder's
   * skin absorbed for ever. Measured, before the fix: a 0.15 skin took 0.15 of
   * a 0.20 blow, the remaining 0.05 opened a wound as it should -- and the skin
   * read 0.15 again afterwards.
   *
   * Unqualified, `stats` is the column of the row being updated, which is the
   * live value. Nothing else in here reads it after this point.
   */
  update player set wounds = out_w,
      stats = jsonb_set(jsonb_set(stats, '{health}', to_jsonb(health)),
                        '{hurtSettled}', to_jsonb(now()))
    where world_id = p_world and uid = p_uid;
  -- And a sitting it lands in is over, with nothing come of it (`sitting_struck`), before anything turns to fight.
  perform sitting_struck(p_world, p_uid);
  perform tell(p_world, p_uid, p_what || note || '. You have ' || wound_text(w) || '.', 'fight');
  -- And a Second Life, which the killing blow spends instead of you (`faith_second_life`).
  -- Undying holds you at its floor and is not spent; a Second Life is.
  if health <= 0 and faith_undying(p_world, p_uid) then perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
  elsif health <= 0 and faith_second_life(p_world, p_uid) then perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
  -- And Power's Hard to Kill, once in so long (`path_hard_to_kill`).
  elsif health <= 0 and path_hard_to_kill(p_world, p_uid) then perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int);
  elsif health <= 0 then perform player_die(p_world, p_uid);
  else perform fight_back(p_world, p_uid, (p.stats->>'hurtBy')::int); end if;
end $function$;

-- Enduring on hunger and thirst; Hard Breath, Deep Lungs and Unbroken on deep water.
CREATE OR REPLACE FUNCTION public.body_settle(p_world uuid, p_uid uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player; secs double precision;
        h double precision; t double precision; w double precision; hp double precision;
        deep boolean; swum double precision; swim_from timestamptz; nagged timestamptz;
        cost double precision; gasped double precision; i int;
        v_upkeep double precision; v_free double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid for update;
  if not found then return; end if;
  secs := least(body_gap(), extract(epoch from (now() - p.body_at)));
  if secs <= 0 then
    update player set body_at = now() where world_id = p_world and uid = p_uid;
    return;
  end if;
  h := coalesce((p.stats->>'hunger')::double precision, 1);
  t := coalesce((p.stats->>'thirst')::double precision, 1);
  w := coalesce((p.stats->>'stamina')::double precision, 1);
  hp := coalesce((p.stats->>'health')::double precision, 1);
  deep := coalesce(in_deep_water(p_world, p_uid), false);
  swim_from := coalesce(p.swim_at, p.body_at);
  nagged := p.drowned_at;

  /*
   * What is on your table, which holds hunger and thirst off.
   *
   * `upkeep_mul` reads the *average* of the four, so anything at all in you
   * helps and a full table helps most. `kept_best` has been crossed from the
   * browser since nutrition was written and nothing on this island read it, so
   * a body that ate well got nothing for it but the bar going up once.
   */
  -- And slower for Power's Enduring.
  v_upkeep := path_fx(p_world, p_uid, 'upkeep', 1);
  h := greatest(0, h - secs * hunger_rate() * upkeep_mul(p.nutrition) * v_upkeep);
  t := greatest(0, t - secs * thirst_rate() * upkeep_mul(p.nutrition) * v_upkeep);

  if deep then
    /*
     * Open water, which cost nothing at all until now.
     *
     * A strong swimmer tires more slowly — the same easing the browser has
     * always applied — and a swimmer with no wind left is swallowing water.
     * The warning is spaced by `drown_warn` off the row rather than off a
     * clock in a tab, because `body_settle` runs on every walk and every beat
     * and an unspaced line would be a wall of them.
     */
    -- And less for Power's Hard Breath (`swimWind`).
    cost := swim_wind() * greatest(0.4, 1 - skill_of(p_world, p_uid, 'swimming') / 200) * path_fx(p_world, p_uid, 'swim', 1);
    -- And nothing for the stretch of it inside a Deep Lungs or an Unbroken (Power's): free from the last settling up to the later of the two.
    v_free := greatest(0, least(secs, extract(epoch from (least(now(), greatest(
      coalesce((p.blessings->'path_lungs'->>'until')::timestamptz, p.body_at),
      coalesce((p.blessings->'path_unbroken'->>'until')::timestamptz, p.body_at))) - p.body_at))));
    /*
     * How much of the stretch there was breath for, and how much of it there
     * was not. The browser asks that of every frame it draws; here it is one
     * division, and it has to be asked: a stretch that *ends* out of breath is
     * not a stretch that spent the whole of itself drowning, and charging it
     * as one turns twenty seconds in the water into a death.
     */
    gasped := greatest(0, (secs - v_free) - (case when cost > 0 then w / cost else 0 end));
    w := greatest(0, w - (secs - v_free) * cost);
    if gasped > 0 then
      hp := greatest(0, hp - gasped * drown_rate());
      if nagged is null or now() - nagged > make_interval(secs => drown_warn()) then
        perform tell(p_world, p_uid,
          'You are exhausted and swallowing water. Get to shore!', 'error');
        nagged := now();
      end if;
    end if;
    /*
     * And deep water is its own teacher — a go a second, and no other way.
     *
     * Two things push at this from opposite sides and only one shape satisfies
     * both. `skill_gain_of` has a floor under it (`min_gain`), so a base scaled
     * by a tenth of a second is not a tenth of a second's worth — it is the
     * floor, and a browser settling ten times a second would buy ten goes out
     * of one. And `skill_room` falls as the number rises, so one go of a
     * minute's worth is a quarter more than sixty goes of a second's:
     *
     *     sixty goes of 0.09, a second apiece      1 -> 6.4278
     *     one go of 5.40, the whole minute at once 1 -> 8.0092
     *
     * — which a body left floating while the tab is shut would collect by the
     * three minutes, over and over, drowning each time and not minding.
     *
     * So the clock runs on the row and is spent a whole second at a time, the
     * way `swimClock` spends it over there. Twenty-five goes to a call, as in
     * `settle`, and what is left stays on the clock for the next one — and a
     * body that reaches the shore drops the backlog, because ashore is where
     * the clock starts again.
     */
    swum := least(floor(extract(epoch from (now() - swim_from))), 25);
    if swum >= 1 then
      for i in 1..swum::int loop
        perform skill_raise(p_world, p_uid, 'swimming', swim_learn());
      end loop;
      swim_from := swim_from + make_interval(secs => swum);
    end if;
  else
    if p.act is null then
      /*
       * And your wind, which comes back slower on the move.
       *
       * `wind_walk()` was crossed the day the body was and called by nothing, so
       * a body that walked all day got its wind back as fast as one sitting
       * down. The island cannot watch your feet between beats, so it asks the
       * one thing it does know: whether the body moved at all during the stretch
       * this is settling. Moved in it, walked through it.
       */
      w := least(1, w + secs
             * (case when p.moved_at > p.body_at then wind_walk() else wind_rest() end)
             * (1 + greatest(0, skill_of(p_world, p_uid, 'body_stamina') - char_start()) * wind_per_level())
             * (case when h <= 0 or t <= 0 then wind_starving() else 1 end));
    end if;
    -- Ashore, so the swimming clock starts again from nothing and the
    -- telling-off is forgotten.
    swim_from := now();
    nagged := null;
  end if;

  -- Nothing knits while you are trying not to drown.
  if not deep and h > heal_fed() and t > heal_fed() and hp < 1 then
    hp := least(1, hp + secs * heal_rate());
  end if;
  -- And a Renewal's share of the time since the body was last settled (`faith_renewal`), and a Chirurgeon's Regenerate's (`class_regen`).
  hp := least(1, hp + faith_renewal(p.blessings, p.body_at) + class_regen(p.blessings, p.body_at));

  /*
   * And the rest banked by a night in a bed, which burns while you work.
   *
   * `rest_bonus()` was crossed from the browser the day sleeping was ported
   * and nothing ever called it, so the rest went in and never came out: a body
   * that had slept once carried it for ever, and would have carried a doubled
   * rate for ever the moment anything spent it. It burns a second a second,
   * and only while there is a job in hand — standing about is not work.
   */
  if p.act is not null and coalesce(p.rested, 0) > 0 then
    update player set rested = greatest(0, p.rested - secs)
      where world_id = p_world and uid = p_uid;
    if p.rested - secs <= 0 then
      perform tell(p_world, p_uid,
        'The rest goes out of you. Skills go in at their ordinary pace again.', 'system');
    end if;
  end if;

  /*
   * And what is on the table going off, which nothing here did either.
   *
   * `nutrient_decay` is a full measure falling away to nothing over fifty
   * minutes of world time. Without it one good dinner fed a body for the rest
   * of its life, which would have been the reward for porting `upkeep_mul`
   * above rather than a rule.
   */
  if p.nutrition is not null and p.nutrition <> '{}'::jsonb then
    update player set nutrition = (
        select jsonb_object_agg(k, greatest(0, (p.nutrition->>k)::double precision - secs * nutrient_decay()))
          from jsonb_object_keys(p.nutrition) k)
      where world_id = p_world and uid = p_uid;
  end if;

  update player set body_at = now(), swim_at = swim_from, drowned_at = nagged,
    stats = jsonb_set(jsonb_set(jsonb_set(jsonb_set(
      coalesce(stats, '{}'::jsonb),
      '{hunger}', to_jsonb(h)), '{thirst}', to_jsonb(t)),
      '{stamina}', to_jsonb(w)), '{health}', to_jsonb(hp))
    where world_id = p_world and uid = p_uid;
  -- And a body that has taken its last breath, where every other death goes.
  if hp <= 0 then perform player_die(p_world, p_uid); end if;
end $function$;

-- Nothing for a go while Power's Unbroken holds.
CREATE OR REPLACE FUNCTION public.spend_wind(p_world uuid, p_uid uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare cost double precision; secs double precision; w double precision;
        body double precision; spent double precision; v_idle boolean;
        v_skill text; v_mul jsonb;
begin
  select stamina, base_time, skill into cost, secs, v_skill from action_def where id = p_action;
  -- A swing costs what is swung: more for every kilogram in the hand (`act_wind`).
  cost := act_wind(p_world, p_uid, p_action, cost);
  -- And nothing at all while Power's Unbroken holds (`staminaCost`).
  if path_running(p_world, p_uid, 'path_unbroken') then cost := 0; end if;
  -- A swing is done with whatever is in your hand, not with `fighting`.
  v_skill := act_scope(p_world, p_uid, v_skill);
  -- And nothing at all for the jobs that are not work: the named ones, and the
  -- ones that ask nothing of you. The wind below is still spent where there is
  -- any: a cost is not a lesson.
  v_idle := teaches_nothing(p_action)
         or (coalesce(cost, 0) <= 0 and coalesce(secs, 0) <= 0);
  /*
   * What the go taught the hands, whatever it was and whatever it cost.
   *
   * Before the wind, and outside the guard below, because a go that costs no
   * wind but takes time is still work: shuttering, sighting a level, watching
   * a kiln. It is not the digging skill — a body that has swung a shovel a
   * thousand times has a steadier hand than one that has not, at anything.
   */
  if not v_idle then
    perform char_told(p_world, p_uid, 'body_control', work_hand());
    -- And the back, from the heavy trades: a shovel or a pick, whatever the go found.
    if coalesce((select s.heavy from action_def a join skill_def s on s.id = a.skill where a.id = p_action), false) then
      perform char_told(p_world, p_uid, 'body_strength', work_back());
    end if;
  end if;
  if coalesce(cost, 0) <= 0 then return; end if;
  perform body_settle(p_world, p_uid);
  -- A hardy body spends less on the same job. No burden here: the island does
  -- not know what you are carrying.
  body := greatest(0.45, 1 - greatest(0, skill_of(p_world, p_uid, 'body_stamina') - char_start()) * 0.0045);
  select coalesce((pl.stats->>'stamina')::double precision, 1), coalesce(pl.class_mul, '{}'::jsonb)
    into w, v_mul
    from player pl where pl.world_id = p_world and pl.uid = p_uid;
  -- And the tree, on the trade this go belongs to and no other. The read it
  -- wants is the read the wind already had to do, so it costs nothing.
  spent := cost * body * class_mul(v_mul, 'wind', v_skill);
  update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}',
      to_jsonb(greatest(0, w - spent)))
    where world_id = p_world and uid = p_uid;
  /*
   * And what spending it taught the chest.
   *
   * On what was actually spent rather than on what the job lists, so the same
   * dig teaches a tired body and a hardy one differently — which is the same
   * arithmetic the wind itself came off. The browser reckons its own spend
   * with the burden folded in and this island does not know what anybody is
   * carrying, so a laden body learns a shade less here than the browser drew
   * while it waited. That gap is the burden's, and it was there before this.
   */
  if not v_idle then
    perform char_told(p_world, p_uid, 'body_stamina', work_wind() + spent * work_wind_spent());
  end if;
end $function$;

-- A fighting trade's spell costs no stamina while Power's Unbroken holds.
CREATE OR REPLACE FUNCTION public.rpc_cast_spell(p_world uuid, p_slot integer, p_target jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); v_spell text; v_why text; s spell_any; v_at jsonb; v_out jsonb; v_was jsonb; v_told jsonb;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  if not exists (select 1 from spell_slot where slot = p_slot) then
    return jsonb_build_object('why', 'There is no such slot.');
  end if;
  select spell_bar->>p_slot into v_spell from player where world_id = p_world and uid = me;
  if v_spell is null then return jsonb_build_object('why', 'Nothing is in that slot.'); end if;
  v_why := spell_cast_refusal(p_world, me, v_spell);
  if v_why is not null then return jsonb_build_object('why', v_why); end if;
  select * into s from spell_any where id = v_spell;
  v_at := spell_target(p_world, me, v_spell, coalesce(p_target, '{}'::jsonb));
  if v_at ? 'why' then return v_at; end if;
  -- What it did, told as it is done (`fx_open`), and the spells of yours it may use up, as they were before it.
  select blessings into v_was from player where world_id = p_world and uid = me;
  perform fx_open();
  if s.school = 'class' then
    -- A fighting trade's (`class_spell_cast`), paid in stamina, and where a Lunge put you, for the browser to follow.
    v_out := class_spell_cast(p_world, me, v_spell, v_at);
    v_told := fx_told(p_world, me, v_was);
    if v_out ? 'why' then return v_out; end if;
    update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}',
          -- Less for a Kindler's Deep Breath.
          to_jsonb(greatest(0, coalesce((stats->>'stamina')::double precision, 1) - s.cost * pk(class_mul, 'cast:cost', 1)
            -- And nothing while Power's Unbroken holds.
            * case when (blessings->'path_unbroken'->>'until')::timestamptz > now() then 0 else 1 end))),
        used_at = jsonb_set(coalesce(used_at, '{}'::jsonb), array['spell:' || s.id], to_jsonb(now()), true)
      where world_id = p_world and uid = me;
    -- And a Kindler's fire the larger for it, for a Blaze Momentum (`class_momentum`).
    perform class_momentum(p_world, me);
    perform tell(p_world, me, v_out->>'said', 'system');
    return faith_said(p_world, me) || jsonb_build_object('cast', s.id, 'said', v_out->>'said')
      || case when v_out ? 'put' then jsonb_build_object('put', v_out->'put') else '{}'::jsonb end
      || case when v_out ? 'pace' then jsonb_build_object('pace', v_out->'pace') else '{}'::jsonb end
      -- And what it did, for the browser to draw (`fx_told`).
      || v_told;
  end if;
  if s.school = 'path' then
    -- A path's technique (`path_technique_cast`), paid in Calm; one that found nothing costs nothing.
    v_out := path_technique_cast(p_world, me, v_spell, v_at);
    v_told := fx_told(p_world, me, v_was);
    if v_out ? 'why' then return v_out; end if;
    update player set calm = greatest(0, coalesce(calm, 0) - s.cost),
        used_at = jsonb_set(coalesce(used_at, '{}'::jsonb), array['spell:' || s.id], to_jsonb(now()), true)
      where world_id = p_world and uid = me;
    perform journal_note(p_world, me, 'cast:' || s.id);
    perform skill_raise(p_world, me, meditation_skill(), technique_gain());
    perform tell(p_world, me, v_out->>'said', 'system');
    return faith_said(p_world, me) || jsonb_build_object('cast', s.id, 'said', v_out->>'said') || v_told;
  end if;
  v_out := faith_spell_cast(p_world, me, v_spell, v_at);
  v_told := fx_told(p_world, me, v_was);
  if v_out ? 'why' then return v_out; end if;
  perform favour_settle(p_world, me);
  update player set favour = greatest(0, favour - s.cost),
      used_at = jsonb_set(coalesce(used_at, '{}'::jsonb), array['spell:' || s.id], to_jsonb(now()), true)
    where world_id = p_world and uid = me;
  perform class_momentum(p_world, me);
  perform skill_raise(p_world, me, faith_skill(), 0.6);
  perform tell(p_world, me, v_out->>'said', 'system');
  return faith_said(p_world, me) || jsonb_build_object('cast', s.id, 'said', v_out->>'said') || v_told;
end $function$;

-- And is not refused for want of it then.
CREATE OR REPLACE FUNCTION public.spell_cast_refusal(p_world uuid, p_uid uuid, p_spell text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare s spell_any; p player; v_left double precision; v_favour double precision; v_stamina double precision; v_needs text;
        v_cost double precision;
begin
  select * into s from spell_any where id = p_spell;
  if not found then return 'There is no such spell.'; end if;
  -- A patron's taken, or your fighting trade's taken while you hold the trade (`spell_known`).
  if not spell_known(p_world, p_uid, p_spell) then return 'You do not have that spell.'; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 'You are not on this island.'; end if;
  v_left := spell_rest_left(p.used_at, s.id, s.rest);
  if v_left > 0 then return s.name || ' can be called again in ' || ceil(v_left)::int || ' seconds.'; end if;
  if s.school = 'class' then
    -- A trade's spell is paid for in stamina, as a share of a full bar.
    v_stamina := coalesce((p.stats->>'stamina')::double precision, 1);
    -- Less for a Kindler's Deep Breath.
    v_cost := s.cost * pk(p.class_mul, 'cast:cost', 1)
      -- And nothing while Power's Unbroken holds.
      * case when (p.blessings->'path_unbroken'->>'until')::timestamptz > now() then 0 else 1 end;
    if v_stamina < v_cost then
      return s.name || ' costs ' || trim_scale(round((v_cost * 100)::numeric, 1)) || '% of your stamina; you have '
        || floor(v_stamina * 100)::int || '%.';
    end if;
    -- What it wants in your hands (`needs`): a shield in the off hand, or a weapon of a kind in the other.
    select cs.needs into v_needs from class_spell cs where cs.id = p_spell;
    if v_needs = 'shield' and not exists (select 1 from shield_def sd where sd.id = (worn(p_world, p_uid, 'offhand')).def) then
      return s.name || ' wants a shield in your off hand.';
    end if;
    if v_needs in ('axes', 'mauls') and (swung_with(p_world, p_uid)).kind is distinct from v_needs then
      return s.name || ' wants ' || case v_needs when 'axes' then 'an axe' else 'a maul' end || ' in your hand.';
    end if;
    -- And a shot a bow in your hands and an arrow to loose, as a draw does (`fight_refusal`).
    if v_needs = 'archery' then
      if not exists (select 1 from weapon_def bw where bw.id = (worn(p_world, p_uid, 'weapon')).def and bw.ammo is not null) then
        return s.name || ' wants a bow in your hands.';
      end if;
      if coalesce((select sum(pack_count(p_world, p_uid, idf.id)) from item_def idf where arrow_head_of(idf.id) is not null), 0) <= 0 then
        return 'You are out of arrows.';
      end if;
    end if;
    -- And a throw a javelin or a throwing axe in your hand; a Hit and Run one of those or a knife, which bare hands are not.
    if v_needs = 'throwing' and (swung_with(p_world, p_uid)).kind is distinct from 'throwing' then
      return s.name || ' wants a javelin or a throwing axe in your hand.';
    end if;
    if v_needs = 'skirmish' and ((swung_with(p_world, p_uid)).kind not in ('throwing', 'knives') or (swung_with(p_world, p_uid)).id = 'fist') then
      return s.name || ' wants a javelin, a throwing axe or a knife in your hand.';
    end if;
    -- And a Chirurgeon's knife work a knife, which bare hands are not.
    if v_needs = 'knives' and ((swung_with(p_world, p_uid)).kind is distinct from 'knives' or (swung_with(p_world, p_uid)).id = 'fist') then
      return s.name || ' wants a knife in your hand.';
    end if;
    -- And a Kindler's a focus of the school's stones in your pack, to cast it out of (`kindler_focus`).
    if v_needs = 'kindling' and (kindler_focus(p_world, p_uid)).id is null then
      return s.name || ' wants a garnet or ruby focus in your pack.';
    end if;
    -- And a Binder's a focus of its school's stones (`school_focus`).
    if v_needs = 'binding' and (school_focus(p_world, p_uid, 'binding')).id is null then
      return s.name || ' wants a sapphire or diamond focus in your pack.';
    end if;
    -- And a Warder's the same of its own.
    if v_needs = 'warding' and (school_focus(p_world, p_uid, 'warding')).id is null then
      return s.name || ' wants a topaz or emerald focus in your pack.';
    end if;
    -- And a Beastmaster's a companion following you, fit to be told (`class_companion`).
    if v_needs = 'companion' and (class_companion(p_world, p_uid)).id is null then
      return s.name || ' wants a companion following you.';
    end if;
    -- And one paid for in your own health is refused when it would take the last of it.
    if s.fx ? 'health' and coalesce((p.stats->>'health')::double precision, 1) <= (s.fx->>'health')::double precision then
      return s.name || ' costs ' || round((s.fx->>'health')::double precision * 100)::int || '% of your health; you have '
        || floor(coalesce((p.stats->>'health')::double precision, 1) * 100)::int || '%.';
    end if;
    if s.fx ? 'below' and coalesce((p.stats->>'health')::double precision, 1) >= (s.fx->>'below')::double precision then
      return s.name || ' is only for below ' || round((s.fx->>'below')::double precision * 100)::int || '% of your health.';
    end if;
    return null;
  end if;
  -- A path's technique is paid for in Calm (`calmRefusal`).
  if s.school = 'path' then
    if coalesce(p.calm, 0) < s.cost then
      return s.name || ' costs ' || s.cost::int || ' calm; you hold ' || floor(coalesce(p.calm, 0))::int || '. Sit somewhere quiet.';
    end if;
    return null;
  end if;
  v_favour := favour_settle(p_world, p_uid);
  if v_favour < s.cost then
    return s.name || ' costs ' || s.cost::int || ' favour; you hold ' || floor(v_favour)::int || '. Pray at an altar.';
  end if;
  return null;
end $function$;

-- Pack Mule.
CREATE OR REPLACE FUNCTION public.carry_limit(p_world uuid, p_uid uuid)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select carry_base() + skill_of(p_world, p_uid, 'body_strength') * carry_per_strength()
       -- And a Terraformer's Strong Back.
       + pk(p_world, p_uid, 'carry', 0)
       -- And Power's Pack Mule.
       + path_fx(p_world, p_uid, 'mule', 0)
$function$;

-- Long Stride on foot, and a Surge.
CREATE OR REPLACE FUNCTION public.travel_speed(p_world uuid, p_uid uuid)
 RETURNS double precision
 LANGUAGE plpgsql
 STABLE
AS $function$
declare c creature; p placed; v double precision; pl player;
begin
  p := driving(p_world, p_uid);
  if p.id is not null then
    -- As fast as she can go under the hands at her helm, and her builder's
    -- hand in her too: a Carpenter's Keel Layer. And the helm's own Sailing
    -- (`sailing_pace`), as the browser's `boatSpeed` has it.
    if is_boat(p) then
      return hull_speed(p_world, p_uid, p) * mark_of(p.mark, 'speed')
           * sailing_pace(skill_of(p_world, p_uid, sailing_skill()));
    end if;
    v := vehicle_speed(p_world, p.id);
    -- And the driver's Driving on the reins (`driving_pace`), past the cap as the mark is.
    if v > 0 then return v * driving_pace(skill_of(p_world, p_uid, driving_skill())); end if;
    return base_speed();
  end if;
  c := mount_of(p_world, p_uid);
  if c.id is not null then
    -- Shod, it goes quicker on laid stone and gravel.
    select * into pl from player where world_id = p_world and uid = p_uid;
    -- The cap comes after the shoes, as the browser has it: a mount at the cap is at the cap.
    -- And quicker again in tack its maker's hand is in (a Tailor's Saddler), past the cap, as a vehicle's mark is.
    return least(max_mount_speed(), mount_speed(c) * case when shod(c) and paved(land_tile(p_world, floor(pl.x)::int, floor(pl.y)::int))
                                                          then shoe_pace() else 1 end) * tack_speed(c);
  end if;
  -- On foot, and on a made road, a Terraformer's Road Legs; and quicker while a Skirmisher's Hit and Run holds.
  select * into pl from player where world_id = p_world and uid = p_uid;
  v := case when (pl.blessings->'hit_and_run'->>'until')::timestamptz > now()
            then (pl.blessings->'hit_and_run'->>'pace')::double precision else 1 end
    -- And Power's Long Stride, and a Surge while it holds (`pathPace`).
    * path_fx(p_world, p_uid, 'stride', 1)
    * case when (pl.blessings->'path_surge'->>'until')::timestamptz > now()
           then coalesce((select (k.fx->>'pace')::double precision from path_pick k where k.id = 'power_surge'), 1) else 1 end;
  if coalesce((select t.road from tile_def t
                where t.id = land_tile(p_world, floor(pl.x)::int, floor(pl.y)::int)), false) then
    return base_speed() * pk(pl.class_mul, 'walk:road', 1) * v;
  end if;
  return base_speed() * v;
end $function$;

-- Nothing slows a body in a Surge, a load past half again its limit included.
CREATE OR REPLACE FUNCTION public.rpc_move(p_world uuid, p_x double precision, p_y double precision, p_level integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player; w world;
        gap double precision; far double precision; allowed double precision; share double precision;
        pulled boolean := false; blocked boolean := false; crawl double precision := 1;
        cart placed; beast creature; c double precision; v_tiles int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  perform settle(p_world, me);
  select * into p from player where world_id = p_world and uid = me for update;
  if not found then raise exception 'you are not on this island'; end if;
  select * into w from world where id = p_world;
  if p_x < 0 or p_y < 0 or p_x > w.size or p_y > w.size then raise exception 'that is off the island'; end if;

  /*
   * Aboard as a passenger, a body is where she is, whatever its browser says
   * it walked to: the only way off her is `leave_passenger`, and the only way
   * she moves is under whoever has her helm.
   */
  if p.aboard is not null then
    select pl.cx, pl.cy into p_x, p_y from placed pl where pl.id = p.aboard;
    update player set x = p_x, y = p_y, level = 0, moved_at = now(), seen_at = now(), away = false
      where world_id = p_world and uid = me;
    select * into p from player where world_id = p_world and uid = me;
    return jsonb_build_object('x', p_x, 'y', p_y, 'level', 0, 'pulled', false, 'blocked', false,
      'stats', p.stats, 'wounds', coalesce(p.wounds, '[]'::jsonb));
  end if;

  /*
   * And first: how much of a walk this body is good for.
   *
   * Past what a back takes everything is already slower and dearer in wind,
   * and that was the whole of it — load a body with ten times its limit and it
   * still walked, at a crawl. Half again over the limit used to be the flat
   * end of it: this pinned `p_x` and `p_y` to where the body already was, so
   * the only way out of an overload was to put things on the ground and leave
   * them. It is `carry_crawl()` of the pace now — a twentieth — which is slow
   * enough to be no way to travel and quick enough to be a way out.
   *
   * It still has to be decided here rather than only in the browser: what the
   * island will not allow is the only kind of cannot there is, and a limit
   * only the browser holds is a limit a browser can decline.
   *
   * Nothing is said from down here. This call is made a dozen times a walk, so
   * a line each time would be the whole event log; the browser holds the same
   * two numbers and says it once, when it happens.
   */
  -- Not inside a Surge (Power's), which nothing slows.
  if over_carry(p_world, me) > carry_stop() and not coalesce((p.blessings->'path_surge'->>'until')::timestamptz > now(), false) then
    crawl := carry_crawl();
    blocked := true;
  end if;

  gap := greatest(0.05, extract(epoch from (now() - p.moved_at)));
  far := sqrt(power(p_x - p.x, 2) + power(p_y - p.y, 2));
  /*
   * A walk, a saddle or a seat; the rest is slack for a link that hiccups.
   *
   * And `crawl` on the whole of it, slack included, when the load is half
   * again over the limit. It has to take the slack down with it or the slack
   * *is* the allowance: a second and a half of grace on a body that may move
   * a twentieth of a tile a second would let it cross a field a hiccup at a
   * time, which is the rule not applying at all.
   */
  allowed := (travel_speed(p_world, me) * least(gap, 10) * 1.6 + 1.5) * crawl;
  if far > allowed then
    p_x := p.x + (p_x - p.x) * (allowed / far);
    p_y := p.y + (p_y - p.y) * (allowed / far);
    pulled := true;
  end if;

  share := walk_share(p_world, me, p_level, p.x, p.y, p_x, p_y);
  -- Frame: up a storey the edge of what is built there stops a body, railed or not (`frame_footing`).
  if p_level > 0 then share := least(share, frame_footing(p_world, p_level, p.x, p.y, p_x, p_y)); end if;
  if share < 1 then
    p_x := p.x + (p_x - p.x) * share;
    p_y := p.y + (p_y - p.y) * share;
    blocked := true;
  end if;
  -- cellar: a body in a cellar, or going into or out of one, is held to its floor and its way down.
  if (p_level < 0 or p.level < 0) and not cellar_move_ok(p_world, me, p.level, p_level, p.x, p.y, p_x, p_y) then
    p_x := p.x; p_y := p.y; p_level := p.level; blocked := true;
  end if;

  update player set x = p_x, y = p_y, level = p_level, moved_at = now(), seen_at = now(), away = false
    where world_id = p_world and uid = me;
  perform drag_along(p_world, me, p_x, p_y);
  /*
   * And what the walk taught the feet that took it.
   *
   * Reported as climbing going up and then back to one. The browser raised it
   * off every step between tiles and the island never did, so there was no
   * `climbing` row to go in the book the island sends every beat: the number
   * went up in the tab, was written over the next time the book came, and was
   * gone at the next refresh. Swimming went the same way before it.
   *
   * So the island pays it, off the walk it has just let stand: every step
   * between neighbouring tiles steeper than `climb_learn_from` of `max_step`
   * is a go of `climb_learn`, and `climb_learn_steep` more for each
   * `max_step` of height in it -- the browser's rule, read from the same
   * numbers. Your own feet on the ground and nothing else: a saddle's climb is
   * the beast's, a hull and a cart seat climb nothing, a floor is flat, and a
   * bridge deck is not the ground under it (`walk_climbs`).
   *
   * It is paid a go a step, as the browser pays it, and no faster than a walk
   * the pull-back above accepts can take steps.
   */
  cart := driving(p_world, me);
  beast := mount_of(p_world, me);
  if p_level = 0 and p.level = 0 and cart.id is null and beast.id is null then
    foreach c in array walk_climbs(p_world, p.x, p.y, p_x, p_y) loop
      if c > max_step() * climb_learn_from() then
        perform skill_raise(p_world, me, 'climbing', climb_learn() + c / max_step() * climb_learn_steep());
      end if;
    end loop;
    /*
     * And the wear those feet put on the ground: a point on every tile of
     * grass, lawn, steppe, tundra or moss stepped into, and a trail at
     * `wear_trail` (`wear_walk`). Nothing at all unless the walk left the
     * tile it started in, which is four calls in five: a straight line cannot
     * leave a tile and come back into it. And then one small row a tile.
     */
    if floor(p_x) <> floor(p.x) or floor(p_y) <> floor(p.y) then
      perform wear_walk(p_world, p.x, p.y, p_x, p_y);
    end if;
  end if;
  /*
   * And what the reins or the helm taught the hands on them: a go of Driving
   * or of Sailing (`driving_learn`, `sailing_learn`) for every tile the cart
   * or the hull went into, which is what the browser pays in a game of its own.
   * A straight walk goes into one tile for every line between tiles it
   * crosses. Only under way: a cart nothing pulls goes nowhere in the browser,
   * and teaches nothing here either.
   */
  if cart.id is not null and p_level = 0 and p.level = 0 then
    v_tiles := least(20, abs(floor(p_x) - floor(p.x)) + abs(floor(p_y) - floor(p.y)))::int;
    if v_tiles > 0 and (is_boat(cart) or vehicle_speed(p_world, cart.id) > 0) then
      for i in 1 .. v_tiles loop
        perform skill_raise(p_world, me, case when is_boat(cart) then sailing_skill() else driving_skill() end,
                            case when is_boat(cart) then sailing_learn() else driving_learn() end);
      end loop;
    end if;
  end if;
  /*
   * And the wildlife is *not* put out here any more.
   *
   * It was: walking into a block of country nobody had been through stocked
   * it, on this call, while the walker stood and waited. A block of land is
   * something like a second and a half of that, and it is paid on the one
   * call a walking browser makes constantly -- so the walk stopped, and
   * because PostgREST answers eight at a time, three people crossing fresh
   * country took three of those eight for the duration and *everything* the
   * island was asked went slow with them. That is the whole of what was
   * reported as the island severely delaying its answers.
   *
   * It lives on `stock_tick` now, which has a clock of its own and a lock of
   * its own, and which puts out the block a body is standing in *and the
   * eight around it* -- so the country is stocked before anybody walks into
   * it rather than because they did. Nobody waits for it. See `stock_tick`.
   */
  /*
   * And the body, on the one call a walking browser makes constantly.
   *
   * Reported as being killed by a goblin with the health bar never moving and
   * no wound ever showing, and then walking about dead until a refresh. Both
   * halves are this answer: `stats` and `wounds` rode `rpc_settle` and nothing
   * else, and `rpc_settle` is a minute apart unless one of your *own* asks
   * arms it. Something eating you arms nothing, so a fight that takes ten
   * seconds happens entirely inside one heartbeat: the island takes the health
   * off and opens the wounds and kills you, and the browser is drawing a body
   * from a minute ago — full, unmarked, and still walking.
   *
   * Which is the second half. `settle` at the top of this function is where a
   * bleeding body dies, and `player_die` puts it back at the spawn; the row
   * below is read after that, so the pull-back above is already measuring from
   * where the island has *just put you*. The answer said none of it, and the
   * browser threw away what it did say — `x` and `y` have been in here since
   * the day it was written and nothing has ever read them.
   *
   * So it says where you are, what is left of you, and what you are carrying.
   * A walk is half a second apart at worst, which is the difference between
   * watching yourself die and being told about it afterwards.
   */
  select * into p from player where world_id = p_world and uid = me;
  return jsonb_build_object('x', p_x, 'y', p_y, 'level', p_level,
    'pulled', pulled, 'blocked', blocked,
    'stats', p.stats, 'wounds', coalesce(p.wounds, '[]'::jsonb));
end $function$;

-- Sure Feet climbs steeper on foot, and Sure Fall steps down any drop.
CREATE OR REPLACE FUNCTION public.walk_share(p_world uuid, p_uid uuid, p_level integer, p_x0 double precision, p_y0 double precision, p_x1 double precision, p_y1 double precision)
 RETURNS double precision
 LANGUAGE plpgsql
AS $function$
declare far double precision; n int; i int; t double precision;
        cart placed; climbing double precision;
        fx int; fy int; tx int; ty int; climb double precision;
        size int; step int := chunk_size()::int;
        k land_chunk; kx int := -999; ky int := -999;
        here double precision; there double precision; spans boolean; walls int[];
        stand double precision; afloat boolean; beast creature;
        there_tile int; here_tile int; lx0 int[]; ly0 int[]; lx1 int[]; ly1 int[]; lines int := 0; j int;
        v_piers boolean; v_step boolean;  -- Piers
        v_drop double precision;
begin
  if p_level <> 0 then return 1; end if;
  far := sqrt(power(p_x1 - p_x0, 2) + power(p_y1 - p_y0, 2));
  if far <= 0.0001 then return 1; end if;
  -- Piers: and whether it has ever had a tile on piers (`world.piers`), off the same row.
  select w.size, w.piers into size, v_piers from world w where w.id = p_world;
  fx := floor(p_x0)::int; fy := floor(p_y0)::int;
  -- Asked once for the island rather than once a tile. `bridge_at` is two
  -- index probes and a subquery, and on an island with no bridges on it at all
  -- — which is most of them, most of the time — it was the largest thing left
  -- in this loop once the ground came out of a square.
  spans := exists (select 1 from bridge b where b.world_id = p_world);
  -- The one tile nothing stands on, asked for once. A select per tile against
  -- a table of twenty rows is still a select per tile.
  select coalesce(array_agg(id), '{}') into walls from tile_def where blocks;
  -- An aqueduct's deck is water, and nobody starts a walk on it: the ground under it is the ground (`deck_at`).
  if spans and deck_at(p_world, fx, fy) is not null then return 1; end if;
  -- And the lines its aqueducts run along, read once: a step is asked about their piers only where it is on one of them.
  if spans then
    select array_agg(least(b.ax, b.bx)), array_agg(least(b.ay, b.by)), array_agg(greatest(b.ax, b.bx)), array_agg(greatest(b.ay, b.by))
      into lx0, ly0, lx1, ly1 from bridge b where b.world_id = p_world and b.kind = 'aqueduct';
    lines := coalesce(array_length(lx0, 1), 0);
  end if;

  n := least(walk_samples()::int, greatest(1, ceil(far * 2)::int));
  -- Asked once. `driving`, `mount_of` and `skill_of` are all STABLE and this
  -- function writes nothing, so the second ask could only ever return what the
  -- first did -- at the price of another index probe apiece, on the one call a
  -- walking browser makes constantly.
  climbing := skill_of(p_world, p_uid, 'climbing');
  climb := max_step() + climbing * climb_per_level();
  /*
   * The steepest tile a body can stand on, before the step between tiles is
   * asked about at all: sixty between a tile's highest corner and its lowest,
   * and climbing raises it at the rate it raises the step. A rider has the
   * mount's legs under them, so the cap is the mount's, raised the way its
   * step is; wheels get the bare sixty; and a hull floats over whatever the
   * bottom does, so afloat there is no cap. A deck is ground: a bridge over a
   * steep tile is not the tile.
   */
  cart := driving(p_world, p_uid);
  afloat := coalesce(is_boat(cart), false);
  beast := mount_of(p_world, p_uid);
  if beast.id is not null then stand := max_stand() + mount_step(beast) - max_step();
  elsif cart.id is not null then stand := max_stand();
  else stand := max_stand() + climbing * climb_per_level();
  end if;
  -- On your own feet, Power's Sure Feet on the step up and Sure Fall's any drop (`climbStep`, `dropStep`).
  if beast.id is null and cart.id is null then
    climb := climb * path_fx(p_world, p_uid, 'climb', 1);
    v_drop := case when path_fx(p_world, p_uid, 'drop', 0) > 0 then 'Infinity'::double precision else climb end;
  else
    v_drop := climb;
  end if;
  for i in 1..n loop
    t := i::double precision / n;
    tx := floor(p_x0 + (p_x1 - p_x0) * t)::int;
    ty := floor(p_y0 + (p_y1 - p_y0) * t)::int;
    if tx <> fx or ty <> fy then
      if tx < 0 or ty < 0 or tx >= size or ty >= size then return (i - 1)::double precision / n; end if;
      -- An aqueduct's piers stand between its tiles, along its run (`aqueduct_pier`).
      for j in 1 .. lines loop
        if greatest(fx, tx) >= lx0[j] and least(fx, tx) <= lx1[j] and greatest(fy, ty) >= ly0[j] and least(fy, ty) <= ly1[j] then
          if aqueduct_pier(p_world, fx, fy, tx, ty) then return (i - 1)::double precision / n; end if;
        end if;
      end loop;
      if tx / step <> kx or ty / step <> ky then
        kx := tx / step; ky := ty / step;
        k := land_chunk_get(p_world, kx, ky);
      end if;
      -- A square built from an island with rows missing can be short; the
      -- scanlines are the truth, so fall back to them rather than reading off
      -- the end of a cache.
      if k.tiles is null or length(k.tiles) <= (ty - ky * step) * step + (tx - kx * step) then
        if not passable(p_world, tx, ty) then return (i - 1)::double precision / n; end if;
        there_tile := land_tile(p_world, tx, ty);
      else
        there_tile := get_byte(k.tiles, (ty - ky * step) * step + (tx - kx * step));
        if there_tile = any (walls) then return (i - 1)::double precision / n; end if;
      end if;
      -- A flight of garden steps is climbed, not driven: no wheel takes one.
      if cart.id is not null and not afloat and there_tile = steps_tile() then
        return (i - 1)::double precision / n;
      end if;
      -- And what the tile being left is, the first time it is asked: a flight
      -- carries you on or off it without the step between centres.
      if here_tile is null then
        here_tile := case when fx / step = kx and fy / step = ky and k.tiles is not null
                               and length(k.tiles) > (fy - ky * step) * step + (fx - kx * step)
                          then get_byte(k.tiles, (fy - ky * step) * step + (fx - kx * step))
                          else land_tile(p_world, fx, fy) end;
      end if;
      -- Piers: a tile on piers is its deck, walked at the deck's height; nothing goes under one (`pier_step`).
      -- A bridge is walked as it always was, and lands on a deck as on a bank. An aqueduct's is no deck (`deck_at`).
      if v_piers and (not spans or (deck_at(p_world, tx, ty) is null and deck_at(p_world, fx, fy) is null)) then
        v_step := pier_step(p_world, fx, fy, tx, ty, climb, stand, there_tile, afloat or cart.id is not null or beast.id is not null);
        if v_step is not null then
          if not v_step then return (i - 1)::double precision / n; end if;
          fx := tx; fy := ty; here_tile := there_tile;
          continue;
        end if;
      end if;
      if not afloat and (not spans or deck_at(p_world, tx, ty) is null) then
        if k.heights is not null and length(k.heights) >= (step + 1) * (step + 1) * 2 then
          if chunk_slope(k, kx, ky, tx, ty, step) > stand_cap(there_tile, stand) then return (i - 1)::double precision / n; end if;
        elsif tile_slope(p_world, tx, ty) > stand_cap(there_tile, stand) then
          return (i - 1)::double precision / n;
        end if;
      end if;
      if there_tile = steps_tile() or here_tile = steps_tile() then
        null;
      elsif abs(tx - fx) <= 1 and abs(ty - fy) <= 1
         and fx / step = kx and fy / step = ky
         and k.heights is not null and length(k.heights) >= (step + 1) * (step + 1) * 2
         and (not spans or deck_at(p_world, tx, ty) is null) then
        there := chunk_centre(k, kx, ky, tx, ty, step);
        here := chunk_centre(k, kx, ky, fx, fy, step);
        if there - here > climb or here - there > v_drop then return (i - 1)::double precision / n; end if;
      elsif abs(tx - fx) <= 1 and abs(ty - fy) <= 1
         and (not spans or deck_at(p_world, tx, ty) is null)
         and (centre_height(p_world, tx, ty) - centre_height(p_world, fx, fy) > climb
              or centre_height(p_world, fx, fy) - centre_height(p_world, tx, ty) > v_drop) then
        return (i - 1)::double precision / n;
      end if;
      fx := tx; fy := ty; here_tile := there_tile;
    end if;
  end loop;
  return 1;
end $function$;

-- A Season's Hand's clock by name.
CREATE OR REPLACE FUNCTION public.crop_clock_on(p_clock text, p_at timestamp with time zone)
 RETURNS double precision
 LANGUAGE plpgsql
 STABLE
AS $function$
begin
  if p_clock = 'glass' then return glasshouse_growth() * extract(epoch from p_at)::double precision; end if;
  if p_clock = 'hand' then return hand_clock(p_at); end if;
  return crop_clock(p_clock = 'planter', p_at);
end $function$;

-- And back.
CREATE OR REPLACE FUNCTION public.crop_moment_on(p_clock text, p_g double precision)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
AS $function$
begin
  if p_clock = 'glass' then return to_timestamp(p_g / glasshouse_growth()); end if;
  if p_clock = 'hand' then return to_timestamp(hand_moment(p_g)); end if;
  return crop_moment(p_clock = 'planter', p_g);
end $function$;

-- And when a stage on it comes, which never waits for spring (`cropWhen`).
CREATE OR REPLACE FUNCTION public.crop_when_on(p_next text, p_left double precision, p_clock text, p_at timestamp with time zone DEFAULT now())
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
begin
  if p_clock = 'glass' then return p_next || ' in ' || time_words(p_left / glasshouse_growth()); end if;
  if p_clock = 'hand' then
    return p_next || ' in ' || time_words(hand_moment(hand_clock(p_at) + p_left) - extract(epoch from p_at)::double precision);
  end if;
  return crop_when(p_next, p_left, p_clock = 'planter', p_at);
end $function$;

-- A field going under glass or out of it carries a Season's Hand's clock rather than a field's.
CREATE OR REPLACE FUNCTION public.glass_resync_tile(p_world uuid, p_x integer, p_y integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_glass boolean := glasshouse_at(p_world, p_x, p_y);
begin
  update crop c set glass = v_glass, stage_at = crop_rebased(c.stage_at, crop_kind(c.glass, c.hand), crop_kind(v_glass, c.hand))
   where c.world_id = p_world and c.x = p_x and c.y = p_y and c.glass <> v_glass;
end $function$;

-- Ditto, a building at a time.
CREATE OR REPLACE FUNCTION public.glass_resync(p_world uuid, p_building integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare v_glass boolean := glasshouse(p_world, p_building); n int;
begin
  update crop c set glass = v_glass, stage_at = crop_rebased(c.stage_at, crop_kind(c.glass, c.hand), crop_kind(v_glass, c.hand))
    from building_tile bt
   where bt.world_id = p_world and bt.building = p_building
     and c.world_id = p_world and c.x = bt.x and c.y = bt.y and c.glass <> v_glass;
  get diagnostics n = row_count;
  return n;
end $function$;

-- A sowing says when it sprouts on a Season's Hand's clock.
CREATE OR REPLACE FUNCTION public.perform_farm(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
-- `yld`, not `y`: the crop table has a column called y, and a plpgsql variable
-- of that name shadows it inside every query in the function — which Postgres
-- reports as "column reference y is ambiguous" from a line that does not
-- mention the variable at all.
declare d action_def; tx int; ty int; c crop; cd crop_def; it item; yld int[];
        s double precision; made_ql double precision; got int;
        v_how text; v_r int; v_n int; v_kept int; v_row record; r record; v_ix int;
        v_ids text[] := '{}'; v_counts int[] := '{}'; v_rares text[] := '{}'; v_rare text; v_packed boolean;
begin
  -- A planter is sown, tended, harvested and pulled up by the same four jobs, aimed at the piece.
  if p_target->>'kind' = 'furniture' then
    perform perform_planter(p_world, p_uid, p_action, p_target);
    return;
  end if;
  select * into d from action_def where id = p_action;
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  s := skill_of(p_world, p_uid, 'farming');
  perform crop_settle(p_world, tx, ty);
  select * into c from crop cr where cr.world_id = p_world and cr.x = tx and cr.y = ty;
  if c.id is not null then select * into cd from crop_def where id = c.id; end if;

  if p_action = 'till' then
    perform land_set_tile(p_world, tx, ty, tile_id('Field'));
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You rake the ground into a field, ready for sowing.', 'event');

  elsif p_action = 'plant_moss' then
    -- `moss_plant` moss pressed into bare dirt turns the tile to moss.
    if land_tile(p_world, tx, ty) <> tile_id('Dirt') or pack_count(p_world, p_uid, 'moss') < moss_plant() then return; end if;
    if not consume(p_world, p_uid, 'moss', moss_plant()) then return; end if;
    perform land_set_tile(p_world, tx, ty, tile_id('Moss'));
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You plant ' || moss_plant() || ' moss and the dirt is moss now.', 'event');

  elsif p_action = 'plant_grass' then
    -- `grass_plant` mixed grass pressed into bare dirt turns the tile to grass, uncut and unpicked.
    if land_tile(p_world, tx, ty) <> tile_id('Dirt') or pack_count(p_world, p_uid, 'mixed_grass') < grass_plant() then return; end if;
    if not consume(p_world, p_uid, 'mixed_grass', grass_plant()) then return; end if;
    perform land_set_tile(p_world, tx, ty, tile_id('Grass'));
    perform land_set_data(p_world, tx, ty, 0);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You plant ' || grass_plant() || ' mixed grass and the dirt is grass now.', 'event');

  elsif p_action = 'plant_seed' then
    select * into it from item where id = target_item(p_target);
    select * into cd from crop_def where seed = it.def;
    v_how := sow_one(p_world, p_uid, tx, ty, it.id);
    if v_how is null then return; end if;
    select * into c from crop cr where cr.world_id = p_world and cr.x = tx and cr.y = ty;
    -- When it will be sprouting, in real time, from the season it was sown in -- or in any, under glass: the browser's words.
    perform tell(p_world, p_uid, sown_said_on(cd.name, crop_kind(c.glass, c.hand),
        crop_when_on(crop_stage_name(1), crop_per(p_world, c.id, c.pace, tx, ty), crop_kind(c.glass, c.hand)))
      || case when v_how = 'kept' then ' It cost you no seed.' else '' end, 'event');

  elsif p_action = 'tend_crop' then
    perform tend_one(p_world, p_uid, tx, ty, s);
    select * into c from crop cr where cr.world_id = p_world and cr.x = tx and cr.y = ty;
    yld := crop_yield(c.tended);
    -- What it should give the one tending it, with their own Bumper Crop.
    if c.tended >= crop_ripe() then
      yld[2] := yld[2] + floor(pk(p_world, p_uid, 'bumper:harvest_crop', 0))::int;
    end if;
    perform tell(p_world, p_uid, 'You weed and water the ' || lower(cd.name) || '. It should give '
      || yld[2] || ' ' || lower((select coalesce(name, cd.produce) from item_def where id = cd.produce))
      || ' and ' || yld[1] || ' seed' || case when yld[1] > 1 then 's' else '' end || '.', 'event');
    perform skill_raise(p_world, p_uid, 'farming', 1);

  elsif p_action = 'harvest_crop' then
    select * into r from reap_one(p_world, p_uid, tx, ty, s);
    if r.o_produce is null then return; end if;
    perform tell(p_world, p_uid, 'You harvest ' || r.o_got || ' × ' || coalesce(r.o_rare || ' ', '')
      || lower((select coalesce(name, r.o_produce) from item_def where id = r.o_produce))
      || ' and ' || r.o_seeds || ' ' || lower((select coalesce(name, r.o_seed) from item_def where id = r.o_seed))
      || '. The field is ready to sow again. (QL ' || to_char(r.o_ql, 'FM990.0') || ')', 'event');
    if r.o_rare is not null then
      perform journal_note(p_world, p_uid, r.o_rare);
      perform tell(p_world, p_uid, rarity_word(r.o_rare), 'skill');
    end if;
    perform skill_raise(p_world, p_uid, 'farming', 1);

  elsif p_action = 'clear_field' then
    delete from crop cr where cr.world_id = p_world and cr.x = tx and cr.y = ty;
    -- Broken up, it is not a field any more, and has no last crop.
    delete from crop_last l where l.world_id = p_world and l.x = tx and l.y = ty;
    -- Inside a footprint, packed flat again as the rest of it is (the browser's `clearedTo`, `clearedSaid`).
    v_packed := building_at(p_world, tx, ty) is not null;
    perform land_set_tile(p_world, tx, ty, tile_id(case when v_packed then 'Packed dirt' else 'Dirt' end));
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, case when c.id is not null
      then 'You turn the ' || lower(cd.name) || ' back into the soil' || case when v_packed then ' and pack the ground flat again' else '' end || '.'
      when v_packed then field_packed_said()
      else 'You break the field back up into plain dirt.' end, 'event');

  elsif p_action = 'sow_patch' then
    -- A Farmer's Sow a Patch: the seed chosen, one to a field, on every empty
    -- field within `sow_patch` tiles of the one chosen, row by row.
    select * into it from item where id = target_item(p_target);
    select * into cd from crop_def where seed = it.def;
    v_r := floor(pk(p_world, p_uid, 'sow_patch', 0))::int;
    v_n := 0;
    v_kept := 0;
    for v_row in select gx, gy from generate_series(ty - v_r, ty + v_r) gy, generate_series(tx - v_r, tx + v_r) gx
                  order by gy, gx loop
      continue when not in_bounds(p_world, v_row.gx, v_row.gy);
      continue when land_tile(p_world, v_row.gx, v_row.gy) is distinct from tile_id('Field');
      continue when exists (select 1 from crop cr where cr.world_id = p_world and cr.x = v_row.gx and cr.y = v_row.gy);
      v_how := sow_one(p_world, p_uid, v_row.gx, v_row.gy, it.id);
      exit when v_how is null;
      v_n := v_n + 1;
      if v_how = 'kept' then v_kept := v_kept + 1; end if;
    end loop;
    if v_n = 0 then return; end if;
    perform tell(p_world, p_uid, 'You sow ' || v_n || case when v_n = 1 then ' field' else ' fields' end
      || ' with ' || lower(cd.name) || '.'
      || case when v_kept = 0 then ''
              when v_kept = v_n then case when v_n = 1 then ' It' else ' They' end || ' cost you no seed.'
              else ' ' || v_kept || ' of them cost you no seed.' end, 'event');

  elsif p_action = 'tend_patch' then
    -- A Farmer's Tend a Patch: every crop within `tend_patch` tiles that is not
    -- ripe and not tended at the stage it is at.
    v_r := floor(pk(p_world, p_uid, 'tend_patch', 0))::int;
    perform crops_settle(p_world, tx + 0.5, ty + 0.5, v_r);
    v_n := 0;
    for v_row in select cr.x, cr.y from crop cr
                  where cr.world_id = p_world and cr.x between tx - v_r and tx + v_r and cr.y between ty - v_r and ty + v_r
                    and cr.stage < crop_ripe() and not cr.tended_now
                  order by cr.y, cr.x loop
      perform tend_one(p_world, p_uid, v_row.x, v_row.y, s);
      v_n := v_n + 1;
    end loop;
    if v_n = 0 then return; end if;
    perform tell(p_world, p_uid, 'You weed and water ' || v_n || case when v_n = 1 then ' crop.' else ' crops.' end, 'event');
    perform skill_raise(p_world, p_uid, 'farming', 1);

  elsif p_action = 'harvest_patch' then
    -- A Farmer's Harvest a Patch: every ripe crop within `harvest_patch` tiles,
    -- each for what its own tending earned, and what came up said by the thing.
    v_r := floor(pk(p_world, p_uid, 'harvest_patch', 0))::int;
    perform crops_settle(p_world, tx + 0.5, ty + 0.5, v_r);
    v_n := 0;
    for v_row in select cr.x, cr.y from crop cr
                  where cr.world_id = p_world and cr.x between tx - v_r and tx + v_r and cr.y between ty - v_r and ty + v_r
                    and cr.stage >= crop_ripe()
                  order by cr.y, cr.x loop
      select * into r from reap_one(p_world, p_uid, v_row.x, v_row.y, s);
      continue when r.o_produce is null;
      v_n := v_n + 1;
      v_ix := array_position(v_ids, r.o_produce);
      if v_ix is null then v_ids := v_ids || r.o_produce; v_counts := v_counts || r.o_got;
      else v_counts[v_ix] := v_counts[v_ix] + r.o_got; end if;
      v_ix := array_position(v_ids, r.o_seed);
      if v_ix is null then v_ids := v_ids || r.o_seed; v_counts := v_counts || r.o_seeds;
      else v_counts[v_ix] := v_counts[v_ix] + r.o_seeds; end if;
      if r.o_rare is not null then v_rares := v_rares || r.o_rare; end if;
    end loop;
    if v_n = 0 then return; end if;
    perform tell(p_world, p_uid, 'You harvest ' || v_n || case when v_n = 1 then ' field: ' else ' fields: ' end
      || (select string_agg(t.n || ' × ' || lower(coalesce(dd.name, t.id)), ', ' order by t.o)
            from unnest(v_ids, v_counts) with ordinality t(id, n, o) left join item_def dd on dd.id = t.id)
      || case when v_n = 1 then '. The field is' else '. The fields are' end || ' ready to sow again.', 'event');
    foreach v_rare in array v_rares loop
      perform journal_note(p_world, p_uid, v_rare);
      perform tell(p_world, p_uid, rarity_word(v_rare), 'skill');
    end loop;
    perform skill_raise(p_world, p_uid, 'farming', 1);
  end if;

end $function$;

-- The ground read says a Season's Hand's field, with how far it has grown on its clock.
CREATE OR REPLACE FUNCTION public.rpc_ground(p_world uuid, p_range double precision DEFAULT 40, p_slow boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player; v_field double precision; v_box double precision; v_hand double precision;
        -- When greening came to this island (`greening.ts`).
        v_from timestamptz := (select w.green_from from world w where w.id = p_world);
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  /*
   * On the slow half only, because this writes.
   *
   * The fast read runs about once a second per body — everything burning, what
   * is on the tile under you — and a settle on that path is an update a second
   * per player whether or not anything is due. The crops ride the slow half
   * beside the settlements, and any of your own work forces one of those, so
   * sowing is seen at once and a stage is at worst one reconcile late.
   */
  if p_slow then
    perform crops_settle(p_world, p.x, p.y, p_range);
    perform planters_settle(p_world, p.x, p.y, p_range);
    -- Each clock read once, for every crop on it.
    v_field := crop_clock(false, now());
    v_box := crop_clock(true, now());
    v_hand := hand_clock(now());
  end if;
  return jsonb_build_object(
    'placed', coalesce((select jsonb_agg(
        (to_jsonb(pl) - 'world_id' - 'made_by' - 'since' - 'made_at' - 'cx' - 'cy' - 'crumbles_at')
        || jsonb_build_object('fuel', placed_fuel(pl), 'ash', placed_ash(pl),
                              'lit', placed_lit(pl), 'mine', coalesce(pl.made_by = me, false),
        /*
         * And what is in it, which this never said.
         *
         * Reported as "i opened it and dragged my dirt into it and the dirt
         * vanished". It had not: the island had the dirt in the bin and told
         * nobody. Every chest, bin, larder and cart on an island read as
         * empty over there, so anything put away went out of the pack and was
         * never seen again — the same hole a crate fell down before crates
         * carried their contents, and closed the same way. Within six tiles
         * only: you must be within two and a half to reach into one, so six
         * is generous, and a yard of full chests is not worth a phone's
         * second.
         */
                              'things', case when pl.kind = 'furniture'
                                              and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= 6
                                              -- A grave's, to whoever lies under it and nobody else.
                                              and (pl.crumbles_at is null or pl.made_by = me)
                                then coalesce((select jsonb_agg(jsonb_build_object(
                                       'id', i.id, 'def', i.def, 'ql', i.ql, 'dmg', i.dmg,
                                       'count', i.count, 'extra', i.extra) order by i.id)
                                     from item i
                                     where i.world_id = p_world and i.holder = 'furniture' and i.placed = pl.id),
                                   '[]'::jsonb)
                                else '[]'::jsonb end)
        /*
         * Whether a helm is as good as empty, its holder gone away, and who is
         * aboard as a passenger and in which place: only for a piece that has
         * either, so nothing else carries two more keys it does not need.
         */
        || case when pl.driver is null then '{}'::jsonb
                else jsonb_build_object('helm_open', coalesce((select r.away from player r
                       where r.world_id = p_world and r.uid = pl.driver), true)) end
        || coalesce((select jsonb_build_object('riders', jsonb_agg(jsonb_build_object('uid', r.uid, 'seat', r.seat)
                       order by r.seat))
                     from player r where r.world_id = p_world and r.aboard = pl.id
                     having count(*) > 0), '{}'::jsonb)
        /*
         * And a grave: whose it is, for what anybody else is told when they
         * try it; the seconds it has left, which a browser counts down on its
         * own clock rather than reading this island's; and, to its owner, how
         * many things are in it, which `things` only says from within reach --
         * the way `units` rides beside a crate's contents.
         */
        || case when pl.crumbles_at is null then '{}'::jsonb
                else jsonb_build_object('grave', jsonb_build_object('name', grave_owner(pl),
                       'left', greatest(0, extract(epoch from (pl.crumbles_at - now()))),
                       'units', case when pl.made_by = me then (select coalesce(sum(i.count), 0) from item i
                                  where i.placed = pl.id and i.holder = 'furniture') end)) end
        /*
         * And for a piece with roses on it, the moment it was set down, which
         * is what its roses grow from (`roses.ts`): the same moment for
         * everybody, and sent for nothing else.
         */
        || case when coalesce((select fd.roses from furniture_def fd where fd.id = pl.sub), false)
                then jsonb_build_object('set', extract(epoch from pl.made_at)) else '{}'::jsonb end
        /*
         * And for a piece that gathers moss -- a statue -- the seconds since
         * the moss on it began: since it was set down or last scrubbed, and
         * never from before greening came in (`greening.ts`). Only for those,
         * so nothing else carries a key it does not need.
         */
        || case when pl.kind = 'furniture' and pl.sub in (select fd.id from furniture_def fd where fd.mossy)
                then jsonb_build_object('green_ago', green_ago(greatest(pl.made_at,
                       (select gs.since from green_since gs where gs.world_id = p_world and gs.thing = 'piece'
                           and gs.x = pl.x and gs.y = pl.y and gs.k = pl.id)), v_from))
                else '{}'::jsonb end
        -- And for a shop counter's store, what is set out on it and for whom (`counters.ts`).
        || case when pl.kind = 'counter' then counter_json(pl, me, p.x, p.y) else '{}'::jsonb end
        order by pl.id)
      from placed pl
      where pl.world_id = p_world
        -- The box first, in the whole tiles `placed_near` is keyed on, and then
        -- the exact question. A btree cannot look up a function of a column, so
        -- the exact test on its own read every placed thing on the island, on
        -- every ground poll, for every player. `x` is `floor(cx)` and `y` is
        -- `floor(cy)` -- `drag_along` and every placing write both together --
        -- so a tile of slack each way makes the box a superset of the answer
        -- and the line below still decides who is in it.
        and pl.x between floor(p.x - p_range)::int - 1 and floor(p.x + p_range)::int + 1
        and pl.y between floor(p.y - p_range)::int - 1 and floor(p.y + p_range)::int + 1
        and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= p_range), '[]'::jsonb),
    'crates', crates_near(p_world, me, p_range),
    /*
     * And what is lying on the ground, which this never carried.
     *
     * Reported as "killed a roxxa, no corpse dropped to butcher, or at least
     * isn't displaying". The corpse was there: `wound_beast` drops one where
     * the thing fell, and the suite has measured it since kills were ported.
     * This sent the fires, the crates, the crops and the walls, and never a
     * thing lying on the grass — and the browser's map of the ground was only
     * ever written by its own rules, which do not run on an island. So a
     * corpse, a log a worker put down, a hatchet somebody else dropped: all
     * in this table and drawn by nobody.
     *
     * On the fast half, because a corpse is looked for the second the thing
     * goes down; `item_on_ground` serves the box. The whole row, the way the
     * pack is sent, so the browser reads it with the same map.
     */
    'lying', coalesce((select jsonb_agg(to_jsonb(i) - 'world_id' order by i.id)
      from item i
      where i.world_id = p_world and i.holder = 'ground'
        and i.gx between floor(p.x - p_range)::int and floor(p.x + p_range)::int
        and i.gy between floor(p.y - p_range)::int and floor(p.y + p_range)::int), '[]'::jsonb),
    -- cellar: and what is lying on the floors of the cellars in range, the same way (`item_in_cellar` serves the box).
    'cellarLying', coalesce((select jsonb_agg(to_jsonb(i) - 'world_id' order by i.id) from item i -- cellar
      where i.world_id = p_world and i.holder = 'cellar' -- cellar
        and i.gx between floor(p.x - p_range)::int and floor(p.x + p_range)::int -- cellar
        and i.gy between floor(p.y - p_range)::int and floor(p.y + p_range)::int), '[]'::jsonb))
  /*
   * And the half that hardly ever moves.
   *
   * A fire burns down and a kiln works through its load while you stand and
   * watch it, which is why this is asked for every second. A wall is not like
   * that: it goes up when somebody builds it and then it is a wall. Sending
   * both at one pace meant a correlated subquery over `building_tile` per
   * building, a scan of `wall` and one of `floor_tile`, every second for every
   * player, to say that the house is still a house.
   *
   * So the caller says whether it wants them. A browser asks for the lot on
   * its twenty-second reconcile and after any of its own work, and for the
   * burning half the rest of the time. Left out rather than emptied: the
   * browser applies only the keys it is given, so what it holds stands.
   *
   * `p_slow` defaults true, so a page that has not been redeployed gets
   * exactly what it always got.
   */
  || case when not p_slow then '{}'::jsonb else jsonb_build_object(
    /*
     * And everybody ashore, on the slow half, which is the beat that already
     * carries the settlements. The map draws them; `folk_ashore` decides
     * whether there is anything to draw them at.
     */
    'folk', folk_ashore(p_world, me),
    /*
     * And every grave of yours, however far off: you wake a long way from
     * where you fell, and `placed` above is only what is in range. The map
     * marks them and takes the mark up when one goes. Off the index the
     * sweep uses, which holds nothing but graves.
     */
    'graves', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'x', g.x, 'y', g.y) order by g.id)
      from placed g
      where g.world_id = p_world and g.crumbles_at is not null and g.made_by = me), '[]'::jsonb),
    /*
     * What is growing here, settled first so the stage reported is the stage
     * it is actually at rather than the stage it was at when somebody last
     * touched it. Everything on this island settles lazily off a timestamp,
     * and for a crop nobody had ever been the one to ask.
     *
     * `grown` rather than `stage_at`: how far into its stage it has grown, in
     * growing seconds on the clock it grows on, which the browser lays on its
     * own reading of the same clock -- a winter between the stage's start and
     * now adds nothing to it. `ago`, the wall seconds, is what a page from
     * before the year reads.
     */
    'crops', coalesce((select jsonb_agg(jsonb_build_object(
        'x', c.x, 'y', c.y, 'id', c.id, 'stage', c.stage,
        'grown', case when c.hand and not c.glass then v_hand - hand_clock(c.stage_at) else crop_grown(c.glass, c.stage_at, v_field) end,
        'ago', extract(epoch from (now() - c.stage_at)),
        'tended', c.tended, 'tendedNow', c.tended_now, 'ql', c.ql, 'pace', c.pace)
        -- And a crop under glass says so, and `grown` is on the glass clock (`glasshouse.ts`).
        || case when c.glass then '{"glass": true}'::jsonb else '{}'::jsonb end
        -- And one sown with Love's Season's Hand, on its clock (`hand_clock`).
        || case when c.hand then '{"hand": true}'::jsonb else '{}'::jsonb end)
      from crop c
      where c.world_id = p_world
        and greatest(abs(c.x + 0.5 - p.x), abs(c.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    -- And what grows in the planters, by the piece, on the planter's own clock.
    'planted', coalesce((select jsonb_agg(jsonb_build_object(
        'planter', c.placed, 'x', pl.x, 'y', pl.y, 'id', c.id, 'stage', c.stage,
        'grown', v_box - crop_clock(true, c.stage_at),
        'ago', extract(epoch from (now() - c.stage_at)),
        'tended', c.tended, 'tendedNow', c.tended_now, 'ql', c.ql, 'pace', c.pace) order by c.placed)
      from placed pl join planter_crop c on c.placed = pl.id
      where pl.world_id = p_world
        and pl.x between floor(p.x - p_range)::int - 1 and floor(p.x + p_range)::int + 1
        and pl.y between floor(p.y - p_range)::int - 1 and floor(p.y + p_range)::int + 1
        and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= p_range), '[]'::jsonb),
    -- And the island's wall clock, which a field's clock is read off, so the browser reads it off the same one.
    'now', extract(epoch from now())::double precision,
    /*
     * The felling notches near you, and how long ago the woods last turned
     * over. Look reads both: "2 of 3 strokes in it", "the woods turn over in
     * 9 hours". A browser on an island keeps no clock of its own for the
     * woods, so this is the only place it hears the hour.
     */
    /*
     * The water lilies and lotus planted near you: when each was planted and
     * last picked, which is all of one. The browser works out the rest from
     * the year, as `water_plant_state` does.
     */
    'waterPlants', water_plants_near(p_world, p.x, p.y, p_range),
    'notches', coalesce((select jsonb_agg(jsonb_build_object('x', n.x, 'y', n.y, 'cuts', n.cuts))
      from tree_notch n
      where n.world_id = p_world
        and greatest(abs(n.x + 0.5 - p.x), abs(n.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    'treesAgo', (select extract(epoch from (now() - w.trees_at)) from world w where w.id = p_world),
    -- The mark the ground is being worked to, which lives on the player row
    -- so that it is the same mark in every browser you open.
    'level', p.level_h,
    -- What you are on each of them, so the browser can say what you may do
    -- rather than finding out by being refused. Your own first one is your
    -- own or one you were asked onto; either way `deed_role` says which.
    'deed', (select jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level, 'mine', true,
        'role', deed_role(p_world, d.founded_by, me),
        'baubles', deed_baubles_json(p_world, d.founded_by))
      from my_deed(p_world, me) d where d.world_id is not null),
    'deeds', coalesce((select jsonb_agg(jsonb_build_object(
        'name', d.name, 'x', d.x, 'y', d.y, 'radius', d.radius, 'level', d.level,
        -- Land you were asked onto is land you may work, so it is drawn as
        -- yours rather than as a stranger's border you happen to be inside.
        'mine', exists (select 1 from deed_member m where m.world_id = p_world
                          and m.uid = me and m.founder = d.founded_by),
        'role', deed_role(p_world, d.founded_by, me),
        'holder', account_name(d.founded_by),
        -- And what is in its altar, for the settlements you are a citizen of.
        'baubles', case when exists (select 1 from deed_member m where m.world_id = p_world
                                       and m.uid = me and m.founder = d.founded_by)
                        then deed_baubles_json(p_world, d.founded_by) end) order by d.founded_at)
      from deed d
      where d.world_id = p_world and d.founded_by <> me
        and greatest(abs(d.x + 0.5 - p.x), abs(d.y + 0.5 - p.y)) <= p_range + d.radius),
      '[]'::jsonb),
    /*
     * And what is standing.
     *
     * `building`, `wall` and `floor_tile` have been kept here since buildings
     * were ported and have never been sent to anybody. The rules answered
     * about them, a plan went up in Postgres, and no browser ever drew a wall
     * of it — so on an island a building was invisible to everyone, the person
     * who planned it included.
     *
     * Shaped as the browser's own `BuildingsJSON`, so it is laid straight in.
     * A building comes along whole if any of its tiles is in range: half a
     * house is worse than none, and a house is a handful of rows.
     */
    'buildings', jsonb_build_object(
      -- cellar: what is dug out under the buildings sent (`BuildingsJSON.cellars`).
      'cellars', cellars_near(p_world, p.x, p.y, p_range),
      'nextId', coalesce((select max(b.id) + 1 from building b where b.world_id = p_world), 1),
      'list', coalesce((select jsonb_agg(jsonb_build_object(
          'id', b.id, 'name', b.name, 'levels', b.levels, 'workLevel', b.work_level,
          -- Frame: the shape of its roof, which says whether it is a terrace to rail.
          'roof', b.roof,
          'tiles', (select coalesce(jsonb_agg(bt.x || ',' || bt.y order by bt.y, bt.x), '[]'::jsonb)
                      from building_tile bt
                     where bt.world_id = p_world and bt.building = b.id))
          -- Piers: and its deck and its tiles on piers, if it has any (`piers_json`).
          || piers_json(p_world, b.id, b.deck) order by b.id)
        from building b
        where b.world_id = p_world
          and exists (select 1 from building_tile bt
                       where bt.world_id = p_world and bt.building = b.id
                         and greatest(abs(bt.x + 0.5 - p.x), abs(bt.y + 0.5 - p.y)) <= p_range)),
        '[]'::jsonb),
      'walls', coalesce((select jsonb_agg(jsonb_build_object(
          'building', w.building, 'level', w.level, 'x', w.x, 'y', w.y, 'dir', w.dir,
          -- gates: a hidden door its padlock does not admit is sent as the solid wall it looks like.
          'type', wall_seen_type(p_world, me, w), 'material', w.material, 'needed', w.needed, 'total', w.total,
          -- And the seconds since the ivy on a finished wall of stone or brick began (`greening.ts`).
          'greenAgo', case when bill_done(w.needed) and m.kind = 'stone' then green_ago(gs.since, v_from) end)
          -- gates: a portcullis let down, and a padlock this body may know of.
          || wall_gear(p_world, me, w)
          order by w.level, w.dir, w.x, w.y)
        from wall w
        left join build_material_def m on m.id = w.material
        left join green_since gs on gs.world_id = p_world and gs.thing = 'wall' and gs.x = w.x and gs.y = w.y
                                and gs.k = green_wall_k(w.level, w.dir)
        where w.world_id = p_world
          and greatest(abs(w.x + 0.5 - p.x), abs(w.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
      'floors', coalesce((select jsonb_agg(jsonb_build_object(
          'building', f.building, 'level', f.level, 'x', f.x, 'y', f.y,
          'material', f.material, 'kind', f.kind, 'facing', f.facing, 'hand', f.hand,
          'needed', f.needed, 'total', f.total) order by f.level, f.x, f.y)
        from floor_tile f
        where f.world_id = p_world
          and greatest(abs(f.x + 0.5 - p.x), abs(f.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
      -- Frame: the columns on the corners of its storeys.
      'columns', frame_columns_json(p_world, p.x, p.y, p_range)),
    /*
     * And the slabs, which are not buildings and do not go in with them: a
     * foundation is ground somebody poured, and the browser lays it beside the
     * terrain rather than inside a house.
     */
    'foundations', coalesce((select jsonb_agg(jsonb_build_object(
        'id', fo.id, 'x', fo.x, 'y', fo.y, 'top', fo.top, 'pool', fo.pool,
        'needed', fo.needed, 'total', fo.total,
        -- And the seconds since the moss on a poured one began.
        'greenAgo', case when bill_done(fo.needed) then green_ago(gs.since, v_from) end) order by fo.id)
      from foundation fo
      left join green_since gs on gs.world_id = p_world and gs.thing = 'slab' and gs.x = fo.x and gs.y = fo.y and gs.k = 0
      where fo.world_id = p_world
        and greatest(abs(fo.x + 0.5 - p.x), abs(fo.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
    'nextFoundationId', coalesce((select max(fo.id) + 1 from foundation fo where fo.world_id = p_world), 1),
    /*
     * And the bridges, shaped as the browser's own `Bridge`, spans and all.
     *
     * The island has kept `bridge` and `bridge_span` since bridges were ported
     * and never said a word about one, so on an island a bridge was drawn by
     * nobody and walked by nobody: the browser decides where its feet go, and
     * it had never heard of the deck. One comes whole if either end is in
     * range, and a stone arch with the seconds since the moss on it began.
     */
    'bridges', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'kind', b.kind, 'ax', b.ax, 'ay', b.ay, 'bx', b.bx, 'by', b.by,
        'height', b.height, 'level', b.level, 'material', b.material,
        'spans', (select coalesce(jsonb_agg(jsonb_build_object('x', s.x, 'y', s.y, 'needed', s.needed, 'total', s.total)
                    order by s.n), '[]'::jsonb)
                  from bridge_span s where s.world_id = p_world and s.bridge = b.id),
        'greenAgo', case when b.kind in ('stone', 'aqueduct') and not exists (select 1 from bridge_span s
                           where s.world_id = p_world and s.bridge = b.id and not span_done(s.needed))
                         then green_ago(gs.since, v_from) end)
        -- gates: a drawbridge drawn up, and the padlock on its winch.
        || bridge_gear(b) order by b.id)
      from bridge b
      left join green_since gs on gs.world_id = p_world and gs.thing = 'bridge' and gs.x = b.ax and gs.y = b.ay and gs.k = b.id
      where b.world_id = p_world
        and (greatest(abs(b.ax + 0.5 - p.x), abs(b.ay + 0.5 - p.y)) <= p_range
             or greatest(abs(b.bx + 0.5 - p.x), abs(b.by + 0.5 - p.y)) <= p_range)), '[]'::jsonb),
    /*
     * And the paving: the seconds since greening came in, which is when every
     * paved tile without a row of its own began, and the tiles in range paved
     * or scrubbed since, off the key's own box.
     */
    'greenFromAgo', extract(epoch from (now() - v_from))::double precision,
    'paving', coalesce((select jsonb_agg(jsonb_build_object('x', gs.x, 'y', gs.y, 'ago', green_ago(gs.since, v_from)))
      from green_since gs
      where gs.world_id = p_world and gs.thing = 'paving'
        and gs.x between floor(p.x - p_range)::int and floor(p.x + p_range)::int
        and gs.y between floor(p.y - p_range)::int and floor(p.y + p_range)::int), '[]'::jsonb)) end;
end $function$;

-- A sitting grows the trees round it for Love's Bloom.
CREATE OR REPLACE FUNCTION public.perform_faith(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p player; pc placed; faith double precision; hour double precision;
        gained double precision; cap double precision; got double precision;
        was double precision; med double precision; sit record; v_step path_step;
        v_way text; r record; v_bloom int;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'pray' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    faith := skill_of(p_world, p_uid, faith_skill());
    hour := hour_of_day(p_world);
    cap := favour_cap(faith);
    -- What a prayer banks is Prayer's to say; what you can hold is faith's (`favour_cap`).
    got := least(cap, favour_settle(p_world, p_uid) + prayer_worth(pc.ql, hour, skill_of(p_world, p_uid, praying_skill())));
    update player set favour = got, favour_at = now(), prayed_at = now()
      where world_id = p_world and uid = p_uid;
    perform journal_note(p_world, p_uid, 'prayed');
    perform skill_raise(p_world, p_uid, faith_skill(), prayer_gain());
    perform tell(p_world, p_uid,
      case when abs(hour - 6) < 2 or abs(hour - 20) < 2
           then 'You kneel in the half light and it goes better than it usually does.'
           else 'You kneel at the stone.' end
      || ' Favour ' || floor(got) || ' of ' || floor(cap) || '.', 'event');
    -- And Prayer, the skill it is said with, as every job teaches its own (`completeAction`).
    perform skill_raise(p_world, p_uid, praying_skill(), try_gain(true));

  elsif p_action = 'cast' then
    if cast_reason(p_world, p_uid, p_target->>'spell', target_item(p_target)) is not null then
      return;
    end if;
    perform journal_note(p_world, p_uid, 'cast:' || (p_target->>'spell'));
    perform tell(p_world, p_uid,
      do_cast(p_world, p_uid, p_target->>'spell', target_item(p_target)), 'event');

  elsif p_action = 'meditate' then
    -- Struck in the middle of it: said at the blow (`sitting_struck`), and nothing comes of it.
    if p.struck_at is not null and p.act_started is not null and p.struck_at >= p.act_started then return; end if;
    select * into sit from sitting_worth(p_world, p_uid);
    was := skill_of(p_world, p_uid, meditation_skill());
    -- And where it was sat, for the next sitting near it until the woods turn (`satHere`).
    update player set sat_at = now(),
           sat_spots = sat_spots_now(p) || jsonb_build_array(jsonb_build_array(floor(p.x)::int, floor(p.y)::int)),
           sat_dawn = tree_last_dawn()
      where world_id = p_world and uid = p_uid;
    perform journal_note(p_world, p_uid, 'sat');
    perform skill_raise(p_world, p_uid, meditation_skill(), sit.gain);
    med := skill_of(p_world, p_uid, meditation_skill());
    -- The Calm it banks, up to what this much meditation holds.
    cap := player_calm_cap(p_world, p_uid);
    update player set calm = least(cap, coalesce(calm, 0) + sit.calm)
      where world_id = p_world and uid = p_uid returning calm into got;
    perform tell(p_world, p_uid, sit.said || ' Calm ' || floor(got) || ' of ' || floor(cap) || '.', 'event');
    -- And the trees round you, once a day of the island's clock, for Love's Bloom (`bloomSitting`).
    v_bloom := path_bloom(p_world, p_uid);
    if v_bloom > 0 then
      perform tell(p_world, p_uid, 'The trees round you grow while you sit: ' || v_bloom || ' of them, a stage each.', 'event');
    end if;
    if p.way is null and med >= choose_at() and was < choose_at() then
      perform tell(p_world, p_uid, 'Something settles. Three ways of looking at all this have '
        || 'become clear, and you may walk exactly one of them. Choose from the rug.', 'system');
    end if;
    if p.way is not null and path_moved(p.way) then
      -- A moved path's tiers, as they open (`tierSaid`).
      for r in select t.tier, d.name as path_name from path_tier t, path_def d
        where d.id = p.way and was < t.at and med >= t.at order by t.tier
      loop
        perform journal_note(p_world, p_uid, 'path');
        perform tell(p_world, p_uid, r.path_name || ': tier ' || r.tier || ' is open. Take one of '
          || listed_or((select array_agg(k.name order by k.num) from path_pick k where k.path = p.way and k.tier = r.tier))
          || ' in the Faith window.', 'system');
      end loop;
    elsif p.way is not null then
      for r in select s.*, d.name as path_name from path_step s join path_def d on d.id = s.path
        where s.path = p.way and was < s.at and med >= s.at order by s.n
      loop
        perform tell(p_world, p_uid, r.path_name || ': ' || r.name || '. ' || r.note, 'system');
      end loop;
    end if;

  elsif p_action = 'choose_path' then
    v_way := p_target->>'material';
    if p.way is not null or not exists (select 1 from path_def where id = v_way) then return; end if;
    update player set way = v_way where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You take the path of '
      || (select name from path_def where id = v_way) || '. '
      || (select note from path_def where id = v_way), 'system');

  elsif p_action = 'use_ability' then
    v_step := ability_of(p_world, p_uid, p_target->>'material');
    if v_step.path is null then return; end if;
    update player set used_at = jsonb_set(used_at, array[v_step.ability], to_jsonb(now()))
      where world_id = p_world and uid = p_uid;
    perform skill_raise(p_world, p_uid, meditation_skill(), technique_gain());
    perform tell(p_world, p_uid, work_ability(p_world, p_uid, v_step.ability), 'event');
  end if;
end $function$;

-- The beat says what Love's and Power's techniques left running.
CREATE OR REPLACE FUNCTION public.path_beat(p_world uuid, p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p player;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return null; end if;
  return jsonb_build_object(
    'way', p.way,
    'picks', coalesce((select jsonb_agg(t.pick order by t.took, t.pick) from path_taken t
                        where t.world_id = p_world and t.uid = p_uid), '[]'::jsonb),
    'calm', coalesce(p.calm, 0),
    'foreknow', coalesce(p.foreknow, 0),
    'clarity', greatest(0, coalesce(extract(epoch from (p.clarity_until - now())), 0)),
    'sat', sat_spots_now(p),
    'studied', coalesce(p.studied, '{}'::jsonb),
    'seek', (select jsonb_build_object('x', m.x, 'y', m.y) from mote_swirl m
              where m.world_id = p_world and m.id = (p.path_marks->>'seek')::bigint),
    'trace', (select jsonb_build_object('x', t.x, 'y', t.y) from treasure t
               where t.world_id = p_world and t.item_id = (p.path_marks->>'trace')::bigint),
    -- Seconds left of a Heart of the Herd, a Deep Lungs, a Surge and an Unbroken, and before a Hard to Kill is ready again.
    'herd', path_left(p, 'path_herd'),
    'lungs', path_left(p, 'path_lungs'),
    'surge', path_left(p, 'path_surge'),
    'unbroken', path_left(p, 'path_unbroken'),
    'hardToKill', greatest(0, coalesce(extract(epoch from (p.kill_saved_at - now()))
      + coalesce((select (k.fx->>'every')::double precision from path_pick k where k.id = 'power_hard_to_kill'), 0), 0)));
end $function$;

-- A pick of `kept:` keys (Love's Kin) goes onto every beast you keep at once.
CREATE OR REPLACE FUNCTION public.rpc_take_path_pick(p_world uuid, p_pick text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); k path_pick; v_why text; v_slot int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  v_why := path_pick_refusal(p_world, me, p_pick);
  if v_why is not null then return jsonb_build_object('why', v_why); end if;
  select * into k from path_pick where id = p_pick;
  insert into path_taken (world_id, uid, pick) values (p_world, me, p_pick)
    on conflict (world_id, uid, pick) do nothing;
  -- What keeping a beast comes to under it, for a discipline that says (Love's Kin), as a perk's is (`class_fold`).
  if k.fx::text like '%kept:%' then
    update creature set kept = kept_of(p_world, me)
     where world_id = p_world and keeper = me and kept is distinct from kept_of(p_world, me);
  end if;
  if k.kind = 'technique' then
    select min(sl.slot) into v_slot from spell_slot sl, player p
     where p.world_id = p_world and p.uid = me and sl.school = 'path' and (p.spell_bar->>sl.slot) is null;
    if v_slot is not null then perform spell_bar_put(p_world, me, v_slot, p_pick); end if;
  end if;
  perform journal_note(p_world, me, 'path');
  perform tell(p_world, me, k.name || '. ' || k.note, 'system');
  return faith_said(p_world, me) || jsonb_build_object('took', k.id);
end $function$;

-- Love's and Power's techniques.
CREATE OR REPLACE FUNCTION public.path_technique_cast(p_world uuid, p_uid uuid, p_spell text, p_at jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare k path_pick; p player; tx int; ty int; r record; c creature; v_n int; v_secs double precision;
begin
  select * into k from path_pick where id = p_spell;
  select * into p from player where world_id = p_world and uid = p_uid;
  tx := floor(p.x)::int; ty := floor(p.y)::int;
  if p_spell = 'knowledge_seek' then
    select m.id, m.element, sqrt(((m.x - tx) ^ 2 + (m.y - ty) ^ 2)::double precision) as d into r
      from mote_swirl m where m.world_id = p_world
       and sqrt(((m.x - tx) ^ 2 + (m.y - ty) ^ 2)::double precision) <= (k.fx->>'reach')::double precision
     order by 3, m.id limit 1;
    if r.id is null then
      return jsonb_build_object('why', 'There is no mote swirl within ' || (k.fx->>'reach') || ' tiles of you.');
    end if;
    update player set path_marks = coalesce(path_marks, '{}'::jsonb) || jsonb_build_object('seek', r.id)
     where world_id = p_world and uid = p_uid;
    return jsonb_build_object('said', 'The nearest mote swirl is ' || floor(r.d + 0.5)::int || ' tiles off, '
      || case when r.element ~ '^[aeiou]' then 'an' else 'a' end || ' ' || r.element || ' mote swirl. It is marked on your map.');
  elsif p_spell = 'knowledge_sky' then
    return jsonb_build_object('said', sky_said((select seed from world where id = p_world), world_time(p_world), (k.fx->>'hours')::int));
  elsif p_spell = 'knowledge_trace' then
    -- A hoard of a map in your own pack: the map is what digs it up (`unearth`).
    select t.item_id, sqrt(((t.x - tx) ^ 2 + (t.y - ty) ^ 2)::double precision) as d into r
      from treasure t join item i on i.world_id = t.world_id and i.id = t.item_id
     where t.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
       and sqrt(((t.x - tx) ^ 2 + (t.y - ty) ^ 2)::double precision) <= (k.fx->>'reach')::double precision
     order by 2, t.item_id limit 1;
    if r.item_id is null then
      return jsonb_build_object('why', 'No hoard of a map in your pack is buried within ' || (k.fx->>'reach') || ' tiles of you.');
    end if;
    update player set path_marks = coalesce(path_marks, '{}'::jsonb) || jsonb_build_object('trace', r.item_id)
     where world_id = p_world and uid = p_uid;
    return jsonb_build_object('said', 'A hoard buried for a map in your pack is ' || floor(r.d + 0.5)::int || ' tiles off. It is marked on your map.');
  elsif p_spell = 'knowledge_foreknow' then
    update player set foreknow = (k.fx->>'goes')::int where world_id = p_world and uid = p_uid;
    return jsonb_build_object('said', 'Your next ' || number_word((k.fx->>'goes')::int) || ' goes that roll for success will succeed.');
  elsif p_spell = 'knowledge_clarity' then
    update player set clarity_until = now() + make_interval(secs => (k.fx->>'secs')::double precision)
     where world_id = p_world and uid = p_uid;
    return jsonb_build_object('said', 'For ' || time_words((k.fx->>'secs')::double precision) || ' every skill gain you make is '
      || round((k.fx->>'more')::numeric * 100)::int || '% larger.');
  end if;
  /*
   * Love's and Power's (`Game.workTechnique`), in the same words. One that
   * finds nothing to work on is refused, and costs nothing.
   */
  if p_spell = 'love_refresh' then
    update player set stats = jsonb_set(jsonb_set(coalesce(stats, '{}'::jsonb), '{hunger}', '1'), '{thirst}', '1')
     where world_id = p_world and uid = p_uid;
    return jsonb_build_object('said', 'You are neither hungry nor thirsty.');
  elsif p_spell = 'love_bond' then
    -- Your companion: the one following you.
    select * into c from creature cc where cc.world_id = p_world and cc.keeper = p_uid and cc.mode = 'active' order by cc.id limit 1;
    if c.id is null or sqrt((creature_x(c) - p.x) ^ 2 + (creature_y(c) - p.y) ^ 2) > (k.fx->>'reach')::double precision then
      return jsonb_build_object('why', 'No companion of yours is within ' || (k.fx->>'reach') || ' tiles of you.');
    end if;
    if c.health >= max_health(c) then return jsonb_build_object('why', c.name || ' is not hurt.'); end if;
    update creature set health = least(max_health(c), c.health + max_health(c) * (k.fx->>'heal')::double precision)
     where world_id = p_world and id = c.id;
    return jsonb_build_object('said', c.name || ' regains ' || round((k.fx->>'heal')::numeric * 100)::int || '% of its health.');
  elsif p_spell = 'love_gather' then
    -- Yours that can come: following you or working your settlement, not in the traces, not ridden, not in a trap; by id.
    v_n := 0;
    for r in select cc.id, cc.name, cc.mode, cc.carrying
               from creature cc
              where cc.world_id = p_world and cc.keeper = p_uid and cc.mode in ('active', 'deed')
                and cc.hitched_to is null and cc.rider is null and cc.trapped is null
                and sqrt((creature_x(cc) - p.x) ^ 2 + (creature_y(cc) - p.y) ^ 2) <= (k.fx->>'reach')::double precision
              order by cc.id
    loop
      v_n := v_n + 1;
    end loop;
    if v_n = 0 then
      return jsonb_build_object('why', 'No wildermon of yours is within ' || (k.fx->>'reach') || ' tiles of you.');
    end if;
    -- Round you in a ring (`gatherSpot`), as a call puts one beside you; a worker carrying something takes it home after.
    update creature cc set from_x = p.x + cos(2 * pi() * g.i / v_n) * gather_ring(), to_x = p.x + cos(2 * pi() * g.i / v_n) * gather_ring(),
           from_y = p.y + sin(2 * pi() * g.i / v_n) * gather_ring(), to_y = p.y + sin(2 * pi() * g.i / v_n) * gather_ring(),
           leg_at = now(), leg_ends = now(), until = now(), enemy = null, settled_at = now(),
           phase = case when cc.mode = 'deed' and cc.carrying is not null then 'home' else 'idle' end
      from (select c2.id, (row_number() over (order by c2.id) - 1)::double precision as i
              from creature c2
             where c2.world_id = p_world and c2.keeper = p_uid and c2.mode in ('active', 'deed')
               and c2.hitched_to is null and c2.rider is null and c2.trapped is null
               and sqrt((creature_x(c2) - p.x) ^ 2 + (creature_y(c2) - p.y) ^ 2) <= (k.fx->>'reach')::double precision) g
     where cc.world_id = p_world and cc.id = g.id;
    if v_n = 1 then
      return jsonb_build_object('said', r.name || ' is beside you.');
    end if;
    return jsonb_build_object('said', upper(left(number_word(v_n), 1)) || substr(number_word(v_n), 2) || ' of your wildermon are beside you.');
  elsif p_spell = 'love_lull' then
    -- Everything hunting you within its reach stops where it stands, and starts no hunt until it is struck or the time is up.
    update creature cc set hunting = null, windup_at = null, hunt_again = now() + make_interval(secs => (k.fx->>'secs')::double precision),
           from_x = creature_x(cc), from_y = creature_y(cc), to_x = creature_x(cc), to_y = creature_y(cc),
           leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
     where cc.world_id = p_world and cc.hunting = p_uid and cc.mode = 'wild' and cc.health > 0
       and sqrt((creature_x(cc) - p.x) ^ 2 + (creature_y(cc) - p.y) ^ 2) <= (k.fx->>'reach')::double precision;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      return jsonb_build_object('why', 'Nothing within ' || (k.fx->>'reach') || ' tiles of you is hunting you.');
    end if;
    return jsonb_build_object('said', case when v_n = 1
      then 'The one creature hunting you stops, and starts no hunt for ' || (k.fx->>'secs') || ' seconds unless you strike it.'
      else 'The ' || number_word(v_n) || ' creatures hunting you stop, and start no hunt for ' || (k.fx->>'secs') || ' seconds unless you strike them.' end);
  elsif p_spell = 'love_herd_heart' then
    select * into c from creature cc where cc.world_id = p_world and cc.keeper = p_uid and cc.mode = 'active' order by cc.id limit 1;
    if c.id is null then return jsonb_build_object('why', 'No companion follows you.'); end if;
    v_secs := (k.fx->>'secs')::double precision;
    perform path_start(p_world, p_uid, 'path_herd', v_secs);
    return jsonb_build_object('said', 'For ' || time_words(v_secs) || ' ' || c.name || ' takes '
      || round((k.fx->>'cut')::numeric * 100)::int || '% less damage and deals ' || round((k.fx->>'more')::numeric * 100)::int
      || '% more while it is within ' || (k.fx->>'reach') || ' tiles of you.');
  elsif p_spell = 'power_second_wind' then
    update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{stamina}', '1') where world_id = p_world and uid = p_uid;
    return jsonb_build_object('said', 'Your wind comes back all at once.');
  elsif p_spell = 'power_deep_lungs' then
    -- What deep water has cost so far is paid first, so the free stretch begins now (`body_settle`).
    perform body_settle(p_world, p_uid);
    v_secs := (k.fx->>'secs')::double precision;
    perform path_start(p_world, p_uid, 'path_lungs', v_secs);
    return jsonb_build_object('said', 'For ' || time_words(v_secs) || ' swimming costs you no stamina.');
  elsif p_spell = 'power_shrug' then
    perform wounds_settle(p_world, p_uid);
    select * into p from player where world_id = p_world and uid = p_uid;
    if not exists (select 1 from jsonb_array_elements(coalesce(p.wounds, '[]'::jsonb)) w
                    where coalesce((w->>'bleeding')::boolean, false) or coalesce((w->>'venom')::double precision, 0) > 0) then
      return jsonb_build_object('why', 'Nothing on you is bleeding, weeping or carrying venom.');
    end if;
    update player set wounds = (select jsonb_agg((w - 'venom') || '{"bleeding": false}'::jsonb order by o)
                                  from jsonb_array_elements(wounds) with ordinality z(w, o))
     where world_id = p_world and uid = p_uid;
    return jsonb_build_object('said', 'Nothing on you is bleeding, weeping or carrying venom now.');
  elsif p_spell = 'power_surge' then
    v_secs := (k.fx->>'secs')::double precision;
    perform path_start(p_world, p_uid, 'path_surge', v_secs);
    return jsonb_build_object('said', 'For ' || (k.fx->>'secs') || ' seconds you walk '
      || round(((k.fx->>'pace')::numeric - 1) * 100)::int || '% faster, and nothing slows you.');
  elsif p_spell = 'power_unbroken' then
    perform body_settle(p_world, p_uid);
    v_secs := (k.fx->>'secs')::double precision;
    perform path_start(p_world, p_uid, 'path_unbroken', v_secs);
    return jsonb_build_object('said', 'For ' || time_words(v_secs) || ' nothing costs you stamina.');
  end if;
  return jsonb_build_object('why', 'Nothing is written behind that spell yet.');
end $function$;

-- A companion inside its keeper's Heart of the Herd deals more.
CREATE OR REPLACE FUNCTION public.companion_dealt(c creature)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select case when c.mode <> 'active' or c.keeper is null then 1 else coalesce((
    select case when (pl.blessings->'bloodlust'->>'until')::timestamptz > now()
                then (pl.blessings->'bloodlust'->>'more')::double precision else 1 end
         * case when (pl.blessings->'primal_fury'->>'until')::timestamptz > now()
                then (pl.blessings->'primal_fury'->>'more')::double precision else 1 end
      from player pl where pl.world_id = c.world_id and pl.uid = c.keeper), 1) end
    -- And inside a Heart of the Herd (Love's).
    * herd_heart(c, 'dealt')
$function$;

/* ------------------------------------------------------------------ *
 * Kin: every other reader of a creature's age, at the pace its keeper's
 * Kin sets (`age_pace`), and nothing else changed in any of them.
 * ------------------------------------------------------------------ */

-- `blood_read`, reading age at its keeper's Kin.
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
  return c.name || ', ' || c.sex || ' ' || lower(d.name) || ', ' || age_of(c.born, old_of(c), age_pace(c))
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

-- `class_beast_take`, reading age at its keeper's Kin.
CREATE OR REPLACE FUNCTION public.class_beast_take(p_world uuid, p_id integer, p_pts double precision, p_by integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; v_name text; cx double precision; cy double precision;
begin
  if p_pts <= 0 then return false; end if;
  update creature set health = health - p_pts, hurt_at = now(), hurt_by = coalesce(p_by, hurt_by)
   where world_id = p_world and id = p_id and health > 0
   returning * into c;
  if c.id is null or c.health > 0 then return false; end if;
  select name into v_name from species_def where id = c.species;
  cx := creature_x(c); cy := creature_y(c);
  delete from creature where world_id = p_world and id = p_id;
  update creature set enemy = null where world_id = p_world and enemy = p_id;
  perform drop_on_ground(p_world, floor(cx)::int, floor(cy)::int, 'corpse',
    (15 + random() * 35) * (age_row(c.born, old_of(c), age_pace(c))).yield, v_name);
  if c.keeper is not null then perform tell(p_world, c.keeper, c.name || ' dies of the wounds it took for you.', 'fight'); end if;
  return true;
end $function$;

-- `companion_settle`, reading age at its keeper's Kin.
CREATE OR REPLACE FUNCTION public.companion_settle(p_world uuid, p_id integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; k player; q creature; guard int := 0; done int := 0;
        pace double precision; cx double precision; cy double precision;
        ax double precision; ay double precision; dist double precision; v_step record;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found or c.mode <> 'active' or c.keeper is null then return 0; end if;
  -- Under a rider or in the traces it goes where it is taken, and does no thinking.
  if c.rider is not null or c.hitched_to is not null then return 0; end if;
  select * into k from player where world_id = p_world and uid = c.keeper;
  if not found then return 0; end if;
  select * into d from species_def where id = c.species;
  pace := d.speed * (age_row(c.born, old_of(c), age_pace(c))).speed * beast_mul(c, 'speed');

  while c.until <= now() and guard < 60 loop
    guard := guard + 1;
    cx := c.to_x; cy := c.to_y;

    if c.phase = 'strike' then
      -- The row goes down first: the blow settles the other one, and a kill
      -- takes the enemy off every row that had it, this one included.
      update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
          leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
          enemy = c.enemy, settled_at = now()
        where world_id = p_world and id = p_id;
      if c.enemy is not null and creature_attack(p_world, p_id, c.enemy) then done := done + 1; end if;
      select * into c from creature where world_id = p_world and id = p_id;
      c.phase := 'idle';
      c.leg_at := c.until; c.leg_ends := c.until;
      continue;
    end if;

    q := companion_target(p_world, c, k);
    if q.id is null then
      c.enemy := null;
      exit;
    end if;
    if c.enemy is distinct from q.id then
      c.enemy := q.id;
      perform tell(p_world, c.keeper, c.name || ' goes for the '
        || lower((select name from species_def where id = q.species)) || '.', 'fight');
    end if;
    ax := creature_x(q); ay := creature_y(q);
    dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
    if dist <= companion_reach() then
      c.phase := 'strike';
      c.leg_at := c.until; c.leg_ends := c.until;
      -- Quicker inside its keeper's Primal Fury (`companion_quick`).
      c.until := c.until + make_interval(secs => companion_blow() / (beast_mul(c, 'haste') * companion_quick(c)));
    else
      -- A leg that ends well inside its reach, so a thing shuffling half a
      -- step does not put it out of reach again, round whatever is between.
      select * into v_step from chase_leg(p_world, cx, cy,
        cx + (ax - cx) * (dist - companion_reach() / 2) / dist,
        cy + (ay - cy) * (dist - companion_reach() / 2) / dist);
      if v_step.x is null then
        -- Nothing open at all: the browser gives up here too.
        c.enemy := null;
        exit;
      end if;
      c.from_x := cx; c.from_y := cy;
      c.to_x := v_step.x; c.to_y := v_step.y;
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs =>
        greatest(0.2, sqrt((c.to_x - cx) ^ 2 + (c.to_y - cy) ^ 2)
                      / greatest(0.1, pace * companion_pace())));
      c.until := c.leg_ends;
    end if;
  end loop;

  -- Piers: at heel, unless its keeper is on a tile on piers, where it does not go: then where it is (`creature_tile_ok`).
  if c.enemy is null and on_piers(p_world, floor(k.x)::int, floor(k.y)::int) then
    c.from_x := c.to_x; c.from_y := c.to_y;
    c.leg_at := now(); c.leg_ends := now(); c.until := now();
    c.phase := 'idle';
  elsif c.enemy is null then
    -- Nothing to go for: at heel, which is not a walk of its own.
    c.from_x := k.x; c.from_y := k.y; c.to_x := k.x; c.to_y := k.y;
    c.leg_at := now(); c.leg_ends := now(); c.until := now();
    c.phase := 'idle';
  elsif c.until <= now() then
    c.from_x := c.to_x; c.from_y := c.to_y;
    c.leg_at := now(); c.leg_ends := now(); c.until := now() + interval '1 second';
  end if;
  update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
      enemy = c.enemy, settled_at = now()
    where world_id = p_world and id = p_id;
  return done;
end $function$;

-- `creature_settle`, reading age at its keeper's Kin.
CREATE OR REPLACE FUNCTION public.creature_settle(p_world uuid, p_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; a age_def; elapsed double precision; top double precision;
        guard int := 0; n int; i int; nx double precision; ny double precision;
        dist double precision; secs double precision; pace double precision; ok boolean;
        home record; ax double precision; ay double precision; v_rig placed; v_bled double precision;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return false; end if;
  select * into d from species_def where id = c.species;
  a := age_row(c.born, old_of(c), age_pace(c));
  /*
   * In the traces until somebody takes it out.
   *
   * A hitch was a column and nothing else read it: the settle below went on
   * walking a companion to its keeper's feet and sending a worker out to its
   * trade, so an animal backed into a yoke was at its owner's heels a second
   * later, still hitched to a wagon it was nowhere near. It stands at the
   * vehicle now, thinks nothing, and does not get hungry, until `unhitch_one`
   * or `unhitch_all` takes it out -- or what it was hitched to is gone, in
   * which case there is nothing left to be in the traces of.
   */
  if c.hitched_to is not null then
    select * into v_rig from placed where world_id = p_world and id = c.hitched_to;
    if not found then
      update creature set hitched_to = null where world_id = p_world and id = p_id;
      c.hitched_to := null;
    end if;
  end if;
  elapsed := extract(epoch from (now() - c.settled_at));
  if elapsed <= 0 then
    -- Nothing has passed for the body — but a worker's day is not its body,
    -- and the trips it is owed are still owed. One in the traces owes none.
    if c.hitched_to is not null then return false; end if;
    if c.mode = 'deed' then perform worker_settle(p_world, p_id);
    elsif c.mode = 'active' then perform companion_settle(p_world, p_id); end if;
    return false;
  end if;

  -- The body: hunger falling, wounds closing, fleece coming back, and a
  -- brushing wearing off. None of it needs a step; it is all just elapsed time.
  top := max_health(c);
  /*
   * A knife's bleeding, for the part of the time since the last settle that it
   * ran, and never the last of it: what finishes a thing is a blow. While it
   * bleeds it is hurt, so it mends nothing (`KNIFE_BLEED`).
   */
  if c.bleed_until is not null then
    v_bled := extract(epoch from (least(now(), c.bleed_until) - c.settled_at));
    if v_bled > 0 then
      if c.health > 1 then c.health := greatest(1, c.health - coalesce(c.bleed_rate, 0) * v_bled); end if;
      c.hurt_at := greatest(coalesce(c.hurt_at, c.settled_at), least(now(), c.bleed_until));
    end if;
    if c.bleed_until <= now() then c.bleed_until := null; c.bleed_rate := null; end if;
  end if;
  -- Except in the traces, where the belly holds where it was when it went in.
  if c.hitched_to is null then
    -- Hungry slower for its keeper's Light Eaters.
    c.hunger := greatest(0, c.hunger - elapsed * hunger_rate(c.mode) * beast_mul(c, 'appetite')
                                   * coalesce((c.kept->>'kept:hunger')::double precision, 1));
  end if;
  if c.health > top then
    c.health := top;
  elsif c.health < top and (c.hurt_at is null or now() - c.hurt_at > interval '6 seconds') then
    c.health := least(top, c.health + elapsed * case when c.mode = 'wild' then 0.25 else 0.6 end * beast_mul(c, 'mend'));
  end if;
  if d.fleece is not null and a.growth > 0 and c.fleece < 1 then
    c.fleece := least(1, c.fleece + elapsed * d.fleece * a.growth * beast_mul(c, 'grow'));
  end if;
  -- A brushing wears off over a few hours: longer for its keeper's Lasting Care.
  c.care := greatest(0, c.care - elapsed / (coalesce((c.kept->>'kept:care_hours')::double precision, care_hours()) * 3600));
  /*
   * And a hungry one on a deed goes to the stores.
   *
   * Written on the row rather than on `c`, so the settle below does not carry
   * the old belly back over it. Only when it is actually hungry, which for a
   * worker is an hour or so apart — this is not a cost anybody pays on a beat.
   */
  if c.mode <> 'wild' and c.hitched_to is null and c.hunger < graze_hungry() then
    if worker_feed(p_world, p_id) is not null then
      c.hunger := least(1, c.hunger + graze_fill());
    end if;
  end if;

  -- And no further: it stands at the vehicle, the body settled and nothing else.
  if c.hitched_to is not null then
    update creature set
        from_x = v_rig.cx, from_y = v_rig.cy, to_x = v_rig.cx, to_y = v_rig.cy,
        leg_at = now(), leg_ends = now(), until = now(),
        health = c.health, fleece = c.fleece, care = c.care,
        enemy = null, hunting = null, settled_at = now()
      where world_id = p_world and id = p_id;
    return true;
  end if;

  if c.mode = 'wild' then
    -- A hunter looks for you; anything else you struck that stands and fights is after you already (`engage_beast`).
    -- A tame thing that hurt it, first, while it is on one (`brawl_settle`).
    if c.brawl is not null then c := brawl_settle(p_world, c, d, a); end if;
    if c.id is not null and c.brawl is null and (d.hunter or c.hunting is not null) then c := hunt_settle(p_world, c, d, a); end if;
  else
    c.hunting := null;
    c.brawl := null;
  end if;

  if c.mode = 'wild' and c.hunting is null and c.brawl is null then
    pace := d.speed * a.speed * beast_mul(c, 'speed') * 0.7;
    while c.until <= now() and guard < catch_up_legs() loop
      guard := guard + 1;
      n := c.leg + 1;
      ok := false;
      -- A step about its own country rather than a step from wherever it
      -- last got to. Past the edge of its range it draws towards home
      -- instead, which is what keeps an island's wildlife somewhere in
      -- particular. A creature from before homes existed takes where it
      -- stands, which is what it would have had anyway.
      if c.home_x is null then c.home_x := c.to_x; c.home_y := c.to_y; end if;
      -- A pack keeps closer to home, so that it is met together (`pack_range`).
      if (c.to_x - c.home_x) ^ 2 + (c.to_y - c.home_y) ^ 2 > (case when d.pack then pack_range() else wild_range() end) ^ 2 then
        ax := c.home_x; ay := c.home_y;
      else
        ax := c.to_x; ay := c.to_y;
      end if;
      for i in 0..7 loop
        nx := ax + (hash_tile(p_id, n, 7001 + i) * 2 - 1) * wild_reach();
        ny := ay + (hash_tile(p_id, n, 9001 + i) * 2 - 1) * wild_reach();
        if creature_tile_ok(p_world, floor(nx)::int, floor(ny)::int)
           and line_clear(p_world, c.to_x, c.to_y, nx, ny) then ok := true; exit; end if;
      end loop;
      c.leg := n;
      if not ok then
        -- Hemmed in: stand where it is and look again in a moment.
        c.from_x := c.to_x; c.from_y := c.to_y;
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '2 seconds';
        continue;
      end if;
      -- It feeds itself on the way. The browser walks it to a forage bed,
      -- grazes for a few seconds and tops the belly up; out here the leg that
      -- ends on ground worth grazing is the same thing without the detail.
      if c.hunger < graze_hungry() and coalesce((select forage from tile_def
            where id = land_tile(p_world, floor(nx)::int, floor(ny)::int)), false) then
        c.hunger := least(1, c.hunger + graze_fill());
      end if;
      -- No further than a Root or a Tether lets it (`class_leash_point`).
      select lp.x, lp.y into nx, ny from class_leash_point(p_world, p_id, nx, ny) lp;
      dist := sqrt((nx - c.to_x) ^ 2 + (ny - c.to_y) ^ 2);
      secs := greatest(0.2, dist / greatest(0.1, pace));
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.to_x := nx; c.to_y := ny;
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs => secs);
      c.until := c.leg_ends + make_interval(secs => wild_rest() + hash_tile(p_id, n, 11001) * wild_rest_spread());
    end loop;
    /*
     * And past the cap it is where it got to, and the clock catches up with
     * it. This line is the whole reason the cap can come down: it was already
     * here, and it was already the answer for anything more than forty legs
     * behind. Forty was doing an eighth of a second of arithmetic to reach an
     * answer this line gives for nothing.
     *
     * Measured, on a creature an hour behind: 109.10 ms with the cap at forty,
     * against 4.78 ms for one a second behind. Every one of those legs is a
     * random step inside a home range nobody was standing in.
     */
    if c.until <= now() then
      c.from_x := c.to_x; c.from_y := c.to_y;
      c.leg_at := now(); c.leg_ends := now();
      c.until := now() + make_interval(secs => 1 + hash_tile(p_id, c.leg, 11001) * 5);
    end if;
  elsif c.mode = 'active' and c.keeper is not null and c.enemy is null then
    -- A companion is wherever its keeper is; following is not a walk of its own.
    -- A fight is, and one with something in its teeth keeps the legs it has:
    -- `companion_settle`, below, walks it, strikes, and brings it back to heel.
    select p.x, p.y into home from player p where p.world_id = p_world and p.uid = c.keeper;
    -- Piers: but not onto a tile on piers, where it does not go: it waits where it is (`creature_tile_ok`).
    if found and not on_piers(p_world, floor(home.x)::int, floor(home.y)::int) then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      c.leg_at := now(); c.leg_ends := now(); c.until := now();
    end if;
  elsif c.mode = 'stored' then
    -- In a crate: where the crate stands, or at the feet of whoever carries it.
    select pl.cx as x, pl.cy as y into home from placed pl where pl.world_id = p_world and pl.creature = p_id limit 1;
    if not found then
      select py.x, py.y into home from player py where py.world_id = p_world and py.uid = c.keeper;
    end if;
    if found then
      c.from_x := home.x; c.from_y := home.y; c.to_x := home.x; c.to_y := home.y;
      -- A crated one never walks, so it is not asked every round.
      c.leg_at := now(); c.leg_ends := now(); c.until := now() + make_interval(secs => stored_settle());
    end if;
  end if;

  update creature set
      from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, leg = c.leg,
      health = c.health, hunger = c.hunger, fleece = c.fleece, care = c.care,
      hunting = c.hunting, hunt_x = c.hunt_x, hunt_y = c.hunt_y, hunt_again = c.hunt_again,
      fight_blows = c.fight_blows, windup_at = c.windup_at, bleed_rate = c.bleed_rate, bleed_until = c.bleed_until,
      hurt_at = c.hurt_at, pack_lead = c.pack_lead, brawl = c.brawl, threat_at = c.threat_at,
      home_x = c.home_x, home_y = c.home_y,
      settled_at = now()
    where world_id = p_world and id = p_id;
  -- And then the day's work, for whichever of them is on a deed rather than
  -- out in the country. The row goes down first because the work reads it back.
  if c.mode = 'deed' then perform worker_settle(p_world, p_id);
  -- And a companion's company, which is the one thing at heel that is a walk of its own.
  elsif c.mode = 'active' then perform companion_settle(p_world, p_id); end if;
  -- And what a Retribution dealt back to it while it struck, now that it is written down (`faith_owed_pay`).
  perform faith_owed_pay(p_world, p_id);
  -- And a Brace for the Charge waiting for it at the edge of somebody's reach (`class_owed_pay`).
  perform class_owed_pay(p_world, p_id);
  return true;
end $function$;

-- `faith_flee`, reading age at its keeper's Kin.
CREATE OR REPLACE FUNCTION public.faith_flee(p_world uuid, p_id integer, p_fx double precision, p_fy double precision, p_secs double precision)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; a age_def; v_cx double precision; v_cy double precision; v_d double precision;
        v_pace double precision; v_run double precision; v_step record; v_tx double precision; v_ty double precision;
begin
  perform creature_settle(p_world, p_id);
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found then return; end if;
  select * into d from species_def where id = c.species;
  a := age_row(c.born, old_of(c), age_pace(c));
  v_cx := creature_x(c); v_cy := creature_y(c);
  v_d := greatest(0.001, sqrt((v_cx - p_fx) ^ 2 + (v_cy - p_fy) ^ 2));
  v_pace := greatest(0.1, d.speed * a.speed * beast_mul(c, 'speed') * flee_pace());
  v_run := v_pace * p_secs;
  select * into v_step from chase_leg(p_world, v_cx, v_cy, v_cx + (v_cx - p_fx) / v_d * v_run, v_cy + (v_cy - p_fy) / v_d * v_run);
  v_tx := coalesce(v_step.x, v_cx); v_ty := coalesce(v_step.y, v_cy);
  update creature set hunting = null, windup_at = null, brawl = null,
      hunt_again = now() + make_interval(secs => p_secs),
      from_x = v_cx, from_y = v_cy, to_x = v_tx, to_y = v_ty, leg_at = now(),
      leg_ends = now() + make_interval(secs => greatest(0.2, sqrt((v_tx - v_cx) ^ 2 + (v_ty - v_cy) ^ 2) / v_pace)),
      until = now() + make_interval(secs => p_secs), settled_at = now()
    where world_id = p_world and id = p_id;
  perform fx_beast(p_id, p_secs, 'fright');
end $function$;

-- `mount_speed`, reading age at its keeper's Kin.
CREATE OR REPLACE FUNCTION public.mount_speed(c creature)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select least(max_mount_speed(),
    (select speed from species_def where id = c.species)
    * (age_row(c.born, old_of(c), age_pace(c))).speed * beast_mul(c, 'speed')
    * footing(beast_climb(c)) * (0.6 + 0.4 * c.hunger))
$function$;

-- `pair_refuses`, reading age at its keeper's Kin.
CREATE OR REPLACE FUNCTION public.pair_refuses(p_world uuid, a creature, b creature)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare c creature; stage text;
begin
  foreach c in array array[a, b] loop
    stage := age_of(c.born, old_of(c), age_pace(c));
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
end $function$;

-- `perform_creature`, reading age at its keeper's Kin.
CREATE OR REPLACE FUNCTION public.perform_creature(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; a age_def; food text; n int; made_ql double precision;
        gained double precision; chance double precision; warm double precision; nm text;
        held int; brush_id bigint; top double precision; before double precision; skill double precision;
        dd deed; v_swap int; v_to text; v_why text; v_more boolean := false;
begin
  -- Opening a crate is asked of the crate, standing or carried.
  if p_action in ('crate_follow', 'crate_work') then
    perform perform_crate_open(p_world, p_uid, p_action, p_target);
    return;
  end if;
  c := target_creature(p_world, p_target);
  if c.world_id is null then return; end if;
  select * into d from species_def where id = c.species;
  a := age_row(c.born, old_of(c), age_pace(c));

  if p_action = 'examine_creature' then
    if c.mode = 'wild' and d.monster then
      perform tell(p_world, p_uid, 'A ' || lower(d.name) || ': ' || d.description
        || ' It has ' || ceil(c.health) || ' of ' || max_health(c) || ' in it and hits for '
        || to_char(attack_of(c), 'FM990') || '. It cannot be tamed. Kill it and butcher it, or keep well clear.', 'error');
    elsif c.mode = 'wild' then
      warm := coax_bonus(c, pk(p_world, p_uid, 'coax:step', coax_step()));
      perform tell(p_world, p_uid, 'A wild ' || lower(d.name) || ': ' || d.description
        || ' It eats ' || diet_text(c.species) || '.'
        || case when warm > 0 then ' It has taken ' ||
             case when c.coaxed = 1 then 'an offering' else c.coaxed || ' offerings' end
             || ' from your hand and is ' || to_char(warm * 100, 'FM990') || '% readier for the next.'
           else '' end
        || ' You would have to tame it to learn more.', 'event');
    else
      perform tell(p_world, p_uid, c.name || ' (' || c.sex || ' ' || lower(d.name) || ', ' || a.name
        || '): ' || d.description || ' Level ' || creature_level(c.skills)
        || '. Health ' || ceil(c.health) || '/' || max_health(c) || '. It is ' || care_word(c.care)
        || ' and carries ' || trait_names(c.traits) || '. '
        || case when c.hunger < 0.3 then 'It looks hungry.' when c.hunger < 0.6 then 'It could eat.'
                else 'It looks well fed.' end
        || ' It eats ' || diet_text(c.species) || '.'
        -- And the odds of a pairing, for a Herdsman's Stud Book.
        || stud_book(p_world, p_uid, c), 'event');
    end if;

  elsif p_action = 'tame' then
    -- Any food as an offering for a Herdsman's Any Bait.
    food := bait_in_pack(p_world, p_uid, c.species, pk(p_world, p_uid, 'bait:any', 0) > 0);
    if food is null then return; end if;
    -- The crate may have gone out of the pack since the offering was begun.
    if tame_room_refusal(p_world, p_uid) is not null then
      perform tell(p_world, p_uid, tame_room_refusal(p_world, p_uid), 'error');
      return;
    end if;
    if not consume(p_world, p_uid, food, 1) then return; end if;
    chance := tame_chance(p_world, p_uid, c);
    perform faith_kinship_spent(p_world, p_uid, c.id);
    update creature set hunger = least(1, hunger + 0.25) where world_id = p_world and id = c.id;
    if random() < chance then
      held := companion_of(p_world, p_uid);
      update creature set mode = 'active', stance = 'defensive', keeper = p_uid, coaxed = 0, coaxed_at = null
        where world_id = p_world and id = c.id;
      -- One follows you; every one after that goes into the crate you carry.
      if held is not null then perform crate_shut_in(p_world, c.id, empty_crate(p_world, p_uid), null); end if;
      perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' takes the '
        || material_name(food, 1) || ' from your hand and trusts you. '
        || case when held is null then c.name || ' now follows you.'
             else 'It goes into the creature crate in your pack: set the crate down, or open it to have it follow you or work the deed.' end,
        'system');
      perform journal_note(p_world, p_uid, 'tamed');
      perform guide_mark(p_world, p_uid, c.species, 'tamed');
      perform skill_told(p_world, p_uid, 'taming', try_gain(true, tame_gain()));
      perform skill_told(p_world, p_uid, 'soul_strength', try_gain(true, tame_nerve()));
    else
      -- It refused, but it stayed for the offering, and that is worth
      -- something to the next one.
      update creature set coaxed = coaxed + 1, coaxed_at = now()
        where world_id = p_world and id = c.id returning * into c;
      warm := coax_bonus(c, pk(p_world, p_uid, 'coax:step', coax_step()));
      perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' '
        || replace(d.tame_fail, '{food}', material_name(food, 1)) || '.'
        -- No ceiling on it any more, so nothing here says there is one: this
        -- read "as used to you as it will get" from the fourth offering on,
        -- which was true then and is not now.
        || case when warm > 0 then ' It is growing used to you: '
             || to_char(warm * 100, 'FM990') || '% readier than the first time.'
           else '' end, 'event');
      perform skill_told(p_world, p_uid, 'taming', try_gain(false, tame_gain()));
      perform skill_told(p_world, p_uid, 'soul_strength', try_gain(false, tame_nerve()));
    end if;

  elsif p_action = 'feed' then
    food := bait_in_pack(p_world, p_uid, c.species);
    if food is null or not consume(p_world, p_uid, food, 1) then return; end if;
    update creature set hunger = least(1, hunger + 0.5) where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' gobbles up the ' || material_name(food, 1) || '.', 'event');

  elsif p_action = 'groom' then
    select i.id into brush_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'brush'
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    skill := skill_of(p_world, p_uid, 'animal_husbandry');
    before := c.care;
    top := max_health(c);
    update creature set
        -- More of it at a go for a Herdsman's Brushwork.
        care = least(1, care + (0.18 + (skill / 100) * 0.34
                          + (least(100, tool_ql(p_world, p_uid, 'brush')) / 100) * 0.22) * pk(p_world, p_uid, 'groom:care', 1)),
        -- A brushing is also a looking-over: it finds the small hurts, more of them for Healing Hands.
        health = least(top, health + top * pk(p_world, p_uid, 'groom:heal', groom_heal()))
      where world_id = p_world and id = c.id returning * into c;
    if brush_id is not null then perform wear_tool(brush_id, 3); end if;
    perform journal_note(p_world, p_uid, 'groom');
    if c.care >= 0.995 then perform journal_note(p_world, p_uid, 'groomfull'); end if;
    gained := skill_told(p_world, p_uid, 'animal_husbandry', 0.4);
    perform tell(p_world, p_uid, case when before < 0.12 and c.care >= 0.12
        then 'You work the dust out of ' || c.name || '''s coat. It leans into the brush. ('
        else 'You brush ' || c.name || ' down. (' end || care_word(c.care) || ')', 'event');

  elsif p_action = 'shear' then
    -- A full fleece is three, a half-grown one is one, and quality follows the fleece.
    n := greatest(1, round(c.fleece * case when coalesce(d.shear_yield, 'wool') = 'wool' then 3 else 6 end)::int)
      -- And more of it for a perk on what comes off (a Tailor's Full Fleece).
      + floor(pk(p_world, p_uid, 'plus:' || coalesce(d.shear_yield, 'wool'), 0))::int;
    made_ql := greatest(1, least(100, 15 + c.fleece * 45 + skill_of(p_world, p_uid, 'tailoring') * 0.4));
    perform gather(p_world, p_uid, coalesce(d.shear_yield, 'wool'), n, made_ql);
    update creature set fleece = 0 where world_id = p_world and id = c.id;
    perform skill_told(p_world, p_uid, 'tailoring', 0.4);
    perform skill_told(p_world, p_uid, 'taming', 0.1);
    perform tell(p_world, p_uid, 'You '
      || case when coalesce(d.shear_yield, 'wool') = 'wool' then 'shear' else 'pluck' end
      || ' ' || c.name || ' and come away with ' || n || ' '
      || lower((select coalesce(name, 'wool') from item_def where id = coalesce(d.shear_yield, 'wool')))
      || '. (QL ' || to_char(made_ql, 'FM990.0') || ') It will grow back.', 'event');

  elsif p_action = 'milk_creature' then
    if not consume(p_world, p_uid, 'bucket', 1) then return; end if;
    -- What it has been fed on is what comes out of it.
    made_ql := greatest(1, least(100, 20 + c.fleece * 40 + c.hunger * 30));
    perform give(p_world, p_uid, 'milk_bucket', 1, made_ql);
    -- A Farmer's Milkmaid fills a second bucket now and then, if there is one.
    if random() < pk(p_world, p_uid, 'more:milk_creature', 0) then
      v_more := consume(p_world, p_uid, 'bucket', 1);
      if v_more then perform give(p_world, p_uid, 'milk_bucket', 1, made_ql); end if;
    end if;
    update creature set fleece = 0 where world_id = p_world and id = c.id;
    perform skill_told(p_world, p_uid, 'farming', 0.3);
    perform tell(p_world, p_uid, 'You milk ' || c.name || ' into the bucket'
      || case when v_more then ' and fill another' else '' end || '. (QL '
      || to_char(made_ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'set_stance' then
    update creature set stance = p_target->>'stance', enemy = null where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' will be '
      || case when p_target->>'stance' = 'guard' then 'guarding you' else p_target->>'stance' end || '.', 'info');

  elsif p_action = 'order_attack' then
    update creature set enemy = (p_target->>'foe')::int, heel_until = null where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' goes for the ' || lower((select sd.name from creature q
      join species_def sd on sd.id = q.species where q.world_id = p_world and q.id = (p_target->>'foe')::int)) || '.', 'fight');

  elsif p_action = 'order_heel' then
    update creature set enemy = null, heel_until = now() + make_interval(secs => fall_back())
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' falls back to your side, and starts no fight for ' || fall_back() || ' seconds.', 'info');

  elsif p_action = 'rename_creature' then
    nm := left(btrim(p_target->>'name'), 24);
    update creature set name = nm where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, 'It answers to ' || nm || ' now.', 'info');

  elsif p_action = 'take_creature' then
    -- The one following you takes its place, on the deed or in a crate you carry.
    select sw.v_current, sw.v_to, sw.v_why into v_swap, v_to, v_why from companion_swap(p_world, p_uid, c) sw;
    if v_why is not null then return; end if;
    if c.carrying is not null then
      perform drop_on_ground(p_world, floor(creature_x(c))::int, floor(creature_y(c))::int,
        c.carrying->>'def', coalesce((c.carrying->>'ql')::double precision, 1), c.carrying->>'extra',
        coalesce((c.carrying->>'count')::int, 1));
    end if;
    update creature set mode = 'active', keeper = p_uid, post = null, carrying = null, phase = 'idle',
        enemy = null, hunting = null, settled_at = now()
      where world_id = p_world and id = c.id;
    perform creature_settle(p_world, c.id);
    perform tell(p_world, p_uid, c.name || ' now follows you.', 'system');
    if v_to = 'deed' then
      update creature set mode = 'deed', job = (select s.gathers from species_def s where s.id = creature.species),
          phase = 'idle', work_x = null, work_y = null, carrying = null, enemy = null, hunting = null,
          settled_at = now()
        where world_id = p_world and id = v_swap returning * into c;
      perform tell(p_world, p_uid, c.name || ' stays behind in its place, and will ' || deed_job_line(c) || '.', 'info');
    elsif v_to = 'crate' then
      perform crate_shut_in(p_world, v_swap, empty_crate(p_world, p_uid), null);
      perform tell(p_world, p_uid, (select q.name from creature q where q.world_id = p_world and q.id = v_swap)
        || ' goes into the creature crate in your pack.', 'info');
    end if;

  elsif p_action = 'crate_creature' then
    if empty_crate(p_world, p_uid) is null or c.mode not in ('active', 'deed') then return; end if;
    perform crate_shut_in(p_world, c.id, empty_crate(p_world, p_uid), null);
    perform tell(p_world, p_uid, c.name || ' goes into the creature crate. Set the crate down and it can be seen inside.', 'system');

  elsif p_action = 'assign_deed' then
    -- The same key, missed in the same place: this is the token the wildermon
    -- is being put to work around, so it is the caller's own, not whichever
    -- one the planner happened to hand back first. On an island with two
    -- settlements it teleported a stored beast to a stranger's token.
    dd := my_deed(p_world, p_uid);
    -- The trade it was asked for by name, or its species' own. The door has
    -- already said the name is one of its trades.
    update creature set mode = 'deed', keeper = p_uid, phase = 'idle',
        job = coalesce(nullif(p_target->>'job', ''), d.gathers),
        work_x = null, work_y = null, carrying = null,
        from_x = case when c.mode = 'stored' then dd.x + 0.5 else creature_x(c) end,
        from_y = case when c.mode = 'stored' then dd.y + 1.5 else creature_y(c) end,
        to_x = case when c.mode = 'stored' then dd.x + 0.5 else creature_x(c) end,
        to_y = case when c.mode = 'stored' then dd.y + 1.5 else creature_y(c) end,
        leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' will '
      || coalesce((select plain from gather_def where id = coalesce(nullif(p_target->>'job', ''), d.gathers)), 'stay around the settlement')
      || ' within ' || work_range(c) || ' tiles of the token and bring what it finds to the crate.', 'system');

  elsif p_action = 'release_creature' then
    -- Out of its crate first, at the crate's door.
    if c.mode = 'stored' then perform crate_let_out(p_world, c.id); end if;
    -- Blood takes generations to build and a moment to walk away.
    update creature set mode = 'wild', stance = 'passive', keeper = null,
        name = d.name, coaxed = 0, coaxed_at = null, until = now()
      where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' ' || d.leaves || '.', 'system');

  elsif p_action = 'cull_creature' then
    /*
     * One action, and it is done.
     *
     * A beast you keep could always be killed — by swinging at it until it
     * stopped, which is a strange thing to have to do to your own livestock
     * and takes as long as fighting a wild one. This is the short way, and it
     * leaves exactly what the long way left: a carcass on the tile, for the
     * knife.
     *
     * Walked forward first, so the carcass lands where the body actually is;
     * a kept one stands at the token, which `creature_settle` has already
     * seen to. Whatever it was carrying is not buried with it.
     */
    perform creature_settle(p_world, c.id);
    -- One in a crate is let out of it first: the carcass lies at the crate's door.
    if c.mode = 'stored' then perform crate_let_out(p_world, c.id); end if;
    select * into c from creature where world_id = p_world and id = c.id;
    if c.world_id is null then return; end if;
    if c.carrying is not null then
      perform drop_on_ground(p_world, floor(creature_x(c))::int, floor(creature_y(c))::int,
        c.carrying->>'def', coalesce((c.carrying->>'ql')::double precision, 1),
        c.carrying->>'extra', coalesce((c.carrying->>'count')::int, 1));
      update creature set carrying = null where world_id = p_world and id = c.id;
    end if;
    nm := c.name;
    -- Past any soak its blood could put in the way: this is not a blow, it is
    -- a decision. `wound_beast` is told nobody struck it, so it writes no
    -- hunter's line and no "you kill the wild one" — the words below are what
    -- happened.
    perform wound_beast(p_world, c.id, 1e9, null, null, null, null);
    perform tell(p_world, p_uid, 'You put ' || nm || ' down. The ' || lower(d.name)
      || '''s carcass lies where it stood, ready for the knife.', 'fight');
  end if;
end $function$;

-- `ride_refusal`, reading age at its keeper's Kin.
CREATE OR REPLACE FUNCTION public.ride_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; p placed; v vehicle_def; want text; n int; v_aboard bigint; v_shut text;
begin
  if ride_beast_action(p_action) then
    perform creature_settle(p_world, (p_target->>'id')::int);
    c := target_creature(p_world, p_target);
    if c.world_id is null then return 'It is gone.'; end if;
    select * into d from species_def where id = c.species;
    if c.mode = 'stored' then return c.name || ' is in a creature crate. Let it out first.'; end if;

    if p_action = 'tack_creature' then
      if not creature_in_reach(p_world, p_uid, c) then return 'Stand next to ' || c.name || '.'; end if;
      if not (age_row(c.born, old_of(c), age_pace(c))).works then
        return c.name || ' is not grown. Nothing that young takes a saddle.';
      end if;
      want := tack_missing(p_world, p_uid);
      if want is not null then return 'You need ' || want || '.'; end if;

    elsif p_action = 'shoe_creature' then
      -- Shoes, in the words the browser uses: a mount, grown, within reach,
      -- and four shoes and a mallet in the pack.
      if d.mount is null then return 'Only a mount takes shoes.'; end if;
      if not creature_in_reach(p_world, p_uid, c) then return 'Stand next to ' || c.name || '.'; end if;
      if not (age_row(c.born, old_of(c), age_pace(c))).works then
        return c.name || ' is not grown. Nothing that young takes a shoe.';
      end if;
      if pack_count(p_world, p_uid, 'horseshoe') < shoes_per_mount()::int or pack_count(p_world, p_uid, 'mallet') < 1 then
        return 'You need four horseshoes and a mallet.';
      end if;

    elsif p_action = 'untack_creature' then
      if not creature_in_reach(p_world, p_uid, c) then return 'Stand next to ' || c.name || '.'; end if;

    elsif p_action = 'mount_creature' then
      if not c.tacked then return c.name || ' has no saddle or bridle on.'; end if;
      if not (age_row(c.born, old_of(c), age_pace(c))).works then return c.name || ' is not grown enough to carry you.'; end if;
      if c.hitched_to is not null then return c.name || ' is in the traces.'; end if;
      if not creature_in_reach(p_world, p_uid, c) then return 'Stand next to ' || c.name || '.'; end if;
      if (driving(p_world, p_uid)).id is not null then
        return 'Get down off what you are driving first.';
      end if;
      if (select aboard from player where world_id = p_world and uid = p_uid) is not null then
        return 'Step ashore first.';
      end if;

    elsif p_action = 'hitch_creature' then
      -- Asked of one already in harness, which a browser that could not see
      -- the traces was offering: `hitch_up` said no and nobody heard why.
      if c.hitched_to is not null then return c.name || ' is already in the traces.'; end if;
      if c.rider is not null then return c.name || ' has a rider on it.'; end if;
      p := vehicle_for(p_world, p_uid, c);
      if p.id is null then return 'There is no cart or wagon here with an empty yoke.'; end if;
      if traces_storey_refusal(p) is not null then return traces_storey_refusal(p); end if;
      if not near_piece(p_world, p_uid, p) then
        return 'Stand by the ' || lower(placed_name(p)) || '.';
      end if;
      if not creature_in_reach(p_world, p_uid, c, 4) then
        return c.name || ' is too far off. Call it over first.';
      end if;
      if not (age_row(c.born, old_of(c), age_pace(c))).works then
        return c.name || ' is not grown. A yearling is no use in the traces.';
      end if;
      if c.hunger < 0.15 then
        return c.name || ' is too hungry to pull anything. Feed it first.';
      end if;

    elsif p_action = 'unhitch_creature' then
      if c.hitched_to is null then return c.name || ' is not in the traces.'; end if;
      select * into p from placed where world_id = p_world and id = c.hitched_to;
      if p.id is not null and traces_storey_refusal(p) is not null then return traces_storey_refusal(p); end if;
    end if;
    return null;
  end if;

  -- The rest are asked of a thing standing on the ground.
  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint
    and kind = 'furniture';
  if not found then return 'It is gone.'; end if;

  if p_action = 'pull_cart' then
    if not near_piece(p_world, p_uid, p) then return 'Stand beside the shafts.'; end if;
    v_shut := lock_refusal(p_world, p_uid, p.lock, p.x, p.y);
    if v_shut is not null then return v_shut; end if;
    if exists (select 1 from placed q where q.world_id = p_world and q.puller = p_uid and q.id <> p.id) then
      return 'You already have a cart behind you.';
    end if;

  elsif p_action = 'board_vehicle' then
    -- Nobody takes the reins or the helm out of the hands of somebody who is here.
    if helm_held(p_world, p, p_uid) then
      return case when is_boat(p) then 'Somebody else has the helm.' else 'Somebody else has the reins.' end;
    end if;
    -- Aboard her already, the helm is a step away; aboard anything else, it is not yours to reach. And the
    -- helm of a hull whose helmsman has gone away is taken over from her deck and from nowhere else, so
    -- that they have a place to be put in; the reins of a wagon are anybody's who is beside it.
    select aboard into v_aboard from player where world_id = p_world and uid = p_uid;
    if v_aboard is not null and v_aboard <> p.id then return 'You are aboard another vessel. Step ashore first.'; end if;
    if p.driver is not null and p.driver <> p_uid and is_boat(p) and v_aboard is distinct from p.id then
      return 'Somebody else has the helm.';
    end if;
    -- A wagon driven up a wide staircase is beside you only on its own storey.
    if v_aboard is null and (not near_piece(p_world, p_uid, p)
        or greatest(0, coalesce(p.level, 0)) <> greatest(0, (select level from player where world_id = p_world and uid = p_uid))) then
      return 'Stand beside it first.';
    end if;
    if (driving(p_world, p_uid)).id is not null then return 'You are already driving something.'; end if;
    -- A padlock on her keeps her helm, or the reins, to whoever has its key.
    v_shut := lock_refusal(p_world, p_uid, p.lock, p.x, p.y);
    if v_shut is not null then return v_shut; end if;
    -- A hull asks nothing but that she is still floating.
    if is_boat(p) then
      if not launch_spot(p_world, p.sub, p.x, p.y) then return 'She is aground. Push her off first.'; end if;
      return null;
    end if;
    select * into v from vehicle_def where id = p.sub;
    if found then
      n := team_size(p_world, p.id);
      if n < v.needs then
        return case when n = 0
          then 'Nothing is in the yokes. ' || placed_name(p) || ' needs ' || v.needs || ' to move.'
          else 'Only ' || n || ' of ' || v.yokes || ' yokes are filled. It needs ' || v.needs || '.' end;
      end if;
    end if;

  elsif p_action = 'board_passenger' then
    n := boat_places(p);
    if n = 0 then return 'She carries nobody but whoever steers her.'; end if;
    select aboard into v_aboard from player where world_id = p_world and uid = p_uid;
    if v_aboard = p.id then return 'You are aboard her already.'; end if;
    if v_aboard is not null then return 'You are aboard another vessel. Step ashore first.'; end if;
    if (driving(p_world, p_uid)).id is not null then return 'You are already driving something.'; end if;
    if (mount_of(p_world, p_uid)).id is not null then return 'Get down off your mount first.'; end if;
    if not near_piece(p_world, p_uid, p) then return 'Stand beside her first.'; end if;
    v_shut := lock_refusal(p_world, p_uid, p.lock, p.x, p.y);
    if v_shut is not null then return v_shut; end if;
    if not launch_spot(p_world, p.sub, p.x, p.y) then return 'She is aground. Push her off first.'; end if;
    if (select count(*) from player r where r.world_id = p_world and r.aboard = p.id) >= n then
      return 'Every one of her ' || n || ' places is taken.';
    end if;

  elsif p_action = 'leave_passenger' then
    if (select aboard from player where world_id = p_world and uid = p_uid) is distinct from p.id then
      return 'You are not aboard her.';
    end if;
    if not exists (select 1 from player pl, lateral shore_near(p_world, pl.x, pl.y)
                   where pl.world_id = p_world and pl.uid = p_uid) then
      return 'There is no shore within reach. Wait until she comes in close.';
    end if;

  elsif p_action = 'leave_vehicle' then
    if is_boat(p) and not exists (select 1 from player pl, lateral shore_near(p_world, pl.x, pl.y)
                                  where pl.world_id = p_world and pl.uid = p_uid) then
      return 'There is no shore within reach. Bring her in first, or swim for it.';
    end if;

  elsif p_action = 'unhitch_team' then
    if not near_piece(p_world, p_uid, p) then return 'Stand beside it first.'; end if;
    if traces_storey_refusal(p) is not null then return traces_storey_refusal(p); end if;
  end if;
  return null;
end $function$;

-- `rpc_creatures`, reading age at its keeper's Kin.
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
      'sex', c.sex, 'age', age_of(c.born, old_of(c), age_pace(c)), 'traits', c.traits,
      'hunting', c.hunting = me, 'mine', coalesce(c.keeper = me, false),
      -- How long is left of a heavy blow it is drawing back for, so it can be seen coming.
      'windup', case when c.windup_at > now() then extract(epoch from (c.windup_at - now())) end,
      -- Which one leads the pack it hunts with, which the browser says of the leader.
      'lead', c.pack_lead,
      -- And the tame one it has turned on, when it has.
      'brawl', c.brawl,
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
           'phase', c.phase, 'carrying', c.carrying,
           -- What it is fighting, for the line drawn to it.
           'enemy', c.enemy)
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

-- `vehicle_speed`, reading age at its keeper's Kin.
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
      * (age_row(c.born, old_of(c), age_pace(c))).speed * beast_mul(c, 'speed');
    worst := least(worst, 0.6 + 0.4 * c.hunger);
    -- Every beast adds its own share; the ones bred for it add more.
    pull := pull + coalesce((select sp.pull from species_def sp where sp.id = c.species), 0.25)
      * (age_row(c.born, old_of(c), age_pace(c))).pull * beast_mul(c, 'haul');
  end loop;
  if n < v.needs then return 0; end if;
  -- The builder's mark goes on after the cap, so a Carpenter's Smooth Axle is
  -- its whole share at the top of the range too, as `vehicleSpeed` has it; and
  -- so does how well the thing was built (`vehicle_ql_pace`).
  return least(max_vehicle_speed(),
    (sum_pace / n) * pull * worst * footing(team_climb(p_world, p_id)) * roll_ease(p.material)) * mark_of(p.mark, 'speed')
    * vehicle_ql_pace(p.ql);
end $function$;

-- `worker_settle`, reading age at its keeper's Kin.
CREATE OR REPLACE FUNCTION public.worker_settle(p_world uuid, p_id integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; kind text; guard int := 0; done int := 0;
        spot record; stand record; step record; pace double precision; dist double precision;
        secs double precision; load jsonb; cx double precision; cy double precision;
        ax double precision; ay double precision; v_foe creature; v_corpse item;
        v_step record; v_site record; v_store record; v_in boolean;
begin
  select * into c from creature where world_id = p_world and id = p_id for update;
  if not found or c.mode <> 'deed' then return 0; end if;
  /*
   * Where it takes its orders from. A post stands in for a settlement, and a
   * worker with neither has nobody to take them from at all.
   */
  select * into v_site from work_site(p_world, c);
  if v_site.x is null then
    /*
     * Let go, and told.
     *
     * A worker with neither a post nor a settlement to take orders from is
     * turned loose — which is right, because the cap on how many you may keep
     * is your settlement's level and it is nought without one. What was wrong
     * was doing it in silence. From the island: a wildermon that had been
     * working stood about on fifty tiles of forage it could have been on, and
     * nothing anywhere said it had stopped being a worker. The rules were
     * doing exactly as written and the only broken thing was that nobody was
     * told.
     */
    update creature set mode = 'wild', phase = 'idle', job = null, post = null
      where world_id = p_world and id = p_id;
    if c.keeper is not null then
      perform tell(p_world, c.keeper,
        c.name || ' has no settlement to work for and has gone back to its own business.', 'event');
    end if;
    return 0;
  end if;
  select * into d from species_def where id = c.species;
  -- The trade it was set to, which is its species' own unless it was told otherwise.
  kind := coalesce(c.job, d.gathers);
  pace := d.speed * (age_row(c.born, old_of(c), age_pace(c))).speed * beast_mul(c, 'speed')
          * (1 + greatest(1, task_skill(c)) / 500);

  while c.until <= now() and guard < 120 loop
    guard := guard + 1;
    cx := c.to_x; cy := c.to_y;

    /*
     * Company first.
     *
     * Nothing works while something is coming at it, and the two trades that
     * fight for a living are always looking for company. A worker breaks off
     * between jobs rather than mid-load: what is already in its arms goes in
     * the crate before it goes for anything, which is the one place this is
     * tidier than the browser.
     */
    if c.phase = 'strike' then
      update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
          leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
          work_x = c.work_x, work_y = c.work_y, carrying = c.carrying, enemy = c.enemy,
          settled_at = now()
        where world_id = p_world and id = p_id;
      if c.enemy is not null and creature_attack(p_world, p_id, c.enemy) then done := done + 1; end if;
      select * into c from creature where world_id = p_world and id = p_id;
      c.phase := 'idle';
      c.leg_at := c.until; c.leg_ends := c.until;
      continue;

    elsif c.phase = 'stalk' then
      -- Arrived where the carcass went down. If somebody else has had it, the
      -- walk was wasted, which is what happens to a hunter now and then.
      c.carrying := take_from_ground(p_world, c.work_x, c.work_y, 'corpse');
      c.work_x := null; c.work_y := null;
      c.phase := 'idle';
      c.leg_at := c.until; c.leg_ends := c.until;
      c.until := c.until + interval '0.5 seconds';
      continue;
    end if;

    if fight_trade(kind) and c.phase = 'idle' and c.carrying is not null then
      select * into v_store from worker_store(p_world, c, c.carrying->>'def', (c.carrying->>'count')::int);
      if v_store.id is null then
        c.until := now() + interval '30 seconds';
        exit;
      end if;
      ax := v_store.cx; ay := v_store.cy;
      dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
      c.from_x := cx; c.from_y := cy; c.to_x := ax; c.to_y := ay;
      c.leg_at := c.until;
      c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
      c.until := c.leg_ends;
      c.phase := 'home';
      continue;
    end if;

    if c.phase = 'idle' and c.carrying is null
       and (fight_trade(kind) or c.enemy is not null or c.stance <> 'passive') then
      v_foe := fight_target(p_world, p_id);
      if v_foe.id is null then
        c.enemy := null;
      else
        if c.enemy is distinct from v_foe.id then
          -- It has just seen it. A guard trains its back by keeping watch; a
          -- hunter learns the country by hunting it.
          if fight_trade(kind) then
            perform worker_learn(p_world, p_id,
              case when kind = 'hunt' then 'fighting' else 'body_strength' end,
              case when kind = 'hunt' then 0.08 else 0.1 end);
          end if;
          c.enemy := v_foe.id;
        end if;
        ax := creature_x(v_foe); ay := creature_y(v_foe);
        dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
        if dist <= fight_reach(kind) then
          c.phase := 'strike';
          c.leg_at := c.until; c.leg_ends := c.until;
          c.until := c.until + make_interval(secs => fight_blow(kind) / beast_mul(c, 'haste'));
        else
          select * into v_step from chase_leg(p_world, cx, cy,
            cx + (ax - cx) * (dist - 1) / dist, cy + (ay - cy) * (dist - 1) / dist);
          if v_step.x is null then
            -- Nothing open at all: the browser gives up here too.
            c.enemy := null;
            c.until := c.until + interval '2 seconds';
          else
            c.from_x := cx; c.from_y := cy;
            c.to_x := v_step.x; c.to_y := v_step.y;
            c.leg_at := c.until;
            c.leg_ends := c.leg_at + make_interval(secs =>
              greatest(0.2, sqrt((c.to_x - cx) ^ 2 + (c.to_y - cy) ^ 2)
                            / greatest(0.1, pace * fight_pace(kind))));
            c.until := c.leg_ends;
          end if;
        end if;
        continue;
      end if;
    end if;

    if kind = 'hunt' and c.phase = 'idle' and c.carrying is null then
      if c.work_x is not null and not exists (select 1 from item i
           where i.world_id = p_world and i.holder = 'ground'
             and i.gx = c.work_x and i.gy = c.work_y and i.def = 'corpse') then
        c.work_x := null; c.work_y := null;
      end if;
      if c.work_x is null then
        v_corpse := carcass_near(p_world, v_site.x, v_site.y, v_site.radius, cx, cy);
        if v_corpse.id is not null then c.work_x := v_corpse.gx; c.work_y := v_corpse.gy; end if;
      end if;
      if c.work_x is not null then
        ax := c.work_x + 0.5; ay := c.work_y + 0.5;
        dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
        c.from_x := cx; c.from_y := cy; c.to_x := ax; c.to_y := ay;
        c.leg_at := c.until;
        c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
        c.until := c.leg_ends;
        c.phase := 'stalk';
        continue;
      end if;
    end if;

    if worker_errand(kind) then
      -- Everything an errand asks about is on the row, so the row goes down
      -- before it is asked.
      update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
          leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
          work_x = c.work_x, work_y = c.work_y, carrying = c.carrying, fetching = c.fetching,
          settled_at = now()
        where world_id = p_world and id = p_id;

      if c.phase = 'fetch' then
        load := take_from_stores(p_world, c.fetching);
        if load is null then
          c.phase := 'idle';
          c.leg_at := c.until; c.leg_ends := c.until;
          c.until := now() + interval '4 seconds';
          exit;
        end if;
        c.carrying := load;
        c.fetching := null;
        c.phase := 'idle';
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '0.5 seconds';

      elsif c.phase = 'out' then
        c.phase := 'work';
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + make_interval(secs => work_duration(task_skill(c)) / beast_mul(c, 'work'));

      elsif c.phase = 'work' then
        if errand_do(p_world, p_id) then done := done + 1; end if;
        select * into c from creature where world_id = p_world and id = p_id;
        c.phase := 'idle';
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '1 second';

      else
        select * into step from errand_step(p_world, p_id);
        if step.gx is null then
          -- Nothing to run. Replaying an afternoon of that produces nothing.
          c.from_x := cx; c.from_y := cy;
          c.leg_at := now(); c.leg_ends := now();
          c.until := now() + interval '4 seconds';
          exit;
        end if;
        c.work_x := step.wx; c.work_y := step.wy;
        c.fetching := step.want;
        dist := sqrt((step.gx - cx) ^ 2 + (step.gy - cy) ^ 2);
        c.from_x := cx; c.from_y := cy; c.to_x := step.gx; c.to_y := step.gy;
        c.leg_at := c.until;
        c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
        c.until := c.leg_ends;
        c.phase := case when step.want is null then 'out' else 'fetch' end;
      end if;
      continue;
    end if;

    if c.phase = 'out' then
      c.phase := 'work';
      c.leg_at := c.until; c.leg_ends := c.until;
      c.until := c.until + make_interval(secs => work_duration(task_skill(c)) / beast_mul(c, 'work'));

    elsif c.phase = 'work' then
      update creature set from_x = cx, from_y = cy, to_x = cx, to_y = cy,
          leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
          work_x = c.work_x, work_y = c.work_y, settled_at = now()
        where world_id = p_world and id = p_id;
      load := worker_do(p_world, p_id);
      select * into c from creature where world_id = p_world and id = p_id;
      done := done + 1;
      c.carrying := load;
      c.work_x := null; c.work_y := null;
      if load is null then
        c.phase := 'idle';
        c.leg_at := c.until; c.leg_ends := c.until;
        c.until := c.until + interval '1 second';
      else
        select * into v_store from worker_store(p_world, c, load->>'def', (load->>'count')::int);
        if v_store.id is null then
          -- Everything on the deed is full. A worker will not tip a load out
          -- on the ground: it holds it and waits for room, and says so, once
          -- in a while rather than once a job.
          perform worker_nowhere(p_world, c);
          c.phase := 'idle';
          c.leg_at := c.until; c.leg_ends := c.until;
          c.until := now() + interval '30 seconds';
          exit;
        end if;
        ax := v_store.cx; ay := v_store.cy;
        dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
        secs := greatest(0.2, dist / greatest(0.1, pace));
        c.from_x := cx; c.from_y := cy; c.to_x := ax; c.to_y := ay;
        c.leg_at := c.until; c.leg_ends := c.leg_at + make_interval(secs => secs);
        c.until := c.leg_ends;
        c.phase := 'home';
      end if;

    elsif c.phase = 'home' then
      /*
       * Wherever the room is *now*. A crate that had room when the walk began
       * may be full by the time the load arrives — somebody else filled it, or
       * another worker got there first — and the old rule walked to the
       * settlement's crate, failed quietly into a full one and carried the
       * load back out to the fields. Reported as workers overdelivering to a
       * full crate with an empty one standing beside it.
       */
      if c.carrying is not null then
        select * into v_store from worker_store(p_world, c, c.carrying->>'def', (c.carrying->>'count')::int);
        if v_store.id is null then
          perform worker_nowhere(p_world, c);
          c.until := now() + interval '30 seconds';
          c.phase := 'idle';
          c.leg_at := c.until; c.leg_ends := c.until;
          exit;
        end if;
        if sqrt((v_store.cx - cx) ^ 2 + (v_store.cy - cy) ^ 2) > 1.6 then
          -- The room is somewhere else now: walk there rather than stand at a
          -- full crate holding a load.
          dist := sqrt((v_store.cx - cx) ^ 2 + (v_store.cy - cy) ^ 2);
          c.from_x := cx; c.from_y := cy; c.to_x := v_store.cx; c.to_y := v_store.cy;
          c.leg_at := c.until;
          c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
          c.until := c.leg_ends;
          continue;
        end if;
        if v_store.kind = 'crate' then
          v_in := crate_add(p_world, v_store.id::int, c.carrying->>'def',
            (c.carrying->>'count')::int, (c.carrying->>'ql')::double precision, c.carrying->>'extra');
        else
          v_in := furniture_add(p_world, v_store.id, c.carrying->>'def',
            (c.carrying->>'count')::int, (c.carrying->>'ql')::double precision, c.carrying->>'extra');
        end if;
        if v_in then
          -- Counted for its keeper, if they are away: what came home while they were gone.
          perform away_count(p_world, c.keeper, 'haul', c.carrying->>'def', (c.carrying->>'count')::bigint);
          c.carrying := null;
        end if;
      end if;
      c.phase := 'idle';
      c.leg_at := c.until; c.leg_ends := c.until;
      c.until := c.until + interval '1 second';

    else
      -- The fields' growth brought up to date once for the whole of the ground
      -- it works, rather than a tile at a time inside the search.
      if kind = 'farm' then
        perform crops_settle(p_world, v_site.x + 0.5, v_site.y + 0.5, v_site.radius);
      end if;
      select * into spot from find_work_tile(p_world, v_site.x, v_site.y, v_site.radius, kind, c);
      if spot.x is null then
        -- Nothing of its trade anywhere it can reach. It wanders a few tiles
        -- and waits, which from outside is a beast standing about for no
        -- reason anybody is ever told. The clock on it starts here; whether
        -- that is worth a word is `worker_idle`'s to decide, and it wants an
        -- hour of it before it says anything, so that a trade which has run
        -- dry for the day is not mistaken for one that is stuck.
        c.idle_since := coalesce(c.idle_since, now());
        perform worker_idle(p_world, c, kind, v_site.x, v_site.y, v_site.radius, v_site.post);
        c.from_x := cx; c.from_y := cy;
        c.to_x := v_site.x + 0.5 + (hash_tile(p_id, guard, 601) * 2 - 1) * 3;
        c.to_y := v_site.y + 0.5 + (hash_tile(p_id, guard, 701) * 2 - 1) * 3;
        if not creature_tile_ok(p_world, floor(c.to_x)::int, floor(c.to_y)::int) then
          c.to_x := cx; c.to_y := cy;
        end if;
        dist := sqrt((c.to_x - cx) ^ 2 + (c.to_y - cy) ^ 2);
        c.leg_at := now();
        c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
        c.until := c.leg_ends + worker_rest(c.idle_since);
        exit;
      else
        -- Worked from the bank when there is no standing on it: always for a
        -- tree, a rod or a fruit bough, and for a rock face when the water
        -- over it is deeper than a beast can wade.
        if kind in ('woodcut', 'prune', 'fish', 'fruit')
           or (kind in ('mine', 'quarry') and not creature_tile_ok(p_world, spot.x, spot.y)) then
          select * into stand from beside_tile(p_world, spot.x, spot.y);
          if stand.x is null then
            /*
             * A tile of its trade with nowhere to stand and work it from.
             *
             * This added four seconds and went round again, and round again
             * re-derived the very same tile: `find_work_tile` walks the rings
             * outward from the site and hands back the first thing that
             * passes, so nothing about waiting changes which tile that is.
             * The only thing that could is the ground itself. A beast in here
             * stands still for ever and says nothing, which is the shape of
             * every bad hour this island has had lately.
             *
             * It is unreachable today, and that is worth being plain about:
             * `worker_gatherable` demands `face_reach`, and `face_reach` only
             * passes without standing room when `beside_tile` has something in
             * it, so the two cannot presently disagree. This is written as a
             * refusal rather than a retry so that the next rule added to one
             * of them and not the other is a worker that goes quiet and gets
             * reported, not one that spins in silence.
             *
             * Having found a tile it cannot work is having found nothing, so
             * it leaves by the same door: the idle clock starts, and an hour
             * of it is a word to the keeper.
             */
            c.idle_since := coalesce(c.idle_since, now());
            perform worker_idle(p_world, c, kind, v_site.x, v_site.y, v_site.radius, v_site.post);
            c.from_x := cx; c.from_y := cy;
            c.leg_at := now(); c.leg_ends := now();
            c.until := now() + worker_rest(c.idle_since);
            exit;
          end if;
          ax := stand.x + 0.5; ay := stand.y + 0.5;
        else
          ax := spot.x + 0.5; ay := spot.y + 0.5;
        end if;
        c.work_x := spot.x; c.work_y := spot.y;
        -- Anything found at all, and the idle clock starts over.
        c.idle_since := null;
        dist := sqrt((ax - cx) ^ 2 + (ay - cy) ^ 2);
        c.from_x := cx; c.from_y := cy; c.to_x := ax; c.to_y := ay;
        c.leg_at := c.until;
        c.leg_ends := c.leg_at + make_interval(secs => greatest(0.2, dist / greatest(0.1, pace)));
        c.until := c.leg_ends;
        c.phase := 'out';
      end if;
    end if;
  end loop;

  if c.until <= now() then
    c.from_x := c.to_x; c.from_y := c.to_y;
    c.leg_at := now(); c.leg_ends := now(); c.until := now() + interval '1 second';
  end if;

  update creature set from_x = c.from_x, from_y = c.from_y, to_x = c.to_x, to_y = c.to_y,
      leg_at = c.leg_at, leg_ends = c.leg_ends, until = c.until, phase = c.phase,
      work_x = c.work_x, work_y = c.work_y, carrying = c.carrying, fetching = c.fetching,
      idle_since = c.idle_since,
      enemy = c.enemy, settled_at = now()
    where world_id = p_world and id = p_id;
  return done;
end $function$;

/* ------------------------------------------------------------------ *
 * The old abilities.
 * ------------------------------------------------------------------ */

/**
 * Call on what a path on its steps has taught: nothing, every path having
 * moved onto tiers. Refresh and Second Wind are techniques now; Mend the
 * Flesh and Fury are gone.
 */
create or replace function work_ability(p_world uuid, p_uid uuid, p_ability text) returns text
  language plpgsql as $$
begin
  return 'Nothing happens.';
end $$;

-- Everything above is the island's own but the doors it already had: shut to players again.
select private.lock_doors();
