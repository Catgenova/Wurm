/*
 * Crops through the year, and planters that grow them indoors.
 *
 * Asked for: "Implement outdoor seasonal growths for crops, with planters that
 * can be grown indoors regardless of season at a much slower rate."
 *
 * A crop in a field grows at a share of its own pace that the season sets
 * (`season_growth()`, the browser's `SEASON_GROWTH`): the whole of it in
 * spring, half again in summer, half in autumn and none in winter, when it
 * keeps its stage and waits. Before the first spring there were no seasons,
 * and it grew at the whole of it (`yearless_growth()`), so nothing already
 * growing changed. A planter grows one crop at `planter_growth()` of its pace
 * in every season, wherever it stands. The pace stamped at sowing and the
 * gardener's path stay what they were: multipliers on a stage's length.
 *
 * ## The field clock
 *
 * Growth is the integral of that rate over the wall clock, and a stage begun
 * late in autumn finishes in spring. So a field counts on a clock of its own:
 * `field_clock(t)` is the growing seconds a field has had up to `t`, worked
 * out in closed form from the moment alone -- rate 1 before the first spring,
 * then round the 28-day year -- and `field_moment(g)` the earliest moment it
 * reads `g`, so a stage that came due as a winter began is dated at the end of
 * the autumn rather than somewhere in the flat. Both are the browser's
 * `fieldClock` and `fieldMoment` (src/game/growth.ts) step for step, in the
 * same order of the same double operations, and `supabase/test/seasons.ts`
 * holds the two to each other bit for bit.
 *
 * A crop still keeps `stage_at` as the moment its stage began. Settling is
 * steps = floor((C(now) - C(stage_at)) / per), and the new stage_at is
 * C⁻¹(C(stage_at) + per * steps): still the stage's own length added on, never
 * restarted from now. C is the field clock for a field and the plain clock at
 * `planter_growth()` for a planter (`crop_clock`, `crop_moment`), and the
 * whole of it is `crop_settled`, a function of the moments alone that a test
 * can ask about any moment it likes.
 *
 * Nothing here is on the tick or on `rpc_move`. A crop is settled when it is
 * read or worked, as it always was; `rpc_ground` carries how far into its
 * stage each crop has grown (`grown`, growing seconds) rather than the wall
 * seconds since it began, so the browser lays it on its own field clock where
 * the island has it, and the island's `now`, which that clock is read off.
 *
 * ## A season held still, for a test
 *
 * `set wurm.season = 'spring'` holds every moment in spring to a field, for
 * that session: the suite's farming runs the same whatever day it is run on.
 * Nothing on the island sets it.
 *
 * ## Planters
 *
 * `planter_crop` is a crop in a placed planter, one to a planter, gone with
 * the planter. Sow, Tend, Harvest and Clear the field are the field's own
 * jobs aimed at the piece: `fire_refusal` hands them to `planter_refusal`,
 * which furniture reaches, and `perform_farm` to `perform_planter`. Seeds,
 * stages, yields, quality and the Farmer's perks are the field's -- Seed
 * Saver, Fast Growth, Bumper Crop, Herb Plot and the rest, and Crop Rotation
 * keyed to the planter (`state.sown` on its placed row). A planter with
 * something growing in it will not be picked up. Bounty brings on every crop
 * on the caster's settlements, planters standing on them included -- and it
 * is the caster's settlements now, as the browser always had it, rather than
 * every settlement on the island.
 *
 * Sleeping a night away moves a field on by the night at the season's share,
 * as the browser's field clock does, and a planter by the night at its own.
 */
set local lock_timeout = '3s';

/* ---- The field clock ---------------------------------------------------------------------- */

/* The season a test holds the fields in (`wurm.season`), or null: nothing on the island sets it. */
create or replace function season_pinned() returns text language plpgsql stable as $fn$
declare v text := nullif(current_setting('wurm.season', true), '');
begin
  return case when v = any(seasons()) then v end;
end $fn$;

/* How fast a field grows at a moment, as a share of a crop's own pace: the browser's `fieldRate`. */
create or replace function field_rate(p_at timestamptz) returns double precision language plpgsql stable as $fn$
declare v_pin text := season_pinned();
begin
  if v_pin is not null then return (season_growth())[array_position(seasons(), v_pin)]; end if;
  if extract(epoch from p_at)::double precision < year_from() then return yearless_growth(); end if;
  return (season_growth())[array_position(seasons(), season_at(p_at))];
end $fn$;

/*
 * The growing seconds a field has had up to a moment: the browser's
 * `fieldClock`, an operation at a time in its order. It reads the wall clock
 * itself up to the first spring and then each season's share of it.
 */
create or replace function field_clock(p_at timestamptz) returns double precision language plpgsql stable as $fn$
declare
  t double precision := extract(epoch from p_at)::double precision;
  f double precision := year_from();
  s double precision := season_seconds();
  r double precision[] := season_growth();
  v_pin text := season_pinned();
  d double precision; k double precision; w double precision; g double precision; i int;
begin
  if v_pin is not null then return f + (t - f) * r[array_position(seasons(), v_pin)]; end if;
  if t < f then return f + (t - f) * yearless_growth(); end if;
  d := t - f;
  k := floor(d / year_seconds());
  w := d - k * year_seconds();
  g := f + k * year_growth();
  for i in 1 .. array_length(r, 1) loop
    g := g + r[i] * least(greatest(w - (i - 1) * s, 0), s);
  end loop;
  return g;
end $fn$;

/*
 * And back: the earliest moment (epoch seconds) the field clock reads `p_g`,
 * the browser's `fieldMoment`. A reading a winter holds the clock at is
 * reached at the end of the autumn before it. Held in a season that does not
 * grow, a later reading is never reached.
 */
create or replace function field_moment(p_g double precision) returns double precision language plpgsql stable as $fn$
declare
  f double precision := year_from();
  s double precision := season_seconds();
  r double precision[] := season_growth();
  v_pin text := season_pinned();
  e double precision; k double precision; rem double precision; t0 double precision; most double precision;
  i int; rp double precision;
begin
  if v_pin is not null then
    rp := r[array_position(seasons(), v_pin)];
    if rp > 0 then return f + (p_g - f) / rp; end if;
    return case when p_g <= f then '-Infinity'::double precision else 'Infinity'::double precision end;
  end if;
  if p_g <= f then return f + (p_g - f) / yearless_growth(); end if;
  e := p_g - f;
  k := floor(e / year_growth());
  rem := e - k * year_growth();
  -- A whole number of years is reached at the end of the last of them that grew, not at the start of the next.
  if rem <= 0 then
    k := k - 1;
    rem := rem + year_growth();
  end if;
  t0 := f + k * year_seconds();
  for i in 1 .. array_length(r, 1) loop
    continue when r[i] <= 0;
    most := r[i] * s;
    if rem <= most then return t0 + (i - 1) * s + rem / r[i]; end if;
    rem := rem - most;
  end loop;
  return t0 + year_seconds();
end $fn$;

/* The season turns after a moment, the next `p_n` of them (epoch seconds): the browser's `turnsAfter`. */
create or replace function season_turns_after(p_at timestamptz, p_n integer) returns double precision[] language plpgsql stable as $fn$
declare
  t double precision := extract(epoch from p_at)::double precision;
  f double precision := year_from();
  s double precision := season_seconds();
  first double precision;
begin
  first := case when t < f then f else f + (floor((t - f) / s) + 1) * s end;
  return array(select first + i * s from generate_series(0, p_n - 1) i order by i);
end $fn$;

/* The first moment from `p_at` on at which a field grows, or Infinity: the browser's `fieldWakes`. */
create or replace function field_wakes(p_at timestamptz) returns double precision language plpgsql stable as $fn$
declare v double precision;
begin
  if field_rate(p_at) > 0 then return extract(epoch from p_at)::double precision; end if;
  foreach v in array season_turns_after(p_at, array_length(seasons(), 1)) loop
    if field_rate(to_timestamp(v)) > 0 then return v; end if;
  end loop;
  return 'Infinity'::double precision;
end $fn$;

/* The first moment after `p_at` at which a field stops growing, or Infinity: the browser's `fieldStops`. */
create or replace function field_stops(p_at timestamptz) returns double precision language plpgsql stable as $fn$
declare v double precision;
begin
  foreach v in array season_turns_after(p_at, array_length(seasons(), 1) + 1) loop
    if field_rate(to_timestamp(v)) <= 0 then return v; end if;
  end loop;
  return 'Infinity'::double precision;
end $fn$;

/* ---- A crop's clock, and a crop brought up to a moment ------------------------------------ */

/* The clock a crop grows on, read at a moment: a field's (`field_clock`), or a planter's, `planter_growth()` of the plain one. */
create or replace function crop_clock(p_planter boolean, p_at timestamptz) returns double precision language plpgsql stable as $fn$
begin
  if p_planter then return planter_growth() * extract(epoch from p_at)::double precision; end if;
  return field_clock(p_at);
end $fn$;

/* And the earliest moment that clock reads `p_g`. */
create or replace function crop_moment(p_planter boolean, p_g double precision) returns timestamptz language plpgsql stable as $fn$
begin
  return to_timestamp(case when p_planter then p_g / planter_growth() else field_moment(p_g) end);
end $fn$;

/*
 * A crop brought up to `p_now`: how many stages it moves on (never past ripe,
 * never back), the stage it is then at and when that stage began. `p_per` is
 * a stage's length in growing seconds. A function of the moments alone, so a
 * test can ask it about any of them; the browser's `cropSteps` and
 * `settleCrop` are the same arithmetic.
 */
create or replace function crop_settled(p_stage integer, p_stage_at timestamptz, p_per double precision,
    p_planter boolean, p_now timestamptz default now(),
    out o_stage integer, out o_stage_at timestamptz, out o_steps integer)
language plpgsql stable as $fn$
declare v_from double precision := crop_clock(p_planter, p_stage_at);
begin
  o_steps := greatest(0, least((crop_ripe() - p_stage)::double precision,
                               floor((crop_clock(p_planter, p_now) - v_from) / p_per)))::int;
  o_stage := p_stage + o_steps;
  o_stage_at := case when o_steps > 0 then crop_moment(p_planter, v_from + p_per * o_steps) else p_stage_at end;
end $fn$;

/*
 * When a crop comes to its next stage, as a line says it: the browser's
 * `cropWhen`, in its words. `p_left` is the growing seconds still to go in
 * the stage, `p_at` the moment asked about.
 */
create or replace function crop_when(p_next text, p_left double precision, p_planter boolean,
    p_at timestamptz default now()) returns text
language plpgsql stable as $fn$
declare t double precision := extract(epoch from p_at)::double precision;
        v_wakes double precision; v_end double precision; v_stops double precision;
begin
  if p_planter then return p_next || ' in ' || time_words(p_left / planter_growth()); end if;
  v_wakes := field_wakes(p_at);
  if v_wakes = 'Infinity'::double precision then return p_next || ' when a field grows again'; end if;
  v_end := field_moment(field_clock(p_at) + p_left);
  if v_wakes > t then
    return 'waiting for ' || season_at(to_timestamp(v_wakes)) || ', in ' || time_words(v_wakes - t)
      || ', then ' || p_next || ' ' || time_words(v_end - v_wakes) || ' after';
  end if;
  v_stops := field_stops(p_at);
  return p_next || ' in ' || time_words(v_end - t)
    || case when v_end > v_stops then ', after the ' || season_at(to_timestamp(v_stops)) else '' end;
end $fn$;

/* What a sowing says: the browser's `sownSaid`. */
create or replace function sown_said(p_name text, p_planter boolean, p_when text) returns text language sql immutable as $fn$
  select 'You sow ' || lower(p_name) || case when p_planter then ' in the planter' else '' end
      || '. ' || upper(left(p_when, 1)) || substr(p_when, 2) || '.'
$fn$;

/*
 * A stage's length for a crop at a tile, in growing seconds: the crop's own,
 * at the pace it was sown at, and shortened by the gardener's path for
 * everything on the ground of whoever founded a settlement and walks it.
 */
create or replace function crop_per(p_world uuid, p_id text, p_pace double precision, p_x integer, p_y integer)
returns double precision language plpgsql stable as $fn$
begin
  return (select d.stage_seconds from crop_def d where d.id = p_id) * p_pace
    * case when exists (select 1 from deed dd where dd.world_id = p_world
                          and abs(p_x - dd.x) <= dd.radius and abs(p_y - dd.y) <= dd.radius
                          and walks(p_world, dd.founded_by, 'love', 1)) then 0.8 else 1 end;
end $fn$;

/* ---- Fields, settled on the field clock --------------------------------------------------- */

CREATE OR REPLACE FUNCTION public.crops_settle(p_world uuid, p_x double precision, p_y double precision, p_range double precision)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare n int;
begin
  with near as (
    select c.x, c.y, c.stage, c.stage_at,
           /*
            * The gardener's path, which is the one effect of a path belonging
            * to somebody who is not here. A crop grows for whoever founded the
            * ground it is in, not for whoever happens to be looking at it.
            */
           -- And the pace it was sown at: a Farmer's Fast Growth and Crop Rotation.
           d.stage_seconds * c.pace * case when exists (
               select 1 from deed dd where dd.world_id = p_world
                 and abs(c.x - dd.x) <= dd.radius and abs(c.y - dd.y) <= dd.radius
                 and walks(p_world, dd.founded_by, 'love', 1)) then 0.8 else 1 end as per
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
  )
  update crop c set stage = due.o_stage, stage_at = due.o_stage_at, tended_now = false
    from due
   where c.world_id = p_world and c.x = due.x and c.y = due.y and due.o_steps > 0;
  get diagnostics n = row_count;
  return n;
end $function$;

/* ---- Planters ----------------------------------------------------------------------------- */

/*
 * A crop in a planter: `crop`'s columns, keyed by the placed piece it grows in
 * rather than by a tile, one to a planter, and gone with the planter. Its
 * `id` names a `crop_def` without a key onto it, as `crop.id` does: player
 * data may not point at the rulebook, which is reloaded wholesale.
 */
create table if not exists planter_crop (
  placed bigint primary key references placed (id) on delete cascade,
  world_id uuid not null references world on delete cascade,
  id text not null,
  /** 0 sown, 1 sprouting, 2 growing, 3 ripe. */
  stage int not null default 0,
  /** When the stage it is in began. */
  stage_at timestamptz not null default now(),
  /** Stages tended so far; each one lifts the harvest. */
  tended int not null default 0,
  /** Whether the stage it is in has already been tended. */
  tended_now boolean not null default false,
  /** Quality the harvest will carry, built up while tending. */
  ql real not null default 1,
  sown_by uuid,
  /** The pace it was sown at: a share of the crop's own stage length. */
  pace double precision not null default 1
);
alter table planter_crop enable row level security;
revoke all on table planter_crop from anon, authenticated;
create index if not exists planter_crop_world on planter_crop (world_id);

/* A stage's length for what grows in a planter, by where the planter stands (`crop_per`). */
create or replace function planter_per(c planter_crop, p placed) returns double precision language plpgsql stable as $fn$
begin
  return crop_per(c.world_id, c.id, c.pace, p.x, p.y);
end $fn$;

/*
 * Bring the planters within a reach up to now, on their own clock, and say
 * how many moved: `crops_settle` for a box of earth. Read, and worked; never
 * on the tick.
 */
create or replace function planters_settle(p_world uuid, p_x double precision, p_y double precision, p_range double precision)
returns integer language plpgsql as $fn$
declare n int;
begin
  with near as (
    select c.placed, c.stage, c.stage_at,
           /*
            * `planter_per`, written out as `crops_settle` writes out its own:
            * called once a row, it cost more than the rest of the settling
            * put together.
            */
           d.stage_seconds * c.pace * case when exists (
               select 1 from deed dd where dd.world_id = p_world
                 and abs(p.x - dd.x) <= dd.radius and abs(p.y - dd.y) <= dd.radius
                 and walks(p_world, dd.founded_by, 'love', 1)) then 0.8 else 1 end as per
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
end $fn$;

/* One planter's worth of it. */
create or replace function planter_settle(p_world uuid, p_placed bigint) returns boolean language plpgsql as $fn$
declare c planter_crop; p placed; s record;
begin
  select * into c from planter_crop where placed = p_placed and world_id = p_world for update;
  if not found or c.stage >= crop_ripe() then return false; end if;
  select * into p from placed where id = p_placed;
  select * into s from crop_settled(c.stage, c.stage_at, planter_per(c, p), true);
  if s.o_steps <= 0 then return false; end if;
  update planter_crop set stage = s.o_stage, stage_at = s.o_stage_at, tended_now = false where placed = p_placed;
  return true;
end $fn$;

/*
 * The pace a crop sown in a planter now grows at, for whoever sows it: a
 * Farmer's Fast Growth, and Crop Rotation on a planter last sown with another
 * crop -- the planter's own last crop, which it keeps on its placed row.
 */
create or replace function planter_pace(p_world uuid, p_uid uuid, p_placed bigint, p_crop text)
returns double precision language plpgsql stable as $fn$
declare v_last text := (select p.state->>'sown' from placed p where p.id = p_placed);
begin
  return pk(p_world, p_uid, 'grow:plant_seed', 1)
       * case when v_last is not null and v_last <> p_crop then pk(p_world, p_uid, 'rotate:plant_seed', 1) else 1 end;
end $fn$;

/*
 * Sow a planter from a seed in the pack: 'sown', or 'kept' when a Farmer's
 * Seed Saver spared the seed, or null when there was none left to spend.
 * `sow_one` for a box of earth.
 */
create or replace function sow_planter(p_world uuid, p_uid uuid, p_placed bigint, p_seed bigint)
returns text language plpgsql as $fn$
declare it item; cd crop_def; v_kept boolean; p placed;
begin
  select * into p from placed where id = p_placed and world_id = p_world;
  if not found or not is_planter(p.sub) then return null; end if;
  select * into it from item i
    where i.id = p_seed and i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid;
  if not found then return null; end if;
  select * into cd from crop_def where seed = it.def;
  if cd.id is null then return null; end if;
  v_kept := random() < pk(p_world, p_uid, 'keep:plant_seed', 0);
  if not v_kept then
    if not consume(p_world, p_uid, it.def, 1, it.id) then return null; end if;
  end if;
  insert into planter_crop (placed, world_id, id, ql, sown_by, pace)
  values (p_placed, p_world, cd.id, it.ql, p_uid, planter_pace(p_world, p_uid, p_placed, cd.id))
  on conflict (placed) do update set id = excluded.id, stage = 0, stage_at = now(),
    tended = 0, tended_now = false, ql = excluded.ql, sown_by = excluded.sown_by, pace = excluded.pace;
  -- What it was sown with, for the next sowing's Crop Rotation.
  update placed set state = coalesce(state, '{}'::jsonb) || jsonb_build_object('sown', cd.id) where id = p_placed;
  perform land_announce(p_world, p.x, p.y);
  return case when v_kept then 'kept' else 'sown' end;
end $fn$;

/*
 * What a harvest gives and where it goes, from a crop's own id, tending and
 * quality: what its tending earned, the gardener's path, and a Farmer's
 * Bumper Crop, Herb Plot, Grain Master and Fibre Farmer, Rare Harvest and
 * Fodder's grass. The whole of `reap_one` but the row, which a field and a
 * planter keep in different tables.
 */
create or replace function reap_what(p_world uuid, p_uid uuid, p_id text, p_tended integer, p_ql double precision,
  p_skill double precision,
  out o_produce text, out o_got integer, out o_seed text, out o_seeds integer, out o_ql double precision,
  out o_rare text)
language plpgsql as $fn$
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
  -- The gardener's path takes a third more out of the same ground.
  o_got := greatest(1, round(yld[2] * case when walks(p_world, p_uid, 'love', 5) then 1.34 else 1 end))
         + floor(pk(p_world, p_uid, 'plus:' || cd.produce, 0))::int;
  o_rare := perk_rare(pk(p_world, p_uid, 'rare:harvest_crop', 0));
  o_produce := cd.produce;
  o_seed := cd.seed;
  o_seeds := yld[1];
  perform gather(p_world, p_uid, cd.produce, o_got, o_ql, null, o_rare);
  perform gather(p_world, p_uid, cd.seed, o_seeds, o_ql);
  v_grass := floor(pk(p_world, p_uid, 'fodder:harvest_crop', 0))::int;
  if v_grass > 0 then perform give(p_world, p_uid, 'mixed_grass', v_grass, o_ql); end if;
end $fn$;

/* Harvest one ripe crop in a field: `reap_what`, and the field bare again. */
CREATE OR REPLACE FUNCTION public.reap_one(p_world uuid, p_uid uuid, p_x integer, p_y integer, p_skill double precision, OUT o_produce text, OUT o_got integer, OUT o_seed text, OUT o_seeds integer, OUT o_ql double precision, OUT o_rare text)
 RETURNS record
 LANGUAGE plpgsql
AS $function$
declare c crop; r record;
begin
  select * into c from crop cr where cr.world_id = p_world and cr.x = p_x and cr.y = p_y;
  if c.id is null then return; end if;
  select * into r from reap_what(p_world, p_uid, c.id, c.tended, c.ql, p_skill);
  o_produce := r.o_produce; o_got := r.o_got; o_seed := r.o_seed; o_seeds := r.o_seeds; o_ql := r.o_ql; o_rare := r.o_rare;
  delete from crop cr where cr.world_id = p_world and cr.x = p_x and cr.y = p_y;
  perform land_announce(p_world, p_x, p_y);
end $function$;

/* And in a planter: the same harvest, and the planter empty again. */
create or replace function reap_planter(p_world uuid, p_uid uuid, p_placed bigint, p_skill double precision,
  out o_produce text, out o_got integer, out o_seed text, out o_seeds integer, out o_ql double precision,
  out o_rare text)
language plpgsql as $fn$
declare c planter_crop; p placed; r record;
begin
  select * into c from planter_crop where placed = p_placed and world_id = p_world;
  if c.placed is null then return; end if;
  select * into r from reap_what(p_world, p_uid, c.id, c.tended, c.ql, p_skill);
  o_produce := r.o_produce; o_got := r.o_got; o_seed := r.o_seed; o_seeds := r.o_seeds; o_ql := r.o_ql; o_rare := r.o_rare;
  delete from planter_crop where placed = p_placed;
  select * into p from placed where id = p_placed;
  perform land_announce(p_world, p.x, p.y);
end $fn$;

/*
 * Why a job on a planter will not go, or null: the field's refusals, in the
 * field's words, about what is in the box. Reached through `fire_refusal`,
 * which every job aimed at a piece of furniture goes to and which has already
 * asked whether you are standing next to it. Read without settling anything:
 * the stage it would be at now is worked out, not written.
 */
create or replace function planter_refusal(p_world uuid, p_uid uuid, p_action text, p placed, p_target jsonb)
returns text language plpgsql stable as $fn$
declare c planter_crop; it item; s record; v_stage int; v_tended_now boolean;
begin
  if not is_planter(p.sub) then
    return case when p_action = 'plant_seed' then 'Choose a field.' else 'Nothing is growing there.' end;
  end if;
  select * into c from planter_crop where placed = p.id;
  if c.placed is not null then
    select * into s from crop_settled(c.stage, c.stage_at, planter_per(c, p), true);
    v_stage := s.o_stage;
    v_tended_now := c.tended_now and s.o_steps = 0;
  end if;
  if p_action = 'plant_seed' then
    if c.placed is not null then return 'Something is already growing there.'; end if;
    select * into it from item
      where id = target_item(p_target) and world_id = p_world and holder = 'player' and holder_uid = p_uid;
    if not found or not exists (select 1 from crop_def where seed = it.def) then return 'Choose a seed to sow.'; end if;
  elsif p_action = 'tend_crop' then
    if c.placed is null then return 'Nothing is growing there.'; end if;
    if v_stage >= crop_ripe() then return 'It is ripe. Harvest it.'; end if;
    if v_tended_now then return 'You have already tended it at this stage. Wait for it to grow on.'; end if;
  elsif p_action = 'harvest_crop' then
    if c.placed is null then return 'Nothing is growing there.'; end if;
    if v_stage < crop_ripe() then return 'It is only ' || crop_stage_name(v_stage) || '. Let it grow.'; end if;
  elsif p_action = 'clear_field' then
    if c.placed is null then return 'Nothing is growing there.'; end if;
  else
    -- Tilling and a Farmer's patches are the ground's, not a box's.
    return 'Choose a field.';
  end if;
  return null;
end $fn$;

/*
 * Sow, tend, harvest or pull up what is in a planter: the field's four jobs,
 * aimed at the piece, with the field's words but for where it went.
 */
create or replace function perform_planter(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
returns void language plpgsql as $fn$
declare p placed; c planter_crop; cd crop_def; it item; yld int[]; s double precision; v_how text; r record;
begin
  select * into p from placed where world_id = p_world and id = nullif(p_target->>'id', '')::bigint;
  if p.id is null or not is_planter(p.sub) then return; end if;
  s := skill_of(p_world, p_uid, 'farming');
  -- Anything that works a crop works it up to date.
  perform planter_settle(p_world, p.id);
  select * into c from planter_crop where placed = p.id;
  if c.placed is not null then select * into cd from crop_def where id = c.id; end if;

  if p_action = 'plant_seed' then
    if c.placed is not null then return; end if;
    select * into it from item where id = target_item(p_target);
    select * into cd from crop_def where seed = it.def;
    v_how := sow_planter(p_world, p_uid, p.id, it.id);
    if v_how is null then return; end if;
    select * into c from planter_crop where placed = p.id;
    -- When it will be sprouting, in real time, at a planter's share of the crop's pace.
    perform tell(p_world, p_uid, sown_said(cd.name, true, crop_when(crop_stage_name(1), planter_per(c, p), true))
      || case when v_how = 'kept' then ' It cost you no seed.' else '' end, 'event');

  elsif p_action = 'tend_crop' then
    if c.placed is null or c.stage >= crop_ripe() or c.tended_now then return; end if;
    update planter_crop set tended_now = true, tended = tended + 1,
        ql = (ql * (tended + 1) + product_ql(s, 0)) / (tended + 2)
      where placed = p.id returning * into c;
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
    if c.placed is null or c.stage < crop_ripe() then return; end if;
    select * into r from reap_planter(p_world, p_uid, p.id, s);
    if r.o_produce is null then return; end if;
    perform tell(p_world, p_uid, 'You harvest ' || r.o_got || ' × ' || coalesce(r.o_rare || ' ', '')
      || lower((select coalesce(name, r.o_produce) from item_def where id = r.o_produce))
      || ' and ' || r.o_seeds || ' ' || lower((select coalesce(name, r.o_seed) from item_def where id = r.o_seed))
      || '. The planter is ready to sow again. (QL ' || to_char(r.o_ql, 'FM990.0') || ')', 'event');
    if r.o_rare is not null then
      perform journal_note(p_world, p_uid, r.o_rare);
      perform tell(p_world, p_uid, rarity_word(r.o_rare), 'skill');
    end if;
    perform skill_raise(p_world, p_uid, 'farming', 1);

  elsif p_action = 'clear_field' then
    if c.placed is null then return; end if;
    delete from planter_crop where placed = p.id;
    perform land_announce(p_world, p.x, p.y);
    perform tell(p_world, p_uid, 'You turn the ' || lower(cd.name) || ' back into the soil.', 'event');
  end if;
end $fn$;

/*
 * Bring every crop on the caster's settlements on one stage, and say how
 * many: the fields, and the planters standing on them. Each begins its new
 * stage now. It used to bring on every field on every settlement on the
 * island, whoever cast it; the browser's has always been the caster's own.
 */
create or replace function hasten_crops(p_world uuid, p_uid uuid) returns integer language plpgsql as $fn$
declare n int; m int;
begin
  with bumped as (
    update crop c set stage = c.stage + 1, stage_at = now(), tended_now = false
     where c.world_id = p_world and c.stage < crop_ripe() and on_my_deed(p_world, p_uid, c.x, c.y)
    returning 1
  ) select count(*)::int into n from bumped;
  with bumped as (
    update planter_crop c set stage = c.stage + 1, stage_at = now(), tended_now = false
      from placed pl
     where c.world_id = p_world and pl.id = c.placed and c.stage < crop_ripe()
       and on_my_deed(p_world, p_uid, pl.x, pl.y)
    returning 1
  ) select count(*)::int into m from bumped;
  return n + m;
end $fn$;
drop function if exists hasten_crops(uuid);

/* ---- The field's jobs, which hand a planter on; a sowing says when it will sprout ------ */

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
        v_ids text[] := '{}'; v_counts int[] := '{}'; v_rares text[] := '{}'; v_rare text;
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

  elsif p_action = 'plant_seed' then
    select * into it from item where id = target_item(p_target);
    select * into cd from crop_def where seed = it.def;
    v_how := sow_one(p_world, p_uid, tx, ty, it.id);
    if v_how is null then return; end if;
    select * into c from crop cr where cr.world_id = p_world and cr.x = tx and cr.y = ty;
    -- When it will be sprouting, in real time, from the season it was sown in: the browser's words.
    perform tell(p_world, p_uid, sown_said(cd.name, false,
        crop_when(crop_stage_name(1), crop_per(p_world, c.id, c.pace, tx, ty), false))
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
    perform land_set_tile(p_world, tx, ty, tile_id('Dirt'));
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, case when c.id is not null
      then 'You turn the ' || lower(cd.name) || ' back into the soil.'
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

/* ---- What a piece of furniture refuses: a planter's jobs, and lifting one that is sown -- */

CREATE OR REPLACE FUNCTION public.fire_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p placed; it item; n int; sub text; sz int[]; v_shut text;
begin
  -- Opening a creature crate, which is furniture standing on the ground.
  if p_action in ('crate_follow', 'crate_work') then
    return crate_open_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action = 'build_campfire' then
    if p_target->>'sx' is null or p_target->>'sy' is null then return 'Choose a spot.'; end if;
    if pack_count(p_world, p_uid, 'shaft') < 2 then return 'A campfire takes 2 shafts.'; end if;
    return null;
  end if;

  if p_action in ('place_smelter', 'place_furniture', 'place_kiln') then
    select * into it from item
      where id = target_item(p_target) and world_id = p_world
        and holder = 'player' and holder_uid = p_uid;
    if not found then return 'You are not carrying that.'; end if;
    if p_action = 'place_smelter' and it.def <> 'smelter' then return 'That is not a smelter.'; end if;
    if p_action = 'place_kiln' and it.def <> 'kiln' then return 'That is not a kiln.'; end if;
    if p_action = 'place_furniture' then
      sub := replace(it.def, 'furniture_', '');
      if not exists (select 1 from furniture_def where id = sub) then return 'That is not something you can set down.'; end if;
      -- A piece built only on a settlement of yours stands only on one: the same flag, off its own recipe.
      if exists (select 1 from recipe where id = 'make_' || sub and deed)
         and not on_my_deed(p_world, p_uid, (p_target->>'x')::int, (p_target->>'y')::int) then
        return 'You can only set this down on a settlement of yours.';
      end if;
      -- And one altar to a settlement: none set down on one that has its altar.
      if exists (select 1 from furniture_def f where f.id = sub and f.altar)
         and altar_on_deed(p_world, p_uid, (p_target->>'x')::int, (p_target->>'y')::int) then
        return 'This settlement already has an altar, and a settlement may have only one.';
      end if;
    end if;
    -- And the block of spots it would take, which used to be the browser's to refuse alone.
    sz := placed_size(case p_action when 'place_smelter' then 'smelter' when 'place_kiln' then 'kiln' else 'furniture' end, sub,
                      case when p_target->>'facing' in ('n', 'e', 's', 'w') then p_target->>'facing' else 's' end);
    if block_taken(p_world, (p_target->>'x')::int, (p_target->>'y')::int,
                   least(subtiles() - sz[1], greatest(0, coalesce((p_target->>'sx')::int, 0))),
                   least(subtiles() - sz[2], greatest(0, coalesce((p_target->>'sy')::int, 0))), sz[1], sz[2]) then
      return 'Something is already standing there.';
    end if;
    return null;
  end if;

  p := target_placed(p_world, p_target);
  if p.id is null then return 'It is gone.'; end if;
  if not placed_in_reach(p_world, p_uid, p.id) then
    return 'Stand next to the ' || coalesce(p.sub, p.kind) || '.';
  end if;
  -- A planter is sown, tended, harvested and pulled up as a field is, and says no as a field does.
  if farm_action(p_action) then
    return planter_refusal(p_world, p_uid, p_action, p, p_target);
  end if;

  if p_action in ('light_campfire', 'light_smelter', 'light_kiln') then
    if placed_lit(p) then return 'It is already burning.'; end if;
    if placed_fuel(p) <= 0 then return 'There is nothing left to burn. Feed it some wood.'; end if;
  elsif p_action in ('put_out_campfire', 'damp_smelter', 'damp_kiln') then
    if not placed_lit(p) then return 'It is not burning.'; end if;
  elsif p_action in ('fuel_campfire', 'fuel_smelter', 'fuel_kiln') then
    -- From what is at hand: the pack, a bag, or a store within reach.
    select i.* into it from craft_stock(p_world, p_uid, target_item(p_target)) s join item i on i.id = s.id
      where (s.id = target_item(p_target) or fuel_value(s.def) is not null)
      order by (s.id = target_item(p_target)) desc, s.draw limit 1;
    if not found or fuel_value(it.def) is null then
      return 'Fires take ' || fuel_said() || '.';
    end if;
    if placed_fuel(p) >= fire_capacity() then return 'It is already piled as high as it will take.'; end if;
  elsif p_action in ('take_ashes_fire', 'take_ashes_smelter', 'take_ashes_kiln') then
    if floor(placed_ash(p)) < 1 then return 'There are no ashes worth taking yet.'; end if;
  elsif p_action = 'turn_furniture' then
    if p.kind <> 'furniture' then return 'Only furniture turns.'; end if;
    if placed_lit(p) then return 'Put it out first.'; end if;
    if p.puller is not null then return 'Let go of it first.'; end if;
    if p.driver is not null then return 'Get down off it first.'; end if;
    if exists (select 1 from player r where r.world_id = p_world and r.aboard = p.id) then
      return 'There are people aboard her.';
    end if;
    if crates_on_rack(p_world, p.id) > 0 then return 'Take the crates off it first.'; end if;
    return furniture_turn_reason(p);
  elsif p_action in ('take_apart_campfire', 'pick_up_smelter', 'pick_up_furniture', 'pick_up_kiln') then
    if placed_lit(p) then return 'Put it out first.'; end if;
    if p_action = 'pick_up_furniture' then
      -- Locked, it stays where it is: lifting a ship or a cart and setting it
      -- down somewhere else is taking it, padlock and all.
      v_shut := lock_refusal(p_world, p_uid, p.lock, p.x, p.y);
      if v_shut is not null then return v_shut; end if;
      -- What is inside it, and what is in front of it.
      if exists (select 1 from item i where i.holder = 'furniture' and i.placed = p.id) then
        return 'Empty it first.';
      end if;
      -- A crop is not carried about in a box of earth: it is harvested, or turned back into the soil.
      if exists (select 1 from planter_crop pc where pc.placed = p.id) then
        return planter_growing_said();
      end if;
      -- A rack holds nothing of its own, so the check above passes however
      -- loaded it is: what stands on it are crates of somebody else's, and
      -- lifting the rack out from under them would leave them in the air.
      if crates_on_rack(p_world, p.id) > 0 then
        return 'Take the ' || case when crates_on_rack(p_world, p.id) = 1 then 'crate'
                                   else crates_on_rack(p_world, p.id) || ' crates' end || ' off it first.';
      end if;
      if placed_litres(p) > 0 then return 'Empty it out first.'; end if;
      -- A crate with somebody else's wildermon in it is theirs to carry off.
      if p.creature is not null and exists (select 1 from creature q where q.world_id = p_world
            and q.id = p.creature and q.mode = 'stored' and q.keeper is distinct from p_uid) then
        return (select q.name from creature q where q.world_id = p_world and q.id = p.creature)
          || ' is not yours to carry off.';
      end if;
      if p.puller is not null then return 'Let go of it first.'; end if;
      if team_size(p_world, p.id) > 0 then return 'Unhitch the team first.'; end if;
      if p.driver is not null then return 'Get down off it first.'; end if;
      if exists (select 1 from player r where r.world_id = p_world and r.aboard = p.id) then
        return 'There are people aboard her.';
      end if;
    end if;
  end if;
  return null;
end $function$;

/* ---- Bounty: every crop on the caster's settlements, the planters standing on them too -- */

CREATE OR REPLACE FUNCTION public.do_cast(p_world uuid, p_uid uuid, p_cast text, p_uid_item bigint)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare d cast_def; it item; p player; c creature; n int;
begin
  select * into d from cast_def where id = p_cast;
  perform favour_settle(p_world, p_uid);
  update player set favour = greatest(0, favour - d.cost)
    where world_id = p_world and uid = p_uid;
  perform skill_raise(p_world, p_uid, faith_skill(), 0.6);
  select * into p from player where world_id = p_world and uid = p_uid;
  if p_uid_item is not null then
    select * into it from item where world_id = p_world and id = p_uid_item;
  end if;

  if p_cast = 'call' then
    select * into c from creature where world_id = p_world and mode = 'active' and keeper = p_uid
      limit 1;
    if not found then return 'Nothing comes.'; end if;
    update creature set from_x = p.x + 0.6, from_y = p.y, to_x = p.x + 0.6, to_y = p.y,
        leg_at = now(), leg_ends = now(), settled_at = now(), enemy = null, hunting = null
      where world_id = p_world and id = c.id;
    return c.name || ' is beside you, and gives no sign of having travelled.';

  elsif p_cast = 'mend' then
    if it.id is null then return 'Nothing to mend.'; end if;
    update item set dmg = 0 where id = it.id;
    return 'Every mark of use goes out of the ' || lower(item_name(it)) || '.';

  elsif p_cast = 'dawnlight' then
    n := jsonb_array_length(p.wounds);
    update player set wounds = '[]'::jsonb,
        stats = jsonb_set(stats, '{health}',
          to_jsonb(least(1, coalesce((stats->>'health')::double precision, 1) + 0.25)))
      where world_id = p_world and uid = p_uid;
    return case when n = 1 then 'The wound closes over, and what had gone bad is clean.'
                else 'All ' || n || ' of them close over, and what had gone bad is clean.' end;

  elsif p_cast = 'cunning' then
    if it.id is null then return 'Nothing to work on.'; end if;
    update item set bless = least(bless_cap(), coalesce(bless, 0) + 1) where id = it.id;
    select * into it from item where id = it.id;
    return 'The ' || lower(item_name(it)) || ' comes out of it working '
      || round(least(bless_cap(), coalesce(it.bless, 0)) * bless_step()) || '% better than it was made. ('
      || it.bless || ' of ' || round(bless_cap()) || ')';

  elsif p_cast = 'fairwind' then
    update player set wind_until = now() + interval '6 minutes'
      where world_id = p_world and uid = p_uid;
    return 'The wind comes round behind you and settles there.';

  elsif p_cast = 'bounty' then
    n := hasten_crops(p_world, p_uid);
    return case when n > 0 then 'Every field on the settlement comes on a stage: ' || n || ' of them.'
                else 'Nothing is in the ground to come on.' end;
  end if;
  return 'Nothing happens.';
end $function$;

/* ---- A night slept through ---------------------------------------------------------- */

CREATE OR REPLACE FUNCTION public.sleep_forward(p_world uuid, p_uid uuid, p_seconds double precision)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare gap interval := make_interval(secs => p_seconds); v_rate double precision := field_rate(now());
begin
  update world set epoch = epoch - gap where id = p_world;

  update placed set since = since - gap where world_id = p_world;
  /*
   * A field has the night at the season's share, as the browser's field clock
   * runs a night on (`sleepUntilMorning`): its stage began that much earlier
   * on the field clock. Nothing, in a season that does not grow.
   */
  if v_rate > 0 then
    update crop set stage_at = crop_moment(false, field_clock(stage_at) - p_seconds * v_rate) where world_id = p_world;
  end if;
  -- And a planter the whole night at its own share, which is the plain clock's.
  update planter_crop set stage_at = stage_at - gap where world_id = p_world;
  update foraged set at = at - gap where world_id = p_world;
  update item set made_at = made_at - gap,
      lit_at = case when lit_at is null then null else lit_at - gap end
    where world_id = p_world;
  -- Everything a creature remembers except being born.
  update creature set settled_at = settled_at - gap, leg_at = leg_at - gap,
      leg_ends = leg_ends - gap, until = until - gap,
      coaxed_at = case when coaxed_at is null then null else coaxed_at - gap end,
      hurt_at = case when hurt_at is null then null else hurt_at - gap end,
      due = case when due is null then null else due - gap end,
      bred_at = case when bred_at is null then null else bred_at - gap end
    where world_id = p_world;
  -- And everything a body remembers except where it last said it was standing.
  update player set favour_at = favour_at - gap,
      prayed_at = case when prayed_at is null then null else prayed_at - gap end,
      sat_at = case when sat_at is null then null else sat_at - gap end
    where world_id = p_world;
end $function$;

/* ---- The ground read: crops by how far they have grown, planters, and the island's clock -- */

CREATE OR REPLACE FUNCTION public.rpc_ground(p_world uuid, p_range double precision DEFAULT 40, p_slow boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); p player; v_field double precision; v_box double precision;
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
        'grown', v_field - crop_clock(false, c.stage_at),
        'ago', extract(epoch from (now() - c.stage_at)),
        'tended', c.tended, 'tendedNow', c.tended_now, 'ql', c.ql, 'pace', c.pace))
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
      'nextId', coalesce((select max(b.id) + 1 from building b where b.world_id = p_world), 1),
      'list', coalesce((select jsonb_agg(jsonb_build_object(
          'id', b.id, 'name', b.name, 'levels', b.levels, 'workLevel', b.work_level,
          'tiles', (select coalesce(jsonb_agg(bt.x || ',' || bt.y order by bt.y, bt.x), '[]'::jsonb)
                      from building_tile bt
                     where bt.world_id = p_world and bt.building = b.id)) order by b.id)
        from building b
        where b.world_id = p_world
          and exists (select 1 from building_tile bt
                       where bt.world_id = p_world and bt.building = b.id
                         and greatest(abs(bt.x + 0.5 - p.x), abs(bt.y + 0.5 - p.y)) <= p_range)),
        '[]'::jsonb),
      'walls', coalesce((select jsonb_agg(jsonb_build_object(
          'building', w.building, 'level', w.level, 'x', w.x, 'y', w.y, 'dir', w.dir,
          'type', w.type, 'material', w.material, 'needed', w.needed, 'total', w.total,
          -- And the seconds since the ivy on a finished wall of stone or brick began (`greening.ts`).
          'greenAgo', case when bill_done(w.needed) and m.kind = 'stone' then green_ago(gs.since, v_from) end)
          order by w.level, w.dir, w.x, w.y)
        from wall w
        left join build_material_def m on m.id = w.material
        left join green_since gs on gs.world_id = p_world and gs.thing = 'wall' and gs.x = w.x and gs.y = w.y
                                and gs.k = green_wall_k(w.level, w.dir)
        where w.world_id = p_world
          and greatest(abs(w.x + 0.5 - p.x), abs(w.y + 0.5 - p.y)) <= p_range), '[]'::jsonb),
      'floors', coalesce((select jsonb_agg(jsonb_build_object(
          'building', f.building, 'level', f.level, 'x', f.x, 'y', f.y,
          'material', f.material, 'kind', f.kind, 'facing', f.facing,
          'needed', f.needed, 'total', f.total) order by f.level, f.x, f.y)
        from floor_tile f
        where f.world_id = p_world
          and greatest(abs(f.x + 0.5 - p.x), abs(f.y + 0.5 - p.y)) <= p_range), '[]'::jsonb)),
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
        'greenAgo', case when b.kind = 'stone' and not exists (select 1 from bridge_span s
                           where s.world_id = p_world and s.bridge = b.id and not span_done(s.needed))
                         then green_ago(gs.since, v_from) end) order by b.id)
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

select private.lock_doors();
