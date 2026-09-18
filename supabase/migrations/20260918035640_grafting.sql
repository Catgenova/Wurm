-- Grafting: a fruit sprout onto a wild tree
--
-- Asked from the island. A forester at fifty grafts an apple, cherry or olive
-- sprout onto a living tree that does not bear, with a carving knife, and the
-- tree is that kind from then on — at the age it was, notch and all. A graft
-- that does not take is a sprout spent, which is what makes fifty the floor:
-- a beginner's graft is a sprout thrown away. An orchard without felling a
-- thing, and the journal counts it as one.
--
-- The sprout is the one named off the menu, or the first of the three that
-- bear to hand — the same road `plant` takes, narrowed to a fruit sprout.
-- `graft_skill()` is the floor, written once here and once in the browser
-- under the same name.

/** Forestry it takes to graft. */
create or replace function graft_skill() returns integer
  language sql immutable as $fn$ select 50 $fn$;

CREATE OR REPLACE FUNCTION public.ground_action(p_action text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_action in ('flatten', 'drop_dirt', 'pave_slabs', 'remove_paving',
                      'cut_grass', 'cut_reeds', 'pick_fruit', 'pick_sprout',
                      'plant', 'prune', 'graft', 'harvest_bush', 'dig_stump', 'dig_worms', 'prospect')
$function$
;

CREATE OR REPLACE FUNCTION public.ground_refusal(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare tx int; ty int; cx int; cy int; here int; t tile_def; v_data int; v_tree tree_def;
        v_under text; p player;
begin
  tx := (p_target->>'x')::int; ty := (p_target->>'y')::int;
  if tx is null or ty is null or not in_bounds(p_world, tx, ty) then
    return 'There is nothing there.';
  end if;
  here := land_tile(p_world, tx, ty);
  select * into t from tile_def where id = here;
  v_data := land_data(p_world, tx, ty);

  if p_action = 'flatten' then
    if t.dig_yield is null then return 'You cannot flatten that.'; end if;
    if pack_count(p_world, p_uid, 'shovel') < 1 then return 'You need a shovel to flatten.'; end if;
    -- Shallows are workable, to the depth a pick works to. `has_water` refuses
    -- a tile with one corner an inch under, which is most of a shoreline.
    if centre_height(p_world, tx, ty) < -mine_depth() then
      return 'The water is too deep here to work in.';
    end if;
    if flatten_target(p_world, p_uid, tx, ty) < -mine_depth() then
      return 'The ground you stand on is too deep to work from.';
    end if;
    v_under := under_building(p_world, tx, ty);
    if v_under is not null then return v_under; end if;
    if not needs_flattening(p_world, p_uid, tx, ty) then return 'That ground is already flat.'; end if;

  elsif p_action = 'drop_dirt' then
    cx := (p_target->>'cx')::int; cy := (p_target->>'cy')::int;
    if pack_count(p_world, p_uid, 'dirt') < 1 then return 'You have no dirt to drop.'; end if;
    v_under := corner_under_building(p_world, cx, cy);
    if v_under is not null then return v_under; end if;
    if corner_slope_after(p_world, cx, cy, 1) > max_dig_slope(p_world, p_uid) then
      return 'The slope would be too steep for your digging skill.';
    end if;

  elsif p_action = 'pave_slabs' then
    v_under := under_building(p_world, tx, ty);
    if v_under is not null then return v_under; end if;
    if here <> 2 then return 'The ground has to be packed flat before anything is laid on it.'; end if;
    if pack_count(p_world, p_uid, 'trowel') < 1 then return 'You need a trowel to bed a slab.'; end if;
    if not exists (select 1 from item i join slab_def s on s.item = i.def
                   where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
                     and not i.locked) then
      return 'You need a cut slab to pave with.';
    end if;

  elsif p_action = 'remove_paving' then
    if here not in (13, 14, 21) then return 'There is no paving here to break up.'; end if;
    v_under := under_building(p_world, tx, ty);
    if v_under is not null then return v_under; end if;
    if pack_count(p_world, p_uid, 'pickaxe') < 1 then return 'You need a pickaxe to break up paving.'; end if;

  elsif p_action = 'cut_grass' then
    if here not in (0, 5, 6, 20) then return 'There is no grass here to cut.'; end if;
    if is_foraged(p_world, tx, ty, 'grass') then return 'The grass here is still short.'; end if;

  elsif p_action = 'cut_reeds' then
    if here <> 19 then return 'There are no reeds here.'; end if;
    if pack_count(p_world, p_uid, 'carving_knife') < 1 then return 'You need a knife to cut reeds.'; end if;
    if is_foraged(p_world, tx, ty, 'reed') then return 'The reeds here are cut back to the water.'; end if;

  elsif p_action = 'pick_fruit' then
    if here <> 16 then return 'There is no tree here.'; end if;
    select * into v_tree from tree_def where id = tree_species(v_data);
    if v_tree.fruit is null then return 'Nothing grows on this that you would eat.'; end if;
    if not coalesce((select alive from tree_age_def where id = tree_age(v_data)), true) then
      return 'Nothing hangs on a dead tree.';
    end if;
    -- A sapling bears nothing; it has to have some years in it first.
    if not coalesce((select bears from tree_age_def where id = tree_age(v_data)), false) then
      return 'The ' || lower(v_tree.name) || ' is too young to bear. Leave it to grow.';
    end if;
    if is_foraged(p_world, tx, ty, 'forage') then
      return 'You have had what this ' || lower(v_tree.name) || ' has on it. Come back later.';
    end if;

  elsif p_action = 'pick_sprout' then
    if here <> 16 then return 'There is no tree here.'; end if;
    if not coalesce((select alive from tree_age_def where id = tree_age(v_data)), true) then
      return 'There is no life in it to sprout.';
    end if;

  elsif p_action = 'prune' then
    if here <> 16 then return 'There is no tree here to prune.'; end if;
    select * into v_tree from tree_def where id = tree_species(v_data);
    if not coalesce((select alive from tree_age_def where id = tree_age(v_data)), true) then
      return 'There is no pruning a dead tree.';
    end if;
    -- What each stage prunes to is the table's: a stage back for a grown
    -- tree, a shrub for good out of a sapling, and a young tree left to grow.
    -- A stage whose next stage is itself is a shrub already kept.
    if exists (select 1 from tree_age_def where id = tree_age(v_data) and pruned is null and next = id) then
      return 'It is clipped as far as it goes.';
    end if;
    if (select pruned from tree_age_def where id = tree_age(v_data)) is null then
      return 'The ' || lower(v_tree.name) || ' is too young to prune. Let it grow.';
    end if;

  elsif p_action = 'plant' then
    if not exists (select 1 from plantable where tile = here) then
      return 'Nothing will take root in that.';
    end if;
    if pack_count(p_world, p_uid, 'sprout') < 1 then return 'You have no sprout to plant.'; end if;
    -- A grown tile of tree is something you walk round, not through, and the
    -- sprout becomes that tile the moment it goes in.
    select * into p from player where world_id = p_world and uid = p_uid;
    if p.uid is not null and floor(p.x)::int = tx and floor(p.y)::int = ty then
      return 'You would be planting it under your own feet. Step off the tile first.';
    end if;

  elsif p_action = 'graft' then
    if here <> 16 then return 'There is no tree here to graft to.'; end if;
    if not coalesce((select alive from tree_age_def where id = tree_age(v_data)), true) then
      return 'There is no life in it to graft to.';
    end if;
    if (select fruit from tree_def where id = tree_species(v_data)) is not null then return 'It bears already.'; end if;
    -- Grafting is the forester's finest work, and a beginner's graft is a
    -- sprout thrown away.
    if skill_of(p_world, p_uid, 'forestry') < graft_skill() then
      return 'You do not know enough of trees to graft one yet. It takes forestry ' || graft_skill() || '.';
    end if;
    -- The sprout named, or any of the three that bear.
    if target_item(p_target) is not null and not exists (
        select 1 from item i join tree_def td on td.name = i.extra and td.fruit is not null
         where i.world_id = p_world and i.id = target_item(p_target) and i.holder = 'player'
           and i.holder_uid = p_uid and i.def = 'sprout') then
      return 'That is not a fruit sprout.';
    end if;
    if not exists (
        select 1 from item i join tree_def td on td.name = i.extra and td.fruit is not null
         where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid
           and i.def = 'sprout' and not i.locked) then
      return 'You have no fruit sprout to graft.';
    end if;

  elsif p_action = 'harvest_bush' then
    if here <> 17 then return 'There is no bush here.'; end if;
    if (select yields from bush_def where id = bush_species(v_data)) is null then
      return 'Nothing on a ' || lower((select name from bush_def where id = bush_species(v_data))) || ' is worth a sickle.';
    end if;
    if is_foraged(p_world, tx, ty, 'forage') then
      return 'You have had what this ' || lower((select name from bush_def where id = bush_species(v_data))) || ' has on it. Come back later.';
    end if;

  elsif p_action = 'dig_stump' then
    if here <> tile_id('Stump') then return 'There is no stump here.'; end if;

  elsif p_action = 'dig_worms' then
    if not t.wormy then return 'Nothing lives in that.'; end if;
    if pack_count(p_world, p_uid, 'shovel') < 1 then return 'You need a shovel.'; end if;
    if has_water(p_world, tx, ty) then return 'Not under water.'; end if;

  elsif p_action = 'prospect' then
    if pack_count(p_world, p_uid, 'pickaxe') < 1 then return 'You need a pickaxe to prospect.'; end if;
  end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.perform_ground(p_world uuid, p_uid uuid, p_action text, p_target jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare tx int; ty int; cx int; cy int; here int; t tile_def; v_data int; v_tree tree_def;
        d action_def; v_spoil text;
        v_skill double precision; v_tool double precision; v_ql double precision; v_n int;
        v_gained double precision; v_slab item; v_kind int; v_target int; v_hi record; v_lo record;
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

  if p_action = 'flatten' then
    v_target := flatten_target(p_world, p_uid, tx, ty);
    -- The corners furthest above and below the height we are working towards.
    select c.cx, c.cy into v_hi from tile_corners(tx, ty) c
      where land_height(p_world, c.cx, c.cy) > v_target
      order by land_height(p_world, c.cx, c.cy) desc limit 1;
    select c.cx, c.cy into v_lo from tile_corners(tx, ty) c
      where land_height(p_world, c.cx, c.cy) < v_target
      order by land_height(p_world, c.cx, c.cy) limit 1;
    if v_hi.cx is null and v_lo.cx is null then return; end if;
    -- Only soil can be moved with a shovel; bedrock needs a pickaxe.
    if v_hi.cx is not null and land_dirt(p_world, v_hi.cx, v_hi.cy) <= 0 then
      perform tell(p_world, p_uid, 'The high corner is bare rock. Mine it down instead.', 'error');
      return;
    end if;
    if v_hi.cx is not null and v_lo.cx is not null then
      -- One corner down and one up: the dirt simply moves across the tile.
      perform raise_corner(p_world, v_hi.cx, v_hi.cy, -1);
      perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
      perform tell(p_world, p_uid, 'You move some dirt across the tile.', 'event');
    elsif v_hi.cx is not null then
      perform raise_corner(p_world, v_hi.cx, v_hi.cy, -1);
      perform give(p_world, p_uid, v_spoil, 1,
        product_ql(skill_of(p_world, p_uid, d.skill), tool_ql(p_world, p_uid, 'shovel')));
      perform tell(p_world, p_uid, 'You scrape the ground down and pocket the '
        || lower((select name from item_def where id = v_spoil)) || '.', 'event');
    else
      /*
       * Its own stuff first and dirt after. Dirt fills anything, and it would
       * be a strange rule that let you take clay out of a bank and not put it
       * back.
       */
      if consume(p_world, p_uid, v_spoil, 1) then
        perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
        perform tell(p_world, p_uid, 'You pack '
          || lower((select name from item_def where id = v_spoil))
          || ' in to bring the ground up.', 'event');
      elsif consume(p_world, p_uid, 'dirt', 1) then
        perform raise_corner(p_world, v_lo.cx, v_lo.cy, 1);
        perform tell(p_world, p_uid, 'You pack dirt in to bring the ground up.', 'event');
      else
        perform tell(p_world, p_uid, 'You need '
          || lower((select name from item_def where id = v_spoil))
          || ' or dirt to bring this ground up to your level.', 'error');
        return;
      end if;
    end if;
    -- And what an hour of levelling ground teaches, which was nothing at all.
    v_gained := skill_raise(p_world, p_uid, d.skill, 1);
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
    if not consume(p_world, p_uid, 'dirt', 1) then return; end if;
    perform raise_corner(p_world, cx, cy, 1);
    -- What a spadeful covers over, off the list both sides read. It was two
    -- faces named here and nowhere else, so a clay bank took the dirt, rose a
    -- step and stayed clay.
    if exists (select 1 from buryable b where b.tile = here) then
      perform land_set_tile(p_world, tx, ty, 1);
    end if;
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You drop the dirt on the ' || corner_name(tx, ty, cx, cy)
      || ' corner, raising the ground.', 'event');

  elsif p_action = 'pave_slabs' then
    select i.* into v_slab from item i join slab_def s on s.item = i.def
      where i.world_id = p_world and i.holder = 'player' and i.holder_uid = p_uid and not i.locked
      order by (i.id = target_item(p_target)) desc, i.id limit 1;
    if not found then return; end if;
    select id into v_kind from slab_def where item = v_slab.def;
    if not skill_check(skill_of(p_world, p_uid, 'paving'), 10, v_slab.ql) then
      v_gained := skill_raise(p_world, p_uid, 'paving', try_gain(false));
      perform tell(p_world, p_uid,
        'The slab rocks on its bed however you set it. You leave it for now.', 'event');
      perform skill_said(p_world, p_uid, 'paving', v_gained);
      return;
    end if;
    if not consume(p_world, p_uid, v_slab.def, 1, v_slab.id) then return; end if;
    perform land_set_tile(p_world, tx, ty, 21);
    perform land_set_data(p_world, tx, ty, v_kind);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You bed the '
      || lower((select name from item_def where id = v_slab.def)) || ' down flat and true.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'remove_paving' then
    -- A slab comes up whole more often than not; gravel and cobbles do not.
    v_kind := case when here = 21 then v_data & 3 else null end;
    perform land_set_tile(p_world, tx, ty, 1);
    perform land_announce(p_world, tx, ty);
    if v_kind is not null and random() < 0.6 then
      v_ql := product_ql(skill_of(p_world, p_uid, 'paving'));
      perform give(p_world, p_uid, (select item from slab_def where id = v_kind), 1, v_ql);
      perform tell(p_world, p_uid, 'You lever the '
        || regexp_replace(lower((select name from slab_def where id = v_kind)), 's$', '')
        || ' up whole. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');
    else
      perform tell(p_world, p_uid, 'You break up the paving, leaving bare dirt.', 'event');
    end if;
    v_gained := skill_raise(p_world, p_uid, 'paving', 1);

  elsif p_action = 'cut_grass' then
    perform mark_foraged(p_world, tx, ty, 'grass');
    perform give(p_world, p_uid, 'mixed_grass', 2, product_ql(skill_of(p_world, p_uid, 'foraging')));
    perform tell(p_world, p_uid, 'You cut two bundles of mixed grass.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'foraging', 1);

  elsif p_action = 'cut_reeds' then
    perform mark_foraged(p_world, tx, ty, 'reed');
    v_skill := skill_of(p_world, p_uid, 'foraging');
    v_n := 2 + case when random() < v_skill / 140 then 1 else 0 end;
    perform give(p_world, p_uid, 'reed', v_n,
      product_ql(v_skill, tool_ql(p_world, p_uid, 'carving_knife')));
    perform tell(p_world, p_uid, 'You cut ' || v_n || ' reeds out of the bed.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'foraging', 1);

  elsif p_action = 'pick_fruit' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    -- An old tree carries more than one only just come into bearing, and a
    -- very old one as much as an old one.
    v_skill := skill_of(p_world, p_uid, 'forestry');
    v_n := greatest(1, round(case when tree_age(v_data) in (2, 4) then 5 else 3 end
                             * (0.5 + v_skill / 130) * (0.7 + random() * 0.6))::int);
    v_ql := product_ql(v_skill);
    perform give(p_world, p_uid, v_tree.fruit, v_n, v_ql);
    perform mark_foraged(p_world, tx, ty, 'forage');
    v_gained := skill_raise(p_world, p_uid, 'forestry', 0.35);
    perform tell(p_world, p_uid, 'You pick ' || v_n || ' '
      || lower((select name from item_def where id = v_tree.fruit))
      || case when v_n = 1 then '' else 's' end
      || ' off the ' || lower(v_tree.name) || '. (QL ' || to_char(v_ql, 'FM990.0') || ')', 'event');

  elsif p_action = 'pick_sprout' then
    select * into v_tree from tree_def where id = tree_species(v_data);
    if not skill_check(skill_of(p_world, p_uid, 'forestry'), 15) then
      v_gained := skill_raise(p_world, p_uid, 'forestry', try_gain(false));
      perform tell(p_world, p_uid, 'You find no sprout worth picking.', 'event');
      perform skill_said(p_world, p_uid, 'forestry', v_gained);
      return;
    end if;
    perform give(p_world, p_uid, 'sprout', 1,
      product_ql(skill_of(p_world, p_uid, 'forestry')), v_tree.name);
    perform tell(p_world, p_uid, 'You pick a ' || lower(v_tree.name) || ' sprout.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'forestry', 1);

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
      v_gained := skill_raise(p_world, p_uid, 'forestry', try_gain(false));
      perform tell(p_world, p_uid, 'You cut at the ' || lower(v_tree.name)
        || ' and take off nothing that matters.', 'event');
      perform skill_said(p_world, p_uid, 'forestry', v_gained);
      return;
    end if;
    /*
     * The age and nothing else. The species stays, and so does the notch a
     * hatchet has left in the trunk — it is beside the land, and the tile is
     * still a tree: pruning is the crown's business, and a half-felled tree
     * pruned back is still half felled.
     */
    perform land_set_data(p_world, tx, ty, (v_data & 15) | ((v_to.id & 15) << 4));
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You prune the ' || lower(v_age.name) || ' ' || lower(v_tree.name)
      || ' back. It stands as a ' || lower(v_to.name) || ' ' || lower(v_tree.name) || ' now.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'forestry', 1);

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
    -- Species in the low nibble, age in the two bits above it: a planted tree
    -- starts as a sapling and grows on the same clock as one that seeded itself.
    perform land_set_data(p_world, tx, ty, v_species & 15);
    perform land_announce(p_world, tx, ty);
    perform journal_note(p_world, p_uid, 'planted');
    if (select fruit from tree_def where id = v_species) is not null then
      perform journal_note(p_world, p_uid, 'orchard');
    end if;
    perform tell(p_world, p_uid, 'You plant the '
      || lower((select name from tree_def where id = v_species)) || ' sprout.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'forestry', 1);

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
      v_gained := skill_raise(p_world, p_uid, 'forestry', try_gain(false));
      perform tell(p_world, p_uid, 'The ' || lower(v_sprout.extra) || ' graft does not take, and the sprout is spent.', 'event');
      perform skill_said(p_world, p_uid, 'forestry', v_gained);
      return;
    end if;
    -- The species and nothing else: the age stays, and so does any notch.
    perform land_set_data(p_world, tx, ty, (v_species & 15) | (tree_age(v_data) << 4));
    perform land_announce(p_world, tx, ty);
    perform journal_note(p_world, p_uid, 'orchard');
    perform tell(p_world, p_uid, 'You graft the ' || lower(v_sprout.extra) || ' sprout onto the ' || lower(v_tree.name)
      || '. It is a ' || lower((select name from tree_age_def where id = tree_age(v_data))) || ' '
      || lower(v_sprout.extra) || ' tree now.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'forestry', 1);

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
    perform give(p_world, p_uid, (select yields from bush_def where id = bush_species(v_data)), v_n, v_ql);
    perform mark_foraged(p_world, tx, ty, 'forage');
    v_gained := skill_raise(p_world, p_uid, 'forestry', 0.35);
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
      v_gained := skill_raise(p_world, p_uid, 'digging', try_gain(false));
      perform tell(p_world, p_uid, 'The roots hold. You dig round the ' || lower(v_tree.name)
        || ' stump and it does not shift.', 'event');
      perform skill_said(p_world, p_uid, 'digging', v_gained);
      return;
    end if;
    -- Bare dirt where it stood: the roots came out with it.
    perform land_set_tile(p_world, tx, ty, tile_id('Dirt'));
    perform land_set_data(p_world, tx, ty, 0);
    perform land_announce(p_world, tx, ty);
    perform tell(p_world, p_uid, 'You dig the ' || lower(v_tree.name)
      || ' stump out. The ground is bare dirt where it stood.', 'event');
    v_gained := skill_raise(p_world, p_uid, 'digging', 1);

  elsif p_action = 'dig_worms' then
    v_gained := skill_raise(p_world, p_uid, 'digging', 0.2);
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
    perform give(p_world, p_uid, 'worm', v_n, 20 + random() * 40);
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
    v_gained := skill_raise(p_world, p_uid, 'prospecting', 1);
  end if;

  perform skill_said(p_world, p_uid,
    (select skill from action_def where id = p_action), v_gained);
end $function$
;

select private.lock_doors();
