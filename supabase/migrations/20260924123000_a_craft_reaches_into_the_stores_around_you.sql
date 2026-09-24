-- A craft reaches into the stores around you
--
-- Asked for: "When crafting, allow the ingredients to be used from any
-- container within 3 tiles."
--
-- A craft spent what was loose in your hands and nothing else. `pack_count`
-- said whether it could go, `consume` used it up, `craft_material` said what
-- it was made of, and each of them was `holder = 'player' and holder_uid =
-- p_uid` written out inline. So a crate of logs at your elbow had to be
-- emptied into your pack before a saw would touch any of it, and the logs in
-- the satchel on your back did not count at all.
--
-- `craft_stock` is that lookup once, reaching further: the pack, then the bags
-- you are carrying, then every crate and every piece of furniture that holds
-- things within `craft_reach()` tiles of the tile you stand on, nearest first
-- -- which is the order a craft spends them in. The four places a craft looks
-- at what it has ask it now instead of the pack: whether it can go
-- (`craft_refusal`), what it is made of (`craft_material`), what its parts are
-- worth (`perform_craft`, for the things made out of their parts) and what it
-- uses up (`craft_consume`). `consume` itself is left alone: forty other
-- performers spend through it, and every one of them means your hands.
--
-- Within reach is measured the way every job's reach is, tile to tile along
-- each side, so it is the square seven tiles across with you in the middle.
-- And it reaches only where a hand could:
--
--   * a crate that is `crate_yours` -- set down by you, from before crates had
--     owners, or standing on a settlement of yours;
--   * a piece set down by you, or standing on a settlement of yours, which is
--     the same question asked of a piece;
--   * never through a padlock you have no key to: a craft is not a way round
--     a lock;
--   * never into a trash crate, whose contents are on their way out, nor a
--     stall, whose wares are for sale; and never anything put by, priced for
--     sale, in the post or held out for a deal, wherever it is lying -- the
--     same four `worker_feed` will not touch.
--
-- The browser lists the same stock, in the same order, in `Game.craftStock`,
-- and the crafting window counts off it.
--
-- And `perform_craft` is put back together while it is open. The last
-- migration to replace it, `a_pickaxe_is_its_head`, started from the first
-- version of it rather than the last, and took out seven things it never
-- meant to touch -- among them everything a failed go teaches. The suite has
-- said so since (`taught.ts`, `tree.ts`) and nobody heard it, because a step
-- before them in CI was failing too. See the note on the function.
--
-- One thing follows from a craft reaching past the pack. A run of goes is
-- aimed at one stack, and with the stores counted in, the stack it was started
-- on is often not the only pile of the thing: two logs in the pack and a
-- crate of them beside you. When a go uses up the stack the run was aimed at,
-- the run carries on with the next pile of the same thing, in the same wood or
-- metal, rather than falling back to whatever `craft_material` would choose
-- from scratch -- so twenty oak planks asked for are twenty oak planks.

/**
 * Everything a craft may spend, and the order it spends it in: `draw`
 * counts up through the pack, then the bags on your back, then the stores
 * within reach, nearest first and a crate before a piece at the same
 * distance.
 */
create or replace function craft_stock(p_world uuid, p_uid uuid)
  returns table (id bigint, def text, count int, extra text, ql real, carried boolean, draw bigint)
  language sql stable as $fn$
  with me as (
    select p.x, p.y, floor(p.x)::int as tx, floor(p.y)::int as ty
      from player p where p.world_id = p_world and p.uid = p_uid
  ),
  crates as materialized (
    select c.id, sqrt((crate_centre_x(c) - me.x) ^ 2 + (crate_centre_y(c) - me.y) ^ 2) as d
      from crate c, me
     where c.world_id = p_world
       and c.x between me.tx - craft_reach() and me.tx + craft_reach()
       and c.y between me.ty - craft_reach() and me.ty + craft_reach()
       and crate_yours(p_world, p_uid, c.id)
       and not lock_shut(p_world, p_uid, c.lock, c.x, c.y)
  ),
  pieces as materialized (
    select pl.id, sqrt((pl.cx - me.x) ^ 2 + (pl.cy - me.y) ^ 2) as d
      from placed pl join furniture_def f on f.id = pl.sub, me
     where pl.world_id = p_world and pl.kind = 'furniture'
       and pl.x between me.tx - craft_reach() and me.tx + craft_reach()
       and pl.y between me.ty - craft_reach() and me.ty + craft_reach()
       and furniture_holds(pl)
       and coalesce(f.trash, 0) = 0 and not f.stall
       and (pl.made_by = p_uid or on_my_deed(p_world, p_uid, pl.x, pl.y))
       and not lock_shut(p_world, p_uid, pl.lock, pl.x, pl.y)
  ),
  stock as (
    -- Loose in your hands.
    select i.id, i.def, i.count, i.extra, i.ql, true as carried,
           0 as rank, 0::double precision as d, 0 as kind, 0::bigint as store
      from item i
     where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
       and not i.locked and i.deal is null
    union all
    -- In a bag you are carrying: `carried`, the lookup `in_the_bag` made.
    select i.id, i.def, i.count, i.extra, i.ql, true, 1, 0, 0, b.id
      from item b join item i on i.inside = b.id and i.holder = 'bag'
     where b.world_id = p_world and b.holder = 'player' and b.holder_uid = p_uid
       and not i.locked and i.deal is null
    union all
    select i.id, i.def, i.count, i.extra, i.ql, false, 2, c.d, 0, c.id::bigint
      from crates c join item i on i.world_id = p_world and i.holder = 'crate' and i.crate = c.id
     where not i.locked and i.deal is null and i.price is null and i.letter is null
    union all
    select i.id, i.def, i.count, i.extra, i.ql, false, 2, pc.d, 1, pc.id
      from pieces pc join item i on i.world_id = p_world and i.holder = 'furniture' and i.placed = pc.id
     where not i.locked and i.deal is null and i.price is null and i.letter is null
  )
  select s.id, s.def, s.count, s.extra, s.ql, s.carried,
         row_number() over (order by s.rank, s.d, s.kind, s.store, s.id)
    from stock s
$fn$;

/** How many of a thing a craft could spend, of a given material or of any. */
create or replace function craft_count(p_world uuid, p_uid uuid, p_item text, p_mat text default null)
  returns int language sql stable as $fn$
  select coalesce(sum(s.count), 0)::int from craft_stock(p_world, p_uid) s
   where s.def = p_item and (p_mat is null or s.extra is not distinct from p_mat)
$fn$;

/**
 * Use up `n` of something for a craft, from the clicked stack first and then
 * in the order `craft_stock` gives: the pack, the bags, the stores nearest
 * first.
 *
 * `consume` with a longer reach, and the same rule about material: once one
 * has been settled on, only stock of it is drawn from where there is enough
 * of it -- which is what stops a chest being half oak and half pine -- and an
 * input with not enough of the chosen material falls back to anything,
 * because refusing to finish a chest over the last nail would be worse than a
 * mixed one.
 *
 * Each row is read again under a lock before it is spent. A crate is shared
 * in a way a pack is not, and two people working out of the same one at the
 * same moment must not both spend its last log.
 */
create or replace function craft_consume(p_world uuid, p_uid uuid, p_item text, p_n int,
                                         p_prefer bigint default null, p_mat text default null)
  returns boolean language plpgsql as $fn$
declare left_to_take int := p_n; r record; have int; take int; only_mat boolean;
begin
  only_mat := p_mat is not null and craft_count(p_world, p_uid, p_item, p_mat) >= p_n;
  if craft_count(p_world, p_uid, p_item, case when only_mat then p_mat end) < p_n then return false; end if;
  for r in
    select s.id from craft_stock(p_world, p_uid) s
     where s.def = p_item and (not only_mat or s.extra is not distinct from p_mat)
     order by (s.id = p_prefer) desc, s.draw
  loop
    exit when left_to_take <= 0;
    select i.count into have from item i where i.id = r.id for update;
    continue when not found;
    take := least(left_to_take, have);
    if take >= have then delete from item where id = r.id;
    else update item set count = count - take where id = r.id; end if;
    left_to_take := left_to_take - take;
  end loop;
  return left_to_take = 0;
end $fn$;

/** What a recipe would be made of: the material of what is going into it. */
create or replace function craft_material(p_world uuid, p_uid uuid, p_recipe text, p_prefer bigint)
  returns text language plpgsql stable as $fn$
declare wants text; first_item text; mat text;
begin
  select material into wants from recipe where id = p_recipe;
  if wants is null then return null; end if;
  select item into first_item from recipe_input where recipe = p_recipe order by ord limit 1;
  -- The clicked stack decides, when it is one of the things going in and it
  -- is somewhere a craft may reach.
  select s.extra into mat from craft_stock(p_world, p_uid) s
   where s.id = p_prefer and s.def in (select item from recipe_input where recipe = p_recipe);
  if mat is not null then return mat; end if;
  select s.extra into mat from craft_stock(p_world, p_uid) s
   where s.def = first_item and s.extra is not null
   order by s.draw limit 1;
  return mat;
end $fn$;

/** Why a recipe cannot be made right now, in the words it should be refused in. */
create or replace function craft_refusal(p_world uuid, p_uid uuid, p_recipe text, p_prefer bigint)
  returns text language plpgsql stable as $fn$
declare r recipe; i record; mat text; have int;
begin
  select * into r from recipe where id = p_recipe;
  if not found then return null; end if;
  if r.tool is not null and tool_ql(p_world, p_uid, r.tool) <= 0 then
    return 'You need a ' || lower((select coalesce(name, r.tool) from item_def where id = r.tool)) || '.';
  end if;
  if r.station is not null and not at_station(p_world, p_uid, r.station) then
    return 'You need to stand at a ' || station_name(r.station) || '.';
  end if;
  mat := craft_material(p_world, p_uid, p_recipe, p_prefer);
  for i in select * from recipe_input where recipe = p_recipe order by ord loop
    have := greatest(craft_count(p_world, p_uid, i.item, mat), craft_count(p_world, p_uid, i.item));
    if have < i.count then
      return (select coalesce(name, r.result) from item_def where id = r.result)
        || ' takes ' || i.count || ' ' || plural_of(i.item, i.count) || '.';
    end if;
  end loop;
  return null;
end $fn$;

/**
 * One go at a recipe.
 *
 * Built on the performer as it stood before `a_pickaxe_is_its_head`, which is
 * the one that says what a go is worth. That migration rewrote this from the
 * first version of it rather than the last, to change how the parts are
 * weighed, and took seven things out with it that nothing it meant to change
 * had anything to do with: what a failed go teaches the trade and the head,
 * the trade tree's lift on what comes off the bench, the maker's mark on rare
 * work, the ledger and the journal, a vessel coming off the bench full, the
 * hardness of a gem, and a target named by `itemUid`. All seven are back, and
 * the parts are still weighed by mass. It also said the trade's rise twice,
 * once itself and once through `skill_raise`, which says it already.
 */
create or replace function perform_craft(p_world uuid, p_uid uuid, p_recipe text, p_target jsonb)
  returns void language plpgsql as $$
declare r recipe; i record; prefer bigint; mat text; hard double precision; tq double precision;
        s double precision; made_ql double precision; rare text; total double precision := 0;
        v_made bigint; weight double precision := 0; one double precision; share double precision;
        only_mat boolean; was text;
begin
  select * into r from recipe where id = p_recipe;
  prefer := target_item(p_target);
  -- What the run is aimed at, while it is still there to ask.
  select it.def into was from item it where it.id = prefer and it.world_id = p_world;
  mat := craft_material(p_world, p_uid, p_recipe, prefer);
  s := skill_of(p_world, p_uid, r.skill);
  tq := case when r.tool is null then 0 else tool_ql(p_world, p_uid, r.tool) end;
  -- Oak and the deep metals fight the hands that shape them.
  hard := craft_hardness(p_recipe, mat);

  if r.difficulty is not null and not skill_check(s, hard, tq) then
    if r.consume_on_fail then
      for i in select * from recipe_input where recipe = p_recipe order by ord loop
        perform craft_consume(p_world, p_uid, i.item, i.count, prefer, mat);
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
    return;
  end if;

  -- The quality of what is about to be used up, worked out before it is used
  -- up, since using it up changes the answer: off the stack each input would
  -- be spent from first, which is the clicked one where it is one of them.
  if r.ql_from_inputs then
    for i in select * from recipe_input where recipe = p_recipe order by ord loop
      only_mat := mat is not null and craft_count(p_world, p_uid, i.item, mat) >= i.count;
      select st.ql into one from craft_stock(p_world, p_uid) st
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

  for i in select * from recipe_input where recipe = p_recipe order by ord loop
    if not craft_consume(p_world, p_uid, i.item, i.count, prefer, mat) then return; end if;
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
  rare := rarity_roll();
  v_made := give(p_world, p_uid, r.result, r.count, made_ql, coalesce(r.extra, mat), rare, maker_mark(p_world, p_uid, rare));
  -- A vessel comes off the bench full: a bucket of juice holds its five drinks.
  update item set charges = d.charges from item_def d
    where item.id = v_made and item.charges is null and d.id = item.def and d.charges is not null;
  -- Into the ledger, which is the only memory this island has of what you have
  -- made. It says so when it is your first of a kind or your best.
  perform journal_made(p_world, p_uid, r.result, made_ql, r.count, rare);
  if rare is not null then
    perform journal_note(p_world, p_uid, rare);
    perform tell(p_world, p_uid, rarity_word(rare), 'skill');
  end if;
  for i in select g.item, g.count from recipe_gives g where g.recipe = p_recipe and g.kind = 'return' loop
    perform give(p_world, p_uid, i.item, i.count, 20);
  end loop;

  perform skill_raise(p_world, p_uid, r.skill, 1);
  -- Working a thing out with your hands is what sharpens the head.
  perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(true, craft_head()));
  perform tell(p_world, p_uid, r.done || ' (' || case when mat is not null then lower(mat) || ', ' else '' end
    || 'QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
end $$;

/**
 * Keep a run of goes on the next pile of the same thing, once a go has used
 * up the stack the run was aimed at: the next stack a craft would reach of the
 * thing that stack was, in the wood or metal the go was made of. Only the job
 * in hand is re-aimed, and only while it is still aimed at the stack that went.
 */
create or replace function craft_carry_on(p_world uuid, p_uid uuid, p_recipe text, p_target jsonb,
                                          p_was text, p_mat text)
  returns void language plpgsql as $fn$
declare aimed bigint := target_item(p_target); nxt bigint;
begin
  if aimed is null or p_was is null
     or exists (select 1 from item where id = aimed and world_id = p_world) then
    return;
  end if;
  select s.id into nxt from craft_stock(p_world, p_uid) s
   where s.def = p_was and (p_mat is null or s.extra is not distinct from p_mat)
   order by s.draw limit 1;
  if nxt is null then return; end if;
  update player
     set act_target = jsonb_set(act_target, array[case when act_target ? 'itemUid' then 'itemUid' else 'uid' end],
                                to_jsonb(nxt))
   where world_id = p_world and uid = p_uid and act = p_recipe and target_item(act_target) = aimed;
end $fn$;

select private.lock_doors();
