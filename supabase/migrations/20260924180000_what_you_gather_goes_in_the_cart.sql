-- What you gather goes in the cart
--
-- Asked: "When doing actions from the cart, all gathered materials should go
-- right to the cart."
--
-- The cart you are working from is the cart or wagon you have the reins of,
-- or the small cart you have by the shafts -- not a boat. Whatever a
-- gathering job brings up goes into it now, as far as it has room and will
-- take it, and the rest into your pack as before: mining and chipping a
-- corner, a gem off the face, digging, dredging, flattening, digging worms,
-- lifting paving, felling, foraging and botanizing, picking fruit, sprouts and
-- a bush's crop, cutting grass and reeds, harvesting a field, fishing with a
-- rod or a net, emptying a creel, butchering, shearing, and turning up a
-- fragment. It stacks the way the pack stacks, by `stack_key`. When the cart
-- is full it says so, once an ask rather than once a swing.
--
-- What is not gathered is not moved: what a craft makes, what you take out
-- of a store, a trap or a bait coming back, milk (which fills the bucket you
-- are holding) and a book's relic.

/* ---- The cart you are working from, and gathering into it ---- */

create or replace function public.work_cart(p_world uuid, p_uid uuid)
returns placed
language sql
stable
as $$
  -- The cart or wagon you have the reins of, or the small cart you have by
  -- the shafts. Not a boat.
  select p.* from placed p
   where p.world_id = p_world and p.kind = 'furniture'
     and ((p.driver = p_uid and is_vehicle(p)) or p.puller = p_uid)
   order by (p.driver is not distinct from p_uid) desc, p.id
   limit 1
$$;

create or replace function public.cart_full(p_world uuid, p_uid uuid, p_cart placed)
returns void
language plpgsql
as $$
begin
  -- Once an ask, not once a swing.
  if current_setting('wurm.cart_full', true) is not distinct from 'said' then return; end if;
  perform set_config('wurm.cart_full', 'said', true);
  perform tell(p_world, p_uid, 'The ' || lower(placed_name(p_cart))
    || ' is full. What does not fit goes in your pack.', 'error');
end $$;

create or replace function public.gather(p_world uuid, p_uid uuid, p_item text, p_n integer,
    p_ql double precision, p_extra text default null, p_rare text default null,
    p_maker text default null, p_cast text default null)
returns bigint
language plpgsql
as $$
declare v_cart placed; v_fit int := 0; v_id bigint; v_rest bigint; fresh item;
begin
  /*
   * What a gathering job brings up, put where it belongs: into the cart you
   * are working from as far as it has room and will take it, and the rest
   * into the pack through `give`, the one way a thing arrives there. The row
   * it went into comes back, the cart's when any of it went there.
   */
  v_cart := work_cart(p_world, p_uid);
  if v_cart.id is null or p_n <= 0 then
    return give(p_world, p_uid, p_item, p_n, p_ql, p_extra, p_rare, p_maker, p_cast);
  end if;
  if furniture_refuses(v_cart, p_item) is null then
    v_fit := least(p_n, furniture_room(v_cart, p_item));
  end if;
  if v_fit > 0 then
    -- The row as it would be written, so the key is the real key -- as `give` does.
    if item_stackable(p_item) then
      fresh.def := p_item; fresh.extra := p_extra; fresh.rare := p_rare;
      fresh.maker := p_maker; fresh.piece := p_cast;
      fresh.locked := false; fresh.lit := false; fresh.issued := false;
      select i.id into v_id from item i
       where i.world_id = p_world and i.holder = 'furniture' and i.placed = v_cart.id
         and i.def = p_item and stack_key(i) = stack_key(fresh)
       order by i.id limit 1;
    end if;
    if v_id is not null then
      update item set ql = (ql * count + greatest(0, least(100, p_ql)) * v_fit) / (count + v_fit),
                      count = count + v_fit
        where id = v_id;
    else
      insert into item (world_id, holder, placed, def, ql, count, extra, rare, maker, piece)
      values (p_world, 'furniture', v_cart.id, p_item, greatest(0, least(100, p_ql)), v_fit,
              p_extra, p_rare, p_maker, p_cast)
      returning id into v_id;
    end if;
  end if;
  if v_fit < p_n then
    perform cart_full(p_world, p_uid, v_cart);
    v_rest := give(p_world, p_uid, p_item, p_n - v_fit, p_ql, p_extra, p_rare, p_maker, p_cast);
  end if;
  return coalesce(v_id, v_rest);
end $$;

create or replace function public.gather_item(p_world uuid, p_uid uuid, p_item bigint)
returns integer
language plpgsql
as $$
declare v_cart placed; it item; v_fit int := 0;
begin
  -- A catch that is already a thing -- a creel's -- moved into the cart you
  -- are working from as far as it has room. What does not fit stays where it
  -- is, for the caller to hand over the way it always has.
  v_cart := work_cart(p_world, p_uid);
  if v_cart.id is null then return 0; end if;
  select * into it from item where id = p_item;
  if not found then return 0; end if;
  if furniture_refuses(v_cart, it.def) is null then
    v_fit := least(it.count, furniture_room(v_cart, it.def));
  end if;
  if v_fit < it.count then perform cart_full(p_world, p_uid, v_cart); end if;
  if v_fit <= 0 then return 0; end if;
  perform move_part(it.id, v_fit, 'furniture', null, null, v_cart.id);
  return v_fit;
end $$;

/* ---- Every gathering job, into the cart ---- */

CREATE OR REPLACE FUNCTION public.perform_ground(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; cx int; cy int; here int; t tile_def; v_data int; v_tree tree_def;
        d action_def; v_spoil text;
        v_skill double precision; v_tool double precision; v_ql double precision; v_n int; v_slab item; v_kind int; v_target int; v_hi record; v_lo record;
        v_rock rock_def; v_rad int; v_tiles int[] := '{}'; v_names text[] := '{}'; v_row record;
        v_id bigint; v_species int; v_sprout item; v_buried text; v_size int;
        v_age tree_age_def; v_to tree_age_def;
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
    if v_hi.cx is not null and v_lo.cx is not null then
      -- One corner down and one up: the dirt simply moves across the tile.
      perform raise_corner(p_world, v_hi.cx, v_hi.cy, -1);
      perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
      perform tell(p_world, p_uid, 'You move some dirt across the tile.', 'event');
    elsif v_hi.cx is not null then
      perform raise_corner(p_world, v_hi.cx, v_hi.cy, -1);
      perform gather(p_world, p_uid, v_spoil, 1,
        product_ql(skill_of(p_world, p_uid, d.skill), tool_ql(p_world, p_uid, 'shovel')));
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
        perform tell(p_world, p_uid, 'You pack '
          || lower((select name from item_def where id = v_spoil))
          || ' in to bring the ground up.', 'event');
      elsif take_spoil(p_world, p_uid, 'dirt') then
        perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
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
    if not skill_check(v_skill, d.difficulty, v_tool) then
      perform skill_raise(p_world, p_uid, 'masonry', try_gain(false));
      perform tell(p_world, p_uid, 'The concrete slumps off the rock before it sets, and is lost.', 'event');
      return;
    end if;
    -- The rock rises: the height goes up and the soil over it stays nought.
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) + 1);
    perform reconcile_around(p_world, cx, cy);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You lay concrete on the ' || corner_name(tx, ty, cx, cy)
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
    v_ql := product_ql(v_skill, v_tool);
    perform gather(p_world, p_uid, v_spoil, 1, v_ql);
    perform tell(p_world, p_uid, 'You dredge up some ' || lower((select name from item_def where id = v_spoil))
      || ' off the bottom at the ' || corner_name(tx, ty, cx, cy) || ' corner. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
    perform skill_raise(p_world, p_uid, 'digging', 1);

  elsif p_action = 'pave_slabs' then
    select i.* into v_slab from item i join slab_def s on s.item = i.def
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and not i.locked
      order by (i.id = target_item(p_target)) desc, i.id limit 1;
    if not found then return; end if;
    select id into v_kind from slab_def where item = v_slab.def;
    if not skill_check(skill_of(p_world, p_uid, 'paving'), 10, v_slab.ql) then
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
    perform gather(p_world, p_uid, 'mixed_grass', 2, product_ql(skill_of(p_world, p_uid, 'foraging')));
    -- Grass kept cut on a deed becomes lawn: the tile counts the days, in
    -- the bits `tree_day` reads.
    if here = tile_id('Grass') and on_deed(p_world, tx, ty) then
      v_n := v_data & 3;
      perform land_set_data(p_world, tx, ty, v_n | 4);
      perform land_announce(p_world, tx, ty);
      perform tell(p_world, p_uid, 'You cut two bundles of mixed grass.'
        || case when 3 - v_n - 1 > 0
             then ' Kept cut, this will be lawn in ' || (3 - v_n - 1) || ' more day' || case when 3 - v_n - 1 = 1 then '' else 's' end || '.'
             else ' Kept cut, this will be lawn tomorrow.' end, 'event');
    else
      perform tell(p_world, p_uid, 'You cut two bundles of mixed grass.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, 'foraging', 1);

  elsif p_action = 'cut_reeds' then
    perform mark_foraged(p_world, tx, ty, 'reed');
    v_skill := skill_of(p_world, p_uid, 'foraging');
    v_n := 2 + case when random() < v_skill / 140 then 1 else 0 end;
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
                             * (0.5 + v_skill / 130) * (0.7 + random() * 0.6))::int);
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
    if not skill_check(skill_of(p_world, p_uid, 'forestry'), 15) then
      perform skill_raise(p_world, p_uid, 'forestry', try_gain(false));
      perform tell(p_world, p_uid, 'You find no sprout worth picking.', 'event');
      return;
    end if;
    perform gather(p_world, p_uid, 'sprout', 1,
      product_ql(skill_of(p_world, p_uid, 'forestry')), v_tree.name);
    perform tell(p_world, p_uid, 'You pick a ' || lower(v_tree.name) || ' sprout.', 'event');
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
    perform land_set_data(p_world, tx, ty, tree_pack(v_species, 0));
    perform land_announce(p_world, tx, ty);
    perform journal_note(p_world, p_uid, 'planted');
    if (select fruit from tree_def where id = v_species) is not null then
      perform journal_note(p_world, p_uid, 'orchard');
    end if;
    perform tell(p_world, p_uid, 'You plant the '
      || lower((select name from tree_def where id = v_species)) || ' sprout.', 'event');
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
    if not skill_check(v_skill, d.difficulty, v_tool) then
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
    v_n := greatest(1, round(3 * (0.5 + v_skill / 130) * (0.7 + random() * 0.6))::int);
    v_ql := product_ql(v_skill, v_tool);
    perform gather(p_world, p_uid, (select yields from bush_def where id = bush_species(v_data)), v_n, v_ql);
    perform mark_foraged(p_world, tx, ty, 'forage');
    perform skill_raise(p_world, p_uid, 'forestry', 0.35);
    perform tell(p_world, p_uid, 'You cut ' || v_n || ' '
      || lower((select name from item_def where id = (select yields from bush_def where id = bush_species(v_data))))
      || ' off the ' || lower((select name from bush_def where id = bush_species(v_data)))
      || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');

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
    v_rad := prospect_radius(v_skill);
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
        || '. It needs mining ' || to_char(v_rock.level, 'FM990')
        || ' to work' || case when skill_of(p_world, p_uid, 'mining') >= v_rock.level
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

CREATE OR REPLACE FUNCTION public.perform_terrain(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare d action_def; cx int; cy int; tx int; ty int; t tile_def; r rock_def;
        s double precision; tq double precision; yields text; made_ql double precision; tool_id bigint; here int;
begin
  select * into d from action_def where id = p_action;
  cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
  tx := (p_target->>'x')::int;  ty := (p_target->>'y')::int;
  s := case when d.skill is null then 50 else skill_of(p_world, p_uid, d.skill) end;
  tq := case when d.tool is null then 0 else tool_ql(p_world, p_uid, d.tool) end;
  if d.tool is not null then
    select i.id into tool_id from item i
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and i.def = d.tool
      order by tool_worth(i.ql, i.dmg, i.extra, i.rare, i.bless) desc limit 1;
    if tool_id is not null then perform wear_tool(tool_id); end if;
  end if;

  if p_action = 'mine' then
    if not skill_check(s, d.difficulty, tq) then
      -- The swing happened. It taught nothing at all until now.
      perform skill_raise(p_world, p_uid, d.skill, try_gain(false));
      perform tell(p_world, p_uid, 'The rock is hard and you fail to loosen anything.', 'event');
      return;
    end if;
    r := bedrock_at(p_world, tx, ty);
    yields := case when land_tile(p_world, tx, ty) = 4 then r.yields else 'rock_shards' end;
    -- The first ore out of the ground is a thing worth remembering.
    if yields like '%\_ore' then perform journal_note(p_world, p_uid, 'ore'); end if;
    made_ql := least(ore_max_ql((select seed from world where id = p_world), tx, ty), product_ql(s, tq));
    perform gather(p_world, p_uid, yields, 1, made_ql);
    -- And one swing in a thousand that brings out something nobody quarried.
    perform maybe_map(p_world, p_uid, s, tq);
    -- And a stone, now and again, which is the other thing a miner is for.
    perform maybe_gem(p_world, p_uid, s, tq);
    perform tell(p_world, p_uid,
      case when yields like '%lump' then 'You chip a ' else 'You mine some ' end
      || lower((select coalesce(name, yields) from item_def where id = yields))
      || case when yields like '%lump' then ' out of the vein.' else '.' end
      || ' (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    -- Cutting the face back is its own job. Now and again one comes down anyway.
    if random() < mine_collapse() then
      perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
      perform land_set_dirt(p_world, cx, cy, 0);
      perform reconcile_around(p_world, cx, cy);
      perform tell(p_world, p_uid, 'A slab breaks away of its own accord and the face drops.', 'event');
    end if;
    perform skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'chip_corner' then
    if random() >= chip_chance() then
      perform skill_raise(p_world, p_uid, d.skill, try_gain(false));
      perform tell(p_world, p_uid, 'You work at the corner and find no line in it. The face holds.', 'event');
      return;
    end if;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) - 1);
    perform land_set_dirt(p_world, cx, cy, 0);
    perform reconcile_around(p_world, cx, cy);
    r := bedrock_at(p_world, tx, ty);
    yields := case when land_tile(p_world, tx, ty) = 4 then r.yields else 'rock_shards' end;
    -- The first ore out of the ground is a thing worth remembering.
    if yields like '%\_ore' then perform journal_note(p_world, p_uid, 'ore'); end if;
    made_ql := least(ore_max_ql((select seed from world where id = p_world), tx, ty), product_ql(s, tq));
    perform gather(p_world, p_uid, yields, 1, made_ql);
    perform maybe_map(p_world, p_uid, s, tq);
    perform tell(p_world, p_uid, 'The corner breaks away and drops a step. You gather the '
      || lower((select coalesce(name, yields) from item_def where id = yields))
      || '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    perform skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'pack' then
    here := land_tile(p_world, tx, ty);
    perform land_set_tile(p_world, tx, ty, 2);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, case when here <> 1
      then 'You cut the turf away and tread the ground down firm.'
      else 'You pack the dirt down firmly.' end, 'event');
    perform skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'cultivate' then
    perform land_set_tile(p_world, tx, ty, 1);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You break up the packed earth.', 'event');
    perform skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'pave_cobble' then
    if not consume(p_world, p_uid, 'stone_brick', 1) then return; end if;
    perform land_set_tile(p_world, tx, ty, 14);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You lay the cobblestones.', 'event');
    perform skill_raise(p_world, p_uid, d.skill, 1);

  elsif p_action = 'drop_dirt_here' then
    if not consume(p_world, p_uid, 'dirt', 1) then return; end if;
    select round(x)::int, round(y)::int into cx, cy from player where world_id = p_world and uid = p_uid;
    perform land_set_height(p_world, cx, cy, land_height(p_world, cx, cy) + 1);
    perform land_set_dirt(p_world, cx, cy, land_dirt(p_world, cx, cy) + 1);
    perform reconcile_around(p_world, cx, cy);
    /*
     * And what the spadeful covered, which is the tile you are standing on.
     *
     * The corner this raises is the nearest one, which belongs to as many as
     * four tiles; the ground that took the dirt is the one under your feet.
     * `drop_dirt` at a corner covers the tile it names, and this covers that
     * one — the same spadeful and the same list either way.
     */
    select floor(x)::int, floor(y)::int into tx, ty from player where world_id = p_world and uid = p_uid;
    if exists (select 1 from buryable b where b.tile = land_tile(p_world, tx, ty)) then
      perform land_set_tile(p_world, tx, ty, 1);
      perform land_announce(p_world, tx, ty);
    end if;
    perform tell(p_world, p_uid, 'You drop the dirt at your feet, raising the ground.', 'event');
    perform skill_raise(p_world, p_uid, d.skill, 1);
  end if;

end $function$;

CREATE OR REPLACE FUNCTION public.perform_gather(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare d action_def; tx int; ty int; here int; data int; t tile_def; tool_id bigint;
        s double precision; tq double precision; made_ql double precision;
        species int; logs int; tree tree_def;
        v_age tree_age_def; v_cuts int;
        passes int; i int; found text[] := '{}'; got text; yields text;
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
    if not skill_check(s, d.difficulty, tq) then
      perform skill_raise(p_world, p_uid, 'woodcutting', try_gain(false));
      perform tell(p_world, p_uid, 'Your hatchet glances off and you fail to make headway.', 'event');
      return;
    end if;
    if here = tile_id('Bush') then
      perform land_set_tile(p_world, tx, ty, tile_id('Grass'));
      perform land_set_data(p_world, tx, ty, 0);
      perform land_announce(p_world, tx, ty);
      perform tell(p_world, p_uid, 'You hack the bush down.', 'event');
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
      if v_cuts < v_age.hits then
        perform tree_notch(p_world, tx, ty, v_cuts);
        perform tell(p_world, p_uid, 'You cut into the ' || lower(v_age.name) || ' '
          || lower(tree.name) || '. ' || (v_age.hits - v_cuts)
          || ' more like that and it comes down.', 'event');
      else
        logs := v_age.logs;
        -- A tree with timber in it leaves a stump of its kind, in the way of
        -- the ground for a day or until somebody digs it out. Nothing smaller
        -- leaves one worth the name.
        if logs = 0 then
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
          made_ql := product_ql(s, tq);
          perform gather(p_world, p_uid, 'log', logs, made_ql, tree.name);
          perform tell(p_world, p_uid, 'The ' || lower(v_age.name) || ' ' || lower(tree.name)
            || ' comes down. You get ' || logs
            || case when logs = 1 then ' log' else ' logs' end || '. (QL ' || to_char(made_ql, 'FM990.0') || ') The stump is left.', 'event');
        end if;
      end if;
    end if;
    perform skill_raise(p_world, p_uid, 'woodcutting', 1);

  elsif p_action in ('forage', 'botanize') then
    perform mark_foraged(p_world, tx, ty, p_action);
    -- A practised eye goes over the same ground more than once.
    passes := rolls_at(s);
    for i in 1..passes loop
      if random() < 0.2 or not skill_check(s, 5, 0) then continue; end if;
      got := roll_table(p_action, random());
      made_ql := product_ql(s, 0);
      perform gather(p_world, p_uid, got, 1, made_ql);
      found := found || (lower((select coalesce(name, got) from item_def where id = got))
        || ' (QL ' || to_char(made_ql, 'FM990.0') || ')');
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
    made_ql := product_ql(s, tq);
    perform gather(p_world, p_uid, yields, 1, made_ql);
    perform tell(p_world, p_uid, 'You fill a shovel with '
      || lower((select coalesce(name, yields) from item_def where id = yields))
      || ' off the top of the bed. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    perform skill_raise(p_world, p_uid, 'digging', 1);
  end if;

end $function$;

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
begin
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

  elsif p_action = 'plant_seed' then
    select * into it from item where id = target_item(p_target);
    select * into cd from crop_def where seed = it.def;
    if not consume(p_world, p_uid, it.def, 1, it.id) then return; end if;
    insert into crop (world_id, x, y, id, ql, sown_by) values (p_world, tx, ty, cd.id, it.ql, p_uid)
      on conflict (world_id, x, y) do update set id = cd.id, stage = 0, stage_at = now(),
        tended = 0, tended_now = false, ql = it.ql, sown_by = p_uid;
    perform tell(p_world, p_uid, 'You sow ' || lower(cd.name)
      || '. It should be sprouting in a couple of minutes.', 'event');
    perform land_announce(p_world, tx, ty);

  elsif p_action = 'tend_crop' then
    made_ql := product_ql(s, 0);
    update crop cr set tended_now = true, tended = c.tended + 1,
      -- Quality follows the farmer, averaged over the care the field was given.
      ql = (c.ql * (c.tended + 1) + made_ql) / (c.tended + 2)
      where cr.world_id = p_world and cr.x = tx and cr.y = ty;
    yld := crop_yield(c.tended + 1);
    perform tell(p_world, p_uid, 'You weed and water the ' || lower(cd.name) || '. It should give '
      || yld[2] || ' ' || lower((select coalesce(name, cd.produce) from item_def where id = cd.produce))
      || ' and ' || yld[1] || ' seed' || case when yld[1] > 1 then 's' else '' end || '.', 'event');
    perform skill_raise(p_world, p_uid, 'farming', 1);

  elsif p_action = 'harvest_crop' then
    yld := crop_yield(c.tended);
    -- The field's own quality, lifted by the farmer's skill at harvest.
    made_ql := greatest(1, least(100, (c.ql + product_ql(s, 0)) / 2));
    -- The gardener's path takes a third more out of the same ground.
    got := greatest(1, round(yld[2] * case when walks(p_world, p_uid, 'love', 5) then 1.34 else 1 end));
    perform gather(p_world, p_uid, cd.produce, got, made_ql);
    perform gather(p_world, p_uid, cd.seed, yld[1], made_ql);
    delete from crop cr where cr.world_id = p_world and cr.x = tx and cr.y = ty;
    perform tell(p_world, p_uid, 'You harvest ' || got || ' × '
      || lower((select coalesce(name, cd.produce) from item_def where id = cd.produce))
      || ' and ' || yld[1] || ' ' || lower((select coalesce(name, cd.seed) from item_def where id = cd.seed))
      || '. The field is ready to sow again. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
    perform skill_raise(p_world, p_uid, 'farming', 1);
    perform land_announce(p_world, tx, ty);

  elsif p_action = 'clear_field' then
    delete from crop cr where cr.world_id = p_world and cr.x = tx and cr.y = ty;
    perform land_set_tile(p_world, tx, ty, tile_id('Dirt'));
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, case when c.id is not null
      then 'You turn the ' || lower(cd.name) || ' back into the soil.'
      else 'You break the field back up into plain dirt.' end, 'event');
  end if;

end $function$;

CREATE OR REPLACE FUNCTION public.perform_fish(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; spot record; skill double precision; rod_ql double precision;
        bait text; got text; made_ql double precision; tool_id bigint;
        haul int; i int; parts text[] := '{}'; one text; counted jsonb := '{}'::jsonb; k text;
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
    select it.id into tool_id from item it
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

CREATE OR REPLACE FUNCTION public.act_perform(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare d action_def; tq double precision; s double precision; cx int; cy int; tx int; ty int;
        t tile_def; left_dirt int; made_ql double precision; yield text; tool_id bigint;
begin
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
  if p_action in ('till', 'plant_seed', 'tend_crop', 'harvest_crop', 'clear_field') then
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
    made_ql := product_ql(s, tq);
    perform gather(p_world, p_uid, yield, 1, made_ql);
    -- And one spadeful in a thousand that is not dirt at all.
    perform maybe_map(p_world, p_uid, s, tq);
    perform skill_raise(p_world, p_uid, d.skill, 1);
    perform tell(p_world, p_uid,
      'You dig up some ' || lower((select name from item_def where id = yield)) ||
      '. (QL ' || to_char(made_ql, 'FM990.0') || ')', 'event');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.maybe_gem(p_world uuid, p_uid uuid, p_skill double precision, p_tool_ql double precision)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare v_gem text; v_ql double precision;
begin
  if random() >= gem_odds() then return; end if;
  v_gem := roll_gem();
  v_ql := product_ql(p_skill, p_tool_ql);
  perform gather(p_world, p_uid, 'gem', 1, v_ql, v_gem);
  perform tell(p_world, p_uid, 'Something glints in the rubble: a ' || lower(v_gem) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
end $function$;

CREATE OR REPLACE FUNCTION public.perform_creature(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare c creature; d species_def; a age_def; food text; n int; made_ql double precision;
        gained double precision; chance double precision; warm double precision; nm text;
        held int; brush_id bigint; top double precision; before double precision; skill double precision;
        dd deed;
begin
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
    if food is null or not consume(p_world, p_uid, food, 1) then return; end if;
    chance := tame_chance(p_world, p_uid, c);
    update creature set hunger = least(1, hunger + 0.25) where world_id = p_world and id = c.id;
    if random() < chance then
      held := companion_of(p_world, p_uid);
      update creature set
          mode = case when held is null then 'active' else 'stored' end,
          stance = 'defensive', keeper = p_uid, coaxed = 0, coaxed_at = null
        where world_id = p_world and id = c.id;
      perform tell(p_world, p_uid, 'The ' || lower(d.name) || ' takes the '
        || material_name(food, 1) || ' from your hand and trusts you. '
        || case when held is null then c.name || ' now follows you.'
             else 'As you already travel with a companion, it is kept at the token of '
                  || coalesce((my_deed(p_world, p_uid)).name, 'your settlement') || '.' end, 'system');
      perform journal_note(p_world, p_uid, 'tamed');
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
    n := greatest(1, round(c.fleece * case when coalesce(d.shear_yield, 'wool') = 'wool' then 3 else 6 end)::int);
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
    update creature set fleece = 0 where world_id = p_world and id = c.id;
    perform skill_told(p_world, p_uid, 'farming', 0.3);
    perform tell(p_world, p_uid, 'You milk ' || c.name || ' into the bucket. (QL '
      || to_char(made_ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'set_stance' then
    update creature set stance = p_target->>'stance' where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, c.name || ' will be ' || (p_target->>'stance') || '.', 'info');

  elsif p_action = 'rename_creature' then
    nm := left(btrim(p_target->>'name'), 24);
    update creature set name = nm where world_id = p_world and id = c.id;
    perform tell(p_world, p_uid, 'It answers to ' || nm || ' now.', 'info');

  elsif p_action = 'take_creature' then
    held := companion_of(p_world, p_uid);
    if held is not null then
      update creature set mode = 'stored' where world_id = p_world and id = held;
      perform tell(p_world, p_uid,
        (select name from creature where world_id = p_world and id = held)
        || ' stays at the token for now.', 'info');
    end if;
    update creature set mode = 'active', keeper = p_uid, settled_at = now()
      where world_id = p_world and id = c.id;
    perform creature_settle(p_world, c.id);
    perform tell(p_world, p_uid, c.name || ' now follows you.', 'system');

  elsif p_action = 'store_creature' then
    update creature set mode = 'stored', settled_at = now() where world_id = p_world and id = c.id;
    perform creature_settle(p_world, c.id);
    perform tell(p_world, p_uid, c.name || ' is kept at the token of '
      || (my_deed(p_world, p_uid)).name || '.', 'system');

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
        top double precision; out_w jsonb; one jsonb; lye item; got text;
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
    v_landed := random() <= hit_chance(p_world, p_uid, w.kind) * beast_mul(c, 'evade');
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
    v_landed := random() <= hit_chance(p_world, p_uid, 'archery')
                            * (1 - (dist / coalesce(bow.range, 6)) * 0.35) * beast_mul(c, 'evade');
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
    v_share := butcher_yield(skill_of(p_world, p_uid, 'butchering'), knife_ql);
    made_ql := product_ql(skill_of(p_world, p_uid, 'butchering'), coalesce(knife_ql, 0))
               * (0.6 + corpse.ql / 250);
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
      perform gather(p_world, p_uid, r.item, v_n, greatest(1, least(100, made_ql)));
      taken := taken || (case when v_n > 1 then v_n || ' × ' else '' end
        || lower((select name from item_def where id = r.item)));
    end loop;
    delete from item where id = corpse.id;
    if array_length(taken, 1) is null then
      perform tell(p_world, p_uid, 'You make a mess of the ' || lower(sp.name)
        || ' carcass and salvage nothing.', 'event');
    else
      perform tell(p_world, p_uid, 'You butcher the ' || lower(sp.name) || ' and take '
        || array_to_string(taken, ', ') || '.'
        || case when knife_ql is null then ' Bare hands waste most of a carcass.' else '' end, 'event');
    end if;

  elsif p_action = 'bind_wound' then
    select * into p from player where world_id = p_world and uid = p_uid;
    hurt := worst_wound(p.wounds);
    if hurt is null or (hurt->>'infected')::boolean then return; end if;
    use := dressing_for(p_world, p_uid, hurt);
    if use.id is null or not consume(p_world, p_uid, use.def, 1, use.id) then return; end if;
    got := case when use.def = 'cover' then lower(coalesce(use.extra, '')) else '' end;
    suits := got = (select herb from wound_kind_def where id = hurt->>'kind');
    clean := skill_check(skill_of(p_world, p_uid, 'first_aid'), 10, use.ql);
    -- Cloth holds a dressing on. The right herb closes the wound.
    healed := (0.06 + (skill_of(p_world, p_uid, 'first_aid') / 100) * 0.24 + (use.ql / 100) * 0.1)
              * (case when clean then 1 else 0.35 end)
              * (case when suits then 1.5 when got <> '' then 1.1 else 1 end);
    out_w := '[]'::jsonb;
    for one in select * from jsonb_array_elements(p.wounds) loop
      if one = hurt then
        one := jsonb_set(one, '{severity}', to_jsonb(greatest(0, (one->>'severity')::double precision - healed)));
        if clean then one := jsonb_set(jsonb_set(one, '{dressing}', to_jsonb(got)), '{bleeding}', 'false'); end if;
      end if;
      if (one->>'severity')::double precision > 0.004 or (one->>'infected')::boolean then
        out_w := out_w || one;
      end if;
    end loop;
    update player set wounds = out_w,
        stats = jsonb_set(p.stats, '{health}',
          to_jsonb(least(1, coalesce((p.stats->>'health')::double precision, 1) + healed)))
      where world_id = p_world and uid = p_uid;
    perform journal_note(p_world, p_uid, 'dressed');
    if clean and suits then perform journal_note(p_world, p_uid, 'covered'); end if;
    perform skill_raise(p_world, p_uid, 'first_aid', try_gain(clean, bandage_gain()));
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
        one := jsonb_set(jsonb_set(jsonb_set(one, '{infected}', 'false'),
          '{bleeding}', 'true'), '{dressing}', 'null'::jsonb);
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

CREATE OR REPLACE FUNCTION public.perform_dig(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; it item; r relic_def; v_skill double precision; v_tool double precision;
        v_part int; v_ql double precision; v_dmg double precision; v_left int; v_new bigint;
        v_missing int[]; v_relic text; v_avg double precision; v_gain double precision;
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
    if random() > find_chance(v_skill, v_tool) then
      -- Half a go here, where the browser's blanket pays a whole one. That
      -- disagreement is older than this change and is left where it is: what
      -- moves today is only what a *failed* go is worth.
      perform skill_raise(p_world, p_uid, 'archaeology', try_gain(false, 0.5));
      perform tell(p_world, p_uid,
        'You go through the soil and turn up nothing but roots and small stones.', 'event');
      return;
    end if;
    perform skill_raise(p_world, p_uid, 'archaeology', try_gain(true, 0.5));
    if not exists (select 1 from relics_within(v_skill)) then
      perform tell(p_world, p_uid,
        'You turn up a scrap of something worked, but you cannot tell what it was and it crumbles.',
        'event');
      return;
    end if;
    -- The commonplace comes up far more often than the rare, as it did when
    -- it was lost: weighted by difficulty, and the weights are small numbers.
    select sum(1 / (1 + w.difficulty / 12)) into v_sum from relics_within(v_skill) w;
    v_roll := random() * v_sum;
    for r in select * from relics_within(v_skill) loop
      v_roll := v_roll - 1 / (1 + r.difficulty / 12);
      exit when v_roll <= 0;
    end loop;
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
    -- A lectern holds the pages open at the right angle, and you get twice as
    -- much out of the hour.
    v_lectern := exists (select 1 from placed p where p.world_id = p_world and p.kind = 'furniture'
                           and p.sub = 'lectern' and near_piece(p_world, p_uid, p, 2.6));
    v_gain := skill_raise(p_world, p_uid, 'mind_logic',
      (0.5 + it.ql / 90) * case when v_lectern then 2 else 1 end);
    perform damage_item(it.id, 2 + random() * 3);
    perform tell(p_world, p_uid, 'You work through the ' || lower(item_name(it)) || '.'
      || case when v_lectern
              then ' The lectern holds it open at the right angle and you make good use of the hour.'
              else ' Held in one hand, it is hard going. A lectern would be better.' end
      || case when v_gain > 0.0005 then '' else ' There is nothing left in it you do not already know.' end,
      'event');
    return;
  end if;

  -- Restoring: every piece in at once, and what comes out is only as good as
  -- the pieces that went in, less what age took.
  v_relic := fragment_relic(it.extra);
  select * into r from relic_def where name = v_relic;
  if not found then return; end if;
  if not skill_check(skill_of(p_world, p_uid, 'restoration'), r.difficulty, 0,
                     mind_ease(p_world, p_uid)) then
    for v_piece in select * from pieces_held(p_world, p_uid, v_relic) loop
      perform damage_item(v_piece.id, 5 + random() * 9);
    end loop;
    perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(false, restore_gain()));
    perform tell(p_world, p_uid, 'The pieces of the ' || r.name
      || ' will not sit together and you mark them trying.', 'event');
    return;
  end if;
  select avg(h.ql * (1 - h.dmg / 200)) into v_avg from pieces_held(p_world, p_uid, v_relic) h;
  -- And the tree, on restoration, which is the mender's and the only quality
  -- on this island that comes out of pieces rather than out of stock.
  v_ql := greatest(1, least(100, v_avg * (0.72 + skill_of(p_world, p_uid, 'restoration') / 260)
                                * class_mul(p_world, p_uid, 'fine', 'restoration')));
  for v_piece in select * from pieces_held(p_world, p_uid, v_relic) loop
    perform consume(p_world, p_uid, 'fragment', 1, v_piece.id);
  end loop;
  v_new := give(p_world, p_uid, r.result, 1, v_ql);
  perform skill_raise(p_world, p_uid, 'mind_logic', try_gain(true, restore_gain()));
  perform tell(p_world, p_uid, 'The pieces go back together and the ' || r.name || ' is whole: '
    || lower((select item_name(i) from item i where i.id = v_new))
    || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
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
    insert into placed (world_id, kind, sub, material, x, y, sx, sy, cx, cy, ql, dmg, made_by)
    values (p_world, 'trap', it.def, it.extra, (p_target->>'x')::int, (p_target->>'y')::int,
            v_sx, v_sy, (p_target->>'x')::int + (v_sx + 0.5) / subtiles(),
            (p_target->>'y')::int + (v_sy + 0.5) / subtiles(), it.ql, it.dmg, p_uid)
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
    select * into dd from my_deed(p_world, p_uid) md where md.world_id is not null;
    if not exists (select 1 from creature q where q.world_id = p_world and q.mode = 'active'
                     and q.keeper = p_uid) then
      update creature set trapped = null, mode = 'active', keeper = p_uid, until = now()
        where world_id = p_world and id = c.id;
      perform journal_note(p_world, p_uid, 'trapped');
      perform tell(p_world, p_uid, 'You get the noose off the ' || lower(s.name)
        || ' and it stays. It comes with you.', 'event');
    elsif dd.world_id is not null then
      update creature set trapped = null, mode = 'stored', keeper = p_uid,
          from_x = dd.x + 0.5, from_y = dd.y + 1.5, to_x = dd.x + 0.5, to_y = dd.y + 1.5,
          leg_at = now(), leg_ends = now(), until = now(), settled_at = now()
        where world_id = p_world and id = c.id;
      perform journal_note(p_world, p_uid, 'trapped');
      perform tell(p_world, p_uid, 'You get it out of the trap and walk it home to the token of '
        || dd.name || '.', 'event');
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
    v_back := give(p_world, p_uid, p.sub, 1, p.ql, p.material);
    update item set dmg = trap_dmg(p) where id = v_back;
    perform tell(p_world, p_uid, 'You take the ' || lower(trap_name(p)) || ' up'
      || case when p.bait is not null then ' and pocket the bait' else '' end || '.', 'event');
    delete from placed where id = p.id;
    perform land_announce(p_world, p.x, p.y);
  end if;
end $function$;

/* ---- And said, when you take the reins or the shafts ---- */

CREATE OR REPLACE FUNCTION public.perform_ride(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare c creature; p placed; v vehicle_def; r record; v_names text; v_short text; v_n int;
        v_was bigint; v_shore record; v_sail boolean;
begin
  if ride_beast_action(p_action) then
    c := target_creature(p_world, p_target);
    if c.world_id is null then return; end if;

    if p_action = 'tack_creature' then
      for r in select item from tack_def order by ord loop
        if not consume(p_world, p_uid, r.item, 1) then return; end if;
      end loop;
      update creature set tacked = true where world_id = p_world and id = c.id;
      perform tell(p_world, p_uid, 'You saddle ' || c.name
        || ' and slip the bit into its mouth. It stands for it.', 'event');

    elsif p_action = 'shoe_creature' then
      if not consume(p_world, p_uid, 'horseshoe', shoes_per_mount()::int) then return; end if;
      update creature set shod_at = now() where world_id = p_world and id = c.id;
      perform tell(p_world, p_uid, 'You nail four shoes onto ' || c.name
        || '''s hooves. They will hold a week: quicker on stone, and up what it would have baulked at.', 'event');

    elsif p_action = 'untack_creature' then
      update creature set tacked = false where world_id = p_world and id = c.id;
      for r in select item from tack_def order by ord loop
        perform give(p_world, p_uid, r.item, 1, 40);
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

select private.lock_doors();
