/*
 * Sacrifice at the altar, and motes.
 *
 * Asked for: "Allow sacrificing rare, supreme, and fantastic items at the
 * altar. Each time one is sacrificed, all nutritional values are maxed. Each
 * sacrifice has a 1% chance to give the player a Mote. A rare sacrifice would
 * be a rare mote, supreme to supreme mote, etc. A mote can be absorbed to make
 * a normal item change to that mote's rarity."
 *
 * The browser's rules are `src/game/sacrifice.ts`; the defs just before this
 * crossed the mote (`item_def`), the two jobs (`action_def`), the share of
 * sacrifices that leave one (`mote_chance()`) and the nutrients a sacrifice
 * fills (`nutrients()`). What is here is the doing of it, in the browser's
 * words:
 *
 *   * `sacrifice` gives up one of a rare, supreme or fantastic thing from the
 *     pack, kneeling at an altar, and fills every nutrient to the top; now
 *     and again (`mote_chance()`) it leaves a mote of the same rarity;
 *   * `absorb_mote` puts a mote into an ordinary thing in the pack -- one of
 *     a stack, where it is one -- and that thing takes the mote's rarity.
 *
 * Refused, as the browser refuses: a locked thing, a worn one, a bag with
 * something in it, a crate with a wildermon in it, a mote given up, and a
 * mote put into another mote, a bauble, or a thing that is rare already.
 */
set local lock_timeout = '3s';

/** Why this thing cannot be given up at this altar, or the thing when it can (`sacrificeSetting`). */
create or replace function sacrifice_setting(p_world uuid, p_uid uuid, p_target jsonb, out o_why text, out o_item item)
  language plpgsql stable as $fn$
declare v_pc placed;
begin
  select * into v_pc from placed pl where pl.world_id = p_world and pl.id = (p_target->>'id')::bigint;
  if not found or not is_altar(v_pc) then o_why := 'That is not an altar.'; return; end if;
  if not near_piece(p_world, p_uid, v_pc, 2.4) then o_why := 'Kneel at the altar.'; return; end if;
  select * into o_item from item i where i.world_id = p_world and i.id = target_item(p_target)
    and i.holder = 'player' and i.holder_uid = p_uid;
  if o_item.id is null then o_why := 'Choose a rare, supreme or fantastic thing to give up.'; return; end if;
  if o_item.def = 'mote' then o_why := 'A mote is not given up. Absorb it into something instead.'; return; end if;
  if o_item.rare is null then o_why := 'Only a rare, supreme or fantastic thing may be given up.'; return; end if;
  if o_item.locked then o_why := 'It is put by. Unlock it first.'; return; end if;
  if exists (select 1 from player p cross join lateral jsonb_each_text(p.equipped) e
              where p.world_id = p_world and p.uid = p_uid and e.value = o_item.id::text) then
    o_why := 'Take it off first.'; return;
  end if;
  if exists (select 1 from item c where c.world_id = p_world and c.inside = o_item.id) then
    o_why := 'Empty it first.'; return;
  end if;
  if o_item.creature is not null then o_why := 'Let the wildermon out first.'; return; end if;
end $fn$;

create or replace function sacrifice_refusal(p_world uuid, p_uid uuid, p_target jsonb) returns text
  language sql stable as $fn$
  select s.o_why from sacrifice_setting(p_world, p_uid, p_target) s
$fn$;

/**
 * The nutrients, named as they are said: "Starch, flesh, fat and greens are
 * all at their fullest." (`FED_SAID`).
 */
create or replace function fed_said() returns text language sql immutable as $fn$
  select upper(left(x.l, 1)) || substr(x.l, 2) || ' are all at their fullest.'
    from (select case when cardinality(n) < 2 then coalesce(n[1], '')
                      else array_to_string(n[1:cardinality(n) - 1], ', ') || ' and ' || n[cardinality(n)] end as l
            from (select nutrients() as n) a) x
$fn$;

/** Give one of it up, fill every nutrient, and now and again leave a mote. */
create or replace function perform_sacrifice(p_world uuid, p_uid uuid, p_target jsonb) returns void
  language plpgsql as $fn$
declare s record; v_name text;
begin
  select * into s from sacrifice_setting(p_world, p_uid, p_target);
  if s.o_why is not null then return; end if;
  v_name := lower(item_name(s.o_item));
  perform consume(p_world, p_uid, (s.o_item).def, 1, (s.o_item).id);
  update player set nutrition = coalesce(nutrition, '{}'::jsonb)
                                || (select jsonb_object_agg(k, 1) from unnest(nutrients()) k)
   where world_id = p_world and uid = p_uid;
  perform tell(p_world, p_uid, 'You give up the ' || v_name || ' at the altar. ' || fed_said(), 'event');
  if random() < mote_chance() then
    perform give(p_world, p_uid, 'mote', 1, (s.o_item).ql, null, (s.o_item).rare);
    perform tell(p_world, p_uid, 'A ' || (s.o_item).rare || ' mote is left where the ' || v_name || ' was.', 'event');
  end if;
end $fn$;

/** Why this mote will not go into this thing, or the two of them when it will (`absorbSetting`). */
create or replace function absorb_setting(p_world uuid, p_uid uuid, p_target jsonb,
  out o_why text, out o_mote item, out o_item item)
  language plpgsql stable as $fn$
begin
  select * into o_mote from item i where i.world_id = p_world and i.id = nullif(p_target->>'mote', '')::bigint
    and i.holder = 'player' and i.holder_uid = p_uid;
  if o_mote.id is null or o_mote.def <> 'mote' or o_mote.rare is null then o_why := 'Choose a mote to absorb.'; return; end if;
  select * into o_item from item i where i.world_id = p_world and i.id = target_item(p_target)
    and i.holder = 'player' and i.holder_uid = p_uid;
  if o_item.id is null then o_why := 'Choose something to absorb it into.'; return; end if;
  if o_item.def = 'mote' then o_why := 'A mote will not go into another mote.'; return; end if;
  if o_item.def = 'tarnished_bauble' or exists (select 1 from bauble_tier t where t.item = o_item.def) then
    o_why := 'A bauble''s rarity is rolled when it is restored.'; return;
  end if;
  if o_item.rare is not null then
    o_why := 'Only an ordinary thing takes a mote, and this is ' || o_item.rare || ' already.'; return;
  end if;
end $fn$;

create or replace function absorb_refusal(p_world uuid, p_uid uuid, p_target jsonb) returns text
  language sql stable as $fn$
  select s.o_why from absorb_setting(p_world, p_uid, p_target) s
$fn$;

/**
 * One of a thing takes a rarity: the whole of it when it is one thing, one
 * off the top of a stack when it is a stack, the rest left as they were. The
 * way `vessel_becomes` takes one of a stack.
 */
create or replace function item_takes_rarity(p_id bigint, p_rare text) returns void
  language plpgsql as $fn$
declare it item;
begin
  select * into it from item where id = p_id for update;
  if not found or it.count < 1 then return; end if;
  if it.count = 1 then
    update item set rare = p_rare where id = p_id;
    return;
  end if;
  update item set count = count - 1 where id = p_id;
  insert into item (world_id, holder, holder_uid, gx, gy, inside, def, ql, dmg, count, extra, rare,
                    dye, bless, charges, locked, issued, made_at, crate, lit, lit_at, placed, rot_at, maker, piece)
  values (it.world_id, it.holder, it.holder_uid, it.gx, it.gy, it.inside, it.def, it.ql, it.dmg, 1, it.extra, p_rare,
          it.dye, it.bless, it.charges, it.locked, it.issued, it.made_at,
          it.crate, it.lit, it.lit_at, it.placed, it.rot_at, it.maker, it.piece);
end $fn$;

/** The mote goes into the thing, and the thing takes its rarity. */
create or replace function perform_absorb(p_world uuid, p_uid uuid, p_target jsonb) returns void
  language plpgsql as $fn$
declare s record; v_mote text; v_name text;
begin
  select * into s from absorb_setting(p_world, p_uid, p_target);
  if s.o_why is not null then return; end if;
  v_mote := lower(item_name(s.o_mote));
  v_name := lower(item_name(s.o_item));
  perform item_takes_rarity((s.o_item).id, (s.o_mote).rare);
  perform consume(p_world, p_uid, 'mote', 1, (s.o_mote).id);
  perform tell(p_world, p_uid, 'The ' || v_mote || ' sinks into the ' || v_name || ', and it is ' || (s.o_mote).rare || ' now.', 'event');
end $fn$;


CREATE OR REPLACE FUNCTION public.last_action(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in ('plan_bridge', 'build_bridge', 'demolish_bridge',
                      'ring_bell', 'sleep', 'set_home', 'pair_creature', 'read_blood',
                      'dye_item', 'strip_dye', 'start_brew', 'set_bauble', 'sacrifice', 'absorb_mote')
$function$;

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
    return bridge_reason(p_world, v_kind, floor(p.x)::int, floor(p.y)::int,
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
      if sqrt((b.ax + 0.5 - p.x) ^ 2 + (b.ay + 0.5 - p.y) ^ 2) > 4.5
         and sqrt((b.bx + 0.5 - p.x) ^ 2 + (b.by + 0.5 - p.y) ^ 2) > 4.5 then
        return 'Stand at one end of it.';
      end if;
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
      dye := pick_dye(p_world, p_uid);
      if dye.id is null then
        return 'You have no dye. Boil one out of berries, acorns or herbs with a bucket of lye.';
      end if;
      if it.dye = (select id from dye_def where name = dye.extra) then
        return 'It is ' || (select word from dye_def where name = dye.extra) || ' already.';
      end if;
    else
      if not found or it.dye is null then return 'It has taken no colour.'; end if;
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
    if bridge_reason(p_world, v_kind, floor(p.x)::int, floor(p.y)::int,
         (p_target->>'x')::int, (p_target->>'y')::int) is not null then return; end if;
    select * into d from bridge_def where id = v_kind;
    v_h := round((centre_height(p_world, floor(p.x)::int, floor(p.y)::int)
                + centre_height(p_world, (p_target->>'x')::int, (p_target->>'y')::int)) / 2);
    insert into bridge (world_id, kind, ax, ay, bx, by, height, material, made_by)
    values (p_world, v_kind, floor(p.x)::int, floor(p.y)::int,
            (p_target->>'x')::int, (p_target->>'y')::int, v_h,
            case when v_kind = 'stone' then null else 'Oak' end, p_uid)
    returning id into v_id;
    insert into bridge_span (world_id, bridge, n, x, y, needed, total)
    select p_world, v_id, t.n, t.x, t.y, span_bill(v_kind), span_bill(v_kind)
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
        * case when indoors(p_world, 0, floor(pc.x)::int, floor(pc.y)::int) then indoors_rest() else 1 end,
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
      update creature set bred_at = now() - make_interval(secs => breed_rest() / 2)
        where world_id = p_world and id in (dam.id, sire.id);
      perform tell(p_world, p_uid, dam.name || ' and ' || sire.name
        || ' will have nothing to do with one another. Brush them, feed them, and try again.', 'error');
      return;
    end if;
    perform pair_them(p_world, dam.id, sire.id, v_skill);
    perform journal_note(p_world, p_uid, 'paired');
    perform tell(p_world, p_uid, sire.name || ' is put to ' || dam.name
      || '. She is in young and will drop in about ' || clock_left(gestation())
      || '. Between them they carry '
      || trait_names((select array_agg(distinct t) from unnest(sire.traits || dam.traits) t))
      || '.', 'event');

  elsif p_action = 'read_blood' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    perform tell(p_world, p_uid, blood_read(p_world, p_uid, c), 'event');

  elsif p_action = 'dye_item' then
    select * into it from item where world_id = p_world and id = target_item(p_target);
    dye := pick_dye(p_world, p_uid);
    if it.id is null or dye.id is null then return; end if;
    select * into dd from dye_def where name = dye.extra;
    if not consume(p_world, p_uid, 'dye', 1) then return; end if;
    -- One pot does one thing. A stack is split so the rest stays as it was.
    if it.count > 1 then
      update item set count = count - 1 where id = it.id;
      insert into item (world_id, holder, holder_uid, def, ql, dmg, count, extra, rare, dye)
      values (p_world, it.holder, it.holder_uid, it.def, it.ql, it.dmg, 1, it.extra, it.rare, dd.id);
    else
      update item set dye = dd.id where id = it.id;
    end if;
    perform journal_note(p_world, p_uid, 'dyed');
    perform skill_raise(p_world, p_uid, 'alchemy', 0.3);
    perform tell(p_world, p_uid, 'You work the ' || lower(dd.name)
      || ' through it. It comes out ' || dd.word || '.', 'event');

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
      perform skill_raise(p_world, p_uid, 'brewing', try_gain(false, brew_gain()));
      perform tell(p_world, p_uid, 'It will not take. You tip the whole soured lot out of the '
        || lower(placed_name(pc)) || '.', 'event');
      return;
    end if;
    update placed set litres = bd.litres, liquid = bd.id, ferment = bd.seconds, since = now(),
        ql = greatest(1, least(100, (v_ql + skill_of(p_world, p_uid, 'brewing')) / 2))
      where id = pc.id;
    perform journal_note(p_world, p_uid, 'brew');
    perform journal_note(p_world, p_uid, 'brew:' || bd.id);
    perform skill_raise(p_world, p_uid, 'brewing', try_gain(true, brew_gain()));
    perform tell(p_world, p_uid, bd.done || ' (about ' || round(bd.seconds / 60) || ' minutes)', 'event');
  end if;
end $function$;

select private.lock_doors();
