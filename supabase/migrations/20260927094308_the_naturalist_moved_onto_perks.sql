/*
 * The Naturalist moved onto perks: its eighteen, on the island.
 *
 * The eleventh trade off its tree (`PERK_CLASSES`). Its perks are rows the
 * definitions already carry (`class_perk`), and so are its three new recipes
 * and what they make. What is here is every rule the perks change, each
 * reading its key off the fold with the rule's own number as the default, so
 * that for anybody without the perk nothing moves:
 *
 *   * a look over the ground (`perform_gather`): Keen Eye's one more pass,
 *     Sure Find's none empty by chance, Rare Find's now and then a rare find;
 *   * a cut of grass or reeds (`perform_ground`): Hay Cutter's and Reed
 *     Cutter's more to a cut, said in the numbers cut;
 *   * a dressing (`fight_refusal`, `perform_fight`): Sure Hands' fewer slips,
 *     Quick Mend's faster closing stamped on the wound it went on
 *     (`wound_close` reads it), and Field Medic's dressing somebody else's
 *     wounds, beside you, at your first aid and out of your pack;
 *   * the remedies: herb tea drunk for stamina, a salve rubbed in over a
 *     dressing so the wound under it never goes bad (`fester_chance` reads
 *     it), and a tincture taken for the Naturalist's four trades
 *     (`grant_tincture`, beside a dish's knack rather than in its place:
 *     `grant_boon` puts back the clock on a dish's only), each made only by a
 *     Naturalist who has learned it (`craft_refusal`) and used by anybody
 *     (`item_action`, `item_refusal`, `perform_item`).
 *
 * Quick Lye, Double Boil, Thrifty Dyer, Sure Boil, Ink Maker, Quick Dressing
 * and Cover Maker are keys every recipe or job already reads (`time:`,
 * `count:`, `need:`, `fail:`), and need nothing here.
 *
 * And a hive fills on an island at last (`hive_sweep`, on the clock's tidying
 * round): a swarm of Vesp kept on a settlement fills a hive standing there
 * with honey and wax, three parts to one, as it always has in the browser.
 * Nothing on an island gave wax before, so no candle could be drawn there, and
 * a salve would have been a recipe nobody could make.
 *
 * The Naturalist's nodes go with its tree, and every Naturalist's fold is
 * written again.
 */
set local lock_timeout = '3s';

/* The hives on an island, which the clock asks after every tidying round. */
create index if not exists placed_hives on placed (world_id) where sub = 'hive';

/* Comb a hive draws in a second for each swarm keeping it: more for a better-made hive. The browser's `hiveRate`. */
create or replace function hive_rate(p_ql double precision) returns double precision
  language sql immutable as $$ select hive_base() + (p_ql / 100) * hive_per_ql() $$;

/*
 * The hives, filled for the time since they were last looked at.
 *
 * A Vesp is not put to work like the other wildermon: all it does is live on
 * a settlement, and a hive standing there fills itself -- up to three swarms'
 * worth to a hive, comb at the hive's rate for each, and one comb in four wax,
 * the rest honey, at about the hive's quality, into the hive until it is full.
 * The browser's `fillHive`. Kept by anybody, so long as it is kept and working
 * or following on the same settlement.
 *
 * On the tidying round, which comes every few minutes: comb is slow and a hive
 * nobody has looked at for an hour is no different for having filled in
 * minutes rather than seconds. A hive with no swarm or no room is not written
 * to at all, and so as not to count that idle time when a swarm comes, the
 * time since it last filled is taken as at most two rounds.
 */
create or replace function hive_sweep(p_world uuid) returns integer
  language plpgsql as $$
declare h placed; v_deed deed; v_swarms int; v_comb double precision; v_room int; v_made int := 0;
        v_def text; v_ql double precision; v_id bigint; v_since double precision; fresh item;
begin
  for h in select * from placed where world_id = p_world and sub = 'hive' and crumbles_at is null
           order by id for update skip locked
  loop
    v_deed := deed_at(p_world, h.x, h.y);
    continue when v_deed.world_id is null;
    v_room := furniture_capacity(h) - furniture_units(h);
    continue when v_room <= 0;
    select count(*) into v_swarms from (
      select 1 from creature c join species_def s on s.id = c.species
       where c.world_id = p_world and s.hives and c.keeper is not null and c.mode in ('deed', 'active')
         and abs(floor(creature_x(c)) - v_deed.x) <= v_deed.radius
         and abs(floor(creature_y(c)) - v_deed.y) <= v_deed.radius
       limit hive_swarms()::int) s;
    continue when v_swarms = 0;
    v_since := least(2 * sweep_every(),
      greatest(0, extract(epoch from now() - coalesce((h.state->>'hive_at')::timestamptz, now()))));
    v_comb := coalesce((h.state->>'comb')::double precision, 0) + hive_rate(h.ql) * v_swarms * v_since;
    while v_comb >= 1 and v_room > 0 loop
      v_comb := v_comb - 1;
      v_def := case when random() < hive_wax() then 'wax' else 'honey' end;
      v_ql := least(100, greatest(1, h.ql * (0.7 + random() * 0.6)));
      -- Onto a pile of the same in the hive, as anything put in is.
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
    update placed set state = coalesce(state, '{}'::jsonb) || jsonb_build_object('comb', v_comb, 'hive_at', now())
      where id = h.id;
  end loop;
  return v_made;
end $$;

/* A dressed wound that could still go bad: what a salve is for. Under the herb that suits it, it never will. The browser's `salvable`. */
create or replace function salvable(w jsonb) returns boolean
  language sql stable as $$
  select not coalesce((w->>'infected')::boolean, false) and not coalesce((w->>'salved')::boolean, false)
     and w->>'dressing' is not null
     and w->>'dressing' is distinct from (select k.herb from wound_kind_def k where k.id = w->>'kind')
$$;

/* The worst of them on somebody, where a salve goes. The browser's `salveFor`. */
create or replace function salve_for(p_wounds jsonb) returns jsonb
  language sql stable as $$
  select worst_wound((select coalesce(jsonb_agg(x), '[]'::jsonb)
                        from jsonb_array_elements(coalesce(p_wounds, '[]'::jsonb)) x where salvable(x)))
$$;

/* What a salve with nowhere to go says, in the browser's words (`salveRefusal`). */
create or replace function salve_refusal(p_wounds jsonb) returns text
  language sql stable as $$
  select case when salve_for(p_wounds) is not null then null
    when exists (select 1 from jsonb_array_elements(coalesce(p_wounds, '[]'::jsonb)) x
                  where not coalesce((x->>'infected')::boolean, false) and x->>'dressing' is null)
      then 'A salve goes on over a dressing. Dress the wound first.'
    else 'Nothing dressed on you can go bad.' end
$$;

/* The trades a tincture lifts, by the names they go by: "foraging, botanizing, alchemy and first aid". */
create or replace function tincture_names() returns text
  language sql stable as $$
  select list_of(array(select lower(s.name) from unnest(tincture_skills()) with ordinality t(id, ord)
                         join skill_def s on s.id = t.id order by t.ord))
$$;

/*
 * A Naturalist's tincture taken: each of its trades goes in faster for a
 * while, beside whatever a dish is doing for it. A second one puts the clock
 * back on the first rather than stacking on it. The browser's `takeTincture`.
 */
create or replace function grant_tincture(p_world uuid, p_uid uuid) returns void
  language plpgsql as $$
declare v_boons jsonb; v_out jsonb := '[]'::jsonb; v_one jsonb; v_now double precision; v_until double precision;
        v_skill text; v_have text[] := '{}';
begin
  v_now := world_time(p_world);
  v_until := v_now + tincture_seconds();
  select boons into v_boons from player where world_id = p_world and uid = p_uid;
  for v_one in select * from jsonb_array_elements(coalesce(v_boons, '[]'::jsonb)) loop
    if (v_one->>'until')::double precision <= v_now then continue; end if;
    if v_one->>'kind' = 'tincture' and v_one->>'skill' = any(tincture_skills()) then
      v_one := jsonb_set(v_one, '{until}', to_jsonb(greatest((v_one->>'until')::double precision, v_until)));
      v_have := v_have || (v_one->>'skill');
    end if;
    v_out := v_out || v_one;
  end loop;
  foreach v_skill in array tincture_skills() loop
    if not v_skill = any(v_have) then
      v_out := v_out || jsonb_build_object('skill', v_skill, 'bonus', tincture_bonus(), 'until', v_until,
        'from', lower((select coalesce(name, 'tincture') from item_def where id = 'tincture')), 'kind', 'tincture');
    end if;
  end loop;
  update player set boons = v_out where world_id = p_world and uid = p_uid;
end $$;


CREATE OR REPLACE FUNCTION public.perform_gather(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare d action_def; tx int; ty int; here int; data int; t tile_def; tool_id bigint;
        s double precision; tq double precision; made_ql double precision;
        species int; logs int; tree tree_def;
        v_age tree_age_def; v_cuts int;
        passes int; i int; found text[] := '{}'; got text; yields text;
        v_n int; v_hits int; v_rare text;
begin
  select * into d from action_def where id = p_action;
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  here := land_tile(p_world, tx, ty);
  data := land_data(p_world, tx, ty);
  select * into t from tile_def where id = here;
  s := case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end;
  if d.tool is not null then
    select it.id into tool_id from item it
      where it.world_id = p_world and it.holder = 'player' and it.holder_uid = p_uid and it.def = d.tool
      order by tool_worth(it.ql, it.dmg, it.extra, it.rare, it.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id); end if;
  end if;

  if p_action = 'cut_down' then
    -- A Forester's Sure Hatchet glances off half as often (`fail:cut_down`).
    if not perk_pass(skill_check(s, d.difficulty, tq), pk(p_world, p_uid, 'fail:cut_down', 1)) then
      perform skill_raise(p_world, p_uid, 'woodcutting', try_gain(false));
      perform tell(p_world, p_uid, 'Your hatchet glances off and you fail to make headway.', 'event');
      return;
    end if;
    if here = tile_id('Bush') then
      perform land_set_tile(p_world, tx, ty, tile_id('Grass'));
      perform land_set_data(p_world, tx, ty, 0);
      perform land_announce(p_world, tx, ty);
      perform tell(p_world, p_uid, 'You hack the bush down.', 'event');
      -- And straight shafts out of it, for a Forester's Kindling (`bush:shaft`).
      v_n := floor(pk(p_world, p_uid, 'bush:shaft', 0))::int;
      if v_n > 0 then
        made_ql := product_ql(s, tq);
        perform give(p_world, p_uid, 'shaft', v_n, made_ql);
        perform tell(p_world, p_uid, 'You trim ' || number_word(v_n) || ' straight '
          || case when v_n = 1 then 'shaft' else 'shafts' end || ' out of it. (QL '
          || to_char(made_ql, 'FM990.0') || ')', 'event');
      end if;
    elsif here <> tile_id('Tree') then
      -- Nothing standing is nothing to fell. `act_refusal` says so before the
      -- swing and this says so after it: reading a tree off a tile that has
      -- none gives species 0 and age 0, which is a birch out of thin air.
      perform tell(p_world, p_uid, 'There is nothing standing here to cut down.', 'error');
      return;
    else
      species := tree_species(data);
      select * into tree from tree_def where id = species;
      select * into v_age from tree_age_def where id = tree_age(data);
      /*
       * A tree comes down in strokes, and how many depends on what it is.
       *
       * The count is kept beside the tile, in `tree_notch`, rather than in
       * the swinging — because a wood is not one woodcutter's. Leave a half-felled oak and the notch is still in it
       * tomorrow, for you or for whoever finds it. A cut that glances off is
       * not one of them: that is the skill check above, which has already
       * returned by here.
       */
      v_cuts := tree_cuts(p_world, tx, ty) + 1;
      -- A stroke fewer for a Forester's Heavy Swing, and never none.
      v_hits := tree_hits(p_world, p_uid, v_age.hits);
      if v_cuts < v_hits then
        perform tree_notch(p_world, tx, ty, v_cuts);
        perform tell(p_world, p_uid, 'You cut into the ' || lower(v_age.name) || ' '
          || lower(tree.name) || '. ' || (v_hits - v_cuts)
          || ' more like that and it comes down.', 'event');
      else
        logs := v_age.logs;
        -- A tree with timber in it leaves a stump of its kind, in the way of
        -- the ground for a day or until somebody digs it out. Nothing smaller
        -- leaves one worth the name.
        -- And none for a Forester's Clean Drop (`stump:clear`): grass where it stood.
        if logs = 0 or pk(p_world, p_uid, 'stump:clear', 0) > 0 then
          perform land_set_tile(p_world, tx, ty, tile_id('Grass'));
          perform land_set_data(p_world, tx, ty, 0);
        else
          perform land_set_tile(p_world, tx, ty, tile_id('Stump'));
          perform land_set_data(p_world, tx, ty, tree_pack(species, 0));
        end if;
        perform land_announce(p_world, tx, ty);
        perform journal_note(p_world, p_uid, 'tree');
        if logs = 0 then
          perform tell(p_world, p_uid, 'You clear the ' || lower(v_age.name) || ' '
            || lower(tree.name) || ' away. There is no timber in one that size.', 'event');
        else
          -- Better for a Forester's Choice Logs (`ql:cut_down`), and now and
          -- then rare for their Rare Heartwood (`rare:cut_down`).
          made_ql := least(100, product_ql(s, tq) * pk(p_world, p_uid, 'ql:cut_down', 1));
          v_rare := perk_rare(pk(p_world, p_uid, 'rare:cut_down', 0));
          perform gather(p_world, p_uid, 'log', logs, made_ql, tree.name, v_rare);
          perform tell(p_world, p_uid, 'The ' || lower(v_age.name) || ' ' || lower(tree.name)
            || ' comes down. You get ' || logs || coalesce(' ' || v_rare, '')
            || case when logs = 1 then ' log' else ' logs' end || '. (QL ' || to_char(made_ql, 'FM990.0') || ')'
            || case when pk(p_world, p_uid, 'stump:clear', 0) > 0 then ' The ground is clear where it stood.'
                    else ' The stump is left.' end, 'event');
          if v_rare is not null then
            perform journal_note(p_world, p_uid, v_rare);
            perform tell(p_world, p_uid, rarity_word(v_rare), 'skill');
          end if;
          -- A nest in the crown and a wild hive in the trunk, for a Forester's
          -- Nest Finder and Honey Hunter: into the pack, at the logs' quality.
          if random() < pk(p_world, p_uid, 'nest:chance', 0) then
            v_n := floor(pk(p_world, p_uid, 'nest:feathers', 0))::int;
            perform give(p_world, p_uid, 'feather', v_n, made_ql);
            perform tell(p_world, p_uid, 'A nest comes down with it: ' || number_word(v_n) || ' '
              || lower((select name from item_def where id = 'feather')) || '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
          end if;
          if random() < pk(p_world, p_uid, 'honey:chance', 0) then
            v_n := floor(pk(p_world, p_uid, 'honey:count', 0))::int;
            perform give(p_world, p_uid, 'honey', v_n, made_ql);
            perform tell(p_world, p_uid, 'A wild hive in the trunk gives up ' || number_word(v_n) || ' '
              || lower((select name from item_def where id = 'honey')) || '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
          end if;
        end if;
      end if;
    end if;
    perform skill_raise(p_world, p_uid, 'woodcutting', 1);

  elsif p_action in ('forage', 'botanize') then
    perform mark_foraged(p_world, tx, ty, p_action);
    -- A practised eye goes over the same ground more than once, and a
    -- Naturalist's Keen Eye once more again.
    passes := rolls_at(s) + floor(pk(p_world, p_uid, 'passes:' || p_action, 0))::int;
    for i in 1..passes loop
      -- None empty by chance for a Naturalist's Sure Find.
      if random() < forage_empty() * pk(p_world, p_uid, 'empty:' || p_action, 1)
         or not skill_check(s, find_check(), 0) then continue; end if;
      got := roll_table(p_action, random());
      made_ql := product_ql(s, 0);
      -- And now and then a rare one, for a Naturalist's Rare Find.
      v_rare := perk_rare(pk(p_world, p_uid, 'rare:' || p_action, 0));
      perform gather(p_world, p_uid, got, 1, made_ql, null, v_rare);
      found := found || (coalesce(v_rare || ' ', '') || lower((select coalesce(name, got) from item_def where id = got))
        || ' (QL ' || to_char(made_ql, 'FM990.0') || ')');
      if v_rare is not null then
        perform journal_note(p_world, p_uid, v_rare);
        perform tell(p_world, p_uid, rarity_word(v_rare), 'skill');
      end if;
    end loop;
    if array_length(found, 1) is null then
      perform tell(p_world, p_uid, case when passes > 1
        then 'You go over the ground ' || passes || ' times and find nothing'
             || case when p_action = 'forage' then ' edible.' else ' of interest.' end
        else case when p_action = 'forage' then 'You find nothing edible.' else 'You find nothing of interest.' end
        end, 'event');
    else
      perform tell(p_world, p_uid, 'You find some ' || list_of(found) || '.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, d.skill, try_gain(array_length(found, 1) is not null));

  elsif p_action = 'collect' then
    yields := t.dig_yield;
    if yields is null then return; end if;
    if not skill_check(s, d.difficulty, tq) then
      perform skill_raise(p_world, p_uid, 'digging', try_gain(false));
      perform tell(p_world, p_uid, 'Your shovel comes up with nothing but a smear of '
        || lower(t.name) || '.', 'event');
      return;
    end if;
    made_ql := least(100, product_ql(s, tq) * pk(p_world, p_uid, 'ql:collect', 1));
    perform gather(p_world, p_uid, yields, 1, made_ql, null, perk_rare(pk(p_world, p_uid, 'rare:collect', 0)));
    perform tell(p_world, p_uid, 'You fill a shovel with '
      || lower((select coalesce(name, yields) from item_def where id = yields))
      || ' off the top of the bed. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    perform skill_raise(p_world, p_uid, 'digging', 1);
  end if;

end $function$;

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
    v_n := greatest(1, round(case when tree_age(v_data) in (2, 4) then 5 else 3 end
                             * (0.5 + v_skill / 130) * (0.7 + random() * 0.6))::int)
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
    v_rad := prospect_radius(v_skill) + pk(p_world, p_uid, 'further:prospect', 0)::int;
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

CREATE OR REPLACE FUNCTION public.wound_close(w jsonb, p_aid double precision)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select case when (w->>'infected')::boolean then 0 else
    (w->>'severity')::double precision
    * case when w->>'dressing' is null then 0.25 when w->>'dressing' = '' then 0.7
           when w->>'dressing' = k.herb then 1.6 else 0.9 end
    * (0.0006 + p_aid * 0.00002)
    -- Faster for the hands that dressed it: a Naturalist's Quick Mend.
    * coalesce((w->>'mend')::double precision, 1) end
  from wound_kind_def k where k.id = w->>'kind'
$function$;

CREATE OR REPLACE FUNCTION public.fester_chance(w jsonb)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  -- And never under a salve (a Naturalist's).
  select case when (w->>'infected')::boolean or w->>'dressing' = k.herb
                or coalesce((w->>'salved')::boolean, false) then 0 else
    k.fester
    * case when w->>'dressing' is null then 1 when w->>'dressing' = '' then 0.12 else 0.05 end
    * (0.3 + (w->>'severity')::double precision * 2) / 60 end
  from wound_kind_def k where k.id = w->>'kind'
$function$;

CREATE OR REPLACE FUNCTION public.fight_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare it item; c creature; d species_def; w weapon_def; bow weapon_def; dist double precision;
        p player; slot text; corpse item; hurt jsonb; use item; pt player;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action in ('equip', 'unequip') then
    select * into it from item where id = target_item(p_target)
      and world_id = p_world and holder = 'player' and holder_uid = p_uid;
    if not found then return 'It is gone.'; end if;
    slot := slot_of(it.def);
    if slot is null then return 'That is not worn or wielded.'; end if;
    if p_action = 'unequip' then
      return case when (p.equipped->>slot)::bigint is distinct from it.id
                  then 'You are not wearing that.' end;
    end if;
    if (p.equipped->>slot)::bigint = it.id then return 'You already have it on.'; end if;
    if slot = 'offhand' and two_handed_in_hand(p_world, p_uid) then
      return 'Both your hands are on your weapon.';
    end if;
    return null;

  elsif p_action in ('attack_creature', 'shoot_creature', 'treat_creature') then
    perform creature_settle(p_world, (p_target->>'id')::int);
    c := target_creature(p_world, p_target);
    if c.world_id is null then return 'It is dead or gone.'; end if;
    select * into d from species_def where id = c.species;
    dist := (select sqrt((creature_x(c) - pl.x) ^ 2 + (creature_y(c) - pl.y) ^ 2)
             from player pl where pl.world_id = p_world and pl.uid = p_uid);
    if p_action = 'attack_creature' then
      if c.mode <> 'wild' then return 'That one is tame. Release it first if you mean it.'; end if;
      if dist > melee_reach(p_world, p_uid) then return 'It is out of reach.'; end if;
      return null;
    elsif p_action = 'shoot_creature' then
      if c.mode <> 'wild' then return 'That one is tame. Release it first if you mean it.'; end if;
      select bw.* into bow from weapon_def bw where bw.id = (worn(p_world, p_uid, 'weapon')).def and bw.ammo is not null;
      if not found then return 'You have no bow in your hands.'; end if;
      if pack_count(p_world, p_uid, bow.ammo) <= 0 then return 'You are out of arrows.'; end if;
      -- Further for the bow's maker's mark: a Carpenter's True Bow.
      if dist > coalesce(bow.range, 6) * mark_of((worn(p_world, p_uid, 'weapon')).mark, 'range') then
        return 'Too far for a ' || lower((select name from item_def where id = bow.id)) || '.';
      end if;
      if dist < 1.2 then return 'It is too close to draw on.'; end if;
      return null;
    else
      if c.mode = 'wild' then return 'It will not stand still for you while it is wild.'; end if;
      if c.health >= max_health(c) then return c.name || ' is not hurt.'; end if;
      if pack_count(p_world, p_uid, 'bandage') <= 0 then return 'You have no bandages. Cut some from cloth.'; end if;
      if dist > 1.9 then return 'You need to be beside it.'; end if;
      return null;
    end if;

  elsif p_action = 'butcher' then
    corpse := target_corpse(p_world, p_uid, p_target);
    if corpse.id is null then return 'There is nothing to butcher.'; end if;
    if (corpse_species(corpse.extra)).id is null then return 'You cannot make sense of this carcass.'; end if;
    return null;

  elsif p_action = 'bind_wound' then
    /*
     * Somebody else's, for a Naturalist's Field Medic: standing beside you,
     * at your first aid and with your dressings. What is wrong with them is
     * this side's to say; the browser knows only the perk and your pack.
     */
    if p_target->>'kind' = 'person' and p_target->>'uid' is distinct from p_uid::text then
      if pk(p_world, p_uid, 'dress_others', 0) <= 0 then
        return 'Dressing somebody else''s wounds wants a Naturalist who has learned Field Medic.';
      end if;
      if coalesce(p_target->>'uid', '') !~ '^[0-9a-f-]{36}$' then return 'They are not on this island.'; end if;
      select * into pt from player where world_id = p_world and uid = (p_target->>'uid')::uuid;
      if not found then return 'They are not on this island.'; end if;
      if sqrt((pt.x - p.x) ^ 2 + (pt.y - p.y) ^ 2) > 1.9 then return 'You need to be beside them.'; end if;
      perform wounds_settle(p_world, pt.uid);
      select * into pt from player where world_id = p_world and uid = pt.uid;
      hurt := worst_wound(pt.wounds);
      if hurt is null then return coalesce(pt.name, 'They') || ' has nothing open to dress.'; end if;
      if (hurt->>'infected')::boolean then
        return 'The ' || (select name from wound_kind_def where id = hurt->>'kind') || ' on '
          || coalesce(pt.name, 'their') || '''s ' || part_name(hurt->>'part')
          || ' has gone bad. It wants cleaning out before anything will hold on it.';
      end if;
      if (dressing_for(p_world, p_uid, hurt)).id is null then return 'You have nothing to dress it with.'; end if;
      return null;
    end if;
    perform wounds_settle(p_world, p_uid);
    select * into p from player where world_id = p_world and uid = p_uid;
    hurt := worst_wound(p.wounds);
    if hurt is null then
      return case when coalesce((p.stats->>'health')::double precision, 1) >= 0.999
        then 'There is nothing wrong with you.' else 'Nothing is open. You are only tired and thin.' end;
    end if;
    if (hurt->>'infected')::boolean then
      return 'The ' || (select name from wound_kind_def where id = hurt->>'kind')
        || ' on your ' || part_name(hurt->>'part')
        || ' has gone bad. Clean it out before anything will hold on it.';
    end if;
    use := dressing_for(p_world, p_uid, hurt);
    if use.id is null then return 'You have nothing to dress it with.'; end if;
    return null;

  elsif p_action = 'clean_wound' then
    perform wounds_settle(p_world, p_uid);
    select * into p from player where world_id = p_world and uid = p_uid;
    if not exists (select 1 from jsonb_array_elements(coalesce(p.wounds, '[]'::jsonb)) x
                   where (x->>'infected')::boolean) then
      return 'Nothing on you has gone bad.';
    end if;
    if pack_count(p_world, p_uid, 'lye_bucket') <= 0 then
      return 'You need a bucket of lye to clean it out with.';
    end if;
    return null;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_fight(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_landed boolean; it item; p player; slot text; shield item; c creature; d species_def; w weapon_def;
        bow weapon_def; arrow item; held item; dist double precision; dmg double precision;
        bane double precision; before double precision; died boolean; reach double precision;
        corpse item; sp species_def; knife_ql double precision; v_share double precision;
        made_ql double precision; taken text[] := '{}'; r record; v_n int; lumps text[] := '{}';
        hurt jsonb; use item; suits boolean; clean boolean; healed double precision;
        top double precision; out_w jsonb; one jsonb; lye item; got text; v_bait int;
        pt player; v_other boolean; v_mend double precision; v_kind text;
begin
  select * into p from player where world_id = p_world and uid = p_uid;

  if p_action = 'equip' then
    select * into it from item where id = target_item(p_target);
    slot := slot_of(it.def);
    update player set equipped = jsonb_set(equipped, array[slot], to_jsonb(it.id))
      where world_id = p_world and uid = p_uid returning * into p;
    -- Both hands on it means nothing else in them.
    if slot = 'weapon' and coalesce((select two_handed from weapon_def where id = it.def), false) then
      shield := worn(p_world, p_uid, 'offhand');
      if shield.id is not null then
        update player set equipped = equipped - 'offhand' where world_id = p_world and uid = p_uid;
        perform tell(p_world, p_uid, 'You need both hands for that, so the '
          || lower((select name from item_def where id = shield.def)) || ' goes on your back.', 'info');
      end if;
    end if;
    perform tell(p_world, p_uid, 'You '
      || case when slot in ('weapon', 'offhand') then 'take up' else 'put on' end
      || ' the ' || lower((select name from item_def where id = it.def)) || '.', 'info');

  elsif p_action = 'unequip' then
    select * into it from item where id = target_item(p_target);
    slot := slot_of(it.def);
    update player set equipped = equipped - slot where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You put the '
      || lower((select name from item_def where id = it.def)) || ' away.', 'info');

  elsif p_action = 'attack_creature' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    select * into d from species_def where id = c.species;
    w := swung_with(p_world, p_uid);
    held := swung_item(p_world, p_uid);
    before := c.health;
    -- The gains used to be written above the roll, so a miss paid exactly
    -- what a landed blow paid.
    -- Its blood has a say in whether you connect at all.
    v_landed := random() <= hit_chance(p_world, p_uid, w.kind, mark_of(held.mark, 'aim')) * beast_mul(c, 'evade');
    perform skill_raise(p_world, p_uid, 'fighting', try_gain(v_landed, swing_fight()));
    perform skill_raise(p_world, p_uid, w.kind, try_gain(v_landed, swing_arm()));
    perform skill_raise(p_world, p_uid, 'body_strength', try_gain(v_landed, swing_body()));
    -- And, if it is dark enough to matter, what it teaches about noticing.
    perform fought_in_dark(p_world, p_uid, dark_swing());
    if not v_landed then
      perform tell(p_world, p_uid, 'You swing at the ' || lower(d.name)
        || case when held.id is null then '' else ' with your '
             || lower((select name from item_def where id = held.def)) end || ' and miss.', 'fight');
    else
      bane := case when held.id is not null and mat_bane(held.extra) and d.glow is not null
                   then bane_bonus() else 1 end;
      dmg := weapon_damage(p_world, p_uid, w, held) * bane * (0.75 + random() * 0.5);
      died := hurt_creature(p_world, c.id, dmg, p_uid);
      if held.id is not null then perform damage_item(held.id, 0.35); end if;
      if not died then
        perform tell(p_world, p_uid, 'You strike the ' || lower(d.name)
          || case when held.id is null then '' else ' with your '
               || lower((select name from item_def where id = held.def)) end
          || '. It is down to ' || greatest(0, ceil(c.health - dmg)) || ' of ' || max_health(c) || '.', 'fight');
      end if;
    end if;
    -- A cornered animal gets a swipe in, and the defensive sorts never miss their chance.
    if not coalesce(died, false) and (d.defensive or random() < 0.35) then
      -- And you are marked as struck by it, which is what a defensive companion at
      -- heel answers; a hunter that bites you marks you the same way.
      perform mark_attacker(p_world, p_uid, c.id);
      perform hurt_player(p_world, p_uid, attack_of(c) * 0.012,
        'The ' || lower(d.name) || case when d.defensive then ' comes straight back at you'
                                        else ' turns on you' end,
        coalesce(d.wound, 'bite'));
    end if;

  elsif p_action = 'shoot_creature' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    select * into d from species_def where id = c.species;
    held := worn(p_world, p_uid, 'weapon');
    select bw.* into bow from weapon_def bw where bw.id = held.def and bw.ammo is not null;
    if not found then return; end if;
    select i.* into arrow from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = bow.ammo
      order by i.ql desc limit 1;
    if arrow.id is null or not consume(p_world, p_uid, bow.ammo, 1, arrow.id) then return; end if;
    dist := (select sqrt((creature_x(c) - pl.x) ^ 2 + (creature_y(c) - pl.y) ^ 2)
             from player pl where pl.world_id = p_world and pl.uid = p_uid);
    -- The far end of a bow's range is a far harder shot than the near end.
    v_landed := random() <= hit_chance(p_world, p_uid, 'archery', mark_of(held.mark, 'aim'))
                            * (1 - (dist / (coalesce(bow.range, 6) * mark_of(held.mark, 'range'))) * 0.35) * beast_mul(c, 'evade');
    perform skill_raise(p_world, p_uid, 'fighting', try_gain(v_landed, shot_fight()));
    perform skill_raise(p_world, p_uid, 'archery', try_gain(v_landed, shot_archery()));
    -- Picking a target out of the dark at range is the hardest looking there is.
    perform fought_in_dark(p_world, p_uid, dark_shot());
    if not v_landed then
      perform tell(p_world, p_uid, 'Your arrow goes wide of the ' || lower(d.name) || '.', 'fight');
    else
      -- The stave throws it; the head is what goes in. Both have a say.
      bane := case when mat_bane(arrow.extra) and d.glow is not null then bane_bonus() else 1 end;
      dmg := weapon_damage(p_world, p_uid, bow, held) * mat_edge(arrow.extra) * bane
             * (0.6 + arrow.ql / 140) * (0.8 + random() * 0.4);
      died := hurt_creature(p_world, c.id, dmg, p_uid);
      perform damage_item(held.id, 0.25);
      if not died then
        perform tell(p_world, p_uid, 'Your arrow goes home. The ' || lower(d.name)
          || ' is down to ' || greatest(0, ceil(c.health - dmg)) || ' of ' || max_health(c) || '.', 'fight');
      end if;
    end if;

  elsif p_action = 'butcher' then
    corpse := target_corpse(p_world, p_uid, p_target);
    sp := corpse_species(corpse.extra);
    if corpse.id is null or sp.id is null then return; end if;
    knife_ql := nullif(tool_ql(p_world, p_uid, 'butchering_knife'), 0);
    -- And more of it for a Cook's Full Carcass, and never more than all of it.
    v_share := least(1, butcher_yield(skill_of(p_world, p_uid, 'butchering'), knife_ql)
                        * pk(p_world, p_uid, 'share:butcher', 1));
    /*
     * The Butchering skill decides the quality of everything that comes off
     * the carcass, the way every trade's skill decides what it makes: with a
     * knife it is your skill, or the knife's quality spread 0.6 to 1.4 when
     * that comes out lower; bare-handed it is your skill spread the same way.
     * The corpse's own quality used to scale it down again by 0.6 to 1.0, so
     * a butcher at 100 took meat off at 66 to 80 and the skill did not decide
     * it. Asked for: "Butchering skill determines ql of Butchering output".
     */
    made_ql := product_ql(skill_of(p_world, p_uid, 'butchering'), coalesce(knife_ql, 0));
    -- What it was sleeping on, which is not a part of it at all.
    for r in select sb.n from species_butcher sb where sb.species = sp.id and sb.part = 'hoard' loop
      for v_n in 1..round(r.n * (4 + v_share * 6))::int loop
        select item into got from hoard_metal order by random() limit 1;
        perform gather(p_world, p_uid, got, 1, greatest(20, least(100, 40 + random() * 55)));
        lumps := lumps || lower((select name from item_def where id = got));
      end loop;
    end loop;
    if array_length(lumps, 1) > 0 then
      perform journal_note(p_world, p_uid, 'hoard');
      perform tell(p_world, p_uid, 'Something rattles as the belly opens: ' || array_length(lumps, 1)
        || ' lumps of what it had been sleeping on. '
        || (select string_agg(distinct l, ', ') from unnest(lumps) l) || '.', 'event');
    end if;
    /* `n` was a plpgsql variable here and `species_butcher.n` a column, and
     * Postgres would not guess which was meant. That is the fourth time on
     * this island — `land_tile.y`, `crop.y`, `trait_def.tier` — so the locals
     * that could collide carry a prefix. */
    for r in select b.part, b.item, sb.n from butcher_part b
             join species_butcher sb on sb.part = b.part and sb.species = sp.id
             order by b.ord loop
      v_n := floor(r.n * v_share)::int;
      -- The remainder is a chance at one more, so a poor job still gives something.
      if random() < r.n * v_share - v_n then v_n := v_n + 1; end if;
      -- Glands are the rare part: only a steady hand finds them intact.
      if r.part = 'gland' and v_n > 0 and random() > 0.35 * (0.5 + v_share) then v_n := 0; end if;
      if v_n <= 0 then continue; end if;
      -- Better for a perk on the part (a Cook's Prime Cuts and Hide Keeper).
      perform gather(p_world, p_uid, r.item, v_n,
        least(100, greatest(1, least(100, made_ql)) * pk(p_world, p_uid, 'ql:' || r.item, 1)));
      taken := taken || (case when v_n > 1 then v_n || ' × ' else '' end
        || lower((select name from item_def where id = r.item)));
    end loop;
    -- And bait for the hook out of what is left (a Cook's Bait Maker), into the pack.
    v_bait := floor(pk(p_world, p_uid, 'bait:butcher', 0))::int;
    if v_bait > 0 then
      perform give(p_world, p_uid, 'offal', v_bait, greatest(1, least(100, made_ql)));
      taken := taken || (v_bait || ' × ' || lower((select name from item_def where id = 'offal')));
    end if;
    delete from item where id = corpse.id;
    if array_length(taken, 1) is null then
      perform tell(p_world, p_uid, 'You make a mess of the ' || lower(sp.name)
        || ' carcass and salvage nothing.', 'event');
    else
      perform tell(p_world, p_uid, 'You butcher the ' || lower(sp.name) || ' and take '
        || array_to_string(taken, ', ') || ' (QL ' || to_char(greatest(1, least(100, made_ql)), 'FM990.0') || ').'
        || case when knife_ql is null then ' Bare hands waste most of a carcass.' else '' end, 'event');
    end if;
    /*
     * And what a go at it teaches, which was nothing: every other trade's
     * performer raises its own skill, and this one never did, so Butchering
     * stayed where it started on an island however much was butchered -- and
     * with it the quality of everything taken off a carcass. A full go, as
     * the browser has always counted one, whatever the carcass gave.
     */
    perform skill_raise(p_world, p_uid, 'butchering', 1);

  elsif p_action = 'bind_wound' then
    -- Your own, or somebody else's beside you for a Naturalist's Field Medic:
    -- at your first aid and out of your pack either way.
    v_other := p_target->>'kind' = 'person' and p_target->>'uid' is distinct from p_uid::text;
    if v_other then
      select * into pt from player where world_id = p_world and uid = (p_target->>'uid')::uuid;
      if not found then return; end if;
    else
      select * into pt from player where world_id = p_world and uid = p_uid;
    end if;
    hurt := worst_wound(pt.wounds);
    if hurt is null or (hurt->>'infected')::boolean then return; end if;
    use := dressing_for(p_world, p_uid, hurt);
    if use.id is null or not consume(p_world, p_uid, use.def, 1, use.id) then return; end if;
    got := case when use.def = 'cover' then lower(coalesce(use.extra, '')) else '' end;
    v_kind := (select name from wound_kind_def where id = hurt->>'kind');
    suits := got = (select herb from wound_kind_def where id = hurt->>'kind');
    -- Slips half as often for a Naturalist's Sure Hands.
    clean := perk_pass(skill_check(skill_of(p_world, p_uid, 'first_aid'), dress_check(), use.ql),
                       pk(p_world, p_uid, 'fail:bind_wound', 1));
    -- And closes faster for the hands that dressed it: a Naturalist's Quick Mend.
    v_mend := pk(p_world, p_uid, 'mend:bind_wound', 1);
    -- Cloth holds a dressing on. The right herb closes the wound.
    healed := (0.06 + (skill_of(p_world, p_uid, 'first_aid') / 100) * 0.24 + (use.ql / 100) * 0.1)
              * (case when clean then 1 else 0.35 end)
              * (case when suits then 1.5 when got <> '' then 1.1 else 1 end);
    out_w := '[]'::jsonb;
    for one in select * from jsonb_array_elements(pt.wounds) loop
      if one = hurt then
        one := jsonb_set(one, '{severity}', to_jsonb(greatest(0, (one->>'severity')::double precision - healed)));
        if clean then
          one := jsonb_set(jsonb_set(one, '{dressing}', to_jsonb(got)), '{bleeding}', 'false');
          one := case when v_mend <> 1 then jsonb_set(one, '{mend}', to_jsonb(v_mend)) else one - 'mend' end;
        end if;
      end if;
      if (one->>'severity')::double precision > 0.004 or (one->>'infected')::boolean then
        out_w := out_w || one;
      end if;
    end loop;
    update player set wounds = out_w,
        stats = jsonb_set(pt.stats, '{health}',
          to_jsonb(least(1, coalesce((pt.stats->>'health')::double precision, 1) + healed)))
      where world_id = p_world and uid = pt.uid;
    perform journal_note(p_world, p_uid, 'dressed');
    if clean and suits then perform journal_note(p_world, p_uid, 'covered'); end if;
    perform skill_raise(p_world, p_uid, 'first_aid', try_gain(clean, bandage_gain()));
    if v_other then
      perform tell(p_world, p_uid, case
        when not clean then 'The dressing slips and you make a poor job of it. ' || coalesce(pt.name, 'They')
          || ' still has ' || wound_text(hurt) || '.'
        else 'You dress the ' || v_kind || ' on ' || coalesce(pt.name, 'their') || '''s ' || part_name(hurt->>'part')
          || case when suits then ' with ' || got || ', which suits it.' when got <> '' then ' with ' || got || '.'
                  else ' with cloth.' end
        end, 'event');
      perform tell(p_world, pt.uid, coalesce(p.name, 'Somebody') || case when clean
        then ' dresses the ' || v_kind || ' on your ' || part_name(hurt->>'part') || '.'
        else ' tries to dress the ' || v_kind || ' on your ' || part_name(hurt->>'part') || ' and makes a poor job of it.' end,
        'event');
      return;
    end if;
    perform tell(p_world, p_uid, case
      when not clean then 'The dressing slips and you make a poor job of it. You still have '
        || wound_text(hurt) || '.'
      when suits then 'You lay the ' || got
        || ' cover on and bind it. The bleeding stops at once and it is already closing.'
      when got <> '' then 'You bind the ' || got || ' cover over it. It is the wrong herb for a '
        || (select name from wound_kind_def where id = hurt->>'kind')
        || ', but it holds and the bleeding stops.'
      else 'You clean it and bind it with cloth. The bleeding stops, though it will be slow to close.'
      end, 'event');

  elsif p_action = 'clean_wound' then
    select * into p from player where world_id = p_world and uid = p_uid;
    select i.* into lye from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'lye_bucket'
      order by i.ql desc limit 1;
    if lye.id is null or not consume(p_world, p_uid, 'lye_bucket', 1, lye.id) then return; end if;
    perform give(p_world, p_uid, 'bucket', 1, lye.ql);
    clean := skill_check(skill_of(p_world, p_uid, 'first_aid'), 26, lye.ql);
    perform journal_note(p_world, p_uid, 'cleaned');
    perform skill_raise(p_world, p_uid, 'first_aid', try_gain(clean, clean_gain()));
    select x into hurt from jsonb_array_elements(p.wounds) x where (x->>'infected')::boolean limit 1;
    if not clean then
      perform tell(p_world, p_uid, 'You scour the '
        || (select name from wound_kind_def where id = hurt->>'kind')
        || ' out and it is no better for it. The lye is gone.', 'error');
      return;
    end if;
    out_w := '[]'::jsonb;
    for one in select * from jsonb_array_elements(p.wounds) loop
      if one = hurt then
        -- Scoured out, nothing of the old dressing is left on it: no salve and no quick hands.
        one := jsonb_set(jsonb_set(jsonb_set(one, '{infected}', 'false'),
          '{bleeding}', 'true'), '{dressing}', 'null'::jsonb) - 'mend' - 'salved';
      end if;
      out_w := out_w || one;
    end loop;
    update player set wounds = out_w where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You scour the '
      || (select name from wound_kind_def where id = hurt->>'kind') || ' on your '
      || part_name(hurt->>'part') || ' out with lye. It is open and clean again, and bleeding. Dress it.', 'event');

  elsif p_action = 'treat_creature' then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;
    select i.* into use from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'bandage'
      order by i.ql desc limit 1;
    if use.id is null or not consume(p_world, p_uid, 'bandage', 1, use.id) then return; end if;
    clean := skill_check(skill_of(p_world, p_uid, 'first_aid'), 14, use.ql);
    top := max_health(c);
    healed := top * (0.06 + (skill_of(p_world, p_uid, 'first_aid') / 100) * 0.24 + (use.ql / 100) * 0.1)
              * (case when clean then 1 else 0.35 end);
    update creature set health = least(top, health + healed)
      where world_id = p_world and id = c.id returning * into c;
    perform skill_raise(p_world, p_uid, 'first_aid', try_gain(clean, bandage_gain()));
    perform tell(p_world, p_uid, case when clean
      then 'You dress ' || c.name || '''s wounds with the '
        || lower((select name from item_def where id = 'bandage')) || '. It is up to '
      else c.name || ' will not hold still and the dressing goes on badly. It is up to '
      end || ceil(c.health) || ' of ' || top || '.', 'event');
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

CREATE OR REPLACE FUNCTION public.item_action(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in ('improve_item', 'repair_item', 'patch_item', 'eat', 'drink', 'drink_skin', 'quench_item',
                      'drink_tea', 'take_tincture', 'apply_salve')
$function$;

CREATE OR REPLACE FUNCTION public.item_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare v_it item; v_what improvable_def; v_mat improve_material_def; v_miss text;
        v_ceiling double precision; v_made text; v_tx int; v_ty int; v_p player;
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

  -- A Naturalist's remedies, which anybody who has one may use.
  elsif p_action = 'drink_tea' then
    if coalesce((select stamina from item_def where id = v_it.def), 0) <= 0 then return 'That is not something to drink.'; end if;
    select * into v_p from player where world_id = p_world and uid = p_uid;
    if coalesce((v_p.stats->>'stamina')::double precision, 1) >= 0.999 then return 'You are not tired.'; end if;
    return null;

  elsif p_action = 'take_tincture' then
    if v_it.def <> 'tincture' then return 'That is not a tincture.'; end if;
    return null;

  elsif p_action = 'apply_salve' then
    if v_it.def <> 'salve' then return 'That is not a salve.'; end if;
    perform wounds_settle(p_world, p_uid);
    select * into v_p from player where world_id = p_world and uid = p_uid;
    return salve_refusal(v_p.wounds);

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
        v_up double precision; v_hurt jsonb; v_out jsonb; v_one jsonb; v_said text;
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

  -- A Naturalist's herb tea: a cup of it puts back its share of your stamina.
  elsif p_action = 'drink_tea' then
    v_up := coalesce((select stamina from item_def where id = v_it.def), 0);
    if not consume(p_world, p_uid, v_it.def, 1, v_it.id) then return; end if;
    update player set stats = jsonb_set(stats, '{stamina}', to_jsonb(least(1,
        coalesce((v_p.stats->>'stamina')::double precision, 1) + v_up)))
      where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You drink the ' || v_name || '. It puts back ' || whole_pct(v_up)
      || ' of your stamina.', 'event');

  -- And a tincture: the Naturalist's four trades go in faster for a while.
  elsif p_action = 'take_tincture' then
    if not consume(p_world, p_uid, v_it.def, 1, v_it.id) then return; end if;
    perform grant_tincture(p_world, p_uid);
    v_said := tincture_names();
    perform tell(p_world, p_uid, 'You take the tincture. ' || upper(left(v_said, 1)) || substr(v_said, 2)
      || ' each go in ' || whole_pct(tincture_bonus()) || ' faster for the next ' || clock_left(tincture_seconds()) || '.',
      'event');

  -- And a salve, rubbed in over the worst dressing on you that could still go bad.
  elsif p_action = 'apply_salve' then
    v_hurt := salve_for(v_p.wounds);
    if v_hurt is null or not consume(p_world, p_uid, v_it.def, 1, v_it.id) then return; end if;
    v_out := '[]'::jsonb;
    for v_one in select * from jsonb_array_elements(v_p.wounds) loop
      if v_one = v_hurt then v_one := jsonb_set(v_one, '{salved}', 'true'); end if;
      v_out := v_out || v_one;
    end loop;
    update player set wounds = v_out where world_id = p_world and uid = p_uid;
    perform tell(p_world, p_uid, 'You rub the salve into the '
      || (select name from wound_kind_def where id = v_hurt->>'kind') || ' on your ' || part_name(v_hurt->>'part')
      || '. It will not go bad under it.', 'event');

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

CREATE OR REPLACE FUNCTION public.grant_boon(p_world uuid, p_uid uuid, p_item text, p_ql double precision, p_knack double precision DEFAULT 1)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare v_skill text; v_secs double precision; v_boons jsonb; v_out jsonb := '[]'::jsonb;
        v_one jsonb; v_found boolean := false; v_until double precision; v_now double precision;
begin
  select boon_of((select seed from world where id = p_world), p_item) into v_skill;
  if v_skill is null then return null; end if;
  v_secs := boon_time(p_item, p_ql, p_knack);
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
 * The Naturalist's tree, cleared, as the ten before it were: its nine nodes
 * left `class_node` with the rulebook that brought its perks, whatever of them
 * anybody had taken goes, and every Naturalist's fold is written again.
 */
delete from player_node where node ~ '^naturalist_[0-9]_[0-9]$';
do $$
declare r record;
begin
  for r in select world_id, uid from player where craft_class = 'naturalist' loop
    perform class_fold(r.world_id, r.uid);
  end loop;
end $$;

revoke all on function hive_rate(double precision) from public, anon, authenticated;
revoke all on function hive_sweep(uuid) from public, anon, authenticated;
revoke all on function salvable(jsonb) from public, anon, authenticated;
revoke all on function salve_for(jsonb) from public, anon, authenticated;
revoke all on function salve_refusal(jsonb) from public, anon, authenticated;
revoke all on function tincture_names() from public, anon, authenticated;
revoke all on function grant_tincture(uuid, uuid) from public, anon, authenticated;
select private.lock_doors();
