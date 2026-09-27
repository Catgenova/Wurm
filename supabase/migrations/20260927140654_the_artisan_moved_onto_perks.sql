/*
 * The Artisan moved onto perks: its eighteen, on the island.
 *
 * The fourteenth trade off its tree (`PERK_CLASSES`), and the last of the
 * craft trades. Its perks are rows the definitions already carry
 * (`class_perk`), and so are its circlet, its amphora, its potter's wheel and
 * its books. What is here is every rule the perks change, each reading its key
 * off the fold with the rule's own number as the default, so that for anybody
 * without the perk nothing moves:
 *
 *   * the bench (`perform_craft`): Sure Setting's failing less, which every
 *     recipe already reads (`fail:`); Keep the Stone's stone out of a failed
 *     focus whole; and the pot, the bowl or the jar a go is done in, read
 *     before anything is spent -- a serving more of a dish for its maker's Deep
 *     Pot (`serve`), and what is put up in it rotting slower for their Sealed
 *     Jar (`keeps`);
 *   * the kiln (`perform_firing`, `furnace_fold`), which carries a shaper's
 *     mark through the fire into the pot it makes, where it had dropped it;
 *   * a jewel worn (`skill_mult`, `jewel_gain`): Bright Stone's more and Cut
 *     True's more again by the jewel's quality, and a circlet on the head, each
 *     of its stones at `circlet_share`;
 *   * the rock (`maybe_gem`, `roll_gem`): six more stones, which it gives up
 *     only to a miner with More Stones;
 *   * a focus (`spell_wear`, `spell_force`, `do_spell`): Focus Cutter's less
 *     wear and Keen Focus's stronger spell and longer hold, for whoever casts
 *     from it;
 *   * a book (`perform_dig`): Good Read's more out of a go of study and Sturdy
 *     Binding's less wear, and a trade book, which teaches its trade;
 *   * a go at pottery near a potter's wheel (`rpc_act`, `settle`,
 *     `piece_pace`), after the floor as a perk's time is, whoever built it;
 *   * and the new things, each made only by an Artisan who has learned it
 *     (`craft_refusal`) and used by anybody: a circlet, a stone set in it off
 *     the stone's own menu (`set_in_circlet`); an amphora, a bag for one kind
 *     of food or drink (`bag_refuses`); and a glaze, which only an Artisan
 *     with it may put on (`glaze_item`), and which marks a pot glazed (`glaze`,
 *     nought on its decay on the ground), said on its own as a seal is.
 *
 * And two things the island had never done. What is in a bag lying on the
 * ground ages with it, at the share of the weather the bag keeps off
 * (`shelter`), as it always has in the browser: nothing in a bag on the ground
 * had rotted at all. And a thing set down starts its clock afresh, as one
 * split off a pile always did, rather than being charged at its first round on
 * the ground for all the time it spent in a pack, where nothing rots.
 *
 * The Artisan's nodes go with its tree, and every Artisan's fold is written
 * again.
 */
set local lock_timeout = '3s';

/* The stones set in a thing, by name: a ring's or a pendant's one, or what a circlet has, one after another on its label. */
create or replace function stones_of(it item) returns text[]
  language sql immutable as $$
  select case when it.id is null or it.extra is null then '{}'::text[]
              when it.def = 'circlet' then array(select lower(trim(s)) from unnest(string_to_array(it.extra, ',')) s where trim(s) <> '')
              else array[lower(it.extra)] end
$$;

/*
 * What a worn jewel gives on a trade: for each of its stones that favours it,
 * `jewel_bonus` times its setter's mark (an Artisan's Bright Stone), and up to
 * the mark's more by the jewel's quality (Cut True), a circlet's each at
 * `circlet_share` of that. `jewelGain` in the browser.
 */
create or replace function jewel_gain(it item, p_skill text) returns double precision
  language sql stable as $$
  select coalesce(count(*), 0)
       * (jewel_bonus() * mark_of(it.mark, 'bright') + coalesce((it.mark->>'cut')::double precision, 0) * least(100, it.ql) / 100)
       * case when it.def = 'circlet' then circlet_share() else 1 end
    from unnest(stones_of(it)) s join gem_def g on lower(g.name) = s
   where g.skill = p_skill
$$;

/* A dish: food eaten a serving at a time rather than drunk out of what it came in. `isDish` in the browser. */
create or replace function is_dish(p_def text) returns boolean
  language sql stable as $$
  select coalesce((select d.category = 'food' and d.charges is null from item_def d where d.id = p_def), false)
$$;

/*
 * What a piece standing near makes of a go at its trade, after the floor: an
 * Artisan's potter's wheel, anybody's pottery within its reach. One of each
 * kind of piece counts. `Game.pieceSpeed` in the browser.
 */
create or replace function piece_pace(p_world uuid, p_uid uuid, p_skill text) returns double precision
  language sql stable as $$
  select coalesce(exp(sum(ln(f.pace))), 1) from furniture_def f
   where p_skill is not null and f.pace_skill = p_skill and f.pace > 0
     and exists (select 1 from placed_near(p_world, p_uid, 'furniture', f.id, f.pace_reach))
$$;

/* What a book teaches: a plain one mind logic, and a trade book the trade on its spine. `bookTeaches` in the browser. */
create or replace function book_teaches(it item) returns text
  language sql stable as $$
  select case when it.def = 'trade_book'
              then coalesce((select s.id from skill_def s where lower(s.name) = lower(it.extra)), 'mind_logic')
              else 'mind_logic' end
$$;

/* The first circlet somebody carries with a setting still empty, by the order they were made. `circletWithRoom` in the browser. */
create or replace function circlet_with_room(p_world uuid, p_uid uuid) returns item
  language sql stable as $$
  select i.* from item i
   where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = 'circlet'
     and coalesce(array_length(stones_of(i), 1), 0) < circlet_stones()
   order by i.id limit 1
$$;

/* Which stones the rock gives up to a miner: by weight, and the ones a perk asks for only to somebody who has it. */
drop function if exists roll_gem();
create or replace function roll_gem(p_more boolean default false) returns text
  language sql volatile as $$
  with pool as (select name, weight, ord from gem_def where perk is null or p_more),
       c as (select name, sum(weight) over (order by ord) as upto from pool),
       r as (select random() * (select sum(weight) from pool) as x)
  select c.name from c, r where c.upto > r.x order by c.upto limit 1
$$;

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
  -- A Mender's repair kit and sealant.
  if p_recipe = 'make_repair_kit' and pk(p_world, p_uid, 'repair_kit', 0) <= 0 then
    return 'That wants a Mender who has learned to make a repair kit.';
  end if;
  if p_recipe = 'make_sealant' and pk(p_world, p_uid, 'sealant', 0) <= 0 then
    return 'That wants a Mender who has learned to make sealant.';
  end if;
  -- An Artisan's circlet, amphora, potter's wheel and trade books.
  if p_recipe = 'make_circlet' and pk(p_world, p_uid, 'circlet', 0) <= 0 then
    return 'That wants an Artisan who has learned to make a circlet.';
  end if;
  if p_recipe = 'make_amphora' and pk(p_world, p_uid, 'amphora', 0) <= 0 then
    return 'That wants an Artisan who has learned to shape an amphora.';
  end if;
  if p_recipe = 'make_potters_wheel' and pk(p_world, p_uid, 'potters_wheel', 0) <= 0 then
    return 'That wants an Artisan who has learned to build a potter''s wheel.';
  end if;
  if p_recipe like 'write\_trade\_book\_%' then
    if pk(p_world, p_uid, 'trade_book', 0) <= 0 then
      return 'That wants an Artisan who has learned to write a trade book.';
    end if;
    -- A book on a trade is written only by somebody who knows enough of it.
    if skill_of(p_world, p_uid, substr(p_recipe, 18)) < trade_book_at() then
      return 'You know too little of ' || lower((select s.name from skill_def s where s.id = substr(p_recipe, 18)))
        || ' to write a book on it: that wants ' || trade_book_at() || '.';
    end if;
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
                      'drink_tea', 'take_tincture', 'apply_salve', 'mend_kit', 'seal_item', 'set_in_circlet', 'glaze_item')
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
  -- And an Artisan's Glaze, the same way.
  if p_action = 'glaze_item' and pk(p_world, p_uid, 'glaze_item', 0) <= 0 then
    return 'That wants an Artisan who has learned to glaze.';
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

  -- A Mender's kit and sealant, which anybody who has one may use, in the browser's words.
  elsif p_action = 'mend_kit' then
    if v_it.dmg <= 0 then return 'There is nothing wrong with it.'; end if;
    if v_it.def = 'repair_kit' then return 'A kit does not mend itself.'; end if;
    if pack_count(p_world, p_uid, 'repair_kit', null) < 1 then return 'You have no repair kit.'; end if;
    return null;

  -- A stone set in an Artisan's circlet, by anybody with a file, in the browser's words.
  elsif p_action = 'set_in_circlet' then
    if v_it.def <> 'gem' or not exists (select 1 from gem_def g where lower(g.name) = lower(v_it.extra)) then
      return 'Only a stone goes in a circlet.';
    end if;
    if (circlet_with_room(p_world, p_uid)).id is null then
      return 'You have no circlet with a setting empty: each takes ' || circlet_stones() || ' stones.';
    end if;
    if tool_ql(p_world, p_uid, 'file') <= 0 then return 'You need a file.'; end if;
    return null;

  elsif p_action = 'glaze_item' then
    if not glazeable(v_it.def) then return 'Only a fired pot, bowl or jar, or an amphora, takes a glaze.'; end if;
    if coalesce(v_it.mark, '{}'::jsonb) ? 'glaze' then return 'It is glazed already.'; end if;
    if pack_count(p_world, p_uid, 'ash', null) < glaze_ash() then return 'You need ashes to make a glaze of.'; end if;
    return null;

  elsif p_action = 'seal_item' then
    if v_it.def = 'sealant' then return 'Sealant does not seal itself.'; end if;
    if coalesce(v_it.mark, '{}'::jsonb) ? 'seal' then return 'It is sealed already.'; end if;
    if pack_count(p_world, p_uid, 'sealant', null) < v_it.count then
      return 'You need ' || v_it.count || ' sealant to seal all ' || v_it.count || ' of them; you have '
        || pack_count(p_world, p_uid, 'sealant', null) || '.';
    end if;
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
        v_favour text; v_full text; v_name text; v_p player; v_lift text; v_keep double precision;
        v_up double precision; v_hurt jsonb; v_out jsonb; v_one jsonb; v_said text; v_circlet item; v_gem text;
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

  -- A Mender's repair kit, which anybody who has one may use: damage off
  -- anything, anywhere, and none of its quality.
  elsif p_action = 'mend_kit' then
    if v_it.dmg <= 0 or v_it.def = 'repair_kit' then return; end if;
    if not consume(p_world, p_uid, 'repair_kit', 1) then return; end if;
    update item set dmg = greatest(0, dmg - kit_mend()) where id = v_it.id returning * into v_it;
    perform skill_raise(p_world, p_uid, 'repair', 0.25);
    perform tell(p_world, p_uid, 'You mend the ' || v_name || ' with a repair kit. (damage '
      || to_char(v_it.dmg, 'FM990.00') || ')', 'event');

  -- A stone set in an Artisan's circlet, on jewellery, surer for their Sure
  -- Setting; one that will not seat is taken out again whole.
  elsif p_action = 'set_in_circlet' then
    v_circlet := circlet_with_room(p_world, p_uid);
    select g.name into v_gem from gem_def g where lower(g.name) = lower(v_it.extra);
    if v_circlet.id is null or v_gem is null or v_it.def <> 'gem' then return; end if;
    perform wear_tool(held_tool(p_world, p_uid, 'file'));
    if not perk_pass(skill_check(skill_of(p_world, p_uid, 'jewellery'), circlet_set(), tool_ql(p_world, p_uid, 'file'),
                                 mind_ease(p_world, p_uid)),
                     pk(p_world, p_uid, 'fail:set_in_circlet', 1)) then
      perform skill_raise(p_world, p_uid, 'jewellery', try_gain(false));
      perform tell(p_world, p_uid, 'The ' || lower(v_gem) || ' will not seat, and you take it out again whole.', 'event');
      return;
    end if;
    if not consume(p_world, p_uid, 'gem', 1, v_it.id) then return; end if;
    update item set extra = array_to_string(array(select g.name from unnest(stones_of(v_circlet)) with ordinality s(n, o)
                                                    join gem_def g on lower(g.name) = s.n order by s.o) || v_gem, ', ')
      where id = v_circlet.id returning * into v_circlet;
    perform skill_raise(p_world, p_uid, 'jewellery', 1);
    perform tell(p_world, p_uid, 'You seat the ' || lower(v_gem) || ' in the circlet and close the claws over it: '
      || coalesce(array_length(stones_of(v_circlet), 1), 0) || ' of its ' || circlet_stones() || ' settings are filled.', 'event');

  -- An Artisan's Glaze: ashes brushed over a fired pot, bowl or jar, or an
  -- amphora, and it never decays after.
  elsif p_action = 'glaze_item' then
    if not glazeable(v_it.def) or coalesce(v_it.mark, '{}'::jsonb) ? 'glaze' or pk(p_world, p_uid, 'glaze_item', 0) <= 0 then return; end if;
    if not consume(p_world, p_uid, 'ash', glaze_ash()::int) then return; end if;
    update item set mark = coalesce(mark, '{}'::jsonb) || '{"glaze": 0}'::jsonb where id = v_it.id returning * into v_it;
    perform skill_raise(p_world, p_uid, 'pottery', 1);
    perform tell(p_world, p_uid, 'You brush an ash glaze over the ' || lower(item_name(v_it)) || ' and it takes. It will not decay now.', 'event');

  -- And a Mender's sealant, which anybody who has some may work over a thing:
  -- it never decays after. A pile takes one for each thing in it.
  elsif p_action = 'seal_item' then
    if v_it.def = 'sealant' or coalesce(v_it.mark, '{}'::jsonb) ? 'seal' then return; end if;
    if not consume(p_world, p_uid, 'sealant', v_it.count) then return; end if;
    update item set mark = coalesce(mark, '{}'::jsonb) || '{"seal": 0}'::jsonb where id = v_it.id returning * into v_it;
    perform skill_raise(p_world, p_uid, 'repair', 0.1);
    perform tell(p_world, p_uid, 'You work the sealant over the ' || lower(item_name(v_it)) || '. It will not decay now.', 'event');

  elsif p_action = 'repair_item' then
    -- A second's work: some of the damage comes out, and a little of the
    -- quality with it — a little, not much, so mending a thing is not the end
    -- of it. More out at a go for a Mender's Big Mend, less quality for each
    -- point of it for Light Touch, and now and then none at all for Clean
    -- Repair, asked only of somebody who has it.
    v_skill := skill_of(p_world, p_uid, 'repair');
    v_healed := least(v_it.dmg, (1.2 + v_skill * 0.1) * pk(p_world, p_uid, 'mend:repair_item', 1));
    v_lost := v_healed * greatest(0.004, 0.03 - v_skill * 0.00026) * pk(p_world, p_uid, 'cost:repair_item', 1);
    v_keep := pk(p_world, p_uid, 'keep:repair_item', 0);
    if v_keep > 0 and random() < v_keep then v_lost := 0; end if;
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

CREATE OR REPLACE FUNCTION public.perform_dig(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; it item; r relic_def; v_skill double precision; v_tool double precision;
        v_part int; v_ql double precision; v_dmg double precision; v_left int; v_new bigint;
        v_missing int[]; v_relic text; v_avg double precision; v_gain double precision; v_fit text;
        /*
         * `v_piece`, not `h`. The seventh time this class has bitten and the
         * first that was not a column name: `h` was the loop variable *and*
         * the alias of `pieces_held(...) h`, so `h.ql` was ambiguous between a
         * record field and a column of the very rows being looped over. Alias
         * every table, prefix every local, and the two can never meet.
         */
        v_piece item;
        v_lectern boolean; v_roll double precision; v_sum double precision;
begin
  if p_action = 'investigate' then
    tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
    perform mark_foraged(p_world, tx, ty, 'dig');
    v_skill := skill_of(p_world, p_uid, 'archaeology');
    v_tool := tool_ql(p_world, p_uid, 'trowel');
    -- More often, up to a higher cap, for a Miner's Keen Trowel.
    if random() > find_chance(v_skill, v_tool, pk(p_world, p_uid, 'find:investigate', 0),
                              pk(p_world, p_uid, 'cap:investigate', find_cap())) then
      -- Half a go here, where the browser's blanket pays a whole one. That
      -- disagreement is older than this change and is left where it is: what
      -- moves today is only what a *failed* go is worth.
      perform skill_raise(p_world, p_uid, 'archaeology', try_gain(false, 0.5));
      perform tell(p_world, p_uid,
        'You go through the soil and turn up nothing but roots and small stones.', 'event');
      return;
    end if;
    perform skill_raise(p_world, p_uid, 'archaeology', try_gain(true, 0.5));
    -- A share of whatever comes up is a bauble, whatever the archaeologist
    -- knows, off one roll (`findKind`): now and again a Bauble of Regret,
    -- whole; otherwise whole but black with age, and good for nothing until
    -- restored.
    v_roll := random();
    if v_roll < regret_share() then
      v_ql := greatest(1, product_ql(v_skill, v_tool) * (0.55 + random() * 0.35));
      v_new := gather(p_world, p_uid, 'bauble_regret', 1, v_ql);
      perform tell(p_world, p_uid, 'Your trowel turns up a Bauble of Regret, whole. It undoes one of your trades, '
        || 'in the Trades window. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
      return;
    end if;
    -- More of them for a Miner's Bauble Hunter, out of the relics' share.
    if v_roll < regret_share() + pk(p_world, p_uid, 'share:bauble', bauble_share()) then
      v_relic := bauble_tier_roll();
      v_ql := greatest(1, product_ql(v_skill, v_tool) * (0.55 + random() * 0.35));
      v_dmg := 18 + random() * 50;
      v_new := gather(p_world, p_uid, 'tarnished_bauble', 1, v_ql, v_relic);
      update item set dmg = v_dmg where id = v_new;
      perform tell(p_world, p_uid, 'Your trowel turns up a tarnished ' || v_relic
        || ' bauble. Restore it to see what it does. (QL ' || to_char(v_ql, 'FM990.0')
        || ', damage ' || to_char(v_dmg, 'FM990') || ')', 'event');
      return;
    end if;
    -- A piece of a relic already begun, now and again, for a Miner's Pieces that Fit.
    if random() < pk(p_world, p_uid, 'fit:relic', 0) then
      select rd.name into v_fit from relic_def rd
       where exists (select 1 from pieces_held(p_world, p_uid, rd.name))
         and coalesce(array_length(parts_missing(p_world, p_uid, rd.name), 1), 0) > 0
       order by random() limit 1;
    end if;
    if v_fit is null and not exists (select 1 from relics_within(v_skill)) then
      perform tell(p_world, p_uid,
        'You turn up a scrap of something worked, but you cannot tell what it was and it crumbles.',
        'event');
      return;
    end if;
    if v_fit is not null then
      select * into r from relic_def where name = v_fit;
    else
      -- The commonplace comes up far more often than the rare, as it did when
      -- it was lost: weighted by difficulty, and the weights are small numbers.
      select sum(1 / (1 + w.difficulty / 12)) into v_sum from relics_within(v_skill) w;
      v_roll := random() * v_sum;
      for r in select * from relics_within(v_skill) loop
        v_roll := v_roll - 1 / (1 + r.difficulty / 12);
        exit when v_roll <= 0;
      end loop;
    end if;
    -- A piece you are still short of, if you are short of any.
    v_missing := parts_missing(p_world, p_uid, r.name);
    if coalesce(array_length(v_missing, 1), 0) > 0 then
      v_part := v_missing[1 + floor(random() * array_length(v_missing, 1))::int];
    else
      v_part := 1 + floor(random() * r.parts)::int;
    end if;
    v_ql := greatest(1, product_ql(v_skill, v_tool) * (0.55 + random() * 0.35));
    -- Nothing comes out of the ground sound.
    v_dmg := 18 + random() * 50;
    v_new := gather(p_world, p_uid, 'fragment', 1, v_ql, r.name || ' ' || v_part || '/' || r.parts);
    update item set dmg = v_dmg where id = v_new;
    v_left := coalesce(array_length(parts_missing(p_world, p_uid, r.name), 1), 0);
    perform tell(p_world, p_uid, 'Your trowel turns up a fragment of ' || r.name || ', piece '
      || v_part || ' of ' || r.parts || '. (QL ' || to_char(v_ql, 'FM990.0')
      || ', damage ' || to_char(v_dmg, 'FM990') || ')'
      || case when v_left > 0 then ' ' || v_left || ' of ' || r.parts || ' still missing.'
              else ' That is all ' || r.parts || ' of them.' end, 'event');
    return;
  end if;

  select * into it from item where world_id = p_world and id = target_item(p_target);
  if not found then return; end if;

  if p_action = 'study_book' then
    -- A lectern holds the pages open at the right angle, and you get
    -- `lectern_gain` times as much out of the hour: within `lectern_reach`,
    -- which the island had as 2.6 where the browser's is 2.4.
    v_lectern := exists (select 1 from placed_near(p_world, p_uid, 'furniture', 'lectern', lectern_reach()));
    -- What it teaches (a trade book its trade), more of it for an Artisan's
    -- Good Read in the binding and less wear on it for their Sturdy Binding.
    v_gain := skill_raise(p_world, p_uid, book_teaches(it),
      (0.5 + it.ql / 90) * case when v_lectern then lectern_gain() else 1 end * mark_of(it.mark, 'teach'));
    perform damage_item(it.id, (study_wear() + random() * study_wear_spread()) * mark_of(it.mark, 'sturdy'));
    perform tell(p_world, p_uid, 'You work through the ' || lower(item_name(it)) || '.'
      || case when v_lectern
              then ' The lectern holds it open at the right angle and you make good use of the hour.'
              else ' Held in one hand, it is hard going. A lectern would be better.' end
      || case when v_gain > 0.0005 then '' else ' There is nothing left in it you do not already know.' end,
      'event');
    return;
  end if;

  if it.def = 'tarnished_bauble' then
    perform restore_bauble(p_world, p_uid, it);
    return;
  end if;

  -- Restoring: every piece in at once, and what comes out is only as good as
  -- the pieces that went in, less what age took.
  v_relic := fragment_relic(it.extra);
  select * into r from relic_def where name = v_relic;
  if not found then return; end if;
  -- Surer for a Mender's Sure Restore, and no harm on a failure for Gentle Hands.
  if not perk_pass(skill_check(skill_of(p_world, p_uid, 'restoration'), r.difficulty, 0,
                               mind_ease(p_world, p_uid)),
                   pk(p_world, p_uid, 'fail:restore_relic', 1)) then
    for v_piece in select * from pieces_held(p_world, p_uid, v_relic) loop
      perform damage_item(v_piece.id, (restore_harm() + random() * restore_harm_spread())
                                      * pk(p_world, p_uid, 'harm:restore_relic', 1));
    end loop;
    perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(false, restore_gain()));
    perform tell(p_world, p_uid, 'The pieces of the ' || r.name
      || case when pk(p_world, p_uid, 'harm:restore_relic', 1) <= 0
              then ' will not sit together, and they take no harm from the trying.'
              else ' will not sit together and you mark them trying.' end, 'event');
    return;
  end if;
  -- The damage on them taking nothing off for Age Undone.
  select avg(h.ql * (1 - h.dmg / restore_age() * pk(p_world, p_uid, 'age:restore_relic', 1))) into v_avg
    from pieces_held(p_world, p_uid, v_relic) h;
  -- And better for Fine Restore.
  v_ql := greatest(1, least(100, v_avg * (0.72 + skill_of(p_world, p_uid, 'restoration') / 260)
                                * pk(p_world, p_uid, 'ql:restore_relic', 1)));
  for v_piece in select * from pieces_held(p_world, p_uid, v_relic) loop
    perform consume(p_world, p_uid, 'fragment', 1, v_piece.id);
  end loop;
  v_new := give(p_world, p_uid, r.result, 1, v_ql);
  perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(true, restore_gain()));
  perform tell(p_world, p_uid, 'The pieces go back together and the ' || r.name || ' is whole: '
    || lower((select item_name(i) from item i where i.id = v_new))
    || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
end $function$;

CREATE OR REPLACE FUNCTION public.dig_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare tx int; ty int; t tile_def; it item; v_relic text; v_missing int[]; r relic_def;
begin
  if p_action = 'investigate' then
    tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
    if tx is null or not in_bounds(p_world, tx, ty) then return 'There is nothing there.'; end if;
    select * into t from tile_def where id = land_tile(p_world, tx, ty);
    if not t.diggable then return 'There is nothing to go through here.'; end if;
    if has_water(p_world, tx, ty) then return 'Not under water.'; end if;
    if pack_count(p_world, p_uid, 'trowel') < 1 then
      return 'You need a trowel to go through the soil carefully.';
    end if;
    if is_foraged(p_world, tx, ty, 'dig') then
      return 'You have been over this ground already. Try somewhere else.';
    end if;
    return null;
  end if;

  select * into it from item where world_id = p_world and id = target_item(p_target)
    and holder = 'player' and holder_uid = p_uid;
  if not found then return 'It is gone.'; end if;

  if p_action = 'study_book' then
    if it.def not in ('book', 'trade_book') then return 'That is not a book.'; end if;
    if it.dmg >= 90 then return 'The pages are too far gone to read. Repair it first.'; end if;
    return null;
  end if;

  if it.def = 'tarnished_bauble' then
    if it.dmg >= 85 then return 'It is too far gone to restore. Repair it first.'; end if;
    return null;
  end if;

  -- Restoring.
  v_relic := fragment_relic(it.extra);
  select * into r from relic_def where name = v_relic;
  if it.def <> 'fragment' or not found then return 'That is not a fragment of anything.'; end if;
  v_missing := parts_missing(p_world, p_uid, v_relic);
  if coalesce(array_length(v_missing, 1), 0) > 0 then
    return 'You are missing ' || array_length(v_missing, 1) || ' of the ' || r.parts
      || ' pieces of the ' || r.name || ' (' || array_to_string(v_missing, ', ') || ').';
  end if;
  if exists (select 1 from pieces_held(p_world, p_uid, v_relic) h where h.dmg >= 85) then
    return 'One of the pieces is too far gone to join. Repair it first.';
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.perform_firing(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_p placed; v_it item; v_mould item; v_metal metal_def; v_need int; v_n int;
        v_secs double precision; v_ql double precision; v_jobs jsonb; v_out jsonb;
        v_one jsonb; v_names text[] := '{}'; v_makes text; v_i int;
        d mould_def; v_mould_ql double precision; v_wear double precision; v_broke boolean;
        v_bar item;
begin
  v_p := target_placed(p_world, p_target);
  if v_p.id is null then return; end if;

  if p_action in ('smelter_take_all', 'kiln_take_all') then
    v_out := furnace_output(v_p);
    for v_one in select * from jsonb_array_elements(v_out) loop
      -- With its shaper's mark, which a pot, a bowl or a jar carries through the fire.
      perform give(p_world, p_uid, v_one->>'def', (v_one->>'count')::int,
        (v_one->>'ql')::double precision, v_one->>'extra', null, null, v_one->>'piece', nullif(v_one->'mark', 'null'::jsonb));
      v_names := v_names || ((case when (v_one->>'count')::int > 1 then (v_one->>'count') || ' × ' else '' end)
        || made_name(v_one->>'def', v_one->>'piece'));
    end loop;
    if array_length(v_names, 1) is null then return; end if;
    update placed set state = jsonb_set(state, '{output}', '[]'::jsonb) where id = v_p.id;
    perform tell(p_world, p_uid, case when p_action = 'kiln_take_all' then 'You unpack ' else 'You draw ' end
      || array_to_string(v_names, ', ')
      || case when p_action = 'kiln_take_all' then ' from the kiln.' else ' from the smelter.' end, 'event');
    return;
  end if;

  select * into v_it from item where id = target_item(p_target);
  v_jobs := furnace_jobs(v_p);

  if p_action = 'smelt_ore' then
    v_metal := metal_by_ore(v_it.def);
    if v_metal.id is null then return; end if;
    /*
     * Charges, not ore. One charge is `ore_per_lump` of it and comes out as one
     * lump, so "all" of a stack of fifty-seven is five charges with seven left
     * over rather than fifty-seven lumps.
     */
    v_n := least(greatest(1, floor(coalesce((p_target->>'count')::int, 1) / ore_per_lump())::int),
                 floor(v_it.count / ore_per_lump())::int,
                 furnace_capacity(v_p) - jsonb_array_length(v_jobs));
    if v_n < 1 then return; end if;
    if not spend_stack(p_world, p_uid, v_it.id, v_n * ore_per_lump()::int) then return; end if;
    v_secs := smelt_seconds(v_metal.id, v_it.ql, v_p.ql);
    for v_i in 1..v_n loop
      v_jobs := v_jobs || jsonb_build_object('makes', v_metal.lump, 'left', v_secs,
        'total', v_secs, 'ql', v_it.ql);
    end loop;
    update placed set state = jsonb_set(coalesce(state, '{}'::jsonb), '{jobs}', v_jobs) where id = v_p.id;
    perform tell(p_world, p_uid, 'You charge the smelter with '
      || (v_n * ore_per_lump()::int) || ' × '
      || lower((select name from item_def where id = v_it.def))
      || case when v_n > 1 then ', ' || v_n || ' charges of it' else '' end
      || '. Each charge is about ' || round(v_secs) || ' seconds of heat and comes out as one lump.', 'event');

  elsif p_action = 'melt_down' then
    v_metal := metal_by_name(v_it.extra);
    if v_metal.id is null or item_metal(v_it) is null then return; end if;
    v_n := least(greatest(1, coalesce((p_target->>'count')::int, 1)), v_it.count);
    -- More of it, and better, for a Smith's Reclaimer.
    v_need := melt_lumps(v_it, v_n, pk(p_world, p_uid, 'melt:share', melt_share()));
    if jsonb_array_length(v_jobs) + v_need > furnace_capacity(v_p) then return; end if;
    v_ql := melt_ql(v_it.ql, v_it.dmg, pk(p_world, p_uid, 'melt:keep', melt_keep()));
    -- Scrap is quicker than ore: it has been through the fire once already.
    v_secs := smelt_seconds(v_metal.id, v_it.ql, v_p.ql) * melt_heat();
    if not spend_stack(p_world, p_uid, v_it.id, v_n) then return; end if;
    for v_i in 1..v_need loop
      v_jobs := v_jobs || jsonb_build_object('makes', v_metal.lump, 'left', v_secs, 'total', v_secs, 'ql', v_ql);
    end loop;
    update placed set state = jsonb_set(coalesce(state, '{}'::jsonb), '{jobs}', v_jobs) where id = v_p.id;
    perform tell(p_world, p_uid, 'You put ' || case when v_n > 1 then v_n || ' × ' else 'the ' end
      || made_name(v_it.def, v_it.piece) || ' into the smelter to melt down.'
      || ' It will come back as ' || v_need || ' ' || lower(v_metal.name) || ' lump'
      || case when v_need > 1 then 's' else '' end || ', at about ' || round(v_ql) || ' quality.', 'event');

  elsif p_action = 'load_kiln' then
    if v_it.id is null then
      select i.* into v_it from craft_stock(p_world, p_uid) s join item i on i.id = s.id
        where exists (select 1 from pottery_def where unfired = s.def) order by s.draw limit 1;
    end if;
    v_makes := (select fired from pottery_def where unfired = v_it.def);
    if v_makes is null then return; end if;
    v_n := greatest(1, least(least(coalesce((p_target->>'count')::int, 1), v_it.count),
      furnace_capacity(v_p) - jsonb_array_length(v_jobs)));
    if not spend_stack(p_world, p_uid, v_it.id, v_n) then return; end if;
    v_secs := fire_seconds(v_it.def, v_p.ql);
    v_ql := fired_ql(v_it.ql, v_p.ql);
    for v_i in 1..v_n loop
      v_jobs := v_jobs || jsonb_build_object('makes', v_makes, 'left', v_secs, 'total', v_secs, 'ql', v_ql, 'mark', v_it.mark);
    end loop;
    update placed set state = jsonb_set(coalesce(state, '{}'::jsonb), '{jobs}', v_jobs) where id = v_p.id;
    perform tell(p_world, p_uid, 'You pack '
      || case when v_n > 1 then v_n || ' × ' else '' end
      || lower((select name from item_def where id = v_it.def))
      || ' into the kiln. Each needs about ' || round(v_secs) || ' seconds of heat.', 'event');

  elsif p_action = 'cast_anvil' then
    v_metal := metal_by_bar(v_it.def);
    v_need := mould_lumps('anvil_mould', v_metal.id);
    select i.* into v_mould from item i where i.world_id = p_world and i.holder = 'player'
      and i.holder_uid = p_uid and i.def = 'anvil_mould' order by i.ql desc limit 1;
    if v_metal.id is null or v_mould.id is null then return; end if;
    -- Bars count as their lumps (a Smith's Ingots): broken into for what it takes.
    if v_it.def <> v_metal.lump then
      if v_it.count * ingot_lumps() < v_need then return; end if;
      v_it := unbar(p_world, p_uid, v_it.id, v_need);
      if v_it.id is null then return; end if;
    end if;
    if v_it.count < v_need then return; end if;
    if not spend_stack(p_world, p_uid, v_it.id, v_need) then return; end if;
    -- The mould is spent by a piece this size, whatever quality it was.
    if not consume(p_world, p_uid, 'anvil_mould', 1, v_mould.id) then return; end if;
    v_ql := greatest(1, least(100, (v_it.ql + v_mould.ql
      + product_ql(skill_of(p_world, p_uid, 'blacksmithing'))) / 3));
    v_secs := cast_seconds(v_metal.id, v_ql);
    -- An anvil remembers what it was poured from; that is what `extra` is for.
    v_jobs := v_jobs || jsonb_build_object('makes', 'anvil', 'left', v_secs, 'total', v_secs,
      'ql', v_ql, 'extra', v_metal.id);
    update placed set state = jsonb_set(coalesce(state, '{}'::jsonb), '{jobs}', v_jobs) where id = v_p.id;
    perform tell(p_world, p_uid, 'You pour ' || v_need || ' lumps of ' || lower(v_metal.name)
      || ' into the anvil mould. It needs about ' || round(v_secs) || ' seconds to cool.', 'event');

  elsif p_action = 'pour_mould' then
    select * into v_mould from item where world_id = p_world and id = target_mould(p_target)
      and holder = 'player' and holder_uid = p_uid;
    select * into d from mould_def where id = v_mould.def;
    v_metal := metal_by_bar(v_it.def);
    if v_mould.id is null or d.id is null or d.makes = 'anvil' or v_metal.id is null then return; end if;
    v_need := mould_lumps(d.id, v_metal.id);
    if jsonb_array_length(v_jobs) >= furnace_capacity(v_p) then return; end if;
    -- Bars count as their lumps (a Smith's Ingots): broken into for what it takes.
    if v_it.def <> v_metal.lump then
      if v_it.count * ingot_lumps() < v_need then return; end if;
      v_it := unbar(p_world, p_uid, v_it.id, v_need);
      if v_it.id is null then return; end if;
    end if;
    if v_it.count < v_need then return; end if;
    if not spend_stack(p_world, p_uid, v_it.id, v_need) then return; end if;
    -- Every filling wears the mould, and a hard metal takes more out of it;
    -- no mould can be mended.
    -- A worn mould pours worse by half its damage, or not at all for a Smith's Clean Pour.
    v_mould_ql := greatest(1, v_mould.ql - v_mould.dmg * pk(p_world, p_uid, 'pour:wear', 0.5));
    -- And a mould its maker marked to last (a Smith's Hard Sand) takes that much less a filling.
    v_wear := mould_wear(v_mould.ql) * (1 + (mat_of(v_metal.name)).difficulty / 30) / mark_of(v_mould.mark, 'last');
    v_broke := v_mould.dmg + v_wear >= 100;
    if v_broke then
      delete from item where id = v_mould.id;
    else
      update item set dmg = least(100, v_mould.dmg + v_wear) where id = v_mould.id;
    end if;
    -- The pour is the smelter's work: the metal, the mould and the hands at the furnace.
    v_ql := greatest(1, least(100, (v_it.ql + v_mould_ql
      + product_ql(skill_of(p_world, p_uid, 'smelting'))) / 3));
    v_secs := pour_seconds(d.id, v_metal.id, v_ql);
    -- A bell or a statue is a casting already and wants no anvil; everything
    -- else comes out as a casting of the piece, for the anvil to beat true.
    v_jobs := v_jobs || case when right(d.makes, 8) = '_casting'
      then jsonb_build_object('makes', d.makes, 'left', v_secs, 'total', v_secs, 'ql', v_ql,
                              'extra', v_metal.name)
      else jsonb_build_object('makes', 'casting', 'left', v_secs, 'total', v_secs, 'ql', v_ql,
                              'extra', v_metal.name, 'piece', d.makes) end;
    update placed set state = jsonb_set(coalesce(state, '{}'::jsonb), '{jobs}', v_jobs) where id = v_p.id;
    perform tell(p_world, p_uid, 'You pour '
      || case when v_need > 1 then v_need || ' lumps' else 'a lump' end
      || ' of ' || lower(v_metal.name) || ' into the ' || lower(d.name)
      || '. It needs about ' || round(v_secs) || ' seconds to cool.'
      || case when v_broke then ' The mould cracks through and is done.'
              else ' The mould has ' || mould_uses_left(v_mould.ql, v_mould.dmg + v_wear, mark_of(v_mould.mark, 'last'))
                   || ' fillings left.' end, 'event');

  elsif p_action = 'pour_ingot' then
    -- A Smith's Ingots: five lumps of one metal into a bar at their quality.
    v_metal := metal_by_lump(v_it.def);
    if v_metal.id is null or pk(p_world, p_uid, 'ingot', 0) <= 0 or v_it.count < ingot_lumps() then return; end if;
    v_bar := v_it;
    if not spend_stack(p_world, p_uid, v_it.id, ingot_lumps()) then return; end if;
    perform give(p_world, p_uid, v_metal.id || '_ingot', 1, v_bar.ql, null, v_bar.rare, v_bar.maker);
    perform tell(p_world, p_uid, 'You pour ' || ingot_lumps() || ' lumps of ' || lower(v_metal.name)
      || ' into an ingot. (QL ' || to_char(v_bar.ql, 'FM990.0') || ')', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.furnace_fold(p_done jsonb, p_job jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare i int; e jsonb; n int; q double precision;
begin
  for i in 0 .. jsonb_array_length(p_done) - 1 loop
    e := p_done->i;
    if e->>'def' = p_job->>'makes'
       and (e->>'extra') is not distinct from (p_job->>'extra')
       and (e->>'piece') is not distinct from (p_job->>'piece')
       and nullif(e->'mark', 'null'::jsonb) is not distinct from nullif(p_job->'mark', 'null'::jsonb)
       and coalesce((select stackable from item_def where id = e->>'def'), false) then
      n := coalesce((e->>'count')::int, 1);
      q := ((e->>'ql')::double precision * n + (p_job->>'ql')::double precision) / (n + 1);
      return jsonb_set(jsonb_set(p_done, array[i::text, 'count'], to_jsonb(n + 1)),
                       array[i::text, 'ql'], to_jsonb(q));
    end if;
  end loop;
  return p_done || jsonb_build_object('def', p_job->>'makes', 'ql', (p_job->>'ql')::double precision,
    'count', 1, 'extra', p_job->>'extra', 'piece', p_job->>'piece', 'mark', nullif(p_job->'mark', 'null'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.skill_mult(p_world uuid, p_uid uuid, p_id text)
 RETURNS double precision
 LANGUAGE plpgsql
 STABLE
AS $function$
declare p player; m double precision;
begin
  select * into p from player where world_id = p_world and uid = p_uid;
  if not found then return 1; end if;
  m := case when coalesce(p.rested, 0) > 0 then rest_mult() else 1 end;
  -- A knack earned on the way up never wears off, unlike a meal or a night's sleep.
  m := m + knack_bonus((p.knacks->>p_id)::int);
  -- And the stones you wear, a jewel's and a circlet's, on the trades they favour.
  m := m + jewel_gain(worn(p_world, p_uid, 'jewel'), p_id) + jewel_gain(worn(p_world, p_uid, 'head'), p_id);
  -- And the reader's path is a tenth on everything, for good.
  if p_id <> meditation_skill() and walks(p_world, p_uid, 'knowledge', 1) then m := m + 0.1; end if;
  -- A full table, worth a fifth, or more to a Cook with Balanced Diet.
  m := m * table_mul(p.nutrition, greatest(table_best(), pk(coalesce(p.class_mul, '{}'::jsonb), 'table:best', table_best())));
  -- And the dish that favours this one, while it lasts.
  m := m + coalesce((select sum((b->>'bonus')::double precision)
                       from jsonb_array_elements(coalesce(p.boons, '[]'::jsonb)) b
                      where b->>'skill' = p_id
                        and (b->>'until')::double precision > world_time(p_world)), 0);
  /*
   * And the tree, which is the last thing on and the only one that is not the
   * same for everybody with the same sheet.
   *
   * Free here, and that is why learning is wired here rather than in
   * `skill_raise`: this function already has the row in hand, and the fold
   * kept on it is a product somebody else worked out. It tells only on the
   * skills the trade covers -- the check is inside `class_mul` -- so a smith's
   * forge sense is worth nothing at a loom.
   */
  m := m * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'learn', p_id);
  -- And a bauble for the trade in the altar of the settlement you are working on.
  return greatest(0.01, m) * bauble_learn(p_world, p_uid, p_id);
end $function$;

CREATE OR REPLACE FUNCTION public.slot_of(p_def text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(
    (select slot from armour_def where id = p_def),
    (select 'weapon' from weapon_def where id = p_def),
    (select 'offhand' from shield_def where id = p_def),
    (select 'jewel' from jewel_def where id = p_def),
    case when p_def = 'toolbelt' then 'belt' when p_def = 'circlet' then 'head' end)
$function$;

CREATE OR REPLACE FUNCTION public.maybe_gem(p_world uuid, p_uid uuid, p_skill double precision, p_tool_ql double precision)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_gem text; v_ql double precision;
begin
  -- Or what a perk for this job makes it: a Miner's Gem Eye.
  if random() >= coalesce(pkx('gem:' || pkx_act(), gem_odds()), gem_odds()) then return; end if;
  -- Out of every stone there is for an Artisan with More Stones, and the rest for everybody.
  v_gem := roll_gem(pk(p_world, p_uid, 'more_stones', 0) > 0);
  v_ql := product_ql(p_skill, p_tool_ql);
  perform gather(p_world, p_uid, 'gem', 1, v_ql, v_gem);
  perform tell(p_world, p_uid, 'Something glints in the rubble: a ' || lower(v_gem) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
end $function$;

CREATE OR REPLACE FUNCTION public.spell_wear(p_world uuid, p_uid uuid, d spell_def, it item)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select greatest(0.2, d.wear * (1.6 - coalesce(it.ql, 1) / 125.0) / rarity_boost(it.rare)
    * land_ease(p_world, floor((select x from player where world_id = p_world and uid = p_uid))::int,
                        floor((select y from player where world_id = p_world and uid = p_uid))::int)
    * class_mul(p_world, p_uid, 'thrift', (select skill from school_def where id = d.school))
    -- Less for its setter's Focus Cutter, whoever casts.
    * mark_of(it.mark, 'thrift'))
$function$;

CREATE OR REPLACE FUNCTION public.spell_force(p_world uuid, p_uid uuid, d spell_def, it item)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select d.power
    * (0.45 + skill_of(p_world, p_uid, (select skill from school_def where id = d.school)) / 110.0)
    * (0.7 + coalesce(it.ql, 1) / 170.0)
    * class_mul(p_world, p_uid, 'force', (select skill from school_def where id = d.school))
    -- More for its setter's Keen Focus, whoever casts.
    * mark_of(it.mark, 'force')
$function$;

CREATE OR REPLACE FUNCTION public.do_spell(p_world uuid, p_uid uuid, p_spell text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare d spell_def; p player; it item; v_force double precision; v_secs double precision;
        v_rng double precision; v_n int := 0; c creature; r record; v_name text;
        v_cx double precision; v_cy double precision;
begin
  select * into d from spell_def where id = p_spell;
  select * into p from player where world_id = p_world and uid = p_uid;
  it := focus_for(p_world, p_uid, d.gem);
  v_force := spell_force(p_world, p_uid, d, it);
  -- And a hold the longer for the focus setter's Keen Focus.
  v_secs := spell_secs(p_world, p_uid, d) * mark_of(it.mark, 'force');
  v_rng := spell_range(p_world, p_uid, d);
  v_name := 'it';

  if d.school = 'kindling' then
    if d.at_what = 'creature' then
      select * into c from creature where world_id = p_world and id = (p_target->>'id')::int;
      if not found then return 'There is nothing there.'; end if;
      v_name := lower((select name from species_def where id = c.species));
      perform wound_beast(p_world, c.id, v_force, p.x, p.y, p_uid, null);
      v_n := round(v_force);
    else
      for c in select * from creature where world_id = p_world and mode = 'wild'
          and to_x between p.x - v_rng and p.x + v_rng
          and to_y between p.y - v_rng and p.y + v_rng loop
        perform wound_beast(p_world, c.id, v_force, p.x, p.y, p_uid, null);
        v_n := v_n + 1;
      end loop;
    end if;

  elsif d.school = 'binding' then
    /*
     * A hold is the `until` the clock already reads before it settles an
     * animal: set it forward and the animal is simply not due, which is what
     * standing still is here. The leg it was on is ended where it had got to,
     * so it stops rather than sliding on to wherever it was going.
     */
    if d.at_what = 'creature' then
      select * into c from creature where world_id = p_world and id = (p_target->>'id')::int;
      if not found then return 'There is nothing there.'; end if;
      v_name := lower((select name from species_def where id = c.species));
      v_cx := creature_x(c); v_cy := creature_y(c);
      update creature set until = now() + make_interval(secs => v_secs),
             from_x = v_cx, from_y = v_cy, to_x = v_cx, to_y = v_cy,
             leg_at = now(), leg_ends = now(), enemy = null, hunting = null
        where world_id = p_world and id = c.id;
      v_n := round(v_secs);
    else
      for c in select * from creature where world_id = p_world and mode = 'wild'
          and to_x between p.x - v_rng and p.x + v_rng
          and to_y between p.y - v_rng and p.y + v_rng loop
        v_cx := creature_x(c); v_cy := creature_y(c);
        update creature set until = now() + make_interval(secs => v_secs),
               from_x = v_cx, from_y = v_cy, to_x = v_cx, to_y = v_cy,
               leg_at = now(), leg_ends = now(), enemy = null, hunting = null
          where world_id = p_world and id = c.id;
        v_n := v_n + 1;
      end loop;
    end if;

  else
    -- Warding. The greater of what is already over you and what this would put
    -- there, so casting it again refreshes the skin rather than stacking one
    -- inside another.
    if d.at_what = 'self' then
      update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{aegis}',
          to_jsonb(greatest(coalesce((stats->>'aegis')::double precision, 0), v_force)))
        where world_id = p_world and uid = p_uid;
      v_n := round(v_force);
    else
      for r in select uid from player where world_id = p_world and not away
          and x between p.x - v_rng and p.x + v_rng
          and y between p.y - v_rng and p.y + v_rng loop
        update player set stats = jsonb_set(coalesce(stats, '{}'::jsonb), '{aegis}',
            to_jsonb(greatest(coalesce((stats->>'aegis')::double precision, 0), v_force)))
          where world_id = p_world and uid = r.uid;
        if r.uid <> p_uid then
          perform tell(p_world, r.uid, 'Something closes over you, put there by somebody else.', 'system');
        end if;
        v_n := v_n + 1;
      end loop;
    end if;
  end if;

  return replace(replace(d.done, '{n}', v_n::text), '{t}', v_name);
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_act(p_world uuid, p_action text, p_target jsonb, p_times integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); d action_def; p player; why text; secs double precision;
        s double precision; tq double precision; cap int; room int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if too_fast(me) then raise exception 'you are asking too quickly; slow down'; end if;
  perform settle(p_world, me);
  why := act_refusal(p_world, me, p_action, p_target);
  if why is not null then
    perform tell(p_world, me, why, 'error');
    return jsonb_build_object('started', false, 'why', why);
  end if;
  select * into d from action_def where id = p_action;
  select * into p from player where world_id = p_world and uid = me for update;

  -- Something already in hand: line this one up behind it rather than drop it.
  if p.act is not null then
    cap := queue_capacity(p_world, me);
    room := cap - 1 - jsonb_array_length(p.act_queue);
    if room <= 0 then
      why := 'You can only keep ' || cap || ' jobs in your head at once. Mind logic is what widens that.';
      perform tell(p_world, me, why, 'error');
      return jsonb_build_object('started', false, 'queued', false, 'why', why);
    end if;
    /*
     * And what the thing *was*, for a job that may outlive the row it names.
     *
     * Stamped now rather than worked out later, because later is exactly when
     * it cannot be: once `consume` has deleted the last of a stack there is
     * nothing left to ask what kind of thing it had been.
     */
    update player set act_queue = act_queue || (jsonb_build_object(
        'action', p_action, 'target', p_target, 'goes', greatest(1, least(100, coalesce(p_times, 1))))
        || coalesce((select jsonb_build_object('was', i.def) from item i
                      where i.id = target_item(p_target) and i.world_id = p_world), '{}'::jsonb))
      where world_id = p_world and uid = me returning * into p;
    perform tell(p_world, me, d.label || ' is next, ' || jsonb_array_length(p.act_queue) + 1 || ' of ' || cap || ' in hand.', 'info');
    /*
     * And what is in the head now, not just how much of it.
     *
     * The bar drew its queue from `rpc_settle` and nothing else, and
     * `rpc_settle` runs on the heartbeat and when a job comes due — never when
     * one is *added*. So asking for a third job while two were running left the
     * bar saying "2 of 3" until the job in hand finished, at which point one
     * came off the queue and it said "2 of 3" again. Reported as never changing
     * from 2/3 to 3/3, which is exactly what it did: it was always one behind,
     * and topping the queue up kept it there.
     *
     * The answer to the ask is where the browser should hear about what the ask
     * did, so it says so here rather than waiting to be asked again.
     */
    return held_now(p_world, me) || jsonb_build_object('started', false, 'queued', true,
      'inHand', jsonb_array_length(p.act_queue) + 1, 'capacity', cap,
      'queue', coalesce((select jsonb_agg(jsonb_build_object(
                           'action', q->>'action',
                           'goes', greatest(1, coalesce((q->>'goes')::int, 1))) order by o)
                         from jsonb_array_elements(p.act_queue) with ordinality t(q, o)), '[]'::jsonb));
  end if;

  s := case when d.skill is null then 50 else skill_of(p_world, me, d.skill) end;
  -- The tool at what it counts at: a Farmer's Worn-in Rake counts the rake better.
  tq := job_tool_ql(coalesce(p.class_mul, '{}'::jsonb), p_world, me, p_action, d.tool);
  -- Every other job has a floor of a second or so under it; an instant one has
  -- no duration to put a floor under, and act_duration would give it one.
  secs := case when d.instant then 0
               else act_duration(d.base_time, s, tq, control_speed(p_world, me)
                 * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands',
                             act_scope(p_world, me, d.skill)) * bauble_pace(p_world, me, d.skill))
                 -- And what a perk makes of this job's time: a Terraformer's Quick Level,
                 -- a Mason's Quick Mason on stone. After the floor, so that it says
                 -- what it does of a job already down on it (a Mender's Quick Hands).
                 * perk_time(coalesce(p.class_mul, '{}'::jsonb), p_world, p_action, p_target)
                 -- And a piece standing near that speeds the trade: an Artisan's potter's wheel.
                 * piece_pace(p_world, me, d.skill) end;
  update player set
      act = p_action, act_target = p_target, act_started = now(),
      act_ends = now() + make_interval(secs => secs),
      act_left = greatest(1, least(100, coalesce(p_times, 1))),
      act_goes = greatest(1, least(100, coalesce(p_times, 1))), seen_at = now(), away = false
    where world_id = p_world and uid = me;
  /*
   * And what the ask left you holding, said in the answer to the ask.
   *
   * Reported as inventory rubberbanding: a thing put in a crate turns up in
   * the crate and stays in the pack as well, for up to the twenty seconds
   * until the next reconcile, and then goes. Two causes with one shape —
   * nothing ever tells a browser that a thing has *left* its hands.
   *
   * `item` is published with the default replica identity, so a DELETE carries
   * the primary key and nothing else, and the browser's Realtime filter is
   * `holder_uid = me`: a row carrying only an `id` cannot match it. Putting a
   * whole stack in a crate deletes the row, so nothing is said. And a thing
   * that goes to the ground, or to somebody else, has `holder_uid` set to
   * null, so the *new* row does not match the filter either. Realtime carries
   * every arrival and no departure, and `refresh_pack` on the twenty-second
   * reconcile was the only thing that ever noticed.
   *
   * Said at each return rather than worked out once at the top, because for an
   * instant ask the work happens in the `settle` three lines below this — a
   * value built any earlier is the pack as it was before the thing moved,
   * which is the very answer that was wrong.
   */
  if d.instant then
    perform settle(p_world, me);
    return held_now(p_world, me) || jsonb_build_object('started', true, 'done', true, 'seconds', 0);
  end if;
  perform tell(p_world, me, 'You start ' || d.verb || '.', 'info');
  return held_now(p_world, me)
      || jsonb_build_object('started', true, 'ends', now() + make_interval(secs => secs), 'seconds', secs);
end $function$;

CREATE OR REPLACE FUNCTION public.settle(p_world uuid, p_uid uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare p player; d action_def; done int := 0; guard int := 0; nxt jsonb; ended timestamptz;
        v_err text; v_state text; v_where text;
begin
  /*
   * One body's work, and nobody else's.
   *
   * Everything below used to run bare, and `world_tick` settles every body on
   * every island in one transaction: one go that raised an error took the
   * whole round down with it, every second, for as long as that job was
   * still due. Reported as "something just broke, no actions are working":
   * `take_spoil` set the last spadeful in a cart to a count of 0, which the
   * item table refuses, and for a quarter of an hour nothing anybody did on
   * the island finished.
   *
   * So the goes run in a block of their own. A fault undoes what the block
   * had done -- the goes that had come due in this call, and nothing else --
   * stops that job and the queue behind it, tells its owner what the island
   * said, and is kept in `private.tick_fault` for the deploy to report. A
   * deadlock, a lock that timed out or a serialization failure is not a
   * fault in the job: those are raised as before, and the job is tried again
   * next round. A statement timeout is not caught by `others` at all.
   */
  begin
    perform wounds_settle(p_world, p_uid);
    perform body_settle(p_world, p_uid);
    select * into p from player where world_id = p_world and uid = p_uid for update;
    if not found or p.act is null then return 0; end if;
    /*
     * Twenty-five goes to a call, not two hundred.
     *
     * This is the one way a round of the clock can run long: somebody back from
     * an hour away is owed hundreds of goes, and at two hundred apiece — inside
     * `tick_players` inside `tick_worlds` — one person's backlog is the whole
     * tick. It mattered less at five seconds. It matters at one.
     *
     * Nothing is lost by taking less at a time: what is still due is still due,
     * and there is another round a second from now, plus the browser's own beat
     * the moment its job comes up. A backlog drains in seconds either way; the
     * difference is whether everybody else waits while it does.
     */
    while p.act is not null and p.act_ends <= now() and guard < 25 loop
      guard := guard + 1;
      -- A go, for what the baubles make of its yield (`bauble_yield`), and
      -- what they made of it said after the go has said its own piece.
      perform set_config('wurm.bauble_go', 'go', true);
      perform set_config('wurm.bauble_made', '', true);
      -- And the perks, for the rules too deep to be handed the body: for
      -- this go and no other (`pkx`), cleared the moment it is done.
      perform set_config('wurm.pk', coalesce(p.class_mul->'fx', '{}'::jsonb)::text, true);
      perform set_config('wurm.pk_act', p.act, true);
      perform act_perform(p_world, p_uid, p.act, p.act_target);
      perform set_config('wurm.pk', '', true);
      perform set_config('wurm.pk_act', '', true);
      perform bauble_said(p_world, p_uid);
      -- And what the go took out of you, which nothing over here had ever
      -- charged: `action_def.stamina` was a column no function read.
      perform spend_wind(p_world, p_uid, p.act);
      done := done + 1;
      select * into d from action_def where id = p.act;
      ended := p.act_ends;
      if p.act_left > 1 and act_refusal(p_world, p_uid, p.act, p.act_target) is null then
        update player set act_left = act_left - 1, act_started = ended,
               act_ends = ended + make_interval(secs => act_duration(
                 d.base_time,
                 case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end,
                 job_tool_ql(coalesce(p.class_mul, '{}'::jsonb), p_world, p_uid, d.id, d.tool),
                 -- The body's own pace, and then the trade's, which tells only
                 -- on the skill this job is done with.
                 control_speed(p_world, p_uid)
                   * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands',
                               act_scope(p_world, p_uid, d.skill)) * bauble_pace(p_world, p_uid, d.skill))
                 -- And a perk on the job's time, after the floor.
                 * perk_time(coalesce(p.class_mul, '{}'::jsonb), p_world, d.id, p.act_target)
                 * piece_pace(p_world, p_uid, d.skill))
          where world_id = p_world and uid = p_uid returning * into p;
      else
        if p.act_left > 1 then
          -- Why, when there is a why. A run of goes that stops because the wind
          -- gave out should say so rather than leave somebody wondering what
          -- they did wrong, which is what the browser has always said.
          perform tell(p_world, p_uid,
            coalesce(act_refusal(p_world, p_uid, p.act, p.act_target) || ' That was '
                     || (coalesce(p.act_left, 1)) || ' to go.',
                     'You stop ' || d.verb || '.'), 'info');
        end if;
        /*
         * The next job in the line, or the first one behind it that can be done.
         *
         * Reported: "queued up multiple chopping actions, then after the tree
         * was felled and no actions were running I'd dig up the stump and it
         * would show a cutting action following that I didn't queue." The
         * second chop, popped once the tree was down, was refused and put out of
         * the line — and the third stayed in it, behind an empty hand, until the
         * next thing asked for was done and it came up as "then". A refusal puts
         * that job out of the line and asks the next, as the browser's
         * `nextInQueue` has always done, until one starts or the line is empty.
         */
        loop
          nxt := p.act_queue -> 0;
          -- Another onion will do. See `act_retarget`: only when the row it named
          -- has gone, and only to another of what it was.
          nxt := act_retarget(p_world, p_uid, nxt);
          if nxt is null then
            update player set act = null, act_target = null, act_started = null, act_ends = null,
                   act_left = null, act_goes = null
              where world_id = p_world and uid = p_uid returning * into p;
            exit;
          end if;
          select * into d from action_def where id = nxt->>'action';
          if d is null or act_refusal(p_world, p_uid, nxt->>'action', nxt->'target') is not null then
            perform tell(p_world, p_uid,
              coalesce(act_refusal(p_world, p_uid, nxt->>'action', nxt->'target'), 'That cannot be done now.'), 'error');
            update player set act = null, act_target = null, act_started = null, act_ends = null,
                   act_left = null, act_goes = null, act_queue = act_queue - 0
              where world_id = p_world and uid = p_uid returning * into p;
            -- And the one behind it.
          else
            update player set act = nxt->>'action', act_target = nxt->'target',
                   act_left = greatest(1, coalesce((nxt->>'goes')::int, 1)),
                   -- What was asked for, carried out of the queue with the job.
                   -- Without it the browser was left holding the count of
                   -- whatever ran *before* this one, and the bar drew "3 of 10"
                   -- off two numbers from different jobs.
                   act_goes = greatest(1, coalesce((nxt->>'goes')::int, 1)),
                   act_started = ended,
                   act_ends = ended + make_interval(secs => act_duration(
                     d.base_time,
                     case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end,
                     job_tool_ql(coalesce(p.class_mul, '{}'::jsonb), p_world, p_uid, d.id, d.tool),
                     control_speed(p_world, p_uid)
                       * class_mul(coalesce(p.class_mul, '{}'::jsonb), 'hands',
                                   act_scope(p_world, p_uid, d.skill)) * bauble_pace(p_world, p_uid, d.skill))
                     * perk_time(coalesce(p.class_mul, '{}'::jsonb), p_world, d.id, nxt->'target')
                     * piece_pace(p_world, p_uid, d.skill)),
                   act_queue = act_queue - 0
              where world_id = p_world and uid = p_uid returning * into p;
            perform tell(p_world, p_uid, 'You start ' || d.verb || '.', 'info');
            exit;
          end if;
        end loop;
      end if;
    end loop;
    return done;
  exception
    when deadlock_detected or lock_not_available or serialization_failure then raise;
    when others then
      get stacked diagnostics v_err = message_text, v_state = returned_sqlstate, v_where = pg_exception_context;
      perform settle_fault(p_world, p_uid, v_err, v_state, v_where);
      return 0;
  end;
end $function$;

CREATE OR REPLACE FUNCTION public.ground_sweep(p_world uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare v_n int; v_gone bigint[];
begin
  with due as (
    select i.id, i.rot_at, i.gx, i.gy, i.def from item i
     where i.world_id = p_world and i.holder = 'ground'
       and coalesce(i.rot_at, '-infinity'::timestamptz) <= now() - ground_step()
     -- No tie-break on id: it would cost the ordered index scan, and rows
     -- sharing a moment are equally due.
     order by coalesce(i.rot_at, '-infinity'::timestamptz)
     limit ground_rows()
  ),
  /*
   * What is in a bag lying there ages with it, over the same span, at the
   * share of the weather the bag keeps off (`shelter`): what the browser has
   * always done, and the island never did.
   */
  held as (
    update item h set dmg = least(100, h.dmg + ground_decay_rate(h) * decay_multiplier(p_world, due.gx, due.gy)
                                   * d.shelter * extract(epoch from (now() - due.rot_at)) / 3600)
      from due join item_def d on d.id = due.def
     where h.inside = due.id and h.holder = 'bag' and due.rot_at is not null and d.shelter is not null
    returning h.id, h.dmg
  ),
  charged as (
    update item i set
        dmg = least(100, i.dmg + case when i.rot_at is null then 0
                     else ground_decay_rate(i) * decay_multiplier(p_world, i.gx, i.gy)
                          * extract(epoch from (now() - i.rot_at)) / 3600 end),
        rot_at = now()
      from due where i.id = due.id
    returning i.id
  )
  select (select count(*) from charged), (select array_agg(id) from held where dmg >= 100) into v_n, v_gone;
  delete from item where world_id = p_world and holder = 'ground' and dmg >= 100;
  -- And what has rotted away in a bag on the ground, which is only ever what was just charged.
  if v_gone is not null then delete from item where id = any(v_gone); end if;
  -- And the graves whose hour is up, which go the same way and on the same round.
  perform grave_sweep(p_world);
  return v_n;
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
      -- Its clock started afresh, as a part split off a pile has always had it:
      -- nothing rots in a pack, so nothing is charged for the time spent there.
      update item set holder = 'ground', holder_uid = null, gx = floor(p.x)::int, gy = floor(p.y)::int,
          locked = false, made_at = now(), cool = v_cool, rot_at = null
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

CREATE OR REPLACE FUNCTION public.bag_refuses(p_bag item, p_def text, p_count integer)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select case
    when not is_bag(p_bag.def) then 'A ' || lower((select name from item_def where id = p_bag.def))
      || ' does not hold things.'
    when is_bag(p_def) then 'One bag will not go inside another.'
    -- An Artisan's amphora: food and drink, and one kind of it at a time.
    when (select one_kind from item_def where id = p_bag.def)
         and coalesce((select category from item_def where id = p_def), '') <> 'food' then
      case when lower((select name from item_def where id = p_bag.def)) ~ '^[aeiou]' then 'An ' else 'A ' end
        || lower((select name from item_def where id = p_bag.def)) || ' holds food and drink, and nothing else.'
    when (select one_kind from item_def where id = p_bag.def)
         and exists (select 1 from item i where i.inside = p_bag.id and i.holder = 'bag' and i.def <> p_def) then
      'The ' || lower((select name from item_def where id = p_bag.def)) || ' has '
        || lower((select d.name from item i join item_def d on d.id = i.def
                   where i.inside = p_bag.id and i.holder = 'bag' order by i.id limit 1))
        || ' in it, and holds one kind of thing at a time.'
    when bag_units(p_bag.id) + p_count > bag_room(p_bag) then
      'The ' || lower((select name from item_def where id = p_bag.def)) || ' is full.'
    end
$function$;

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
    'catch', p_mul->'fx'->('catch:' || p_def),
    'seal', p_mul->'fx'->('seal:' || p_def),
    'bright', p_mul->'fx'->('bright:' || p_def),
    'cut', p_mul->'fx'->('cut:' || p_def),
    'thrift', p_mul->'fx'->('thrift:' || p_def),
    'force', p_mul->'fx'->('force:' || p_def),
    'serve', p_mul->'fx'->('serve:' || p_def),
    'keeps', p_mul->'fx'->('keeps:' || p_def),
    'glaze', p_mul->'fx'->('glaze:' || p_def),
    'teach', p_mul->'fx'->('teach:' || p_def),
    'sturdy', p_mul->'fx'->('sturdy:' || p_def))), '{}'::jsonb)
$function$;

CREATE OR REPLACE FUNCTION public.mark_says(p_mark jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case when count(*) = 0 then ''
              else ' Its maker''s hand is in it: it ' || list_of(array_agg(s.say order by s.ord)) || '.' end
         -- A seal is whoever sealed it, not the maker, and is said on its own.
         || case when p_mark ? 'seal' then ' It is sealed and never decays.' else '' end
         -- And a glaze the same way.
         || case when p_mark ? 'glaze' then ' It is glazed and never decays.' else '' end
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
        when 'bright' then 'gives ' || round(((m - 1) * 100)::numeric)::int || '% more than a plain setting on its stone''s trade'
        when 'cut' then 'adds up to ' || round((m * 100)::numeric)::int || '% more skill from every go at its stone''s trade, by its quality'
        when 'thrift' then 'wears ' || round(((1 - m) * 100)::numeric)::int || '% slower when a spell is cast from it'
        when 'force' then 'makes a spell cast from it ' || round(((m - 1) * 100)::numeric)::int || '% stronger, and a hold '
                          || round(((m - 1) * 100)::numeric)::int || '% longer'
        when 'serve' then 'gives ' || rtrim(to_char(m, 'FM9999990.999999'), '.') || ' more '
                          || case when m = 1 then 'serving' else 'servings' end || ' of a dish cooked in it'
        when 'keeps' then 'keeps what is put up in it ' || times_said(1 / m) || ' as long'
        when 'teach' then 'teaches ' || round(((m - 1) * 100)::numeric)::int || '% more'
        when 'sturdy' then 'takes ' || round(((1 - m) * 100)::numeric)::int || '% less damage when studied'
      end as say
    from unnest(array['hold', 'speed', 'damage', 'range', 'soak', 'aim', 'last', 'temper',
                      'feed', 'fill', 'knack', 'rot', 'catch',
                      'bright', 'cut', 'thrift', 'force', 'serve', 'keeps', 'teach', 'sturdy']) with ordinality f(fam, ord),
         lateral (select (p_mark->>f.fam)::double precision as m) v
    where p_mark ? f.fam
  ) s
$function$;

CREATE OR REPLACE FUNCTION public.ground_decay_rate(it item)
 RETURNS double precision
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(d.decay, (select c.per_hour from category_decay c where c.category = d.category), 12)
       * greatest(0.3, 1.4 - it.ql / 120)
       * coalesce((select m.decay from material_def m where m.id = it.extra), 1)
       * rarity_keep(it.rare)
       -- Slower for its maker's hand in it (a Cook's Long-lasting), and for
       -- the hand that set it down (a Cook's Cool Pack); not at all for a
       -- Mender's sealant on it.
       * mark_of(it.mark, 'rot') * mark_of(it.mark, 'seal') * mark_of(it.mark, 'glaze') * coalesce(it.cool, 1)
    from item_def d where d.id = it.def
$function$;


/*
 * The Artisan's tree, cleared, as the thirteen before it were: its nodes left
 * `class_node` with the rulebook that brought its perks, whatever of them
 * anybody had taken goes, and every Artisan's fold is written again. No craft
 * trade has a tree now.
 */
delete from player_node where node ~ '^artisan_[0-9]_[0-9]$';
do $$
declare r record;
begin
  for r in select world_id, uid from player where craft_class = 'artisan' loop
    perform class_fold(r.world_id, r.uid);
  end loop;
end $$;

revoke all on function stones_of(item) from public, anon, authenticated;
revoke all on function jewel_gain(item, text) from public, anon, authenticated;
revoke all on function is_dish(text) from public, anon, authenticated;
revoke all on function piece_pace(uuid, uuid, text) from public, anon, authenticated;
revoke all on function book_teaches(item) from public, anon, authenticated;
revoke all on function circlet_with_room(uuid, uuid) from public, anon, authenticated;
revoke all on function roll_gem(boolean) from public, anon, authenticated;
select private.lock_doors();
