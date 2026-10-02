-- Shop counters and lantern posts.
--
-- **A shop counter** is a wall type (`counter`, in the definitions): planned,
-- built, painted and repointed as any wall is, on the ground floor of a
-- building and on its outline, with open ground on the far side -- the street
-- it sells to. What makes it a counter is the store behind it: a `placed` row
-- of kind 'counter', keyed by the building tile it is set in (`x`, `y`) and
-- the side of that tile (`sub`), opened as the wall is finished
-- (`counter_finished`) and gone with it (`counter_gone`). It holds its goods
-- as items with `holder` 'counter' and `placed` its id, its till in `till`,
-- and whoever planned the counter in `made_by`: a market stall's row, keyed to
-- a wall. It stands on no subtile (`sx`, `sy` are off the grid), so it is in
-- nobody's way, and it is reached from the middle of its border (`cx`, `cy`).
--
-- The stall's doors answer for both, off one set of questions rather than a
-- copy of each: `sells` (a stall, or a counter's store), `sells_word` (which
-- of the two, for the sentences) and `sells_reach_refusal` (where it is
-- reached from, and for a counter's buyer, that they are out in its street).
-- `rpc_price`, `rpc_buy`, `rpc_takings` and `rpc_market` ask those. Goods go
-- out on a counter and come back off it through two jobs of its own
-- (`set_out_goods`, `take_off_counter`), its keeper's alone, rather than
-- through the furniture's `store_in_furniture` and `take_from_store`: those
-- find their store among `placed` rows of kind 'furniture' and ask its
-- `furniture_def` what it takes and how much and its padlock, none of which a
-- wall has, and the counter's goods are held as 'counter' so that nothing
-- that works over a piece's holdings -- its count, Take everything, a
-- worker's load put away, the ground read's contents -- ever meets them
-- (`counters.ts` says the same at its two doors). A counter finished by a
-- hod worker opens its store as one finished by hand does (`errand_do`).
-- Nobody walks through it (`wall_type_def.passable`), and the eye goes over it.
--
-- **Lantern posts.** Two pieces a lantern is fitted to (`lamp_kind`): a post
-- it hangs off and a pillar it stands in. The lantern goes into the piece --
-- `state -> lamp` keeps its quality, rarity, damage and maker -- and its candle
-- is the piece's `fuel`, burning a second a second while it is `lit`, as every
-- fire here is worked out (`placed_fuel`, `placed_lit`). It takes a candle, is
-- lit at a flame and put out as a carried lantern is, and throws that
-- lantern's reach for everybody; the browser draws and sees by it. A
-- padlock on the piece keeps its lantern: fitting one, taking it down, a
-- candle and putting it out are the key's, lighting it anybody's. A post is
-- not set down with its arm into a wall, a quarter turn takes it on round
-- past such a facing (`lamp_arm_refusal`, `lamp_turns_to`), and no wall is
-- planned or raised across a standing post's arm (`lamp_wall_refusal`).
--
-- A carried lantern's two refusals are said off the definitions now, as the
-- post's are: what a candle is drawn from, off its recipe, and every burning
-- thing a light is taken off, off what `flame_near` looks for.
--
-- And `candle_burn`, which had never had the world's pace in it: a candle
-- burned two and a half times faster here than in the browser. It reads the
-- browser's own figure now (`candle_burn_full`, from the definitions).


/* ---- a candle ---------------------------------------------------------------- */

/** How long a candle lasts in a lantern of this quality: the browser's `candleBurn`, off its own figure. */
create or replace function candle_burn(p_ql double precision) returns double precision
  language sql immutable as $$ select candle_burn_full() * (0.7 + least(100, greatest(1, p_ql)) / 160) $$;

/* ---- a shop counter ---------------------------------------------------------- */

/** Which building tile, and which side of it, a wall is set in: the one of the two either side that is its building's. */
create or replace function counter_seat(w wall) returns table (x int, y int, side text)
language sql stable as $$
  select case when w.dir = 'v' and building_at(w.world_id, w.x, w.y) is distinct from w.building then w.x - 1 else w.x end,
         case when w.dir = 'h' and building_at(w.world_id, w.x, w.y) is distinct from w.building then w.y - 1 else w.y end,
         case when building_at(w.world_id, w.x, w.y) is not distinct from w.building
              then case when w.dir = 'h' then 'n' else 'w' end
              else case when w.dir = 'h' then 's' else 'e' end end
$$;

/** Where a counter is reached from: the middle of its border. */
create or replace function counter_middle_x(p_x int, p_side text) returns double precision
  language sql immutable as $$ select case p_side when 'w' then p_x::double precision when 'e' then p_x + 1.0 else p_x + 0.5 end $$;
create or replace function counter_middle_y(p_y int, p_side text) returns double precision
  language sql immutable as $$ select case p_side when 'n' then p_y::double precision when 's' then p_y + 1.0 else p_y + 0.5 end $$;

/** The store behind a counter wall, if it has one. */
create or replace function counter_behind(p_world uuid, w wall) returns placed
language sql stable as $$
  select pl.* from counter_seat(w) s
  join placed pl on pl.world_id = p_world and pl.kind = 'counter' and pl.x = s.x and pl.y = s.y and pl.sub = s.side
  limit 1
$$;

/** Whether a store still stands behind a finished counter: goods go out on it, come off it and are sold from it only then. */
create or replace function counter_standing(p placed) returns boolean
language sql stable as $$
  select p.kind = 'counter' and exists (
    select 1 from border_of(p.x, p.y, p.sub) bd
    join wall w on w.world_id = p.world_id and w.level = 0 and w.dir = bd.dir and w.x = bd.x and w.y = bd.y
    where w.type = 'counter' and bill_done(w.needed))
$$;

/**
 * A counter finished: its store opens behind it, kept by whoever planned it.
 * Asked by `perform_building` as the last of a wall's bill goes in.
 */
create or replace function counter_finished(p_world uuid, w wall) returns void
language plpgsql as $$
declare s record;
begin
  if w.type <> 'counter' or w.level <> 0 then return; end if;
  select * into s from counter_seat(w);
  if exists (select 1 from placed where world_id = p_world and kind = 'counter'
               and x = s.x and y = s.y and sub = s.side) then return; end if;
  insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, made_by)
  values (p_world, 'counter', s.side, s.x, s.y, -10, -10,
          counter_middle_x(s.x, s.side), counter_middle_y(s.y, s.side), w.planned_by);
end $$;

/** And gone with its wall, which `counter_remove_refusal` has already seen empty. */
create or replace function counter_gone(p_world uuid, w wall) returns void
language plpgsql as $$
begin
  if w.type <> 'counter' then return; end if;
  delete from placed where id = (counter_behind(p_world, w)).id;
end $$;

/** How many things are on a counter. */
create or replace function counter_units(c placed) returns int
language sql stable as $$
  select coalesce(sum(i.count), 0)::int from item i where i.placed = c.id and i.holder = 'counter'
$$;

/** Why a counter will not go on this side of this tile, or null: the browser's `counterPlanRefusal`. */
create or replace function counter_plan_refusal(p_world uuid, p_lvl int, p_x int, p_y int, p_side text) returns text
language sql stable as $$
  select case when p_lvl > 0 then counter_ground_said()
              when (select building_at(p_world, a.x, a.y) from across(p_x, p_y, p_side) a) is not null
                then counter_street_only_said() end
$$;

/**
 * Why a tile will not go into a building, or null: a shop counter on one of its
 * borders, planned or built, sells onto it. The browser's `counterStreetRefusal`.
 */
create or replace function counter_street_refusal(p_world uuid, p_x int, p_y int) returns text
language sql stable as $$
  select case when exists (
      select 1 from unnest(array['n', 'e', 's', 'w']) s(side), border_of(p_x, p_y, s.side) bd
      join wall w on w.world_id = p_world and w.level = 0 and w.dir = bd.dir and w.x = bd.x and w.y = bd.y
      where w.type = 'counter')
    then counter_street_taken_said() end
$$;

/** Why a wall will not come down while it is a counter with goods on it or silver in its till, or null. */
create or replace function counter_remove_refusal(p_world uuid, w wall) returns text
language sql stable as $$
  select case when w.type = 'counter' and exists (
      select 1 from counter_behind(p_world, w) pl
      where pl.id is not null and (coalesce(pl.till, 0) > 0 or counter_units(pl) > 0))
    then counter_empty_first_said() end
$$;

/** Whether a point is on a counter's street side: past the line of its wall, away from the house. */
create or replace function counter_street_side(p placed, p_x double precision, p_y double precision) returns boolean
language sql immutable as $$
  select case p.sub when 'n' then p_y < p.y when 's' then p_y >= p.y + 1
                    when 'w' then p_x < p.x else p_x >= p.x + 1 end
$$;

/* ---- what sells: a stall, and a counter's store --------------------------------- */

/** Whether a placed thing sells: a market stall, or the store behind a shop counter. */
create or replace function sells(p placed) returns boolean
language sql stable as $$
  select p.kind = 'counter'
      or (p.kind = 'furniture' and coalesce((select f.stall from furniture_def f where f.id = p.sub), false))
$$;

/** Which of the two it is, for the sentences both say. */
create or replace function sells_word(p placed) returns text
  language sql immutable as $$ select case when p.kind = 'counter' then 'counter' else 'stall' end $$;

/**
 * Why somebody at (x, y) cannot reach a stall or a counter, or null: too far
 * from it -- a stall's tile's middle, as it always was, or a counter's
 * border's -- or, buying from a counter (`p_street`), not out in its street:
 * on the house's side of the wall's line, or inside any building at all, the
 * keeper's own other rooms and the house next door among them. The browser's
 * `counterReach`.
 */
create or replace function sells_reach_refusal(p placed, p_x double precision, p_y double precision, p_street boolean) returns text
language sql stable as $$
  select case
    when greatest(abs(case when p.kind = 'counter' then p.cx else p.x + 0.5 end - p_x),
                  abs(case when p.kind = 'counter' then p.cy else p.y + 0.5 end - p_y)) > counter_reach()
      then sells_too_far_said(sells_word(p))
    when p_street and p.kind = 'counter'
         and (not counter_street_side(p, p_x, p_y) or building_at(p.world_id, floor(p_x)::int, floor(p_y)::int) is not null)
      then counter_from_street_said()
  end
$$;

/* ---- setting goods out, and taking them back ------------------------------------- */

create or replace function counter_action(p_action text) returns boolean
  language sql immutable as $$ select p_action in ('set_out_goods', 'take_off_counter') $$;

/** The counter goods are going out on: the one the ask names, or the nearest of yours in reach. */
create or replace function counter_into(p_world uuid, p_uid uuid, p_target jsonb) returns placed
language sql stable as $$
  select pl.* from placed pl join player p on p.world_id = pl.world_id and p.uid = p_uid
   where pl.world_id = p_world and pl.kind = 'counter'
     and case when nullif(p_target->>'into', '') is not null then pl.id = (p_target->>'into')::bigint
              else pl.made_by = p_uid and counter_standing(pl)
                   and greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)) <= counter_reach() end
   order by greatest(abs(pl.cx - p.x), abs(pl.cy - p.y)), pl.id
   limit 1
$$;

/** Why goods cannot go out on a counter or come back off it, or null: the browser's `setOutRefusal` and `takeBackRefusal`. */
create or replace function counter_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns text
language plpgsql stable as $$
declare p player; it item; c placed; v_why text;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if p_action = 'set_out_goods' then
    select * into it from item where world_id = p_world and id = target_item(p_target)
      and holder = 'player' and holder_uid = p_uid;
    if not found then return 'It is gone.'; end if;
    c := counter_into(p_world, p_uid, p_target);
    if c.id is null or not counter_standing(c) then return 'Stand at a counter of yours.'; end if;
    if c.made_by is distinct from p_uid then return counter_not_keeper_said(); end if;
    v_why := sells_reach_refusal(c, p.x, p.y, false);
    if v_why is not null then return v_why; end if;
    if it.def <> 'creature_crate' and exists (select 1 from furniture_def f where f.id = it.def) then
      return counter_no_pieces_said();
    end if;
    if counter_units(c) >= counter_holds() then return counter_full_said(); end if;
    return null;
  elsif p_action = 'take_off_counter' then
    select * into it from item where world_id = p_world and id = target_item(p_target) and holder = 'counter';
    if not found then return 'It is gone.'; end if;
    select * into c from placed where world_id = p_world and id = it.placed;
    if not found or not counter_standing(c) then return 'It is gone.'; end if;
    if c.made_by is distinct from p_uid then return counter_bought_said(); end if;
    return sells_reach_refusal(c, p.x, p.y, false);
  end if;
  return null;
end $$;

/** What is said as goods go out on a counter and come back off it: the browser's `setOutLine` and `takeBackLine`. */
create or replace function set_out_line(p_count int, p_what text, p_left int) returns text
language sql immutable as $$
  select 'You set ' || case when p_count > 1 then p_count || ' × ' else 'the ' end || lower(p_what) || ' out on the counter.'
      || case when p_left > 0 then ' The other ' || p_left || ' would not fit.' else '' end
$$;
create or replace function take_back_line(p_count int, p_what text) returns text
language sql immutable as $$
  select 'You take ' || case when p_count > 1 then p_count || ' × ' else 'the ' end || lower(p_what) || ' back off the counter.'
$$;

create or replace function perform_counter(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns void
language plpgsql as $$
declare it item; c placed; v_want int; v_fits int; v_name text;
begin
  if p_action = 'set_out_goods' then
    select * into it from item where world_id = p_world and id = target_item(p_target)
      and holder = 'player' and holder_uid = p_uid for update;
    if not found then return; end if;
    c := counter_into(p_world, p_uid, p_target);
    if c.id is null then return; end if;
    v_want := greatest(1, least(it.count, coalesce((p_target->>'count')::int, 1)));
    v_fits := least(v_want, greatest(0, counter_holds()::int - counter_units(c)));
    if v_fits <= 0 then return; end if;
    v_name := item_name(it);
    perform move_part(it.id, v_fits, 'counter', null, null, c.id);
    perform tell(p_world, p_uid, set_out_line(v_fits, v_name, v_want - v_fits), 'event');
  elsif p_action = 'take_off_counter' then
    select * into it from item where world_id = p_world and id = target_item(p_target) and holder = 'counter' for update;
    if not found then return; end if;
    v_want := greatest(1, least(it.count, coalesce((p_target->>'count')::int, it.count)));
    v_name := item_name(it);
    perform move_part(it.id, v_want, 'player', p_uid, null, null);
    perform tell(p_world, p_uid, take_back_line(v_want, v_name), 'event');
  end if;
end $$;

/**
 * What a ground read says of a counter's store beside its row: whose it is,
 * its till to its keeper alone, how many things are on it and a few of their
 * kinds for anybody drawing it, and within reach what is on it and at what
 * price. Only for a counter still standing; one whose wall is gone says it
 * holds nothing.
 */
create or replace function counter_json(pl placed, p_me uuid, p_x double precision, p_y double precision) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'keeper', folk_name(pl.world_id, pl.made_by),
    'till', case when pl.made_by = p_me then coalesce(pl.till, 0) end,
    'units', counter_units(pl),
    'wares', coalesce((select jsonb_agg(w.def order by w.first)
                         from (select i.def, min(i.id) as first from item i
                                where i.placed = pl.id and i.holder = 'counter'
                                group by i.def order by min(i.id) limit 6) w), '[]'::jsonb),
    'goods', case when greatest(abs(pl.cx - p_x), abs(pl.cy - p_y)) <= counter_seen()
      then coalesce((select jsonb_agg(jsonb_build_object(
             'id', i.id, 'def', i.def, 'ql', i.ql, 'dmg', i.dmg, 'count', i.count, 'extra', i.extra,
             'rare', i.rare, 'price', i.price, 'creature', i.creature) order by i.id)
           from item i where i.placed = pl.id and i.holder = 'counter'), '[]'::jsonb)
      else '[]'::jsonb end)
$$;

/* ---- a lantern post ------------------------------------------------------------ */

create or replace function lamp_action(p_action text) returns boolean
  language sql immutable as $$ select p_action in ('fit_lamp', 'take_lamp', 'candle_lamp', 'light_lamp', 'douse_lamp') $$;

/** The lantern a fitting takes: the one the ask names, or the best in the pack. A locked one never goes. */
create or replace function lamp_lantern(p_world uuid, p_uid uuid, p_target jsonb) returns item
language sql stable as $$
  select i.* from item i
   where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'lantern' and not i.locked
     and (nullif(p_target->>'itemUid', '') is null or i.id = (p_target->>'itemUid')::bigint)
   order by i.ql desc, i.id
   limit 1
$$;

/**
 * Why a lamp job cannot be done now, or null: the browser's `lampRefusal`,
 * question for question. A padlock keeps the lantern for the key, all but
 * the striking of a light, which is anybody's.
 */
create or replace function lamp_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns text
language plpgsql stable as $$
declare p placed; v_shut text;
begin
  select * into p from placed where world_id = p_world and id = nullif(p_target->>'id', '')::bigint and kind = 'furniture';
  if not found or lamp_kind(p.sub) is null then return 'It is gone.'; end if;
  if not placed_in_reach(p_world, p_uid, p.id) then
    return lamp_too_far_said(lower((select f.name from furniture_def f where f.id = p.sub)));
  end if;
  if p_action <> 'light_lamp' then
    v_shut := lock_refusal(p_world, p_uid, p.lock, p.x, p.y);
    if v_shut is not null then return v_shut; end if;
  end if;
  if p_action = 'fit_lamp' then
    if p.state ? 'lamp' then return lamp_has_one_said(); end if;
    if (lamp_lantern(p_world, p_uid, p_target)).id is null then return lamp_no_lantern_said(); end if;
  elsif p_action = 'take_lamp' then
    if not p.state ? 'lamp' then return lamp_none_said(); end if;
  elsif p_action = 'candle_lamp' then
    if not p.state ? 'lamp' then return lamp_none_said(); end if;
    if placed_fuel(p) > 0 then return 'There is still a candle in it.'; end if;
    if pack_count(p_world, p_uid, 'candle') < 1 then return no_candle_said(); end if;
  elsif p_action = 'light_lamp' then
    if not p.state ? 'lamp' then return lamp_none_said(); end if;
    if placed_fuel(p) <= 0 then return 'There is no candle in it.'; end if;
    if placed_lit(p) then return 'It is already lit.'; end if;
    if flame_near(p_world, p_uid) is null then return no_flame_said(); end if;
  elsif p_action = 'douse_lamp' then
    if not (p.state ? 'lamp' and placed_lit(p)) then return 'It is not lit.'; end if;
  end if;
  return null;
end $$;

/**
 * A lantern post is not lifted with its lantern in it (the browser's
 * `LAMP_TAKE_FIRST`), and a padlocked one is not lifted at all without its
 * key, which is asked first: the lock is the answer, not the lantern.
 */
create or replace function lamp_lift_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns text
language sql stable as $$
  select coalesce(lock_refusal(p_world, p_uid, pl.lock, pl.x, pl.y), lamp_take_first_said())
    from placed pl
   where p_action = 'pick_up_furniture' and pl.world_id = p_world and pl.id = nullif(p_target->>'id', '')::bigint
     and pl.kind = 'furniture' and lamp_kind(pl.sub) is not null and pl.state ? 'lamp'
$$;

/**
 * Whether a post with its block's corner at subtile (sx, sy) of tile (x, y),
 * facing this way, reaches its arm and lantern across the border on that
 * side: the lantern's far side (`lamp_arm_reach` from its middle) passes
 * where the face of a wall on it would be. The browser's `lampArmPasses`.
 */
create or replace function lamp_arm_passes(p_sub text, p_x int, p_y int, p_sx int, p_sy int, p_facing text) returns boolean
language sql stable as $$
  select coalesce(lamp_kind(p_sub) = 'arm'
    and case p_facing
          when 'n' then p_y + (p_sy + (placed_size('furniture', p_sub, p_facing))[2] / 2.0) / subtiles() - lamp_arm_reach() < p_y + wall_half_thick()
          when 's' then p_y + (p_sy + (placed_size('furniture', p_sub, p_facing))[2] / 2.0) / subtiles() + lamp_arm_reach() > p_y + 1 - wall_half_thick()
          when 'w' then p_x + (p_sx + (placed_size('furniture', p_sub, p_facing))[1] / 2.0) / subtiles() - lamp_arm_reach() < p_x + wall_half_thick()
          else p_x + (p_sx + (placed_size('furniture', p_sub, p_facing))[1] / 2.0) / subtiles() + lamp_arm_reach() > p_x + 1 - wall_half_thick() end, false)
$$;

/**
 * Why a post will not stand facing this way, or null: its arm and the lantern
 * on it would go into a wall on the border it reaches toward. A waist-high
 * wall or a fence stays under the arm. The browser's `lampArmRefusal`.
 */
create or replace function lamp_arm_refusal(p_world uuid, p_sub text, p_x int, p_y int, p_sx int, p_sy int, p_facing text) returns text
language sql stable as $$
  select case when lamp_arm_passes(p_sub, p_x, p_y, p_sx, p_sy, p_facing)
    and exists (select 1 from border_of(p_x, p_y, p_facing) bd
                join wall w on w.world_id = p_world and w.level = 0 and w.dir = bd.dir and w.x = bd.x and w.y = bd.y
                join wall_type_def t on t.id = w.type
               where not coalesce(t.low, false))
    then lamp_into_wall_said() end
$$;

/**
 * Why a full-height wall will not be planned or raised on this side of this
 * tile, or null: a lantern post standing on either tile beside the border
 * reaches its arm across it, and the wall would close over the arm and its
 * lantern. The browser's `lampWallRefusal`.
 */
create or replace function lamp_wall_refusal(p_world uuid, p_lvl int, p_x int, p_y int, p_side text, p_type text) returns text
language sql stable as $$
  select case when p_lvl = 0 and not coalesce((select t.low from wall_type_def t where t.id = p_type), false)
    and exists (
      select 1 from (select p_x as x, p_y as y, p_side as facing
                     union all
                     select a.x, a.y, case p_side when 'n' then 's' when 's' then 'n' when 'e' then 'w' else 'e' end
                       from across(p_x, p_y, p_side) a) s
      join placed pl on pl.world_id = p_world and pl.kind = 'furniture' and pl.x = s.x and pl.y = s.y
                     and coalesce(pl.facing, 's') = s.facing
      where lamp_arm_passes(pl.sub, pl.x, pl.y, pl.sx, pl.sy, s.facing))
    then lamp_arm_crosses_said() end
$$;

/**
 * Which way a piece faces after a quarter turn to the right: a post goes on
 * round past any facing that would put its arm into a wall, rather than the
 * turn being refused, which would leave a post with a wall on its right that
 * could never be turned again. The browser's `lampTurnsTo`.
 */
create or replace function lamp_turns_to(p_world uuid, p placed) returns text
language plpgsql stable as $$
declare f text := turned_facing(p.facing, 1);
begin
  for i in 1 .. 3 loop
    exit when lamp_arm_refusal(p_world, p.sub, p.x, p.y, p.sx, p.sy, f) is null;
    f := turned_facing(f, 1);
  end loop;
  return f;
end $$;

create or replace function perform_lamp(p_world uuid, p_uid uuid, p_action text, p_target jsonb) returns void
language plpgsql as $$
declare p placed; it item; v_left double precision; v_word text; v_lamp jsonb; v_made bigint; v_from text;
begin
  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint for update;
  if not found or lamp_kind(p.sub) is null then return; end if;
  v_word := lower((select f.name from furniture_def f where f.id = p.sub));
  v_lamp := p.state->'lamp';
  if p_action = 'fit_lamp' then
    it := lamp_lantern(p_world, p_uid, p_target);
    if it.id is null then return; end if;
    v_left := candle_left(it);
    update placed set state = coalesce(state, '{}'::jsonb) || jsonb_build_object('lamp', jsonb_strip_nulls(jsonb_build_object(
             'ql', it.ql, 'dmg', nullif(it.dmg, 0), 'rare', it.rare, 'maker', it.maker))),
           fuel = v_left, lit = it.lit and v_left > 0, since = now()
     where id = p.id returning * into p;
    delete from item where id = it.id;
    perform tell(p_world, p_uid, 'You fit the lantern to the ' || v_word || '. It throws '
      || lantern_reach(it.ql) || ' tiles, and has '
      || case when v_left > 0 then time_words(v_left) || ' of candle in it' || case when p.lit then ', alight' else '' end || '.'
              else 'no candle in it.' end, 'event');
  elsif p_action = 'take_lamp' then
    if v_lamp is null then return; end if;
    v_left := greatest(0, round(placed_fuel(p)));
    v_made := give(p_world, p_uid, 'lantern', 1, (v_lamp->>'ql')::double precision, null, v_lamp->>'rare', v_lamp->>'maker');
    update item set dmg = coalesce((v_lamp->>'dmg')::real, 0), charges = v_left::int,
           lit = placed_lit(p) and v_left > 0, lit_at = case when placed_lit(p) and v_left > 0 then now() end
     where id = v_made;
    update placed set state = state - 'lamp', fuel = 0, lit = false, since = now() where id = p.id;
    perform tell(p_world, p_uid, 'You take the lantern down off the ' || v_word || '.', 'event');
  elsif p_action = 'candle_lamp' then
    if v_lamp is null or not consume(p_world, p_uid, 'candle', 1) then return; end if;
    v_left := round(candle_burn((v_lamp->>'ql')::double precision));
    update placed set fuel = v_left, lit = false, since = now() where id = p.id;
    perform tell(p_world, p_uid, 'You set a candle in the lantern on the ' || v_word || '. It will burn '
      || time_words(v_left) || '.', 'event');
  elsif p_action = 'light_lamp' then
    if v_lamp is null then return; end if;
    v_from := coalesce(flame_near(p_world, p_uid), 'fire');
    update placed set fuel = placed_fuel(p), lit = true, since = now() where id = p.id;
    perform tell(p_world, p_uid, 'You take a light off the ' || v_from || ' and the lantern on the ' || v_word
      || ' throws it ' || lantern_reach((v_lamp->>'ql')::double precision) || ' tiles.', 'event');
  elsif p_action = 'douse_lamp' then
    v_left := placed_fuel(p);
    update placed set fuel = v_left, lit = false, since = now() where id = p.id;
    perform tell(p_world, p_uid, 'You pinch the wick out. ' || time_words(greatest(0, v_left)) || ' of candle saved.', 'event');
  end if;
end $$;

/* ---- the shared functions, each with its few lines ------------------------------- */

CREATE OR REPLACE FUNCTION public.act_refusal_rules(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare d action_def; p player; cx int; cy int; tx int; ty int; t tile_def; aimed text;
begin
  select * into d from action_def where id = p_action;
  if not found then return 'There is no such thing as ' || p_action || '.'; end if;
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 'You are not on this island.'; end if;
  -- Deliberately not "are you busy": asked of queued jobs too. That is rpc_act's.
  if not act_ported(p_action) then
    return 'You cannot ' || lower(d.label) || ' on this island yet.';
  end if;

  -- A crate with a wildermon in it is carried, set down or opened, and that is all.
  aimed := occupied_crate_refusal(p_world, p_uid, p_action, p_target);
  if aimed is not null then return aimed; end if;
  aimed := p_target->>'kind';
  -- Whose ground it is, before anything about what it is made of.
  aimed := ground_deed_refusal(p_world, p_uid, p_action, p_target);
  if aimed is not null then return aimed; end if;
  aimed := p_target->>'kind';
  -- Shop counters and lantern posts (`counters.ts`, `lamps.ts`), and a lantern post lifted with its lantern in it.
  if counter_action(p_action) then return counter_refusal(p_world, p_uid, p_action, p_target); end if;
  if lamp_action(p_action) then return lamp_refusal(p_world, p_uid, p_action, p_target); end if;
  if lamp_lift_refusal(p_world, p_uid, p_action, p_target) is not null then return lamp_lift_refusal(p_world, p_uid, p_action, p_target); end if;
  -- The hour comes for a dam in young whoever is or is not standing there, and
  -- somebody is always about to do something. This is where they find out.
  perform herd_settle(p_world);
  -- A spring answers for its own reach, its own tool and whose spring it is.
  if spring_action(p_action) then
    return spring_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- And wildflowers for their own reach, their season and whether they are picked.
  if flower_action(p_action) then
    return flower_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Ivy and moss answer for their own reach: a statue and a bridge are not tiles.
  if green_action(p_action) then
    return green_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Stepping stones and water plants answer for their own reach, as a spring does.
  if water_garden_action(p_action) then
    return water_garden_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- The last ten answer for their own reach, every one of them: a bridge is
  -- worked from either bank, a bed is furniture, and a beast is not at a tile.
  -- First of all, because a map is an item and every other family that takes
  -- an item wants one it can name a use for. This one is aimed at the map.
  if treasure_action(p_action) then
    return treasure_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if last_action(p_action) then
    return last_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Then the only family that does not care what it is
  -- pointed at: a prayer wants an altar, a cast wants a name, and the other
  -- three want nothing but the ground you are sitting on.
  if faith_action(p_action) then
    return faith_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Then the ones asked of a beast, which is not at a
  -- tile, and half of a cart, which is furniture and would otherwise be handed
  -- to the code that lights fires. Both answer for their own reach.
  if ride_action(p_action) then
    return ride_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if hands_action(p_action) then
    return hands_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Before the one that lights fires, which is what pointing at furniture has
  -- meant up to now: a barrel is furniture too, and tipping it out is not a fire.
  if liquid_action(p_action) then
    return liquid_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Also before the one that lights fires: an oven is furniture and an anvil
  -- is pointed at the same way a kiln is, and neither wants that route.
  if forge_action(p_action) then
    return forge_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if holding_action(p_action) then
    return holding_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- The token is under your feet and a post answers for its own reach, so
  -- neither wants the reach check below.
  if settlement_action(p_action) then
    return settlement_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if dig_action(p_action) then
    return dig_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A trap answers for its own reach, and rolls itself forward before it
  -- answers anything at all.
  if trap_action(p_action) then
    return trap_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Working the ground answers for its own reach for the same reason: a
  -- corner is a place rather than a thing, and `drop_dirt` names one.
  if ground_action(p_action) then
    if not in_reach(p.x, p.y, p_target, d.corner, d.range) then return 'You are too far away from that.'; end if;
    if d.tool is not null and tool_ql(p_world, p_uid, d.tool) <= 0 then
      return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || ' to ' || lower(d.label) || '.';
    end if;
    return ground_refusal(p_world, p_uid, p_action, p_target);
  end if;
  /*
   * A furnace is brought up to date before anything asks it a question: its
   * fire and its queue together, so that "is anything finished" is answered
   * about now rather than about whenever somebody last stood here.
   */
  if aimed in ('smelter', 'kiln') then
    perform furnace_settle(p_world, nullif(p_target->>'id', '')::bigint);
  end if;
  if item_action(p_action) then
    return item_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if firing_action(p_action) then
    return firing_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if aimed in ('campfire', 'smelter', 'kiln', 'furniture', 'anvil') or fire_action(p_action) then
    return fire_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A crate is reached for rather than stood in front of, so it answers for
  -- its own reach the way the creatures do.
  if crate_action(p_action) then
    return crate_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- Fitting a padlock and taking one off: aimed at a crate or at a piece of
  -- furniture, so it sits beside the family that answers for crates.
  if p_action in ('fit_lock', 'take_off_lock') then
    return lock_refusal_for(p_world, p_uid, p_action, p_target);
  end if;
  -- The stake is in your hand and the ground is under your feet: nothing to reach for.
  if p_action = 'found_settlement' then
    return deed_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A creature is not at a tile, it is wherever its last leg left it, so the
  -- reach check below cannot answer for it. Both of these do their own; the
  -- fighting ones reach as far as what is in your hand, which is further.
  if creature_action(p_action) then
    return creature_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if fight_action(p_action) then
    return fight_refusal(p_world, p_uid, p_action, p_target);
  end if;
  -- A line and a net reach as far as their Fisher casts and drags them (a Long Cast, a Wide Net).
  if not in_reach(p.x, p.y, p_target, d.corner, case p_action when 'fish' then cast_reach(p_world, p_uid)::real
                                                                when 'drag_net' then net_reach(p_world, p_uid)::real
                                                                else d.range end) then
    return 'You are too far away from that.';
  end if;
  if d.tool is not null and tool_ql(p_world, p_uid, d.tool) <= 0 then
    return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || ' to ' || lower(d.label) || '.';
  end if;
  if foundation_action(p_action) then
    return foundation_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if build_action(p_action) then
    return build_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('mine', 'chip_corner', 'pack', 'cultivate', 'pave_cobble', 'drop_dirt_here') then
    return terrain_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('cut_down', 'forage', 'botanize', 'collect') then
    return gather_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if farm_action(p_action) then
    return farm_refusal(p_world, p_uid, p_action, p_target);
  end if;
  if p_action in ('fish', 'drag_net') then
    return fish_refusal(p_world, p_uid, p_action, p_target);
  end if;

  if exists (select 1 from recipe where id = p_action) then
    return craft_refusal(p_world, p_uid, p_action, target_item(p_target));
  end if;

  if p_action = 'dig' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    if t.dig_yield is null then return 'You cannot dig that.'; end if;
    /*
     * The same depth a pick works to. This was the exact line `terrain_refusal`
     * condemns in its own comment — `<= 0` refuses a corner standing at the
     * waterline, where no water is drawn — and mining was fixed for it while
     * digging was left with it.
     */
    -- Deeper for a Terraformer who wades.
    if land_height(p_world, cx, cy) < -pk(p.class_mul, 'depth:dig', mine_depth()) then
      return 'The water is too deep here to work in.';
    end if;
    if land_dirt(p_world, cx, cy) <= 0 then
      return 'That corner is bare rock. Only a pickaxe will take it lower.';
    end if;
    return coalesce(level_stop(p_world, p_uid, cx, cy, -1),
                    slope_refusal(p_world, p_uid, 'digging', cx, cy, -1));
  end if;
  -- A Miner's Pan: sand with water at one of its corners, and the perk to work it.
  if p_action = 'pan' then
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    if pk(p.class_mul, 'pan', 0) <= 0 then
      return 'That wants a Miner who has learned to pan.';
    end if;
    if land_tile(p_world, tx, ty) <> tile_id('Sand') then return 'Panning is done on sand.'; end if;
    if not exists (select 1 from tile_corners(tx, ty) c where land_height(p_world, c.cx, c.cy) < 0) then
      return 'There is no water at this sand to wash it in.';
    end if;
    return null;
  end if;
  -- A Terraformer's Dig out the tile: every corner of it asked what a dig asks.
  if p_action = 'dig_tile' then
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    if pk(p.class_mul, 'dig_tile', 0) <= 0 then
      return 'That wants a Terraformer who has learned to dig out a whole tile.';
    end if;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    if t.dig_yield is null then return 'You cannot dig that.'; end if;
    for cx, cy in select c.cx, c.cy from tile_corners(tx, ty) c loop
      aimed := corner_under_building(p_world, cx, cy);
      if aimed is not null then return aimed; end if;
      if land_height(p_world, cx, cy) < -pk(p.class_mul, 'depth:dig', mine_depth()) then
        return 'The water is too deep here to work in.';
      end if;
      if land_dirt(p_world, cx, cy) <= 0 then
        return 'A corner of it is bare rock. Only a pickaxe will take that lower.';
      end if;
      aimed := coalesce(level_stop(p_world, p_uid, cx, cy, -1),
                        slope_refusal(p_world, p_uid, 'digging', cx, cy, -1));
      if aimed is not null then return aimed; end if;
    end loop;
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.act_perform(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare d action_def; tq double precision; s double precision; cx int; cy int; tx int; ty int;
        t tile_def; left_dirt int; made_ql double precision; yield text; tool_id bigint;
begin
  -- Shop counters and lantern posts (`counters.ts`, `lamps.ts`).
  if counter_action(p_action) then perform perform_counter(p_world, p_uid, p_action, p_target); return; end if;
  if lamp_action(p_action) then perform perform_lamp(p_world, p_uid, p_action, p_target); return; end if;
  if spring_action(p_action) then
    perform perform_spring(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if flower_action(p_action) then
    perform perform_flowers(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if green_action(p_action) then
    perform perform_green(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if water_garden_action(p_action) then
    perform perform_water_garden(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if last_action(p_action) then
    perform perform_last(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if faith_action(p_action) then
    perform perform_faith(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if ride_action(p_action) then
    perform perform_ride(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if hands_action(p_action) then
    perform perform_hands(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if liquid_action(p_action) then
    perform perform_liquid(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if forge_action(p_action) then
    perform perform_forge(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if holding_action(p_action) then
    perform perform_holding(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if settlement_action(p_action) then
    perform perform_settlement(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if dig_action(p_action) then
    perform perform_dig(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if trap_action(p_action) then
    perform perform_trap(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if ground_action(p_action) then
    perform perform_ground(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if foundation_action(p_action) then
    perform perform_foundation(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if build_action(p_action) then
    perform perform_building(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action = 'found_settlement' then
    perform perform_deed(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if creature_action(p_action) then
    perform perform_creature(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if fight_action(p_action) then
    perform perform_fight(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('fit_lock', 'take_off_lock') then
    perform perform_lock(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if crate_action(p_action) then
    perform perform_crate(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if item_action(p_action) then
    perform perform_item(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if firing_action(p_action) then
    perform perform_firing(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if fire_action(p_action) then
    perform perform_fire(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if treasure_action(p_action) then
    perform perform_treasure(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('mine', 'chip_corner', 'pack', 'cultivate', 'pave_cobble', 'drop_dirt_here') then
    perform perform_terrain(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('cut_down', 'forage', 'botanize', 'collect') then
    perform perform_gather(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if farm_action(p_action) then
    perform perform_farm(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if p_action in ('fish', 'drag_net') then
    perform perform_fish(p_world, p_uid, p_action, p_target);
    return;
  end if;
  if exists (select 1 from recipe where id = p_action) then
    perform perform_craft(p_world, p_uid, p_action, p_target);
    return;
  end if;

  select * into d from action_def where id = p_action;
  s := case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end;

  if p_action = 'dig_tile' then
    perform perform_dig_tile(p_world, p_uid, p_target);
    return;
  end if;
  if p_action = 'pan' then
    perform perform_pan(p_world, p_uid, p_target);
    return;
  end if;

  if p_action = 'dig' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    select i.id into tool_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = d.tool
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id); end if;
    if not skill_check(s, d.difficulty, tq) then
      perform skill_raise(p_world, p_uid, d.skill, try_gain(false));
      perform tell(p_world, p_uid, 'You fail to dig anything useful.', 'event');
      return;
    end if;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
    left_dirt := land_dirt(p_world, cx, cy) - 1;
    perform land_set_dirt(p_world, cx, cy, left_dirt);
    if t.turns_to_dirt then perform land_set_tile(p_world, tx, ty, 1); end if;
    -- Dug to the rock, the tile becomes rock and shows the seam under it.
    perform reconcile_around(p_world, cx, cy);
    perform land_announce(p_world, tx, ty);
    if left_dirt <= 0 then
      perform tell(p_world, p_uid, 'Your shovel grates on bare rock.', 'event');
    end if;
    yield := coalesce(t.dig_yield, 'dirt');
    -- Cleaner for a Terraformer's Clean Earth, and now and then rare.
    made_ql := least(100, product_ql(s, tq) * pkx('ql:dig', 1));
    perform gather(p_world, p_uid, yield, 1, made_ql, null, perk_rare(pkx('rare:dig', 0)));
    -- And one spadeful in a thousand that is not dirt at all.
    perform maybe_map(p_world, p_uid, s, tq);
    perform skill_raise(p_world, p_uid, d.skill, 1);
    perform tell(p_world, p_uid,
      'You dig up some ' || lower((select name from item_def where id = yield)) ||
      '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.act_ported(p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (select 1 from recipe where id = p_action)
      or last_action(p_action)
      or spring_action(p_action)
      or flower_action(p_action)
      or green_action(p_action)
      or water_garden_action(p_action)
      or faith_action(p_action)
      or ride_action(p_action)
      or trap_action(p_action)
      or dig_action(p_action)
      or treasure_action(p_action)
      or settlement_action(p_action)
      or holding_action(p_action)
      or forge_action(p_action)
      or liquid_action(p_action)
      or hands_action(p_action)
      or ground_action(p_action)
      or item_action(p_action)
      or firing_action(p_action)
      or fire_action(p_action)
      or crate_action(p_action)
      -- Fitting a padlock, and taking one off again.
      or p_action in ('fit_lock', 'take_off_lock')
      or build_action(p_action)
      or creature_action(p_action)
      or fight_action(p_action)
      or foundation_action(p_action)
      or farm_action(p_action)
      -- Shop counters and lantern posts.
      or counter_action(p_action) or lamp_action(p_action)
      or p_action in ('dig', 'mine', 'chip_corner', 'pack', 'cultivate', 'pave_cobble',
                      'drop_dirt_here', 'cut_down', 'forage', 'botanize', 'collect',
                      'fish', 'drag_net', 'found_settlement', 'set_to_work', 'dig_tile', 'pan')
$function$;

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
    return coalesce(need_tool(p_world, p_uid, 'mallet'), plan_reason(p_world, p_uid, tx, ty),
                    counter_street_refusal(p_world, tx, ty));  -- a counter's street (`counters.ts`)

  elsif p_action = 'add_to_building' then
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    select * into b from building where world_id = p_world and id = neighbour_building(p_world, tx, ty);
    if not found then return 'There is no building next to this tile.'; end if;
    if b.levels > 1 then return 'The footprint cannot change once upper floors are planned.'; end if;
    return coalesce(plan_reason(p_world, p_uid, tx, ty), counter_street_refusal(p_world, tx, ty));  -- a counter's street

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
    -- A shop counter faces the street from the ground floor (`counters.ts`).
    if wt.id = 'counter' then
      v_gap := counter_plan_refusal(p_world, lvl, tx, ty, side);
      if v_gap is not null then return v_gap; end if;
    end if;
    -- Nor does a wall close over a lantern post's arm (`lamps.ts`).
    v_gap := lamp_wall_refusal(p_world, lvl, tx, ty, side, wt.id);
    if v_gap is not null then return v_gap; end if;
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
      -- And a shop counter comes down empty, till and all (`counters.ts`).
      return case when w.world_id is null then 'There is no wall there.' else counter_remove_refusal(p_world, w) end;
    end if;
    if w.world_id is null then return 'There is no wall planned there.'; end if;
    if bill_done(w.needed) then return 'That wall is finished.'; end if;
    -- Nor is one raised over a lantern post's arm (`lamps.ts`).
    v_gap := lamp_wall_refusal(p_world, w.level, tx, ty, side, w.type);
    if v_gap is not null then return v_gap; end if;
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

CREATE OR REPLACE FUNCTION public.perform_building(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare shape text; pot item; colour dye_def; tx int; ty int; side text; b building; w wall; f floor_tile; mat build_material_def;
        wt wall_type_def; lvl int; kind text; used text; nm text;
        sk text; bill jsonb; other record; what text; new_id int;
        v_laid text[]; v_i int; v_stone text; v_back int; v_was build_material_def; v_total jsonb;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  side := p_target->>'side';
  select * into b from building where world_id = p_world and id = building_at(p_world, tx, ty);

  if p_action = 'plan_building' then
    nm := left(coalesce(nullif(btrim(coalesce(p_target->>'name', '')), ''), 'House'), 32);
    select coalesce(max(id), 0) + 1 into new_id from building where world_id = p_world;
    insert into building (world_id, id, name, planned_by) values (p_world, new_id, nm, p_uid);
    insert into building_tile (world_id, building, x, y) values (p_world, new_id, tx, ty);
    perform tell(p_world, p_uid, 'You plan ' || nm || ' here. Extend it onto neighbouring flat packed '
      || 'tiles, then plan walls on its borders.', 'event');

  elsif p_action = 'add_to_building' then
    select * into b from building where world_id = p_world and id = neighbour_building(p_world, tx, ty);
    if not found then return; end if;
    insert into building_tile (world_id, building, x, y) values (p_world, b.id, tx, ty)
      on conflict do nothing;
    perform tell(p_world, p_uid, 'You add the tile to ' || b.name || '.', 'event');

  elsif p_action = 'remove_from_plan' then
    if b.id is null then return; end if;
    delete from building_tile where world_id = p_world and x = tx and y = ty;
    if exists (select 1 from building_tile where world_id = p_world and building = b.id) then
      perform tell(p_world, p_uid, 'You remove the tile from ' || b.name || '.', 'event');
    else
      -- The last tile of a plan is the plan.
      delete from building where world_id = p_world and id = b.id;
      perform tell(p_world, p_uid, 'You remove the last of ' || b.name || '''s plan.', 'event');
    end if;

  elsif p_action = 'rename_building' then
    if b.id is null then return; end if;
    nm := left(btrim(p_target->>'name'), 32);
    update building set name = nm where world_id = p_world and id = b.id;
    perform tell(p_world, p_uid, 'The building is now called ' || nm || '.', 'event');

  elsif p_action in ('plan_wall', 'plan_fence') then
    select * into wt from wall_type_def where id = p_target->>'wallType';
    select * into mat from build_material_def where id = p_target->>'material';
    lvl := case when p_action = 'plan_fence' then 0 else work_level(p_world, b.id) end;
    -- A fence, a gate or a half wall for less of its material: a Carpenter's Fence Builder.
    bill := wall_bill(mat.id, wt.id, case when wt.standalone then pk(p_world, p_uid, 'bill:fence', 1) else 1 end);
    insert into wall (world_id, level, dir, x, y, building, type, material, needed, total, planned_by)
    select p_world, lvl, bd.dir, bd.x, bd.y,
           case when p_action = 'plan_fence' then 0 else b.id end,
           wt.id, mat.id, bill, bill, p_uid
    from border_of(tx, ty, side) bd;
    if p_action = 'plan_fence' then
      perform tell(p_world, p_uid, 'You mark out a ' || lower(mat.name) || ' ' || lower(wt.name)
        || ' on the ' || side_name(side) || ' border. It needs ' || bill_text(mat.id, bill) || '.', 'event');
    else
      perform tell(p_world, p_uid, 'You plan a ' || lower(wt.name) || ' ' || lower(mat.name)
        || ' wall on the ' || side_name(side) || ' side. It needs ' || bill_text(mat.id, bill) || '.', 'event');
    end if;

  elsif p_action = 'build_wall' then
    w := wall_at(p_world, tx, ty, side);
    if w.world_id is null or bill_done(w.needed) then return; end if;
    select * into mat from build_material_def where id = w.material;
    -- A unit a go, or as many as a Mason's Two at a Time lays on stone.
    bill := w.needed;
    v_laid := '{}';
    for v_i in 1 .. greatest(1, floor(pk(p_world, p_uid, 'lay:' || build_work(mat.kind), 1))::int) loop
      exit when bill_done(bill);
      used := next_material(p_world, p_uid, w.material, bill, tx, ty);
      exit when used is null or not take_material(p_world, p_uid, used, tx, ty, w.material);
      bill := jsonb_set(bill, array[used], to_jsonb((bill->>used)::int - 1));
      v_laid := v_laid || used;
    end loop;
    if coalesce(array_length(v_laid, 1), 0) = 0 then return; end if;
    update wall set needed = bill where world_id = w.world_id and level = w.level
      and dir = w.dir and x = w.x and y = w.y;
    -- A shop counter's store opens as it is finished (`counters.ts`).
    if bill_done(bill) then perform counter_finished(p_world, w); end if;
    perform skill_raise(p_world, p_uid, mat.skill, 0.4);
    select * into wt from wall_type_def where id = w.type;
    if bill_done(bill) then
      what := case when wt.low then lower(wt.name) else 'wall' end;
      perform tell(p_world, p_uid, 'You finish the ' || lower(mat.name) || ' ' || what || '.', 'event');
    else
      perform tell(p_world, p_uid, 'You fit ' || laid_text(v_laid) || ' into the wall. Still needed: '
        || bill_text(w.material, bill) || '.', 'event');
    end if;

  elsif p_action = 'remove_wall' then
    w := wall_at(p_world, tx, ty, side);
    if w.world_id is null then return; end if;
    select * into wt from wall_type_def where id = w.type;
    select * into mat from build_material_def where id = w.material;
    -- A Mason's Salvage: a share of the stone laid in it -- the first thing on
    -- its material's bill, not the mortar -- rounded down.
    v_stone := (select b2.item from build_material_bill b2 where b2.material = w.material order by b2.ord limit 1);
    v_back := floor(greatest(0, coalesce((w.total->>v_stone)::int, 0) - coalesce((w.needed->>v_stone)::int, 0))
                    * pk(p_world, p_uid, 'salvage:' || build_work(mat.kind), 0))::int;
    perform counter_gone(p_world, w);
    delete from wall where world_id = w.world_id and level = w.level and dir = w.dir and x = w.x and y = w.y;
    if v_back > 0 then perform give(p_world, p_uid, v_stone, v_back, 20); end if;
    perform tell(p_world, p_uid, 'You take down the '
      || case when wt.low then lower(wt.name) else 'wall' end
      || ' on the ' || side_name(side) || ' side'
      || case when v_back > 0 then ' and save ' || v_back || ' ' || material_name(v_stone, v_back) else '' end
      || '.', 'event');

  /*
   * A Mason's Repoint: a finished stone wall laid again in another stone, in
   * one go. The new stone's bill without the fittings is paid out of whatever
   * a wall may be built out of, the fittings stay, a share of the old stone
   * comes back, and the paint goes with the old face. `build_refusal` has
   * already asked that every unit of it is to hand.
   */
  elsif p_action = 'repoint_wall' then
    w := wall_at(p_world, tx, ty, side);
    select * into mat from build_material_def where id = p_target->>'material';
    select * into v_was from build_material_def where id = w.material;
    if w.world_id is null or mat.id is null or v_was.id is null then return; end if;
    bill := scaled_bill(mat.id, coalesce((select t2.factor::text::float8 from wall_type_def t2 where t2.id = w.type), 1));
    for other in select e.key, e.value::int as n from jsonb_each_text(bill) e loop
      for v_i in 1 .. other.n loop
        if not take_material(p_world, p_uid, other.key, tx, ty, mat.id) then return; end if;
      end loop;
    end loop;
    v_stone := (select b2.item from build_material_bill b2 where b2.material = v_was.id order by b2.ord limit 1);
    v_back := floor(coalesce((w.total->>v_stone)::int, 0) * repoint_back())::int;
    if v_back > 0 then perform give(p_world, p_uid, v_stone, v_back, 20); end if;
    v_total := wall_bill(mat.id, w.type);
    update wall set material = mat.id, total = v_total, dye = null,
           needed = (select jsonb_object_agg(k, 0) from jsonb_object_keys(v_total) k)
     where world_id = w.world_id and level = w.level and dir = w.dir and x = w.x and y = w.y;
    perform skill_raise(p_world, p_uid, 'masonry', 1);
    perform tell(p_world, p_uid, 'You take the ' || lower(v_was.name) || ' out of the wall on the '
      || side_name(side) || ' side and lay it again in ' || lower(mat.name)
      || case when v_back > 0 then ', and save ' || v_back || ' ' || material_name(v_stone, v_back) else '' end
      || '.', 'event');

  elsif p_action = 'add_floor' then
    if b.id is null then return; end if;
    update building set levels = levels + 1, work_level = levels
      where world_id = p_world and id = b.id returning * into b;
    perform tell(p_world, p_uid, 'You plan storey ' || b.levels || ' of ' || b.name
      || '. Plan and build its floor tiles, then raise walls on them.', 'event');

  elsif p_action = 'plan_floor' then
    if b.id is null then return; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := floor_level(p_world, b.id, kind);
    select * into mat from build_material_def where id = p_target->>'material';
    /*
     * A building has one roof, so the first tile of it decides the shape and
     * the rest follow. Changing your mind means taking the roof off, which is
     * what changing your mind about a roof means anywhere.
     */
    if kind = 'roof' and (select roof from building where world_id = p_world and id = b.id) is null then
      update building set roof = coalesce(
          (select id from roof_shape_def where id = p_target->>'roofShape'), 'hip')
        where world_id = p_world and id = b.id;
    end if;
    shape := roof_shape_of(p_world, b.id);
    bill := floor_bill(mat.id, kind, shape);
    insert into floor_tile (world_id, level, x, y, building, material, kind, facing, needed, total, planned_by)
    values (p_world, lvl, tx, ty, b.id, mat.id, kind,
            case when kind in ('stairs', 'ladder') then side end, bill, bill, p_uid);
    perform tell(p_world, p_uid, 'You plan a '
      || case when kind = 'ladder' then 'ladder'
              else case when kind = 'roof'
                        then lower((select name from roof_shape_def where id = shape)) || ' ' else '' end
                   || lower(mat.name) || ' ' || floor_kind_name(kind) end
      || '. It needs ' || bill_text(mat.id, bill) || '.', 'event');

  elsif p_action = 'build_floor' then
    if b.id is null then return; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := floor_level(p_world, b.id, kind);
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found or bill_done(f.needed) then return; end if;
    select * into mat from build_material_def where id = f.material;
    -- A unit a go, or as many as a Mason's Two at a Time lays on stone.
    bill := f.needed;
    v_laid := '{}';
    for v_i in 1 .. greatest(1, floor(pk(p_world, p_uid, 'lay:' || build_work(mat.kind), 1))::int) loop
      exit when bill_done(bill);
      used := next_material(p_world, p_uid, f.material, bill, tx, ty);
      exit when used is null or not take_material(p_world, p_uid, used, tx, ty, f.material);
      bill := jsonb_set(bill, array[used], to_jsonb((bill->>used)::int - 1));
      v_laid := v_laid || used;
    end loop;
    if coalesce(array_length(v_laid, 1), 0) = 0 then return; end if;
    update floor_tile set needed = bill where world_id = p_world and level = lvl and x = tx and y = ty;
    -- Floors are paving; stairs, ladders and roofs are carpentry or masonry by material.
    sk := case f.kind when 'floor' then 'paving' when 'ladder' then 'carpentry'
                      else coalesce(mat.skill, 'carpentry') end;
    perform skill_raise(p_world, p_uid, sk, 0.4);
    what := case when f.kind = 'ladder' then 'ladder' else lower(mat.name) || ' ' || floor_kind_name(f.kind) end;
    if bill_done(bill) then
      perform tell(p_world, p_uid, 'You finish the ' || what || '.', 'event');
    else
      perform tell(p_world, p_uid, 'You work ' || laid_text(v_laid) || ' into the '
        || floor_kind_name(f.kind) || '. Still needed: ' || bill_text(f.material, bill) || '.', 'event');
    end if;

  elsif p_action = 'remove_floor' then
    if b.id is null then return; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := floor_level(p_world, b.id, kind);
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found then return; end if;
    delete from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    -- Anybody standing on what was just torn up goes down a storey, not through it.
    if lvl > 0 then
      update player set level = lvl - 1
        where world_id = p_world and floor(x)::int = tx and floor(y)::int = ty and level >= lvl;
    end if;
    perform tell(p_world, p_uid, 'You remove the ' || floor_kind_name(f.kind) || '.', 'event');

  elsif p_action = 'paint_wall' then
    w := wall_at(p_world, tx, ty, side);
    if w.world_id is null then return; end if;
    pot := pick_dye(p_world, p_uid);
    select * into colour from dye_def where name = pot.extra;
    if colour.id is null or not consume(p_world, p_uid, 'dye', 1) then return; end if;
    update wall set dye = colour.id where world_id = p_world and level = w.level
      and dir = w.dir and x = w.x and y = w.y;
    perform skill_raise(p_world, p_uid, 'alchemy', 0.3);
    perform tell(p_world, p_uid, 'You brush the ' || lower(colour.name) || ' over the wall on the '
      || side_name(side) || ' side. It comes up ' || colour.word || '.', 'event');

  elsif p_action = 'strip_wall_paint' then
    w := wall_at(p_world, tx, ty, side);
    if w.world_id is null or w.dye is null then return; end if;
    select * into pot from item where world_id = p_world and holder = 'player'
      and holder_uid = p_uid and def = 'lye_bucket' order by id limit 1;
    if pot.id is null or not consume(p_world, p_uid, 'lye_bucket', 1) then return; end if;
    perform give(p_world, p_uid, 'bucket', 1, pot.ql);
    update wall set dye = null where world_id = p_world and level = w.level
      and dir = w.dir and x = w.x and y = w.y;
    perform skill_raise(p_world, p_uid, 'alchemy', 0.2);
    select * into mat from build_material_def where id = w.material;
    perform tell(p_world, p_uid, 'You scrub the wall back to bare '
      || coalesce(lower(mat.name), 'stone') || '.', 'event');

  elsif p_action = 'paint_floor' then
    if b.id is null then return; end if;
    lvl := work_level(p_world, b.id);
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found then return; end if;
    pot := pick_dye(p_world, p_uid);
    select * into colour from dye_def where name = pot.extra;
    if colour.id is null or not consume(p_world, p_uid, 'dye', 1) then return; end if;
    update floor_tile set dye = colour.id where world_id = p_world and level = lvl and x = tx and y = ty;
    perform skill_raise(p_world, p_uid, 'alchemy', 0.3);
    perform tell(p_world, p_uid, 'You work the ' || lower(colour.name)
      || ' into the boards. The floor comes up ' || colour.word || '.', 'event');

  elsif p_action = 'remove_storey' then
    if b.id is null or b.levels <= 1 then return; end if;
    update building set levels = levels - 1, work_level = levels - 2
      where world_id = p_world and id = b.id returning * into b;
    perform tell(p_world, p_uid, b.name || ' is back to '
      || case when b.levels = 1 then 'a single storey' else b.levels || ' storeys' end || '.', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.errand_do(p_world uuid, p_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; kind text; skill_id text; skill double precision;
        v_job record; v_it item; v_hearth placed; v_per double precision; v_tree int;
        v_vessel placed;
begin
  select * into c from creature where world_id = p_world and id = p_id;
  select * into d from species_def where id = c.species;
  kind := d.gathers;
  select g.skill into skill_id from gather_def g where g.id = kind;
  skill := task_skill(c);

  if kind = 'mend' then
    v_it := damaged_in_stores(p_world, c.keeper);
    if v_it.id is null then return false; end if;
    perform worker_learn(p_world, p_id, skill_id, 0.2);
    -- The same bargain the player's own repair makes: damage out, a little
    -- quality with it, and a better hand loses less of it.
    update item set dmg = greatest(0, dmg - (2 + skill / 12)),
        ql = greatest(1, ql - greatest(0.05, 0.6 - skill / 220))
      where id = v_it.id;
    return true;

  elsif kind = 'hod' then
    if c.carrying is null then return false; end if;
    select * into v_job from wall_needing(p_world, c.work_x, c.work_y, 0, c.carrying->>'def');
    if v_job.item is null or v_job.item is distinct from c.carrying->>'def' then return false; end if;
    update wall set needed = jsonb_set(needed, array[v_job.item],
        to_jsonb((needed->>v_job.item)::int - 1))
      where world_id = p_world and level = 0 and dir = v_job.dir and x = v_job.x and y = v_job.y;
    -- A shop counter's store opens as its last piece goes in (`counters.ts`).
    perform counter_finished(p_world, w2) from wall w2
      where w2.world_id = p_world and w2.level = 0 and w2.dir = v_job.dir and w2.x = v_job.x and w2.y = v_job.y
        and w2.type = 'counter' and bill_done(w2.needed);
    update creature set carrying = null where world_id = p_world and id = p_id;
    perform worker_learn(p_world, p_id, skill_id, 0.25);
    return true;

  elsif kind = 'stoke' then
    if c.carrying is null then return false; end if;
    v_hearth := cold_hearth(p_world, c.work_x, c.work_y, 0);
    if v_hearth.id is null then return false; end if;
    perform placed_settle(v_hearth.id);
    v_per := fuel_value(c.carrying->>'def');
    if v_per is null then
      update creature set carrying = null where world_id = p_world and id = p_id;
      return false;
    end if;
    -- Fed, and lit if it had gone out: a stoker's whole job is that nothing
    -- on the deed is ever cold when somebody comes back to it.
    update placed set fuel = least(fire_capacity(), placed_fuel(placed) + v_per),
        ash = placed_ash(placed), lit = true, since = now()
      where id = v_hearth.id;
    update creature set carrying = null where world_id = p_world and id = p_id;
    perform worker_learn(p_world, p_id, skill_id, 0.2);
    return true;

  elsif kind = 'water' then
    if c.carrying->>'def' = 'water_bucket' then
      -- Pouring it in. Whichever barrel it walked to, if it still has room.
      -- Aliased, and not for tidiness: `kind` is a local in this function and
      -- a column of `placed`, and an unaliased table makes it ambiguous. That
      -- is the sixth time this class has bitten, and the first caught by
      -- running rather than by reading.
      select p2.* into v_vessel from placed p2 where p2.world_id = p_world and p2.kind = 'furniture'
        and p2.x = c.work_x and p2.y = c.work_y and holds_liquid(p2) and not is_well(p2)
        limit 1;
      if v_vessel.id is null then return false; end if;
      update placed set litres = least(liquid_capacity(v_vessel),
                                       placed_litres(v_vessel) + bucket_litres()),
          liquid = 'water', since = now()
        where id = v_vessel.id;
      update creature set carrying = null where world_id = p_world and id = p_id;
      perform worker_learn(p_world, p_id, skill_id, 0.2);
      return true;
    end if;
    -- Filling it. A well is drawn down by what is taken; a shore is not.
    select p2.* into v_vessel from placed p2 where p2.world_id = p_world and p2.kind = 'furniture'
      and p2.x = c.work_x and p2.y = c.work_y and is_well(p2) limit 1;
    if v_vessel.id is not null and not draw_from(v_vessel.id, bucket_litres()) then return false; end if;
    if v_vessel.id is null and not has_water(p_world, c.work_x, c.work_y) then return false; end if;
    update creature set carrying = jsonb_build_object('def', 'water_bucket', 'count', 1, 'ql', 40)
      where world_id = p_world and id = p_id;
    return true;

  elsif kind = 'prospect' then
    perform worker_learn(p_world, p_id, skill_id, 0.22);
    -- The radius grows with what it knows, the same way a player's does, and
    -- what it finds is lit for its keeper: the beast cannot read a map.
    perform read_ground(p_world, p_id, c.work_x, c.work_y, 2 + floor(skill / 20)::int);
    /*
     * And it moves on.
     *
     * `unread_ground` hashes its sixty guesses off the creature and its leg
     * number, which is how everything out here stays the same when it is
     * replayed. A deed worker never touches its leg, though — nothing in the
     * round trip needs one — so the hash was constant and the prospector
     * walked to the same square forty times, learning a great deal about one
     * patch of grass. A reading is a leg, so it counts as one.
     */
    update creature set leg = leg + 1 where world_id = p_world and id = p_id;
    return true;

  elsif kind = 'plant' then
    if c.carrying->>'def' is distinct from 'sprout' then return false; end if;
    if not plantable_tile(p_world, c.work_x, c.work_y) then
      update creature set carrying = null where world_id = p_world and id = p_id;
      return false;
    end if;
    v_tree := coalesce((select id from tree_def where name = c.carrying->>'extra'), 0);
    perform land_set_tile(p_world, c.work_x, c.work_y, tile_id('Tree'));
    perform land_set_data(p_world, c.work_x, c.work_y, v_tree);
    perform land_announce(p_world, c.work_x, c.work_y);
    update creature set carrying = null where world_id = p_world and id = p_id;
    perform worker_learn(p_world, p_id, skill_id, 0.25);
    return true;
  end if;
  return false;
end $function$;

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
    -- And a lantern post's arm not into a wall (`lamps.ts`).
    if p_action = 'place_furniture' then
      return lamp_arm_refusal(p_world, sub, (p_target->>'x')::int, (p_target->>'y')::int,
        least(subtiles() - sz[1], greatest(0, coalesce((p_target->>'sx')::int, 0))),
        least(subtiles() - sz[2], greatest(0, coalesce((p_target->>'sy')::int, 0))),
        case when p_target->>'facing' in ('n', 'e', 's', 'w') then p_target->>'facing' else 's' end);
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

CREATE OR REPLACE FUNCTION public.perform_fire(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p placed; it item; sz int[]; ax int; ay int; per double precision; room double precision;
        fits int; whole int; sub text; made bigint; back text;
begin
  if p_action = 'build_campfire' then
    ax := least(subtiles() - 2, greatest(0, (p_target->>'sx')::int));
    ay := least(subtiles() - 2, greatest(0, (p_target->>'sy')::int));
    if not consume(p_world, p_uid, 'shaft', 2) then return; end if;
    insert into placed (world_id, kind, x, y, sx, sy, cx, cy, fuel, made_by)
    values (p_world, 'campfire', (p_target->>'x')::int, (p_target->>'y')::int, ax, ay,
            (p_target->>'x')::int + (ax + 1.0) / subtiles(), (p_target->>'y')::int + (ay + 1.0) / subtiles(),
            120, p_uid);
    perform tell(p_world, p_uid, 'You lay a campfire from 2 shafts. Light it, or feed it more wood first.', 'event');
    perform land_announce(p_world, (p_target->>'x')::int, (p_target->>'y')::int);
    return;
  end if;

  if p_action in ('place_smelter', 'place_furniture', 'place_kiln') then
    select * into it from item where id = target_item(p_target);
    -- A piece stands there as whatever it was in the pack. This read the def
    -- through replace(it.def, 'furniture_', '') for as long as the pick-up put
    -- that prefix on, which meant the two halves disagreed about what an item
    -- is called and only one of them ever said so. Neither does now.
    sub := case when p_action = 'place_furniture' then it.def end;
    -- Which way it faces, which is the browser's to say and south when it says nothing.
    back := case when p_target->>'facing' in ('n', 'e', 's', 'w') then p_target->>'facing' else 's' end;
    sz := placed_size(case p_action when 'place_smelter' then 'smelter'
                                    when 'place_kiln' then 'kiln' else 'furniture' end, sub, back);
    ax := least(subtiles() - sz[1], greatest(0, coalesce((p_target->>'sx')::int, 0)));
    ay := least(subtiles() - sz[2], greatest(0, coalesce((p_target->>'sy')::int, 0)));
    /*
     * The quality, and -- new here -- the rarity and the wood.
     *
     * A piece set down used to reach the ground with nothing but its quality.
     * Its rarity went in the bin, so a rare chest was a rare chest right up
     * until somebody put it in a room and then it was a chest; and its wood
     * went with it, so an oak chest and a pine one were the same chest the
     * moment they were standing. Both are on the item being consumed here,
     * and both come across now.
     */
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by, facing, rare, material, creature, mark, dye)
    values (p_world, case p_action when 'place_smelter' then 'smelter'
                                   when 'place_kiln' then 'kiln' else 'furniture' end, sub,
            (p_target->>'x')::int, (p_target->>'y')::int, ax, ay,
            (p_target->>'x')::int + (ax + sz[1] / 2.0) / subtiles(),
            (p_target->>'y')::int + (ay + sz[2] / 2.0) / subtiles(),
            it.ql, p_uid, back, it.rare, it.extra,
            case when p_action = 'place_furniture' then it.creature end,
            -- And its maker's mark, which it carries wherever it stands.
            it.mark,
            -- And its colour: a banner, a flag or a sail dyed in the pack stands dyed.
            it.dye)
    returning id into made;
    delete from item where id = it.id;
    -- And whoever is shut in it stands where it stands, and is seen in it.
    if p_action = 'place_furniture' and it.creature is not null then
      update creature c set from_x = pl.cx, from_y = pl.cy, to_x = pl.cx, to_y = pl.cy,
          leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
        from placed pl where pl.id = made and c.world_id = p_world and c.id = it.creature;
    end if;
    perform tell(p_world, p_uid, 'You set the ' ||
      lower(coalesce((select name from furniture_def where id = sub),
        case when p_action = 'place_kiln' then 'kiln' else 'smelter' end)) || ' down'
      || coalesce(' with ' || (select c.name from creature c where p_action = 'place_furniture'
                                 and c.world_id = p_world and c.id = it.creature) || ' in it', '')
      || '.', 'event');
    perform land_announce(p_world, (p_target->>'x')::int, (p_target->>'y')::int);
    return;
  end if;

  perform placed_settle(nullif(p_target->>'id', '')::bigint);
  p := target_placed(p_world, p_target);
  if p.id is null then return; end if;

  if p_action in ('light_campfire', 'light_smelter', 'light_kiln') then
    update placed set lit = true, since = now() where id = p.id;
    if p_action = 'light_campfire' then perform journal_note(p_world, p_uid, 'fire'); end if;
    perform tell(p_world, p_uid, 'The kindling catches and the ' || p.kind || ' burns. It has '
      || burns_for(p.fuel) || ' of fuel.', 'event');
  elsif p_action in ('put_out_campfire', 'damp_smelter', 'damp_kiln') then
    update placed set lit = false, since = now() where id = p.id;
    perform tell(p_world, p_uid, 'You smother the fire. The wood is saved for later.', 'event');
  elsif p_action in ('fuel_campfire', 'fuel_smelter', 'fuel_kiln') then
    -- From what is at hand: the pack, a bag, or a store within reach.
    select i.* into it from craft_stock(p_world, p_uid, target_item(p_target)) s join item i on i.id = s.id
      where (s.id = target_item(p_target) or fuel_value(s.def) is not null)
      order by (s.id = target_item(p_target)) desc, s.draw limit 1;
    per := fuel_value(it.def);
    room := greatest(0, fire_capacity() - p.fuel);
    /*
     * How many you asked for, which this never read.
     *
     * Reported as "attempting to feed one coal to a smelter puts four coal
     * in". The menu offers one or all and sends the count either way; this
     * fed as much as would fit whatever it was told, so a firebox with room
     * in it swallowed the whole pile on a single "one". The browser has read
     * the count since fuelling was written.
     */
    fits := greatest(1, least(least(coalesce((p_target->>'count')::int, 1), it.count),
                              ceil(room / per)::int));
    if not spend_stack(p_world, p_uid, it.id, fits) then return; end if;
    update placed set fuel = least(fire_capacity(), p.fuel + per * fits), since = now() where id = p.id;
    perform tell(p_world, p_uid, 'You feed ' || case when fits > 1 then fits || ' × ' else 'a ' end
      || lower((select name from item_def where id = it.def)) || ' to the fire. '
      || burns_for(least(fire_capacity(), p.fuel + per * fits)) || ' of fuel.', 'event');
  elsif p_action in ('take_ashes_fire', 'take_ashes_smelter', 'take_ashes_kiln') then
    whole := floor(p.ash)::int;
    update placed set ash = p.ash - whole, since = now() where id = p.id;
    perform give(p_world, p_uid, 'ash', whole, 20);
    perform tell(p_world, p_uid, 'You rake ' || whole || case when whole = 1 then ' lot' else ' lots' end
      || ' of ashes out of the ' || p.kind || '. (QL 20)', 'event');
  elsif p_action = 'take_apart_campfire' then
    -- Coal burns but is never got back, so a pile of logs cannot be turned
    -- into coal by rebuilding the fire.
    delete from placed where id = p.id;
    perform give(p_world, p_uid, 'shaft', 2, 20);
    perform tell(p_world, p_uid, 'You take the campfire apart and save what will burn again.', 'event');
    perform land_announce(p_world, p.x, p.y);
  elsif p_action = 'turn_furniture' then
    -- A quarter turn to the right, walked to the nearest spot the turned block fits.
    back := lamp_turns_to(p_world, p);  -- on round past a facing a post's arm would go into a wall (`lamps.ts`)
    sz := placed_size(p.kind, p.sub, back);
    ax := least(subtiles() - sz[1], greatest(0, p.sx));
    ay := least(subtiles() - sz[2], greatest(0, p.sy));
    update placed set facing = back, sx = ax, sy = ay,
        cx = p.x + (ax + sz[1] / 2.0) / subtiles(), cy = p.y + (ay + sz[2] / 2.0) / subtiles()
      where id = p.id;
    perform tell(p_world, p_uid, 'You turn the ' || lower(placed_name(p)) || ' to face ' || side_name(back) || '.', 'event');
    perform land_announce(p_world, p.x, p.y);

  elsif p_action in ('pick_up_smelter', 'pick_up_furniture', 'pick_up_kiln') then
    /*
     * What goes back in the pack is the thing's own definition, which for a
     * piece of furniture is its `sub` and nothing else.
     *
     * It used to be 'furniture_' || p.sub. There is no such item: the
     * catalogue calls a wagon a wagon, so picking one up put a row in your
     * pack with a definition nothing has ever heard of. It showed as its own
     * id under OTHER, weighed whatever the fallback weighs, and could not be
     * set down again, because the browser asks `isFurniture` of the id it is
     * holding and the answer was no. The wagon was not lost, but it was not a
     * wagon either.
     *
     * The other half of the pair hid it: `place_furniture` reads its `sub`
     * with replace(it.def, 'furniture_', ''), so it would have accepted the
     * broken id perfectly well and nothing on this side ever complained.
     */
    back := case p.kind when 'smelter' then 'smelter' when 'kiln' then 'kiln'
                        else p.sub end;
    -- And back the same way: what it stood there as is what goes in the pack.
    -- `give` has taken a material and a rarity since the day it was written.
    -- Given before the piece comes up, so a crate's wildermon is never in no crate at all.
    made := give(p_world, p_uid, back, 1, p.ql, p.material, p.rare);
    if p.mark is not null then update item set mark = p.mark where id = made; end if;
    -- And its colour, back on the thing in the pack.
    if p.dye is not null then update item set dye = p.dye where id = made; end if;
    if p.creature is not null then
      update item set creature = p.creature where id = made;
      update creature c set from_x = py.x, from_y = py.y, to_x = py.x, to_y = py.y,
          leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
        from player py where py.world_id = p_world and py.uid = p_uid
          and c.world_id = p_world and c.id = p.creature;
    end if;
    delete from placed where id = p.id;
    perform tell(p_world, p_uid, 'You take up the '
      || lower(coalesce((select name from furniture_def where id = p.sub), p.sub, p.kind))
      || coalesce(' with ' || (select c.name from creature c where c.world_id = p_world and c.id = p.creature) || ' in it', '')
      || '.', 'event');
    perform land_announce(p_world, p.x, p.y);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.forge_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p placed; it item; v_lump item; v_cast item;
begin
  if p_action in ('fuel_oven', 'light_oven', 'put_out_oven', 'take_ashes_oven') then
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found or not is_oven(p) then return 'That is not an oven.'; end if;
    if not near_piece(p_world, p_uid, p) then return 'Stand next to the oven.'; end if;
    if p_action = 'fuel_oven' then
      select i.* into it from craft_stock(p_world, p_uid, target_item(p_target)) s join item i on i.id = s.id
        where fuel_value(s.def) is not null
          and (target_item(p_target) is null or s.id = target_item(p_target))
        order by s.draw limit 1;
      if not found then return 'An oven takes what a fire takes: ' || fuel_said() || '.'; end if;
      if placed_fuel(p) >= hearth_capacity(p) then return 'It is packed as full as it will take.'; end if;
    elsif p_action = 'light_oven' then
      if placed_lit(p) then return 'It is already burning.'; end if;
      if placed_fuel(p) <= 0 then return 'There is nothing in the firebox. Feed it some wood.'; end if;
    elsif p_action = 'put_out_oven' then
      if not placed_lit(p) then return 'It is not burning.'; end if;
    elsif p_action = 'take_ashes_oven' then
      if floor(placed_ash(p)) < 1 then return 'There are no ashes worth taking yet.'; end if;
    end if;
    return null;
  end if;

  if p_action in ('candle_lantern', 'light_lantern', 'douse_lantern') then
    select * into it from item where world_id = p_world and id = target_item(p_target)
      and holder = 'player' and holder_uid = p_uid;
    if not found or not held_light(it.def) then return 'It is gone.'; end if;
    if p_action = 'candle_lantern' then
      if it.def <> 'lantern' then return 'Nothing goes in a torch.'; end if;
      if candle_left(it) > 0 then return 'There is still a candle in it.'; end if;
      if pack_count(p_world, p_uid, 'candle') < 1 then
        return no_candle_said();  -- off the candle's recipe (`lantern.ts`)
      end if;
    elsif p_action = 'light_lantern' then
      if it.def = 'lantern' and candle_left(it) <= 0 then return 'There is no candle in it.'; end if;
      if it.lit then return 'It is already lit.'; end if;
      /*
       * The tinderbox is gone, and so is the hole it left.
       *
       * This check used to want one, faithfully, because the browser wanted
       * one — and there was no tinderbox in the browser either, so a lantern
       * could not be struck on either side of the port. That was the right
       * thing to *port* and the wrong thing to leave: a whole subsystem with
       * no way into it. The browser lights it at a fire now, and so does this.
       */
      if flame_near(p_world, p_uid, it.id) is null then
        return no_flame_said();  -- off what `flame_near` takes a light off (`lantern.ts`)
      end if;
    elsif p_action = 'douse_lantern' then
      if not it.lit then return 'It is not lit.'; end if;
    end if;
    return null;
  end if;

  if p_action = 'place_anvil' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and def = 'anvil' and not locked
      and (target_item(p_target) is null or id = target_item(p_target))
      order by id limit 1;
    if not found then return 'You have no anvil to set down.'; end if;
    return anvil_place_reason(p_world, (p_target->>'x')::int, (p_target->>'y')::int,
      coalesce((p_target->>'sx')::int, 0), coalesce((p_target->>'sy')::int, 0));
  end if;

  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint
    and kind = 'anvil';
  if not found then return 'It is gone.'; end if;
  if p_action = 'pick_up_anvil' then return null; end if;

  -- Smithing.
  if not near_piece(p_world, p_uid, p) then return 'Stand at the anvil.'; end if;
  if p_action = 'strike_coins' then
    -- Coins: a die in the pack, and a lump of a metal that coins, in the
    -- words the browser uses.
    if pack_count(p_world, p_uid, 'coin_die') < 1 then return 'You need a coin die.'; end if;
    v_lump := smith_lump(p_world, p_uid, target_item(p_target));
    if v_lump.id is null then return 'You have no metal to strike.'; end if;
    if not coalesce((metal_by_bar(v_lump.def)).coins, false) then return 'Coins are struck from silver or gold.'; end if;
    return null;
  end if;
  -- Smithing: a casting poured at the smelter, in the words the browser uses.
  v_cast := smith_casting(p_world, p_uid, target_item(p_target));
  if v_cast.id is null then
    return case when target_item(p_target) is not null then 'Choose a casting.'
                else 'Pour a mould at the smelter first.' end;
  end if;
  if not exists (select 1 from mould_def where makes = v_cast.piece) then return 'Choose a casting.'; end if;
  return null;
end $function$;

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

CREATE OR REPLACE FUNCTION public.flame_near(p_world uuid, p_uid uuid, p_except bigint DEFAULT NULL::bigint)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_alight item; p placed;
begin
  select i.* into v_alight from item i
  where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
    and held_light(i.def) and i.lit and candle_left(i) > 0
    and (p_except is null or i.id <> p_except)
  order by i.id limit 1;
  if found then return lower(item_name(v_alight)); end if;
  for p in select * from placed where world_id = p_world and kind in ('campfire', 'smelter', 'kiln', 'furniture')
    order by id
  loop
    if placed_lit(p) and near_piece(p_world, p_uid, p, 2.6) then
      return case when p.kind = 'furniture' then lower(coalesce((select fd.name from furniture_def fd where fd.id = p.sub), 'oven')) else p.kind end;
    end if;
  end loop;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_price(p_world uuid, p_item bigint, p_silver bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); v_it item; v_pl placed;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into v_it from item where world_id = p_world and id = p_item;
  if not found or v_it.placed is null then
    return jsonb_build_object('why', 'That is not laid out on anything.');
  end if;
  select * into v_pl from placed where world_id = p_world and id = v_it.placed;
  if not found or not sells(v_pl) then
    return jsonb_build_object('why', 'Only what is on a stall or a counter can carry a price.');
  end if;
  if v_pl.made_by is distinct from me then
    return jsonb_build_object('why', 'That is not your ' || sells_word(v_pl) || '.');
  end if;
  update item set price = case when coalesce(p_silver, 0) > 0 then p_silver end
    where world_id = p_world and id = p_item;
  return jsonb_build_object('priced', coalesce(p_silver, 0));
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_buy(p_world uuid, p_item bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); v_it item; v_pl placed; p player; v_name text; v_why text;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  if not found then raise exception 'you are not on this island'; end if;
  select * into v_it from item where world_id = p_world and id = p_item for update;
  if not found or v_it.price is null or v_it.placed is null then
    return jsonb_build_object('why', 'That is not for sale.');
  end if;
  select * into v_pl from placed where world_id = p_world and id = v_it.placed;
  -- A stall, or a shop counter still standing (`counters.ts`).
  if not found or not sells(v_pl) or (v_pl.kind = 'counter' and not counter_standing(v_pl)) then
    return jsonb_build_object('why', 'That is not for sale.');
  end if;
  if v_pl.made_by = me then
    return jsonb_build_object('why', 'It is your own ' || sells_word(v_pl) || '. Take it back off the counter instead.');
  end if;
  -- At it, and at a counter on its street side.
  v_why := sells_reach_refusal(v_pl, p.x, p.y, true);
  if v_why is not null then return jsonb_build_object('why', v_why); end if;
  if purse(p_world, me) < v_it.price then
    return jsonb_build_object('why', 'You cannot afford it. It is ' || v_it.price || ' silver.');
  end if;
  if not take_coins(p_world, me, v_it.price) then
    return jsonb_build_object('why', 'You cannot afford it.');
  end if;
  update placed set till = till + v_it.price where world_id = p_world and id = v_pl.id;
  v_name := lower(coalesce((select name from item_def where id = v_it.def), v_it.def));
  update item set holder = 'player', holder_uid = me, placed = null, price = null
    where world_id = p_world and id = v_it.id;
  perform pack_fold_one(v_it.id);
  if v_pl.made_by is not null then
    perform tell(p_world, v_pl.made_by, folk_name(p_world, me) || ' buys your ' || v_name
      || ' for ' || v_it.price || ' silver.', 'event');
    perform away_count(p_world, v_pl.made_by, 'sold', v_it.def, v_it.count, v_it.price);
  end if;
  return jsonb_build_object('bought', v_name, 'paid', v_it.price);
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_takings(p_world uuid, p_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); v_pl placed; p player; v_had bigint;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  select * into p from player where world_id = p_world and uid = me;
  select * into v_pl from placed where world_id = p_world and id = p_id for update;
  if not found then return jsonb_build_object('why', 'It is gone.'); end if;
  if v_pl.made_by is distinct from me then return jsonb_build_object('why', 'That is not your ' || sells_word(v_pl) || '.'); end if;
  -- A keeper empties a counter's till from either side of it (`counters.ts`).
  if sells_reach_refusal(v_pl, p.x, p.y, false) is not null then
    return jsonb_build_object('why', sells_reach_refusal(v_pl, p.x, p.y, false));
  end if;
  v_had := v_pl.till;
  if v_had <= 0 then return jsonb_build_object('why', 'The till is empty.'); end if;
  update placed set till = 0 where world_id = p_world and id = p_id;
  perform give_coins(p_world, me, v_had);
  return jsonb_build_object('took', v_had);
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_market(p_world uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); v_board boolean;
begin
  if me is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from player where world_id = p_world and uid = me) then
    raise exception 'you are not on this island';
  end if;
  v_board := board_at(p_world, me);
  return jsonb_build_object(
    'board', v_board,
    'stalls', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pl.id, 'x', pl.x, 'y', pl.y, 'what', sells_word(pl),
        'owner', folk_name(p_world, pl.made_by), 'mine', pl.made_by = me,
        'deed', (select d.name from deed d where d.world_id = p_world
                   and abs(pl.x - d.x) <= d.radius and abs(pl.y - d.y) <= d.radius
                 order by d.level desc limit 1),
        'till', case when pl.made_by = me then coalesce(pl.till, 0) end,
        'goods', coalesce((select jsonb_agg(jsonb_build_object(
              'id', i.id, 'def', i.def, 'ql', i.ql, 'dmg', i.dmg, 'count', i.count,
              'extra', i.extra, 'rare', i.rare, 'price', i.price,
              'creature', crate_occupant(p_world, i.creature))
            order by i.price nulls last, i.id)
          from item i where i.world_id = p_world and i.holder in ('furniture', 'counter') and i.placed = pl.id
            and (i.price is not null or pl.made_by = me)), '[]'::jsonb))
        order by pl.made_by = me desc, pl.id)
      from placed pl
      where pl.world_id = p_world
        -- Every stall, and every shop counter still standing (`counters.ts`).
        and ((pl.kind = 'furniture' and pl.sub = 'stall') or (pl.kind = 'counter' and counter_standing(pl)))
        and (v_board or pl.made_by = me)), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.occupied_crate_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(c.name, 'A wildermon')
         || ' is in that crate. A crate with a wildermon in it can be carried, set down, opened or traded, and nothing else.'
    from item i left join creature c on c.world_id = i.world_id and c.id = i.creature
   where p_action not in ('examine', 'examine_item', 'place_furniture', 'crate_follow', 'crate_work',
                          'lock_item', 'unlock_item', 'name_thing', 'store_in_furniture', 'take_from_store',
                          -- And on a shop counter (`counters.ts`).
                          'set_out_goods', 'take_off_counter')
     and i.world_id = p_world and i.id = target_item(p_target) and i.creature is not null
$function$;

CREATE OR REPLACE FUNCTION public.occupied_crate_stays()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.inside is not null
     or new.holder not in ('player', 'furniture', 'post', 'counter')
     or (new.holder = 'furniture' and not coalesce((
           select f.stall from placed pl join furniture_def f on f.id = pl.sub
            where pl.world_id = new.world_id and pl.id = new.placed and pl.kind = 'furniture'), false))
     or (new.price is not null and new.holder not in ('furniture', 'counter'))
     or (new.letter is not null and new.holder <> 'post')
     or (new.deal is not null and new.holder <> 'player') then
    raise exception 'A creature crate with a wildermon in it is carried, set down, opened or traded, and nothing else.';
  end if;
  return new;
end $function$;

select private.lock_doors();
