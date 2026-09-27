/*
 * The Fisher moved onto perks: its eighteen, on the island.
 *
 * The twelfth trade off its tree (`PERK_CLASSES`). Its perks are rows the
 * definitions already carry (`class_perk`), and so are its new recipes and
 * the fish pond. What is here is every rule the perks change, each reading its
 * key off the fold with the rule's own number as the default, so that for
 * anybody without the perk nothing moves:
 *
 *   * the reach of a line and a net (`act_refusal_rules`, `fish_refusal`,
 *     `perform_fish`): Long Cast's and Wide Net's, and the deepest water within
 *     the whole tiles that reach spans round your feet when what was clicked
 *     is further (`cast_at`, which had a fixed three for a net and a rod
 *     alike where the browser has each one's own);
 *   * a bite (`catch_fish`, `pick_fish`, `bite_weight`): Steady Hand's points
 *     on a fish staying on (`stays_on`), Strong Bait's pull and Big Fish's
 *     weight, on the rod, in the net and in a creel, whose are its setter's;
 *   * the bait: Bait Saver's leaving it on the hook when a fish comes off, and
 *     Any Bait's food on the hook and in a creel when nothing that draws a
 *     fish is carried (`bait_for`, `bait_in_pack`);
 *   * the catch: Rare Catch's now and then a rare one, by rod or net, and Full
 *     Net's more to a haul;
 *   * Deep Creel's creel holding more, as its maker's mark (`creel_hold`);
 *   * Cool Pack's fish set down rotting slower where they lie
 *     (`perform_hands`);
 *   * the Fishing Journal's line when water is looked at (`fish_journal`,
 *     `examine_tile_text`), in the browser's words;
 *   * and the two new things, each made only by a Fisher who has learned it
 *     (`craft_refusal`): fish smoked at a campfire, which carry the smoker's
 *     mark to rot slower, and a fish pond, which stocks itself on the clock's
 *     tidying round (`pond_sweep`) and takes nothing from anybody's hands
 *     (`furniture_refuses`, `furniture_capacity`).
 *
 * Quick Cast, Quick Net, Net Care and Rod Care are keys every job and tool
 * already reads (`time:`, `wear:`), and need nothing here.
 *
 * The Fisher's nodes go with its tree, and every Fisher's fold is written
 * again.
 */
set local lock_timeout = '3s';

/* The ponds on an island, which the clock asks after every tidying round. */
create index if not exists placed_ponds on placed (world_id) where sub = 'fish_pond';

/*
 * The chance a fish that takes the hook stays on it: a floor, the hand, the
 * rod and something on the hook, and a Fisher's Steady Hand's points over all
 * of it, never past the most anybody lands. The browser's `staysOn`.
 */
create or replace function stays_on(p_skill double precision, p_rod_ql double precision, p_baited boolean,
                                    p_plus double precision default 0) returns double precision
  language sql immutable as $$
  select least(hook_most(), hook_base() + p_skill / 190 + p_rod_ql / 320
    + case when p_baited then hook_bait() else 0 end + p_plus)
$$;

/*
 * What a fish counts for in the draw of which one bites, with whatever is on
 * the hook and the fisher's perks counted in: a Fisher's Big Fish on the fish
 * (`bite:`), and on a bait that favours it their Strong Bait (`bait:pull`). A
 * bait that favours nothing (a Fisher's Any Bait) draws every fish at its
 * plain weight. The browser's `biteWeight`.
 */
create or replace function bite_weight(p_fish text, p_weight double precision, p_bait text, p_mul jsonb default null)
  returns double precision language sql stable as $$
  select p_weight * pk(p_mul, 'bite:' || p_fish, 1) * case
    when p_bait is null or not exists (select 1 from bait_def b where b.id = p_bait) then 1
    else coalesce((select (bait_pull() * pk(p_mul, 'bait:pull', 1)) / (bf.rank + 1) from bait_favours bf
                    where bf.bait = p_bait and bf.fish = p_fish), bait_shy())
    end
$$;

/* One fish out of what could be caught here, weighted, with the bait and the fisher's perks counted in. */
drop function if exists pick_fish(double precision, double precision, text, double precision);
create or replace function pick_fish(p_depth double precision, p_skill double precision, p_bait text,
                                     p_roll double precision, p_mul jsonb default null) returns text
  language sql stable as $$
  select id from (
    select f.id, sum(w) over (order by w desc, f.id) upto, sum(w) over () total
    from fish_here(p_depth, p_skill) f
    cross join lateral (select bite_weight(f.id, f.weight, p_bait, p_mul) as w) q
  ) r where upto >= p_roll * total order by upto limit 1
$$;

/*
 * What comes up, or nothing for a bite that came off. Any bait on the hook
 * helps it stay on; only a bait that favours a fish draws it.
 */
drop function if exists catch_fish(double precision, double precision, double precision, text);
create or replace function catch_fish(p_depth double precision, p_skill double precision, p_rod_ql double precision,
                                      p_bait text, p_mul jsonb default null) returns text
  language sql as $$
  select case
    when not exists (select 1 from fish_here(p_depth, p_skill)) then null
    when random() > stays_on(p_skill, p_rod_ql, p_bait is not null, pk(p_mul, 'hook:fish', 0)) then null
    else pick_fish(p_depth, p_skill, p_bait, random(), p_mul)
    end
$$;

/* How far your line goes (a Fisher's Long Cast), and your net (their Wide Net). The browser's `castReach`, `netReach`. */
create or replace function cast_reach(p_world uuid, p_uid uuid) returns double precision
  language sql stable as $$ select pk(p_world, p_uid, 'reach:fish', cast_range()) $$;
create or replace function net_reach(p_world uuid, p_uid uuid) returns double precision
  language sql stable as $$ select pk(p_world, p_uid, 'reach:drag_net', net_range()) $$;

/* How many fish a creel holds before it takes no more, a Fisher's Deep Creel on it counted in. The browser's `creelHold`. */
create or replace function creel_hold(p placed) returns integer
  language sql stable as $$
  select floor(coalesce((select d.hold from trap_def d where d.id = p.sub), 8) * mark_of(p.mark, 'hold') + 0.5)::int
$$;

/*
 * What the water here holds for somebody, as a Fisher's Fishing Journal reads
 * it when the water is looked at: how deep it is, what share of the bites
 * each fish they could land is with the bait they would put on, and how often
 * what bites stays on with their rod. Empty without the perk, or where no
 * fish could swim. The browser's `fishJournal`, in its words.
 */
create or replace function fish_journal(p_world uuid, p_uid uuid, p_x integer, p_y integer) returns text
  language plpgsql stable as $$
declare v_mul jsonb; v_depth double precision; v_skill double precision; v_bait text; v_total double precision;
        v_shares text[]; v_on double precision; v_deep text;
begin
  if p_uid is null then return ''; end if;
  select class_mul into v_mul from player where world_id = p_world and uid = p_uid;
  if pk(v_mul, 'fish_journal', 0) <= 0 then return ''; end if;
  v_depth := water_depth(p_world, p_x, p_y);
  if v_depth < 1 then return ''; end if;
  v_skill := skill_of(p_world, p_uid, 'fishing');
  v_deep := 'Depth ' || floor(v_depth + 0.5)::int || '.';
  if not exists (select 1 from fish_here(v_depth, v_skill)) then
    return ' ' || v_deep || ' Nothing you could land runs here.';
  end if;
  v_bait := bait_for(p_world, p_uid, v_depth, v_skill);
  select sum(bite_weight(f.id, f.weight, v_bait, v_mul)) into v_total from fish_here(v_depth, v_skill) f;
  select array_agg(floor(q.w / v_total * 100 + 0.5)::int || '% ' || lower(q.name) order by q.w desc, q.id) into v_shares
    from (select f.id, f.name, bite_weight(f.id, f.weight, v_bait, v_mul) as w from fish_here(v_depth, v_skill) f) q;
  v_on := stays_on(v_skill, tool_ql(p_world, p_uid, 'fishing_rod'), v_bait is not null, pk(v_mul, 'hook:fish', 0));
  return ' ' || v_deep || ' '
    || case when v_bait is null then 'With a bare hook'
            else 'With the ' || lower((select coalesce(d.name, v_bait) from item_def d where d.id = v_bait)) || ' you carry' end
    || ', the bites here are ' || list_of(v_shares) || ', and ' || floor(v_on * 100 + 0.5)::int || '% of them stay on.';
end $$;

/*
 * A Fisher's ponds, stocked for the time since they were last looked at: a
 * fish every `pond_every` while one stands on a settlement and has room, any
 * of them at their plain weights, at about the pond's quality, onto a pile of
 * the same in it. The browser's `stockPond`.
 *
 * On the tidying round, as the hives are. A pond with no room is not written
 * to at all, and so as not to count that idle time once fish are taken out,
 * the time since it last stocked is taken as at most two rounds.
 */
create or replace function pond_sweep(p_world uuid) returns integer
  language plpgsql as $$
declare h placed; v_deed deed; v_room int; v_made int := 0; v_stock double precision; v_since double precision;
        v_def text; v_ql double precision; v_id bigint; fresh item;
begin
  for h in select * from placed where world_id = p_world and sub = 'fish_pond' and crumbles_at is null
           order by id for update skip locked
  loop
    v_deed := deed_at(p_world, h.x, h.y);
    continue when v_deed.world_id is null;
    v_room := furniture_capacity(h) - furniture_units(h);
    continue when v_room <= 0;
    v_since := least(2 * sweep_every(),
      greatest(0, extract(epoch from now() - coalesce((h.state->>'pond_at')::timestamptz, now()))));
    v_stock := coalesce((h.state->>'stock')::double precision, 0) + v_since / pond_every();
    while v_stock >= 1 and v_room > 0 loop
      v_stock := v_stock - 1;
      v_def := pick_fish(1e9, 1e9, null, random());
      exit when v_def is null;
      v_ql := least(100, greatest(1, h.ql * (0.7 + random() * 0.6)));
      -- Onto a pile of the same in the pond, as anything put in is.
      fresh.def := v_def; fresh.extra := null; fresh.rare := null; fresh.maker := null; fresh.piece := null;
      fresh.locked := false; fresh.lit := false; fresh.issued := false;
      v_id := null;
      select i.id into v_id from item i
       where i.world_id = p_world and i.holder = 'furniture' and i.placed = h.id and i.def = v_def
         and stack_key(i) = stack_key(fresh)
       order by i.id limit 1;
      if v_id is not null then
        update item set ql = (ql * count + v_ql) / (count + 1), count = count + 1 where id = v_id;
      else
        insert into item (world_id, holder, placed, def, ql, count) values (p_world, 'furniture', h.id, v_def, v_ql, 1);
      end if;
      v_room := v_room - 1;
      v_made := v_made + 1;
    end loop;
    update placed set state = coalesce(state, '{}'::jsonb) || jsonb_build_object('stock', v_stock, 'pond_at', now())
      where id = h.id;
  end loop;
  return v_made;
end $$;

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
  -- The hour comes for a dam in young whoever is or is not standing there, and
  -- somebody is always about to do something. This is where they find out.
  perform herd_settle(p_world);
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

CREATE OR REPLACE FUNCTION public.cast_at(p_world uuid, p_uid uuid, p_x integer, p_y integer, p_range double precision)
 RETURNS TABLE(x integer, y integer, depth double precision)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare py player;
begin
  select * into py from player where world_id = p_world and uid = p_uid;
  if fishable(p_world, p_x, p_y)
     and sqrt(power(p_x + 0.5 - py.x, 2) + power(p_y + 0.5 - py.y, 2)) <= p_range then
    return query select p_x, p_y, water_depth(p_world, p_x, p_y);
  else
    -- The deepest water in the square of whole tiles the reach spans round your feet, as the browser has it.
    return query select * from best_water_near(p_world, p_uid, floor(p_range)::int);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.fish_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare tx int; ty int; spot record; skill double precision;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  skill := skill_of(p_world, p_uid, 'fishing');

  if p_action = 'fish' then
    select * into spot from cast_at(p_world, p_uid, tx, ty, cast_reach(p_world, p_uid));
    if spot.depth is null then
      return 'There is no water within reach deep enough to hold anything. Walk to the bank.';
    end if;
    if not exists (select 1 from fish_here(spot.depth, skill)) then
      return 'Nothing you could land runs in water this shallow.';
    end if;
  elsif p_action = 'drag_net' then
    select * into spot from cast_at(p_world, p_uid, tx, ty, net_reach(p_world, p_uid));
    if spot.depth is null then
      return 'There is no water close enough to drag a net through. Wade in.';
    end if;
    if spot.depth < 1 then return 'The water is too thin to drag a net through.'; end if;
  end if;
  return null;
end $function$;


/*
 * The bait in the pack worth putting on here: the one favouring the best fish
 * available. With none, for a Fisher's Any Bait, the first food carried, which
 * draws nothing in particular; the last fish of a kind is never used either
 * way. The browser's `baitFor`.
 */
create or replace function bait_for(p_world uuid, p_uid uuid, p_depth double precision, p_skill double precision)
  returns text language sql stable as $$
  select coalesce(
    (select b.id from bait_def b
      cross join lateral (
        select max(100 - f.weight) as score
        from bait_favours bf join fish_here(p_depth, p_skill) f on f.id = bf.fish
        where bf.bait = b.id) s
      where s.score > 0
        and pack_count(p_world, p_uid, b.id)
            >= case when exists (select 1 from fish_def where id = b.id) then 2 else 1 end
      order by s.score desc, b.id limit 1),
    (select i.def from item i
      where pk(p_world, p_uid, 'bait:food', 0) > 0
        and exists (select 1 from fish_here(p_depth, p_skill))
        and i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and not i.locked
        and coalesce((select d.food from item_def d where d.id = i.def), 0) > 0
        and pack_count(p_world, p_uid, i.def)
            >= case when exists (select 1 from fish_def where id = i.def) then 2 else 1 end
      order by i.id limit 1))
$$;

/*
 * What a trap is baited with: for a creel what fish come to, and with none of
 * that, any food at all for a Fisher's Any Bait; for a land trap what beasts
 * eat. The browser's `baitInPack`.
 */
create or replace function bait_in_pack(p_world uuid, p_uid uuid, p_water boolean) returns item
  language sql stable as $$
  select i.* from item i
  where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and not i.locked
    and (case when p_water then exists (select 1 from bait_def b where b.id = i.def)
                                or (pk(p_world, p_uid, 'bait:food', 0) > 0
                                    and coalesce((select d.food from item_def d where d.id = i.def), 0) > 0)
              else exists (select 1 from species_diet sd where sd.item = i.def) end)
  order by (p_water and not exists (select 1 from bait_def b where b.id = i.def)), i.id
  limit 1
$$;

CREATE OR REPLACE FUNCTION public.perform_fish(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; spot record; skill double precision; rod_ql double precision;
        bait text; got text; made_ql double precision; tool_id bigint;
        haul int; i int; parts text[] := '{}'; one text; counted jsonb := '{}'::jsonb; k text;
        v_net jsonb; v_more double precision; v_mul jsonb; v_rare text; v_order text[] := '{}';
begin
  select class_mul into v_mul from player where world_id = p_world and uid = p_uid;
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  skill := skill_of(p_world, p_uid, 'fishing');

  if p_action = 'fish' then
    select * into spot from cast_at(p_world, p_uid, tx, ty, cast_reach(p_world, p_uid));
    if spot.depth is null then return; end if;
    rod_ql := tool_ql(p_world, p_uid, 'fishing_rod');
    select it.id into tool_id from item it
      where it.world_id = p_world and it.holder = 'player' and it.holder_uid = p_uid and it.def = 'fishing_rod'
      order by tool_worth(it.ql, it.dmg, it.extra, it.rare, it.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id, 0.5); end if;
    -- Something goes on the hook if anything worth using is in the pack.
    bait := bait_for(p_world, p_uid, spot.depth, skill);
    if bait is not null and pack_count(p_world, p_uid, bait) < 1 then return; end if;

    got := catch_fish(spot.depth, skill, rod_ql, bait, v_mul);
    -- The bait goes with a landed fish, and with one that comes off unless a
    -- Fisher's Bait Saver keeps it on the hook.
    if bait is not null and (got is not null
                             or not (pk(v_mul, 'spare:fish', 0) > 0 and random() < pk(v_mul, 'spare:fish', 0))) then
      perform consume(p_world, p_uid, bait, 1);
    end if;
    -- Written below the cast rather than above it: what comes off the hook
    -- used to teach exactly what a landed fish taught.
    perform skill_raise(p_world, p_uid, 'fishing', try_gain(got is not null, rod_gain()));
    if got is null then
      perform tell(p_world, p_uid, case when bait is null then 'Something takes it and comes off again.'
        else 'Something takes the ' || lower((select coalesce(name, bait) from item_def where id = bait))
             || ' and comes off again.' end, 'event');
    else
      made_ql := product_ql(skill, rod_ql);
      -- And now and then a rare one, for a Fisher's Rare Catch.
      v_rare := perk_rare(pk(v_mul, 'rare:fish', 0));
      perform gather(p_world, p_uid, got, 1, made_ql, null, v_rare);
      perform journal_note(p_world, p_uid, 'fish:' || got);
      if bait is not null then perform journal_note(p_world, p_uid, 'baited'); end if;
      perform tell(p_world, p_uid, 'You land '
        || case when coalesce(v_rare, lower((select name from fish_def where id = got))) ~ '^[aeiou]' then 'an ' else 'a ' end
        || coalesce(v_rare || ' ', '') || lower((select name from fish_def where id = got))
        || case when bait is null then '' else ' on the '
             || lower((select coalesce(name, bait) from item_def where id = bait)) end
        || '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
      if v_rare is not null then
        perform journal_note(p_world, p_uid, v_rare);
        perform tell(p_world, p_uid, rarity_word(v_rare), 'skill');
      end if;
    end if;

  elsif p_action = 'drag_net' then
    select * into spot from cast_at(p_world, p_uid, tx, ty, net_reach(p_world, p_uid));
    if spot.depth is null then return; end if;
    rod_ql := tool_ql(p_world, p_uid, 'fishing_net');
    select it.id, it.mark into tool_id, v_net from item it
      where it.world_id = p_world and it.holder = 'player' and it.holder_uid = p_uid and it.def = 'fishing_net'
      order by tool_worth(it.ql, it.dmg, it.extra, it.rare, it.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id, 1.4); end if;
    if not exists (select 1 from fish_here(spot.depth, skill)) then
      perform skill_raise(p_world, p_uid, 'fishing', try_gain(false, net_gain()));
      perform tell(p_world, p_uid, 'The net comes up with nothing in it but weed.', 'event');
      return;
    end if;
    -- A net takes numbers, not size: the big fish go round it or through it.
    -- A Fisher's Full Net hauls more before anything else is counted in.
    haul := net_least()::int + floor(random() * (1 + (net_haul() - net_least()) * (0.3 + least(100, rod_ql) / 160)))::int
      + floor(pk(v_mul, 'haul:drag_net', 0))::int;
    -- And more of it for its maker's hand in the net (a Tailor's Fisher's Friend): the share
    -- over a whole fish is a chance at one more, so the catch is that much more on the average.
    if mark_of(v_net, 'catch') <> 1 then
      v_more := haul * mark_of(v_net, 'catch');
      haul := floor(v_more)::int + case when random() < v_more - floor(v_more) then 1 else 0 end;
    end if;
    for i in 1..haul loop
      one := pick_fish(spot.depth, skill, null, random(), v_mul);
      -- Anything that lives deeper than a net reaches mostly avoids it.
      if one is not null and ((select depth from fish_def where id = one) <= 8 or random() < 0.12) then
        -- And now and then a rare one, for a Fisher's Rare Catch, on a pile of its own.
        v_rare := perk_rare(pk(v_mul, 'rare:drag_net', 0));
        k := one || ':' || coalesce(v_rare, '');
        counted := jsonb_set(counted, array[k], to_jsonb(coalesce((counted->>k)::int, 0) + 1));
        -- Said in the order they came up, as the browser says them.
        if not k = any(v_order) then v_order := v_order || k; end if;
      end if;
    end loop;
    if counted = '{}'::jsonb then
      perform skill_raise(p_world, p_uid, 'fishing', try_gain(false, net_gain()));
      perform tell(p_world, p_uid, 'The net comes up empty.', 'event');
      return;
    end if;
    perform skill_raise(p_world, p_uid, 'fishing', try_gain(true, net_gain()));
    made_ql := product_ql(skill, rod_ql);
    perform journal_note(p_world, p_uid, 'netted');
    foreach k in array v_order loop
      one := split_part(k, ':', 1);
      v_rare := nullif(split_part(k, ':', 2), '');
      perform gather(p_world, p_uid, one, (counted->>k)::int, made_ql, null, v_rare);
      perform journal_note(p_world, p_uid, 'fish:' || one, (counted->>k)::int);
      parts := parts || ((counted->>k) || ' × ' || coalesce(v_rare || ' ', '')
                         || lower((select coalesce(name, one) from item_def where id = one)));
      if v_rare is not null then
        perform journal_note(p_world, p_uid, v_rare);
        perform tell(p_world, p_uid, rarity_word(v_rare), 'skill');
      end if;
    end loop;
    perform tell(p_world, p_uid, 'You walk the net round and haul it in: '
      || array_to_string(parts, ', ') || '.', 'event');
  end if;

end $function$;

CREATE OR REPLACE FUNCTION public.trap_settle(p_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare p placed; d trap_def; v_dmg double precision; v_n int; v_best creature;
        v_chance double precision; v_odds double precision; s species_def;
        v_depth double precision; v_got text; v_held int; v_ql double precision; v_new bigint; v_mul jsonb;
begin
  select * into p from placed where id = p_id and kind = 'trap' for update;
  if not found then return false; end if;
  select * into d from trap_def where id = p.sub;

  v_dmg := trap_dmg(p);
  if v_dmg >= 100 then
    if p.caught is not null then
      perform spring_trap(p_id, 'The ' || lower(trap_name(p))
        || ' rots through and whatever was in it walks away.');
    end if;
    if p.made_by is not null then
      perform tell(p.world_id, p.made_by, 'A ' || lower(trap_name(p))
        || ' has rotted through out in the country.', 'system');
    end if;
    delete from item where holder = 'trap' and placed = p_id;
    delete from placed where id = p_id;
    return true;
  end if;

  -- How many rolls there were between then and now, bounded by its own life.
  v_n := floor(least(extract(epoch from (now() - p.since)), trap_life(p.sub, p.ql))
               / trap_check_every())::int;
  update placed set dmg = v_dmg, since = now() where id = p_id;
  if p.bait is null or v_n < 1 then return false; end if;

  if d.water then
    v_held := coalesce((select sum(i.count)::int from item i
                        where i.holder = 'trap' and i.placed = p_id), 0);
    -- As many as it holds, more for a Fisher's Deep Creel in it.
    if v_held >= creel_hold(p) then return false; end if;
    -- What its setter's perks make of what its bait draws (a Fisher's Strong Bait and Big Fish).
    select pl.class_mul into v_mul from player pl where pl.world_id = p.world_id and pl.uid = p.made_by;
    v_depth := water_depth(p.world_id, p.x, p.y);
    -- Better odds for its maker's hand in it (a Tailor's Fisher's Friend).
    v_odds := d.odds * (0.6 + least(100, greatest(1, p.ql)) / 250) * mark_of(p.mark, 'catch');
    -- One roll standing for all of them, then one fish for each success it is
    -- still willing to hold.
    for v_n in 1..least(v_n, creel_hold(p) - v_held) loop
      exit when random() >= v_odds;
      v_got := pick_fish(v_depth, 40, p.bait, random(), v_mul);
      exit when v_got is null;
      v_ql := greatest(1, least(100, p.ql * (0.5 + random() * 0.7)));
      insert into item (world_id, holder, placed, def, ql, count)
      values (p.world_id, 'trap', p_id, v_got, v_ql, 1);
      -- Every so often the bait is worked out of it and it goes on empty.
      if random() < 0.14 then
        update placed set bait = null, bait_ql = null where id = p_id;
        if p.made_by is not null then
          perform tell(p.world_id, p.made_by, 'The bait is gone out of a creel. '
            || 'It will take nothing more until it is baited again.', 'system');
        end if;
        exit;
      end if;
    end loop;
    return false;
  end if;

  if p.caught is not null then return false; end if;
  -- The likeliest thing in reach that would come to what is laid, and is not
  -- so wary that it simply takes the bait and goes.
  for v_best in select c.* from creature c
    where c.world_id = p.world_id and c.mode = 'wild' and c.trapped is null
      and sqrt((creature_x(c) - p.cx) ^ 2 + (creature_y(c) - p.cy) ^ 2) <= d.reach
    order by catch_chance(p, c) desc, c.id
  loop
    select * into s from species_def where id = v_best.species;
    if s.monster or not exists (select 1 from species_diet sd
          where sd.species = s.id and sd.item = p.bait) then
      continue;
    end if;
    if s.tame_level > trap_holds(p) then
      -- Too much trap for: a third of a chance a roll that it lifts the bait.
      if random() < 1 - power(0.7, v_n) then
        update placed set bait = null, bait_ql = null where id = p_id;
        if p.made_by is not null then
          perform tell(p.world_id, p.made_by, 'Something took the bait out of your '
            || lower(trap_name(p)) || ' and was gone. It was too much trap for.', 'system');
        end if;
        return false;
      end if;
      continue;
    end if;
    v_chance := catch_chance(p, v_best);
    exit;
  end loop;
  if v_best.id is null or v_chance is null then return false; end if;

  -- The one roll that stands for all of them.
  if random() >= 1 - power(1 - v_chance, v_n) then return false; end if;
  update creature set trapped = p_id,
      from_x = p.cx, from_y = p.cy, to_x = p.cx, to_y = p.cy,
      leg_at = now(), leg_ends = now(), until = now() + interval '1 hour',
      hunting = null, enemy = null, settled_at = now()
    where world_id = p.world_id and id = v_best.id;
  update placed set caught = v_best.id where id = p_id;
  if p.made_by is not null then
    -- The browser's own words, and it says them the instant the board falls.
    -- Here nobody was there for the instant, so it is said when somebody next
    -- looks — which is the whole of what a trap is for.
    perform journal_note(p.world_id, p.made_by, 'caught');
    perform tell(p.world_id, p.made_by, 'Your ' || lower(trap_name(p))
      || ' has sprung. There is a ' || lower(s.name) || ' in it.', 'event');
  end if;
  return false;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_trap(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare p placed; d trap_def; it item; c creature; s species_def; dd deed;
        v_sx int; v_sy int; v_names text; v_comers int; v_clean boolean; v_back bigint; v_one bigint;
begin
  if p_action = 'set_trap' then
    select * into it from item where world_id = p_world and holder = 'player' and holder_uid = p_uid
      and not locked and exists (select 1 from trap_def td where td.id = item.def)
      and (target_item(p_target) is null or id = target_item(p_target))
      order by id limit 1;
    if not found then return; end if;
    select * into d from trap_def where id = it.def;
    v_sx := least(subtiles() - 1, greatest(0, coalesce((p_target->>'sx')::int, 0)));
    v_sy := least(subtiles() - 1, greatest(0, coalesce((p_target->>'sy')::int, 0)));
    -- Its maker's hand goes into the water with it (a Tailor's Fisher's Friend).
    insert into placed (world_id, kind, sub, material, x, y, sx, sy, cx, cy, ql, dmg, made_by, mark)
    values (p_world, 'trap', it.def, it.extra, (p_target->>'x')::int, (p_target->>'y')::int,
            v_sx, v_sy, (p_target->>'x')::int + (v_sx + 0.5) / subtiles(),
            (p_target->>'y')::int + (v_sy + 0.5) / subtiles(), it.ql, it.dmg, p_uid, nullif(it.mark, '{}'::jsonb))
    returning * into p;
    delete from item where id = it.id;
    perform tell(p_world, p_uid, case when d.water
      then 'You sink the ' || lower(trap_name(p)) || ' and make the line fast. It will fish about '
           || round(trap_life(p.sub, p.ql) / 60) || ' minutes and holds ' || creel_hold(p) || '. Bait it.'
      else 'You set the ' || lower(trap_name(p)) || ' and cover the sign of it. It will stand about '
           || round(trap_life(p.sub, p.ql) / 60) || ' minutes and will hold anything up to taming '
           || to_char(trap_holds(p), 'FM990') || '. Bait it.' end, 'event');
    perform land_announce(p_world, p.x, p.y);
    return;
  end if;

  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
  if not found then return; end if;
  select * into d from trap_def where id = p.sub;

  if p_action = 'bait_trap' then
    it := bait_in_pack(p_world, p_uid, d.water);
    if it.id is null then return; end if;
    -- Whatever was in it goes back in the pack rather than on the ground.
    if p.bait is not null then perform give(p_world, p_uid, p.bait, 1, coalesce(p.bait_ql, 20)); end if;
    if not consume(p_world, p_uid, it.def, 1, it.id) then return; end if;
    update placed set bait = it.def, bait_ql = it.ql, since = now() where id = p.id;
    if d.water then
      perform tell(p_world, p_uid, 'You put the '
        || lower((select name from item_def where id = it.def))
        || ' in the creel and sink it again. '
        || coalesce((select note from bait_def where id = it.def), ''), 'event');
    else
      select count(*) into v_comers from species_def sp
        where exists (select 1 from species_diet sd where sd.species = sp.id and sd.item = it.def)
          and sp.tame_level <= trap_holds(p);
      perform tell(p_world, p_uid, 'You lay the '
        || lower((select name from item_def where id = it.def)) || ' in the ' || lower(trap_name(p))
        || '. ' || case when v_comers = 0 then 'Nothing this trap will hold eats that.'
                        when v_comers = 1 then 'One sort would come to that.'
                        else v_comers || ' sorts would come to that.' end, 'event');
    end if;

  elsif p_action = 'take_catch' then
    select * into c from creature where world_id = p_world and id = p.caught;
    if not found then return; end if;
    select * into s from species_def where id = c.species;
    if tame_room_refusal(p_world, p_uid) is not null then
      perform tell(p_world, p_uid, tame_room_refusal(p_world, p_uid), 'error');
      return;
    end if;
    -- It is held, not willing. Getting it out without being bitten is the skill.
    v_clean := skill_check(skill_of(p_world, p_uid, 'taming'), s.tame_level + 10, p.ql,
                           mind_ease(p_world, p_uid));
    perform skill_raise(p_world, p_uid, 'taming', try_gain(v_clean, free_gain()));
    if not v_clean then
      perform tell(p_world, p_uid, 'The ' || lower(s.name)
        || ' thrashes and you cannot get a hand on it. It is still held.', 'error');
      return;
    end if;
    update placed set caught = null, bait = null, bait_ql = null where id = p.id;
    -- Won over as surely as by hand, and on the same skill: the field guide counts it as tamed.
    perform guide_mark(p_world, p_uid, c.species, 'tamed');
    select * into dd from my_deed(p_world, p_uid) md where md.world_id is not null;
    if not exists (select 1 from creature q where q.world_id = p_world and q.mode = 'active'
                     and q.keeper = p_uid) then
      update creature set trapped = null, mode = 'active', keeper = p_uid, until = now()
        where world_id = p_world and id = c.id;
      perform journal_note(p_world, p_uid, 'trapped');
      perform tell(p_world, p_uid, 'You get the noose off the ' || lower(s.name)
        || ' and it stays. It comes with you.', 'event');
    else
      update creature set trapped = null, mode = 'active', keeper = p_uid, until = now()
        where world_id = p_world and id = c.id;
      perform crate_shut_in(p_world, c.id, empty_crate(p_world, p_uid), null);
      perform journal_note(p_world, p_uid, 'trapped');
      perform tell(p_world, p_uid, 'You get the noose off the ' || lower(s.name)
        || ' and put it straight into the creature crate in your pack.', 'event');
    end if;

  elsif p_action = 'free_catch' then
    perform spring_trap(p.id,
      'You lift the board and it is gone into the grass before you have straightened up.');

  elsif p_action = 'empty_creel' then
    select string_agg(i.count || ' × ' || lower(f.name), ', ' order by f.name), count(*)
      into v_names, v_comers
      from item i join item_def f on f.id = i.def
      where i.holder = 'trap' and i.placed = p.id;
    if v_comers = 0 then return; end if;
    -- Into the cart you are working from first, as far as it has room.
    for v_one in select i.id from item i where i.holder = 'trap' and i.placed = p.id order by i.id loop
      perform gather_item(p_world, p_uid, v_one);
    end loop;
    update item set holder = 'player', holder_uid = p_uid, placed = null
      where holder = 'trap' and placed = p.id;
    perform pack_fold(p_world, p_uid);
    perform skill_raise(p_world, p_uid, 'fishing', 0.5);
    perform journal_note(p_world, p_uid, 'creeled');
    perform tell(p_world, p_uid, 'You lift the creel and tip it out: ' || v_names || '.', 'event');

  elsif p_action = 'pick_up_trap' then
    if p.bait is not null then perform give(p_world, p_uid, p.bait, 1, coalesce(p.bait_ql, 20)); end if;
    update item set holder = 'player', holder_uid = p_uid, placed = null
      where holder = 'trap' and placed = p.id;
    perform pack_fold(p_world, p_uid);
    v_back := give(p_world, p_uid, p.sub, 1, p.ql, p.material, null, null, null, p.mark);
    update item set dmg = trap_dmg(p) where id = v_back;
    perform tell(p_world, p_uid, 'You take the ' || lower(trap_name(p)) || ' up'
      || case when p.bait is not null then ' and pocket the bait' else '' end || '.', 'event');
    delete from placed where id = p.id;
    perform land_announce(p_world, p.x, p.y);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_hands(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare it item; p player; v_x int; v_y int; v_want int; v_name text; v_was text;
        v_took bigint[]; v_row record; v_left int; v_cool double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'examine' then
    perform tell(p_world, p_uid,
      examine_tile_text(p_world, (p_target->>'x')::int, (p_target->>'y')::int, p_uid), 'event');

  elsif p_action = 'examine_item' then
    select * into it from item where world_id = p_world and id = target_item(p_target);
    if found then perform tell(p_world, p_uid, examine_item_text(p_world, p_uid, it), 'event'); end if;

  elsif p_action = 'lock_item' or p_action = 'unlock_item' then
    select * into it from item where world_id = p_world and id = target_item(p_target)
      and holder = 'player' and holder_uid = p_uid;
    if not found then return; end if;
    update item set locked = (p_action = 'lock_item') where id = it.id;
    if p_action = 'lock_item' then
      perform tell(p_world, p_uid, 'You set the ' || lower(item_name(it))
        || ' aside. Nothing will spend it, drop it or feed it away until you say so.', 'info');
    else
      perform tell(p_world, p_uid, 'The ' || lower(item_name(it)) || ' is fair game again.', 'info');
    end if;

  elsif p_action = 'drop' then
    select * into it from item where world_id = p_world and id = target_item(p_target)
      and holder = 'player' and holder_uid = p_uid;
    if not found then return; end if;
    v_want := least(greatest(1, coalesce((p_target->>'count')::int, 1)), it.count);
    -- Food set down by a Cook with Cool Pack, and fish by a Fisher with theirs, rots slower where it lies.
    v_cool := nullif(case when (select d.category from item_def d where d.id = it.def) = 'food'
                          then pk(p_world, p_uid, 'cool:food', 1) else 1 end
                     * pk(p_world, p_uid, 'cool:' || it.def, 1), 1);
    if v_want >= it.count then
      -- The whole stack goes down as it stands, keeping its own number.
      update item set holder = 'ground', holder_uid = null, gx = floor(p.x)::int, gy = floor(p.y)::int,
          locked = false, made_at = now(), cool = v_cool
        where id = it.id;
    else
      update item set count = it.count - v_want where id = it.id;
      /*
       * The part set down is the same thing as the rest: its maker's mark, its
       * rarity, its colour and its blessing go down with it. This made a plain
       * one of it (`drop_on_ground`), so a Smith's tempered nails set down a
       * handful at a time came up untempered, and a rare stack's handful was
       * not rare.
       */
      insert into item (world_id, holder, gx, gy, def, ql, dmg, count, extra, rare, dye, bless, maker, piece, mark, cool)
      values (p_world, 'ground', floor(p.x)::int, floor(p.y)::int, it.def, it.ql, it.dmg, v_want, it.extra,
              it.rare, it.dye, it.bless, it.maker, it.piece, it.mark, v_cool);
    end if;
    perform tell(p_world, p_uid, 'You drop '
      || case when v_want > 1 then v_want || ' × ' || lower(item_name(it))
              else 'the ' || lower(item_name(it)) end
      || ' on the ground.', 'event');
    perform land_announce(p_world, floor(p.x)::int, floor(p.y)::int);

  elsif p_action = 'pick_up' then
    v_x := (p_target->>'x')::int; v_y := (p_target->>'y')::int;
    -- A named thing if the target says which; otherwise whatever is on top,
    -- which is how a pile answers when nobody has said.
    select * into it from item where world_id = p_world and holder = 'ground'
      and gx = v_x and gy = v_y
      and (target_item(p_target) is null or id = target_item(p_target))
      order by id limit 1;
    if not found then return; end if;
    -- Nothing rots off the ground, so what kept it from rotting there goes with it.
    update item set holder = 'player', holder_uid = p_uid, gx = null, gy = null, cool = null where id = it.id;
    -- Onto the pile it came off, rather than beside it.
    perform pack_fold_one(it.id);
    perform tell(p_world, p_uid, 'You pick up ' ||
      case when it.count > 1 then it.count || ' × ' else '' end || lower(item_name(it)) || '.', 'event');
    perform land_announce(p_world, v_x, v_y);

  elsif p_action = 'pick_up_all' then
    v_x := (p_target->>'x')::int; v_y := (p_target->>'y')::int;
    /*
     * Nearest first, because a sweep that fills your hands should fill them
     * with what is under your feet rather than what is furthest away.
     */
    for v_row in select i.id, i.gx, i.gy from item i
      where i.world_id = p_world and i.holder = 'ground'
        and abs(i.gx - v_x) <= sweep_range() and abs(i.gy - v_y) <= sweep_range()
      order by (i.gx - v_x) ^ 2 + (i.gy - v_y) ^ 2, i.id
    loop
      update item set holder = 'player', holder_uid = p_uid, gx = null, gy = null, cool = null where id = v_row.id;
      v_took := v_took || v_row.id;
      perform land_announce(p_world, v_row.gx, v_row.gy);
    end loop;
    if v_took is null then
      perform tell(p_world, p_uid, 'There is nothing lying about here.', 'error');
    else
      perform tell(p_world, p_uid, 'You gather up ' || pile_text(v_took) || '.', 'event');
      /*
       * After the naming, never during it.
       *
       * The sweep collects row ids as it goes and `pile_text` reads them back
       * at the end to say what was picked up. Fold inside the loop and those
       * rows are gone -- folded into piles they met in the pack -- so a gather
       * of a corpse, three logs and five rock shards announced itself as "You
       * gather up corpse." The suite caught it in one line.
       */
      perform pack_fold(p_world, p_uid);
    end if;

  elsif p_action = 'name_thing' then
    v_name := left(btrim(coalesce(p_target->>'name', '')), 28);
    if p_target->>'kind' = 'crate' then
      select coalesce(c.name, crate_name(c)) into v_was from crate c
        where c.world_id = p_world and c.id = (p_target->>'id')::int;
      update crate set name = nullif(v_name, '')
        where world_id = p_world and id = (p_target->>'id')::int;
    else
      select coalesce(pl.name, (select f.name from furniture_def f where f.id = pl.sub))
        into v_was from placed pl
        where pl.world_id = p_world and pl.id = (p_target->>'id')::bigint;
      update placed set name = nullif(v_name, '')
        where world_id = p_world and id = (p_target->>'id')::bigint;
    end if;
    if v_name = '' then
      -- An empty answer takes the name off again rather than leaving a blank.
      perform tell(p_world, p_uid, 'It goes back to being what it was.', 'info');
    else
      perform tell(p_world, p_uid, 'The ' || lower(coalesce(v_was, 'thing'))
        || ' is called ' || v_name || ' from now on.', 'info');
    end if;
  end if;
end $function$;

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
    if v_t = tile_id('Grass') and v_data <> 0 then
      v_out := v_out || ' Kept cut: ' || ((v_data & 3) + case when (v_data & 4) <> 0 then 1 else 0 end) || ' of 3 days towards lawn.';
    end if;
  end if;
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
    end if;
  end if;
  select count(*) into n from crate c where c.world_id = p_world
    and p_x between c.x and c.x + c.sx - 1 and p_y between c.y and c.y + c.sy - 1;
  if n = 1 then v_extra := v_extra || ' A crate stands here.';
  elsif n > 1 then v_extra := v_extra || ' ' || n || ' crates stand here.'; end if;
  return v_out || v_extra;
end $function$;

CREATE OR REPLACE FUNCTION public.craft_refusal(p_world uuid, p_uid uuid, p_recipe text, p_prefer bigint)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare r recipe; i record; mat text; have int; tx int; ty int;
begin
  select * into r from recipe where id = p_recipe;
  if not found then return null; end if;
  -- What only a Cook who has learned it may make (a Cook's Broth and Distil).
  -- The browser says the same (`RECIPE_PERK_SAYS`).
  if p_recipe = 'make_broth' and pk(p_world, p_uid, 'broth', 0) <= 0 then
    return 'That wants a Cook who has learned to make broth.';
  end if;
  if p_recipe like 'distil\_%' and pk(p_world, p_uid, 'distil', 0) <= 0 then
    return 'That wants a Cook who has learned to distil.';
  end if;
  if p_recipe = 'make_tent' and pk(p_world, p_uid, 'tent', 0) <= 0 then
    return 'That wants a Tailor who has learned to make a tent.';
  end if;
  -- A Naturalist's three remedies, each of any of the healing herbs.
  if p_recipe like 'brew\_tea\_%' and pk(p_world, p_uid, 'herb_tea', 0) <= 0 then
    return 'That wants a Naturalist who has learned to make herb tea.';
  end if;
  if p_recipe like 'make\_salve\_%' and pk(p_world, p_uid, 'salve', 0) <= 0 then
    return 'That wants a Naturalist who has learned to make a salve.';
  end if;
  if p_recipe like 'make\_tincture\_%' and pk(p_world, p_uid, 'tincture', 0) <= 0 then
    return 'That wants a Naturalist who has learned to make a tincture.';
  end if;
  -- A Fisher's smoked fish, of any fish, and their pond.
  if p_recipe like 'smoke\_%' and pk(p_world, p_uid, 'smoke_fish', 0) <= 0 then
    return 'That wants a Fisher who has learned to smoke fish.';
  end if;
  if p_recipe = 'make_fish_pond' and pk(p_world, p_uid, 'fish_pond', 0) <= 0 then
    return 'That wants a Fisher who has learned to make a fish pond.';
  end if;
  if r.tool is not null and tool_ql(p_world, p_uid, r.tool) <= 0 then
    return 'You need a ' || lower((select coalesce(name, r.tool) from item_def where id = r.tool)) || '.';
  end if;
  if r.station is not null and not at_station(p_world, p_uid, r.station) then
    return 'You need to stand at a ' || station_name(r.station) || '.';
  end if;
  if r.deed then
    select floor(p.x)::int, floor(p.y)::int into tx, ty
      from player p where p.world_id = p_world and p.uid = p_uid;
    if tx is null or not on_my_deed(p_world, p_uid, tx, ty) then
      return 'You can only build this standing on a settlement of yours.';
    end if;
    -- And one altar to a settlement: none built on one that has its altar.
    if exists (select 1 from furniture_def f where f.id = r.result and f.altar)
       and altar_on_deed(p_world, p_uid, tx, ty) then
      return 'This settlement already has an altar, and a settlement may have only one.';
    end if;
  end if;
  mat := craft_material(p_world, p_uid, p_recipe, p_prefer);
  for i in select * from recipe_input where recipe = p_recipe order by ord loop
    have := greatest(craft_count(p_world, p_uid, i.item, mat, p_prefer), craft_count(p_world, p_uid, i.item, null, p_prefer));
    -- As few as a perk on the recipe asks (a Carpenter's String Maker).
    if have < recipe_need(p_world, p_uid, p_recipe, i.count) then
      return (select coalesce(name, r.result) from item_def where id = r.result)
        || ' takes ' || recipe_need(p_world, p_uid, p_recipe, i.count) || ' '
        || plural_of(i.item, recipe_need(p_world, p_uid, p_recipe, i.count)) || '.';
    end if;
  end loop;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.furniture_capacity(p placed)
 RETURNS integer
 LANGUAGE sql
 STABLE
AS $function$
  select room_for(coalesce((select coalesce(capacity, hive, pond, 0) from furniture_def where id = p.sub), 0)
    * mat_hold(p.material) * mark_of(p.mark, 'hold'), p.rare)
$function$;

CREATE OR REPLACE FUNCTION public.furniture_refuses(p placed, p_def text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select case
    when holds_liquid(p) then v.it || ' holds liquid and nothing else.'
    when d.hive is not null then v.it || ' is the swarm''s, not yours. Take what is in it; do not put anything back.'
    when d.pond is not null then v.it || ' stocks itself. Take the fish out of it; do not put anything back.'
    when not furniture_holds(p) then v.it || ' does not hold things.'
    when p_def = 'creature_crate' and not coalesce(d.stall, false)
      then 'A creature crate goes on a stall, and in no other store.'
    else furniture_takes(d.takes, p_def)
    end
  from furniture_def d
  cross join lateral (select case when lower(d.name) ~ '^[aeiou]' then 'An ' else 'A ' end
                        || lower(d.name) as it) v
  where d.id = p.sub
$function$;

CREATE OR REPLACE FUNCTION public.world_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare v_rotted int := 0; w record; p record; v_lit int := 0; v_fired int := 0;
        v_t0 timestamptz; v_mark timestamptz;
        v_settle_ms double precision := 0; v_stir_ms double precision := 0;
        v_sweep_ms double precision := 0; v_tidy_ms double precision := 0;
        v_worlds int := 0; v_settled int := 0; v_stirred int := 0;
        v_sprung int := 0; v_gone int := 0;
        v_said int := 0; v_folded int := 0; v_sunk int := 0;
        v_tidy boolean := false; v_deadline timestamptz; v_coarse boolean;
        v_err text; v_state text; v_where text; v_faults int := 0;
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

  v_t0 := clock_timestamp();
  -- How long this round may spend settling wildlife. See the note above.
  v_deadline := clock_timestamp() + settle_budget();

  -- The tidying is not the settling and does not want the settling's pace: a
  -- scan every five seconds to delete nothing is just a scan.
  update keeper set swept_at = now()
    where one and swept_at < now() - make_interval(secs => sweep_every());
  v_tidy := found;

  -- In the order `tick_order` gives: the islands with the fewest people awake on them first.
  for w in
    select t.id from tick_order() as t(id) limit tick_worlds()
  loop
    v_worlds := v_worlds + 1;

    -- Everything anybody has finished doing, and the next go of it. This is
    -- not on the budget: a person waiting on their own action is the one
    -- thing the clock exists to serve, and there are at most `tick_players()`
    -- of them.
    v_mark := clock_timestamp();
    for p in select uid from player
      where world_id = w.id and act is not null and act_ends <= now()
      order by uid limit tick_players()
    loop
      v_settled := v_settled + settle(w.id, p.uid);
    end loop;
    v_settle_ms := v_settle_ms + ms_since(v_mark);

    /*
     * The rest of the round goes in blocks of its own, for the reason
     * `settle` does: one sweep that raised an error took every island's round
     * down with it, and with it the settling of everybody's work. A fault is
     * kept in `private.tick_fault`, that block's work this round is undone,
     * and the round goes on.
     */
    /*
     * The country round everybody still on their feet — once per patch of it,
     * and only while the round has time left.
     *
     * A crowd at a token or a mine face is a dozen bodies on one tile, and
     * this swept the same ground for each of them. Deduping on the tile is the
     * conservative version of that: two people standing together cost one
     * sweep, two people a tile apart still cost two, and nothing that was
     * being stirred stops being stirred.
     */
    v_mark := clock_timestamp();
    -- What is shown, and a little past it, every round; and the tame in the
    -- whole old box once every `stir_coarse_every()` seconds.
    v_coarse := floor(extract(epoch from v_t0))::bigint % stir_coarse_every()::bigint = 0;
    begin
      for p in select distinct floor(x) as x, floor(y) as y from player
        where world_id = w.id and not away
          and seen_at > now() - make_interval(secs => idle_logout())
        order by 1, 2 limit tick_players()
      loop
        exit when clock_timestamp() > v_deadline;
        v_stirred := v_stirred + creature_sweep(w.id, p.x, p.y, 40, v_deadline, stir_slack());
        if v_coarse then
          v_stirred := v_stirred + creature_sweep(w.id, p.x, p.y, 40, v_deadline, null, true);
        end if;
      end loop;
    exception
      when deadlock_detected or lock_not_available or serialization_failure then raise;
      when others then
        get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_where = pg_exception_context;
        perform fault_note(w.id, null, 'stir', null, v_err, v_state, v_where);
        v_faults := v_faults + 1;
    end;
    v_stir_ms := v_stir_ms + ms_since(v_mark);
    v_mark := clock_timestamp();

    begin
      v_sprung := v_sprung + trap_sweep(w.id) + post_sweep(w.id);
      -- And the braziers, which take at dusk and are raked out at dawn.
      v_lit := v_lit + brazier_sweep(w.id);
      -- And the furnaces, which used to move only when somebody asked them a question.
      v_fired := v_fired + furnace_sweep(w.id);
      -- And what is lying about, going off where it lies.
      v_rotted := v_rotted + ground_sweep(w.id);
      v_gone := v_gone + log_out_idle(w.id);
    exception
      when deadlock_detected or lock_not_available or serialization_failure then raise;
      when others then
        get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_where = pg_exception_context;
        perform fault_note(w.id, null, 'sweeps', null, v_err, v_state, v_where);
        v_faults := v_faults + 1;
    end;
    v_sweep_ms := v_sweep_ms + ms_since(v_mark);

    if v_tidy then
      v_mark := clock_timestamp();
      begin
        v_said := v_said + prune_events(w.id);
        -- And the hives, filling with honey and wax for the swarms kept by them.
        perform hive_sweep(w.id);
        -- And a Fisher's ponds, stocking themselves.
        perform pond_sweep(w.id);
        v_folded := v_folded + compact_changes(w.id);
      exception
        when deadlock_detected or lock_not_available or serialization_failure then raise;
        when others then
          get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_where = pg_exception_context;
          perform fault_note(w.id, null, 'tidy', null, v_err, v_state, v_where);
          v_faults := v_faults + 1;
      end;
      v_tidy_ms := v_tidy_ms + ms_since(v_mark);
    end if;
  end loop;

  if v_tidy then
    v_mark := clock_timestamp();
    begin
      v_sunk := reap_islands();
      -- An hour of rounds is all anybody needs to see where the time went.
      delete from tick_time where at < now() - interval '1 hour';
      -- And a week of faults, which is long enough for somebody to ask.
      delete from private.tick_fault where last_at < now() - interval '7 days';
    exception
      when deadlock_detected or lock_not_available or serialization_failure then raise;
      when others then
        get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_where = pg_exception_context;
        perform fault_note(null, null, 'reap', null, v_err, v_state, v_where);
        v_faults := v_faults + 1;
    end;
    v_tidy_ms := v_tidy_ms + ms_since(v_mark);
  end if;

  /*
   * And the wildlife, but only where nothing else is going to do it.
   *
   * `stock_tick` has a `pg_cron` job of its own, because a block of fresh
   * country is a second and a half and this clock comes round every one of
   * them: run it from in here on a project that has cron and the world clock
   * would spend most of its life holding its own lock and skipping beats.
   *
   * Where there is no `pg_cron` -- the suite's bare postgres, and any project
   * without the extension -- this clock is the only clock there is, wound by
   * `rpc_settle` and the browser, so the stocking has to ride it or no wild
   * thing would ever be put out at all.
   */
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform stock_tick();
  end if;

  /*
   * And where the round went, which no run has ever been able to say.
   *
   * `pg_stat_statements` gives one mean for `world_tick` and nothing about
   * which half of it is slow, so an island that will not keep up has had to be
   * diagnosed by reading the source and guessing. One row a round, four
   * numbers, pruned to the last hour on the tidy sweep -- about eighteen
   * hundred rows at a round every two seconds, which is a rounding error
   * beside the work it describes.
   */
  insert into tick_time (ms, worlds, stages) values (
    ms_since(v_t0), v_worlds,
    jsonb_build_object('settle', round(v_settle_ms::numeric, 2),
                       'stir', round(v_stir_ms::numeric, 2),
                       'sweeps', round(v_sweep_ms::numeric, 2),
                       'tidy', round(v_tidy_ms::numeric, 2),
                       'faults', v_faults));

  perform pg_advisory_unlock(hashtext('world_tick')::bigint);
  return jsonb_build_object('worlds', v_worlds, 'settled', v_settled, 'rotted', v_rotted,
                            'stirred', v_stirred, 'sprung', v_sprung, 'left', v_gone,
                            'swept', v_said, 'folded', v_folded, 'sunk', v_sunk,
                            'braziers', v_lit, 'fired', v_fired, 'faults', v_faults);
end $function$;


/*
 * The Fisher's tree, cleared, as the eleven before it were: its nodes left
 * `class_node` with the rulebook that brought its perks, whatever of them
 * anybody had taken goes, and every Fisher's fold is written again.
 */
delete from player_node where node ~ '^fisher_[0-9]_[0-9]$';
do $$
declare r record;
begin
  for r in select world_id, uid from player where craft_class = 'fisher' loop
    perform class_fold(r.world_id, r.uid);
  end loop;
end $$;

revoke all on function stays_on(double precision, double precision, boolean, double precision) from public, anon, authenticated;
revoke all on function bite_weight(text, double precision, text, jsonb) from public, anon, authenticated;
revoke all on function pick_fish(double precision, double precision, text, double precision, jsonb) from public, anon, authenticated;
revoke all on function catch_fish(double precision, double precision, double precision, text, jsonb) from public, anon, authenticated;
revoke all on function cast_reach(uuid, uuid) from public, anon, authenticated;
revoke all on function net_reach(uuid, uuid) from public, anon, authenticated;
revoke all on function creel_hold(placed) from public, anon, authenticated;
revoke all on function fish_journal(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function pond_sweep(uuid) from public, anon, authenticated;
select private.lock_doors();
