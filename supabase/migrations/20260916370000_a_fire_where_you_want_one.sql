-- A fire you can put where you want one, and that lights itself when it is
-- wanted.
--
-- Asked for from the island: *"Make stone brick braziers that require fuel. Ql
-- determines how quickly they consume fuel. Brazier light at night and provide
-- visibility"*.
--
-- ## Almost all of it was already here
--
-- `is_oven` has never been about ovens:
--
--     select p.kind = 'furniture'
--        and coalesce((select hearth from furniture_def where id = p.sub), false)
--
-- — so fuelling, lighting, raking out and taking the ashes have worked on
-- *anything with `hearth` on its definition* since the day the oven was
-- written, and a brazier needed none of them written again. `vision.ts` has
-- cast light from any lit piece of furniture for just as long, so "provide
-- visibility" is a consequence of `lit` rather than a feature. What was left
-- was three things: something for the bill to build, a rate to burn at, and a
-- reason to be alight.
--
-- ## The rate
--
-- `placed_fuel` has always been `fuel - seconds since it was lit` — a second of
-- fuel a second, for a campfire, a smelter, a kiln and an oven alike. That is
-- the number quality has to move, so there is a rate between the two now:
--
--     placed_burn_rate(p)   seconds of fuel spent per second alight
--
-- which is **1 for everything that was here before this**. Re-pricing the
-- smelters and the kilns off the back of a brazier is not what was asked for
-- and would be a strange thing to find in the changelog. Only a brazier reads
-- its quality: about 1.55 at quality 1, 1 at 40 and 0.6 at 100, so a well-laid
-- one gets nearly three nights out of the fuel a rough one burns in one.
--
-- ## And the night
--
-- A brazier exists to be a light. Leaving one burning through the afternoon is
-- fuel spent on nothing, and asking somebody to walk their deed twice a day to
-- light and douse a dozen of them is a chore rather than a feature. So one
-- with fuel in it takes at dusk and is raked out at dawn, on the heartbeat
-- that already settles everything else.
--
-- Only braziers. An oven burns while somebody is baking and stops when they
-- stop; an oven that lit itself every night would be an oven nobody could keep
-- fuel in.

/** Is this the kind of hearth that stands in the open and burns for the light? */
create or replace function is_brazier(p placed) returns boolean
  language sql immutable as $fn$
  select p.kind = 'furniture' and p.sub = 'brazier'
$fn$;

/**
 * How fast a brazier eats what is in it, by how well it was built.
 *
 * A shallow bowl with a bad draw roars through its fuel; one laid true and
 * banded tight burns low and long. Straight between the two crossed ends, so
 * there is one line here and one in `brazierBurn` and they are the same line.
 */
create or replace function brazier_burn(p_ql double precision) returns double precision
  language sql immutable as $fn$
  select brazier_burn_one()
       + (brazier_burn_hundred() - brazier_burn_one())
         * (least(100, greatest(1, p_ql)) - 1) / 99
$fn$;

/**
 * Seconds of fuel a thing spends per second alight.
 *
 * One for everything that was on this island before braziers were: a campfire,
 * a smelter, a kiln and an oven all burn a second a second and always have.
 * The rate exists so that quality can move it for the one thing that was asked
 * to have quality move it, and for nothing else.
 */
create or replace function placed_burn_rate(p placed) returns double precision
  language sql stable as $fn$
  select case when is_brazier(p) then brazier_burn(p.ql) else 1 end
$fn$;

/** What a hearth of this kind will hold. */
create or replace function hearth_capacity(p placed) returns double precision
  language sql stable as $fn$
  select case when is_brazier(p) then brazier_capacity() else oven_capacity() end
$fn$;

/**
 * What is left in it, which is what went in less what has burned.
 *
 * `p.since` is when it was lit, so the seconds are wall-clock seconds and the
 * rate turns them into fuel. Everything but a brazier multiplies by one and
 * comes out exactly where it was.
 */
create or replace function placed_fuel(p placed) returns double precision
  language sql stable as $fn$
  select case when p.lit
    then greatest(0, p.fuel - extract(epoch from (now() - p.since)) * placed_burn_rate(p))
    else p.fuel end
$fn$;

/** And how much of it has gone, which is what the ashes are made of. */
create or replace function placed_fuel_spent(p placed) returns double precision
  language sql stable as $fn$
  select case when p.lit
    then greatest(0, extract(epoch from (now() - p.since)) * placed_burn_rate(p))
    else 0 end
$fn$;

/**
 * And the ashes, which are made of what has burned.
 *
 * Over `placed_fuel_spent` rather than working the seconds out a second time,
 * so the rate reaches the ashes without being written down twice. It had the
 * subtraction inline; that is exactly the shape that lets a brazier burn
 * slowly and leave ashes at the old pace.
 */
create or replace function placed_ash(p placed) returns double precision
  language sql stable as $fn$
  select case when p.lit
    then p.ash + least(p.fuel, placed_fuel_spent(p)) / 120
    else p.ash end
$fn$;

/**
 * Light the braziers at dusk and rake them out at dawn.
 *
 * Run off the heartbeat, once per world, and it touches only rows that have to
 * move: a lit one in daylight, and an unlit one with fuel in it after dark. On
 * a quiet world that is no rows at all.
 *
 * Both halves rebase `since`, which is what keeps the arithmetic above honest:
 * `placed_fuel` counts from `since`, so a brazier that has burned half the
 * night and gone out at dawn has to carry what is left forward rather than
 * start the next night where it started this one. Putting it out settles the
 * fuel and the ashes on the way, through the two functions that already know
 * how — `placed_fuel(p)` and `placed_ash(p)` read the row as it was before the
 * update, which is exactly the row they need.
 */
create or replace function brazier_sweep(p_world uuid) returns integer
  language plpgsql as $fn$
declare v_n int := 0;
begin
  if is_night(p_world) then
    update placed p set lit = true, since = now()
      where p.world_id = p_world and p.kind = 'furniture' and p.sub = 'brazier'
        and not p.lit and p.fuel > 0;
  else
    update placed p set lit = false, fuel = placed_fuel(p), ash = placed_ash(p), since = now()
      where p.world_id = p_world and p.kind = 'furniture' and p.sub = 'brazier' and p.lit;
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

CREATE OR REPLACE FUNCTION public.forge_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p placed; it item; v_mould item; d mould_def; v_lump item;
begin
  if p_action in ('fuel_oven', 'light_oven', 'put_out_oven', 'take_ashes_oven') then
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found or not is_oven(p) then return 'That is not an oven.'; end if;
    if not near_piece(p_world, p_uid, p) then return 'Stand next to the oven.'; end if;
    if p_action = 'fuel_oven' then
      select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
        and not locked and fuel_value(def) is not null
        and (nullif(p_target->>'uid', '') is null or id = (p_target->>'uid')::bigint)
        order by id limit 1;
      if not found then return 'Ovens take the same wood and coal a fire does.'; end if;
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
    select * into it from item where world_id = p_world and id = (p_target->>'uid')::bigint
      and holder = 'player' and holder_uid = p_uid;
    if not found or not held_light(it.def) then return 'It is gone.'; end if;
    if p_action = 'candle_lantern' then
      if it.def <> 'lantern' then return 'Nothing goes in a torch.'; end if;
      if candle_left(it) > 0 then return 'There is still a candle in it.'; end if;
      if pack_count(p_world, p_uid, 'candle') < 1 then
        return 'You have no candles. Two are drawn from two beeswax and a yarn.';
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
        return 'Nothing here is burning. Light it at a campfire, a kiln, a smelter or an oven — '
          || 'or off something already alight in your hand.';
      end if;
    elsif p_action = 'douse_lantern' then
      if not it.lit then return 'It is not lit.'; end if;
    end if;
    return null;
  end if;

  if p_action = 'place_anvil' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and def = 'anvil' and not locked
      and (nullif(p_target->>'uid', '') is null or id = (p_target->>'uid')::bigint)
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
  select * into v_mould from item where world_id = p_world
    and id = nullif(p_target->>'mould', '')::bigint
    and holder = 'player' and holder_uid = p_uid;
  if not found then return 'Choose a mould.'; end if;
  select * into d from mould_def where id = v_mould.def;
  if not found then return 'Choose a mould.'; end if;
  if d.makes = 'anvil' then return 'An anvil is cast in a smelter, not beaten out here.'; end if;
  v_lump := smith_lump(p_world, p_uid, nullif(p_target->>'uid', '')::bigint);
  if v_lump.id is null then return 'You have no metal to pour.'; end if;
  if v_lump.count < d.lumps then return 'That takes ' || d.lumps || ' lumps.'; end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_forge(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p placed; it item; v_mould item; d mould_def; v_lump item; m metal_def;
        v_per double precision; v_room double precision; v_fits int; v_whole int;
        v_ql double precision; v_mould_ql double precision; v_hard double precision;
        v_rare text; v_made bigint; v_broke boolean; v_sz int[]; v_sx int; v_sy int;
        v_gained double precision; v_left double precision;
begin
  if p_action in ('fuel_oven', 'light_oven', 'put_out_oven', 'take_ashes_oven') then
    perform placed_settle((p_target->>'id')::bigint);
    select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
    if not found then return; end if;

    if p_action = 'fuel_oven' then
      select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
        and not locked and fuel_value(def) is not null
        and (nullif(p_target->>'uid', '') is null or id = (p_target->>'uid')::bigint)
        order by id limit 1;
      if not found then return; end if;
      v_per := fuel_value(it.def);
      v_room := greatest(0, hearth_capacity(p) - p.fuel);
      v_fits := greatest(1, least(least(coalesce((p_target->>'count')::int, 1), it.count),
                                  ceil(v_room / v_per)::int));
      if not consume(p_world, p_uid, it.def, v_fits, it.id) then return; end if;
      update placed set fuel = least(hearth_capacity(p), p.fuel + v_per * v_fits), since = now()
        where id = p.id;
      perform tell(p_world, p_uid, 'You feed '
        || case when v_fits > 1 then v_fits || ' × ' else 'a ' end
        || lower((select name from item_def where id = it.def)) || ' into the oven. '
        || oven_burns_for(least(hearth_capacity(p), p.fuel + v_per * v_fits) / placed_burn_rate(p)) || ' of fuel.', 'event');

    elsif p_action = 'light_oven' then
      update placed set lit = true, since = now() where id = p.id;
      perform tell(p_world, p_uid, 'The oven draws and the fire takes hold. '
        || oven_burns_for(p.fuel) || ' of fuel.', 'event');

    elsif p_action = 'put_out_oven' then
      update placed set lit = false, since = now() where id = p.id;
      perform tell(p_world, p_uid,
        'You rake the fire out of the oven. It will keep its heat for nobody.', 'event');

    elsif p_action = 'take_ashes_oven' then
      v_whole := floor(p.ash)::int;
      update placed set ash = p.ash - v_whole, since = now() where id = p.id;
      perform give(p_world, p_uid, 'ash', v_whole, 20);
      perform tell(p_world, p_uid, 'You rake ' || v_whole
        || case when v_whole = 1 then ' lot' else ' lots' end
        || ' of ashes out of the oven. (QL 20)', 'event');
    end if;
    return;
  end if;

  if p_action in ('candle_lantern', 'light_lantern', 'douse_lantern') then
    perform lantern_settle((p_target->>'uid')::bigint);
    select * into it from item where world_id = p_world and id = (p_target->>'uid')::bigint;
    if not found then return; end if;
    if p_action = 'candle_lantern' then
      if not consume(p_world, p_uid, 'candle', 1) then return; end if;
      update item set charges = round(candle_burn(it.ql))::int, lit = false, lit_at = null
        where id = it.id;
      perform tell(p_world, p_uid, 'You set a candle in the lantern. '
        || ceil(candle_burn(it.ql) / 60) || ' minutes of it, at a guess.', 'event');
    elsif p_action = 'light_lantern' then
      -- A torch is wound and then lit; the pitch in it only starts burning at
      -- the moment it catches, so its clock starts here rather than at the bench.
      if it.def = 'torch' and candle_left(it) <= 0 then
        update item set charges = round(torch_burn(it.ql))::int where id = it.id;
        select * into it from item where id = it.id;
      end if;
      update item set lit = true, lit_at = now() where id = it.id;
      perform tell(p_world, p_uid, case when it.def = 'torch'
        then 'You touch the torch to the ' || flame_near(p_world, p_uid, it.id)
             || ' and it takes. ' || ceil(candle_left(it) / 60) || ' minutes of it, throwing '
             || held_reach(it.def, it.ql) || ' tiles.'
        else 'You take a light off the ' || flame_near(p_world, p_uid, it.id)
             || ' and the lantern throws it ' || held_reach(it.def, it.ql) || ' tiles.' end, 'event');
    else
      v_left := candle_left(it);
      update item set lit = false, lit_at = null, charges = round(v_left)::int where id = it.id;
      perform tell(p_world, p_uid, case when it.def = 'torch'
        then 'You smother the torch. ' || ceil(v_left / 60)
             || ' minutes of it left, if it will take again.'
        else 'You pinch the wick out. ' || ceil(v_left / 60) || ' minutes of candle saved.' end, 'event');
    end if;
    return;
  end if;

  if p_action = 'place_anvil' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and def = 'anvil' and not locked
      and (nullif(p_target->>'uid', '') is null or id = (p_target->>'uid')::bigint)
      order by id limit 1;
    if not found then return; end if;
    v_sx := least(subtiles() - anvil_subtiles(), greatest(0, coalesce((p_target->>'sx')::int, 0)));
    v_sy := least(subtiles() - anvil_subtiles(), greatest(0, coalesce((p_target->>'sy')::int, 0)));
    insert into placed (world_id, kind, sub, x, y, sx, sy, cx, cy, ql, made_by)
    values (p_world, 'anvil', coalesce(it.extra, 'copper'),
            (p_target->>'x')::int, (p_target->>'y')::int, v_sx, v_sy,
            (p_target->>'x')::int + (v_sx + 1.0) / subtiles(),
            (p_target->>'y')::int + (v_sy + 1.0) / subtiles(), it.ql, p_uid)
    returning * into p;
    delete from item where id = it.id;
    perform tell(p_world, p_uid, 'You set the ' || lower(anvil_name(p))
      || ' down. Bring a filled mould to it.', 'event');
    perform land_announce(p_world, p.x, p.y);
    return;
  end if;

  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
  if not found then return; end if;

  if p_action = 'pick_up_anvil' then
    perform give(p_world, p_uid, 'anvil', 1, p.ql, p.sub);
    perform tell(p_world, p_uid, 'You heave the ' || lower(anvil_name(p))
      || ' up onto your shoulder.', 'event');
    delete from placed where id = p.id;
    perform land_announce(p_world, p.x, p.y);
    return;
  end if;

  -- Smithing: the mould, the metal, the anvil and the hands, in that order.
  select * into v_mould from item where world_id = p_world
    and id = nullif(p_target->>'mould', '')::bigint;
  select * into d from mould_def where id = v_mould.def;
  v_lump := smith_lump(p_world, p_uid, nullif(p_target->>'uid', '')::bigint);
  select * into m from metal_def where lump = v_lump.def;
  if v_mould.id is null or d.id is null or v_lump.id is null or m.id is null
     or v_lump.count < d.lumps then return; end if;
  if not consume(p_world, p_uid, v_lump.def, d.lumps, v_lump.id) then return; end if;

  v_mould_ql := greatest(1, v_mould.ql - v_mould.dmg / 2);
  -- Every filling wears the mould, and a hard metal takes more out of it.
  v_broke := v_mould.dmg + mould_wear(v_mould.ql) * (1 + (mat_of(m.name)).difficulty / 30) >= 100;
  if v_broke then
    delete from item where id = v_mould.id;
  else
    update item set dmg = least(100, v_mould.dmg
        + mould_wear(v_mould.ql) * (1 + (mat_of(m.name)).difficulty / 30))
      where id = v_mould.id;
  end if;

  -- The deeper the seam it came out of, the harder it is to beat into shape.
  v_hard := d.difficulty + (mat_of(v_lump.extra)).difficulty;
  if not skill_check(skill_of(p_world, p_uid, d.skill), v_hard, anvil_ql(p),
                     mind_ease(p_world, p_uid)) then
    v_gained := skill_raise(p_world, p_uid, d.skill, 0.25);
    perform tell(p_world, p_uid, 'The '
      || lower((select name from item_def where id = d.makes))
      || ' comes out misshapen and you throw the metal back.'
      || case when v_broke then ' The ' || lower((select name from item_def where id = v_mould.def))
                                || ' cracks through.' else '' end, 'event');
    return;
  end if;

  v_ql := smith_ql(p_world, p_uid, d.skill, v_mould_ql, v_lump.ql, anvil_ql(p));
  v_gained := skill_raise(p_world, p_uid, d.skill, 0.5);
  v_rare := rarity_roll();
  v_made := give(p_world, p_uid, d.makes, d.per, v_ql, m.name, v_rare);
  perform journal_made(p_world, p_uid, d.makes, v_ql, d.per, v_rare);
  perform journal_note(p_world, p_uid, 'smithed');
  -- The four that come out of the deep seams, which are worth a line of their own.
  if m.id in ('adamantine', 'glimmersteel', 'mithril', 'seryll') then
    perform journal_note(p_world, p_uid, 'moonmetal');
  end if;
  if v_rare is not null then
    perform journal_note(p_world, p_uid, v_rare);
    perform tell(p_world, p_uid, rarity_word(v_rare), 'skill');
  end if;
  perform tell(p_world, p_uid, 'You beat out '
    || case when d.per > 1 then d.per || ' ' else 'a ' end
    || lower(m.name) || ' '
    || case when d.per > 1 and right(lower((select name from item_def where id = d.makes)), 1) <> 's'
            then lower((select name from item_def where id = d.makes)) || 's'
            else lower((select name from item_def where id = d.makes)) end
    || ' on the ' || lower(anvil_name(p)) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')'
    || case when v_broke then ' The ' || lower((select name from item_def where id = v_mould.def))
                              || ' cracks through and is done.'
            else ' The mould has ' || mould_uses_left(v_mould.ql, v_mould.dmg
                   + mould_wear(v_mould.ql) * (1 + (mat_of(m.name)).difficulty / 30))
                 || ' fillings left.' end, 'event');
end $function$;

CREATE OR REPLACE FUNCTION public.world_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare v_rotted int := 0; w record; p record; v_lit int := 0;
        v_worlds int := 0; v_settled int := 0; v_stirred int := 0;
        v_sprung int := 0; v_gone int := 0;
        v_said int := 0; v_folded int := 0; v_sunk int := 0;
        v_tidy boolean := false;
begin
  /*
   * One round at a time.
   *
   * `pg_cron` starts a job on its schedule whether or not the last one has
   * finished, and at a second there is far less room than there was at five.
   * Nothing here can settle a job twice — `settle` takes `for update` on the
   * player row and re-checks `act_ends <= now()` — but two rounds fighting
   * over the same rows is work neither of them needed to do. A round that
   * finds the clock already turning goes back to bed; its work is due again
   * in a second.
   */
  if not pg_try_advisory_lock(hashtext('world_tick')::bigint) then
    return jsonb_build_object('worlds', 0, 'busy', true);
  end if;

  -- The tidying is not the settling and does not want the settling's pace: a
  -- scan every five seconds to delete nothing is just a scan.
  update keeper set swept_at = now()
    where one and swept_at < now() - make_interval(secs => sweep_every());
  v_tidy := found;

  for w in
    select id from world where ready and exists (
      select 1 from player
      where player.world_id = world.id and not player.away
        and player.seen_at > now() - make_interval(secs => idle_logout()))
    order by id limit tick_worlds()
  loop
    v_worlds := v_worlds + 1;

    -- Everything anybody has finished doing, and the next go of it.
    for p in select uid from player
      where world_id = w.id and act is not null and act_ends <= now()
      order by uid limit tick_players()
    loop
      v_settled := v_settled + settle(w.id, p.uid);
    end loop;

    /*
     * The country round everybody still on their feet — once per patch of it.
     *
     * A crowd at a token or a mine face is a dozen bodies on one tile, and
     * this swept the same ground for each of them. Deduping on the tile is the
     * conservative version of that: two people standing together cost one
     * sweep, two people a tile apart still cost two, and nothing that was
     * being stirred stops being stirred. The index under the sweep took most
     * of this win before this line did — it is a tenth of a millisecond now
     * rather than half of one — so the safe reading is the right one.
     */
    for p in select distinct floor(x) as x, floor(y) as y from player
      where world_id = w.id and not away
        and seen_at > now() - make_interval(secs => idle_logout())
      order by 1, 2 limit tick_players()
    loop
      v_stirred := v_stirred + creature_sweep(w.id, p.x, p.y);
    end loop;

    v_sprung := v_sprung + trap_sweep(w.id) + post_sweep(w.id);
    -- And the braziers, which take at dusk and are raked out at dawn.
    v_lit := v_lit + brazier_sweep(w.id);
    -- And what is lying about, going off where it lies.
    v_rotted := v_rotted + ground_sweep(w.id);
    v_gone := v_gone + log_out_idle(w.id);

    if v_tidy then
      v_said := v_said + prune_events(w.id);
      v_folded := v_folded + compact_changes(w.id);
    end if;
  end loop;

  if v_tidy then v_sunk := reap_islands(); end if;

  perform pg_advisory_unlock(hashtext('world_tick')::bigint);
  return jsonb_build_object('worlds', v_worlds, 'settled', v_settled, 'rotted', v_rotted,
                            'stirred', v_stirred, 'sprung', v_sprung, 'left', v_gone,
                            'swept', v_said, 'folded', v_folded, 'sunk', v_sunk,
                            'braziers', v_lit);
end $function$;


select private.lock_doors();

notify pgrst, 'reload schema';
