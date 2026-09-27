/*
 * The Tailor moved onto perks: its eighteen, on the island.
 *
 * The ninth trade off its tree (`PERK_CLASSES`). Its perks are rows the
 * definitions already carry (`class_perk`), as are its new job (`patch_item`)
 * and its new piece (the tent, which is a bed at half a bed's rest, and its
 * recipe). What is here is every rule the perks change, each reading its key
 * off the fold with the rule's own number as the default, so that for anybody
 * without the perk nothing moves:
 *
 *   * the shears: Full Fleece's more wool (`plus:` what comes off);
 *   * the bench (`perform_craft`): Lye Saver's bucket left full
 *     (`lye:tan_hide`), and a yoke's maker's mark carried into the cart or
 *     wagon it is built into, its pace multiplied with the builder's own;
 *   * bags: what a sack, a satchel or a backpack holds reads its maker's mark
 *     (`bag_room`: a Tailor's Sack Maker and Deep Pockets);
 *   * tack: the saddle's and the bridle's marks go onto the mount with them
 *     (`creature.tack`), come back with them, go to the browser with the
 *     beast, and let it go faster past the cap (`tack_speed`, a Tailor's
 *     Saddler);
 *   * nets and creels: a new mark family, `catch` (a Tailor's Fisher's
 *     Friend): a net's haul, and a creel's odds, which keeps its mark set and
 *     taken up;
 *   * Workshop Reach (`reach:tailor`, `tailor_work`); the tent, which only a
 *     Tailor who has learned it may build; and Patch, with its refusals.
 *
 * Quick Spindle, Even Thread, Tight Weave, Sure Needle, Master Tailor, Sure
 * Tan, Sure Awl, Nothing Wasted and Light Pack are hooks every recipe or pack
 * already reads (`time:`, `count:`, `need:`, `fail:`, `rare:`, `spare:`,
 * `weight:`), and need nothing here.
 *
 * The Tailor's nodes go with its tree, and every Tailor's fold is written
 * again.
 */
set local lock_timeout = '3s';

/* What the tack on a mount carries of its makers' marks, by the piece. */
alter table creature add column if not exists tack jsonb;

/* Tailoring, leatherworking and ropemaking: what a Tailor's Workshop Reach reaches further for. */
create or replace function tailor_work(p_action text) returns boolean
  language sql stable as $$
  select coalesce(exists (select 1 from recipe r where r.id = p_action
                          and r.skill in ('tailoring', 'leatherworking', 'ropemaking')), false)
$$;

/*
 * How much faster its tack lets a mount go: the larger of the two pieces'
 * makers' marks, after the cap (a Tailor's Saddler). One for plain tack. The
 * browser's `tackSpeed`.
 */
create or replace function tack_speed(c creature) returns double precision
  language sql stable as $$
  select greatest(1, coalesce(max(mark_of(c.tack -> t.item, 'speed')), 1)) from tack_def t
$$;

/* What a piece is patched with: cloth for cloth, leather for leather. The browser's `patchWith`. */
create or replace function patch_with(p_def text) returns text
  language sql stable as $$
  select m.material from improvable_def m where m.item = p_def and m.material in ('cloth', 'leather')
$$;

create or replace function craft_reach() returns integer
  language sql stable as $$
  select case when forge_work(pkx_act()) then greatest(3, floor(pkx('reach:forge', 3))::int)
              when cook_work(pkx_act()) then greatest(3, floor(pkx('reach:cook', 3))::int)
              when tailor_work(pkx_act()) then greatest(3, floor(pkx('reach:tailor', 3))::int)
              else 3 end
$$;

CREATE OR REPLACE FUNCTION public.made_mark(p_mul jsonb, p_def text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select nullif(jsonb_strip_nulls(jsonb_build_object(
    'hold', p_mul->'fx'->('hold:' || p_def),
    'speed', p_mul->'fx'->('speed:' || p_def),
    'damage', p_mul->'fx'->('damage:' || p_def),
    'range', p_mul->'fx'->('range:' || p_def),
    'soak', p_mul->'fx'->('soak:' || p_def),
    'aim', p_mul->'fx'->('aim:' || p_def),
    'last', p_mul->'fx'->('last:' || p_def),
    'temper', p_mul->'fx'->('temper:' || p_def),
    'feed', p_mul->'fx'->('feed:' || p_def),
    'fill', p_mul->'fx'->('fill:' || p_def),
    'knack', p_mul->'fx'->('knack:' || p_def),
    'rot', p_mul->'fx'->('rot:' || p_def),
    'catch', p_mul->'fx'->('catch:' || p_def))), '{}'::jsonb)
$function$;

CREATE OR REPLACE FUNCTION public.mark_says(p_mark jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case when count(*) = 0 then ''
              else ' Its maker''s hand is in it: it ' || list_of(array_agg(s.say order by s.ord)) || '.' end
  from (
    select f.ord, case f.fam
        when 'hold' then 'holds ' || round(((m - 1) * 100)::numeric)::int || '% more'
        when 'speed' then 'goes ' || round(((m - 1) * 100)::numeric)::int || '% faster'
        when 'damage' then 'hits ' || round(((m - 1) * 100)::numeric)::int || '% harder'
        when 'range' then 'reaches ' || round(((m - 1) * 100)::numeric)::int || '% further'
        when 'soak' then 'turns aside ' || round(((m - 1) * 100)::numeric)::int || '% more of a blow'
        when 'aim' then 'lands ' || round(((m - 1) * 100)::numeric)::int || '% more often'
        when 'last' then 'lasts ' || times_said(m) || ' as many fillings'
        when 'temper' then 'can be quenched once, for +' || rtrim(to_char(m, 'FM9999990.999999'), '.') || ' QL'
        when 'feed' then 'feeds each thing it feeds ' || round(((m - 1) * 100)::numeric)::int || '% more'
        when 'fill' then 'fills ' || round(((m - 1) * 100)::numeric)::int || '% more of the food bar'
        when 'knack' then 'gives a knack that lasts ' || round(((m - 1) * 100)::numeric)::int || '% longer'
        when 'rot' then 'rots ' || round(((1 - m) * 100)::numeric)::int || '% slower'
        when 'catch' then 'catches ' || round(((m - 1) * 100)::numeric)::int || '% more'
      end as say
    from unnest(array['hold', 'speed', 'damage', 'range', 'soak', 'aim', 'last', 'temper',
                      'feed', 'fill', 'knack', 'rot', 'catch']) with ordinality f(fam, ord),
         lateral (select (p_mark->>f.fam)::double precision as m) v
    where p_mark ? f.fam
  ) s
$function$;

CREATE OR REPLACE FUNCTION public.bag_room(b item)
 RETURNS integer
 LANGUAGE sql
 STABLE
AS $function$
  -- Its make, its maker's mark (a Tailor's Sack Maker and Deep Pockets), and its rarity.
  select room_for((select holds from item_def where id = b.def) * mark_of(b.mark, 'hold'), b.rare)
$function$;

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
  a := age_row(c.born);

  if p_action = 'examine_creature' then
    if c.mode = 'wild' and d.monster then
      perform tell(p_world, p_uid, 'A ' || lower(d.name) || ': ' || d.description
        || ' It has ' || ceil(c.health) || ' of ' || max_health(c) || ' in it and hits for '
        || to_char(attack_of(c), 'FM990') || '. It cannot be tamed. Kill it and butcher it, or keep well clear.', 'error');
    elsif c.mode = 'wild' then
      warm := coax_bonus(c);
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
        || ' It eats ' || diet_text(c.species) || '.', 'event');
    end if;

  elsif p_action = 'tame' then
    food := bait_in_pack(p_world, p_uid, c.species);
    if food is null then return; end if;
    -- The crate may have gone out of the pack since the offering was begun.
    if tame_room_refusal(p_world, p_uid) is not null then
      perform tell(p_world, p_uid, tame_room_refusal(p_world, p_uid), 'error');
      return;
    end if;
    if not consume(p_world, p_uid, food, 1) then return; end if;
    chance := tame_chance(p_world, p_uid, c);
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
      warm := coax_bonus(c);
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
        care = least(1, care + 0.18 + (skill / 100) * 0.34
                          + (least(100, tool_ql(p_world, p_uid, 'brush')) / 100) * 0.22),
        -- A brushing is also a looking-over: it finds the small hurts.
        health = least(top, health + top * 0.06)
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
    update creature set stance = p_target->>'stance' where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' will be ' || (p_target->>'stance') || '.', 'info');

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
  if r.tool is not null then perform wear_tool(held_tool(p_world, p_uid, r.tool)); end if;
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
    if r.consume_on_fail and not spared then
      for i in select * from recipe_input where recipe = p_recipe order by ord loop
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
    perform tell(p_world, p_uid, coalesce(r.fail,
      'You fail to make ' || lower((select coalesce(name, r.result) from item_def where id = r.result)) || '.'), 'event');
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
   * two say the same, and never a temper, which is for whoever finishes it.
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
          from jsonb_each(v_part - 'temper') k;
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
  v_mark := nullif(v_mark, '{}'::jsonb);
  if item_stackable(r.result) then
    v_made := give(p_world, p_uid, r.result, v_n, made_ql, coalesce(r.extra, mat), rare, maker_mark(p_world, p_uid, rare), null, v_mark);
  else
    v_made := give(p_world, p_uid, r.result, v_n, made_ql, coalesce(r.extra, mat), rare, maker_mark(p_world, p_uid, rare));
    if v_mark is not null then update item set mark = v_mark where id = v_made; end if;
  end if;
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

CREATE OR REPLACE FUNCTION public.perform_ride(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare c creature; p placed; v vehicle_def; r record; v_names text; v_short text; v_n int; v_it item; v_tack jsonb;
        v_was bigint; v_shore record; v_sail boolean; v_aboard bigint; v_seat int;
begin
  if ride_beast_action(p_action) then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;

    if p_action = 'tack_creature' then
      -- What each piece carries of its maker's hand goes onto the mount with it (a Tailor's Saddler).
      v_tack := '{}'::jsonb;
      for r in select item from tack_def order by ord loop
        select * into v_it from item i where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
          and i.def = r.item and not i.locked order by i.id limit 1;
        if v_it.id is null or not consume(p_world, p_uid, r.item, 1, v_it.id) then return; end if;
        if v_it.mark is not null and v_it.mark <> '{}'::jsonb then v_tack := v_tack || jsonb_build_object(r.item, v_it.mark); end if;
      end loop;
      update creature set tacked = true, tack = nullif(v_tack, '{}'::jsonb) where world_id = p_world and id = c.id;
      perform tell(p_world, p_uid, 'You saddle ' || c.name
        || ' and slip the bit into its mouth. It stands for it.', 'event');

    elsif p_action = 'shoe_creature' then
      if not consume(p_world, p_uid, 'horseshoe', shoes_per_mount()::int) then return; end if;
      update creature set shod_at = now() where world_id = p_world and id = c.id;
      perform tell(p_world, p_uid, 'You nail four shoes onto ' || c.name
        || '''s hooves. They will hold a week: quicker on stone, and up what it would have baulked at.', 'event');

    elsif p_action = 'untack_creature' then
      update creature set tacked = false, tack = null where world_id = p_world and id = c.id;
      for r in select item from tack_def order by ord loop
        perform give(p_world, p_uid, r.item, 1, 40, null, null, null, null, c.tack -> r.item);
      end loop;
      perform tell(p_world, p_uid, 'You strip the saddle and bridle off ' || c.name || '.', 'event');

    elsif p_action = 'mount_creature' then
      -- One seat at a time: whoever was up gets down without being asked.
      update creature set rider = null where world_id = p_world and rider = p_uid;
      update creature set rider = p_uid, enemy = null, hunting = null,
          from_x = pl.x, from_y = pl.y, to_x = pl.x, to_y = pl.y,
          leg_at = now(), leg_ends = now(), settled_at = now()
        from player pl
        where creature.world_id = p_world and creature.id = c.id
          and pl.world_id = p_world and pl.uid = p_uid;
      perform journal_note(p_world, p_uid, 'mounted');
      perform tell(p_world, p_uid, 'You take a fistful of mane and swing up onto '
        || c.name || '.', 'event');

    elsif p_action = 'dismount_creature' then
      update creature set rider = null where world_id = p_world and id = c.id;
      perform tell(p_world, p_uid, 'You swing down off ' || c.name || '.', 'event');

    elsif p_action = 'hitch_creature' then
      p := vehicle_for(p_world, p_uid, c);
      if p.id is null or not hitch_up(p_world, c.id, p.id) then
        -- Never in silence: whatever stopped it, in the words the ask uses.
        perform tell(p_world, p_uid, coalesce(ride_refusal(p_world, p_uid, p_action, p_target),
          'You could not get ' || c.name || ' into the traces.'), 'error');
        return;
      end if;
      select * into v from vehicle_def where id = p.sub;
      v_n := team_size(p_world, p.id);
      v_short := case when v_n < v.needs
        then ' It needs ' || (v.needs - v_n) || ' more before it will move.' else '' end;
      perform journal_note(p_world, p_uid, 'hitched');
      perform tell(p_world, p_uid, 'You back ' || c.name || ' into a yoke of the '
        || lower(placed_name(p)) || '. ' || v_n || ' of ' || v.yokes || ' filled.' || v_short, 'event');

    elsif p_action = 'unhitch_creature' then
      v_was := unhitch_one(p_world, c.id);
      perform tell(p_world, p_uid, 'You unbuckle ' || c.name || ' from the '
        || coalesce(lower((select placed_name(q) from placed q where q.id = v_was)), 'traces') || '.', 'event');
    end if;
    return;
  end if;

  select * into p from placed where world_id = p_world and id = (p_target->>'id')::bigint;
  if not found then return; end if;

  if p_action = 'pull_cart' then
    update placed set puller = p_uid where world_id = p_world and id = p.id;
    perform tell(p_world, p_uid, 'You take up the shafts of the ' || lower(placed_name(p))
      || '. It will follow you now, and what you gather goes into it.', 'event');

  elsif p_action = 'drop_cart' then
    update placed set puller = null where world_id = p_world and id = p.id;
    perform tell(p_world, p_uid, 'You set the ' || lower(placed_name(p))
      || ' down and let go of the shafts.', 'event');

  elsif p_action = 'board_vehicle' then
    /*
     * Out of a place on her deck and to her helm: the place is somebody
     * else's to have now -- and a helmsman who had gone away is put in it, so
     * that nobody is left in the sea when she moves off.
     */
    select aboard, seat into v_aboard, v_seat from player where world_id = p_world and uid = p_uid;
    if v_aboard = p.id then
      update player set aboard = null, seat = null where world_id = p_world and uid = p_uid;
      if p.driver is not null and p.driver <> p_uid then
        update player set aboard = p.id, seat = v_seat where world_id = p_world and uid = p.driver;
      end if;
    end if;
    update placed set driver = p_uid where world_id = p_world and id = p.id;
    if is_boat(p) then
      select sail into v_sail from boat_def where id = p.sub;
      perform tell(p_world, p_uid, 'You push off and climb into the ' || lower(placed_name(p)) || '. '
        || case when v_sail then 'The sail fills and she comes round.'
                else 'You ship the oars and take a stroke.' end, 'event');
      return;
    end if;
    select string_agg(t.name, ' and ' order by t.id) into v_names from team_of(p_world, p.id) t;
    perform tell(p_world, p_uid, 'You climb onto the ' || lower(placed_name(p)) || ' and take the reins. '
      || coalesce(v_names, 'Nothing') || ' lean into the traces. What you gather from the seat goes into it.', 'event');

  elsif p_action = 'board_passenger' then
    -- One at a time: two people asking for the last place do not both get it.
    perform 1 from placed where world_id = p_world and id = p.id for update;
    select min(s) into v_seat from generate_series(1, boat_places(p)) s
      where not exists (select 1 from player pp where pp.world_id = p_world and pp.aboard = p.id and pp.seat = s);
    if v_seat is null then return; end if;
    update player set aboard = p.id, seat = v_seat, x = p.cx, y = p.cy, level = 0, moved_at = now()
      where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You climb aboard the ' || lower(placed_name(p)) || ' and find a place on deck. '
      || (select count(*) from player pp where pp.world_id = p_world and pp.aboard = p.id) || ' of '
      || boat_places(p) || ' places are taken.', 'event');

  elsif p_action = 'leave_passenger' then
    select s.x, s.y into v_shore from player pl, lateral shore_near(p_world, pl.x, pl.y) s
      where pl.world_id = p_world and pl.uid = p_uid;
    if v_shore.x is null then return; end if;
    update player set aboard = null, seat = null, x = v_shore.x + 0.5, y = v_shore.y + 0.5, moved_at = now()
      where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You step ashore from the ' || lower(placed_name(p)) || '.', 'event');

  elsif p_action = 'leave_vehicle' then
    if is_boat(p) then
      select s.x, s.y into v_shore from player pl, lateral shore_near(p_world, pl.x, pl.y) s
        where pl.world_id = p_world and pl.uid = p_uid;
      perform leave_vehicle(p_world, p.id);
      if v_shore.x is not null then
        update player set x = v_shore.x + 0.5, y = v_shore.y + 0.5, moved_at = now()
          where world_id = p_world and uid = p_uid;
      end if;
      perform tell(p_world, p_uid, 'You bring the ' || lower(placed_name(p))
        || ' alongside and step ashore.', 'event');
      return;
    end if;
    perform leave_vehicle(p_world, p.id);
    perform tell(p_world, p_uid, 'You climb down off the ' || lower(placed_name(p)) || '.', 'event');

  elsif p_action = 'unhitch_team' then
    v_n := unhitch_all(p_world, p.id);
    perform tell(p_world, p_uid, 'You let ' || case when v_n = 1 then 'it' else 'them' end
      || ' out of the traces of the ' || lower(placed_name(p)) || '.', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.travel_speed(p_world uuid, p_uid uuid)
 RETURNS double precision
 LANGUAGE plpgsql
 STABLE
AS $function$
declare c creature; p placed; v double precision; pl player;
begin
  p := driving(p_world, p_uid);
  if p.id is not null then
    -- And her builder's hand in her: a Carpenter's Keel Layer.
    if is_boat(p) then return (select speed from boat_def where id = p.sub) * mark_of(p.mark, 'speed'); end if;
    v := vehicle_speed(p_world, p.id);
    if v > 0 then return v; end if;
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
  -- On foot, and on a made road, a Terraformer's Road Legs.
  select * into pl from player where world_id = p_world and uid = p_uid;
  if coalesce((select t.road from tile_def t
                where t.id = land_tile(p_world, floor(pl.x)::int, floor(pl.y)::int)), false) then
    return base_speed() * pk(pl.class_mul, 'walk:road', 1);
  end if;
  return base_speed();
end $function$;

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

CREATE OR REPLACE FUNCTION public.perform_fish(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; spot record; skill double precision; rod_ql double precision;
        bait text; got text; made_ql double precision; tool_id bigint;
        haul int; i int; parts text[] := '{}'; one text; counted jsonb := '{}'::jsonb; k text;
        v_net jsonb; v_more double precision;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  skill := skill_of(p_world, p_uid, 'fishing');

  if p_action = 'fish' then
    select * into spot from cast_at(p_world, p_uid, tx, ty, cast_range());
    if spot.depth is null then return; end if;
    rod_ql := tool_ql(p_world, p_uid, 'fishing_rod');
    select it.id into tool_id from item it
      where it.world_id = p_world and it.holder = 'player' and it.holder_uid = p_uid and it.def = 'fishing_rod'
      order by tool_worth(it.ql, it.dmg, it.extra, it.rare, it.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id, 0.5); end if;
    -- Something goes on the hook if anything worth using is in the pack.
    bait := bait_for(p_world, p_uid, spot.depth, skill);
    if bait is not null and not consume(p_world, p_uid, bait, 1) then return; end if;

    got := catch_fish(spot.depth, skill, rod_ql, bait);
    -- Written below the cast rather than above it: what comes off the hook
    -- used to teach exactly what a landed fish taught.
    perform skill_raise(p_world, p_uid, 'fishing', try_gain(got is not null, rod_gain()));
    if got is null then
      perform tell(p_world, p_uid, case when bait is null then 'Something takes it and comes off again.'
        else 'Something takes the ' || lower((select coalesce(name, bait) from item_def where id = bait))
             || ' and comes off again.' end, 'event');
    else
      made_ql := product_ql(skill, rod_ql);
      perform gather(p_world, p_uid, got, 1, made_ql);
      perform journal_note(p_world, p_uid, 'fish:' || got);
      if bait is not null then perform journal_note(p_world, p_uid, 'baited'); end if;
      perform tell(p_world, p_uid, 'You land '
        || case when lower((select name from fish_def where id = got)) ~ '^[aeiou]' then 'an ' else 'a ' end
        || lower((select name from fish_def where id = got))
        || case when bait is null then '' else ' on the '
             || lower((select coalesce(name, bait) from item_def where id = bait)) end
        || '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    end if;

  elsif p_action = 'drag_net' then
    select * into spot from cast_at(p_world, p_uid, tx, ty, net_range());
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
    haul := 1 + floor(random() * (1 + 4 * (0.3 + least(100, rod_ql) / 160)))::int;
    -- And more of it for its maker's hand in the net (a Tailor's Fisher's Friend): the share
    -- over a whole fish is a chance at one more, so the catch is that much more on the average.
    if mark_of(v_net, 'catch') <> 1 then
      v_more := haul * mark_of(v_net, 'catch');
      haul := floor(v_more)::int + case when random() < v_more - floor(v_more) then 1 else 0 end;
    end if;
    for i in 1..haul loop
      one := pick_fish(spot.depth, skill, null, random());
      -- Anything that lives deeper than a net reaches mostly avoids it.
      if one is not null and ((select depth from fish_def where id = one) <= 8 or random() < 0.12) then
        counted := jsonb_set(counted, array[one], to_jsonb(coalesce((counted->>one)::int, 0) + 1));
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
    for k in select jsonb_object_keys(counted) loop
      perform gather(p_world, p_uid, k, (counted->>k)::int, made_ql);
      perform journal_note(p_world, p_uid, 'fish:' || k, (counted->>k)::int);
      parts := parts || ((counted->>k) || ' × ' || lower((select coalesce(name, k) from item_def where id = k)));
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
        v_depth double precision; v_got text; v_held int; v_ql double precision; v_new bigint;
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
    if v_held >= coalesce(d.hold, 8) then return false; end if;
    v_depth := water_depth(p.world_id, p.x, p.y);
    -- Better odds for its maker's hand in it (a Tailor's Fisher's Friend).
    v_odds := d.odds * (0.6 + least(100, greatest(1, p.ql)) / 250) * mark_of(p.mark, 'catch');
    -- One roll standing for all of them, then one fish for each success it is
    -- still willing to hold.
    for v_n in 1..least(v_n, coalesce(d.hold, 8) - v_held) loop
      exit when random() >= v_odds;
      v_got := pick_fish(v_depth, 40, p.bait, random());
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
           || round(trap_life(p.sub, p.ql) / 60) || ' minutes and holds ' || coalesce(d.hold, 8) || '. Bait it.'
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

CREATE OR REPLACE FUNCTION public.item_action(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in ('improve_item', 'repair_item', 'patch_item', 'eat', 'drink', 'drink_skin', 'quench_item')
$function$;

CREATE OR REPLACE FUNCTION public.item_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare v_it item; v_what improvable_def; v_mat improve_material_def; v_miss text;
        v_ceiling double precision; v_made text; v_tx int; v_ty int;
begin
  if p_action = 'drink' then
    v_tx := (p_target->>'x')::int; v_ty := (p_target->>'y')::int;
    if not has_water(p_world, v_tx, v_ty) then return 'There is no water there.'; end if;
    return null;
  end if;

  -- A Tailor's Patch, before anything is asked of the piece: the browser's order.
  if p_action = 'patch_item' and pk(p_world, p_uid, 'patch_item', 0) <= 0 then
    return 'That wants a Tailor who has learned to patch.';
  end if;
  v_it := carried(p_world, p_uid, target_item(p_target));
  if v_it.id is null then return 'It is gone.'; end if;

  if p_action = 'eat' then
    if coalesce((select food from item_def where id = v_it.def), 0) <= 0 then
      return 'That is not food.';
    end if;
    if v_it.holder = 'bag' then return 'Take it out of the bag first.'; end if;
    if v_it.locked then return 'You have that one put by.'; end if;
    return null;

  elsif p_action = 'drink_skin' then
    if coalesce((select drink from item_def where id = v_it.def), 0) <= 0
       or (select charges from item_def where id = v_it.def) is null then
      return 'There is nothing in that to drink.';
    end if;
    if coalesce(v_it.charges, 0) <= 0 then return 'It is empty.'; end if;
    return null;

  elsif p_action = 'repair_item' then
    if v_it.dmg <= 0 then return 'There is nothing wrong with it.'; end if;
    if v_it.ql <= 1 then return 'It is worn away to nothing and will not take another repair.'; end if;
    return null;

  elsif p_action = 'patch_item' then
    if patch_with(v_it.def) is null then return 'Only cloth or leather takes a patch.'; end if;
    if v_it.dmg <= 0 then return 'There is nothing wrong with it.'; end if;
    if pack_count(p_world, p_uid, patch_with(v_it.def), null) < 1 then
      return 'You need ' || patch_with(v_it.def) || ' to patch it with.';
    end if;
    return null;

  elsif p_action = 'improve_item' then
    select * into v_what from improvable_def where item = v_it.def;
    if not found then return 'That is not something you can better.'; end if;
    if v_it.holder = 'bag' then return 'Take it out of the bag first.'; end if;
    if v_it.issued then
      return 'That came ashore with you. There is nothing in it to better — make one of your own.';
    end if;
    if v_it.dmg > 10 then return 'It is too knocked about to work on. Repair it first.'; end if;
    select * into v_mat from improve_material_def where id = v_what.material;
    v_miss := missing_tool(p_world, p_uid, v_mat.id);
    if v_miss is not null then
      return 'You need ' || (select string_agg(lower((select coalesce(name, t.tool) from item_def where id = t.tool)),
                                               ' and ' order by t.ord)
                             from improve_tool t where t.material = v_mat.id)
        || ' to work ' || v_mat.name || '.';
    end if;
    v_made := (mat_of(v_it.extra)).name;
    if (stock_for(p_world, p_uid, v_mat.id, v_made)).id is null then
      return 'You have no ' || lower(coalesce(v_made, v_mat.name))
        || ' to work into it, and nothing else will do.';
    end if;
    v_ceiling := improve_ceiling(p_world, p_uid, v_what.skill, v_it.rare);
    if v_it.ql >= v_ceiling then
      return 'Your ' || replace(v_what.skill, '_', ' ') || ' is not good enough to better it further.';
    end if;
    if v_it.ql >= 99.9 then return 'It cannot be bettered.'; end if;
    -- A quality to stop at, when one was asked for. This refusal is the whole
    -- of "take it to sixty": a repeating job asks before every go and stops
    -- the moment it is told no.
    if (p_target ? 'upto') and v_it.ql >= (p_target->>'upto')::numeric then
      return 'The ' || lower(item_name(v_it)) || ' is at QL '
        || to_char(v_it.ql, 'FM990.0') || ', which is what you asked for.';
    end if;
    return null;

  elsif p_action = 'quench_item' then
    -- A Smith's Temper Bath, in the words the browser uses.
    if v_it.holder = 'bag' then return 'Take it out of the bag first.'; end if;
    if coalesce((v_it.mark->>'temper')::double precision, 0) <= 0 then return 'There is no quench left in it.'; end if;
    if pk(p_world, p_uid, 'temper:' || v_it.def, 0) <= 0 then return 'That wants a Smith who has learned to temper.'; end if;
    if not water_near(p_world, p_uid) then
      return 'You need water to quench it in: stand at the water, or beside a barrel or a well of it.';
    end if;
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_item(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_ok boolean; v_it item; v_what improvable_def; v_mat improve_material_def; v_stock item;
        v_made text; v_ceiling double precision; v_tool_ql double precision;
        v_healed double precision; v_lost double precision; v_skill double precision;
        v_favour text; v_full text; v_name text; v_p player; v_lift text;
begin
  if p_action = 'drink' then
    update player set stats = jsonb_set(stats, '{thirst}', '1') where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You drink the cool water. It is refreshing.', 'event');
    return;
  end if;

  v_it := carried(p_world, p_uid, target_item(p_target));
  if v_it.id is null then return; end if;
  v_name := lower((select coalesce(name, v_it.def) from item_def where id = v_it.def));
  select * into v_p from player where world_id = p_world and uid = p_uid;

  if p_action = 'eat' then
    if not consume(p_world, p_uid, v_it.def, 1, v_it.id) then return; end if;
    update player set stats = jsonb_set(stats, '{hunger}', to_jsonb(least(1,
        coalesce((v_p.stats->>'hunger')::double precision, 1)
        + coalesce((select food from item_def where id = v_it.def), 0) * (0.7 + v_it.ql / 200)
          -- Fuller, the more and the longer for its maker's hand in it (a
          -- Cook's Filling, Hearty and Flavoursome), whoever is eating it.
          * mark_of(v_it.mark, 'fill'))))
      where world_id = p_world and uid = p_uid;
    -- A dish favours a trade, and having eaten it you are better at that
    -- trade for a while.
    v_favour := grant_boon(p_world, p_uid, v_it.def, v_it.ql, mark_of(v_it.mark, 'knack'));
    v_full := nourish(p_world, p_uid, v_it.def, v_it.ql, mark_of(v_it.mark, 'feed'));
    perform tell(p_world, p_uid, 'You eat the ' || v_name || '.'
      || coalesce(' ' || v_favour, '') || coalesce(' ' || v_full, ''), 'event');

  elsif p_action = 'drink_skin' then
    update item set charges = coalesce(charges, 1) - 1 where id = v_it.id;
    update player set stats = jsonb_set(stats, '{thirst}', to_jsonb(least(1,
        coalesce((v_p.stats->>'thirst')::double precision, 1)
        + coalesce((select drink from item_def where id = v_it.def), 0))))
      where world_id = p_world and uid = p_uid;
    -- Milk and anything brewed favour a trade the way a cooked dish does,
    -- and for longer for its brewer's hand in it (a Cook's Strong Brew).
    v_favour := grant_boon(p_world, p_uid, v_it.def, v_it.ql, mark_of(v_it.mark, 'knack'));
    v_full := nourish(p_world, p_uid, v_it.def, v_it.ql, mark_of(v_it.mark, 'feed'));
    perform tell(p_world, p_uid, 'You take a drink from the ' || v_name || '.'
      || coalesce(' ' || v_favour, '') || coalesce(' ' || v_full, ''), 'event');

  elsif p_action = 'patch_item' then
    -- A Tailor's Patch: a cloth or leather piece mended with a piece of its own
    -- stuff, the perk's own number of damage off and nothing off its quality.
    v_made := patch_with(v_it.def);
    if v_made is null or v_it.dmg <= 0 then return; end if;
    if not consume(p_world, p_uid, v_made, 1) then return; end if;
    v_healed := least(v_it.dmg, pk(p_world, p_uid, 'patch_item', 0));
    update item set dmg = greatest(0, dmg - v_healed) where id = v_it.id;
    perform skill_raise(p_world, p_uid, (select skill from improvable_def where item = v_it.def), 0.25);
    perform tell(p_world, p_uid, 'You patch the ' || v_name || ' with ' || v_made || '. (damage '
      || to_char(greatest(0, v_it.dmg - v_healed), 'FM990.00') || ')', 'event');

  elsif p_action = 'repair_item' then
    -- A second's work: some of the damage comes out, and a little of the
    -- quality with it — a little, not much, so mending a thing is not the end
    -- of it.
    v_skill := skill_of(p_world, p_uid, 'repair');
    v_healed := least(v_it.dmg, 1.2 + v_skill * 0.1);
    /*
     * And the tree, which is the one place fineness runs backwards: what a
     * mend costs the piece rather than what a pass puts on it. A mender whose
     * work comes back better than it went is a mender who takes less off, so
     * the multiplier divides here and multiplies everywhere else. It is the
     * same number saying the same thing about a different quantity.
     */
    v_lost := v_healed * greatest(0.004, 0.03 - v_skill * 0.00026)
            / class_mul(p_world, p_uid, 'fine', 'repair');
    update item set dmg = greatest(0, dmg - v_healed), ql = greatest(1, ql - v_lost)
      where id = v_it.id returning * into v_it;
    perform skill_raise(p_world, p_uid, 'repair', 0.25);
    if v_it.dmg <= 0 then
      perform tell(p_world, p_uid, 'The ' || v_name || ' is as sound as it will ever be again. (QL '
        || to_char(v_it.ql, 'FM990.0') || ')', 'event');
    end if;

  elsif p_action = 'improve_item' then
    select * into v_what from improvable_def where item = v_it.def;
    if not found then return; end if;
    select * into v_mat from improve_material_def where id = v_what.material;
    v_made := (mat_of(v_it.extra)).name;
    v_stock := stock_for(p_world, p_uid, v_mat.id, v_made);
    -- A bar is broken into for the lump a pass takes (a Smith's Ingots).
    if v_stock.id is not null then v_stock := unbar(p_world, p_uid, v_stock.id, 1); end if;
    if v_stock.id is null or not spend_stack(p_world, p_uid, v_stock.id, 1) then return; end if;
    v_tool_ql := coalesce((select max(tool_ql(p_world, p_uid, t.tool)) from improve_tool t
                           where t.material = v_mat.id), 0);
    -- A failed pass marks the piece rather than spoiling it outright. Oak and
    -- the deep metals are stubborn under the file as under the saw. The gain
    -- used to be written above the roll, which paid a marked piece what a
    -- passed one is worth.
    v_ok := skill_check(skill_of(p_world, p_uid, v_what.skill),
        12 + v_it.ql / 3 + mat_difficulty(v_it.extra), v_tool_ql,
        mind_ease(p_world, p_uid));
    perform skill_raise(p_world, p_uid, v_what.skill, try_gain(v_ok, improve_gain()));
    if not v_ok then
      perform damage_item(v_it.id, 3 + random() * 5);
      perform tell(p_world, p_uid, 'You work at the ' || v_name || ' and mark it. (damage '
        || to_char((select dmg from item where id = v_it.id), 'FM990.0') || ')', 'event');
      return;
    end if;
    v_ceiling := least(99.9, improve_ceiling(p_world, p_uid, v_what.skill, v_it.rare));
    -- And the tree, on the trade that would have made the thing: a smith's
    -- temper is worth as much at the file as at the anvil. The ceiling is
    -- untouched, so this buys passes rather than a higher top.
    update item set ql = greatest(ql, least(v_ceiling,
        ql + improve_step(skill_of(p_world, p_uid, v_what.skill), ql)
             * class_mul(p_world, p_uid, 'fine', v_what.skill)
             -- More a pass for a perk on what it is made of (a Smith's Metal Polisher).
             * pk(p_world, p_uid, 'improve:' || v_what.material, 1)))
      where id = v_it.id returning * into v_it;
    /*
     * And now and again the thing itself comes on, not only its quality.
     *
     * The same odds as the bench, one step at a time: a hundred good passes
     * turn a plain thing rare about once, a thousand a rare thing supreme, ten
     * thousand a supreme thing fantastic. Never two steps, so the only road to
     * the top of it is through the middle of it.
     *
     * A step up also lifts the ceiling it may be bettered to, which is the
     * next pass's business rather than this one's — `v_ceiling` above was
     * worked out for the thing as it stood when this pass started.
     */
    v_lift := rarity_lift(v_it.rare);
    if v_lift is not null then
      update item set rare = v_lift where id = v_it.id returning * into v_it;
      perform journal_note(p_world, p_uid, v_lift);
      perform tell(p_world, p_uid,
        (select r.lift from rarity_def r where r.id = v_lift), 'skill');
    end if;
    perform tell(p_world, p_uid, 'The ' || v_name || ' is better than it was. (QL '
      || to_char(v_it.ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'quench_item' then
    -- A Smith's Temper Bath: the quench its maker put into it, once.
    if coalesce((v_it.mark->>'temper')::double precision, 0) <= 0 then return; end if;
    update item set ql = least(100, ql + (mark->>'temper')::double precision),
                    mark = nullif(mark - 'temper', '{}'::jsonb)
      where id = v_it.id returning * into v_it;
    perform tell(p_world, p_uid, 'You quench the ' || lower(item_name(v_it)) || ' and it comes out harder. (QL '
      || to_char(v_it.ql, 'FM990.0') || ')', 'event');
  end if;
end $function$;


/*
 * The Tailor's tree, cleared, as the eight before it were: its nine nodes left
 * `class_node` with the rulebook that brought its perks, whatever of them
 * anybody had taken goes, and every Tailor's fold is written again.
 */
delete from player_node where node ~ '^tailor_[0-9]_[0-9]$';
do $$
declare r record;
begin
  for r in select world_id, uid from player where craft_class = 'tailor' loop
    perform class_fold(r.world_id, r.uid);
  end loop;
end $$;

revoke all on function tailor_work(text) from public, anon, authenticated;
revoke all on function tack_speed(creature) from public, anon, authenticated;
revoke all on function patch_with(text) from public, anon, authenticated;
revoke all on function craft_reach() from public, anon, authenticated;
select private.lock_doors();
