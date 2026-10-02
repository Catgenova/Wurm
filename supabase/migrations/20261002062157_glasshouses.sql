/*
 * Glasshouses.
 *
 * A roof may be laid in glass: panes on timber glazing bars (`glass_material()`,
 * a build material with its bill a solid wall's worth, which a roof shape takes
 * its share of as every material's is -- a hipped tile 12 panes and 4 timbers).
 * It goes on a pitched roof, gabled or hipped, and nowhere else (`glass_refusal`).
 * A building of one storey, walled all round on its ground floor (`walled_round`:
 * a finished full-height wall, door, window or arch on every border of its outline;
 * a fence, a gate or a half wall is too low), with every tile
 * of its footprint under a finished roof of glass is a glasshouse (`glasshouse`),
 * and the one building whose ground is tilled: a ground-floor tile of it with no
 * floor planned on it rakes into a field (`glass_till_refusal`), which is sown,
 * tended and harvested as any field is, the Farmer's perks and patches and Bounty
 * included. No floor is planned over a field, and while a building has a field in
 * it (`field_in`) no roof but glass is planned on it and no storey raised over it:
 * the field is cleared first (`clear_field`), which inside a footprint packs the
 * ground flat again as the rest of it is. Examine says what a glasshouse is and
 * does (`glass_examine`).
 * The browser's half is `src/game/glasshouse.ts`, and `supabase/test/glasshouse.ts`
 * holds the two to each other.
 *
 * ## A clock of its own
 *
 * A crop under glass grows at `glasshouse_growth()` of its pace in every season,
 * winter included, on the glass clock: that share of the plain clock, as a
 * planter's is `planter_growth()` of it. `crop.glass` says which clock a crop is
 * on, and `crop_clock_on`, `crop_moment_on`, `crop_settled_on` and `crop_when_on`
 * take a clock by name -- 'field', 'planter' or 'glass' -- where the ones before
 * took a planter's or not. The browser's `glassClock`, `rebaseStage`, `cropWhen`
 * and `sownSaid` are the same arithmetic and the same words.
 *
 * ## Moved between clocks
 *
 * When a building becomes a glasshouse or stops being one -- the last of its
 * glass or of its walls finished, a roof tile or a wall taken off, a tile added
 * to or taken from the footprint, a storey added -- every crop on its footprint goes onto the other
 * clock as far into its stage as it had grown (`crop_rebased`): the ground read's
 * `grown`, carried across, so a crop moved from a field's winter into a
 * glasshouse starts growing where it stood still. It is done by triggers on
 * `floor_tile`, `wall`, `building_tile` and `building` (`glass_resync`), so that
 * no way of changing a roof, a wall or a footprint can miss it; the one on `wall`
 * fires only when a ground-floor wall is planned, finished, unfinished, moved or
 * taken down, never for a plank fitted into one. And a crop sown anywhere --
 * by a hand, a patch or a worker -- is sown on its tile's clock by one on `crop`.
 *
 * ## What else it touches
 *
 * `crops_settle` settles a crop under glass on the glass clock; `sleep_forward`
 * moves one the whole night, as a planter; the ground read carries `grown` on
 * the clock it grows on and `glass` for one under glass; a sowing says "under
 * glass" and when it sprouts, which never waits for spring; `build_refusal`
 * asks `glass_refusal` in one line, and `examine_tile_text` adds `glass_examine`
 * in one. Nothing here is on
 * `rpc_move` or the tick: the triggers fire when a roof tile, a footprint tile or
 * a storey changes, and the settling is the lazy settling it always was.
 */
set local lock_timeout = '3s';

alter table crop add column if not exists glass boolean not null default false;

/* ---- A glasshouse ----------------------------------------------------------------------- */

/*
 * Whether a building is walled all round on its ground floor: a finished wall of
 * full height -- a door, a window and an arch are; a fence, a gate or a half wall
 * (`low`) is not -- on every border of its outline, which is what shuts every
 * room of it in to the eaves. The browser's `walledRound`.
 */
create or replace function walled_round(p_world uuid, p_building integer) returns boolean language sql stable as $fn$
  select not exists (
    select 1 from exterior_borders(p_world, p_building) eb
      left join wall w on w.world_id = p_world and w.level = 0 and w.dir = eb.dir and w.x = eb.x and w.y = eb.y
      left join wall_type_def wt on wt.id = w.type
     where w.type is null or not bill_done(w.needed) or coalesce(wt.low, false))
$fn$;

/* Whether a building is a glasshouse: one storey, walled all round, and every tile of its footprint under a finished roof tile of glass. */
create or replace function glasshouse(p_world uuid, p_building integer) returns boolean language sql stable as $fn$
  select coalesce((select b.levels = 1 from building b where b.world_id = p_world and b.id = p_building), false)
     and exists (select 1 from building_tile bt where bt.world_id = p_world and bt.building = p_building)
     and not exists (
       select 1 from building_tile bt
         left join floor_tile f on f.world_id = bt.world_id and f.level = 1 and f.x = bt.x and f.y = bt.y
        where bt.world_id = p_world and bt.building = p_building
          and (f.world_id is null or f.kind <> 'roof' or f.material <> glass_material() or not bill_done(f.needed)))
     and walled_round(p_world, p_building)
$fn$;

/* Whether a tile is under glass: part of a glasshouse. */
create or replace function glasshouse_at(p_world uuid, p_x integer, p_y integer) returns boolean language sql stable as $fn$
  select coalesce(glasshouse(p_world, building_at(p_world, p_x, p_y)), false)
$fn$;

/* Whether any tile of a building's footprint is a field. The browser's `fieldIn`. */
create or replace function field_in(p_world uuid, p_building integer) returns boolean language sql stable as $fn$
  select exists (select 1 from building_tile bt
                  where bt.world_id = p_world and bt.building = p_building
                    and land_tile(p_world, bt.x, bt.y) = tile_id('Field'))
$fn$;

/* ---- Clocks by name --------------------------------------------------------------------- */

/* The clock a crop in a field grows on, by name: under glass, or a field's. */
create or replace function crop_kind(p_glass boolean) returns text language sql immutable as $fn$
  select case when p_glass then 'glass' else 'field' end
$fn$;

/* A crop's clock read at a moment, by name: 'glass' is `glasshouse_growth()` of the plain clock (`glassClock`). */
create or replace function crop_clock_on(p_clock text, p_at timestamptz) returns double precision language plpgsql stable as $fn$
begin
  if p_clock = 'glass' then return glasshouse_growth() * extract(epoch from p_at)::double precision; end if;
  return crop_clock(p_clock = 'planter', p_at);
end $fn$;

/* And the earliest moment it reads `p_g` (`glassMoment`). */
create or replace function crop_moment_on(p_clock text, p_g double precision) returns timestamptz language plpgsql stable as $fn$
begin
  if p_clock = 'glass' then return to_timestamp(p_g / glasshouse_growth()); end if;
  return crop_moment(p_clock = 'planter', p_g);
end $fn$;

/* `crop_settled` on a clock by name: the browser's `cropSteps` and `settleCrop`, the same arithmetic in the same order. */
create or replace function crop_settled_on(p_stage integer, p_stage_at timestamptz, p_per double precision,
    p_clock text, p_now timestamptz default now(),
    out o_stage integer, out o_stage_at timestamptz, out o_steps integer)
language plpgsql stable as $fn$
declare v_from double precision := crop_clock_on(p_clock, p_stage_at);
begin
  o_steps := greatest(0, least((crop_ripe() - p_stage)::double precision,
                               floor((crop_clock_on(p_clock, p_now) - v_from) / p_per)))::int;
  o_stage := p_stage + o_steps;
  o_stage_at := case when o_steps > 0 then crop_moment_on(p_clock, v_from + p_per * o_steps) else p_stage_at end;
end $fn$;

/* `crop_when` on a clock by name: under glass, like a planter, it never waits for a season. The browser's `cropWhen`. */
create or replace function crop_when_on(p_next text, p_left double precision, p_clock text,
    p_at timestamptz default now()) returns text
language plpgsql stable as $fn$
begin
  if p_clock = 'glass' then return p_next || ' in ' || time_words(p_left / glasshouse_growth()); end if;
  return crop_when(p_next, p_left, p_clock = 'planter', p_at);
end $fn$;

/* What a sowing says, on a clock by name: the browser's `sownSaid`. */
create or replace function sown_said_on(p_name text, p_clock text, p_when text) returns text language sql immutable as $fn$
  select 'You sow ' || lower(p_name)
      || case p_clock when 'planter' then ' in the planter' when 'glass' then ' under glass' else '' end
      || '. ' || upper(left(p_when, 1)) || substr(p_when, 2) || '.'
$fn$;

/*
 * A crop's stage start carried from one clock onto another at `p_now`: exactly
 * as far into its stage on the new one as it had grown on the old -- `grown`, as
 * the ground read carries it, taken across. The browser's `rebaseStage`.
 */
create or replace function crop_rebased(p_stage_at timestamptz, p_from text, p_to text, p_now timestamptz default now())
returns timestamptz language plpgsql stable as $fn$
begin
  return crop_moment_on(p_to, crop_clock_on(p_to, p_now) - (crop_clock_on(p_from, p_now) - crop_clock_on(p_from, p_stage_at)));
end $fn$;

/* How far into its stage a crop in a field has grown, in growing seconds on its own clock: `p_field` is the field clock now. */
create or replace function crop_grown(p_glass boolean, p_stage_at timestamptz, p_field double precision)
returns double precision language sql stable as $fn$
  select case when p_glass then crop_clock_on('glass', now()) - crop_clock_on('glass', p_stage_at)
              else p_field - crop_clock(false, p_stage_at) end
$fn$;

/* ---- Moved between clocks --------------------------------------------------------------- */

/*
 * Every crop on a building's footprint on the clock the building gives it now:
 * the glass clock in a glasshouse, a field's otherwise. One that changes clock
 * is carried across (`crop_rebased`); says how many did.
 */
create or replace function glass_resync(p_world uuid, p_building integer) returns integer language plpgsql as $fn$
declare v_glass boolean := glasshouse(p_world, p_building); n int;
begin
  update crop c set glass = v_glass, stage_at = crop_rebased(c.stage_at, crop_kind(c.glass), crop_kind(v_glass))
    from building_tile bt
   where bt.world_id = p_world and bt.building = p_building
     and c.world_id = p_world and c.x = bt.x and c.y = bt.y and c.glass <> v_glass;
  get diagnostics n = row_count;
  return n;
end $fn$;

/* And the crop on one tile, for a tile that has just left a building. */
create or replace function glass_resync_tile(p_world uuid, p_x integer, p_y integer) returns void language plpgsql as $fn$
declare v_glass boolean := glasshouse_at(p_world, p_x, p_y);
begin
  update crop c set glass = v_glass, stage_at = crop_rebased(c.stage_at, crop_kind(c.glass), crop_kind(v_glass))
   where c.world_id = p_world and c.x = p_x and c.y = p_y and c.glass <> v_glass;
end $fn$;

/* A roof tile planned, laid, relaid or taken off: the building under it. */
create or replace function glass_roof_trigger() returns trigger language plpgsql as $fn$
begin
  if tg_op <> 'INSERT' and old.kind = 'roof' then perform glass_resync(old.world_id, old.building); end if;
  if tg_op <> 'DELETE' and new.kind = 'roof'
     and (tg_op = 'INSERT' or old.kind <> 'roof' or old.building <> new.building) then
    perform glass_resync(new.world_id, new.building);
  end if;
  return null;
end $fn$;
drop trigger if exists glass_roof_in on floor_tile;
create trigger glass_roof_in after insert on floor_tile
  for each row when (new.kind = 'roof') execute function glass_roof_trigger();
drop trigger if exists glass_roof_laid on floor_tile;
create trigger glass_roof_laid after update of needed, material, kind, building on floor_tile
  for each row when (old.kind = 'roof' or new.kind = 'roof') execute function glass_roof_trigger();
drop trigger if exists glass_roof_off on floor_tile;
create trigger glass_roof_off after delete on floor_tile
  for each row when (old.kind = 'roof') execute function glass_roof_trigger();

/* A tile added to a footprint or taken from one: the building, and a tile that has left it. */
create or replace function glass_footprint_trigger() returns trigger language plpgsql as $fn$
begin
  if tg_op = 'DELETE' then
    perform glass_resync_tile(old.world_id, old.x, old.y);
    perform glass_resync(old.world_id, old.building);
  else
    perform glass_resync(new.world_id, new.building);
  end if;
  return null;
end $fn$;
drop trigger if exists glass_footprint on building_tile;
create trigger glass_footprint after insert or delete on building_tile
  for each row execute function glass_footprint_trigger();

/* A storey added or taken off: a glasshouse is one storey. */
create or replace function glass_storeys_trigger() returns trigger language plpgsql as $fn$
begin
  perform glass_resync(new.world_id, new.id);
  return null;
end $fn$;
drop trigger if exists glass_storeys on building;
create trigger glass_storeys after update of levels on building
  for each row when (old.levels is distinct from new.levels) execute function glass_storeys_trigger();

/* A wall on a ground-floor border finished, planned or taken down: the buildings on either side of it. */
create or replace function glass_wall_resync(p_world uuid, p_dir text, p_x integer, p_y integer) returns void language plpgsql as $fn$
declare v_a int; v_b int;
begin
  -- 'h' at (x, y) lies between (x, y - 1) and (x, y); 'v' at (x, y) between (x - 1, y) and (x, y).
  v_a := building_at(p_world, case when p_dir = 'v' then p_x - 1 else p_x end, case when p_dir = 'h' then p_y - 1 else p_y end);
  v_b := building_at(p_world, p_x, p_y);
  if v_a is not null then perform glass_resync(p_world, v_a); end if;
  if v_b is not null and v_b is distinct from v_a then perform glass_resync(p_world, v_b); end if;
end $fn$;
create or replace function glass_wall_trigger() returns trigger language plpgsql as $fn$
begin
  if tg_op <> 'INSERT' and old.level = 0 then perform glass_wall_resync(old.world_id, old.dir, old.x, old.y); end if;
  if tg_op <> 'DELETE' and new.level = 0
     and (tg_op = 'INSERT' or (old.dir, old.x, old.y, old.level) is distinct from (new.dir, new.x, new.y, new.level)
          or old.type is distinct from new.type) then
    perform glass_wall_resync(new.world_id, new.dir, new.x, new.y);
  end if;
  return null;
end $fn$;
drop trigger if exists glass_wall_in on wall;
create trigger glass_wall_in after insert on wall
  for each row when (new.level = 0) execute function glass_wall_trigger();
-- Only when a wall is finished or stops being finished: a go that fits one more plank changes nothing.
drop trigger if exists glass_wall_built on wall;
create trigger glass_wall_built after update of needed on wall
  for each row when ((old.level = 0 or new.level = 0) and bill_done(old.needed) is distinct from bill_done(new.needed))
  execute function glass_wall_trigger();
drop trigger if exists glass_wall_moved on wall;
create trigger glass_wall_moved after update of level, dir, x, y, type on wall
  for each row when (old.level = 0 or new.level = 0) execute function glass_wall_trigger();
drop trigger if exists glass_wall_off on wall;
create trigger glass_wall_off after delete on wall
  for each row when (old.level = 0) execute function glass_wall_trigger();

/* A crop sown anywhere, by anybody or anything, begins on its tile's clock. */
create or replace function glass_sown_trigger() returns trigger language plpgsql as $fn$
begin
  new.glass := glasshouse_at(new.world_id, new.x, new.y);
  return new;
end $fn$;
drop trigger if exists glass_sown on crop;
create trigger glass_sown before insert on crop for each row execute function glass_sown_trigger();

/* ---- What the doors say ----------------------------------------------------------------- */

/*
 * Why a building's ground does not rake into a field, or null: only a
 * glasshouse's, only where no floor is planned on it, never a poured slab, and
 * only bare earth -- packed as a footprint is, or ground that tills anywhere.
 * The browser's `glassTillRefusal`, in the same order.
 */
create or replace function glass_till_refusal(p_world uuid, p_x integer, p_y integer) returns text
language plpgsql stable as $fn$
declare v_b int := building_at(p_world, p_x, p_y); v_t int;
begin
  if v_b is null then return null; end if;
  if not glasshouse(p_world, v_b) then return not_a_glasshouse_said(); end if;
  if exists (select 1 from floor_tile f where f.world_id = p_world and f.level = 0 and f.x = p_x and f.y = p_y) then
    return glass_floored_said();
  end if;
  -- A poured slab is packed over, with no soil in it (the browser's `GLASS_SLAB`).
  if exists (select 1 from foundation fd where fd.world_id = p_world and fd.x = p_x and fd.y = p_y) then
    return glass_slab_said();
  end if;
  v_t := land_tile(p_world, p_x, p_y);
  if v_t <> tile_id('Packed dirt') and not tillable(v_t) then return not_tillable_said(); end if;
  return null;
end $fn$;

/*
 * Why a wall, a fence, a floor slot or a storey will not be planned for glass
 * or over a field, or null: glass on a pitched roof and nowhere else; no floor
 * on the ground floor over a field; and while a building has a field in it, no
 * roof but glass on it and no storey over it. Asked once the job knows its side,
 * type and material (a storey, before anything else), as the browser's
 * `glassPlanRefusal` is.
 */
create or replace function glass_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns text
language plpgsql stable as $fn$
declare tx int := (p_target->>'x')::int; ty int := (p_target->>'y')::int;
        v_mat text := coalesce(p_target->>'material', ''); v_kind text := coalesce(p_target->>'floorKind', 'floor');
        b building;
begin
  if p_action = 'add_floor' then
    select * into b from building where world_id = p_world and id = building_at(p_world, tx, ty);
    return case when b.id is not null and field_in(p_world, b.id) then field_no_storey_said() end;
  end if;
  if p_action in ('plan_wall', 'plan_fence') then
    if coalesce(p_target->>'side', '') = '' or coalesce(p_target->>'wallType', '') = '' or v_mat = '' then return null; end if;
    return case when v_mat = glass_material() then glass_roof_only_said() end;
  end if;
  if p_action <> 'plan_floor' or v_mat = '' then return null; end if;
  if v_mat = glass_material() and v_kind <> 'roof' then return glass_roof_only_said(); end if;
  select * into b from building where world_id = p_world and id = building_at(p_world, tx, ty);
  if b.id is null then return null; end if;
  -- A building has one roof, and its first tile set the shape; the first tile asks for its own.
  if v_mat = glass_material()
     and coalesce(b.roof, (select r.id from roof_shape_def r where r.id = p_target->>'roofShape'), 'hip') = 'flat' then
    return glass_pitched_said();
  end if;
  if v_kind = 'floor' and work_level(p_world, b.id) = 0 and land_tile(p_world, tx, ty) = tile_id('Field') then
    return field_unfloored_said();
  end if;
  if v_kind = 'roof' and v_mat <> glass_material() and field_in(p_world, b.id) then
    return field_glass_only_said();
  end if;
  return null;
end $fn$;

/* ---- Settled on the clock it grows on: a crop under glass on the glass clock -------------- */

CREATE OR REPLACE FUNCTION public.crops_settle(p_world uuid, p_x double precision, p_y double precision, p_range double precision)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare n int;
begin
  with near as (
    select c.x, c.y, c.stage, c.stage_at, c.glass,
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
     where not n.glass
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

/* ---- A night slept through: under glass, the whole of it ------------------------------------ */

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
    update crop set stage_at = crop_moment(false, field_clock(stage_at) - p_seconds * v_rate) where world_id = p_world and not glass;
  end if;
  -- Under glass the whole night at the glasshouse's share, which is the plain clock's, as a planter has it.
  update crop set stage_at = stage_at - gap where world_id = p_world and glass;
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

/* ---- Tilled: in a building, a glasshouse's floor ------------------------------------------- */

CREATE OR REPLACE FUNCTION public.farm_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; here int; c crop; it item; v_r int; v_why text;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  here := land_tile(p_world, tx, ty);
  -- Anything that reads a crop reads it up to date.
  perform crop_settle(p_world, tx, ty);
  select * into c from crop cr where cr.world_id = p_world and cr.x = tx and cr.y = ty;

  if p_action = 'till' then
    -- In a building, only a glasshouse's ground, where no floor is planned on it (`glass_till_refusal`).
    if building_at(p_world, tx, ty) is not null then
      v_why := glass_till_refusal(p_world, tx, ty);
      if v_why is not null then return v_why; end if;
    elsif not tillable(here) then return not_tillable_said(); end if;
    if land_height(p_world, tx, ty) < 0 or land_height(p_world, tx + 1, ty) < 0
       or land_height(p_world, tx + 1, ty + 1) < 0 or land_height(p_world, tx, ty + 1) < 0 then
      return 'You cannot till underwater.';
    end if;
    if tile_slope(p_world, tx, ty) > 20 then return 'The ground is too steep to work.'; end if;
  elsif p_action = 'plant_moss' then
    -- In the browser's words and order (actions.ts, `plant_moss`).
    if here <> tile_id('Dirt') then return 'Moss is planted on a tile of dirt.'; end if;
    if has_water(p_world, tx, ty) then return 'You cannot plant moss underwater.'; end if;
    if pack_count(p_world, p_uid, 'moss') < moss_plant() then
      return 'It takes ' || moss_plant() || ' moss to plant a tile; you have ' || pack_count(p_world, p_uid, 'moss') || '.';
    end if;
  elsif p_action = 'plant_seed' then
    if here <> tile_id('Field') then return 'Sow on a tilled field.'; end if;
    if c.id is not null then return 'Something is already growing there.'; end if;
    select * into it from item
      where id = target_item(p_target) and world_id = p_world
        and holder = 'player' and holder_uid = p_uid;
    if not found or not exists (select 1 from crop_def where seed = it.def) then
      return 'Choose a seed to sow.';
    end if;
  elsif p_action = 'tend_crop' then
    if c.id is null then return 'Nothing is growing there.'; end if;
    if c.stage >= crop_ripe() then return 'It is ripe. Harvest it.'; end if;
    if c.tended_now then return 'You have already tended it at this stage. Wait for it to grow on.'; end if;
  elsif p_action = 'harvest_crop' then
    if c.id is null then return 'Nothing is growing there.'; end if;
    if c.stage < crop_ripe() then
      return 'It is only ' || crop_stage_name(c.stage) || '. Let it grow.';
    end if;
  elsif p_action = 'clear_field' then
    if here <> tile_id('Field') then return 'There is no field there.'; end if;
  elsif p_action = 'sow_patch' then
    if pk(p_world, p_uid, 'sow_patch', 0) <= 0 then return 'That wants a Farmer who has learned to sow a patch.'; end if;
    select * into it from item
      where id = target_item(p_target) and world_id = p_world
        and holder = 'player' and holder_uid = p_uid;
    if not found or not exists (select 1 from crop_def where seed = it.def) then
      return 'Choose a seed to sow.';
    end if;
    v_r := floor(pk(p_world, p_uid, 'sow_patch', 0))::int;
    if not exists (select 1 from generate_series(ty - v_r, ty + v_r) gy, generate_series(tx - v_r, tx + v_r) gx
                    where case when in_bounds(p_world, gx, gy) then land_tile(p_world, gx, gy) = tile_id('Field') else false end
                      and not exists (select 1 from crop cr where cr.world_id = p_world and cr.x = gx and cr.y = gy)) then
      return 'There is no empty field in the patch to sow.';
    end if;
  elsif p_action = 'tend_patch' then
    if pk(p_world, p_uid, 'tend_patch', 0) <= 0 then return 'That wants a Farmer who has learned to tend a patch.'; end if;
    v_r := floor(pk(p_world, p_uid, 'tend_patch', 0))::int;
    perform crops_settle(p_world, tx + 0.5, ty + 0.5, v_r);
    if not exists (select 1 from crop cr
                    where cr.world_id = p_world and cr.x between tx - v_r and tx + v_r and cr.y between ty - v_r and ty + v_r
                      and cr.stage < crop_ripe() and not cr.tended_now) then
      return 'Nothing in the patch wants tending.';
    end if;
  elsif p_action = 'harvest_patch' then
    if pk(p_world, p_uid, 'harvest_patch', 0) <= 0 then return 'That wants a Farmer who has learned to harvest a patch.'; end if;
    v_r := floor(pk(p_world, p_uid, 'harvest_patch', 0))::int;
    perform crops_settle(p_world, tx + 0.5, ty + 0.5, v_r);
    if not exists (select 1 from crop cr
                    where cr.world_id = p_world and cr.x between tx - v_r and tx + v_r and cr.y between ty - v_r and ty + v_r
                      and cr.stage >= crop_ripe()) then
      return 'Nothing in the patch is ripe.';
    end if;
  end if;
  return null;
end $function$;

/* ---- Sown under glass, and said so ----------------------------------------------------------- */

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

  elsif p_action = 'plant_seed' then
    select * into it from item where id = target_item(p_target);
    select * into cd from crop_def where seed = it.def;
    v_how := sow_one(p_world, p_uid, tx, ty, it.id);
    if v_how is null then return; end if;
    select * into c from crop cr where cr.world_id = p_world and cr.x = tx and cr.y = ty;
    -- When it will be sprouting, in real time, from the season it was sown in -- or in any, under glass: the browser's words.
    perform tell(p_world, p_uid, sown_said_on(cd.name, crop_kind(c.glass),
        crop_when_on(crop_stage_name(1), crop_per(p_world, c.id, c.pace, tx, ty), crop_kind(c.glass)))
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

/* ---- Planned: glass on a pitched roof and nowhere else, and no floor over a field ------------- */

CREATE OR REPLACE FUNCTION public.build_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare tx int; ty int; side text; wt wall_type_def; mat build_material_def; b building;
        w wall; f floor_tile; lvl int; kind text; tool text; other record; v_gap text;
        bears int; cap int; worst build_material_def; under build_material_def;
        pot item; colour dye_def; v_was build_material_def; v_over int; v_stands int; v_bill jsonb; v_glass text;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  side := p_target->>'side';
  select * into wt from wall_type_def where id = p_target->>'wallType';
  select * into mat from build_material_def where id = p_target->>'material';
  select * into b from building where world_id = p_world and id = building_at(p_world, tx, ty);

  /*
   * Whose building it is, asked once for every action that acts on one that
   * already stands.
   *
   * `plan_building` and `add_to_building` are answered by `plan_reason`, which
   * asks whose *ground* it is. Everything else — renaming, unpicking, walling,
   * flooring, adding a storey — was asked of nobody at all, so anybody could
   * rename or take apart anybody's building. `plan_fence` never reaches this
   * because it refuses outright on a tile that is part of a building.
   */
  if b.id is not null and p_action <> 'plan_building'
     and not building_yours(p_world, p_uid, b.id) then
    return 'That is not your building.';
  end if;
  -- Glass goes on a pitched roof and nowhere else, and no floor over a field (`glass_refusal`).
  v_glass := glass_refusal(p_world, p_uid, p_action, p_target);
  if v_glass is not null then return v_glass; end if;

  if p_action = 'plan_building' then
    return coalesce(need_tool(p_world, p_uid, 'mallet'), plan_reason(p_world, p_uid, tx, ty));

  elsif p_action = 'add_to_building' then
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    select * into b from building where world_id = p_world and id = neighbour_building(p_world, tx, ty);
    if not found then return 'There is no building next to this tile.'; end if;
    if b.levels > 1 then return 'The footprint cannot change once upper floors are planned.'; end if;
    return plan_reason(p_world, p_uid, tx, ty);

  elsif p_action = 'remove_from_plan' then
    if b.id is null then return 'No building here.'; end if;
    if b.levels > 1 then return 'Remove the upper floors first.'; end if;
    if tile_has_structures(p_world, tx, ty) then return 'Remove the walls and floor on this tile first.'; end if;
    return null;

  elsif p_action = 'rename_building' then
    if b.id is null then return 'No building here.'; end if;
    if nullif(btrim(coalesce(p_target->>'name', '')), '') is null then return 'Choose a name.'; end if;
    return null;

  elsif p_action = 'plan_wall' then
    if side is null or wt.id is null or mat.id is null then return 'Choose a side, a wall type and a material.'; end if;
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    if b.id is null then return 'No building here.'; end if;
    lvl := work_level(p_world, b.id);
    if lvl > 0 then
      select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
      if not found or not bill_done(f.needed) then return 'Build the floor of this storey first.'; end if;
    end if;
    if (wall_at(p_world, tx, ty, side)).world_id is not null then return 'There is already a wall on that side.'; end if;
    /*
     * And what is underneath has to carry it. The courses below are what hold
     * a wall up, and a beginner finds that out by being told rather than by
     * watching it come down.
     */
    bears := coalesce(bearing(p_world, b.id, lvl), 9);
    if mat.heft > bears then
      return mat.name || ' is too heavy to raise over what is under it. This storey carries '
          || heft_word(bears) || ', no more.';
    end if;
    return null;

  elsif p_action = 'plan_fence' then
    if side is null or wt.id is null or mat.id is null then return 'Choose a side, a kind and a material.'; end if;
    if not wt.standalone then return 'Only fences and half walls stand on their own.'; end if;
    tool := need_tool(p_world, p_uid, mat.tool);
    if tool is not null then return tool; end if;
    if b.id is not null then return 'That is part of a building: plan a wall instead.'; end if;
    select * into other from across(tx, ty, side);
    -- The border is shared, so the tile on the other side of it has a say.
    if building_at(p_world, other.x, other.y) is not null then return 'A building stands on the other side of that border.'; end if;
    if not in_bounds(p_world, other.x, other.y) then return 'That border is the edge of the world.'; end if;
    if has_water(p_world, tx, ty) or has_water(p_world, other.x, other.y) then return 'Fences do not stand in water.'; end if;
    if not passable(p_world, tx, ty) or not passable(p_world, other.x, other.y) then return 'There is no room for posts there.'; end if;
    if exists (select 1 from border_of(tx, ty, side) bd
               join wall w2 on w2.world_id = p_world and w2.level = 0
                 and w2.dir = bd.dir and w2.x = bd.x and w2.y = bd.y) then
      return 'There is already something on that border.';
    end if;
    return null;

  elsif p_action in ('build_wall', 'remove_wall') then
    if side is null then return 'Choose a side.'; end if;
    w := wall_at(p_world, tx, ty, side);
    if p_action = 'remove_wall' then
      return case when w.world_id is null then 'There is no wall there.' end;
    end if;
    if w.world_id is null then return 'There is no wall planned there.'; end if;
    if bill_done(w.needed) then return 'That wall is finished.'; end if;
    select * into mat from build_material_def where id = w.material;
    if mat.id is not null then
      tool := need_tool(p_world, p_uid, mat.tool);
      if tool is not null then return tool; end if;
    end if;
    if next_material(p_world, p_uid, w.material, w.needed, tx, ty) is null then
      return 'You need ' || bill_text(w.material, w.needed) || '.';
    end if;
    return null;

  elsif p_action = 'add_floor' then
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    if b.id is null then return 'No building here.'; end if;
    -- A Mason's Tall Walls: stone stands higher in a building they planned.
    if b.levels >= max_levels()::int + tall_of(p_world, b.id) then
      return 'Buildings cannot be taller than ' || (max_levels()::int + tall_of(p_world, b.id)) || ' storeys.';
    end if;
    /*
     * And no taller than what it is made of will stand. The shortest material
     * in the whole building answers, not the one you are standing on: a plank
     * wing joined to a stone tower caps the tower.
     */
    cap := storey_cap(p_world, b.id);
    if b.levels >= cap then
      worst := storey_capper(p_world, b.id);
      return coalesce(worst.name, 'What this is built of') || ' will not stand '
          || (cap + 1) || ' storeys. ' || cap || ' is as high as it goes.';
    end if;
    -- And the hands to raise it: ten a storey in the trade of the one below.
    under := storey_material(p_world, b.id, b.levels - 1);
    -- Past the tenth storey, which only Tall Walls reaches, a hundred is as much as there is.
    if under.id is not null and skill_of(p_world, p_uid, under.skill) < least(100, b.levels * storey_skill()) then
      return 'Raising a ' || (b.levels + 1) || nth(b.levels + 1) || ' storey over '
          || lower(under.name) || ' takes ' || under.skill || ' '
          || least(100, b.levels * storey_skill()) || '. You have '
          || to_char(skill_of(p_world, p_uid, under.skill), 'FM990.0') || '.';
    end if;
    if has_roof(p_world, b.id) then return 'Take the roof off first.'; end if;
    if has_low_wall(p_world, b.id, b.levels - 1) then
      return 'Nothing rests on a fence or a half wall. The storey below needs walls all round.';
    end if;
    v_gap := level_gap(p_world, b.id, b.levels - 1, p_uid);
    if v_gap is not null then return v_gap; end if;
    return null;

  elsif p_action = 'plan_floor' then
    if mat.id is null then return 'Choose a material.'; end if;
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    if b.id is null then return 'No building here.'; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := floor_level(p_world, b.id, kind);
    if kind = 'roof' then
      v_gap := level_gap(p_world, b.id, b.levels - 1, p_uid);
      if v_gap is not null then return v_gap; end if;
    elsif kind in ('stairs', 'ladder') then
      if lvl < 1 then return 'Stairs and ladders belong to an upper storey; plan another storey first.'; end if;
      if side is null then return 'Choose the side to climb from.'; end if;
      if lvl > 1 and not exists (select 1 from floor_tile where world_id = p_world
          and level = lvl - 1 and x = tx and y = ty) then
        return 'Plan the floor of the storey below first.';
      end if;
    end if;
    if exists (select 1 from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty) then
      return case when kind = 'roof' then 'There is already roof planned here.'
                  else 'There is already a floor planned here.' end;
    end if;
    return null;

  elsif p_action in ('build_floor', 'remove_floor') then
    if b.id is null then return case when p_action = 'build_floor'
      then 'There is nothing planned here.' else 'No building here.' end; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := floor_level(p_world, b.id, kind);
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if p_action = 'remove_floor' then
      if not found then return 'There is nothing here to remove.'; end if;
      if f.kind <> 'roof' and exists (
          select 1 from (values ('n'), ('e'), ('s'), ('w')) as s(side)
          cross join lateral border_of(tx, ty, s.side) bd
          join wall w2 on w2.world_id = p_world and w2.level = lvl
            and w2.dir = bd.dir and w2.x = bd.x and w2.y = bd.y) then
        return 'Take down the walls standing on it first.';
      end if;
      return null;
    end if;
    if not found then return 'There is nothing planned here.'; end if;
    if bill_done(f.needed) then return 'That is already finished.'; end if;
    select * into mat from build_material_def where id = f.material;
    tool := need_tool(p_world, p_uid, case when f.kind = 'ladder' then 'mallet' else mat.tool end);
    if tool is not null then return tool; end if;
    if next_material(p_world, p_uid, f.material, f.needed, tx, ty) is null then
      return 'You need ' || bill_text(f.material, f.needed) || '.';
    end if;
    return null;

  elsif p_action in ('paint_wall', 'strip_wall_paint') then
    if side is null then return 'Choose a side.'; end if;
    w := wall_at(p_world, tx, ty, side);
    if w.world_id is null then return 'There is no wall there.'; end if;
    if p_action = 'strip_wall_paint' then
      if w.dye is null then return 'It has taken no colour.'; end if;
      if pack_count(p_world, p_uid, 'lye_bucket') <= 0 then return 'You need a bucket of lye to scrub it back.'; end if;
      return null;
    end if;
    if not bill_done(w.needed) then return 'Finish it before you paint it.'; end if;
    pot := pick_dye(p_world, p_uid);
    if pot.id is null then return 'You have no dye. Boil one out of berries, acorns or herbs with a bucket of lye.'; end if;
    select * into colour from dye_def where name = pot.extra;
    if w.dye = colour.id then return 'It is ' || colour.word || ' already.'; end if;
    return null;

  elsif p_action = 'paint_floor' then
    if b.id is null then return 'There is no floor here.'; end if;
    lvl := work_level(p_world, b.id);
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found then return 'There is no floor here.'; end if;
    if not bill_done(f.needed) then return 'Finish it before you paint it.'; end if;
    pot := pick_dye(p_world, p_uid);
    if pot.id is null then return 'You have no dye. Boil one out of berries, acorns or herbs with a bucket of lye.'; end if;
    select * into colour from dye_def where name = pot.extra;
    if f.dye = colour.id then return 'It is ' || colour.word || ' already.'; end if;
    return null;

  /*
   * A Mason's Repoint, in the browser's words: a finished wall of stone, a
   * stone to lay it in that is not what it is, and everything to hand -- and
   * what is under it has to carry the new stone and the new stone what stands
   * on it, and stand as many storeys as the building has.
   */
  elsif p_action = 'repoint_wall' then
    if pk(p_world, p_uid, 'repoint', 0) <= 0 then return 'That wants a Mason who has learned to repoint.'; end if;
    if side is null then return 'Choose a side.'; end if;
    w := wall_at(p_world, tx, ty, side);
    if w.world_id is null then return 'There is no wall there.'; end if;
    select * into v_was from build_material_def where id = w.material;
    if v_was.kind is distinct from 'stone' then return 'Only a wall of stone is repointed.'; end if;
    if not bill_done(w.needed) then return 'Finish it before you repoint it.'; end if;
    if mat.id is null or mat.kind <> 'stone' then return 'Choose the stone to lay it in.'; end if;
    if mat.id = v_was.id then return 'It is ' || lower(mat.name) || ' already.'; end if;
    tool := need_tool(p_world, p_uid, mat.tool);
    if tool is not null then return tool; end if;
    if b.id is not null and w.building = b.id then
      bears := bearing(p_world, b.id, w.level);
      if mat.heft > bears then
        return mat.name || ' is too heavy to raise over what is under it. This storey carries '
            || heft_word(bears) || ', no more.';
      end if;
      select max(m2.heft) into v_over from wall w2 join build_material_def m2 on m2.id = w2.material
       where w2.world_id = p_world and w2.building = b.id and w2.level > w.level;
      if mat.heft < coalesce(v_over, 0) then
        return mat.name || ' will not carry the ' || heft_word(v_over) || ' standing on it.';
      end if;
      v_stands := mat.storeys + floor(pk(p_world, p_uid, 'storeys:' || build_work(mat.kind), 0))::int;
      if b.levels > v_stands then
        return mat.name || ' will not stand ' || b.levels || ' storeys. ' || v_stands || ' is as high as it goes.';
      end if;
    end if;
    v_bill := scaled_bill(mat.id, coalesce((select t2.factor::text::float8 from wall_type_def t2 where t2.id = w.type), 1));
    if exists (select 1 from jsonb_each_text(v_bill) e
                where build_to_hand(p_world, p_uid, e.key, tx, ty, mat.id) < e.value::int) then
      return 'You need ' || bill_text(mat.id, v_bill) || '.';
    end if;
    return null;

  elsif p_action = 'remove_storey' then
    if b.id is null or b.levels <= 1 then return 'There is no upper storey.'; end if;
    lvl := b.levels - 1;
    if has_roof(p_world, b.id) then return 'Take the roof off first.'; end if;
    if exists (select 1 from wall where world_id = p_world and building = b.id and level = lvl) then
      return 'Take down the walls of the top storey first.';
    end if;
    if exists (select 1 from floor_tile where world_id = p_world and building = b.id and level = lvl) then
      return 'Tear up the floors of the top storey first.';
    end if;
    return null;
  end if;
  return null;
end $function$;

/* ---- The ground read: a crop under glass, on the glass clock ---------------------------------- */

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
        'grown', crop_grown(c.glass, c.stage_at, v_field),
        'ago', extract(epoch from (now() - c.stage_at)),
        'tended', c.tended, 'tendedNow', c.tended_now, 'ql', c.ql, 'pace', c.pace)
        -- And a crop under glass says so, and `grown` is on the glass clock (`glasshouse.ts`).
        || case when c.glass then '{"glass": true}'::jsonb else '{}'::jsonb end)
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

/* ---- What Examine says of a glasshouse -------------------------------------------------------- */

/* Examine's line for a building: what a glasshouse is and does, and nothing for any other. The browser's `glassSays`. */
create or replace function glass_examine(p_world uuid, p_building integer) returns text language sql stable as $fn$
  select case when glasshouse(p_world, p_building) then glass_examine_said() else '' end
$fn$;

CREATE OR REPLACE FUNCTION public.examine_tile_text(p_world uuid, p_x integer, p_y integer, p_uid uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_t int; v_data int; v_out text; v_extra text := ''; b building; v_id int; n int; v_age tree_age_def;
begin
  v_t := land_tile(p_world, p_x, p_y);
  v_data := land_data(p_world, p_x, p_y);
  if v_t = 16 then
    select * into v_age from tree_age_def where id = tree_age(v_data);
    v_out := 'You see ' || an(lower(coalesce(v_age.name, 'young'))
      || ' ' || lower((select name from tree_def where id = tree_species(v_data))) || ' tree')
      || ' at (' || p_x || ', ' || p_y || ').';
    -- What is in it, what is coming for it, and what to do about that — the
    -- same words the browser uses, so a tree reads the same on both.
    if tree_cuts(p_world, p_x, p_y) > 0 then
      -- Of as many as the one looking would fell it in (a Forester's Heavy Swing).
      v_out := v_out || ' It has ' || tree_cuts(p_world, p_x, p_y) || ' of ' || tree_hits(p_world, p_uid, v_age.hits)
        || ' strokes in it.';
    end if;
    v_out := v_out || tree_outlook(p_world, v_age);
  elsif v_t = 17 then
    v_out := 'You see a ' || lower((select name from bush_def where id = bush_species(v_data)))
      || ' at (' || p_x || ', ' || p_y || ').';
  elsif v_t = tile_id('Stump') then
    v_out := 'You see the stump of ' || an(lower((select name from tree_def where id = tree_species(v_data))))
      || ' at (' || p_x || ', ' || p_y || '). Dig it out, or leave it a day.';
  else
    v_out := 'You see ' || lower((select name from tile_def where id = v_t))
      || ' at (' || p_x || ', ' || p_y || ').';
    if v_t = tile_id('Grass') and (v_data & 7) <> 0 then
      v_out := v_out || ' Kept cut: ' || ((v_data & 3) + case when (v_data & 4) <> 0 then 1 else 0 end) || ' of 3 days towards lawn.';
    end if;
  end if;
  -- What feet have done to it, and what is in flower on it: the browser's words (`groundSays`).
  v_out := v_out || ground_says(p_world, p_x, p_y);
  v_out := v_out || ' Height ' || to_char(centre_height(p_world, p_x, p_y), 'FM990.0')
    || ', slope ' || tile_slope(p_world, p_x, p_y) || '.';
  -- And for a Fisher with a Fishing Journal, what the water holds for them.
  if has_water(p_world, p_x, p_y) then
    v_out := v_out || ' Water laps over it.' || fish_journal(p_world, p_uid, p_x, p_y);
  end if;

  if is_token(p_world, p_x, p_y) then
    v_extra := v_extra || ' The settlement token of '
      || (deed_at(p_world, p_x, p_y)).name || ' stands here.';
  elsif on_deed(p_world, p_x, p_y) then
    v_extra := v_extra || ' This is part of ' || (deed_at(p_world, p_x, p_y)).name || '.';
  end if;
  v_id := building_at(p_world, p_x, p_y);
  if v_id is not null then
    select * into b from building where world_id = p_world and id = v_id;
    if found then
      v_extra := v_extra || ' It belongs to ' || b.name || ', '
        || case when b.levels = 1 then 'a single-storey building'
                else b.levels || ' storeys tall' end || '.';
      -- And a glasshouse says what it is for (`glass_examine`).
      v_extra := v_extra || glass_examine(p_world, b.id);
    end if;
  end if;
  select count(*) into n from crate c where c.world_id = p_world
    and p_x between c.x and c.x + c.sx - 1 and p_y between c.y and c.y + c.sy - 1;
  if n = 1 then v_extra := v_extra || ' A crate stands here.';
  elsif n > 1 then v_extra := v_extra || ' ' || n || ' crates stand here.'; end if;
  return v_out || v_extra;
end $function$;

select private.lock_doors();
