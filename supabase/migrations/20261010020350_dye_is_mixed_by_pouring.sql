-- Dye is a liquid, boiled in three colours and mixed by pouring.
--
-- `src/game/dyestuffs.ts` and `src/game/dyes.ts` are the rules; this is the
-- island's half of them, function for function, and `supabase/test/dyes.ts`
-- holds the two against each other over many mixes.
--
-- A dye is a mix of red, yellow and blue as parts of `dye_parts()` that add up
-- to it, and a QL. Boiling a dyestuff in a bucket of lye gives one primary,
-- pure; everything else is mixed by pouring one dye into another, the parts
-- and the QL each the average of the two by litres. Its colour is the mix
-- looked up in the RYB cube by trilinear interpolation, then taken toward
-- black below QL 50 and white above it. It is written in the `dye` text a
-- thing already has: `#rrggbb` on a thing dyed, and the dye itself on a
-- vessel of it -- `r600y0b400q4125` on a barrel, with `l3`, its litres, on a
-- bucket.
--
-- Everything already dyed keeps its colour as its hex, and a pot of an old
-- dye becomes a litre of the nearest mix in a bucket of dye (`dye_legacy`).

/* ---- the liquid ------------------------------------------------------------ */

do $$ begin
  create type dye_mix as (red int, yellow int, blue int, ql double precision, litres int);
exception when duplicate_object then null; end $$;

/** A QL kept to the hundredth, between black's and white's. */
create or replace function dye_ql(p double precision) returns double precision
  language sql immutable as $$
  select floor(greatest(dye_ql_black(), least(dye_ql_white(), p)) * 100 + 0.5) / 100
$$;

/** A dye read off its text, or null: `dyeText`'s other half (`readDye`). */
create or replace function dye_read(p_text text) returns dye_mix
  language sql immutable as $$
  select case when m is null then null
              else row(m[1]::int, m[2]::int, m[3]::int, m[4]::double precision / 100, coalesce(m[5]::int, 0))::dye_mix end
  from (select regexp_match(p_text, '^r(\d+)y(\d+)b(\d+)q(\d+)(?:l(\d+))?$') m) x
$$;

/** A dye written down, with its litres on the end for a bucket (`dyeText`). */
create or replace function dye_text(d dye_mix, p_litres int default null) returns text
  language sql immutable as $$
  select 'r' || d.red || 'y' || d.yellow || 'b' || d.blue || 'q' || floor(d.ql * 100 + 0.5)::bigint
      || coalesce('l' || p_litres, '')
$$;

/** One primary, pure, at a QL (`pureDye`). */
create or replace function dye_pure(p_primary text, p_ql double precision) returns dye_mix
  language sql immutable as $$
  select row(case when p_primary = 'red' then dye_parts()::int else 0 end,
             case when p_primary = 'yellow' then dye_parts()::int else 0 end,
             case when p_primary = 'blue' then dye_parts()::int else 0 end,
             dye_ql(p_ql), null)::dye_mix
$$;

/**
 * Two dyes poured together, by litres (`mixDye`): red and yellow rounded to
 * the part, blue what is left, the QL the average to the hundredth.
 */
create or replace function dye_mixed(a dye_mix, la double precision, b dye_mix, lb double precision) returns dye_mix
  language plpgsql immutable as $$
declare v_all double precision; v_red int; v_yellow int;
begin
  if la <= 0 then return b; end if;
  if lb <= 0 then return a; end if;
  v_all := la + lb;
  v_red := floor((a.red * la + b.red * lb) / v_all + 0.5)::int;
  v_yellow := floor((a.yellow * la + b.yellow * lb) / v_all + 0.5)::int;
  return row(v_red, v_yellow, dye_parts()::int - v_red - v_yellow, dye_ql((a.ql * la + b.ql * lb) / v_all), null)::dye_mix;
end $$;

/* ---- its colour ----------------------------------------------------------- */

/** One channel of the RYB cube at x, y, z: trilinear between the eight corners (`cube`). */
create or replace function ryb_channel(c int, x double precision, y double precision, z double precision)
  returns double precision language plpgsql immutable as $$
declare k double precision[] := ryb_cube(); c00 double precision; c10 double precision; c01 double precision;
        c11 double precision; c0 double precision; c1 double precision;
begin
  c00 := k[0 * 3 + c + 1] * (1 - x) + k[1 * 3 + c + 1] * x;
  c10 := k[2 * 3 + c + 1] * (1 - x) + k[3 * 3 + c + 1] * x;
  c01 := k[4 * 3 + c + 1] * (1 - x) + k[5 * 3 + c + 1] * x;
  c11 := k[6 * 3 + c + 1] * (1 - x) + k[7 * 3 + c + 1] * x;
  c0 := c00 * (1 - y) + c10 * y;
  c1 := c01 * (1 - y) + c11 * y;
  return c0 * (1 - z) + c1 * z;
end $$;

/** A dye's colour as red, green and blue, 0 to 255 (`dyeRgb`). */
create or replace function dye_rgb(d dye_mix) returns int[]
  language plpgsql immutable as $$
declare v_most double precision; x double precision; y double precision; z double precision;
        v_ql double precision; v_pure double precision; v double precision; v_out int[] := '{}'; c int;
begin
  v_most := greatest(d.red, d.yellow, d.blue, 1);
  x := d.red / v_most; y := d.yellow / v_most; z := d.blue / v_most;
  v_ql := greatest(dye_ql_black(), least(dye_ql_white(), d.ql));
  for c in 0..2 loop
    v_pure := ryb_channel(c, x, y, z);
    -- Black at 1, the mix at 50, white at 100.
    v := case when v_ql <= dye_ql_pure() then v_pure * ((v_ql - dye_ql_black()) / (dye_ql_pure() - dye_ql_black()))
              else v_pure + (1 - v_pure) * ((v_ql - dye_ql_pure()) / (dye_ql_white() - dye_ql_pure())) end;
    v_out := v_out || floor(v * 255 + 0.5)::int;
  end loop;
  return v_out;
end $$;

create or replace function rgb_hex(p int[]) returns text language sql immutable as $$
  select '#' || lpad(to_hex(p[1]), 2, '0') || lpad(to_hex(p[2]), 2, '0') || lpad(to_hex(p[3]), 2, '0')
$$;
create or replace function hex_rgb(p text) returns int[] language sql immutable as $$
  select array[('x' || substr(p, 2, 2))::bit(8)::int, ('x' || substr(p, 4, 2))::bit(8)::int, ('x' || substr(p, 6, 2))::bit(8)::int]
$$;
/** A dye's colour, `#rrggbb` (`dyeHex`). */
create or replace function dye_hex(d dye_mix) returns text language sql immutable as $$ select rgb_hex(dye_rgb(d)) $$;

/** How far apart two colours look: the redmean weighting, squared (`colourDistance`). */
create or replace function colour_distance(a int[], b int[]) returns double precision
  language plpgsql immutable as $$
declare rm double precision := (a[1] + b[1])::double precision / 2;
        dr double precision := a[1] - b[1]; dg double precision := a[2] - b[2]; db double precision := a[3] - b[3];
begin
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
end $$;

/** The plain word for a colour: the nearest in `dye_word_def`, the first of them on a tie (`colourWord`); none for no colour. */
create or replace function colour_word(p_hex text) returns text language sql stable as $$
  select w.word from dye_word_def w where p_hex is not null
   order by colour_distance(hex_rgb(p_hex), hex_rgb(w.hex)), w.ord limit 1
$$;

/** The colour on a thing as `#rrggbb`, whichever way it was written: a colour, a dye, or an old dye's id (`dyeHexOf`). */
create or replace function dye_hex_of(p_dye text) returns text language sql stable as $$
  select case when p_dye is null then null
              when p_dye ~ '^#[0-9a-f]{6}$' then p_dye
              when dye_read(p_dye) is not null then dye_hex(dye_read(p_dye))
              else (select l.hex from dye_legacy l where l.id = p_dye) end
$$;
create or replace function dye_word_of(p_dye text) returns text language sql stable as $$
  select colour_word(dye_hex_of(p_dye))
$$;

/* ---- what is said of it ---------------------------------------------------- */

/** "60% red and 40% blue" (`sharesSaid`). */
create or replace function dye_shares_said(d dye_mix) returns text language sql immutable as $$
  with p(ord, name, n) as (values (1, 'red', d.red), (2, 'yellow', d.yellow), (3, 'blue', d.blue)),
       s as (select ord, (n / 10) || case when n % 10 <> 0 then '.' || (n % 10) else '' end || '% ' || name as said
               from p where n > 0),
       c as (select count(*) as k from s)
  select coalesce(case when (select k from c) <= 1 then (select said from s)
    else (select string_agg(said, ', ' order by ord) from s where ord < (select max(ord) from s))
         || ' and ' || (select said from s order by ord desc limit 1) end, 'nothing')
$$;

/** A QL to the hundredth: "41.25". */
create or replace function dye_ql_said(p double precision) returns text language sql immutable as $$
  select (floor(p * 100 + 0.5)::bigint / 100) || '.' || lpad((floor(p * 100 + 0.5)::bigint % 100)::text, 2, '0')
$$;

/** What Examine says of dye in anything that holds it (`dyeSays`). */
create or replace function dye_says(d dye_mix, p_litres double precision) returns text language sql stable as $$
  select p_litres::bigint || case when p_litres = 1 then ' litre' else ' litres' end || ' of '
      || colour_word(dye_hex(d)) || ' dye, ' || dye_hex(d) || ' at QL ' || dye_ql_said(d.ql) || ': ' || dye_shares_said(d) || '.'
$$;

/* ---- in a bucket ------------------------------------------------------------ */

/** The dye in a bucket of it, its litres on it; null for anything else (`dyeIn`). */
create or replace function dye_in(it item) returns dye_mix language sql immutable as $$
  select case when it.def = 'dye_bucket' then dye_read(it.dye) end
$$;

/** Litres it takes to dye one of these (`dyeLitresFor`): a garment unless it is something bigger. */
create or replace function dye_litres_for(p_def text) returns int language sql stable as $$
  select litres from dye_litres_def
   where size = coalesce((select s.size from dye_size_def s where s.id = p_def), 'garment')
$$;
create or replace function dye_litres_of(p_size text) returns int language sql stable as $$
  select litres from dye_litres_def where size = p_size
$$;

/**
 * The bucket of dye a dyeing uses (`pickDye`): of those loose in the pack and
 * not kept back that hold at least `p_litres`, the lowest numbered.
 */
create or replace function pick_dye(p_world uuid, p_uid uuid, p_litres int) returns item
  language sql stable as $$
  select i.* from item i
  where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
    and i.def = 'dye_bucket' and not i.locked and (dye_in(i)).litres >= p_litres
  order by i.id
  limit 1
$$;

create or replace function no_dye() returns text language sql immutable as $$
  select 'You have no dye in your pack. Boil a dyestuff in a bucket of lye for red, yellow or blue dye.'
$$;
/** Why there is nothing to dye with, for a dyeing of `p_litres` (`dyeRefusal`). */
create or replace function dye_refusal(p_world uuid, p_uid uuid, p_litres int) returns text
  language sql stable as $$
  select case when (pick_dye(p_world, p_uid, p_litres)).id is not null then null
              when exists (select 1 from item i where i.world_id = p_world and i.holder = 'player'
                             and i.holder_uid = p_uid and i.def = 'dye_bucket' and dye_in(i) is not null)
                then 'It takes ' || p_litres || case when p_litres = 1 then ' litre' else ' litres' end
                     || ' of dye, and no bucket of dye in your pack holds that much.'
              else no_dye() end
$$;
create or replace function dyed_already(p_hex text) returns text language sql stable as $$
  select 'It is ' || colour_word(p_hex) || ' already, ' || p_hex || '.'
$$;
create or replace function litres_word(n int) returns text language sql immutable as $$
  select n || case when n = 1 then ' litre' else ' litres' end
$$;

/** Take litres out of a bucket of dye, leaving an empty bucket when it is the last of it (`spendDye`). */
create or replace function spend_dye(p_id bigint, p_litres int) returns boolean
  language plpgsql as $$
declare it item; d dye_mix;
begin
  select * into it from item where id = p_id for update;
  d := dye_in(it);
  if d is null or d.litres < p_litres then return false; end if;
  if d.litres - p_litres <= 0 then return vessel_becomes(p_id, 'bucket'); end if;
  update item set dye = dye_text(d, d.litres - p_litres) where id = p_id;
  return true;
end $$;

/**
 * A boil, come off the bench (`boiledDye`): the bucket holds the dyestuff's
 * primary at the boil's QL, `dye_boil_litres()` of it (a Naturalist's Double
 * Boil, `litres:dye`, more) for each go, up to a bucket.
 */
create or replace function dye_boiled(p_world uuid, p_uid uuid, p_item bigint, p_recipe text) returns void
  language plpgsql as $$
declare it item; v_primary text; v_litres int;
begin
  select primary_colour into v_primary from dyestuff_def where recipe = p_recipe;
  select * into it from item where id = p_item;
  if v_primary is null or it.id is null or it.def <> 'dye_bucket' then return; end if;
  v_litres := least(bucket_litres(), pk(p_world, p_uid, 'litres:dye', dye_boil_litres()) * greatest(1, it.count))::int;
  update item set count = 1, dye = dye_text(dye_pure(v_primary, it.ql), v_litres) where id = p_item;
end $$;

/* ---- in a barrel ------------------------------------------------------------ */

/** Why one liquid will not go in with another (`noMixing`). */
create or replace function no_mixing(p_from text, p_into text, p_vessel text) returns text
  language sql stable as $$
  select (select upper(left(name, 1)) || substr(name, 2) from liquid_def where id = p_from)
      || ' will not mix with ' || (select name from liquid_def where id = p_into) || '. The ' || p_vessel
      || ' holds ' || (select name from liquid_def where id = p_into) || ': empty it, or use one that is empty or holds '
      || (select name from liquid_def where id = p_from) || '.'
$$;

/** The dye in a vessel standing about, if it holds dye. */
create or replace function placed_dye(p placed) returns dye_mix language sql immutable as $$
  select case when p.liquid = 'dye' then dye_read(p.dye) end
$$;

/**
 * Why a bucket of `p_kind` has no barrel to go into, where the reason is that
 * dye and something else would mix (`mixRefusal`): the emptiest barrel beside
 * you holding the other, or null.
 */
create or replace function mix_refusal(p_world uuid, p_uid uuid, p_kind text) returns text
  language sql stable as $$
  select no_mixing(p_kind, placed_liquid(p), lower(placed_name(p)))
    from placed p
   where p.world_id = p_world and p.kind = 'furniture' and holds_liquid(p) and not is_well(p)
     and placed_litres(p) > 0 and placed_liquid(p) is not null and placed_liquid(p) <> p_kind
     and (p_kind = 'dye' or placed_liquid(p) = 'dye')
     and near_piece(p_world, p_uid, p, 2.6)
   order by placed_litres(p), p.id
   limit 1
$$;

/** What Examine says of a vessel standing about (`vesselSays`). */
create or replace function vessel_says(p placed) returns text language sql stable as $$
  select placed_name(p) || ': QL ' || to_char(p.ql, 'FM990.00') || ', '
      || round(placed_litres(p))::bigint || ' of ' || round(liquid_capacity(p))::bigint || ' litres. '
      || case when placed_litres(p) <= 0 or placed_liquid(p) is null then 'It is empty.'
              when placed_dye(p) is not null then 'It holds ' || dye_says(placed_dye(p), placed_litres(p))
              else 'It holds ' || round(placed_litres(p))::bigint || ' litres of '
                   || (select name from liquid_def where id = placed_liquid(p)) || '.' end
$$;

/** What Examine adds for an item: the dye in it, or the colour it was dyed. */
create or replace function dye_item_says(it item) returns text language sql stable as $$
  select case when dye_in(it) is not null then ' It holds ' || dye_says(dye_in(it), (dye_in(it)).litres)
              when dye_hex_of(it.dye) is not null then ' It is dyed ' || dye_hex_of(it.dye) || '.'
              else '' end
$$;

/* ---- the doors ------------------------------------------------------------ */

/** The liquid doors, and Examine on a vessel. */
CREATE OR REPLACE FUNCTION public.liquid_action(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in ('fill_bucket', 'fill_skin', 'empty_bucket',
                      'empty_vessel', 'drink_from_vessel', 'pour_into_barrel',
                      -- Examine on a vessel, which says what is in it (`vessel_says`).
                      'examine_vessel')
$function$;

CREATE OR REPLACE FUNCTION public.draw_from(p_id bigint, p_litres double precision)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare p placed; v_left double precision;
begin
  perform well_settle(p_id);
  select * into p from placed where id = p_id for update;
  if not found or placed_litres(p) < p_litres then return false; end if;
  v_left := placed_litres(p) - p_litres;
  update placed set litres = v_left, since = now(),
      liquid = case when v_left <= 0 and not is_well(p) then null else p.liquid end,
      -- And its brewer's hand in it goes with the last of it.
      knack = case when v_left <= 0 and not is_well(p) then null else p.knack end,
      -- And the dye in it, the same.
      dye = case when v_left <= 0 and not is_well(p) then null else p.dye end
    where id = p_id;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.vessel_becomes(p_id bigint, p_def text, p_knack double precision DEFAULT NULL::double precision)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare it item; v_mark jsonb;
begin
  if p_def is null then return false; end if;
  select * into it from item where id = p_id for update;
  if not found or it.count < 1 then return false; end if;
  -- The knack of what it holds goes with what it holds, and out with it (a
  -- Cook's Strong Brew). The rest of its mark is the vessel's and stays.
  v_mark := nullif(coalesce(it.mark, '{}'::jsonb) - 'knack'
    || case when p_knack is not null and p_knack <> 1 then jsonb_build_object('knack', p_knack) else '{}'::jsonb end,
    '{}'::jsonb);
  if it.count = 1 then
    update item set def = p_def, charges = (select charges from item_def where id = p_def), mark = v_mark,
        -- And the dye in a bucket of dye goes out with it.
        dye = case when p_def = 'dye_bucket' then dye end
      where id = p_id;
    return true;
  end if;
  update item set count = count - 1 where id = p_id;
  insert into item (world_id, holder, holder_uid, gx, gy, inside, def, ql, dmg, count, extra, rare,
                    dye, bless, charges, locked, issued, made_at, crate, lit, lit_at, placed, rot_at, maker, piece, mark)
  values (it.world_id, it.holder, it.holder_uid, it.gx, it.gy, it.inside, p_def, it.ql, it.dmg, 1, it.extra, it.rare,
          case when p_def = 'dye_bucket' then it.dye end, it.bless, (select charges from item_def where id = p_def), it.locked, it.issued, it.made_at,
          it.crate, it.lit, it.lit_at, it.placed, it.rot_at, it.maker, it.piece, v_mark);
  return true;
end $function$;

CREATE OR REPLACE FUNCTION public.liquid_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare it item; p placed; v_kind text;
begin
  if p_action in ('fill_bucket', 'fill_skin', 'empty_bucket', 'pour_into_barrel') then
    it := carried(p_world, p_uid, target_item(p_target));
    if it.id is null then return 'It is gone.'; end if;
  else
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint
      and kind = 'furniture';
    if not found then return 'It is gone.'; end if;
    if not near_piece(p_world, p_uid, p) then return 'Stand next to it.'; end if;
  end if;

  if p_action = 'fill_bucket' then
    -- A bucket of dye with room in it tops up from dye, and from nothing else (`dyeSourceFor`).
    if it.def = 'dye_bucket' then return dye_source_refusal(p_world, p_uid, it); end if;
    if it.def <> 'bucket' then return 'That is not an empty bucket.'; end if;
    if not exists (select 1 from vessels_near(p_world, p_uid) v
                    where placed_litres(v) >= bucket_litres() or (placed_liquid(v) = 'dye' and placed_litres(v) >= 1))
       and not near_water(p_world, p_uid) then
      return 'You need water: a shore, a well, or a barrel with something in it.';
    end if;

  elsif p_action = 'fill_skin' then
    if (select charges from item_def where id = it.def) is null then
      return 'That does not hold water.';
    end if;
    if coalesce(it.charges, 0) >= (select charges from item_def where id = it.def) then
      return 'It is already full.';
    end if;
    if not water_near(p_world, p_uid) then
      return 'You need water: a shore, a well, or a barrel of it.';
    end if;

  elsif p_action = 'empty_bucket' then
    if not exists (select 1 from vessel_def where item = it.def) then
      return 'That is not a bucket of anything.';
    end if;

  elsif p_action = 'pour_into_barrel' then
    select liquid into v_kind from vessel_def where item = it.def;
    if v_kind is null then return 'That is not a bucket of anything.'; end if;
    if (barrel_for(p_world, p_uid, v_kind)).id is null then
      -- Dye and anything else will not mix, and that is said when it is the reason.
      return coalesce(mix_refusal(p_world, p_uid, v_kind), 'There is no barrel beside you with room for '
        || (select name from liquid_def where id = v_kind) || '.');
    end if;

  elsif p_action = 'examine_vessel' then
    if not holds_liquid(p) then return 'That holds no liquid.'; end if;

  elsif p_action = 'empty_vessel' then
    if not holds_liquid(p) or is_well(p) then return 'That is not something you tip out.'; end if;
    if placed_litres(p) <= 0 then return 'It is already empty.'; end if;

  elsif p_action = 'drink_from_vessel' then
    if not holds_liquid(p) then return 'There is nothing in that to drink.'; end if;
    if not coalesce((select drinkable from liquid_def where id = placed_liquid(p)), false) then
      return 'You would not want to drink that.';
    end if;
    if placed_litres(p) < 1 then return 'It is dry.'; end if;
    if coalesce((select (stats->>'thirst')::double precision from player
                 where world_id = p_world and uid = p_uid), 1) >= 0.999
       and not coalesce((select brew from liquid_def where id = placed_liquid(p)), false) then
      return 'You are not thirsty.';
    end if;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_liquid(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare it item; p placed; v_kind text; v_from placed; v_full text; v_room double precision;
        v_poured double precision; v_favour text; v_full_msg text; v_thirst double precision;
        v_dye dye_mix; v_mixed dye_mix; v_had double precision; v_n int;
begin
  if p_action in ('fill_bucket', 'fill_skin', 'empty_bucket', 'pour_into_barrel') then
    it := carried(p_world, p_uid, target_item(p_target));
    if it.id is null then return; end if;
  else
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
  end if;

  if p_action = 'fill_bucket' then
    -- A bucket of dye tops up from dye beside you (`dyeSourceFor`).
    if it.def = 'dye_bucket' then
      select * into v_from from vessels_near(p_world, p_uid, 'dye') v limit 1;
      if v_from.id is not null then perform draw_dye(p_world, p_uid, v_from, it); end if;
      return;
    end if;
    -- A barrel beside you first, and the shore only if there is none; dye however little there is of it.
    select * into v_from from vessels_near(p_world, p_uid) v
      where placed_litres(v) >= bucket_litres() or (placed_liquid(v) = 'dye' and placed_litres(v) >= 1) limit 1;
    if found and placed_liquid(v_from) = 'dye' then
      perform draw_dye(p_world, p_uid, v_from, it);
      return;
    end if;
    if found then
      v_kind := placed_liquid(v_from);
      if not draw_from(v_from.id, bucket_litres()) then return; end if;
    elsif near_water(p_world, p_uid) then
      v_kind := 'water';
    else
      return;
    end if;
    select item into v_full from vessel_def where liquid = v_kind limit 1;
    -- What the barrel's brewer put into it goes into the bucket (a Cook's Strong Brew).
    if not vessel_becomes(it.id, v_full, v_from.knack) then return; end if;
    perform tell(p_world, p_uid, case when v_from.id is not null
      then 'You draw a bucket of ' || (select name from liquid_def where id = v_kind)
           || ' out of the ' || lower(placed_name(v_from)) || '.'
      else 'You dip the bucket full of water.' end, 'event');

  elsif p_action = 'fill_skin' then
    update item set charges = (select charges from item_def where id = it.def) where id = it.id;
    perform tell(p_world, p_uid, 'You fill the '
      || lower((select name from item_def where id = it.def)) || ' with water.', 'event');

  elsif p_action = 'empty_bucket' then
    select empty into v_full from vessel_def where item = it.def;
    if v_full is null then return; end if;
    if not vessel_becomes(it.id, v_full) then return; end if;
    perform tell(p_world, p_uid, 'You tip the '
      || lower((select name from item_def where id = it.def)) || ' out.', 'event');

  elsif p_action = 'pour_into_barrel' then
    select liquid into v_kind from vessel_def where item = it.def;
    v_from := barrel_for(p_world, p_uid, v_kind);
    if v_from.id is null then return; end if;
    v_room := liquid_capacity(v_from) - placed_litres(v_from);
    -- Dye: as much of the bucket as there is room for, mixed into what is there; the rest stays in the bucket.
    v_dye := dye_in(it);
    if v_dye is not null then
      v_n := least(v_dye.litres, floor(v_room))::int;
      if v_n <= 0 then return; end if;
      v_had := placed_litres(v_from);
      v_mixed := case when placed_dye(v_from) is not null and v_had > 0 then dye_mixed(placed_dye(v_from), v_had, v_dye, v_n)
                      else v_dye end;
      if v_dye.litres - v_n <= 0 then
        if not vessel_becomes(it.id, 'bucket') then return; end if;
      else
        update item set dye = dye_text(v_dye, v_dye.litres - v_n) where id = it.id;
      end if;
      update placed set litres = v_had + v_n, liquid = 'dye', dye = dye_text(v_mixed), knack = null, since = now()
        where id = v_from.id;
      perform tell(p_world, p_uid, 'You pour ' || litres_word(v_n) || ' of dye into the '
        || lower(placed_name(v_from)) || '. It holds ' || dye_says(v_mixed, v_had + v_n), 'event');
      return;
    end if;
    v_poured := least(bucket_litres(), v_room);
    if v_poured <= 0 then return; end if;
    if not vessel_becomes(it.id, (select empty from vessel_def where item = it.def)) then return; end if;
    update placed set litres = placed_litres(v_from) + v_poured, liquid = v_kind, since = now(),
        -- What is poured in is only as good as the worst of what it goes into
        -- (a Cook's Strong Brew): nothing plain is made better by the barrel.
        knack = nullif(case when placed_litres(v_from) > 0 then least(coalesce(v_from.knack, 1), mark_of(it.mark, 'knack'))
                            else mark_of(it.mark, 'knack') end, 1)
      where id = v_from.id;
    perform tell(p_world, p_uid, 'You pour ' || to_char(v_poured, 'FM990') || ' litres of '
      || (select name from liquid_def where id = v_kind) || ' into the '
      || lower(placed_name(v_from)) || '. '
      || to_char(placed_litres(v_from) + v_poured, 'FM990') || ' of '
      || to_char(liquid_capacity(v_from), 'FM990') || '.', 'event');

  elsif p_action = 'empty_vessel' then
    v_kind := coalesce((select name from liquid_def where id = placed_liquid(p)), 'it');
    update placed set litres = 0, liquid = null, knack = null, dye = null, since = now() where id = p.id;
    perform tell(p_world, p_uid, 'You tip the ' || v_kind || ' out of the '
      || lower(placed_name(p)) || '.', 'event');

  elsif p_action = 'examine_vessel' then
    perform tell(p_world, p_uid, vessel_says(p), 'event');

  elsif p_action = 'drink_from_vessel' then
    if not draw_from(p.id, 1) then return; end if;
    v_thirst := coalesce((select (stats->>'thirst')::double precision from player
                          where world_id = p_world and uid = p_uid), 1);
    update player set stats = jsonb_set(stats, '{thirst}', to_jsonb(least(1, v_thirst + 0.5)))
      where world_id = p_world and uid = p_uid;
    -- A brew straight out of the barrel favours a trade like any other.
    if coalesce((select brew from liquid_def where id = placed_liquid(p)), false) then
      select item into v_full from vessel_def where liquid = placed_liquid(p) limit 1;
      -- And for longer for its brewer's hand in it (a Cook's Strong Brew).
      v_favour := grant_boon(p_world, p_uid, v_full, p.ql, coalesce(p.knack, 1));
      v_full_msg := nourish(p_world, p_uid, v_full, p.ql);
    end if;
    perform tell(p_world, p_uid, 'You drink your fill from the ' || lower(placed_name(p)) || '.'
      || coalesce(' ' || v_favour, '') || coalesce(' ' || v_full_msg, ''), 'event');
  end if;
end $function$;

/**
 * Draw up to a bucket's room of dye out of a vessel into a bucket, mixed with
 * what the bucket holds (`drawDye`), and say so (`drewDye`).
 */
create or replace function draw_dye(p_world uuid, p_uid uuid, p placed, it item) returns void
  language plpgsql as $$
declare v_had dye_mix; v_there dye_mix; v_room int; v_n int; v_mixed dye_mix; v_one bigint; v_total int;
begin
  v_had := dye_in(it);
  v_there := placed_dye(p);
  if v_there is null then return; end if;
  v_room := bucket_litres()::int - coalesce(v_had.litres, 0);
  v_n := least(v_room, floor(placed_litres(p)))::int;
  if v_n <= 0 or not draw_from(p.id, v_n) then return; end if;
  v_mixed := case when v_had is not null then dye_mixed(v_had, v_had.litres, v_there, v_n) else v_there end;
  v_total := coalesce(v_had.litres, 0) + v_n;
  if it.def = 'dye_bucket' then
    v_one := it.id;
  else
    -- An empty bucket becomes a bucket of dye: the one off the top of a pile of them, which is the newest row.
    if not vessel_becomes(it.id, 'dye_bucket') then return; end if;
    v_one := case when it.count > 1 then (select max(i.id) from item i where i.world_id = p_world and i.def = 'dye_bucket'
                                            and i.holder is not distinct from it.holder and i.holder_uid is not distinct from it.holder_uid)
                  else it.id end;
  end if;
  update item set dye = dye_text(v_mixed, v_total) where id = v_one;
  perform tell(p_world, p_uid, 'You draw ' || litres_word(v_n) || ' of dye out of the '
    || lower((select coalesce(f.name, p.sub) from furniture_def f where f.id = p.sub))
    || '. The bucket holds ' || dye_says(v_mixed, v_total), 'event');
end $$;

/** Why a bucket of dye will not top up here (`dyeSourceFor`), or null. */
create or replace function dye_source_refusal(p_world uuid, p_uid uuid, it item) returns text
  language plpgsql stable as $$
declare other_liquid text;
begin
  if dye_in(it) is null then return 'That is not a bucket of dye.'; end if;
  if (dye_in(it)).litres >= bucket_litres() then return 'It is already full.'; end if;
  if exists (select 1 from vessels_near(p_world, p_uid, 'dye')) then return null; end if;
  select placed_liquid(vn) into other_liquid from vessels_near(p_world, p_uid) vn where placed_liquid(vn) is not null limit 1;
  if other_liquid is not null then return no_mixing(other_liquid, 'dye', 'bucket'); end if;
  if near_water(p_world, p_uid) then return no_mixing('water', 'dye', 'bucket'); end if;
  return 'There is no barrel of dye beside you to fill it from.';
end $$;

/* ---- what a thing is called and what Examine says --------------------------- */

CREATE OR REPLACE FUNCTION public.item_name(it item)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select case when w.words = '' then b.base
              else upper(left(w.words, 1)) || substr(w.words, 2) || ' ' || lower(b.base) end
      || coalesce(' (' || lower(it.extra) || ')', '')
      -- A bucket of dye says how much is in it (`itemName`).
      || coalesce(' (' || litres_word((dye_in(it)).litres) || ')', '')
      || case when d.charges is null then ''
              else ' (' || coalesce(it.charges, 0)::text || '/' || d.charges::text || ')' end
  from item_def d
  cross join lateral (select case when it.def = 'casting' and it.piece is not null
                                  then coalesce((select c.name from item_def c where c.id = it.piece), it.piece) || ' casting'
                                  -- A bucket of dye is called by the colour of what is in it: a Bucket of purple dye.
                                  when dye_in(it) is not null
                                  then regexp_replace(d.name, ' dye$', '') || ' ' || colour_word(dye_hex(dye_in(it))) || ' dye'
                                  else d.name end as base) b
  cross join lateral (select btrim(concat_ws(' ',
      case when dye_in(it) is null then dye_word_of(it.dye) end, it.rare)) as words) w
  where d.id = it.def
$function$;

CREATE OR REPLACE FUNCTION public.examine_item_text(p_world uuid, p_uid uuid, it item)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare d item_def; m material_def; r rarity_def; v_worth double precision;
        v_skill text; v_out text;
begin
  select * into d from item_def where id = it.def;
  if not found then return 'It is nothing you have a name for.'; end if;
  m := mat_of(it.extra);
  select * into r from rarity_def where id = it.rare;
  v_worth := tool_worth(it.ql, it.dmg, it.extra, it.rare, it.bless);

  v_out := item_name(it) || ': QL ' || to_char(it.ql, 'FM990.00')
    || ', damage ' || to_char(it.dmg, 'FM990.00')
    || ', weight ' || to_char(item_weight(it), 'FM990.00') || ' kg.';
  if d.category = 'tool' and abs(v_worth - it.ql) >= 0.05 then
    v_out := v_out || ' It works as a ' || to_char(v_worth, 'FM990.0') || ' today.';
  end if;
  if d.description is not null then v_out := v_out || ' ' || d.description; end if;
  -- What dye is in it, or what colour it was dyed (`dyestuffs.ts`).
  v_out := v_out || dye_item_says(it);
  if r.id is not null then
    v_out := v_out || ' It is ' || r.id || ': better at what it is for by a '
      || case when r.boost > 1.3 then 'half' when r.boost > 1.15 then 'quarter' else 'tenth' end
      || ', slower to wear and to rot, and can be bettered ' || to_char(r.ceiling, 'FM990')
      || ' past your own skill.';
  end if;
  -- Rare work is signed.
  if it.maker is not null then v_out := v_out || ' Made by ' || it.maker || '.'; end if;
  -- And what a maker's perks put into it.
  v_out := v_out || mark_says(it.mark);
  v_skill := boon_of((select seed from world where id = p_world), it.def);
  if v_skill is not null then
    v_out := v_out || ' It favours '
      || lower(coalesce((select name from skill_def where id = v_skill), v_skill)) || '.';
  end if;
  -- What it is made of is half of what it is — when it is made of anything.
  if m.name is not null and m.note is not null then
    v_out := v_out || ' ' || m.name || ': ' || m.note;
  end if;
  -- And to a Cook's tongue, what a helping of it does (a Cook's Taste).
  if pk(p_world, p_uid, 'taste', 0) > 0 then v_out := v_out || taste_says(p_world, it); end if;
  return v_out;
end $function$;

/* ---- dyeing ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION public.last_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare p player; pc placed; b bridge; d bridge_def; s bridge_span; c creature; mate creature;
        it item; dye item; bd brew_def; v_kind text; v_short text;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'set_bauble' then
    return bauble_refusal(p_world, p_uid, p_target);
  end if;
  if p_action = 'sacrifice' then
    return sacrifice_refusal(p_world, p_uid, p_target);
  end if;
  if p_action = 'absorb_mote' then
    return absorb_refusal(p_world, p_uid, p_target);
  end if;

  if p_action = 'plan_bridge' then
    v_kind := coalesce(p_target->>'material', 'rope');
    return bridge_reason(p_world, p_uid, v_kind, floor(p.x)::int, floor(p.y)::int,
      (p_target->>'x')::int, (p_target->>'y')::int);

  elsif p_action in ('build_bridge', 'demolish_bridge') then
    select * into b from bridge where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return 'It is gone.'; end if;
    select * into d from bridge_def where id = b.kind;
    if p_action = 'build_bridge' then
      select * into s from bridge_span sp where sp.world_id = p_world and sp.bridge = b.id
        and not span_done(sp.needed) order by sp.n limit 1;
      if not found then return 'It is finished.'; end if;
      if tool_ql(p_world, p_uid, d.tool) <= 0 then
        return 'You need a ' || lower((select coalesce(name, d.tool) from item_def where id = d.tool)) || '.';
      end if;
      if sqrt((s.x + 0.5 - p.x) ^ 2 + (s.y + 0.5 - p.y) ^ 2) > 4.5 then
        return 'Work from one end. Walk to the open part of the span.';
      end if;
      select e.key into v_short from jsonb_each(s.needed) e
        where (e.value)::int > 0 and pack_count(p_world, p_uid, e.key) < 1 order by e.key limit 1;
      if v_short is not null then
        return 'That span wants ' || span_wants(s.needed) || '; you are carrying no '
          || lower((select coalesce(name, v_short) from item_def where id = v_short)) || '.';
      end if;
    else
      -- gates: the far end's row, quoted: a record's field named by a reserved word is not found unquoted, so
      -- this refused nothing and raised "record b has no field by" instead, and nobody could pull a bridge down;
      -- and the reach, written once (`bridge_pull_reach`, `PULL_REACH`).
      if sqrt((b.ax + 0.5 - p.x) ^ 2 + (b.ay + 0.5 - p.y) ^ 2) > bridge_pull_reach()
         and sqrt((b.bx + 0.5 - p.x) ^ 2 + (b."by" + 0.5 - p.y) ^ 2) > bridge_pull_reach() then
        return 'Stand at one end of it.';
      end if;
      -- gates: where either end stands on a settlement, only its builders pull a bridge down, as only they take
      -- down a building's wall there (`may_shape`); anywhere else anybody may (`pullDownRefusal`).
      select dd.name into v_short from (values (1, b.ax, b.ay), (2, b.bx, b."by")) v(o, x, y)
        cross join lateral deed_covering(p_world, v.x, v.y) dd
       where not may_shape(p_world, p_uid, v.x, v.y)
       order by v.o, dd.founded_at limit 1;
      if v_short is not null then
        return 'That is part of ' || v_short || '. Only its builders may '
            || lower((select a.label from action_def a where a.id = p_action)) || ' there.';
      end if;
      -- gates: a padlock on a drawbridge's winch keeps it from being pulled down as from being worked.
      v_short := lock_refusal(p_world, p_uid, b.lock, b.ax, b.ay);
      if v_short is not null then return v_short; end if;
    end if;
    return null;

  elsif p_action = 'ring_bell' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint
      and kind = 'furniture';
    if not found or not coalesce((select f.bell from furniture_def f where f.id = pc.sub), false) then
      return 'That is not a bell.';
    end if;
    if not near_piece(p_world, p_uid, pc) then return 'Stand next to it.'; end if;
    if not on_my_deed(p_world, p_uid, pc.x, pc.y) then
      return 'Ring it on a settlement of yours; a bell in the wild calls nobody.';
    end if;
    return null;

  elsif p_action in ('sleep', 'set_home') then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint
      and kind = 'furniture';
    if not found or not is_bed(pc) then return 'That is not a bed.'; end if;
    if not near_piece(p_world, p_uid, pc) then return 'Stand next to it.'; end if;
    if p_action = 'sleep' and not is_night(p_world) then
      return 'It is ' || world_clock(p_world) || ' and broad daylight. Sleep when it is dark.';
    end if;
    if p_action = 'set_home' and p.home_x = pc.x and p.home_y = pc.y then
      return 'You already wake up here.';
    end if;
    return null;

  elsif p_action in ('pair_creature', 'read_blood') then
    perform creature_settle(p_world, (p_target->>'id')::int);
    perform herd_settle(p_world);
    c := target_creature(p_world, p_target);
    if c.world_id is null then return 'It is gone.'; end if;
    if p_action = 'read_blood' then return null; end if;
    if (my_deed(p_world, p_uid)).world_id is null then
      return 'Breeding is settled work. Found a settlement first: the young one goes to the token.';
    end if;
    if not creature_in_reach(p_world, p_uid, c, 2.4) then return 'Stand next to ' || c.name || '.'; end if;
    if c.due is not null then return c.name || ' is already in young.'; end if;
    mate := mate_for(p_world, c);
    if mate.id is null then
      return 'There is no ' || lower((select name from species_def where id = c.species))
        || ' of the other sex within ' || round(pair_range()) || ' tiles. ' || c.name
        || ' is ' || c.sex || '.';
    end if;
    return pair_refuses(p_world, c, mate);

  elsif p_action in ('dye_item', 'strip_dye') then
    select * into it from item where world_id = p_world and id = target_item(p_target)
      and holder = 'player' and holder_uid = p_uid;
    if p_action = 'dye_item' then
      if not found then return 'It is gone.'; end if;
      if not takes_dye(it.def) then return 'Nothing will take on that.'; end if;
      dye := pick_dye(p_world, p_uid, dye_litres_for(it.def));
      if dye.id is null then return dye_refusal(p_world, p_uid, dye_litres_for(it.def)); end if;
      if it.dye = dye_hex(dye_in(dye)) then return dyed_already(it.dye); end if;
    else
      if not found or it.dye is null or not takes_dye(it.def) then return 'It has taken no colour.'; end if;
      if pack_count(p_world, p_uid, 'lye_bucket') <= 0 then
        return 'You need a bucket of lye to strip it.';
      end if;
    end if;
    return null;

  elsif p_action = 'start_brew' then
    select * into bd from brew_def where id = p_target->>'brew';
    if not found then return 'Choose what to brew.'; end if;
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint
      and kind = 'furniture';
    return brew_reason(p_world, p_uid, pc, bd);
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_last(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_took boolean; p player; pc placed; b bridge; d bridge_def; s bridge_span; c creature; mate creature;
        dam creature; sire creature; it item; dye item; bd brew_def; dd dye_def;
        v_kind text; v_id bigint; v_h int; v_n int; v_left int; v_want text; v_back jsonb;
        v_parts text[]; v_half int; e record; r record; v_skill double precision;
        v_care double precision; v_one bigint; v_stock item; v_ql double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'set_bauble' then
    perform perform_bauble(p_world, p_uid, p_target);
    return;
  end if;
  if p_action = 'sacrifice' then
    perform perform_sacrifice(p_world, p_uid, p_target);
    return;
  end if;
  if p_action = 'absorb_mote' then
    perform perform_absorb(p_world, p_uid, p_target);
    return;
  end if;

  if p_action = 'plan_bridge' then
    v_kind := coalesce(p_target->>'material', 'rope');
    if bridge_reason(p_world, p_uid, v_kind, floor(p.x)::int, floor(p.y)::int,
         (p_target->>'x')::int, (p_target->>'y')::int) is not null then return; end if;
    select * into d from bridge_def where id = v_kind;
    v_h := round((centre_height(p_world, floor(p.x)::int, floor(p.y)::int)
                + centre_height(p_world, (p_target->>'x')::int, (p_target->>'y')::int)) / 2);
    insert into bridge (world_id, kind, ax, ay, bx, by, height, material, made_by)
    values (p_world, v_kind, floor(p.x)::int, floor(p.y)::int,
            (p_target->>'x')::int, (p_target->>'y')::int, v_h,
            case when v_kind = 'stone' then null else 'Oak' end, p_uid)
    returning id into v_id;
    -- gates: the first span, beside the end it is set out from, also takes a drawbridge's winch.
    insert into bridge_span (world_id, bridge, n, x, y, needed, total)
    select p_world, v_id, t.n, t.x, t.y, span_bill(v_kind, t.n), span_bill(v_kind, t.n)
    from span_tiles(floor(p.x)::int, floor(p.y)::int,
                    (p_target->>'x')::int, (p_target->>'y')::int) t;
    select count(*)::int into v_n from bridge_span sp where sp.world_id = p_world and sp.bridge = v_id;
    perform journal_note(p_world, p_uid, 'planned_bridge');
    perform skill_raise(p_world, p_uid, d.skill, 0.4);
    perform tell(p_world, p_uid, 'You set out a ' || lower(d.name) || ' of ' || v_n || ' span'
      || case when v_n > 1 then 's' else '' end || ' across. Each one wants '
      || span_wants(span_bill(v_kind)) || '. ' || d.note, 'system');

  elsif p_action = 'build_bridge' then
    select * into b from bridge where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    select * into d from bridge_def where id = b.kind;
    select * into s from bridge_span sp where sp.world_id = p_world and sp.bridge = b.id
      and not span_done(sp.needed) order by sp.n limit 1;
    if not found then return; end if;
    -- One unit of one thing per go, as with a wall.
    select e2.key into v_want from jsonb_each(s.needed) e2
      where (e2.value)::int > 0 and pack_count(p_world, p_uid, e2.key) > 0 order by e2.key limit 1;
    if v_want is null then return; end if;
    if not consume(p_world, p_uid, v_want, 1) then return; end if;
    update bridge_span sp set needed = jsonb_set(sp.needed, array[v_want],
        to_jsonb(greatest(0, (sp.needed->>v_want)::int - 1)))
      where sp.world_id = p_world and sp.bridge = b.id and sp.n = s.n
      returning * into s;
    perform skill_raise(p_world, p_uid, d.skill, 0.5);
    perform wear_tool((select i.id from item i where i.world_id = p_world and i.holder = 'player'
      and i.holder_uid = p_uid and i.def = d.tool
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1), 0.4);
    if span_done(s.needed) then
      v_left := bridge_left(p_world, b.id);
      if v_left > 0 then
        perform tell(p_world, p_uid, 'That span is decked. ' || v_left || ' still open.', 'event');
      else
        perform journal_note(p_world, p_uid, 'bridged');
        perform tell(p_world, p_uid, 'The last span is decked and the ' || lower(bridge_name(b))
          || ' is open. ' || case when d.carts then 'A cart will cross it.'
                                  else 'Foot traffic only; nothing with a wheel.' end, 'system');
      end if;
    else
      perform tell(p_world, p_uid, 'You work a '
        || lower((select coalesce(name, v_want) from item_def where id = v_want))
        || ' into the span. It still wants ' || span_wants(s.needed) || '.', 'event');
    end if;

  elsif p_action = 'demolish_bridge' then
    select * into b from bridge where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    -- Half of what went into it comes back, which is what pulling a thing down
    -- is worth anywhere else in the world.
    v_parts := '{}';
    for e in
      select k.key as item, sum((k.value)::int - coalesce((sp.needed->>k.key)::int, 0))::int as used
      from bridge_span sp cross join lateral jsonb_each(sp.total) k
      where sp.world_id = p_world and sp.bridge = b.id
      group by k.key order by k.key
    loop
      v_half := floor(e.used / 2.0)::int;
      if v_half > 0 then
        perform give(p_world, p_uid, e.item, v_half, 20);
        v_parts := v_parts || (v_half || ' ' ||
          lower((select coalesce(name, e.item) from item_def where id = e.item)));
      end if;
    end loop;
    delete from bridge_span where world_id = p_world and bridge = b.id;
    delete from bridge where world_id = p_world and id = b.id;
    perform tell(p_world, p_uid, case when array_length(v_parts, 1) > 0
      then 'You take the ' || lower(bridge_name(b)) || ' down and save '
           || array_to_string(v_parts, ', ') || '.'
      else 'You take the ' || lower(bridge_name(b)) || ' down.' end, 'event');

  elsif p_action = 'ring_bell' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    select * into p from player where world_id = p_world and uid = p_uid;
    r := deed_at(p_world, pc.x, pc.y);
    if r.world_id is null then return; end if;
    v_n := 0;
    -- Every wildermon working the deed drops what it is doing and walks to
    -- whoever rang: a leg to the ringer, and a while standing there before
    -- the work takes it back.
    for e in select cr.*, coalesce(sp.speed, 1) as pace
             from creature cr join species_def sp on sp.id = cr.species
             where cr.world_id = p_world and cr.mode = 'deed' and cr.hitched_to is null
               and cr.keeper in (select m.uid from deed_member m
                                 where m.world_id = p_world and m.founder = r.founded_by
                                 union select r.founded_by)
    loop
      v_ql := greatest(0.5, sqrt(power(p.x - e.to_x, 2) + power(p.y - e.to_y, 2)) / greatest(0.4, e.pace));
      update creature set phase = 'idle', work_x = null, work_y = null, enemy = null,
          from_x = e.to_x, from_y = e.to_y, to_x = p.x, to_y = p.y,
          leg_at = now(), leg_ends = now() + make_interval(secs => v_ql),
          until = now() + make_interval(secs => v_ql + 20)
        where world_id = p_world and id = e.id;
      v_n := v_n + 1;
    end loop;
    -- And every citizen hears where it hangs.
    for e in select m.uid from deed_member m where m.world_id = p_world and m.founder = r.founded_by
             union select r.founded_by
    loop
      if e.uid <> p_uid then
        perform tell(p_world, e.uid, 'The bell rings out over ' || r.name || ' from ' || pc.x || ', ' || pc.y || '.', 'system');
      end if;
    end loop;
    perform journal_note(p_world, p_uid, 'rang');
    perform tell(p_world, p_uid, 'You ring the ' || lower(placed_name(pc)) || ' and it sounds over ' || r.name || '. '
      || case when v_n > 0 then v_n || ' wildermon ' || case when v_n = 1 then 'comes' else 'come' end || ' at the sound'
              else 'Nothing is working the deed to come' end
      || ', and every citizen hears where it hangs: ' || pc.x || ', ' || pc.y || '.', 'event');

  elsif p_action = 'sleep' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    /*
     * A well-made bed is a better night than a cot with a thin mattress — and
     * a bed under a roof, in a room with walls all round it, is a better night
     * again than the same bed standing in a field in the weather.
     */
    perform journal_note(p_world, p_uid, 'slept');
    perform sleep_until_morning(p_world, p_uid,
      (select bed from furniture_def where id = pc.sub) * (0.6 + pc.ql / 250)
        * case when case when pc.level < 0 then cellar_done(p_world, floor(pc.x)::int, floor(pc.y)::int) -- cellar: always indoors
                         else indoors(p_world, 0, floor(pc.x)::int, floor(pc.y)::int) end -- cellar
               then indoors_rest() else 1 end, -- cellar
      lower(placed_name(pc)));

  elsif p_action = 'set_home' then
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;
    update player set home_x = pc.x, home_y = pc.y where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You make up the ' || lower(placed_name(pc))
      || '. This is where you will wake, whatever happens to you.', 'event');

  elsif p_action = 'pair_creature' then
    c := target_creature(p_world, p_target);
    mate := mate_for(p_world, c);
    if c.world_id is null or mate.id is null or pair_refuses(p_world, c, mate) is not null then return; end if;
    if c.sex = 'female' then dam := c; sire := mate; else dam := mate; sire := c; end if;
    v_skill := skill_of(p_world, p_uid, 'animal_husbandry');
    v_care := (dam.care + sire.care) / 2;
    v_took := random() < breed_chance(v_skill, v_care);
    perform skill_raise(p_world, p_uid, 'animal_husbandry', try_gain(v_took, breed_gain()));
    if not v_took then
      -- A failed pairing costs both of them a rest, but only half of one.
      -- Half a shorter one for the breeder's Short Rest.
      update creature set bred_at = now() - make_interval(secs => breed_rest() * (1 - pk(p_world, p_uid, 'breed:rest', 1) / 2))
        where world_id = p_world and id in (dam.id, sire.id);
      perform tell(p_world, p_uid, dam.name || ' and ' || sire.name
        || ' will have nothing to do with one another. Brush them, feed them, and try again.', 'error');
      return;
    end if;
    perform pair_them(p_world, dam.id, sire.id, v_skill, p_uid, p_target->>'sex');
    perform journal_note(p_world, p_uid, 'paired');
    perform tell(p_world, p_uid, sire.name || ' is put to ' || dam.name
      || '. She is in young and will drop in about ' || clock_left(gestation() * pk(p_world, p_uid, 'breed:gestation', 1))
      || '. Between them they carry '
      || trait_names((select array_agg(distinct t) from unnest(sire.traits || dam.traits) t))
      || '.', 'event');

  elsif p_action = 'read_blood' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    perform tell(p_world, p_uid, blood_read(p_world, p_uid, c), 'event');

  elsif p_action = 'dye_item' then
    select * into it from item where world_id = p_world and id = target_item(p_target);
    if it.id is null then return; end if;
    -- The litres the thing takes, out of the bucket the browser would use (`pickDye`), and exactly its colour.
    v_n := dye_litres_for(it.def);
    dye := pick_dye(p_world, p_uid, v_n);
    if dye.id is null then return; end if;
    v_want := dye_hex(dye_in(dye));
    if not spend_dye(dye.id, v_n) then return; end if;
    -- A stack is split so the rest stays as it was.
    if it.count > 1 then
      update item set count = count - 1 where id = it.id;
      insert into item (world_id, holder, holder_uid, def, ql, dmg, count, extra, rare, dye)
      values (p_world, it.holder, it.holder_uid, it.def, it.ql, it.dmg, 1, it.extra, it.rare, v_want);
    else
      update item set dye = v_want where id = it.id;
    end if;
    perform journal_note(p_world, p_uid, 'dyed');
    perform skill_raise(p_world, p_uid, 'alchemy', 0.3);
    perform tell(p_world, p_uid, 'You work ' || litres_word(v_n) || ' of ' || colour_word(v_want)
      || ' dye through it. It comes out ' || colour_word(v_want) || ', ' || v_want || '.', 'event');

  elsif p_action = 'strip_dye' then
    select * into it from item where world_id = p_world and id = target_item(p_target);
    if it.id is null then return; end if;
    select * into dye from item i where i.world_id = p_world and i.holder = 'player'
      and i.holder_uid = p_uid and i.def = 'lye_bucket' order by i.id limit 1;
    if dye.id is null or not consume(p_world, p_uid, 'lye_bucket', 1) then return; end if;
    perform give(p_world, p_uid, 'bucket', 1, dye.ql);
    update item set dye = null where id = it.id;
    perform skill_raise(p_world, p_uid, 'alchemy', 0.2);
    perform tell(p_world, p_uid, 'You boil it out in lye. It is back to the colour of '
      || lower((select coalesce(name, it.def) from item_def where id = it.def)) || '.', 'event');

  elsif p_action = 'start_brew' then
    select * into bd from brew_def where id = p_target->>'brew';
    select * into pc from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if bd.id is null or pc.id is null
       or brew_reason(p_world, p_uid, pc, bd) is not null then return; end if;
    -- What goes in decides most of what comes out; the hand only decides how
    -- much of it survives the working.
    select i.* into v_stock from craft_stock(p_world, p_uid) h join item i on i.id = h.id
      where h.def = bd.input order by h.draw limit 1;
    v_ql := coalesce(v_stock.ql, 20);
    if not craft_consume(p_world, p_uid, bd.input, bd.count) then return; end if;
    if not skill_check(skill_of(p_world, p_uid, 'brewing'), bd.difficulty, 0) then
      update placed set litres = greatest(0, placed_litres(pc) - bd.litres), since = now()
        where id = pc.id;
      update placed set liquid = null where id = pc.id and litres <= 0;
      update placed set knack = null where id = pc.id;
      perform skill_raise(p_world, p_uid, 'brewing', try_gain(false, brew_gain()));
      perform tell(p_world, p_uid, 'It will not take. You tip the whole soured lot out of the '
        || lower(placed_name(pc)) || '.', 'event');
      return;
    end if;
    update placed set litres = bd.litres, liquid = bd.id, ferment = bd.seconds, since = now(),
        ql = greatest(1, least(100, (v_ql + skill_of(p_world, p_uid, 'brewing')) / 2)),
        -- Its brewer's hand in it, which goes into every bucket drawn off it (a Cook's Strong Brew).
        knack = nullif(pk(p_world, p_uid, 'brewed:' || bd.id, 1), 1)
      where id = pc.id;
    perform journal_note(p_world, p_uid, 'brew');
    perform journal_note(p_world, p_uid, 'brew:' || bd.id);
    perform skill_raise(p_world, p_uid, 'brewing', try_gain(true, brew_gain()));
    perform tell(p_world, p_uid, bd.done || ' (about ' || round(bd.seconds / 60) || ' minutes)', 'event');
  end if;
end $function$;

/* ---- painting ---------------------------------------------------------------- */

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
  -- Frame: a storey job out past the footprint is for the building it names (`frame_building`).
  b := frame_building(p_world, p_action, p_target, b);

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
  -- Frame: jetties, terraces, railings and columns, where the browser asks them, after the glass (`frame_refusal`).
  v_gap := frame_refusal(p_world, p_uid, p_action, p_target, b);
  if v_gap is not null or frame_action(p_action) then return v_gap; end if;

  if p_action = 'plan_building' then
    return coalesce(need_tool(p_world, p_uid, 'mallet'), plan_reason(p_world, p_uid, tx, ty),
                    counter_street_refusal(p_world, tx, ty));  -- a counter's street (`counters.ts`)

  elsif p_action = 'add_to_building' then
    tool := need_tool(p_world, p_uid, 'mallet');
    if tool is not null then return tool; end if;
    select * into b from building where world_id = p_world and id = neighbour_building(p_world, tx, ty);
    if not found then return 'There is no building next to this tile.'; end if;
    if b.levels > 1 then return 'The footprint cannot change once upper floors are planned.'; end if;
    -- Piers: under the deck, or beside the floor, of the building it joins (`extend_reason`).
    return coalesce(extend_reason(p_world, p_uid, tx, ty, b.id), counter_street_refusal(p_world, tx, ty));  -- a counter's street

  elsif p_action = 'remove_from_plan' then
    if b.id is null then return 'No building here.'; end if;
    if b.levels > 1 then return 'Remove the upper floors first.'; end if;
    -- cellar: a building with a cellar under it comes down only once the cellar is filled in.
    if (cellar_at(p_world, tx, ty)).world_id is not null then return 'Fill in the cellar under it first.'; end if;
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
    lvl := frame_wall_level(p_world, tx, ty, p_target);  -- Frame: a jetty's storey, or round a terrace.
    -- Piers: and on the ground floor of a tile on piers, which is its deck.
    if lvl > 0 or on_piers(p_world, tx, ty) then
      select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
      if not found or not bill_done(f.needed) then return 'Build the floor of this storey first.'; end if;
    end if;
    -- Frame: and on the job's storey.
    if (frame_wall_at(p_world, tx, ty, side, p_target)).world_id is not null then return 'There is already a wall on that side.'; end if;
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
    -- Piers: and a building on piers stands on its decks, which carry what they are laid in (`deck_carries`).
    v_gap := case when b.deck is not null then deck_carries(p_world, b.id, mat.id) end;
    if v_gap is not null then return v_gap; end if;
    bears := coalesce(bearing(p_world, b.id, lvl), 9);
    if mat.heft > bears then
      return mat.name || ' is too heavy to raise over what is under it. This storey carries '
          || heft_word(bears) || ', no more.';
    end if;
    -- gates: a portcullis in stone on the ground floor; a hidden door is planned as a solid wall.
    return gate_plan_refusal(p_world, p_uid, wt.id, mat.id, lvl, building_at(p_world, tx, ty) is null);

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
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    if p_action = 'remove_wall' then
      -- And a shop counter comes down empty, till and all (`counters.ts`).
      -- gates: and a padlock on a portcullis keeps it from being taken down as from being worked; a hidden
      -- door answers as the solid wall it is to whoever it does not admit, which is nothing (`gateRemoveRefusal`).
      return case when w.world_id is null then 'There is no wall there.'
                  else coalesce(counter_remove_refusal(p_world, w),
                                case when w.type = 'portcullis' then lock_refusal(p_world, p_uid, w.lock, w.x, w.y) end) end;
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
      -- Frame: a railing is low work too, and columns close a side.
      return 'Nothing rests on a fence, a half wall or a railing: the storey below needs walls, or finished columns at both ends of every open side.';
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
    lvl := frame_floor_level(p_world, b.id, kind, p_target); -- cellar: storey nought for a flight down; Frame: else the job's storey.
    if kind = 'roof' then
      v_gap := level_gap(p_world, b.id, b.levels - 1, p_uid);
      if v_gap is not null then return v_gap; end if;
    elsif kind in ('stairs', 'ladder') then
      -- cellar: on the ground floor, a way down to the cellar under it.
      if lvl < 1 then
        -- Frame: not a way down, so a way up: in a building with a storey over the ground, that storey to work on.
        if (cellar_at(p_world, tx, ty)).world_id is null and not coalesce((p_target->>'down')::boolean, false) and b.levels > 1 then
          return 'Work on storey 2 or above to plan ' || case when kind = 'ladder' then 'a ladder' else 'stairs' end || ' here.';
        end if;
        v_gap := cellar_flight_refusal(p_world, b.id, tx, ty, side, coalesce((p_target->>'down')::boolean, false));
        if v_gap is not null then return v_gap; end if;
      end if;
      if side is null then return 'Choose the side to climb from.'; end if;
      -- Piers: a flight or a ladder up from a tile on piers stands on its deck.
      if (lvl > 1 or on_piers(p_world, tx, ty)) and not exists (select 1 from floor_tile where world_id = p_world
          and level = lvl - 1 and x = tx and y = ty) then
        return 'Plan the floor of the storey below first.';
      end if;
      -- cellar: one way off the ground floor a tile: a flight up and a flight down are not stacked on it.
      v_gap := cellar_stack_refusal(p_world, lvl, tx, ty); -- cellar
      if v_gap is not null then return v_gap; end if; -- cellar
    end if;
    -- cellar: a flight or a ladder down takes up the ground floor's flooring where it goes (`flooringUnder`).
    if exists (select 1 from floor_tile f2 where f2.world_id = p_world and f2.level = lvl and f2.x = tx and f2.y = ty
                 and not (lvl = 0 and f2.kind = 'floor' and p_target->>'floorKind' in ('stairs', 'ladder'))) then -- cellar
      return case when kind = 'roof' then 'There is already roof planned here.'
                  else 'There is already a floor planned here.' end;
    end if;
    -- Piers: a deck on piers carries what it is laid in, and the building on it is as heavy as its heaviest wall (`deck_bears`).
    if lvl = 0 and kind = 'floor' and on_piers(p_world, tx, ty) then return deck_bears(p_world, b.id, mat.id); end if;
    return null;

  elsif p_action in ('build_floor', 'remove_floor') then
    if b.id is null then return case when p_action = 'build_floor'
      then 'There is nothing planned here.' else 'No building here.' end; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := frame_floor_level(p_world, b.id, kind, p_target); -- cellar; Frame: on the job's storey.
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if p_action = 'remove_floor' then
      if not found then return 'There is nothing here to remove.'; end if;
      -- cellar: a flight down is let into the ground floor, and the walls round it stand on the ground;
      -- cellar: and a way down is a way up too, for whoever is down there.
      if lvl = 0 and f.kind in ('stairs', 'ladder') then -- cellar
        if (cellar_at(p_world, tx, ty)).world_id is not null and cellar_occupied(p_world, b.id) then -- cellar
          return 'Somebody is down in the cellar, and this is a way up out of it.'; -- cellar
        end if; -- cellar
        return null; -- cellar
      end if; -- cellar
      -- A wall stands on a floor only where it may not go up without a finished one (`plan_wall`): a storey up, or
      -- a deck on piers. On the ground floor it stands on the ground, and a floor still planned carries nothing.
      if f.kind <> 'roof' and bill_done(f.needed) and (lvl > 0 or on_piers(p_world, tx, ty)) and exists (
          select 1 from (values ('n'), ('e'), ('s'), ('w')) as s(side)
          cross join lateral border_of(tx, ty, s.side) bd
          join wall w2 on w2.world_id = p_world and w2.level = lvl
            and w2.dir = bd.dir and w2.x = bd.x and w2.y = bd.y) then
        return 'Take down the walls standing on it first.';
      end if;
      -- Piers: a deck holds up whatever stands or lies on it, and whoever is taking it up (`deck_refusal`).
      v_gap := deck_refusal(p_world, p_uid, lvl, tx, ty);
      if v_gap is not null then return v_gap; end if;
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
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    if w.world_id is null then return 'There is no wall there.'; end if;
    if p_action = 'strip_wall_paint' then
      if w.dye is null then return 'It has taken no colour.'; end if;
      if pack_count(p_world, p_uid, 'lye_bucket') <= 0 then return 'You need a bucket of lye to scrub it back.'; end if;
      return null;
    end if;
    if not bill_done(w.needed) then return 'Finish it before you paint it.'; end if;
    pot := pick_dye(p_world, p_uid, dye_litres_of('wall'));
    if pot.id is null then return dye_refusal(p_world, p_uid, dye_litres_of('wall')); end if;
    if w.dye = dye_hex(dye_in(pot)) then return dyed_already(w.dye); end if;
    return null;

  elsif p_action = 'paint_floor' then
    if b.id is null then return 'There is no floor here.'; end if;
    lvl := frame_job_level(b, p_target);  -- Frame: on the job's storey.
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found then return 'There is no floor here.'; end if;
    if not bill_done(f.needed) then return 'Finish it before you paint it.'; end if;
    pot := pick_dye(p_world, p_uid, dye_litres_of('floor'));
    if pot.id is null then return dye_refusal(p_world, p_uid, dye_litres_of('floor')); end if;
    if f.dye = dye_hex(dye_in(pot)) then return dyed_already(f.dye); end if;
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
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    if w.world_id is null then return 'There is no wall there.'; end if;
    select * into v_was from build_material_def where id = w.material;
    if v_was.kind is distinct from 'stone' then return 'Only a wall of stone is repointed.'; end if;
    if not bill_done(w.needed) then return 'Finish it before you repoint it.'; end if;
    if mat.id is null or mat.kind <> 'stone' then return 'Choose the stone to lay it in.'; end if;
    if mat.id = v_was.id then return 'It is ' || lower(mat.name) || ' already.'; end if;
    if material_only_refusal(mat.id, w.type, null) is not null then return material_only_refusal(mat.id, w.type, null); end if;
    tool := need_tool(p_world, p_uid, mat.tool);
    if tool is not null then return tool; end if;
    if b.id is not null and w.building = b.id then
      -- Piers: a building on piers stands on its decks, which carry what they are laid in (`deck_carries`).
      v_gap := case when b.deck is not null then deck_carries(p_world, b.id, mat.id) end;
      if v_gap is not null then return v_gap; end if;
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
        v_gate text; -- gates: what a solid wall asked for as a hidden door says, on the end of its plan's line
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  side := p_target->>'side';
  select * into b from building where world_id = p_world and id = building_at(p_world, tx, ty);
  -- Frame: a storey job out past the footprint is for the building it names, and columns are frame's (`perform_frame`).
  b := frame_building(p_world, p_action, p_target, b);
  if frame_action(p_action) then perform perform_frame(p_world, p_uid, p_action, p_target, b); return; end if;

  if p_action = 'plan_building' then
    nm := left(coalesce(nullif(btrim(coalesce(p_target->>'name', '')), ''), 'House'), 32);
    select coalesce(max(id), 0) + 1 into new_id from building where world_id = p_world;
    insert into building (world_id, id, name, planned_by) values (p_world, new_id, nm, p_uid);
    insert into building_tile (world_id, building, x, y) values (p_world, new_id, tx, ty);
    -- Piers: on piers, where the ground is not level (`stand_on_piers`).
    perform tell(p_world, p_uid, coalesce(stand_on_piers(p_world, p_uid, new_id, tx, ty, true),
      'You plan ' || nm || ' here. Extend it onto neighbouring flat packed '
      || 'tiles, then plan walls on its borders.'), 'event');

  elsif p_action = 'add_to_building' then
    select * into b from building where world_id = p_world and id = neighbour_building(p_world, tx, ty);
    if not found then return; end if;
    insert into building_tile (world_id, building, x, y) values (p_world, b.id, tx, ty)
      on conflict do nothing;
    -- Piers: under its deck, where the ground is not level with its floor (`stand_on_piers`).
    perform tell(p_world, p_uid, coalesce(stand_on_piers(p_world, p_uid, b.id, tx, ty, false),
      'You add the tile to ' || b.name || '.'), 'event');

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
    lvl := case when p_action = 'plan_fence' then 0 else frame_wall_level(p_world, tx, ty, p_target) end;  -- Frame: a jetty's storey, or round a terrace.
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
      -- gates: a solid wall asked for beforehand as a hidden door takes its padlock and hinges now and cuts its key,
      -- and says so on the end of the plan's own line, so that its plan writes one line as a solid wall's does
      -- (`perform_gate_plan`), on the storey the wall was planned on; and a wall of any other type is named as the
      -- thing it is, a railing as one, as the frame batch has it (`plan_line`).
      v_gate := perform_gate_plan(p_world, p_uid, p_target, lvl);
      perform tell(p_world, p_uid, plan_line(wt.id, mat.id, side) || ' It needs ' || bill_text(mat.id, bill) || '.'
        || coalesce(' ' || v_gate, ''), 'event');
    end if;

  elsif p_action = 'build_wall' then
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
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
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
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
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
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
    lvl := frame_floor_level(p_world, b.id, kind, p_target); -- cellar: storey nought for a flight down; Frame: else the job's storey.
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
    bill := floor_bill(mat.id, kind, shape, stair_hand(p_target, kind)); -- a single staircase (`stair_hand`) costs half a wall
    -- Piers: and the piers under a deck (`deck_bill`).
    bill := deck_bill(p_world, tx, ty, lvl, kind, mat.id, bill);
    -- cellar: a flight or a ladder down takes up the ground floor's flooring where it goes.
    if lvl = 0 and kind in ('stairs', 'ladder') then -- cellar
      delete from floor_tile where world_id = p_world and level = 0 and x = tx and y = ty and floor_tile.kind = 'floor'; -- cellar
      if found then perform tell(p_world, p_uid, 'You take up the flooring there.', 'event'); end if; -- cellar
    end if; -- cellar
    insert into floor_tile (world_id, level, x, y, building, material, kind, facing, hand, needed, total, planned_by)
    values (p_world, lvl, tx, ty, b.id, mat.id, kind,
            case when kind in ('stairs', 'ladder') then side end, stair_hand(p_target, kind), bill, bill, p_uid);
    perform tell(p_world, p_uid, 'You plan a '
      || case when kind = 'ladder' then 'ladder'
              else case when kind = 'roof'
                        then lower((select name from roof_shape_def where id = shape)) || ' ' else '' end
                   -- Piers: a deck on piers (`floor_kind_said`).
                   || lower(mat.name) || ' ' || coalesce(case when stair_hand(p_target, kind) is not null then floor_name(kind, stair_hand(p_target, kind)) end,
                                                       floor_kind_said(p_world, tx, ty, lvl, kind)) end
      || '. It needs ' || bill_text(mat.id, bill) || '.', 'event');

  elsif p_action = 'build_floor' then
    if b.id is null then return; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := frame_floor_level(p_world, b.id, kind, p_target); -- cellar: storey nought for a flight down; Frame: else the job's storey.
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
    what := case when f.kind = 'ladder' then 'ladder' else lower(mat.name) || ' ' || floor_name(f.kind, f.hand) end;
    if bill_done(bill) then
      perform tell(p_world, p_uid, 'You finish the ' || what || '.', 'event');
    else
      perform tell(p_world, p_uid, 'You work ' || laid_text(v_laid) || ' into the '
        || floor_name(f.kind, f.hand) || '. Still needed: ' || bill_text(f.material, bill) || '.', 'event');
    end if;

  elsif p_action = 'remove_floor' then
    if b.id is null then return; end if;
    kind := coalesce(p_target->>'floorKind', 'floor');
    lvl := frame_floor_level(p_world, b.id, kind, p_target); -- cellar: storey nought for a flight down; Frame: else the job's storey.
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found then return; end if;
    delete from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    -- Anybody standing on what was just torn up goes down a storey, not through it.
    if lvl > 0 then
      update player set level = lvl - 1
        where world_id = p_world and floor(x)::int = tx and floor(y)::int = ty and level >= lvl;
    end if;
    perform tell(p_world, p_uid, 'You remove the ' || floor_name(f.kind, f.hand) || '.', 'event');

  elsif p_action = 'paint_wall' then
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
    if w.world_id is null then return; end if;
    pot := pick_dye(p_world, p_uid, dye_litres_of('wall'));
    if pot.id is null then return; end if;
    nm := dye_hex(dye_in(pot));
    if not spend_dye(pot.id, dye_litres_of('wall')) then return; end if;
    update wall set dye = nm where world_id = p_world and level = w.level
      and dir = w.dir and x = w.x and y = w.y;
    perform skill_raise(p_world, p_uid, 'alchemy', 0.3);
    perform tell(p_world, p_uid, 'You brush ' || litres_word(dye_litres_of('wall')) || ' of ' || colour_word(nm)
      || ' dye over the wall on the ' || side_name(side) || ' side. It comes up ' || colour_word(nm) || ', ' || nm || '.', 'event');

  elsif p_action = 'strip_wall_paint' then
    w := frame_wall_at(p_world, tx, ty, side, p_target);  -- Frame: on the job's storey.
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
    lvl := frame_job_level(b, p_target);  -- Frame: on the job's storey.
    select * into f from floor_tile where world_id = p_world and level = lvl and x = tx and y = ty;
    if not found then return; end if;
    pot := pick_dye(p_world, p_uid, dye_litres_of('floor'));
    if pot.id is null then return; end if;
    nm := dye_hex(dye_in(pot));
    if not spend_dye(pot.id, dye_litres_of('floor')) then return; end if;
    update floor_tile set dye = nm where world_id = p_world and level = lvl and x = tx and y = ty;
    perform skill_raise(p_world, p_uid, 'alchemy', 0.3);
    perform tell(p_world, p_uid, 'You work ' || litres_word(dye_litres_of('floor')) || ' of ' || colour_word(nm)
      || ' dye into the boards. The floor comes up ' || colour_word(nm) || ', ' || nm || '.', 'event');

  elsif p_action = 'remove_storey' then
    if b.id is null or b.levels <= 1 then return; end if;
    update building set levels = levels - 1, work_level = levels - 2
      where world_id = p_world and id = b.id returning * into b;
    perform tell(p_world, p_uid, b.name || ' is back to '
      || case when b.levels = 1 then 'a single storey' else b.levels || ' storeys' end || '.', 'event');
  end if;
end $function$;

/* ---- boiling ----------------------------------------------------------------- */

CREATE OR REPLACE FUNCTION public.perform_craft(p_world uuid, p_uid uuid, p_recipe text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare r recipe; i record; v_n int; prefer bigint; mat text; hard double precision; tq double precision;
        s double precision; made_ql double precision; rare text; total double precision := 0;
        v_made bigint; weight double precision := 0; one double precision; share double precision;
        only_mat boolean; was text; v_base int; spared boolean := false; v_mark jsonb;
        v_parts jsonb := '{}'::jsonb; v_part jsonb; v_own jsonb; v_lye double precision; v_kept boolean := false;
        v_keep double precision; v_spare recipe_input; v_spare_ql double precision;
        v_tool bigint; v_tool_mark jsonb; v_stone boolean := false;
begin
  select * into r from recipe where id = p_recipe;
  prefer := target_item(p_target);
  -- What the run is aimed at, while it is still there to ask.
  select it.def into was from item it where it.id = prefer and it.world_id = p_world;
  mat := craft_material(p_world, p_uid, p_recipe, prefer);
  s := skill_of(p_world, p_uid, r.skill);
  tq := case when r.tool is null then 0 else tool_ql(p_world, p_uid, r.tool) end;
  /*
   * The tool wears on every go, whether or not the go comes off, as it does in
   * the hand and always has in the browser (`Game.act`). The island's bench
   * never wore anything, so a saw sawed for ever -- and a Carpenter's Saw
   * Care, which is how much less it wears (`wear_tool`), spared nothing.
   */
  if r.tool is not null then
    -- The one it is done with, and what its maker put into it, read before it
    -- is worn: a pot's, a bowl's or a jar's (an Artisan's Deep Pot and Sealed Jar).
    v_tool := held_tool(p_world, p_uid, r.tool);
    select it.mark into v_tool_mark from item it where it.id = v_tool;
    perform wear_tool(v_tool);
  end if;
  -- Oak and the deep metals fight the hands that shape them.
  hard := craft_hardness(p_recipe, mat);
  -- Bars broken into for what loose lumps are short of (a Smith's Ingots),
  -- before anything reads the lumps: what they weigh in the quality, and what
  -- a failed batch throws away.
  for i in select ri.item, ri.count from recipe_input ri join metal_def m on m.lump = ri.item where ri.recipe = p_recipe loop
    perform break_bars(p_world, p_uid, i.item,
      recipe_need(p_world, p_uid, p_recipe, i.count) - craft_count_loose(p_world, p_uid, i.item, null, prefer), prefer);
  end loop;

  -- A Mason's Sure Chisel fails half as often on stonecutting (`fail:` and the recipe).
  if r.difficulty is not null and not perk_pass(skill_check(s, hard, tq), pk(p_world, p_uid, 'fail:' || p_recipe, 1)) then
    -- And a Mason's Nothing Wasted keeps what went into a failed smelter or kiln.
    spared := r.consume_on_fail and random() < pk(p_world, p_uid, 'spare:' || p_recipe, 0);
    -- And the stone out of it whole, whatever else is lost, for an Artisan's Keep the Stone.
    v_stone := r.consume_on_fail and not spared and pk(p_world, p_uid, 'stone:' || p_recipe, 0) > 0
               and exists (select 1 from recipe_input where recipe = p_recipe and item = 'gem');
    if r.consume_on_fail and not spared then
      for i in select * from recipe_input where recipe = p_recipe order by ord loop
        continue when v_stone and i.item = 'gem';
        perform craft_consume(p_world, p_uid, i.item, recipe_need(p_world, p_uid, p_recipe, i.count), prefer, mat);
      end loop;
      -- The batch is wasted, not the vessel: you tip the ruin out and keep the
      -- bucket. Salvage if the recipe names any, otherwise whatever it returns.
      for i in
        select g.item, g.count from recipe_gives g
        where g.recipe = p_recipe
          and g.kind = (case when exists (select 1 from recipe_gives where recipe = p_recipe and kind = 'salvage')
                             then 'salvage' else 'return' end)
      loop
        perform give(p_world, p_uid, i.item, i.count, 20);
      end loop;
      perform craft_carry_on(p_world, p_uid, p_recipe, p_target, was, mat);
    end if;
    perform skill_raise(p_world, p_uid, r.skill, try_gain(false));
    perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(false, craft_head()));
    perform tell(p_world, p_uid, case when v_stone
      then 'The claw goes over too far and the silver is spoiled, but you have the stone out whole.'
      else coalesce(r.fail, 'You fail to make ' || lower((select coalesce(name, r.result) from item_def where id = r.result)) || '.') end,
      'event');
    if spared then perform tell(p_world, p_uid, 'Nothing that went into it is lost.', 'event'); end if;
    return;
  end if;

  -- The quality of what is about to be used up, worked out before it is used
  -- up, since using it up changes the answer: off the stack each input would
  -- be spent from first, which is the clicked one where it is one of them.
  if r.ql_from_inputs then
    for i in select * from recipe_input where recipe = p_recipe order by ord loop
      only_mat := mat is not null and craft_count(p_world, p_uid, i.item, mat, prefer) >= recipe_need(p_world, p_uid, p_recipe, i.count);
      select st.ql into one from craft_stock(p_world, p_uid, prefer) st
        where st.def = i.item and (not only_mat or st.extra is not distinct from mat)
        order by (st.id = prefer) desc, st.draw limit 1;
      if one is not null then
        -- By mass, not by the count. Two nails weigh two hundredths of a
        -- kilogram between them and do not get to decide what a pickaxe is.
        share := coalesce((select d.weight from item_def d where d.id = i.item), 1) * i.count;
        total := total + one * share;
        weight := weight + share;
      end if;
    end loop;
  end if;

  /*
   * What the parts carry of their makers' marks, off the stack each would be
   * spent from first, before spending them: a Smith's Keen Edge in a sword
   * blade goes into the sword whoever fits it. Only the parts the anvil beats
   * out, which are the only ones that carry a mark into anything, and only for
   * a thing made one at a time, which has a row to carry it; the larger where
   * two say the same, and never a temper, which is for whoever finishes it,
   * nor a seal or a glaze, which is on the part and not on what it goes into.
   */
  if not item_stackable(r.result) then
    for i in select ri.* from recipe_input ri where ri.recipe = p_recipe
               and (exists (select 1 from mould_def md where md.makes = ri.item)
                    -- And a yoke's pace into the cart or wagon it goes on (a Tailor's Saddler).
                    or ri.item in ('yoke')) order by ri.ord loop
      only_mat := mat is not null and craft_count(p_world, p_uid, i.item, mat, prefer) >= recipe_need(p_world, p_uid, p_recipe, i.count);
      select it.mark into v_part from craft_stock(p_world, p_uid, prefer) st join item it on it.id = st.id
        where st.def = i.item and (not only_mat or st.extra is not distinct from mat)
        order by (st.id = prefer) desc, st.draw limit 1;
      if v_part is not null then
        select v_parts || coalesce(jsonb_object_agg(k.key, greatest(k.value::text::double precision,
                 coalesce((v_parts->>k.key)::double precision, k.value::text::double precision))), '{}'::jsonb)
          into v_parts
          from jsonb_each(v_part - 'temper' - 'seal' - 'glaze') k;
      end if;
    end loop;
  end if;
  /*
   * A Cook's Frugal Cook: one of the first ingredient that is not a vessel
   * back now and then, at the quality of the stack it would be spent from
   * first -- asked before the spending, which changes the answer. Only asked
   * of a recipe the perk is on.
   */
  v_keep := pk(p_world, p_uid, 'keep:' || p_recipe, 0);
  if v_keep > 0 then
    select ri.* into v_spare from recipe_input ri
     where ri.recipe = p_recipe and ri.item <> 'bucket'
       and not exists (select 1 from vessel_def v where v.item = ri.item)
     order by ri.ord limit 1;
    if v_spare.item is not null then
      only_mat := mat is not null and craft_count(p_world, p_uid, v_spare.item, mat, prefer) >= recipe_need(p_world, p_uid, p_recipe, v_spare.count);
      select st.ql into v_spare_ql from craft_stock(p_world, p_uid, prefer) st
        where st.def = v_spare.item and (not only_mat or st.extra is not distinct from mat)
        order by (st.id = prefer) desc, st.draw limit 1;
    end if;
  end if;
  -- A Tailor's Lye Saver: now and then the vessel's liquid is not used up,
  -- and the full vessel stays as it was rather than coming back empty.
  v_lye := pk(p_world, p_uid, 'lye:' || p_recipe, 0);
  v_kept := v_lye > 0 and random() < v_lye;
  for i in select * from recipe_input where recipe = p_recipe order by ord loop
    continue when v_kept and exists (select 1 from vessel_def v where v.item = i.item);
    if not craft_consume(p_world, p_uid, i.item, recipe_need(p_world, p_uid, p_recipe, i.count), prefer, mat) then return; end if;
  end loop;
  perform craft_carry_on(p_world, p_uid, p_recipe, p_target, was, mat);

  if r.ql_from_inputs then
    made_ql := greatest(1, least(100, (case when weight > 0 then total / weight else 1 end) * (0.78 + s / 460)));
  else
    made_ql := product_ql(s, tq);
  end if;
  -- And the tree, on the trade the recipe belongs to: the quality of what came
  -- off the bench, however it was arrived at. A hundred is still a hundred.
  made_ql := least(100, made_ql * class_mul(p_world, p_uid, 'fine', r.skill));
  -- And better for a perk on the recipe (a Cook's Fine Fare).
  made_ql := least(100, made_ql * pk(p_world, p_uid, 'ql:' || p_recipe, 1));
  -- A Carpenter's Master Joiner: the first step of rarity at better odds on the joinery (`rare:` and the recipe).
  rare := perk_rare(pk(p_world, p_uid, 'rare:' || p_recipe, (select d.odds from rarity_def d order by d.ord limit 1)));
  -- More, the go a bauble on the trade comes up in the altar of the settlement you work on.
  -- A Mason's Three from a Shard and Good Mix: more of it at a go (`count:` and what it makes).
  v_base := pk(p_world, p_uid, 'count:' || r.result, r.count)::int;
  -- And a serving more of a dish cooked in a pot or a bowl its maker had Deep Pot for, whoever cooks.
  if is_dish(r.result) then v_base := v_base + floor(coalesce((v_tool_mark->>'serve')::double precision, 0))::int; end if;
  v_n := bauble_yield(p_world, p_uid, r.result, v_base);
  /*
   * What the maker's perks put into it, which stays with it whoever has it
   * after (a Carpenter's Deep Drawers, Keel Layer, True Bow; a Cook's Hearty),
   * over what its parts carried (a Smith's Keen Edge). A pile of the same
   * thing marked the same way is one pile, so a thing made by the handful goes
   * into the pack with its mark and stacks by it; a thing made one at a time
   * is a row of its own and takes it after.
   */
  v_own := coalesce(made_mark((select pl.class_mul from player pl
                                where pl.world_id = p_world and pl.uid = p_uid), r.result), '{}'::jsonb);
  v_mark := v_parts || v_own;
  -- A pace is multiplied, since a yoke's and a builder's are two reasons to go
  -- faster; the maker's own stands over the parts' in everything else.
  if v_parts ? 'speed' and v_own ? 'speed' then
    v_mark := jsonb_set(v_mark, '{speed}', to_jsonb((v_parts->>'speed')::double precision * (v_own->>'speed')::double precision));
  end if;
  -- And what is put up in a jar its maker had Sealed Jar for rots the slower for it.
  if v_tool_mark ? 'keeps' then
    v_mark := v_mark || jsonb_build_object('rot', mark_of(v_mark, 'rot') * mark_of(v_tool_mark, 'keeps'));
  end if;
  v_mark := nullif(v_mark, '{}'::jsonb);
  if item_stackable(r.result) then
    v_made := give(p_world, p_uid, r.result, v_n, made_ql, coalesce(r.extra, mat), rare, maker_mark(p_world, p_uid, rare), null, v_mark);
  else
    v_made := give(p_world, p_uid, r.result, v_n, made_ql, coalesce(r.extra, mat), rare, maker_mark(p_world, p_uid, rare));
    if v_mark is not null then update item set mark = v_mark where id = v_made; end if;
  end if;
  -- A boil leaves its dye in the bucket it was boiled in (`boiledDye`).
  if r.result = 'dye_bucket' then perform dye_boiled(p_world, p_uid, v_made, p_recipe); end if;
  -- A vessel comes off the bench full: a bucket of juice holds its five drinks.
  update item set charges = d.charges from item_def d
    where item.id = v_made and item.charges is null and d.id = item.def and d.charges is not null;
  -- Into the ledger, which is the only memory this island has of what you have
  -- made. It says so when it is your first of a kind or your best.
  perform journal_made(p_world, p_uid, r.result, made_ql, v_n, rare);
  if rare is not null then
    perform journal_note(p_world, p_uid, rare);
    perform tell(p_world, p_uid, rarity_word(rare), 'skill');
  end if;
  for i in select g.item, g.count from recipe_gives g where g.recipe = p_recipe and g.kind = 'return' loop
    continue when v_kept and exists (select 1 from recipe_input ri join vessel_def v on v.item = ri.item
                                      where ri.recipe = p_recipe and v.empty = i.item);
    perform give(p_world, p_uid, i.item, i.count, 20);
  end loop;
  if v_kept then perform tell(p_world, p_uid, 'There is enough left in the bucket for another.', 'event'); end if;
  if v_spare.item is not null and random() < v_keep then
    perform give(p_world, p_uid, v_spare.item, 1, coalesce(v_spare_ql, made_ql));
    perform tell(p_world, p_uid, 'You save '
      || case when lower((select coalesce(name, v_spare.item) from item_def where id = v_spare.item)) ~ '^[aeiou]' then 'an ' else 'a ' end
      || lower((select coalesce(name, v_spare.item) from item_def where id = v_spare.item)) || ' from the pot.', 'event');
  end if;

  perform skill_raise(p_world, p_uid, r.skill, 1);
  -- Working a thing out with your hands is what sharpens the head.
  perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(true, craft_head()));
  perform tell(p_world, p_uid, count_said(r.done, r.count, v_base) || ' (' || case when mat is not null then lower(mat) || ', ' else '' end
    || 'QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
end $function$;

/* ---- what was there before ---------------------------------------------------- */

-- The bucket a dyeing used was the best pot of dye; it is a bucket of dye of enough litres now.
drop function if exists pick_dye(uuid, uuid);

/*
 * Everything from before dye was mixed, brought up to now (`upgradeDyes`).
 *
 * Everything dyed keeps its colour: an old dye's id becomes its `#rrggbb`,
 * on things, pieces standing about, walls, floors and columns alike.
 *
 * And a pot of an old dye, wherever it is -- a pack, a bag, a crate, a store,
 * the ground, a stall, the post -- is a garment's dyeing of the mix nearest its
 * colour (`legacyLiquid`, worked out once and handed over in `dye_legacy`), in
 * buckets of dye a bucket's worth at a time: the first takes the pot's row,
 * and any more go where it is, row for row the same but for the dye in them.
 * A pot whose name is no dye there ever was becomes the first of them. An
 * order on the board for pots of dye is an order for buckets of it.
 *
 * Nothing is lost, and run twice it does nothing the second time.
 */
create or replace function dyes_from_before() returns void language plpgsql as $$
begin
  update item i set dye = l.hex from dye_legacy l where i.dye = l.id;
  update placed p set dye = l.hex from dye_legacy l where p.dye = l.id;
  update wall w set dye = l.hex from dye_legacy l where w.dye = l.id;
  update floor_tile f set dye = l.hex from dye_legacy l where f.dye = l.id;
  update building_column c set dye = l.hex from dye_legacy l where c.dye = l.id;

  insert into item (world_id, holder, holder_uid, gx, gy, inside, def, ql, dmg, count, extra, rare, dye, bless, charges,
                    locked, issued, made_at, crate, lit, lit_at, placed, rot_at, maker, piece, keyed, price, letter, deal,
                    creature, mark, cool)
    select i.world_id, i.holder, i.holder_uid, i.gx, i.gy, i.inside, 'dye_bucket', i.ql, i.dmg, 1, null, i.rare,
           dye_text(dye_read(d.liquid), least(bucket_litres()::int, d.litres - k * bucket_litres()::int)), i.bless, null,
           i.locked, i.issued, i.made_at, i.crate, i.lit, i.lit_at, i.placed, i.rot_at, i.maker, i.piece, i.keyed, i.price,
           i.letter, i.deal, i.creature, i.mark, i.cool
      from (select i.id, coalesce(l.liquid, (select liquid from dye_legacy order by ord limit 1)) as liquid,
                   greatest(1, i.count) * dye_litres_of('garment') as litres
              from item i left join dye_legacy l on l.name = i.extra
             where i.def = 'dye') d
      join item i on i.id = d.id
     cross join lateral generate_series(1, ceil(d.litres / bucket_litres())::int - 1) k
     order by i.id, k;
  update item i set def = 'dye_bucket', count = 1, extra = null, charges = null,
         dye = dye_text(dye_read(d.liquid), least(bucket_litres()::int, d.litres))
    from (select i.id, coalesce(l.liquid, (select liquid from dye_legacy order by ord limit 1)) as liquid,
                 greatest(1, i.count) * dye_litres_of('garment') as litres
            from item i left join dye_legacy l on l.name = i.extra
           where i.def = 'dye') d
   where i.id = d.id;

  update buy_order set def = 'dye_bucket' where def = 'dye';
end $$;

select dyes_from_before();
